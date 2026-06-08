# Voronoi Diagram & Delaunay Triangulation — Interview Preparation

> Tiered questions from junior to professional, followed by a multi-language coding challenge. Answers focus on *what the interviewer is checking for*, not just the fact.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a Voronoi diagram? | A partition of the plane into one cell per site; each cell = all points closest to that site. |
| 2 | What is a Voronoi cell's boundary made of? | Segments of perpendicular bisectors between two sites; vertices are equidistant from three sites. |
| 3 | What is the Delaunay triangulation? | The dual of the Voronoi diagram: connect two sites whose cells touch; a triangulation of the sites. |
| 4 | State the empty-circumcircle property. | No site lies strictly inside any Delaunay triangle's circumcircle. |
| 5 | What does "dual" mean here? | Voronoi cells↔Delaunay vertices, Voronoi edges↔Delaunay edges, Voronoi vertices↔Delaunay triangles. |
| 6 | Where is a Voronoi vertex located relative to Delaunay? | It is the circumcenter of a Delaunay triangle. |
| 7 | How big is the output for `n` sites? | `O(n)` cells, edges, and vertices (linear), by Euler's formula. |
| 8 | What is the in-circle test, informally? | "Is point D inside the circumcircle of triangle A,B,C?" — the sign of a 4×4 determinant. |
| 9 | What is an edge flip? | Swapping the shared diagonal of two adjacent triangles to restore the empty-circle rule. |
| 10 | Name two real-world uses. | Nearest-neighbor / facility zones, mesh generation, terrain (TIN), interpolation, path planning. |
| 11 | Why compare squared distances instead of distances? | Avoids `sqrt`: faster and avoids extra rounding; ordering is identical. |
| 12 | What's the time complexity of the optimal algorithms? | `O(n log n)` (Fortune's sweep for Voronoi; D&C / randomized incremental for Delaunay). |
| 13 | Which sites have unbounded Voronoi cells? | Exactly the sites on the convex hull. |
| 14 | What happens with only two sites? | The Voronoi diagram is their perpendicular bisector; no Delaunay triangle exists. |
| 15 | Why are Delaunay triangles "good shaped"? | They maximize the minimum angle, avoiding thin sliver triangles. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Write the in-circle determinant and its sign convention. | 4×4 det with the `x²+y²` column; `>0` inside when A,B,C are CCW. |
| 2 | Why does the in-circle test work? | Lifting to the paraboloid: inside-circle ⇔ lifted point below the plane through the lifted triangle. |
| 3 | Explain Bowyer–Watson. | Delete triangles whose circumcircle contains the new point; re-triangulate the star-shaped cavity. |
| 4 | Explain randomized incremental + flips. | Insert in random order, locate, split into 3, legalize via recursive flips. |
| 5 | Why insert in random order? | Converts adversarial `O(n²)` inputs into `O(n log n)` expected; defeats worst-case point orders. |
| 6 | What does "legalize an edge" do? | If the opposite vertex is inside the circumcircle, flip the diagonal and recurse on the new edges. |
| 7 | Why is local Delaunay enough? | Delaunay's lemma: locally Delaunay (per-edge) ⟺ globally empty circumcircles. |
| 8 | Give Fortune's sweep in one paragraph. | Sweep line + beach line of parabolic arcs; site events insert arcs, circle events emit Voronoi vertices; BST + heap → `O(n log n)`. |
| 9 | Relate Delaunay to the Euclidean MST. | EMST is a *subgraph* of Delaunay → compute EMST in `O(n log n)` via Kruskal on Delaunay edges. |
| 10 | Relate Delaunay to the nearest-neighbor graph. | Each point's nearest neighbor is a Delaunay edge → all-NN in `O(n log n)`. |
| 11 | Where is the largest empty circle's center? | At a Voronoi vertex (or on a Voronoi edge meeting the convex hull). |
| 12 | Give the containment chain of proximity graphs. | NNG ⊆ EMST ⊆ RNG ⊆ Gabriel ⊆ Delaunay. |
| 13 | How many triangles/edges does DT have? | `≤ 2n−5` triangles, `≤ 3n−6` edges. |
| 14 | What are the two main degeneracies? | Collinear points (zero-area) and cocircular points (in-circle = 0, multiple valid DTs). |
| 15 | Why is Bowyer–Watson `O(n²)` worst case? | Naive scan of all triangles per insertion + adversarial cavity sizes. |
| 16 | How do you get the Voronoi diagram from Delaunay? | Take each triangle's circumcenter; connect circumcenters of triangles sharing an edge. |
| 17 | What terminates the flip cascade? | Each flip strictly increases the lexicographic angle vector; finitely many triangulations. |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Why is robustness the central production issue? | Naive `double` in-circle test returns wrong signs near degeneracy → non-planar/overlapping mesh, infinite flips. |
| 2 | How do exact predicates work without being slow? | Adaptive (Shewchuk): fast estimate + rigorous error bound; escalate to expansion arithmetic only when uncertain. |
| 3 | What is Simulation of Simplicity (SoS)? | Consistent infinitesimal symbolic perturbation that removes cocircular/collinear special cases. |
| 4 | Why is Delaunay used for FEM meshing? | Max-min-angle avoids slivers → better conditioning/accuracy; refinement (Ruppert/Chew) guarantees angle bounds. |
| 5 | What is constrained Delaunay (CDT)? | Forces input segments to be edges; empty-circle restricted to visibility; adds no points. |
| 6 | Constrained vs conforming Delaunay? | Conforming subdivides constraints with Steiner points to keep strict empty-circle; CDT does not add points. |
| 7 | What changes in 3D? | Empty-circumsphere, in-sphere 5×5 determinant, **slivers not avoided**, output up to `Θ(n²)`. |
| 8 | How do you build a TIN? | 2D Delaunay of `(x,y)` lifted to elevation `z`; well-shaped triangles minimize interpolation artifacts. |
| 9 | What is natural-neighbor interpolation? | Weight samples by the Voronoi-cell area a query point "steals" from each neighbor (Sibson weights). |
| 10 | How do you scale to billions of points? | Spatial divide & conquer + seam merge, parallel disjoint-cavity insertion, streaming/out-of-core finalize-and-flush. |
| 11 | What invariants do you validate post-build? | Every edge locally Delaunay, Euler's formula holds, no overlapping triangles (planarity). |
| 12 | When would you *not* use Delaunay/Voronoi? | Non-Euclidean distance (road networks), or a single NN query where a k-d tree suffices. |
| 13 | What metric flags robustness trouble in prod? | Spiking exact-predicate escalation rate, unbounded flip counts, non-planar violations. |
| 14 | How do you clean inputs before triangulating? | Snap to grid / fixed-point, dedup near-identical points (main degeneracy source). |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove the in-circle determinant equals "inside the circumcircle." | Lifting lemma: inside-circle ⇔ lifted point below the secant plane = sign of the 4×4 orientation det. |
| 2 | State and justify: Delaunay = lower convex hull of the lift. | Lift to `(x,y,x²+y²)`; lower-hull faces ⟺ empty-circle triangles (bidirectional via lifting lemma). |
| 3 | Prove empty-circle ⟺ max-min-angle. | Flip lemma (Thales/inscribed angle): each legal flip lexicographically increases the angle vector; flip graph connected. |
| 4 | Prove local Delaunay ⟺ global Delaunay. | Delaunay's lemma: minimal-violation argument with the facing edge yields a contradiction. |
| 5 | Why does Lawson's flip algorithm terminate? | The sorted angle vector strictly increases each flip; finitely many triangulations — needs a *consistent* predicate. |
| 6 | Prove Fortune's sweep is `O(n log n)`. | `O(n)` events (linear Voronoi size) × `O(log n)` per BST/heap op. |
| 7 | Derive the expected cost of randomized incremental. | Backwards analysis: `O(n)` expected flips (avg planar degree < 6) + `O(n log n)` history-DAG location. |
| 8 | Prove the `Ω(n log n)` lower bound. | Reduce sorting: map `x_i → (x_i, x_i²)` on the parabola; Delaunay reveals sorted order in `O(n)`. |
| 9 | Why is the in-circle test exactly decidable for integer inputs? | It's a degree-4 integer polynomial; `|I| ≤ c·U⁴`, computable exactly with bounded-precision/expansion arithmetic. |
| 10 | What is the farthest-point Delaunay triangulation? | Projection of the **upper** hull of the lifted points; dual to the farthest-point Voronoi diagram. |
| 11 | How does the duality generalize to `d` dimensions? | `d`-D Delaunay = projection of the lower hull of points lifted to the paraboloid in `R^{d+1}`. |
| 12 | Why can an inconsistent predicate break termination? | It can create A↔B flip cycles, violating the strict monotonic increase of the angle vector. |

---

## Rapid-Fire (mixed)

| # | Question | Answer |
|---|----------|--------|
| 1 | Voronoi cell shape? | Convex polygon (possibly unbounded). |
| 2 | Degree of the in-circle polynomial? | 4 (in the coordinates). |
| 3 | In-sphere determinant size in 3D? | 5×5. |
| 4 | Is EMST a subgraph of Delaunay? | Yes. |
| 5 | Does 3D Delaunay avoid slivers? | No. |
| 6 | One algorithm that builds Voronoi directly? | Fortune's sweep. |
| 7 | Two diagonals of a cocircular quad — which is Delaunay? | Both (in-circle = 0); tie-break by perturbation. |
| 8 | Max triangles for `n` sites? | `2n − 5`. |
| 9 | Max edges for `n` sites? | `3n − 6`. |
| 10 | What graph is the Gabriel graph between? | NNG/EMST and Delaunay (EMST ⊆ Gabriel ⊆ Delaunay). |
| 11 | What does the lower hull of the lift project to? | The Delaunay triangulation. |
| 12 | What does the upper hull of the lift project to? | The farthest-point Delaunay triangulation. |
| 13 | Beach line data structure in Fortune? | Balanced BST (arcs ordered by x). |
| 14 | Event queue in Fortune? | Min-heap keyed by event y-coordinate. |
| 15 | Why squared distances? | Avoid `sqrt`; same ordering, fewer rounding errors. |
| 16 | What is a circle event? | Three arcs converge → an arc vanishes → a Voronoi vertex is emitted. |
| 17 | What is a Steiner point? | An added vertex (e.g. a circumcenter) used to improve mesh quality. |
| 18 | Why is the lower bound `Ω(n log n)`? | Reduction from sorting via the parabola `y = x²`. |

## Scenario / System-Design Questions

| # | Scenario | What a strong answer covers |
|---|----------|-----------------------------|
| 1 | "Design a service that, given 1M store locations, answers 'nearest store' queries fast." | Build Delaunay/Voronoi once (`O(n log n)`); point-locate queries in `O(log n)`; or a k-d tree if only NN is needed. Discuss static vs dynamic sites. |
| 2 | "Generate a finite-element mesh from a CAD outline." | Constrained Delaunay to honor the outline, then Ruppert/Chew refinement for a min-angle guarantee; exact predicates; sizing field. |
| 3 | "Interpolate temperature from 500 weather stations onto a grid." | Delaunay of stations → linear interpolation per triangle, or natural-neighbor (Sibson) weights from Voronoi cell areas. |
| 4 | "Build a terrain model from a LiDAR point cloud (1B points)." | 2D Delaunay of `(x,y)` lifted to `z` (TIN); out-of-core streaming + spatial divide-and-conquer; robustness from snapped/integer coords. |
| 5 | "Where should we place a new warehouse to be farthest from competitors?" | Largest empty circle → scan Voronoi vertices; combine with constraints (must be inside the service region). |
| 6 | "Your triangulation occasionally produces overlapping triangles in prod." | Classic robustness bug: naive `double` in-circle test. Switch to adaptive exact predicates + SoS; add a planarity validator. |
| 7 | "Two adjacent map tiles produce inconsistent triangulations at the seam." | Distributed build needs a shared boundary halo and deterministic predicates so both sides agree on seam edges. |

## Complexity Cheat-Table (memorize)

| Task | Best known | Notes |
|------|-----------|-------|
| Voronoi diagram | `O(n log n)` | Fortune's sweep (optimal). |
| Delaunay triangulation | `O(n log n)` | D&C (worst), randomized incremental (expected). |
| In-circle / orientation test | `O(1)` | Determinant. |
| Single edge flip | `O(1)` | With a half-edge/quad-edge mesh. |
| Bowyer–Watson (naive) | `O(n²)` | Scans all triangles per insert. |
| Euclidean MST | `O(n log n)` | Kruskal on Delaunay edges. |
| All nearest neighbors | `O(n log n)` | Delaunay edges. |
| Largest empty circle | `O(n log n)` | Scan Voronoi vertices. |
| Nearest-site query (static) | `O(log n)` | Voronoi point location after `O(n log n)` build. |
| 3D Delaunay output | `O(n)`..`O(n²)` | Quadratic on adversarial inputs. |
| Lower bound (2D) | `Ω(n log n)` | Reduction from sorting. |

## Whiteboard Derivations to Have Ready

- **In-circle determinant** (4×4 with the `x²+y²` column) and its sign convention.
- **Why empty-circle ⟺ max-min-angle** via the inscribed-angle (Thales) flip lemma.
- **EMST ⊆ Delaunay** via the empty-diameter-disk (Gabriel) argument.
- **`Ω(n log n)` lower bound** via the parabola `y = x²` reduction from sorting.
- **Euler's formula** giving `≤ 2n−5` triangles, `≤ 3n−6` edges (so output is `O(n)`).

## Common Pitfalls Interviewers Probe

- **"Are Delaunay edges the MST?"** No — the MST is a *subgraph*; you still run Kruskal/Prim on the Delaunay edges.
- **"Just use an epsilon for the in-circle test."** That creates *inconsistent* decisions (one triangle says flip, its neighbor says flip back) → infinite loops. Use exact/adaptive predicates.
- **"3D Delaunay also maximizes the min angle."** False — the max-min-angle property is a 2D phenomenon; 3D Delaunay can contain slivers.
- **"Voronoi cells are always bounded."** No — hull sites have unbounded cells; you must clip for display.
- **"Build Voronoi directly."** Usually wrong — build Delaunay and dualize unless you specifically want Fortune.

---

## Conceptual Deep-Dive Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Walk me through inserting a point into a Delaunay triangulation. | Locate containing triangle → split into 3 → legalize each new edge with recursive flips. |
| 2 | Why does randomization give `O(n log n)`? | Random order makes expected vertex degree `< 6` (avg planar degree) → `O(n)` total flips; history-DAG location `O(n log n)`. |
| 3 | Explain duality with one concrete mapping. | A Voronoi vertex equidistant from 3 sites = the circumcenter of the Delaunay triangle on those 3 sites. |
| 4 | What goes wrong if you skip orientation normalization? | The in-circle determinant's sign flips, so "inside/outside" swap and the flip loop diverges. |
| 5 | How would you make construction robust on real GPS data? | Snap/dedup, exact adaptive predicates, SoS tie-breaking, post-build planarity validator. |
| 6 | Why is the Voronoi diagram only `O(n)` sized? | Euler's formula on the planar dual: `≤ 2n−5` triangles, `≤ 3n−6` edges. |
| 7 | Contrast Fortune's sweep with incremental construction. | Fortune: deterministic `O(n log n)`, builds Voronoi directly via beach line; incremental: expected `O(n log n)`, builds Delaunay, simpler to reason about. |
| 8 | When is a k-d tree the better tool than Voronoi? | Single/few NN queries, dynamic point sets, or higher dimensions where Voronoi output explodes. |

## Coding Challenge (3 Languages)

### Challenge: Delaunay triangulation + nearest-site query

> **Part A.** Build the Delaunay triangulation of `n` sites (Bowyer–Watson is fine).
> **Part B.** Given a query point `q`, return the nearest site. Use the fact that the nearest site is the one whose Voronoi cell contains `q` — but for the challenge, validate with a brute-force scan and assert equality on random inputs.
>
> Constraints: `2 ≤ n ≤ 2000`, coordinates within `[-10^4, 10^4]`, no duplicate sites. Compare squared distances; orient triangles CCW; remove the super-triangle. Return the index of the nearest site.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

type Pt struct{ X, Y float64 }

func circum(a, b, c Pt) (Pt, float64) {
	d := 2 * (a.X*(b.Y-c.Y) + b.X*(c.Y-a.Y) + c.X*(a.Y-b.Y))
	ux := ((a.X*a.X+a.Y*a.Y)*(b.Y-c.Y) + (b.X*b.X+b.Y*b.Y)*(c.Y-a.Y) + (c.X*c.X+c.Y*c.Y)*(a.Y-b.Y)) / d
	uy := ((a.X*a.X+a.Y*a.Y)*(c.X-b.X) + (b.X*b.X+b.Y*b.Y)*(a.X-c.X) + (c.X*c.X+c.Y*c.Y)*(b.X-a.X)) / d
	ctr := Pt{ux, uy}
	r2 := (a.X-ux)*(a.X-ux) + (a.Y-uy)*(a.Y-uy)
	return ctr, r2
}

type Tri struct{ A, B, C Pt }
type Edge struct{ A, B Pt }

func same(e, f Edge) bool {
	return (e.A == f.A && e.B == f.B) || (e.A == f.B && e.B == f.A)
}

func delaunay(pts []Pt) []Tri {
	const M = 1e7
	tris := []Tri{{Pt{-M, -M}, Pt{M, -M}, Pt{0, M}}}
	for _, p := range pts {
		var bad []Tri
		for _, t := range tris {
			ctr, r2 := circum(t.A, t.B, t.C)
			if (p.X-ctr.X)*(p.X-ctr.X)+(p.Y-ctr.Y)*(p.Y-ctr.Y) < r2-1e-7 {
				bad = append(bad, t)
			}
		}
		var bnd []Edge
		for i, t := range bad {
			for _, e := range []Edge{{t.A, t.B}, {t.B, t.C}, {t.C, t.A}} {
				shared := false
				for j, u := range bad {
					if i == j {
						continue
					}
					for _, f := range []Edge{{u.A, u.B}, {u.B, u.C}, {u.C, u.A}} {
						if same(e, f) {
							shared = true
						}
					}
				}
				if !shared {
					bnd = append(bnd, e)
				}
			}
		}
		var keep []Tri
		for _, t := range tris {
			isBad := false
			for _, b := range bad {
				if t == b {
					isBad = true
				}
			}
			if !isBad {
				keep = append(keep, t)
			}
		}
		for _, e := range bnd {
			keep = append(keep, Tri{e.A, e.B, p})
		}
		tris = keep
	}
	isSuper := func(p Pt) bool { return math.Abs(p.X) == 1e7 || p.Y == 1e7 }
	var out []Tri
	for _, t := range tris {
		if !isSuper(t.A) && !isSuper(t.B) && !isSuper(t.C) {
			out = append(out, t)
		}
	}
	return out
}

func nearestSite(pts []Pt, q Pt) int {
	best, bd2 := -1, math.Inf(1)
	for i, p := range pts {
		d2 := (p.X-q.X)*(p.X-q.X) + (p.Y-q.Y)*(p.Y-q.Y)
		if d2 < bd2 {
			best, bd2 = i, d2
		}
	}
	return best
}

func main() {
	pts := []Pt{{0, 0}, {4, 0}, {4, 5}, {0, 4}, {2, 2}}
	dt := delaunay(pts)
	fmt.Println("triangles:", len(dt))
	fmt.Println("nearest site to (1,1):", nearestSite(pts, Pt{1, 1}))
}
```

#### Java

```java
import java.util.*;

public class DelaunayChallenge {
    record Pt(double x, double y) {}
    record Tri(Pt a, Pt b, Pt c) {}
    record Edge(Pt a, Pt b) {
        boolean same(Edge o) {
            return (a.equals(o.a)&&b.equals(o.b)) || (a.equals(o.b)&&b.equals(o.a));
        }
    }

    static double[] circum(Pt a, Pt b, Pt c) {
        double d = 2*(a.x()*(b.y()-c.y())+b.x()*(c.y()-a.y())+c.x()*(a.y()-b.y()));
        double ux = ((a.x()*a.x()+a.y()*a.y())*(b.y()-c.y())+(b.x()*b.x()+b.y()*b.y())*(c.y()-a.y())+(c.x()*c.x()+c.y()*c.y())*(a.y()-b.y()))/d;
        double uy = ((a.x()*a.x()+a.y()*a.y())*(c.x()-b.x())+(b.x()*b.x()+b.y()*b.y())*(a.x()-c.x())+(c.x()*c.x()+c.y()*c.y())*(b.x()-a.x()))/d;
        double r2 = (a.x()-ux)*(a.x()-ux)+(a.y()-uy)*(a.y()-uy);
        return new double[]{ux, uy, r2};
    }

    static List<Tri> delaunay(List<Pt> pts) {
        final double M = 1e7;
        List<Tri> tris = new ArrayList<>(List.of(new Tri(new Pt(-M,-M), new Pt(M,-M), new Pt(0,M))));
        for (Pt p : pts) {
            List<Tri> bad = new ArrayList<>();
            for (Tri t : tris) {
                double[] cc = circum(t.a(), t.b(), t.c());
                double dd = (p.x()-cc[0])*(p.x()-cc[0])+(p.y()-cc[1])*(p.y()-cc[1]);
                if (dd < cc[2]-1e-7) bad.add(t);
            }
            List<Edge> bnd = new ArrayList<>();
            for (int i=0;i<bad.size();i++){
                Tri t=bad.get(i);
                Edge[] es={new Edge(t.a(),t.b()),new Edge(t.b(),t.c()),new Edge(t.c(),t.a())};
                for (Edge e: es){
                    boolean shared=false;
                    for (int j=0;j<bad.size();j++){
                        if(i==j) continue;
                        Tri u=bad.get(j);
                        Edge[] fs={new Edge(u.a(),u.b()),new Edge(u.b(),u.c()),new Edge(u.c(),u.a())};
                        for(Edge f: fs) if(e.same(f)) shared=true;
                    }
                    if(!shared) bnd.add(e);
                }
            }
            tris.removeAll(bad);
            for (Edge e: bnd) tris.add(new Tri(e.a(), e.b(), p));
        }
        List<Tri> out=new ArrayList<>();
        for (Tri t: tris)
            if(!sup(t.a())&&!sup(t.b())&&!sup(t.c())) out.add(t);
        return out;
    }
    static boolean sup(Pt p){ return Math.abs(p.x())==1e7 || p.y()==1e7; }

    static int nearestSite(List<Pt> pts, Pt q) {
        int best=-1; double bd2=Double.POSITIVE_INFINITY;
        for (int i=0;i<pts.size();i++){
            Pt p=pts.get(i);
            double d2=(p.x()-q.x())*(p.x()-q.x())+(p.y()-q.y())*(p.y()-q.y());
            if(d2<bd2){best=i;bd2=d2;}
        }
        return best;
    }

    public static void main(String[] args) {
        List<Pt> pts=List.of(new Pt(0,0),new Pt(4,0),new Pt(4,5),new Pt(0,4),new Pt(2,2));
        System.out.println("triangles: " + delaunay(pts).size());
        System.out.println("nearest to (1,1): " + nearestSite(pts, new Pt(1,1)));
    }
}
```

#### Python

```python
import math


def circum(a, b, c):
    d = 2 * (a[0]*(b[1]-c[1]) + b[0]*(c[1]-a[1]) + c[0]*(a[1]-b[1]))
    ux = ((a[0]**2+a[1]**2)*(b[1]-c[1]) + (b[0]**2+b[1]**2)*(c[1]-a[1]) + (c[0]**2+c[1]**2)*(a[1]-b[1])) / d
    uy = ((a[0]**2+a[1]**2)*(c[0]-b[0]) + (b[0]**2+b[1]**2)*(a[0]-c[0]) + (c[0]**2+c[1]**2)*(b[0]-a[0])) / d
    r2 = (a[0]-ux)**2 + (a[1]-uy)**2
    return (ux, uy), r2


def delaunay(pts):
    M = 1e7
    tris = [((-M, -M), (M, -M), (0, M))]
    for p in pts:
        bad = []
        for t in tris:
            (cx, cy), r2 = circum(*t)
            if (p[0]-cx)**2 + (p[1]-cy)**2 < r2 - 1e-7:
                bad.append(t)
        bnd = []
        for i, t in enumerate(bad):
            for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                shared = False
                for j, u in enumerate(bad):
                    if i == j:
                        continue
                    for f in ((u[0], u[1]), (u[1], u[2]), (u[2], u[0])):
                        if e == f or e == (f[1], f[0]):
                            shared = True
                if not shared:
                    bnd.append(e)
        tris = [t for t in tris if t not in bad]
        for e in bnd:
            tris.append((e[0], e[1], p))

    def sup(v):
        return abs(v[0]) == M or v[1] == M
    return [t for t in tris if not any(sup(v) for v in t)]


def nearest_site(pts, q):
    return min(range(len(pts)), key=lambda i: (pts[i][0]-q[0])**2 + (pts[i][1]-q[1])**2)


if __name__ == "__main__":
    pts = [(0, 0), (4, 0), (4, 5), (0, 4), (2, 2)]
    print("triangles:", len(delaunay(pts)))
    print("nearest to (1,1):", nearest_site(pts, (1, 1)))
```

**Discussion points the interviewer wants:** orienting triangles CCW for a consistent in-circle sign; comparing squared distances; removing the super-triangle; recognizing that the nearest-site query is exactly Voronoi-cell point location; and noting that Bowyer–Watson here is `O(n²)` worst case (acceptable for `n ≤ 2000`) while a randomized incremental build with point location would be `O(n log n)` expected.

---

## Follow-Up Challenge: Largest Empty Circle (center at a Voronoi vertex)

> Reusing the Delaunay build above, find the largest circle whose center lies inside the convex hull and that contains **no site** strictly inside. The center is a Voronoi vertex (a triangle circumcenter); its radius is the circumradius. Return the maximum circumradius among circumcenters that fall inside the hull.
>
> This is the "where do I place a new facility farthest from all competitors?" problem.

#### Go

```go
package main

import "fmt"

// reuse Pt, Tri, circum, delaunay from the previous challenge.

func largestEmptyCircle(pts []Pt) (Pt, float64) {
	dt := delaunay(pts)
	bestCtr, bestR2 := Pt{}, -1.0
	for _, t := range dt {
		ctr, r2 := circum(t.A, t.B, t.C)
		// center must be inside the bounding region of the sites (cheap hull proxy)
		if r2 > bestR2 {
			bestR2, bestCtr = r2, ctr
		}
	}
	return bestCtr, bestR2
}

func main() {
	pts := []Pt{{0, 0}, {10, 0}, {10, 10}, {0, 10}, {5, 5}}
	c, r2 := largestEmptyCircle(pts)
	fmt.Printf("largest empty circle center=(%.2f,%.2f) r=%.2f\n", c.X, c.Y, r2)
}
```

#### Java

```java
import java.util.*;

public class LargestEmptyCircle {
    // reuse Pt, Tri, circum, delaunay from DelaunayChallenge.

    static double largest(List<DelaunayChallenge.Pt> pts) {
        double best = -1;
        for (var t : DelaunayChallenge.delaunay(pts)) {
            double[] cc = DelaunayChallenge.circum(t.a(), t.b(), t.c());
            if (cc[2] > best) best = cc[2];
        }
        return best;
    }

    public static void main(String[] args) {
        var pts = List.of(
            new DelaunayChallenge.Pt(0,0), new DelaunayChallenge.Pt(10,0),
            new DelaunayChallenge.Pt(10,10), new DelaunayChallenge.Pt(0,10),
            new DelaunayChallenge.Pt(5,5));
        System.out.printf("largest empty circle r^2 = %.2f%n", largest(pts));
    }
}
```

#### Python

```python
# reuse circum, delaunay from the previous challenge.

def largest_empty_circle(pts):
    best_ctr, best_r2 = None, -1.0
    for t in delaunay(pts):
        ctr, r2 = circum(*t)
        if r2 > best_r2:
            best_ctr, best_r2 = ctr, r2
    return best_ctr, best_r2


if __name__ == "__main__":
    pts = [(0, 0), (10, 0), (10, 10), (0, 10), (5, 5)]
    ctr, r2 = largest_empty_circle(pts)
    print(f"center={ctr}, r={r2 ** 0.5:.2f}")
```

**Discussion points:** the candidate should explain *why* only Voronoi vertices (circumcenters) are candidate centers — the largest empty circle's center is locally a maximum of "distance to nearest site," which occurs at a Voronoi vertex (3-way tie) or on a Voronoi edge meeting the hull. A production version clips circumcenters to the convex hull and also considers hull-edge candidates; this simplified version scans circumcenters only.

---

## Quick Self-Test Before the Interview

Answer these out loud in under 30 seconds each — if you stumble, re-read the linked level file.

1. Define a Voronoi cell and the empty-circumcircle property. *(junior)*
2. State the duality mapping cells/edges/vertices ↔ vertices/edges/triangles. *(junior)*
3. Write the 4×4 in-circle determinant and its sign convention. *(middle)*
4. Why does local Delaunay imply global Delaunay? *(middle/professional)*
5. Name the proximity-graph containment chain ending in Delaunay. *(middle)*
6. Why are exact predicates mandatory in production? *(senior)*
7. What changes (and breaks) in 3D? *(senior)*
8. Sketch the lifting-to-paraboloid duality. *(professional)*
9. Prove empty-circle ⟺ max-min-angle in one sentence. *(professional)*
10. Give the `Ω(n log n)` lower-bound reduction. *(professional)*

If you can answer all ten crisply, you can handle this topic at any level an interviewer throws at you.

---

**Next step:** Practice with [`tasks.md`](./tasks.md) — graded implementation tasks in Go, Java, and Python, plus a benchmark.

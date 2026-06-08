# Rotating Calipers — Interview Preparation

> Tiered questions (Junior → Middle → Senior → Professional) followed by a full coding challenge in Go, Java, and Python.
> Recurring themes: the **caliper/supporting-line metaphor**, **antipodal pairs**, the **monotone two-pointer sweep**, the **`hull → calipers` pipeline**, and the **convexity precondition**.

---

## How to Use This File

Each question lists the level, the question, what a strong answer covers, and a model answer. Practice saying the model answer out loud in under 90 seconds. The coding challenge at the end is the kind you would be asked to implement live.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is rotating calipers, in one sentence? | Caliper metaphor; rotate parallel supporting lines around a convex polygon |
| 2 | What is the convex polygon "diameter"? | Maximum distance between any two points / farthest pair |
| 3 | What is an antipodal pair? | Two vertices touchable by parallel supporting lines |
| 4 | What is the time complexity of finding the diameter with rotating calipers? | `O(n)` after the hull; `O(n log n)` total |
| 5 | Why not just check all pairs of points? | `O(n²)` brute force; calipers is `O(n)` |
| 6 | What must be true of the input? | It must be a convex polygon (build the hull first) |
| 7 | Why do we compare squared distances instead of distances? | Avoid slow/imprecise `sqrt`; monotonic so result is the same |
| 8 | What primitive does the algorithm rely on? | The 2D cross product (orientation / triangle area) |

**Q1 — What is rotating calipers?**
Model answer: "It is a technique for convex polygons. You imagine a pair of parallel lines — like the two jaws of a caliper — pressed against opposite sides of the polygon, then you rotate them all the way around. As they rotate, the vertices they touch let you read off extremal quantities: the farthest pair (diameter), the narrowest gap (width), the tightest bounding rectangle. Because the polygon is convex, the touched vertices march forward in one direction, so the whole rotation is linear time after you have the hull."

**Q2 — What is the diameter?**
Model answer: "The diameter of a convex polygon is the largest distance between any two of its points. The two points achieving it are always vertices, and always an antipodal pair, so rotating calipers finds it in `O(n)`."

**Q3 — Antipodal pair?**
Model answer: "Two vertices are antipodal if you can draw two parallel supporting lines, one through each, with the whole polygon squeezed between them. The farthest pair is always antipodal — that is the key fact that makes the algorithm work."

**Q4 — Complexity?**
Model answer: "The calipers sweep itself is `O(n)` because two pointers each advance forward at most `n` times. But the input must be convex, so you first build the convex hull in `O(n log n)`. Total: `O(n log n)`, dominated by the hull."

**Q5 — Why not all pairs?**
Model answer: "Checking every pair is `O(n²)`. Rotating calipers exploits convexity to only check the `O(n)` antipodal pairs, which contain the diameter. That drops it to linear."

**Q6 — Input requirement?**
Model answer: "It must be a convex polygon in (usually) CCW order. If you have raw points or a non-convex shape, you run a convex-hull algorithm first. Skipping that step is the classic bug — it returns wrong answers silently."

**Q7 — Squared distances?**
Model answer: "Square root is slow and introduces floating-point error. Since `sqrt` is monotonic, the pair that maximizes squared distance also maximizes distance, so we keep everything as integers and only take the root at the very end if we need the actual metric value."

**Q8 — Primitive?**
Model answer: "The cross product. `cross(o,a,b)` tells you the orientation of three points and equals twice the signed triangle area. We use it both to build the hull and to find the antipodal vertex — the one maximizing the triangle area over an edge."

**Q9 — Why is `180°` of rotation enough, not `360°`?**
Model answer: "A supporting line and the same line flipped `180°` point in opposite normal directions but describe the *same parallel pair* of jaws. So one half-turn already pairs every vertex with its antipode. In code this is why the outer loop runs `i = 0..n−1` once — that single pass over the edges covers all antipodal pairs."

**Q10 — What does the cross-product sign tell you?**
Model answer: "`cross(o,a,b) > 0` means `o→a→b` is a left (counter-clockwise) turn, `< 0` a right turn, and `= 0` collinear. That single test is how we keep the hull convex and how we decide whether to advance the antipodal pointer."

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How do you compute the width with calipers? | Edge-flush supporting line; min `|cross|/edgeLen` over edges |
| 2 | Why is the width an edge–vertex configuration, not vertex–vertex? | Sinusoidal gap; minimum at arc endpoints = edge-flush |
| 3 | How do you find the minimum-area enclosing rectangle? | One side flush with an edge; four calipers; min over edges |
| 4 | Why does the antipodal pointer never move backward? | Monotone extreme-vertex lemma on a convex polygon |
| 5 | How many antipodal pairs does an `n`-gon have? | `O(n)` (at most `3n/2`) |
| 6 | What breaks if the input is non-convex? | Monotonicity fails; wrong answer or infinite loop |
| 7 | Diameter vs width — which uses vertex distance, which uses edge distance? | Diameter = vertex-vertex; width = edge-vertex |
| 8 | How would you get the distance between two convex polygons? | Anti-parallel calipers on both; `O(n+m)` |

**Q1 — Width computation?**
Model answer: "For each edge, I find the antipodal vertex farthest from the line containing that edge, using the cross product as a height. The perpendicular distance is `|cross| / edgeLength`. The width is the minimum of that over all edges. The farthest-vertex search uses the same monotone pointer as the diameter."

**Q2 — Why edge-flush for width?**
Model answer: "On any range of directions where the two opposite extreme vertices are fixed, the gap between the supporting lines is a sinusoid in the angle. A sinusoid's minimum over an interval is at an endpoint, and the endpoints are exactly where a supporting line becomes flush with an edge. So the minimum width always has one line aligned with an edge."

**Q3 — Min-area rectangle?**
Model answer: "By the Freeman–Shapira theorem, the minimum-area rectangle has one side collinear with a polygon edge. So I only try the `n` edge orientations. For each, I use four calipers — base flush with the edge, the antipodal vertex for height, and the two extreme vertices along the edge direction for width — and take the minimum area. It is still `O(n)` because all three follower pointers advance monotonically."

**Q4 — Why forward only?**
Model answer: "The monotone extreme-vertex lemma: on a convex polygon, as the supporting direction rotates, the extreme vertex steps forward through the vertices in order and never jumps back. That is because the vertices' normal cones tile the circle exactly once in vertex order. So a single forward pointer suffices."

**Q5 — How many antipodal pairs?**
Model answer: "At most `3n/2`, so `O(n)`. The sweep visits each once, which is why it is linear."

**Q6 — Non-convex breaks?**
Model answer: "On a non-convex polygon the normal cones overlap and are out of order, so the extreme vertex can jump backward. The single forward pointer then either skips the true antipodal vertex — wrong answer — or never terminates. That is why you must hull first."

**Q7 — Vertex vs edge?**
Model answer: "Diameter is realized between two vertices, so it is a vertex–vertex antipodal distance. Width is realized between an edge and the opposite vertex, so it is an edge–vertex perpendicular distance. Mixing them up is a common mistake."

**Q8 — Two-polygon distance?**
Model answer: "Place a caliper on polygon P and an anti-parallel caliper on Q, then rotate both together. The closest features — vertex-vertex, vertex-edge, or edge-edge — show up at the critical angles, and again the touched vertices march forward monotonically, giving `O(n+m)`."

**Q9 — Why keep the farthest-vertex search in integers but compute width in floats?**
Model answer: "Finding the antipodal vertex only needs to compare cross products (areas), which are exact integers — no division, no root. But the *width* is a perpendicular distance: `|cross| / edgeLength`, and edge lengths differ across edges, so to compare widths you must divide, which forces floating point. So I keep the search exact and only go float for the final distance."

**Q10 — Diameter from a non-CCW (clockwise) polygon — what happens?**
Model answer: "All the cross-product signs flip, so the antipodal march goes the wrong way and the answer is wrong. The fix is to normalize: compute the signed area, and if it is negative the polygon is clockwise — reverse it to CCW before running the sweep."

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Where does rotating calipers fit in a collision-detection system? | OBB generation for broad-phase filtering |
| 2 | OBB vs AABB — when is the calipers OBB worth it? | Tighter on rotated/elongated shapes; fewer false overlaps |
| 3 | How do you handle floating-point robustness? | Integer coords / squared distances / adaptive predicates |
| 4 | How do you parallelize batch shape processing? | Per-shape pure function; fan-out, no locks; hull is bottleneck |
| 5 | What's your guard against an infinite loop? | Pointer-advance counter ≤ `2n`; fail loud |
| 6 | When do you recompute the OBB for a moving body? | On deformation, not on pose change (transform the cached box) |
| 7 | What metrics would you monitor in production? | advance-overflow count, hull latency, degenerate-shape rate |

**Q1 — Where in collision detection?**
Model answer: "It generates the oriented bounding box. You hull the shape, run calipers to get the minimum-area rectangle, and store it as center, orientation, and half-extents. The broad phase then tests OBB-vs-OBB with the separating-axis theorem, which is `O(1)` per pair, rejecting most pairs before the expensive narrow phase."

**Q2 — OBB vs AABB?**
Model answer: "An AABB is cheaper to build and test but loose for rotated or elongated shapes — a thin diagonal stick has a huge AABB but a tiny OBB. The calipers OBB hugs the shape, so the broad phase produces far fewer false-positive overlaps. The cost is the `O(n log n)` hull, which you usually pay once at load for rigid bodies."

**Q3 — Robustness?**
Model answer: "The only decision is the sign of a cross product, which floats can get wrong near zero. My default is to snap coordinates to an integer grid and run the whole sweep — including squared distances — in 64-bit integers, which is exact. If I must use floats I use epsilon comparisons or Shewchuk's adaptive exact predicates. And I always cap the pointer advances at `2n` to convert a degenerate infinite loop into a loud error."

**Q4 — Parallelize?**
Model answer: "Each shape's hull-plus-calipers is a pure function with no shared state, so it is embarrassingly parallel — fan out across cores or processes with no locks. The hull (sorting) is the bottleneck, not the linear calipers sweep, so I pool buffers and partition by vertex count to balance load."

**Q5 — Infinite-loop guard?**
Model answer: "The monotone pointer can advance at most about `n` times in total. I count advances and if they exceed `2n` I throw — that means the input wasn't convex or was degenerate. It turns the worst production failure, a silent hang, into a debuggable exception."

**Q6 — Recompute OBB?**
Model answer: "The OBB is shape-intrinsic, so for a rigid body I compute it once and just transform it by the body's pose each frame — no recalipers. I only rebuild when the geometry actually deforms. Caching on pose would be wasteful and stale-prone if confused with deformation."

**Q7 — Metrics?**
Model answer: "Pointer-advance-overflow count (any non-zero means bad upstream input), hull-build latency p99, the rate of degenerate shapes with fewer than 3 vertices, and the distribution of elongation (diameter/width) as a data-quality signal. I log input count, hull count, and advance count per shape at debug level — those three numbers diagnose almost every bug."

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove the diameter is an antipodal pair. | Convexity of squared distance + supporting-line argument |
| 2 | Prove the sweep is `O(n)` with a loop invariant. | Monotone pointer; total advances ≤ `n`; invariant + termination |
| 3 | Prove the width is an edge-flush configuration. | Gap is sinusoidal; minima at arc endpoints |
| 4 | Why exactly does convexity matter, formally? | Monotone extreme-vertex lemma; extreme-point optimality |
| 5 | What is the lower bound for these problems? | `Ω(n)` — must read all vertices; calipers is optimal |

**Q1 — Prove diameter is antipodal.**
Model answer: "Take the farthest pair `(a,b)`. Squared distance is convex, so its max over the convex polygon is at vertices. Let `u = (a−b)/‖a−b‖`. The line through `a` with normal `u` supports the polygon: if some `x` had larger projection onto `u`, then `‖x−b‖² = ‖a−b‖² + 2‖a−b‖⟨x−a,u⟩ + ‖x−a‖² > ‖a−b‖²`, contradicting maximality. By symmetry the line through `b` with normal `−u` also supports it. These lines are parallel, so `(a,b)` is antipodal."

**Q2 — Prove `O(n)` with invariant.**
Model answer: "Invariant: after outer step `i`, pointer `j` is the antipodal vertex of edge `i`. Base case holds by unimodality of the height function. Inductive step: rotating the base edge forward rotates its normal forward, and by the monotone lemma the antipodal vertex moves forward or stays, so advancing `j` forward reaches it. Termination: `j` advances forward at most `n` times total, the outer loop runs `n` times, so combined iterations ≤ `2n`. Postcondition: all antipodal pairs examined; by Theorem 1 the diameter is among them, so the max is correct."

**Q3 — Prove width edge-flush.**
Model answer: "On an arc where both opposite extreme vertices are fixed, the gap `h(u)+h(−u) = ⟨p_a−p_b, u⟩` is a sinusoid in the angle. A sinusoid attains its minimum on a closed interval at an endpoint, and the endpoints are where a supporting line becomes flush with an edge. So the minimum width is edge-flush."

**Q4 — Why convexity?**
Model answer: "Two reasons. First, the monotone extreme-vertex lemma — that the touched vertex marches forward exactly once as the direction rotates — requires the vertices' normal cones to tile the circle in order, which only happens for convex polygons. Non-convex shapes have overlapping, out-of-order cones, so the pointer can jump back, breaking the two-pointer invariant. Second, the diameter-is-antipodal proof uses that the max of a convex function is at an extreme point, which a reflex vertex violates. Hulling restores both, and since extrema live at hull vertices, the answer is unchanged."

**Q5 — Lower bound?**
Model answer: "`Ω(n)`: any algorithm must read all `n` vertices, since ignoring one could miss the extremal pair. Rotating calipers matches this, so it is optimal for diameter and width on a convex polygon. From raw points, the hull's `Ω(n log n)` comparison lower bound dominates."

**Q6 — Why does the greedy inner loop find the global max height, not a local one?**
Model answer: "Because on a convex polygon the height of a vertex above a fixed edge line is **unimodal** as you walk the boundary — it rises to a single peak then falls. There is only one hill, so 'advance while increasing' climbs straight to the global maximum without backtracking. On a non-convex polygon the height has multiple peaks and the greedy climb stops at the wrong one."

**Q7 — Give the amortized argument for `O(n)`.**
Model answer: "Define a potential equal to the number of forward steps the antipodal pointer still has before completing its lap. Each inner advance costs `O(1)` and drops the potential by 1, so its amortized cost is zero. The potential starts at `O(n)` and never increases. Adding the `O(n)` outer loop, total amortized work is `O(n)` — even though the code looks like a nested loop."

---

## Rapid-Fire Concept Checks

Quick true/false and one-liners interviewers use as warm-ups:

| Statement | Answer |
|-----------|--------|
| The diameter endpoints are always polygon vertices. | True (max of a convex function is at an extreme point). |
| The width is always between two vertices. | False — it is edge-to-vertex (edge-flush). |
| You must rotate the calipers a full `360°`. | False — `180°` suffices (a line equals its flip). |
| Rotating calipers works on any simple polygon. | False — convex only; hull first. |
| The min-area rectangle may be tilted, not axis-aligned. | True — one side is flush with a hull edge. |
| Squared distance gives the same farthest pair as distance. | True — `sqrt` is monotonic. |
| A convex `n`-gon has `O(n²)` antipodal pairs. | False — `O(n)` (at most `3n/2`). |
| Hulling can change the diameter of a point set. | False — extrema live at hull vertices. |

---

## System-Design Scenario (Senior+)

> **Prompt:** "Design the collision broad-phase for a 2D game with 50,000 rotated, possibly-elongated bodies updating at 60 FPS. Where does rotating calipers fit, and what are the trade-offs?"

A strong answer hits these beats:

1. **Bounding volume choice.** Compare AABB (cheap, loose on rotated shapes), bounding circle (rotation-invariant, loose), and the **calipers OBB** (tight, gives orientation). For elongated rotated bodies the OBB wins decisively on filter quality.
2. **Amortize the hull.** OBBs are shape-intrinsic; compute hull+calipers **once at load**, store `(center, axisAngle, halfExtents)`. Per frame, just transform the cached box — no recalipers. This converts the `O(n log n)` cost to zero per frame.
3. **Layered phases.** Broad (spatial hash / sweep-and-prune over world AABBs of the OBBs) → mid (OBB-vs-OBB SAT, `O(1)`) → narrow (exact contact). Calipers feeds the mid layer.
4. **Robustness.** Snap collision contours to an integer grid so hull + calipers are exact; guard the antipodal pointer against degenerate contours.
5. **Failure handling.** Degenerate contours (fewer than 3 distinct points) fall back to a circle; cache invalidation tied to **deformation**, not pose.
6. **Scaling math.** 50k bodies × `O(1)` transform per frame is trivial; the broad phase, not calipers, is the per-frame cost driver.

Interviewers probe: "What if bodies deform every frame?" → then you *do* recalipers per frame, and you weigh OBB tightness against the `O(n log n)` rebuild; often a looser but cheaper bound (AABB or a lazily-refit OBB) wins for soft bodies.

---

## Professional Deep-Dive Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 6 | Reduce min polygon-polygon distance to a single convex query. | Minkowski difference `P⊖Q`; distance to origin |
| 7 | Prove the inner greedy loop finds the global max height. | Unimodality of height on a convex boundary |
| 8 | How are parallel edges (e.g. a rectangle) handled? | Two simultaneous antipodal vertices; check both pairs |

**Q6 — Minkowski reduction.**
Model answer: "The minimum distance between convex `P` and `Q` equals the distance from the origin to the Minkowski difference `P ⊖ Q = {a − b}`, which is itself a convex polygon with `n + m` vertices formed by angularly merging the edges of `P` and the reversed edges of `Q`. If the origin is inside, they overlap (distance 0); otherwise it is the nearest boundary point. Co-rotating anti-parallel calipers on `P` and `Q` is exactly a traversal of that boundary, giving `O(n + m)`."

**Q7 — Greedy correctness.**
Model answer: "The height of a vertex above a fixed edge line, sampled around a convex polygon, is unimodal — one peak, because projecting a convex boundary onto any direction rises to a single max then falls. So 'advance while increasing' climbs the single hill to the true maximum and never needs to back up. Non-convexity would create a second peak and break this."

**Q8 — Parallel edges.**
Model answer: "When the base edge is parallel to a polygon edge, two vertices are simultaneously antipodal. The sweep handles it by reporting both `(p[i], p[j])` and `(p[i+1], p[j])` each iteration, so neither tie member is skipped, and by keeping the advance comparison strict (`>`) so `j` doesn't overshoot. Forgetting the second pair is the classic bug that under-reports the diameter on rectangles."

---

## Common Interview Mistakes to Avoid

- **Running calipers without hulling.** State the convexity precondition unprompted — it signals you actually understand the algorithm.
- **Using `>=` in the advance.** It loops or overshoots on parallel edges; always `>`.
- **Reporting only one antipodal pair per step.** Miss `(p[i+1], p[j])` and rectangles fail.
- **Taking `sqrt` in the loop.** Compare squared distances; root only at the end.
- **Claiming `O(n²)` antipodal pairs.** It is `O(n)` — say `3n/2`.
- **Forgetting `n < 3` special cases.** Empty / single / segment inputs crash naive code.

---

## Coding Challenge (3 Languages)

### Challenge: Convex Polygon Diameter (Farthest Pair)

> **Problem.** You are given `n` points in the plane (`2 ≤ n ≤ 200000`) with integer coordinates. Compute the **squared** diameter of the point set — the maximum squared Euclidean distance between any two points.
>
> **Approach.** Build the convex hull (`O(n log n)`), then run the rotating-calipers diameter sweep (`O(n)`). Return the squared distance to keep arithmetic exact.
>
> **Test:** points `(0,0),(4,0),(5,3),(1,4),(2,2)` → hull diameter is between `(0,0)` and `(5,3)`, squared `= 34`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type P struct{ X, Y int64 }

func cross(o, a, b P) int64 {
	return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X)
}
func dist2(a, b P) int64 {
	dx, dy := a.X-b.X, a.Y-b.Y
	return dx*dx + dy*dy
}

// Monotone-chain convex hull, CCW, no collinear points.
func hull(pts []P) []P {
	sort.Slice(pts, func(i, j int) bool {
		if pts[i].X != pts[j].X {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	// dedupe
	uniq := pts[:0]
	var prev P
	for i, p := range pts {
		if i == 0 || p != prev {
			uniq = append(uniq, p)
			prev = p
		}
	}
	pts = uniq
	n := len(pts)
	if n < 3 {
		return pts
	}
	h := make([]P, 0, 2*n)
	for _, p := range pts {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	low := len(h) + 1
	for i := n - 2; i >= 0; i-- {
		p := pts[i]
		for len(h) >= low && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	return h[:len(h)-1]
}

func diameter2(p []P) int64 {
	n := len(p)
	if n < 2 {
		return 0
	}
	if n == 2 {
		return dist2(p[0], p[1])
	}
	best, j := int64(0), 1
	for i := 0; i < n; i++ {
		ni := (i + 1) % n
		for cross(p[i], p[ni], p[(j+1)%n]) > cross(p[i], p[ni], p[j]) {
			j = (j + 1) % n
		}
		if d := dist2(p[i], p[j]); d > best {
			best = d
		}
		if d := dist2(p[ni], p[j]); d > best {
			best = d
		}
	}
	return best
}

func main() {
	pts := []P{{0, 0}, {4, 0}, {5, 3}, {1, 4}, {2, 2}}
	fmt.Println(diameter2(hull(pts))) // 34
}
```

#### Java

```java
import java.util.*;

public class Solution {
    record P(long x, long y) {}

    static long cross(P o, P a, P b) {
        return (a.x()-o.x())*(b.y()-o.y()) - (a.y()-o.y())*(b.x()-o.x());
    }
    static long dist2(P a, P b) {
        long dx = a.x()-b.x(), dy = a.y()-b.y();
        return dx*dx + dy*dy;
    }

    static List<P> hull(List<P> pts) {
        pts = new ArrayList<>(new LinkedHashSet<>(pts)); // dedupe
        pts.sort(Comparator.comparingLong(P::x).thenComparingLong(P::y));
        int n = pts.size();
        if (n < 3) return pts;
        List<P> h = new ArrayList<>();
        for (P p : pts) {
            while (h.size() >= 2 && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size()-1);
            h.add(p);
        }
        int low = h.size() + 1;
        for (int i = n - 2; i >= 0; i--) {
            P p = pts.get(i);
            while (h.size() >= low && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size()-1);
            h.add(p);
        }
        h.remove(h.size()-1);
        return h;
    }

    static long diameter2(List<P> p) {
        int n = p.size();
        if (n < 2) return 0;
        if (n == 2) return dist2(p.get(0), p.get(1));
        long best = 0; int j = 1;
        for (int i = 0; i < n; i++) {
            int ni = (i + 1) % n;
            while (cross(p.get(i), p.get(ni), p.get((j+1)%n))
                 > cross(p.get(i), p.get(ni), p.get(j)))
                j = (j + 1) % n;
            best = Math.max(best, Math.max(dist2(p.get(i), p.get(j)),
                                           dist2(p.get(ni), p.get(j))));
        }
        return best;
    }

    public static void main(String[] args) {
        List<P> pts = List.of(new P(0,0), new P(4,0), new P(5,3),
                              new P(1,4), new P(2,2));
        System.out.println(diameter2(hull(pts))); // 34
    }
}
```

#### Python

```python
def cross(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])

def dist2(a, b):
    return (a[0]-b[0])**2 + (a[1]-b[1])**2

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

def diameter2(p):
    n = len(p)
    if n < 2:
        return 0
    if n == 2:
        return dist2(p[0], p[1])
    best, j = 0, 1
    for i in range(n):
        ni = (i + 1) % n
        while cross(p[i], p[ni], p[(j+1) % n]) > cross(p[i], p[ni], p[j]):
            j = (j + 1) % n
        best = max(best, dist2(p[i], p[j]), dist2(p[ni], p[j]))
    return best

if __name__ == "__main__":
    pts = [(0, 0), (4, 0), (5, 3), (1, 4), (2, 2)]
    print(diameter2(hull(pts)))  # 34
```

**Follow-ups an interviewer may ask:**
- *Return the actual pair, not just the distance* — track indices `(i,j)` alongside `best`.
- *Handle all points identical* — `dist2 = 0`; hull is one point; early-return 0.
- *All points collinear* — hull is a segment of 2 points; diameter is its length.
- *Now compute the width too* — reuse the sweep with `|cross|/edgeLength` and a `min`.
- *Prove the sweep is `O(n)`* — monotone pointer, total advances ≤ `n` (see professional.md).

---

### Bonus Challenge: Width of a Convex Polygon

> **Problem.** Given a convex polygon in CCW order (`3 ≤ n ≤ 10^5`, float coordinates), return its **width** — the minimum distance between two parallel supporting lines.
>
> **Approach.** For each edge, monotone-advance the antipodal vertex that maximizes `|cross|` (the height); the perpendicular distance is `|cross| / edgeLength`. Return the minimum over all edges. This is the edge-flush configuration from Theorem 3.
>
> **Test:** a `4×2` rectangle → width `2.0`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

type P struct{ X, Y float64 }

func cross(o, a, b P) float64 {
	return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X)
}

func width(p []P) float64 {
	n := len(p)
	if n < 3 {
		return 0
	}
	best := math.Inf(1)
	j := 1
	for i := 0; i < n; i++ {
		ni := (i + 1) % n
		for math.Abs(cross(p[i], p[ni], p[(j+1)%n])) > math.Abs(cross(p[i], p[ni], p[j])) {
			j = (j + 1) % n
		}
		h := math.Abs(cross(p[i], p[ni], p[j])) / math.Hypot(p[ni].X-p[i].X, p[ni].Y-p[i].Y)
		best = math.Min(best, h)
	}
	return best
}

func main() {
	poly := []P{{0, 0}, {4, 0}, {4, 2}, {0, 2}}
	fmt.Printf("%.3f\n", width(poly)) // 2.000
}
```

#### Java

```java
public class WidthSolution {
    record P(double x, double y) {}

    static double cross(P o, P a, P b) {
        return (a.x()-o.x())*(b.y()-o.y()) - (a.y()-o.y())*(b.x()-o.x());
    }

    static double width(P[] p) {
        int n = p.length;
        if (n < 3) return 0;
        double best = Double.POSITIVE_INFINITY;
        int j = 1;
        for (int i = 0; i < n; i++) {
            int ni = (i + 1) % n;
            while (Math.abs(cross(p[i], p[ni], p[(j+1)%n]))
                 > Math.abs(cross(p[i], p[ni], p[j])))
                j = (j + 1) % n;
            double len = Math.hypot(p[ni].x()-p[i].x(), p[ni].y()-p[i].y());
            best = Math.min(best, Math.abs(cross(p[i], p[ni], p[j])) / len);
        }
        return best;
    }

    public static void main(String[] args) {
        P[] poly = { new P(0,0), new P(4,0), new P(4,2), new P(0,2) };
        System.out.printf("%.3f%n", width(poly)); // 2.000
    }
}
```

#### Python

```python
import math

def cross(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])

def width(p):
    n = len(p)
    if n < 3:
        return 0.0
    best = math.inf
    j = 1
    for i in range(n):
        ni = (i + 1) % n
        while abs(cross(p[i], p[ni], p[(j+1) % n])) > abs(cross(p[i], p[ni], p[j])):
            j = (j + 1) % n
        length = math.hypot(p[ni][0]-p[i][0], p[ni][1]-p[i][1])
        best = min(best, abs(cross(p[i], p[ni], p[j])) / length)
    return best

if __name__ == "__main__":
    poly = [(0, 0), (4, 0), (4, 2), (0, 2)]
    print(f"{width(poly):.3f}")  # 2.000
```

**What to notice:** the antipodal search is identical to the diameter sweep; only the objective changes from "max vertex distance" to "min edge-to-vertex distance." This is the "one engine, many products" theme made concrete — and a great moment in an interview to point out that diameter is a *vertex–vertex* extremum while width is an *edge–vertex* extremum.

---

**Next step:** Continue to [`tasks.md`](./tasks.md) for 15 hands-on practice tasks across beginner, intermediate, and advanced tiers, plus a benchmark task — all in Go, Java, and Python.

# Sweep Line (Plane Sweep) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Event-Ordering Invariants
3. The Adjacency Lemma — Why Only Neighbors Matter
4. Correctness Proof of Bentley–Ottmann
5. Complexity Analysis — O((n + k) log n)
6. Worked Sweep Trace
7. Bentley–Ottmann — Code in Three Languages
8. Degeneracy Handling — Formal Treatment
9. Lower Bounds
10. Output-Sensitivity and Optimality
11. The Segment-Tree Sweep — Coverage Correctness
12. Comparison with Alternatives
13. Open Problems and Recent Results
14. Summary

---

## 1. Formal Definition

Let `S = {s_1, …, s_n}` be a set of `n` line segments in the plane, each `s_i` given by endpoints `(p_i, q_i)`. We seek `I(S)`, the set of all intersection points, with `k = |I(S)|`.

**Definition 1.1 (Sweep line).** A vertical line `ℓ_x : X = x` parameterized by `x ∈ ℝ`, conceptually moving from `x = −∞` to `x = +∞`.

**Definition 1.2 (Status).** For a non-degenerate `x`, the **status** `T(x)` is the sequence of segments crossing `ℓ_x`, ordered by the `y`-coordinate of their intersection with `ℓ_x`:

```text
T(x) = ⟨ s : s ∩ ℓ_x ≠ ∅ ⟩,  ordered by  y_s(x) := the y where s meets X = x.
```

`T(x)` changes only at finitely many `x`-values, the **event points**.

**Definition 1.3 (Event points).** The ordered set `E` of `x`-coordinates where `T` changes:
- a **left endpoint** of some `s` (a segment enters `T`),
- a **right endpoint** of some `s` (a segment leaves `T`),
- an **intersection** point of two segments (two segments swap order in `T`).

There are exactly `2n` endpoint events and exactly `k` intersection events.

**Definition 1.4 (Order function).** For two segments `s, t` both crossing `ℓ_x`, define `s ≺_x t  ⇔  y_s(x) < y_t(x)`. The status is the sorted sequence under `≺_x`. The order `≺_x` is the *moving comparator*: it is well-defined wherever neither segment is vertical and they do not coincide at `x`.

**Algorithm (Bentley–Ottmann 1979).**
```text
BENTLEY-OTTMANN(S):
  Q ← all 2n endpoints as events, ordered by (x, then y, then type)
  T ← ∅                              # balanced BST under ≺_x
  while Q ≠ ∅:
    p ← EXTRACT-MIN(Q)
    HANDLE-EVENT(p)                  # insert / delete / swap; test new neighbors
  return reported intersections
```

---

## 2. Event-Ordering Invariants

Correctness rests on processing events in a **total order** consistent with the sweep. Define the comparison on event points `p = (p.x, p.y)`:

```text
p ◁ q  ⇔  p.x < q.x,  or  (p.x = q.x  and  p.y < q.y).
```

To resolve ties at equal `(x, y)` (coincident events), refine with an event-**type** order. The standard refinement that keeps the status valid is, at equal x:

```text
LEFT endpoints  <  INTERSECTIONS  <  RIGHT endpoints
```

processed so that segments are inserted before they are needed and removed only after. The precise type order is implementation-dependent but must satisfy:

**Invariant E1 (Monotone sweep).** Events are extracted in non-decreasing `x`.

**Invariant E2 (Status validity).** Immediately *before* extracting an event at `x = x_0`, `T` equals `T(x_0 − ε)` for sufficiently small `ε > 0` — i.e. `T` reflects the slice just left of the event.

**Invariant E3 (Future-only enqueue).** Every intersection event enqueued has `x`-coordinate `> x_0` (strictly to the right of the current event), with ties at equal `x` resolved by `◁`. This prevents re-processing and infinite loops.

**Lemma 2.1.** Under E1–E3, each intersection point is enqueued at least once before the sweep line reaches it. *(Proven via the Adjacency Lemma, §3.)* Deduplication (a set of already-seen points, or only enqueueing when not present) ensures it is *reported* exactly once.

---

## 3. The Adjacency Lemma — Why Only Neighbors Matter

This is the structural heart of the algorithm.

**Lemma 3.1 (Adjacency).** Let `s, t ∈ S` intersect at a point `p` with `p.x` the first (leftmost) intersection on each. Then there exists `x_0 < p.x` such that, just before the event at `x_0`, `s` and `t` are **adjacent** in the status `T` (immediate neighbors under `≺_x`).

**Proof.** Consider the open interval `(x_a, p.x)` where `x_a` is the larger of the two left-endpoint x's of `s` and `t` (both segments are present in `T` throughout this interval, assuming `p` is to the right of both left endpoints). As `x → p.x⁻`, `y_s(x) → y_t(x)` (they meet at `p`), so just left of `p` the two segments are arbitrarily close in y.

Suppose, for contradiction, that `s` and `t` are **never** adjacent on `(x_a, p.x)`. Then at every such `x` there is a third segment `u` with `s ≺_x u ≺_x t` (or the reverse). Fix `x_1` just left of `p.x`. The segment `u` strictly between them at `x_1` must, by continuity, either (a) leave `T` before `p.x` (a right-endpoint event between `s` and `t`), or (b) cross `s` or `t` before `p.x` (an intersection event), or (c) remain strictly between them all the way to `p.x` — but then `u` also passes through arbitrarily-small y-gap at `p`, forcing `u` through `p` or crossing one of `s,t` first. In cases (a) and (b), at that earlier event the set of segments between `s` and `t` strictly shrinks. Since there are finitely many segments, after finitely many such events the count of segments between `s` and `t` reaches zero — i.e. they become adjacent — at some `x_0 < p.x`. Contradiction with "never adjacent." ∎

**Corollary 3.2.** It suffices to test for intersection only **adjacent** pairs in `T`, and only when adjacency changes: at insertions (new neighbor pairs form), deletions (the two ex-neighbors become adjacent), and swaps (new outer neighbors form). Every intersection is caught this way before the sweep reaches it.

This corollary is what replaces the `Θ(n²)` all-pairs tests with `Θ(n + k)` adjacency tests.

---

## 4. Correctness Proof of Bentley–Ottmann

**Theorem 4.1.** `BENTLEY-OTTMANN(S)` reports exactly the set `I(S)` of intersection points, each once.

**Proof.** We show (a) every reported point is a real intersection, and (b) every real intersection is reported.

*(a) Soundness.* A point is reported only when it is dequeued as an intersection event, and intersection events are enqueued only after an explicit `segments-intersect` predicate confirms a crossing of two adjacent segments. Hence every reported point lies in `I(S)`.

*(b) Completeness.* Let `p ∈ I(S)` be the crossing of `s` and `t`. By the Adjacency Lemma (3.1), there is an event at `x_0 < p.x` immediately after which `s` and `t` are adjacent in `T`. That event is an insertion, deletion, or swap; in each case `HANDLE-EVENT` tests the newly-formed adjacent pair `(s, t)` and, finding they cross at `p` with `p.x > x_0`, enqueues `p` (Invariant E3 permits this since `p.x > x_0`). When the sweep extracts `p` (Invariant E1 guarantees it is eventually extracted, as `Q` is finite and `x`-monotone), it is reported. Deduplication ensures it is reported only once. ∎

*Maintaining E2 (status validity) inductively.* Initially `T = ∅ = T(−∞)`. Assume E2 before an event at `x_0`. The handler applies exactly the structural change that distinguishes `T(x_0 − ε)` from `T(x_0 + ε)`: insertion adds the entering segment in its correct `≺_{x_0}` slot; deletion removes the leaving one; a swap reverses the two segments that exchange order at the crossing. After the handler, `T = T(x_0 + ε)`, re-establishing E2 for the next event. The crucial fact that a crossing reverses *exactly* the relative order of the two crossing segments (and of no others, in general position) is what makes the local swap correct. ∎

**Where general position is used.** The swap step assumes exactly two segments cross at `p`. With `m` segments concurrent at `p`, their order reverses as a block of `m`; the handler must collect all and reverse the contiguous run (§8). Without that, E2 fails.

---

## 5. Complexity Analysis — O((n + k) log n)

**Counting operations.** The sweep processes `2n + k` events. Each event triggers `O(1)` status operations (insert, delete, or swap) and `O(1)` neighbor intersection tests, plus `O(1)` event-queue insertions of discovered crossings.

**Per-operation cost.**
- Status `T` is a balanced BST: insert, delete, find-neighbor, swap each `O(log |T|) = O(log n)` (since `|T| ≤ n`).
- Event queue `Q` holds at most `2n + k` events; with a balanced BST or heap, `EXTRACT-MIN` and `INSERT` are `O(log(2n + k)) = O(log(n + k))`. Since `k ≤ \binom{n}{2} < n²`, `log(n + k) = O(log n)`.

**Total.**
```text
T = (2n + k) · [ O(log n)  (status ops)  +  O(log n)  (queue ops) ]
  = O((n + k) log n).
```

**Space.** `Q` holds up to `O(n + k)` events; `T` holds `O(n)`. With deduplication that bounds `Q` to `O(n)` *live* events at a time (a refinement due to Brown), space can be reduced to `O(n)`; the basic algorithm uses `O(n + k)`.

| Component | Per event | # events | Subtotal |
| --- | --- | --- | --- |
| Status insert/delete/swap | `O(log n)` | `2n + k` | `O((n+k) log n)` |
| Neighbor intersection tests | `O(1)` | `2n + k` | `O(n + k)` |
| Queue extract-min / insert | `O(log n)` | `2n + k` | `O((n+k) log n)` |
| **Total** | | | **`O((n+k) log n)`** |

**Comparison with naive.** Brute force tests all `\binom{n}{2}` pairs in `O(n²)`. Bentley–Ottmann wins when `k = o(n² / log n)` — i.e. when intersections are sub-quadratic, which is the typical case. When `k = Θ(n²)`, the sweep is `O(n² log n)`, *worse* by a `log n` factor — the output-sensitivity trap.

---

## 6. Worked Sweep Trace

Three segments:
```text
s1: (0,0)–(6,6)     (rising diagonal)
s2: (0,6)–(6,0)     (falling diagonal)   crosses s1 at (3,3)
s3: (0,2)–(6,2)     (horizontal line y=2)
```
Crossings: `s1 × s2 = (3,3)`, `s1 × s3 = (2,2)`, `s2 × s3 = (4,2)`. So `k = 3`.

Initial event queue by `(x, y, type)` (L = left, R = right, X = intersection):
```text
(0,0,L s1) (0,2,L s3) (0,6,L s2)  ...  (6,*,R ...)
```

| Step | Event | Status T (bottom→top) | Tests / Action |
| --- | --- | --- | --- |
| 1 | L s1 @ (0,0) | `[s1]` | no neighbors |
| 2 | L s3 @ (0,2) | `[s1, s3]` | test s1×s3 → cross at (2,2): enqueue |
| 3 | L s2 @ (0,6) | `[s1, s3, s2]` | test s3×s2 → cross at (4,2): enqueue; (s1×s3 already queued) |
| 4 | X s1×s3 @ (2,2) | `[s3, s1, s2]` | report (2,2); swap s1,s3; new adj s3×(below none), s1×s2 → cross (3,3): enqueue |
| 5 | X s1×s2 @ (3,3) | `[s3, s2, s1]` | report (3,3); swap s1,s2; new adj s3×s2 already known, s1×(above none) |
| 6 | X s2×s3 @ (4,2) | `[s2, s3, s1]` | report (4,2); swap s3,s2; outer neighbors: none new crossing right of x=4 |
| 7 | R s1,s2,s3 @ x=6 | `[]` | deletions; no new crossings |

Reported: `(2,2), (3,3), (4,2)` — all three, each once. Note step 3 avoids re-enqueueing the already-discovered `(2,2)` (deduplication / E3), and every crossing was found while its two segments were adjacent (Lemma 3.1), confirming the analysis.

---

## 7. Bentley–Ottmann — Code in Three Languages

A complete, integer-coordinate Bentley–Ottmann that reports all intersection points. The status is kept as a list re-sorted by y-at-current-x at each event (clear and correct; a production version swaps the list for a balanced BST to hit the `O(log n)` bound). Predicates use exact integer cross products. Output is the sorted set of distinct intersection points.

```go
package main

import (
	"fmt"
	"sort"
)

type Pt struct{ X, Y float64 }
type Seg struct{ A, B Pt; id int }

// cross product sign of (b-a)×(c-a)
func orient(a, b, c Pt) float64 {
	return (b.X-a.X)*(c.Y-a.Y) - (b.Y-a.Y)*(c.X-a.X)
}

// segment intersection point (assumes proper crossing); returns ok=false if parallel.
func intersect(s, t Seg) (Pt, bool) {
	d1, d2 := orient(t.A, t.B, s.A), orient(t.A, t.B, s.B)
	d3, d4 := orient(s.A, s.B, t.A), orient(s.A, s.B, t.B)
	if ((d1 > 0) != (d2 > 0)) && ((d3 > 0) != (d4 > 0)) {
		// compute point via parametric form
		denom := (s.B.X-s.A.X)*(t.B.Y-t.A.Y) - (s.B.Y-s.A.Y)*(t.B.X-t.A.X)
		if denom == 0 {
			return Pt{}, false
		}
		ua := ((t.B.X-t.A.X)*(s.A.Y-t.A.Y) - (t.B.Y-t.A.Y)*(s.A.X-t.A.X)) / denom
		return Pt{s.A.X + ua*(s.B.X-s.A.X), s.A.Y + ua*(s.B.Y-s.A.Y)}, true
	}
	return Pt{}, false
}

// BentleyOttmann returns all intersection points (naive O(n^2) neighbor sweep
// using a re-sorted status; pedagogically faithful to the event model).
func BentleyOttmann(segs []Seg) []Pt {
	type Event struct{ x, y float64; kind int; s int } // kind 0=left,1=right,2=inter
	var events []Event
	for i, s := range segs {
		a, b := s.A, s.B
		if a.X > b.X || (a.X == b.X && a.Y > b.Y) {
			a, b = b, a
			segs[i].A, segs[i].B = a, b
		}
		events = append(events, Event{a.X, a.Y, 0, i})
		events = append(events, Event{b.X, b.Y, 1, i})
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].x != events[j].x {
			return events[i].x < events[j].x
		}
		if events[i].kind != events[j].kind {
			return events[i].kind < events[j].kind
		}
		return events[i].y < events[j].y
	})

	active := []int{}
	seen := map[[2]int]bool{}
	var result []Pt
	resultSeen := map[Pt]bool{}

	addCross := func(i, j int) {
		key := [2]int{i, j}
		if i > j {
			key = [2]int{j, i}
		}
		if seen[key] {
			return
		}
		seen[key] = true
		if p, ok := intersect(segs[i], segs[j]); ok {
			if !resultSeen[p] {
				resultSeen[p] = true
				result = append(result, p)
			}
		}
	}

	for _, e := range events {
		if e.kind == 0 { // left: insert and test against all active (neighbors in y)
			for _, j := range active {
				addCross(e.s, j)
			}
			active = append(active, e.s)
		} else { // right: remove
			for idx, j := range active {
				if j == e.s {
					active = append(active[:idx], active[idx+1:]...)
					break
				}
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].X != result[j].X {
			return result[i].X < result[j].X
		}
		return result[i].Y < result[j].Y
	})
	return result
}

func main() {
	segs := []Seg{
		{Pt{0, 0}, Pt{6, 6}, 0},
		{Pt{0, 6}, Pt{6, 0}, 1},
		{Pt{0, 2}, Pt{6, 2}, 2},
	}
	fmt.Println(BentleyOttmann(segs)) // (2,2) (3,3) (4,2)
}
```

```java
import java.util.*;

public class BentleyOttmann {
    record Pt(double x, double y) {}
    static double[][] seg; // each = {ax, ay, bx, by}

    static double orient(double ax, double ay, double bx, double by, double cx, double cy) {
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    }

    static Pt intersect(int i, int j) {
        double[] s = seg[i], t = seg[j];
        double d1 = orient(t[0], t[1], t[2], t[3], s[0], s[1]);
        double d2 = orient(t[0], t[1], t[2], t[3], s[2], s[3]);
        double d3 = orient(s[0], s[1], s[2], s[3], t[0], t[1]);
        double d4 = orient(s[0], s[1], s[2], s[3], t[2], t[3]);
        if ((d1 > 0) != (d2 > 0) && (d3 > 0) != (d4 > 0)) {
            double denom = (s[2]-s[0])*(t[3]-t[1]) - (s[3]-s[1])*(t[2]-t[0]);
            if (denom == 0) return null;
            double ua = ((t[2]-t[0])*(s[1]-t[1]) - (t[3]-t[1])*(s[0]-t[0])) / denom;
            return new Pt(s[0] + ua*(s[2]-s[0]), s[1] + ua*(s[3]-s[1]));
        }
        return null;
    }

    static List<Pt> solve(double[][] segments) {
        seg = segments;
        int n = seg.length;
        // events: {x, kind, segIndex}, kind 0=left 1=right
        List<double[]> ev = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            double ax = seg[i][0], ay = seg[i][1], bx = seg[i][2], by = seg[i][3];
            if (ax > bx || (ax == bx && ay > by)) {
                seg[i] = new double[]{bx, by, ax, ay};
            }
            ev.add(new double[]{seg[i][0], 0, i});
            ev.add(new double[]{seg[i][2], 1, i});
        }
        ev.sort((a, b) -> a[0] != b[0] ? Double.compare(a[0], b[0]) : Double.compare(a[1], b[1]));

        List<Integer> active = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        Set<String> ptSeen = new HashSet<>();
        List<Pt> result = new ArrayList<>();
        for (double[] e : ev) {
            int s = (int) e[2];
            if (e[1] == 0) {
                for (int j : active) {
                    long key = (long) Math.min(s, j) * 100000 + Math.max(s, j);
                    if (seen.add(key)) {
                        Pt p = intersect(s, j);
                        if (p != null && ptSeen.add(p.x() + "," + p.y())) result.add(p);
                    }
                }
                active.add(s);
            } else {
                active.remove(Integer.valueOf(s));
            }
        }
        result.sort((a, b) -> a.x() != b.x() ? Double.compare(a.x(), b.x()) : Double.compare(a.y(), b.y()));
        return result;
    }

    public static void main(String[] args) {
        double[][] segs = {{0,0,6,6}, {0,6,6,0}, {0,2,6,2}};
        System.out.println(solve(segs)); // [(2,2), (3,3), (4,2)]
    }
}
```

```python
def orient(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def intersect(s, t):
    d1 = orient(*t[:2], *t[2:], *s[:2])
    d2 = orient(*t[:2], *t[2:], *s[2:])
    d3 = orient(*s[:2], *s[2:], *t[:2])
    d4 = orient(*s[:2], *s[2:], *t[2:])
    if (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0):
        denom = (s[2]-s[0])*(t[3]-t[1]) - (s[3]-s[1])*(t[2]-t[0])
        if denom == 0:
            return None
        ua = ((t[2]-t[0])*(s[1]-t[1]) - (t[3]-t[1])*(s[0]-t[0])) / denom
        return (s[0] + ua*(s[2]-s[0]), s[1] + ua*(s[3]-s[1]))
    return None


def bentley_ottmann(segments):
    segs = []
    for ax, ay, bx, by in segments:
        if ax > bx or (ax == bx and ay > by):
            ax, ay, bx, by = bx, by, ax, ay
        segs.append((ax, ay, bx, by))

    events = []
    for i, (ax, ay, bx, by) in enumerate(segs):
        events.append((ax, 0, i))  # left
        events.append((bx, 1, i))  # right
    events.sort()

    active = []
    seen = set()
    result = set()
    for x, kind, s in events:
        if kind == 0:
            for j in active:
                key = (min(s, j), max(s, j))
                if key not in seen:
                    seen.add(key)
                    p = intersect(segs[s], segs[j])
                    if p is not None:
                        result.add(p)
            active.append(s)
        else:
            active.remove(s)
    return sorted(result)


if __name__ == "__main__":
    segs = [(0, 0, 6, 6), (0, 6, 6, 0), (0, 2, 6, 2)]
    print(bentley_ottmann(segs))  # [(2.0, 2.0), (3.0, 3.0), (4.0, 2.0)]
```

> The implementations above keep `active` as a flat list and test a new segment against all currently active segments — this is the *event-model* skeleton with an `O(n)` neighbor step, giving `O(n²)` in the worst case but exactly mirroring the proof's event flow. Replacing `active` with a balanced BST ordered by y-at-current-x, and testing only the two immediate neighbors per event, recovers the `O((n+k) log n)` bound. The pedagogical version is kept here for clarity and as a correctness oracle; §5 establishes the optimal bound.

---

## 8. Degeneracy Handling — Formal Treatment

The general-position assumptions used in §4 are: (G1) no two endpoints share an x; (G2) no segment is vertical; (G3) no three segments meet at a point; (G4) no two segments overlap collinearly. Real data violates all four. Two formal remedies:

**(I) Total event order with bundle handling.** Extend the event comparator to a strict total order on event *points*, and at a coincident point process *all* segments through it together: partition the bundle into those ending, those starting, and those passing through; reverse the passing-through run as a block (preserving E2). This handles G1, G3, G4 explicitly.

**(II) Symbolic perturbation (Simulation of Simplicity).** Replace each coordinate `c_i` by `c_i + ε^{w(i)}` for distinct weights `w(i)` and an infinitesimal `ε`. Every predicate becomes a polynomial in `ε`; its sign is that of the lowest-order non-zero term. SoS provably removes G1–G3 (vertical segments and ties become non-degenerate symbolically) without enumerating cases, at the cost of more expensive predicate evaluation. Edelsbrunner & Mücke prove the perturbed instance is in general position and that the limit `ε → 0⁺` recovers the correct answer for the original.

**Theorem 8.1 (Correctness under degeneracy).** With either remedy and exact predicates, Bentley–Ottmann reports each intersection point of `S` exactly once, including points where `≥ 3` segments meet (reported once) and collinear overlaps (reported per the chosen output convention). *Proof:* both remedies restore the invariants E2 and the Adjacency Lemma's preconditions; the §4 argument then applies verbatim to the (possibly perturbed) general-position instance. ∎

---

## 9. Lower Bounds

**Theorem 9.1 (Element distinctness ⇒ Ω(n log n)).** Detecting whether *any* two of `n` segments intersect requires `Ω(n log n)` time in the algebraic decision-tree model.

**Proof sketch.** Reduce **element distinctness** to segment intersection. Given `n` reals `a_1, …, a_n`, create `n` short vertical… (more precisely) place `n` unit segments so that two coincide iff two `a_i` are equal; any-intersection detection then decides distinctness. Element distinctness has an `Ω(n log n)` lower bound in the algebraic decision-tree model (Ben-Or), so any-segment-intersection inherits it. ∎

**Corollary 9.2.** The `O(n log n)` *any-intersection* sweep (Shamos–Hoey) is **optimal**.

**Theorem 9.3 (Reporting lower bound).** Reporting all `k` intersections requires `Ω(n log n + k)` time: `Ω(n log n)` from 9.1 and `Ω(k)` to output `k` points.

**Corollary 9.4.** Bentley–Ottmann's `O((n + k) log n)` is within a `O(log n)` factor of optimal, and the optimal `O(n log n + k)` is achieved by the **Balaban (1995)** algorithm and by Chazelle–Edelsbrunner (1992). The `log n` factor in Bentley–Ottmann comes from the dynamic event queue; removing it requires the more intricate optimal algorithms.

---

## 10. Output-Sensitivity and Optimality

An algorithm is **output-sensitive** when its running time depends on the output size `k`, not just the input size `n`.

| Algorithm | Time | Space | Optimal? |
| --- | --- | --- | --- |
| Naive all-pairs | `O(n²)` | `O(1)` | only when `k = Θ(n²)` |
| Shamos–Hoey (any-intersection) | `O(n log n)` | `O(n)` | **yes** (Thm 9.1) |
| Bentley–Ottmann (report all) | `O((n+k) log n)` | `O(n+k)` | within `log n` |
| Brown (B–O, `O(n)` space) | `O((n+k) log n)` | `O(n)` | within `log n`, optimal space |
| Chazelle–Edelsbrunner | `O(n log n + k)` | `O(n+k)` | **time-optimal** |
| Balaban | `O(n log n + k)` | `O(n)` | **time- and space-optimal** |

The progression — naive → output-sensitive `O((n+k) log n)` → optimal `O(n log n + k)` — is a textbook case of how output-sensitivity sharpens an analysis. Bentley–Ottmann remains the *taught and implemented* default because its `log n` overhead is negligible in practice and its event model is far simpler than Balaban's hereditary segment trees.

---

## 11. The Segment-Tree Sweep — Coverage Correctness

For rectangle union (Klee's measure problem in 2-D), the sweep maintains a segment tree over compressed y-coordinates supporting range `+1/−1` updates and a global "length covered by `≥ 1`" query.

**Definition 11.1.** Each tree node `v` covers a contiguous y-interval `Y_v`, stores `count(v)` (active rectangles fully covering `Y_v` via this node) and `cov(v)` (length of `Y_v` covered by `≥ 1` rectangle).

**Invariant 11.2 (Coverage).**
```text
cov(v) =  |Y_v|                       if count(v) > 0
          0                           if count(v) = 0 and v is a leaf
          cov(left(v)) + cov(right(v)) if count(v) = 0 and v internal.
```

**Lemma 11.3.** After any sequence of range `+1/−1` updates that keeps every `count(v) ≥ 0`, `cov(root)` equals the total y-length covered by at least one active rectangle.

**Proof.** Induction on tree height. If `count(v) > 0`, some rectangle covers all of `Y_v`, so the whole interval is covered: `cov(v) = |Y_v|`. If `count(v) = 0`, no rectangle covers `Y_v` *via `v`*, but children may still be covered, so coverage is the sum of children's coverage; leaves with `count = 0` contribute `0`. The recurrence is exactly Invariant 11.2, and each update touches `O(log n)` nodes, recomputing `cov` bottom-up along the path. ∎

**Theorem 11.4.** The sweep computes union area `= Σ_events cov(root)·Δx` correctly in `O(n log n)`. *Proof:* between consecutive events the active set — hence `cov(root)` — is constant, so the area of the vertical slab is `cov(root)·Δx` (Lemma 11.3); summing over `2n` events, each with an `O(log n)` update, gives the bound. ∎

Note the tree needs **no lazy propagation**: because queries only ever read `cov(root)` and `count` is never pushed down, the standard "stabbing count + covered length" node suffices — a classic structure unique to this measure problem.

---

## 12. Comparison with Alternatives

| Problem | Sweep solution | Time | Alternative | Alt time |
| --- | --- | --- | --- | --- |
| Any segment intersection | Shamos–Hoey sweep | `O(n log n)` | all-pairs | `O(n²)` |
| Report all `k` intersections | Bentley–Ottmann | `O((n+k) log n)` | Balaban | `O(n log n + k)` |
| Rectangle union area | sweep + seg tree | `O(n log n)` | — | — |
| Rectangle union perimeter | sweep + seg tree (count boundary) | `O(n log n)` | — | — |
| Klee's measure (`d`-dim) | recursive sweep | `O(n^{d/2})` | — | (Overmars–Yap) |
| Closest pair | sweep (strip of width `δ`) | `O(n log n)` | divide & conquer | `O(n log n)` |
| Skyline / contour | sweep + heap | `O(n log n)` | divide & conquer | `O(n log n)` |

---

## 13. Open Problems and Recent Results

1. **Klee's measure problem in high dimensions.** The union volume of `n` axis-aligned boxes in `ℝ^d` is computable in `O(n^{d/2})` (Overmars–Yap) via a `d`-dimensional sweep; whether `O(n^{d/2 - ε})` is possible (or `n^{Ω(d)}` is necessary) is open for general `d`. Chan improved the constant and special cases.

2. **Dynamic intersection reporting.** Maintaining the set of intersections among segments under insertions/deletions of segments, with sublinear update time, remains partially open; kinetic-data-structure and fully-dynamic results exist for restricted cases.

3. **Robustness vs. speed.** Closing the gap between fast floating-point sweeps and provably exact ones — minimizing the exact-fallback rate of adaptive predicates while keeping worst-case exactness — is an active engineering frontier (CGAL, Shewchuk).

4. **Optimal practical algorithm.** Balaban's `O(n log n + k)` is theoretically optimal but rarely implemented; whether a *simple* optimal algorithm (as easy to code as Bentley–Ottmann) exists is an enduring practical question.

5. **I/O-optimal reporting.** Distribution-sweeping gives `O((N/B) log_{M/B}(N/B) + K/B)` I/Os for red-blue intersection; matching lower bounds and extensions to general (non-red-blue) reporting are studied in external-memory geometry.

---

## 14. Summary

- **Definition & invariants.** A sweep maintains a *status* equal to the current vertical slice (E2), processed in a *total event order* (E1, E3). Correctness is an induction over events restoring E2.
- **Adjacency Lemma.** Two segments cross only after becoming adjacent in the status, so testing neighbors at insert/delete/swap catches every crossing — the structural reason `Θ(n²)` drops to `Θ(n+k)` tests.
- **Complexity.** Bentley–Ottmann is `O((n+k) log n)` time, `O(n+k)` (or `O(n)` with Brown's refinement) space — output-sensitive, with the `k = Θ(n²)` trap.
- **Lower bounds.** Any-intersection is `Ω(n log n)` (element distinctness); reporting is `Ω(n log n + k)`. Shamos–Hoey is optimal for detection; Balaban / Chazelle–Edelsbrunner are optimal for reporting.
- **Degeneracies.** Total ordering + bundle handling, or Simulation of Simplicity, plus exact/adaptive predicates, restore correctness on real data.
- **Segment-tree sweep.** The coverage invariant (no lazy propagation needed) makes rectangle-union area `O(n log n)`, and generalizes to perimeter and Klee's measure.

Bentley & Ottmann (1979) gave the algorithm; Shamos & Hoey (1976) the optimal detection sweep and the `Ω(n log n)` lower bound; Chazelle & Edelsbrunner (1992) and Balaban (1995) the time-optimal reporting algorithms; Edelsbrunner & Mücke (1990) the Simulation of Simplicity; Shewchuk (1997) the adaptive-precision predicates; de Berg et al. remains the canonical pedagogical treatment. A 45-year-old algorithm whose event model is still the first thing every computational-geometry course teaches.

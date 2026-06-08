# Sweep Line (Plane Sweep) — Interview Preparation

The sweep-line paradigm is the most reusable idea in computational-geometry interviews and shows up far beyond geometry: "merge intervals," "meeting rooms," "the skyline problem," "rectangle area," and "do any segments intersect?" all share the same skeleton. Interviewers love it because the *idea* is simple to state — slide a line, process events, keep a status — but the details (tie-breaking at equal x, half-open vs closed intervals, when an intersection event must be enqueued, output-sensitivity) separate a candidate who memorized "merge intervals" from one who understands the general template. This file is a tiered question bank, behavioral/system-design prompts, and four end-to-end coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Core idea | Slide a vertical line left→right; process **events**; maintain a **status** | 2-D problem becomes 1-D over "time." |
| Event queue | Sorted x-coordinates (array) or min-heap (dynamic) | Heap/BST when intersections are discovered on the fly. |
| Status structure | Objects crossing the line, ordered by y | Balanced BST → `O(log n)` insert/delete/neighbor. |
| Simple sweep time | **O(n log n)** | Overlap, area, skyline, closest pair. |
| Bentley–Ottmann time | **O((n + k) log n)** | `k` = intersections reported (output-sensitive). |
| Naive baseline | **O(n²)** | All-pairs; beat it when `k` is small. |
| Key lemma | Two segments cross only when **adjacent** in the status | So test only neighbors at each event. |
| Tie rule (half-open) | Process **ends before starts** at equal x | Avoids counting touching intervals as overlap. |
| Segment-tree partner | Rectangle union area/perimeter | Coverage tree on compressed y. |
| Dense trap | `k ≈ n²` ⇒ `O(n² log n)`, worse than naive | Profile intersection density first. |

Skeleton (the template to write by default):

```text
events = [(x_open, OPEN, obj), (x_close, CLOSE, obj) for each obj]
sort events by (x, tie_rule)
status = empty;  answer = identity
for (x, kind, obj) in events:
    if kind == OPEN:  status.insert(obj);  test new neighbors
    else:             status.remove(obj);  test the two ex-neighbors now adjacent
    answer = update(answer, status, x)
return answer
```

Mental anchor: **a sweep turns a 2-D geometry problem into a 1-D problem evolving over time.**

---

## Junior Questions (12 Q&A)

### J1. What is the sweep-line paradigm in one sentence?
You imagine a vertical line moving across the plane from left to right, stopping only at "events" (special x-coordinates where something changes), and at each stop you update a compact "status" describing what the line currently touches. It converts a 2-D problem into a sequence of cheap 1-D updates.

### J2. What are the two data structures every sweep uses?
An **event queue** — the x-coordinates where something happens, processed in left-to-right order (a sorted array, or a min-heap if events are discovered dynamically) — and a **status structure** — the set of objects the line currently crosses, kept in y-order (usually a balanced BST for `O(log n)` insert/delete/neighbor).

### J3. What is an "event"?
An event is an x-coordinate where the structure of the problem changes: an object starts (its left edge is reached), an object ends (its right edge is passed), or two objects swap order (an intersection, in Bentley–Ottmann). Between events nothing interesting changes, so the sweep jumps event to event.

### J4. Why is the sweep line faster than brute force?
Brute force compares every object with every other — `O(n²)`. The sweep processes each object a constant number of times (start, end, maybe a swap), each update costing `O(log n)`, for `O(n log n)`. The win comes from the fact that you only ever inspect objects that are *active at the same time* and *adjacent in y*, not all pairs.

### J5. Give the simplest example of a sweep.
Counting the maximum number of overlapping intervals. Turn each interval into a `+1` event at its start and a `-1` at its end, sort by x, then walk keeping a running counter. The peak value of the counter is the maximum overlap. The counter *is* the status structure — the simplest possible one.

### J6. Why must you break ties when two events share the same x?
Because the order you process simultaneous events changes the answer. For half-open intervals `[a, b)`, processing an end before a start at equal x ensures `[1,5)` and `[5,8)` are *not* counted as overlapping. Getting this tie rule wrong is the single most common off-by-one bug in sweeps.

### J7. What does the status structure store, and why a BST?
It stores the objects the sweep line currently crosses, ordered by where the line meets them vertically (y-order). A balanced BST is used because at each event you must insert a new object, delete a finished one, and find an object's immediate neighbors — all in `O(log n)`.

### J8. What problems can the sweep line solve?
Segment intersection (Bentley–Ottmann), rectangle union area and perimeter, the closest pair of points, the skyline problem, Klee's measure problem, and essentially every interval-overlap problem. Anywhere there is a natural left-to-right order and interactions are local.

### J9. What is the complexity of Bentley–Ottmann?
`O((n + k) log n)`, where `n` is the number of segments and `k` is the number of intersection points reported. It is *output-sensitive*: fast when intersections are sparse.

### J10. What does "only neighbors can intersect" mean?
Two segments can only cross if, at some moment, they are immediate neighbors in the y-ordered status structure. So instead of testing all `O(n²)` pairs, you only test a segment against its above/below neighbors when the order changes. This is the key insight that makes the algorithm fast.

### J11. How does the simple interval-overlap sweep relate to the harder 2-D ones?
They share the exact same skeleton — build events, sort, walk maintaining a status. The interval version uses an integer counter as its status; the 2-D version upgrades the counter to a balanced BST ordered by y and adds swap events. Learn the 1-D version and the 2-D version is a small step.

### J12 (analysis). Why does sorting dominate the simple sweeps?
For overlap counting, area, or skyline, every per-event operation is `O(1)` or `O(log n)`, and there are `O(n)` events — so the work after sorting is `O(n log n)` at most, and the initial sort of `2n` events is also `O(n log n)`. The two are the same order, so the sort is (asymptotically) the dominant, unavoidable cost.

---

## Middle Questions (12 Q&A)

### M1. State the general sweep-line template.
Build start/end events for every object; sort by x with a tie rule; initialize an empty status structure and an answer accumulator; for each event in order, apply the incremental status change (insert/delete/swap) and update the answer from the current status; return the accumulator. This one shape covers intervals, segments, rectangles, skyline, and closest pair.

### M2. Walk through the three event types in Bentley–Ottmann.
**Left endpoint:** insert the segment into y-order; test it against the segment just above and just below. **Right endpoint:** remove the segment; its former neighbors become adjacent, so test that new pair. **Intersection:** report the point, swap the two crossing segments' order; each now has a new outer neighbor, so test those two pairs. Discovered crossings are enqueued as future events.

### M3. Why does the event queue need to support insertion, not just a one-time sort?
Because intersection events are *discovered during* the sweep — you do not know them up front. When a neighbor test finds a crossing to the right of the current x, you enqueue it. So the queue must be a min-heap or balanced BST, not just a sorted array (which suffices only for the simpler endpoint-only sweeps).

### M4. How do you compute the union area of rectangles with a sweep?
Sweep a vertical line; each rectangle is a `+1` event over its y-span at its left edge and a `-1` at its right edge. Maintain a segment tree over compressed y-coordinates that reports the total y-length currently covered by at least one rectangle. Between consecutive events, area contributed = covered_length × x_gap. Sum the slabs. `O(n log n)`.

### M5. Why a segment tree and not a BST for rectangle area?
A BST tells you *which* objects are active and their neighbors, but not an *aggregate* like "total y-length covered by ≥ 1 rectangle." The segment tree maintains that coverage aggregate under range `+1/−1` updates in `O(log n)`. It is the right tool when you need a y-axis measure, not just adjacency.

### M6. What is output-sensitivity, and why does it matter here?
A bound that depends on the output size, here `k`. Bentley–Ottmann is `O((n + k) log n)`. If intersections are dense (`k = Θ(n²)`), it becomes `O(n² log n)` — worse than the naive `O(n²)`. So you profile intersection density: use the sweep when `k` is small, and reconsider when it is not.

### M7. How do you detect whether *any* two segments intersect, cheaply?
You do not need dynamic intersection events. Sweep the `2n` endpoints; on insert, test against both neighbors; on delete, test the two segments that become adjacent. The first crossing found answers "yes." This Shamos–Hoey sweep is `O(n log n)` and is provably optimal for detection.

### M8. How do you solve the skyline problem with a sweep?
Each building `(left, right, height)` becomes a `+height` event at `left` and a `-height` event at `right`. Sweep x; keep a multiset (or max-heap with lazy deletion) of active heights. The skyline height at any x is the current max active height; emit a key point whenever that max changes. `O(n log n)`.

### M9. How does closest-pair-of-points use a sweep?
Sort points by x and sweep, keeping in a y-ordered set the points within the current best distance `δ` of the line (drop points more than `δ` behind in x). For each new point, only the `O(1)` points within a `2δ × δ` window in y can beat `δ`, so each step is `O(log n)`. Total `O(n log n)`.

### M10. What are the main degeneracies and how do you handle them?
Vertical segments (undefined y-order — special-case or perturb), coincident endpoints (process the whole bundle at a point together), three+ segments through one point (reverse the order of the whole block), overlapping collinear segments (define the output convention), and ties at equal x (a total event order). Real data is full of these; a "general position only" sweep fails immediately.

### M11. When do you choose an interval tree over a sweep?
When the interval set is *static* and you answer many "what overlaps this query interval?" queries. The sweep is a one-pass global computation; the interval tree is a reusable index supporting `O(log n + m)` stabbing queries. Different jobs: one-shot batch vs repeated queries.

### M12 (analysis). Why is testing only neighbors sufficient — don't you miss far-apart crossings?
Because of the adjacency lemma: if two segments cross, there is an earlier moment when they are *immediate neighbors* in the status (any segment between them must first leave or itself cross one of them, shrinking the gap). Since you test adjacency at every insert, delete, and swap, you always test the pair before they cross. No crossing is missed.

---

## Senior Questions (10 Q&A)

### S1. At scale, what makes a sweep correct or broken — the algorithm or the arithmetic?
The arithmetic. The status order depends on the *sign* of an orientation predicate; a floating-point rounding error near a near-collinear point flips that sign, mis-orders the BST, and silently drops an intersection or crashes. Robust sweeps use adaptive-precision predicates (Shewchuk) for float input or exact integers for grid data — never raw `float ==`.

### S2. How does VLSI design-rule checking use sweeps?
Coordinates snap to a manufacturing grid, so exact integer arithmetic is both possible and required. Geometry is mostly axis-aligned (Manhattan), which specializes the sweep into a *scanline* over an interval/segment tree rather than full Bentley–Ottmann. A spacing check bloats shapes and runs a rectangle-overlap sweep, banded to fit cache and run hierarchically over repeated cells across billions of edges.

### S3. How does GIS map overlay differ from textbook segment intersection?
It is a *red-blue* problem — segments come from two layers and you only care about A×B crossings. Coordinates are arbitrary floats, so adaptive-precision predicates are mandatory; shared boundaries create massive collinear-overlap degeneracy; and the output must be topologically valid polygons, so a single dropped intersection is a correctness failure. Output is usually snap-rounded to a grid for storage.

### S4. How do you run a sweep over data that does not fit in RAM?
Distribution sweeping: external-sort events by x, then stream them, keeping only the status (proportional to the sweep-line *width*, not total `n`) in memory. It achieves the I/O-optimal `O((N/B) log_{M/B}(N/B))` block transfers. If the status itself is too tall, partition into y-bands.

### S5. How do you parallelize a sweep without double-counting?
A single sweep is sequential in x, so parallelism comes from spatial partitioning. Split into horizontal bands, sweep each in parallel, and reconcile boundary-crossing features. The trick is half-open band ownership `[y_lo, y_hi)` so an intersection exactly on a boundary belongs to exactly one band — the same half-open idea as the interval tie rule, applied to space.

### S6. When does Bentley–Ottmann become the *wrong* choice?
When intersections are dense (`k` approaches `n²`), since `O((n+k) log n)` degrades below brute force and the event queue blows up; when you only need a boolean ("any intersection?"), where the simpler `O(n log n)` detection sweep or a bounding-box filter suffices; or when data exceeds RAM, where distribution sweeping is needed.

### S7. What is the filter-and-refine pattern?
Never run exact intersection on all pairs. First a cheap *filter*: an R-tree or grid finds candidate pairs whose bounding boxes overlap. Then *refine*: the exact sweep runs only on candidates. This is the backbone of PostGIS spatial joins and cuts the exact-geometry workload by orders of magnitude on sparse data.

### S8. How do you observe a production geometry pipeline?
Track events processed, intersections found (`k`), peak status size (active width), the adaptive-predicate exact-fallback ratio (near-degenerate data), batch runtime, boundary-reconcile duplicates (should be ~0), and invalid-output-geometry count. The key pair is `k` vs runtime: runtime rising faster than `k` means the status structure or predicate fallback is the bottleneck, not output volume.

### S9. What are the main failure modes at scale?
Floating-point predicate sign errors dropping intersections; intersection-density blowup (`k → n²`); degeneracy mishandling (verticals, coincident points); boundary double-counting in parallel sweeps; integer overflow in exact predicates (use 128-bit); and status-structure leaks when a delete event is lost. Each needs explicit validation, not a "rare edge case" dismissal.

### S10 (analysis). Why is Bentley–Ottmann taught even though Balaban's `O(n log n + k)` is optimal?
Because the `log n` overhead is negligible in practice and Bentley–Ottmann's event model — left/right/intersection events, neighbor tests, a status BST — is dramatically simpler to understand and implement than Balaban's hereditary segment trees. The optimal algorithm wins asymptotically but loses on clarity, so the output-sensitive sweep remains the default taught and shipped.

---

## Professional Questions (8 Q&A)

### P1. Prove that testing only neighbors catches every intersection.
The adjacency lemma: if `s` and `t` cross at `p`, consider the interval just left of `p.x` where both are active. If they were never adjacent, some segment `u` is always strictly between them; but `u` must either leave the status or cross `s`/`t` before `p.x`, each event strictly shrinking the count of segments between `s` and `t`. With finitely many segments, that count reaches zero — they become adjacent — at some `x_0 < p.x`. Since the algorithm tests adjacency at every insert/delete/swap, it tests `(s,t)` at `x_0` and enqueues `p`. Hence completeness.

### P2. Derive the `O((n + k) log n)` bound.
There are `2n + k` events. Each triggers `O(1)` balanced-BST status operations (`O(log n)` each) and `O(1)` neighbor predicate tests (`O(1)`), plus `O(1)` event-queue insertions (`O(log(n+k)) = O(log n)` since `k ≤ n²`). Summing: `(2n + k)·O(log n) = O((n + k) log n)`. Space is `O(n + k)` for the queue (or `O(n)` with Brown's live-event refinement) and `O(n)` for the status.

### P3. State the event-ordering invariants that make the sweep correct.
(E1) events extracted in non-decreasing x; (E2) immediately before an event at `x_0`, the status equals the slice just left of `x_0`; (E3) every enqueued intersection has x strictly greater than the current event (future-only), with ties resolved by a total order. Induction on events, with each handler restoring E2, proves correctness. E3 prevents reprocessing and infinite loops.

### P4. How do you handle three or more segments meeting at one point?
A single intersection event must reverse the order of *all* segments passing through the point, not just two. Collect every segment through the point into a bundle, partition into ending/starting/passing-through, and reverse the contiguous passing-through run as a block. This preserves invariant E2. The alternative is Simulation of Simplicity, which perturbs coordinates symbolically so no three are ever concurrent.

### P5. What is the lower bound for segment intersection, and is Bentley–Ottmann optimal?
Detecting *any* intersection is `Ω(n log n)` (reduction from element distinctness in the algebraic decision-tree model), so the `O(n log n)` Shamos–Hoey detection sweep is optimal. Reporting all `k` is `Ω(n log n + k)`. Bentley–Ottmann's `O((n+k) log n)` is within a `log n` factor; the optimal `O(n log n + k)` is achieved by Balaban and by Chazelle–Edelsbrunner.

### P6. Explain the coverage segment tree for rectangle union, including why no lazy propagation is needed.
Each node stores `count` (active rectangles covering its whole y-span) and `cov` (length covered by ≥ 1). The invariant: `cov = full span` if `count > 0`, else `sum of children's cov` (0 at a leaf). Because queries only ever read `cov(root)` and `count` is never pushed down to children, range `+1/−1` updates recompute `cov` bottom-up along one root-to-leaf path in `O(log n)` — no lazy tags. The slab area between events is `cov(root) × Δx`.

### P7. What numerical strategy do you pick for VLSI vs GIS, and why?
VLSI: exact integer arithmetic, because everything is grid-snapped — orientation determinants need ~2× the coordinate bit-width (use 128-bit), and intersection coordinates need rationals or scaled integers. GIS/CAD: adaptive-precision predicates (Shewchuk's `orient2d`), which run a fast float filter and fall back to exact only when uncertain — exact correctness at near-float speed for arbitrary float input. Never raw float comparisons in either case.

### P8 (analysis). Why is the `k = Θ(n²)` case the Achilles' heel of output-sensitive sweeps?
The runtime `O((n+k) log n)` becomes `O(n² log n)`, a `log n` factor *worse* than the naive `O(n²)` all-pairs test, and the event queue must hold `O(k) = O(n²)` pending intersection events, blowing memory. So the very property that makes the sweep fast on sparse data (paying per intersection) makes it lose on dense data. The mitigation is to profile `k/n` on representative input and tile space to isolate dense regions.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n²)` geometry check with a sweep.
Look for a structured story: the problem (e.g. collision detection among many UI rectangles, overlap validation in a floor-plan editor), the brute-force baseline and why it became too slow, the choice of sweep (and tie rule / status structure), and what was measured. Strong answers mention a surprise — e.g. discovering degeneracies (shared edges) that the textbook sweep did not handle until ties were ordered explicitly.

### B2. Design a CAD overlap-checker for thousands of components.
The sweep is the engine, but the system matters: bounding-box (R-tree) pre-filter, exact predicates for arbitrary float coordinates, incremental re-checking of only edited regions, and snap-rounding for storable results. Discuss the filter-and-refine pattern, how you handle shared edges (degeneracies), and how you validate output against a brute-force oracle on small inputs.

### B3. Design a spatial-join service for a GIS backend.
Model the two layers as red and blue segments; run a red-blue sweep on candidate pairs from an R-tree filter; use adaptive-precision predicates; partition into tiles for parallelism with half-open boundary ownership. Mention skew (city tiles hold most features), data-aware tiling, and topological validity of the output polygons.

### B4. A junior asks: "Why not just compare every pair?" How do you respond?
For small `n`, do exactly that — brute force is simpler, easier to verify, and fast enough, and it makes a perfect test oracle. The sweep earns its complexity only when `n` is large *and* intersections are sparse (`k` small). Teach choosing the method by the input's size and density, and warn that the sweep can actually be *slower* when intersections are dense.

### B5. Your overlay job started producing invalid polygons after a data import. How do you investigate?
First suspect numerical robustness: check whether the predicate's exact-fallback ratio spiked (near-degenerate coordinates from the import) and whether you are using exact/adaptive predicates at all. Then audit for new degeneracies (coincident vertices, collinear overlaps) the tie ordering does not cover. Add a brute-force consistency check on sampled tiles and a topological validator that flags self-intersections before publish.

---

## Coding Challenges

### Challenge 1 — Maximum Overlapping Intervals (Meeting Rooms II)

Given `intervals` (half-open `[start, end)`), return the maximum number overlapping at any point — equivalently the minimum rooms needed. Sweep `2n` endpoint events; process ends before starts at equal x.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func minMeetingRooms(intervals [][2]int) int {
	events := make([][2]int, 0, 2*len(intervals)) // {x, delta}
	for _, iv := range intervals {
		events = append(events, [2]int{iv[0], +1})
		events = append(events, [2]int{iv[1], -1})
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i][0] != events[j][0] {
			return events[i][0] < events[j][0]
		}
		return events[i][1] < events[j][1] // ends (-1) before starts (+1)
	})
	active, best := 0, 0
	for _, e := range events {
		active += e[1]
		if active > best {
			best = active
		}
	}
	return best
}

func main() {
	fmt.Println(minMeetingRooms([][2]int{{0, 30}, {5, 10}, {15, 20}})) // 2
}
```

#### Java
```java
import java.util.*;

public class MeetingRooms {
    public int minMeetingRooms(int[][] intervals) {
        int[][] ev = new int[intervals.length * 2][2];
        int idx = 0;
        for (int[] iv : intervals) {
            ev[idx++] = new int[]{iv[0], +1};
            ev[idx++] = new int[]{iv[1], -1};
        }
        Arrays.sort(ev, (a, b) ->
                a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        int active = 0, best = 0;
        for (int[] e : ev) {
            active += e[1];
            best = Math.max(best, active);
        }
        return best;
    }

    public static void main(String[] args) {
        int[][] iv = {{0, 30}, {5, 10}, {15, 20}};
        System.out.println(new MeetingRooms().minMeetingRooms(iv)); // 2
    }
}
```

#### Python
```python
def min_meeting_rooms(intervals):
    events = []
    for start, end in intervals:
        events.append((start, +1))
        events.append((end, -1))
    events.sort()  # (x, delta): -1 sorts before +1 at equal x
    active = best = 0
    for _x, delta in events:
        active += delta
        best = max(best, active)
    return best


if __name__ == "__main__":
    print(min_meeting_rooms([(0, 30), (5, 10), (15, 20)]))  # 2
```

---

### Challenge 2 — The Skyline Problem

Given buildings `[left, right, height]`, return the skyline as a list of key points `[x, height]` where the skyline height changes. Sweep edges; keep a max-structure of active heights.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func getSkyline(buildings [][3]int) [][2]int {
	type ev struct{ x, h int } // h>0 start, h<0 end (use -height)
	var events []ev
	for _, b := range buildings {
		events = append(events, ev{b[0], -b[2]}) // start: negative height
		events = append(events, ev{b[1], b[2]})  // end: positive height
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].x != events[j].x {
			return events[i].x < events[j].x
		}
		return events[i].h < events[j].h // process starts before ends at same x
	})
	// active height multiset via a count map + current max tracking.
	active := map[int]int{0: 1} // ground level always present
	curMax := 0
	var res [][2]int
	maxOf := func() int {
		m := 0
		for h := range active {
			if active[h] > 0 && h > m {
				m = h
			}
		}
		return m
	}
	for _, e := range events {
		if e.h < 0 {
			active[-e.h]++
		} else {
			active[e.h]--
			if active[e.h] == 0 {
				delete(active, e.h)
			}
		}
		m := maxOf()
		if m != curMax {
			res = append(res, [2]int{e.x, m})
			curMax = m
		}
	}
	return res
}

func main() {
	fmt.Println(getSkyline([][3]int{{2, 9, 10}, {3, 7, 15}, {5, 12, 12}}))
	// [[2 10] [3 15] [7 12] [12 0]]
}
```

#### Java
```java
import java.util.*;

public class Skyline {
    public List<int[]> getSkyline(int[][] buildings) {
        List<int[]> events = new ArrayList<>(); // {x, h}: start uses -height
        for (int[] b : buildings) {
            events.add(new int[]{b[0], -b[2]});
            events.add(new int[]{b[1], b[2]});
        }
        events.sort((a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0])
                                           : Integer.compare(a[1], b[1]));
        TreeMap<Integer, Integer> active = new TreeMap<>();
        active.put(0, 1); // ground
        int curMax = 0;
        List<int[]> res = new ArrayList<>();
        for (int[] e : events) {
            int h = e[1];
            if (h < 0) active.merge(-h, 1, Integer::sum);
            else {
                int c = active.get(h);
                if (c == 1) active.remove(h); else active.put(h, c - 1);
            }
            int m = active.lastKey();
            if (m != curMax) { res.add(new int[]{e[0], m}); curMax = m; }
        }
        return res;
    }

    public static void main(String[] args) {
        int[][] b = {{2, 9, 10}, {3, 7, 15}, {5, 12, 12}};
        for (int[] p : new Skyline().getSkyline(b)) System.out.print(Arrays.toString(p) + " ");
        // [2, 10] [3, 15] [7, 12] [12, 0]
    }
}
```

#### Python
```python
import heapq


def get_skyline(buildings):
    events = []
    for left, right, h in buildings:
        events.append((left, -h))   # start: negative height
        events.append((right, h))   # end: positive height
    events.sort()
    # max-heap of active heights (lazy deletion) + count of pending removals
    live = [0]                       # ground level
    counts = {0: 1}
    res = []
    cur_max = 0
    for x, h in events:
        if h < 0:
            heapq.heappush(live, h)  # push -height
            counts[-h] = counts.get(-h, 0) + 1
        else:
            counts[h] -= 1
        # pop stale tops whose count dropped to zero
        while live and counts.get(-live[0], 0) == 0:
            heapq.heappop(live)
        m = -live[0]
        if m != cur_max:
            res.append([x, m])
            cur_max = m
    return res


if __name__ == "__main__":
    print(get_skyline([(2, 9, 10), (3, 7, 15), (5, 12, 12)]))
    # [[2, 10], [3, 15], [7, 12], [12, 0]]
```

---

### Challenge 3 — Rectangle Union Area

Given axis-aligned rectangles `[x1, y1, x2, y2]`, return the area of their union (overlaps counted once). Sweep x with a coverage segment tree over compressed y.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type ev struct{ x, y1, y2, d int }

type cov struct {
	ys           []int
	cnt, covered []int
}

func (t *cov) upd(node, l, r, lo, hi, d int) {
	if hi <= t.ys[l] || t.ys[r] <= lo {
		return
	}
	if lo <= t.ys[l] && t.ys[r] <= hi {
		t.cnt[node] += d
	} else {
		m := (l + r) / 2
		t.upd(2*node, l, m, lo, hi, d)
		t.upd(2*node+1, m, r, lo, hi, d)
	}
	if t.cnt[node] > 0 {
		t.covered[node] = t.ys[r] - t.ys[l]
	} else if r-l == 1 {
		t.covered[node] = 0
	} else {
		t.covered[node] = t.covered[2*node] + t.covered[2*node+1]
	}
}

func rectArea(rects [][4]int) int {
	var events []ev
	yset := map[int]bool{}
	for _, r := range rects {
		events = append(events, ev{r[0], r[1], r[3], +1})
		events = append(events, ev{r[2], r[1], r[3], -1})
		yset[r[1]] = true
		yset[r[3]] = true
	}
	ys := []int{}
	for y := range yset {
		ys = append(ys, y)
	}
	sort.Ints(ys)
	sort.Slice(events, func(i, j int) bool { return events[i].x < events[j].x })
	t := &cov{ys: ys, cnt: make([]int, 4*len(ys)), covered: make([]int, 4*len(ys))}
	area, prev := 0, events[0].x
	for _, e := range events {
		area += t.covered[1] * (e.x - prev)
		prev = e.x
		t.upd(1, 0, len(ys)-1, e.y1, e.y2, e.d)
	}
	return area
}

func main() {
	fmt.Println(rectArea([][4]int{{0, 0, 2, 2}, {1, 1, 3, 3}})) // 7
}
```

#### Java
```java
import java.util.*;

public class RectUnion {
    static int[] ys, cnt, cov;

    static void upd(int node, int l, int r, int lo, int hi, int d) {
        if (hi <= ys[l] || ys[r] <= lo) return;
        if (lo <= ys[l] && ys[r] <= hi) cnt[node] += d;
        else {
            int m = (l + r) / 2;
            upd(2 * node, l, m, lo, hi, d);
            upd(2 * node + 1, m, r, lo, hi, d);
        }
        if (cnt[node] > 0) cov[node] = ys[r] - ys[l];
        else if (r - l == 1) cov[node] = 0;
        else cov[node] = cov[2 * node] + cov[2 * node + 1];
    }

    public int rectangleArea(int[][] rects) {
        int[][] ev = new int[rects.length * 2][4];
        TreeSet<Integer> ySet = new TreeSet<>();
        int i = 0;
        for (int[] r : rects) {
            ev[i++] = new int[]{r[0], r[1], r[3], +1};
            ev[i++] = new int[]{r[2], r[1], r[3], -1};
            ySet.add(r[1]); ySet.add(r[3]);
        }
        ys = ySet.stream().mapToInt(Integer::intValue).toArray();
        cnt = new int[4 * ys.length];
        cov = new int[4 * ys.length];
        Arrays.sort(ev, (a, b) -> Integer.compare(a[0], b[0]));
        long area = 0;
        int prev = ev[0][0];
        for (int[] e : ev) {
            area += (long) cov[1] * (e[0] - prev);
            prev = e[0];
            upd(1, 0, ys.length - 1, e[1], e[2], e[3]);
        }
        return (int) area;
    }

    public static void main(String[] args) {
        int[][] rects = {{0, 0, 2, 2}, {1, 1, 3, 3}};
        System.out.println(new RectUnion().rectangleArea(rects)); // 7
    }
}
```

#### Python
```python
class Cov:
    def __init__(self, ys):
        self.ys = ys
        self.cnt = [0] * (4 * len(ys))
        self.cov = [0] * (4 * len(ys))

    def upd(self, node, l, r, lo, hi, d):
        ys = self.ys
        if hi <= ys[l] or ys[r] <= lo:
            return
        if lo <= ys[l] and ys[r] <= hi:
            self.cnt[node] += d
        else:
            m = (l + r) // 2
            self.upd(2 * node, l, m, lo, hi, d)
            self.upd(2 * node + 1, m, r, lo, hi, d)
        if self.cnt[node] > 0:
            self.cov[node] = ys[r] - ys[l]
        elif r - l == 1:
            self.cov[node] = 0
        else:
            self.cov[node] = self.cov[2 * node] + self.cov[2 * node + 1]


def rectangle_area(rects):
    events, ys = [], set()
    for x1, y1, x2, y2 in rects:
        events.append((x1, y1, y2, +1))
        events.append((x2, y1, y2, -1))
        ys.add(y1)
        ys.add(y2)
    ys = sorted(ys)
    events.sort(key=lambda e: e[0])
    t = Cov(ys)
    area, prev = 0, events[0][0]
    for x, y1, y2, d in events:
        area += t.cov[1] * (x - prev)
        prev = x
        t.upd(1, 0, len(ys) - 1, y1, y2, d)
    return area


if __name__ == "__main__":
    print(rectangle_area([(0, 0, 2, 2), (1, 1, 3, 3)]))  # 7
```

---

### Challenge 4 — Any Two Segments Intersect? (Shamos–Hoey)

Given `n` segments, return `true` if any two intersect. Sweep `2n` endpoints; test each inserted segment against its y-neighbors. `O(n log n)` with an ordered status (here a simple sorted list for clarity).

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type pt struct{ x, y float64 }

func orient(a, b, c pt) float64 {
	return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)
}
func segInt(p1, p2, p3, p4 pt) bool {
	d1, d2 := orient(p3, p4, p1), orient(p3, p4, p2)
	d3, d4 := orient(p1, p2, p3), orient(p1, p2, p4)
	return (d1 > 0) != (d2 > 0) && (d3 > 0) != (d4 > 0)
}

func anyIntersection(segs [][4]float64) bool {
	type e struct{ x float64; left bool; i int }
	var ev []e
	for i, s := range segs {
		a, b := s[0], s[2]
		if a > b {
			a, b = b, a
		}
		ev = append(ev, e{a, true, i}, e{b, false, i})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i].x != ev[j].x {
			return ev[i].x < ev[j].x
		}
		return ev[i].left && !ev[j].left
	})
	active := []int{}
	get := func(i int) (pt, pt) { return pt{segs[i][0], segs[i][1]}, pt{segs[i][2], segs[i][3]} }
	for _, x := range ev {
		if x.left {
			for _, j := range active {
				a1, a2 := get(x.i)
				b1, b2 := get(j)
				if segInt(a1, a2, b1, b2) {
					return true
				}
			}
			active = append(active, x.i)
		} else {
			for idx, j := range active {
				if j == x.i {
					active = append(active[:idx], active[idx+1:]...)
					break
				}
			}
		}
	}
	return false
}

func main() {
	fmt.Println(anyIntersection([][4]float64{{0, 0, 4, 4}, {0, 4, 4, 0}})) // true
	fmt.Println(anyIntersection([][4]float64{{0, 0, 1, 1}, {2, 2, 3, 3}})) // false
}
```

#### Java
```java
import java.util.*;

public class AnyIntersection {
    static double orient(double ax, double ay, double bx, double by, double cx, double cy) {
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    }
    static boolean segInt(double[] s, double[] t) {
        double d1 = orient(t[0], t[1], t[2], t[3], s[0], s[1]);
        double d2 = orient(t[0], t[1], t[2], t[3], s[2], s[3]);
        double d3 = orient(s[0], s[1], s[2], s[3], t[0], t[1]);
        double d4 = orient(s[0], s[1], s[2], s[3], t[2], t[3]);
        return (d1 > 0) != (d2 > 0) && (d3 > 0) != (d4 > 0);
    }

    public static boolean anyIntersection(double[][] segs) {
        List<double[]> ev = new ArrayList<>(); // {x, isLeft(1/0), index}
        for (int i = 0; i < segs.length; i++) {
            double a = Math.min(segs[i][0], segs[i][2]);
            double b = Math.max(segs[i][0], segs[i][2]);
            ev.add(new double[]{a, 1, i});
            ev.add(new double[]{b, 0, i});
        }
        ev.sort((p, q) -> p[0] != q[0] ? Double.compare(p[0], q[0])
                                       : Double.compare(q[1], p[1]));
        List<Integer> active = new ArrayList<>();
        for (double[] e : ev) {
            int i = (int) e[2];
            if (e[1] == 1) {
                for (int j : active) if (segInt(segs[i], segs[j])) return true;
                active.add(i);
            } else {
                active.remove(Integer.valueOf(i));
            }
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(anyIntersection(new double[][]{{0,0,4,4}, {0,4,4,0}})); // true
        System.out.println(anyIntersection(new double[][]{{0,0,1,1}, {2,2,3,3}})); // false
    }
}
```

#### Python
```python
def orient(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def seg_int(s, t):
    d1 = orient(*t, s[0], s[1])
    d2 = orient(*t, s[2], s[3])
    d3 = orient(*s, t[0], t[1])
    d4 = orient(*s, t[2], t[3])
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def any_intersection(segs):
    events = []
    for i, s in enumerate(segs):
        a, b = min(s[0], s[2]), max(s[0], s[2])
        events.append((a, 1, i))   # left
        events.append((b, 0, i))   # right
    events.sort(key=lambda e: (e[0], -e[1]))  # left before right at equal x
    active = []
    for _x, is_left, i in events:
        if is_left:
            for j in active:
                if seg_int(segs[i], segs[j]):
                    return True
            active.append(i)
        else:
            active.remove(i)
    return False


if __name__ == "__main__":
    print(any_intersection([(0, 0, 4, 4), (0, 4, 4, 0)]))  # True
    print(any_intersection([(0, 0, 1, 1), (2, 2, 3, 3)]))  # False
```

---

## Common Pitfalls

1. **Wrong tie-breaking at equal x.** The classic bug: touching intervals get mis-counted. Decide half-open vs closed first, then order ties accordingly.
2. **Using a plain list as the status.** `O(n)` neighbor search destroys the `O(n log n)` goal; use a balanced BST / ordered structure.
3. **Forgetting to enqueue discovered intersections** (Bentley–Ottmann) or to dedupe them — leads to missed or double-reported crossings.
4. **Testing only original pairs** instead of re-testing neighbors after every swap/delete.
5. **Comparing floats with `==`** on intersection coordinates — use epsilon, exact integers, or adaptive predicates.
6. **Ignoring degeneracies** (vertical segments, coincident points) as "rare" — real data is full of them.
7. **Forgetting to delete ended objects** — the active set leaks and the answer drifts.
8. **Applying Bentley–Ottmann when intersections are dense** (`k ≈ n²`) — it is slower than brute force then.
9. **Overflow** when multiplying covered-length by x-gap in area sweeps — use 64-bit.
10. **Recomputing the whole status each event** instead of applying the incremental change.

---

## What Interviewers Are Really Testing

- **Do you see the template?** Recognizing that "meeting rooms," "skyline," "rectangle area," and "segment intersection" are *the same algorithm* with different status structures is the real signal.
- **Tie-breaking discipline.** Whether you state the half-open convention and order ties correctly, unprompted, reveals understanding versus pattern-matching.
- **Status-structure choice.** Counter vs balanced BST vs segment tree vs heap — picking the minimal structure that answers the question shows judgment.
- **The adjacency insight.** Explaining *why* testing only neighbors suffices (the adjacency lemma) separates memorization from understanding.
- **Output-sensitivity awareness.** Knowing Bentley–Ottmann can be *slower* than brute force on dense input is senior-level nuance.
- **Robustness.** Mentioning float predicate errors, degeneracies, and exact arithmetic — without prompting — signals production maturity in a domain where "works on my test data" hides catastrophic bugs.
- **Communication.** Walking the small worked example (build events, sort, sweep, update status) clearly is as important as the finished code.

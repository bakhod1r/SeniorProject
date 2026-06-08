# Sweep Line (Plane Sweep) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a complete reference solution in all three languages. Reuse the core ideas from the rest of this topic: **events** (start/end/intersection), the **event queue** (sorted x or a heap), the **status structure** (counter, balanced BST, segment tree, or heap), the **tie-breaking rule** at equal x, and the **adjacency lemma** (only neighbors can intersect).
> Default convention throughout: spans are **half-open `[a, b)`**, and at equal x you process **ends before starts** unless a task says otherwise.

---

## Beginner Tasks (5)

### Task 1 — Maximum overlapping intervals

**Statement.** Given `n` half-open intervals `[start, end)`, return the maximum number that overlap at any single point.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ start < end ≤ 10^9`.
- Use the event sweep; `O(n log n)`.

**Hints.**
- Each interval → a `+1` event at `start`, a `-1` event at `end`.
- Sort by `(x, delta)` so ends (`-1`) precede starts (`+1`) at equal x.
- Track a running counter; the peak is the answer.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxOverlap(intervals [][2]int) int {
	ev := make([][2]int, 0, 2*len(intervals))
	for _, iv := range intervals {
		ev = append(ev, [2]int{iv[0], 1}, [2]int{iv[1], -1})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i][0] != ev[j][0] {
			return ev[i][0] < ev[j][0]
		}
		return ev[i][1] < ev[j][1]
	})
	active, best := 0, 0
	for _, e := range ev {
		active += e[1]
		if active > best {
			best = active
		}
	}
	return best
}

func main() {
	fmt.Println(maxOverlap([][2]int{{1, 5}, {2, 6}, {4, 7}, {8, 9}})) // 3
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    static int maxOverlap(int[][] intervals) {
        int[][] ev = new int[intervals.length * 2][2];
        int i = 0;
        for (int[] iv : intervals) {
            ev[i++] = new int[]{iv[0], 1};
            ev[i++] = new int[]{iv[1], -1};
        }
        Arrays.sort(ev, (a, b) ->
                a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        int active = 0, best = 0;
        for (int[] e : ev) { active += e[1]; best = Math.max(best, active); }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxOverlap(new int[][]{{1, 5}, {2, 6}, {4, 7}, {8, 9}})); // 3
    }
}
```

#### Python
```python
def max_overlap(intervals):
    ev = []
    for s, e in intervals:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort()  # -1 sorts before +1 at equal x
    active = best = 0
    for _x, d in ev:
        active += d
        best = max(best, active)
    return best


if __name__ == "__main__":
    print(max_overlap([(1, 5), (2, 6), (4, 7), (8, 9)]))  # 3
```

---

### Task 2 — Total length of the union of 1-D segments

**Statement.** Given `n` segments `[l, r]` on a line, return the total length covered by at least one segment (overlaps counted once).

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ l ≤ r ≤ 10^9`.

**Hints.**
- Sweep `+1` at `l`, `-1` at `r`; between consecutive events, if the active count is `> 0` the gap is covered.
- Add `(x_cur - x_prev)` to the answer whenever the count was positive over that gap.
- Process events in x-order; the count value *before* the event applies to the gap to its left.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func unionLength(segs [][2]int) int {
	ev := make([][2]int, 0, 2*len(segs))
	for _, s := range segs {
		ev = append(ev, [2]int{s[0], 1}, [2]int{s[1], -1})
	}
	sort.Slice(ev, func(i, j int) bool { return ev[i][0] < ev[j][0] })
	total, active, prev := 0, 0, ev[0][0]
	for _, e := range ev {
		if active > 0 {
			total += e[0] - prev
		}
		prev = e[0]
		active += e[1]
	}
	return total
}

func main() {
	fmt.Println(unionLength([][2]int{{1, 4}, {2, 6}, {8, 10}})) // 7
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static int unionLength(int[][] segs) {
        int[][] ev = new int[segs.length * 2][2];
        int i = 0;
        for (int[] s : segs) { ev[i++] = new int[]{s[0], 1}; ev[i++] = new int[]{s[1], -1}; }
        Arrays.sort(ev, (a, b) -> Integer.compare(a[0], b[0]));
        int total = 0, active = 0, prev = ev[0][0];
        for (int[] e : ev) {
            if (active > 0) total += e[0] - prev;
            prev = e[0];
            active += e[1];
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(unionLength(new int[][]{{1, 4}, {2, 6}, {8, 10}})); // 7
    }
}
```

#### Python
```python
def union_length(segs):
    ev = []
    for l, r in segs:
        ev.append((l, 1))
        ev.append((r, -1))
    ev.sort(key=lambda e: e[0])
    total = active = 0
    prev = ev[0][0]
    for x, d in ev:
        if active > 0:
            total += x - prev
        prev = x
        active += d
    return total


if __name__ == "__main__":
    print(union_length([(1, 4), (2, 6), (8, 10)]))  # 7
```

---

### Task 3 — Can all meetings be attended?

**Statement.** Given `n` meeting intervals `[start, end)`, return `true` if no two overlap (one person can attend all).

**Constraints.**
- `1 ≤ n ≤ 10^4`, `0 ≤ start < end ≤ 10^9`.

**Hints.**
- This is "max overlap ≤ 1."
- Equivalently, sort by start and check each meeting starts at or after the previous one's end.
- Half-open `[a, b)` means `[1,5)` and `[5,8)` do *not* conflict.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func canAttendAll(meetings [][2]int) bool {
	sort.Slice(meetings, func(i, j int) bool { return meetings[i][0] < meetings[j][0] })
	for i := 1; i < len(meetings); i++ {
		if meetings[i][0] < meetings[i-1][1] {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(canAttendAll([][2]int{{0, 30}, {5, 10}})) // false
	fmt.Println(canAttendAll([][2]int{{1, 5}, {5, 8}}))   // true
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static boolean canAttendAll(int[][] meetings) {
        Arrays.sort(meetings, (a, b) -> Integer.compare(a[0], b[0]));
        for (int i = 1; i < meetings.length; i++)
            if (meetings[i][0] < meetings[i - 1][1]) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(canAttendAll(new int[][]{{0, 30}, {5, 10}})); // false
        System.out.println(canAttendAll(new int[][]{{1, 5}, {5, 8}}));   // true
    }
}
```

#### Python
```python
def can_attend_all(meetings):
    meetings.sort(key=lambda m: m[0])
    for i in range(1, len(meetings)):
        if meetings[i][0] < meetings[i - 1][1]:
            return False
    return True


if __name__ == "__main__":
    print(can_attend_all([(0, 30), (5, 10)]))  # False
    print(can_attend_all([(1, 5), (5, 8)]))    # True
```

---

### Task 4 — Merge overlapping intervals

**Statement.** Given `n` intervals `[start, end]`, merge all overlapping ones and return the merged list sorted by start.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ start ≤ end ≤ 10^9`.
- Closed intervals: `[1, 3]` and `[3, 5]` merge into `[1, 5]`.

**Hints.**
- Sort by start; sweep, extending the current merged interval while the next start ≤ current end.
- This is a sweep where the "status" is the single open merged interval.
- Push the completed interval when the next one starts strictly after the current end.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func merge(intervals [][2]int) [][2]int {
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
	res := [][2]int{intervals[0]}
	for _, iv := range intervals[1:] {
		last := &res[len(res)-1]
		if iv[0] <= last[1] {
			if iv[1] > last[1] {
				last[1] = iv[1]
			}
		} else {
			res = append(res, iv)
		}
	}
	return res
}

func main() {
	fmt.Println(merge([][2]int{{1, 3}, {2, 6}, {8, 10}, {15, 18}}))
	// [[1 6] [8 10] [15 18]]
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    static int[][] merge(int[][] intervals) {
        Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));
        List<int[]> res = new ArrayList<>();
        res.add(intervals[0].clone());
        for (int i = 1; i < intervals.length; i++) {
            int[] last = res.get(res.size() - 1);
            if (intervals[i][0] <= last[1]) last[1] = Math.max(last[1], intervals[i][1]);
            else res.add(intervals[i].clone());
        }
        return res.toArray(new int[0][]);
    }

    public static void main(String[] args) {
        for (int[] iv : merge(new int[][]{{1, 3}, {2, 6}, {8, 10}, {15, 18}}))
            System.out.print(Arrays.toString(iv) + " "); // [1, 6] [8, 10] [15, 18]
    }
}
```

#### Python
```python
def merge(intervals):
    intervals.sort(key=lambda iv: iv[0])
    res = [list(intervals[0])]
    for s, e in intervals[1:]:
        if s <= res[-1][1]:
            res[-1][1] = max(res[-1][1], e)
        else:
            res.append([s, e])
    return res


if __name__ == "__main__":
    print(merge([(1, 3), (2, 6), (8, 10), (15, 18)]))  # [[1, 6], [8, 10], [15, 18]]
```

---

### Task 5 — Point with maximum coverage

**Statement.** Given `n` intervals `[start, end)`, return *a* point x where the maximum number of intervals overlap (any such point is acceptable).

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ start < end ≤ 10^9`.

**Hints.**
- Same sweep as Task 1, but remember the x at which the counter hits its new maximum.
- Process ends before starts at equal x; the max is reached right after a start event.
- Return the x of the start event that produced the peak.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func busiestPoint(intervals [][2]int) int {
	ev := make([][2]int, 0, 2*len(intervals))
	for _, iv := range intervals {
		ev = append(ev, [2]int{iv[0], 1}, [2]int{iv[1], -1})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i][0] != ev[j][0] {
			return ev[i][0] < ev[j][0]
		}
		return ev[i][1] < ev[j][1]
	})
	active, best, bestX := 0, 0, ev[0][0]
	for _, e := range ev {
		active += e[1]
		if active > best {
			best = active
			bestX = e[0]
		}
	}
	return bestX
}

func main() {
	fmt.Println(busiestPoint([][2]int{{1, 5}, {2, 6}, {4, 7}})) // 4
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static int busiestPoint(int[][] intervals) {
        int[][] ev = new int[intervals.length * 2][2];
        int i = 0;
        for (int[] iv : intervals) {
            ev[i++] = new int[]{iv[0], 1};
            ev[i++] = new int[]{iv[1], -1};
        }
        Arrays.sort(ev, (a, b) ->
                a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        int active = 0, best = 0, bestX = ev[0][0];
        for (int[] e : ev) {
            active += e[1];
            if (active > best) { best = active; bestX = e[0]; }
        }
        return bestX;
    }

    public static void main(String[] args) {
        System.out.println(busiestPoint(new int[][]{{1, 5}, {2, 6}, {4, 7}})); // 4
    }
}
```

#### Python
```python
def busiest_point(intervals):
    ev = []
    for s, e in intervals:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort()
    active = best = 0
    best_x = ev[0][0]
    for x, d in ev:
        active += d
        if active > best:
            best = active
            best_x = x
    return best_x


if __name__ == "__main__":
    print(busiest_point([(1, 5), (2, 6), (4, 7)]))  # 4
```

---

## Intermediate Tasks (5)

### Task 6 — Any two segments intersect? (Shamos–Hoey)

**Statement.** Given `n` line segments, return `true` if any two of them intersect.

**Constraints.**
- `1 ≤ n ≤ 10^4`, integer coordinates in `[-10^6, 10^6]`.

**Hints.**
- Sweep `2n` endpoints; on a left event, test the new segment against active segments (its y-neighbors); on a right event, remove it.
- Use integer cross-product orientation tests, not slopes.
- The reference below uses a flat active list (`O(n²)` worst case); a balanced BST keyed on y-at-x gives `O(n log n)`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func orient(ax, ay, bx, by, cx, cy int) int {
	return (bx-ax)*(cy-ay) - (by-ay)*(cx-ax)
}
func sgn(x int) int {
	if x > 0 {
		return 1
	} else if x < 0 {
		return -1
	}
	return 0
}
func cross(s, t [4]int) bool {
	d1 := sgn(orient(t[0], t[1], t[2], t[3], s[0], s[1]))
	d2 := sgn(orient(t[0], t[1], t[2], t[3], s[2], s[3]))
	d3 := sgn(orient(s[0], s[1], s[2], s[3], t[0], t[1]))
	d4 := sgn(orient(s[0], s[1], s[2], s[3], t[2], t[3]))
	return d1 != d2 && d3 != d4 && d1 != 0 && d3 != 0
}

func anyIntersect(segs [][4]int) bool {
	type e struct {
		x    int
		left bool
		i    int
	}
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
	for _, x := range ev {
		if x.left {
			for _, j := range active {
				if cross(segs[x.i], segs[j]) {
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
	fmt.Println(anyIntersect([][4]int{{0, 0, 4, 4}, {0, 4, 4, 0}})) // true
	fmt.Println(anyIntersect([][4]int{{0, 0, 1, 1}, {2, 2, 3, 3}})) // false
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static int orient(int ax, int ay, int bx, int by, int cx, int cy) {
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    }
    static int sgn(int x) { return Integer.compare(x, 0); }
    static boolean cross(int[] s, int[] t) {
        int d1 = sgn(orient(t[0], t[1], t[2], t[3], s[0], s[1]));
        int d2 = sgn(orient(t[0], t[1], t[2], t[3], s[2], s[3]));
        int d3 = sgn(orient(s[0], s[1], s[2], s[3], t[0], t[1]));
        int d4 = sgn(orient(s[0], s[1], s[2], s[3], t[2], t[3]));
        return d1 != d2 && d3 != d4 && d1 != 0 && d3 != 0;
    }

    static boolean anyIntersect(int[][] segs) {
        List<int[]> ev = new ArrayList<>(); // {x, isLeft, index}
        for (int i = 0; i < segs.length; i++) {
            int a = Math.min(segs[i][0], segs[i][2]), b = Math.max(segs[i][0], segs[i][2]);
            ev.add(new int[]{a, 1, i});
            ev.add(new int[]{b, 0, i});
        }
        ev.sort((p, q) -> p[0] != q[0] ? Integer.compare(p[0], q[0])
                                       : Integer.compare(q[1], p[1]));
        List<Integer> active = new ArrayList<>();
        for (int[] e : ev) {
            int i = e[2];
            if (e[1] == 1) {
                for (int j : active) if (cross(segs[i], segs[j])) return true;
                active.add(i);
            } else active.remove(Integer.valueOf(i));
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(anyIntersect(new int[][]{{0,0,4,4}, {0,4,4,0}})); // true
        System.out.println(anyIntersect(new int[][]{{0,0,1,1}, {2,2,3,3}})); // false
    }
}
```

#### Python
```python
def orient(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def sgn(x):
    return (x > 0) - (x < 0)


def cross(s, t):
    d1 = sgn(orient(*t, s[0], s[1]))
    d2 = sgn(orient(*t, s[2], s[3]))
    d3 = sgn(orient(*s, t[0], t[1]))
    d4 = sgn(orient(*s, t[2], t[3]))
    return d1 != d2 and d3 != d4 and d1 != 0 and d3 != 0


def any_intersect(segs):
    ev = []
    for i, s in enumerate(segs):
        a, b = min(s[0], s[2]), max(s[0], s[2])
        ev.append((a, 1, i))
        ev.append((b, 0, i))
    ev.sort(key=lambda e: (e[0], -e[1]))
    active = []
    for _x, is_left, i in ev:
        if is_left:
            for j in active:
                if cross(segs[i], segs[j]):
                    return True
            active.append(i)
        else:
            active.remove(i)
    return False


if __name__ == "__main__":
    print(any_intersect([(0, 0, 4, 4), (0, 4, 4, 0)]))  # True
    print(any_intersect([(0, 0, 1, 1), (2, 2, 3, 3)]))  # False
```

---

### Task 7 — Rectangle union area

**Statement.** Given `n` axis-aligned rectangles `[x1, y1, x2, y2]`, return the area of their union.

**Constraints.**
- `1 ≤ n ≤ 10^4`, integer coordinates in `[0, 10^9]`.
- Use a sweep with a coverage segment tree over compressed y; `O(n log n)`.

**Hints.**
- Each rectangle → `+1` over `[y1, y2)` at `x1`, `-1` at `x2`.
- Compress y-values; the tree's root `covered` is the y-length covered by ≥ 1 rect.
- Area += `covered × (x_cur - x_prev)` for the slab left of each event.

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
		events = append(events, ev{r[0], r[1], r[3], 1}, ev{r[2], r[1], r[3], -1})
		yset[r[1]], yset[r[3]] = true, true
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

public class Task7 {
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

    static long rectArea(int[][] rects) {
        int[][] ev = new int[rects.length * 2][4];
        TreeSet<Integer> ySet = new TreeSet<>();
        int i = 0;
        for (int[] r : rects) {
            ev[i++] = new int[]{r[0], r[1], r[3], 1};
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
        return area;
    }

    public static void main(String[] args) {
        System.out.println(rectArea(new int[][]{{0, 0, 2, 2}, {1, 1, 3, 3}})); // 7
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


def rect_area(rects):
    events, ys = [], set()
    for x1, y1, x2, y2 in rects:
        events.append((x1, y1, y2, 1))
        events.append((x2, y1, y2, -1))
        ys.add(y1); ys.add(y2)
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
    print(rect_area([(0, 0, 2, 2), (1, 1, 3, 3)]))  # 7
```

---

### Task 8 — The skyline problem

**Statement.** Given buildings `[left, right, height]`, return the skyline key points `[x, height]` where the outline height changes, left to right.

**Constraints.**
- `1 ≤ n ≤ 10^4`, `0 ≤ left < right ≤ 2^31 - 1`, `1 ≤ height ≤ 2^31 - 1`.

**Hints.**
- Start event `(left, -height)`, end event `(right, +height)`; sort by `(x, h)`.
- Maintain a multiset/heap of active heights with a ground level `0`.
- Emit a key point whenever the current max active height changes.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func getSkyline(buildings [][3]int) [][2]int {
	type e struct{ x, h int }
	var ev []e
	for _, b := range buildings {
		ev = append(ev, e{b[0], -b[2]}, e{b[1], b[2]})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i].x != ev[j].x {
			return ev[i].x < ev[j].x
		}
		return ev[i].h < ev[j].h
	})
	active := map[int]int{0: 1}
	curMax := 0
	maxOf := func() int {
		m := 0
		for h, c := range active {
			if c > 0 && h > m {
				m = h
			}
		}
		return m
	}
	var res [][2]int
	for _, x := range ev {
		if x.h < 0 {
			active[-x.h]++
		} else {
			active[x.h]--
			if active[x.h] == 0 {
				delete(active, x.h)
			}
		}
		if m := maxOf(); m != curMax {
			res = append(res, [2]int{x.x, m})
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

public class Task8 {
    public List<int[]> getSkyline(int[][] buildings) {
        List<int[]> ev = new ArrayList<>();
        for (int[] b : buildings) {
            ev.add(new int[]{b[0], -b[2]});
            ev.add(new int[]{b[1], b[2]});
        }
        ev.sort((a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0])
                                       : Integer.compare(a[1], b[1]));
        TreeMap<Integer, Integer> active = new TreeMap<>();
        active.put(0, 1);
        int curMax = 0;
        List<int[]> res = new ArrayList<>();
        for (int[] e : ev) {
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
        for (int[] p : new Task8().getSkyline(new int[][]{{2,9,10},{3,7,15},{5,12,12}}))
            System.out.print(Arrays.toString(p) + " ");
    }
}
```

#### Python
```python
import heapq


def get_skyline(buildings):
    ev = []
    for left, right, h in buildings:
        ev.append((left, -h))
        ev.append((right, h))
    ev.sort()
    heap = [0]            # max-heap via negation; ground = 0
    counts = {0: 1}
    res, cur_max = [], 0
    for x, h in ev:
        if h < 0:
            heapq.heappush(heap, h)
            counts[-h] = counts.get(-h, 0) + 1
        else:
            counts[h] -= 1
        while heap and counts.get(-heap[0], 0) == 0:
            heapq.heappop(heap)
        m = -heap[0]
        if m != cur_max:
            res.append([x, m])
            cur_max = m
    return res


if __name__ == "__main__":
    print(get_skyline([(2, 9, 10), (3, 7, 15), (5, 12, 12)]))
    # [[2, 10], [3, 15], [7, 12], [12, 0]]
```

---

### Task 9 — Rectangle union perimeter

**Statement.** Given `n` axis-aligned rectangles, return the perimeter of their union (the total length of the boundary of the merged shape).

**Constraints.**
- `1 ≤ n ≤ 10^4`, integer coordinates in `[0, 10^6]`.

**Hints.**
- Sweep x; maintain the coverage segment tree, but also track the *number of covered segments* (the count of disjoint covered y-runs).
- Vertical perimeter contribution at an event = `|covered_after - covered_before|`.
- Horizontal contribution = `2 × (number of covered runs) × Δx`. Sum both.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type ev struct{ x, y1, y2, d int }
type cov struct {
	ys                  []int
	cnt, covered, runs  []int
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
		t.runs[node] = 1
	} else if r-l == 1 {
		t.covered[node] = 0
		t.runs[node] = 0
	} else {
		t.covered[node] = t.covered[2*node] + t.covered[2*node+1]
		t.runs[node] = t.runs[2*node] + t.runs[2*node+1]
		// merge adjacent runs touching at the split boundary
		if t.rightCovered(2*node) && t.leftCovered(2*node+1) {
			t.runs[node]--
		}
	}
}

// helpers: is the leftmost / rightmost leaf of a subtree covered?
func (t *cov) leftCovered(node int) bool  { return t.covered[node] > 0 && t.touchesLeft(node) }
func (t *cov) rightCovered(node int) bool { return t.covered[node] > 0 && t.touchesRight(node) }

// simplified: track run-merge via boolean flags computed on covered>0 at the boundary leaves.
func (t *cov) touchesLeft(node int) bool  { return t.covered[node] > 0 }
func (t *cov) touchesRight(node int) bool { return t.covered[node] > 0 }

func perimeter(rects [][4]int) int {
	var events []ev
	yset := map[int]bool{}
	for _, r := range rects {
		events = append(events, ev{r[0], r[1], r[3], 1}, ev{r[2], r[1], r[3], -1})
		yset[r[1]], yset[r[3]] = true, true
	}
	ys := []int{}
	for y := range yset {
		ys = append(ys, y)
	}
	sort.Ints(ys)
	sort.Slice(events, func(i, j int) bool { return events[i].x < events[j].x })
	n := len(ys)
	t := &cov{ys: ys, cnt: make([]int, 4*n), covered: make([]int, 4*n), runs: make([]int, 4*n)}
	perim, prevCov, prevX := 0, 0, events[0].x
	for i, e := range events {
		if i > 0 {
			perim += 2 * t.runs[1] * (e.x - prevX) // horizontal edges
		}
		prevX = e.x
		t.upd(1, 0, n-1, e.y1, e.y2, e.d)
		perim += abs(t.covered[1] - prevCov) // vertical edges
		prevCov = t.covered[1]
	}
	return perim
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	fmt.Println(perimeter([][4]int{{0, 0, 2, 2}})) // 8
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static int[] ys, cnt, cov, runs;

    static void upd(int node, int l, int r, int lo, int hi, int d) {
        if (hi <= ys[l] || ys[r] <= lo) return;
        if (lo <= ys[l] && ys[r] <= hi) cnt[node] += d;
        else {
            int m = (l + r) / 2;
            upd(2 * node, l, m, lo, hi, d);
            upd(2 * node + 1, m, r, lo, hi, d);
        }
        if (cnt[node] > 0) { cov[node] = ys[r] - ys[l]; runs[node] = 1; }
        else if (r - l == 1) { cov[node] = 0; runs[node] = 0; }
        else {
            cov[node] = cov[2 * node] + cov[2 * node + 1];
            runs[node] = runs[2 * node] + runs[2 * node + 1];
            if (cov[2 * node] > 0 && cov[2 * node + 1] > 0) runs[node]--; // merge touching runs
        }
    }

    static int perimeter(int[][] rects) {
        List<int[]> ev = new ArrayList<>(); // {x, y1, y2, d}
        TreeSet<Integer> ySet = new TreeSet<>();
        for (int[] r : rects) {
            ev.add(new int[]{r[0], r[1], r[3], 1});
            ev.add(new int[]{r[2], r[1], r[3], -1});
            ySet.add(r[1]); ySet.add(r[3]);
        }
        ys = ySet.stream().mapToInt(Integer::intValue).toArray();
        int n = ys.length;
        cnt = new int[4 * n]; cov = new int[4 * n]; runs = new int[4 * n];
        ev.sort((a, b) -> Integer.compare(a[0], b[0]));
        int perim = 0, prevCov = 0, prevX = ev.get(0)[0];
        for (int i = 0; i < ev.size(); i++) {
            int[] e = ev.get(i);
            if (i > 0) perim += 2 * runs[1] * (e[0] - prevX);
            prevX = e[0];
            upd(1, 0, n - 1, e[1], e[2], e[3]);
            perim += Math.abs(cov[1] - prevCov);
            prevCov = cov[1];
        }
        return perim;
    }

    public static void main(String[] args) {
        System.out.println(perimeter(new int[][]{{0, 0, 2, 2}})); // 8
    }
}
```

#### Python
```python
class Cov:
    def __init__(self, ys):
        self.ys = ys
        m = 4 * len(ys)
        self.cnt = [0] * m
        self.cov = [0] * m
        self.runs = [0] * m

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
            self.runs[node] = 1
        elif r - l == 1:
            self.cov[node] = 0
            self.runs[node] = 0
        else:
            self.cov[node] = self.cov[2 * node] + self.cov[2 * node + 1]
            self.runs[node] = self.runs[2 * node] + self.runs[2 * node + 1]
            if self.cov[2 * node] > 0 and self.cov[2 * node + 1] > 0:
                self.runs[node] -= 1  # merge touching runs


def perimeter(rects):
    events, ys = [], set()
    for x1, y1, x2, y2 in rects:
        events.append((x1, y1, y2, 1))
        events.append((x2, y1, y2, -1))
        ys.add(y1); ys.add(y2)
    ys = sorted(ys)
    events.sort(key=lambda e: e[0])
    t = Cov(ys)
    perim, prev_cov, prev_x = 0, 0, events[0][0]
    for i, (x, y1, y2, d) in enumerate(events):
        if i > 0:
            perim += 2 * t.runs[1] * (x - prev_x)
        prev_x = x
        t.upd(1, 0, len(ys) - 1, y1, y2, d)
        perim += abs(t.cov[1] - prev_cov)
        prev_cov = t.cov[1]
    return perim


if __name__ == "__main__":
    print(perimeter([(0, 0, 2, 2)]))  # 8
```

---

### Task 10 — Count points inside given rectangles (offline, sweep)

**Statement.** Given `m` query rectangles `[x1, y1, x2, y2]` (half-open) and `p` points `(px, py)`, return for each rectangle how many points lie inside it. Answer offline with a sweep.

**Constraints.**
- `1 ≤ m, p ≤ 10^5`, integer coordinates in `[0, 10^9]`.

**Hints.**
- Decompose each rectangle into two vertical-edge events: at `x1` add `+1`, at `x2` add `-1` to the answer using a 2-D prefix idea — or use a Fenwick tree on compressed y.
- Sort points and rectangle edges together by x; sweep, inserting points into a Fenwick tree keyed on y, and answer a rectangle's `+/-` edge with a y-range query.
- A rectangle count = `query(x2) - query(x1)` where `query(x)` counts points with `px < x` and `y1 ≤ py < y2`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type bit struct{ t []int }

func (b *bit) add(i, v int) {
	for ; i < len(b.t); i += i & (-i) {
		b.t[i] += v
	}
}
func (b *bit) sum(i int) int {
	s := 0
	for ; i > 0; i -= i & (-i) {
		s += b.t[i]
	}
	return s
}
func (b *bit) rangeSum(l, r int) int { return b.sum(r) - b.sum(l-1) }

func countPoints(rects [][4]int, points [][2]int) []int {
	// compress y
	yset := map[int]bool{}
	for _, p := range points {
		yset[p[1]] = true
	}
	ys := []int{}
	for y := range yset {
		ys = append(ys, y)
	}
	sort.Ints(ys)
	yidx := func(y int) int { return sort.SearchInts(ys, y) + 1 } // 1-based
	// y-range [y1, y2): compressed indices in [lower(y1), lower(y2)-1]
	lower := func(y int) int { return sort.SearchInts(ys, y) + 1 }

	type query struct{ x, y1, y2, sign, id int }
	var qs []query
	for id, r := range rects {
		qs = append(qs, query{r[0], r[1], r[3], -1, id})
		qs = append(qs, query{r[2], r[1], r[3], +1, id})
	}
	type pt struct{ x, y int }
	pts := make([]pt, len(points))
	for i, p := range points {
		pts[i] = pt{p[0], p[1]}
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].x < pts[j].x })
	sort.Slice(qs, func(i, j int) bool { return qs[i].x < qs[j].x })

	b := &bit{t: make([]int, len(ys)+2)}
	ans := make([]int, len(rects))
	pi := 0
	for _, q := range qs {
		for pi < len(pts) && pts[pi].x < q.x {
			b.add(yidx(pts[pi].y), 1)
			pi++
		}
		lo := lower(q.y1)
		hi := sort.SearchInts(ys, q.y2) // first index with y >= y2; exclusive
		cnt := b.rangeSum(lo, hi)
		ans[q.id] += q.sign * cnt
	}
	return ans
}

func main() {
	rects := [][4]int{{0, 0, 5, 5}, {1, 1, 3, 3}}
	points := [][2]int{{2, 2}, {4, 4}, {6, 6}}
	fmt.Println(countPoints(rects, points)) // [2 1]
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static int[] tree;

    static void add(int i, int v) { for (; i < tree.length; i += i & (-i)) tree[i] += v; }
    static int sum(int i) { int s = 0; for (; i > 0; i -= i & (-i)) s += tree[i]; return s; }

    static int idx(int[] ys, int y) { // first position with ys >= y, 1-based exclusive marker
        int lo = 0, hi = ys.length;
        while (lo < hi) { int m = (lo + hi) / 2; if (ys[m] < y) lo = m + 1; else hi = m; }
        return lo;
    }

    static int[] countPoints(int[][] rects, int[][] points) {
        TreeSet<Integer> ySet = new TreeSet<>();
        for (int[] p : points) ySet.add(p[1]);
        int[] ys = ySet.stream().mapToInt(Integer::intValue).toArray();
        tree = new int[ys.length + 2];

        // queries {x, y1, y2, sign, id}
        List<int[]> qs = new ArrayList<>();
        for (int id = 0; id < rects.length; id++) {
            qs.add(new int[]{rects[id][0], rects[id][1], rects[id][3], -1, id});
            qs.add(new int[]{rects[id][2], rects[id][1], rects[id][3], +1, id});
        }
        qs.sort((a, b) -> Integer.compare(a[0], b[0]));
        int[][] pts = points.clone();
        Arrays.sort(pts, (a, b) -> Integer.compare(a[0], b[0]));

        int[] ans = new int[rects.length];
        int pi = 0;
        for (int[] q : qs) {
            while (pi < pts.length && pts[pi][0] < q[0]) {
                add(idx(ys, pts[pi][1]) + 1, 1);
                pi++;
            }
            int lo = idx(ys, q[1]) + 1;       // first >= y1, 1-based
            int hi = idx(ys, q[2]);           // first >= y2 (exclusive), 0-based count
            int cnt = sum(hi) - sum(lo - 1);
            ans[q[4]] += q[3] * cnt;
        }
        return ans;
    }

    public static void main(String[] args) {
        int[][] rects = {{0, 0, 5, 5}, {1, 1, 3, 3}};
        int[][] points = {{2, 2}, {4, 4}, {6, 6}};
        System.out.println(Arrays.toString(countPoints(rects, points))); // [2, 1]
    }
}
```

#### Python
```python
import bisect


class BIT:
    def __init__(self, n):
        self.t = [0] * (n + 2)

    def add(self, i, v):
        while i < len(self.t):
            self.t[i] += v
            i += i & (-i)

    def sum(self, i):
        s = 0
        while i > 0:
            s += self.t[i]
            i -= i & (-i)
        return s

    def range_sum(self, l, r):
        return self.sum(r) - self.sum(l - 1)


def count_points(rects, points):
    ys = sorted({p[1] for p in points})
    bit = BIT(len(ys))
    # queries: (x, y1, y2, sign, id)
    qs = []
    for rid, (x1, y1, x2, y2) in enumerate(rects):
        qs.append((x1, y1, y2, -1, rid))
        qs.append((x2, y1, y2, +1, rid))
    qs.sort(key=lambda q: q[0])
    pts = sorted(points, key=lambda p: p[0])

    ans = [0] * len(rects)
    pi = 0
    for x, y1, y2, sign, rid in qs:
        while pi < len(pts) and pts[pi][0] < x:
            yi = bisect.bisect_left(ys, pts[pi][1]) + 1  # 1-based
            bit.add(yi, 1)
            pi += 1
        lo = bisect.bisect_left(ys, y1) + 1
        hi = bisect.bisect_left(ys, y2)  # exclusive upper (y < y2)
        ans[rid] += sign * bit.range_sum(lo, hi)
    return ans


if __name__ == "__main__":
    rects = [(0, 0, 5, 5), (1, 1, 3, 3)]
    points = [(2, 2), (4, 4), (6, 6)]
    print(count_points(rects, points))  # [2, 1]
```

---

## Advanced Tasks (5)

### Task 11 — Full Bentley–Ottmann: report all intersection points

**Statement.** Given `n` segments, report **all** intersection points. Implement the event-driven sweep with left/right/intersection events.

**Constraints.**
- `1 ≤ n ≤ 10^3` (so the simple status is fine), float or integer coordinates.
- Report each distinct intersection point once.

**Hints.**
- Maintain a sorted active list keyed by y-at-current-x; test only neighbors at insert/delete/swap.
- Enqueue discovered intersections strictly to the right of the current x; dedupe points.
- For a simpler-but-correct version, test each new segment against all active ones (the reference below) — exact same outputs, `O(n²)` worst case.

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
func inter(s, t [4]float64) (pt, bool) {
	s1, s2 := pt{s[0], s[1]}, pt{s[2], s[3]}
	t1, t2 := pt{t[0], t[1]}, pt{t[2], t[3]}
	d1, d2 := orient(t1, t2, s1), orient(t1, t2, s2)
	d3, d4 := orient(s1, s2, t1), orient(s1, s2, t2)
	if (d1 > 0) != (d2 > 0) && (d3 > 0) != (d4 > 0) {
		den := (s2.x-s1.x)*(t2.y-t1.y) - (s2.y-s1.y)*(t2.x-t1.x)
		if den == 0 {
			return pt{}, false
		}
		ua := ((t2.x-t1.x)*(s1.y-t1.y) - (t2.y-t1.y)*(s1.x-t1.x)) / den
		return pt{s1.x + ua*(s2.x-s1.x), s1.y + ua*(s2.y-s1.y)}, true
	}
	return pt{}, false
}

func reportAll(segs [][4]float64) []pt {
	for i := range segs {
		if segs[i][0] > segs[i][2] {
			segs[i][0], segs[i][1], segs[i][2], segs[i][3] = segs[i][2], segs[i][3], segs[i][0], segs[i][1]
		}
	}
	type e struct {
		x    float64
		left bool
		i    int
	}
	var ev []e
	for i, s := range segs {
		ev = append(ev, e{s[0], true, i}, e{s[2], false, i})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i].x != ev[j].x {
			return ev[i].x < ev[j].x
		}
		return ev[i].left && !ev[j].left
	})
	active := []int{}
	seen := map[[2]int]bool{}
	resSeen := map[pt]bool{}
	var res []pt
	for _, x := range ev {
		if x.left {
			for _, j := range active {
				key := [2]int{min(x.i, j), max(x.i, j)}
				if !seen[key] {
					seen[key] = true
					if p, ok := inter(segs[x.i], segs[j]); ok && !resSeen[p] {
						resSeen[p] = true
						res = append(res, p)
					}
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
	sort.Slice(res, func(i, j int) bool {
		if res[i].x != res[j].x {
			return res[i].x < res[j].x
		}
		return res[i].y < res[j].y
	})
	return res
}

func min(a, b int) int { if a < b { return a }; return b }
func max(a, b int) int { if a > b { return a }; return b }

func main() {
	fmt.Println(reportAll([][4]float64{{0, 0, 6, 6}, {0, 6, 6, 0}, {0, 2, 6, 2}}))
	// [{2 2} {3 3} {4 2}]
}
```

#### Java
```java
import java.util.*;

public class Task11 {
    static double orient(double ax, double ay, double bx, double by, double cx, double cy) {
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    }
    static double[] inter(double[] s, double[] t) {
        double d1 = orient(t[0],t[1],t[2],t[3],s[0],s[1]);
        double d2 = orient(t[0],t[1],t[2],t[3],s[2],s[3]);
        double d3 = orient(s[0],s[1],s[2],s[3],t[0],t[1]);
        double d4 = orient(s[0],s[1],s[2],s[3],t[2],t[3]);
        if ((d1 > 0) != (d2 > 0) && (d3 > 0) != (d4 > 0)) {
            double den = (s[2]-s[0])*(t[3]-t[1]) - (s[3]-s[1])*(t[2]-t[0]);
            if (den == 0) return null;
            double ua = ((t[2]-t[0])*(s[1]-t[1]) - (t[3]-t[1])*(s[0]-t[0])) / den;
            return new double[]{s[0]+ua*(s[2]-s[0]), s[1]+ua*(s[3]-s[1])};
        }
        return null;
    }

    static List<double[]> reportAll(double[][] segs) {
        for (double[] s : segs)
            if (s[0] > s[2]) { double a=s[0],b=s[1]; s[0]=s[2]; s[1]=s[3]; s[2]=a; s[3]=b; }
        List<double[]> ev = new ArrayList<>(); // {x, isLeft, idx}
        for (int i = 0; i < segs.length; i++) {
            ev.add(new double[]{segs[i][0], 1, i});
            ev.add(new double[]{segs[i][2], 0, i});
        }
        ev.sort((a, b) -> a[0] != b[0] ? Double.compare(a[0], b[0]) : Double.compare(b[1], a[1]));
        List<Integer> active = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        Set<String> ptSeen = new HashSet<>();
        List<double[]> res = new ArrayList<>();
        for (double[] e : ev) {
            int i = (int) e[2];
            if (e[1] == 1) {
                for (int j : active) {
                    long key = (long) Math.min(i, j) * 100000 + Math.max(i, j);
                    if (seen.add(key)) {
                        double[] p = inter(segs[i], segs[j]);
                        if (p != null && ptSeen.add(p[0] + "," + p[1])) res.add(p);
                    }
                }
                active.add(i);
            } else active.remove(Integer.valueOf(i));
        }
        res.sort((a, b) -> a[0] != b[0] ? Double.compare(a[0], b[0]) : Double.compare(a[1], b[1]));
        return res;
    }

    public static void main(String[] args) {
        for (double[] p : reportAll(new double[][]{{0,0,6,6},{0,6,6,0},{0,2,6,2}}))
            System.out.print(Arrays.toString(p) + " "); // [2,2] [3,3] [4,2]
    }
}
```

#### Python
```python
def orient(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def inter(s, t):
    d1 = orient(*t, s[0], s[1]); d2 = orient(*t, s[2], s[3])
    d3 = orient(*s, t[0], t[1]); d4 = orient(*s, t[2], t[3])
    if (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0):
        den = (s[2]-s[0])*(t[3]-t[1]) - (s[3]-s[1])*(t[2]-t[0])
        if den == 0:
            return None
        ua = ((t[2]-t[0])*(s[1]-t[1]) - (t[3]-t[1])*(s[0]-t[0])) / den
        return (s[0]+ua*(s[2]-s[0]), s[1]+ua*(s[3]-s[1]))
    return None


def report_all(segs):
    segs = [s if s[0] <= s[2] else (s[2], s[3], s[0], s[1]) for s in segs]
    ev = []
    for i, s in enumerate(segs):
        ev.append((s[0], 1, i))
        ev.append((s[2], 0, i))
    ev.sort(key=lambda e: (e[0], -e[1]))
    active, seen, res = [], set(), set()
    for _x, is_left, i in ev:
        if is_left:
            for j in active:
                key = (min(i, j), max(i, j))
                if key not in seen:
                    seen.add(key)
                    p = inter(segs[i], segs[j])
                    if p is not None:
                        res.add(p)
            active.append(i)
        else:
            active.remove(i)
    return sorted(res)


if __name__ == "__main__":
    print(report_all([(0, 0, 6, 6), (0, 6, 6, 0), (0, 2, 6, 2)]))
    # [(2.0, 2.0), (3.0, 3.0), (4.0, 2.0)]
```

---

### Task 12 — Closest pair of points by sweep

**Statement.** Given `n` points, return the smallest Euclidean distance between any two. Use the sweep approach (sort by x, maintain a y-ordered active window of width `δ`).

**Constraints.**
- `2 ≤ n ≤ 10^5`, integer coordinates in `[-10^9, 10^9]`.

**Hints.**
- Sort points by x. Keep an ordered-by-y set of "active" points whose x is within the current best `δ`.
- For each new point, only check active points within `[py - δ, py + δ]` in y (`O(1)` of them).
- Drop active points whose x is more than `δ` behind; update `δ` as you find closer pairs.

#### Go
```go
package main

import (
	"fmt"
	"math"
	"sort"
)

type point struct{ x, y float64 }

func dist(a, b point) float64 {
	dx, dy := a.x-b.x, a.y-b.y
	return math.Sqrt(dx*dx + dy*dy)
}

func closestPair(pts []point) float64 {
	sort.Slice(pts, func(i, j int) bool { return pts[i].x < pts[j].x })
	best := math.Inf(1)
	// active points sorted by y (simple slice with linear window scan; fine for the window)
	active := []point{}
	left := 0
	for _, p := range pts {
		for left < len(active) && p.x-active[left].x > best {
			left++
		}
		win := active[left:]
		for _, q := range win {
			if math.Abs(q.y-p.y) <= best {
				if d := dist(p, q); d < best {
					best = d
				}
			}
		}
		active = append(active, p)
	}
	return best
}

func main() {
	pts := []point{{0, 0}, {3, 4}, {1, 1}, {5, 5}}
	fmt.Printf("%.4f\n", closestPair(pts)) // 1.4142
}
```

#### Java
```java
import java.util.*;

public class Task12 {
    record P(double x, double y) {}

    static double dist(P a, P b) {
        double dx = a.x() - b.x(), dy = a.y() - b.y();
        return Math.sqrt(dx * dx + dy * dy);
    }

    static double closestPair(P[] pts) {
        Arrays.sort(pts, (a, b) -> Double.compare(a.x(), b.x()));
        double best = Double.POSITIVE_INFINITY;
        // active set ordered by y; TreeSet with a window subSet
        TreeSet<P> active = new TreeSet<>((a, b) ->
                a.y() != b.y() ? Double.compare(a.y(), b.y()) : Double.compare(a.x(), b.x()));
        int left = 0;
        List<P> order = Arrays.asList(pts);
        for (int i = 0; i < pts.length; i++) {
            P p = pts[i];
            while (left < i && p.x() - order.get(left).x() > best) {
                active.remove(order.get(left));
                left++;
            }
            for (P q : active.subSet(new P(0, p.y() - best), true, new P(0, p.y() + best), true)) {
                best = Math.min(best, dist(p, q));
            }
            active.add(p);
        }
        return best;
    }

    public static void main(String[] args) {
        P[] pts = {new P(0, 0), new P(3, 4), new P(1, 1), new P(5, 5)};
        System.out.printf("%.4f%n", closestPair(pts)); // 1.4142
    }
}
```

#### Python
```python
import math
from sortedcontainers import SortedList  # pip install sortedcontainers


def closest_pair(pts):
    pts.sort(key=lambda p: p[0])
    best = float("inf")
    active = SortedList(key=lambda p: p[1])  # ordered by y
    left = 0
    for i, p in enumerate(pts):
        while left < i and p[0] - pts[left][0] > best:
            active.remove(pts[left])
            left += 1
        lo = active.bisect_key_left(p[1] - best)
        hi = active.bisect_key_right(p[1] + best)
        for q in active[lo:hi]:
            d = math.dist(p, q)
            if d < best:
                best = d
        active.add(p)
    return best


if __name__ == "__main__":
    print(round(closest_pair([(0, 0), (3, 4), (1, 1), (5, 5)]), 4))  # 1.4142
```

---

### Task 13 — Klee's measure (1-D max coverage depth over time)

**Statement.** Given `n` segments `[l, r]`, return the maximum "depth" — the largest number of segments covering any single point — and the total length over which that maximum depth is achieved.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ l ≤ r ≤ 10^9`.

**Hints.**
- Sweep `+1`/`-1` events; track the running depth and where it changes.
- Between consecutive events the depth is constant; accumulate length for gaps at the max depth.
- Two passes or a single pass tracking `(max_depth, length_at_max)` updated as the max grows or matches.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxDepth(segs [][2]int) (int, int) {
	ev := make([][2]int, 0, 2*len(segs))
	for _, s := range segs {
		ev = append(ev, [2]int{s[0], 1}, [2]int{s[1], -1})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i][0] != ev[j][0] {
			return ev[i][0] < ev[j][0]
		}
		return ev[i][1] > ev[j][1] // starts before ends (closed-interval depth)
	})
	depth, maxD, lenAtMax, prev := 0, 0, 0, ev[0][0]
	for _, e := range ev {
		if depth == maxD && maxD > 0 {
			lenAtMax += e[0] - prev
		} else if depth > maxD {
			maxD = depth
			lenAtMax = e[0] - prev
		}
		prev = e[0]
		depth += e[1]
	}
	return maxD, lenAtMax
}

func main() {
	d, l := maxDepth([][2]int{{1, 5}, {2, 6}, {4, 7}})
	fmt.Println(d, l) // 3 1   (depth 3 over [4,5))
}
```

#### Java
```java
import java.util.*;

public class Task13 {
    static int[] maxDepth(int[][] segs) {
        int[][] ev = new int[segs.length * 2][2];
        int i = 0;
        for (int[] s : segs) { ev[i++] = new int[]{s[0], 1}; ev[i++] = new int[]{s[1], -1}; }
        Arrays.sort(ev, (a, b) ->
                a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(b[1], a[1]));
        int depth = 0, maxD = 0, lenAtMax = 0, prev = ev[0][0];
        for (int[] e : ev) {
            if (depth == maxD && maxD > 0) lenAtMax += e[0] - prev;
            else if (depth > maxD) { maxD = depth; lenAtMax = e[0] - prev; }
            prev = e[0];
            depth += e[1];
        }
        return new int[]{maxD, lenAtMax};
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(maxDepth(new int[][]{{1, 5}, {2, 6}, {4, 7}}))); // [3, 1]
    }
}
```

#### Python
```python
def max_depth(segs):
    ev = []
    for l, r in segs:
        ev.append((l, 1))
        ev.append((r, -1))
    # starts (+1) before ends (-1) at equal x for closed-interval depth
    ev.sort(key=lambda e: (e[0], -e[1]))
    depth = max_d = len_at_max = 0
    prev = ev[0][0]
    for x, d in ev:
        if depth == max_d and max_d > 0:
            len_at_max += x - prev
        elif depth > max_d:
            max_d = depth
            len_at_max = x - prev
        prev = x
        depth += d
    return max_d, len_at_max


if __name__ == "__main__":
    print(max_depth([(1, 5), (2, 6), (4, 7)]))  # (3, 1)
```

---

### Task 14 — Number of integer points covered by ≥ 1 of n 1-D segments

**Statement.** Given `n` integer segments `[l, r]` (inclusive), return how many distinct integer points are covered by at least one segment.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ l ≤ r ≤ 10^9`.

**Hints.**
- Sweep with inclusive intervals: a point `x` is covered if some segment has `l ≤ x ≤ r`.
- Use the union-of-segments idea but count integer points: for each maximal covered run `[a, b]`, add `b - a + 1`.
- Merge overlapping/adjacent inclusive intervals first, then sum integer lengths.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func coveredIntegers(segs [][2]int) int {
	sort.Slice(segs, func(i, j int) bool { return segs[i][0] < segs[j][0] })
	total := 0
	curL, curR := segs[0][0], segs[0][1]
	for _, s := range segs[1:] {
		if s[0] <= curR+1 { // adjacent inclusive intervals merge
			if s[1] > curR {
				curR = s[1]
			}
		} else {
			total += curR - curL + 1
			curL, curR = s[0], s[1]
		}
	}
	total += curR - curL + 1
	return total
}

func main() {
	fmt.Println(coveredIntegers([][2]int{{1, 3}, {2, 5}, {7, 8}})) // 7  ([1,5]=5, [7,8]=2)
}
```

#### Java
```java
import java.util.*;

public class Task14 {
    static long coveredIntegers(int[][] segs) {
        Arrays.sort(segs, (a, b) -> Integer.compare(a[0], b[0]));
        long total = 0;
        int curL = segs[0][0], curR = segs[0][1];
        for (int i = 1; i < segs.length; i++) {
            if (segs[i][0] <= curR + 1) curR = Math.max(curR, segs[i][1]);
            else { total += curR - curL + 1; curL = segs[i][0]; curR = segs[i][1]; }
        }
        total += curR - curL + 1;
        return total;
    }

    public static void main(String[] args) {
        System.out.println(coveredIntegers(new int[][]{{1, 3}, {2, 5}, {7, 8}})); // 7
    }
}
```

#### Python
```python
def covered_integers(segs):
    segs.sort(key=lambda s: s[0])
    total = 0
    cur_l, cur_r = segs[0]
    for l, r in segs[1:]:
        if l <= cur_r + 1:  # adjacent inclusive intervals merge
            cur_r = max(cur_r, r)
        else:
            total += cur_r - cur_l + 1
            cur_l, cur_r = l, r
    total += cur_r - cur_l + 1
    return total


if __name__ == "__main__":
    print(covered_integers([(1, 3), (2, 5), (7, 8)]))  # 7
```

---

### Task 15 — Maximum points covered by a sliding window of width W (1-D)

**Statement.** Given `n` points on a line and a window width `W`, find the maximum number of points that can be covered by a single closed window `[x, x + W]`. Solve with a sweep / two-pointer over sorted points.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `1 ≤ W ≤ 10^9`, integer coordinates in `[0, 10^9]`.

**Hints.**
- Sort points; for each point as the *left* edge of the window, count how many fall in `[p, p + W]`.
- A two-pointer sweep over the sorted points runs in `O(n)` after the `O(n log n)` sort.
- This is a degenerate sweep: the "line" is the moving window's left edge.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxInWindow(points []int, w int) int {
	sort.Ints(points)
	best, right := 0, 0
	for left := 0; left < len(points); left++ {
		if right < left {
			right = left
		}
		for right < len(points) && points[right] <= points[left]+w {
			right++
		}
		if right-left > best {
			best = right - left
		}
	}
	return best
}

func main() {
	fmt.Println(maxInWindow([]int{1, 2, 3, 10, 11}, 2)) // 3  ([1,3])
}
```

#### Java
```java
import java.util.*;

public class Task15 {
    static int maxInWindow(int[] points, int w) {
        Arrays.sort(points);
        int best = 0, right = 0;
        for (int left = 0; left < points.length; left++) {
            if (right < left) right = left;
            while (right < points.length && points[right] <= points[left] + w) right++;
            best = Math.max(best, right - left);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxInWindow(new int[]{1, 2, 3, 10, 11}, 2)); // 3
    }
}
```

#### Python
```python
def max_in_window(points, w):
    points.sort()
    best = right = 0
    for left in range(len(points)):
        if right < left:
            right = left
        while right < len(points) and points[right] <= points[left] + w:
            right += 1
        best = max(best, right - left)
    return best


if __name__ == "__main__":
    print(max_in_window([1, 2, 3, 10, 11], 2))  # 3
```

---

## Benchmark Task

> Compare performance across all 3 languages: sweep-line max-overlap vs the naive `O(n²)` point-by-point counter on random intervals. The sweep should pull ahead sharply as `n` grows.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
	"time"
)

func sweep(intervals [][2]int) int {
	ev := make([][2]int, 0, 2*len(intervals))
	for _, iv := range intervals {
		ev = append(ev, [2]int{iv[0], 1}, [2]int{iv[1], -1})
	}
	sort.Slice(ev, func(i, j int) bool {
		if ev[i][0] != ev[j][0] {
			return ev[i][0] < ev[j][0]
		}
		return ev[i][1] < ev[j][1]
	})
	active, best := 0, 0
	for _, e := range ev {
		active += e[1]
		if active > best {
			best = active
		}
	}
	return best
}

func main() {
	sizes := []int{10, 100, 1000, 10000, 100000}
	for _, n := range sizes {
		iv := make([][2]int, n)
		for i := range iv {
			a := rand.Intn(1_000_000)
			iv[i] = [2]int{a, a + rand.Intn(1000) + 1}
		}
		start := time.Now()
		for i := 0; i < 20; i++ {
			cp := make([][2]int, n)
			copy(cp, iv)
			sweep(cp)
		}
		fmt.Printf("n=%7d: %.3f ms\n", n, float64(time.Since(start).Microseconds())/20.0/1000.0)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    static int sweep(int[][] iv) {
        int[][] ev = new int[iv.length * 2][2];
        int k = 0;
        for (int[] x : iv) { ev[k++] = new int[]{x[0], 1}; ev[k++] = new int[]{x[1], -1}; }
        Arrays.sort(ev, (a, b) ->
                a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        int active = 0, best = 0;
        for (int[] e : ev) { active += e[1]; best = Math.max(best, active); }
        return best;
    }

    public static void main(String[] args) {
        int[] sizes = {10, 100, 1000, 10000, 100000};
        Random rnd = new Random(42);
        for (int n : sizes) {
            int[][] iv = new int[n][2];
            for (int i = 0; i < n; i++) {
                int a = rnd.nextInt(1_000_000);
                iv[i] = new int[]{a, a + rnd.nextInt(1000) + 1};
            }
            long start = System.nanoTime();
            for (int i = 0; i < 20; i++) sweep(iv.clone());
            System.out.printf("n=%7d: %.3f ms%n", n, (System.nanoTime() - start) / 20.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import random
import timeit


def sweep(intervals):
    ev = []
    for s, e in intervals:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort()
    active = best = 0
    for _x, d in ev:
        active += d
        best = max(best, active)
    return best


sizes = [10, 100, 1_000, 10_000, 100_000]
for n in sizes:
    data = [(a := random.randint(0, 10**6), a + random.randint(1, 1000)) for _ in range(n)]
    t = timeit.timeit(lambda: sweep(list(data)), number=20)
    print(f"n={n:>7}: {t / 20 * 1000:.3f} ms")
```

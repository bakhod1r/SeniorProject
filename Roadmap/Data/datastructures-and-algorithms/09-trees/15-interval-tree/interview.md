# Interval Tree — Interview Problems

> **Audience:** Anyone preparing for coding interviews where intervals, scheduling, or overlap queries appear. Most of these problems do *not* require building a full interval tree — sorting + a heap or a TreeMap is often enough — but recognizing the interval-tree mental model is what makes them feel easy.

Each problem includes a brief problem statement, the recommended approach, and solutions in Go, Java, and Python.

---

## Table of Contents

1. [LC 56 — Merge Intervals](#lc-56)
2. [LC 57 — Insert Interval](#lc-57)
3. [LC 252 — Meeting Rooms](#lc-252)
4. [LC 253 — Meeting Rooms II](#lc-253)
5. [LC 715 — Range Module](#lc-715)
6. [LC 729 / 731 / 732 — My Calendar I / II / III](#lc-729)
7. [LC 1893 — Check if All the Integers in a Range Are Covered](#lc-1893)
8. [LC 850 — Rectangle Area II](#lc-850)
9. [LC 218 — The Skyline Problem](#lc-218)
10. [Design a Calendar with Insert / Delete / Query-Overlaps in O(log n + k)](#design-calendar)

---

<a name="lc-56"></a>
## 1. LC 56 — Merge Intervals

> Given a collection of intervals, merge all overlapping intervals.

Sort by start, then walk and merge. O(n log n).

```go
func merge(intervals [][]int) [][]int {
    sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
    out := [][]int{}
    for _, iv := range intervals {
        if len(out) > 0 && iv[0] <= out[len(out)-1][1] {
            if iv[1] > out[len(out)-1][1] {
                out[len(out)-1][1] = iv[1]
            }
        } else {
            out = append(out, iv)
        }
    }
    return out
}
```

```java
public int[][] merge(int[][] intervals) {
    Arrays.sort(intervals, (a, b) -> a[0] - b[0]);
    List<int[]> out = new ArrayList<>();
    for (int[] iv : intervals) {
        if (!out.isEmpty() && iv[0] <= out.get(out.size()-1)[1]) {
            out.get(out.size()-1)[1] = Math.max(out.get(out.size()-1)[1], iv[1]);
        } else {
            out.add(iv);
        }
    }
    return out.toArray(new int[0][]);
}
```

```python
def merge(intervals):
    intervals.sort()
    out = []
    for lo, hi in intervals:
        if out and lo <= out[-1][1]:
            out[-1][1] = max(out[-1][1], hi)
        else:
            out.append([lo, hi])
    return out
```

---

<a name="lc-57"></a>
## 2. LC 57 — Insert Interval

> Given a sorted list of non-overlapping intervals and a new interval, insert and merge.

Walk left of `newInterval`, merge overlaps, walk right. O(n).

```go
func insert(intervals [][]int, ni []int) [][]int {
    var out [][]int
    i, n := 0, len(intervals)
    for i < n && intervals[i][1] < ni[0] { out = append(out, intervals[i]); i++ }
    for i < n && intervals[i][0] <= ni[1] {
        if intervals[i][0] < ni[0] { ni[0] = intervals[i][0] }
        if intervals[i][1] > ni[1] { ni[1] = intervals[i][1] }
        i++
    }
    out = append(out, ni)
    for i < n { out = append(out, intervals[i]); i++ }
    return out
}
```

```java
public int[][] insert(int[][] intervals, int[] ni) {
    List<int[]> out = new ArrayList<>();
    int i = 0, n = intervals.length;
    while (i < n && intervals[i][1] < ni[0]) out.add(intervals[i++]);
    while (i < n && intervals[i][0] <= ni[1]) {
        ni[0] = Math.min(ni[0], intervals[i][0]);
        ni[1] = Math.max(ni[1], intervals[i][1]);
        i++;
    }
    out.add(ni);
    while (i < n) out.add(intervals[i++]);
    return out.toArray(new int[0][]);
}
```

```python
def insert(intervals, ni):
    out, i, n = [], 0, len(intervals)
    while i < n and intervals[i][1] < ni[0]:
        out.append(intervals[i]); i += 1
    while i < n and intervals[i][0] <= ni[1]:
        ni = [min(ni[0], intervals[i][0]), max(ni[1], intervals[i][1])]
        i += 1
    out.append(ni)
    while i < n:
        out.append(intervals[i]); i += 1
    return out
```

---

<a name="lc-252"></a>
## 3. LC 252 — Meeting Rooms

> Can a person attend all meetings without conflict?

Sort by start, check adjacent overlap. O(n log n).

```go
func canAttendMeetings(intervals [][]int) bool {
    sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
    for i := 1; i < len(intervals); i++ {
        if intervals[i][0] < intervals[i-1][1] { return false }
    }
    return true
}
```

```java
public boolean canAttendMeetings(int[][] m) {
    Arrays.sort(m, (a, b) -> a[0] - b[0]);
    for (int i = 1; i < m.length; i++) if (m[i][0] < m[i-1][1]) return false;
    return true;
}
```

```python
def canAttendMeetings(m):
    m.sort()
    return all(m[i][0] >= m[i-1][1] for i in range(1, len(m)))
```

---

<a name="lc-253"></a>
## 4. LC 253 — Meeting Rooms II

> Minimum number of rooms required to host all meetings.

The max-overlap problem. Two clean approaches:

**Heap of end times** — O(n log n):

```go
func minMeetingRooms(m [][]int) int {
    sort.Slice(m, func(i, j int) bool { return m[i][0] < m[j][0] })
    h := &intHeap{}
    heap.Init(h)
    for _, iv := range m {
        if h.Len() > 0 && (*h)[0] <= iv[0] { heap.Pop(h) }
        heap.Push(h, iv[1])
    }
    return h.Len()
}
// (intHeap is a min-heap of ints; omitted for brevity)
```

**Difference-array sweep** — O(n log n):

```python
def minMeetingRooms(meetings):
    events = []
    for s, e in meetings:
        events.append((s, +1))
        events.append((e, -1))
    events.sort()
    active = best = 0
    for _, d in events:
        active += d
        best = max(best, active)
    return best
```

```java
public int minMeetingRooms(int[][] m) {
    int n = m.length;
    int[] s = new int[n], e = new int[n];
    for (int i = 0; i < n; i++) { s[i] = m[i][0]; e[i] = m[i][1]; }
    Arrays.sort(s); Arrays.sort(e);
    int rooms = 0, best = 0, j = 0;
    for (int i = 0; i < n; i++) {
        if (s[i] < e[j]) rooms++;
        else j++;
        best = Math.max(best, rooms);
    }
    return best;
}
```

---

<a name="lc-715"></a>
## 5. LC 715 — Range Module

> Implement `addRange`, `queryRange`, `removeRange` on half-open `[left, right)`.

This is the interval-merging structure from `middle.md` section 8. Use a `TreeMap<Integer, Integer>` keyed by `lo`, value `hi`.

```java
class RangeModule {
    TreeMap<Integer, Integer> map = new TreeMap<>();

    public void addRange(int left, int right) {
        var lo = map.floorKey(left);
        var hi = map.floorKey(right);
        if (lo != null && map.get(lo) >= left)  left  = lo;
        if (hi != null && map.get(hi) >  right) right = map.get(hi);
        map.subMap(left, right).clear();
        map.put(left, right);
    }
    public boolean queryRange(int left, int right) {
        var lo = map.floorKey(left);
        return lo != null && map.get(lo) >= right;
    }
    public void removeRange(int left, int right) {
        var lo = map.floorKey(left);
        var hi = map.floorKey(right);
        if (hi != null && map.get(hi) > right) map.put(right, map.get(hi));
        if (lo != null && map.get(lo) > left)  map.put(lo, left);
        map.subMap(left, right).clear();
    }
}
```

(Go and Python versions in `middle.md` section 8.)

---

<a name="lc-729"></a>
## 6. LC 729 / 731 / 732 — My Calendar I / II / III

**My Calendar I.** Add event `[start, end)` if it doesn't overlap any existing event. Use a `TreeMap`, check `floorEntry` and `ceilingEntry`. O(log n) per booking.

**My Calendar II.** Allow up to two overlaps. Maintain two TreeMaps — one of single bookings, one of overlap regions. Reject a booking that would overlap any region already in the overlap TreeMap.

**My Calendar III.** Return the max-overlap count after each booking. The chromatic-number problem; use the difference-array technique with a TreeMap.

```python
from sortedcontainers import SortedDict
class MyCalendarThree:
    def __init__(self):
        self.delta = SortedDict()
    def book(self, s, e):
        self.delta[s] = self.delta.get(s, 0) + 1
        self.delta[e] = self.delta.get(e, 0) - 1
        active = best = 0
        for d in self.delta.values():
            active += d
            best = max(best, active)
        return best
```

Pure simplicity, O(n) per booking. For large `n` use an interval tree augmented with `subtreeOverlap` to get O(log n) per booking.

---

<a name="lc-1893"></a>
## 7. LC 1893 — Check if All the Integers in a Range Are Covered

> Given a list of intervals and `[left, right]`, are all integers in `[left, right]` covered by some interval?

Domain is tiny (≤ 50); use a boolean array. For larger domains, sort by start and walk:

```python
def isCovered(ranges, left, right):
    ranges.sort()
    for lo, hi in ranges:
        if lo > left: return False
        left = max(left, hi + 1)
        if left > right: return True
    return left > right
```

```go
func isCovered(ranges [][]int, left, right int) bool {
    sort.Slice(ranges, func(i, j int) bool { return ranges[i][0] < ranges[j][0] })
    for _, r := range ranges {
        if r[0] > left { return false }
        if r[1]+1 > left { left = r[1] + 1 }
        if left > right { return true }
    }
    return left > right
}
```

```java
public boolean isCovered(int[][] ranges, int left, int right) {
    Arrays.sort(ranges, (a, b) -> a[0] - b[0]);
    for (int[] r : ranges) {
        if (r[0] > left) return false;
        left = Math.max(left, r[1] + 1);
        if (left > right) return true;
    }
    return left > right;
}
```

---

<a name="lc-850"></a>
## 8. LC 850 — Rectangle Area II

> Total area covered by a list of axis-aligned rectangles (modulo 10⁹+7).

Sweep-line over x-coordinates; at each x-event, maintain the active set of y-intervals and compute the total y-coverage (union of intervals). The y-coverage computation per event is itself an interval-overlap problem. Coordinate-compress y, and for each strip compute `Σ (height * Δx)`.

```python
def rectangleArea(rectangles):
    MOD = 10**9 + 7
    xs = sorted({x for r in rectangles for x in (r[0], r[2])})
    idx = {x: i for i, x in enumerate(xs)}
    count = [0] * len(xs)
    events = []
    for x1, y1, x2, y2 in rectangles:
        events.append((y1, +1, x1, x2))
        events.append((y2, -1, x1, x2))
    events.sort()
    prev_y, area = events[0][0], 0
    for y, sgn, x1, x2 in events:
        covered = 0
        for i in range(len(xs)-1):
            if count[i] > 0:
                covered += xs[i+1] - xs[i]
        area = (area + covered * (y - prev_y)) % MOD
        for i in range(idx[x1], idx[x2]):
            count[i] += sgn
        prev_y = y
    return area
```

For the O((n log n)²) brute approach above to become O(n² log n) for large n, use a segment tree with lazy propagation over the y-axis. We cover that in `tasks.md`.

---

<a name="lc-218"></a>
## 9. LC 218 — The Skyline Problem

> Compute the skyline outline from a list of buildings `[left, right, height]`.

Sweep-line: at each x-event (building start or end), maintain the multiset of active heights. Output the current max height whenever it changes.

```python
import heapq
def getSkyline(buildings):
    events = []
    for L, R, H in buildings:
        events.append((L, -H, R))     # start: negative for sorting
        events.append((R, 0, 0))      # end marker
    events.sort()
    res, heap = [], [(0, float('inf'))]
    for x, negH, R in events:
        if negH != 0:
            heapq.heappush(heap, (negH, R))
        while heap[0][1] <= x:
            heapq.heappop(heap)
        h = -heap[0][0]
        if not res or res[-1][1] != h:
            res.append([x, h])
    return res
```

```java
public List<List<Integer>> getSkyline(int[][] b) {
    List<int[]> events = new ArrayList<>();
    for (int[] bld : b) {
        events.add(new int[]{bld[0], -bld[2], bld[1]});
        events.add(new int[]{bld[1], 0, 0});
    }
    events.sort((a, c) -> a[0] != c[0] ? a[0] - c[0] : a[1] - c[1]);
    PriorityQueue<int[]> pq = new PriorityQueue<>((x, y) -> y[0] - x[0]);
    pq.offer(new int[]{0, Integer.MAX_VALUE});
    List<List<Integer>> res = new ArrayList<>();
    for (int[] e : events) {
        if (e[1] != 0) pq.offer(new int[]{-e[1], e[2]});
        while (pq.peek()[1] <= e[0]) pq.poll();
        int h = pq.peek()[0];
        if (res.isEmpty() || res.get(res.size()-1).get(1) != h) {
            res.add(Arrays.asList(e[0], h));
        }
    }
    return res;
}
```

```go
// see Python version for the algorithm; Go's container/heap implements it analogously
```

An augmented BST with "max height in subtree" augmentation can replace the heap in pure-online settings.

---

<a name="design-calendar"></a>
## 10. Design a Calendar with Insert / Delete / Query-Overlaps in O(log n + k)

> Implement a calendar supporting:
> - `insert(start, end)`
> - `delete(start, end)`
> - `query(start, end) -> list of overlapping events`

This is the production interval tree. Use the CLRS augmented red-black tree from `junior.md`/`middle.md`. Key correctness criteria the interviewer is checking:

1. **You name "augmented BST" or "interval tree" within 30 seconds.**
2. **You state the augmentation: `subtreeMax = max(hi in subtree)`.**
3. **You state the prune conditions:**
   - Recurse left iff `left.subtreeMax >= q.lo`.
   - Recurse right iff `node.lo <= q.hi`.
4. **You state the asymptotic: O(log n + k) per query, O(log n) per insert/delete.**
5. **You handle the open/closed convention explicitly** ("calendar is half-open `[start, end)`").

Then you write the code from `junior.md` section 9, wrap it in a public API, and discuss balancing.

Bonus points for mentioning:

- **Recurring events** — store recurrence rules, expand on query.
- **Time zones** — store events in UTC, render in local time.
- **Cross-region replication** — partition by user; per-user interval tree replicated synchronously.

This problem appears at Google, Microsoft, Facebook system-design rounds at L4/L5 and as a coding question at Apple. The interviewer wants to see that you map "find overlapping events fast" to "augmented BST", not that you reimplement red-black rotations under time pressure.

---

**Where to go next.** `tasks.md` has 10 hands-on tasks with reference solutions to drill the interval-tree skill set.

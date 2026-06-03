# Interval Scheduling Variations — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a brute-force oracle early — enumerate subsets (selection/weighted), permutations (lateness), and a point-sweep (depth). Known checks: triangle of meetings → 2 rooms, weighted with one fat interval → that interval, EDF on the canonical 6-job set → max lateness 1.

---

## Beginner Tasks (5)

### Task 1 — Activity selection (max count)

**Problem.** Given `n` intervals, return the maximum number of mutually compatible (non-overlapping) intervals.

**Constraints.** `0 ≤ n ≤ 10^5`. Half-open `[start, finish)` (touching is compatible).

**Hint.** Sort by **finish**; sweep with `lastEnd`; take when `start ≥ lastEnd`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxCount(iv [][2]int) int {
	sort.Slice(iv, func(i, j int) bool { return iv[i][1] < iv[j][1] })
	cnt, last := 0, -1<<62
	for _, x := range iv {
		if x[0] >= last {
			cnt++
			last = x[1]
		}
	}
	return cnt
}

func main() {
	fmt.Println(maxCount([][2]int{{1, 4}, {3, 5}, {0, 6}, {5, 7}, {8, 11}})) // 3
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    static int maxCount(int[][] iv) {
        Arrays.sort(iv, Comparator.comparingInt(a -> a[1]));
        int cnt = 0, last = Integer.MIN_VALUE;
        for (int[] x : iv) if (x[0] >= last) { cnt++; last = x[1]; }
        return cnt;
    }
    public static void main(String[] args) {
        System.out.println(maxCount(new int[][]{{1,4},{3,5},{0,6},{5,7},{8,11}})); // 3
    }
}
```

#### Python
```python
def max_count(iv):
    iv.sort(key=lambda x: x[1])
    cnt, last = 0, float("-inf")
    for s, f in iv:
        if s >= last:
            cnt += 1
            last = f
    return cnt


print(max_count([(1, 4), (3, 5), (0, 6), (5, 7), (8, 11)]))  # 3
```

---

### Task 2 — Minimum rooms (interval partitioning)

**Problem.** Given meeting intervals, return the minimum number of rooms so no two overlapping meetings share a room.

**Constraints.** `0 ≤ n ≤ 10^5`.

**Hint.** Sort by **start**; min-heap of end times; reuse when `heap.min ≤ start`; answer = peak heap size.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type MinHeap []int

func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MinHeap) Pop() interface{} {
	o := *h
	v := o[len(o)-1]
	*h = o[:len(o)-1]
	return v
}

func minRooms(iv [][2]int) int {
	sort.Slice(iv, func(i, j int) bool { return iv[i][0] < iv[j][0] })
	h := &MinHeap{}
	heap.Init(h)
	best := 0
	for _, x := range iv {
		if h.Len() > 0 && (*h)[0] <= x[0] {
			heap.Pop(h)
		}
		heap.Push(h, x[1])
		if h.Len() > best {
			best = h.Len()
		}
	}
	return best
}

func main() {
	fmt.Println(minRooms([][2]int{{0, 30}, {5, 10}, {15, 20}})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static int minRooms(int[][] iv) {
        Arrays.sort(iv, Comparator.comparingInt(a -> a[0]));
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        int best = 0;
        for (int[] x : iv) {
            if (!pq.isEmpty() && pq.peek() <= x[0]) pq.poll();
            pq.add(x[1]);
            best = Math.max(best, pq.size());
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(minRooms(new int[][]{{0,30},{5,10},{15,20}})); // 2
    }
}
```

#### Python
```python
import heapq


def min_rooms(iv):
    iv.sort(key=lambda x: x[0])
    heap, best = [], 0
    for s, e in iv:
        if heap and heap[0] <= s:
            heapq.heappop(heap)
        heapq.heappush(heap, e)
        best = max(best, len(heap))
    return best


print(min_rooms([(0, 30), (5, 10), (15, 20)]))  # 2
```

---

### Task 3 — Maximum overlap depth (sweep line)

**Problem.** Return the depth = the maximum number of intervals overlapping at any instant — *without* a heap. Verify it equals the room count from Task 2.

**Constraints.** `0 ≤ n ≤ 10^5`.

**Hint.** `+1` events at starts, `−1` at ends; sort by `(time, delta)` with `−1` before `+1` at ties (half-open); running max of the prefix sum.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func depth(iv [][2]int) int {
	type ev struct{ t, d int }
	var evs []ev
	for _, x := range iv {
		evs = append(evs, ev{x[0], 1}, ev{x[1], -1})
	}
	sort.Slice(evs, func(i, j int) bool {
		if evs[i].t != evs[j].t {
			return evs[i].t < evs[j].t
		}
		return evs[i].d < evs[j].d // -1 before +1
	})
	cur, best := 0, 0
	for _, e := range evs {
		cur += e.d
		if cur > best {
			best = cur
		}
	}
	return best
}

func main() {
	fmt.Println(depth([][2]int{{0, 30}, {5, 10}, {15, 20}})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static int depth(int[][] iv) {
        int[][] ev = new int[iv.length * 2][2];
        int k = 0;
        for (int[] x : iv) { ev[k++] = new int[]{x[0], 1}; ev[k++] = new int[]{x[1], -1}; }
        Arrays.sort(ev, (a, b) -> a[0] != b[0] ? a[0] - b[0] : a[1] - b[1]);
        int cur = 0, best = 0;
        for (int[] e : ev) { cur += e[1]; best = Math.max(best, cur); }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(depth(new int[][]{{0,30},{5,10},{15,20}})); // 2
    }
}
```

#### Python
```python
def depth(iv):
    ev = []
    for s, e in iv:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort(key=lambda x: (x[0], x[1]))  # -1 before +1 at ties
    cur, best = 0, 0
    for _, d in ev:
        cur += d
        best = max(best, cur)
    return best


print(depth([(0, 30), (5, 10), (15, 20)]))  # 2
```

---

### Task 4 — Minimize maximum lateness (EDF)

**Problem.** Given jobs `(length, deadline)` on one machine, return the minimum achievable maximum lateness.

**Constraints.** `1 ≤ n ≤ 10^5`. Use 64-bit time.

**Hint.** Sort by **deadline**; run back-to-back; `lateness = max(0, finish − deadline)`; track the max.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func minMaxLateness(jobs [][2]int) int {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i][1] < jobs[j][1] })
	t, worst := 0, 0
	for _, j := range jobs {
		t += j[0]
		if t-j[1] > worst {
			worst = t - j[1]
		}
	}
	return worst
}

func main() {
	fmt.Println(minMaxLateness([][2]int{{3, 6}, {2, 8}, {1, 9}, {4, 9}, {3, 14}, {2, 15}})) // 1
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    static int minMaxLateness(int[][] jobs) {
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1]));
        int t = 0, worst = 0;
        for (int[] j : jobs) { t += j[0]; worst = Math.max(worst, t - j[1]); }
        return worst;
    }
    public static void main(String[] args) {
        System.out.println(minMaxLateness(new int[][]{{3,6},{2,8},{1,9},{4,9},{3,14},{2,15}})); // 1
    }
}
```

#### Python
```python
def min_max_lateness(jobs):
    jobs.sort(key=lambda x: x[1])
    t, worst = 0, 0
    for length, deadline in jobs:
        t += length
        worst = max(worst, t - deadline)
    return worst


print(min_max_lateness([(3, 6), (2, 8), (1, 9), (4, 9), (3, 14), (2, 15)]))  # 1
```

---

### Task 5 — Non-overlapping intervals (min removals)

**Problem.** Return the minimum number of intervals to remove so the rest are non-overlapping (LeetCode 435).

**Constraints.** `1 ≤ n ≤ 10^5`. Here touching at an endpoint is allowed (compatible).

**Hint.** `removals = n − activity_selection`. Sort by finish, count kept.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func eraseOverlap(iv [][2]int) int {
	sort.Slice(iv, func(i, j int) bool { return iv[i][1] < iv[j][1] })
	kept, last := 0, -1<<62
	for _, x := range iv {
		if x[0] >= last {
			kept++
			last = x[1]
		}
	}
	return len(iv) - kept
}

func main() {
	fmt.Println(eraseOverlap([][2]int{{1, 2}, {2, 3}, {3, 4}, {1, 3}})) // 1
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static int eraseOverlap(int[][] iv) {
        Arrays.sort(iv, Comparator.comparingInt(a -> a[1]));
        int kept = 0, last = Integer.MIN_VALUE;
        for (int[] x : iv) if (x[0] >= last) { kept++; last = x[1]; }
        return iv.length - kept;
    }
    public static void main(String[] args) {
        System.out.println(eraseOverlap(new int[][]{{1,2},{2,3},{3,4},{1,3}})); // 1
    }
}
```

#### Python
```python
def erase_overlap(iv):
    iv.sort(key=lambda x: x[1])
    kept, last = 0, float("-inf")
    for s, e in iv:
        if s >= last:
            kept += 1
            last = e
    return len(iv) - kept


print(erase_overlap([(1, 2), (2, 3), (3, 4), (1, 3)]))  # 1
```

---

## Intermediate Tasks (5)

### Task 6 — Weighted interval scheduling (DP)

**Problem.** Each interval has a weight. Return the maximum total weight of a compatible subset.

**Constraints.** `1 ≤ n ≤ 10^5`, weights up to `10^9` (use 64-bit).

**Hint.** Sort by finish; `dp[j] = max(dp[j-1], w_j + dp[p(j)])`; binary-search `p(j)`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxWeight(iv [][3]int) int64 {
	sort.Slice(iv, func(i, j int) bool { return iv[i][1] < iv[j][1] })
	n := len(iv)
	dp := make([]int64, n+1)
	for j := 1; j <= n; j++ {
		lo, hi, p := 0, j-1, 0
		for lo <= hi {
			mid := (lo + hi) / 2
			if mid == 0 || iv[mid-1][1] <= iv[j-1][0] {
				p = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		take := int64(iv[j-1][2]) + dp[p]
		if take > dp[j-1] {
			dp[j] = take
		} else {
			dp[j] = dp[j-1]
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(maxWeight([][3]int{{1, 4, 10}, {3, 5, 20}, {0, 6, 100}, {5, 7, 30}, {8, 11, 40}})) // 140
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static long maxWeight(int[][] iv) {
        Arrays.sort(iv, Comparator.comparingInt(a -> a[1]));
        int n = iv.length;
        long[] dp = new long[n + 1];
        for (int j = 1; j <= n; j++) {
            int lo = 0, hi = j - 1, p = 0;
            while (lo <= hi) {
                int mid = (lo + hi) / 2;
                if (mid == 0 || iv[mid - 1][1] <= iv[j - 1][0]) { p = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            dp[j] = Math.max(dp[j - 1], (long) iv[j - 1][2] + dp[p]);
        }
        return dp[n];
    }
    public static void main(String[] args) {
        System.out.println(maxWeight(new int[][]{{1,4,10},{3,5,20},{0,6,100},{5,7,30},{8,11,40}})); // 140
    }
}
```

#### Python
```python
from bisect import bisect_right


def max_weight(iv):
    iv.sort(key=lambda x: x[1])
    ends = [x[1] for x in iv]
    n = len(iv)
    dp = [0] * (n + 1)
    for j in range(1, n + 1):
        s, f, w = iv[j - 1]
        p = bisect_right(ends, s, 0, j - 1)
        dp[j] = max(dp[j - 1], w + dp[p])
    return dp[n]


print(max_weight([(1, 4, 10), (3, 5, 20), (0, 6, 100), (5, 7, 30), (8, 11, 40)]))  # 140
```

---

### Task 7 — Weighted scheduling with set reconstruction

**Problem.** Same as Task 6, but also return *which* intervals are chosen.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Keep `dp` and `p`; backtrack from `n`: if `w_j + dp[p[j]] ≥ dp[j-1]`, the job is taken — jump to `p[j]`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxWeightSet(iv [][4]int) (int64, []int) { // [start, finish, weight, id]
	sort.Slice(iv, func(i, j int) bool { return iv[i][1] < iv[j][1] })
	n := len(iv)
	p := make([]int, n+1)
	dp := make([]int64, n+1)
	for j := 1; j <= n; j++ {
		lo, hi, pj := 0, j-1, 0
		for lo <= hi {
			mid := (lo + hi) / 2
			if mid == 0 || iv[mid-1][1] <= iv[j-1][0] {
				pj = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		p[j] = pj
		take := int64(iv[j-1][2]) + dp[pj]
		if take > dp[j-1] {
			dp[j] = take
		} else {
			dp[j] = dp[j-1]
		}
	}
	var chosen []int
	for j := n; j > 0; {
		if int64(iv[j-1][2])+dp[p[j]] >= dp[j-1] {
			chosen = append([]int{iv[j-1][3]}, chosen...)
			j = p[j]
		} else {
			j--
		}
	}
	return dp[n], chosen
}

func main() {
	val, set := maxWeightSet([][4]int{{1, 4, 10, 0}, {3, 5, 20, 1}, {0, 6, 100, 2}, {5, 7, 30, 3}, {8, 11, 40, 4}})
	fmt.Println("value =", val, "chosen ids =", set) // 140 [2 4]
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    static Object[] maxWeightSet(int[][] iv) { // [start, finish, weight, id]
        Arrays.sort(iv, Comparator.comparingInt(a -> a[1]));
        int n = iv.length;
        int[] p = new int[n + 1];
        long[] dp = new long[n + 1];
        for (int j = 1; j <= n; j++) {
            int lo = 0, hi = j - 1, pj = 0;
            while (lo <= hi) {
                int mid = (lo + hi) / 2;
                if (mid == 0 || iv[mid - 1][1] <= iv[j - 1][0]) { pj = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            p[j] = pj;
            dp[j] = Math.max(dp[j - 1], (long) iv[j - 1][2] + dp[pj]);
        }
        LinkedList<Integer> chosen = new LinkedList<>();
        for (int j = n; j > 0; ) {
            if ((long) iv[j - 1][2] + dp[p[j]] >= dp[j - 1]) { chosen.addFirst(iv[j - 1][3]); j = p[j]; }
            else j--;
        }
        return new Object[]{dp[n], chosen};
    }
    public static void main(String[] args) {
        Object[] r = maxWeightSet(new int[][]{{1,4,10,0},{3,5,20,1},{0,6,100,2},{5,7,30,3},{8,11,40,4}});
        System.out.println("value = " + r[0] + " chosen ids = " + r[1]); // 140 [2, 4]
    }
}
```

#### Python
```python
from bisect import bisect_right


def max_weight_set(iv):  # (start, finish, weight, id)
    iv.sort(key=lambda x: x[1])
    ends = [x[1] for x in iv]
    n = len(iv)
    p = [0] * (n + 1)
    dp = [0] * (n + 1)
    for j in range(1, n + 1):
        s, f, w, _id = iv[j - 1]
        p[j] = bisect_right(ends, s, 0, j - 1)
        dp[j] = max(dp[j - 1], w + dp[p[j]])
    chosen, j = [], n
    while j > 0:
        if iv[j - 1][2] + dp[p[j]] >= dp[j - 1]:
            chosen.append(iv[j - 1][3])
            j = p[j]
        else:
            j -= 1
    return dp[n], list(reversed(chosen))


print(max_weight_set([(1, 4, 10, 0), (3, 5, 20, 1), (0, 6, 100, 2), (5, 7, 30, 3), (8, 11, 40, 4)]))  # (140, [2, 4])
```

---

### Task 8 — Room assignment (which room per interval)

**Problem.** Partition intervals into the fewest rooms AND output the room id assigned to each interval.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Heap of `(end, roomId)`. Reuse the popped room's id; mint a new id when opening a room.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type Item struct{ end, room int }
type PQ []Item

func (p PQ) Len() int            { return len(p) }
func (p PQ) Less(i, j int) bool  { return p[i].end < p[j].end }
func (p PQ) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *PQ) Push(x interface{}) { *p = append(*p, x.(Item)) }
func (p *PQ) Pop() interface{} {
	o := *p
	v := o[len(o)-1]
	*p = o[:len(o)-1]
	return v
}

func assignRooms(iv [][3]int) ([]int, int) { // [start, end, id]
	sort.Slice(iv, func(i, j int) bool { return iv[i][0] < iv[j][0] })
	pq := &PQ{}
	heap.Init(pq)
	assign := make([]int, len(iv))
	nextRoom := 0
	for _, x := range iv {
		var room int
		if pq.Len() > 0 && (*pq)[0].end <= x[0] {
			it := heap.Pop(pq).(Item)
			room = it.room
		} else {
			room = nextRoom
			nextRoom++
		}
		heap.Push(pq, Item{x[1], room})
		assign[x[2]] = room
	}
	return assign, nextRoom
}

func main() {
	assign, rooms := assignRooms([][3]int{{0, 6, 0}, {1, 4, 1}, {3, 5, 2}, {5, 7, 3}})
	fmt.Println("assign =", assign, "rooms =", rooms)
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    static Object[] assignRooms(int[][] iv) { // [start, end, id]
        Arrays.sort(iv, Comparator.comparingInt(a -> a[0]));
        PriorityQueue<int[]> pq = new PriorityQueue<>(Comparator.comparingInt(a -> a[0])); // (end, room)
        int[] assign = new int[iv.length];
        int nextRoom = 0;
        for (int[] x : iv) {
            int room;
            if (!pq.isEmpty() && pq.peek()[0] <= x[0]) room = pq.poll()[1];
            else room = nextRoom++;
            pq.add(new int[]{x[1], room});
            assign[x[2]] = room;
        }
        return new Object[]{assign, nextRoom};
    }
    public static void main(String[] args) {
        Object[] r = assignRooms(new int[][]{{0,6,0},{1,4,1},{3,5,2},{5,7,3}});
        System.out.println("assign = " + Arrays.toString((int[]) r[0]) + " rooms = " + r[1]);
    }
}
```

#### Python
```python
import heapq


def assign_rooms(iv):  # (start, end, id)
    iv.sort(key=lambda x: x[0])
    heap = []  # (end, room)
    assign = [0] * len(iv)
    next_room = 0
    for s, e, idx in iv:
        if heap and heap[0][0] <= s:
            _end, room = heapq.heappop(heap)
        else:
            room = next_room
            next_room += 1
        heapq.heappush(heap, (e, room))
        assign[idx] = room
    return assign, next_room


print(assign_rooms([(0, 6, 0), (1, 4, 1), (3, 5, 2), (5, 7, 3)]))
```

---

### Task 9 — Multi-machine feasibility ("fits in k?")

**Problem.** Given intervals and a machine count `k`, return whether all intervals can be scheduled on `k` machines (no overlap on any machine).

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ k ≤ n`.

**Hint.** Feasible iff `depth ≤ k`. Reuse the sweep from Task 3.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func fitsInK(iv [][2]int, k int) bool {
	type ev struct{ t, d int }
	var evs []ev
	for _, x := range iv {
		evs = append(evs, ev{x[0], 1}, ev{x[1], -1})
	}
	sort.Slice(evs, func(i, j int) bool {
		if evs[i].t != evs[j].t {
			return evs[i].t < evs[j].t
		}
		return evs[i].d < evs[j].d
	})
	cur, best := 0, 0
	for _, e := range evs {
		cur += e.d
		if cur > best {
			best = cur
		}
	}
	return best <= k
}

func main() {
	iv := [][2]int{{0, 6}, {1, 4}, {3, 5}, {3, 9}, {5, 7}, {5, 9}, {6, 10}, {8, 11}}
	fmt.Println(fitsInK(iv, 4)) // true
	fmt.Println(fitsInK(iv, 3)) // false
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static boolean fitsInK(int[][] iv, int k) {
        int[][] ev = new int[iv.length * 2][2];
        int n = 0;
        for (int[] x : iv) { ev[n++] = new int[]{x[0], 1}; ev[n++] = new int[]{x[1], -1}; }
        Arrays.sort(ev, (a, b) -> a[0] != b[0] ? a[0] - b[0] : a[1] - b[1]);
        int cur = 0, best = 0;
        for (int[] e : ev) { cur += e[1]; best = Math.max(best, cur); }
        return best <= k;
    }
    public static void main(String[] args) {
        int[][] iv = {{0,6},{1,4},{3,5},{3,9},{5,7},{5,9},{6,10},{8,11}};
        System.out.println(fitsInK(iv, 4)); // true
        System.out.println(fitsInK(iv, 3)); // false
    }
}
```

#### Python
```python
def fits_in_k(iv, k):
    ev = []
    for s, e in iv:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort(key=lambda x: (x[0], x[1]))
    cur, best = 0, 0
    for _, d in ev:
        cur += d
        best = max(best, cur)
    return best <= k


iv = [(0, 6), (1, 4), (3, 5), (3, 9), (5, 7), (5, 9), (6, 10), (8, 11)]
print(fits_in_k(iv, 4))  # True
print(fits_in_k(iv, 3))  # False
```

---

### Task 10 — EDF with explicit late-job report

**Problem.** Run EDF and report the max lateness *and* the list of jobs that finished late (lateness > 0).

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** After sorting by deadline, sweep the clock and collect ids where `finish > deadline`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func edfLate(jobs [][3]int) (int, []int) { // [length, deadline, id]
	sort.Slice(jobs, func(i, j int) bool { return jobs[i][1] < jobs[j][1] })
	t, worst := 0, 0
	var late []int
	for _, j := range jobs {
		t += j[0]
		l := t - j[1]
		if l > 0 {
			late = append(late, j[2])
			if l > worst {
				worst = l
			}
		}
	}
	return worst, late
}

func main() {
	worst, late := edfLate([][3]int{{3, 6, 0}, {2, 8, 1}, {1, 9, 2}, {4, 9, 3}, {3, 14, 4}, {2, 15, 5}})
	fmt.Println("maxLateness =", worst, "lateJobs =", late) // 1 [3]
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static Object[] edfLate(int[][] jobs) { // [length, deadline, id]
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1]));
        int t = 0, worst = 0;
        List<Integer> late = new ArrayList<>();
        for (int[] j : jobs) {
            t += j[0];
            int l = t - j[1];
            if (l > 0) { late.add(j[2]); worst = Math.max(worst, l); }
        }
        return new Object[]{worst, late};
    }
    public static void main(String[] args) {
        Object[] r = edfLate(new int[][]{{3,6,0},{2,8,1},{1,9,2},{4,9,3},{3,14,4},{2,15,5}});
        System.out.println("maxLateness = " + r[0] + " lateJobs = " + r[1]); // 1 [3]
    }
}
```

#### Python
```python
def edf_late(jobs):  # (length, deadline, id)
    jobs.sort(key=lambda x: x[1])
    t, worst, late = 0, 0, []
    for length, deadline, jid in jobs:
        t += length
        l = t - deadline
        if l > 0:
            late.append(jid)
            worst = max(worst, l)
    return worst, late


print(edf_late([(3, 6, 0), (2, 8, 1), (1, 9, 2), (4, 9, 3), (3, 14, 4), (2, 15, 5)]))  # (1, [3])
```

---

## Advanced Tasks (5)

### Task 11 — Dynamic depth with a range-add/range-max segment tree

**Problem.** Support `insert(s, e)`, `remove(s, e)`, and `depth()` (current max overlap) over coordinate-compressed time.

**Constraints.** Up to `10^5` operations; times up to `10^9` (compress).

**Hint.** Range `+1` on insert, `−1` on remove over `[s, e)`; root holds the live max. (See senior.md for the full tree.)

#### Python (reference; Go/Java mirror the segment tree in senior.md)
```python
class SegTree:
    def __init__(self, n):
        self.n = n
        self.mx = [0] * (4 * n)
        self.lazy = [0] * (4 * n)

    def _push(self, node):
        if self.lazy[node]:
            for c in (2 * node, 2 * node + 1):
                self.mx[c] += self.lazy[node]
                self.lazy[c] += self.lazy[node]
            self.lazy[node] = 0

    def add(self, node, lo, hi, l, r, d):
        if r <= lo or hi <= l:
            return
        if l <= lo and hi <= r:
            self.mx[node] += d
            self.lazy[node] += d
            return
        self._push(node)
        mid = (lo + hi) // 2
        self.add(2 * node, lo, mid, l, r, d)
        self.add(2 * node + 1, mid, hi, l, r, d)
        self.mx[node] = max(self.mx[2 * node], self.mx[2 * node + 1])

    def depth(self):
        return self.mx[1]


def run(ops, times):
    comp = {t: i for i, t in enumerate(sorted(set(times)))}
    T = len(comp)
    st = SegTree(T)
    out = []
    for op, s, e in ops:
        st.add(1, 0, T, comp[s], comp[e], +1 if op == "ins" else -1)
        out.append(st.depth())
    return out


times = [0, 6, 1, 4, 3, 5, 3, 9, 5, 7]
ops = [("ins", 0, 6), ("ins", 1, 4), ("ins", 3, 9), ("rem", 1, 4)]
print(run(ops, times))  # depths after each op
```

#### Go / Java
```text
// Use the SegTree from senior.md. Coordinate-compress all endpoint values to [0..T).
// insert -> add(+1) on [comp[s], comp[e]); remove -> add(-1); depth() -> tree root max.
// Verify: after inserting overlapping intervals depth rises; after remove it falls.
```

---

### Task 12 — Weighted scheduling with a "cooldown" gap

**Problem.** Like weighted interval scheduling, but after finishing a chosen interval you must wait `g` time units before the next can start (machine cooldown). Maximize total weight.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ g ≤ 10^9`.

**Hint.** `p(j)` now needs `finish_i + g ≤ start_j`. Binary-search on finishes for `start_j − g`.

#### Python
```python
from bisect import bisect_right


def max_weight_cooldown(iv, g):  # (start, finish, weight)
    iv.sort(key=lambda x: x[1])
    ends = [x[1] for x in iv]
    n = len(iv)
    dp = [0] * (n + 1)
    for j in range(1, n + 1):
        s, f, w = iv[j - 1]
        p = bisect_right(ends, s - g, 0, j - 1)  # last finish <= start - g
        dp[j] = max(dp[j - 1], w + dp[p])
    return dp[n]


iv = [(0, 3, 5), (4, 6, 5), (6, 9, 4)]
print(max_weight_cooldown(iv, 0))  # 14 (all three: 3<=4, 6<=6)
print(max_weight_cooldown(iv, 2))  # gap forces drops; fewer fit
```

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxWeightCooldown(iv [][3]int, g int) int64 {
	sort.Slice(iv, func(i, j int) bool { return iv[i][1] < iv[j][1] })
	n := len(iv)
	dp := make([]int64, n+1)
	for j := 1; j <= n; j++ {
		// last index with finish <= start_j - g
		lo, hi, p := 0, j-1, 0
		for lo <= hi {
			mid := (lo + hi) / 2
			if mid == 0 || iv[mid-1][1] <= iv[j-1][0]-g {
				p = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		take := int64(iv[j-1][2]) + dp[p]
		if take > dp[j-1] {
			dp[j] = take
		} else {
			dp[j] = dp[j-1]
		}
	}
	return dp[n]
}

func main() {
	iv := [][3]int{{0, 3, 5}, {4, 6, 5}, {6, 9, 4}}
	fmt.Println(maxWeightCooldown(iv, 0)) // 14
	fmt.Println(maxWeightCooldown(iv, 2))
}
```

#### Java
```java
import java.util.*;

public class Task12 {
    static long maxWeightCooldown(int[][] iv, int g) {
        Arrays.sort(iv, Comparator.comparingInt(a -> a[1]));
        int n = iv.length;
        long[] dp = new long[n + 1];
        for (int j = 1; j <= n; j++) {
            int lo = 0, hi = j - 1, p = 0;
            while (lo <= hi) {
                int mid = (lo + hi) / 2;
                if (mid == 0 || iv[mid - 1][1] <= iv[j - 1][0] - g) { p = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            dp[j] = Math.max(dp[j - 1], (long) iv[j - 1][2] + dp[p]);
        }
        return dp[n];
    }
    public static void main(String[] args) {
        int[][] iv = {{0,3,5},{4,6,5},{6,9,4}};
        System.out.println(maxWeightCooldown(iv, 0)); // 14
        System.out.println(maxWeightCooldown(iv, 2));
    }
}
```

---

### Task 13 — Minimize number of late jobs (Moore–Hodgson)

**Problem.** On one machine, schedule jobs `(length, deadline)` to *minimize the number of jobs that are late*. (Different objective from EDF.)

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Process jobs by deadline; keep a max-heap of accepted lengths and a running total time. If adding a job exceeds its deadline, drop the longest job so far (it costs the most time). Late count = `n − accepted`.

#### Python
```python
import heapq


def min_late_jobs(jobs):  # (length, deadline)
    jobs.sort(key=lambda x: x[1])  # by deadline
    heap = []  # max-heap via negative lengths
    t = 0
    for length, deadline in jobs:
        t += length
        heapq.heappush(heap, -length)
        if t > deadline:                 # this job would be late
            t += heapq.heappop(heap)     # drop the longest accepted (pop returns -len)
    return len(jobs) - len(heap)         # number dropped = late jobs


jobs = [(3, 9), (2, 4), (1, 7), (4, 12), (3, 8)]
print(min_late_jobs(jobs))  # minimal late count
```

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type MaxHeap []int

func (h MaxHeap) Len() int            { return len(h) }
func (h MaxHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h MaxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MaxHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MaxHeap) Pop() interface{} {
	o := *h
	v := o[len(o)-1]
	*h = o[:len(o)-1]
	return v
}

func minLateJobs(jobs [][2]int) int {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i][1] < jobs[j][1] })
	h := &MaxHeap{}
	heap.Init(h)
	t := 0
	for _, j := range jobs {
		t += j[0]
		heap.Push(h, j[0])
		if t > j[1] {
			t -= heap.Pop(h).(int)
		}
	}
	return len(jobs) - h.Len()
}

func main() {
	fmt.Println(minLateJobs([][2]int{{3, 9}, {2, 4}, {1, 7}, {4, 12}, {3, 8}}))
}
```

#### Java
```java
import java.util.*;

public class Task13 {
    static int minLateJobs(int[][] jobs) {
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1]));
        PriorityQueue<Integer> pq = new PriorityQueue<>(Collections.reverseOrder()); // max-heap
        int t = 0;
        for (int[] j : jobs) {
            t += j[0];
            pq.add(j[0]);
            if (t > j[1]) t -= pq.poll();
        }
        return jobs.length - pq.size();
    }
    public static void main(String[] args) {
        System.out.println(minLateJobs(new int[][]{{3,9},{2,4},{1,7},{4,12},{3,8}}));
    }
}
```

---

### Task 14 — Maximum weight on exactly k machines (greedy density + check)

**Problem.** With `k` machines, select a subset of weighted intervals that can be partitioned onto `k` machines, maximizing total weight, using a *greedy density heuristic*, and verify feasibility (`depth of chosen ≤ k`).

**Constraints.** `1 ≤ n ≤ 2000` (so you can brute-check small cases).

**Hint.** Sort by `weight/length` descending; add an interval if the chosen set still has `depth ≤ k`; verify with the sweep. (Heuristic — not guaranteed optimal; compare to brute force on tiny inputs.)

#### Python
```python
def depth(iv):
    ev = []
    for s, e in iv:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort(key=lambda x: (x[0], x[1]))
    cur, best = 0, 0
    for _, d in ev:
        cur += d
        best = max(best, cur)
    return best


def greedy_k_machines(iv, k):  # (start, finish, weight)
    order = sorted(iv, key=lambda x: -x[2] / (x[1] - x[0]))
    chosen = []
    total = 0
    for s, f, w in order:
        if depth(chosen + [(s, f)]) <= k:
            chosen.append((s, f))
            total += w
    return total, chosen


iv = [(0, 4, 10), (2, 6, 8), (4, 8, 9), (1, 3, 5)]
print(greedy_k_machines(iv, 2))
```

#### Go / Java
```text
// Mirror the Python: sort by weight/length desc; tentatively add each interval and
// recompute depth (sweep); keep it only if depth <= k. Sum weights of the kept set.
// This is a HEURISTIC: validate against brute force (all subsets, feasible if depth<=k)
// for n <= ~16 to see where it diverges from the true optimum.
```

---

### Task 15 — Calendar booking service simulation

**Problem.** Simulate a booking API over `k` rooms: process a stream of `book(s, e)` requests, accepting only if it keeps `depth ≤ k` on `[s, e)`; reject otherwise. Report the accepted set and final room usage.

**Constraints.** Up to `10^5` requests; `1 ≤ k ≤ 1000`. Times up to `10^9` (compress, or use a balanced approach).

**Hint.** Maintain a range-add/range-max segment tree over compressed time. For each request: tentatively `+1` on `[s,e)`; if the max over `[s,e)` exceeds `k`, roll back (`−1`) and reject; else accept. This is the admission-control kernel from senior.md.

#### Python
```python
class SegTree:
    def __init__(self, n):
        self.n = n
        self.mx = [0] * (4 * n)
        self.lazy = [0] * (4 * n)

    def _push(self, node):
        if self.lazy[node]:
            for c in (2 * node, 2 * node + 1):
                self.mx[c] += self.lazy[node]
                self.lazy[c] += self.lazy[node]
            self.lazy[node] = 0

    def add(self, node, lo, hi, l, r, d):
        if r <= lo or hi <= l:
            return
        if l <= lo and hi <= r:
            self.mx[node] += d
            self.lazy[node] += d
            return
        self._push(node)
        mid = (lo + hi) // 2
        self.add(2 * node, lo, mid, l, r, d)
        self.add(2 * node + 1, mid, hi, l, r, d)
        self.mx[node] = max(self.mx[2 * node], self.mx[2 * node + 1])

    def query(self, node, lo, hi, l, r):
        if r <= lo or hi <= l:
            return 0
        if l <= lo and hi <= r:
            return self.mx[node]
        self._push(node)
        mid = (lo + hi) // 2
        return max(self.query(2 * node, lo, mid, l, r),
                   self.query(2 * node + 1, mid, hi, l, r))


def booking_service(requests, k):
    pts = sorted({t for r in requests for t in r})
    comp = {t: i for i, t in enumerate(pts)}
    T = len(pts)
    st = SegTree(T)
    accepted = []
    for s, e in requests:
        l, r = comp[s], comp[e]
        st.add(1, 0, T, l, r, +1)
        if st.query(1, 0, T, l, r) > k:
            st.add(1, 0, T, l, r, -1)  # roll back, reject
        else:
            accepted.append((s, e))
    return accepted


reqs = [(0, 10), (5, 15), (12, 20), (6, 8), (7, 9)]
print(booking_service(reqs, 2))  # accept until depth would exceed 2
```

#### Go / Java
```text
// Use the SegTree from senior.md. Coordinate-compress request endpoints.
// For each (s,e): add(+1) on [comp[s],comp[e]); if query-max on that span > k, add(-1)
// and reject; else accept. Output the accepted list. This is exactly the admission
// controller a real meeting-room booking service runs, with atomic check-and-commit.
```

---

## Benchmark Task — Greedy vs DP on Weighted Scheduling

**Problem.** Generate `n` random weighted intervals for `n = 10^3, 10^4, 10^5`. Compare: (a) the correct DP, (b) a wrong greedy-by-weight, (c) a wrong greedy-by-finish. Report value and timing.

**Expected findings.**
- The DP is `O(n log n)` and always optimal.
- Greedy-by-weight and greedy-by-finish are also fast but **frequently sub-optimal** — they leave value on the table on adversarial weightings.
- The value gap can be arbitrarily large (one fat interval vs many light ones), proving weighted scheduling *requires* DP.

#### Python
```python
import random
import time


def bench(n):
    iv = []
    for _ in range(n):
        s = random.randint(0, n)
        f = s + random.randint(1, 20)
        iv.append((s, f, random.randint(1, 100)))

    def greedy_weight(iv):
        order = sorted(iv, key=lambda x: -x[2])
        last_end_used = []  # naive: track via simple non-overlap on a single line
        chosen = []
        for s, f, w in order:
            if all(not (s < cf and cs < f) for cs, cf, _ in chosen):
                chosen.append((s, f, w))
        return sum(w for _, _, w in chosen)

    t0 = time.perf_counter()
    dp_val = max_weight([list(x) for x in iv])  # from Task 6
    dt = time.perf_counter() - t0
    gw = greedy_weight(iv)
    print(f"n={n:<7} dp={dp_val:<8} ({dt*1000:6.1f} ms)  greedy_weight={gw}  gap={dp_val - gw}")


for n in (1000, 10000, 100000):
    bench(n)
# reuse max_weight from Task 6
```

#### Go / Java
```text
// Time the DP (Task 6) vs a greedy-by-weight that scans and keeps non-overlapping picks.
// Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: DP stays optimal at O(n log n); greedy is comparable speed but its value
// trails the DP on adversarial inputs (the whole reason weighted scheduling needs DP).
```

**Evaluation criteria.**
- Correctness: DP value ≥ both greedy values, always; verify against brute force for `n ≤ 18`.
- Performance: report wall-clock per `n`; both run `O(n log n)` but the greedy is *wrong*.
- Discussion: construct an instance where the gap is maximal (one fat interval covering many lighter compatible ones).
</content>

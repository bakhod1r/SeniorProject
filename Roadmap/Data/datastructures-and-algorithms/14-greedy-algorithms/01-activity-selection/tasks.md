# Activity Selection — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a brute-force subset oracle early — it is your check for every selection task. Known checks: `[1,4),[3,5),[0,6),[5,7),[3,8),[5,9)` → 2; `n` disjoint intervals → `n`; all overlapping → 1.

---

## Beginner Tasks (5)

### Task 1 — Count the maximum compatible activities

**Problem.** Given start/finish arrays, return the maximum number of mutually non-overlapping activities (half-open intervals).

**Constraints.** `0 ≤ n ≤ 10^5`, integer times, `start[i] < finish[i]`.

**Hint.** Sort by finish; keep `lastEnd`; count an activity iff `start >= lastEnd`, then set `lastEnd = finish`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxActivities(start, finish []int) int {
	n := len(start)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return finish[order[a]] < finish[order[b]] })
	count, lastEnd := 0, -1<<62
	for _, i := range order {
		if start[i] >= lastEnd {
			count++
			lastEnd = finish[i]
		}
	}
	return count
}

func main() {
	fmt.Println(maxActivities([]int{1, 3, 0, 5, 3, 5}, []int{4, 5, 6, 7, 8, 9})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    static int maxActivities(int[] start, int[] finish) {
        int n = start.length;
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Integer.compare(finish[a], finish[b]));
        int count = 0; long lastEnd = Long.MIN_VALUE;
        for (int i : order)
            if (start[i] >= lastEnd) { count++; lastEnd = finish[i]; }
        return count;
    }
    public static void main(String[] args) {
        System.out.println(maxActivities(
            new int[]{1, 3, 0, 5, 3, 5}, new int[]{4, 5, 6, 7, 8, 9})); // 2
    }
}
```

#### Python
```python
def max_activities(start, finish):
    order = sorted(range(len(start)), key=lambda i: finish[i])
    count, last_end = 0, float("-inf")
    for i in order:
        if start[i] >= last_end:
            count += 1
            last_end = finish[i]
    return count


print(max_activities([1, 3, 0, 5, 3, 5], [4, 5, 6, 7, 8, 9]))  # 2
```

---

### Task 2 — Return the actual selected schedule

**Problem.** Return the indices (into the original input) of a maximum compatible set, in time order.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Sort an index array by finish so you can report original positions; append each selected index.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func schedule(start, finish []int) []int {
	n := len(start)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return finish[order[a]] < finish[order[b]] })
	chosen := []int{}
	lastEnd := -1 << 62
	for _, i := range order {
		if start[i] >= lastEnd {
			chosen = append(chosen, i)
			lastEnd = finish[i]
		}
	}
	return chosen
}

func main() {
	fmt.Println(schedule([]int{1, 3, 0, 5, 3, 5}, []int{4, 5, 6, 7, 8, 9})) // [0 3]
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static List<Integer> schedule(int[] start, int[] finish) {
        int n = start.length;
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Integer.compare(finish[a], finish[b]));
        List<Integer> chosen = new ArrayList<>();
        long lastEnd = Long.MIN_VALUE;
        for (int i : order)
            if (start[i] >= lastEnd) { chosen.add(i); lastEnd = finish[i]; }
        return chosen;
    }
    public static void main(String[] args) {
        System.out.println(schedule(
            new int[]{1, 3, 0, 5, 3, 5}, new int[]{4, 5, 6, 7, 8, 9})); // [0, 3]
    }
}
```

#### Python
```python
def schedule(start, finish):
    order = sorted(range(len(start)), key=lambda i: finish[i])
    chosen, last_end = [], float("-inf")
    for i in order:
        if start[i] >= last_end:
            chosen.append(i)
            last_end = finish[i]
    return chosen


print(schedule([1, 3, 0, 5, 3, 5], [4, 5, 6, 7, 8, 9]))  # [0, 3]
```

---

### Task 3 — Brute-force oracle

**Problem.** Compute the maximum compatible set size by enumerating all subsets. Use it to validate Task 1.

**Constraints.** `1 ≤ n ≤ 18` (enumeration is exponential).

**Hint.** For each subset, sort by finish, check consecutive `finish ≤ next start` (half-open); keep the largest valid size.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func brute(start, finish []int) int {
	n := len(start)
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		var iv [][2]int
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				iv = append(iv, [2]int{start[i], finish[i]})
			}
		}
		sort.Slice(iv, func(a, b int) bool { return iv[a][1] < iv[b][1] })
		ok := true
		for k := 1; k < len(iv); k++ {
			if iv[k][0] < iv[k-1][1] {
				ok = false
				break
			}
		}
		if ok && len(iv) > best {
			best = len(iv)
		}
	}
	return best
}

func main() {
	fmt.Println(brute([]int{1, 3, 0, 5, 3, 5}, []int{4, 5, 6, 7, 8, 9})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static int brute(int[] start, int[] finish) {
        int n = start.length, best = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<int[]> iv = new ArrayList<>();
            for (int i = 0; i < n; i++)
                if ((mask & (1 << i)) != 0) iv.add(new int[]{start[i], finish[i]});
            iv.sort((a, b) -> Integer.compare(a[1], b[1]));
            boolean ok = true;
            for (int k = 1; k < iv.size(); k++)
                if (iv.get(k)[0] < iv.get(k - 1)[1]) { ok = false; break; }
            if (ok) best = Math.max(best, iv.size());
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(brute(
            new int[]{1, 3, 0, 5, 3, 5}, new int[]{4, 5, 6, 7, 8, 9})); // 2
    }
}
```

#### Python
```python
from itertools import combinations

def brute(start, finish):
    n = len(start)
    for r in range(n, -1, -1):
        for comb in combinations(range(n), r):
            iv = sorted((start[i], finish[i]) for i in comb)
            if all(a[1] <= b[0] for a, b in zip(iv, iv[1:])):
                return r
    return 0


print(brute([1, 3, 0, 5, 3, 5], [4, 5, 6, 7, 8, 9]))  # 2
```

---

### Task 4 — Disjoint and fully-overlapping sanity checks

**Problem.** Without a determinant of any kind, predict and verify: `n` pairwise-disjoint intervals → `n`; `n` intervals all sharing a common point → 1.

**Constraints.** `1 ≤ n ≤ 50`.

**Hint.** Disjoint: `[0,1),[1,2),…`. Overlapping: `[0, i+1)` for `i = 0..n−1` all contain time 0. Verify with Task 1.

#### Go
```go
package main

import "fmt"

func disjoint(n int) ([]int, []int) {
	s, f := make([]int, n), make([]int, n)
	for i := 0; i < n; i++ {
		s[i], f[i] = i, i+1
	}
	return s, f
}

func overlapping(n int) ([]int, []int) {
	s, f := make([]int, n), make([]int, n)
	for i := 0; i < n; i++ {
		s[i], f[i] = 0, i+1
	}
	return s, f
}

func main() {
	for n := 1; n <= 5; n++ {
		s, f := disjoint(n)
		s2, f2 := overlapping(n)
		fmt.Printf("n=%d disjoint=%d overlap=%d\n", n, maxActivities(s, f), maxActivities(s2, f2))
	}
}
// reuse maxActivities from Task 1
```

#### Java
```java
public class Task4 {
    public static void main(String[] args) {
        for (int n = 1; n <= 5; n++) {
            int[] s = new int[n], f = new int[n], s2 = new int[n], f2 = new int[n];
            for (int i = 0; i < n; i++) { s[i] = i; f[i] = i + 1; s2[i] = 0; f2[i] = i + 1; }
            System.out.printf("n=%d disjoint=%d overlap=%d%n",
                n, Task1.maxActivities(s, f), Task1.maxActivities(s2, f2));
        }
    }
}
```

#### Python
```python
for n in range(1, 6):
    disjoint = max_activities(list(range(n)), [i + 1 for i in range(n)])
    overlap = max_activities([0] * n, [i + 1 for i in range(n)])
    print(f"n={n} disjoint={disjoint} overlap={overlap}")
# reuse max_activities from Task 1
```

---

### Task 5 — Half-open vs closed boundary

**Problem.** Show that back-to-back intervals (`finish == next start`) are compatible under half-open `[s, f)` but conflict under closed `[s, f]`.

**Constraints.** `2 ≤ n ≤ 10`.

**Hint.** Use `[0,1),[1,2),[2,3)`: half-open count 3 (`>=`), closed count 1 (`>`).

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func count(start, finish []int, halfOpen bool) int {
	n := len(start)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return finish[order[a]] < finish[order[b]] })
	c, lastEnd := 0, -1<<62
	for _, i := range order {
		ok := start[i] > lastEnd
		if halfOpen {
			ok = start[i] >= lastEnd
		}
		if ok {
			c++
			lastEnd = finish[i]
		}
	}
	return c
}

func main() {
	s, f := []int{0, 1, 2}, []int{1, 2, 3}
	fmt.Println("half-open:", count(s, f, true))  // 3
	fmt.Println("closed:", count(s, f, false))    // 1
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static int count(int[] start, int[] finish, boolean halfOpen) {
        int n = start.length;
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Integer.compare(finish[a], finish[b]));
        int c = 0; long lastEnd = Long.MIN_VALUE;
        for (int i : order) {
            boolean ok = halfOpen ? start[i] >= lastEnd : start[i] > lastEnd;
            if (ok) { c++; lastEnd = finish[i]; }
        }
        return c;
    }
    public static void main(String[] args) {
        int[] s = {0, 1, 2}, f = {1, 2, 3};
        System.out.println("half-open: " + count(s, f, true));  // 3
        System.out.println("closed: " + count(s, f, false));    // 1
    }
}
```

#### Python
```python
def count(start, finish, half_open):
    order = sorted(range(len(start)), key=lambda i: finish[i])
    c, last_end = 0, float("-inf")
    for i in order:
        ok = start[i] >= last_end if half_open else start[i] > last_end
        if ok:
            c += 1
            last_end = finish[i]
    return c


print("half-open:", count([0, 1, 2], [1, 2, 3], True))   # 3
print("closed:", count([0, 1, 2], [1, 2, 3], False))     # 1
```

---

## Intermediate Tasks (5)

### Task 6 — Non-overlapping Intervals (min removals)

**Problem.** Return the minimum number of intervals to remove so the rest are non-overlapping. (`= n − max compatible set`.)

**Constraints.** `0 ≤ n ≤ 10^5`.

**Hint.** Sort by finish, count keepable via EFT greedy, subtract from `n`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func eraseOverlap(iv [][]int) int {
	if len(iv) == 0 {
		return 0
	}
	sort.Slice(iv, func(a, b int) bool { return iv[a][1] < iv[b][1] })
	kept, lastEnd := 0, -1<<62
	for _, x := range iv {
		if x[0] >= lastEnd {
			kept++
			lastEnd = x[1]
		}
	}
	return len(iv) - kept
}

func main() {
	fmt.Println(eraseOverlap([][]int{{1, 2}, {2, 3}, {3, 4}, {1, 3}})) // 1
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static int eraseOverlap(int[][] iv) {
        if (iv.length == 0) return 0;
        Arrays.sort(iv, (a, b) -> Integer.compare(a[1], b[1]));
        int kept = 0; long lastEnd = Long.MIN_VALUE;
        for (int[] x : iv)
            if (x[0] >= lastEnd) { kept++; lastEnd = x[1]; }
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
    if not iv:
        return 0
    iv.sort(key=lambda x: x[1])
    kept, last_end = 0, float("-inf")
    for s, f in iv:
        if s >= last_end:
            kept += 1
            last_end = f
    return len(iv) - kept


print(erase_overlap([[1, 2], [2, 3], [3, 4], [1, 3]]))  # 1
```

---

### Task 7 — Minimum arrows to burst balloons (covering dual)

**Problem.** Given closed intervals, find the minimum number of points so every interval contains at least one. Equals the max number of disjoint intervals.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Sort by finish; place a point at each chosen finish; skip intervals it covers. Use `point >= start` for closed coverage.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func minArrows(points [][]int) int {
	if len(points) == 0 {
		return 0
	}
	sort.Slice(points, func(a, b int) bool { return points[a][1] < points[b][1] })
	arrows, end := 0, -1<<62
	for _, p := range points {
		if p[0] > end { // need a new arrow
			arrows++
			end = p[1]
		}
	}
	return arrows
}

func main() {
	fmt.Println(minArrows([][]int{{10, 16}, {2, 8}, {1, 6}, {7, 12}})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    static int minArrows(int[][] p) {
        if (p.length == 0) return 0;
        Arrays.sort(p, (a, b) -> Integer.compare(a[1], b[1]));
        int arrows = 0; long end = Long.MIN_VALUE;
        for (int[] x : p)
            if (x[0] > end) { arrows++; end = x[1]; }
        return arrows;
    }
    public static void main(String[] args) {
        System.out.println(minArrows(new int[][]{{10,16},{2,8},{1,6},{7,12}})); // 2
    }
}
```

#### Python
```python
def min_arrows(points):
    if not points:
        return 0
    points.sort(key=lambda x: x[1])
    arrows, end = 0, float("-inf")
    for s, f in points:
        if s > end:
            arrows += 1
            end = f
    return arrows


print(min_arrows([[10, 16], [2, 8], [1, 6], [7, 12]]))  # 2
```

---

### Task 8 — Weighted interval scheduling (DP)

**Problem.** Maximize total value of a compatible set. Confirm greedy-by-finish is wrong on a value example.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ value ≤ 10^9`.

**Hint.** Sort by finish; `p(i)` = latest activity finishing `≤ start[i]` (binary search); `dp[i] = max(dp[i−1], v_i + dp[p(i)])`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxValue(iv [][3]int) int64 {
	a := append([][3]int(nil), iv...)
	sort.Slice(a, func(i, j int) bool { return a[i][1] < a[j][1] })
	n := len(a)
	p := make([]int, n)
	for i := 0; i < n; i++ {
		lo, hi, best := 0, i-1, -1
		for lo <= hi {
			mid := (lo + hi) / 2
			if a[mid][1] <= a[i][0] {
				best = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		p[i] = best
	}
	dp := make([]int64, n+1)
	for i := 1; i <= n; i++ {
		take := int64(a[i-1][2])
		if p[i-1] >= 0 {
			take += dp[p[i-1]+1]
		}
		if take > dp[i-1] {
			dp[i] = take
		} else {
			dp[i] = dp[i-1]
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(maxValue([][3]int{{0, 10, 5}, {1, 3, 1}, {4, 6, 1}})) // 5
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    static long maxValue(int[][] iv) {
        int[][] a = Arrays.stream(iv).map(int[]::clone).toArray(int[][]::new);
        Arrays.sort(a, (x, y) -> Integer.compare(x[1], y[1]));
        int n = a.length;
        int[] p = new int[n];
        for (int i = 0; i < n; i++) {
            int lo = 0, hi = i - 1, best = -1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1;
                if (a[mid][1] <= a[i][0]) { best = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            p[i] = best;
        }
        long[] dp = new long[n + 1];
        for (int i = 1; i <= n; i++) {
            long take = a[i - 1][2] + (p[i - 1] >= 0 ? dp[p[i - 1] + 1] : 0);
            dp[i] = Math.max(dp[i - 1], take);
        }
        return dp[n];
    }
    public static void main(String[] args) {
        System.out.println(maxValue(new int[][]{{0,10,5},{1,3,1},{4,6,1}})); // 5
    }
}
```

#### Python
```python
from bisect import bisect_right

def max_value(iv):
    a = sorted(iv, key=lambda x: x[1])
    finishes = [x[1] for x in a]
    n = len(a)
    p = [bisect_right(finishes, a[i][0], 0, i) - 1 for i in range(n)]
    dp = [0] * (n + 1)
    for i in range(1, n + 1):
        take = a[i - 1][2] + (dp[p[i - 1] + 1] if p[i - 1] >= 0 else 0)
        dp[i] = max(dp[i - 1], take)
    return dp[n]


print(max_value([(0, 10, 5), (1, 3, 1), (4, 6, 1)]))  # 5
```

---

### Task 9 — Interval partitioning (minimum rooms)

**Problem.** Schedule all activities using the fewest resources (rooms). Answer equals the maximum overlap depth.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Sort by start; min-heap of room free-times. If the earliest-free room is free by an activity's start, reuse it; else open a new room.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type IntHeap []int

func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func minRooms(iv [][2]int) int {
	sort.Slice(iv, func(a, b int) bool { return iv[a][0] < iv[b][0] })
	h := &IntHeap{}
	heap.Init(h)
	for _, x := range iv {
		if h.Len() > 0 && (*h)[0] <= x[0] {
			heap.Pop(h)
		}
		heap.Push(h, x[1])
	}
	return h.Len()
}

func main() {
	fmt.Println(minRooms([][2]int{{0, 30}, {5, 10}, {15, 20}})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static int minRooms(int[][] iv) {
        Arrays.sort(iv, (a, b) -> Integer.compare(a[0], b[0]));
        PriorityQueue<Integer> heap = new PriorityQueue<>();
        for (int[] x : iv) {
            if (!heap.isEmpty() && heap.peek() <= x[0]) heap.poll();
            heap.offer(x[1]);
        }
        return heap.size();
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
    heap = []
    for s, f in iv:
        if heap and heap[0] <= s:
            heapq.heappop(heap)
        heapq.heappush(heap, f)
    return len(heap)


print(min_rooms([[0, 30], [5, 10], [15, 20]]))  # 2
```

---

### Task 10 — Maximum concurrency (sweep line)

**Problem.** Find the maximum number of activities live at the same instant (peak overlap depth).

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Build `2n` endpoint events; sort; at a start `+1`, at a finish `−1`; process finishes before starts at equal time (half-open); track the running max.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxConcurrency(iv [][2]int) int {
	type ev struct {
		t, d int // d: +1 start, -1 end
	}
	var events []ev
	for _, x := range iv {
		events = append(events, ev{x[0], 1}, ev{x[1], -1})
	}
	sort.Slice(events, func(a, b int) bool {
		if events[a].t != events[b].t {
			return events[a].t < events[b].t
		}
		return events[a].d < events[b].d // -1 (end) before +1 (start): half-open
	})
	cur, best := 0, 0
	for _, e := range events {
		cur += e.d
		if cur > best {
			best = cur
		}
	}
	return best
}

func main() {
	fmt.Println(maxConcurrency([][2]int{{1, 4}, {2, 5}, {3, 6}})) // 3
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static int maxConcurrency(int[][] iv) {
        int[][] ev = new int[iv.length * 2][2];
        int k = 0;
        for (int[] x : iv) { ev[k++] = new int[]{x[0], 1}; ev[k++] = new int[]{x[1], -1}; }
        Arrays.sort(ev, (a, b) -> a[0] != b[0]
                ? Integer.compare(a[0], b[0])
                : Integer.compare(a[1], b[1]));   // end (-1) before start (+1)
        int cur = 0, best = 0;
        for (int[] e : ev) { cur += e[1]; best = Math.max(best, cur); }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(maxConcurrency(new int[][]{{1,4},{2,5},{3,6}})); // 3
    }
}
```

#### Python
```python
def max_concurrency(iv):
    events = []
    for s, f in iv:
        events.append((s, 1))
        events.append((f, -1))
    events.sort(key=lambda e: (e[0], e[1]))  # -1 (end) before +1 (start)
    cur = best = 0
    for _, d in events:
        cur += d
        best = max(best, cur)
    return best


print(max_concurrency([[1, 4], [2, 5], [3, 6]]))  # 3
```

---

## Advanced Tasks (5)

### Task 11 — Online finish-ordered streaming selection

**Problem.** Process a stream of activities that arrive **already sorted by finish time**, deciding each irrevocably in `O(1)` memory.

**Constraints.** Stream length up to `10^8`; only `O(1)` state allowed.

**Hint.** Keep a single `lastEnd`; accept iff `start ≥ lastEnd`; never store the stream.

#### Python
```python
def online_select(stream):
    """stream yields (start, finish) in nondecreasing finish order."""
    count, last_end = 0, float("-inf")
    for s, f in stream:
        if s >= last_end:
            count += 1
            last_end = f
    return count


def finish_sorted_stream():
    data = [(1, 4), (3, 5), (0, 6), (5, 7), (3, 8), (5, 9)]  # already finish-sorted
    yield from data


print(online_select(finish_sorted_stream()))  # 2
```

#### Go / Java
```text
// Mirror the Python: read activities in finish order from an iterator/channel,
// keep one lastEnd scalar, accept iff start >= lastEnd, never buffer the stream.
// Go: receive from a <-chan [2]int. Java: consume an Iterator<int[]>.
```

---

### Task 12 — Counting-sort acceleration for bounded integer times

**Problem.** When finish times are integers in `[0, T)`, run the whole selection in `O(n + T)` using a counting/bucket sort by finish.

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ finish < T ≤ 10^6`.

**Hint.** Bucket indices by finish; iterate buckets in increasing finish order, applying the usual `start >= lastEnd` gate.

#### Python
```python
def count_bounded(start, finish, T):
    buckets = [[] for _ in range(T + 1)]
    for i in range(len(start)):
        buckets[finish[i]].append(i)
    count, last_end = 0, float("-inf")
    for f in range(T + 1):
        for i in buckets[f]:
            if start[i] >= last_end:
                count += 1
                last_end = finish[i]
    return count


print(count_bounded([1, 3, 0, 5, 3, 5], [4, 5, 6, 7, 8, 9], 10))  # 2
```

#### Go / Java
```text
// Allocate T+1 buckets indexed by finish time; push each activity index into
// buckets[finish]. Sweep buckets f = 0..T in order, applying start >= lastEnd.
// O(n + T) time, O(n + T) space. Beats comparison sort when T = O(n).
```

---

### Task 13 — Selection with cooldown / setup gap

**Problem.** A resource needs a fixed cooldown `g` between activities: the next activity must start at `≥ lastEnd + g`. Maximize the count.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ g ≤ 10^9`.

**Hint.** Same EFT greedy, but the gate becomes `start >= lastEnd + g`.

#### Python
```python
def max_with_cooldown(start, finish, g):
    order = sorted(range(len(start)), key=lambda i: finish[i])
    count, last_end = 0, float("-inf")
    for i in order:
        if start[i] >= last_end + (g if last_end != float("-inf") else 0):
            count += 1
            last_end = finish[i]
    return count


print(max_with_cooldown([0, 6, 12], [4, 10, 16], 2))  # 3 (each gap is exactly 2)
print(max_with_cooldown([0, 4, 8], [3, 7, 11], 2))    # 2 (middle one violates the gap)
```

#### Go / Java
```text
// Identical to the base greedy with the gate start >= lastEnd + g.
// Be careful with the first selection (no cooldown applies before it).
// Go/Java: track lastEnd and a boolean "have we selected yet".
```

---

### Task 14 — k resources: maximize total selected across k machines

**Problem.** With `k` identical resources (each holds one activity at a time), maximize the **total** number of activities selected across all resources.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ k ≤ n`.

**Hint.** Sort by finish; keep a min-heap of the `k` resources' free-times (size `≤ k`). For each activity, if the earliest-free resource is free by its start, assign it there and select; else skip. This generalizes the single-resource gate to `k` gates.

#### Python
```python
import heapq

def max_k_resources(start, finish, k):
    order = sorted(range(len(start)), key=lambda i: finish[i])
    free = [float("-inf")] * k   # each resource free from -inf initially
    heapq.heapify(free)
    count = 0
    for i in order:
        if free and free[0] <= start[i]:
            heapq.heapreplace(free, finish[i])
            count += 1
        # else: all k resources busy past start[i] -> skip
    return count


# 2 resources: two overlapping pairs can both be served
print(max_k_resources([1, 1, 5, 5], [4, 4, 8, 8], 2))  # 4
print(max_k_resources([1, 1, 5, 5], [4, 4, 8, 8], 1))  # 2
```

#### Go / Java
```text
// Sort by finish. Maintain a min-heap of size k of resource free-times.
// For each activity in finish order: if heap top <= start, replace it with
// finish and count++; else skip. Greedy-optimal for maximizing total count
// on k identical resources. Go: container/heap. Java: PriorityQueue<Long>.
```

---

### Task 15 — Randomized stress test against the oracle

**Problem.** Generate random interval sets and assert the EFT greedy count equals the brute-force oracle for all of them.

**Constraints.** `1 ≤ n ≤ 16`, hundreds of random trials.

**Hint.** Random `start ∈ [0, 20)`, `finish = start + rand(1, 8)`. Compare `max_activities` (Task 1) to `brute` (Task 3).

#### Python
```python
import random

def stress(trials=500):
    for _ in range(trials):
        n = random.randint(1, 16)
        start = [random.randint(0, 19) for _ in range(n)]
        finish = [start[i] + random.randint(1, 8) for i in range(n)]
        g = max_activities(start, finish)
        b = brute(start, finish)
        assert g == b, (start, finish, g, b)
    print("all", trials, "trials passed")


stress()
# reuse max_activities (Task 1) and brute (Task 3)
```

#### Go / Java
```text
// Loop hundreds of trials: random n in [1,16], random start in [0,20),
// finish = start + rand[1,8]. Assert maxActivities == brute for each.
// Go: math/rand. Java: java.util.Random. Any mismatch prints the failing case.
```

---

## Benchmark Task — Greedy vs Brute Force vs DP

**Problem.** Generate random interval sets for `n = 12, 16, 20`. Time the EFT greedy, the brute-force oracle, and (for a weighted copy) the DP. Report which is fastest and which scales.

**Expected findings.**
- **Greedy** is `O(n log n)` and instant for all sizes; it is the production choice for the count objective.
- **Brute force** is `O(2^n · n)` and blows up around `n = 20` (`~10⁶` subsets) — usable only as a small-`n` oracle.
- **Weighted DP** is `O(n log n)`, comparable to greedy in time, but solves a *different* (value) objective the greedy cannot.

#### Python
```python
import time, random

def bench(n):
    start = [random.randint(0, n) for _ in range(n)]
    finish = [start[i] + random.randint(1, 8) for i in range(n)]
    for name, fn in [("greedy", lambda: max_activities(start, finish)),
                     ("brute", lambda: brute(start, finish))]:
        t0 = time.perf_counter()
        val = fn()
        dt = (time.perf_counter() - t0) * 1000
        print(f"n={n:<3} {name:<7} {dt:8.2f} ms  -> {val}")

for n in (12, 16, 20):
    bench(n)
# reuse max_activities (Task 1) and brute (Task 3)
```

#### Go / Java
```text
// Time maxActivities (Task 1) and brute (Task 3) on random sets of n = 12/16/20.
// Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: greedy constant-fast; brute roughly doubles per +1 in n.
// Both agree on the count; only the greedy scales past n ~ 20.
```

**Evaluation criteria.**
- Correctness: greedy count equals the brute-force oracle for every `n`.
- Performance: report wall-clock per `n`; explain the `2^n` brute-force wall.
- Discussion: when would you switch from greedy to DP? (Answer: when activities carry values and the objective becomes max total value.)

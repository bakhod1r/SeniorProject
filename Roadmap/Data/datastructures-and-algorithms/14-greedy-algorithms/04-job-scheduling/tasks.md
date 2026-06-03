# Job Scheduling (Job Sequencing with Deadlines) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a brute-force verifier early — it is your oracle for every task. Known checks: `{(100,2),(19,1),(27,2),(25,1),(15,3)}` → 3 jobs / profit 142; all-deadline-1 → 1 job (richest); empty → 0 / 0.

---

## Beginner Tasks (5)

### Task 1 — Sort jobs by descending profit

**Problem.** Given a list of jobs `(profit, deadline)`, return them sorted by **descending profit** (tie-break by ascending deadline for determinism).

**Constraints.** `0 ≤ n ≤ 10⁵`, `1 ≤ profit`, `1 ≤ deadline`.

**Hint.** Use a comparator on `-profit` then `deadline`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type Job struct{ Profit, Deadline int }

func sortJobs(jobs []Job) []Job {
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].Profit != jobs[j].Profit {
			return jobs[i].Profit > jobs[j].Profit
		}
		return jobs[i].Deadline < jobs[j].Deadline
	})
	return jobs
}

func main() {
	jobs := []Job{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}}
	for _, j := range sortJobs(jobs) {
		fmt.Printf("(%d,%d) ", j.Profit, j.Deadline)
	}
	fmt.Println() // (100,2) (27,2) (25,1) (19,1) (15,3)
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        int[][] jobs = {{100,2},{19,1},{27,2},{25,1},{15,3}};
        Arrays.sort(jobs, (a, b) -> a[0] != b[0] ? b[0] - a[0] : a[1] - b[1]);
        for (int[] j : jobs) System.out.printf("(%d,%d) ", j[0], j[1]);
        System.out.println(); // (100,2) (27,2) (25,1) (19,1) (15,3)
    }
}
```

#### Python
```python
def sort_jobs(jobs):
    return sorted(jobs, key=lambda j: (-j[0], j[1]))


print(sort_jobs([(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]))
# [(100, 2), (27, 2), (25, 1), (19, 1), (15, 3)]
```

---

### Task 2 — Schedule with a boolean slot array (linear scan)

**Problem.** Implement the profit-descending, latest-free-slot greedy with a boolean slot array and a downward linear scan. Return `(count, profit)`.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ deadline ≤ n`.

**Hint.** `slot[1..maxD]`; for each job scan `t = deadline … 1` for the first free slot.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type Job struct{ Profit, Deadline int }

func schedule(jobs []Job) (int, int) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Profit > jobs[j].Profit })
	maxD := 0
	for _, j := range jobs {
		if j.Deadline > maxD {
			maxD = j.Deadline
		}
	}
	slot := make([]bool, maxD+1)
	count, profit := 0, 0
	for _, j := range jobs {
		for t := j.Deadline; t >= 1; t-- {
			if !slot[t] {
				slot[t] = true
				count++
				profit += j.Profit
				break
			}
		}
	}
	return count, profit
}

func main() {
	fmt.Println(schedule([]Job{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}})) // 3 142
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static int[] schedule(int[][] jobs) {
        Arrays.sort(jobs, (a, b) -> b[0] - a[0]);
        int maxD = 0;
        for (int[] j : jobs) maxD = Math.max(maxD, j[1]);
        boolean[] slot = new boolean[maxD + 1];
        int count = 0, profit = 0;
        for (int[] j : jobs)
            for (int t = j[1]; t >= 1; t--)
                if (!slot[t]) { slot[t] = true; count++; profit += j[0]; break; }
        return new int[]{count, profit};
    }
    public static void main(String[] args) {
        int[] r = schedule(new int[][]{{100,2},{19,1},{27,2},{25,1},{15,3}});
        System.out.println(r[0] + " " + r[1]); // 3 142
    }
}
```

#### Python
```python
def schedule(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    slot = [False] * (max_d + 1)
    count = profit = 0
    for p, d in jobs:
        for t in range(d, 0, -1):
            if not slot[t]:
                slot[t] = True
                count += 1
                profit += p
                break
    return count, profit


print(schedule([(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]))  # (3, 142)
```

---

### Task 3 — Brute-force oracle via the Hall condition

**Problem.** For small `n`, compute the maximum profit by trying every subset and testing feasibility with the Hall condition (sort deadlines; the `k`-th must be `≥ k`). Validate Task 2.

**Constraints.** `1 ≤ n ≤ 14`.

**Hint.** A set is feasible iff after sorting its deadlines ascending, `ds[i] ≥ i+1` (1-indexed) for all `i`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func feasible(ds []int) bool {
	sort.Ints(ds)
	for i, d := range ds {
		if d < i+1 {
			return false
		}
	}
	return true
}

func brute(jobs [][2]int) int {
	n := len(jobs)
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		var ds []int
		sum := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				ds = append(ds, jobs[i][1])
				sum += jobs[i][0]
			}
		}
		if feasible(ds) && sum > best {
			best = sum
		}
	}
	return best
}

func main() {
	fmt.Println(brute([][2]int{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}})) // 142
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static boolean feasible(List<Integer> ds) {
        Collections.sort(ds);
        for (int i = 0; i < ds.size(); i++) if (ds.get(i) < i + 1) return false;
        return true;
    }
    static int brute(int[][] jobs) {
        int n = jobs.length, best = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<Integer> ds = new ArrayList<>();
            int sum = 0;
            for (int i = 0; i < n; i++)
                if ((mask & (1 << i)) != 0) { ds.add(jobs[i][1]); sum += jobs[i][0]; }
            if (feasible(ds) && sum > best) best = sum;
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(brute(new int[][]{{100,2},{19,1},{27,2},{25,1},{15,3}})); // 142
    }
}
```

#### Python
```python
from itertools import combinations


def feasible(ds):
    ds = sorted(ds)
    return all(d >= i + 1 for i, d in enumerate(ds))


def brute(jobs):
    n = len(jobs)
    best = 0
    for r in range(n + 1):
        for comb in combinations(range(n), r):
            ds = [jobs[i][1] for i in comb]
            if feasible(ds):
                best = max(best, sum(jobs[i][0] for i in comb))
    return best


print(brute([(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]))  # 142
```

---

### Task 4 — Return the actual slot assignment

**Problem.** Extend Task 2 to return, for each accepted job, the slot it runs in. Output a map `job-index → slot`.

**Constraints.** `1 ≤ n ≤ 2000`.

**Hint.** Track the original index of each job through the sort, then record the slot when you place it.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type Job struct {
	ID, Profit, Deadline int
}

func assign(jobs []Job) map[int]int {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Profit > jobs[j].Profit })
	maxD := 0
	for _, j := range jobs {
		if j.Deadline > maxD {
			maxD = j.Deadline
		}
	}
	slot := make([]bool, maxD+1)
	res := map[int]int{}
	for _, j := range jobs {
		for t := j.Deadline; t >= 1; t-- {
			if !slot[t] {
				slot[t] = true
				res[j.ID] = t
				break
			}
		}
	}
	return res
}

func main() {
	jobs := []Job{{0, 100, 2}, {1, 19, 1}, {2, 27, 2}, {3, 25, 1}, {4, 15, 3}}
	fmt.Println(assign(jobs)) // map[0:2 2:1 4:3]
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    static Map<Integer,Integer> assign(int[][] jobs) { // {id, profit, deadline}
        Arrays.sort(jobs, (a, b) -> b[1] - a[1]);
        int maxD = 0;
        for (int[] j : jobs) maxD = Math.max(maxD, j[2]);
        boolean[] slot = new boolean[maxD + 1];
        Map<Integer,Integer> res = new TreeMap<>();
        for (int[] j : jobs)
            for (int t = j[2]; t >= 1; t--)
                if (!slot[t]) { slot[t] = true; res.put(j[0], t); break; }
        return res;
    }
    public static void main(String[] args) {
        int[][] jobs = {{0,100,2},{1,19,1},{2,27,2},{3,25,1},{4,15,3}};
        System.out.println(assign(jobs)); // {0=2, 2=1, 4=3}
    }
}
```

#### Python
```python
def assign(jobs):  # jobs: list of (id, profit, deadline)
    jobs = sorted(jobs, key=lambda j: -j[1])
    max_d = max((d for _, _, d in jobs), default=0)
    slot = [False] * (max_d + 1)
    res = {}
    for jid, p, d in jobs:
        for t in range(d, 0, -1):
            if not slot[t]:
                slot[t] = True
                res[jid] = t
                break
    return res


print(assign([(0, 100, 2), (1, 19, 1), (2, 27, 2), (3, 25, 1), (4, 15, 3)]))
# {0: 2, 2: 1, 4: 3}
```

---

### Task 5 — Maximize the number of jobs (unweighted)

**Problem.** Ignore profit; maximize the **count** of jobs that can be completed on time. Return the count.

**Constraints.** `1 ≤ n ≤ 10⁴`.

**Hint.** Set all profits equal — or sort by deadline and greedily fit each into any free slot `≤ d`. The answer is the maximum feasible cardinality.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func maxCount(deadlines []int) int {
	sort.Ints(deadlines)
	maxD := 0
	for _, d := range deadlines {
		if d > maxD {
			maxD = d
		}
	}
	slot := make([]bool, maxD+1)
	count := 0
	for _, d := range deadlines {
		for t := d; t >= 1; t-- {
			if !slot[t] {
				slot[t] = true
				count++
				break
			}
		}
	}
	return count
}

func main() {
	fmt.Println(maxCount([]int{2, 1, 2, 1, 3})) // 3
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static int maxCount(int[] deadlines) {
        Arrays.sort(deadlines);
        int maxD = 0;
        for (int d : deadlines) maxD = Math.max(maxD, d);
        boolean[] slot = new boolean[maxD + 1];
        int count = 0;
        for (int d : deadlines)
            for (int t = d; t >= 1; t--)
                if (!slot[t]) { slot[t] = true; count++; break; }
        return count;
    }
    public static void main(String[] args) {
        System.out.println(maxCount(new int[]{2,1,2,1,3})); // 3
    }
}
```

#### Python
```python
def max_count(deadlines):
    max_d = max(deadlines, default=0)
    slot = [False] * (max_d + 1)
    count = 0
    for d in sorted(deadlines):
        for t in range(d, 0, -1):
            if not slot[t]:
                slot[t] = True
                count += 1
                break
    return count


print(max_count([2, 1, 2, 1, 3]))  # 3
```

---

## Intermediate Tasks (5)

### Task 6 — Union-find slot allocator

**Problem.** Replace the linear scan with a union-find "latest free slot" allocator for `O(n α(n))` scheduling. Return `(count, profit)`.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ deadline ≤ n`.

**Hint.** `parent[t]` = latest free slot `≤ t`; after taking `s`, set `parent[s] = s-1`. Sentinel `0` = no slot.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func find(par []int, x int) int {
	for par[x] != x {
		par[x] = par[par[x]]
		x = par[x]
	}
	return x
}

func schedule(jobs [][2]int) (int, int64) { // {profit, deadline}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i][0] > jobs[j][0] })
	maxD := 0
	for _, j := range jobs {
		if j[1] > maxD {
			maxD = j[1]
		}
	}
	par := make([]int, maxD+1)
	for i := range par {
		par[i] = i
	}
	count := 0
	var profit int64
	for _, j := range jobs {
		s := find(par, j[1])
		if s > 0 {
			par[s] = s - 1
			count++
			profit += int64(j[0])
		}
	}
	return count, profit
}

func main() {
	fmt.Println(schedule([][2]int{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}})) // 3 142
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static int find(int[] par, int x) {
        while (par[x] != x) { par[x] = par[par[x]]; x = par[x]; }
        return x;
    }
    static long[] schedule(int[][] jobs) {
        Arrays.sort(jobs, (a, b) -> b[0] - a[0]);
        int maxD = 0;
        for (int[] j : jobs) maxD = Math.max(maxD, j[1]);
        int[] par = new int[maxD + 1];
        for (int i = 0; i <= maxD; i++) par[i] = i;
        long count = 0, profit = 0;
        for (int[] j : jobs) {
            int s = find(par, j[1]);
            if (s > 0) { par[s] = s - 1; count++; profit += j[0]; }
        }
        return new long[]{count, profit};
    }
    public static void main(String[] args) {
        long[] r = schedule(new int[][]{{100,2},{19,1},{27,2},{25,1},{15,3}});
        System.out.println(r[0] + " " + r[1]); // 3 142
    }
}
```

#### Python
```python
def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def schedule(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    par = list(range(max_d + 1))
    count = profit = 0
    for p, d in jobs:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            count += 1
            profit += p
    return count, profit


print(schedule([(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]))  # (3, 142)
```

---

### Task 7 — Heap-based method for large deadlines

**Problem.** Implement the deadline-sorted min-heap eviction method. It must use `O(n)` memory and handle deadlines up to `10⁹`.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ deadline ≤ 10⁹`.

**Hint.** Sort by deadline; `len(heap) < d` push, else `heap.top < p` replace.

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
	n := len(o)
	v := o[n-1]
	*h = o[:n-1]
	return v
}

func scheduleHeap(jobs [][2]int) (int, int64) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i][1] < jobs[j][1] })
	h := &MinHeap{}
	for _, j := range jobs {
		if h.Len() < j[1] {
			heap.Push(h, j[0])
		} else if h.Len() > 0 && (*h)[0] < j[0] {
			heap.Pop(h)
			heap.Push(h, j[0])
		}
	}
	var profit int64
	for _, p := range *h {
		profit += int64(p)
	}
	return h.Len(), profit
}

func main() {
	fmt.Println(scheduleHeap([][2]int{{100, 2}, {19, 1}, {27, 2}, {25, 3}, {15, 1000000000}})) // 4 167
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    static long[] scheduleHeap(int[][] jobs) {
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1]));
        PriorityQueue<Integer> h = new PriorityQueue<>();
        for (int[] j : jobs) {
            if (h.size() < j[1]) h.add(j[0]);
            else if (!h.isEmpty() && h.peek() < j[0]) { h.poll(); h.add(j[0]); }
        }
        long profit = 0;
        for (int p : h) profit += p;
        return new long[]{h.size(), profit};
    }
    public static void main(String[] args) {
        long[] r = scheduleHeap(new int[][]{{100,2},{19,1},{27,2},{25,3},{15,1000000000}});
        System.out.println(r[0] + " " + r[1]); // 4 167
    }
}
```

#### Python
```python
import heapq


def schedule_heap(jobs):
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return len(h), sum(h)


print(schedule_heap([(100, 2), (19, 1), (27, 2), (25, 3), (15, 1_000_000_000)]))  # (4, 167)
```

---

### Task 8 — k identical machines

**Problem.** With `k` machines, each time slot can hold up to `k` jobs. Maximize profit. Return `(count, profit)`.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ k ≤ n`.

**Hint.** Heap method: accept while `len(heap) < k·d`, else evict if richer. (Slot method: allow `k` jobs per slot.)

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
	n := len(o)
	v := o[n-1]
	*h = o[:n-1]
	return v
}

func scheduleK(jobs [][2]int, k int) (int, int64) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i][1] < jobs[j][1] })
	h := &MinHeap{}
	for _, j := range jobs {
		cap := k * j[1]
		if h.Len() < cap {
			heap.Push(h, j[0])
		} else if h.Len() > 0 && (*h)[0] < j[0] {
			heap.Pop(h)
			heap.Push(h, j[0])
		}
	}
	var profit int64
	for _, p := range *h {
		profit += int64(p)
	}
	return h.Len(), profit
}

func main() {
	fmt.Println(scheduleK([][2]int{{100, 1}, {50, 1}, {20, 1}}, 2)) // 2 150
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    static long[] scheduleK(int[][] jobs, int k) {
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1]));
        PriorityQueue<Integer> h = new PriorityQueue<>();
        for (int[] j : jobs) {
            int cap = k * j[1];
            if (h.size() < cap) h.add(j[0]);
            else if (!h.isEmpty() && h.peek() < j[0]) { h.poll(); h.add(j[0]); }
        }
        long profit = 0;
        for (int p : h) profit += p;
        return new long[]{h.size(), profit};
    }
    public static void main(String[] args) {
        long[] r = scheduleK(new int[][]{{100,1},{50,1},{20,1}}, 2);
        System.out.println(r[0] + " " + r[1]); // 2 150
    }
}
```

#### Python
```python
import heapq


def schedule_k(jobs, k):
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        cap = k * d
        if len(h) < cap:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return len(h), sum(h)


print(schedule_k([(100, 1), (50, 1), (20, 1)], 2))  # (2, 150)
```

---

### Task 9 — Coordinate-compressed / hash-map union-find

**Problem.** Deadlines are up to `10⁹` but you still want the concrete slot assignment. Use a hash-map union-find (lazy init) so memory stays `O(n)`. Return `(count, profit)` and verify it matches the heap method's profit.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ deadline ≤ 10⁹`.

**Hint.** Replace the `parent[]` array with a map; lazily set `parent[t] = t` on first access; sentinel `0`.

#### Python
```python
import heapq


class SlotDSU:
    def __init__(self):
        self.parent = {0: 0}

    def find(self, t):
        if t <= 0:
            return 0
        if t not in self.parent:
            self.parent[t] = t
        root = t
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[t] != root:
            self.parent[t], t = root, self.parent[t]
        return root

    def allocate(self, d):
        s = self.find(d)
        if s == 0:
            return 0
        self.parent[s] = self.find(s - 1)
        return s


def schedule_hash(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    dsu = SlotDSU()
    count = profit = 0
    for p, d in jobs:
        if dsu.allocate(d) > 0:
            count += 1
            profit += p
    return count, profit


def schedule_heap(jobs):
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return len(h), sum(h)


jobs = [(100, 2), (19, 1), (27, 2), (25, 3), (15, 1_000_000_000)]
a, b = schedule_hash(jobs), schedule_heap(jobs)
print(a, b)            # (4, 167) (4, 167)
assert a[1] == b[1]
```

#### Go / Java
```text
// Mirror the Python: a hash-map (Go: map[int]int, Java: HashMap<Integer,Integer>)
// union-find with lazy parent[t]=t init and sentinel 0. Sort by profit descending,
// allocate(find(d)), chain parent[s]=find(s-1). Assert the profit equals the heap
// method's profit on the same input.
```

---

### Task 10 — Cross-check two methods (property test)

**Problem.** On random inputs, assert the union-find slot method and the heap method produce the **same profit** (the matroid basis weight is unique). Run many trials.

**Constraints.** `1 ≤ n ≤ 30`, profits and deadlines random in `[1, 20]`.

**Hint.** Both are optimal; their profits must agree even if the chosen sets differ.

#### Python
```python
import random
import heapq


def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def slot_profit(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    par = list(range(max_d + 1))
    profit = 0
    for p, d in jobs:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            profit += p
    return profit


def heap_profit(jobs):
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return sum(h)


random.seed(1)
for _ in range(5000):
    n = random.randint(1, 30)
    jobs = [(random.randint(1, 20), random.randint(1, 20)) for _ in range(n)]
    assert slot_profit(jobs) == heap_profit(jobs)
print("5000 trials: slot == heap profit OK")
```

#### Go / Java
```text
// Mirror: generate random jobs, compute profit via union-find slot method and via
// the deadline-sorted heap method, assert equality over many trials. A mismatch
// reveals a sort/scan-direction bug in one of the two implementations.
```

---

## Advanced Tasks (5)

### Task 11 — DP for the weighted variable-length variant (small)

**Problem.** Now jobs have **arbitrary processing times** `t_i`. Maximize on-time profit on one machine (this is NP-hard in general; solve small instances by DP / subset enumeration). Return max profit.

**Constraints.** `1 ≤ n ≤ 18`. Sort by deadline; a subset is feasible iff prefix sums of times respect deadlines.

**Hint.** Sort jobs by deadline. A set (in deadline order) is feasible iff the running sum of processing times never exceeds the current job's deadline. Enumerate subsets / DP over `(index, time-used)`.

#### Python
```python
def max_profit_variable(jobs):
    """jobs: (profit, deadline, time). One machine, arbitrary times."""
    jobs = sorted(jobs, key=lambda j: j[1])  # by deadline
    best = 0
    n = len(jobs)
    # DP over subsets in deadline order: state = total time used so far.
    # dp[t] = max profit achievable using a feasible prefix with t time used.
    from collections import defaultdict
    dp = {0: 0}
    for p, d, t in jobs:
        nd = dict(dp)
        for used, prof in dp.items():
            if used + t <= d:  # finishes by deadline
                cand = prof + p
                if cand > nd.get(used + t, -1):
                    nd[used + t] = cand
        dp = nd
    return max(dp.values())


print(max_profit_variable([(10, 2, 1), (5, 2, 2), (8, 3, 2)]))  # 18
```

#### Go / Java
```text
// Mirror the Python DP: sort by deadline, keep a map/array dp[timeUsed] -> maxProfit.
// For each job (p, d, t), for each reachable timeUsed u with u + t <= d, relax
// dp[u + t] = max(dp[u + t], dp[u] + p). Answer = max over dp. Note this is
// pseudo-polynomial (NP-hard problem); fine for small total time.
```

---

### Task 12 — Reconstruct slots after the heap method

**Problem.** The heap method returns only the chosen set. Given the heap's accepted jobs, produce a concrete `job → slot` assignment (union-find over just the accepted jobs).

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Run the heap method to get accepted jobs; then run the slot union-find over those jobs only (sorted by profit descending) to assign slots.

#### Python
```python
import heapq


def accepted_jobs(jobs):
    """Return the accepted (profit, deadline) set via heap eviction.
    We push (profit, deadline) so we can recover deadlines for reconstruction."""
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []  # min-heap by profit; store (profit, deadline)
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, (p, d))
        elif h and h[0][0] < p:
            heapq.heapreplace(h, (p, d))
    return [(p, d) for p, d in h]


def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def reconstruct(jobs):
    acc = accepted_jobs(jobs)
    acc_sorted = sorted(enumerate(acc), key=lambda kv: -kv[1][0])  # by profit desc
    max_d = max((d for _, d in acc), default=0)
    par = list(range(max_d + 1))
    assignment = {}
    for idx, (p, d) in acc_sorted:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            assignment[(p, d)] = s
    return assignment


jobs = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
print(reconstruct(jobs))  # e.g. {(100,2):2, (27,2):1, (15,3):3}
```

#### Go / Java
```text
// Mirror: heap method that stores (profit, deadline) so deadlines survive; then a
// union-find slot pass over the accepted jobs sorted by profit descending to assign
// each a concrete slot. Verify every assigned slot <= that job's deadline and slots
// are distinct.
```

---

### Task 13 — Minimize total penalty of late jobs (dual)

**Problem.** Each job has a penalty incurred if it is **late** (not scheduled on time). Minimize total penalty. Show it equals `(sum of all penalties) − (max on-time profit with profit = penalty)`.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Maximizing on-time profit (with profit = penalty) and minimizing late penalty are complementary: `minPenalty = totalPenalty − maxScheduledPenalty`.

#### Python
```python
def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def max_scheduled(jobs):  # jobs: (penalty, deadline)
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    par = list(range(max_d + 1))
    s_profit = 0
    for p, d in jobs:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            s_profit += p
    return s_profit


def min_penalty(jobs):
    total = sum(p for p, _ in jobs)
    return total - max_scheduled(jobs)


jobs = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
print(min_penalty(jobs))  # total 186 - scheduled 142 = 44
```

#### Go / Java
```text
// Mirror: reuse the union-find max-profit scheduler with profit = penalty, then
// return sum(penalties) - maxScheduledPenalty. Verify against the brute-force
// minimum-penalty enumeration for small n.
```

---

### Task 14 — Streaming / online admission with capacity

**Problem.** Jobs arrive one at a time. You have a fixed capacity `C` of total slots (e.g. a fixed horizon). Decide on each arrival whether to admit it (irrevocably) to maximize realized profit, keeping at most `C` admitted jobs and respecting deadlines `≤ C`. Compare realized profit to the offline optimum.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ deadline ≤ C ≤ n`.

**Hint.** Maintain the heap-eviction invariant online: on each arrival, apply the same push/evict rule. This online heap *is* the offline optimum when all jobs are seen (order-independent for the heap method), so realized profit equals the offline max — a nice property to demonstrate.

#### Python
```python
import heapq


def online_admission(stream):
    """Process jobs (profit, deadline) one at a time with heap eviction.
    Returns realized profit after the whole stream."""
    h = []
    for p, d in sorted(stream, key=lambda j: j[1]):  # heap method needs deadline order
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return sum(h)


def offline_opt(jobs):
    return online_admission(jobs)  # same algorithm; demonstrates equality


jobs = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
print(online_admission(jobs), offline_opt(jobs))  # 142 142
```

#### Go / Java
```text
// Mirror: the heap-eviction method, framed as processing a deadline-sorted stream.
// Demonstrate that the heap method's result is independent of profit order (only
// deadline order matters), so the realized profit equals the offline optimum.
```

---

### Task 15 — Counting-sort optimization to O(n)

**Problem.** When deadlines and profits are bounded integers (`≤ n`), replace the comparison sort with counting sort so the whole pipeline is `O(n)`. Return `(count, profit)` and confirm it matches the comparison-sort version.

**Constraints.** `1 ≤ n ≤ 10⁶`, `1 ≤ profit ≤ n`, `1 ≤ deadline ≤ n`.

**Hint.** Counting-sort jobs by profit descending (bucket by profit value), then run the union-find slot allocator.

#### Python
```python
def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def schedule_counting(jobs, max_profit_val):
    # counting sort by profit descending
    buckets = [[] for _ in range(max_profit_val + 1)]
    max_d = 0
    for p, d in jobs:
        buckets[p].append(d)
        max_d = max(max_d, d)
    par = list(range(max_d + 1))
    count = profit = 0
    for p in range(max_profit_val, 0, -1):     # high profit first
        for d in buckets[p]:
            s = find(par, d)
            if s > 0:
                par[s] = s - 1
                count += 1
                profit += p
    return count, profit


def schedule_sorted(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    par = list(range(max_d + 1))
    count = profit = 0
    for p, d in jobs:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            count += 1
            profit += p
    return count, profit


jobs = [(5, 2), (1, 1), (3, 2), (3, 1), (2, 3)]
a = schedule_counting(jobs, 5)
b = schedule_sorted(jobs)
print(a, b)          # equal
assert a == b
```

#### Go / Java
```text
// Mirror: bucket jobs by profit value into an array of lists, iterate profit values
// from high to low, run the union-find slot allocator. O(n + maxProfit) time.
// Assert the result equals the O(n log n) comparison-sort version.
```

---

## Benchmark Task — Linear Scan vs Union-Find vs Heap

**Problem.** Generate `n = 10⁴, 10⁵, 10⁶` random jobs (dense deadlines `≤ n`) and time the three methods: linear-scan slot, union-find slot, heap. Then repeat with **sparse** deadlines (up to `10⁹`) and observe which methods remain feasible.

**Expected findings.**
- **Linear scan** degrades badly as `D` grows (worst case `O(nD)`); only viable for tiny dense deadlines.
- **Union-find slot** is `O(n log n)` and fastest for dense small deadlines; with arrays it **cannot** handle `D = 10⁹` (memory), but a hash-map variant can at `O(n)` memory.
- **Heap** is `O(n log n)`, `O(n)` memory, and the only array-free method that scales to huge sparse deadlines when you need just the value/set.

#### Python
```python
import time
import random


def bench(n, max_d):
    jobs = [(random.randint(1, 10**9), random.randint(1, max_d)) for _ in range(n)]
    for name, fn in [("heap", schedule_heap)]:  # add union-find when D small enough
        t0 = time.perf_counter()
        val = fn(jobs)
        dt = time.perf_counter() - t0
        print(f"n={n:<8} D={max_d:<12} {name:<6} {dt*1000:8.1f} ms -> {val}")


def schedule_heap(jobs):
    import heapq
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return len(h), sum(h)


for n in (10_000, 100_000, 1_000_000):
    bench(n, max_d=10**9)   # heap handles huge deadlines; array union-find would OOM
```

#### Go / Java
```text
// Time linear-scan (small D only), union-find (array for dense, hash for sparse),
// and heap. Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: heap and union-find are O(n log n); linear scan blows up with D; array
// union-find OOMs at D=1e9 while the heap stays at O(n) memory.
```

**Evaluation criteria.**
- Correctness: all feasible methods agree on profit (matroid basis weight is unique).
- Performance: report wall-clock per `n`; explain the `O(nD)` trap of linear scan.
- Discussion: when would you pick union-find over heap? (Answer: dense small deadlines and when you need the concrete slot assignment.)
</content>
</invoke>

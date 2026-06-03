# Set Cover Approximation — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a brute-force exact solver early — it is your oracle for every covering task. Known checks: single set = universe → 1; `n` singletons → `n`; greedy ≤ `H(n)·OPT` always.

---

## Beginner Tasks (5)

### Task 1 — Build coverage tracking and compute a set's gain

**Problem.** Given a universe size `n`, a `covered` boolean array, and a set (list of element ids), compute the **gain** = number of still-uncovered elements in the set.

**Constraints.** `1 ≤ n ≤ 1000`, element ids in `[0, n)`.

**Hint.** `gain = count of e in set with covered[e] == false`. This is the single most-used operation in greedy.

#### Go
```go
package main

import "fmt"

func gain(covered []bool, set []int) int {
	g := 0
	for _, e := range set {
		if !covered[e] {
			g++
		}
	}
	return g
}

func main() {
	covered := make([]bool, 5)
	covered[1] = true
	fmt.Println(gain(covered, []int{0, 1, 2})) // 2 (0 and 2 are uncovered)
}
```

#### Java
```java
public class Task1 {
    static int gain(boolean[] covered, int[] set) {
        int g = 0;
        for (int e : set) if (!covered[e]) g++;
        return g;
    }
    public static void main(String[] args) {
        boolean[] covered = new boolean[5];
        covered[1] = true;
        System.out.println(gain(covered, new int[]{0, 1, 2})); // 2
    }
}
```

#### Python
```python
def gain(covered, s):
    return sum(1 for e in s if not covered[e])


covered = [False] * 5
covered[1] = True
print(gain(covered, [0, 1, 2]))  # 2
```

---

### Task 2 — Greedy set cover (minimize number of sets)

**Problem.** Implement greedy: repeatedly pick the set with the largest gain until the universe is covered. Return the chosen set indices.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ m ≤ 2000`. Feasible instances.

**Hint.** Loop while `numCovered < n`; scan all sets for the max gain; mark its elements covered.

#### Go
```go
package main

import "fmt"

func greedy(n int, sets [][]int) []int {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	for numCovered < n {
		best, bestGain := -1, 0
		for i, s := range sets {
			g := 0
			for _, e := range s {
				if !covered[e] {
					g++
				}
			}
			if g > bestGain {
				bestGain, best = g, i
			}
		}
		if best == -1 || bestGain == 0 {
			break
		}
		chosen = append(chosen, best)
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen
}

func main() {
	fmt.Println(greedy(5, [][]int{{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}})) // [0 3]
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static List<Integer> greedy(int n, int[][] sets) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (numCovered < n) {
            int best = -1, bestGain = 0;
            for (int i = 0; i < sets.length; i++) {
                int g = 0;
                for (int e : sets[i]) if (!covered[e]) g++;
                if (g > bestGain) { bestGain = g; best = i; }
            }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            for (int e : sets[best]) if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return chosen;
    }
    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}};
        System.out.println(greedy(5, sets)); // [0, 3]
    }
}
```

#### Python
```python
def greedy(n, sets):
    covered = [False] * n
    num_covered = 0
    chosen = []
    while num_covered < n:
        best, best_gain = -1, 0
        for i, s in enumerate(sets):
            g = sum(1 for e in s if not covered[e])
            if g > best_gain:
                best_gain, best = g, i
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen


print(greedy(5, [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]))  # [0, 3]
```

---

### Task 3 — Feasibility check

**Problem.** Before running greedy, confirm a cover exists: the union of all sets must equal the universe `{0..n-1}`. Return the list of uncoverable elements (empty if feasible).

**Constraints.** `1 ≤ n ≤ 10⁴`.

**Hint.** Mark every element that appears in some set; the unmarked ones are uncoverable.

#### Go
```go
package main

import "fmt"

func uncoverable(n int, sets [][]int) []int {
	seen := make([]bool, n)
	for _, s := range sets {
		for _, e := range s {
			seen[e] = true
		}
	}
	var bad []int
	for e := 0; e < n; e++ {
		if !seen[e] {
			bad = append(bad, e)
		}
	}
	return bad
}

func main() {
	fmt.Println(uncoverable(5, [][]int{{0, 1}, {2, 3}})) // [4]
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static List<Integer> uncoverable(int n, int[][] sets) {
        boolean[] seen = new boolean[n];
        for (int[] s : sets) for (int e : s) seen[e] = true;
        List<Integer> bad = new ArrayList<>();
        for (int e = 0; e < n; e++) if (!seen[e]) bad.add(e);
        return bad;
    }
    public static void main(String[] args) {
        System.out.println(uncoverable(5, new int[][]{{0, 1}, {2, 3}})); // [4]
    }
}
```

#### Python
```python
def uncoverable(n, sets):
    seen = [False] * n
    for s in sets:
        for e in s:
            seen[e] = True
    return [e for e in range(n) if not seen[e]]


print(uncoverable(5, [[0, 1], [2, 3]]))  # [4]
```

---

### Task 4 — Brute-force optimum (oracle)

**Problem.** For small `m`, find the exact minimum cover size by trying all `2^m` sub-collections. Use it to validate greedy.

**Constraints.** `1 ≤ n ≤ 20`, `1 ≤ m ≤ 20` (exponential — tiny only).

**Hint.** Precompute each set as a bitmask over elements; OR the chosen masks; a sub-collection is a cover iff its OR equals `(1<<n)-1`.

#### Go
```go
package main

import "fmt"

func bruteMin(n int, sets [][]int) int {
	full := (1 << n) - 1
	masks := make([]int, len(sets))
	for i, s := range sets {
		for _, e := range s {
			masks[i] |= 1 << e
		}
	}
	best := -1
	for sub := 0; sub < (1 << len(sets)); sub++ {
		cov, cnt := 0, 0
		for i := range sets {
			if sub&(1<<i) != 0 {
				cov |= masks[i]
				cnt++
			}
		}
		if cov == full && (best == -1 || cnt < best) {
			best = cnt
		}
	}
	return best
}

func main() {
	fmt.Println(bruteMin(5, [][]int{{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}})) // 2
}
```

#### Java
```java
public class Task4 {
    static int bruteMin(int n, int[][] sets) {
        int full = (1 << n) - 1;
        int[] masks = new int[sets.length];
        for (int i = 0; i < sets.length; i++)
            for (int e : sets[i]) masks[i] |= 1 << e;
        int best = -1;
        for (int sub = 0; sub < (1 << sets.length); sub++) {
            int cov = 0, cnt = 0;
            for (int i = 0; i < sets.length; i++)
                if ((sub & (1 << i)) != 0) { cov |= masks[i]; cnt++; }
            if (cov == full && (best == -1 || cnt < best)) best = cnt;
        }
        return best;
    }
    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}};
        System.out.println(bruteMin(5, sets)); // 2
    }
}
```

#### Python
```python
def brute_min(n, sets):
    full = (1 << n) - 1
    masks = [sum(1 << e for e in s) for s in sets]
    best = None
    for sub in range(1 << len(sets)):
        cov, cnt = 0, 0
        for i in range(len(sets)):
            if sub & (1 << i):
                cov |= masks[i]
                cnt += 1
        if cov == full and (best is None or cnt < best):
            best = cnt
    return best


print(brute_min(5, [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]))  # 2
```

---

### Task 5 — Verify the approximation ratio on small instances

**Problem.** For random tiny instances, confirm `greedy_size ≤ H(n) · OPT` always holds (compare greedy against the brute-force optimum).

**Constraints.** `2 ≤ n ≤ 12`, `2 ≤ m ≤ 14`.

**Hint.** `H(n) = sum(1/j for j in 1..n)`. Assert `len(greedy) <= H(n) * OPT + 1e-9`. (It is usually far below.)

#### Python
```python
import random


def H(n):
    return sum(1.0 / j for j in range(1, n + 1))


def random_feasible(n, m):
    sets = [[i] for i in range(n)]  # guarantees feasibility (singletons)
    for _ in range(m - n if m > n else 1):
        k = random.randint(1, n)
        sets.append(random.sample(range(n), k))
    return sets


def check(n, m):
    sets = random_feasible(n, m)
    g = len(greedy(n, sets))
    opt = brute_min(n, sets)
    assert g <= H(n) * opt + 1e-9, (g, opt, H(n))
    return g, opt


for _ in range(200):
    n = random.randint(2, 8)
    check(n, n + random.randint(0, 5))
print("ratio bound holds on all random instances")
# reuse greedy (Task 2) and brute_min (Task 4)
```

#### Go / Java
```text
// Build a random feasible instance (start from singletons, add random subsets),
// run greedy (Task 2) and bruteMin (Task 4), and assert
//   greedySize <= H(n) * opt   (with a small epsilon).
// Go: math.Log or sum 1/j. Java: sum 1.0/j. Mirror the Python.
```

---

## Intermediate Tasks (5)

### Task 6 — Weighted set cover (minimize total cost)

**Problem.** Each set has a cost. Implement cost-effectiveness greedy: pick the set with the smallest `cost / gain` each round. Return chosen sets and total cost.

**Constraints.** `1 ≤ n ≤ 5000`, `1 ≤ m ≤ 5000`, positive costs.

**Hint.** `ratio = cost[i] / gain`. Track the minimum ratio (skip gain-0 sets). Unit costs reduce to Task 2.

#### Go
```go
package main

import "fmt"

func weighted(n int, sets [][]int, cost []float64) ([]int, float64) {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	total := 0.0
	for numCovered < n {
		best := -1
		bestRatio := 0.0
		for i, s := range sets {
			g := 0
			for _, e := range s {
				if !covered[e] {
					g++
				}
			}
			if g == 0 {
				continue
			}
			r := cost[i] / float64(g)
			if best == -1 || r < bestRatio {
				bestRatio, best = r, i
			}
		}
		if best == -1 {
			break
		}
		chosen = append(chosen, best)
		total += cost[best]
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen, total
}

func main() {
	c, t := weighted(4, [][]int{{0, 1, 2}, {0, 1}, {2, 3}}, []float64{3, 1, 1})
	fmt.Println(c, t) // [1 2] 2
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static Object[] weighted(int n, int[][] sets, double[] cost) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        double total = 0.0;
        while (numCovered < n) {
            int best = -1;
            double bestRatio = 0.0;
            for (int i = 0; i < sets.length; i++) {
                int g = 0;
                for (int e : sets[i]) if (!covered[e]) g++;
                if (g == 0) continue;
                double r = cost[i] / g;
                if (best == -1 || r < bestRatio) { bestRatio = r; best = i; }
            }
            if (best == -1) break;
            chosen.add(best);
            total += cost[best];
            for (int e : sets[best]) if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return new Object[]{chosen, total};
    }
    public static void main(String[] args) {
        Object[] r = weighted(4, new int[][]{{0, 1, 2}, {0, 1}, {2, 3}}, new double[]{3, 1, 1});
        System.out.println(r[0] + " " + r[1]); // [1, 2] 2.0
    }
}
```

#### Python
```python
def weighted(n, sets, cost):
    covered = [False] * n
    num_covered = 0
    chosen, total = [], 0.0
    while num_covered < n:
        best, best_ratio = -1, 0.0
        for i, s in enumerate(sets):
            g = sum(1 for e in s if not covered[e])
            if g == 0:
                continue
            r = cost[i] / g
            if best == -1 or r < best_ratio:
                best_ratio, best = r, i
        if best == -1:
            break
        chosen.append(best)
        total += cost[best]
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen, total


print(weighted(4, [[0, 1, 2], [0, 1], [2, 3]], [3, 1, 1]))  # ([1, 2], 2.0)
```

---

### Task 7 — Bitset greedy (fast for moderate n)

**Problem.** Represent each set and the covered mask as integers; compute gain as `popcount(setMask & ~coveredMask)`. Implement greedy with bitsets.

**Constraints.** `1 ≤ n ≤ 60` (fits in one 64-bit word for this task). `m ≤ 5000`.

**Hint.** `gain = popcount(setMask[i] & ~covered)`. Pick the max, then `covered |= setMask[best]`.

#### Go
```go
package main

import (
	"fmt"
	"math/bits"
)

func bitsetGreedy(n int, sets [][]int) []int {
	masks := make([]uint64, len(sets))
	for i, s := range sets {
		for _, e := range s {
			masks[i] |= 1 << uint(e)
		}
	}
	full := uint64(0)
	if n == 64 {
		full = ^uint64(0)
	} else {
		full = (uint64(1) << uint(n)) - 1
	}
	var covered uint64
	var chosen []int
	for covered != full {
		best, bestGain := -1, 0
		for i := range masks {
			g := bits.OnesCount64(masks[i] &^ covered)
			if g > bestGain {
				bestGain, best = g, i
			}
		}
		if best == -1 || bestGain == 0 {
			break
		}
		chosen = append(chosen, best)
		covered |= masks[best]
	}
	return chosen
}

func main() {
	fmt.Println(bitsetGreedy(5, [][]int{{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}})) // [0 3]
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    static List<Integer> bitsetGreedy(int n, int[][] sets) {
        long[] masks = new long[sets.length];
        for (int i = 0; i < sets.length; i++)
            for (int e : sets[i]) masks[i] |= 1L << e;
        long full = (n == 64) ? -1L : (1L << n) - 1;
        long covered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (covered != full) {
            int best = -1, bestGain = 0;
            for (int i = 0; i < masks.length; i++) {
                int g = Long.bitCount(masks[i] & ~covered);
                if (g > bestGain) { bestGain = g; best = i; }
            }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            covered |= masks[best];
        }
        return chosen;
    }
    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}};
        System.out.println(bitsetGreedy(5, sets)); // [0, 3]
    }
}
```

#### Python
```python
def bitset_greedy(n, sets):
    masks = [sum(1 << e for e in s) for s in sets]
    full = (1 << n) - 1
    covered = 0
    chosen = []
    while covered != full:
        best, best_gain = -1, 0
        for i, msk in enumerate(masks):
            g = bin(msk & ~covered).count("1")
            if g > best_gain:
                best_gain, best = g, i
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        covered |= masks[best]
    return chosen


print(bitset_greedy(5, [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]))  # [0, 3]
```

---

### Task 8 — Max k-coverage (maximize coverage under a budget)

**Problem.** Pick exactly `k` sets to maximize the number of covered elements. Return the chosen sets and the coverage count.

**Constraints.** `1 ≤ n ≤ 5000`, `1 ≤ k ≤ m ≤ 5000`.

**Hint.** Greedy: pick the max-gain set `k` times (stop early if gain hits 0). Guarantee: `≥ (1 − 1/e)·OPT`.

#### Go
```go
package main

import "fmt"

func maxCov(n int, sets [][]int, k int) ([]int, int) {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	for len(chosen) < k {
		best, bestGain := -1, 0
		for i, s := range sets {
			g := 0
			for _, e := range s {
				if !covered[e] {
					g++
				}
			}
			if g > bestGain {
				bestGain, best = g, i
			}
		}
		if best == -1 || bestGain == 0 {
			break
		}
		chosen = append(chosen, best)
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen, numCovered
}

func main() {
	c, cov := maxCov(6, [][]int{{0, 1, 2, 3}, {0, 1}, {2, 3, 4}, {4, 5}}, 2)
	fmt.Println(c, cov) // [0 3] 6
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    static Object[] maxCov(int n, int[][] sets, int k) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (chosen.size() < k) {
            int best = -1, bestGain = 0;
            for (int i = 0; i < sets.length; i++) {
                int g = 0;
                for (int e : sets[i]) if (!covered[e]) g++;
                if (g > bestGain) { bestGain = g; best = i; }
            }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            for (int e : sets[best]) if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return new Object[]{chosen, numCovered};
    }
    public static void main(String[] args) {
        Object[] r = maxCov(6, new int[][]{{0, 1, 2, 3}, {0, 1}, {2, 3, 4}, {4, 5}}, 2);
        System.out.println(r[0] + " " + r[1]); // [0, 3] 6
    }
}
```

#### Python
```python
def max_cov(n, sets, k):
    covered = [False] * n
    num_covered = 0
    chosen = []
    while len(chosen) < k:
        best, best_gain = -1, 0
        for i, s in enumerate(sets):
            g = sum(1 for e in s if not covered[e])
            if g > best_gain:
                best_gain, best = g, i
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen, num_covered


print(max_cov(6, [[0, 1, 2, 3], [0, 1], [2, 3, 4], [4, 5]], 2))  # ([0, 3], 6)
```

---

### Task 9 — Inverted-index greedy (efficient)

**Problem.** Implement greedy using an inverted index (element → sets) so each round only updates the gains of sets sharing a newly covered element, not all sets.

**Constraints.** `1 ≤ n, m ≤ 10⁵`, total incidences `≤ 10⁶`.

**Hint.** Maintain `gain[i]` for each set. When element `e` is newly covered, for every set `j` in `index[e]`, do `gain[j]--`. Pick argmax of `gain` each round (a heap makes this fast; a linear scan is fine for the task).

#### Go
```go
package main

import "fmt"

func indexedGreedy(n int, sets [][]int) []int {
	index := make([][]int, n)
	gain := make([]int, len(sets))
	for i, s := range sets {
		gain[i] = len(s)
		for _, e := range s {
			index[e] = append(index[e], i)
		}
	}
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	for numCovered < n {
		best, bestGain := -1, 0
		for i := range gain {
			if gain[i] > bestGain {
				bestGain, best = gain[i], i
			}
		}
		if best == -1 || bestGain == 0 {
			break
		}
		chosen = append(chosen, best)
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
				for _, j := range index[e] {
					gain[j]--
				}
			}
		}
	}
	return chosen
}

func main() {
	fmt.Println(indexedGreedy(5, [][]int{{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}})) // [0 3]
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static List<Integer> indexedGreedy(int n, int[][] sets) {
        List<List<Integer>> index = new ArrayList<>();
        for (int e = 0; e < n; e++) index.add(new ArrayList<>());
        int[] gain = new int[sets.length];
        for (int i = 0; i < sets.length; i++) {
            gain[i] = sets[i].length;
            for (int e : sets[i]) index.get(e).add(i);
        }
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (numCovered < n) {
            int best = -1, bestGain = 0;
            for (int i = 0; i < gain.length; i++)
                if (gain[i] > bestGain) { bestGain = gain[i]; best = i; }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            for (int e : sets[best]) {
                if (!covered[e]) {
                    covered[e] = true; numCovered++;
                    for (int j : index.get(e)) gain[j]--;
                }
            }
        }
        return chosen;
    }
    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}};
        System.out.println(indexedGreedy(5, sets)); // [0, 3]
    }
}
```

#### Python
```python
def indexed_greedy(n, sets):
    index = [[] for _ in range(n)]
    gain = [0] * len(sets)
    for i, s in enumerate(sets):
        gain[i] = len(s)
        for e in s:
            index[e].append(i)
    covered = [False] * n
    num_covered = 0
    chosen = []
    while num_covered < n:
        best, best_gain = -1, 0
        for i, g in enumerate(gain):
            if g > best_gain:
                best_gain, best = g, i
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
                for j in index[e]:
                    gain[j] -= 1
    return chosen


print(indexed_greedy(5, [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]))  # [0, 3]
```

---

### Task 10 — Vertex cover as set cover (frequency f = 2)

**Problem.** Model a graph's vertex-cover problem as set cover: universe = edges, each vertex = the set of edges it touches. Run greedy and report the chosen vertices.

**Constraints.** `1 ≤ V ≤ 5000`, `1 ≤ E ≤ 10⁴`.

**Hint.** Number the edges `0..E-1`. For each vertex `v`, its "set" is the list of incident edge ids. Greedy on these sets gives a vertex cover (with `H(E)` guarantee; LP/matching gives a better 2-approx, but greedy is the exercise here).

#### Go
```go
package main

import "fmt"

func vertexCoverViaSetCover(V int, edges [][2]int) []int {
	E := len(edges)
	sets := make([][]int, V)
	for id, e := range edges {
		sets[e[0]] = append(sets[e[0]], id)
		sets[e[1]] = append(sets[e[1]], id)
	}
	// greedy over edge-universe
	covered := make([]bool, E)
	numCovered := 0
	var chosen []int
	for numCovered < E {
		best, bestGain := -1, 0
		for v := 0; v < V; v++ {
			g := 0
			for _, id := range sets[v] {
				if !covered[id] {
					g++
				}
			}
			if g > bestGain {
				bestGain, best = g, v
			}
		}
		if best == -1 || bestGain == 0 {
			break
		}
		chosen = append(chosen, best)
		for _, id := range sets[best] {
			if !covered[id] {
				covered[id] = true
				numCovered++
			}
		}
	}
	return chosen
}

func main() {
	// triangle 0-1, 1-2, 0-2: a vertex cover needs 2 vertices
	fmt.Println(vertexCoverViaSetCover(3, [][2]int{{0, 1}, {1, 2}, {0, 2}})) // e.g. [0 1]
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static List<Integer> vc(int V, int[][] edges) {
        int E = edges.length;
        List<List<Integer>> sets = new ArrayList<>();
        for (int v = 0; v < V; v++) sets.add(new ArrayList<>());
        for (int id = 0; id < E; id++) {
            sets.get(edges[id][0]).add(id);
            sets.get(edges[id][1]).add(id);
        }
        boolean[] covered = new boolean[E];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (numCovered < E) {
            int best = -1, bestGain = 0;
            for (int v = 0; v < V; v++) {
                int g = 0;
                for (int id : sets.get(v)) if (!covered[id]) g++;
                if (g > bestGain) { bestGain = g; best = v; }
            }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            for (int id : sets.get(best)) if (!covered[id]) { covered[id] = true; numCovered++; }
        }
        return chosen;
    }
    public static void main(String[] args) {
        System.out.println(vc(3, new int[][]{{0, 1}, {1, 2}, {0, 2}})); // 2 vertices
    }
}
```

#### Python
```python
def vertex_cover_via_set_cover(V, edges):
    E = len(edges)
    sets = [[] for _ in range(V)]
    for idx, (a, b) in enumerate(edges):
        sets[a].append(idx)
        sets[b].append(idx)
    covered = [False] * E
    num_covered = 0
    chosen = []
    while num_covered < E:
        best, best_gain = -1, 0
        for v in range(V):
            g = sum(1 for idx in sets[v] if not covered[idx])
            if g > best_gain:
                best_gain, best = g, v
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        for idx in sets[best]:
            if not covered[idx]:
                covered[idx] = True
                num_covered += 1
    return chosen


print(vertex_cover_via_set_cover(3, [(0, 1), (1, 2), (0, 2)]))  # 2 vertices
```

---

## Advanced Tasks (5)

### Task 11 — Lazy greedy (CELF) with a priority queue

**Problem.** Implement lazy greedy: keep gains in a max-heap with a "last computed" stamp; pop the top, refresh if stale, pick if current. Returns the same cover as eager greedy, faster.

**Constraints.** `1 ≤ n, m ≤ 10⁵`.

**Hint.** Gains only shrink (submodularity), so a stale stored gain is an upper bound. Re-push refreshed entries; skip ones below the current best implicitly.

#### Python (reference; Go/Java mirror the heap logic)
```python
import heapq


def lazy_greedy(n, sets):
    index = [[] for _ in range(n)]
    gain = [0] * len(sets)
    for i, s in enumerate(sets):
        gain[i] = len(s)
        for e in s:
            index[e].append(i)
    covered = [False] * n
    num_covered = 0
    heap = [(-gain[i], i) for i in range(len(sets)) if gain[i] > 0]
    heapq.heapify(heap)
    chosen = []
    while num_covered < n and heap:
        neg_g, s = heapq.heappop(heap)
        if -neg_g != gain[s]:                 # stale -> refresh
            if gain[s] > 0:
                heapq.heappush(heap, (-gain[s], s))
            continue
        if gain[s] == 0:
            break
        chosen.append(s)
        for e in sets[s]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
                for j in index[e]:
                    gain[j] -= 1
    return chosen


sets = [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]
assert lazy_greedy(5, sets) == indexed_greedy(5, sets)  # same cover
print(lazy_greedy(5, sets))  # [0, 3]
```

#### Go
```go
// lazyGreedy: container/heap max-heap of (gain, set). Pop top; if its stored gain
// != live gain[set], refresh and re-push; else pick it and decrement affected gains
// via the inverted index. Verify it returns the same cover as indexedGreedy (Task 9).
```

#### Java
```java
// lazyGreedy: PriorityQueue<int[]>{gain, set} max-heap. Poll; if gain[set] changed,
// re-add the refreshed entry; else pick and decrement affected gains via the index.
// Verify equality with indexedGreedy (Task 9) on the sample instance.
```

---

### Task 12 — Greedy with a dual-fitting lower bound (certificate)

**Problem.** Run weighted greedy and simultaneously compute the LP-dual lower bound (fitted prices ÷ `H(n)`), so the result certifies `dualLB ≤ OPT ≤ cost`.

**Constraints.** `1 ≤ n ≤ 5000`.

**Hint.** When a set with cost `c` and gain `g` is chosen, set `price[e] = c/g` for each newly covered `e`. Then `dualLB = sum(price) / H(n)`.

#### Python
```python
def greedy_with_dual(n, sets, cost):
    covered = [False] * n
    num_covered = 0
    price = [0.0] * n
    chosen, total = [], 0.0
    while num_covered < n:
        best, best_ratio, best_gain = -1, 0.0, 0
        for i, s in enumerate(sets):
            g = sum(1 for e in s if not covered[e])
            if g == 0:
                continue
            r = cost[i] / g
            if best == -1 or r < best_ratio:
                best_ratio, best, best_gain = r, i, g
        if best == -1:
            break
        chosen.append(best)
        total += cost[best]
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
                price[e] = cost[best] / best_gain
    Hn = sum(1.0 / j for j in range(1, n + 1)) or 1.0
    return chosen, total, sum(price) / Hn


sets = [[0, 1, 2], [0, 1], [2, 3]]
chosen, total, lb = greedy_with_dual(4, sets, [3, 1, 1])
print(chosen, total, round(lb, 3))   # [1, 2] 2.0  lb <= OPT(=2) <= 2.0
assert lb <= total + 1e-9
```

#### Go / Java
```text
// Mirror Python: track price[e] = cost/gain at cover time; dualLB = sum(price)/H(n).
// Assert dualLB <= cost. The dual lower bound certifies near-optimality without an LP solver.
```

---

### Task 13 — Tight instance: make greedy do `≈ log n` worse than OPT

**Problem.** Construct an instance where greedy uses `≈ log₂ n` sets while OPT = 2, demonstrating the ratio is tight.

**Constraints.** Build for `n = 2^k − 2` style universes; verify greedy_size / OPT grows like `log n`.

**Hint.** Two sets `A, B` partition `U` into halves (OPT = 2). Add "lure" sets `Tⱼ` each covering the largest remaining block so greedy prefers them, picking `≈ log n` sets. Break ties toward the lures.

#### Python
```python
def tight_instance(k):
    """Universe of 2^k elements. OPT = 2 (two halves). Greedy lured into ~k sets."""
    n = 1 << k
    A = list(range(0, n, 2))      # evens  -> one optimal half
    B = list(range(1, n, 2))      # odds   -> other optimal half
    sets = [A, B]
    # lure sets: each covers a block slightly larger than what A or B add next.
    # Simple lure: nested halves that greedy grabs first by max-gain ties.
    remaining = list(range(n))
    size = n
    while size > 1:
        size //= 2
        lure = remaining[:size + 1] if size + 1 <= len(remaining) else remaining[:]
        if lure:
            sets.append(lure)
        remaining = remaining[size:]
    return n, sets


for k in range(2, 8):
    n, sets = tight_instance(k)
    g = len(greedy(n, sets))
    # OPT is at most 2 (A and B cover everything)
    print(f"n={n}: greedy={g}, OPT<=2, ratio≈{g/2:.1f}")
# reuse greedy (Task 2)
```

#### Go / Java
```text
// Build A = evens, B = odds (OPT <= 2), plus nested "lure" sets of decreasing size.
// Run greedy; observe the chosen count grows ~log2(n) while OPT is 2.
// This is the canonical tightness demonstration for the H(n) bound.
```

---

### Task 14 — Set multicover (cover each element ≥ r times)

**Problem.** Generalize: each element `e` must be covered at least `r[e]` times. Greedy picks the set maximizing the **residual** coverage (sum over its elements of remaining required coverage, capped). Still `H(n)`-ish.

**Constraints.** `1 ≤ n ≤ 5000`, `1 ≤ r[e] ≤ 5`. Allow choosing a set at most once (or with copies — state your model).

**Hint.** Track `need[e]` (remaining coverage). A set's gain = `sum over e in set of (need[e] > 0 ? 1 : 0)`. Picking it decrements `need[e]` for its elements. Stop when all `need[e] == 0`. (Model: a set may be reused; if not, remove it after use.)

#### Python
```python
def multicover(n, sets, r):
    need = list(r)
    total_need = sum(need)
    chosen = []
    used = [False] * len(sets)
    while total_need > 0:
        best, best_gain = -1, 0
        for i, s in enumerate(sets):
            if used[i]:
                continue
            g = sum(1 for e in s if need[e] > 0)
            if g > best_gain:
                best_gain, best = g, i
        if best == -1 or best_gain == 0:
            break  # infeasible for the remaining demand
        used[best] = True
        chosen.append(best)
        for e in sets[best]:
            if need[e] > 0:
                need[e] -= 1
                total_need -= 1
    return chosen


# each of {0,1,2} must be covered twice
sets = [[0, 1, 2], [0, 1], [1, 2], [0, 2]]
print(multicover(3, sets, [2, 2, 2]))  # picks sets covering each element twice
```

#### Go / Java
```text
// Track need[e]; a set's gain counts elements still needing coverage.
// Pick max gain, decrement need for its elements (model: each set used once).
// Stop when total remaining need is 0; report infeasible if no set helps.
```

---

### Task 15 — Benchmark: naive vs inverted-index vs bitset

**Problem.** Generate large random feasible instances and time three implementations: naive `O(m·n)` greedy, inverted-index greedy, and bitset greedy. Report which is fastest and confirm all produce the same cover size.

**Constraints.** `n, m` up to `10⁴`–`10⁵`; total incidences up to `10⁶`.

**Hint.** Naive rescans all sets each round; inverted-index updates only affected gains; bitset uses `popcount`. Confirm identical cover *size* (covers may differ on ties but size matches with the same tie-break).

#### Python
```python
import random
import time


def random_instance(n, m, avg):
    sets = [[i] for i in range(n)]  # ensure feasibility
    for _ in range(m):
        k = max(1, random.randint(1, avg))
        sets.append(random.sample(range(n), k))
    return sets


def bench(n, m, avg):
    sets = random_instance(n, m, avg)
    for name, fn in [("naive", greedy),
                     ("indexed", indexed_greedy),
                     ("bitset", bitset_greedy)]:
        t0 = time.perf_counter()
        size = len(fn(n, sets))
        dt = time.perf_counter() - t0
        print(f"{name:<8} {dt*1000:8.1f} ms  cover size {size}")


bench(1000, 2000, 50)
# reuse greedy (Task 2), indexed_greedy (Task 9), bitset_greedy (Task 7, n<=64 word-limited;
# for larger n use a list-of-words bitset)
```

#### Go / Java
```text
// Time greedy (Task 2), indexedGreedy (Task 9), and bitsetGreedy (Task 7) on a large
// random feasible instance. Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: indexed ~ near-linear total work; naive scales with rounds*m; bitset fastest
// for moderate n. All three yield the same cover size under the same tie-break.
```

**Evaluation criteria.**
- Correctness: all three produce the same cover *size*; greedy size ≤ `H(n)·OPT` on small checkable instances.
- Performance: report wall-clock for each method; explain why the inverted index avoids rescanning every set.
- Discussion: when does the bitset version win (moderate `n`)? When does the inverted index win (huge sparse `n`)?
</content>

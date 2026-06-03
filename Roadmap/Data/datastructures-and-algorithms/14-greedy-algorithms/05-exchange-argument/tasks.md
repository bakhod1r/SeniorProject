# Exchange Argument — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task asks you to **prove or disprove** a greedy strategy and ships a **code verifier** (greedy vs brute-force oracle) so the claim is machine-checked.
> Build a generic brute-force oracle early — it is your ground truth on small inputs. Golden rule: *disprove first* (one oracle mismatch is a complete disproof), only then attempt the exchange proof.

---

## Beginner Tasks (5)

### Task 1 — Activity selection: prove earliest-finish greedy is optimal

**Problem.** Given activities `(start, finish)`, select the maximum number that are pairwise non-overlapping. Prove (exchange) that "earliest finish first" is optimal, and verify against a brute-force oracle.

**Constraints.** `1 ≤ n ≤ 12` for the oracle. Compatible means `[s_i, f_i)` disjoint.

**Hint.** Exchange: replace any optimum's earliest finisher with the globally earliest finisher — compatibility and count are preserved. Verifier compares greedy count to the max over all subsets.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func greedy(iv [][2]int) int {
	s := append([][2]int(nil), iv...)
	sort.Slice(s, func(i, j int) bool { return s[i][1] < s[j][1] })
	count, last := 0, -1<<30
	for _, x := range s {
		if x[0] >= last {
			count++
			last = x[1]
		}
	}
	return count
}

func brute(iv [][2]int) int {
	best, n := 0, len(iv)
	for mask := 0; mask < (1 << n); mask++ {
		var sel [][2]int
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				sel = append(sel, iv[i])
			}
		}
		sort.Slice(sel, func(i, j int) bool { return sel[i][1] < sel[j][1] })
		ok := true
		for i := 1; i < len(sel); i++ {
			if sel[i][0] < sel[i-1][1] {
				ok = false
				break
			}
		}
		if ok && len(sel) > best {
			best = len(sel)
		}
	}
	return best
}

func main() {
	iv := [][2]int{{1, 3}, {2, 5}, {4, 7}, {1, 8}, {5, 9}, {8, 10}}
	fmt.Println("greedy:", greedy(iv), "brute:", brute(iv), "match:", greedy(iv) == brute(iv))
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    static int greedy(int[][] iv) {
        int[][] s = Arrays.stream(iv).map(int[]::clone).toArray(int[][]::new);
        Arrays.sort(s, Comparator.comparingInt(a -> a[1]));
        int count = 0, last = Integer.MIN_VALUE;
        for (int[] x : s) if (x[0] >= last) { count++; last = x[1]; }
        return count;
    }
    static int brute(int[][] iv) {
        int best = 0, n = iv.length;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<int[]> sel = new ArrayList<>();
            for (int i = 0; i < n; i++) if ((mask & (1 << i)) != 0) sel.add(iv[i]);
            sel.sort(Comparator.comparingInt(a -> a[1]));
            boolean ok = true;
            for (int i = 1; i < sel.size(); i++)
                if (sel.get(i)[0] < sel.get(i - 1)[1]) { ok = false; break; }
            if (ok) best = Math.max(best, sel.size());
        }
        return best;
    }
    public static void main(String[] args) {
        int[][] iv = {{1,3},{2,5},{4,7},{1,8},{5,9},{8,10}};
        System.out.println("greedy: " + greedy(iv) + " brute: " + brute(iv) +
            " match: " + (greedy(iv) == brute(iv)));
    }
}
```

#### Python
```python
from itertools import combinations


def greedy(iv):
    count, last = 0, float("-inf")
    for s, f in sorted(iv, key=lambda x: x[1]):
        if s >= last:
            count += 1
            last = f
    return count


def brute(iv):
    best = 0
    for k in range(len(iv) + 1):
        for sel in combinations(iv, k):
            ss = sorted(sel, key=lambda x: x[1])
            if all(ss[i][0] >= ss[i - 1][1] for i in range(1, len(ss))):
                best = max(best, len(ss))
    return best


iv = [(1, 3), (2, 5), (4, 7), (1, 8), (5, 9), (8, 10)]
print("greedy:", greedy(iv), "brute:", brute(iv), "match:", greedy(iv) == brute(iv))
```

---

### Task 2 — Coin change: disprove "largest coin first"

**Problem.** Show that greedy "take the largest coin ≤ remaining" is *not* optimal for general denominations. Find the smallest counterexample by comparing greedy to a DP oracle.

**Constraints.** Denominations include `1`; `1 ≤ V ≤ 100`.

**Hint.** Scan amounts `V = 1, 2, …` for coin set `{1, 3, 4}` and report the first where greedy uses more coins than DP. Expected: `V = 6` (greedy 3, optimal 2).

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func greedy(coins []int, V int) int {
	c := append([]int(nil), coins...)
	sort.Sort(sort.Reverse(sort.IntSlice(c)))
	cnt := 0
	for _, x := range c {
		cnt += V / x
		V %= x
	}
	return cnt
}

func optimal(coins []int, V int) int {
	const INF = 1 << 30
	dp := make([]int, V+1)
	for i := 1; i <= V; i++ {
		dp[i] = INF
		for _, c := range coins {
			if c <= i && dp[i-c]+1 < dp[i] {
				dp[i] = dp[i-c] + 1
			}
		}
	}
	return dp[V]
}

func main() {
	coins := []int{1, 3, 4}
	for V := 1; V <= 20; V++ {
		if greedy(coins, V) != optimal(coins, V) {
			fmt.Printf("counterexample V=%d: greedy=%d optimal=%d\n", V, greedy(coins, V), optimal(coins, V))
			break
		}
	}
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static int greedy(int[] coins, int V) {
        Integer[] c = Arrays.stream(coins).boxed().toArray(Integer[]::new);
        Arrays.sort(c, Collections.reverseOrder());
        int cnt = 0;
        for (int x : c) { cnt += V / x; V %= x; }
        return cnt;
    }
    static int optimal(int[] coins, int V) {
        int INF = 1 << 30;
        int[] dp = new int[V + 1];
        for (int i = 1; i <= V; i++) {
            dp[i] = INF;
            for (int c : coins) if (c <= i) dp[i] = Math.min(dp[i], dp[i - c] + 1);
        }
        return dp[V];
    }
    public static void main(String[] args) {
        int[] coins = {1, 3, 4};
        for (int V = 1; V <= 20; V++)
            if (greedy(coins, V) != optimal(coins, V)) {
                System.out.printf("counterexample V=%d: greedy=%d optimal=%d%n",
                    V, greedy(coins, V), optimal(coins, V));
                break;
            }
    }
}
```

#### Python
```python
def greedy(coins, V):
    cnt = 0
    for c in sorted(coins, reverse=True):
        cnt += V // c
        V %= c
    return cnt


def optimal(coins, V):
    INF = float("inf")
    dp = [0] + [INF] * V
    for i in range(1, V + 1):
        for c in coins:
            if c <= i:
                dp[i] = min(dp[i], dp[i - c] + 1)
    return dp[V]


coins = [1, 3, 4]
for V in range(1, 21):
    if greedy(coins, V) != optimal(coins, V):
        print(f"counterexample V={V}: greedy={greedy(coins, V)} optimal={optimal(coins, V)}")
        break
```

---

### Task 3 — Minimize maximum lateness: prove EDF optimal

**Problem.** Prove (adjacency-swap exchange) that Earliest Deadline First minimizes the maximum lateness, and verify against a permutation oracle on random instances.

**Constraints.** `1 ≤ n ≤ 7` for the oracle.

**Hint.** Swap an adjacent inverted pair `(a before b, d_a > d_b)`; the later finisher becomes `a` with smaller lateness. Verifier: random instances, assert `edf == brute`.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

type Job struct{ t, d int }

func maxLate(o []Job) int {
	time, mx := 0, 0
	for _, j := range o {
		time += j.t
		if v := time - j.d; v > mx {
			mx = v
		}
	}
	return mx
}

func edf(jobs []Job) int {
	js := append([]Job(nil), jobs...)
	sort.Slice(js, func(i, j int) bool { return js[i].d < js[j].d })
	return maxLate(js)
}

func brute(jobs []Job) int {
	idx := make([]int, len(jobs))
	for i := range idx {
		idx[i] = i
	}
	best := 1 << 30
	var perm func(k int)
	perm = func(k int) {
		if k == len(idx) {
			o := make([]Job, len(idx))
			for i, id := range idx {
				o[i] = jobs[id]
			}
			if v := maxLate(o); v < best {
				best = v
			}
			return
		}
		for i := k; i < len(idx); i++ {
			idx[k], idx[i] = idx[i], idx[k]
			perm(k + 1)
			idx[k], idx[i] = idx[i], idx[k]
		}
	}
	perm(0)
	return best
}

func main() {
	r := rand.New(rand.NewSource(7))
	ok := true
	for i := 0; i < 3000; i++ {
		n := 2 + r.Intn(5)
		jobs := make([]Job, n)
		for j := range jobs {
			jobs[j] = Job{1 + r.Intn(5), 1 + r.Intn(10)}
		}
		if edf(jobs) != brute(jobs) {
			ok = false
		}
	}
	fmt.Println("EDF matches brute on all instances:", ok)
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    record Job(int t, int d) {}
    static int maxLate(List<Job> o) {
        int time = 0, mx = 0;
        for (Job j : o) { time += j.t(); mx = Math.max(mx, time - j.d()); }
        return mx;
    }
    static int edf(List<Job> jobs) {
        List<Job> js = new ArrayList<>(jobs);
        js.sort(Comparator.comparingInt(Job::d));
        return maxLate(js);
    }
    static int best;
    static int brute(List<Job> jobs) {
        best = Integer.MAX_VALUE;
        permute(jobs, new boolean[jobs.size()], new ArrayList<>());
        return best;
    }
    static void permute(List<Job> jobs, boolean[] used, List<Job> cur) {
        if (cur.size() == jobs.size()) { best = Math.min(best, maxLate(cur)); return; }
        for (int i = 0; i < jobs.size(); i++) {
            if (used[i]) continue;
            used[i] = true; cur.add(jobs.get(i));
            permute(jobs, used, cur);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }
    public static void main(String[] args) {
        Random r = new Random(7);
        boolean ok = true;
        for (int it = 0; it < 3000; it++) {
            int n = 2 + r.nextInt(5);
            List<Job> jobs = new ArrayList<>();
            for (int j = 0; j < n; j++) jobs.add(new Job(1 + r.nextInt(5), 1 + r.nextInt(10)));
            if (edf(jobs) != brute(jobs)) ok = false;
        }
        System.out.println("EDF matches brute on all instances: " + ok);
    }
}
```

#### Python
```python
import random
from itertools import permutations


def max_late(order):
    time = mx = 0
    for t, d in order:
        time += t
        mx = max(mx, time - d)
    return mx


def edf(jobs):
    return max_late(sorted(jobs, key=lambda j: j[1]))


def brute(jobs):
    return min(max_late(o) for o in permutations(jobs))


rng = random.Random(7)
ok = True
for _ in range(3000):
    n = rng.randint(2, 6)
    jobs = [(rng.randint(1, 5), rng.randint(1, 10)) for _ in range(n)]
    if edf(jobs) != brute(jobs):
        ok = False
print("EDF matches brute on all instances:", ok)
```

---

### Task 4 — Fractional knapsack: prove ratio greedy optimal

**Problem.** Prove (`ε`-transfer exchange) that filling by value/weight ratio is optimal for the *fractional* knapsack, and verify against an exact oracle on small inputs.

**Constraints.** `1 ≤ n ≤ 10`; use exact rationals to avoid float error.

**Hint.** The oracle: the fractional optimum *is* the ratio-greedy value (it is provably optimal), so verify greedy equals a second independent computation (e.g., LP-style fill in a different item order then take best — or just assert greedy is monotone and fills capacity). Use `Fraction`.

#### Go
```go
package main

import (
	"fmt"
	"math/big"
	"sort"
)

// fractional greedy using exact rationals; returns value as big.Rat.
func greedy(W int, vw [][2]int) *big.Rat {
	idx := make([]int, len(vw))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool {
		// ratio desc via cross multiply: v_a*w_b > v_b*w_a
		return vw[idx[a]][0]*vw[idx[b]][1] > vw[idx[b]][0]*vw[idx[a]][1]
	})
	cap := big.NewRat(int64(W), 1)
	val := big.NewRat(0, 1)
	for _, i := range idx {
		w := big.NewRat(int64(vw[i][1]), 1)
		ratio := big.NewRat(int64(vw[i][0]), int64(vw[i][1]))
		take := new(big.Rat)
		if w.Cmp(cap) <= 0 {
			take.Set(w)
		} else {
			take.Set(cap)
		}
		val.Add(val, new(big.Rat).Mul(ratio, take))
		cap.Sub(cap, take)
		if cap.Sign() == 0 {
			break
		}
	}
	return val
}

func main() {
	items := [][2]int{{60, 10}, {100, 20}, {120, 30}}
	fmt.Println("fractional greedy value (W=50):", greedy(50, items).FloatString(0)) // 240
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    // exact via long numerator over common denom; here use double-free cross compare,
    // accumulate value as a fraction num/den.
    static long[] greedy(int W, int[][] vw) { // returns {num, den}
        Integer[] idx = new Integer[vw.length];
        for (int i = 0; i < vw.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) ->
            Long.compare((long) vw[b][0] * vw[a][1], (long) vw[a][0] * vw[b][1]));
        long num = 0, den = 1, cap = W; // value = num/den, capacity integral
        for (int i : idx) {
            int v = vw[i][0], w = vw[i][1];
            long take = Math.min(w, cap);
            // add v/w * take = v*take / w
            long n2 = v * take, d2 = w;
            num = num * d2 + n2 * den; den = den * d2;
            long g = gcd(Math.abs(num), den); num /= g; den /= g;
            cap -= take;
            if (cap == 0) break;
        }
        return new long[]{num, den};
    }
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }
    public static void main(String[] args) {
        int[][] items = {{60,10},{100,20},{120,30}};
        long[] r = greedy(50, items);
        System.out.println("fractional greedy value (W=50): " + r[0] / r[1]); // 240
    }
}
```

#### Python
```python
from fractions import Fraction


def greedy(W, items):  # items: (value, weight)
    cap, val = W, Fraction(0)
    for v, w in sorted(items, key=lambda it: Fraction(it[0], it[1]), reverse=True):
        take = min(w, cap)
        val += Fraction(v, w) * take
        cap -= take
        if cap == 0:
            break
    return val


print("fractional greedy value (W=50):", greedy(50, [(60, 10), (100, 20), (120, 30)]))  # 240
```

---

### Task 5 — 0/1 knapsack: disprove ratio greedy

**Problem.** Show that ratio greedy is *not* optimal for the 0/1 knapsack. Find a counterexample by comparing greedy to a brute-force subset oracle.

**Constraints.** `2 ≤ n ≤ 8`.

**Hint.** Capacity `5`, items `{(6,4),(5,3),(5,2)}` (value, weight): greedy by ratio picks `(6,4)` for value 6; optimum `(5,3)+(5,2)` = value 10. Verifier reports the gap.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func greedy(W int, vw [][2]int) int {
	idx := make([]int, len(vw))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool {
		return vw[idx[a]][0]*vw[idx[b]][1] > vw[idx[b]][0]*vw[idx[a]][1]
	})
	cap, val := W, 0
	for _, i := range idx {
		if vw[i][1] <= cap {
			cap -= vw[i][1]
			val += vw[i][0]
		}
	}
	return val
}

func brute(W int, vw [][2]int) int {
	best, n := 0, len(vw)
	for mask := 0; mask < (1 << n); mask++ {
		w, v := 0, 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				w += vw[i][1]
				v += vw[i][0]
			}
		}
		if w <= W && v > best {
			best = v
		}
	}
	return best
}

func main() {
	W := 5
	items := [][2]int{{6, 4}, {5, 3}, {5, 2}}
	fmt.Printf("greedy=%d optimal=%d  -> greedy optimal? %v\n",
		greedy(W, items), brute(W, items), greedy(W, items) == brute(W, items))
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static int greedy(int W, int[][] vw) {
        Integer[] idx = new Integer[vw.length];
        for (int i = 0; i < vw.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) ->
            Long.compare((long) vw[b][0] * vw[a][1], (long) vw[a][0] * vw[b][1]));
        int cap = W, val = 0;
        for (int i : idx) if (vw[i][1] <= cap) { cap -= vw[i][1]; val += vw[i][0]; }
        return val;
    }
    static int brute(int W, int[][] vw) {
        int best = 0, n = vw.length;
        for (int mask = 0; mask < (1 << n); mask++) {
            int w = 0, v = 0;
            for (int i = 0; i < n; i++) if ((mask & (1 << i)) != 0) { w += vw[i][1]; v += vw[i][0]; }
            if (w <= W) best = Math.max(best, v);
        }
        return best;
    }
    public static void main(String[] args) {
        int W = 5;
        int[][] items = {{6,4},{5,3},{5,2}};
        System.out.printf("greedy=%d optimal=%d -> greedy optimal? %b%n",
            greedy(W, items), brute(W, items), greedy(W, items) == brute(W, items));
    }
}
```

#### Python
```python
def greedy(W, items):
    cap, val = W, 0
    for v, w in sorted(items, key=lambda it: it[0] / it[1], reverse=True):
        if w <= cap:
            cap -= w
            val += v
    return val


def brute(W, items):
    best, n = 0, len(items)
    for mask in range(1 << n):
        w = sum(items[i][1] for i in range(n) if mask & (1 << i))
        v = sum(items[i][0] for i in range(n) if mask & (1 << i))
        if w <= W:
            best = max(best, v)
    return best


W, items = 5, [(6, 4), (5, 3), (5, 2)]
print(f"greedy={greedy(W, items)} optimal={brute(W, items)} "
      f"-> greedy optimal? {greedy(W, items) == brute(W, items)}")
```

---

## Intermediate Tasks (5)

### Task 6 — Smith's rule: prove minimize Σ wⱼCⱼ optimal

**Problem.** Prove (adjacency swap) that sequencing by `pⱼ/wⱼ` ascending minimizes total weighted completion time, and verify against a permutation oracle.

**Constraints.** `1 ≤ n ≤ 7`.

**Hint.** Swapping adjacent inverted pair changes cost by `w_b·pₐ − wₐ·p_b > 0`. Verifier: random `(p, w)` jobs, assert greedy == brute.

#### Python
```python
import random
from itertools import permutations


def total_weighted_completion(order):
    t = 0
    s = 0
    for p, w in order:
        t += p
        s += w * t
    return s


def smith(jobs):
    return total_weighted_completion(sorted(jobs, key=lambda j: j[0] / j[1]))


def brute(jobs):
    return min(total_weighted_completion(o) for o in permutations(jobs))


rng = random.Random(3)
ok = all(
    smith(j) == brute(j)
    for j in ([(rng.randint(1, 6), rng.randint(1, 6)) for _ in range(rng.randint(2, 6))]
              for _ in range(3000))
)
print("Smith's rule optimal on all instances:", ok)
```

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

type Job struct{ p, w int }

func cost(o []Job) int {
	t, s := 0, 0
	for _, j := range o {
		t += j.p
		s += j.w * t
	}
	return s
}

func smith(jobs []Job) int {
	js := append([]Job(nil), jobs...)
	sort.Slice(js, func(i, j int) bool { return js[i].p*js[j].w < js[j].p*js[i].w })
	return cost(js)
}

func brute(jobs []Job) int {
	idx := make([]int, len(jobs))
	for i := range idx {
		idx[i] = i
	}
	best := 1 << 30
	var perm func(k int)
	perm = func(k int) {
		if k == len(idx) {
			o := make([]Job, len(idx))
			for i, id := range idx {
				o[i] = jobs[id]
			}
			if c := cost(o); c < best {
				best = c
			}
			return
		}
		for i := k; i < len(idx); i++ {
			idx[k], idx[i] = idx[i], idx[k]
			perm(k + 1)
			idx[k], idx[i] = idx[i], idx[k]
		}
	}
	perm(0)
	return best
}

func main() {
	r := rand.New(rand.NewSource(3))
	ok := true
	for i := 0; i < 3000; i++ {
		n := 2 + r.Intn(5)
		jobs := make([]Job, n)
		for j := range jobs {
			jobs[j] = Job{1 + r.Intn(6), 1 + r.Intn(6)}
		}
		if smith(jobs) != brute(jobs) {
			ok = false
		}
	}
	fmt.Println("Smith's rule optimal on all instances:", ok)
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    record Job(int p, int w) {}
    static int cost(List<Job> o) {
        int t = 0, s = 0;
        for (Job j : o) { t += j.p(); s += j.w() * t; }
        return s;
    }
    static int smith(List<Job> jobs) {
        List<Job> js = new ArrayList<>(jobs);
        js.sort((a, b) -> a.p() * b.w() - b.p() * a.w());
        return cost(js);
    }
    static int best;
    static int brute(List<Job> jobs) {
        best = Integer.MAX_VALUE;
        permute(jobs, new boolean[jobs.size()], new ArrayList<>());
        return best;
    }
    static void permute(List<Job> jobs, boolean[] used, List<Job> cur) {
        if (cur.size() == jobs.size()) { best = Math.min(best, cost(cur)); return; }
        for (int i = 0; i < jobs.size(); i++) {
            if (used[i]) continue;
            used[i] = true; cur.add(jobs.get(i));
            permute(jobs, used, cur);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }
    public static void main(String[] args) {
        Random r = new Random(3);
        boolean ok = true;
        for (int it = 0; it < 3000; it++) {
            int n = 2 + r.nextInt(5);
            List<Job> jobs = new ArrayList<>();
            for (int j = 0; j < n; j++) jobs.add(new Job(1 + r.nextInt(6), 1 + r.nextInt(6)));
            if (smith(jobs) != brute(jobs)) ok = false;
        }
        System.out.println("Smith's rule optimal on all instances: " + ok);
    }
}
```

---

### Task 7 — Disprove "longest activity first" for activity selection

**Problem.** Show that selecting by *longest* duration (or by earliest start) is not optimal for maximizing the count of compatible activities. Find a counterexample with the oracle.

**Constraints.** `2 ≤ n ≤ 10`.

**Hint.** Reuse Task 1's brute oracle. Try greedy-by-earliest-start: `{(0,10),(1,2),(3,4)}` — earliest start picks `(0,10)` (count 1) but `(1,2),(3,4)` gives 2.

#### Python
```python
from itertools import combinations


def greedy_earliest_start(iv):
    count, last = 0, float("-inf")
    for s, f in sorted(iv, key=lambda x: x[0]):  # WRONG key
        if s >= last:
            count += 1
            last = f
    return count


def brute(iv):
    best = 0
    for k in range(len(iv) + 1):
        for sel in combinations(iv, k):
            ss = sorted(sel, key=lambda x: x[1])
            if all(ss[i][0] >= ss[i - 1][1] for i in range(1, len(ss))):
                best = max(best, len(ss))
    return best


iv = [(0, 10), (1, 2), (3, 4)]
print(f"earliest-start greedy={greedy_earliest_start(iv)} optimal={brute(iv)} "
      f"-> optimal? {greedy_earliest_start(iv) == brute(iv)}")
```

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func greedyEarliestStart(iv [][2]int) int {
	s := append([][2]int(nil), iv...)
	sort.Slice(s, func(i, j int) bool { return s[i][0] < s[j][0] }) // WRONG key
	count, last := 0, -1<<30
	for _, x := range s {
		if x[0] >= last {
			count++
			last = x[1]
		}
	}
	return count
}

// brute as in Task 1
func brute(iv [][2]int) int {
	best, n := 0, len(iv)
	for mask := 0; mask < (1 << n); mask++ {
		var sel [][2]int
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				sel = append(sel, iv[i])
			}
		}
		sort.Slice(sel, func(i, j int) bool { return sel[i][1] < sel[j][1] })
		ok := true
		for i := 1; i < len(sel); i++ {
			if sel[i][0] < sel[i-1][1] {
				ok = false
				break
			}
		}
		if ok && len(sel) > best {
			best = len(sel)
		}
	}
	return best
}

func main() {
	iv := [][2]int{{0, 10}, {1, 2}, {3, 4}}
	fmt.Printf("earliest-start greedy=%d optimal=%d -> optimal? %v\n",
		greedyEarliestStart(iv), brute(iv), greedyEarliestStart(iv) == brute(iv))
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    static int greedyEarliestStart(int[][] iv) {
        int[][] s = Arrays.stream(iv).map(int[]::clone).toArray(int[][]::new);
        Arrays.sort(s, Comparator.comparingInt(a -> a[0])); // WRONG key
        int count = 0, last = Integer.MIN_VALUE;
        for (int[] x : s) if (x[0] >= last) { count++; last = x[1]; }
        return count;
    }
    static int brute(int[][] iv) {
        int best = 0, n = iv.length;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<int[]> sel = new ArrayList<>();
            for (int i = 0; i < n; i++) if ((mask & (1 << i)) != 0) sel.add(iv[i]);
            sel.sort(Comparator.comparingInt(a -> a[1]));
            boolean ok = true;
            for (int i = 1; i < sel.size(); i++)
                if (sel.get(i)[0] < sel.get(i - 1)[1]) { ok = false; break; }
            if (ok) best = Math.max(best, sel.size());
        }
        return best;
    }
    public static void main(String[] args) {
        int[][] iv = {{0,10},{1,2},{3,4}};
        System.out.printf("earliest-start greedy=%d optimal=%d -> optimal? %b%n",
            greedyEarliestStart(iv), brute(iv), greedyEarliestStart(iv) == brute(iv));
    }
}
```

---

### Task 8 — Greedy stays ahead: verify the interval-scheduling invariant

**Problem.** For interval scheduling, *empirically verify* the stays-ahead invariant: greedy's `k`-th chosen interval finishes no later than any optimal selection's `k`-th. Test on random instances.

**Constraints.** `1 ≤ n ≤ 10`.

**Hint.** Compute greedy's finish sequence and brute-force the *lexicographically-earliest-finishes* optimal selection; assert `f(g_k) ≤ f(o_k)` for all `k`.

#### Python
```python
import random
from itertools import combinations


def greedy_seq(iv):
    seq, last = [], float("-inf")
    for s, f in sorted(iv, key=lambda x: x[1]):
        if s >= last:
            seq.append(f)
            last = f
    return seq


def best_opt_finishes(iv):
    best = []
    for k in range(len(iv) + 1):
        for sel in combinations(iv, k):
            ss = sorted(sel, key=lambda x: x[1])
            if all(ss[i][0] >= ss[i - 1][1] for i in range(1, len(ss))):
                fin = [f for _, f in ss]
                if len(fin) > len(best) or (len(fin) == len(best) and fin < best):
                    best = fin
    return best


rng = random.Random(11)
ok = True
for _ in range(2000):
    n = rng.randint(1, 7)
    iv = []
    for _ in range(n):
        s = rng.randint(0, 8)
        iv.append((s, s + rng.randint(1, 5)))
    g, o = greedy_seq(iv), best_opt_finishes(iv)
    # stays-ahead: greedy never finishes later at each rank, and count is optimal
    if len(g) != len(o) or any(g[k] > o[k] for k in range(len(g))):
        ok = False
print("stays-ahead invariant holds on all instances:", ok)
```

#### Go / Java
```text
// Mirror the Python: compute greedy's finish sequence and the optimal selection with
// lexicographically smallest finish times; assert len equal and g[k] <= o[k] for all k.
// This is the runnable form of the 'greedy stays ahead' inductive claim.
```

---

### Task 9 — Disprove a greedy for the 0/1 "minimize number of platforms" variant

**Problem.** For "assign trains to minimum platforms" (interval partitioning), the correct greedy is "sort by start, reuse a freed platform else open new." Show that a *wrong* greedy ("sort by duration, longest first") can use more platforms; verify with an exact oracle.

**Constraints.** `2 ≤ n ≤ 9`.

**Hint.** Correct answer = max number of intervals overlapping any point. Oracle computes that via a sweep. Compare a duration-sorted greedy that may misassign.

#### Python
```python
def min_platforms_sweep(iv):  # exact: max overlap
    events = []
    for s, f in iv:
        events.append((s, 1))
        events.append((f, -1))
    events.sort(key=lambda e: (e[0], e[1]))  # end (-1) before start (+1) at a tie
    cur = best = 0
    for _, delta in events:
        cur += delta
        best = max(best, cur)
    return best


def greedy_longest_first(iv):  # WRONG: assign longest-first to first free platform
    platforms = []  # list of current end times
    for s, f in sorted(iv, key=lambda x: -(x[1] - x[0])):
        placed = False
        for i in range(len(platforms)):
            if platforms[i] <= s:
                platforms[i] = f
                placed = True
                break
        if not placed:
            platforms.append(f)
    return len(platforms)


iv = [(0, 5), (1, 2), (3, 4), (2, 6)]
print("exact:", min_platforms_sweep(iv), "longest-first greedy:", greedy_longest_first(iv),
      "-> greedy optimal?", min_platforms_sweep(iv) == greedy_longest_first(iv))
```

#### Go / Java
```text
// Implement the exact max-overlap sweep (events: +1 at start, -1 at end, ties end-first)
// and the longest-first assignment greedy. Print both counts and whether they match.
// Find an instance where longest-first opens an extra platform.
```

---

### Task 10 — Prove MST cut property via exchange (Kruskal verifier)

**Problem.** Prove (cut/cycle exchange) that Kruskal's algorithm yields a minimum spanning tree, and verify against a brute-force oracle that tries all spanning trees on small graphs.

**Constraints.** `n ≤ 6`, `m ≤ 10`.

**Hint.** Exchange: in any MST, swapping a tree edge on the cycle created by adding the lightest cross-cut edge cannot increase weight. Oracle: enumerate `(n−1)`-edge subsets, keep spanning trees, take min weight.

#### Python
```python
from itertools import combinations


def kruskal(n, edges):  # edges: (w, u, v)
    par = list(range(n))
    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    total, used = 0, 0
    for w, u, v in sorted(edges):
        ru, rv = find(u), find(v)
        if ru != rv:
            par[ru] = rv
            total += w
            used += 1
    return total if used == n - 1 else None


def brute_mst(n, edges):
    best = None
    for comb in combinations(edges, n - 1):
        par = list(range(n))
        def find(x):
            while par[x] != x:
                par[x] = par[par[x]]
                x = par[x]
            return x
        ok, total = True, 0
        for w, u, v in comb:
            ru, rv = find(u), find(v)
            if ru == rv:
                ok = False
                break
            par[ru] = rv
            total += w
        if ok and (best is None or total < best):
            best = total
    return best


edges = [(1, 0, 1), (3, 1, 2), (2, 0, 2), (4, 2, 3), (5, 1, 3)]
print("kruskal:", kruskal(4, edges), "brute:", brute_mst(4, edges),
      "match:", kruskal(4, edges) == brute_mst(4, edges))
```

#### Go / Java
```text
// Implement Kruskal with union-find and a brute oracle enumerating (n-1)-edge subsets,
// keeping only spanning trees (no cycle) and taking the minimum total weight.
// Verify kruskal == brute on small graphs. (See sibling 11-graphs/10-mst-kruskal-prim.)
```

---

## Advanced Tasks (5)

### Task 11 — Matroid axiom checker: classify a feasibility family

**Problem.** Given an independence oracle over a small ground set, empirically decide whether it is a matroid (check the three axioms), and confirm: greedy is optimal for *all* weightings iff the family is a matroid.

**Constraints.** Ground set size `n ≤ 5` (so `2ⁿ` subsets is tiny).

**Hint.** Check `∅` independent, hereditary, and the exchange axiom. Then fuzz random weights and assert `matroid_greedy == brute_optimal` iff the axioms hold.

#### Python
```python
from itertools import product


def popcount(x):
    return bin(x).count("1")


def is_matroid(n, ind):
    if not ind(0):
        return False
    for a in range(1 << n):
        if not ind(a):
            continue
        b = a
        while True:  # hereditary
            if not ind(b):
                return False
            if b == 0:
                break
            b = (b - 1) & a
    for a in range(1 << n):
        if not ind(a):
            continue
        for b in range(1 << n):
            if not ind(b) or popcount(b) <= popcount(a):
                continue
            if not any((b >> e) & 1 and not (a >> e) & 1 and ind(a | (1 << e)) for e in range(n)):
                return False
    return True


def greedy(n, w, ind):
    mask, tot = 0, 0
    for e in sorted(range(n), key=lambda i: w[i], reverse=True):
        if ind(mask | (1 << e)):
            mask |= 1 << e
            tot += w[e]
    return tot


def brute(n, w, ind):
    return max((sum(w[e] for e in range(n) if m & (1 << e)))
               for m in range(1 << n) if ind(m))


n = 4
uniform = lambda m: popcount(m) <= 2          # matroid
allowed = {0, 1, 2, 0b1100}
not_mat = lambda m: m in allowed              # not a matroid
for name, ind in [("uniform", uniform), ("non-matroid", not_mat)]:
    m = is_matroid(n, ind)
    greedy_always = all(greedy(n, list(w), ind) == brute(n, list(w), ind)
                        for w in product(range(1, 5), repeat=n))
    print(f"{name}: matroid={m}, greedy-optimal-for-all-weights={greedy_always}, agree={m == greedy_always}")
```

#### Go / Java
```text
// Port the three-axiom checker and the greedy/brute optimum from senior.md.
// Fuzz all weight vectors in {1..4}^n; assert greedy==brute for EVERY weight iff is_matroid.
// This is the runnable Rado-Edmonds 'iff'.
```

---

### Task 12 — Construct a weight that breaks greedy on a non-matroid

**Problem.** Given a non-matroid feasibility family (where the exchange axiom fails for some `A, B`), *construct* a weight function on which greedy is strictly suboptimal, and verify the gap.

**Constraints.** `n ≤ 5`.

**Hint.** Find a witness `(A, B)` with `|A| < |B|` and no extension of `A` from `B`. Weight `A` slightly higher so greedy commits to `A` and gets stuck; the optimum takes `B`.

#### Python
```python
def popcount(x):
    return bin(x).count("1")


def find_witness(n, ind):
    for a in range(1 << n):
        if not ind(a):
            continue
        for b in range(1 << n):
            if not ind(b) or popcount(b) <= popcount(a):
                continue
            if not any((b >> e) & 1 and not (a >> e) & 1 and ind(a | (1 << e)) for e in range(n)):
                return a, b
    return None


def greedy(n, w, ind):
    mask, tot = 0, 0
    for e in sorted(range(n), key=lambda i: w[i], reverse=True):
        if ind(mask | (1 << e)):
            mask |= 1 << e
            tot += w[e]
    return tot


def brute(n, w, ind):
    return max((sum(w[e] for e in range(n) if m & (1 << e)))
               for m in range(1 << n) if ind(m))


n = 4
allowed = {0, 1, 2, 0b1100}
ind = lambda m: m in allowed
a, b = find_witness(n, ind)
# weight A's elements high, B\A elements slightly lower, rest 0
w = [0] * n
for e in range(n):
    if (a >> e) & 1:
        w[e] = 10
    elif (b >> e) & 1:
        w[e] = 9
print("witness A,B:", bin(a), bin(b), "weights:", w)
print("greedy:", greedy(n, w, ind), "optimal:", brute(n, w, ind),
      "-> greedy suboptimal?", greedy(n, w, ind) < brute(n, w, ind))
```

#### Go / Java
```text
// Find the (A,B) exchange-axiom witness, weight A high and B\A slightly lower, rest 0.
// Verify greedy < optimal, demonstrating the 'only if' direction of Rado-Edmonds constructively.
```

---

### Task 13 — Prove deadline scheduling for max profit (job sequencing) by exchange

**Problem.** `n` jobs, each with deadline `dⱼ` and profit `pⱼ`, unit time each, one machine. Schedule a subset to maximize total profit such that each runs by its deadline. Prove the greedy (sort by profit descending, place each in the latest free slot `≤ dⱼ`) is optimal; verify against a subset oracle.

**Constraints.** `n ≤ 12` for the oracle.

**Hint.** This is a *partition/transversal matroid* (schedulable subsets are independent). By Rado–Edmonds, profit-descending greedy is optimal. Oracle: try all subsets, check feasibility by a deadline-sorted assignment.

#### Python
```python
from itertools import combinations


def greedy(jobs):  # jobs: (deadline, profit)
    jobs = sorted(jobs, key=lambda j: -j[1])
    maxd = max((d for d, _ in jobs), default=0)
    slot = [False] * (maxd + 1)
    profit = 0
    for d, p in jobs:
        t = min(d, maxd)
        while t >= 1 and slot[t]:
            t -= 1
        if t >= 1:
            slot[t] = True
            profit += p
    return profit


def feasible(subset):  # can all run by deadline? (unit jobs)
    s = sorted(subset, key=lambda j: j[0])
    for i, (d, _) in enumerate(s, start=1):
        if d < i:
            return False
    return True


def brute(jobs):
    best = 0
    for k in range(len(jobs) + 1):
        for sub in combinations(jobs, k):
            if feasible(sub):
                best = max(best, sum(p for _, p in sub))
    return best


jobs = [(2, 100), (1, 19), (2, 27), (1, 25), (3, 15)]
print("greedy:", greedy(jobs), "brute:", brute(jobs), "match:", greedy(jobs) == brute(jobs))
```

#### Go / Java
```text
// Implement profit-descending slot-assignment greedy and a subset oracle that checks
// feasibility (deadline-sorted; job i must have deadline >= i). Verify greedy == brute.
// Note: schedulable subsets form a transversal matroid -> greedy optimal (Rado-Edmonds).
```

---

### Task 14 — Disprove a greedy for set cover; prove the H_n approximation instead

**Problem.** Show greedy set cover (pick the set covering the most uncovered elements) is *not* always optimal, but verify it is within a factor `H_n = 1 + 1/2 + … + 1/n` of optimal on small instances.

**Constraints.** universe size `≤ 12`, `≤ 8` sets.

**Hint.** Construct the classic instance where greedy uses `≈ log n` sets vs 2 optimal. Oracle: brute-force minimum cover by subset enumeration; assert `greedy_size ≤ H_universe · opt_size`.

#### Python
```python
from itertools import combinations
from math import isclose


def greedy_cover(universe, sets):
    uncovered = set(universe)
    chosen = 0
    sets = [set(s) for s in sets]
    while uncovered:
        best = max(sets, key=lambda s: len(s & uncovered))
        if not (best & uncovered):
            return None  # cannot cover
        uncovered -= best
        chosen += 1
    return chosen


def brute_cover(universe, sets):
    u = set(universe)
    for k in range(1, len(sets) + 1):
        for comb in combinations(range(len(sets)), k):
            if set().union(*(set(sets[i]) for i in comb)) >= u:
                return k
    return None


universe = list(range(6))
sets = [[0, 1, 2], [3, 4, 5], [0, 3], [1, 4], [2, 5]]
g, o = greedy_cover(universe, sets), brute_cover(universe, sets)
Hn = sum(1 / i for i in range(1, len(universe) + 1))
print(f"greedy={g} optimal={o} Hn={Hn:.2f} within-bound={g <= Hn * o}")
```

#### Go / Java
```text
// Implement greedy max-coverage and a brute minimum-cover oracle.
// Assert greedy_size <= H_n * optimal_size on random small instances.
// This proves an APPROXIMATION ratio, not exact optimality -- the right tool when greedy
// is not optimal. See sibling 07-set-cover-approximation.
```

---

### Task 15 — Exchange-argument fuzzer: auto-find counterexamples for arbitrary greedy keys

**Problem.** Build a generic fuzzer: given a problem (brute oracle + a parameterized greedy that sorts by a chosen key), search random small inputs to *automatically discover* whether the greedy key is optimal, returning the minimized counterexample if not.

**Constraints.** Keep inputs tiny (`n ≤ 7`). Test several keys for "minimize max lateness" (deadline — correct; processing time — wrong; slack `d−t` — check).

**Hint.** Loop over random instances; on the first mismatch, greedily remove jobs while the mismatch persists to minimize it. Report key + minimized instance.

#### Python
```python
import random
from itertools import permutations


def max_late(order):
    t = mx = 0
    for p, d in order:
        t += p
        mx = max(mx, t - d)
    return mx


def greedy_by(key):
    return lambda jobs: max_late(sorted(jobs, key=key))


def brute(jobs):
    return min(max_late(o) for o in permutations(jobs))


def minimize(inst, g):
    changed = True
    while changed and len(inst) > 1:
        changed = False
        for i in range(len(inst)):
            smaller = inst[:i] + inst[i + 1:]
            if g(smaller) != brute(smaller):
                inst = smaller
                changed = True
                break
    return inst


def fuzz(key, name, trials=4000):
    g = greedy_by(key)
    rng = random.Random(42)
    for _ in range(trials):
        n = rng.randint(2, 6)
        inst = [(rng.randint(1, 5), rng.randint(1, 10)) for _ in range(n)]
        if g(inst) != brute(inst):
            mini = minimize(inst, g)
            return f"{name}: NOT optimal, counterexample {mini} (greedy={g(mini)} opt={brute(mini)})"
    return f"{name}: no counterexample in {trials} trials (likely optimal)"


print(fuzz(lambda j: j[1], "by deadline (EDF)"))
print(fuzz(lambda j: j[0], "by processing time (SPT)"))
print(fuzz(lambda j: j[1] - j[0], "by slack (d - t)"))
```

#### Go / Java
```text
// Port the fuzzer: parameterize greedy by a key/comparator, brute-force the optimum,
// on first mismatch shrink the instance (delta-debug) while the mismatch persists.
// Run for keys: deadline (EDF, optimal), processing time (SPT, fails), slack (check).
// Output the minimized counterexample for the failing keys.
```

---

## Benchmark Task — Cost of verifying greedy correctness

**Problem.** For "minimize max lateness," measure how the brute-force oracle's runtime grows with `n` (it is `Θ(n!)`), and confirm the greedy itself is `Θ(n log n)`. Report the largest `n` at which exhaustive verification is practical (≈ 1 second).

**Expected findings.**
- Greedy runs in milliseconds even for large `n` (just a sort plus a sweep).
- The permutation oracle explodes: `n = 10` is `3.6M` permutations, `n = 12` is `479M` — verification is feasible only for tiny `n`.
- Random differential testing on `n ≤ 7` gives high confidence far cheaper than exhaustive enumeration.

#### Python
```python
import time
from itertools import permutations


def max_late(order):
    t = mx = 0
    for p, d in order:
        t += p
        mx = max(mx, t - d)
    return mx


def brute(jobs):
    return min(max_late(o) for o in permutations(jobs))


for n in range(6, 11):
    jobs = [(1 + i % 4, 2 + (i * 3) % 11) for i in range(n)]
    t0 = time.perf_counter()
    brute(jobs)
    dt = time.perf_counter() - t0
    print(f"n={n:2d}  brute oracle {dt*1000:8.1f} ms  ({n}! permutations)")
```

#### Go / Java
```text
// Time the permutation oracle for n = 6..11 (Go: time.Since; Java: System.nanoTime()).
// Observe factorial growth; the greedy EDF sort+sweep stays sub-millisecond.
// Conclusion: keep verification instances at n <= 7-8; rely on random differential testing.
```

**Evaluation criteria.**
- Correctness: greedy matches the oracle on every instance the oracle can handle.
- Performance: report wall-clock for the oracle per `n`; explain the factorial wall.
- Discussion: why is *random small-input* differential testing the practical verification strategy, and when do you instead lean on a structural (matroid) argument to avoid testing altogether?

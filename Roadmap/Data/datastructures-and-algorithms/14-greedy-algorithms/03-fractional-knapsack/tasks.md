# Fractional Knapsack — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a small brute-force / 0/1-DP checker early — it is your oracle. Known checks: `W=50,(60,10)(100,20)(120,30) → 240` fractional and `220` for 0/1; `W=10,(100,20) → 50`; `W ≥ Σw → Σv`.

---

## Beginner Tasks (5)

### Task 1 — Compute and print densities

**Problem.** Given items `(value, weight)`, compute each item's density `value/weight` and print them.

**Constraints.** `1 ≤ n ≤ 1000`, `value ≥ 0`, `weight > 0`.

**Hint.** Density is just `value / weight`. Use floating point.

#### Go
```go
package main

import "fmt"

func main() {
	items := [][2]float64{{60, 10}, {100, 20}, {120, 30}}
	for i, it := range items {
		fmt.Printf("item %d: density = %.2f\n", i, it[0]/it[1])
	}
}
```

#### Java
```java
public class Task1 {
    public static void main(String[] args) {
        double[][] items = {{60, 10}, {100, 20}, {120, 30}};
        for (int i = 0; i < items.length; i++)
            System.out.printf("item %d: density = %.2f%n", i, items[i][0] / items[i][1]);
    }
}
```

#### Python
```python
items = [(60, 10), (100, 20), (120, 30)]
for i, (v, w) in enumerate(items):
    print(f"item {i}: density = {v / w:.2f}")
```

---

### Task 2 — Maximum value (the core greedy)

**Problem.** Return the maximum value for capacity `W` when items may be split.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ W`, `weight > 0`. Print 4 decimals.

**Hint.** Sort by density descending, take whole while it fits, slice the one that does not, then `break`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func fractional(W float64, v, w []float64) float64 {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return v[idx[a]]/w[idx[a]] > v[idx[b]]/w[idx[b]] })
	rem, total := W, 0.0
	for _, i := range idx {
		if w[i] <= rem {
			total += v[i]
			rem -= w[i]
		} else {
			total += rem / w[i] * v[i]
			break
		}
	}
	return total
}

func main() {
	fmt.Printf("%.4f\n", fractional(50, []float64{60, 100, 120}, []float64{10, 20, 30})) // 240
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static double fractional(double W, double[] v, double[] w) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Double.compare(v[b] / w[b], v[a] / w[a]));
        double rem = W, total = 0;
        for (int i : idx) {
            if (w[i] <= rem) { total += v[i]; rem -= w[i]; }
            else { total += rem / w[i] * v[i]; break; }
        }
        return total;
    }
    public static void main(String[] args) {
        System.out.printf("%.4f%n", fractional(50,
            new double[]{60, 100, 120}, new double[]{10, 20, 30})); // 240
    }
}
```

#### Python
```python
def fractional(W, v, w):
    idx = sorted(range(len(v)), key=lambda i: v[i] / w[i], reverse=True)
    rem, total = W, 0.0
    for i in idx:
        if w[i] <= rem:
            total += v[i]; rem -= w[i]
        else:
            total += rem / w[i] * v[i]; break
    return total


print(f"{fractional(50, [60, 100, 120], [10, 20, 30]):.4f}")  # 240
```

---

### Task 3 — Capacity larger than total weight

**Problem.** Confirm that when `W ≥ Σ weights`, the answer equals `Σ values` (everything is taken).

**Constraints.** `1 ≤ n ≤ 1000`.

**Hint.** The fractional branch is never reached; the total is just the sum of all values.

#### Go
```go
package main

import "fmt"

func main() {
	v, w := []float64{60, 100, 120}, []float64{10, 20, 30}
	sumW, sumV := 0.0, 0.0
	for i := range v {
		sumW += w[i]
		sumV += v[i]
	}
	got := fractional(sumW+5, v, w) // capacity beyond total
	fmt.Printf("got %.1f want %.1f\n", got, sumV) // 280 280
}
// reuse fractional from Task 2
```

#### Java
```java
public class Task3 {
    public static void main(String[] args) {
        double[] v = {60, 100, 120}, w = {10, 20, 30};
        double sumW = 0, sumV = 0;
        for (int i = 0; i < v.length; i++) { sumW += w[i]; sumV += v[i]; }
        double got = Task2.fractional(sumW + 5, v, w);
        System.out.printf("got %.1f want %.1f%n", got, sumV); // 280 280
    }
}
```

#### Python
```python
v, w = [60, 100, 120], [10, 20, 30]
got = fractional(sum(w) + 5, v, w)
print(f"got {got:.1f} want {sum(v):.1f}")  # 280 280
assert abs(got - sum(v)) < 1e-9
# reuse fractional from Task 2
```

---

### Task 4 — Single item heavier than the bag

**Problem.** With one item whose weight exceeds `W`, confirm the answer is `(W/weight)*value`.

**Constraints.** `weight > W > 0`.

**Hint.** The loop enters the fractional branch immediately for that item.

#### Go
```go
package main

import "fmt"

func main() {
	got := fractional(10, []float64{100}, []float64{20})
	fmt.Printf("%.4f\n", got) // 50.0000  (half of 100)
}
// reuse fractional from Task 2
```

#### Java
```java
public class Task4 {
    public static void main(String[] args) {
        System.out.printf("%.4f%n", Task2.fractional(10,
            new double[]{100}, new double[]{20})); // 50.0000
    }
}
```

#### Python
```python
print(f"{fractional(10, [100], [20]):.4f}")  # 50.0000
# reuse fractional from Task 2
```

---

### Task 5 — Return the take-plan

**Problem.** Return the fraction taken of each original item. Assert at most one fraction is strictly in `(0,1)`.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Carry a `frac` array indexed by original position; set `1.0` for whole, the fraction for the slice, `0` otherwise.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func plan(W float64, v, w []float64) (float64, []float64) {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return v[idx[a]]/w[idx[a]] > v[idx[b]]/w[idx[b]] })
	frac := make([]float64, len(v))
	rem, total := W, 0.0
	for _, i := range idx {
		if w[i] <= rem {
			frac[i] = 1
			total += v[i]
			rem -= w[i]
		} else {
			frac[i] = rem / w[i]
			total += frac[i] * v[i]
			break
		}
	}
	return total, frac
}

func main() {
	v, f := plan(50, []float64{60, 100, 120}, []float64{10, 20, 30})
	fmt.Printf("%.1f %.4f\n", v, f) // 240 [1 1 0.6667]
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static double plan(double W, double[] v, double[] w, double[] frac) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Double.compare(v[b] / w[b], v[a] / w[a]));
        double rem = W, total = 0;
        for (int i : idx) {
            if (w[i] <= rem) { frac[i] = 1; total += v[i]; rem -= w[i]; }
            else { frac[i] = rem / w[i]; total += frac[i] * v[i]; break; }
        }
        return total;
    }
    public static void main(String[] args) {
        double[] f = new double[3];
        double v = plan(50, new double[]{60, 100, 120}, new double[]{10, 20, 30}, f);
        System.out.printf("%.1f %s%n", v, Arrays.toString(f));
    }
}
```

#### Python
```python
def plan(W, v, w):
    idx = sorted(range(len(v)), key=lambda i: v[i] / w[i], reverse=True)
    frac = [0.0] * len(v)
    rem, total = W, 0.0
    for i in idx:
        if w[i] <= rem:
            frac[i] = 1.0; total += v[i]; rem -= w[i]
        else:
            frac[i] = rem / w[i]; total += frac[i] * v[i]; break
    return total, frac


val, fr = plan(50, [60, 100, 120], [10, 20, 30])
partial = sum(1 for x in fr if 0 < x < 1)
print(val, [round(x, 4) for x in fr])
assert partial <= 1
```

---

## Intermediate Tasks (5)

### Task 6 — Exact ranking via cross-multiplication

**Problem.** Items have integer values/weights up to `10⁹`. Rank by density without floating-point division (cross-multiply) and return the value.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ v, w ≤ 10⁹`. Use 64-bit products.

**Hint.** `v[a]/w[a] > v[b]/w[b]  ⇔  v[a]*w[b] > v[b]*w[a]` for positive weights.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func exactRank(W int64, v, w []int64) float64 {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return v[idx[a]]*w[idx[b]] > v[idx[b]]*w[idx[a]] })
	rem := W
	total := 0.0
	for _, i := range idx {
		if w[i] <= rem {
			total += float64(v[i])
			rem -= w[i]
		} else {
			total += float64(rem) / float64(w[i]) * float64(v[i])
			break
		}
	}
	return total
}

func main() {
	fmt.Printf("%.4f\n", exactRank(50, []int64{60, 100, 120}, []int64{10, 20, 30})) // 240
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static double exactRank(long W, long[] v, long[] w) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Long.compare(v[b] * w[a], v[a] * w[b]));
        long rem = W; double total = 0;
        for (int i : idx) {
            if (w[i] <= rem) { total += v[i]; rem -= w[i]; }
            else { total += (double) rem / w[i] * v[i]; break; }
        }
        return total;
    }
    public static void main(String[] args) {
        System.out.printf("%.4f%n", exactRank(50,
            new long[]{60, 100, 120}, new long[]{10, 20, 30})); // 240
    }
}
```

#### Python
```python
import functools


def exact_rank(W, v, w):
    idx = sorted(range(len(v)),
                 key=functools.cmp_to_key(lambda a, b: (v[b] * w[a]) - (v[a] * w[b])))
    rem, total = W, 0.0
    for i in idx:
        if w[i] <= rem:
            total += v[i]; rem -= w[i]
        else:
            total += rem / w[i] * v[i]; break
    return total


print(f"{exact_rank(50, [60, 100, 120], [10, 20, 30]):.4f}")  # 240
```

---

### Task 7 — Fractional vs 0/1 (build the contrast)

**Problem.** Print the fractional optimum and the 0/1 optimum (DP) for the same instance and assert `fractional ≥ 0/1`.

**Constraints.** `1 ≤ n ≤ 100`, integer `W ≤ 10⁴`.

**Hint.** 0/1 DP: `for c from W down to w[i]: dp[c] = max(dp[c], dp[c-w[i]] + v[i])`.

#### Go
```go
package main

import "fmt"

func opt01(W int, v, w []int) int {
	dp := make([]int, W+1)
	for i := range v {
		for c := W; c >= w[i]; c-- {
			if dp[c-w[i]]+v[i] > dp[c] {
				dp[c] = dp[c-w[i]] + v[i]
			}
		}
	}
	return dp[W]
}

func main() {
	v, w := []int{60, 100, 120}, []int{10, 20, 30}
	fv := fractional(50, toF(v), toF(w))
	fmt.Printf("fractional=%.1f 0/1=%d\n", fv, opt01(50, v, w)) // 240 220
}

func toF(a []int) []float64 {
	r := make([]float64, len(a))
	for i, x := range a {
		r[i] = float64(x)
	}
	return r
}
// reuse fractional from Task 2
```

#### Java
```java
public class Task7 {
    static int opt01(int W, int[] v, int[] w) {
        int[] dp = new int[W + 1];
        for (int i = 0; i < v.length; i++)
            for (int c = W; c >= w[i]; c--)
                dp[c] = Math.max(dp[c], dp[c - w[i]] + v[i]);
        return dp[W];
    }
    public static void main(String[] args) {
        int[] v = {60, 100, 120}, w = {10, 20, 30};
        double fv = Task2.fractional(50,
            new double[]{60, 100, 120}, new double[]{10, 20, 30});
        System.out.printf("fractional=%.1f 0/1=%d%n", fv, opt01(50, v, w)); // 240 220
    }
}
```

#### Python
```python
def opt01(W, v, w):
    dp = [0] * (W + 1)
    for vi, wi in zip(v, w):
        for c in range(W, wi - 1, -1):
            dp[c] = max(dp[c], dp[c - wi] + vi)
    return dp[W]


v, w = [60, 100, 120], [10, 20, 30]
fv = fractional(50, v, w)
o = opt01(50, v, w)
print(f"fractional={fv:.1f} 0/1={o}")  # 240 220
assert fv >= o
# reuse fractional from Task 2
```

---

### Task 8 — Exact rational value

**Problem.** Return the optimal value as an exact fraction (no floating point at all).

**Constraints.** `1 ≤ n ≤ 1000`, integer values/weights.

**Hint.** The whole-item part is an integer sum; the slice adds `remaining*value / weight` as an exact rational.

#### Go
```go
package main

import (
	"fmt"
	"math/big"
	"sort"
)

func exactValue(W int64, v, w []int64) *big.Rat {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return v[idx[a]]*w[idx[b]] > v[idx[b]]*w[idx[a]] })
	total := new(big.Rat)
	rem := W
	for _, i := range idx {
		if w[i] <= rem {
			total.Add(total, new(big.Rat).SetInt64(v[i]))
			rem -= w[i]
		} else {
			total.Add(total, new(big.Rat).SetFrac(big.NewInt(rem*v[i]), big.NewInt(w[i])))
			break
		}
	}
	return total
}

func main() {
	fmt.Println(exactValue(50, []int64{60, 100, 120}, []int64{10, 20, 30})) // 240/1
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    // Returns numerator/denominator (reduced) of the exact value.
    static long[] exactValue(long W, long[] v, long[] w) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Long.compare(v[b] * w[a], v[a] * w[b]));
        long num = 0, den = 1, rem = W;          // total = num/den
        for (int i : idx) {
            if (w[i] <= rem) { num += v[i] * den; rem -= w[i]; }
            else {
                num = num * w[i] + rem * v[i] * den; den *= w[i]; break;
            }
        }
        long g = gcd(Math.abs(num), den);
        return new long[]{num / g, den / g};
    }
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }

    public static void main(String[] args) {
        long[] r = exactValue(50, new long[]{60, 100, 120}, new long[]{10, 20, 30});
        System.out.println(r[0] + "/" + r[1]); // 240/1
    }
}
```

#### Python
```python
from fractions import Fraction
import functools


def exact_value(W, v, w):
    idx = sorted(range(len(v)),
                 key=functools.cmp_to_key(lambda a, b: (v[b] * w[a]) - (v[a] * w[b])))
    total, rem = Fraction(0), W
    for i in idx:
        if w[i] <= rem:
            total += v[i]; rem -= w[i]
        else:
            total += Fraction(rem * v[i], w[i]); break
    return total


print(exact_value(50, [60, 100, 120], [10, 20, 30]))  # 240
```

---

### Task 9 — Bounded supply (multiple units per item)

**Problem.** Each item `i` has up to `qᵢ` divisible units (total available weight `qᵢ·wᵢ`). Maximize value under capacity `W`.

**Constraints.** `1 ≤ n ≤ 10⁵`. Same greedy: density is still `v/w` per unit.

**Hint.** Treat each item as a "pile" of total weight `qᵢ·wᵢ` and total value `qᵢ·vᵢ` with density `vᵢ/wᵢ`; sort by density and fill.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func bounded(W float64, v, w, q []float64) float64 {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return v[idx[a]]/w[idx[a]] > v[idx[b]]/w[idx[b]] })
	rem, total := W, 0.0
	for _, i := range idx {
		avail := q[i] * w[i]   // total weight available of item i
		if avail <= rem {
			total += q[i] * v[i]
			rem -= avail
		} else {
			total += rem / w[i] * v[i]  // density v/w times remaining weight
			break
		}
	}
	return total
}

func main() {
	// two units of (60,10) -> 120 weight 20; one of (100,20)
	fmt.Printf("%.1f\n", bounded(50, []float64{60, 100}, []float64{10, 20}, []float64{2, 1}))
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static double bounded(double W, double[] v, double[] w, double[] q) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Double.compare(v[b] / w[b], v[a] / w[a]));
        double rem = W, total = 0;
        for (int i : idx) {
            double avail = q[i] * w[i];
            if (avail <= rem) { total += q[i] * v[i]; rem -= avail; }
            else { total += rem / w[i] * v[i]; break; }
        }
        return total;
    }
    public static void main(String[] args) {
        System.out.printf("%.1f%n", bounded(50,
            new double[]{60, 100}, new double[]{10, 20}, new double[]{2, 1}));
    }
}
```

#### Python
```python
def bounded(W, v, w, q):
    idx = sorted(range(len(v)), key=lambda i: v[i] / w[i], reverse=True)
    rem, total = W, 0.0
    for i in idx:
        avail = q[i] * w[i]
        if avail <= rem:
            total += q[i] * v[i]; rem -= avail
        else:
            total += rem / w[i] * v[i]; break
    return total


print(f"{bounded(50, [60, 100], [10, 20], [2, 1]):.1f}")
```

---

### Task 10 — Minimization mirror (cheapest fill)

**Problem.** Buy at least `T` divisible units of a good, choosing among suppliers each offering up to `capᵢ` units at unit cost `cᵢ`. Minimize total cost.

**Constraints.** `1 ≤ n ≤ 10⁵`. Greedy: cheapest unit cost first.

**Hint.** Sort suppliers by cost-per-unit **ascending**; buy fully from the cheapest until the target `T` is met (slice the last).

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func cheapestFill(T float64, cost, cap []float64) float64 {
	idx := make([]int, len(cost))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return cost[idx[a]] < cost[idx[b]] }) // ascending
	need, spent := T, 0.0
	for _, i := range idx {
		if cap[i] <= need {
			spent += cap[i] * cost[i]
			need -= cap[i]
		} else {
			spent += need * cost[i]
			need = 0
			break
		}
	}
	return spent
}

func main() {
	// need 30 units; supplier A: 20 units @1, B: 20 units @2 -> 20*1 + 10*2 = 40
	fmt.Printf("%.1f\n", cheapestFill(30, []float64{1, 2}, []float64{20, 20})) // 40
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static double cheapestFill(double T, double[] cost, double[] cap) {
        Integer[] idx = new Integer[cost.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Double.compare(cost[a], cost[b])); // ascending
        double need = T, spent = 0;
        for (int i : idx) {
            if (cap[i] <= need) { spent += cap[i] * cost[i]; need -= cap[i]; }
            else { spent += need * cost[i]; break; }
        }
        return spent;
    }
    public static void main(String[] args) {
        System.out.printf("%.1f%n", cheapestFill(30,
            new double[]{1, 2}, new double[]{20, 20})); // 40
    }
}
```

#### Python
```python
def cheapest_fill(T, cost, cap):
    idx = sorted(range(len(cost)), key=lambda i: cost[i])  # ascending
    need, spent = T, 0.0
    for i in idx:
        if cap[i] <= need:
            spent += cap[i] * cost[i]; need -= cap[i]
        else:
            spent += need * cost[i]; break
    return spent


print(f"{cheapest_fill(30, [1, 2], [20, 20]):.1f}")  # 40
```

---

## Advanced Tasks (5)

### Task 11 — O(n) value via quickselect (no full sort)

**Problem.** Compute the optimal value in `O(n)` expected time by partitioning around the critical density. Validate against the sort-based answer on random instances.

**Constraints.** `1 ≤ n ≤ 10⁶`. Integer values/weights.

**Hint.** Partition into denser / equal / less-dense around a random pivot; if the denser side's weight `≥ remaining`, recurse there; else absorb it (and equal-density items) and recurse into the less-dense side with reduced capacity.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
)

type It struct{ v, w int64 }

func denser(a, b It) bool { return a.v*b.w > b.v*a.w }

func maxValue(W int64, items []It) float64 {
	its := append([]It(nil), items...)
	total, cap := 0.0, W
	for len(its) > 0 && cap > 0 {
		piv := its[rand.Intn(len(its))]
		var H, E, L []It
		var wH int64
		for _, it := range its {
			switch {
			case denser(it, piv):
				H = append(H, it)
				wH += it.w
			case denser(piv, it):
				L = append(L, it)
			default:
				E = append(E, it)
			}
		}
		if wH >= cap {
			its = H
			continue
		}
		for _, it := range H {
			total += float64(it.v)
		}
		cap -= wH
		done := false
		for _, it := range E {
			if it.w <= cap {
				total += float64(it.v)
				cap -= it.w
			} else {
				total += float64(cap) / float64(it.w) * float64(it.v)
				cap = 0
				done = true
				break
			}
		}
		if done || cap == 0 {
			break
		}
		its = L
	}
	return total
}

func main() {
	fmt.Printf("%.4f\n", maxValue(50, []It{{60, 10}, {100, 20}, {120, 30}})) // 240
}
```

#### Java
```java
import java.util.*;

public class Task11 {
    record It(long v, long w) {}
    static boolean denser(It a, It b) { return a.v() * b.w() > b.v() * a.w(); }

    static double maxValue(long W, List<It> items) {
        List<It> its = new ArrayList<>(items);
        double total = 0; long cap = W; Random rng = new Random(3);
        while (!its.isEmpty() && cap > 0) {
            It piv = its.get(rng.nextInt(its.size()));
            List<It> H = new ArrayList<>(), E = new ArrayList<>(), L = new ArrayList<>();
            long wH = 0;
            for (It it : its) {
                if (denser(it, piv)) { H.add(it); wH += it.w(); }
                else if (denser(piv, it)) L.add(it);
                else E.add(it);
            }
            if (wH >= cap) { its = H; continue; }
            for (It it : H) total += it.v();
            cap -= wH;
            boolean done = false;
            for (It it : E) {
                if (it.w() <= cap) { total += it.v(); cap -= it.w(); }
                else { total += (double) cap / it.w() * it.v(); cap = 0; done = true; break; }
            }
            if (done || cap == 0) break;
            its = L;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", maxValue(50,
            List.of(new It(60,10), new It(100,20), new It(120,30)))); // 240
    }
}
```

#### Python
```python
import random


def denser(a, b):
    return a[0] * b[1] > b[0] * a[1]


def max_value(W, items):
    its, total, cap = list(items), 0.0, W
    while its and cap > 0:
        piv = its[random.randrange(len(its))]
        H = [x for x in its if denser(x, piv)]
        L = [x for x in its if denser(piv, x)]
        E = [x for x in its if not denser(x, piv) and not denser(piv, x)]
        wH = sum(x[1] for x in H)
        if wH >= cap:
            its = H; continue
        total += sum(x[0] for x in H); cap -= wH
        done = False
        for v, w in E:
            if w <= cap:
                total += v; cap -= w
            else:
                total += cap / w * v; cap = 0; done = True; break
        if done or cap == 0:
            break
        its = L
    return total


print(f"{max_value(50, [(60,10),(100,20),(120,30)]):.4f}")  # 240
```

---

### Task 12 — Fractional bound inside 0/1 branch-and-bound

**Problem.** Solve 0/1 Knapsack exactly with branch-and-bound, using the fractional optimum (on remaining items/capacity) as the upper-bound for pruning.

**Constraints.** `1 ≤ n ≤ 40`, integer `W ≤ 10⁹` (so DP is impractical, B&B shines).

**Hint.** Sort by density once. At each node compute the fractional bound on the suffix; prune if `taken + bound ≤ best`.

#### Python (reference; Go/Java mirror the same recursion)
```python
def knapsack_bb(W, items):
    items = sorted(items, key=lambda it: it[0] / it[1], reverse=True)
    n = len(items)
    best = 0

    def bound(i, cap, val):
        b = val
        for j in range(i, n):
            v, w = items[j]
            if w <= cap:
                b += v; cap -= w
            else:
                b += cap / w * v; break  # fractional bound
        return b

    def rec(i, cap, val):
        nonlocal best
        if val > best:
            best = val
        if i == n or cap == 0:
            return
        if bound(i, cap, val) <= best:   # prune
            return
        v, w = items[i]
        if w <= cap:
            rec(i + 1, cap - w, val + v)  # take
        rec(i + 1, cap, val)              # skip

    rec(0, W, 0)
    return best


print(knapsack_bb(50, [(60, 10), (100, 20), (120, 30)]))  # 220
```

#### Go
```go
// knapsackBB: sort by density desc; recursion take/skip; at each node compute the
// fractional bound over the suffix and prune if val+bound <= best.
// Verify knapsackBB(50, {(60,10),(100,20),(120,30)}) == 220.
```

#### Java
```java
// Same structure: sort by density desc, DFS take/skip, fractional bound for pruning.
// Verify knapsackBB(50, items) == 220.
```

---

### Task 13 — Streaming critical density via histogram

**Problem.** Items arrive as a stream and do not fit in memory at full resolution. Estimate the optimal value using a fixed-resolution density histogram in two passes.

**Constraints.** `n` up to `10⁸` (streamed); `B` buckets (e.g., 1024).

**Hint.** Pass 1: bucket items by density, accumulate per-bucket total weight and value. Find the bucket where cumulative weight (densest-first) crosses `W`. Pass 2: take all buckets above it; within the critical bucket, take proportionally to fill exactly.

#### Python
```python
def stream_estimate(W, stream, dmin, dmax, B=1024):
    # Pass 1: histogram of (weight, value) by density bucket.
    wsum = [0.0] * B
    vsum = [0.0] * B
    def bucket(d):
        if d >= dmax: return B - 1
        if d <= dmin: return 0
        return int((d - dmin) / (dmax - dmin) * B)
    items = list(stream)               # (in practice, iterate twice over a source)
    for v, w in items:
        b = bucket(v / w)
        wsum[b] += w; vsum[b] += v
    # Walk buckets densest-first (high index -> low).
    rem, total = W, 0.0
    for b in range(B - 1, -1, -1):
        if wsum[b] <= rem:
            total += vsum[b]; rem -= wsum[b]
        else:
            # take a proportional slice of this bucket (approx: uniform density in bucket)
            if wsum[b] > 0:
                total += rem / wsum[b] * vsum[b]
            rem = 0; break
    return total


data = [(60, 10), (100, 20), (120, 30)]
print(f"{stream_estimate(50, data, 0.0, 10.0):.2f}")  # ~240 (approx)
```

#### Go / Java
```text
// Mirror the Python: fixed-resolution density histogram (per-bucket weight & value),
// walk buckets densest-first, slice proportionally within the critical bucket.
// The estimate approaches the exact value as bucket count B grows.
```

---

### Task 14 — Online pacing with a density threshold

**Problem.** Requests arrive online, each with a value and weight; you must accept/reject (and may take a fraction of the current one to exactly exhaust the budget) immediately. Approximate the offline optimum with a fixed density threshold `ρ*`.

**Constraints.** `1 ≤ n ≤ 10⁶`. You are given a threshold estimate `ρ*` (e.g., from history).

**Hint.** Accept a request fully iff its density `≥ ρ*` and it fits; if budget is nearly exhausted, take a fraction. Compare the online value to the offline greedy on the same set.

#### Python
```python
def online_pacer(W, requests, rho_star):
    rem, total = W, 0.0
    for v, w in requests:
        if rem == 0:
            break
        if v / w >= rho_star:
            take_w = min(w, rem)
            total += take_w / w * v
            rem -= take_w
    return total


reqs = [(60, 10), (40, 20), (100, 20), (120, 30)]  # densities 6, 2, 5, 4
# offline greedy fills with 6,5,4 densities; threshold 3.5 accepts those, rejects density-2
print(f"{online_pacer(50, reqs, 3.5):.1f}")
# compare with offline:
print(f"{fractional(50, [v for v, _ in reqs], [w for _, w in reqs]):.1f}")
# reuse fractional from Task 2
```

#### Go / Java
```text
// Mirror the Python: single pass; accept (fully or fractionally to exhaust budget)
// iff density >= rho_star. Compare to the offline greedy total on the same requests.
// A well-chosen rho* (the offline critical density) makes the online value match offline.
```

---

### Task 15 — Multi-knapsack heuristic and its gap

**Problem.** Given `k` bags each of capacity `W` and divisible items, a natural greedy fills the densest items across all bags. Show that *single-bag* fractional greedy applied to total capacity `k·W` upper-bounds the true multi-bag optimum, and measure the gap on examples where items cannot be split across bags (i.e., an item's whole weight must fit in one bag).

**Constraints.** `1 ≤ k ≤ 5`, `1 ≤ n ≤ 20`.

**Hint.** With *fully* divisible items across all bags, the problem collapses to a single capacity `k·W` and pure greedy is exact. The gap appears only when an item must reside in a single bag (a bin-packing-like constraint) — then greedy on `k·W` is just an upper bound.

#### Python
```python
def single_bag_bound(kW, v, w):
    """Upper bound: treat all k bags as one capacity k*W (fully divisible)."""
    return fractional(kW, v, w)   # reuse Task 2


# Example: k=2 bags of W=10 (total 20). Items each weight 10, can't split across bags.
v, w, k, W = [10, 9, 8], [10, 10, 10], 2, 10
bound = single_bag_bound(k * W, v, w)   # fills densest 20 weight -> 10 + 9 = 19
# True multi-bag optimum (each item whole, one per bag): best two items = 10 + 9 = 19 here,
# but with weights that don't tile W exactly the bound exceeds the true optimum.
print(f"bound (k*W) = {bound:.1f}")
v2, w2 = [10, 10, 10], [6, 6, 6]        # three items weight 6, bags of 10
print(f"bound = {single_bag_bound(20, v2, w2):.1f}")  # 20/6*... overcounts vs whole-item packing
```

#### Go / Java
```text
// Mirror the Python: single_bag_bound = fractional(k*W, ...) is an upper bound on the
// multi-bag whole-item-per-bag optimum. Construct weights that don't tile W to expose the gap.
```

---

## Benchmark Task — Sort vs Quickselect vs Exact

**Problem.** Generate random instances with `n = 10⁴, 10⁵, 10⁶`. Time three implementations of the **value-only** query: sort-based greedy, `O(n)` quickselect, and exact-rational greedy. Report which is fastest and confirm all agree.

**Expected findings.**
- Sort-based is `O(n log n)` — simple and the right default for small/medium `n` or when you need the plan.
- Quickselect is `O(n)` expected — wins for large `n` when only the value is needed; guard with median-of-medians/introselect against adversarial pivots.
- Exact-rational is the slowest (big-integer arithmetic) but the only one with no floating-point error — use when a contract demands exactness.

#### Python
```python
import time, random


def bench(n):
    items = [(random.randint(1, 1000), random.randint(1, 1000)) for _ in range(n)]
    W = sum(w for _, w in items) // 2
    for name, fn in [
        ("sort", lambda: fractional(W, [v for v, _ in items], [w for _, w in items])),
        ("quickselect", lambda: max_value(W, items)),
    ]:
        t0 = time.perf_counter()
        val = fn()
        dt = time.perf_counter() - t0
        print(f"n={n:<8} {name:<12} {dt*1000:8.1f} ms  value={val:.1f}")


for n in (10_000, 100_000, 1_000_000):
    bench(n)
# reuse fractional (Task 2) and max_value (Task 11)
```

#### Go / Java
```text
// Time the sort-based greedy (Task 2) and quickselect (Task 11) on random instances of
// n = 1e4, 1e5, 1e6 with W = totalWeight/2.
// Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: quickselect pulls ahead as n grows (no log factor); both agree on the value.
```

**Evaluation criteria.**
- Correctness: all three agree on the value (within float tolerance; exact-rational is the ground truth).
- Performance: report wall-clock per `n`; explain why quickselect wins at large `n` for value-only queries.
- Discussion: when do you keep the sort? (Answer: when you need the full ordered plan, or `n` is small.)
</content>

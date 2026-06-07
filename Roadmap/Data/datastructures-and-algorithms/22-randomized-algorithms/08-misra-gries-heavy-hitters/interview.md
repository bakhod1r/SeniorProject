# Misra-Gries Heavy Hitters — Interview Preparation

Misra-Gries is a favourite interview topic because it rewards one crisp insight — *"keep `k - 1` counters; when a new item meets a full table, decrement **every** counter; each such event throws away `k` distinct items, so any item loses at most `n/k`"* — and then tests whether you can (a) connect it to the **Boyer-Moore majority vote** (`k = 2`), (b) state and justify the `f(x) - n/k ≤ est(x) ≤ f(x)` guarantee, (c) explain **no false negatives but possible false positives** and the **two-pass** fix, and (d) compare it with **Count-Min Sketch**, **Space-Saving**, and **Lossy Counting**, including which way each one errs. This file is a tiered question bank plus four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer |
|----------|--------|
| What does it find? | Items with frequency `> n/k`, in one pass, `O(k)` space. |
| The three rules? | tracked → +1; free slot → add(1); table full → decrement-all & drop zeros. |
| `k = 2` is...? | Boyer-Moore majority vote (one counter). |
| Error bound? | `f(x) - n/k ≤ est(x) ≤ f(x)` (undercount only, never over). |
| False negatives? | **None** — every true heavy hitter is retained. |
| False positives? | Possible — remove with a second pass. |
| Why ≤ `n/k` undercount? | Each decrement-all removes `k` distinct items → ≤ `n/k` events. |
| Mergeable? | Yes — combine counts, prune by the `k`-th largest value. |
| vs Space-Saving? | Space-Saving **over**counts, replaces the min, ranks top-`k` better. |
| vs Count-Min? | Count-Min is randomized, **over**counts, is a per-key frequency oracle. |

The update loop (the heart of everything):

```text
update(A, x, k):
    if x in A:            A[x] += 1                 # increment
    elif len(A) < k-1:    A[x] = 1                  # claim free slot
    else:                                           # decrement-all
        for y in A: A[y] -= 1
        drop entries with A[y] == 0
```

Key facts:
- **A heavy hitter (`f > n/k`) is never missed; an item in the table is only a candidate.**
- The estimate **never overcounts**; it undercounts by at most `n/k`.
- At most `k - 1` heavy hitters can exist (else total > `n`).
- Misra-Gries is **deterministic**; Count-Min is randomized.

---

## Junior Questions (12 Q&A)

### J1. What problem does Misra-Gries solve?
Finding **frequent items (heavy hitters)** — items whose count exceeds `n/k` — in a single pass over a stream using only `O(k)` memory, far less than the `O(distinct)` of a full hash map.

### J2. State the algorithm in three rules.
For each item `x`: (1) if `x` is already tracked, increment its counter; (2) else if fewer than `k - 1` counters are used, add `x` with count 1; (3) else decrement **all** counters by 1 and remove any that reach 0.

### J3. How is it related to Boyer-Moore majority vote?
Boyer-Moore (find an element appearing more than `n/2` times with one counter) is exactly Misra-Gries with `k = 2`. The single counter's `count--` on a mismatch is the `k = 2` decrement-all.

### J4. How many counters does it use, and why `k - 1`?
`k - 1` counters. There can be at most `k - 1` items with frequency `> n/k` (otherwise their total would exceed `n`), so `k - 1` slots suffice to hold every heavy hitter.

### J5. What is the space complexity?
`O(k)` — fixed, independent of stream length and the number of distinct items. That is the whole point.

### J6. What is the time per item?
`O(1)` amortized. A decrement-all is `O(k)`, but at most `n/k` of them happen, so the total decrement work is `O(n)`, i.e. `O(1)` per item on average.

### J7. Does the algorithm give exact counts?
No. It gives **estimates** that may undercount the true frequency. The guarantee is `f(x) - n/k ≤ est(x) ≤ f(x)`.

### J8. Can it overcount?
No. Counters only increment on real occurrences and only decrement, so `est(x) ≤ f(x)` always.

### J9. What is a false positive here?
An item that survives in the final table but whose true frequency is **not** above `n/k`. Misra-Gries can produce these; a second pass removes them.

### J10. What is a false negative, and does Misra-Gries have them?
A false negative would be missing a true heavy hitter. Misra-Gries has **none** — every item with `f > n/k` is guaranteed to be in the table.

### J11. Walk through `A B A C C A B D A` with `k = 3`.
Table evolves: `{A:1}`, `{A:1,B:1}`, `{A:2,B:1}`, decrement-all → `{A:1}`, `{A:1,C:1}`, `{A:2,C:1}`, decrement-all → `{A:1}`, `{A:1,D:1}`, `{A:2,D:1}`. Final candidates `{A:2, D:1}`; `A` is the real heavy hitter, `D` a false positive.

### J12. Why must we drop counters that reach zero?
A zeroed counter is a free slot; keeping it would waste capacity and block a genuinely new item from being tracked.

---

## Middle Questions (14 Q&A)

### M1. Prove `est(x) ≤ f(x)`.
A counter for `x` is only ever incremented when `x` actually occurs, and otherwise only decremented. So it can never exceed the number of `x` occurrences seen — `est(x) ≤ f(x)`.

### M2. Prove `est(x) ≥ f(x) - n/k`.
Each decrement-all removes `k` distinct item-occurrences (one from each of `k - 1` counters plus the unstored trigger), so the number of decrement-all events `D ≤ n/k`. An item's count falls below its true frequency only via these events, at most once each, so `est(x) ≥ f(x) - D ≥ f(x) - n/k`.

### M3. Why does that imply no false negatives?
If `f(x) > n/k`, then `est(x) ≥ f(x) - n/k > 0`, so `x` is present in the final table.

### M4. How does the two-pass version get exact answers?
Pass 1 finds ≤ `k - 1` candidates (containing all heavy hitters). Pass 2 re-counts only those candidates exactly and keeps those with true count `> n/k`. Result: exactly the heavy-hitter set.

### M5. When can you skip the second pass?
When approximate answers are acceptable, when you already have exact totals, or when you accept reporting candidates (with possible false positives) directly.

### M6. Compare Misra-Gries and Space-Saving.
Both keep `O(k)` `(item, count)` pairs. On a full table, Misra-Gries **decrements all** (undercounts); Space-Saving **evicts the minimum** and gives the new item `min + 1` (overcounts), tracking better top-`k` ranking. (Cross-link `11-space-saving-algorithm`.)

### M7. Compare Misra-Gries and Count-Min Sketch.
Misra-Gries is deterministic, undercounts, and returns the heavy-hitter *set* in `O(k)` space. Count-Min is randomized (hash functions), overcounts (`≤ εN` w.p. `1 - δ`), and is a *frequency oracle* for arbitrary keys in `O((1/ε) log(1/δ))` space.

### M8. Compare Misra-Gries and Lossy Counting.
Both deterministic with `εn`-style undercount. Lossy Counting uses bucketed periodic pruning, costs `O((1/ε) log(εn))` space (a log factor more), and naturally supports windowed/approximate counts; Misra-Gries is tighter in space and simpler.

### M9. Which algorithms overcount and which undercount?
Undercount: Misra-Gries, Lossy Counting. Overcount: Space-Saving, Count-Min Sketch.

### M10. How do you choose `k` from a target fraction `φ`?
`k = ⌈1/φ⌉`, keeping `k - 1` counters. For items over 1%, `φ = 0.01 → k = 100 → 99 counters`.

### M11. Is the threshold `> n/k` or `≥ n/k`?
Strictly `>`. An item at exactly `n/k` is **not** guaranteed to be retained.

### M12. What is the worst-case time per item?
`O(k)` — a decrement-all sweep touches all counters. Amortized it is `O(1)`. A linked-bucket structure can make it `O(1)` worst case.

### M13. Why is the error stated as a fraction of `n` rather than an absolute number?
The stream length is unknown in advance and the algorithm is scale-free: the bound `n/k` scales with the data. Equivalently set `ε = 1/k` for an `εn` error.

### M14. Give a quick test that validates an implementation.
On random data assert both halves of the bound (`f(x) - n/k ≤ est(x) ≤ f(x)`) and that every true heavy hitter appears. Also test the `k = 2` majority case and the empty stream.

---

## Senior Questions (12 Q&A)

### S1. What makes Misra-Gries suitable for distributed streams?
It is a **mergeable summary**: per-shard summaries combine (add common counts, prune by subtracting the `k`-th largest value) into a global summary that keeps the same `N/k` guarantee — no re-scanning raw data.

### S2. Describe the merge procedure.
Add the counts of common keys and union distinct keys; if more than `k - 1` keys remain, subtract the `k`-th largest counter value from all counters and drop non-positives, leaving ≤ `k - 1`.

### S3. Why is merge associative and commutative, and why does that matter?
Combine is symmetric (commutative) and the prune depends only on the combined counts (associative up to the same bound). This lets any aggregation tree — pairwise, hierarchical, MapReduce — produce a summary with the same guarantee.

### S4. Name real systems that use heavy hitters.
Network top-talker monitoring, DDoS detection, trending topics/search, CDN hot-object analysis, and database skew/cardinality estimation for query optimization.

### S5. How do you size `k` against a memory budget?
`k - 1 ≈ budget_bytes / bytes_per_counter`, and separately `k ≥ 1/φ` for the smallest fraction you must detect. Take the larger; if the budget can't meet the accuracy target, raise the budget or accept missing smaller hitters.

### S6. Is a single Misra-Gries instance thread-safe?
No — the decrement-all is a multi-key critical section. Use **shard-then-merge** (per-worker instances, periodic merge) or guard the whole summary with a lock.

### S7. Key-partitioning vs arrival-partitioning across shards?
Key-partitioning keeps each key on one shard (exact local counts); arrival/round-robin spreads a key and relies on the merge guarantee. Both are sound; key-partitioning gives tighter local estimates.

### S8. How do you get "heavy hitters now" rather than "since forever"?
Windowing: tumbling windows (reset each interval), sliding windows (merge recent sub-window summaries), or exponential decay (periodically scale all counts by `γ < 1`).

### S9. When would you choose Space-Saving over Misra-Gries in production?
At line rate where the `O(k)` sweep hurts, or when you need accurate top-`k` ranking — Space-Saving's `O(1)` min-replacement and overcount semantics suit those.

### S10. What is the memory-vs-accuracy relationship?
Linear: counters (memory) `∝ 1/ε`. Halving the error fraction doubles the counters. Far cheaper than `O(distinct)` exact counting.

### S11. What's an adversarial input and how does it affect the guarantee?
An attacker can flood unique keys to trigger constant decrement-all, but a truly heavy item (`> n/k`) still survives. The bound is robust; only false-positive churn increases. Monitor the decrement-all rate.

### S12. How do you verify exactness on an unbounded stream where a second pass is impossible?
Maintain an auxiliary exact aggregate (or a Count-Min sketch) for the small candidate set, or re-verify candidates over a recent retained window; full exactness needs replayable data.

---

## Professional Questions (8 Q&A)

### P1. State and prove the mass identity.
`M(A_n) = n - kD` where `M` is total counter mass and `D` the decrement-all count. Proof: `n - D` items add `+1` to `M`; each of the `D` decrement-all events subtracts `k - 1` (and the trigger adds 0), giving `(n - D) - D(k-1) = n - kD`.

### P2. Derive `D ≤ n/k`.
Since `M(A_n) ≥ 0`, `n - kD ≥ 0`, hence `D ≤ n/k`. This is the "each decrement removes `k` distinct items" bound.

### P3. State the loop invariant used in the correctness proof.
`I(i): f_i(x) - D_i ≤ est_i(x) ≤ f_i(x)` for all `x`, where `D_i` is the decrement-all count among the first `i` items. Base `I(0)` trivial; the inductive step checks INCREMENT/INSERT (gap unchanged) and DECREMENT-ALL (gap and `D` each grow by exactly 1).

### P4. Why is the bound tight?
There exist streams forcing `⌊n/k⌋` decrement-all events that each decrement a target heavy item, driving its estimate to exactly `f(x) - ⌊n/k⌋`. So no deterministic algorithm with `k - 1` counters can guarantee a smaller universal undercount.

### P5. Argue space optimality.
Any deterministic algorithm with additive `εn` error must distinguish `Ω(1/ε)` items straddling the threshold; a communication-complexity reduction gives an `Ω(1/ε)`-counter lower bound. Misra-Gries uses `1/ε - 1` counters — optimal up to an additive 1.

### P6. Prove the merged summary keeps `f(x) - N/k ≤ est(x) ≤ f(x)`.
Upper: combine only sums real counts and prune only subtracts, so `≤ f(x)`. Lower: total mass `≤ N` shared by `≥ k` counters bounds the `k`-th largest `t ≤ N/k`; combined with each summary's own undercount, the total loss telescopes to `≤ N/k` (Agarwal et al., *Mergeable Summaries*).

### P7. How does Boyer-Moore fall out as a special case?
`k = 2` gives one counter; decrement-all is `count--`, insert is "adopt candidate when count 0." Theorem `est ≥ f - n/2` means a strict majority survives — classical majority correctness.

### P8. State the duality with Space-Saving.
Misra-Gries guarantees `f(x) - n/k ≤ est(x) ≤ f(x)` (undercount); Space-Saving guarantees `f(x) ≤ est(x) ≤ f(x) + n/k` (overcount). They are reflections — one pushes estimates down, the other up — with the same `O(1/ε)` space.

---

## Behavioral / System-Design Prompts

- *"Design a top-talker dashboard for a 100 Gbps link with 4 KB of state per collector."* — Misra-Gries (or Space-Saving) per collector, `k` from the byte budget, merge collector summaries centrally, window by minute.
- *"Find trending hashtags across 50 ingestion shards."* — per-shard Misra-Gries, tree-merge summaries, second-pass or auxiliary exact count for the small candidate set.
- *"A query planner needs the most common values of a billion-row column without a full sort."* — single Misra-Gries pass for skew candidates feeding histogram construction.
- *"Detect IPs sending > 0.1% of packets in real time for DDoS mitigation."* — `k = 1000`, windowed, alert on candidates verified against an exact small-set counter.

---

## Coding Challenges (3 Languages)

> Solve each in Go, Java, and Python. Validate against a brute-force `Counter`/hash-map oracle on small inputs.

### Challenge 1 — Boyer-Moore majority (the `k = 2` case)

> Return the element appearing more than `⌊n/2⌋` times, or report none exists. One pass, `O(1)` extra space, plus a verification pass.

#### Go

```go
package main

import "fmt"

func majority(a []int) (int, bool) {
	cand, count := 0, 0
	for _, x := range a {
		if count == 0 {
			cand, count = x, 1
		} else if x == cand {
			count++
		} else {
			count--
		}
	}
	// verify
	c := 0
	for _, x := range a {
		if x == cand {
			c++
		}
	}
	return cand, c > len(a)/2
}

func main() {
	fmt.Println(majority([]int{2, 2, 1, 1, 2, 2})) // 2 true
	fmt.Println(majority([]int{1, 2, 3, 4}))       // some value, false
}
```

#### Java

```java
public class Majority {
    static int[] majority(int[] a) { // returns {candidate, isMajority?1:0}
        int cand = 0, count = 0;
        for (int x : a) {
            if (count == 0) { cand = x; count = 1; }
            else if (x == cand) count++;
            else count--;
        }
        int c = 0;
        for (int x : a) if (x == cand) c++;
        return new int[]{cand, c > a.length / 2 ? 1 : 0};
    }

    public static void main(String[] args) {
        int[] r = majority(new int[]{2, 2, 1, 1, 2, 2});
        System.out.println(r[0] + " " + (r[1] == 1)); // 2 true
    }
}
```

#### Python

```python
def majority(a):
    cand, count = None, 0
    for x in a:
        if count == 0:
            cand, count = x, 1
        elif x == cand:
            count += 1
        else:
            count -= 1
    return cand, a.count(cand) > len(a) // 2


if __name__ == "__main__":
    print(majority([2, 2, 1, 1, 2, 2]))  # (2, True)
    print(majority([1, 2, 3, 4]))        # (x, False)
```

### Challenge 2 — Misra-Gries first pass

> Implement the `k - 1`-counter summary; return the candidate map. Already shown in junior/middle — reproduce from memory.

#### Python

```python
def misra_gries(stream, k):
    c = {}
    for x in stream:
        if x in c:
            c[x] += 1
        elif len(c) < k - 1:
            c[x] = 1
        else:
            for key in list(c):
                c[key] -= 1
                if c[key] == 0:
                    del c[key]
    return c
```

(Go and Java versions identical in structure to junior.md.)

### Challenge 3 — Exact heavy hitters (two pass)

> Combine pass 1 and a verification pass to return exactly the items with frequency `> n/k`.

#### Go

```go
package main

import "fmt"

func exactHeavy(stream []string, k int) map[string]int {
	c := map[string]int{}
	for _, x := range stream {
		if _, ok := c[x]; ok {
			c[x]++
		} else if len(c) < k-1 {
			c[x] = 1
		} else {
			for key := range c {
				c[key]--
				if c[key] == 0 {
					delete(c, key)
				}
			}
		}
	}
	exact := map[string]int{}
	for cand := range c {
		exact[cand] = 0
	}
	for _, x := range stream {
		if _, ok := exact[x]; ok {
			exact[x]++
		}
	}
	out := map[string]int{}
	thr := float64(len(stream)) / float64(k)
	for cand, cnt := range exact {
		if float64(cnt) > thr {
			out[cand] = cnt
		}
	}
	return out
}

func main() {
	fmt.Println(exactHeavy([]string{"A", "B", "A", "C", "C", "A", "B", "D", "A"}, 3)) // map[A:4]
}
```

#### Java

```java
import java.util.*;

public class ExactHeavy {
    static Map<String,Integer> exactHeavy(List<String> s, int k) {
        Map<String,Integer> c = new HashMap<>();
        for (String x : s) {
            if (c.containsKey(x)) c.put(x, c.get(x)+1);
            else if (c.size() < k-1) c.put(x, 1);
            else {
                var it = c.entrySet().iterator();
                while (it.hasNext()) {
                    var e = it.next();
                    if (e.getValue() == 1) it.remove(); else e.setValue(e.getValue()-1);
                }
            }
        }
        Map<String,Integer> exact = new HashMap<>();
        for (String cand : c.keySet()) exact.put(cand, 0);
        for (String x : s) if (exact.containsKey(x)) exact.put(x, exact.get(x)+1);
        double thr = (double) s.size() / k;
        Map<String,Integer> out = new HashMap<>();
        for (var e : exact.entrySet()) if (e.getValue() > thr) out.put(e.getKey(), e.getValue());
        return out;
    }

    public static void main(String[] args) {
        System.out.println(exactHeavy(
            Arrays.asList("A","B","A","C","C","A","B","D","A"), 3)); // {A=4}
    }
}
```

#### Python

```python
def exact_heavy(stream, k):
    c = {}
    for x in stream:
        if x in c:
            c[x] += 1
        elif len(c) < k - 1:
            c[x] = 1
        else:
            for key in list(c):
                c[key] -= 1
                if c[key] == 0:
                    del c[key]
    exact = {cand: 0 for cand in c}
    for x in stream:
        if x in exact:
            exact[x] += 1
    thr = len(stream) / k
    return {cand: cnt for cand, cnt in exact.items() if cnt > thr}


if __name__ == "__main__":
    print(exact_heavy(["A","B","A","C","C","A","B","D","A"], 3))  # {'A': 4}
```

### Challenge 4 — Merge two summaries

> Implement `merge(S1, S2, k)`: add common counts, then prune by subtracting the `k`-th largest value, keeping ≤ `k - 1` entries.

#### Python

```python
def merge(s1, s2, k):
    c = dict(s1)
    for key, v in s2.items():
        c[key] = c.get(key, 0) + v
    if len(c) >= k:
        t = sorted(c.values(), reverse=True)[k - 1]   # k-th largest
        for key in list(c):
            c[key] -= t
            if c[key] <= 0:
                del c[key]
    return c


if __name__ == "__main__":
    a = {"X": 5, "Y": 3}
    b = {"X": 2, "Z": 4}
    print(merge(a, b, 3))   # prune to <= 2 entries; X dominates
```

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func merge(s1, s2 map[string]int, k int) map[string]int {
	c := map[string]int{}
	for key, v := range s1 {
		c[key] = v
	}
	for key, v := range s2 {
		c[key] += v
	}
	if len(c) >= k {
		vals := make([]int, 0, len(c))
		for _, v := range c {
			vals = append(vals, v)
		}
		sort.Sort(sort.Reverse(sort.IntSlice(vals)))
		t := vals[k-1]
		for key := range c {
			c[key] -= t
			if c[key] <= 0 {
				delete(c, key)
			}
		}
	}
	return c
}

func main() {
	a := map[string]int{"X": 5, "Y": 3}
	b := map[string]int{"X": 2, "Z": 4}
	fmt.Println(merge(a, b, 3))
}
```

#### Java

```java
import java.util.*;

public class MergeMG {
    static Map<String,Integer> merge(Map<String,Integer> s1, Map<String,Integer> s2, int k) {
        Map<String,Integer> c = new HashMap<>(s1);
        for (var e : s2.entrySet()) c.merge(e.getKey(), e.getValue(), Integer::sum);
        if (c.size() >= k) {
            List<Integer> vals = new ArrayList<>(c.values());
            vals.sort(Collections.reverseOrder());
            int t = vals.get(k - 1);
            Iterator<Map.Entry<String,Integer>> it = c.entrySet().iterator();
            while (it.hasNext()) {
                var e = it.next();
                int nv = e.getValue() - t;
                if (nv <= 0) it.remove(); else e.setValue(nv);
            }
        }
        return c;
    }

    public static void main(String[] args) {
        Map<String,Integer> a = new HashMap<>(Map.of("X",5,"Y",3));
        Map<String,Integer> b = new HashMap<>(Map.of("X",2,"Z",4));
        System.out.println(merge(a, b, 3));
    }
}
```

---

## Next step: [tasks.md](./tasks.md) — graded practice tasks (beginner, intermediate, advanced) in Go, Java, and Python, plus a benchmark task.

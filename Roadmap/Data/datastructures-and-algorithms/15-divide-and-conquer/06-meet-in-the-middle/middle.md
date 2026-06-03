# Meet in the Middle (MITM) — Middle Level

> **Focus:** the three combine strategies (sort + two-pointer, sort + binary search, hashing) and when each wins; the counting variants ("how many subsets sum to `S`", "how many are `≤ S`"); the classic 4-sum problem; bidirectional BFS as MITM on graphs; baby-step giant-step for discrete logarithm; and how MITM compares to dynamic programming and pure brute force.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts: The Three Combine Strategies](#deeper-concepts-the-three-combine-strategies)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Counting Variants](#counting-variants)
5. [The 4-Sum Problem](#the-4-sum-problem)
6. [Bidirectional BFS as MITM on Graphs](#bidirectional-bfs-as-mitm-on-graphs)
7. [Baby-Step Giant-Step (Discrete Logarithm)](#baby-step-giant-step-discrete-logarithm)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was a single idea: split an `O(2^n)` search into two halves, enumerate `2^(n/2)` subset sums each, and combine. At middle level you start asking the engineering questions that decide whether your MITM solution is correct *and* fast:

- The combine step can be done three ways — **two-pointer**, **binary search**, or **hashing**. Which is right for *detection* vs *counting* vs *closest-to-`S`*?
- How do you count "how many subsets sum to exactly `S`" or "how many are `≤ S`" without double-counting duplicates?
- How does the same split-and-combine idea solve **4-sum** (four arrays, one element each, summing to zero)?
- Why is **bidirectional BFS** — searching forward from the start and backward from the goal — the *graph* version of MITM, and why does it cut `O(b^d)` to `O(b^(d/2))`?
- How does **baby-step giant-step** turn a discrete-logarithm search from `O(p)` to `O(√p)` by the very same "two lists meet in the middle" trick?
- When should you reach for MITM at all, versus a pseudo-polynomial DP or plain brute force?

These are the questions that separate "I memorized split-and-combine" from "I can pick the right combine and recognize MITM in disguise."

---

## Deeper Concepts: The Three Combine Strategies

After enumerating `sumsL` and `sumsR` (each of size `2^(n/2)`), the combine step answers the actual question. There are three canonical implementations, and choosing the wrong one either costs an unnecessary `log` factor or gets the counting wrong.

### Strategy A — Hashing (best for plain existence)

Put `sumsL` into a hash set. For each `b ∈ sumsR`, test whether `S − b` is present.

```
existence:  O(2^(n/2)) average time, O(2^(n/2)) space
```

Hashing is the simplest and fastest for a yes/no question. It is *not* ideal when you need ordering (closest-to-`S`) or when you must count `≤ S` (a hash set has no range query).

### Strategy B — Sort + Binary Search (best for closest / largest ≤ S)

Sort `sumsL`. For each `b ∈ sumsR`, binary-search `sumsL` for `S − b`. To find the **largest subset sum `≤ S`**, binary-search for the predecessor of `S − b` and track the running maximum `a + b`.

```
closest / largest ≤ S:  O(2^(n/2) · log(2^(n/2))) = O(2^(n/2) · n)
```

The `log` factor buys you *order-aware* queries that hashing cannot do.

### Strategy C — Sort Both + Two-Pointer (best for counting)

Sort both lists. To **count pairs with `a + b ≤ S`**: put pointer `i` at the start of `sumsL` (ascending) and pointer `j` at the end of `sumsR` (descending). If `sumsL[i] + sumsR[j] ≤ S`, then *all* `j' ≤ j` also satisfy it for this `i`, so add `j + 1` to the count and advance `i`; otherwise decrement `j`. One linear sweep.

```
count ≤ S after sort:  O(2^(n/2))  (the sort dominates at O(2^(n/2) · n))
```

The two-pointer sweep is the elegant choice for counting because it tallies an entire suffix per step instead of probing one value at a time.

| Combine | Detect exact | Count exact | Largest ≤ S | Count ≤ S | Cost (post-enumeration) |
|---------|:---:|:---:|:---:|:---:|---|
| Hashing | ✅ | ✅ (with counts map) | ❌ | ❌ | `O(2^(n/2))` avg |
| Sort + binary search | ✅ | ✅ | ✅ | ✅ | `O(2^(n/2) · n)` |
| Sort both + two-pointer | ✅ | ✅ | — | ✅ | `O(2^(n/2))` after sort |

---

## Comparison with Alternatives

### MITM vs brute force vs dynamic programming

The three classic ways to attack subset sum each shine in a different regime, governed by `n` (item count) and `W` (the magnitude of the target / sum).

| Approach | Time | Space | Good when |
|----------|------|-------|-----------|
| Brute force (all subsets) | `O(2^n · n)` | `O(1)` | `n ≤ 20` |
| **Meet in the middle** | `O(2^(n/2) · n)` | `O(2^(n/2))` | `30 ≤ n ≤ 50`, **huge** weights |
| Pseudo-polynomial DP | `O(n · W)` | `O(W)` | weights/target `W` small (≤ ~10^6) |

The deciding question is **"are the weights small?"**:

- If `W` (target or total sum) is small — say `≤ 10^6` — the `O(n·W)` boolean DP wins easily, even for `n = 1000`. MITM cannot compete because it ignores `W` and pays `2^(n/2)`.
- If `W` is **huge** (e.g. weights up to `10^15`) the DP table cannot even be allocated, and `n` is the only thing that is small (≤ 40–50). This is exactly MITM's home turf — it is *insensitive to weight magnitude*.
- If `n ≤ 20`, brute force is simpler and just as fast; no need for MITM's extra machinery.

Concrete decision: `n = 40`, weights up to `10^12`.
- Brute force: `2^40 ≈ 10^12` ops — too slow.
- DP: table of size `10^12` — cannot allocate.
- MITM: `2^20 ≈ 10^6` per half, total ~`2 × 10^7` ops — **instant**.

That single scenario is why MITM exists: it is the only one of the three that handles *large `n` and large `W` simultaneously* (for small `n`).

### MITM vs bidirectional search vs unidirectional BFS

| Approach | Time | When |
|----------|------|------|
| Unidirectional BFS | `O(b^d)` | small depth `d`, or only the start is known |
| **Bidirectional BFS (MITM on graphs)** | `O(b^(d/2))` | both start and goal known, large `d` |

Same square-root flavor: a frontier of `b^d` becomes two frontiers of `b^(d/2)` that meet in the middle.

---

## Counting Variants

Detection ("does *some* subset reach `S`?") is the easy case. Counting is subtler because **duplicate sums** must be counted with their multiplicities.

### Count subsets summing to exactly `S`

For each distinct left sum `a`, the number of right sums equal to `S − a` is its multiplicity. Build a frequency map of `sumsL` (value → count). Then `answer = Σ_{b ∈ sumsR} freqL[S − b]`. Every right sum contributes `freqL[S − b]` pairs, so duplicates on both sides are handled automatically.

### Count subsets with sum `≤ S`

Sort both lists and run the two-pointer suffix-count sweep described in Strategy C. Each step that satisfies `sumsL[i] + sumsR[j] ≤ S` adds the *entire* remaining prefix of `sumsR` (`j + 1` elements) to the count, because the list is sorted. This is the standard way to answer "how many subsets have sum at most `S`" in `O(2^(n/2))` after the sort.

> **Why the suffix trick is correct:** with `sumsR` sorted ascending and pointer `j` scanning from the top, once `sumsL[i] + sumsR[j] ≤ S` holds, *every* `sumsR[0..j]` is `≤ sumsR[j]`, so all of them also satisfy the bound for this `i`. Adding `j + 1` counts them in one step.

### Maximum subset sum `≤ S` (the optimization version)

This is "0/1 knapsack with capacity `S` but huge weights." Sort `sumsR` ascending. For each `a ∈ sumsL` with `a ≤ S`, binary-search `sumsR` for the largest `b ≤ S − a`, and track `max(a + b)`. The answer is the best subset sum that does not exceed the capacity — the MITM solution to knapsack when `n` is small but weights are too large for the `O(n·W)` table.

---

## The 4-Sum Problem

**Problem.** Given four integer arrays `A, B, C, D`, count the number of tuples `(i, j, k, l)` with `A[i] + B[j] + C[k] + D[l] = 0`.

The brute force is `O(N^4)`. MITM splits the four arrays into **two pairs**:

- Left pair `(A, B)`: enumerate all `A[i] + B[j]` sums — `N²` of them.
- Right pair `(C, D)`: enumerate all `C[k] + D[l]` sums — `N²` of them.

Now count pairs `(ab, cd)` with `ab + cd = 0`, i.e. `cd = −ab`. Hash all left sums into a frequency map; for each right sum `cd`, add `freq[−cd]`. Total `O(N²)` time and space — the square root, in exponent, of the `O(N^4)` brute force.

```
4-sum = 0:
    leftSums  = { A[i] + B[j] : all i, j }   (N² values, in a freq map)
    rightSums = { C[k] + D[l] : all k, l }   (N² values)
    count = Σ over cd in rightSums of  freq[-cd]
    # O(N²) time, O(N²) space  (vs O(N^4) brute force)
```

This is the canonical interview MITM problem (LeetCode "4Sum II"). The split is "two arrays at a time" rather than "half the bits," but the principle is identical: enumerate two independent halves, combine by complement lookup.

---

## Bidirectional BFS as MITM on Graphs

When you must find the shortest path between a **known start `s`** and a **known goal `g`** in a graph with branching factor `b` and shortest-path length `d`, ordinary BFS explores `O(b^d)` nodes. **Bidirectional BFS** runs two BFS frontiers simultaneously — one forward from `s`, one backward from `g` — and stops when they **meet**. Each frontier only has to reach depth `d/2`, so the total work is `O(b^(d/2))` — the same square-root speedup as subset-sum MITM, applied to a graph search.

```
forward frontier from s   →→→   |   ←←←   backward frontier from g
        depth 0..d/2            meet            depth d..d/2
        O(b^(d/2)) nodes      in middle      O(b^(d/2)) nodes
```

Key correctness point: alternate expanding the **smaller** frontier, and on each expansion check whether any newly discovered node is already visited by the *other* side. The first such collision gives a shortest path (its length is `dist_forward[v] + dist_backward[v]`); for unweighted graphs, the first meeting is optimal once you expand the frontiers level by level and check all nodes at the meeting level.

This is genuinely MITM: "all states reachable in `d/2` steps from the start" is the left list, "all states reachable in `d/2` steps backward from the goal" is the right list, and the meeting node is the combine match.

---

## Baby-Step Giant-Step (Discrete Logarithm)

**Problem.** In a cyclic group (e.g. integers mod a prime `p` under multiplication), given a base `a` and a target `b`, find `x` with `a^x ≡ b (mod p)`. Brute force tries `x = 0, 1, 2, …` up to `p`, which is `O(p)`.

Baby-step giant-step (BSGS) is a number-theoretic MITM. Write `x = i·m − j` where `m = ⌈√p⌉`, `0 ≤ i ≤ m`, `0 ≤ j < m`. Then `a^x = b` becomes:

```
a^(i·m − j) ≡ b      ⟺      a^(i·m) ≡ b · a^j   (mod p)
```

The left side ranges over `i = 0..m` ("giant steps" of size `m`), the right side over `j = 0..m−1` ("baby steps" of size 1). The two sides are two lists of size `√p` that must **meet**:

1. **Baby steps:** compute `b · a^j (mod p)` for `j = 0 .. m−1`, store each in a hash map `value → j`. (`√p` entries.)
2. **Giant steps:** compute `a^(i·m) (mod p)` for `i = 0, 1, 2, …`. For each, look it up in the map; a hit gives `a^(i·m) = b·a^j`, so `x = i·m − j`.

```
x = i·m − j,   m = ⌈√p⌉
baby:  map[ b · a^j mod p ] = j     for j in 0..m-1     (√p inserts)
giant: for i in 0..m:                                   (√p lookups)
           if a^(i·m) mod p in map: return i·m − map[...]
# O(√p) time and space — square root of the O(p) brute force
```

The whole search collapses from `O(p)` to `O(√p)` — exactly the MITM square-root, achieved by matching a list of baby steps against a list of giant steps. This is the discrete-log workhorse behind small-group attacks and is the number-theory face of the very same technique.

---

## Code Examples

### Count subsets with sum ≤ S (two-pointer combine)

This is the MITM solution to "how many subsets have sum at most `S`," and the core of max-subset-sum-≤-S (knapsack with huge weights).

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func subsetSums(items []int64) []int64 {
	out := []int64{0}
	for _, x := range items {
		cur := make([]int64, len(out))
		copy(cur, out)
		for _, s := range cur {
			out = append(out, s+x)
		}
	}
	return out
}

// countLeqS counts subsets of arr whose sum is ≤ S.
func countLeqS(arr []int64, S int64) int64 {
	mid := len(arr) / 2
	left := subsetSums(arr[:mid])
	right := subsetSums(arr[mid:])
	sort.Slice(left, func(i, j int) bool { return left[i] < left[j] })
	sort.Slice(right, func(i, j int) bool { return right[i] < right[j] })
	var count int64
	j := len(right) - 1
	for i := 0; i < len(left); i++ {
		for j >= 0 && left[i]+right[j] > S {
			j--
		}
		if j < 0 {
			break
		}
		count += int64(j + 1) // all right[0..j] pair with left[i]
	}
	return count
}

func main() {
	arr := []int64{3, 34, 4, 12, 5, 2}
	fmt.Println(countLeqS(arr, 10)) // number of subsets summing to ≤ 10
}
```

#### Java

```java
import java.util.*;

public class CountLeqS {

    static long[] subsetSums(long[] items) {
        long[] out = {0};
        for (long x : items) {
            long[] cur = Arrays.copyOf(out, out.length * 2);
            for (int i = 0; i < out.length; i++) cur[out.length + i] = out[i] + x;
            out = cur;
        }
        return out;
    }

    static long countLeqS(long[] arr, long S) {
        int mid = arr.length / 2;
        long[] left = subsetSums(Arrays.copyOfRange(arr, 0, mid));
        long[] right = subsetSums(Arrays.copyOfRange(arr, mid, arr.length));
        Arrays.sort(left);
        Arrays.sort(right);
        long count = 0;
        int j = right.length - 1;
        for (int i = 0; i < left.length; i++) {
            while (j >= 0 && left[i] + right[j] > S) j--;
            if (j < 0) break;
            count += (j + 1);
        }
        return count;
    }

    public static void main(String[] args) {
        long[] arr = {3, 34, 4, 12, 5, 2};
        System.out.println(countLeqS(arr, 10));
    }
}
```

#### Python

```python
def subset_sums(items):
    out = [0]
    for x in items:
        out += [s + x for s in out]
    return out


def count_leq_s(arr, S):
    mid = len(arr) // 2
    left = sorted(subset_sums(arr[:mid]))
    right = sorted(subset_sums(arr[mid:]))
    count = 0
    j = len(right) - 1
    for a in left:
        while j >= 0 and a + right[j] > S:
            j -= 1
        if j < 0:
            break
        count += j + 1            # all right[0..j] pair with a
    return count


if __name__ == "__main__":
    arr = [3, 34, 4, 12, 5, 2]
    print(count_leq_s(arr, 10))
```

### 4-Sum II (count tuples summing to zero)

#### Python

```python
from collections import Counter


def four_sum_count(A, B, C, D):
    left = Counter(a + b for a in A for b in B)   # N² sums
    total = 0
    for c in C:
        for d in D:
            total += left[-(c + d)]               # complement lookup
    return total


if __name__ == "__main__":
    print(four_sum_count([1, 2], [-2, -1], [-1, 2], [0, 2]))  # 2
```

### Baby-step giant-step (discrete log)

#### Python

```python
def bsgs(a, b, p):
    """Return smallest x >= 0 with a^x ≡ b (mod p), or None. p prime, a not div by p."""
    import math
    m = int(math.isqrt(p - 1)) + 1
    # baby steps: b * a^j  for j = 0..m-1
    table = {}
    cur = b % p
    for j in range(m):
        table.setdefault(cur, j)
        cur = (cur * a) % p
    # giant steps: a^(i*m)
    am = pow(a, m, p)                  # a^m
    giant = 1
    for i in range(m + 1):
        if giant in table:
            x = i * m - table[giant]
            if x >= 0:
                return x
        giant = (giant * am) % p
    return None


if __name__ == "__main__":
    # 2^x ≡ 22 (mod 29);  2^x cycles, answer x = ?
    print(bsgs(2, 22, 29))            # some x with 2^x % 29 == 22
```

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func powmod(a, e, mod int64) int64 {
	a %= mod
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

// bsgs returns smallest x with a^x ≡ b (mod p), or -1.
func bsgs(a, b, p int64) int64 {
	m := int64(math.Sqrt(float64(p-1))) + 1
	table := make(map[int64]int64)
	cur := b % p
	for j := int64(0); j < m; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % p
	}
	am := powmod(a, m, p)
	giant := int64(1)
	for i := int64(0); i <= m; i++ {
		if j, ok := table[giant]; ok {
			x := i*m - j
			if x >= 0 {
				return x
			}
		}
		giant = giant * am % p
	}
	return -1
}

func main() {
	fmt.Println(bsgs(2, 22, 29))
}
```

#### Java

```java
import java.util.*;

public class BSGS {
    static long powmod(long a, long e, long mod) {
        a %= mod;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static long bsgs(long a, long b, long p) {
        long m = (long) Math.sqrt(p - 1) + 1;
        Map<Long, Long> table = new HashMap<>();
        long cur = b % p;
        for (long j = 0; j < m; j++) {
            table.putIfAbsent(cur, j);
            cur = cur * a % p;
        }
        long am = powmod(a, m, p);
        long giant = 1;
        for (long i = 0; i <= m; i++) {
            Long j = table.get(giant);
            if (j != null) {
                long x = i * m - j;
                if (x >= 0) return x;
            }
            giant = giant * am % p;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(bsgs(2, 22, 29));
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Counting double-counts or under-counts | Stopped at first match, or ignored multiplicities. | Use a frequency map (exact) or the suffix two-pointer (`≤ S`). |
| 4-sum overflow | `A[i]+B[j]` of large ints overflows 32-bit. | Use 64-bit sums; in Java cast before adding. |
| BSGS misses `x = 0` | Did not include `i = 0` / `giant = 1`. | Loop `i` from `0`; initialize `giant = 1`. |
| BSGS wrong on non-prime / non-coprime | `a` shares a factor with the modulus. | Standard BSGS needs `gcd(a, p) = 1`; handle composite moduli separately. |
| Bidirectional BFS expands wrong side | Always expanding the forward frontier. | Always expand the **smaller** frontier to balance work. |
| Bidirectional BFS reports non-shortest path | Stopped on first touch without level discipline. | Expand level by level; the first meeting level gives the shortest distance. |
| Two-pointer counts wrong | Did not sort both lists, or moved pointers in the wrong direction. | Sort both; advance `i` up, `j` down; add the whole suffix. |

---

## Performance Analysis

| `n` | brute force `2^n` | MITM `2^(n/2)` per half | memory (int64 list) |
|-----|-------------------|--------------------------|---------------------|
| 20 | ~1 M | ~1 K | ~8 KB |
| 30 | ~1 G | ~33 K | ~256 KB |
| 40 | ~10^12 | ~1 M | ~8 MB |
| 50 | ~10^15 | ~33 M | ~256 MB |
| 60 | ~10^18 | ~1 G | ~8 GB (infeasible) |

The dominant cost is the `O(2^(n/2))` enumeration and combine; the `log` or `n` factor from sorting/binary-search is secondary. The hard wall is **memory**: by `n = 60` the per-half list is `2^30 ≈ 10^9` entries (~8 GB), which is the practical ceiling. For 4-sum the table is in `N` (the array length), not bits: `O(N²)` for arrays of length `N`.

```python
import time, random

def benchmark(n):
    arr = [random.randint(1, 10**12) for _ in range(n)]
    start = time.perf_counter()
    _ = count_leq_s(arr, 5 * 10**12)
    return time.perf_counter() - start

# Typical: n=40 finishes in a fraction of a second; n=50 in a few seconds (memory-bound).
```

The single biggest constant-factor win is building the half-lists **incrementally** (each element doubles the list, total `O(2^(n/2))`) instead of recomputing each subset sum from scratch (`O(2^(n/2) · n/2)`).

---

## Best Practices

- **Pick the combine to match the query:** hashing for existence, sort+binary-search for closest/largest-≤-S, sort+two-pointer for counting.
- **Count with multiplicities:** use a frequency map for exact-`S` counting and the suffix two-pointer for `≤ S` counting; never stop at the first match.
- **Split evenly** (`⌈n/2⌉`, `⌊n/2⌋`); an unbalanced split is dominated by the larger half.
- **Recognize MITM in disguise:** 4-sum (split into two pairs), bidirectional BFS (two frontiers), BSGS (baby vs giant steps) are all the same square-root idea.
- **Choose MITM only when weights are huge and `n` is small;** if `W` is small prefer `O(n·W)` DP, and if `n ≤ 20` prefer brute force.
- **Always validate against a brute-force oracle** on random small inputs before trusting the MITM result on large `n`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The split into left and right halves and the `2^(n/2)` subset sums of each.
> - The sort of one side and the two-pointer / binary-search sweep that finds `a + b = S`.
> - The "meeting" of the two halves — the matched pair lighting up green when the complement is found.

---

## Summary

The middle-level mastery of meet in the middle is about the **combine** and **recognition**. The combine has three faces: hashing for plain existence (`O(2^(n/2))`), sort + binary search for order-aware queries like closest-to-`S` and largest-≤-`S` (`O(2^(n/2) · n)`), and sort both + two-pointer for counting pairs `≤ S` (`O(2^(n/2))` after the sort). Counting demands care with duplicate sums — use frequency maps or the suffix two-pointer. The same split-and-combine idea, once recognized, appears as **4-sum** (split four arrays into two pairs, `O(N^4) → O(N²)`), **bidirectional BFS** (two frontiers meeting, `O(b^d) → O(b^(d/2))`), and **baby-step giant-step** (baby vs giant steps meeting, `O(p) → O(√p)`). And the strategic call — MITM vs DP vs brute force — comes down to one question: is `n` small while the weights are huge? If yes, MITM is the only tool that handles both. Master the combine and learn to spot the disguises, and a whole family of square-root algorithms opens up.


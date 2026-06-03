# Knapsack DP — Middle Level

> **Focus:** Why the 1D array must iterate capacity *descending* for 0/1 but *ascending* for unbounded, how bounded/multiple knapsack is solved with **binary splitting** of item counts, how to reconstruct chosen items cheaply, and how subset-sum, partition, and fractional knapsack relate to the same core recurrence.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Subset-Sum and Partition as Knapsack](#subset-sum-and-partition-as-knapsack)
6. [Fractional Knapsack: Greedy, Not DP](#fractional-knapsack-greedy-not-dp)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single recurrence: `dp[i][w] = max(skip, take)`, filled into a 2D table in `O(n·W)`. At middle level you start asking the engineering questions that decide whether your solution is correct *and* fast:

- The 2D table only ever reads the previous row. How do we collapse it to one row — and why does the iteration *direction* flip between the 0/1 and unbounded variants?
- An item is available in `c[i]` copies (bounded knapsack). Looping `c[i]` times per item is `O(n·W·max_c)`. How does **binary splitting** cut that to `O(n·W·log max_c)`?
- The 1D array discards the history needed to reconstruct chosen items. How do we recover the selection without the full 2D table?
- Subset-sum, partition, and "make exact change" all look like knapsack. What is the precise mapping, and what changes (max vs Boolean vs count)?
- Fractional knapsack is solved by a *greedy* algorithm in `O(n log n)` — faster than DP. Why does greedy work there but fail for 0/1?

These are the distinctions that separate "I memorized the table" from "I can pick the right knapsack variant and the right representation for the problem in front of me."

---

## Deeper Concepts

### From 2D to 1D: the rolling array

The recurrence `dp[i][w]` depends only on `dp[i-1][·]` (the row above). So instead of `n+1` rows, keep a single array `dp[w]` and update it in place for each item. The subtlety is **which order** to sweep `w`, because in 1D the array simultaneously holds "old" (previous-item) and "new" (current-item) values.

```
dp[w]  before processing item i  =  dp[i-1][w]   (old)
dp[w]  after  processing item i  =  dp[i][w]     (new)
```

When we compute `dp[w] = max(dp[w], v[i] + dp[w - w[i]])`, the term `dp[w - w[i]]` must still be the **old** value (from item `i-1`) for the 0/1 problem — because item `i` may be used at most once, and `dp[w - w[i]]` represents "the rest of the bag, *without* item `i`."

### Why 0/1 iterates capacity DESCENDING

If we sweep `w` from high to low, then when we read `dp[w - w[i]]`, the index `w - w[i] < w` has **not yet been overwritten** this pass — it still holds the old (item-`i-1`) value. Exactly what 0/1 needs.

```
for i in items:
    for w from W down to w[i]:        # DESCENDING
        dp[w] = max(dp[w], v[i] + dp[w - w[i]])
```

If you sweep ascending instead, `dp[w - w[i]]` would already be the *new* value (it includes item `i`), so item `i` could be added again — silently turning 0/1 into unbounded. This is the single most common knapsack bug.

### Why unbounded iterates capacity ASCENDING

Unbounded knapsack *wants* an item to be reusable. So we deliberately read the **new** `dp[w - w[i]]` (which may already include copies of item `i`):

```
for i in items:
    for w from w[i] up to W:          # ASCENDING
        dp[w] = max(dp[w], v[i] + dp[w - w[i]])
```

Here `dp[w - w[i]]` is the current-pass value, allowing item `i` to be chained as many times as fits. The direction flip is the *entire* difference between 0/1 and unbounded in 1D code.

| Variant | 1D inner loop direction | Effect |
|---------|-------------------------|--------|
| 0/1 (each item once) | `w` from `W` down to `w[i]` | reads old row → item used at most once |
| Unbounded (unlimited) | `w` from `w[i]` up to `W` | reads new row → item reusable |

### Bounded (multiple) knapsack and binary splitting

In **bounded knapsack** each item has a count `c[i]`: you may take `0, 1, …, c[i]` copies. The naive fix is to treat each copy as a separate 0/1 item — `c[i]` copies — giving `O(n·W·max_c)`. When counts are large (say `c[i] = 1000`), that is far too slow.

**Binary splitting** is the key trick. Any count `c` can be represented as a sum of powers of two plus a remainder: `1, 2, 4, …, 2^{k}, r` where `r = c - (2^{k+1} - 1)`. Each "chunk" of size `m` becomes a single pseudo-item with weight `m·w[i]` and value `m·v[i]`, handled by ordinary 0/1. Because you can form *any* count from 0 to `c` by choosing a subset of these chunks, this is exact — and there are only `O(log c)` chunks per item.

```
split c into chunks: 1, 2, 4, ..., 2^k, remainder
each chunk m  →  0/1 pseudo-item (weight m*w[i], value m*v[i])
total pseudo-items: O(n log max_c)  →  overall O(n·W·log max_c)
```

For example `c = 13 = 1 + 2 + 4 + 6` (chunks `1, 2, 4`, remainder `6`). With chunks `{1,2,4,6}` you can hit every count `0..13` by picking a subset (e.g. `5 = 1 + 4`, `11 = 1 + 4 + 6`). There is also a more advanced `O(n·W)` monotonic-deque method (sliding-window max over residue classes), noted in `senior.md`; binary splitting is the standard, easy-to-get-right choice.

### Reconstruction without the full 2D table

The 1D array forgets which items were taken. Two options:

1. **Keep the 2D table** (or just the take/skip decision bits). Memory `O(n·W)` but reconstruction is the simple back-trace from `junior.md`.
2. **Store a parent/decision array** per item per capacity (a single bit `took[i][w]`), which is `O(n·W)` bits — much smaller than full integers but still `O(n·W)`.
3. **Hirschberg-style divide and conquer** reconstructs in `O(n·W)` time and `O(W)` space by splitting the item set in half and finding the optimal capacity split — overkill for most uses but worth knowing when `n·W` integers will not fit but `n·W` *bits* will not either.

For the common case, keep the 2D table when you need the items and use the 1D array when you only need the value.

---

## Comparison with Alternatives

### Knapsack variants side by side

| Variant | Per-item copies | Best approach | Time | 1D loop direction |
|---------|-----------------|---------------|------|-------------------|
| 0/1 | exactly 0 or 1 | take-or-skip DP | `O(n·W)` | descending |
| Unbounded | 0 .. ∞ | reuse DP | `O(n·W)` | ascending |
| Bounded | 0 .. `c[i]` | binary splitting → 0/1 | `O(n·W·log max_c)` | descending |
| Fractional | any real fraction | greedy by ratio | `O(n log n)` | — (not DP) |
| Subset-sum | 0 or 1, value=weight | Boolean DP | `O(n·S)` | descending |

### DP vs brute force vs meet-in-the-middle (preview)

| Approach | Time | Good when |
|----------|------|-----------|
| Brute force (all subsets) | `O(2^n)` | `n ≤ ~20`, any `W` |
| 0/1 DP table | `O(n·W)` | `W` small/medium, integer weights |
| Meet-in-the-middle | `O(2^{n/2} · n)` | `n ≤ ~40`, `W` huge (see `senior.md`) |
| Value-indexed DP | `O(n·V_total)` | values small, `W` huge (see `senior.md`) |

Concrete table (`n = 40`):

| `W` | 0/1 DP ops (`n·W`) | MITM ops (`2^{n/2}·n`) | Winner |
|------|--------------------|------------------------|--------|
| 1 000 | 40 000 | ~42 M | DP |
| 10⁶ | 4·10⁷ | ~42 M | DP (close) |
| 10⁹ | 4·10¹⁰ | ~42 M | MITM |
| 10¹⁵ | infeasible | ~42 M | MITM |

The lesson: pick the method by which input dimension is small. Small `W` → table DP. Small `n`, huge `W` → meet-in-the-middle. Small total *value*, huge `W` → value-indexed DP. (The last two are developed in `senior.md`.)

---

## Advanced Patterns

### Pattern: 0/1 knapsack, 1D array (descending)

#### Go

```go
package main

import "fmt"

func knapsack01(weight, value []int, W int) int {
	dp := make([]int, W+1)
	for i := range weight {
		wi, vi := weight[i], value[i]
		for w := W; w >= wi; w-- { // DESCENDING for 0/1
			if cand := dp[w-wi] + vi; cand > dp[w] {
				dp[w] = cand
			}
		}
	}
	return dp[W]
}

func main() {
	fmt.Println(knapsack01([]int{2, 3, 4}, []int{3, 4, 5}, 5)) // 7
}
```

#### Java

```java
public class Knapsack01_1D {
    static int knapsack01(int[] weight, int[] value, int W) {
        int[] dp = new int[W + 1];
        for (int i = 0; i < weight.length; i++) {
            int wi = weight[i], vi = value[i];
            for (int w = W; w >= wi; w--) {        // DESCENDING for 0/1
                dp[w] = Math.max(dp[w], dp[w - wi] + vi);
            }
        }
        return dp[W];
    }

    public static void main(String[] args) {
        System.out.println(knapsack01(new int[]{2, 3, 4}, new int[]{3, 4, 5}, 5)); // 7
    }
}
```

#### Python

```python
def knapsack01(weight, value, W):
    dp = [0] * (W + 1)
    for wi, vi in zip(weight, value):
        for w in range(W, wi - 1, -1):    # DESCENDING for 0/1
            cand = dp[w - wi] + vi
            if cand > dp[w]:
                dp[w] = cand
    return dp[W]


if __name__ == "__main__":
    print(knapsack01([2, 3, 4], [3, 4, 5], 5))  # 7
```

### Pattern: Unbounded knapsack, 1D array (ascending)

#### Go

```go
package main

import "fmt"

func unboundedKnapsack(weight, value []int, W int) int {
	dp := make([]int, W+1)
	for i := range weight {
		wi, vi := weight[i], value[i]
		for w := wi; w <= W; w++ { // ASCENDING for unbounded
			if cand := dp[w-wi] + vi; cand > dp[w] {
				dp[w] = cand
			}
		}
	}
	return dp[W]
}

func main() {
	// coins/items reusable; capacity 5
	fmt.Println(unboundedKnapsack([]int{2, 3, 4}, []int{3, 4, 5}, 5)) // 7 (item1 + item1 + ... )
}
```

#### Java

```java
public class UnboundedKnapsack {
    static int unbounded(int[] weight, int[] value, int W) {
        int[] dp = new int[W + 1];
        for (int i = 0; i < weight.length; i++) {
            int wi = weight[i], vi = value[i];
            for (int w = wi; w <= W; w++) {        // ASCENDING for unbounded
                dp[w] = Math.max(dp[w], dp[w - wi] + vi);
            }
        }
        return dp[W];
    }

    public static void main(String[] args) {
        System.out.println(unbounded(new int[]{2, 3, 4}, new int[]{3, 4, 5}, 5)); // 7
    }
}
```

#### Python

```python
def unbounded_knapsack(weight, value, W):
    dp = [0] * (W + 1)
    for wi, vi in zip(weight, value):
        for w in range(wi, W + 1):        # ASCENDING for unbounded
            cand = dp[w - wi] + vi
            if cand > dp[w]:
                dp[w] = cand
    return dp[W]


if __name__ == "__main__":
    print(unbounded_knapsack([2, 3, 4], [3, 4, 5], 5))  # 7
```

### Pattern: Bounded knapsack via binary splitting

#### Python

```python
def bounded_knapsack(weight, value, count, W):
    """Each item i is available 'count[i]' times. O(W * sum log count)."""
    dp = [0] * (W + 1)
    for wi, vi, ci in zip(weight, value, count):
        k = 1
        while ci > 0:
            take = min(k, ci)             # chunk of size 'take' copies
            cw, cv = take * wi, take * vi
            for w in range(W, cw - 1, -1):  # 0/1 over the pseudo-item
                cand = dp[w - cw] + cv
                if cand > dp[w]:
                    dp[w] = cand
            ci -= take
            k <<= 1                        # 1, 2, 4, 8, ...
    return dp[W]


if __name__ == "__main__":
    # item0: weight 2 value 3, up to 5 copies; item1: weight 3 value 4, up to 2
    print(bounded_knapsack([2, 3], [3, 4], [5, 2], 10))
```

#### Go

```go
package main

import "fmt"

func boundedKnapsack(weight, value, count []int, W int) int {
	dp := make([]int, W+1)
	for i := range weight {
		wi, vi, ci := weight[i], value[i], count[i]
		for k := 1; ci > 0; k <<= 1 {
			take := k
			if take > ci {
				take = ci
			}
			cw, cv := take*wi, take*vi
			for w := W; w >= cw; w-- {
				if cand := dp[w-cw] + cv; cand > dp[w] {
					dp[w] = cand
				}
			}
			ci -= take
		}
	}
	return dp[W]
}

func main() {
	fmt.Println(boundedKnapsack([]int{2, 3}, []int{3, 4}, []int{5, 2}, 10))
}
```

#### Java

```java
public class BoundedKnapsack {
    static int bounded(int[] weight, int[] value, int[] count, int W) {
        int[] dp = new int[W + 1];
        for (int i = 0; i < weight.length; i++) {
            int wi = weight[i], vi = value[i], ci = count[i];
            for (int k = 1; ci > 0; k <<= 1) {
                int take = Math.min(k, ci);
                int cw = take * wi, cv = take * vi;
                for (int w = W; w >= cw; w--) {
                    dp[w] = Math.max(dp[w], dp[w - cw] + cv);
                }
                ci -= take;
            }
        }
        return dp[W];
    }

    public static void main(String[] args) {
        System.out.println(bounded(new int[]{2, 3}, new int[]{3, 4},
                                   new int[]{5, 2}, 10));
    }
}
```

---

## Subset-Sum and Partition as Knapsack

### Subset-sum

"Given numbers, is there a subset summing to exactly `S`?" is 0/1 knapsack with `value[i] = weight[i] = nums[i]` and a Boolean table: `dp[s]` is true iff some subset hits sum `s`. The 1D version iterates descending (it is a 0/1 problem):

```python
def subset_sum(nums, S):
    dp = [False] * (S + 1)
    dp[0] = True
    for x in nums:
        for s in range(S, x - 1, -1):   # descending, 0/1
            dp[s] = dp[s] or dp[s - x]
    return dp[S]
```

To **count** the number of subsets that sum to `S`, replace the Boolean `or` with integer `+=` and start `dp[0] = 1`.

### Partition (equal subset sum)

"Can the items be split into two groups of equal total?" The total `T` must be even (else impossible), and then it is exactly subset-sum to `T/2`:

```python
def can_partition(nums):
    total = sum(nums)
    if total % 2 != 0:
        return False
    return subset_sum(nums, total // 2)
```

A natural extension, **minimum subset-sum difference**, asks for the partition that minimizes `|sum_A - sum_B|`. Run subset-sum up to `T/2`, find the largest reachable `s ≤ T/2`, and the answer is `T - 2s`. All of these are the same descending-sweep 0/1 DP with the value semantics swapped (max value → Boolean reachability → subset count).

### The unifying view

Notice that subset-sum, partition, counting, and the original max-value knapsack are all the *same* take-or-skip sweep over a 1D array — only the cell's combine operation changes:

| Problem | `dp[s]` holds | Combine on take |
|---------|---------------|-----------------|
| 0/1 max value | best value at capacity `s` | `dp[s] = max(dp[s], v + dp[s-w])` |
| Subset-sum | reachable? (Boolean) | `dp[s] = dp[s] or dp[s-x]` |
| Count subsets | number of ways | `dp[s] += dp[s-x]` |
| Min subset diff | reachable? then scan | Boolean, then read largest `s ≤ T/2` |

Recognizing this lets you write one sweep and swap the combine function rather than memorizing four algorithms. The descending direction (0/1) is shared by all of them because each input number is used at most once.

---

## Fractional Knapsack: Greedy, Not DP

The **fractional** variant allows taking any fraction `0 ≤ f ≤ 1` of each item, gaining `f·v[i]` value for `f·w[i]` weight. Unlike 0/1, this is solved **greedily** and optimally in `O(n log n)`: sort items by value-per-weight ratio `v[i]/w[i]` descending, then fill the bag with whole high-ratio items until one no longer fits, and take a *fraction* of that last item to top off the capacity exactly.

```python
def fractional_knapsack(weight, value, W):
    items = sorted(range(len(weight)),
                   key=lambda i: value[i] / weight[i], reverse=True)
    total = 0.0
    for i in items:
        if weight[i] <= W:
            total += value[i]            # take the whole item
            W -= weight[i]
        else:
            total += value[i] * (W / weight[i])  # take a fraction
            break
    return total
```

**Why greedy works here but fails for 0/1.** In the fractional problem, the "exchange argument" holds: if an optimal solution used a lower-ratio unit of weight where a higher-ratio unit was available, you could swap them and improve — so the highest-ratio-first packing is optimal. For 0/1, you cannot split items, so swapping is not free: a high-ratio item might be too heavy to fit, forcing a globally worse choice. The classic counterexample: weights `[10, 20, 30]`, values `[60, 100, 120]`, `W = 50`. Greedy by ratio takes item 0 then item 1 (value 160), but the optimal 0/1 choice is items 1 and 2 (value 220). Greedy is wrong for 0/1; only DP (or search) is exact. This contrast — greedy optimal for fractional, DP required for 0/1 — is a favorite interview discussion point.

---

## Code Examples

### Reusable knapsack toolkit (counting subset-sum)

This counts the number of subsets summing to each target — a single function that underlies subset-sum, partition, and "number of ways" problems.

#### Python

```python
def count_subsets_to_sum(nums, S):
    """Return dp where dp[s] = number of subsets of nums summing to s (0..S)."""
    dp = [0] * (S + 1)
    dp[0] = 1                              # one way: the empty subset
    for x in nums:
        for s in range(S, x - 1, -1):      # descending, 0/1
            dp[s] += dp[s - x]
    return dp


if __name__ == "__main__":
    dp = count_subsets_to_sum([1, 2, 3, 3], 6)
    print("subsets summing to 6:", dp[6])
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| 1D 0/1 swept ascending | Item reused → answer too large (became unbounded). | Sweep `w` **descending** for 0/1. |
| 1D unbounded swept descending | Item never reused → answer too small (became 0/1). | Sweep `w` **ascending** for unbounded. |
| Bounded by repeating item `c[i]` times | `O(n·W·max_c)` too slow for large counts. | Use binary splitting → `O(n·W·log max_c)`. |
| Subset-count overflow | Many subsets counted in fixed-width int. | Use 64-bit or take counts mod a prime. |
| Fractional solved with DP | Wasted work, and capacity not exactly filled. | Use the greedy ratio sort, `O(n log n)`. |
| Partition with odd total | Returned a subset-sum answer for `T/2` of a non-integer. | Check `total % 2 == 0` first; odd total → impossible. |

---

## Performance Analysis

| `n` | `W` | 0/1 DP ops (`n·W`) | Feasible? |
|-----|-----|--------------------|-----------|
| 100 | 1 000 | 100 000 | instant |
| 1 000 | 10 000 | 10 M | well under a second |
| 1 000 | 10⁶ | 10⁹ | a few seconds; consider 1D + tight loop |
| 100 | 10⁹ | 10¹¹ | infeasible → meet-in-the-middle (`senior.md`) |

The dominant cost is the `n·W` cell updates. The biggest practical wins at this level:

- **1D array** instead of 2D: better cache behavior and `O(W)` memory.
- **Tight inner bound** (`w ≥ w[i]`) skips guaranteed-no-op iterations.
- **Binary splitting** for bounded counts turns a `max_c` factor into `log max_c`.

```python
import time

def benchmark(n, W):
    import random
    rng = random.Random(0)
    weight = [rng.randint(1, 100) for _ in range(n)]
    value = [rng.randint(1, 1000) for _ in range(n)]
    start = time.perf_counter()
    _ = knapsack01(weight, value, W)
    return time.perf_counter() - start

# Typical: n=1000, W=10**4 -> ~0.0x s in CPython with the 1D descending loop.
```

---

## Best Practices

- **Pick the loop direction by variant:** descending = 0/1, ascending = unbounded. Comment it loudly.
- **Use 1D for value-only, 2D for item recovery.** Do not pay `O(n·W)` memory if you only need the number.
- **Binary-split bounded counts** rather than expanding every copy; it is the same answer for far less work.
- **Map subset-sum/partition to the Boolean (or counting) 0/1 DP**; do not write a separate algorithm.
- **Use greedy only for fractional**; never apply it to 0/1, and keep the ratio counterexample handy to explain why.
- **Always test against the brute-force subset oracle** on random small inputs.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The 2D `dp[i][w]` fill, with each cell showing its **skip** (cell above) and **take** (value + cell up-and-left) candidates.
> - The reconstruction back-trace from `dp[n][W]` to the chosen items.
> - The contrast you can reason about alongside it: in a 1D collapse, the descending sweep keeps `dp[w-w[i]]` "old" (0/1) versus an ascending sweep making it "new" (unbounded).

---

## Summary

The 1D rolling array is the workhorse of knapsack: it computes the same `O(n·W)` answer in `O(W)` memory, and the only thing that changes between variants is the *direction* of the capacity sweep — **descending for 0/1** (so `dp[w-w[i]]` stays the previous-item value, used at most once) and **ascending for unbounded** (so an item can be reused). **Bounded** knapsack handles per-item limits with **binary splitting**, turning a `max_c` factor into `log max_c`. Reconstruction of the chosen items needs the 2D table or a decision-bit array. **Subset-sum**, **partition**, and "count the ways" are all the same 0/1 sweep with the value semantics swapped to Boolean reachability or subset counting. And **fractional** knapsack stands apart: it is a *greedy* problem (sort by `v/w`, `O(n log n)`), optimal precisely because items can be split — the exchange argument that fails for 0/1. Master the direction flip, binary splitting, and the greedy-vs-DP boundary, and the whole knapsack family becomes one toolkit.

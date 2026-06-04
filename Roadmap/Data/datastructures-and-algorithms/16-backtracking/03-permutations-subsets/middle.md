# Generating Permutations, Subsets, and Combinations — Middle Level

> **Focus:** Getting **duplicate handling** exactly right (sort + skip equal siblings for subsets-II and permutations-II), the two flavors of **combination sum** (with and without repetition), **swap vs used-array** permutations and their trade-offs, lexicographic **next_permutation**, **Gray code**, and choosing the right tool by comparing them head to head.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Duplicate Handling Done Right](#duplicate-handling-done-right)
5. [Combination Sum Variants](#combination-sum-variants)
6. [Swap vs Used-Array Permutations](#swap-vs-used-array-permutations)
7. [Lexicographic next_permutation](#lexicographic-next_permutation)
8. [Gray Code](#gray-code)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was: backtracking is *choose → recurse → un-choose*, and the tree shape decides whether you get subsets, permutations, or combinations. At middle level the questions become sharper and more practical:

- The input has **repeated elements**. How do I emit each *distinct* answer exactly once — without deduping with a hash set afterward (which is slow and memory-hungry)?
- **Combination sum** comes in two flavors: each number can be used unlimited times, or each at most once. The single-line difference between them is a classic interview discriminator.
- Should I write permutations with a **`used[]` array** or with **in-place swaps**? They have different memory profiles and different ease of handling duplicates.
- How does the standard-library **`next_permutation`** actually work, and why is it `O(n)` per step with no recursion?
- What is **Gray code**, and why would I ever want subsets ordered so consecutive ones differ by a single element?

These are the questions that separate "I can write subsets from memory" from "I can pick the correct variant and prove it emits each answer once."

---

## Deeper Concepts

### Levels of the tree vs depth of the tree

Two different "directions" matter in a backtracking tree, and confusing them is the root of most duplicate-handling bugs:

- **Depth (vertical)** — how many choices you have committed so far. Reusing the *same* element deeper is forbidden by passing `i+1` (subsets/combinations) or by `used[]` (permutations).
- **Level / siblings (horizontal)** — the alternative choices at one node. Picking *equal-valued* siblings here is what creates duplicate answers when the input has repeats.

> **The duplicate rule in one sentence:** at a single tree level (the `for` loop of one call), never start two branches with the same value. That is "skip equal siblings."

### Why a hash-set dedup is the wrong instinct

The tempting fix for duplicates is: generate everything, throw it in a `Set`, done. It works but it is wasteful — you still *do* the exponential redundant work and then pay extra memory hashing canonical forms. The sort+skip approach **never generates** the duplicates in the first place, so it is both faster and lighter. Always prefer pruning over post-filtering.

### Counting distinct outputs

With repeats, the number of distinct results shrinks. For a multiset with element multiplicities `m₁, m₂, …`:

- Distinct **permutations** = `n! / (m₁! · m₂! · …)` (the multinomial coefficient). E.g. `[1,2,2]` has `3!/2! = 3`.
- Distinct **subsets** = `(m₁+1)(m₂+1)…` (each distinct value contributes 0..mᵢ copies). E.g. `[2,2,2]` has `3+1 = 4` subsets.

Your generator must hit exactly these counts — a great sanity test.

---

## Comparison with Alternatives

| Approach | Output | Extra space | Duplicate-friendly | Notes |
|----------|--------|-------------|--------------------|-------|
| Recursive include/exclude (subsets) | leaves only | O(n) stack | yes (sort+skip) | clean binary tree |
| Recursive start-index (subsets/combinations) | every node / size-k | O(n) stack | yes (sort+skip) | natural pruning |
| Bit enumeration (subsets) | iterative | O(1) | awkward (needs canonical mask) | best for small `n` |
| Used-array permutations | leaves | O(n) | yes (sort + `!used[i-1]`) | does not mutate input |
| Swap permutations | leaves | O(1) | trickier (needs seen-set per level) | mutates input, fastest |
| `next_permutation` loop | one at a time | O(1) | naturally skips dups | streaming, lexicographic |
| Gray code | iterative | O(1) | n/a | single-element-change ordering |
| Generate-then-dedup with a Set | all + filter | O(output) | yes but wasteful | avoid; does redundant work |

**Rule of thumb:** for plain subsets and small `n`, bit enumeration. For combinations, start-index with pruning. For permutations you must extend to duplicates, used-array (the `!used[i-1]` skip is the cleanest). For streaming one permutation at a time (memory-bounded), `next_permutation`.

---

## Duplicate Handling Done Right

### Subsets-II (input may repeat)

Sort, then in each call's loop skip a value equal to its immediate left sibling:

```
sort(nums)
subsets(start, current):
    emit copy(current)
    for i in start..n-1:
        if i > start and nums[i] == nums[i-1]:
            continue                 # equal sibling already explored at this level
        current.append(nums[i])
        subsets(i+1, current)
        current.pop()
```

`i > start` is critical: the *first* occurrence at a level (where `i == start`) is allowed; later equal occurrences are skipped. This lets you pick `[2,2]` (going deeper) but never two *different sibling* `2`s that would yield the same `[2]`.

### Permutations-II (input may repeat)

Sort, then add a second condition to the used-array loop: only use the first *unused* copy of each value at a given depth.

```
sort(nums)
permute(current):
    if len(current)==n: emit copy(current); return
    for i in 0..n-1:
        if used[i]: continue
        if i > 0 and nums[i]==nums[i-1] and not used[i-1]:
            continue                 # the previous equal copy wasn't placed yet → skip
        used[i]=true; current.append(nums[i])
        permute(current)
        current.pop(); used[i]=false
```

The condition `nums[i]==nums[i-1] && !used[i-1]` enforces a canonical order among equal copies: copy `i` may be placed only after copy `i-1` has already been placed in this branch. That breaks the symmetry between identical elements so each distinct ordering is produced exactly once.

> **Why `!used[i-1]` and not `used[i-1]`?** Picture two identical `2`s. We force them to always be placed in left-to-right index order. If `i-1` is *not* yet used, then placing `i` first would later allow placing `i-1`, producing the *same* multiset arrangement reached the other way — so we skip. If `i-1` *is* used, we are correctly placing the second copy after the first. (Both `used[i-1]` and `!used[i-1]` variants can be made correct with the matching loop order; `!used[i-1]` is the standard, well-tested form.)

---

## Combination Sum Variants

Given candidates and a `target`, list all combinations summing to `target`.

### Without repetition (each candidate used at most once) — "Combination Sum II"

Sort; recurse with `i+1`; skip equal siblings (same rule as subsets-II); prune when the running sum exceeds target.

```
sort(candidates)
solve(start, remaining, current):
    if remaining == 0: emit copy(current); return
    for i in start..n-1:
        if i > start and candidates[i]==candidates[i-1]: continue   # skip dup sibling
        if candidates[i] > remaining: break                          # sorted → no further fits
        current.append(candidates[i])
        solve(i+1, remaining-candidates[i], current)                # i+1: use once
        current.pop()
```

### With repetition (each candidate reusable) — "Combination Sum"

Recurse with `i` (not `i+1`) so the same candidate can be chosen again; no dup-skip needed if candidates are distinct.

```
sort(candidates)               # distinct candidates
solve(start, remaining, current):
    if remaining == 0: emit copy(current); return
    for i in start..n-1:
        if candidates[i] > remaining: break        # prune
        current.append(candidates[i])
        solve(i, remaining-candidates[i], current) # i: reuse allowed
        current.pop()
```

> **The single discriminator:** recurse with **`i+1`** to use each candidate **once**, or with **`i`** to allow **reuse**. The `break` on `candidates[i] > remaining` (valid only because we sorted) is the key pruning that keeps both fast.

---

## Swap vs Used-Array Permutations

**Used-array:** does not mutate the input, easy to extend to duplicates, costs `O(n)` for the boolean array.

**Swap-based:** mutates the input array in place, `O(1)` extra space, slightly faster. To handle duplicates with swaps you need a per-level "seen value" set (you cannot use the `!used[i-1]` trick because swapping destroys the sorted adjacency):

```
permuteSwap(start):
    if start==n: emit copy(nums); return
    seen = empty set
    for i in start..n-1:
        if nums[i] in seen: continue   # skip duplicate value at this level
        seen.add(nums[i])
        swap(nums, start, i)
        permuteSwap(start+1)
        swap(nums, start, i)           # swap back
```

| Aspect | Used-array | Swap |
|--------|-----------|------|
| Extra space | O(n) | O(1) (O(n) per level for dup-set) |
| Mutates input | no | yes |
| Lexicographic order | yes (if input sorted) | **no** (swaps scramble order) |
| Duplicate handling | `!used[i-1]` (clean) | per-level seen-set |
| Typical choice | interviews, clarity | tight memory, no order needed |

If the problem demands **lexicographic** output, prefer used-array (with sorted input) or `next_permutation`; swap-based produces an arbitrary order.

---

## Lexicographic next_permutation

`next_permutation` transforms an array into the **next** permutation in lexicographic (dictionary) order, in place, in `O(n)`. It is how you stream permutations one at a time without recursion or storing them all. The algorithm (the same one in C++'s STL and Python via itertools logic):

```
next_permutation(a):
    # 1. find the largest i with a[i] < a[i+1] (the "pivot")
    i = n - 2
    while i >= 0 and a[i] >= a[i+1]: i -= 1
    if i < 0:                       # whole array descending → last permutation
        reverse(a); return false    # wrap around to the first (ascending)
    # 2. find the largest j > i with a[j] > a[i]
    j = n - 1
    while a[j] <= a[i]: j -= 1
    # 3. swap pivot with that successor
    swap(a, i, j)
    # 4. reverse the suffix after i (it was descending → make it ascending = smallest)
    reverse(a, i+1, n-1)
    return true
```

Starting from the sorted array and calling `next_permutation` until it returns false enumerates **all** permutations in lex order, and it **naturally skips duplicates** (because equal elements never produce a strictly-larger arrangement at the swap step). The correctness argument lives in `professional.md`; the intuition: you bump the rightmost position you can increase, then make everything after it as small as possible.

---

## Gray Code

A **Gray code** lists all `2^n` bit patterns so that **consecutive patterns differ in exactly one bit** — i.e. consecutive subsets differ by adding or removing a single element. The standard binary-reflected Gray code has a one-line formula:

```
gray(i) = i XOR (i >> 1)        # the i-th Gray code, for i in 0..2^n-1
```

So the sequence for `n=2` is `00, 01, 11, 10` (decimal `0,1,3,2`), each adjacent pair differing in one bit. Uses: minimizing state changes (mechanical encoders, Karnaugh maps), and generating subsets where each step is a cheap single toggle (useful when evaluating a function incrementally over subsets). To recover the integer from a Gray code, XOR-fold:

```
fromGray(g):
    n = g
    while g >>= 1: n ^= g
    return n
```

---

## Code Examples

### Subsets-II, Permutations-II, and both Combination Sums

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func subsetsWithDup(nums []int) [][]int {
	sort.Ints(nums)
	var res [][]int
	var cur []int
	var bt func(start int)
	bt = func(start int) {
		res = append(res, append([]int(nil), cur...))
		for i := start; i < len(nums); i++ {
			if i > start && nums[i] == nums[i-1] {
				continue
			}
			cur = append(cur, nums[i])
			bt(i + 1)
			cur = cur[:len(cur)-1]
		}
	}
	bt(0)
	return res
}

func permuteUnique(nums []int) [][]int {
	sort.Ints(nums)
	var res [][]int
	used := make([]bool, len(nums))
	var cur []int
	var bt func()
	bt = func() {
		if len(cur) == len(nums) {
			res = append(res, append([]int(nil), cur...))
			return
		}
		for i := 0; i < len(nums); i++ {
			if used[i] {
				continue
			}
			if i > 0 && nums[i] == nums[i-1] && !used[i-1] {
				continue
			}
			used[i] = true
			cur = append(cur, nums[i])
			bt()
			cur = cur[:len(cur)-1]
			used[i] = false
		}
	}
	bt()
	return res
}

func combinationSum(cand []int, target int) [][]int {
	sort.Ints(cand)
	var res [][]int
	var cur []int
	var bt func(start, rem int)
	bt = func(start, rem int) {
		if rem == 0 {
			res = append(res, append([]int(nil), cur...))
			return
		}
		for i := start; i < len(cand); i++ {
			if cand[i] > rem {
				break
			}
			cur = append(cur, cand[i])
			bt(i, rem-cand[i]) // i: reuse allowed
			cur = cur[:len(cur)-1]
		}
	}
	bt(0, target)
	return res
}

func combinationSum2(cand []int, target int) [][]int {
	sort.Ints(cand)
	var res [][]int
	var cur []int
	var bt func(start, rem int)
	bt = func(start, rem int) {
		if rem == 0 {
			res = append(res, append([]int(nil), cur...))
			return
		}
		for i := start; i < len(cand); i++ {
			if i > start && cand[i] == cand[i-1] {
				continue
			}
			if cand[i] > rem {
				break
			}
			cur = append(cur, cand[i])
			bt(i+1, rem-cand[i]) // i+1: use once
			cur = cur[:len(cur)-1]
		}
	}
	bt(0, target)
	return res
}

func main() {
	fmt.Println(subsetsWithDup([]int{1, 2, 2}))
	fmt.Println(permuteUnique([]int{1, 1, 2}))
	fmt.Println(combinationSum([]int{2, 3, 6, 7}, 7))
	fmt.Println(combinationSum2([]int{10, 1, 2, 7, 6, 1, 5}, 8))
}
```

#### Java

```java
import java.util.*;

public class Combinatorics {
    static List<List<Integer>> subsetsWithDup(int[] a) {
        Arrays.sort(a);
        List<List<Integer>> res = new ArrayList<>();
        sub(a, 0, new ArrayList<>(), res);
        return res;
    }
    static void sub(int[] a, int s, List<Integer> cur, List<List<Integer>> res) {
        res.add(new ArrayList<>(cur));
        for (int i = s; i < a.length; i++) {
            if (i > s && a[i] == a[i - 1]) continue;
            cur.add(a[i]); sub(a, i + 1, cur, res); cur.remove(cur.size() - 1);
        }
    }

    static List<List<Integer>> permuteUnique(int[] a) {
        Arrays.sort(a);
        List<List<Integer>> res = new ArrayList<>();
        perm(a, new boolean[a.length], new ArrayList<>(), res);
        return res;
    }
    static void perm(int[] a, boolean[] used, List<Integer> cur, List<List<Integer>> res) {
        if (cur.size() == a.length) { res.add(new ArrayList<>(cur)); return; }
        for (int i = 0; i < a.length; i++) {
            if (used[i]) continue;
            if (i > 0 && a[i] == a[i - 1] && !used[i - 1]) continue;
            used[i] = true; cur.add(a[i]);
            perm(a, used, cur, res);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }

    static List<List<Integer>> combinationSum(int[] c, int target) {
        Arrays.sort(c);
        List<List<Integer>> res = new ArrayList<>();
        cs(c, 0, target, new ArrayList<>(), res, false);
        return res;
    }
    static List<List<Integer>> combinationSum2(int[] c, int target) {
        Arrays.sort(c);
        List<List<Integer>> res = new ArrayList<>();
        cs(c, 0, target, new ArrayList<>(), res, true);
        return res;
    }
    static void cs(int[] c, int s, int rem, List<Integer> cur,
                   List<List<Integer>> res, boolean once) {
        if (rem == 0) { res.add(new ArrayList<>(cur)); return; }
        for (int i = s; i < c.length; i++) {
            if (once && i > s && c[i] == c[i - 1]) continue;
            if (c[i] > rem) break;
            cur.add(c[i]);
            cs(c, once ? i + 1 : i, rem - c[i], cur, res, once);
            cur.remove(cur.size() - 1);
        }
    }

    public static void main(String[] args) {
        System.out.println(subsetsWithDup(new int[]{1, 2, 2}));
        System.out.println(permuteUnique(new int[]{1, 1, 2}));
        System.out.println(combinationSum(new int[]{2, 3, 6, 7}, 7));
        System.out.println(combinationSum2(new int[]{10, 1, 2, 7, 6, 1, 5}, 8));
    }
}
```

#### Python

```python
def subsets_with_dup(nums):
    nums.sort()
    res, cur = [], []

    def bt(start):
        res.append(cur[:])
        for i in range(start, len(nums)):
            if i > start and nums[i] == nums[i - 1]:
                continue
            cur.append(nums[i]); bt(i + 1); cur.pop()

    bt(0)
    return res


def permute_unique(nums):
    nums.sort()
    res, cur = [], []
    used = [False] * len(nums)

    def bt():
        if len(cur) == len(nums):
            res.append(cur[:]); return
        for i in range(len(nums)):
            if used[i]:
                continue
            if i > 0 and nums[i] == nums[i - 1] and not used[i - 1]:
                continue
            used[i] = True; cur.append(nums[i])
            bt()
            cur.pop(); used[i] = False

    bt()
    return res


def combination_sum(cand, target, once=False):
    cand.sort()
    res, cur = [], []

    def bt(start, rem):
        if rem == 0:
            res.append(cur[:]); return
        for i in range(start, len(cand)):
            if once and i > start and cand[i] == cand[i - 1]:
                continue
            if cand[i] > rem:
                break
            cur.append(cand[i])
            bt(i + 1 if once else i, rem - cand[i])
            cur.pop()

    bt(0, target)
    return res


if __name__ == "__main__":
    print(subsets_with_dup([1, 2, 2]))
    print(permute_unique([1, 1, 2]))
    print(combination_sum([2, 3, 6, 7], 7))
    print(combination_sum([10, 1, 2, 7, 6, 1, 5], 8, once=True))
```

### next_permutation and Gray code

#### Python

```python
def next_permutation(a):
    n = len(a)
    i = n - 2
    while i >= 0 and a[i] >= a[i + 1]:
        i -= 1
    if i < 0:
        a.reverse()
        return False
    j = n - 1
    while a[j] <= a[i]:
        j -= 1
    a[i], a[j] = a[j], a[i]
    a[i + 1:] = reversed(a[i + 1:])
    return True


def all_permutations_lex(a):
    a = sorted(a)
    res = [a[:]]
    while next_permutation(a):
        res.append(a[:])
    return res


def gray_code(n):
    return [i ^ (i >> 1) for i in range(1 << n)]


if __name__ == "__main__":
    print(all_permutations_lex([1, 2, 2]))   # 3 distinct, lex order
    print(gray_code(2))                       # [0, 1, 3, 2]
```

**Run:** `go run main.go` | `javac Combinatorics.java && java Combinatorics` | `python combos.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Duplicate answers still appear | Forgot to sort before the skip rule. | Sort first; equal elements must be adjacent. |
| Subsets-II drops valid subsets | Used `i > 0` instead of `i > start`. | Skip only later siblings: `i > start`. |
| Permutations-II wrong count | Used `used[i-1]` instead of `!used[i-1]`. | Use the canonical `!used[i-1]` form. |
| Combination sum infinite loop | A candidate equals 0 (reuse case). | Forbid/strip zeros for the reuse variant. |
| Combination Sum II reuses an element | Recursed with `i` instead of `i+1`. | Use `i+1` for the use-once variant. |
| next_permutation never terminates loop | Did not handle the descending wrap-around. | Return false when no pivot found. |
| Wrong Gray code adjacency | Used plain binary instead of `i ^ (i>>1)`. | Apply the reflected-Gray formula. |

---

## Performance Analysis

- **Sort cost** is `O(n log n)`, negligible against exponential output; always pay it once for dup-handling and pruning.
- **Pruning by `break`** in combination sum (sorted candidates) prunes whole sorted tails — often turns intractable inputs feasible.
- **Skip-equal-siblings** reduces work to the *distinct*-output count, strictly better than generate-then-dedup.
- **`next_permutation`** amortizes to `O(1)` per call over a full enumeration (a known result), so streaming all `n!` permutations is `O(n · n!)` total — optimal.
- **Gray code** is `O(1)` per element via the XOR formula, with `O(1)` extra space.
- **Swap permutations** avoid the `used[]` allocation but lose lexicographic order; only choose them when order is irrelevant.

---

## Best Practices

- Memorize the two skip rules verbatim: subsets/comb-sum-II use `i > start && a[i]==a[i-1]`; permutations use `a[i]==a[i-1] && !used[i-1]`.
- Always **sort first** when duplicates are possible or when prefix-sum pruning helps.
- Encode the use-once vs reuse decision as the single argument `i+1` vs `i`; comment it explicitly.
- Prune combination sum with a sorted `break` on `candidate > remaining` — do not test every candidate.
- Validate generators by comparing output counts to the multinomial / product formulas on small inputs.
- For memory-bounded streaming, prefer `next_permutation` over collecting all permutations.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The decision tree for subsets and permutations, with each choice made and un-made
> - How skipping equal siblings would prune duplicate branches
> - The partial solution growing and shrinking as the search backtracks
> - Completed answers being emitted, with a mode toggle and step controls

---

## Summary

The middle-level skills are all about **precision**. Duplicate handling is "sort, then skip equal siblings," with the exact condition depending on whether you are building subsets (`i > start`) or permutations (`!used[i-1]`). Combination sum is one template with a single switch: recurse `i` to reuse a candidate, `i+1` to use it once — both sped up by a sorted `break`. Permutations come in used-array (clear, order-preserving, easy duplicates) and swap (O(1) space, no order, per-level seen-set for duplicates) flavors. For streaming, `next_permutation` walks lexicographic order in O(n) per step and skips duplicates for free; Gray code orders subsets by single-element changes via `i ^ (i>>1)`. Knowing which variant to reach for — and proving it emits each answer exactly once — is the mark of fluency.

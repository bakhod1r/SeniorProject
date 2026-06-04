# Generating Permutations, Subsets, and Combinations — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the backtracking logic and validate against the evaluation criteria.
> **Always verify your output count against the closed form (`2^n`, `n!`, `C(n,k)`, multinomial) and check uniqueness on small inputs before trusting your generator.**

---

## Beginner Tasks (5)

### Task 1 — All subsets

**Problem.** Given a distinct integer array `nums`, return every subset (the power set).

**Input / Output spec.**
- Input: `nums` (length `n`).
- Output: a list of `2^n` lists; order does not matter.

**Constraints.**
- `0 ≤ n ≤ 16`. Elements are distinct.

**Hint.** Start-index recursion: emit a copy at every node, recurse with `i+1`.

**Starter — Go.**
```go
package main

import "fmt"

func subsets(nums []int) [][]int {
	// TODO: backtrack with start index; emit a COPY at every node
	return nil
}

func main() { fmt.Println(subsets([]int{1, 2, 3})) }
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static List<List<Integer>> subsets(int[] nums) {
        // TODO: backtrack with start index; emit a copy at every node
        return new ArrayList<>();
    }
    public static void main(String[] args) {
        System.out.println(subsets(new int[]{1, 2, 3}));
    }
}
```

**Starter — Python.**
```python
def subsets(nums):
    # TODO: backtrack with start index; emit a copy at every node
    return []


if __name__ == "__main__":
    print(subsets([1, 2, 3]))
```

**Evaluation.** Output has exactly `2^n` subsets, all distinct, including `[]`.

---

### Task 2 — Subsets by bit enumeration

**Problem.** Produce all subsets **without recursion**, using bitmask enumeration.

**Input / Output spec.**
- Input: `nums` (length `n`).
- Output: `2^n` subsets.

**Constraints.**
- `0 ≤ n ≤ 20`.

**Hint.** For `mask` in `0..(1<<n)-1`, include `nums[i]` iff `(mask >> i) & 1`.

**Starter — Go.**
```go
func subsetsBits(nums []int) [][]int {
	// TODO: loop mask 0..(1<<n)-1; pick set bits
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> subsetsBits(int[] nums) {
    // TODO: loop mask 0..(1<<n)-1; pick set bits
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def subsets_bits(nums):
    # TODO: loop mask 0..(1<<n)-1; pick set bits
    return []
```

**Evaluation.** Must match Task 1's output set (order may differ). No recursion allowed.

---

### Task 3 — All permutations

**Problem.** Given a distinct array `nums`, return all `n!` permutations.

**Input / Output spec.**
- Input: `nums` (length `n`).
- Output: list of `n!` orderings.

**Constraints.**
- `0 ≤ n ≤ 8`.

**Hint.** Used-array backtracking; emit when `cur.size() == n`.

**Starter — Go.**
```go
func permute(nums []int) [][]int {
	// TODO: used[] backtracking
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> permute(int[] nums) {
    // TODO: used[] backtracking
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def permute(nums):
    # TODO: used[] backtracking
    return []
```

**Evaluation.** Exactly `n!` permutations, all distinct.

---

### Task 4 — Combinations C(n, k)

**Problem.** Return all combinations of `k` numbers chosen from `1..n`.

**Input / Output spec.**
- Input: integers `n`, `k`.
- Output: `C(n,k)` lists, each size `k`, strictly increasing.

**Constraints.**
- `1 ≤ k ≤ n ≤ 20`.

**Hint.** Start-index recursion, emit when size == k. Bonus: prune the loop to `n-(k-len)+1`.

**Starter — Go.**
```go
func combine(n, k int) [][]int {
	// TODO: backtrack(start); emit when len==k
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> combine(int n, int k) {
    // TODO: backtrack(start); emit when size==k
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def combine(n, k):
    # TODO: backtrack(start); emit when len==k
    return []
```

**Evaluation.** Exactly `C(n,k)` combinations, each strictly increasing.

---

### Task 5 — Gray code sequence

**Problem.** Return the `n`-bit binary-reflected Gray code as integers: a list of `2^n` numbers where consecutive entries (and the wrap-around) differ in exactly one bit.

**Input / Output spec.**
- Input: integer `n`.
- Output: list of `2^n` ints starting at 0.

**Constraints.**
- `0 ≤ n ≤ 16`.

**Hint.** The `i`-th value is `i ^ (i >> 1)`.

**Starter — Go.**
```go
func grayCode(n int) []int {
	// TODO: return i ^ (i>>1) for i in 0..(1<<n)-1
	return nil
}
```

**Starter — Java.**
```java
static List<Integer> grayCode(int n) {
    // TODO: i ^ (i>>1)
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def gray_code(n):
    # TODO: i ^ (i >> 1)
    return []
```

**Evaluation.** `2^n` distinct values; every adjacent pair differs in exactly one bit.

---

## Intermediate Tasks (5)

### Task 6 — Subsets II (with duplicates)

**Problem.** Given `nums` that may contain duplicates, return all **distinct** subsets.

**Input / Output spec.**
- Input: `nums` (length `n`).
- Output: distinct subsets, count `= ∏(mᵢ+1)`.

**Constraints.**
- `0 ≤ n ≤ 16`.

**Hint.** Sort; skip `i > start && nums[i]==nums[i-1]`.

**Starter — Go.**
```go
import "sort"

func subsetsWithDup(nums []int) [][]int {
	sort.Ints(nums)
	// TODO: start-index backtracking with skip-equal-siblings
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> subsetsWithDup(int[] nums) {
    Arrays.sort(nums);
    // TODO: skip i>start && nums[i]==nums[i-1]
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def subsets_with_dup(nums):
    nums.sort()
    # TODO: skip i>start and nums[i]==nums[i-1]
    return []
```

**Evaluation.** No duplicate subsets; count equals `∏(mᵢ+1)`.

---

### Task 7 — Permutations II (with duplicates)

**Problem.** Given `nums` with possible duplicates, return all **distinct** permutations.

**Input / Output spec.**
- Input: `nums` (length `n`).
- Output: distinct permutations, count `= n!/∏mᵢ!`.

**Constraints.**
- `0 ≤ n ≤ 8`.

**Hint.** Sort; used-array; skip `i>0 && nums[i]==nums[i-1] && !used[i-1]`.

**Starter — Go.**
```go
import "sort"

func permuteUnique(nums []int) [][]int {
	sort.Ints(nums)
	// TODO: used[] + skip !used[i-1] on equal value
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> permuteUnique(int[] nums) {
    Arrays.sort(nums);
    // TODO: used[] + skip !used[i-1] on equal value
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def permute_unique(nums):
    nums.sort()
    # TODO: used[] + skip not used[i-1] on equal value
    return []
```

**Evaluation.** No duplicates; count equals the multinomial `n!/∏mᵢ!`.

---

### Task 8 — Combination Sum (reuse allowed)

**Problem.** Distinct positive `candidates` and `target`; return all combinations summing to `target`, each candidate usable unlimited times.

**Input / Output spec.**
- Input: `candidates`, `target`.
- Output: all unique combinations (as multisets) summing to `target`.

**Constraints.**
- `1 ≤ len ≤ 30`, `1 ≤ candidates[i] ≤ 200`, `1 ≤ target ≤ 500`.

**Hint.** Sort; recurse with `i` (reuse); `break` when `candidate > remaining`.

**Starter — Go.**
```go
import "sort"

func combinationSum(c []int, target int) [][]int {
	sort.Ints(c)
	// TODO: recurse with i (reuse); break on c[i] > rem
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> combinationSum(int[] c, int target) {
    Arrays.sort(c);
    // TODO: recurse with i (reuse); break on c[i] > rem
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def combination_sum(candidates, target):
    candidates.sort()
    # TODO: recurse with i (reuse); break on candidate > remaining
    return []
```

**Evaluation.** Every output sums to `target`; no duplicate combinations.

---

### Task 9 — Combination Sum II (each used once)

**Problem.** `candidates` (may have duplicates) and `target`; each candidate used **at most once**; return distinct combinations summing to `target`.

**Input / Output spec.**
- Input: `candidates`, `target`.
- Output: distinct combinations summing to `target`.

**Constraints.**
- `1 ≤ len ≤ 100`, `1 ≤ candidates[i] ≤ 50`, `1 ≤ target ≤ 30`.

**Hint.** Sort; recurse with `i+1`; skip `i > start && candidates[i]==candidates[i-1]`; `break` on overflow.

**Starter — Go.**
```go
import "sort"

func combinationSum2(c []int, target int) [][]int {
	sort.Ints(c)
	// TODO: recurse i+1; skip dup siblings; break on c[i] > rem
	return nil
}
```

**Starter — Java.**
```java
static List<List<Integer>> combinationSum2(int[] c, int target) {
    Arrays.sort(c);
    // TODO: recurse i+1; skip dup siblings; break on c[i] > rem
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def combination_sum2(candidates, target):
    candidates.sort()
    # TODO: recurse i+1; skip dup siblings; break on candidate > rem
    return []
```

**Evaluation.** No duplicate combinations; each candidate used at most once per combination.

---

### Task 10 — Next permutation (in place)

**Problem.** Rearrange `nums` into the next lexicographically greater permutation in place; if it is the largest, wrap to the smallest (sorted ascending).

**Input / Output spec.**
- Input: `nums`.
- Output: `nums` mutated to its lexicographic successor.

**Constraints.**
- `1 ≤ n ≤ 1000`. Must be `O(n)` time, `O(1)` extra space.

**Hint.** Find pivot `nums[i] < nums[i+1]` from the right; if found, swap with rightmost larger, reverse the suffix; else reverse all.

**Starter — Go.**
```go
func nextPermutation(nums []int) {
	// TODO: pivot -> swap -> reverse suffix; if no pivot, reverse all
}
```

**Starter — Java.**
```java
static void nextPermutation(int[] nums) {
    // TODO: pivot -> swap -> reverse suffix; if no pivot, reverse all
}
```

**Starter — Python.**
```python
def next_permutation(nums):
    # TODO: pivot -> swap -> reverse suffix; if no pivot, reverse all
    pass
```

**Evaluation.** Produces the correct successor; iterating from sorted yields all permutations in lex order.

---

## Advanced Tasks (4)

### Task 11 — Streaming subsets with early stop

**Problem.** Provide a generator/iterator that yields subsets one at a time so the caller can stop after the first one satisfying a predicate, never materializing all `2^n`.

**Input / Output spec.**
- Input: `nums`, a predicate, and a max-count.
- Output: the first matching subset (or `null`/`None`), using `O(n)` extra memory.

**Constraints.**
- `0 ≤ n ≤ 30`. Must not build the full power set.

**Hint.** Python `yield`; Go visitor callback returning `bool` (false = stop); Java `Iterator` or callback.

**Starter — Go.**
```go
func visitSubsets(nums []int, visit func(sub []int) bool) {
	// TODO: recursive emit; if visit returns false, unwind and stop
}
```

**Starter — Java.**
```java
interface SubsetVisitor { boolean visit(List<Integer> sub); }
static void visitSubsets(int[] nums, SubsetVisitor v) {
    // TODO: recursive emit; stop when visit returns false
}
```

**Starter — Python.**
```python
def iter_subsets(nums):
    # TODO: yield cur[:] at every node; yield from recursion
    yield from ()
```

**Evaluation.** Confirm peak memory is `O(n)` (no full list) and early stop works.

---

### Task 12 — k-th permutation (unrank)

**Problem.** Return the `k`-th permutation (1-indexed, lexicographic) of `[1..n]` **without** generating the earlier ones.

**Input / Output spec.**
- Input: `n`, `k` with `1 ≤ k ≤ n!`.
- Output: the `k`-th permutation as a list.

**Constraints.**
- `1 ≤ n ≤ 9`. Must be `O(n^2)` or better (no full enumeration).

**Hint.** Use the factorial number system: at each step pick the `(k-1)/(n-1-i)!`-th remaining element, update `k`.

**Starter — Go.**
```go
func getPermutation(n, k int) []int {
	// TODO: factorial number system unrank
	return nil
}
```

**Starter — Java.**
```java
static String getPermutation(int n, int k) {
    // TODO: factorial number system unrank
    return "";
}
```

**Starter — Python.**
```python
def get_permutation(n, k):
    # TODO: factorial number system unrank (k is 1-indexed)
    return []
```

**Evaluation.** Matches the `k`-th element of the fully enumerated lex order; no enumeration of predecessors.

---

### Task 13 — Letter combinations of a phone number

**Problem.** Given a digit string (`2-9`), return all letter combinations the number could spell (phone keypad mapping). This is a Cartesian-product backtracking.

**Input / Output spec.**
- Input: a string of digits `2..9`.
- Output: all letter strings; empty input → empty list.

**Constraints.**
- `0 ≤ len ≤ 4`.

**Hint.** Map each digit to its letters; backtrack over positions, choosing one letter per digit.

**Starter — Go.**
```go
func letterCombinations(digits string) []string {
	// TODO: backtrack over digits, append one letter per position
	return nil
}
```

**Starter — Java.**
```java
static List<String> letterCombinations(String digits) {
    // TODO: backtrack over digits, one letter per position
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def letter_combinations(digits):
    # TODO: backtrack over digits, one letter per position
    return []
```

**Evaluation.** Count equals the product of letters-per-digit; empty input returns `[]`.

---

### Task 14 — Distinct-count without enumeration

**Problem.** Given a multiset `nums`, return the **count** of distinct permutations and the **count** of distinct subsets — using formulas, not enumeration (so it works for large `n`).

**Input / Output spec.**
- Input: `nums` (length `n`, possibly with duplicates).
- Output: two integers — distinct-permutation count `n!/∏mᵢ!` and distinct-subset count `∏(mᵢ+1)`.

**Constraints.**
- `1 ≤ n ≤ 20` (use big integers if needed for the factorial).

**Hint.** Tally multiplicities `mᵢ`; permutations = `n!` divided by `∏ mᵢ!`; subsets = product of `(mᵢ+1)`.

**Starter — Go.**
```go
func distinctCounts(nums []int) (permCount, subsetCount int64) {
	// TODO: tally multiplicities; apply formulas
	return
}
```

**Starter — Java.**
```java
static long[] distinctCounts(int[] nums) {
    // TODO: tally multiplicities; return {permCount, subsetCount}
    return new long[]{0, 0};
}
```

**Starter — Python.**
```python
from math import factorial
from collections import Counter


def distinct_counts(nums):
    # TODO: tally multiplicities; perm = n!/∏ m_i!, subset = ∏ (m_i+1)
    return 0, 0
```

**Evaluation.** Counts match brute-force enumeration on small inputs; runs instantly for `n = 20` (where enumeration would be infeasible).

---

## How to Validate Your Solutions

- **Count check:** subsets `2^n` (or `∏(mᵢ+1)` with dups); permutations `n!` (or `n!/∏mᵢ!`); combinations `C(n,k)`.
- **Uniqueness check:** insert each result (canonicalized) into a set; the set size must equal the emit count.
- **Ordering check (where required):** assert the output is non-decreasing under the documented comparator (Task 10, Task 12).
- **Oracle check:** cross-check small inputs against Python's `itertools.combinations / permutations / product`.
- **Bug guards:** confirm you emit a **copy** (not the live buffer) and **un-choose** after each recurse.
- **Edge cases:** empty input, `k=0`, `k=n`, `k>n`, all-equal elements, single element.

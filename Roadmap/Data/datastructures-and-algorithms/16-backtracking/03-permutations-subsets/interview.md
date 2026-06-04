# Generating Permutations, Subsets, and Combinations — Interview Preparation

Backtracking generation is one of the most-asked interview families because it tests a single crisp template — *choose → recurse → un-choose* — and then probes whether you can (a) pick the right tree shape for subsets vs permutations vs combinations, (b) handle **duplicate inputs** without a post-dedup hash set, (c) add the right **pruning**, and (d) avoid the two classic bugs: not copying on emit and not un-choosing. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Template | Key detail | Complexity |
|------|----------|-----------|------------|
| All subsets | start-index, emit every node | recurse `i+1` | `O(n·2^n)` |
| Subsets (small n) | bit masks `0..2^n-1` | bit `i` = element in | `O(n·2^n)` |
| All permutations | `used[]` or swap | every unused is a choice | `O(n·n!)` |
| Combinations C(n,k) | start-index, emit at size k | prune `n-(k-len)+1` | `O(k·C(n,k))` |
| Subsets II (dups) | sort + skip `i>start && a[i]==a[i-1]` | adjacency from sort | `O(n·2^n)` |
| Permutations II (dups) | sort + skip `a[i]==a[i-1] && !used[i-1]` | canonical copy order | `O(n·n!)` |
| Combination Sum (reuse) | recurse `i` | sorted `break` prune | output-sensitive |
| Combination Sum II (once) | recurse `i+1` + skip dup | sort + skip | output-sensitive |
| Next permutation | pivot → swap → reverse suffix | O(n), lexicographic | `O(n)` |
| Gray code | `i ^ (i>>1)` | one-bit change | `O(2^n)` |

Universal skeleton:

```text
backtrack(state):
    if complete(state): emit COPY(state); return
    for each valid choice c:
        choose c; backtrack(state); un-choose c
```

Key facts:
- **Emit a COPY** of the buffer, never the live buffer (the #1 bug).
- **Un-choose** after every recurse (the #2 bug).
- For duplicates: **sort first**, then skip equal siblings.
- Use-once = recurse `i+1`; reuse = recurse `i`.
- Output is exponential/factorial → these are **output-sensitive**; you can't beat the output size.

---

## Junior Questions (12 Q&A)

### J1. What is backtracking?
A depth-first traversal of an implicit tree of choices: at each node you make a choice, recurse, then **undo** the choice and try the next. The "undo" (un-choose) restores shared state so sibling branches are unaffected.

### J2. How many subsets, permutations, combinations are there?
`2^n` subsets, `n!` permutations, `C(n,k) = n!/(k!(n−k)!)` combinations of size k.

### J3. Why must you copy the buffer when emitting?
The recursion reuses one mutable list. If you store the live reference, every stored "result" points to the *same* list, which ends up holding the final state. Store a snapshot (`cur[:]`, `new ArrayList<>(cur)`, a fresh slice).

### J4. What does the start index do in subset/combination generation?
It prevents re-picking earlier elements. Recursing with `i+1` means each chosen element only allows *later* elements next, so each subset/combination is produced in one fixed order — no duplicates like `[2,1]` after `[1,2]`.

### J5. Subsets via include/exclude vs start-index — difference?
Include/exclude is a binary tree emitting only at leaves (depth n). Start-index emits at *every* node and naturally generalizes to combinations (emit when size == k). Both produce all `2^n` subsets.

### J6. How do permutations differ from subsets in the loop?
Permutations may pick **any unused** element at each depth (order matters), and emit only when the buffer has length `n`. Subsets pick only **later** elements and emit at every node.

### J7. What is the `used[]` array for?
It marks which elements are already in the current permutation so you don't reuse one. Set `used[i]=true` before recursing, reset it after.

### J8. How do you generate subsets without recursion?
Bit enumeration: for `mask` in `0..2^n-1`, include element `i` iff bit `i` of `mask` is set. Each mask is a unique subset.

### J9. Why are these problems "output-sensitive"?
The work is dominated by the size of the output. With `n!` permutations, just *printing* them costs `Ω(n·n!)`. No algorithm can be asymptotically faster than the output it must produce.

### J10. What is the base case for permutations?
When `cur.size() == n` (all elements placed) — emit a copy and return.

### J11. What happens with empty input `[]`?
Subsets returns `[[]]` (the empty subset), permutations returns `[[]]`, combinations of size 0 returns `[[]]`.

### J12. What is the most common backtracking bug?
Two tie: forgetting to **copy** on emit (all results alias), and forgetting to **un-choose** (state leaks into siblings).

---

## Mid-Level Questions (10 Q&A)

### M1. How do you handle duplicate inputs for subsets?
Sort, then in each loop skip an element equal to its left sibling: `if i > start && a[i]==a[i-1] continue`. This emits each distinct subset once without a post-dedup set.

### M2. Why `i > start` and not `i > 0` in subsets-II?
`i > start` skips only *sibling* duplicates at the current level. `i > 0` would also skip the deeper continuation `[2,2]`, dropping valid subsets.

### M3. What is the permutations-II skip condition and why?
`a[i]==a[i-1] && !used[i-1]`: among equal copies, place them in increasing index order. `!used[i-1]` means the earlier copy hasn't been placed on this branch, so placing copy `i` first would duplicate an arrangement reachable the other way — skip it.

### M4. Combination Sum vs Combination Sum II — the one difference?
Reuse allowed → recurse with `i` (same index reusable). Use once → recurse with `i+1`. The "once" variant also needs sort + skip-equal-siblings for duplicate candidates.

### M5. How do you prune combination sum?
Sort candidates; in the loop `break` when `candidate > remaining` (no later sorted candidate fits either). For combinations also prune the index range to `n-(k-len)+1`.

### M6. Swap-based vs used-array permutations — trade-offs?
Swap: O(1) extra space, mutates input, **no** lexicographic order, needs a per-level seen-set for duplicates. Used-array: O(n) space, preserves order with sorted input, clean `!used[i-1]` dedup. Pick used-array when order or duplicates matter.

### M7. Explain next_permutation in three steps.
Find the rightmost ascent pivot `a[i] < a[i+1]`; if none, it's the last permutation (reverse to wrap). Else find the rightmost `a[j] > a[i]`, swap them, and reverse the suffix after `i`. O(n), in place, lexicographic; skips duplicates.

### M8. What is Gray code and the formula?
An ordering of all `2^n` patterns where consecutive ones differ in exactly one bit; the `i`-th is `i ^ (i>>1)`. Useful for single-toggle subset iteration and minimizing state changes.

### M9. How do you count distinct permutations of a multiset?
The multinomial `n! / (m₁! · m₂! · …)` where `mᵢ` are the value multiplicities. E.g. `[1,2,2]` → `3!/2! = 3`.

### M10. Why prefer sort+skip over generate-then-dedup with a Set?
Sort+skip never *generates* the duplicate branches, so it does less work and uses less memory. Generate-then-dedup pays the full redundant cost plus hashing.

---

## Senior Questions (8 Q&A)

### S1. How do you stream subsets/permutations for huge n?
Use a generator/iterator (Python `yield`, Java `Iterator`, Go visitor callback returning continue?). Memory stays `O(n)`; the caller can filter, take-n, or stop early without materializing the exponential output.

### S2. How do you give random access to the r-th permutation?
Unrank via the factorial number system (Lehmer code): write `r` in factorial base, then pick the `d_i`-th remaining element at each step. `O(n)` (or `O(n log n)` with a Fenwick tree). Enables sharded, resumable enumeration.

### S3. How do you avoid stack overflow for large n?
Convert recursion to iteration: bit enumeration for subsets, successor functions (`next_permutation`, combination `advance`) for permutations/combinations, or an explicit manual stack.

### S4. How do you guarantee deterministic ordering?
Use ordered generators (start-index subsets, combination successor, `next_permutation` from sorted input) and sort the input. Avoid swap-based permutations, which scramble order. Document the ordering contract.

### S5. Counting vs enumerating — when not to backtrack?
If the question is "how many" or "does one exist," use a formula (`2^n`, `C(n,k)`) or DP (subset-sum counting in `O(n·t)`). Only enumerate when you need every object. Some counting problems are #P-hard with no shortcut.

### S6. How do you test a combinatorial generator?
Property tests: emit count == closed-form count; uniqueness (set size == count); ordering monotonic under the documented comparator; rank/unrank round-trips; cross-check against `itertools` on small inputs.

### S7. How do you parallelize enumeration?
Partition the index range `[0, total)` into shards; each worker unranks its start and advances with the successor function over a disjoint range. No coordination needed.

### S8. What pruning techniques scale best?
Feasibility bounds (can we still reach size k / target?), sorted `break`, symmetry breaking (fix a canonical representative to divide by the symmetry group), and incremental constraint state (O(1) validity checks).

---

## Behavioral / Communication Prompts

- **"Walk me through your approach before coding."** State the template (choose/recurse/un-choose), identify the tree shape (subset/permutation/combination), name the complexity (output-sensitive), and call out the two bugs you'll guard against (copy-on-emit, un-choose). Then ask: "Can the input contain duplicates?" — interviewers love that you anticipate it.
- **"You wrote a hash-set dedup. Can you do better?"** Explain sort + skip-equal-siblings avoids generating duplicates entirely — less time and memory. Show you know *why* the naive fix is wasteful.
- **"This will be 13! results. Concern?"** Pivot to streaming: yield one at a time, stop early, or count via formula. Demonstrates production thinking.
- **"You have a bug — all results are identical."** Diagnose out loud: "That's the aliasing bug — I'm storing the live buffer instead of a copy." Fix it and explain.
- **Trade-off articulation:** swap vs used-array, recursion vs iteration, enumerate vs count. Interviewers score the *reasoning*, not just the working code.

---

## Coding Challenge 1: Subsets (with duplicates)

**Problem.** Given an integer array `nums` (may contain duplicates), return all possible **distinct** subsets. Order of subsets does not matter; no duplicate subsets.

**Example.** `nums = [1,2,2]` → `[[],[1],[1,2],[1,2,2],[2],[2,2]]`.

**Approach.** Sort; start-index recursion; skip equal siblings with `i > start && nums[i]==nums[i-1]`; emit a copy at every node.

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

func main() { fmt.Println(subsetsWithDup([]int{1, 2, 2})) }
```

#### Java
```java
import java.util.*;

public class SubsetsII {
    public static List<List<Integer>> subsetsWithDup(int[] nums) {
        Arrays.sort(nums);
        List<List<Integer>> res = new ArrayList<>();
        bt(nums, 0, new ArrayList<>(), res);
        return res;
    }
    static void bt(int[] a, int s, List<Integer> cur, List<List<Integer>> res) {
        res.add(new ArrayList<>(cur));
        for (int i = s; i < a.length; i++) {
            if (i > s && a[i] == a[i - 1]) continue;
            cur.add(a[i]); bt(a, i + 1, cur, res); cur.remove(cur.size() - 1);
        }
    }
    public static void main(String[] args) {
        System.out.println(subsetsWithDup(new int[]{1, 2, 2}));
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


if __name__ == "__main__":
    print(subsets_with_dup([1, 2, 2]))
```

---

## Coding Challenge 2: Permutations

**Problem.** Given a distinct integer array `nums`, return all permutations in any order.

**Example.** `nums = [1,2,3]` → 6 permutations.

**Approach.** Used-array backtracking; emit at depth `n`.

#### Go
```go
package main

import "fmt"

func permute(nums []int) [][]int {
	var res [][]int
	used := make([]bool, len(nums))
	var cur []int
	var bt func()
	bt = func() {
		if len(cur) == len(nums) {
			res = append(res, append([]int(nil), cur...))
			return
		}
		for i := range nums {
			if used[i] {
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

func main() { fmt.Println(permute([]int{1, 2, 3})) }
```

#### Java
```java
import java.util.*;

public class Permute {
    public static List<List<Integer>> permute(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        bt(nums, new boolean[nums.length], new ArrayList<>(), res);
        return res;
    }
    static void bt(int[] a, boolean[] used, List<Integer> cur, List<List<Integer>> res) {
        if (cur.size() == a.length) { res.add(new ArrayList<>(cur)); return; }
        for (int i = 0; i < a.length; i++) {
            if (used[i]) continue;
            used[i] = true; cur.add(a[i]);
            bt(a, used, cur, res);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }
    public static void main(String[] args) {
        System.out.println(permute(new int[]{1, 2, 3}));
    }
}
```

#### Python
```python
def permute(nums):
    res, cur = [], []
    used = [False] * len(nums)

    def bt():
        if len(cur) == len(nums):
            res.append(cur[:]); return
        for i in range(len(nums)):
            if used[i]:
                continue
            used[i] = True; cur.append(nums[i])
            bt()
            cur.pop(); used[i] = False

    bt()
    return res


if __name__ == "__main__":
    print(permute([1, 2, 3]))
```

---

## Coding Challenge 3: Combination Sum (reuse allowed)

**Problem.** Given **distinct** positive integers `candidates` and a `target`, return all unique combinations where the chosen numbers sum to `target`. Each candidate may be used **unlimited** times.

**Example.** `candidates = [2,3,6,7], target = 7` → `[[2,2,3],[7]]`.

**Approach.** Sort; recurse with `i` (reuse); `break` when `candidate > remaining`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func combinationSum(c []int, target int) [][]int {
	sort.Ints(c)
	var res [][]int
	var cur []int
	var bt func(start, rem int)
	bt = func(start, rem int) {
		if rem == 0 {
			res = append(res, append([]int(nil), cur...))
			return
		}
		for i := start; i < len(c); i++ {
			if c[i] > rem {
				break
			}
			cur = append(cur, c[i])
			bt(i, rem-c[i]) // reuse: i, not i+1
			cur = cur[:len(cur)-1]
		}
	}
	bt(0, target)
	return res
}

func main() { fmt.Println(combinationSum([]int{2, 3, 6, 7}, 7)) }
```

#### Java
```java
import java.util.*;

public class CombinationSum {
    public static List<List<Integer>> combinationSum(int[] c, int target) {
        Arrays.sort(c);
        List<List<Integer>> res = new ArrayList<>();
        bt(c, 0, target, new ArrayList<>(), res);
        return res;
    }
    static void bt(int[] c, int s, int rem, List<Integer> cur, List<List<Integer>> res) {
        if (rem == 0) { res.add(new ArrayList<>(cur)); return; }
        for (int i = s; i < c.length; i++) {
            if (c[i] > rem) break;
            cur.add(c[i]);
            bt(c, i, rem - c[i], cur, res); // reuse: i
            cur.remove(cur.size() - 1);
        }
    }
    public static void main(String[] args) {
        System.out.println(combinationSum(new int[]{2, 3, 6, 7}, 7));
    }
}
```

#### Python
```python
def combination_sum(candidates, target):
    candidates.sort()
    res, cur = [], []

    def bt(start, rem):
        if rem == 0:
            res.append(cur[:]); return
        for i in range(start, len(candidates)):
            if candidates[i] > rem:
                break
            cur.append(candidates[i])
            bt(i, rem - candidates[i])   # reuse: i
            cur.pop()

    bt(0, target)
    return res


if __name__ == "__main__":
    print(combination_sum([2, 3, 6, 7], 7))
```

---

## Coding Challenge 4: Permutations II (with duplicates)

**Problem.** Given an array `nums` that may contain duplicates, return all **distinct** permutations.

**Example.** `nums = [1,1,2]` → `[[1,1,2],[1,2,1],[2,1,1]]`.

**Approach.** Sort; used-array; skip with `i>0 && nums[i]==nums[i-1] && !used[i-1]`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

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

func main() { fmt.Println(permuteUnique([]int{1, 1, 2})) }
```

#### Java
```java
import java.util.*;

public class PermuteUnique {
    public static List<List<Integer>> permuteUnique(int[] nums) {
        Arrays.sort(nums);
        List<List<Integer>> res = new ArrayList<>();
        bt(nums, new boolean[nums.length], new ArrayList<>(), res);
        return res;
    }
    static void bt(int[] a, boolean[] used, List<Integer> cur, List<List<Integer>> res) {
        if (cur.size() == a.length) { res.add(new ArrayList<>(cur)); return; }
        for (int i = 0; i < a.length; i++) {
            if (used[i]) continue;
            if (i > 0 && a[i] == a[i - 1] && !used[i - 1]) continue;
            used[i] = true; cur.add(a[i]);
            bt(a, used, cur, res);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }
    public static void main(String[] args) {
        System.out.println(permuteUnique(new int[]{1, 1, 2}));
    }
}
```

#### Python
```python
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


if __name__ == "__main__":
    print(permute_unique([1, 1, 2]))
```

---

## Final Tips

- **Always ask about duplicates** before coding — it changes the template.
- **Say the complexity out loud** and note it's output-sensitive (you can't beat `2^n`/`n!`).
- **Guard the two bugs explicitly**: copy on emit, un-choose after recurse.
- **Know the one-line discriminators**: `i` vs `i+1` (reuse vs once), `i>start` vs `!used[i-1]` (subset vs permutation dedup).
- **Mention streaming** for large `n` even if the interviewer only asks for the list — it shows production awareness.
- **Cross-check** small cases against the count formulas to prove correctness on the spot.

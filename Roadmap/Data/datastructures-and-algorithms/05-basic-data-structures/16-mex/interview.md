# MEX -- Interview Preparation

## Junior Questions (1-15)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is MEX? | Minimum excludant -- the smallest non-negative integer not present in the input set. |
| 2 | What is MEX of the empty set? | 0 by definition; always test this edge case. |
| 3 | What is MEX of `[0, 1, 2, 4]`? | 3 -- the first gap when scanning from 0. |
| 4 | What is MEX of `[1, 2, 3]`? | 0 -- because 0 is missing. |
| 5 | Why is `MEX(S) <= |S|`? | Pigeonhole: `|S|+1` candidates `{0..|S|}` are more than the size of S, so one must be missing. |
| 6 | Optimal time for whole-array MEX? | O(n) via bucket array. |
| 7 | Optimal space for whole-array MEX? | O(n) extra for the bucket. |
| 8 | What size bucket do you allocate? | `n+1` because MEX can equal `n`. |
| 9 | Why ignore values `> n` when marking the bucket? | They cannot be the MEX, and writing past `n+1` would be out-of-bounds. |
| 10 | Solve LeetCode 268 (Missing Number) with MEX. | The array is a permutation of `[0..n]` missing one; MEX of the array is the missing number. |
| 11 | Solve LeetCode 41 (First Missing Positive) with MEX. | 1-indexed MEX over positive integers; classic in-place cycle-sort gives O(n) time, O(1) space. |
| 12 | What if the input has negative numbers? | Ignore them -- MEX is defined over non-negative integers. |
| 13 | Are duplicates relevant to MEX? | No -- MEX is set-theoretic. `MEX([3, 3, 3]) = 0`. |
| 14 | Difference between MEX and median? | MEX is the smallest missing non-negative integer; median is the middle value of the sorted input. They are unrelated. |
| 15 | Why prefer bucket over hash set for whole-array MEX? | Cache locality and no hash overhead -- bucket is faster on typical hardware for any value range that fits. |

---

## Middle Questions (16-30)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 16 | When does the bucket approach fail and what do you switch to? | When values are unbounded (e.g., 10^18) and n is small; switch to a hash set scanning `0, 1, 2, ...`. |
| 17 | Implement dynamic MEX with insert/delete in O(log n) per op. | TreeSet of missing values, or segment tree on missing flags. |
| 18 | Is MEX monotone under inserts? | Yes, MEX is non-decreasing on insert. Under deletes it can drop arbitrarily. |
| 19 | Walk through MEX of every prefix in O(n) total. | Maintain a `mex` pointer and a bucket; after each insert advance the pointer while the bucket bit is set. Amortized O(1) per insert. |
| 20 | What is the time for "recompute MEX from scratch on every query" in a dynamic setting? | O(n) per query -- TLE for typical contest constraints. Use TreeSet or segment tree. |
| 21 | Sprague-Grundy theorem in one sentence? | Every impartial game position has a Grundy number equal to MEX of the Grundy numbers of reachable positions; the position is losing iff Grundy = 0. |
| 22 | Why MEX and not max+1 in Sprague-Grundy? | MEX is the unique operation that makes XOR of Grundy values compose game sums correctly. |
| 23 | Solve the subtraction game (remove 1, 3, or 4 stones; last to move wins). | Compute Grundy(n) = MEX({Grundy(n-1), Grundy(n-3), Grundy(n-4)}); P-positions are those with Grundy = 0. |
| 24 | Approach for range MEX queries `MEX(a[l..r])`. | Persistent segment tree (online, O(log n) per query) or offline Mo's with sqrt decomp. |
| 25 | What does the persistent segment tree store per value `v`? | Last occurrence index of `v` in the prefix; for `a[l..r]`, `v` is missing iff `last[v] < l`. |
| 26 | Bitset MEX -- how is it faster? | `BitSet.nextClearBit` (Java) or `__builtin_ffsll` (C) finds the first zero bit in O(n/64) using hardware instructions. |
| 27 | What is the worst case for the hash-set MEX approach? | Adversarial keys produce O(n^2) hashing; use the bucket version or a randomized hash. |
| 28 | Why does the incremental insert-only MEX achieve amortized O(1)? | The mex pointer is monotone non-decreasing under inserts; total advances across n inserts <= n. |
| 29 | Implement MEX for a multiset with frequency counts. | Track count per value; toggle "missing" flag only on `0 <-> 1` transitions. |
| 30 | How would you test a MEX implementation? | Empty, single, all duplicates, `{0..n-1}`, negatives mixed, very large values, after many deletes. |

---

## Senior Questions (31-40)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 31 | Design a distributed MEX over `k` shards. | Each shard ships a presence bitset capped at threshold `T`; coordinator OR-merges and reports first clear bit; adaptive `T` on overflow. |
| 32 | What metric tells you a MEX-based allocator is leaking IDs? | Pointer drift stays nonzero while allocation rate stays high but missing-set never grows -- IDs are allocated and never freed. |
| 33 | How would you make a MEX allocator thread-safe at 200k ops/sec? | Striped locks over value-range buckets; per-stripe bitset; global MEX = min over stripes. |
| 34 | When would you go lock-free instead of striped? | Sub-microsecond latency budgets where lock acquisition variance matters; cost is engineering complexity. |
| 35 | Detect a double-free in a MEX allocator. | Auxiliary bloom filter of allocated IDs; assert presence on free, absence on allocate. |
| 36 | Telemetry gap detection with MEX -- when does it fail? | When the window evicts unreceived sequence numbers before they're noticed; lengthen the window or persist beyond eviction. |
| 37 | Shard skew in distributed MEX -- symptom and fix? | Per-shard MEX values diverge widely; rebalance allocation routing or revisit shard key. |
| 38 | Capacity for 10^7 live IDs -- TreeSet vs BitSet? | BitSet wins: 1.25 MB vs ~500 MB for TreeSet of missing in Java; BitSet's MEX query is O(n/64), fast in practice. |
| 39 | Sprague-Grundy at scale -- how to shard the position table? | Hash positions, process by depth (topological wave); each wave reads only the previous wave's Grundy values. |
| 40 | What is the most diagnostic single metric for a MEX-based service? | MEX pointer drift -- rate of MEX increase per second compared against ingestion or allocation rate. |

---

## Professional Questions (41-50)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 41 | Prove `MEX(S) <= |S|`. | Pigeonhole on the `|S|+1` candidates `{0..|S|}` vs the at-most-`|S|` distinct elements of S. |
| 42 | Prove the bucket algorithm is correct. | Loop invariant: after the marking loop, `seen[k] = True iff k in support(a) and k in [0, n]`; the scan returns the smallest false index in `[0, n]`, which by the bound is MEX. |
| 43 | Amortized cost of incremental insert-only MEX? | O(1) per insert via potential method or aggregate counting -- mex pointer advances at most `n` times in total. |
| 44 | Range MEX via persistent segment tree -- query time? | O(log n) per query, O(n log n) preprocessing and space. |
| 45 | Lower bound for offline range MEX with `q = Theta(n)`? | `Omega((n + q) sqrt(n))` under natural models; matched by Mo's algorithm with sqrt-decomposed missing-min. |
| 46 | State the Sprague-Grundy theorem and explain why MEX is the right operation. | Every impartial game position has a Grundy number = MEX of reachable Grundies; MEX is the unique op that makes XOR-of-Grundies compose under game sums. |
| 47 | Prove XOR of Grundy values is the Grundy of the sum. | Reachability argument: every Grundy below `f(H) = G_1 XOR G_2` is reachable; `f(H)` itself is not -- so Grundy(H) = MEX(reachable) = f(H). |
| 48 | What is the expected MEX of a random multiset of size n drawn uniformly from [0, n]? | `Theta(n / log n)` -- much smaller than the worst-case n, so production observability typically sees small MEX. |
| 49 | Cache I/Os for bucket MEX when `n > M`? | The random-write phase becomes O(N) misses in worst case; switch to a cache-conscious bucketed marking variant for very large n. |
| 50 | First Missing Positive in O(1) extra space -- explain the technique. | In-place cycle sort: while `a[i] in [1, n]` and `a[a[i]-1] != a[i]`, swap. Then scan for the first index `i` with `a[i] != i+1`; answer is `i+1`. |

---

## Coding Challenge -- Prefix MEX in O(n)

> Given an array `a[0..n-1]` of non-negative integers, return an array `m[0..n-1]` where `m[i] = MEX(a[0..i])`.
>
> Time: O(n) total. Space: O(n).
>
> Test:
> - `[2, 0, 1, 3]` -> `[0, 0, 3, 4]`
> - `[1, 2, 3]` -> `[0, 0, 0]`
> - `[0]` -> `[1]`
> - `[]` -> `[]`
> - `[0, 0, 0, 1, 2]` -> `[1, 1, 1, 2, 3]`

The trick: keep a single `mex` pointer and a bucket. After each insert, advance the pointer while the bucket bit is set. Total pointer advances across all inserts is bounded by `n` (the pointer is monotone non-decreasing under inserts and bounded by `n`), so total work is O(n).

### Go

```go
package main

import "fmt"

// PrefixMEX returns m where m[i] = MEX(a[0..i]).
// Time: O(n) amortized. Space: O(n).
func PrefixMEX(a []int) []int {
    n := len(a)
    m := make([]int, n)
    seen := make([]bool, n+1)
    mex := 0
    for i, v := range a {
        if v >= 0 && v <= n {
            seen[v] = true
        }
        for mex <= n && seen[mex] {
            mex++
        }
        m[i] = mex
    }
    return m
}

func main() {
    tests := [][]int{
        {2, 0, 1, 3},
        {1, 2, 3},
        {0},
        {},
        {0, 0, 0, 1, 2},
    }
    for _, t := range tests {
        fmt.Printf("input=%v mex=%v\n", t, PrefixMEX(t))
    }
}
```

### Java

```java
import java.util.Arrays;

public class PrefixMEX {
    /**
     * Returns m where m[i] = MEX(a[0..i]).
     * The mex pointer is monotone non-decreasing under inserts, so total
     * advances are bounded by n -- O(n) total work, O(1) amortized per index.
     *
     * Time: O(n). Space: O(n).
     */
    public static int[] prefixMex(int[] a) {
        int n = a.length;
        int[] m = new int[n];
        boolean[] seen = new boolean[n + 1];
        int mex = 0;
        for (int i = 0; i < n; i++) {
            int v = a[i];
            if (v >= 0 && v <= n) seen[v] = true;
            while (mex <= n && seen[mex]) mex++;
            m[i] = mex;
        }
        return m;
    }

    public static void main(String[] args) {
        int[][] tests = {
            {2, 0, 1, 3},
            {1, 2, 3},
            {0},
            {},
            {0, 0, 0, 1, 2},
        };
        for (int[] t : tests) {
            System.out.printf("input=%s mex=%s%n",
                Arrays.toString(t), Arrays.toString(prefixMex(t)));
        }
    }
}
```

### Python

```python
"""Prefix MEX in O(n) total time."""

from typing import List


def prefix_mex(a: List[int]) -> List[int]:
    """
    Return m where m[i] = MEX(a[0..i]).

    Single bucket of size n+1 + a monotone mex pointer. The pointer is
    advanced lazily: only the work needed to confirm the current value's
    presence is paid. Total pointer advances across all inserts <= n,
    giving O(n) total work.

    Time: O(n). Space: O(n).
    """
    n = len(a)
    m = [0] * n
    seen = [False] * (n + 1)
    mex = 0
    for i, v in enumerate(a):
        if 0 <= v <= n:
            seen[v] = True
        while mex <= n and seen[mex]:
            mex += 1
        m[i] = mex
    return m


if __name__ == "__main__":
    tests = [
        [2, 0, 1, 3],
        [1, 2, 3],
        [0],
        [],
        [0, 0, 0, 1, 2],
    ]
    for t in tests:
        print(f"input={t} mex={prefix_mex(t)}")
```

---

## Whiteboard Walkthrough -- First Missing Positive (LeetCode 41)

A classic MEX-flavored interview question with an elegant O(n) time, O(1) extra space solution.

**Problem.** Given an unsorted integer array `nums`, return the smallest missing positive integer.

**Example.** `[3, 4, -1, 1]` -> `2`.

**Key insight.** The answer is in `[1, n+1]` (1-indexed pigeonhole). Use the array itself as the bucket: for each `i`, swap `nums[i]` to its target index `nums[i] - 1` (if it is in range and not already there). After the pass, the first index `i` where `nums[i] != i + 1` is the answer (`i + 1`); if all match, the answer is `n + 1`.

### Go

```go
package main

import "fmt"

func FirstMissingPositive(nums []int) int {
    n := len(nums)
    for i := 0; i < n; i++ {
        for nums[i] >= 1 && nums[i] <= n && nums[nums[i]-1] != nums[i] {
            nums[i], nums[nums[i]-1] = nums[nums[i]-1], nums[i]
        }
    }
    for i := 0; i < n; i++ {
        if nums[i] != i+1 {
            return i + 1
        }
    }
    return n + 1
}

func main() {
    fmt.Println(FirstMissingPositive([]int{3, 4, -1, 1})) // 2
    fmt.Println(FirstMissingPositive([]int{1, 2, 0}))     // 3
    fmt.Println(FirstMissingPositive([]int{7, 8, 9, 11})) // 1
}
```

### Java

```java
public class FirstMissingPositive {
    public static int firstMissingPositive(int[] nums) {
        int n = nums.length;
        for (int i = 0; i < n; i++) {
            while (nums[i] >= 1 && nums[i] <= n && nums[nums[i] - 1] != nums[i]) {
                int t = nums[nums[i] - 1];
                nums[nums[i] - 1] = nums[i];
                nums[i] = t;
            }
        }
        for (int i = 0; i < n; i++) {
            if (nums[i] != i + 1) return i + 1;
        }
        return n + 1;
    }

    public static void main(String[] args) {
        System.out.println(firstMissingPositive(new int[]{3, 4, -1, 1})); // 2
        System.out.println(firstMissingPositive(new int[]{1, 2, 0}));     // 3
        System.out.println(firstMissingPositive(new int[]{7, 8, 9, 11})); // 1
    }
}
```

### Python

```python
def first_missing_positive(nums):
    n = len(nums)
    for i in range(n):
        while 1 <= nums[i] <= n and nums[nums[i] - 1] != nums[i]:
            j = nums[i] - 1
            nums[i], nums[j] = nums[j], nums[i]
    for i in range(n):
        if nums[i] != i + 1:
            return i + 1
    return n + 1


print(first_missing_positive([3, 4, -1, 1]))  # 2
print(first_missing_positive([1, 2, 0]))      # 3
print(first_missing_positive([7, 8, 9, 11]))  # 1
```

**Why this is O(n).** Each swap places at least one value at its correct index. There are `n` indices, so the total number of swaps across the outer loop is at most `n`. The inner while looks unbounded but is amortized O(1) per outer iteration.

---

## Whiteboard Walkthrough -- Grundy Values for Nim Variants

Another common interview topic: compute Grundy numbers and use XOR to decide the winner.

**Problem (Bouton's Nim).** Three piles of sizes `(a, b, c)`. Each turn, remove any positive number of stones from one pile. Last to move wins. Who wins under optimal play?

**Answer.** XOR of pile sizes. If `a XOR b XOR c == 0`, the player to move loses; else they win.

**Why.** For a single pile of size `k`, the reachable Grundies are `{0, 1, ..., k-1}` (move to any smaller pile), so `Grundy(k) = MEX({0..k-1}) = k`. By Sprague-Grundy, the Grundy of the three-pile sum is `Grundy(a) XOR Grundy(b) XOR Grundy(c) = a XOR b XOR c`.

### Python: Nim with arbitrary move sets

```python
from functools import lru_cache


def nim_grundy(piles, moves):
    """Grundy number of a multi-pile Nim variant with restricted moves."""
    @lru_cache(maxsize=None)
    def g(n):
        if n == 0:
            return 0
        reach = set()
        for m in moves:
            if n >= m:
                reach.add(g(n - m))
        gv = 0
        while gv in reach:
            gv += 1
        return gv

    xor = 0
    for p in piles:
        xor ^= g(p)
    return xor


# Standard Nim: any positive removal.
# We approximate by moves = 1..max(piles) for small piles.
def standard_nim_winner(piles):
    return "first" if (piles[0] ^ piles[1] ^ piles[2]) else "second"


print(standard_nim_winner([3, 4, 5]))  # first (3^4^5 = 2 != 0)
print(standard_nim_winner([1, 2, 3]))  # second (1^2^3 = 0)
```

The MEX-of-reachable-grundies pattern is the same in every impartial-game problem. Memorize it.

---

## Mistakes Interviewers Watch For

| Mistake | What it tells the interviewer |
|---------|-------------------------------|
| Bucket of size `max(arr) + 1` instead of `n + 1` | Candidate did not prove the `MEX <= n` bound; memorization without understanding. |
| Returning -1 for empty input | Forgot MEX(empty) = 0; ask the candidate to derive it. |
| Off-by-one in pigeonhole | "The bound is `n`, not `n - 1`" -- ask them to show the tight case `{0..n-1}`. |
| Hash set without bucket fallback | Did not consider adversarial hashing; ask about value range. |
| Recomputing MEX per query in dynamic setting | Did not recognize the dynamic-MEX problem family; nudge toward TreeSet. |
| Wrong strictness in incremental MEX | The advance loop should be `while seen[mex]`, not `if`. |
| Confusing Grundy with `max + 1` | Critical for Sprague-Grundy; ask why MEX specifically. |
| Forgetting negative-value filter | `seen[-1] = True` crashes; should guard `v >= 0`. |
| Using `set(arr)` allocation when bucket works | Wasteful; interviewers note algorithmic taste. |

---

## How to Approach a New MEX Problem

A four-step recipe to verbalize:

1. **Static or dynamic?** If the set never changes, bucket. If it does, TreeSet of missing or segment tree.
2. **Value range bounded?** If unbounded, hash set scanning upward. If bounded by `n`, bucket of size `n + 1`.
3. **One MEX or many?** One: just compute. Many on the same array: prefix-MEX in O(n) or range-MEX with persistent seg tree.
4. **Game theory?** If the problem mentions players, moves, or "last to move wins," it is Sprague-Grundy -- compute Grundies via MEX-of-reachable and XOR them.

Verbalizing these four questions before coding shows clear thinking, which is half of what is graded.

---

## Quick-Recall Cheat Sheet

| Setting | Best structure | Time | Space |
|---------|----------------|------|-------|
| Static whole-array MEX | Bucket array | O(n) | O(n) |
| Static, huge value range | Hash set scan | O(n) avg | O(n) |
| Dynamic insert/delete | TreeSet of missing | O(log n) per op | O(n) |
| Dynamic, integer cap | Segment tree on missing | O(log n) per op | O(n) |
| Insert-only, MEX after each | Incremental MEX pointer | O(1) amortized | O(n) |
| Range MEX online | Persistent segment tree | O(log n) per query | O(n log n) |
| Range MEX offline | Mo's + sqrt | O((n+q) sqrt n) | O(n) |
| Sprague-Grundy small states | Memoized recursion | O(states * branching) | O(states) |
| Sprague-Grundy XOR of sums | XOR per game | O(games) | O(1) |
| First Missing Positive | In-place cycle sort | O(n) | O(1) |

If you remember the table, you can pick the right MEX variant for any prompt under interview pressure.

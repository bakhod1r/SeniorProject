# Longest Common Subsequence (LCS) and Longest Increasing Subsequence (LIS) — Middle Level

> **Focus:** Reconstructing the actual subsequences (not just lengths), shrinking LCS memory from `O(nm)` to two rows, *deriving* why the patience LIS is `O(n log n)` and why `tails` stays sorted, the non-decreasing variant, the surprising **LCS↔LIS reduction for permutations**, and a clean contrast between subsequence and substring.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [LCS ↔ LIS Reduction for Permutations](#lcs--lis-reduction-for-permutations)
6. [Substring vs Subsequence](#substring-vs-subsequence)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was: LCS is an `O(nm)` table, LIS is `O(n²)` or `O(n log n)`. At middle level the engineering questions appear:

- How do I recover the *actual* subsequence, and how does reconstruction interact with **space optimization**?
- *Why* is the patience LIS correct, and *why* does the `tails` array stay sorted so binary search applies?
- What changes for the **non-decreasing** variant — and why is it exactly one operator?
- When can I solve LCS in `O(n log n)` instead of `O(nm)` — the **permutation reduction**?
- How do I keep substring and subsequence straight when both are `O(nm)` table DPs?

These separate "I memorized the recurrence" from "I can adapt it to the problem in front of me."

---

## Deeper Concepts

### LCS recurrence, restated with the optimal-substructure reason

Let `dp[i][j]` = LCS length of `X[0..i)` and `Y[0..j)`. The recurrence is correct because of **optimal substructure**: consider the last characters.

- If `X[i-1] == Y[j-1] = c`: there exists an optimal LCS that *uses* this matched `c` as its last character. (If some optimal LCS did not use it, you could append `c` and never shorten — a swap argument formalized in `professional.md`.) So `dp[i][j] = dp[i-1][j-1] + 1`.
- If `X[i-1] ≠ Y[j-1]`: an optimal LCS cannot use *both* last characters as its last element (they differ), so it omits at least one. Try omitting each: `dp[i][j] = max(dp[i-1][j], dp[i][j-1])`.

Each cell depends only on its top, left, and top-left neighbors. That dependency pattern is exactly what lets us discard old rows.

### Space optimization: two rows, then one

Because `dp[i][j]` needs only row `i-1` and the current row `i`, you can keep **two rows** instead of the whole `(n+1)×(m+1)` grid: space drops from `O(nm)` to `O(m)` (or `O(min(n,m))` if you make the *shorter* string index the columns). You can even collapse to **one row** by saving the single "diagonal" value (`dp[i-1][j-1]`) in a temporary before overwriting:

```
prev = 0                       # holds dp[i-1][j-1]
for j in 1..m:
    tmp = dp[j]                # this is dp[i-1][j] before overwrite
    if X[i-1] == Y[j-1]: dp[j] = prev + 1
    else:                dp[j] = max(dp[j], dp[j-1])
    prev = tmp
```

**The catch:** with two/one rows you get the *length* but lose the full table needed for the simple `O(n+m)` traceback. To recover the subsequence in linear space you need **Hirschberg's algorithm** (`senior.md`), which uses divide-and-conquer to reconstruct in `O(nm)` time and `O(min(n,m))` space. So: *length-only → two rows; subsequence in linear space → Hirschberg; subsequence with `O(nm)` space available → keep the full table and trace back.*

### Why the patience LIS is `O(n log n)`

The patience method maintains `tails`, where `tails[k]` = the smallest tail value among all increasing subsequences of length `k+1` discovered so far. Two facts make it work:

1. **`tails` is always strictly increasing (sorted).** A length-`(k+1)` subsequence's smallest tail must be smaller than a length-`(k+2)` subsequence's smallest tail (drop the last element of the longer one to get a shorter one with a strictly smaller tail). So `tails[0] < tails[1] < …` — proof in `professional.md`. Sortedness is what licenses binary search.
2. **Each element triggers one binary search + one update.** For value `x`, find the leftmost `p` with `tails[p] >= x`. If none, `x` extends the longest run (append). Otherwise `x` is a smaller tail for length `p+1` (overwrite `tails[p]`). Either way, `len(tails)` is the current LIS length.

`n` elements × `O(log n)` per search = **`O(n log n)`**. Crucially `len(tails)` is always exactly the LIS length seen so far, even though `tails` itself may not be a real subsequence.

### Reconstructing the actual LIS

`tails` gives only the length. To recover the subsequence, store, for each input index, *which length it achieved* and *who its predecessor was*:

```
tails_idx[k] = input index of the element currently at tails[k]
parent[i]    = input index of the predecessor of element i in its run
```

When you place `a[i]` at position `p`, set `tails_idx[p] = i` and `parent[i] = tails_idx[p-1]` (or `-1` if `p == 0`). At the end, start from `tails_idx[len-1]` and follow `parent` pointers backward, then reverse. This keeps the whole thing `O(n log n)` time and `O(n)` space. (Full code below.)

### Non-decreasing variant: one operator

"Longest non-decreasing subsequence" allows `a ≤ b ≤ c` (equal neighbors permitted). The *only* change to the patience method:

- **Strict (increasing):** search for the leftmost `tails[p] >= x` (`lower_bound` / `bisect_left`). Equal values do not extend a run.
- **Non-decreasing:** search for the leftmost `tails[p] > x` (`upper_bound` / `bisect_right`). Equal values *do* extend.

Same for the `O(n²)` DP: use `a[j] < a[i]` for strict, `a[j] <= a[i]` for non-decreasing. Getting this one comparison wrong is the most common LIS bug.

---

## Comparison with Alternatives

### LIS: `O(n²)` DP vs `O(n log n)` patience

| Approach | Time | Space | Gives subsequence? | Good when |
|----------|------|-------|--------------------|-----------|
| Brute force (all subsequences) | `O(2^n · n)` | `O(n)` | yes | only `n ≤ 20`, as an oracle |
| `O(n²)` DP | `O(n²)` | `O(n)` | yes (parent ptr) | small `n`, or need all per-index `dp` values |
| **Patience + binary search** | **`O(n log n)`** | `O(n)` | yes (tails_idx + parent) | the default for large `n` |
| Segment-tree / BIT DP | `O(n log n)` | `O(n)` | yes | when extra range queries are needed |

Concrete crossover (`n` elements):

| `n` | `O(n²)` ops | `O(n log n)` ops | Winner |
|-----|-------------|------------------|--------|
| 100 | 10 000 | ~660 | tie (both instant) |
| 10⁴ | 10⁸ | ~130 000 | patience |
| 10⁶ | 10¹² (infeasible) | ~20 M | patience |

For `n` beyond a few thousand, the patience method is the only practical choice.

### LCS: full table vs space-optimized vs Hirschberg

| Need | Method | Time | Space |
|------|--------|------|-------|
| Length only | two-row DP | `O(nm)` | `O(min(n,m))` |
| Length + subsequence, memory ample | full table + traceback | `O(nm)` | `O(nm)` |
| Length + subsequence, memory tight | Hirschberg (senior) | `O(nm)` | `O(min(n,m))` |
| LCS of two *permutations* | reduce to LIS | `O(n log n)` | `O(n)` |

The permutation reduction is the dramatic win: when both inputs are permutations of the same alphabet (each symbol appears once in each), LCS collapses to a single LIS in `O(n log n)`.

---

## Advanced Patterns

### Pattern: LCS length in O(min(n,m)) space (two rows)

#### Go

```go
package main

import "fmt"

func lcsLen(X, Y string) int {
	// ensure Y is the shorter string -> columns = min length
	if len(Y) > len(X) {
		X, Y = Y, X
	}
	n, m := len(X), len(Y)
	prev := make([]int, m+1)
	cur := make([]int, m+1)
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if X[i-1] == Y[j-1] {
				cur[j] = prev[j-1] + 1
			} else if prev[j] >= cur[j-1] {
				cur[j] = prev[j]
			} else {
				cur[j] = cur[j-1]
			}
		}
		prev, cur = cur, prev // reuse buffers
	}
	return prev[m]
}

func main() {
	fmt.Println(lcsLen("AGCAT", "GAC")) // 2
}
```

#### Java

```java
public class LcsTwoRow {
    static int lcsLen(String X, String Y) {
        if (Y.length() > X.length()) { String t = X; X = Y; Y = t; }
        int n = X.length(), m = Y.length();
        int[] prev = new int[m + 1], cur = new int[m + 1];
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                if (X.charAt(i - 1) == Y.charAt(j - 1))
                    cur[j] = prev[j - 1] + 1;
                else
                    cur[j] = Math.max(prev[j], cur[j - 1]);
            }
            int[] tmp = prev; prev = cur; cur = tmp;
        }
        return prev[m];
    }

    public static void main(String[] args) {
        System.out.println(lcsLen("AGCAT", "GAC")); // 2
    }
}
```

#### Python

```python
def lcs_len(X, Y):
    if len(Y) > len(X):
        X, Y = Y, X
    m = len(Y)
    prev = [0] * (m + 1)
    cur = [0] * (m + 1)
    for i in range(1, len(X) + 1):
        for j in range(1, m + 1):
            if X[i - 1] == Y[j - 1]:
                cur[j] = prev[j - 1] + 1
            else:
                cur[j] = max(prev[j], cur[j - 1])
        prev, cur = cur, prev
    return prev[m]


if __name__ == "__main__":
    print(lcs_len("AGCAT", "GAC"))  # 2
```

### Pattern: LIS reconstruction in O(n log n)

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func lisReconstruct(a []int) []int {
	n := len(a)
	if n == 0 {
		return nil
	}
	tails := []int{}      // tail values
	tailsIdx := []int{}   // input index at each tails position
	parent := make([]int, n)
	for i := range parent {
		parent[i] = -1
	}
	for i, x := range a {
		p := sort.SearchInts(tails, x) // strict: leftmost tails[p] >= x
		if p > 0 {
			parent[i] = tailsIdx[p-1]
		}
		if p == len(tails) {
			tails = append(tails, x)
			tailsIdx = append(tailsIdx, i)
		} else {
			tails[p] = x
			tailsIdx[p] = i
		}
	}
	// walk parents back from the last element of the longest run
	res := []int{}
	for k := tailsIdx[len(tailsIdx)-1]; k != -1; k = parent[k] {
		res = append(res, a[k])
	}
	for l, r := 0, len(res)-1; l < r; l, r = l+1, r-1 {
		res[l], res[r] = res[r], res[l]
	}
	return res
}

func main() {
	fmt.Println(lisReconstruct([]int{10, 9, 2, 5, 3, 7, 101, 18})) // [2 3 7 101]
}
```

#### Java

```java
import java.util.*;

public class LisReconstruct {
    static List<Integer> lis(int[] a) {
        int n = a.length;
        if (n == 0) return new ArrayList<>();
        List<Integer> tails = new ArrayList<>();
        List<Integer> tailsIdx = new ArrayList<>();
        int[] parent = new int[n];
        Arrays.fill(parent, -1);
        for (int i = 0; i < n; i++) {
            int lo = 0, hi = tails.size();
            while (lo < hi) {                 // strict: leftmost >= a[i]
                int mid = (lo + hi) >>> 1;
                if (tails.get(mid) < a[i]) lo = mid + 1;
                else hi = mid;
            }
            if (lo > 0) parent[i] = tailsIdx.get(lo - 1);
            if (lo == tails.size()) { tails.add(a[i]); tailsIdx.add(i); }
            else { tails.set(lo, a[i]); tailsIdx.set(lo, i); }
        }
        LinkedList<Integer> res = new LinkedList<>();
        for (int k = tailsIdx.get(tailsIdx.size() - 1); k != -1; k = parent[k])
            res.addFirst(a[k]);
        return res;
    }

    public static void main(String[] args) {
        System.out.println(lis(new int[]{10, 9, 2, 5, 3, 7, 101, 18})); // [2, 3, 7, 101]
    }
}
```

#### Python

```python
from bisect import bisect_left


def lis_reconstruct(a):
    n = len(a)
    if n == 0:
        return []
    tails = []          # tail values
    tails_idx = []      # input index at each tails position
    parent = [-1] * n
    for i, x in enumerate(a):
        p = bisect_left(tails, x)   # strict
        if p > 0:
            parent[i] = tails_idx[p - 1]
        if p == len(tails):
            tails.append(x)
            tails_idx.append(i)
        else:
            tails[p] = x
            tails_idx[p] = i
    res = []
    k = tails_idx[-1]
    while k != -1:
        res.append(a[k])
        k = parent[k]
    return res[::-1]


if __name__ == "__main__":
    print(lis_reconstruct([10, 9, 2, 5, 3, 7, 101, 18]))  # [2, 3, 7, 101]
```

### Pattern: non-decreasing LIS (one-line change)

```python
from bisect import bisect_right


def lnds_length(a):
    tails = []
    for x in a:
        p = bisect_right(tails, x)   # > x  (allows equal -> non-decreasing)
        if p == len(tails):
            tails.append(x)
        else:
            tails[p] = x
    return len(tails)

# lnds_length([1, 2, 2, 2, 3]) == 5   (vs strict LIS == 3)
```

---

## LCS ↔ LIS Reduction for Permutations

This is the most elegant connection in the topic. **When both sequences are permutations of the same set of distinct symbols** (every symbol appears exactly once in each), the LCS reduces to an LIS solvable in `O(n log n)` instead of `O(nm)`.

### The construction

1. Record, for each symbol `s`, its **position in `Y`**: `posInY[s]`.
2. Walk through `X` left to right and replace each symbol `s` by `posInY[s]`, producing an integer array `B`.
3. **The LIS of `B` is exactly the LCS length of `X` and `Y`.**

**Why it works.** A common subsequence is a set of symbols that appears in the same relative order in *both* strings. By construction, scanning `X` (which fixes the `X`-order) and reading off positions-in-`Y`, an *increasing* run in `B` is precisely a set of symbols that is also in increasing `Y`-order — i.e. a subsequence that respects *both* orders. The longest such run is the LCS. (Formal proof in `professional.md`.)

If a symbol can appear in `Y` but not `X` (or vice versa) it simply contributes no entry; the requirement is only that within each string symbols are distinct, so the position map is well-defined. (For general strings with repeats, this exact trick does not apply — that is why general LCS stays `O(nm)`.)

### Worked example

```
X = C A B D E
Y = A B C D E

posInY: A→0, B→1, C→2, D→3, E→4
B = [posInY[C], posInY[A], posInY[B], posInY[D], posInY[E]]
  = [2,         0,         1,         3,         4]

LIS of [2, 0, 1, 3, 4] = [0, 1, 3, 4]  (length 4)
=> LCS length of X and Y is 4   (the symbols A,B,D,E in order)
```

Brute force confirms: `ABDE` is a common subsequence of `CABDE` and `ABCDE`, length 4. ✓

### Code

#### Python

```python
from bisect import bisect_left


def lcs_permutations(X, Y):
    pos_in_y = {s: i for i, s in enumerate(Y)}
    # symbols of X that also occur in Y, mapped to their Y position
    b = [pos_in_y[s] for s in X if s in pos_in_y]
    tails = []
    for x in b:
        p = bisect_left(tails, x)
        if p == len(tails):
            tails.append(x)
        else:
            tails[p] = x
    return len(tails)


if __name__ == "__main__":
    print(lcs_permutations("CABDE", "ABCDE"))  # 4
```

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func lcsPermutations(X, Y string) int {
	posInY := make(map[byte]int)
	for i := 0; i < len(Y); i++ {
		posInY[Y[i]] = i
	}
	b := []int{}
	for i := 0; i < len(X); i++ {
		if p, ok := posInY[X[i]]; ok {
			b = append(b, p)
		}
	}
	tails := []int{}
	for _, x := range b {
		p := sort.SearchInts(tails, x)
		if p == len(tails) {
			tails = append(tails, x)
		} else {
			tails[p] = x
		}
	}
	return len(tails)
}

func main() {
	fmt.Println(lcsPermutations("CABDE", "ABCDE")) // 4
}
```

#### Java

```java
import java.util.*;

public class LcsPerm {
    static int lcsPermutations(String X, String Y) {
        Map<Character, Integer> posInY = new HashMap<>();
        for (int i = 0; i < Y.length(); i++) posInY.put(Y.charAt(i), i);
        List<Integer> b = new ArrayList<>();
        for (char c : X.toCharArray())
            if (posInY.containsKey(c)) b.add(posInY.get(c));
        List<Integer> tails = new ArrayList<>();
        for (int x : b) {
            int lo = 0, hi = tails.size();
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (tails.get(mid) < x) lo = mid + 1;
                else hi = mid;
            }
            if (lo == tails.size()) tails.add(x);
            else tails.set(lo, x);
        }
        return tails.size();
    }

    public static void main(String[] args) {
        System.out.println(lcsPermutations("CABDE", "ABCDE")); // 4
    }
}
```

This is the Hunt–Szymanski idea in miniature: when matches are sparse (distinct symbols), counting them via an LIS is far cheaper than the dense `O(nm)` table. Real `diff` tools exploit exactly this when most lines are unique.

---

## Substring vs Subsequence

Both are `(n+1)×(m+1)` table DPs, and confusing them is the single biggest trap.

| | Longest Common **Subsequence** | Longest Common **Substring** |
|---|--------------------------------|------------------------------|
| Match must be contiguous? | No (gaps allowed) | **Yes** |
| Recurrence on match | `dp[i][j] = dp[i-1][j-1] + 1` | `dp[i][j] = dp[i-1][j-1] + 1` |
| Recurrence on mismatch | `dp[i][j] = max(dp[i-1][j], dp[i][j-1])` | `dp[i][j] = 0` (**reset**) |
| Answer location | corner `dp[n][m]` | **max cell anywhere** |
| Example (`ABCBDAB`, `BDCAB`) | `BCAB` (len 4) | `AB` or `CA`-style len 2 |

The only differences are the mismatch branch (carry-the-max vs reset-to-zero) and where you read the answer.

#### Python — longest common substring

```python
def longest_common_substring(X, Y):
    n, m = len(X), len(Y)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    best, end_i = 0, 0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if X[i - 1] == Y[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                if dp[i][j] > best:
                    best, end_i = dp[i][j], i
            # else dp[i][j] stays 0 (reset)
    return X[end_i - best:end_i]  # the substring itself


if __name__ == "__main__":
    print(longest_common_substring("ABCBDAB", "BDCAB"))  # length-2 contiguous match
```

(Longest common substring also has an `O(n+m)` suffix-automaton/suffix-tree solution — see `string-algorithms` — but the DP is the clearest contrast here.)

---

## Code Examples

### Reusable LIS that returns both length and subsequence (Python)

```python
from bisect import bisect_left, bisect_right


def lis(a, strict=True):
    """Return (length, subsequence). strict=True -> increasing; False -> non-decreasing."""
    n = len(a)
    if n == 0:
        return 0, []
    search = bisect_left if strict else bisect_right
    tails, tails_idx, parent = [], [], [-1] * n
    for i, x in enumerate(a):
        p = search(tails, x)
        if p > 0:
            parent[i] = tails_idx[p - 1]
        if p == len(tails):
            tails.append(x)
            tails_idx.append(i)
        else:
            tails[p] = x
            tails_idx[p] = i
    seq, k = [], tails_idx[-1]
    while k != -1:
        seq.append(a[k])
        k = parent[k]
    return len(tails), seq[::-1]


if __name__ == "__main__":
    print(lis([10, 9, 2, 5, 3, 7, 101, 18]))            # (4, [2, 3, 7, 101])
    print(lis([1, 2, 2, 2, 3], strict=False))           # (5, [1, 2, 2, 2, 3])
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Need subsequence but only kept two rows | Two-row DP has no traceback table | Use full table, or Hirschberg for linear space |
| Wrong LIS variant | `bisect_left` used for non-decreasing | `bisect_left` = strict; `bisect_right` = non-decreasing |
| Reading `tails` as the answer sequence | `tails` is not a valid subsequence | Reconstruct via `tails_idx` + `parent` |
| Permutation reduction on strings with repeats | `posInY` map is ambiguous | Reduction needs distinct symbols; fall back to `O(nm)` LCS |
| Substring vs subsequence | Used corner cell for substring | Substring resets on mismatch; answer is the max cell |
| Empty input | Index error on `tails_idx[-1]` | Return `(0, [])` for empty arrays |

---

## Performance Analysis

| Input size | LCS `O(nm)` table | LIS `O(n²)` | LIS `O(n log n)` |
|------------|-------------------|-------------|-------------------|
| `n=m=100` | 10 000 cells | 10 000 | ~660 |
| `n=m=1 000` | 1 M cells | 1 M | ~10 000 |
| `n=m=10 000` | 100 M cells | 100 M | ~130 000 |
| `n=m=100 000` | 10¹⁰ cells (heavy) | 10¹⁰ (infeasible) | ~1.7 M |

The LCS table is `O(nm)` in both time and space — at `100k × 100k` that is 10^10 cells, which is why two very long files need space optimization, Hirschberg, or the sparse Hunt–Szymanski method. The fast LIS scales comfortably to millions of elements.

```python
import time, random

def bench_lis(n):
    a = [random.randint(0, 10**9) for _ in range(n)]
    t = time.perf_counter()
    _ = lis(a)            # the reusable version above
    return time.perf_counter() - t

# n = 1_000_000 typically completes in well under a second in CPython.
```

The biggest constant-factor win for LCS is making the **shorter** string index the inner loop (smaller rows, better cache); for LIS it is using a real binary search rather than scanning `tails`.

---

## Best Practices

- **Decide length-only vs subsequence first.** It dictates two-row DP vs full table vs Hirschberg.
- **Make the shorter string the columns** in LCS to minimize row width and memory.
- **Pick the binary-search variant deliberately:** `lower_bound` for strict LIS, `upper_bound` for non-decreasing.
- **Reconstruct LIS with parent pointers**, never by reading `tails`.
- **Use the permutation reduction** whenever both inputs are distinct-symbol permutations — `O(n log n)` beats `O(nm)`.
- **Keep substring and subsequence code in separate, clearly named functions** to avoid the reset-vs-max mistake.
- **Always test against the brute-force oracle** on random small inputs.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The LCS table fill with match cells (diagonal +1) vs mismatch cells (max of up/left), and the traceback path.
> - The LIS **patience piles** mode: each value placed on the leftmost pile whose top is `≥` it, with the binary-search index highlighted and `len(tails)` shown as the running LIS length.
> - A toggle illustrating strict vs non-decreasing placement (`>=` vs `>`).

---

## Summary

Middle-level LCS/LIS is about going beyond lengths. **LCS reconstruction** traces back through the table; if you only keep two rows for `O(min(n,m))` space you lose that traceback and must reach for **Hirschberg** (senior) to reconstruct in linear space. **LIS** is `O(n log n)` because `tails` — the smallest-tail-per-length array — stays sorted, so each element costs one binary search; the actual subsequence comes from `tails_idx` + `parent` pointers, never from `tails` directly. The **non-decreasing** variant is exactly one operator (`upper_bound` instead of `lower_bound`). The headline connection is the **permutation reduction**: LCS of two distinct-symbol permutations equals the LIS of `X` relabelled by `Y`-positions, turning `O(nm)` into `O(n log n)`. And never conflate **subsequence** (gaps allowed, carry-the-max, read the corner) with **substring** (contiguous, reset-on-mismatch, read the max cell). Master reconstruction, the patience proof, and the reduction, and the senior-level production concerns (memory-bound diff, huge inputs) become natural extensions.

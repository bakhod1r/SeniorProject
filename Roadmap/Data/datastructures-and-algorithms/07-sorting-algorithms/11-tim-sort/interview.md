# Tim Sort — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Tim Sort and where is it used? | Hybrid of Merge + Binary Insertion Sort, production default in Python (`sorted`), Java (`Arrays.sort` for objects), JavaScript V8, Android |
| 2 | What's the time complexity of Tim Sort? | Best O(n) on sorted/reverse-sorted, Average/Worst O(n log n), Space O(n) |
| 3 | Is Tim Sort stable? Why does that matter? | Yes. Stability preserves order of equal keys; required when sorting by multiple criteria or maintaining insertion order semantics |
| 4 | What's the difference between Tim Sort and plain Merge Sort? | Tim adds run detection, `minrun` padding via Binary Insertion, and stack-invariant-driven merging; this makes it adaptive (O(n) on sorted input) |
| 5 | What is a "run" in Tim Sort? | A maximal already-sorted (ascending or strictly descending) subsequence in the input |
| 6 | Why does Tim Sort use Insertion Sort for small subarrays? | Insertion Sort is fast on tiny arrays (low constants, cache-friendly); Merge Sort's recursion overhead dominates below ~32 elements |
| 7 | When does Java's `Arrays.sort` use Tim Sort vs another sort? | TimSort for `Object[]`; Dual-Pivot Quicksort for primitives like `int[]` |
| 8 | What's `minrun` and why is it 32-64? | Minimum length runs are padded to; chosen so `n / minrun` is just below a power of 2 to balance the merge tree |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Explain the stack invariants Tim Sort maintains. | `A > B + C` and `B > C` (top three lengths); they bound stack depth at O(log n) and keep merges balanced |
| 2 | What is "galloping mode" and when does it trigger? | After `min_gallop` (default 7) consecutive wins from one side during merge, switch to exponential search to bulk-copy long runs |
| 3 | Why is descending run detection strict (`<`) while ascending is non-strict (`<=`)? | To preserve stability — equal elements must never be in a "descending" run that gets reversed |
| 4 | How does Tim Sort handle nearly-sorted input? | Detects natural runs, merges them with few comparisons via galloping; runtime becomes O(n + n log R) where R = number of runs |
| 5 | Why is Tim Sort not in-place? | The merge step needs O(min(\|L\|, \|R\|)) auxiliary buffer; merging in-place is possible but much slower in practice |
| 6 | Implement Binary Insertion Sort. | `for i in 1..n: binary_search to find pos in arr[0..i]; shift right; insert` |
| 7 | What's the worst-case input for Tim Sort? | Carefully constructed input that triggers maximum merges with no galloping benefit (random data near 2^k length) — still O(n log n) |
| 8 | Compare Tim Sort with pdqsort. | Tim: stable, O(n) extra space, adaptive on runs. Pdqsort: unstable, O(log n) extra space, adaptive via pattern detection (sorted-check, equal-runs) |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Design a sort for an event-streaming system processing 1B events/day, sorted by timestamp. | Chunk into in-memory pieces, TimSort each chunk (events arrive near-sorted by timestamp → ~O(n)), k-way merge with heap, output to disk |
| 2 | When would you choose pdqsort over TimSort in production code? | Sorting primitives where stability isn't needed; memory-constrained environments; tight cache-bound numeric loops |
| 3 | What's the 2015 TimSort bug and how was it fixed? | Stack invariant only checked top-3 entries; deep violation could overflow preallocated stack. Fixed by increasing stack to 49 (Java) and adding depth-4 check (Python) |
| 4 | How does parallel Tim Sort work? | Split into chunks (1 per worker), TimSort each on a ForkJoinPool worker, parallel pairwise merge tree at the end. ~3-5× speedup on 8 cores |
| 5 | Why does V8 (JavaScript) use TimSort? | ECMAScript 2019 mandated stable sort. V8 migrated from QuickSort to TimSort in 2018; ~10-15% real-world page-load speedup |
| 6 | A comparator throws `IllegalArgumentException: Comparison method violates its general contract`. Diagnose. | Comparator is non-transitive or inconsistent. Common cause: `(a, b) -> a.field - b.field` overflows for large `int`. Use `Integer.compare`. |
| 7 | How would you observe Tim Sort behavior in production? | Track sort duration p99, input size p99, run count avg (low = adaptive wins, high = pdqsort might be better), gallop engagements, max stack depth |
| 8 | Why does Java split sorts by primitive vs object type? | Primitives: cache-friendly, no stability needed, no boxing → Dual-Pivot Quicksort wins. Objects: stability matters, expensive comparators → TimSort + galloping wins |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove that Tim Sort's stack depth is O(log n). | Invariants force lengths to grow at least Fibonacci-fast bottom-up; `\|r_1\| > F_{k+2}`, so `k < log_φ(n √5) = O(log n)` |
| 2 | Prove Tim Sort matches the adaptive lower bound O(n + n log R). | Detection is O(n). Merges form a balanced tree of depth log R; each level does O(n) work → O(n log R) merge cost total. Information-theoretic lower bound from decision-tree argument matches |
| 3 | Explain Mehlhorn's measure of presortedness. | `Rem(A)` = minimum elements to remove for `A` to be sorted. A `Rem`-optimal sort runs in O(n + n log Rem(A)). TimSort is `Rem`-optimal |
| 4 | Why is PowerSort a credible TimSort successor? | Same O(n + n log R) complexity, but cleaner invariants (node-power assignment) easier to formally prove correct |
| 5 | Derive the amortized cost of a merge using the potential method. | Define `Φ = Σ \|r_i\| · (k - i + 1)`. Each merge reduces Φ by smaller run's size; amortized cost = actual cost + ΔΦ = (a+b) - b = a. Summed → O(n log R) |
| 6 | What's the role of formal verification in finding the 2015 bug? | KeY theorem prover attempted to verify OpenJDK's TimSort; the failed proof identified the depth-3-only invariant check as insufficient. Decades of empirical testing missed it |
| 7 | Compare TimSort's complexity to natural merge sort. | Both adaptive O(n + n log R). TimSort wins in practice via `minrun` padding (balanced merge tree) and galloping (reduced comparisons on dominated runs) |
| 8 | Lower bound for stable comparison sort? | Ω(n log n) by decision tree argument (same as unstable). Stability adds no asymptotic cost; TimSort matches it |

---

## Coding Challenges

### Challenge 1: Count Natural Runs

Given an array, count the number of maximal ascending or strictly-descending runs (the same way TimSort would detect them).

#### Go

```go
package main

import "fmt"

func CountRuns(arr []int) int {
    if len(arr) <= 1 {
        return len(arr)
    }
    count := 1
    i := 0
    for i < len(arr)-1 {
        j := i + 1
        if arr[j] < arr[i] {
            // descending — extend with strict <
            for j < len(arr) && arr[j] < arr[j-1] {
                j++
            }
        } else {
            // ascending — extend with <=
            for j < len(arr) && arr[j] >= arr[j-1] {
                j++
            }
        }
        if j < len(arr) {
            count++
        }
        i = j
    }
    return count
}

func main() {
    fmt.Println(CountRuns([]int{1, 2, 3, 4, 5}))       // 1
    fmt.Println(CountRuns([]int{5, 4, 3, 2, 1}))       // 1
    fmt.Println(CountRuns([]int{1, 2, 5, 4, 3, 6, 7})) // 3
    fmt.Println(CountRuns([]int{3, 3, 3, 3}))          // 1 (non-strict ascending)
}
```

#### Java

```java
public class CountRuns {
    public static int countRuns(int[] arr) {
        if (arr.length <= 1) return arr.length;
        int count = 1, i = 0;
        while (i < arr.length - 1) {
            int j = i + 1;
            if (arr[j] < arr[i]) {
                while (j < arr.length && arr[j] < arr[j - 1]) j++;
            } else {
                while (j < arr.length && arr[j] >= arr[j - 1]) j++;
            }
            if (j < arr.length) count++;
            i = j;
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countRuns(new int[]{1, 2, 3, 4, 5}));        // 1
        System.out.println(countRuns(new int[]{5, 4, 3, 2, 1}));        // 1
        System.out.println(countRuns(new int[]{1, 2, 5, 4, 3, 6, 7}));  // 3
        System.out.println(countRuns(new int[]{3, 3, 3, 3}));           // 1
    }
}
```

#### Python

```python
def count_runs(arr):
    if len(arr) <= 1:
        return len(arr)
    count = 1
    i = 0
    while i < len(arr) - 1:
        j = i + 1
        if arr[j] < arr[i]:
            while j < len(arr) and arr[j] < arr[j - 1]:
                j += 1
        else:
            while j < len(arr) and arr[j] >= arr[j - 1]:
                j += 1
        if j < len(arr):
            count += 1
        i = j
    return count


if __name__ == "__main__":
    print(count_runs([1, 2, 3, 4, 5]))        # 1
    print(count_runs([5, 4, 3, 2, 1]))        # 1
    print(count_runs([1, 2, 5, 4, 3, 6, 7]))  # 3
    print(count_runs([3, 3, 3, 3]))           # 1
```

**Why this matters in interviews:** Run detection is the core of TimSort. Many interviewers ask for it as a warm-up before discussing the full algorithm.

---

### Challenge 2: Stable Merge of Two Sorted Arrays

Implement a stable merge — equal elements from the left array come before equal elements from the right.

#### Go

```go
package main

import "fmt"

func StableMerge(left, right []int) []int {
    out := make([]int, 0, len(left)+len(right))
    i, j := 0, 0
    for i < len(left) && j < len(right) {
        if left[i] <= right[j] { // <= for stability
            out = append(out, left[i])
            i++
        } else {
            out = append(out, right[j])
            j++
        }
    }
    out = append(out, left[i:]...)
    out = append(out, right[j:]...)
    return out
}

func main() {
    fmt.Println(StableMerge([]int{1, 3, 5}, []int{2, 4, 6}))
    fmt.Println(StableMerge([]int{1, 1, 1}, []int{1, 1, 1})) // [1 1 1 1 1 1] — order preserved
}
```

#### Java

```java
import java.util.Arrays;

public class StableMerge {
    public static int[] merge(int[] left, int[] right) {
        int[] out = new int[left.length + right.length];
        int i = 0, j = 0, k = 0;
        while (i < left.length && j < right.length) {
            if (left[i] <= right[j]) out[k++] = left[i++];
            else                      out[k++] = right[j++];
        }
        while (i < left.length)  out[k++] = left[i++];
        while (j < right.length) out[k++] = right[j++];
        return out;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(merge(new int[]{1, 3, 5}, new int[]{2, 4, 6})));
    }
}
```

#### Python

```python
def stable_merge(left, right):
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out.extend(left[i:])
    out.extend(right[j:])
    return out


if __name__ == "__main__":
    print(stable_merge([1, 3, 5], [2, 4, 6]))
    print(stable_merge([1, 1, 1], [1, 1, 1]))
```

---

### Challenge 3: Galloping Search

Implement `gallop_right`: given a sorted array and a key, find the first index strictly greater than the key using exponential then binary search.

#### Python

```python
def gallop_right(arr, key, lo=0, hi=None):
    """First index in arr[lo:hi] strictly > key."""
    if hi is None:
        hi = len(arr)
    # Exponential phase
    offset = 1
    while lo + offset < hi and arr[lo + offset] <= key:
        offset *= 2
    # Binary search in [lo + offset/2, min(lo + offset, hi))
    left = lo + offset // 2 + 1
    right = min(lo + offset + 1, hi)
    while left < right:
        mid = (left + right) // 2
        if arr[mid] <= key:
            left = mid + 1
        else:
            right = mid
    return left


arr = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
print(gallop_right(arr, 5))   # 3 (first index > 5)
print(gallop_right(arr, 20))  # 10 (off the end)
```

**Why this matters:** Galloping is the distinctive optimization that makes TimSort fast on dominated runs. Knowing it cold separates "I read about TimSort" from "I understand TimSort."

---

## Whiteboard / Discussion Questions

1. **Why doesn't Tim Sort use a single fixed `minrun = 32`?** Because for non-power-of-2 `n`, fixed `minrun` leaves a small "orphan" run that unbalances the merge tree. Computing `minrun` based on `n` keeps the tree perfectly balanced.

2. **If you had to pick one sort for a brand-new programming language, would you pick TimSort?** Defensible answer: yes for object/general-purpose arrays (stability + adaptive), no for primitive arrays (pdqsort wins). Showing nuance is the point.

3. **TimSort's worst-case complexity is O(n log n). Can you construct an input that hits this?** Random data of length exactly `2^k` for some `k`, with no natural runs longer than 1. Each pair must be merged, no galloping helps.

4. **You're seeing `Comparison method violates its general contract` in production. How do you debug?** Audit the comparator for transitivity (`a < b ∧ b < c ⇒ a < c`), totality (every pair must compare), and consistency (no mutable state). Common pitfall: `a.value - b.value` overflows for large `int`.

5. **A coworker reimplemented TimSort and benchmarked it 2× slower than `Arrays.sort`. Why?** Likely missing galloping (the biggest engineering win on real data), or using per-call allocations instead of one preallocated buffer, or weak `minrun` choice. The built-in has 20+ years of micro-optimization.

---

## Common Follow-Up Tricks

- *"What if comparisons are extremely expensive, like calling a remote service?"* → Decorate-Sort-Undecorate: precompute keys once, sort by key. Tim Sort already minimizes comparisons via galloping, but DSU caps key cost at n.
- *"What if the array is too big for RAM?"* → External merge sort with TimSort as the chunk sort. See [`02-merge-sort/senior.md`](../02-merge-sort/senior.md).
- *"How would you sort 10⁹ integers using TimSort?"* → Don't. Use radix sort or pdqsort for primitives. TimSort's edge is stability + adaptive on object data.
- *"Can you make TimSort in-place?"* → Block merge sort variants exist (e.g., Kim and Kutzner's `merge_inplace`), but they're 2-3× slower in practice. Production TimSort always uses an auxiliary buffer.

---

## Behavioral / System-Design Style

### "Design a leaderboard service."

Most candidates jump to Redis sorted sets. A senior answer should connect to TimSort:

- The leaderboard backing store is rarely re-sorted from scratch — scores update incrementally.
- For periodic full-reorder operations (e.g., daily decay), TimSort excels because most positions don't change → many runs preserved → O(n + small) effective work.
- For top-k queries, `heapq.nlargest(k, scores)` is preferable to `sorted(scores)[-k:]` when `k << n`.

### "How would you sort a feed of social media posts?"

- Posts arrive in time order → mostly sorted by created_at descending.
- A reverse-then-sort with TimSort runs in O(n) — detects the descending run, reverses, done.
- If sort key is "engagement" (not creation time), TimSort still wins because engagement correlates with recency → mostly-sorted input.

### "Walk me through what happens when I call `Collections.sort(myList)`."

- `Collections.sort` delegates to `List.sort(null)`.
- `ArrayList.sort` calls `Arrays.sort` on the backing array — TimSort.
- TimSort: detect runs → pad short runs with Binary Insertion → push onto stack → merge per invariants → final merge-force.
- If the list is a `LinkedList`, the backing array is copied first (O(n)), sorted, then copied back. Linked lists sort with extra O(n) work.
- Comparator: if `null`, uses `Comparable.compareTo`; else uses the provided `Comparator`.
- A non-transitive comparator throws `IllegalArgumentException: Comparison method violates its general contract` mid-sort.

---

## One-Liner Trivia (Pop Quiz)

| Question | Answer |
|----------|--------|
| Year TimSort was designed? | 2002 (CPython 2.3) |
| Designer? | Tim Peters |
| Stable? | Yes |
| Worst-case time? | O(n log n) |
| Best-case time? | O(n) on sorted/reverse input |
| Adaptive bound? | O(n + n log R) |
| Space? | O(n) auxiliary in worst case |
| `minrun` typical range? | 32-64 |
| Stack invariants? | A > B + C; B > C |
| Galloping threshold? | `min_gallop = 7`, adapts |
| Java built-in for `int[]`? | NOT TimSort (Dual-Pivot Quicksort) |
| Java built-in for `Object[]`? | TimSort |
| Python `sorted()`? | TimSort |
| V8 since 2018? | TimSort |
| Famous bug year? | 2015 (de Gouw et al., CAV) |
| Modern successor? | PowerSort (2018, Munro & Wild) |

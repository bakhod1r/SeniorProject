# Counting Sort — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Counting Sort? | Non-comparison sort; tallies value frequencies; uses prefix sums to place each element in O(n + k) |
| 2 | What is the time complexity of Counting Sort? | O(n + k) all cases — best, average, worst |
| 3 | What is the space complexity of Counting Sort? | O(n + k) — output array + count array |
| 4 | What does `k` mean in Counting Sort? | Size of the key universe; the number of distinct possible values |
| 5 | Why is Counting Sort considered a non-comparison sort? | It uses key values as array indices; it never compares pairs of elements |
| 6 | Can Counting Sort sort floats? | Not directly — floats aren't integers; must quantise or use Bucket Sort |
| 7 | Is Counting Sort stable? | Yes, when iterating input right-to-left during the placement phase |
| 8 | When should you use Counting Sort? | Small bounded integer keys, k = O(n); also as inner pass of Radix Sort |
| 9 | When should you NOT use Counting Sort? | When `k >> n`, floats/strings, memory-constrained environments |
| 10 | What is the count array? | Array of size k where `count[v]` stores the number of occurrences of value v |

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Explain the three phases of Counting Sort. | Tally → prefix sum → right-to-left placement |
| 2 | What does the prefix sum step do? | Converts counts into final positions — `count[v]` = position-past-last for value v |
| 3 | Why right-to-left iteration in the placement phase? | Preserves stability — leftmost equal key ends up at leftmost slot |
| 4 | How would you handle negative numbers? | Use offset variant: subtract min, index by `v - min` |
| 5 | How would you sort objects (records) by an integer key? | Allocate `output[n]` of records; same prefix-sum + placement; carries payload |
| 6 | Compare Counting Sort to Merge Sort. | Counting: O(n+k), needs bounded ints; Merge: O(n log n), works on any orderable |
| 7 | Why is Counting Sort the inner pass of Radix Sort? | It's stable and linear-time, which Radix needs per digit |
| 8 | What if you skip the prefix sum step? | Naïve variant: emit count[v] copies — works but loses per-element payload |
| 9 | What's the difference between stable and in-place Counting Sort? | Stable uses O(n+k) extra memory; in-place uses only O(k) but loses stability |
| 10 | What happens when `k = n²`? | Memory blows up; worse than O(n log n) Merge Sort |
| 11 | Is Counting Sort adaptive? | No — same time regardless of input order |
| 12 | What is the auxiliary space breakdown? | Count: O(k), Output: O(n); total O(n + k) |
| 13 | Could you Counting-Sort a string? | Only if you map chars to ints (e.g., ASCII byte value); otherwise no |
| 14 | What is the histogram pattern? | Phase 1 of Counting Sort alone — used in frequency counting, image processing |
| 15 | Why does Counting Sort beat the Ω(n log n) lower bound? | It's not in the comparison model — uses keys as indices, not comparisons |

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How would you parallelise Counting Sort across 8 cores? | Per-thread local histograms → combine globally → prefix sum → disjoint scatter |
| 2 | How does GPU Counting Sort work? | Warp-level histograms, block-level scans, global scatter; span O(log n) |
| 3 | When does the count array stop fitting in L3 cache? | Roughly `k > 10⁷` on modern CPUs; performance drops 5–10× |
| 4 | How is Counting Sort used in distributed sort (Spark, Hadoop)? | Per-node histograms → driver builds global prefix sum → range partitioning |
| 5 | Compare Counting Sort vs Radix Sort for sorting 32-bit ints. | Counting needs 16 GB count array; Radix uses 4 passes of base-256 Counting |
| 6 | How does a database engine decide between Counting and TimSort? | Inspects column cardinality stats at query-plan time |
| 7 | What is histogram-based range partitioning? | Build histogram → prefix sum → partition by quantile boundaries |
| 8 | What happens under skewed input? | One bucket dominates; parallel speedup tanks; consider hashing first |
| 9 | What metrics would you monitor in production? | k, count_array_bytes, throughput_mb_sec, histogram_skew_ratio |
| 10 | How do you handle `k = 10^9`? | Don't use Counting Sort; switch to Radix Sort or approximate histogram |

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove Counting Sort is correct with loop invariants. | Three invariants — one per phase; induction over array index |
| 2 | Prove Counting Sort is stable. | Right-to-left placement + prefix-sum decrement: leftmost in → leftmost out |
| 3 | Why doesn't the Ω(n log n) lower bound apply? | Decision-tree argument is comparison-model only; Counting Sort uses RAM model |
| 4 | State Counting Sort's I/O complexity. | O(N/B + k/B) when count fits in cache; O(N) when it doesn't |
| 5 | Derive parallel work and span. | W = O(n + p·k), S = O(n/p + k + log p); GPU variant reduces span to O(log n) |
| 6 | Compare deterministic guarantees: Counting vs Quick. | Counting: Θ(n+k) deterministic; Quick: O(n log n) randomised, worst-case O(n²) |
| 7 | How does Counting Sort relate to suffix-array construction? | DC3/SA-IS algorithms use Counting Sort for bucketing suffixes |
| 8 | What is the segmented scan, and how does it apply? | Per-bucket parallel prefix sum; reduces GPU Counting Sort span to O(log n) |

---

## Coding Challenge (3 Languages)

### Challenge: Sort Colors (LeetCode 75 / Dutch National Flag — Counting Sort variant)

> Given an array `arr` containing only values `0`, `1`, and `2`, sort it in-place in **one or two passes** without using any built-in sort. Solve in O(n) time using the Counting Sort idea (`k = 3`).
>
> Example:
> Input:  `[2, 0, 2, 1, 1, 0]`
> Output: `[0, 0, 1, 1, 2, 2]`
>
> Constraints: `1 <= n <= 300`, `arr[i] in {0, 1, 2}`.

#### Go

```go
package main

import "fmt"

// SortColors uses the Counting Sort idea: count 0s, 1s, 2s then overwrite.
// Two-pass O(n) time, O(1) extra space (k=3 is constant).
func SortColors(arr []int) {
    var count [3]int
    for _, v := range arr {
        count[v]++
    }
    idx := 0
    for v := 0; v < 3; v++ {
        for j := 0; j < count[v]; j++ {
            arr[idx] = v
            idx++
        }
    }
}

func main() {
    arr := []int{2, 0, 2, 1, 1, 0}
    SortColors(arr)
    fmt.Println(arr) // [0 0 1 1 2 2]
}
```

#### Java

```java
import java.util.Arrays;

public class SortColors {
    public static void sortColors(int[] arr) {
        int[] count = new int[3];
        for (int v : arr) count[v]++;
        int idx = 0;
        for (int v = 0; v < 3; v++) {
            for (int j = 0; j < count[v]; j++) {
                arr[idx++] = v;
            }
        }
    }

    public static void main(String[] args) {
        int[] arr = {2, 0, 2, 1, 1, 0};
        sortColors(arr);
        System.out.println(Arrays.toString(arr));
    }
}
```

#### Python

```python
def sort_colors(arr):
    """Counting Sort with k=3 — O(n) time, O(1) extra space."""
    count = [0, 0, 0]
    for v in arr:
        count[v] += 1
    idx = 0
    for v in range(3):
        for _ in range(count[v]):
            arr[idx] = v
            idx += 1


if __name__ == "__main__":
    arr = [2, 0, 2, 1, 1, 0]
    sort_colors(arr)
    print(arr)  # [0, 0, 1, 1, 2, 2]
```

**Analysis:**
- **Time:** O(n) — one pass to count, one pass to write back.
- **Space:** O(1) — count array has fixed size 3.
- **Stability:** trivially preserved (single value per bucket).

**Follow-up question:** "Can you do it in **one pass**?" Answer: yes, with the **Dutch National Flag** algorithm — three pointers (`low`, `mid`, `high`) that partition the array in-place as you scan. Not strictly Counting Sort, but related (constant `k`, single pass).

```python
def sort_colors_one_pass(arr):
    low, mid, high = 0, 0, len(arr) - 1
    while mid <= high:
        if arr[mid] == 0:
            arr[low], arr[mid] = arr[mid], arr[low]
            low += 1; mid += 1
        elif arr[mid] == 1:
            mid += 1
        else:  # == 2
            arr[mid], arr[high] = arr[high], arr[mid]
            high -= 1
```

---

## Behavioural & System-Design Follow-Ups

| # | Question | Expected Answer |
|---|----------|-----------------|
| 1 | Tell me about a time you used a non-comparison sort in production. | Example: byte-level sort in a log processor, or histogram-based partitioner in a shuffle |
| 2 | How would you sort 10 million ages (0–120)? | Counting Sort with k=121; O(n) time; faster than `sort.Ints` by 3–5× |
| 3 | How would you sort 10 million 32-bit user IDs? | Radix Sort (Counting Sort would need 16 GB count array) |
| 4 | Design a "top-100 most common words" feature. | Hash-based frequency count + heap for top-k; for fixed-size dictionary, Counting Sort variant |
| 5 | When would you reject Counting Sort in a design review? | Unbounded `k`, float keys, memory-constrained service, lack of attached-payload support in naïve variant |
| 6 | Walk me through the prefix-sum trick. | It converts per-bucket counts into cumulative end-positions; same idiom used in GPU scans, partition-pruning, range queries |
| 7 | How would you test that your Counting Sort is stable? | Sort records with equal keys but distinct payloads; assert the payload order matches input order |

---

## Deep-Dive Answers (Top 10)

### 1. "Walk me through Counting Sort end to end."

> Counting Sort is a **non-comparison** sort that runs in **O(n + k)** time on `n` elements with integer keys in `[0, k)`. It has three phases:
>
> 1. **Tally:** scan the input once and increment `count[v]` for each value `v`.
> 2. **Prefix sum:** for each `v` from 1 to k-1, do `count[v] += count[v-1]`. After this, `count[v]` equals the position just past the last slot for value `v` in the output.
> 3. **Placement:** walk the input **right to left**. For each `arr[i]`, decrement `count[arr[i]]`, then write `arr[i]` to `output[count[arr[i]]]`.
>
> Total: 2 reads + 2 writes per input element plus O(k) for the prefix-sum pass. No comparisons ever happen.

### 2. "Why right-to-left in Phase 3?"

> Because the prefix sum tells us "the *last* position for value `v` is `count[v] - 1`." If I walk the input from the right, the right-most occurrence of `v` goes to the right-most slot, the next to its left, and so on — so the **left-most** input occurrence ends up at the **left-most** slot. That's the definition of stability.
>
> If I walked left to right, the left-most input element would land at the right-most output slot for that value — reversing the relative order of equal keys. The output is still sorted, but **Radix Sort built on top of it would produce wrong results**, because Radix Sort needs each digit pass to preserve the relative order of keys whose current digit ties.

### 3. "How does Counting Sort beat the Ω(n log n) lower bound?"

> The Ω(n log n) bound is for the **comparison model**: it's proven via a decision tree whose internal nodes are key comparisons. The tree must have at least `n!` leaves (one per permutation), so its depth is at least `log₂(n!) = Θ(n log n)`.
>
> Counting Sort never compares two keys. It uses `arr[i]` directly as an index into the count array — a constant-time operation in the **word-RAM model**. That's a different model with no Ω(n log n) bound. The trade-off: the algorithm requires `k = O(n)` memory and only works on small bounded integer keys.

### 4. "When does Counting Sort lose to Quick Sort in practice?"

> When `k >> n`. The count array uses `O(k)` memory, and the prefix-sum and placement phases touch every count slot. If `k` is 10 million and `n` is 1,000, you're allocating and scanning 10 million slots to sort 1,000 elements — vastly slower than Quick Sort.
>
> Empirically on a modern CPU, the crossover is around `k ≈ 10·n`. Above that, the count array spills out of L3 cache, every increment becomes a cache miss, and Counting Sort drops from "3× faster than Pdqsort" to "5× slower." For 32-bit integer keys you switch to **Radix Sort**, which runs 4 passes of Counting Sort with `k = 256` each.

### 5. "How would you parallelise Counting Sort across 8 cores?"

> Three phases parallelise cleanly:
>
> 1. Each thread builds a **local count array** over its `n/p` slice. No locks.
> 2. **Combine** the `p` local counts into one global count, then run a **parallel prefix sum** (Blelloch scan).
> 3. Each thread computes its own per-value write offsets, then scatters its slice to **disjoint output ranges**. Stability is preserved because thread `i`'s keys come before thread `i+1`'s in the output.
>
> Speedup peaks around `√(n/k)` cores. On 8 cores with `k = 1000`, expect ~5–7× speedup. Beyond that, per-thread count arrays plus cache traffic eat the gains.

### 6. "How does Counting Sort relate to Radix Sort?"

> Radix Sort sorts integers digit by digit. Each digit pass needs to be **stable** so the previous passes' order is preserved when the current digit ties. The only linear-time stable sort over a small key range is Counting Sort. So every LSD Radix Sort = `d` invocations of Counting Sort, one per digit, with `k` = base (typically 256).

### 7. "How do you handle negative numbers?"

> Use the **offset variant**: find `min = arr.min()` in one pass, then index the count array by `value - min` instead of `value`. The range becomes `[0, max - min + 1)`. Same complexity, same stability guarantee.
>
> Example: sorting `[-3, 7, -3, 0, 7, 2, -5]` → `min = -5`, count array size `13`. Element `-3` becomes index `2`. Output preserves the offset implicitly because we write the original `value`, not the shifted index.

### 8. "How would a database use Counting Sort?"

> Columnar engines (DuckDB, ClickHouse, Vertica) keep per-column statistics including `min`, `max`, and distinct count. At query-plan time, if `ORDER BY col` finds `cardinality(col) ≤ n`, the planner picks Counting Sort over the column. For a 100M-row sort by a country-code column (cardinality ≈ 200), Counting Sort finishes in ~1 second; TimSort takes ~10 seconds.

### 9. "What metrics would you monitor in production?"

> - `counting_sort_k` — to detect when `k` drifts up and the assumption "small bounded keys" is violated.
> - `count_array_bytes` — alert when it exceeds L3 cache size.
> - `throughput_mb_sec` — should approach memory bandwidth (~10–25 GB/s) on healthy inputs.
> - `histogram_skew_ratio` — `max_bucket / median_bucket`; > 10× means skewed input that won't parallelise well.
> - `parallel_speedup` — sublinear speedup is a sign of synchronisation overhead or memory bandwidth saturation.

### 10. "How would you prove Counting Sort's stability formally?"

> Define the *placement invariant* on the count array: before iteration `i` of Phase 3, `count[v]` equals `T[v] - |{j > i : arr[j] == v}|`, where `T[v]` is the total number of elements `≤ v`.
>
> Then for any pair `i < j` with `arr[i] == arr[j] == v`, iteration `j` runs first (right-to-left). Iteration `j` writes `arr[j]` at position `T[v] - 1 - p_j` where `p_j` is the number of `v`s strictly to its right. Iteration `i` writes `arr[i]` at `T[v] - 2 - p_j` (`p_j + 1` total to-its-right including `arr[j]`). Therefore `arr[i]`'s output position is strictly less than `arr[j]`'s — stability holds. See [`professional.md`](./professional.md) for the full induction.

---

## Quick Self-Check

After this section you should be able to:

- [ ] Write Counting Sort from scratch in Go, Java, and Python in under 10 minutes.
- [ ] Explain why right-to-left placement is required for stability — without looking it up.
- [ ] State the precondition `k = O(n)` and justify it with the memory cost.
- [ ] Compare Counting Sort vs Merge Sort vs Radix Sort along the axes of time, space, key type, and stability.
- [ ] Identify Counting Sort as a building block of Radix Sort, GPU sort, and distributed range partitioning.
- [ ] Prove correctness with a loop invariant for at least one phase.
- [ ] Recognise when the count array won't fit in L3 cache and pick Radix Sort instead.
- [ ] Defend your algorithm choice in a design review — explain when Counting Sort wins, when it loses, and the empirical crossover with comparison sorts.
- [ ] Describe the parallel and distributed variants and their cost models.
- [ ] Sketch the stability proof using a loop invariant on the count array.

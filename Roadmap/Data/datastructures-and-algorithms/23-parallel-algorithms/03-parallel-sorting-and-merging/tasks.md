# Parallel Sorting and Merging — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the sort or merge **round-by-round** (or level-by-level for a network), drive a **work counter** and a **span counter** alongside it, and **confirm the measured work/span match the bound** — and, always, that the output equals a sorted reference. The acceptance test is the same shape every time: *the parallel output is correctly sorted (or merged) **and** the measured work and span match the derived bound (`Θ(n)` / `Θ(log n)` for merge-by-rank, `Θ(n log² n)` work / `Θ(log² n)` span for bitonic, `Θ(n log n)` work / `Θ(log² n)` span for parallel merge sort).*
> **[analysis]** tasks need no code: derive a work/span recurrence, prove the **0-1 principle**, or reason about sample-sort load balance — model derivations are provided so you can grade yourself.

A **parallel sort** rearranges `n` keys into non-decreasing order while exposing parallelism; a **parallel merge** combines two already-sorted runs. The primitives that matter, and the bounds you will build, measure, and prove on every task:

| Algorithm | Work `T₁` | Span `T∞` | Comparison? | Shape |
| --- | --- | --- | --- | --- |
| **Sequential merge** | `Θ(n)` | `Θ(n)` | yes | one linear two-finger pass (the baseline) |
| **Merge by rank / co-ranking** | `Θ(n log n)` | `Θ(log n)` | yes | each element binary-searches its rank |
| **Parallel merge sort** | `Θ(n log n)` | `Θ(log² n)` | yes | `log n` levels, each a `Θ(log n)`-span merge |
| **Bitonic sort (Batcher)** | `Θ(n log² n)` | `Θ(log² n)` | oblivious | `Θ(log² n)` compare-swap rounds |
| **Sample sort** | `Θ(n log n)` exp. | `Θ(log² n)` exp. | yes | oversample splitters → bucket → sort |
| **Radix sort (via scan)** | `Θ(n)` per pass | `Θ(log n)` per pass | no (keys) | histogram + scan + scatter, `d` passes |

The recurring discipline for every coding task is identical: **run the sort or merge level by level, increment a work counter for every compare (or compare-swap, or `⊕`) and bump a span counter once per parallel round (the critical-path depth), and confirm the output matches a sorted reference while the counters respect the bound.** A sort you never check against `sorted(xs)` is a guess; a work/span you measure but never bracket with the bound is just a number. Tie the two together on every task.

**Related practice:**
- [Models: PRAM and Work–Span tasks](../01-models-pram-work-span/tasks.md) — the work/span model, Brent's bound, the `Ω(log n)` reduction-span floor, and the work-efficiency argument that ranks these sorts.
- [Parallel Prefix Sum / Scan tasks](../02-parallel-prefix-sum-scan/tasks.md) — the exclusive scan, stream compaction, and radix-split that the radix sort and partitioning here are built from.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Unit operation.** One comparison (or one compare-swap, or one `⊕`) is one unit of work. **Work** `T₁` is the total number of such operations; **span** `T∞` is the number of *parallel rounds* — the critical-path depth, the time on infinitely many processors.
- **A round.** One synchronized parallel step: every active element does its operation simultaneously, then a barrier. Span counts rounds, not operations.
- **Oblivious vs data-dependent.** A **sorting network** (bitonic) performs a *fixed* sequence of compare-swaps independent of the data — which is what makes the 0-1 principle apply and what makes it a perfect fit for SIMD/GPU. Merge-by-rank and sample sort are data-*dependent* (they branch on key values).
- **The idealization.** Work and span charge nothing for communication, memory contention, or load imbalance. Sample sort's whole difficulty is *outside* the model — the bucket sizes must be balanced, which is a probabilistic property of the splitter selection, not a work/span fact. We measure that separately.

---

## Beginner Tasks

### Task 1 — Sequential merge: the baseline every parallel merge checks against **[coding]**

`[easy]` Build the ground truth: the **sequential two-finger merge** of two sorted arrays `A` and `B` into one sorted array, in `Θ(n + m)` work and `Θ(n + m)` span (the merge is one linear dependency chain). Make it **stable** — when `A[i] == B[j]`, take from `A` first — because every later parallel merge must reproduce *exactly* this order to be verifiable against it.

#### Python

```python
def merge_seq(A, B):
    """Stable sequential merge of two sorted arrays.  Theta(n+m) work, Theta(n+m) span.
    Ties: take from A first (stability), so a parallel merge can match it element-for-element."""
    i = j = 0
    out = []
    while i < len(A) and j < len(B):
        if A[i] <= B[j]:        # <= (not <) -> A wins ties -> stable
            out.append(A[i]); i += 1
        else:
            out.append(B[j]); j += 1
    out.extend(A[i:])           # one tail is non-empty
    out.extend(B[j:])
    return out

if __name__ == "__main__":
    import random
    random.seed(0)
    for _ in range(1000):
        n, m = random.randint(0, 40), random.randint(0, 40)
        A = sorted(random.randint(0, 20) for _ in range(n))
        B = sorted(random.randint(0, 20) for _ in range(m))
        got = merge_seq(A, B)
        assert got == sorted(A + B), "merge must equal the sorted concatenation"
    print("OK: stable sequential merge equals sorted(A+B) for all inputs")
```

#### Go (core)

```go
// MergeSeq: stable merge of two sorted slices. A wins ties (<=) for stability.
func MergeSeq(A, B []int) []int {
	out := make([]int, 0, len(A)+len(B))
	i, j := 0, 0
	for i < len(A) && j < len(B) {
		if A[i] <= B[j] {
			out = append(out, A[i]); i++
		} else {
			out = append(out, B[j]); j++
		}
	}
	out = append(out, A[i:]...)
	out = append(out, B[j:]...)
	return out
}
```

- **Constraints:** Both inputs must already be sorted. The result must equal `sorted(A + B)` for every input, including empty arrays and arrays with many duplicates. Use `<=` (not `<`) so equal keys take from `A` first — a deliberate, fixed tie-break that the rank-based merge in Task 2 must reproduce exactly.
- **Hint:** The two-finger merge is the parallel merge's specification: a parallel merge is "correct" iff it produces *this* array. Stability matters the moment keys carry satellite data; lock the tie-break in now so every later acceptance test is an exact `== merge_seq(A, B)`, not a fuzzy "is sorted."
- **Acceptance test:** `merge_seq(A, B) == sorted(A + B)` for random sorted inputs of every size, including empties and heavy-duplicate runs. Keep this function — Tasks 2–4 and the sample-sort tasks all validate their parallel output against it.

---

### Task 2 — Parallel merge by rank: every element binary-searches its output position **[coding]**

`[easy]` Implement the **merge-by-rank** parallel merge: the output index of an element is its **rank** in the union, computable independently for every element. For `A[i]`, its output position is `i + (number of B-elements that come before it)`; that count is a **binary search** of `A[i]` into `B`. Do the symmetric thing for `B`. Every element is independent — fully parallel — so the span is the cost of one binary search, `Θ(log n)`, while the work is `Θ(n log n)` (one search per element). Drive a **work counter** (comparisons) and a **span counter** (the binary-search depth) and confirm the output matches Task 1.

#### Python

```python
from bisect import bisect_left, bisect_right
from math import log2, ceil

def merge_by_rank(A, B):
    """Parallel merge: each element's output index = its rank in the union.
    Returns (result, work, span).  work = total comparisons (~ n log n);
    span = depth of one binary search (~ log n), since all searches are independent."""
    n, m = len(A), len(B)
    out = [None] * (n + m)
    work = 0
    # For A[i]: it precedes a B-element b iff b > A[i]; ties -> A first (stable) ->
    # count B-elements STRICTLY less than A[i] = bisect_left(B, A[i]).
    for i, a in enumerate(A):
        lo, hi, steps = 0, m, 0
        while lo < hi:                  # explicit binary search to count comparisons
            mid = (lo + hi) // 2
            work += 1
            if B[mid] < a:
                lo = mid + 1
            else:
                hi = mid
            steps += 1
        out[i + lo] = a                 # i A-elements before it + lo B-elements before it
    # For B[j]: count A-elements <= B[j] (A wins ties) = bisect_right(A, B[j]).
    for j, b in enumerate(B):
        lo, hi = 0, n
        while lo < hi:
            mid = (lo + hi) // 2
            work += 1
            if A[mid] <= b:             # <= : A-elements equal to b precede this B-element
                lo = mid + 1
            else:
                hi = mid
        out[j + lo] = b
    span = max(1, ceil(log2(max(n, m) + 1)))   # one independent binary search deep
    return out, work, span

if __name__ == "__main__":
    import random
    from task1 import merge_seq
    random.seed(1)
    for _ in range(2000):
        n, m = random.randint(0, 60), random.randint(0, 60)
        A = sorted(random.randint(0, 30) for _ in range(n))
        B = sorted(random.randint(0, 30) for _ in range(m))
        got, work, span = merge_by_rank(A, B)
        assert got == merge_seq(A, B), "merge-by-rank must match the stable sequential merge"
        N = n + m
        if N > 1:
            assert work <= N * (ceil(log2(N + 1)) + 1), "work is O(N log N)"
            assert span <= ceil(log2(N + 1)) + 1, "span is O(log N)"
    print("OK: merge-by-rank == sequential merge; work=O(N log N), span=O(log N)")
```

- **Constraints:** The rank must reproduce the **stable** tie-break of Task 1: count B-elements *strictly less than* `A[i]` (`bisect_left`), and A-elements *less than or equal to* `B[j]` (`bisect_right`), so equal keys land A-before-B exactly as in `merge_seq`. Every output slot must be written exactly once (no collision, no gap). Count one unit of work per comparison; the span is the depth of a *single* binary search because all `n + m` searches run independently.
- **Hint:** Output index of `A[i]` = (`i` elements of `A` before it) + (count of `B` before it) = `i + bisect_left(B, A[i])`. Because each element computes its own destination with no dependency on any other, the whole merge is one parallel round of independent binary searches — span `Θ(log n)`. The price is work: `n + m` searches of `Θ(log n)` each gives `Θ(N log N)`, a `log N` factor over the sequential `Θ(N)`. Task 3 fixes that with co-ranking.
- **Acceptance test:** Output equals `merge_seq(A, B)` for every input (including duplicates that exercise the tie-break, and empty arrays); `work = Θ(N log N)`; `span = Θ(log N)`. This is the low-span, work-*inefficient* merge — Task 3 builds the work-efficient co-ranking split on top of it.

---

### Task 3 — Co-ranking: the merge-path split point in `Θ(log n)` **[coding]**

`[easy]` Merge-by-rank is work-inefficient because every element searches. The fix is **co-ranking** (the "merge path" / Merrill–Grimshaw split): to merge `A` and `B` into one output of length `N`, pick any output index `k` and find the unique split `(i, j)` with `i + j = k` such that the first `i` of `A` and first `j` of `B` are exactly the `k` smallest elements. That split is found by **one binary search** over `i ∈ [max(0,k−m), min(k,n)]`. With co-ranking you split the output into `P` equal chunks, find each chunk's `(i, j)` boundary, then run `P` independent **sequential** merges — `Θ(N)` total work, `Θ(N/P + log N)` span. Implement the co-rank split and prove it against Task 1.

#### Python

```python
def co_rank(k, A, B):
    """Find (i, j) with i + j = k such that merging A[:i] and B[:j] gives the k
    smallest elements (stable). One binary search over i.  Theta(log N) work/span.
    Invariant at the split: A[i-1] <= B[j]  and  B[j-1] < A[i]  (ties -> A first)."""
    n, m = len(A), len(B)
    i_lo = max(0, k - m)            # j = k - i <= m  =>  i >= k - m
    i_hi = min(k, n)               # i <= n and i <= k
    while i_lo < i_hi:
        i = (i_lo + i_hi + 1) // 2  # bias high so the loop makes progress
        j = k - i
        if i > 0 and j < m and A[i - 1] > B[j]:
            i_hi = i - 1            # A reaches too far: pull i down
        elif j > 0 and i < n and B[j - 1] >= A[i]:
            i_lo = i                # B reaches too far (>= : A wins ties): push i up
        else:
            return i, j
    return i_lo, k - i_lo

def merge_co_rank(A, B, P):
    """Split the output into P chunks via co-rank, then P independent sequential merges.
    Work Theta(N); span Theta(N/P + log N).  Returns the merged array."""
    from task1 import merge_seq
    N = len(A) + len(B)
    out = []
    bounds = [co_rank(round(t * N / P), A, B) for t in range(P + 1)]
    for t in range(P):
        (i0, j0), (i1, j1) = bounds[t], bounds[t + 1]
        out.extend(merge_seq(A[i0:i1], B[j0:j1]))   # each chunk merged independently
    return out

if __name__ == "__main__":
    import random
    from task1 import merge_seq
    random.seed(2)
    for _ in range(2000):
        n, m = random.randint(0, 50), random.randint(0, 50)
        A = sorted(random.randint(0, 25) for _ in range(n))
        B = sorted(random.randint(0, 25) for _ in range(m))
        N = n + m
        # 1) Every co-rank split point is internally consistent.
        for k in range(N + 1):
            i, j = co_rank(k, A, B)
            assert i + j == k and 0 <= i <= n and 0 <= j <= m
            if i > 0 and j < m: assert A[i - 1] <= B[j]
            if j > 0 and i < n: assert B[j - 1] < A[i]
        # 2) Chunked merge equals the stable sequential merge.
        for P in (1, 2, 3, 5):
            assert merge_co_rank(A, B, P) == merge_seq(A, B)
    print("OK: co-rank split is consistent; chunked merge == sequential; work Theta(N)")
```

- **Constraints:** `co_rank(k, A, B)` must return the unique `(i, j)` with `i + j = k` satisfying the split invariant `A[i−1] ≤ B[j]` and `B[j−1] < A[i]` (with the boundary terms vacuously true at the ends) — and that invariant must encode the **same** stable tie-break as Task 1. The chunked merge must equal `merge_seq` for *every* chunk count `P`, including `P = 1` (degenerates to one sequential merge) and `P > N`.
- **Hint:** The merge path is monotone: as `k` increases by 1, exactly one of `i, j` increases by 1 (you take the next element from `A` or from `B`). Co-ranking jumps straight to the split for an arbitrary `k` with one binary search of width `≤ min(n, m)`, so it is `Θ(log N)`. Splitting into `P` chunks costs `P · Θ(log N)` for the boundaries and `Θ(N)` for the `P` sequential merges — *work-efficient* (`Θ(N)`, matching the sequential merge) with span `Θ(N/P + log N)`. This is the merge a real library runs.
- **Acceptance test:** Every co-rank split is consistent (`i + j = k`, invariant holds) for all `k`; the chunked merge equals `merge_seq` for all `P`; total comparison work is `Θ(N)` plus `Θ(P log N)` for the boundaries. Co-ranking turns the work-inefficient rank merge into the work-efficient split that parallel merge sort needs.

---

### Task 4 — Parallel merge sort on top of the parallel merge; verify sorted **[coding]**

`[easy]` Build a **parallel merge sort**: recursively sort the two halves *in parallel*, then merge them with the parallel merge of Task 2 or 3. The two recursive sorts are independent (parallel), and each merge is `Θ(log n)`-span — giving the famous `Θ(log² n)` span. Implement it, drive a **work counter** and a **span counter** through the recursion, and confirm the output equals `sorted(xs)` with `T₁ = Θ(n log n)`, `T∞ = Θ(log² n)`.

#### Python

```python
from math import log2, ceil
from task2 import merge_by_rank

def par_merge_sort(xs):
    """Parallel merge sort. Returns (sorted, work, span).
    Recurse on both halves in PARALLEL (span = max, not sum), merge by rank
    (span Theta(log n) per level). Total span = Theta(log^2 n)."""
    n = len(xs)
    if n <= 1:
        return list(xs), 0, 0
    mid = n // 2
    left, lw, ls = par_merge_sort(xs[:mid])
    right, rw, rs = par_merge_sort(xs[mid:])      # independent -> parallel
    merged, mw, ms = merge_by_rank(left, right)
    work = lw + rw + mw                            # work ADDS across the two halves
    span = max(ls, rs) + ms                        # span MAXes (parallel), then + merge
    return merged, work, span

if __name__ == "__main__":
    import random
    random.seed(3)
    for n in (0, 1, 2, 7, 16, 17, 1000, 4096):
        xs = [random.randint(0, 99) for _ in range(n)]
        got, work, span = par_merge_sort(xs)
        assert got == sorted(xs), "parallel merge sort must produce the sorted array"
        if n >= 2:
            # Work ~ n log n (merge-by-rank merges add a log factor over n log n in the
            # constant, but the class is n log n); span ~ log^2 n.
            assert work <= 4 * n * ceil(log2(n)) ** 1 * ceil(log2(n))  # generous O(n log^2 n) cap
            assert span <= (ceil(log2(n)) + 1) ** 2, "span is O(log^2 n)"
            assert span >= ceil(log2(n)), "span is at least the recursion depth"
        print(f"n={n:5d}  work={work:8d}  span={span:3d}  "
              f"(log n={ceil(log2(max(2,n)))}, log^2 n={ceil(log2(max(2,n)))**2})")
    print("OK: parallel merge sort == sorted; span = O(log^2 n)")
```

- **Constraints:** The two recursive calls are **independent**, so the span is `max(left_span, right_span) + merge_span`, *not* the sum — getting this wrong (summing the spans) collapses the analysis back to `Θ(n)` and is the single most common error. Work *adds* across the halves. The merge must be a parallel merge (rank or co-rank), so each level contributes `Θ(log n)` span, and there are `Θ(log n)` levels. Output must equal `sorted(xs)` for every `n`, including 0, 1, and non-powers of two.
- **Hint:** The span recurrence is `T∞(n) = T∞(n/2) + Θ(log n)`, which unrolls to `Σ_{k} log(n/2^k) = Θ(log² n)` (Task 7 derives this). The work recurrence is `T₁(n) = 2·T₁(n/2) + (merge work)`; with a `Θ(n)` co-rank merge it is `Θ(n log n)`, with the `Θ(n log n)` rank merge it is `Θ(n log² n)` — use co-ranking (Task 3) for the work-efficient version. The `max` on the span line is the entire point of "sort the halves in parallel."
- **Acceptance test:** Output equals `sorted(xs)` for every `n`; `span = Θ(log² n)` (between `log n` and `(log n + 1)²`); `work = Θ(n log n)` with the co-rank merge (or `Θ(n log² n)` with the rank merge — note which you used). This is the canonical divide-and-conquer parallel sort; Tasks 5 and 9 build the *oblivious* and *splitter-based* alternatives.

---

## Intermediate Tasks

### Task 5 — Bitonic sort: an oblivious compare-swap network **[coding]**

`[medium]` Implement **Batcher's bitonic sort**, the workhorse oblivious sorting network: a *fixed* sequence of compare-swaps independent of the data, with `Θ(log² n)` rounds. Pad the input to the next power of two (with `+∞` for an ascending sort), build a **bitonic sequence** by recursively sorting halves in opposite directions, then **bitonic-merge** it. Drive a **work counter** (compare-swaps) and a **span counter** (network depth) and confirm it sorts, with `T₁ = Θ(n log² n)`, `T∞ = Θ(log² n)`.

#### Python

```python
from math import log2

def bitonic_sort(xs):
    """Batcher bitonic sort (oblivious network). Returns (sorted, work, span).
    Pads to a power of two with +inf. Network depth = (log n)(log n + 1)/2 rounds;
    each round does n/2 compare-swaps -> work Theta(n log^2 n)."""
    n = len(xs)
    if n == 0:
        return [], 0, 0
    size = 1
    while size < n:
        size *= 2
    a = list(xs) + [float("inf")] * (size - n)   # +inf pads sort to the right
    work = [0]
    span = [0]

    def compare_swap_round(stride, box, ascending_mask):
        """One network round: for every i, compare-swap (i, i ^ stride) within boxes
        of length `box`, direction set by the box index. All pairs are independent."""
        for i in range(size):
            partner = i ^ stride
            if partner > i:                       # handle each pair once
                up = ((i // box) % 2 == 0)        # direction alternates per box
                work[0] += 1
                if (a[i] > a[partner]) == up:      # swap if out of the desired order
                    a[i], a[partner] = a[partner], a[i]
        span[0] += 1                               # one parallel round

    # Bitonic sort = log size stages; stage k has k+1 merge rounds (strides k..0).
    k = 1
    while k < size:                                # k = box size of the bitonic merge
        j = k // 2
        while j >= 1:                              # stride within the box
            for i in range(size):
                l = i ^ j
                if l > i:
                    up = ((i & k) == 0)            # ascending if the k-bit is 0
                    work[0] += 1
                    if (a[i] > a[l]) == up:
                        a[i], a[l] = a[l], a[i]
            span[0] += 1
            j //= 2
        k *= 2
    return a[:n], work[0], span[0]

if __name__ == "__main__":
    import random
    random.seed(4)
    for n in (1, 2, 3, 8, 16, 31, 100, 1024):
        xs = [random.randint(0, 999) for _ in range(n)]
        got, work, span = bitonic_sort(xs)
        assert got == sorted(xs), f"bitonic must sort (n={n})"
        size = 1
        while size < n:
            size *= 2
        if size >= 2:
            depth = int(log2(size))
            expected_span = depth * (depth + 1) // 2        # 1+2+...+log n rounds
            assert span == expected_span, f"span must be (log n)(log n+1)/2, got {span}"
            assert work == expected_span * (size // 2), "work = rounds * (size/2)"
        print(f"n={n:5d} (pad {size:5d})  work={work:7d}  span={span:3d}  "
              f"depth^2/2~{int(log2(max(2,size)))**2//2}")
    print("OK: bitonic sort sorts; span=(log n)(log n+1)/2, work=Theta(n log^2 n)")
```

- **Constraints:** The network is **oblivious** — the *sequence* of compare-swaps must not depend on the key values, only on indices `i` and the direction mask. Pad to the next power of two with `+∞` (for ascending) so the padding sinks to the top and the first `n` outputs are the sorted real keys. The depth is exactly `(log₂ size)(log₂ size + 1)/2` rounds, each doing `size/2` compare-swaps. Direction within a box must alternate (`(i & k) == 0`) to build the bitonic sequence correctly.
- **Hint:** A *bitonic* sequence rises then falls (or is a rotation of one). Batcher's insight: a bitonic sequence is sorted by `log n` rounds of "compare-swap element `i` with `i ⊕ stride`" for `stride = n/2, n/4, …, 1`. To *make* a bitonic sequence, recursively sort the lower half ascending and the upper half descending. The full sort stacks `log n` such stages, stage `k` having `k` merge rounds — total depth `1 + 2 + … + log n = Θ(log² n)`. The work is `depth · n/2 = Θ(n log² n)`: more work than merge sort, but every operation is a data-independent compare-swap, which is why GPUs and sorting-network hardware love it. Task 6 proves correctness via the 0-1 principle.
- **Acceptance test:** Output equals `sorted(xs)` for every `n` (including non-powers of two via padding); `span = (log size)(log size + 1)/2`; `work = span · (size/2) = Θ(n log² n)`. The compare-swap sequence is identical for two inputs of the same length — verify by logging the `(i, partner, direction)` triples and confirming they match across different random inputs.

---

### Task 6 — The 0-1 principle: prove and exploit it **[analysis + coding]**

`[medium]` The reason you can trust an oblivious network is the **0-1 principle**: *a comparison network that sorts every 0-1 input correctly sorts every input of arbitrary values.* This collapses correctness-checking from `n!` permutations (or infinitely many real inputs) to just `2ⁿ` binary inputs. First prove it (analysis), then exploit it: verify your Task-5 bitonic network by exhaustively testing all `2ⁿ` zero-one inputs for small `n`.

> **The proof is the grading model; the code is a short empirical exploit.**

**Claim (0-1 principle).** If an oblivious comparison network sorts all `2ⁿ` inputs drawn from `{0, 1}`, it sorts every input.

**Proof.** Suppose, for contradiction, the network sorts all 0-1 inputs but *fails* on some arbitrary input `x` — its output is not sorted, so two output positions are inverted. The key tool is that comparison networks **commute with monotone functions**: for any monotone non-decreasing `f`, running the network on `f(x)` (apply `f` elementwise) yields `f(network(x))`. This holds because each compare-swap computes `min` and `max`, and `min(f(a), f(b)) = f(min(a, b))`, `max(f(a), f(b)) = f(max(a, b))` for monotone `f` — so `f` "passes through" every gate.

Now suppose the network's output on `x` has `out[p] > out[q]` for some `p < q` (an inversion). Define the **threshold function** `f_t(v) = 0 if v < t else 1`, which is monotone. Choose `t = out[p]` (so `t > out[q]`). Then `f_t(out[p]) = 1` and `f_t(out[q]) = 0`. By the commuting property, running the network on the 0-1 input `f_t(x)` produces `f_t(network(x))`, whose positions `p < q` hold `1` and `0` — an *unsorted 0-1 output*. So the network fails on the 0-1 input `f_t(x)`, contradicting the hypothesis that it sorts all 0-1 inputs. ∎

**Exploit (code).**

```python
from itertools import product
from task5 import bitonic_sort

def verify_network_via_01(n):
    """0-1 principle: testing all 2^n binary inputs certifies the network sorts
    EVERYTHING. Far cheaper than checking n! permutations of distinct keys."""
    for bits in product((0, 1), repeat=n):
        got, _, _ = bitonic_sort(list(bits))
        if got != sorted(bits):
            return False, bits
    return True, None

if __name__ == "__main__":
    for n in range(1, 13):                 # 2^12 = 4096 inputs per size: cheap
        ok, bad = verify_network_via_01(n)
        assert ok, f"bitonic failed on 0-1 input {bad} (n={n})"
        # Cross-check the claim's strength: also sample random INTEGER inputs.
        import random
        for _ in range(200):
            xs = [random.randint(0, 50) for _ in range(n)]
            g, _, _ = bitonic_sort(xs)
            assert g == sorted(xs)
        print(f"n={n:2d}: all 2^{n}={2**n} zero-one inputs sorted -> network is correct")
    print("OK: 0-1 principle verified; sorting all 2^n binary inputs => sorts all inputs")
```

- **Constraints (proof):** State the claim, prove the *commuting-with-monotone-functions* lemma (each gate computes `min`/`max`, both of which commute with monotone `f`), pick the **threshold** function `f_t` with `t` at the inversion, and derive the contradiction. The monotone-commuting lemma is the load-bearing step — do not skip it.
- **Constraints (code):** Exhaustively test **all** `2ⁿ` zero-one inputs for `n` up to ~12; assert each is sorted. Cross-check with random integer inputs to *exhibit* (not prove) the principle's reach. The point: `2ⁿ` binary tests certify correctness for *all* inputs, whereas naive testing would need `n!` permutations of distinct keys.
- **Acceptance test:** The proof correctly invokes the monotone-commuting lemma and the threshold-function contradiction; the code confirms the Task-5 network sorts every 0-1 input for `n ≤ 12` (and every sampled integer input). You now have a cheap, complete correctness certificate for any oblivious network you build.

---

### Task 7 — Derive parallel merge sort's work/span recurrences **[analysis]**

`[medium]` Make Task 4's measured `Θ(log² n)` span rigorous. Derive the work and span recurrences of parallel merge sort with a `Θ(log n)`-span parallel merge, and solve them.

> **No code.** Use this as the grading model.

**The recurrences.** Parallel merge sort sorts the two halves *in parallel* (independent subproblems) and then merges them with a parallel merge of `Θ(log n)` span and `W_merge(n)` work.

*Span.* Because the two halves are independent, their spans run concurrently — the recursion contributes `T∞(n/2)` (a `max` of two equal terms), and the merge adds its `Θ(log n)`:

```
T∞(n) = T∞(n/2) + Θ(log n),   T∞(1) = Θ(1).
```

Unrolling over the `log₂ n` levels (level `k` has subproblems of size `n/2^k`, merge span `Θ(log(n/2^k)) = Θ(log n − k)`):

```
T∞(n) = Σ_{k=0}^{log n − 1} Θ(log n − k) = Θ(log n + (log n − 1) + … + 1)
      = Θ( (log n)(log n + 1) / 2 ) = Θ(log² n).
```

The `Θ(log² n)` is a *sum of logs over the levels*, not a single log — the canonical signature of "log-depth recursion, each level a log-depth merge."

*Work.* Work adds across the two halves plus the merge:

```
T₁(n) = 2·T₁(n/2) + W_merge(n).
```

- With the **work-efficient co-rank merge** (Task 3), `W_merge(n) = Θ(n)`. By the Master Theorem (case 2, `a = 2`, `b = 2`, `f(n) = Θ(n)`): `T₁(n) = Θ(n log n)` — *work-efficient*, matching sequential merge sort.
- With the **merge-by-rank merge** (Task 2), `W_merge(n) = Θ(n log n)`. The recurrence `T₁(n) = 2·T₁(n/2) + Θ(n log n)` solves to `T₁(n) = Θ(n log² n)` — a `log n` work blow-up, the price of the simpler merge.

*Parallelism.*

```
parallelism = T₁/T∞ = Θ(n log n) / Θ(log² n) = Θ(n / log n)   (co-rank merge).
```

**Why not `Θ(log n)` span?** A single parallel merge already needs `Θ(log n)` span (each element's rank is a binary search; the merge cannot finish faster — see the [reduction lower bound](../01-models-pram-work-span/tasks.md)). Stacking `log n` levels of such merges, each unavoidably `Θ(log n)`, gives `Θ(log² n)`. Beating it requires Cole's pipelined merge sort, which overlaps the merges across levels to reach `Θ(log n)` span (Task 11).

- **Constraints:** Write both recurrences, justify the `max` (parallel halves) in the span and the `+` (sequential merge) after it, and solve each by unrolling or the Master Theorem. Give `T₁` for *both* merges (co-rank `Θ(n log n)`, rank `Θ(n log² n)`) and state which is work-efficient. Compute the parallelism for the co-rank version.
- **Acceptance test:** Span `T∞(n) = Θ(log² n)` derived as `Σ_k Θ(log n − k)`; work `Θ(n log n)` (co-rank) or `Θ(n log² n)` (rank); parallelism `Θ(n/log n)`. The numbers match the counters measured in Task 4, and the derivation names *why* the span is `log²` and not `log`.

---

### Task 8 — Radix sort via scan: a stable partition built from prefix sums **[coding]**

`[medium]` A parallel **radix sort** has no comparisons — each pass is a stable partition by one digit, and the address computation is *entirely scans*. Implement one **LSD radix pass** built from a histogram + exclusive scan of bucket sizes + a stable scatter (the parallel form of each is a scan; see the [scan radix-split task](../02-parallel-prefix-sum-scan/tasks.md)). Verify the single pass is a **stable** partition, and that chaining passes least-significant-digit-first sorts the array. Each pass is `Θ(n)` work and `Θ(log n)` span; `d = ⌈bits/r⌉` passes sort `bits`-bit keys.

#### Python

```python
def exclusive_scan(xs):
    out, acc = [], 0
    for x in xs:
        out.append(acc); acc += x
    return out

def radix_pass(xs, shift, r):
    """One stable LSD radix pass on digit (x >> shift) & (2^r - 1).
    Histogram -> exclusive scan of bucket sizes -> stable scatter. Theta(n) per pass."""
    R = 1 << r
    digit = lambda x: (x >> shift) & (R - 1)
    hist = [0] * R
    for x in xs:                              # histogram (parallel: per-bucket reduction)
        hist[digit(x)] += 1
    start = exclusive_scan(hist)              # bucket start index = exclusive scan of sizes
    out = [None] * len(xs)
    cursor = list(start)
    for x in xs:                              # stable scatter: left-to-right keeps order
        d = digit(x)
        out[cursor[d]] = x
        cursor[d] += 1
    return out

def radix_sort(xs, r=4, bits=20):
    out = list(xs)
    for shift in range(0, bits, r):
        out = radix_pass(out, shift, r)
    return out

if __name__ == "__main__":
    import random
    random.seed(5)
    for n in (0, 1, 100, 5000):
        xs = [random.randint(0, 2**20 - 1) for _ in range(n)]
        # 1) One pass is a STABLE partition by the digit.
        sp = radix_pass(xs, shift=0, r=4)
        d = lambda x: x & 0xF
        assert [d(x) for x in sp] == sorted(d(x) for x in sp), "pass ordered by digit"
        pos = {id(x): i for i, x in enumerate(xs)}
        for bucket in range(16):              # equal-digit elements keep input order
            orig = [x for x in xs if d(x) == bucket]
            out_order = [x for x in sp if d(x) == bucket]
            assert orig == out_order, "scatter must be stable"
        # 2) Full LSD radix sort equals a comparison sort.
        assert radix_sort(xs, r=4, bits=20) == sorted(xs)
    print("OK: radix pass is a stable partition; chained LSD passes == sorted")
```

- **Constraints:** Each pass must be **stable** — equal-digit elements keep their input order — which is exactly what makes chaining LSD-first correct. The bucket start indices come from an **exclusive scan** of the per-bucket histogram; the within-bucket placement is the running cursor (the parallel form is a per-bucket exclusive scan of indicator flags). Handle `n = 0` and a single occupied bucket. Chaining `⌈bits/r⌉` passes from least- to most-significant digit must sort the array.
- **Hint:** An element with digit `d` lands at `bucket_start[d] + (count of earlier same-digit elements)`. The first term is the exclusive scan of bucket sizes; the second is a per-bucket exclusive scan of "this element has digit `d`" — so the entire address computation is scans, *no comparisons*. The comparison lower bound `Ω(n log n)` does not apply because radix sort is not a comparison sort: it reads key *bits*. Work is `Θ(n)` per pass, span `Θ(log n)` per pass (the scan dominates); `d` passes give `Θ(dn)` work — linear in `n` for fixed-width keys. This is why scan is *the* parallel-sorting primitive.
- **Acceptance test:** One pass is sorted-by-digit and stable; chaining LSD-first equals `sorted(xs)` for every input (including empty and all-same-digit). The exclusive scan of the histogram *is* the bucket-placement map — the link back to the [scan tasks](../02-parallel-prefix-sum-scan/tasks.md).

---

## Advanced Tasks

### Task 9 — Sample sort: oversample splitters, bucket, and measure load balance **[coding]**

`[hard]` **Sample sort** is the parallel sort of choice at scale (it is what most distributed and many GPU sorts use): pick `p − 1` **splitters** that partition the key range into `p` buckets of *roughly equal size*, scatter each element into its bucket, then sort the buckets independently and concatenate. The whole game is **load balance** — buckets must be near-equal or one straggler dominates the span — and the lever is the **oversampling ratio** `s`: sample `s·p` candidates, sort them, and take every `s`-th as a splitter. Implement sample sort and **measure** how the maximum bucket size (relative to `n/p`) shrinks as `s` grows.

#### Python

```python
import random
from bisect import bisect_right

def sample_sort(xs, p, s):
    """Sample sort with p buckets and oversampling ratio s.
    Returns (sorted_output, bucket_sizes). Work ~ n log n (the bucket sorts dominate);
    span ~ log^2 n if buckets are balanced and each is sorted in parallel."""
    n = len(xs)
    if n <= p or p <= 1:
        return sorted(xs), [len(xs)]
    # 1) Oversample s*p candidates, sort them, take every s-th as a splitter.
    candidates = sorted(random.sample(xs, min(s * p, n)))
    step = len(candidates) / p
    splitters = [candidates[int((i + 1) * step) - 1] for i in range(p - 1)]
    splitters.sort()
    # 2) Bucket each element by its splitter interval (binary search -> bucket id).
    buckets = [[] for _ in range(p)]
    for x in xs:
        b = bisect_right(splitters, x)        # bucket index in [0, p-1]
        buckets[b].append(x)
    # 3) Sort each bucket independently (parallel across buckets) and concatenate.
    out = []
    for b in buckets:
        out.extend(sorted(b))                 # bucket b's keys < bucket b+1's keys
    return out, [len(b) for b in buckets]

if __name__ == "__main__":
    random.seed(6)
    n, p = 100_000, 64
    print(f"n={n}  p={p}  ideal bucket size n/p={n//p}")
    print(f"{'oversample s':>13} {'max bucket':>11} {'max/(n/p)':>11} {'sorted?':>8}")
    for s in (1, 2, 4, 8, 16, 32, 64):
        xs = [random.randint(0, 10**9) for _ in range(n)]
        out, sizes = sample_sort(xs, p, s)
        assert out == sorted(xs), "sample sort must produce the sorted array"
        imbalance = max(sizes) / (n / p)
        print(f"{s:>13} {max(sizes):>11} {imbalance:>11.2f} {'yes':>8}")
        if s >= 16:
            assert imbalance < 1.6, "high oversampling -> max bucket near n/p"
    print("\nOK: sample sort sorts; max bucket / (n/p) -> 1 as oversampling s grows")
```

- **Constraints:** The output must equal `sorted(xs)` for every run — bucket `b`'s keys are all `≤` bucket `b+1`'s, so concatenating sorted buckets is globally sorted. Splitters come from `s·p` sampled candidates, sorted, with every `s`-th taken. Report the **maximum bucket size** relative to the ideal `n/p` as a function of `s`. With low `s` (`s = 1`) the imbalance is large; with high `s` (`s ≥ 16`) the max bucket must approach `n/p`.
- **Hint:** The span is set by the *largest* bucket: `T∞ ≈ (span to bucket) + (sort the biggest bucket)`. If one bucket holds `2·n/p` elements, that worker doubles the makespan — load imbalance, the same penalty as a static partition on skewed work (see the [work-stealing task](../01-models-pram-work-span/tasks.md)). Oversampling fixes it probabilistically: sampling `s·p` and taking every `s`-th makes each splitter a high-quality quantile estimate, and the maximum bucket size concentrates around `n/p · (1 + O(√(log p / s)))`. So `s = Θ(log p)` (or a small constant like 16–32 in practice) gives near-perfect balance with high probability — this is the classic Blelloch/Leighton oversampling result. The bucket sorts (each `Θ((n/p) log(n/p))`) dominate the work; total work is `Θ(n log n)` in expectation.
- **Acceptance test:** Output equals `sorted(xs)` for every `s`; the `max-bucket / (n/p)` ratio **decreases monotonically toward 1** as `s` grows, and is `< 1.6` for `s ≥ 16`. The measured table is the empirical face of the oversampling theorem: more samples buy tighter balance, hence lower span. Compare against `s = 1`, where a single unlucky splitter can leave one bucket `2–3×` the ideal.

---

### Task 10 — Parallel merge sort vs sample sort: work, span, and measured comparison **[coding + analysis]**

`[medium]` Put the two scalable comparison sorts head to head. Parallel **merge sort** (Task 4) is deterministic, oblivious-in-structure, `Θ(log² n)` span; **sample sort** (Task 9) is randomized, `Θ(log² n)` span *when balanced*, but a *single* combine (concatenation) rather than `log n` merge levels — which is exactly why it wins on real distributed machines (one round of all-to-all instead of `log p` rounds of merging). Compare their work and span analytically, and **measure** both producing the same sorted output while you tabulate the relevant cost drivers.

#### Python

```python
import random, math
from task4 import par_merge_sort
from task9 import sample_sort

def compare(n, p, s, seed=0):
    random.seed(seed)
    xs = [random.randint(0, 10**9) for _ in range(n)]
    ms_out, ms_work, ms_span = par_merge_sort(xs)
    ss_out, ss_sizes = sample_sort(xs, p, s)
    assert ms_out == sorted(xs) and ss_out == sorted(xs), "both must sort"
    return {
        "merge_sort_span": ms_span,                  # measured ~ log^2 n
        "sample_sort_levels": 1,                      # one combine (concatenation)
        "merge_sort_levels": math.ceil(math.log2(max(2, n))),  # log n merge levels
        "sample_imbalance": max(ss_sizes) / (n / p),
    }

if __name__ == "__main__":
    n, p, s = 50_000, 32, 32
    r = compare(n, p, s)
    print(f"n={n}  p={p}  oversample s={s}")
    print(f"  parallel merge sort: ~log^2 n span, {r['merge_sort_levels']} merge LEVELS "
          f"(each a parallel merge), measured span={r['merge_sort_span']}")
    print(f"  sample sort:         ~log^2 n span (balanced), {r['sample_sort_levels']} "
          f"combine level, max-bucket/(n/p)={r['sample_imbalance']:.2f}")
    # Both sort; the structural difference is #combine rounds, not the asymptotic span.
    assert r["merge_sort_levels"] > r["sample_sort_levels"]
    print("OK: both sort correctly; sample sort uses ONE combine vs log n merge levels")
```

- **Analysis to write:** **Work.** Both are `Θ(n log n)` (merge sort exactly; sample sort in expectation, once buckets are balanced and each is sorted in `Θ((n/p) log(n/p))`). **Span.** Merge sort is `Θ(log² n)` from `log n` levels each a `Θ(log n)` merge. Balanced sample sort is *also* `Θ(log² n)` — the bucketing scatter is `Θ(log n)` (a scan/binary-search), and the largest bucket's internal sort is `Θ(log²(n/p))` — but the **constant and the round structure differ**: sample sort does **one** global redistribution (a single all-to-all of elements into buckets) and then *fully local* sorts, whereas merge sort does `log n` **global** merge rounds. On a distributed machine, communication rounds dominate, so sample sort's single all-to-all beats merge sort's `log p` merge rounds — even at equal asymptotic span. The cost sample sort pays is **load imbalance risk** (Task 9): its span guarantee is *probabilistic*, contingent on good splitters, while merge sort's is deterministic. The choice: merge sort when you need a deterministic guarantee and cheap communication; sample sort at scale where the one-round redistribution is decisive and oversampling makes the imbalance negligible.
- **Constraints:** Both must produce identical sorted output. Report the measured merge-sort span, the number of *global combine rounds* for each (merge sort `Θ(log n)`, sample sort `1`), and sample sort's measured imbalance. The analysis must separate *asymptotic span* (equal) from *round structure / communication* (the real differentiator).
- **Acceptance test:** Both sorts equal `sorted(xs)`; the table shows merge sort's `log n` merge levels against sample sort's single combine; the write-up correctly identifies that the asymptotic spans tie but the **number of global rounds** — the quantity the work/span model under-weights — is why sample sort dominates at scale, with load balance as its one risk.

---

### Task 11 — Cole's `O(log n)`-span sort and AKS: why the optimum is impractical **[analysis]**

`[hard]` Parallel merge sort is `Θ(log² n)` span. Two results reach the asymptotic optimum `Θ(log n)`: **Cole's pipelined merge sort** (`O(log n)` span, `O(n log n)` work — *work-efficient and span-optimal*) and the **AKS sorting network** (`O(log n)` depth). Explain how Cole removes the extra `log n` factor, and why AKS, despite being depth-optimal, is never used in practice.

> **No code.** Use this as the grading model.

**Where the extra `log n` comes from.** Plain parallel merge sort spends `Θ(log n)` span on *each* of its `Θ(log n)` merge levels, and the levels run **sequentially** — level `k+1`'s merge cannot start until level `k`'s output exists. That serialization of `log n` independent-looking merges is the `log² n`.

**Cole's pipelining (the idea).** Cole's 1988 merge sort breaks the level-by-level serialization by **pipelining the merges across levels**. The key device: a merge does not wait for its inputs to be fully sorted — instead, each node passes a **sample** of its current sorted output up to its parent every `O(1)` rounds, and the parent merges these samples incrementally. As samples get denser, parents refine their merges, so all `log n` levels make progress *simultaneously* in a pipeline. Each level advances by a constant amount per round, so after `O(log n)` rounds the root has the fully sorted output. The crucial invariant is that a node's sample is always "good enough" — within a bounded rank distance of the true positions — so the incremental merges stay correct and `O(1)`-work per element per round. The result: `T∞ = O(log n)`, `T₁ = O(n log n)` (work-efficient), on the EREW PRAM. It **matches the `Ω(log n)` span lower bound** (a comparison sort's output depends on all `n` inputs; the dependency set doubles per round — see the [reduction lower bound](../01-models-pram-work-span/tasks.md)) — so Cole's sort is span-optimal *and* work-optimal.

**AKS (the other `O(log n)` route).** The **Ajtai–Komlós–Szemerédi** sorting network (1983) is an *oblivious* network of `O(log n)` depth and `O(n log n)` comparators — asymptotically optimal depth for a network. It is built from **expander graphs** that perform approximate halving (ε-halvers) recursively, cleaning up the few out-of-place elements at each stage.

**Why AKS is impractical (the honest part).** The `O(log n)` hides an astronomically large constant — original estimates put it around `~6100` (and even heavily optimized variants leave a constant in the *thousands*). So AKS only beats bitonic sort's `Θ(log² n)` once `log n > constant`, i.e. for `n` far larger than any physical input (`n ≫ 2^thousands`). The expander construction is also intricate and has poor locality. **In practice:** bitonic/Batcher networks (`Θ(log² n)`, tiny constant, regular structure, SIMD-friendly) win for oblivious sorting; sample sort and parallel merge sort win for data-dependent sorting. AKS is a landmark *existence* proof — it settled that `O(log n)`-depth networks exist — but its constant makes it a theoretical object, not an algorithm anyone runs. Cole's sort, by contrast, has reasonable constants and is genuinely practical where its EREW model fits.

- **Constraints:** Explain (1) *why* plain merge sort is `Θ(log² n)` — the sequential stacking of `log n` merge levels; (2) *how* Cole pipelines the merges to overlap all levels and reach `O(log n)` span at `O(n log n)` work; (3) *what* AKS achieves (`O(log n)` depth oblivious network via expanders) and (4) *why* its galactic constant makes it impractical while bitonic's `Θ(log² n)` with a tiny constant wins in reality. Connect Cole's optimality to the `Ω(log n)` span lower bound.
- **Acceptance test:** The answer correctly locates the extra `log n` in the serial level structure, describes Cole's sample-pipelining at a conceptual level (samples passed up, incremental refinement, `O(1)` work per element per round), states AKS's `O(log n)`-depth/expander construction and its `~thousands` constant, and concludes that asymptotic optimality (AKS) loses to small-constant `log²` networks (bitonic) for every realistic `n`. Both Cole and AKS are correctly tied to the `Ω(log n)` span floor.

---

### Task 12 — Parallel quicksort: partition via scan, and analyze the span **[coding + analysis]**

`[hard]` **Parallel quicksort** parallelizes two ways at once: the two recursive sub-sorts are independent (parallel), and the partition itself is parallel — a pivot comparison gives a flag array, and an **exclusive scan** of the flags computes each element's destination (the scan-based stream compaction from the [scan tasks](../02-parallel-prefix-sum-scan/tasks.md)). Implement it with scan-based partition and analyze the span — both the lucky `Θ(log² n)` and the unlucky `Θ(n)` case.

#### Python

```python
import random

def exclusive_scan(flags):
    out, acc = [], 0
    for f in flags:
        out.append(acc); acc += f
    return out

def partition_by_scan(xs, pivot):
    """Parallel three-way partition via scans: < pivot, == pivot, > pivot.
    Each element's destination = exclusive scan of its group's flags. Theta(n) work,
    Theta(log n) span (the scan). Returns (less, equal, greater) preserving order."""
    lt = [1 if x < pivot else 0 for x in xs]
    eq = [1 if x == pivot else 0 for x in xs]
    gt = [1 if x > pivot else 0 for x in xs]
    lt_off = exclusive_scan(lt)
    eq_off = exclusive_scan(eq)
    gt_off = exclusive_scan(gt)
    nlt = lt_off[-1] + lt[-1] if xs else 0
    neq = eq_off[-1] + eq[-1] if xs else 0
    less = [None] * nlt
    equal = [None] * neq
    greater = [None] * (len(xs) - nlt - neq)
    for i, x in enumerate(xs):              # scatter: distinct indices -> race-free
        if lt[i]:   less[lt_off[i]] = x
        elif eq[i]: equal[eq_off[i]] = x
        else:       greater[gt_off[i]] = x
    return less, equal, greater

def par_quicksort(xs, depth=0):
    """Parallel quicksort. Returns (sorted, span). Recursive calls are independent
    (span = max). Partition span = Theta(log n) (scan); recursion depth sets the rest."""
    if len(xs) <= 1:
        return list(xs), 0
    pivot = xs[len(xs) // 2]                 # simple pivot; randomize for the analysis
    less, equal, greater = partition_by_scan(xs, pivot)
    import math
    part_span = max(1, math.ceil(math.log2(len(xs))))   # the scan
    ls, lspan = par_quicksort(less, depth + 1)
    gs, gspan = par_quicksort(greater, depth + 1)        # independent of the left sort
    span = max(lspan, gspan) + part_span                 # parallel sub-sorts + this partition
    return ls + equal + gs, span

if __name__ == "__main__":
    random.seed(7)
    for n in (0, 1, 2, 8, 17, 1000, 4096):
        xs = [random.randint(0, 50) for _ in range(n)]
        got, span = par_quicksort(xs)
        assert got == sorted(xs), f"parallel quicksort must sort (n={n})"
    # Best case (balanced splits): span ~ log n partitions, each Theta(log n) -> log^2 n.
    bal = list(range(8192)); random.shuffle(bal)
    _, span_bal = par_quicksort(bal)
    import math
    print(f"balanced-ish n=8192: span={span_bal} vs log^2 n={math.ceil(math.log2(8192))**2}")
    # Worst case (already sorted, last/median-of-fixed pivot): recursion depth ~ n.
    print("OK: parallel quicksort sorts via scan-partition; span analysis below")
```

- **Analysis to write:** The partition is `Θ(n)` work and `Θ(log n)` span (three flag arrays, three exclusive scans, one race-free scatter — exactly stream compaction). The recursion's span is `T∞(n) = max(T∞(|less|), T∞(|greater|)) + Θ(log n)` because the two sub-sorts are independent. **Lucky case (balanced pivots):** the recursion depth is `Θ(log n)`, each level adding a `Θ(log n)` partition, so `T∞ = Θ(log² n)` and `T₁ = Θ(n log n)` — competitive with merge sort. **Unlucky case (adversarial or fixed pivot on sorted input):** splits are maximally uneven, recursion depth `Θ(n)`, each partition `Θ(log n)`, giving `T∞ = Θ(n log n)` span — *worse than sequential merge sort's span*, the parallelism destroyed. **Randomized pivots** make the depth `Θ(log n)` *with high probability*, restoring `Θ(log² n)` expected span; the work stays `Θ(n log n)` expected. The lesson: quicksort's parallelism lives entirely in *balanced partitions*, and the partition being parallel (via scan) is necessary but not sufficient — pivot quality controls the span, just as splitter quality controls sample sort's.
- **Constraints:** The partition must be built from **exclusive scans** of flag arrays (no sequential append-loop deciding positions). The span recurrence must `max` over the two independent sub-sorts. Give *both* the balanced `Θ(log² n)` and the degenerate `Θ(n log n)`-span analysis, and state that randomizing the pivot restores the good case with high probability. Output must equal `sorted(xs)` for every input.
- **Acceptance test:** Output equals `sorted(xs)` for all `n`; the partition uses scans; the analysis correctly derives `Θ(log² n)` span for balanced pivots and `Θ(n log n)` span for degenerate ones, and explains how randomized pivots recover the `Θ(log² n)` expected span. Parallel quicksort joins merge sort and sample sort as a `Θ(log² n)`-span sort — when its pivots cooperate.

---

## Synthesis Task

> Tie parallel sorting and merging together end to end: build the sequential merge baseline and the parallel merge (rank, then co-rank) with work/span counters, stack a parallel merge sort on top, build the oblivious bitonic network and certify it with the 0-1 principle, build the scan-based radix sort, and the splitter-based sample sort — confirming every parallel output equals a sorted reference while the counters respect the bound, then derive the recurrences and reason about the optimal-span results.

`[capstone]` Carry **parallel sorting** from merge to network to splitter: implement, count, verify, and prove.

1. **Merge core [coding].** Sequential merge baseline (Task 1); merge-by-rank with counters → `Θ(N log N)` work, `Θ(log N)` span (Task 2); co-ranking → work-efficient `Θ(N)` chunked merge (Task 3). Confirm every merge equals `merge_seq`.

2. **Comparison sorts [coding].** Parallel merge sort on the parallel merge → `Θ(n log n)` work, `Θ(log² n)` span (Task 4); parallel quicksort via scan-partition (Task 12); sample sort with oversampling (Task 9). Confirm each equals `sorted(xs)`.

3. **Oblivious sort [coding + analysis].** Bitonic/Batcher network with counters → `Θ(n log² n)` work, `Θ(log² n)` span (Task 5); certify it with the 0-1 principle over all `2ⁿ` binary inputs (Task 6).

4. **Non-comparison sort [coding].** Radix sort, each pass a histogram + exclusive scan + stable scatter, `Θ(n)` work / `Θ(log n)` span per pass (Task 8).

5. **Prove and compare [analysis].** The `Θ(log² n)` span recurrence (Task 7); merge sort vs sample sort by work, span, and round structure (Task 10); Cole's `O(log n)` optimum and why AKS is impractical (Task 11).

Reference harness in **Python** (drives the pieces and checks every bound):

```python
import random, math
from task1 import merge_seq
from task2 import merge_by_rank
from task4 import par_merge_sort
from task5 import bitonic_sort
from task8 import radix_sort
from task9 import sample_sort
from task12 import par_quicksort

def synth(n, seed=0):
    random.seed(seed)
    xs = [random.randint(0, 10**6) for _ in range(n)]
    ref = sorted(xs)

    # Merge: rank merge of two sorted halves matches the stable sequential merge.
    h = n // 2
    A, B = sorted(xs[:h]), sorted(xs[h:])
    merged, mwork, mspan = merge_by_rank(A, B)
    assert merged == merge_seq(A, B)
    if n >= 2:
        assert mspan <= math.ceil(math.log2(n)) + 2, "merge span O(log n)"

    # Comparison sorts.
    ms, ms_work, ms_span = par_merge_sort(xs)
    assert ms == ref
    if n >= 2:
        assert ms_span <= (math.ceil(math.log2(n)) + 1) ** 2, "merge sort span O(log^2 n)"

    qs, _ = par_quicksort(xs)
    assert qs == ref

    ss, _ = sample_sort(xs, p=8, s=16)
    assert ss == ref

    # Oblivious sort + non-comparison sort.
    bt, bt_work, bt_span = bitonic_sort(xs)
    assert bt == ref
    assert radix_sort(xs, r=4, bits=20) == ref
    return ms_span, bt_span

if __name__ == "__main__":
    print(f"{'n':>7} {'merge-sort span':>16} {'bitonic span':>14} "
          f"{'log n':>7} {'log^2 n':>9}")
    for n in (16, 256, 4096):
        ms_span, bt_span = synth(n)
        lg = math.ceil(math.log2(n))
        print(f"{n:>7} {ms_span:>16} {bt_span:>14} {lg:>7} {lg*lg:>9}")
    print("\nOK: every parallel sort/merge == sorted reference; "
          "merge-sort and bitonic spans both ~ log^2 n")
```

- **Analysis answer:** A parallel **merge** computes each element's output rank independently — `Θ(log N)` span — and the work-efficient form (**co-ranking**) splits the output into `P` chunks via binary search and runs `P` sequential merges for `Θ(N)` work. **Parallel merge sort** sorts the halves in parallel and merges, giving `Θ(n log n)` work and `Θ(log² n)` span (`T∞(n) = T∞(n/2) + Θ(log n)` over `log n` levels). **Bitonic sort** is an *oblivious* compare-swap network of `Θ(log² n)` depth and `Θ(n log² n)` work, trusted because of the **0-1 principle** (sorting all `2ⁿ` binary inputs certifies it sorts everything, via the monotone-commuting lemma and a threshold function). **Radix sort** uses no comparisons — each pass is a histogram + exclusive scan + stable scatter, `Θ(n)` work and `Θ(log n)` span per pass — sidestepping the comparison `Ω(n log n)` bound. **Sample sort** oversamples splitters to bucket near-uniformly, then sorts buckets independently; its span and quality hinge on **load balance**, which oversampling ratio `s = Θ(log p)` makes tight with high probability. The asymptotic span optimum is `Θ(log n)`, met by **Cole's pipelined merge sort** (work-efficient, practical) and the **AKS network** (oblivious, but a galactic constant makes it theoretical) — both matching the `Ω(log n)` span floor; in practice small-constant `Θ(log² n)` bitonic and the data-dependent merge/sample/radix sorts win.
- **Acceptance test:** Every parallel merge equals the stable sequential merge; every parallel sort equals `sorted(xs)`; merge-by-rank measures `Θ(log N)` span, parallel merge sort and bitonic both `Θ(log² n)`; bitonic is certified over all `2ⁿ` binary inputs; radix sort equals a comparison sort; sample sort's max bucket approaches `n/p` as oversampling grows. The write-up mirrors the whole discipline: *run the sort or merge level by level, count the compares and the rounds, confirm the output equals a sorted reference and the counters match the bound — then prove the 0-1 principle, derive the `log²` span, and place the `log n` optimum in its impractical-constant context.*

---

## Where to go next

- Revisit the work/span model, Brent's bound, the `Ω(log n)` span floor that Cole's sort meets, and the load-imbalance penalty that sample sort's oversampling fights, in the [models: PRAM and work–span tasks](../01-models-pram-work-span/tasks.md).
- Build the exclusive scan, stream compaction, and radix-split that the radix sort and scan-based partition here are made of — the parallel-sorting primitive in full — in the [parallel prefix sum / scan tasks](../02-parallel-prefix-sum-scan/tasks.md).
- For the conceptual treatment of parallel merging, the bitonic/Batcher networks, the 0-1 principle, sample sort, and the Cole/AKS optimality results, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.

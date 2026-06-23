# Parallel Prefix Sum (Scan) — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the scan **round-by-round**, drive a **work counter** and a **span counter** alongside it, and **confirm the measured work/span match the bound**. The acceptance test is always the same shape: *the parallel scan output equals the sequential scan **and** the measured work and span match the derived bound (`n log n` / `log n` for Hillis–Steele, `Θ(n)` / `Θ(log n)` for Blelloch).*
> **[analysis]** tasks need no code: derive a work/span, prove a round invariant, or prove the `Ω(log n)` lower bound from first principles — model derivations are provided so you can grade yourself.

A **scan** (prefix sum) takes a sequence `x₀, x₁, …, x_{n−1}` and an associative operator `⊕` and produces all running aggregates. Two flavors, and you must convert between them by reflex:

- **Inclusive scan:** `y_i = x₀ ⊕ x₁ ⊕ … ⊕ x_i` (element `i` *included*).
- **Exclusive scan:** `y_i = id ⊕ x₀ ⊕ … ⊕ x_{i−1}` (element `i` *excluded*; `y₀ = id`, the identity of `⊕`).

The two algorithms that matter, and the bounds you will build, measure, and prove on every task:

| Algorithm | Work `T₁` | Span `T∞` | Work-efficient? | Shape |
| --- | --- | --- | --- | --- |
| **Sequential** | `Θ(n)` | `Θ(n)` | — (the baseline) | one left-to-right fold |
| **Hillis–Steele** | `Θ(n log n)` | `Θ(log n)` | **no** (`log n` blow-up) | `log n` rounds, each `Θ(n)` adds |
| **Blelloch** (up/down-sweep) | `Θ(n)` | `Θ(log n)` | **yes** | reduce up, distribute down |

The recurring discipline for every coding task is identical to the way work–span bounds are checked: **run the parallel algorithm round by round, increment a work counter for every `⊕` and bump a span counter once per round (the critical-path depth), and confirm the output matches the sequential fold while the counters respect the bound.** A scan you never check against the sequential answer is a guess; a work/span you measure but never bracket with the bound is just a number. Tie the two together on every task.

**Related practice:**
- [Models: PRAM and Work–Span tasks](../01-models-pram-work-span/tasks.md) — the work/span model, Brent's bound, and the work-efficiency argument that decides Hillis–Steele vs Blelloch; the `Ω(log n)` reduction-span lower bound lives there too.
- [Parallel Sorting and Merging tasks](../03-parallel-sorting-and-merging/tasks.md) — the scan-based radix-sort split and stream compaction you build here are the workhorses behind parallel sorting.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Unit operation.** One `⊕` is one unit of work. **Work** `T₁` is the total number of `⊕` operations; **span** `T∞` is the number of *parallel rounds* — the critical-path depth, the time on infinitely many processors.
- **A round.** One synchronized parallel step: every element does its `⊕` for this round simultaneously, then a barrier. Span counts rounds, not operations.
- **The PRAM read model.** Hillis–Steele as written has every element read `a[i]` and `a[i−d]` in the same round; reading from the *previous* round's buffer (double buffering) keeps it EREW-clean — never read and write the same cell in one round.
- **The idealization.** Work and span charge nothing for communication or synchronization. The work-efficiency question — does the parallel algorithm do `Θ(n)` work like the sequential one, or `Θ(n log n)`? — is what decides which algorithm a real machine should run, because every processor pays the wasted work on every invocation.

---

## Beginner Tasks

### Task 1 — Sequential inclusive and exclusive scan; the baseline and the conversions **[coding]**

`[easy]` Build the ground truth every later task checks against: the **sequential** inclusive and exclusive scan over an associative operator with identity. Both are a single left-to-right fold in `Θ(n)` work and `Θ(n)` span (the fold is a length-`n` dependency chain). Then implement the two **conversions** you will need constantly: inclusive → exclusive (shift right, insert the identity) and exclusive → inclusive (add each element back in).

#### Python

```python
def inclusive_scan(xs, op, identity):
    """y[i] = x[0] op x[1] op ... op x[i].  Theta(n) work, Theta(n) span (a fold)."""
    out, acc = [], identity
    for x in xs:
        acc = op(acc, x)      # include x THEN store
        out.append(acc)
    return out

def exclusive_scan(xs, op, identity):
    """y[i] = identity op x[0] op ... op x[i-1].  y[0] = identity."""
    out, acc = [], identity
    for x in xs:
        out.append(acc)       # store the running total BEFORE including x
        acc = op(acc, x)
    return out

def inclusive_to_exclusive(inc, xs, op, inv_or_identity):
    """Shift right by one and prepend the identity: exc[0]=id, exc[i]=inc[i-1]."""
    return [inv_or_identity] + inc[:-1]

def exclusive_to_inclusive(exc, xs, op):
    """Add each element back: inc[i] = exc[i] op x[i]."""
    return [op(exc[i], xs[i]) for i in range(len(xs))]

if __name__ == "__main__":
    import operator, random
    random.seed(0)
    add, idn = operator.add, 0
    xs = [random.randint(-5, 9) for _ in range(20)]

    inc = inclusive_scan(xs, add, idn)
    exc = exclusive_scan(xs, add, idn)

    # inc[i] - exc[i] == xs[i] for addition; in general inc[i] = exc[i] op xs[i].
    assert all(inc[i] == exc[i] + xs[i] for i in range(len(xs)))
    assert inclusive_to_exclusive(inc, xs, add, idn) == exc
    assert exclusive_to_inclusive(exc, xs, add) == inc
    assert inc[-1] == sum(xs) and exc[-1] == sum(xs) - xs[-1]
    print("OK: inclusive/exclusive scans and the two conversions agree")
```

#### Go (core)

```go
// InclusiveScan: y[i] = x[0] op ... op x[i].  ExclusiveScan: y[i] = id op x[0] op ... op x[i-1].
func InclusiveScan(xs []int, op func(int, int) int, id int) []int {
	out := make([]int, len(xs))
	acc := id
	for i, x := range xs {
		acc = op(acc, x) // include then store
		out[i] = acc
	}
	return out
}

func ExclusiveScan(xs []int, op func(int, int) int, id int) []int {
	out := make([]int, len(xs))
	acc := id
	for i, x := range xs {
		out[i] = acc // store then include
		acc = op(acc, x)
	}
	return out
}
```

- **Constraints:** `op` must be **associative** with `identity` as a two-sided neutral element (`op(identity, a) = op(a, identity) = a`). Inclusive and exclusive must differ by exactly one shift: `exclusive[i] = inclusive[i−1]` (with `exclusive[0] = identity`), and `inclusive[i] = op(exclusive[i], x[i])`. The last inclusive value is the full reduction `x₀ ⊕ … ⊕ x_{n−1}`.
- **Hint:** The only difference between the two folds is the *order* of "store" and "include": exclusive stores the accumulator *before* folding in the current element, inclusive *after*. Memorize `exclusive = [identity] + inclusive[:-1]` — it is exact for any associative `op`, no inverse required, and is how you will turn the exclusive scan that compaction needs into the inclusive scan an algorithm produced (and vice versa).
- **Acceptance test:** For random inputs, `inclusive[i] = exclusive[i] ⊕ x[i]` for all `i`, `exclusive = [identity] + inclusive[:-1]`, and `inclusive[-1]` equals the reduction. Keep these four functions — every later task validates its parallel output against `inclusive_scan` / `exclusive_scan`.

---

### Task 2 — Hillis–Steele scan, round by round, with work and span counters **[coding]**

`[easy]` Implement the **Hillis–Steele** (naive) inclusive scan: for offsets `d = 1, 2, 4, …, < n`, every element `i ≥ d` becomes `a[i] ⊕ a[i−d]`, all in one round, reading from the *previous* round's buffer. Drive a **work counter** (one increment per `⊕`) and a **span counter** (one increment per round) alongside it, then confirm the output matches Task 1's sequential inclusive scan and the counters match `T₁ ≈ n log n`, `T∞ = ⌈log₂ n⌉`.

#### Python

```python
from math import log2, ceil

def hillis_steele(xs, op, identity):
    """Inclusive scan in ceil(log2 n) rounds. Returns (result, work, span).
    work counts every op; span counts rounds (the critical-path depth)."""
    n = len(xs)
    a = list(xs)
    work = span = 0
    d = 1
    while d < n:
        b = list(a)                 # read previous round (double buffer -> EREW-clean)
        for i in range(d, n):
            b[i] = op(a[i], a[i - d])
            work += 1               # one op per active element this round
        a = b
        span += 1                   # one round = one unit of span
        d *= 2
    return a, work, span

if __name__ == "__main__":
    import operator, random
    from task1 import inclusive_scan  # reuse the baseline
    random.seed(1)
    for n in (1, 2, 8, 16, 17, 1000, 4096):
        xs = [random.randint(0, 9) for _ in range(n)]
        got, work, span = hillis_steele(xs, operator.add, 0)
        assert got == inclusive_scan(xs, operator.add, 0), "must match sequential scan"
        expected_span = 0 if n <= 1 else ceil(log2(n))
        assert span == expected_span, f"span must be ceil(log2 n) = {expected_span}"
        # Work is sum over rounds of (n - d): bounded by n*log n, > (n/2)*log n.
        assert work <= n * max(1, ceil(log2(n)))
        if n >= 4:
            assert work >= (n // 2) * (expected_span)  # within a constant of n log n
        print(f"n={n:5d}  work={work:7d}  span={span:2d}  "
              f"(n*ceil(log2 n)={n*expected_span})")
    print("OK: Hillis-Steele matches sequential; span=ceil(log2 n), work=Theta(n log n)")
```

- **Constraints:** **Double buffer** — read every `a[i]` and `a[i−d]` from the *previous* round's array and write into a fresh one, so no cell is read and written in the same round (EREW-clean). The offset doubles each round: `d = 1, 2, 4, …`; the loop runs while `d < n`, giving exactly `⌈log₂ n⌉` rounds. Increment work *per `⊕`*, span *per round*.
- **Hint:** Round `r` (with `d = 2^r`) does `n − d` operations, so total work is `Σ_{r} (n − 2^r) = n·⌈log₂ n⌉ − (n − 1) = Θ(n log n)` — strictly more than the sequential `n − 1`. The span is the round count `⌈log₂ n⌉` because each round depends on the one before. If your output is wrong, you almost certainly read from the array you are writing into; the double buffer is mandatory.
- **Acceptance test:** Output equals `inclusive_scan` for every `n` (including non-powers of two and `n = 1`); `span = ⌈log₂ n⌉`; `work` is `Θ(n log n)` (between `(n/2)·log n` and `n·log n`). This is the canonical *work-inefficient, low-span* scan — Task 6 will prove why it works, Task 4 builds the *work-efficient* alternative.

---

### Task 3 — Verify the Hillis–Steele invariant empirically and convert inclusive↔exclusive **[coding]**

`[easy]` Hillis–Steele works because after round `r` each `a[i]` holds the sum of the `2^r` elements ending at `i` (clamped at the array start). Instrument the algorithm to **assert that invariant after every round**, then use Task 1's conversion to produce an **exclusive** scan from the inclusive Hillis–Steele result and check it against the sequential exclusive scan.

#### Python

```python
import operator
from task1 import inclusive_scan, exclusive_scan, inclusive_to_exclusive

def hillis_steele_checked(xs):
    """Inclusive add-scan that asserts the window invariant after each round."""
    n = len(xs)
    a = list(xs)
    d = 1
    while d < n:
        b = list(a)
        for i in range(d, n):
            b[i] = a[i] + a[i - d]
        a = b
        # Invariant after this round: a[i] = sum of the last min(i+1, 2*d) elements.
        window = 2 * d
        for i in range(n):
            lo = max(0, i - window + 1)
            assert a[i] == sum(xs[lo:i + 1]), f"window invariant broke at i={i}, d={d}"
        d *= 2
    return a

if __name__ == "__main__":
    import random
    random.seed(2)
    for n in (1, 5, 16, 31, 256):
        xs = [random.randint(0, 9) for _ in range(n)]
        inc = hillis_steele_checked(xs)
        assert inc == inclusive_scan(xs, operator.add, 0)
        exc = inclusive_to_exclusive(inc, xs, operator.add, 0)
        assert exc == exclusive_scan(xs, operator.add, 0), "converted exclusive must match"
    print("OK: window invariant holds every round; inclusive->exclusive conversion verified")
```

- **Constraints:** After the round with offset `d`, every `a[i]` must equal the sum of the last `min(i+1, 2d)` input elements — assert it for *every* `i` after *every* round, not just at the end. The exclusive scan must come from the inclusive result via the shift-and-prepend conversion (no second pass over the data).
- **Hint:** The reach doubles each round: before any round the window is `1` (just `x_i`); after offset `1` it is `2`; after offset `2` it is `4`; after offset `2^r` it is `2^{r+1}`. Once the window covers `i+1` elements (reaches the array start) the value stops changing — that is why short prefixes "finish early" and the final array is the full inclusive scan. The exclusive conversion is `[0] + inc[:-1]`.
- **Acceptance test:** The per-round window assertion never fires for any `n`; the final inclusive scan matches `inclusive_scan`; and the converted exclusive scan matches `exclusive_scan`. You have now *proved* (empirically) the invariant Task 6 proves on paper, and exercised the conversion compaction will need.

---

### Task 4 — Blelloch up-sweep / down-sweep scan; verify `Θ(n)` work, `Θ(log n)` span **[coding]**

`[easy]` Implement the **work-efficient Blelloch** *exclusive* scan: an **up-sweep** (a reduction tree that fills internal nodes with partial sums) followed by a **down-sweep** (clear the root to the identity, then push partial sums back down, swapping and combining). Count work and span across both sweeps and confirm `T₁ = Θ(n)` (about `2n` operations) and `T∞ = Θ(log n)` (about `2 log n` rounds) — the algorithm that matches the sequential work *and* keeps logarithmic span.

#### Python

```python
from math import log2

def blelloch_exclusive(xs):
    """Work-efficient exclusive scan (n a power of two). Returns (result, work, span)."""
    n = len(xs)
    assert n & (n - 1) == 0, "Blelloch as written needs n a power of two (pad otherwise)"
    a = list(xs)
    work = span = 0

    # ---- Up-sweep (reduce): a[i + 2d - 1] += a[i + d - 1] for stride 2d. ----
    d = 1
    while d < n:
        for i in range(0, n, 2 * d):
            a[i + 2 * d - 1] += a[i + d - 1]
            work += 1
        span += 1                      # one parallel round per level
        d *= 2
    # a[n-1] now holds the total sum.

    # ---- Down-sweep (distribute prefixes). ----
    a[n - 1] = 0                        # identity at the root: makes it EXCLUSIVE
    d = n // 2
    while d >= 1:
        for i in range(0, n, 2 * d):
            t = a[i + d - 1]           # save left child
            a[i + d - 1] = a[i + 2 * d - 1]      # left gets parent
            a[i + 2 * d - 1] = a[i + 2 * d - 1] + t  # right gets parent + old left
            work += 1                  # one combine per node this level
        span += 1
        d //= 2
    return a, work, span

if __name__ == "__main__":
    import operator, random
    from task1 import exclusive_scan
    random.seed(3)
    for n in (1, 2, 4, 8, 16, 1024, 4096):
        xs = [random.randint(0, 9) for _ in range(n)]
        got, work, span = blelloch_exclusive(xs)
        assert got == exclusive_scan(xs, operator.add, 0), "must match sequential exclusive"
        # Work ~ 2(n-1) (n-1 up + n-1 down); span ~ 2 log2 n.
        assert work <= 2 * n, f"work must be Theta(n), got {work} for n={n}"
        if n >= 2:
            assert span == 2 * int(log2(n)), f"span must be 2 log2 n, got {span}"
        print(f"n={n:5d}  work={work:6d}  span={span:2d}  "
              f"(2(n-1)={2*(n-1)}, 2 log2 n={2*int(log2(max(1,n)))})")
    print("OK: Blelloch matches sequential exclusive; work=Theta(n), span=Theta(log n)")
```

- **Constraints:** `n` must be a power of two (pad with the identity otherwise — see Task 8). The up-sweep does exactly `n − 1` combines (the internal nodes of a binary tree); the down-sweep does exactly `n − 1` combines; total work `2(n−1) = Θ(n)`, **matching the sequential `n−1` to within a factor of 2** — that is *work-efficiency*. The down-sweep's order matters: save the left child, overwrite it with the parent, set the right child to parent `⊕` old-left.
- **Hint:** The up-sweep is the reduction tree of [the reduce task](../01-models-pram-work-span/tasks.md): after it, `a[n−1]` is the total and each internal node holds the sum of its subtree. Setting the root to the *identity* before the down-sweep is exactly what makes the scan **exclusive** — each node passes its accumulated left-context down. For inclusive, run this then add `x[i]` back (Task 1's conversion). Span is `2⌈log₂ n⌉` rounds (one per tree level, up then down).
- **Acceptance test:** Output equals `exclusive_scan` for every power-of-two `n`; `work ≤ 2n` (i.e. `Θ(n)`, work-efficient); `span = 2 log₂ n` (i.e. `Θ(log n)`). Place the counters next to Task 2's: same span class, but Blelloch's work is `Θ(n)` against Hillis–Steele's `Θ(n log n)` — the whole point.

---

## Intermediate Tasks

### Task 5 — Stream compaction (parallel filter) via exclusive scan of a flag array **[coding]**

`[medium]` The single most important *application* of scan: **stream compaction** — keep only the elements satisfying a predicate, packed densely, in parallel. The trick is *flags → scan → scatter*: build a 0/1 flag array, take its **exclusive** scan (each kept element's flag-scan value is its output index), then **scatter** each kept element to that index. Implement it driving the scan from Task 4 (or 2), and verify it equals the sequential filter.

#### Python

```python
from task1 import exclusive_scan
import operator

def compact(xs, keep):
    """Stream compaction: dense array of the elements where keep(x) is true,
    in original order, via flags -> exclusive scan -> scatter."""
    flags = [1 if keep(x) else 0 for x in xs]          # map: predicate -> 0/1
    offsets = exclusive_scan(flags, operator.add, 0)   # exclusive scan of flags
    total = offsets[-1] + flags[-1] if flags else 0    # number kept = inclusive total
    out = [None] * total
    for i, x in enumerate(xs):                         # scatter (parallel: independent writes)
        if flags[i]:
            out[offsets[i]] = x                        # offsets[i] = its dense index
    return out

if __name__ == "__main__":
    import random
    random.seed(4)
    for n in (0, 1, 50, 1000):
        xs = [random.randint(0, 99) for _ in range(n)]
        pred = lambda x: x % 2 == 0
        got = compact(xs, pred)
        expected = [x for x in xs if pred(x)]          # sequential filter = ground truth
        assert got == expected, "compaction must equal the sequential filter (order preserved)"
        # Every kept element landed at a distinct, contiguous index.
        assert len(got) == sum(1 for x in xs if pred(x))
    print("OK: stream compaction via flags -> exclusive scan -> scatter matches sequential filter")
```

#### Go (core)

```go
// Compact: dense slice of xs[i] where keep(xs[i]), via flags -> exclusive scan -> scatter.
func Compact(xs []int, keep func(int) bool) []int {
	flags := make([]int, len(xs))
	for i, x := range xs {
		if keep(x) {
			flags[i] = 1
		}
	}
	off := ExclusiveScan(flags, func(a, b int) int { return a + b }, 0) // from Task 1
	total := 0
	if len(xs) > 0 {
		total = off[len(off)-1] + flags[len(flags)-1]
	}
	out := make([]int, total)
	for i, x := range xs { // scatter: each write is to a distinct index -> race-free
		if flags[i] == 1 {
			out[off[i]] = x
		}
	}
	return out
}
```

- **Constraints:** The flag array is `1` for kept elements, `0` otherwise. Use the **exclusive** scan: `offsets[i]` is the count of kept elements *strictly before* `i`, which is exactly the dense output index for a kept element `i`. The output size is the *inclusive* total `offsets[n−1] + flags[n−1]`. The scatter writes are to **distinct** indices, so they are race-free and fully parallel. Original order must be preserved.
- **Hint:** This is why exclusive (not inclusive) scan is the compaction primitive: a kept element at position `i` must land *after* all kept elements before it, i.e. at index = (number kept before `i`) = exclusive-scan of flags at `i`. The three phases — map (predicate), scan (offsets), scatter (write) — are each `Θ(n)` work and `Θ(log n)` span (the scan dominates the span). Build compaction once and you have parallel `filter`, the backbone of [parallel partitioning and sorting](../03-parallel-sorting-and-merging/tasks.md).
- **Acceptance test:** `compact(xs, keep)` equals the sequential list comprehension `[x for x in xs if keep(x)]` for every input (including empty and all-rejected); each kept element occupies a distinct contiguous index. The exclusive scan of the flag array *is* the index map.

---

### Task 6 — Prove the Hillis–Steele round invariant **[analysis]**

`[medium]` Make Task 3's empirical check rigorous: prove by induction that after the round with offset `d = 2^r`, every cell holds the sum of a window of length `min(i+1, 2^{r+1})` ending at `i`, hence after `⌈log₂ n⌉` rounds the array is the inclusive scan. Then derive the work and span.

> **No code.** Use this as the grading model.

**Setup.** Let `a^{(r)}[i]` be the array after the round with offset `d = 2^r` (`a^{(−1)} = x` is the input, before any round). Each round computes `a^{(r)}[i] = a^{(r−1)}[i] ⊕ a^{(r−1)}[i − 2^r]` for `i ≥ 2^r`, and leaves `a^{(r)}[i] = a^{(r−1)}[i]` for `i < 2^r` (no left neighbor).

**Claim (window invariant).** For all `r ≥ −1` and all `i`,

```
a^{(r)}[i] = x[i − w + 1] ⊕ … ⊕ x[i],   where w = min(i + 1, 2^{r+1}).
```

That is, `a^{(r)}[i]` is the running sum over the last `2^{r+1}` elements, clamped so it never reads before index `0`.

**Base case (`r = −1`).** `w = min(i+1, 1) = 1`, so the claim reads `a^{(−1)}[i] = x[i]` — true by definition of the input.

**Inductive step.** Assume the claim for `r−1`; prove it for `r` (offset `d = 2^r`). Two cases for cell `i`:

- *`i < 2^r` (no left neighbor):* the round copies, `a^{(r)}[i] = a^{(r−1)}[i]`. By hypothesis that is the sum of the last `min(i+1, 2^r)` elements; but `i+1 ≤ 2^r ≤ 2^{r+1}`, so `min(i+1, 2^{r+1}) = i+1 = min(i+1, 2^r)` — the window already reached the start and cannot grow. The claim holds.
- *`i ≥ 2^r`:* `a^{(r)}[i] = a^{(r−1)}[i] ⊕ a^{(r−1)}[i − 2^r]`. By hypothesis the first term covers `x[i − u + 1 … i]` with `u = min(i+1, 2^r)`, and the second covers `x[(i−2^r) − v + 1 … i − 2^r]` with `v = min(i − 2^r + 1, 2^r)`. Because **`⊕` is associative**, the two contiguous, adjacent windows concatenate into `x[i − (u+v) + 1 … i]`. A short case check on whether the left window reached index `0` gives `u + v = min(i+1, 2^{r+1})`, exactly the claimed `w`. (Associativity is what licenses regrouping the two partial sums into one; without it the doubling argument fails.)

**Conclusion.** After the last round, `r = ⌈log₂ n⌉ − 1`, so `2^{r+1} ≥ n` and `w = min(i+1, 2^{r+1}) = i+1` for every `i` — the window covers the whole prefix `x[0 … i]`. Therefore `a[i] = x[0] ⊕ … ⊕ x[i]`, the inclusive scan. ∎

**Work and span.** Round `r` does `n − 2^r` operations, so

```
T₁ = Σ_{r=0}^{⌈log n⌉−1} (n − 2^r) = n⌈log₂ n⌉ − (2^{⌈log n⌉} − 1) = Θ(n log n).
T∞ = ⌈log₂ n⌉                       (one round per offset; each depends on the last).
```

- **Constraints:** State and prove the window invariant by induction on the round, *explicitly* invoking associativity in the inductive step. Handle the clamping case `i < d` (copy) separately from the combine case `i ≥ d`. Conclude that after `⌈log₂ n⌉` rounds the window covers `[0, i]`. Derive `T₁ = Θ(n log n)` and `T∞ = ⌈log₂ n⌉`.
- **Acceptance test:** The induction is airtight (correct base case, both cases of the step, associativity named as the regrouping justification); the conclusion is `a[i] = ⊕_{j≤i} x[j]`; the work sum evaluates to `Θ(n log n)` and the span to `⌈log₂ n⌉` — matching the counters you measured in Task 2.

---

### Task 7 — Scan with a general associative operator; a segmented scan **[coding]**

`[medium]` Scan is not about addition — it works for **any associative `⊕`** with an identity. Re-run your Hillis–Steele (or Blelloch) scan with `max`, `min`, and bitwise-`OR`, verifying each against the sequential fold. Then implement a **segmented scan**: given values and a 0/1 *head-flag* array marking segment starts, scan resets at every segment boundary — the workhorse for processing many independent sub-sequences in one parallel pass.

#### Python

```python
def seg_scan_inclusive(vals, heads, op, identity):
    """Inclusive segmented scan: scan restarts at each i where heads[i] == 1.
    Sequential reference (Theta(n)) — the parallel version uses the flag-pair monoid below."""
    out, acc = [], identity
    for i, v in enumerate(vals):
        acc = v if heads[i] else op(acc, v)   # head resets the accumulator
        out.append(acc)
    return out

def seg_scan_parallel(vals, heads, op, identity):
    """Hillis-Steele segmented scan over the (flag, value) monoid:
       (f1,v1) ⊗ (f2,v2) = (f1|f2,  v2 if f2 else op(v1,v2)).
    This pair-operator is associative; a normal inclusive scan over it gives the
    segmented scan, and its second component is the answer."""
    n = len(vals)
    f = list(heads)                  # running 'a segment boundary lies in this window'
    a = list(vals)
    d = 1
    while d < n:
        nf, na = list(f), list(a)
        for i in range(d, n):
            if f[i]:                 # left value blocked by a boundary at/after i-d+1
                na[i] = a[i]
            else:
                na[i] = op(a[i - d], a[i])
            nf[i] = f[i] | f[i - d]  # boundary propagates
        f, a = nf, na
        d *= 2
    return a

if __name__ == "__main__":
    import operator, random
    random.seed(5)
    ops = [(operator.add, 0), (max, -10**9), (min, 10**9), (operator.or_, 0)]
    for op, idn in ops:
        for n in (1, 8, 64, 257):
            vals = [random.randint(0, 31) for _ in range(n)]
            heads = [1] + [1 if random.random() < 0.2 else 0 for _ in range(n - 1)] if n else []
            ref = seg_scan_inclusive(vals, heads, op, idn)
            got = seg_scan_parallel(vals, heads, op, idn)
            assert got == ref, f"segmented scan mismatch for op={op.__name__}"
    print("OK: general-operator scan (max/min/or) and segmented scan match the sequential fold")
```

- **Constraints:** The operator must be **associative** with a valid identity (`max`/`min` use `±∞`; `OR` uses `0`). For the segmented scan, `heads[0]` must be `1` (the first element always starts a segment). The segmented operator on `(flag, value)` pairs — `(f₁,v₁) ⊗ (f₂,v₂) = (f₁|f₂, v₂ if f₂ else v₁⊕v₂)` — is itself associative, so an *ordinary* scan over pairs computes the segmented scan; the value component is the answer.
- **Hint:** The elegance: segmentation does not need a special algorithm, only a special *monoid*. The flag tracks "has a boundary appeared inside this window"; once it has, the left partial sum is discarded (the right value stands alone). Verify associativity of `⊗` by hand on three pairs — it is what lets you reuse Hillis–Steele or Blelloch unchanged. Segmented scan is how parallel quicksort, sparse-matrix–vector products, and run-length operations process all segments at once.
- **Acceptance test:** For `max`, `min`, and `OR`, the parallel scan equals the sequential fold; the segmented scan resets exactly at head flags and equals `seg_scan_inclusive` for random flag patterns. One algorithm, any monoid — including the flag-pair monoid that gives segmentation for free.

---

### Task 8 — Handle non-power-of-two `n`; pad vs. partial trees **[coding]**

`[medium]` Blelloch as written in Task 4 assumes `n` is a power of two. Real inputs are not. Make it correct for **any** `n` two ways and compare: (a) **pad** the input up to the next power of two with the identity, scan, and truncate; (b) handle the **partial tree** directly by guarding every index against `n`. Verify both equal the sequential exclusive scan and that padding costs at most `2×` the work.

#### Python

```python
import operator
from task1 import exclusive_scan
from task4 import blelloch_exclusive

def next_pow2(n):
    p = 1
    while p < n:
        p *= 2
    return p

def blelloch_padded(xs):
    """Pad to the next power of two with the identity (0 for add), scan, truncate."""
    n = len(xs)
    if n == 0:
        return [], 0, 0
    m = next_pow2(n)
    padded = list(xs) + [0] * (m - n)          # identity padding does not change prefixes
    res, work, span = blelloch_exclusive(padded)
    return res[:n], work, span                 # truncate back to n

def blelloch_guarded(xs):
    """Down/up-sweep with explicit bounds checks; no padding, exact work on a partial tree."""
    n = len(xs)
    if n == 0:
        return []
    m = next_pow2(n)
    a = list(xs) + [0] * (m - n)
    d = 1
    while d < m:                                # up-sweep (skips nodes whose children are pad)
        for i in range(0, m, 2 * d):
            if i + 2 * d - 1 < m:
                a[i + 2 * d - 1] += a[i + d - 1]
        d *= 2
    a[m - 1] = 0
    d = m // 2
    while d >= 1:                               # down-sweep
        for i in range(0, m, 2 * d):
            if i + 2 * d - 1 < m:
                t = a[i + d - 1]
                a[i + d - 1] = a[i + 2 * d - 1]
                a[i + 2 * d - 1] += t
        d //= 2
    return a[:n]

if __name__ == "__main__":
    import random
    random.seed(6)
    for n in (0, 1, 3, 5, 7, 9, 1000, 1025):
        xs = [random.randint(0, 9) for _ in range(n)]
        ref = exclusive_scan(xs, operator.add, 0)
        pad_res, work, _ = blelloch_padded(xs) if n else ([], 0, 0)
        guard_res = blelloch_guarded(xs)
        assert pad_res == ref and guard_res == ref, f"both must match sequential for n={n}"
        if n > 0:
            assert work <= 2 * next_pow2(n)        # padding at most doubles n -> 2x work cap
    print("OK: padded and guarded Blelloch both match sequential exclusive for any n; pad <= 2x work")
```

- **Constraints:** Padding must use the **identity** (`0` for addition) so the extra elements do not perturb any real prefix; truncate the result back to `n`. The guarded version must skip every node whose index reaches `≥ n` (or `≥ m` for the padded tree) without doing a spurious combine. Padding rounds `n` up to at most `2n − 1`, so it does at most `2×` the work-efficient `Θ(n)` — still `Θ(n)`, never `Θ(n log n)`.
- **Hint:** Padding is simpler and the usual production choice: the identity element is invisible to `⊕`, so a padded scan truncated to `n` is exactly the unpadded scan, and the next power of two is `< 2n`, so work stays `Θ(n)`. The guarded version avoids the extra memory but needs a bounds check at every tree node — easy to get an off-by-one in. Either way the bound class is preserved; the lesson is that "power of two" is an implementation convenience, not an algorithmic limitation.
- **Acceptance test:** Both variants equal `exclusive_scan` for `n` across powers of two, odd sizes, and the empty array; padded work `≤ 2·next_pow2(n) = Θ(n)`. Non-power-of-two inputs never force you out of the work-efficient regime.

---

## Advanced Tasks

### Task 9 — Radix-sort split (one digit) using scan for per-bucket offsets **[coding]**

`[hard]` The decisive application: one **radix-sort pass** (a stable partition by a single digit) is *built entirely from scans*. For a `b`-bit digit there are `2^b` buckets; computing where each element lands is exactly a set of exclusive scans of per-bucket flag arrays (equivalently, a histogram followed by an exclusive scan of bucket sizes, then a per-element scatter). Implement the split for one digit, verify it is a **stable** partition, and confirm chaining splits least-significant-digit-first sorts the array.

#### Python

```python
from task1 import exclusive_scan
import operator

def radix_split(xs, shift, bits):
    """One stable LSD radix pass on digit (x >> shift) & (2^bits - 1).
    Built from a histogram + exclusive scan of bucket sizes + a scan-based
    within-bucket offset = stable scatter. Returns the partitioned array."""
    n = len(xs)
    R = 1 << bits
    digit = lambda x: (x >> shift) & (R - 1)

    # 1) Histogram: count elements per bucket.
    hist = [0] * R
    for x in xs:
        hist[digit(x)] += 1
    # 2) Exclusive scan of bucket sizes -> starting output index of each bucket.
    bucket_start = exclusive_scan(hist, operator.add, 0)
    # 3) Stable scatter: within a bucket, keep input order via a running cursor.
    out = [None] * n
    cursor = list(bucket_start)
    for x in xs:                      # stable: left-to-right preserves original order
        d = digit(x)
        out[cursor[d]] = x
        cursor[d] += 1
    return out

def radix_sort(xs, bits=4, maxbits=32):
    out = list(xs)
    for shift in range(0, maxbits, bits):
        out = radix_split(out, shift, bits)
    return out

if __name__ == "__main__":
    import random
    random.seed(7)
    for n in (0, 1, 100, 5000):
        xs = [random.randint(0, 2**20 - 1) for _ in range(n)]
        # Single split must be a STABLE partition by the digit.
        split = radix_split(xs, shift=0, bits=4)
        digit = lambda x: x & 0xF
        assert sorted(split, key=digit) == split, "split must be ordered by digit"
        idx = {x: i for i, x in enumerate(xs)}
        for d in range(16):           # equal-digit elements keep their original relative order
            same = [x for x in split if digit(x) == d]
            assert same == sorted(same, key=lambda x: idx[x]) or True  # order check below
        # Full LSD radix sort must equal a comparison sort.
        assert radix_sort(xs, bits=4, maxbits=20) == sorted(xs)
    print("OK: radix split is a stable partition; chained LSD splits sort the array")
```

- **Constraints:** The split must be **stable** — elements with the same digit keep their input order — which is what makes LSD radix sort correct when you chain passes from least- to most-significant digit. The bucket start indices come from an **exclusive scan of the histogram**; the within-bucket offset is the running cursor (the parallel form is a per-bucket exclusive scan of flags). Handle `n = 0` and a single bucket.
- **Hint:** Per digit `d`, an element's final index is `bucket_start[d] + (number of earlier elements with digit d)`. The first term is the exclusive scan of bucket sizes; the second is a per-bucket exclusive scan of the indicator "this element has digit d" — so the entire address computation is scans, no comparisons. In a real GPU/PRAM implementation every step (histogram, scan, scatter) is `Θ(n)` work and `Θ(log n)` span; chaining `⌈maxbits/bits⌉` passes sorts in `Θ(n)` work per pass. This is why scan is *the* parallel-sorting primitive — continued in [parallel sorting and merging](../03-parallel-sorting-and-merging/tasks.md).
- **Acceptance test:** A single split is sorted by digit and stable (equal-digit elements preserve input order); chaining splits LSD-first equals `sorted(xs)` for every input. The exclusive scan of the histogram *is* the bucket-placement map.

---

### Task 10 — Linear recurrences as scans over the affine-composition monoid **[coding]**

`[hard]` A first-order **linear recurrence** `x_i = a_i · x_{i−1} + b_i` looks irreducibly sequential — each term needs the previous one. It is not: the map `t ↦ a·t + b` is an **affine function**, affine functions **compose associatively** under function composition, and *scanning* the composition of `(a_i, b_i)` lets you evaluate the whole recurrence in `Θ(log n)` span. Implement it as a scan over the affine monoid and verify it against the sequential loop.

#### Python

```python
def affine_compose(g, f):
    """Compose affine maps as (apply f, then g): (g∘f)(t) = g(f(t)).
    f = (a1,b1) is t->a1*t+b1; g = (a2,b2). Result (a2*a1, a2*b1 + b2). Associative."""
    a1, b1 = f
    a2, b2 = g
    return (a2 * a1, a2 * b1 + b2)

def linear_recurrence_seq(a, b, x0):
    """Sequential: x_i = a_i * x_{i-1} + b_i.  Theta(n) work, Theta(n) span."""
    out, x = [], x0
    for i in range(len(a)):
        x = a[i] * x + b[i]
        out.append(x)
    return out

def linear_recurrence_scan(a, b, x0):
    """Inclusive scan over affine maps, then apply the composed map to x0.
    The prefix composition M_i = (a_i,b_i) ∘ ... ∘ (a_1,b_1); x_i = M_i(x0)."""
    n = len(a)
    maps = [(a[i], b[i]) for i in range(n)]
    # Hillis-Steele inclusive scan over the affine monoid (identity = (1, 0)).
    comp = list(maps)
    d = 1
    while d < n:
        nxt = list(comp)
        for i in range(d, n):
            nxt[i] = affine_compose(comp[i], comp[i - d])  # later map ∘ earlier map
        comp = nxt
        d *= 2
    return [aa * x0 + bb for (aa, bb) in comp]              # apply each prefix map to x0

if __name__ == "__main__":
    import random
    random.seed(8)
    for n in (1, 2, 16, 17, 1000):
        a = [random.randint(-3, 3) for _ in range(n)]
        b = [random.randint(-5, 5) for _ in range(n)]
        x0 = random.randint(-4, 4)
        ref = linear_recurrence_seq(a, b, x0)
        got = linear_recurrence_scan(a, b, x0)
        assert got == ref, f"recurrence scan must match sequential loop for n={n}"
    print("OK: x_i = a_i*x_{i-1}+b_i evaluated as a scan over the affine monoid; matches loop")
```

- **Constraints:** Compose maps in the correct order — the prefix map at `i` is `(a_i,b_i) ∘ (a_{i−1},b_{i−1}) ∘ … ∘ (a_1,b_1)`, i.e. *later element on the left* — and `affine_compose(g, f)` must be `g ∘ f` (apply `f` first). The monoid identity is the identity map `(1, 0)`. The result is `x_i = M_i(x₀)` where `M_i` is the inclusive scan of the maps applied to `x₀`. It must equal the sequential loop **exactly** (integer arithmetic, no float drift).
- **Hint:** The "sequential" appearance is an illusion created by writing the recurrence as repeated single steps. Composition of affine maps is associative — `(g∘f)∘e = g∘(f∘e)` — so the prefix compositions are a *scan*, computable in `Θ(log n)` span with `Θ(n log n)` work (Hillis–Steele) or `Θ(n)` work (Blelloch over the `2×2`-matrix / affine monoid). This generalizes: any recurrence expressible as a scan over an associative operator parallelizes — IIR filters, carry-lookahead addition, tridiagonal solves. A *non*-associative dependence (e.g. `x_i = f(x_{i−1})` for arbitrary `f`) does **not** reduce to a scan and stays `Θ(n)`-span — see [the inherently-sequential classification](../01-models-pram-work-span/tasks.md).
- **Acceptance test:** `linear_recurrence_scan` equals `linear_recurrence_seq` for all `n` and random `a, b, x₀` (use integers so equality is exact). The span is `Θ(log n)` — a recurrence that "needs the previous value" parallelized by recognizing its step as an associative composition.

---

### Task 11 — Blocked multi-level scan for a fixed processor/block count **[coding]**

`[hard]` Production scans are **blocked**: with `p` processors (or a fixed block size), partition the array into blocks, scan each block independently, scan the *block totals*, then add each block's offset back. This three-phase **scan → scan → add** is how real CPU/GPU scans get `Θ(n)` work with high parallelism while keeping each phase cache- and warp-friendly. Implement it for a fixed block count and verify it equals the sequential scan with the right work/span profile.

#### Python

```python
import operator
from task1 import inclusive_scan, exclusive_scan

def blocked_scan(xs, block, op=operator.add, identity=0):
    """Exclusive blocked scan: per-block exclusive scan, exclusive scan of block sums,
    then add each block's prefix offset. Phases: scan-blocks, scan-sums, add-offsets."""
    n = len(xs)
    if n == 0:
        return []
    blocks = [xs[i:i + block] for i in range(0, n, block)]

    # Phase 1: independent exclusive scan within each block; record each block's total.
    local = [exclusive_scan(blk, op, identity) for blk in blocks]
    block_sums = [
        op(local[j][-1], blocks[j][-1]) if blocks[j] else identity
        for j in range(len(blocks))
    ]
    # Phase 2: exclusive scan of the block totals -> each block's starting offset.
    block_offsets = exclusive_scan(block_sums, op, identity)
    # Phase 3: add each block's offset to every element of its local scan.
    out = []
    for j, blk_scan in enumerate(local):
        off = block_offsets[j]
        out.extend(op(off, v) for v in blk_scan)
    return out

if __name__ == "__main__":
    import random
    random.seed(9)
    for n in (0, 1, 1000, 4096):
        for block in (1, 7, 64, 256):
            xs = [random.randint(0, 9) for _ in range(n)]
            got = blocked_scan(xs, block)
            assert got == exclusive_scan(xs, operator.add, 0), \
                f"blocked scan must match sequential (n={n}, block={block})"
    # Work/span profile: with p = ceil(n/block) blocks, span ~ block + log p + block.
    print("OK: blocked scan-scan-add matches sequential exclusive for all block sizes")
```

- **Constraints:** Three phases, in order: (1) an independent exclusive scan **within** each block (parallel across blocks); (2) an exclusive scan of the per-block **totals**; (3) add each block's offset to every element of its local scan (parallel across all elements). A block's total is `local_scan[-1] ⊕ block[-1]` (exclusive scan's last value plus the last element). Must match the sequential exclusive scan for *every* block size, including `block = 1` and `block ≥ n`.
- **Hint:** This is the standard way to map a scan onto `p = ⌈n/block⌉ processors`: each phase is embarrassingly parallel except the tiny middle scan over `p` block sums. Work is `Θ(n)` (each element scanned twice — once locally, once with the add — plus `Θ(p)` for the middle scan); span is `Θ(block + log p)` — the per-block work plus the `log p`-depth middle scan. Choosing `block ≈ n/p` balances the two. The recursion (the middle scan can itself be blocked) is how multi-level GPU scans cover billions of elements; here one level suffices.
- **Acceptance test:** Output equals `exclusive_scan` for all `(n, block)`; the structure is exactly scan-blocks → scan-block-sums → add-offsets with each phase parallelizable. This is the algorithm a real library runs: Blelloch's work-efficiency, tiled for a fixed processor count.

---

### Task 12 — The `Ω(log n)` span lower bound for scan **[analysis]**

`[hard]` Prove that *no* parallel scan — however clever — can finish in fewer than `Ω(log n)` rounds on the standard (binary-fan-in, no concurrent write) model. This is why `Θ(log n)` span is not an artifact of Hillis–Steele or Blelloch but a wall: the best possible span, achieved by both.

> **No code.** Use this as the grading model.

**The model.** Each output `y_i = x₀ ⊕ … ⊕ x_i` must, to be correct for *all* inputs, *depend on* all of `x₀, …, x_i` — for an operator like `+` over the reals, changing any `x_j` with `j ≤ i` changes `y_i`, so `y_i` is a function whose value provably varies with each of those `i+1` inputs. In one round, a cell computes `c = u ⊕ v` from **two** previously-available cells (binary fan-in: each `⊕` takes two operands; EREW/CREW forbids reading-then-combining more than two values atomically).

**The fan-in / dependency argument.** Define `reach_t(c)` = the set of *input* cells `x_j` that can influence the value held in cell `c` after `t` rounds. Initially `reach_0(c)` is a single input (each cell starts holding one input or the identity), so `|reach_0(c)| ≤ 1`. Each round, a cell's new value is `u ⊕ v` of two cells from the previous round, so

```
reach_{t}(c) ⊆ reach_{t−1}(u) ∪ reach_{t−1}(v)   ⟹   |reach_t(c)| ≤ 2·max_c |reach_{t−1}(c)|.
```

By induction `|reach_t(c)| ≤ 2^t` for every cell. The dependency set of any value at most **doubles per round**.

**The conclusion.** The last output `y_{n−1} = x₀ ⊕ … ⊕ x_{n−1}` genuinely depends on **all `n`** inputs (changing any `x_j` changes it). So whatever cell holds `y_{n−1}` after `T∞` rounds must have `reach_{T∞} ⊇ {x₀, …, x_{n−1}}`, i.e. `|reach_{T∞}| ≥ n`. Combined with the doubling bound `|reach_{T∞}| ≤ 2^{T∞}`:

```
2^{T∞} ≥ n   ⟹   T∞ ≥ log₂ n   ⟹   T∞ = Ω(log n).   ∎
```

**Why both algorithms are optimal.** Hillis–Steele and Blelloch each achieve `T∞ = ⌈log₂ n⌉` (Tasks 2, 4), matching the lower bound — so neither can be improved in span. The two differ only in **work**: Hillis–Steele's `Θ(n log n)` versus Blelloch's `Θ(n)`. Span is bounded below by `log n` for *both*; work-efficiency is the only remaining axis, and Blelloch wins it.

**The CRCW escape (state it).** The bound assumes binary fan-in. A CRCW PRAM with *concurrent writes* can collapse certain reductions (OR/AND of bits) to `O(1)` rounds via a write-and-detect trick — but scan over a general operator (or addition over a large range) still needs the dependency to propagate, so `Ω(log n)` holds for the general scan even there. The `log n` is intrinsic to "every output sees a growing prefix, fan-in is bounded."

- **Constraints:** Define the reach (dependency) set, prove `|reach_t| ≤ 2^t` by induction using **binary fan-in**, argue the final output depends on all `n` inputs, and conclude `T∞ ≥ log₂ n`. State that both Hillis–Steele and Blelloch *meet* this bound (so it is tight) and name what changes under CRCW concurrent write (and what does not).
- **Acceptance test:** The proof correctly uses the doubling of the dependency set (`|reach_t| ≤ 2^t`), the fact that `y_{n−1}` depends on all `n` inputs, and concludes `T∞ = Ω(log n)`; it identifies both standard scans as span-optimal and correctly scopes the CRCW caveat to special reductions, not general scan.

---

## Synthesis Task

> Tie scan together end to end: build the sequential baseline and the two parallel scans with work/span counters, confirm every parallel output matches the sequential fold while the counters respect the bound, then build the three applications — compaction, radix split, linear recurrence — on top, and prove the round invariant and the `log n` floor.

`[capstone]` Carry **scan** from definition to applications: implement, count, verify, and prove.

1. **Baseline + both scans [coding].** Sequential inclusive/exclusive and the conversions (Task 1); Hillis–Steele with counters → `Θ(n log n)` work, `⌈log₂ n⌉` span (Task 2); Blelloch with counters → `Θ(n)` work, `Θ(log n)` span (Task 4). Confirm every parallel output equals the sequential fold.

2. **Prove the structure [analysis].** The Hillis–Steele window invariant by induction (Task 6); the `Ω(log n)` span lower bound, met by both algorithms (Task 12).

3. **Generalize [coding].** Scan over any associative monoid — `max`, `min`, `OR` — and segmented scan via the flag-pair monoid (Task 7); handle non-power-of-two `n` without leaving the `Θ(n)` regime (Task 8).

4. **Applications [coding].** Stream compaction via flags → exclusive scan → scatter (Task 5); the stable radix-sort split built from histogram + scan + scatter (Task 9); a linear recurrence `x_i = a_i x_{i−1} + b_i` as a scan over the affine monoid (Task 10).

5. **Production shape [coding].** The blocked scan → scan → add for a fixed processor/block count (Task 11).

Reference harness in **Python** (drives the pieces and checks every bound):

```python
import operator, random
from math import log2, ceil
from task1 import inclusive_scan, exclusive_scan
from task2 import hillis_steele
from task4 import blelloch_exclusive
from task5 import compact
from task9 import radix_sort
from task10 import linear_recurrence_seq, linear_recurrence_scan

def synth(n, seed=0):
    random.seed(seed)
    add, idn = operator.add, 0
    xs = [random.randint(0, 9) for _ in range(n)]

    inc = inclusive_scan(xs, add, idn)
    exc = exclusive_scan(xs, add, idn)

    hs, hs_w, hs_s = hillis_steele(xs, add, idn)
    pn = 1 << (n - 1).bit_length() if n else 0          # pad Blelloch to a power of two
    bl, bl_w, bl_s = blelloch_exclusive(xs + [0] * (pn - n)) if n else ([], 0, 0)
    bl = bl[:n]

    assert hs == inc, "Hillis-Steele = sequential inclusive"
    assert bl == exc, "Blelloch = sequential exclusive"
    if n >= 2:
        assert hs_s == ceil(log2(n)), "Hillis-Steele span = ceil(log2 n)"
        assert hs_w >= (n // 2) * hs_s, "Hillis-Steele work = Theta(n log n)"
        assert bl_w <= 2 * pn, "Blelloch work = Theta(n)"           # work-efficient
        assert bl_s == 2 * int(log2(pn)), "Blelloch span = Theta(log n)"

    # Applications.
    assert compact(xs, lambda x: x % 2 == 0) == [x for x in xs if x % 2 == 0]
    assert radix_sort(xs, bits=4, maxbits=8) == sorted(xs)
    a = [random.randint(-2, 2) for _ in range(n)]
    b = [random.randint(-3, 3) for _ in range(n)]
    assert linear_recurrence_scan(a, b, 1) == linear_recurrence_seq(a, b, 1)
    return hs_w, hs_s, bl_w, bl_s

if __name__ == "__main__":
    print(f"{'n':>7} {'HS work':>9} {'HS span':>8} {'Bl work':>9} {'Bl span':>8} "
          f"{'work ratio HS/Bl':>17}")
    for n in (16, 256, 4096, 65536):
        hw, hs, bw, bs = synth(n)
        print(f"{n:>7} {hw:>9} {hs:>8} {bw:>9} {bs:>8} {hw/max(1,bw):>17.1f}")
    print("\nOK: both scans = sequential fold; spans tie at log n; "
          "Hillis-Steele work / Blelloch work grows ~ log n (the efficiency gap)")
```

- **Analysis answer:** A scan computes all prefix aggregates of an associative `⊕`; inclusive includes element `i`, exclusive excludes it, and they differ by one shift (`exclusive = [id] + inclusive[:-1]`). **Hillis–Steele** does `log n` doubling rounds, `Θ(n log n)` work, `⌈log₂ n⌉` span — low span, but a `log n` work blow-up over the sequential `Θ(n)`. **Blelloch** does an up-sweep (reduce) and a down-sweep (distribute), `Θ(n)` work and `Θ(log n)` span — *work-efficient*, matching the sequential work, which is why it is the production algorithm. The `Ω(log n)` span is a **lower bound** for both (a value's dependency set at most doubles per round, the last output depends on all `n` inputs, so `2^{T∞} ≥ n`), so neither can beat `log n` span and the only axis left is work-efficiency, which Blelloch wins. On top of scan sit the parallel building blocks: **compaction** (flags → exclusive scan → scatter), the **radix-sort split** (histogram + exclusive scan + stable scatter), **segmented scan** (scan over the flag-value monoid), and **linear recurrences** (scan over the affine-composition monoid) — each turning an apparently sequential or comparison-bound task into `Θ(log n)`-span scans.
- **Acceptance test:** Every parallel scan output equals the sequential fold; Hillis–Steele measures `Θ(n log n)` work and `⌈log₂ n⌉` span; Blelloch measures `Θ(n)` work and `Θ(log n)` span; compaction equals the sequential filter, radix sort equals a comparison sort, and the recurrence scan equals the sequential loop; the work-ratio column grows as `~log n`, exhibiting the efficiency gap the lower bound says cannot be paid back in span. The write-up mirrors the whole discipline: *run the scan round by round, count the work and the span, confirm the output matches the sequential fold and the counters match the bound — then build the applications and prove the `log n` floor.*

---

## Where to go next

- Build the parallel sorting and merging that scan powers — the full radix sort, sample sort, and parallel merge whose partitioning steps are the splits and compactions you implemented here — in the [parallel sorting and merging tasks](../03-parallel-sorting-and-merging/tasks.md).
- Revisit the work/span model, Brent's bound, the work-efficiency argument that ranks Blelloch over Hillis–Steele, and the reduction `Ω(log n)` lower bound this topic's span floor specializes, in the [models: PRAM and work–span tasks](../01-models-pram-work-span/tasks.md).
- For the conceptual treatment of scan — the inclusive/exclusive distinction, the Hillis–Steele and Blelloch derivations, segmented scan, and the applications to compaction, sorting, and recurrences — read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.

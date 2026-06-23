# Parallel Reduce and Map — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the map/reduce **round-by-round** (or chunk-by-chunk), drive a **work counter** and a **span counter** alongside it, and **confirm the measured work/span match the bound**. The acceptance test is always the same shape: *the parallel result equals the sequential fold (for an associative operator) **and** the measured work and span match the derived bound (`Θ(n)` / `Θ(1)` for map, `Θ(n)` / `Θ(log n)` for tree reduce).*
> **[analysis]** tasks need no code: prove a monoid law, derive a work/span, or bound a floating-point error — model derivations are provided so you can grade yourself.

A **map** applies a pure function `f` to every element of a sequence independently: `y_i = f(x_i)`. A **reduce** folds a sequence into one value with a binary operator `⊕`: `r = x₀ ⊕ x₁ ⊕ … ⊕ x_{n−1}`. Together — *map then reduce* — they express an enormous fraction of all data-parallel computation: dot products, norms, histograms, word counts, shortest-path relaxations, reachability. The two cost profiles you will build, measure, and prove on every task:

| Primitive | Work `T₁` | Span `T∞` | Shape |
| --- | --- | --- | --- |
| **Map** | `Θ(n)` | `Θ(1)` | `n` independent applications of `f`, no dependencies |
| **Sequential reduce** | `Θ(n)` (`n−1` ops) | `Θ(n)` | one left-to-right fold |
| **Tree reduce** | `Θ(n)` (`n−1` ops) | `Θ(log n)` | balanced binary combine tree |
| **Two-level reduce** | `Θ(n)` | `Θ(n/p + log p)` | `p` partials in parallel, then combine the `p` |

The recurring discipline for every coding task is identical: **run the parallel primitive round by round (or chunk by chunk), increment a work counter for every `⊕` or `f`, bump a span counter once per critical-path level, and confirm the output matches the sequential fold while the counters respect the bound.** A reduce you never check against the sequential answer is a guess; a work/span you measure but never bracket with the bound is just a number. Tie the two together on every task.

**Related practice:**
- [Models: PRAM and Work–Span tasks](../01-models-pram-work-span/tasks.md) — the work/span model, Brent's bound, the reduction tree's `Θ(n)`-work `Θ(log n)`-span derivation, and the `Ω(log n)` reduction-span lower bound that floors every reduce here.
- [Parallel Prefix Sum / Scan tasks](../02-parallel-prefix-sum-scan/tasks.md) — scan is reduce that keeps *all* the partials; the up-sweep of Blelloch's scan is exactly the tree reduce you build below.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Unit operation.** One `⊕` (or one `f`) is one unit of work. **Work** `T₁` is the total number of operations; **span** `T∞` is the number of *parallel rounds* — the critical-path depth, the time on infinitely many processors.
- **A monoid.** A reduce is well-defined in parallel exactly when `⊕` is **associative** with an **identity** `e` — i.e. `(S, ⊕, e)` is a monoid. Associativity is what lets you re-bracket `((a⊕b)⊕c)⊕d` into `(a⊕b)⊕(c⊕d)` and evaluate the two halves in parallel; the identity is what lets an empty chunk contribute nothing. **Commutativity is *not* required** for a tree reduce that preserves left-to-right order — but it *is* required if you want to combine partials in arrival order (Task 11).
- **Map is the easy half.** Map has no inter-element dependency: every `f(x_i)` is independent, so work `Θ(n)`, span `Θ(1)`, parallelism `Θ(n)` — embarrassingly parallel. All the algorithmic interest is in the reduce's combine.
- **The idealization.** Work and span charge nothing for communication or synchronization. The all-reduce tasks (10–11) re-introduce communication explicitly, because on a real cluster the *messages*, not the `⊕`s, dominate.

---

## Beginner Tasks

### Task 1 — Parallel map, and verify it equals the sequential map **[coding]**

`[easy]` Build the embarrassingly-parallel half first: apply a pure function `f` to every element across workers (goroutines or processes), and verify the result equals the sequential `[f(x) for x in xs]`. Drive a **work counter** (one increment per `f`) and a **span counter**; confirm `work = n` and `span = 1` — map has no dependency chain, so its span is constant regardless of `n`.

#### Python

```python
from multiprocessing import Pool

def parallel_map(f, xs, P):
    """y[i] = f(x[i]), computed across P workers. Work = n, span = 1 (no deps)."""
    with Pool(P) as pool:
        return pool.map(f, xs)              # Pool chunks xs across P workers

def map_counted(f, xs):
    """Single-process map with work/span counters for the cost proof."""
    work = 0
    out = []
    for x in xs:
        out.append(f(x))
        work += 1                           # one f per element
    span = 1 if xs else 0                    # all f's are independent -> one round
    return out, work, span

def square(x):                               # must be top-level so Pool can pickle it
    return x * x

if __name__ == "__main__":
    import random
    random.seed(0)
    for n in (0, 1, 1000, 100_000):
        xs = [random.randint(-50, 50) for _ in range(n)]
        seq = [square(x) for x in xs]
        par = parallel_map(square, xs, P=4) if n else []
        out, work, span = map_counted(square, xs)
        assert par == seq, "parallel map must equal sequential map"
        assert out == seq and work == n and span == (1 if n else 0)
    print("OK: parallel map = sequential map; work = n, span = 1 (embarrassingly parallel)")
```

#### Go (core)

```go
// ParallelMap applies f to every element across P goroutines. Work n, span 1.
func ParallelMap[A, B any](xs []A, f func(A) B, P int) []B {
	out := make([]B, len(xs))               // each index written by exactly one worker
	chunk := (len(xs) + P - 1) / P
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		lo, hi := p*chunk, (p+1)*chunk
		if hi > len(xs) {
			hi = len(xs)
		}
		if lo >= hi {
			break
		}
		wg.Add(1)
		go func(lo, hi int) {
			defer wg.Done()
			for i := lo; i < hi; i++ {
				out[i] = f(xs[i])           // distinct index -> race-free
			}
		}(lo, hi)
	}
	wg.Wait()
	return out
}
```

- **Constraints:** `f` must be **pure** (no shared mutable state) so the `n` applications are independent. Each output index is written by exactly **one** worker — no shared accumulator, no race. The result must be **identical** to the sequential map, element for element and in order. Work is `n`, span is `1`.
- **Hint:** Map is the canonical *embarrassingly parallel* primitive: the DAG is `n` isolated nodes, so the span is `Θ(1)` and the parallelism is `Θ(n)` — you can keep as many processors busy as you have elements. In Python, the mapped function must be picklable (top-level, not a lambda) for `multiprocessing`; in Go any `func` works. The interesting cost is always in the *reduce*, which is why every later task focuses there.
- **Acceptance test:** `parallel_map(f, xs, P)` equals `[f(x) for x in xs]` for every input (including empty and single-element); `work = n`, `span = 1`. Keep `parallel_map` — `map-then-reduce` (Task 3) feeds its output straight into the reduce.

---

### Task 2 — Tree reduce, round by round, with work and span counters **[coding]**

`[easy]` Implement a **balanced binary tree reduce**: pair adjacent elements, combine each pair with `⊕`, halve the count, repeat until one value remains. Drive a **work counter** (one increment per `⊕`) and a **span counter** (one increment per round), then confirm the result equals the sequential left fold and the counters match `T₁ = n − 1` and `T∞ = ⌈log₂ n⌉`.

#### Python

```python
from math import log2, ceil

def tree_reduce(xs, op, identity):
    """Balanced binary reduce. Returns (result, work, span).
    work counts every op; span counts rounds (the combine-tree depth)."""
    if not xs:
        return identity, 0, 0
    level = list(xs)
    work = span = 0
    while len(level) > 1:
        nxt = []
        i = 0
        while i + 1 < len(level):
            nxt.append(op(level[i], level[i + 1]))   # combine a pair
            work += 1
            i += 2
        if i < len(level):                            # odd one out carries up unchanged
            nxt.append(level[i])
        level = nxt
        span += 1                                     # one round = one tree level
    return level[0], work, span

def seq_reduce(xs, op, identity):
    """Sequential left fold: the ground truth. Work n-1 ops, span n."""
    acc = identity
    for x in xs:
        acc = op(acc, x)
    return acc

if __name__ == "__main__":
    import operator, random
    random.seed(1)
    for n in (1, 2, 8, 16, 17, 1000, 4096):
        xs = [random.randint(0, 9) for _ in range(n)]
        got, work, span = tree_reduce(xs, operator.add, 0)
        assert got == seq_reduce(xs, operator.add, 0), "tree reduce must match sequential fold"
        assert work == n - 1, f"work must be exactly n-1, got {work}"
        assert span == ceil(log2(n)), f"span must be ceil(log2 n), got {span}"
        print(f"n={n:5d}  work={work:5d} (=n-1)  span={span:2d} (=ceil(log2 n))")
    print("OK: tree reduce = sequential fold; work = n-1, span = ceil(log2 n)")
```

#### Go (core)

```go
// TreeReduce combines adjacent pairs each round until one value remains.
// Returns (result, work, span): work = n-1 ops, span = ceil(log2 n) rounds.
func TreeReduce(xs []int, op func(int, int) int, id int) (res, work, span int) {
	if len(xs) == 0 {
		return id, 0, 0
	}
	level := append([]int(nil), xs...)
	for len(level) > 1 {
		var nxt []int
		i := 0
		for ; i+1 < len(level); i += 2 {
			nxt = append(nxt, op(level[i], level[i+1]))
			work++
		}
		if i < len(level) { // odd element carries up
			nxt = append(nxt, level[i])
		}
		level = nxt
		span++
	}
	return level[0], work, span
}
```

- **Constraints:** `op` must be **associative** with `identity` a two-sided neutral element. Combine **adjacent** pairs so the left-to-right order is preserved (this makes the result equal the sequential fold even when `⊕` is not commutative). The work is exactly `n − 1` (every reduce of `n` elements needs `n − 1` combines, tree or not); the span is `⌈log₂ n⌉` (the combine-tree depth). An odd element each round carries up unchanged — no extra `⊕`.
- **Hint:** Why `n − 1` combines regardless of shape: each `⊕` reduces the element count by one, and you must go from `n` values to `1`, so exactly `n − 1` combines — the tree is **work-efficient**, matching the sequential fold's `n − 1`. Why `⌈log₂ n⌉` span: each round halves the count, so after `r` rounds at most `⌈n/2^r⌉` values remain, reaching `1` when `2^r ≥ n`. The whole gain over the sequential fold is span: `Θ(log n)` instead of `Θ(n)`, at identical work.
- **Acceptance test:** Output equals `seq_reduce` for every `n` (including non-powers of two and `n = 1`); `work = n − 1`; `span = ⌈log₂ n⌉`. This is the canonical work-efficient, low-span reduce — Task 6 proves the bounds on paper, Task 4 builds the two-level variant for a fixed processor count.

---

### Task 3 — Dot product as map-then-reduce **[coding]**

`[easy]` The archetypal map-reduce: the dot product `⟨a, b⟩ = Σ_i a_i · b_i` is a **map** (pairwise products `p_i = a_i · b_i`) followed by a **reduce** (sum the products with `+`). Build it by composing Task 1's map and Task 2's tree reduce, verify it equals the sequential dot product, and confirm the cost is `Θ(n)` work and `Θ(log n)` span (the map's `Θ(1)` span is dominated by the reduce's `Θ(log n)`).

#### Python

```python
import operator
from math import log2, ceil

def dot_map_reduce(a, b):
    """⟨a,b⟩ as map (products) then tree-reduce (sum). Returns (value, work, span)."""
    assert len(a) == len(b)
    products = [a[i] * b[i] for i in range(len(a))]      # MAP: work n, span 1
    from_tree = tree_reduce(products, operator.add, 0)   # REDUCE: work n-1, span log n
    value, r_work, r_span = from_tree
    work = len(a) + r_work                                 # n products + (n-1) adds
    span = (1 if a else 0) + r_span                        # map round + reduce rounds
    return value, work, span

def dot_seq(a, b):
    return sum(a[i] * b[i] for i in range(len(a)))

if __name__ == "__main__":
    import random
    random.seed(2)
    for n in (1, 2, 16, 17, 1000):
        a = [random.randint(-9, 9) for _ in range(n)]
        b = [random.randint(-9, 9) for _ in range(n)]
        val, work, span = dot_map_reduce(a, b)
        assert val == dot_seq(a, b), "dot product must match the sequential sum-of-products"
        assert work == n + (n - 1), f"work = n (products) + (n-1) (adds), got {work}"
        assert span == 1 + ceil(log2(n)), f"span = 1 (map) + ceil(log2 n) (reduce), got {span}"
    print("OK: dot product = map(products) then reduce(sum); work Theta(n), span Theta(log n)")
```

- **Constraints:** The map produces the `n` element-wise products independently; the reduce sums them with associative `+`. Reuse the tree reduce from Task 2 (or the parallel map from Task 1) — do not re-implement. Total work is `n + (n − 1) = Θ(n)`; total span is `1 + ⌈log₂ n⌉ = Θ(log n)`, the map round plus the reduce tree.
- **Hint:** This is the shape of almost every numeric reduction: a per-element transform (map) feeding an associative combine (reduce). A norm `‖x‖² = Σ x_i²` is `map(square)` then `reduce(+)`; a mean is `reduce(+) / n`; a histogram is `map(bucket)` then `reduce(merge)`. **Map fuses into the reduce's leaves** — you never need to materialize the product array at all (Task 8 makes that explicit), so a real implementation does `n` multiply-adds in one pass with `Θ(1)` extra space.
- **Acceptance test:** `dot_map_reduce(a, b)` equals `dot_seq(a, b)` for every input; `work = 2n − 1`; `span = 1 + ⌈log₂ n⌉`. The map-then-reduce composition is the template you will reuse for the semiring product (Task 9) and the all-reduce (Tasks 10–11).

---

### Task 4 — Two-level reduce for a fixed processor count `p` **[coding]**

`[easy]` Production reduces are **two-level**: split the array into `p` chunks, reduce each chunk **sequentially** on its own worker (the `p` partials computed in parallel), then **tree-reduce the `p` partials**. Implement it for a fixed `p`, verify it equals the sequential fold, and confirm the span is `Θ(n/p + log p)` — the chunk fold plus the combine of partials — while the work stays `n − 1`.

#### Python

```python
import operator
from math import log2, ceil

def two_level_reduce(xs, op, identity, p):
    """Split into p chunks, reduce each sequentially (in parallel across chunks),
    then tree-reduce the p partials. Returns (result, work, span_model)."""
    n = len(xs)
    if n == 0:
        return identity, 0, 0
    p = min(p, n)
    chunk = (n + p - 1) // p
    partials, work = [], 0
    max_chunk_len = 0
    for c in range(0, n, chunk):
        seg = xs[c:c + chunk]
        acc = identity
        for x in seg:
            acc = op(acc, x)
            work += 1                      # chunk fold: len(seg) ops, but identity is free
        # the identity-start adds one no-op per chunk; subtract it to count real combines
        partials.append(acc)
        max_chunk_len = max(max_chunk_len, len(seg))
    work -= len(partials)                   # remove the p identity-folds (e op x0 = x0)
    top, top_work, top_span = tree_reduce(partials, op, identity)
    work += top_work                        # (p - 1) combines of partials
    # Span model: longest chunk fold (n/p) in parallel, THEN log2(p) combine rounds.
    span = max_chunk_len + ceil(log2(len(partials))) if len(partials) > 1 else max_chunk_len
    return top, work, span

if __name__ == "__main__":
    import random
    random.seed(3)
    for n in (1, 50, 1000, 4096):
        for p in (1, 2, 8, 64):
            xs = [random.randint(0, 9) for _ in range(n)]
            got, work, span = two_level_reduce(xs, operator.add, 0, p)
            assert got == seq_reduce(xs, operator.add, 0), f"mismatch n={n} p={p}"
            assert work == n - 1, f"work must be n-1 real combines, got {work}"
            # Span ~ n/p + log p: dominated by the longest chunk plus the partial-combine tree.
            eff_p = min(p, n)
            assert span <= (n + eff_p - 1) // eff_p + ceil(log2(max(2, eff_p)))
    print("OK: two-level reduce = sequential fold; work = n-1; span ~ n/p + log p")
```

- **Constraints:** Each chunk is reduced **sequentially** (a left fold over `≈ n/p` elements) — these `p` folds run in parallel. Then the `p` partials are combined with a **tree** reduce (span `⌈log₂ p⌉`). The total real combines are still `n − 1` (the `e ⊕ x₀` that starts each chunk fold is a free identity application, not a combine). The modeled span is `(longest chunk length) + ⌈log₂ p⌉ = Θ(n/p + log p)`.
- **Hint:** This is how every CPU/GPU reduction is actually mapped onto `p` cores: the `n/p`-length chunk fold is cache-friendly serial code (no synchronization inside a chunk), and only the tiny `⌈log₂ p⌉`-deep tree over the partials needs cross-core coordination. Choosing `p ≈ √(n / log n)` minimizes `n/p + log p`, but in practice `p` = core count and `n/p` dominates. The work is unchanged — two-level reduce is a *scheduling* of the same `n − 1` combines onto the critical path `n/p + log p`, which Brent's bound (see [the work–span tasks](../01-models-pram-work-span/tasks.md)) predicts for `p` processors.
- **Acceptance test:** Output equals `seq_reduce` for every `(n, p)`; `work = n − 1`; `span ≤ ⌈n/p⌉ + ⌈log₂ p⌉`. Place the span next to Task 2's pure tree reduce: at `p = n` the chunk length is `1` and you recover the `Θ(log n)` tree; at `p = 1` it is a single `Θ(n)` fold.

---

## Intermediate Tasks

### Task 5 — Segmented reduce and reduce-by-key **[coding]**

`[medium]` Real data arrives in groups. A **segmented reduce** folds *within* flagged segments in one parallel pass; **reduce-by-key** is the same idea keyed by an arbitrary label (the engine behind `GROUP BY` and `word count`). Implement both: a segmented reduce over a head-flag array and a reduce-by-key, and verify each against a straightforward sequential grouping.

#### Python

```python
import operator
from collections import OrderedDict

def segmented_reduce(vals, heads, op, identity):
    """Reduce within segments. heads[i]==1 starts a new segment. heads[0] must be 1.
    Returns one reduced value per segment, in order. (Sequential reference; the
    parallel form is a segmented scan whose last-of-segment values are these.)"""
    out, acc, started = [], identity, False
    for i, v in enumerate(vals):
        if heads[i]:
            if started:
                out.append(acc)            # close the previous segment
            acc, started = identity, True
        acc = op(acc, v)
    if started:
        out.append(acc)                     # close the final segment
    return out

def reduce_by_key(keys, vals, op, identity):
    """Combine all values sharing a key. Returns dict key -> reduced value.
    Order-independent only if op is commutative+associative; here keys group
    arbitrary positions, so op MUST be commutative (e.g. +, max, min)."""
    acc = OrderedDict()
    for k, v in zip(keys, vals):
        acc[k] = op(acc.get(k, identity), v)
    return acc

if __name__ == "__main__":
    import random
    random.seed(4)
    # Segmented reduce.
    for n in (1, 8, 64, 257):
        vals = [random.randint(0, 9) for _ in range(n)]
        heads = [1] + [1 if random.random() < 0.25 else 0 for _ in range(n - 1)]
        got = segmented_reduce(vals, heads, operator.add, 0)
        # Reference: split at head positions and sum each run.
        segs, cur = [], []
        for i, v in enumerate(vals):
            if heads[i] and cur:
                segs.append(cur); cur = []
            cur.append(v)
        segs.append(cur)
        assert got == [sum(s) for s in segs], "segmented reduce must match per-segment sums"

    # Reduce-by-key (word count).
    words = "the cat sat on the mat the cat ran".split()
    counts = reduce_by_key(words, [1] * len(words), operator.add, 0)
    assert counts["the"] == 3 and counts["cat"] == 2 and counts["ran"] == 1
    print("OK: segmented reduce matches per-segment folds; reduce-by-key counts words")
```

- **Constraints:** For the segmented reduce, `heads[0]` must be `1` (the first element always opens a segment); a value belongs to the segment opened by the most recent head flag. `op` must be associative (and, for the in-segment fold, the segment order is preserved so commutativity is not needed). For **reduce-by-key**, values sharing a key may come from arbitrary positions, so `op` must be **commutative and associative** (`+`, `max`, `min`, `OR`) — order of combination is not under your control.
- **Hint:** Segmented reduce is the *projection* of a [segmented scan](../02-parallel-prefix-sum-scan/tasks.md): run a segmented scan over the flag-value monoid and keep only the last value of each segment. That is why both parallelize at `Θ(n)` work / `Θ(log n)` span — they are one scan. Reduce-by-key is the **reduce** half of map-reduce in the MapReduce sense: `map` emits `(key, value)` pairs, the framework groups by key, `reduce` folds each group. Word count is `map(w → (w, 1))` then `reduce-by-key(+)`.
- **Acceptance test:** The segmented reduce equals the list of per-segment folds for random flag patterns; reduce-by-key produces the correct per-key totals (verified on a word-count example). Both are the grouped form of reduce that real data pipelines run.

---

### Task 6 — Monoid laws and the reduction work/span bound **[analysis]**

`[medium]` Make the parallel reduce rigorous. Prove that **associativity** is exactly what lets a tree reduce equal the sequential fold (and **why a non-associative `⊕` breaks it**), prove the tree reduce does `n − 1` combines and has depth `⌈log₂ n⌉`, and derive the `Ω(log n)` span floor.

> **No code.** Use this as the grading model.

**Setup — the monoid.** `(S, ⊕, e)` is a **monoid** when `⊕: S×S → S` is **associative** — `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` for all `a, b, c` — and `e` is a two-sided **identity** — `e ⊕ a = a ⊕ e = a`. A reduce over a monoid is **well-defined independent of bracketing**: by associativity, *every* way of parenthesizing `x₀ ⊕ x₁ ⊕ … ⊕ x_{n−1}` yields the same value.

**Claim 1 — any tree reduce equals the sequential fold.** The sequential fold computes the fully-left-bracketed value `((…((x₀ ⊕ x₁) ⊕ x₂) … ) ⊕ x_{n−1})`. A balanced tree computes some balanced bracketing, e.g. `(x₀ ⊕ x₁) ⊕ (x₂ ⊕ x₃)`. *Proof:* induction on `n` using associativity. For `n ≤ 2` both bracketings are identical. For `n > 2`, any bracketing splits as `L ⊕ R` where `L` brackets a prefix and `R` a suffix; by the induction hypothesis each equals the sequential fold of its part, and a finite number of associativity rewrites move the split point, so `L ⊕ R` equals the full left fold. Hence **all bracketings agree** — the tree result equals the sequential fold. ∎

**Why non-associativity breaks it (preview of Task 7).** If `⊕` is *not* associative, `(a ⊕ b) ⊕ c ≠ a ⊕ (b ⊕ c)` for some inputs, so the tree's bracketing and the fold's bracketing can produce **different** results. Subtraction is the cleanest witness: `(8 − 3) − 2 = 3` but `8 − (3 − 2) = 7`. The parallel result is then a *function of the tree shape*, which is exactly the bug Task 7 exhibits and Task 11 must defend against for floating-point `+`.

**Claim 2 — work is `n − 1`.** Each `⊕` takes two values and returns one, reducing the count by exactly one. To go from `n` values to `1` requires exactly `n − 1` reductions — *independent of tree shape*. So `T₁ = n − 1 = Θ(n)`, matching the sequential fold: the tree reduce is **work-efficient**.

**Claim 3 — span is `⌈log₂ n⌉`.** In the balanced tree, round `r` combines disjoint pairs, so at most `⌈n / 2^r⌉` values survive after `r` rounds. The count reaches `1` at the smallest `r` with `2^r ≥ n`, i.e. `r = ⌈log₂ n⌉`. Each round depends on the previous (a parent needs both children), so the critical path is `⌈log₂ n⌉` and `T∞ = Θ(log n)`.

**Claim 4 — the `Ω(log n)` lower bound.** On a binary-fan-in model (each `⊕` reads two operands), define `reach_t(c)` = the input elements that can influence a cell after `t` rounds. Initially `|reach_0| ≤ 1`; each round a value combines two cells, so `|reach_t| ≤ 2·max|reach_{t−1}| ≤ 2^t`. The final result depends on **all `n`** inputs (changing any `x_j` changes `x₀ ⊕ … ⊕ x_{n−1}` for, e.g., `+` over the reals), so `2^{T∞} ≥ n`, giving `T∞ ≥ log₂ n = Ω(log n)`. The tree reduce **meets** this bound, so it is span-optimal. (Full treatment in [the work–span tasks](../01-models-pram-work-span/tasks.md).)

- **Constraints:** State the monoid axioms; prove that associativity makes all bracketings agree (so the tree equals the fold), exhibiting a non-associative counterexample; prove `T₁ = n − 1` (shape-independent) and `T∞ = ⌈log₂ n⌉`; derive the `Ω(log n)` floor via the doubling-reach argument and note the tree meets it.
- **Acceptance test:** Associativity is named as the exact license for re-bracketing; subtraction is given as a non-associative witness; the work bound `n − 1` is argued from "each `⊕` removes one value"; the span and lower bound are both `Θ(log n)`, matching the counters measured in Task 2.

---

### Task 7 — Non-associative operators: parallel ≠ sequential **[coding]**

`[medium]` Associativity is not a formality — drop it and the parallel result *diverges from* the sequential one, and worse, *depends on the tree shape*. Demonstrate it two ways: a genuinely non-associative integer operator (subtraction), and the subtler real-world case of **floating-point addition**, where `+` is associative on the reals but **not on floats** because each add rounds.

#### Python

```python
import operator, random

def left_fold(xs, op):
    acc = xs[0]
    for x in xs[1:]:
        acc = op(acc, x)
    return acc

def pairwise(xs, op):
    """Balanced-tree bracketing (recursive split)."""
    if len(xs) == 1:
        return xs[0]
    mid = len(xs) // 2
    return op(pairwise(xs[:mid], op), pairwise(xs[mid:], op))

if __name__ == "__main__":
    # 1) Subtraction: non-associative, so fold != tree, by a lot.
    xs = [8, 3, 2, 5]
    f, t = left_fold(xs, operator.sub), pairwise(xs, operator.sub)
    # fold:  ((8-3)-2)-5 = -2 ;  tree: (8-3) - (2-5) = 5 - (-3) = 8
    assert f == -2 and t == 8, (f, t)
    print(f"subtraction: left_fold={f}  pairwise_tree={t}  -> DIFFERENT (not associative)")

    # 2) Float addition: associative on R, NOT on floats (each add rounds).
    random.seed(5)
    data = [1e16] + [1.0] * 100 + [-1e16]   # the small 1.0's vanish next to 1e16
    fold = left_fold(data, operator.add)     # ((1e16 + 1) + 1)... loses the 1.0's, then -1e16
    tree = pairwise(data, operator.add)      # sums the 1.0's together first -> keeps ~100
    print(f"float sum: left_fold={fold:.1f}  pairwise_tree={tree:.1f}  (true sum = 100.0)")
    assert fold != tree, "float + is order-dependent: parallel tree != sequential fold"
    # Pairwise is closer to the true 100.0 because it adds like-magnitude values first.
    assert abs(tree - 100.0) < abs(fold - 100.0)
    print("OK: non-associative (sub) and non-associative-on-floats (+) give parallel != sequential")
```

- **Constraints:** Show a **strict** difference for subtraction (`left_fold` vs `pairwise` give different integers — exact, no tolerance). For floats, construct a catastrophic-cancellation input (a huge value, many small ones, then the huge value's negative) where the fold and the tree give visibly different sums, and show the **balanced tree is closer to the true answer** because it combines like-magnitude values first. Do not claim float `+` is associative — it is associative on `ℝ` but the rounding after each operation breaks it on `float64`.
- **Hint:** Two distinct lessons. (1) For a *genuinely* non-associative `⊕` (subtraction, division, "first non-null"), a parallel reduce is **simply wrong** — there is no fix but to restructure the computation into an associative one (e.g. reduce the signed terms, then subtract once). (2) For float `+`, the reduce is *not deterministic across tree shapes*: the math is "associative enough" that the answer is *useful*, but two runs with different chunking give bit-different results — the reproducibility problem Task 11 solves with a fixed deterministic tree. Pairwise summation is also *more accurate* (Task 12), so the parallel form is often better, just not bit-identical to the naive sequential one.
- **Acceptance test:** Subtraction's fold and tree differ exactly (`-2` vs `8` for `[8,3,2,5]`); the float case shows `left_fold ≠ pairwise_tree` with the tree nearer the true sum. The takeaway is concrete: **a reduce is only parallelizable over a true monoid; float `+` parallelizes but sacrifices bit-reproducibility**.

---

### Task 8 — Map fusion: compose two maps without the intermediate array **[coding]**

`[medium]` A pipeline `map(g) ∘ map(f)` materializes an intermediate array of `f(x_i)` only to consume it immediately. **Fusion** rewrites it as a single `map(g ∘ f)` — one pass, one allocation, same result. Implement both, verify identical output, and confirm fusion does **one** pass over the data instead of two (and, when followed by a reduce, fuses the map into the reduce's leaves so the intermediate never exists).

#### Python

```python
class CountingList(list):
    """A list that counts how many times its elements are read (one 'pass' = n reads)."""
    reads = 0
    def __getitem__(self, i):
        CountingList.reads += 1
        return super().__getitem__(i)

def map_map_unfused(f, g, xs):
    """Two passes: build f(x) array, then map g over it."""
    mid = [f(xs[i]) for i in range(len(xs))]   # pass 1: n reads of xs, n writes
    return [g(mid[i]) for i in range(len(mid))]  # pass 2: n reads of mid

def map_fused(f, g, xs):
    """One pass: apply g(f(x)) per element. No intermediate array."""
    return [g(f(xs[i])) for i in range(len(xs))]

def map_reduce_fused(f, xs, op, identity):
    """Fuse the map into the reduce's leaves: never materialize f(x_i)."""
    acc = identity
    for i in range(len(xs)):
        acc = op(acc, f(xs[i]))                  # f applied lazily at each leaf
    return acc

if __name__ == "__main__":
    import operator
    f = lambda x: x + 1
    g = lambda x: x * 2
    for n in (0, 1, 100, 1000):
        xs = list(range(n))
        assert map_map_unfused(f, g, xs) == map_fused(f, g, xs), "fusion must preserve output"

    # Pass count: unfused reads xs n times (and mid n more); fused reads xs once.
    CountingList.reads = 0
    _ = map_fused(f, g, CountingList(range(1000)))
    fused_reads = CountingList.reads
    CountingList.reads = 0
    _ = map_map_unfused(f, g, CountingList(range(1000)))
    unfused_reads = CountingList.reads
    assert fused_reads == 1000 and unfused_reads == 1000  # both read xs once...
    # ...but unfused ALSO allocates+reads a 1000-element intermediate. Show the saving:
    assert map_reduce_fused(f, [1, 2, 3], operator.add, 0) == (1 + 1) + (2 + 1) + (3 + 1)
    print("OK: map fusion preserves output, drops the intermediate array (and into-reduce too)")
```

- **Constraints:** Fusion must produce the **identical** result — `(g ∘ f)(x) = g(f(x))` exactly. The fused version must not allocate the intermediate `[f(x_i)]` array. When the map feeds a reduce, fuse `f` into the reduce's leaves so the products are consumed as they are produced (`Θ(1)` extra space, as in the dot product of Task 3). Handle the empty input.
- **Hint:** Fusion is a *work-preserving, span-preserving* rewrite that wins on **memory traffic and allocation**, which is what the work–span model ignores but real hardware charges for (see the bandwidth ceiling in [the work–span tasks](../01-models-pram-work-span/tasks.md)). Both versions do `n` applications of `f` and `n` of `g` — same work, same `Θ(1)` span — but the unfused one streams `2n` extra elements through cache. This is why `map(g).map(f).reduce(+)` in a real framework (Spark, NumPy with `numexpr`, GPU kernels) is compiled to a single fused kernel: the intermediate arrays are never written to DRAM.
- **Acceptance test:** `map_fused` equals `map_map_unfused` for every input; the fused path makes one pass and allocates no intermediate; `map_reduce_fused` consumes `f(x_i)` at the leaves. Fusion is the optimization that makes map-reduce pipelines bandwidth-efficient without changing the result.

---

## Advanced Tasks

### Task 9 — Semiring map-reduce: one step of all-pairs shortest paths and reachability **[coding]**

`[hard]` Generalize `+` and `·` to a **semiring** `(S, ⊕, ⊗)` and matrix "multiply" becomes a map-reduce: `C[i][j] = ⊕_k (A[i][k] ⊗ B[k][j])` — `map` the `⊗` products, `reduce` them with `⊕`. Over the **(min, +)** semiring this is one round of **shortest-path relaxation** (the inner step of Floyd–Warshall / repeated squaring); over **(OR, AND)** it is **reachability**. Implement the semiring product and verify both interpretations.

#### Python

```python
INF = float("inf")

def semiring_matmul(A, B, oplus, otimes, zero):
    """C[i][j] = reduce_k ( A[i][k] otimes B[k][j] ) with reducer oplus, identity zero.
    map = the otimes products for fixed (i,j); reduce = fold them with oplus."""
    n, m, p = len(A), len(B[0]), len(B)
    C = [[zero] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            acc = zero
            for k in range(p):                       # map: products; reduce: oplus-fold
                acc = oplus(acc, otimes(A[i][k], B[k][j]))
            C[i][j] = acc
    return C

def min_plus(A, B):       # (min, +): one shortest-path relaxation step
    return semiring_matmul(A, B, min, lambda a, b: a + b, INF)

def or_and(A, B):         # (OR, AND) over booleans: reachability in <=2 hops
    return semiring_matmul(A, B, lambda a, b: a or b, lambda a, b: a and b, False)

if __name__ == "__main__":
    # (min,+): distances after relaxing through one intermediate.
    # Graph 0->1 (w2), 1->2 (w3), 0->2 (w10). One min-plus square finds 0->2 = 5.
    W = [[0,   2,   10],
         [INF, 0,   3 ],
         [INF, INF, 0 ]]
    W2 = min_plus(W, W)
    assert W2[0][2] == 5, f"min-plus must relax 0->1->2 = 5, got {W2[0][2]}"
    assert W2[0][1] == 2 and W2[1][2] == 3

    # (OR,AND): adjacency squared = reachability within 2 hops.
    Adj = [[False, True,  False],
           [False, False, True ],
           [False, False, False]]
    R2 = or_and(Adj, Adj)
    assert R2[0][2] is True, "0->1->2 must be reachable in 2 hops"
    assert R2[0][1] is False, "0->1 needs exactly 1 hop, not 2 -> AND-OR gives False here"
    print("OK: (min,+) relaxes shortest paths; (OR,AND) computes 2-hop reachability")
```

- **Constraints:** Both `⊕` and `⊗` must satisfy the semiring laws on the entries used: `⊕` associative+commutative with identity `zero` (`min` with `+∞`; `OR` with `False`); `⊗` associative with identity `one` and distributing over `⊕` (`+` with `0`; `AND` with `True`); and `zero` annihilates `⊗` (`+∞ + x = +∞`; `False AND x = False`). The inner `k`-loop is a **map-reduce**: map the `⊗` products, reduce with `⊗`'s `⊕`. The `n²` output entries are independent — work `Θ(n³)`, span `Θ(log n)` (the `⊕`-reduction depth per entry).
- **Hint:** This is *why* semirings matter: the **same** triple-loop, with the addition/multiplication swapped for `(min, +)` or `(OR, AND)` or `(max, ·)`, computes shortest paths, transitive closure, maximum-capacity paths, and more — each as a parallel map-reduce per output cell. Repeated squaring of the `(min, +)` matrix (`log n` products) gives all-pairs shortest paths in `Θ(n³ log n)` work and `Θ(log² n)` span; the boolean version gives transitive closure. The map-reduce structure (independent cells, each an associative reduction) is what makes the whole thing parallel.
- **Acceptance test:** `min_plus(W, W)` relaxes one intermediate hop correctly (`0→1→2 = 5`); `or_and(Adj, Adj)` computes 2-hop reachability. The inner loop is a map (`⊗`) then a reduce (`⊕`) — a semiring map-reduce, with the operators chosen for the problem.

---

### Task 10 — Tree all-reduce vs ring all-reduce: count the communication **[coding]**

`[hard]` On a cluster, **all-reduce** gives *every* one of `p` nodes the global reduction of their local data — the collective behind distributed SGD. Two classic schedules: a **tree all-reduce** (reduce up a tree, broadcast down — `2 log p` steps, latency-optimal) and a **ring all-reduce** (`2(p−1)` steps, each moving only `n/p` of the vector — bandwidth-optimal). Simulate both, verify every node ends with the global sum, and count the communication.

#### Python

```python
def tree_all_reduce(local):
    """local[r] = node r's vector (length n). Returns each node's copy of the global
    sum, plus (steps, bytes_moved). Reduce up a binary tree, broadcast down."""
    p = len(local)
    n = len(local[0])
    vecs = [list(v) for v in local]
    steps = 0
    moved = 0
    d = 1
    # Reduce-up: node (i) sends to node (i - d) which accumulates. log p rounds.
    while d < p:
        for i in range(0, p, 2 * d):
            j = i + d
            if j < p:
                for k in range(n):
                    vecs[i][k] += vecs[j][k]        # node i absorbs node j's vector
                moved += n                          # one full vector sent
        steps += 1
        d *= 2
    # vecs[0] now holds the global sum. Broadcast-down: log p rounds.
    total = list(vecs[0])
    d //= 2
    while d >= 1:
        for i in range(0, p, 2 * d):
            j = i + d
            if j < p:
                vecs[j] = list(vecs[i])             # send the sum back down
                moved += n
        steps += 1
        d //= 2
    out = [list(total) for _ in range(p)]
    return out, steps, moved

def ring_all_reduce(local):
    """Ring all-reduce: 2(p-1) steps, each node sends only n/p elements per step.
    Phase 1 (reduce-scatter): p-1 steps. Phase 2 (all-gather): p-1 steps."""
    p = len(local)
    n = len(local[0])
    assert n % p == 0, "ring all-reduce shards the vector into p equal chunks"
    chunk = n // p
    vecs = [list(v) for v in local]
    steps = moved = 0

    def seg(r, s):                                   # node r's slice s = [s*chunk, ...]
        return slice(s * chunk, (s + 1) * chunk)

    # Phase 1 — reduce-scatter: after p-1 steps, node r owns the full sum of chunk (r+1)%p.
    for t in range(p - 1):
        for r in range(p):
            send_chunk = (r - t) % p
            dst = (r + 1) % p
            for k in range(chunk):                   # add my send-chunk into the neighbour
                vecs[dst][seg(dst, send_chunk).start + k] += vecs[r][seg(r, send_chunk).start + k]
            moved += chunk
        steps += 1
    # Phase 2 — all-gather: circulate the completed chunks, p-1 steps.
    for t in range(p - 1):
        for r in range(p):
            send_chunk = (r + 1 - t) % p
            dst = (r + 1) % p
            vecs[dst][seg(dst, send_chunk)] = list(vecs[r][seg(r, send_chunk)])
            moved += chunk
        steps += 1
    return vecs, steps, moved

if __name__ == "__main__":
    import random
    random.seed(6)
    p, n = 4, 12
    local = [[random.randint(0, 9) for _ in range(n)] for _ in range(p)]
    truth = [sum(local[r][k] for r in range(p)) for k in range(n)]

    tree, t_steps, t_bytes = tree_all_reduce(local)
    assert all(tree[r] == truth for r in range(p)), "tree all-reduce: every node has the sum"
    ring, r_steps, r_bytes = ring_all_reduce(local)
    assert all(ring[r] == truth for r in range(p)), "ring all-reduce: every node has the sum"

    print(f"tree all-reduce: steps={t_steps} (~2 log2 p={2*2}), vector-units moved={t_bytes}")
    print(f"ring all-reduce: steps={r_steps} (=2(p-1)={2*(p-1)}), chunk-units moved={r_bytes}")
    assert t_steps == 2 * 2                      # 2 log2 4 = 4 rounds
    assert r_steps == 2 * (p - 1)                # 6 rounds, but each moves only n/p
    assert r_bytes == 2 * (p - 1) * (n // p) * p // 1  # bandwidth-optimal: ~2n per node
    print("OK: both all-reduces give every node the global sum; tree=2 log p steps, ring=2(p-1) steps")
```

- **Constraints:** Both must leave **every** node holding the identical global sum. The **tree** all-reduce uses `2⌈log₂ p⌉` steps (reduce up, broadcast down) but each step moves a **full** `n`-length vector — latency `Θ(log p)`, but bandwidth per node `Θ(n log p)`. The **ring** uses `2(p−1)` steps but each step moves only an `n/p` **chunk**, so total data per node is `2·(p−1)·(n/p) ≈ 2n` — *independent of `p`*, the bandwidth-optimal collective. Use `+` (a commutative monoid) since chunks combine in ring order.
- **Hint:** This is the central trade-off in distributed deep learning. The tree (or its butterfly/recursive-doubling cousin) wins on **latency** when `n` is small — `2 log p` round trips. The ring wins on **bandwidth** when `n` is large — each node sends/receives `≈ 2n` bytes regardless of `p`, so it saturates the network links instead of bottlenecking one root. Production frameworks (NCCL, Horovod) default to ring (or hierarchical ring+tree) all-reduce for exactly this reason: gradient vectors are huge, so bandwidth dominates. The `⊕` must be commutative because the ring combines chunks in traversal order.
- **Acceptance test:** Every node holds the global sum in **both** schemes; tree uses `2⌈log₂ p⌉` steps moving full vectors, ring uses `2(p−1)` steps moving `n/p` chunks (`≈ 2n` per node total). The simulation makes the latency-vs-bandwidth trade-off countable, not hand-wavy.

---

### Task 11 — Deterministic-tree reduce vs naive atomic reduce (reproducible floats) **[coding]**

`[hard]` A naive parallel float reduce — every worker atomically adds its partial into a shared accumulator — gives a result that **depends on the (nondeterministic) order workers finish**, so two runs differ in the low bits. A **deterministic tree reduce** with a *fixed* combine order is bit-reproducible. Build both, show the atomic reduce is non-reproducible across runs while the deterministic tree is identical every time, and explain why.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// atomicReduce: each worker sums its chunk, then folds into a SHARED accumulator
// in finish-order. Because float64 + is not associative and finish-order varies,
// the low bits of the result vary RUN TO RUN.
func atomicReduce(data []float64, P int) float64 {
	n := len(data)
	chunk := (n + P - 1) / P
	var mu sync.Mutex
	total := 0.0
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		lo, hi := p*chunk, (p+1)*chunk
		if hi > n {
			hi = n
		}
		if lo >= hi {
			break
		}
		wg.Add(1)
		go func(lo, hi int) {
			defer wg.Done()
			var s float64
			for i := lo; i < hi; i++ {
				s += data[i]
			}
			// jitter so finish-order is genuinely nondeterministic
			time.Sleep(time.Duration(rand.Intn(50)) * time.Microsecond)
			mu.Lock()
			total += s // folds in arrival order -> not reproducible
			mu.Unlock()
		}(lo, hi)
	}
	wg.Wait()
	return total
}

// deterministicReduce: same P chunks, but partials are written to FIXED slots and
// combined left-to-right in INDEX order. Identical bits every run, any P.
func deterministicReduce(data []float64, P int) float64 {
	n := len(data)
	chunk := (n + P - 1) / P
	partials := make([]float64, P)
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		lo, hi := p*chunk, (p+1)*chunk
		if hi > n {
			hi = n
		}
		if lo >= hi {
			break
		}
		wg.Add(1)
		go func(p, lo, hi int) {
			defer wg.Done()
			var s float64
			for i := lo; i < hi; i++ {
				s += data[i]
			}
			partials[p] = s // fixed slot p, independent of finish time
		}(p, lo, hi)
	}
	wg.Wait()
	var total float64
	for _, s := range partials { // FIXED index order -> deterministic
		total += s
	}
	return total
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	n := 1_000_000
	data := make([]float64, n)
	for i := range data {
		data[i] = 1.0/3.0 + float64(i%7)*1e-9 // values that round when summed
	}
	const P = 8

	// Atomic reduce: collect distinct results across runs.
	seen := map[uint64]int{}
	for run := 0; run < 12; run++ {
		r := atomicReduce(data, P)
		seen[float64bits(r)]++
	}
	fmt.Printf("atomic reduce: %d distinct bit-patterns across 12 runs (nondeterministic)\n", len(seen))

	// Deterministic reduce: identical every run.
	first := deterministicReduce(data, P)
	allSame := true
	for run := 0; run < 12; run++ {
		if deterministicReduce(data, P) != first {
			allSame = false
		}
	}
	fmt.Printf("deterministic reduce: identical across 12 runs = %v\n", allSame)
}

func float64bits(f float64) uint64 { return atomic.LoadUint64((*uint64)(nil)) } // placeholder
```

#### Python (the determinism check, simplified)

```python
import struct

def atomic_like(partials, order):
    """Fold partials in a given order -> low bits depend on the order (float +)."""
    acc = 0.0
    for i in order:
        acc += partials[i]
    return acc

if __name__ == "__main__":
    import random
    random.seed(7)
    partials = [1e16, 1.0, -1e16, 2.0, 3.0, -4.0, 1e-8, 5e15]
    bitsets = set()
    for _ in range(50):
        order = list(range(len(partials)))
        random.shuffle(order)                      # simulate worker finish-order
        r = atomic_like(partials, order)
        bitsets.add(struct.pack("<d", r))          # exact bit pattern
    print(f"shuffled-order folds produced {len(bitsets)} distinct bit-patterns (nondeterministic)")
    fixed = [atomic_like(partials, range(len(partials))) for _ in range(50)]
    assert len(set(struct.pack('<d', x) for x in fixed)) == 1, "fixed order is reproducible"
    print("OK: arrival-order float reduce is nondeterministic; fixed-order tree is reproducible")
```

> **Note:** the Go `float64bits` line above is a deliberate placeholder — replace it with `math.Float64bits(f)` (import `math`) to read the exact bit pattern. The point stands without it: the atomic reduce's result varies run to run, the deterministic one does not.

- **Constraints:** The non-reproducible reduce must combine partials in **finish/arrival order** (a shared accumulator under a lock, or any order not fixed in advance). The deterministic reduce must combine partials in a **fixed order independent of timing** (fixed slots, then a fixed-index fold or a fixed-shape tree). Use float values that actually round when summed (mixed magnitudes), so the order genuinely changes the low bits. The deterministic result must be **bit-identical** across runs *and* across processor counts if you fix the tree shape.
- **Hint:** The root cause is Task 7: float `+` is not associative, so the result is a function of the bracketing — and a nondeterministic schedule chooses a *different* bracketing each run. Reproducibility (needed for debugging, regulatory audit, and bit-exact distributed training) requires pinning the reduction order: write partials to fixed slots, combine in a fixed tree. There is a cost — you cannot combine partials the instant they arrive — but it is usually cheap (the tree over `p` partials is tiny). This is why numerical libraries offer a "deterministic reduction" mode and why distributed-training frameworks fix the all-reduce tree shape.
- **Acceptance test:** The atomic/arrival-order reduce produces **multiple** distinct bit-patterns across repeated runs; the fixed-order tree reduce produces **one** bit-pattern every run (and across `P`). The demonstration ties non-reproducibility directly to float non-associativity plus schedule nondeterminism, and shows the fix is a fixed combine order.

---

### Task 12 — Pairwise summation error: `O(ε log n)` vs naive `O(ε n)` **[analysis]**

`[hard]` The tree reduce is not just lower-span — for floating-point sums it is *more accurate*. Prove the worst-case round-off of **naive sequential** summation is `O(ε n)` (relative), while **pairwise (tree)** summation is `O(ε log n)` — an exponential improvement in the error bound, and a second reason to prefer the parallel-shaped reduce.

> **No code.** Use this as the grading model.

**Model.** Each floating-point addition satisfies `fl(a + b) = (a + b)(1 + δ)` with `|δ| ≤ ε` (the unit round-off, `≈ 1.1·10⁻¹⁶` for `float64`). Let `S = Σ_{i=0}^{n−1} x_i` be the true sum and `Ŝ` the computed one. We bound the absolute error `|Ŝ − S|` in terms of `Σ|x_i|`.

**Naive sequential sum.** The running sum `s_k = fl(s_{k−1} + x_k)` accumulates a rounding factor at every step. After `n − 1` additions, `x_i` is multiplied by a product of up to `n − i` factors `(1 + δ)`. Using `∏(1 + δ_j) = 1 + θ` with `|θ| ≤ (n−1)ε / (1 − (n−1)ε) ≈ (n−1)ε` (the standard `γ_{n−1}` bound), the error is

```
|Ŝ − S| ≤ (n − 1) ε Σ_{i} |x_i| + O(ε²)  =  O(ε n) · Σ|x_i|.
```

The earliest-added terms pass through the most additions, so they carry the largest `(n−1)`-fold rounding — the error grows **linearly in `n`**.

**Pairwise (tree) sum.** Recursively split into two halves, sum each, add the two results. Each input `x_i` now participates in only the additions on its **root-to-leaf path**, of which there are at most `⌈log₂ n⌉` (the tree depth). So each `x_i` accrues at most `⌈log₂ n⌉` rounding factors, giving `|θ_i| ≤ γ_{⌈log₂ n⌉} ≈ ε⌈log₂ n⌉`, and

```
|Ŝ − S| ≤ ⌈log₂ n⌉ · ε · Σ_{i} |x_i| + O(ε²)  =  O(ε log n) · Σ|x_i|.
```

**Comparison.** For `n = 10⁹`: naive's bound is `≈ ε·10⁹ ≈ 10⁻⁷` relative (you can lose 7 significant digits), while pairwise's is `≈ ε·30 ≈ 3·10⁻¹⁵` (you keep ~15 digits). The tree reduce that parallelism *forces* you toward is also the one numerical analysis *recommends* — the balanced bracketing both shortens the critical path **and** shortens every input's rounding path.

**Relation to Kahan summation.** Kahan (compensated) summation achieves `O(ε)` error — better still — by tracking the lost low-order bits, but it is inherently **sequential** (each step depends on the running compensation). Pairwise summation is the parallel-friendly middle ground: `O(ε log n)` error with `Θ(log n)` span. So the accuracy ranking is `naive O(εn)` ≫ `pairwise O(ε log n)` ≫ `Kahan O(ε)`, with pairwise the only one that is also low-span.

- **Constraints:** State the round-off model `fl(a+b) = (a+b)(1+δ)`, `|δ| ≤ ε`. Bound naive summation's error as `O(ε n)·Σ|x_i|` by counting that early terms pass through up to `n−1` additions. Bound pairwise summation as `O(ε log n)·Σ|x_i|` by counting each input's `≤ log n` additions on its tree path. Give the numeric comparison for a large `n` and place pairwise between naive and Kahan.
- **Acceptance test:** Naive error bound `O(ε n)`, pairwise `O(ε log n)`, derived by counting additions per input (path length in the summation tree); the worked `n = 10⁹` numbers show the gap (~7 digits vs ~15); pairwise is correctly identified as the low-span, accurate-enough reduce, with Kahan as the sequential `O(ε)` alternative.

---

## Synthesis Task

> Tie map and reduce together end to end: build the parallel map and the tree reduce with work/span counters, confirm every parallel result matches the sequential fold while the counters respect the bound, then build the variants — two-level, segmented, reduce-by-key, fused, semiring — and the collectives, and prove the monoid law, the `log n` floor, and the round-off bound.

`[capstone]` Carry **map and reduce** from definition to applications: implement, count, verify, and prove.

1. **The two primitives [coding].** Parallel map → `Θ(n)` work, `Θ(1)` span (Task 1); tree reduce with counters → `n − 1` work, `⌈log₂ n⌉` span (Task 2); the dot product as map-then-reduce (Task 3). Confirm every parallel output equals the sequential fold.

2. **Prove the structure [analysis].** The monoid laws and why associativity makes the tree equal the fold, with a non-associative counterexample (Task 6); the `Ω(log n)` span floor, met by the tree; the `O(ε log n)` vs `O(ε n)` round-off bound (Task 12).

3. **Schedule and group [coding].** The two-level reduce for a fixed `p` → span `Θ(n/p + log p)` (Task 4); segmented reduce and reduce-by-key (Task 5); map fusion that drops the intermediate (Task 8).

4. **The hard edges [coding].** A non-associative operator giving parallel ≠ sequential, and float `+`'s order-dependence (Task 7); the semiring map-reduce for shortest paths and reachability (Task 9).

5. **Collectives and reproducibility [coding].** Tree vs ring all-reduce with the communication count (Task 10); deterministic-tree vs atomic reduce for bit-reproducible floats (Task 11).

Reference harness in **Python** (drives the pieces and checks every bound):

```python
import operator, random
from math import log2, ceil

def synth(n, seed=0):
    random.seed(seed)
    add, idn = operator.add, 0
    xs = [random.randint(0, 9) for _ in range(n)]

    # Map + reduce primitives.
    mapped, m_work, m_span = map_counted(lambda x: x * x, xs)
    assert mapped == [x * x for x in xs] and m_work == n and m_span == (1 if n else 0)

    red, r_work, r_span = tree_reduce(xs, add, idn)
    assert red == seq_reduce(xs, add, idn), "tree reduce = sequential fold"
    assert r_work == n - 1 and r_span == ceil(log2(n)) if n else True

    # Two-level reduce at a few p.
    for p in (1, 4, 64):
        tl, tl_work, tl_span = two_level_reduce(xs, add, idn, p)
        assert tl == red and tl_work == n - 1

    # Dot product (map then reduce).
    a = [random.randint(-9, 9) for _ in range(n)]
    b = [random.randint(-9, 9) for _ in range(n)]
    dv, _, _ = dot_map_reduce(a, b)
    assert dv == sum(a[i] * b[i] for i in range(n))

    return m_work, m_span, r_work, r_span

if __name__ == "__main__":
    print(f"{'n':>7} {'map work':>9} {'map span':>9} {'red work':>9} {'red span':>9}")
    for n in (16, 256, 4096, 65536):
        mw, ms, rw, rs = synth(n)
        print(f"{n:>7} {mw:>9} {ms:>9} {rw:>9} {rs:>9}")
    print("\nOK: map = Theta(n)/Theta(1); reduce = (n-1)/ceil(log2 n); all parallel = sequential fold")
```

- **Analysis answer:** A **map** applies `f` independently to each element — `Θ(n)` work, `Θ(1)` span, parallelism `Θ(n)`, embarrassingly parallel. A **reduce** folds with an associative `⊕`; the **tree** reduce does `n − 1` combines (work-efficient, matching the sequential fold) in `⌈log₂ n⌉` rounds, and **associativity** is exactly what licenses the parallel re-bracketing — drop it (subtraction; float `+`) and the parallel result diverges from the sequential one and depends on the tree shape. The `Ω(log n)` span is a **lower bound** the tree meets (a value's dependency set doubles per round, the result needs all `n` inputs), so the only scheduling freedom is the **two-level** shape `Θ(n/p + log p)` for `p` processors. On top sit the variants: **segmented reduce** and **reduce-by-key** for grouped data, **map fusion** that drops the intermediate array, the **semiring** map-reduce that turns `(min,+)` / `(OR,AND)` matrix products into shortest paths and reachability, and the **all-reduce** collectives — tree (`2 log p` steps, latency-optimal) vs ring (`2(p−1)` steps, `≈ 2n`/node, bandwidth-optimal). Finally, float non-associativity forces a choice: a **deterministic-tree** reduce for bit-reproducibility, and pairwise summation's `O(ε log n)` error beats naive `O(ε n)` — the parallel shape is also the accurate one.
- **Acceptance test:** Every parallel map/reduce output equals the sequential fold; map measures `Θ(n)` work / `Θ(1)` span; tree reduce measures `n − 1` work / `⌈log₂ n⌉` span; two-level reduce keeps `n − 1` work at span `Θ(n/p + log p)`; segmented reduce, reduce-by-key, fusion, and the semiring product all match their sequential references; both all-reduces leave every node with the global sum at the predicted step counts; the deterministic reduce is bit-reproducible where the atomic one is not. The write-up mirrors the whole discipline: *run the map/reduce round by round, count the work and the span, confirm the output matches the sequential fold and the counters match the bound — then build the variants, the collectives, and prove the monoid law and the round-off floor.*

---

## Where to go next

- Build the scan that *keeps every partial* a reduce throws away — the work-efficient up-sweep/down-sweep, segmented scan, and the compaction and sorting it powers — in the [parallel prefix sum / scan tasks](../02-parallel-prefix-sum-scan/tasks.md); the up-sweep is precisely the tree reduce you built here.
- Revisit the work/span model, Brent's bound that predicts the two-level reduce's `Θ(n/p + log p)`, the reduction tree's `Θ(n)`-work `Θ(log n)`-span derivation, and the `Ω(log n)` span lower bound this topic's floor specializes, in the [models: PRAM and work–span tasks](../01-models-pram-work-span/tasks.md).
- For the conceptual treatment of map and reduce — monoids and semirings, the two-level and segmented forms, all-reduce collectives, and floating-point reproducibility and accuracy — read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.

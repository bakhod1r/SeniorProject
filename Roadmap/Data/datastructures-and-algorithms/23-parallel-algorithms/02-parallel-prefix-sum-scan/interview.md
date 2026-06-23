# Parallel Prefix Sum (Scan) — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Two Algorithms: Hillis–Steele vs Blelloch](#the-two-algorithms-hillissteele-vs-blelloch)
3. [Applications](#applications)
4. [Lower Bound & Recurrences](#lower-bound--recurrences)
5. [Gotcha / Trick Questions](#gotcha--trick-questions)
6. [Rapid-Fire Q&A](#rapid-fire-qa)
7. [Common Mistakes](#common-mistakes)
8. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: "Prefix sum looks inherently sequential — `out[i] = out[i-1] + a[i]`. How do you parallelize it?" *(Easy)*

**Answer**: The recurrence *looks* serial, but the operation `⊕` is **associative**, and associativity is exactly the property that lets you re-parenthesize a long chain into a **balanced tree**. `a₀ ⊕ a₁ ⊕ a₂ ⊕ a₃` can be computed as `(a₀ ⊕ a₁) ⊕ (a₂ ⊕ a₃)` — the two halves are independent and run in parallel. Recursing this gives a tree of depth `log n`.

So scan is **not** serial: it has **`Θ(n)` work and `Θ(log n)` span**, hence parallelism `Θ(n/log n)`. The trick is to compute the partial results once, in tree order, and reuse them — not to recompute each prefix from scratch. The one requirement is associativity; **commutativity is not needed** (order is preserved), which is why scan works for non-commutative monoids like matrix products and affine maps.

### Q2: Define inclusive scan vs exclusive scan. *(Easy)*

**Answer**: Given input `a₀, a₁, …, a_{n-1}` and associative `⊕`:

- **Inclusive scan**: `out[i] = a₀ ⊕ a₁ ⊕ … ⊕ a_i` — element `i` **is included** in its own prefix.
- **Exclusive scan** (a.k.a. prescan): `out[i] = a₀ ⊕ … ⊕ a_{i-1}`, with `out[0] = identity` (e.g. `0` for `+`) — element `i` is **excluded**.

```
input:      [3, 1, 7, 0, 4]
inclusive:  [3, 4, 11, 11, 15]
exclusive:  [0, 3, 4, 11, 11]
```

Conversion is `O(1)` extra: `exclusive[i] = inclusive[i] ⊖ a[i]`, or shift-right inclusive by one and drop the last. **Exclusive scan is the one you usually want** for indexing — it gives each element the offset of *where it starts*, which is precisely what stream compaction and radix-sort splits need (Q6–Q7).

### Q3: Reduction and scan have the same `(work, span)` — so what's the difference? *(Medium)*

**Answer**: Both are `(Θ(n) work, Θ(log n) span)`, both built on a balanced tree of `⊕`. The difference is what they **return**:

- **Reduction** returns a *single* value — the total `a₀ ⊕ … ⊕ a_{n-1}`. Only the up-sweep is needed.
- **Scan** returns *all `n` prefixes*. It needs an up-sweep **and** a down-sweep to distribute partial totals back to every position.

So scan ≈ "reduction that remembers and redistributes its partial results." Knowing they share the same asymptotics — and that scan costs a second tree pass — is the canonical framing. See [../01-models-pram-work-span/interview.md](../01-models-pram-work-span/interview.md).

---

## The Two Algorithms: Hillis–Steele vs Blelloch

### Q4: Describe Hillis–Steele scan and give its work and span. *(Medium)*

**Answer**: **Hillis–Steele** (the *naive* or *step-efficient* scan) runs `log n` rounds. In round `d` (for `d = 1, 2, 4, … < n`), every element adds the element `d` positions to its left:

```
for d = 1, 2, 4, ... < n:
    for all i in parallel:
        if i >= d: x[i] = x[i] ⊕ x[i - d]
```

After round with stride `d`, each `x[i]` holds the sum of the `2d` elements ending at `i`; after `log n` rounds it holds the full inclusive prefix.

- **Span**: `Θ(log n)` — there are `log n` rounds.
- **Work**: `Θ(n log n)` — each of `log n` rounds touches `Θ(n)` elements.

It is **not work-efficient**: `Θ(n log n)` total operations versus the serial `Θ(n)`. Its virtues are **simplicity** and being an **in-place, depth-minimal** pattern with no second pass — attractive on a GPU within a single warp/block where extra work is cheaper than synchronization.

### Q5: Describe Blelloch scan (up-sweep / down-sweep) and give its work and span. *(Hard)*

**Answer**: **Blelloch** is the **work-efficient** scan: two passes over a conceptual balanced binary tree.

**Up-sweep (reduce)** — leaves to root, building partial sums in place. Stride doubles each level:

```
for d = 1, 2, 4, ... n/2:
    for k = 0, d*2, 2*d*2, ... in parallel:
        x[k + 2d - 1] = x[k + d - 1] ⊕ x[k + 2d - 1]
```

**Down-sweep** — set the root to the **identity**, then walk root to leaves; at each node, the left child receives the parent's value and the parent receives `parent ⊕ (old left child)`:

```
x[n-1] = identity
for d = n/2, ... 4, 2, 1:
    for k = 0, d*2, ... in parallel:
        t = x[k + d - 1]
        x[k + d - 1] = x[k + 2d - 1]
        x[k + 2d - 1] = x[k + 2d - 1] ⊕ t
```

This produces an **exclusive** scan.

- **Span**: `Θ(log n)` — `log n` up-sweep levels + `log n` down-sweep levels.
- **Work**: `Θ(n)` — the levels do `n/2 + n/4 + … = n` operations each pass; both passes sum to `Θ(n)`.

So Blelloch matches the serial work `Θ(n)` while keeping `Θ(log n)` span — **work-efficient**, parallelism `Θ(n/log n)`.

### Q6: Why does work-efficiency matter — isn't the `Θ(log n)` span all that counts? *(Hard)*

**Answer**: **No.** By the work law `T_P ≥ T₁/P`, wall-clock time is floored by *total work* divided by the processor count `P`. On any real machine `P` is bounded (thousands of cores, not `n`). Hillis–Steele's extra `log n` factor of work means every processor does `log n×` more operations, so for large `n` on bounded `P` it can be **slower than the serial loop** despite its beautiful span.

Blelloch wastes no processors: `Θ(n)` work spread over `P` cores gives `Θ(n/P + log n)` time — near-linear speedup until `P ≈ n/log n`. **Rule: be work-efficient first, low-span second.** This is the textbook illustration of why span alone is a trap. See [../01-models-pram-work-span/interview.md](../01-models-pram-work-span/interview.md).

---

## Applications

### Q7: How does scan implement a parallel FILTER / stream compaction? *(Medium)*

**Answer**: **Stream compaction** = "keep the elements that pass a predicate, packed contiguously." The serial version is a single loop with a running write-cursor — apparently serial because each output index depends on how many earlier elements passed. Scan turns that running cursor into a parallel computation:

1. **Flags**: in parallel, set `flag[i] = 1` if `a[i]` passes the predicate, else `0`.
2. **Exclusive scan** of the flags → `offset[i]` = the number of kept elements *before* `i` = exactly the destination index for `a[i]` if it is kept.
3. **Scatter**: in parallel, `if flag[i]: out[offset[i]] = a[i]`.

```
a:       [d, a, c, b, e]   (keep vowels: a, e)
flag:    [0, 1, 0, 0, 1]
offset:  [0, 0, 1, 1, 1]   (exclusive scan)
scatter: a → out[0], e → out[1]   =>   out = [a, e]
```

The exclusive scan is the whole trick: it computes every output position **in parallel**, with `Θ(n)` work and `Θ(log n)` span. This is the foundational pattern behind GPU filtering, partitioning, and quicksort partition steps.

### Q8: How is scan used in radix sort? *(Hard)*

**Answer**: Radix sort processes keys one digit (or bit-group) at a time; each pass must **stably scatter** keys into buckets by the current digit. The destination of each key is "the start offset of its bucket plus how many same-digit keys came before it" — again a running count, again a scan.

Binary (1-bit) radix **split**: for the current bit,

1. Compute `flag[i] = bit of a[i]`. The `0`-keys go to the front, the `1`-keys after them.
2. **Exclusive scan** of `(1 - flag)` counts the `0`-keys before each position → offsets for the `0`-bucket.
3. The total count of `0`s gives the base offset for the `1`-bucket; a second scan over `flag` places the `1`-keys.
4. Scatter every key to its computed index — stable and fully parallel.

For multi-bit digits you compute a **per-bucket histogram** and an **exclusive scan over the histogram** to get each bucket's starting offset, then a per-element scan within buckets. Scan is what makes the scatter offsets computable in parallel — it is the heart of every GPU radix sort. See [../03-parallel-sorting-and-merging/interview.md](../03-parallel-sorting-and-merging/interview.md).

### Q9: What is segmented scan, and what is it good for? *(Hard)*

**Answer**: **Segmented scan** runs independent scans over contiguous *segments* of one array in a single parallel pass, marked by a **head-flag** bit per element (1 = start of a new segment, which resets the accumulation). It is implemented by scanning a **modified monoid** on `(flag, value)` pairs whose operator resets when it crosses a segment boundary — so it keeps the same `Θ(n)` work, `Θ(log n)` span.

Why it matters: it parallelizes *irregular, nested* computations as one flat scan, avoiding load imbalance from ragged inner loops. Key uses:

- **SpMV** (sparse matrix–vector multiply): each matrix row is a segment; segmented scan sums the per-row products in parallel regardless of how the nonzeros are distributed across rows.
- **Parallel quicksort / partition**: sub-arrays at one recursion level are segments scanned together.
- Any "do a scan/reduction per group" over jagged data without launching one kernel per group.

---

## Lower Bound & Recurrences

### Q10: Why does scan need `Ω(log n)` span? *(Medium)*

**Answer**: The **last** output, `out[n-1] = a₀ ⊕ … ⊕ a_{n-1}`, depends on **all `n` inputs**. Each `⊕` gate (or PRAM step) has **bounded fan-in** — it combines at most a constant number of values. To funnel information from `n` inputs into one output through constant-fan-in gates, the data must pass through a tree of depth at least `log_c n = Ω(log n)`. No fewer levels can gather `n` items. Hence any scan (indeed any reduction) has span `Ω(log n)`, and Blelloch's `Θ(log n)` is **asymptotically optimal**. The `Θ(log n)` is not an artifact of a particular algorithm — it is an information-theoretic floor.

### Q11: Why can a linear recurrence `x_i = a_i · x_{i-1} + b_i` be computed as a scan? *(Hard)*

**Answer**: Because each step is an **affine map** `f_i(x) = a_i · x + b_i`, and **affine maps are closed under composition** — they form an associative **monoid** (with identity `f(x) = x`, i.e. `(a, b) = (1, 0)`). Composing two affine maps:

```
(f₂ ∘ f₁)(x) = a₂(a₁ x + b₁) + b₂ = (a₂ a₁) x + (a₂ b₁ + b₂)
```

so the pair `(a, b)` composes by `(a₂, b₂) ⊕ (a₁, b₁) = (a₂ a₁, a₂ b₁ + b₂)`, an **associative** (non-commutative) operator. Running an inclusive scan with this `⊕` over the `(a_i, b_i)` pairs yields, at position `i`, the composed map from the start up to `i`; applying it to `x₀` gives `x_i`. The "serial-looking" recurrence is thus a scan over the **affine-composition monoid** — `Θ(n)` work, `Θ(log n)` span. This generalizes: any recurrence whose update is an associative map over a fixed-dimension state (e.g. tridiagonal solves, IIR filters, finite-state-machine runs) parallelizes by scan.

---

## Gotcha / Trick Questions

### Q12: "Is a floating-point parallel scan deterministic — same result every run?" *(Hard)*

**Answer**: **No.** Floating-point addition is **not associative** (`(a + b) + c ≠ a + (b + c)` due to rounding), yet every parallel scan re-associates the sum into a tree whose shape can depend on the thread count, block size, or scheduling. Different groupings round differently, so a parallel `float` scan can give a **different result than the serial scan, and different results across runs** if the reduction tree varies.

Consequences and fixes: don't expect bit-identical reproducibility from a parallel float scan; pin the reduction-tree shape if you need determinism; or use higher-precision/compensated (Kahan) accumulation to bound the error. With **integers**, `+` *is* associative, so integer scan is deterministic. This is a frequent real-world bug — "my GPU sum doesn't match the CPU" — and the answer is non-associativity, not a code error.

### Q13: "Hillis–Steele or Blelloch — which is better?" *(Medium)*

**Answer**: **"It depends" is the correct answer; anyone who says one is universally better is wrong.**

- **Blelloch** is **work-efficient** (`Θ(n)` work) → better for **large arrays** and **bounded `P`**, where wasted work dominates. It needs two passes and more index arithmetic, and reads/writes the array twice.
- **Hillis–Steele** does `Θ(n log n)` work but is **simpler**, **branch-light**, **in-place**, and needs only one pass with no down-sweep. Within a **single GPU warp/block** (small `n`, e.g. ≤ 1024, abundant idle lanes), the extra work is essentially free and the simpler synchronization wins.

Production GPU scans (e.g. CUB, Thrust) are **hybrid**: Hillis–Steele or a shuffle-based scan *within* a warp/block where steps are cheap, Blelloch-style work-efficient reduction *across* blocks where work matters. Span is `Θ(log n)` for both; the trade is **work vs simplicity**. See [./middle.md](./middle.md).

### Q14: "Scan needs the operator to be commutative, right?" *(Medium)*

**Answer**: **No — only associative.** Scan preserves input order; it never swaps operands, only re-parenthesizes. So commutativity is *not* required, which is exactly why scan works for **non-commutative** monoids: matrix multiplication, affine-map composition (Q11), string concatenation, min/max-plus. Confusing the two requirements would wrongly rule out these uses. (A *parallel reduction* can additionally exploit commutativity to reorder freely, but even reduction only strictly needs associativity.)

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Required property of `⊕`? | **Associative** (commutativity not needed) |
| 2 | Inclusive scan `out[i]`? | `a₀ ⊕ … ⊕ a_i` (self included) |
| 3 | Exclusive scan `out[i]`? | `a₀ ⊕ … ⊕ a_{i-1}`; `out[0] = identity` |
| 4 | Scan work & span (best)? | `Θ(n)` work, `Θ(log n)` span (Blelloch) |
| 5 | Hillis–Steele work/span? | `Θ(n log n)` work, `Θ(log n)` span |
| 6 | Blelloch work/span? | `Θ(n)` work, `Θ(log n)` span |
| 7 | Is Hillis–Steele work-efficient? | **No** (`n log n` vs serial `n`) |
| 8 | Blelloch passes? | Up-sweep (reduce) + down-sweep |
| 9 | Down-sweep starts by setting root to? | **Identity** |
| 10 | Scan span lower bound? | `Ω(log n)` (bounded fan-in over `n` inputs) |
| 11 | Stream compaction recipe? | flags → exclusive scan → scatter |
| 12 | Radix-sort use of scan? | Per-digit split / bucket offsets |
| 13 | Segmented scan use? | SpMV, per-group scans, quicksort |
| 14 | Linear recurrence as scan via? | Affine-composition monoid `(a,b)` |
| 15 | Parallel float scan deterministic? | **No** — `+` non-associative in FP |
| 16 | Parallelism of scan? | `Θ(n / log n)` |
| 17 | Reduction vs scan? | One total vs all `n` prefixes |

---

## Common Mistakes

1. **Calling scan "inherently serial."** Associativity → balanced tree → `Θ(log n)` span. It is one of the most parallelizable primitives.
2. **Requiring commutativity.** Scan needs only **associativity**; it preserves order and works for matrix/affine monoids.
3. **Quoting Hillis–Steele as work-efficient.** It does `Θ(n log n)` work — a `log n` factor worse than serial; Blelloch is the work-efficient one.
4. **Forgetting to seed the down-sweep with the identity.** Blelloch sets the root to identity before descending; skipping this corrupts every prefix.
5. **Mixing up inclusive and exclusive.** Indexing/compaction wants **exclusive** (offset of where each element *starts*); off-by-one bugs come from using inclusive here.
6. **Expecting bit-identical parallel float scans.** Re-association + non-associative FP rounding → nondeterminism. Integers are fine.
7. **Treating low span as enough.** Bounded `P` means work-efficiency dominates; prefer Blelloch for large `n`.

---

## Tips & Summary

- **Open with the one-liner**: "Scan looks serial but `⊕` is **associative**, so re-parenthesize into a tree — `Θ(n)` work, `Θ(log n)` span." That single sentence reframes the whole problem and signals you know the model.
- **Contrast the two algorithms by trade-off, not winner**: Hillis–Steele = simpler, one pass, `Θ(n log n)` work; Blelloch = up/down-sweep, work-efficient `Θ(n)`. Both `Θ(log n)` span. Real GPU scans are **hybrid**.
- **Lead with work-efficiency** when asked "which is better": bounded `P` + work law `T_P ≥ T₁/P` means wasted work hurts — prefer Blelloch for large arrays, Hillis–Steele within a warp.
- **Have the application triad ready**: stream compaction (flags → exclusive scan → scatter), radix-sort split (bucket offsets), segmented scan (SpMV). These prove you know *why* scan is the workhorse primitive of parallel computing.
- **State the `Ω(log n)` lower bound from fan-in**: the last output depends on all `n` inputs through constant-fan-in gates → depth `Ω(log n)` → Blelloch is optimal.
- **Name the FP gotcha**: parallel float scan is **nondeterministic** because `+` isn't associative; integer scan is deterministic. This separates senior candidates from juniors.

**Related:** [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md) · [Parallel Sorting & Merging — Interview](../03-parallel-sorting-and-merging/interview.md) · [Parallel Prefix Sum (Scan) — Middle](./middle.md)

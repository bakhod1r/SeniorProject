# Array-Oriented Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Array-Oriented Programming
> *Vectorization isn't a trick — it's a discipline. Broadcasting, masking, reductions, scans, and axes are its grammar; contiguous memory and SIMD are why it flies.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Vectorization in Depth](#vectorization-in-depth)
4. [Broadcasting — the Rules](#broadcasting--the-rules)
5. [The Three Families: Element-Wise, Reductions, Scans](#the-three-families-element-wise-reductions-scans)
6. [Boolean Masking & Fancy Indexing](#boolean-masking--fancy-indexing)
7. [Axis & Rank — Thinking in Dimensions](#axis--rank--thinking-in-dimensions)
8. [Why Vectorized Ops Are Fast](#why-vectorized-ops-are-fast)
9. [Decoding a Real APL/J Idiom](#decoding-a-real-aplj-idiom)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The grammar of array operations, and the machinery that makes them fast.**

At the junior level you learned the flip: `a * 2` instead of a loop. That's the *what*. This level is the *how* and *why* — the vocabulary that lets you express almost any data transformation without writing an explicit loop, and the hardware reality that makes those expressions an order of magnitude faster than the loop they replace.

There are really only a handful of moving parts, and they recombine endlessly:

- **Element-wise** ops — same operation at every position (you know these).
- **Broadcasting** — the rule that lets different-shaped arrays combine.
- **Reductions** — collapse an array along an axis (`sum`, `max`, `mean`).
- **Scans** — running/cumulative versions (`cumsum`, `cumprod`).
- **Boolean masking & fancy indexing** — select and assign without `if`/loops.
- **Axis & rank** — controlling *which dimension* an operation runs along.

Master these six and you can vectorize the vast majority of numeric and tabular work. The rest of this page is each one, in depth, plus the answer to the question that should be nagging you: *why is whole-array C code so much faster than my Python loop, and what's "SIMD" got to do with it?*

---

## Prerequisites

- **Required:** The junior page — element-wise ops, reductions, the loop→array flip, the array-as-value idea.
- **Required:** Comfortable with NumPy basics (`np.array`, indexing, `dtype`, `shape`).
- **Helpful:** Any exposure to 2-D data (a matrix, a spreadsheet, a pandas `DataFrame`) — axes make far more sense with two dimensions in play.
- **Helpful:** A rough sense of how a CPU reads memory (cache lines, contiguous vs scattered) — it explains the speed.

---

## Vectorization in Depth

**Vectorization** is the act of rewriting an element-by-element loop as a single operation over whole arrays. The word comes from treating the array as a mathematical *vector* and the operation as acting on the vector at once.

The mechanical recipe for vectorizing a loop:

1. **Find the loop body.** What happens to each element?
2. **Ask: does element `i`'s result depend only on inputs at `i`?** If yes, it's pure element-wise — replace the loop with the same expression on the whole array.
3. **If it aggregates** (a running total, a max), it's a **reduction** or **scan** — use `.sum()`, `.max()`, `np.cumsum`, etc.
4. **If it has a condition**, turn the condition into a **boolean mask** and select/assign with it instead of branching per element.

Worked example — a loop with arithmetic *and* a condition:

```python
# LOOP: clamp negatives to zero, then scale.
out = np.empty_like(prices)
for i in range(len(prices)):
    p = prices[i]
    if p < 0:
        p = 0
    out[i] = p * 1.1
```

Vectorized, the condition becomes a function (`np.maximum`) and the arithmetic stays element-wise:

```python
out = np.maximum(prices, 0) * 1.1     # clamp negatives, then scale — no loop, no if
```

`np.maximum(prices, 0)` is itself element-wise: at each position it takes the larger of `prices[i]` and `0`, broadcasting the scalar `0`. The branch disappeared into an array operation. This is the essence of vectorization: **conditions become masks or `np.where`; loops become whole-array expressions.**

```python
# The general conditional tool: np.where(condition, if_true, if_false) — element-wise ternary
signal = np.where(prices > threshold, "buy", "hold")
```

---

## Broadcasting — the Rules

**Broadcasting** is what lets `a * 2` work even though `a` is a 1000-element array and `2` is a single number. More generally, it's the set of rules NumPy uses to combine arrays of *different shapes* without you writing a loop or manually copying data.

The rules, applied by **comparing shapes from the right (trailing dimensions first)**:

1. If the arrays have a different number of dimensions, the shorter shape is **padded with 1s on the left**.
2. Two dimensions are **compatible** if they're **equal**, or **one of them is 1**.
3. A dimension of size 1 is **stretched** (virtually repeated) to match the other.
4. If any dimension pair is neither equal nor has a 1, it's a **broadcast error**.

```python
A = np.ones((3, 4))          # shape (3, 4)
A + 10                       # (3,4) + scalar  → scalar stretches to (3,4)
A + np.array([1, 2, 3, 4])   # (3,4) + (4,)    → (4,) padded to (1,4), stretched to (3,4) ✓
A + np.array([1, 2, 3])      # (3,4) + (3,)    → (3,) padded to (1,3) vs (3,4): 3≠4 → ERROR
```

The canonical use is combining a matrix with a per-row or per-column vector:

```python
data = np.array([[1, 2, 3],
                 [4, 5, 6]])            # shape (2, 3)

col_means = data.mean(axis=0)          # shape (3,)  — mean of each column
centered  = data - col_means           # (2,3) - (3,) → broadcasts down the rows
# each row has its column means subtracted; no loop over rows
```

To broadcast along the *other* axis (per-row), insert a length-1 dimension explicitly:

```python
row_sums = data.sum(axis=1)            # shape (2,)
normalized = data / row_sums[:, None]  # reshape (2,) → (2,1), broadcasts across columns
```

`[:, None]` (equivalently `.reshape(-1, 1)`) adds a trailing axis of size 1 so the row sums line up *down* the rows instead of across the columns. **Broadcasting is the single most important array-oriented skill beyond element-wise math** — it's how you avoid loops over rows and columns, and (as you'll see at the professional level) it's the foundation that tensor frameworks are built on.

> **Why it's not wasteful:** broadcasting doesn't actually copy the stretched data. NumPy fakes the repetition with zero-stride tricks, so `A + 10` doesn't materialize an array of a thousand 10s. The stretch is conceptual; the memory is not spent.

---

## The Three Families: Element-Wise, Reductions, Scans

Almost every array operation falls into one of three families. Knowing which family you need is half of vectorizing.

**1. Element-wise (shape-preserving):** input shape = output shape. One output per input.

```python
a + b        a * 2        np.sqrt(a)        a > 0        np.where(a > 0, a, 0)
```

**2. Reductions (collapsing):** an array → fewer values, by folding an operation across an axis. The output has *lower rank*.

```python
a.sum()         # all elements → one scalar
a.max()         # the maximum
a.mean()        # the average
M.sum(axis=0)   # sum down each column → one value per column
M.sum(axis=1)   # sum across each row  → one value per row
np.any(mask)    np.all(mask)            # boolean reductions: "any True?" / "all True?"
```

A reduction *is* the array-oriented spelling of `reduce`/`fold` from functional programming: `+/` in APL, `reduce(operator.add, xs)` in Python, `a.sum()` in NumPy — all the same idea, fold a binary op across the array.

**3. Scans (cumulative / running):** like a reduction, but it keeps **every intermediate result**. Output shape = input shape, but each position holds the accumulation *up to* that point.

```python
np.cumsum([1, 2, 3, 4])      # [1, 3, 6, 10]   — running total
np.cumprod([1, 2, 3, 4])     # [1, 2, 6, 24]   — running product
np.maximum.accumulate(a)     # running maximum (high-water mark)
```

Scans are how you vectorize *sequential* computations that *look* like they need a loop — running totals, cumulative returns, prefix sums, high-water marks. The difference at a glance:

| Family | Input → Output | Example | Loop equivalent |
|---|---|---|---|
| Element-wise | shape → same shape | `a * 2` | `out[i] = a[i]*2` |
| Reduction | shape → smaller | `a.sum()` | `t = 0; for x: t += x` |
| Scan | shape → same shape | `np.cumsum(a)` | `t = 0; for x: t += x; out.append(t)` |

---

## Boolean Masking & Fancy Indexing

This is how array-oriented code does the work of `if` inside a loop — without the `if` or the loop.

**Boolean masking:** a comparison produces a boolean array; you use it to *select* or *assign*.

```python
a = np.array([3, -1, 7, -4, 2, -9])

mask = a < 0                 # array([False, True, False, True, False, True])
a[mask]                      # array([-1, -4, -9])   — SELECT the negatives
a[a < 0]                     # same thing, inline
a[a < 0] = 0                 # ASSIGN: clamp all negatives to 0, in place
(a > 0).sum()                # count positives (True counts as 1)
a[(a > 0) & (a < 10)]        # combine masks with & | ~  (NOT and/or/not — and PARENTHESIZE)
```

Two non-negotiable rules people trip on:

- Combine masks with the **bitwise** operators `&`, `|`, `~` — *not* Python's `and`/`or`/`not`, which only work on single booleans and raise on arrays.
- **Parenthesize** each comparison: `(a > 0) & (a < 10)`. Operator precedence makes `&` bind tighter than `>`, so without parens you get a cryptic error.

**Fancy (integer) indexing:** index with an *array of positions* to gather or reorder.

```python
idx = np.array([0, 2, 4])
a[idx]                       # gather elements at positions 0, 2, 4
order = np.argsort(a)        # the indices that would sort a
a[order]                     # a, sorted — by reordering with an index array
```

Boolean masking selects *by condition*; fancy indexing selects *by position*. Together they replace nearly every "loop with an `if` that picks or rearranges elements" you'd otherwise write.

---

## Axis & Rank — Thinking in Dimensions

**Rank** is the number of dimensions an array has: a scalar is rank 0, a vector rank 1, a matrix rank 2, and an image-batch or a tensor might be rank 4+. **Axis** is *which* dimension an operation runs along. This single concept causes the most confusion and unlocks the most power.

```python
M = np.array([[1, 2, 3],
              [4, 5, 6]])     # shape (2, 3): axis 0 = rows (down), axis 1 = cols (across)

M.sum()                       # 21      — no axis: collapse everything
M.sum(axis=0)                 # [5, 7, 9]   — collapse the ROWS → one value per column
M.sum(axis=1)                 # [6, 15]     — collapse the COLUMNS → one value per row
```

The rule that makes `axis` click: **`axis=k` means "the operation eats dimension `k`."** `sum(axis=0)` removes axis 0 (the rows), leaving a result indexed by the remaining axis (columns). The reduced axis *disappears* from the output shape:

```python
M.shape           # (2, 3)
M.sum(axis=0).shape   # (3,)   — axis 0 consumed
M.sum(axis=1).shape   # (2,)   — axis 1 consumed
```

`keepdims=True` keeps the consumed axis as size 1, which is invaluable for broadcasting the result back:

```python
col_mean = M.mean(axis=0, keepdims=True)   # shape (1, 3) instead of (3,)
M - col_mean                               # broadcasts cleanly without manual reshaping
```

**Rank polymorphism** — the idea that the *same* operation (`+`, `sum`, `sqrt`) works uniformly across scalars, vectors, matrices, and higher tensors — is a defining trait of array languages, and it's what makes a single line of NumPy or PyTorch scale from a vector to a batch of images without rewriting. APL was built on this idea decades before tensors were fashionable.

---

## Why Vectorized Ops Are Fast

The junior page said "vectorized is faster"; here's the actual mechanism, because understanding it tells you *when* the speedup applies and when it doesn't.

A Python loop over a list pays four taxes **per element**:

1. **Interpreter dispatch** — decode and execute bytecode for each step.
2. **Boxing** — each number is a heap-allocated `PyObject` with a type tag and refcount, not a raw machine number.
3. **Dynamic type checks** — `x * 2` must re-check `x`'s type every iteration to pick the right `__mul__`.
4. **Pointer chasing** — list elements are scattered pointers, so the CPU cache can't predict the next access.

A NumPy array sidesteps all four:

- **Contiguous memory.** An `ndarray` is one flat block of raw numbers (e.g., 8-byte floats) packed side by side — not boxed objects. The CPU streams them in, and the **cache prefetcher** loves the predictable, sequential access.
- **One compiled C loop.** The iteration runs inside NumPy's C kernel, so the per-element interpreter/boxing/type-check taxes are paid *zero* times in Python — the type is known once, up front, from the `dtype`.
- **SIMD (Single Instruction, Multiple Data).** Modern CPUs have vector registers (SSE/AVX/NEON) that apply one instruction to 4, 8, or 16 numbers at once. Because the data is contiguous and uniformly typed, the compiler can emit SIMD instructions, processing a whole chunk of the array per CPU cycle.

```
Python loop:   [box][typecheck][dispatch][op] × N   ← N trips through the interpreter
NumPy a*2:     one C loop over a flat float64 block, SIMD'd ← ~one pass, vectorized in hardware
```

This is *exactly* the same insight as **data-oriented design** (see [10 — Data-Oriented Programming](../10-data-oriented-programming/)): performance comes from *how data is laid out in memory*, and processing contiguous homogeneous data in bulk is what hardware is built for. The array-oriented paradigm gets cache-friendliness and SIMD almost for free, simply because its primitive — the dense, typed array — is the layout the hardware wants.

> **The catch, previewed:** the speedup assumes the operation maps onto bulk array primitives. A computation where element `i` *depends on* element `i-1`'s freshly computed result (a true sequential dependency that isn't a scan) can't be vectorized cleanly — you're back to a loop. Recognizing that boundary is a senior skill; see `senior.md`.

---

## Decoding a Real APL/J Idiom

To cement that this is one paradigm across very different syntaxes, here's a genuinely famous J idiom and its full decoding. J writes the **mean** as:

```j
   mean =: +/ % #
   mean 2 4 6 8
5
```

Symbol by symbol:

- `+/` — **insert `+`** between all elements, i.e. reduce by addition (the `/` is reduce). `+/ 2 4 6 8` is `2+4+6+8` = `20`. Identical to NumPy `a.sum()`.
- `#` — **tally**, the count of elements. `# 2 4 6 8` is `4`. Identical to `len(a)`.
- `%` — divide.
- The whole thing, `+/ % #`, is a *fork*: "(sum) divided by (count)" = the mean.

In NumPy, the same composition is `a.sum() / len(a)` — or simply `a.mean()`. And the running-total scan you met above, `np.cumsum`, is `+/\` in APL (the `\` is *scan* where `/` is *reduce*). The vocabulary maps directly:

| Idea | APL/J | NumPy |
|---|---|---|
| Sum (reduce +) | `+/` | `a.sum()` |
| Product (reduce ×) | `×/` | `a.prod()` |
| Count | `#` (J) / `≢` (APL) | `len(a)` |
| Mean | `+/ % #` | `a.mean()` |
| Running sum (scan) | `+/\` | `np.cumsum(a)` |
| Max-reduce | `⌈/` | `a.max()` |

The array languages compress these to symbols because, as Iverson argued in *Notation as a Tool of Thought*, a good notation lets you *see* the whole computation at once. NumPy chooses words over symbols, but it's the same six families — element-wise, broadcasting, reductions, scans, masking, axes — underneath.

---

## Mental Models

- **Six verbs, infinite sentences.** Element-wise, broadcast, reduce, scan, mask, axis. Almost every numeric transformation is a short composition of these six. Vectorizing is mostly *parsing your loop into which verbs it uses*.
- **`axis=k` eats dimension `k`.** A reduction along an axis makes that axis disappear from the output. Picture the array collapsing flat in that one direction. `keepdims=True` leaves a flattened-but-present size-1 axis behind so it can broadcast back.
- **Broadcasting is alignment, not copying.** Different shapes line up from the right; size-1 axes stretch (virtually, with zero stride). No memory is spent on the repetition — it's a view of the data, not a duplicate.
- **Speed comes from the layout.** The array is fast because it's a flat, typed, contiguous block — exactly what caches and SIMD want. Same principle as data-oriented design: *organize the data for the hardware, and the loop writes itself in C.*

---

## Common Mistakes

- **Using `and`/`or`/`not` to combine masks.** Use `&`, `|`, `~`, and parenthesize each comparison: `(a > 0) & (a < 10)`. Python's boolean keywords raise on arrays.
- **Getting the axis backwards.** `sum(axis=0)` collapses *down the rows* (per-column result); `axis=1` collapses *across columns* (per-row result). Check the output `.shape` until it's reflex.
- **Forgetting to reshape for the other-axis broadcast.** Subtracting per-row values needs `row_vals[:, None]` to add the trailing size-1 axis; without it you get a shape error or a silently wrong per-column subtraction.
- **Building results with `np.append` in a loop.** `np.append` reallocates the whole array every call — quadratic and un-vectorized. Pre-allocate with `np.empty`/`np.zeros`, or find the bulk expression.
- **Assuming everything vectorizes.** Genuinely sequential, data-dependent recurrences (where step `i` needs step `i-1`'s *new* value, and it's not a standard scan) don't map onto array primitives. Reach for a compiled loop (Numba/Cython) rather than forcing an unnatural vectorization.
- **Ignoring `dtype` and integer overflow.** `np.array([1,2,3])` is `int64`; summing huge integer arrays can overflow silently, and integer division truncates. Set `dtype=float` when you mean floats.

---

## Summary

Array-oriented programming has a small, composable **grammar**: **element-wise** ops (shape-preserving), **reductions** (collapse an axis: `sum`/`max`/`mean`), and **scans** (cumulative: `cumsum`/`cumprod`), glued together by **broadcasting** (align shapes from the right; size-1 axes stretch for free) and **boolean masking / fancy indexing** (select and assign by condition or by position, replacing per-element `if`s and loops). **Axis** controls *which dimension* an operation consumes (`axis=k` eats dimension `k`), and **rank polymorphism** lets the same expression scale from a vector to a batch of tensors. These operations are fast for a concrete hardware reason: the array is a **contiguous, homogeneously typed block**, so the loop runs once in compiled C — no per-element interpreter dispatch, boxing, or type checks — and the CPU can apply **SIMD** instructions across many elements per cycle. That's the same data-layout insight behind data-oriented design. Across APL/J's terse symbols (`+/ % #` for the mean, `+/\` for a running sum) and NumPy's words, it's the same six verbs underneath.

---

## Further Reading

- *NumPy Broadcasting* (official docs) — the authoritative, diagram-rich statement of the broadcasting rules.
- *From Python to NumPy* (Nicolas Rougier) — a whole book on the *art* of vectorization, with reductions/scans and masking worked end to end.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — why contiguous, predictable memory access is fast; the hardware story behind vectorization.
- *The J Primer* / Dyalog APL tutorials — to actually read the reduce (`/`) and scan (`\`) idioms in their native habitat.
- Stéfan van der Walt et al., *The NumPy Array: A Structure for Efficient Numerical Computation* (2011) — the paper on how the `ndarray` enables vectorized, cache-friendly computation.

---

## Related Topics

- [`junior.md`](junior.md) — the loop→array flip, element-wise ops, and why it's shorter *and* faster.
- [`senior.md`](senior.md) — the trade-offs: large temporaries, the readability cliff, and when vectorization is the wrong tool.
- [`professional.md`](professional.md) — array-oriented at scale: dask/Polars/Arrow, GPU tensors, columnar query engines, autodiff.
- [10 — Data-Oriented Programming](../10-data-oriented-programming/) — the memory-layout insight (struct-of-arrays, cache lines) that makes vectorization fast.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — composing transformations as a pipeline, a sibling style of "describe the transform."
- [03 — Declarative Programming](../03-declarative-programming/) — vectorized expressions as *what, not how* over bulk data.
- [Functional Programming → Map / Filter / Reduce](../../code-craft/functional-programming/04-map-filter-reduce/) — reductions and scans as `fold`/`scan` in the functional tradition.

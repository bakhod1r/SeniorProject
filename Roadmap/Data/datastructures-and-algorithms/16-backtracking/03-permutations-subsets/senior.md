# Generating Permutations, Subsets, and Combinations — Senior Level

> **Focus:** Production concerns for combinatorial generation: managing **huge output** with generators/iterators/streaming instead of materializing everything, **avoiding redundant work**, guaranteeing **lexicographic ordering**, designing for **testability**, and recognizing the **failure modes** (memory blowups, stack overflow, silent duplicates) that bite real systems.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Huge Output Management: Generators and Streaming](#2-huge-output-management-generators-and-streaming)
3. [Iterator-Based Combinatorial Generation](#3-iterator-based-combinatorial-generation)
4. [Avoiding Redundant Work](#4-avoiding-redundant-work)
5. [Lexicographic Ordering Guarantees](#5-lexicographic-ordering-guarantees)
6. [Ranking and Unranking](#6-ranking-and-unranking)
7. [Iterative and Stack-Safe Backtracking](#7-iterative-and-stack-safe-backtracking)
8. [Memory and Allocation Discipline](#8-memory-and-allocation-discipline)
9. [Parallel and Distributed Enumeration](#9-parallel-and-distributed-enumeration)
10. [Code Examples](#10-code-examples)
11. [Observability and Testing](#11-observability-and-testing)
12. [Failure Modes](#12-failure-modes)
13. [Summary](#13-summary)

---

## 1. Introduction

A junior writes `subsets(nums)` returning `List<List<Integer>>` and moves on. In production, that signature is a liability the moment `n` grows: `2^25` subsets is 33 million lists; `13!` permutations is over six billion. You cannot — and must not — hold them all in memory. The senior reframe is:

- **Stream, don't materialize.** Yield one result at a time (generator/iterator), let the consumer process and discard it, and keep memory at `O(n)`.
- **Stop early.** Most real tasks want "the first valid one," "any one satisfying a predicate," or "the first 100" — not the entire space. The generator must support early termination cheaply.
- **Be deterministic.** Reproducible, lexicographic ordering matters for testing, diffing, caching, and resumability.
- **Be resumable.** For very large spaces you may need to checkpoint at index `r` and continue later — which means **ranking/unranking** (mapping an integer to the `r`-th object and back).
- **Be safe.** Recursion depth `n` can overflow the stack; output-sized allocations can OOM. Senior code anticipates both.

This file treats combinatorial generation as a *data pipeline component*, not a one-shot function.

---

## 2. Huge Output Management: Generators and Streaming

The single most important production change is to **never return the full collection**. Compare two shapes:

```
# BAD: builds the entire 2^n list in memory, then returns it
def all_subsets(nums) -> list[list]: ...

# GOOD: yields one subset at a time; caller decides what to keep
def iter_subsets(nums):
    yield from ...        # O(n) memory regardless of 2^n total
```

The streaming version lets the consumer:

- **Filter on the fly** — keep only subsets whose sum is prime, discard the rest, never storing the others.
- **Take-while / take-n** — stop after the first match or first `N` results.
- **Pipe** — feed results into a reducer (count, max, argmax) without buffering.

In Python this is a `yield` generator; in Java an `Iterator<List<Integer>>` (or a `Stream` with a custom `Spliterator`); in Go a callback `func(combo []int) bool` (return `false` to stop) or a channel. The callback/visitor style is often the most portable and the easiest to make stop-early.

> **Design rule:** the public API of a combinatorial generator should be *pull-based* (iterator) or *push-with-early-stop* (visitor returning a "continue?" boolean). Returning a fully materialized collection should be an opt-in convenience wrapper, never the default for large `n`.

---

## 3. Iterator-Based Combinatorial Generation

A clean way to stream **without recursion** is to maintain an explicit "current combination" and advance it to its lexicographic successor on each `next()`. For combinations C(n,k), the successor rule is:

```
advance(c, n, k):              # c is the current strictly-increasing index list
    i = k - 1
    while i >= 0 and c[i] == n - k + i:   # c[i] at its maximum
        i -= 1
    if i < 0: return false                 # was the last combination
    c[i] += 1
    for j in i+1 .. k-1:
        c[j] = c[j-1] + 1                  # reset the tail to the smallest valid
    return true
```

This is `O(k)` worst case per step, `O(1)` amortized, `O(k)` memory total — independent of `C(n,k)`. The analogous successors are `next_permutation` for permutations and a single increment for the subset bitmask. Standard libraries expose these directly: Python's `itertools.combinations / permutations / product`, which are all lazy iterators implemented in C. **Prefer the standard library** unless you need custom pruning the library cannot express.

---

## 4. Avoiding Redundant Work

Beyond not *storing* duplicates, senior code avoids *computing* redundant branches:

- **Skip-equal-siblings (covered in `middle.md`)** so duplicate inputs never spawn duplicate branches.
- **Feasibility pruning** — for combinations, the `n-(k-len)+1` bound; for sum problems, prune when the partial sum already exceeds the target (sorted `break`), and prune when even taking all remaining maxima cannot reach the target (a two-sided bound).
- **Symmetry breaking** — for problems with symmetric solutions (e.g. necklaces, board rotations), fix a canonical representative (smallest rotation) and skip the rest. This can divide the work by the symmetry group size.
- **Memo / shared sub-structure** — pure *enumeration* rarely memoizes (outputs differ), but *counting* and *existence* variants often collapse to DP. If the question is "how many" or "is there one," do not enumerate — see `professional.md`.
- **Incremental validity** — maintain the constraint state incrementally (e.g. column/diagonal occupancy for N-Queens) so each choice is `O(1)` to validate, not `O(n)`.

> **Mantra:** the cheapest branch is the one you never enter. Push every check as *early* (as shallow in the tree) as it can correctly go.

**Caching pitfalls specific to enumeration.** Memoization is the wrong reflex for *enumeration* and a frequent source of subtle bugs:

- **Outputs are distinct, so there is nothing to share.** Two different partial prefixes lead to two different sets of completions; caching keyed on a prefix returns the wrong objects for a different prefix. Memoize only the *count* or *existence* variants, never the object lists.
- **Caching the buffer aliases it.** If you cache `cur` and later mutate it (you will — it is the shared buffer), every cache entry corrupts. Cache only immutable snapshots, and only when the key truly determines the value.
- **Beware "result lists" caches across calls.** Returning a cached `List` from a generator that the caller then mutates is a classic shared-mutable-state bug; return immutable views or fresh copies.
- **Do cache the cheap invariants:** factorials, binomial tables, and Gray-code lookup tables are safe, immutable, and reused across many generation calls — precompute them once per process.

---

## 5. Lexicographic Ordering Guarantees

Many systems require results in a **stable, lexicographic** order: snapshot tests diff cleanly, caches key deterministically, and paginated APIs (`?after=...`) need a total order to resume.

Guarantees you can rely on:

- **Subsets via start-index** with a sorted input emit in a fixed order (the "co-lex"/prefix order shown in `junior.md`), reproducible across runs.
- **Combinations via the `advance` successor** emit in strict lexicographic order of the index tuples.
- **Permutations via `next_permutation`** from the sorted array emit in true lexicographic order and skip duplicates.
- **Swap-based permutations do NOT** guarantee order — never use them where ordering matters.

If a different order is required (e.g. by subset *size* then lexicographic), generate in the natural order and sort the *keys*, or restructure the traversal (e.g. loop `k = 0..n` and emit each size's combinations). Document the ordering contract explicitly in the function's doc comment; downstream code will depend on it whether you intend that or not.

---

## 6. Ranking and Unranking

For huge or distributed enumeration you need to address an object by **index** without generating its predecessors. Two operations:

- **Unrank(r)** — produce the `r`-th object directly. For subsets this is trivial: object `r` is the bitmask `r`. For combinations and permutations it uses the **combinatorial number system** / **factorial number system** (Lehmer code).
- **Rank(obj)** — the inverse: given an object, find its index.

Permutation unranking via the factorial base: write `r` in factorial number system (digits `d_{n-1} … d_0`, where digit `i` is in `0..i`), then pick the `d_i`-th *remaining* element at each step. This gives `O(n)` (or `O(n log n)` with an order-statistics tree) random access to the `r`-th permutation — enabling parallel workers to each enumerate a disjoint index range `[lo, hi)` with no coordination. Ranking/unranking is the backbone of resumable, shardable combinatorial jobs.

---

## 7. Iterative and Stack-Safe Backtracking

Recursion depth equals the solution length (`n` for subsets/permutations, `k` for combinations). For large `n` this can overflow the call stack. Options:

- **Iterative bit enumeration** for subsets — no stack at all.
- **Explicit stack** — convert the recursion to a loop driven by a manual stack of `(depth, nextChoiceIndex)` frames. More code, but bounded by an array you control.
- **Successor-based iteration** — `next_permutation` / `advance` for combinations need no recursion and `O(state)` memory.
- **Raise the limit cautiously** — Python's `sys.setrecursionlimit` or a larger goroutine stack are band-aids; prefer iteration for unbounded `n`.

In Go, deep recursion grows the goroutine stack (cheap, segmented) and rarely overflows, but unbounded growth still costs memory. In Java, the JVM stack is fixed (`-Xss`); deep recursion throws `StackOverflowError`. Know your runtime's limits before shipping.

**Implementation-choice decision matrix.** Which generation strategy to ship depends on the access pattern:

| Need | Best implementation | Memory | Notes |
|------|--------------------|--------|-------|
| All subsets, small `n` | bitmask `mask++` loop | O(1) state | no recursion, cache-friendly |
| All subsets, with pruning | start-index recursion + visitor | O(n) | prune hooks; stop-early |
| Single-toggle subset iteration | Gray code `i^(i>>1)` | O(1) | O(1) per step, incremental updates |
| All permutations, in order | `next_permutation` loop | O(1) extra | lexicographic, dedup-free |
| Random `r`-th object | unrank | O(n) | sharding, resume, pagination |
| Combinations stream | `advance` successor | O(k) | strict lex order |
| Constraint search (one solution) | recursion + incremental validity | O(n) | prune aggressively, stop at first |
| Distributed enumeration | unrank + range sharding | O(n)/worker | no coordination |

The cross-cutting principle: choose the *iterative successor* form (mask, Gray, `next_permutation`, `advance`) whenever you need bounded memory or streaming, and the *recursive* form when you need rich pruning hooks the successor cannot express.

---

## 8. Memory and Allocation Discipline

Even when you stream and never materialize the full output, the *per-step* allocations dominate runtime for combinatorial generators because there are exponentially many steps. The hot path is the emit/copy, so allocation discipline is where most real speedups live.

- **One shared buffer, copy only at emit.** The recursion mutates a single `cur` array; you allocate a fresh slice *only* when you hand a result to the consumer. Allocating a child buffer per node would add a factor of the tree size in garbage.
- **Avoid per-node closures and boxing.** In Java, autoboxing `int` into `Integer` for every choice churns the allocator; prefer `int[]` buffers and box once at emit (or expose an `int[]`-based visitor). In Go, reusing a backing array via reslicing (`cur = cur[:len(cur)-1]`) avoids reallocation. In Python, the interpreter overhead dwarfs allocation, so favor `itertools` (C-level) for plain enumeration.
- **Pre-size the result container** when you *do* materialize: knowing the count is `2^n` / `n!` / `C(n,k)` lets you allocate once and avoid the geometric regrowth of a dynamic array (each regrowth copies all prior results).
- **Pool reusable scratch.** For repeated generation in a server loop, a `sync.Pool` (Go) or a thread-local reusable buffer (Java) eliminates steady-state allocation entirely; the generator borrows a buffer, fills it, and returns it.
- **Beware the visitor that retains.** If your stop-early visitor *stores* the buffer it is handed (instead of consuming it transiently), you reintroduce the materialization you tried to avoid — and worse, the aliasing bug. Document whether the visitor receives a borrowed (must-copy-to-retain) or owned snapshot.
- **Tail memory of recursion.** Depth-`n` recursion holds `O(n)` frames plus the `O(n)` buffer — negligible compared to output, but the *constant* (frame size, captured variables) matters in tight loops; flatten captured state into explicit parameters when profiling shows frame bloat.

> **Rule:** count your allocations per emitted object. The target is `O(1)` heap allocations per result (the single snapshot copy). Anything more is a leak of throughput proportional to the exponential output.

---

## 9. Parallel and Distributed Enumeration

Because the output space is huge but each object is independent, combinatorial enumeration is **embarrassingly parallel** — *if* you can partition the work without generating overlaps or gaps.

**Index-range sharding (the clean approach).** Using ranking/unranking (§6), the total space `[0, N)` (where `N = 2^n`, `n!`, or `C(n,k)`) is split into `W` contiguous ranges, one per worker. Worker `w` unranks the start of its range to a concrete object, then advances with the successor function (`next_permutation`, combination `advance`, mask `++`) until it reaches its end index. Properties:

- **No coordination** — ranges are disjoint by construction; no locks, no shared queue.
- **Perfect load balance for unconstrained enumeration** — each range has the same size.
- **Deterministic and resumable** — a crashed worker restarts from its last committed index; a checkpoint is just an integer.

**Prefix sharding (the simple approach).** Fix the first one or two choices and assign each fixed prefix to a worker (e.g. permutations starting with element 0 go to worker 0). Easy to implement, but load is *imbalanced* once pruning enters — some prefixes prune to almost nothing while others stay dense. Use index-range sharding when balance matters.

**Pruned search caveat.** When heavy pruning is involved (constraint problems, not pure enumeration), index ranges no longer map to equal *work*, only equal *object counts*. Then you need **work-stealing**: idle workers pull subtrees from busy ones via a shared deque. This trades the no-coordination property for balance.

**Aggregation.** If the goal is a reduction (count, max, argmax, first-match), each worker reduces locally and you combine partials — no need to ship the exponential objects across the network. For first-match, a shared atomic "found" flag lets all workers stop early. For full materialization (rare and usually a smell at scale), workers stream to a sink; ensure the sink's ordering contract is documented (sharded output is *not* globally lexicographic unless you merge).

> **Distributed checklist:** shard by index range (not prefix) for balance; reduce locally and combine; use an atomic stop flag for first-match; checkpoint the per-worker index for resumability; never broadcast the exponential output — broadcast the *answer*.

### Sharded enumeration with local reduction

A worker that owns the rank range `[lo, hi)`, unranks its start, advances with `next_permutation`, and reduces locally (here: count permutations whose first element is the largest). Run `W` of these over disjoint ranges and sum the partials — no shared state.

```python
from math import factorial


def unrank(elements, r):
    items = list(elements)
    n = len(items)
    fact = [1] * (n + 1)
    for i in range(1, n + 1):
        fact[i] = fact[i - 1] * i
    out = []
    for i in range(n, 0, -1):
        idx, r = divmod(r, fact[i - 1])
        out.append(items.pop(idx))
    return out


def next_permutation(a):
    i = len(a) - 2
    while i >= 0 and a[i] >= a[i + 1]:
        i -= 1
    if i < 0:
        return False
    j = len(a) - 1
    while a[j] <= a[i]:
        j -= 1
    a[i], a[j] = a[j], a[i]
    a[i + 1:] = reversed(a[i + 1:])
    return True


def worker(elements, lo, hi, predicate):
    """Process the rank range [lo, hi); return a local count."""
    cur = unrank(sorted(elements), lo)   # jump directly to our start
    count = 0
    for _ in range(lo, hi):
        if predicate(cur):
            count += 1
        if not next_permutation(cur):
            break
    return count


if __name__ == "__main__":
    n = 5
    total = factorial(n)
    W = 4
    elems = list(range(n))
    pred = lambda p: p[0] == n - 1            # first element is the max
    bounds = [(w * total // W, (w + 1) * total // W) for w in range(W)]
    partials = [worker(elems, lo, hi, pred) for lo, hi in bounds]
    print(partials, "=>", sum(partials))      # sum equals (n-1)! = 24
```

The four ranges are disjoint and exhaustive, each worker computes independently, and the combined answer (`(n−1)! = 24`) matches the closed form — a self-checking sharded job. Swap `worker` calls for goroutines / threads / remote tasks unchanged.

---

## 10. Code Examples

### Streaming subsets with early stop, in all three languages

#### Go (visitor returning continue?-bool)

```go
package main

import "fmt"

// visitSubsets streams subsets; visit returns false to stop early.
// Memory is O(n) regardless of 2^n total subsets.
func visitSubsets(nums []int, visit func(sub []int) bool) {
	var cur []int
	var rec func(start int) bool
	rec = func(start int) bool {
		if !visit(cur) { // emit current node; caller may stop
			return false
		}
		for i := start; i < len(nums); i++ {
			cur = append(cur, nums[i])
			if !rec(i + 1) {
				return false
			}
			cur = cur[:len(cur)-1]
		}
		return true
	}
	rec(0)
}

func main() {
	count := 0
	// stop after the first 5 subsets — never builds the full 2^n list
	visitSubsets([]int{1, 2, 3, 4, 5, 6}, func(sub []int) bool {
		fmt.Println(append([]int(nil), sub...))
		count++
		return count < 5
	})
}
```

#### Java (Iterator over combinations, lazy)

```java
import java.util.*;

public class CombinationIterator implements Iterator<int[]> {
    private final int n, k;
    private int[] c;     // current combination of indices, strictly increasing
    private boolean done;

    public CombinationIterator(int n, int k) {
        this.n = n; this.k = k;
        if (k > n || k < 0) { done = true; return; }
        c = new int[k];
        for (int i = 0; i < k; i++) c[i] = i; // first combination 0,1,...,k-1
    }

    public boolean hasNext() { return !done; }

    public int[] next() {
        if (done) throw new NoSuchElementException();
        int[] out = c.clone();           // snapshot to return
        // advance c to the lexicographic successor
        int i = k - 1;
        while (i >= 0 && c[i] == n - k + i) i--;
        if (i < 0) { done = true; }
        else { c[i]++; for (int j = i + 1; j < k; j++) c[j] = c[j - 1] + 1; }
        return out;
    }

    public static void main(String[] args) {
        CombinationIterator it = new CombinationIterator(5, 3);
        int shown = 0;
        while (it.hasNext() && shown++ < 4) System.out.println(Arrays.toString(it.next()));
    }
}
```

#### Python (generator + itertools comparison)

```python
from itertools import combinations, permutations


def iter_subsets(nums):
    """Lazy generator: O(n) memory, yields one subset at a time."""
    n = len(nums)
    cur = []

    def rec(start):
        yield cur[:]
        for i in range(start, n):
            cur.append(nums[i])
            yield from rec(i + 1)
            cur.pop()

    yield from rec(0)


def first_matching_subset(nums, predicate):
    """Early-stop: scan the stream, return the first hit, discard the rest."""
    for sub in iter_subsets(nums):
        if predicate(sub):
            return sub
    return None


if __name__ == "__main__":
    # find first subset summing to 9 without materializing all subsets
    print(first_matching_subset(list(range(1, 8)), lambda s: sum(s) == 9))

    # standard library is the production default for plain enumeration:
    print(list(combinations(range(5), 3))[:4])
    print(next(permutations([1, 2, 3])))
```

**Run:** `go run main.go` | `javac CombinationIterator.java && java CombinationIterator` | `python stream.py`

### Permutation unrank (random access to the r-th permutation)

#### Python

```python
def unrank_permutation(elements, r):
    """Return the r-th permutation (0-indexed, lexicographic) of `elements`."""
    items = list(elements)
    n = len(items)
    # factorials 0..n
    fact = [1] * (n + 1)
    for i in range(1, n + 1):
        fact[i] = fact[i - 1] * i
    if r < 0 or r >= fact[n]:
        raise IndexError("rank out of range")
    result = []
    for i in range(n, 0, -1):
        idx, r = divmod(r, fact[i - 1])
        result.append(items.pop(idx))   # pick the idx-th remaining element
    return result


if __name__ == "__main__":
    # the 0th, 3rd, and last permutation of [0,1,2,3] without enumerating others
    print(unrank_permutation([0, 1, 2, 3], 0))   # [0, 1, 2, 3]
    print(unrank_permutation([0, 1, 2, 3], 3))   # [0, 2, 3, 1]
    print(unrank_permutation([0, 1, 2, 3], 23))  # [3, 2, 1, 0]
```

This is the key to **sharded** enumeration: worker `w` of `W` handles ranks `[w·N/W, (w+1)·N/W)` and unranks its start, then advances with `next_permutation`.

### API design contract (what to expose, what to hide)

A production combinatorial module should expose a small, layered API rather than one monolithic function:

```text
Layer 1 (lazy core):     iter / visit          → O(state) memory, stop-early
Layer 2 (reducers):      count, first, takeN    → built on Layer 1, no materialization
Layer 3 (convenience):   toList                  → materializes; documented "small n only"
Layer 4 (random access): unrank(r), rank(obj)    → O(n) addressing for sharding/resume
```

Design notes that pay off in review and in production:

- **Default to laziness.** `toList` is the convenience that bites people; make the lazy iterator the primary, idiomatic entry point and gate `toList` behind a name that signals cost (`materializeAll`, `collectSmall`).
- **Document the ownership contract** of the yielded buffer: borrowed (consumer must copy to retain) vs owned snapshot. A borrowed buffer is faster but is the source of the aliasing bug if retained.
- **Document the ordering contract** explicitly in the doc comment — lexicographic, by-size-then-lex, or unspecified. Downstream caching and pagination will silently couple to it.
- **Accept a comparator / key** so callers can choose ordering without rewriting the generator.
- **Surface pruning hooks** (a predicate "should I descend into this prefix?") so constraint problems reuse the same core without forking it.
- **Make `n` limits explicit.** Guard `toList` with a configurable cap and a clear error ("`n=30` would produce 2^30 results; use the iterator"), turning a silent OOM into an actionable failure.

Concretely, a well-factored module exposes roughly this surface:

```text
subsets.iter(nums)                  → lazy iterator (primary)
subsets.visit(nums, fn)             → push with early stop (fn returns keep-going?)
subsets.count(nums)                 → O(1)/O(n) closed form, never enumerates
subsets.firstWhere(nums, pred)      → stops at first match
subsets.unrank(nums, r)             → the r-th subset, O(n)
subsets.materializeAll(nums, cap)   → list; throws above cap (escape hatch)
```

Every entry point documents its ordering contract and its memory profile in one line, so a caller can choose correctly without reading the implementation.

---

## 11. Observability and Testing

- **Property tests over count.** Generated count must equal the closed form: `2^n` subsets, `n!` permutations, `C(n,k)` combinations, multinomial for duplicates. A mismatch instantly flags a bug.
- **Uniqueness invariant.** Insert every emitted result (canonicalized) into a set; the set size must equal the emit count. Catches both missing and duplicate outputs.
- **Ordering invariant.** Assert the stream is non-decreasing under the documented comparator (lexicographic). Snapshot-test the first/last few entries.
- **Round-trip rank/unrank.** For random `r`, `rank(unrank(r)) == r`; for random objects, `unrank(rank(o)) == o`.
- **Cross-check against the standard library** (`itertools`) on small inputs as an oracle.
- **Metrics in production:** track nodes visited vs leaves emitted (pruning effectiveness), max recursion depth, and peak buffer size. A sudden drop in pruning ratio signals a regression.
- **Bounded fuzzing:** random small inputs with planted duplicates, comparing your dedup output against generate-then-set.

### Instrumented generator (count + uniqueness invariants in one pass)

A lightweight harness that runs your generator and asserts the two most important invariants — exact count and uniqueness — plus reports the pruning ratio. Wire it into CI on small inputs.

```python
import math
from collections import Counter


def expected_subset_count(nums):
    # distinct sub-multisets = product of (multiplicity + 1)
    prod = 1
    for m in Counter(nums).values():
        prod *= (m + 1)
    return prod


def audit(generator, nums, expected):
    seen = set()
    emitted = 0
    for obj in generator(nums):
        emitted += 1
        key = tuple(obj)              # canonical key for a list result
        if key in seen:
            raise AssertionError(f"DUPLICATE emitted: {obj}")
        seen.add(key)
    if emitted != expected:
        raise AssertionError(f"COUNT mismatch: got {emitted}, want {expected}")
    return {"emitted": emitted, "distinct": len(seen)}


if __name__ == "__main__":
    def gen_subsets(nums):
        nums = sorted(nums)
        cur = []

        def rec(start):
            yield cur[:]
            for i in range(start, len(nums)):
                if i > start and nums[i] == nums[i - 1]:
                    continue
                cur.append(nums[i]); yield from rec(i + 1); cur.pop()

        yield from rec(0)

    print(audit(gen_subsets, [1, 2, 2], expected_subset_count([1, 2, 2])))
    # {'emitted': 6, 'distinct': 6}  — count and uniqueness both pass
```

The same harness, parameterized with `math.factorial(n) // prod(factorial(m) for m in mult)` for permutations and `math.comb(n, k)` for combinations, validates every generator in the module against its closed form. A failing count or a raised `DUPLICATE` localizes the bug to the exact input — far more actionable than a downstream symptom.

---

## 12. Failure Modes

| Failure | Symptom | Root cause | Mitigation |
|---------|---------|-----------|------------|
| OOM / GC thrash | Process killed building results | Materialized `2^n`/`n!` into a list | Stream via iterator/visitor; never return the full collection for large `n` |
| StackOverflowError | Crash at depth ~`n` | Recursion depth = solution length | Iterative bit enumeration / explicit stack / successor iteration |
| Silent duplicates | Output count > distinct count | Missing sort or wrong skip rule | Sort + correct `i>start` / `!used[i-1]`; uniqueness invariant test |
| Non-deterministic order | Flaky snapshot tests | Swap-based perms or unsorted input | Use ordered generators; sort input; document the contract |
| Aliasing bug | All results equal the last | Emitted the live buffer, not a copy | Snapshot (copy) at every emit |
| Pathological slowness | Hangs on moderate `n` | No pruning; redundant branches | Feasibility + sum pruning; symmetry breaking |
| Infinite recursion | Never terminates | Zero candidate in reuse combination-sum | Strip/forbid zeros; advance the index |
| Integer overflow in counts | Wrong totals / negative | `n!` or `2^n` exceeds 64-bit | Use big integers for counts; cap `n` |

> **Production checklist before shipping a combinatorial generator:** (1) it streams; (2) it stops early; (3) it copies on emit; (4) it has a uniqueness test and a count test; (5) its ordering is documented; (6) recursion depth is bounded or converted to iteration; (7) duplicate inputs are handled by pruning, not post-dedup.

---

## 13. Summary

At senior level, generating subsets, permutations, and combinations stops being a function and becomes a **streaming pipeline component**. The defining decisions are architectural: never materialize exponential output — stream it via iterators or stop-early visitors with `O(state)` memory; avoid *computing* redundancy through skip-equal-siblings, feasibility pruning, and symmetry breaking; guarantee a documented lexicographic ordering for testability and resumability; and use **ranking/unranking** to address objects by index for sharded, resumable jobs. Anticipate the failure modes — OOM, stack overflow, silent duplicates, aliasing, non-determinism — and defend against each with the matching mitigation and an invariant test (count, uniqueness, ordering, rank round-trip). The algorithm is the easy part; making it safe, fast, and observable at scale is the senior contribution.

The throughline is a single reframe: a combinatorial generator is not a function that *returns* answers, it is a *cursor* over a totally ordered space. Once you adopt that view, every senior practice follows — lazy iteration for memory, successor functions for streaming, ranking for random access and sharding, ordering contracts for testability, and per-emit allocation budgets for throughput. Build the cursor, document its contract, test its invariants, and the exponential output becomes a manageable, observable stream rather than a memory bomb.

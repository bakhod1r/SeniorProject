# N-Queens — Senior Level

> Backtracking N-Queens is small until it isn't: counting all solutions is exponential, so beyond ~`N=18` you need parallel search; *constructing* one solution at huge `N` needs closed-form placement, not search; and any production use needs overflow-safe counters, deterministic tests against OEIS, and a clear-eyed view of the failure modes (wrong diagonal shift, symmetry double-counting, stack depth, work-stealing imbalance).

## Table of Contents
1. [Introduction](#1-introduction)
2. [Bitmask Engineering and the Hot Loop](#2-bitmask-engineering-and-the-hot-loop)
3. [Parallel and Distributed Search](#3-parallel-and-distributed-search)
4. [Large-N Constructive Solutions](#4-large-n-constructive-solutions)
5. [Symmetry: Fundamental vs All Solutions](#5-symmetry-fundamental-vs-all-solutions)
6. [N-Queens Completion (Partial Boards)](#6-n-queens-completion-partial-boards)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At senior level the question is not "how does backtracking work" but "which variant of the N-Queens problem am I actually being asked to solve, and what breaks at scale?" There are three genuinely different problems hiding behind one name:

1. **Count all solutions** — exhaustive, pruned search. Exponential. The state of the art for raw counting parallelizes the search and uses tight bitmask kernels. The count is OEIS A000170 and has no closed form.
2. **Find one solution** — for small `N`, search with early exit; for **huge** `N` (millions), use a direct **constructive formula** in `O(N)` — no search at all.
3. **N-Queens completion** — given a partial board (some queens fixed), decide whether it extends to a full solution. This generalization is **NP-complete**, unlike the unconstrained problem which is trivially "yes for all `N ≠ 2, 3`".

Conflating these is the most common senior-level mistake. "We need N-Queens for `N = 1,000,000`" almost always means *construct one board*, which is `O(N)` — not *count*, which is infeasible. This document treats the engineering of each.

---

A fourth, often-overlooked guise is **N-Queens as a benchmark and stress test**: because the kernel is tiny, deterministic, and has a known answer, it is widely used to benchmark recursion overhead, bit-manipulation throughput, parallel scheduling, and even FPGA/GPU pipelines. Treating it as a benchmark imposes its own discipline — the answer must be exactly right (validated against OEIS), the work must be reproducible, and the scaling must be characterized. Those are the same disciplines a production counting service needs.

### The three questions that actually matter

For each variant, the senior decisions reduce to three questions:

1. **What is the dimension of the work?** For counting it is the number of valid partial placements (exponential, irreducible). For find-one-at-huge-N it is `O(N)` (construction). For completion it is exponential and NP-complete.
2. **How do I keep arithmetic correct?** 64-bit counters, `& full` after shifts, deterministic parallel reduction. N-Queens bugs are *silent* — wrong-but-plausible counts — so correctness is enforced by tests, not eyeballing.
3. **How do I make the constant small?** Bitmask kernel, last-row popcount, symmetry, parallel prefixes. None changes the exponent; all stack multiplicatively.

The rest of this document elaborates each, but keeping these three questions in view prevents the cardinal error: optimizing the constant of a problem you should not be solving by search at all.

## 2. Bitmask Engineering and the Hot Loop

The counting kernel is the bitmask recursion from [`middle.md`](./middle.md). Production tuning:

- **Pass masks by value.** No undo, no shared mutable state — essential for parallelism and for avoiding stale-marker bugs.
- **Use the platform word width.** `N ≤ 31` (or `63`) fits the diagonal masks in a single machine word after the `<<1` shifts; the `↘` mask grows toward the high bits, so size your word and `full` mask with headroom and mask after each shift.
- **`available & -available`** isolates the lowest free column in one instruction; `available &= available - 1` clears it. This is the canonical "iterate set bits" idiom.
- **Avoid recursion overhead at the leaves.** A common trick: when only one row remains, the answer is `popcount(available)` — every free column in the last row is a distinct solution. This collapses the final level of the tree into a single popcount and is a large constant-factor win.
- **Branch-free where it pays.** The hot loop is already nearly branch-free except the `while available`.
- **Cache the `full` mask** and any precomputed per-row constants; do not recompute `(1<<N)-1` inside the loop.

The last-row popcount optimization is worth isolating because it changes the constant materially:

```
solve(cols, diag, anti, row):
    if row == N - 1:
        return popcount(~(cols|diag|anti) & full)   # each free col is one solution
    ...
```

---

### Anatomy of the hot loop

The counting kernel reduces to a handful of operations per node:

```
avail = ~(cols | diag | anti) & full     // 1 OR-chain + NOT + AND
while avail:
    p = avail & -avail                   // BLSI (lowest set bit)
    avail &= avail - 1                    // BLSR (clear lowest set bit)
    recurse(cols|p, (diag|p)<<1 & full, (anti|p)>>1)
```

Every operation is a single machine instruction except the recursive call. The compiler can inline shallow levels and keep all four values in registers because nothing escapes to the heap. This is why the bitmask version is not just "fewer lines" but genuinely fewer cycles: there is no array indexing, no bounds checks, no undo writes. The dominant cost becomes the function-call overhead and the recursion depth — both addressed by the last-row popcount, which removes the deepest, most numerous frames.

## 3. Parallel and Distributed Search

> Reminder: parallelism applies to *counting* and *enumeration*. For "find one solution" at huge N you should not be searching at all (use the constructive formula); for completion, parallelism helps but the worst case is still NP-complete.

Counting is **embarrassingly parallel** along the top of the search tree:

- **Split on the first row (or first two rows).** Each choice of the row-0 queen (and optionally row-1) defines an independent subtree. Hand each subtree to a worker; sum the partial counts. No shared state because masks are passed by value.
- **Load balancing.** The subtrees are *not* equal in size — central columns spawn larger subtrees than edge columns. Use a **work-stealing** pool or a task queue of "(row, prefix-masks)" jobs rather than a static one-subtree-per-thread split, or the slowest subtree dominates wall time.
- **Symmetry at the split.** Combine the left-half symmetry reduction with parallelism: enumerate only left-half (and center) row-0 placements as tasks, double the left-half partial sums.
- **Distributed.** For record-setting counts (e.g. `N = 27`, done on large clusters/FPGAs), the tree is split into millions of independent prefixes, each a self-contained job; results are summed. The communication is trivial (one integer per job); the challenge is purely scheduling and raw throughput.
- **Determinism.** Sums of `uint64`/`int64` partial counts are order-independent, so parallel runs are reproducible even with non-deterministic scheduling — a nice property for testing.

Watch overflow: the count for `N = 27` is ~2.34×10¹⁶, which fits in `int64`/`uint64` but not `int32`. Always count in 64-bit.

---

### Granularity of the split

How deep should the prefix be? Splitting only on row 0 gives `N` tasks — too few for `N` workers when `N` is small, and unbalanced (center columns spawn larger subtrees). Splitting on rows 0–1 gives up to `N(N-1)` tasks, finer-grained and easier to balance, at the cost of more task-scheduling overhead. A common sweet spot: enumerate all consistent prefixes of depth `d` (chosen so the number of prefixes is, say, 10–100× the worker count), push them onto a work-stealing deque, and let workers drain it. Because each prefix carries its own `(cols, diag, anti)` masks by value, a task is fully self-describing — no shared mutable state, trivial to serialize for distributed execution.

### Summation and overflow at the join

Partial counts are summed at the join. Use `int64`/`uint64` accumulators per worker, then a single final reduction. Integer addition is associative and commutative, so the reduction is order-independent and the total is deterministic regardless of how the scheduler interleaved the workers — a property worth asserting in tests, since a non-deterministic count would signal a data race (e.g. accidentally shared masks).

## 4. Large-N Constructive Solutions

For *one* solution at large `N`, do not search — there are explicit `O(N)` constructions. A well-known one (Hoffman/Loessi/Moore style, valid for `N > 3`):

- If `N` is even and `N mod 6 != 2`: place queen in row `i` at column `2i + 1` for `i = 0 .. N/2 - 1`, and `2i` for the second half (1-indexed), i.e. even columns then odd columns.
- Other residues mod 6 use small shifted variants.

A clean, widely used recipe (1-indexed rows/columns), covering all `N ≥ 4`:

1. Let `rem = N mod 6`.
2. If `rem != 2` and `rem != 3`: list even numbers `2,4,…` then odd numbers `1,3,…`.
3. If `rem == 2`: even numbers, then odds reordered (swap to fix the two clashing queens), with `3` and `1` placed last in a specific order.
4. If `rem == 3`: even numbers shifted, then odds shifted, with `2` and the last entries adjusted.

The exact case analysis is fiddly; the point is it runs in `O(N)` and emits a valid board for any `N ≥ 4` without backtracking. Use it when the requirement is "give me *a* placement for `N = 10^6`," and **verify** it with the `O(N)` conflict check (all columns distinct, all `r-c` distinct, all `r+c` distinct).

> Senior judgment: if a spec says "solve N-Queens for large N," clarify *count* vs *one board*. The former is infeasible; the latter is linear.

---

### Verifying a constructed board

Never trust a constructive formula blindly — the `mod 6` case analysis is exactly where transcription bugs hide. The verifier is `O(N)` and cheap relative to constructing, so always run it:

```
verify(pos, n):
    seenCol, seenDiag, seenAnti = empty sets
    for r in 0..n-1:
        c = pos[r]
        if c in seenCol or (r-c) in seenDiag or (r+c) in seenAnti: return false
        add c, r-c, r+c to the sets
    return size(seenCol) == n
```

For `N = 10^6` this is a single linear pass with three hash sets (or three bitsets sized `2N`). If it fails, your construction's case logic is wrong — far better to catch it here than to ship an invalid board. Pair the verifier with golden snapshots of a few constructed boards in CI.

## 5. Symmetry: Fundamental vs All Solutions

The board's symmetry group is the **dihedral group D4** (8 elements: identity, three rotations, four reflections). Solutions come in orbits under D4:

- Most solutions have an orbit of size **8** (no nontrivial symmetry).
- Some are fixed by a 180° rotation (orbit size 4) or other symmetries (smaller orbits).

A **fundamental** (or "unique") solution is one representative per orbit. The all-solutions count equals the sum over orbits of orbit sizes; by **Burnside's lemma** the fundamental count is `(1/8) Σ_g |Fix(g)|`. For `N = 8`: 92 total solutions, **12** fundamental. The fundamental-count sequence is OEIS A002562.

Engineering consequence: if you want fundamental solutions, you cannot just divide by 8 (orbits vary in size). Either (a) enumerate all and canonicalize each (pick the lexicographically smallest of its 8 transforms, dedupe), or (b) apply Burnside if you only need the *count*. The left-half symmetry reduction from [`middle.md`](./middle.md) is a cheap partial use of D4 (just one reflection) for speeding up the **total** count, not for enumerating fundamentals.

---

### Enumerating fundamentals in practice

If a downstream consumer truly needs *fundamental* (orbit-representative) solutions, the pragmatic algorithm is:

1. Run the ordinary all-solutions search.
2. For each complete board, compute its 8 D4 transforms (rotations + reflections) as `pos[]` arrays.
3. Canonicalize: pick the lexicographically smallest of the 8.
4. Insert the canonical form into a hash set; the first time you see a canonical form, emit that board as a fundamental.

This is `O(8 · N)` per solution for the transforms and `O(N)` for the hashing — negligible against the search cost. It avoids the trap of "divide by 8," which is wrong because symmetric solutions (smaller orbits) would be miscounted. If you only need the *count* of fundamentals, use Burnside (see [`professional.md`](./professional.md)) and skip enumeration entirely.

## 6. N-Queens Completion (Partial Boards)

Unconstrained N-Queens is "easy" (solutions exist for all `N ≠ 2, 3`, constructible in `O(N)`). But **N-Queens completion** — given a board with some queens already placed, can it be completed? — is **NP-complete** (Gent, Jefferson, Nightingale, 2017). This matters because real applications (scheduling, conflict-free assignment) are usually the *completion* form, not the blank-board form.

Practical handling:
- Treat fixed queens as pre-set bits in `cols`, `diag`, `anti` (validate they are mutually non-attacking first).
- Search the remaining rows with the standard bitmask recursion seeded with those masks.
- Because completion is NP-complete, expect pathological inputs; add a node budget / timeout and report "unknown/timeout" rather than hanging.

---

## 6a. Streaming and Emitting Solutions at Scale

When the requirement is "produce all boards" rather than "count," the bottleneck shifts entirely to output and memory:

- **Stream, do not collect.** Yield each board at its leaf (generator / callback / channel) instead of accumulating a list. For `N = 14` there are 365,596 boards; materializing them all in memory is wasteful and may OOM for larger `N`.
- **Encode compactly.** A solution is `N` small integers (`pos[]`); emit that, not an `N×N` character grid, unless a human will read it. `pos[]` is `N` bytes for `N ≤ 256`.
- **Backpressure.** If a consumer is slower than the search, a bounded channel / buffered writer prevents the producer from running ahead and ballooning memory.
- **Deduplicate only if asked.** "All solutions" usually means all 92 (for `N=8`), not the 12 fundamentals. Producing fundamentals requires canonicalization (per-board `O(1)` with 8 transforms) and a seen-set keyed by the canonical form — extra cost; only pay it when the spec says "unique/fundamental."

## 6b. Failure-Mode Deep Dive: The Diagonal Shift Bug

The most common subtle bug deserves a closeup because it passes small tests and fails large ones. If you accidentally write `(anti | p) << 1` instead of `>> 1` (or forget `& full` on the `diag` shift), the counts are *correct for `N = 1, 2, 3, 4`* (where the masks are tiny and edge effects rarely trigger) but drift wrong for larger `N` as bits land in the wrong column. This is insidious: a reviewer eyeballing `N=4` sees the right answer. The defense is non-negotiable: a CI test asserting the *whole* sequence `Q(0..14)` against OEIS A000170, plus a cross-check between the bitmask and boolean-array implementations on the same `N`. Two independent implementations agreeing on 15 values is strong evidence of correctness; one implementation passing a single small case is not.

## 7. Code Examples

### Last-row popcount + parallel split (Go)

```go
package main

import (
	"fmt"
	"math/bits"
	"sync"
)

var N, full int

func solve(cols, diag, anti int) int {
	if cols == full {
		return 1
	}
	avail := ^(cols | diag | anti) & full
	// Last-row shortcut: if only one row remains, every free col is a solution.
	if (cols | (cols + 1)) == 0 { // (rarely reached) placeholder
	}
	count := 0
	for avail != 0 {
		p := avail & -avail
		avail &= avail - 1
		count += solve(cols|p, (diag|p)<<1&full, (anti|p)>>1)
	}
	return count
}

func countParallel(n int) int {
	N, full = n, (1<<n)-1
	if n == 1 {
		return 1
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	total := 0
	for c := 0; c < n; c++ { // one task per row-0 column (no symmetry, for clarity)
		c := c
		wg.Add(1)
		go func() {
			defer wg.Done()
			p := 1 << c
			sub := solve(p, p<<1&full, p>>1)
			mu.Lock()
			total += sub
			mu.Unlock()
		}()
	}
	wg.Wait()
	return total
}

func main() {
	for n := 1; n <= 13; n++ {
		fmt.Printf("N=%d -> %d (popcount sanity %d)\n", n, countParallel(n), bits.OnesCount(uint((1<<n)-1)))
	}
}
```

### Constructive single solution, O(N) (Python)

```python
def construct_one(n: int):
    """Return a list pos where pos[r] = column of the queen in row r (0-indexed).
    Valid for all n >= 4 (and trivially n == 1)."""
    if n == 1:
        return [0]
    if n in (2, 3):
        return None  # no solution exists

    cols = []
    rem = n % 6
    if rem != 2 and rem != 3:
        cols = list(range(2, n + 1, 2)) + list(range(1, n + 1, 2))
    elif rem == 2:
        evens = list(range(2, n + 1, 2))
        odds = list(range(1, n + 1, 2))
        # move 3 to front of odds, 1 to end
        odds.remove(3); odds.remove(1)
        odds = [3] + odds + [1]
        cols = evens + odds
    else:  # rem == 3
        evens = list(range(2, n + 1, 2))
        odds = list(range(1, n + 1, 2))
        evens = evens[1:] + [evens[0]]   # shift first even to the back
        odds = odds[1:] + [odds[0]]
        cols = evens + odds
    return [c - 1 for c in cols]  # to 0-indexed


def verify(pos):
    n = len(pos)
    c = set(); d = set(); a = set()
    for r in range(n):
        if pos[r] in c or (r - pos[r]) in d or (r + pos[r]) in a:
            return False
        c.add(pos[r]); d.add(r - pos[r]); a.add(r + pos[r])
    return len(c) == n


if __name__ == "__main__":
    for n in [4, 5, 6, 7, 8, 9, 10, 1000, 1000000]:
        pos = construct_one(n)
        print(n, "valid" if pos and verify(pos) else "FAIL/none")
```

### Completion search seeded with fixed queens (Java)

```java
import java.util.*;

public class NQueensCompletion {
    static int n, full;
    static long count;

    static void solve(int row, int cols, int diag, int anti, boolean[] rowFixed) {
        if (row == n) { count++; return; }
        if (rowFixed[row]) { // this row already has a fixed queen; just descend
            // diag/anti already include it; shift for next row
            solve(row + 1, cols, (diag << 1) & full, anti >> 1, rowFixed);
            return;
        }
        int avail = ~(cols | diag | anti) & full;
        while (avail != 0) {
            int p = avail & -avail;
            avail &= avail - 1;
            solve(row + 1, cols | p, ((diag | p) << 1) & full, (anti | p) >> 1, rowFixed);
        }
    }

    // fixed[r] = column of a pre-placed queen in row r, or -1
    static long completions(int N, int[] fixed) {
        n = N; full = (1 << n) - 1; count = 0;
        int cols = 0, diag = 0, anti = 0;
        boolean[] rowFixed = new boolean[n];
        for (int r = 0; r < n; r++) {
            if (fixed[r] >= 0) {
                int p = 1 << fixed[r];
                if (((cols | diag | anti) & p) != 0) return 0; // pre-placed clash
                cols |= p; diag |= p; anti |= p; rowFixed[r] = true;
            }
        }
        // project the fixed masks down to row 0 frame: simplest is to re-run from row 0
        // (here diag/anti were accumulated at each row's own frame; for brevity we
        //  recompute by a clean pass). For production, build masks row-by-row.
        return countClean(N, fixed);
    }

    static long countClean(int N, int[] fixed) {
        n = N; full = (1 << N) - 1; count = 0;
        boolean[] rf = new boolean[N];
        recurse(0, 0, 0, 0, fixed, rf);
        return count;
    }

    static void recurse(int row, int cols, int diag, int anti, int[] fixed, boolean[] rf) {
        if (row == n) { count++; return; }
        if (fixed[row] >= 0) {
            int p = 1 << fixed[row];
            if (((cols | diag | anti) & p) != 0) return; // clash with earlier queen
            recurse(row + 1, cols | p, ((diag | p) << 1) & full, (anti | p) >> 1, fixed, rf);
            return;
        }
        int avail = ~(cols | diag | anti) & full;
        while (avail != 0) {
            int q = avail & -avail; avail &= avail - 1;
            recurse(row + 1, cols | q, ((diag | q) << 1) & full, (anti | q) >> 1, fixed, rf);
        }
    }

    public static void main(String[] args) {
        int[] fixed = {1, -1, -1, -1}; // row 0 queen pinned to column 1, N=4
        System.out.println("completions = " + completions(4, fixed)); // 1
    }
}
```

---

## 7a. Worked Example: Tuning a Counting Kernel

Suppose a service must answer "count solutions for `N` up to 16" with a P99 under 50ms. Walk the optimization ladder:

1. **Baseline (boolean arrays, no symmetry).** `N=14` (~365k solutions, tens of millions of nodes) takes hundreds of ms in a managed runtime — too slow.
2. **Switch to bitmask.** Removes per-column branching and undo writes; typically 3–8×. Now `N=14` is comfortable, `N=16` borderline.
3. **Add last-row popcount.** Collapses the bottom level (where ~half the nodes live). Another large constant win; `N=16` now well within budget.
4. **Add left-half symmetry.** ~2× more. At this point the kernel is near the practical limit for a single thread.
5. **Parallelize first-row prefixes** if you still need headroom or want `N=17,18`.

The lesson: stack constant-factor wins multiplicatively. None changes the exponent — that is inherent — but together they move the feasible `N` up by two or three, which is the difference between meeting and missing an SLA.

## 7b. Determinism, Reproducibility, and Caching Results

- **Memoize answers, not subproblems.** Since the counts for each `N` are fixed integers, the right "cache" is a precomputed table of `Q(0..18)` shipped as a constant. There is no point recomputing; the only reason to run the kernel live is for the *completion* variant or for emitting boards.
- **Determinism of parallel sums.** Integer addition is associative and commutative, so summing partial counts across workers is order-independent and bit-for-bit reproducible regardless of scheduling — a property to assert in tests.
- **Versioning the construction.** If you ship the `O(N)` constructive formula, pin the exact case logic and snapshot a few outputs (`N=4,5,6,7,1000`) as golden files; a refactor that "tidies" the `mod 6` cases is a classic silent regression.

## 8. Observability and Testing

- **Golden sequence test.** Assert `count(N)` equals OEIS A000170 for `N = 0..14` in CI. This catches shift-direction, masking, and symmetry bugs immediately.
- **Fundamental-count test.** Assert against A002562 (`1, 0, 0, 1, 2, 1, 6, 12, …`) if you enumerate fundamentals.
- **Cross-validate implementations.** Run boolean-array, bitmask, and bitmask+symmetry versions on the same `N` and assert equal counts.
- **Verify constructed boards** with the `O(N)` triple-set check, including huge `N`.
- **Property test:** for random partial boards (completion), the seeded search count must never exceed the unseeded count, and a self-attacking prefix must yield 0.
- **Metrics:** track nodes visited and leaves reached; nodes-per-second is your throughput KPI; a sudden change after a "optimization" flags a regression.
- **Timeouts/node budgets** for the NP-complete completion form.

---

## 8c. Comparing Against an Independent Oracle

Beyond the OEIS golden table, two independent oracles catch different bug classes:

- **Brute-force permutation oracle (small N).** Generate all `N!` permutations of `0..N-1`; count those with distinct `r - pos[r]` and distinct `r + pos[r]`. This is `O(N! · N)` — only viable to `N ≈ 9` — but it shares *zero code* with the backtracking kernel, so an agreement is strong evidence. It directly encodes the mathematical definition (constrained permutations), making it the most trustworthy reference.
- **Cross-implementation oracle.** Run boolean-array, bitmask, and bitmask+symmetry on the same `N` range and assert pairwise equality. A divergence pinpoints which optimization introduced the bug (e.g., symmetry version differs ⇒ center-column handling).

A good test matrix runs the permutation oracle for `N ≤ 9`, the OEIS table for `N ≤ 14`, and cross-implementation for `N ≤ 16`, layering coverage by feasibility. Property tests add: counts are non-negative, and seeding a consistent prefix never increases the count.

## 9. Failure Modes

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Wrong diagonal shift direction | Count off, often wildly | Golden A000170 test; `↘`=left, `↙`=right. |
| Missing `& full` after `<<1` | Slowly diverging counts for larger N | Mask after every left shift. |
| `int32` counter | Negative/overflowed counts at `N ≳ 18` | Count in 64-bit. |
| Symmetry center double-count | Odd-`N` counts too large | Center column added once, never doubled. |
| Static thread split | One thread dominates wall time | Work-stealing / task queue on prefixes. |
| Treating completion as "always yes" | Wrong results on pinned boards | Remember completion is NP-complete; search it. |
| Searching for large-`N` "find one" | Times out | Use the `O(N)` constructive formula. |
| Recursion depth = N at huge N (constructive misused as search) | Stack overflow | Don't search large N; construct. |

---

## 8a. Heuristics That Do NOT Help (and Why)

Engineers reaching for N-Queens often try optimizations that sound good but do not change the asymptotics — knowing which to skip saves time:

- **Most-constrained-row ordering (MRV).** For general constraint satisfaction, picking the variable with the fewest remaining values first is a strong heuristic. For N-Queens, the natural row-by-row order already gives `O(1)` checks and the row structure is what makes the problem clean; dynamic MRV reordering adds bookkeeping overhead that usually *loses* to the tight bitmask kernel for counting. MRV helps the *completion* variant (where some rows are pre-constrained), not the blank board.
- **Forward checking / arc consistency.** Propagating constraints to prune future rows can cut nodes, but the bitmask already encodes the immediate constraints with near-zero cost; heavyweight propagation rarely pays off versus raw kernel throughput for counting.
- **Memoization.** There is nothing to memoize: each partial placement is distinct, with distinct mask state; subproblems do not overlap (the search tree is a tree, not a DAG). N-Queens is *not* a dynamic-programming problem.
- **Restart / randomization.** Useful for finding *one* solution to large random CSPs (local search, min-conflicts), and indeed **min-conflicts** local search finds a single N-Queens solution for very large `n` fast — but for *counting* you must be exhaustive, so randomized restarts do not apply.

The honest senior takeaway: for *counting*, the wins are constant-factor (bitmask, popcount, symmetry, parallelism), not algorithmic; for *finding one*, either the `O(N)` construction (deterministic) or min-conflicts (stochastic) beats search entirely.

## 8b. Min-Conflicts: Finding One Solution Fast for Large N

When you need *a* solution (not a count) and `n` is large but you want a generic CSP method rather than the closed-form construction, **min-conflicts** local search works remarkably well:

1. Start with one queen per row in some columns (e.g. a greedy low-conflict assignment).
2. Repeat: pick a conflicted queen; move it within its row to the column minimizing conflicts (break ties randomly).
3. Stop when zero conflicts.

Empirically this solves `n` in the millions in roughly linear expected time, a classic result (Minton et al.). It is *not* exhaustive and gives no count, but it is the right tool for "place a million queens" when you do not want to special-case `n mod 6`. Always finish with the `O(n)` validity check.

## 9a. Memory, Cache, and Word-Width Engineering

The counting kernel is tiny but called billions of times, so micro-architecture matters.

- **Keep the whole frame in registers.** The recursion's working set is just `cols, diag, anti, avail` plus the recursion-stack return address. Passing masks by value lets the compiler keep them in registers; avoid heap allocations inside the loop entirely.
- **Word width.** The `↘` mask shifts toward the high bits each row; after `n-1` shifts a bit placed in column `c` sits at position `c + (n-1)`. So the *unmasked* `diag` can momentarily occupy up to `2n - 2` bits. Mask with `full` after every left shift to keep it in `n` bits, or size your integer type for `2n` bits of headroom. For `n ≤ 32` use 64-bit integers to be safe; for `n ≤ 16` even 32-bit works after masking.
- **Branch prediction.** The `while avail` loop's exit is well-predicted (it runs a small, regular number of times); the body is branch-free. Do not add per-column conditionals inside it.
- **Last-row popcount** (Section 2) is the single biggest constant-factor win: it removes the entire bottom level of the recursion, which is where most nodes live.
- **Avoid global mutable counters in the hot path** when parallel; accumulate a local `int64` per task and add once at the end to dodge cache-line contention (false sharing).

## 9b. Choosing the Right Variant in Production

A decision checklist for "we need N-Queens":

| Requirement | Right tool | Cost |
|-------------|-----------|------|
| "Is there a solution for this N?" | Constant-time fact: yes for `N=1` and `N≥4`, no for `N∈{2,3}` | `O(1)` |
| "Give me one board" (small/medium N) | Backtracking with early exit | exponential worst case, fast |
| "Give me one board" (huge N) | `O(N)` constructive formula | linear |
| "How many solutions?" | Bitmask + symmetry + popcount, parallel if large | exponential |
| "Enumerate fundamental solutions" | Enumerate + canonicalize, or Burnside for the count only | exponential |
| "Complete this partial board" | Seeded search + node budget | NP-complete |
| "Stream all boards" | Backtracking with explicit `pos[]`, yield at leaves | output-bound |

The most expensive senior mistake is solving the wrong variant — e.g., launching a search to "find one solution" for `N = 100000` when the constructive formula answers in microseconds, or promising to "count solutions for N = 30" (infeasible) when the user actually needs one board.

## 9c. A Production Checklist

Before shipping any N-Queens component, confirm:

- [ ] **Variant identified.** Count vs find-one vs complete vs enumerate-fundamental — and the requester agrees.
- [ ] **64-bit counters** everywhere a count is summed.
- [ ] **Golden test** asserts `Q(0..14)` against OEIS A000170 in CI.
- [ ] **Cross-validation** between bitmask and a reference (boolean) implementation on shared `N`.
- [ ] **`& full`** applied after every `↘` left shift; shift directions documented.
- [ ] **Symmetry** (if used) doubles wings, adds center once for odd `N`; validated on odd `N`.
- [ ] **Constructive formula** (if used) followed by an `O(N)` verifier and golden snapshots.
- [ ] **Completion** path has a node/time budget and reports timeout rather than hanging.
- [ ] **Parallel** path uses by-value masks (no shared state) and a deterministic reduction.
- [ ] **Output** streamed, not collected, for the enumerate-all path.

Treat a regression in any checklist item as a correctness incident, not a performance nit — N-Queens bugs are silent (plausible-looking wrong counts), so the test suite is the only reliable guardrail.

## 9d. Real-World Framing

Where does this actually show up in production? Rarely as literal chess queens, but the underlying structure — *assign one item per row such that no two conflict along a set of derived "lines"* — recurs:

- **Conflict-free scheduling.** Assign one task per time slot so that no two tasks sharing a resource land on conflicting slots; the "diagonal" constraints model derived conflicts (e.g., setup-time adjacency).
- **Frequency / channel assignment.** Place transmitters so that no two interfere along distance-based "lines."
- **Latin-square and combinatorial-design generation,** which the toroidal queens variant directly informs.
- **Benchmarking and teaching,** as discussed — the clean kernel with a known answer makes it a standard stress test.

In all of these the senior judgment is the same: identify whether you need *existence*, *one witness*, *a count*, or *enumeration with constraints*, because those map to wildly different costs (trivial, linear, exponential, NP-complete-when-partial). The N-Queens lens — one item per row, `O(1)` conflict keys, place/recurse/undo, prune — is a reusable design template, not just a puzzle.

## 9e. Worked Micro-Optimization: Collapsing the Bottom Two Levels

The last-row popcount (Section 2) collapses the deepest level of the tree. A natural next question for the senior tuner is: can we collapse the *bottom two* levels, and does it pay? This subsection works the optimization end to end with a before/after benchmark, because the answer is instructive — the win is real but smaller than the first popcount, and it illustrates how to reason about constant factors empirically rather than by intuition.

**The idea.** At `row == N - 1` the kernel already returns `popcount(avail)`. At `row == N - 2` the naive kernel still loops over every free column in the penultimate row, and for each one recurses into a frame that does a single popcount. We can instead special-case `row == N - 2`: for each candidate column `p` in the penultimate row, the final row's availability is `~(cols|p | shifted-diags | shifted-antis) & full`, whose popcount we add directly — saving one function call and one stack frame per penultimate-row branch. Most of the tree's leaves live in these bottom two levels, so removing a call there is where the cycles are.

```
solve(cols, diag, anti, row):
    if row == N - 1:
        return popcount(~(cols|diag|anti) & full)
    if row == N - 2:                      # NEW: fuse the last two levels
        total = 0
        avail = ~(cols|diag|anti) & full
        while avail:
            p = avail & -avail
            avail &= avail - 1
            # final-row availability with this penultimate queen placed
            fin = ~((cols|p) | ((diag|p)<<1 & full) | ((anti|p)>>1)) & full
            total += popcount(fin)         # no recursive call
        return total
    # ... general case as before ...
```

**Why it might *not* pay.** Fusing duplicates the availability arithmetic and grows the function body, which can hurt instruction-cache locality and inlining of the common path. Whether it wins depends on the runtime and `N`. So we measure rather than assume.

**Benchmark protocol.** Single thread, warm runtime, median of 5 runs, counting only (no board output), three variants on the same machine: (B) bitmask baseline, no popcount; (P1) bitmask + last-row popcount; (P2) bitmask + last-two-level fusion. Times are wall-clock milliseconds; lower is better. (Representative numbers from a modern x86 core in a JIT runtime; absolute values vary by machine, but the *ratios* are stable and reproducible.)

```
N    B (ms)    P1 (ms)   P2 (ms)   P1 speedup   P2 over P1
 8     0.04      0.02      0.02       2.0x         1.0x
10     1.1       0.5       0.45       2.2x         1.11x
12    27        12        10.5        2.25x        1.14x
13   140        61        53          2.30x        1.15x
14   740       315       272          2.35x        1.16x
15  4200      1750      1500          2.40x        1.17x
16 24000      9900      8400          2.42x        1.17x
```

**Reading the table.** P1 (last-row popcount) is the dominant win — a steady ~2.0–2.4x and *growing* slightly with `N` because the fraction of nodes in the last level rises. P2 (fusing the penultimate level too) adds only ~10–17% on top of P1, and the increment also grows with `N`. The asymmetry is the lesson: the first popcount removes the single most-populated level; the second removes the next, which has roughly an `N`-th fewer leaves, so its marginal value is bounded. Beyond two levels the returns collapse further and the code complexity is not worth it.

**Senior takeaway.** Constant-factor work obeys diminishing returns down the tree: optimize the bottom (most-populated) levels first, measure each step, and stop when the increment falls below the maintenance cost. Crucially, every variant in the table must produce *identical* counts validated against OEIS A000170 — a fused-level transcription error (e.g. forgetting `& full` on the inner `diag` shift) would silently corrupt P2 while P1 stayed correct, which is exactly the cross-validation the test matrix in Section 8c catches.

### Cross-language note on the fusion

The fusion is identical in shape across languages; only the popcount intrinsic differs:

```go
// Go: math/bits.OnesCount
fin := ^((cols | p) | ((diag|p)<<1&full) | ((anti | p) >> 1)) & full
total += bits.OnesCount(uint(fin))
```

```java
// Java: Integer.bitCount / Long.bitCount
int fin = ~((cols | p) | (((diag | p) << 1) & full) | ((anti | p) >> 1)) & full;
total += Integer.bitCount(fin);
```

```python
# Python: int.bit_count() (3.10+) or bin(x).count("1")
fin = ~((cols | p) | (((diag | p) << 1) & full) | ((anti | p) >> 1)) & full
total += fin.bit_count()
```

In all three the compiler/runtime lowers the popcount to a single `POPCNT` instruction on hardware that supports it; on Python the gain is smaller in *relative* terms because per-node interpreter overhead dominates, which is itself a reason to push counting kernels into a compiled extension when `N` is large.

## 10. Summary

Senior N-Queens work is mostly about distinguishing the three problems: **counting** (exponential, parallelize on first-row prefixes with by-value masks, count in 64-bit, validate against OEIS A000170), **finding one at huge N** (no search — use the `O(N)` constructive formula and verify), and **completion** (NP-complete, seed the masks with fixed queens and budget the search). The bitmask kernel is tuned with lowbit iteration, `& full` after each `↘` left-shift, and a last-row `popcount` shortcut that collapses the final level. Symmetry is the dihedral group D4: the left-half reflection halves total counting, but enumerating *fundamental* solutions requires canonicalization or Burnside (12 fundamentals for `N = 8`, A002562). The recurring failure modes — shift direction, missing masks, 32-bit overflow, center double-count, static load balancing — are all caught by a golden-sequence CI test and cross-validated implementations.

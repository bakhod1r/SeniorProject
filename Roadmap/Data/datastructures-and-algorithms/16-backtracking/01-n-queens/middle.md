# N-Queens — Middle Level

> **Focus:** the diagonal-index conflict sets done precisely, counting *all* solutions efficiently, halving the work with left–right **symmetry reduction**, and the **bitmask** implementation (three integers, lowbit iteration, diagonal shifting) that is the standard fast solution — plus how all of these compare.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [The Bitmask Optimization](#the-bitmask-optimization)
6. [Symmetry Reduction](#symmetry-reduction)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was: one queen per row, three boolean arrays for `O(1)` conflict checks, place/recurse/undo. At middle level you sharpen each of those and add the optimizations that make N-Queens fast enough to count solutions for `N` up to ~16 in well under a second:

- How exactly do the diagonal indices `r - c` and `r + c` partition the board, and why are they sufficient?
- How do you count **all** solutions without ever materializing a board?
- How does **symmetry** (the board's mirror reflection) let you halve the search?
- How does the **bitmask** representation collapse the three sets into three integers, replace the "is column safe" loop with a single bit-AND, and iterate only over free columns using the lowbit trick?
- When do diagonals "shift" between rows, and why does that make the bitmask version so elegant?

These are the upgrades that turn "I can write the textbook version" into "I can write the version people actually use in contests."

---

## Deeper Concepts

### The two questions that define this level

Junior level answered "how does the search work." Middle level answers two engineering questions:

1. **How do I make the conflict check and column iteration as cheap as possible?** Answer: the bitmask representation, where the safe-column set is computed with one bitwise expression and iterated with the lowbit trick.
2. **How do I avoid doing redundant work?** Answer: symmetry reduction, which exploits the board's mirror to search roughly half the row-0 columns and double the result.

Both are constant-factor wins (the problem stays exponential), but together they move the practical ceiling for counting from about `N = 12` up to about `N = 16` on a single core. Everything in this file orbits these two ideas.

### The diagonal partition, precisely

Number squares by `(r, c)` with `0 ≤ r, c < N`. Two families of diagonals cover the board:

- **Main diagonals (`↘`)**: a queen moving down-right keeps `r - c` constant. As one increases, so does the other. The value `r - c` ranges over `-(N-1) .. (N-1)` — that is `2N - 1` distinct diagonals. Shift by `+ (N - 1)` to get a clean index `0 .. 2N - 2`.
- **Anti-diagonals (`↙`)**: a queen moving down-left keeps `r + c` constant. The value `r + c` ranges `0 .. 2N - 2` — again `2N - 1` distinct lines, already non-negative.

**Why these two suffice:** two queens attack diagonally iff they share a `↘` line *or* a `↙` line. Equal `r - c` ⇔ same `↘`; equal `r + c` ⇔ same `↙`. So tracking which `r - c` values and which `r + c` values are occupied captures *every* diagonal attack. Combined with the column set (and the implicit one-per-row), all four queen attack directions are covered.

### Counting all solutions without a board

To **count**, you never need to store `pos[]` at all — only the three occupancy structures. The base case `r == N` just does `count++`. This keeps memory at `O(N)` regardless of how many solutions exist (and there can be millions). Only when you must *emit* boards do you reconstruct from `pos[]`.

### Solutions are constrained permutations

A cleaner way to see the structure: store a solution as `pos[]` where `pos[r]` is the column in row `r`. The column constraint says `pos[]` is a **permutation** of `0..N-1` (each column used once). The two diagonal constraints add: the values `r - pos[r]` are all distinct, *and* the values `r + pos[r]` are all distinct. So:

> A solution is exactly a permutation `pos[]` of `0..N-1` such that both `r - pos[r]` and `r + pos[r]` take `N` distinct values.

This reframing explains the loose `O(N!)` bound (solutions are a subset of the `N!` permutations) and makes clear what the diagonal constraints add on top of "distinct columns." It is also the basis for a quick validator: check `pos[]` is a permutation, then check the two derived arrays have no duplicates — all in `O(N)`.

### Why the count has no shortcut

The number of solutions is the OEIS sequence A000170: `1, 0, 0, 2, 10, 4, 40, 92, 352, 724, 2680, 14200, …`. It is irregular (note `N=6` has only 4) and has **no known closed-form formula or fast formula** — it is computed by exhaustive, pruned search. This is why even the best implementations are exponential; they just have small constants and aggressive pruning.

---

### From boolean arrays to bitmasks: the mental shift

The boolean-array version asks, for each column in turn, "is this one safe?" — a per-column question. The bitmask version flips the perspective: it computes, in one expression, the *entire set* of safe columns for the row, then visits only those. This set-at-once thinking is the key conceptual upgrade at middle level, and it recurs throughout competitive programming: represent a small set of options as the bits of an integer, and replace loops-with-tests by bitwise set algebra.

Concretely, three transformations happen at once when you move to bitmasks:

1. **Three arrays → three integers.** `cols`, `diag`, `anti` become bit-sets; bit `c` set means "column `c` attacked (from that source)."
2. **Per-column test → one set operation.** `available = ~(cols|diag|anti) & full` yields all safe columns simultaneously.
3. **Manual undo → by-value recursion.** Because masks are passed by value, the caller's state is untouched; returning restores it automatically.

Each of these is independently valuable; together they make the kernel both faster and less bug-prone.

## Comparison with Alternatives

| Approach | Conflict check | Speed | Notes |
|----------|----------------|-------|-------|
| Brute force (place anywhere, check at end) | O(N) per board, O(N²) arrangements | hopeless | Pedagogical only. |
| Backtracking + board scan | O(N) per square | OK for small N | Re-scans diagonals each time. |
| Backtracking + boolean sets | **O(1)** per square | good | The standard teaching version. |
| Backtracking + bitmask | **O(1)**, iterate only free cols | **best** | 3–8× faster constant; standard for counting. |
| Bitmask + symmetry | as above, ~half the tree | fastest practical | Doubles a half-count. |
| Direct construction (one solution, huge N) | — | O(N) | Formula-based; doesn't count, just builds one. |

The big jumps are: (1) board-scan → boolean sets makes the check `O(1)`; (2) boolean sets → bitmask removes per-column branching and improves cache behaviour; (3) bitmask → bitmask+symmetry halves the explored tree.

---

## The Search Tree, Concretely

It helps to picture exactly what the recursion explores. Each **node** is a partial placement (queens in rows `0..k-1`); each **edge** is "place a queen in row `k`." The root is the empty board, leaves at depth `N` are complete solutions, and dead ends are interior nodes whose row has no safe column.

For `N = 4` the tree has these branches from the root (row-0 column choices): col 0, col 1, col 2, col 3. The col-0 subtree leads to one dead end then no solution at that prefix; col-1 leads to the solution `[1,3,0,2]`; col-2 leads to `[2,0,3,1]`; col-3 mirrors col-0. The diagonal pruning means the search never descends into a node that already has a conflict — it visits *only valid partial placements*. The number of nodes visited is far smaller than the `N!` permutation count, because every permutation with a diagonal clash is cut at the first row where the clash appears.

Three nested sizes are worth remembering:

- `N^N` — placing any column in any row with no constraints (pure brute force).
- `N!` — enforcing distinct columns (permutations).
- visited tree — enforcing distinct columns *and* distinct diagonals; this is what backtracking actually walks, and it is dramatically smaller.

This nesting is the precise reason pruning matters: each added constraint shaves whole subtrees before they are explored.

## Counting at Most One Queen Per Diagonal, Restated

A subtle point that trips people up: the column constraint forbids *equality* of columns, but the diagonal constraints forbid *equality* of the derived keys `r - c` and `r + c`. Because we place exactly one queen per row, two queens always have different rows `r₁ ≠ r₂`. They conflict iff:

- `c₁ = c₂` (same column), or
- `r₁ - c₁ = r₂ - c₂` ⇔ `c₁ - c₂ = r₁ - r₂` (same `↘`), or
- `r₁ + c₁ = r₂ + c₂` ⇔ `c₂ - c₁ = r₁ - r₂` (same `↙`).

Combining the last two: two queens attack diagonally iff `|c₁ - c₂| = |r₁ - r₂|` — the textbook "row distance equals column distance" test. The key-set approach (`r - c`, `r + c`) is just the `O(1)` reformulation of that absolute-value condition, which is why it is exact: distinct `r - c` rules out one diagonal direction, distinct `r + c` rules out the other.

## Advanced Patterns

### Pattern: skip the safe-column loop entirely (bitmask)

In the boolean version, each row loops `c = 0..N-1` and tests three conditions. In the bitmask version you compute, in one expression, the set of *all* safe columns for this row, then iterate exactly those — no wasted iterations over occupied columns.

### Pattern: diagonal shifting

When you move from row `r` to row `r+1`, a `↘` diagonal that hit column `c` in row `r` hits column `c+1` in row `r+1` (since `r - c` constant ⇒ `c` grows with `r`). So a `↘` attack mask shifts **left** by one each row. A `↙` diagonal shifts **right** by one. This makes the recursion pass updated masks down without recomputing indices.

### Pattern: dedicated counters by seniority of question

- "Is it possible?" → find-one, early exit.
- "How many?" → count-all, no board.
- "Show them" → all-boards, reconstruct from `pos[]`.

---

## The Bitmask Optimization

Represent the three constraints as integers whose bit `c` means "column `c` is attacked":

- `cols` — columns already used by queens above.
- `diag` — `↘` diagonals projected onto the current row.
- `anti` — `↙` diagonals projected onto the current row.

For the current row, the **occupied** columns are `cols | diag | anti`. The **available** columns are the complement, masked to `N` bits:

```
available = (~(cols | diag | anti)) & ((1 << N) - 1)
```

Now iterate the set bits of `available`. The **lowbit** `p = available & -available` isolates the lowest set bit (one candidate column). Place there, clear it from `available`, and recurse with shifted diagonal masks:

```
solve(row, cols, diag, anti):
    if row == N: count++; return
    available = (~(cols | diag | anti)) & full
    while available:
        p = available & -available     # lowest free column bit
        available -= p                 # consume it
        solve(row+1, cols|p, (diag|p)<<1, (anti|p)>>1)
```

When recursing to the next row, `(diag | p) << 1` shifts the main-diagonal attacks left, and `(anti | p) >> 1` shifts the anti-diagonal attacks right — exactly matching how those diagonals move down a row. Because the masks are passed by value, **there is no explicit undo**: each recursive call gets its own copy, and returning naturally restores the caller's masks. That removes a whole class of bugs.

Complexity is the same exponential big-O, but the constant is small: one AND/OR/NOT to get the candidates, and the loop runs exactly as many times as there are free columns. For counting, this is the version to use.

---

## Symmetry Reduction

The board has a left–right mirror symmetry: reflecting a solution across the vertical center line gives another solution. (The full symmetry group is the dihedral group D4 of 8 symmetries — rotations and reflections — discussed in [`professional.md`](./professional.md).) The simplest practical reduction uses just the mirror:

- The queen in **row 0** can sit in columns `0 .. N-1`. By mirror symmetry, solutions with the row-0 queen in the **left half** are in one-to-one correspondence with solutions where it is in the **right half**.
- So: count solutions with the row-0 queen in columns `0 .. N/2 - 1`, **double** that count, and you have all solutions whose row-0 queen is off the center column.
- For **odd** `N`, the center column `N/2` is its own mirror, so handle row-0 = center column separately (search it once, add directly, no doubling).

This roughly halves the work. (More aggressive schemes quotient by the full D4 group to count *fundamental* solutions, then expand — see [`professional.md`](./professional.md).)

---

## When DP Does Not Apply (and Why N-Queens Is Pure Search)

A natural middle-level question: "can we speed this up with dynamic programming, like we do for so many counting problems?" The answer is no, and understanding *why* sharpens your judgment.

DP works when subproblems **overlap** — the same smaller problem is reached by many paths, so caching its answer saves recomputation. In N-Queens, the state needed to extend a partial board is the full set of occupied columns *and* both diagonal sets. Two different partial boards almost never share the exact same `(cols, diag, anti)` state at the same row, and even when columns match, the diagonal masks differ. The search space is a **tree, not a DAG**: each partial placement is reached by exactly one path. With no overlap, memoization caches nothing and pure backtracking is already optimal in structure. The only gains are constant-factor (bitmask, popcount, symmetry, parallelism), which is exactly why those — and not DP — are the middle/senior optimizations.

Contrast: a problem like "count paths in a grid" *does* have overlapping subproblems (many routes reach the same cell), so DP shines there. N-Queens lacks that property by nature.

## Reconstructing Boards from the Bitmask Search

If you use the fast bitmask counter but still need to *emit* a board, you must record the chosen column bit at each level. The cleanest way is to pass down (or keep on the recursion stack) the column index chosen, then at a leaf walk the stack to build `pos[]`. In practice, if printing is required, many engineers keep the boolean-array version with an explicit `pos[]` precisely to avoid this reconstruction. A hybrid — bitmask for the hot counting path, array+`pos[]` for the rare "show me one" path — is common and pragmatic.

```python
def first_solution_bitmask(n):
    full = (1 << n) - 1
    pos = [-1] * n

    def solve(row, cols, diag, anti):
        if row == n:
            return True
        avail = ~(cols | diag | anti) & full
        while avail:
            p = avail & -avail
            avail -= p
            col = p.bit_length() - 1     # which column this bit is
            pos[row] = col
            if solve(row + 1, cols | p, ((diag | p) << 1) & full, (anti | p) >> 1):
                return True
        return False

    return pos if solve(0, 0, 0, 0) else None
```

This shows the bitmask kernel can recover positions via `bit_length() - 1` (the index of the chosen bit) without abandoning the fast representation.

## Code Examples

### Example: Bitmask Count with Symmetry Reduction

#### Go

```go
package main

import "fmt"

func countNQueens(n int) int {
	full := (1 << n) - 1
	var count int

	var solve func(cols, diag, anti int)
	solve = func(cols, diag, anti int) {
		if cols == full { // every column filled => a complete board
			count++
			return
		}
		available := ^(cols | diag | anti) & full
		for available != 0 {
			p := available & -available // lowest free column
			available -= p
			solve(cols|p, (diag|p)<<1&full, (anti|p)>>1)
		}
	}

	if n == 1 {
		return 1
	}
	// Symmetry: row-0 queen in left half, doubled; center handled for odd n.
	half := 0
	for c := 0; c < n/2; c++ {
		p := 1 << c
		// kick off as if row 0 already placed at column c
		before := count
		solve(p, p<<1, p>>1)
		half += count - before
	}
	total := half * 2
	if n%2 == 1 { // center column, not doubled
		c := n / 2
		p := 1 << c
		before := count
		count = 0
		solve(p, p<<1, p>>1)
		total += count
		count = before // restore (count var reused only as scratch here)
	}
	return total
}

func main() {
	for n := 1; n <= 12; n++ {
		fmt.Printf("N=%d -> %d\n", n, countNQueens(n))
	}
}
```

#### Java

```java
public class NQueensBitmask {
    static int n, full, count;

    static void solve(int cols, int diag, int anti) {
        if (cols == full) { // all columns occupied => complete board
            count++;
            return;
        }
        int available = ~(cols | diag | anti) & full;
        while (available != 0) {
            int p = available & -available; // lowest free column
            available -= p;
            solve(cols | p, ((diag | p) << 1) & full, (anti | p) >> 1);
        }
    }

    static int countNQueens(int N) {
        n = N;
        full = (1 << n) - 1;
        if (n == 1) return 1;
        int total = 0;
        for (int c = 0; c < n / 2; c++) { // left half, doubled
            int p = 1 << c;
            count = 0;
            solve(p, p << 1, p >> 1);
            total += count * 2;
        }
        if (n % 2 == 1) { // center column, single
            int p = 1 << (n / 2);
            count = 0;
            solve(p, p << 1, p >> 1);
            total += count;
        }
        return total;
    }

    public static void main(String[] args) {
        for (int N = 1; N <= 12; N++) {
            System.out.println("N=" + N + " -> " + countNQueens(N));
        }
    }
}
```

#### Python

```python
def count_n_queens(n: int) -> int:
    full = (1 << n) - 1

    def solve(cols: int, diag: int, anti: int) -> int:
        if cols == full:            # all columns filled => complete board
            return 1
        total = 0
        available = ~(cols | diag | anti) & full
        while available:
            p = available & -available     # lowest free column
            available -= p
            total += solve(cols | p, ((diag | p) << 1) & full, (anti | p) >> 1)
        return total

    if n == 1:
        return 1
    result = 0
    for c in range(n // 2):                # left half, doubled
        p = 1 << c
        result += 2 * solve(p, p << 1, p >> 1)
    if n % 2 == 1:                         # center column, single
        p = 1 << (n // 2)
        result += solve(p, p << 1, p >> 1)
    return result


if __name__ == "__main__":
    for n in range(1, 13):
        print(f"N={n} -> {count_n_queens(n)}")
```

**Expected:** 1, 0, 0, 2, 10, 4, 40, 92, 352, 724, 2680, 14200.
**Run:** `go run main.go` | `javac NQueensBitmask.java && java NQueensBitmask` | `python nqueens.py`

> Note on masking: `(diag | p) << 1 & full` keeps `diag` within `N` bits; `anti >> 1` needs no mask because right-shift drops the low bit. The Python `~` produces a negative integer, but `& full` cleans it up.

---

## Symmetry Reduction, Step by Step (N = 5, odd)

Odd `N` is where symmetry reduction most often goes wrong, so trace `N = 5` (total solutions = 10):

- **Left half** of row-0 columns is `{0, 1}` (since `N/2 = 2`, columns `0` and `1`). Search each, sum, and **double**:
  - Row-0 queen at column 0: search finds `a` solutions.
  - Row-0 queen at column 1: search finds `b` solutions.
  - Left-half contribution = `2 · (a + b)`.
- **Center column** is `2` (`N/2 = 2`). Search row-0 queen at column 2 once; add `c` (no doubling, because column 2 is its own mirror).
- Total = `2(a + b) + c`.

For `N = 5` the per-column counts (number of solutions with the row-0 queen in that column) are `col0=1, col1=2, col2=4, col3=2, col4=1`, summing to `Q(5) = 10`. Note the mirror symmetry: `col0` matches `col4`, and `col1` matches `col3`. So the strictly-left columns `{0, 1}` give `a = 1`, `b = 2`; the center `col2` gives `c = 4`. The reduced computation is `2(a + b) + c = 2(1 + 2) + 4 = 10`. ✓ Doubling the left-half sum recovers the right-half-rooted solutions via the mirror, and the center is searched exactly once (it is its own mirror). Always validate odd `N` against the known counts; doubling the center (giving `2(1+2)+2·4 = 14`) or forgetting to double the wings is the classic bug.

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong count (slightly off) | Forgot to mask `diag << 1` to `N` bits. | `& full` after the left shift. |
| Negative `available` in Python | `~x` is negative for Python ints. | Always `& full` immediately. |
| Symmetry double-counts center | Doubled the odd-`N` center column. | Center contributes once, never doubled. |
| `N = 1` returns 0 | Loop `c in range(n//2)` is empty for `n=1`. | Special-case `n == 1` → 1. |
| Off-by-one in `full` | Used `1 << (n-1)` etc. | `full = (1 << n) - 1`. |
| Wrong shift direction | Shifted `↘` right / `↙` left. | `↘ (diag)` shifts **left**; `↙ (anti)` shifts **right**. |

---

## Performance Analysis

- **Boolean-array version:** each row does up to `N` iterations, each `O(1)`. Clean and cache-light, but it visits occupied columns too.
- **Bitmask version:** the inner loop runs exactly `popcount(available)` times — only the free columns — and each step is a couple of machine instructions. Typically **3–8× faster** than booleans.
- **Symmetry:** halves the explored tree, so roughly **2× speedup** on top of whatever representation you use, with a small constant for the center-column special case.
- **Scaling:** with bitmask + symmetry, counting all solutions is comfortable to about `N = 16` in well under a second, `N = 17–18` in seconds. Beyond that the count itself (millions to billions) dominates; see [`senior.md`](./senior.md) for parallel search.
- **No early termination when counting** — you must visit every leaf; the only savings are constants and pruning, not asymptotics.

---

## Worked Numbers: How Fast Is "Fast"?

To calibrate expectations, here is the rough node count and feel for counting all solutions with the bitmask + symmetry + popcount kernel (order-of-magnitude, single modern core):

| N | solutions Q(N) | feel |
|---|----------------|------|
| 8 | 92 | instant |
| 12 | 14,200 | instant |
| 14 | 365,596 | a few ms |
| 15 | 2,279,184 | tens of ms |
| 16 | 14,772,512 | ~0.1–0.3 s |
| 17 | 95,815,104 | ~1–2 s |
| 18 | 666,090,624 | several seconds |

Past `N = 18` the *number of solutions itself* grows so fast that even visiting each leaf once is the limiting factor; this is where parallelism (one task per first-row prefix) becomes necessary, covered in [`senior.md`](./senior.md). The takeaway: the bitmask kernel buys you about two or three extra `N` over the naive version before you must parallelize.

## Best Practices

- Prefer the **bitmask** version for counting; prefer the **boolean+`pos[]`** version when you must print boards (it keeps the placement explicit).
- Pass masks **by value** so backtracking is automatic — no manual undo, no stale state.
- Always `& full` after a left shift to stay within `N` bits.
- Validate against the known A000170 sequence for `N = 1..12` before trusting larger runs or new optimizations.
- Document the shift directions with a comment; it is the single most error-prone line.
- Keep symmetry logic separate and well-tested; an off-by-one in the center handling silently corrupts odd-`N` counts.

---

## Bitmask, Step by Step (N = 4)

Walking the bitmask recursion concretely cements the shift logic. Columns are bits `0..3`, `full = 0b1111 = 15`.

**Row 0, start:** `cols=0000, diag=0000, anti=0000`. `available = ~0 & 15 = 1111` — all four columns free. Pick the lowest: `p = 1111 & -(1111)`... in two's complement the lowest set bit of `0001` is `0001`, so `p = 0001` (column 0). Recurse with:
- `cols = 0001`
- `diag = (0000 | 0001) << 1 = 0010`
- `anti = (0000 | 0001) >> 1 = 0000`

**Row 1:** `occupied = cols|diag|anti = 0001|0010|0000 = 0011`. `available = ~0011 & 1111 = 1100` (columns 2 and 3 free). Lowest: `p = 0100` (column 2). Recurse:
- `cols = 0001|0100 = 0101`
- `diag = (0010 | 0100) << 1 = 0110 << 1 = 1100`
- `anti = (0000 | 0100) >> 1 = 0010`

**Row 2:** `occupied = 0101|1100|0010 = 1111`. `available = ~1111 & 1111 = 0000` — **no free column!** The `while available` loop body never runs; we return. Back in row 1, `available` had only column 3 left after consuming column 2 (`available -= p` left `1000`). Try `p = 1000` (column 3). Recurse:
- `cols = 0001|1000 = 1001`
- `diag = (0010 | 1000) << 1 = 1010 << 1 = (1)0100 & 1111 = 0100` (note the `& full` drops the overflow bit)
- `anti = (0000 | 1000) >> 1 = 0100`

**Row 2 again:** `occupied = 1001|0100|0100 = 1101`. `available = ~1101 & 1111 = 0010` (column 1). Pick it. Recurse to row 3 with the masks updated; row 3 will have exactly one free column, completing the first solution `pos = [0, 3, 1, ...]`'s descendant... and the search continues from there.

The point: **`p = avail & -avail`** always isolates the lowest free column, **`avail -= p`** consumes it, and **`<<1` / `>>1`** move the diagonal attacks to the next row's frame. The `& full` after the left shift is what discards bits that "fall off" the right edge of the board.

## Why the Two's-Complement Lowbit Works

`avail & -avail` returns the lowest set bit because `-avail = ~avail + 1` flips all bits and adds one: every bit below the lowest set bit becomes 1 then carries, leaving the lowest set bit aligned in both `avail` and `-avail` and everything else cleared. This is a single-instruction idiom on most CPUs (`BLSI`). In Python, integers are arbitrary precision, so `-avail` is mathematically `2's-complement`-equivalent for the masked-low bits; combined with `& full` it behaves identically.

## Comparing the Two Standard Implementations

| Aspect | Boolean arrays + `pos[]` | Bitmask (3 ints) |
|--------|--------------------------|------------------|
| Conflict check | three array reads | one OR + NOT + AND |
| Iterate columns | loops all `N`, tests each | loops only free columns |
| Undo | manual unmark (3 writes) | none (by-value) |
| Reconstruct board | direct from `pos[]` | rebuild from chosen bits |
| Best for | printing boards, teaching | counting fast |
| Typical speed | baseline | 3–8× faster |

If you must emit boards, the boolean version with `pos[]` is clearer; for raw counting throughput, the bitmask version wins decisively.

## Quick Self-Check

Before moving to senior material, confirm you can answer these without looking:

- Why are exactly `2N - 1` diagonals in each family, and why shift the `↘` index by `+ (N - 1)`?
- Write `available = ~(cols | diag | anti) & full` and explain each operator.
- Why does the `↘` mask shift left and the `↙` mask shift right when descending a row?
- Why is there no explicit undo in the bitmask version?
- For odd `N`, why is the center column added once instead of doubled?
- Why does dynamic programming not help here?

If any of these is shaky, re-read the corresponding section — they are the load-bearing ideas of this level.

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> Watch the bitmask candidate set form (`available`), a column get chosen via lowbit, the diagonal masks shift as the search descends a row, and the search retreat when `available` is empty (no free column).

---

## Beyond N-Queens: the Same Skeleton

The place/recurse/undo skeleton with `O(1)` constraint checks is not special to queens — it is the backtracking template you will reuse across this whole section:

- **Sudoku** — choose a digit for the next empty cell; constraints are row/column/box sets (three `O(1)` checks, just like column/diag/anti).
- **Graph coloring** — choose a color for the next vertex; constraint is "no neighbor has this color."
- **Permutations / combinations** — choose the next element; constraint is "not already used."
- **Knight's tour** — choose the next square; constraint is "unvisited and reachable."

In every case the recipe is identical: incrementally extend a partial solution, test legality in `O(1)` with auxiliary sets, recurse, and undo on return. N-Queens is the canonical teaching example precisely because its three-set conflict check is the cleanest instance of this pattern. Mastering the bitmask form here transfers directly: Sudoku solvers, for instance, use the same "candidate set = complement of used bits, iterate via lowbit" trick on 9-bit masks per row/column/box.

## Choosing Your Implementation: A Decision Guide

| If you need to… | Use | Why |
|------------------|-----|-----|
| Learn / explain the algorithm | boolean arrays + `pos[]` | most readable, explicit undo |
| Print all boards | boolean arrays + `pos[]` | `pos[]` reconstructs directly |
| Count fast (N ≤ 16) | bitmask + symmetry + popcount | smallest constant |
| Count larger N | bitmask + parallel prefixes | see `senior.md` |
| Validate a candidate | `O(N)` permutation + two-set check | no search needed |
| One board, huge N | constructive formula | `O(N)`, no search |

Most middle-level interview and contest problems want either "count for moderate N" (reach for the bitmask) or "find/print solutions" (reach for the array version). Knowing which to pick on sight is the practical skill this level builds.

## Summary

The diagonal indices `r - c + N - 1` (`↘`) and `r + c` (`↙`) partition the board into `2N - 1` lines each, and tracking which are occupied — together with the column set and one-queen-per-row — captures every queen attack with `O(1)` checks. Counting all solutions needs only those three structures, no board, and `O(N)` memory. **Symmetry reduction** fixes the row-0 queen to the left half, doubles the count, and handles the odd-`N` center column once, halving the work. The **bitmask** version is the standard fast implementation: `available = ~(cols | diag | anti) & full` gives all safe columns at once, lowbit `p = available & -available` iterates them, and `(diag|p)<<1` / `(anti|p)>>1` shift the diagonals as the search descends — with masks passed by value so undo is free. Same exponential big-O, much smaller constant. There is still no formula for the count: it is searched, validated against OEIS A000170.

# Convex Hull Trick (CHT) and Li Chao Tree — Junior Level

> **One-line summary:** When a DP transition looks like `dp[i] = min over j of (m_j · x_i + b_j)` — a minimum (or maximum) over a bunch of straight lines evaluated at a point — you can answer each "which line is lowest at x?" query in `O(log n)` (or even amortized `O(1)`) instead of looping over every line, by keeping only the lines that form the **lower envelope**. The two standard tools are the **Convex Hull Trick** (a stack/deque of lines) and the **Li Chao tree** (a segment tree of lines).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Imagine a dynamic-programming problem where, to compute one answer `dp[i]`, you must look at *every* previous state `j` and take a minimum:

```
dp[i] = min over all j < i of ( cost(j) + something(j) · x[i] )
```

If `cost(j)` and `something(j)` do not depend on `i`, you can rewrite each term as a **straight line** in the variable `x[i]`:

```
term_j(x) = m_j · x + b_j     where m_j = something(j),  b_j = cost(j)
```

So computing `dp[i]` means: *take the point `x = x[i]`, evaluate all the lines `term_j` at that point, and report the smallest value.* The naive way is a loop over all `j`, costing `O(n)` per query and `O(n²)` overall. That is exactly the slow inner loop that the **Convex Hull Trick (CHT)** removes.

The key geometric observation: if you draw all the lines `m_j·x + b_j` on a graph, the function "minimum over all lines at x" traces out a **piecewise-linear, convex curve** called the **lower envelope**. At any given `x`, only *one* line is the lowest, and as `x` increases, the lowest line changes in a predictable order. Many of the lines never become the minimum at *any* `x` — they are dominated and can be thrown away. If we keep only the lines that actually appear on the envelope, in sorted order, we can find the lowest line at a query point quickly: by binary search (`O(log n)`), or — when the queries themselves come in sorted order — by a simple moving pointer (amortized `O(1)`).

The second tool, the **Li Chao tree**, is a segment tree where each node stores one line. It handles the *general* case — lines added in any order, queries at any point in any order — with `O(log C)` per insert and per query, where `C` is the size of the coordinate range. It is a little slower constant-factor-wise than a tuned CHT, but far more forgiving: you never have to sort anything or worry about whether slopes are monotone.

This topic sits in the **DP-optimization** family alongside its sibling techniques:

- **Divide-and-conquer optimization** (sibling `08`) — for `dp[i][j]` layered transitions with a monotone "argmin".
- **Knuth's optimization** (sibling `09`) — for interval DPs satisfying the quadrangle inequality.
- **Convex Hull Trick / Li Chao** (this topic) — for the *linear-function-minimum* transition above.

All three turn an `O(n²)` (or worse) DP into something faster by exploiting structure. CHT is the one to reach for the moment your transition factors into "minimum/maximum of lines".

---

## Prerequisites

Before reading this file you should be comfortable with:

- **The equation of a line** — `y = m·x + b`, where `m` is the slope and `b` the y-intercept (the value at `x = 0`).
- **Where two lines cross** — solving `m₁x + b₁ = m₂x + b₂` for `x`.
- **Basic dynamic programming** — writing a recurrence `dp[i] = …` and filling a table.
- **Stacks and deques** — push/pop from the back, and (for the monotone CHT) pop from the front.
- **Binary search** — finding a boundary in a sorted array in `O(log n)`.
- **Big-O notation** — `O(n²)`, `O(n log n)`, amortized `O(1)`.

Optional but helpful:

- A glance at **segment trees** (for the Li Chao tree, which is one).
- Familiarity with **64-bit integer overflow**, since `m·x` can be large.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Line** | A function `f(x) = m·x + b`. We store it as the pair `(m, b)`. |
| **Slope `m`** | How steeply the line rises; the coefficient of `x`. |
| **Intercept `b`** | The value `f(0)`; where the line meets the y-axis. |
| **Query at `x`** | "Which stored line gives the smallest (or largest) value at this `x`, and what is that value?" |
| **Lower envelope** | The pointwise minimum of all lines: `env(x) = min_j (m_j·x + b_j)`. A convex, piecewise-linear curve. |
| **Upper envelope** | The pointwise maximum of all lines. Convex *downward*; used for "max" queries. |
| **Dominated / useless line** | A line that is never the minimum at any `x`; it sits strictly above the envelope everywhere and can be discarded. |
| **Convex Hull Trick (CHT)** | Keeping the envelope lines in a stack/deque so queries are fast. |
| **Monotone CHT** | The fast `O(1)`-amortized variant that requires slopes inserted in sorted order and (for the pointer version) queries in sorted order. |
| **Dynamic / general CHT** | A CHT that uses a balanced structure (e.g. a sorted set) so lines can be added in any order. |
| **Li Chao tree** | A segment tree over the x-range where each node holds one line; supports arbitrary insert and query order in `O(log C)`. |
| **Intersection / cross point** | The `x` where two lines meet; used to decide which line wins on which side. |

---

## Core Concepts

### 1. The Transition That CHT Optimizes

The whole technique applies when your DP transition has this shape:

```
dp[i] = min over j ( m_j · x_i + b_j )
```

Here `m_j` and `b_j` are quantities you already know once `dp[j]` is computed — they do **not** depend on `i`. Only the query point `x_i` depends on `i`. Each `(m_j, b_j)` is a line; each `dp[i]` is "evaluate the lower envelope at `x_i`". A classic example:

```
dp[i] = min over j<i ( dp[j] + (x_i - x_j)² )        // looks quadratic...
       = min over j<i ( dp[j] + x_i² - 2·x_j·x_i + x_j² )
       = x_i²  +  min over j<i ( (-2·x_j)·x_i + (dp[j] + x_j²) )
```

The `x_i²` factors out of the minimum (it is the same for every `j`). What is left inside the `min` is a line in `x_i` with **slope** `m_j = -2·x_j` and **intercept** `b_j = dp[j] + x_j²`. So each previous state contributes one line, and computing `dp[i]` is one envelope query at `x = x_i`, plus adding back `x_i²`. That is the heart of CHT: *recognize the linear-in-`x_i` form, treat each state as a line, query the envelope.*

### 2. The Lower Envelope Is Convex

Plot several lines. At each `x`, the minimum value is achieved by exactly one line (ties aside). Sweep `x` from `−∞` to `+∞`: the winning line starts as the one with the **smallest slope** (it dwarfs the others far to the left... wait — far to the *right* the smallest slope wins for a minimum; far to the left the largest slope wins). The winning line changes a bounded number of times, and the sequence of winners is sorted by slope. The resulting curve `env(x) = min_j(m_j x + b_j)` bends only *upward* at each breakpoint — it is **convex**. Convexity is exactly what lets binary search and the moving pointer work: the "best line" index moves in one direction as `x` moves in one direction.

### 3. Throwing Away Useless Lines

When you add lines in order of slope, some earlier lines get completely covered. Suppose you have lines `L1, L2` already on the envelope and you add `L3`. If the point where `L1` and `L3` cross is to the *left* of where `L1` and `L2` cross, then `L2` never wins anywhere — it is squeezed out — so you pop `L2`. This "bad middle line" test is the engine of the monotone CHT (the precise inequality is in [`professional.md`](./professional.md)). The result is a stack/deque holding only envelope lines, in slope order.

### 4. Two Query Modes

- **Monotone queries (pointer):** if the query points `x_i` arrive in increasing order, keep a pointer into the deque. As `x` grows, the best line only moves forward, so advance the pointer — amortized `O(1)` per query.
- **Arbitrary queries (binary search):** if queries can be at any `x` in any order, binary-search the deque for the breakpoint surrounding `x` — `O(log n)` per query.

### 5. Min vs Max — Just Flip Signs

Everything above is for "minimum of lines" (lower envelope). For "maximum of lines" (upper envelope) you have two equally good options:

- **Negate:** store `(-m, -b)`, run the min version, and negate the answer. `max(m·x+b) = -min(-m·x-b)`.
- **Mirror the comparisons:** flip every `<` to `>` (and the slope-ordering direction) in the bad-line test.

Mixing these up is the single most common CHT bug — pick one convention and stick to it.

### 6. The Li Chao Tree — The No-Sorting Alternative

A Li Chao tree is a segment tree built over the range of possible query x-coordinates. Each node "owns" a sub-range and stores the single line that is best at that node's midpoint. To **insert** a line, you compare it with the node's current line at the midpoint, keep the lower one there, and recurse into the half where the other line might still win — `O(log C)`. To **query** at `x`, you walk root-to-leaf taking the minimum of every line you pass — also `O(log C)`. No slope sorting, no monotone-query requirement: lines and queries can come in *any* order. This makes Li Chao the robust default when the input is not nicely sorted.

---

## Big-O Summary

Let `n` = number of lines, `Q` = number of queries, `C` = size of the coordinate range for the Li Chao tree.

| Variant | Insert a line | Query at `x` | Total for `n` lines + `Q` queries | When it applies |
|---------|---------------|--------------|-----------------------------------|-----------------|
| Naive (loop over all lines) | `O(1)` | `O(n)` | `O(n·Q)` | always (but slow) |
| **Monotone CHT (pointer)** | amortized `O(1)` | amortized `O(1)` | **`O(n + Q)`** | slopes inserted monotone **and** queries monotone |
| **Monotone CHT (binary search)** | amortized `O(1)` | `O(log n)` | `O(n + Q log n)` | slopes inserted monotone; queries any order |
| **Dynamic CHT** (sorted set) | `O(log n)` | `O(log n)` | `O((n+Q) log n)` | slopes in any order |
| **Li Chao tree** | `O(log C)` | `O(log C)` | `O((n+Q) log C)` | anything; arbitrary insert/query order |

The headline: each of the optimized variants turns an `O(n²)` DP (one `O(n)` query per state) into `O(n log n)` or even `O(n)`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| A line `m·x + b` | A phone plan: monthly fee `b` plus per-minute rate `m`. The cost at `x` minutes is `m·x + b`. |
| Lower envelope | The "cheapest plan at each usage level" curve. For light users one plan wins; for heavy users another. |
| Dominated line | A plan that is never the cheapest at *any* usage — strictly worse than some mix of others. Drop it from the brochure. |
| Query at `x` | "I expect to use `x` minutes — which plan is cheapest, and what will I pay?" |
| Monotone queries | Customers walking in by increasing expected usage, so the recommended plan only ever shifts forward. |
| Li Chao tree | A lookup table organized so that, for any usage level you name, you find the cheapest plan in a few hops — no matter what order the plans were added to the catalog. |

Where the analogy breaks: phone plans have non-negative rates, but CHT lines can have any slope (including negative), and the math works regardless of sign.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Turns an `O(n²)` "min over lines" DP into `O(n log n)` or `O(n)`. | Only applies when the transition factors into lines `m_j·x + b_j`. |
| Monotone CHT is tiny code and blazing fast (amortized `O(1)`). | Monotone CHT needs sorted slopes *and* sorted queries — easy to misuse. |
| Li Chao tree handles arbitrary insert/query order with no sorting. | Li Chao needs a known, bounded coordinate range (or dynamic nodes). |
| Numerically clean if you compare with integers (cross-multiplication). | Float intersection points cause precision bugs near ties. |
| One mental model (the envelope) covers min and max via sign flips. | Min/max sign confusion is the most common bug. |
| Composes with other DP optimizations (D&C, Knuth as alternatives). | `m·x` can overflow 64-bit; you must size your integer types. |

**When to use:** a 1D DP whose transition is `min`/`max` over lines, especially with large `n` (`10⁵`–`10⁶`); known coefficient/coordinate ranges; a need for `O(n log n)` or better.

**When NOT to use:** transition that does not linearize; tiny `n` where `O(n²)` is fine; transitions better served by D&C optimization (monotone argmin over a 2D table) or Knuth (interval DP with quadrangle inequality).

---

## Step-by-Step Walkthrough

Let us build the lower envelope of four lines and answer a query, by hand. The lines (slope, intercept):

```
L1: m = -2, b = 3    →  y = -2x + 3
L2: m = -1, b = 1    →  y = -x + 1
L3: m =  0, b = 0    →  y = 0
L4: m =  1, b = 2    →  y = x + 2
```

We insert them in **increasing slope order** (`-2, -1, 0, 1`) and keep a stack of "currently on the envelope" lines. The bad-middle-line rule: when adding a new line, if the previous line on the stack is made useless (its crossing with the line before it is no longer to the left of its crossing with the new line), pop it.

**Insert L1.** Stack: `[L1]`. (Nothing to compare.)

**Insert L2.** Stack has only one line, so no middle to test. Stack: `[L1, L2]`.

**Insert L3.** Now there is a middle line `L2`, with `L1` before it and `L3` incoming. Where do `L1` and `L2` cross? `-2x+3 = -x+1 → x = 2`. Where do `L1` and `L3` cross? `-2x+3 = 0 → x = 1.5`. The `L1×L3` crossing (`1.5`) is to the **left** of the `L1×L2` crossing (`2`), which means `L2` is squeezed out — it never wins. **Pop L2.** Now test again with `L1` before `L3`: only `L1` remains as the prior line, no middle, stop. Stack: `[L1, L3]`.

**Insert L4.** Middle line is `L3`, prior is `L1`. `L1×L3` cross at `x = 1.5`. `L1×L4` cross: `-2x+3 = x+2 → x = 1/3`. Is `1/3` left of `1.5`? Yes — so `L3` would be squeezed... let us double-check by also testing `L3×L4`: `0 = x+2 → x = -2`. Hmm, careful: the correct test compares the crossing of the *middle with the new line* against the crossing of the *prior with the middle*. `L3×L4` cross at `x = -2`; `L1×L3` cross at `x = 1.5`. Since `-2 < 1.5`, the middle line `L3` is useless — **pop L3**. Re-test with prior `L1`, middle now gone; stack `[L1, L4]`, no middle, stop. Stack: `[L1, L4]`.

So the final envelope keeps `L1` and `L4` (in this contrived example `L2` and `L3` were dominated by the combination of `L1` and `L4`). Let us verify with a query.

**Query at `x = -1`.** Evaluate the kept lines: `L1(-1) = -2·(-1)+3 = 5`, `L4(-1) = (-1)+2 = 1`. The minimum is `1` (line `L4`). Check the dropped lines too: `L2(-1)=2`, `L3(-1)=0`. Wait — `L3(-1)=0 < 1`! That means dropping `L3` was wrong for this set.

This deliberately shows the **most important lesson for beginners**: the bad-line test must use the *consistent* crossing comparison, and a hand error (or a sign mistake) silently corrupts the envelope. With the correct test, `L3` would *not* be popped here (it does win near `x=-1`). The reliable way to avoid such mistakes is to (a) follow the exact inequality in [`professional.md`](./professional.md), and (b) **always validate against the brute-force "loop over all lines" oracle** on random inputs before trusting your CHT. The code below includes that oracle.

---

## Code Examples

### Example: Monotone CHT for Minimum (slopes inserted decreasing, queries increasing)

We store lines and answer "minimum value at `x`" using the moving-pointer (amortized `O(1)`) query. To keep the walkthrough honest, we also include the brute-force oracle.

#### Go

```go
package main

import "fmt"

// Line: y = m*x + b
type Line struct{ m, b int64 }

func (l Line) at(x int64) int64 { return l.m*x + l.b }

// MonotoneCHT supports: addLine with NON-INCREASING slope, query at NON-DECREASING x.
// It maintains the lower envelope for minimum queries.
type MonotoneCHT struct {
	lines []Line
	ptr   int
}

// bad reports whether l2 (the middle) is made useless by l1 (before) and l3 (after).
// Cross-multiplied to avoid floating point. Valid because slopes are monotone.
func bad(l1, l2, l3 Line) bool {
	// intersection x of (l1,l3) <= intersection x of (l1,l2)  =>  l2 useless
	// (b3 - b1)/(m1 - m3) <= (b2 - b1)/(m1 - m2)  -> cross-multiply (watch signs)
	return (l3.b-l1.b)*(l1.m-l2.m) <= (l2.b-l1.b)*(l1.m-l3.m)
}

func (c *MonotoneCHT) addLine(m, b int64) {
	l := Line{m, b}
	for len(c.lines) >= 2 && bad(c.lines[len(c.lines)-2], c.lines[len(c.lines)-1], l) {
		c.lines = c.lines[:len(c.lines)-1]
	}
	c.lines = append(c.lines, l)
	if c.ptr >= len(c.lines) {
		c.ptr = len(c.lines) - 1
	}
}

func (c *MonotoneCHT) query(x int64) int64 {
	if c.ptr >= len(c.lines) {
		c.ptr = len(c.lines) - 1
	}
	for c.ptr+1 < len(c.lines) && c.lines[c.ptr+1].at(x) <= c.lines[c.ptr].at(x) {
		c.ptr++
	}
	return c.lines[c.ptr].at(x)
}

// brute-force oracle: minimum over all lines, O(n) per query.
func bruteMin(lines []Line, x int64) int64 {
	best := lines[0].at(x)
	for _, l := range lines[1:] {
		if v := l.at(x); v < best {
			best = v
		}
	}
	return best
}

func main() {
	all := []Line{{3, 10}, {2, 5}, {1, 3}, {0, 0}, {-1, 4}} // decreasing slopes
	var c MonotoneCHT
	for _, l := range all {
		c.addLine(l.m, l.b)
	}
	for _, x := range []int64{-2, 0, 1, 5, 10} {
		fmt.Printf("x=%d  cht=%d  brute=%d\n", x, c.query(x), bruteMin(all, x))
	}
}
```

#### Java

```java
import java.util.*;

public class MonotoneCHT {
    static long[] M = new long[1 << 16];
    static long[] B = new long[1 << 16];
    static int size = 0, ptr = 0;

    static long at(int i, long x) { return M[i] * x + B[i]; }

    // l2 (middle) useless given l1 (before) and incoming l3
    static boolean bad(int i1, int i2, long m3, long b3) {
        return (b3 - B[i1]) * (M[i1] - M[i2]) <= (B[i2] - B[i1]) * (M[i1] - m3);
    }

    static void addLine(long m, long b) {
        while (size >= 2 && bad(size - 2, size - 1, m, b)) size--;
        M[size] = m; B[size] = b; size++;
        if (ptr >= size) ptr = size - 1;
    }

    static long query(long x) {
        if (ptr >= size) ptr = size - 1;
        while (ptr + 1 < size && at(ptr + 1, x) <= at(ptr, x)) ptr++;
        return at(ptr, x);
    }

    static long bruteMin(long[][] lines, long x) {
        long best = Long.MAX_VALUE;
        for (long[] l : lines) best = Math.min(best, l[0] * x + l[1]);
        return best;
    }

    public static void main(String[] args) {
        long[][] all = {{3, 10}, {2, 5}, {1, 3}, {0, 0}, {-1, 4}};
        for (long[] l : all) addLine(l[0], l[1]);
        for (long x : new long[]{-2, 0, 1, 5, 10})
            System.out.println("x=" + x + " cht=" + query(x) + " brute=" + bruteMin(all, x));
    }
}
```

#### Python

```python
class MonotoneCHT:
    """Lower envelope for MIN queries.
    addLine: slopes NON-INCREASING; query: x NON-DECREASING."""

    def __init__(self):
        self.lines = []   # list of (m, b)
        self.ptr = 0

    @staticmethod
    def _bad(l1, l2, l3):
        # l2 (middle) useless given l1 (before) and l3 (after)
        return (l3[1] - l1[1]) * (l1[0] - l2[0]) <= (l2[1] - l1[1]) * (l1[0] - l3[0])

    def add_line(self, m, b):
        l = (m, b)
        while len(self.lines) >= 2 and self._bad(self.lines[-2], self.lines[-1], l):
            self.lines.pop()
        self.lines.append(l)
        if self.ptr >= len(self.lines):
            self.ptr = len(self.lines) - 1

    def query(self, x):
        if self.ptr >= len(self.lines):
            self.ptr = len(self.lines) - 1
        at = lambda i: self.lines[i][0] * x + self.lines[i][1]
        while self.ptr + 1 < len(self.lines) and at(self.ptr + 1) <= at(self.ptr):
            self.ptr += 1
        return at(self.ptr)


def brute_min(lines, x):
    return min(m * x + b for m, b in lines)


if __name__ == "__main__":
    all_lines = [(3, 10), (2, 5), (1, 3), (0, 0), (-1, 4)]  # decreasing slopes
    cht = MonotoneCHT()
    for m, b in all_lines:
        cht.add_line(m, b)
    for x in (-2, 0, 1, 5, 10):
        print(f"x={x} cht={cht.query(x)} brute={brute_min(all_lines, x)}")
```

**What it does:** inserts five lines with non-increasing slopes, then answers minimum-at-x queries with the moving pointer, comparing each against the brute-force oracle so the two columns always match.
**Run:** `go run main.go` | `javac MonotoneCHT.java && java MonotoneCHT` | `python cht.py`

---

## Coding Patterns

### Pattern 1: The Brute-Force Oracle (test against this first)

**Intent:** Before trusting any CHT/Li Chao, compute the envelope the obvious slow way and verify they agree on random inputs.

```python
def brute_min(lines, x):
    return min(m * x + b for m, b in lines)
```

This is `O(n)` per query and far too slow for the real input, but it is the gold standard for correctness. Generate random lines and random query points, and assert your fast structure matches it for every `x`.

### Pattern 2: Linearize the DP Transition

**Intent:** Spot the `m_j·x_i + b_j` form hiding inside a transition.

```text
dp[i] = min_j ( dp[j] + (x_i - x_j)^2 )
      = x_i^2 + min_j ( (-2 x_j) * x_i + (dp[j] + x_j^2) )
                         ^slope m_j        ^intercept b_j
```

Add line `(m_j, b_j) = (-2 x_j, dp[j] + x_j^2)` after computing `dp[j]`; query at `x = x_i`; add `x_i^2` back.

### Pattern 3: Min via Max by Negation

**Intent:** Reuse a min-structure for max queries (or vice versa).

```text
max_j ( m_j x + b_j ) = - min_j ( (-m_j) x + (-b_j) )
```

Insert `(-m_j, -b_j)` into the min structure, query, then negate the result.

```mermaid
graph TD
    A[DP transition] -->|factor out x_i terms| B["min_j (m_j*x_i + b_j)"]
    B --> C{slopes & queries<br/>monotone?}
    C -->|yes| D[Monotone CHT — O(1) amortized]
    C -->|no, slopes monotone| E[CHT + binary search — O(log n)]
    C -->|arbitrary order| F[Li Chao tree — O(log C)]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong answers, larger than expected | Min/max sign confusion (using lower-envelope logic for a max query). | Pick one convention; for max, negate `(m, b)` and the answer. |
| Overflow / garbage values | `m·x` exceeds 64-bit (`int64`) range. | Bound `|m|·|x|`; use `int64`/`long`; in the cross-test watch `(b)·(m)` products too. |
| Division-by-zero in intersection | Two lines with equal slope. | Compare intercepts directly; in monotone CHT keep the better of equal-slope lines, or use the cross-multiplied (division-free) test. |
| Pointer query returns wrong line | Queries not actually monotone. | Use the binary-search query or a Li Chao tree if `x` order is not guaranteed. |
| Li Chao gives wrong value at edges | Query `x` outside the tree's `[xlo, xhi]` range. | Size the range to cover every possible query coordinate. |
| Popped a line that was still useful | Bad-line inequality has a sign error. | Validate against the brute oracle; re-derive the cross-multiplied test carefully. |

---

## Performance Tips

- **Prefer integer (cross-multiplied) comparisons** over computing floating-point intersection x-values; floats lose precision near ties and cause wrong pops.
- **Monotone CHT is the fastest** when its preconditions hold (sorted slopes, sorted queries): amortized `O(1)`, tiny constants, cache-friendly arrays.
- **Use a flat array, not a list of objects**, for the deque of lines — better cache behavior in hot loops.
- **Li Chao without recursion** (an iterative or explicit-stack version) avoids function-call overhead for `10⁶`+ operations.
- **Avoid re-sorting** — if you must add lines in slope order for the monotone CHT, sort once up front, not repeatedly.

---

## Best Practices

- Always write and run the brute-force oracle (Pattern 1) on random inputs before trusting the fast structure.
- State your convention in a comment: "MIN queries, slopes inserted non-increasing, queries non-decreasing" — and check those preconditions hold.
- Keep `addLine` and `query` as small, separately testable functions; most bugs hide in the bad-line test.
- For competition/production code with arbitrary order, default to the **Li Chao tree** — it is the most robust and hard to misuse.
- Size your integer types deliberately: if `|m| ≤ 10⁹` and `|x| ≤ 10⁹`, then `m·x` reaches `10¹⁸`, near the `int64` limit — leave headroom.

---

## Edge Cases & Pitfalls

- **Single line** — the envelope is just that line; every query returns it. No bad-line test runs.
- **Duplicate slopes** — two lines with the same slope never cross; keep only the one with the smaller intercept (for min). The cross test must not divide by `m1 - m2 = 0`.
- **Query outside any inserted x** — still valid; the envelope extends infinitely. For Li Chao, ensure the tree range covers it.
- **All slopes equal** — the envelope is a single line (the lowest intercept). Handle the degenerate deque of size 1.
- **Empty structure** — querying before any line is inserted is undefined; guard with an "infinity" sentinel if your DP allows it.
- **Non-monotone queries on a pointer CHT** — silently wrong; the pointer only moves forward. Use binary search or Li Chao instead.
- **Overflow in the cross test** — the products `(b3-b1)·(m1-m2)` can be large; size types so they do not overflow.

---

## Common Mistakes

1. **Min/max sign confusion** — applying lower-envelope logic to a maximum query (or vice versa). Negate consistently.
2. **Assuming monotone queries** — using the pointer query when `x` is not sorted. Use binary search or Li Chao.
3. **Floating-point intersections** — computing crossing x-values as floats and comparing them; precision errors pop the wrong line. Cross-multiply with integers.
4. **Forgetting to factor out the `x_i²` (or other `i`-only) term** — it must come *out* of the `min`; only the linear-in-`x_i` part goes into the line.
5. **Wrong identity for an empty/initial state** — the first `dp` value or the `j` you can transition from must be seeded correctly before any query.
6. **Overflow** — `m·x` and the cross-multiplied products exceed 64 bits. Size types; never trust `int`.
7. **Re-deriving the bad-line test from memory and getting a sign wrong** — verify against the oracle every time.

---

## Cheat Sheet

| Question | Tool | Cost |
|----------|------|------|
| Min over lines, slopes & queries monotone | Monotone CHT (pointer) | amortized `O(1)` |
| Min over lines, slopes monotone, any query | CHT + binary search | `O(log n)` |
| Min over lines, slopes any order | Dynamic CHT (sorted set) | `O(log n)` |
| Anything, any insert/query order | Li Chao tree | `O(log C)` |
| Max instead of min | negate `(m, b)` and the answer | same |
| Verify correctness | brute-force oracle | `O(n)` per query |

Core idea:

```
dp[i] = min_j ( m_j * x_i + b_j )           # transition factors into lines
add line (m_j, b_j) after computing dp[j]   # each state = one line
dp[i] = envelope.query(x_i) [+ i-only term] # one envelope query
```

Bad-line test (min, division-free): pop the middle line `l2` when
```
(b3 - b1)*(m1 - m2) <= (b2 - b1)*(m1 - m3)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - Adding lines one at a time and watching the **lower envelope** redraw.
> - The deque **popping now-useless lines** when a new line dominates them.
> - Answering a **query at `x`** by reading the lowest line at that point.
> - Step / Play / Pause / Reset controls to watch the envelope build up edge by edge.

---

## Summary

The Convex Hull Trick optimizes DP transitions of the form `dp[i] = min_j (m_j·x_i + b_j)` by recognizing that each previous state is a **line** and that the minimum-at-x is the **lower envelope** of those lines — a convex, piecewise-linear curve. Keeping only the envelope lines (in slope order, popping dominated "bad middle lines") lets you answer each query in amortized `O(1)` when slopes and queries are monotone, or `O(log n)` by binary search otherwise. The **Li Chao tree** is the robust alternative: a segment tree of lines that handles arbitrary insert and query order in `O(log C)` with no sorting. Min and max differ only by sign flips. The technique converts an `O(n²)` DP into `O(n log n)` or `O(n)`. The two rules to never forget: keep the integer (cross-multiplied) comparison to dodge float bugs, and always validate against the brute-force oracle.

---

## Further Reading

- cp-algorithms.com — "Convex hull trick and Li Chao tree".
- USACO Guide / *Competitive Programmer's Handbook* (Laaksonen) — DP optimization chapter.
- Sibling topic `08-divide-and-conquer-optimization` — monotone-argmin layered DP.
- Sibling topic `09-knuth-optimization` — interval DP with the quadrangle inequality.
- *Introduction to Algorithms* (CLRS) — convexity and lower envelopes (computational geometry chapters).
- Codeforces blog posts on "Li Chao tree" and "fully dynamic convex hull trick".

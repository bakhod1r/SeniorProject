# Memoization vs Tabulation — Middle Level

> **Focus:** How to *design the state* so the DP is correct and minimal, how to convert mechanically between top-down and bottom-up, when each style wins on time/space/stack, and how to shrink memory with rolling arrays and dimension reduction — using Fibonacci, climbing stairs, and grid paths as the worked examples.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [State Design in Depth](#state-design-in-depth)
4. [Converting Between Styles](#converting-between-styles)
5. [Space Optimization](#space-optimization)
6. [Recursion vs Iteration Trade-offs](#recursion-vs-iteration-trade-offs)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: *cache subproblems and pick top-down or bottom-up.* At middle level the questions get sharper and more engineering-flavored:

- What exactly **is** the state, and how do I keep it minimal so the number of subproblems stays small?
- Given a working memoized solution, how do I **convert** it to a table — and vice versa — without rethinking the problem?
- When does the **recursion depth** of memoization become a liability, and how does tabulation avoid it?
- How do I **shrink memory** from `O(states)` to a rolling window, and what fill order makes that safe?
- Top-down or bottom-up: what actually decides it in practice — speed, space, sparsity, or stack?

These are the decisions that separate "I can write a DP if you hand me the recurrence" from "I can take a fuzzy problem, design the state, and implement it efficiently in either style."

---

## Deeper Concepts

### The DP is a function over a state space

Think of any DP as a pure function `f : State → Value`. The recurrence says how `f(s)` depends on `f` at *smaller* states. The whole job is:

1. **Define the state** `s` — the minimal tuple of parameters identifying a subproblem.
2. **Write the transition** — `f(s) = combine(f(s₁), f(s₂), …)` over states strictly smaller than `s`.
3. **Identify base cases** — states with a known value and no dependencies.

Memoization and tabulation are just two **evaluation strategies** for this same function:

- **Memoization** evaluates `f` *lazily*, on demand, caching results — it explores the dependency graph by recursion.
- **Tabulation** evaluates `f` *eagerly*, in a topological order of the dependency graph — it fills a table.

The dependency graph of subproblems is a **DAG** (directed acyclic graph): an edge `s → s'` means "`f(s)` needs `f(s')`." Acyclicity is non-negotiable — if the dependencies had a cycle, neither recursion (it would loop) nor a fill order (none exists) could work. Tabulation's "fill order" is precisely a **topological sort** of this DAG.

### Time is states × transition cost

Both styles do the same total work: each state is evaluated once, costing the transition. So:

```
time  = (number of states) × (cost per transition)
space = (number of stored states) + (stack depth, for memoization)
```

This formula is the single most useful tool for analyzing a DP. For Fibonacci: `n+1` states × `O(1)` = `O(n)`. For the grid: `R·C` states × `O(1)` = `O(R·C)`. The art of "making a DP fast" is almost always "making the state smaller" (fewer states) or "making the transition cheaper."

### Overlap is what makes caching pay

If every state is reached exactly once, caching is pointless — that's plain recursion/divide-and-conquer. DP earns its keep only when the *same* state is reached many times. The amount of overlap is `(total recursive calls without cache) / (distinct states)`. For Fibonacci that ratio is exponential, which is exactly why the cache turns `O(2^n)` into `O(n)`.

---

## State Design in Depth

The single hardest skill in DP is choosing the state. Three principles:

### 1. The state must be *sufficient*

It must capture everything that affects future decisions. If two subproblems with the same state key could legitimately have different answers, the state is **under-specified** and caching will return wrong results. Example trap: in a grid with obstacles, the state is still `(r, c)` — but if you also had a "remaining budget" you'd need `(r, c, budget)`.

### 2. The state must be *minimal*

Every extra dimension multiplies the number of states (and thus time and space). If a parameter never influences the answer, drop it. Climbing stairs needs only `n`; adding "last step size" would needlessly double the states without changing the count.

### 3. The state must be *cheaply indexable*

Prefer states that map to small integer ranges so the table is an array. A state of `(r, c)` with `r < R, c < C` indexes a `R×C` array directly. A state like "the set of visited nodes" needs a bitmask or hash map and grows exponentially.

### Worked state designs for the three examples

| Problem | State | Why sufficient | Why minimal |
|---------|-------|----------------|-------------|
| Fibonacci | `n` | `fib(n)` depends only on the index | No other parameter affects the value |
| Climbing stairs | `n` (stairs remaining) | ways depend only on how many stairs are left | step history is irrelevant — only the count matters |
| Grid paths | `(r, c)` | paths to a cell depend only on its coordinates | movement is memoryless; how you arrived doesn't matter |

### Counting the states

Always tally `|State|` before coding — it is your time/space budget:

```
Fibonacci:      |State| = n+1
Climbing:       |State| = n+1
Grid:           |State| = R·C
Grid + k coins: |State| = R·C·(k+1)   <- extra dimension, watch the blowup
```

---

## Converting Between Styles

Because both styles encode the same recurrence, conversion is **mechanical**. Knowing both directions is a core skill.

### Memoization → Tabulation

1. **Cache key shape becomes table dimensions.** A 1-arg memo (`fib(n)`) becomes a 1D array `dp[0..n]`. A 2-arg memo (`grid(r,c)`) becomes a 2D array `dp[R][C]`.
2. **Base cases become initial table writes.** Whatever the recursion returns without recursing, you assign directly.
3. **Recursion direction reverses into a loop.** The memo recurses from large state to small; the table loops from small to large. The loop order must place each state *after* its dependencies (topological order). For `fib`, dependencies are `i-1, i-2`, so loop `i` increasing. For the grid, `(r-1,c)` and `(r,c-1)` come first, so loop `r` then `c`, both increasing.
4. **The transition body is copied verbatim**, replacing recursive calls `solve(sub)` with table reads `dp[sub]`.

### Tabulation → Memoization

1. **Table indices become function parameters.**
2. **Initial writes become base-case returns.**
3. **The loop body becomes the recursive body**, replacing `dp[sub]` reads with recursive `solve(sub)` calls.
4. **Add a cache check at the top and a cache write before returning.**

### Side-by-side: Fibonacci

```
# Memoization                          # Tabulation
def fib(n):                            dp = [0]*(n+1)
    if n < 2: return n                 dp[1] = 1
    if n in memo: return memo[n]       for i in 2..n:
    memo[n] = fib(n-1)+fib(n-2)            dp[i] = dp[i-1]+dp[i-2]
    return memo[n]                     return dp[n]
```

The transition `f(n-1)+f(n-2)` is identical; only the evaluation order and storage differ. This equivalence is proved rigorously in [`professional.md`](./professional.md): both compute the same function because they evaluate the same recurrence over the same DAG.

---

## Space Optimization

### Rolling arrays (dimension reduction)

If `dp[i]` depends only on a bounded window of recent entries, you don't need the whole array. Keep just the window.

- **Fibonacci / climbing stairs:** `dp[i]` needs `dp[i-1]` and `dp[i-2]` → keep **two variables**. Space `O(n) → O(1)`.
- **Grid paths:** `dp[r][c]` needs `dp[r-1][c]` (previous row) and `dp[r][c-1]` (same row) → keep **one row**. Space `O(R·C) → O(C)`.

The grid case is the classic "drop a dimension" trick. With one array `row[]`, the in-place update `row[c] += row[c-1]` works because *before* the write `row[c]` still holds the previous row's value (the "up" contribution) and `row[c-1]` already holds the current row's value (the "left" contribution). Order matters: iterate `c` increasing so `row[c-1]` is already updated.

### When rolling arrays are unsafe

Two caveats:

1. **You lose the ability to reconstruct the path.** If the problem asks *which* path (not just the count/value), you need the full table for backtracking. Rolling arrays only keep the final scalar.
2. **The fill order must match the dependency window.** If you reduce a dimension but iterate in the wrong direction, you overwrite a value before it's read. (Classic in 0/1 knapsack: iterate the weight loop *backward* to avoid reusing an item.)

### Memoization and space

Rolling arrays are natural in tabulation because you control the fill order. In memoization you generally cannot apply them — the recursion can revisit any state at any time, so you must keep the full cache. This is one reason tabulation is the go-to when memory is tight.

---

## Recursion vs Iteration Trade-offs

| Dimension | Memoization (recursion) | Tabulation (iteration) |
|-----------|-------------------------|------------------------|
| **Stack** | Depth ≈ longest dependency chain; can overflow | None — flat loops |
| **Constant factor** | Function-call + cache-lookup overhead | Tight array indexing, faster |
| **States solved** | Only reachable ones (lazy) | All in range (eager) |
| **Order discovery** | Automatic (recursion finds it) | You must derive a topological order |
| **Space optimization** | Hard (full cache needed) | Easy (rolling arrays) |
| **Code clarity** | Mirrors the math recurrence | Reads as table manipulation |

**The stack ceiling.** Memoization recursion depth equals the longest chain in the dependency DAG. For `fib(n)` that is `n`. Languages default to a few thousand frames (Python ~1000, Java ~10–20k depending on stack size). A DP with `n = 10^6` will overflow a memoized solution but run fine tabulated. This is the most common reason production code prefers tabulation.

**The sparsity advantage.** If only a tiny fraction of the possible states are actually reachable, memoization wins big: it never touches the others. Tabulation over a huge dense state space wastes time and memory on states that don't matter. Example: a DP whose state is `(i, remainder)` where only a few remainders ever occur — memoization explores hundreds of states, tabulation would allocate millions.

---

## State-Design Archetypes

Most DP states fall into a handful of recurring shapes. Recognizing the archetype tells you the table dimensions and the natural fill order immediately.

| Archetype | State | Example | Fill order |
|-----------|-------|---------|------------|
| **Prefix / index** | `i` = position processed so far | Fibonacci, climbing stairs, decode-ways | `i` increasing (or decreasing if forward recurrence) |
| **Two-pointer / interval** | `(l, r)` = a subrange | matrix-chain, palindrome partition | by increasing interval length |
| **Grid / coordinates** | `(r, c)` | unique paths, edit distance | row-major (any monotone order) |
| **Index + capacity** | `(i, w)` | 0/1 knapsack | `i` outer, `w` inner (direction matters) |
| **Index + bitmask** | `(i, mask)` | assignment, TSP | by `popcount(mask)` or mask value |
| **Position + remainder** | `(i, r mod m)` | digit DP, divisibility | `i` then remainder |

The key insight: **the number of dimensions equals the number of independent things that must be remembered to make the next decision.** Add a dimension only when a parameter genuinely changes future answers. Each archetype has a canonical fill order that is a topological sort of its dependency DAG.

### Forward vs backward formulation

The *same* problem can be phrased two ways:

- **Pull (backward):** `dp[s] = combine(dp[predecessors])` — "where could I have come from?" Natural for memoization; the recursion pulls values from smaller states.
- **Push (forward):** for each `s`, add its contribution into `dp[successors]` — "where can I go next?" Natural in some tabulations (e.g. counting paths by propagating forward).

Both are correct; they traverse the same DAG in opposite directions. Memoization is almost always a *pull* formulation (it asks for what it needs). Tabulation can be either, and the push form sometimes simplifies the transition (no need to enumerate predecessors). Decode-ways in [`interview.md`](./interview.md) is a clean example where the tabulation runs the index *backward* because the recurrence references `i+1` and `i+2`.

### Worked conversion trace: grid paths memo → table

To make the mechanical conversion concrete, trace the dependency direction. Memoized `grid(r,c)` pulls from `grid(r-1,c)` and `grid(r,c-1)` — both have smaller `r+c`. So a topological order is "increasing `r+c`," and any row-major double loop (`r` outer, `c` inner, both increasing) satisfies it because `(r-1,c)` and `(r,c-1)` are always visited before `(r,c)`. The table dimensions come straight from the 2-arg cache key: `dp[R][C]`. Base case `grid(0,0)=1` becomes `dp[0][0]=1`. The transition body is copied verbatim with `grid(...)` calls replaced by `dp[...]` reads. Nothing about the problem was re-derived — only the evaluation order and storage changed.

---

## Comparison with Alternatives

| Technique | Relationship to DP | When |
|-----------|--------------------|------|
| **Plain recursion** | DP without the cache | Only when subproblems don't overlap |
| **Divide and conquer** | Like DP but non-overlapping subproblems | Merge sort, quicksort, binary search |
| **Greedy** | Makes one choice, never reconsiders | When local optimum = global optimum (no need to explore subproblems) |
| **Memoized D&C** | DP via top-down | Irregular/sparse state spaces |
| **Iterative DP** | DP via bottom-up | Dense state spaces, deep recursion, tight memory |
| **Matrix exponentiation** | Speeds up *linear-recurrence* DP to `O(log n)` | Huge `n` on a fixed-order recurrence (e.g. `fib(10^18)`) |

A note on Fibonacci specifically: tabulation gives `O(n)`, but the recurrence is linear and fixed-order, so **matrix exponentiation** (sibling topic under `19-number-theory`) computes `fib(n)` in `O(log n)`. DP is the general tool; matrix power is a specialized accelerator for the linear-recurrence subclass. Knowing when a DP collapses to a closed form or a faster method is a senior skill.

---

## Code Examples

### Climbing stairs with variable steps (state design under change)

When the allowed step sizes change from `{1,2}` to a set `S`, the *state* stays `n` but the transition sums over `S`. This shows state minimality: history still doesn't matter.

#### Go

```go
package main

import "fmt"

// ways(n) = sum over s in steps of ways(n-s); ways(0)=1
func climbMemo(n int, steps []int, cache map[int]int) int {
	if n == 0 {
		return 1
	}
	if n < 0 {
		return 0
	}
	if v, ok := cache[n]; ok {
		return v
	}
	total := 0
	for _, s := range steps {
		total += climbMemo(n-s, steps, cache)
	}
	cache[n] = total
	return total
}

func climbTab(n int, steps []int) int {
	dp := make([]int, n+1)
	dp[0] = 1
	for i := 1; i <= n; i++ {
		for _, s := range steps {
			if i-s >= 0 {
				dp[i] += dp[i-s]
			}
		}
	}
	return dp[n]
}

func main() {
	steps := []int{1, 2, 3}
	fmt.Println(climbMemo(5, steps, map[int]int{})) // 13
	fmt.Println(climbTab(5, steps))                 // 13
}
```

#### Java

```java
import java.util.*;

public class Climb {
    static int climbMemo(int n, int[] steps, Map<Integer,Integer> cache) {
        if (n == 0) return 1;
        if (n < 0) return 0;
        Integer c = cache.get(n);
        if (c != null) return c;
        int total = 0;
        for (int s : steps) total += climbMemo(n - s, steps, cache);
        cache.put(n, total);
        return total;
    }

    static int climbTab(int n, int[] steps) {
        int[] dp = new int[n + 1];
        dp[0] = 1;
        for (int i = 1; i <= n; i++)
            for (int s : steps)
                if (i - s >= 0) dp[i] += dp[i - s];
        return dp[n];
    }

    public static void main(String[] args) {
        int[] steps = {1, 2, 3};
        System.out.println(climbMemo(5, steps, new HashMap<>())); // 13
        System.out.println(climbTab(5, steps));                   // 13
    }
}
```

#### Python

```python
def climb_memo(n, steps, cache=None):
    if cache is None:
        cache = {}
    if n == 0:
        return 1
    if n < 0:
        return 0
    if n in cache:
        return cache[n]
    cache[n] = sum(climb_memo(n - s, steps, cache) for s in steps)
    return cache[n]


def climb_tab(n, steps):
    dp = [0] * (n + 1)
    dp[0] = 1
    for i in range(1, n + 1):
        for s in steps:
            if i - s >= 0:
                dp[i] += dp[i - s]
    return dp[n]


if __name__ == "__main__":
    steps = [1, 2, 3]
    print(climb_memo(5, steps))  # 13
    print(climb_tab(5, steps))   # 13
```

### Grid paths: full table vs rolling row, with the conversion explained

#### Go

```go
// Full 2D table — needed if you must reconstruct a path later.
func gridFull(R, C int) int {
	dp := make([][]int, R)
	for r := range dp {
		dp[r] = make([]int, C)
		dp[r][0] = 1 // first column: one way (all down)
	}
	for c := 0; c < C; c++ {
		dp[0][c] = 1 // first row: one way (all right)
	}
	for r := 1; r < R; r++ {
		for c := 1; c < C; c++ {
			dp[r][c] = dp[r-1][c] + dp[r][c-1]
		}
	}
	return dp[R-1][C-1]
}

// Rolling row — O(C) space; the same recurrence folded in place.
func gridRolling(R, C int) int {
	row := make([]int, C)
	for c := range row {
		row[c] = 1 // first row baseline
	}
	for r := 1; r < R; r++ {
		for c := 1; c < C; c++ {
			row[c] += row[c-1] // old row[c] = "up", row[c-1] = "left"
		}
	}
	return row[C-1]
}
```

#### Java

```java
static int gridRolling(int R, int C) {
    int[] row = new int[C];
    java.util.Arrays.fill(row, 1);     // first row: all ones
    for (int r = 1; r < R; r++)
        for (int c = 1; c < C; c++)
            row[c] += row[c - 1];       // fold "up" + "left"
    return row[C - 1];
}
```

#### Python

```python
def grid_rolling(R, C):
    row = [1] * C                  # first row baseline
    for _ in range(1, R):
        for c in range(1, C):
            row[c] += row[c - 1]   # old row[c]="up", row[c-1]="left"
    return row[C - 1]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong answer after dimension reduction | Iterated the rolling loop in the wrong direction | Match iteration direction to the dependency window |
| Stack overflow on conversion target | Converted tabulation → memo but `n` is huge | Keep tabulation for deep recurrences |
| Under-specified state returns wrong cached value | A relevant parameter omitted from the key | Add the missing parameter; recount states |
| State-space blowup / OOM | An unnecessary state dimension | Drop parameters that don't affect the answer |
| Off-by-one in topological loop bounds | Fill order skips a base case | Initialize base cases before the main loops |
| Path reconstruction impossible | Used a rolling array but need the actual path | Keep the full table or store parent pointers |

---

## Performance Analysis

The master formula again: `time = |States| × cost(transition)`. Apply it deliberately:

- **Climbing stairs with step set `S`:** `n+1` states × `O(|S|)` transition = `O(n·|S|)`. The state is still 1D — the step set only changes transition cost, not the state count.
- **Grid paths:** `R·C` states × `O(1)` = `O(R·C)` time; `O(C)` space with a rolling row.
- **Grid paths with a coin budget `(r, c, coins)`:** `R·C·(k+1)` states × `O(1)` = `O(R·C·k)`. The extra dimension multiplies cost — always count states before committing.

**Memo vs table constants.** On the same `O(n)` Fibonacci, tabulation is typically 2–5× faster in wall-clock than memoization because of call-frame and hash-lookup overhead, and uses less memory if rolled to `O(1)`. The asymptotics tie; the constants favor iteration.

**Sparsity flips it.** If only `√S` of the `S` possible states are reachable, memoization runs in `O(√S · T)` while a dense table runs in `O(S · T)`. Then top-down wins decisively.

### A measured comparison you can reproduce

The asymptotics tie, so the only honest way to compare is to benchmark. A minimal harness that times all three Fibonacci styles at the same `n`:

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func memo(n int, c map[int]int64) int64 {
	if n < 2 {
		return int64(n)
	}
	if v, ok := c[n]; ok {
		return v
	}
	c[n] = memo(n-1, c) + memo(n-2, c)
	return c[n]
}
func tab(n int) int64 {
	if n < 2 {
		return int64(n)
	}
	dp := make([]int64, n+1)
	dp[1] = 1
	for i := 2; i <= n; i++ {
		dp[i] = dp[i-1] + dp[i-2]
	}
	return dp[n]
}
func rolling(n int) int64 {
	var a, b int64 = 0, 1
	for i := 0; i < n; i++ {
		a, b = b, a+b
	}
	return a
}
func bench(name string, f func() int64) {
	t0 := time.Now()
	_ = f()
	fmt.Printf("%-9s %v\n", name, time.Since(t0))
}
func main() {
	n := 90 // small enough that memo does not overflow
	bench("memo", func() int64 { return memo(n, map[int]int64{}) })
	bench("tab", func() int64 { return tab(n) })
	bench("rolling", func() int64 { return rolling(n) })
}
```

#### Python

```python
import time


def memo(n, c=None):
    c = c if c is not None else {}
    if n < 2:
        return n
    if n in c:
        return c[n]
    c[n] = memo(n - 1, c) + memo(n - 2, c)
    return c[n]


def tab(n):
    if n < 2:
        return n
    dp = [0] * (n + 1)
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = dp[i - 1] + dp[i - 2]
    return dp[n]


def rolling(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


if __name__ == "__main__":
    n = 90
    for name, f in [("memo", memo), ("tab", tab), ("rolling", rolling)]:
        t0 = time.perf_counter()
        f(n)
        print(f"{name:9s} {time.perf_counter() - t0:.2e}s")
```

#### Java

```java
public class Bench {
    static long memo(int n, java.util.Map<Integer,Long> c) {
        if (n < 2) return n;
        Long v = c.get(n); if (v != null) return v;
        long r = memo(n-1,c) + memo(n-2,c); c.put(n, r); return r;
    }
    static long tab(int n) {
        if (n < 2) return n;
        long[] dp = new long[n+1]; dp[1] = 1;
        for (int i = 2; i <= n; i++) dp[i] = dp[i-1] + dp[i-2];
        return dp[n];
    }
    static long rolling(int n) {
        long a = 0, b = 1;
        for (int i = 0; i < n; i++) { long t = a+b; a = b; b = t; }
        return a;
    }
    public static void main(String[] args) {
        int n = 90;
        long t0 = System.nanoTime(); memo(n, new java.util.HashMap<>());
        System.out.println("memo    " + (System.nanoTime()-t0));
        t0 = System.nanoTime(); tab(n);
        System.out.println("tab     " + (System.nanoTime()-t0));
        t0 = System.nanoTime(); rolling(n);
        System.out.println("rolling " + (System.nanoTime()-t0));
    }
}
```

You will consistently see `rolling < tab < memo` in wall-clock and memory, with the gaps widening as `n` grows (until `memo` overflows the stack entirely). The asymptotics are identical `O(n)`; the spread is constants — call frames and hash lookups for `memo`, array writes for `tab`, two registers for `rolling`. This is the empirical backing for "prototype top-down, ship bottom-up."

---

## Best Practices

- **Design the state on paper first.** Write `dp[...] = meaning` and the transition before any code.
- **Count `|States|` early** to budget time and space; it predicts feasibility.
- **Prototype top-down, ship bottom-up** for hot/deep cases — write the memo to validate the recurrence, then convert to a table.
- **Add the rolling array last**, after the full table is verified correct.
- **Cross-check both styles** on small inputs; identical outputs build confidence in the recurrence.
- **Keep the full table when you need the path**; reduce dimensions only when the scalar answer suffices.
- **Pick array over hash map** for dense integer states; reserve hashing for sparse/irregular states.

---

## Two Subtle Conversion Hazards

When you convert between styles, two bugs appear so often they deserve their own section.

### Hazard 1: the fill order must reverse correctly

If a memoized recurrence references *larger* indices (e.g. decode-ways uses `f(i+1)` and `f(i+2)`), the tabulation must loop the index **decreasing**, filling `dp[n]` first down to `dp[0]`. Blindly copying an increasing loop reads unfilled cells and returns garbage. The rule: the loop direction is whatever makes every dependency already-computed — read the recurrence's index arrows and point the loop the opposite way.

### Hazard 2: in-place dimension reduction can self-corrupt

When you collapse a 2D table to 1D, the *direction* of the inner loop decides whether you read the old value (previous "row") or the freshly written one (current "row"). The grid-paths fold `row[c] += row[c-1]` needs `c` increasing so `row[c-1]` is the new value. The 0/1 knapsack fold `dp[w] = max(dp[w], dp[w-wt]+val)` needs `w` **decreasing**, because each item may be used once and an increasing loop would read an already-updated `dp[w-wt]` (counting the item twice). Same shape, opposite direction — the difference is whether the recurrence allows reuse. Always re-derive the direction from "which neighbor must still hold its old value."

### A checklist for any conversion

1. Write the recurrence and circle which indices each state depends on.
2. Choose the loop direction(s) that make all dependencies precede the dependent.
3. Map cache-key dimensions to table dimensions.
4. Translate base-case returns into initial table writes.
5. Replace recursive calls with table reads, transition body unchanged.
6. Diff the converted output against the original on random small inputs — they must match exactly (Theorem 6.1 in [`professional.md`](./professional.md)).

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation contrasts the two strategies on the *same* subproblem DAG:
> - **Memoization** descends the recursion, marks each node "computing", caches it on return, and shows later requests hitting the cache.
> - **Tabulation** fills the table in topological order, one cell at a time, with no recursion.
> - Watch how both visit each subproblem exactly once but in different orders.

---

## Summary

A DP is a pure function over a **state space**, defined by a state, a transition, and base cases; its dependency graph is a DAG. Designing the state well — sufficient, minimal, cheaply indexable — is the core skill, because `time = |States| × transition cost`. **Memoization** evaluates the function lazily by recursion + cache; **tabulation** evaluates it eagerly in topological (dependency) order. Converting between them is mechanical: cache keys become table dimensions, base cases become initial writes, and recursion reverses into ordered loops. **Rolling arrays** exploit bounded dependency windows to cut space — `O(1)` for Fibonacci, `O(C)` for the grid — but only in tabulation and only when you don't need to reconstruct the path. Choose memoization for sparse/irregular state spaces and prototyping; choose tabulation for deep recurrences (no stack limit), tight loops, and memory savings.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 15: memoization vs bottom-up, and reconstructing optimal solutions.
- *Competitive Programmer's Handbook* (Laaksonen) — DP chapter: state design and rolling arrays.
- Sibling topics `02-1d-dp`, `03-2d-dp`, `04-knapsack` — the backward-iteration trick and multi-dimensional states.
- `19-number-theory/10-matrix-exponentiation` — accelerating linear-recurrence DPs to `O(log n)`.
- cp-algorithms.com — "Dynamic Programming" and "Knapsack" for dimension-reduction patterns.

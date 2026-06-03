# Memoization vs Tabulation — Interview Preparation

Memoization vs tabulation is one of the most reliable interview filters: it rewards a single crisp insight — *"a DP is a function over a state space; memoize it top-down with a cache or tabulate it bottom-up with a table"* — and then tests whether you can (a) design the right state, (b) write a correct transition with base cases, (c) convert between the two styles on demand, (d) reduce space with a rolling array, and (e) reason about recursion depth and overflow. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Memoization (top-down) | Tabulation (bottom-up) |
|--------|------------------------|------------------------|
| Mechanism | recursion + cache | loop + table |
| Order | lazy, recursion-driven | eager, topological |
| Stack | depth ≈ longest chain | none |
| Solves unreachable states? | no | yes (all in range) |
| Rolling-array space opt | awkward | natural |
| Typical risk | stack overflow | wrong fill order |

```text
# Memoization skeleton
solve(s, cache):
    if base(s): return base_value(s)
    if s in cache: return cache[s]
    cache[s] = combine(solve(sub) for sub in subs(s))
    return cache[s]

# Tabulation skeleton
dp = table(#states); dp[base] = base_value
for s in dependency order:
    dp[s] = combine(dp[sub] for sub in subs(s))
return dp[target]
```

Key facts to recite:
- DP needs **optimal substructure** + **overlapping subproblems**.
- `time = (#states) × (transition cost)`; `space = #states` (or a rolling window).
- Both styles compute the **same function** → must give the **same answer**.
- Memoization depth = longest dependency chain → stack-overflow risk at large `n`.
- Rolling array works when a state depends on a **bounded window** of recent states; it forfeits **path reconstruction**.
- Running recurrences: `fib(n)=fib(n-1)+fib(n-2)`; `climb(n)=climb(n-1)+climb(n-2)`; `grid(r,c)=grid(r-1,c)+grid(r,c-1)`.

---

## Junior Questions (12 Q&A)

**Q1. What is dynamic programming in one sentence?**
Solving a problem by computing each overlapping subproblem once and reusing its stored answer, exploiting optimal substructure.

**Q2. What are the two properties a problem must have for DP to apply?**
Optimal substructure (the answer is built from subproblem answers) and overlapping subproblems (the same subproblems recur). Without overlap it's just divide-and-conquer.

**Q3. Define memoization.**
Top-down DP: keep the natural recursion but cache each subproblem's result, returning the cached value on repeat calls.

**Q4. Define tabulation.**
Bottom-up DP: fill a table iteratively, starting from base cases and computing each state from already-filled smaller states.

**Q5. Do memoization and tabulation give the same answer?**
Yes — they evaluate the same recurrence, so they compute the same function. If they differ, one has a bug.

**Q6. What is the time complexity of naive recursive Fibonacci, and why?**
`O(2^n)` (more precisely `Θ(φ^n)`) because it recomputes overlapping subproblems; the call tree is exponential.

**Q7. What does DP reduce that to?**
`O(n)` — each of the `n+1` states is computed once.

**Q8. What is a "state" in DP?**
The minimal set of parameters that uniquely identifies a subproblem (e.g. `n` for Fibonacci, `(r,c)` for a grid).

**Q9. What is the transition?**
The recurrence rule that builds a state's answer from smaller states' answers.

**Q10. Why must tabulation fill the table in a particular order?**
Each state's dependencies must already be computed when you reach it — a topological order of the dependency DAG.

**Q11. Climbing stairs with 1 or 2 steps — what's the recurrence?**
`ways(n) = ways(n-1) + ways(n-2)`, with `ways(0)=ways(1)=1`. Same shape as Fibonacci.

**Q12. How many paths in an `R×C` grid moving only right/down?**
`grid(r,c) = grid(r-1,c) + grid(r,c-1)`, base `grid(0,0)=1` — equals the binomial `C(R+C-2, R-1)`.

---

## Mid-Level Questions (10 Q&A)

**Q1. When would you prefer memoization over tabulation?**
When only a sparse subset of states is reachable (memoization skips the rest), when the recurrence is irregular, or when prototyping to match the math quickly.

**Q2. When would you prefer tabulation?**
When recursion would be too deep (stack overflow), in hot loops where call/hash overhead matters, or when you want a rolling-array space reduction.

**Q3. How do you convert a memoized solution to tabulation?**
Cache-key shape → table dimensions; base cases → initial writes; reverse the recursion into a forward loop in topological order; replace recursive calls with table reads.

**Q4. What is a rolling array and when is it valid?**
Keeping only the last `w` values when a state depends only on a window of `w` recent states. Fibonacci → 2 vars (`O(1)`); grid → one row (`O(C)`). Valid only if you overwrite a slot after its last read.

**Q5. What does a rolling array cost you?**
Path reconstruction — you no longer have the full table to trace the optimal choices.

**Q6. Give the time/space of the grid DP both ways.**
Time `O(R·C)` both. Space: full table `O(R·C)`, rolling row `O(C)`, memoization `O(R·C)` cache + `O(R+C)` stack.

**Q7. Why is the formula `time = states × transition cost` so useful?**
It predicts feasibility before coding: count the states, multiply by per-state work. Adding a state dimension multiplies cost.

**Q8. Climbing stairs with arbitrary step set `S` — what changes?**
The state stays `n`; the transition sums over `S`, so transition cost becomes `O(|S|)` and total time `O(n·|S|)`.

**Q9. How do you avoid integer overflow in counting DPs?**
Use 64-bit accumulators and take results mod a prime (`10^9+7`) if the problem asks, reducing after each `+`/`×`.

**Q10. What's the danger of a mutable default cache in Python?**
`def f(n, cache={})` shares one dict across all calls, leaking state between runs; default to `None` and create a fresh dict inside.

---

## Senior Questions (8 Q&A)

**Q1. A memoized DP overflows the stack at `n = 10^6`. What do you do?**
Switch to tabulation (no stack), or make the memoization iterative with an explicit heap stack, or warm the cache bottom-up so the top call is shallow. Raising the recursion limit is only a stopgap.

**Q2. Your long-running service's memo cache causes OOM. Diagnosis and fix?**
The cache is unbounded across queries. Scope it per request (drop after each call) or bound it with an LRU `maxsize`. Never evict states on the active dependency path within a single evaluation.

**Q3. How do you keep memoization's sparsity benefit but tabulation's flat evaluation?**
A two-phase hybrid: a (stack-safe) discovery pass enumerates reachable states and edges, then evaluate bottom-up in topological order over just that reachable set.

**Q4. How do you test a DP you can't brute-force at scale?**
Equivalence-test memoization against tabulation on randomized small inputs; use a brute-force oracle on tiny inputs; property tests (monotonicity, boundary identities, modular invariant); a depth-stress test at max supported `n`.

**Q5. What metrics would you instrument?**
Cache hit ratio (drop signals state-design drift), distinct-states gauge (live `|States|`), recursion-depth high-water mark (alert before the platform ceiling), and table memory.

**Q6. When does a DP collapse to something faster than `O(states)`?**
Linear fixed-order recurrences (Fibonacci) → matrix exponentiation `O(log n)`; greedy-choice property → drop the min/max over dependencies to a single forced edge.

**Q7. Why must the dependency graph be acyclic?**
A cycle means a state depends on itself; recursion wouldn't terminate and no topological fill order exists. Acyclicity is necessary and sufficient for either style to work.

**Q8. How do you reconstruct the actual optimal solution, not just its value?**
Keep the full table (or parent/argmin pointers) and walk backward through the winning transitions — incompatible with an aggressive rolling array.

---

## Behavioral Prompts

- **"Tell me about a time you optimized a slow algorithm."** Frame it as recognizing overlapping subproblems and adding memoization, citing the before/after complexity (`O(2^n) → O(n)`) and how you verified correctness against the old output.
- **"Describe a production incident caused by an implementation detail."** A memoized solver that overflowed the stack at scale, or an unbounded cache OOM; explain how you found it (metrics: depth, RSS) and the fix (tabulation, scoped/bounded cache).
- **"How do you decide between two correct approaches?"** Pin the decision to the dominant constraint — depth, memory, latency, reconstruction — and document the trade-off rather than choosing by taste.
- **"How do you make a risky refactor safe?"** Keep both implementations temporarily and assert they agree on a randomized suite before deleting the old one.
- **"How do you explain a complex idea to a junior?"** Use the whiteboard analogy for overlapping subproblems and the bricklayer analogy for tabulation's forced order.

---

## Coding Challenge 1: Climbing Stairs (count ways)

**Problem.** Given `n` stairs, you may take 1 or 2 steps at a time. Return the number of distinct ways to reach the top, modulo `10^9+7`. Constraints: `0 ≤ n ≤ 10^7` (must be stack-safe and `O(1)` space).

**Approach.** `ways(n) = ways(n-1) + ways(n-2)`, `ways(0)=ways(1)=1`. Tabulate with two rolling variables; large `n` rules out memoization (stack) and a full array (memory not needed).

#### Go
```go
package main

import "fmt"

const MOD = 1_000_000_007

func climbStairs(n int) int64 {
	if n <= 1 {
		return 1
	}
	var a, b int64 = 1, 1 // ways(0), ways(1)
	for i := 2; i <= n; i++ {
		a, b = b, (a+b)%MOD
	}
	return b
}

func main() {
	fmt.Println(climbStairs(5))       // 8
	fmt.Println(climbStairs(0))       // 1
	fmt.Println(climbStairs(10000000))
}
```

#### Java
```java
public class ClimbStairs {
    static final long MOD = 1_000_000_007L;

    static long climbStairs(int n) {
        if (n <= 1) return 1;
        long a = 1, b = 1;               // ways(0), ways(1)
        for (int i = 2; i <= n; i++) {
            long c = (a + b) % MOD;
            a = b; b = c;
        }
        return b;
    }

    public static void main(String[] args) {
        System.out.println(climbStairs(5));         // 8
        System.out.println(climbStairs(0));         // 1
        System.out.println(climbStairs(10_000_000));
    }
}
```

#### Python
```python
MOD = 1_000_000_007


def climb_stairs(n):
    if n <= 1:
        return 1
    a, b = 1, 1                  # ways(0), ways(1)
    for _ in range(2, n + 1):
        a, b = b, (a + b) % MOD
    return b


if __name__ == "__main__":
    print(climb_stairs(5))         # 8
    print(climb_stairs(0))         # 1
    print(climb_stairs(10_000_000))
```

---

## Coding Challenge 2: Grid Unique Paths (both styles + rolling)

**Problem.** In an `R×C` grid, moving only right or down from `(0,0)`, count distinct paths to `(R-1,C-1)`. Return the count (fits in 64-bit for `R,C ≤ 30`). Provide both a memoized and a rolling-array solution.

**Approach.** `grid(r,c) = grid(r-1,c) + grid(r,c-1)`. Memoize top-down; tabulate bottom-up with one row for `O(C)` space.

#### Go
```go
package main

import "fmt"

func uniquePathsMemo(R, C int) int64 {
	cache := make(map[[2]int]int64)
	var f func(r, c int) int64
	f = func(r, c int) int64 {
		if r < 0 || c < 0 {
			return 0
		}
		if r == 0 && c == 0 {
			return 1
		}
		k := [2]int{r, c}
		if v, ok := cache[k]; ok {
			return v
		}
		cache[k] = f(r-1, c) + f(r, c-1)
		return cache[k]
	}
	return f(R-1, C-1)
}

func uniquePathsRolling(R, C int) int64 {
	row := make([]int64, C)
	for c := range row {
		row[c] = 1 // first row
	}
	for r := 1; r < R; r++ {
		for c := 1; c < C; c++ {
			row[c] += row[c-1]
		}
	}
	return row[C-1]
}

func main() {
	fmt.Println(uniquePathsMemo(3, 3))    // 6
	fmt.Println(uniquePathsRolling(3, 3)) // 6
	fmt.Println(uniquePathsRolling(3, 7)) // 28
}
```

#### Java
```java
import java.util.*;

public class UniquePaths {
    static long uniquePathsMemo(int R, int C) {
        Map<Long, Long> cache = new HashMap<>();
        return f(R - 1, C - 1, C, cache);
    }
    static long f(int r, int c, int C, Map<Long, Long> cache) {
        if (r < 0 || c < 0) return 0;
        if (r == 0 && c == 0) return 1;
        long k = (long) r * (C + 1) + c;
        Long v = cache.get(k);
        if (v != null) return v;
        long res = f(r - 1, c, C, cache) + f(r, c - 1, C, cache);
        cache.put(k, res);
        return res;
    }

    static long uniquePathsRolling(int R, int C) {
        long[] row = new long[C];
        Arrays.fill(row, 1);
        for (int r = 1; r < R; r++)
            for (int c = 1; c < C; c++)
                row[c] += row[c - 1];
        return row[C - 1];
    }

    public static void main(String[] args) {
        System.out.println(uniquePathsMemo(3, 3));    // 6
        System.out.println(uniquePathsRolling(3, 3)); // 6
        System.out.println(uniquePathsRolling(3, 7)); // 28
    }
}
```

#### Python
```python
from functools import lru_cache


def unique_paths_memo(R, C):
    @lru_cache(maxsize=None)
    def f(r, c):
        if r < 0 or c < 0:
            return 0
        if r == 0 and c == 0:
            return 1
        return f(r - 1, c) + f(r, c - 1)
    return f(R - 1, C - 1)


def unique_paths_rolling(R, C):
    row = [1] * C
    for _ in range(1, R):
        for c in range(1, C):
            row[c] += row[c - 1]
    return row[C - 1]


if __name__ == "__main__":
    print(unique_paths_memo(3, 3))    # 6
    print(unique_paths_rolling(3, 3)) # 6
    print(unique_paths_rolling(3, 7)) # 28
```

---

## Coding Challenge 3: Min-Cost Grid Path (optimization DP)

**Problem.** Given an `R×C` grid of non-negative costs, find the minimum total cost to go from top-left to bottom-right, moving only right/down. Return the min cost. This swaps the combine operation from `+` (counting) to `min` over predecessors plus the cell cost — same DAG, different semiring.

**Approach.** `dp[r][c] = cost[r][c] + min(dp[r-1][c], dp[r][c-1])`, with the first row/column accumulating. Rolling row gives `O(C)` space.

#### Go
```go
package main

import "fmt"

func minPathCost(cost [][]int) int {
	R, C := len(cost), len(cost[0])
	dp := make([]int, C)
	dp[0] = cost[0][0]
	for c := 1; c < C; c++ {
		dp[c] = dp[c-1] + cost[0][c] // first row
	}
	for r := 1; r < R; r++ {
		dp[0] += cost[r][0] // first column
		for c := 1; c < C; c++ {
			up, left := dp[c], dp[c-1]
			best := up
			if left < best {
				best = left
			}
			dp[c] = cost[r][c] + best
		}
	}
	return dp[C-1]
}

func main() {
	grid := [][]int{{1, 3, 1}, {1, 5, 1}, {4, 2, 1}}
	fmt.Println(minPathCost(grid)) // 7  (1→3→1→1→1)
}
```

#### Java
```java
public class MinPath {
    static int minPathCost(int[][] cost) {
        int R = cost.length, C = cost[0].length;
        int[] dp = new int[C];
        dp[0] = cost[0][0];
        for (int c = 1; c < C; c++) dp[c] = dp[c - 1] + cost[0][c];
        for (int r = 1; r < R; r++) {
            dp[0] += cost[r][0];
            for (int c = 1; c < C; c++) {
                int best = Math.min(dp[c], dp[c - 1]);
                dp[c] = cost[r][c] + best;
            }
        }
        return dp[C - 1];
    }

    public static void main(String[] args) {
        int[][] grid = {{1, 3, 1}, {1, 5, 1}, {4, 2, 1}};
        System.out.println(minPathCost(grid)); // 7
    }
}
```

#### Python
```python
def min_path_cost(cost):
    R, C = len(cost), len(cost[0])
    dp = [0] * C
    dp[0] = cost[0][0]
    for c in range(1, C):
        dp[c] = dp[c - 1] + cost[0][c]
    for r in range(1, R):
        dp[0] += cost[r][0]
        for c in range(1, C):
            dp[c] = cost[r][c] + min(dp[c], dp[c - 1])
    return dp[C - 1]


if __name__ == "__main__":
    grid = [[1, 3, 1], [1, 5, 1], [4, 2, 1]]
    print(min_path_cost(grid))  # 7
```

---

## Coding Challenge 4: Convert Memo to Tabulation (the meta-skill)

**Problem.** Given the memoized "decode ways" recurrence (count ways to decode a digit string where `1..26` map to letters), produce **both** a top-down memoized solution and a bottom-up tabulated one, and confirm they agree. State: index `i` into the string; transition: take one digit (if non-zero) plus two digits (if `10..26`).

**Approach.** `f(i) = f(i+1)·[s[i]≠'0'] + f(i+2)·[10 ≤ s[i..i+1] ≤ 26]`, base `f(len)=1`. Memo recurses forward; tabulation fills `dp[len]` down to `dp[0]` (note the topological order runs high index → low index here).

#### Go
```go
package main

import "fmt"

func numDecodingsMemo(s string) int {
	n := len(s)
	cache := make([]int, n+1)
	for i := range cache {
		cache[i] = -1
	}
	var f func(i int) int
	f = func(i int) int {
		if i == n {
			return 1
		}
		if s[i] == '0' {
			return 0
		}
		if cache[i] != -1 {
			return cache[i]
		}
		res := f(i + 1)
		if i+1 < n && (s[i] == '1' || (s[i] == '2' && s[i+1] <= '6')) {
			res += f(i + 2)
		}
		cache[i] = res
		return res
	}
	return f(0)
}

func numDecodingsTab(s string) int {
	n := len(s)
	dp := make([]int, n+1)
	dp[n] = 1
	for i := n - 1; i >= 0; i-- {
		if s[i] == '0' {
			dp[i] = 0
			continue
		}
		dp[i] = dp[i+1]
		if i+1 < n && (s[i] == '1' || (s[i] == '2' && s[i+1] <= '6')) {
			dp[i] += dp[i+2]
		}
	}
	return dp[0]
}

func main() {
	for _, s := range []string{"226", "12", "06", "100"} {
		fmt.Println(s, numDecodingsMemo(s), numDecodingsTab(s))
	}
}
```

#### Java
```java
import java.util.Arrays;

public class Decode {
    static int numDecodingsMemo(String s) {
        int n = s.length();
        int[] cache = new int[n + 1];
        Arrays.fill(cache, -1);
        return f(s, 0, cache);
    }
    static int f(String s, int i, int[] cache) {
        int n = s.length();
        if (i == n) return 1;
        if (s.charAt(i) == '0') return 0;
        if (cache[i] != -1) return cache[i];
        int res = f(s, i + 1, cache);
        if (i + 1 < n && (s.charAt(i) == '1'
                || (s.charAt(i) == '2' && s.charAt(i + 1) <= '6')))
            res += f(s, i + 2, cache);
        cache[i] = res;
        return res;
    }

    static int numDecodingsTab(String s) {
        int n = s.length();
        int[] dp = new int[n + 1];
        dp[n] = 1;
        for (int i = n - 1; i >= 0; i--) {
            if (s.charAt(i) == '0') { dp[i] = 0; continue; }
            dp[i] = dp[i + 1];
            if (i + 1 < n && (s.charAt(i) == '1'
                    || (s.charAt(i) == '2' && s.charAt(i + 1) <= '6')))
                dp[i] += dp[i + 2];
        }
        return dp[0];
    }

    public static void main(String[] args) {
        for (String s : new String[]{"226", "12", "06", "100"})
            System.out.println(s + " " + numDecodingsMemo(s) + " " + numDecodingsTab(s));
    }
}
```

#### Python
```python
from functools import lru_cache


def num_decodings_memo(s):
    n = len(s)

    @lru_cache(maxsize=None)
    def f(i):
        if i == n:
            return 1
        if s[i] == '0':
            return 0
        res = f(i + 1)
        if i + 1 < n and (s[i] == '1' or (s[i] == '2' and s[i + 1] <= '6')):
            res += f(i + 2)
        return res
    return f(0)


def num_decodings_tab(s):
    n = len(s)
    dp = [0] * (n + 1)
    dp[n] = 1
    for i in range(n - 1, -1, -1):
        if s[i] == '0':
            dp[i] = 0
            continue
        dp[i] = dp[i + 1]
        if i + 1 < n and (s[i] == '1' or (s[i] == '2' and s[i + 1] <= '6')):
            dp[i] += dp[i + 2]
    return dp[0]


if __name__ == "__main__":
    for s in ["226", "12", "06", "100"]:
        print(s, num_decodings_memo(s), num_decodings_tab(s))
```

Expected: `226 → 3`, `12 → 2`, `06 → 0`, `100 → 0` — and the two implementations agree on every input, which is the whole point of the exercise.

---

## Closing Advice

In an interview, narrate the universal recipe before coding: *"Let me define the state, write the transition and base cases, then I'll memoize it — and I can convert to bottom-up if we need to avoid recursion depth or save space."* That single sentence demonstrates you see DP as one idea with two encodings, not two unrelated tricks. Always sanity-check small inputs out loud, mention the `states × transition` complexity, and proactively flag the stack-depth and overflow risks — interviewers grade the reasoning as much as the code.

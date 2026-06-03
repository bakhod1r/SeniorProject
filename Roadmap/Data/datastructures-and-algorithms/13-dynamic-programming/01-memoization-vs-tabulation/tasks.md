# Memoization vs Tabulation — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement both styles where asked and confirm they agree.
> **Always verify memoization and tabulation produce identical results on small inputs before trusting either.**

---

## Beginner Tasks (5)

### Task 1 — Fibonacci three ways

**Problem.** Implement `fib(n)` three ways: naive recursion (no cache), memoization, and tabulation. Confirm all three agree for `0 ≤ n ≤ 30`.

**Input / Output spec.**
- Read `n`.
- Print the three results space-separated (they must be equal).

**Constraints.**
- `0 ≤ n ≤ 40` (naive recursion is fine up to ~40).
- `fib(0)=0`, `fib(1)=1`.

**Hint.** Memoization = naive recursion + a cache check at the top and a write before returning. Tabulation = an array filled left to right.

**Starter — Go.**
```go
package main

import "fmt"

func fibNaive(n int) int {
	// TODO
	return 0
}
func fibMemo(n int, cache map[int]int) int {
	// TODO
	return 0
}
func fibTab(n int) int {
	// TODO
	return 0
}
func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(fibNaive(n), fibMemo(n, map[int]int{}), fibTab(n))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task1 {
    static int fibNaive(int n) { return 0; /* TODO */ }
    static int fibMemo(int n, Map<Integer,Integer> c) { return 0; /* TODO */ }
    static int fibTab(int n) { return 0; /* TODO */ }
    public static void main(String[] a) {
        int n = new Scanner(System.in).nextInt();
        System.out.println(fibNaive(n)+" "+fibMemo(n,new HashMap<>())+" "+fibTab(n));
    }
}
```

**Starter — Python.**
```python
def fib_naive(n):
    pass  # TODO

def fib_memo(n, cache=None):
    pass  # TODO

def fib_tab(n):
    pass  # TODO

if __name__ == "__main__":
    n = int(input())
    print(fib_naive(n), fib_memo(n), fib_tab(n))
```

---

### Task 2 — Climbing stairs (1 or 2 steps)

**Problem.** Count distinct ways to climb `n` stairs taking 1 or 2 steps. Return the count modulo `10^9+7`.

**Input / Output spec.** Read `n`; print `ways(n) mod (10^9+7)`.

**Constraints.** `0 ≤ n ≤ 10^6`. Must be stack-safe → use tabulation, ideally two rolling variables.

**Hint.** `ways(n) = ways(n-1) + ways(n-2)`, `ways(0)=ways(1)=1`. Keep two variables, not an array.

**Starter — Go.**
```go
package main
import "fmt"
const MOD = 1_000_000_007
func climb(n int) int64 {
	// TODO: rolling two-variable tabulation
	return 0
}
func main() { var n int; fmt.Scan(&n); fmt.Println(climb(n)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task2 {
    static final long MOD = 1_000_000_007L;
    static long climb(int n) { return 0; /* TODO */ }
    public static void main(String[] a) {
        System.out.println(climb(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
MOD = 1_000_000_007
def climb(n):
    pass  # TODO: rolling two-variable tabulation
if __name__ == "__main__":
    print(climb(int(input())))
```

---

### Task 3 — Unique grid paths

**Problem.** Count distinct right/down paths in an `R×C` grid from top-left to bottom-right.

**Input / Output spec.** Read `R` and `C`; print the path count (fits in 64-bit for `R,C ≤ 30`).

**Constraints.** `1 ≤ R, C ≤ 30`.

**Hint.** `paths(r,c) = paths(r-1,c) + paths(r,c-1)`, `paths(0,0)=1`. A single rolling row gives `O(C)` space.

**Starter — Go.**
```go
package main
import "fmt"
func uniquePaths(R, C int) int64 {
	// TODO: rolling-row tabulation
	return 0
}
func main() { var R, C int; fmt.Scan(&R, &C); fmt.Println(uniquePaths(R, C)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task3 {
    static long uniquePaths(int R, int C) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        System.out.println(uniquePaths(s.nextInt(), s.nextInt()));
    }
}
```

**Starter — Python.**
```python
def unique_paths(R, C):
    pass  # TODO: rolling-row tabulation
if __name__ == "__main__":
    R, C = map(int, input().split())
    print(unique_paths(R, C))
```

---

### Task 4 — Memoize an existing slow function

**Problem.** You are given a correct but exponential recursion for the number of ways to tile a `2×n` board with dominoes (`f(n)=f(n-1)+f(n-2)`, `f(0)=1`, `f(1)=1`). Add memoization without changing the recurrence's shape; confirm it now runs for `n = 90` instantly.

**Input / Output spec.** Read `n`; print `f(n)` (use 64-bit; values fit for `n ≤ 90`).

**Constraints.** `0 ≤ n ≤ 90`.

**Hint.** Three edits: cache parameter, early return on hit, write before return.

**Starter — Go.**
```go
package main
import "fmt"
// Given (slow): func f(n int) int64 { if n<2 {return 1}; return f(n-1)+f(n-2) }
func f(n int, cache map[int]int64) int64 {
	// TODO: memoize
	return 0
}
func main() { var n int; fmt.Scan(&n); fmt.Println(f(n, map[int]int64{})) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task4 {
    static long f(int n, Map<Integer,Long> cache) { return 0; /* TODO */ }
    public static void main(String[] a) {
        System.out.println(f(new Scanner(System.in).nextInt(), new HashMap<>()));
    }
}
```

**Starter — Python.**
```python
def f(n, cache=None):
    pass  # TODO: memoize the recurrence f(n)=f(n-1)+f(n-2), f(0)=f(1)=1
if __name__ == "__main__":
    print(f(int(input())))
```

---

### Task 5 — Min-cost grid path

**Problem.** Given an `R×C` grid of non-negative integers, find the minimum sum along a right/down path from top-left to bottom-right.

**Input / Output spec.** Read `R`, `C`, then `R` rows of `C` integers; print the minimum path sum.

**Constraints.** `1 ≤ R, C ≤ 200`, cell values `0 ≤ v ≤ 1000`.

**Hint.** `dp[r][c] = cost[r][c] + min(dp[r-1][c], dp[r][c-1])`. First row/column accumulate. Rolling row gives `O(C)` space.

**Starter — Go.**
```go
package main
import "fmt"
func minPath(cost [][]int) int {
	// TODO
	return 0
}
func main() {
	var R, C int
	fmt.Scan(&R, &C)
	cost := make([][]int, R)
	for i := range cost {
		cost[i] = make([]int, C)
		for j := range cost[i] { fmt.Scan(&cost[i][j]) }
	}
	fmt.Println(minPath(cost))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task5 {
    static int minPath(int[][] cost) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        int R = s.nextInt(), C = s.nextInt();
        int[][] cost = new int[R][C];
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) cost[i][j] = s.nextInt();
        System.out.println(minPath(cost));
    }
}
```

**Starter — Python.**
```python
def min_path(cost):
    pass  # TODO
if __name__ == "__main__":
    R, C = map(int, input().split())
    cost = [list(map(int, input().split())) for _ in range(R)]
    print(min_path(cost))
```

---

## Intermediate Tasks (4)

### Task 6 — Convert memoization to tabulation

**Problem.** Given a memoized "coin change — count ways" solver (count the number of ways to make `amount` using unlimited coins from a list), write the equivalent bottom-up tabulation and assert both agree for several inputs.

**Input / Output spec.** Read `amount`, then a line of coin denominations; print the number of combinations (order does not matter), printed twice (memo, then tab) to confirm equality.

**Constraints.** `0 ≤ amount ≤ 5000`, `1 ≤ #coins ≤ 50`, coin value `≤ 5000`. Use 64-bit.

**Hint.** Memo state `(i, rem)` = ways using coins `i..` to make `rem`. Tabulation: `dp[a] += dp[a-coin]` looping coins outer, amount inner (order matters to avoid counting permutations).

**Starter — Go.**
```go
package main
import "fmt"
func waysMemo(coins []int, amount int) int64 {
	// TODO: memo on (index, remaining)
	return 0
}
func waysTab(coins []int, amount int) int64 {
	// TODO: dp over amounts, coins outer loop
	return 0
}
func main() {
	var amount, k int
	fmt.Scan(&amount, &k)
	coins := make([]int, k)
	for i := range coins { fmt.Scan(&coins[i]) }
	fmt.Println(waysMemo(coins, amount), waysTab(coins, amount))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task6 {
    static long waysMemo(int[] coins, int amount) { return 0; /* TODO */ }
    static long waysTab(int[] coins, int amount) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        int amount = s.nextInt(), k = s.nextInt();
        int[] coins = new int[k];
        for (int i = 0; i < k; i++) coins[i] = s.nextInt();
        System.out.println(waysMemo(coins, amount) + " " + waysTab(coins, amount));
    }
}
```

**Starter — Python.**
```python
def ways_memo(coins, amount):
    pass  # TODO: memo on (index, remaining)

def ways_tab(coins, amount):
    pass  # TODO: dp over amounts, coins outer loop

if __name__ == "__main__":
    amount, _k = map(int, input().split())
    coins = list(map(int, input().split()))
    print(ways_memo(coins, amount), ways_tab(coins, amount))
```

---

### Task 7 — Rolling-array space reduction

**Problem.** Compute the number of unique paths in an `R×C` grid with some blocked cells (`1` = blocked). Use a single rolling row (`O(C)` space). Blocked cells contribute 0.

**Input / Output spec.** Read `R`, `C`, then the grid (`0` open, `1` blocked); print path count from `(0,0)` to `(R-1,C-1)`.

**Constraints.** `1 ≤ R, C ≤ 1000`. Use 64-bit. If start or end is blocked, answer is 0.

**Hint.** `row[c] = 0` if blocked, else `row[c] += row[c-1]` (with `row[c]` carrying the "up" value). Initialize the first row carefully, stopping at the first block.

**Starter — Go.**
```go
package main
import "fmt"
func uniquePathsBlocked(g [][]int) int64 {
	// TODO: rolling row, blocked cells = 0
	return 0
}
func main() {
	var R, C int
	fmt.Scan(&R, &C)
	g := make([][]int, R)
	for i := range g {
		g[i] = make([]int, C)
		for j := range g[i] { fmt.Scan(&g[i][j]) }
	}
	fmt.Println(uniquePathsBlocked(g))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task7 {
    static long uniquePathsBlocked(int[][] g) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        int R = s.nextInt(), C = s.nextInt();
        int[][] g = new int[R][C];
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) g[i][j] = s.nextInt();
        System.out.println(uniquePathsBlocked(g));
    }
}
```

**Starter — Python.**
```python
def unique_paths_blocked(g):
    pass  # TODO: rolling row, blocked = 0
if __name__ == "__main__":
    R, C = map(int, input().split())
    g = [list(map(int, input().split())) for _ in range(R)]
    print(unique_paths_blocked(g))
```

---

### Task 8 — Climbing stairs with a custom step set

**Problem.** Count ways to climb `n` stairs given an allowed step-set `S` (e.g. `{1,3,5}`). Return the count mod `10^9+7`. Provide both memoized and tabulated solutions.

**Input / Output spec.** Read `n`, then a line of allowed step sizes; print the count both ways (equal).

**Constraints.** `0 ≤ n ≤ 10^5`, `1 ≤ |S| ≤ 10`, step sizes `≤ n`.

**Hint.** `ways(n) = Σ_{s∈S} ways(n-s)`, `ways(0)=1`, `ways(<0)=0`. Watch recursion depth in the memo version for large `n`.

**Starter — Go.**
```go
package main
import "fmt"
const MOD = 1_000_000_007
func climbMemo(n int, steps []int, cache map[int]int64) int64 {
	// TODO
	return 0
}
func climbTab(n int, steps []int) int64 {
	// TODO
	return 0
}
func main() {
	var n, k int
	fmt.Scan(&n, &k)
	steps := make([]int, k)
	for i := range steps { fmt.Scan(&steps[i]) }
	fmt.Println(climbMemo(n, steps, map[int]int64{}), climbTab(n, steps))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task8 {
    static final long MOD = 1_000_000_007L;
    static long climbMemo(int n, int[] steps, Map<Integer,Long> c) { return 0; /* TODO */ }
    static long climbTab(int n, int[] steps) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        int n = s.nextInt(), k = s.nextInt();
        int[] steps = new int[k];
        for (int i = 0; i < k; i++) steps[i] = s.nextInt();
        System.out.println(climbMemo(n, steps, new HashMap<>()) + " " + climbTab(n, steps));
    }
}
```

**Starter — Python.**
```python
MOD = 1_000_000_007
def climb_memo(n, steps, cache=None):
    pass  # TODO
def climb_tab(n, steps):
    pass  # TODO
if __name__ == "__main__":
    n, _k = map(int, input().split())
    steps = list(map(int, input().split()))
    print(climb_memo(n, steps), climb_tab(n, steps))
```

---

## Advanced Tasks (3)

### Task 9 — Stack-safe iterative memoization

**Problem.** Implement a memoized grid-path counter that does **not** use language recursion (no call-stack growth), using an explicit work stack. It must handle `R = C = 5000` without overflowing. Compare against a tabulated reference.

**Input / Output spec.** Read `R`, `C`; print the path count mod `10^9+7` from the iterative-memo solver and the tabulated reference (equal).

**Constraints.** `1 ≤ R, C ≤ 5000`. Reduce mod `10^9+7`.

**Hint.** Two-phase frames: phase 0 pushes children, phase 1 combines their cached values. Use a hash map (or flat array) keyed by `(r,c)`.

**Starter — Go.**
```go
package main
import "fmt"
const MOD = 1_000_000_007
func gridIterMemo(R, C int) int64 {
	// TODO: explicit stack of {r,c,phase}; no recursion
	return 0
}
func gridTab(R, C int) int64 {
	// TODO: reference rolling-row tabulation, mod MOD
	return 0
}
func main() { var R, C int; fmt.Scan(&R, &C); fmt.Println(gridIterMemo(R, C), gridTab(R, C)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task9 {
    static final long MOD = 1_000_000_007L;
    static long gridIterMemo(int R, int C) { return 0; /* TODO */ }
    static long gridTab(int R, int C) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        int R = s.nextInt(), C = s.nextInt();
        System.out.println(gridIterMemo(R, C) + " " + gridTab(R, C));
    }
}
```

**Starter — Python.**
```python
MOD = 1_000_000_007
def grid_iter_memo(R, C):
    pass  # TODO: explicit stack of (r,c,phase); no recursion
def grid_tab(R, C):
    pass  # TODO: reference rolling-row tabulation
if __name__ == "__main__":
    R, C = map(int, input().split())
    print(grid_iter_memo(R, C), grid_tab(R, C))
```

---

### Task 10 — Reconstruct the optimal path

**Problem.** For the min-cost grid path, return not just the minimum cost but the actual sequence of moves (`R`/`D`). This requires the full table or parent pointers — a rolling array will not suffice. Explain in a comment why.

**Input / Output spec.** Read `R`, `C`, then the cost grid; print the min cost, then the move string (e.g. `RRDD`).

**Constraints.** `1 ≤ R, C ≤ 500`, costs `0 ≤ v ≤ 1000`.

**Hint.** Fill the full `dp` table, then walk from `(R-1,C-1)` to `(0,0)` choosing the smaller predecessor at each step; reverse the recorded moves.

**Starter — Go.**
```go
package main
import "fmt"
func minPathWithRoute(cost [][]int) (int, string) {
	// TODO: full dp table + backtrack
	return 0, ""
}
func main() {
	var R, C int
	fmt.Scan(&R, &C)
	cost := make([][]int, R)
	for i := range cost {
		cost[i] = make([]int, C)
		for j := range cost[i] { fmt.Scan(&cost[i][j]) }
	}
	c, route := minPathWithRoute(cost)
	fmt.Println(c)
	fmt.Println(route)
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task10 {
    // returns {cost, route} packed; implement as you prefer
    static Object[] minPathWithRoute(int[][] cost) { return new Object[]{0, ""}; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        int R = s.nextInt(), C = s.nextInt();
        int[][] cost = new int[R][C];
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) cost[i][j] = s.nextInt();
        Object[] res = minPathWithRoute(cost);
        System.out.println(res[0]);
        System.out.println(res[1]);
    }
}
```

**Starter — Python.**
```python
def min_path_with_route(cost):
    pass  # TODO: full dp table + backtrack; return (cost, route)
if __name__ == "__main__":
    R, C = map(int, input().split())
    cost = [list(map(int, input().split())) for _ in range(R)]
    c, route = min_path_with_route(cost)
    print(c)
    print(route)
```

---

### Task 11 — Equivalence test harness

**Problem.** Write a test harness that, for a chosen DP (e.g. climbing stairs with a random step set), generates random small inputs, runs **both** the memoized and tabulated solvers, and asserts they always agree. Report the number of cases passed. This codifies the central lesson: the two styles must produce identical answers.

**Input / Output spec.** Read a seed and a number of trials `T`; for each trial generate random `n` and step-set, compare both solvers, and finally print `OK <T>` if all agree (or the first mismatch).

**Constraints.** `1 ≤ T ≤ 10^4`, generated `n ≤ 2000`.

**Hint.** A mismatch means a bug in one solver (base case, fill order, or state key). Keep the generators deterministic from the seed for reproducibility.

**Starter — Go.**
```go
package main
import (
	"fmt"
	"math/rand"
)
func climbMemo(n int, steps []int, c map[int]int64) int64 { return 0 /* reuse Task 8 */ }
func climbTab(n int, steps []int) int64 { return 0 /* reuse Task 8 */ }
func main() {
	var seed int64
	var T int
	fmt.Scan(&seed, &T)
	r := rand.New(rand.NewSource(seed))
	for t := 0; t < T; t++ {
		n := r.Intn(2000)
		// TODO: random step set; compare both; report first mismatch
		_ = n
	}
	fmt.Printf("OK %d\n", T)
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task11 {
    static long climbMemo(int n, int[] s, Map<Integer,Long> c) { return 0; /* reuse */ }
    static long climbTab(int n, int[] s) { return 0; /* reuse */ }
    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        long seed = sc.nextLong(); int T = sc.nextInt();
        Random r = new Random(seed);
        for (int t = 0; t < T; t++) {
            int n = r.nextInt(2000);
            // TODO: random step set; compare; report mismatch
        }
        System.out.println("OK " + T);
    }
}
```

**Starter — Python.**
```python
import random
def climb_memo(n, steps, cache=None):
    pass  # reuse Task 8
def climb_tab(n, steps):
    pass  # reuse Task 8
if __name__ == "__main__":
    seed, T = map(int, input().split())
    rng = random.Random(seed)
    for _ in range(T):
        n = rng.randint(0, 2000)
        # TODO: random step set; compare both; report first mismatch
    print("OK", T)
```

---

## Evaluation Criteria

| Criterion | Beginner | Intermediate | Advanced |
|-----------|----------|--------------|----------|
| Correct base cases | required | required | required |
| Both styles agree | shown | asserted | harness-tested |
| Complexity stated | `states × transition` | with space analysis | with depth/memory budget |
| Space optimization | rolling where asked | rolling row | full table when path needed |
| Robustness | handles `n=0`, `1×1` grid | mod / overflow safe | stack-safe at scale |

Work each task in all three languages, run the provided `main`, and confirm the memoized and tabulated outputs match before considering the task done.

# N-Queens — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the backtracking / bitmask logic and validate against the evaluation criteria.
> **Always validate small `N` against the known sequence 1, 0, 0, 2, 10, 4, 40, 92, 352 before trusting larger runs.**

---

## Beginner Tasks (5)

### Task 1 — `O(1)` safety check

**Problem.** Implement `safe(r, c, cols, diag, anti, n)` returning whether a queen at `(r, c)` is non-attacking given the three occupancy arrays. Use the diagonal index `r - c + n - 1` and anti-diagonal index `r + c`.

**Input / Output spec.**
- Inputs: `r`, `c`, the three boolean arrays, and `n`.
- Output: `true` if the square is free of column/diagonal/anti-diagonal attacks, else `false`.

**Constraints.** `1 ≤ n ≤ 20`, `0 ≤ r, c < n`. `diag` and `anti` have length `2n - 1`.

**Hint.** Three array reads, ANDed together. Remember to shift the diagonal index by `+ (n - 1)`.

**Starter — Go.**
```go
package main

import "fmt"

func safe(r, c int, cols, diag, anti []bool, n int) bool {
	// TODO: return true iff column c, diag r-c+n-1, and anti r+c are all free
	return false
}

func main() {
	n := 4
	cols := make([]bool, n)
	diag := make([]bool, 2*n-1)
	anti := make([]bool, 2*n-1)
	cols[0] = true
	diag[0-0+n-1] = true
	anti[0+0] = true
	fmt.Println(safe(1, 2, cols, diag, anti, n)) // true
	fmt.Println(safe(1, 1, cols, diag, anti, n)) // false (same diag as (0,0))
}
```

**Starter — Java.**
```java
public class Task1 {
    static boolean safe(int r, int c, boolean[] cols, boolean[] diag, boolean[] anti, int n) {
        // TODO
        return false;
    }
    public static void main(String[] args) {
        int n = 4;
        boolean[] cols = new boolean[n], diag = new boolean[2*n-1], anti = new boolean[2*n-1];
        cols[0] = true; diag[n-1] = true; anti[0] = true;
        System.out.println(safe(1, 2, cols, diag, anti, n)); // true
        System.out.println(safe(1, 1, cols, diag, anti, n)); // false
    }
}
```

**Starter — Python.**
```python
def safe(r, c, cols, diag, anti, n):
    # TODO: return True iff column, diagonal, anti-diagonal are all free
    return False


if __name__ == "__main__":
    n = 4
    cols = [False] * n
    diag = [False] * (2 * n - 1)
    anti = [False] * (2 * n - 1)
    cols[0] = True; diag[n - 1] = True; anti[0] = True
    print(safe(1, 2, cols, diag, anti, n))  # True
    print(safe(1, 1, cols, diag, anti, n))  # False
```

**Evaluation.** Returns correct safety for all combinations; uses the shifted diagonal index.

---

### Task 2 — Count solutions for a single `N`

**Problem.** Given `N`, return the number of valid arrangements using the boolean-array backtracking.

**Input / Output spec.** Read `N`; print the count.

**Constraints.** `1 ≤ N ≤ 12`.

**Hint.** Recurse on the row; `count++` at `r == N`; pair every mark with an undo.

**Starter — Go.**
```go
package main

import "fmt"

func count(n int) int {
	// TODO: boolean-array backtracking
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(count(n))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task2 {
    static int count(int n) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        System.out.println(count(n));
    }
}
```

**Starter — Python.**
```python
def count(n):
    # TODO: boolean-array backtracking
    return 0


if __name__ == "__main__":
    print(count(int(input())))
```

**Evaluation.** `count(8) == 92`, `count(6) == 4`, `count(2) == 0`.

---

### Task 3 — Find and print one solution

**Problem.** Print one valid board (`Q`/`.`), or `NONE` if no solution exists.

**Input / Output spec.** Read `N`; print `N` lines, or `NONE`.

**Constraints.** `1 ≤ N ≤ 30`.

**Hint.** Early-exit backtracking: return `true` at the base case and propagate up.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	// TODO: find one solution, print board or "NONE"
	_ = n
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task3 {
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        // TODO: find one solution, print board or "NONE"
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    # TODO: find one solution, print board or "NONE"


if __name__ == "__main__":
    main()
```

**Evaluation.** Prints a board whose columns, `r-c`, and `r+c` are all distinct; prints `NONE` for `N = 2, 3`.

---

### Task 4 — Validate a candidate board

**Problem.** Given a permutation `pos[]` (`pos[r]` = column in row `r`), return whether it is a valid N-Queens solution.

**Input / Output spec.** Read `N`, then `N` integers `pos[0..N-1]`. Print `VALID` or `INVALID`.

**Constraints.** `1 ≤ N ≤ 1000`, `0 ≤ pos[r] < N`.

**Hint.** Use three sets; insert `pos[r]`, `r - pos[r]`, `r + pos[r]` and detect any repeat.

**Starter — Go.**
```go
package main

import "fmt"

func valid(pos []int) bool {
	// TODO: check columns, r-c, r+c all distinct
	return false
}

func main() {
	var n int
	fmt.Scan(&n)
	pos := make([]int, n)
	for i := range pos {
		fmt.Scan(&pos[i])
	}
	if valid(pos) {
		fmt.Println("VALID")
	} else {
		fmt.Println("INVALID")
	}
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task4 {
    static boolean valid(int[] pos) {
        // TODO
        return false;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] pos = new int[n];
        for (int i = 0; i < n; i++) pos[i] = sc.nextInt();
        System.out.println(valid(pos) ? "VALID" : "INVALID");
    }
}
```

**Starter — Python.**
```python
def valid(pos):
    # TODO: check columns, r-c, r+c all distinct
    return False


if __name__ == "__main__":
    n = int(input())
    pos = [int(x) for x in input().split()]
    print("VALID" if valid(pos) else "INVALID")
```

**Evaluation.** Runs in `O(N)`; correctly rejects column and both diagonal conflicts.

---

### Task 5 — Solution-count table

**Problem.** Print `N` and its solution count for `N = 1..K`.

**Input / Output spec.** Read `K`; print `K` lines `N count`.

**Constraints.** `1 ≤ K ≤ 12`.

**Hint.** Reuse your counter from Task 2 in a loop.

**Starter — Go.**
```go
package main

import "fmt"

func count(n int) int { return 0 /* TODO */ }

func main() {
	var k int
	fmt.Scan(&k)
	for n := 1; n <= k; n++ {
		fmt.Println(n, count(n))
	}
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task5 {
    static int count(int n) { return 0; /* TODO */ }
    public static void main(String[] args) {
        int k = new Scanner(System.in).nextInt();
        for (int n = 1; n <= k; n++) System.out.println(n + " " + count(n));
    }
}
```

**Starter — Python.**
```python
def count(n):
    return 0  # TODO


if __name__ == "__main__":
    k = int(input())
    for n in range(1, k + 1):
        print(n, count(n))
```

**Evaluation.** Matches `1,0,0,2,10,4,40,92,352,724,2680,14200`.

---

## Intermediate Tasks (4)

### Task 6 — Bitmask counter

**Problem.** Count solutions using the three-integer bitmask recursion (lowbit iteration, diagonal shifting, masks by value).

**Input / Output spec.** Read `N`; print the count.

**Constraints.** `1 ≤ N ≤ 16`.

**Hint.** `avail = ~(cols|diag|anti) & full`; `p = avail & -avail`; recurse with `(diag|p)<<1 & full`, `(anti|p)>>1`.

**Starter — Go.**
```go
package main

import "fmt"

func count(n int) int {
	full := (1 << n) - 1
	// TODO: bitmask recursion
	_ = full
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(count(n))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task6 {
    static int full;
    static int rec(int cols, int diag, int anti) {
        // TODO
        return 0;
    }
    static int count(int n) { full = (1 << n) - 1; return rec(0, 0, 0); }
    public static void main(String[] args) {
        System.out.println(count(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
def count(n):
    full = (1 << n) - 1
    # TODO: bitmask recursion
    return 0


if __name__ == "__main__":
    print(count(int(input())))
```

**Evaluation.** Matches the boolean version for `N = 1..14`; noticeably faster.

---

### Task 7 — Count with symmetry reduction

**Problem.** Count solutions but only search the left half of row-0 columns, double the result, and handle the odd-`N` center column once.

**Input / Output spec.** Read `N`; print the count.

**Constraints.** `1 ≤ N ≤ 16`.

**Hint.** Loop `c in 0..N/2-1` (double each), then if `N` odd add the center column `N/2` once.

**Starter — Go.**
```go
package main

import "fmt"

func count(n int) int {
	// TODO: bitmask + left-half symmetry, double, center once
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(count(n))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task7 {
    static int count(int n) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(count(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
def count(n):
    # TODO: bitmask + left-half symmetry
    return 0


if __name__ == "__main__":
    print(count(int(input())))
```

**Evaluation.** Equals the non-symmetry count for all `N`; about 2× faster. Verify odd `N` (e.g. 5, 7, 9) carefully.

---

### Task 8 — Print all distinct solutions

**Problem.** Print every solution board, separated by blank lines, with a header `Solution k:`.

**Input / Output spec.** Read `N`; print all boards and finally `Total: <count>`.

**Constraints.** `1 ≤ N ≤ 8`.

**Hint.** Count-all backtracking; reconstruct the board from `pos[]` at each leaf.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	// TODO: print all boards, then "Total: <count>"
	_ = n
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task8 {
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        // TODO: print all boards, then "Total: <count>"
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    # TODO: print all boards, then "Total: <count>"


if __name__ == "__main__":
    main()
```

**Evaluation.** For `N = 5` prints 10 boards; the trailing total matches the known count.

---

### Task 9 — Last-row popcount optimization

**Problem.** Implement the bitmask counter but collapse the final row using `popcount(available)`.

**Input / Output spec.** Read `N`; print the count.

**Constraints.** `1 ≤ N ≤ 16`.

**Hint.** When `row == N-1`, return the number of set bits in `available` instead of recursing.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func count(n int) int {
	full := (1 << n) - 1
	_ = full
	_ = bits.OnesCount
	// TODO: recursion with last-row popcount
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(count(n))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task9 {
    static int n, full;
    static int rec(int row, int cols, int diag, int anti) {
        // TODO: when row == n-1 return Integer.bitCount(available)
        return 0;
    }
    static int count(int N) { n = N; full = (1 << N) - 1; return N == 0 ? 1 : rec(0,0,0,0); }
    public static void main(String[] args) {
        System.out.println(count(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
def count(n):
    full = (1 << n) - 1
    # TODO: recursion with last-row popcount via bin(x).count("1")
    return 0


if __name__ == "__main__":
    print(count(int(input())))
```

**Evaluation.** Matches the plain bitmask count; measurably faster on `N = 14..16`.

---

## Advanced Tasks (3)

### Task 10 — Constructive single solution for huge `N`

**Problem.** Output one valid board for large `N` in `O(N)` using the constructive formula (no search). Print `pos[]` as `N` space-separated columns, or `NONE` for `N = 2, 3`.

**Input / Output spec.** Read `N`; print `pos[0..N-1]` or `NONE`.

**Constraints.** `1 ≤ N ≤ 1,000,000`.

**Hint.** Handle `N mod 6`; interleave even and odd columns with the small fixups for residues 2 and 3. Then `verify` with the `O(N)` triple-set check.

**Starter — Go.**
```go
package main

import "fmt"

func construct(n int) []int {
	// TODO: O(N) constructive placement; return nil for n==2 or 3
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	pos := construct(n)
	if pos == nil {
		fmt.Println("NONE")
		return
	}
	for i, c := range pos {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(c)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task10 {
    static int[] construct(int n) {
        // TODO: O(N) construction; return null for n == 2 or 3
        return null;
    }
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        int[] pos = construct(n);
        if (pos == null) { System.out.println("NONE"); return; }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(pos[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
def construct(n):
    # TODO: O(N) constructive placement; return None for n == 2 or 3
    return None


if __name__ == "__main__":
    n = int(input())
    pos = construct(n)
    print("NONE" if pos is None else " ".join(map(str, pos)))
```

**Evaluation.** For `N = 1,000,000` runs in well under a second; the output passes an independent `O(N)` validity check.

---

### Task 11 — N-Queens completion

**Problem.** Given pre-placed queens, count the number of completions (full solutions extending them). Validate the pre-placed queens are mutually non-attacking first; if not, output 0.

**Input / Output spec.** Read `N`, then `M`, then `M` lines `r c` of fixed queens. Print the number of completions.

**Constraints.** `1 ≤ N ≤ 15`, `0 ≤ M ≤ N`, at most one fixed queen per row.

**Hint.** Seed `cols/diag/anti` with the fixed queens; at a fixed row, descend with that queen's column only (no loop). Add a node budget for safety (completion is NP-complete).

**Starter — Go.**
```go
package main

import "fmt"

func completions(n int, fixed []int) int {
	// fixed[r] = column or -1
	// TODO: seed masks, search remaining rows; return 0 on a pre-placed clash
	return 0
}

func main() {
	var n, m int
	fmt.Scan(&n, &m)
	fixed := make([]int, n)
	for i := range fixed {
		fixed[i] = -1
	}
	for i := 0; i < m; i++ {
		var r, c int
		fmt.Scan(&r, &c)
		fixed[r] = c
	}
	fmt.Println(completions(n, fixed))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task11 {
    static int completions(int n, int[] fixed) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt();
        int[] fixed = new int[n];
        Arrays.fill(fixed, -1);
        for (int i = 0; i < m; i++) { int r = sc.nextInt(), c = sc.nextInt(); fixed[r] = c; }
        System.out.println(completions(n, fixed));
    }
}
```

**Starter — Python.**
```python
def completions(n, fixed):
    # fixed[r] = column or -1
    # TODO
    return 0


if __name__ == "__main__":
    n, m = map(int, input().split())
    fixed = [-1] * n
    for _ in range(m):
        r, c = map(int, input().split())
        fixed[r] = c
    print(completions(n, fixed))
```

**Evaluation.** With no fixed queens, equals the full count for `N`. A self-attacking prefix yields 0. Pinning the row-0 queen reduces the count consistently with full enumeration.

---

### Task 12 — Parallel counting

**Problem.** Count all solutions by splitting on the row-0 column across worker threads/goroutines and summing partial counts. Result must match the single-threaded count exactly.

**Input / Output spec.** Read `N`; print the count.

**Constraints.** `1 ≤ N ≤ 16`. Use 64-bit accumulators.

**Hint.** Each row-0 column defines an independent subtree (masks by value). Sum the partials under a mutex or via channels/futures.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"sync"
)

func count(n int) int64 {
	full := (1 << n) - 1
	var solve func(cols, diag, anti int) int64
	solve = func(cols, diag, anti int) int64 {
		// TODO: bitmask recursion returning int64
		_ = full
		return 0
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	var total int64
	for c := 0; c < n; c++ {
		c := c
		wg.Add(1)
		go func() {
			defer wg.Done()
			p := 1 << c
			sub := solve(p, p<<1, p>>1) // TODO: pass shifted masks correctly
			mu.Lock()
			total += sub
			mu.Unlock()
		}()
	}
	wg.Wait()
	return total
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(count(n))
}
```

**Starter — Java.**
```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
public class Task12 {
    static int full;
    static long solve(int cols, int diag, int anti) {
        // TODO
        return 0;
    }
    static long count(int n) throws Exception {
        full = (1 << n) - 1;
        AtomicLong total = new AtomicLong();
        ExecutorService pool = Executors.newFixedThreadPool(
            Runtime.getRuntime().availableProcessors());
        List<Future<?>> fs = new ArrayList<>();
        for (int c = 0; c < n; c++) {
            int cc = c;
            fs.add(pool.submit(() -> {
                int p = 1 << cc;
                total.addAndGet(solve(p, (p << 1) & full, p >> 1));
            }));
        }
        for (Future<?> f : fs) f.get();
        pool.shutdown();
        return total.get();
    }
    public static void main(String[] args) throws Exception {
        System.out.println(count(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
from concurrent.futures import ProcessPoolExecutor


def _subtree(args):
    n, c = args
    full = (1 << n) - 1

    def solve(cols, diag, anti):
        # TODO: bitmask recursion
        return 0

    p = 1 << c
    return solve(p, (p << 1) & full, p >> 1)


def count(n):
    with ProcessPoolExecutor() as ex:
        return sum(ex.map(_subtree, [(n, c) for c in range(n)]))


if __name__ == "__main__":
    print(count(int(input())))
```

**Evaluation.** Parallel total equals the single-threaded total for all `N`; speedup scales with cores; 64-bit accumulators avoid overflow.

---

## Validation Checklist

- [ ] Counts match A000170 (`1,0,0,2,10,4,40,92,352,…`) for every implementation.
- [ ] `N = 2` and `N = 3` return 0 / `NONE`.
- [ ] Diagonal index uses `r - c + N - 1` (size `2N - 1`).
- [ ] Every `mark` is paired with an `unmark` (boolean version) or masks are by value (bitmask version).
- [ ] Symmetry version never double-counts the odd-`N` center column.
- [ ] Constructed large-`N` boards pass an independent `O(N)` validity check.
- [ ] Parallel and single-threaded counts agree exactly; counters are 64-bit.

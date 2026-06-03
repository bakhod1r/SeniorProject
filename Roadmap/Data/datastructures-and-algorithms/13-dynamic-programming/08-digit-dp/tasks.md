# Digit DP (Counting Numbers in a Range with Digit Constraints) — Practice Tasks

These tasks build mastery of Digit DP from the canonical state up to multi-accumulator and summed-quantity variants. Each task gives a problem statement, an I/O specification, constraints, hints, and **starter code in Go, Java, and Python**. Solve the `f(N)` counter first, then wrap it with `f(R) − f(L−1)` for ranges. Always test against a brute-force loop for small `N` before trusting your DP.

> **Reusable conventions for every task**
> - Read `N`, `L`, `R` as **strings** (they can be up to `10^18` or larger).
> - `f(X)` counts valid numbers in `[0, X]`; the range answer is `f(R) − f(L−1)`, with `f(−1) = 0`.
> - Memoize **only the free states** (`tight = false`).
> - Decide whether the predicate needs the `started` flag (leading-zero handling).

---

## Beginner Tasks

### Task B1 — Count Numbers with Digit Sum Exactly `S`

**Problem.** Count integers in `[0, N]` whose digits sum to exactly `S`.

**Input.**
```
Line 1: N   (a non-negative integer, as a string, N ≤ 10^18)
Line 2: S   (0 ≤ S ≤ 162)
```
**Output.** A single integer: the count.

**Constraints.** `0 ≤ N ≤ 10^18`, `0 ≤ S ≤ 9 · 18 = 162`.

**Example.** `N = 100, S = 5` → `6` (`5, 14, 23, 32, 41, 50`).

**Hints.**
1. State: `(pos, tight, sum)`. Leading zeros add `0`, so you can skip `started`.
2. Prune `sum > S` early.
3. Base case at `pos == len(N)`: return `1` iff `sum == S`.

#### Go starter
```go
package main

import "fmt"

func countDigitSum(N string, S int) int64 {
	d := len(N)
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, S+1)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}
	var solve func(pos int, tight bool, sum int) int64
	solve = func(pos int, tight bool, sum int) int64 {
		// TODO: prune sum>S; base case pos==d; loop digits 0..limit;
		//       cache only when !tight.
		return 0
	}
	return solve(0, true, 0)
}

func main() {
	var N string
	var S int
	fmt.Scan(&N, &S)
	fmt.Println(countDigitSum(N, S))
}
```

#### Java starter
```java
import java.util.Scanner;

public class B1 {
    static int D, S;
    static int[] dig;
    static long[][] memo;

    static long solve(int pos, boolean tight, int sum) {
        // TODO
        return 0;
    }

    static long count(String N, int s) {
        D = N.length(); S = s;
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][S + 1];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, 0);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        String N = sc.next();
        int s = sc.nextInt();
        System.out.println(count(N, s));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def count_digit_sum(N: str, S: int) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, s):
        # TODO
        return 0

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    data = sys.stdin.read().split()
    N, S = data[0], int(data[1])
    print(count_digit_sum(N, S))
```

---

### Task B2 — Count Numbers Without a Forbidden Digit

**Problem.** Count integers in `[0, N]` that never use the digit `4`.

**Input.**
```
Line 1: N   (string, N ≤ 10^18)
```
**Output.** The count of numbers in `[0, N]` containing no digit `4`.

**Constraints.** `0 ≤ N ≤ 10^18`.

**Example.** `N = 25` → numbers without a `4` are all of `0..25` except `4, 14, 24` → `26 − 3 = 23`.

**Hints.**
1. No accumulator needed — just `continue` when the digit equals `4`.
2. State is `(pos, tight, started)`; cache on `(pos, started)` for free states.
3. The base case returns `1` (any survivor is valid).

#### Go starter
```go
package main

import "fmt"

func countNoFour(N string) int64 {
	d := len(N)
	memo := [2][]int64{make([]int64, d), make([]int64, d)}
	for s := 0; s < 2; s++ {
		for i := range memo[s] {
			memo[s][i] = -1
		}
	}
	var solve func(pos int, tight, started bool) int64
	solve = func(pos int, tight, started bool) int64 {
		// TODO: skip dig==4; cache only when !tight
		return 0
	}
	return solve(0, true, false)
}

func main() {
	var N string
	fmt.Scan(&N)
	fmt.Println(countNoFour(N))
}
```

#### Java starter
```java
import java.util.Scanner;

public class B2 {
    static int D;
    static int[] dig;
    static long[][] memo; // [started][pos]

    static long solve(int pos, boolean tight, boolean started) {
        // TODO
        return 0;
    }

    static long count(String N) {
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[2][D];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, false);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        System.out.println(count(sc.next()));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def count_no_four(N: str) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, started):
        # TODO
        return 0

    res = solve(0, True, False)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_no_four(sys.stdin.read().split()[0]))
```

---

### Task B3 — Count the Digit `1` Across `[0, N]`

**Problem.** Count the **total number of times the digit `1` appears** when writing out every integer from `0` to `N`. (This is LeetCode 233.) Note: this counts *occurrences*, not numbers.

**Input.**
```
Line 1: N   (string, N ≤ 10^18)
```
**Output.** Total occurrences of digit `1`.

**Constraints.** `0 ≤ N ≤ 10^18`.

**Example.** `N = 13` → occurrences of `1` in `0..13`: `1,10,11(×2),12,13` → `6`.

**Hints.**
1. The accumulator is the running count of `1`s placed so far.
2. The base case returns that count, **not** `1` — you are summing a quantity.
3. State `(pos, tight, ones)`; cache free states on `(pos, ones)`.

#### Go starter
```go
package main

import "fmt"

func countOnes(N string) int64 {
	d := len(N)
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, d+1)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}
	var solve func(pos int, tight bool, ones int) int64
	solve = func(pos int, tight bool, ones int) int64 {
		// TODO: base case returns int64(ones); add (dig==1) to ones
		return 0
	}
	return solve(0, true, 0)
}

func main() {
	var N string
	fmt.Scan(&N)
	fmt.Println(countOnes(N))
}
```

#### Java starter
```java
import java.util.Scanner;

public class B3 {
    static int D;
    static int[] dig;
    static long[][] memo;

    static long solve(int pos, boolean tight, int ones) {
        // TODO: base returns ones
        return 0;
    }

    static long count(String N) {
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][D + 1];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, 0);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        System.out.println(count(sc.next()));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def count_ones(N: str) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, ones):
        # TODO: base returns ones
        return 0

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_ones(sys.stdin.read().split()[0]))
```

---

## Intermediate Tasks

### Task I1 — Count Divisible by `K` in `[L, R]`

**Problem.** Count integers in `[L, R]` divisible by `K`.

**Input.**
```
Line 1: L R K   (L, R as strings; 1 ≤ K ≤ 10^4)
```
**Output.** Count of multiples of `K` in `[L, R]`.

**Constraints.** `0 ≤ L ≤ R ≤ 10^18`, `1 ≤ K ≤ 10^4`.

**Example.** `L = 10, R = 25, K = 3` → `12,15,18,21,24` → `5`.

**Hints.**
1. Accumulator: running value `mod K`, updated `rem' = (rem*10 + dig) % K`.
2. Answer = `f(R) − f(L−1)`; compute `L−1` by string decrement.
3. (Sanity: the closed form `R/K − (L−1)/K` should match — use it to verify.)

#### Go starter
```go
package main

import "fmt"

func f(N string, K int) int64 {
	if N == "-1" {
		return 0
	}
	d := len(N)
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, K)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}
	var solve func(pos int, tight bool, rem int) int64
	solve = func(pos int, tight bool, rem int) int64 {
		// TODO
		return 0
	}
	return solve(0, true, 0)
}

func dec(s string) string {
	b := []byte(s)
	i := len(b) - 1
	for i >= 0 && b[i] == '0' {
		b[i] = '9'
		i--
	}
	b[i]--
	k := 0
	for k < len(b)-1 && b[k] == '0' {
		k++
	}
	return string(b[k:])
}

func main() {
	var L, R string
	var K int
	fmt.Scan(&L, &R, &K)
	lo := "-1"
	if L != "0" {
		lo = dec(L)
	}
	fmt.Println(f(R, K) - f(lo, K))
}
```

#### Java starter
```java
import java.util.Scanner;

public class I1 {
    static int D, K;
    static int[] dig;
    static long[][] memo;

    static long solve(int pos, boolean tight, int rem) {
        // TODO
        return 0;
    }

    static long f(String N, int k) {
        if (N.equals("-1")) return 0;
        D = N.length(); K = k;
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][K];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, 0);
    }

    static String dec(String s) {
        char[] b = s.toCharArray();
        int i = b.length - 1;
        while (i >= 0 && b[i] == '0') { b[i] = '9'; i--; }
        b[i]--;
        int k = 0;
        while (k < b.length - 1 && b[k] == '0') k++;
        return new String(b, k, b.length - k);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        String L = sc.next(), R = sc.next();
        int k = sc.nextInt();
        String lo = L.equals("0") ? "-1" : dec(L);
        System.out.println(f(R, k) - f(lo, k));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def f(N, K):
    if N == "-1":
        return 0
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, rem):
        # TODO
        return 0

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


def dec(s):
    b = list(s)
    i = len(b) - 1
    while i >= 0 and b[i] == "0":
        b[i] = "9"; i -= 1
    b[i] = str(int(b[i]) - 1)
    return "".join(b).lstrip("0") or "0"


if __name__ == "__main__":
    L, R, K = sys.stdin.read().split()
    K = int(K)
    lo = "-1" if L == "0" else dec(L)
    print(f(R, K) - f(lo, K))
```

---

### Task I2 — Count Numbers with No Two Equal Adjacent Digits

**Problem.** Count integers in `[0, N]` in which no two **adjacent real digits** are equal (e.g., `121` is fine, `122` is not).

**Input.**
```
Line 1: N   (string, N ≤ 10^18)
```
**Output.** The count.

**Constraints.** `0 ≤ N ≤ 10^18`.

**Example.** `N = 23` → exclude `11, 22` from `0..23` → `24 − 2 = 22`.

**Hints.**
1. Accumulator: the **last placed digit** (use `-1`/`10` for "none yet").
2. Use `started`: padding zeros are not a real "last digit".
3. Forbid `dig == last` only once `started` is true.

#### Go starter
```go
package main

import "fmt"

func countNoAdj(N string) int64 {
	d := len(N)
	// memo[pos][started][last+1]; last in -1..9 -> index 0..10
	memo := make([][2][11]int64, d)
	for i := range memo {
		for s := 0; s < 2; s++ {
			for l := 0; l < 11; l++ {
				memo[i][s][l] = -1
			}
		}
	}
	var solve func(pos int, tight, started bool, last int) int64
	solve = func(pos int, tight, started bool, last int) int64 {
		// TODO: skip dig==last when started; set nlast only if nstarted
		return 0
	}
	return solve(0, true, false, -1)
}

func main() {
	var N string
	fmt.Scan(&N)
	fmt.Println(countNoAdj(N))
}
```

#### Java starter
```java
import java.util.Scanner;

public class I2 {
    static int D;
    static int[] dig;
    static long[][][] memo; // [pos][started][last+1]

    static long solve(int pos, boolean tight, boolean started, int last) {
        // TODO
        return 0;
    }

    static long count(String N) {
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][2][11];
        for (long[][] a : memo) for (long[] r : a) java.util.Arrays.fill(r, -1);
        return solve(0, true, false, -1);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        System.out.println(count(sc.next()));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def count_no_adjacent(N: str) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, started, last):
        # TODO
        return 0

    res = solve(0, True, False, -1)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_no_adjacent(sys.stdin.read().split()[0]))
```

---

### Task I3 — Count Numbers with Non-Decreasing Digits

**Problem.** Count integers in `[0, N]` whose digits (ignoring leading zeros) are in **non-decreasing** order (e.g., `1259` yes, `1245` yes, `1232` no).

**Input.**
```
Line 1: N   (string, N ≤ 10^18)
```
**Output.** The count.

**Constraints.** `0 ≤ N ≤ 10^18`.

**Example.** `N = 23` → non-decreasing numbers in `0..23`: `0..9` (10), `11,12,13` from teens (`10,11,12,13`? `10` is `1,0` decreasing → only `11,12,13`), plus `22,23`... count carefully with the brute oracle.

**Hints.**
1. Accumulator: the **last placed digit**; allow `dig` only if `not started or dig >= last`.
2. Use `started` so the first real digit has no lower bound.
3. `nlast = dig if nstarted else last`.

#### Go starter
```go
package main

import "fmt"

func countNonDecreasing(N string) int64 {
	d := len(N)
	memo := make([][2][11]int64, d)
	for i := range memo {
		for s := 0; s < 2; s++ {
			for l := 0; l < 11; l++ {
				memo[i][s][l] = -1
			}
		}
	}
	var solve func(pos int, tight, started bool, last int) int64
	solve = func(pos int, tight, started bool, last int) int64 {
		// TODO: require dig>=last once started
		return 0
	}
	return solve(0, true, false, 0)
}

func main() {
	var N string
	fmt.Scan(&N)
	fmt.Println(countNonDecreasing(N))
}
```

#### Java starter
```java
import java.util.Scanner;

public class I3 {
    static int D;
    static int[] dig;
    static long[][][] memo;

    static long solve(int pos, boolean tight, boolean started, int last) {
        // TODO
        return 0;
    }

    static long count(String N) {
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][2][11];
        for (long[][] a : memo) for (long[] r : a) java.util.Arrays.fill(r, -1);
        return solve(0, true, false, 0);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        System.out.println(count(sc.next()));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def count_non_decreasing(N: str) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, started, last):
        # TODO: require dig >= last once started
        return 0

    res = solve(0, True, False, 0)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_non_decreasing(sys.stdin.read().split()[0]))
```

---

## Advanced Tasks

### Task A1 — Sum of Digit Sums Over `[L, R]`

**Problem.** Compute the sum of digit sums of every integer in `[L, R]`, modulo `10^9 + 7`.

**Input.**
```
Line 1: L R   (strings, up to 10^18)
```
**Output.** `(Σ_{x=L}^{R} digitsum(x)) mod (10^9+7)`.

**Constraints.** `0 ≤ L ≤ R ≤ 10^18`.

**Example.** `L = 0, R = 12` → `51` (see interview Challenge 4).

**Hints.**
1. Carry a `(count, sum)` pair; prepending digit `d` to `c` numbers totaling `s` gives `(c, s + d*c)`.
2. Answer = `g(R) − g(L−1)` on the **sum** component (and on count if you need it).
3. Reduce mod `p`; handle the subtraction with `((a − b) % p + p) % p`.

#### Go starter
```go
package main

import "fmt"

const MOD = 1_000_000_007

type pair struct{ cnt, sum int64 }

func g(N string) pair {
	if N == "-1" {
		return pair{0, 0}
	}
	d := len(N)
	// memo by running digit sum (0..9*d)
	memo := make([]map[int]pair, d)
	seen := make([]map[int]bool, d)
	for i := range memo {
		memo[i] = map[int]pair{}
		seen[i] = map[int]bool{}
	}
	var solve func(pos int, tight bool, run int) pair
	solve = func(pos int, tight bool, run int) pair {
		// TODO: base returns {1, run%MOD}; combine (c, s+dig*c)
		return pair{}
	}
	return solve(0, true, 0)
}

func dec(s string) string {
	b := []byte(s)
	i := len(b) - 1
	for i >= 0 && b[i] == '0' {
		b[i] = '9'
		i--
	}
	b[i]--
	k := 0
	for k < len(b)-1 && b[k] == '0' {
		k++
	}
	return string(b[k:])
}

func main() {
	var L, R string
	fmt.Scan(&L, &R)
	lo := "-1"
	if L != "0" {
		lo = dec(L)
	}
	ans := ((g(R).sum-g(lo).sum)%MOD + MOD) % MOD
	fmt.Println(ans)
}
```

#### Java starter
```java
import java.util.HashMap;
import java.util.Map;
import java.util.Scanner;

public class A1 {
    static final long MOD = 1_000_000_007L;
    static int D;
    static int[] dig;
    static Map<Integer, long[]>[] memo;

    @SuppressWarnings("unchecked")
    static long[] g(String N) {
        if (N.equals("-1")) return new long[]{0, 0};
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new HashMap[D];
        for (int i = 0; i < D; i++) memo[i] = new HashMap<>();
        return solve(0, true, 0);
    }

    static long[] solve(int pos, boolean tight, int run) {
        // TODO: base {1, run % MOD}; combine (c, s + dig*c) mod MOD
        return new long[]{0, 0};
    }

    static String dec(String s) {
        char[] b = s.toCharArray();
        int i = b.length - 1;
        while (i >= 0 && b[i] == '0') { b[i] = '9'; i--; }
        b[i]--;
        int k = 0;
        while (k < b.length - 1 && b[k] == '0') k++;
        return new String(b, k, b.length - k);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        String L = sc.next(), R = sc.next();
        String lo = L.equals("0") ? "-1" : dec(L);
        long ans = ((g(R)[1] - g(lo)[1]) % MOD + MOD) % MOD;
        System.out.println(ans);
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache

MOD = 1_000_000_007


def g(N):
    if N == "-1":
        return (0, 0)
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, run):
        # TODO: base (1, run % MOD); combine (c, (s + dig*c) % MOD)
        return (0, 0)

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


def dec(s):
    b = list(s)
    i = len(b) - 1
    while i >= 0 and b[i] == "0":
        b[i] = "9"; i -= 1
    b[i] = str(int(b[i]) - 1)
    return "".join(b).lstrip("0") or "0"


if __name__ == "__main__":
    L, R = sys.stdin.read().split()
    lo = "-1" if L == "0" else dec(L)
    print((g(R)[1] - g(lo)[1]) % MOD)
```

---

### Task A2 — Count Numbers with All Distinct Digits in `[L, R]`

**Problem.** Count integers in `[L, R]` whose digits are all distinct (no digit repeats).

**Input.**
```
Line 1: L R   (strings, up to 10^18)
```
**Output.** The count.

**Constraints.** `0 ≤ L ≤ R ≤ 10^18`.

**Hints.**
1. Accumulator: a 10-bit **bitmask** of used digits. Forbid `dig` if its bit is set.
2. Use `started` so leading-zero padding does not set bit 0.
3. Cache free states on `(pos, started, mask)`; answer `f(R) − f(L−1)`.

#### Go starter
```go
package main

import "fmt"

func f(N string) int64 {
	if N == "-1" {
		return 0
	}
	d := len(N)
	// memo[pos][started][mask]
	memo := make([][2][1024]int64, d)
	for i := range memo {
		for s := 0; s < 2; s++ {
			for m := 0; m < 1024; m++ {
				memo[i][s][m] = -1
			}
		}
	}
	var solve func(pos int, tight, started bool, mask int) int64
	solve = func(pos int, tight, started bool, mask int) int64 {
		// TODO: skip if started && (mask>>dig)&1==1; set bit only if nstarted
		return 0
	}
	return solve(0, true, false, 0)
}

func dec(s string) string {
	b := []byte(s)
	i := len(b) - 1
	for i >= 0 && b[i] == '0' {
		b[i] = '9'
		i--
	}
	b[i]--
	k := 0
	for k < len(b)-1 && b[k] == '0' {
		k++
	}
	return string(b[k:])
}

func main() {
	var L, R string
	fmt.Scan(&L, &R)
	lo := "-1"
	if L != "0" {
		lo = dec(L)
	}
	fmt.Println(f(R) - f(lo))
}
```

#### Java starter
```java
import java.util.Scanner;

public class A2 {
    static int D;
    static int[] dig;
    static long[][][] memo; // [pos][started][mask]

    static long solve(int pos, boolean tight, boolean started, int mask) {
        // TODO
        return 0;
    }

    static long f(String N) {
        if (N.equals("-1")) return 0;
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][2][1024];
        for (long[][] a : memo) for (long[] r : a) java.util.Arrays.fill(r, -1);
        return solve(0, true, false, 0);
    }

    static String dec(String s) {
        char[] b = s.toCharArray();
        int i = b.length - 1;
        while (i >= 0 && b[i] == '0') { b[i] = '9'; i--; }
        b[i]--;
        int k = 0;
        while (k < b.length - 1 && b[k] == '0') k++;
        return new String(b, k, b.length - k);
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        String L = sc.next(), R = sc.next();
        String lo = L.equals("0") ? "-1" : dec(L);
        System.out.println(f(R) - f(lo));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def f(N):
    if N == "-1":
        return 0
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, started, mask):
        # TODO
        return 0

    res = solve(0, True, False, 0)
    solve.cache_clear()
    return res


def dec(s):
    b = list(s)
    i = len(b) - 1
    while i >= 0 and b[i] == "0":
        b[i] = "9"; i -= 1
    b[i] = str(int(b[i]) - 1)
    return "".join(b).lstrip("0") or "0"


if __name__ == "__main__":
    L, R = sys.stdin.read().split()
    lo = "-1" if L == "0" else dec(L)
    print(f(R) - f(lo))
```

---

### Task A3 — Count in Arbitrary Base with a Combined Constraint

**Problem.** Given a base `b` (`2 ≤ b ≤ 16`), a bound `N` written as space-separated base-`b` digits (MSB first), `K`, and `S`, count integers in `[0, value(N)]` that are **divisible by `K`** AND whose base-`b` digit sum equals `S`.

**Input.**
```
Line 1: b K S
Line 2: D and then D base-b digits (the bound N)
```
**Output.** The count.

**Constraints.** `2 ≤ b ≤ 16`, `1 ≤ K ≤ 1000`, `0 ≤ S ≤ (b-1)·D`, `D ≤ 60`.

**Hints.**
1. Two accumulators: `(rem mod K, sum)`. State `(pos, tight, rem, sum)`.
2. Update: `rem' = (rem*b + dig) % K`, `sum' = sum + dig`; digit loop `0..min(N[pos], b-1)`.
3. The state product is `K × (S+1)`; prune `sum > S`.

#### Go starter
```go
package main

import "fmt"

func countCombined(digitsN []int, b, K, S int) int64 {
	d := len(digitsN)
	// memo[pos][rem][sum]
	memo := make([][][]int64, d)
	for i := range memo {
		memo[i] = make([][]int64, K)
		for r := 0; r < K; r++ {
			memo[i][r] = make([]int64, S+1)
			for s := 0; s <= S; s++ {
				memo[i][r][s] = -1
			}
		}
	}
	var solve func(pos int, tight bool, rem, sum int) int64
	solve = func(pos int, tight bool, rem, sum int) int64 {
		// TODO: prune sum>S; base rem==0 && sum==S; loop 0..limit (limit<=b-1)
		return 0
	}
	return solve(0, true, 0, 0)
}

func main() {
	var b, K, S, d int
	fmt.Scan(&b, &K, &S, &d)
	digitsN := make([]int, d)
	for i := range digitsN {
		fmt.Scan(&digitsN[i])
	}
	fmt.Println(countCombined(digitsN, b, K, S))
}
```

#### Java starter
```java
import java.util.Scanner;

public class A3 {
    static int D, B, K, S;
    static int[] dig;
    static long[][][] memo; // [pos][rem][sum]

    static long solve(int pos, boolean tight, int rem, int sum) {
        // TODO
        return 0;
    }

    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        B = sc.nextInt(); K = sc.nextInt(); S = sc.nextInt();
        D = sc.nextInt();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = sc.nextInt();
        memo = new long[D][K][S + 1];
        for (long[][] x : memo) for (long[] r : x) java.util.Arrays.fill(r, -1);
        System.out.println(solve(0, true, 0, 0));
    }
}
```

#### Python starter
```python
import sys
from functools import lru_cache


def count_combined(digitsN, b, K, S):
    D = len(digitsN)

    @lru_cache(maxsize=None)
    def solve(pos, tight, rem, s):
        # TODO: prune s>S; base rem==0 and s==S; loop 0..min(N[pos], b-1)
        return 0

    res = solve(0, True, 0, 0)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    data = list(map(int, sys.stdin.read().split()))
    b, K, S, D = data[0], data[1], data[2], data[3]
    digitsN = data[4:4 + D]
    print(count_combined(digitsN, b, K, S))
```

---

## How to Verify Your Solutions

For every task, write a brute-force oracle and compare on small inputs:

```python
def brute(N_int, predicate):
    return sum(1 for x in range(0, N_int + 1) if predicate(x))

# Example for B1 (digit sum == S):
def digit_sum_pred(S):
    return lambda x: sum(int(c) for c in str(x)) == S

for N in range(0, 3000):
    for S in range(0, 20):
        assert count_digit_sum(str(N), S) == brute(N, digit_sum_pred(S))
```

If your DP disagrees with the oracle on any small `N`, the most likely culprits in order are: caching tight states, wrong `nextTight = tight && dig == limit`, mishandled leading zeros, or an `f(R) − f(L−1)` / `decString` off-by-one. Fix the smallest failing `N` first.

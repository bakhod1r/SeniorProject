# Inclusion-Exclusion Principle (PIE) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the inclusion-exclusion logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs** — count the universe directly with a loop, and confirm it matches the PIE result. Watch the sign rule (`+` for odd-sized subsets, `−` for even) and use **LCM**, not the product, for "divisible by all of these" intersections.

---

## Beginner Tasks (5)

### Task 1 — Union of two sets

**Problem.** Given `|A|`, `|B|`, and `|A ∩ B|`, print `|A ∪ B| = |A| + |B| − |A∩B|`.

**Input / Output spec.**
- Read three integers `a`, `b`, `ab`.
- Print `|A ∪ B|`.

**Constraints.**
- `0 ≤ ab ≤ a, b ≤ 10^9`.

**Hint.** One subtraction. The intersection is counted twice in `a + b`, so remove it once.

**Starter — Go.**
```go
package main

import "fmt"

func union2(a, b, ab int64) int64 {
	// TODO: a + b - ab
	return 0
}

func main() {
	var a, b, ab int64
	fmt.Scan(&a, &b, &ab)
	fmt.Println(union2(a, b, ab))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long union2(long a, long b, long ab) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), ab = sc.nextLong();
        System.out.println(union2(a, b, ab));
    }
}
```

**Starter — Python.**
```python
import sys


def union2(a, b, ab):
    # TODO
    return 0


def main():
    a, b, ab = map(int, sys.stdin.read().split())
    print(union2(a, b, ab))


if __name__ == "__main__":
    main()
```

**Evaluation.** `union2(100, 80, 40) == 140`; result never exceeds `a + b` and is at least `max(a, b)`.

---

### Task 2 — Union of three sets

**Problem.** Given the three single sizes, the three pairwise intersection sizes, and the triple intersection size, print `|A ∪ B ∪ C|`.

**Input / Output spec.**
- Read `a, b, c, ab, ac, bc, abc` (in that order).
- Print the union size.

**Constraints.**
- All inputs `0 ≤ … ≤ 10^9`, consistent (a valid Venn configuration).

**Hint.** `a+b+c − ab−ac−bc + abc`. The triple comes back with a `+`.

**Starter — Go.**
```go
package main

import "fmt"

func union3(a, b, c, ab, ac, bc, abc int64) int64 {
	// TODO
	return 0
}

func main() {
	var a, b, c, ab, ac, bc, abc int64
	fmt.Scan(&a, &b, &c, &ab, &ac, &bc, &abc)
	fmt.Println(union3(a, b, c, ab, ac, bc, abc))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static long union3(long a, long b, long c, long ab, long ac, long bc, long abc) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long[] v = new long[7];
        for (int i = 0; i < 7; i++) v[i] = sc.nextLong();
        System.out.println(union3(v[0], v[1], v[2], v[3], v[4], v[5], v[6]));
    }
}
```

**Starter — Python.**
```python
import sys


def union3(a, b, c, ab, ac, bc, abc):
    # TODO
    return 0


def main():
    vals = list(map(int, sys.stdin.read().split()))
    print(union3(*vals))


if __name__ == "__main__":
    main()
```

**Evaluation.** `union3(15,10,6,5,3,2,1) == 22` (multiples of 2,3,5 in [1,30]).

---

### Task 3 — Divisible by 2, 3, or 5

**Problem.** Given `N`, print how many integers in `[1, N]` are divisible by at least one of `2, 3, 5`, using the fixed three-set PIE.

**Input / Output spec.**
- Read `N`. Print the count.

**Constraints.**
- `1 ≤ N ≤ 10^18`.

**Hint.** `⌊N/2⌋+⌊N/3⌋+⌊N/5⌋ − ⌊N/6⌋−⌊N/10⌋−⌊N/15⌋ + ⌊N/30⌋`.

**Starter — Go.**
```go
package main

import "fmt"

func count235(N int64) int64 {
	// TODO: PIE with 2,3,5 (LCMs 6,10,15,30)
	return 0
}

func main() {
	var N int64
	fmt.Scan(&N)
	fmt.Println(count235(N))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static long count235(long N) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(count235(sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
import sys


def count235(N):
    # TODO
    return 0


def main():
    print(count235(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Evaluation.** `count235(30) == 22`; matches the brute-force `sum(1 for x in 1..N if x%2==0 or x%3==0 or x%5==0)` for all `N ≤ 10000`.

---

### Task 4 — Count "none of the properties" (complement)

**Problem.** Given `N`, print how many integers in `[1, N]` are divisible by **none** of `2, 3, 5` (i.e. coprime to 30). Use `N − union`.

**Input / Output spec.**
- Read `N`. Print the count.

**Constraints.**
- `1 ≤ N ≤ 10^18`.

**Hint.** Reuse Task 3: `answer = N − count235(N)`.

**Starter — Go.**
```go
package main

import "fmt"

func count235(N int64) int64 { /* from Task 3 */ return 0 }

func main() {
	var N int64
	fmt.Scan(&N)
	fmt.Println(N - count235(N))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static long count235(long N) { /* from Task 3 */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long N = sc.nextLong();
        System.out.println(N - count235(N));
    }
}
```

**Starter — Python.**
```python
import sys


def count235(N):  # from Task 3
    return 0


def main():
    N = int(sys.stdin.read())
    print(N - count235(N))


if __name__ == "__main__":
    main()
```

**Evaluation.** `answer(30) == 8` (the residues 1,7,11,13,17,19,23,29); equals `φ(30)·⌊N/30⌋ + (partial)` and matches a brute-force coprime count for all `N ≤ 10000`.

---

### Task 5 — Multiples of a single number

**Problem.** Warm-up for intersections: given `N` and `k`, print `⌊N/k⌋`, the number of multiples of `k` in `[1, N]`.

**Input / Output spec.**
- Read `N`, `k`. Print `⌊N/k⌋`.

**Constraints.**
- `1 ≤ k ≤ N ≤ 10^18`.

**Hint.** Integer division. This is the size of one set `Aᵢ` before any PIE.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var N, k int64
	fmt.Scan(&N, &k)
	// TODO: print N / k
	fmt.Println(N / k)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long N = sc.nextLong(), k = sc.nextLong();
        System.out.println(N / k);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    N, k = map(int, sys.stdin.read().split())
    print(N // k)


if __name__ == "__main__":
    main()
```

**Evaluation.** `⌊30/7⌋ == 4`; `⌊N/1⌋ == N`; `⌊N/N⌋ == 1`.

---

## Intermediate Tasks (5)

### Task 6 — Divisible by at least one (bitmask PIE)

**Problem.** Given `N` and a list `nums`, count integers in `[1, N]` divisible by at least one element, via a bitmask over all `2ⁿ−1` subsets using LCM for intersections.

**Input / Output spec.**
- Read `n`, then `n` numbers, then `N`. Print the count.

**Constraints.**
- `1 ≤ n ≤ 20`, `1 ≤ numsᵢ ≤ 10^9`, `1 ≤ N ≤ 10^18`.

**Hint.** For each `mask` from 1: compute `lcm` of chosen numbers (cap at `N+1` to avoid overflow), add/subtract `N/lcm` by popcount parity.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 { for b != 0 { a, b = b, a%b }; return a }

func countAtLeastOne(N int64, nums []int64) int64 {
	// TODO: bitmask PIE with LCM and sign by popcount
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	nums := make([]int64, n)
	for i := range nums {
		fmt.Scan(&nums[i])
	}
	var N int64
	fmt.Scan(&N)
	fmt.Println(countAtLeastOne(N, nums))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    static long countAtLeastOne(long N, long[] nums) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] nums = new long[n];
        for (int i = 0; i < n; i++) nums[i] = sc.nextLong();
        long N = sc.nextLong();
        System.out.println(countAtLeastOne(N, nums));
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def count_at_least_one(N, nums):
    # TODO
    return 0


def main():
    data = list(map(int, sys.stdin.read().split()))
    n = data[0]
    nums = data[1:1 + n]
    N = data[1 + n]
    print(count_at_least_one(N, nums))


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches the brute-force `sum(1 for x in 1..N if any(x%k==0 for k in nums))` for all `N ≤ 5000`; handles non-coprime `nums` (e.g. `[4, 6]` → LCM 12).

---

### Task 7 — Euler's totient via PIE

**Problem.** Given `m`, compute `φ(m)` = count of integers in `[1, m]` coprime to `m`, using PIE over the **distinct** prime factors of `m`.

**Input / Output spec.**
- Read `m`. Print `φ(m)`.

**Constraints.**
- `1 ≤ m ≤ 10^12`.

**Hint.** Factor `m` to its distinct primes; complement-form PIE: `Σ_{mask}(−1)^(popcount)·⌊m/∏ chosen primes⌋`.

**Starter — Go.**
```go
package main

import "fmt"

func distinctPrimes(n int64) []int64 {
	var ps []int64
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			ps = append(ps, p)
			for n%p == 0 {
				n /= p
			}
		}
	}
	if n > 1 {
		ps = append(ps, n)
	}
	return ps
}

func totientPIE(m int64) int64 {
	// TODO: PIE over distinctPrimes(m)
	return 0
}

func main() {
	var m int64
	fmt.Scan(&m)
	fmt.Println(totientPIE(m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static List<Long> distinctPrimes(long n) {
        List<Long> ps = new ArrayList<>();
        for (long p = 2; p * p <= n; p++)
            if (n % p == 0) { ps.add(p); while (n % p == 0) n /= p; }
        if (n > 1) ps.add(n);
        return ps;
    }

    static long totientPIE(long m) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(totientPIE(sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
import sys


def distinct_primes(n):
    ps, p = [], 2
    while p * p <= n:
        if n % p == 0:
            ps.append(p)
            while n % p == 0:
                n //= p
        p += 1
    if n > 1:
        ps.append(n)
    return ps


def totient_pie(m):
    # TODO
    return 0


def main():
    print(totient_pie(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Evaluation.** `totientPIE(30) == 8`, `totientPIE(12) == 4`, `totientPIE(prime) == prime-1`; matches the product formula `m·∏(1−1/p)` and a brute-force coprime count for all `m ≤ 2000`.

---

### Task 8 — Derangements

**Problem.** Given `n`, print `D(n)` = number of permutations of `{1,…,n}` with no fixed point, using the PIE sum `Σ_{k=0}^{n}(−1)^k C(n,k)(n−k)!` (or the equivalent recurrence).

**Input / Output spec.**
- Read `n`. Print `D(n)`.

**Constraints.**
- `0 ≤ n ≤ 20`.

**Hint.** Either the direct sum or `D(n) = (n−1)(D(n−1)+D(n−2))`, `D(0)=1`, `D(1)=0`.

**Starter — Go.**
```go
package main

import "fmt"

func derangements(n int) int64 {
	// TODO: PIE sum or recurrence
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(derangements(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static long derangements(int n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(derangements(sc.nextInt()));
    }
}
```

**Starter — Python.**
```python
import sys
from math import comb, factorial


def derangements(n):
    # TODO
    return 0


def main():
    print(derangements(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Evaluation.** `D(0..6) == [1,0,1,2,9,44,265]`; `D(n)` is the nearest integer to `n!/e` for `n ≥ 1`; matches a brute-force permutation count for `n ≤ 8`.

---

### Task 9 — Surjection count

**Problem.** Given `n` and `m`, print the number of surjective (onto) functions from an `n`-set to an `m`-set: `Σ_{k=0}^{m}(−1)^k C(m,k)(m−k)^n`.

**Input / Output spec.**
- Read `n`, `m`. Print the surjection count.

**Constraints.**
- `1 ≤ n ≤ 15`, `1 ≤ m ≤ 15`.

**Hint.** PIE over "output `i` is missed". If `m > n`, the result is 0.

**Starter — Go.**
```go
package main

import "fmt"

func comb(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	r := int64(1)
	for i := 0; i < k; i++ {
		r = r * int64(n-i) / int64(i+1)
	}
	return r
}

func ipow(base int64, exp int) int64 {
	r := int64(1)
	for i := 0; i < exp; i++ {
		r *= base
	}
	return r
}

func surjections(n, m int) int64 {
	// TODO: sum_{k=0}^{m} (-1)^k C(m,k) (m-k)^n
	return 0
}

func main() {
	var n, m int
	fmt.Scan(&n, &m)
	fmt.Println(surjections(n, m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static long comb(int n, int k) {
        if (k < 0 || k > n) return 0;
        long r = 1;
        for (int i = 0; i < k; i++) r = r * (n - i) / (i + 1);
        return r;
    }

    static long ipow(long base, int exp) {
        long r = 1;
        for (int i = 0; i < exp; i++) r *= base;
        return r;
    }

    static long surjections(int n, int m) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(surjections(sc.nextInt(), sc.nextInt()));
    }
}
```

**Starter — Python.**
```python
import sys
from math import comb


def surjections(n, m):
    # TODO
    return 0


def main():
    n, m = map(int, sys.stdin.read().split())
    print(surjections(n, m))


if __name__ == "__main__":
    main()
```

**Evaluation.** `surjections(4,2) == 14`, `surjections(3,3) == 6`, `surjections(2,3) == 0`; equals `m! · S(n,m)` (Stirling 2nd kind) and matches a brute-force function enumeration for small `n, m`.

---

### Task 10 — Count squarefree integers up to N

**Problem.** Given `N`, print the number of squarefree integers in `[1, N]` using `Σ_{d=1}^{√N} μ(d)⌊N/d²⌋`.

**Input / Output spec.**
- Read `N`. Print the count.

**Constraints.**
- `1 ≤ N ≤ 10^14`.

**Hint.** Sieve `μ` up to `⌊√N⌋`, then sum `μ(d)·⌊N/d²⌋`. Only `d ≤ √N` matter.

**Starter — Python.**
```python
import sys
import math


def count_squarefree(N):
    root = math.isqrt(N)
    mu = [0] * (root + 1)
    comp = [False] * (root + 1)
    primes = []
    if root >= 1:
        mu[1] = 1
    for i in range(2, root + 1):
        if not comp[i]:
            primes.append(i)
            mu[i] = -1
        for p in primes:
            if i * p > root:
                break
            comp[i * p] = True
            if i % p == 0:
                mu[i * p] = 0
                break
            mu[i * p] = -mu[i]
    # TODO: return sum of mu[d] * (N // (d*d))
    return 0


def main():
    print(count_squarefree(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func countSquarefree(N int64) int64 {
	root := int64(math.Sqrt(float64(N)))
	for (root+1)*(root+1) <= N {
		root++
	}
	mu := make([]int, root+1)
	// TODO: linear sieve of mu, then sum mu[d]*(N/(d*d))
	_ = mu
	return 0
}

func main() {
	var N int64
	fmt.Scan(&N)
	fmt.Println(countSquarefree(N))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static long countSquarefree(long N) {
        int root = (int) Math.sqrt((double) N);
        while ((long) (root + 1) * (root + 1) <= N) root++;
        int[] mu = new int[root + 1];
        // TODO: sieve mu, then sum mu[d]*(N/(d*d))
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(countSquarefree(sc.nextLong()));
    }
}
```

**Evaluation.** `countSquarefree(10) == 7`, `countSquarefree(100) == 61`; ratio approaches `6/π² ≈ 0.6079` as `N` grows; matches a brute-force squarefree scan for all `N ≤ 100000`.

---

## Advanced Tasks (5)

### Task 11 — DFS-pruned divisible-by-at-least-one

**Problem.** Same as Task 6, but use a DFS that prunes any branch whose running LCM exceeds `N` (its term and all supersets are 0). Verify it matches the flat bitmask version.

**Input / Output spec.**
- Read `n`, then `n` numbers, then `N`. Print the count.

**Constraints.**
- `1 ≤ n ≤ 40`, `1 ≤ numsᵢ ≤ 10^9`, `1 ≤ N ≤ 10^18` (pruning makes `n = 40` feasible when moduli are large).

**Hint.** `dfs(idx, runLCM, sign)`: if `runLCM > N` return; if `runLCM > 1` add `sign·(N/runLCM)`; recurse over `j ≥ idx` with `lcm(runLCM, nums[j])` and flipped sign.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 { for b != 0 { a, b = b, a%b }; return a }
func lcm(a, b int64) int64 { return a / gcd(a, b) * b }

func countPruned(N int64, nums []int64) int64 {
	var total int64
	var dfs func(idx int, runLCM, sign int64)
	dfs = func(idx int, runLCM, sign int64) {
		// TODO: prune if runLCM > N; add term; recurse
	}
	dfs(0, 1, 1)
	return total
}

func main() {
	var n int
	fmt.Scan(&n)
	nums := make([]int64, n)
	for i := range nums {
		fmt.Scan(&nums[i])
	}
	var N int64
	fmt.Scan(&N)
	fmt.Println(countPruned(N, nums))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }
    static long lcm(long a, long b) { return a / gcd(a, b) * b; }
    static long total;

    static void dfs(long[] nums, int idx, long runLCM, long sign, long N) {
        // TODO
    }

    static long countPruned(long N, long[] nums) {
        total = 0;
        dfs(nums, 0, 1, 1, N);
        return total;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] nums = new long[n];
        for (int i = 0; i < n; i++) nums[i] = sc.nextLong();
        long N = sc.nextLong();
        System.out.println(countPruned(N, nums));
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd

sys.setrecursionlimit(1 << 20)


def count_pruned(N, nums):
    total = 0

    def dfs(idx, run_lcm, sign):
        nonlocal total
        # TODO: prune, add term, recurse
        pass

    dfs(0, 1, 1)
    return total


def main():
    data = list(map(int, sys.stdin.read().split()))
    n = data[0]
    nums = data[1:1 + n]
    N = data[1 + n]
    print(count_pruned(N, nums))


if __name__ == "__main__":
    main()
```

**Evaluation.** Identical output to the flat bitmask PIE (Task 6) on all shared inputs; for large moduli it visits far fewer than `2ⁿ` nodes (instrument and report the node count).

---

### Task 12 — Count integers in [1,N] coprime to M

**Problem.** Given `N` and `M`, count integers in `[1, N]` coprime to `M` (gcd 1), via PIE/Möbius over the distinct primes of `M`. Note `N` need not equal `M`.

**Input / Output spec.**
- Read `N`, `M`. Print the count.

**Constraints.**
- `1 ≤ N ≤ 10^18`, `1 ≤ M ≤ 10^12`.

**Hint.** Distinct primes of `M`; `Σ_{mask}(−1)^(popcount)·⌊N/∏ chosen primes⌋`.

**Starter — Go.**
```go
package main

import "fmt"

func distinctPrimes(n int64) []int64 {
	var ps []int64
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			ps = append(ps, p)
			for n%p == 0 {
				n /= p
			}
		}
	}
	if n > 1 {
		ps = append(ps, n)
	}
	return ps
}

func coprimeUpTo(N, M int64) int64 {
	// TODO: PIE over distinctPrimes(M), using floor(N/product)
	return 0
}

func main() {
	var N, M int64
	fmt.Scan(&N, &M)
	fmt.Println(coprimeUpTo(N, M))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    static List<Long> distinctPrimes(long n) {
        List<Long> ps = new ArrayList<>();
        for (long p = 2; p * p <= n; p++)
            if (n % p == 0) { ps.add(p); while (n % p == 0) n /= p; }
        if (n > 1) ps.add(n);
        return ps;
    }

    static long coprimeUpTo(long N, long M) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long N = sc.nextLong(), M = sc.nextLong();
        System.out.println(coprimeUpTo(N, M));
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def distinct_primes(n):
    ps, p = [], 2
    while p * p <= n:
        if n % p == 0:
            ps.append(p)
            while n % p == 0:
                n //= p
        p += 1
    if n > 1:
        ps.append(n)
    return ps


def coprime_up_to(N, M):
    # TODO
    return 0


def main():
    N, M = map(int, sys.stdin.read().split())
    print(coprime_up_to(N, M))


if __name__ == "__main__":
    main()
```

**Evaluation.** `coprimeUpTo(M, M) == φ(M)`; `coprimeUpTo(100, 12) == 33`; matches the brute-force `sum(1 for x in 1..N if gcd(x,M)==1)` for all `N, M ≤ 2000`.

---

### Task 13 — Exactly-`r` count from binomial moments

**Problem.** Given `n` sets and the binomial moments `W₀=N, W₁, …, Wₙ` (where `Wₖ = Σ_{|S|=k}|A_S|`), print the number of elements in **exactly `r`** sets, `Eᵣ = Σ_{k=r}^{n}(−1)^(k−r)C(k,r)Wₖ`.

**Input / Output spec.**
- Read `n`, `r`, then `W₀ … Wₙ` (`n+1` values). Print `Eᵣ`.

**Constraints.**
- `0 ≤ r ≤ n ≤ 30`, moments fit in 64-bit.

**Hint.** Direct sum with `C(k,r)` and alternating sign `(−1)^(k−r)`.

**Starter — Go.**
```go
package main

import "fmt"

func comb(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	r := int64(1)
	for i := 0; i < k; i++ {
		r = r * int64(n-i) / int64(i+1)
	}
	return r
}

func exactlyR(n, r int, W []int64) int64 {
	// TODO: sum_{k=r}^{n} (-1)^(k-r) C(k,r) W[k]
	return 0
}

func main() {
	var n, r int
	fmt.Scan(&n, &r)
	W := make([]int64, n+1)
	for i := range W {
		fmt.Scan(&W[i])
	}
	fmt.Println(exactlyR(n, r, W))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task13 {
    static long comb(int n, int k) {
        if (k < 0 || k > n) return 0;
        long r = 1;
        for (int i = 0; i < k; i++) r = r * (n - i) / (i + 1);
        return r;
    }

    static long exactlyR(int n, int r, long[] W) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), r = sc.nextInt();
        long[] W = new long[n + 1];
        for (int i = 0; i <= n; i++) W[i] = sc.nextLong();
        System.out.println(exactlyR(n, r, W));
    }
}
```

**Starter — Python.**
```python
import sys
from math import comb


def exactly_r(n, r, W):
    # TODO
    return 0


def main():
    data = list(map(int, sys.stdin.read().split()))
    n, r = data[0], data[1]
    W = data[2:2 + n + 1]
    print(exactly_r(n, r, W))


if __name__ == "__main__":
    main()
```

**Evaluation.** With `n=3`, `W=[N,1200,260,30]`: `E₁=770, E₂=170, E₃=30`, and `E₁+E₂+E₃ = 970` (the union). `Σ_{r≥0} Eᵣ == N`.

---

### Task 14 — Detect Carmichael-style failure of summing counts

**Problem.** Given `n` source sizes and all their intersection sizes (as binomial moments `W₁,…,Wₙ`), print both the naive sum `W₁` and the true PIE union, and the percentage of overcount of the naive sum.

**Input / Output spec.**
- Read `n`, then `W₁ … Wₙ` (`n` values). Print `naive trueUnion overcountPercent` (percent to 2 decimals).

**Constraints.**
- `1 ≤ n ≤ 20`, moments fit in 64-bit, `trueUnion > 0`.

**Hint.** `naive = W₁`; `union = Σ_{k=1}^{n}(−1)^(k+1)Wₖ`; `overcount% = (naive − union)/union·100`.

**Starter — Python.**
```python
import sys


def analyze(n, W):
    naive = W[0]
    union = sum((-1) ** (k + 1) * W[k] for k in range(n))  # W[k] is W_{k+1}
    # TODO: compute overcount percent
    return naive, union, 0.0


def main():
    data = list(map(int, sys.stdin.read().split()))
    n = data[0]
    W = data[1:1 + n]
    naive, union, pct = analyze(n, W)
    print(naive, union, f"{pct:.2f}")


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func analyze(n int, W []int64) (int64, int64, float64) {
	naive := W[0]
	var union int64
	// TODO: union = sum_{k=1}^{n} (-1)^(k+1) W[k-1]; overcount percent
	_ = n
	return naive, union, 0.0
}

func main() {
	var n int
	fmt.Scan(&n)
	W := make([]int64, n)
	for i := range W {
		fmt.Scan(&W[i])
	}
	naive, union, pct := analyze(n, W)
	fmt.Printf("%d %d %.2f\n", naive, union, pct)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task14 {
    static void analyze(int n, long[] W) {
        long naive = W[0];
        long union = 0;
        // TODO: union and overcount percent
        double pct = 0.0;
        System.out.printf("%d %d %.2f%n", naive, union, pct);
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] W = new long[n];
        for (int i = 0; i < n; i++) W[i] = sc.nextLong();
        analyze(n, W);
    }
}
```

**Evaluation.** For `n=3`, `W=[1200,260,30]`: prints `1200 970 23.71`. The overcount equals `naive − union` (here 230), the elements counted more than once.

---

### Task 15 — Bonferroni bounds (truncated PIE)

**Problem.** Given the binomial moments `W₁,…,Wₙ` and a truncation order `m` (`1 ≤ m ≤ n`), print the Bonferroni partial sum `B_m = Σ_{k=1}^{m}(−1)^(k+1)Wₖ` and whether it is an upper or lower bound on the true union (`upper` if `m` odd, `lower` if `m` even).

**Input / Output spec.**
- Read `n`, `m`, then `W₁ … Wₙ`. Print `B_m` and the word `upper` or `lower`.

**Constraints.**
- `1 ≤ m ≤ n ≤ 25`, moments fit in 64-bit.

**Hint.** Sum only the first `m` orders; odd `m` over-estimates the union, even `m` under-estimates.

**Starter — Python.**
```python
import sys


def bonferroni(n, m, W):
    # W[k] is W_{k+1}; sum first m orders
    partial = sum((-1) ** (k + 1) * W[k] for k in range(m))
    # TODO: determine "upper" (m odd) or "lower" (m even)
    return partial, "upper" if m % 2 == 1 else "lower"


def main():
    data = list(map(int, sys.stdin.read().split()))
    n, m = data[0], data[1]
    W = data[2:2 + n]
    val, bound = bonferroni(n, m, W)
    print(val, bound)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func bonferroni(n, m int, W []int64) (int64, string) {
	var partial int64
	// TODO: sum first m orders with alternating sign; bound by parity of m
	_ = n
	bound := "lower"
	if m%2 == 1 {
		bound = "upper"
	}
	return partial, bound
}

func main() {
	var n, m int
	fmt.Scan(&n, &m)
	W := make([]int64, n)
	for i := range W {
		fmt.Scan(&W[i])
	}
	val, bound := bonferroni(n, m, W)
	fmt.Println(val, bound)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task15 {
    static void bonferroni(int n, int m, long[] W) {
        long partial = 0;
        // TODO: sum first m orders
        String bound = (m % 2 == 1) ? "upper" : "lower";
        System.out.println(partial + " " + bound);
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt();
        long[] W = new long[n];
        for (int i = 0; i < n; i++) W[i] = sc.nextLong();
        bonferroni(n, m, W);
    }
}
```

**Evaluation.** For `n=3`, `W=[1200,260,30]`: `m=1` → `1200 upper` (≥ 970); `m=2` → `940 lower` (≤ 970); `m=3` → `970 upper` (exact, equals the union). Each `B_m` brackets the true union `970` on the predicted side.

---

## Testing Guidance

- **Brute-force oracle for unions:** `sum(1 for x in 1..N if any(x%k==0 for k in nums))` for "divisible by at least one"; loop over all permutations/functions for derangements/surjections. Run for all small inputs.
- **Complement identity:** `#none == N − union` must hold for both forms.
- **Totient cross-check:** `totient_pie(m) == m·∏(1−1/p)` and matches a coprime-count loop for `m ≤ 2000`.
- **Pruned vs flat:** the DFS-pruned PIE must produce identical results to the flat `2ⁿ` loop on every shared input.
- **Sign discipline:** odd-sized subsets `+`, even-sized `−` (union form); verify on the two-set case.
- **LCM not product:** test on non-coprime inputs like `[4, 6]` (LCM 12) to catch the product mistake.
- **Cross-language determinism:** Go, Java, and Python must produce identical output for shared inputs (watch 64-bit overflow on large LCMs).

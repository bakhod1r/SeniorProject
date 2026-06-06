# Burnside's Lemma & Pólya Enumeration — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the symmetry-counting logic and validate against the evaluation criteria.
> **Always test against a brute-force orbit-count oracle on small inputs** — enumerate all `k^n` colorings, bucket them into orbits, and confirm your Burnside/closed-form result matches.

---

## Beginner Tasks (5)

### Task 1 — Count cycles of a permutation

**Problem.** Given a permutation `p` (where `p[i]` is the slot that slot `i` maps to), return the number of disjoint cycles.

**Input / Output spec.**
- Read `n`, then `n` integers `p[0..n-1]` (a permutation of `0..n-1`).
- Print the number of cycles.

**Constraints.**
- `1 ≤ n ≤ 10^6`; `p` is a valid permutation.

**Hint.** Walk each unvisited slot around its cycle with a `visited` array; count once per new cycle. `O(n)`.

**Starter — Go.**
```go
package main

import "fmt"

func countCycles(p []int) int {
	// TODO: visited array, follow each unvisited slot
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	p := make([]int, n)
	for i := range p {
		fmt.Scan(&p[i])
	}
	fmt.Println(countCycles(p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int countCycles(int[] p) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] p = new int[n];
        for (int i = 0; i < n; i++) p[i] = sc.nextInt();
        System.out.println(countCycles(p));
    }
}
```

**Starter — Python.**
```python
import sys


def count_cycles(p):
    # TODO
    return 0


def main():
    data = list(map(int, sys.stdin.read().split()))
    n, p = data[0], data[1:]
    print(count_cycles(p))


if __name__ == "__main__":
    main()
```

**Evaluation.** Identity `[0,1,2,…]` returns `n`; a single full cycle `[1,2,…,0]` returns `1`. Matches a brute-force union-find grouping.

---

### Task 2 — Cycles of a rotation via gcd

**Problem.** For an `n`-bead necklace, print the number of cycles of "rotation by `j`" using `gcd(j, n)` (with rotation by 0 giving `n`).

**Input / Output spec.**
- Read `n`, `j`. Print the cycle count.

**Constraints.**
- `1 ≤ n ≤ 10^9`, `0 ≤ j < n`.

**Hint.** Cycle count `= gcd(j, n)`; note `gcd(0, n) = n`, the identity.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int) int {
	// TODO
	return 0
}

func main() {
	var n, j int
	fmt.Scan(&n, &j)
	fmt.Println(gcd(j, n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static int gcd(int a, int b) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), j = sc.nextInt();
        System.out.println(gcd(j, n));
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def main():
    n, j = map(int, sys.stdin.read().split())
    print(gcd(j, n))  # gcd(0, n) == n


if __name__ == "__main__":
    main()
```

**Evaluation.** `j = 0` returns `n`; for `n = 6, j = 2` returns `2`; for `n = 6, j = 1` returns `1`.

---

### Task 3 — Necklace count by the explicit Burnside loop

**Problem.** Count distinct `k`-color `n`-bead necklaces under rotation by averaging `k^{gcd(j,n)}` over all rotations `j = 0..n-1`.

**Input / Output spec.**
- Read `n`, `k`. Print the necklace count (assume it fits in `int64`; small `n, k`).

**Constraints.**
- `1 ≤ n ≤ 60`, `1 ≤ k ≤ 4`.

**Hint.** `sum = Σ_{j=0}^{n-1} k^{gcd(j,n)}` (with `gcd(0,n)=n`); answer `= sum / n`.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int) int { for b != 0 { a, b = b, a%b }; return a }

func main() {
	var n, k int64
	fmt.Scan(&n, &k)
	// TODO: sum k^{gcd(j,n)} for j in 0..n-1; divide by n
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), k = sc.nextLong();
        // TODO
        System.out.println(0);
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def main():
    n, k = map(int, sys.stdin.read().split())
    total = 0
    for j in range(n):
        c = n if j == 0 else gcd(j, n)
        total += k ** c
    print(total // n)


if __name__ == "__main__":
    main()
```

**Evaluation.** `n=4,k=2 → 6`; `n=3,k=3 → 11`; `n=6,k=2 → 14`. Result is always an integer (`sum % n == 0`).

---

### Task 4 — Necklace count by the closed formula

**Problem.** Same count as Task 3, but using `(1/n) Σ_{d|n} φ(d) k^{n/d}` — only divisors of `n`.

**Input / Output spec.**
- Read `n`, `k`. Print the count.

**Constraints.**
- `1 ≤ n ≤ 10^6`, `1 ≤ k ≤ 6` (answer fits in big integers — Python native; Go/Java may use modular for large).

**Hint.** Enumerate divisor pairs `(d, n/d)` up to `√n`; add `φ(d)·k^{n/d}`. Use the single-value totient by trial division.

**Starter — Go.**
```go
package main

import "fmt"

func totient(m int) int {
	// TODO: φ(m) by trial division
	return 0
}

func powInt(b, e int) int {
	r := 1
	for ; e > 0; e-- {
		r *= b
	}
	return r
}

func necklace(n, k int) int {
	// TODO: Σ_{d|n} φ(d) k^{n/d}, then / n
	return 0
}

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	fmt.Println(necklace(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static int totient(int m) { /* TODO */ return 0; }
    static int powInt(int b, int e) { int r = 1; while (e-- > 0) r *= b; return r; }

    static int necklace(int n, int k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(necklace(sc.nextInt(), sc.nextInt()));
    }
}
```

**Starter — Python.**
```python
import sys


def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def necklace(n, k):
    s, d = 0, 1
    while d * d <= n:
        if n % d == 0:
            s += totient(d) * k ** (n // d)
            if d != n // d:
                e = n // d
                s += totient(e) * k ** (n // e)
        d += 1
    return s // n


def main():
    n, k = map(int, sys.stdin.read().split())
    print(necklace(n, k))


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches Task 3 for all `n ≤ 60, k ≤ 4`; handles large `n` (e.g. `n = 10^6`) instantly where Task 3 cannot.

---

### Task 5 — Brute-force orbit count (the oracle)

**Problem.** Enumerate all `k^n` colorings of an `n`-bead necklace, group them into orbits under rotation, and print the number of orbits. This is the slow oracle used to validate Tasks 3–4.

**Input / Output spec.**
- Read `n`, `k`. Print the orbit count.

**Constraints.**
- `1 ≤ n ≤ 12`, `1 ≤ k ≤ 4` (so `k^n` is enumerable).

**Hint.** Encode each coloring as a tuple; for each unseen coloring, mark all `n` rotations as seen and increment the orbit counter.

**Starter — Go.**
```go
package main

import "fmt"

func orbitCount(n, k int) int {
	// TODO: enumerate k^n colorings (base-k counter), mark rotations seen
	return 0
}

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	fmt.Println(orbitCount(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static int orbitCount(int n, int k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(orbitCount(sc.nextInt(), sc.nextInt()));
    }
}
```

**Starter — Python.**
```python
import sys
from itertools import product


def orbit_count(n, k):
    seen, orbits = set(), 0
    for col in product(range(k), repeat=n):
        if col in seen:
            continue
        orbits += 1
        for r in range(n):
            seen.add(tuple(col[(i - r) % n] for i in range(n)))
    return orbits


def main():
    n, k = map(int, sys.stdin.read().split())
    print(orbit_count(n, k))


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches Tasks 3 and 4 exactly for all `n ≤ 12, k ≤ 4`. This is the ground truth.

---

## Intermediate Tasks (5)

### Task 6 — Bracelet count (dihedral group)

**Problem.** Count distinct `k`-color `n`-bead **bracelets** (rotations + reflections). Add the parity-split reflection terms to the rotation sum and divide by `2n`.

**Input / Output spec.**
- Read `n`, `k`. Print the bracelet count.

**Constraints.**
- `1 ≤ n ≤ 10^6`, `1 ≤ k ≤ 6`.

**Hint.** `rotSum = Σ_{d|n} φ(d) k^{n/d}`. Odd `n`: `reflect = n·k^{(n+1)/2}`. Even `n`: `reflect = (n/2)(k^{n/2+1} + k^{n/2})`. Answer `= (rotSum + reflect) / (2n)`.

**Starter — Python.**
```python
import sys


def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def rotation_sum(n, k):
    s, d = 0, 1
    while d * d <= n:
        if n % d == 0:
            s += totient(d) * k ** (n // d)
            if d != n // d:
                e = n // d
                s += totient(e) * k ** (n // e)
        d += 1
    return s


def bracelets(n, k):
    # TODO: add reflection terms by parity, divide by 2n
    return 0


def main():
    n, k = map(int, sys.stdin.read().split())
    print(bracelets(n, k))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func totient(m int) int { /* Task 4 */ return 0 }
func powInt(b, e int) int { r := 1; for ; e > 0; e-- { r *= b }; return r }
func rotationSum(n, k int) int { /* Task 4 numerator */ return 0 }

func bracelets(n, k int) int {
	// TODO
	return 0
}

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	fmt.Println(bracelets(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static int totient(int m) { /* Task 4 */ return 0; }
    static int powInt(int b, int e) { int r = 1; while (e-- > 0) r *= b; return r; }
    static int rotationSum(int n, int k) { /* Task 4 numerator */ return 0; }

    static int bracelets(int n, int k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(bracelets(sc.nextInt(), sc.nextInt()));
    }
}
```

**Evaluation.** `n=4,k=2 → 6`; `n=6,k=2 → 13`; matches a brute-force orbit count under `D_n` for small `n`.

---

### Task 7 — General Burnside over an explicit group

**Problem.** Given `m` permutations (each of length `n`) forming a group, and `k` colors, count distinct colorings via `(Σ_g k^{count_cycles(g)}) / m`.

**Input / Output spec.**
- Read `n`, `m`, `k`, then `m` permutations. Print the count.

**Constraints.**
- `1 ≤ n ≤ 1000`, `1 ≤ m ≤ 1000`, `1 ≤ k ≤ 10`.

**Hint.** Reuse `count_cycles` from Task 1; sum `k^{cycles}`; integer-divide by `m`.

**Starter — Python.**
```python
import sys


def count_cycles(p):
    n, seen, c = len(p), [False] * len(p), 0
    for s in range(n):
        if not seen[s]:
            c += 1
            j = s
            while not seen[j]:
                seen[j] = True
                j = p[j]
    return c


def burnside(group, k):
    # TODO: Σ k^{count_cycles(g)} / len(group)
    return 0


def main():
    data = list(map(int, sys.stdin.read().split()))
    idx = 0
    n, m, k = data[idx], data[idx + 1], data[idx + 2]
    idx += 3
    group = []
    for _ in range(m):
        group.append(data[idx:idx + n])
        idx += n
    print(burnside(group, k))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func countCycles(p []int) int { /* Task 1 */ return 0 }

func burnside(group [][]int, k int) int {
	// TODO
	return 0
}

func main() {
	var n, m, k int
	fmt.Scan(&n, &m, &k)
	group := make([][]int, m)
	for g := range group {
		group[g] = make([]int, n)
		for i := range group[g] {
			fmt.Scan(&group[g][i])
		}
	}
	fmt.Println(burnside(group, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static int countCycles(int[] p) { /* Task 1 */ return 0; }

    static int burnside(int[][] group, int k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt(), k = sc.nextInt();
        int[][] g = new int[m][n];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < n; j++) g[i][j] = sc.nextInt();
        System.out.println(burnside(g, k));
    }
}
```

**Evaluation.** For the 4 square rotations and `k=2`, prints `6`; the sum must be divisible by `m`.

---

### Task 8 — Per-color count via the weighted cycle index

**Problem.** Count `n`-bead necklaces (rotation only) using exactly `r` beads of color A and `n-r` of color B. Use the weighted Pólya substitution `a_i = x^i + y^i` into `Z(C_n)` and read the coefficient of `x^r y^{n-r}`.

**Input / Output spec.**
- Read `n`, `r`. Print the number of necklaces with exactly `r` A-beads.

**Constraints.**
- `1 ≤ n ≤ 30`, `0 ≤ r ≤ n`.

**Hint.** A cleaner combinatorial form: `(1/n) Σ_{d | gcd(r, n)} φ(d) · C(n/d, r/d)`. (Only divisors `d` dividing both `r` and `n` contribute.)

**Starter — Python.**
```python
import sys
from math import gcd, comb


def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def necklaces_with_count(n, r):
    g = gcd(n, r)
    total = 0
    d = 1
    while d <= g:
        if g % d == 0:
            total += totient(d) * comb(n // d, r // d)
        d += 1
    return total // n


def main():
    n, r = map(int, sys.stdin.read().split())
    print(necklaces_with_count(n, r))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int) int { for b != 0 { a, b = b, a%b }; return a }
func totient(m int) int { /* Task 4 */ return 0 }
func comb(n, r int) int { /* TODO: binomial coefficient */ return 0 }

func necklacesWithCount(n, r int) int {
	// TODO: (1/n) Σ_{d|gcd(n,r)} φ(d) C(n/d, r/d)
	return 0
}

func main() {
	var n, r int
	fmt.Scan(&n, &r)
	fmt.Println(necklacesWithCount(n, r))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }
    static int totient(int m) { /* Task 4 */ return 0; }
    static long comb(int n, int r) { /* TODO */ return 0; }

    static long necklacesWithCount(int n, int r) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(necklacesWithCount(sc.nextInt(), sc.nextInt()));
    }
}
```

**Evaluation.** `n=4,r=2 → 2` (RRBB and RBRB); summing over all `r=0..n` equals `necklace(n, 2)` from Task 4.

---

### Task 9 — Cube face colorings

**Problem.** Count distinct colorings of a cube's 6 faces with `k` colors using `(1/24)(k^6 + 3k^4 + 12k^3 + 8k^2)`.

**Input / Output spec.**
- Read `k`. Print the count.

**Constraints.**
- `1 ≤ k ≤ 1000`.

**Hint.** Evaluate the polynomial, divide by 24 (it is always divisible).

**Starter — Python.**
```python
import sys


def cube_faces(k):
    # TODO: (k^6 + 3k^4 + 12k^3 + 8k^2) / 24
    return 0


def main():
    print(cube_faces(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func powInt(b, e int) int { r := 1; for ; e > 0; e-- { r *= b }; return r }

func cubeFaces(k int) int {
	// TODO
	return 0
}

func main() {
	var k int
	fmt.Scan(&k)
	fmt.Println(cubeFaces(k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static long powInt(long b, int e) { long r = 1; while (e-- > 0) r *= b; return r; }

    static long cubeFaces(long k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(cubeFaces(sc.nextLong()));
    }
}
```

**Evaluation.** `k=2 → 10`, `k=3 → 57`, `k=6 → 2226`. Result always an integer.

---

### Task 10 — Necklaces under a prime modulus

**Problem.** Count `n`-bead `k`-color necklaces (rotation) **mod `p = 10^9 + 7`**, where the `(1/n)` is a Fermat modular inverse.

**Input / Output spec.**
- Read `n`, `k`. Print the count mod `p`.

**Constraints.**
- `1 ≤ n ≤ 10^9`, `1 ≤ k ≤ 10^9`.

**Hint.** Accumulate `Σ_{d|n} φ(d) · powmod(k, n/d, p)` mod `p`; multiply by `powmod(n mod p, p-2, p)`.

**Starter — Python.**
```python
import sys

MOD = 10**9 + 7


def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def necklaces_mod(n, k):
    s, d = 0, 1
    while d * d <= n:
        if n % d == 0:
            s = (s + totient(d) * pow(k, n // d, MOD)) % MOD
            if d != n // d:
                e = n // d
                s = (s + totient(e) * pow(k, n // e, MOD)) % MOD
        d += 1
    # TODO: multiply by Fermat inverse of n
    return s * pow(n, MOD - 2, MOD) % MOD


def main():
    n, k = map(int, sys.stdin.read().split())
    print(necklaces_mod(n, k))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func powMod(a, e, m int64) int64 { /* binary exp */ return 0 }
func totient(m int64) int64 { /* Task 4 */ return 0 }

func necklacesMod(n, k int64) int64 {
	// TODO: Σ φ(d) k^{n/d} mod p, then * inverse(n)
	return 0
}

func main() {
	var n, k int64
	fmt.Scan(&n, &k)
	fmt.Println(necklacesMod(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static final long MOD = 1_000_000_007L;
    static long powMod(long a, long e, long m) { /* binary exp */ return 0; }
    static long totient(long m) { /* Task 4 */ return 0; }

    static long necklacesMod(long n, long k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(necklacesMod(sc.nextLong(), sc.nextLong()));
    }
}
```

**Evaluation.** For small `n, k` matches Task 4 exactly (the non-modular count, taken mod `p`). Runs instantly for `n = 10^9`.

---

## Advanced Tasks (5)

### Task 11 — Count graphs up to isomorphism

**Problem.** Count distinct unlabeled graphs on `n` vertices via Burnside over `S_n` acting on the `C(n,2)` edges, summing over cycle-type partitions.

**Input / Output spec.**
- Read `n`. Print the count (mod `10^9+7` for `n` near 30; exact for small `n`).

**Constraints.**
- `1 ≤ n ≤ 30`.

**Hint.** For each integer partition (cycle type) of `n`: induced edge cycles `= Σ ⌊L/2⌋ + Σ_{i<j} gcd(a_i, a_j)`; class size `= n! / ∏ (i^{m_i} m_i!)`; accumulate `classSize · 2^{edgeCycles}`; divide by `n!`.

**Starter — Python.**
```python
import sys
from math import gcd, factorial
from collections import Counter

MOD = 10**9 + 7


def edge_cycles(ct):
    total = sum(L // 2 for L in ct)
    for i in range(len(ct)):
        for j in range(i + 1, len(ct)):
            total += gcd(ct[i], ct[j])
    return total


def class_size(ct, n):
    cnt = Counter(ct)
    denom = 1
    for length, m in cnt.items():
        denom *= (length ** m) * factorial(m)
    return factorial(n) // denom


def partitions(n, mx=None):
    if mx is None:
        mx = n
    if n == 0:
        yield []
        return
    for first in range(min(n, mx), 0, -1):
        for rest in partitions(n - first, first):
            yield [first] + rest


def graphs(n):
    # TODO: Σ_partitions classSize·2^{edgeCycles}, divide by n! (Fermat inverse mod p)
    return 0


def main():
    print(graphs(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Starter — Go / Java.** Mirror the Python structure (see `interview.md` Challenge 4 for full reference solutions in all three languages).

**Evaluation.** Prints OEIS A000088: `1, 2, 4, 11, 34, 156, 1044, …` for `n = 1, 2, 3, …`.

---

### Task 12 — Aperiodic (Lyndon) necklace count

**Problem.** Count aperiodic `n`-bead `k`-color necklaces (orbits of full size `n`) via Möbius inversion: `M(n,k) = (1/n) Σ_{d|n} μ(d) k^{n/d}`.

**Input / Output spec.**
- Read `n`, `k`. Print `M(n, k)`.

**Constraints.**
- `1 ≤ n ≤ 10^9`, `1 ≤ k ≤ 10^9`. Mod `10^9+7`.

**Hint.** Implement the Möbius function `μ(d)` (0 if `d` not squarefree, else `(-1)^{#distinct primes}`). Accumulate carefully with negatives mod `p`.

**Starter — Python.**
```python
import sys

MOD = 10**9 + 7


def mobius(d):
    res, p, distinct = 1, 2, 0
    while p * p <= d:
        if d % p == 0:
            d //= p
            distinct += 1
            if d % p == 0:      # square factor
                return 0
        else:
            p += 1
    if d > 1:
        distinct += 1
    return -1 if distinct % 2 else 1


def lyndon(n, k):
    # TODO: (1/n) Σ_{d|n} μ(d) k^{n/d} mod p (mind negatives)
    return 0


def main():
    n, k = map(int, sys.stdin.read().split())
    print(lyndon(n, k))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func mobius(d int64) int { /* TODO */ return 0 }
func powMod(a, e, m int64) int64 { /* binary exp */ return 0 }

func lyndon(n, k int64) int64 {
	// TODO
	return 0
}

func main() {
	var n, k int64
	fmt.Scan(&n, &k)
	fmt.Println(lyndon(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    static final long MOD = 1_000_000_007L;
    static int mobius(long d) { /* TODO */ return 0; }
    static long powMod(long a, long e, long m) { /* binary exp */ return 0; }

    static long lyndon(long n, long k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(lyndon(sc.nextLong(), sc.nextLong()));
    }
}
```

**Evaluation.** `M(4,2) = 3`, `M(6,2) = 9`; check `Σ_{d|n} M(d,k) = necklace(n,k)` (Task 4).

---

### Task 13 — Build a symmetry group from generators

**Problem.** Given generators (permutations of `n` slots), generate the full group by closure, then count distinct `k`-colorings via Burnside.

**Input / Output spec.**
- Read `n`, `g` (number of generators), `k`, then `g` permutations. Print `|G|` and the coloring count.

**Constraints.**
- `1 ≤ n ≤ 12`, `1 ≤ g ≤ 4`, `1 ≤ k ≤ 6`; `|G| ≤ 100000`.

**Hint.** BFS over permutations: seed with the identity, compose each frontier element with every generator, add new permutations (use a string/tuple key in a set) until closed. Then run general Burnside (Task 7).

**Starter — Python.**
```python
import sys


def compose(g, s):  # (g∘s)(i) = g(s(i))
    return tuple(g[s[i]] for i in range(len(g)))


def generate(gens, n):
    ident = tuple(range(n))
    seen, group, frontier = {ident}, [ident], [ident]
    while frontier:
        g = frontier.pop()
        for s in gens:
            h = compose(g, s)
            if h not in seen:
                seen.add(h)
                group.append(h)
                frontier.append(h)
    return group


def count_cycles(p):
    n, seen, c = len(p), [False] * len(p), 0
    for s in range(n):
        if not seen[s]:
            c += 1
            j = s
            while not seen[j]:
                seen[j] = True
                j = p[j]
    return c


def main():
    data = list(map(int, sys.stdin.read().split()))
    idx = 0
    n, g, k = data[idx], data[idx + 1], data[idx + 2]
    idx += 3
    gens = []
    for _ in range(g):
        gens.append(tuple(data[idx:idx + n]))
        idx += n
    group = generate(gens, n)
    total = sum(k ** count_cycles(p) for p in group) // len(group)
    print(len(group), total)


if __name__ == "__main__":
    main()
```

**Starter — Go / Java.** Mirror the Python BFS-closure structure (see `senior.md` Section 7.1 for a full Go reference).

**Evaluation.** Generator `[1,2,3,0]` with `n=4` generates `|G|=4` (`C_4`) and counts `6` for `k=2`. The generated set must be closed under composition.

---

### Task 14 — Square-grid colorings under all 8 symmetries

**Problem.** Count distinct colorings of an `m × m` grid of cells with `k` colors under the dihedral symmetry of the square (4 rotations + 4 reflections, `|G| = 8`). Treat the `m²` cells as slots; build each of the 8 cell-permutations and apply Burnside.

**Input / Output spec.**
- Read `m`, `k`. Print the count.

**Constraints.**
- `1 ≤ m ≤ 6`, `1 ≤ k ≤ 4` (answers may be large — use big integers / Python native).

**Hint.** For a cell at `(r, c)`, the 8 symmetries map it to `(r,c)`, `(c, m-1-r)`, `(m-1-r, m-1-c)`, `(m-1-c, r)` (rotations) and their reflected versions. Build each permutation on the flattened index `r*m + c`, count cycles, sum `k^{cycles}`, divide by 8.

**Starter — Python.**
```python
import sys


def grid_symmetries(m):
    def idx(r, c):
        return r * m + c
    syms = []
    transforms = [
        lambda r, c: (r, c),
        lambda r, c: (c, m - 1 - r),
        lambda r, c: (m - 1 - r, m - 1 - c),
        lambda r, c: (m - 1 - c, r),
        lambda r, c: (r, m - 1 - c),          # horizontal flip
        lambda r, c: (m - 1 - r, c),          # vertical flip
        lambda r, c: (c, r),                  # main diagonal
        lambda r, c: (m - 1 - c, m - 1 - r),  # anti-diagonal
    ]
    for t in transforms:
        perm = [0] * (m * m)
        for r in range(m):
            for c in range(m):
                nr, nc = t(r, c)
                perm[idx(r, c)] = idx(nr, nc)
        syms.append(perm)
    return syms


def count_cycles(p):
    n, seen, cyc = len(p), [False] * len(p), 0
    for s in range(n):
        if not seen[s]:
            cyc += 1
            j = s
            while not seen[j]:
                seen[j] = True
                j = p[j]
    return cyc


def grid_colorings(m, k):
    # TODO: Σ_g k^{count_cycles(g)} / 8
    return 0


def main():
    m, k = map(int, sys.stdin.read().split())
    print(grid_colorings(m, k))


if __name__ == "__main__":
    main()
```

**Starter — Go / Java.** Mirror the Python structure: build the 8 cell-permutations on the flattened `m²` indices, reuse `countCycles` (Task 1) and general Burnside (Task 7).

**Evaluation.** `m=2, k=2 → 6`; `m=3, k=2 → 26`. Cross-check against a brute-force orbit count over all `k^{m²}` grids for small `m`.

---

### Task 15 — Benchmark: closed form vs explicit loop vs brute force

**Problem.** Compare three necklace-counting methods across increasing `n`: the `O(√n)` closed form (Task 4), the `O(n)` explicit Burnside loop (Task 3), and the `O(k^n)` brute-force oracle (Task 5, small `n` only). Report timings.

> Compare performance across all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

// plug in your necklaceClosed (Task 4) and necklaceLoop (Task 3)

func main() {
	sizes := []int{8, 12, 16, 20, 1000, 1000000}
	k := 3
	for _, n := range sizes {
		start := time.Now()
		for i := 0; i < 50; i++ {
			_ = necklaceClosed(n, k) // O(√n)
		}
		fmt.Printf("closed  n=%8d: %.3f ms\n", n, float64(time.Since(start).Microseconds())/50.0/1000.0)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {8, 12, 16, 20, 1000, 1000000};
        int k = 3;
        for (int n : sizes) {
            long start = System.nanoTime();
            for (int i = 0; i < 50; i++) {
                long r = necklaceClosed(n, k); // O(√n)
            }
            long elapsed = System.nanoTime() - start;
            System.out.printf("closed  n=%8d: %.3f ms%n", n, elapsed / 50.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import timeit

# plug in necklace_closed (Task 4), necklace_loop (Task 3)

sizes = [8, 12, 16, 20, 1_000, 1_000_000]
k = 3
for n in sizes:
    t = timeit.timeit(lambda: necklace_closed(n, k), number=50)
    print(f"closed  n={n:>8}: {t/50*1000:.3f} ms")
    if n <= 16:
        t2 = timeit.timeit(lambda: orbit_count(n, k), number=5)  # brute force
        print(f"brute   n={n:>8}: {t2/5*1000:.3f} ms")
```

**Evaluation.** All three agree where they overlap (small `n`). The closed form stays flat as `n` grows to `10^6`; the explicit loop scales linearly; the brute force becomes infeasible past `n ≈ 16`. Report the crossover where each method becomes impractical.

---

## Testing Guidance

- **Brute-force orbit oracle (Task 5):** enumerate `k^n` colorings, bucket by orbit, count. Run for all `n ≤ 12, k ≤ 4`.
- **Integer check:** every Burnside sum must be divisible by `|G|`; a fraction means a wrong group or `|Fix|`.
- **`k = 1` check:** every method must return `1`.
- **OEIS cross-checks:** necklaces A000031, bracelets A000029, aperiodic A001037, graphs A000088.
- **Closed form vs loop:** Task 4 must match Task 3 wherever both are feasible.
- **Cross-language determinism:** Go, Java, and Python must produce identical output for shared inputs.

# Chinese Remainder Theorem (CRT) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the CRT logic and validate against the evaluation criteria.
> **Always test against a brute-force scan over `[0, lcm)` on small inputs before trusting the merge result.** For non-coprime systems, confirm the consistency check rejects inconsistent inputs.

---

## Beginner Tasks (5)

### Task 1 — Modular inverse via Extended Euclid

**Problem.** Implement `modInverse(a, m)` returning `a⁻¹ mod m` (the `t` with `a·t ≡ 1 (mod m)`), assuming `gcd(a, m) = 1`. This is the core helper every CRT routine needs.

**Input / Output spec.**
- Read `a`, `m`.
- Print `a⁻¹ mod m`, normalized into `[0, m)`.

**Constraints.** `1 ≤ a < m ≤ 10⁹`, `gcd(a, m) = 1`.

**Hint.** `extgcd(a, m)` returns `(g, x, y)` with `a·x + m·y = g`; the inverse is `x mod m`.

**Starter — Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	// TODO: return g, x, y with a*x + b*y = g
	return 0, 0, 0
}

func modInverse(a, m int64) int64 {
	// TODO: use extgcd, normalize into [0, m)
	return 0
}

func main() {
	var a, m int64
	fmt.Scan(&a, &m)
	fmt.Println(modInverse(a, m))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class ModInverse {
    static long[] extgcd(long a, long b) {
        // TODO
        return new long[]{0, 0, 0};
    }
    static long modInverse(long a, long m) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), m = sc.nextLong();
        System.out.println(modInverse(a, m));
    }
}
```

**Starter — Python.**
```python
def extgcd(a, b):
    # TODO: return (g, x, y)
    return 0, 0, 0

def mod_inverse(a, m):
    # TODO
    return 0

if __name__ == "__main__":
    a, m = map(int, input().split())
    print(mod_inverse(a, m))
```

---

### Task 2 — Merge two coprime congruences

**Problem.** Given `a₁, m₁, a₂, m₂` with `gcd(m₁, m₂) = 1`, output the unique `x` in `[0, m₁m₂)` solving both congruences.

**Input / Output spec.** Read `a1 m1 a2 m2`; print `x`.

**Constraints.** `0 ≤ aᵢ < mᵢ ≤ 10⁶`, moduli coprime.

**Hint.** `x = a₁ + m₁·t` where `t ≡ (a₂−a₁)·m₁⁻¹ (mod m₂)`.

**Starter — Go.**
```go
package main

import "fmt"

func crtCoprime(a1, m1, a2, m2 int64) int64 {
	// TODO
	return 0
}
func main() {
	var a1, m1, a2, m2 int64
	fmt.Scan(&a1, &m1, &a2, &m2)
	fmt.Println(crtCoprime(a1, m1, a2, m2))
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class MergeCoprime {
    static long crtCoprime(long a1, long m1, long a2, long m2) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(crtCoprime(sc.nextLong(), sc.nextLong(),
                                      sc.nextLong(), sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
def crt_coprime(a1, m1, a2, m2):
    # TODO
    return 0

if __name__ == "__main__":
    a1, m1, a2, m2 = map(int, input().split())
    print(crt_coprime(a1, m1, a2, m2))
```

---

### Task 3 — Solve the soldier-counting puzzle

**Problem.** Read `n` and `n` lines of `aᵢ mᵢ` (coprime moduli). Output the unique `x` in `[0, M)`.

**Input / Output spec.** First line `n`; then `n` lines each `a m`; print `x`.

**Constraints.** `1 ≤ n ≤ 10`, moduli pairwise coprime, product fits in 64 bits.

**Hint.** Fold pairwise: keep a running `(a, m)`, merge each congruence in.

**Starter — Python.**
```python
def crt_fold(residues, moduli):
    # TODO: fold using a coprime merge
    return 0

if __name__ == "__main__":
    n = int(input())
    res, mod = [], []
    for _ in range(n):
        a, m = map(int, input().split())
        res.append(a); mod.append(m)
    print(crt_fold(res, mod))
```

(Provide the analogous Go and Java `main` that read `n` congruences and call your fold.)

---

### Task 4 — Brute-force CRT oracle

**Problem.** Implement `crtBruteforce(residues, moduli)` that scans `0..lcm-1` and returns the first `x` matching all congruences, or `-1` if none exists. Use it as a test oracle for later tasks.

**Input / Output spec.** Read `n`, then `n` lines `a m`; print the smallest solution or `-1`.

**Constraints.** `1 ≤ n ≤ 6`, `1 ≤ mᵢ ≤ 50` (so `lcm` is tiny).

**Hint.** Compute `lcm` incrementally; iterate `x` from `0`; check `x % mᵢ == aᵢ % mᵢ`.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 { for b != 0 { a, b = b, a%b }; return a }

func crtBruteforce(res, mod []int64) int64 {
	// TODO: build lcm, scan, return first match or -1
	return -1
}
func main() {
	var n int
	fmt.Scan(&n)
	res := make([]int64, n)
	mod := make([]int64, n)
	for i := 0; i < n; i++ {
		fmt.Scan(&res[i], &mod[i])
	}
	fmt.Println(crtBruteforce(res, mod))
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Brute {
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }
    static long crtBruteforce(long[] res, long[] mod) {
        // TODO
        return -1;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] res = new long[n], mod = new long[n];
        for (int i = 0; i < n; i++) { res[i] = sc.nextLong(); mod[i] = sc.nextLong(); }
        System.out.println(crtBruteforce(res, mod));
    }
}
```

**Starter — Python.**
```python
from math import gcd

def crt_bruteforce(res, mod):
    # TODO
    return -1

if __name__ == "__main__":
    n = int(input())
    res, mod = [], []
    for _ in range(n):
        a, m = map(int, input().split())
        res.append(a); mod.append(m)
    print(crt_bruteforce(res, mod))
```

---

### Task 5 — Normalize residues

**Problem.** Given possibly-negative residues, normalize each `aᵢ` into `[0, mᵢ)` before solving. Read `n` congruences (residues may be negative), print the normalized residues and then the CRT solution (coprime moduli).

**Input / Output spec.** First line `n`; then `n` lines `a m`; print `n` normalized residues space-separated on one line, then the solution on the next.

**Constraints.** `−10⁹ ≤ aᵢ ≤ 10⁹`, `1 ≤ mᵢ ≤ 10⁴`, coprime moduli.

**Hint.** `aᵢ = ((aᵢ % mᵢ) + mᵢ) % mᵢ`. Reuse your Task 3 fold afterward.

---

## Intermediate Tasks (4)

### Task 6 — Generalized CRT with consistency check

**Problem.** Moduli may share factors. Output the smallest non-negative solution and the combined `lcm`, or print `IMPOSSIBLE` if the system is inconsistent.

**Input / Output spec.** First line `n`; then `n` lines `a m`; print `x lcm` or `IMPOSSIBLE`.

**Constraints.** `1 ≤ n ≤ 50`, `1 ≤ mᵢ ≤ 10⁹`, the final `lcm` fits in 64 bits.

**Hint.** Merge with `extgcd(m, mᵢ)`; reject when `(aᵢ − a) % gcd != 0`; combined modulus is the `lcm`; compute `lcm = m / g * mᵢ`.

**Starter — Go.**
```go
package main

import "fmt"

func eg(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x, y := eg(b, a%b); return g, y, x - (a/b)*y
}
func crtGeneral(res, mod []int64) (int64, int64, bool) {
	// TODO: fold with consistency check
	return 0, 0, false
}
func main() {
	var n int
	fmt.Scan(&n)
	res := make([]int64, n); mod := make([]int64, n)
	for i := 0; i < n; i++ { fmt.Scan(&res[i], &mod[i]) }
	if x, l, ok := crtGeneral(res, mod); ok {
		fmt.Println(x, l)
	} else {
		fmt.Println("IMPOSSIBLE")
	}
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class CrtGeneral {
    static long[] eg(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = eg(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long[] crtGeneral(long[] res, long[] mod) {
        // TODO: return {x, lcm, ok}
        return new long[]{0, 0, 0};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] res = new long[n], mod = new long[n];
        for (int i = 0; i < n; i++) { res[i] = sc.nextLong(); mod[i] = sc.nextLong(); }
        long[] r = crtGeneral(res, mod);
        if (r[2] == 1) System.out.println(r[0] + " " + r[1]);
        else System.out.println("IMPOSSIBLE");
    }
}
```

**Starter — Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def crt_general(res, mod):
    # TODO: return (x, lcm) or None
    return None

if __name__ == "__main__":
    n = int(input())
    res, mod = [], []
    for _ in range(n):
        a, m = map(int, input().split())
        res.append(a); mod.append(m)
    r = crt_general(res, mod)
    print("IMPOSSIBLE" if r is None else f"{r[0]} {r[1]}")
```

---

### Task 7 — Reconstruct a number from residues

**Problem.** A hidden non-negative integer `X < ∏ pᵢ` is given by its residues modulo `n` distinct primes. Recover `X`.

**Input / Output spec.** First line `n`; then `n` lines `r p`; print `X`.

**Constraints.** `1 ≤ n ≤ 6`, primes distinct, `∏ pᵢ ≤ 10¹⁸`, `0 ≤ r < p`.

**Hint.** This is a coprime CRT fold; the recovered representative in `[0, ∏ pᵢ)` is `X` because `X < ∏ pᵢ`.

**Starter — Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def reconstruct(res, primes):
    # TODO: coprime fold; representative in [0, product) is X
    return 0

if __name__ == "__main__":
    n = int(input())
    res, primes = [], []
    for _ in range(n):
        r, p = map(int, input().split())
        res.append(r); primes.append(p)
    print(reconstruct(res, primes))
```

(Provide Go and Java equivalents reading `n` then `r p` lines.)

---

### Task 8 — When do the cycles align? (calendar problem)

**Problem.** Three recurring events have periods `m₁, m₂, m₃` and first occur on days `a₁, a₂, a₃` (so event `i` happens on days `≡ aᵢ (mod mᵢ)`). Find the smallest day `≥ 0` on which all three coincide, or report it never happens.

**Input / Output spec.** Read three lines `a m`; print the smallest day, or `NEVER`.

**Constraints.** `1 ≤ mᵢ ≤ 10⁶`, periods may share factors.

**Hint.** This is generalized CRT. The answer is the smallest non-negative solution; `NEVER` when inconsistent.

**Starter — Go.**
```go
package main

import "fmt"

func eg(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x, y := eg(b, a%b); return g, y, x - (a/b)*y
}
func main() {
	var a [3]int64
	var m [3]int64
	for i := 0; i < 3; i++ { fmt.Scan(&a[i], &m[i]) }
	// TODO: generalized CRT fold over the three congruences
	_ = eg
	fmt.Println("NEVER")
}
```

(Add Java and Python equivalents; reuse your Task 6 generalized merge.)

---

## Advanced Tasks (3)

### Task 9 — Overflow-safe CRT with mulmod

**Problem.** Merge `n` congruences where the combined `lcm` may approach `2⁶³`. Use a `mulmod` to keep the back-substitution `a + m·t (mod lcm)` correct. Output the solution and `lcm`, or `IMPOSSIBLE`.

**Input / Output spec.** First line `n`; then `n` lines `a m`; print `x lcm` or `IMPOSSIBLE`.

**Constraints.** `1 ≤ n ≤ 50`, `1 ≤ mᵢ < 2⁶²`, final `lcm < 2⁶³`.

**Hint.** In Go use `math/bits.Mul64` + `Div64`; in Java use `BigInteger` for the single product; Python is exact by default and serves as your reference.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}
func eg(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x, y := eg(b, a%b); return g, y, x - (a/b)*y
}
func crtSafe(res, mod []int64) (int64, int64, bool) {
	// TODO: fold; use mulmod for a + m*t mod lcm
	return 0, 0, false
}
func main() {
	var n int
	fmt.Scan(&n)
	res := make([]int64, n); mod := make([]int64, n)
	for i := 0; i < n; i++ { fmt.Scan(&res[i], &mod[i]) }
	if x, l, ok := crtSafe(res, mod); ok {
		fmt.Println(x, l)
	} else {
		fmt.Println("IMPOSSIBLE")
	}
}
```

(Provide Java with `BigInteger` mulmod and a Python reference.)

---

### Task 10 — Garner mixed-radix reconstruction

**Problem.** Given `n` pairwise-coprime moduli and residues whose product exceeds 64 bits, reconstruct the value using **Garner's algorithm** and print it (use big integers for the final assembly). Compute the mixed-radix digits `cᵢ` with precomputed inverses.

**Input / Output spec.** First line `n`; then `n` lines `a m`; print the reconstructed integer (may be very large).

**Constraints.** `1 ≤ n ≤ 100`, `mᵢ` up to `10⁹`, pairwise coprime.

**Hint.** `cₖ = (aₖ − Horner-prefix) · (m₁…m_{k−1})⁻¹ (mod mₖ)`; assemble `x = c₁ + c₂m₁ + …` in big-integer arithmetic. Cross-check against `crt_general` for small cases.

**Starter — Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def garner(res, mod):
    # TODO: compute mixed-radix digits, assemble with big ints
    return 0

if __name__ == "__main__":
    n = int(input())
    res, mod = [], []
    for _ in range(n):
        a, m = map(int, input().split())
        res.append(a); mod.append(m)
    print(garner(res, mod))
```

(Provide Go using `math/big` and Java using `BigInteger`.)

---

### Task 11 — Multi-mod product mod a target

**Problem.** Compute `(A · B) mod M` for huge `A, B` (given mod three coprime primes `p₁, p₂, p₃`) by multiplying componentwise mod each prime and CRT-reconstructing, then reducing mod a target `M`. Demonstrate it matches a big-integer reference.

**Input / Output spec.** Read `M`, then three lines `aᵢ bᵢ pᵢ` (`aᵢ = A mod pᵢ`, `bᵢ = B mod pᵢ`). Compute `cᵢ = aᵢ·bᵢ mod pᵢ`, reconstruct `C` mod `p₁p₂p₃`, print `C mod M`.

**Constraints.** Primes near `10⁹`, `M ≤ 10¹⁸`. Assume the true product `C < p₁p₂p₃`.

**Hint.** Per-prime multiply, then a coprime CRT fold; reduce the reconstructed value mod `M` last. Garner keeps intermediates small.

**Starter — Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def solve(M, triples):
    # triples: list of (a_i, b_i, p_i)
    res = [(a * b) % p for a, b, p in triples]
    mod = [p for _, _, p in triples]
    # TODO: coprime CRT fold over (res, mod), then reduce mod M
    return 0

if __name__ == "__main__":
    M = int(input())
    triples = [tuple(map(int, input().split())) for _ in range(3)]
    print(solve(M, triples))
```

(Provide Go and Java equivalents; both can rely on the per-prime products fitting in 64 bits with `mulmod`.)

---

## Evaluation Criteria

- **Correctness:** every solution must satisfy all input congruences and lie in `[0, lcm)` (or `[0, M)`); inconsistent systems must be reported, never "solved".
- **Overflow safety:** advanced tasks must not overflow 64-bit integers — use `mulmod` / big integers where the spec demands.
- **Consistency handling:** generalized tasks must detect and report `IMPOSSIBLE` / `NEVER` correctly.
- **Oracle agreement:** validate against the Task 4 brute-force scan on small inputs.
- **Three languages:** Go, Java, and Python solutions must all pass the same tests.

# Extended Euclidean Algorithm & Modular Inverse — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the extended-Euclid / modular-inverse logic and validate against the evaluation criteria.
> **Always verify an inverse with `(a * inv) % m == 1`, and a congruence solution by plugging it back into `a·x ≡ b (mod m)`.**

---

## Beginner Tasks (6)

### Task 1 — Extended Euclid coefficients

**Problem.** Implement `extgcd(a, b)` returning `(g, x, y)` with `a·x + b·y = g = gcd(a, b)`. Use either the recursive or iterative form.

**Input / Output spec.**
- Read two non-negative integers `a` and `b`.
- Print `g x y` on one line.

**Constraints.**
- `0 ≤ a, b ≤ 10^9`, not both zero.

**Hint.** Recursive: base `extgcd(a, 0) = (a, 1, 0)`; step `x = y₁`, `y = x₁ - (a/b)·y₁`. Verify `a·x + b·y == g`.

**Starter — Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	// TODO: return (g, x, y) with a*x + b*y = g
	return 0, 0, 0
}

func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	g, x, y := extgcd(a, b)
	fmt.Println(g, x, y)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long[] extgcd(long a, long b) {
        // TODO
        return new long[]{0, 0, 0};
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        long[] r = extgcd(a, b);
        System.out.println(r[0] + " " + r[1] + " " + r[2]);
    }
}
```

**Starter — Python.**
```python
import sys


def extgcd(a, b):
    # TODO
    return 0, 0, 0


def main():
    a, b = map(int, sys.stdin.read().split())
    print(*extgcd(a, b))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `a·x + b·y == g` holds exactly.
- `g == gcd(a, b)`.
- Works when `a < b` (the first step swaps).

---

### Task 2 — Modular inverse with existence check

**Problem.** Implement `mod_inverse(a, m)` returning `a⁻¹ mod m` in `[0, m)`, or `-1` if no inverse exists.

**Input / Output spec.**
- Read `a` and `m`.
- Print the inverse, or `-1`.

**Constraints.** `0 ≤ a < m ≤ 10^9`.

**Hint.** Run `extgcd(a, m)`; if `g != 1` return `-1`; else normalize `((x % m) + m) % m`.

**Worked check.** `mod_inverse(3, 11) = 4`; `mod_inverse(4, 6) = -1` (gcd 2); `mod_inverse(0, 5) = -1` (0 has no inverse).

**Evaluation criteria.**
- Returns `-1` exactly when `gcd(a, m) != 1`.
- Result is in `[0, m)` and satisfies `(a * inv) % m == 1`.
- Handles `a = 0` and `a = 1` correctly.

---

### Task 3 — Fermat inverse for a prime modulus

**Problem.** Given a **prime** `p` and `a` with `a % p != 0`, compute `a⁻¹ mod p` via Fermat's little theorem: `a^(p-2) mod p`. Implement your own fast modular exponentiation.

**Input / Output spec.**
- Read `a` and prime `p`.
- Print `a⁻¹ mod p`.

**Constraints.** `1 ≤ a < p ≤ 10^9`, `p` prime.

**Hint.** Binary exponentiation: `pow(a, p-2)` reducing mod `p` each step. Compare your result with extended Euclid's inverse — they must match.

**Worked check.** `inv_fermat(3, 11) = 3^9 mod 11 = 4`, agreeing with Task 2.

**Evaluation criteria.**
- Matches the extended-Euclid inverse for the same `(a, p)`.
- `O(log p)` exponentiation, no overflow (64-bit products).
- Documents that it only works for prime `p`.

---

### Task 4 — Inverses of 1..n mod a prime (O(n) table)

**Problem.** Given `n` and a prime `p > n`, compute `inv[1..n]` with the linear recurrence `inv[i] = -(p/i)·inv[p%i] % p`, `inv[1] = 1`.

**Input / Output spec.**
- Read `n` and `p`.
- Print `inv[1], …, inv[n]` space-separated.

**Constraints.** `1 ≤ n ≤ 10^6`, `n < p ≤ 10^9`, `p` prime.

**Hint.** Build the array in one increasing pass; `inv[p % i]` is already filled since `p % i < i`. Normalize each value into `[0, p)`.

**Worked check.** `n = 10, p = 11 → [1, 6, 4, 3, 9, 2, 8, 7, 5, 10]`. Assert `i·inv[i] ≡ 1` for all `i`.

**Evaluation criteria.**
- `O(n)` total (no per-element `O(log p)` inversion).
- Every `i·inv[i] % p == 1`.
- Correct on `p = 11` reference table.

---

### Task 5 — Verify the inverse

**Problem.** Implement a checker `is_inverse(a, b, m)` returning `True` iff `a·b ≡ 1 (mod m)`. Use it to validate inverses from earlier tasks.

**Input / Output spec.**
- Read `a`, `b`, `m`.
- Print `true` or `false`.

**Constraints.** `0 ≤ a, b < m ≤ 10^18` (use 128-bit products or big integers for the multiply).

**Hint.** Compute `(a * b) % m` carefully — for `m` near `10^18`, `a*b` overflows 64 bits. Use `__int128`/`BigInteger`/Python int.

**Evaluation criteria.**
- Correct for large `m` without overflow.
- `is_inverse(3, 4, 11) == true`, `is_inverse(3, 5, 11) == false`.
- Used as the assertion in Tasks 2–4.

---

### Task 5b — Recursive vs iterative ext-gcd agreement

**Problem.** Implement **both** a recursive `extgcd_rec(a, b)` and an iterative `extgcd_iter(a, b)`, each returning `(g, x, y)` with `a·x + b·y = g`. Assert they return the *same* triple on every input, and that `a·x + b·y == g`.

**Input / Output spec.**
- Read `a` and `b`.
- Print `g x y` from the recursive version, then `g x y` from the iterative version on the next line. The two lines must match.

**Constraints.** `0 ≤ a, b ≤ 10^9`, not both zero.

**Hint.** Recursive: `extgcd(b, a % b)` then `x = y₁`, `y = x₁ - (a/b)·y₁`. Iterative: carry `(old_r, old_s, old_t)` and `(r, s, t)`. Both return the *minimal* Bezout pair, so they agree exactly.

**Starter — Go.**
```go
package main

import "fmt"

func extgcdRec(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcdRec(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func extgcdIter(a, b int64) (int64, int64, int64) {
	oldR, r := a, b
	oldS, s := int64(1), int64(0)
	oldT, t := int64(0), int64(1)
	for r != 0 {
		q := oldR / r
		oldR, r = r, oldR-q*r
		oldS, s = s, oldS-q*s
		oldT, t = t, oldT-q*t
	}
	return oldR, oldS, oldT
}

func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	g1, x1, y1 := extgcdRec(a, b)
	g2, x2, y2 := extgcdIter(a, b)
	fmt.Println(g1, x1, y1)
	fmt.Println(g2, x2, y2)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5b {
    static long[] rec(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = rec(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static long[] iter(long a, long b) {
        long oldR = a, r = b, oldS = 1, s = 0, oldT = 0, t = 1;
        while (r != 0) {
            long q = oldR / r;
            long tr = oldR - q * r; oldR = r; r = tr;
            long ts = oldS - q * s; oldS = s; s = ts;
            long tt = oldT - q * t; oldT = t; t = tt;
        }
        return new long[]{oldR, oldS, oldT};
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        long[] p = rec(a, b), q = iter(a, b);
        System.out.println(p[0] + " " + p[1] + " " + p[2]);
        System.out.println(q[0] + " " + q[1] + " " + q[2]);
    }
}
```

**Starter — Python.**
```python
import sys


def extgcd_rec(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd_rec(b, a % b)
    return g, y1, x1 - (a // b) * y1


def extgcd_iter(a, b):
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t


def main():
    a, b = map(int, sys.stdin.read().split())
    print(*extgcd_rec(a, b))
    print(*extgcd_iter(a, b))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- The two output lines are identical for every input.
- `a·x + b·y == g` for both versions.
- The iterative version uses constant stack (no recursion).

---

## Intermediate Tasks (5)

### Task 6 — Solve a·x ≡ b (mod m), all solutions

**Problem.** Given `a, b, m`, output every `x ∈ [0, m)` with `a·x ≡ b (mod m)`, sorted, or an empty line if none.

**Constraints.** `1 ≤ m ≤ 10^9`, `0 ≤ a, b < m`.

**Hint.** `g = gcd(a, m)`. If `g ∤ b`, no solution. Else `x₀ = x'·(b/g) mod (m/g)`; solutions are `x₀ + t·(m/g)` for `t = 0..g-1`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_congruence(a, b, m):
    return [x for x in range(m) if (a * x) % m == b % m]
```

**Evaluation criteria.**
- Matches `brute_congruence` for small `m`.
- Returns all `g = gcd(a, m)` solutions when `g | b`, none otherwise.
- Solutions are spaced exactly `m/g` apart.

---

### Task 7 — Iterative extended Euclid

**Problem.** Implement the **iterative** `extgcd` (no recursion) maintaining the invariant `r = s·a + t·b`. Return `(g, x, y)`.

**Constraints.** `0 ≤ a, b ≤ 10^18` (watch overflow in `q*s`; use 128-bit or big integers).

**Hint.** Carry `(old_r, old_s, old_t)` and `(r, s, t)`; each step `q = old_r/r` then update all three pairs. When `r == 0`, the `old_*` row is the answer.

**Evaluation criteria.**
- Produces identical `(g, x, y)` to the recursive version on random inputs.
- No recursion; constant stack.
- `a·x + b·y == g` for large inputs without overflow.

---

### Task 8 — Factorial inverses for binomial coefficients

**Problem.** Precompute `fact[0..N]` and `invfact[0..N]` mod a prime `p`, then answer `Q` queries `C(n, k) = fact[n]·invfact[k]·invfact[n-k] mod p`.

**Constraints.** `1 ≤ N ≤ 10^6`, `1 ≤ Q ≤ 10^5`, `p` prime, `p > N`.

**Hint.** Compute `fact` forward; invert `fact[N]` **once** (Fermat or extended Euclid); sweep backward `invfact[i-1] = invfact[i]·i % p`. One inversion total.

**Reference oracle (Python).**
```python
from math import comb
def check(n, k, p):
    return comb(n, k) % p
```

**Evaluation criteria.**
- Single modular inversion for the whole precompute.
- `C(n, 0) = C(n, n) = 1`; matches `comb(n, k) % p` for small `n`.
- Each query is `O(1)` after `O(N)` precompute.

---

### Task 9 — Modular division a / b mod m

**Problem.** Compute `(a · b⁻¹) mod m` ("modular division"), or report "undefined" if `b⁻¹` does not exist. Read `a, b, m`.

**Constraints.** `0 ≤ a, b < m ≤ 10^9`.

**Hint.** `b⁻¹` exists iff `gcd(b, m) = 1`. If it does, return `(a * inv(b, m)) % m`; otherwise "undefined". Note this differs from solving `b·x ≡ a (mod m)`, which can have solutions even when `b⁻¹` does not exist.

**Evaluation criteria.**
- Returns "undefined" exactly when `gcd(b, m) != 1`.
- `div(1, 3, 11) = 4` (= `3⁻¹`); `div(6, 4, 6)` is undefined.
- Verified: `(result * b) % m == a` when defined.

---

### Task 10 — CRT of two congruences via inverse

**Problem.** Given `x ≡ r1 (mod m1)` and `x ≡ r2 (mod m2)` with **coprime** `m1, m2`, find the unique `x ∈ [0, m1·m2)`. Use a modular inverse in the merge.

**Constraints.** `1 ≤ m1, m2 ≤ 10^9`, `gcd(m1, m2) = 1`.

**Hint.** `x = r1 + m1 · ((r2 - r1) · m1⁻¹ mod m2)`, where `m1⁻¹` is taken mod `m2` (exists since coprime). Reduce into `[0, m1·m2)`; use 128-bit products.

**Reference oracle (Python).**
```python
def brute_crt(r1, m1, r2, m2):
    for x in range(m1 * m2):
        if x % m1 == r1 % m1 and x % m2 == r2 % m2:
            return x
    return -1
```

**Evaluation criteria.**
- Matches `brute_crt` for small moduli.
- Uses exactly one modular inverse (`m1⁻¹ mod m2`).
- Result satisfies both congruences.

---

## Advanced Tasks (6)

### Task 11 — RSA key generation (small primes)

**Problem.** Given two primes `p, q` and a public exponent `e`, compute `n = p·q`, `φ = (p-1)(q-1)`, and the private exponent `d = e⁻¹ mod φ`. Reject if `gcd(e, φ) != 1`. Validate `e·d ≡ 1 (mod φ)`.

**Constraints.** `p, q` prime, `p·q ≤ 10^18` (use 128-bit / big integers), `e` coprime to `φ`.

**Hint.** `φ` is composite, so use **extended Euclid**, not Fermat. After computing `d`, assert `(e*d) % φ == 1`. Optionally test encrypt/decrypt on a sample message.

**Evaluation criteria.**
- Rejects `e` not coprime to `φ`.
- `(e * d) % φ == 1`.
- Round-trip: `(m^e mod n)^d mod n == m` for a sample `m < n`.

---

### Task 12 — Montgomery batch inversion

**Problem.** Given `k` field elements `a₁..aₖ` mod a prime `p` (all coprime to `p`), compute every inverse using **exactly one** modular inversion plus `O(k)` multiplications.

**Constraints.** `1 ≤ k ≤ 10^6`, `p` prime.

**Hint.** Prefix products `prefix[i] = a₁·…·a_i`; invert `prefix[k]` once; walk backward: `a_i⁻¹ = inv_running · prefix[i-1]`, then `inv_running *= a_i`.

**Evaluation criteria.**
- Exactly one call to a single-element inversion routine.
- Every `a_i · a_i⁻¹ % p == 1`.
- Matches per-element inversion results.

---

### Task 13 — Overflow-safe inverse for 64-bit moduli

**Problem.** Implement `mod_inverse(a, m)` correct for `m` up to `~9·10^18` (near `int64` max), handling overflow in the coefficient products `q*s`.

**Constraints.** `0 ≤ a < m ≤ 9·10^18`.

**Hint.** The `q*s` product and the post-normalization can overflow 64-bit. Use 128-bit intermediates (`__int128` in C-like languages, `Math.multiplyHigh` or `BigInteger` in Java, `math/big` in Go) or arbitrary precision (Python). Verify with a 128-bit `(a*inv) % m`.

**Evaluation criteria.**
- Correct for `m` near `int64` max (no overflow).
- Returns failure when `gcd(a, m) != 1`.
- `(a * inv) % m == 1` checked with a 128-bit multiply.

---

### Task 14 — Choose the right inverse method

**Problem.** Implement `classify(a, m, is_prime)` that returns which inverse method to use: `FERMAT`, `EXTENDED_EUCLID`, `TABLE` (if asked for `1..n`), `NONE` (no inverse), and justify. Handle: prime modulus single inverse, composite modulus, non-coprime `a`, and a range request.

**Constraints / cases to handle.**
- Prime `m`, single inverse, `gcd(a,m)=1` → `FERMAT` (or `EXTENDED_EUCLID`).
- Composite `m`, `gcd(a,m)=1` → `EXTENDED_EUCLID`.
- `gcd(a, m) > 1` → `NONE`.
- Range `1..n` mod prime `p > n` → `TABLE`.

**Hint.** Check coprimality first (`NONE` if `gcd != 1`); then prime → `FERMAT`; else `EXTENDED_EUCLID`. The `TABLE` branch is for a range request, not a single inverse.

**Evaluation criteria.**
- Correctly classifies all four canonical cases.
- The `NONE` branch cites `gcd(a, m) != 1`.
- Justification references the right complexity (`O(log m)`, `O(n)`).

---

### Task 15 — Rational reconstruction

**Problem.** Given `r` and `m` with `r ≡ p/q (mod m)` for unknown coprime `p, q` bounded by `√(m/2)`, recover `p` and `q` by running extended Euclid on `(m, r)` and stopping early.

**Constraints.** `1 ≤ r < m ≤ 10^18`, `|p|, q ≤ √(m/2)`.

**Hint.** Run the iterative extended Euclid on `(m, r)`; track the remainder and the coefficient of `r`. Stop when the remainder drops below `√(m/2)`; that remainder is `±p` and the coefficient is `±q`. Verify `p ≡ r·q (mod m)`.

**Evaluation criteria.**
- Recovers `p/q` when bounds are respected.
- `p ≡ r·q (mod m)` holds.
- Returns failure when no valid bounded rational exists.

---

### Task 16 — Solve a system of two linear congruences (general moduli)

**Problem.** Solve `x ≡ r1 (mod m1)` and `x ≡ r2 (mod m2)` for **arbitrary** `m1, m2` (not necessarily coprime). Use extended Euclid: a solution exists iff `(r2 - r1)` is divisible by `g = gcd(m1, m2)`; if so the merged solution is unique modulo `lcm(m1, m2)`. Output the merged residue and modulus, or `-1` if no solution.

**Input / Output spec.**
- Read `r1 m1 r2 m2`.
- Print `r M` (merged residue `r` and modulus `M = lcm(m1, m2)`), or `-1`.

**Constraints.** `1 ≤ m1, m2 ≤ 10^9`, `0 ≤ r1 < m1`, `0 ≤ r2 < m2`. Use 128-bit / big integers for products.

**Hint.** `g, p, q = extgcd(m1, m2)`. If `(r2 - r1) % g != 0`, return `-1`. Else `lcm = m1 / g * m2`; `t = ((r2 - r1) / g) * p mod (m2 / g)`; `x = (r1 + m1 * t) mod lcm`. Verify `x % m1 == r1` and `x % m2 == r2`.

**Starter — Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func mod(a, m int64) int64 { return ((a % m) + m) % m }

// returns (r, M, ok)
func crtMerge(r1, m1, r2, m2 int64) (int64, int64, bool) {
	g, p, _ := extgcd(m1, m2)
	if (r2-r1)%g != 0 {
		return 0, 0, false
	}
	lcm := m1 / g * m2
	t := mod((r2-r1)/g*p, m2/g)
	// use big-style care for the product if m1*t can overflow; here demo only
	x := mod(r1+m1*t, lcm)
	return x, lcm, true
}

func main() {
	var r1, m1, r2, m2 int64
	fmt.Scan(&r1, &m1, &r2, &m2)
	if r, M, ok := crtMerge(r1, m1, r2, m2); ok {
		fmt.Println(r, M)
	} else {
		fmt.Println(-1)
	}
}
```

**Starter — Java.**
```java
import java.math.BigInteger;
import java.util.*;

public class Task16 {
    static BigInteger[] extgcd(BigInteger a, BigInteger b) {
        if (b.signum() == 0) return new BigInteger[]{a, BigInteger.ONE, BigInteger.ZERO};
        BigInteger[] r = extgcd(b, a.mod(b));
        return new BigInteger[]{r[0], r[2], r[1].subtract(a.divide(b).multiply(r[2]))};
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        BigInteger r1 = sc.nextBigInteger(), m1 = sc.nextBigInteger();
        BigInteger r2 = sc.nextBigInteger(), m2 = sc.nextBigInteger();
        BigInteger[] e = extgcd(m1, m2);
        BigInteger g = e[0], p = e[1];
        BigInteger diff = r2.subtract(r1);
        if (!diff.mod(g).equals(BigInteger.ZERO)) { System.out.println(-1); return; }
        BigInteger lcm = m1.divide(g).multiply(m2);
        BigInteger m2g = m2.divide(g);
        BigInteger t = diff.divide(g).multiply(p).mod(m2g);
        BigInteger x = r1.add(m1.multiply(t)).mod(lcm);
        System.out.println(x + " " + lcm);
    }
}
```

**Starter — Python.**
```python
import sys


def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def crt_merge(r1, m1, r2, m2):
    g, p, _ = extgcd(m1, m2)
    if (r2 - r1) % g != 0:
        return None
    lcm = m1 // g * m2
    t = ((r2 - r1) // g * p) % (m2 // g)
    return (r1 + m1 * t) % lcm, lcm


def main():
    r1, m1, r2, m2 = map(int, sys.stdin.read().split())
    res = crt_merge(r1, m1, r2, m2)
    if res is None:
        print(-1)
    else:
        x, M = res
        assert x % m1 == r1 and x % m2 == r2
        print(x, M)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns `-1` exactly when `gcd(m1, m2) ∤ (r2 - r1)`.
- When solvable, `x % m1 == r1` and `x % m2 == r2`, and `M == lcm(m1, m2)`.
- Reduces to the coprime CRT of Task 10 when `gcd(m1, m2) = 1`.

---

## Benchmark Task

### Task B — O(n) table vs n separate inversions

**Problem.** Empirically compare computing all inverses `1..n` mod a prime two ways:

- **(a) O(n) table:** the recurrence `inv[i] = -(p/i)·inv[p%i] % p`.
- **(b) n Fermat calls:** `pow(i, p-2, p)` for each `i`.

Measure wall-clock time for `n ∈ {10^3, 10^4, 10^5, 10^6}` with `p = 998244353`. Report a table and the speedup ratio.

**Starter — Python.**
```python
import time


def inverse_table(n, p):
    inv = [0] * (n + 1)
    inv[1] = 1
    for i in range(2, n + 1):
        inv[i] = (-(p // i) * inv[p % i]) % p
    return inv


def fermat_all(n, p):
    return [pow(i, p - 2, p) for i in range(1, n + 1)]


def bench(n, p):
    t0 = time.perf_counter()
    inverse_table(n, p)
    t_table = time.perf_counter() - t0
    t0 = time.perf_counter()
    fermat_all(n, p)
    t_fermat = time.perf_counter() - t0
    return t_table, t_fermat


def main():
    p = 998244353
    print("n         table_ms     fermat_ms    speedup")
    for n in [1000, 10000, 100000, 1000000]:
        tt, tf = bench(n, p)
        print(f"{n:<9d} {tt*1000:<12.2f} {tf*1000:<12.2f} {tf/tt:.1f}x")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same prime produces the same inverse table across Go, Java, and Python.
- The table (a) is `O(n)`; the Fermat loop (b) is `O(n log p)`; the table is faster, with the gap widening as `n` grows.
- Both methods produce identical inverse arrays (assert entrywise).
- Report the measured speedup and compare to the theoretical `~log p` factor.

---

## General Guidance for All Tasks

- **Always verify an inverse with `(a * inv) % m == 1`.** It is the cheapest, most reliable check and catches sign, overflow, and wrong-method bugs.
- **Check existence before trusting an inverse.** The inverse exists iff `gcd(a, m) = 1`; return a typed failure (`-1`/`None`/`error`), never an in-band sentinel that could be a valid residue.
- **Normalize the sign.** The raw Bezout `x` is often negative; map it into `[0, m)` with `((x % m) + m) % m` (a single `% m` may stay negative in Go/Java).
- **Mind overflow.** For `m` beyond `~2^31`, the `q*s` and `a*inv` products overflow 64-bit; use 128-bit intermediates or big integers.
- **Fermat only for prime moduli.** `a^(m-2)` is the inverse only when `m` is prime; composite moduli (like RSA's `φ`) need extended Euclid.
- **Distinguish "no inverse" from "no solution".** `a·x ≡ b (mod m)` can have solutions even when `a⁻¹` does not exist, as long as `gcd(a, m) | b`.
- **Reuse the `extgcd`/`modInverse` pair.** Most bugs live in the coefficient update; write it once, test it hard, build the rest on top.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.

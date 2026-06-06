# Tonelli-Shanks — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the criterion / square-root / lifting logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs before trusting the fast version** — enumerate `x = 0..p−1` and check `x² ≡ n (mod p)`, and always re-square every returned root.

---

## Beginner Tasks (5)

### Task 1 — Euler's criterion / Legendre symbol

**Problem.** Implement `legendre(n, p)` returning `+1` if `n` is a quadratic residue mod the odd prime `p`, `−1` if a non-residue, `0` if `p | n`. Use Euler's criterion `n^((p-1)/2) mod p`.

**Input / Output spec.**
- Read `p`, then `n`.
- Print `1`, `-1`, or `0`.

**Constraints.** `3 ≤ p ≤ 10^{12}` (odd prime), any integer `n`. Use 64-bit modular exponentiation.

**Hint.** The exponentiation returns either `1` or `p − 1` (= `−1`) for `n ≢ 0`. Map `p − 1` back to `−1`.

**Starter — Go.**
```go
package main

import "fmt"

func power(a, e, mod int64) int64 {
	a %= mod
	if a < 0 {
		a += mod
	}
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func legendre(n, p int64) int64 {
	// TODO: handle p|n, then Euler's criterion, map p-1 to -1
	return 0
}

func main() {
	var p, n int64
	fmt.Scan(&p, &n)
	fmt.Println(legendre(n, p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long power(long a, long e, long mod) {
        a %= mod; if (a < 0) a += mod;
        long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % mod; a = a * a % mod; e >>= 1; }
        return r;
    }

    static long legendre(long n, long p) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long p = sc.nextLong(), n = sc.nextLong();
        System.out.println(legendre(n, p));
    }
}
```

**Starter — Python.**
```python
def legendre(n, p):
    # TODO: handle p|n, then Euler's criterion
    return 0


if __name__ == "__main__":
    p = int(input())
    n = int(input())
    print(legendre(n, p))
```

- **Evaluation:** correct `±1/0` for all inputs; matches brute-force QR test on small `p`.

---

### Task 2 — The `p ≡ 3 (mod 4)` shortcut

**Problem.** Implement `sqrt_3mod4(n, p)` returning one square root of `n` via `n^((p+1)/4)`, assuming `p ≡ 3 (mod 4)` and `n` is a QR. Return `None`/`-1` if `n` is a non-residue.

**Constraints.** `p ≡ 3 (mod 4)`, prime, `≤ 10^{12}`. Check the criterion first.

**Hint.** Verify `legendre(n, p) == 1` before applying the formula. The other root is `p − x`.

**Spec — all languages.** Read `p`, `n`; print the smaller of the two roots, or `-1` if none. Provide starter code mirroring Task 1's structure in Go, Java, and Python.

- **Evaluation:** root squares back to `n`; returns failure for non-residues; rejects `p ≢ 3 (mod 4)` (assert or document).

---

### Task 3 — Decompose `p − 1 = Q · 2^S`

**Problem.** Implement `decompose(p)` returning `(Q, S)` with `Q` odd and `p − 1 = Q · 2^S`.

**Constraints.** `2 ≤ p ≤ 10^{18}`.

**Hint.** Repeatedly divide `p − 1` by `2`, counting the divisions, until the quotient is odd.

**Spec — all languages.** Read `p`; print `Q S`. Provide starter code in Go, Java, and Python.

- **Evaluation:** `Q` odd, `Q * 2^S == p − 1`; correct for `p = 2` (`Q = 1, S = 0`), `p ≡ 3 (mod 4)` (`S = 1`), and high-`S` primes like `998244353` (`S = 23`).

---

### Task 4 — Find a quadratic non-residue

**Problem.** Implement `find_nonresidue(p)` returning the smallest `z ≥ 2` with `legendre(z, p) == -1`.

**Constraints.** Odd prime `p ≤ 10^{12}`.

**Hint.** Iterate `z = 2, 3, 4, …`; the answer is almost always a tiny single-digit number (half of all residues are non-residues).

**Spec — all languages.** Read `p`; print `z`. Reuse `legendre` from Task 1. Provide starter code in Go, Java, and Python.

- **Evaluation:** `legendre(z, p) == -1`; `z` is the *smallest* such; terminates quickly for all test primes.

---

### Task 5 — Both roots and verification wrapper

**Problem.** Implement `both_roots(x, p)` that, given one root `x` (or a "none" sentinel), returns the sorted set `{x, p − x}` (or empty). Add a `verify(x, n, p)` returning whether `x² ≡ n (mod p)`.

**Constraints.** `p` odd prime `≤ 10^9`.

**Hint.** When `x == p − x` (only possible if `x == 0`), return a single element.

**Spec — all languages.** Provide starter code with both helpers in Go, Java, and Python. Demonstrate on `(x=6, p=13)` → `[6, 7]`.

- **Evaluation:** correct pair; deduplicates the `x == 0` case; `verify` catches a deliberately corrupted root.

---

## Intermediate Tasks (5)

### Task 6 — Full Tonelli-Shanks

**Problem.** Implement `tonelli(n, p)` returning one square root of a QR `n` mod any odd prime `p`, or a "none" sentinel for a non-residue. Fold in the `p ≡ 3 (mod 4)` shortcut and the full loop for `p ≡ 1 (mod 4)`.

**Constraints.** `3 ≤ p ≤ 10^9` (products fit 64-bit), `0 ≤ n < p`.

**Hint.** Initialize `M=S, c=z^Q, t=n^Q, R=n^((Q+1)/2)`. Loop while `t ≠ 1`: find least `i` with `t^(2^i)=1`, set `b=c^(2^(M-i-1))`, update `R,c,t,M`.

**Spec — all languages.** Read `p`, `n`; print one root or `-1`. Provide starter code (skeleton with the loop stubbed) in Go, Java, and Python.

- **Evaluation:** matches brute force on all small `p`; correct for high-`S` primes (`17, 41, 97, 998244353`); re-squares to `n`; returns failure for non-residues.

---

### Task 7 — Closed form for `p ≡ 5 (mod 8)`

**Problem.** Implement `sqrt_5mod8(n, p)` using the Atkin closed form: let `t = n^((p-1)/4)`; if `t == 1` return `n^((p+3)/8)`, else return `n^((p+3)/8) · 2^((p-1)/4) mod p`. Assume `p ≡ 5 (mod 8)` and `n` a QR.

**Constraints.** `p ≡ 5 (mod 8)`, prime, `≤ 10^9`.

**Hint.** `(p+3)/8` is an integer for `p ≡ 5 (mod 8)`. `2` is a non-residue for such `p`, so `2^((p-1)/4)` is a square root of `−1`.

**Spec — all languages.** Provide starter code in Go, Java, and Python. Test against your Task 6 Tonelli-Shanks on primes `5, 13, 29, 37`.

- **Evaluation:** agrees with Tonelli-Shanks (up to the `x` vs `p − x` choice) on all `p ≡ 5 (mod 8)` primes; root squares back to `n`.

---

### Task 8 — Square root mod a prime power (Hensel lift)

**Problem.** Implement `sqrt_prime_power(n, p, k)` returning one root of `x² ≡ n (mod p^k)` for odd prime `p`, `p ∤ n`. Base root via Tonelli-Shanks, then Newton/Hensel lift.

**Constraints.** Odd `p`, `p^k ≤ 10^{18}`, `p ∤ n`.

**Hint.** Lift via `x ← x − (x² − n)·(2x)^{-1} (mod p^{j+1})`, increasing the modulus by a factor of `p` (or doubling precision Newton-style) until you reach `p^k`.

**Spec — all languages.** Read `p`, `k`, `n`; print one root mod `p^k`. Provide starter code in Go, Java, and Python (you need a modular inverse via extended Euclid).

- **Evaluation:** `x² ≡ n (mod p^k)`; correct for `(p,k)=(3,4)`, `(5,3)`, `(7,2)`; other root is `p^k − x`.

---

### Task 9 — Square root mod a composite (factor + CRT)

**Problem.** Implement `sqrt_composite(n, factors)` where `factors` is a list of `(prime, exponent)`. Return *all* roots of `x² ≡ n (mod m)`, sorted.

**Constraints.** Distinct odd primes; product `≤ 10^{18}`.

**Hint.** Root each prime power (Task 8), take the Cartesian product of per-factor root sets, CRT-combine each tuple. The count is the product of per-factor counts.

**Spec — all languages.** Provide starter code in Go, Java, and Python (reuse Task 8 + a CRT combiner). Test `n=4, factors=[(5,1),(7,1)]` → `[2, 12, 23, 33]`.

- **Evaluation:** every root squares to `n mod m`; count equals `2^r` (or `0`); matches brute force for small `m`.

---

### Task 10 — Quadratic residue counter and PRG

**Problem.** (a) Implement `count_qr(p)` returning the number of nonzero quadratic residues mod `p` (should be `(p−1)/2`). (b) Implement a QR-based stream: from a seed `s`, emit `legendre(s + i, p)` for `i = 0, 1, 2, …` as a pseudo-random `±1` sequence.

**Constraints.** Odd prime `p ≤ 10^9`.

**Hint.** Part (a) is just `(p−1)/2`, but verify by enumerating squares for small `p`. Part (b) reuses `legendre`.

**Spec — all languages.** Provide starter code in Go, Java, and Python. Print the count and the first 10 stream values for `p = 13, s = 1`.

- **Evaluation:** `count_qr(p) == (p−1)/2` and matches brute enumeration for small `p`; stream values are all in `{−1, +1}` (skipping `0`).

---

## Advanced Tasks (5)

### Task 11 — Cipolla's algorithm

**Problem.** Implement `cipolla(n, p)` computing a square root via arithmetic in `F_{p²}`. Find `a` with `a² − n` a non-residue, set `w = a² − n`, and compute `(a + ω)^((p+1)/2)` where `ω² = w`; return its `F_p` component.

**Constraints.** Odd prime `p ≤ 10^9`; products overflow-safe.

**Hint.** Represent `F_{p²}` elements as pairs `(u, v)` meaning `u + v·ω`, with multiplication `(u1+v1ω)(u2+v2ω) = (u1u2 + v1v2·w) + (u1v2 + u2v1)ω`. Exponentiate by squaring on pairs. The result's `v`-component is provably `0`.

**Spec — all languages.** Provide starter code in Go, Java, and Python. Test against Tonelli-Shanks (Task 6) on primes with large `S` like `998244353`.

- **Evaluation:** agrees with Tonelli-Shanks; the imaginary component is `0`; cost does not grow with `S` (note timing on a high-`S` prime).

---

### Task 12 — Algorithm selector by `S`

**Problem.** Implement `sqrt_best(n, p)` that dispatches: `p ≡ 3 (mod 4)` → `n^((p+1)/4)`; `p ≡ 5 (mod 8)` → Task 7 closed form; small `S` → Tonelli-Shanks; large `S` (say `S > 12`) → Cipolla.

**Constraints.** Odd prime `p ≤ 10^9`.

**Hint.** Compute `S = v₂(p−1)` once and branch. All branches must return a root that squares back to `n`.

**Spec — all languages.** Provide starter code in Go, Java, and Python that wires together Tasks 2, 6, 7, 11.

- **Evaluation:** every branch produces a correct root; the chosen branch matches the `(p mod 8, S)` policy; verified on a spread of primes.

---

### Task 13 — Elliptic-curve point decompression

**Problem.** Given curve parameters `(a, b, p)` (curve `y² = x³ + ax + b`), an `x`-coordinate, and a desired parity bit for `y`, recover the full point or report that `x` is not on the curve.

**Constraints.** Odd prime `p ≤ 10^9`; `p ≡ 3 (mod 4)` preferred for the fast root.

**Hint.** Compute `rhs = (x³ + ax + b) mod p`; take `y = sqrt(rhs)`. If `rhs` is a non-residue, `x` is off-curve. Adjust `y` to match the parity bit (`y` or `p − y`).

**Spec — all languages.** Provide starter code in Go, Java, and Python. Test on `secp256k1`-style small parameters and confirm both `(x, y)` and `(x, p − y)` satisfy the curve equation.

- **Evaluation:** recovered point satisfies `y² ≡ x³ + ax + b`; parity bit honored; off-curve `x` rejected.

---

### Task 14 — Constant-time concern audit

**Problem.** Take your Task 6 Tonelli-Shanks and your Task 2 `n^((p+1)/4)` shortcut. Empirically demonstrate that the Tonelli-Shanks loop's *iteration count* depends on the input `n` (not constant-time), while the shortcut's exponentiation count does not. Output the round count per input.

**Constraints.** A `p ≡ 1 (mod 4)` prime with moderate `S` (e.g. `p = 41`, `S = 3`).

**Hint.** Instrument the loop with a counter; run over all QRs `n` and print the distribution of round counts. The variance is the side-channel signal.

**Spec — all languages.** Provide instrumented code in Go, Java, and Python that prints `(n, rounds)` for each QR.

- **Evaluation:** clearly shows variable round counts for Tonelli-Shanks (a timing leak) vs a fixed cost for the shortcut; a short written note on why curve primes are chosen `≡ 3 (mod 4)`.

---

### Task 15 — Factoring via two square roots (Rabin link)

**Problem.** Given a composite `m = p·q` (distinct odd primes) and a value `n` that is a QR mod both, compute all four roots of `x² ≡ n (mod m)` (Task 9), then use two roots `x, y` with `x ≢ ±y` to recover a factor of `m` via `gcd(x − y, m)`.

**Constraints.** `m = p·q ≤ 10^{18}`.

**Hint.** Among the four roots, pick a pair that are not negatives of each other; `gcd(x − y, m)` is then `p` or `q`. This is the Rabin / factoring equivalence.

**Spec — all languages.** Provide starter code in Go, Java, and Python (reuse Task 9 + a `gcd`). Demonstrate recovering a factor of `m = 35` from roots of `x² ≡ 4`.

- **Evaluation:** correctly extracts a nontrivial factor; explains in a comment why this shows composite square roots are as hard as factoring.

---

## Benchmark Task

> Compare performance of Tonelli-Shanks vs Cipolla across the three languages, on both a small-`S` and a large-`S` prime.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	primes := []int64{1000000007, 998244353} // S=1 (≡3 mod4), S=23
	for _, p := range primes {
		start := time.Now()
		for i := 0; i < 100000; i++ {
			_ = yourSqrt(int64(i%1000+2), p) // replace with tonelli/cipolla
		}
		fmt.Printf("p=%d: %.3f ms / 100k\n", p, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        long[] primes = {1000000007L, 998244353L};
        for (long p : primes) {
            long start = System.nanoTime();
            for (int i = 0; i < 100000; i++) {
                yourSqrt(i % 1000 + 2, p); // replace with tonelli/cipolla
            }
            long elapsed = System.nanoTime() - start;
            System.out.printf("p=%d: %.3f ms / 100k%n", p, elapsed / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import timeit

for p in [1000000007, 998244353]:  # S=1, S=23
    t = timeit.timeit(lambda: [your_sqrt(i % 1000 + 2, p) for i in range(1000)], number=100)
    print(f"p={p}: {t/100*1000:.3f} ms / 100k")
```

- **Goal:** show that on the small-`S` prime Tonelli-Shanks is competitive, but on `998244353` (`S = 23`) Cipolla's `S`-independent cost pulls ahead. Report the crossover and explain it via the `O(S² log p)` vs `O(log p)` analysis.

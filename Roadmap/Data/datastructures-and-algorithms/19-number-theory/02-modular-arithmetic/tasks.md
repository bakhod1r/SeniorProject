# Modular Arithmetic — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the modular logic and validate against the evaluation criteria.
> **Always verify against a big-integer / exact oracle on small inputs before trusting the modular version — modular bugs are silent.**

---

## Beginner Tasks (5)

### Task 1 — Safe modular add, subtract, multiply

**Problem.** Implement `addMod`, `subMod`, `mulMod` for a modulus `m`. `subMod` must return a value in `[0, m)` even when `a < b` (the negative-mod fix). Assume `m ≤ 10^9` so a 64-bit product is safe.

**Input / Output spec.**
- Read `m`, then three queries each `op a b` where `op ∈ {+, -, *}`.
- Print the result of each operation in `[0, m)`.

**Constraints.** `1 ≤ m ≤ 10^9`, `0 ≤ a, b < m`.

**Hint.** `subMod = ((a - b) % m + m) % m`. For `*`, the product fits in 64-bit since `m² < 10^18 < 2^63`.

**Starter — Go.**
```go
package main

import "fmt"

func addMod(a, b, m int64) int64 { /* TODO */ return 0 }
func subMod(a, b, m int64) int64 { /* TODO: negative-safe */ return 0 }
func mulMod(a, b, m int64) int64 { /* TODO */ return 0 }

func main() {
	var m int64
	fmt.Scan(&m)
	for i := 0; i < 3; i++ {
		var op string
		var a, b int64
		fmt.Scan(&op, &a, &b)
		switch op {
		case "+":
			fmt.Println(addMod(a, b, m))
		case "-":
			fmt.Println(subMod(a, b, m))
		case "*":
			fmt.Println(mulMod(a, b, m))
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long addMod(long a, long b, long m) { /* TODO */ return 0; }
    static long subMod(long a, long b, long m) { /* TODO */ return 0; }
    static long mulMod(long a, long b, long m) { /* TODO */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long m = sc.nextLong();
        for (int i = 0; i < 3; i++) {
            String op = sc.next();
            long a = sc.nextLong(), b = sc.nextLong();
            if (op.equals("+")) System.out.println(addMod(a, b, m));
            else if (op.equals("-")) System.out.println(subMod(a, b, m));
            else System.out.println(mulMod(a, b, m));
        }
    }
}
```

**Starter — Python.**
```python
import sys


def add_mod(a, b, m):  # TODO
    return 0


def sub_mod(a, b, m):  # TODO: negative-safe
    return 0


def mul_mod(a, b, m):  # TODO
    return 0


def main():
    data = sys.stdin.read().split()
    it = iter(data)
    m = int(next(it))
    for _ in range(3):
        op, a, b = next(it), int(next(it)), int(next(it))
        if op == "+":
            print(add_mod(a, b, m))
        elif op == "-":
            print(sub_mod(a, b, m))
        else:
            print(mul_mod(a, b, m))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `subMod(2, 5, 7)` returns `4` (not `−3`).
- All results in `[0, m)`.
- No overflow for `m` up to `10^9`.

---

### Task 2 — Modular exponentiation

**Problem.** Implement `powMod(a, b, m)` returning `a^b mod m` via binary exponentiation. Handle `b = 0` (returns `1 mod m`) and large `b` (up to `10^18`).

**Input / Output spec.**
- Read `a`, `b`, `m`. Print `a^b mod m`.

**Constraints.** `0 ≤ a < m`, `0 ≤ b ≤ 10^18`, `1 ≤ m ≤ 10^9`.

**Hint.** Square-and-multiply; reduce after every multiply. Reference oracle below.

**Reference oracle (Python) — validate against this.**
```python
def brute_pow(a, b, m):
    r = 1
    for _ in range(b):  # only for small b
        r = r * a % m
    return r
# brute_pow(3, 13, 7) == 3
```

**Evaluation criteria.**
- `powMod(3, 13, 7) == 3`, `powMod(2, 0, 5) == 1`.
- `O(log b)`; instant for `b = 10^18`.
- Matches `brute_pow` for small `b`.

---

### Task 3 — Modular inverse via Fermat (prime modulus)

**Problem.** Given a prime `p` and a value `a` with `1 ≤ a < p`, compute `a⁻¹ mod p` using Fermat's little theorem (`a^(p−2)`). Verify `a · a⁻¹ ≡ 1 (mod p)`.

**Input / Output spec.**
- Read `p`, `a`. Print `a⁻¹ mod p`.

**Constraints.** `p` prime, `2 ≤ p ≤ 10^9 + 7`, `1 ≤ a < p`.

**Hint.** Reuse `powMod` from Task 2: `inv = powMod(a, p−2, p)`.

**Worked check.** For `p = 11`, `a = 3`: `inv = 3^9 mod 11 = 4`, and `3·4 = 12 ≡ 1 (mod 11)`.

**Evaluation criteria.**
- `inv(3, 11) == 4`, `inv(2, 1_000_000_007) == 500_000_004`.
- Asserts `a · inv ≡ 1 (mod p)`.
- `O(log p)`.

---

### Task 4 — Modular division

**Problem.** Compute `(a / b) mod p` for a prime `p`, defined as `a · b⁻¹ mod p`. Return `-1` if `b ≡ 0 (mod p)` (no inverse).

**Input / Output spec.**
- Read `p`, `a`, `b`. Print `(a / b) mod p`, or `-1` if undefined.

**Constraints.** `p` prime, `2 ≤ p ≤ 10^9 + 7`, `0 ≤ a, b < p`.

**Hint.** `b⁻¹ = powMod(b, p−2, p)`; guard `b % p == 0`.

**Worked check.** `(10 / 2) mod (10^9+7) = 10 · inv(2) mod p = 5`.

**Evaluation criteria.**
- `div(p, 10, 2) == 5`.
- Returns `-1` when `b ≡ 0`.
- Result equals exact integer division when it divides evenly (small-case check).

---

### Task 5 — Sum of a geometric series mod p

**Problem.** Compute `S = (1 + a + a² + … + a^(n−1)) mod p` for prime `p`, using either the closed form `(a^n − 1) · (a − 1)⁻¹` (when `a ≢ 1`) or `S = n mod p` (when `a ≡ 1`).

**Input / Output spec.**
- Read `p`, `a`, `n`. Print `S mod p`.

**Constraints.** `p` prime, `0 ≤ a < p`, `1 ≤ n ≤ 10^18`.

**Hint.** Handle `a ≡ 1 (mod p)` separately (the inverse of `a − 1 = 0` does not exist). Otherwise `S = (powMod(a, n, p) − 1) · inv(a − 1) mod p`, with the negative fix on `powMod(a,n,p) − 1`.

**Evaluation criteria.**
- `a = 2, n = 4, p large → 15` (`1+2+4+8`).
- `a = 1, n = 5, p large → 5`.
- `O(log n)`; matches a brute sum for small `n`.

---

## Intermediate Tasks (5)

### Task 6 — Overflow-safe mulmod for large modulus

**Problem.** Implement `mulMod(a, b, m)` correct for `m` up to `2^62`, where `a*b` overflows 64-bit. Use `__int128` (if available), `bits.Mul64` (Go), `Math.multiplyHigh` (Java), or a Russian-peasant loop.

**Input / Output spec.**
- Read `m`, then pairs `a b`. Print `(a·b) mod m` for each.

**Constraints.** `1 ≤ m < 2^62`, `0 ≤ a, b < m`.

**Hint.** Russian-peasant: `r = 0`; while `b > 0`: if `b` odd `r = (r+a)%m`; `a = (a+a)%m`; `b >>= 1`. Each sum `< 2m < 2^63`, safe.

**Reference oracle (Python).**
```python
def mulmod_oracle(a, b, m):
    return (a * b) % m  # Python ints are exact; use as ground truth
```

**Evaluation criteria.**
- Matches `mulmod_oracle` for `m` near `10^18`.
- No overflow (test `a = b = m − 1`).
- `O(log b)` for the Russian-peasant version.

---

### Task 7 — Modular inverse via extended Euclid (any coprime modulus)

**Problem.** Implement `inverse(a, m)` for **any** modulus `m` (prime or composite) using the extended Euclidean algorithm. Return the inverse in `[0, m)`, or report "no inverse" when `gcd(a, m) ≠ 1`.

**Input / Output spec.**
- Read `m`, `a`. Print `a⁻¹ mod m`, or `-1` if no inverse exists.

**Constraints.** `2 ≤ m ≤ 10^18`, `0 ≤ a < m`.

**Hint.** `extgcd(a, m)` returns `(g, x, y)` with `ax + my = g`. If `g = 1`, the inverse is `((x % m) + m) % m`; else there is none.

**Reference oracle (Python).**
```python
def inv_oracle(a, m):
    from math import gcd
    if gcd(a, m) != 1:
        return -1
    return pow(a, -1, m)  # Python 3.8+ built-in modular inverse
```

**Evaluation criteria.**
- `inverse(3, 26) == 9`; `inverse(2, 4) == -1` (no inverse).
- Matches `inv_oracle` over random `(a, m)`.
- Works for composite `m`.

---

### Task 8 — Binomial coefficients nCr mod p with precompute

**Problem.** Precompute factorials and inverse factorials up to `N` mod a prime `p`, then answer `Q` queries `(n, r)` in `O(1)` each. Use exactly **one** modular inverse for the whole inverse-factorial table.

**Input / Output spec.**
- Read `N`, `Q`, then `Q` pairs `(n, r)`. Print `C(n, r) mod p` for each.

**Constraints.** `0 ≤ r ≤ n ≤ N ≤ 10^6`, `Q ≤ 10^5`, `p = 10^9 + 7`.

**Hint.** `invfact[N] = powMod(fact[N], p−2, p)`, then `invfact[i] = invfact[i+1]·(i+1)`. Query: `fact[n]·invfact[r]·invfact[n−r]`.

**Reference oracle (Python).**
```python
from math import comb
def ncr_oracle(n, r, p):
    return comb(n, r) % p   # exact big-int binomial, reduced
```

**Evaluation criteria.**
- `C(10, 3) == 120`, `C(1000000, 500000)` answered instantly.
- Exactly one inverse computed (not `N`).
- Matches `ncr_oracle` for small `(n, r)`.

---

### Task 9 — Linear inverses of 1..n mod p in O(n)

**Problem.** Compute `inv[i] = i⁻¹ mod p` for all `i` in `1..n` using the recurrence `inv[i] = (p − (p/i) · inv[p mod i]) mod p`, in `O(n)` total — without calling `powMod` per element.

**Input / Output spec.**
- Read `p`, `n`. Print `inv[1], …, inv[n]` space-separated.

**Constraints.** `p` prime, `1 ≤ n < p ≤ 10^9 + 7`.

**Hint.** Base case `inv[1] = 1`. The recurrence comes from `p = (p/i)·i + (p mod i)`, reduced mod `p` and multiplied by `inv[i]·inv[p mod i]`.

**Reference oracle (Python).**
```python
def inv_oracle_list(p, n):
    return [pow(i, p - 2, p) for i in range(1, n + 1)]
```

**Evaluation criteria.**
- `inv[i]·i ≡ 1 (mod p)` for all `i`.
- Matches `inv_oracle_list`.
- `O(n)` total (no per-element modpow).

---

### Task 10 — Solve a linear congruence a·x ≡ b (mod m)

**Problem.** Solve `a·x ≡ b (mod m)` for `x`. Let `g = gcd(a, m)`. A solution exists iff `g | b`; then there are exactly `g` solutions in `[0, m)`. Print the number of solutions and the smallest one, or `-1` if none.

**Input / Output spec.**
- Read `a`, `b`, `m`. Print `count smallest_x`, or `-1`.

**Constraints.** `1 ≤ a, m ≤ 10^9`, `0 ≤ b < m`.

**Hint.** With `g = gcd(a, m)`: if `b % g != 0`, no solution. Else divide through by `g`: `(a/g)·x ≡ (b/g) (mod m/g)`, invert `a/g` mod `m/g`, get one solution, then add multiples of `m/g`.

**Reference oracle (Python).**
```python
def cong_oracle(a, b, m):
    return sorted(x for x in range(m) if a * x % m == b)
```

**Evaluation criteria.**
- `2x ≡ 4 (mod 6)` → 2 solutions, smallest `2` (also `5`).
- `2x ≡ 3 (mod 6)` → `-1` (no solution).
- Matches `cong_oracle` for small `m`.

---

## Advanced Tasks (5)

### Task 11 — Exact count via two-prime CRT

**Problem.** A computation yields a value `V` known only by `V mod p₁` and `V mod p₂` (coprime primes). Reconstruct `V mod (p₁·p₂)` via CRT. Given the guarantee `V < p₁·p₂`, this is the exact `V`.

**Input / Output spec.**
- Read `p1`, `r1`, `p2`, `r2`. Print the reconstructed `V`.

**Constraints.** `p1, p2` coprime, each `≤ 10^9 + 7`; `0 ≤ r1 < p1`, `0 ≤ r2 < p2`.

**Hint.** `t = (r2 − r1) · inv(p1, p2) mod p2`; `V = r1 + p1·t`, in `[0, p1·p2)`. Use a safe `mulmod` since `p1·t` can reach ~`10^18`.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t
```

**Evaluation criteria.**
- `crt2(2, 3, 3, 5) == 8` (`8 ≡ 2 mod 3`, `8 ≡ 3 mod 5`).
- Reconstructs known `V < p1·p2` exactly.
- Both residues match `V mod pᵢ`.

---

### Task 12 — Modular factorial with the prime stripped (Legendre / nCr for composite via prime powers)

**Problem.** For a prime `p`, compute `n! mod p^e` is hard; as a stepping stone, compute the exponent of `p` in `n!` using **Legendre's formula** `Σ floor(n / p^i)`, and the `p`-free part of `n! mod p`. Output both. This is the core of `nCr mod p` correctness checks (when `r!` shares factor `p`).

**Input / Output spec.**
- Read `n`, `p`. Print `v_p(n!)` (the exponent of `p` in `n!`) and `n! / p^{v} mod p`.

**Constraints.** `0 ≤ n ≤ 10^18`, `p` prime, `p ≤ 10^9`.

**Hint.** Legendre: `v = Σ_{i≥1} floor(n / p^i)` (stops when `p^i > n`). For the `p`-free part mod `p`, use Wilson-based block products (advanced; a brute multiply suffices for the small-`n` check).

**Reference oracle (Python).**
```python
def legendre(n, p):
    v, pk = 0, p
    while pk <= n:
        v += n // pk
        pk *= p
    return v
# legendre(10, 2) == 8  (exponent of 2 in 10!)
```

**Evaluation criteria.**
- `v_2(10!) == 8`, `v_5(100!) == 24`.
- Matches `legendre`.
- Handles `n = 0` (`v = 0`, part `= 1`).

---

### Task 13 — Montgomery-style fast modpow (concept)

**Problem.** Implement a modular exponentiation that avoids the hardware `%` in its inner multiply by using a Russian-peasant `mulmod` (as a stand-in for Montgomery), and benchmark it against the plain `(a*b)%m` version for a fixed large modulus over many calls.

**Input / Output spec.**
- Read `m`, `base`, `exp`, and a repeat count `T`. Print `base^exp mod m` and (optionally) timing.

**Constraints.** `m < 2^62`, `0 ≤ base < m`, `0 ≤ exp ≤ 10^18`, `T ≤ 10^5`.

**Hint.** Compose `powMod` from your overflow-safe `mulMod` (Task 6). The point is correctness for large `m` plus an awareness that Montgomery/Barrett (sibling `14`) replace `%` with cheaper ops in hot loops.

**Evaluation criteria.**
- Correct `base^exp mod m` for `m` near `10^18`.
- Inner loop uses overflow-safe `mulmod` (no raw `(a*b)%m` for large `m`).
- Brief writeup on where Montgomery/Barrett would help (fixed modulus, many reductions).

---

### Task 14 — Detect non-invertible elements for a composite modulus

**Problem.** Given a composite modulus `m`, list which residues in `[1, m)` are **units** (invertible) and which are **zero divisors** (share a factor with `m`). Output `φ(m)` (the count of units) and confirm it via Euler's product formula.

**Input / Output spec.**
- Read `m`. Print `φ(m)`, then the sorted list of non-invertible nonzero residues.

**Constraints.** `2 ≤ m ≤ 10^6`.

**Hint.** A residue `a` is a unit iff `gcd(a, m) = 1`. `φ(m) = m · ∏_{p|m}(1 − 1/p)`. Cross-check the count of units against this formula.

**Reference oracle (Python).**
```python
from math import gcd
def units_and_phi(m):
    units = [a for a in range(1, m) if gcd(a, m) == 1]
    return len(units), [a for a in range(1, m) if gcd(a, m) != 1]
```

**Evaluation criteria.**
- For `m = 12`: `φ = 4`, non-invertible nonzero residues `{2,3,4,6,8,9,10}`.
- `φ(m)` matches Euler's product formula.
- Matches `units_and_phi`.

---

### Task 15 — Classify the right inverse method

**Problem.** Given `(a, m, m_is_prime_known)`, return which inverse method to use: `FERMAT` (prime `m`), `EXT_EUCLID` (composite or unknown, coprime `a`), `NONE` (`gcd(a, m) ≠ 1`), or `BATCH` (caller needs inverses of `1..n` mod prime — use the linear recurrence). Justify each.

**Constraints / cases to handle.**
- `m` known prime, single inverse → `FERMAT`.
- `m` composite (or primality unknown), `gcd(a, m) = 1` → `EXT_EUCLID`.
- `gcd(a, m) ≠ 1` → `NONE` (no inverse exists).
- Need all of `1..n` mod prime → `BATCH` (`O(n)` recurrence, sibling Task 9).

**Hint.** Encode the decision rules from `middle.md`. The trap is using Fermat on a composite modulus, or trying to invert a non-unit.

**Evaluation criteria.**
- Correctly classifies all four canonical cases.
- The `NONE` branch cites `gcd(a, m) ≠ 1`.
- Justification references complexity (`O(log m)` Fermat/Euclid, `O(n)` batch).

---

## Benchmark Task

### Task B — Per-query inverse vs precomputed inverse-factorial table

**Problem.** Empirically compare two ways to answer `Q` binomial-coefficient queries `C(n, r) mod p`:

- **(a) Naive:** compute each `C(n, r)` by multiplying `fact[n]·inv(r!)·inv((n−r)!)` where each inverse is a fresh `powMod` — `O(log p)` per query.
- **(b) Precomputed:** build `fact` and `invfact` once in `O(N)` (single inverse), then `O(1)` per query.

Measure wall-clock time for `N = 10^6`, `Q ∈ {10^3, 10^4, 10^5}`. Report a table and the crossover where the precompute pays off.

**Starter — Python.**
```python
import time, random

MOD = 1_000_000_007
N = 1_000_000

fact = [1] * (N + 1)
for i in range(1, N + 1):
    fact[i] = fact[i - 1] * i % MOD
invfact = [1] * (N + 1)
invfact[N] = pow(fact[N], MOD - 2, MOD)
for i in range(N - 1, -1, -1):
    invfact[i] = invfact[i + 1] * (i + 1) % MOD


def ncr_fast(n, r):
    if r < 0 or r > n:
        return 0
    return fact[n] * invfact[r] % MOD * invfact[n - r] % MOD


def ncr_naive(n, r):
    if r < 0 or r > n:
        return 0
    inv_r = pow(fact[r], MOD - 2, MOD)
    inv_nr = pow(fact[n - r], MOD - 2, MOD)
    return fact[n] * inv_r % MOD * inv_nr % MOD


def main():
    rng = random.Random(42)
    for Q in [1000, 10000, 100000]:
        queries = [(rng.randint(0, N), rng.randint(0, N)) for _ in range(Q)]
        queries = [(max(a, b), min(a, b)) for a, b in queries]
        t0 = time.perf_counter()
        for n, r in queries:
            ncr_naive(n, r)
        t_naive = time.perf_counter() - t0
        t0 = time.perf_counter()
        for n, r in queries:
            ncr_fast(n, r)
        t_fast = time.perf_counter() - t0
        print(f"Q={Q:<7d} naive={t_naive*1000:.1f}ms  fast={t_fast*1000:.1f}ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same queries across Go, Java, Python.
- The precomputed table (b) is dramatically faster per query; report the speedup.
- Both methods produce identical results (validate against `math.comb`).
- Report excludes table-build time from per-query measurements (or accounts for it separately).
- Writeup: note that (b)'s `O(N)` build amortizes immediately for any realistic `Q`, since each naive query costs two `O(log p)` modpows.

---

## General Guidance for All Tasks

- **Always validate against an exact oracle first.** Use Python's big integers (`pow(a, -1, m)`, `math.comb`) or `BigInteger`/`math/big` to compute the true value on small inputs, then compare the modular result.
- **Pin the modulus as a named constant.** Use `MOD = 10^9 + 7`; never inline the literal. Confirm it is prime before using Fermat.
- **Apply the negative fix after every subtraction** — `((x % m) + m) % m`. This is the #1 silent bug.
- **Size-check the modulus for overflow.** `m < ~3×10^9` → plain `(a*b)%m`; larger → `__int128`/`bits.Mul64`/Russian-peasant.
- **An inverse exists iff `gcd(a, m) = 1`.** Guard it; `0` is never invertible. Fermat only for prime `m`.
- **One inverse for the whole factorial table.** Never invert each factorial separately — use the backward `invfact` pass.
- **Reuse `addMod`/`subMod`/`mulMod`/`powMod`/`inv`.** Most bugs hide in `mulMod` and `inv`; write them once and test them hard.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.

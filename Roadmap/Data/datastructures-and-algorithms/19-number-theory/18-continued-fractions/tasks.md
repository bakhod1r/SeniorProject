# Continued Fractions — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the continued-fraction logic and validate against the evaluation criteria.
> **Always test against a brute-force / direct oracle on small inputs before trusting the CF result, and verify Pell with the big-integer identity `x^2 - D y^2 == 1`.**

---

## Beginner Tasks (5)

### Task 1 — CF expansion of a rational

**Problem.** Implement `continuedFraction(p, q)` returning the partial quotients `[a0, a1, ...]` of `p/q` via the Euclidean algorithm (record each quotient).

**Input / Output spec.**
- Read `p` and `q` (one line, two integers).
- Print the partial quotients space-separated.

**Constraints.**
- `0 <= p <= 10^18`, `1 <= q <= 10^18`.
- Use 64-bit integers; floor division for non-negative inputs.

**Hint.** Loop `while q != 0: emit(p/q); (p, q) = (q, p % q)`. The quotients are exactly Euclid's quotients.

**Starter — Go.**
```go
package main

import "fmt"

func continuedFraction(p, q int64) []int64 {
	// TODO: Euclidean loop recording quotients
	return nil
}

func main() {
	var p, q int64
	fmt.Scan(&p, &q)
	a := continuedFraction(p, q)
	for i, v := range a {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static List<Long> continuedFraction(long p, long q) {
        // TODO
        return new ArrayList<>();
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long p = sc.nextLong(), q = sc.nextLong();
        StringBuilder sb = new StringBuilder();
        List<Long> a = continuedFraction(p, q);
        for (int i = 0; i < a.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(a.get(i));
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def continued_fraction(p, q):
    # TODO
    return []


def main():
    p, q = map(int, sys.stdin.read().split())
    print(" ".join(map(str, continued_fraction(p, q))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `43/19 -> [2, 3, 1, 4]`, `5/19 -> [0, 3, 1, 4]`, integer `n/1 -> [n]`.
- No infinite loop; terminates in `O(log q)`.
- Folding the result back reproduces `p/q` (after reduction).

---

### Task 2 — Convergents from partial quotients

**Problem.** Given partial quotients `[a0, ..., an]`, compute the convergents `(p_k, q_k)` using the recurrence `p_k = a_k p_{k-1} + p_{k-2}`, `q_k = a_k q_{k-1} + q_{k-2}` with seeds `p_{-1}=1, p_{-2}=0, q_{-1}=0, q_{-2}=1`.

**Input / Output spec.**
- Read `n` then `n` partial quotients.
- Print each convergent `p_k/q_k` on its own line.

**Constraints.** `1 <= n <= 60`; partial quotients fit in 32 bits; use 64-bit for `p_k, q_k`.

**Hint.** Keep four running variables; do not re-divide. Verify with the determinant identity.

**Reference oracle (Python).**
```python
def convergents(a):
    p_, p__, q_, q__ = 1, 0, 0, 1
    out = []
    for ak in a:
        pk, qk = ak * p_ + p__, ak * q_ + q__
        out.append((pk, qk))
        p__, p_ = p_, pk
        q__, q_ = q_, qk
    return out
# convergents([2,3,1,4]) == [(2,1),(7,3),(9,4),(43,19)]
```

**Evaluation criteria.**
- `[2,3,1,4]` -> `(2,1),(7,3),(9,4),(43,19)`.
- Determinant identity `p_k q_{k-1} - p_{k-1} q_k == (-1)^{k-1}` holds for every `k`.
- `O(n)`.

---

### Task 3 — Fold a CF back to a fraction

**Problem.** Given partial quotients `[a0, ..., an]`, reconstruct the rational `p/q` (in lowest terms) by folding inward: start `num/den = a_n/1`, then `(num, den) = (a_k·num + den, num)` for each earlier `a_k`.

**Input / Output spec.**
- Read `n` then `n` partial quotients.
- Print `p q` (numerator, denominator), reduced.

**Constraints.** `1 <= n <= 50`; result fits in 64 bits.

**Hint.** This is the inverse of Task 1. `fold([2,3,1,4])` returns `43/19`.

**Worked check.** `fold([0,3,1,4])` returns `5/19` (leading `0` gives a value `< 1`).

**Evaluation criteria.**
- Round-trips with Task 1 on random rationals: `fold(expand(p/q)) == reduce(p/q)`.
- Handles a single-element list `[n] -> n/1`.
- Reduced output (gcd is 1).

---

### Task 4 — CF expansion of sqrt(D) (one period)

**Problem.** Given a non-square `D`, output `a0` and the periodic block of the CF of `sqrt(D)` using the integer `(m, d, a)` recurrence. Stop when `a == 2·a0`.

**Input / Output spec.**
- Read `D`.
- Print `a0` then the period terms space-separated.

**Constraints.** `2 <= D <= 10^6`, `D` not a perfect square.

**Hint.** `a0 = isqrt(D)`; then `a = (a0+m)/d; m = d·a - m; d = (D - m^2)/d`. Never use `double` for the recurrence.

**Worked check.** `D=7 -> a0=2, period [1,1,1,4]`. `D=2 -> a0=1, period [2]`. The last period term is always `2·a0`.

**Evaluation criteria.**
- `sqrt(7) = [2; 1,1,1,4]`, `sqrt(2) = [1; 2]`, `sqrt(13) = [3; 1,1,1,1,6]`.
- The block (except the final `2·a0`) is a palindrome.
- Rejects perfect squares (returns just `a0`, no period).

---

### Task 5 — Best convergent under a denominator cap (convergents only)

**Problem.** Given a target `num/den` and cap `N`, return the last convergent whose denominator is `<= N` (ignore semiconvergents for this beginner version).

**Input / Output spec.**
- Read `num den N`.
- Print the convergent `p/q`.

**Constraints.** `1 <= den, N <= 10^9`.

**Hint.** Walk the convergents (Task 2) and stop before `q_k` exceeds `N`; return the previous one.

**Evaluation criteria.**
- For `pi`-like input and `N=120`, returns `355/113` (a convergent).
- For `N=1`, returns `floor(num/den)/1`.
- `O(log N)`.

---

## Intermediate Tasks (5)

### Task 6 — Best rational approximation with semiconvergents

**Problem.** Given a target `num/den` and cap `N`, return the closest fraction with denominator `<= N`, considering **semiconvergents** `(p_{k-1} + t p_k)/(q_{k-1} + t q_k)` (best of the first kind).

**Constraints.** `1 <= den <= 10^12`, `1 <= N <= 10^12`.

**Hint.** When the next convergent's denominator exceeds `N`, compute the largest `t` with `q_{k-1} + t·q_k <= N`, form the semiconvergent, and compare it against the previous convergent by `|frac - target|` (use cross-multiplication to avoid floats).

**Reference oracle (Python).**
```python
from fractions import Fraction


def brute_best(target, N):
    best = None
    for q in range(1, N + 1):
        p = round(target * q)
        for pp in (p - 1, p, p + 1):
            f = Fraction(pp, q)
            if best is None or abs(f - target) < abs(best - target):
                best = f
    return best
```

**Evaluation criteria.**
- Matches `brute_best` for small `N` (e.g. `N <= 200`).
- Returns a semiconvergent (not a convergent) on inputs where one is strictly better.
- `O(log N)`.

---

### Task 7 — Pell's equation fundamental solution

**Problem.** Given non-square `D`, return the fundamental solution `(x, y)` of `x^2 - D y^2 = 1`. Use big integers; handle period parity.

**Constraints.** `2 <= D <= 10^4`, `D` not a perfect square.

**Hint.** Compute the period (Task 4). Build convergents; the fundamental solution is the convergent where `x^2 - D y^2 == 1`. For odd period, loop the block twice.

**Reference oracle (Python).**
```python
def brute_pell(D):
    y = 1
    while True:
        x2 = D * y * y + 1
        x = int(round(x2 ** 0.5))
        for xx in (x - 1, x, x + 1):
            if xx > 0 and xx * xx - D * y * y == 1:
                return (xx, y)
        y += 1
# brute_pell(13) == (649, 180)  -- slow, only for small D
```

**Evaluation criteria.**
- `D=2 -> (3,2)`, `D=7 -> (8,3)`, `D=13 -> (649,180)`, `D=61 -> (1766319049, 226153980)`.
- Big-integer check `x^2 - D y^2 == 1` passes.
- Matches `brute_pell` for small `D` where brute force is feasible.

---

### Task 8 — n-th Pell solution via matrix power

**Problem.** Given non-square `D` and `n >= 1`, return the `n`-th positive solution `(x_n, y_n)` of `x^2 - D y^2 = 1`, where solutions are ordered by size. Use the fundamental solution and exponentiation.

**Constraints.** `2 <= D <= 1000`, `1 <= n <= 50`. Use big integers (values explode).

**Hint.** Get `(x1, y1)` from Task 7. Then `(x_{k+1}, y_{k+1}) = (x1 x_k + D y1 y_k, x1 y_k + y1 x_k)`. Iterate `n-1` times, or use the `2x2` matrix `[[x1, D y1],[y1, x1]]` raised to the `n`-th power for `O(log n)`.

**Evaluation criteria.**
- `D=2, n=1 -> (3,2)`, `n=2 -> (17,12)`, `n=3 -> (99,70)`.
- Each result satisfies `x^2 - D y^2 == 1` (big int).
- Iterative and matrix-power versions agree.

---

### Task 9 — Rational reconstruction from a residue

**Problem.** Implement `reconstruct(u, m, B)` recovering `(a, b)` with `|a| < B`, `0 < b < B`, `gcd(b, m)=1`, `b·u ≡ a (mod m)`; return null/None if none exists.

**Constraints.** `m` prime, `10^6 < m < 10^18`; `1 <= B`, with `2·B·B < m`.

**Hint.** Run extended Euclid on `(m, u)`; stop when the remainder drops below `B`. The remainder is `a`, its cofactor is `b`. Normalize the sign and re-verify the congruence.

**Reference oracle (Python).**
```python
def make_residue(a, b, m):
    return a * pow(b, -1, m) % m
# reconstruct(make_residue(3, 7, 1000003), 1000003, 1000) == (3, 7)
```

**Evaluation criteria.**
- Recovers `(3, 7)`, `(-5, 11)`, etc. from their residues.
- Returns None when `2·B·B >= m` is violated and the answer is ambiguous, or when no fraction fits.
- Re-verifies `a ≡ u·b (mod m)` before returning.

---

### Task 10 — Negative Pell `x^2 - D y^2 = -1`

**Problem.** Given non-square `D`, determine whether `x^2 - D y^2 = -1` has a solution, and if so return the fundamental one. Use the CF period parity.

**Constraints.** `2 <= D <= 10^4`.

**Hint.** Negative Pell is solvable iff the CF period of `sqrt(D)` is **odd**. If so, the convergent at index `period-1` is the fundamental `-1` solution. If even, report unsolvable.

**Worked check.** `D=2 -> (1,1)` since `1 - 2 = -1`. `D=3 -> unsolvable` (period of `sqrt(3)` is even, length 2).

**Evaluation criteria.**
- Correctly reports solvable/unsolvable based on period parity.
- `D=2 -> (1,1)`, `D=5 -> (2,1)`, `D=13 -> (18,5)`; `D=3, 7 -> unsolvable`.
- Big-integer check `x^2 - D y^2 == -1` passes when solvable.

---

## Advanced Tasks (5)

### Task 11 — Wiener's attack on small-exponent RSA

**Problem.** Given an RSA public key `(e, N)` known to use a small private exponent `d`, recover `d` using the convergents of `e/N`. For each convergent `k/d` of `e/N`, test whether it yields a valid factorization of `N`.

**Constraints.** `N = p·q` with `p, q` prime, `d < N^{0.25}/3`. Test inputs provided where the attack succeeds.

**Hint.** Expand `e/N` as a CF; for each convergent `(k_i, d_i)` with `k_i != 0`, compute `phi = (e·d_i - 1)/k_i`; if `phi` is an integer, solve `x^2 - (N - phi + 1)x + N = 0` for integer roots `p, q`. If the roots are valid factors, `d_i` is the private key.

**Reference check (Python).**
```python
# Given (e, N) with small d, the correct d appears among the convergent denominators of e/N.
# Verify: pow(pow(2, e, N), d, N) == 2  (encryption then decryption is identity).
```

**Evaluation criteria.**
- Recovers `d` on provided vulnerable keys; reports failure on safe keys (large `d`).
- Uses convergents of `e/N`, not brute force over `d`.
- Verifies recovery by an encrypt/decrypt round-trip.

---

### Task 12 — CF of a general quadratic irrational with pre-period

**Problem.** Given integers `P, Q, D` (with `Q | (D - P^2)`, `D` non-square), compute the CF of `(P + sqrt(D))/Q`, returning the non-periodic pre-period and the periodic block. Use cycle detection on the `(P, Q)` state.

**Constraints.** `1 <= D <= 10^6`, reasonable `|P|, Q`.

**Hint.** The `2·a0` shortcut does **not** apply to a general quadratic irrational. Track the state `(P_k, Q_k)`; detect when a state repeats (Floyd/Brent or a seen-set) to identify the start and length of the period.

**Evaluation criteria.**
- Correctly separates pre-period and period.
- For `(P,Q,D) = (0,1,D)` reproduces the `sqrt(D)` result of Task 4.
- Detects the cycle without relying on the `2·a0` marker.

---

### Task 13 — Exact rational linear solve via CRT + reconstruction

**Problem.** Solve a small linear system `A x = b` with integer entries over the rationals by: (1) solving modulo several primes, (2) CRT-combining the residues, (3) rational-reconstructing each coordinate. Return each `x_i` as a reduced fraction.

**Constraints.** `A` is `n x n`, `n <= 8`, integer entries `|a_ij| <= 100`, `det(A) != 0`.

**Hint.** Use enough primes so their product exceeds `2·(bound)^2` where the bound comes from Hadamard's inequality on `det(A)` and the numerators. Modular Gaussian elimination per prime, then `crt` + `reconstruct` (Task 9) per coordinate.

**Evaluation criteria.**
- Matches a direct exact-rational solver (e.g. Python `Fraction` Gaussian elimination) on random systems.
- Uses the correct number of primes (reconstruction succeeds without ambiguity).
- Each output is reduced and re-verified by substitution `A x == b` over the rationals.

---

### Task 14 — Stern-Brocot search for the simplest fraction in an interval

**Problem.** Given two fractions `lo < hi`, find the fraction with the **smallest denominator** strictly between them, using a Stern-Brocot (mediant) descent.

**Constraints.** `0 <= lo < hi`, numerators/denominators up to `10^12`.

**Hint.** Maintain the interval boundaries; repeatedly take the mediant `(a+c)/(b+d)`. If it is inside `(lo, hi)`, it is the answer (it has the smallest denominator). Otherwise move the boundary toward the mediant; use run-length jumps (the partial quotients) to avoid `O(value)` single steps.

**Worked check.** Simplest fraction strictly between `1/3` and `1/2` is `2/5`; between `0.3141` and `0.3143` it should find a small-denominator fraction near `pi/10`-ish, e.g. `11/35`.

**Evaluation criteria.**
- Returns the minimal-denominator fraction in the open interval.
- Uses run-length (CF) jumps, not single mediant steps (so it is `O(log)`).
- Matches a brute-force search over denominators for small inputs.

---

### Task 15 — Decide the right tool for a CF-flavored problem

**Problem.** Given a problem descriptor `(kind, params)`, classify which technique applies and justify it. Return one of: `CF_CONVERGENTS` (best approximation), `PELL_CF` (`x^2 - D y^2 = ±1`), `RATIONAL_RECONSTRUCT` (recover fraction mod m), `MATRIX_POWER` (n-th Pell solution), or `NOT_CF` (problem unrelated to continued fractions).

**Constraints / cases to handle.**
- Best fraction within a denominator cap → `CF_CONVERGENTS`.
- `x^2 - D y^2 = 1` / `-1` → `PELL_CF` (note parity for `-1`).
- Recover `a/b` from `a b^{-1} mod m` → `RATIONAL_RECONSTRUCT`.
- `n`-th Pell solution for huge `n` → `MATRIX_POWER`.
- `x^2 - D y^2 = N` with `|N| > sqrt(D)` → `NOT_CF` (needs general solution-class theory).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is `|N| > sqrt(D)`, where CF convergents do not enumerate all solutions.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `NOT_CF` branch explains the `|N| > sqrt(D)` limitation.
- Justification cites the right complexity (`O(log N)`, `O(period)`, `O(log n)`, `O(log m)`).

---

## Benchmark Task

### Task B — Pell solution size growth vs D

**Problem.** Empirically study how the fundamental Pell solution size grows with `D`. For `D` ranging over non-squares in `[2, 2000]`, compute `(x1, y1)` (Task 7) and record the number of decimal digits of `x1` and the CF period length.

**Starter — Python.**
```python
import math
import time


def pell(D):
    a0 = math.isqrt(D)
    if a0 * a0 == D:
        return (1, 0), 0
    m, d, a = 0, 1, a0
    period = []
    while a != 2 * a0:
        m = d * a - m
        d = (D - m * m) // d
        a = (a0 + m) // d
        period.append(a)
    quotients = [a0] + period * (2 if len(period) % 2 else 1)
    p_, p__, q_, q__ = 0, 1, 1, 0
    for ak in quotients:
        p_, p__ = ak * p_ + p__, p_
        q_, q__ = ak * q_ + q__, q_
        if p_ * p_ - D * q_ * q_ == 1:
            return (p_, q_), len(period)
    return (p_, q_), len(period)


def main():
    print("D     period   digits(x1)   time_ms")
    for D in (61, 109, 151, 421, 661, 1021, 1789):
        start = time.perf_counter()
        (x, y), per = pell(D)
        dt = (time.perf_counter() - start) * 1000
        print(f"{D:<6}{per:<9}{len(str(x)):<13}{dt:.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same `D` produces identical `(x1, y1)` across Go, Java, and Python (big integers; results must match exactly).
- Shows that solution digit-count is **not** monotonic in `D` (e.g. `D=661` has far more digits than `D=1021`).
- Confirms the CF period stays short relative to the solution size (the compression that makes CF the only viable method).
- Reports period length alongside digit count; notes that the largest solutions correspond to long periods.
- Times only the computation, not output formatting.

---

## Shared Reference Snippets

Reuse these tested helpers across tasks rather than re-deriving them (and re-introducing seed/overflow bugs):

```python
import math

def expand(p, q):                     # partial quotients of p/q
    a = []
    while q:
        a.append(p // q); p, q = q, p % q
    return a

def convergents(a):                   # (p_k, q_k) list
    p_, p__, q_, q__ = 1, 0, 0, 1
    out = []
    for ak in a:
        pk, qk = ak * p_ + p__, ak * q_ + q__
        out.append((pk, qk)); p__, p_ = p_, pk; q__, q_ = q_, qk
    return out

def cf_sqrt(D):                       # (a0, period) using exact integers
    a0 = math.isqrt(D)
    if a0 * a0 == D:
        return a0, []
    m, d, a, per = 0, 1, a0, []
    while a != 2 * a0:
        m = d * a - m; d = (D - m * m) // d; a = (a0 + m) // d; per.append(a)
    return a0, per
```

Every task in this file is a thin wrapper around these three: best-approximation walks `convergents`, Pell powers the convergents of `cf_sqrt`, and reconstruction runs `expand`'s loop with a size-bound halt. Build and test these once.

## Difficulty Progression

- **Beginner (1-5)** establishes the two core mechanics: the Euclidean expansion and the convergent recurrence, plus the exact `sqrt(D)` period and a first Pell-adjacent touch (Fibonacci via matrix). Master the seeds and the determinant check here.
- **Intermediate (6-10)** turns the mechanics into solvers: semiconvergent-aware best approximation, the full Pell solver with parity, the `n`-th solution by powering, rational reconstruction, and negative Pell. Big integers become mandatory.
- **Advanced (11-15)** applies the theory: Wiener's RSA attack, general quadratic irrationals with pre-periods, CRT-based exact linear solving, large knight-graph-free Pell scaling, and the meta-skill of choosing the right tool. These mirror real production and cryptographic uses.

---

## General Guidance for All Tasks

- **Always validate against a direct oracle first.** Expand-then-fold round trips (Tasks 1+3), brute-force Pell for small `D` (Task 7), brute-force best-approximation for small `N` (Task 6). Trust the CF version only after it matches. The oracle does not need to be fast — it needs to be obviously correct, so a slow `O(N)` or `O(value)` reference is ideal precisely because its simplicity makes it trustworthy.
- **Use exact integers — never floats — for the recurrence.** The `sqrt(D)` period via `(m, d, a)` is exact; `double` drifts and corrupts the period. The only acceptable float use is seeding `a0 = floor(sqrt(D))`, and even that is safer with an integer `isqrt`.
- **Get the recurrence seeds right.** `p_{-1}=1, p_{-2}=0, q_{-1}=0, q_{-2}=1`. A wrong seed shifts every convergent and breaks the determinant identity `p_k q_{k-1} - p_{k-1} q_k = (-1)^{k-1}`. Assert this identity in tests to catch seed bugs instantly.
- **Reach for big integers in Pell.** Convergents and the `x^2 - D y^2` check overflow 64-bit fast (`D=661` already needs 38-digit `x`). Python `int`, Java `BigInteger`, Go `math/big`.
- **Handle period parity.** Even period → convergent at `period-1` solves `+1`; odd period → that solves `-1`, loop twice for `+1`. Negative Pell is solvable iff the period is odd.
- **Pin the reconstruction bound.** `2·A·B < m` makes the recovery unique; always re-verify the congruence and signal failure with null/None.
- **Mind the `|N| > sqrt(D)` boundary.** For `x^2 - D y^2 = N` with large `|N|`, CF convergents do not enumerate all solutions — do not assume they do.
- **Canonicalize trailing 1s before comparing CFs.** `[...; a_n, 1] = [...; a_n + 1]`; two equal numbers can have two CF lists, so normalize before any equality assertion in tests.
- **Match the halt condition to the goal.** GCD/expansion stop at remainder `0`; capped approximation stops when `q_k > N`; reconstruction stops when remainder `< bound`; the `sqrt(D)` period stops at `a_k == 2·a0`. Same loop, different stop — most wrong-answer bugs are a correct loop with the wrong halt.

### Suggested test matrix

| Input family | Why include it |
|--------------|----------------|
| `43/19`, `355/113` | canonical worked examples; check against `professional.md` |
| Fibonacci ratios (`89/55`, `144/89`) | longest CFs (all 1s) — worst case for Euclid and slowest convergence |
| Even-period `D` (`2, 7, 15`) and odd-period `D` (`5, 13, 29`) | exercise both Pell parity branches |
| `D = 61, 661` | giant fundamental solutions — force big-integer paths |
| perfect-square `D` (`9, 16`) | edge case: terminating CF, trivial Pell |
| small `a/b` mod large prime | rational reconstruction round-trips |

Run every task across this matrix, not just one example — the parity and overflow bugs hide on inputs a single example never reaches. A practical CI recipe: generate a few hundred random `(p, q)` pairs and random non-square `D` per build, assert the determinant identity and the fold-back round-trip on each, and assert `x^2 - D y^2 == 1` for every Pell solution — these randomized property checks catch far more than the fixed examples.

A final reminder on the unifying structure: every task here is the same Euclid loop with a different stopping rule and a different value read off the registers. If you build and harden the three shared snippets above (`expand`, `convergents`, `cf_sqrt`) plus a sign-normalized reconstruction helper, the fifteen tasks become short, low-risk wrappers. Resist the urge to copy-paste the loop into each task; a single tested engine is both fewer lines and fewer bugs.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs (everything is exact integer arithmetic, so results must match bit-for-bit).

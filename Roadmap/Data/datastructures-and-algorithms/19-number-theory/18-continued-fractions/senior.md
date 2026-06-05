# Continued Fractions — Senior Level

> Continued fractions are deceptively simple on paper and treacherous in production: the partial quotients of a quadratic irrational stay small, but the **convergent numerators and denominators explode exponentially**, the fundamental Pell solution can have thousands of digits, period detection has subtle parity and termination traps, and rational reconstruction is only correct under a precise size bound that, if violated, returns a plausible-but-wrong fraction silently. This document treats the engineering decisions: big-integer arithmetic, exact period detection, Pell solution size, rational reconstruction in modular and CRT pipelines, testing, and the failure modes that bite at scale.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Big Integers and the Growth of Convergents](#2-big-integers-and-the-growth-of-convergents)
3. [Periodic CF Detection Done Right](#3-periodic-cf-detection-done-right)
4. [Pell Fundamental-Solution Size and Scaling](#4-pell-fundamental-solution-size-and-scaling)
5. [Rational Reconstruction in Modular Contexts](#5-rational-reconstruction-in-modular-contexts)
6. [Connection to Extended Euclid and Stern-Brocot](#6-connection-to-extended-euclid-and-stern-brocot)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Worked Best-Approximation Walkthrough](#10-worked-best-approximation-walkthrough)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is a convergent" but "what breaks when I run this on real data?" Continued fractions appear in production in four guises that share one recurrence:

1. **Best rational approximation under a hard denominator cap** — gear ratios, frame-rate conversion, fixed-point coefficient design, fee/share ratios that must be representable with bounded denominators.
2. **Pell and norm-form equations** — cryptographic parameter generation, lattice problems, and the occasional Project-Euler-flavored backend.
3. **Rational reconstruction** — exact rational linear algebra solved over a modular image then lifted back, the backbone of computer-algebra systems.
4. **CF-based factoring / approximation attacks** — the CFRAC factoring method and Wiener's attack on RSA with small private exponent.

All four reduce to: *run a Euclid-like loop, accumulate convergents with the `p_k = a_k p_{k-1} + p_{k-2}` recurrence, and stop on the right condition.* The senior decisions are: which integer type, how to detect the period exactly, how big the answers get, how to make reconstruction provably correct, and how to verify when the true answer is too large to check by hand.

The recurring theme across all four is that the *algorithm* is trivial (a Euclid loop) but the *engineering* is where correctness lives: the same five-line loop is correct or catastrophically wrong depending on integer width, stopping condition, parity handling, and bound enforcement. A junior implementation that "works on the examples" frequently harbors a silent overflow or a parity bug that only surfaces on a `D` whose solution happens to be large — which is precisely the input a fuzz test or a real workload eventually hits. This document is organized around those failure surfaces, not around re-explaining the recurrence (covered in `middle.md` and `professional.md`).

---

## 2. Big Integers and the Growth of Convergents

### 2.1 Convergent denominators grow at least geometrically

From `q_k = a_k q_{k-1} + q_{k-2}` with every `a_k >= 1`, we get `q_k >= q_{k-1} + q_{k-2}`, so `q_k >= F_k` (the `k`-th Fibonacci number) and thus `q_k >= phi^{k-1}` where `phi ≈ 1.618`. The convergents grow *at least* as fast as the golden-ratio powers, and faster when partial quotients exceed 1. Practical consequence: a CF with even a few dozen sizeable partial quotients overflows 64-bit integers. Concretely, `phi^91 ≈ 7.5 * 10^18` exceeds the signed 64-bit ceiling, so a CF with ~90 partial quotients (or fewer if any quotient is large) needs big integers for its convergents — and `sqrt(D)` CFs routinely run that long for large `D`.

### 2.2 The overflow budget

For a rational `p/q` with `p, q < 2^63`, the convergents never exceed `p` and `q` themselves (the last convergent *is* `p/q`), so 64-bit is safe for the *expansion* of a bounded rational. The danger zones are:

- **Pell convergents of `sqrt(D)`**: these are *not* bounded by `D`; they grow until `p^2 - D q^2 = 1`, and `p` can reach `O(exp(sqrt(D)))`. Use big integers unless `D` is small and you have verified the solution fits.
- **The Pell check `p^2 - D q^2`**: even when `p, q` fit in 64 bits, `p^2` and `D q^2` may not. Compute the check in 128-bit or big-integer arithmetic.
- **Solution powers `(x1 + y1 sqrt D)^n`**: exponential in `n`; always big integers.

### 2.3 Language choices

| Language | Bounded-rational CF | Pell / large convergents |
|----------|--------------------|--------------------------|
| Python | native `int` (arbitrary precision) — trivial | native `int` — trivial |
| Java | `long` for bounded; watch the squared check | `BigInteger` |
| Go | `int64` for bounded; `math/bits.Mul64` for the check, or `math/big` | `math/big` |

In Python the arbitrary-precision default removes the overflow class of bugs entirely; in Go/Java you must choose `BigInteger`/`math/big` for Pell and for any squared comparison. The cost is constant factors, never correctness.

### 2.4 A concrete overflow trap

Consider verifying a candidate Pell solution for `D = 1000099` where `x ≈ 10^9` fits in `int64` but `x^2 ≈ 10^18` is near the `int64` ceiling `9.22 * 10^18`, and `D * y^2` can exceed it. The naive check `x*x - D*y*y == 1` overflows silently in Go/Java, wrapping to a value that may *accidentally* equal `1` or — worse — fail a correct solution. Three safe options:

- **128-bit intermediate**: Go `math/bits.Mul64` for the products, or `__int128` in C-like contexts; Java has no 128-bit primitive, so use `Math.multiplyHigh` or `BigInteger`.
- **Modular pre-screen**: check `x^2 - D y^2 ≡ 1 (mod p)` for a few primes `p` to cheaply reject most non-solutions, then confirm survivors with big integers.
- **Just use big integers** for the check even when `x, y` are 64-bit — the verification runs once per candidate, so the cost is negligible.

The lesson: the *expansion* of a bounded rational is 64-bit-safe, but the *quadratic verification* is the silent overflow site, even when the solution components themselves fit.

### 2.5 Growth illustrated

For `D = 94` the CF period is long and the convergents climb fast. The denominators `q_k` follow `q_k = a_k q_{k-1} + q_{k-2}`; with several `a_k = 1` interspersed with larger quotients, `q_k` still at least Fibonacci-doubles every two steps. By the time the period closes the fundamental solution is `x = 2143295, y = 221064` — already 7 digits for a 2-digit `D`. Plotting `log(q_k)` against `k` gives a near-straight line of slope `≈ log(Levy's constant) ≈ log(3.276)`, the universal growth rate (see `professional.md` Section 10.5). A monitoring dashboard that logs `len(str(x))` per Pell query will show this geometric blow-up and flag the rare long-period `D` that dominates latency.

---

## 3. Periodic CF Detection Done Right

### 3.1 The exact termination test

For `sqrt(D)` the cleanest period-end test is `a_k == 2·a0`. Equivalently, the state `(m_k, d_k)` returns to its first periodic value `(a0, 1)` (note the period starts at index 1, not 0). Relying on `a_k == 2·a0` is robust because that term is guaranteed to appear exactly once per period and marks its end.

### 3.2 Why not detect by float comparison

A tempting but wrong approach is to compute `sqrt(D)` as a double and watch the digits repeat. Floating point loses precision after ~15-16 digits; for `D` where the period is long or `a0` is large, the float drifts and the detected period is wrong. **Always use the integer `(m, d, a)` recurrence** — it is exact and the period detection is a clean integer equality.

### 3.3 General quadratic irrationals

For a root of `Ax^2 + Bx + C = 0` (not just `sqrt(D)`), the CF is still eventually periodic but may have a non-periodic *pre-period* (the "tail"). Detection then needs cycle finding (Floyd/Brent on the `(m, d)` state) rather than the `2·a0` shortcut, because the tidy `2·a0` marker is specific to `sqrt(D)`. State the input class precisely; the `sqrt(D)` fast path is not valid for arbitrary quadratic irrationals.

### 3.4 Period length surprises

Period lengths are erratic: `sqrt(2)` has period 1, `sqrt(7)` period 4, and primes `D ≡ 1 (mod 4)` can have long periods. The worst case is `O(sqrt(D) log D)`. Do not assume a small bound; allocate dynamically and guard against pathological inputs with a sanity cap plus a logged warning if exceeded.

### 3.5 The palindrome as a free correctness check

For `sqrt(D)`, the periodic block (excluding its final `2·a0` term) is a **palindrome** (`professional.md` Corollary 6.3). This gives a cheap built-in assertion: after computing the period, verify `period[0:r-1]` reads the same forwards and backwards. A non-palindromic block (other than the trailing `2·a0`) means a bug in the `(m, d, a)` recurrence — typically an integer-division sign error or an overflow in `d_{k+1} = (D - m^2)/d`. This structural check costs `O(period)` and catches transcription errors that a single spot-value comparison would miss. Combined with the `a_k == 2·a0` terminator, it makes the period computation self-validating.

---

## 4. Pell Fundamental-Solution Size and Scaling

### 4.1 Solutions can be astronomically large

The fundamental solution size is famously unpredictable. Small `D` can have huge solutions:

| `D` | fundamental `x` | digits |
|-----|----------------|--------|
| 2 | 3 | 1 |
| 7 | 8 | 1 |
| 61 | 1766319049 | 10 |
| 109 | 158070671986249 | 15 |
| 661 | 16421658242965910275055840472270471049 | 38 |

`D = 661` has a 38-digit `x` despite being a three-digit `D`. There is no polynomial bound on the solution size in terms of `D`; this is intrinsic, not an implementation artifact. Big integers are mandatory.

### 4.2 Negative Pell `x^2 - D y^2 = -1`

This has solutions *only* when the period of `sqrt(D)`'s CF is **odd**; then the convergent at index `period-1` solves the `-1` equation, and its square solves `+1`. When the period is even, negative Pell is unsolvable. Senior code must branch on parity and report unsolvability rather than loop forever searching. A fast `O(1)` pre-filter: negative Pell is unsolvable whenever `D` has a prime factor `≡ 3 (mod 4)`, so you can reject many `D` before computing the period at all (see `professional.md` Theorem 7.4).

### 4.3 General `x^2 - D y^2 = N`

For `|N| > 1` the CF approach still helps but is incomplete: you find solutions among convergents only when `|N| < sqrt(D)`, and otherwise need the more general method of fundamental solutions per class plus multiplication by the Pell unit. Know the boundary; do not assume the CF convergents enumerate all `N`-solutions.

The full picture for `x^2 - D y^2 = N`: the solutions partition into finitely many *classes*, each generated from one representative solution by multiplying by powers of the fundamental Pell unit `(x1 + y1 sqrt D)`. The CF convergents of `sqrt(D)` directly supply class representatives only for `|N| < sqrt(D)` (these are exactly the small `p_k^2 - D q_k^2` values that appear at non-period-end indices). For larger `|N|`, you enumerate fundamental solutions in each class by a bounded search (the PQa algorithm / Lagrange-Matthews-Mollin method) and then propagate each by the Pell unit. A senior implementation that only scans convergents will *silently miss* solution classes when `|N| >= sqrt(D)` — a correctness bug that passes small tests. Document the `|N| < sqrt(D)` precondition loudly, or implement the general class-based solver.

### 4.4 Computing the `n`-th solution efficiently

The recurrence `(x_{n+1}, y_{n+1}) = (x1 x_n + D y1 y_n, x1 y_n + y1 x_n)` is a fixed `2x2` linear map, so `(x_n, y_n) = M^n (1, 0)` with `M = [[x1, D y1],[y1, x1]]`. Matrix exponentiation (sibling `11-matrix-exponentiation`) gives the `n`-th solution in `O(log n)` big-integer multiplications — though the *numbers* themselves have `O(n)` digits, so the true cost is dominated by big-integer size.

A common API choice: do you want *the* `n`-th solution, or *all* solutions up to some size? For the former, matrix power is right. For the latter, the linear recurrence `x_{n+1} = 2 x1 x_n - x_{n-1}` (and the same for `y`) — derived from the characteristic polynomial of `M`, `t^2 - 2 x1 t + 1` — generates the sequence with two multiplications per step, cheaper than re-powering for each `n`. Note `det(M) = x1^2 - D y1^2 = 1`, so `M ∈ SL_2(Z)` and the recurrence is the Lucas-sequence form. Choose the iteration (all solutions in order) or the power (one distant solution) based on the access pattern.

### 4.5 Worked scaling example

Take `D = 2`, fundamental `(x1, y1) = (3, 2)`, `M = [[3, 4],[2, 3]]`. The solutions:

```
n=1: (3, 2)        3^2  - 2*2^2  = 1
n=2: (17, 12)      17^2 - 2*12^2 = 289 - 288 = 1
n=3: (99, 70)      99^2 - 2*70^2 = 9801 - 9800 = 1
n=4: (577, 408)    577^2 - 2*408^2 = 1
```

Each `x_n ≈ (3 + 2 sqrt 2)^n / 2 ≈ 5.83^n / 2`, so `x_n` gains `log10(5.83) ≈ 0.766` digits per step — `x_{100}` has about 77 digits. Computing `x_{10^9}` would need a ~766-million-digit integer; the `O(log n)` step count is real, but each multiply touches enormous operands. This is why "the `n`-th Pell solution" is `O(log n)` *multiplications* but not `O(log n)` *time*: the output itself is `O(n)` digits, an unavoidable lower bound.

---

## 5. Rational Reconstruction in Modular Contexts

### 5.1 The setup and the uniqueness bound

You have `u ≡ a·b^{-1} (mod m)` and want `(a, b)`. The reconstruction is **unique** iff there is a bound `N` with `0 <= a < N`, `0 < b < N`, and `2 N^2 <= m` (a common sufficient form; tighter asymmetric bounds `2 A B < m` also work). Run the extended-Euclid sequence on `(m, u)` and stop at the first remainder below `N`. The reason it works: the half-GCD-like sequence of remainders and cofactors *is* the convergent sequence of `u/m`, and the uniqueness bound guarantees exactly one convergent lands in the valid window.

### 5.2 Where it is used

- **Exact linear system solving**: solve `Ax = b` modulo several primes (or one large prime), CRT-combine, then rational-reconstruct each coordinate to recover the exact rational solution. This dodges the catastrophic intermediate-coefficient blow-up of fraction-free Gaussian elimination.
- **Polynomial interpolation over Q**: reconstruct rational coefficients from modular images.
- **Gröbner bases and symbolic computation**: computer-algebra systems (Maple, Sage, Magma) compute over a modular image to avoid coefficient swell, then lift via rational reconstruction — a core CAS technique.
- **Provable error correction (the link to coding theory)**: rational reconstruction is the same Euclidean machinery that decodes Reed-Solomon and related codes; the "key equation" in Berlekamp-Welch decoding is a rational-function reconstruction over a polynomial ring, structurally identical to the integer case here.
- **Cryptanalysis (Wiener's attack)**: if RSA uses a small private exponent `d < N^{0.25}/3`, then `e/N ≈ k/d`, and `k/d` appears as a convergent of `e/N` — so iterating the convergents of the public `e/N` recovers `d`. This is a CF-based break, the practical reason short RSA private exponents are forbidden.

### 5.3 CRT interaction

When `m = p1 p2 ... pt` (CRT product), you reconstruct modulo the *product*. The pitfall: if the product is barely larger than `2 N^2`, you are on the edge of the uniqueness bound; add a prime for margin. After reconstruction, **always re-verify** `a ≡ u b (mod m)` and `gcd(b, m) == 1`; a failed check means the bound was too tight or the inputs were inconsistent.

An incremental refinement that production CAS code uses: rather than fixing the prime count up front, reconstruct after each new prime is folded in and stop as soon as two consecutive reconstructions agree (the "early termination" heuristic). This avoids over-provisioning primes when the true rational happens to be small, while still guaranteeing correctness via the final re-check. It trades a few extra reconstruction attempts (each `O(log m)`, cheap) for potentially many saved per-prime solves (each `O(n^3)` for an `n x n` system) — usually a large net win.

### 5.4 Failure signaling

Reconstruction can legitimately fail (no fraction within the bound). Return an explicit "none" rather than a wrong fraction. Production callers must handle the none-case (e.g., by lifting to more primes), not assume success. A subtlety: a failed reconstruction at one prime count is not necessarily an error — it often just means "need more primes," so the caller's retry loop is part of the correct design, not an exception path. Conversely, a *successful* reconstruction that fails the final congruence re-check *is* an error (a too-loose bound), and must be surfaced loudly. Distinguishing "not enough information yet" (retry) from "inconsistent inputs" (fail hard) is the key API design decision.

### 5.5 Choosing the number of CRT primes

The deciding question in an exact-rational pipeline is *how many primes* to use. If each solution coordinate is a fraction `a/b` with `|a|, b <= H` (a bound from Hadamard's inequality on the matrix, `H <= (max|entry| * sqrt n)^n` for an `n x n` system), uniqueness needs the CRT product `m = prod p_i` to satisfy `2 H^2 <= m`. With 30-bit primes (`p_i ≈ 10^9`), you need `t ≈ ceil(log(2 H^2) / log(10^9))` primes. Using too few makes reconstruction silently return a wrong fraction; using far too many wastes per-prime solve time. The robust strategy: compute the Hadamard bound, choose `t` with a small safety margin (one or two extra primes), and **always re-verify** by substituting the reconstructed rational solution back into the original system over `Q`. If verification fails, add primes and retry — this self-correcting loop is the production-grade pattern.

### 5.6 Worked reconstruction trace

Recover `a/b = -5/8` modulo `m = 100003` (prime). Compute `u = (-5) * 8^{-1} mod m`. Running extended Euclid on `(m, u)` with cofactor tracking produces a sequence of `(remainder, cofactor)` pairs that are exactly the convergents of `u/m`; with bound `N = 100` (so `2 N^2 = 20000 < 100003`), you stop at the first remainder `< 100`. That remainder is `5` (taking sign into account, `-5`) and its cofactor is `8`, giving `a = -5, b = 8`. The re-check `b u ≡ a (mod m)` confirms it. The whole recovery is one truncated Euclid run — the *same* loop as the CF expansion, halted by `remainder < N` instead of `remainder == 0` (Section 6.3).

A subtle point this example exposes: the recovered `a` can be negative, so the cofactor sign matters. The convention is to track the cofactor `s` of the *second* argument (the residue `u`), normalize the final pair so `b > 0`, and then `a = r_final` carries its natural sign. An implementation that forgets to normalize the sign returns `5/8` instead of `-5/8` half the time — a bug that the congruence re-check catches (`8 * u mod m` equals `-5 mod m`, not `5`), which is yet another reason the re-check is non-negotiable rather than optional.

---

## 6. Connection to Extended Euclid and Stern-Brocot

### 6.1 Convergents are Bezout coefficients

Running extended Euclid on `(p, q)` produces exactly the convergent denominators (up to sign) as the cofactors. The final Bezout identity `p·s + q·t = gcd` uses `s = ±q_{n-1}`, `t = ∓p_{n-1}` — the second-to-last convergent. This is why a modular inverse `q^{-1} mod p` is `±q_{n-1}`: the CF and extended Euclid are the same computation, and choosing which output you read (gcd-cofactors vs convergents) is a matter of bookkeeping. Sibling `07-extended-euclidean-modular-inverse` is the same loop with a different return value.

### 6.2 Stern-Brocot as a search structure

The Stern-Brocot tree gives an `O(log)` search for the simplest rational in an interval `[lo, hi]` — descend by mediants, turning left or right depending on which side of the interval the mediant falls. The run-lengths of the turns are the partial quotients of the answer. For "find the simplest fraction between two doubles" (a real production need in UI ratio snapping and in floating-point-to-rational conversion), the Stern-Brocot descent is cleaner than raw CF arithmetic because it naturally handles the interval endpoints. A practical implementation note: take single mediant steps and you get `O(value)` time on inputs like `1/1000000` (a million left-turns); instead, jump by whole runs (compute how many consecutive same-direction turns fit before crossing the interval, which is a single division), recovering `O(log)`. This run-length jumping is exactly the partial-quotient computation — the Stern-Brocot search *is* the continued fraction, just phrased as tree navigation.

### 6.3 Choosing the right halt condition

The three production uses of the CF/Euclid loop differ *only* in when they stop, which is the single most important implementation decision:

| Goal | Halt when | Read off |
|------|-----------|----------|
| `gcd(p, q)` | remainder `== 0` | last nonzero remainder |
| Modular inverse / Bezout | remainder `== 0` | second-to-last cofactor |
| CF expansion | remainder `== 0` | all quotients |
| Rational reconstruction | remainder `< bound` | current remainder + cofactor |
| Best approx under cap `N` | next `q_k > N` | last convergent / best semiconvergent |
| Pell `sqrt(D)` | `a_k == 2 a0` (period end) | period-end convergent |

Treating these as one parameterized routine (the loop body is identical; only the stopping predicate and the returned register change) eliminates a whole class of copy-paste bugs and makes the shared `O(log)` cost obvious. A senior code review should check that the *halt condition* matches the *goal* — most "wrong answer" bugs in this family are a correct loop with the wrong stop.

In a shared library, the clean design is a single internal `euclid_step` iterator that yields `(quotient, remainder, p_k, q_k, cofactor)` tuples, with thin public wrappers (`gcd`, `modinv`, `expand`, `best_approx`, `reconstruct`, `pell`) that consume the iterator and apply their own halt-and-extract logic. This makes the shared invariants (determinant identity, monotone remainders) testable once on the iterator, and the wrappers become a few lines each. It also makes the half-GCD speedup (`professional.md` 10.1) a drop-in: replace the iterator's engine and every wrapper inherits the quasi-linear cost. The anti-pattern is six copy-pasted loops that drift apart over time, each with its own subtly different seed handling.

### 6.4 CF-based factoring as a cautionary application

CFRAC (continued-fraction factorization, see `professional.md`) and Wiener's RSA attack both mine the convergents of `sqrt(N)` or `e/N` for structure. In production these are *attack* tools, which has two implications: (1) if you generate cryptographic parameters, never allow a small RSA private exponent `d < N^{0.25}` — the convergents of `e/N` recover it (and `d < N^{0.292}` falls to the lattice-based Boneh-Durfee extension); (2) if you implement factoring for research, the convergent stream gives `O(sqrt N)`-small quadratic residues "for free," but CFRAC is superseded by the quadratic/number-field sieve, so use it only for its conceptual clarity, not raw speed. The senior takeaway: best-approximation quality is a double-edged sword — it powers approximation features and breaks weak crypto by the same mechanism. Treat any "this secret is small" assumption with suspicion, because small secrets are exactly what continued-fraction and lattice attacks exploit.

---

## 7. Code Examples

The three implementations below are deliberately chosen to exercise the senior concerns: the Go example uses `math/big` and verifies with the big-integer Pell identity (Section 2.4); the Java example enforces and re-verifies the reconstruction bound (Section 5); the Python example handles the semiconvergent case for best approximation (the first-vs-second-kind distinction). Together they cover the overflow, uniqueness-bound, and semiconvergent pitfalls that account for nearly every production bug in this topic. Note that all three are thin wrappers over the same Euclid loop — only the stopping rule and the verification differ.

### 7.1 Go — big-integer Pell with parity handling and verified check

```go
package main

import (
	"fmt"
	"math/big"
)

func isqrt(n int64) int64 {
	r := int64(0)
	for (r+1)*(r+1) <= n {
		r++
	}
	return r
}

// pellBig returns the fundamental solution (x, y) of x^2 - D y^2 = 1 as big.Ints.
func pellBig(D int64) (*big.Int, *big.Int) {
	a0 := isqrt(D)
	if a0*a0 == D {
		return big.NewInt(1), big.NewInt(0) // perfect square: trivial
	}
	// period
	var period []int64
	m, d, a := int64(0), int64(1), a0
	for a != 2*a0 {
		m = d*a - m
		d = (D - m*m) / d
		a = (a0 + m) / d
		period = append(period, a)
	}
	r := len(period)
	quotients := append([]int64{a0}, period...)
	if r%2 == 1 { // odd period -> go around twice for +1
		quotients = append(quotients, period...)
	}
	pPrev2, pPrev := big.NewInt(1), big.NewInt(0)
	qPrev2, qPrev := big.NewInt(0), big.NewInt(1)
	bigD := big.NewInt(D)
	for _, ak := range quotients {
		A := big.NewInt(ak)
		p := new(big.Int).Add(new(big.Int).Mul(A, pPrev), pPrev2)
		q := new(big.Int).Add(new(big.Int).Mul(A, qPrev), qPrev2)
		pPrev2, pPrev = pPrev, p
		qPrev2, qPrev = qPrev, q
		// check p^2 - D q^2 == 1
		lhs := new(big.Int).Sub(new(big.Int).Mul(p, p), new(big.Int).Mul(bigD, new(big.Int).Mul(q, q)))
		if lhs.Cmp(big.NewInt(1)) == 0 {
			return p, q
		}
	}
	return pPrev, qPrev
}

func main() {
	x, y := pellBig(661)
	fmt.Println("x =", x)
	fmt.Println("y =", y)
}
```

### 7.2 Java — rational reconstruction with explicit uniqueness bound

```java
import java.math.BigInteger;

public class RationalReconstruct {
    // Recover a/b with |a|,b < bound, a/b ≡ u (mod m). Returns {a, b} or null.
    static BigInteger[] reconstruct(BigInteger u, BigInteger m, BigInteger bound) {
        BigInteger r0 = m, r1 = u.mod(m);
        BigInteger s0 = BigInteger.ZERO, s1 = BigInteger.ONE;
        while (r1.compareTo(bound) >= 0) {
            BigInteger q = r0.divide(r1);
            BigInteger r2 = r0.subtract(q.multiply(r1));
            BigInteger s2 = s0.subtract(q.multiply(s1));
            r0 = r1; r1 = r2;
            s0 = s1; s1 = s2;
        }
        BigInteger a = r1, b = s1;
        if (b.signum() < 0) { a = a.negate(); b = b.negate(); }
        if (b.signum() == 0 || b.compareTo(bound) >= 0) return null;
        if (!a.mod(m).equals(u.multiply(b).mod(m))) return null; // verify
        return new BigInteger[]{a, b};
    }

    public static void main(String[] args) {
        BigInteger m = BigInteger.valueOf(1_000_003);
        // 3/7 mod m
        BigInteger u = BigInteger.valueOf(3)
                .multiply(BigInteger.valueOf(7).modInverse(m)).mod(m);
        BigInteger bound = BigInteger.valueOf(1000);
        BigInteger[] r = reconstruct(u, m, bound);
        System.out.println(r[0] + "/" + r[1]); // 3/7
    }
}
```

### 7.3 Python — best rational approximation under a denominator cap (convergents + semiconvergents)

```python
from fractions import Fraction


def best_rational_within(x: Fraction, max_den: int):
    """Closest fraction to x with denominator <= max_den (best of the first kind)."""
    # CF expansion with convergents
    p, q = x.numerator, x.denominator
    p_prev2, p_prev = 1, 0
    q_prev2, q_prev = 0, 1
    a_list = []
    pp, qq = p, q
    while qq:
        a_list.append(pp // qq)
        pp, qq = qq, pp % qq
    best = None
    for idx, ak in enumerate(a_list):
        pk = ak * p_prev + p_prev2
        qk = ak * q_prev + q_prev2
        if qk > max_den:
            # try the largest semiconvergent fitting under the cap
            t = (max_den - q_prev2) // q_prev
            if t > 0:
                semi = Fraction(p_prev2 + t * p_prev, q_prev2 + t * q_prev)
                cand = [semi]
            else:
                cand = []
            cur = Fraction(p_prev, q_prev) if q_prev else None
            if cur is not None:
                cand.append(cur)
            best = min(cand, key=lambda f: abs(f - x)) if cand else best
            return best
        best = Fraction(pk, qk)
        p_prev2, p_prev = p_prev, pk
        q_prev2, q_prev = q_prev, qk
    return best  # x itself fits


if __name__ == "__main__":
    import math
    pi_approx = Fraction(math.pi).limit_denominator(10**9)
    print(best_rational_within(pi_approx, 100))   # 22/7
    print(best_rational_within(pi_approx, 500))    # 355/113
```

---

## 8. Observability and Testing

A CF result is opaque — a wrong convergent looks like any other fraction. Build invariants in from day one.

| Check | Why |
|-------|-----|
| Determinant `p_k q_{k-1} - p_{k-1} q_k == (-1)^{k-1}` | catches recurrence/seed bugs instantly |
| Fold-back: `cf_to_fraction(expand(p/q)) == p/q` | round-trip correctness of expansion + reconstruction |
| Pell verify `x^2 - D y^2 == 1` (big int) | the single most important Pell check |
| Period-end marker `a_last == 2 a0` | confirms period detection |
| Negative-Pell parity: solvable iff period odd | guards the `-1` branch |
| Reconstruction re-check `a ≡ u b (mod m)` | rejects out-of-bound (wrong) answers |
| Convergent monotonic squeeze (alternating sides) | sanity on approximation order |

### 8.1 Property-test battery

```text
for random rational p/q:
    a = expand(p, q)
    assert fold_back(a) == reduce(p/q)
    for each k: assert det identity == (-1)^{k-1}
for random non-square D in [2, 10^4]:
    x, y = pell(D)
    assert x*x - D*y*y == 1            # big-int
    assert (x, y) is minimal (no smaller positive solution)
for random a/b with small a,b and large prime m:
    u = a * inverse(b, m) % m
    assert reconstruct(u, m, bound) == (a, b)
```

The Pell verify and the reconstruction re-check together catch nearly every real bug; the determinant identity catches the rest at the convergent level.

### 8.2 Cross-language determinism

The same inputs must yield identical partial quotients, convergents, and Pell solutions across Go, Java, and Python. Because everything is exact integer arithmetic (with big integers where needed), there is no floating-point nondeterminism to reconcile — a discrepancy means a genuine bug, usually overflow in the 64-bit language.

### 8.3 Production guardrails

For a service that answers CF/Pell/reconstruction queries at scale, add:

- **Magnitude logging**: log `len(str(x))` (digit count of the Pell solution) and the CF period length per query. A sudden spike flags a long-period `D` that will dominate latency; alert when the period exceeds a configured threshold.
- **Input validation**: reject `q <= 0`, perfect-square `D` (return the trivial Pell solution explicitly), and reconstruction calls violating `2 N^2 <= m`. Fail fast with a clear error rather than entering a divide-by-zero or returning a wrong fraction.
- **A self-check on a canary input** at startup: compute `pell(61)` and assert it equals `(1766319049, 226153980)`; a mismatch means an overflow or build regression before any real traffic hits the service.
- **Timeout / period cap**: guard the `sqrt(D)` period loop with a maximum iteration count (`O(sqrt(D) log D)` is the theoretical bound) and a logged warning if approached, so a pathological input cannot hang a worker.

These cheap guardrails turn the opaque "wrong fraction" failure mode into a loud, diagnosable one — essential because CF outputs carry no built-in error signal.

### 8.4 Performance characteristics

| Operation | Dominant cost | Practical note |
|-----------|---------------|----------------|
| CF of bounded `p/q` | `O(log q)` divisions | microseconds; 64-bit safe |
| Best approx under cap | `O(log N)` | microseconds |
| `sqrt(D)` period | `O(sqrt(D) log D)` steps | the period length, not the numbers, dominates here |
| Fundamental Pell | `O(period)` big-int ops | big-int multiply on `O(sqrt D)`-digit operands dominates |
| `n`-th Pell solution | `O(log n)` big-int mults | operands have `O(n)` digits — output size dominates |
| Rational reconstruction | `O(log m)` | one truncated Euclid run |

The single most important performance insight: for *rational* inputs everything is logarithmic and trivially fast, but for *Pell* the cost migrates from step count into big-integer arithmetic on enormous operands. Profiling a Pell-heavy service will show time concentrated in `BigInteger.multiply` / `big.Int.Mul`, not in the loop control. If that becomes a bottleneck, the only levers are (1) caching solutions per `D`, (2) using a faster big-integer library, and (3) avoiding recomputation of the period across queries with the same `D`. There is no asymptotic shortcut around the `O(sqrt D)`-digit output size.

### 8.5 What a good test suite looks like

A production CF/Pell library should ship: unit tests on the worked examples (`43/19`, `sqrt(7)`, `pell(61)`); randomized property tests (Section 8.1) on a few thousand instances per CI run; a fuzz target feeding random `(p, q)` and `D` to catch overflow and divide-by-zero; cross-language golden files (the same inputs producing byte-identical outputs in Go/Java/Python); and regression tests pinning the known-large solutions (`pell(661)`'s 38-digit `x`). Because the domain is exact integer arithmetic with closed-form invariants, test coverage can be near-total — there is no floating-point tolerance to fudge.

---

## 9. Failure Modes

Each failure mode below pairs a symptom with its root cause and mitigation. The unifying observation: because the algorithm is a tiny loop, *none* of these are logic bugs — they are all boundary, width, sign, or stopping-condition errors. That is good news for testing: a focused suite covering perfect squares, odd periods, large solutions, negative reconstructions, and tight bounds catches essentially the entire failure surface.

### 9.1 Silent 64-bit overflow in Pell
The convergents or the `p^2 - D q^2` check overflow before the comparison, so the loop never sees `== 1` and either runs past the true solution or returns garbage. Mitigation: big integers, or a 128-bit check; verify with the big-int identity.

### 9.1b Overflow in the quadratic check despite fitting components
Even when `x, y` individually fit in 64 bits, `x^2` and `D*y^2` may not, so the *check* `x*x - D*y*y == 1` overflows while the solution itself is representable. Symptom: a correct solution is rejected, or an incorrect one accepted. Mitigation: perform the check in big integers or with a 128-bit intermediate, regardless of whether the components fit (Section 2.4).

### 9.2 Float-based period detection
Detecting the period from `double` digits drifts for large `D`. Mitigation: integer `(m, d, a)` recurrence and the `a_k == 2 a0` test only. As a defensive cross-check, assert the palindrome property of the period block (Section 3.5) after computation.

### 9.3 Odd-period Pell mishandled
Reading the convergent at `period-1` for odd period yields a `-1` solution mistaken for `+1`. Mitigation: branch on parity; for odd period use index `2·period-1` (loop the block twice). The cleanest fix avoids the branch entirely: iterate convergents (looping the period as needed) and return the first with `p^2 - D q^2 == 1` — correct for both parities.

### 9.4 Rational reconstruction beyond the bound
If `2 N^2 > m`, reconstruction may return a different fraction congruent to `u` — wrong but plausible. Mitigation: enforce the bound, add CRT primes for margin, and re-verify the congruence.

### 9.5 Perfect-square `D`
`sqrt(D)` is rational, the CF terminates, and Pell has only `(1, 0)`. Mitigation: detect `isqrt(D)^2 == D` and return early; do not enter the period loop (which would divide by a zero `d`).

### 9.6 Semiconvergent vs convergent confusion
Returning the last convergent when the denominator cap falls between two convergents yields a sub-optimal fraction. Mitigation: test the largest valid semiconvergent and compare distances ("best of the first kind").

### 9.7 Trailing-1 normalization breaking equality
`[...; a_n=1]` and `[...; a_{n-1}+1]` are equal but compare unequal as lists. Mitigation: canonicalize before comparing CFs.

### 9.8 Assuming a short period
Allocating a fixed-size buffer for the period overflows on pathological `D`. Mitigation: dynamic storage and a guarded cap with a logged warning.

### 9.9 Confusing "second kind" with "first kind"
A denominator-capped query usually wants the closest fraction (first kind), but returning only convergents (second kind) is a subtle wrong answer when the cap lands between convergent denominators. Mitigation: always evaluate the largest valid semiconvergent and compare distances.

### 9.10 Sign and floor conventions on negative inputs
`floor(-x)` differs from truncation toward zero, so a negative `a0` computed with the wrong rounding shifts the whole CF. Mitigation: use true floor for `a0`, normalize the sign of the input first, and keep `a1, a2, ...` positive.

### 9.11 Float `isqrt` off-by-one
Computing `a0 = floor(sqrt(D))` via `(long) Math.sqrt(D)` can be off by one for large `D` due to rounding, seeding the entire period wrong (and possibly a divide-by-zero in `d`). Mitigation: use an integer `isqrt` with a correction loop (`while ((a0+1)^2 <= D) a0++; while (a0^2 > D) a0--;`), or Python's `math.isqrt`.

### 9.12 Recomputing the period per query
A service answering many Pell queries for the same `D` that recomputes the CF period every time wastes `O(sqrt D)` work per call. Mitigation: memoize `(a0, period, fundamental)` keyed by `D`; the period is `D`-intrinsic and never changes.

### 9.12b Returning a non-fundamental Pell solution
A loop that returns the *first* convergent satisfying `p^2 - D q^2 == 1` is correct, but a variant that powers the fundamental solution and returns a later one (e.g. due to an off-by-one in the period index) yields a *valid but non-minimal* solution. Symptom: the answer satisfies the equation but is larger than expected. Mitigation: assert minimality by checking no smaller positive `y` works (compare against the prior convergent), and test against the brute-force fundamental solution for small `D`.

### 9.13 Worked failure: the odd-period trap in code

A common bug: a Pell solver loops `for ak in [a0] + period` and returns the first convergent with `p^2 - D q^2 == 1`. For `D = 13` (period `5`, odd), the single pass produces convergents whose `p^2 - 13 q^2` values are `..., -1, ...` — *never* `+1` within one period. The loop falls through and returns the last convergent (a `-1` solution) or, worse, silently returns wrong data. The fix is the parity branch: when `len(period)` is odd, iterate the period block *twice* so the convergent at index `2r-1` (which solves `+1`) is reached. This bug passes every even-period test (`D = 2, 7, 15, ...`) and only fails on odd-period `D` (`5, 10, 13, 26, ...`) — a textbook case for property-based testing across many random `D`, not just a handful of examples.

---

## 10. Worked Best-Approximation Walkthrough

A frequent production task: snap a measured ratio to a simple fraction. Suppose a sensor reports `x = 0.6180344` (close to `phi - 1 = 0.6180339...`) and you need the simplest fraction with denominator `<= 50`.

1. Convert to an exact rational interval or `Fraction(6180344, 10000000)`.
2. Expand: the CF starts `[0; 1, 1, 1, 1, 1, 1, 1, ...]` (all 1s, because the value is near the golden ratio) then breaks where the input deviates from `phi`.
3. Convergents: `0/1, 1/1, 1/2, 2/3, 3/5, 5/8, 8/13, 13/21, 21/34, 34/55, ...`. The denominators are Fibonacci numbers — the slowest possible growth (Hurwitz, `professional.md`).
4. Cap `<= 50`: the last convergent with `q_k <= 50` is `21/34` (`q = 34`); the next is `34/55` (`q = 55 > 50`).
5. Test the semiconvergent: `(13 + t*21)/(21 + t*34)` for `t = 1` gives `34/55` (too big), so no semiconvergent fits under 50 beyond `21/34`. Answer: `21/34 = 0.61764...`.

The golden-ratio neighborhood is the *hardest* case: because all partial quotients are 1, you get the densest set of Fibonacci-denominator convergents and the slowest error decay — a good stress test for a best-approximation implementation. Compare with a sensor reading near `0.75`: its CF is just `[0; 1, 3]`, the convergent `3/4` appears immediately, and the cap is irrelevant. The variance in difficulty across inputs (Gauss-Kuzmin, `professional.md` 10.5) is exactly why you test on both easy and golden-ratio-adjacent inputs.

### 10.1 Production notes for the snapping feature

A real "ratio snapping" feature (aspect ratios, gear ratios, tempo locks) wraps the above with three production concerns. First, the *input is a float*, so convert to a tight rational interval `[x - eps, x + eps]` and snap to the simplest fraction *in the interval* (Stern-Brocot descent) rather than to a single point — this absorbs measurement noise and avoids returning `6180344/10000000`. Second, choose the denominator cap from the domain: UI aspect ratios cap at ~20, audio tempo at ~64, gear teeth at the manufacturable maximum. Third, return the *exact* fraction plus its decimal error so the caller can decide whether the snap is acceptable; surfacing `21/34 (err 0.00039)` lets a UI reject a poor match. The math is `O(log)` and instant; the engineering is entirely in interval handling and cap selection.

---

## 11. Summary

- **Convergents explode**: `q_k >= phi^{k-1}`, so 64-bit suffices only for the expansion of a *bounded* rational; Pell and solution-powers demand big integers, and even the `p^2 - D q^2` check can overflow.
- **Period detection must be exact**: use the integer `(m, d, a)` recurrence and the `a_k == 2 a0` marker; never detect via floating point. General quadratic irrationals need cycle detection, not the `2 a0` shortcut.
- **Pell solutions are unboundedly large** in `D` (e.g. `D=661` -> 38-digit `x`); negative Pell is solvable exactly when the period is odd; the `n`-th solution is a `2x2` matrix power.
- **Rational reconstruction** recovers `a/b` from `a b^{-1} mod m` by a truncated extended-Euclid run, correct only under a uniqueness bound (`2 N^2 <= m`); always re-verify the congruence and signal failure explicitly. It underlies exact rational linear algebra and Wiener's RSA attack.
- **CF = extended Euclid = Stern-Brocot descent**: the convergents are Bezout cofactors (sibling `07`), and the tree path run-lengths are the partial quotients — three views of one recurrence.
- **Test with invariants**: the determinant identity, fold-back round-trip, the big-int Pell verify, period-end marker, and reconstruction re-check together catch essentially every bug; everything is exact, so cross-language results must match bit-for-bit.

### Decision summary

- **Best fraction under a denominator cap** -> CF convergents + semiconvergents (`O(log)`); decide first vs second kind.
- **Pell `=1`** -> CF of `sqrt(D)`, convergent at period end, big integers; branch on period parity.
- **`n`-th Pell solution** -> matrix power of `[[x1, D y1],[y1, x1]]`.
- **Recover a fraction mod m** -> rational reconstruction under a verified bound; lift via CRT for margin.
- **Modular inverse / Bezout** -> the same loop, read the second-to-last convergent (sibling `07`).
- **Perfect-square or even-period negative Pell** -> detect and report unsolvable; do not loop.

### The one-paragraph operational summary

If you remember nothing else: the continued-fraction loop is `O(log)` and exact for rational inputs, but the moment a `sqrt(D)` or a Pell solution enters, the cost migrates into big-integer arithmetic on operands that can be `O(sqrt(D))` digits long, so reach for arbitrary-precision integers and verify with `x^2 - D y^2 == 1`. The three production-grade habits that prevent essentially every real incident are: (1) use exact integers and big integers — never floats in the recurrence or the quadratic check; (2) match the halt condition to the goal (remainder-zero, denominator-cap, period-marker, or size-bound); (3) verify with the built-in invariants (determinant identity, palindromic period, big-int Pell check, reconstruction congruence). With those three habits the opaque "wrong fraction" failure becomes a caught assertion, and the algorithm — a five-line Euclid loop — does the rest.

Finally, remember the architectural lesson: implement the Euclid step *once* as a shared iterator and build every operation as a thin wrapper (Section 6.3). This is not just tidiness — it concentrates the hard-won correctness (seeds, big integers, invariants) in one place, so a fix or a half-GCD speedup propagates to all six operations at once, and the six wrappers stay trivially auditable.

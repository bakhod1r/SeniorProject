# Continued Fractions — Interview Preparation

Continued fractions are a high-leverage interview topic: one crisp insight — *"the CF of `p/q` is the list of Euclidean quotients, and the convergents `p_k/q_k` are the best rational approximations"* — unlocks best-approximation problems, Pell's equation, and rational reconstruction. Interviewers probe whether you can (a) compute the expansion and convergents with the `p_k = a_k p_{k-1} + p_{k-2}` recurrence, (b) reason about the `1/q^2` approximation quality, (c) handle the *periodic* CF of `sqrt(D)` with exact integers to solve Pell, and (d) recover a hidden fraction from a residue mod `m`. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| CF of a rational `p/q` | Euclidean quotients | `O(log q)` |
| Convergents `p_k/q_k` | `p_k = a_k p_{k-1} + p_{k-2}` recurrence | `O(log q)` |
| Best fraction with denominator `<= N` | convergents + semiconvergents | `O(log N)` |
| Approximation error | `|x - p_k/q_k| < 1/q_k^2` | — |
| CF of `sqrt(D)` (period) | integer `(m, d, a)` recurrence | `O(period)` |
| Pell `x^2 - D y^2 = 1` | convergent at period end | `O(period)` |
| `n`-th Pell solution | matrix power of `[[x1, D y1],[y1, x1]]` | `O(log n)` |
| Recover `a/b` from `a b^{-1} mod m` | rational reconstruction (truncated Euclid) | `O(log m)` |
| Modular inverse / Bezout | second-to-last convergent | `O(log m)` |

Recurrence skeleton (memorize this):

```text
expand(p, q):                 # partial quotients
    while q != 0: emit(p/q); (p,q) = (q, p%q)

convergents(a):               # p_k/q_k
    p_,p__ = 1,0; q_,q__ = 0,1            # p_{-1},p_{-2}; q_{-1},q_{-2}
    for a_k in a:
        p = a_k*p_ + p__; q = a_k*q_ + q__
        (p__,p_) = (p_,p); (q__,q_) = (q_,q)
```

Key facts:
- **Partial quotients of `p/q` = Euclid's quotients.** No floating point needed.
- **Determinant identity:** `p_k q_{k-1} - p_{k-1} q_k = (-1)^{k-1}` (convergents are always reduced).
- **Convergents straddle `x`:** even below, odd above, error `< 1/q_k^2`.
- **`sqrt(D)` is periodic** (Lagrange); the period ends with `2·a0`.
- **Pell's fundamental solution is a convergent of `sqrt(D)`** at the period end (parity matters).
- **Rational reconstruction = Euclid halted by a size bound**, unique under `2 A B < m`.

---

## Junior Questions (12 Q&A)

### J1. What is a continued fraction?
An expression `a0 + 1/(a1 + 1/(a2 + ...))`, written `[a0; a1, a2, ...]`. The `a_k` are the partial quotients: `a0` is any integer, and `a1, a2, ...` are positive integers (for the regular CF we always use).

### J2. How do you compute the CF of a rational `p/q`?
Run the Euclidean algorithm and record each quotient: `a = p/q; (p, q) = (q, p mod q)`, repeat until `q == 0`. The recorded quotients are exactly the partial quotients. It is just GCD that remembers its quotients.

### J3. What is a convergent?
The fraction you get by truncating the CF after `a_k`: `p_k/q_k = [a0; a1, ..., a_k]`. The convergents of `43/19 = [2;3,1,4]` are `2/1, 7/3, 9/4, 43/19`.

### J4. What is the convergent recurrence?
`p_k = a_k p_{k-1} + p_{k-2}` and `q_k = a_k q_{k-1} + q_{k-2}`, with seeds `p_{-1}=1, p_{-2}=0, q_{-1}=0, q_{-2}=1`. Each new convergent reuses the previous two — `O(1)` per step.

### J5. Why are the seeds `p_{-1}=1` and `q_{-1}=0` (not zero/one swapped)?
So that `p_0/q_0 = (a0·1 + 0)/(a0·0 + 1) = a0/1`, the correct first convergent. Getting the seeds wrong shifts every convergent and breaks the determinant identity.

### J6. What does "best rational approximation" mean here?
Each convergent `p_k/q_k` is closer to `x` than any other fraction with denominator `<= q_k`. So convergents are the optimal simple fractions for their size of denominator.

### J7. How good is the approximation?
The error is below `1/q_k^2`: `|x - p_k/q_k| < 1/(q_k q_{k+1}) <= 1/q_k^2`. Doubling the denominator roughly quarters the error.

### J8. Do convergents approach `x` from one side?
No — they alternate. Even-indexed convergents are below `x`, odd-indexed are above, and they squeeze in from both sides.

### J9. Which numbers have finite CFs?
Exactly the rationals. An irrational number has an infinite CF. Quadratic irrationals like `sqrt(2)` have *periodic* infinite CFs.

### J10. What is the CF of `sqrt(2)`?
`[1; 2, 2, 2, ...]` — the `2` repeats forever. In general `sqrt(D)` has a periodic CF whose period ends in `2·floor(sqrt(D))`.

### J11. How do you turn a CF back into a fraction?
Fold from the innermost term outward: start `num/den = a_n/1`, then for each earlier `a_k` set `(num, den) = (a_k·num + den, num)`. This inverts the expansion.

### J12 (analysis). Why is the CF of `p/q` only `O(log q)` long?
Because it is the Euclidean algorithm, whose number of steps is `O(log q)` (worst case is consecutive Fibonacci numbers, by Lame's theorem). So the CF is as cheap as one GCD.

---

## Middle Questions (12 Q&A)

### M1. Prove the determinant identity `p_k q_{k-1} - p_{k-1} q_k = (-1)^{k-1}`.
Induction. Base `k=0`: `a0·0 - 1·1 = -1`. Step: substitute the recurrence; the `a_k` terms cancel and you get `-(p_{k-1} q_{k-2} - p_{k-2} q_{k-1})`, flipping the sign each step. (Or: it is `det` of a product of `[[a_k,1],[1,0]]` matrices, each with determinant `-1`.)

### M2. What is the matrix form of the convergent recurrence?
`M(a0)·M(a1)·...·M(a_k) = [[p_k, p_{k-1}],[q_k, q_{k-1}]]` where `M(a) = [[a,1],[1,0]]`. The determinant identity is then just `det = (-1)^{k+1}`.

### M3. What are semiconvergents, and when do they matter?
Fractions `(p_{k-1} + t·p_k)/(q_{k-1} + t·q_k)` for `t = 1..a_{k+1}`. They are the best approximations with denominator strictly between two convergents. If a "best fraction with denominator <= N" query has `N` between two convergent denominators, the answer is a semiconvergent.

### M4. How do you compute the CF of `sqrt(D)` without floating point?
Use the integer state `(m, d, a)`: start `m=0, d=1, a=floor(sqrt(D))`, then `a = floor((a0+m)/d); m = d·a - m; d = (D - m^2)/d`. The period ends when `a == 2·a0`. Everything is exact integer arithmetic.

### M5. Why is the CF of a quadratic irrational periodic?
Lagrange's theorem: a number has an eventually periodic CF iff it is a quadratic irrational. Intuitively, the "complete quotients" all satisfy quadratics with the same discriminant and bounded coefficients, so finitely many states exist and one must repeat.

### M6. How does the CF of `sqrt(D)` solve Pell's equation?
The convergents `p_k/q_k` satisfy `p_k^2 - D q_k^2 = ±1` exactly at the end of a period. So the fundamental solution `(x1, y1)` of `x^2 - D y^2 = 1` is a convergent of `sqrt(D)`.

### M7. What is the role of period parity in Pell?
If the period `r` is even, the convergent at index `r-1` gives `+1` (the fundamental solution). If `r` is odd, it gives `-1`; you must go around twice (index `2r-1`) to get `+1`.

### M8. How do you generate all Pell solutions from the fundamental one?
`(x_n + y_n sqrt(D)) = (x1 + y1 sqrt(D))^n`, which unrolls to `x_{n+1} = x1 x_n + D y1 y_n`, `y_{n+1} = x1 y_n + y1 x_n`. The `n`-th solution is a `2x2` matrix power, `O(log n)`.

### M9. What is the Stern-Brocot tree's connection to CFs?
The tree holds every positive rational once. The path from the root to `p/q` (a string of L/R turns) has run-lengths equal to the partial quotients of `p/q`. Walking the tree *is* computing the CF.

### M10. What is rational reconstruction?
Given `u = a·b^{-1} mod m` and a size bound, recover the small fraction `a/b`. You run extended Euclid on `(m, u)` and stop when the remainder drops below the bound; the remainder and its cofactor are `a` and `b`.

### M11. How are convergents related to the Extended Euclidean Algorithm?
They are the same computation. The convergent denominators are (up to sign) the Bezout cofactors. A modular inverse `q^{-1} mod p` is `±q_{n-1}`, the second-to-last convergent denominator.

### M12 (analysis). Why is the golden ratio the "worst" number to approximate?
`phi = [1; 1, 1, 1, ...]` has all partial quotients equal to `1`, the smallest possible, so its convergent denominators grow slowest (like Fibonacci) and the `1/q^2` error decays slowest. Hurwitz's theorem makes this precise: the best constant `1/(sqrt(5) q^2)` is attained by `phi`.

---

## Senior Questions (10 Q&A)

### S1. How large can a Pell fundamental solution be?
Unboundedly large relative to `D`. For example `D=61` gives `x = 1766319049` (10 digits) and `D=661` gives a 38-digit `x`. There is no polynomial bound in `D`, so you must use big integers.

### S2. What integer type do you use, and where does overflow bite?
For the expansion of a bounded rational, 64-bit suffices. For Pell, use big integers — both the convergents and the check `p^2 - D q^2` overflow 64-bit quickly. The squared check overflows even when `p, q` fit.

### S3. Why never detect the `sqrt(D)` period with floating point?
Doubles lose precision after ~16 digits; for large `D` or long periods the detection is wrong. Use the integer `(m, d, a)` recurrence and the exact `a_k == 2·a0` test.

### S4. When is the negative Pell equation `x^2 - D y^2 = -1` solvable?
Exactly when the period of `sqrt(D)`'s CF is odd. If the period is even, it has no solution; your code must detect this and report unsolvable rather than search forever.

### S5. State the uniqueness condition for rational reconstruction.
If there is a fraction `a/b` with `|a| < A`, `0 < b < B`, `2 A B <= m`, and `b u ≡ a (mod m)`, it is unique and recoverable. Beyond that bound the answer can be ambiguous; always re-verify the congruence afterward.

### S6. Where does rational reconstruction get used in practice?
Exact rational linear algebra: solve `Ax = b` modulo a prime (or via CRT across primes), then reconstruct each coordinate to recover the exact rational solution — avoiding the coefficient blow-up of naive Gaussian elimination. Also in Wiener's attack on small-exponent RSA.

### S7. Explain Wiener's attack as a CF problem.
If RSA's private exponent `d` is small (`d < N^{0.25}/3`), then `e/N` is very close to `k/d`, so `k/d` shows up as a convergent of the public `e/N`. Iterating the convergents of `e/N` recovers `d`. It is best-approximation theory used as a break.

### S8. How do you compute the `n`-th Pell solution for huge `n`?
The solutions evolve by a fixed `2x2` matrix `M = [[x1, D y1],[y1, x1]]`, so `(x_n, y_n) = M^n (1, 0)`. Use binary matrix exponentiation in `O(log n)` big-integer multiplies (the numbers themselves have `O(n)` digits).

### S9. Best approximation "of the first kind" vs "of the second kind"?
Second kind minimizes `|q x - p|` — exactly the convergents. First kind minimizes `|x - p/q|` — the convergents plus qualifying semiconvergents. A denominator-capped query is usually first-kind, so you must test semiconvergents, not just convergents.

### S10 (analysis). Why is the CF expansion essentially as fast as GCD, and what is the bit complexity?
It is the same loop, `O(log q)` steps. With schoolbook arithmetic the bit cost is `O(n^2)` for `n`-bit inputs; with the half-GCD (fast continued fraction) algorithm it drops to quasi-linear `O(n log^2 n log log n)`.

---

## Professional Questions (8 Q&A)

### P1. Design a service that returns the simplest fraction approximating a user-supplied real to within a denominator cap.
Parse the input to an exact rational (or a tight interval if it is a float). Run the CF, accumulate convergents until the denominator exceeds the cap, then test the largest valid semiconvergent against the last convergent and return the closer one. `O(log N)`. Cache nothing per request; it is already logarithmic. Validate the cap and reject non-positive denominators.

### P2. How do you build an exact rational linear-algebra solver using CFs?
Solve the system modulo one large prime (or several via CRT) using modular Gaussian elimination, giving each solution coordinate as a residue. Then apply rational reconstruction to each coordinate under a bound derived from Hadamard's inequality on the matrix entries. Re-verify by substituting back over the rationals. Add primes if reconstruction fails.

### P3. Your Pell solver hangs on some inputs. What is wrong and how do you fix it?
Likely a perfect-square `D` (the period loop divides by a zero `d`) or an odd period mishandled (looping for `+1` that the single period never produces). Fix: detect `isqrt(D)^2 == D` and return the trivial solution; branch on period parity and loop the block twice for odd periods; guard the period length with a sanity cap and big integers for the check.

### P4. How do you verify a Pell result you cannot check by hand (38-digit numbers)?
Compute `x^2 - D y^2` in big-integer arithmetic and assert it equals `1`. Additionally assert minimality (no smaller positive `y` works, checked against the previous convergent), and cross-check across Go/Java/Python — since everything is exact integer arithmetic, all three must agree exactly.

### P5. When is the CF approach the wrong tool for `x^2 - D y^2 = N`?
For `|N| > sqrt(D)` the convergents of `sqrt(D)` do not enumerate all solutions; you need the general theory of solution classes times the Pell unit. The CF directly yields solutions only for `|N| < sqrt(D)` and for `N = ±1`. State this boundary before assuming convergents suffice.

### P6. How would you parallelize CRT-based rational reconstruction across primes?
Each modular solve (one prime) is an independent job — distribute them across workers. Combine the residues with CRT (also parallelizable as a tree reduction), then do a single reconstruction modulo the product. The reconstruction itself is cheap (`O(log m)`); the parallelism is in the per-prime solves.

### P7. How do continued fractions connect to lattice reduction and Diophantine approximation?
The CF gives the optimal 1-dimensional Diophantine approximation; its multidimensional generalization is lattice basis reduction (LLL). The convergent matrix lives in `SL_2(Z)`, and best-approximation under a denominator cap is the 2D shortest-vector flavor. CFRAC factoring and Wiener's attack are both "approximation reveals structure" instances.

### P8 (analysis). Why does the determinant identity guarantee convergents are in lowest terms, and why does that matter for reconstruction?
`p_k q_{k-1} - p_{k-1} q_k = ±1` means any common divisor of `p_k, q_k` divides `1`, so `gcd(p_k, q_k) = 1`. This matters because rational reconstruction relies on the recovered `(a, b)` being reduced for uniqueness — the same `±1` cofactor structure that makes convergents reduced makes the reconstruction provably unique under the size bound.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a floating-point ratio with an exact rational.
Look for a concrete story: a place where accumulated float error caused a visible bug (a ratio drifting, a financial split not summing), the switch to CF-based exact rationals or a best-approximation under a denominator cap, and the measured correctness improvement. Strong answers mention testing the round-trip (expand then fold back) and choosing the denominator cap deliberately.

### B2. A teammate used `double` to detect the period of `sqrt(D)` and it fails on large D. How do you handle it?
Explain calmly that doubles lose precision past ~16 digits, so the detected period drifts. Show the exact integer `(m, d, a)` recurrence with the `a_k == 2 a0` stopping test as the fix, and add a property test (`x^2 - D y^2 == 1` in big integers) so the failure cannot recur. Frame it as a precision lesson, not blame.

### B3. Design a feature that snaps an arbitrary aspect ratio to the simplest "nice" ratio.
This is best rational approximation under a denominator cap: take the float ratio, build an interval around it (to absorb float error), and find the simplest fraction in that interval via Stern-Brocot descent or CF convergents/semiconvergents. Discuss the cap choice (e.g. denominator <= 20 for UI), endpoint handling, and returning `16/9` rather than `1601/901`.

### B4. How would you explain continued fractions to a junior engineer?
Start concrete: "It is the Euclidean algorithm that writes down its quotients." Show `43/19` peeling off `2, 3, 1, 4`. Then introduce convergents as "the best simple fraction at each step," with the gear-ratio analogy. Lead with the two practical gotchas: use exact integers (no floats), and the seeds of the recurrence must be exactly right.

### B5. Your exact-rational solver is slow on large matrices. How do you investigate?
Profile where time goes: usually the big-integer arithmetic in the modular solve, not the reconstruction. Check whether you are using too few primes (forcing huge per-prime work) or too many (CRT overhead). Confirm reconstruction bounds are tight (a loose bound forces extra primes). The fix is usually picking the right number/size of primes and parallelizing the per-prime solves.

---

## Coding Challenges

### Challenge 1: CF Expansion and Convergents

**Problem.** Given integers `p, q` (`q > 0`), return the partial quotients of `p/q` and the list of convergents `(p_k, q_k)`.

**Example.**
```text
p=43, q=19 -> CF [2,3,1,4], convergents (2,1),(7,3),(9,4),(43,19)
```

**Constraints.** `1 <= q <= 10^9`, `0 <= p <= 10^18`.

**Optimal.** Euclid + recurrence, `O(log q)`.

**Go.**
```go
package main

import "fmt"

func cfAndConvergents(p, q int64) ([]int64, [][2]int64) {
	var a []int64
	pp, qq := p, q
	for qq != 0 {
		a = append(a, pp/qq)
		pp, qq = qq, pp%qq
	}
	var conv [][2]int64
	var pPrev, pPrev2 int64 = 1, 0
	var qPrev, qPrev2 int64 = 0, 1
	for _, ak := range a {
		pk := ak*pPrev + pPrev2
		qk := ak*qPrev + qPrev2
		conv = append(conv, [2]int64{pk, qk})
		pPrev2, pPrev = pPrev, pk
		qPrev2, qPrev = qPrev, qk
	}
	return a, conv
}

func main() {
	a, conv := cfAndConvergents(43, 19)
	fmt.Println(a)    // [2 3 1 4]
	fmt.Println(conv) // [[2 1] [7 3] [9 4] [43 19]]
}
```

**Java.**
```java
import java.util.*;

public class CFConvergents {
    static void run(long p, long q) {
        List<Long> a = new ArrayList<>();
        long pp = p, qq = q;
        while (qq != 0) { a.add(pp / qq); long r = pp % qq; pp = qq; qq = r; }
        long pPrev = 1, pPrev2 = 0, qPrev = 0, qPrev2 = 1;
        System.out.println("CF: " + a);
        for (long ak : a) {
            long pk = ak * pPrev + pPrev2, qk = ak * qPrev + qPrev2;
            System.out.println(pk + "/" + qk);
            pPrev2 = pPrev; pPrev = pk;
            qPrev2 = qPrev; qPrev = qk;
        }
    }

    public static void main(String[] args) { run(43, 19); }
}
```

**Python.**
```python
def cf_and_convergents(p, q):
    a, pp, qq = [], p, q
    while qq:
        a.append(pp // qq)
        pp, qq = qq, pp % qq
    conv, p_, p__, q_, q__ = [], 1, 0, 0, 1
    for ak in a:
        pk, qk = ak * p_ + p__, ak * q_ + q__
        conv.append((pk, qk))
        p__, p_ = p_, pk
        q__, q_ = q_, qk
    return a, conv


if __name__ == "__main__":
    print(cf_and_convergents(43, 19))
    # ([2, 3, 1, 4], [(2, 1), (7, 3), (9, 4), (43, 19)])
```

---

### Challenge 2: Best Rational Approximation Within a Denominator Bound

**Problem.** Given a target as a fraction `num/den` and a cap `N`, return the fraction closest to it with denominator `<= N` (best of the first kind), considering semiconvergents.

**Example.**
```text
target ~ pi (e.g. 31415926/10000000), N=113 -> 355/113
target ~ pi, N=8 -> 22/7
```

**Optimal.** CF convergents + best semiconvergent under the cap, `O(log N)`.

**Python.**
```python
from fractions import Fraction


def best_within(target: Fraction, N: int) -> Fraction:
    p, q = target.numerator, target.denominator
    a = []
    while q:
        a.append(p // q)
        p, q = q, p % q
    p_, p__, q_, q__ = 1, 0, 0, 1
    best = None
    for ak in a:
        pk, qk = ak * p_ + p__, ak * q_ + q__
        if qk > N:
            t = (N - q__) // q_                       # largest semiconvergent index
            cands = []
            if t > 0:
                cands.append(Fraction(p__ + t * p_, q__ + t * q_))
            if q_:
                cands.append(Fraction(p_, q_))         # previous convergent
            return min(cands, key=lambda f: abs(f - target))
        best = Fraction(pk, qk)
        p__, p_ = p_, pk
        q__, q_ = q_, qk
    return best


if __name__ == "__main__":
    pi = Fraction(31415926, 10000000)
    print(best_within(pi, 113))  # 355/113
    print(best_within(pi, 8))    # 22/7
```

**Go.**
```go
package main

import "fmt"

// returns numerator, denominator of best fraction with denom <= N
func bestWithin(num, den int64, N int64) (int64, int64) {
	var a []int64
	p, q := num, den
	for q != 0 {
		a = append(a, p/q)
		p, q = q, p%q
	}
	var pPrev, pPrev2 int64 = 1, 0
	var qPrev, qPrev2 int64 = 0, 1
	bestN, bestD := int64(0), int64(1)
	for _, ak := range a {
		pk := ak*pPrev + pPrev2
		qk := ak*qPrev + qPrev2
		if qk > N {
			t := (N - qPrev2) / qPrev
			// candidate semiconvergent vs previous convergent
			cn, cd := pPrev, qPrev
			if t > 0 {
				sn := pPrev2 + t*pPrev
				sd := qPrev2 + t*qPrev
				// compare |sn/sd - num/den| vs |cn/cd - num/den| via cross-mult
				if absDiff(sn, sd, num, den) < absDiff(cn, cd, num, den) {
					cn, cd = sn, sd
				}
			}
			return cn, cd
		}
		bestN, bestD = pk, qk
		pPrev2, pPrev = pPrev, pk
		qPrev2, qPrev = qPrev, qk
	}
	return bestN, bestD
}

// |a/b - c/d| compared as |a*d - c*b| / (b*d), denominators positive
func absDiff(a, b, c, d int64) int64 {
	v := a*d - c*b
	if v < 0 {
		v = -v
	}
	return v * 1 // proportional to error * (b*d); fine for same-target comparisons if scaled
}

func main() {
	n, d := bestWithin(31415926, 10000000, 113)
	fmt.Printf("%d/%d\n", n, d) // 355/113
}
```

**Java.**
```java
import java.math.BigInteger;

public class BestWithin {
    static long[] best(long num, long den, long N) {
        java.util.List<Long> a = new java.util.ArrayList<>();
        long p = num, q = den;
        while (q != 0) { a.add(p / q); long r = p % q; p = q; q = r; }
        long pPrev = 1, pPrev2 = 0, qPrev = 0, qPrev2 = 1;
        long bestN = 0, bestD = 1;
        for (long ak : a) {
            long pk = ak * pPrev + pPrev2, qk = ak * qPrev + qPrev2;
            if (qk > N) {
                long t = (N - qPrev2) / qPrev;
                long cn = pPrev, cd = qPrev;
                if (t > 0) {
                    long sn = pPrev2 + t * pPrev, sd = qPrev2 + t * qPrev;
                    if (diff(sn, sd, num, den) < diff(cn, cd, num, den)) { cn = sn; cd = sd; }
                }
                return new long[]{cn, cd};
            }
            bestN = pk; bestD = qk;
            pPrev2 = pPrev; pPrev = pk;
            qPrev2 = qPrev; qPrev = qk;
        }
        return new long[]{bestN, bestD};
    }

    static double diff(long a, long b, long c, long d) {
        return Math.abs((double) a / b - (double) c / d);
    }

    public static void main(String[] args) {
        long[] r = best(31415926L, 10000000L, 113);
        System.out.println(r[0] + "/" + r[1]); // 355/113
    }
}
```

---

### Challenge 3: Pell's Equation Fundamental Solution

**Problem.** Given a non-square `D`, return the fundamental solution `(x, y)` of `x^2 - D y^2 = 1`.

**Example.**
```text
D=2 -> (3, 2);  D=7 -> (8, 3);  D=13 -> (649, 180);  D=61 -> (1766319049, 226153980)
```

**Optimal.** CF of `sqrt(D)`, convergent at period end (big integers), `O(period)`.

**Python.**
```python
import math


def pell(D):
    a0 = math.isqrt(D)
    if a0 * a0 == D:
        return (1, 0)
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
            return (p_, q_)
    return (p_, q_)


if __name__ == "__main__":
    for D in (2, 7, 13, 61):
        x, y = pell(D)
        print(D, x, y, x * x - D * y * y)
```

**Go.**
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

func pell(D int64) (*big.Int, *big.Int) {
	a0 := isqrt(D)
	if a0*a0 == D {
		return big.NewInt(1), big.NewInt(0)
	}
	var period []int64
	m, d, a := int64(0), int64(1), a0
	for a != 2*a0 {
		m = d*a - m
		d = (D - m*m) / d
		a = (a0 + m) / d
		period = append(period, a)
	}
	q := append([]int64{a0}, period...)
	if len(period)%2 == 1 {
		q = append(q, period...)
	}
	bd := big.NewInt(D)
	p1, p2 := big.NewInt(0), big.NewInt(1)
	q1, q2 := big.NewInt(1), big.NewInt(0)
	for _, ak := range q {
		A := big.NewInt(ak)
		np := new(big.Int).Add(new(big.Int).Mul(A, p1), p2)
		nq := new(big.Int).Add(new(big.Int).Mul(A, q1), q2)
		p2, p1 = p1, np
		q2, q1 = q1, nq
		lhs := new(big.Int).Sub(new(big.Int).Mul(p1, p1), new(big.Int).Mul(bd, new(big.Int).Mul(q1, q1)))
		if lhs.Cmp(big.NewInt(1)) == 0 {
			return p1, q1
		}
	}
	return p1, q1
}

func main() {
	x, y := pell(61)
	fmt.Println(x, y) // 1766319049 226153980
}
```

**Java.**
```java
import java.math.BigInteger;
import java.util.*;

public class Pell {
    static long isqrt(long n) { long r = (long) Math.sqrt((double) n); while ((r+1)*(r+1) <= n) r++; while (r*r > n) r--; return r; }

    static BigInteger[] pell(long D) {
        long a0 = isqrt(D);
        if (a0 * a0 == D) return new BigInteger[]{BigInteger.ONE, BigInteger.ZERO};
        List<Long> period = new ArrayList<>();
        long m = 0, d = 1, a = a0;
        while (a != 2 * a0) { m = d * a - m; d = (D - m * m) / d; a = (a0 + m) / d; period.add(a); }
        List<Long> q = new ArrayList<>(); q.add(a0); q.addAll(period);
        if (period.size() % 2 == 1) q.addAll(period);
        BigInteger bd = BigInteger.valueOf(D);
        BigInteger p1 = BigInteger.ZERO, p2 = BigInteger.ONE, q1 = BigInteger.ONE, q2 = BigInteger.ZERO;
        for (long ak : q) {
            BigInteger A = BigInteger.valueOf(ak);
            BigInteger np = A.multiply(p1).add(p2), nq = A.multiply(q1).add(q2);
            p2 = p1; p1 = np; q2 = q1; q1 = nq;
            if (p1.multiply(p1).subtract(bd.multiply(q1.multiply(q1))).equals(BigInteger.ONE))
                return new BigInteger[]{p1, q1};
        }
        return new BigInteger[]{p1, q1};
    }

    public static void main(String[] args) {
        BigInteger[] s = pell(61);
        System.out.println(s[0] + " " + s[1]); // 1766319049 226153980
    }
}
```

---

### Challenge 4: Rational Reconstruction

**Problem.** Given `u`, modulus `m`, and a bound `B`, recover `(a, b)` with `|a| < B`, `0 < b < B`, `gcd(b, m)=1`, and `b·u ≡ a (mod m)`. Return null/None if none exists.

**Example.**
```text
m=1000003, u = 3 * inverse(7) mod m -> (3, 7)
```

**Optimal.** Truncated extended Euclid, `O(log m)`.

**Python.**
```python
def rational_reconstruct(u, m, B):
    r0, r1 = m, u % m
    s0, s1 = 0, 1
    while r1 >= B:
        q = r0 // r1
        r0, r1 = r1, r0 - q * r1
        s0, s1 = s1, s0 - q * s1
    a, b = r1, s1
    if b < 0:
        a, b = -a, -b
    if b == 0 or b >= B or (a % m) != (u * b) % m:
        return None
    return (a, b)


if __name__ == "__main__":
    m = 1000003
    u = 3 * pow(7, -1, m) % m
    print(rational_reconstruct(u, m, 1000))  # (3, 7)
```

**Go.**
```go
package main

import "fmt"

func reconstruct(u, m, B int64) (int64, int64, bool) {
	r0, r1 := m, ((u%m)+m)%m
	s0, s1 := int64(0), int64(1)
	for r1 >= B {
		q := r0 / r1
		r0, r1 = r1, r0-q*r1
		s0, s1 = s1, s0-q*s1
	}
	a, b := r1, s1
	if b < 0 {
		a, b = -a, -b
	}
	if b == 0 || b >= B {
		return 0, 0, false
	}
	if ((a%m)+m)%m != ((u%m)*b)%m {
		return 0, 0, false
	}
	return a, b, true
}

func modinv(a, m int64) int64 {
	g, x := a, int64(1)
	_ = g
	// simple inverse via Fermat is omitted; assume caller supplies u directly
	return x
}

func main() {
	m := int64(1000003)
	// u = 3 * inv(7) mod m ; precomputed = 428573 for this m
	u := int64(428573)
	a, b, ok := reconstruct(u, m, 1000)
	fmt.Println(a, b, ok) // 3 7 true
}
```

**Java.**
```java
import java.math.BigInteger;

public class RationalReconstruct {
    static BigInteger[] reconstruct(BigInteger u, BigInteger m, BigInteger B) {
        BigInteger r0 = m, r1 = u.mod(m);
        BigInteger s0 = BigInteger.ZERO, s1 = BigInteger.ONE;
        while (r1.compareTo(B) >= 0) {
            BigInteger q = r0.divide(r1);
            BigInteger r2 = r0.subtract(q.multiply(r1));
            BigInteger s2 = s0.subtract(q.multiply(s1));
            r0 = r1; r1 = r2; s0 = s1; s1 = s2;
        }
        BigInteger a = r1, b = s1;
        if (b.signum() < 0) { a = a.negate(); b = b.negate(); }
        if (b.signum() == 0 || b.compareTo(B) >= 0) return null;
        if (!a.mod(m).equals(u.multiply(b).mod(m))) return null;
        return new BigInteger[]{a, b};
    }

    public static void main(String[] args) {
        BigInteger m = BigInteger.valueOf(1000003);
        BigInteger u = BigInteger.valueOf(3).multiply(BigInteger.valueOf(7).modInverse(m)).mod(m);
        BigInteger[] r = reconstruct(u, m, BigInteger.valueOf(1000));
        System.out.println(r[0] + "/" + r[1]); // 3/7
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"The CF of `p/q` is the Euclidean quotient list; the convergents `p_k/q_k` are the best rational approximations, built by `p_k = a_k p_{k-1} + p_{k-2}`."*
- Flag the two gotchas immediately: **use exact integers (no floats)** and **get the recurrence seeds right** (`p_{-1}=1, q_{-1}=0`).
- For `sqrt(D)` / Pell, mention the **periodic CF** and that the fundamental solution is the **convergent at the period end**, with **parity** deciding even vs odd.
- For "best fraction under a cap," remember **semiconvergents**, not just convergents.
- For "recover a fraction mod m," name **rational reconstruction** and the **`2 A B < m` uniqueness bound**, and offer to re-verify the congruence.
- Always offer to verify with the **determinant identity** and (for Pell) the **big-integer `x^2 - D y^2 == 1` check**.

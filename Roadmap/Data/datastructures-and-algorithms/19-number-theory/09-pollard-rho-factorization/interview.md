# Pollard's Rho Factorization — Interview Preparation

Pollard's rho is a favourite interview topic because it rewards one crisp insight — *"walk `x ← x² + c (mod n)`, and `gcd(|x − y|, n)` reveals a factor when the sequence collides modulo a hidden prime `p`"* — and then tests whether you can (a) explain the birthday-paradox `O(n^{1/4})` speedup, (b) keep it correct with an **overflow-safe mulmod**, (c) wire it into a **full** factorization with Miller-Rabin and trial division, and (d) avoid the traps of running it on a prime, forgetting restarts, or thinking it threatens RSA. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions (all overflow-safe).

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Find one factor of composite `n` | Pollard's rho: `gcd(|x−y|, n)` | `O(n^{1/4})` expected |
| Is `n` prime? | Miller-Rabin (sibling `08`) | `O(log³ n)` |
| Fully factor `n` | rho + Miller-Rabin + trial division (recurse) | `O(n^{1/4} polylog n)` |
| Find a factor `p` with smooth `p−1` | Pollard's p−1 | `O(B log² n)` |
| Detect a cycle in `O(1)` memory | Floyd (tortoise/hare) or Brent | — |
| `(a·b) mod n` for 64-bit `n` | `__int128` / Montgomery mulmod | `O(1)` |
| **Factor RSA-2048** | **infeasible by rho** (`≈ 2^{512}`) | — |

Core algorithm:

```text
pollardRho(n):
    if n even: return 2
    for c = random in [1, n):
        x = y = 2;  d = 1
        f(v) = (v*v + c) mod n           # SAFE mulmod for v*v
        while d == 1:
            x = f(x)                      # tortoise (1 step)
            y = f(f(y))                   # hare (2 steps)
            d = gcd(|x − y|, n)
        if 1 < d < n: return d            # nontrivial factor
        # else d == n → restart with new c
```

Key facts:
- **rho splits; it does not fully factor.** Recurse with Miller-Rabin as the base case.
- The speedup is the **birthday paradox**: collision mod `p` after `≈ √p ≤ n^{1/4}` steps.
- **Overflow** is the #1 bug: `a*b` exceeds 64 bits → use `__int128`/Montgomery.
- `gcd == n` is a **collapse** → restart with a new `c`; never return `n` as a factor.

---

## Junior Questions (12 Q&A)

### J1. What does Pollard's rho do?
It finds **one nontrivial factor** of a composite number `n`. It walks a pseudo-random sequence `x ← x² + c (mod n)` and, when two values collide modulo a hidden prime factor `p`, computes `gcd(|x − y|, n)`, which is a multiple of `p` smaller than `n` — a factor.

### J2. Why is it called "rho"?
Because the sequence of values, reduced modulo a prime `p`, eventually repeats and traces a shape like the Greek letter ρ: a tail leading into a cycle. The collision happens where the loop closes.

### J3. What is the iteration function?
`f(x) = (x² + c) mod n`, with a small constant `c` (usually `1`) and seed `x₀ = 2`. It is deterministic but scrambles values enough to act like a random walk.

### J4. How does the gcd produce a factor?
If `xᵢ ≡ xⱼ (mod p)` then `p` divides `xᵢ − xⱼ`. If also `xᵢ ≠ xⱼ (mod n)`, the difference is not a multiple of `n`. So `gcd(|xᵢ − xⱼ|, n)` is a multiple of `p` but less than `n` — a nontrivial factor.

### J5. What is the running time?
Expected `O(n^{1/4})` to find a factor — the square root of trial division's `O(√n)`. For a 64-bit number that is ~65000 steps instead of ~4 billion.

### J6. Why `O(n^{1/4})` and not `O(√n)`?
The smallest prime factor `p` is `≤ √n`. By the birthday paradox, the sequence mod `p` collides after `≈ √p` steps, not `p`. Since `√p ≤ √(√n) = n^{1/4}`, that is the expected number of iterations.

### J7. What is the tortoise and hare?
Floyd's cycle detection: a slow pointer moves 1 step (`x ← f(x)`), a fast pointer moves 2 steps (`y ← f(f(y))`). The fast one laps the slow one inside the cycle, producing the collision the gcd catches — all in `O(1)` memory.

### J8. What are the three outcomes of the gcd each round?
`gcd == 1`: no collision yet, keep going. `1 < gcd < n`: success, a nontrivial factor. `gcd == n`: collapse — restart with a different `c`.

### J9. Why can't you run rho on a prime?
A prime has no nontrivial factor, so the gcd never lands between `1` and `n`, and the loop runs forever. You must test primality (Miller-Rabin) first.

### J10. What is the overflow problem?
For 64-bit `n`, `x*x` can be ~`2^{126}`, overflowing a 64-bit product. A plain `(x*x) % n` returns garbage. You need an overflow-safe `mulmod` (`__int128`, `bits.Mul64`, BigInteger, or Python big ints).

### J11. How do you fully factor a number with rho?
rho gives one factor `d`. Recurse: test `n` with Miller-Rabin; if prime, record it; else split with rho and recurse on `d` and `n/d`. Strip small primes by trial division first.

### J12 (analysis). Why does stripping small primes help?
rho's cost scales with the *smallest* prime factor, and it handles tiny factors (and the even case) awkwardly. Trial division by small primes removes them instantly, leaving rho to do the one hard split.

---

## Middle Questions (12 Q&A)

### M1. Prove that the gcd gives a factor.
If `xᵢ ≡ xⱼ (mod p)`, then `p | (xᵢ − xⱼ)`, and since `p | n`, we have `p | gcd(|xᵢ − xⱼ|, n)`, so the gcd is `> 1`. If `xᵢ ≢ xⱼ (mod n)`, then `n ∤ (xᵢ − xⱼ)`, so the gcd is `< n`. Hence `1 < gcd < n` — a nontrivial factor.

### M2. Floyd vs Brent — what is the difference?
Floyd uses a tortoise (1 step) and hare (2 steps), doing 3 `f` evaluations per round. Brent keeps a fixed reference and advances one pointer, resetting the reference at power-of-two boundaries — only ~1 `f` evaluation per step, about 25% fewer than Floyd, and it batches the gcd cleanly.

### M3. What is batched gcd and why is it correct?
Instead of a gcd every step, accumulate `Q ← Q · |x − y| (mod n)` over ~128 steps and take one `gcd(Q, n)`. If any difference in the batch was a multiple of `p`, then `p | Q`, so the batched gcd still finds `p`. This replaces 128 gcds with one gcd plus cheap mulmods.

### M4. What is the collapse case and how do you recover?
A collapse is `gcd == n` — two values collided mod `n` (or the batch product over-multiplied past a factor). With batching, rewind to the batch start and re-walk one step at a time with per-step gcd; the first nontrivial gcd is the factor. If truly mod-`n`, restart with a new `c`.

### M5. How do you combine rho with Miller-Rabin?
Miller-Rabin is the recursion base case and the loop-forever guard: at each node, if `isPrime(n)` record it; else split with rho and recurse on both cofactors. It prevents rho from running on a prime.

### M6. What is Pollard's p−1 method?
A complementary factoring method: if a prime factor `p` has `p − 1` smooth (all small prime factors `≤ B`), then `a^M ≡ 1 (mod p)` for `M = lcm(1..B)` by Fermat, so `gcd(a^M − 1, n)` is a factor. It finds `p` based on smoothness, not `√p`.

### M7. When does p−1 beat rho, and when does it fail?
p−1 wins when a factor `p` has smooth `p − 1` even if `p` is large (rho depends on `√p`). It fails entirely if no factor has smooth `p ± 1` — which is why safe primes (`p = 2q+1`) defeat it.

### M8. How do you avoid overflow on 64-bit `n`?
Use a 128-bit product (`__int128`, `bits.Mul64`+`bits.Div64`, `Math.multiplyHigh`, or BigInteger) or Montgomery multiplication. Never write `(a*b) % n` directly for `n` beyond ~`2^{31}`.

### M9. Why must you randomize `c` on restart?
A fixed `c` that failed (gcd stuck at 1, or collapsed to `n`) will deterministically fail again. Randomizing `c` (and the seed) reshapes the walk so the next attempt has a fresh, independent chance.

### M10. What constants `c` are bad?
`c = 0` makes `f(x) = x²`, which has fixed points (0, 1) and degenerate orbits. `c = n − 2` with seed 2 is a documented degenerate pair. Start at `c = 1` and randomize on restart, excluding these.

### M11. Why can't rho threaten RSA?
RSA moduli are ~2048-bit with prime factors ~`2^{1024}`. rho needs `≈ √p ≈ 2^{512}` operations — astronomically infeasible. rho's `O(n^{1/4})` is exponential in bit-length, trivial for 64-bit but hopeless for crypto sizes.

### M12 (analysis). Why is the expected time a *heuristic*, not a guarantee?
The `√p` figure assumes `x² + c` behaves like a random function mod `p` (birthday paradox). This is experimentally accurate but unproven; the worst case is `O(p)` by pigeonhole. So rho is a Monte Carlo, expected-time algorithm — correct when it returns, but with heuristic running time.

---

## Senior Questions (10 Q&A)

### S1. Why is Montgomery multiplication preferred over a 128-bit divide?
The rho hot loop does millions of `mulmod`s, and integer division (the `% n`) is the slowest ALU op. Montgomery replaces the division with shifts and multiplies (working in a transformed domain), giving a 2–3× speedup. Setup (the inverse `n'` via Newton iteration) amortizes away.

### S2. How do you handle perfect powers?
rho can stall on a prime power `p^k` (orbits mod `p` and `p²` correlate). Before the main loop, check whether `n = m^k` for `k ≥ 2` (an `O(log² n)` test); if so, factor the base `m` and multiply each prime's multiplicity by `k`.

### S3. Walk me through a robust factor(n) order of operations.
(1) strip small primes by trial division (handles even, small factors); (2) if `n == 1` done; (3) if Miller-Rabin says prime, record; (4) if perfect power, factor the base ×k; (5) rho with restarts to split; (6) recurse on both cofactors.

### S4. How do you recover from a batched-gcd collapse?
Remember the batch start `ys`. On `gcd(Q, n) == n`, rewind to `ys` and re-walk step by step, taking a per-step `gcd(|x − y|, n)`; the first nontrivial gcd is the factor the batch overshot. If even that yields `n`, it was a true mod-`n` collision → restart with new `c`.

### S5. How do you verify a factorization you cannot independently compute?
Two self-certifying invariants: the product of returned factors equals `n`, and every factor passes Miller-Rabin. A multiset of primes multiplying to `n` *is* the unique factorization (Fundamental Theorem of Arithmetic), so these two checks fully certify correctness without a known answer.

### S6. Is rho deterministic or randomized? What are the implications?
It is Monte Carlo: correct when it returns (any `d` truly divides `n`) but with randomized, heuristic running time. Implications: you must support restarts with fresh randomness, bound iteration budgets, and treat the `√p` time as expected, not guaranteed.

### S7. When would you escalate beyond rho?
When `n` exceeds ~`10^{19}`–`10^{20}` (rho's `n^{1/4}` grows past feasibility) or has factors larger than ~`10^{10}` with no small prime: move to the Elliptic Curve Method (factors up to ~`10^{40}`), then the Quadratic Sieve / GNFS for crypto-size semiprimes.

### S8. What are the main performance levers in rho?
Montgomery mulmod (biggest win), batched gcd (one gcd per ~128 steps), Brent over Floyd (~25% fewer `f` evals), binary (Stein's) gcd (no division), and stripping small primes so rho runs only on the hard core. Parallelize across `c`-attempts and across inputs.

### S9. How does deterministic Miller-Rabin make the 64-bit factorizer exact?
For `n < 3.3 × 10^{24}`, the fixed witness set `{2,3,5,7,...,37}` gives Miller-Rabin zero false positives. So every "prime" leaf in the recursion is genuinely prime, and the whole factorization is exact (not probabilistic) for any 64-bit input.

### S10 (analysis). Why does rho find small factors faster than large ones?
The cost is `≈ √(smallest prime p)`, because the orbit mod `p` (a `p`-element set) collides after `√p` steps. A small `p` collides sooner. So for `n = small_prime × huge_prime`, rho finds the small prime almost immediately — its runtime is governed by the *smallest* factor, not by `n`.

---

## Professional Questions (8 Q&A)

### P1. Design a service that factors a stream of 64-bit integers at high throughput.
Per number: strip small primes, Miller-Rabin, perfect-power check, then Montgomery-backed rho with Brent + batched gcd, recursing with Miller-Rabin. Parallelize across numbers (embarrassingly parallel) and across `c`-attempts within a hard number. Cache nothing per number; the algorithm is `O(1)` memory. Add a self-check (re-multiply factors == `n`) per result and a restart-count guardrail.

### P2. Your factorizer occasionally returns a composite as "prime." What happened?
The primality test is too weak for the input size — too few Miller-Rabin witnesses for `n` beyond the deterministic range, misclassifying a composite. Fix: deterministic witness set for 64-bit; for larger `n`, use ~50 random bases or BPSW. The split logic is deterministically correct; only the primality test can introduce this error.

### P3. The factorizer hangs on some inputs. Diagnose.
Most likely rho running on a prime with no primality guard (infinite loop) — add Miller-Rabin before every rho call. Or an unbounded loop with a bad `c` and no restart — bound iterations and restart with fresh randomness. Or an overflow in mulmod producing a non-divisor "factor" that breaks recursion invariants — cross-check mulmod against BigInteger.

### P4. How would you parallelize factoring one hard semiprime?
Run several independent rho instances with different random `(c, seed)` concurrently; the first to find a factor wins and cancels the rest. Each attempt is independent (no shared state). Within a single walk the sequence is sequential, so you cannot parallelize one walk — parallelism lives across attempts.

### P5. When is rho the wrong tool, and what replaces it?
For balanced semiprimes with two huge primes (RSA): rho's `√p` is infeasible — use GNFS. For factors in the 20–40 digit range with no small prime: ECM. For numbers that are prime powers: detect and handle perfect powers first. For tiny `n`: trial division is simpler.

### P6. Why are safe primes used in RSA key generation?
A safe prime `p = 2q + 1` (q prime) makes `p − 1 = 2q` non-smooth, defeating Pollard's p−1 (which needs smooth `p − 1`). Combined with large `p` (defeating rho/ECM), this ensures the modulus resists the factor-size-sensitive attacks, leaving only the infeasible GNFS.

### P7. How do rho and p−1 relate as a combined strategy?
They attack orthogonal weaknesses: rho is fast when a factor is *small* (`√p`); p−1 is fast when a factor has *smooth* `p − 1`, regardless of size. A robust factorizer tries a quick p−1 pass (cheap, catches smooth-structure factors) and falls back to rho (always works given restarts) — covering more inputs than either alone.

### P8 (analysis). Why is the birthday bound tight for rho's collision search?
Generic collision finding on a `p`-element set requires `Θ(√p)` queries — the birthday bound is a matching lower bound for black-box collision search. rho's `x² + c` is such a generic pseudo-random map, so `O(√p)` is optimal *within the iterate-and-detect paradigm*. Beating it requires a structurally different method (sieving, elliptic curves, quantum), not a better collision detector.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a brute-force algorithm with a smarter one.
Look for a concrete story: a factoring or number-theory task where trial division (`O(√n)`) was too slow, the insight that a birthday-paradox collision search (`O(n^{1/4})`) applied, the care taken with overflow-safe mulmod, and a measured speedup. Strong answers mention validating against the slow version on small inputs first.

### B2. A teammate's factorizer hangs in production. How do you handle it?
Calmly identify the classic cause: rho was called on a prime (no nontrivial factor → infinite loop) without a Miller-Rabin guard. Show a tiny reproduction, add the primality check as both base case and guard, and add an iteration budget with restarts. Frame it as a missing-invariant fix, not blame.

### B3. Design a feature that needs the prime factorization of many medium-sized integers.
Pipeline: trial-division small-prime strip → Miller-Rabin → perfect-power check → Montgomery rho with Brent+batching → recurse. Discuss throughput (parallel across inputs), correctness (re-multiply to verify), and the size boundary where you escalate to ECM. Mention caching of small-prime sieves and that the per-number memory is `O(1)`.

### B4. How would you explain Pollard's rho to a junior engineer?
Lead with the analogy: the sequence is a pinball bouncing in a finite board, so it must eventually repeat; the birthday paradox makes the repeat (mod a hidden prime) happen after only `√p` bounces; the gcd is a metal detector that beeps the moment two positions differ by a multiple of that prime. Then state the two gotchas first: never run it on a prime, and use a safe mulmod.

### B5. Your factoring job uses more CPU than expected. Investigate.
Check whether mulmod uses a slow 128-bit divide instead of Montgomery (the dominant cost). Verify gcd is batched, not per-step. Confirm small primes are stripped first (else rho wastes time on tiny factors). Check the restart rate — an anomalously high count signals a bad `c`-selection or a mulmod bug forcing repeated failures.

---

## Coding Challenges

### Challenge 1: Pollard's Rho — One Factor

**Problem.** Given a composite `n` (up to 64-bit), return one nontrivial factor using Pollard's rho with an overflow-safe multiply.

**Example.**
```text
n = 8051                  -> 83 or 97
n = 1000000007*1000000009 -> 1000000007 or 1000000009
```

**Constraints.** `n` composite, `2 ≤ n < 2^{63}`.

**Optimal.** Pollard's rho, `O(n^{1/4})` expected.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, r := bits.Div64(hi%m, lo, m)
	return r
}

func gcd(a, b uint64) uint64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func pollardRho(n uint64) uint64 {
	if n%2 == 0 {
		return 2
	}
	for c := uint64(1); ; c++ {
		f := func(x uint64) uint64 { return (mulmod(x, x, n) + c) % n }
		x, y, d := uint64(2), uint64(2), uint64(1)
		for d == 1 {
			x = f(x)
			y = f(f(y))
			diff := x - y
			if y > x {
				diff = y - x
			}
			d = gcd(diff, n)
		}
		if d != n {
			return d
		}
	}
}

func main() {
	fmt.Println(pollardRho(8051))
	fmt.Println(pollardRho(1000000007 * 1000000009))
}
```

**Java.**
```java
import java.math.BigInteger;

public class RhoOne {
    static long mulmod(long a, long b, long m) {
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(m)).longValue();
    }
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    static long pollardRho(long n) {
        if (n % 2 == 0) return 2;
        for (long c = 1; ; c++) {
            long x = 2, y = 2, d = 1;
            while (d == 1) {
                x = (mulmod(x, x, n) + c) % n;
                y = (mulmod(y, y, n) + c) % n;
                y = (mulmod(y, y, n) + c) % n;
                d = gcd(Math.abs(x - y), n);
            }
            if (d != n) return d;
        }
    }

    public static void main(String[] args) {
        System.out.println(pollardRho(8051L));
        System.out.println(pollardRho(1000000007L * 1000000009L));
    }
}
```

**Python.**
```python
from math import gcd


def pollard_rho(n):
    if n % 2 == 0:
        return 2
    c = 1
    while True:
        f = lambda x: (x * x + c) % n
        x, y, d = 2, 2, 1
        while d == 1:
            x = f(x)
            y = f(f(y))
            d = gcd(abs(x - y), n)
        if d != n:
            return d
        c += 1


if __name__ == "__main__":
    print(pollard_rho(8051))
    print(pollard_rho(1000000007 * 1000000009))
```

---

### Challenge 2: Full Factorization with Miller-Rabin

**Problem.** Return the sorted multiset of prime factors of `n` (up to 64-bit), combining trial division, Miller-Rabin, and Pollard's rho.

**Example.**
```text
n = 8051                  -> [83, 97]
n = 360                   -> [2, 2, 2, 3, 3, 5]
n = 1234567891011121314   -> full prime factorization
```

**Constraints.** `1 ≤ n < 2^{63}`.

**Python.**
```python
from math import gcd
from random import randrange


def is_prime(n):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2; s += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def rho(n):
    if n % 2 == 0:
        return 2
    while True:
        c, x = randrange(1, n), randrange(2, n)
        y, d = x, 1
        f = lambda v: (v * v + c) % n
        while d == 1:
            x = f(x); y = f(f(y))
            d = gcd(abs(x - y), n)
        if d != n:
            return d


def factor(n):
    fs = []

    def rec(m):
        if m == 1:
            return
        if is_prime(m):
            fs.append(m); return
        d = rho(m)
        rec(d); rec(m // d)

    for p in range(2, 1000):
        while n % p == 0:
            fs.append(p); n //= p
    rec(n)
    return sorted(fs)


if __name__ == "__main__":
    print(factor(8051))
    print(factor(360))
    print(factor(1234567891011121314))
```

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
	"math/rand"
	"sort"
)

func mulmod(a, b, m uint64) uint64 { hi, lo := bits.Mul64(a, b); _, r := bits.Div64(hi%m, lo, m); return r }
func powmod(a, e, m uint64) uint64 {
	r := uint64(1 % m)
	a %= m
	for e > 0 {
		if e&1 == 1 {
			r = mulmod(r, a, m)
		}
		a = mulmod(a, a, m)
		e >>= 1
	}
	return r
}
func gcd(a, b uint64) uint64 { for b != 0 { a, b = b, a%b }; return a }

func isPrime(n uint64) bool {
	if n < 2 {
		return false
	}
	for _, p := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		if n%p == 0 {
			return n == p
		}
	}
	d, s := n-1, 0
	for d%2 == 0 {
		d /= 2; s++
	}
	for _, a := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		x := powmod(a, d, n)
		if x == 1 || x == n-1 {
			continue
		}
		ok := false
		for i := 0; i < s-1; i++ {
			x = mulmod(x, x, n)
			if x == n-1 {
				ok = true; break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func rho(n uint64) uint64 {
	if n%2 == 0 {
		return 2
	}
	for {
		c := uint64(rand.Int63n(int64(n-1))) + 1
		f := func(v uint64) uint64 { return (mulmod(v, v, n) + c) % n }
		x, y, d := uint64(2), uint64(2), uint64(1)
		for d == 1 {
			x = f(x); y = f(f(y))
			diff := x - y
			if y > x {
				diff = y - x
			}
			d = gcd(diff, n)
		}
		if d != n {
			return d
		}
	}
}

func factor(n uint64) []uint64 {
	var fs []uint64
	var rec func(m uint64)
	rec = func(m uint64) {
		if m == 1 {
			return
		}
		if isPrime(m) {
			fs = append(fs, m); return
		}
		d := rho(m)
		rec(d); rec(m / d)
	}
	for p := uint64(2); p < 1000; p++ {
		for n%p == 0 {
			fs = append(fs, p); n /= p
		}
	}
	rec(n)
	sort.Slice(fs, func(i, j int) bool { return fs[i] < fs[j] })
	return fs
}

func main() {
	fmt.Println(factor(8051))
	fmt.Println(factor(360))
}
```

**Java.**
```java
import java.math.BigInteger;
import java.util.*;

public class FullFactor {
    static long mulmod(long a, long b, long m) {
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b)).mod(BigInteger.valueOf(m)).longValue();
    }
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    static boolean isPrime(long n) {
        if (n < 2) return false;
        for (long p : new long[]{2,3,5,7,11,13,17,19,23,29,31,37}) if (n % p == 0) return n == p;
        long d = n - 1; int s = 0;
        while (d % 2 == 0) { d /= 2; s++; }
        for (long a : new long[]{2,3,5,7,11,13,17,19,23,29,31,37}) {
            long x = BigInteger.valueOf(a).modPow(BigInteger.valueOf(d), BigInteger.valueOf(n)).longValue();
            if (x == 1 || x == n - 1) continue;
            boolean ok = false;
            for (int i = 0; i < s - 1; i++) { x = mulmod(x, x, n); if (x == n - 1) { ok = true; break; } }
            if (!ok) return false;
        }
        return true;
    }

    static long rho(long n) {
        if (n % 2 == 0) return 2;
        Random rnd = new Random();
        while (true) {
            long c = 1 + (Math.abs(rnd.nextLong()) % (n - 1));
            long x = 2, y = 2, d = 1;
            while (d == 1) {
                x = (mulmod(x, x, n) + c) % n;
                y = (mulmod(y, y, n) + c) % n; y = (mulmod(y, y, n) + c) % n;
                d = gcd(Math.abs(x - y), n);
            }
            if (d != n) return d;
        }
    }

    static void rec(long m, List<Long> fs) {
        if (m == 1) return;
        if (isPrime(m)) { fs.add(m); return; }
        long d = rho(m); rec(d, fs); rec(m / d, fs);
    }

    static List<Long> factor(long n) {
        List<Long> fs = new ArrayList<>();
        for (long p = 2; p < 1000; p++) while (n % p == 0) { fs.add(p); n /= p; }
        rec(n, fs); Collections.sort(fs); return fs;
    }

    public static void main(String[] args) {
        System.out.println(factor(8051L));
        System.out.println(factor(360L));
    }
}
```

---

### Challenge 3: Count Divisors of a Big Number

**Problem.** Given `n` (up to 64-bit), compute the number of positive divisors `τ(n)`. If the prime factorization is `n = ∏ pᵢ^{eᵢ}`, then `τ(n) = ∏ (eᵢ + 1)`.

**Example.**
```text
n = 360 = 2^3 · 3^2 · 5  -> (3+1)(2+1)(1+1) = 24
n = 1000000007 (prime)   -> 2
```

**Approach.** Fully factor with rho + Miller-Rabin, count exponents, multiply `(eᵢ + 1)`.

**Python.**
```python
from collections import Counter
# reuse factor() from Challenge 2


def count_divisors(n):
    if n == 1:
        return 1
    exps = Counter(factor(n))
    result = 1
    for e in exps.values():
        result *= e + 1
    return result


if __name__ == "__main__":
    print(count_divisors(360))         # 24
    print(count_divisors(1000000007))  # 2
```

**Go.**
```go
package main

import "fmt"
// reuse factor() from Challenge 2

func countDivisors(n uint64) uint64 {
	if n == 1 {
		return 1
	}
	exps := map[uint64]uint64{}
	for _, p := range factor(n) {
		exps[p]++
	}
	res := uint64(1)
	for _, e := range exps {
		res *= e + 1
	}
	return res
}

func main() {
	fmt.Println(countDivisors(360))        // 24
	fmt.Println(countDivisors(1000000007)) // 2
}
```

**Java.**
```java
import java.util.*;
// reuse factor() from Challenge 2

public class CountDivisors {
    static long countDivisors(long n) {
        if (n == 1) return 1;
        Map<Long, Long> exps = new HashMap<>();
        for (long p : FullFactor.factor(n)) exps.merge(p, 1L, Long::sum);
        long res = 1;
        for (long e : exps.values()) res *= e + 1;
        return res;
    }

    public static void main(String[] args) {
        System.out.println(countDivisors(360L));        // 24
        System.out.println(countDivisors(1000000007L)); // 2
    }
}
```

---

### Challenge 4: Largest Prime Factor

**Problem.** Given `n` (up to 64-bit), return its largest prime factor.

**Example.**
```text
n = 600851475143 -> 6857
n = 8051          -> 97
```

**Approach.** Fully factor with rho + Miller-Rabin; return the maximum.

**Python.**
```python
# reuse factor() from Challenge 2


def largest_prime_factor(n):
    return max(factor(n))


if __name__ == "__main__":
    print(largest_prime_factor(600851475143))  # 6857
    print(largest_prime_factor(8051))          # 97
```

**Go.**
```go
package main

import "fmt"
// reuse factor() from Challenge 2

func largestPrimeFactor(n uint64) uint64 {
	fs := factor(n)
	return fs[len(fs)-1] // factor() returns sorted ascending
}

func main() {
	fmt.Println(largestPrimeFactor(600851475143)) // 6857
	fmt.Println(largestPrimeFactor(8051))         // 97
}
```

**Java.**
```java
import java.util.*;
// reuse factor() from Challenge 2

public class LargestPrimeFactor {
    static long largestPrimeFactor(long n) {
        List<Long> fs = FullFactor.factor(n);
        return fs.get(fs.size() - 1); // sorted ascending
    }

    public static void main(String[] args) {
        System.out.println(largestPrimeFactor(600851475143L)); // 6857
        System.out.println(largestPrimeFactor(8051L));         // 97
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Walk `x ← x² + c (mod n)`; `gcd(|x − y|, n)` reveals a factor when the sequence collides modulo a hidden prime — `O(n^{1/4})` by the birthday paradox."*
- Immediately flag the gotchas: **overflow-safe mulmod**, **never run on a prime**, and **restart on `gcd == n`**.
- For full factorization, reach for the **rho + Miller-Rabin + trial division** recursion, and mention **perfect-power** handling.
- Mention **Pollard's p−1** as the complementary smooth-`p−1` tool, and **safe primes** as the defense.
- Always offer to verify by **re-multiplying the factors to `n`** and re-testing each with Miller-Rabin — a self-certifying check.

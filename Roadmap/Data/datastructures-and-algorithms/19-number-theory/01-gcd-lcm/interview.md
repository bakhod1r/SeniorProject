# GCD and LCM (The Euclidean Algorithm) — Interview Preparation

GCD/LCM is a favourite interview topic because it rewards one crisp insight — *"`gcd(a, b) = gcd(b, a mod b)`, looped until `b = 0`"* — and then tests whether you can (a) explain why it is `O(log min(a, b))`, (b) derive LCM overflow-safely as `a / gcd * b`, (c) extend to arrays, fraction reduction, and coprime-pair counting, and (d) avoid the classic traps (negative remainders, `a*b` overflow, array-LCM blowup). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `gcd(a, b)` | Euclidean loop `a, b = b, a%b` | `O(log min(a, b))` |
| `lcm(a, b)` | `a / gcd(a, b) * b` (divide first) | `O(log min(a, b))` |
| Are `a`, `b` coprime? | `gcd(a, b) == 1` | `O(log)` |
| GCD of an array | fold from `0`, early-exit at `1` | `O(n log max)` |
| LCM of an array | fold from `1` (overflow!) / prime-exponent mod `p` | `O(n log max)` |
| Reduce fraction `a/b` | divide both by `gcd(a, b)` | `O(log)` |
| Bezout `a·x + b·y = g` | extended Euclidean | `O(log)` |
| Modular inverse of `a` mod `m` | extended Euclidean (exists iff `gcd = 1`) | `O(log m)` |
| Count coprime pairs / `gcd = d` queries | sieve / divisor counting + Mobius | varies |

Core algorithm:

```text
gcd(a, b):
    while b != 0:
        a, b = b, a mod b      # remainder strictly decreases
    return abs(a)              # last non-zero value
# O(log min(a, b))

lcm(a, b):
    if a == 0 or b == 0: return 0
    return a / gcd(a, b) * b    # divide before multiply
```

Key facts:
- **`gcd(a, 0) = a`**, `gcd(0, 0) = 0`, `lcm(_, 0) = 0` (conventions).
- **Worst case is consecutive Fibonacci numbers** (Lamé), ~`1.44 log₂ N` steps — still logarithmic.
- **`gcd(a,b) · lcm(a,b) = |a·b|`** — the defining identity.
- **Modular inverse exists iff `gcd(a, m) = 1`** (Bezout).
- In Go/Java the `%` of a negative is negative → `abs` the result.

---

## Junior Questions (12 Q&A)

### J1. What is the greatest common divisor?
The largest integer that divides both `a` and `b` exactly. For `48` and `18` it is `6`. In prime-factor terms it takes the minimum exponent of each shared prime.

### J2. State the Euclidean algorithm.
`gcd(a, b) = gcd(b, a mod b)`, repeated until the second argument is `0`; then `gcd(a, 0) = a`. The last non-zero value is the answer.

### J3. Why does replacing `a` with `a mod b` not change the GCD?
Because every common divisor of `(a, b)` is also a common divisor of `(b, a mod b)` and vice versa — the *set* of common divisors is identical, so the greatest is the same. (`a mod b = a − q·b` is an integer combination of `a` and `b`.)

### J4. What is the time complexity and why?
`O(log min(a, b))`. The remainder more than halves every two steps, so the number of divisions is logarithmic in the smaller input.

### J5. How do you get the LCM from the GCD?
`lcm(a, b) = a / gcd(a, b) * b`. It comes from the identity `gcd·lcm = |a·b|`. Divide *before* multiplying to avoid overflow.

### J6. Why divide before multiplying in LCM?
`a * b` can overflow the integer type even when the LCM itself fits. Since `gcd(a, b)` divides `a` exactly, `a / gcd * b` keeps the intermediate smaller and only overflows if the true answer does.

### J7. What does it mean for two numbers to be coprime?
`gcd(a, b) = 1` — they share no common factor besides `1`. Example: `gcd(17, 5) = 1`.

### J8. What is `gcd(a, 0)`?
`a` (or `|a|`). Every number divides `0`, so the common divisors of `a` and `0` are just the divisors of `a`, the greatest being `a` itself.

### J9. Recursive or iterative — which do you write?
Both are fine; the iterative loop is preferred in production (no stack frames). The recursive one-liner `return a if b == 0 else gcd(b, a % b)` is the clearest statement of the recurrence.

### J10. How do you compute the GCD of a whole array?
Fold the pairwise GCD: `g = 0; for x: g = gcd(g, x)`. Start at `0` because `gcd(0, x) = x`. You can stop early once `g == 1`.

### J11. What happens with negative inputs in Go/Java?
The `%` operator can return a negative remainder, so the loop may return a negative GCD. Normalize by taking `abs` of the inputs or the result. (Python's `%` already gives a non-negative GCD.)

### J12 (analysis). What is the worst-case input for the Euclidean algorithm?
Consecutive **Fibonacci numbers**, e.g. `gcd(F(n+1), F(n))`. Every quotient is `1`, so the algorithm peels off one Fibonacci index per step — the most steps possible for inputs of that size, by Lamé's theorem. It is still `O(log)`.

---

## Middle Questions (12 Q&A)

### M1. Prove `gcd(a, b) = gcd(b, a mod b)`.
Write `a = q·b + r`. If `d | a` and `d | b`, then `d | (a − q·b) = r`, so `d | b` and `d | r`. Conversely if `d | b` and `d | r`, then `d | (q·b + r) = a`. The common divisors coincide, so the greatest does too.

### M2. What is the binary GCD and when is it better?
Stein's algorithm: pull out shared factors of two, then use shifts and subtraction (no division). It is `O(log² max)` bit-ops and wins where division is expensive — big integers and some hardware. On modern CPUs with cheap division, the mod-based Euclidean algorithm is usually as fast.

### M3. How do you reduce a fraction to lowest terms?
Divide numerator and denominator by their GCD: `g = gcd(|a|, |b|); (a/g, b/g)`. Push the sign onto the numerator and keep the denominator positive. The result is coprime by construction.

### M4. Why does a modular inverse of `a` mod `m` exist exactly when `gcd(a, m) = 1`?
By Bezout, `gcd(a, m) = 1` gives `a·x + m·y = 1`, so `a·x ≡ 1 (mod m)` — `x` is the inverse. If `gcd(a, m) = g > 1`, then `a·x` is always a multiple of `g`, so it can never be `≡ 1`.

### M5. How do you compute LCM of an array without overflowing?
Fold pairwise with `a / gcd * b`, but the value grows fast — use big integers for an exact result. For LCM **modulo `p`**, take the **maximum prime exponent** of each prime across all numbers and multiply `prime^maxexp mod p`; you cannot divide by a GCD under a modulus.

### M6. What is Bezout's identity?
For `a, b` not both zero, there exist integers `x, y` with `a·x + b·y = gcd(a, b)`, and `gcd(a, b)` is the smallest positive value of `a·x + b·y`. The extended Euclidean algorithm computes `x, y`.

### M7. When does a linear Diophantine equation `a·x + b·y = c` have solutions?
Exactly when `gcd(a, b)` divides `c`. Every value of `a·x + b·y` is a multiple of `gcd(a, b)`, so `gcd | c` is necessary and (by scaling a Bezout solution) sufficient.

### M8. What is the distributive property of GCD?
`gcd(c·a, c·b) = c · gcd(a, b)` for `c ≥ 0`. Useful for factoring out a common scale before computing.

### M9. How do you handle `gcd(0, 0)` and other zero edge cases?
By convention `gcd(0, 0) = 0`, `gcd(a, 0) = a`, `lcm(_, 0) = 0`. Standard libraries follow these; document them so callers don't expect exceptions.

### M10. Why not use plain subtraction (`gcd(a, b) = gcd(a − b, b)`)?
It is `O(max(a, b))` in the worst case — `gcd(10^9, 1)` would subtract a billion times. Always use the mod-based step or binary GCD.

### M11. How do you count integers in `[1, n]` coprime to `n`?
That is Euler's totient `φ(n) = n · ∏(1 − 1/p)` over distinct primes `p | n`. It counts the `a` with `gcd(a, n) = 1` and is computed from `n`'s factorization, not by testing each GCD.

### M12 (analysis). Express the exact worst-case iteration count.
Since `F_k ∼ φ^k / √5` with `φ ≈ 1.618`, the Euclidean algorithm on inputs `≤ N` takes at most about `1.4404 · log₂ N` divisions (Lamé), achieved by consecutive Fibonacci numbers.

---

## Senior Questions (10 Q&A)

### S1. How does GCD cost change for big integers?
Each step's `a mod b` costs a big-integer division `O(M(n))`, and there are `O(n)` steps, so naive GCD is `O(n · M(n))`. Production libraries switch to Lehmer's algorithm (run Euclid on leading words, batch via a `2×2` matrix) and subquadratic half-GCD `O(M(n) log n)` above a threshold.

### S2. When and why is constant-time GCD needed?
When one operand is **secret** (e.g., computing a modular inverse of secret key material). A variable-time GCD branches on the data, leaking bits through timing. Cryptographic libraries use constant-time routines (Bernstein-Yang "safegcd") with a fixed iteration count and branchless inner ops.

### S3. Where does GCD show up in cryptography?
RSA key generation requires `gcd(e, φ(n)) = 1` and computes `d = e⁻¹ mod φ(n)` via extended GCD; ECC and blinding need inverses too. Also, `gcd(n₁, n₂) > 1` across many RSA moduli reveals shared primes — a real key-recovery attack against weak RNGs.

### S4. How do you compute the LCM of an array modulo a prime?
Merge prime-factor exponents: take the maximum exponent of each prime across all numbers, then `∏ prime^maxexp mod p` using modular exponentiation. Naive `running / gcd * x mod p` is wrong — division under a modulus needs an inverse, and the running LCM mod `p` loses GCD information.

### S5. How do you support a sliding-window GCD?
GCD has no inverse, so you cannot "remove" an element. Use a sparse table for static arrays (`O(1)` range GCD after `O(n log n)` build) or a two-stack / segment-tree structure for a moving window with `O(log)` updates.

### S6. Euclidean vs binary GCD — your default and why?
Mod-based Euclidean for machine integers (hardware division is pipelined and cheap, fewer iterations). Binary GCD (ctz-optimized to remove the strip-loops) for big integers and division-poor targets, where avoiding division dominates.

### S7. How do you avoid overflow in LCM at scale?
Divide first (`a / gcd * b`); add an overflow-checked multiply that detects wraparound (`res / b != q`) and returns an error; escalate to `__int128` / big integers, or compute modulo `p` via prime exponents. Never silently wrap.

### S8. What is the `INT_MIN` trap in GCD?
`abs(-2^63)` overflows (no positive counterpart in two's complement). Hand-rolled GCDs that `abs` the input crash or misbehave on the single most-negative value. Use unsigned/wider types or special-case it.

### S9. How is GCD related to the Chinese Remainder Theorem?
CRT requires the moduli to be pairwise coprime (`gcd = 1`), and the reconstruction uses modular inverses built by extended GCD. For non-coprime moduli, the system is solvable iff the congruences agree on the GCDs — again a GCD condition.

### S10 (analysis). Why is the GCD the generator of the ideal `aℤ + bℤ`?
`aℤ + bℤ = { a·x + b·y }` is an ideal of `ℤ`, and `ℤ` is a principal ideal domain, so this ideal equals `dℤ` for some `d`; that `d` is the smallest positive combination of `a, b`, which is exactly `gcd(a, b)` by Bezout. This is the structural reason Bezout's identity holds.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a subtle integer bug you fixed.
Look for a concrete story: an LCM computed as `a * b / gcd` that overflowed to a negative number in production, the symptom (a wrong "schedule period" or a negative denominator), the fix (divide-first ordering plus an overflow check), and the regression test added on boundary inputs.

### B2. A teammate's fraction class returns wrong signs. How do you debug it?
Reproduce with `reduce(48, -18)`. Explain that the GCD should be taken on absolute values and the sign pushed onto the numerator with a positive denominator. In Go/Java the negative-remainder `%` is the usual culprit. Add property tests asserting the denominator is always positive and the fraction equals the original.

### B3. Design a feature that aligns several periodic jobs.
This is an LCM: jobs with periods `p₁, …, p_k` realign every `lcm(p₁, …, p_k)` ticks. Discuss overflow (the LCM grows fast — big integers or a sanity cap), the coprime case (LCM = product = worst case), and using the GCD to detect jobs that never drift apart.

### B4. How would you explain the Euclidean algorithm to a junior?
Use the tiling analogy: the GCD of `48 × 18` is the largest square tile that perfectly covers the floor. Lay the biggest squares along the short side, repeat on the leftover strip; the last perfect square is the GCD. Then connect it to `a, b = b, a mod b`. Lead with the two gotchas: divide-first LCM and negative remainders.

### B5. Your number-theory service is slow on huge inputs. How do you investigate?
Profile: if inputs are big integers, the cost is big-integer division — confirm the library uses Lehmer/half-GCD, not a naive loop. Check you aren't using subtractive GCD anywhere. For repeated GCDs over a fixed set, consider precomputation; for array LCMs, ensure prime-exponent reduction instead of overflow-prone folding.

---

## Coding Challenges

### Challenge 1: GCD and LCM of Two Numbers

**Problem.** Given non-negative integers `a` and `b`, return `gcd(a, b)` and `lcm(a, b)`. Handle zeros (`gcd(0,0)=0`, `lcm(_,0)=0`) and avoid overflow in the LCM.

**Example.**
```text
a = 48, b = 18  ->  gcd = 6,  lcm = 144
a = 0,  b = 9   ->  gcd = 9,  lcm = 0
a = 17, b = 5   ->  gcd = 1,  lcm = 85
```

**Constraints.** `0 ≤ a, b ≤ 10^9` (so LCM fits in 64-bit).

**Optimal.** Euclidean GCD `O(log min(a,b))`; LCM via `a / gcd * b`.

**Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

func lcm(a, b int64) int64 {
	if a == 0 || b == 0 {
		return 0
	}
	return a / gcd(a, b) * b
}

func main() {
	fmt.Println(gcd(48, 18), lcm(48, 18)) // 6 144
	fmt.Println(gcd(0, 9), lcm(0, 9))     // 9 0
	fmt.Println(gcd(17, 5), lcm(17, 5))   // 1 85
}
```

**Java.**
```java
public class GcdLcm {
    static long gcd(long a, long b) {
        while (b != 0) {
            long t = a % b;
            a = b;
            b = t;
        }
        return Math.abs(a);
    }

    static long lcm(long a, long b) {
        if (a == 0 || b == 0) return 0;
        return a / gcd(a, b) * b;
    }

    public static void main(String[] args) {
        System.out.println(gcd(48, 18) + " " + lcm(48, 18)); // 6 144
        System.out.println(gcd(0, 9) + " " + lcm(0, 9));     // 9 0
        System.out.println(gcd(17, 5) + " " + lcm(17, 5));   // 1 85
    }
}
```

**Python.**
```python
def gcd(a, b):
    while b:
        a, b = b, a % b
    return abs(a)


def lcm(a, b):
    if a == 0 or b == 0:
        return 0
    return a // gcd(a, b) * b


if __name__ == "__main__":
    print(gcd(48, 18), lcm(48, 18))  # 6 144
    print(gcd(0, 9), lcm(0, 9))      # 9 0
    print(gcd(17, 5), lcm(17, 5))    # 1 85
```

---

### Challenge 2: GCD and LCM of an Array

**Problem.** Given an array of positive integers, return the GCD of all of them and the LCM of all of them modulo `10^9 + 7`. The exact LCM may be astronomically large.

**Example.**
```text
[12, 18, 24]  ->  gcd = 6,  lcm = 72
[4, 6, 10]    ->  gcd = 2,  lcm = 60
```

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ a_i ≤ 10^6`.

**Approach.** GCD: fold from `0` with early exit at `1`. LCM mod `p`: merge **max prime exponents** (factorize each `a_i` with a smallest-prime-factor sieve), then power and multiply mod `p`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007
const MAXV = 1_000_001

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func powMod(base, exp int64) int64 {
	res := int64(1)
	base %= MOD
	for exp > 0 {
		if exp&1 == 1 {
			res = res * base % MOD
		}
		base = base * base % MOD
		exp >>= 1
	}
	return res
}

func main() {
	nums := []int64{12, 18, 24}

	// smallest prime factor sieve
	spf := make([]int, MAXV)
	for i := 2; i < MAXV; i++ {
		if spf[i] == 0 {
			for j := i; j < MAXV; j += i {
				if spf[j] == 0 {
					spf[j] = i
				}
			}
		}
	}

	g := int64(0)
	maxExp := map[int]int{}
	for _, x := range nums {
		g = gcd(g, x)
		v := int(x)
		for v > 1 {
			p := spf[v]
			e := 0
			for v%p == 0 {
				v /= p
				e++
			}
			if e > maxExp[p] {
				maxExp[p] = e
			}
		}
	}

	lcm := int64(1)
	for p, e := range maxExp {
		lcm = lcm * powMod(int64(p), int64(e)) % MOD
	}
	fmt.Println(g, lcm) // 6 72
}
```

**Java.**
```java
import java.util.*;

public class ArrayGcdLcm {
    static final long MOD = 1_000_000_007L;
    static final int MAXV = 1_000_001;

    static long gcd(long a, long b) {
        while (b != 0) { long t = a % b; a = b; b = t; }
        return a;
    }

    static long powMod(long base, long exp) {
        long res = 1; base %= MOD;
        while (exp > 0) {
            if ((exp & 1) == 1) res = res * base % MOD;
            base = base * base % MOD;
            exp >>= 1;
        }
        return res;
    }

    public static void main(String[] args) {
        long[] nums = {12, 18, 24};
        int[] spf = new int[MAXV];
        for (int i = 2; i < MAXV; i++)
            if (spf[i] == 0)
                for (int j = i; j < MAXV; j += i)
                    if (spf[j] == 0) spf[j] = i;

        long g = 0;
        Map<Integer, Integer> maxExp = new HashMap<>();
        for (long x : nums) {
            g = gcd(g, x);
            int v = (int) x;
            while (v > 1) {
                int p = spf[v], e = 0;
                while (v % p == 0) { v /= p; e++; }
                maxExp.merge(p, e, Math::max);
            }
        }
        long lcm = 1;
        for (Map.Entry<Integer, Integer> en : maxExp.entrySet())
            lcm = lcm * powMod(en.getKey(), en.getValue()) % MOD;
        System.out.println(g + " " + lcm); // 6 72
    }
}
```

**Python.**
```python
from math import gcd
from functools import reduce

MOD = 10**9 + 7


def factorize(x):
    f = {}
    d = 2
    while d * d <= x:
        while x % d == 0:
            f[d] = f.get(d, 0) + 1
            x //= d
        d += 1
    if x > 1:
        f[x] = f.get(x, 0) + 1
    return f


def solve(nums):
    g = reduce(gcd, nums, 0)
    max_exp = {}
    for x in nums:
        for p, e in factorize(x).items():
            if e > max_exp.get(p, 0):
                max_exp[p] = e
    lcm = 1
    for p, e in max_exp.items():
        lcm = lcm * pow(p, e, MOD) % MOD
    return g, lcm


if __name__ == "__main__":
    print(solve([12, 18, 24]))  # (6, 72)
    print(solve([4, 6, 10]))    # (2, 60)
```

---

### Challenge 3: Reduce a Fraction to Lowest Terms

**Problem.** Given a fraction `a/b` (with `b != 0`, possibly negative), return it in lowest terms with a positive denominator.

**Example.**
```text
48 / -18  ->  -8 / 3
6 / 4     ->   3 / 2
0 / 5     ->   0 / 1
```

**Constraints.** `|a|, |b| ≤ 10^18`, `b != 0`.

**Approach.** `g = gcd(|a|, |b|)`; divide both by `g`; if the denominator is negative, flip both signs.

**Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	if a < 0 {
		a = -a
	}
	if b < 0 {
		b = -b
	}
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func reduceFraction(a, b int64) (int64, int64) {
	if b == 0 {
		panic("zero denominator")
	}
	g := gcd(a, b)
	a, b = a/g, b/g
	if b < 0 {
		a, b = -a, -b
	}
	return a, b
}

func main() {
	fmt.Println(reduceFraction(48, -18)) // -8 3
	fmt.Println(reduceFraction(6, 4))    // 3 2
	fmt.Println(reduceFraction(0, 5))    // 0 1
}
```

**Java.**
```java
public class ReduceFraction {
    static long gcd(long a, long b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b != 0) { long t = a % b; a = b; b = t; }
        return a;
    }

    static long[] reduce(long a, long b) {
        if (b == 0) throw new ArithmeticException("zero denominator");
        long g = gcd(a, b);
        a /= g; b /= g;
        if (b < 0) { a = -a; b = -b; }
        return new long[]{a, b};
    }

    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(reduce(48, -18))); // [-8, 3]
        System.out.println(java.util.Arrays.toString(reduce(6, 4)));    // [3, 2]
        System.out.println(java.util.Arrays.toString(reduce(0, 5)));    // [0, 1]
    }
}
```

**Python.**
```python
from math import gcd


def reduce_fraction(a, b):
    if b == 0:
        raise ValueError("zero denominator")
    g = gcd(abs(a), abs(b)) or 1   # gcd(0,0) guard for a==0
    a, b = a // g, b // g
    if b < 0:
        a, b = -a, -b
    return a, b


if __name__ == "__main__":
    print(reduce_fraction(48, -18))  # (-8, 3)
    print(reduce_fraction(6, 4))     # (3, 2)
    print(reduce_fraction(0, 5))     # (0, 1)
```

---

### Challenge 4: Count Coprime Pairs

**Problem.** Given an array of `n` positive integers, count the number of unordered pairs `(i, j)`, `i < j`, with `gcd(a_i, a_j) = 1`.

**Example.**
```text
[1, 2, 3, 4]  ->  5    pairs: (1,2)(1,3)(1,4)(2,3)(3,4)
```

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ a_i ≤ 10^5`.

**Approach.** Brute force is `O(n²)`. The efficient method counts, via Mobius inversion over divisors, the pairs with `gcd` a multiple of each `d`, then inverts: let `cnt[d]` be how many `a_i` are divisible by `d`, and `f(d) = C(cnt[d], 2)` the pairs whose gcd is a multiple of `d`; then coprime pairs `= Σ_d μ(d) · f(d)`.

**Python.**
```python
from math import gcd


def count_coprime_brute(arr):
    n = len(arr)
    cnt = 0
    for i in range(n):
        for j in range(i + 1, n):
            if gcd(arr[i], arr[j]) == 1:
                cnt += 1
    return cnt


def count_coprime_mobius(arr):
    M = max(arr)
    # mobius sieve
    mu = [0] * (M + 1)
    mu[1] = 1
    primes = []
    is_comp = [False] * (M + 1)
    for i in range(2, M + 1):
        if not is_comp[i]:
            primes.append(i)
            mu[i] = -1
        for p in primes:
            if i * p > M:
                break
            is_comp[i * p] = True
            if i % p == 0:
                mu[i * p] = 0
                break
            mu[i * p] = -mu[i]
    # cnt[d] = how many a_i divisible by d
    freq = [0] * (M + 1)
    for x in arr:
        freq[x] += 1
    cnt = [0] * (M + 1)
    for d in range(1, M + 1):
        for m in range(d, M + 1, d):
            cnt[d] += freq[m]
    total = 0
    for d in range(1, M + 1):
        if mu[d]:
            c = cnt[d]
            total += mu[d] * (c * (c - 1) // 2)
    return total


if __name__ == "__main__":
    a = [1, 2, 3, 4]
    print(count_coprime_brute(a))   # 5
    print(count_coprime_mobius(a))  # 5
```

**Go.**
```go
package main

import "fmt"

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// brute force O(n^2) — clear and correct for small n
func countCoprimeBrute(arr []int) int64 {
	cnt := int64(0)
	for i := 0; i < len(arr); i++ {
		for j := i + 1; j < len(arr); j++ {
			if gcd(arr[i], arr[j]) == 1 {
				cnt++
			}
		}
	}
	return cnt
}

func main() {
	fmt.Println(countCoprimeBrute([]int{1, 2, 3, 4})) // 5
}
```

**Java.**
```java
public class CoprimePairs {
    static int gcd(int a, int b) {
        while (b != 0) { int t = a % b; a = b; b = t; }
        return a;
    }

    static long countCoprimeBrute(int[] arr) {
        long cnt = 0;
        for (int i = 0; i < arr.length; i++)
            for (int j = i + 1; j < arr.length; j++)
                if (gcd(arr[i], arr[j]) == 1) cnt++;
        return cnt;
    }

    public static void main(String[] args) {
        System.out.println(countCoprimeBrute(new int[]{1, 2, 3, 4})); // 5
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"`gcd(a, b) = gcd(b, a mod b)` until `b = 0`; it is `O(log min(a, b))`, and `lcm = a / gcd * b`."*
- Immediately flag the two gotchas: **divide-first LCM** (avoid `a*b` overflow) and **negative remainders** in Go/Java (`abs` the result).
- For array LCM modulo `p`, reach for **max prime exponents**, never division under a modulus.
- For "does an inverse / Diophantine solution exist?", state the **`gcd` condition** (`= 1` for inverse, `gcd | c` for `a·x + b·y = c`) and mention the **extended Euclidean** algorithm constructs it (sibling `06`).
- Name the **Fibonacci worst case** (Lamé) when asked about complexity — it shows depth.
- Always offer to verify with a brute-force check (list-divisors GCD, or `O(n²)` coprime-pair count) on small inputs.
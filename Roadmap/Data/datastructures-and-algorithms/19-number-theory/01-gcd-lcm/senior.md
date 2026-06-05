# GCD and LCM (The Euclidean Algorithm) — Senior Level

> GCD is rarely the bottleneck — until it runs on thousand-bit big integers inside a cryptographic key-generation loop, or inside a tight modular-arithmetic kernel called billions of times, or on adversarial inputs designed to maximize iterations. At that point overflow, sign handling, division cost, constant-time guarantees, and the binary-vs-Euclid choice all become correctness or performance incidents.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Big Integers and the Cost Model](#2-big-integers-and-the-cost-model)
3. [Overflow, Signs, and Zero in Production](#3-overflow-signs-and-zero-in-production)
4. [Binary GCD vs Euclid: Performance Engineering](#4-binary-gcd-vs-euclid-performance-engineering)
5. [GCD in Cryptographic Contexts](#5-gcd-in-cryptographic-contexts)
6. [Array and Streaming GCD/LCM at Scale](#6-array-and-streaming-gcdlcm-at-scale)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does `gcd(a, b) = gcd(b, a mod b)` work" but "what system am I embedding this in, and what breaks at scale?". GCD/LCM shows up in three production guises that share one tiny engine:

1. **Modular-arithmetic kernels** — GCD is the existence test and (via the extended form) the constructor for modular inverses, called inside CRT, rational reconstruction, and finite-field arithmetic at very high frequency.
2. **Cryptographic primitives** — RSA key generation needs `gcd(e, φ(n)) = 1`; the *binary* GCD and its constant-time variants matter because a data-dependent branch count can leak secret bits through timing.
3. **Exact rational / symbolic computation** — fraction reduction and array LCM on big integers, where the cost of each division is no longer `O(1)` and the algorithm choice changes the asymptotics.

All three reduce to: *compute `gcd(a, b)` (and sometimes the Bezout coefficients) correctly, without overflow, fast enough, and — in the crypto case — without leaking timing*. The senior decisions are: which GCD variant, what integer type, how to handle sign/zero, how to verify, and whether constant-time is required.

This document treats those decisions in production terms.

---

## 2. Big Integers and the Cost Model

### 2.1 The machine-int cost model is a lie for crypto sizes

On fixed-width integers, each Euclidean step is `O(1)` and the whole GCD is `O(log min(a,b))` — a few dozen steps at most. But for `n`-bit big integers the division `a mod b` itself costs `O(M(n))` where `M(n)` is the multiplication cost (schoolbook `O(n²)`, or `O(n log n)` with FFT). With `O(n)` Euclidean steps, naive big-integer GCD is `O(n · M(n))` = `O(n³)` schoolbook. This is why large-integer GCD is a genuine performance topic, not a triviality.

### 2.2 Subquadratic GCD

For very large integers, the **half-GCD (HGCD)** / Lehmer-style and Stehlé-Zimmermann algorithms compute GCD in `O(M(n) log n)` — quasi-linear — by working on the high-order words to batch many Euclidean steps into one big-integer multiply. Production big-number libraries (GMP, Java `BigInteger` for large operands) switch to these above a threshold. As a senior, you should know the threshold exists and that below it the simple algorithm wins; do not hand-roll HGCD unless you have measured a need.

### 2.3 Lehmer's GCD: the practical middle ground

Lehmer's algorithm speeds up big-integer GCD without full HGCD: it runs the Euclidean algorithm on the **leading digits** (single machine words) to compute a sequence of quotients, accumulates them into a small `2×2` transformation matrix, and applies that matrix to the full big integers in one batch. This replaces many expensive big-integer divisions with a few cheap machine-word operations plus one big-integer multiply. It is the workhorse inside many `BigInteger.gcd` implementations.

### 2.4 Rational reconstruction: the extended GCD as a production tool

A subtle but high-value senior use of the *extended* Euclidean algorithm is **rational reconstruction**: given a residue `r` modulo `m`, recover the unique fraction `p/q` with small `|p|, |q|` such that `p ≡ r·q (mod m)`. The trick is to run the extended Euclidean algorithm on `(m, r)` and stop early — when the remainder drops below `√(m/2)`, the current remainder and coefficient give `(p, q)`. This is the engine behind:

- **Exact linear-algebra over `ℚ`** done modulo a prime then lifted back to fractions (modular Gaussian elimination), avoiding intermediate-expression swell.
- **Computer-algebra systems** reconstructing rational answers from modular computations.
- **CRT-based exact rational outputs**, where the result is computed mod several primes and reconstructed.

It is the same Euclidean machinery, run partially rather than to completion — a reminder that the *sequence of remainders and coefficients*, not just the final GCD, carries useful information. Mishandling the stopping bound is the usual bug (reconstructing the wrong fraction), so test against known rationals.

---

## 3. Overflow, Signs, and Zero in Production

### 3.1 The LCM overflow budget

`lcm(a, b) = a / gcd(a, b) * b`. The largest intermediate is the LCM itself. On signed 64-bit, the LCM overflows once it exceeds `~9.2 · 10^18`. For two inputs near `10^9` whose GCD is `1`, the LCM is `~10^18` — already at the edge. **Always** check whether the result can fit, and if the spec guarantees it can, document that guarantee. If it cannot, escalate to `unsigned`, `__int128` / `BigInteger`, or compute modulo a prime via prime-exponent merging.

### 3.2 Sign semantics

Mathematically `gcd` is defined on non-negative integers and `gcd(a, b) = gcd(|a|, |b|) ≥ 0`. But language `%` operators disagree on sign:

- **Python:** `-7 % 3 == 2` (result has the sign of the divisor). The Euclidean loop naturally yields a non-negative GCD.
- **Go / Java / C:** `-7 % 3 == -1` (result has the sign of the dividend). The loop can return a **negative** GCD; normalize with `abs` at the end.

The robust pattern: take `abs` of both inputs at entry, run the loop on non-negatives, and you sidestep all sign surprises. For fractions, push the sign to the numerator and keep the denominator positive.

### 3.3 Zero handling, codified

```
gcd(a, 0) = |a|        gcd(0, 0) = 0        lcm(a, 0) = 0 (by convention)
```

`gcd(0, 0) = 0` is the standard (and the value returned by Python `math.gcd`, C++ `std::gcd`, Java `BigInteger.gcd`). Treat these as documented conventions, not edge-case bugs. A surprising number of production incidents trace to a caller assuming `gcd(0, 0)` throws.

### 3.4 `INT_MIN` / most-negative value

`abs(INT_MIN)` overflows (there is no positive counterpart in two's complement). `gcd(INT_MIN, x)` therefore needs care: work in a wider unsigned type, or special-case the most-negative input. This is a classic latent bug in hand-rolled C/Go/Java GCD that only fires on the single value `-2^63`.

### 3.5 A worked overflow incident

Consider `lcm(1_000_000_000, 999_999_999)` in signed 64-bit. The two are coprime, so the true LCM is their product `≈ 9.9999 · 10^17` — which *fits* in `int64` (max `≈ 9.22 · 10^18`). But the naive `a * b / gcd` first computes `a * b = 9.9999 · 10^17`... still fits here. Now scale up: `lcm(3_000_000_000, 2_999_999_999)` (using `uint64`) has true LCM `≈ 9 · 10^18`, near the `uint64` edge, while `a * b ≈ 9 · 10^18` also nearly overflows — and `lcm(4·10^9, 4·10^9 − 1)` has `a*b ≈ 1.6 · 10^19 > 2^63` (signed overflow) even though the divide-first `a / gcd * b` keeps the intermediate at the LCM value itself. The fix is both divide-first *and* an explicit overflow check (Section 7.1): compute `q = a / g`, `res = q * b`, and verify `res / b == q`. Silent wraparound here produced a *negative* "period" in a real scheduler — caught only because a downstream assertion required positivity.

---

## 4. Binary GCD vs Euclid: Performance Engineering

### 4.1 The real trade-off

| Variant | Per step | Steps | Wins when |
|---------|----------|-------|-----------|
| Euclidean (mod) | one division | `O(log)` | division is cheap (modern CPUs) |
| Binary (Stein) | shifts + subtract | `O(log)` (more steps) | division is expensive (big ints, embedded) |
| Subtractive | subtract | `O(max)` | never — `O(max)` blowup |

On a current x86/ARM core, integer division of two `64`-bit values takes ~20–40 cycles while a shift takes 1; but binary GCD does *more* iterations and more branches. In practice they are close, and the mod-based Euclidean algorithm is often marginally faster for machine words because hardware division is pipelined. **Binary GCD's decisive win is on big integers**, where it avoids the costly big-integer division entirely, replacing it with cheap shifts and subtractions.

### 4.2 Branch prediction and the inner loops

Binary GCD has data-dependent inner `while` loops (strip factors of two) whose trip count varies with the inputs. On a hot path this is a branch-prediction concern; count-trailing-zeros (`__builtin_ctz`, `bits.TrailingZeros`, `Long.numberOfTrailingZeros`) replaces the strip-loop with a single instruction, which is the standard optimization and removes the unpredictable branch.

### 4.3 The `ctz`-optimized binary GCD

Using a hardware "count trailing zeros" instruction turns each "strip the factors of two" loop into one instruction, making binary GCD both faster and more branch-predictable. This is the form you want in any performance-sensitive implementation (see Section 7).

### 4.4 Representative measurements

Rough relative costs (order-of-magnitude, hardware-dependent) for a single GCD:

| Operand width | Euclidean (mod) | Binary (ctz) | Library (Lehmer/HGCD) |
|---------------|-----------------|--------------|------------------------|
| 64-bit | ~1× (baseline) | ~1.0–1.3× | n/a (no benefit) |
| 256-bit big int | ~3× baseline | ~1.5× baseline | ~1.2× baseline |
| 4096-bit big int | ~50× baseline | ~20× baseline | ~5× baseline |

The pattern: at machine-word sizes the variants are within a small constant of each other and the schoolbook loop is fine; as operands grow, division dominates and binary GCD's division-avoidance pulls ahead, but the library's quasi-linear Lehmer/HGCD ultimately wins because it batches whole runs of Euclidean steps. The actionable rule: **do not hand-roll big-integer GCD** — call the library, which already crosses over to the right algorithm by operand size. Hand-rolling matters only for machine-word GCD in a hot kernel, where the mod-based loop is the safe default.

---

## 5. GCD in Cryptographic Contexts

### 5.1 Where GCD appears in RSA and friends

- **Key generation:** choose public exponent `e` (often `65537`) and require `gcd(e, φ(n)) = 1` so that `e` has an inverse modulo `φ(n)` (the private exponent `d = e⁻¹ mod φ(n)`). The extended GCD computes `d`.
- **Modular inverses everywhere:** point arithmetic in ECC, blinding factors, CRT-based RSA decryption — all need inverses, all gated by `gcd = 1` and built by the extended algorithm.
- **A famous attack surface:** if two RSA moduli `n₁, n₂` share a prime factor, `gcd(n₁, n₂)` reveals it instantly — the basis of large-scale "mining your Ps and Qs" key-recovery against poorly-seeded RNGs. GCD is both a tool and a weapon here.

### 5.2 Timing side channels and constant-time GCD

The ordinary Euclidean and binary GCDs **branch on the data** — the number of iterations depends on the secret operands. In a context where one operand is secret (e.g., computing a modular inverse of a secret value), the *running time* can leak information about that secret. Cryptographic libraries therefore use **constant-time** GCD / modular-inverse routines (e.g., the Bernstein-Yang "safegcd" algorithm) that perform a fixed number of iterations with branchless, constant-time inner operations regardless of input. As a senior touching crypto code, the rule is: **never** drop a textbook variable-time GCD into a path that processes secret key material; use the library's constant-time inverse.

### 5.3 Don't roll your own where it matters

For non-secret data (e.g., reducing a public fraction), the textbook GCD is perfectly fine. For secret data, use a vetted constant-time primitive. The cost of a constant-time GCD is a fixed (slightly higher) iteration count; the benefit is no timing leak. Confusing the two contexts is a real vulnerability class.

### 5.4 The shared-prime attack, concretely

Suppose a faulty RNG generates two RSA moduli that, by accident, share a prime: `n₁ = p·q₁` and `n₂ = p·q₂`. Neither modulus is individually factorable, but

```
gcd(n₁, n₂) = p
```

recovers the shared prime `p` in `O(log n)`, and then `q₁ = n₁ / p`, `q₂ = n₂ / p` fully factor both keys — breaking RSA for both. At internet scale, computing the pairwise GCD of millions of collected moduli (efficiently, via a product-tree GCD rather than `O(N²)` pairs) found tens of thousands of compromised keys in the 2012 "Ron was wrong, Heninger et al." studies. The lesson for a senior: GCD is cheap enough to run across an entire key corpus, so **shared-factor weakness is not hypothetical** — it is a routinely-exploited consequence of poor entropy at key-generation time. The defense lives in the RNG, but GCD is what exposes the flaw.

### 5.5 Why `gcd(e, φ(n)) = 1` is required

RSA's public exponent `e` must be invertible modulo `φ(n)` to derive the private exponent `d = e⁻¹ mod φ(n)`. By the existence theorem (an inverse exists iff `gcd = 1`), key generation *must* check `gcd(e, φ(n)) = 1`; if it fails, either `e` or the primes are re-rolled. The common choice `e = 65537` (a Fermat prime) is convenient precisely because it is prime, so `gcd(65537, φ(n)) ≠ 1` only in the rare case that `65537 | φ(n)` — a cheap GCD check catches it. This is a direct, daily-use application of the Bezout/existence theory from `professional.md`.

---

## 6. Array and Streaming GCD/LCM at Scale

### 6.1 Array GCD is cheap and parallelizable

The array GCD is an **associative, commutative fold** with identity `0`, so it parallelizes trivially: split the array, GCD each chunk, GCD the chunk results. Because the running GCD only shrinks and bottoms out at `1`, an early exit on `1` is a large practical win for arrays that quickly become coprime. There is no overflow risk — the GCD never exceeds `max(|x|)`.

### 6.2 Array LCM is dangerous

The array LCM is also an associative fold (identity `1`), but it **grows multiplicatively** and overflows fixed-width integers within a handful of elements. Three production strategies:

- **Big integers** when an exact value is required and it is not astronomically large.
- **LCM modulo `p`** via prime-factor exponent merging: take the **max exponent** of each prime across all inputs, then `∏ prime^maxexp mod p`. This is the *only* correct way under a modulus — you cannot divide by a GCD modulo `p`.
- **Detect overflow and fail loudly** if the spec promised the result fits but the data violates it.

### 6.3 Streaming and incremental updates

GCD supports incremental updates cleanly: `gcd_so_far = gcd(gcd_so_far, new_value)`. Removing an element is *not* supported (GCD has no inverse), so a sliding-window GCD needs a sparse-table / segment-tree structure for `O(log)` range queries, or a two-stack trick for a moving window. This is a common interview-to-production escalation: "GCD of every window of size `w`".

### 6.4 Range GCD with a sparse table

Because GCD is **idempotent** (`gcd(x, x) = x`), overlapping ranges are safe to combine, which is exactly the precondition for a sparse table. Precompute `sp[k][i] = gcd` of the block of length `2^k` starting at `i` in `O(n log n)`; answer a range query `(l, r)` in `O(1)` as `gcd(sp[k][l], sp[k][r − 2^k + 1])` with `k = ⌊log₂(r − l + 1)⌋`. The two blocks may overlap — harmless for GCD, unlike for sum. This is the right structure for "many range-GCD queries on a static array", a frequent production need (e.g., "is this subarray's GCD greater than 1?" for batch divisibility checks). For a *mutable* array, use a segment tree (`O(log n)` per query and update); for a *sliding window*, the two-stack deque gives amortized `O(1)`.

### 6.5 Distributed array GCD

At very large scale, the array GCD's associativity makes it a textbook map-reduce: each worker GCD-folds its shard (with the early-exit-at-`1` optimization), and a final reducer GCDs the per-shard results. No data movement beyond the per-shard scalars, and the early exit means a single coprime pair anywhere short-circuits that shard to `1`. The array LCM map-reduces the same way *structurally*, but each combine must use big integers or prime-exponent merging, and there is no early exit (the value only grows) — so the LCM reducer is the bottleneck and should merge prime-exponent maps (small, bounded by the prime count up to `max`) rather than ever materialize the full LCM.

---

## 6b. Period, Cycle, and Alignment Problems

A large class of production problems reduces to GCD/LCM the moment you recognize a *periodicity*:

### 6b.1 LCM as the realignment period

`k` periodic processes with periods `p₁, …, p_k` (cron jobs, rotating schedules, traffic-light cycles, gear meshes) all return to their joint starting configuration after exactly `lcm(p₁, …, p_k)` ticks. This is the canonical LCM application. The engineering caveats are real:

- **Overflow:** the LCM grows fast; for many processes it can exceed any fixed width. Cap it, use big integers, or report "effectively never realigns" past a threshold.
- **Coprime worst case:** if all periods are pairwise coprime, the LCM is their *product* — the maximum — so coprime periods are the slowest to realign (this is *desirable* for, say, hash-probe sequences that should not synchronize).

### 6b.2 GCD as the drift / reachability step

Two processes stepping by `+a` and `+b` on a cycle of length `m` reach a common position iff `gcd(a, m)` and `gcd(b, m)` permit it; more sharply, the set of reachable offsets of a single `+a` stepper on `ℤ/mℤ` is exactly the multiples of `gcd(a, m)`, so it visits `m / gcd(a, m)` distinct positions before repeating. This is why a stepper with `gcd(a, m) = 1` (coprime step) visits *every* position — the basis of full-period pseudo-random generators, coprime hashing strides, and the "jug-filling" water-pouring puzzles (reachable amounts are multiples of `gcd` of the jug sizes).

### 6b.3 Cycle detection meets GCD

In Pollard's rho factorization and in cycle-length problems, the *length* of a detected cycle, combined with a stride, yields the factor or period via a GCD. Pollard's rho literally computes `gcd(|xᵢ − xⱼ|, n)` repeatedly, hoping to hit a non-trivial factor — the single most important GCD-driven factoring heuristic. Here GCD is not a preprocessing step but the *core* of the algorithm, called in the inner loop, which is why a fast (and for adversarial inputs, sometimes constant-time) GCD matters.

---

## 7. Code Examples

### 7.1 Go — ctz-optimized binary GCD, overflow-checked LCM

```go
package main

import (
	"fmt"
	"math/bits"
)

// binaryGCD uses count-trailing-zeros to strip factors of two in one op.
func binaryGCD(a, b uint64) uint64 {
	if a == 0 {
		return b
	}
	if b == 0 {
		return a
	}
	i := bits.TrailingZeros64(a)
	j := bits.TrailingZeros64(b)
	shift := i
	if j < i {
		shift = j
	}
	a >>= uint(i)
	for b != 0 {
		b >>= uint(bits.TrailingZeros64(b))
		if a > b {
			a, b = b, a
		}
		b -= a
	}
	return a << uint(shift)
}

// lcmChecked reports overflow instead of silently wrapping.
func lcmChecked(a, b uint64) (uint64, bool) {
	if a == 0 || b == 0 {
		return 0, true
	}
	g := binaryGCD(a, b)
	q := a / g
	res := q * b
	if b != 0 && res/b != q { // multiplication overflowed
		return 0, false
	}
	return res, true
}

func main() {
	fmt.Println(binaryGCD(48, 18)) // 6
	v, ok := lcmChecked(1<<40, (1<<40)-1)
	fmt.Println(v, ok) // overflow -> false on 64-bit
}
```

### 7.2 Java — extended GCD for modular inverse (RSA-style)

```java
import java.math.BigInteger;

public class ModInverse {
    // returns [g, x, y] with a*x + b*y = g
    static long[] extGcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    // modular inverse of a mod m, or -1 if it does not exist (gcd != 1)
    static long modInverse(long a, long m) {
        long[] r = extGcd(((a % m) + m) % m, m);
        if (r[0] != 1) return -1;            // inverse exists iff gcd == 1
        return ((r[1] % m) + m) % m;
    }

    public static void main(String[] args) {
        System.out.println(modInverse(3, 11));     // 4  (3*4 = 12 ≡ 1 mod 11)
        System.out.println(modInverse(6, 9));      // -1 (gcd(6,9)=3, no inverse)
        // Big-integer path uses a constant-time-ish library routine internally:
        System.out.println(BigInteger.valueOf(65537)
                .modInverse(BigInteger.valueOf(3120))); // RSA-style d
    }
}
```

### 7.3 Python — array LCM modulo p via prime-exponent merge

```python
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


def lcm_array_mod(nums, p):
    """LCM of nums modulo p, correct even when the true LCM is huge."""
    max_exp = {}
    for x in nums:
        for prime, e in factorize(x).items():
            if e > max_exp.get(prime, 0):
                max_exp[prime] = e
    result = 1
    for prime, e in max_exp.items():
        result = result * pow(prime, e, p) % p   # modular exponentiation
    return result


if __name__ == "__main__":
    MOD = 10**9 + 7
    print(lcm_array_mod([4, 6, 10], MOD))   # lcm = 60 -> 60
    print(lcm_array_mod(list(range(1, 41)), MOD))  # huge true LCM, reduced mod p
```

### 7.4 Go — sliding-window GCD via two stacks

GCD has no inverse, so a moving-window GCD cannot "subtract" the departing element. The two-stack trick maintains a window GCD in amortized `O(1)`.

```go
package main

import "fmt"

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// windowGCD returns the GCD of every contiguous window of size w.
func windowGCD(arr []int, w int) []int {
	var inS, outS []int     // values
	var inG, outG []int     // running GCDs aligned with the stacks
	push := func(v int) {
		inS = append(inS, v)
		g := v
		if len(inG) > 0 {
			g = gcd(inG[len(inG)-1], v)
		}
		inG = append(inG, g)
	}
	transfer := func() {
		for len(inS) > 0 {
			v := inS[len(inS)-1]
			inS = inS[:len(inS)-1]
			inG = inG[:len(inG)-1]
			outS = append(outS, v)
			g := v
			if len(outG) > 0 {
				g = gcd(outG[len(outG)-1], v)
			}
			outG = append(outG, g)
		}
	}
	curGCD := func() int {
		switch {
		case len(inG) == 0:
			return outG[len(outG)-1]
		case len(outG) == 0:
			return inG[len(inG)-1]
		default:
			return gcd(inG[len(inG)-1], outG[len(outG)-1])
		}
	}
	var res []int
	for i := 0; i < len(arr); i++ {
		push(arr[i])
		if i >= w-1 {
			res = append(res, curGCD())
			// pop the oldest (front) element
			if len(outS) == 0 {
				transfer()
			}
			outS = outS[:len(outS)-1]
			outG = outG[:len(outG)-1]
		}
	}
	return res
}

func main() {
	fmt.Println(windowGCD([]int{12, 6, 18, 9, 3}, 2)) // [6 6 9 3]
}
```

---

## 8. Observability and Testing

A GCD result is a single opaque number — one wrong answer looks like any other. Build invariants in from day one.

| Check | Why |
|-------|-----|
| `gcd(a, b)` divides both `a` and `b` | Catches off-by-one and sign bugs directly. |
| `gcd(a, b) * lcm(a, b) == abs(a*b)` (big int) | The defining identity; catches LCM ordering/overflow bugs. |
| `gcd(a, b) == gcd(b, a)` (commutativity) | Catches asymmetric handling. |
| `a*x + b*y == gcd(a, b)` (extended) | Bezout invariant; catches back-substitution errors. |
| Result is non-negative | Catches the negative-remainder sign trap in Go/Java. |
| Cross-check vs `math.gcd` / `std::gcd` / `BigInteger.gcd` | Differential test against a trusted reference. |
| Fibonacci-pair iteration count is logarithmic | Confirms the worst case is handled, not a hang. |

The single most valuable test is **property-based**: for random `a, b`, assert `g | a`, `g | b`, and that no `d > g` divides both (check a few divisors of `g·small`), plus the `gcd·lcm == |a·b|` identity using big integers to avoid overflow in the check itself.

### 8.1 A property-test battery

```text
for random a, b in a wide range (include 0, negatives, INT_MIN-ish):
    g = gcd(a, b)
    assert g >= 0
    assert a % g == 0 and b % g == 0     # (g != 0 unless a==b==0)
    assert gcd(a, b) == gcd(b, a)
    assert gcd(a, b) == gcd_reference(a, b)   # differential vs stdlib
    if a != 0 or b != 0:
        assert g * lcm(a, b) == abs(a * b)    # big-int arithmetic
    g2, x, y = ext_gcd(a, b)
    assert a * x + b * y == g2                # Bezout
```

These run on every CI build over a few hundred thousand random instances, including the boundary values (`0`, `1`, `-1`, max, min), which is where hand-rolled GCDs break.

### 8.2 Production guardrails

For a service computing LCMs at scale, add an **overflow-checked LCM** (Section 7.1) that returns an error rather than a wrapped value, an **input validator** that rejects or normalizes negatives and documents the zero conventions, and — in crypto paths — an assertion that the **constant-time** routine, not the textbook one, is on the call path for secret operands.

### 8.3 Differential and metamorphic testing

Beyond fixed invariants, two cheap techniques find deep bugs:

- **Differential testing:** run your GCD and the standard library's on the same random inputs (including `0`, `±1`, max, min); any divergence is a bug. This caught more real defects in practice than any single hand-written test, because the standard library is a trusted, independently-implemented oracle.
- **Metamorphic testing:** exploit relations that must hold without knowing the exact answer — `gcd(a, b) == gcd(b, a)`, `gcd(k·a, k·b) == k·gcd(a, b)` (the scaling law), `gcd(a, b) == gcd(a + t·b, b)` for any `t`. Generate a random `(a, b)`, apply a transformation, and assert the relation. These catch sign and overflow bugs that example-based tests miss because they hold for *every* input, not just the ones you thought to write down.

---

## 9. Failure Modes

### 9.1 Silent LCM overflow

`a * b / gcd` overflows before dividing; even `a / gcd * b` overflows if the true LCM exceeds the type. Mitigation: divide-first ordering, an overflow-checked multiply, or big integers / modular reduction.

### 9.2 Negative GCD from sign-naive `%`

In Go/Java/C, `a % b` can be negative, so the loop returns a negative GCD that downstream code (e.g., a denominator) mishandles. Mitigation: `abs` the inputs at entry and the result at exit. Note this is *language-specific*: the same logic in Python returns a non-negative GCD because Python's `%` follows the sign of the divisor — a portability trap when translating algorithms between languages.

### 9.3 `gcd(0, 0)` assumption mismatch

A caller assumes `gcd(0, 0)` is `1` or throws; the standard is `0`. Mitigation: document the conventions and test them explicitly.

### 9.4 `INT_MIN` overflow in `abs`

`abs(-2^63)` overflows. Mitigation: use unsigned/wider types or special-case the most-negative value.

### 9.5 Subtractive GCD blowup

A "simpler" `gcd(a, b) = gcd(a - b, b)` runs `O(max)` times on skewed inputs and looks like a hang. Mitigation: always use mod-based or binary GCD.

### 9.6 Array LCM under a modulus via division

Dividing a running LCM by a GCD modulo `p` is mathematically invalid and silently wrong. Mitigation: merge prime exponents (max per prime), then power mod `p`.

### 9.7 Timing leak in crypto paths

A variable-time GCD/inverse on secret operands leaks bits via timing. Mitigation: use a constant-time inverse (Bernstein-Yang safegcd or the library primitive) for any secret-dependent computation; never the textbook variant.

### 9.8 Shared-factor key leakage

`gcd(n₁, n₂) > 1` across many RSA moduli reveals shared primes (the "Ps and Qs" attack). This is a *generation*-side failure (bad RNG), but GCD is what exposes it — a reminder that GCD's power cuts both ways.

### 9.9 Array LCM under a modulus via division

Computing `running = running / gcd(running, x) * x % p` across an array is wrong twice over: division under a modulus is undefined without a modular inverse, and the reduced `running mod p` no longer carries the information needed to compute the next GCD. Mitigation: merge prime exponents (max per prime), then power mod `p` (Section 6.2). This is the single most common silent-correctness bug in array-LCM code, because the buggy version *runs* and returns a plausible-looking number.

### 9.10 Sliding-window GCD recomputed naively

Recomputing the GCD of each length-`w` window from scratch is `O(n·w·log)` — fine for small `w`, quadratic-ish for large. Symptom: a batch job that scales badly with window size. Mitigation: the two-stack deque (Section 7.4) gives amortized `O(1)` per window, or a sparse table / segment tree for `O(log)` range queries. Forgetting that GCD has *no inverse* (so you cannot just divide out the departing element) is the root misconception.

### 9.11 Rebuilding the prime sieve per request

In a service answering many array-LCM-mod-`p` queries, rebuilding the smallest-prime-factor sieve (`O(max log log max)`) on every request wastes most of the time budget and pressures the allocator. Mitigation: build the sieve once at startup and share it read-only across requests — the same "precompute once, reuse" discipline as caching a power ladder. Symptom: latency dominated by sieve construction rather than the actual factorization, and per-request memory churn proportional to `max`.

---

## 10. Summary

- **Cost model:** on machine integers, GCD is `O(log min(a,b))` and trivial; on `n`-bit big integers, each step costs a big-integer division, so naive GCD is `O(n · M(n))` and production libraries switch to Lehmer / subquadratic half-GCD above a threshold.
- **Overflow:** compute LCM as `a / gcd * b` (divide first); the result still overflows if the true LCM exceeds the type — use an overflow-checked multiply, big integers, or modular prime-exponent merging.
- **Signs and zero:** `gcd = gcd(|a|, |b|) ≥ 0`; normalize with `abs` to dodge Go/Java/C negative-remainder semantics; `gcd(0,0)=0`, `lcm(_,0)=0` are documented conventions; beware `abs(INT_MIN)`.
- **Variant choice:** mod-based Euclid is the default and often fastest on machine words; **binary GCD** (ctz-optimized) wins on big integers and division-poor hardware; never use plain subtractive GCD.
- **Cryptography:** GCD gates and (via the extended form) constructs modular inverses (RSA `d = e⁻¹ mod φ(n)`); on **secret** operands use a **constant-time** GCD/inverse to avoid timing leaks; `gcd(n₁, n₂) > 1` is also a key-recovery weapon against bad RNGs.
- **Arrays:** GCD folds cheaply (identity `0`, early-exit at `1`, parallelizable, no overflow); LCM folds dangerously (identity `1`, overflows fast) — use big integers or max-prime-exponent reduction modulo `p`.
- **Testing:** property tests on the invariants `g | a`, `g | b`, `gcd·lcm = |a·b|`, and the Bezout identity, differentially cross-checked against the standard library over boundary values, catch nearly every real bug.

### Decision summary

- **Machine-int GCD** → mod-based Euclidean, `abs`-normalized.
- **Big-integer GCD** → library routine (Lehmer / half-GCD); binary GCD if hand-rolling.
- **LCM that might overflow** → divide-first + overflow check, or big integers, or modular prime-exponent merge.
- **Modular inverse** → extended Euclidean (any modulus) or Fermat (prime modulus).
- **Secret operands (crypto)** → constant-time inverse only.
- **Array GCD** → parallel fold, early exit at `1`.
- **Array LCM mod p** → max prime exponents, then power mod `p`.
- **Range/sliding-window GCD** → sparse table (static), segment tree (mutable), two-stack deque (window).
- **Rational reconstruction** → partial extended Euclidean with the `√(m/2)` stopping bound.
- **Period / realignment** → LCM of periods; **reachable offsets** on a cycle → multiples of the GCD.
- **Factoring heuristic** → Pollard's rho, whose inner loop *is* a GCD.

### Operational Checklist

Before shipping GCD/LCM code, confirm: inputs are `abs`-normalized; LCM divides before multiplying *and* checks overflow; the zero conventions are documented; array LCM uses prime-exponent merging (never division mod `p`); any secret-operand path uses a constant-time primitive; and a differential test against the standard library runs in CI over boundary values. Each line maps to a failure mode above.

References to study further: Knuth TAOCP Vol. 2 (Euclid, binary GCD, Lehmer); Stehlé-Zimmermann subquadratic GCD; Bernstein-Yang "fast constant-time GCD and modular inversion" (safegcd); Heninger et al. "Mining your Ps and Qs"; and sibling topics `06-extended-euclidean`, `02-modular-arithmetic`, and the CRT material in `19-number-theory`.
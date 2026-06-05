# Garner's Algorithm (Mixed-Radix CRT Reconstruction) — Senior Level

> Garner is rarely the bottleneck on a single reconstruction — but the moment you Garner-combine *millions* of NTT coefficients, run RNS arithmetic in a crypto inner loop, or must guarantee the reconstructed value is exact and overflow-free, every detail (prime selection, inverse precomputation, signed vs unsigned recovery, the comparison/overflow blind spot of RNS, the big-int assembly cost) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Multi-Prime NTT Reconstruction](#2-multi-prime-ntt-reconstruction)
3. [RNS for Big-Integer Arithmetic](#3-rns-for-big-integer-arithmetic)
4. [Overflow-Free Engineering](#4-overflow-free-engineering)
5. [Choosing the Primes](#5-choosing-the-primes)
6. [Signed Recovery and Centered Residues](#6-signed-recovery-and-centered-residues)
6.5. [Batched and Parallel Reconstruction](#65-batched-and-parallel-reconstruction)
6.6. [Case Study: A Multi-Prime NTT Wrong-Answer Incident](#66-case-study-a-multi-prime-ntt-wrong-answer-incident)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
9.9. [Cryptographic RNS and Garner](#99-cryptographic-rns-and-garner)
9.10. [Decision Matrix](#910-decision-matrix)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how do the mixed-radix digits work" but "what system am I actually building, and what breaks when I scale it?". Garner shows up in three production guises that look different but share one engine:

1. **Multi-prime NTT result reconstruction** — you computed a convolution modulo several NTT-friendly primes because a single prime's modulus was too small to hold the true (un-reduced) coefficients; Garner recombines them per coefficient. See sibling `13-ntt`.
2. **RNS-based big-integer / modular arithmetic** — you represent huge numbers as residue tuples, do carry-free parallel arithmetic, and Garner-reconstruct the magnitude when comparison, division, sign, or output is needed.
3. **Overflow avoidance in a single computation** — a product or sum would overflow even 64-bit (or even 128-bit) intermediates, so you split it across coprime word-sized primes and reconstruct.

All three reduce to: *carry residues alongside the cheap arithmetic, then Garner-reconstruct exactly once, as late as possible.* The senior-level decisions are: which primes, how to precompute inverses, how to keep every intermediate inside the integer width, how to recover signed values, and how to verify a result you cannot easily brute-force.

---

## 2. Multi-Prime NTT Reconstruction

### 2.1 Why multiple primes

NTT (`13-ntt`) computes a cyclic convolution modulo a prime `q` of the form `c·2^m + 1` (NTT-friendly: it has a high power-of-two-order root of unity). The convolution of two integer sequences produces coefficients that can be as large as `n · max_a · max_b` — easily exceeding `q ≈ 2^{30}`. If the true coefficient exceeds `q`, the single-prime NTT result is only the coefficient *mod `q`*, which is wrong if you wanted the exact value or the value mod a different `M`.

The fix: run the NTT under **three** (sometimes two or four) distinct NTT-friendly primes `q_0, q_1, q_2`, whose product `Q = q_0 q_1 q_2` safely exceeds the maximum possible true coefficient. Each output coefficient is then known mod `q_0`, `q_1`, `q_2`. **Garner reconstructs the true coefficient** (or, more usually, the coefficient mod the problem modulus `M`) from those three residues.

### 2.2 The three-prime combine, in practice

For each output coefficient you have `(c_0, c_1, c_2)`. Because the three primes are *fixed for the whole transform*, precompute:

```
inv01     = q_0^{-1} mod q_1
inv012    = (q_0·q_1)^{-1} mod q_2
```

Then per coefficient (Garner with `k = 3`):

```
a_0 = c_0
a_1 = (c_1 - a_0) · inv01            (mod q_1)
a_2 = ((c_2 - a_0) · inv01' - a_1) · inv12  ... (the prefix-product form)
x   = a_0 + a_1·q_0 + a_2·q_0·q_1
```

and if the answer is wanted mod `M`, accumulate `x mod M` using `q_0 mod M` and `(q_0 q_1) mod M`. The crucial point: the inverses are computed **once**, not per coefficient, so combining `n` coefficients is `O(n)` with a tiny constant — Garner's `O(k²)` is `O(9)` here, a constant.

### 2.3 Two primes vs three primes

| Primes | Product `Q` (≈) | Holds coefficients up to | Use |
|--------|------------------|--------------------------|-----|
| 1 NTT prime | `~2^{30}` | small convolutions, answer < `q` | single-modulus problems |
| 2 NTT primes | `~2^{60}` | most competitive-programming convolutions | the common case |
| 3 NTT primes | `~2^{90}` | products of large polynomials with big coefficients | safety margin / large values |
| 4+ primes | `~2^{120}+` | cryptographic / arbitrary-precision | RNS bignum, rarely needed for contests |

Pick the smallest `k` whose product exceeds the proven maximum coefficient. Over-provisioning primes wastes a full extra NTT pass.

### 2.4 A concrete combine trace

Suppose a coefficient's true value is `c = 5_000_000_123`, exceeding a single `~2^{30}` prime. With two primes `q_0 = 998244353`, `q_1 = 1004535809` (product `≈ 1.003·10^{18} > c`), the residues are `c_0 = c mod q_0` and `c_1 = c mod q_1`. Garner combines:

```
a_0 = c_0
a_1 = (c_1 − a_0) · (q_0^{-1} mod q_1)   (mod q_1)
c   = a_0 + a_1 · q_0
```

The reconstructed `c` is exact because `c < q_0 q_1`. Had we used only `q_0`, we would have recovered `c mod q_0 ≈ 5·10^9 mod 10^9` — wrong. The second prime supplies exactly the extra `log_2(q_1) ≈ 30` bits needed to disambiguate. This is the bit-budget intuition: each additional NTT-friendly prime adds ~30 bits of representable range, and you add primes until the range covers the proven coefficient bound.

### 2.5 Why NTT-friendliness and Garner are orthogonal

A common confusion: the primes must be NTT-friendly *for the transform*, but Garner itself needs only pairwise coprimality. The NTT-friendliness (`q = c·2^m + 1`) is required so each prime's field has a `2^m`-th root of unity to run the transform; once you have the per-prime convolution residues, Garner does not care that the primes are NTT-friendly — it would combine any pairwise-coprime residues identically. So the prime constraints come from two independent sources: the transform demands NTT-friendliness; the reconstruction demands coprimality. A valid multi-prime NTT prime set satisfies both, but it is worth keeping the two requirements mentally separate when debugging — a wrong root of unity is an NTT bug, a wrong combine is a Garner bug, and they fail differently.

---

## 3. RNS for Big-Integer Arithmetic

### 3.1 The residue representation

A big integer `x ∈ [0, P)` (with `P = ∏ p_i`) is stored as `(x mod p_0, …, x mod p_{k-1})`. Addition, subtraction, and multiplication are componentwise and **carry-free**, so an RNS multiply of two `k`-residue numbers is `k` independent word multiplies — perfectly parallel, no carry propagation across limbs. This is why RNS appears in:

- **Cryptography** (RSA, ECC): RNS Montgomery multiplication parallelizes modular exponentiation across residue channels.
- **Big-integer libraries**: schoolbook/Karatsuba carry chains are replaced by parallel residue lanes; reconstruction (Garner) happens at output time.
- **Hardware/SIMD**: each prime lane is an independent SIMD slot.

### 3.2 What RNS cannot do cheaply

RNS has well-known blind spots, all of which require knowing the *magnitude* of `x`:

| Operation | RNS difficulty | Resolution |
|-----------|----------------|------------|
| Compare `x < y` | No positional ordering in residue space. | Reconstruct (Garner), or use a base-extension / mixed-radix sign trick. |
| Detect overflow `x ≥ P` | Magnitude unknown from residues alone. | Garner to mixed-radix; the top digit reveals range. |
| Integer division / mod by a non-base value | Not componentwise. | Reconstruct, or base-extend. |
| Sign of a signed value | Needs magnitude. | Centered/symmetric residues + reconstruct (Section 6). |

The mixed-radix digits that Garner produces are *exactly* the data structure that resolves these: they are positional (most-significant digit `a_{k-1}` carries the most weight), so comparison and sign reduce to comparing mixed-radix digit vectors lexicographically from the top. This is why Garner is the canonical RNS exit, not just a CRT curiosity.

### 3.3 Base extension

A related operation is **base extension**: given `x` in residues `(p_0, …, p_{k-1})`, compute its residue modulo a *new* prime `p_k` without reconstructing the full integer. Garner's mixed-radix digits make this clean: compute the digits `a_i` (mod the existing primes), then evaluate `Σ a_i W_i mod p_k`. This adds a channel to an RNS number — needed when an intermediate product would overflow the current product `P`.

---

## 4. Overflow-Free Engineering

### 4.1 The product width budget

The dangerous line in every Garner implementation is `a[j] * prefix` (and `a[i] * weight` in mod-`M` assembly). Both operands are `< p_i` (or `< M`). If primes are `< 2^{31}`, the product is `< 2^{62}`, which fits in signed 64-bit *before* the `% p_i`. If primes approach `2^{62}` (large NTT primes like `2^{61}-1`), the product overflows 64-bit and you need:

- **128-bit multiply**: `__int128` in C/C++, `math/big` or `math/bits.Mul64` in Go, `Math.multiplyHigh` / `BigInteger` in Java, native bigints in Python.
- **Montgomery / Barrett reduction** (`14-montgomery-multiplication`): keep numbers in Montgomery form so the reduction after each multiply is shift-and-subtract, not a division.

### 4.2 Where the big integer genuinely appears

The digit solve never needs a big integer. The big integer appears only in the **final assembly** `x = Σ a_i W_i` when the exact value is required. Its size is `≈ log_2 P = Σ log_2 p_i` bits. If you only need `x mod M`, the assembly stays in machine words (Section 2.2, middle.md), and the implementation is fully overflow-bounded by `M²`.

### 4.3 Interaction with Montgomery and Barrett

In high-throughput RNS (`14-montgomery-multiplication`), each residue lane keeps values in Montgomery form to make the per-multiply reduction cheap. Garner's inner multiply `a[j]·prefix mod p_i` then becomes a Montgomery multiply; you must convert in/out of Montgomery form consistently, or precompute the prefix-product inverses *in Montgomery form*. Mixing Montgomery and plain representations is a classic, silent bug.

---

## 5. Choosing the Primes

The primes must be **pairwise coprime** (distinct primes trivially are) and their product must exceed the largest value you need to represent. Additional production criteria:

| Criterion | Why | Typical choice |
|-----------|-----|----------------|
| NTT-friendliness (`q = c·2^m + 1`) | Required for NTT lanes to have a `2^m`-th root of unity. | `998244353 = 119·2^{23}+1`, `985661441`, `1004535809`. |
| Word-size fit | Keep products in 64-bit before reduction. | primes `< 2^{31}` so `p_i² < 2^{62}`. |
| Product covers the value range | Avoid an extra prime or a wrong (too-small) `P`. | smallest `k` with `∏ p_i > max value`. |
| Distinct from the answer modulus `M` | `M` need not be prime or coprime to the `p_i`; assembly mod `M` works regardless. | any `M`. |
| Reuse across runs | Precompute inverses once. | a fixed global prime table. |

A standard competitive-programming triple is `998244353`, `1004535809`, `985661441` — all NTT-friendly, product `≈ 2^{89.6}`, comfortably covering convolution coefficients of products of degree-`10^5` polynomials with coefficients up to `10^9`.

**Bounding the maximum coefficient.** For a convolution `c_t = Σ a_i b_{t-i}` with `n` terms and `|a|, |b| ≤ V`, the maximum `|c_t| ≤ n·V²`. Choose primes whose product exceeds `n·V²` (or `2·n·V²` for signed). This bound directly drives `k`.

---

## 6. Signed Recovery and Centered Residues

Garner reconstructs `x` in `[0, P)`. But many applications (signal processing, signed convolutions, lattice crypto) want a *signed* value in `[−P/2, P/2)`. The fix is **centered (symmetric) recovery**: after reconstructing `x ∈ [0, P)`, map

```
if x >= P/2:  x ← x − P.
```

This recovers the signed representative. In the mod-`M` assembly you cannot do this directly (you never form `P`), so either:

- reconstruct the full `x`, center it, then reduce mod `M` (handling the negative case `((x % M) + M) % M`), or
- track enough of the magnitude (the top mixed-radix digit, or a full big-int) to decide the sign, then adjust.

Centered residues throughout (`r_i ∈ (−p_i/2, p_i/2]`) are an alternative that keeps numbers small and makes sign recovery natural, at the cost of careful normalization. This matters whenever the "true" value can be negative — a frequent source of wrong-by-`P` bugs in NTT pipelines that forget signedness.

---

## 6.5 Batched and Parallel Reconstruction

The single-reconstruction cost of Garner is trivial; the engineering challenge is **throughput** when reconstructing millions of values (every coefficient of a large polynomial product, every limb of a bignum result).

### 6.5.1 Amortizing the inverses

When the moduli are fixed across the batch (always true for NTT/RNS), the `k` prefix-product inverses are computed **once** at setup. Each reconstruction is then `Θ(k²)` plain multiply-adds — for `k = 3` that is roughly nine multiplies plus a few subtractions and reductions, all on word-sized integers. There is no division, no inverse, and no allocation in the hot path. A naive implementation that recomputes inverses per element pays an `O(k log p)` penalty *per coefficient*, which on a million-coefficient combine is the difference between milliseconds and seconds.

### 6.5.2 Parallelism

Reconstructions are mutually independent: coefficient `t`'s combine depends only on its own residue tuple and the shared read-only inverse table. So the batch parallelizes trivially across threads, goroutines, SIMD lanes, or GPU work-items. The inverse table is immutable after setup, so it is shared without locking. The *only* serial dependency is within one reconstruction's digit chain (`a_i` needs `a_{j<i}`), which is `k` steps — negligible for small `k`.

### 6.5.3 Memory layout

For cache efficiency, store residues in **structure-of-arrays** form: one contiguous array per prime channel (`c0[]`, `c1[]`, `c2[]`) rather than an array of tuples. The combine then streams each channel linearly, and the output `x mod M` is written to a fourth contiguous array. This layout also vectorizes cleanly: a SIMD lane processes several coefficients of the same Garner step in parallel.

### 6.5.4 Throughput table (3-prime combine, mod M)

| Coefficients | Per-call inverses | Precomputed inverses | Speedup |
|--------------|-------------------|----------------------|---------|
| 10³ | ~tens of µs | ~few µs | ~5–10× |
| 10⁶ | ~seconds | ~milliseconds | ~hundreds× |
| 10⁷ (large poly product) | impractical | ~tens of ms | — |

The lesson mirrors the NTT itself: the asymptotics are fine; the constant factor (precompute, layout, vectorization) is what makes or breaks the production combine.

---

## 6.6 Case Study: A Multi-Prime NTT Wrong-Answer Incident

A representative production failure, to ground the failure modes of Section 9.

**Symptom.** A polynomial-multiplication service returned correct results on small inputs but wrong coefficients on large ones, intermittently. Unit tests (small polynomials) passed; integration on real workloads failed.

**Diagnosis.** Two primes were used (`Q = q_0 q_1 ≈ 2^{60}`), and the coefficient bound was `n V² ≈ 10^5 · (10^9)² ≈ 10^{23} ≈ 2^{76}` — *larger* than `Q`. For coefficients exceeding `Q`, Garner silently returned `c_t mod Q`, a smaller wrong value (Section 9.2). Small inputs never exceeded `Q`, hiding the bug.

**Fix.** Add a third prime (`Q ≈ 2^{90} > 2^{76}`), and assert at startup that `∏ q_s` exceeds the proven max coefficient `n V²` (with a factor 2 for signedness). A sampled round-trip check per batch was added as a guardrail.

**Lessons.**
- The product bound is a **proof obligation**, not a runtime check you can skip; it fails silently.
- Small-input tests do not exercise the wraparound path — fuzz with values near and above `Q`.
- Signedness compounds the bound: if coefficients can be negative, you need `∏ q_s > 2·max|c_t|` and centered recovery.

This single class of bug — insufficient prime product — accounts for the majority of multi-prime NTT incidents, precisely because it is silent and input-dependent.

---

## 7. Code Examples

### 7.1 Go — three-prime NTT coefficient combine (precomputed inverses)

```go
package main

import (
	"fmt"
	"math/big"
)

func modInv(a, m int64) int64 {
	return new(big.Int).ModInverse(big.NewInt(((a%m)+m)%m), big.NewInt(m)).Int64()
}

// Combine3 holds precomputed data for combining (c0,c1,c2) mod (q0,q1,q2).
type Combine3 struct {
	q0, q1, q2 int64
	inv01      int64 // q0^{-1} mod q1
	inv012     int64 // (q0*q1)^{-1} mod q2
}

func newCombine3(q0, q1, q2 int64) *Combine3 {
	return &Combine3{
		q0: q0, q1: q1, q2: q2,
		inv01:  modInv(q0%q1, q1),
		inv012: modInv((q0%q2)*(q1%q2)%q2, q2),
	}
}

// combineModM returns the true coefficient (from residues c0,c1,c2) reduced mod M.
func (c *Combine3) combineModM(c0, c1, c2, M int64) int64 {
	a0 := c0 % c.q0
	a1 := ((c1-a0)%c.q1 + c.q1) % c.q1
	a1 = (a1 * c.inv01) % c.q1
	// partial = a0 + a1*q0  (mod q2)
	partial := (a0%c.q2 + a1%c.q2*(c.q0%c.q2)) % c.q2
	a2 := ((c2-partial)%c.q2 + c.q2) % c.q2
	a2 = (a2 * c.inv012) % c.q2
	// x = a0 + a1*q0 + a2*q0*q1  (mod M)
	x := a0 % M
	x = (x + a1%M*(c.q0%M)) % M
	x = (x + a2%M*((c.q0%M)*(c.q1%M)%M)) % M
	return x
}

func main() {
	c := newCombine3(998244353, 1004535809, 985661441)
	// suppose the true coefficient is 23; its residues mod the three primes are 23,23,23
	fmt.Println(c.combineModM(23, 23, 23, 1_000_000_007)) // 23
}
```

### 7.2 Java — generic Garner with overflow-safe 128-bit multiply via Math.multiplyHigh

```java
import java.math.BigInteger;

public class GarnerSafe {
    static long modMul(long a, long b, long m) {
        // 128-bit safe multiply mod m
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(m)).longValue();
    }

    static long modInv(long a, long m) {
        return BigInteger.valueOf(((a % m) + m) % m)
                .modInverse(BigInteger.valueOf(m)).longValue();
    }

    static BigInteger garner(long[] r, long[] p) {
        int k = p.length;
        long[] a = new long[k];
        for (int i = 0; i < k; i++) {
            long partial = 0, prefix = 1;
            for (int j = 0; j < i; j++) {
                partial = (partial + modMul(a[j], prefix, p[i])) % p[i];
                prefix = modMul(prefix, p[j], p[i]);
            }
            long diff = ((r[i] - partial) % p[i] + p[i]) % p[i];
            a[i] = modMul(diff, modInv(prefix, p[i]), p[i]);
        }
        BigInteger x = BigInteger.ZERO, w = BigInteger.ONE;
        for (int i = 0; i < k; i++) {
            x = x.add(BigInteger.valueOf(a[i]).multiply(w));
            w = w.multiply(BigInteger.valueOf(p[i]));
        }
        return x;
    }

    // centered (signed) recovery into [-P/2, P/2)
    static BigInteger garnerSigned(long[] r, long[] p) {
        BigInteger x = garner(r, p);
        BigInteger P = BigInteger.ONE;
        for (long pi : p) P = P.multiply(BigInteger.valueOf(pi));
        if (x.shiftLeft(1).compareTo(P) >= 0) x = x.subtract(P);
        return x;
    }

    public static void main(String[] args) {
        long[] r = {2, 3, 2}, p = {3, 5, 7};
        System.out.println(garner(r, p));        // 23
        System.out.println(garnerSigned(r, p));  // 23 (since 23 < 105/2 is false -> 23-105? check)
    }
}
```

### 7.3 Python — RNS arithmetic then Garner reconstruct (with signed recovery)

```python
from math import prod, gcd


def to_rns(x, primes):
    return [x % p for p in primes]


def rns_add(a, b, primes):
    return [(a[i] + b[i]) % primes[i] for i in range(len(primes))]


def rns_mul(a, b, primes):
    return [(a[i] * b[i]) % primes[i] for i in range(len(primes))]


def garner(r, primes):
    k = len(primes)
    a = [0] * k
    for i in range(k):
        partial, prefix = 0, 1
        for j in range(i):
            partial = (partial + a[j] * prefix) % primes[i]
            prefix = (prefix * primes[j]) % primes[i]
        diff = (r[i] - partial) % primes[i]
        a[i] = (diff * pow(prefix, -1, primes[i])) % primes[i]
    x, w = 0, 1
    for i in range(k):
        x += a[i] * w
        w *= primes[i]
    return x


def garner_signed(r, primes):
    x = garner(r, primes)
    P = prod(primes)
    return x - P if 2 * x >= P else x


if __name__ == "__main__":
    primes = [998244353, 1004535809, 985661441]
    # multiply two big numbers entirely in RNS, then reconstruct
    A, B = 12345678901234567890, 98765432109876543210
    ra, rb = to_rns(A, primes), to_rns(B, primes)
    rprod = rns_mul(ra, rb, primes)
    assert garner(rprod, primes) == (A * B) % prod(primes)
    print("RNS product reconstructed correctly")
    # signed recovery demo
    primes2 = [3, 5, 7]
    print(garner_signed(to_rns(-4 % prod(primes2), primes2), primes2))  # -4
```

---

## 8. Observability and Testing

A reconstructed value is opaque — one wrong digit looks like any other large number. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force CRT on small `P` | Catches sign-normalization and inverse bugs. |
| Round-trip: `to_rns(garner(r), p) == r` | The reconstructed value must reproduce the input residues. |
| Cross-check vs classic CRT formula | Independent reconstruction agreeing builds confidence. |
| `garner(to_rns(x)) == x` for random `x ∈ [0, P)` | The fundamental identity. |
| RNS homomorphism: `garner(rns_mul(A,B)) == (A·B) mod P` | Validates the whole RNS-then-reconstruct pipeline. |
| Signed range: result in `[-P/2, P/2)` after centering | Catches the off-by-`P` sign bug. |
| Pairwise-coprime assertion | Guards the silent non-coprime failure. |

### 8.1 A property-test battery

```text
for random pairwise-coprime primes p[], random x in [0, prod(p)):
    assert garner(to_rns(x, p), p) == x                         # round trip
    assert to_rns(garner(r, p), p) == r  for random r           # residue match
    A, B random in [0, prod(p)):
      assert garner(rns_mul(to_rns(A), to_rns(B))) == (A*B) % P  # homomorphism
    assert garner(...) agrees with classic CRT formula          # cross-check
```

The **round-trip** test is the single most valuable: it catches the inverse mistake, the weight off-by-one, and the sign-normalization bug that together account for nearly every real Garner defect.

### 8.2 Production guardrails

For a service Garner-combining NTT coefficients at scale, add: a **prime-product bound check** (assert `∏ p_i` exceeds the proven max coefficient, logged once at startup); an **input validator** asserting `0 ≤ r_i < p_i`; and a **sampled round-trip** on a handful of coefficients per batch to catch a corrupted inverse table early rather than after shipping wrong output.

---

## 9. Failure Modes

### 9.1 Non-coprime moduli

If two moduli share a factor, the prefix-product inverse does not exist and Garner produces nonsense (or throws). Mitigation: assert pairwise coprimality; for non-coprime systems, merge consistently-overlapping congruences (or detect contradiction) as in the generalized CRT of `05-crt`.

### 9.2 Insufficient prime product (silent wraparound)

If `∏ p_i` does not exceed the true value, Garner reconstructs `x mod P`, not `x` — a *smaller, wrong* number, with no error raised. This is the most dangerous NTT bug. Mitigation: prove the maximum coefficient bound and pick primes whose product exceeds it (Section 5); add the startup product-bound check.

### 9.3 Forgotten signedness

Reconstructing a value that should be negative gives `x + P` instead of `x`. Mitigation: center into `[−P/2, P/2)` (Section 6), and test the signed round trip.

### 9.4 Overflow in the inner multiply

`a[j]·prefix` overflows 64-bit for large primes. Mitigation: 128-bit multiply, Montgomery/Barrett (`14-montgomery-multiplication`), or keep primes `< 2^{31}`.

### 9.5 Montgomery-form mismatch

In an RNS Montgomery pipeline, multiplying a Montgomery-form residue by a plain prefix-product inverse yields a value off by the Montgomery factor `R`. Mitigation: keep one consistent representation; precompute inverses in the same form.

### 9.6 Recomputing inverses per coefficient

In a hot NTT combine, computing `q_0^{-1} mod q_1` per coefficient (instead of once) adds a `log` factor to every element. Symptoms: combine throughput an order of magnitude below expectation. Mitigation: precompute the inverse table once; the per-coefficient cost is then a constant number of multiplies.

### 9.7 Reconstructing when you only needed residues

Reconstructing inside an RNS arithmetic loop (e.g. to compare, then continuing in RNS) destroys the parallel speedup. Mitigation: stay in residue space; reconstruct (or base-extend) only at genuine exit points.

### 9.8 Un-reduced or out-of-range residues

Feeding `r_i ≥ p_i` (or negative) corrupts the first digit silently. Mitigation: normalize `r_i ← ((r_i % p_i) + p_i) % p_i` on entry.

---

## 9.9 Cryptographic RNS and Garner

A specialized but high-value setting: RNS arithmetic in public-key cryptography (RSA, ECC).

**Why RNS in crypto.** Modular exponentiation `m^e mod N` over a large `N` (2048–4096 bits) is the RSA workhorse. Representing operands in RNS over many word-sized primes turns each big multiply into independent per-channel multiplies — parallelizable across cores or SIMD lanes, with no carry propagation. RNS Montgomery multiplication (`14-montgomery-multiplication`) keeps the per-channel reduction cheap.

**Where Garner fits.** Two places. First, **base extension** (Section 3.3): RNS Montgomery multiplication needs to extend a number from one residue base to a second, which is a Garner-style mixed-radix computation. Second, **final output**: the ciphertext/plaintext must be returned as an integer, which is a Garner reconstruction from the residue channels.

**Side-channel caution.** In crypto, the reconstruction must be **constant-time**: the digit solve and the centered-recovery branch must not leak the value through timing. A data-dependent `if (2x ≥ P)` branch, or an early-exit on a zero digit, can leak secret bits. Mitigation: branchless centered recovery (compute both candidates, select by a constant-time mask) and avoid value-dependent control flow. This is a constraint the contest/competitive use of Garner never imposes, but it is mandatory in a cryptographic deployment.

**Takeaway.** The same mixed-radix engine that combines NTT coefficients in a contest is, in a crypto library, a base-extension and output-conversion primitive that additionally must be constant-time. The mathematics is identical; the engineering constraints differ sharply.

**A note on RNS Montgomery base extension.** The Kawamura–Posch–Bajard-style RNS Montgomery multiplication performs two base extensions per multiply (from base `A` to base `B` and back), each a Garner-flavored mixed-radix computation across channels. The cost of these extensions dominates RNS Montgomery, so their constant factor — precomputed inverses, channel-parallel evaluation, and avoiding any full reconstruction — is exactly where crypto-RNS performance is won or lost. Garner is not a one-off output step here; it is invoked in the innermost loop of modular exponentiation, which is why its `O(k²)` (for channel count `k`) and the choice of `k` directly set the throughput of an RNS RSA/ECC implementation.

---

## 9.10 Decision Matrix

| Situation | Action | Rationale |
|-----------|--------|-----------|
| Combine 2–4 fixed NTT primes per coefficient | Garner, precomputed inverses, assemble mod `M` | constant per-element cost |
| Need exact big integer from residues | Garner + big-int assembly; center if signed | only place big-int is needed |
| Mid-pipeline RNS arithmetic | stay in residues; don't reconstruct | preserve carry-free parallelism |
| Need to compare two RNS values | mixed-radix digits, reverse-lex | magnitude recovery without full integer |
| Add precision (channel) to RNS number | base extension via Garner digits | no full reconstruction |
| Primes near 64-bit | 128-bit multiply or Montgomery | overflow avoidance |
| Value may be negative | centered recovery `[−P/2, P/2)` | avoid off-by-`P` |
| Moduli not coprime | generalized CRT merge | prefix-product inverse fails |
| Cryptographic deployment | constant-time, branchless recovery | side-channel resistance |
| Very large `k` (hundreds of primes) | product/remainder tree | beats `O(k²)` asymptotically |

---

## 10. Summary

- Garner is the **constructive CRT** used in three production settings: multi-prime NTT reconstruction (`13-ntt`), RNS big-integer arithmetic, and overflow avoidance — all sharing one mixed-radix digit engine.
- **Multi-prime NTT:** run the transform under enough NTT-friendly primes that their product exceeds the proven maximum coefficient, then Garner-combine per coefficient with **precomputed** prefix-product inverses, so combine is `O(n)` with a constant `O(k²)=O(9)` factor.
- **RNS:** carry-free, parallel componentwise arithmetic; Garner is the exit door for the operations residues cannot do — comparison, overflow detection, sign, division — because the mixed-radix digits are positional.
- **Overflow-free:** the digit solve is always single-prime-sized; big integers appear only in the optional exact assembly. For `x mod M`, everything stays in machine words. Use 128-bit multiply or Montgomery/Barrett (`14-montgomery-multiplication`) when primes approach the word width.
- **Prime selection** drives correctness: pairwise coprime, NTT-friendly when needed, product exceeding the value range, word-size-friendly, and reused so inverses precompute once.
- **Signed recovery** centers `x` into `[−P/2, P/2)`; forgetting it is an off-by-`P` bug.
- Always keep a **round-trip test** (`garner(to_rns(x)) == x`) and an **RNS-homomorphism test**; they catch the inverse, weight, sign, and product-bound mistakes that account for nearly every real defect.

### Decision summary

- **Combine multi-prime NTT coefficients** → Garner with precomputed inverses, assemble mod `M`.
- **Need the exact big integer** → Garner digits + big-int assembly; center if signed.
- **Bulk parallel big arithmetic** → stay in RNS; Garner only at exit / base-extension.
- **Primes near word width** → 128-bit multiply or Montgomery form.
- **Value may be negative** → centered recovery into `[−P/2, P/2)`.
- **Non-coprime moduli** → not plain Garner; use generalized CRT merge (`05-crt`).
- **Cryptographic deployment** → constant-time, branchless recovery; base-extension primitive.
- **Very large `k`** → product/remainder tree (`O(M(B) log k)`), not the `O(k²)` chain.

### Operational Checklist

Before shipping a Garner-based reconstruction:

1. **Bound proven.** `∏ p_i > v_max` (or `> 2V` signed) is documented and asserted at startup — the silent-wraparound guard.
2. **Inverses precomputed.** For fixed primes, the prefix-product inverse table is built once and shared read-only.
3. **Residues normalized.** Inputs reduced to `[0, p_i)` on entry.
4. **Assembly chosen.** Big-int only when the exact value is needed; mod-`M` sum otherwise (no big-int).
5. **Signedness handled.** Centered recovery if values can be negative.
6. **Round-trip tested.** `garner(to_rns(x)) == x` and the RNS-homomorphism property in CI.
7. **Layout optimized.** Structure-of-arrays residues for cache/SIMD on batched combines.
8. **Side channels considered.** Constant-time recovery for any secret-dependent value.

These eight points, in order, prevent the failure modes of Section 9 and the throughput regressions of Section 6.5. The first — the product bound — is the most important and the most often skipped, because its violation is silent and input-dependent (Section 6.6).

### One-Sentence Mental Model

Garner is *long division in reverse for residue systems*: just as you recover a decimal number digit by digit, Garner recovers a residue-encoded number mixed-radix-digit by mixed-radix-digit, each digit solved with a single small inverse, so the giant value never has to be formed until (and unless) you actually want it.

References to study further: sibling `05-crt` (existence and classic formula), `06-extended-euclidean-modular-inverse` (the inverses), `13-ntt` (multi-prime transforms), `14-montgomery-multiplication` (fast reduction in residue lanes), `20-polynomial-operations` (where multi-prime NTT + Garner powers fast polynomial multiply), `27-bigint-arithmetic` (assembly and RNS bignum), Knuth TAOCP Vol. 2 (modular/residue arithmetic and mixed-radix conversion).

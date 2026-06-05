# Chinese Remainder Theorem (CRT) — Middle Level

> **Focus:** The `n`-congruence constructive formula, the **merge-based general CRT** for non-coprime moduli (with the gcd consistency check), doing one big-modulus computation as several small-modulus computations and reconstructing, the Garner's-algorithm preview, and how to choose between these approaches.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The n-Congruence Coprime Construction](#the-n-congruence-coprime-construction)
4. [The Merge-Based General CRT](#the-merge-based-general-crt)
5. [Multi-Mod Computation and Reconstruction](#multi-mod-computation-and-reconstruction)
6. [Garner's Algorithm Preview](#garners-algorithm-preview)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Worked Example: Folding Four Congruences](#worked-example-folding-four-congruences)
12. [Garner Reconstruction Code](#garner-reconstruction-code)
13. [Calendar and Cycle Applications](#calendar-and-cycle-applications)
14. [Best Practices](#best-practices)
15. [Common Pitfalls at This Level](#common-pitfalls-at-this-level)
16. [Visual Animation](#visual-animation)
17. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: two coprime congruences have one solution mod the product, and you can either apply a symmetric formula or merge them. At middle level you confront the engineering reality:

- The moduli are not always coprime. When can you still solve the system, and how?
- You have `n` congruences, not two. Do you build the symmetric formula, or fold pairwise?
- You want to compute something modulo a *big* number `M`, but `M` does not fit in a machine word. How do you split the work across small primes and recombine?
- What is **Garner's algorithm**, and when is its mixed-radix form better than plain CRT?

The unifying idea is still independence: coprime moduli give a perfect one-to-one correspondence between a number in `[0, M)` and its tuple of residues `(x mod m₁, …, x mod mₙ)`. CRT is the inverse map — from residue tuple back to the number. Everything in this file is either (a) generalizing that map to `n` moduli or non-coprime moduli, or (b) exploiting it to make a big computation cheap.

Keep one distinction front of mind throughout: the **coprime** path is about *convenience and speed* (a clean isomorphism, no consistency worries), while the **general** path is about *robustness* (handles any moduli, detects no-solution). Production code that ingests data-derived moduli almost always wants the general path; competitive-programming and NTT code, which controls its moduli, can use the faster coprime path.

---

## Deeper Concepts

### The Ring-Isomorphism Picture (Intuition)

For pairwise-coprime moduli, CRT establishes a **bijection**

```
Z/MZ  ≅  Z/m₁Z × Z/m₂Z × … × Z/mₙZ
x     ↔   (x mod m₁, x mod m₂, …, x mod mₙ)
```

This is not just a counting bijection — it respects `+` and `×`. Adding or multiplying two numbers mod `M` is the same as adding or multiplying their residue tuples componentwise. That is *exactly* why multi-mod computation works: do the arithmetic in each component independently, then CRT the result tuple back to a single number. The formal proof of the isomorphism is in [`professional.md`](./professional.md); here we use it as the mental model.

### Why Coprimality Is the Hinge

If `gcd(mᵢ, mⱼ) = d > 1`, the residues mod `mᵢ` and mod `mⱼ` are no longer independent: they must **agree** modulo `d`. That agreement requirement is the **consistency condition**. Coprime moduli have `d = 1`, so the agreement is vacuous (everything is congruent mod 1) and every residue tuple is achievable — hence existence is automatic. Non-coprime moduli need the explicit check.

### Combined Modulus: Product vs LCM

For coprime moduli, the combined modulus is the **product** `M = ∏ mᵢ` (which equals the lcm because coprime). For general moduli, the combined modulus is the **lcm**, `lcm(m₁, m₂) = m₁·m₂ / gcd(m₁, m₂)`. Always think "lcm" — it just happens to equal the product in the coprime case.

---

## The n-Congruence Coprime Construction

For `n` pairwise-coprime moduli, the symmetric **Gauss formula** is:

```
M  = m₁·m₂·…·mₙ
Mᵢ = M / mᵢ                       (product of all moduli except mᵢ)
yᵢ = Mᵢ⁻¹ mod mᵢ                  (inverse exists since gcd(Mᵢ, mᵢ) = 1)
x  = ( Σᵢ aᵢ · Mᵢ · yᵢ ) mod M
```

**Why each term isolates one modulus.** `Mᵢ` is divisible by every `mⱼ` with `j ≠ i`, so the term `aᵢ·Mᵢ·yᵢ` vanishes mod those moduli. Modulo `mᵢ` itself, `Mᵢ·yᵢ ≡ 1`, so the term contributes `aᵢ`. Summing, `x ≡ aᵢ (mod mᵢ)` for every `i` simultaneously.

**`gcd(Mᵢ, mᵢ) = 1`** because `Mᵢ` is a product of moduli each coprime to `mᵢ` (pairwise-coprimality), so the inverse `yᵢ` exists.

**Practical note.** The symmetric formula needs all `Mᵢ`, each a product of `n − 1` moduli — and `aᵢ·Mᵢ·yᵢ` can be enormous. In practice the **fold** (merge pairwise) is usually preferred: it keeps the running modulus exactly `∏ of moduli seen so far` and avoids forming the huge `Mᵢ` products, while giving the identical answer.

---

## The Merge-Based General CRT

This is the workhorse for **arbitrary** (possibly non-coprime) moduli. Merge `x ≡ a₁ (mod m₁)` and `x ≡ a₂ (mod m₂)` into a single `x ≡ a (mod lcm(m₁, m₂))`.

**Derivation.** Write `x = a₁ + m₁·t`. Substituting into the second congruence:

```
a₁ + m₁·t ≡ a₂ (mod m₂)
m₁·t ≡ (a₂ − a₁) (mod m₂)
```

This is a **linear congruence** `m₁·t ≡ c (mod m₂)` with `c = a₂ − a₁`. Let `g = gcd(m₁, m₂)`. It has a solution **iff `g | c`** — and `c = a₂ − a₁`, so the condition is:

> **Consistency condition:** `a₁ ≡ a₂ (mod g)` where `g = gcd(m₁, m₂)`. If this fails, the whole system has **no solution**.

When it holds, run `extgcd(m₁, m₂)` to get `p, q` with `m₁·p + m₂·q = g`. Then `m₁ · (p · (c/g))  ≡ c (mod m₂)`, so a particular `t₀ = p · (c / g) (mod m₂/g)`. Back-substituting:

```
L  = lcm(m₁, m₂) = m₁ / g · m₂           (compute as m₁/g*m₂ to avoid overflow)
t  = ( (a₂ − a₁) / g · p ) mod (m₂ / g)
x  = ( a₁ + m₁ · t ) mod L
return x normalized into [0, L)
```

The result is `x ≡ a (mod L)`, a single congruence to fold with the next. If any merge reports inconsistency, the answer is "no solution".

**Worked non-coprime example.** Solve `x ≡ 2 (mod 6)` and `x ≡ 8 (mod 12)`.

```
g = gcd(6, 12) = 6.  Consistency: 2 ≡ 8 (mod 6)?  2 mod 6 = 2, 8 mod 6 = 2.  ✓
c = a2 − a1 = 6,  c/g = 1.
extgcd(6, 12): 6·1 + 12·0 = 6, so p = 1.
t = (1 · 1) mod (12/6) = 1 mod 2 = 1.
L = (6/6)·12 = 12.
x = (2 + 6·1) mod 12 = 8.   Check: 8 mod 6 = 2 ✓, 8 mod 12 = 8 ✓.
```

So `x ≡ 8 (mod 12)`. An **inconsistent** example: `x ≡ 1 (mod 4)` and `x ≡ 2 (mod 6)`. `g = gcd(4,6) = 2`; `1 mod 2 = 1` but `2 mod 2 = 0` — they disagree mod 2, so **no solution exists**.

---

## Multi-Mod Computation and Reconstruction

The most powerful application: compute a result modulo a big `M` (or even the exact integer) by working modulo several small coprime primes and **CRT-reconstructing**.

**The pattern (avoids overflow / enables NTT-style multi-mod):**

1. Pick coprime primes `p₁, p₂, …, pₙ` with `∏ pᵢ = P > ` (the largest possible true result).
2. Do the *entire* computation independently mod each `pᵢ` — additions, multiplications, even polynomial convolutions. Each component never exceeds `pᵢ` (or `pᵢ²` before reduction), so it fits in a machine word.
3. You now have the result tuple `(r₁, …, rₙ)` with `rᵢ = answer mod pᵢ`.
4. **CRT-reconstruct** the unique `r ∈ [0, P)` from the tuple. Since `P` exceeds the true answer, `r` *is* the exact answer (or the answer mod your target `M`, if you reduce at the end).

This is exactly how **NTT-based big multiplication** beats overflow: a single prime large enough for the convolution would overflow 64 bits during the butterfly, so you run the NTT under 3–4 friendly primes (each `< 2³¹`), multiply pointwise mod each prime, inverse-NTT each, then CRT the per-prime coefficient vectors back. With 3 primes near `10⁹`, the product `P ≈ 10²⁷` safely bounds coefficients that can reach `~ n · (10⁹)²`.

**Number reconstruction** is the same idea standalone: given an unknown `X` and its residues mod several coprime primes, CRT recovers `X` (provided `X < ∏ pᵢ`). Used in distributed/fault-tolerant arithmetic and in algorithms that compute determinants or gcds of big integers prime-by-prime.

**Worked multi-mod example.** Suppose we want `(A · B)` where `A = 123456`, `B = 654321`, and we (pretend to) lack a wide-enough integer type, so we work modulo three small coprime primes `p = 101, 103, 107` (product `1113121 >` the true product? No — here the true product `80779853376` exceeds `1113121`, so three tiny primes are *insufficient*; this is precisely the sizing trap). The lesson the example teaches: **always check `∏ pᵢ` exceeds the maximum possible true result before trusting the reconstruction.** With primes near `10⁹` instead, `A·B < 10¹² < (10⁹)²`, so two such primes already suffice, and the reconstruction is exact. Sizing the prime product against the result bound is the single most important correctness check in multi-mod work.

---

## Garner's Algorithm Preview

Plain CRT reconstructs `x` in `[0, M)` directly. **Garner's algorithm** instead writes `x` in a **mixed-radix** (factorial-like) representation relative to the moduli:

```
x = c₁ + c₂·m₁ + c₃·m₁·m₂ + … + cₙ·m₁·m₂·…·m_{n-1}
```

where each digit `cᵢ ∈ [0, mᵢ)` is computed by a forward sweep using precomputed inverses `inv[i][j] = mᵢ⁻¹ mod mⱼ`. The advantages:

- **All intermediate digits are small** (`< mᵢ`), so the heavy reconstruction never overflows even when `M` does not fit in a word — you only assemble the big number at the very end (in big-integer arithmetic) or reduce mod a target on the fly.
- The inverses depend only on the **moduli**, not the residues, so they are precomputed once and reused across many reconstructions (ideal for multi-mod NTT with fixed primes).

Garner is the practical reconstruction engine when `M` exceeds 64 bits and you do not want full big-integer CRT. It is covered in depth in sibling topic `15-garner`; treat plain CRT as the "what" and Garner as the "how to do it fast and overflow-free for many residues".

**Why the digits stay small (and why that matters).** In `x = c₁ + c₂m₁ + c₃m₁m₂ + …`, each `cₖ` is computed *modulo `mₖ`*, so `0 ≤ cₖ < mₖ` always — independent of how large the final `x` grows. Contrast with the symmetric Gauss formula, where the term `aᵢMᵢyᵢ` is already near the size of `M` before you even sum. Garner therefore lets you (a) reduce mod a target prime on the fly during the Horner assembly, so you never materialize a number bigger than the target, or (b) defer the big-integer assembly to a single final pass. This is the property that makes Garner the default for NTT multi-mod with fixed primes: the inverses `inv[i][j] = mᵢ⁻¹ mod mⱼ` are precomputed once from the moduli, and each coefficient's reconstruction is then a short sequence of in-word multiplications.

**Mixed-radix as a number system.** The Garner representation is genuinely a positional system with *varying* radices `m₁, m₂, …` (a factorial-number-system generalization). Converting *into* it is the reconstruction; converting *back out* (evaluating the Horner sum) gives the ordinary integer. Many RNS algorithms stay in mixed-radix form as long as possible because comparison and sign detection are easy there (compare the most-significant nonzero digit), recovering capabilities that pure residue form lacks.

**Garner vs plain CRT — when each wins.** Use plain CRT (the fold) when `M` fits in a machine word and you solve each system once: it is the fewest lines and the inverses are cheap. Switch to Garner when (a) `M` overflows a word so you need small intermediates, or (b) you reconstruct *many* values with the *same* moduli, so the `O(n²)` inverse precomputation amortizes. In multi-mod NTT both conditions hold — the moduli are a fixed small set of primes and there are as many reconstructions as output coefficients — which is why Garner is the standard there. For a one-off generalized (non-coprime) merge, plain CRT with the consistency check is simpler; Garner assumes coprimality.

---

## Comparison with Alternatives

| Approach | Moduli | Combined modulus | Detects no-solution? | Best when |
|----------|--------|------------------|----------------------|-----------|
| Symmetric Gauss formula | pairwise coprime | product `M` | no (assumes coprime) | small `n`, want the closed form |
| Pairwise fold (coprime merge) | pairwise coprime | product `M` | no | general `n`, simplest correct code |
| General gcd-based merge | arbitrary | `lcm` | **yes** (consistency check) | moduli may share factors |
| Garner (mixed radix) | pairwise coprime | product `M` | no | `M` overflows word; many reconstructions |
| Brute-force scan | arbitrary | `lcm` | yes | tiny moduli only (testing oracle) |

**Rules of thumb:**

- Moduli guaranteed coprime and `M` fits in 64 bits → **pairwise fold**.
- Moduli might share factors → **general merge** with consistency check.
- `M` overflows a word, or you reconstruct repeatedly with fixed moduli → **Garner**.
- Need to multiply/convolve big numbers exactly → **multi-mod + CRT** (often via Garner).

**Versus solving the equations directly.** A natural question: why not just iterate `x = a₁, a₁ + m₁, a₁ + 2m₁, …` and test the other congruences? That brute-force search is `O(M)` in the worst case — fine for tiny moduli (and it makes a good test oracle) but hopeless for `M` near `10¹⁸`. CRT replaces the linear search with a *direct* construction in `O(n log M)`. The merge's modular inverse does in one `extgcd` what the search would do in up to `m₂` trial steps. This is the same "compute the answer instead of searching for it" leap that, e.g., the closed-form sum `1+…+n = n(n+1)/2` provides over a loop.

---

## Code Examples

### Example: General Merge CRT (Handles Non-Coprime + No-Solution)

#### Go

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

// crtMerge combines x≡a1 (mod m1), x≡a2 (mod m2) for ARBITRARY m1, m2.
// Returns (a, lcm, ok). ok=false means the system is inconsistent.
func crtMerge(a1, m1, a2, m2 int64) (int64, int64, bool) {
	g, p, _ := extgcd(m1, m2)
	c := a2 - a1
	if c%g != 0 {
		return 0, 0, false // consistency condition fails
	}
	lcm := m1 / g * m2
	mod := m2 / g
	t := ((c/g%mod)*(p%mod))%mod
	t = ((t % mod) + mod) % mod
	x := (a1 + m1*t) % lcm
	return ((x % lcm) + lcm) % lcm, lcm, true
}

func main() {
	a, m, ok := crtMerge(2, 6, 8, 12)
	fmt.Println(a, m, ok) // 8 12 true
	_, _, ok2 := crtMerge(1, 4, 2, 6)
	fmt.Println(ok2)       // false (no solution)
}
```

#### Java

```java
public class CrtMerge {
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    // Returns {a, lcm, ok}; ok==0 means inconsistent.
    static long[] crtMerge(long a1, long m1, long a2, long m2) {
        long[] e = extgcd(m1, m2);
        long g = e[0], p = e[1];
        long c = a2 - a1;
        if (c % g != 0) return new long[]{0, 0, 0};
        long lcm = m1 / g * m2;
        long mod = m2 / g;
        long t = ((c / g % mod) * (p % mod)) % mod;
        t = ((t % mod) + mod) % mod;
        long x = (a1 + m1 * t) % lcm;
        return new long[]{((x % lcm) + lcm) % lcm, lcm, 1};
    }

    public static void main(String[] args) {
        long[] r = crtMerge(2, 6, 8, 12);
        System.out.println(r[0] + " " + r[1] + " ok=" + r[2]); // 8 12 ok=1
        System.out.println("ok=" + crtMerge(1, 4, 2, 6)[2]);   // ok=0
    }
}
```

#### Python

```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def crt_merge(a1, m1, a2, m2):
    """Merge for arbitrary moduli. Returns (a, lcm) or None if inconsistent."""
    g, p, _ = extgcd(m1, m2)
    c = a2 - a1
    if c % g != 0:
        return None                     # consistency condition fails
    lcm = m1 // g * m2
    mod = m2 // g
    t = (c // g) * p % mod
    x = (a1 + m1 * t) % lcm
    return x % lcm, lcm


def crt_general(residues, moduli):
    a, m = 0, 1
    for ai, mi in zip(residues, moduli):
        merged = crt_merge(a, m, ai % mi, mi)
        if merged is None:
            return None
        a, m = merged
    return a, m


if __name__ == "__main__":
    print(crt_merge(2, 6, 8, 12))                  # (8, 12)
    print(crt_merge(1, 4, 2, 6))                   # None
    print(crt_general([2, 3, 2], [3, 5, 7]))       # (23, 105)
```

**Run:** `go run main.go` | `javac CrtMerge.java && java CrtMerge` | `python crt_general.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Returns a value when there is no solution | Skipped the consistency check. | Verify `(a₂−a₁) % gcd(m₁,m₂) == 0` before merging. |
| Overflow in `m₁ * m₂` for the lcm | Multiplied before dividing by gcd. | Compute `lcm = m₁ / g * m₂` (divide first). |
| Wrong `t`, negative | `c/g · p` left in a negative class. | Reduce modulo `m₂/g` and normalize to `[0, mod)`. |
| Symmetric formula gives garbage | Moduli not pairwise coprime. | Use the general merge instead. |
| Reconstruction overflows for big `M` | `M` exceeds 64 bits. | Use Garner / big integers (`15-garner`, `senior.md`). |
| Inverse missing in coprime path | A modulus is `1` or duplicated. | Seed the fold with `(0, 1)`; deduplicate equal moduli. |
| Wrong answer only for some inputs | Residue not reduced before merge. | Normalize `aᵢ = aᵢ mod mᵢ` (handle negatives) first. |
| Off-by-`lcm` final result | Used product instead of lcm for non-coprime. | Combined modulus is `lcm`, not the product. |
| Symmetric formula sum overflows | `aᵢ·Mᵢ·yᵢ` near `M` summed `n` times. | Reduce mod `M` after each term, or use the fold. |

---

## Performance Analysis

- **Fold cost:** `n − 1` merges, each one `extgcd` (`O(log m)`) plus `O(1)` arithmetic → `O(n log M)` total.
- **Symmetric formula:** `n` inverses plus building `n` partial products `Mᵢ`; comparable asymptotically but with bigger constants and bigger intermediate numbers.
- **Garner:** `O(n²)` to compute all pairwise inverses `inv[i][j]` once (precomputable), then `O(n²)` per reconstruction for the mixed-radix digits — but every operation stays in a machine word, which is the real win when `M` overflows.
- **Multi-mod compute:** the dominant cost is the per-prime computation (e.g., `n` independent NTTs), and CRT/Garner is a cheap `O(coeffs · primes²)` post-process.

The CRT step itself is almost never the bottleneck; the per-modulus computation is. Choose moduli that keep each component's arithmetic in-word and the count `n` minimal.

---

## Worked Example: Folding Four Congruences

Solve the coprime system below by folding pairwise, carrying a running `(a, m)`:

```
x ≡ 1 (mod 2)
x ≡ 2 (mod 3)
x ≡ 3 (mod 5)
x ≡ 4 (mod 7)
```

```
Start:  (a, m) = (1, 2)                          # seed with the first congruence
Merge  x ≡ 2 (mod 3):
    diff = (2 − 1) mod 3 = 1
    t    = diff · inv(2, 3) = 1 · 2 = 2 (mod 3)
    a    = 1 + 2·2 = 5;  m = 6                    # (a, m) = (5, 6)
Merge  x ≡ 3 (mod 5):
    diff = (3 − 5) mod 5 = 3
    t    = 3 · inv(6, 5) = 3 · inv(1,5) = 3 (mod 5)
    a    = 5 + 6·3 = 23;  m = 30                  # (a, m) = (23, 30)
Merge  x ≡ 4 (mod 7):
    diff = (4 − 23) mod 7 = (−19) mod 7 = 2
    t    = 2 · inv(30, 7) = 2 · inv(2,7) = 2·4 = 8 ≡ 1 (mod 7)
    a    = 23 + 30·1 = 53;  m = 210               # (a, m) = (53, 210)
```

**Answer:** `x ≡ 53 (mod 210)`. Verify: `53 mod 2 = 1`, `53 mod 3 = 2`, `53 mod 5 = 3`, `53 mod 7 = 4`. Each merge only ever computed one inverse modulo the *new* modulus, and the running modulus grew `2 → 6 → 30 → 210` — exactly the product of moduli seen so far. This is the fold pattern in action: linear in the number of congruences, no giant `Mᵢ` products.

---

## Garner Reconstruction Code

The mixed-radix digits `cᵢ` stay below `mᵢ`, so this reconstructs overflow-safely. Inverses depend only on the moduli and are precomputed.

### Go
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x, y := extgcd(b, a%b)
	return g, y, x - (a/b)*y
}
func inv(a, m int64) int64 { _, x, _ := extgcd(((a%m)+m)%m, m); return ((x % m) + m) % m }

// garner returns the mixed-radix digits and the reconstructed value (small case).
func garner(res, mod []int64) int64 {
	n := len(res)
	c := make([]int64, n)
	for k := 0; k < n; k++ {
		c[k] = res[k]
		for j := 0; j < k; j++ {
			c[k] = (c[k] - c[j]) % mod[k]
			c[k] = (c[k]*inv(mod[j], mod[k]))%mod[k]
		}
		c[k] = ((c[k] % mod[k]) + mod[k]) % mod[k]
	}
	// assemble x = c0 + c1*m0 + c2*m0*m1 + ...
	x, prod := int64(0), int64(1)
	for k := 0; k < n; k++ {
		x += c[k] * prod
		prod *= mod[k]
	}
	return x
}
func main() { fmt.Println(garner([]int64{2, 3, 2}, []int64{3, 5, 7})) } // 23
```

### Java
```java
public class Garner {
    static long[] eg(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = eg(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long inv(long a, long m) { long x = eg(((a % m) + m) % m, m)[1]; return ((x % m) + m) % m; }
    static long garner(long[] res, long[] mod) {
        int n = res.length;
        long[] c = new long[n];
        for (int k = 0; k < n; k++) {
            c[k] = res[k];
            for (int j = 0; j < k; j++) {
                c[k] = (c[k] - c[j]) % mod[k];
                c[k] = (c[k] * inv(mod[j], mod[k])) % mod[k];
            }
            c[k] = ((c[k] % mod[k]) + mod[k]) % mod[k];
        }
        long x = 0, prod = 1;
        for (int k = 0; k < n; k++) { x += c[k] * prod; prod *= mod[k]; }
        return x;
    }
    public static void main(String[] a) {
        System.out.println(garner(new long[]{2, 3, 2}, new long[]{3, 5, 7})); // 23
    }
}
```

### Python
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def inv(a, m):
    return extgcd(a % m, m)[1] % m

def garner(res, mod):
    n = len(res)
    c = [0] * n
    for k in range(n):
        c[k] = res[k] % mod[k]
        for j in range(k):
            c[k] = (c[k] - c[j]) * inv(mod[j], mod[k]) % mod[k]
    x, prod = 0, 1
    for k in range(n):          # big-int assembly is exact in Python
        x += c[k] * prod
        prod *= mod[k]
    return x

if __name__ == "__main__":
    print(garner([2, 3, 2], [3, 5, 7]))  # 23
```

---

## Calendar and Cycle Applications

CRT is the natural tool for "when do periodic events coincide" problems:

- **Gear / cycle alignment.** Three gears of `m₁, m₂, m₃` teeth start at offsets `a₁, a₂, a₃`. They realign at the smallest `x ≡ aᵢ (mod mᵢ)` — a generalized CRT, with the period being the `lcm`.
- **Calendar coincidences.** "A festival every 12 days, a market every 20 days; when do both fall on the same day?" Set up the congruences; share-a-factor moduli need the consistency check (and may never coincide).
- **Round-robin scheduling.** Assigning tasks to slots modulo several cycle lengths so no two collide reduces to building a consistent residue system.
- **Hashing / sharding sanity.** Reconstructing a key from per-shard residues (shard = key mod shardCount) is a CRT when shard counts are coprime — used in some distributed-hash reconstruction schemes.

The recurring subtlety: real-world periods are frequently **not** coprime (12 and 20 share a factor of 4), so you must use the general merge and be ready to report "they never coincide" when the offsets are inconsistent.

**Worked cycle example.** Festival every 12 days starting day 3 (`x ≡ 3 mod 12`), market every 20 days starting day 7 (`x ≡ 7 mod 20`). `g = gcd(12, 20) = 4`; consistency requires `3 ≡ 7 (mod 4)` — both are `3 mod 4`, so they *can* coincide. Merge: `lcm = 12/4·20 = 60`; solving gives `x ≡ 27 (mod 60)`. Check: `27 mod 12 = 3`, `27 mod 20 = 7`. So the first coincidence is day 27, recurring every 60 days. Had the market started on day 8 (`8 mod 4 = 0 ≠ 3`), the events would **never** coincide — the consistency check would report no solution.

---

## Best Practices

- Default to the **general merge** with a consistency check unless you can *prove* the moduli are pairwise coprime — it costs nothing extra and never silently returns a wrong answer.
- Compute `lcm` as `m₁ / g * m₂` (divide before multiply) to delay overflow.
- For fixed moduli reused across many reconstructions, **precompute inverses** and prefer Garner.
- When choosing primes for multi-mod, pick them so the product safely exceeds the maximum possible true value, with a margin.
- Keep `extgcd` exact and well-tested; every CRT path depends on it.
- Always normalize the merged residue into `[0, lcm)` so subsequent merges and comparisons behave.

---

## Common Pitfalls at This Level

- **Confusing pairwise-coprime with set-coprime.** `{6, 10, 15}` has overall `gcd = 1` but pairwise `gcd(6, 10) = 2`, so the symmetric Gauss formula is invalid; the general merge still works.
- **Building the symmetric formula when the fold is simpler.** Forming all `Mᵢ = M/mᵢ` invites huge intermediates and overflow; the fold avoids them and is fewer lines.
- **Skipping the consistency check "because the moduli look coprime".** If the moduli are data-derived, prove coprimality or check consistency — do not assume.
- **Reducing the multi-mod result too early.** Reconstruct the full value (or mixed-radix digits) first, reduce mod the target *last*, or you lose information.
- **Reusing inverses computed for the wrong moduli.** Garner's `inv[i][j]` depends on the specific moduli; recompute (or re-key the cache) if the moduli change.
- **Assuming the combined modulus is the product.** It is the **lcm**; only for coprime moduli does it equal the product. For `{4, 6}` the combined modulus is `12`, not `24`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - Each congruence as a residue class highlighted on a number line
> - The merge of two classes into one combined class modulo the `lcm`
> - The consistency check flagged when non-coprime moduli disagree
> - The unique solution in `[0, M)`, with editable `aᵢ`, `mᵢ` and step controls

---

## Summary

**Quick decision guide.** Coprime moduli, `M` in a word, one system → coprime fold. Possibly non-coprime → general merge with consistency check. `M` overflows or many reconstructions with fixed moduli → Garner. Big computation you want to avoid overflowing → compute mod several small primes and CRT-reconstruct. These four cover essentially every practical CRT scenario.

The middle-level toolkit extends two-congruence CRT in three directions. First, `n` coprime congruences: either the symmetric Gauss formula (`Mᵢ = M/mᵢ`, multiply by its inverse, sum) or — usually better — a pairwise **fold**. Second, **non-coprime** moduli: the general merge solves the linear congruence `m₁·t ≡ a₂ − a₁ (mod m₂)`, which is solvable **iff** the consistency condition `a₁ ≡ a₂ (mod gcd(m₁, m₂))` holds; otherwise the system has no solution, and the combined modulus is the `lcm`. Third, **multi-mod computation**: do a big-modulus calculation as several small-prime calculations and CRT-reconstruct the result tuple, which is how NTT-based big multiplication dodges overflow. **Garner's algorithm** is the overflow-safe mixed-radix reconstruction engine for when `M` exceeds a machine word. Master the general merge and the multi-mod reconstruction pattern and you have the production form of CRT.

**One-paragraph mental model.** Think of CRT as a two-way translator between a single big number and its tuple of residues. Going *forward* (number → residues) is trivial: just take remainders. Going *back* (residues → number) is the interesting direction, and it is exactly what the merge/fold/Garner algorithms do. Coprimality is what makes the back-translation always possible and unique; without it, the translation works only when the residues agree on the shared parts (the consistency condition), and the "address space" you translate back into shrinks from the product to the lcm. Every application — number reconstruction, overflow-free big computation, RSA-CRT — is just one of these two translations applied at the right moment.

**Where to go next.** Once the general merge and multi-mod reconstruction are comfortable, the natural follow-ups are: Garner's algorithm in full (sibling `15-garner`) for fast, overflow-safe reconstruction with fixed moduli; the modular-inverse machinery (`03-modular-inverse`) that every merge depends on; and the NTT (sibling topics) where multi-mod CRT is the standard tool for big-integer and polynomial multiplication. The senior file in this same topic covers the production concerns — overflow discipline, prime selection, RSA-CRT, and failure handling — that turn these algorithms into reliable components.

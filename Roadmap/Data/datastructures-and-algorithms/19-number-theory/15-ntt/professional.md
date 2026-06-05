# Number-Theoretic Transform (NTT) — Mathematical Foundations

## Table of Contents
1. Formal Setting: Roots of Unity in `Z/pZ`
2. Existence: When Does a Primitive `n`-th Root Exist?
3. NTT-Friendly Primes and the 2-adic Valuation
4. The Forward and Inverse Transform
5. Inversion Correctness (the `n^{-1}` Scaling)
6. The Convolution Theorem over a Finite Field
7. The Iterative Butterfly: Correctness and Complexity
8. Multi-Prime CRT: The Reconstruction Bound
9. Complexity: O(n log n) and the Modular Cost Model
10. Relation to FFT and to Other Fast-Multiplication Methods
11. Summary

---

## 1. Formal Setting: Roots of Unity in `Z/pZ`

Let `p` be an odd prime. The nonzero residues `Z/pZ* = {1, …, p−1}` form a multiplicative group of order `p − 1`, and a classical theorem (sibling `12-primitive-root-discrete-root`) states this group is **cyclic**: there is a generator `g` (a *primitive root*) whose powers `g^0, g^1, …, g^{p-2}` are exactly the `p − 1` nonzero residues.

**Definition 1.1 (Primitive `n`-th root of unity mod `p`).** An element `ω ∈ Z/pZ*` is a **primitive `n`-th root of unity** if `ω^n ≡ 1 (mod p)` and `ω^m ≢ 1 (mod p)` for every `0 < m < n`. Equivalently, `ω` has multiplicative **order** exactly `n`.

**Remark.** This mirrors the complex `e^{2πi/n}`, which satisfies `(e^{2πi/n})^n = 1` and no smaller positive power equals `1`. The NTT replaces the complex root by Definition 1.1's `ω`; every algebraic identity the FFT uses (`05-fft`) carries over because they depend only on the order-`n` and geometric-series properties, which hold in any field.

**The two properties the algorithm actually uses.** Strip the FFT down and only two facts about the root are ever invoked: (i) `ω^n = 1` (it is an `n`-th root), used to reduce exponents mod `n` and make cyclic convolution become pointwise product (Theorem 6.2); and (ii) `ω^d ≠ 1` for `0 < d < n` (primitivity), used so the geometric series `Σ_t (ω^d)^t` collapses to `0` rather than `n` for `d ≢ 0` (Lemma 5.1). Both hold for `e^{2πi/n}` in `C` and for `g^{(p-1)/n}` in `Z/pZ`. There is no third property — which is exactly why the FFT code transplants to `Z/pZ` line for line, swapping complex multiply for modular multiply.

**Notation.** Throughout, `p` is the prime modulus, `g` a primitive root of `p`, `n = 2^L` the transform length (a power of two), `ω = g^{(p-1)/n}` the working root, `a = (a_0, …, a_{n-1})` the coefficient vector, `â` its transform, `⊛` cyclic convolution, `∘` pointwise product, and `M(·)` the integer-multiplication cost. The Iverson bracket `[P]` is `1` if `P` holds else `0`. The **order** of `x ∈ Z/pZ*` is the least positive `e` with `x^e ≡ 1`; the **2-adic valuation** `v_2(m)` is the largest `j` with `2^j | m`.

**Why a finite field rather than a ring?** The transform needs the field's nonzero elements to form a *cyclic* group, which is what guarantees a generator `g` and hence roots of unity (Theorem 2.1). General rings `Z/mZ` for composite `m` are not fields and their unit groups need not be cyclic, so the existence argument fails; this is precisely why NTT demands a *prime* modulus (or a carefully chosen ring like `Z/(2^k+1)Z` for Schönhage-Strassen, Section 10). The single structural fact "`Z/pZ*` is cyclic" is the foundation the entire topic stands on.

---

## 2. Existence: When Does a Primitive `n`-th Root Exist?

**Theorem 2.1.** `Z/pZ*` contains an element of order `n` **if and only if** `n | (p − 1)`.

**Proof.** `Z/pZ*` is cyclic of order `p − 1` with generator `g` (sibling `12`). In a cyclic group of order `m`, an element of order exactly `d` exists iff `d | m`, and the elements of order `d` are `g^{(m/d)·t}` for `t` coprime to `d`. Apply with `m = p − 1`, `d = n`: an order-`n` element exists iff `n | (p − 1)`. ∎

**Corollary 2.2 (Construction).** If `n | (p − 1)`, then

```
ω = g^{(p-1)/n} mod p
```

is a primitive `n`-th root of unity.

**Proof.** `ω^n = g^{(p-1)} ≡ 1` by Fermat's little theorem. Its order divides `n`; if the order were a proper divisor `m = n/q` (`q > 1` prime), then `g^{(p-1)/q} ≡ 1`, contradicting that `g` has order `p − 1` (since `(p-1)/q < p-1`). Hence `ord(ω) = n` exactly. ∎

**Why a power of two.** The Cooley-Tukey butterfly (`05-fft`) halves the problem size repeatedly, so it needs `n = 2^L` and a root `ω` with the **halving property** `ω^{n/2} ≡ −1`. Indeed, `ω^{n/2}` is a square root of `ω^n = 1`, so `ω^{n/2} ∈ {+1, −1}`; it cannot be `+1` (that would make `ω`'s order divide `n/2`), so `ω^{n/2} ≡ −1`. This is the exact finite-field analogue of `e^{πi} = −1` and is what makes the divide-and-conquer split valid mod `p`.

**Lemma 2.3 (Square-of-root recursion).** The size-`n/2` sub-transforms in Cooley-Tukey use the root `ω²`, which is a primitive `(n/2)`-th root of unity. **Proof.** `(ω²)^{n/2} = ω^n = 1`, and if `(ω²)^m = 1` for `0 < m < n/2` then `ω^{2m} = 1` with `0 < 2m < n`, contradicting that `ω` has order `n`. So `ω²` has order exactly `n/2`. ∎ This is why the recursion is well-defined: at each level the root squares and the size halves, in lockstep, all the way down to the length-1 base case where the transform is the identity.

---

## 3. NTT-Friendly Primes and the 2-adic Valuation

By Theorem 2.1, a transform of length `n = 2^L` needs `2^L | (p − 1)`. Write the **2-adic valuation** `v_2(p − 1) = k`, i.e. `p − 1 = c · 2^k` with `c` odd.

**Proposition 3.1.** `Z/pZ` supports NTT of every length `2^L` with `L ≤ k`, and of no larger power of two.

**Proof.** `2^L | (p−1) = c·2^k` iff `L ≤ k` (since `c` is odd). Apply Theorem 2.1. ∎

**Definition 3.2 (NTT-friendly prime).** A prime `p = c · 2^k + 1` with `k` large is **NTT-friendly**; `k` is its 2-adic valuation and caps the transform size at `2^k`.

**Canonical example.** `998244353 = 119 · 2^23 + 1`, so `k = 23`, `c = 119`, supporting `n ≤ 2^23 ≈ 8.39 × 10^6`. A primitive root is `g = 3` (verifiable: `3` has order `p−1` mod `p`). Then for any `n = 2^L ≤ 2^{23}`, `ω = 3^{(p-1)/n} mod p` is a primitive `n`-th root.

**Building the inverse root.** `ω^{-1} = ω^{p-2} mod p` (Fermat) `= g^{(p-1) − (p-1)/n} mod p`. Both exist because `gcd(ω, p) = 1`.

**Common friendly primes (derivation).** Each is `c·2^k + 1` with `c` odd, so `v_2(p−1) = k`:

| `p` | `c · 2^k + 1` | `k = v_2(p−1)` | max `n` | `g` |
|-----|---------------|----------------|---------|-----|
| `998244353` | `119 · 2^23 + 1` | 23 | `2^23` | 3 |
| `985661441` | `235 · 2^22 + 1` | 22 | `2^22` | 3 |
| `469762049` | `7 · 2^26 + 1` | 26 | `2^26` | 3 |
| `167772161` | `5 · 2^25 + 1` | 25 | `2^25` | 3 |
| `2013265921` | `15 · 2^27 + 1` | 27 | `2^27` | 31 |

The 2-adic valuation `k` is read directly off the factorization, and it alone caps the transform size (Proposition 3.1). The primitive root `g` is found once (sibling `12-primitive-root-discrete-root`) and tabulated.

### 3.1 Worked Existence Example

Take `p = 17 = 1·2^4 + 1`, so `k = 4` and `Z/17Z` supports `n ∈ {2, 4, 8, 16}`. A primitive root is `g = 3` (its order is `16`, verified since `3^8 = 6561 ≡ 16 ≡ −1`, so its order is not a proper divisor of `16`). For `n = 4`:

```
ω = 3^{(17-1)/4} = 3^4 = 81 ≡ 81 − 4·17 = 13 (mod 17).
```

Check the order: `ω^2 = 13^2 = 169 ≡ 169 − 9·17 = 16 ≡ −1`, and `ω^4 = (ω^2)^2 = (−1)^2 = 1`. So `ω = 13` has order exactly `4`, and the halving property `ω^{n/2} = ω^2 = −1` holds — exactly what the size-4 butterfly needs. Requesting `n = 32` would need `32 | 16`, which is false (Theorem 2.1), so `17` cannot support a length-32 transform: this is the 2-adic ceiling `2^k` made concrete.

### 3.2 Why `10^9 + 7` Is Not NTT-Friendly

`10^9 + 7` is prime, but `10^9 + 6 = 2 · 500000003`, where `500000003` is odd. Thus `v_2(p − 1) = 1`: the only power-of-two dividing `p − 1` is `2`, supporting transforms of length at most `2`. No `n`-th root for `n ≥ 4` exists in `Z/(10^9+7)Z` (Theorem 2.1), which is precisely why answers wanted mod `10^9 + 7` force the multi-prime + CRT route of Section 8.

---

## 4. The Forward and Inverse Transform

**Definition 4.1 (Forward NTT).** For `a = (a_0, …, a_{n-1}) ∈ (Z/pZ)^n` and primitive `n`-th root `ω`,

```
â[t] = Σ_{m=0}^{n-1} a[m] · ω^{tm}  (mod p),   t = 0, …, n−1.
```

This is the evaluation of the polynomial `A(x) = Σ a_m x^m` at the points `ω^0, ω^1, …, ω^{n-1}`. As a matrix, `â = V a` with the Vandermonde matrix `V[t][m] = ω^{tm}`.

**Definition 4.2 (Inverse NTT).**

```
a[m] = n^{-1} · Σ_{t=0}^{n-1} â[t] · ω^{-tm}  (mod p),   m = 0, …, n−1,
```

i.e. the same transform with `ω` replaced by `ω^{-1}`, then a global scale by `n^{-1} mod p`. The matrix is `V^{-1}`, and Section 5 proves `V^{-1}[m][t] = n^{-1} ω^{-tm}`.

Both transforms exist over `Z/pZ`: `ω, ω^{-1}, n^{-1}` are all units mod `p` (`n = 2^L` is coprime to the odd prime `p`).

### 4.1 The Vandermonde Matrix Made Explicit

For `p = 17`, `n = 4`, `ω = 13`, the forward transform matrix `V[t][m] = ω^{tm} mod 17` is

```
        m=0  m=1  m=2  m=3
t=0  [   1    1    1    1  ]
t=1  [   1   13   16    4  ]      (powers of ω^1 = 13)
t=2  [   1   16    1   16  ]      (powers of ω^2 = 16 = −1)
t=3  [   1    4   16   13  ]      (powers of ω^3 = 4 = ω^{-1})
```

Multiplying `V` by the coefficient column `[1,2,0,0]^T` gives `[3, 27, 33, 9]^T ≡ [3, 10, 16, 9]^T` — exactly the forward transform of Section 6.1. The inverse matrix `V^{-1} = n^{-1}·\bar V` uses `ω^{-tm}` and the scale `4^{-1} = 13`; `V·V^{-1} = I` over `Z/17Z`, which is Corollary 5.3 in this `4×4` instance. The FFT/NTT never forms `V` explicitly — the butterfly computes `V·a` in `O(n log n)` instead of the naive `O(n²)` matrix-vector product — but the matrix view makes the linear-algebra content concrete.

---

## 5. Inversion Correctness (the `n^{-1}` Scaling)

The single algebraic fact behind both inversion and the convolution theorem is the **geometric-series / orthogonality identity**.

**Lemma 5.1 (Root orthogonality).** For a primitive `n`-th root `ω` mod `p` and any integer `d`,

```
Σ_{t=0}^{n-1} ω^{td} ≡ n · [d ≡ 0 (mod n)]  (mod p).
```

**Proof.** If `d ≡ 0 (mod n)`, each term `ω^{td} = (ω^n)^{t·(d/n)} = 1`, so the sum is `n`. Otherwise `ω^d ≠ 1` (as `ω` has order `n` and `n ∤ d`), and the finite geometric series gives

```
Σ_{t=0}^{n-1} (ω^d)^t = (ω^{dn} − 1)/(ω^d − 1) = (1 − 1)/(ω^d − 1) = 0,
```

using `ω^{dn} = (ω^n)^d = 1` and that `ω^d − 1` is invertible mod `p` (nonzero in the field). ∎

**Theorem 5.2 (Inversion).** The map of Definition 4.2 inverts the forward NTT: applying inverse-NTT to `â` recovers `a`.

**Proof.** Substitute the forward formula into the inverse:

```
n^{-1} Σ_t â[t] ω^{-tm}
  = n^{-1} Σ_t ( Σ_{m'} a[m'] ω^{tm'} ) ω^{-tm}
  = n^{-1} Σ_{m'} a[m'] ( Σ_t ω^{t(m'-m)} )
  = n^{-1} Σ_{m'} a[m'] · n · [m' ≡ m (mod n)]      (Lemma 5.1)
  = a[m],
```

since `0 ≤ m, m' < n` forces `m' ≡ m (mod n) ⇔ m' = m`. The factor `n^{-1} · n = 1` is exactly why the inverse must scale by `n^{-1}`. ∎

**Corollary 5.3.** `V` is invertible over `Z/pZ` with `V^{-1} = n^{-1} \bar V`, where `\bar V[m][t] = ω^{-tm}`. The forward and inverse transforms are the same algorithm parameterized by `(ω, 1)` vs `(ω^{-1}, n^{-1})`.

### 5.1 Worked Orthogonality Check mod 17

With `p = 17`, `n = 4`, `ω = 13` (Section 3.1), verify Lemma 5.1 for `d = 1` (should be `0`) and `d = 4` (should be `n = 4`):

```
Σ_{t=0}^{3} ω^{t·1} = 1 + 13 + 16 + 4 = 34 ≡ 0 (mod 17).   ✓ (d=1, not ≡0 mod 4)
Σ_{t=0}^{3} ω^{t·4} = 1 + 1 + 1 + 1 = 4 ≡ 4 (mod 17).        ✓ (d=4 ≡ 0 mod 4)
```

The first sum vanishes because `ω^1 = 13 ≠ 1` makes it a full geometric cycle; the second is `n` copies of `1` because `ω^4 = 1`. This `0`-or-`n` dichotomy is the entire engine of both inversion (Theorem 5.2) and the convolution theorem (Theorem 6.2): the `n` that appears for `d ≡ 0` is exactly what the `n^{-1}` scaling cancels.

### 5.2 Worked Inversion Round-Trip

Take `a = [3, 10, 16, 9]` (the forward transform of `[1,2,0,0]` from Section 6.1). Applying the inverse with `ω^{-1} = 4` and scale `n^{-1} = 13` recovers the coefficients:

```
recovered[0] = 13·(3 + 10 + 16 + 9)        = 13·38 ≡ 13·4  = 52 ≡ 1.
recovered[1] = 13·(3 + 10·4 + 16·16 + 9·64) (reduced mod 17) = 2.
recovered[2] = 0,  recovered[3] = 0.
```

So the round-trip gives `[1, 2, 0, 0]` — the original input. This is Theorem 5.2 in numbers, and it is exactly the `intt(ntt(a)) == a` test that any implementation must pass; a missing `n^{-1}` would yield `[4, 8, 0, 0]` (everything `n = 4×` too large).

---

## 6. The Convolution Theorem over a Finite Field

**Definition 6.1 (Cyclic convolution).** For `a, b ∈ (Z/pZ)^n`,

```
(a ⊛ b)[k] = Σ_{i+j ≡ k (mod n)} a[i] b[j]  (mod p).
```

**Theorem 6.2 (Convolution theorem).** With pointwise product `(x ∘ y)[t] = x[t]·y[t]`,

```
NTT(a ⊛ b) = NTT(a) ∘ NTT(b),    hence    a ⊛ b = INTT( NTT(a) ∘ NTT(b) ).
```

**Proof.** Evaluate at `ω^t`. The transform of `a ⊛ b` at index `t` is

```
\widehat{a ⊛ b}[t] = Σ_k (a ⊛ b)[k] ω^{tk}
   = Σ_k ( Σ_{i+j ≡ k} a[i] b[j] ) ω^{tk}
   = Σ_i Σ_j a[i] b[j] ω^{t(i+j)}            (reindex k = i+j mod n; ω^{tn} = 1)
   = ( Σ_i a[i] ω^{ti} )( Σ_j b[j] ω^{tj} )
   = â[t] · b̂[t].
```

The step `ω^{t(i+j mod n)} = ω^{t(i+j)}` is valid because `ω^{tn} = 1`, so reduction of the exponent mod `n` does not change the value — this is precisely the property that makes the transform turn cyclic convolution into a pointwise product. ∎

**Corollary 6.3 (Linear convolution / polynomial product).** If `a`, `b` are zero-padded so that `n ≥ len(a) + len(b) − 1`, then the cyclic convolution `a ⊛ b` equals the **linear** convolution (the coefficient vector of `A(x)·B(x)`), because no index `i + j` reaches `n` to wrap. Thus

```
coeff(A·B) = INTT( NTT(a) ∘ NTT(b) ),   exact in Z/pZ.
```

This is the entire NTT polynomial-multiply algorithm, and its correctness is exactly Theorem 6.2 + the padding bound. Under-padding violates the hypothesis of Corollary 6.3 and produces the cyclic (wrapped) result instead — the formal reason the "pad to `≥ len(a)+len(b)−1`" rule is mandatory.

### 6.1 Worked Convolution Example mod 17

Multiply `A(x) = 1 + 2x` by `B(x) = 3 + 4x` over `Z/17Z` with `n = 4`, `ω = 13` (Section 3.1). The true product is `3 + 10x + 8x²`, so we expect `c = [3, 10, 8, 0]`.

Forward-transform `a = [1,2,0,0]` and `b = [3,4,0,0]` by evaluating at `ω^0, ω^1, ω^2, ω^3 = 1, 13, 16, 4`:

```
â = [1+2·1, 1+2·13, 1+2·16, 1+2·4] = [3, 27, 33, 9] ≡ [3, 10, 16, 9]
b̂ = [3+4·1, 3+4·13, 3+4·16, 3+4·4] = [7, 55, 67, 19] ≡ [7, 4, 16, 2]
```

Pointwise product mod 17:

```
ĉ = [3·7, 10·4, 16·16, 9·2] = [21, 40, 256, 18] ≡ [4, 6, 1, 1].
```

Inverse-transform `ĉ` with `ω^{-1} = ω^3 = 4` and scale by `n^{-1} = 4^{-1} = 13` (since `4·13 = 52 ≡ 1`):

```
c[m] = 13 · Σ_t ĉ[t] · 4^{tm} (mod 17)  ⇒  c = [3, 10, 8, 0].
```

This matches the hand product exactly — every operation was an integer mod 17, nothing rounded. This is the concrete instance of Corollary 6.3: padding to `n = 4 ≥ 3 = len(a)+len(b)−1` made the cyclic convolution equal the linear product.

### 6.2 Cyclic vs Linear: A Wraparound Counterexample

Repeat the same `a, b` but with `n = 2` (under-padded; the butterfly still runs). With `n = 2`, `ω = g^{8} = 3^8 ≡ −1 = 16`. The cyclic convolution of period 2 folds the `x²` term back onto the constant: `(a ⊛ b)[0] = a_0 b_0 + a_1 b_1 = 3 + 8 = 11` (the `8x²` wrapped onto index `0`), and `(a ⊛ b)[1] = 10`. The result `[11, 10]` is the **wrong** linear product — the `3` and the `8` have collided at index `0`. This is exactly the silent failure Corollary 6.3's padding hypothesis prevents.

Note that `11 = 3 + 8` is the linear coefficient at index `0` *plus* the wrapped index-`2` coefficient: cyclic convolution of period `n` adds `c[s]` and `c[s + n]` and `c[s + 2n]`, etc. Linear convolution is recovered precisely when no such overlap occurs, i.e. when `n` exceeds the maximum index `len(a) + len(b) − 2`. The padding rule `n ≥ len(a) + len(b) − 1` is the smallest power-of-two choice that guarantees this — the formal content of "pad enough."

---

## 7. The Iterative Butterfly: Correctness and Complexity

The transform admits the Cooley-Tukey recursion (derived in `15-divide-and-conquer/05-fft`; not reproduced): split `A(x)` into even and odd parts `A(x) = A_e(x²) + x A_o(x²)`, recurse on size `n/2` with root `ω²`, and combine via the **butterfly**

```
â[t]       = â_e[t] + ω^t · â_o[t],
â[t + n/2] = â_e[t] − ω^t · â_o[t],        t = 0, …, n/2 − 1,
```

where the minus sign uses `ω^{t+n/2} = ω^t · ω^{n/2} = −ω^t` (Section 2's halving property).

**Theorem 7.1 (Iterative equivalence).** Permuting the input into **bit-reversed** order and then applying `L = log₂ n` stages of in-place butterflies (stage `s` using root `ω_{2^s} = g^{(p-1)/2^s}`) computes the same `â` as the recursion, in place, with `O(1)` extra space.

**Proof sketch.** The recursion's leaves, read left to right, are the inputs in bit-reversed index order; the bit-reversal permutation places them there up front. Each return-from-recursion level corresponds to one bottom-up stage combining adjacent blocks of doubling size with the appropriate stage root. Induction on the stage index shows stage `s` holds the size-`2^s` sub-transforms, matching the recursion level. ∎

**Theorem 7.2 (Complexity).** Forward (or inverse) NTT runs in `O(n log n)` field operations and `O(n)` extra space. A full polynomial multiply (two forward, one pointwise, one inverse) is `O(n log n)`.

**Proof.** Bit-reversal is `O(n)`. There are `log₂ n` stages; each touches every element once in `O(1)` field operations (one multiply, one add, one subtract), totaling `O(n)` per stage, `O(n log n)` overall. The pointwise step is `O(n)`. The `n^{-1}` scaling is `O(n)`. In-place storage plus a stage-root table is `O(n)`. ∎

### 7.1 Why Bit-Reversal Is the Right Permutation

The recursion `A(x) = A_e(x²) + x·A_o(x²)` repeatedly partitions indices by their least-significant bit: even indices (`...0`) go left, odd (`...1`) go right. Recursing, the second-least-significant bit partitions the next level, and so on. After `L` levels, an index `i` lands at the leaf whose path is `i`'s bits read **least-significant-first** — i.e. `i`'s bits reversed. Placing each `a[i]` at position `rev(i)` up front therefore puts the leaves in the order the bottom-up stages consume them.

For `n = 8` the map is `0→0, 1→4, 2→2, 3→6, 4→1, 5→5, 6→3, 7→7`: each index `i` swaps with the index whose 3-bit binary is `i` reversed. The swaps `1↔4` and `3↔6` are the only non-fixed pairs, so the permutation is realized by two transpositions — the in-place "swap if `i < rev(i)`" loop performs exactly these.

**Proposition 7.2 (Bit-reversal is an involution).** `rev(rev(i)) = i`, so applying the permutation twice restores the original order. This is why the inverse transform can reuse the *same* bit-reversal routine: bit-reverse, run inverse-root butterflies, scale — no separate "un-permute" pass is needed (the forward transform leaves the array in natural order, and the inverse's own bit-reversal re-scrambles then the stages un-scramble).

### 7.2 In-Place Correctness

Each butterfly reads `a[lo]` and `a[hi]` and overwrites exactly those two cells; across one stage the `(lo, hi)` pairs are disjoint, so no cell is read after being overwritten by a different butterfly in the same stage. This disjointness is what makes the transform safely **in place** with `O(1)` scratch beyond the array itself, and it is preserved at every stage because the stride `len` doubles, keeping pairs aligned to fresh blocks.

### 7.3 Worked Iterative Trace (n = 4)

Forward-transform `a = [1, 2, 0, 0]` over `Z/17Z` iteratively. Bit-reversal of `n = 4` swaps indices `1↔2`:

```
after bit-reversal: [1, 0, 2, 0]      (rev: 0→0, 1→2, 2→1, 3→3)
```

**Stage len = 2** (root `ω_2 = g^{8} = 3^8 ≡ 16 ≡ −1`, twiddle `w = 1` only):

```
block [0,1]: u=1, v=0·1=0  → (1+0, 1−0) = (1, 1)
block [2,3]: u=2, v=0·1=0  → (2+0, 2−0) = (2, 2)
array: [1, 1, 2, 2]
```

**Stage len = 4** (root `ω_4 = g^{4} = 3^4 ≡ 13`, twiddles `w = 1, 13`):

```
k=0 (w=1):  lo=0,hi=2: u=1, v=2·1=2   → (1+2, 1−2) = (3, 16)
k=1 (w=13): lo=1,hi=3: u=1, v=2·13=26≡9 → (1+9, 1−9 mod17) = (10, 9)
array: [3, 10, 16, 9]
```

The result `[3, 10, 16, 9]` matches the direct evaluation `V·a` of Section 4.1 and the forward transform of Section 6.1 — the iterative butterfly computed the same `â` in `(n/2)log₂ n = 4` butterflies instead of the `n² = 16` multiplies of the matrix form. This is Theorem 7.1 traced by hand.

---

## 8. Multi-Prime CRT: The Reconstruction Bound

When the target modulus `M` is not NTT-friendly, run the convolution under coprime NTT primes `p_1, …, p_r` and reconstruct the **true integer** coefficient by the Chinese Remainder Theorem (sibling `05-crt`, `15-garner-algorithm`).

**Theorem 8.1 (CRT).** For pairwise coprime `p_1, …, p_r` with product `P = Πp_r`, the map `x ↦ (x mod p_1, …, x mod p_r)` is a ring isomorphism `Z/PZ ≅ Z/p_1Z × … × Z/p_rZ`. Hence residues `(c mod p_1, …, c mod p_r)` determine `c` uniquely modulo `P`.

**Theorem 8.2 (Reconstruction bound).** Let `c[k] = Σ_{i+j=k} a[i] b[j]` be a true (unreduced) output coefficient with `0 ≤ a[i], b[j] < B`. Then

```
0 ≤ c[k] < n · B²,
```

so if `P = Πp_r > n · B²`, CRT recovers `c[k]` **exactly**; reducing afterward gives the correct value mod any `M`.

**Proof.** `c[k]` is a sum of at most `min(k+1, n) ≤ n` products, each `< B²`, and all nonnegative, so `0 ≤ c[k] < n·B²`. If `P > n·B²` then `c[k] ∈ [0, P)`, the unique residue class CRT returns; reducing mod `M` is then exact. ∎

**Corollary 8.3 (Prime count).** For `B ≈ M ≈ 10^9` and `n ≈ 10^5`, `n·B² ≈ 10^{23}`; three primes near `10^9` give `P ≈ 10^{27} > 10^{23}`, so three primes suffice. Two primes (`P ≈ 10^{18}`) fail this bound and silently wrap for large `n` — the formal reason the senior default is three primes. Signed coefficients double the required range to `2·n·B²`.

**Reconstruction cost.** Direct/Garner CRT for `r` fixed primes is `O(r²)` per coefficient (constant in `r`), hence `O(n)` total; Garner's mixed-radix form avoids big-integer intermediates and is the overflow-safe choice (`15-garner-algorithm`).

### 8.1 Worked CRT Reconstruction

Suppose a true coefficient is `c = 1234567890123`, and we run under two primes `p_1 = 998244353`, `p_2 = 985661441` (product `P ≈ 9.84 × 10^{17} > c`, so two primes suffice here). The residues are

```
c mod p_1 = 1234567890123 mod 998244353 = 236323194 (say),
c mod p_2 = 1234567890123 mod 985661441 = 248906402 (say).
```

CRT combines them: find `t` with `c ≡ r_1 + p_1·t (mod p_2)`. Compute `inv = p_1^{-1} mod p_2`, then `t = (r_2 − r_1)·inv mod p_2`, and `c = r_1 + p_1·t`, the unique value in `[0, P)`. Because `c < P`, this recovers `c` exactly; if we had wanted it mod some `M`, we would reduce now. The key invariant is `P > c`; if `c ≥ P` (too few primes), the formula returns `c mod P`, a different — wrong — integer, with no error signal. This is the formal content of Theorem 8.2 and the trap of Section 9 in `senior.md`.

### 8.2 Choosing the Prime Count in Practice

Given inputs with `n` terms and coefficients bounded by `B`, the runtime check is a single inequality: accumulate the prime product until it exceeds `n·B²` (or `2·n·B²` for signed coefficients). For `n = 2^{20} ≈ 10^6` and `B = 10^9`, `n·B² ≈ 10^{24}`; three ~`10^9` primes give `≈ 9.6 × 10^{26} > 10^{24}` — safe. Two primes (`≈ 9.8 × 10^{17}`) are far short and would wrap. The bound is tight: do not guess the prime count, compute it.

### 8.3 CRT as a Ring Isomorphism, Operationally

Theorem 8.1 says `Z/PZ ≅ ∏ Z/p_rZ` as rings — addition and multiplication commute with the residue map. Operationally this means the *entire* convolution can be done independently in each `Z/p_rZ` and the results assembled at the end: there is no need to combine before the inverse transform, because `(a ⊛ b) mod p_r` computed per prime, then CRT-combined per coefficient, equals `(a ⊛ b) mod P`. The isomorphism is what licenses the embarrassingly-parallel structure: each prime is a fully independent job, combined only by the final `O(n)` CRT pass. This is also why correctness is modular-local — a bug in one prime's transform shows up as that prime's residue disagreeing with the schoolbook-mod-`p_r` oracle, isolating the fault.

---

## 9. Complexity: O(n log n) and the Modular Cost Model

**Theorem 9.1 (NTT multiply complexity).** Over a fixed NTT-friendly prime `p` (so each field operation is `O(1)` machine word operations), multiplying two degree-`< d` polynomials costs `O(d log d)` time and `O(d)` space, where the transform size `n = 2^{⌈log₂(2d−1)⌉} = Θ(d)`.

**Proof.** `n = Θ(d)` by the padding rule; apply Theorem 7.2. Each butterfly does an `O(1)` modular multiply (a machine multiply plus a reduction). ∎

**The reduction cost.** The constant hidden in `O(1)` is the modular reduction `% p`. Three regimes:

- `p < 2^31`: product `< 2^62` fits `int64`; one hardware division per multiply (or Barrett/Montgomery to avoid division).
- `2^31 ≤ p < 2^32`: still `int64`-safe products, but sums need care; Montgomery on 32-bit words is standard.
- `p ≥ 2^32`: products need 128-bit; significantly slower — avoid via the multi-prime route.

**Multi-prime complexity.** `r` primes multiply the transform cost by `r` and add an `O(n)` CRT pass: total `O(r · d log d) = O(d log d)` for constant `r`. The primes are independent, so wall-clock can be `O(d log d)` with `r`-way parallelism.

**Comparison to schoolbook.** Schoolbook convolution is `Θ(d²)`. NTT wins for `d` beyond a small crossover (typically a few hundred, where the `log d` factor and constant overhead are repaid). Below it, schoolbook is faster and serves as the test oracle.

### 9.1 Counting the Operations Precisely

A length-`n` forward transform does exactly `(n/2)·log₂ n` butterflies, each one modular multiply, one modular add, one modular subtract. A full polynomial multiply runs two forward transforms, `n` pointwise modular multiplies, one inverse transform, and `n` scaling multiplies:

```
multiplies ≈ 3 · (n/2) log₂ n + 2n  =  (3n/2) log₂ n + 2n.
```

For `n = 2^{20}`, that is about `(3·2^{20}/2)·20 + 2·2^{20} ≈ 3.3 × 10^7` modular multiplies — milliseconds in a compiled language with a fast reduction. The schoolbook alternative at this size is `n² ≈ 10^{12}` multiplies, utterly infeasible. The `O(n log n)` vs `Θ(n²)` gap is the entire reason NTT exists.

Worth noting: the constant `3/2` in `(3n/2) log n` comes from doing three transforms (two forward, one inverse) per multiply. Squaring a polynomial needs only one forward transform, dropping the constant to `1` (`(n) log n + n`) — a measurable saving in inner loops that square repeatedly, such as the `t`-fold convolution of Section 10.3. The pointwise and scaling passes are linear and negligible against the `n log n` transforms.

### 9.2 The Hidden Constant: Modular Reduction

Each "modular multiply" is a machine multiply plus a reduction. The reduction strategy sets the constant:

| Strategy | Cost per multiply | Notes |
|----------|-------------------|-------|
| Hardware `%` | 1 multiply + 1 division | division is the slow instruction |
| Barrett | 2–3 multiplies + shifts | precomputed `μ = ⌊2^{2L}/p⌋` |
| Montgomery | 2 multiplies + 1 shift (REDC) | residues kept in Montgomery form; sibling `14` |

Because the butterfly executes `Θ(n log n)` of these, switching from `%` to Montgomery is a 2–3× wall-clock win on large transforms — the dominant practical optimization, orthogonal to the asymptotic `O(n log n)`.

### 9.3 Space Complexity and the Twiddle Table

The transform is in place: `O(n)` for the coefficient array, plus an optional `O(n)` precomputed twiddle table `w[0..n/2)` reused across all stages and across forward/inverse. No recursion stack is needed (the iterative form), so the space is a flat `O(n)`. For the multi-prime route, each prime needs its own length-`n` array, so the working set is `O(r·n)` for `r` primes; streaming the primes one at a time (transform, CRT-accumulate, discard) reduces this to `O(n)` plus the `O(n)` accumulator, at the cost of holding partial CRT state — a standard memory/throughput trade-off (`senior.md` §6).

---

## 10. Relation to FFT and to Other Fast-Multiplication Methods

**FFT (complex).** The complex FFT (`05-fft`) is Definition 4.1 with `ω = e^{2πi/n} ∈ C`. The butterfly and `O(n log n)` structure are identical; only the field differs. NTT trades the analytic convenience of `C` (any `n`-th root exists) for **exactness** (no rounding) at the cost of needing `n | (p−1)` — Theorem 2.1.

**Why NTT is exact and FFT is not.** FFT works in `C` with finite-precision `double`, so `Σ a[m] ω^{tm}` accumulates rounding; the final coefficients must be rounded to integers, which can be off by `1` for large coefficients or `n` (catastrophic for an exact mod-`p` answer). NTT works in `Z/pZ` where every operation is exact; there is nothing to round.

**A quantitative FFT error sketch.** With `double` (53-bit mantissa) and coefficients bounded by `B`, transform length `n`, the absolute error in an output coefficient grows roughly like `O(B² n · log n · 2^{-53})`. For `B = 10^6` and `n = 2^{20}`, this is `~10^{12} · 20 · 10^{-16} ≈ 2`, already large enough to round to the wrong integer — the precise regime where practitioners switch to NTT or to FFT coefficient-splitting. NTT's error is identically zero regardless of `B` and `n`, bounded only by the modulus choice (you need `Πp_r > n·B²`, Theorem 8.2), which is a clean integer condition rather than a delicate floating-point budget.

**Bluestein / arbitrary `n`.** When the transform length is not a power of two (or no friendly prime has the needed `2^k`), Bluestein's chirp-`z` transform reduces a length-`n` DFT to a convolution of length `≥ 2n−1`, which can itself be done by NTT. This extends NTT to arbitrary lengths at a constant-factor cost (mentioned in `senior.md`).

**Schönhage-Strassen and big-int multiply.** Integer multiplication of `N`-bit numbers reduces to convolution of their digit vectors; NTT (or recursive NTT over rings `Z/(2^m+1)Z`) gives the `O(N log N log log N)` Schönhage-Strassen bound, and Harvey-van der Hoeven's `O(N log N)` uses multidimensional NTT-like transforms. NTT is thus a building block of asymptotically fast big-integer arithmetic (sibling `27-bigint-arithmetic`).

**The Schönhage-Strassen recursion, sketched.** Split each `N`-bit number into `√N` blocks of `√N` bits, treat the blocks as polynomial coefficients, and convolve. The convolution is itself done by NTT over the ring `Z/(2^m + 1)Z`, where `2` is a cheap principal root of unity (multiplication by a power of the root is just a bit-shift, not a general multiply). The coefficient products in the recursion are themselves multiplications of `~√N`-bit numbers, handled by recursing. The recursion depth is `O(log log N)` (each level square-roots the bit length), which is the source of the `log log N` factor in the classic bound. The point for this topic: the *outer* transform is exactly an NTT, and the choice of the ring `Z/(2^m+1)Z` is an NTT-friendliness decision — `2^m + 1` is engineered so that `2` has the needed order, the integer-multiplication analogue of choosing `p = c·2^k + 1`.

**Where NTT sits.** It is the exact, integer, modular member of the DFT family: same `O(n log n)` butterfly as FFT (`05-fft`), exactness of finite-field arithmetic, extensibility to arbitrary modulus via CRT (Theorem 8.1, `05-crt`), and a foundation for fast multiplication and polynomial algebra (`20-polynomial-operations`).

### 10.1 Bluestein for Arbitrary Transform Length

When the desired DFT length `m` is **not** a power of two (or no friendly prime has a high enough `2^k`), Bluestein's chirp-`z` transform expresses the length-`m` DFT as a convolution. Using `tm = (t² + m² − (t−m)²)/2` (valid when `2` is invertible and a square root of the root exists mod `p`), one writes

```
â[t] = ω^{-t²/2} · Σ_m ( a[m] ω^{-m²/2} ) · ω^{(t-m)²/2},
```

the inner sum being a convolution of the two sequences `b[m] = a[m] ω^{-m²/2}` and `c[k] = ω^{k²/2}`, of length `≥ 2m − 1`, which is computed by a power-of-two NTT. This extends NTT to **any** length at a constant-factor cost, at the price of needing the half-power `ω^{1/2}` to exist mod `p` (an extra factor of two in the 2-adic valuation). It is the number-theory analogue of the complex Bluestein FFT.

**When Bluestein is and is not needed.** For polynomial *multiplication* you control the transform length — you simply pad to the next power of two — so Bluestein is unnecessary. It matters only when the DFT length itself is fixed and non-power-of-two (e.g. a cyclic convolution of a prescribed odd period, or a length-`m` evaluation grid that cannot be padded). In competitive and most production settings the padding freedom makes plain power-of-two NTT sufficient; Bluestein is the escape hatch for the rarer fixed-length case, and it costs one extra factor of two in the prime's 2-adic valuation (you transform at length `≥ 2m−1` and need a `4m`-ish root for the chirp).

### 10.2 Application: Exact String Matching via Convolution

Pattern matching with wildcards reduces to convolution. Encode text `T` and pattern `P` numerically; the mismatch count at shift `s` is a sum of products `Σ_i (T[s+i] − P[i])² · mask`, which expands into a few correlations — each a reversed convolution computable by NTT in `O(N log N)`. Over `Z/pZ` the counts are exact (no FP), so a zero entry certifies an exact match. This is the standard FFT/NTT string-matching technique; NTT is preferred when exactness matters or the alphabet weights are large.

**Correlation vs convolution.** A correlation `Σ_i T[s+i]·P[i]` is a convolution with one input reversed: replace `P[i]` by `P'[i] = P[m−1−i]`, and the convolution `(T ⊛ P')[s + m − 1]` equals the correlation at shift `s`. So the single primitive (NTT-based convolution) serves both. The wildcard-mismatch count expands `(T[s+i] − P[i])²·w[i] = T²w − 2TPw + P²w·1`, three correlations, three convolutions, `O(N log N)` total; over `Z/pZ` each is exact, so the algorithm reports matches with no rounding tolerance — a concrete payoff of NTT's exactness over complex FFT.

### 10.3 Application: Counting and Subset Sums

Many counting problems are convolutions: the number of ways to write `s` as an ordered sum of two values from multisets `X` and `Y` is `(f_X ⊛ f_Y)[s]`, where `f` are frequency arrays (Challenge 4 in `interview.md`). Iterating, the distribution of a sum of `t` i.i.d. variables is the `t`-fold convolution `f^{⊛ t}`, computable by binary exponentiation of convolution in `O(L log L · log t)`. Counting modulo a prime is exactly what NTT delivers, and the `998244353` modulus is chosen by problem-setters precisely so a single NTT suffices.

**Why convolution counts ordered sums.** The generating function of a multiset is `F(x) = Σ_v f[v] x^v`; multiplying generating functions `F(x)·G(x)` collects, in the coefficient of `x^s`, every product `f[u]·g[w]` with `u + w = s` — i.e. every ordered pair `(value u from X, value w from Y)` summing to `s`. Multiplication of generating functions *is* convolution of coefficient arrays, so `(f ⊛ g)[s]` is the ordered-pair count by construction. The `t`-fold self-convolution `F(x)^t` then counts ordered `t`-tuples summing to `s`. This is the combinatorics-on-generating-functions view of why NTT (a polynomial multiplier) is a counting engine.

### 10.4 Application: Polynomial Algebra and Big Integers

NTT is the multiply primitive beneath the whole fast-polynomial toolkit (sibling `20-polynomial-operations`): inverse mod `x^k` (Newton iteration, Task 11), division with remainder, multipoint evaluation/interpolation, and power-series `exp`/`log`. Each is `O(n log n)` because each calls NTT a constant number of times per Newton-doubling step, and the geometric series of doubling sizes sums to `O(n log n)`. For integers, the digit-array convolution plus carry propagation (Challenge 2, Task 8) gives fast big-integer multiplication, the gateway to Schönhage-Strassen-style `O(N log N log log N)` and the modern `O(N log N)` bounds (sibling `27-bigint-arithmetic`).

**The Newton-doubling complexity, spelled out.** Polynomial inverse computes `B ≡ A^{-1} (mod x^{2m})` from `B ≡ A^{-1} (mod x^m)` via `B ← B(2 − AB) (mod x^{2m})`, two NTT multiplies at size `Θ(m)`. Summing over doubling sizes `m = 1, 2, 4, …, k`, the total work is `Σ c·(2^i log 2^i) = c·(2k log k + …) = O(k log k)` — the geometric series is dominated by its last (largest) term, so the whole inverse costs the same order as a single size-`k` multiply. The same telescoping argument gives `O(n log n)` for division, `exp`, and `log`. This is why NTT being `O(n log n)` lifts the entire polynomial library to `O(n log n)`.

### 10.4b Fast-Multiplication Landscape

| Method | Multiply cost | Exact? | Where NTT appears |
|--------|---------------|--------|-------------------|
| Schoolbook | `Θ(n²)` | yes | — (test oracle) |
| Karatsuba | `Θ(n^{1.585})` | yes | — |
| Complex FFT | `Θ(n log n)` | approximate | — (NTT's sibling) |
| **NTT (single prime)** | `Θ(n log n)` | exact mod `p` | the transform itself |
| **NTT + 3-prime CRT** | `Θ(n log n)` | exact mod any `M` | per-prime transforms |
| Schönhage-Strassen | `O(N log N log log N)` | exact (integers) | outer transform |
| Harvey-van der Hoeven | `O(N log N)` | exact (integers) | multidim. NTT |

NTT occupies the sweet spot for *exact modular* convolution: `O(n log n)` like FFT, but integer-exact, and (via CRT) usable for any modulus. The asymptotically faster big-integer methods use NTT-like transforms internally — NTT is not superseded by them, it is their engine.

### 10.5 Why Exactness Is the Defining Property

The single line that distinguishes NTT from FFT is **no rounding**. In `Z/pZ`, `a + b` and `a · b` are computed exactly as integers reduced mod `p`; there is no floating-point mantissa to overflow and no rounding step to round the wrong way. The cost is the structural constraint `n | (p − 1)` (Theorem 2.1), which is why NTT-friendly primes and the multi-prime-CRT machinery exist. Every design decision in this topic — prime choice, padding, CRT, Montgomery reduction — is in service of preserving that exactness while staying `O(n log n)`.

---

## 11. Summary

- **Roots of unity exist in `Z/pZ`** because `Z/pZ*` is cyclic (sibling `12`); a primitive `n`-th root is `ω = g^{(p-1)/n}`, and it exists iff `n | (p − 1)` (Theorem 2.1). The halving property `ω^{n/2} = −1` (the analogue of `e^{πi} = −1`) makes the butterfly valid mod `p`.
- **NTT-friendly primes** `p = c·2^k + 1` give `2^k | (p−1)`, supporting all transform lengths `2^L`, `L ≤ k` (Proposition 3.1). `998244353 = 119·2^23 + 1`, `g = 3`, is the canonical choice.
- **Inversion** is the same transform with `ω^{-1}` and a `n^{-1}` scaling; correctness is the root-orthogonality identity `Σ_t ω^{td} = n·[n | d]` (Lemma 5.1, Theorem 5.2).
- **The convolution theorem** `NTT(a ⊛ b) = NTT(a) ∘ NTT(b)` holds verbatim over `Z/pZ` (Theorem 6.2); with padding `n ≥ len(a)+len(b)−1` it computes the exact linear (polynomial) product (Corollary 6.3).
- **The iterative transform** (bit-reversal + `log n` butterfly stages) equals the recursion in place (Theorem 7.1) and runs in `O(n log n)`, `O(n)` space (Theorem 7.2) — the butterfly itself is the shared FFT structure of `15-divide-and-conquer/05-fft`.
- **Arbitrary-modulus** convolution uses multiple coprime NTT primes + CRT; the reconstruction is exact iff `Πp_r > n·B²` (Theorem 8.2), which forces three ~`10^9` primes for `n ≈ 10^5`, `B ≈ 10^9` (Corollary 8.3). Use Garner (`15-garner-algorithm`) for overflow-safe combination.
- **Complexity** `O(n log n)` with the modular reduction as the hidden constant; keep `p < 2^31` so butterfly products fit `int64`, else use Montgomery (`14-montgomery-multiplication`) or 128-bit.
- **NTT is the exact, integer DFT:** same `O(n log n)` butterfly as FFT, no rounding, extensible to any modulus via CRT, and a foundation for fast big-integer (`27-bigint-arithmetic`) and polynomial (`20-polynomial-operations`) arithmetic.
- **Bluestein** extends NTT to arbitrary (non-power-of-two) lengths by rewriting the DFT as a convolution, at the cost of needing the half-power root `ω^{1/2}` mod `p` (Section 10.1).
- **Applications** — string matching with wildcards, ordered-pair-sum counting, `t`-fold convolution, polynomial inverse/division/multipoint, big-integer multiply — are all convolutions, and NTT delivers them exactly mod a prime (Sections 10.2–10.4).
- **Every engineering rule is a corollary** of a theorem here (the proof-dependency map above): friendly prime ⇐ Thm 2.1, `n^{-1}` scaling ⇐ Lem 5.1/Thm 5.2, padding ⇐ Cor 6.3, three CRT primes ⇐ Thm 8.2.

### Theorem Cheat Table

| Statement | Result |
|-----------|--------|
| Primitive `n`-th root exists | iff `n | (p − 1)` (Thm 2.1) |
| Construction | `ω = g^{(p-1)/n} mod p` (Cor 2.2) |
| Halving property | `ω^{n/2} ≡ −1 (mod p)` (Sec 2) |
| Root orthogonality | `Σ_t ω^{td} = n·[n | d]` (Lem 5.1) |
| Inversion scale | multiply by `n^{-1} mod p` (Thm 5.2) |
| Convolution theorem | `NTT(a ⊛ b) = NTT(a) ∘ NTT(b)` (Thm 6.2) |
| Linear product padding | `n ≥ len(a)+len(b)−1` (Cor 6.3) |
| Transform complexity | `O(n log n)`, `O(n)` space (Thm 7.2) |
| CRT exactness bound | `Πp_r > n·B²` (Thm 8.2) |
| Bluestein (arbitrary length) | needs `ω^{1/2}` mod `p` (Sec 10.1) |

### Proof-Dependency Map

The results chain in one direction, each resting on the previous:

```
cyclic Z/pZ* (sibling 12)
   └─> Thm 2.1  (root exists iff n | p−1)
          └─> Cor 2.2  (ω = g^{(p-1)/n}),  Lem 2.3 (ω² primitive (n/2)-th)
                 └─> Lem 5.1  (root orthogonality Σ ω^{td} = n·[n|d])
                        ├─> Thm 5.2  (inversion: scale by n^{-1})
                        └─> Thm 6.2  (convolution theorem)
                               └─> Cor 6.3  (padding ⇒ linear product)
   Thm 7.1 (iterative = recursive)  ──>  Thm 7.2 (O(n log n))
   Thm 8.1 (CRT)  ──>  Thm 8.2 (Πp_r > n·B² ⇒ exact reconstruction)
```

Every practical rule traces to a theorem: "use a friendly prime" is Theorem 2.1; "remember the `n^{-1}` scaling" is the `n` of Lemma 5.1 cancelled in Theorem 5.2; "pad to a power of two ≥ result length" is Corollary 6.3; "use three CRT primes" is the `Πp_r > n·B²` bound of Theorem 8.2. None of the engineering advice in `senior.md` is arbitrary — it is the corollary set of this section.

Reading the map top to bottom is also the right *learning* order: master why the unit group is cyclic (sibling `12`), then root existence, then the orthogonality identity (which alone implies both inversion and the convolution theorem), then the iterative-equivalence and complexity results, and finally the CRT extension for arbitrary moduli. Each layer is a short proof resting only on the one above it.

### The One-Paragraph Takeaway

NTT is the discrete Fourier transform carried out in the finite field `Z/pZ` rather than `C`. Because `Z/pZ*` is cyclic, it contains a primitive `n`-th root of unity exactly when `n | (p − 1)` (so you pick a prime `p = c·2^k + 1`), and that root behaves algebraically like `e^{2πi/n}` — including the halving property `ω^{n/2} = −1` the butterfly needs. The forward transform evaluates a polynomial at the powers of `ω`; the inverse is the same computation with `ω^{-1}` and a global `n^{-1}` scaling, correct by root orthogonality. The convolution theorem holds verbatim, so padded inputs give the exact linear product in `O(n log n)`. When the target modulus is hostile, run under several friendly primes and reconstruct the exact integer via CRT, choosing enough primes that their product exceeds the largest coefficient `n·B²`. The whole edifice exists to deliver **exact** convolution — no rounding — at FFT speed. Strip away every optimization and the irreducible core is two lines: a primitive root exists because the field's unit group is cyclic, and the convolution theorem holds because that root satisfies `ω^n = 1` with `ω^d ≠ 1` for `0 < d < n`. Everything else — friendly primes, padding, CRT, Montgomery — is plumbing in service of those two facts.

Foundational references: any computer-algebra text (von zur Gathen & Gerhard, *Modern Computer Algebra*, Ch. 8) for finite-field DFT and fast multiplication; CLRS Ch. 30 for the FFT butterfly; Nussbaumer, *Fast Fourier Transform and Convolution Algorithms*; and sibling topics `05-crt`, `12-primitive-root-discrete-root`, `14-montgomery-multiplication`, `15-garner-algorithm`, `20-polynomial-operations`, `27-bigint-arithmetic`, and `15-divide-and-conquer/05-fft`.

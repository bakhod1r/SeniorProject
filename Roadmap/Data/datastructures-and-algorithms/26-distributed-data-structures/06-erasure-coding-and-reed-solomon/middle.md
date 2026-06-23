# Erasure Coding & Reed–Solomon — Middle Level

> **You already know** (from [junior](junior.md)) that XOR parity recovers *exactly one* lost block, and you've seen the **(n, k)** framing: take `k` data blocks, store `n` total, survive some failures. This page answers the question junior left open: **how does a code survive *any* `n − k` losses, not just one?** The answer is Reed–Solomon, and the cleanest way to understand it is *polynomials*. We'll build the polynomial view, the equivalent matrix view, run a fully worked encode/decode by hand over a small field, and finish with runnable Python and Go.

---

## Table of Contents

1. [Recap and the goal](#1-recap-and-the-goal)
2. [What MDS means and the Singleton bound](#2-what-mds-means-and-the-singleton-bound)
3. [The polynomial view (the mental model that clicks)](#3-the-polynomial-view-the-mental-model-that-clicks)
4. [Worked example: encode k=2 into n=4, drop 2, interpolate back](#4-worked-example-encode-k2-into-n4-drop-2-interpolate-back)
5. [The matrix view: codeword = G · data](#5-the-matrix-view-codeword--g--data)
6. [Systematic codes and the Vandermonde generator](#6-systematic-codes-and-the-vandermonde-generator)
7. [Why ordinary integer arithmetic is unsafe — finite fields](#7-why-ordinary-integer-arithmetic-is-unsafe--finite-fields)
8. [Encoding and decoding cost](#8-encoding-and-decoding-cost)
9. [Worked decode: 2×2 inverse over a small field](#9-worked-decode-22-inverse-over-a-small-field)
10. [Code: Reed–Solomon over GF(p) — Python and Go](#10-code-reedsolomon-over-gfp--python-and-go)
11. [Misconceptions](#11-misconceptions)
12. [Mistakes](#12-mistakes)
13. [Cheat sheet](#13-cheat-sheet)
14. [Summary](#14-summary)
15. [Further reading](#15-further-reading)

---

## 1. Recap and the goal

Junior gave us two things:

- **XOR parity.** With `k` data blocks `d₁ … d_k` and one parity block `p = d₁ ⊕ d₂ ⊕ … ⊕ d_k`, you can reconstruct **any single** missing block, because XOR is its own inverse: drop `d₂`, and `d₂ = p ⊕ d₁ ⊕ d₃ ⊕ … ⊕ d_k`. One parity, one tolerated failure.

- **The (n, k) contract.** You store `n` symbols total: `k` of "data" plus `m = n − k` of "redundancy". A good erasure code promises that **any `k` of the `n` symbols are enough** to rebuild everything. That tolerates up to `m = n − k` losses.

XOR parity is exactly the `(k+1, k)` case: `n = k+1`, `m = 1`. It survives one loss. It **cannot** survive two — if you lose `d₁` and `d₂`, the single equation `p = d₁ ⊕ d₂ ⊕ d₃ ⊕ …` has two unknowns and infinitely many solutions.

**The goal of this page:** build a code where `m` can be *anything*, and **any** `n − k` of the symbols may vanish, yet `k` survivors always suffice. That code is **Reed–Solomon (RS)**. The trick is to stop thinking of parity as "one XOR equation" and start thinking of the data as defining a **polynomial**, with each stored symbol being a *sample* of that polynomial. Polynomials have a magic rigidity property — `k` samples pin down a degree-`(k−1)` polynomial uniquely — and that rigidity is exactly the "any k of n" guarantee.

If you want to refresh the algebra first, two siblings are load-bearing here:

- [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md) — we compute "mod p" the whole way.
- [Polynomial Operations](../../19-number-theory/22-polynomial-operations/junior.md) — evaluation and interpolation.

---

## 2. What MDS means and the Singleton bound

Before mechanics, let's name the property that makes Reed–Solomon *optimal*.

### The Singleton bound

Suppose a code stores `n` symbols and the original message has `k` symbols of real information. How many erasures `t` can it *possibly* tolerate, for **any** code whatsoever?

If `t` symbols are erased, you have `n − t` symbols left. To recover `k` independent symbols of information, you obviously need at least `k` symbols left:

```
n − t ≥ k    ⟹    t ≤ n − k
```

So **no code can tolerate more than `n − k` erasures.** That's a counting limit, not a cleverness limit — `k` unknowns need at least `k` equations. This is (the erasure form of) the **Singleton bound**.

### MDS = hits the bound exactly

A code is **MDS (Maximum Distance Separable)** when it *achieves* this bound: it recovers from **every** pattern of `n − k` erasures. Equivalently:

> **MDS property:** *any* `k` of the `n` symbols are sufficient to reconstruct the original `k` data symbols.

"Any" is the strong word. A non-MDS code might recover from *some* sets of `n − k` losses but not others. An MDS code recovers from *all* of them — there are no "unlucky" loss patterns.

This is the optimal storage/durability tradeoff:

| Property | Meaning |
|---|---|
| Storage overhead | `n / k` (e.g. `(14,10)` stores 1.4× the data) |
| Failures tolerated | exactly `n − k` |
| MDS guarantee | survives **any** `n − k` losses, no exceptions |

**Reed–Solomon is MDS.** That's its headline feature, and the rest of this page is essentially a proof-by-construction of *why*. XOR parity, by contrast, is the trivial MDS code for `m = 1`; RS generalizes it to any `m`.

> Note: erasures (you know *which* symbols are missing) are easier than errors (a symbol is silently wrong but you don't know which). RS handles up to `n − k` **erasures**, or up to `⌊(n−k)/2⌋` **errors**, or a mix. Storage systems almost always deal with erasures — a disk either responds or it doesn't. We focus on erasures here; error correction is covered at [senior](senior.md).

---

## 3. The polynomial view (the mental model that clicks)

Forget matrices for a moment. Here is the entire idea in five sentences.

1. Take your `k` data symbols and use them as the **coefficients** of a polynomial `P(x)` of degree `k − 1`.
2. Pick `n` distinct, agreed-upon evaluation points `x₁, x₂, …, x_n`.
3. Your codeword is the `n` **values** `P(x₁), P(x₂), …, P(x_n)`. Store one per node.
4. A degree-`(k−1)` polynomial is **uniquely determined by any `k` of its (point, value) pairs** — `k` points fix it, full stop.
5. So if *any* `k` symbols survive, you have `k` points, you reconstruct `P`, and from `P` you read back the data. **That is the MDS guarantee.**

Let's unpack step 4, because it's the load-bearing fact.

### Why k points determine a degree-(k−1) polynomial

A polynomial of degree `k − 1` has `k` coefficients:

```
P(x) = a₀ + a₁·x + a₂·x² + … + a_{k-1}·x^{k-1}
```

`k` unknown coefficients. Each known pair `(xᵢ, yᵢ)` where `yᵢ = P(xᵢ)` gives you **one linear equation** in those unknowns:

```
a₀ + a₁·xᵢ + a₂·xᵢ² + … + a_{k-1}·xᵢ^{k-1} = yᵢ
```

`k` distinct points give `k` linear equations in `k` unknowns. Because the points are **distinct**, those equations are independent (the coefficient matrix is a *Vandermonde* matrix, invertible exactly when the points differ — we'll see this in §6). So the system has **exactly one** solution: the original `P`. No more, no fewer.

This is just **Lagrange interpolation** / "two points make a line, three points make a parabola" generalized. Two points (`k = 2`) determine a unique line (degree 1). Three points determine a unique parabola (degree 2). `k` points determine a unique degree-`(k−1)` curve.

The picture:

```
Encode:                              Decode (any k survivors):

data → coefficients of P             k surviving (xᵢ, yᵢ) pairs
        |                                    |
        | evaluate at x₁..x_n                | interpolate
        v                                    v
   n values  →  store n symbols        recover P  →  read off data
        |
        | lose up to n-k of them
        v
   ≥ k values remain  ──────────────────────┘
```

Two equivalent ways to map "data → polynomial":

- **Coefficient form:** the `k` data symbols *are* the coefficients `a₀ … a_{k-1}`. To get data back you reconstruct `P` and read its coefficients.
- **Value form:** the `k` data symbols *are* `P` evaluated at `k` chosen points `x₁ … x_k`, and the parity symbols are `P` at the *extra* points `x_{k+1} … x_n`. This makes the code **systematic** (the first `k` codeword symbols equal the data verbatim).

Both encode the same code. We'll use the coefficient form for the hand example because the arithmetic is most transparent, then connect to the systematic/matrix form afterward.

---

## 4. Worked example: encode k=2 into n=4, drop 2, interpolate back

Let's make it concrete with the smallest example that shows off two-failure recovery: **k = 2, n = 4, m = 2**. This survives **any 2** of 4 losses — strictly stronger than XOR parity, which survives only 1.

We work over **GF(257)**, i.e. arithmetic **mod the prime 257**. Why 257? It's prime (so every nonzero element has a multiplicative inverse — division works), and it's just above 256, so a full byte `0..255` fits as a field element. (Real systems use GF(2⁸); 257 is friendlier for arithmetic by hand. More on field choice in §7.)

### Setup

- Data: two symbols `D = (d₀, d₁) = (5, 3)`.
- Polynomial (coefficient form): `P(x) = d₀ + d₁·x = 5 + 3x`. Degree `k − 1 = 1` — a line.
- Evaluation points (public, fixed): `x₁=1, x₂=2, x₃=3, x₄=4`.

### Encode — evaluate P at the 4 points

All arithmetic mod 257 (the numbers stay small here, so no reduction is even needed yet):

```
P(1) = 5 + 3·1 = 8
P(2) = 5 + 3·2 = 11
P(3) = 5 + 3·3 = 14
P(4) = 5 + 3·4 = 17
```

Codeword: `C = (8, 11, 14, 17)`, stored at nodes 1, 2, 3, 4. (As a sanity check: these are an arithmetic progression with common difference 3 — that's exactly what evaluating a line at `1,2,3,4` gives you. Geometry made visible.)

### Lose two symbols

Suppose **nodes 2 and 3 die**. We are left with:

```
node 1: (x=1, y=8)
node 4: (x=4, y=17)
```

Two survivors. Since `k = 2`, that's exactly enough.

### Decode — interpolate the line through the two survivors

We want the unique line `P(x) = a₀ + a₁·x` passing through `(1, 8)` and `(4, 17)`. Two equations:

```
a₀ + a₁·1 = 8      ...(i)
a₀ + a₁·4 = 17     ...(ii)
```

Subtract (i) from (ii):

```
3·a₁ = 17 − 8 = 9
a₁ = 9 / 3
```

Division is **modular** here: `9 / 3 mod 257` means `9 · 3⁻¹ mod 257`. The inverse of 3 mod 257 is the number `t` with `3t ≡ 1 (mod 257)`. Since `3 · 86 = 258 ≡ 1 (mod 257)`, we have `3⁻¹ = 86`. So:

```
a₁ = 9 · 86 mod 257 = 774 mod 257 = 774 − 2·257 = 774 − 514 = 260 mod 257 = 3
```

`a₁ = 3` ✓ (matches the original `d₁ = 3`). Then from (i):

```
a₀ = 8 − a₁·1 = 8 − 3 = 5
```

`a₀ = 5` ✓ (matches `d₀ = 5`). **Recovered `P(x) = 5 + 3x`, hence `D = (5, 3)`.** We lost half the codeword and got everything back.

### Lagrange form (no system-solving)

There's a closed-form shortcut that avoids setting up equations — **Lagrange interpolation**. For survivors `(1, 8)` and `(4, 17)`:

```
P(x) = 8 · (x − 4)/(1 − 4)  +  17 · (x − 1)/(4 − 1)
```

The two fractions are **Lagrange basis polynomials**: each is 1 at "its" point and 0 at the other. To read off the data we evaluate `P` at the points the data lived at. If we wanted the *coefficient* form, expand; if we wanted, say, the lost value `P(2)`:

```
P(2) = 8 · (2−4)/(1−4) + 17 · (2−1)/(4−1)
     = 8 · (−2)/(−3)    + 17 · (1)/(3)
     = 8 · (2/3)        + 17 · (1/3)
     = 8 · 2 · 3⁻¹      + 17 · 3⁻¹    (mod 257)
     = (16 + 17) · 86 mod 257
     = 33 · 86 mod 257
     = 2838 mod 257
     = 2838 − 11·257 = 2838 − 2827 = 11      ✓ (original P(2) was 11)
```

Either route recovers the polynomial, hence the data. Lagrange is conceptually clean; the matrix/linear-solve route (next sections) is what code actually uses because it generalizes and is easy to make systematic.

> **The whole MDS magic in one line:** the *only* thing we needed was that the two surviving points had **distinct x-values**. They always do, because every node has a different `xᵢ`. That's why *any* 2 of the 4 survivors work — there are no bad pairs.

---

## 5. The matrix view: codeword = G · data

Polynomial evaluation is a **linear** operation in the data symbols, so the entire encode is a single matrix–vector product. This view is what production code uses.

Stack the evaluations. With data `D = (d₀, …, d_{k-1})ᵀ` and `P(x) = Σ dⱼ·xʲ`, the value at point `xᵢ` is:

```
P(xᵢ) = d₀·xᵢ⁰ + d₁·xᵢ¹ + … + d_{k-1}·xᵢ^{k-1}
```

That's row `i` of a matrix times the vector `D`. Collecting all `n` points:

```
C = G · D
```

where `G` is the `n × k` **generator matrix** whose row `i` is `[xᵢ⁰, xᵢ¹, …, xᵢ^{k-1}]`. This particular `G` (rows of powers of distinct points) is a **Vandermonde matrix**.

For our worked example (`k=2`, points `1,2,3,4`), `G` is `4 × 2`:

```
        ⎡ 1   1 ⎤              ⎡ d₀ ⎤       ⎡ 1·5 + 1·3 ⎤   ⎡  8 ⎤
   G =  ⎢ 1   2 ⎥     C = G·D = ⎢ 1·5 + 2·3 ⎥ = ⎢ 11 ⎥
        ⎢ 1   3 ⎥        D=⎣ d₁ ⎦  ⎢ 1·5 + 3·3 ⎥   ⎢ 14 ⎥
        ⎣ 1   4 ⎦              ⎣ 1·5 + 4·3 ⎦   ⎣ 17 ⎦
```

Same codeword `(8, 11, 14, 17)`. The matrix is just "evaluate `P` at the four points", written as linear algebra.

### Decode as solving a linear system

Now suppose some symbols are erased. **Keep only the rows of `G` corresponding to the survivors**, and keep the matching received values. Say survivors are nodes 1 and 4 (rows 1 and 4 of `G`):

```
   G_surv = ⎡ 1   1 ⎤     C_surv = ⎡  8 ⎤
            ⎣ 1   4 ⎦              ⎣ 17 ⎦
```

We need `D` with `G_surv · D = C_surv`. Since we have exactly `k = 2` survivors, `G_surv` is **square (`k × k`)**. Recovery is:

```
D = G_surv⁻¹ · C_surv
```

So decoding = **invert a `k × k` matrix and multiply**. The only thing we must guarantee is that **every `k × k` submatrix of `G` is invertible** — because *which* `k` rows survive is out of our control. That's precisely the MDS condition in matrix language: every `k`-subset of rows must be full-rank.

Let's verify the inverse for this case. `G_surv = [[1,1],[1,4]]`, determinant `= 1·4 − 1·1 = 3`. For a 2×2:

```
⎡ a b ⎤⁻¹     1   ⎡  d  −b ⎤
⎢ c d ⎥   = ─────  ⎢ −c   a ⎥
⎣     ⎦     det    ⎣        ⎦
```

So `G_surv⁻¹ = (1/3)·[[4,−1],[−1,1]]`. Over GF(257), `1/3 = 86`, and `−1 ≡ 256`. Then:

```
D = G_surv⁻¹ · C_surv = (1/3)·[[4,−1],[−1,1]] · [8, 17]ᵀ

  row 0: (4·8 − 1·17)/3 = (32 − 17)/3 = 15/3 = 5   → d₀ = 5  ✓
  row 1: (−1·8 + 1·17)/3 = (−8 + 17)/3 = 9/3 = 3   → d₁ = 3  ✓
```

Same answer as the polynomial route — because it *is* the same computation, dressed in matrix clothes.

---

## 6. Systematic codes and the Vandermonde generator

Two practical refinements that every real RS implementation uses.

### Why "any k rows invertible" holds for Vandermonde

A square Vandermonde matrix built from **distinct** points has a famously clean determinant:

```
det(V) = Π_{i < j} (xⱼ − xᵢ)
```

This product is **nonzero exactly when all the `xᵢ` are distinct** (over a field — every factor is a difference of two distinct field elements, hence nonzero, and a field has no zero divisors). Pick **any** `k` of our `n` rows: that's a `k × k` Vandermonde on `k` distinct points, so its determinant is nonzero, so it's invertible. **Every** `k`-subset of rows is invertible. That is the MDS guarantee, proven once and for all.

This is *why* RS uses distinct evaluation points: distinctness is the entire ballgame.

> **Field requirement, foreshadowed:** you need at least `n` distinct points, so the field must have at least `n` elements. GF(257) gives you 257 (or 256 usable nonzero) points — plenty for `n ≤ 256`. GF(2⁸) gives 256. If you ever need `n > 256` you move to a bigger field like GF(2¹⁶).

### Systematic codes: data appears verbatim

In the pure coefficient code above, the stored symbols `(8,11,14,17)` don't contain the raw data `(5,3)` anywhere — you must decode even to *read*. That's wasteful. A **systematic** code arranges that the **first `k` codeword symbols are literally the data**, and only the remaining `m = n − k` are parity. Reading is free in the no-failure case (the common case); you only do linear algebra when something's actually missing.

You get a systematic code by choosing `G` of the form:

```
        ⎡ I_k ⎤        ← k × k identity  (these rows pass data through unchanged)
   G =  ⎢     ⎥
        ⎣  P  ⎦        ← m × k parity rows
```

Then `C = G·D = [D ; P·D]`: the top `k` symbols are `D` itself, the bottom `m` are parity. To build such a `G` and keep the MDS property, the standard recipe is:

1. Start from an `n × k` Vandermonde (or Cauchy) matrix `V` — guaranteed "any k rows invertible".
2. Take its top `k × k` block `V_top` (invertible) and right-multiply the whole thing by `V_top⁻¹`. Now the top block becomes `I_k`, the code is systematic, **and the "any k rows invertible" property is preserved** (multiplying `G` on the right by an invertible matrix is just a change of basis on the data — it permutes nothing about *which* rows are independent).

The result: `G = [I_k ; A]` where `A` is some `m × k` matrix, every `k × k` submatrix of `G` is still invertible, data is stored in the clear, parity is computed as `A·D`.

> **Cauchy vs Vandermonde:** Vandermonde works but its submatrix inverses can be numerically/arithmetically awkward; many libraries (e.g. Jerasure, Backblaze's Go reed-solomon) prefer a **Cauchy** matrix, which is also "any-k-rows-invertible" and yields nicer arithmetic, especially over GF(2⁸). For learning, Vandermonde is the clearest; the *principle* — any `k` rows invertible — is identical. Detailed in [senior](senior.md).

### Decode, restated for the systematic case

When symbols are erased, you take the rows of `G` for the **surviving** symbols (some identity rows, some parity rows), form the `k × k` matrix `G_surv`, invert it, and multiply by the survivors:

```
D = G_surv⁻¹ · C_surv
```

If all `k` *data* symbols survived, `G_surv = I_k` and `D = C_surv` for free — no inverse needed. You only pay the inversion when a *data* symbol is among the casualties.

---

## 7. Why ordinary integer arithmetic is unsafe — finite fields

Everything above secretly relied on working **in a field**: we *divided* (computed `1/3`), and we needed "distinct points ⇒ nonzero determinant ⇒ exact, unique solution". Plain machine integers break all of this. Three concrete failures:

**1. Overflow.** Symbols are bytes `0..255`. Encoding sums products like `Σ dⱼ·xᵢʲ`. With `k = 10` and points up to 255, `xᵢ^9` alone is astronomically large; the codeword "symbol" overflows any fixed-width integer and silently wraps. Wrapped arithmetic isn't a consistent number system, so interpolation gives garbage.

**2. No exact division.** Decoding *requires* division (matrix inverse, Lagrange denominators). Over integers, `9 / 3 = 3` but `8 / 3` is not an integer at all — there's no integer `t` with `3t = 8`. You cannot invert a matrix exactly over ℤ in general. Floating point "works" but introduces rounding error, and for storage you need **bit-exact** recovery, not "approximately your file back".

**3. Symbols must stay in a fixed alphabet.** A codeword symbol must itself be one byte so you can store it. Integer arithmetic produces ever-larger numbers; you need the result to fold back into `0..255`.

The fix is a **finite field** (a.k.a. Galois field), written GF(q): a finite set of `q` elements with `+`, `−`, `×`, `÷` that all stay inside the set and obey the normal algebra laws — crucially, **every nonzero element has a multiplicative inverse**, so division always works exactly. Two field families matter for RS:

### GF(p) — integers mod a prime p

What we used: arithmetic mod a prime like 257. Add/subtract/multiply then reduce mod `p`; divide by multiplying with the modular inverse (via the extended Euclidean algorithm or Fermat: `a⁻¹ = a^{p−2} mod p`). Simple, exact, perfect for learning and for the code below. Downside: a byte is `0..255` but the field is `0..256`, so the value `256` is awkward to store in 8 bits — fine for demos, slightly annoying for production. See [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md).

### GF(2⁸) — the bytes field (what production uses)

Real RS storage codes operate on **bytes** using **GF(2⁸)**, a field with exactly 256 elements — *one byte each, no waste*. Its elements are bytes, but arithmetic is *not* mod 256. Instead:

- **Addition is XOR.** `a + b = a ⊕ b`. (And subtraction is also XOR — every element is its own additive inverse.) This is why the junior-level XOR parity is *literally* the `m = 1` Reed–Solomon code over GF(2⁸): XOR *is* field addition.
- **Multiplication** is carry-less polynomial multiplication of the two bytes (treating each byte's bits as polynomial coefficients) reduced modulo a fixed degree-8 *irreducible* polynomial (commonly `0x11D = x⁸ + x⁴ + x³ + x² + 1`). In practice it's done with small precomputed log/antilog tables, so a multiply is two table lookups and an add.

The beautiful part: **all the structure from §3–§6 carries over unchanged.** Vandermonde determinants, "any k rows invertible", interpolation — every theorem holds over *any* field, including GF(2⁸). Only the `+`, `×`, `÷` primitives differ. We defer the full GF(2⁸) multiply-table construction to [senior](senior.md); for this page, the takeaway is:

> RS = the §3–§6 linear algebra, run over a **finite field** so division is exact and symbols stay one byte. GF(p) for clarity, GF(2⁸) for production. **Add = XOR** in GF(2⁸).

For the matrix solving itself (forward elimination + back-substitution over a field), see [Gaussian Elimination](../../19-number-theory/19-gaussian-elimination/junior.md) — it's the same algorithm, with field operations swapped in for real-number ones.

---

## 8. Encoding and decoding cost

Let `k` = data symbols, `m = n − k` = parity symbols, and assume each "symbol" is a byte (or a word). For a block of `k` data symbols:

### Encoding

Each parity symbol is a linear combination of all `k` data symbols: `pᵢ = Σⱼ Aᵢⱼ · dⱼ`. That's `O(k)` field operations **per parity symbol**, and there are `m` parity symbols, so:

```
Encode cost = O(m · k)  field ops per block of k data symbols
            = O(k)      field ops per parity symbol, per data symbol
```

When you stripe a large file across the code, you process it in blocks, so the cost is **linear in file size** with constant factor `m·k / k = m` multiply-adds per data byte (i.e. proportional to the parity overhead). Systematic codes pay this only for parity; the data passes through for free.

### Decoding

Two phases:

1. **Build `G_surv⁻¹`** — invert the `k × k` survivor matrix. Gaussian elimination is `O(k³)` field operations. **But you do this once per erasure pattern**, not per byte: the inverse depends only on *which* symbols were lost, so across a huge file with the same failed disks you amortize one `O(k³)` inversion over the whole stripe set.

2. **Apply the inverse** — multiply `G_surv⁻¹` (a `k × k` matrix) by the survivor vector to recover the lost symbols. `O(k²)` per block, but in practice you only recompute the `≤ m` *missing* symbols, so it's `O(m · k)` per block — same shape as encoding.

```
Decode setup (once per failure pattern): O(k³)   matrix inverse
Decode apply (per block):                O(k · m) field ops
```

So the headline costs:

| Operation | Cost | Notes |
|---|---|---|
| Encode a parity symbol | `O(k)` | one dot product over the field |
| Encode a block | `O(m·k)` | `m` parity symbols |
| Decode: invert survivor matrix | `O(k³)` | **amortized** over all blocks with same loss pattern |
| Decode: recover lost symbols / block | `O(m·k)` | only the missing symbols |

This is why RS is practical even at `(14,10)` or `(20,14)` scale (typical in object stores): the cubic cost is a one-time per-failure setup, and the per-byte work is just a handful of field multiply-adds, well within disk/network bandwidth. The expensive recurring resource in real systems isn't CPU — it's the **repair traffic** (reading `k` symbols to rebuild one), which the senior page addresses via locally-repairable and regenerating codes.

---

## 9. Worked decode: 2×2 inverse over a small field

Let's do one more decode end-to-end via the **matrix-inverse** route, with a different loss pattern, to cement the mechanics. We reuse the `(n=4, k=2)` code over **GF(257)**, points `x = (1,2,3,4)`, data `D = (5, 3)`, codeword `C = (8, 11, 14, 17)`.

This time **nodes 1 and 4 die**; survivors are **nodes 2 and 3**:

```
node 2: (x=2, y=11)
node 3: (x=3, y=14)
```

### Step 1 — form the survivor matrix

Rows 2 and 3 of the Vandermonde `G` (recall row `i` = `[1, xᵢ]`):

```
   G_surv = ⎡ 1   2 ⎤        C_surv = ⎡ 11 ⎤
            ⎣ 1   3 ⎦                 ⎣ 14 ⎦
```

### Step 2 — determinant and its inverse

```
det = (1)(3) − (2)(1) = 1   (mod 257)
det⁻¹ = 1⁻¹ = 1
```

### Step 3 — invert (2×2 closed form)

```
G_surv⁻¹ = (1/det) · ⎡  3  −2 ⎤  = 1 · ⎡  3   −2 ⎤  = ⎡  3   255 ⎤   (since −2 ≡ 255 mod 257)
                     ⎣ −1   1 ⎦        ⎣ −1    1 ⎦    ⎣ 256    1 ⎦
```

(Keeping the signed form `[[3,−2],[−1,1]]` is cleaner for hand arithmetic; reduce at the end.)

### Step 4 — recover the data

```
D = G_surv⁻¹ · C_surv

d₀ = 3·11 + (−2)·14 = 33 − 28 = 5    (mod 257)  → 5  ✓
d₁ = (−1)·11 + 1·14 = −11 + 14 = 3   (mod 257)  → 3  ✓
```

**`D = (5, 3)`** — exact recovery, different two failures, same code. We have now recovered from the `{2,3}` loss *and* the `{1,4}` loss; by the Vandermonde argument every one of the `C(4,2) = 6` two-failure patterns works identically. That is "any `n − k` erasures", demonstrated.

### Step 5 (optional) — rebuild the actual lost symbols

If you want the *codeword* symbols back (e.g. to re-replicate to fresh disks), evaluate the recovered `P(x) = 5 + 3x` at the lost points:

```
P(1) = 5 + 3·1 = 8    (rebuild node 1)  ✓
P(4) = 5 + 3·4 = 17   (rebuild node 4)  ✓
```

Back to the original `C = (8, 11, 14, 17)`. Recovery is complete and bit-exact.

---

## 10. Code: Reed–Solomon over GF(p) — Python and Go

Both implementations build a **Vandermonde generator** over a small prime field, encode `k` data symbols into `n`, erase up to `n − k` of them, and decode by solving the `k × k` survivor system with Gaussian elimination over GF(p). They `assert` exact recovery. (We use GF(p) for readability; production swaps in GF(2⁸). The *algorithm* is identical — only the field primitives change.)

### Python

```python
"""
Reed-Solomon erasure code over GF(p), p prime.
Vandermonde generator. Encode k -> n, erase up to n-k, decode via linear solve.
"""

P = 257  # prime field GF(257); field elements are 0..256


# ---- field arithmetic over GF(P) ---------------------------------------
def add(a, b): return (a + b) % P
def sub(a, b): return (a - b) % P
def mul(a, b): return (a * b) % P

def inv(a):
    """Multiplicative inverse via Fermat: a^(P-2) mod P (a != 0)."""
    a %= P
    if a == 0:
        raise ZeroDivisionError("0 has no inverse in GF(p)")
    return pow(a, P - 2, P)

def div(a, b): return mul(a, inv(b))


# ---- generator matrix --------------------------------------------------
def vandermonde(points, k):
    """n x k matrix, row i = [points[i]^0, points[i]^1, ..., points[i]^(k-1)]."""
    G = []
    for x in points:
        row, p = [], 1
        for _ in range(k):
            row.append(p % P)
            p = mul(p, x)
        G.append(row)
    return G


def matvec(M, v):
    """Matrix (list of rows) times vector, over GF(P)."""
    out = []
    for row in M:
        acc = 0
        for a, b in zip(row, v):
            acc = add(acc, mul(a, b))
        out.append(acc)
    return out


# ---- linear solve over GF(P): Gaussian elimination ---------------------
def solve(A, b):
    """Solve A x = b for square A over GF(P). Returns x. A is k x k."""
    k = len(A)
    # augmented matrix
    M = [list(A[i]) + [b[i]] for i in range(k)]
    for col in range(k):
        # find a pivot row with nonzero entry in this column
        piv = next((r for r in range(col, k) if M[r][col] != 0), None)
        if piv is None:
            raise ValueError("singular matrix - survivors not independent")
        M[col], M[piv] = M[piv], M[col]
        # normalize pivot row so pivot becomes 1
        ipiv = inv(M[col][col])
        M[col] = [mul(v, ipiv) for v in M[col]]
        # eliminate this column from every other row
        for r in range(k):
            if r != col and M[r][col] != 0:
                factor = M[r][col]
                M[r] = [sub(M[r][c], mul(factor, M[col][c])) for c in range(k + 1)]
    return [M[i][k] for i in range(k)]


# ---- encode / decode ---------------------------------------------------
def encode(data, points):
    """data: k symbols (polynomial coefficients). Returns n codeword symbols."""
    k = len(data)
    G = vandermonde(points, k)
    return matvec(G, data)


def decode(received, points, k):
    """
    received: list of n entries; surviving symbols are ints, erasures are None.
    Returns the recovered k data symbols. Needs >= k survivors.
    """
    rows, vals = [], []
    G = vandermonde(points, k)
    for i, y in enumerate(received):
        if y is not None:
            rows.append(G[i])
            vals.append(y)
            if len(rows) == k:   # k survivors are enough; stop
                break
    if len(rows) < k:
        raise ValueError(f"need {k} survivors, got {len(rows)}")
    return solve(rows, vals)     # k x k solve -> data


# ---- demo --------------------------------------------------------------
if __name__ == "__main__":
    k, n = 2, 4
    points = [1, 2, 3, 4]          # n distinct evaluation points
    data = [5, 3]                  # k data symbols

    codeword = encode(data, points)
    print("data     :", data)
    print("codeword :", codeword)   # -> [8, 11, 14, 17]

    # Erase any (n-k)=2 symbols and check recovery for EVERY loss pattern.
    from itertools import combinations
    for lost in combinations(range(n), n - k):
        recv = [None if i in lost else codeword[i] for i in range(n)]
        out = decode(recv, points, k)
        assert out == data, f"FAILED to recover after losing {lost}: {out}"
        print(f"lost {lost} -> recovered {out}  OK")

    print("All erasure patterns recovered exactly. RS is MDS. ✔")

    # A bigger sanity test: k=4, n=7 (tolerates any 3 losses), random data.
    import random
    k2, n2 = 4, 7
    pts2 = [1, 2, 3, 4, 5, 6, 7]
    for _ in range(1000):
        d = [random.randrange(P) for _ in range(k2)]
        cw = encode(d, pts2)
        lost = random.sample(range(n2), n2 - k2)   # lose exactly 3
        recv = [None if i in lost else cw[i] for i in range(n2)]
        assert decode(recv, pts2, k2) == d
    print("k=4,n=7: 1000 random (any-3-loss) trials recovered exactly. ✔")
```

Running it prints the codeword `[8, 11, 14, 17]`, confirms recovery for **all six** two-loss patterns of the `(4,2)` code, then stress-tests a `(7,4)` code over 1000 random "lose any 3" trials — every one recovers exactly.

### Go

```go
// Reed-Solomon erasure code over GF(p), p prime.
// Vandermonde generator; encode k -> n; erase up to n-k; decode via linear solve.
package main

import (
	"fmt"
	"math/rand"
)

const P = 257 // prime field GF(257)

// ---- field arithmetic over GF(P) ----
func add(a, b int) int { return ((a+b)%P + P) % P }
func sub(a, b int) int { return ((a-b)%P + P) % P }
func mul(a, b int) int { return (a * b) % P }

func inv(a int) int { // Fermat: a^(P-2) mod P
	a = ((a % P) + P) % P
	if a == 0 {
		panic("0 has no inverse")
	}
	return powmod(a, P-2)
}

func powmod(b, e int) int {
	r := 1
	b %= P
	for e > 0 {
		if e&1 == 1 {
			r = mul(r, b)
		}
		b = mul(b, b)
		e >>= 1
	}
	return r
}

// ---- generator matrix ----
func vandermonde(points []int, k int) [][]int {
	G := make([][]int, len(points))
	for i, x := range points {
		row := make([]int, k)
		p := 1
		for j := 0; j < k; j++ {
			row[j] = p % P
			p = mul(p, x)
		}
		G[i] = row
	}
	return G
}

func matvec(M [][]int, v []int) []int {
	out := make([]int, len(M))
	for i, row := range M {
		acc := 0
		for j, a := range row {
			acc = add(acc, mul(a, v[j]))
		}
		out[i] = acc
	}
	return out
}

// ---- linear solve over GF(P): Gaussian elimination ----
func solve(A [][]int, b []int) []int {
	k := len(A)
	M := make([][]int, k)
	for i := range A {
		M[i] = append(append([]int{}, A[i]...), b[i])
	}
	for col := 0; col < k; col++ {
		piv := -1
		for r := col; r < k; r++ {
			if M[r][col] != 0 {
				piv = r
				break
			}
		}
		if piv == -1 {
			panic("singular matrix - survivors not independent")
		}
		M[col], M[piv] = M[piv], M[col]
		ip := inv(M[col][col])
		for c := 0; c <= k; c++ {
			M[col][c] = mul(M[col][c], ip)
		}
		for r := 0; r < k; r++ {
			if r != col && M[r][col] != 0 {
				f := M[r][col]
				for c := 0; c <= k; c++ {
					M[r][c] = sub(M[r][c], mul(f, M[col][c]))
				}
			}
		}
	}
	x := make([]int, k)
	for i := 0; i < k; i++ {
		x[i] = M[i][k]
	}
	return x
}

// ---- encode / decode ----
func encode(data, points []int) []int {
	return matvec(vandermonde(points, len(data)), data)
}

// received: -1 marks an erasure; otherwise the symbol value.
func decode(received, points []int, k int) []int {
	G := vandermonde(points, k)
	rows := [][]int{}
	vals := []int{}
	for i, y := range received {
		if y != -1 {
			rows = append(rows, G[i])
			vals = append(vals, y)
			if len(rows) == k {
				break
			}
		}
	}
	if len(rows) < k {
		panic(fmt.Sprintf("need %d survivors, got %d", k, len(rows)))
	}
	return solve(rows, vals)
}

func equal(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func main() {
	k, n := 2, 4
	points := []int{1, 2, 3, 4}
	data := []int{5, 3}

	cw := encode(data, points)
	fmt.Println("data     :", data)
	fmt.Println("codeword :", cw) // [8 11 14 17]

	// Every 2-of-4 erasure pattern must recover.
	for a := 0; a < n; a++ {
		for b := a + 1; b < n; b++ {
			recv := append([]int{}, cw...)
			recv[a], recv[b] = -1, -1
			out := decode(recv, points, k)
			if !equal(out, data) {
				panic(fmt.Sprintf("lost {%d,%d} -> %v", a, b, out))
			}
			fmt.Printf("lost {%d,%d} -> recovered %v  OK\n", a, b, out)
		}
	}
	fmt.Println("All erasure patterns recovered exactly. RS is MDS.")

	// k=4, n=7 random stress test: lose any 3.
	k2, n2 := 4, 7
	pts2 := []int{1, 2, 3, 4, 5, 6, 7}
	for t := 0; t < 1000; t++ {
		d := make([]int, k2)
		for i := range d {
			d[i] = rand.Intn(P)
		}
		cw2 := encode(d, pts2)
		recv := append([]int{}, cw2...)
		// erase exactly n2-k2 = 3 distinct positions
		perm := rand.Perm(n2)
		for i := 0; i < n2-k2; i++ {
			recv[perm[i]] = -1
		}
		if !equal(decode(recv, pts2, k2), d) {
			panic("recovery failed")
		}
	}
	fmt.Println("k=4,n=7: 1000 random any-3-loss trials recovered exactly.")
}
```

> **Mapping to production.** Swap the four field primitives (`add/sub/mul/inv`) for GF(2⁸) versions (XOR for add/sub, log/antilog table lookups for mul/inv), make `G` systematic via the `[I_k ; A]` construction of §6, and cache `G_surv⁻¹` per failure pattern. That's essentially what Backblaze's `klauspost/reedsolomon`, Jerasure, and Ceph's EC plugins do — the linear algebra you just wrote, hardened and SIMD-accelerated.

---

## 11. Misconceptions

**"Reed–Solomon can recover any number of failures."**
No. An `(n, k)` code recovers from **at most `n − k`** erasures — the Singleton bound. Lose `n − k + 1` and you have fewer than `k` survivors: the `k × k` system is under-determined, recovery is *impossible* for **any** code. Durability is bought by raising `m = n − k`, which raises storage cost.

**"Parity blocks are 'backups' of specific data blocks."**
No. In RS each parity symbol is a function of **all** `k` data symbols (a full dot product), and any survivor — data or parity — is interchangeable as one of the `k` points/equations. There's no 1-to-1 "this parity backs up that block" mapping. That's exactly why *any* `k` survivors work.

**"You need the data blocks specifically; parity alone is useless."**
No (and this is the whole point). You need **any `k`** symbols. Three parities and one data block, for a `(4,1)`... er, for a `(n,k)` with `k` survivors of *any* kind, reconstruct everything. Survivors are fungible.

**"Reed–Solomon needs floating point / it's approximate."**
No. RS lives entirely in a **finite field**, so every operation — including division — is **exact**. Recovery is bit-for-bit. Floating point would actually be *wrong* (rounding); integers mod a prime, or GF(2⁸), are the correct setting.

**"More parity is always strictly better."**
It's a tradeoff. `(n, k)` durability is `n − k` failures, cost is `n/k` storage. Doubling parity roughly doubles overhead and increases encode work and (for some loss patterns) repair traffic. Real systems tune `(n, k)` to their failure model — e.g. `(14, 10)` ≈ 1.4× overhead tolerating 4 simultaneous losses is a common sweet spot.

**"XOR parity and Reed–Solomon are unrelated."**
They're the same family. XOR parity is RS with `m = 1` over GF(2⁸): field addition in GF(2⁸) *is* XOR, and a single parity symbol summing all data is the `m = 1` MDS code. RS just generalizes to `m > 1`.

---

## 12. Mistakes

**Using non-distinct evaluation points.** If two nodes share an `xᵢ`, the corresponding Vandermonde rows are identical → some `k`-subset is singular → those survivors can't be solved. The MDS guarantee *requires* all `n` points distinct. (And you need a field with `≥ n` elements to *have* `n` distinct points.)

**Doing arithmetic in plain integers (or `float`).** Overflow corrupts encoding; non-exact division corrupts decoding. Always reduce mod `p` (or use GF(2⁸)). In Go especially, watch `int` overflow in `mul` before the `% P` — for tiny `P` it's fine, but with larger fields use a wider type or reduce eagerly.

**Forgetting the field for *subtraction*.** `(a - b) % P` can go negative in C/Go/Java. Use `((a-b)%P + P) % P`. (Python's `%` already returns non-negative, which is why the Python code is terser.)

**Inverting the *full* `G` instead of the *survivor* submatrix.** `G` is `n × k` (not square) — you can't invert it. You select the `k` **surviving** rows to form a square `G_surv`, then invert that.

**Treating fewer than `k` survivors as recoverable.** If `< k` survive, stop — it's mathematically impossible, not a bug to debug. Detect it (`if survivors < k: fail`) rather than producing garbage.

**Confusing erasures with errors.** Everything here assumes you *know which* symbols are missing (erasures) — the normal storage case. If a symbol is silently *corrupted* (an error, location unknown), an `(n,k)` RS code corrects only `⌊(n−k)/2⌋` of them, half the erasure budget, and needs the Berlekamp–Massey / syndrome machinery from [senior](senior.md). Use checksums to *turn* errors into erasures cheaply.

**Recomputing `G_surv⁻¹` per block.** The inverse depends only on the failure pattern, not the data. Compute it once per pattern and reuse it across the whole stripe — otherwise you pay `O(k³)` per block instead of once.

---

## 13. Cheat sheet

```
TERMS
  (n, k)         store n symbols, k are real data, m = n-k are parity
  MDS            recovers from ANY n-k erasures (optimal; RS is MDS)
  Singleton      t ≤ n - k        (no code beats this; MDS meets it)
  symbol         one field element (a byte in GF(2^8))
  systematic     first k codeword symbols = the raw data verbatim

POLYNOMIAL VIEW
  data -> coefficients of P(x), degree k-1
  codeword[i] = P(x_i) for n distinct points x_1..x_n
  ANY k (x_i, y_i) pairs uniquely determine P  (interpolation)
  -> recover P -> read data.   Distinct points is the ONLY requirement.

MATRIX VIEW
  encode:  C = G · D          G = n×k Vandermonde (row i = [x_i^0..x_i^{k-1}])
  decode:  D = G_surv⁻¹ · C_surv     (pick any k surviving rows -> k×k solve)
  MDS  ⇔  every k×k submatrix of G is invertible
  Vandermonde det = Π_{i<j}(x_j - x_i) ≠ 0  ⇔  all x_i distinct  ⇒ MDS

FIELD
  Need exact division -> finite field GF(q), q = p (prime) or 2^8 (bytes).
  GF(p):   ordinary mod-p arithmetic; inverse via a^(p-2) or ext-Euclid.
  GF(2^8): add = XOR (!),  multiply = table lookup; 256 elements = 1 byte.
  XOR parity = RS with m=1 over GF(2^8).

COST
  encode:   O(k) per parity symbol,  O(m·k) per block
  decode:   O(k³) to invert survivor matrix (ONCE per loss pattern)
            O(m·k) per block to apply it

GUARANTEE
  tolerate up to n-k erasures (lose more -> impossible for ANY code)
  errors (unknown location): only ⌊(n-k)/2⌋  -> see senior
```

---

## 14. Summary

- An **(n, k) MDS** erasure code recovers from **any `n − k` erasures** — the optimal point on the **Singleton bound** `t ≤ n − k`. **Reed–Solomon is MDS**: there are no unlucky loss patterns.

- **Polynomial view (the intuition):** treat the `k` data symbols as a degree-`(k−1)` polynomial `P` and store its values at `n` distinct points. Because **any `k` (point, value) pairs uniquely determine `P`** (interpolation — two points fix a line, `k` points fix a degree-`k−1` curve), *any* `k` survivors reconstruct everything.

- **Matrix view (the implementation):** `C = G · D` with an `n × k` **Vandermonde** generator; decode by selecting any `k` surviving rows into a square `G_surv`, inverting it, and multiplying: `D = G_surv⁻¹ · C_surv`. The MDS property is the statement that **every `k × k` submatrix of `G` is invertible**, which holds for Vandermonde precisely because **all evaluation points are distinct** (`det = Π(xⱼ − xᵢ) ≠ 0`).

- **Systematic** codes (`G = [I_k ; A]`) store data verbatim so reads are free; you only do linear algebra when a data symbol is actually lost.

- Everything must run in a **finite field** so division is exact and symbols stay one symbol wide. **GF(p)** is clearest for learning; **GF(2⁸)** is what production uses (256 elements = 1 byte, **add = XOR**). All the theorems hold over any field — only the `+ × ÷` primitives change.

- **Costs:** encode `O(k)` per parity symbol; decode `O(k³)` to invert the survivor matrix **once per failure pattern**, then `O(m·k)` per block to apply it.

- We **worked it fully by hand**: `(4,2)` over GF(257), data `(5,3)` → codeword `(8,11,14,17)`, then recovered from *both* the `{2,3}` loss (interpolation) and the `{1,4}` loss (matrix inverse), and the runnable Python/Go verify **all** loss patterns plus 1000 random `(7,4)` trials.

The senior page builds GF(2⁸) arithmetic in full, handles **errors** (not just erasures) via syndromes and Berlekamp–Massey, and surveys the modern variants storage systems actually deploy — **LRC** (locally repairable) and **regenerating** codes that cut the costly repair traffic.

---

## 15. Further reading

- **I. S. Reed and G. Solomon (1960), "Polynomial Codes over Certain Finite Fields."** *Journal of the SIAM*, 8(2):300–304. The original three-page paper that started it all — the polynomial-evaluation framing of §3 is essentially theirs.
- **J. S. Plank, "A Tutorial on Reed–Solomon Coding for Fault-Tolerance in RAID-like Systems."** *Software: Practice & Experience*, 1997 (with a well-known correction note). The most readable systems-oriented introduction; the Vandermonde-generator construction and decode-by-inverse approach of §5–§6 are laid out concretely here.
- **F. J. MacWilliams and N. J. A. Sloane, *The Theory of Error-Correcting Codes* (1977).** The canonical reference for the deeper coding theory — MDS codes, the Singleton bound, and the full algebraic machinery.
- **J. S. Plank et al., "Jerasure" / the GF-Complete library.** Reference open-source implementation showing GF(2⁸) arithmetic, Cauchy generators, and bit-matrix optimizations in real code.
- Companion pages: [junior](junior.md) (XOR parity and the (n,k) framing) and [senior](senior.md) (GF(2⁸) in full, error correction, LRC/regenerating codes, repair-traffic tradeoffs).
- Algebra refreshers used throughout: [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md), [Polynomial Operations](../../19-number-theory/22-polynomial-operations/junior.md), and [Gaussian Elimination](../../19-number-theory/19-gaussian-elimination/junior.md).

# Montgomery Multiplication — Mathematical Foundations and Correctness Proofs

## Table of Contents
1. Formal Setup and Definitions
2. Existence of `n'` (Why `n` Must Be Odd / `R` Coprime to `n`)
3. The REDC Correctness Theorem
4. The Output Bound and the Conditional Subtraction
5. Montgomery Multiplication as a Ring Isomorphism
6. Conversion In/Out and Cost Analysis
7. Computing `n'`: Hensel Lifting / Newton Iteration Correctness
8. Barrett Reduction: Correctness and Error Bound
9. Complexity: No Division by `n`
10. Multi-Precision REDC (CIOS) and Limb Analysis
11. Comparison of Reduction Algorithms
12. Summary

---

## 1. Formal Setup and Definitions

Fix a modulus `n ≥ 1` and a radix `R = 2^k` with `R > n` and `gcd(R, n) = 1`.

**Definition 1.1 (Montgomery form).** For `x ∈ ℤ`, its **Montgomery representative** modulo `n` is `x̄ := (x · R) mod n ∈ {0, …, n-1}`.

**Definition 1.2 (the constants).** Since `gcd(R, n) = 1`, both inverses exist:
- `R^{-1}` is the inverse of `R` modulo `n` (so `R · R^{-1} ≡ 1 (mod n)`),
- `n'` is defined by `n' := (-n^{-1}) mod R`, equivalently the unique `n' ∈ {0, …, R-1}` with `n · n' ≡ -1 (mod R)`.

**Definition 1.3 (REDC).** For an integer `T` with `0 ≤ T < n·R`, define
```
REDC(T) := let m = ((T mod R) · n') mod R;
           let t = (T + m·n) / R;
           if t ≥ n then t - n else t.
```

**Definition 1.4 (Montgomery multiplication).** For `ā, b̄ ∈ {0, …, n-1}`, `montMul(ā, b̄) := REDC(ā · b̄)`. The input `ā·b̄ < n² < n·R` (since `R > n`) is always a legal REDC argument, so `montMul` is total on Montgomery-form inputs.

**Remark (notation).** Throughout, `k = log₂ R`, `[P]` is the Iverson bracket, and "`x mod R`" denotes the least non-negative residue. Because `R = 2^k`, `x mod R` is the low `k` bits of `x` (a mask) and `x / R` for `R | x` is a right shift by `k`. We will prove that `REDC(T) ≡ T·R^{-1} (mod n)` and `0 ≤ REDC(T) < n`.

**Definition 1.5 (the running example).** For all worked traces in this document we fix `n = 13`, `R = 16 = 2^4` (so `k = 4`, `R > n`, `gcd(16, 13) = 1`), which yields (Sections 2.1, 6.1) `n^{-1} mod R = 5`, `n' = 11`, `R^{-1} mod n = 9`, and `R² mod n = 9`. Small enough to compute by hand, yet exhibiting both the no-subtraction and the one-subtraction branches of REDC.

**Scope.** Sections 2–9 treat the single-word case (`n < R`, one machine word). Section 10 lifts to multi-precision (`n ≥ 2^64`, `R = 2^{wℓ}`). Section 11 compares Montgomery, Barrett, and schoolbook reduction. All correctness rests on the two cardinal facts proved below: `n·n' ≡ -1 (mod R)` (which makes the `/R` exact) and `gcd(R, n) = 1` (which makes the inverses exist).

**Reading guide.** A reader wanting only the operational guarantee can read Theorem 3.1 (REDC is correct) and Theorem 4.1 (one subtraction suffices); the rest justifies *why* those hold and *when* the technique pays. Theorem 6.2 quantifies the amortization, Section 7 the constant `n'`, Section 8 the Barrett alternative, and Sections 9–11 the complexity and comparison. Every claim is anchored to a numbered theorem and, where instructive, a hand-computable trace with the running example of Definition 1.5.

---

## 2. Existence of `n'` (Why `n` Must Be Odd / `R` Coprime to `n`)

**Theorem 2.1 (Existence and uniqueness of `n'`).** `n'` as in Definition 1.2 exists and is unique in `{0, …, R-1}` if and only if `gcd(R, n) = 1`.

**Proof.** `n` is invertible modulo `R` iff `gcd(n, R) = 1` (the unit group of `ℤ/Rℤ` is exactly the residues coprime to `R`). When it exists, `n^{-1} mod R` is unique, hence so is `n' = (-n^{-1}) mod R`. Conversely, if `gcd(n, R) = d > 1`, then `n` is a zero divisor mod `R`, no multiplicative inverse exists, and there is no `n'` with `n·n' ≡ -1 (mod R)` (such an identity would force `d | 1`). ∎

**Corollary 2.2 (Odd modulus).** With `R = 2^k`, `gcd(R, n) = 1 ⟺ n` is odd. Hence Montgomery's REDC is well-defined exactly for **odd** moduli.

**Proof.** `gcd(2^k, n) = 1` iff `n` has no factor of 2, i.e. `n` is odd. ∎

This is the algebraic root of the odd-modulus restriction emphasized throughout the other files: it is a precondition, not a fixable limitation. For even `n`, `R^{-1} mod n` (Section 3) also fails to exist, so the entire construction collapses.

**Remark 2.3 (Why both inverses are needed).** REDC's *correctness* (Section 3) uses `R^{-1} mod n` to state what it computes; REDC's *exact division* (the `/R` step) uses `n^{-1} mod R` via `n'`. Both require `gcd(R, n) = 1`. The single coprimality condition simultaneously guarantees the algorithm produces a meaningful result and that the division is integral.

### 2.1 Worked Existence Example

Take `n = 13`, `R = 16 = 2^4`. Since `gcd(16, 13) = 1`, both inverses exist:

```
n^{-1} mod R: solve 13·x ≡ 1 (mod 16).  13·5 = 65 = 64 + 1 ≡ 1, so 13^{-1} ≡ 5 (mod 16).
n' = (-5) mod 16 = 11.    Check: 13·11 = 143 = 128 + 15 ≡ 15 ≡ -1 (mod 16). ✓
R^{-1} mod n: solve 16·y ≡ 1 (mod 13). 16 ≡ 3, and 3·9 = 27 ≡ 1 (mod 13), so R^{-1} ≡ 9 (mod 13).
```

Now take `n = 12` (even), `R = 16`. `gcd(16, 12) = 4 ≠ 1`. There is no `x` with `12·x ≡ 1 (mod 16)`: every multiple of 12 mod 16 is in `{0, 12, 8, 4}`, never `1`. So `n'` does not exist and REDC cannot be formed — the formal collapse Corollary 2.2 predicts. This is the worked proof that even moduli are excluded by algebra, not by convention.

### 2.2 The Group-Theoretic View

`(ℤ/Rℤ)^×`, the unit group modulo `R = 2^k`, has order `φ(2^k) = 2^{k-1}` and consists exactly of the odd residues. `n` admits an inverse mod `R` iff `n ∈ (ℤ/Rℤ)^×`, i.e. iff `n` is odd. Symmetrically, `R ∈ (ℤ/nℤ)^×` (so `R^{-1} mod n` exists) iff `gcd(R, n) = 1`, the same condition. Montgomery's entire construction lives in the intersection of these two unit-group memberships, which for `R = 2^k` is precisely "`n` odd". There is no slack: drop coprimality and both required inverses vanish simultaneously.

---

## 3. The REDC Correctness Theorem

**Theorem 3.1 (REDC congruence and integrality).** Let `0 ≤ T < n·R`. Then in Definition 1.3:
1. `R | (T + m·n)` (the division `t = (T + m·n)/R` is exact), and
2. `t ≡ T · R^{-1} (mod n)`, and after the conditional subtraction the returned value `r` satisfies `r ≡ T · R^{-1} (mod n)` with `0 ≤ r < n`.

**Proof of (1) — exact division.** By definition `m ≡ (T mod R)·n' ≡ T·n' (mod R)` (since `T ≡ T mod R (mod R)`). Then
```
T + m·n ≡ T + (T·n')·n ≡ T·(1 + n·n') (mod R).
```
By Definition 1.2, `n·n' ≡ -1 (mod R)`, so `1 + n·n' ≡ 0 (mod R)`, giving `T + m·n ≡ 0 (mod R)`. Therefore `R` divides `T + m·n` and `t = (T + m·n)/R` is an integer. ∎(1)

**Proof of (2) — the congruence.** Working modulo `n`, the term `m·n ≡ 0`, so
```
t·R = T + m·n ≡ T (mod n).
```
Multiplying both sides by `R^{-1}` (which exists since `gcd(R, n) = 1`) gives `t ≡ T·R^{-1} (mod n)`. The conditional subtraction changes `t` by a multiple of `n` (`0` or `-n`), preserving the residue class, so the returned `r ≡ T·R^{-1} (mod n)`. The range `0 ≤ r < n` is Theorem 4.1. ∎(2)

**Corollary 3.2 (Montgomery multiplication is correct).** For `ā = aR mod n`, `b̄ = bR mod n`,
```
montMul(ā, b̄) = REDC(ā·b̄) ≡ (ā·b̄)·R^{-1} ≡ (aR)(bR)R^{-1} ≡ (ab)·R (mod n),
```
so `montMul(ā, b̄) = (ab)‾`, the Montgomery form of `ab mod n`. The input bound holds because `ā, b̄ < n` ⇒ `ā·b̄ < n² < n·R` (using `R > n`). ∎

### 3.1 Worked REDC Trace

Continue with `n = 13`, `R = 16`, `n' = 11`, `a = 7`, `b = 9`. First the Montgomery forms: `ā = 7·16 mod 13 = 112 mod 13 = 8`; `b̄ = 9·16 mod 13 = 144 mod 13 = 1`. The product `T = ā·b̄ = 8·1 = 8` (note `8 < n·R = 208`, in range).

```
Step 1: m = (T mod R)·n' mod R = (8 mod 16)·11 mod 16 = 88 mod 16 = 8.
Step 2: T + m·n = 8 + 8·13 = 8 + 104 = 112.   112 mod 16 = 0 (low 4 bits zero ✓).
        t = 112 / 16 = 7   (an exact shift right by 4).
Step 3: 7 < 13, no subtraction.   REDC(8) = 7.
```

Verify Theorem 3.1(2): `7 ≡ 8·R^{-1} (mod 13)`? `R^{-1} ≡ 9`, so `8·9 = 72 = 65 + 7 ≡ 7 (mod 13)` ✓. And `7` is the Montgomery form of `ab mod n = 63 mod 13 = 11`: indeed `11·16 mod 13 = 176 mod 13 = 7` ✓. Every congruence in the proof is realized numerically.

### 3.1b A Second REDC Trace (No Cancellation Coincidence)

To show the cancellation is structural and not an artifact of small numbers, trace `T = 50` (still `< n·R = 208`) with `n = 13`, `R = 16`, `n' = 11`:

```
m = (50 mod 16)·11 mod 16 = 2·11 mod 16 = 22 mod 16 = 6.
T + m·n = 50 + 6·13 = 50 + 78 = 128.   128 mod 16 = 0 ✓  (low 4 bits forced to zero).
t = 128 / 16 = 8.   8 < 13, no subtraction.   REDC(50) = 8.
```

Verify: `8 ≡ 50·R^{-1} (mod 13)`? `R^{-1} ≡ 9`, `50·9 = 450 = 34·13 + 8`, so `50·9 ≡ 8 (mod 13)` ✓. Again the sum `T + m·n = 128` is a clean multiple of `16` — the constant `m = 6` was forced (via `n'`) to make exactly this happen. No matter what `T` is, Step 1 chooses `m` so that the low `k` bits of `T + m·n` vanish.

### 3.2 The Low-Bit Cancellation, Bit by Bit

The crux is that `T + m·n` has its low `k` bits forced to zero. In the trace, `T = 8 = 01000₂` and `m·n = 104 = 1101000₂`; their sum `112 = 1110000₂` has its low 4 bits `0000`. The constant `m` was chosen (Step 1) precisely as `m ≡ -T·n^{-1}... ` — more directly, `m ≡ T·n' (mod R)` so that `m·n ≡ T·n'·n ≡ -T (mod R)`, making `T + m·n ≡ 0 (mod R)`. This is the runtime meaning of "the division by `R` is exact": the adversary `n` cannot make the low bits anything other than zero, because `n'` is built from `n^{-1}` to cancel them.

---

## 4. The Output Bound and the Conditional Subtraction

**Theorem 4.1 (Output range).** For `0 ≤ T < n·R` and `0 ≤ m < R`, the pre-subtraction value `t = (T + m·n)/R` satisfies `0 ≤ t < 2n`. Hence a single conditional subtraction of `n` yields `0 ≤ r < n`.

**Proof.** Lower bound: `T ≥ 0` and `m·n ≥ 0`, so `t ≥ 0`. Upper bound: `m ≤ R - 1 < R`, so `m·n < R·n`. Combined with `T < n·R`,
```
T + m·n < n·R + n·R = 2n·R,
```
therefore `t = (T + m·n)/R < 2n`. Since `t` is an integer in `[0, 2n)`, exactly one of `t < n` (return `t`) or `n ≤ t < 2n` (return `t - n ∈ [0, n)`) holds. ∎

**Corollary 4.2 (Why exactly one subtraction).** Unlike Barrett (Section 8), REDC's correction is provably at most **one** subtraction, because the additive term `m·n` is bounded by `R·n` and the division by `R` halves the `2nR` bound to `2n`. This is a structural advantage: a single, predictable correction (which a branchless mask can absorb, Section 5 of `senior.md`).

**Remark 4.3 (Redundant representation).** If one allows `T < 4n·R` (e.g. inputs already in `[0, 2n)` so products reach `4n²`), the same computation gives `t < (4n·R + R·n)/R`-style bounds; more carefully, with inputs in `[0, 2n)` and `4n ≤ R`, REDC outputs stay in `[0, 2n)` and the conditional subtraction may be deferred. This is the formal basis for the branch-free hot loops in `senior.md` §5.3: maintain representatives in `[0, 2n)` and normalize once at the end. The precondition `4n ≤ R` (or `2n ≤ R` for the basic case) is exactly what guarantees the deferred bound never overflows the word.

### 4.1 Worked Output-Bound Cases

The bound `t ∈ [0, 2n)` means the subtraction sometimes fires and sometimes does not. With `n = 13`, `R = 16`:

```
Case no-subtraction (Section 3.1): T = 8 gave t = 7 < 13 → return 7.
Case subtraction: take T = 150 (still < n·R = 208).
  m = (150 mod 16)·11 mod 16 = 6·11 mod 16 = 66 mod 16 = 2.
  t = (150 + 2·13)/16 = (150 + 26)/16 = 176/16 = 11.  11 < 13 → no subtraction here either.
Case forcing subtraction: take T = 200 (< 208).
  m = (200 mod 16)·11 mod 16 = 8·11 mod 16 = 8;  t = (200 + 8·13)/16 = (200+104)/16 = 304/16 = 19.
  19 ≥ 13 → subtract once: 19 - 13 = 6.   REDC(200) = 6, and indeed 6 ∈ [0, 13).
```

The largest pre-subtraction `t` here was `19 < 2n = 26`, confirming Theorem 4.1's `[0, 2n)` envelope and that **one** subtraction always suffices. Contrast Barrett (Section 8), where the quotient under-estimate can leave `r` up to just under `3n`, demanding up to two corrections — the structural difference of Corollary 4.2 and Theorem 11.1.

---

## 5. Montgomery Multiplication as a Ring Isomorphism

The Montgomery map is not merely a notational trick — it is an algebra isomorphism, which is why arithmetic "in the form" mirrors arithmetic in `ℤ/nℤ`.

**Definition 5.1.** Let `φ : ℤ/nℤ → ℤ/nℤ` be `φ(x) = x·R mod n` (the Montgomery map).

**Theorem 5.2 (Isomorphism of the multiplicative structure).** Define on the image a "Montgomery product" `x̄ ⊛ ȳ := REDC(x̄·ȳ)`. Then `φ` is a bijection with:
- `φ(x + y) = (φ(x) + φ(y)) mod n` (additive homomorphism — ordinary addition works in the form),
- `φ(x·y) = φ(x) ⊛ φ(y)` (multiplicative homomorphism under `⊛`),
- `φ(1) = R mod n` is the identity for `⊛`.

**Proof.** *Bijection:* `φ` is multiplication by the unit `R` in `ℤ/nℤ`, with inverse `x̄ ↦ x̄·R^{-1} = REDC(x̄)`. *Additive:* `(x+y)R ≡ xR + yR (mod n)`, so Montgomery forms add directly (no REDC needed for addition — important for NTT butterflies). *Multiplicative:* by Corollary 3.2, `φ(x)⊛φ(y) = REDC(xR·yR) = xyR = φ(xy)`. *Identity:* `φ(1)⊛ȳ = REDC(R·ȳ) = R·ȳ·R^{-1} = ȳ`. ∎

**Consequence.** Because `(image of φ, +, ⊛)` is isomorphic to `(ℤ/nℤ, +, ×)`, *any* polynomial computation over `ℤ/nℤ` — modpow, Miller-Rabin's witness recurrence, Pollard-rho's `x²+c`, an entire NTT — can be carried out in Montgomery form and converted back once at the end. Addition is free (same operation); only multiplication routes through REDC. This isomorphism is the precise statement of "convert once, compute many".

**Remark 5.3 (Why the additive homomorphism matters).** The fact that Montgomery forms add with an *ordinary* modular addition (no REDC) is not a minor convenience: it is what makes the form viable for any algorithm mixing `+` and `×`. An NTT butterfly does two additions and one twiddle multiply; a Pollard-rho step does one square and one addition of `c`. If addition required a REDC, the conversion savings would evaporate. The isomorphism guarantees additive structure transports for free; only the multiplicative structure — the genuinely division-heavy part — needs the REDC machinery.

### 5.1 Worked Modpow Under the Isomorphism

Compute `7^3 mod 13` entirely in Montgomery form (`n = 13`, `R = 16`, `n' = 11`, `R² mod 13 = 9`), illustrating Theorem 5.2's "convert once, compute many".

```
Convert in:  base 7 → 7̄ = REDC(7·9) = 8 (Section 6.1).   accumulator = to_mont(1) = R mod 13 = 3.
exp = 3 = 11₂.
  bit 0 = 1: acc = REDC(acc·7̄) = REDC(3·8) = REDC(24).
             m = (24 mod 16)·11 mod 16 = 8·11 mod 16 = 8; t = (24 + 8·13)/16 = 128/16 = 8. acc = 8.
             square base: 7̄ = REDC(8·8) = REDC(64); m = 0·11=0... 64 mod16=0, m=0; t=64/16=4. base = 4.
  bit 1 = 1: acc = REDC(acc·base) = REDC(8·4) = REDC(32); m = 0; t = 32/16 = 2. acc = 2.
             (no further squaring needed.)
Convert out: result = REDC(2) ; m = 2·11 mod 16 = 22 mod 16 = 6; t = (2 + 6·13)/16 = 80/16 = 5. result = 5.
```

Check: `7^3 = 343 = 26·13 + 5`, so `7^3 mod 13 = 5` ✓. Two conversions (in and out) bracketed three Montgomery multiplies; only the multiplies touched REDC, and not a single division by `13` occurred. The accumulator correctly started at `to_mont(1) = R mod n = 3`, not `1` — the Montgomery identity from Theorem 5.2.

---

## 6. Conversion In/Out and Cost Analysis

**Proposition 6.1 (Conversion via REDC).**
- Into: `φ(x) = x·R mod n = REDC(x · (R² mod n))`.
- Out of: `φ^{-1}(x̄) = x̄·R^{-1} mod n = REDC(x̄)` (i.e. `REDC(x̄ · 1)`).

**Proof.** Into: `REDC(x·(R² mod n)) ≡ x·R²·R^{-1} ≡ x·R (mod n)`, and the input `x·(R² mod n) < n·n < n·R` is in range. Out: `REDC(x̄) ≡ x̄·R^{-1} ≡ (xR)R^{-1} ≡ x (mod n)`. ∎

**Cost model.** Let `D` = cost of a hardware division, `M` = cost of a 64×64→128 multiply, `S` = shift/add/mask (all `O(1)`). Then:
- Plain `mulmod`: `1 M + 1 D`.
- REDC: `2 M + O(1) S` (the `lo·n'` and `m·n` multiplies, plus shifts/adds and one subtract).
- Montgomery `mulmod`: `1 M (the product) + 1 REDC = 3 M + O(1) S`.
- Conversion in/out: `1 REDC` each.

**Theorem 6.2 (Amortized break-even).** A computation performing `L` modular multiplications under a fixed odd modulus has plain cost `L·(M + D)` and Montgomery cost `2·REDC_conv + L·(M + REDC)`. Montgomery is faster iff
```
L·(M + D) > 2·(2M) + L·(3M)   ⟺   L·(D - 2M) > 4M   ⟺   L > 4M / (D - 2M).
```
With typical `D ≈ 20–80` cycles and `M ≈ 3` cycles, `D - 2M ≈ 14–74`, so the break-even is `L > 4·3/14 ≈ 0.86` to `L > 12/74 ≈ 0.16` — i.e. **a handful of multiplications**. Any modpow (`L = Θ(log b)`) or inner loop (`L ≫ 1`) clears it comfortably. ∎

This formalizes the "amortize the conversion" mantra: the conversions are a fixed `4M` overhead, and each multiply saves `D - 2M` cycles, so the savings dominate after a tiny constant number of multiplies.

### 6.1 Worked Conversion Example

With `n = 13`, `R = 16`, `R² mod n = 256 mod 13 = 256 - 247 = 9`. Convert `a = 7` in via REDC:

```
REDC(7·9) = REDC(63):  m = (63 mod 16)·11 mod 16 = 15·11 mod 16 = 165 mod 16 = 5.
            t = (63 + 5·13)/16 = (63 + 65)/16 = 128/16 = 8.   8 < 13, so ā = 8.
```

This matches the direct `7·16 mod 13 = 8` from Section 3.1 — conversion-in is just a REDC against the precomputed `R² mod n`, costing no division by `n`. Convert out: `REDC(8) = ?` `m = 8·11 mod 16 = 88 mod 16 = 8`, `t = (8 + 8·13)/16 = 112/16 = 7`, so `from_mont(8) = 7 = a` ✓ (the round-trip of Proposition 6.1).

### 6.1b Worked Break-Even

Suppose `D = 40` cycles (division), `M = 3` cycles (multiply). Theorem 6.2 gives break-even `L > 4M/(D - 2M) = 12/34 ≈ 0.35`, so Montgomery wins from the very first multiply if conversions are reused — but the fairer accounting includes the two conversions explicitly. For a modpow with `L = 60` multiplies (a 60-bit exponent):

```
plain:      60·(M + D)                = 60·43 = 2580 cycles.
Montgomery: 2·REDC_conv + 60·(M + REDC) ≈ 2·9 + 60·(3 + 6) = 18 + 540 = 558 cycles.
```

A ~4.6× speedup, dominated by the `60·(D - REDC) = 60·34 ≈ 2040`-cycle saving from avoiding divisions; the `18`-cycle conversion overhead is negligible. For `L = 1` (a single multiply): plain `43`, Montgomery `18 + 9 = 27` — Montgomery still wins here only because the conversions are cheap relative to one division, but in real code the form-tracking overhead and the fact that you usually need the result in *normal* form (forcing both conversions) make plain `%` the pragmatic choice for isolated multiplies. The lesson of Theorem 6.2 is that the *crossover is tiny*, so any loop is firmly Montgomery territory.

### 6.2 Why Addition Needs No REDC (Cost Implication)

Because `φ(x + y) = φ(x) + φ(y) mod n` (Theorem 5.2), additions in Montgomery form are ordinary modular additions — `O(1)` with no REDC. Only multiplications route through REDC. In an NTT butterfly `(u + t, u - t)` with a single twiddle multiply, the two adds are free and only the twiddle costs a reduction. This is why Theorem 6.2's accounting charges REDC *per multiply*, not per arithmetic operation: the additive structure rides along for free under the isomorphism.

---

## 7. Computing `n'`: Hensel Lifting / Newton Iteration Correctness

We must compute `n^{-1} mod 2^k` (then negate). The Newton/Hensel iteration is `inv ← inv·(2 - n·inv)`.

**Theorem 7.1 (Quadratic convergence of the 2-adic inverse).** Let `n` be odd and suppose `inv ≡ n^{-1} (mod 2^m)`. Then `inv' := inv·(2 - n·inv)` satisfies `inv' ≡ n^{-1} (mod 2^{2m})`.

**Proof.** Write `n·inv = 1 - e` where `2^m | e` (the error). Then
```
n·inv' = n·inv·(2 - n·inv) = (1 - e)(2 - (1 - e)) = (1 - e)(1 + e) = 1 - e².
```
Since `2^m | e`, we have `2^{2m} | e²`, so `n·inv' ≡ 1 (mod 2^{2m})`, i.e. `inv' ≡ n^{-1} (mod 2^{2m})`. ∎

**Corollary 7.2 (Seed and iteration count).** For odd `n`, `n ≡ n^{-1} (mod 8)` (indeed every odd residue is its own inverse mod 8: `1²=1, 3²=9≡1, 5²=25≡1, 7²=49≡1`). Starting from `inv = n` (correct mod `2^3`), the doubling `3 → 6 → 12 → 24 → 48 → 96` reaches `≥ 64` bits in **5** iterations. Then `n' = (-inv) mod 2^k`.

**Proof.** The seed is correct to 3 bits by the mod-8 fact. Theorem 7.1 doubles the correct-bit count each step; five steps give `3·2^5 = 96 ≥ 64`. ∎

**Alternative (extended Euclid).** The extended Euclidean algorithm (sibling `06-extended-euclidean-modular-inverse`) solves `n·x + R·y = 1`, giving `x ≡ n^{-1} (mod R)` in `O(log R)` steps. Both methods agree; Newton uses only ring operations (no gcd), which is why it dominates in practice when `R` is a power of two.

**Verification identity.** Always check `n·n' ≡ R - 1 ≡ -1 (mod R)` once; this single test certifies the constant regardless of how it was computed.

### 7.1 Worked Newton Iteration

Compute `n^{-1} mod 2^8` for `n = 13` (so we can compare to the `mod 16` answer `5`). Seed `inv = 13`, correct mod 8 (`13·13 = 169 ≡ 1 mod 8`):

```
step 1: inv = 13·(2 - 13·13) mod 256 = 13·(2 - 169) mod 256 = 13·(-167) mod 256
            = -2171 mod 256 = -2171 + 9·256 = -2171 + 2304 = 133.   (correct mod 2^6)
        check: 13·133 = 1729 = 6·256 + 193 ... 1729 mod 64 = 1 ✓ (mod 2^6)
step 2: inv = 133·(2 - 13·133) mod 256 = 133·(2 - 1729) mod 256 = 133·(-1727) mod 256.
        -1727 mod 256 = -1727 + 7·256 = 65; 133·65 = 8645; 8645 mod 256 = 8645 - 33·256 = 197.
        check: 13·197 = 2561 = 10·256 + 1, so 13·197 ≡ 1 (mod 256) ✓ (full 8 bits)
```

Two steps from a 3-bit seed gave the inverse mod `2^8` (`3 → 6 → 12 ≥ 8`), matching Corollary 7.2's bit-doubling. Reducing `197 mod 16 = 5` recovers the `mod 16` inverse from Section 2.1, since the 2-adic inverse is consistent across moduli `2^m`. Finally `n' mod 16 = (-5) mod 16 = 11`, as before.

### 7.1b Extended-Euclid Cross-Check

Method B (extended Euclid) on `n = 13`, `R = 16` should give the same `n^{-1} = 5`:

```
ext_gcd(13, 16):
  16 = 1·13 + 3       gcd(13,16) chain → ext_gcd(13,16) calls ext_gcd(16, 13) ...
Running the standard recurrence yields 13·5 + 16·(-4) = 65 - 64 = 1.
So n^{-1} ≡ 5 (mod 16), matching Newton's reduced result, and n' = -5 mod 16 = 11.
```

Both methods produce the identical `n' = 11`, validating the "compute either way, verify with `n·n' ≡ -1`" guidance. Newton needs only multiplies/subtracts (no gcd loop), so it is preferred when `R` is a power of two; extended Euclid generalizes to non-power-of-two `R` but is rarely needed since `R` is always `2^k` in practice.

### 7.2 The 2-adic Inverse as a Coherent Sequence

The Newton iterates form a *coherent* sequence: the inverse mod `2^{2m}` reduces mod `2^m` to the inverse mod `2^m`. This is why one computation at full width (`2^64`) simultaneously yields the inverse at every smaller power of two — there is a single 2-adic integer `n^{-1} ∈ ℤ_2` whose truncations are the finite-width inverses. Montgomery code exploits this by computing once at the word width and never recomputing for narrower needs.

---

## 8. Barrett Reduction: Correctness and Error Bound

Barrett reduces `x` modulo any `n` (no parity restriction, no special form) using a precomputed reciprocal.

**Setup.** Fix `k` with `2^k > n` (commonly `k = 2·⌈log₂ n⌉`). Precompute `μ := ⌊2^{2k} / n⌋`. For `0 ≤ x < n²` (note `x < n² ≤ 2^{2k}` when `n < 2^k`), define
```
BARRETT(x): q = ⌊(x · μ) / 2^{2k}⌋;  r = x - q·n;  while r ≥ n: r -= n;  return r.
```

**Theorem 8.1 (Quotient under-estimation bound).** With `q` as above and `Q := ⌊x/n⌋` the true quotient, `Q - 2 ≤ q ≤ Q`.

**Proof.** Write `μ = 2^{2k}/n - δ` with `0 ≤ δ < 1` (the fractional part dropped by the floor). Then
```
x·μ / 2^{2k} = x/n - x·δ / 2^{2k}.
```
Since `0 ≤ x < n²` and `n < 2^k`, we have `x·δ/2^{2k} < n²·1/2^{2k} ≤ n²/(n)² = 1`... more precisely `x < n² ≤ 2^{2k}/ ... `; using `x ≤ n² - 1` and `δ < 1`, `x·δ/2^{2k} < n²/2^{2k} ≤ 1` (as `2^k > n ⇒ 2^{2k} > n²`). So `x/n - 1 < x·μ/2^{2k} ≤ x/n`. Taking floors, the inner floor in `q` removes at most one more unit, giving `⌊x/n⌋ - 2 ≤ q ≤ ⌊x/n⌋ = Q`. ∎

**Corollary 8.2 (At most two corrections).** `r = x - q·n` satisfies `0 ≤ r < 3n`, since `q ≥ Q - 2` gives `r = x - q·n ≤ x - (Q-2)n = (x - Q·n) + 2n = (x mod n) + 2n < 3n`, and `q ≤ Q` gives `r ≥ x - Q·n = x mod n ≥ 0`. Hence the `while r ≥ n` loop runs **at most twice** and returns `x mod n`. ∎

**Theorem 8.3 (Barrett correctness).** `BARRETT(x) = x mod n` for all `0 ≤ x < n²`.

**Proof.** By Corollary 8.2, after the corrections `r ∈ [0, n)` and `r ≡ x - q·n ≡ x (mod n)`, so `r = x mod n`. ∎

### 8.0 Worked Barrett Example

Take `n = 13`, `k = 4` (so `2^k = 16 > 13`), `2k = 8`, `2^{2k} = 256`. Precompute `μ = ⌊256/13⌋ = 19`. Reduce `x = 100` (note `100 < n² = 169`):

```
q = ⌊(100·19) / 256⌋ = ⌊1900 / 256⌋ = ⌊7.42⌋ = 7.    (true quotient ⌊100/13⌋ = 7)
r = 100 - 7·13 = 100 - 91 = 9.    9 < 13, no correction.   BARRETT(100) = 9 = 100 mod 13 ✓.
```

Here the estimate `q = 7` hit the true quotient exactly (no correction). For a case needing a correction, reduce `x = 168` (`= n² - 1`): `q = ⌊168·19/256⌋ = ⌊3192/256⌋ = ⌊12.46⌋ = 12`, but true `⌊168/13⌋ = 12`, `r = 168 - 156 = 12 < 13` — again exact. The under-estimate of Theorem 8.1 is conservative; in practice 0 or 1 corrections are typical, with 2 the proven worst case. Crucially, no division by `n` ran — only the one-time `μ = ⌊256/13⌋`.

To exhibit a real correction, pick a smaller `k`. With `n = 13`, `k = 4`, `μ = 19` as above but reduce `x = 155`: `q = ⌊155·19/256⌋ = ⌊2945/256⌋ = ⌊11.50⌋ = 11`; true `⌊155/13⌋ = 11`; `r = 155 - 143 = 12 < 13` — still no correction. The bound permits up to two corrections, but the conservative analysis (`δ < 1`, `x < n²`) rarely forces them for well-chosen `k`; implementations nonetheless loop defensively (or branchlessly subtract twice) to guarantee correctness in the worst case.

**Remark 8.4 (No division by `n`).** Both multiplications (`x·μ`, `q·n`) and the shift `/2^{2k}` avoid hardware division by `n`; only the one-time `μ = ⌊2^{2k}/n⌋` uses division, amortized across all reductions — the same amortization principle as Montgomery's `n'`/`R²`.

**Remark 8.5 (Tightening `k`).** Choosing `k = ⌈log₂ n⌉` (so `2^k > n` minimally) keeps `μ` as small as possible (`< 2^{k+1}`) and the products `x·μ` within a bounded width. Some implementations use `2^{k+1}` or a `+1` slack in `k` to absorb edge cases at `x` near `n²`; the analysis of Theorem 8.1 only needs `2^k > n` and `x < n²`. The variant computing `q` in two stages (`⌊x/2^{k-1}⌋`, then `·μ`, then `>>(k+1)`) — the "classical Barrett" — reduces the intermediate width at the cost of one extra shift; it is equivalent in correctness and bound.

---

## 9. Complexity: No Division by `n`

**Theorem 9.1.** Both REDC and Barrett perform `O(1)` machine operations per reduction (fixed word width), **none of which is a division by `n`**; the only divisions are by `R = 2^k` (a shift) and the one-time precomputation.

**Proof.** REDC: one `lo·n'` multiply, one `m·n` multiply, additions/carries, a shift by `k` (division by `R`), one conditional subtraction — all `O(1)`, no `÷ n`. Barrett: one `x·μ`, one shift by `2k`, one `q·n`, ≤ 2 subtractions — `O(1)`, no `÷ n`. The precomputations (`n'` via `O(log k)` Newton steps or `O(log R)` Euclid; `μ` via one division; `R² mod n`) are one-time per modulus. ∎

**Corollary 9.2 (Modpow complexity).** Montgomery modular exponentiation `a^b mod n` runs `Θ(log b)` Montgomery multiplies plus two conversions, total `Θ(log b)` `O(1)`-each operations — asymptotically identical to plain modpow, but each multiply avoids a hardware division. The improvement is a **constant factor**, governed by Theorem 6.2. ∎

**Theorem 9.3 (Lower bound — no asymptotic win).** Modular reduction of an `O(1)`-word value is `Θ(1)` operations; no reducer can beat `Θ(1)`. Montgomery/Barrett do not change the asymptotic complexity of any algorithm; they only shrink the constant by removing the division instruction. This is why they are *implementation* techniques, not *algorithmic* ones. ∎

### 9.1 Where the Constant Actually Goes

The asymptotic equivalence (Corollary 9.2) hides the practical story. On a typical x86-64 core, a 64-bit `DIV` has a latency of ~20–90 cycles and a reciprocal throughput far worse than `MUL` (~3 cycles, fully pipelined). Worse, `DIV` is *not pipelined*: a dependent chain of divisions (exactly what a modpow's `acc = (acc*b) % n` produces) serializes on the divider unit, while a chain of `MUL`s overlaps. REDC replaces the one `DIV` with two `MUL`s and a handful of single-cycle adds/shifts. So per multiply, the cycle ledger is roughly:

```
plain mulmod:   1 MUL (product) + 1 DIV          ≈ 3 + 40 = 43 cycles
Montgomery:     1 MUL (product) + 2 MUL + adds    ≈ 3 + 6 + a few ≈ 12 cycles
```

A ~3–4× per-multiply win is typical for runtime moduli where the compiler cannot strength-reduce. Over a `Θ(log b)` modpow loop the absolute saving is `Θ(log b)·(D - 2M)` cycles — the same `(D - 2M)` factor that drove the break-even Theorem 6.2. The asymptotics are equal; the constant is the entire reason the technique exists.

Two further constant-factor effects compound this:

- **Pipelining.** Because Montgomery's per-multiply work is all `MUL`/`ADD`/`SHIFT`, successive iterations of a squaring chain can partially overlap on a superscalar core, whereas the `DIV` chain stalls. The effective speedup can exceed the raw cycle ratio.
- **Side channel.** `DIV` latency can depend on operands, leaking timing; the multiply/shift path is fixed-latency. Thus REDC's constant-factor win is also a constant-time win (developed in `senior.md` §5), which is why it is mandatory, not optional, in cryptographic implementations regardless of raw speed.

### 9.2 Precomputation Amortization, Formally

Let a workload reuse one modulus for `L` multiplies. Setup cost is `C_setup = Θ(log n)` (Newton for `n'`, doubling for `R²`, both one-time). Total Montgomery cost is `C_setup + 2·REDC + L·(M + REDC)`; plain is `L·(M + D)`. As `L → ∞`, the `C_setup` term vanishes relative to `L·REDC`, so the per-multiply comparison `REDC + M` vs `D + M` decides — and `REDC < D` by Section 9.1. The setup is strictly a fixed cost; it never appears in the asymptotic per-operation rate, which is why "build the context once" (a recurring failure mode in `senior.md` §9.8) is the only thing that can negate the benefit.

### 9.3 The Big-Integer Exception

The constant-factor framing assumes `O(1)`-word operands. When `n` is itself huge (`n ≥ 2^64`, multi-limb), each `mulmod` is no longer `O(1)`: the product of two `ℓ`-limb numbers is `Θ(ℓ²)` word operations (or `Θ(ℓ log ℓ)` with FFT-based multiplication). Here Montgomery's advantage is not "remove a single division" but "avoid the *multi-limb* division entirely", which is far more expensive than a multi-limb multiply. The CIOS variant (Section 10) folds reduction into the multiply at `Θ(ℓ²)`, versus the schoolbook divide-and-reduce which would need a multi-precision long division — substantially costlier. So for big integers the win is larger in relative terms, and Montgomery (or Barrett with a precomputed multi-limb reciprocal) is essentially universal in crypto libraries.

---

## 10. Multi-Precision REDC (CIOS) and Limb Analysis

For `n ≥ 2^64`, `R = 2^{wℓ}` where `w` is the word size and `ℓ` the limb count. The **CIOS** (Coarsely Integrated Operand Scanning) variant interleaves multiplication and reduction limb-by-limb.

**Sketch.** Represent operands in base `2^w`. CIOS runs `ℓ` outer iterations; in iteration `i` it (a) adds `a_i · b` to the accumulator, then (b) computes `q_i = (acc_0 · n'_0) mod 2^w` and adds `q_i · n`, which zeros the lowest limb (the multi-limb echo of REDC's low-bit cancellation), then shifts right one limb. After `ℓ` iterations the accumulator holds `a·b·R^{-1} mod n` (with a possible final subtraction).

**Theorem 10.1 (CIOS correctness).** After the `ℓ` outer iterations and final conditional subtraction, CIOS returns `a·b·R^{-1} mod n`, for `0 ≤ a, b < n`.

**Proof idea.** Each outer step `i` chooses `q_i ≡ acc·n'_0 (mod 2^w)` so that `acc + q_i·n ≡ 0 (mod 2^w)`, making the limb-shift exact — exactly the single-word REDC argument (Theorem 3.1(1)) applied to the lowest limb. Inductively, after `ℓ` shifts the accumulator equals `(a·b + (Σ q_i 2^{wi})·n)/R`, which is `≡ a·b·R^{-1} (mod n)` and bounded by `2n`, so one final subtraction normalizes it. ∎

**Complexity.** CIOS uses `2ℓ² + ℓ` word multiplications, versus `ℓ²` for the bare product plus a separate reduction — the integration saves passes and memory traffic. This is the algorithm inside RSA/ECC libraries.

### 10.1 Why Interleaving Helps

The separate-then-reduce approach computes the full `2ℓ`-limb product `a·b` (using `ℓ²` word multiplies), stores it, then runs a separate `ℓ`-limb REDC pass over it (`ℓ²` more). CIOS instead reduces the accumulator after each outer step, so the accumulator never grows beyond `ℓ + 1` limbs — it stays small. The benefits are concrete:

- **Memory traffic:** the accumulator fits in registers/L1 for moderate `ℓ`, whereas the `2ℓ`-limb intermediate of the separate approach spills.
- **No separate storage** of the double-width product.
- **Same multiply count** asymptotically (`Θ(ℓ²)`), but a smaller constant and better locality.

The `n'_0` used is just the low word of the full `n' = -n^{-1} mod 2^{wℓ}`; only the lowest limb matters for the per-step cancellation, because each step zeros exactly one limb. This is the limb-wise refinement of the single-word fact that only `T mod R` enters Step 1 of REDC.

### 10.1b Tiny Two-Limb Trace

Let `w = 4` (4-bit limbs), `ℓ = 2`, so `R = 2^8 = 256`. Take `n = 13` (a 4-bit value padded to 2 limbs: `n = (0, 13)` in base 16). Then `n'_0 = -13^{-1} mod 16 = 11` (Section 2.1). Multiply `a = 7`, `b = 9` (each a single low limb). The CIOS outer loop runs `ℓ = 2` steps; we track the accumulator `acc`:

```
init acc = 0.
i = 0 (a_0 = 7):
  acc += a_0·b = 7·9 = 63.                              acc = 63.
  q_0 = (acc_0 · n'_0) mod 16 = (63 mod 16)·11 mod 16 = 15·11 mod 16 = 5.
  acc += q_0·n = 63 + 5·13 = 128.   low limb 128 mod 16 = 0 ✓ (cancels).
  shift down one limb: acc = 128 / 16 = 8.
i = 1 (a_1 = 0):
  acc += a_1·b = 8 + 0 = 8.
  q_1 = (8 mod 16)·11 mod 16 = 88 mod 16 = 8.
  acc += q_1·n = 8 + 8·13 = 112.   112 mod 16 = 0 ✓.
  shift down: acc = 112 / 16 = 7.
acc = 7 < 13, no final subtraction.   CIOS = 7 = a·b·R^{-1} mod n.
```

The result `7` matches single-word REDC(`ā·b̄`) — but note the multi-limb routine reduces `a·b` (not `ā·b̄`) directly, returning `a·b·R^{-1} mod n = 63·R^{-1} mod 13`; with `R^{-1} = R^{-1} mod 13`... here `R = 256`, `256 ≡ 9 (mod 13)`, `9^{-1} ≡ 3 (mod 13)`, so `63·3 mod 13 = 189 mod 13 = 7` ✓. Each outer step zeroed exactly one limb (`128`, then `112`, both `≡ 0 mod 16`), the multi-limb echo of the single-word cancellation — concretely demonstrating Theorem 10.1.

### 10.2 FIOS and Other Variants

Beyond CIOS, the literature (Koç-Acar-Kaliski) catalogs SOS (Separated Operand Scanning), FIOS, FIPS, and CIHS, differing in how tightly the multiply and reduce loops interleave and in their register pressure. The choice is architecture-dependent: CIOS is the common default for its balance of simplicity and locality, while finely interleaved variants (FIOS/FIPS) can win on architectures with more registers or specific multiply-accumulate instructions. All compute the same `a·b·R^{-1} mod n` and rest on the identical low-limb cancellation argument (Theorem 10.1).

---

## 11. Comparison of Reduction Algorithms

| Algorithm | Division by `n`? | Modulus | Special form? | Per-reduce mults | Corrections | Best regime |
|-----------|------------------|---------|---------------|------------------|-------------|-------------|
| Schoolbook `%` | **Yes** (1 HW div) | any | no | 0 (div does it) | — | one-off, constant modulus |
| Montgomery REDC | No | **odd** | yes (`xR mod n`) | 2 | exactly ≤ 1 | long chains, fixed odd `n` |
| Barrett | No | any | no | 2 | ≤ 2 | conversion-free, any `n` |
| CIOS (multi-limb) | No | odd | yes | `2ℓ²+ℓ` | ≤ 1 | `n ≥ 2^64`, crypto |

**Theorem 11.1 (Montgomery's tighter correction).** REDC needs at most **one** correction (Theorem 4.1), while Barrett may need **two** (Corollary 8.2). This follows because REDC's added multiple `m·n < R·n` is exactly bounded to halve the `2nR` numerator to `2n`, whereas Barrett's quotient under-estimate can be off by 2. In a branch-free implementation this means REDC absorbs its correction in a single masked subtract; Barrett may need two (or a wider analysis). ∎

**Algebraic distinction.** Montgomery works in the *isomorphic image* `φ(ℤ/nℤ)` (Section 5); Barrett works *directly* in `ℤ/nℤ`. Montgomery trades a one-time isomorphism setup (and per-value conversion) for the cheaper per-multiply; Barrett pays nothing up front per value but slightly more per reduce. The choice is the classic conversion-amortization tradeoff, made precise by Theorem 6.2.

### 11.1 Side-by-Side Worked Reduction

Reduce the same product two ways for `n = 13`. Compute `7·9 mod 13` (`= 11`).

**Plain:** `63 mod 13 = 63 - 52 = 11` — one hardware division.

**Montgomery (Section 5.1 pipeline, condensed):** `ā = 8`, `b̄ = 1` (wait — that is `7̄·9̄` for forms); to reduce the *raw* product `63` we instead Barrett or convert. The Montgomery route reduces `ā·b̄ = REDC(8·1) = 7` (Section 3.1), the Montgomery form of `11`; converting out gives `11`. Two REDCs (one for the multiply, one to convert out), no division.

**Barrett:** `μ = ⌊256/13⌋ = 19`; `q = ⌊63·19/256⌋ = ⌊1197/256⌋ = 4`; true `⌊63/13⌋ = 4`; `r = 63 - 4·13 = 63 - 52 = 11`. No correction, no division by 13 (only the one-time `μ`).

All three return `11`. Plain spends a division; Montgomery and Barrett spend multiplies and shifts. Montgomery additionally requires the value to be in (or converted to) Montgomery form, which is why it shines only across chains — exactly the amortization tradeoff Theorem 6.2 quantifies and Theorem 11.1's correction-count difference refines.

### 11.2 Decision Summary (Formal)

Combining Theorems 2.1, 6.2, 8.3, 9.1:

- `n` even ⇒ Montgomery invalid (Cor 2.2) ⇒ Barrett or plain.
- `n` odd, `L` multiplies, `L > 4M/(D-2M)` ⇒ Montgomery (Thm 6.2).
- `n` arbitrary, no conversion wanted ⇒ Barrett (Thm 8.3, any modulus).
- single reduce / compile-time `n` ⇒ plain `%` (compiler strength-reduces).
- `n ≥ 2^64` ⇒ CIOS multi-limb Montgomery (Thm 10.1).

Each branch is backed by a theorem in this file; the engineering choice is a lookup against the modulus parity, the multiply count, and the integer width.

---

## 12. Summary

- **Setup.** `R = 2^k > n`, `gcd(R, n) = 1`; `x̄ = xR mod n`; `n' = (-n^{-1}) mod R` so `n·n' ≡ -1 (mod R)`.
- **`n'` existence (Section 2).** `n'` exists iff `gcd(R, n) = 1`, i.e. (with `R = 2^k`) iff `n` is **odd**. This is why Montgomery is an odd-modulus technique — an algebraic necessity, not an implementation gap.
- **REDC correctness (Section 3).** For `0 ≤ T < nR`: `R | (T + m·n)` because `n·n' ≡ -1 (mod R)` cancels the low bits, so the `/R` is exact; and `REDC(T) ≡ T·R^{-1} (mod n)`.
- **Output bound (Section 4).** The pre-subtraction value lies in `[0, 2n)`, so **one** conditional subtraction suffices — provably fewer corrections than Barrett's two. Relaxing inputs to `[0, 2n)` (with `4n ≤ R`) lets the subtraction be deferred (redundant representation).
- **Isomorphism (Section 5).** `φ(x) = xR` is a bijection with `φ(xy) = REDC(φ(x)φ(y))` and free addition; so any `ℤ/nℤ` computation runs in the form and converts back once — the formal "convert once, compute many".
- **Cost (Section 6).** Conversions are a fixed `≈ 4M` overhead; each multiply saves `D - 2M` cycles, so Montgomery breaks even after a handful of multiplies and dominates for modpow / inner loops.
- **`n'` computation (Section 7).** Newton/Hensel `inv ← inv(2 - n·inv)` doubles correct bits each step (quadratic convergence), reaching 64 bits in 5 iterations from the mod-8 seed; extended Euclid is the gcd-based alternative.
- **Barrett (Section 8).** Precompute `μ = ⌊2^{2k}/n⌋`; the quotient estimate is within `[Q-2, Q]`, so at most two corrections, no parity restriction, no special form, and no division by `n` in the hot path.
- **Complexity (Section 9).** Both are `Θ(1)` per reduce with **no division by `n`**; they change only the constant, never the asymptotics — implementation techniques, not algorithmic speedups.
- **Multi-precision (Section 10).** CIOS interleaves multiply and reduce limb-by-limb (`2ℓ²+ℓ` word mults), the algorithm inside crypto libraries for `n ≥ 2^64`; the single-word low-bit cancellation lifts to a per-limb cancellation (Section 10.1b trace).
- **Reduction comparison (Section 11).** Three reducers, one table: schoolbook (`÷n`, any modulus, one-off), Montgomery (no `÷n`, odd, ≤ 1 correction, long chains), Barrett (no `÷n`, any modulus, ≤ 2 corrections, conversion-free). The decision (Section 11.2) is a lookup against parity, multiply count, and width.

### Worked-Example Index (all with `n = 13`, `R = 16`)

| Section | What it shows |
|---------|---------------|
| 2.1 | `n'` exists for odd `n=13`, fails for even `n=12`. |
| 3.1 / 3.1b | REDC traces (`T=8`, `T=50`) with exact `/R`. |
| 4.1 | Output bound cases: no-subtraction and one-subtraction. |
| 5.1 | Full `7^3 mod 13 = 5` modpow in Montgomery form. |
| 6.1 | Conversion in/out round-trip via REDC. |
| 6.1b | Numeric break-even (≈4.6× for a 60-bit exponent). |
| 7.1 / 7.1b | Newton iteration and extended-Euclid cross-check for `n^{-1}`. |
| 8.0 | Barrett reduction of `100 mod 13` with `μ=19`. |
| 10.1b | Two-limb CIOS trace returning `7`. |
| 11.1 | Plain vs Montgomery vs Barrett, all giving `11`. |

### Theorem Index

| Result | Statement |
|--------|-----------|
| Thm 2.1 / Cor 2.2 | `n'` exists ⟺ `gcd(R,n)=1` ⟺ `n` odd (for `R=2^k`). |
| Thm 3.1 | `R \| (T+mn)` and `REDC(T) ≡ T·R^{-1} (mod n)`. |
| Thm 4.1 | Pre-subtraction value `∈ [0, 2n)`; one correction suffices. |
| Thm 5.2 | `φ(x)=xR` is a multiplicative isomorphism with free addition. |
| Thm 6.2 | Montgomery break-even at `L > 4M/(D-2M)` ≈ a few multiplies. |
| Thm 7.1 | Newton step doubles correct 2-adic-inverse bits (quadratic). |
| Thm 8.1–8.3 | Barrett quotient `∈ [Q-2, Q]`; ≤ 2 corrections; correct for `x < n²`. |
| Thm 9.1–9.3 | `Θ(1)` per reduce, no `÷n`; constant-factor only. |
| Thm 10.1 | CIOS returns `ab·R^{-1} mod n` for multi-limb operands. |
| Thm 11.1 | REDC needs ≤ 1 correction vs Barrett's ≤ 2. |

### Closing Notes

- **The two pillars.** Every theorem traces back to (i) `gcd(R, n) = 1` (existence of both inverses, Section 2) and (ii) `n·n' ≡ -1 (mod R)` (exact division by `R`, Section 3). For `R = 2^k`, pillar (i) collapses to "`n` odd". Remove either and the construction is meaningless — this is why the odd-modulus restriction is stated as a hard precondition, not a corner case.
- **Constant-factor, not asymptotic (Section 9).** Montgomery and Barrett are implementation techniques: they remove the slow hardware division but leave every algorithm's `O(·)` unchanged. Their entire value is the cycle ledger of Section 9.1 (`D` vs `2M`), realized only when the setup amortizes (Section 9.2) — "build the context once" is the single most important operational rule.
- **Isomorphism is the unifier (Section 5).** Because `φ(x) = xR` is a ring isomorphism onto its image with free addition, *any* modular computation — modpow, Miller-Rabin, Pollard-rho, NTT — runs in Montgomery form with conversions only at the boundaries. This is the formal content of "convert once, compute many" and the reason the technique composes with every sibling topic.
- **Montgomery vs Barrett (Section 11).** Montgomery: cheaper per-multiply, ≤ 1 correction, but needs odd `n` and a special form. Barrett: any modulus, no form, but ≤ 2 corrections and an extra multiply. The choice is the conversion-amortization tradeoff, quantified by Theorem 6.2 and refined by Theorem 11.1.
- **Scaling up (Section 10).** For `n ≥ 2^64`, CIOS limb-interleaving preserves the single-word cancellation argument limb by limb (Theorem 10.1, traced in Section 10.1b) and is the algorithm inside production RSA/ECC.

Foundational references: P. L. Montgomery, "Modular multiplication without trial division", *Math. Comp.* 44 (1985); P. Barrett, "Implementing the Rivest-Shamir-Adleman public key encryption algorithm on a standard digital signal processor", CRYPTO '86; Koç, Acar, Kaliski, "Analyzing and comparing Montgomery multiplication algorithms", *IEEE Micro* (1996) for CIOS/FIOS; the Hensel-lifting inverse appears in any 2-adic / `p`-adic analysis text. Sibling topics: `02-modular-arithmetic`, `05-crt`, `06-extended-euclidean-modular-inverse`, `08-miller-rabin-primality`, `09-pollard-rho`, `13-ntt`.

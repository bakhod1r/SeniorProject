# Bit Tricks — Mathematical Foundations and Correctness Proofs

> **One-line summary:** Every bit trick is a theorem. This file proves them: the two's-complement identity `-x = ~x + 1`, why `x & (x-1)` clears and `x & -x` isolates the lowest set bit, the correctness of parallel/SWAR popcount as a divide-and-conquer Hamming-weight computation, the power-of-two and next-power-of-two characterizations, and the de Bruijn-sequence construction that yields O(1) ctz from a single multiply and table lookup.

---

## Table of Contents

1. [Formal Setting and Notation](#1-formal-setting-and-notation)
2. [Two's Complement Identities](#2-twos-complement-identities)
3. [Clearing the Lowest Set Bit](#3-clearing-the-lowest-set-bit)
4. [Isolating the Lowest Set Bit](#4-isolating-the-lowest-set-bit)
5. [Power-of-Two Characterization](#5-power-of-two-characterization)
6. [Next Power of Two](#6-next-power-of-two) and [Integer Logarithm](#6b-integer-logarithm-and-rounding-theorems)
7. [Parallel / SWAR Popcount Derivation](#7-parallel--swar-popcount-derivation)
8. [De Bruijn Sequences for O(1) CTZ](#8-de-bruijn-sequences-for-o1-ctz)
9. [Sign, Abs, and Sign Extension](#9-sign-abs-and-sign-extension)
10. [Worked Numeric Examples](#10-worked-numeric-examples)
11. [Modular Arithmetic of Shifts](#11-modular-arithmetic-of-shifts)
12. [Counting Identities](#12-counting-identities-and-their-proofs) and [Boolean Semiring / Bitsets](#12b-the-boolean-semiring-and-bitset-operations)
13. [Algebraic Structure](#13-algebraic-structure-of-bitwise-ops), [Shift-Or Matching](#13c-shift-or-string-matching-a-worked-theorem)
14. [Complexity Lower Bounds](#14-complexity-lower-bounds), [Morton Codes](#14b-bit-interleaving-morton-codes)
15. [Summary](#15-summary)

---

## 1. Formal Setting and Notation

Fix a width `W` (typically 32 or 64). An unsigned machine integer is an element of `Z / 2^W Z`, identified with its residue in `{0, 1, …, 2^W − 1}`. Write the binary expansion

```
x = Σ_{i=0}^{W-1} b_i · 2^i,   b_i ∈ {0, 1}.
```

The bit `b_i` is `(x >> i) & 1`. Define:

- **popcount(x)** = `Σ_i b_i` (the Hamming weight, the number of 1 bits).
- **ctz(x)** = the smallest `i` with `b_i = 1` (for `x ≠ 0`); the index of the lowest set bit.
- **clz(x)** = `W − 1 − (largest i with b_i = 1)` for `x ≠ 0`.

Bitwise operations act coordinatewise on the bit vector `(b_0, …, b_{W-1})`. Arithmetic (`+`, `−`, unary `−`) is performed modulo `2^W`. The interplay between the *coordinatewise* logical operations and the *carry-propagating* arithmetic operations is exactly what makes nontrivial identities possible.

A key structural fact we use repeatedly: write any nonzero `x` as

```
x = u · 2^s,   with s = ctz(x) and u odd,
```

equivalently `x = (high bits) · 2^{s+1} + 2^s`, i.e. `x` has the form `…a 1 0…0` where there are exactly `s` trailing zeros.

**The bit-extraction map is a ring homomorphism onto `GF(2)`.** For a fixed position `i`, the map `b_i : Z/2^W Z → {0,1}` given by `x ↦ (x >> i) & 1` is *not* linear over the integers (carries interfere), but the full bit-vector map `x ↦ (b_0,…,b_{W-1})` is a bijection that turns bitwise XOR into coordinatewise `GF(2)` addition and bitwise AND into coordinatewise multiplication. We will use this dictionary constantly: a statement about an integer's bits is a statement about a vector in `GF(2)^W`, and vice versa. The subtlety — and the source of every nontrivial proof here — is that *arithmetic* `+/−` does **not** act coordinatewise (it carries), so identities mixing arithmetic and bitwise ops require the borrow/carry analysis we develop in §3 and §4.

**Notation for runs.** We write `1^a 0^b` for `a` ones followed by `b` zeros, and use it to describe intermediate values like `x − 1 = (high) 0 1^s` when `ctz(x) = s`. This run notation makes the borrow-ripple arguments mechanical.

---

## 2. Two's Complement Identities

**Definition.** In two's-complement, the negation of `x` is the value `n` with `x + n ≡ 0 (mod 2^W)`, namely `n = 2^W − x` (for `x ≠ 0`; `−0 = 0`).

**Identity (NOT–negate).** `−x = ~x + 1`, equivalently `~x = −x − 1`.

*Proof.* For each bit, `~x` flips `b_i`, so as an integer `~x = Σ_i (1 − b_i) 2^i = (Σ_i 2^i) − x = (2^W − 1) − x`. Therefore `~x + 1 = 2^W − x ≡ −x (mod 2^W)`. ∎

This single identity, `−x = ~x + 1`, underlies essentially every "lowest set bit" trick, because it tells us precisely how the borrow/carry interacts with the bit pattern of `x`.

**Corollary.** `~x + x = −1` (all-ones), since `~x = −x − 1 ⇒ ~x + x = −1`. Hence `x ^ ~x = −1` and `x & ~x = 0`.

**Why two's complement is the *unique* representation making addition uniform.** We want a representation of negatives such that the *same* binary adder computes `a + b` correctly whether operands are signed or unsigned. That requires `−x` to be the additive inverse mod `2^W`, i.e. `−x ≡ 2^W − x`. Two's complement is exactly this choice, and it is unique: any other encoding (sign-magnitude, one's complement) needs a different adder or has two zeros. *Consequence:* subtraction `a − b` is implemented as `a + (~b) + 1`, reusing the adder, and the carry-in `+1` is precisely the `+1` in `−b = ~b + 1`. This is why CPUs have no separate "signed add" — the bit pattern manipulations in this file inherit that uniformity for free.

**The asymmetric range.** With `W` bits, two's complement represents `−2^{W−1} .. 2^{W−1} − 1`: one more negative than positive. Therefore `INT_MIN = −2^{W−1}` has no positive counterpart, and `−INT_MIN` overflows back to `INT_MIN` (since `2^W − 2^{W−1} = 2^{W−1} ≡ −2^{W−1}`). Every "abs"/"negate"/"`x & −x`" proof in this file must footnote this single exceptional input.

---

## 3. Clearing the Lowest Set Bit

**Theorem.** For `x ≠ 0`, `x & (x − 1)` equals `x` with its lowest set bit cleared. Consequently `popcount(x & (x−1)) = popcount(x) − 1`.

*Proof.* Write `x = p · 2^{s+1} + 2^s` where `s = ctz(x)`, so the bottom of `x` is `1` followed by `s` zeros, and `p` holds the bits above position `s`. Then

```
x − 1 = p · 2^{s+1} + (2^s − 1).
```

Subtracting 1 leaves the high part `p · 2^{s+1}` untouched (no borrow escapes above bit `s` because bit `s` was 1), turns bit `s` from 1 to 0, and turns the `s` zeros below it into `s` ones (the value `2^s − 1`). Now AND:

- **High bits (≥ s+1):** identical in `x` and `x−1`, so they survive unchanged.
- **Bit s:** `1` in `x`, `0` in `x−1` ⇒ AND gives `0`. The lowest set bit is cleared.
- **Bits below s:** `0` in `x`, `1` in `x−1` ⇒ AND gives `0`.

So `x & (x−1) = p · 2^{s+1}`, which is exactly `x` with bit `s` removed. Since one set bit (and only one) was removed, the popcount drops by exactly 1. ∎

**Consequence (Kernighan termination).** The loop `while x: x &= x−1; c++` decrements popcount by exactly 1 per iteration and terminates when `x = 0`, so it runs exactly `popcount(x₀)` times and returns the correct count. This proves both correctness and the O(popcount) bound.

**Corollary (clearing the lowest *k* set bits).** Applying `x & (x−1)` repeatedly `k` times clears the `k` lowest set bits. *Proof:* by induction on `k` using the single-step theorem; the base `k=0` is trivial and each step removes the (current) lowest set bit, which is the next-lowest of the original. ∎ Equivalently, `x` with its lowest set bit *and* everything below replaced by 1s is `x | (x − 1)` (the dual smear), and `x ^ (x − 1)` produces a mask of the lowest set bit *and all trailing zeros* — useful for extracting "the lowest set bit and below" as a contiguous run.

---

## 4. Isolating the Lowest Set Bit

**Theorem.** For all `x`, `x & −x = x & (~x + 1)` equals `2^{ctz(x)}` (a single bit) when `x ≠ 0`, and `0` when `x = 0`.

*Proof.* Use the same decomposition `x = p · 2^{s+1} + 2^s`, `s = ctz(x)`. By §2, `−x = ~x + 1`. Compute `~x`: it flips every bit, so its bottom `s` bits are all `1`, bit `s` is `0`, and the high part is `~p` (within the field above `s`). Adding 1 to `~x` causes a carry to ripple through the bottom `s` ones, turning them back to 0 and setting bit `s` to 1:

```
~x      = (~p part) · 2^{s+1} + 0·2^s + (2^s − 1)
~x + 1  = (~p part) · 2^{s+1} + 1·2^s + 0
```

So `−x` has its bit `s` set to 1, its bits below `s` are 0, and above `s` it is the complement-ish high part. AND with `x`:

- **Bit s:** `1` in both ⇒ `1`.
- **Bits below s:** `0` in `x` ⇒ `0`.
- **Bits above s:** `x` has `p`, `−x` has the carried complement of `p`; bit-by-bit `b ∧ ¬b = 0` for every position above `s` (because adding 1 only flipped bits up to and including `s`, leaving the high region as the bitwise complement of `x`'s high region). ⇒ all `0`.

Hence only bit `s` survives: `x & −x = 2^s = 2^{ctz(x)}`. For `x = 0`, `−0 = 0`, so the AND is 0. ∎

**Corollary (ctz from isolation).** `ctz(x) = popcount((x & −x) − 1) = log2(x & −x)`. Subtracting 1 from a single-bit value `2^s` yields `s` ones, whose popcount is `s`.

**Corollary (turn off trailing ones, or fill trailing zeros).** Dual identities follow by the same borrow/carry analysis: `x | (x + 1)` sets the lowest *clear* bit (the OR analog), `x & (x + 1)` turns off the trailing ones, and `x | (x − 1)` sets all the trailing zeros. *Proof sketch:* `x + 1` carries through the trailing ones of `x`, setting the lowest 0 and clearing the run below it — the mirror image of the `x − 1` borrow used in §3. Each combination with `&`/`|` then selects the desired surviving bits. ∎ Together with §3–§4 these give a complete toolkit for manipulating "the lowest set/clear bit and its run" without any loop.

**Corollary (lowest-set-bit mask, inclusive of below).** `x ^ (x − 1)` equals a contiguous run of 1s covering the lowest set bit and all positions below it (`2^{s+1} − 1` for `ctz(x) = s`). *Proof:* `x` and `x − 1` agree above bit `s` and differ in positions `0..s`, so their XOR is exactly the low `s+1` bits set. ∎

---

## 5. Power-of-Two Characterization

**Theorem.** A positive integer `x` is a power of two **iff** `x & (x − 1) = 0`.

*Proof.* `x` is a power of two iff `popcount(x) = 1`. By §3, `x & (x−1)` clears the lowest set bit, leaving `popcount(x) − 1` set bits. If `popcount(x) = 1`, the result has 0 set bits, i.e. equals 0. Conversely if `x & (x−1) = 0` and `x ≠ 0`, then `popcount(x) − 1 = 0`, so `popcount(x) = 1` and `x` is a power of two. The guard `x > 0` is required because `x = 0` also satisfies `x & (x−1) = 0` (as `0 & (−1) = 0`) yet 0 is not a power of two. ∎

**Theorem (multiple of `2^k`).** `x ≡ 0 (mod 2^k)` iff `x & (2^k − 1) = 0`. *Proof.* The low `k` bits of `x` encode `x mod 2^k`; the mask `2^k − 1` extracts exactly those bits, which are all zero iff `2^k | x`. ∎

**Theorem (parity from the low bit).** `x mod 2 = x & 1 = b_0`. *Proof.* `x = Σ b_i 2^i`, and every term with `i ≥ 1` is even, so `x ≡ b_0 (mod 2)`. ∎ This generalizes: `x mod 2^k` is read directly off the low `k` bits with no division, which is why `&` masking replaces `%` for power-of-two moduli (and is faster, since hardware division is many cycles while AND is one).

**Theorem (sign as the top bit).** For a signed `W`-bit value, `x < 0 ⇔ b_{W-1} = 1 ⇔ (x >> (W−1)) & 1 = 1`. *Proof.* Two's complement assigns the top bit place value `−2^{W−1}`, dominating the sum of all lower positive contributions (`Σ_{i<W-1} 2^i = 2^{W-1} − 1 < 2^{W-1}`), so the value is negative exactly when that bit is set. ∎ This is why the arithmetic-shift `x >> (W−1)` produces an all-ones or all-zeros mask of the sign — the foundation of the branchless abs/min/max in §9.

This justifies the allocator idiom `align_up(x, a) = (x + a − 1) & ~(a − 1)` for power-of-two `a = 2^k`: `~(a−1)` clears the low `k` bits, rounding down to a multiple of `a`; adding `a − 1` first biases the rounding upward, giving the least multiple of `a` that is `≥ x`.

**Formal align-up correctness.** Let `a = 2^k` and `r = x mod a`. Then `align_up(x, a) = (x + a − 1) & ~(a−1)`. *Proof:* writing `x = qa + r` with `0 ≤ r < a`, we have `x + a − 1 = qa + r + a − 1`. If `r = 0` this is `qa + (a−1)`; masking off the low `k` bits gives `qa = x`. If `r > 0` it is `(q+1)a + (r − 1)`; masking gives `(q+1)a`, the least multiple `> x`. In both cases the result is `⌈x/a⌉·a`, the least multiple of `a` that is `≥ x`. ∎ The trick fails (silently rounds wrong) if `a` is not a power of two, because then `~(a−1)` is not a clean low-bit mask — hence the universal precondition `popcount(a) = 1`.

**Round down to a power of two.** `1 << (W − 1 − clz(x))` returns `2^{⌊log₂ x⌋}` for `x > 0`, the largest power of two `≤ x`. *Proof:* `W − 1 − clz(x)` is the index of `x`'s highest set bit `h`, and `2^h ≤ x < 2^{h+1}`, so `2^h` is the greatest power of two not exceeding `x`. ∎

---

## 6. Next Power of Two

**Theorem (bit-smearing).** For `1 ≤ x ≤ 2^{W-1}`, the smear-and-increment

```
x = x − 1
x |= x >> 1; x |= x >> 2; …; x |= x >> (W/2)
return x + 1
```

returns the least power of two `≥ x` (the original `x`).

*Proof.* Let `h = floor(log2(x − 1))` be the index of the highest set bit of `x − 1` (for `x ≥ 2`). The shift-OR cascade copies that highest bit downward to fill every lower position: after `|= x>>1` bits `h` and `h−1` are set; after `|= x>>2` bits `h..h−3` are set; doubling the reach each step, after `O(log W)` steps **all** bits from `0` to `h` are set, yielding `2^{h+1} − 1`. Adding 1 produces `2^{h+1}`. Because `h = floor(log2(x−1))`, we have `2^h ≤ x − 1 < 2^{h+1}`, hence `2^{h+1}` is the smallest power of two that is `≥ x`. (We use `x − 1` so that an input that is already a power of two maps to itself rather than the next one.) ∎

**Equivalent via clz.** `nextPow2(x) = 1 << (W − clz(x − 1))` for `x > 1`, since `W − clz(x−1) = h + 1`. The clz form is O(1) on hardware; the smear form is the portable fallback and the reason the cascade uses shifts `1, 2, 4, …` up to `W/2`.

---

## 6b. Integer Logarithm and Rounding Theorems

Two related quantities flow from the highest set bit, and both have exact integer characterizations worth stating precisely.

**`floor(log2 x)` for `x ≥ 1`.** This equals `bit_length(x) − 1 = W − 1 − clz(x)`, the index `h` of the highest set bit. *Proof:* `2^h ≤ x < 2^{h+1}` exactly characterizes `h = ⌊log₂ x⌋`, and the highest set bit of `x` is at index `h` precisely when `2^h ≤ x < 2^{h+1}`. ∎ There is **no** exact `log2` via floating point: `int(math.log2(x))` can be off by one near powers of two due to rounding (e.g. `log2(2^29)` may compute as `28.999…`), so the bit-length form is the only safe integer log.

**`ceil(log2 x)` for `x ≥ 1`.** This equals `(x−1).bit_length()` `= W − clz(x − 1)` for `x > 1`, and `0` for `x = 1`. *Proof:* `⌈log₂ x⌉` is the smallest `k` with `2^k ≥ x`; for `x > 1`, `x − 1` has highest set bit at index `⌈log₂ x⌉ − 1` when `x` is not a power of two, and the `(x−1)` adjustment handles the exact-power case so that `⌈log₂ 2^k⌉ = k`. ∎ This is exactly the exponent in `nextPow2`, tying §6 and §6b together: `nextPow2(x) = 2^{⌈log₂ x⌉}`.

**Bit-length parity and digit count.** The number of binary digits of `x ≥ 1` is `bit_length(x)`, and of decimal digits is `floor(log10 x) + 1`; converting between bases via `bit_length` and a fixed multiply (`digits10 ≈ bit_length * 1233 >> 12`) is a common fast estimate, correct after a single boundary correction. ∎

---

## 7. Parallel / SWAR Popcount Derivation

The parallel popcount computes the Hamming weight by **divide and conquer over bit fields**, doubling the field width each step. We derive and prove the 32-bit version; 64-bit is identical with wider masks.

**Step 0 — partial sums of adjacent pairs.** View the word as 16 two-bit fields. We want each field to hold the count (0,1,2) of set bits in that pair. The trick:

```
x = x − ((x >> 1) & 0x55555555)
```

*Why it is correct.* For a 2-bit field with bits `(b1, b0)`, the count is `b1 + b0`. Note `b1 + b0 = (b1·2 + b0) − b1 = field_value − b1`. Across the whole word, `(x >> 1) & 0x55555555` extracts the high bit `b1` of every pair into the low position, and subtracting it from `x` performs `field_value − b1` independently in each 2-bit lane with **no inter-lane borrow**, because the result of each lane is in `{0,1,2}`, which fits in 2 bits and never borrows from the neighbor. After this step, each 2-bit field holds the popcount of its original pair.

**Step 1 — sum adjacent 2-bit counts into 4-bit fields.**

```
x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
```

The mask `0x33...` keeps the even 2-bit lanes; shifting right by 2 and masking keeps the odd lanes aligned into the same positions. Adding them gives, in each 4-bit field, the sum of two counts each `≤ 2`, so `≤ 4`, which fits in 4 bits with no carry escaping the field. Masking *before* the add is essential here to keep lanes isolated.

**Step 2 — sum adjacent 4-bit counts into 8-bit (byte) fields.**

```
x = (x + (x >> 4)) & 0x0F0F0F0F
```

Each 4-bit count is `≤ 4`, so the sum of two is `≤ 8`, which fits in 4 bits; the per-byte total is `≤ 8 ≤ 15`, so masking *after* the add suffices (no field overflows into the next byte). After this, each byte holds the popcount of its original 8 bits (a value in `0..8`).

**Step 3 — horizontal sum of the four byte counts via multiply.**

```
return (x * 0x01010101) >> 24
```

Multiplying by `0x01010101 = 1 + 2^8 + 2^16 + 2^24` forms, in the top byte, the sum of all four byte-lanes: the product's bits `[24..31]` equal `byte0 + byte1 + byte2 + byte3` (each `≤ 8`, total `≤ 32`, fits in the byte with no overflow into bit 32). Shifting right by 24 reads that total. ∎

**Invariant proof sketch.** Inductively, after step `k` the word is partitioned into `2^k`-bit fields, each holding the exact popcount of the corresponding `2^k`-bit block of the original `x`. The base case (step 0) is proven above; each subsequent step merges two adjacent fields by addition, and the mask widths guarantee the merged count never overflows its field. After `log2 W` merge steps a single field holds `popcount(x)`. The final multiply is just a constant-time horizontal reduction of the byte lanes.

This is why SWAR popcount is **exactly** correct (not approximate) and **constant time**: a fixed number of mask/shift/add operations independent of the data.

**64-bit generalization.** The identical algorithm with 64-bit masks (`0x5555555555555555`, `0x3333333333333333`, `0x0F0F0F0F0F0F0F0F`) and a final `* 0x0101010101010101 >> 56` works because the per-byte popcount maxes at 8, the eight byte-lanes sum to at most 64, and 64 fits in the top byte (which holds values up to 255). The only change is the final shift amount (`56` to read the top of eight bytes instead of `24` for four), confirming the algorithm's correctness is parameterized cleanly by `W`: there are always `log2 W` merge stages and one horizontal-sum multiply.

**Why masking timing differs between stages.** Stages 0 and 1 mask the *inputs* (before adding) because two adjacent lanes could otherwise carry into each other; stage 2 masks the *output* (after adding) because at byte granularity the maximum sum (8) cannot overflow a byte, so the cheaper post-mask suffices. This per-stage choice is not stylistic — it is forced by the field-overflow analysis, and getting it wrong (masking after the add in stage 0) produces inter-lane contamination and a wrong count.

**The naive vs optimized first step.** A textbook first step would be `x = (x & m1) + ((x >> 1) & m1)` — mask both halves then add. The optimized `x − ((x >> 1) & m1)` saves one AND by exploiting the lane identity `b1 + b0 = (2b1 + b0) − b1`, valid precisely because each 2-bit lane's result stays in `{0,1,2}` and never borrows across the lane boundary. *Proof of equivalence:* per lane, `field − high_bit = (2b1 + b0) − b1 = b1 + b0`, the same as the masked-add form, and the subtraction is borrow-free since the minuend's low part `≥` the subtrahend within each lane. ∎ This is a microcosm of bit-trick engineering: a provably-equivalent rewrite that removes one operation from a hot path.

**Bulk popcount (Harley-Seal) correctness in one line.** A carry-save adder takes three input words `a, b, c` and produces `(carries, sum)` with `sum = a ^ b ^ c` and `carries = (a & b) | (a & c) | (b & c)`, satisfying `popcount(a)+popcount(b)+popcount(c) = popcount(sum) + 2·popcount(carries)`. Iterating this 3:2 compression reduces `k` words to `log` of `k` popcount calls, the basis of the fastest array popcounts; the identity follows directly from the full-adder identity applied bitwise across three operands. ∎

---

## 8. De Bruijn Sequences for O(1) CTZ

When no `TZCNT`/`BSF` instruction is available, a **de Bruijn sequence** computes ctz with one multiply, one shift, and one table lookup.

**Definition.** A binary de Bruijn sequence `B(2, k)` is a cyclic string of length `2^k` in which every length-`k` binary string appears exactly once as a (cyclic) substring. For `k = 5` (32-bit), one such constant is `0x077CB531`.

**Construction of the ctz table.** First isolate the lowest set bit: `v = x & −x = 2^s` where `s = ctz(x)`. Multiplying the de Bruijn constant `D` by `2^s` is a **left shift by s**, which slides a unique length-`k` window of `D` into the top `k` bits. Extracting those top `k` bits gives an index that uniquely identifies `s`:

```
index = (uint32)(v * D) >> (32 − k)        // top k bits after the shift
s     = table[index]                        // precomputed: maps each window to its shift
```

**Why it is a bijection.** Because `D` is a de Bruijn sequence, the `2^k` distinct cyclic windows of length `k` are all distinct; left-shifting `D` by `s` (for `s = 0..2^k − 1`) places a *different* window in the top `k` bits for each `s` (the sequence is chosen so the relevant windows after shifting are distinct). Hence the map `s ↦ index` is injective, and the table that inverts it recovers `s = ctz(x)` exactly. The table has `2^k = 32` entries for 32-bit and `64` for 64-bit, built once by computing the index for each `2^s`. The whole operation is O(1): one AND/negate, one multiply, one shift, one load. ∎

**Concrete 32-bit recipe.**

```
const D = 0x077CB531
table[(D * (1u << s)) >> 27] = s   for s in 0..31   // build once
ctz(x) = table[((x & -x) * D) >> 27]                // query, x != 0
```

De Bruijn ctz was the standard fast method before `TZCNT`/`LZCNT` hardware; it is still relevant for portability and for languages/targets without the builtin. The same idea (different constant, `>> 26`/`>> 58`) gives clz/`log2` once you smear the value down to `2^{floor(log2 x)+1} − 1` first.

**Why a de Bruijn sequence exists for every `k`.** The existence is a graph-theoretic theorem: build the **de Bruijn graph** whose nodes are all `2^{k-1}` strings of length `k−1` and whose edges (labeled by the appended bit) connect `a₁…a_{k-1} → a₂…a_{k-1}b`. Every node has in-degree 2 and out-degree 2, so the graph is **Eulerian**; an Eulerian circuit traverses every edge (= every length-`k` string) exactly once, and reading the edge labels around the circuit yields a de Bruijn sequence `B(2,k)`. *Existence proof:* a connected graph with equal in/out degree at every node has an Eulerian circuit (Euler's theorem), and the de Bruijn graph is connected and balanced. ∎ This guarantees a usable constant `D` exists for any width; `0x077CB531` is one valid choice for `k = 5`.

**Generating the constant.** In practice one searches for a 32-bit `D` whose successive shifts produce 32 distinct 5-bit top-windows (equivalently, a `B(2,5)` whose rotations give distinct prefixes). A short program tests candidates by building the table and checking for collisions; many constants work, and published ones like `0x077CB531` and `0x04D7651F` are used interchangeably.

---

## 9. Sign, Abs, and Sign Extension

**Branchless abs (signed `W`-bit).** Let `m = x >> (W−1)` be an *arithmetic* shift, so `m = −1` (all ones) if `x < 0`, else `m = 0`. Then

```
abs(x) = (x ^ m) − m.
```

*Proof.* If `x ≥ 0`, `m = 0`, and the expression is `x − 0 = x`. If `x < 0`, `m = −1`, so `x ^ m = ~x` and the expression is `~x − (−1) = ~x + 1 = −x` (by §2), which is `|x|` for `x ≠ INT_MIN`. The lone exception is `x = INT_MIN`, where `−x` overflows back to `INT_MIN`; this is the inherent two's-complement asymmetry, not a flaw in the formula. ∎

**Sign function.** `sgn(x) = (x >> (W−1)) | (−x >> (W−1))` yields `−1, 0, +1` (using unsigned/logical interpretation for the second shift), again exact except at `INT_MIN`.

**Sign extension** of a `b`-bit two's-complement value `v` stored in a wider word: `(v << (W − b)) >> (W − b)` using an **arithmetic** right shift replicates bit `b−1` into all higher positions, recovering the correctly-signed `W`-bit value. *Proof:* the left shift moves bit `b−1` to position `W−1` (the sign position); the arithmetic right shift then copies that sign bit down, which is precisely the definition of sign extension. ∎

**Branchless sign extension without arithmetic shift.** When only logical shifts are available, `m = 1 << (b − 1); result = (v ^ m) − m` sign-extends a `b`-bit value. *Proof:* `m` is the value's sign bit. If `v`'s top bit is 0, `v ^ m` sets it and `− m` clears it back, leaving `v`. If `v`'s top bit is 1, `v ^ m` clears it (giving `v − m`) and `− m` subtracts again, yielding `v − 2m`, which equals `v`'s value minus `2^b` — exactly the negative value `v` should represent. ∎ This is the portable form used when a language lacks a guaranteed arithmetic shift.

**Three-valued sign via subtraction of comparisons.** `sgn(x) = (x > 0) − (x < 0)` (each comparison yields 0/1) returns `−1, 0, +1` with no branch and no `INT_MIN` hazard, an often-cleaner alternative to the shift-based form. *Proof:* exactly one of the two comparisons is 1 for nonzero `x` (sign-appropriate), and both are 0 for `x = 0`. ∎

**Branchless min/max correctness.** Let `c = −(a < b)` be `0` (false) or all-ones (true). Then `min(a,b) = b ^ ((a ^ b) & c)`. *Proof:* if `a < b`, `c` is all-ones, so the expression is `b ^ (a ^ b) = a` (the smaller); if `a ≥ b`, `c` is 0, so the masked term vanishes and the expression is `b` (the smaller-or-equal). In both cases the minimum is selected. The maximum is the dual `a ^ ((a ^ b) & c)`. ∎ The XOR-select idiom `dst ^ ((dst ^ src) & mask)` — "conditionally copy `src` into `dst` where `mask` is set" — generalizes this and appears throughout branchless and constant-time code; its correctness is the same one-line XOR cancellation.

**Conditional negate.** `(x ^ c) − c` negates `x` when `c` is all-ones and leaves it when `c` is 0, the kernel of the branchless abs. *Proof:* identical to the abs proof with `c` playing the role of the sign mask `m`. ∎ This unifies abs, conditional negate, and the two's-complement negation `−x = (x ^ −1) − (−1) = ~x + 1` as one parameterized identity.

---

## 10. Worked Numeric Examples

It helps to see the proofs of §3, §4, and §7 instantiated on concrete values. Take `x = 0b10110100 = 180` in 8 bits (`ctz = 2`, `popcount = 4`).

**Clearing the lowest set bit (§3).**

```
x       = 1011 0100   (180)
x - 1   = 1011 0011   (179)   bit 2 → 0, bits below → 1 (borrow ripple)
x&(x-1) = 1011 0000   (176)   lowest set bit (pos 2) cleared; popcount 4 → 3
```

The high field `1011____` is identical in `x` and `x−1`, so it passes through the AND untouched, exactly as the proof's decomposition `x = p·2^{s+1} + 2^s` with `p = 0b1011`, `s = 2` predicts.

**Isolating the lowest set bit (§4).**

```
x       = 1011 0100   (180)
~x      = 0100 1011
~x + 1  = 0100 1100   = -x (mod 256) = 76
x & -x  = 0000 0100   (4) = 2^2 = 2^ctz(x)
```

Only bit 2 survives. Note the high regions `1011` of `x` and `0100` of `−x` are exact complements, so every position above bit 2 contributes `b ∧ ¬b = 0`.

**SWAR popcount step 0 on a full byte.** For one byte field `(b7…b0)`, the operation `x − ((x>>1) & 0x55)` computes, per 2-bit lane, `value − high_bit = b1+b0`:

```
lane 11 (3): 3 - 1 = 2   ✓ (two set bits)
lane 10 (2): 2 - 1 = 1   ✓
lane 01 (1): 1 - 0 = 1   ✓
lane 00 (0): 0 - 0 = 0   ✓
```

Each lane result lies in `{0,1,2}` ⊂ 2 bits, so no borrow crosses into the neighboring lane — the invariant the proof relies on.

**Next power of two (§6) for `x = 180`.** `x − 1 = 179`, highest set bit at `h = 7` (`128 ≤ 179 < 256`). Smearing fills bits `0..7` to `0xFF = 255`; `+1 = 256 = 2^8`, the least power of two `≥ 180`. ✓

**Popcount by Kernighan, fully traced (§3 consequence).** Starting from `180 = 0b10110100` (popcount 4):

```
iter 1: x = 0b10110100 & 0b10110011 = 0b10110000 (176), count 1
iter 2: x = 0b10110000 & 0b10101111 = 0b10100000 (160), count 2
iter 3: x = 0b10100000 & 0b10011111 = 0b10000000 (128), count 3
iter 4: x = 0b10000000 & 0b01111111 = 0b00000000 (0),   count 4
x = 0 → stop. popcount(180) = 4 ✓
```

Exactly four iterations for four set bits, as the termination proof guarantees.

**Sign extension (§9) of a 4-bit value `v = 0b1011`.** As a 4-bit two's-complement number this is `−5`. Sign-extending to 8 bits: `m = 1 << 3 = 0b1000`; `(v ^ m) − m = 0b0011 − 0b1000 = 3 − 8 = −5` ✓, stored as `0b11111011`. The arithmetic-shift form `(v << 4) >> 4` (8-bit) gives `0b10110000 >> 4 = 0b11111011 = −5` ✓ — both routes agree.

---

## 11. Modular Arithmetic of Shifts

Shifts are exact modular operations within the width, and the proofs of the multiply/divide tricks follow from this.

**Left shift = modular multiply.** For unsigned `W`-bit `x`, `x << k ≡ x · 2^k (mod 2^W)`. *Proof:* shifting the bit vector left by `k` maps `Σ b_i 2^i` to `Σ b_i 2^{i+k}`, and bits that reach index `≥ W` are dropped, which is exactly reduction mod `2^W`. ∎ Consequently `x << k` equals `x · 2^k` **only when no set bit is shifted past the top**, i.e. when `x < 2^{W−k}`; otherwise it wraps.

**Right shift = floor division (unsigned).** `x >> k = floor(x / 2^k)` for unsigned `x`. *Proof:* dropping the low `k` bits discards the residue `x mod 2^k`, leaving `(x − (x mod 2^k)) / 2^k = floor(x / 2^k)`. ∎

**Arithmetic right shift = floor division toward −∞ (signed).** For signed `x`, an arithmetic `x >> k` equals `floor(x / 2^k)` (rounding toward negative infinity), **not** truncation toward zero. *Proof:* sign-extension preserves the represented value while discarding low bits; for negative `x` this rounds down, e.g. `−8 >> 1 = −4` (`floor(−8/2) = −4`) but `−7 >> 1 = −4` while integer truncating division gives `−3`. This is why `x >> 1` and `x / 2` disagree for negative odd `x`. ∎

**Modular subtraction in `x − 1`.** When `x` is unsigned and `x = 0`, `x − 1 ≡ 2^W − 1` (all ones) mod `2^W`. This is why Kernighan's loop on `x = 0` does zero iterations (the `while x != 0` guard fires first) and never reaches the wrap.

---

## 12. Counting Identities and Their Proofs

Several popcount/Hamming identities used in practice deserve short proofs.

**Complement identity.** `popcount(x) + popcount(~x) = W`. *Proof:* each of the `W` bit positions is 1 in exactly one of `x`, `~x` (since `~x` flips every bit), so the two counts partition the `W` positions. ∎

**Hamming distance via XOR.** `d_H(a, b) = popcount(a ^ b)`. *Proof:* bit `i` of `a ^ b` is 1 iff `a_i ≠ b_i`, so the count of 1-bits equals the number of differing positions, which is the Hamming distance. ∎ This makes `a ^ b` plus a single `POPCNT` the entire kernel of binary nearest-neighbor search.

**Subtraction–popcount relation.** For `x ≠ 0`, `popcount(x − 1) = popcount(x) − 1 + ctz(x)`. *Proof:* `x − 1` clears bit `s = ctz(x)` (one fewer set bit) and sets the `s` bits below it (s more set bits), so `popcount(x−1) = popcount(x) − 1 + s`. ∎ This explains why `x & (x−1)` (which re-ANDs to remove those new low bits) lands at exactly `popcount(x) − 1`.

**Parity via XOR fold.** The parity of `popcount(x)` equals the XOR of all bits, computable by folding: `x ^= x>>16; x ^= x>>8; x ^= x>>4; x ^= x>>2; x ^= x>>1; parity = x & 1`. *Proof:* each fold XORs the two halves, and XOR is associative/commutative addition in `GF(2)`; after `log2 W` folds bit 0 holds the XOR of all original bits, which is `popcount(x) mod 2`. ∎

**Gray code adjacency.** The reflected binary Gray code `g(n) = n ^ (n >> 1)` satisfies `popcount(g(n) ^ g(n+1)) = 1`. *Proof sketch:* `g(n) ^ g(n+1) = (n ^ (n>>1)) ^ ((n+1) ^ ((n+1)>>1))`; expanding with the carry structure of `n → n+1` shows exactly one bit differs, the hallmark of Gray codes. ∎

---

## 12b. The Boolean Semiring and Bitset Operations

When an integer is used as a **set** of small elements (bit `i` present iff `i ∈ S`), the bitwise operations realize set algebra exactly:

| Set operation | Bit expression | Proof |
|---------------|----------------|-------|
| Union `A ∪ B` | `a \| b` | bit `i` set iff in `a` or `b`. |
| Intersection `A ∩ B` | `a & b` | bit `i` set iff in both. |
| Difference `A \ B` | `a & ~b` | in `a` and not in `b`. |
| Symmetric difference | `a ^ b` | in exactly one. |
| Complement (universe `U`) | `~a & U` | in `U`, not in `a`. |
| Cardinality `\|A\|` | `popcount(a)` | count of present elements. |
| Membership `i ∈ A` | `(a >> i) & 1` | extract bit `i`. |
| Is subset `A ⊆ B` | `(a & b) == a` | every bit of `a` is in `b`. |
| Add element `i` | `a \| (1 << i)` | set bit `i`. |
| Remove element `i` | `a & ~(1 << i)` | clear bit `i`. |

**Subset test proof.** `A ⊆ B ⇔ A ∩ B = A ⇔ (a & b) == a`. *Proof:* `A ⊆ B` means every element of `A` lies in `B`, i.e. `A ∩ B = A`; translating to bits, `a & b` keeps only `a`'s bits that are also in `b`, equal to `a` iff none were dropped. ∎ This `O(1)` subset test is the kernel of bitmask DP transitions (e.g. "is candidate set a subset of the available mask?").

**Why this matters for `O(N/W)` set algorithms.** Representing a set over a universe of size `N` as `⌈N/W⌉` words turns union/intersection/difference into per-word bitwise ops, giving `O(N/W)` whole-set operations — a constant-factor `W`-fold speedup over per-element loops. This is the foundation of `std::bitset`, Java `BitSet`, and the bitset acceleration of reachability (Boolean matrix multiply), Four-Russians tricks, and DNA/string matching with the Shift-Or algorithm.

---

## 13. Algebraic Structure of Bitwise Ops

The set `{0,1}^W` under bitwise operations is a **Boolean ring / Boolean algebra**:

- `(∨, ∧)` form a distributive lattice with bottom `0` and top `~0`; complement is `~`.
- `(⊕, ∧)` form a commutative ring `(Z/2Z)^W`: XOR is addition mod 2 (identity `0`, every element is its own inverse: `x ^ x = 0`), AND is multiplication (identity `~0`, idempotent). This is `GF(2)^W` as a ring.

Consequences used in practice:

- **XOR is its own inverse:** `a ^ b ^ b = a`. This is the basis of the "single number" trick (XOR all elements; pairs cancel, the unpaired one remains) and of XOR-linked lists.
- **XOR is associative and commutative**, so order of accumulation is irrelevant — safe to parallelize/reduce.
- **AND distributes over XOR**: `a & (b ^ c) = (a & b) ^ (a & c)`, the ring distributive law, which justifies many mask manipulations and carry-less multiplication (`GF(2)[x]`).
- **The XOR-swap** `a^=b; b^=a; a^=b` works because of self-inverse + commutativity, but **fails when the two operands are the same storage** (it zeroes it), since `x ^ x = 0`; hence it is correct as an *algebraic* identity on distinct variables but a footgun on aliased memory.

These structures explain *why* the tricks compose: they are theorems in a well-understood algebra, not ad hoc coincidences.

### A catalog of identities with one-line proofs

| Identity | Proof sketch |
|----------|--------------|
| `x ^ x = 0` | XOR is addition mod 2; every element is its own inverse. |
| `x & ~x = 0` | A bit and its complement are never both 1. |
| `x \| ~x = ~0` | A bit or its complement is always 1. |
| `x ^ ~x = ~0` | They differ in every position. |
| `x + y = (x ^ y) + 2(x & y)` | XOR is sum-without-carry; `x & y` is the carries, shifted left by 1. |
| `x \| y = (x ^ y) + (x & y)` | OR = XOR (disjoint bits) plus the shared bits. |
| `x − y = (x ^ ~y) + 2(~x & y) + ...` | borrow analog of the add identity. |
| `(x & (x−1)) == 0` for `x>0` ⇔ power of two | weight-1 vectors only. |
| `(x & −x) == x` ⇔ power of two or 0 | the isolate equals `x` iff one bit. |
| `popcount(x) == 1` ⇔ `x & (x−1) == 0 && x != 0` | clears the only bit. |
| `floor(log2 x) == W−1−clz(x)` | index of highest set bit. |
| `x % 2^k == x & (2^k − 1)` | low `k` bits are the residue. |

The full-adder identity `x + y = (x ^ y) + 2(x & y)` is especially load-bearing: it expresses addition as a sum-without-carry (`x ^ y`) plus the carry vector (`(x & y) << 1`), and iterating it (re-adding the carries) is exactly how a **ripple-carry adder** and the SWAR/CSA bulk popcounts work. *Proof:* in each column, `b ⊕ c` is the sum bit and `b ∧ c` is the carry into the next column; the equation just re-sums those two contributions. ∎

### Bit reversal as a butterfly permutation

The `O(log W)` bit-reversal algorithm swaps progressively larger adjacent groups:

```
x = ((x & 0x55555555) << 1) | ((x & 0xAAAAAAAA) >> 1);  // swap adjacent bits
x = ((x & 0x33333333) << 2) | ((x & 0xCCCCCCCC) >> 2);  // swap pairs
x = ((x & 0x0F0F0F0F) << 4) | ((x & 0xF0F0F0F0) >> 4);  // swap nibbles
x = ((x & 0x00FF00FF) << 8) | ((x & 0xFF00FF00) >> 8);  // swap bytes
x = (x << 16) | (x >> 16);                              // swap halves
```

**Correctness.** Reversing the bit order is the permutation `i ↦ (W−1−i)`, whose binary effect is to complement all `log2 W` index bits. Each stage of the cascade complements one index bit by swapping elements whose indices differ in that bit — a single level of a **butterfly (FFT) network**. After complementing all `log2 W` index bits, every element sits at its bit-reversed position. *Proof:* the index `i = (i_{m-1}…i_0)` in binary maps to `i' = (\bar{i_{m-1}}…\bar{i_0})` under reversal of a `2^m`-element block; stage `k` toggles index bit `k` for all elements, so after stages `0..m−1` every index bit is complemented, giving `i'`. ∎ This is the same structure that makes the FFT's bit-reversal-permutation step `O(W log W)` over an array of `W` words, and `O(log W)` for a single word here.

### Subset enumeration over a bitmask

A frequently-used corollary of the lowest-set-bit identities: the **submasks** of a mask `m` can be enumerated in `O(number of submasks)` with

```
sub = m
while sub > 0:
    process(sub)
    sub = (sub - 1) & m     # next lower submask
print(0)                     # the empty submask
```

**Correctness.** `(sub − 1) & m` produces the largest submask of `m` strictly smaller than `sub`. *Proof:* subtracting 1 from `sub` borrows through `sub`'s trailing zeros (turning the lowest set bit off and the bits below it on); ANDing with `m` restricts the result to `m`'s bits, yielding the next-smaller integer whose set bits are a subset of `m`. Iterating visits every submask exactly once in decreasing order, in total `2^{popcount(m)}` steps. ∎ This is the engine of subset-sum DP and the `sum over subsets` (SOS) transform; both rely directly on the borrow-ripple proof of §3.

### Carry-less multiplication and CRCs

In `GF(2)[x]`, multiplication is polynomial multiply **without carries** (XOR instead of add). Hardware exposes it as `PCLMULQDQ`. It underlies CRC checksums and `GF(2^k)` field arithmetic for AES-GCM. The relevant identity: ordinary integer multiply and carry-less multiply agree exactly on the *low* bit but diverge above it, because integer multiply propagates carries while `GF(2)` multiply does not. Recognizing when a "multiply" must be carry-less (CRC, Reed–Solomon, AES-GCM) versus carrying (the SWAR popcount horizontal sum) is a frequent source of subtle bugs.

---

## 14. Complexity Lower Bounds

How fast *can* these operations be, in principle?

**Popcount lower bound (circuit complexity).** Computing the Hamming weight of `W` bits requires a circuit of depth `Ω(log W)` over bounded-fan-in AND/OR/XOR gates, because the output's high bit depends on all `W` inputs and information must propagate through a tree of merges. The SWAR algorithm meets this bound: it uses exactly `log2 W` merge stages, so its depth is `Θ(log W)` — asymptotically optimal as a circuit. The hardware `POPCNT` is the same `Θ(log W)`-depth network realized in silicon, presented to software as a single instruction.

**CTZ/CLZ lower bound.** Finding the index of the lowest (or highest) set bit also needs `Ω(log W)` depth (the `log2 W`-bit answer depends on all inputs). The de Bruijn method (§8) achieves `O(1)` *instructions* by trading depth for a precomputed table — it is not a smaller circuit, but it amortizes the work into one multiply plus a memory lookup, which is constant time on a RAM machine.

**Word-RAM model.** All the O(1) claims in this topic are in the **word-RAM model**, where arithmetic, shifts, and logical ops on `W`-bit words cost one unit each. This is the standard model for analyzing these tricks; under it, popcount/clz/ctz/next-pow2 are all `O(1)`. Under a bit-complexity model (counting individual bit operations) they are `Θ(W)` or `Θ(log W)` as the circuit bounds above describe. Stating the model is essential: "popcount is O(1)" is true on the word-RAM and false in the bit model.

**Information-theoretic note.** Any method must read every input bit at least once in the worst case, since each bit can independently flip the answer; so popcount/ctz on arbitrary input is `Ω(W)` *work* in the bit model. The cleverness of SWAR and `POPCNT` is doing that `Θ(W)` work with `Θ(log W)` *depth* and a small constant number of word operations.

**Average-case Kernighan analysis.** For a uniformly random `W`-bit value, the expected popcount is `W/2`, so Kernighan's loop runs `W/2` iterations on average (16 for 32-bit) — *worse* than the fixed `log2 W` stages of SWAR. Kernighan only wins when `E[popcount]` is small, i.e. on **sparse** inputs (bitsets that are mostly empty). This is the quantitative justification for the qualitative advice "Kernighan for sparse, SWAR/builtin otherwise."

**Variance and constant-time concerns.** Because Kernighan's iteration count equals the data-dependent popcount, its running time *leaks* the popcount through a timing side-channel — disqualifying it for secret-dependent inputs (cryptographic key weight, for instance). SWAR and `POPCNT` run in fixed time regardless of input, so they are the correct choice when constant-time behavior is a security requirement, not merely a performance preference. The theoretical lesson: an algorithm whose step count is a function of the input value cannot be constant-time, no matter how fast its per-step work.

---

## 13c. Shift-Or String Matching (A Worked Theorem)

The Shift-Or (Baeza-Yates–Gonnet) algorithm finds a pattern of length `m ≤ W` in a text using one machine word as a sliding state, and its correctness is a pure bit-trick theorem.

Precompute, for each alphabet symbol `c`, a mask `B[c]` whose bit `j` is **0** iff `pattern[j] == c` (note the inversion). Maintain a state word `D` initialized to all 1s. For each text character `t`:

```
D = (D << 1) | B[t]
if (D & (1 << (m-1))) == 0:  report a match ending here
```

**Invariant and correctness.** After processing text position `i`, bit `j` of `D` is `0` iff `pattern[0..j]` matches `text[i-j..i]`. *Proof by induction:* the shift `D << 1` advances every partial match by one character (bit `j−1` carries into bit `j`), and the `| B[t]` keeps bit `j` at 0 only when the current text character equals `pattern[j]` (since `B[t]` has 0 there). The match-prefix property is therefore preserved; a full match is signalled when bit `m−1` reaches 0. ∎ The algorithm runs in `O(text length)` word operations for patterns up to `W` long — a direct payoff of treating the integer as a parallel array of match flags, and a clean demonstration that bit tricks scale from single-bit identities to full algorithms.

---

## 14b. Bit Interleaving (Morton Codes)

Interleaving the bits of two coordinates `x, y` into a single **Morton code** `z` (z-order curve) is a bit-spreading operation with a clean divide-and-conquer formula. The "spread" step inserts a zero between every bit:

```
x = (x | (x << 8)) & 0x00FF00FF
x = (x | (x << 4)) & 0x0F0F0F0F
x = (x | (x << 2)) & 0x33333333
x = (x | (x << 1)) & 0x55555555    // bits now at even positions
morton = x | (spread(y) << 1)      // y at odd positions
```

**Correctness.** Each stage doubles the gap between occupied bit positions: after stage `k` the bits originally at positions `0,1,…` occupy positions spaced `2^k` apart, and the mask after each `|` discards the stray copies, keeping exactly the spread layout. By the same divide-and-conquer invariant as SWAR (mask widths prevent collision), after `log2 W` stages each bit sits at twice its original index, leaving the odd slots free for `y`. *Proof:* induction on the stage — the invariant "input bit `i` occupies output bit `i · 2^{remaining}`" is preserved by each shift-OR-mask, terminating with bit `i` at `2i`. ∎ Morton codes give cache-friendly spatial locality and are the bit-trick foundation of quadtrees/octrees and GPU spatial hashing.

---

## 14c. Theorem Preconditions at a Glance

Every identity in this file is *exact* only under stated preconditions. The table collects the recurring ones so a reader can audit any usage quickly.

| Identity | Precondition | What breaks otherwise |
|----------|--------------|------------------------|
| `x & (x−1)` clears lowest bit | none (works for `x=0`, giving 0) | — |
| `x & −x` isolates lowest bit | `x ≠ 0` (else 0) | returns 0, no bit to isolate |
| power-of-two test | `x > 0` | `x = 0` falsely passes |
| `floor(log2 x)` via clz | `x > 0` | clz(0) undefined |
| ctz/clz builtins | `x ≠ 0` | UB / width on most ISAs |
| branchless abs | `x ≠ INT_MIN` | `−INT_MIN` overflows to itself |
| `−x = ~x + 1` | mod `2^W` | exact only within the width |
| `align_up(x,a)` | `a` is a power of two | `~(a−1)` not a clean mask |
| `1 << i` mask | `0 ≤ i < W` | shift `≥ W` is UB / masked |
| SWAR popcount masks | width matches mask length | high bits silently dropped |
| O(1) claims | word-RAM model | `Θ(W)`/`Θ(log W)` in bit model |

The two preconditions that recur most — `x ≠ 0` for the lowest-bit/log family and `x ≠ INT_MIN` for negation-based tricks — are worth memorizing, because the failures are silent (a wrong value, no crash). A proof that ignores them is incomplete, and code that ignores them is a latent bug.

---

## 15. Summary

Bit tricks are theorems with short, mechanical proofs once you fix the algebra. The keystone is the two's-complement identity `−x = ~x + 1`, from which both lowest-set-bit identities follow: `x & (x−1)` clears it (the subtraction borrows through the trailing zeros, so the AND wipes the lowest 1 and everything below) and `x & −x` isolates it (the negation's carry sets exactly bit `s` and clears the rest). Powers of two are exactly the weight-1 vectors, giving the `x & (x−1) == 0` test, and the smear-and-increment / clz formulas compute the next power of two with a proven bit-fill argument. The parallel/SWAR popcount is a divide-and-conquer Hamming-weight sum whose mask widths are chosen so no field ever overflows, making it exactly correct in constant time; its final multiply is a horizontal lane reduction. De Bruijn sequences turn ctz into a single multiply-shift-lookup by exploiting that all length-`k` windows are distinct, and they exist for every width because the de Bruijn graph is Eulerian.

Beyond the single-word identities, the same algebra scales up: the full-adder identity `x + y = (x ^ y) + 2(x & y)` exposes carry structure and powers ripple adders and CSA popcounts; the bitset interpretation makes union/intersection/difference `O(N/W)`; bit reversal and Morton interleaving are butterfly permutations proven by induction on `log W` stages; and Shift-Or matching turns a word into a parallel array of match flags. The whole toolkit lives in a Boolean ring `GF(2)^W` where XOR is self-inverse addition and AND is multiplication, which is why XOR cancellation, the single-number trick, subset enumeration, and mask distributivity all hold — and why XOR-swap on aliased storage is a genuine bug, not bad luck. Two invariants recur in every proof: state the **width** `W` (the model in which O(1) holds) and footnote `INT_MIN` (the lone input where negation overflows). Hold those two caveats and every identity in this file is exact.

The deeper takeaway is methodological. Each trick reduces to one of three proof techniques: (1) a **borrow/carry ripple** argument on `x ± 1` (used for clearing/isolating the lowest bit, submask enumeration, and the trailing-run identities); (2) a **divide-and-conquer field invariant** where mask widths are chosen so no lane overflows (SWAR popcount, bit reversal, Morton interleave, the butterfly permutations); or (3) a **`GF(2)`/Boolean-algebra** identity exploiting XOR self-inverse and AND-over-XOR distributivity (single-number, XOR-select, Shift-Or, CRCs). Recognizing which of the three a given trick belongs to tells you immediately how to prove it correct and which precondition to check. That classification — not memorizing the bit patterns — is what makes the foundational toolkit reliable in production and re-derivable under interview pressure.

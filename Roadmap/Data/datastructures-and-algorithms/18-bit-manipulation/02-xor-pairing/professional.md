# XOR Pairing & XOR Identities — Mathematical Foundations

## Table of Contents
1. Formal Definitions
2. XOR as the Additive Group of GF(2)^n
3. Proofs of the Core Identities
4. Why XOR-All Isolates the Single Element
5. Correctness of the Two-Singles Split
6. The Mod-k Generalization (Counting Bits mod k)
7. The Range-XOR [0..n] Period-4 Closed Form
8. Gray Code: The Reflection Property and Bijection
9. Linearity, Prefix XOR, and Subarray Queries
9b. Linear-Codes Perspective: Parity and Erasure
10. Limits: What XOR Cannot Decide
11. Summary

---

## 1. Formal Definitions

We work with fixed-width nonnegative integers as bit-vectors. Fix a width `n` (e.g. 32 or 64).

**Definition 1.1 (Bit-vector space).** Let `GF(2) = ({0, 1}, ⊕, ·)` be the two-element field, where `⊕` is addition modulo 2 (XOR on single bits) and `·` is multiplication modulo 2 (AND on single bits). Let `V = GF(2)^n` be the `n`-dimensional vector space over `GF(2)`. An `n`-bit integer `x` is identified with its coordinate vector `(x_{n-1}, …, x_1, x_0) ∈ V`, where `x_b` is bit `b` of `x`.

**Definition 1.2 (XOR).** For `a, b ∈ V`, the exclusive-or `a ^ b` is the componentwise sum in `GF(2)`:

```
(a ^ b)_b = a_b ⊕ b_b  =  a_b + b_b (mod 2),    for each bit position b.
```

Equivalently, `(a ^ b)_b = 1` iff `a_b ≠ b_b`. This is precisely vector addition in `V`, so throughout we use `^` and the vector-space `+` interchangeably.

**Definition 1.3 (Identity and inverse).** Write `0` for the all-zeros vector. We will prove `0` is the additive identity and that every `x` is its own additive inverse.

**Definition 1.4 (Hamming weight and parity).** The Hamming weight `wt(x)` is the number of `1` bits in `x`. The parity of a multiset `S = {s_1, …, s_m}` at bit `b` is `(Σ_i (s_i)_b) mod 2`.

**Notation.** `⊕_{i} x_i` denotes the XOR-fold `x_1 ^ x_2 ^ … ^ x_m` (the empty fold is `0`). `[P]` is the Iverson bracket (`1` if `P` holds, else `0`). `x & y` is bitwise AND, `x | y` bitwise OR, `~x` bitwise NOT, `x << k` / `x >> k` logical shifts. We freely move between the "integer" and "vector in `GF(2)^n`" pictures; they are the same object.

**Remark.** Every theorem below is, at bottom, a statement about the vector space `GF(2)^n`. The reason XOR tricks never have surprising exceptions is that they are theorems of linear algebra over a field, not heuristics.

**Reader's map.** Sections 2–3 establish the algebra (group + vector space + the application-level identities). Sections 4–5 prove the two flagship array results (single number, two-singles split). Section 6 generalizes to mod-`k`. Sections 7–8 are the closed-form and Gray-code theorems. Section 9 and 9b connect to prefix/Fenwick queries and to linear-coding (RAID parity). Section 10 delineates the hard limits. Every result reduces to two facts — `x ^ x = 0` and `x ^ 0 = x` — replicated bitwise and lifted by linearity; the rest is bookkeeping.

---

## 2. XOR as the Additive Group of GF(2)^n

**Theorem 2.1.** `(V, ^)` is an abelian group with identity `0`, in which every element is its own inverse.

**Proof.** We verify the group axioms, working bit by bit and using that `(GF(2), +)` is the cyclic group `Z/2`.

*Closure.* `a ^ b ∈ V` since each component `a_b ⊕ b_b ∈ {0,1}`.

*Associativity.* For each bit, `(a_b ⊕ b_b) ⊕ c_b = a_b ⊕ (b_b ⊕ c_b)` because addition mod 2 is associative. Componentwise associativity gives `(a ^ b) ^ c = a ^ (b ^ c)`.

*Identity.* `(x ^ 0)_b = x_b ⊕ 0 = x_b`, so `x ^ 0 = x`.

*Inverse.* `(x ^ x)_b = x_b ⊕ x_b = 0` (since `0⊕0 = 1⊕1 = 0`), so `x ^ x = 0`. Thus each `x` is its own inverse: `−x = x`.

*Commutativity.* `(a ^ b)_b = a_b ⊕ b_b = b_b ⊕ a_b = (b ^ a)_b`, so `a ^ b = b ^ a`. ∎

**Corollary 2.2 (Elementary abelian 2-group).** `(V, ^)` is isomorphic to `(Z/2)^n`, the direct product of `n` copies of `Z/2`. Every non-identity element has order 2 (`x ^ x = 0` for all `x ≠ 0` and `x = 0`). Such a group is called an **elementary abelian 2-group**.

**Theorem 2.3 (Vector-space structure).** `V = GF(2)^n` is an `n`-dimensional vector space over `GF(2)`, with addition `^` and the only two scalars `0, 1` acting by `0 · x = 0`, `1 · x = x`. The standard basis is `{e_0, …, e_{n-1}}` where `e_b = 1 << b`.

**Proof.** The vector-space axioms reduce to the group axioms of Theorem 2.1 (for addition) plus the trivial scalar action over the two-element field. Any `x` is uniquely `x = ⊕_b x_b · e_b`, exhibiting `{e_b}` as a basis of size `n`, so `dim V = n`. ∎

**Consequence.** XOR is a *linear* operation: the maps `x ↦ a ^ x` (translation) and, more importantly, XOR-folding are linear over `GF(2)`. This single fact (linearity) is the engine behind every application in this topic — and, as Section 10 and `senior.md` stress, the source of XOR's weakness as an integrity primitive.

### 2.1 The Cayley Table for 2-Bit Values

To make the group concrete, here is the full XOR operation table on `GF(2)^2 = {0,1,2,3}` (binary `00,01,10,11`):

```
^ | 0 1 2 3
--+--------
0 | 0 1 2 3      (row 0 = identity: x ^ 0 = x)
1 | 1 0 3 2
2 | 2 3 0 1
3 | 3 2 1 0      (diagonal all 0: x ^ x = 0, self-inverse)
```

Three group facts are visible at a glance: the table is **symmetric** (commutativity), the `0`-row/column reproduces the header (identity), and the **diagonal is all zeros** (every element is its own inverse). This is the Klein four-group `V₄ ≅ (Z/2)²`, the smallest non-cyclic group — and exactly the structure Corollary 2.2 names for general `n`. Every XOR identity used in the applications is "just" reading this table (replicated bitwise across `n` columns): pair-cancellation is the zero diagonal, order-independence is the symmetry, and the survival of unpaired elements is the identity row.

---

## 3. Proofs of the Core Identities

The four "junior" identities are now corollaries of Theorem 2.1, but we record the application-level identities explicitly.

**Proposition 3.1 (Self-inverse / involution).** For all `x, y`: `x ^ y ^ y = x`.

**Proof.** By associativity and `y ^ y = 0` (Theorem 2.1): `x ^ y ^ y = x ^ (y ^ y) = x ^ 0 = x`. ∎

**Proposition 3.2 (Cancellation in a fold).** Let `S` be a multiset. Then `⊕_{s ∈ S} s` depends only on the **parity** of each element's multiplicity:

```
⊕_{s ∈ S} s  =  ⊕_{v : mult_S(v) is odd} v,
```

where `mult_S(v)` is the number of times `v` appears in `S`.

**Proof.** Group the fold by distinct value `v` (legal by commutativity and associativity). The contribution of `v` is `v` XORed `mult_S(v)` times. By `v ^ v = 0`, an even number of copies XOR to `0` and an odd number XOR to `v` (induction: `2m` copies give `0`, `2m+1` give `v`). Folding the surviving odd-multiplicity values gives the claim. ∎

**Proposition 3.3 (Bitwise/parity formula).** For any multiset `S`, bit `b` of `⊕_{s∈S} s` equals `(Σ_{s∈S} s_b) mod 2`.

**Proof.** XOR is componentwise addition mod 2 (Definition 1.2), and the fold of bit `b` over `S` is `Σ_{s} s_b (mod 2)`. ∎

**Proposition 3.4 (Toggle).** `x ^ (1 << b)` flips exactly bit `b` of `x` and leaves all others fixed.

**Proof.** `(1 << b)` is the basis vector `e_b` (Theorem 2.3). Adding `e_b` changes coordinate `b` by `⊕ 1` (a flip) and every other coordinate by `⊕ 0` (unchanged). ∎

These elementary results are the formal backing for "pairs cancel, the odd one survives," "XOR is order- and grouping-independent," and "XOR with a one-hot mask toggles a bit."

**Proposition 3.5 (No-temp swap).** The sequence `a ← a ^ b; b ← b ^ a; a ← a ^ b` swaps the values of `a` and `b`, provided they are distinct storage locations.

**Proof.** Let `a₀, b₀` be the initial values. After line 1, `a = a₀ ^ b₀`, `b = b₀`. After line 2, `b = b₀ ^ (a₀ ^ b₀) = a₀` (by associativity and `b₀ ^ b₀ = 0`). After line 3, `a = (a₀ ^ b₀) ^ a₀ = b₀` (commutativity and `a₀ ^ a₀ = 0`). So `(a, b) = (b₀, a₀)`. The distinct-location hypothesis is essential: if `a` and `b` alias the same cell, line 1 sets it to `x ^ x = 0`, destroying the value. ∎

**Corollary 3.6 (Reversible add/remove).** XORing a value in and later XORing the same value out restores the prior state: `(acc ^ v) ^ v = acc` (Proposition 3.1). This is the algebraic basis for RAID parity updates (`P ^= old ^ new`) and sliding-window XOR signatures, both detailed in `senior.md`.

---

## 4. Why XOR-All Isolates the Single Element

**Setup.** Let `S` be a multiset of `n`-bit integers in which exactly one value `u` has odd multiplicity and every other value has even multiplicity.

**Theorem 4.1.** `⊕_{s ∈ S} s = u`.

**Proof.** By Proposition 3.2, the fold equals the XOR of the values with odd multiplicity. By hypothesis the only such value is `u`. Hence the fold is `u`. ∎

**Corollary 4.2 (Single-once, others-twice).** If every value but `u` appears exactly twice and `u` appears once, then `⊕ S = u`. (Twice is even; once is odd — Theorem 4.1 applies.)

**Remark on necessity.** The hypothesis is tight: XOR-all returns the XOR of *all* odd-multiplicity values. If two values have odd multiplicity, it returns their XOR (Section 5), not either one; if none do, it returns `0`. Thus XOR-all alone cannot tell "the single value is `0`" from "there is no single value" — both yield `0`. This indistinguishability is a parity phenomenon, not a bug, and is why the precondition must be guaranteed externally.

**Algebraic restatement.** Folding is the linear functional `Σ: V^m → V`, `Σ(s_1, …, s_m) = ⊕ s_i`. Theorem 4.1 says that on inputs whose multiplicity vector is "all even but one," `Σ` evaluates to the odd survivor. Linearity makes the evaluation order-free, which is exactly why a single streaming pass (any order) computes it.

### 4.1 Worked Verification

Take `S = {4, 1, 2, 1, 2}` (the running junior example), values in 3 bits. Multiplicities: `mult(1) = 2`, `mult(2) = 2`, `mult(4) = 1`. Only `4` has odd multiplicity, so Theorem 4.1 predicts `⊕ S = 4`. Verify column by column (Proposition 3.3):

```
        b2 b1 b0
4   =    1  0  0
1   =    0  0  1
2   =    0  1  0
1   =    0  0  1
2   =    0  1  0
       ----------
Σ mod 2: 1  0  0   ->  100 = 4
```

Bit `b2` has a single `1` (from `4`): odd → survives. Bits `b1` and `b0` each have two `1`s: even → cancel. The fold is `100 = 4`, confirming Theorem 4.1 at the bit level. Note the result is independent of the array order — any permutation gives the same column sums.

---

## 5. Correctness of the Two-Singles Split

**Setup.** Let `S` contain exactly two distinct values `a ≠ b` with odd multiplicity (typically once each) and all other values with even multiplicity.

**Step 1 (the combined XOR).** By Theorem 4.1 generalized to two odd survivors (Proposition 3.2): `X := ⊕ S = a ^ b`. Since `a ≠ b`, `X ≠ 0` (Theorem 2.1: `a ^ b = 0 ⟺ a = b`). Hence `X` has at least one set bit.

**Step 2 (a differing bit).** Let `m = X & (-X)`, the lowest set bit of `X`.

**Lemma 5.1.** `m` selects a single bit position `β` where `a_β ≠ b_β`.

**Proof.** In two's complement, `-X = (~X) + 1`, and the standard identity `X & (-X)` isolates the lowest set bit of `X` (all higher bits cleared, exactly one bit remaining). That bit position `β` is set in `X = a ^ b`, and a bit of `a ^ b` is `1` iff `a` and `b` differ there (Definition 1.2). So `a_β ≠ b_β`. ∎

**Step 3 (partition).** Define two sub-multisets by the value of bit `β`:

```
S_1 = { s ∈ S : s_β = 1 },    S_0 = { s ∈ S : s_β = 0 }.
```

**Lemma 5.2.** `a` and `b` lie in different parts; every even-multiplicity value contributes evenly to whichever single part it falls in.

**Proof.** Since `a_β ≠ b_β`, exactly one of `a, b` has bit `β` set, so they go to different parts. Any other value `v` has a fixed bit `v_β`, so *all* copies of `v` go to the same part; an even multiplicity stays even within that part. ∎

**Theorem 5.3 (Split correctness).** `⊕ S_1` and `⊕ S_0` are exactly `a` and `b` (in some order).

**Proof.** Consider `S_1`. It contains exactly one odd-multiplicity value among `{a, b}` (by Lemma 5.2, whichever has `s_β = 1`), and all its other values have even multiplicity (Lemma 5.2). By Theorem 4.1, `⊕ S_1` is that one odd survivor. Symmetrically `⊕ S_0` is the other. Together they are `a` and `b`. ∎

**Why the lowest set bit is a valid (and convenient) choice.** Any set bit of `X` works (each marks a position where `a, b` differ); the lowest set bit is chosen only because `X & (-X)` computes it branch-free in one instruction. The proof above used only that `β` is *some* position with `a_β ≠ b_β`.

**Generalization remark.** This extends to "split unknowns by a known distinguishing coordinate." With three or more odd survivors, a single bit cannot guarantee separation (some pair may agree on every individually chosen bit), which is why the clean two-pointer split stops at two and larger cases need the XOR-basis machinery of sibling `06-binary-trie-xor-basis`.

### 5.1 Worked Verification of the Split

Take `S = {1, 2, 1, 3, 2, 5}`, values in 3 bits. The odd-multiplicity values are `3` and `5` (each once); `1` and `2` each appear twice. Step 1: `X = ⊕ S = 3 ^ 5 = 011 ^ 101 = 110 = 6`. Step 2: `m = X & (-X) = 6 & (-6)`. In 8-bit two's complement, `6 = 00000110`, `-6 = 11111010`, so `6 & (-6) = 00000010 = 2`, i.e. bit `β = 1`. Indeed `3 = 011` and `5 = 101` differ at bit `1` (`3` has it set, `5` does not). Step 3: partition on bit `1`:

```
bit1 set (S_1):  1 (001? no, bit1=0)   ... let us check each:
  1 = 001 -> bit1 = 0 -> S_0
  2 = 010 -> bit1 = 1 -> S_1
  1 = 001 -> bit1 = 0 -> S_0
  3 = 011 -> bit1 = 1 -> S_1
  2 = 010 -> bit1 = 1 -> S_1
  5 = 101 -> bit1 = 0 -> S_0
S_1 = {2, 3, 2},  ⊕ S_1 = 2^3^2 = 3
S_0 = {1, 1, 5},  ⊕ S_0 = 1^1^5 = 5
```

The two singles `3` and `5` landed in different parts (Lemma 5.2), the paired `2`s both went to `S_1` and cancelled there, the paired `1`s both went to `S_0` and cancelled there, and each part folded to exactly one single (Theorem 5.3). This is the split-by-set-bit technique verified end to end.

---

## 6. The Mod-k Generalization (Counting Bits mod k)

XOR-all isolates a value when others appear an **even** number of times — i.e., it is "counting bits mod 2." The natural generalization handles "others appear `k` times" by counting each bit position's occurrences **mod k**.

**Setup.** Let `S` be a multiset where one value `u` appears `r` times with `r mod k ≠ 0`, and every other value appears a multiple of `k` times. We recover `u` by computing, per bit position, the column sum mod `k`.

**Theorem 6.1 (Mod-k recovery, general form).** For each bit position `b`, let `c_b = (Σ_{s∈S} s_b) mod k`. Then `c_b = (r · u_b) mod k`. If additionally `r ≡ 1 (mod k)` (the canonical "appears once" case), then `c_b = u_b`, so `u = Σ_b c_b · 2^b`.

**Proof.** Each value `v ≠ u` appears a multiple of `k` times, contributing `0 (mod k)` to every column sum. The value `u` contributes `r · u_b` to column `b`. Reducing mod `k` gives `c_b = (r · u_b) mod k`. When `r ≡ 1 (mod k)`, `c_b = u_b`. ∎

**Corollary 6.1b (Even `r` caveat).** Theorem 6.1 requires `r ≢ 0 (mod k)` for the single to be detectable at all, and gives a *clean* read (`c_b = u_b`) only when `r ≡ 1 (mod k)`. If the single appears, say, twice while others appear three times (`r = 2, k = 3`), then `c_b = 2·u_b mod 3`, which equals `u_b` for `u_b = 0` but `2` for `u_b = 1` — not a clean bit. One must then either know `r` and divide out (`u_b = c_b · r^{-1} mod k` when `gcd(r,k)=1`) or arrange `r ≡ 1`. The canonical problems always set `r = 1`, sidestepping this.

**The two-accumulator realization for `k = 3`.** Storing 32 separate mod-3 counters is wasteful. The classic implementation uses two bitmasks `ones` and `twos` encoding a per-bit base-3 state: a bit's pair `(twos_b, ones_b)` runs through `(0,0) → (0,1) → (1,0) → (0,0)` as that bit is seen `0,1,2,3` times. The update is:

```
ones = (ones ^ x) & ~twos
twos = (twos ^ x) & ~ones    # uses the just-updated ones
```

**Theorem 6.2 (Correctness of the two-accumulator machine).** After processing `S`, for each bit `b` the pair `(twos_b, ones_b)` equals the binary encoding of `(count_b mod 3)` where `count_b = Σ_s s_b`. In particular, when every value but `u` appears 3 times and `u` once, `ones = u`.

**Proof (per-bit state machine).** Fix a bit `b`; the updates act independently per bit, so analyze a single bit with current state `(t, o) = (twos_b, ones_b)` and incoming bit `xb = x_b`. The valid states encode counts mod 3 as `(0,0)=0, (0,1)=1, (1,0)=2`. Tabulate the update `o' = (o ⊕ xb) ∧ ¬t`, then `t' = (t ⊕ xb) ∧ ¬o'`:

```
state (t,o)=count  xb=0 -> (t,o)        xb=1 -> (t',o')
(0,0)=0            (0,0)=0              o'=(0⊕1)∧¬0=1, t'=(0⊕1)∧¬1=0  -> (0,1)=1
(0,1)=1            (0,1)=1              o'=(1⊕1)∧¬0=0, t'=(0⊕1)∧¬0=1  -> (1,0)=2
(1,0)=2            (1,0)=2              o'=(0⊕1)∧¬1=0, t'=(1⊕1)∧¬0=0  -> (0,0)=0
```

With `xb=0` the state is unchanged (count mod 3 unchanged); with `xb=1` the state advances `0→1→2→0`, i.e. increments count mod 3. By induction over the stream, `(t, o)` always encodes `count_b mod 3`. After all elements, values appearing 3× have returned their bits to `(0,0)`; `u`'s bits sit at count `1`, encoded as `o=1`. Hence `ones = u`. ∎

**Remark (general `k`).** For arbitrary `k` one needs `⌈log2 k⌉` bitmask accumulators encoding a per-bit mod-`k` counter, with update logic that increments and wraps at `k`. The `k=3` two-mask form is the famous special case; `k=2` collapses to plain XOR-all (one accumulator). This is the precise sense in which XOR-all is the `k=2` instance of a uniform "bits mod k" family.

### 6.1 Worked Trace of the Two-Accumulator Machine

Run `S = {2, 2, 3, 2}` (each value but `3` appears 3 times; `3` once). Values in 2 bits: `2 = 10`, `3 = 11`. Track `(twos, ones)` as integers:

```
start:           ones=00, twos=00
x=2 (10): ones=(00^10)&~00 = 10; twos=(00^10)&~10 = 00   -> (twos,ones)=(00,10)
x=2 (10): ones=(10^10)&~00 = 00; twos=(00^10)&~00 = 10   -> (10,00)
x=3 (11): ones=(00^11)&~10 = 01; twos=(10^11)&~01 = 00   -> wait recompute per bit
```

Per bit is cleaner. Bit 0: seen in `3` only → count `1` → final `ones` bit0 = `1`. Bit 1: seen in `2,2,3,2` → count `4`? No — count of bit1 set: `2` has bit1=1 (×3 times) and `3` has bit1=1 (×1), total `4`; `4 mod 3 = 1` → final `ones` bit1 = `1`?? That would give `ones = 11 = 3`, but let us recount: the values are `{2,2,3,2}`, so `2` appears **three** times and `3` once. Bit1 is set in `2` (3 times) and in `3` (once) = `4` sightings, `4 mod 3 = 1`. Bit0 is set only in `3` (once) = `1`, `1 mod 3 = 1`. So `ones = 11 = 3`. Correct — the single is `3`. The apparent surprise (bit1 also surviving) is right: `3`'s bit1 *is* set, and the three `2`s contribute `3 ≡ 0 (mod 3)` to bit1, leaving `3`'s lone contribution. Theorem 6.2 holds: each bit's mod-3 count equals the single value's bit.

### 6.2 Why Two Masks Suffice (Information-Theoretic Note)

A mod-3 counter has 3 states, needing `⌈log2 3⌉ = 2` bits — hence exactly two bitmask accumulators, `ones` and `twos`, packing one such 2-bit counter per data-bit position into machine words. The fourth encodable state `(t,o) = (1,1)` is *never reached* by the update (the `& ~twos` / `& ~ones` guards forbid both bits being set simultaneously), so the machine stays within the 3 valid states. This is why the deceptively short two-line update is a complete mod-3 counter: it is a hand-minimized 3-state automaton replicated bitwise across the word, the `k=3` member of the general "`⌈log2 k⌉` masks" family.

---

## 7. The Range-XOR [0..n] Period-4 Closed Form

**Theorem 7.1.** Define `f(n) = ⊕_{i=0}^{n} i`. Then

```
f(n) = n      if n ≡ 0 (mod 4)
f(n) = 1      if n ≡ 1 (mod 4)
f(n) = n + 1  if n ≡ 2 (mod 4)
f(n) = 0      if n ≡ 3 (mod 4).
```

**Proof.** The key observation is that any four consecutive integers starting at a multiple of 4 XOR to `0`. Let `m ≥ 0` and consider the block `B_m = {4m, 4m+1, 4m+2, 4m+3}`. Each element shares the high bits `4m` (bits ≥ 2 are constant across the block) and ranges over all four patterns `00, 01, 10, 11` in its low two bits. XORing the four:

- High bits (positions ≥ 2): each is constant across 4 elements; XORed an even (4) number of times → `0` (Proposition 3.2).
- Low two bits: the four low patterns `00,01,10,11` XOR to `00` (`00⊕01⊕10⊕11 = 00`).

So `⊕ B_m = 0` for every `m`. Now write `n = 4q + r` with `r ∈ {0,1,2,3}`. The integers `0..n` decompose into `q` complete aligned blocks `B_0, …, B_{q-1}` (which XOR to `0`) plus the tail `T = {4q, …, 4q+r}`:

```
f(n) = ( ⊕_{m<q} ⊕ B_m ) ^ ( ⊕ T ) = 0 ^ ⊕ T = ⊕ T.
```

Evaluate the tail by `r`. Let `N = 4q` (a multiple of 4, so `N`'s low two bits are `00` and `N ≡ 0 (mod 4)`):

- `r = 0`: `T = {N}`, `⊕T = N = n`.
- `r = 1`: `T = {N, N+1}`. Since `N` ends in `00` and `N+1` ends in `01`, and they agree on all higher bits, `N ^ (N+1) = 01 = 1`. So `f(n) = 1`.
- `r = 2`: `T = {N, N+1, N+2}`. `N ^ (N+1) = 1` (above), then `^ (N+2)`. Note `N+2 = n` here (since `n = N+2`), and `1 ^ n`: `n` ends in `10`, low two bits `10`; `1 = 01`; `01 ⊕ 10 = 11`, and higher bits of `n` unchanged, giving `n + 1` (setting the low bit). So `f(n) = n + 1`.
- `r = 3`: `T = {N, N+1, N+2, N+3} = B_q`, a complete aligned block, so `⊕T = 0`. Hence `f(n) = 0`.

This matches the four cases. ∎

**Corollary 7.2 (Arbitrary range).** For `0 ≤ a ≤ b`, `⊕_{i=a}^{b} i = f(b) ^ f(a-1)`, with the convention `f(-1) = 0` (empty fold).

**Proof.** `f(b) = (⊕_{i=0}^{a-1} i) ^ (⊕_{i=a}^{b} i) = f(a-1) ^ (⊕_{i=a}^{b} i)`. XOR both sides by `f(a-1)` and use self-inverse (Proposition 3.1) to cancel it on the left, isolating the range fold. ∎

**Remark.** The period-4 structure is exactly the statement that the map `i ↦ i` restricted to its low two bits cycles with period 4 and that aligned 4-blocks form cosets summing to `0` — a coset-cancellation argument in `GF(2)^n`.

### 7.1 Worked Verification of the Four Cases

Tabulate `f(n) = ⊕_{i=0}^{n} i` for `n = 0..9` directly and against the formula:

```
n   ⊕0..n (direct)        n%4  formula            match
0   0                     0    n     = 0           ✓
1   0^1 = 1               1    1     = 1           ✓
2   1^2 = 3               2    n+1   = 3           ✓
3   3^3 = 0               3    0     = 0           ✓
4   0^4 = 4               0    n     = 4           ✓
5   4^5 = 1               1    1     = 1           ✓
6   1^6 = 7               2    n+1   = 7           ✓
7   7^7 = 0               3    0     = 0           ✓
8   0^8 = 8               0    n     = 8           ✓
9   8^9 = 1               1    1     = 1           ✓
```

Every row agrees with Theorem 7.1, and the period-4 pattern `(n, 1, n+1, 0)` is plainly visible: after each `n ≡ 3` the running fold resets to `0` (the aligned block `{4m,…,4m+3}` just completed). For an arbitrary range, e.g. `⊕_{i=3}^{9} i = f(9) ^ f(2) = 1 ^ 3 = 2`; direct computation `3^4^5^6^7^8^9 = 2` confirms Corollary 7.2.

### 7.2 The Coset View, Made Explicit

The aligned blocks `B_m = {4m, 4m+1, 4m+2, 4m+3}` are the **cosets** of the subgroup `H = {0,1,2,3}` (the low-two-bit subspace) in `(GF(2)^n, ^)`: `B_m = (4m) ^ H`. The XOR of an entire coset is `⊕ (4m ^ h) = (4 \text{ copies of } 4m) ^ (⊕_{h∈H} h) = 0 ^ 0 = 0`, since `4m` appears `|H| = 4` times (even → cancels) and `H` itself XOR-sums to `0` (it is closed and every nonzero element is self-paired). Theorem 7.1 is therefore the statement "complete cosets vanish; only the partial trailing coset survives," a clean group-theoretic reading of the period-4 closed form.

---

## 8. Gray Code: The Reflection Property and Bijection

**Definition 8.1 (Reflected binary Gray code).** For an `m`-bit value, `g(x) = x ^ (x >> 1)`.

**Theorem 8.2 (Single-bit adjacency).** For consecutive integers, `g(x) ^ g(x+1)` has Hamming weight exactly `1`; i.e., `g(x)` and `g(x+1)` differ in exactly one bit.

**Proof.** Let `t` be the position of the lowest `0` bit of `x` (equivalently the lowest set bit of `x+1` after the carry settles); incrementing `x` flips bits `0..t` (turning the trailing `1`s to `0` and the `0` at `t` to `1`). Write the change `x ^ (x+1) = (1 << (t+1)) - 1`, a mask of the low `t+1` bits. Now

```
g(x) ^ g(x+1) = (x ^ (x>>1)) ^ ((x+1) ^ ((x+1)>>1))
             = (x ^ (x+1)) ^ ((x ^ (x+1)) >> 1).
```

Let `D = x ^ (x+1) = 0…011…1` (a run of `t+1` ones). Then `D >> 1 = 0…001…1` (a run of `t` ones). Their XOR `D ^ (D >> 1)` is `1` exactly at position `t` (the top of the run) and `0` elsewhere (interior bits cancel, since each interior position is `1` in both `D` and `D>>1`). Hence `g(x) ^ g(x+1) = 1 << t`, weight `1`. ∎

**Theorem 8.3 (Bijection / invertibility).** `g` is a bijection on `m`-bit values, with inverse `g^{-1}(y) = y ^ (y >> 1) ^ (y >> 2) ^ … ^ (y >> (m-1))` (a prefix-XOR of the bits).

**Proof.** `g(x) = x ^ (x >> 1)` is a linear map over `GF(2)^m` (XOR of `x` and a shift of `x`, both linear). Its matrix is upper-bidiagonal with `1`s on the diagonal — unit upper triangular — hence invertible over `GF(2)` (determinant `1`). To exhibit the inverse, recover bits from most significant down: the top bit `y_{m-1} = x_{m-1}` (since `x >> 1` has `0` in the top position), and `y_b = x_b ⊕ x_{b+1}` gives `x_b = y_b ⊕ x_{b+1}`. Unrolling the recurrence yields `x_b = y_b ⊕ y_{b+1} ⊕ … ⊕ y_{m-1}`, i.e. the descending prefix-XOR, which is exactly `y ^ (y>>1) ^ … ^ (y >> (m-1))`. ∎

**Remark (linear-algebra view).** Both `g` and `g^{-1}` are `GF(2)`-linear isomorphisms of `V`; Gray coding is a change of basis under which "increment" becomes "flip one bit." The single-bit adjacency (Theorem 8.2) is why Gray codes are used in rotary encoders and Karnaugh maps: physically only one contact changes per step, eliminating transient misreads.

### 8.1 Worked Gray-Code Table (3 bits)

```
x   x>>1   g(x)=x^(x>>1)   binary    g(x)^g(x+1)   weight
0   000    000             000       001           1
1   000    001             001       011           ... check below
2   001    011             011
3   001    010             010
4   010    110             110
5   010    111             111
6   011    101             101
7   011    100             100
```

Reading `g(0..7) = 0,1,3,2,6,7,5,4` — a permutation of `{0..7}` (Theorem 8.3, bijection). Consecutive differences: `g(0)^g(1) = 000^001 = 001` (weight 1); `g(1)^g(2) = 001^011 = 010` (weight 1); `g(2)^g(3) = 011^010 = 001` (weight 1); and so on — every adjacent pair differs in exactly one bit (Theorem 8.2). Decode `g(5) = 111` back: `111 ^ (111>>1) ^ (111>>2) = 111 ^ 011 ^ 001 = 101 = 5` ✓ (Theorem 8.3 inverse). The whole table is a concrete instance of the change-of-basis under which binary "increment" becomes Gray "single-bit flip."

### 8.2 The Reflection Construction

The name "reflected binary code" comes from a recursive construction equivalent to `g`: the `(m+1)`-bit Gray sequence is the `m`-bit sequence prefixed with `0`, followed by the *reversed* `m`-bit sequence prefixed with `1`. Reflecting and prefixing preserves the single-bit-adjacency invariant: within each half it is inherited, and at the seam the two middle codes share the lower `m` bits (by the reflection) and differ only in the new top bit. One can prove by induction that this recursive sequence equals `(g(0), g(1), …, g(2^{m+1}-1))` with `g(x) = x ^ (x>>1)`; the closed form is simply the non-recursive face of the same object. This duality (recursive reflection vs. one shift-XOR) mirrors the broader theme of this topic: an XOR identity compresses an apparently iterative construction into a single algebraic operation.

---

## 9. Linearity, Prefix XOR, and Subarray Queries

**Definition 9.1 (Prefix XOR).** For an array `a_0, …, a_{n-1}`, define `pre_0 = 0` and `pre_i = a_0 ^ … ^ a_{i-1}` for `1 ≤ i ≤ n`.

**Theorem 9.2 (Subarray XOR in O(1)).** For `0 ≤ l ≤ r < n`, `a_l ^ a_{l+1} ^ … ^ a_r = pre_{r+1} ^ pre_l`.

**Proof.** By definition `pre_{r+1} = (a_0 ^ … ^ a_{l-1}) ^ (a_l ^ … ^ a_r) = pre_l ^ (a_l ^ … ^ a_r)`. XOR both sides by `pre_l` and apply self-inverse (Proposition 3.1) to cancel `pre_l` on the right, leaving `pre_{r+1} ^ pre_l = a_l ^ … ^ a_r`. ∎

**Theorem 9.3 (Counting subarrays with XOR = K).** The number of subarrays with XOR equal to `K` equals `Σ_{i} cnt[pre_i ^ K]` accumulated online, where `cnt` counts previously seen prefix values. Correctness: a subarray `(l, r]` has XOR `K` iff `pre_{r+1} ^ pre_l = K` iff `pre_l = pre_{r+1} ^ K`, by self-inverse. Maintaining a frequency map of prefixes gives an `O(n)` algorithm, the XOR analogue of "subarray sum equals K."

**Proof.** Fix the right endpoint `r+1` with prefix value `p = pre_{r+1}`. A left boundary `l ≤ r+1` gives XOR `K` over `(l, r]` iff `p ^ pre_l = K`, i.e. `pre_l = p ^ K` (self-inverse). The count of valid `l` is the number of earlier prefixes equal to `p ^ K`, which is `cnt[p ^ K]`. Summing over all right endpoints, while inserting each `pre` into `cnt` as it is passed, counts every qualifying subarray exactly once. ∎

**Remark (why prefix XOR works at all).** Prefix sums work because addition has inverses (subtraction). Prefix XOR works for the *same algebraic reason*: `(V, ^)` is a group, and the inverse of any prefix is itself (self-inverse). Subarray queries are "group element differences" `pre_{r+1} ^ pre_l^{-1} = pre_{r+1} ^ pre_l`. The whole prefix technique is a statement about computing in a commutative group.

### 9.1 Worked Verification of the Subarray Identity

Take `a = [4, 2, 7, 1, 9]` over 4-bit values. The prefixes are:

```
pre_0 = 0
pre_1 = 4              = 0100
pre_2 = 4 ^ 2 = 6      = 0110
pre_3 = 6 ^ 7 = 1      = 0001
pre_4 = 1 ^ 1 = 0      = 0000
pre_5 = 0 ^ 9 = 9      = 1001
```

Query the XOR of `a[1..3] = {2, 7, 1}`. By Theorem 9.2 it is `pre_4 ^ pre_1 = 0 ^ 4 = 4`. Check directly: `2 ^ 7 ^ 1 = (0010 ^ 0111) ^ 0001 = 0101 ^ 0001 = 0100 = 4`. They agree. The shared prefix `pre_1` (the contribution of `a[0] = 4`) cancelled itself out of `pre_4`, isolating exactly the middle elements — a concrete instance of self-inverse cancellation in the group `(V, ^)`.

### 9.2 Worked Count of Subarrays with XOR = K

Let `a = [4, 2, 2, 6]` and `K = 6`. Maintain `cnt` (seeded `cnt[0] = 1`) and accumulate. Walking prefixes `p`:

```
start: cnt = {0:1}, total = 0
p = 4 (after a[0]):  need pre = p^K = 4^6 = 2; cnt[2]=0 -> total 0; cnt[4]+=1
p = 6 (after a[1]):  need 6^6 = 0; cnt[0]=1 -> total 1; cnt[6]+=1   (subarray a[0..1])
p = 4 (after a[2]):  need 4^6 = 2; cnt[2]=0 -> total 1; cnt[4]+=1
p = 2 (after a[3]):  need 2^6 = 4; cnt[4]=2 -> total 3; cnt[2]+=1   (two left ends)
```

Final count `3`. Enumerate to confirm: `a[0..1] = 4^2 = 6` ✓, `a[1..3] = 2^2^6 = 6` ✓, `a[3..3]`? `6`? `a[3]=6` ✓. Three subarrays XOR to `6`, matching Theorem 9.3. The two left ends found at the last step correspond to prefixes `pre_1 = 4` and `pre_3 = 4` — both equal, so both pair with the current `pre_4 = 2` to give `2 ^ 4 = 6`.

### 9.3 Fenwick (BIT) Generalization

When the array supports point updates, prefix XOR over a static array no longer suffices. Because `(V, ^)` is a group with an efficiently computable inverse (the element itself), a **Fenwick tree** stores partial XORs and supports:

- **Point update** `set(i, v)`: apply the delta `old_i ^ v` along the `O(log n)` ancestors (XORing the delta into each stored partial). This works precisely because XOR has inverses — the same reason a sum-Fenwick adds a delta.
- **Prefix query** `prefixXor(i) = a_0 ^ … ^ a_{i-1}`: XOR the `O(log n)` partials covering `[0, i)`.
- **Range query**: `prefixXor(r+1) ^ prefixXor(l)`, by self-inverse cancellation (Theorem 9.2).

Formally, a Fenwick tree is a representation of prefix reductions over *any* group `(G, ·)`; the XOR case is the group `(GF(2)^n, ^)`. Sum-Fenwick uses `(ℤ, +)`. The construction is group-generic, and correctness reduces to associativity and invertibility — both guaranteed by Theorem 2.1. This is the structural reason "XOR range queries with updates" is `O(log n)`, the same bound as sum range queries.

---

## 9b. Linear-Codes Perspective: Parity and Erasure

The application thread of `senior.md` (RAID parity, checksums) is, formally, the theory of **linear codes over `GF(2)`**. We record the connection precisely.

**Definition 9b.1 (Single-parity-check code).** Append to a data vector `(d_1, …, d_m) ∈ (GF(2)^n)^m` the parity block `P = ⊕_i d_i`. The codeword is `(d_1, …, d_m, P)`, and the defining constraint is `d_1 ^ … ^ d_m ^ P = 0`.

**Theorem 9b.2 (Single-erasure correction).** If exactly one of the `m+1` blocks is erased (lost, position known), it is uniquely recoverable as the XOR of the remaining `m` blocks.

**Proof.** The constraint `⊕_{all blocks} = 0` is one linear equation. With one unknown block `x` and the rest known, `x = ⊕_{known} blocks` by adding (XORing) all known blocks to both sides and using self-inverse to isolate `x` (Proposition 3.1). Uniqueness is immediate: a single linear equation in one unknown over a group has exactly one solution. ∎

**Theorem 9b.3 (No double-erasure correction).** Two simultaneously erased blocks are not recoverable from a single parity equation.

**Proof.** With two unknowns `x, y` and the single constraint `x ^ y = c` (where `c` is the XOR of the survivors), there are `|GF(2)^n| = 2^n` solutions `(x, c ^ x)` — one for each choice of `x`. The system is underdetermined; no unique reconstruction exists. RAID 6 adds a second, *independent* linear constraint over `GF(2^8)` (a Reed-Solomon syndrome), turning the system into two equations in two unknowns, solvable uniquely. ∎

**Remark (detection vs. correction vs. localization).** The single-parity code *corrects* one erasure (Theorem 9b.2) and *detects* any single-bit error (the constraint fails), but it cannot *localize* a corruption whose position is unknown — the error syndrome `⊕ blocks` is nonzero but points to no specific block (one equation, `m+1` candidates). This is the formal statement behind the senior-level rule "pair XOR parity with an independent per-block checksum." The minimum distance of the single-parity code is `2`: it detects all weight-1 errors but corrects none without erasure information.

### 9b.1 Worked Erasure Recovery

Three data blocks `D_0 = 1010`, `D_1 = 0110`, `D_2 = 1100` (4-bit). Parity `P = D_0 ^ D_1 ^ D_2 = 1010 ^ 0110 ^ 1100 = (1100) ^ 1100 = 0000`. Now erase `D_1` (position known). Reconstruct: `D_1' = P ^ D_0 ^ D_2 = 0000 ^ 1010 ^ 1100 = 0110` — exactly the lost block (Theorem 9b.2). For an in-place update, suppose `D_2` changes `1100 → 0011`: the new parity is `P' = P ^ old ^ new = 0000 ^ 1100 ^ 0011 = 1111`, which equals `D_0 ^ D_1 ^ (new D_2) = 1010 ^ 0110 ^ 0011 = 1111` ✓ (Corollary 3.6). No full re-scan of the stripe was needed — the old value cancelled and the new one folded in, the read-modify-write parity update that makes RAID 5 small writes affordable.

---

## 10. Limits: What XOR Cannot Decide

The power of XOR is its linearity; its limits are also linearity.

**Proposition 10.1 (Parity blindness).** The XOR-fold `Σ: V^m → V` is `GF(2)`-linear and depends only on the per-element multiplicity *parities* (Proposition 3.2). Therefore no XOR-only computation can recover multiplicities, distinguish "the unique value is `0`" from "no unique value," or detect reordering of its inputs.

**Proof.** `Σ` factors through the parity vector of multiplicities (Proposition 3.2). Two inputs with identical multiplicity-parity vectors produce identical folds; in particular any permutation (which preserves multiplicities) is invisible, and adding any value twice (which preserves all parities) does not change the result. Recovering information that differs between two such inputs is therefore impossible from the fold alone. ∎

**Corollary 10.2 (Why XOR is a weak checksum).** Because `Σ` is linear and order-blind (Proposition 10.1), an adversary who flips data bits can flip compensating parity bits to preserve the checksum, and accidental two-bit-in-a-column or reordering errors are undetected. Strong integrity requires *nonlinear* functions (the cryptographic argument deferred to `senior.md`). Formally, linearity means `Σ(d ^ e) = Σ(d) ^ Σ(e)`, so the error `e` is detected iff `Σ(e) ≠ 0` — and the set of undetected errors is exactly the kernel of `Σ`, a subspace of dimension `m·n − n`, i.e. an overwhelming fraction of all error patterns.

**Proposition 10.3 (Three-or-more singles need more than one bit).** If three distinct values `a, b, c` each have odd multiplicity, there need not exist a single bit position that separates all three into "single-survivor" groups; a one-bit partition yields parts that may each still contain two odd survivors. Recovering all three requires the linear-basis / trie techniques of `06-binary-trie-xor-basis`.

**Proof.** A single bit `β` partitions `{a,b,c}` by `s_β`; by pigeonhole at least two of the three share the same value of bit `β` and land in the same part, which then has two odd survivors and XOR-folds to their (nonzero) combination, not to a single value. So one split cannot finish the job. The systematic remedy is to build a basis of the span of the survivors (Gaussian elimination over `GF(2)`), the subject of the sibling data-structures topic. ∎

**Remark.** These limits are not deficiencies to engineer around but theorems: they delineate exactly the boundary between problems XOR solves in `O(n)`/`O(1)` (even/odd parity, single and two-singles, erasure recovery, range/prefix queries) and problems that need richer structure (counts, multi-singles, integrity, security).

### 10.1 The Kernel, Quantified

Proposition 10.1 says undetected errors form `ker Σ`, the kernel of the fold `Σ: (GF(2)^n)^m → GF(2)^n`. Since `Σ` is surjective (any target is hit, e.g. by setting one block to it and the rest to `0`), the rank-nullity theorem over `GF(2)` gives

```
dim(ker Σ) = m·n − rank(Σ) = m·n − n = (m−1)·n.
```

So out of `2^{m·n}` possible error patterns, exactly `2^{(m−1)·n}` are invisible — a fraction `2^{-n}`. For `n = 32`, that is `1` in `~4 billion` *per* error class, which sounds small, but the *structure* (any even-per-column error, any reordering) makes the invisible patterns the *common* accidental and adversarial ones, not random rare ones. This quantifies why XOR is a weak detector despite a superficially large undetected-fraction denominator: the undetected set is precisely the structured errors that occur in practice.

### 10.2 Boundary Summary

| Problem | XOR-solvable? | Reason / alternative |
|---------|---------------|----------------------|
| Single odd-count element | Yes, `O(n)`/`O(1)` | Theorem 4.1 |
| Two distinct singles | Yes, `O(n)`/`O(1)` | Theorem 5.3 (split by a bit) |
| Three-plus distinct singles | No (one bit insufficient) | Prop 10.3; use XOR basis (`06-...`) |
| Recover multiplicities/counts | No (parity-blind) | Prop 10.1; use a counter |
| "Single is 0" vs "no single" | No (both fold to 0) | Remark in §4; need external precondition |
| Detect reordering | No (commutative) | Prop 10.1; use a position-dependent hash |
| Single erasure recovery | Yes | Theorem 9b.2 |
| Double erasure recovery | No | Theorem 9b.3; use RAID 6 / RS |
| Tamper detection | No (linear) | Cor 10.2; use a MAC |
| Range/subarray XOR queries | Yes, `O(1)`/`O(log n)` | Theorems 9.2, Fenwick §9.3 |

The table is the practical distillation of every theorem above: the left column is the design question, and the algebra (group, linearity, parity) dictates the verdict in the right.

---

## 11. Summary

- **Algebra.** `(GF(2)^n, ^)` is an elementary abelian 2-group and an `n`-dimensional `GF(2)`-vector space (Theorems 2.1–2.3). The four "junior identities" are the group axioms; `0` is the identity, every element is self-inverse, and `^` is associative and commutative.
- **Pairing.** XOR-folding depends only on per-bit parity (Propositions 3.2–3.3). With exactly one odd-multiplicity value, the fold equals that value (Theorem 4.1) — the single-number theorem, proved in one line from cancellation.
- **Two-singles split.** XOR-all gives `a ^ b ≠ 0`; the lowest set bit `X & (-X)` marks a position where `a, b` differ (Lemma 5.1), so partitioning on that bit isolates each into its own single-number subproblem (Theorem 5.3).
- **Mod-k generalization.** "Others appear `k` times" is solved by counting each bit's occurrences mod `k` (Theorem 6.1); the `k=3` two-accumulator machine is a per-bit base-3 state machine, proven correct by a 3-state transition table (Theorem 6.2); `k=2` is plain XOR-all.
- **Range XOR.** `⊕_{i=0}^{n} i` has a period-4 closed form (`n, 1, n+1, 0`), because aligned 4-blocks are cosets summing to `0` (Theorem 7.1); arbitrary ranges use the self-inverse prefix cancellation `f(b) ^ f(a-1)` (Corollary 7.2).
- **Gray code.** `g(x) = x ^ (x>>1)` is a `GF(2)`-linear bijection whose consecutive outputs differ in exactly one bit (Theorems 8.2–8.3), with prefix-XOR inverse.
- **Prefix XOR.** Subarray XOR is `pre_{r+1} ^ pre_l` (Theorem 9.2), and "subarrays with XOR = K" is the group-difference count `cnt[pre ^ K]` (Theorem 9.3) — both are statements about computing in the commutative group `(V, ^)`.
- **Linear codes.** The single-parity-check code (RAID 4/5) corrects exactly one *erasure* and detects single-bit errors but cannot localize unknown-position corruption (Theorems 9b.2–9b.3); its minimum distance is `2`, and double-erasure recovery needs an independent second syndrome (RAID 6 over `GF(2^8)`).
- **Limits.** XOR-fold is parity-blind and linear (Proposition 10.1): no XOR-only computation recovers counts, distinguishes "single is 0" from "no single," detects reordering, resists tampering (Corollary 10.2), or separates three-plus singles with one bit (Proposition 10.3). The undetected-error set is the kernel of a linear map, of dimension `(m−1)·n` — most of the space (§10.1).

### Theorem Index

| Result | Statement |
|--------|-----------|
| Thm 2.1 / 2.3 | `(GF(2)^n, ^)` is an abelian group and `GF(2)`-vector space; every element self-inverse. |
| Prop 3.1–3.6 | Self-inverse, cancellation-in-a-fold, parity formula, toggle, no-temp swap, reversible add/remove. |
| Thm 4.1 | XOR-all returns the XOR of odd-multiplicity values; one odd → that value. |
| Thm 5.3 | Split-by-set-bit recovers two distinct singles. |
| Thm 6.1 / 6.2 | Mod-k bit-counting; two-accumulator mod-3 machine correctness. |
| Thm 7.1 | Period-4 closed form for `⊕_{i=0}^{n} i`. |
| Thm 8.2 / 8.3 | Gray code single-bit adjacency and bijection/inverse. |
| Thm 9.2 / 9.3 | Subarray XOR via prefixes; counting subarrays with XOR = K. |
| Thm 9b.2 / 9b.3 | Single-erasure correction; no double-erasure correction (single-parity code). |
| Prop 10.1 / 10.3 | Parity blindness / linearity limits; three-plus singles need more than one bit. |

### Closing Notes

- **One algebra, many tricks.** Every result is a corollary of `(GF(2)^n, ^)` being a group/vector space. Cancellation (`x^x=0`) and identity (`x^0=x`) are the only two facts the applications truly need; commutativity and associativity make folds order-free.
- **The boundary.** Linearity buys `O(n)`/`O(1)` parity, erasure recovery, and group-difference queries; it forbids counts, multiplicity, order detection, and integrity. Crossing the boundary (multi-singles, max-XOR queries) requires the linear-basis/trie structures of sibling `06-binary-trie-xor-basis`.
- **The mod-k thread.** XOR-all is the `k=2` member of a uniform "count bits mod k" family; recognizing this unifies single-twice, single-thrice, and beyond under one parity-of-multiplicity principle.
- **The coding-theory thread.** RAID parity, single-parity-check codes, and the erasure/detection distinction (§9b) are the applied face of "XOR is a linear map"; minimum distance `2` explains both the single-erasure correction and the inability to localize unknown-position corruption.
- **The group thread.** Prefix XOR and the Fenwick generalization (§9) are pure statements about computing prefix reductions in a commutative group with cheap inverses — the same template as prefix sums, instantiated at `(GF(2)^n, ^)` instead of `(ℤ, +)`.

### Proof-Technique Summary

| Technique | Where used | What it proves |
|-----------|-----------|----------------|
| Bitwise reduction to `GF(2)` | Thm 2.1, Prop 3.3 | Group/vector-space axioms, parity formula |
| Multiplicity-parity grouping | Prop 3.2, Thm 4.1 | XOR-all isolates odd survivors |
| Disjoint partition by a coordinate | Thm 5.3 | Two-singles split correctness |
| Per-bit finite-state induction | Thm 6.2 | Mod-3 two-accumulator machine |
| Coset cancellation | Thm 7.1 | Period-4 range-XOR closed form |
| Unit-triangular linear map | Thm 8.3 | Gray code bijection and inverse |
| Group-difference / self-inverse | Thm 9.2, §9 | Prefix-XOR subarray queries |
| Rank-nullity over `GF(2)` | §10.1 | Size of the undetected-error kernel |

Each row is a reusable proof pattern; together they show that the whole topic is a small number of linear-algebra arguments over the two-element field, applied to different engineered inputs.

Foundational references: any abstract-algebra text for elementary abelian 2-groups and `GF(2)` vector spaces; *Hacker's Delight* (Warren) for the bit-level identities (`x & -x`, Gray code) with derivations; cp-algorithms.com for range-XOR and prefix-XOR techniques; coding-theory texts (linear codes over `GF(2)`) for the parity/erasure and kernel-of-a-linear-map view; and sibling topics `01-bitwise-basics` and `06-binary-trie-xor-basis`.

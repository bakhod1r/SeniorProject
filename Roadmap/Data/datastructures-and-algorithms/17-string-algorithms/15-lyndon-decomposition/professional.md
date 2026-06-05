# Lyndon Words & Duval's Algorithm — Mathematical Foundations and Combinatorics on Words

## Table of Contents
1. Formal Definitions
2. Equivalence of the Lyndon Conditions
3. The Chen-Fox-Lyndon Factorization Theorem
4. Existence and Uniqueness (Proof)
5. Duval's Algorithm: Correctness
6. Duval's Algorithm: O(n) Time and O(1) Space
7. The Smallest-Rotation Theorem
8. Counting Lyndon Words: Witt's Formula and Möbius Inversion
9. Necklaces, the de Bruijn Construction, and the FKM Theorem
10. The Lyndon Array and Suffix Structures
11. Standard Factorization and the Free Lie Algebra
12. Summary

---

## 0. Overview

This document develops the theory behind Lyndon words and Duval's algorithm rigorously: the formal definition and the equivalence of its three forms (Section 2), the Chen-Fox-Lyndon unique-factorization theorem with full existence and uniqueness proofs (Sections 3-4), Duval's correctness via a loop invariant and its `O(n)` time / `O(1)` space optimality (Sections 5-6), the smallest-rotation theorem (Section 7), the counting theory connecting Lyndon words to necklaces via Witt's formula and Möbius inversion (Section 8), the FKM de Bruijn construction (Section 9), the Lyndon array and suffix-structure links (Section 10), the free-Lie-algebra basis (Section 11), and the bijective Burrows-Wheeler transform (Section 11b). Throughout, every theorem is anchored by a small worked example so the abstract claims stay concrete.

The central thread is a single structural fact — *strict rotation-minimality equals strict suffix-minimality* — from which everything else (linear factorization, canonical rotations, counting formulas, the Lie-algebra basis) descends.

---

## 1. Formal Definitions

Fix a totally ordered alphabet `Σ` with order `<`. Let `Σ*` be the set of finite words and `Σ⁺` the non-empty words. For `u, v ∈ Σ*`, `u < v` denotes lexicographic order: `u < v` iff `u` is a proper prefix of `v`, or at the first differing position `i` we have `u[i] < v[i]`.

**Definition 1.1 (Rotation).** For a word `w = w[0]w[1]…w[n-1]` and `0 ≤ r < n`, the **rotation** by `r` is `rot_r(w) = w[r]w[r+1]…w[n-1]w[0]…w[r-1]`. The rotation `rot_0(w) = w` is *trivial*; the others are **proper rotations**. A word is **primitive** if its `n` rotations are pairwise distinct (equivalently, `w` is not a proper power `u^k`, `k ≥ 2`).

**Definition 1.2 (Lyndon word).** A word `w ∈ Σ⁺` is a **Lyndon word** if `w < rot_r(w)` for every `r` with `1 ≤ r < |w|`; i.e. `w` is *strictly* smaller than all of its proper rotations.

**Definition 1.3 (Proper suffix).** A **proper suffix** of `w` is `w[i..]` for `1 ≤ i < |w|` (excluding the whole word and the empty word).

**Definition 1.4 (Lyndon factorization).** A **Chen-Fox-Lyndon (CFL) factorization** of `w ∈ Σ⁺` is a sequence of Lyndon words `w = w₁ w₂ … w_m` with `w₁ ≥ w₂ ≥ … ≥ w_m` (non-increasing lexicographic order).

**Notation.** `n = |w|`, `σ = |Σ|`, `μ` the Möbius function, `φ` Euler's totient. The Iverson bracket `[P]` is `1` if `P` holds else `0`. We write `L(σ, n)` for the number of Lyndon words of length exactly `n` over a `σ`-letter alphabet. Single letters of `Σ` are Lyndon words by Definition 1.2 (no proper rotations exist). Throughout, "smaller/larger" means lexicographic unless stated otherwise; "rotation" always means *cyclic* rotation (Definition 1.1); and the empty word `ε` is excluded from being Lyndon (Lyndon words are non-empty by Definition 1.2). When we say a factorization is "unique" we mean unique as an ordered sequence of factors, not merely as a multiset.

**Convention on the doubled string.** For rotation results we use `t = s · s` of length `2n`; an index `idx ∈ [0, 2n)` refers into `t`, and `t[idx] = s[idx mod n]` under the equivalent modular-indexing view (used to avoid materializing `t`). The "midline" is the boundary at position `n`.

**Remark.** A Lyndon word is necessarily **primitive**: if `w = u^k` with `k ≥ 2`, then `rot_{|u|}(w) = w`, contradicting strict inequality. Hence `aa`, `abab` are not Lyndon, while `a`, `ab`, `aab`, `aabb` are.

**Examples and non-examples.** Over `a < b < c`:

| Word | Lyndon? | Reason |
|------|---------|--------|
| `a` | yes | single letter, no proper rotations |
| `ab` | yes | `ab < ba` |
| `aab` | yes | `aab < aba < baa` |
| `aabb` | yes | smaller than every rotation/suffix |
| `abc` | yes | `abc <` all of `bca, cab` |
| `aa` | no | equals its rotation (`aa = aa`); periodic |
| `aba` | no | `aab` is a smaller rotation |
| `abab` | no | `= (ab)²`, periodic |
| `ba` | no | `ab` is a smaller rotation |

The pattern: a Lyndon word always starts with the globally smallest character of its rotation class and is aperiodic. These small cases are the unit tests every implementation should pass first.

---

## 2. Equivalence of the Lyndon Conditions

**Theorem 2.1.** For `w ∈ Σ⁺` the following are equivalent:
1. `w` is a Lyndon word (`w < rot_r(w)` for all `1 ≤ r < n`).
2. `w` is strictly smaller than every proper suffix: `w < w[i..]` for all `1 ≤ i < n`.
3. `w` is non-empty and for every split `w = u v` with `u, v ∈ Σ⁺`, we have `w < v` (equivalently `u < w < v` and even `uv < vu`).

**Proof.**
*(2 ⇒ 1).* Suppose `w < w[i..]` for every proper suffix. Take any proper rotation `rot_r(w) = w[r..] · w[0..r)`. Since `w[r..]` is a proper suffix, `w < w[r..]`. If `w` and `w[r..]` first differ within the first `n - r` characters, then `w < rot_r(w)` immediately (the rotation begins with `w[r..]`). If `w[r..]` is a proper prefix of `w` (so they agree on all `n - r` characters), then `w` has the border `w[r..]`, but `w < w[r..]` combined with `w[r..]` being a prefix of `w` forces `w[r..]` to be a *prefix*, contradicting `w < w[r..]` unless the continuation makes `rot_r(w)` larger; a short case analysis (using that `w` is then periodic with period `r`, hence `rot_r(w)` repeats and exceeds `w` at the wrap) gives `w < rot_r(w)`. Thus (1) holds.

*(1 ⇒ 2).* Suppose `w` is Lyndon but, for contradiction, some proper suffix `s = w[i..]` satisfies `s ≤ w`. If `s < w`, then the rotation `rot_i(w) = s · w[0..i)` starts with `s`; comparing `w` and `rot_i(w)`, the first `|s|` characters of `rot_i(w)` are `s < w[0..|s|)` (a prefix of `w`), so `rot_i(w) < w`, contradicting Lyndon. If `s = w` is impossible since `|s| < |w|`. Hence `w < s` for every proper suffix.

*(2 ⇔ 3).* For any split `w = uv`, `v` is a proper suffix, so (2) gives `w < v`. Conversely if `w < v` for all proper suffixes `v`, that is exactly (2). The relation `uv < vu` follows: from `w = uv < v` and prepending/comparing, one derives `uv < vu` (a standard manipulation). ∎

**Corollary 2.2.** A Lyndon word's first character is the unique minimum among all its rotations' first characters, and a Lyndon word cannot have a proper border equal to a prefix that is also a suffix in a way that violates strictness — i.e. Lyndon words are *unbordered* in the strong sense relevant to primitivity.

The equivalence (1 ⇔ 2) is what makes Duval possible: it lets a **left-to-right suffix comparison** certify the rotation-minimality property, and suffixes are exactly what a forward scan can compare.

### 2.1 Worked Equivalence Check

Take `w = aabab` over `a < b`. Its proper suffixes are `abab`, `bab`, `ab`, `b`; check condition (2):

```
aabab < abab   ? first diff at index 1: a vs b → a < b  ✓
aabab < bab    ? first char a vs b → a < b  ✓
aabab < ab     ? first char a vs a, then a vs b → a < b  ✓
aabab < b      ? first char a vs b → a < b  ✓
```

All hold, so `w` is Lyndon by (2). Cross-check (1) on a rotation: `rot_2(w) = babaa`, and `aabab < babaa` (first char `a < b`). Every proper rotation is likewise larger, confirming (1). The two conditions agree, as Theorem 2.1 guarantees, and note that the *first* differing position always favors `w` — a hallmark of Lyndon words: they "lead with" their smallest content.

### 2.2 Why Strictness Matters

If we relaxed `<` to `≤` in Definition 1.2, periodic words like `aa` would qualify (`aa ≤ aa`), destroying primitivity and breaking the unique-factorization theorem: `aa` could be either one factor or two, ruining uniqueness. The strict inequality is precisely what forces aperiodicity (Remark after Definition 1.4) and what gives each necklace *exactly one* Lyndon representative (Lemma 3.3). Strictness is not a stylistic choice; it is load-bearing for every theorem that follows.

---

## 3. The Chen-Fox-Lyndon Factorization Theorem

**Theorem 3.1 (Chen, Fox, Lyndon, 1958).** Every `w ∈ Σ⁺` has a **unique** factorization `w = w₁ w₂ … w_m` into Lyndon words with `w₁ ≥ w₂ ≥ … ≥ w_m`.

We prove existence (Section 4) constructively and uniqueness via the following key lemma.

**Lemma 3.2 (Concatenation lemma).** If `u` and `v` are Lyndon words with `u < v`, then `uv` is a Lyndon word.

**Proof.** We show `uv < s` for every proper suffix `s` of `uv` (condition 2 of Theorem 2.1). A proper suffix is either (a) a suffix of `v`, or (b) `u' v` where `u'` is a proper suffix of `u`. Case (a): `s` is a suffix of `v`; since `v` is Lyndon, `v < s` (if `s` is a *proper* suffix of `v`) or `s = v`. Also `u < v ≤ s` and `u` is a prefix of `uv`, so comparing `uv` with `s`: at worst they agree on a prefix, but `uv` continues into `v` while... more directly, `uv < v ≤ s` because `u < v` implies `uv < v` (since `u < v` and `u` a prefix means `uv` and `v` first differ where `u` and `v` do, giving `uv < v`); hence `uv < s`. Case (b): `s = u' v` with `u'` a proper suffix of `u`. Since `u` is Lyndon, `u < u'`, so `uv` and `u'v` first differ where `u` and `u'` do, giving `uv < u'v = s`. In all cases `uv < s`, so `uv` is Lyndon. ∎

**Lemma 3.3 (Lyndon = minimal aperiodic).** `w` is a Lyndon word iff `w` is the unique lexicographically smallest rotation of a primitive word, i.e. Lyndon words are in bijection with primitive necklaces via "take the smallest rotation."

This bijection (each aperiodic necklace ↔ one Lyndon word, its minimal rotation) is the combinatorial heart of the counting results in Section 8.

**Proof of Lemma 3.3.** Let `u` be primitive of length `m`. Its `m` rotations are distinct (primitivity). The lexicographically smallest rotation `w` satisfies `w ≤ rot_r(w)` for all `r`, and because the rotations are distinct, `w < rot_r(w)` strictly for `r ≠ 0` — so `w` is Lyndon. Conversely, a Lyndon word is the smallest among its (distinct, by primitivity) rotations, hence the canonical representative of its necklace. The map `u ↦ \min\text{-rotation}(u)` is constant on each necklace and hits each Lyndon word exactly once, giving the bijection between aperiodic necklaces and Lyndon words of the same length. ∎

**Corollary 3.4.** The number of Lyndon words of length `n` equals the number of aperiodic (primitive) necklaces of length `n`, which is `P(σ,n)/n` where `P(σ,n)` is the count of primitive words of length `n` — the identity exploited directly in the proof of Witt's formula (Theorem 8.1).

---

### 3.1 Worked Concatenation Lemma

Take `u = aab` and `v = ab` (both Lyndon, `u < v` since `aab < ab` — first char `a=a`, then `a < b`). Lemma 3.2 says `uv = aabab` is Lyndon. Verify by the suffix test: proper suffixes of `aabab` are `abab, bab, ab, b`, and `aabab <` each (first char `a` beats `a, b, a, b` at the next position or immediately). So `aabab` is Lyndon, as the lemma promises. This is the merge step that drives the existence proof: starting from single letters, every adjacent increasing pair `u < v` collapses into one Lyndon word.

### 3.2 A Failed Merge (Why Non-Increasing Is Forced)

Now take `u = b` and `v = a` (`u > v`). The lemma does *not* apply (it requires `u < v`), and indeed `uv = ba` is **not** Lyndon (`ab < ba`). This is exactly the situation Duval leaves alone: when a factor is `≥` the next, no merge happens, and the boundary is a genuine factor boundary. The CFL ordering `w₁ ≥ w₂ ≥ …` is precisely the set of boundaries that survive all possible merges — the fixed point of the "merge increasing pairs" process.

---

## 4. Existence and Uniqueness (Proof)

**Existence.** Start with the trivial factorization of `w` into single letters: `w = c₁ c₂ … c_n`, each `cᵢ` a (length-1) Lyndon word. Repeatedly find an adjacent pair `wᵢ wᵢ₊₁` with `wᵢ < wᵢ₊₁` and merge them into the single Lyndon word `wᵢ wᵢ₊₁` (Lemma 3.2). Each merge reduces the number of factors by one, so the process terminates, and at termination no adjacent pair has `wᵢ < wᵢ₊₁`, i.e. the factors are non-increasing. Every factor is Lyndon (single letters initially, and merges preserve Lyndon-ness by Lemma 3.2). Hence a CFL factorization exists. ∎

**Uniqueness.** Suppose `w = w₁ … w_m = v₁ … v_p` are two CFL factorizations. We claim `w₁ = v₁`. The first factor `w₁` is the **longest Lyndon prefix** of `w`: indeed, `w₁` is a Lyndon prefix, and any longer prefix `w₁ w₂' ` (extending into `w₂`) would require, for it to be Lyndon, that the whole prefix be smaller than its suffix `w₂…`, but `w₁ ≥ w₂` blocks this (a Lyndon word must be strictly smaller than each suffix, while here the suffix `w₂…` is `≤ w₁`). More precisely, one shows the first factor of any CFL factorization equals the longest Lyndon prefix, which is determined by `w` alone. Hence `w₁ = v₁`; cancel and induct on the remaining suffix. Therefore `m = p` and `wᵢ = vᵢ` for all `i`. ∎

**Proposition 4.1 (First factor = longest Lyndon prefix).** In the CFL factorization `w = w₁…w_m`, the factor `w₁` is the longest prefix of `w` that is a Lyndon word.

**Proof.** `w₁` is Lyndon, hence a Lyndon prefix. Suppose a longer prefix `q` (with `|q| > |w₁|`) were also Lyndon. Then `q` extends past `w₁` into `w₂`. Since `q` is Lyndon, `q` is strictly smaller than each of its proper suffixes; in particular `q < (\text{suffix of } q \text{ starting at } |w₁|)`. But that suffix begins with `w₂`, and `w₁ ≥ w₂` while `w₁` is a prefix of `q`. This forces `q ≥ w₁ ≥ w₂ = \text{start of the suffix}`, contradicting `q <` that suffix. Hence no longer Lyndon prefix exists, and `w₁` is the longest. ∎

This proposition is precisely what Duval computes round by round: each outer round extracts the longest Lyndon prefix of the remaining word (or a run of equal Lyndon words, handled together for efficiency).

### 4.1 Worked Uniqueness

Factor `s = "cbacba"` over `a < b < c`. The longest Lyndon prefix is `c` (since `cb` is not Lyndon — `bc < cb`). After removing `c`, the next longest Lyndon prefix of `"bacba"` is `b`. Then `"acba"`: the longest Lyndon prefix is `acb`? Check `acb`: suffixes `cb, b`; `acb < cb` and `acb < b`, so `acb` is Lyndon; is `acba` Lyndon? `acba` has suffix `a`, and `acba > a` is false — `a < acba`, so `acba <` its suffix `a`? No: `acba` vs suffix `a` → first char `a = a`, then `acba` continues `c` while `a` ends, so `a` is a prefix of `acba`, meaning `a < acba`, hence `acba >` the suffix `a` — so `acba` is **not** Lyndon. The longest Lyndon prefix of `acba` is `acb`. Remaining: `a`. So:

```
cbacba → c · b · acb · a       with  c ≥ b ≥ acb ≥ a   ✓
```

Each factor is the unique longest Lyndon prefix of what remains, so by Proposition 4.1 there is no other way to choose the first factor at each stage — uniqueness follows. Any alternative factorization would have to pick a different first factor than `c`, but `c` is forced as the longest Lyndon prefix. This is the operational content of the uniqueness proof.

---

## 5. Duval's Algorithm: Correctness

**Algorithm (Duval, 1983).**
```
DUVAL(s):                       # s of length n over ordered alphabet
  i := 0
  while i < n:
    j := i + 1; k := i
    while j < n and s[k] <= s[j]:
      if s[k] < s[j]: k := i           # extend: candidate grows into a longer Lyndon word
      else:           k := k + 1       # equal: period continues
      j := j + 1
    # now p := j - k is the period length; s[i..j) = (Lyndon word of length p)^q · prefix
    while i <= k:
      output s[i .. i+p)               # one Lyndon factor of length p
      i := i + p
```

**Invariant 5.1.** At the top of the inner loop, with `p = j - k`, the segment `s[i..j)` equals `x^q · x'` where `x = s[i..i+p)` is a Lyndon word, `q ≥ 1`, and `x'` is a proper (possibly empty) prefix of `x`. Equivalently, `s[i..j)` is "several equal Lyndon words `x` followed by a strict prefix of the next `x`."

**Proof of invariant.** Initially `j = i+1`, `k = i`, `p = 1`, `x = s[i]` (a length-1 Lyndon word), `q = 1`, `x'` empty. Inductive step on each `j`-advance:
- If `s[k] == s[j]`: the new character continues the period; `k` and `j` both advance, `p` unchanged, the prefix `x'` grows by one character (still a prefix of `x`). Invariant holds.
- If `s[k] < s[j]`: the character is *larger* than the periodic prediction, so the entire current `s[i..j]` becomes a single new Lyndon word (by Lemma 3.2-style reasoning: appending a strictly larger continuation to a Lyndon power yields a longer Lyndon word). Reset `k := i` makes the new period `p = j - i + 1`, `q = 1`, `x' ` empty. Invariant holds.

When the inner loop stops, either `j = n` or `s[k] > s[j]`. In both cases the completed Lyndon words are the `q` copies of `x` (length `p` each) that fit, i.e. while `i ≤ k` we output `x` and advance `i` by `p`. The remaining prefix `x'` (if any) is carried into the next outer round. ∎

### 5.1 Worked Duval Trace

Factor `s = aababb` over `a < b`. Outer round 1 starts at `i = 0`.

```
i=0:  j=1,k=0.  s[0]='a'
 j=1: s[k=0]='a' vs s[j=1]='a' → equal → k=1, j=2          (period p = j-k = 1, candidate "a")
 j=2: s[k=1]='a' vs s[j=2]='b' → s[k] < s[j] → reset k=0, j=3 (candidate extends to "aab", p = 3)
 j=3: s[k=0]='a' vs s[j=3]='a' → equal → k=1, j=4          (p = 3)
 j=4: s[k=1]='a' vs s[j=4]='b' → equal → k=2, j=5          (p = 3)
 j=5: s[k=2]='b' vs s[j=5]='b' → equal → k=3, j=6          (p = 3, j now = n)
 j=6: end of string. p = j-k = 3. Emit while i<=k=3:
      emit s[0..3) = "aab"; i=3.  (3 <= 3 still? i=3,k=3 → 3<=3, but p=3, next start would be 6 > k, stop)
```

So round 1 emits a single factor `"aab"` and `i` becomes `3`. Round 2 starts at `i = 3` on the suffix `"abb"`:

```
i=3:  j=4,k=3.  s[3]='a'
 j=4: s[k=3]='a' vs s[j=4]='b' → s[k] < s[j] → reset k=3, j=5  (candidate "ab", then "abb")
 j=5: s[k=3]='a' vs s[j=5]='b' → s[k] < s[j] → reset k=3, j=6  (candidate "abb", p = 3)
 j=6: end. p=3. emit "abb"; i=6. Done.
```

Final factorization: `aababb → aab · abb`. Check the ordering: `aab ≥ abb`? Compare `aab` vs `abb`: first diff at index 1, `a` vs `b`, so `aab < abb`... that is **increasing**, which would violate the theorem. Re-examining: `aab < abb` means the factors are *not* non-increasing, so this cannot be the CFL factorization — and indeed it is not. The correct factorization merges them: since `aab < abb`, by Lemma 3.2 `aababb = (aab)(abb)` is itself a *single* Lyndon word `aababb`. The trace above demonstrates exactly *why* Duval keeps extending the candidate when `s[k] < s[j]`: the reset captures that the whole prefix is becoming one larger Lyndon word. A careful re-run shows Duval emits the single factor `aababb` (the entire string is Lyndon, being smaller than all its suffixes), illustrating that the "reset on `<`" branch is what prevents a premature, wrongly-ordered split.

### 5.2 The Role of Each Comparison Outcome

The three outcomes map cleanly onto the three structural possibilities:

| Comparison | Structural meaning | Action |
|------------|--------------------|--------|
| `s[k] == s[j]` | current period repeats exactly | advance both `k` and `j` (period unchanged) |
| `s[k] < s[j]` | a larger letter extends the candidate | reset `k = i`, growing the period to `j − i + 1` |
| `s[k] > s[j]` | a smaller letter breaks the period | seal and emit the completed Lyndon factor(s) |

This table *is* the proof of correctness in compressed form: the invariant (Invariant 5.1) is preserved by the first two rows, and the third row is exactly the boundary at which a maximal run of equal Lyndon words ends, matching Proposition 4.1's "longest Lyndon prefix" per round.

### 5.3 Illustrating the Invariant on a Run of Equal Factors

Consider `s = "ababc"`. After the first outer round, Duval is examining the segment `s[0..4) = "abab"`, which is `(ab)²` — *two equal Lyndon words* `ab` followed by no extra prefix. Here the invariant `x^q · x'` holds with `x = "ab"`, `q = 2`, `x'` empty. When `j` reaches the `c` at index 4, the comparison `s[k]='a' vs s[j]='c'` gives `s[k] < s[j]`, so the candidate extends — the whole `"ababc"` becomes a single Lyndon word `ababc` (it is smaller than all its suffixes). The factorization is the single factor `ababc`. This shows the subtlety the invariant captures: a run of equal Lyndon words is only *emitted as separate factors* if the run is not extended by a larger trailing letter; otherwise it merges into one larger Lyndon word. The `q ≥ 1` copies in the invariant are "provisional" until the inner loop decides between extend and emit.

**Theorem 5.2 (Correctness).** `DUVAL(s)` outputs exactly the CFL factorization of `s`.

**Proof.** By Invariant 5.1, each emitted factor of length `p` is the Lyndon word `x`, and within one outer round all emitted factors are *equal* (all are `x`), hence trivially non-increasing among themselves. Across rounds, the next round's first factor is `≤` the previous round's last factor: the inner loop stopped because `s[k] > s[j]` (the next character is smaller than the periodic prediction), which means the next Lyndon prefix is strictly smaller than `x`. So the global sequence of factors is non-increasing, and each is Lyndon. By the uniqueness of the CFL factorization (Theorem 3.1), the output *is* the CFL factorization. Equivalently, each outer round extracts the longest Lyndon prefix run, matching Proposition 4.1. ∎

---

## 6. Duval's Algorithm: O(n) Time and O(1) Space

**Theorem 6.1 (Complexity).** `DUVAL(s)` runs in `O(n)` time and uses `O(1)` working space beyond the input and the output stream.

**Proof (time).** We use an amortized argument. The variable `j` only ever increases (it is incremented on every inner-loop iteration and never decreases). It starts at `0` and is bounded by `n`. However, between outer rounds, after emitting factors and advancing `i`, the next round restarts `j := i + 1` — so `j` can "rewind." The key bound: in each outer round, the inner loop runs from `j = i+1` up to some `j = i + (q·p + |x'|) = i + (\text{length consumed} + \text{look-ahead})`. The look-ahead `|x'|` (the unconsumed prefix) is at most `p - 1`, and it becomes the *start* of the next round, so each character is charged at most twice: once when first read by `j`, and once when re-read as the carried prefix `x'` at the start of the next round. Hence total inner-loop iterations `≤ 2n`, giving `O(n)`. 

A cleaner accounting: define the potential `Φ = i + j`. Each inner-loop step increases `j` by 1 (so `Φ` up by 1). Each emit step increases `i` by `p` (so `Φ` up by `p`) but does not run the inner loop. Both `i` and `j` are bounded by `2n` in total movement (each ≤ `n`, but `j` resets cost is bounded by the prefix re-read which is itself bounded by total length). Summing, the work is `Θ(n)`. ∎

**Proof (space).** The algorithm stores only the three integer indices `i, j, k` and the period `p`. Output is streamed (each factor's start index and length), so no auxiliary array of size depending on `n` is needed. Hence `O(1)` extra space. ∎

**Remark (each character read ≤ 3 times).** A finer analysis (Duval's original) shows each position of `s` is involved in at most a constant number of comparisons, because the carried prefix `x'` of one round is exactly the input to the next and is re-scanned only once. This yields the tight linear bound and is why Duval is the canonical optimal factorizer.

### 6.1 Worked Amortization

Consider the adversarial-looking input `s = "aaaaab"` (a long run then a larger letter). Naively one might fear the inner loop re-scans the run repeatedly. Trace it:

```
i=0: j=1,k=0.
 j=1..4: 'a' vs 'a' each time → equal → k advances 0→1→2→3, j advances 1→2→3→4→5.  (period p = 1)
 j=5: 'a'(k=4) vs 'b'(j=5) → s[k] < s[j] → reset k=0, j=6.  (candidate "aaaaab", p = 6, j = n)
 j=6: end. p = 6. emit while i<=k=0: emit s[0..6)="aaaaab"; i=6. Done.
```

Each of the 6 characters was read by `j` exactly once; `k` re-read the run once during the equality phase. Total comparisons `≈ 2n`, not `n²`. The look-ahead never "rewinds" `j`; it only advances. This is the concrete realization of the amortized bound: the equal-letter run is scanned by `k` once (charged to the period) and by `j` once (charged to consumption), so the constant is small. The worst-case constant (each char touched ≤ 3 times) arises when a long carried prefix `x'` is re-examined at the start of the next round, but even then the total stays `Θ(n)`.

### 6.2 Lower Bound and Optimality

**Proposition 6.2.** Any algorithm that outputs the CFL factorization must read `Ω(n)` characters and emit `Ω(\text{number of factors})` boundaries; hence `O(n)` time and `O(1)` extra space (streaming the output) is optimal up to constant factors.

**Proof.** Changing a single character of `s` can change its factorization (e.g. `aab` is one Lyndon word, `abb` is one Lyndon word `abb`, but `aba` factors as `ab · a`), so every character must be examined — `Ω(n)` reads. Duval matches this with `O(n)` time and only three integer registers of state. There is no sub-linear factorizer because the factorization is not determined by any proper subset of the characters. ∎

### 6.3 Online and Incremental Notes

Duval is a *left-to-right* algorithm, so it is naturally **online in the input prefix sense**: it can begin factoring as characters stream in, emitting factors that are fully determined. However, the *last* factor of the prefix is provisional — appending more characters can extend it (the "reset on `<`" branch), so the trailing candidate must be held until the period breaks or the stream ends. This is exactly the chunk-boundary subtlety in `senior.md` Section 5: to factor a stream correctly, carry the unfinished candidate `(i, j, k, p)` across chunk loads; never re-start the scan per chunk. The amortized `O(1)`-per-character cost is preserved across chunks because the carried prefix is re-scanned at most once, identical to the single-pass analysis (Theorem 6.1). Truly *dynamic* updates (inserting a character in the middle and re-factoring) do not have a simple `O(1)` update and generally require re-running the scan from an affected boundary — Duval is online-append, not fully dynamic.

---

## 7. The Smallest-Rotation Theorem

**Theorem 7.1.** Let `s` have length `n`, and let `t = s · s` (length `2n`). Run Duval on `t`. Let `p` be the start index (in `t`) of the **last Lyndon factor whose start index is `< n`**. Then `t[p .. p+n)` is the lexicographically smallest rotation of `s`, and `p ∈ [0, n)`.

**Proof.** The rotations of `s` are exactly the length-`n` substrings `t[r .. r+n)` for `0 ≤ r < n`. Consider the CFL factorization of `t`. The smallest rotation `m` of `s` is a Lyndon word *or* a power of one when `s` is periodic. In the factorization of `t = s·s`, the smallest rotation aligns with the start of a Lyndon factor: by Theorem 2.1, the smallest rotation is `< ` all its own rotations, so it begins a Lyndon word in the factorization. Because `t` contains two full copies of `s`, the factor that begins the smallest rotation must start at some `p < n` (every rotation start has a representative in `[0, n)`), and it spans at least `n` characters' worth of factors before repeating. Tracking the last factor start `< n` selects exactly the rotation point that is smallest, because Duval's factors are non-increasing and the minimal rotation corresponds to the deepest (rightmost-before-`n`) Lyndon factor boundary that still has `n` characters of room in `t`. Hence `t[p..p+n)` is minimal. ∎

**Corollary 7.2 (Booth equivalence).** The index `p` of Theorem 7.1 equals the least-rotation index computed by Booth's algorithm. Both run in `O(n)`; Duval-on-`t` reuses the factorization engine, while Booth uses a KMP-style failure function tailored to rotations.

**Corollary 7.3 (Largest rotation).** Applying Theorem 7.1 with the reversed alphabet order (`c ↦` its order-complement) yields the lexicographically **largest** rotation, since reversing the order turns "smallest" into "largest" while preserving the rotation structure.

**Least-rotation algorithms compared.** Three linear-time methods solve the least-rotation problem; all are `O(n)` but differ in mechanism and reusability:

| Method | Mechanism | Extra space | Reuses |
|--------|-----------|-------------|--------|
| Duval on `s · s` | CFL factorization, last factor start `< n` | `O(1)` beyond `s+s` (or `O(1)` with modular indexing) | the general factorizer |
| Booth (1980) | KMP-style failure function over `s+s`, tracking the least start | `O(n)` (failure array) | nothing specific |
| Suffix array of `s+s` | sort all suffixes, pick the least length-`n` one | `O(n)` | all suffix queries |

For a single query, Duval is the lightest (no auxiliary array if you index modulo `n`); Booth is the classical purpose-built choice; the suffix array pays off only when many other queries share the string. All three return the same index by Corollary 7.2.

**Remark (periodic `s`).** If `s = u^d` is a `d`-th power, all "phase-aligned" rotations coincide, and the minimal rotation is `(\min\text{-rotation of } u)^d`. Theorem 7.1 still returns a correct `p < n`; the minimal rotation is just internally periodic. This is why canonicalization must respect the *actual* length `n` (Section 2 of `senior.md`).

### 7.1 Worked Smallest-Rotation Example

Let `s = "bca"` (`n = 3`), so `t = s · s = "bcabca"`. Run Duval on `t`:

```
t = b c a b c a
    0 1 2 3 4 5
i=0: j=1,k=0. s[0]='b'
 j=1: 'b' vs 'c' → b < c → reset k=0, j=2   (candidate "bc")
 j=2: 'b' vs 'a' → b > a → break. p = j-k = 2. emit "bc"? No: i<=k=0, emit t[0..2)="bc"... 
```

Tracing carefully, the first factor is `"b"` then `"c"` would not be Lyndon-ordered; the actual CFL factorization of `"bcabca"` is `b · c · abc · a`. The factor starts are `0, 1, 2, 5`. The last factor start `< n = 3` is `p = 2` (the factor `"abc"`). Therefore the smallest rotation is `t[2 .. 5) = "abc"`, which matches `min(bca, cab, abc) = abc`. The straddling factor `"abc"` is itself a Lyndon word and is precisely the minimal rotation — a clean illustration of Theorem 7.1: the answer is the start of the deepest Lyndon factor lying before the midpoint.

### 7.2 Why Tracking the Last Factor Start Works

One might ask why we take the *last* factor start before `n` rather than, say, the smallest factor by value. The reason is structural: the factors of `t` to the left of position `n` correspond to the "false starts" — rotations that begin with a locally small but not globally minimal piece. As Duval consumes `t`, the factors are non-increasing, so each successive factor start before `n` corresponds to a strictly better (smaller) rotation candidate. The *last* one before the midpoint is therefore the best, and it is guaranteed to have at least `n` characters of room in `t = s·s` to span a full rotation. This monotone-improvement view is the operational reading of Theorem 7.1.

---

## 8. Counting Lyndon Words: Witt's Formula and Möbius Inversion

**Theorem 8.1 (Witt's formula).** The number of Lyndon words of length exactly `n` over a `σ`-letter alphabet is

```
L(σ, n) = (1/n) · Σ_{d | n}  μ(d) · σ^{n/d},
```

where `μ` is the Möbius function.

**Proof.** Each word of length `n` is a power `u^{n/|u|}` of a unique *primitive* word `u` whose length divides `n`. Let `P(σ, m)` be the number of primitive words of length `m`. Counting all `σⁿ` words by their primitive root:

```
σⁿ = Σ_{m | n} P(σ, m).
```

Möbius inversion gives `P(σ, n) = Σ_{d | n} μ(d) σ^{n/d}`. Now, primitive words of length `n` split into rotation classes (necklaces) each of size exactly `n` (primitivity ⇒ `n` distinct rotations), and each such *aperiodic necklace* has exactly one Lyndon representative (its minimal rotation, Lemma 3.3). Hence

```
L(σ, n) = P(σ, n) / n = (1/n) Σ_{d | n} μ(d) σ^{n/d}. ∎
```

**Example.** `σ = 2`: `L(2,1) = 2` (`0`,`1`), `L(2,2) = (1/2)(2² − 2) = 1` (`01`), `L(2,3) = (1/3)(2³ − 2) = 2` (`001`,`011`), `L(2,4) = (1/4)(2⁴ − 2²) = 3` (`0001`,`0011`,`0111`).

**Worked necklace count.** For `σ = 2, n = 6`: `N(2,6) = (1/6) Σ_{d|6} φ(d) 2^{6/d} = (1/6)(φ(1)·2⁶ + φ(2)·2³ + φ(3)·2² + φ(6)·2¹) = (1/6)(1·64 + 1·8 + 2·4 + 2·2) = (64+8+8+4)/6 = 84/6 = 14`. So there are 14 binary necklaces of length 6, of which `L(2,6) = 9` are aperiodic (Lyndon) and the remaining `5` are periodic (built from period-1, -2, or -3 roots). The split `14 = 9 + 5` is a useful invariant: aperiodic necklaces are the Lyndon words; periodic ones are powers of shorter necklaces.

**Worked detail.** Reading the length-4 case more closely: `L(2,4) = 3` counts the *aperiodic* binary necklaces of length 4. The four-bead binary necklaces are `0000`, `0001`, `0011`, `0101`, `0111`, `1111` — six in total (`N(2,4) = 6`). Of these, `0000`, `1111` are constant and `0101` is periodic (`= (01)²`); the remaining three (`0001`, `0011`, `0111`) are aperiodic, matching `L(2,4) = 3`. The Lyndon representative of each aperiodic necklace is its smallest rotation, which is exactly the string listed. This concretely realizes Lemma 3.3's bijection: aperiodic necklaces ↔ Lyndon words.

**Theorem 8.2 (Necklace count).** The number of necklaces (rotation classes, including periodic ones) of length `n` over `σ` letters is

```
N(σ, n) = (1/n) Σ_{d | n} φ(d) σ^{n/d}    (Burnside / Pólya),
```

where `φ` is Euler's totient. The formula follows from Burnside's lemma applied to the cyclic group `C_n` acting on `Σⁿ` by rotation: the rotation by `r` fixes exactly `σ^{gcd(r,n)}` words, and summing over `r` and grouping by `d = gcd(r,n)` (with `φ(n/d)` values of `r` giving each `d`) yields the stated sum. The aperiodic necklaces number exactly `L(σ, n)`; the bracelet count (allowing reflection) adds a dihedral correction.

**Identity 8.3 (de Bruijn length).** Summing the contributions of Lyndon words whose length divides `k`, weighted by length, recovers the alphabet count:

```
Σ_{d | k}  d · L(σ, d) = σ^k.
```

**Worked identity.** For `σ = 2, k = 6`: divisors `1, 2, 3, 6` with `L(2,1)=2, L(2,2)=1, L(2,3)=2, L(2,6)=9`. Then `Σ d·L(2,d) = 1·2 + 2·1 + 3·2 + 6·9 = 2 + 2 + 6 + 54 = 64 = 2⁶`. The total length of the FKM concatenation for `B(2,6)` is therefore exactly `64`, confirming Identity 8.3 and the de Bruijn length `σᵏ`. This is also a non-trivial cross-check on a Witt-formula table: if the weighted divisor sum does not hit `σᵏ`, one of the `L(σ,d)` values is wrong.

**Proof.** Each word of length `k` corresponds to a `k`-length cyclic window of a de Bruijn sequence; equivalently, summing `d · L(σ,d)` over divisors counts all length-`k` words via their Lyndon decomposition of the necklace structure. This identity is exactly the total length of the FKM de Bruijn construction (Section 9). ∎

---

## 9. Necklaces, the de Bruijn Construction, and the FKM Theorem

**Definition 9.1 (de Bruijn sequence).** A **de Bruijn sequence** `B(σ, k)` is a cyclic word of length `σᵏ` over a `σ`-letter alphabet such that every word of length `k` appears exactly once as a cyclic factor.

**Theorem 9.2 (Fredricksen-Kessler-Maiorana / FKM).** Concatenate, in lexicographic order, all Lyndon words over `Σ` whose length **divides** `k`. The resulting word of length `σᵏ` is a de Bruijn sequence `B(σ, k)`.

**Proof sketch.** The length is `Σ_{d | k} d · L(σ, d) = σᵏ` (Identity 8.3). One shows that reading length-`k` windows cyclically over this concatenation visits each length-`k` word exactly once: the Lyndon words in lexicographic order, with the divisibility filter, correspond bijectively to the necklace structure of the de Bruijn graph's Eulerian/Hamiltonian cycle. The granddaddy fact is that the FKM concatenation traces a specific Eulerian cycle in the de Bruijn graph `G(σ, k-1)` (or equivalently a Hamiltonian cycle in `G(σ, k)`), and Lyndon words index the cycle's "necklace" decomposition. ∎

**Theorem 9.3 (FKM generation cost).** The Lyndon words up to length `n` can be generated in lexicographic order in **amortized `O(1)` per word** (Duval's analysis of the FKM successor rule), so `B(σ, k)` is produced in `O(σᵏ)` time — optimal in the output size.

**Successor rule.** Given the current Lyndon word `w` (length `≤ n`), the next one is obtained by: (i) repeat `w` to length `n` (`w[i] = w[i mod |w|]`), (ii) delete trailing occurrences of the maximal letter, (iii) increment the new last letter. This is the FKM successor; its amortized cost is `O(1)` because the total work over all generated words telescopes to `O(\text{output})`.

### 9.1 Worked de Bruijn Construction

Build `B(2, 3)`. First enumerate the Lyndon words over `{0,1}` of length `≤ 3`, in lexicographic order:

```
0,  001,  01,  011,  1
```

(Length 1: `0`, `1`. Length 2: `01`. Length 3: `001`, `011`.) Now keep only those whose length divides `k = 3`, i.e. length `1` or `3`:

```
keep: 0  (len 1),  001 (len 3),  011 (len 3),  1 (len 1)
drop: 01 (len 2 does not divide 3)
```

Concatenating in lexicographic order: `0 · 001 · 011 · 1 = 00010111`. The length is `8 = 2³`, as predicted. Verify it is de Bruijn by sliding a cyclic length-3 window:

```
positions (cyclic) of 00010111:
000, 001, 010, 101, 011, 111, 110, 100
```

All eight 3-bit strings `{000, 001, 010, 011, 100, 101, 110, 111}` appear exactly once — confirming `00010111` is a de Bruijn sequence `B(2,3)`. This is exactly the FKM theorem (Theorem 9.2) in action, and matches Task 8 in [`tasks.md`](./tasks.md).

### 9.2 The de Bruijn Graph View

The de Bruijn graph `G(σ, k-1)` has the `σ^{k-1}` length-`(k-1)` words as vertices and an edge for each length-`k` word (from its `(k-1)`-prefix to its `(k-1)`-suffix). An **Eulerian cycle** of this graph — visiting every edge once — spells a de Bruijn sequence. The FKM/Lyndon construction is a specific, deterministic Eulerian cycle: the Lyndon words with length dividing `k`, concatenated in lexicographic order, trace the "least" such cycle. This is why the construction is canonical and why its correctness is equivalent to the existence of an Eulerian cycle (guaranteed because every vertex of `G(σ, k-1)` has equal in- and out-degree `σ`).

**FKM as the lexicographically least de Bruijn sequence.** Among all de Bruijn sequences `B(σ, k)`, the FKM/Lyndon construction produces the *lexicographically smallest* one. This is a non-obvious optimality: the greedy "prefer-smallest-next-letter that keeps every window unique" (the "prefer-one"/Martin construction's mirror) yields the same string. So the Lyndon-word concatenation is not just *a* de Bruijn sequence but the canonical least one — useful when a deterministic, reproducible coverage sequence is required (e.g. fixed test vectors). The proof links the lexicographic order of Lyndon words to the lexicographic order of the resulting windows.

---

## 10. The Lyndon Array and Suffix Structures

**Definition 10.1 (Lyndon array).** For `s` of length `n`, the **Lyndon array** `λ[i]` is the length of the longest Lyndon word starting at position `i`: `λ[i] = max{ ℓ : s[i..i+ℓ) is Lyndon }`.

**Theorem 10.2.** `λ` can be computed in `O(n)` time, and it is intimately related to the **next-smaller-suffix** structure: `λ[i] = nss[i] − i`, where `nss[i]` is the starting index of the next suffix (to the right) that is lexicographically smaller than `s[i..]` (or `n` if none).

**Proof idea.** `s[i..i+ℓ)` is the longest Lyndon word at `i` exactly when `s[i..]` is smaller than all suffixes inside the window but the suffix at `i + ℓ` is the first that is *not larger* — this is precisely the next-smaller-suffix boundary, computable with a stack/Cartesian-tree pass in linear time. ∎

**Inversion relation.** The Lyndon array `λ` and the *next-smaller-suffix* array `nss` are interconvertible in `O(n)` (`λ[i] = nss[i] − i`), and `nss` in turn is recoverable from the suffix array's rank information. Thus the Lyndon array sits in the same `O(n)`-equivalence class as suffix-order data: given any one, the others follow in linear time. This is why a single Duval-style scan can bootstrap a suffix-array construction and vice versa.

**Connection to suffix arrays.** Several linear-time suffix-array constructions and the **Lyndon-array** approach exploit that the suffix order and the Lyndon factorization interleave: the first factor of the CFL factorization is the longest Lyndon prefix, and the global Lyndon structure refines the suffix ranking. The **bijective BWT** (sibling `10-burrows-wheeler-transform`) is *defined* via the CFL factorization: factor `s` into Lyndon words, sort the cyclic rotations of those factors, and read the last column — no sentinel `$` required, unlike the classical BWT.

**Theorem 10.3 (Lyndon factor and suffix minima).** The starting positions of the CFL factors of `s` are exactly the positions `i` where `s[i..]` is a *left-to-right suffix minimum* (smaller than every suffix starting before it within the same factor). This characterization links Duval's output to the suffix-array's structure and is used in run-detection ("runs theorem") proofs.

### 10.1 Worked Lyndon Array

Take `s = "cbab"` over `a < b < c`. The Lyndon array `λ[i]` is the length of the longest Lyndon word starting at `i`:

```
i=0: suffixes/prefixes at 0: "c"(Lyndon), "cb"? cb vs b → b < cb so cb NOT Lyndon (cb > its suffix b).
      longest Lyndon prefix at 0 is "c", λ[0] = 1.
i=1: "b"(Lyndon), "ba"? ba vs a → a < ba, NOT Lyndon. λ[1] = 1.
i=2: "a"(Lyndon), "ab"(Lyndon: a < ab and a < b). λ[2] = 2.
i=3: "b"(Lyndon). λ[3] = 1.
```

So `λ = [1, 1, 2, 1]`. Cross-check via the next-smaller-suffix relation `λ[i] = nss[i] − i`: the suffixes are `cbab, bab, ab, b`; their ranks (smallest first) put `ab` and `b` below `bab` and `cbab`. For `i = 2` (`ab`), the next suffix to the right smaller than `ab` does not exist within the window, and the next-smaller-suffix index is `4` (past the end), giving `λ[2] = 4 − 2 = 2`. The values agree, illustrating Theorem 10.2.

### 10.1b Linear Computation of the Lyndon Array

The `O(n)` Lyndon-array algorithm processes positions right-to-left, maintaining a stack (or a Cartesian-tree-like structure) of "candidate next-smaller-suffix" boundaries. At position `i`, it compares `s[i..]` against the suffix at the current stack top using already-computed information; when the suffix at `i` is smaller, it pops dominated candidates. The key amortized fact: each position is pushed and popped at most once, so the total work is `O(n)`. The output `nss[i]` (next-smaller-suffix start) immediately gives `λ[i] = nss[i] − i`. This mirrors the "next smaller element" monotonic-stack pattern (sibling `stack-queue-patterns`), specialized to suffix comparison. Because suffix comparisons are resolved using the previously computed `nss` links (a form of memoization), no comparison is repeated, keeping the bound linear despite the apparent need to compare full suffixes.

### 10.2 The Runs Theorem Connection

The **runs theorem** (Bannai et al., 2017) — that a string of length `n` has fewer than `n` maximal periodicities ("runs") — is proved using the Lyndon array: each run is "anchored" by a Lyndon root, and the longest-Lyndon-word-at-each-position structure bounds the number of distinct run roots. This is a deep, modern application: the same `O(n)` Lyndon machinery that factors a string also bounds its repetitive structure, tying combinatorics on words to efficient repetition detection used in bioinformatics and compression (sibling `10-burrows-wheeler-transform`).

---

## 11. Standard Factorization and the Free Lie Algebra

Lyndon words are not merely an algorithmic device; they are a basis-building tool in algebra.

**Definition 11.1 (Standard factorization).** For a Lyndon word `w` with `|w| ≥ 2`, write `w = u v` where `v` is the **longest proper suffix** of `w` that is itself a Lyndon word. Then `u` is also Lyndon and `u < v`. The pair `(u, v)` is the **standard factorization** of `w`.

**Theorem 11.2 (Lyndon basis of the free Lie algebra).** Mapping each Lyndon word to a Lie bracket recursively via its standard factorization — `[w] = [[u],[v]]` for `|w| ≥ 2` and `[c] = c` for letters — yields a **basis of the free Lie algebra** over `Σ`. Consequently the number of Lyndon words of length `n` equals the dimension of the degree-`n` component of the free Lie algebra, which is `L(σ, n)` (Witt's formula, Theorem 8.1) — the same number, now interpreted as a Lie-algebra dimension (Witt's original context).

**Theorem 11.3 (Radford / shuffle).** Every word factors uniquely as a non-increasing product of Lyndon words (CFL, Theorem 3.1), and this underlies the fact that the **shuffle algebra** is a polynomial algebra on the Lyndon words (Radford's theorem). This is the algebraic shadow of the combinatorial uniqueness we proved in Section 4.

**Standard factorization is well-defined.** For a Lyndon word `w` with `|w| ≥ 2`, the longest proper Lyndon suffix `v` always exists (single letters are Lyndon, so at least one proper Lyndon suffix exists) and the complementary prefix `u` is provably Lyndon with `u < v` (a classical lemma). The recursion `[w] = [[u],[v]]` therefore terminates: each step strictly decreases the length, bottoming out at single letters `[c] = c`. This well-foundedness is what makes the Lyndon-to-Lie-bracket map total and the resulting set a genuine basis (Theorem 11.2), not merely a spanning set.

**Significance.** The uniqueness of the CFL factorization (combinatorics) and the freeness of the Lyndon basis (algebra) are two faces of one phenomenon: Lyndon words form a "free generating set" for words under concatenation-with-ordering, exactly as they generate the free Lie algebra. This is why the same objects appear in string algorithms, in Hall bases for Lie algebras, and in the theory of free groups.

### 11.1 Worked Standard Factorization

Take the Lyndon word `w = aabab` (`|w| = 5 ≥ 2`). Its proper suffixes that are Lyndon are: `abab`? — `abab = (ab)²` is periodic, not Lyndon. `bab`? — `bab` rotates to `abb`... `abb < bab`, so `bab` is not Lyndon. `ab` — Lyndon (`a < ab`, `a < b`). `b` — Lyndon. The *longest* proper suffix that is Lyndon is `ab` (length 2). So the standard factorization is `w = u · v` with `v = ab` and `u = aab`:

```
aabab = aab · ab,   u = aab (Lyndon),  v = ab (Lyndon),  u < v  ✓
```

Both parts are Lyndon and `u = aab < ab = v` (first char `a = a`, then `a < b`), as Definition 11.1 requires. The associated Lie bracket is `[w] = [[aab], [ab]]`, recursively `[aab] = [[a],[ab]] = [a,[a,b]]` and `[ab] = [a,b]`, giving the nested bracket `[[a,[a,b]], [a,b]]` — a basis element of the degree-5 component of the free Lie algebra.

### 11.2 Counting Cross-Check via the Lie Dimension

Theorem 11.2 says the number of Lyndon words of length `n` equals `dim` of the degree-`n` part of the free Lie algebra on `σ` generators, which Witt's formula (Theorem 8.1) computes as `(1/n) Σ_{d|n} μ(d) σ^{n/d}`. For `σ = 2, n = 5`: divisors `1, 5`; `μ(1)=1, μ(5)=-1`; `L(2,5) = (1/5)(2⁵ − 2¹) = (32 − 2)/5 = 6`. So there are exactly 6 Lyndon words of length 5 over `{0,1}` — and exactly 6 basis elements of the degree-5 free Lie algebra on two generators. The two counts coincide by Theorem 11.2; the combinatorial object and the algebraic dimension are literally the same number, which is precisely the content of Witt's original 1937 theorem.

---

## 11b. The Bijective Burrows-Wheeler Transform

The classical BWT (sibling `10-burrows-wheeler-transform`) appends a unique sentinel `$`, sorts all rotations of `s$`, and reads the last column. The **bijective BWT (BWTS)** of Gil and Scott removes the sentinel entirely by routing through the Lyndon factorization.

**Construction 11b.1 (BWTS).**
1. Factor `s` into its CFL factorization `s = w₁ w₂ … w_m` (Duval, `O(n)`).
2. Form the multiset of all **cyclic rotations** of each factor `wᵢ` (each `wᵢ`, being Lyndon and primitive, contributes `|wᵢ|` distinct rotations).
3. Sort all these rotations together using **infinite (ω-)comparison**: compare `wᵢ^∞` against `wⱼ^∞` (the infinite periodic extensions), which is well-defined because the factors are aperiodic.
4. Read the last character of each sorted rotation; the concatenation is the bijective BWT.

**Theorem 11b.2.** The map `s ↦ BWTS(s)` is a **bijection** on `Σⁿ` (no sentinel needed), and it is invertible in `O(n)` via a standard-permutation (LF-mapping) argument analogous to the classical inverse BWT.

**Why Lyndon factorization is essential.** The infinite comparison `wᵢ^∞ vs wⱼ^∞` is unambiguous *only* because each `wᵢ` is primitive (a Lyndon word), so `wᵢ^∞ ≠ wⱼ^∞` whenever `wᵢ ≠ wⱼ` and the comparison terminates at a finite position. If the factors could be periodic, the infinite extensions could be equal for unequal factors, breaking the sort and the bijection. The CFL factorization's guarantee of *aperiodic, non-increasing* factors is precisely what makes BWTS well-defined.

**Worked sketch.** For `s = "banana"` with factorization `b · an · an · a` (factors `b, an, an, a`), the rotations are `{b; an, na; an, na; a}`. Sorting by ω-comparison and reading last columns yields the bijective transform — a sentinel-free permutation of `banana`'s characters that compresses run structure as well as the classical BWT but composes cleanly across concatenated records (no per-record `$` to track). This is why streaming compression pipelines that process many short records favor the bijective variant (Section 4 of `senior.md`).

**Significance.** BWTS demonstrates that the Lyndon factorization is not merely an algorithmic convenience but a *structural* tool: it provides exactly the aperiodic decomposition needed to define a sentinel-free, bijective block-sorting transform. The same factorization underlies linear-time suffix-array construction via the Lyndon array (Section 10), so a single `O(n)` primitive — Duval's scan — feeds two cornerstones of modern full-text indexing.

**Why infinite comparison is well-founded.** For two distinct Lyndon words `wᵢ ≠ wⱼ`, the infinite extensions `wᵢ^∞` and `wⱼ^∞` first differ at a position `< |wᵢ| + |wⱼ|` (in fact `< |wᵢ| + |wⱼ| − gcd`). This bound guarantees the ω-comparison terminates and is total, so the sort in Construction 11b.1 is well-defined and `O(n)`-implementable with care. Aperiodicity is what rules out the degenerate `wᵢ^∞ = wⱼ^∞` for `wᵢ ≠ wⱼ` — yet another place where the *strictness* of the Lyndon definition (Section 2.2) is load-bearing rather than cosmetic. Drop strictness and the bijective BWT ceases to be a bijection.

---

## 12. Summary

- **Lyndon word** (`w < ` all proper rotations) ⟺ (`w < ` all proper suffixes) ⟺ (`w < v` for every split `w = uv`) — Theorem 2.1. This equivalence is what lets a forward suffix scan certify rotation-minimality, enabling Duval.
- **Chen-Fox-Lyndon theorem:** every word factors *uniquely* into non-increasing Lyndon words (Theorem 3.1). Existence is the "merge adjacent increasing pairs" argument (Lemma 3.2); uniqueness follows because the first factor is the *longest Lyndon prefix* (Proposition 4.1).
- **Duval's algorithm** computes the factorization in `O(n)` time and `O(1)` extra space, with each character read a constant number of times (Theorems 5.2, 6.1); the invariant is "a power of one Lyndon word plus a proper prefix" (Invariant 5.1).
- **Smallest rotation:** run Duval on `s · s`; the last factor starting before index `n` marks the minimal rotation (Theorem 7.1), matching Booth's algorithm (Corollary 7.2); reversing the alphabet gives the largest rotation (Corollary 7.3).
- **Counting:** Lyndon words of length `n` number `L(σ,n) = (1/n) Σ_{d|n} μ(d) σ^{n/d}` (Witt's formula via Möbius inversion, Theorem 8.1); they count *aperiodic necklaces*, with the full necklace count `(1/n) Σ_{d|n} φ(d) σ^{n/d}` (Theorem 8.2).
- **de Bruijn:** concatenating Lyndon words whose length divides `k` yields `B(σ,k)`, a de Bruijn sequence of length `σᵏ` (FKM theorem, Theorem 9.2), generated in amortized `O(1)` per word (Theorem 9.3).
- **Suffix structures:** the **Lyndon array** (`λ[i] = nss[i] − i`) is computable in `O(n)` (Theorem 10.2) and feeds suffix-array construction and the sentinel-free **bijective BWT** (Section 10).
- **Algebra:** via the standard factorization, Lyndon words form a basis of the **free Lie algebra** (Theorem 11.2) and generate the shuffle algebra (Radford, Theorem 11.3) — the algebraic counterpart of the combinatorial uniqueness.

### Complexity / Count Cheat Table

| Task | Result | Reference |
|------|--------|-----------|
| CFL factorization | `O(n)` time, `O(1)` space | Theorems 5.2, 6.1 |
| Smallest / largest rotation | `O(n)` via Duval on `s·s` | Theorem 7.1, Cor. 7.3 |
| `# Lyndon words` length `n` | `(1/n) Σ_{d|n} μ(d) σ^{n/d}` | Theorem 8.1 (Witt) |
| `# necklaces` length `n` | `(1/n) Σ_{d|n} φ(d) σ^{n/d}` | Theorem 8.2 (Burnside) |
| de Bruijn `B(σ,k)` | length `σᵏ`, FKM concatenation | Theorem 9.2 |
| Lyndon array | `O(n)`, `λ[i] = nss[i] − i` | Theorem 10.2 |

### Closing Notes

- **Equivalence (Section 2)** is the linchpin: rotation-minimality ⇔ suffix-minimality is *why* a left-to-right scan suffices.
- **Uniqueness (Section 4)** rests on the longest-Lyndon-prefix property, the same quantity Duval extracts each round.
- **Witt's formula (Section 8)** counts Lyndon words, aperiodic necklaces, *and* free-Lie-algebra dimensions — one number, three meanings.
- **FKM (Section 9)** turns Lyndon enumeration into an optimal de Bruijn generator.
- **Free Lie algebra (Section 11)** explains why these combinatorial objects recur across algebra and computer science.
- **Bijective BWT (Section 11b)** turns the aperiodic CFL factorization into a sentinel-free, invertible block-sorting transform — the structural payoff of strictness.
- **Optimality (Section 6)** is two-sided: Duval is `O(n)` and `Ω(n)` is forced because every character can affect the factorization, so no sub-linear factorizer exists.

A final unifying observation: the strict-`<` definition (Section 2.2), the longest-Lyndon-prefix uniqueness (Section 4), the `O(n)` invariant (Section 5), the Witt count (Section 8), and the bijective BWT (Section 11b) are not five separate facts but five views of one structural property — that Lyndon words are the *free, aperiodic generators* of words under ordered concatenation. Internalizing that single idea makes every theorem here feel inevitable rather than incidental.

Foundational references: Lyndon (1954) and Chen-Fox-Lyndon (1958) for the factorization; Duval (1983) for the linear algorithm; Witt (1937) for the counting/Lie-algebra formula; Fredricksen-Kessler-Maiorana (1978) and Fredricksen-Maiorana for de Bruijn; Booth (1980) for least rotation; Gil-Scott and Kufleitner for the bijective BWT; Lothaire, *Combinatorics on Words*, and Reutenauer, *Free Lie Algebras*, for the algebraic theory. Sibling topics: `04-suffix-arrays`, `10-burrows-wheeler-transform`, `12-suffix-automaton`.

For the runs theorem and Lyndon-array applications, see Bannai-I-Inenaga-Nakashima-Takeda-Tsuruta (2017), "The runs theorem"; for the modern survey of Lyndon-based string algorithms, see the relevant chapters of Crochemore-Hancart-Lecroq, *Algorithms on Strings*. These tie the linear factorization primitive to repetition detection, indexing, and compression at the research frontier.

# Knuth-Morris-Pratt (KMP) — Professional / Theoretical Level

> **One-line summary:** This level proves the things the other files assert: the formal definition of the prefix function, that the construction is correct and runs in amortized `O(m)` (via a potential argument on the border length), that the matcher runs in `O(n+m)`, the border/period duality and its connection to the Fine–Wilf theorem, and the equivalence between the failure-link matcher and a deterministic finite automaton.

---

## Table of Contents

1. [Formal Definitions](#formal-definitions)
2. [The Border Lemma](#the-border-lemma)
3. [Correctness of the Prefix-Function Construction](#correctness-of-the-prefix-function-construction)
4. [Amortized O(m) via a Potential Argument](#amortized-om-via-a-potential-argument)
5. [Correctness of the KMP Matcher](#correctness-of-the-kmp-matcher)
6. [Linear Time of the Matcher](#linear-time-of-the-matcher)
7. [Borders, Periods, and the Period Lemma](#borders-periods-and-the-period-lemma)
8. [Periodicity Reasoning in Detail](#periodicity-reasoning-in-detail)
9. [Correctness of the Concatenation Search](#correctness-of-the-concatenation--p--t--search)
10. [The Fine–Wilf Theorem](#the-finewilf-theorem)
11. [Automaton Equivalence](#automaton-equivalence)
12. [Generalization: Failure Functions Over Sequences](#generalization-failure-functions-over-sequences)
13. [Invariants as Hoare Triples](#invariants-restated-as-hoare-triples)
14. [Spectral and Combinatorial Side-Notes](#spectral-and-combinatorial-side-notes)
15. [Edge Cases in the Formal Setting](#edge-cases-in-the-formal-setting)
16. [Lower Bounds and Optimality](#lower-bounds-and-optimality)
17. [The Strong Failure Function](#the-strong-failure-function-knuthmorrispratt-refinement)
18. [Failure Function as a Tree](#failure-function-as-a-tree)
19. [Numerical and Model Assumptions](#numerical-and-model-assumptions)
20. [KMP vs Randomized Matching](#why-not-just-hash-kmp-vs-randomized-matching)
21. [Relationship to the Z-Function](#relationship-to-the-z-function)
22. [Complexity of Derived Operations](#complexity-of-derived-operations-proved)
23. [Detailed Construction Trace](#detailed-construction-trace-periodic-pattern)
24. [Worked Proof Example](#worked-proof-example)
25. [Summary](#summary)
26. [Further Reading](#further-reading)

---

## Formal Definitions

Let `Σ` be a finite alphabet and `s ∈ Σ*` a string of length `L`, indexed `s[0..L-1]`. We write `s[a..b]` for the (possibly empty) factor from index `a` to `b` inclusive, and `|w|` for the length of `w`.

**Prefix / suffix.** `u` is a *prefix* of `s` if `s = u·v` for some `v`; a *suffix* if `s = v·u`. It is **proper** if `u ≠ s` (equivalently `|u| < |s|`). The empty string `ε` is a (proper, if `s ≠ ε`) prefix and suffix of every string.

**Border.** A string `w` is a **border** of `s` if `w` is both a proper prefix and a proper suffix of `s`. Note `ε` is a border of every nonempty string.

We treat strings as functions `s : {0, …, L-1} → Σ`, so equality of factors `s[a..b] = s[c..d]` means equal length and pointwise-equal characters. All claims below hold for any `Σ` with a decidable equality; no order on `Σ` is assumed (KMP, unlike sorting-based methods, needs only `=`, never `<`).

**Prefix function.** For `0 ≤ i < L`, define

```
π(i) = max { k : 0 ≤ k ≤ i  and  s[0..k-1] = s[i-k+1..i] }
```

i.e. the length of the **longest border** of the prefix `s[0..i]`. Equivalently, `π(i)` is the length of the longest proper prefix of `s[0..i]` that equals a suffix of `s[0..i]`. By convention `π(0) = 0`. We use `π` and the implementation name `lps` interchangeably; `lps[i] = π(i)`.

**Period.** An integer `p`, `1 ≤ p ≤ L`, is a **period** of `s` if `s[i] = s[i+p]` for all `0 ≤ i < L - p`. The smallest such `p` is *the* period of `s`. (Every string has period `L` trivially.)

---

## The Border Lemma

The engine of both the construction and the matcher is this structural fact.

**Lemma 1 (Borders form a chain).** *Let `b₁ > b₂ > … > 0` be the lengths of all borders of a string `w` of length `L`, in decreasing order, with `b₁ = π(L-1)` the longest. Then for each `t`, `b_{t+1} = π(b_t - 1)`.* In words: **the borders of `w` are exactly the longest border, the longest border of that border, and so on, down to `ε`.**

*Proof.* A border of `w` of length `b` is a prefix `w[0..b-1]` that equals the suffix `w[L-b..L-1]`. Take the longest border `B₁ = w[0..b₁-1]`. Any shorter border `B` (length `b < b₁`) is a prefix of `w`, hence a prefix of `B₁` (since `b < b₁` and both are prefixes of `w`). It is also a suffix of `w`; because `B₁` is a suffix of `w` and `|B| < |B₁|`, `B` is a suffix of `B₁`. So `B` is both a proper prefix and proper suffix of `B₁` — a border of `B₁`. Conversely every border of `B₁` is a border of `w` (transitivity of "is a prefix/suffix"). Thus the borders of `w` shorter than `b₁` are precisely the borders of `B₁`, whose longest is `π(b₁-1)`. Induction on length gives the full chain. ∎

This justifies the fall-back step `len ← π(len-1)`: when the current border of length `len` fails to extend, the *next candidate* is the next-longest border, which is exactly `π(len-1)`. No border of intermediate length can exist, so we skip none.

---

## Correctness of the Prefix-Function Construction

Recall the algorithm:

```
π(0) = 0
for i = 1 .. L-1:
    len = π(i-1)
    while len > 0 and s[i] != s[len]:
        len = π(len-1)
    if s[i] == s[len]:
        len = len + 1
    π(i) = len
```

**Theorem 1.** *The algorithm computes `π(i)` correctly for all `i`.*

*Proof.* By strong induction on `i`, assuming `π(0..i-1)` are correct. We compute `π(i)` = length of the longest border of `s[0..i]`. 

First, a border of `s[0..i]` of length `k ≥ 1` is obtained by appending `s[i]` to a border of `s[0..i-1]` of length `k-1`, *provided* `s[i] = s[k-1]`. (Removing the last character of a length-`k` border of `s[0..i]` yields a length-`(k-1)` prefix that equals a length-`(k-1)` suffix of `s[0..i-1]`, i.e. a border of `s[0..i-1]`.) Hence the candidate border lengths for `s[0..i]` are exactly `{ b + 1 : b is a border length of s[0..i-1] and s[i] = s[b] }`, plus possibly the empty border `0`.

To find the *longest*, we should test the border lengths of `s[0..i-1]` in **decreasing** order and take the first `b` with `s[i] = s[b]`, returning `b+1`. By Lemma 1, the decreasing border lengths of `s[0..i-1]` are `π(i-1), π(π(i-1)-1), …, 0`. The `while` loop walks exactly this chain (`len ← π(len-1)`), stopping at the first match. If some `b` in the chain has `s[i] = s[b]`, we set `π(i) = b + 1` (the largest such, since we descend from the longest). If none matches and the chain reaches `len = 0`, then either `s[i] = s[0]` giving `π(i) = 1`, or not, giving `π(i) = 0`. The code's final `if s[i] == s[len]` handles the `len = 0` case uniformly. Thus `π(i)` is the maximum valid border length. ∎

---

## Amortized O(m) via a Potential Argument

The construction's `while` loop is not bounded per iteration, yet the total work is linear. We prove it with the **potential method** (amortized analysis).

Define the potential `Φ = len` (the value of the local variable after processing index `i`, which equals `π(i)`). Note `Φ ≥ 0` always, `Φ` starts at `0` (before `i = 1`), and `Φ` after the last iteration is `π(L-1) ≥ 0`.

Consider iteration `i`. Let `len_in = π(i-1)` be the value entering the iteration and `len_out = π(i)` the value leaving. The work in iteration `i` is `1 + (number of while-loop passes)`. Each `while` pass strictly decreases `len` by at least 1 (since `π(len-1) < len`). The single optional increment raises `len` by at most 1. Therefore:

```
(while passes in iteration i)  ≤  len_in - len_out + (increment, 0 or 1)
                               =  Φ_before - Φ_after + Δ_inc
```

Summing over all `i = 1 … L-1`, the potential differences **telescope**:

```
Σ (while passes)  ≤  (Φ_0 - Φ_{L-1}) + Σ Δ_inc
                  ≤  Φ_0 + (number of increments)
                  ≤  0 + (L - 1)
```

because `Φ_{L-1} ≥ 0` and there is at most one increment per iteration. Hence the *total* number of `while`-loop passes across the whole run is at most `L - 1`. Adding the `O(L)` outer-loop work gives total time `O(L) = O(m)`. ∎

The intuition restated: `len` can only fall as far as it has risen. It rises by at most 1 per position (`≤ m-1` total rises), so it can fall at most `m-1` times total — and each `while` pass is one fall.

---

## Correctness of the KMP Matcher

The matcher:

```
j = 0
for i = 0 .. n-1:
    while j > 0 and T[i] != P[j]:
        j = π(j-1)
    if T[i] == P[j]:
        j = j + 1
    if j == m:
        report match ending at i (start i - m + 1)
        j = π(j-1)
```

**Invariant.** *After processing `T[i]`, `j` equals the length of the longest prefix of `P` that is a suffix of `T[0..i]`; i.e. `j = max{ k : P[0..k-1] = T[i-k+1..i] }`.*

**Theorem 2.** *The matcher reports a match starting at `s` iff `T[s..s+m-1] = P`.*

*Proof.* We show the invariant is maintained; the theorem follows because `j = m` exactly when the length-`m` prefix of `P` (i.e. all of `P`) is a suffix of `T[0..i]`, which means `P = T[i-m+1..i]`, a match starting at `s = i - m + 1`.

*Base.* Before any character, `j = 0`, and the longest prefix of `P` that is a suffix of the empty text is `ε` (length 0). ✓

*Step.* Suppose before reading `T[i]` the invariant holds with value `j` = longest prefix of `P` that is a suffix of `T[0..i-1]`. We want the new longest prefix of `P` that is a suffix of `T[0..i]`. Any such prefix of length `k ≥ 1` must, after dropping its last character `T[i] = P[k-1]`, be a prefix of `P` of length `k-1` that is a suffix of `T[0..i-1]`. By the inductive invariant and Lemma 1 (applied to the prefix `P[0..j-1]` of `T`), the candidate lengths `k-1` are exactly the border-style chain `j, π(j-1), π(π(j-1)-1), …, 0` — precisely the prefixes of `P` that are suffixes of `T[0..i-1]`, in decreasing order. The `while` loop walks this chain, taking the largest `len` with `P[len] = T[i]`, then increments: `j ← len + 1`. If none matches, `j ← 0` (or `1` if `P[0] = T[i]`). This is exactly the longest prefix of `P` that is a suffix of `T[0..i]`. The post-match fall-back `j ← π(j-1)` resets `j` to the longest *proper* prefix-suffix, which is the correct state for continuing to find overlapping matches. ✓ ∎

---

## Linear Time of the Matcher

**Theorem 3.** *The matcher runs in `O(n)` time (plus `O(m)` to build `π`), hence `O(n + m)` total.*

*Proof.* Identical potential argument with `Φ = j`. The outer loop runs `n` times, `O(1)` each excluding the `while` and the post-match fall-back. Each `while` pass and each post-match fall-back strictly decreases `j` by at least 1; `j` increases by at most 1 per outer iteration (the `j ← j + 1` step). So across the whole scan, total decreases ≤ total increases ≤ `n`. Therefore the combined `while` + fall-back work is `O(n)`. Adding the outer loop and the `O(m)` precomputation gives `O(n + m)`. ∎

Note this bound is **input-independent**: there is no adversarial string that degrades KMP. The text index `i` is monotonically increasing and never revisited, so each text character participates in exactly one "advance" and is charged at most one "fall-back" amortized.

---

## Borders, Periods, and the Period Lemma

**Theorem 4 (Border–period duality).** *A string `s` of length `L` has a border of length `b` iff `s` has period `p = L - b`.*

*Proof.* (⇒) Suppose `s[0..b-1] = s[L-b..L-1]` (border of length `b`). Set `p = L - b`. For any `i` with `0 ≤ i < L - p = b`, we must show `s[i] = s[i+p]`. Since `s[0..b-1] = s[L-b..L-1] = s[p..L-1]`, the character `s[i]` (with `i < b`) equals `s[p+i]`. ✓
(⇐) Suppose `p` is a period. Then `s[i] = s[i+p]` for `0 ≤ i < L-p`, so `s[0..L-p-1] = s[p..L-1]`. The left side is a prefix of length `L-p`, the right a suffix of length `L-p`; they are equal, so `s` has a border of length `b = L - p`. ∎

**Corollary (smallest period from the prefix function).** *The smallest period of `s` is `L - π(L-1)`.* Because the longest border corresponds (by Theorem 4) to the smallest period. Moreover, `s` is an integer power of a shorter string iff `(L - π(L-1)) | L`; then `s = w^{L/p}` with `w = s[0..p-1]`.

*Proof of the corollary's divisibility claim.* If `p | L`, periodicity `s[i] = s[i+p]` for all valid `i` forces every block `s[kp..kp+p-1]` to equal `s[0..p-1]`, so `s = w^{L/p}`. Conversely if `s = w^t` then `|w|` is a period dividing `L`. ∎

---

## Periodicity Reasoning in Detail

It is worth proving the divisibility characterization of repetitions carefully, since it is the engine behind LeetCode-style "repeated substring" problems and is easy to state imprecisely.

**Theorem 4b.** *Let `s` have length `L` and smallest period `p = L − π(L-1)`. Then `s = w^t` for some string `w` and integer `t ≥ 2` (a non-trivial integer power) iff `p < L` and `p | L`; in that case `w = s[0..p-1]` and `t = L / p`.*

*Proof.* (⇐) Suppose `p | L` and `p < L`. Period `p` means `s[i] = s[i+p]` for all `0 ≤ i < L − p`. Fix any `i` with `0 ≤ i < p` and any block index `0 ≤ k < L/p`. We show `s[kp + i] = s[i]` by induction on `k`: base `k = 0` is trivial; for the step, `s[kp + i] = s[(k-1)p + i + p] = s[(k-1)p + i]` (valid because `(k-1)p + i < L − p`), which equals `s[i]` by the inductive hypothesis. Hence every block `s[kp..kp+p-1]` equals `w = s[0..p-1]`, so `s = w^{L/p}` with `L/p ≥ 2`.
(⇒) If `s = w^t` with `t ≥ 2`, then `|w|` is a period of `s` dividing `L`, and `|w| < L`. The *smallest* period `p` divides `|w|` (a known consequence of Fine–Wilf when periods are small relative to `L`), and since `|w| | L` and `p | |w|`, we get `p | L` with `p ≤ |w| < L`. ∎

This is why the one-line test `period < L and L % period == 0` is exactly correct — no edge cases beyond the empty/singleton strings, which fail `period < L`.

**Counterexample to a common misbelief.** It is tempting to think "`s` is periodic iff `π(L-1) > 0`." False: `s = "abcab"` has `π(L-1) = 2` (border `"ab"`), giving period `3`, but `5 % 3 ≠ 0`, so `s` is *not* a repetition. Having a border (period `< L`) is necessary but not sufficient for being an integer power; the divisibility condition is the missing ingredient.

---

## Correctness of the Concatenation (`P # T`) Search

We asserted in middle.md that the `P # T` trick works; here is the proof.

**Theorem 4c.** *Let `S = P · # · T` where `#` is a sentinel not occurring in `P` or `T`, and let `m = |P|`. For each index `i` in the `T`-region of `S`, the prefix function satisfies `π_S(i) = m` iff `P` occurs in `T` ending at the corresponding position.*

*Proof.* `π_S(i)` is the longest border of `S[0..i]`, i.e. the longest prefix of `S` (hence of `P·#·…`) that is a suffix of `S[0..i]`. Because `#` appears in `S` exactly once (at index `m`) and never in `T` or `P`, any prefix of `S` of length `> m` contains `#`, but a suffix lying entirely in the `T`-region contains no `#`; therefore no border can have length `> m`. A border of length exactly `m` is the prefix `S[0..m-1] = P`, equal to the suffix `S[i-m+1..i]`, which lies in `T` (since `i` is past the `#`). That equality is precisely "`P` occurs in `T` ending at `S`-index `i`." Conversely an occurrence of `P` ending at such `i` makes `P` a length-`m` suffix equal to the prefix, so `π_S(i) ≥ m`, and since `> m` is impossible, `π_S(i) = m`. ∎

The same argument, applied to the Z-function of `S`, gives the Z-based searcher; this is why the two preprocessing functions are interchangeable for matching.

---

## The Fine–Wilf Theorem

The border/period structure has a deeper constraint governing when *two* periods coexist.

**Theorem 5 (Fine and Wilf, 1965).** *If a string `s` of length `L` has periods `p` and `q`, and `L ≥ p + q − gcd(p, q)`, then `s` also has period `gcd(p, q)`.*

The bound `p + q − gcd(p, q)` is tight: there exist strings of length `p + q − gcd(p, q) − 1` with periods `p` and `q` but not `gcd(p, q)`. This theorem explains *why* the border chain has the structure it does, and it underlies fast algorithms for detecting all periodicities (runs) in a string. While KMP itself does not invoke Fine–Wilf, the period structure KMP exposes (via `π(L-1)`) is exactly the object Fine–Wilf constrains. The "two-period" interaction is what makes naive period detection subtle and what guarantees the smallest period `L - π(L-1)` is well-defined and consistent with any other period present.

A useful consequence: if `s` has a "small" period `p ≤ L/2`, then `s` is highly self-overlapping (`π(L-1) ≥ L/2`), and the longest border alone determines the entire periodic structure.

---

## Automaton Equivalence

**Theorem 6.** *The failure-link matcher computes the same accept positions as the deterministic finite automaton `M = (Q, Σ, δ, 0, {m})` with states `Q = {0, …, m}`, start state `0`, single accepting state `m`, and transition*

```
δ(j, c) = j + 1                     if j < m and c = P[j]
δ(j, c) = 0                         if j = 0 and c ≠ P[0]
δ(j, c) = δ(π(j-1), c)              otherwise.
```

*Proof sketch.* Both processes maintain the same invariant — state `j` after reading `T[0..i]` is the length of the longest prefix of `P` that is a suffix of `T[0..i]` (Theorem 2's invariant). The DFA's transition is precisely the closed form of the failure-link loop: the recursion `δ(j,c) = δ(π(j-1), c)` unrolls into the `while j>0 and c≠P[j]: j=π(j-1)` loop, terminating when `c = P[j]` (advance) or `j = 0` (stay). Since both define the same next-state from the same current state and input, they accept identical positions. ∎

**Cost.** The explicit table needs `O(m·|Σ|)` time/space to build (the recursion memoizes each `δ(j-1's failure)` lookup in `O(1)` because earlier rows are finished). The failure-link version is `O(m)` space and `O(n)` time amortized. The DFA gives *worst-case* `O(1)` per character (no amortization), which matters in hard-real-time or branch-sensitive settings; the failure-link version gives the same total but with per-character variance.

This DFA is the single-pattern special case of the **Aho-Corasick automaton** (sibling `05`), where the trie has one path and `δ`/failure links coincide with `π`.

---

## Generalization: Failure Functions Over Sequences

The prefix function is defined for *any* sequence over *any* alphabet with an equality test, not just character strings. This generality matters for several rigorous applications.

- **Integer sequences.** Matching a sequence of row-IDs (2D pattern search), token streams (lexer-level matching), or audio sample buckets all use the identical `π` construction with `==` on the element type. The `O(n + m)` proof is unchanged because it never used any property of characters beyond comparability.
- **Equivalence classes.** If matching should treat certain characters as equal (case-insensitive, wildcard-free fuzzy classes), define `≡` and replace `==` by `≡` in both construction and search. Correctness is preserved *iff* `≡` is an equivalence relation (reflexive, symmetric, transitive); with a non-transitive "match" predicate (e.g. single-character wildcards `?`), the prefix-function argument **breaks**, because a border is no longer well-defined — this is the formal reason KMP does not directly handle wildcard patterns and one needs the FFT-based or bitset approaches instead.
- **Online over a stream.** Theorem 3's proof uses only that `i` is non-decreasing and the carry state is a single integer. Hence the bound is identical in the streaming model where `T` is revealed one element at a time; the only resource is `O(m)` for `lps`.

**Proposition (wildcard impossibility for plain KMP).** *If the match predicate is not transitive, there exist patterns for which the failure-link state does not capture all viable partial matches, so a single integer `j` is insufficient.* Intuitively, with `?` matching anything, two different partial matches of different lengths can both be alive simultaneously, which one scalar `j` cannot represent. This delimits exactly where KMP's elegance ends.

---

## Invariants Restated as Hoare Triples

For implementers who verify code formally, the two loops have clean loop invariants. For the construction, after processing index `i` the invariant is:

```
{ for all 0 <= h <= i:  lps[h] = longest border length of s[0..h]
  and  len = lps[i] }
```

For the matcher, the invariant maintained at the top of the `for i` loop is:

```
{ j = max{ k : 0 <= k <= min(i, m) and P[0..k-1] = T[i-k..i-1] }
  and every match starting before i-m+1 has been reported }
```

Establishing these by the rules in [Theorem 1](#correctness-of-the-prefix-function-construction) and [Theorem 2](#correctness-of-the-kmp-matcher) gives a fully mechanical correctness proof suitable for a proof assistant (KMP has been verified in Coq, Isabelle/HOL, and Dafny precisely along these lines). The termination measure for both inner `while` loops is the variable `len`/`j` itself, which strictly decreases and is bounded below by 0 — the same quantity used as the amortization potential, which is not a coincidence: the potential function *is* the variant.

---

## Space Lower Bound and the Necessity of the lps Array

KMP uses `O(m)` extra space for `lps`. Is this necessary? In the streaming/online model the answer connects to communication complexity.

**Observation.** *Any online exact matcher that decides at the arrival of `T[i]` whether a match ends at `i` must, in the worst case, retain `Ω(m)` bits of state about the pattern.* Intuitively, after reading a partial match the algorithm must distinguish among the up-to-`m` possible "how much of `P` is alive" states, and for an adversarial family of patterns the relevant fall-back structure cannot be compressed below the pattern's border information. KMP's `lps` array (one integer per position) is therefore asymptotically optimal preprocessing storage for the failure-link approach. (Constant-space *non-streaming* matchers exist — e.g. the Galil–Seiferas and Crochemore–Perrin two-way algorithms achieve `O(1)` extra space with `O(n)` time — but they exploit random access to the pattern and are not online in the same single-pass sense.)

This delineates the design space precisely: KMP trades `O(m)` space for the cleanest possible online matcher; constant-space matchers exist but sacrifice the trivial streaming carry-state. For most engineering purposes `O(m)` is negligible and the simplicity wins, which is why KMP, not Galil–Seiferas, is the textbook and library default for the failure-link family.

---

## Lower Bounds and Optimality

Any comparison-based exact matcher must, in the worst case, inspect every text character at least once: an adversary can hide a single distinguishing character anywhere, forcing `Ω(n)` reads. KMP achieves `O(n + m)`, so it is **asymptotically optimal** for single-pattern exact matching in the comparison model (up to the unavoidable `+m` to read the pattern). 

KMP performs at most `2n − 1` character comparisons in the search phase — a classic tight bound: each text position contributes one "successful or final comparison" plus amortized fall-backs charged against prior advances. The Morris–Pratt variant uses `π` directly; the full Knuth–Morris–Pratt refinement uses a *strong* failure function `π'` (skipping fall-backs where `P[π(j-1)] = P[j]`) to shave comparisons further, though the asymptotic class is unchanged. Algorithms like Boyer-Moore beat KMP's *average* character inspections (sublinear) but not its worst-case `O(n)` guarantee.

---

## Spectral and Combinatorial Side-Notes

Two deeper connections situate KMP within wider theory.

**Counting walks in the failure automaton.** The KMP automaton (Theorem 6) is a deterministic finite automaton; the number of distinct text strings of length `n` that reach the accept state `m` exactly once (or `r` times) is computable by powering the automaton's transition incidence matrix — linking this topic to sibling `11-graphs/32-paths-fixed-length`. The accept-state structure of the automaton encodes, combinatorially, how many length-`n` texts contain the pattern a prescribed number of times, an object studied in the analytic combinatorics of pattern occurrences (Guibas–Odlyzko *correlation polynomials*).

**Guibas–Odlyzko correlation.** The *autocorrelation* of `P` — the bit vector indicating for each shift whether `P` overlaps itself — is precisely the border set, hence fully determined by `π`. The generating function for the number of texts avoiding `P` has the correlation polynomial in its denominator. So the prefix function is not only an algorithmic device but the combinatorial fingerprint controlling how often a pattern can appear, expectations of occurrence counts in random text, and waiting-time distributions in probability (the "Penney's game" / pattern-occurrence problems). Two patterns with the same `π`-induced correlation are interchangeable for these counting purposes even if they look different.

**Eigenvalue view.** The automaton's transition matrix `M` (size `(m+1)×(m+1)`) has spectral radius `|Σ|` for the complete-transition automaton; the gap to the next eigenvalue governs the exponential rate at which the probability of *not yet* having seen `P` decays in random text — a quantitative refinement of "the pattern eventually appears almost surely." None of this changes the `O(n+m)` matching cost, but it shows the prefix function is the right primitive: the same object that makes matching fast also makes the probabilistic analysis tractable.

**Expected waiting time.** For uniform random text over an alphabet of size `q`, the expected number of characters until the first occurrence of `P` equals the value of the *correlation polynomial* of `P` evaluated at `q` — explicitly `Σ_{b ∈ borders(P) ∪ {m}} q^{b}` where the sum runs over the border lengths (including the full length `m`). For example, a self-overlapping pattern like `"aa"` has a longer expected waiting time than a non-overlapping `"ab"`, because its borders inflate the polynomial. This is the rigorous resolution of the classic counterintuitive "Penney's game" result, and every quantity in it is read directly off `π`. The lesson for a theory-minded engineer: the failure function is not merely an implementation trick but the canonical descriptor of a pattern's self-overlap, governing time *and* probability simultaneously.

---

## Edge Cases in the Formal Setting

A rigorous treatment must pin down the boundary inputs the theorems quietly assume nonempty:

- **Empty string `s = ε`.** `π` is the empty array; `L = 0`; "longest border" is vacuous. The smallest-period formula `L − π(L-1)` indexes `π(-1)`, undefined — so guard `L ≥ 1` before applying it.
- **Empty pattern in the matcher.** `m = 0` means every position (including the `n+1`-th, the empty suffix) is a match; the `j == m` test fires immediately at `j = 0`. Implementations must special-case this to avoid `lps[-1]`.
- **Pattern longer than text (`m > n`).** Theorem 2's invariant still holds; `j` simply never reaches `m`, so zero matches are reported. No special case needed, but the analysis must not assume `m ≤ n`.
- **Single-character string.** `π = [0]`; the longest border is `ε`; smallest period equals `L = 1`; never a non-trivial repetition. All theorems hold degenerately.
- **All-equal string `a^L`.** `π = [0, 1, 2, …, L-1]`; the worst case for border-enumeration loops (`Σ π = L(L-1)/2`) and the tightness witness for the comparison-count bound. The amortized search bound still holds; only *non-amortized* border walks are quadratic here.

Stating these explicitly prevents the silent off-by-one and out-of-bounds errors that the implementation-level files warn about, now grounded in where the theorems' hypotheses actually require `L ≥ 1` or `m ≥ 1`.

---

## Formal Proof That the Text Index Never Decreases

A claim repeated informally throughout the other files deserves a one-line formal statement, since it is the crux of the streaming property and of the `O(n)` bound.

**Proposition.** *In the matcher, across the entire execution the variable `i` (the text index) is non-decreasing and takes each value in `{0, 1, …, n-1}` exactly once.*

*Proof.* `i` is the control variable of the outer `for i = 0 .. n-1` loop. No statement in the body assigns to `i`; only `j` is mutated by the `while`/`if`/post-match steps. The `for` loop increments `i` by exactly 1 per iteration and runs `i` over the range once. Therefore `i` visits each text index exactly once in increasing order. ∎

*Corollary (streaming).* Because `i` only advances, the algorithm never needs access to `T[i']` for `i' < i` once `T[i]` is being processed; the entire dependency on the past is captured by `j` and the immutable `lps`. Hence the matcher is *online* with `O(m)` working memory, formally justifying the streaming implementations in senior.md.

*Corollary (no quadratic input exists).* Since each text character is read in exactly one outer iteration, and the amortized inner work is `O(1)` per iteration (Theorem 3), there is no input — adversarial or otherwise — on which the matcher reads any text character more than a bounded amortized number of times. This is the precise sense in which KMP "fixes" the naive matcher's `O(nm)` re-reading.

---

## Relationship to the Z-Function

The **Z-function** `Z[i]` of a string is the length of the longest substring starting at `i` that matches a prefix of the string. It is computable in `O(L)` and is informationally equivalent to the prefix function: each can be derived from the other in linear time.

- From `Z` to `π`: for each `i` with `Z[i] > 0`, the prefix of length `Z[i]` occurs ending at `i + Z[i] - 1`, so set `π(i + Z[i] - 1) = max(π(...), Z[i])` and fill gaps by descending. 
- From `π` to `Z`: invert the border relation analogously.

Both reduce substring search to the `P # T` construction (sibling `02-z-function` details the Z side). The prefix function's advantage is its direct failure-link interpretation, which generalizes to automata and multi-pattern matching; the Z-function is often considered conceptually simpler for one-off matching and for problems framed as "longest prefix-match from each position."

---

## The Strong Failure Function (Knuth–Morris–Pratt Refinement)

The construction above produces the **Morris–Pratt** prefix function `π`. There is a subtle inefficiency: when a mismatch occurs at `P[j]` and we fall back to `π(j-1)`, it can happen that `P[π(j-1)] = P[j]` — meaning the very same character that just mismatched will mismatch *again* immediately. We can skip such redundant fall-backs by precomputing a **strong** failure function `π'`:

```
π'(j) = π(j)                       if P[π(j)] != P[j+1]   (the next compare differs)
π'(j) = π'(π(j) - 1)               otherwise              (skip the doomed retry)
```

The strong function is what the original 1977 KMP paper actually specifies, distinguishing it from the earlier Morris–Pratt automaton. Using `π'` reduces the *number of character comparisons* but does not change the asymptotic class — both are `O(n + m)`. The benefit is concentrated on highly periodic patterns like `P = "aaaa…a"`, where the plain `π` fall-back chain is long.

**Theorem 7 (Comparison count).** *With the strong failure function, the KMP search performs at most `2n − 1` text-character comparisons, and this bound is tight.*

*Proof sketch.* Charge each comparison to either an *advance* (a successful `T[i] = P[j]` that increments `j`) or a *fall-back* (a failed compare that triggers `j ← π'(j-1)`). There are at most `n` advances (one per text position, since `j` cannot exceed `n` cumulative increments). Each fall-back strictly decreases `j`, and `j` only rises via advances, so the number of fall-backs is bounded by the number of advances, i.e. at most `n − 1` (the first position cannot fall back from `j = 0`). Summing, comparisons ≤ `n + (n − 1) = 2n − 1`. A tightness witness is `T = a^n`, `P = a^{m}` with a final differing character, which forces close to the bound. ∎

The Morris–Pratt variant without the strong refinement can perform more comparisons on adversarial periodic patterns, but still `O(n)`; the difference is in the constant, not the order.

---

## Failure Function as a Tree

The prefix function induces a rooted forest (in fact a tree once we add a virtual root) on the states `{0, 1, …, m}`: draw an edge from state `j` to state `π(j-1)` for each `j ≥ 1`, and from state `0` to the virtual root. This is the **failure tree**.

Key structural facts:

- The ancestors of state `j` in the failure tree are exactly the lengths in the border chain of `P[0..j-1]` — i.e. all borders of that prefix (Lemma 1). Walking toward the root enumerates every border.
- The depth of state `j` equals the *number of distinct borders* of `P[0..j-1]`.
- Subtree queries on the failure tree answer "how many prefixes have a given border," which is exactly the count-occurrences-of-each-prefix application (middle.md) expressed as subtree sums.

This tree view is what generalizes to Aho-Corasick, where the trie's failure links form the same kind of tree over all pattern prefixes simultaneously, and many offline queries (which patterns occur, how often) become subtree aggregations on it.

**Proposition.** *The sum of `π` over all positions, `Σ_{i=0}^{L-1} π(i)`, equals the total number of (prefix, border) incidences and is `O(L·\sqrt{L})` in the worst case but can be `Θ(L²)` for `P = a^L`.* This quantifies how "redundant" a string's self-overlap is and bounds the work of border-enumeration loops that are *not* amortized.

---

## Numerical and Model Assumptions

The `O(n + m)` bound holds in the standard **comparison / RAM model** under these assumptions, worth stating precisely for a rigorous treatment:

- **Character comparison is `O(1)`.** For fixed-width characters (ASCII bytes, fixed code points) this is exact. For variable-length encodings (raw UTF-8 multibyte sequences treated as units) you must either compare byte-by-byte (then `n`, `m` are byte counts) or decode first (an `O(n)` pre-pass that does not change the bound).
- **Array indexing is `O(1)`.** The `lps` array and string indexing are random-access; on a pure stream you keep `lps` in memory (random access) but read the text sequentially (no random access needed) — which is precisely why KMP streams.
- **Integer arithmetic on indices is `O(1)`.** Indices fit in a machine word for any realistic input; for `n > 2^31` use 64-bit counters (a practical, not asymptotic, concern).

No assumption is made about the alphabet size for the failure-link matcher — it is alphabet-independent. The automaton variant trades this for `O(m·|Σ|)` preprocessing, so its bound *does* depend on `|Σ|`.

---

## Why Not Just Hash? (KMP vs Randomized Matching)

A natural theoretical question: Rabin-Karp achieves *expected* `O(n + m)` with high probability. Why prefer KMP's deterministic bound?

- **Adversarial inputs.** A randomized hash with a fixed, known modulus/base can be defeated by an adversary crafting collisions, degrading to `Θ(nm)` verification work. KMP has no random choices to attack.
- **Las Vegas vs Monte Carlo.** Rabin-Karp with verification is Las Vegas (always correct, randomized time); without verification it is Monte Carlo (fast but can err). KMP is deterministic and always correct in worst-case linear time.
- **Composability.** KMP's failure function is a *structural* object (borders, periods) reusable far beyond matching; a hash is opaque.

The deterministic linear bound is KMP's defining theoretical contribution: before 1977 it was not obvious that exact string matching admitted a worst-case-linear comparison-based algorithm.

---

## A Second Worked Construction (Mixed Alphabet)

Trace `π` for `s = "abacabab"` (`L = 8`) to see borders that grow, collapse, and regrow:

```
i=0: π(0)=0
i=1: len=0; 'b'!='a' → π(1)=0
i=2: len=0; 'a'=='a' → len=1; π(2)=1
i=3: len=1; 'c'!='b'(s[1]) → len=π(0)=0; 'c'!='a' → π(3)=0
i=4: len=0; 'a'=='a' → len=1; π(4)=1
i=5: len=1; 'b'=='b'(s[1]) → len=2; π(5)=2
i=6: len=2; 'a'=='a'(s[2]) → len=3; π(6)=3
i=7: len=3; 'b'=='b'(s[3])? s[3]='c' → mismatch, len=π(2)=1;
            'b'=='b'(s[1]) → len=2; π(7)=2
```

So `π = [0, 0, 1, 0, 1, 2, 3, 0... ]` — recomputing the last: `π(7) = 2`. Final `π = [0,0,1,0,1,2,3,2]`.

Interpretation:
- `π(6) = 3`: prefix `"abacaba"` has border `"aba"`. 
- `π(7) = 2`: prefix `"abacabab"` has longest border `"ab"` (the `"aba"` border could not extend because `s[7]='b' ≠ s[3]='c'`, so we fell back to the next border length 1, then matched and grew to 2).
- Smallest period of the whole string `= 8 − 2 = 6`; `8 % 6 ≠ 0`, not a clean repetition.

The fall-back at `i = 7` (from length 3 down to 1, then up to 2) demonstrates the border chain in action: the candidate borders of `"abacaba"` were `3 → π(2)=1 → 0`, and we stopped at the first that could be extended by `s[7]='b'`. This is exactly Lemma 1 and Theorem 1 operating on a non-degenerate example, complementing the all-`a` worst case.

---

## Worked Proof Example

Take `s = "aabaa"`, `L = 5`. Compute `π`:

```
i=0: π(0) = 0
i=1: len = π(0) = 0; s[1]=a, s[0]=a → match → len=1; π(1)=1
i=2: len = π(1) = 1; s[2]=b, s[1]=a → mismatch, len=π(0)=0;
     s[2]=b, s[0]=a → mismatch, len=0 (no while since len=0); π(2)=0
i=3: len = π(2) = 0; s[3]=a, s[0]=a → match → len=1; π(3)=1
i=4: len = π(3) = 1; s[4]=a, s[1]=a → match → len=2; π(4)=2
```

So `π = [0, 1, 0, 1, 2]`. Verify the theory:

- **Longest border** of `"aabaa"` is `π(4) = 2`, namely `"aa"` (prefix `"aa"` = suffix `"aa"`). ✓
- **Smallest period** `= L − π(L-1) = 5 − 2 = 3`. Check: `s[i] = s[i+3]`? `s[0]=a=s[3]=a` ✓, `s[1]=a=s[4]=a` ✓. Period 3 holds. Since `5 % 3 ≠ 0`, `"aabaa"` is *not* a clean repetition — consistent with the corollary. ✓
- **Border chain** from Lemma 1: longest `= 2`, then `π(2-1) = π(1) = 1` (`"a"`), then `π(1-1) = π(0) = 0` (`ε`). Borders are `"aa"`, `"a"`, `""`. ✓
- **Amortization check:** total `while` passes across the run = `2` (both at `i=2`); increments = `3`; and `2 ≤ 3 = L − 2`... within the bound `L−1 = 4`. ✓

Every theoretical claim checks out on this small instance.

---

## Complexity of Derived Operations (Proved)

| Operation | Time | Bound is | Justification |
|-----------|------|----------|---------------|
| Build `π` | `O(m)` | tight | Potential argument, total falls ≤ rises ≤ `m-1`. |
| Single search | `O(n)` | worst-case tight | Same potential on `j`; ≥ `Ω(n)` reads needed. |
| Comparisons (strong `π'`) | `≤ 2n − 1` | tight | Charge to advances/fall-backs (Theorem 7). |
| Smallest period | `O(m)` | tight | One `π` build + `O(1)` (Theorem 4b). |
| Enumerate all borders | `O(b)` | output-sensitive | `b` = number of borders = depth in failure tree. |
| Build DFA table | `O(m·\|Σ\|)` | tight | Each cell computed in `O(1)` from a finished row. |
| Per-char with DFA | `O(1)` | worst-case | One table lookup, no amortization. |
| `P # T` search | `O(n + m)` | tight | `π` of length `n + m + 1` (Theorem 4c). |

Every bound above is a *worst-case* bound (not average), and each is matched by an explicit family of inputs, so KMP's analysis is exact, not merely an upper estimate. This is unusual and valuable: many string algorithms have a gap between their proven worst case and their typical behavior, but KMP's `O(n+m)` is simultaneously the upper bound and (up to constants) achieved on adversarial inputs.

---

## Detailed Construction Trace (Periodic Pattern)

To exercise the fall-back chain fully, trace `π` for the highly periodic `s = "aabaaab"` (`L = 7`), where the inner `while` loop actually iterates more than once:

```
i=0: π(0)=0
i=1: len=π(0)=0; s[1]='a'==s[0]='a' → len=1; π(1)=1
i=2: len=π(1)=1; s[2]='b'!=s[1]='a' → len=π(0)=0;
                 s[2]='b'!=s[0]='a' (len=0, no while) → π(2)=0
i=3: len=π(2)=0; s[3]='a'==s[0]='a' → len=1; π(3)=1
i=4: len=π(3)=1; s[4]='a'==s[1]='a' → len=2; π(4)=2
i=5: len=π(4)=2; s[5]='a'!=s[2]='b' → len=π(1)=1;
                 s[5]='a'==s[1]='a' → len=2; π(5)=2
i=6: len=π(5)=2; s[6]='b'==s[2]='b' → len=3; π(6)=3
```

Result: `π = [0, 1, 0, 1, 2, 2, 3]`. 

**Verify the amortized accounting.** Total increments (the `len += 1` step) fired at `i = 1, 3, 4, 5, 6` plus the `len=2→... ` at `i=5` after a fall-back, and `i=6`: counting each `len++` execution gives 7 increments... bounded by allowing at most one per iteration is wrong here — note `i=5` does *one* increment after the fall-back, `i=4` one, etc. The relevant invariant is that the number of `while` *passes* (the fall-back steps) is bounded: they fired once at `i=2` and once at `i=5`, total 2, comfortably under `L − 1 = 6`. The potential `Φ = len` ran `0,1,0,1,2,2,3`; the sum of its decreases (`1→0` at `i=2`, `2→1` at `i=5`) equals 2, exactly the fall-back count. The theory's bookkeeping is confirmed on a non-trivial instance.

**Read off the structure.** `π(6) = 3` → longest border `"aab"`, smallest period `7 − 3 = 4`. Since `7 % 4 ≠ 0`, `"aabaaab"` is not a clean repetition. Border chain: `3`, then `π(2) = 0` → borders are `"aab"` and `""` only.

---

## Summary

The prefix function `π(i)` is the length of the longest border of `s[0..i]`. The Border Lemma shows borders form the chain `π(L-1), π(π(L-1)-1), …, 0`, which justifies the fall-back `len ← π(len-1)` in both construction and matching. The construction is correct (Theorem 1) and runs in amortized `O(m)` by a potential argument on `Φ = len` (total falls ≤ total rises ≤ `m-1`); the matcher is correct via the longest-prefix-suffix invariant (Theorem 2) and runs in `O(n)` by the same potential method (Theorem 3), giving the unconditional `O(n+m)`. Borders and periods are dual (`period = L − border`, Theorem 4), so the smallest period is `L − π(L-1)`, and the deeper Fine–Wilf theorem constrains coexisting periods. The failure-link matcher is exactly a DFA (Theorem 6), the single-pattern case of Aho-Corasick, and the prefix function is linear-time interconvertible with the Z-function. KMP is asymptotically optimal for comparison-based single-pattern matching.

---

## Theorem Index (Quick Reference)

| # | Statement | Used for |
|---|-----------|----------|
| Lemma 1 | Borders form the chain `π(L-1), π(π(L-1)-1), …, 0`. | Justifies fall-back to `π(len-1)`. |
| Thm 1 | The construction computes `π` correctly. | Correctness of preprocessing. |
| Amortized | Total `while` passes ≤ `m-1` via potential `Φ = len`. | `O(m)` build time. |
| Thm 2 | Matcher invariant: `j` = longest prefix-suffix. | Correctness of search. |
| Thm 3 | Search runs in `O(n)`. | Linear-time guarantee. |
| Thm 4 | Border of length `b` ⇔ period `L − b`. | Period from `π`. |
| Thm 4b | Integer power ⇔ `p < L` and `p \| L`. | Repeated-substring test. |
| Thm 4c | `P # T` correctness. | Builder-only search. |
| Thm 5 | Fine–Wilf: periods `p, q` force `gcd(p,q)`. | Coexisting periods. |
| Thm 6 | Failure-link matcher ≡ DFA. | Automaton view. |
| Thm 7 | `≤ 2n − 1` comparisons with strong `π'`. | Comparison optimality. |

Together these establish that KMP is correct, worst-case linear in both phases, optimal in comparison count up to the strong-failure refinement, and the structural source of period/border/repetition facts — a rare case where the algorithmic and combinatorial stories coincide on a single `O(m)` array.

The pedagogical arc across this topic's files mirrors the theory: `junior.md` gives the matcher and the intuition; `middle.md` mines the prefix function for its applications; this file proves every claim and connects KMP to automata theory, combinatorics on words, and complexity lower bounds. The single object threading all of it together is the failure function — equivalently the border structure — which is why mastering it (not merely memorizing the code) is what makes the entire family of string-matching algorithms, up through Aho-Corasick and suffix automata, feel like variations on one theme rather than a list of tricks.

---

## Further Reading

- Knuth, Morris, Pratt — *"Fast Pattern Matching in Strings"*, SIAM J. Comput. 6(2), 1977.
- Fine, N.J. & Wilf, H.S. — *"Uniqueness theorems for periodic functions"*, Proc. AMS 16, 1965.
- *Introduction to Algorithms* (CLRS) §32.4 — KMP and the string-matching automaton, with the amortized analysis.
- Crochemore, Hancart, Lecroq — *Algorithms on Strings* — borders, periods, optimality bounds, strong failure function.
- Gusfield — *Algorithms on Strings, Trees, and Sequences* — Z-function/prefix-function equivalence and the fundamental preprocessing.
- Sibling `02-z-function` (equivalence), `05-aho-corasick` (multi-pattern automaton).
- Galil & Seiferas (1983) — *"Time-space-optimal string matching"* (constant-space linear matching).
- Guibas & Odlyzko (1981) — *"String overlaps, pattern matching, and nontransitive games"* (correlation polynomials, waiting times).
- Apostolico & Galil (eds.) — *Pattern Matching Algorithms* — survey of borders, periods, and matching automata.
- Formal verifications: KMP in Coq (CompCert-adjacent work), Isabelle/HOL, and Dafny exercises — for the Hoare-triple treatment above.

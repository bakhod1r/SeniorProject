# The Z-Function — Mathematical Foundations and Correctness

## Table of Contents
1. Formal Definitions
2. The Z-Box Invariant
3. Correctness of the Case Analysis (Copy vs Extend)
4. Linear-Time Bound via the Amortized r-Pointer
5. Correctness of Pattern Matching via Concatenation
6. Borders, Periods, and the Fine/Wilf Connection
7. The Prefix Function: Definition and Equivalence to Z
8. Z → Prefix Function: Construction and Proof
9. Prefix Function → Z: Construction and Proof
10. Distinct-Substring Counting via Z
11. Lower Bounds and Optimality
12. Summary

---

## 1. Formal Definitions

Let `s = s[0] s[1] … s[n-1]` be a string of length `n` over an alphabet `Σ` whose symbols admit equality testing. Indices are `0`-based.

**Definition 1.1 (Prefix, suffix).** The prefix of length `m` is `s[0..m-1]`; the suffix starting at `i` is `s[i..n-1]`, denoted `s_i`.

**Definition 1.2 (Longest common prefix).** For two strings `x, y`, `lcp(x, y)` is the largest `L` with `x[0..L-1] = y[0..L-1]` (and `L ≤ min(|x|, |y|)`).

**Notation conventions.** Throughout, `n = |s|` is the length, `Σ` the alphabet, `[l, r)` the half-open Z-box (so `r` is *exclusive*, one past the last verified index), `k = i - l` the mirror index, `m` the pattern length, `nt` the text length, `#` a separator symbol outside `Σ`, and `π` the KMP prefix function. The Iverson bracket `[P]` is `1` when predicate `P` holds and `0` otherwise. "Border" always means a *proper* prefix-and-suffix (length `< n`); "period" follows Definition 1.6. We write `s_i` for the suffix `s[i..n-1]`. All arrays are `0`-indexed.

**Definition 1.3 (Z-function).** The Z-function of `s` is the array `z[0..n-1]` with

```
z[i] = lcp(s, s_i) = max { L : s[0..L-1] = s[i..i+L-1] }   for i ≥ 1,
```

and by convention `z[0] = 0`. Equivalently, `z[i]` is the length of the longest substring starting at `i` that equals a prefix of `s`.

**Convention on `z[0]`.** Setting `z[0] = 0` is deliberate. The "true" longest common prefix of `s` with itself is `n`, but recording `n` at index `0` is rarely useful and complicates downstream predicates (e.g. "is there a *proper* border" or "does the pattern occur" would have to special-case index `0`). All theorems below are stated for `i ≥ 1`; `z[0]` is a sentinel whose value is fixed by convention and never read by the core recurrence. Texts that prefer `z[0] = n` obtain identical results for every `i ≥ 1`.

**Definition 1.4 (Z-box).** During the standard computation we maintain integers `l, r` (with `r` *exclusive*) satisfying the invariant of Section 2. The interval `[l, r)` is the **Z-box**: a verified occurrence of a prefix, i.e. `s[l..r-1] = s[0..r-l-1]`. We always keep the box with the **largest `r`** discovered so far.

**Definition 1.5 (Border).** A string `w` is a **border** of `s` if `w` is both a proper prefix and a proper suffix of `s` (so `|w| < n`). The border length set is `B(s) = { b : 0 ≤ b < n, s[0..b-1] = s[n-b..n-1] }`.

**Definition 1.6 (Period).** An integer `p`, `1 ≤ p ≤ n`, is a **period** of `s` if `s[i] = s[i+p]` for all `0 ≤ i < n - p`. The smallest period is `per(s)`.

**Definition 1.7 (Prefix function).** The prefix function `π[0..n-1]` (Knuth-Morris-Pratt, sibling `01-kmp`) is `π[i] = ` the length of the longest proper border of the prefix `s[0..i]`. Equivalently `π[i] = max { k : 0 ≤ k ≤ i, s[0..k-1] = s[i-k+1..i] }`, with `π[0] = 0`.

**Remark.** The Z-function looks *forward* (suffix vs prefix at each start position); the prefix function looks *backward* (longest border ending at each position). Sections 7–9 prove they encode the same information and convert in `O(n)`.

### 1.1 Worked Definition Example

For `s = "ababaa"` (length `6`):

```
index : 0 1 2 3 4 5
char  : a b a b a a
z     : 0 0 3 0 1 1
```

- `z[2] = 3`: the suffix `"abaa"` ... wait, the suffix at `2` is `"abaa"`; `lcp("ababaa", "abaa") = "aba"` has length `3` (then prefix char `s[3]='b'` ≠ suffix char `s[5]='a'`).
- `z[4] = 1`: suffix `"aa"`, `lcp("ababaa","aa") = "a"`, length `1`.
- `z[5] = 1`: suffix `"a"`, matches prefix `"a"`, length `1` (and the string ends).

Each `z[i]` is computed purely against the *prefix* `s[0..]` — never against another suffix. This forward, prefix-anchored definition is what distinguishes the Z-function from suffix-array LCP, which compares *adjacent suffixes* and can relate arbitrary substrings.

---

## 2. The Z-Box Invariant

The computation processes `i = 1, 2, …, n-1` and maintains `[l, r)`.

**Invariant 2.1.** At the start of iteration `i`, the box satisfies

```
(I1)  l ≤ i,  and  s[l..r-1] = s[0..r-l-1]      (the box is a verified prefix occurrence),
(I2)  r is the maximum over all j < i of  j + z[j]   (the box has the largest right reach so far),
(I3)  r ≥ 1  once any positive z has been found (initially l = r = 0).
```

**Lemma 2.2 (Box correctness after update).** If at iteration `i` we compute `z[i]` correctly and then set `l ← i, r ← i + z[i]` whenever `i + z[i] > r`, the invariant is preserved for iteration `i+1`.

**Proof.** (I1): by definition of `z[i]`, `s[i..i+z[i]-1] = s[0..z[i]-1]`, so the new `[i, i+z[i])` is a verified prefix occurrence. (I2): we update only when `i + z[i] > r`, and `i + z[i]` is the right reach of position `i`; since the old `r` was the max over `j < i`, the new `r = max(old r, i + z[i])` is the max over `j ≤ i`. (I3) is immediate. ∎

The invariant (I1) is the entire reason the *copy* step is valid: it guarantees the box content equals a prefix, so the mirror index `i - l` indexes the same prefix character.

### 2.1 Worked Invariant Trace

Take `s = "aabaab"`. We track `(l, r)` and verify (I1) at each box update:

- `i = 1`: extend `s[0]='a'=s[1]='a'`, then `s[1]='a' ≠ s[2]='b'` → `z[1] = 1`. Update box to `[1, 2)`. Check (I1): `s[1..1] = "a" = s[0..0]`. ✓
- `i = 3`: `3 ≥ r = 2`, extend from scratch: `a=a, a=a, b=b`, end → `z[3] = 3`. Update box to `[3, 6)`. Check (I1): `s[3..5] = "aab" = s[0..2]`. ✓
- `i = 4`: `4 < r = 6`, mirror `k = 4 − 3 = 1`, copy `min(r − i, z[1]) = min(2, 1) = 1`. The extend loop tries `s[1]='a' ≠ s[5]='b'`? actually `s[1]='a'`, `s[4+1]=s[5]='b'` → mismatch, so `z[4] = 1`. `i + z = 5 < r = 6`, box stays `[3,6)`. ✓ (no spurious invariant break since we did not update.)

At every update the new box `[i, i+z[i])` is, by definition of `z[i]`, a verified prefix occurrence — Lemma 2.2 in action.

---

## 3. Correctness of the Case Analysis (Copy vs Extend)

We prove the value `z[i]` produced by the standard loop equals `lcp(s, s_i)`. Two cases, by whether `i < r`.

**Case B (`i ≥ r`): compare from scratch.** No box information applies. The loop sets `z[i] = 0` then increments while `s[z[i]] = s[i + z[i]]` and `i + z[i] < n`. It stops at the first mismatch or end of string, which is exactly `lcp(s, s_i)` by Definition 1.3. Correct by definition.

**Case A (`i < r`): copy, clamped, then extend.** Let `k = i - l` be the **mirror index** inside the prefix. By Invariant (I1), `s[i..r-1] = s[k..r-l-1] = s[k..(r-i)+k-1]`, i.e. the box content at `i` mirrors prefix characters starting at `k`. Define `c = r - i` (characters of the box remaining from `i`). We split on `z[k]` vs `c`.

**Subcase A1 (`z[k] < c`): the mirror match ends strictly inside the box.** We claim `z[i] = z[k]`.

*Proof.* Because `s[i..r-1]` mirrors `s[0..c-1]` (a prefix segment), and `z[k] < c`, the entire matched run of length `z[k]` at position `k` lies within the mirrored region, hence occurs identically at `i`: `s[i..i+z[k]-1] = s[0..z[k]-1]`, so `z[i] ≥ z[k]`. For the reverse, the character that *broke* the match at `k` — namely `s[k + z[k]] ≠ s[z[k]]` — also lies within the box (since `k + z[k] < k + c = r - l + (i-l) `... more directly `i + z[k] < i + c = r`), so the corresponding character at `i` is `s[i + z[k]] = s[k + z[k]] ≠ s[z[k]]`. Thus the match at `i` cannot exceed `z[k]`. Therefore `z[i] = z[k]`, and no explicit comparison is needed. ∎

**Subcase A2 (`z[k] ≥ c`): the mirror match reaches the box edge.** We claim `z[i] ≥ c`, and the value beyond `c` must be determined by explicit comparison.

*Proof.* Since `z[k] ≥ c`, the prefix matches `s[k..k+c-1] = s[0..c-1]`, and by mirroring `s[i..r-1] = s[0..c-1]`, so `z[i] ≥ c = r - i`. Beyond the box edge `r`, the characters `s[r], s[r+1], …` have **not** been verified to equal the prefix at position `i` (the box only certifies up to `r-1`). The mirror gives no information past `r` because `k + c = r - l < ` the verified region only up to the box. Hence we *must* compare `s[c], s[c+1], …` against `s[i+c], s[i+c+1], …` explicitly. The loop does exactly this, starting `z[i] = c = r - i` and extending while characters match. The result is `lcp(s, s_i)` by construction. ∎

The two subcases are merged in code as `z[i] = min(z[k], r - i)` followed unconditionally by the extend loop; in A1 the extend loop performs **one** comparison that immediately fails (correctly), and in A2 it does the genuine extension. (Some implementations special-case A1 to skip even that one comparison; both are correct, and the amortized bound below is unaffected.)

To restate the clamp's role formally: the value `r − i` is the number of *verified* characters remaining in the box from position `i`, and `z[i − l]` is the mirror's full match length. We may safely assert a match of length `min(z[i − l], r − i)` and not one character more without a real comparison, because (a) up to `r − i` the box invariant certifies the characters, and (b) `z[i − l]` certifies them via the mirror. The minimum is the largest length on which *both* certificates agree; beyond it at least one certificate lapses and we must verify by comparison. This is the precise information-theoretic content of the `min`-clamp, and the reason a wrong clamp polarity (e.g. `r − i + 1`) is not a cosmetic slip but reads one *uncertified* character, breaking Theorem 3.1.

**Theorem 3.1 (Pointwise correctness).** For every `i`, the loop computes `z[i] = lcp(s, s_i)`.

**Proof.** Immediate from Cases A1, A2, B, each shown to produce `lcp(s, s_i)`, together with Invariant 2.1 (which guarantees the box premises hold). ∎

### 3.1 Worked Case-Analysis Example

On `s = "aaabaab"` we exhibit all three subcases:

```
index : 0 1 2 3 4 5 6
char  : a a a b a a b
z     : 0 2 1 0 2 1 0
```

- `i = 1` (Case B, `1 ≥ r = 0`): extend `a=a, a=a, a≠b` → `z[1] = 2`, box `[1, 3)`.
- `i = 2` (Case A, `2 < r = 3`): mirror `k = 1`, `z[k] = 2`, `c = r − i = 1`. Since `z[k] = 2 ≥ c = 1` this is **Subcase A2**: copy to the edge `z[2] = 1`, then extend `s[1]='a' ≠ s[3]='b'` → stays `1`.
- `i = 5` (Case A, `5 < r = 6` after the box moved to `[4,6)` at `i=4`): mirror `k = 1`, `z[k] = 2`, `c = 1`, again **A2**: `z[5] = 1`, extend `s[1]='a' ≠ s[6]='b'` → `1`.

To see **Subcase A1** (copy stays strictly inside, no extension), consider `s = "aaaab"` at `i = 2`: box is `[1, 4)` after `i = 1` (which extends to `z[1]=3`), mirror `k = 1`, `z[k] = 3`, `c = r − i = 2`. Here we would clamp to `min(3, 2) = 2`... that is A2. A genuine A1 requires `z[k] < c`: e.g. `s = "aabaaabaab"`-style strings where a short inner match sits well within a long box; in such a case `z[i] = z[k]` is final with the single failing comparison, never extending past the edge. The merged-code formulation handles A1 and A2 uniformly via the `min`-clamp followed by the (possibly no-op) extend loop.

---

## 4. Linear-Time Bound via the Amortized r-Pointer

The remarkable fact is that the total work is `O(n)` despite individual `z[i]` possibly requiring many comparisons.

**Lemma 4.1 (`r` is non-decreasing).** Across the whole run, `r` never decreases.

**Proof.** `r` changes only in the update `r ← i + z[i]`, performed exclusively when `i + z[i] > r`. Hence every assignment strictly increases `r`. ∎

**Lemma 4.2 (`r` is bounded).** At all times `r ≤ n`.

**Proof.** `r = i + z[i]` and `z[i] = lcp(s, s_i) ≤ n - i`, so `r ≤ i + (n - i) = n`. ∎

Together these two facts — monotone and bounded — are the entire content of the linear-time guarantee; the next theorem turns them into the comparison count.

**Theorem 4.3 (Linear time).** The total number of character comparisons over the entire computation is at most `2n`, so the algorithm runs in `O(n)` time.

**Proof.** Classify each comparison `s[a] = s[b]` (with `b = i + z[i]`, `a = z[i]`) as **successful** (characters equal, `z[i]` incremented) or **failing** (characters differ, the extend loop stops).

*Successful comparisons.* A successful comparison occurs only in the extend loop, and the extend loop runs only when `i + z[i]` reaches beyond the current right reach being established for the new box — concretely, each successful comparison increases `i + z[i]` by one, and after the iteration we set `r ← i + z[i]` (when it exceeds the old `r`). Crucially, every successful comparison happens at a position `i + z[i] ≥ r_{old}` (we only ever extend at or past the box edge), and it advances the quantity `r` by one. Because `r` is non-decreasing (Lemma 4.1) and bounded by `n` (Lemma 4.2), and starts at `0`, the number of times `r` advances — hence the number of successful comparisons across *all* iterations — is at most `n`.

More carefully: in Case A1 there are no successful comparisons (the single comparison fails). In Case A2 and Case B, the extend loop begins at offset `r - i` (resp. `0`), and every successful step moves `i + z[i]` from its current value (≥ `r_{old}`) one unit rightward, ultimately setting the new `r` to that larger value. Thus each successful comparison is "charged" to a distinct unit of increase of `r`. Since `r` increases monotonically from `0` to at most `n`, there are at most `n` successful comparisons total.

*Failing comparisons.* Each iteration `i` performs **at most one** failing comparison: the extend loop terminates at its first mismatch (or at the end of string, which costs no comparison), and Case A1's lone comparison fails once. With `n` iterations, at most `n` failing comparisons.

Summing: at most `n + n = 2n` comparisons, plus `O(1)` bookkeeping per iteration. Total `O(n)`. ∎

**Subtlety: the charge is to `r`, not to `i`.** A common incorrect "proof" claims each `z[i]` is small, which is false — `z[1]` alone can be `n − 1`. The correct accounting charges each successful comparison to the *advance of `r`*, a quantity shared across all iterations and bounded once by `n`. This is why the amortized view is essential: per-iteration cost is unbounded, but the aggregate is linear. The discipline of "never compare below `r`" (extend only at or past the box edge) is exactly what guarantees that each success is a fresh advance of `r`, never a recomparison of already-verified territory.

**Corollary 4.4.** The Z-function uses `O(n)` time and `O(n)` extra space (the output array). The space is optimal since the output itself has size `n`.

**Empirical anchor.** On `s = a^n`, instrument a comparison counter: the box version performs exactly `n` successful comparisons (all during `i = 1`, which extends `r` to `n`) plus at most one failing comparison per later position, total `< 2n`, while the naive version performs `Θ(n²)` (Section 4.2). Logging this counter and asserting it stays `≤ 2n` across random inputs is the most direct runtime certificate that the linear bound holds — and a regression test that catches the "extend from `0`" bug, which would inflate the count quadratically on repetitive inputs.

The key structural insight, worth stating plainly: **the extend loop only ever compares characters at positions ≥ `r`, and each successful comparison pushes `r` forward by one; `r` only moves forward and is capped at `n`, so the total extension work is at most `n`.** This is the "box reuse / amortization" argument.

### 4.1 A Potential-Function Phrasing

The amortized argument can be stated with a **potential function** `Φ = r` (the current right edge). Define the amortized cost of iteration `i` as `actual_i + ΔΦ_i`, where `actual_i` is the number of comparisons it performs and `ΔΦ_i = r_after − r_before`. Each *successful* comparison in iteration `i` raises `r` by one upon the box update, so the `c_succ` successful comparisons are exactly paid for by `ΔΦ = c_succ` (they cost nothing amortized). Each iteration additionally performs at most one *failing* comparison, contributing `O(1)` amortized. Since `Φ = r` starts at `0`, ends at `≤ n`, and is monotone non-decreasing (Lemma 4.1), the telescoped total potential change is `≤ n`. Summing amortized costs: total comparisons `= Σ actual_i ≤ Σ (1) + (Φ_final − Φ_initial) ≤ n + n = 2n`. This is the same `2n` bound (Theorem 4.3) recast in the standard accounting/potential framework — useful when grading the algorithm against a textbook amortized-analysis rubric.

### 4.2 Why the Naive Algorithm Is Θ(n²) in the Worst Case

For the lower bound on the *naive* method (no box reuse), take `s = aⁿ` (the all-`a` string). Then `lcp(s, s_i) = n − i` for every `i`, so the naive inner loop performs `n − i` successful comparisons plus one boundary check at position `i`. Summing, `Σ_{i=1}^{n-1} (n − i) = Σ_{j=1}^{n-1} j = (n−1)n/2 = Θ(n²)` comparisons. The box version on the same input performs `Θ(n)` comparisons because position `i = 1` extends to set `r = n` once, and every later position copies (`z[i] = z[i−l]` clamped) with no extension — a stark, provable separation between the two methods on this adversarial family.

---

## 5. Correctness of Pattern Matching via Concatenation

Let `p` (length `m`) and `t` (length `nt`), and a separator symbol `# ∉ Σ_p ∪ Σ_t` (it occurs in neither). Form `s = p · # · t`, of length `N = m + 1 + nt`. Compute `z` on `s`.

**On the choice of `#`.** The proof requires only that `#` differs from every character of both `p` and `t`; it need not be a single fixed symbol. In an integer-array encoding (sibling discussion in `senior.md`), a sentinel value outside the data's range serves identically, and the theorem's proof goes through verbatim with `#` reinterpreted as "a symbol unequal to all data symbols". This is why the integer-sentinel matcher is provably correct, not merely a heuristic substitute for a character separator.

**Why the pattern region is ignored.** We scan only `i ≥ m + 1`. The indices `1 ≤ i ≤ m − 1` lie inside the pattern copy; their Z-values measure self-overlaps of `p` (which are the borders of `p`, useful for KMP-style preprocessing but not for locating `p` in `t`). Index `m` is the separator, with `z[m] = 0`. So restricting the occurrence scan to the text region is not an arbitrary choice but the exact set of positions where `s_i` begins in `t`. The pattern-region Z-values are not wasted, though: they *are* the Z-array of `p`, which is precisely the preprocessing the separator-free streaming matcher reuses — the concatenation computes pattern self-overlaps and text matches in one pass.

**Theorem 5.1.** For an index `i` in the text region (`m + 1 ≤ i < N`), `z[i] = m` **iff** `p` occurs in `t` at text position `i - (m + 1)`. Moreover `z[i] ≤ m` always holds for such `i`.

**Proof.** *(`z[i] ≤ m` bound.)* `z[i] = lcp(s, s_i)`. The prefix of `s` is `p · # · …`; its `(m)`-th character (index `m`) is `#`. The suffix `s_i` lies entirely in the text region, whose characters are all in `Σ_t`, and `# ∉ Σ_t`. So `s[m] = #` can never equal `s[i + m]` (a text character), forcing the common prefix to break by index `m`: `z[i] ≤ m`.

*(`⇐`.)* If `p` occurs at text position `q = i - (m+1)`, then `t[q..q+m-1] = p[0..m-1] = s[0..m-1]`, and these text characters are `s[i..i+m-1]`. Hence `s[0..m-1] = s[i..i+m-1]`, so `z[i] ≥ m`. Combined with `z[i] ≤ m`, we get `z[i] = m`.

*(`⇒`.)* If `z[i] = m`, then `s[0..m-1] = s[i..i+m-1]`, i.e. `p = s[i..i+m-1] = t[q..q+m-1]` with `q = i - (m+1)`. So `p` occurs at `q`. ∎

**Corollary 5.2.** The set of occurrence positions of `p` in `t` is `{ i - (m+1) : m+1 ≤ i < N, z[i] = m }`, computable in `O(N) = O(m + nt)` time after the single Z-pass.

### 5.1 Worked Matching Example

Let `p = "ab"`, `t = "ababa"`, separator `#`. Then `s = "ab#ababa"` (length `N = 8`), and the Z-array is:

```
index : 0 1 2 3 4 5 6 7
char  : a b # a b a b a
z     : 0 0 0 2 0 2 0 1
```

The pattern length is `m = 2`. Scanning the text region (`i ≥ m + 1 = 3`): `z[3] = 2 = m` → occurrence at `3 − 3 = 0`; `z[5] = 2 = m` → occurrence at `5 − 3 = 2`. Indeed `t[0..1] = "ab"` and `t[2..3] = "ab"`, and the matches overlap-adjacent correctly. Note `z[7] = 1 < m` is *not* an occurrence — the partial overlap `"a"` at the end is correctly rejected by the strict `z[i] = m` test. The separator forced `z[3] ≤ 2` (it could not extend into matching the prefix's third character `#`), making the `= m` certificate exact (Theorem 5.1).

### 5.2 The Sentinel-Free Variant Preserves Correctness

The streaming algorithm of [`senior.md`](./senior.md) avoids materializing `s` but computes the *same* Z-values for the text region. Formally, it maintains the identical box invariant (Section 2) over a virtual concatenation in which position `m` is treated as a character `#` that mismatches everything; since no real comparison ever reads index `m` as a match (the cap `z[i] ≤ m` is enforced by `break` when `z[i] = m`), the computed occurrence set is identical to Corollary 5.2. Thus the memory optimization is *correctness-preserving*: it changes the data layout, not the mathematical object computed.

### 5.3 Counting vs Reporting Occurrences

Corollary 5.2 gives both the *count* and the *positions*. If only the count is needed, no list need be stored: a single integer accumulator incremented on each `z[i] = m` suffices, reducing auxiliary space to `O(1)` beyond the Z-array. If positions are needed but the matches are dense (up to `Θ(nt)` of them, e.g. `p = "a"` in `t = "aaa…a"`), the output itself is `Θ(nt)` and that is unavoidable — `Ω(#occurrences)` is a trivial output lower bound. The algorithm is therefore *output-sensitive optimal*: `O(m + nt + #occ)` to report, `O(m + nt)` to count. This distinction matters in production where a regex-style "does it match" call should not pay to materialize a match list it will discard.

### 5.4 Overlapping Matches Are Handled Natively

A frequent source of bugs in ad-hoc matchers is *overlapping* occurrences. The Z-matcher reports them correctly with no special handling: each text position `q` is tested independently via `z[q + m + 1] = m`, so `p = "aa"` in `t = "aaaa"` yields positions `0, 1, 2` (overlapping by one). This is a direct consequence of Theorem 5.1 quantifying over *every* text index, not stepping by `m`. Algorithms that advance the scan pointer by `m` after a match (a common optimization for non-overlapping search) would miss `1` and `2`; the Z-matcher's per-index test is overlap-correct by construction.

**Remark (necessity of the separator).** Without `#`, `s = p · t` and a common-prefix run could begin at a text index and continue across the (now nonexistent) boundary into… still text, but the cap `z[i] ≤ m` would fail: a text run matching the prefix could exceed `m` if `t` itself begins like `p` and continues matching `p`'s continuation in `t`, conflating "prefix of `p`" with "prefix of `p` extended into `t`". The separator restores the hard cap `z[i] ≤ m`, making `z[i] = m` an exact occurrence certificate.

**Concrete failure without the separator.** Let `p = "aa"` and `t = "aaa"`. With the separator, `s = "aa#aaa"`, `z = [0,1,0,2,2,1]`, and the text-region values `z[3] = 2, z[4] = 2` correctly report matches at text positions `0` and `1` (and `z[5] = 1 < m` is correctly not a match). Without the separator, `s = "aaaaa"` has `z = [0,4,3,2,1]`: now `z[1] = 4 > m = 2`, and a naive "`z[i] ≥ m`" test would over-count and, worse, the index arithmetic `i − (m+1)` no longer points into a clean text region — the pattern/text boundary has dissolved. This worked failure is the rigorous justification for the separator's necessity, not merely a stylistic preference.

---

## 6. Borders, Periods, and the Fine/Wilf Connection

**Theorem 6.1 (Borders from Z).** `b ∈ B(s)` (a border of length `b`, `1 ≤ b < n`) **iff** `z[n - b] = b`.

**Proof.** A border of length `b` means the suffix of length `b` equals the prefix of length `b`: `s[n-b..n-1] = s[0..b-1]`. The suffix of length `b` starts at index `i = n - b` and runs to the end, so `lcp(s, s_i) = b` exactly captures "the suffix at `n-b` matches the prefix for all its `b` remaining characters". Thus `z[n-b] = b` iff `s[n-b..n-1] = s[0..b-1]`, i.e. iff `b` is a border length. ∎

**Theorem 6.2 (Period–border duality).** `p` is a period of `s` iff `n - p` is a border length (or `p = n`, the trivial period). Hence `per(s) = n - max(B(s) ∪ {0})`.

**Proof.** `p` is a period iff `s[i] = s[i+p]` for all `0 ≤ i < n-p`, which is equivalent to `s[0..n-p-1] = s[p..n-1]`, i.e. the prefix of length `n-p` equals the suffix of length `n-p` — a border of length `n - p`. The smallest period corresponds to the longest border. ∎

**Corollary 6.3 (Smallest period scan via Z).** `per(s)` is the smallest `i ≥ 1` such that `i + z[i] = n` (the suffix at `i` reaches the end while matching the prefix, giving border length `z[i] = n - i`, hence period `i`); if no such `i < n` exists, `per(s) = n`. If additionally `i | n` and `z[i] = n - i`, then `s` is exactly `n/i` copies of its length-`i` prefix.

**Proof of the tiling claim.** Suppose `i | n` and `z[i] = n − i`, so `s[i..n-1] = s[0..n-i-1]`, i.e. `s` has period `i`. Period `i` means `s[j] = s[j mod i]` for all `j` (by induction: `s[j] = s[j − i]` whenever `j ≥ i`). Therefore `s` is determined by its first `i` characters repeated, and since `i | n` the repetition tiles exactly into `n/i` copies with no partial cell. Conversely if `s` is `k` copies of a length-`i` cell with `ki = n`, then `s[i..n-1] = s[0..n-i-1]` so `z[i] ≥ n − i`, and equality holds because the string ends. ∎

This is the formal basis for the compressibility test of [`senior.md`](./senior.md) (`z[p] + p == n` with `p | n`): it certifies *exact* tiling, distinct from the weaker "has period `p`" (which holds even when `p ∤ n`, as the `"abacaba"` example below shows).

**Connection to Fine and Wilf.** The Fine–Wilf theorem states that if `p` and `q` are both periods of `s` and `p + q - gcd(p,q) ≤ n`, then `gcd(p, q)` is also a period. The Z-array exposes the full period structure (via all `i` with `i + z[i] = n`), and Fine–Wilf constrains how these periods interact — foundational for the analysis of repetitions and the runs theorem. This is the same border/period theory that drives the KMP failure function (sibling `01-kmp`).

### 6.0 Periodicity Implies the Border Structure

**Lemma 6.0.** `s` has period `p` iff for every `i ≥ p`, `s[i] = s[i − p]`, iff the prefix `s[0..n-p-1]` equals the suffix `s[p..n-1]` (a border of length `n − p`).

**Proof.** The first equivalence is the definition unrolled. For the second: "`s[i] = s[i − p]` for all `i ≥ p`" says the substring obtained by deleting the last `p` characters equals the substring obtained by deleting the first `p` characters, i.e. `s[0..n-p-1] = s[p..n-1]`, which is precisely a border of length `n − p` (the length-`(n-p)` prefix equals the length-`(n-p)` suffix). ∎

This lemma is the rigorous hinge of period–border duality (Theorem 6.2): every statement about periods translates to one about borders and vice versa, and the Z-array — which detects borders via `i + z[i] = n` — therefore detects all periods. The smallest period corresponds to the *longest* proper border, recovered as `n − max{ z[i] : i + z[i] = n }`.

### 6.1 The Border Chain Is Nested

**Lemma 6.4 (Borders nest).** If `u` and `v` are both borders of `s` with `|u| > |v|`, then `v` is a border of `u`.

**Proof.** `v` is a suffix of `s` of length `|v|`; since `u` is a prefix of `s` of length `|u| > |v|`, the last `|v|` characters of `u` are `s[|u|-|v| .. |u|-1]`. Because `s` has period `n − |u|` ... more directly: `v` being a border of `s` makes `v` both a prefix of `s` (hence a prefix of the prefix `u`) and a suffix of `s`. One shows the suffix-of-`s` of length `|v|` coincides with the suffix-of-`u` of length `|v|` using that `u` is a prefix and the overlap structure; hence `v` is both a prefix and suffix of `u`, i.e. a border of `u`. ∎

**Corollary 6.5 (The chain `π, π², π³, …`).** The set of all border lengths of `s` is exactly the chain obtained by iterating the prefix function: `π[n-1], π[π[n-1]-1], …, 0`. Equivalently it is `{ n − i : i + z[i] = n }`. Both descriptions yield the *same* set, which is the constructive heart of the Z ↔ π equivalence applied to borders. The nesting (Lemma 6.4) is why this chain is well-defined and strictly decreasing.

**Proof that the two descriptions coincide.** From the KMP side, `b` is a border of `s` iff `b` appears in the iterated chain starting at `π[n-1]` (this is the standard characterization: the borders of `s` are exactly `π[n-1]`, the border of *that* border `π[π[n-1]-1]`, and so on down to `0`). From the Z side (Theorem 6.1), `b` is a border iff `z[n-b] = b`, i.e. iff the index `i = n - b` satisfies `i + z[i] = n`. Setting `b = n - i` shows the two sets `{b : b in chain}` and `{n - i : i + z[i] = n}` are identical. The equality of these two independently-derived sets is, concretely, the border-level shadow of the full array equivalence (Theorem 11.3): the same combinatorial object surfaced two different ways. ∎

### 6.2 Worked Border/Period Example

Take `s = "abacaba"` (length `7`). Its Z-array is:

```
index : 0 1 2 3 4 5 6
char  : a b a c a b a
z     : 0 0 1 0 3 0 1
```

Borders are the `i` with `i + z[i] = 7`: `i = 4` (`4 + 3 = 7`, border length `z[4] = 3`, namely `"aba"`) and `i = 6` (`6 + 1 = 7`, border length `1`, namely `"a"`). So the border lengths are `{3, 1}`, nested (Lemma 6.4: `"a"` is a border of `"aba"`). The smallest period is `n − max border = 7 − 3 = 4`, and indeed `s` has period `4` (`s[i] = s[i+4]` where defined) but does *not* tile exactly since `4 ∤ 7` — a reminder that "period" and "exact tiling period" differ when the period does not divide `n`.

---

## 7. The Prefix Function: Definition and Equivalence to Z

Recall (Definition 1.7) `π[i]` is the longest proper border of `s[0..i]`. We establish the information-equivalence of `z` and `π`.

**Proposition 7.1 (Both encode the prefix-repetition structure).** From `z` one can reconstruct `π`, and from `π` one can reconstruct `z`, each in `O(n)` time and without re-reading `s`.

The intuition: `z[i] = L` asserts a prefix block `s[0..L-1]` reappears starting at `i`, which simultaneously means each position `i, i+1, …, i+L-1` has a border ending there of length `1, 2, …, L` (at least). The prefix function records, at each position, the *longest* such border. Sections 8 and 9 give explicit constructions and proofs.

A worked instance: for `s = "aabaab"`, `z[3] = 3` (the block `"aab"` reappears at index 3). By Lemma 7.2 (below), positions `3, 4, 5` then have borders of length `1, 2, 3` respectively — exactly `π[3] = 1, π[4] = 2, π[5] = 3`. Conversely `π[5] = 3` means a border `"aab"` ends at index 5, so by Lemma 7.3 the match starts at `5 - 3 + 1 = 3`, recovering `z[3] = 3`. The two views are inverse readings of the same equality `s[0..2] = s[3..5]`.

**Lemma 7.2 (Border from a Z-block).** If `z[i] = L > 0`, then for every `0 ≤ j < L`, the prefix `s[0..i+j]` has a border of length `j + 1`. Consequently `π[i + j] ≥ j + 1`.

**Proof.** `z[i] = L` means `s[0..L-1] = s[i..i+L-1]`. Fix `j < L`. Then `s[0..j] = s[i..i+j]`, i.e. the prefix of `s[0..i+j]` of length `j+1` equals its suffix of length `j+1`. That is a border of length `j+1` of the prefix ending at `i+j`. Hence `π[i+j] ≥ j+1`. ∎

**Lemma 7.3 (Z from a border).** If `π[i] = L > 0`, then `s[i-L+1..i] = s[0..L-1]`, so the suffix starting at `i - L + 1` matches the prefix for at least `L` characters: `z[i - L + 1] ≥ L`.

**Proof.** By definition of `π`, the prefix of `s[0..i]` of length `L` equals its suffix of length `L`: `s[0..L-1] = s[i-L+1..i]`. Reading this as "the substring starting at `i-L+1` equals the prefix for `L` characters" gives `z[i-L+1] ≥ L`. ∎

These two lemmas are the engines of the two conversions.

### 7.1 Information Content: A Bijection Argument

**Proposition 7.4.** The map `s ↦ z(s)` and the map `s ↦ π(s)` have the same fibers over equality-typed alphabets: two strings `s, s'` of equal length satisfy `z(s) = z(s')` **iff** `π(s) = π(s')`.

**Proof.** Both `z` and `π` are functions of the *equality pattern* of `s` (which positions hold equal characters), not of the concrete symbols — relabeling the alphabet bijectively leaves both arrays unchanged. The constructions of Sections 8–9 give bijective, mutually inverse maps `Φ: z ↦ π` and `Ψ: π ↦ z` on the image sets, so `z(s) = z(s') ⟺ Φ(z(s)) = Φ(z(s')) ⟺ π(s) = π(s')`. Hence the two arrays distinguish exactly the same pairs of strings: they carry identical information about prefix structure. ∎

This is the rigorous sense in which "Z and the prefix function are equivalent": not merely that one computes the other, but that they induce the *same partition* of strings. The choice between them is therefore purely operational (streaming vs concatenation, clarity), never about expressive power.

---

## 8. Z → Prefix Function: Construction and Proof

**Construction.** For `i = 1 … n-1`, for `j = z[i] - 1 down to 0`: if `π[i + j]` is already set (`> 0`), stop (a longer block already covered these); else set `π[i + j] = j + 1`.

```
ZtoPi(z):                                   # n = len(z)
  pi[0..n-1] := 0
  for i = 1 .. n-1:
    j = z[i] - 1
    while j >= 0 and pi[i + j] == 0:
      pi[i + j] = j + 1
      j = j - 1
  return pi
```

**Why the inner loop walks downward.** We set `π[i+j]` for `j = z[i]-1, z[i]-2, …, 0` (descending) so that the *largest* offsets — those for positions furthest right in the block — are written first. Because a later (smaller-`i`, longer-block) assignment might already have claimed a position with a *larger* border, the descending order combined with the "stop at an already-set cell" rule guarantees we never overwrite a longer border with a shorter one. Walking upward would require an explicit `max`, complicating the early-stop; the downward walk makes the monotonicity automatic. This is a small but instructive design choice: the loop direction encodes the nesting of borders (Lemma 6.4) directly into the control flow.

**Theorem 8.1 (Correctness).** `ZtoPi(z)` returns the prefix function `π` of `s`.

**Proof.** *Lower bound (`π[m] ≥ ` computed value).* By Lemma 7.2, whenever we set `pi[i+j] = j+1` it is because `z[i] > j`, certifying a genuine border of length `j+1` at position `i+j`; so the assigned value never overstates: `π[i+j] ≥ j+1` is true, and we record `j+1`.

*Upper bound / maximality.* We must show the recorded value is the *longest* border. Suppose position `m` has longest border length `L^* = π[m]`. By Lemma 7.3 applied at `m`, `z[m - L^* + 1] ≥ L^*`, so when `i = m - L^* + 1` is processed, its block of length `z[i] ≥ L^*` covers offset `j = L^* - 1` (since `i + j = m`), and would set `pi[m] = L^* `unless already set to something `≥ L^*`. It cannot be set to anything *larger* than `L^*`, because a larger recorded value would assert (by the lower bound just shown) a border longer than `π[m]`, contradicting maximality. Hence `pi[m] = L^*`.

*The `while` early-stop preserves correctness.* When we hit an already-set `pi[i+j]`, all smaller offsets `j' < j` at this `i` correspond to positions `i + j' < i + j` that were necessarily set by an *earlier, longer* block reaching at least as far right — because borders are nested (the set of border lengths of a prefix is itself the chain `π, π∘π, …`). Thus stopping does not miss any larger value. The total work is `O(n)` because each `pi[·]` is assigned at most once (we stop at the first already-set cell), so the inner loop's total iterations across all `i` is `O(n)`. ∎

**Amortized linearity, made precise.** Let `A` be the total number of inner-loop *assignments* and `S` the total number of *early stops*. Each assignment writes a distinct `pi[·]` cell exactly once (a written cell is never rewritten, since a written cell triggers the `break`), so `A ≤ n`. Each `i` triggers at most one early stop, so `S ≤ n`. Every inner-loop iteration is either an assignment or the single stopping check, hence total inner iterations `≤ A + S ≤ 2n`. Adding the `O(n)` outer loop gives `O(n)` overall — the same amortized "each cell touched once" accounting that underlies the Z-box itself, reappearing in its conversion.

**Worked Z→π micro-trace.** For `s = "abcab"`, `z = [0,0,0,2,0]`. Only `i = 3` has `z[3] = 2 > 0`: walk `j = 1` → `pi[4] = 2`, `j = 0` → `pi[3] = 1`. All other `pi` stay `0`. Result `pi = [0,0,0,1,2]`, which is exactly the prefix function of `"abcab"` (longest border of `"abca"` is `"a"` → `1`, of `"abcab"` is `"ab"` → `2`). The two non-zero borders both came from the single Z-block at `i = 3`, illustrating how one block populates a contiguous run of `π` values.

---

## 9. Prefix Function → Z: Construction and Proof

**Construction (the standard linear method).**

```
PiToZ(pi):                                  # n = len(pi)
  z[0..n-1] := 0
  for i = 1 .. n-1:
    if pi[i] > 0:
      z[i - pi[i] + 1] = max(z[i - pi[i] + 1], pi[i])
  # propagate: a long block at position p also gives shorter overlaps to its right
  for i = 1 .. n-1:
    # extend reach inside an already-known block
    if z[i] > 0:
      for j = 1 .. z[i]-1:
        if z[i + j] > 0: break
        z[i + j] = min(z[i] - j, ... )       # see careful version below
  return z
```

The robust `O(n)` version sets, for each `i`, only the *start* of the maximal block and then performs a single forward sweep:

```
PiToZ(pi):
  z := array of 0, length n
  for i = 1 .. n-1:
    if pi[i] > 0:
      start = i - pi[i] + 1
      z[start] = max(z[start], pi[i])
  z[0] = 0
  # forward propagation of partial overlaps
  i = 1
  while i < n:
    if z[i] > 0:
      for j = 1 .. z[i]-1:
        if i + j < n and z[i + j] >= z[i] - j: break
        if i + j < n: z[i + j] = z[i] - j
      i += z[i]            # skip the covered block
    else:
      i += 1
  return z
```

**Theorem 9.1 (Correctness).** `PiToZ(pi)` returns the Z-array `z` of `s`.

**Proof.** *Seeding step (lower bound).* For each `i` with `π[i] = L > 0`, Lemma 7.3 gives `z[i - L + 1] ≥ L`. The first loop records `z[start] = max(…, L)` at `start = i - L + 1`, so after it, `z[start]` is at least the largest border length whose suffix ends at any `i` and whose corresponding match starts at `start`. We claim this max equals the true `z[start]`. Indeed, `z[start] = L'` means `s[0..L'-1] = s[start..start+L'-1]`, so the prefix of `s[0..start+L'-1]` has a border of length `L'`, giving `π[start + L' - 1] ≥ L'`; thus the index `i = start + L' - 1` contributes `L'` to `z[start]` in the seeding loop. Hence the seeded value reaches the true `z[start]`.

*Propagation step.* If `z[i] = L`, then `s[0..L-1] = s[i..i+L-1]`, so for each `0 < j < L`, `s[0..L-j-1] = s[i+j..i+L-1]`, giving `z[i+j] ≥ L - j`. The propagation writes exactly `z[i+j] = L - j` when no larger value is already present, mirroring the standard Z-box copy (`min`/clamp) logic. The `break` when `z[i+j] ≥ L - j` stops once an equal-or-larger (already-correct) value is in place, exactly as the Z-box copy stops at the box edge.

*Maximality.* No value is ever overstated: every assignment corresponds to a substring equality proven by Lemmas 7.2–7.3, and the propagation only writes the clamped `L - j`, which is a valid lower bound that cannot exceed the true `z[i+j]` (because the block guarantees at least that overlap, and any longer overlap would have produced a larger seed). The `max`/`break` guards ensure we keep the true maximum.

*Linearity.* The `i += z[i]` skip ensures each index is touched `O(1)` amortized times: the propagation interior of a block is visited once, then `i` jumps past it. Total `O(n)`. ∎

**Remark.** Both conversions operate purely on the index arrays, never re-reading `s`, which is precisely what makes "the two functions carry the same information" a precise, constructive statement rather than a slogan.

### 9.1 Worked Conversion Example

Take `s = "aabaab"` (length `6`). Direct computation gives:

```
index : 0 1 2 3 4 5
char  : a a b a a b
z     : 0 1 0 3 1 0
pi    : 0 1 0 1 2 3
```

**Z → π (Section 8).** Process `i = 3` first: `z[3] = 3`, so walk `j = 2, 1, 0` setting `π[3+2]=3, π[3+1]=2, π[3+0]=1` → `π[5]=3, π[4]=2, π[3]=1`. Then `i = 1` with `z[1] = 1` sets `π[1] = 1`. Position `i = 4` has `z[4] = 1`, would set `π[4]=1`, but `π[4]` is already `2 > 1`, so the `while` stops immediately (the nesting guarantee, Lemma 6.4). The result `π = [0,1,0,1,2,3]` matches the direct prefix function. ✓

**π → Z (Section 9).** Seeding: `π[1]=1` seeds `z[1-1+1]=z[1]=max(0,1)=1`; `π[3]=1` seeds `z[3]=1`; `π[4]=2` seeds `z[4-2+1]=z[3]=max(1,2)=2`; `π[5]=3` seeds `z[5-3+1]=z[3]=max(2,3)=3`. After seeding, `z[3]=3, z[1]=1`. Propagation from `i=3` (block length 3) sets `z[4]=z[3]-1=2`? — but the *true* `z[4]=1`, so the propagation must clamp via the `break` once it meets the already-correct seeded reach. The robust version's `break` when `z[i+j] ≥ z[i] − j` prevents overwriting the genuine seeded value, recovering `z = [0,1,0,3,1,0]`. This example shows why the seeding+clamped-propagation discipline (not naive propagation) is required for correctness. ✓

### 9.2 An Independent O(n) Route via the Box

A second linear `π → z` method *does* re-read `s` but is conceptually simpler: reconstruct nothing — instead run the standard Z-box algorithm but use `π` only to seed a faster start. In practice the array-only conversions above are preferred precisely because they avoid touching `s`; the existence of two independent constructions is itself evidence of the deep equivalence (Theorem 11.3) rather than a coincidence of one clever trick.

### 9.3 Numerical Robustness of the Conversions

Because both conversions manipulate only small non-negative integers (array indices bounded by `n`), they are immune to the overflow and rounding concerns that plague numeric algorithms — there is no arithmetic beyond `i ± j`, `max`, and comparisons, all exact in any integer type wide enough to hold `n`. The only practical caution is the index type: for `n` near `2^31` use 64-bit indices (mirroring the `int32` boundary discussion of `senior.md`). This makes the conversions exceptionally safe to deploy: a verified implementation cannot silently produce a subtly-wrong array the way a floating-point routine might. Combined with the property tests of Section 11 and the entrywise oracle of `senior.md`, the conversions are among the easiest string-algorithm components to certify correct.

---

## 10. Distinct-Substring Counting via Z

**Setup.** Let `D(s)` be the number of distinct non-empty substrings of `s`. Build `s` one character at a time; let `w` be the current string and `w' = c · w` be the string with a new character `c` *prepended* (a common formulation prepends so suffixes become prefixes of the reversed view; equivalently one appends and reverses).

**Theorem 10.1.** When extending `w` to `w' = w · c` (length `L`), the number of *new* distinct substrings equals `L - maxZ`, where `maxZ` is the maximum value of the Z-array of the reversed new string `reverse(w')`.

**Proof sketch.** Every new distinct substring of `w'` is a substring **ending** at the new last character `c` (otherwise it already existed in `w`). The substrings ending at the last position are exactly the suffixes of `w'`, of which there are `L`. A suffix of `w'` is *not* new iff it already occurs elsewhere in `w'` — equivalently, iff it matches a prefix of `reverse(w')` somewhere, which the Z-array of `reverse(w')` detects: the longest such repeated suffix has length `maxZ`. The `maxZ` suffixes that already appear earlier are the non-new ones; the remaining `L - maxZ` are genuinely new. Summing over all `L` from `1` to `n` gives `D(s) = Σ (L - maxZ_L)`, an `O(n²)` algorithm. ∎

**Complexity.** `O(n²)` total (one `O(L)` Z-pass per extension). Suffix automata / suffix arrays (siblings `12`, `04`) achieve `O(n)` / `O(n log n)`, but the Z-based count is the simplest to state and to verify against a brute-force set of substrings, making it the reference implementation for testing the faster structures.

### 10.1 Worked Distinct-Substring Example

Take `s = "aab"`. Build by prepending so suffixes map to prefixes of the reversed growing view:

- After `"a"` (length 1): reversed-Z max `maxZ = 0`; new = `1 − 0 = 1`. Total `1` (`"a"`).
- After `"aa"` (length 2): the reversed string `"aa"` has Z `[0,1]`, `maxZ = 1`; new = `2 − 1 = 1`. Total `2` (added `"aa"`; the second `"a"` is not new).
- After `"aab"` (length 3): the relevant reversed view has `maxZ = 0` (the new tail `"b"` shares nothing with the prefix); new = `3 − 0 = 3`. Total `5`.

The distinct substrings of `"aab"` are `{"a", "b", "aa", "ab", "aab"}` — exactly `5`, matching the running total. The subtracted `maxZ` is precisely the count of suffixes that already occur, which are therefore not new. This hand trace is the canonical correctness check one runs before trusting an `O(n)` suffix-automaton implementation of the same count.

### 10.2 Relation to the Suffix-Based Formula

The classical closed form `D(s) = Σ_v (n − sa[v] − lcp[v])` over a suffix array `sa` with its `lcp` array (sibling `04-suffix-arrays`) computes the same `D(s)` in `O(n log n)`. Theorem 10.1's incremental Z method and the suffix-array formula must agree on every input; using one to test the other is a standard cross-validation. The Z method's `O(n²)` cost is acceptable for `n` up to a few thousand and is the most transparent to audit, which is exactly why it remains valuable as an oracle even though it is asymptotically dominated.

---

## 10.3 Counting Repetitions and the Runs Theorem (Pointer)

The Z-array (and its mirror, the Z-array of the reversed string) is a building block in computing **runs** (maximal periodicities) of a string. The *runs theorem* (Bannai et al. 2017) states a string of length `n` has fewer than `n` runs, computable in `O(n)`. While the optimal runs algorithm uses suffix structures and Lempel–Ziv factorization, the Z-array supplies the per-position "how far does the prefix extend here" primitive that several `O(n log n)` repetition-finders rely on. Concretely, to test whether a candidate period `p` induces a run covering position `i`, one queries the longest matching extension in both directions — a forward Z-query on `s` and a forward Z-query on `reverse(s)`. This is the bridge from the elementary Z-function to the theory of string repetitions, and it is why mastering the Z-box pays off well beyond simple matching.

## 10.4 Z on the Reversed String: The "Z-suffix" Mirror

Define `zr[i]` as the Z-array of `reverse(s)`; equivalently it measures the longest **suffix** of `s` that matches the substring *ending* at a position. Many two-sided problems (palindrome substrings — sibling `11-manacher-algorithm`, runs above, certain border problems) need both `z(s)` and `z(reverse(s))`. Computing both is still `O(n)` total, and the pair gives, for any cut point, the longest prefix-match to the right and the longest suffix-match to the left — a complete local repetition picture. This mirror trick is the standard way the elementary Z-function participates in richer string algorithms without needing a full suffix structure.

**Worked mirror example.** For `s = "aabaa"`, `reverse(s) = "aabaa"` (it is a palindrome), so `z(s) = z(reverse(s)) = [0,1,0,2,1]`. The fact that the two arrays coincide is a *necessary* condition for `s` to be a palindrome (it is not sufficient alone, but combined with a length/center check it certifies palindromicity). For the non-palindrome `s = "aabab"`, `reverse(s) = "babaa"` gives different Z-arrays (`[0,1,0,2,0]` vs `[0,0,1,0,1]`), immediately exposing the asymmetry. This pairing is the elementary route to palindrome detection before one reaches the dedicated linear algorithm of sibling `11-manacher-algorithm`.

**A two-sided application: longest border that is also a palindrome.** Combining `z(s)` (which enumerates border lengths via `i + z[i] = n`) with `zr` (which certifies which of those borders read the same backwards) yields, in `O(n)`, the longest palindromic border — a building block in several competitive-programming problems. The point is methodological: the single Z primitive, applied to `s` and to `reverse(s)`, already reaches a surprising distance into string combinatorics without invoking suffix trees or automata.

---

## 11. Lower Bounds and Optimality

**Theorem 11.0 (Decision-problem lower bound).** Even deciding the single bit "does `s` have a proper border" requires `Ω(n)` comparisons in the worst case.

**Proof.** Consider strings of the form `a^{n-1} c` versus `a^{n-1} a = a^n`. The first has no proper border ending in `c` matching the prefix `a`... more carefully, distinguish `a^n` (which has every border length `1..n-1`) from `a^{n-1}b` (which has *no* proper border, since the last character differs from the first). Any algorithm that does not read the last character cannot tell these apart, and by an adversary argument it can be forced to read `Ω(n)` characters to certify the answer. Hence even the simplest Z-derived predicate is `Ω(n)`. ∎

**Theorem 11.1 (Output-size lower bound).** Any algorithm that outputs the full Z-array must use `Ω(n)` time and space, since the array has `n` entries each of which can depend on the input.

**Theorem 11.2 (Comparison lower bound for matching).** Exact single-pattern matching of `p` in `t` requires `Ω(n + m)` time in the comparison model (every text and pattern character may need to be examined to certify presence/absence). The Z-based matcher achieves `O(n + m)` (Corollary 5.2), so it is **optimal** up to constants.

**Theorem 11.3 (Z and π are linearly inter-reducible).** By the constructions of Sections 8–9, computing `z` and computing `π` are equivalent under `O(n)`-time reductions. Hence any lower bound for one applies to the other; both are `Θ(n)` to build. ∎

The space bound is matched exactly by the algorithm (Section 11.2): the working space beyond input and output is `O(1)`, so the `Ω(n)` is entirely attributable to the unavoidable output, not to any algorithmic overhead. This is the strongest possible optimality statement for a full-array computation.

### 11.1 The Adversary Argument for the Matching Lower Bound

**Sketch of Theorem 11.2.** Consider an adversary that answers character-comparison queries to maximize the number of probes any correct algorithm must make. For matching `p` of length `m` in `t` of length `nt`, the adversary can force the algorithm to inspect every text character: if any text character `t[q]` in a potential match window is never read, the adversary is free to set it either to agree or disagree with `p`, changing the answer (occurrence vs none) without contradicting prior answers. Hence `Ω(nt)` text probes are forced. Symmetrically, an unread pattern character can be set to make the same window match or fail, forcing `Ω(m)` pattern probes. Together `Ω(m + nt)`. The Z-matcher meets this with `O(m + nt)`, so it is optimal. ∎

### 11.2 Space Lower Bound and the In-Place Question

The output array forces `Ω(n)` space (Theorem 11.1). One may ask whether the *working* space (beyond input and output) can be `O(1)`. The Z-box algorithm already uses only `O(1)` auxiliary variables (`l, r, i`) on top of the output array `z`, so it is **in-place modulo the output**: no recursion, no stack, no auxiliary arrays. This is a genuine advantage for embedded or memory-constrained settings, and contrasts with suffix-array constructions that need `O(n)` scratch. The streaming matcher (`senior.md`) sharpens this to `O(m)` total when only match positions (not the full text-region array) are needed.

**On the constant.** The Z-algorithm performs at most `2n` comparisons (Theorem 4.3); KMP's prefix function performs at most `2n` as well. Neither dominates the other asymptotically or in the comparison constant; the choice is driven by interface (streaming vs concatenation) and clarity, as discussed in [`senior.md`](./senior.md).

**Theorem 11.4 (Alphabet independence).** The `O(n)` and `Ω(n)` bounds hold over any alphabet supporting `O(1)` equality, with **no dependence on alphabet size** `|Σ|`. Unlike algorithms that bucket by character (e.g. counting-sort-based suffix arrays, which carry an `O(|Σ|)` or `O(n + |Σ|)` term), the Z-function only ever asks "are these two characters equal?" Hence it is equally efficient for a 2-symbol alphabet and for a Unicode-scale alphabet, a practical advantage for large-alphabet inputs (sibling `04-suffix-arrays` must manage the alphabet term explicitly).

**Remark (online vs offline).** The prefix function is *online* in the text: KMP can consume the text one character at a time and report matches without seeing the rest. The plain Z-function as presented is *offline* (it needs the concatenation), but the streaming variant of [`senior.md`](./senior.md) restores onlineness by carrying box state across chunks. So even the online/offline distinction — sometimes cited as a fundamental difference — collapses under the equivalence: both can be made online, both are `Θ(n)`, and the residual differences are engineering, not theory. This closes the loop on Theorem 11.3: the two tools are interchangeable at the level of asymptotic complexity, comparison constant, alphabet dependence, and (with care) streaming capability.

---

## 12. Summary

- **Definition.** `z[i] = lcp(s, s_i)`: the longest prefix of `s` that reappears starting at `i`; `z[0] := 0` by convention.
- **Z-box invariant.** The maintained interval `[l, r)` always satisfies `s[l..r-1] = s[0..r-l-1]` and has the largest right reach so far (Invariant 2.1, Lemma 2.2). This single invariant licenses the copy step.
- **Case analysis.** Inside the box, `z[i] = min(z[i-l], r-i)` is exact when the mirror match ends strictly inside (A1) and a correct lower bound when it reaches the edge (A2, requiring extension); outside the box, compare from scratch (B). Theorem 3.1 proves pointwise correctness.
- **Linear time.** `r` is non-decreasing (Lemma 4.1) and bounded by `n` (Lemma 4.2); each successful comparison advances `r` by one and each iteration has at most one failing comparison, so total comparisons ≤ `2n` (Theorem 4.3). This is the amortized r-pointer argument — *the* reason the algorithm is `O(n)`.
- **Matching correctness.** With a separator `# ∉ Σ`, on `s = p·#·t` we have `z[i] ≤ m` always, and `z[i] = m` iff `p` occurs at `i-(m+1)` (Theorem 5.1). The separator enforces the hard cap.
- **Borders/periods.** `b` is a border iff `z[n-b] = b`; the smallest period is the smallest `i` with `i + z[i] = n` (Theorems 6.1–6.2, Corollary 6.3), the same theory underlying KMP and Fine–Wilf.
- **Z ↔ π equivalence.** Lemmas 7.2–7.3 convert between blocks and borders; the two `O(n)` constructions (Sections 8–9) prove `z` and `π` carry identical prefix-repetition information and are linearly inter-reducible (Theorem 11.3).
- **Distinct substrings.** Incremental Z on reversed prefixes counts distinct substrings in `O(n²)` (Theorem 10.1) — the simplest correct reference, beaten asymptotically by suffix structures.
- **Optimality.** `Ω(n)` to output the array; `Θ(n+m)` matching is optimal (Theorems 11.1–11.2).

### What to Carry Away

The Z-function is the rare algorithm whose *entire* efficiency rests on a single amortized observation — the monotone, bounded right pointer `r` — and whose *entire* correctness rests on a single invariant — the box equals a prefix. Everything else (matching, borders, periods, the prefix-function equivalence, distinct-substring counting, the reversed-string mirror) is a corollary or an application. If you internalize Theorem 3.1 (correctness via the three-case clamp) and Theorem 4.3 (linearity via the `r`-pointer charge), you can re-derive the rest on demand and adapt the technique to new two-sided or repetition problems without memorizing them. That economy — one invariant, one amortized counter — is what makes the Z-function a model example of how a small structural insight yields a linear-time algorithm, and why it is taught as the gateway to the deeper string structures in siblings `04`, `11`, and `12`.

### Correctness/Complexity Cheat Table

| Result | Statement | Where |
|--------|-----------|-------|
| Pointwise correctness | loop computes `z[i] = lcp(s, s_i)` | Thm 3.1 |
| Linear time | ≤ `2n` comparisons; `O(n)` | Thm 4.3 |
| Matching | `z[i] = m` ⇔ occurrence at `i-(m+1)` | Thm 5.1 |
| Borders | `b` border ⇔ `z[n-b] = b` | Thm 6.1 |
| Period | smallest `i` with `i + z[i] = n` | Cor 6.3 |
| Z → π | `O(n)` construction | Thm 8.1 |
| π → Z | `O(n)` construction | Thm 9.1 |
| Inter-reducibility | `z` ≡ `π` under `O(n)` reductions | Thm 11.3 |

### Proof Dependency Map

The theorems build on one another in a tight chain, worth internalizing:

- **Invariant 2.1 / Lemma 2.2** (box is a verified prefix occurrence) ⇒ licenses the *copy* step.
- **Theorem 3.1** (pointwise correctness) depends on the invariant plus the three-case split.
- **Lemmas 4.1, 4.2** (`r` monotone and bounded) ⇒ **Theorem 4.3** (the `2n` comparison bound) — the linear-time result.
- **Theorem 5.1** (matching) depends on Theorem 3.1 applied to `p · # · t`, with the separator supplying the cap.
- **Theorems 6.1, 6.2** (borders/periods) are corollaries of the definition; **Lemma 6.4** (nesting) supports the conversion early-stop.
- **Lemmas 7.2, 7.3** (block ↔ border) ⇒ **Theorems 8.1, 9.1** (the two `O(n)` conversions) ⇒ **Theorem 11.3** (inter-reducibility), strengthened by **Proposition 7.4** (same fibers).
- **Theorems 11.1, 11.2** (lower bounds) certify optimality of the build and the matcher.

Every higher-level application — distinct-substring counting (Section 10), runs/repetitions (Section 10.3), the reversed-string mirror (Section 10.4) — bottoms out in Theorem 3.1 (correctness) and Theorem 4.3 (linearity). Master those two and the rest is consequence.

Foundational references: Gusfield, *Algorithms on Strings, Trees, and Sequences* (the Z-algorithm as the canonical linear-time matching foundation); Crochemore, Hancart, Lecroq, *Algorithms on Strings* (border/period theory and Fine–Wilf); Knuth, Morris, Pratt (1977) for the prefix function; Bannai, I, Inenaga, Nakashima, Takeda, Tsuruta (2017) for the runs theorem; cp-algorithms.com for the standard Z and conversion presentations. Sibling topics: `01-kmp`, `03-rabin-karp`, `04-suffix-arrays`, `11-manacher-algorithm`, `12-suffix-automaton`, `15-lyndon-decomposition`.

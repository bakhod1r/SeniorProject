# Boyer-Moore String Matching — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Bad-Character Rule: Safety Proof
3. The Good-Suffix Rule: Definitions and Both Cases
4. Good-Suffix Table Construction and Its Correctness
5. Combining the Shifts: The Maximum Is Safe
6. Average-Case Sublinear Analysis
7. The O(nm) Worst Case
8. Galil's Rule and the O(n) Bound
9. Preprocessing Complexity
10. Relationship to KMP and Borders
11. Lower Bounds and Optimality
12. Summary

---

## 1. Formal Definitions

Let `T` be the text of length `n` and `P` the pattern of length `m`, both over a finite alphabet `Σ` with `|Σ| = σ`. Indices are 0-based: `T[0..n-1]`, `P[0..m-1]`.

**Definition 1.1 (Occurrence).** `P` occurs in `T` at shift `s` (with `0 ≤ s ≤ n - m`) iff `T[s + j] = P[j]` for all `0 ≤ j < m`.

**Definition 1.2 (Alignment / scan).** At shift `s`, the right-to-left scan compares `P[m-1]` with `T[s+m-1]`, then `P[m-2]` with `T[s+m-2]`, and so on, stopping at the first `j` (largest such `j`) with `P[j] ≠ T[s+j]` (a **mismatch**), or reporting an occurrence if no mismatch occurs.

**Definition 1.3 (Bad character).** On a mismatch at pattern index `j`, the **bad character** is `c = T[s+j] ≠ P[j]`.

**Definition 1.4 (Good suffix).** On a mismatch at `j` (with `j < m-1`), the **good suffix** is the matched block `u = P[j+1 .. m-1]`, a (possibly empty) proper suffix of `P` that equals `T[s+j+1 .. s+m-1]`.

**Definition 1.5 (Last-occurrence function).**
```
last[c] = max{ i : P[i] = c }   if c occurs in P,  else  -1.
```

**Definition 1.6 (Border).** A **border** of a string `w` is a string that is both a proper prefix and a proper suffix of `w`. Borders are the central object behind both KMP's prefix function and Boyer-Moore's good-suffix rule.

**Goal.** Report every shift `s` at which `P` occurs in `T`, in expected sublinear and worst-case linear time (the latter with Galil's rule).

### 1.1 Notation conventions

| Symbol | Meaning |
|--------|---------|
| `n`, `m` | text length, pattern length |
| `σ` | alphabet size `|Σ|` |
| `s` | current alignment (shift): `P[j]` is compared with `T[s+j]` |
| `j` | scan index inside the pattern (starts at `m-1`, decreases) |
| `c` | the bad character `T[s+j]` at a mismatch |
| `last[c]` | rightmost index of `c` in `P`, else `-1` |
| `gs[·]` | good-suffix shift array (`gs[j+1]` after a mismatch at `j`) |
| `bc` | bad-character shift `j - last[c]` |
| `per(P)` | the period of `P` (smallest `p` with `P[i]=P[i+p]`) |
| `border` | a string that is both a proper prefix and proper suffix |
| `u` | the matched good suffix `P[j+1..m-1]` |
| `w` | the comparison word width (bits) in bit-parallel methods |

Throughout, "occurrence at `s`" means an exact match (Definition 1.1); "walk-style repeats" do not arise — string matching is exact, not a counting problem. All proofs are constructive and the algorithm is deterministic given `(T, P)`.

---

## 2. The Bad-Character Rule: Safety Proof

The bad-character rule shifts `P` so that the bad character `c = T[s+j]` aligns with its rightmost occurrence in `P`. We must prove the shift never skips an occurrence.

**Definition 2.1 (Bad-character shift).** On a mismatch at `j` with bad character `c`,
```
bc = j - last[c].
```
If `last[c] = -1` (c absent), `bc = j + 1`, sliding `P` entirely past position `s+j`. If `last[c] > j`, then `bc ≤ 0` and the rule is uninformative (we fall back on the good-suffix rule and the `max(1, ·)` clamp).

**Theorem 2.2 (Bad-character safety).** Suppose at shift `s` the scan mismatches at position `j` with `T[s+j] = c`. Then `P` cannot occur at any shift `s'` with `s < s' < s + bc` when `bc = j - last[c] ≥ 1`.

**Proof.** An occurrence at shift `s'` requires `P[j'] = T[s'+j']` for all `j'`, in particular for the text position `s+j`, i.e. `T[s+j] = c` must be matched by `P[(s+j) - s'] = P[s+j-s']`. For `s < s' < s + (j - last[c])`, the pattern index aligned with text position `s+j` is `s + j - s'`, which lies strictly between `last[c]` (exclusive) and `j` (exclusive):
```
s' < s + j - last[c]  ⟹  s + j - s' > last[c],
s' > s                ⟹  s + j - s' < j.
```
So the aligned pattern index `i := s+j-s'` satisfies `last[c] < i < j`. By definition of `last[c]` as the *rightmost* occurrence of `c`, no pattern index strictly greater than `last[c]` holds the character `c` — hence `P[i] ≠ c = T[s+j]`, contradicting the supposed occurrence at `s'`. When `c` is absent entirely (`last[c] = -1`), the same argument shows no `i` in `[0, j]` holds `c`, so all shifts `s' ∈ (s, s + j + 1)` are excluded. Therefore advancing by `bc` skips only non-occurrences. ∎

**Remark.** The non-positive case (`last[c] > j`) is exactly why a naive use of the last-occurrence table can stall; the rule is *safe* (never skips a match) but not always *productive*. The extended (per-position) bad-character table `bcr[c][j] = max{ i < j : P[i] = c }` restores productivity at `O(mσ)` space.

### 2.1 Worked bad-character example

Let `P = "NEEDLE"` (`m = 6`, indices `0..5`). The last-occurrence table is:
```
N -> 0   E -> 5   D -> 3   L -> 4   (E also at 1,2 but rightmost is 5)
all others -> -1
```
Search in `T = "THE NEEDLE IN THE HAYSTACK"`. Align at `s = 0`: compare `P[5]='E'` with `T[5]='E'`? `T = "THE NE..."`, so `T[5] = 'E'`... actually `T[5]` is the space — `T = "THE␠NEEDLE..."`, `T[0..5] = T,H,E,␠,N,E`, so `T[5] = 'E'`, matches `P[5]='E'`. Move left: `P[4]='L'` vs `T[4]='N'` — mismatch with bad character `c = 'N'`. Then `bc = j - last['N'] = 4 - 0 = 4`. The pattern jumps forward 4 positions, skipping alignments that the rule certifies cannot match because no `'N'` exists in `P` strictly right of index 0. This single mismatch eliminates three intermediate shifts at once — the concrete face of Theorem 2.2.

### 2.2 The interval-exclusion picture

Theorem 2.2 is cleanest stated as an *interval* result. A mismatch at `(s, j)` with bad character `c` certifies the half-open interval of shifts `(s, s + (j - last[c]))` to be occurrence-free. The proof works because every shift in that interval forces some pattern index `i ∈ (last[c], j)` to align with the text position holding `c`, and no such `i` holds `c`. The bad-character rule is therefore a *certificate generator*: each mismatch emits a proof that a contiguous block of alignments is hopeless, and the algorithm simply jumps to the first alignment outside the certified block. This reframing is what makes the max-shift combination (Section 5) provably correct rather than merely plausible.

### 2.3 Three exhaustive sub-cases of the bad-character shift

For completeness, the bad-character shift `bc = j - last[c]` partitions into three regimes, each safe:

1. **`c` absent (`last[c] = -1`):** `bc = j + 1`. The pattern jumps so its first character lands just past the bad text position. Safe because no pattern index holds `c`, so no alignment overlapping `s+j` can match.
2. **`c` present to the left (`last[c] < j`):** `bc = j - last[c] ≥ 1`. The closest occurrence of `c` in `P` is aligned with the text `c`. Safe by Theorem 2.2.
3. **`c` present only to the right (`last[c] > j`):** `bc = j - last[c] ≤ 0`. The rule offers no useful shift; we clamp to `1` and rely on the good-suffix rule. Still safe — shifting by `1` skips nothing.

Only regime 3 is "unproductive," and it is exactly why the extended per-position table (or the good-suffix rule) exists. Regimes 1 and 2 are where the large jumps come from, and regime 1 dominates on large alphabets — the structural origin of sublinearity.

In short: the bad-character rule is a complete, three-case decision, and its safety in every case is what licenses the unconditional `max(1, bc, gs)` combination used throughout the implementation.

---

## 3. The Good-Suffix Rule: Definitions and Both Cases

When a mismatch occurs at `j` with good suffix `u = P[j+1 .. m-1]`, we know `u` equals the text block just to the right. A safe shift must keep any future alignment consistent with `u` appearing there.

**Definition 3.1 (Good-suffix shift).** `gs[j+1]` is the smallest shift `Δ ≥ 1` such that, after sliding `P` right by `Δ`, the characters now aligned under the text block formerly matching `u` are consistent with `u`, *and* the character aligned under the mismatch position differs from `P[j]` (to avoid an immediate re-mismatch). Two cases realize this.

**Case 1 (re-occurrence of the suffix).** There exists `i < j+1` such that `P[i .. i + |u| - 1] = u` *and* (`i = 0` or `P[i-1] ≠ P[j]`). The shift aligns that interior copy of `u` with the matched text:
```
gs[j+1] = (m - 1 - j) ... realized as (j + 1) - i  in border terms.
```
The condition `P[i-1] ≠ P[j]` ensures we do not immediately reproduce the same mismatch.

**Case 2 (prefix equals suffix of the good suffix).** If no full interior re-occurrence of `u` exists, the best we can do is align the longest **prefix** of `P` that is also a **suffix** of `u`. Formally, let `r` be the largest value with `r ≤ |u|` and `P[0 .. r-1] = P[m - r .. m - 1]` (a prefix that is a suffix of `u`). The shift is `m - r`.

**Proposition 3.2 (Good-suffix safety).** Sliding `P` by `gs[j+1]` never skips an occurrence.

**Proof.** Any occurrence at `s' > s` aligns some part of `P` under the text block `u`. For `P` to match there, the pattern characters now under `u` must equal `u`. Case 1 finds the *closest* (largest-index) interior copy of `u` whose preceding character differs from `P[j]`; any closer shift either places a non-copy of `u` under the matched block (immediate failure) or reproduces the exact `P[j]`-vs-`c` mismatch. Case 2 applies when `u` does not reappear; then only a *prefix* of `P` can overlap the right end of the matched block, and aligning the longest such prefix is the closest consistent shift. In both cases every shift strictly smaller than `gs[j+1]` places a known-inconsistent pattern segment under the matched text, so it cannot be an occurrence. ∎

**Full-match case.** When the scan reaches `j = -1` (a full occurrence), the good suffix is all of `P`. The continue-shift `gs[0] = m - r₀`, where `r₀` is the length of the longest proper border of `P` (longest proper prefix that is also a suffix). This correctly finds overlapping occurrences (e.g. `P = "aa"` has border length 1, so `gs[0] = 1`).

### 3.1 Worked good-suffix example (both cases)

Take `P = "ABCAB"` (`m = 5`). Suppose the scan matches the suffix `u = "AB"` (positions 3,4) then mismatches at `j = 2` (`P[2] = 'C'`).

- **Case 1 check:** does `"AB"` re-occur in `P` earlier, preceded by a character other than `P[2]='C'`? Yes — `P[0..1] = "AB"`, and it is at the start (so the "preceded by a different character" condition is vacuously satisfied). The Case-1 shift aligns that interior `"AB"` with the matched text: the pattern slides by `3`.

Now take `P = "ABCDXAB"` (`m = 7`) and suppose the scan matched `u = "XAB"` then mismatched. `"XAB"` does not re-occur in `P`, so we fall to:

- **Case 2 check:** the longest **prefix** of `P` that is also a **suffix** of `u = "XAB"`. The prefix `"AB"`? No — `P` starts with `"AB"` but `"XAB"` ends with `"AB"`; is `"AB"` a prefix of `P`? `P[0..1] = "AB"`, yes. So `r = 2`, and the Case-2 shift is `m - r = 7 - 2 = 5`, sliding so the prefix `"AB"` of `P` aligns under the right end of the matched block. These two scenarios show exactly why the table needs both passes: Case 1 catches interior re-occurrences, Case 2 catches the prefix overlap when none exists.

### 3.2 Why the "preceding character differs" condition matters

In Case 1, requiring `P[i-1] ≠ P[j]` is not optional polish — it is correctness. If we aligned an interior copy of `u` whose preceding character *equals* `P[j]`, the very next right-to-left scan would re-mismatch at the same relative position against the same text character `c` (since that text char already mismatched `P[j]`), wasting a full alignment. Skipping such "useless" re-occurrences makes the good-suffix shift the *smallest productive* safe shift, which is what we want before taking the max with the bad-character shift. Omitting the condition still yields a *safe* table (it never skips a match) but a less *productive* one.

---

## 4. Good-Suffix Table Construction and Its Correctness

We build `gs[0..m]` in `O(m)` using a border-based auxiliary array. Let `border[i]` denote, for the suffix `P[i..m-1]`, the start index of the widest border (the standard "suffix border" array, computed right-to-left).

**Algorithm (two passes).**
```
build_good_suffix(P):                       # P has length m
  border[0..m] = 0;  gs[0..m] = 0
  i = m;  j = m + 1;  border[i] = j
  while i > 0:                               # PASS 1: suffix borders + Case 1
    while j <= m and P[i-1] != P[j-1]:
      if gs[j] == 0: gs[j] = j - i           # Case 1 shift recorded
      j = border[j]
    i -= 1;  j -= 1;  border[i] = j
  j = border[0]                              # PASS 2: Case 2 (prefix=suffix)
  for i = 0 .. m:
    if gs[i] == 0: gs[i] = j
    if i == j: j = border[j]
  return gs
```

**Lemma 4.1 (Pass 1 correctness).** After Pass 1, for every position `j` such that `P[j..m-1]` has a re-occurrence whose preceding character differs, `gs[j]` holds the Case-1 shift `j - i`, where `i` is the start of the widest such re-occurrence.

**Proof sketch.** The inner `while` walks the border chain `border[j], border[border[j]], …` exactly as KMP's failure-function construction does, but on the *reversed* suffix structure. Each time the extending characters `P[i-1]` and `P[j-1]` differ, the position `j` marks the boundary of a good suffix whose closest consistent re-occurrence starts at `i`, giving shift `j - i`. The `if gs[j] == 0` guard ensures only the *first* (hence largest, since `j` decreases) such shift is recorded, which is the smallest safe shift. The outer loop establishes `border[i]` for all `i` in `O(m)` amortized, because `j` only increases via `border` jumps whose total is bounded by the total decrease of `i` (the standard amortized-border argument). ∎

**Lemma 4.2 (Pass 2 correctness).** After Pass 2, every position `j` not assigned in Pass 1 receives `gs[j] = m - r`, where `r` is the length of the longest prefix of `P` equal to a suffix of `P[j..m-1]`.

**Proof sketch.** `border[0]` is the start index of the widest border of all of `P`; iterating `j = border[j]` enumerates the nested borders in decreasing length. For each position `i` not yet filled, the current `j` is the start index of the smallest border still covering position `i`, so the prefix length is `m - j` and the shift `j`. The advance `if i == j: j = border[j]` steps to the next shorter border exactly when the position passes the current border boundary. This fills all unassigned positions with the Case-2 shift in one `O(m)` pass. ∎

**Theorem 4.3 (Construction complexity).** `build_good_suffix` runs in `O(m)` time and `O(m)` space.

**Proof.** Pass 1's inner loop performs border jumps whose count is amortized `O(m)` (each jump strictly increases `j`, and `j` decreases by exactly 1 per outer iteration, so total increases ≤ total decreases + `m`). Pass 2 is a single linear scan. Both arrays are size `m+1`. ∎

---

## 5. Combining the Shifts: The Maximum Is Safe

**Theorem 5.1 (Max-shift safety).** On a mismatch at `j`, advancing by `Δ = max(1, j - last[c], gs[j+1])` never skips an occurrence.

**Proof.** By Theorem 2.2, no occurrence lies in `(s, s + (j - last[c]))` when that quantity is `≥ 1`. By Proposition 3.2, no occurrence lies in `(s, s + gs[j+1])`. The set of shifts excluded by the bad-character rule and the set excluded by the good-suffix rule both start at `s+1`; their *union* of guaranteed-empty intervals is `(s, s + max(bc, gs))`. Hence the largest of the two shifts (clamped to `≥ 1` to guarantee progress) excludes a superset of non-occurrences covered by either rule alone, and advancing by it cannot pass over a real occurrence. The clamp to `1` is always safe because shifting by `1` is the minimal advance and trivially skips nothing. ∎

**Corollary 5.2.** Taking the maximum is not merely a heuristic — it is provably optimal among "use one of the two computed shifts," because both intervals are certified occurrence-free, so their union is occurrence-free, and the union's right endpoint is `s + max(bc, gs)`.

### 5.1 Why not the sum?

A common student error is to ask whether `bc + gs` (or some combination beyond the max) is safe. It is **not**. The two rules certify *overlapping* intervals, both starting at `s + 1` — not disjoint ones. The bad-character rule certifies `(s, s + bc)` empty; the good-suffix rule certifies `(s, s + gs)` empty. The union of two intervals sharing a left endpoint is just the longer interval, `(s, s + max(bc, gs))`. Beyond `s + max(bc, gs)`, *neither* rule offers a certificate, so an occurrence could begin there. Adding the shifts would jump past alignments that are not certified hopeless, and could skip a real match. The maximum is the precise, provably correct way to combine them.

### 5.2 A combined-shift worked trace

Search `P = "GCAGAGAG"` (`m = 8`) in `T = "GCATCGCAGAGAGTATACAGTACG"`. At an alignment where the suffix `"AG"` matched and `P[5] = 'A'` mismatched a text `'T'`:
- Bad-character: `'T'` is absent from `P`, so `last['T'] = -1` and `bc = 5 - (-1) = 6`.
- Good-suffix: the matched suffix `"AG"` re-occurs in `P` (it appears repeatedly in `GCAG**AG**AG`), giving a modest shift, say `2`.
- Chosen: `max(1, 6, 2) = 6`.

Here the bad-character rule dominates because the alphabet element `'T'` is absent — exactly the large-alphabet regime where Boyer-Moore excels. On a different alignment where the bad character *does* appear late in `P`, the good-suffix shift would dominate. The algorithm transparently uses whichever rule is stronger at each position, which is why the *combination* is more robust than either rule alone.

---

## 6. Average-Case Sublinear Analysis

Assume `T` is a uniformly random string over `Σ` with `|Σ| = σ`, and `P` is fixed of length `m`.

**Setup.** At each alignment, the first comparison is `P[m-1]` vs a fresh text character `X`. Let `p_occ = (number of distinct chars in P)/σ` be the probability `X` appears in `P`. With high probability for large `σ`, `X ∉ P`, and the bad-character rule shifts by `m` after a single comparison.

**Theorem 6.1 (Expected shift).** The expected shift per alignment is `Θ(min(m, σ))` for the bad-character rule on uniform text. In particular, for `σ ≥ m`, the expected shift is `Θ(m)`.

**Proof sketch.** The probed character `X` is absent from `P` with probability `≥ (σ - m)/σ`, yielding a shift of `m`. Conditioned on `X ∈ P`, the rightmost occurrence is roughly uniform, giving an expected shift on the order of `m/(\text{frequency})`. Summing, `E[shift] = Θ(min(m, σ))`. ∎

**Theorem 6.2 (Expected comparisons).** The expected number of character comparisons performed by Boyer-Moore (bad-character) on uniform random text is
```
E[comparisons] = O( n · (1/min(m, σ) + 1/σ ... ) ) = O(n / min(m, σ)) · O(1).
```
More precisely, Boyer-Moore examines `O(n / m)` characters in the best regime (`σ ≥ m`), i.e. **sublinear**: it can find or exclude `P` while inspecting fewer than `n` characters.

**Proof sketch.** Partition the text into the alignments visited. The number of alignments is `n / E[shift] = O(n / min(m, σ))`. Each alignment performs an expected `O(1)` comparisons before mismatching (the probability the first `t` comparisons all match is `≤ σ^{-t}`, a geometric series summing to `O(1)`). Multiplying alignments by comparisons-per-alignment gives `O(n / min(m, σ))` total — sublinear for `m, σ` large. ∎

**Yao's bound (optimality).** Yao (1979) proved that *any* comparison-based string matcher must examine `Ω(n log_σ m / m)` characters on average for random text. Boyer-Moore-style algorithms (specifically the Boyer-Moore-Horspool and Backward-DAWG matchers) achieve this optimal average bound up to constants. So the sublinearity is not an artifact — it is essentially the best achievable, and Boyer-Moore is *average-case optimal*.

### 6.1 Quantifying the alphabet effect

The expected-shift result `Θ(min(m, σ))` makes the alphabet sensitivity precise. Two regimes:

- **`σ ≥ m` (large alphabet, e.g. bytes vs a 7-letter word):** the probed last character is absent from `P` with probability `≥ (σ - m)/σ ≈ 1`, so almost every alignment shifts by the full `m` after one comparison. Expected examined characters `≈ n/m` — strongly sublinear.
- **`σ ≪ m` (small alphabet, e.g. DNA vs a 50-mer):** the probed character is almost always *in* `P`, and its rightmost occurrence is on average `≈ σ/2` positions from the end, so the expected shift is `Θ(σ)`, independent of `m`. Expected examined characters `≈ n/σ` — still sublinear but far less dramatic, and the worst case looms.

This is the rigorous reason behind the senior advice "Boyer-Moore loves large alphabets and long patterns": both push `min(m, σ)` up, and the expected work down as `n / min(m, σ)`.

### 6.1b Expected shift, tabulated

Plugging concrete numbers into `E[shift] = Θ(min(m, σ))` makes the regimes vivid. For uniform-random text, the approximate expected shift per alignment:

| σ (alphabet) | m = 4 | m = 8 | m = 16 | m = 64 |
|--------------|-------|-------|--------|--------|
| 2 (binary) | ~1.5 | ~2 | ~2 | ~2 |
| 4 (DNA) | ~3 | ~3.5 | ~4 | ~4 |
| 26 (letters) | ~4 | ~7 | ~12 | ~22 |
| 256 (bytes) | ~4 | ~8 | ~16 | ~60 |

Reading down a column: for fixed `m`, larger `σ` raises the shift until it saturates at `m`. Reading across a row: for fixed `σ`, larger `m` raises the shift until it saturates at `σ`. The expected examined-character count is `n` divided by these shift values, so the bottom-right cells (`large σ`, `large m`) are where Boyer-Moore is dramatically sublinear, and the top-left (`binary`, `short`) is where it barely beats naive and the worst case threatens.

### 6.2 The geometric tail of per-alignment comparisons

The claim "expected `O(1)` comparisons per alignment" deserves its own argument. At a fixed alignment, the probability that the first `t` right-to-left comparisons all match is the probability that `t` independent uniform text characters equal the corresponding pattern characters, which is `≤ σ^{-t}` (each match has probability `1/σ` for a uniform-random text character against a fixed pattern character). The expected number of comparisons is therefore `Σ_{t≥1} P(at least t comparisons) ≤ Σ_{t≥0} σ^{-t} = σ/(σ-1) = O(1)`. The geometric decay is what keeps the per-alignment cost constant; it is *not* `O(m)` on average, only in the adversarial worst case (Section 7).

---

## 7. The O(nm) Worst Case

The expected sublinearity does not bound the worst case. The plain Boyer-Moore (bad-character + good-suffix, *without* Galil) can perform `Θ(nm)` comparisons.

**Theorem 7.1.** There exist families `(T, P)` on which plain Boyer-Moore performs `Θ(nm)` character comparisons.

**Proof (construction).** Take `Σ = {a}`, `T = a^n`, `P = a^m`. At every shift `s`, the right-to-left scan matches all `m` characters and reports an occurrence; the good-suffix continue-shift `gs[0] = 1` (border of `a^m` has length `m-1`). So there are `n - m + 1 = Θ(n)` alignments, each doing `Θ(m)` comparisons (the full scan), for `Θ(nm)` total. A non-matching variant `P = b·a^{m-1}` over `Σ = {a,b}`, `T = a^n` mismatches at `j = 0` after scanning all `m-1` matched `a`s, with bad-character shift `0 - last[a]` (uninformative) and a small good-suffix shift, again giving `Θ(nm)`. ∎

**Tabulated blow-up.** The plain algorithm's comparison count on the adversary `T = a^N`, `P = a^m`:

| N | m | plain comparisons (~N·m) | Galil comparisons (~N) |
|---|---|--------------------------|------------------------|
| 1000 | 10 | ~10,000 | ~1000 |
| 1000 | 100 | ~100,000 | ~1000 |
| 10,000 | 100 | ~1,000,000 | ~10,000 |
| 100,000 | 1000 | ~100,000,000 | ~100,000 |

The `plain/Galil` ratio is `Θ(m)`, growing without bound as the pattern lengthens — a concrete denial-of-service profile if an attacker controls `(T, P)`, and the precise reason untrusted-input services must implement Galil's rule or switch to a linear-guarantee matcher (Two-Way / KMP).

The root cause: when the good suffix overlaps the next alignment, the plain algorithm **re-compares** characters it already knows match, wasting `Θ(m)` per alignment.

### 7.1 Distinguishing the two quadratic causes

It is worth separating two independent sources of quadratic behaviour, because they need different fixes:

1. **Redundant re-comparison of matched suffixes** (the `a^n`/`a^m` case). Each alignment re-reads characters already known to match. Fix: **Galil's rule** (remember the overlap boundary).
2. **Many genuine partial matches with tiny shifts** (small-alphabet, near-periodic patterns). Each alignment legitimately matches a long suffix before mismatching, and the shift is small. Galil's rule still caps this to `O(n)` because it prevents the *re-reading*; the long initial scan of each distinct region is charged once to that region.

Both are subsumed by the `O(n)` charging argument (Section 8.1), but recognizing which is firing helps when diagnosing a real slowdown: cause 1 shows as identical re-reads in a trace, cause 2 as long-but-distinct scans. The Apostolico-Giancarlo variant attacks the comparison count even more aggressively by storing, per text position, the length of the suffix matched there, avoiding re-comparison across *all* alignments, not just consecutive ones — at the cost of an `O(n)` auxiliary array.

---

## 8. Galil's Rule and the O(n) Bound

Galil (1979) eliminated the redundant re-comparisons, proving Boyer-Moore can be made linear.

**Definition 8.1 (Galil memory).** After a shift caused by the good-suffix rule (or after a full match), some prefix of the next alignment's window is *guaranteed* to match because it overlaps the previously matched suffix. Let `g` be the rightmost text index up to which the next alignment is known to match. The scan, instead of comparing down to `j = -1`, stops once it reaches the aligned position of `g` and *declares the overlap matched*.

**Theorem 8.2 (Galil linearity).** Boyer-Moore with Galil's rule performs `O(n)` character comparisons in the worst case (after `O(m + σ)` preprocessing), while preserving correctness.

**Proof sketch.** Charge each comparison to a text position. Galil's rule ensures that, across all alignments, no text position is compared as part of a *matched* region more than a constant number of times: once a region is established as matching and carried forward via the memory boundary `g`, subsequent alignments skip re-comparing it. Mismatching comparisons are charged to the shift they cause; each shift advances `s` by `≥ 1` and there are `O(n)` total advance. Matching comparisons within the never-re-examined regions sum to `O(n)` because each text position enters a "newly matched" region `O(1)` times. Adding mismatch comparisons (`O(n)`, one per shift event class) gives `O(n)` total. The correctness is unaffected: skipping re-comparison of a *provably* matching overlap cannot change the match decision. The full charging argument (Cole 1994 gives the tight constant) bounds comparisons by `≤ 3n` for the searching phase. ∎

**Cole's bound.** Cole (1994) proved a tight bound: the Boyer-Moore algorithm with the good-suffix rule (and Galil's optimization) makes at most `3n` comparisons in the worst case when `P` does not occur in `T`, and at most `4n` when it does — a clean linear constant, settling the long-open question of Boyer-Moore's exact worst-case comparison complexity.

### 8.1 The charging argument in more detail

The cleanest way to see linearity is an *amortized charging* scheme. Classify each character comparison as a **match** or a **mismatch**.

- **Mismatches** are easy: each alignment produces at most one mismatch (the scan stops there), and each alignment is followed by a shift of `≥ 1`. The total number of alignments is `≤ n`, so there are `≤ n` mismatch comparisons overall.
- **Matches** are the danger (this is where the plain algorithm wastes `Θ(m)` per alignment). Galil's memory boundary `g` records the rightmost text index already proven to match. A match comparison at text index `i` is **new** only if `i > g`; comparisons at `i ≤ g` are skipped entirely (the scan stops at the boundary). Each text index becomes "newly matched" `O(1)` times across the whole run, because once it is below some alignment's boundary it stays accounted for. Hence new-match comparisons total `O(n)`.

Summing, total comparisons `= O(n) + O(n) = O(n)`. Cole's `3n` refines the `O(1)` constants in this sketch to an exact, tight bound by a careful potential-function analysis distinguishing the contribution of the good-suffix periodicity.

### 8.2 Galil's rule preserves correctness

Linearity is worthless if it changes the answer. Galil's rule only *skips re-comparing* a region the algorithm has *already proven* matches at the current alignment (because that region overlaps a suffix established in the previous alignment, and the shift was a good-suffix shift consistent with that suffix). Since those characters are provably equal, comparing them would return `true` and the match/mismatch decision is unchanged. Formally: the boundary `g` is only set after a comparison or chain of comparisons established equality on `T[.. g]` for the *upcoming* alignment; reading those equal characters again is redundant, so skipping them cannot alter which shifts are taken or which matches are reported. Correctness is therefore identical to the plain algorithm; only the comparison count drops.

---

## 9. Preprocessing Complexity

**Theorem 9.1 (Bad-character preprocessing).** The last-occurrence table is built in `O(m + σ)` time and `O(σ)` space.

**Proof.** Initialize `last[c] = -1` for all `c ∈ Σ` (`O(σ)`), then scan `P` left to right writing `last[P[i]] = i` (`O(m)`); the last write for each character wins, yielding the rightmost occurrence. Total `O(m + σ)`. ∎

**Theorem 9.2 (Good-suffix preprocessing).** The good-suffix table is built in `O(m)` time and `O(m)` space (Theorem 4.3).

**Corollary 9.3 (Total preprocessing).** Full Boyer-Moore preprocessing is `O(m + σ)` time, `O(m + σ)` space — independent of `n`. For byte alphabets `σ = 256` is a constant, so preprocessing is effectively `O(m)`.

**Remark (extended bad-character table).** The per-position table `bcr[c][j]` costs `O(mσ)` time and space. It is rarely worth it; the classic `O(σ)` last-occurrence table plus the good-suffix rule (and the `max` clamp) covers the same shifts with far less memory.

### 9.1 Worked good-suffix construction trace

Construct `gs` for `P = "ABAB"` (`m = 4`) to make the two passes concrete. Pass 1 computes the suffix-border array right to left; Pass 2 fills prefix-suffix shifts.

```
P = A B A B   (indices 0..3)
Pass 1 (suffix borders, walking i from m down):
  border[4] = 5
  i=4,j=5: P[3]='B' vs P[4] (out of range, j>m) -> set border[3], j=4
  ... the inner loop records gs[j] = j - i where extending chars differ
Pass 2 (prefix = suffix of the good suffix):
  j = border[0]; for each unfilled position assign gs[i] = j;
  advance j = border[j] when i == j.
```
The end-to-end check is more reliable than tracing array internals (conventions vary across textbooks): for `P = "ABAB"`, `gs[0]` must equal `m - (longest proper border length) = 4 - 2 = 2`, because the longest proper border of `"ABAB"` is `"AB"` (length 2). Running the full searcher on `T = "ABABABAB"` must report matches at `0, 2, 4` — which validates the whole table against the naive oracle. This "validate end-to-end, not the raw array" discipline is the practical takeaway: the array's indexing convention is implementation-dependent, but its *effect* on the search must match the oracle exactly.

### 9.2 The Z-function / prefix-function alternative

The good-suffix table can equivalently be built from the **Z-function** of the reversed pattern, or from the KMP prefix function applied to `reverse(P)`. The equivalence is not a coincidence: the good-suffix rule asks for borders of suffixes of `P`, which are exactly the borders of prefixes of `reverse(P)` — the object KMP's prefix function computes. Concretely:

```
suffix-borders of P  ≡  prefix-borders of reverse(P)  ≡  KMP failure function of reverse(P).
```

This gives a second `O(m)` construction route and explains, structurally, *why* Boyer-Moore (right-to-left) and KMP (left-to-right) are mirror images: reversing the pattern turns one rule's preprocessing into the other's. Many production implementations reuse a single tested prefix-function routine, feed it `reverse(P)`, and derive the good-suffix shifts from the result, avoiding a second hand-written border routine and its attendant off-by-one bugs.

---

## 10. Relationship to KMP and Borders

Both KMP (sibling `01-kmp`) and Boyer-Moore's good-suffix rule are built on **borders** (Definition 1.6), but apply them to opposite ends.

**Proposition 10.1.** KMP's prefix function `π[i]` is the length of the longest border of `P[0..i]`; on a left-to-right mismatch it shifts `P` to align that border, never moving the text pointer backward, giving `O(n + m)` worst case with `O(m)` preprocessing.

**Proposition 10.2.** Boyer-Moore's good-suffix Case 2 uses the borders of `P` to align the longest prefix that is a suffix of the matched good suffix — the *mirror image* of KMP's border use, applied to the right end during a right-to-left scan.

**The fundamental contrast.**

| Property | KMP | Boyer-Moore |
|----------|-----|-------------|
| Scan direction | left → right | right → left |
| Text characters | examines every one | **skips** most (sublinear avg) |
| Worst case | `O(n + m)` always | `O(nm)` plain, `O(n)` with Galil |
| Preprocessing | `O(m)` (prefix function) | `O(m + σ)` (two tables) |
| Streaming | natural (one pass) | needs window random access |
| Alphabet sensitivity | none | strong — large `σ` → faster |
| Average optimality | not sublinear | average-case optimal (Yao) |

KMP minimizes *re-reads*; Boyer-Moore minimizes *reads*. KMP is the better worst-case and streaming choice; Boyer-Moore is the better average-case choice on large alphabets.

### 10.1 A unifying lemma on borders

**Lemma 10.3.** For any string `w`, the set of border lengths of `w` is `{ |w| - π[|w|-1], |w| - π[π[|w|-1]-1], … }` chained through the prefix function `π`, and this same chain — applied to `reverse(P)` — enumerates the good-suffix shifts of `P`.

**Proof sketch.** The prefix function `π[i]` is the longest border of the prefix `w[0..i]`; iterating `i ← π[i]-1` enumerates all nested borders in decreasing length (the standard KMP border-chain). Borders of suffixes of `P` are borders of prefixes of `reverse(P)`, so the identical chain on `reverse(P)` yields exactly the prefix-equals-suffix lengths that Case 2 of the good-suffix rule needs, and the residual shifts of Case 1 fall out of the same suffix-border array. Both BM and KMP are thus *applications of the border-chain* to opposite ends. ∎

This lemma is the formal statement that the two great string-matchers are one idea viewed from two ends, and it is why a single, well-tested border routine suffices to implement both.

---

## 10b. The Horspool Simplification: A Formal View

Horspool (1980) replaces the position-dependent bad-character shift with a single table keyed only on the text character `c` aligned with the *last* pattern position, ignoring which interior index mismatched.

**Definition 10b.1 (Horspool shift).** Build `H[c] = m - 1 - i` where `i` is the rightmost occurrence of `c` in `P[0..m-2]` (excluding the last position), and `H[c] = m` if `c` does not occur there. On any mismatch within the window, shift by `H[T[s + m - 1]]`.

**Proposition 10b.2 (Horspool safety).** Shifting by `H[T[s+m-1]]` never skips an occurrence.

**Proof.** Let `c = T[s + m - 1]` be the text character under the pattern's last position. Any occurrence at `s' > s` must align some pattern character with the text position `s + m - 1`. The closest such `s'` aligns `c` with its rightmost occurrence in `P` strictly before the last position (index `i`), i.e. `s' = s + (m - 1 - i)`. Smaller shifts would align a pattern position holding a character `≠ c` with the text `c`, impossible for a match. If `c` occurs nowhere in `P[0..m-2]`, the pattern slides fully past the last window position, shift `m`. ∎

Horspool drops the good-suffix rule entirely and keys only on the last byte, trading a little skip power (no per-position information, no suffix re-alignment) for a tiny `O(σ)` table and a branch-light inner loop. Its worst case remains `O(nm)` (no Galil), but its average case is sublinear and matches Yao's bound up to constants — which is why it, not full Boyer-Moore, dominates production fixed-string search (sibling `09-horspool`).

**Why exclude the last position from the table?** If we included the last character's own index, a mismatch on the last character would compute `H[c] = 0` (since `last[c] = m-1`), stalling the search. Excluding the last position guarantees `H[c] ≥ 1` for the guard character, so no clamp is needed — a small but elegant invariant of the Horspool formulation that the full Boyer-Moore (with its `max(1, ·)` clamp) lacks.

---

## 11b. Periodicity, the Period of the Pattern, and the Worst Case

The pattern's **period** controls both the good-suffix shifts and the shape of the worst case.

**Definition 11b.1 (Period).** The period `per(P)` is the smallest `p > 0` such that `P[i] = P[i+p]` for all valid `i`. A string is *periodic* if `per(P) ≤ m/2`. Equivalently, `per(P) = m - (longest proper border length)`.

**Proposition 11b.2.** The full-match continue-shift `gs[0]` equals `per(P)`. Hence after every full match the pattern advances by exactly one period, which is why overlapping occurrences of a periodic pattern (like `"aa"`, period 1) are all found.

**Connection to the worst case.** The `Θ(nm)` adversary `T = a^n`, `P = a^m` is the *maximally periodic* case (`per = 1`): every alignment is a full match, `gs[0] = 1`, and without Galil each match re-scans all `m` characters. Periodicity is therefore not incidental to the worst case — it *is* the worst case. Galil's rule attacks exactly this: it remembers the period-length overlap between consecutive matches and refuses to re-compare it, collapsing the `m` re-scans per match into amortized `O(1)`. The Crochemore-Perrin Two-Way algorithm (sibling discussion in `senior.md`) is built directly on the *critical factorization* of `P` derived from its period, which is how it achieves `O(n)` time with `O(1)` extra space and no `σ`-table — a different exploitation of the same periodic structure.

**Theorem 11b.3 (Critical factorization, informal).** Every string `P` has a position `ℓ` (the *critical position*) splitting it into `P = u·v` such that the local period at `ℓ` equals the global period `per(P)`. Two-Way matching scans `v` left-to-right and `u` right-to-left around this critical position, and uses `per(P)` to shift — yielding linear time with constant space. This is the algorithm glibc's `memmem` actually ships, and it is a pure-periodicity competitor to Boyer-Moore's heuristic shifts.

### 11b.4 Multi-pattern extension complexity

**Commentz-Walter** generalizes the good-suffix and bad-character rules to a set of patterns `{P_1, …, P_k}` by building a trie of the *reversed* patterns and matching right-to-left against it. Let `M = Σ |P_i|` be the total pattern length and `m_min = min |P_i|` the shortest. Preprocessing is `O(M + σ)` (trie plus shift tables); the average search remains sublinear, with shifts bounded by `m_min` (you can never safely jump past the shortest pattern). The worst case, like single-pattern Boyer-Moore, is quadratic without a Galil-style fix. Its linear-guarantee counterpart is **Aho-Corasick**, which builds a left-to-right automaton with failure links (the multi-pattern analogue of KMP) and runs in `O(n + M + z)` where `z` is the number of matches — the algorithm of choice when a hard linear bound across many patterns is required (e.g. intrusion detection). The single-vs-multi and skip-vs-scan axes thus produce a clean 2×2: KMP/Aho-Corasick (scan, linear) versus Boyer-Moore/Commentz-Walter (skip, sublinear-average).

---

## 11. Lower Bounds and Optimality

**Theorem 11.1 (Yao 1979, average-case lower bound).** Any algorithm that finds a length-`m` pattern in a random length-`n` text over an alphabet of size `σ` must examine `Ω((n/m) log_σ m)` text characters on average.

**Consequence.** Sublinearity is information-theoretically forced to *stop* at this bound; you cannot do asymptotically better on random text. Boyer-Moore-Horspool and BNDM match it up to constants, so they are **average-case optimal**.

**Theorem 11.2 (Worst-case lower bound).** Any comparison-based exact matcher must examine `Ω(n)` characters in the worst case (it must, in the worst case, read essentially all of the text to be sure no occurrence was missed in unread regions when the pattern could match there). KMP, Two-Way, and Galil-augmented Boyer-Moore all achieve this `O(n)` worst-case optimum; plain Boyer-Moore does not.

**Cole's tight constant.** Cole (1994): the searching phase of good-suffix Boyer-Moore with Galil makes `≤ 3n` comparisons (no occurrence) — a tight worst-case *constant*, not just an asymptotic bound. The matching of Yao's average bound *and* Cole's worst-case constant is what crowns Boyer-Moore as both average-optimal and (with Galil) worst-case-linear.

### 11.1 The space–time landscape

| Algorithm | Time (worst) | Time (avg) | Extra space | Streaming |
|-----------|-------------|-----------|-------------|-----------|
| Naive | `O(nm)` | `O(nm)` | `O(1)` | yes |
| KMP | `O(n+m)` | `O(n+m)` | `O(m)` | yes |
| Boyer-Moore (plain) | `O(nm)` | sublinear | `O(m+σ)` | no |
| Boyer-Moore + Galil | `O(n)` | sublinear | `O(m+σ)` | no |
| Horspool | `O(nm)` | sublinear | `O(σ)` | no |
| Two-Way | `O(n+m)` | `O(n+m)` | `O(1)` | partial |
| BNDM (`m ≤ w`) | `O(nm/w)` | sublinear | `O(σ)` | no |

The interesting cell is the **lower-right of optimality**: only Two-Way achieves `O(n)` worst case with `O(1)` space *and* no alphabet-dependent table — which is precisely why it, not Boyer-Moore, is the default in general-purpose C libraries. Boyer-Moore's `O(m + σ)` space is the price of its bad-character table, acceptable for bytes (`σ = 256`) but a deciding factor for huge alphabets.

### 11.2 Optimality is two-dimensional

The phrase "Boyer-Moore is optimal" is precise only when you name the axis:

- **Average-case examined characters:** optimal — matches Yao's `Ω((n/m) log_σ m)` (Horspool/BNDM variants).
- **Worst-case comparisons:** optimal up to a tight constant — `≤ 3n` (Cole) with Galil, matching the `Ω(n)` floor.
- **Space:** *not* optimal — `O(m + σ)` vs the `O(1)` of Two-Way/naive.
- **Streaming:** *not* applicable — the right-to-left scan needs window random access, unlike KMP.

No single algorithm dominates on every axis; the senior skill (developed in `senior.md`) is reading the workload and picking the matcher whose optimal axis matters most.

---

## 12. Summary

- **Bad-character rule safety** (Theorem 2.2): shifting by `j - last[c]` skips only non-occurrences, because every pattern index strictly right of `last[c]` lacks the bad character `c`. Absent characters give the full jump `j+1`.
- **Good-suffix rule** (Section 3): two cases — re-align an interior re-occurrence of the matched suffix (Case 1) or the longest prefix that equals a suffix of it (Case 2) — each provably occurrence-preserving (Proposition 3.2). The full-match continue-shift uses `P`'s longest proper border.
- **Good-suffix construction** (Section 4): a two-pass border-based algorithm in `O(m)` time and space, proved via the amortized-border argument shared with KMP.
- **Maximum shift** (Theorem 5.1): the union of two certified occurrence-free intervals is occurrence-free, so taking `max(bc, gs)` (clamped to `≥ 1`) never skips a match — and is optimal among the two computed shifts.
- **Average case** (Section 6): expected shift `Θ(min(m, σ))`, expected comparisons `O(n / min(m, σ))` — **sublinear**, and average-case optimal by Yao's `Ω((n/m) log_σ m)` bound.
- **Worst case** (Section 7): plain Boyer-Moore is `Θ(nm)` on `T = a^n`, `P = a^m`, due to redundant re-comparison of overlapping matched suffixes.
- **Galil's rule** (Section 8): remembering the matched-overlap boundary eliminates re-comparisons, giving `O(n)` worst case; Cole's tight bound is `≤ 3n` comparisons (no match), `≤ 4n` (with match).
- **Preprocessing** (Section 9): `O(m + σ)` total — bad-character table `O(m + σ)`, good-suffix table `O(m)` — independent of `n`.
- **vs KMP** (Section 10): both use borders, but KMP scans left-to-right and reads every character (`O(n+m)` always), while Boyer-Moore scans right-to-left and skips most characters (sublinear average, `O(n)` worst with Galil).
- **Horspool** (Section 10b): the bad-character-only simplification keyed on the last window byte, `O(σ)` space, no clamp needed; the production-favoured variant despite an `O(nm)` worst case.
- **Periodicity** (Section 11b): the full-match continue-shift equals `per(P)`; the maximally periodic pattern `a^m` is the `Θ(nm)` adversary, and Two-Way / critical factorization is the periodicity-based linear competitor.
- **Multi-pattern** (Section 11b.4): Commentz-Walter is the skip-based (BM-style) generalization; Aho-Corasick is the scan-based (KMP-style) linear one — the clean 2×2 of skip-vs-scan and single-vs-multi.

### Complexity Cheat Table

| Phase | Time | Space | Tight? |
|-------|------|-------|--------|
| Bad-character table | `O(m + σ)` | `O(σ)` | — |
| Good-suffix table | `O(m)` | `O(m)` | optimal |
| Search, average (uniform text) | `O(n / min(m, σ))` | `O(1)` | average-optimal (Yao) |
| Search, worst (plain) | `O(nm)` | `O(1)` | tight (Thm 7.1) |
| Search, worst (Galil) | `O(n)`, `≤ 3n` comparisons | `O(1)` | tight constant (Cole 1994) |
| Horspool search, average | `O(n / min(m, σ))` | `O(σ)` | average-optimal (Yao) |
| Two-Way search | `O(n + m)` | `O(1)` | linear, space-optimal |
| Commentz-Walter (k patterns) | sublinear avg, `O(nM)` worst | `O(M + σ)` | — |

### Theorem Dependency Map

The results in this document build on one another in a strict order:

```
Defs (1) ──► Walk/border definitions
   │
   ├──► Bad-char safety (2) ──────────────┐
   │                                       │
   ├──► Good-suffix cases (3) ──► Construction (4) ──► max-shift safety (5)
   │                                                          │
   ├──► Semiring-free combination                             ▼
   │                                              Average sublinear (6)
   ├──► Worst case Θ(nm) (7) ──► Galil O(n) (8) ──► Cole 3n constant
   │
   └──► Borders unify KMP (10) ──► Periodicity (11b) ──► Two-Way / Commentz-Walter
```

Reading top to bottom: definitions ground the two safety proofs; the safety proofs justify the max combination; the combination plus the geometric-tail argument yields the sublinear average; the worst-case adversary motivates Galil; and the border theory ties everything to KMP and the periodicity-based competitors. No step depends on a later one, so the development is fully constructive.

### Worked Synthesis: One Full Search, Every Theorem in Play

Search `P = "EXAMPLE"` (`m = 7`) in `T = "HERE IS A SIMPLE EXAMPLE"` (`n = 24`), tracing which theorem fires at each shift.

1. **Preprocess** (Thm 9.1, 9.2): `last` table in `O(m+σ)`, `gs` in `O(m)`. `per("EXAMPLE") = 7` (no proper border), so `gs[0] = 7`.
2. **Shift 0:** scan from `P[6]='E'` vs `T[6]='S'` — mismatch, bad char `'S'` absent (`last['S'] = -1`), `bc = 6 - (-1) = 7` (Thm 2.2 certifies shifts `(0,7)` empty). `gs[7] = 7`. Max = 7. One comparison, jump 7.
3. **Shift 7..16:** each alignment mismatches quickly on a character absent or rare in `P`, jumping several positions (Section 6's `Θ(min(m,σ))` expected shift), examining far fewer than `n` characters total — the sublinearity of Thm 6.2.
4. **Shift 17:** the window sits exactly on the final `"EXAMPLE"`; the right-to-left scan matches all 7 characters down to `j = -1` (Definition 1.1), reports the occurrence, advances by `gs[0] = per(P) = 7` (Prop 11b.2).
5. **Termination:** `s` exceeds `n - m`; the search ends having examined on the order of `n/m` characters, not `n·m` — the average-case win, with no worst-case blow-up because `"EXAMPLE"` is aperiodic.

Every theorem in this document has a concrete role in that single trace: safety (no match skipped), construction (the tables), the max-shift combination, the sublinear bound, and the periodic continue-shift.

### Closing Notes

- **Borders unify the field** (Section 10): KMP's prefix function and Boyer-Moore's good-suffix Case 2 are the same border machinery applied to opposite ends of the pattern.
- **Safety, then speed** (Sections 2-5): every shift rule is first proved to skip no occurrence; only then is the *largest* safe shift taken — correctness is never sacrificed for the sublinear speed.
- **Optimality on both axes** (Section 11): Boyer-Moore-family matchers meet Yao's average-case lower bound and (with Galil) the `O(n)` worst-case bound with a tight constant — a rare algorithm that is simultaneously average-optimal and worst-case-linear.

### Open Problems and Active Directions

- **Exact comparison constants:** Cole settled the good-suffix-with-Galil constant at `≤ 3n`; the minimal achievable constant for *all* Boyer-Moore variants under various rule combinations is still studied.
- **Min-comparison matching:** algorithms that minimize *character comparisons* (as opposed to wall-clock time) are a distinct line; the Apostolico-Giancarlo variant of Boyer-Moore tightens the comparison bound by remembering matched suffix lengths per text position.
- **SIMD-aware lower bounds:** Yao's bound counts *character* examinations; the right model for word-parallel and SIMD hardware (where 16-64 bytes compare per instruction) yields different, less-settled optimality questions — practically relevant given that real searchers are SIMD-bound, not comparison-bound.
- **Compressed and indexed search:** searching compressed text (without full decompression) and FM-index / suffix-automaton approaches change the game entirely when the *text* is fixed and many patterns are queried; Boyer-Moore is the online, no-text-index baseline these are measured against.

Foundational references: Boyer & Moore (1977) *A Fast String Searching Algorithm*; Horspool (1980) *Practical fast searching in strings*; Galil (1979) *On improving the worst case running time of the Boyer-Moore string matching algorithm*; Knuth, Morris & Pratt (1977) for the border/prefix-function theory; Cole (1994) *Tight bounds on the complexity of the Boyer-Moore string matching algorithm*; Apostolico & Giancarlo (1986) for the comparison-optimal variant; Yao (1979) *The complexity of pattern matching for a random string*; Crochemore & Perrin (1991) for Two-Way; Commentz-Walter (1979) for multi-pattern; Gusfield (1997) *Algorithms on Strings, Trees, and Sequences* for the modern unified treatment. Sibling topics: `01-kmp`, `09-horspool`.

# Boyer-Moore-Horspool — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Horspool Shift Table, Formally
3. Shift Correctness: The Shift Never Skips a Match
4. Termination and the Positive-Shift Guarantee
5. Worst-Case Analysis: The O(nm) Construction
6. Average-Case Analysis: Expected Shift and Expected Comparisons
7. The Sunday Variant: Correctness and Shift Bound
8. Preprocessing Complexity: O(m + sigma)
9. Relationship to Full Boyer-Moore and KMP
10. Lower Bounds and the Comparison Model
11. Extensions, Invariants, and Verification
12. Summary

---

## 1. Formal Definitions

Let `T = T[0..n-1]` be the **text** and `P = P[0..m-1]` the **pattern**, strings over a finite alphabet `Σ` with `|Σ| = σ`. We assume `1 ≤ m ≤ n`.

**Definition 1.1 (Occurrence).** `P` **occurs** at position `i` of `T` (an *alignment*) if `0 ≤ i ≤ n - m` and `T[i + j] = P[j]` for all `0 ≤ j < m`. The set of occurrences is `Occ(T, P) = { i : P occurs at i }`.

**Definition 1.2 (Window).** The **window** at alignment `i` is the substring `T[i..i+m-1]`. Its **last position** is `i + m - 1`, holding the **window-last character** `c_i := T[i + m - 1]`.

**Definition 1.3 (Rightmost occurrence).** For a character `a ∈ Σ`, define
```
rightmost_P[a] = max { j : 0 ≤ j ≤ m-2 and P[j] = a }   (or undefined if no such j).
```
The maximum is taken over `0 ≤ j ≤ m-2`, i.e. **excluding the last position** `m-1`. This exclusion is structural to Horspool (Definition 2.1) and is the source of the termination guarantee (Section 4).

**Definition 1.4 (Shift / alignment increment).** A search algorithm processes alignments `i₀ = 0 < i₁ < i₂ < …` where `i_{k+1} = i_k + s_k` for a strictly positive **shift** `s_k > 0`. Correctness requires that no `i ∈ Occ(T, P)` is skipped: for every occurrence `i`, some `i_k = i`.

**Remark.** Horspool is a *single-rule* member of the Boyer-Moore family: its shift `s_k` depends only on the window-last character `c_{i_k}`, not on where (or whether) a mismatch occurred. Sections 3-4 prove this single rule is both safe (skips no occurrence) and productive (`s_k ≥ 1`).

**Definition 1.5 (Comparison model).** We work in the standard **comparison model**: the only operation on characters is the equality test `T[a] == P[b]`, charged unit cost. The complexity measures of interest are the number of such comparisons and the number of outer-loop alignments. Table lookups `shift[a]` are `O(1)` (array indexing or a hash with `O(1)` expected access). This is the model in which both the worst-case (Section 5) and the average-case (Section 6) results, and Yao's lower bound (Section 10), are stated.

**Definition 1.6 (Period and border).** A **border** of `P` is a string that is both a proper prefix and a proper suffix of `P`. The smallest period `per(P)` is `m` minus the length of the longest border. Periods are central to the *full* Boyer-Moore good-suffix rule (and to KMP's failure function); Horspool ignores them entirely, which both simplifies it and forfeits the period-based worst-case bound (Sections 5, 9). We record the definition here because the contrast in Section 9 is sharpest when stated in terms of which structural invariant each algorithm exploits: KMP exploits borders of the matched prefix, Boyer-Moore exploits borders of the matched suffix, and Horspool exploits neither.

---

## 2. The Horspool Shift Table, Formally

**Definition 2.1 (Horspool shift function).** The Horspool shift table `shift : Σ → {1, …, m}` is
```
shift[a] = m - 1 - rightmost_P[a]     if rightmost_P[a] is defined,
shift[a] = m                          otherwise.
```
Equivalently, `shift[a]` is the distance from the last position `m-1` to the rightmost occurrence of `a` in `P[0..m-2]`, or the full window length `m` if `a` does not occur there.

**Lemma 2.2 (Range).** For every `a ∈ Σ`, `1 ≤ shift[a] ≤ m`.

**Proof.** If `rightmost_P[a]` is undefined, `shift[a] = m`. Otherwise `rightmost_P[a] = j` with `0 ≤ j ≤ m-2`, so `shift[a] = m - 1 - j ∈ {1, …, m-1}` (taking `j = m-2` gives `1`, `j = 0` gives `m-1`). In all cases `shift[a] ∈ {1, …, m}`. ∎

The lower bound `1` is the **positive-shift guarantee** that makes the algorithm terminate (Section 4); it is a *direct consequence of excluding the last position* in Definition 1.3.

### 2.1 Worked Table Construction

Let `P = "GCAGAGAG"` (`m = 8`) over `Σ = {A, C, G, T}`. Build `shift` by scanning `P[0..6]` (excluding the last `G` at index 7):

```
P =  G C A G A G A G
idx  0 1 2 3 4 5 6 7

default shift[a] = 8 for every a

j=0: P[0]='G' -> shift['G'] = 8-1-0 = 7
j=1: P[1]='C' -> shift['C'] = 8-1-1 = 6
j=2: P[2]='A' -> shift['A'] = 8-1-2 = 5
j=3: P[3]='G' -> shift['G'] = 8-1-3 = 4   (overwrites 7)
j=4: P[4]='A' -> shift['A'] = 8-1-4 = 3   (overwrites 5)
j=5: P[5]='G' -> shift['G'] = 8-1-5 = 2   (overwrites 4)
j=6: P[6]='A' -> shift['A'] = 8-1-6 = 1   (overwrites 3)

Result: shift['A']=1, shift['C']=6, shift['G']=2, shift['T']=8 (default)
```

Observe the **rightmost-occurrence-wins** law in action: `A`, `G` each appear several times, and only the largest index `j` survives, giving the smallest safe shift for that character. The last `G` (index 7) is never used as a `j`, so it cannot drive `shift['G']` to `0`. The character `T` does not occur in `P[0..6]`, so it keeps the default `8` — a window whose last char is `T` can be slid entirely past. This single example exercises every clause of Definition 2.1.

### 2.2 The Table as a Function on the Window-Last Position

It is worth restating Definition 2.1 operationally. Fix the last position `m-1`. The table answers: *"to make the character currently at text position `i+m-1` line up with an equal pattern character after the shift, how far must I move the pattern, minimally and safely?"* The answer is the gap from `m-1` to the nearest equal character to its left (`m-1 - rightmost_P[a]`), or the full `m` if there is none. This is the **occurrence heuristic of Boyer-Moore frozen at position `m-1`** — the precise sense in which Horspool is a degenerate Boyer-Moore (Section 9). The freezing is what collapses Boyer-Moore's 2-D `badchar[c][j]` table to Horspool's 1-D `shift[c]`.

**Algorithm (Horspool search).**
```
HORSPOOL(T, P):
  build shift[] per Definition 2.1
  i := 0
  while i ≤ n - m:
    j := m - 1
    while j ≥ 0 and T[i+j] == P[j]: j := j - 1
    if j < 0: report occurrence at i
    i := i + shift[ T[i + m - 1] ]
  // shift uses the window-last char on BOTH match and mismatch
```

**Observation 2.3 (1-D vs 2-D table).** The full Boyer-Moore bad-character rule conceptually needs a 2-D table `badchar[c][j]` (shift when character `c` mismatches at pattern position `j`), or a 1-D `last[c]` queried relative to the mismatch position `j`. Horspool fixes the query position to `m-1`, collapsing the dependence on `j` and leaving a pure 1-D `shift[c]`. This is the formal sense in which Horspool *uses less information*: it discards the mismatch position. The discarded information is exactly what could have produced a larger shift (Proposition 9.1), and exactly what the good-suffix rule would have layered on top — both omitted for the sake of a single small table.

---

## 3. Shift Correctness: The Shift Never Skips a Match

We prove the central safety property: advancing by `shift[c_i]` never steps over an occurrence.

**Theorem 3.1 (Safety / no skipped occurrence).** Fix an alignment `i` with `0 ≤ i ≤ n - m`, and let `c = T[i + m - 1]` be the window-last character. Then there is **no occurrence of `P` at any alignment `i'` with `i < i' < i + shift[c]`**.

**Proof.** Suppose, for contradiction, that `P` occurs at some `i'` with `i < i' < i + shift[c]`. Since `P` occurs at `i'`, for every `0 ≤ j < m` we have `T[i' + j] = P[j]`. Consider the text position `p = i + m - 1` (the window-last position of alignment `i`), which holds character `c`. Because `i < i' ≤ i + shift[c] - 1`, the position `p = i + m - 1` lies within the window of alignment `i'`; precisely, its offset inside that window is
```
ℓ = p - i' = (i + m - 1) - i'.
```
From `i < i'` we get `ℓ ≤ m - 2`, and from `i' < i + shift[c]` we get `ℓ = (i + m - 1) - i' > (i + m - 1) - (i + shift[c]) = m - 1 - shift[c]`, i.e. `ℓ ≥ m - shift[c]`. Since `P` occurs at `i'`, the character at offset `ℓ` of the pattern equals `c`: `P[ℓ] = T[i' + ℓ] = T[p] = c`, with `0 ≤ ℓ ≤ m - 2`.

So `c` occurs in `P[0..m-2]` at position `ℓ`, hence `rightmost_P[c] ≥ ℓ`, giving `shift[c] = m - 1 - rightmost_P[c] ≤ m - 1 - ℓ`. Combined with `ℓ ≥ m - shift[c]`, i.e. `shift[c] ≥ m - ℓ`, we get `m - ℓ ≤ shift[c] ≤ m - 1 - ℓ`, a contradiction (`m - ℓ > m - 1 - ℓ`). Therefore no such `i'` exists. ∎

**Corollary 3.2 (Total correctness of occurrence reporting).** `HORSPOOL(T, P)` reports exactly `Occ(T, P)`.

**Proof.** *Soundness:* the algorithm reports `i` only after verifying `T[i+j] = P[j]` for all `j` (the inner loop ran to `j < 0`), so every reported `i` is a true occurrence. *Completeness:* the alignments visited are `0 = i₀ < i₁ < …`, and by Theorem 3.1 no occurrence lies strictly between consecutive visited alignments. The first visited alignment is `0` and the loop stops only when `i > n - m` (past the last possible alignment). Hence every occurrence in `[0, n-m]` is visited and (being a true occurrence) reported. ∎

Note the proof of Theorem 3.1 used `c = T[i+m-1]` regardless of whether alignment `i` matched — establishing that the **same uniform shift is safe on both match and mismatch**, which is what licenses Horspool's single-branch loop body.

### 3.1 Worked Safety Illustration

Let `P = "abc"` and consider a window at `i` whose last char is `c = T[i+2] = 'a'`. The table gives `shift['a'] = 2` (from `j=0`). Theorem 3.1 claims no occurrence lies at `i+1` (the only alignment strictly between `i` and `i + 2`). Suppose, for contradiction, `P` occurred at `i+1`: then `T[i+1] = 'a'`, `T[i+2] = 'b'`, `T[i+3] = 'c'`. But we assumed `T[i+2] = 'a'`, contradicting `T[i+2] = 'b'`. So indeed no occurrence at `i+1`, and shifting by `2` is safe. The general proof simply formalizes "the window-last character we observed would have to be a different character for an in-gap occurrence to exist."

The contrapositive view is illuminating: `shift['a'] = 2` *because* the rightmost `'a'` in `P[0..1]` is at index `0`, i.e. `'a'` must move `2` places to re-align. Any smaller shift (`1`) would place that observed `'a'` against `P[1] = 'b' ≠ 'a'`, which can never match — so a smaller shift could only land on a guaranteed non-match, never skipping a real one but wasting effort. The table computes the *largest* shift that is still safe, which is the source of Horspool's efficiency.

---

## 4. Termination and the Positive-Shift Guarantee

**Theorem 4.1 (Termination).** `HORSPOOL` halts after at most `n` iterations of the outer loop.

**Proof.** By Lemma 2.2, every shift satisfies `shift[c] ≥ 1`, so `i` strictly increases by at least `1` per outer iteration. Starting at `i = 0` and stopping when `i > n - m`, the loop executes at most `n - m + 1 ≤ n` times. ∎

The positive-shift guarantee is *exactly* why the last position is excluded in Definition 1.3. If we had defined `rightmost_P[a] = max{ j : 0 ≤ j ≤ m-1, P[j] = a }` (including the last position), then for `a = P[m-1]` we would get `rightmost_P[a] = m-1` and `shift[a] = 0`, so a window whose last character equals `P[m-1]` (which is *always* the case on a full match, and often on a near-match) would produce a zero shift and an **infinite loop**. The exclusion is not an optimization; it is a correctness requirement.

### 4.1 The Subtle Bug This Prevents

A telling property of the include-the-last-char bug is that it *passes many tests*. Consider `P = "abc"` built incorrectly with the last char included: `shift['a'] = 2`, `shift['b'] = 1`, `shift['c'] = 3-1-2 = 0`. Searching `"abc"` in `"xyzabc"`:

```
i=0: window "xyz", last char 'z', shift['z']=3 (default) -> i=3
i=3: window "abc", match! last char 'c', shift['c']=0 -> i=3  (STUCK)
```

The loop hangs *only after finding a match whose window-last char is `P[m-1]`* — which is every match, and any window ending in the pattern's last character. A test suite that searches for absent patterns, or whose matches happen to end before the loop re-examines them, will not trigger it. This is why `senior.md` prescribes a *specific* regression test: a pattern ending in a character that appears only at the end, searched in a text saturated with that character. The exclusion (Theorem 4.1) is the formal guarantee; the regression test is its empirical guard.

### 4.2 Termination Is Independent of the Alphabet

Note that Theorem 4.1's bound `≤ n` outer iterations holds for *any* alphabet and *any* input, including the worst case — termination and worst-case-time are separate guarantees. Horspool always *halts*; it merely halts slowly (`O(nm)`) on adversarial input. This distinction matters in a service context: a missing fallback (Section 5, `senior.md`) yields a slow request, never a hung one, so the failure mode is degraded latency, not a permanent stall — assuming the table was built correctly (Section 4.1). The two guarantees compose: correct table ⇒ halts; correct table + benign input ⇒ halts fast.

---

## 5. Worst-Case Analysis: The O(nm) Construction

**Theorem 5.1 (Worst-case time).** `HORSPOOL` runs in `O(nm)` time in the worst case, and this bound is tight.

**Proof (upper bound).** Each outer iteration does at most `m` character comparisons (the inner right-to-left loop) plus an `O(1)` shift lookup. By Theorem 4.1 there are at most `n` outer iterations. Total comparisons `≤ nm`, so time is `O(nm)` (plus `O(m + σ)` preprocessing, dominated for `n ≥ σ`). 

**Proof (tightness — explicit construction).** Take `Σ = {a}`, `P = a^m`, `T = a^n`. Then:
- The shift table: for `j = 0..m-2`, `shift[a] = m - 1 - j`; the rightmost is `j = m-2`, giving `shift[a] = 1`. So every shift is `1`.
- At every alignment `i ≤ n - m`, the inner loop compares all `m` characters (they all equal `a`), reports a match, and shifts by `1`.
- There are `n - m + 1` alignments, each doing `m` comparisons: total `m(n - m + 1) = Θ(nm)` for `m = Θ(n/2)` (e.g. `m = n/2` gives `Θ(n²/4)`). ∎

**Remark (the role of the dropped good-suffix rule).** Full Boyer-Moore avoids this blow-up: after matching the suffix `a^m`, the good-suffix rule (with Galil's modification) shifts by the period of `P` and remembers already-matched characters, yielding `O(n + m)`. Horspool, lacking both, re-compares the entire window each time. The `O(nm)` worst case is precisely the price of dropping the good-suffix rule and the match-memory it enables.

**A near-match adversary.** `P = a^{m-1}b`, `T = a^n` is also instructive: every window mismatches at the *first* compared character (`P[m-1] = b ≠ a = T[i+m-1]`), so each alignment does a single comparison and shifts by `shift[a]`. Here `shift[a] = m - 1 - (m-2) = 1`, so there are `Θ(n)` alignments with `O(1)` work each — `Θ(n)` total. This shows the worst case needs *both* small shifts *and* long comparisons; small shifts alone (with quick mismatches) stay linear.

### 5.1 Worked Quadratic Trace

Take `P = "aaa"` (`m = 3`), `T = "aaaaaa"` (`n = 6`). Table: scanning `P[0..1]`, `shift['a'] = 3-1-1 = 1` (rightmost at `j=1`). Default for any other char is `3`, but `T` contains only `'a'`.

```
i=0: compare P[2]=a vs T[2]=a ✓; P[1]=a vs T[1]=a ✓; P[0]=a vs T[0]=a ✓  -> MATCH (3 compares)
     shift['a']=1 -> i=1
i=1: P[2]=a vs T[3]=a ✓; P[1]=a vs T[2]=a ✓; P[0]=a vs T[1]=a ✓          -> MATCH (3 compares)
     shift['a']=1 -> i=2
i=2: ... MATCH (3 compares), i=3
i=3: ... MATCH (3 compares), i=4 (i = n-m = 3 is the last valid; i=4 > 3 stops? n-m=3)
```

There are `n - m + 1 = 4` alignments, each doing `m = 3` comparisons: `12 = m(n-m+1)` total, matching `Θ(nm)`. Every shift is `1` because the rightmost `'a'` sits at `j = m-2`, the closest possible to the excluded last position. No matter how the table is built, an all-same-character pattern forces `shift = 1`, and an all-same-character text forces every comparison to succeed until the front — the two ingredients of the quadratic worst case. This is precisely the input on which the good-suffix rule of full Boyer-Moore would shift by `per(P) = 1`... but *remember* the already-matched suffix and skip re-comparing it (Galil's rule), reducing total comparisons to `O(n + m)`. Horspool has no such memory, so it re-compares from scratch every time.

---

## 6. Average-Case Analysis: Expected Shift and Expected Comparisons

We model `T` as i.i.d. uniform over `Σ` (the standard analysis), with `P` fixed. We compute the **expected shift per alignment** and the **expected comparisons**, both governed by `σ`.

**Lemma 6.1 (Expected shift).** Let the window-last character `c` be uniform over `Σ`. Then
```
E[shift] = (1/σ) Σ_{a ∈ Σ} shift[a].
```
For a pattern in which the `m-1` characters `P[0..m-2]` are distinct and `σ ≫ m`, a fraction `≈ (m-1)/σ` of characters have a small shift (`1..m-1`, averaging `≈ m/2`), and a fraction `≈ 1 - (m-1)/σ` have the full shift `m`. Hence
```
E[shift] ≈ ( (m-1)/σ )·(m/2) + ( 1 - (m-1)/σ )·m  =  m · ( 1 - (m-1)/(2σ) ).
```

**Proof.** Direct expectation over the uniform `c`, splitting Σ into characters occurring in `P[0..m-2]` (small shift) and not (shift `m`), using the stated distinct-character approximation for the small-shift average. ∎

**Interpretation.** For `σ ≫ m`, `E[shift] ≈ m`: each step jumps nearly the full pattern length, so the number of alignments is `≈ n/m`. For `σ` comparable to or smaller than `m`, the `(m-1)/(2σ)` correction grows, `E[shift]` shrinks, and the number of alignments rises — formalizing why small alphabets (DNA) hurt Horspool.

**Theorem 6.2 (Expected character comparisons).** Under the uniform-text model, the expected total number of character comparisons performed by Horspool is
```
E[comparisons] = Θ( n / E[shift] · E[compares-per-window] ) = Θ( n · (1/m + 1/σ) )   (for σ ≳ m),
```
which is `O(n)` and, for large `σ` and `m`, **sub-linear in the sense that the constant `1/m + 1/σ` is small** — far fewer than `n` comparisons in total.

**Proof sketch.** The number of windows is `≈ n / E[shift] ≈ n/m` for `σ ≳ m` (Lemma 6.1). Per window, the right-to-left compare terminates at the first mismatch; the probability of needing `> r` comparisons is `σ^{-r}` (each compared character must match by chance), so the expected comparisons per window is `Σ_{r≥1} σ^{-(r-1)} = σ/(σ-1) = 1 + 1/(σ-1) ≈ 1`. Multiplying windows by per-window comparisons gives `≈ (n/m)·(1 + 1/(σ-1))`, i.e. `Θ(n(1/m + 1/σ))`. ∎

**Corollary 6.3 (Best regime).** Horspool is fastest when `σ` is large and `m` is moderately large: then `E[shift] ≈ m`, windows `≈ n/m`, and comparisons `≈ n/m` — strongly sub-linear in comparisons examined. This matches the empirical "tracks full Boyer-Moore" behavior of `middle.md`.

The classical result (Baeza-Yates, and Horspool's own analysis) is that the expected running time is `O(n/m)` window-steps for large alphabets, with the constant degrading gracefully as `σ → m` and collapsing to the `O(nm)` worst case only on the adversarial small-shift inputs of Section 5.

### 6.1 Worked Expected-Shift Calculation

Take `m = 5` and a pattern with five distinct characters over `σ = 26` (lowercase letters), e.g. `P = "vwxyz"`. The table:

```
shift['v'] = 5-1-0 = 4,  shift['w'] = 3,  shift['x'] = 2,  shift['y'] = 1,
shift['z'] = 5 (default; the last char 'z' is excluded, and 'z' occurs nowhere in P[0..3]),
shift[a]   = 5 for all 21 other letters.
```

Then `E[shift] = (1/26)( 4 + 3 + 2 + 1 + 5·22 ) = (1/26)(10 + 110) = 120/26 ≈ 4.62`. The formula of Lemma 6.1 predicts `m(1 - (m-1)/(2σ)) = 5(1 - 4/52) = 5·0.923 = 4.62` — an exact match. So the window advances by `≈ 4.62` of its `5` positions each step: nearly the whole pattern. The expected number of alignments over a text of length `n` is `≈ n / 4.62 ≈ 0.217 n`, and with `≈ 1` comparison per alignment (the last char usually mismatches), total comparisons `≈ 0.22 n` — strongly sub-linear, exactly as Corollary 6.3 promises.

### 6.2 The Degradation Curve as σ Shrinks

Hold `m = 8` and vary `σ`, using the approximation `E[shift] ≈ m(1 - (m-1)/(2σ))`:

| `σ` | `E[shift]` (approx) | alignments `≈ n / E[shift]` | regime |
|-----|---------------------|------------------------------|--------|
| 256 | `8(1 - 7/512) ≈ 7.89` | `≈ 0.127 n` | excellent (byte text) |
| 26 | `8(1 - 7/52) ≈ 6.92` | `≈ 0.145 n` | good (English letters) |
| 8 | `8(1 - 7/16) ≈ 4.50` | `≈ 0.222 n` | moderate |
| 4 | `8(1 - 7/8) ≈ 1.00` | `≈ n` | poor (DNA — near naive) |
| 2 | `8(1 - 7/4) < 0` (formula breaks; clamp) | `≈ n` | binary — naive-like |

The table makes the `senior.md` claim quantitative: at `σ = 4` (DNA), the expected shift collapses to `≈ 1`, the algorithm visits `≈ n` alignments, and Horspool offers essentially no advantage over naive — which is why the `q`-gram trick (enlarge the effective alphabet to `σ^q`) is the standard rescue. The formula even predicts a *negative* `E[shift]` for very small `σ` and large `m`; this simply signals that the distinct-character assumption of Lemma 6.1 fails (a length-8 pattern over a 2-letter alphabet must repeat characters heavily), and the true `E[shift]` is clamped to its real value near `1`.

### 6.3 Why "Sub-Linear in Comparisons" Is Not a Contradiction

A reader sometimes objects: "every text character must be looked at, so how can comparisons be sub-linear?" The resolution is that Horspool does **not** look at every text character. When the window slides by `s`, the `s - 1` characters strictly between the old and new window-last positions that were not compared are simply *never examined*. Only the window-last char (for the shift) and the few right-end characters compared per window are touched. For large alphabets the shift is `≈ m`, so roughly one in `m` characters is examined — genuinely sub-linear. This is the same phenomenon that makes Boyer-Moore sub-linear, and it is the precise content of Theorem 6.2's `Θ(n(1/m + 1/σ))`.

---

## 7. The Sunday Variant: Correctness and Shift Bound

The **Sunday** algorithm (Sunday 1990) keys the shift on the character **one position past** the window, `T[i + m]`, and includes the last pattern position in its table.

**Definition 7.1 (Sunday shift function).** Define
```
rightmostS_P[a] = max { j : 0 ≤ j ≤ m-1 and P[j] = a }   (includes the last position),
shiftS[a] = m - rightmostS_P[a]      if defined,
shiftS[a] = m + 1                     otherwise.
```

**Lemma 7.2 (Sunday range).** `1 ≤ shiftS[a] ≤ m + 1` for all `a`.

**Proof.** If `a ∉ P`, `shiftS[a] = m + 1`. Else `rightmostS_P[a] = j ∈ {0, …, m-1}`, so `shiftS[a] = m - j ∈ {1, …, m}`. Taking `j = m-1` gives `1`; `j = 0` gives `m`; absence gives `m+1`. Hence `shiftS[a] ∈ {1, …, m+1}`. ∎

The positive lower bound `1` holds even though Sunday *includes* the last position, because the formula is `m - j` (not `m-1-j`): the smallest value, at `j = m-1`, is `1`, never `0`. So Sunday terminates without excluding any position.

**Theorem 7.3 (Sunday safety).** Fix alignment `i` with `i + m ≤ n - 1` (so `T[i+m]` exists), and let `d = T[i + m]`. Then no occurrence of `P` lies at any alignment `i'` with `i < i' < i + shiftS[d]`.

**Proof.** Suppose `P` occurs at `i'` with `i < i' ≤ i + shiftS[d] - 1`. The text position `q = i + m` holds `d`. Since `i < i' ≤ i + shiftS[d] - 1` and `shiftS[d] ≤ m+1`, we have `i' ≤ i + m`, so `q = i + m` lies within or at the right end of the window of `i'`: its offset is `ℓ = q - i' = (i + m) - i'`, with `0 ≤ ℓ ≤ m - 1` (the lower bound from `i' ≤ i + m`, the upper from `i < i'`). Because `P` occurs at `i'`, `P[ℓ] = T[i' + ℓ] = T[q] = d`, so `rightmostS_P[d] ≥ ℓ` and `shiftS[d] = m - rightmostS_P[d] ≤ m - ℓ`. But `i' ≤ i + shiftS[d] - 1` rearranges to `ℓ = (i+m) - i' ≥ (i+m) - (i + shiftS[d] - 1) = m - shiftS[d] + 1`, i.e. `shiftS[d] ≥ m - ℓ + 1`. Combining, `m - ℓ + 1 ≤ shiftS[d] ≤ m - ℓ`, a contradiction. ∎

**Shift advantage.** Sunday's maximum shift is `m + 1` (vs Horspool's `m`), achieved when `T[i+m] ∉ P`: the pattern can leap entirely past the window *and* the next character. This is why Sunday's expected shift is slightly larger; the expected-shift analysis mirrors Section 6 with `σ ≫ m` giving `E[shiftS] ≈ m + 1`.

**Worst case.** Sunday is also `O(nm)`: `P = a^m`, `T = a^n` gives `rightmostS_P[a] = m-1`, `shiftS[a] = 1`, and the same quadratic blow-up as Horspool.

### 7.1 Worked Sunday vs Horspool Shift Comparison

Take `P = "abc"` (`m = 3`) and a text whose window-last region is `...ab|x...` where `x ∉ P`. 

- **Horspool** keys on the window-last char (`'c'`'s slot, but here the last window char depends on alignment). Suppose the window is `"abY"` with `Y` the last char; Horspool uses `shift['Y']`. Its tables: `shift['a'] = 3-1-0 = 2`, `shift['b'] = 3-1-1 = 1`, `shift['c'] = 3` (default; last char excluded). Max shift `3`.
- **Sunday** keys on the char *past* the window. Its tables (include all): `shiftS['a'] = 3-0 = 3`, `shiftS['b'] = 3-1 = 2`, `shiftS['c'] = 3-2 = 1`, default `4`. Max shift `4`.

When the character past the window is some `x ∉ P`, Sunday shifts by the full `m + 1 = 4`, leaping the entire window plus one. Horspool, even in its best case, leaps only `m = 3`. The extra `+1` is exactly the off-by-one in the offset bounds of Theorems 3.1 and 7.3: Sunday's key character sits one position farther right, so the safe shift is one larger when that character is absent from the pattern. This is the entire mathematical content of "Sunday jumps slightly farther."

### 7.2 Sunday Termination

**Corollary 7.4 (Sunday termination).** Sunday halts in at most `n` outer iterations.

**Proof.** By Lemma 7.2 every `shiftS[a] ≥ 1`, so the alignment strictly increases each iteration; combined with the explicit end-of-text guard (`i + m ≥ n` stops the loop before an out-of-bounds key read), the loop runs at most `n - m + 1 ≤ n` times. ∎

Unlike Horspool, Sunday needs **no last-position exclusion** for termination: its formula `m - j` already yields minimum `1` at `j = m-1`. The exclusion in Horspool and the formula choice in Sunday are two different mechanisms achieving the same positive-shift guarantee.

### 7.3 Worked Sunday Search Trace

Search `P = "TEETH"` (`m = 5`) in `T = "TRUSTHARDTEETH"` (`n = 14`) with Sunday. Table (include all chars, `shift = m - j`): `T` appears at `j=0` and `j=3`, rightmost gives `shift['T'] = 5-3 = 2`; `E` at `j=1,2`, rightmost `shift['E'] = 5-2 = 3`; `H` at `j=4`, `shift['H'] = 5-4 = 1`; default `m+1 = 6`.

```
i=0: window T[0..4]="TRUST", char past = T[5]='H'. Compare l-to-r: T==T, R!=E mismatch.
     shift['H'] = 1 -> i = 1
i=1: window T[1..5]="RUSTH", char past = T[6]='A'. R!=T mismatch.
     shift['A'] = 6 (default) -> i = 7
i=7: window T[7..11]="RDTEE", char past = T[12]='T'. R!=T mismatch.
     shift['T'] = 2 -> i = 9
i=9: window T[9..13]="TEETH", char past = i+m=14 >= n -> but first compare: full match! report 9.
     i+m=14 >= n=14 -> stop.
```

Sunday found the match at `9` in four alignments, leaping `6` at `i=1` (the char past the window, `'A'`, is absent from `P`). The same search under Horspool (`junior.md`) keyed on the window-last char and produced a comparable but distinct sequence of shifts — both correct, Sunday's `i=1→7` jump of `6` exceeding any Horspool shift of `≤ 5`, illustrating the `m+1` advantage concretely.

---

## 8. Preprocessing Complexity: O(m + sigma)

**Theorem 8.1.** Building the Horspool (or Sunday) shift table takes `Θ(m + σ)` time and `Θ(σ)` space (for an array table) or `Θ(min(m, σ))` space (for a map keyed on occurring characters).

**Proof.** *Array table:* initialize all `σ` entries to the default (`m` or `m+1`) — `Θ(σ)` — then scan the `m-1` (Horspool) or `m` (Sunday) relevant pattern positions, each a `Θ(1)` update — `Θ(m)`. Total `Θ(m + σ)` time, `Θ(σ)` space. *Map table:* skip the `Θ(σ)` fill; insert only the distinct occurring characters (`≤ min(m, σ)`), applying the default on lookup miss — `Θ(m)` time, `Θ(min(m, σ))` space, at the cost of hashing per access. ∎

**Corollary 8.2 (Total search cost).** End-to-end, Horspool is `Θ(m + σ)` preprocessing plus the search (`O(n(1/m + 1/σ))` expected, `O(nm)` worst). For `n ≥ σ` and a single search, search dominates; for repeated searches of one pattern, amortize the preprocessing across calls.

**Worked preprocessing trace.** For `P = "GCAGAGAG"` over the byte alphabet (`σ = 256`): the array fill writes `256` defaults (`8` each), then `7` overwrites for `j = 0..6`. Total `263` writes — `Θ(m + σ)` with the `σ` term dominating because `m ≪ σ`. Over a DNA-only alphabet (`σ = 4`), it is `4 + 7 = 11` writes; over a map keyed on occurring characters, only `3` distinct keys (`A, C, G`) are inserted. The three representations span the `Θ(σ)` / `Θ(σ)` / `Θ(min(m,σ))` spectrum of Theorem 8.1, and the choice is dictated by `σ` exactly as Section 8.2 argues.

The `Θ(σ)` array-fill is why production code special-cases tiny patterns (`middle.md`, `senior.md`): when `m` is small, the `σ = 256` fill can exceed the search work, so a brute-force scan that builds no table is faster.

### 8.1 The Crossover Where Preprocessing Dominates

Let the per-search work be `≈ c_s · n / m` comparisons (large-`σ` average, Section 6) and preprocessing be `≈ c_p · (m + σ)`. Preprocessing dominates when `c_p(m + σ) ≳ c_s · n / m`. For a single search with `m` small and `σ = 256`, the right side is `≈ c_s · n / m` and the left is `≈ c_p · σ`. Setting them equal, the search is worth the table build only when

```
n ≳ (c_p / c_s) · σ · m.
```

For `σ = 256`, `m = 3`, and roughly equal constants, the table pays off only once `n` exceeds a few thousand characters. Below that, a no-table brute-force or `memchr` wins — the formal justification for the `m ≤ 3` dispatch branch in `senior.md`. For repeated searches of the *same* pattern across `Q` texts, the build amortizes to `c_p(m+σ)/Q` per search and the threshold drops sharply, which is why a search *object* that retains its table beats a stateless `search(text, pattern)` call at scale.

### 8.2 Map vs Array: A Formal Trade

The array table is `Θ(σ)` space and `O(1)` worst-case lookup; the map table is `Θ(min(m, σ))` space and `O(1)` *expected* lookup with a worse constant (hashing). For `σ = 256` the array is unbeatable (1 KB, L1-resident). For `σ` in the thousands-to-millions (Unicode code points), the array is wasteful or infeasible, and the map's `Θ(min(m, σ)) = Θ(m)` space (a pattern has at most `m` distinct characters) is the only scalable option — though the production answer is usually to sidestep the large alphabet entirely by searching the UTF-8 byte stream with the 256-entry array (`senior.md`, Section 3.2). The asymptotic choice is thus almost always resolved in favor of the byte array by an *encoding* trick rather than by the alphabet's nominal size.

---

## 9. Relationship to Full Boyer-Moore and KMP

**Horspool as a degenerate Boyer-Moore.** Full Boyer-Moore (sibling `08`) shifts by `max(badchar_shift, goodsuffix_shift)`. Horspool's rule is a *simplification of the bad-character rule*: rather than keying on the mismatched character and its mismatch position `j` (Boyer-Moore's `badchar[c][j]`-style information), Horspool keys uniformly on the window-last character `c = T[i+m-1]`. Formally, Horspool's shift equals Boyer-Moore's "occurrence heuristic" applied at the fixed position `m-1` instead of at the actual mismatch — strictly less information, hence sometimes smaller shifts, but a single 1-D table instead of a 2-D one and no good-suffix table.

| | KMP (`01`) | Boyer-Moore (`08`) | Horspool | Sunday |
|---|-----------|---------------------|----------|--------|
| Shift information | matched prefix (failure fn) | mismatched char + matched suffix | window-last char | char past window |
| Tables | `π[0..m-1]` | bad-char + good-suffix | one bad-char | one bad-char |
| Preprocessing | `Θ(m)` | `Θ(m + σ)` | `Θ(m + σ)` | `Θ(m + σ)` |
| Worst case | `Θ(n+m)` | `Θ(n+m)` (Galil) | `Θ(nm)` | `Θ(nm)` |
| Expected (large σ) | `Θ(n)` | `Θ(n/m)`-ish | `Θ(n/m)`-ish | `Θ(n/m)`-ish |

**KMP contrast.** KMP (sibling `01`) computes a **failure function** `π` from `P` and scans `T` left-to-right, never re-reading a text character, giving a guaranteed `Θ(n + m)`. It *never skips text* — it cannot, because it only uses information about the matched *prefix*. Horspool's right-to-left scan and bad-character skip can leap over text entirely (sub-linear comparisons), at the cost of KMP's worst-case guarantee. The two occupy opposite corners: KMP trades skipping for a hard linear bound; Horspool trades the bound for skipping.

**Worked KMP-vs-Horspool contrast.** Search `P = "abcd"` in `T = "xxxxabcd"` (`n = 8`).

- *KMP* scans left-to-right: it reads `x` (mismatch with `a`, `π` keeps it at the start) four times, then matches `a,b,c,d` — examining all `8` characters, `8` comparisons. It *never* looks ahead and *never* skips.
- *Horspool* aligns at `i=0`, compares `P[3]='d'` vs `T[3]='x'` → mismatch, `shift['x'] = 4` (default, `x ∉ P`) → `i=4`; aligns at `i=4`, matches `d,c,b,a` (4 comparisons). Total `≈ 5` comparisons, having *skipped* `T[0..2]` without ever reading them.

The `4` characters Horspool skipped are exactly the text it never examined — the operational meaning of "sub-linear in comparisons." On the adversarial `P=a^m`, `T=a^n`, the roles reverse: KMP stays linear (failure function remembers the matched prefix), Horspool goes quadratic (no memory). The two algorithms are *complementary* extremes, and a robust system (Section 5, `senior.md`) combines them: Horspool's skips for the common case, a linear algorithm's guarantee for the tail.

**The good-suffix rule is exactly what Horspool sacrifices.** Both full Boyer-Moore's `O(n+m)` bound (Section 5) and its ability to remember matched suffixes come from the good-suffix rule. Removing it gives Horspool its simplicity (one 1-D table, no suffix preprocessing) and its `O(nm)` worst case in one stroke.

### 9.1 A Lattice of Trade-Offs

The four algorithms occupy distinct points in a two-axis design space — *information used per shift* (more = bigger skips, more code) versus *worst-case guarantee*:

```
                worst-case guaranteed O(n+m)?
                   NO                    YES
 more info  +--------------------+--------------------+
 per shift  | (none in family)   | Boyer-Moore (08)   |   <- bad-char + good-suffix + Galil
            |                    | Two-Way            |
            +--------------------+--------------------+
 less info  | Horspool, Sunday   | KMP (01)           |   <- KMP uses prefix borders, never skips
            +--------------------+--------------------+
```

Horspool and Sunday are the "less info, no guarantee" cell: they extract the *minimum* shift information (one character) and accept the quadratic tail. KMP is "less info, guaranteed": it also uses a single structural fact (the matched-prefix border) but, by scanning left-to-right and never skipping, it pays with examining every text character to *buy* the linear bound. Boyer-Moore and Two-Way are the "more info, guaranteed" cell — the best of both, at the cost of intricate preprocessing. The empty cell ("more info, no guarantee") is uninteresting: if you are already paying for rich shift information you may as well secure the worst-case bound. Horspool's design thesis is that for typical (non-adversarial, large-alphabet) inputs, the cheapest cell delivers nearly the throughput of the most expensive one.

### 9.2 Reduction Sketch: Horspool's Shift ≤ Boyer-Moore's Shift

**Proposition 9.1.** At any alignment, Horspool's shift is at most full Boyer-Moore's shift.

**Proof sketch.** Boyer-Moore takes `max(badchar, goodsuffix)`. Horspool's shift equals the bad-character occurrence heuristic *evaluated at position `m-1`*, which is `≤` the bad-character heuristic evaluated at the actual (possibly earlier) mismatch position, and `≤` the max with the good-suffix term. Hence Horspool never out-shifts Boyer-Moore. ∎ This formalizes "Horspool uses strictly less information, so its skips are never larger" — and yet, because evaluating the heuristic at `m-1` is *free* (one table, one lookup) while Boyer-Moore's richer shift costs a second table and trickier preprocessing, the throughput gap on real text is small. The proposition bounds the *theoretical* gap; Section 6 explains why the *practical* gap is negligible for large alphabets.

---

## 10. Lower Bounds and the Comparison Model

**Theorem 10.1 (Trivial lower bound).** Any comparison-based exact string matcher must, in the worst case, examine `Ω(n)` text characters when `m` is constant, and on average `Ω(n / m)` characters for a pattern that occurs rarely.

**Proof.** *Worst case:* an algorithm that does not inspect a text position cannot rule out an occurrence overlapping it; for `m` constant, ruling out occurrences across all of `T` needs `Ω(n)` inspections in the worst case. *Average:* the information-theoretic argument (Yao 1979) shows that to certify "no occurrence" in a region of length `m`, roughly `1` character usually suffices but at least `Ω(1/m · n)` over the whole text — Horspool's `Θ(n/m)` expected comparisons (Section 6) is therefore **average-case optimal** up to constants for large alphabets. ∎

**Yao's bound, precisely.** Yao (1979) proved that the expected number of character comparisons for exact matching of a random pattern in random text is `Θ(n log_σ m / m)`. Boyer-Moore-style algorithms, including Horspool, achieve `O(n/m)` comparisons for large `σ`, within a `log_σ m` factor of optimal and often matching it in practice. Horspool is thus not merely "fast in practice" — it is provably close to the comparison lower bound on the average, while paying for it with a non-optimal worst case.

**Where Horspool sits.** Horspool is *average-case near-optimal* (within constants/`log_σ m`) and *worst-case suboptimal* (`O(nm)` vs the achievable `O(n+m)`). The Boyer-Moore-Galil and Two-Way algorithms achieve both the good average and the optimal worst case, at the cost of the complexity Horspool was designed to avoid. The design point of Horspool is explicitly: *give up worst-case optimality to recover code simplicity, keeping average-case near-optimality.*

### 10.1 Reading Yao's Bound Carefully

Yao's `Θ(n log_σ m / m)` deserves unpacking. The `n/m` factor is the "skip nearly a whole pattern each step" intuition. The `log_σ m` factor is the *information* needed to confirm a non-match at a candidate position: distinguishing a length-`m` pattern from random text requires reading about `log_σ m` characters on average (the point at which the probability of a spurious agreement drops below a constant). Horspool reads `Θ(1)` characters per window on average (Theorem 6.2), and visits `Θ(n/m)` windows, giving `Θ(n/m)` — it is *below* Yao's bound's `log_σ m` factor in expected comparisons because it does not always confirm; it relies on the shift's safety (Theorem 3.1) to skip without confirming. The bound is therefore *not violated*: Yao counts comparisons needed to *certify all non-occurrences*, and Horspool's safety proof lets it certify gaps without per-character comparison. The takeaway: Horspool's efficiency comes from *not looking*, justified by the shift-safety theorem — the average-case analysis and the safety theorem are two halves of one story.

### 10.2 The Worst-Case Gap Is Provably Necessary for Single-Rule Algorithms

**Observation 10.2.** Any matcher whose shift depends on `O(1)` text characters and that re-compares windows without remembering past matches must be `Ω(nm)` in the worst case.

**Justification.** On `P = a^m`, `T = a^n`, every window fully agrees, so each must perform `m` comparisons unless the algorithm *remembers* that a suffix already matched. A shift rule reading `O(1)` characters cannot encode "how much of this window I already verified," so it must re-compare. With shifts bounded by the all-same-character forcing `shift = 1`, there are `Θ(n)` windows × `Θ(m)` comparisons. ∎ This shows Horspool's `O(nm)` is not a weakness of *this particular* simple rule but an inherent cost of the *single-character, memoryless* design class. Escaping it provably requires either suffix memory (good-suffix/Galil) or a fundamentally different structure (Two-Way's critical-factorization), both of which reintroduce the complexity Horspool sheds. The trade is therefore *fundamental*, not incidental.

---

## 11. Extensions, Invariants, and Verification

### 11.1 Loop Invariant for Mechanized Verification

To verify Horspool formally (or to reason about a refactor), the key loop invariant is:

```
INV(i):  every occurrence of P at a position < i has already been reported,
         and i strictly increases each iteration (Lemma 2.2),
         and 0 <= i (alignments stay in range).
```

`INV(0)` holds vacuously. The inductive step is exactly Theorem 3.1: shifting from `i` to `i + shift[T[i+m-1]]` reports any occurrence at `i` (if the window matched) and, by safety, leaves no unreported occurrence in `(i, i + shift[...])`. Termination (Theorem 4.1) plus `INV` at loop exit (`i > n - m`) yields total correctness (Corollary 3.2). This three-clause invariant is small enough to discharge in a proof assistant, and it isolates the two load-bearing lemmas (safety, positive shift) — a useful map for anyone porting Horspool to a verified codebase.

### 11.2 Character-Class Patterns

Horspool extends to patterns with **character classes** (e.g. `P = "a[bc]d"`, where position 1 matches `b` or `c`). The shift table must then record, for each alphabet character `a`, the rightmost pattern position (excluding the last) whose class *contains* `a`:

```
shift[a] = m - 1 - max { j : 0 ≤ j ≤ m-2 and a ∈ class(P[j]) }   (or m if none).
```

A character in several classes gets the smallest (rightmost-driven) shift among them. Safety (Theorem 3.1) still holds because the same offset argument applies to "the class containing the observed character." The cost is that broad classes (e.g. `.` matching everything) drive many shifts toward small values, degrading toward the small-alphabet regime of Section 6.2 — the wildcard is, in effect, an alphabet-of-size-1 collapse. This is why regex engines fall back from Horspool-style skipping when the pattern's prefix is too permissive.

### 11.3 Case-Insensitive Matching as an Alphabet Quotient

Case-insensitive Horspool (`senior.md`, Task 6) is the special case where the class of a letter is `{lowercase, uppercase}`. Equivalently, work over the **quotient alphabet** `Σ/~` where `a ~ b` iff they are case-variants, mapping every character through a normalization `nrm` before both the table build and the comparison. Correctness requires `nrm` be applied *consistently* to the table key and to the compared characters; the safety theorem then holds verbatim over `Σ/~`. The subtle bug is normalizing on one side only, which desynchronizes the shift from the comparison and silently skips matches — a failure the small-alphabet differential test (`tasks.md`, Task 5) is designed to catch.

### 11.4 Why Multiplicity (Multigraph Analogue) Does Not Arise

Unlike the matrix-power walk-counting topic (where parallel edges multiply counts), string matching has no "multiplicity": a position either matches or does not. The shift table carries no count, only a distance. This is why Horspool's algebra is far simpler than the semiring machinery of counting problems — there is a single Boolean predicate (`T[i+j] == P[j]`) and a single integer shift, with no accumulation. The entire theory reduces to the two theorems of Sections 3-4 plus the average/worst-case bounds; there is no richer algebraic structure to exploit or to get wrong.

### 11.5 Counting Occurrences and Overlap Correctness

**Proposition 11.1 (Overlap-safe occurrence reporting).** Running the algorithm to completion (shifting after each match by the same rule) reports *every* occurrence, including overlapping ones, exactly once.

**Proof.** By Corollary 3.2 the visited alignments are strictly increasing and no occurrence lies between consecutive visited alignments. Hence each occurrence `i ∈ Occ(T, P)` is visited exactly once (alignments are distinct) and reported (it is a true match, verified by the inner loop). Overlapping occurrences (e.g. `"aa"` at positions `0, 1, 2` in `"aaaa"`) are distinct alignments and are each visited because the shift between them is `≥ 1` and `≤` their separation — Theorem 3.1 guarantees none is jumped. ∎

A common implementation error is to shift by `m` (the pattern length) after a match "to avoid overlaps," which is *wrong* for overlap-inclusive counting and also unsafe (it can skip a non-overlapping occurrence that starts within the just-matched window). The correct rule is unconditional: always shift by `shift[T[i+m-1]]`, match or not. The overlap question is a *reporting policy*, not a shifting decision; if non-overlapping matches are desired, filter the reported positions afterward (`tasks.md`, Task 3), never by tampering with the safe shift.

### 11.6 Numerical Robustness Is a Non-Issue

A final foundational note: Horspool involves no floating point, no modular arithmetic, and no overflow risk beyond the shift index (bounded by `m + 1 ≤ n + 1`) and the table index (a character, bounded by `σ`). Compared to the counting/probability topics where overflow and rounding dominate the correctness discussion, Horspool's only arithmetic hazards are the *signed-byte index* (a representation bug, `senior.md` Section 6.1) and the *off-by-one in window bounds* (`i ≤ n - m`, and Sunday's `i + m < n`). Both are integer-indexing concerns, not numerical ones — the algorithm is exact by construction over any finite alphabet.

## 12. Summary

- **Shift table (Def. 2.1).** `shift[a] = m - 1 - rightmost_P[a]` over `P[0..m-2]` (last position excluded), default `m`. Range `[1, m]` (Lemma 2.2).
- **Safety (Thm 3.1).** Advancing by `shift[T[i+m-1]]` skips no occurrence — proved by deriving a contradiction from any occurrence in the skipped gap. The same proof works for match and mismatch, justifying the uniform single-branch loop.
- **Termination (Thm 4.1).** Every shift is `≥ 1` because the last position is excluded; the loop runs `≤ n` times. Including the last position would create a zero shift and an infinite loop — a correctness requirement, not an optimization.
- **Worst case (Thm 5.1).** `O(nm)`, tight via `P = a^m`, `T = a^n`; this is precisely the cost of dropping the good-suffix rule, which (with Galil) would have given `O(n+m)`.
- **Average case (Sec. 6).** Expected shift `≈ m(1 - (m-1)/(2σ))`; expected comparisons `Θ(n(1/m + 1/σ))` — sub-linear in comparisons for large `σ` and `m`, degrading as `σ → m`.
- **Sunday (Sec. 7).** Keys on `T[i+m]`, includes the last position, shift formula `m - j` with range `[1, m+1]`; safe by Theorem 7.3, max shift `m+1`, same `O(nm)` worst case.
- **Preprocessing (Sec. 8).** `Θ(m + σ)` time, `Θ(σ)` space (array) or `Θ(min(m,σ))` (map).
- **Family (Sec. 9).** Horspool is a degenerate Boyer-Moore (bad-character heuristic fixed at position `m-1`, no good-suffix). KMP (sibling `01`) is the opposite trade: never skips, guaranteed `Θ(n+m)`.
- **Optimality (Sec. 10).** Average-case near-optimal (Yao `Θ(n log_σ m / m)`); worst-case suboptimal. The deliberate design point: trade worst-case optimality for simplicity.
- **Extensions (Sec. 11).** A three-clause loop invariant suffices for mechanized verification; character classes, case-insensitivity (an alphabet quotient), and overlap-safe counting all follow from the same safety theorem without new machinery. Horspool has no multiplicity, no floating point, and no overflow beyond integer indexing.

### Proof-Dependency Map

The whole theory hangs on a short chain of lemmas; this map shows what depends on what:

```
Def 1.3 (exclude last position)
   └─> Lemma 2.2 (shift in [1, m])
          ├─> Thm 4.1 (termination)          ──┐
          └─> (used by) Thm 3.1 (safety)       │
Thm 3.1 (no skipped match)                      ├─> Cor 3.2 (total correctness)
   └─> Prop 11.1 (overlap-safe reporting)       │
Thm 4.1 + Cor 3.2 ─────────────────────────────┘
Thm 5.1 (O(nm) worst)  ⟺  Sec 9 (dropped good-suffix)  ⟺  Obs 10.2 (inherent to memoryless rules)
Lemma 6.1 (E[shift]) ─> Thm 6.2 (E[comparisons]) ─> Cor 6.3 (best regime) ─> Sec 10.1 (vs Yao)
Sec 7 (Sunday): Def 7.1 ─> Lemma 7.2 ─> Thm 7.3 (safety) + Cor 7.4 (termination)
```

Reading the map top-to-bottom: the *last-position exclusion* is the root of everything (it gives the positive shift, hence both termination and the safety argument's contradiction); *safety + termination* give correctness; the *worst case, the dropped rule, and the inherent-tail observation* are one fact three ways; and the *average-case chain* connects the expected shift to Yao's lower bound. Sunday re-derives safety and termination with its own off-by-one. Anyone auditing or porting Horspool need verify only these nodes.

The map also makes the *minimal* set of test obligations clear: a correctness test exercising Corollary 3.2 (differential vs naive), a termination/regression test exercising Theorem 4.1 (last-char-unique pattern), a worst-case test exercising Theorem 5.1 (`a^m`/`a^n`), and an overlap test exercising Proposition 11.1 — four tests covering the four leaf theorems, which is exactly the battery prescribed in `senior.md` and `tasks.md`.

### Complexity Cheat Table

| Quantity | Horspool | Sunday | Boyer-Moore (`08`) | KMP (`01`) |
|----------|----------|--------|---------------------|------------|
| Preprocess time | `Θ(m + σ)` | `Θ(m + σ)` | `Θ(m + σ)` | `Θ(m)` |
| Extra space | `Θ(σ)` | `Θ(σ)` | `Θ(m + σ)` | `Θ(m)` |
| Expected comparisons (large σ) | `Θ(n/m)` | `Θ(n/m)` | `Θ(n/m)` | `Θ(n)` |
| Worst-case time | `Θ(nm)` | `Θ(nm)` | `Θ(n+m)` (Galil) | `Θ(n+m)` |
| Max single shift | `m` | `m+1` | up to `m` | (no skip) |
| Skips text? | yes | yes | yes | no |

### Complexity by Regime

| Regime | `E[shift]` | Comparisons | Verdict |
|--------|-----------|-------------|---------|
| Large `σ` (bytes/English), moderate `m` | `≈ m` | `Θ(n/m)` | ideal — strongly sub-linear |
| Medium `σ`, large `m` | `≈ m` | `Θ(n/m)` | excellent |
| Small `σ` (DNA), any `m` | `≈ 1` | `Θ(n)` | poor — use `q`-gram or KMP |
| Adversarial (`a^m` / `a^n`) | `1` | `Θ(nm)` | worst — needs fallback |
| `m = 1` | n/a | `Θ(n)` | use `memchr` instead |
| Tiny `m` (`≤ 3`), single search | `≈ m` | `Θ(n/m)` but build dominates | brute force; skip table |

This table is the quantitative distillation of Sections 5-8: the average analysis (large/medium `σ`), the small-alphabet degradation (Section 6.2), the worst case (Section 5), and the preprocessing crossover (Section 8.1) — the complete performance map for choosing and tuning Horspool.

### Closing Notes

- The two theorems that *define* Horspool are **safety** (Thm 3.1: no skipped match) and **termination** (Thm 4.1: positive shift via last-position exclusion). Everything else is performance.
- The **`O(nm)` worst case and the dropped good-suffix rule are the same fact** viewed from two sides (Sec. 5, 9), and Observation 10.2 shows the quadratic tail is *inherent* to any memoryless single-character rule, not a defect of Horspool's particular choice.
- The **average-case near-optimality** (Sec. 6, 10) is the rigorous reason Horspool is fast in practice, not folklore — it sits within a `log_σ m` factor of Yao's comparison lower bound, and beats the bound's per-window factor by skipping without confirming (Sec. 10.1).
- The **safety theorem and the average-case analysis are two halves of one story**: Horspool is fast *because* it does not look at the skipped characters, and that is sound *because* the shift never skips a match.
- **Sunday** (Sec. 7) is Horspool shifted one position right in its key character, buying a `+1` on the maximum shift via the same off-by-one in the safety bound — no last-position exclusion needed because its `m - j` formula is already positive.

### One-Paragraph Synthesis

Horspool is the unique design point obtained by taking Boyer-Moore's occurrence heuristic, *freezing it at the last pattern position* (Observation 2.3) to collapse a 2-D table to 1-D, and *deleting the good-suffix rule*. The last-position exclusion (Definition 1.3) makes every shift positive (Lemma 2.2), which simultaneously guarantees termination (Theorem 4.1) and powers the contradiction in the safety proof (Theorem 3.1); together these give total correctness (Corollary 3.2), and overlap-safe counting (Proposition 11.1) falls out for free. The price is a quadratic worst case (Theorem 5.1) that is *inherent* to memoryless single-character rules (Observation 10.2), not specific to Horspool. The reward is average-case behavior within a `log_σ m` factor of Yao's lower bound (Section 10.1), achieved precisely by *not examining* the skipped characters — sound because of the safety theorem. Sunday is the same construction shifted one position right (Section 7). Everything else — alphabet engineering, dispatch, fallbacks — is the engineering layer (`senior.md`) built atop this two-theorem core.

Foundational references: R. N. Horspool (1980) original analysis; D. M. Sunday (1990); A. C. Yao, "The complexity of pattern matching for a random string" (*SIAM J. Comput.*, 1979) for the comparison lower bound; Baeza-Yates for average-case string-matching analysis; Boyer & Moore (1977) and Galil (1979) for the full algorithm and its linear bound; Crochemore-Perrin (Two-Way) for the optimal-both alternative. Sibling topics: `01-kmp`, `08-boyer-moore`.

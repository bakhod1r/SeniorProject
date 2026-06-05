# Manacher's Algorithm — Mathematical Foundations and Correctness Proofs

## Table of Contents
1. Formal Definitions
2. The `#`-Transform: A Length-Preserving Bijection
3. Palindrome Radius Functions and Their Properties
4. The Mirror Initialization: Correctness by Case Analysis
5. Expansion and the Box Invariant
6. The Linear-Time Proof: Amortized Analysis of the r-Pointer
7. Counting All Palindromic Substrings: Correctness
8. Distinct Palindromes and the Linear Bound
9. Relation to the Palindromic Tree (Eertree)
10. Lower Bounds and Optimality
11. Generalizations and Related Structure
12. Summary

---

## 1. Formal Definitions

Let `s = s[0..n-1]` be a string of length `n` over an alphabet `Σ`.

**Definition 1.1 (Substring).** `s[a..b]` for `0 ≤ a ≤ b ≤ n-1` is the contiguous block `s[a] s[a+1] … s[b]`, of length `b - a + 1`.

**Definition 1.2 (Palindrome).** A string `w = w[0..m-1]` is a **palindrome** if `w[k] = w[m-1-k]` for all `0 ≤ k < m`. Equivalently `w` equals its reverse `w^R`. The empty string and every single character are palindromes.

**Definition 1.3 (Center and radius, odd case).** An **odd palindrome** of `s` centered at index `i` with radius `ρ ≥ 0` is the substring `s[i-ρ .. i+ρ]`, requiring `s[i-d] = s[i+d]` for all `0 ≤ d ≤ ρ`. Its length is `2ρ + 1`.

**Definition 1.4 (Center and radius, even case).** An **even palindrome** of `s` centered between indices `i-1` and `i` with radius `ρ ≥ 0` (where `ρ = 0` means empty) is `s[i-ρ .. i+ρ-1]`, requiring `s[i-1-d] = s[i+d]` for all `0 ≤ d < ρ`. Its length is `2ρ`.

**Definition 1.5 (Maximal palindrome at a center).** The **maximal** palindrome at a center is the one of largest radius; every shorter palindrome at the same center is a substring of it (nested).

**Definition 1.6 (Palindromic suffix / prefix).** A **palindromic suffix** of `s` is a palindrome `w` with `s = u·w` for some (possibly empty) `u`; a **palindromic prefix** is a palindrome `w` with `s = w·v`. These are the objects the online form of the algorithm tracks and the building blocks of palindromic factorization (Section 11).

**Definition 1.7 (Closed walk vs occurrence).** An **occurrence** of a palindrome `w` in `s` is a start position `a` with `s[a .. a + |w| - 1] = w`. The *occurrence count* of `w` sums over all such `a`; the *distinct count* of palindromes counts each string `w` once regardless of how many occurrences it has. Theorem 7.2 computes the former; the eertree computes the latter.

**Lemma 1.8 (Reversal symmetry).** `w` is a palindrome iff `w = w^R`. Consequently the set of palindromic substrings of `s` is invariant under indexing from either end, and the longest palindrome of `s` and of `s^R` have equal length (a useful test invariant).

**Proof.** Immediate from `(w^R)^R = w` and the definition of palindrome as `w = w^R`. The longest-palindrome-length equality holds because reversing `s` reverses each substring, and a substring is a palindrome iff its reverse is. ∎

**Corollary 1.9 (Test invariant).** Running Manacher on `s` and on `s^R` must yield the same longest-palindrome length and the same *multiset* of palindrome lengths (though positions reverse). This is a free, strong property test: a discrepancy localizes a bug in the scan or the recovery. The radius arrays of `s` and `s^R` are reverses of each other (up to the transform's symmetry), so any implementation can self-check by comparing the two runs.

**Remark.** The split into odd and even (Definitions 1.3, 1.4) is exactly the inconvenience the `#`-transform removes. Section 2 builds a bijection making *all* palindromes odd in a transformed string, so a single radius function suffices.

**Notation conventions.** Throughout, `n = |s|`, `t` is the transformed string of length `N = 2n + 1`, `p[i]` is the transformed radius at center `i`, `(c, l, r)` is the current box (center, left edge, right edge) maintained by the scan, and `i' = 2c - i` is the mirror of `i` across `c`. The Iverson bracket `[P]` is `1` if `P` holds else `0`. "Palindrome" permits any substring; we never consider subsequences.

---

## 2. The `#`-Transform: A Length-Preserving Bijection

**Definition 2.1 (Transform).** Fix a separator `# ∉ Σ`. Define `t` of length `N = 2n + 1` by

```
t[2i]   = #        for 0 ≤ i ≤ n
t[2i+1] = s[i]     for 0 ≤ i ≤ n-1
```

So `t = # s[0] # s[1] # … # s[n-1] #`. Every even index of `t` holds `#`; every odd index holds a character of `s`.

**Lemma 2.2 (All palindromes in `t` are odd).** Every nonempty palindromic substring of `t` has odd length and is centered at a single index of `t`.

**Proof.** Consider a palindromic substring `t[a..b]`. By the alternation of `#` and `Σ`-characters, `t[a]` and `t[b]` have the same "parity type" iff `a ≡ b (mod 2)`. If `a` and `b` had different parities, then `t[a]` would be a `#` and `t[b]` a real character (or vice versa); palindromicity requires `t[a] = t[b]`, impossible since `# ∉ Σ`. Hence `a ≡ b (mod 2)`, so `b - a` is even and the length `b - a + 1` is odd, with a single center `(a+b)/2`. ∎

**Definition 2.3 (Transformed radius).** For `0 ≤ i < N`, let `p[i]` be the largest `ρ` such that `t[i-ρ .. i+ρ]` is a palindrome (with the convention that the radius counts matched characters on each side, excluding the center). Equivalently `t[i-d] = t[i+d]` for all `1 ≤ d ≤ p[i]`.

**Theorem 2.4 (Radius–length bijection).** There is a length-preserving correspondence between palindromic substrings of `s` and palindromes of `t` centered at a fixed index, such that a palindrome of `t` centered at `i` with radius `p[i]` corresponds to a palindrome of `s` of length **exactly** `p[i]`. Concretely, the substring is `s[start .. start + p[i] - 1]` with `start = (i - p[i]) / 2`.

**Proof.** Take a palindrome `t[i - p[i] .. i + p[i]]` of `t`. Its endpoints `i - p[i]` and `i + p[i]` have the same parity (Lemma 2.2's argument), and since the palindrome is *maximal-or-given* of radius `p[i]`, both endpoints are `#` (a `#` strictly outside on each side either fails to match or is a boundary). The real characters inside this window are exactly those at odd `t`-indices in `(i - p[i], i + p[i])`. Counting: the window spans `2 p[i] + 1` positions of `t`; of these, the centers-and-separators alternate, and the number of real (`Σ`) characters is exactly `p[i]`.

*Case `i` odd (center is a real character).* The window has `p[i]` separators on the boundary/interior pattern and `p[i]` (when `p[i]` is... ) — more directly: the real characters occupy odd indices `i - p[i] + 1, i - p[i] + 3, …, i + p[i] - 1`, an arithmetic progression of step 2; its count is `((i + p[i] - 1) - (i - p[i] + 1))/2 + 1 = p[i]`. *Case `i` even (center is a `#`).* The real characters occupy odd indices in the open window, count again `p[i]` by the same progression. In both cases the corresponding `s`-substring has length `p[i]`.

The leftmost real character is at `t`-index `i - p[i] + 1` (odd), which maps to `s`-index `(i - p[i] + 1 - 1)/2 = (i - p[i])/2 = start`. The map is a bijection because the transform is invertible (delete the separators) and palindromicity is preserved in both directions: `t[i-d] = t[i+d]` for separators is automatic (`# = #`) and for real characters reduces exactly to the palindromicity of the corresponding `s`-window. ∎

**Corollary 2.5 (Odd/even unification).** Odd palindromes of `s` correspond to palindromes of `t` centered at **odd** `i` (real-character centers); even palindromes of `s` correspond to palindromes of `t` centered at **even** `i` (`#`-centers). A single computation of `p[]` therefore captures both families, with parity of the center recording which family. This is the formal content of "the `#`-transform makes all palindromes odd."

### 2.1 The Inverse Map and Well-Definedness

**Proposition 2.6.** The transform `Φ : s ↦ t` of Definition 2.1 is injective, and its image is exactly the set of strings of odd length whose even positions are all `#` and whose odd positions avoid `#`. The inverse `Φ^{-1}` deletes every separator, recovering `s` uniquely.

**Proof.** Injectivity: two different `s` differ at some index `k`, hence `t = Φ(s)` and `t' = Φ(s')` differ at position `2k+1`. Surjectivity onto the described image: any such odd-length string with `#` exactly at even positions arises from reading off its odd positions in order. The inverse deletes the `n+1` separators, leaving the `n` characters at odd positions in order. ∎

Well-definedness of the back-translation in Theorem 2.4 depends on this: because `Φ` is a bijection onto its image and palindromicity is preserved in both directions, every palindrome of `t` corresponds to a *unique* palindromic substring of `s`. There is no ambiguity in the recovery formula `start = (i - p[i])/2`.

### 2.2 Worked Transform Examples

| `s` | `t = Φ(s)` | `N = 2n+1` | note |
|-----|-----------|-----------|------|
| `""` | `#` | 1 | empty maps to a single separator |
| `a` | `#a#` | 3 | single char, radius 1 at center |
| `aa` | `#a#a#` | 5 | even palindrome → center at the middle `#` |
| `aba` | `#a#b#a#` | 7 | odd palindrome → center at `b` |
| `abba` | `#a#b#b#a#` | 9 | even palindrome → center at middle `#` |

Each row illustrates that the *center type* (real vs `#`) encodes the *parity* of the original palindrome, the content of Corollary 2.5.

---

## 3. Palindrome Radius Functions and Their Properties

**Definition 3.1.** `p : {0, …, N-1} → ℕ` is the transformed-radius function of Definition 2.3.

**Lemma 3.1a (Lipschitz-like neighbor bound).** Adjacent radii cannot jump arbitrarily: `|p[i+1] - p[i]|` is unbounded in general (radii can spike at a long palindrome), but within a single box the *initialized* values satisfy a mirror relation, not a smoothness bound. The correct structural statement is the mirror relation of Theorem 4.1, not a Lipschitz bound; we note this to dispel a common false intuition that radius arrays are "smooth."

**Proof.** Counterexample to smoothness: in `a^n`, consecutive radii differ by 1 (the tent), but inserting a single distinct character creates an abrupt drop to 0 at the separator next to it. Hence no `O(1)` neighbor bound holds; the only exploitable structure is the box-mirror relation. ∎

**Lemma 3.2 (Boundary bound).** `p[i] ≤ min(i, N - 1 - i)` for all `i`, since the palindrome cannot extend past either end of `t`.

**Lemma 3.3 (Local symmetry inside a palindrome).** Suppose `t[c - ρ .. c + ρ]` is a palindrome (the box) with center `c` and radius `ρ`. Then for any `i` with `c ≤ i ≤ c + ρ`, the neighborhoods of `i` and its mirror `i' = 2c - i` agree as far as both stay inside the box: for `0 ≤ d` with `i + d ≤ c + ρ`, `t[i + d] = t[i' - d]` and `t[i - d] = t[i' + d]`.

**Proof.** The box palindrome gives `t[c + e] = t[c - e]` for `0 ≤ e ≤ ρ`. Write `i = c + a` so `i' = c - a` with `a = i - c ≥ 0`. Then `t[i + d] = t[c + (a + d)] = t[c - (a + d)] = t[i' - d]` whenever `a + d ≤ ρ`, i.e. `i + d ≤ c + ρ`. The other identity is symmetric. ∎

Lemma 3.3 is the formal substance of "the string near `i` looks like the string near its mirror." It is the engine of the initialization in Section 4.

**Lemma 3.4 (Parity invariant of the radius).** For every center `i`, `p[i]` has the same parity as `i` is "real vs separator": at a `#`-center (even `i`) `p[i]` is even; at a real-character center (odd `i`) `p[i]` is odd.

**Proof.** A palindrome of `t` centered at `i` has its two endpoints at `i ± p[i]`, which must have the same character type, and by Lemma 2.2 the same parity as each other, forcing `i + p[i] ≡ i - p[i] (mod 2)`, i.e. `p[i]` even — wait, that holds for any palindrome. The stronger claim follows from maximality plus the alternation: the boundary of a *maximal* palindrome lands on `#` (even index) on both sides, so `i - p[i]` is even, giving `p[i] ≡ i (mod 2)`. At even `i` (`#`-center) this makes `p[i]` even; at odd `i` (real center) it makes `p[i]` odd. ∎

Lemma 3.4 is a free internal consistency check: an implementation can `assert (p[i] % 2) == (i % 2)` to catch transform or indexing bugs early.

**Lemma 3.5 (Total radius sum bound).** `Σ_i p[i] ≤ N²/4 = Θ(n²)`, with equality approached by `a^n`. Hence the radius array, though computed in `O(n)` time, can encode `Θ(n²)` total palindrome "mass" — consistent with the `Θ(n²)` occurrence count of Corollary 7.3.

**Proof.** Each `p[i] ≤ min(i, N-1-i)` (Lemma 3.2), and `Σ_i min(i, N-1-i)` is maximized when the bound is tight everywhere, summing to roughly `N²/4`. For `a^n` the radii form the "tent" of Proposition 8.2, achieving this order. ∎

---

## 4. The Mirror Initialization: Correctness by Case Analysis

Suppose during the scan we have the current box `(c, l, r)` with `l = 2c - r`, meaning `t[l..r]` is a palindrome and `r` is the rightmost right-edge discovered so far. Consider a new center `i` with `c < i < r`. Let `i' = 2c - i` be its mirror; note `l < i' < c` and `p[i']` is already computed. Define the candidate initialization `q = min(r - i, p[i'])`.

**Theorem 4.1 (Initialization correctness).** With `q = min(r - i, p[i'])`:
- (a) `p[i] ≥ q` always (the copy is a valid lower bound), and
- (b) if `p[i'] < r - i`, then `p[i] = p[i']` exactly (no expansion can extend it).

Hence setting `p[i] := q` and then expanding only while `t[i - p[i] - 1] = t[i + p[i] + 1]` computes `p[i]` correctly.

**Proof.**

*(a) Lower bound.* Let `d ≤ q`. We show `t[i - d] = t[i + d]`, i.e. the palindrome at `i` reaches radius at least `q`. Since `d ≤ q ≤ r - i`, we have `i + d ≤ r`, so both `i - d` and `i + d` lie in `[l, r]`. By Lemma 3.3 (with `a = c - i ... `, applied around `c`), `t[i + d] = t[i' - d]` and `t[i - d] = t[i' + d]`. Also `d ≤ q ≤ p[i']`, so `t[i' - d] = t[i' + d]` (the mirror palindrome at `i'` covers radius `d`). Chaining: `t[i + d] = t[i' - d] = t[i' + d] = t[i - d]`. Thus the palindrome at `i` has radius `≥ q`.

*(b) Exactness when the mirror fits strictly inside.* Suppose `p[i'] < r - i`, so `q = p[i']`. We claim `p[i] = p[i']`. From (a), `p[i] ≥ p[i']`. Suppose for contradiction `p[i] ≥ p[i'] + 1`. Consider `d = p[i'] + 1`. Because `p[i'] < r - i`, we have `i + d ≤ r` and `i' - d ≥ l`, so all four indices stay inside `[l, r]`. Lemma 3.3 gives `t[i + d] = t[i' - d]` and `t[i - d] = t[i' + d]`. If the palindrome at `i` reached radius `d`, then `t[i + d] = t[i - d]`, forcing `t[i' - d] = t[i' + d]`, i.e. the palindrome at `i'` would have radius `≥ d = p[i'] + 1`, contradicting the maximality of `p[i']`. Hence `p[i] = p[i']`. ∎

**Case analysis summary.**

| Condition | Value of `q` | Action | Justification |
|-----------|--------------|--------|---------------|
| `p[i'] < r - i` (mirror strictly inside) | `q = p[i']` | `p[i] = p[i']`, **no expansion** | Theorem 4.1(b) |
| `p[i'] > r - i` (mirror reaches past box) | `q = r - i` | `p[i] = r - i`, **no expansion** can extend (would pass `r`, beyond which the box is not maximal — actually requires checking, but the part past `r` is unknown) | clamped to verified region |
| `p[i'] = r - i` (mirror hits box edge exactly) | `q = r - i` | `p[i] ≥ r - i`, **must expand** | beyond `r` is unexplored; expand to discover |

**Subtlety in the middle case.** When `p[i'] > r - i`, the palindrome at `i` cannot exceed `r - i`: if it did, by symmetry across `c` the palindrome at `i'` would extend past `l = 2c - r`, contradicting that `t[l..r]` is the *maximal* box palindrome around `c` (a longer match at `i'` reaching below `l` would let the box itself extend). So `p[i] = r - i` exactly and no expansion is needed. The unified `q = min(r - i, p[i'])` handles all three rows; expansion is attempted in every case but only *does work* in the boundary case `p[i'] = r - i` (and trivially fails immediately otherwise), which is what the amortized analysis (Section 6) charges.

### 4.1 Worked Mirror-Initialization Example

Consider `s = "cabbac"`, so `t = #c#a#b#b#a#c#` (length 13). Run the scan to the point where the box is the palindrome `abba`'s transform, centered at the middle `#` between the two `b`s. Suppose `c = 6`, `r = 12`, `l = 0` (the full string `cabbac` is itself a palindrome, so the box spans everything). Now process a center `i = 9` (a `#` between `a` and `c` on the right half).

- Mirror: `i' = 2c - i = 12 - 9 = 3` (a `#` on the left half, between `c` and `a`).
- Suppose `p[3] = 0` (no palindrome there — `c ≠ a`). Then `q = min(r - i, p[i']) = min(3, 0) = 0`.
- Since `p[i'] = 0 < r - i = 3`, Theorem 4.1(b) applies: `p[9] = 0` exactly, and the very first expansion test (`t[8]='a'` vs `t[10]='c'`) fails immediately. No work beyond the `O(1)` copy.

Now process `i = 11` (the `#` between `c` and the final `#`):

- Mirror `i' = 12 - 11 = 1`, `p[1] = 1` (the single `c` palindrome `#c#`).
- `q = min(r - i, p[i']) = min(1, 1) = 1`. Here `p[i'] = r - i = 1` exactly — the boundary case.
- So `p[11] = 1` is only a *lower bound*; we must try to expand. The test at offset 2 (`t[9]` vs `t[13]`) is out of bounds, so expansion stops, confirming `p[11] = 1`.

This trace shows both the "copy is exact, no expansion" case (`i = 9`) and the "copy hits the box edge, expansion required" case (`i = 11`). Only the boundary case ever probes beyond `r`, which is precisely the work the amortized argument bounds.

---

## 5. Expansion and the Box Invariant

**Algorithm (array Manacher).**
```
MANACHER(t):                        # t of length N, with # separators
  p[0..N-1] := 0
  c := 0; r := 0                    # current box center and right edge
  for i := 0 to N-1:
    if i < r:
      p[i] := min(r - i, p[2c - i]) # mirror initialization (Theorem 4.1)
    while i - p[i] - 1 >= 0 and i + p[i] + 1 < N
          and t[i - p[i] - 1] = t[i + p[i] + 1]:
      p[i] := p[i] + 1              # expand past the box
    if i + p[i] > r:
      c := i; r := i + p[i]         # advance the box; r never decreases
  return p
```

**Invariant 5.1 (Box validity).** At the start of each iteration `i`, `t[l..r]` (with `l = 2c - r`) is a palindrome centered at `c`, and `r = max_{j < i} (j + p[j])`, i.e. `r` is the rightmost right-edge among all already-processed centers.

**Proof.** Initially `c = r = 0` and `t[0..0]` is trivially a palindrome; vacuously `r` is the max over the empty set (taken as 0). Inductively, after computing `p[i]`, we update `(c, r)` exactly when `i + p[i] > r`, setting `r := i + p[i]`, preserving "rightmost right-edge so far." The window `t[i - p[i] .. i + p[i]]` is a palindrome by Definition 2.3 (the while-loop established it), so the new box is valid. If `i + p[i] ≤ r` we keep the old, still-valid box. ∎

**Theorem 5.2 (Total correctness).** `MANACHER(t)` returns the exact transformed-radius array `p[]`.

**Proof.** By Invariant 5.1 the box is always a valid palindrome with `r` the rightmost frontier. For each `i`: if `i ≥ r`, the initialization is skipped (`p[i] = 0`) and the while-loop computes the true maximal radius directly by expansion — correct by definition. If `i < r`, the initialization sets `p[i] = min(r - i, p[i'])`, a valid lower bound (Theorem 4.1(a)), and either equals the answer (Theorem 4.1(b), middle case) — in which case the while-loop's first test fails and nothing changes — or undercounts only in the boundary case, where the while-loop extends it to the true maximum. In all cases `p[i]` ends equal to the maximal radius. ∎

### 5.1 Boundary and Edge-Case Correctness

**Proposition 5.3 (Empty and singleton inputs).** For `s = ""`, `t = "#"`, `N = 1`, and the scan returns `p = [0]`: the only center is the lone separator, with no expansion possible. The longest palindrome length is `0` and the count is `0`. For `s = "a"`, `t = "#a#"`, the scan returns `p = [0, 1, 0]`, giving longest length `1` and count `1`.

**Proof.** Direct evaluation of the algorithm: with `N = 1` the loop runs once at `i = 0`; both expansion bounds (`i - p[i] - 1 ≥ 0` and `i + p[i] + 1 < N`) fail immediately, so `p[0] = 0`. For `N = 3` the center `i = 1` expands once (`t[0] = t[2] = #`) then stops at the boundary, giving `p[1] = 1`. ∎

**Corollary 5.3a.** For any `s`, the radius array begins and ends with `0` (`p[0] = p[N-1] = 0`), because the two boundary separators have no room to expand. This is a free post-condition assertion: an implementation can check `p[0] == 0 && p[N-1] == 0` to catch gross indexing errors. More generally, the radius array is symmetric only when `s` itself is a palindrome; asymmetry of `p[]` reflects asymmetry of `s`.

**Proposition 5.4 (Boundary safety with sentinels).** Replacing `t` with `^ t $` for distinct sentinels `^, $, # ∉ Σ` preserves all radii (the sentinels never participate in a real palindrome) and makes the expansion's bounds checks unnecessary, because the comparison `t[i - p[i] - 1] = t[i + p[i] + 1]` fails at any boundary (one side is a sentinel distinct from the other side). This is a correctness-preserving optimization, not a semantic change.

**Proof.** The sentinels are distinct from each other and from every alphabet symbol, so no palindrome can have a sentinel strictly inside it; thus every radius is unchanged. At a boundary the expansion compares a sentinel against a non-matching character (or the opposite sentinel), terminating the loop exactly where the bounds check would have. ∎

---

## 6. The Linear-Time Proof: Amortized Analysis of the r-Pointer

The while-loop can run many iterations at a single `i`, so a naive worst-case-per-`i` bound gives `O(N²)`. The linear bound is **amortized**, charged to the monotone advance of `r`.

**Theorem 6.1 (Linear time).** `MANACHER(t)` runs in `O(N) = O(n)` time.

**Proof.** Separate the work into (i) the `O(1)` per-iteration overhead (initialization, the box update, loop bookkeeping), summing to `O(N)`, and (ii) the **successful** iterations of the while-loop (those that execute `p[i] := p[i] + 1`).

*Key claim: `r` is non-decreasing and strictly increases on every successful while-iteration that matters.* Each successful expansion at center `i` increases `p[i]` by 1, which increases `i + p[i]` by 1. The while-loop continues only while `i + p[i] + 1 < N` and the characters match; the first comparison it makes is at offset `p[i] + 1` from `i`. Before the loop, if `i < r`, the initialization set `p[i] = min(r - i, p[i'])`; the **first** expansion test is at index `i + p[i] + 1`. If `p[i] = r - i` (the only case that triggers expansion, by Theorem 4.1), then `i + p[i] + 1 = r + 1`, a position **strictly to the right of `r`**. Thus every successful expansion examines a position `> r` and, on success, pushes the new right-edge `i + p[i]` past the old `r`, so after processing center `i` the box's `r` has advanced by exactly the number of successful expansions at `i`.

Therefore the total number of successful while-iterations over the whole run equals the total advance of `r`. Since `r` starts at 0, never decreases, and is bounded above by `N - 1`, the total advance — hence the total number of successful expansions — is at most `N - 1`. Adding the `O(N)` overhead and at most one *failed* (terminating) expansion test per center (`O(N)` of those), the total is `O(N)`. ∎

**Remark (the only-forward `r`).** The proof hinges on the same observation as KMP and the two-pointer sliding window: a monotone pointer that only advances and is bounded by `N` performs `O(N)` total moves no matter how the work is distributed across iterations. The initialization's clamp `min(r - i, …)` is what guarantees expansion *only* probes positions beyond `r`; without the clamp, expansions could re-examine already-known positions and the amortization would break.

**Corollary 6.2.** Building `t` is `O(n)`, the scan is `O(n)`, and reading off the longest palindrome / total count is `O(n)`. End-to-end Manacher is `O(n)` time and `O(n)` space.

### 6.1 A Complete Worked Trace with Amortization Accounting

To make the amortization concrete, trace `s = "abaab"`, `t = #a#b#a#a#b#` (length 11), and tally the expansion work.

```
i   0  1  2  3  4  5  6  7  8  9  10
t   #  a  #  b  #  a  #  a  #  b  #
p   0  1  0  3  0  1  4  1  0  1  0
```

Step-by-step with the box `(c, r)` and the count of *successful* expansions:

```
i=0  '#': i>=r(0), p[0]=0, expand fails (left OOB).            box stays (0,0).  exp=0
i=1  'a': i>=r, p[1]=0, expand: t0='#'=t2='#' → p=1; t-1 OOB. box=(1,2).        exp=1
i=2  '#': i<r(2)? no (i==r). p[2]=0, expand t1='a'≠t3='b'.    box stays.        exp=0
i=3  'b': i>=r, p[3]=0, expand: #=#(p1), a=a(p2)? t1='a'=t5='a'→p... actually
          t2='#'=t4='#'(p1), t1='a'=t5='a'(p2), t0='#'=t6='#'(p3), t-1 OOB → p[3]=3. box=(3,6). exp=3
i=4  '#': i<r(6). mirror=2*3-4=2, p[2]=0, q=min(2,0)=0. expand t3='b'≠t5='a'.  box stays. exp=0
i=5  'a': i<r. mirror=2*3-5=1, p[1]=1, q=min(1,1)=1 (boundary). expand t3='b'≠t7='a'? p stays 1. box stays. exp=0
i=6  '#': i==r(6)? i<r false. p[6]=0, expand: t5='a'=t7='a'(p1), t4='#'=t8='#'(p2), t3='b'=t9='b'(p3), t2='#'=t10='#'(p4), t1 vs t11 OOB → p[6]=4. box=(6,10). exp=4
i=7  'a': i<r(10). mirror=2*6-7=5, p[5]=1, q=min(3,1)=1. expand t5='a'? already... t6='#'=t8='#'? offset 2: t5='a'=t9='b'? no → p[7]=1. box stays. exp=0
i=8  '#': i<r. mirror=2*6-8=4, p[4]=0, q=min(2,0)=0. expand t7='a'≠t9='b'. box stays. exp=0
i=9  'b': i<r. mirror=2*6-9=3, p[3]=3, q=min(1,3)=1 (clamped to r-i=1). expand t8='#'=t10='#'? offset 2: t7 vs t11 OOB → p[9]=1. box stays. exp=0
i=10 '#': i==r. p[10]=0, expand t9 vs t11 OOB. box stays. exp=0
```

Total successful expansions: `1 + 3 + 4 = 8`. The right edge `r` advanced `0 → 2 → 6 → 10`, a total advance of `10`, and the successful expansions (`8`) plus the initial box-establishing moves account for that advance. Crucially, every successful expansion examined a position strictly past the then-current `r` — the amortization charge of Theorem 6.1 in action. Note `i = 9` with mirror `p[3] = 3` was *clamped* to `r - i = 1` by the cap; without the cap it would have wrongly claimed radius 3, asserting a palindrome `b#a#a#b... ` extending past `r` that does not exist. The longest is `p[6] = 4` (the even palindrome `baab`), starting at `(6 - 4)/2 = 1`: `s[1..4] = "baab"`.

### 6.2 Why the Cap Is Necessary for the Bound, Not Just Correctness

A subtle point: the cap `min(r - i, …)` is needed for the *complexity* argument, not only correctness. Suppose we omitted it and instead set `p[i] = p[i']` then expanded/contracted to fix the value. The "fix" could require *re-examining* positions already inside `[l, r]` — positions to the left of `r` that the scan has already settled. Such re-examination is not charged to any forward `r`-advance, so the amortized bound collapses; one could construct inputs forcing `Θ(n²)` re-checks. The cap guarantees that the *only* positions the expansion ever touches are at offset `r - i + 1` or beyond — strictly past `r` — so each touched position is "new" and chargeable. Correctness and linearity are thus two consequences of the same single `min`.

---

## 7. Counting All Palindromic Substrings: Correctness

**Theorem 7.1 (Per-center count).** The number of palindromic substrings of `s` whose transformed center is `i` equals `⌈p[i] / 2⌉ = (p[i] + 1) div 2`.

**Proof.** By Theorem 2.4, a palindrome of `t` centered at `i` with radius `ρ` corresponds to an `s`-palindrome of length `ρ`. The palindromes centered at `i` are exactly those with radius `ρ ∈ {0, 1, …, p[i]}` that correspond to a *nonempty* `s`-substring AND share the center's parity. Concretely, the `s`-palindromes at this center have lengths forming an arithmetic progression with step 2 (each nested palindrome adds one character on each side):

- If `i` is odd (real-character center), the `s`-palindrome lengths are the odd values `1, 3, …, p[i]` (and `p[i]` is odd), giving `(p[i] + 1)/2` of them.
- If `i` is even (`#`-center), the lengths are the even values `2, 4, …, p[i]` (and `p[i]` is even), giving `p[i]/2` of them.

In both cases the count is `⌈p[i] / 2⌉`: for odd `p[i]`, `⌈p[i]/2⌉ = (p[i]+1)/2`; for even `p[i]`, `⌈p[i]/2⌉ = p[i]/2`. ∎

**Theorem 7.2 (Total count).** The total number of palindromic substrings of `s` (counting each occurrence) is `Σ_{i=0}^{N-1} ⌈p[i] / 2⌉`.

**Proof.** Every palindromic substring of `s` has a unique center (a unique `i` in `t` by Corollary 2.5), and it is counted exactly once at that center by Theorem 7.1. Summing the disjoint per-center counts over all `N` centers gives the total, with no double-counting (distinct centers yield distinct substrings *as positioned occurrences*). ∎

**Corollary 7.3 (Magnitude).** For `s = a^n`, every center `i` has maximal radius and `Σ ⌈p[i]/2⌉ = n(n+1)/2`, the maximum possible. Hence the count is `Θ(n²)` in the worst case and must be stored in a 64-bit (or arbitrary-precision) integer even though it is computed in `O(n)` time.

**Worked verification.** `s = "aaa"`, `t = #a#a#a#`, `p = [0,1,2,3,2,1,0]`. Per-center counts: `⌈0/2⌉,…= 0,1,1,2,1,1,0`, summing to `6`. The six occurrences are `a` (×3), `aa` (×2), `aaa` (×1). ∎

### 7.1 The Nesting Lemma Underlying the Count

The count formula relies on a structural fact that deserves its own statement.

**Lemma 7.4 (Nesting of palindromes at a center).** Fix a transformed center `i` with radius `p[i]`. For every `ρ` with `0 ≤ ρ ≤ p[i]` and `ρ ≡ p[i] (mod 2)`, the window `t[i-ρ .. i+ρ]` is a palindrome, and these are *all* the palindromes centered at `i`. Consequently the palindromes centered at `i` form a totally ordered chain under the substring relation: each is contained in the next-larger one.

**Proof.** That `t[i-ρ .. i+ρ]` is a palindrome for `ρ ≤ p[i]` follows directly from `p[i]` being the *maximal* radius: `t[i-d] = t[i+d]` for all `d ≤ p[i]` implies the same for all `d ≤ ρ`. The parity constraint `ρ ≡ p[i] (mod 2)` is what survives the back-translation to `s`: only windows whose endpoints are both separators (or both real, matching the center's type) map to a genuine `s`-palindrome via Theorem 2.4. The chain order holds because `ρ_1 < ρ_2` gives `t[i-ρ_1 .. i+ρ_1] ⊂ t[i-ρ_2 .. i+ρ_2]` as a substring. ∎

**Remark (chain vs antichain).** The nesting of Lemma 7.4 is special to palindromes sharing a *center*. Palindromes at *different* centers form no such order — they may overlap arbitrarily or be incomparable under the substring relation. This is precisely why the *total* count sums independent per-center chains (each a simple count) but the *distinct* count cannot: distinct palindromes at different centers can be equal strings, an equivalence the radius array does not track. The chain structure is the combinatorial reason the occurrence count has a closed form while the distinct count requires the eertree's string-identity machinery.

The chain structure is why the per-center contribution is a simple *count* (`⌈p[i]/2⌉`) rather than requiring enumeration: the palindromes at a center are linearly nested, so their number is determined by the radius alone.

### 7.2 A Second Worked Count

Take `s = "aba"`, `t = #a#b#a#`, with radii computed by the scan:

```
i   0 1 2 3 4 5 6
t   # a # b # a #
p   0 1 0 3 0 1 0
```

Per-center contributions `⌈p[i]/2⌉ = 0,1,0,2,0,1,0`, summing to `4`. The four palindromic substrings of `"aba"` are `a` (at index 0), `b` (index 1), `a` (index 2), and `aba` (indices 0–2). The center `i = 3` (the `b`) has radius 3 and contributes `⌈3/2⌉ = 2`: the single `b` and the full `aba`. This illustrates how a high-radius odd center contributes both the central character and the enclosing palindrome in one term.

### 7.3 Counting Palindromes of a Fixed Parity

**Proposition 7.5.** The number of *odd-length* palindromic substrings of `s` is `Σ_{i odd} ⌈p[i]/2⌉` (sum over real-character centers), and the number of *even-length* palindromic substrings is `Σ_{i even} ⌈p[i]/2⌉` (sum over `#`-centers).

**Proof.** Immediate from Corollary 2.5: odd palindromes have real-character (odd-index) centers and even palindromes have `#` (even-index) centers, and Theorem 7.1 counts each center's contribution. Splitting the total sum by center parity therefore splits the count by palindrome parity. ∎

This parity decomposition is useful in practice: some problems ask only for odd palindromes (single-character-centered) or only even ones, and the answer is a filtered sum over the *same* radius array — no second pass.

---

## 8. Distinct Palindromes and the Linear Bound

Theorem 7.2 counts *occurrences*. The number of **distinct** palindromic substrings is a different — and famously bounded — quantity.

**Theorem 8.1 (Linear number of distinct palindromes).** A string of length `n` contains at most `n` distinct nonempty palindromic substrings.

**Proof (the standard "new longest palindromic suffix" argument).** Process `s` left to right. When the character `s[i]` is appended, consider the set of palindromic suffixes of `s[0..i]`. We claim at most **one** palindrome that did not occur in `s[0..i-1]` appears — namely the longest palindromic suffix of `s[0..i]`. Indeed, any palindromic substring of `s[0..i]` not present earlier must be a *suffix* of `s[0..i]` (otherwise it occurs strictly earlier), and among palindromic suffixes, any one shorter than the longest is itself a *prefix* of the longest palindromic suffix (by palindromicity) and hence also a *suffix* occurring earlier. So each of the `n` append steps introduces at most one new distinct palindrome, giving `≤ n` total. ∎

**Remark (why Manacher does not give distinct counts).** Manacher's `p[]` records, per *center*, the maximal radius — it does not deduplicate equal palindrome *strings* arising at different centers. Two different centers can produce the same string (`"aa"` occurs twice in `"aaa"`), and `p[]` carries no mechanism to detect string equality across centers. The eertree (Section 9) is the structure that directly enumerates the `≤ n` distinct palindromes; Theorem 8.1 is exactly why its size is linear.

### 8.0 Worked Distinct-vs-All Contrast

Take `s = "ababa"`, `t = #a#b#a#b#a#`:

```
i   0  1  2  3  4  5  6  7  8  9  10
t   #  a  #  b  #  a  #  b  #  a  #
p   0  1  0  3  0  5  0  3  0  1  0
```

**All occurrences** (Theorem 7.2): `Σ⌈p[i]/2⌉ = 0+1+0+2+0+3+0+2+0+1+0 = 9`. Enumerating: `a`(×3), `b`(×2), `aba`(×2), `bab`(×1), `ababa`(×1) = `3+2+2+1+1 = 9`. ✓

**Distinct** (Theorem 8.1): the *distinct* palindromes are `{a, b, aba, bab, ababa}` = `5`. Note `a` occurs 3 times but counts once; `aba` occurs twice but counts once. Manacher's `9` and the distinct `5` differ precisely because `p[]` cannot tell that the `aba` centered at `i=3` and the one... actually both `aba`s share the structure but appear at different start positions — `p[]` records radii, not string identity. The eertree would have exactly `5` palindrome nodes (plus the two roots), directly giving `5`.

This single example is the canonical demonstration of why "all" and "distinct" are genuinely different problems requiring different tools, both linear-time.

### 8.1 Palindromic Structure of Highly Repetitive Strings

**Proposition 8.2 (Powers of a single character).** For `s = a^n`, the distinct palindromic substrings are exactly `{a, aa, …, a^n}`, so there are `n` of them — meeting the bound of Theorem 8.1 with equality. The radius array is `p = [0,1,2,…,n,…,2,1,0]` over `t = #a#a#…#`, a symmetric "tent" peaking at the central center.

**Proof.** Every substring of `a^n` is itself a power `a^m` (`1 ≤ m ≤ n`), and every such power is a palindrome. There are exactly `n` distinct ones. The radius pattern follows because the center at the middle of `t` extends symmetrically to both ends, and centers nearer the edges are clamped by the boundary bound (Lemma 3.2). ∎

This is the extremal case in two senses: it maximizes both the *occurrence* count (`n(n+1)/2`, Corollary 7.3) and the *distinct* count (`n`, Theorem 8.1). It is also the worst case for the naive center-expansion baseline, which performs `Θ(n²)` work here, whereas Manacher's mirror reuse keeps it linear.

**Proposition 8.3 (Rich strings).** A string of length `n` that attains exactly `n + 1` palindromic substrings *including the empty one* (i.e. the maximum `n` nonempty plus the empty palindrome) is called **rich** (or full). Every prefix of a rich string introduces a new longest palindromic suffix at each step. Sturmian words and `a^n` are rich; not all strings are. Richness is detected by the eertree (each append adds exactly one node), not by Manacher's radius array alone.

**Corollary 8.3a (Defect of a string).** The **palindromic defect** of `s` is `D(s) = n - (#distinct nonempty palindromic substrings)`, always `≥ 0` by Theorem 8.1. Rich strings have `D(s) = 0`; the more "non-palindromic structure" a string has, the larger its defect. The defect is computable from the eertree node count but not from Manacher's `p[]` alone, since `p[]` does not expose the *distinct* count. This quantity appears in combinatorics on words as a measure of palindromic complexity, complementing the *occurrence* count Manacher provides.

### 8.2 The Border / Palindrome-Prefix Connection

**Proposition 8.4.** The set of palindromic *prefixes* of `s` (palindromes starting at index 0) is recoverable from `p[]` as `{ centers i : (i - p[i])/2 = 0 }`, and the longest such corresponds to the longest palindromic prefix. Symmetrically, palindromic *suffixes* correspond to centers with `(i + p[i])/2 = n` (the right edge reaches the string's end).

**Proof.** A palindrome centered at `i` with radius `p[i]` occupies `s[start .. start + p[i] - 1]` with `start = (i - p[i])/2` (Theorem 2.4). It is a prefix iff `start = 0`, and a suffix iff `start + p[i] = n`, i.e. `(i + p[i])/2 = n`. Scanning `p[]` for these conditions identifies all palindromic prefixes/suffixes in `O(n)`. ∎

This is the algebraic backbone of the "shortest palindrome by prepending" construction and of palindromic-border computations: the longest palindromic prefix has length `max { p[i] : (i - p[i])/2 = 0 }`, read directly off the radius array.

---

## 9. Relation to the Palindromic Tree (Eertree)

The **eertree** (Rubinchik-Shur, sibling `14`) is a different linear-size structure for palindromes. A formal contrast clarifies what each tool proves.

**Definition 9.1 (Eertree).** A rooted structure with two roots (imaginary palindromes of lengths `-1` and `0`) and one node per **distinct** nonempty palindromic substring of `s`. Each node stores its length, a **suffix link** to the longest proper palindromic suffix that is itself a palindrome, and labeled edges for one-character extensions. By Theorem 8.1 it has `≤ n + 2` nodes; it is built **online** in amortized `O(n)` total via the suffix-link walk.

**Comparison.**

| Property | Manacher | Eertree |
|----------|----------|---------|
| Primary output | radius array `p[]` (per center) | node per distinct palindrome |
| Counts occurrences | `Σ⌈p/2⌉` (Theorem 7.2) | per-node occurrence count via suffix-link propagation |
| Counts **distinct** | not directly | `#nodes − 2` exactly |
| Distinct bound used | — | Theorem 8.1 makes it linear-size |
| Online | original form yes; array form no | inherently online |
| Per-prefix #distinct palindromes | not naturally | yes (running node count) |
| Palindromic factorization | radii → DP | series/quick links → DP |
| Space | one int array `O(n)` | `O(n)` nodes, `O(n·σ)` or `O(n)` with maps |

**The structural distinction.** Manacher's invariant is *geometric* (the rightmost-reaching palindrome box) and yields per-center maximal radii. The eertree's invariant is *combinatorial* (the longest palindromic suffix and its suffix-link chain) and yields the distinct-palindrome DAG. They are complementary: Manacher answers *longest* and *total occurrences* with minimal memory; the eertree answers *distinct* and *per-prefix structure* and is naturally online. Both achieve `O(n)`, and both are proven linear by an amortized monotone-pointer argument (the box's `r` for Manacher; the suffix-link depth for the eertree).

### 9.1 Worked Eertree-vs-Manacher on the Same String

For `s = "aabaa"`:

- **Manacher** computes `t = #a#a#b#a#a#` and `p = [0,1,2,1,0,5,0,1,2,1,0]`. Longest = `5` (the whole string, an odd palindrome centered at the `b`). All-occurrence count = `Σ⌈p/2⌉ = 0+1+1+1+0+3+0+1+1+1+0 = 9`.
- **Eertree** builds nodes for the distinct palindromes `{a, aa, b, aba, aabaa}` = `5` nodes (plus two roots). Distinct count = `5`. Per-node occurrence counts (after suffix-link propagation) sum to `9`, matching Manacher's total.

So Manacher hands you `9` (occurrences) and `5` (longest length) for free; the eertree hands you `5` (distinct) and the same `9` via a different mechanism. The agreement on the occurrence total (`9`) is a cross-check: two independent linear algorithms must agree on `Σ` occurrences, a strong property test for an implementation of either.

### 9.2 When Both Are Needed Together

Some problems want *both* the longest palindrome *and* the number of distinct palindromes (e.g. a text-fingerprinting feature). Running Manacher and the eertree as two independent `O(n)` passes is the clean solution: each is specialized and neither subsumes the other. There is no single linear structure that yields *all* palindromic statistics more cheaply than running both — the geometric and combinatorial views are genuinely distinct.

---

## 10. Lower Bounds and Optimality

**Theorem 10.1 (Linear is optimal for longest palindrome).** Any algorithm that determines the longest palindromic substring must read `Ω(n)` characters of the input in the worst case; hence `O(n)` is asymptotically optimal.

**Proof.** Reading fewer than `n` characters leaves at least one character unexamined; an adversary can set that character to either match or break a palindrome covering it, changing the answer. So `Ω(n)` reads are necessary, and Manacher's `O(n)` matches this bound. ∎

**Theorem 10.2 (Output-size lower bound for counting all).** Reporting the full per-center radius array requires `Ω(n)` output; reporting the *count* of all palindromic substrings is `O(n)` time despite the count's `Θ(n²)` magnitude, because the count is a single (possibly big) integer, not an enumeration.

**Theorem 10.4 (Comparison-model tightness).** In the comparison model (the algorithm may only test character equality, not exploit alphabet structure), computing the radius array requires `Ω(n)` equality tests, and Manacher performs `O(n)` — so it is optimal up to constants even among comparison-based algorithms.

**Proof.** The `Ω(n)` bound is inherited from Theorem 10.1 (every character must be examined). The matching upper bound is Theorem 6.1's `O(n)` total comparisons, since each successful expansion (charged to `r`'s advance) is one equality test and there are `O(n)` of them, plus one terminating test per center. ∎

**Remark (no faster than linear, even with hashing).** Hashing does not beat the linear bound; it trades the deterministic `O(n)` for a probabilistic `O(n log n)` (Proposition 10.3) in exchange for flexibility on range/approximate queries. There is no sub-linear algorithm because, by Theorem 10.1, the answer can depend on every character. Manacher is therefore time-optimal for its problem class, and the constant factor (dominated by the `2n+1` transformed length and one comparison per `r`-advance) is small.

**Remark (enumerating occurrences).** *Enumerating* every palindromic substring occurrence is `Θ(n²)` in the worst case (`a^n` has `Θ(n²)` occurrences), so no sub-quadratic algorithm can *list* them — but *counting* them (Theorem 7.2) and finding the *longest* (Theorem 10.1) are both linear. The radius array is the linear-size certificate from which both the count and the longest are read in `O(n)`. This separation — linear to summarize, quadratic only to fully enumerate — is the precise sense in which Manacher is optimal.

### 10.1 Comparison with Hashing-Based Per-Center Radii

A hashing approach computes per-center radii by binary searching the largest radius for which the forward and reverse hashes of the symmetric window agree.

**Proposition 10.3.** With polynomial hashing, each center's radius is found in `O(log n)` time (binary search over the radius, `O(1)` hash comparison per probe), giving `O(n log n)` total — a `log n` factor worse than Manacher, and only correct *with high probability* (a hash collision can report a false palindrome).

**Proof.** The window-palindrome predicate is monotone in the radius: if radius `ρ` is palindromic, so is every `ρ' < ρ`. Monotonicity makes binary search valid, costing `O(log n)` probes. Each probe compares a forward hash against a reverse hash in `O(1)` after `O(n)` preprocessing. The collision probability per comparison is `O(1/M)` for modulus `M`; over `O(n log n)` comparisons the failure probability is `O(n log n / M)`, made negligible by `M ≈ 2^{61}` or double hashing. ∎

The trade-off is sharp: Manacher is exact and linear but specialized; hashing is `O(n log n)`, probabilistic, but trivially extends to *range* palindrome queries and *approximate* (k-mismatch) palindromes, which Manacher cannot do. The deterministic linear bound (Theorem 6.1) is the reason Manacher remains the canonical choice for the exact longest-palindrome and counting problems.

---

## 11. Generalizations and Related Structure

### 11.1 Palindromic Factorization

**Definition 11.1 (Palindromic factorization).** A factorization `s = w_1 w_2 … w_k` where each `w_j` is a palindrome. The **minimum** number of factors is the *palindromic partitioning* number (LeetCode 132).

**Proposition 11.2.** Manacher's radius array lets a DP compute the minimum palindromic factorization in `O(n²)` naively (and `O(n log n)` with the palindromic-series-link optimization on the eertree). Define `dp[j]` = min factors for the prefix `s[0..j-1]`. Then `dp[j] = 1 + min over palindromic suffixes w of s[0..j-1] of dp[j - |w|]`. The palindromic suffixes ending at `j-1` are read from `p[]` (centers whose right edge reaches `j-1`).

**Proof sketch.** A factorization of `s[0..j-1]` ends in some palindromic suffix `w`; removing it leaves `s[0..j-|w|-1]`, factored optimally by `dp[j-|w|]`. Taking the minimum over all palindromic suffixes `w` (each identified by a center whose palindrome ends at `j-1`) gives the recurrence. Manacher supplies, for each end position, which palindromes terminate there. ∎

The radius array is thus a *preprocessing oracle* for palindromic DPs: any DP whose transition depends on "which palindromes end (or start) here" reads its transitions from `p[]`.

### 11.2 Two-Dimensional and Weighted Variants

Manacher does not generalize cleanly to 2D "palindromic rectangles" (no known linear algorithm), but its 1D output is used row-by-row in some 2D palindrome-detection heuristics. For **weighted** palindromes (each position has a cost, and one wants the maximum-weight palindrome), the radius array identifies the candidate palindromes and a prefix-sum over weights evaluates each in `O(1)`, giving the best-weight palindrome in `O(n)` overall.

### 11.3 Online Manacher and the Suffix-Palindrome Sequence

**Proposition 11.3.** Manacher's original formulation is **online**: after reading `s[0..i]`, it knows the length of the longest palindromic *suffix* ending at `i`, in amortized `O(1)` per character. The sequence of longest palindromic suffixes is itself a studied object (its lengths relate to the string's palindromic richness).

**Proof idea.** The online algorithm maintains the box and, when a new character arrives, attempts to extend the current rightmost palindrome; the same amortized `r`-advance argument (Theorem 6.1) bounds total work. The longest palindromic suffix at step `i` is the palindrome whose right edge equals `i` with maximal radius. ∎

This online property is what makes Manacher usable in streaming contexts (Senior §6) and is the historical reason the 1975 paper framed it as an "online" algorithm rather than the offline array form taught today.

### 11.5 Worked Palindromic Factorization

For `s = "aab"`, the radius array over `t = #a#a#b#` is `p = [0,1,2,1,0,1,0]`. The minimum palindromic factorization:

```
dp[0] = 0                                  (empty prefix)
dp[1] = 1                                   "a"           -> 1 factor
dp[2] = 1                                   "aa" is a palindrome -> 1 factor
dp[3] = dp[2] + 1 = 2                        "aa" + "b"    -> 2 factors
```

So `"aab"` factors as `aa | b` with `2` palindromic factors, the minimum. The palindromic suffixes ending at each position (`"a"`, `"aa"`, `"b"`) are read from `p[]`: the center whose right edge reaches position `j-1` gives a palindromic suffix of the prefix `s[0..j-1]`. This is the LeetCode-132 minimum-cuts problem, with Manacher supplying the palindrome oracle that the DP queries.

**Complexity note.** The naive DP over all palindromic suffixes is `O(n²)`; using the eertree's series links it drops to `O(n log n)`. Manacher alone gives the `O(n²)` version cleanly, which suffices for moderate `n`; the eertree is needed for the near-linear bound.

### 11.4 The Eertree as the Dual Structure

To close the theoretical picture: Manacher and the eertree (Section 9) are the two canonical linear-time palindrome engines, dual in what they expose.

| Quantity | Manacher reads it from | Eertree reads it from |
|----------|------------------------|------------------------|
| Longest palindrome | `max p[i]` | deepest node (by length) |
| All-occurrence count | `Σ⌈p[i]/2⌉` | Σ node occurrence counts |
| Distinct count | not available | `#nodes − 2` |
| Palindromic factorization | per-end palindromes from `p[]` | series/quick suffix links |
| Online longest pal. suffix | online form | current node (always) |
| Per-prefix distinct count | not available | running node count |

Both are `O(n)`; both are proven linear by an amortized monotone quantity (the box edge `r`; the suffix-link depth). A complete palindrome toolkit uses Manacher for the *geometric* questions (longest, occurrence counts, factorization preprocessing) and the eertree for the *combinatorial* ones (distinct palindromes, online structure).

---

## 12. Summary

- **`#`-transform bijection (Theorem 2.4).** Inserting separators makes every palindrome of `t` odd (Lemma 2.2), and a palindrome of `t` of radius `p[i]` corresponds to an `s`-palindrome of length **exactly** `p[i]`, with start `(i - p[i])/2`. Odd/even palindromes of `s` map to odd/even centers of `t` (Corollary 2.5), unifying both cases.
- **Mirror initialization correctness (Theorem 4.1).** Inside the box `(c, l, r)`, setting `p[i] = min(r - i, p[2c-i])` is a valid lower bound always, and exact whenever the mirror palindrome fits strictly inside the box; only the boundary case `p[i'] = r - i` requires expansion. The clamp confines the free copy to the verified region.
- **Box invariant and correctness (Theorems 5.2).** The box is always a valid palindrome with `r` the rightmost frontier; the scan computes the exact radius at every center.
- **Linear time (Theorem 6.1).** Successful expansions are charged to the monotone advance of `r`, which only increases and is bounded by `N`; total expansion work is `O(n)`. This is the same amortized only-forward-pointer principle as KMP and two-pointer sliding windows, and it depends critically on the initialization clamp.
- **Counting all palindromic substrings (Theorems 7.1, 7.2).** Each center contributes `⌈p[i]/2⌉` palindromes; the total is `Σ⌈p[i]/2⌉`, which is `Θ(n²)` in magnitude (Corollary 7.3) yet computed in `O(n)` — store it in 64-bit.
- **Distinct palindromes (Theorem 8.1).** There are at most `n` distinct palindromic substrings, but `p[]` does not deduplicate across centers; the eertree (Section 9) is the structure that enumerates the distinct ones online.
- **Parity invariants (Lemmas 3.4, Proposition 7.5).** `p[i]` has the same parity as the center type, giving a free consistency assertion; odd/even palindrome counts split the same radius array by center parity.
- **Nesting (Lemma 7.4).** Palindromes at a center form a totally ordered chain, which is *why* the per-center count is the simple closed form `⌈p[i]/2⌉` rather than an enumeration.
- **Prefix/suffix structure (Proposition 8.4).** Palindromic prefixes and suffixes are read off `p[]` by a start/end condition, the backbone of "shortest palindrome by prepending" and factorization DPs (Section 11).
- **Optimality (Section 10).** `O(n)` is optimal for the longest palindrome and for counting (Theorems 10.1, 10.4); only *enumerating* all occurrences is inherently `Θ(n²)`. Hashing is `O(n log n)` and probabilistic but extends to range/approximate queries.
- **Eertree duality (Section 9).** Manacher (geometric: box, radii) and the eertree (combinatorial: suffix links, distinct nodes) are complementary linear-time engines; a full palindrome toolkit runs both.

### Theorem Reference Table

| Result | Statement | Proof technique |
|--------|-----------|-----------------|
| Lemma 1.8 | reversal symmetry; `s` and `s^R` share longest-pal length | definition of palindrome |
| Lemma 2.2 | all palindromes of `t` are odd | parity of separators |
| Proposition 2.6 | transform `Φ` is a bijection onto its image | injectivity + surjectivity |
| Theorem 2.4 | radius in `t` = length in `s` | counting + bijection |
| Lemma 3.3 | local symmetry inside a palindrome | box palindrome identities |
| Lemma 3.4 | `p[i]` parity = center type | maximality + alternation |
| Theorem 4.1 | mirror init is correct | symmetry (Lemma 3.3) + maximality contradiction |
| Theorem 5.2 | scan computes exact `p[]` | box invariant + induction |
| Theorem 6.1 | `O(n)` time | amortized monotone `r`-pointer |
| Lemma 7.4 | palindromes at a center nest | maximality + parity |
| Theorem 7.2 | total count `= Σ⌈p/2⌉` | unique center per palindrome |
| Theorem 8.1 | ≤ `n` distinct palindromes | new-longest-palindromic-suffix |
| Proposition 8.4 | prefixes/suffixes from `p[]` | start/end condition |
| Theorem 10.1 | `Ω(n)` lower bound | adversary argument |
| Theorem 10.4 | `O(n)` comparison-optimal | comparison-model counting |

### Closing Notes

- **Two consequences of one `min`.** The clamp `min(r - i, p[i'])` delivers *both* correctness (Theorem 4.1, no unverified palindrome claimed) and linearity (Theorem 6.1, expansion only probes past `r`). Dropping it breaks both simultaneously — the single most important line to get right.
- **The transform is a bijection, not a hack.** Proposition 2.6 and Theorem 2.4 make "insert `#`" a rigorous length-preserving correspondence; the convenient "radius = length" identity is a theorem, not a coincidence, and the recovery formula `(i - p[i])/2` is exact.
- **All vs distinct is a genuine dichotomy.** Manacher's `Σ⌈p/2⌉` (occurrences, Theorem 7.2) and the eertree's `#nodes - 2` (distinct, Theorem 8.1) are different quantities computed by structurally different linear algorithms (Section 9). The defect (Corollary 8.3a) quantifies the gap.
- **Optimality is settled.** `O(n)` is comparison-optimal (Theorem 10.4) and adversary-optimal (Theorem 10.1); only enumeration is inherently quadratic.
- **The radius array is a reusable certificate.** From one `O(n)`-computed `p[]` follow the longest palindrome (max), the occurrence count (`Σ⌈p/2⌉`), the parity-split counts (Proposition 7.5), the palindromic prefixes/suffixes (Proposition 8.4), and the factorization-DP transitions (Section 11) — all by arithmetic, no re-scan. This reuse is the practical payoff of the theory: prove the array correct once, then read every palindromic-substring statistic from it.

### Proof-Dependency Map

The results build on each other in a clean chain, useful for navigation:

```
Lemma 2.2 (odd palindromes) ─┐
                             ├─→ Theorem 2.4 (radius = length) ─→ Theorem 7.2 (count)
Proposition 2.6 (bijection) ─┘
Lemma 3.3 (local symmetry) ──→ Theorem 4.1 (mirror init) ──┐
                                                           ├─→ Theorem 5.2 (correctness)
Invariant 5.1 (box validity) ─────────────────────────────┘
Theorem 4.1 (clamp) ──→ Theorem 6.1 (O(n) amortized)
Theorem 8.1 (≤ n distinct) ──→ Section 9 (eertree linear-size)
```

Each arrow is a strict logical dependency; the clamp of Theorem 4.1 is the hub through which both correctness (5.2) and linearity (6.1) pass, which is why it is the single most important line of the implementation.

Foundational references: Manacher (1975) for the original linear-time online algorithm; Apostolico-Breslauer-Galil and Gusfield (*Algorithms on Strings, Trees, and Sequences*) for the modern array presentation and amortized analysis; Rubinchik-Shur (2015) for the eertree and the distinct-palindrome bound; Droubay-Justin-Pirillo for the `≤ n` distinct-palindromes theorem and the notion of rich words. Sibling topics: `14-palindromic-tree` (eertree), KMP-style prefix functions, and polynomial string hashing.

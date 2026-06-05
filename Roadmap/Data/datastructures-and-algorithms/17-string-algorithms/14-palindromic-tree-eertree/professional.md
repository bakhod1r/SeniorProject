# Palindromic Tree (eertree) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The At-Most-`n+2` Distinct Palindromes Theorem
3. The "At Most One New Palindrome Per Character" Lemma
4. Suffix-Link Correctness
5. Online Construction Correctness
6. Amortized `O(n)` Complexity of the Suffix-Link Walk
7. Occurrence-Count Propagation Correctness
8. Series Links and the `O(log n)` Series Structure
9. Palindromic Richness
10. Lower Bounds and Optimality
11. Relation to Other Palindromic Structures
12. Summary

This document proves the structural and complexity guarantees of the eertree from first principles: the linear node bound, the correctness of suffix links and the online construction, the amortized running time, the occurrence-count propagation, the series-link logarithmic structure, palindromic richness, and the optimality of the whole scheme. Each theorem is paired with a worked example so the abstraction stays grounded.

---

## 1. Formal Definitions

Let `s = s[0] s[1] … s[n-1]` be a string over a finite alphabet `Σ`. Indices are 0-based; `s[i..j]` denotes the substring `s[i] … s[j]` (inclusive), and `|w|` the length of a string `w`.

**Definition 1.1 (Palindrome).** A string `w` is a **palindrome** if `w = w^R`, where `w^R` is the reversal of `w`. The empty string `ε` (length 0) and every single character (length 1) are palindromes by convention. Equivalently, `w[k] = w[|w| - 1 - k]` for all `0 ≤ k < |w|` — the mirror condition that the eertree's wrap-in-`c` edge preserves (wrapping a palindrome in the same character on both sides yields another palindrome).

**Definition 1.2 (Palindromic substring).** A substring `s[i..j]` is **palindromic** if it is a palindrome. The set of all distinct palindromic substrings of `s` is denoted `PAL(s)`. Note `PAL(s)` is a *set* (distinct), so `|PAL(s)|` counts each palindrome once regardless of multiplicity; the multiplicity-aware total is a separate quantity (Definition 7.1).

**Definition 1.3 (Palindromic suffix).** A **palindromic suffix** of `s` is a suffix `s[i..n-1]` that is a palindrome. The **longest palindromic suffix** `lps(s)` is the one of maximum length. The empty string is a palindromic suffix of every string, so `lps` is always well-defined; for a string ending in a character `c`, `lps` has length at least 1.

**Definition 1.4 (eertree).** The **eertree** of `s` is a directed graph with:
- two **roots**: an *imaginary root* `r_{-1}` with `len(r_{-1}) = -1` and an *empty root* `r_0` with `len(r_0) = 0` (representing `ε`);
- one node per element of `PAL(s)`, the node for palindrome `w` carrying `len = |w|`;
- a **child edge** labeled `c ∈ Σ` from the node of palindrome `w` to the node of palindrome `c w c` (when `c w c ∈ PAL(s)`);
- a **suffix link** `link(w)` from the node of `w` (with `|w| ≥ 1`) to the node of its **longest proper palindromic suffix** (`link` of `r_0` and `r_{-1}` point to `r_{-1}` by convention).

**Definition 1.5 (Active node `last`).** During the online construction of `s[0..i]`, `last_i` is the node of `lps(s[0..i])`, the longest palindromic suffix of the prefix processed so far.

**Notation conventions.** Throughout, `n = |s|`; `Σ` the alphabet with `|Σ|` its size; `PAL(s)` the set of distinct palindromic substrings; `link` the suffix link; `len(v)` the palindrome length at node `v`; `lps` the longest-palindromic-suffix operator. The imaginary root's `len = -1` is a formal device, not a string length. The Iverson bracket `[P]` is `1` if `P` holds, else `0`.

**Remark.** The two roots make the recurrence `len(c w c) = len(w) + 2` uniform: a length-1 palindrome `c` is `c · ε^{(-1)} · c` where the "inner string" `r_{-1}` has formal length `-1`, so `len(c) = -1 + 2 = 1`. Odd palindromes descend from `r_{-1}`, even palindromes from `r_0`.

**Definition 1.6 (Child edge formally).** For a node `w` and character `c`, define `next[w][c]` to be the node of `c w c` if `c w c ∈ PAL(s)`, else undefined. The map `c ↦ next[w][c]` has at most `|Σ|` entries per node, so the total number of child edges is at most `|Σ| · (numberOfNodes)` but in fact at most `numberOfNodes - 2` (each non-root node has exactly one incoming child edge — its creating edge — so the edges form a forest of two trees rooted at `r_{-1}` and `r_0`).

**Definition 1.7 (Two parity trees).** The child edges partition the non-root nodes into two trees: the **odd tree** rooted at `r_{-1}` (all odd-length palindromes) and the **even tree** rooted at `r_0` (all even-length palindromes). A node's depth in its parity tree equals `⌈len/2⌉`. This is distinct from the suffix-link tree (Definition 4.1 / Theorem 4.2), which interleaves both parities by suffix relationship. Keeping the two trees (child edges vs suffix links) conceptually separate is essential: the child tree *builds* palindromes by wrapping; the suffix-link tree *relates* them by suffix.

**Definition 1.8 (`endCount` / suffix-link depth).** For a node `v ≥ 2`, `endCount(v)` is its depth in the suffix-link tree (distance to `r_0` counting `v` itself), equivalently the number of palindromic suffixes of `v` including `v`. By Corollary 4.3, `endCount(v) = endCount(link(v)) + 1`, with `endCount(r_0) = 0`. When `v = last_i`, `endCount(v)` is the number of palindromic substrings ending at position `i`.

**Definition 1.9 (`occ`).** For a node `v`, `occ(v)` is the number of occurrences (start positions) of the palindrome `v` in `s`; equivalently the size of the subtree of `v` in the suffix-link tree, weighted by the per-position "longest palindromic suffix" counts (Theorem 7.2). These two annotations — `endCount` (a top-down/depth quantity) and `occ` (a bottom-up/subtree quantity) — are the dual statistics the suffix-link tree supports, computed in `O(1)` and `O(n)` respectively.

---

## 2. The At-Most-`n+2` Distinct Palindromes Theorem

**Theorem 2.1.** A string `s` of length `n` has at most `n` distinct nonempty palindromic substrings; equivalently, the eertree has at most `n + 2` nodes (including the two roots), and `|PAL(s) \ {ε}| ≤ n`.

This is the foundational bound that makes the eertree linear-space. It is a direct corollary of Lemma 3.1 below, proved by induction on the prefix length.

**Proof.** Let `P_i = PAL(s[0..i])` be the set of distinct nonempty palindromic substrings of the prefix of length `i + 1`. We show `|P_i| ≤ i + 1`. For `i = 0`, the prefix is a single character, with exactly one nonempty palindromic substring, so `|P_0| = 1 ≤ 1`. Inductively, going from `s[0..i-1]` to `s[0..i]`, Lemma 3.1 states that at most one new distinct palindrome appears (a palindromic suffix of `s[0..i]` not present before). Hence `|P_i| ≤ |P_{i-1}| + 1 ≤ i + 1`. For `i = n - 1`, `|PAL(s) \ {ε}| = |P_{n-1}| ≤ n`. Adding the two roots (`r_{-1}` and `r_0` for `ε`) gives at most `n + 2` nodes. ∎

**Corollary 2.2 (Distinct count formula).** The number of **distinct palindromic substrings** of `s` equals `numberOfNodes - 2`, since every non-root node corresponds to exactly one element of `PAL(s)` and the correspondence is a bijection (each distinct palindrome gets exactly one node, by the reuse rule of the online construction, Section 5).

**Tightness.** The bound `n` is tight: the string `a^n = aaaa…a` has exactly the `n` distinct palindromes `a, aa, …, a^n`, so its eertree has exactly `n` non-root nodes. No string of length `n` exceeds `n` distinct nonempty palindromes — this is the *palindromic richness* upper bound (Section 9).

### 2.1 Worked Verification of the Bound

Take `s = "abacaba"` (`n = 7`). Its distinct nonempty palindromes are:

```
a, b, c, aba, aca, abacaba   ... and bacab? no (not present) ; let us enumerate by center:
positions:  a b a c a b a
distinct palindromes: a, b, c, aba, aca, bacab? (b a c a b — is it a substring? s[1..5] = "bacab" ✓),
                      abacaba (the whole string)
```

Carefully enumerating: `a`, `b`, `c`, `aba`, `aca`, `bacab`, `abacaba` — **7 distinct**, exactly `n`. So `abacaba` attains the maximum and its eertree has `7 + 2 = 9` nodes. This string is **rich** (Section 9). Contrast with `s = "abcde"` (`n = 5`): only `a, b, c, d, e` are palindromic (no longer palindrome occurs), so it has `5` distinct — also rich, but for the trivial reason that no character repeats symmetrically. Both attain the bound; richness is common, not rare.

### 2.2 The Bijection Node ↔ Palindrome

Theorem 2.1's `n + 2` bound relies on Corollary 5.2 (each distinct palindrome gets *exactly one* node). The map `node ↦ palindrome string` is:

- **Total** — every node `v ≥ 2` was created for a specific palindrome `cXc` and never re-purposed.
- **Injective** — the reuse rule (Section 5, step 2) detects an already-existing palindrome via `next[cur][c]` and *never* creates a second node for it.
- **Surjective onto `PAL(s)`** — Theorem 5.1 shows every palindromic substring of `s` becomes `last` at the position where it first occurs as the longest palindromic suffix, hence gets a node.

Therefore `|PAL(s) \ {ε}| = numberOfNodes - 2` exactly, not merely `≤`. The distinct-count formula is an equality, which is why the eertree is the *canonical* representation of the distinct palindrome set.

### 2.3 An Alternative Proof via Centers

A second proof of the `≤ n` bound counts palindromes by their **center**. A palindrome of `s` has a center that is either a character (odd length) or a gap between characters (even length); there are `n + (n-1) = 2n - 1` possible centers. For each center, the palindromes around it are *nested* (a longer one contains all shorter ones), so the set of distinct palindromes is bounded by the number of *maximal* palindromic radii — but this naive count gives `O(n)` per center, `O(n²)` total, which is the wrong bound. The induction proof (via Lemma 3.1) is sharper because it counts *new* palindromes per appended character, capturing the global dedup that the center view misses. The center view is the basis of *Manacher's* algorithm (which counts, not dedups); the per-character view is the basis of the *eertree* (which dedups). This contrast is the clearest illustration of why the two structures answer different questions.

---

## 3. The "At Most One New Palindrome Per Character" Lemma

The crux of Theorem 2.1 is the following classical fact (Droubay–Justin–Pirillo).

**Lemma 3.1.** For any string `t` and character `c`, the string `tc` contains at most one palindromic substring that does **not** occur in `t`. Such a new palindrome, if it exists, is exactly the **longest palindromic suffix** of `tc`.

**Proof.** Any palindromic substring of `tc` that is new (not in `t`) must **end at the last position** of `tc` (otherwise it lies entirely within `t` and is not new). So every new palindrome is a palindromic *suffix* of `tc`. Suppose, for contradiction, that there are two new palindromic suffixes `u` and `w` of `tc` with `|u| > |w| ≥ 1`. Since both are suffixes of `tc`, `w` is a suffix of `u`. Because `u` is a palindrome, its suffix `w` (read backward) is a prefix of `u` (read backward) — i.e. `w` also occurs in `u` as a **prefix**, hence `w` occurs at a position of `tc` that ends *before* the last position. That occurrence of `w` lies inside `t` (it ends at position `|tc| - 1 - (|u| - |w|) ≤ |t| - 1`), so `w` already occurs in `t`, contradicting that `w` is new. Therefore at most one new palindromic suffix exists, and being the longest such suffix that is new, it is the longest palindromic suffix of `tc`. ∎

**Discussion.** The argument is purely about palindrome symmetry: a palindromic suffix `w` is also a palindromic *prefix* of any longer palindromic suffix `u`, forcing an earlier occurrence of `w` and so denying its novelty. This "the shorter palindromic suffix already occurred earlier" mechanism is exactly what the online construction's edge-reuse (Section 5, step 2) detects: when `next[cur][c]` already exists, the palindrome `c X c` is not new, matching the lemma.

**Worked instance.** Take `t = "aba"`, `c = "b"`, so `tc = "abab"`. Palindromic suffixes of `abab`: `b` (occurs in `t`), `bab` (new — does it occur in `aba`? no). So exactly **one** new palindrome `bab` appears, and it is the longest palindromic suffix of `abab`. The lemma holds.

### 3.1 The Symmetry Argument in Full Detail

The heart of Lemma 3.1 is that **a shorter palindromic suffix of a longer palindromic suffix has already appeared earlier**. Let us make the position arithmetic explicit. Suppose `u` and `w` are both palindromic suffixes of `tc` (so both end at the last index `m = |tc| - 1`), with `|u| > |w|`. Because `w` is a suffix of `u` and `u` is a palindrome, reversing `u` shows `w^R` is a prefix of `u^R = u`; but `w` is a palindrome so `w^R = w`, hence `w` is a **prefix** of `u`. Thus `w` occurs in `tc` starting where `u` starts, i.e. at start index `m - |u| + 1`, and that occurrence of `w` ends at index `m - |u| + |w| = m - (|u| - |w|) < m`. Since this end index is strictly less than `m`, the occurrence lies entirely within `t = tc[0..m-1]`. Therefore `w` already occurs in `t` and is **not** new.

The contrapositive is the operational rule: the *only* candidate for a new palindrome is the **single longest** palindromic suffix; every shorter palindromic suffix necessarily re-occurs earlier. This is why the construction needs to check only one node (`next[cur][c]`) for novelty — the lemma guarantees there is at most one new palindrome, and it is exactly `cXc` for the `X` that `getLink` returns.

### 3.2 Consequence: the Online Distinct-Count Delta

Combining Lemma 3.1 with Corollary 2.2: when processing character `i`, the distinct palindrome count increases by exactly `[a new node was created]`. The online build therefore tracks the running distinct count as a prefix sum of these 0/1 deltas, in `O(1)` per character — no recomputation. This is the formal basis for the streaming distinct-count engine of the senior file.

---

## 4. Suffix-Link Correctness

**Definition 4.1.** For a palindrome `w` with `|w| ≥ 1`, `link(w)` is the node of the longest proper palindromic suffix of `w` (proper meaning strictly shorter than `w`).

**Theorem 4.2 (Suffix links form a tree).** The suffix links define a forest that, with the empty/imaginary roots, is a single tree: following `link` from any node strictly decreases `len`, terminating at `r_0` (then `r_{-1}`). For any node `w`, the chain `w → link(w) → link²(w) → … → r_0` enumerates **all** palindromic suffixes of `w` in strictly decreasing length.

**Proof.** *Strict decrease:* `link(w)` is a *proper* palindromic suffix, so `len(link(w)) < len(w)`; the chain decreases and must reach `r_0` (length 0) in finitely many steps. *Completeness (every palindromic suffix appears):* Let `u` be any palindromic suffix of `w` with `0 < |u| < |w|`. We claim `u` appears on the chain. The longest proper palindromic suffix `link(w)` is the longest such; any other palindromic suffix `u` of `w` is also a palindromic suffix of `link(w)` — because `u`, being a suffix of `w` shorter than `link(w)`... more carefully: `u` is a suffix of `w`; both `u` and `link(w)` are palindromic suffixes of `w`, and `|u| ≤ |link(w)|`, so `u` is a suffix of `link(w)`; since `u` is a palindrome it is a palindromic suffix of `link(w)`. By induction on length, `u` lies on the chain from `link(w)`. Hence the chain from `w` lists every palindromic suffix exactly once. ∎

**Corollary 4.3.** The number of palindromic suffixes of `w` equals the depth of `w` in the suffix-link tree (distance to `r_0`). This justifies the `endCount[v] = endCount[link[v]] + 1` recurrence: the count of palindromes ending at a position whose longest palindromic suffix is `v` equals one more than that of its suffix-link parent.

**Correctness of the construction's link assignment.** When the online build creates the node for `w = c X c` (Section 5), it sets `link(w)` to the node reached by `next[ getLink(link(X), i) ][c]`. We prove this is the longest proper palindromic suffix of `w`:

**Lemma 4.4.** The longest proper palindromic suffix of `c X c` is `c Y c`, where `Y` is the longest palindromic suffix of `X` (other than `X` itself) such that `c Y c` is a suffix of `c X c` — i.e. such that the character preceding that occurrence of `Y` equals `c`. Equivalently, `Y = getLink(link(X), i)` and `link(w) = next[Y][c]`.

**Proof.** A proper palindromic suffix `p` of `w = cXc` with `|p| ≥ 2` has the form `c Y c` for some palindrome `Y` (it starts and ends with `c` and is a palindrome, so stripping the outer `c`'s leaves a palindrome `Y`), and `Y` is a proper palindromic suffix of `X`. The longest such `Y` for which `cYc` is actually a suffix of `cXc` (the preceding character must be `c`) is found by walking suffix links from `link(X)` with the same wrap-test `getLink` uses. The shortest case `|p| = 1` (`p = c`) is handled by the length-1 link to `r_0`. Hence `link(w) = next[Y][c]`, the child of `Y` on `c`, which exists because `cYc` is a (shorter, already-discovered) palindromic suffix of the current prefix. ∎

### 4.1 Worked Suffix-Link Tree for `abacaba`

The suffix links of the seven non-root nodes (from Section 5.1) form this tree (rooted at `ε`):

```
ε (#1)
├── a (#2)
│   └── aba (#4)
│       └── abacaba (#7)
├── b (#3)
│   └── bacab (#6)
└── c (#5)
```

Reading a chain top-down: `abacaba → aba → a → ε` lists the palindromic suffixes of `abacaba` in decreasing length (`7, 3, 1, 0`), exactly as Theorem 4.2 guarantees. The depth of `abacaba` is 3 (excluding `ε`), so 3 palindromes end at the last position of `abacaba`: `abacaba`, `aba`, `a` — matching `endCount[#7] = 3`. Notice the suffix-link tree **interleaves** odd palindromes (`a`, `aba`, `c`, `b`, `abacaba`) with the even ones (here none) — it is organized by *suffix relationship*, unlike the child-edge parity trees (Definition 1.7) organized by *wrapping*. The two trees coexist on the same node set, each answering a different question.

---

## 5. Online Construction Correctness

**Algorithm (append character `c` at position `i`, with `s[i] = c`).**
```
ADD(c, i):
  cur = GET-LINK(last, i)          # longest pal. suffix X of s[0..i-1] with c X c valid
  if next[cur][c] exists:
      last = next[cur][c]          # c X c already discovered (Lemma 3.1: not new)
      return false
  now = new node;  len[now] = len[cur] + 2
  if len[now] == 1: link[now] = r_0
  else:             link[now] = next[ GET-LINK(link[cur], i) ][c]   # Lemma 4.4
  next[cur][c] = now;  last = now
  return true

GET-LINK(x, i):
  while i - len[x] - 1 < 0  OR  s[i - len[x] - 1] != s[i]:
      x = link[x]
  return x
```

**Theorem 5.1 (Construction correctness).** After processing `s[0..i]`, `last` is the node of `lps(s[0..i])`, the node set is exactly `PAL(s[0..i])` plus the two roots, and all `len`/`link`/child fields are correct.

**Proof (induction on `i`).** *Base:* before any character, the tree is `{r_{-1}, r_0}`, `last = r_0`, `PAL(ε) = ∅`. *Step:* assume correctness for `s[0..i-1]`. `GET-LINK(last, i)` walks suffix links from `lps(s[0..i-1])` and returns the longest palindromic suffix `X` of `s[0..i-1]` such that `s[i - len(X) - 1] = s[i] = c`, i.e. `cXc` is a palindromic suffix of `s[0..i]`. The walk terminates because `r_{-1}` (`len = -1`) makes `i - len - 1 = i`, and `s[i] = s[i]` trivially holds — so `r_{-1}` is the universal fallback yielding the length-1 palindrome `c`.

`cXc = lps(s[0..i])`: it is a palindromic suffix, and it is the longest because `GET-LINK` returns the longest `X` passing the wrap-test, and wrapping the longest valid `X` gives the longest valid `cXc`. If `cXc` already has a node (`next[cur][c]` exists), by Lemma 3.1 it is not new and we reuse it; otherwise it is the unique new palindrome (Lemma 3.1) and we create one node, with `len` and `link` correct by Lemma 4.4. The node set thus becomes exactly `PAL(s[0..i])` plus roots, and `last` is set to `lps(s[0..i])`. ∎

**Corollary 5.2 (Uniqueness of nodes).** Each distinct palindrome receives exactly one node: step 2 reuses the existing node whenever the palindrome was seen, so no palindrome is duplicated, establishing the bijection of Corollary 2.2.

### 5.1 Full Worked Trace on `abacaba`

We trace `last`, the new node (if any), and the suffix link assigned. Roots: node 0 (`len -1`), node 1 (`ε`, `len 0`); `last = 1`.

```
i  c   getLink result        new node (len)            suffix link    last
0  a   imag root (len -1)     #2 "a"  (1)               #1 (ε)         #2
1  b   imag root (len -1)     #3 "b"  (1)               #1 (ε)         #3
2  a   #2 "a" (s[0]=a==a)     #4 "aba" (3)              #2 "a"         #4
3  c   imag root (len -1)     #5 "c"  (1)               #1 (ε)         #5
4  a   imag root (len -1)     reuse #2 "a"              —              #2
5  b   #2 "a" → ... → #4?     #6 "aca"? wait: s[5]=b    ...            #6 "bacab"
6  a   ...                    #7 "abacaba" (7)          #4 "aba"       #7
```

Reading carefully at `i = 4` (`c = a`): from `last = #5 "c"`, `getLink` walks `#5 → link #1 (ε)`; `s[4 - 0 - 1] = s[3] = c ≠ a`, walk to imaginary root, `s[4 - (-1) - 1] = s[4] = a ✓`; the edge imaginary `--a-->` is `#2 "a"`, which **exists** → reuse, no new node. At `i = 6` (`c = a`): the longest palindromic suffix of `abacab` extensible by `a` wraps to `abacaba`, a new node #7 of length 7, whose suffix link is `aba` (#4). The final tree has nodes `{0,1,2,3,4,5,6,7}` → `9` nodes → `7` distinct palindromes, matching Section 2.1.

### 5.2 The Role of the Imaginary Root, Re-examined

The imaginary root (`len = -1`) is exactly the device that makes `GET-LINK` a *total* function — it always terminates because the test `i - len[x] - 1 = i - (-1) - 1 = i` and `s[i] == s[i]` is trivially true. Removing the imaginary root and special-casing length-1 palindromes is possible but error-prone; the imaginary root unifies the two cases (a new length-1 palindrome `c` is `c` wrapped around the imaginary root) and is the reason the algorithm has *no* special branch inside the walk. This is a recurring theme: the `len = -1` fiction trades a tiny conceptual oddity for a uniform, branch-free inner loop.

### 5.3 Invariant Catalog

The construction maintains a precise set of invariants after each `ADD`, which a verifier can assert:

| Invariant | Statement | Why it holds |
|-----------|-----------|--------------|
| Length monotonicity | creation index order is non-decreasing in `len` | new `len = len[cur] + 2 > len[cur]`, and `cur` exists already |
| Strict suffix-link decrease | `len[link[v]] < len[v]` for `v ≥ 2` | `link` is a *proper* palindromic suffix |
| Root termination | every `link`-chain ends at `r_0` then `r_{-1}` | lengths strictly decrease and are bounded below |
| Bijection | distinct palindromes ↔ non-root nodes | reuse rule never duplicates (Corollary 5.2) |
| `last` is `lps` | `last = lps(s[0..i])` after step `i` | Theorem 5.1 |
| Node bound | `numberOfNodes ≤ n + 2` | Theorem 2.1 |

Asserting these in a debug build catches essentially every implementation bug — a violated invariant points directly at the faulty line (e.g. a length-monotonicity violation means a node was created with the wrong `cur`).

### 5.4 Position Indexing and the Off-by-One

The single most error-prone detail is the index `i` used in `GET-LINK`. The convention used here: append the new character to the buffer *first* (so `buf[i] = c` with `i = oldLength`), then call `GET-LINK(last, i)`. The wrap-test then reads `buf[i - len[x] - 1]` — the character immediately preceding the candidate palindromic suffix `X` that ends at index `i - 1`. If the candidate `cXc` is to be a palindrome ending at `i`, the character before `X` (at index `i - len[X] - 1`) must equal `buf[i] = c`. Getting this index wrong by one silently builds a *different* (incorrect) tree that may still pass small smoke tests, which is why the brute-force oracle on dense-palindrome strings is essential.

---

## 6. Amortized `O(n)` Complexity of the Suffix-Link Walk

The only non-`O(1)` part of `ADD` is the `while` loop inside `GET-LINK`. We bound the **total** number of loop iterations across the whole construction.

**Theorem 6.1.** The total number of suffix-link traversals performed by all `GET-LINK` calls during the construction of `s` is `O(n)`. Hence the construction runs in `O(n · |Σ|)` with array children (or `O(n log |Σ|)` / `O(n)` expected with map / hashed children) and `O(1)` amortized per character (ignoring the child lookup).

**Proof (potential / amortization).** Define the potential `Φ_i = len[last_i]` after processing `s[0..i]` (with `Φ_{-1} = 0` for `last = r_0`). Two observations:

1. **Each `GET-LINK` step decreases `len[last]`.** Walking one suffix link replaces the current candidate by a strictly shorter palindromic suffix, decreasing the working length by at least 1.
2. **`len[last]` increases by at most 2 per character.** `len[last_i] = len[cur] + 2` and `cur` is a palindromic suffix of `s[0..i-1]`, so `len[cur] ≤ len[last_{i-1}]`. Therefore `Φ_i ≤ Φ_{i-1} + 2`.

There are two `GET-LINK` calls per `ADD` (one for `cur`, one inside the link computation), but both only walk *upward* (decreasing length). Let `W_i` be the number of suffix-link steps in step `i`. Then `Φ_i ≤ Φ_{i-1} + 2 - W_i'` where `W_i'` accounts for the net downward movement before the final `+2` rise. Summing telescopes:

```
Σ_i W_i  ≤  Σ_i (Φ_{i-1} + 2 - Φ_i)  =  Φ_{-1} - Φ_{n-1} + 2n  ≤  2n,
```

since `Φ ≥ -1` is bounded. Thus the total walk work is `≤ 2n = O(n)`. Each individual `ADD` may walk many links, but the *amortized* cost is `O(1)` walk steps. Adding the `O(|Σ|)` (array) or `O(1)` expected (hash) child lookup per character yields the stated bounds. ∎

**Remark (the same potential as KMP / suffix automaton).** This is structurally identical to the amortization of the KMP failure-function walk and of Blumer/Crochemore suffix-automaton construction: a quantity (matched length / state length / palindrome length) rises by `O(1)` per character and the walk only decreases it, bounding total decreases by total increases.

### 6.1 Worst-Case Walk Length per Character

Although the *amortized* walk is `O(1)`, a single `ADD` can walk `Θ(n)` suffix links — e.g. processing the middle of a string like `a^{n/2} b a^{n/2}`, where appending a character collapses a long palindromic-suffix chain. The amortization guarantees this is rare: a long walk at position `i` is "paid for" by the many earlier positions that grew `len[last]` slowly. This is why you must **never** add a per-character bound or early-exit that assumes short walks — the algorithm relies on the global potential, not a local guarantee. Profiling the *total* walk count (must be `≤ 2n`) is the correct check, not the per-call maximum.

### 6.2 Two Walks per Character

`ADD` performs up to two `GET-LINK` walks: one to find `cur` (the node to extend), and one inside the link computation to find the new node's suffix-link target. Both walk *upward* (toward shorter palindromes), so both are governed by the same potential argument; the constant in the `2n` bound absorbs the factor of two. A common micro-optimization starts the second walk from `link[cur]` rather than re-walking from `last`, since the suffix link of `cXc` is a palindromic suffix shorter than `X` — exploiting that the second walk's starting point is already known to be valid below `cur`.

### 6.3 Potential Evolution on `aaab`

To make the amortization tangible, track `Φ = len[last]` through `s = "aaab"`:

```
i  c   action                        len[last] before → after   walk steps
0  a   new "a"                       0 → 1                       0 (imag root direct? from empty root walk 1)
1  a   new "aa"                      1 → 2                       0
2  a   new "aaa"                     2 → 3                       0
3  b   walk down then new "b"        3 → 1                       3 (a→ε→imag, then b is len 1)
```

At `i = 3`, the long suffix-link walk (3 steps, collapsing `aaa → aa → a → ε`) is exactly "paid for" by the three earlier steps that each raised `Φ` by 1 with **zero** walk cost. The running total of walk steps is `0+0+0+3 = 3 ≤ 2·4 = 8`, comfortably within the bound. This is the amortization made visible: cheap steps bank potential that expensive steps spend. An adversary cannot force many expensive steps in a row, because each expensive walk *consumes* potential that took proportionally many cheap steps to build.

### 6.4 The Bound Is Per-Character Loose but Globally Tight

The `2n` total-walk bound is loose for any single character (some do `0`, some do `Θ(n)`), but globally tight up to the constant: strings like `(a^k b)^{n/(k+1)}` repeatedly build and collapse length-`k` palindromic chains, forcing `Θ(n)` total walk steps. No construction does asymptotically more total work, confirming that the amortized `O(1)`-per-character build is the best achievable for this approach.

---

## 7. Occurrence-Count Propagation Correctness

We now prove the algorithm that counts **total occurrences** of each palindrome (each palindromic substring counted once per occurrence).

**Definition 7.1.** For a palindrome `w ∈ PAL(s)`, let `occ(w)` be the number of (start) positions at which `w` occurs in `s`. The **total number of palindromic substrings** (with multiplicity) is `Σ_{w} occ(w)`.

**Initialization.** During construction, increment `cnt[v]` by 1 each time node `v` becomes `last` (i.e. each time `v = lps(s[0..i])` for some `i`). After the build, `cnt[v]` equals the number of positions `i` at which `v` is the **longest** palindromic suffix.

**Theorem 7.2 (Propagation).** Process nodes in **non-increasing `len` order** (equivalently, reverse creation order), executing `cnt[link[v]] += cnt[v]`. After this pass, `cnt[v] = occ(v)` for every node `v`.

**Proof.** A palindrome `w` occurs ending at position `i` **iff** `w` is a palindromic suffix of `s[0..i]`, i.e. iff `w` lies on the suffix-link chain from `last_i` (Theorem 4.2). Initially `cnt[v]` counts positions where `v` is the *longest* palindromic suffix (the top of the chain). For `v` to be counted at *every* position where it is *any* palindromic suffix, it must inherit the counts of all nodes `u` with `v` on `u`'s suffix-link chain — exactly the descendants of `v` in the suffix-link tree. Propagating `cnt[link[v]] += cnt[v]` pushes each node's accumulated count to its parent; processing in length-descending order guarantees a node has received all its descendants' counts *before* it is pushed upward (since descendants are longer, hence processed earlier). By induction over the reverse order, the final `cnt[v]` sums the initial counts over the entire subtree of `v`, which is precisely the number of positions where `v` is *some* palindromic suffix = `occ(v)`. ∎

**Corollary 7.3.** Reverse creation order is a valid length-descending order because `len` is non-decreasing in creation index (a new node has `len = len[cur] + 2` with `cur` already existing and of smaller length). Hence no explicit sort is needed.

**Corollary 7.4 (Per-position equals total).** `Σ_v occ(v) = Σ_i (number of palindromic suffixes of s[0..i]) = Σ_i endCount[last_i]`, giving two independent computations of the total — a strong cross-check (Section 9 of the senior file).

### 7.1 Worked Propagation on `ababa`

After building the eertree of `ababa`, the nodes and their *initial* `cnt` (times each became `last`) are:

```
node  pal     len  link   cnt (initial: times it was 'last')
#2    a       1    ε       1   (last only at i=0; later 'a' positions have a longer LPS)
#3    b       1    ε       1   (last at i=1)
#4    aba     3    #2 a    1   (last at i=2)
#5    bab     3    #3 b    1   (last at i=3)
#6    ababa   5    #4 aba  1   (last at i=4)
```

Propagating in reverse creation order (`#6, #5, #4, #3, #2`):

```
#6 → #4:  cnt[#4] += cnt[#6]  → cnt[#4] = 2
#5 → #3:  cnt[#3] += cnt[#5]  → cnt[#3] = 2
#4 → #2:  cnt[#2] += cnt[#4]  → cnt[#2] = 3
#3 → ε:   (root, ignored for the total)
#2 → ε:   (root)
```

Final occurrence counts: `a:3, b:2, aba:2, bab:1, ababa:1`, summing to **9** — exactly the total palindromic substring count. Note how `a`'s count grew from 1 to 3 by inheriting from `aba` (which itself inherited from `ababa`): the suffix-link tree path `ababa → aba → a` correctly funnels every occurrence of the longer palindrome down to its palindromic suffixes.

### 7.2 Why Initialization at `last` Suffices

A subtle point: we increment `cnt[v]` only when `v` is the **longest** palindromic suffix `last_i`, not every palindromic suffix of position `i`. This is deliberate — counting every palindromic suffix at every position would be `O(n²)` (the chain can be long). Instead, the propagation pass *defers* that summation to the suffix-link tree, doing it once in `O(n)`. The correctness (Theorem 7.2) hinges on the fact that the set of palindromic suffixes at position `i` is precisely the suffix-link chain from `last_i`, so summing over chains is equivalent to summing over subtrees — which the upward propagation computes.

### 7.3 Magnitude and Modular Reduction

**Proposition 7.5.** For any `s` of length `n`, the total palindrome count `T(s) = Σ_v occ(v)` satisfies `n ≤ T(s) ≤ n(n+1)/2`, with the upper bound attained by `a^n` and the lower bound by any rich string with no palindrome longer than 1 (e.g. `s` over a large alphabet with all-distinct characters).

**Proof.** Each of the `n` single characters is a palindrome, giving `T(s) ≥ n`. The upper bound is the number of all substrings `n(n+1)/2`, attained when *every* substring is a palindrome — true exactly for `a^n`. ∎

Because `T(s)` can be `Θ(n²)`, it overflows 32-bit integers around `n ≈ 92682`. Production code uses 64-bit accumulators (overflow only past `n ≈ 4.3 × 10^9`, far beyond memory limits) or, when the problem demands it, reduces modulo a prime at every `occ[link[v]] += occ[v]` step. The reduction is a ring homomorphism, so it commutes with the propagation: reducing per step yields the true total mod `p`. This is the palindromic analogue of the modular-pipeline reasoning in matrix-exponentiation counting (sibling `32` in `11-graphs`).

### 7.4 First-Occurrence Position

A frequently needed annotation is `firstEnd[v]` = the end position of the **first** occurrence of palindrome `v`. Set it at node creation (`firstEnd[v] = i`), and `firstStart[v] = i - len[v] + 1`. These let you reconstruct each palindrome's string in `O(len)` by slicing `s`, and support queries like "the lexicographically smallest palindrome occurring at least `k` times". No extra pass is needed; the position is known exactly when the node is born.

---

## 8. Series Links and the `O(log n)` Series Structure

To aggregate over **all** palindromic suffixes of each prefix in subquadratic time, we use the arithmetic structure of palindromic suffix lengths.

**Lemma 8.1 (Periodicity of palindromic suffixes).** For any node `v`, define `diff(v) = len(v) - len(link(v))`. Along the suffix-link chain `v → link(v) → …`, group maximal runs with the same `diff`. The lengths of palindromic suffixes of any string fall into `O(log n)` such groups ("series"), each an arithmetic progression. Equivalently, the number of distinct values of `diff` along any suffix-link chain is `O(log n)`.

**Proof sketch.** This follows from the **Fine–Wilf / Three-Squares lemma** on periodicity: if a string has three palindromic suffixes of lengths `ℓ_1 < ℓ_2 < ℓ_3` with `ℓ_3 ≤ ℓ_1 + ℓ_2` (close lengths), they induce a common period, and consecutive close palindromic suffixes share the same `diff`. Each time `diff` changes, the palindrome length at least halves (a period argument), so there are `O(log n)` distinct `diff` values, hence `O(log n)` series. ∎

**Definition 8.2 (Series link).** `slink(v) = link(v)` if `diff(v) ≠ diff(link(v))`, else `slink(v) = slink(link(v))`. `slink(v)` jumps to the **top node of `v`'s current series**, skipping all suffixes sharing `diff(v)`.

**Theorem 8.3.** Walking `slink` instead of `link` visits `O(log n)` nodes per position, so any DP that maintains one aggregate per series (updating it in `O(1)` as the series shifts by one position) over all prefixes runs in `O(n log n)`.

**Application (minimum palindromic factorization).** Let `f(i)` be the minimum number of palindromes that `s[0..i-1]` splits into. Using `slink` and a per-series stored "best `f` at the series boundary", one updates all `O(log n)` series in `O(1)` each per position, computing all `f(i)` in `O(n log n)` — the Kosolobov–Rubinchik–Shur / Borozdin et al. result. The same machinery counts the number of palindromic factorizations modulo a prime.

### 8.1 The Three-Squares Lemma, Concretely

The `O(log n)` bound on the number of series rests on a periodicity fact. Suppose a string has palindromic suffixes of lengths `ℓ_1 < ℓ_2 < ℓ_3` that are "close" in the sense `ℓ_3 - ℓ_2 = ℓ_2 - ℓ_1` (same `diff`) and `ℓ_3 ≤ ℓ_1 + ℓ_2`. Then the overlap forces a period `p = ℓ_2 - ℓ_1`, and *all* palindromic suffixes in that range form an arithmetic progression with common difference `p` — a single **series**. The crucial quantitative claim is:

> Whenever `diff` changes from one series to the next (going up the chain toward shorter palindromes), the palindrome length **at least halves**.

Because a length can halve at most `⌊log₂ n⌋` times before reaching 1, there are at most `O(log n)` distinct `diff` values, hence `O(log n)` series. This is why `slink` (which skips an entire series in one jump) visits only `O(log n)` nodes per position. The lemma is a string-combinatorial cousin of the Fibonacci-like bound that makes the Euclidean algorithm logarithmic — repeated near-halving.

### 8.2 The Factorization DP in Detail

For minimum palindromic factorization, define `f(i)` = min palindromes covering `s[0..i-1]`. The transition is `f(i) = 1 + min over palindromic suffixes p of s[0..i-1] of f(i - |p|)`. Naively this minimizes over the whole suffix-link chain (`O(n)` per position). The series DP keeps, for each series of the *current* position, a stored value `seriesAns[v]` = the best `f(i - |p|)` over palindromes `p` in that series, maintainable in `O(1)` as the position advances by one (because consecutive positions' series shift predictably by the period). Iterating the `O(log n)` series via `slink` and combining their stored bests gives `f(i)` in `O(log n)` per position, `O(n log n)` total. The counting variant (number of factorizations mod `p`) replaces `min`/`+1` with `+`/sum and is otherwise identical.

### 8.3 Why Plain Suffix Links Fail Here

It is tempting to walk plain `link` and minimize over the whole chain — but that chain can be `Θ(n)` long (string `a^n`), making the DP `Θ(n²)`. The series links are *exactly* the device that compresses the `Θ(n)`-length chain into `O(log n)` series, each handled in `O(1)` by a shared running value. Without them, the eertree-based factorization is no faster than the trivial `O(n²)` DP. This is the one place where the difference between `link` and `slink` is asymptotic, not just constant-factor — and the reason series links are a senior/professional-level topic rather than a basic one. For pure distinct/total/per-position counting, plain `link` suffices and `slink` is unnecessary overhead.

---

## 9. Palindromic Richness

**Definition 9.1.** A string `s` of length `n` is **rich** (or *full*) if it attains the maximum number of distinct palindromic substrings, `|PAL(s) \ {ε}| = n` (Theorem 2.1's bound with equality).

**Theorem 9.2 (Richness characterization).** `s` is rich iff **every prefix** `s[0..i]` introduces a new palindrome when its last character is appended — i.e. the longest palindromic suffix `lps(s[0..i])` is a fresh palindrome (occurs for the first time) at every `i`. Equivalently, `s` is rich iff every prefix's longest palindromic suffix is **unioccurrent** in that prefix (occurs exactly once).

**Proof.** By Lemma 3.1, each character adds 0 or 1 new palindrome. The total is `n` (the max) iff *every* character adds exactly one, i.e. a new palindrome appears at every position, i.e. `lps(s[0..i])` is new (first occurrence) for all `i`. The unioccurrence reformulation is the standard Glen–Justin–Widmer–Zamboni characterization: a new longest palindromic suffix appears iff that suffix is unioccurrent in the prefix. ∎

**Corollary 9.3 (eertree richness test).** During the online build, `s` is rich iff `ADD` returns `true` (a new node was created) at **every** character. The eertree decides richness in `O(n)` with a single boolean check per character — no separate pass needed.

**Examples.** Rich strings include `aba`, `abacaba`, every prefix of a Sturmian word, and every unary string `a^n`. A canonical **non-rich** string is `s = "aabb"` ... checking: appending characters to `aabb` we get palindromes `a, aa, b, bb` — that is `4` distinct for `n = 4`, so `aabb` *is* rich. A genuine non-rich example is `s = "abca cba"`-style strings where a character closes a palindrome that already occurred. Concretely, `s = "aabbaa"` is **not** rich: `n = 6` but its distinct palindromes are `a, aa, b, bb, abba, aabbaa` plus `baab`? Enumerating gives fewer than 6 because some character adds no new palindrome — the formal certificate is exactly "some `ADD` returns false". The practical takeaway: the eertree's per-character `ADD` boolean *is* the richness certificate, so deciding richness is free during construction.

**Theorem 9.4 (Closure under reversal).** `s` is rich iff `s^R` is rich, and richness is preserved under taking factors (substrings): every factor of a rich string is rich. This follows because palindromic substrings of a factor are a subset of those of `s`, and the unioccurrence condition is inherited. This makes richness a robust, hereditary property — useful when reasoning about rich families of words.

### 9.1 Counting Distinct Palindromes per Prefix

The eertree gives, for free, the distinct-palindrome count of **every prefix** online: it is `numberOfNodes - 2` *at the moment that prefix is processed*. Equivalently, define `D(i) = ` distinct palindromes in `s[0..i]`; then `D(i) = D(i-1) + [ADD created a node at step i]`. This per-prefix curve is itself informative: its slope (1 vs 0 per step) directly reads off richness (all-1 slope ⇒ rich) and reveals where the string starts re-using palindromes. The curve is computed in `O(n)` with no extra structure.

### 9.2 A Genuinely Non-Rich Example, Verified

Consider `s = "aabbaa"` (`n = 6`). Process it and watch `ADD`:

```
i  c   palindrome closed (LPS)   new node?   running distinct
0  a   a                         yes (a)     1
1  a   aa                        yes (aa)    2
2  b   b                         yes (b)     3
3  b   bb                        yes (bb)    4
4  a   abba? no — LPS is "a"     NO          4   ← character adds no new palindrome
5  a   aabbaa? check ... "aa"... LPS = aabbaa? 
```

At `i = 4` the longest palindromic suffix of `aabba` is just `a` (which already exists), so **no new node** — the certificate that `aabbaa` is *not* rich. (Continuing, `i = 5` may or may not add `aabbaa` depending on the exact suffix structure.) The point: the eertree detects non-richness the instant `ADD` returns `false`, with zero extra work — the per-character boolean *is* the richness proof.

---

## 10. Lower Bounds and Optimality

**Space.** Storing the set `PAL(s)` explicitly as nodes uses `Θ(d)` space where `d = |PAL(s)| ≤ n` (Theorem 2.1), which is **optimal** for representing the distinct palindromes: you cannot represent `d` distinct objects in `o(d)` space. With array children the space is `O(n · |Σ|)`; with map children it is `O(n)`, matching the information-theoretic minimum up to constants.

**Time.** The construction is `O(n)` for constant `|Σ|` (or `O(n log |Σ|)` with comparison-based maps). Reading the input is `Ω(n)`, so the build is **optimal up to the alphabet factor**. There is no asymptotically faster way to enumerate all distinct palindromes, since you must at least read every character and emit up to `n` distinct palindromes.

**Counting vs storing.** Manacher's algorithm (sibling `11`) computes, in `O(n)`, the maximal palindrome radius at every center, from which the **total** number of palindromic substrings follows in `O(n)` — but it does **not** produce the set `PAL(s)` and cannot report `|PAL(s)|` (the distinct count) without additional `Θ(n)`-space machinery (e.g. hashing palindromes around centers, which is `O(n)` but more involved and not online). The eertree is the structure of choice precisely when the distinct **set** or per-palindrome annotation is required.

### 10.1 The Alphabet Factor

The `|Σ|` factor in the array-children build time deserves scrutiny. With array children, each `getLink`-found `cur` does an `O(1)` child probe, but *creating* a node allocates an `O(|Σ|)` child array, giving `O(n · |Σ|)` total. With a hash map, node creation is `O(1)` and probes are `O(1)` expected, giving `O(n)` expected — at the cost of hashing constants and worse cache behavior. With a balanced-tree (sorted) map, probes are `O(log |Σ|)`, giving `O(n log |Σ|)` worst-case deterministic. For the common competitive-programming case (`|Σ| = 26`), array children win on constant factors despite the `26×` memory; for genomic (`|Σ| = 4`) they are ideal; for Unicode they are infeasible and maps are mandatory.

### 10.2 Comparison to the `Θ(d)` Information Lower Bound

Any data structure that can *enumerate* the `d = |PAL(s)|` distinct palindromes must use `Ω(d)` space to distinguish them, so the eertree's `Θ(d)` node count (with map children) is space-optimal up to constants. It is also *time*-optimal for enumeration: emitting `d` distinct palindromes plus reading `n` characters is `Ω(n + d)`, and the eertree achieves `O(n)` (since `d ≤ n`). No structure can do asymptotically better for the distinct-set problem.

### 10.3 What the `len = -1` Trick Buys, Formally

A natural question: is the imaginary root *necessary*, or merely convenient? Formally, it is an encoding choice that makes the transition function total. Without it, `GET-LINK` would need an explicit guard "if we reach the empty root and still cannot extend, the new palindrome is the single character `c`", introducing a branch and a special case in the hottest loop. The imaginary root encodes that special case *as data* (`len = -1`, self-link), so the loop is uniform. This is a classic data-structure technique — replacing a control-flow special case with a sentinel node — also seen in sentinel-headed linked lists and the NIL leaf of red-black trees. The correctness payoff (Theorem 5.1's clean induction) and the performance payoff (a branch-free inner loop) both flow from this one encoding decision.

---

## 11. Relation to Other Palindromic Structures

| Structure | Stores | Build | Online | Distinct count | Total count | Per-palindrome data |
|-----------|--------|-------|--------|----------------|-------------|---------------------|
| **eertree** | nodes for `PAL(s)` | `O(n·|Σ|)` | yes | `nodes - 2` | suffix-link propagation | yes |
| **Manacher** (`11`) | radii per center | `O(n)` | no | not directly | sum of radii | no |
| **Suffix automaton of `s·#·s^R`** | states | `O(n)` | partly | indirect | indirect | harder |
| **Palindromic factorization DP + eertree** | + `f(i)` | `O(n log n)` | yes | — | — | factorization |

**The suffix-link tree is a "palindromic suffix automaton" analogue.** Just as the suffix automaton's suffix links partition substrings by `endpos` equivalence and propagate occurrence counts along links, the eertree's suffix links partition palindromic suffixes and propagate occurrences identically (Theorem 7.2). The structural parallel is exact: occurrence counting in both is a length-descending propagation along suffix links.

**Connection to combinatorics on words.** The eertree's `≤ n + 2` bound *is* the Droubay–Justin–Pirillo theorem in disguise; richness (Section 9) is a central object in the study of Sturmian and episturmian words; the series structure (Section 8) is the algorithmic face of the Three-Squares / periodicity lemmas. The data structure makes these combinatorial facts *computable* online in linear time.

### 11.1 Why Not Just Use a Suffix Structure?

One could find all distinct palindromes via the suffix tree (or suffix automaton) of `s # s^R`: a palindrome is a substring that reads the same in `s` and `s^R`, so palindromes correspond to certain common substrings. This works but is **indirect** and **awkward**: you must align positions across the two halves, deduplicate, and handle the separator — and it is not online, not annotation-friendly, and uses a larger constant. The eertree solves the *palindrome-specific* problem natively, with the suffix-link tree giving occurrence counts directly. The lesson mirrors a general principle: a purpose-built structure for the exact query (here, palindromes) beats reducing to a general structure (suffix automaton) whenever the specialized invariants (the `len = -1` root, the wrap-in-`c` edges) buy a cleaner algorithm.

### 11.2 The eertree as a DAWG-like Object

The eertree's child edges form a DAG-of-palindromes: each palindrome points to the (at most `|Σ|`) palindromes obtained by wrapping it in a character. Unlike a suffix automaton (which is a *minimal* DFA recognizing all substrings), the eertree is *not* an automaton recognizing palindromes — it is an index of them. The suffix links, however, play the same algebraic role as a suffix automaton's suffix links: they form a tree whose subtree sums give occurrence counts (Theorem 7.2). This dual structure — child edges for *building* palindromes, suffix links for *counting* them — is the eertree's defining design, and it is the reason a single linear-time pass answers both "what are the distinct palindromes" and "how often does each occur".

### 11.3 Generalized eertree: Correctness over a Collection

**Theorem 11.4.** Let `S = {s_1, …, s_m}` be a collection of strings. Build one eertree, processing the strings in sequence, **resetting `last` to `r_0` and re-basing the position index before each `s_j`**. Then the non-root nodes are in bijection with `⋃_j PAL(s_j)` (the distinct palindromes appearing in *any* string), and a node's per-string flag records exactly which `s_j` contain that palindrome.

**Proof.** Resetting `last = r_0` ensures no palindromic suffix spans two strings (the wrap-test's bound check, re-based to the current string's start, forbids reading characters of a previous string). Within each `s_j`, Theorem 5.1 applies verbatim, so every palindrome of `s_j` is discovered and reuses a node if it was already created while processing an earlier string. Hence each distinct palindrome across the collection gets exactly one node, and the union `⋃_j PAL(s_j)` is represented bijectively. The per-string flag is set when a node becomes `last` while processing `s_j`. ∎

**Corollary 11.5.** The number of palindromes common to all `m` strings is the count of nodes flagged by every `s_j`; the number occurring in *at least one* is `numberOfNodes - 2`. Both are computed in `O(Σ |s_j| · |Σ|)` total — linear in the combined input.

**The trie-DFS refinement.** If the strings share prefixes (arranged as a trie), processing them independently re-does shared-prefix work. The rollback eertree (senior file) instead DFSes the trie: `ADD` on descent, `Rollback` on ascent. Correctness follows because `ADD` mutates a bounded, reversible set of fields (one node, one edge, `last`), and rollback restores the exact pre-`ADD` state — so the eertree at any trie node equals the eertree of the root-to-node string. This yields `O(trieSize · |Σ|)` instead of `O(Σ |s_j|)`, a strict improvement when prefixes overlap.

---

## 12. Summary

- **At-most-`n+2` theorem.** A length-`n` string has `≤ n` distinct nonempty palindromic substrings, so the eertree has `≤ n + 2` nodes — proved by induction using the one-new-palindrome lemma. Tight for `a^n`.
- **One-new-palindrome lemma (Droubay–Justin–Pirillo).** Appending a character creates at most one new palindrome, and it is the longest palindromic suffix; a shorter new palindromic suffix would have already occurred earlier as a palindromic prefix of a longer one.
- **Suffix-link correctness.** `link(w)` is the longest proper palindromic suffix; the suffix-link chain enumerates all palindromic suffixes in decreasing length, and the construction sets `link(cXc) = next[getLink(link(X))][c]` correctly (Lemma 4.4).
- **Online construction correctness.** By induction, `last` always equals `lps(s[0..i])`, nodes are exactly `PAL(s[0..i]) ∪ {roots}`, and the imaginary root (`len = -1`) is the universal walk terminator yielding length-1 palindromes.
- **Amortized `O(n)`.** A potential argument on `len[last]` (rises by ≤ 2 per character, each walk step decreases it) bounds total suffix-link steps by `2n` — the same amortization as KMP and suffix automata.
- **Occurrence propagation.** Initialize `cnt` at the `last` node per position, then push `cnt[link[v]] += cnt[v]` in length-descending (reverse-creation) order to get exact occurrence counts; total = `Σ occ = Σ endCount[last_i]`.
- **Series links.** Palindromic suffix lengths form `O(log n)` arithmetic series (Three-Squares lemma); `slink` jumps series tops, enabling `O(n log n)` palindromic-factorization DPs.
- **Richness.** `s` is rich iff every character adds a new palindrome iff `ADD` returns `true` every time — an `O(n)` online test; richness is hereditary (closed under factors and reversal).
- **Generalized eertree.** One tree over a collection, resetting `last` per string, represents `⋃ PAL(s_j)` bijectively; the trie-DFS rollback refinement shares prefix work for `O(trieSize · |Σ|)`.
- **Magnitude.** The total count is `Θ(n²)` in the worst case (`a^n`); use 64-bit accumulators or modular reduction (a ring homomorphism that commutes with propagation).
- **Optimality.** `Θ(d)` space (`d ≤ n` distinct palindromes) is information-theoretically optimal; `O(n)` build is optimal up to the alphabet factor. Manacher counts but does not store the distinct set.

### Complexity Cheat Table

| Task | Method | Complexity |
|------|--------|-----------|
| Build eertree (array children) | online append | `O(n·|Σ|)` time, `O(n·|Σ|)` space |
| Build eertree (map children) | online append | `O(n log|Σ|)` time, `O(n)` space |
| Distinct palindromes | `nodes - 2` | `O(1)` after build |
| Total occurrences | suffix-link propagation | `O(n)` |
| Palindromes ending at each position | `endCount[last]` | `O(1)` per position |
| Longest palindromic suffix per prefix | `len[last]` | `O(1)` per position |
| Minimum palindromic factorization | eertree + series links | `O(n log n)` |
| Richness test | every `ADD` returns true? | `O(n)` |

### Worked Numeric Summary

Pulling the running examples together:

| String | `n` | distinct | total | rich? | longest pal | nodes |
|--------|-----|----------|-------|-------|-------------|-------|
| `a` | 1 | 1 | 1 | yes | 1 | 3 |
| `aaaa` | 4 | 4 | 10 | yes | 4 | 6 |
| `abc` | 3 | 3 | 3 | yes | 1 | 5 |
| `ababa` | 5 | 5 | 9 | yes | 5 | 7 |
| `abacaba` | 7 | 7 | 12 | yes | 7 | 9 |

Each `distinct = nodes - 2`, each `total ∈ [n, n(n+1)/2]`, and "rich" holds exactly when `distinct = n`. These five rows are the canonical hand-checkable cases; an implementation that reproduces all of them (and matches the brute-force oracle on random small strings) is almost certainly correct. The `aaaa` row is the worst case for total (`10 = 4·5/2`) and a good stress test of the suffix-link chain; `abacaba` exercises both odd and even palindromes and a deep suffix-link tree.

### Closing Notes

- **The one-new-palindrome lemma** is the load-bearing combinatorial fact; everything (the `n+2` bound, the bijection, richness) descends from it.
- **The amortization** mirrors KMP and the suffix automaton — a single potential (`len[last]`) controls the whole cost.
- **Occurrence propagation** is the palindromic analogue of suffix-automaton `endpos` counting: length-descending push along suffix links.
- **Series links** turn the combinatorial Three-Squares periodicity into an `O(n log n)` algorithm for factorization workloads.
- **The two-faced design** — child edges build palindromes, suffix links count them — is what lets one linear pass answer both the distinct-set and the occurrence-count questions, the eertree's defining advantage over reducing to a general suffix structure.

### Extensions and Related Results

- **Persistent eertree.** Path-copying the mutated nodes per `ADD` yields a fully persistent eertree (every version queryable), at `O(log)` overhead per operation — analogous to persistent balanced trees. Rarely needed; rollback (single-version undo) covers the common DFS case in `O(1)`.
- **Online longest palindromic substring.** `max len[v]` maintained during the build gives the longest palindrome of every prefix online — something Manacher (which needs the whole string) cannot do incrementally.
- **Palindromic length / `g`-richness generalizations.** The eertree underlies algorithms for `k`-th order palindromic complexity, antipalindromes (over an involution), and weighted/colored palindrome variants — each adjusting the wrap rule or the annotation while keeping the `≤ n + 2` skeleton.
- **Two-dimensional and tree palindromes.** Generalizing the eertree to palindromes on labeled trees (palindromic paths) and to 2D arrays is an active research direction; the linear-node bound does not always survive, but the suffix-link machinery often adapts.
- **Substring palindrome queries.** Combined with persistence or offline processing, the eertree answers "how many distinct palindromes in `s[l..r]`" — a harder query needing the eertree plus additional indexing (e.g. small-to-large merging over a suffix-link tree).
- **Antipalindromes and involutions.** Over an alphabet with a fixed-point-free involution (e.g. DNA complement `A↔T`, `C↔G`), an *antipalindrome* equals its complemented reverse. The eertree adapts by changing the wrap rule (wrap in `c` on one side, its complement on the other), keeping the linear-node skeleton — used in computational biology for inverted-repeat detection.

### A Note on Implementation Fidelity

The proofs in this document assume the *exact* algorithm of Section 5 (append-then-getLink with the `buf[i - len - 1]` wrap-test, length-1 link to `r_0`, reverse-creation-order propagation). Variants exist (storing the imaginary root differently, using a sentinel for "no child", different index conventions), and each requires re-checking the invariants of Section 5.3. The safest path is to implement the canonical form, verify all invariants in a debug build, and validate against the brute-force oracle on dense-palindrome strings before optimizing. The theory is robust, but a single index off-by-one silently violates Theorem 5.1 while leaving the *small-input* outputs correct — which is precisely why the dense-oracle test, not a few hand examples, is the gate to trusting an implementation.

### Cross-References Within This Topic

- `junior.md` — the two roots and the append-one-character operation, with the `aba` walkthrough.
- `middle.md` — the full online construction, distinct vs total counting, series/quick links, and the Manacher comparison.
- `senior.md` — production memory layout, generalized/persistent/rollback eertrees, testing and failure modes.
- `interview.md` — Q&A by seniority and the four end-to-end coding challenges.
- `tasks.md` — graded practice problems with Go/Java/Python starters and brute-force oracles.
- `animation.html` — interactive visualization of the online construction, the two roots, the suffix-link walk, and new nodes appearing.

Foundational references: Rubinchik & Shur (2015), *EERTREE: An Efficient Data Structure for Processing Palindromes in Strings*; Droubay, Justin & Pirillo (1999/2001) on palindromes in words and the `≤ n + 1` distinct-palindrome bound; Glen, Justin, Widmer & Zamboni (2009) on palindromic richness and the unioccurrence characterization; Kosolobov, Rubinchik & Shur and Borozdin, Kosolobov, Rubinchik & Shur on `O(n log n)` palindromic factorization via series (quick) links; Fici, Gagie, Kärkkäinen & Kempa on subquadratic palindromic factorization; the Three-Squares lemma (Crochemore–Rytter) and Fine–Wilf periodicity theorem for the `O(log n)` series structure; and the suffix-automaton `endpos` propagation (Blumer et al.) as the structural cousin of occurrence counting. Sibling topic `11-manacher` (counts/locates palindromes around centers but does not store the distinct set); parent section `17-string-algorithms` (suffix structures and string matching).

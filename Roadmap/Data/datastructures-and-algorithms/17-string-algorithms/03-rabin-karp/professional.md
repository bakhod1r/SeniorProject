# Rabin-Karp — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Polynomial Hash and Horner Evaluation
3. The Rolling-Update Derivation
4. Prefix Hashes and Substring Hashing
5. Collision Probability: The Polynomial-Root Bound
6. Expected-Time Analysis
7. Why Verification Preserves Correctness
8. Double Hashing and the Birthday Bound
9. Worst-Case Analysis and Lower-Bound Intuition
10. Choosing Primes and Bases
11. Rabin Fingerprints over GF(2)
12. Variance of the Spurious-Hit Count
13. The 2D Hash as a Bivariate Polynomial
14. Multi-Pattern Set Membership: Analysis
15. Numerical Worked Examples
16. Connections to Karp-Rabin Fingerprint Trees and the Transfer to Suffix Structures
17. Algebraic Structure: Homomorphism and Concatenation
18. The Mersenne-Prime Reduction, Proved
19. Error-Probability Amplification and the Union Bound
20. Deterministic Verification vs Monte-Carlo Acceptance
21. Expected Number of Hashes in Binary-Search Applications
22. Lower Bounds and the Role of Randomness
23. Comparison Table of Hash-Family Properties
23.5. Worked Derivation: From Naive to Linear
24. Summary

---

## 1. Formal Definitions

Let `Σ` be a finite alphabet and let each symbol map to an integer code `c: Σ → {1, 2, …, |Σ|}` (codes start at 1 to avoid leading-zero degeneracy). A string `s = s[0] s[1] … s[m-1] ∈ Σ^m` has length `m = |s|`.

**Definition 1.1 (Text and pattern).** The **text** `T ∈ Σ^n` has length `n`; the **pattern** `P ∈ Σ^m` has length `m ≤ n`. A **match** is an index `i ∈ {0, …, n−m}` with `T[i+t] = P[t]` for all `0 ≤ t < m`.

**Definition 1.2 (Window).** The `i`-th **window** is the substring `T_i := T[i..i+m−1]` of length `m`. There are `n − m + 1` windows.

**Definition 1.3 (Polynomial hash).** Fix a base `b ∈ ℤ` and a prime modulus `p`. The hash of a string `s` of length `m` is

```
H_b,p(s) = ( Σ_{t=0}^{m-1} c(s[t]) · b^{m-1-t} ) mod p   ∈  Z_p.
```

The leftmost symbol carries the highest power `b^{m-1}`. Equivalently, `H` is the evaluation at `x = b` of the polynomial `P_s(x) = Σ_t c(s[t]) x^{m-1-t}` over the field `Z_p`.

**Definition 1.4 (Spurious hit / collision).** Two distinct strings `s ≠ s'` of equal length **collide** under `H_b,p` if `H_b,p(s) = H_b,p(s')`. A window `i` is a **spurious hit** if `H(T_i) = H(P)` but `T_i ≠ P`.

**Definition 1.5 (`ε`-universal family).** A family of hash functions `{H_b}_{b ∈ B}` is **`ε`-universal** on length-`m` strings if for every `s ≠ s'`, `Pr_{b}[H_b(s) = H_b(s')] ≤ ε` over a uniformly random `b ∈ B`. Section 5 proves the polynomial family is `(m−1)/p`-universal — the formal property underlying every correctness and time bound that follows. Universality is strictly weaker than cryptographic collision resistance: it controls collisions for a *random, secret* base, not for an adversary who sees the function.

**Notation.** Throughout, `n = |T|`, `m = |P|`, `p` is a prime, `b` the base, `Z_p` the field of residues mod `p`, and we treat `H` as a function into `Z_p`. The Iverson bracket `[Q]` is `1` if predicate `Q` holds, else `0`. "Match" means a true string equality; "hit" means a hash equality (possibly spurious). We write `occ` for the number of true occurrences and `spurious` for the number of spurious hits encountered during a scan.

---

## 2. The Polynomial Hash and Horner Evaluation

**Motivation for the polynomial form.** Of all hash functions on strings, why a polynomial evaluated at a base? Three properties make it uniquely suited:

1. **Locality of update.** Appending or removing a boundary character changes the hash by a single algebraic operation (Proposition 17.1), enabling the `O(1)` roll. Most hash functions (e.g. cryptographic ones) have no such incremental structure.
2. **Provable universality.** Because evaluation is a polynomial in the base, the difference of two hashes is a polynomial whose roots are countable in a field — yielding the clean `(m−1)/p` collision bound (Theorem 5.1). General hash functions offer no comparable closed-form bound.
3. **Composability.** The concatenation law lets prefix sums answer arbitrary substring queries in `O(1)` (Theorem 4.1), and lets the construction lift to two dimensions (Section 13). These all follow from polynomial algebra.

No other simple hash family has all three. This is why Rabin-Karp, suffix-array-by-hashing, and content-defined chunking all converge on the polynomial (or `GF(2)` polynomial) form.

Directly summing `Σ_t c(s[t]) b^{m-1-t}` requires the powers `b^{m-1}, …, b^0`. **Horner's method** evaluates the polynomial without precomputing powers:

```
h ← 0
for t = 0 .. m-1:
    h ← (h · b + c(s[t])) mod p
return h
```

**Lemma 2.1 (Horner correctness).** After processing `s[0..t]`, `h = Σ_{j=0}^{t} c(s[j]) b^{t-j} mod p`.

*Proof.* Induction on `t`. Base `t = 0`: `h = c(s[0])`. Step: assume `h_t = Σ_{j≤t} c(s[j]) b^{t-j}`. Then `h_{t+1} = h_t·b + c(s[t+1]) = Σ_{j≤t} c(s[j]) b^{t+1-j} + c(s[t+1]) b^0 = Σ_{j≤t+1} c(s[j]) b^{t+1-j}`. ∎

At `t = m−1` this is exactly Definition 1.3. Horner costs `m` modular multiply-adds, so `H` is computed in `O(m)`.

---

**Cost of Horner versus naive power summation.** Naively computing `Σ_t c(s[t]) b^{m-1-t}` by forming each `b^{m-1-t}` separately costs `O(m)` multiplications *plus* `O(m)` power computations (or `O(m log m)` with repeated squaring per term). Horner folds the powers into the accumulation, achieving `m` multiply-adds total with no separate power array. When a power array *is* needed (for substring queries, Theorem 4.1), it is built once in `O(n)` and amortized across all queries. The distinction matters in practice: building per-window power arrays inside a loop is a common accidental `O(nm)` regression.

---

## 3. The Rolling-Update Derivation

Let `H_i := H_b,p(T_i)` be the hash of window `i`. We derive `H_{i+1}` from `H_i` in `O(1)`.

By Definition 1.3,

```
H_i     = ( Σ_{t=0}^{m-1} c(T[i+t]) · b^{m-1-t} ) mod p,
H_{i+1} = ( Σ_{t=0}^{m-1} c(T[i+1+t]) · b^{m-1-t} ) mod p.
```

Reindex `H_{i+1}` with `u = t+1`: `H_{i+1} = Σ_{u=1}^{m} c(T[i+u]) b^{m-u}`. Now relate to `H_i`. Multiply `H_i` by `b`:

```
b · H_i = Σ_{t=0}^{m-1} c(T[i+t]) b^{m-t}
        = c(T[i]) · b^m + Σ_{t=1}^{m-1} c(T[i+t]) b^{m-t}.
```

The tail sum `Σ_{t=1}^{m-1} c(T[i+t]) b^{m-t}` equals `H_{i+1}` minus its last term `c(T[i+m]) b^0`. Therefore

```
b · H_i = c(T[i]) · b^m + ( H_{i+1} − c(T[i+m]) ).
```

Solving for `H_{i+1}`:

> **Theorem 3.1 (Rolling update).**
> ```
> H_{i+1} = ( ( H_i − c(T[i]) · b^{m-1} ) · b + c(T[i+m]) ) mod p.
> ```

*Proof.* From `b·H_i = c(T[i])·b^m + H_{i+1} − c(T[i+m])`, isolate `H_{i+1} = b·H_i − c(T[i])·b^m + c(T[i+m]) = (H_i − c(T[i])·b^{m-1})·b + c(T[i+m])`. All equalities hold in `Z_p`. ∎

The constant `b^{m-1} mod p` is precomputed once in `O(m)` (or `O(log m)` by fast exponentiation). The update is two multiplications, one subtraction, one addition, and one reduction — `O(1)`, independent of `m`. Sliding across all windows is `O(n)`.

**Sign care.** In `Z` the subtraction `H_i − c(T[i])·b^{m-1}` may be negative; reduce as `((H_i − c(T[i])·b^{m-1} mod p) + p) mod p` so the residue stays in `[0, p)`.

---

**Alternative roll convention (lowest-power-first).** Some implementations put the *lowest* power on the leftmost character: `H'(s) = Σ_t c(s[t]) b^{t}`. Then the rolling update divides out the entering scheme differently:

```
H'_{i+1} = ( (H'_i − c(T[i])) / b + c(T[i+m]) · b^{m-1} ) mod p,
```

where `/b` is multiplication by the modular inverse `b^{-1} mod p` (which exists because `p` is prime and `b ≠ 0`). This convention avoids precomputing `b^{m-1}` for the *removed* character but requires a modular inverse and a multiplication by `b^{m-1}` for the *added* character. The high-power-first convention of Theorem 3.1 is preferred because it needs no modular inverse — one fewer place for bugs and one fewer expensive operation. Both compute the same hash up to a fixed reindexing and are equally valid; mixing the two within one codebase is a classic source of mismatched hashes.

---

## 4. Prefix Hashes and Substring Hashing

Define prefix hashes `pre[0] = 0` and `pre[k] = (pre[k−1]·b + c(T[k−1])) mod p` for `k = 1..n`. Then `pre[k] = Σ_{j=0}^{k-1} c(T[j]) b^{k-1-j}`.

**Theorem 4.1 (Substring hash).** For `0 ≤ l ≤ r < n`, the hash of `T[l..r]` (length `L = r−l+1`) is

```
H(T[l..r]) = ( pre[r+1] − pre[l] · b^{L} ) mod p.
```

*Proof.* `pre[r+1] = Σ_{j=0}^{r} c(T[j]) b^{r-j}` and `pre[l] = Σ_{j=0}^{l-1} c(T[j]) b^{l-1-j}`. Multiply the latter by `b^{L} = b^{r-l+1}`: `pre[l]·b^{L} = Σ_{j=0}^{l-1} c(T[j]) b^{r-j}`. Subtracting cancels all terms with `j < l`, leaving `Σ_{j=l}^{r} c(T[j]) b^{r-j} = H(T[l..r])`. ∎

This yields `O(1)` hashing of *any* substring after `O(n)` preprocessing — the basis for counting distinct substrings and binary-searching the longest duplicate substring (see `interview.md`).

**Corollary 4.2 (Comparing two substrings).** Two substrings of equal length `L`, at offsets `l` and `l'`, are equal with high probability iff `H(T[l..l+L−1]) = H(T[l'..l'+L−1])`, each computed in `O(1)` by Theorem 4.1. This reduces substring equality to a single integer comparison — the operation that, chained with binary search, gives `O(log n)` longest-common-extension queries.

**Numerical stability of the power table.** The substring formula needs `b^{L} mod p` for arbitrary `L`. Precompute the power table `pow[0..n]` with `pow[0] = 1`, `pow[k] = pow[k−1]·b mod p` in `O(n)`; this avoids per-query `O(log L)` exponentiation and keeps the whole structure `O(1)` per query. Storing `pow` alongside `pre` doubles the memory but is the standard space-time trade for substring-hash data structures.

---

## 5. Collision Probability: The Polynomial-Root Bound

The central correctness question: how often do two distinct equal-length strings collide?

**Why a field is required.** The argument below counts roots of a nonzero polynomial. A degree-`d` polynomial over a *field* has at most `d` roots — this is false over a general ring. Over `Z_{2^{64}}` (a ring, not a field), `x² − 1` has *four* roots (`1, −1, 2^{31}±1`-type elements), and an attacker can exploit such zero-divisor structure to manufacture collisions. Using a prime modulus makes `Z_p` a field, where the root-counting bound — and hence the whole collision analysis — is valid. This is the deep reason behind the "use a prime, never `2^{64}`" rule of Section 10.

**Theorem 5.1 (Collision bound for a random base).** Fix two distinct strings `s ≠ s'` of length `m` over `Σ`. Choose the base `b` uniformly at random from `{0, 1, …, p−1}`. Then

```
Pr_b[ H_b,p(s) = H_b,p(s') ] ≤ (m−1) / p.
```

*Proof.* Define the difference polynomial `D(x) = P_s(x) − P_{s'}(x) = Σ_{t=0}^{m-1} (c(s[t]) − c(s'[t])) x^{m-1-t}` over `Z_p`. Because `s ≠ s'` and codes are reduced mod `p` (assume `|Σ| < p`, so distinct symbols stay distinct), at least one coefficient is nonzero, so `D` is a nonzero polynomial of degree at most `m−1`. A collision means `H(s) = H(s')`, i.e. `D(b) ≡ 0 (mod p)`, i.e. `b` is a root of `D`. A nonzero degree-`d` polynomial over a field has at most `d` roots (this is the one-variable Schwartz-Zippel lemma / fundamental theorem of algebra over `Z_p`). Hence at most `m−1` of the `p` choices of `b` cause a collision, giving probability `≤ (m−1)/p`. ∎

**Restatement as universality.** Theorem 5.1 says precisely that the polynomial hash family `{H_b}` is `(m−1)/p`-universal (Definition 1.5). Universality is the exact abstraction the analysis needs: every subsequent bound (expected time, double-hash amplification, binary-search error) follows mechanically from "the family is `ε`-universal with `ε = (m−1)/p`," without re-opening the polynomial-root argument. This is why the polynomial hash, despite being non-cryptographic, suffices: matching needs *universality*, not collision resistance.

**Corollary 5.2.** With `p ≈ 10^9` and `m ≤ 10^6`, the per-pair collision probability is `≤ 10^{-3}` in the worst pair — but for a *fixed random base* and a text scan, the expected *number* of spurious hits is bounded as in Section 6. Crucially, the bound depends on `b` being random and **secret** from any adversary; for a fixed public `b`, an adversary can choose `s, s'` that are roots of `D`, forcing collisions (Section 9).

---

## 6. Expected-Time Analysis

**Discussion (why the random-base model is the right one).** Theorem 5.1 fixes the *strings* and randomizes the *base*. This is the model that matches practice: an adversary (or nature) supplies the text and pattern, and the algorithm draws a secret random base afterward. Under this model the bound `(m−1)/p` holds for *every* fixed input — there is no input the adversary can choose in advance to defeat a base they cannot predict. The alternative model — fixing the base and randomizing the input — is rarely realistic and is exactly the model in which the worst case (Section 9) bites. Throughout this section "random" means "random base, worst-case input."

**Theorem 6.1 (Expected running time).** With base `b` chosen uniformly at random from `Z_p` (independent of the input), Rabin-Karp with verification runs in expected time

```
O(n + m + (occ + spurious)·m),   E[spurious] ≤ (n − m + 1)·(m−1)/p,
```

where `occ` is the number of true occurrences.

*Proof sketch.* Preprocessing (hash `P` and `T_0`, compute `b^{m-1}`) is `O(m)`. The roll across `n−m` windows is `O(n)`. Each window costs `O(1)` for the hash compare; verification (`O(m)`) fires only on a hit. A hit is either a true occurrence (`occ` of them) or spurious. For each non-matching window, by Theorem 5.1 the probability it is a spurious hit is `≤ (m−1)/p`, so by linearity of expectation `E[spurious] ≤ (n−m+1)(m−1)/p`. Each hit costs `O(m)` to verify. Summing: `O(n + m) + O((occ + E[spurious])·m)`. ∎

**Corollary 6.2.** If we only need to *detect* existence or *count* occurrences and `occ` is small, and `p ≫ n·m`, then `E[spurious]·m = O(nm·m/p) = o(n)` and the algorithm is expected `O(n + m)`. Concretely with `p ≈ 10^9`, `n, m ≤ 10^6`: `E[spurious] ≤ 10^6·10^6/10^9 = 10^3` hits, total verification `≤ 10^9` — borderline, which is exactly why a 61-bit modulus or double hashing is preferred at scale.

---

**Corollary 6.3 (Amortized cost per character).** Dividing the expected total by `n`, the amortized work per text character is `O(1) + O(m·(m−1)/p)`. For `p ≥ m²` the second term is `O(1)`, so each character costs constant amortized time — the formal sense in which Rabin-Karp is "linear." This also tells us the practical modulus floor: choose `p ≳ m²` (well satisfied by `p ≈ 10^9` for `m ≤ 3·10^4`, and by `2^{61}−1` for any realistic `m`) to keep verification from contributing to the asymptotic cost.

---

## 7. Why Verification Preserves Correctness

The hash is a *necessary* condition for equality, not sufficient:

> **Proposition 7.1.** For all strings `s, s'` of equal length: `s = s' ⟹ H(s) = H(s')`. The converse fails.

*Proof.* `H` is a deterministic function of the string, so equal inputs give equal outputs (forward direction). The converse fails by any collision (Definition 1.4), which exists whenever `|Σ|^m > p` by pigeonhole. ∎

**Theorem 7.2 (Verification ⇒ exact correctness).** Rabin-Karp that compares characters on every hash hit reports exactly the set of true matches, with zero false positives and zero false negatives, *regardless of collisions*.

*Proof.* No false negatives: if `i` is a true match then `T_i = P`, so by Proposition 7.1 `H(T_i) = H(P)`, the window is a hit, verification compares `T_i` to `P`, finds equality, and reports `i`. No false positives: `i` is reported only if it is a hit *and* verification confirms `T_i = P` character by character, which is exactly the definition of a match. Collisions merely add work (spurious hits) but never change the reported set, because verification rejects every `T_i ≠ P`. ∎

This is the key structural fact: **hashing affects only the running time, never the output.** Correctness is owned entirely by the deterministic verification step.

---

## 8. Double Hashing and the Birthday Bound

Using two independent hashes `H_1 = H_{b1,p1}`, `H_2 = H_{b2,p2}` and declaring equality iff both agree:

**Theorem 8.1 (Joint collision bound).** If `b1, b2` are chosen independently and uniformly, then for fixed `s ≠ s'`,

```
Pr[ H_1(s)=H_1(s') AND H_2(s)=H_2(s') ] ≤ (m−1)/p1 · (m−1)/p2.
```

*Proof.* The two events are independent because `b1, b2` are independent; multiply the bounds of Theorem 5.1. ∎

With `p1, p2 ≈ 10^9`, the joint per-pair bound is `~10^{-18}m^2`. The **birthday-bound** caveat: across many comparisons (say `Q` distinct strings hashed into one table), the probability that *some* pair collides grows like `Q^2/(2·p1·p2)`. A single 30-bit hash with `Q ≈ 10^5` already has collision probability `~Q^2/(2p) ≈ 5·10^{-1}` — likely! Two hashes push the effective modulus to `p1·p2 ≈ 10^{18}`, making `Q^2/(2·10^{18})` negligible for any realistic `Q`. This is why double hashing (or one 61-bit hash) is the right default when *many* strings are compared, not just one pattern.

---

**Corollary 8.2 (Independent-hash factorization).** If the `r` hashes use bases drawn independently and uniformly, the events "hash `j` collides" are mutually independent for a fixed pair `s ≠ s'`, so the joint collision probability factorizes as `∏_{j=1}^{r} (m−1)/p_j`. With `r` distinct ~`10^9` primes this is `~10^{-9r}`. Independence is essential and is *lost* if two hashes share a base or modulus — then the events are correlated and the product bound is invalid (a practical bug: copy-pasting one hash and changing only the modulus while reusing the base leaves the bases identical, breaking independence).

---

## 9. Worst-Case Analysis and Lower-Bound Intuition

**Worst case `O(n·m)` for Monte-Carlo error.** Separately from running time, the *no-verification* variant has a worst-case *error*: against a fixed base, an adversary can force a false positive deterministically by choosing a colliding string. Verification eliminates this; randomization makes it improbable. The two worst cases (time for Las Vegas, error for Monte-Carlo) are duals of the same fixed-base vulnerability.

**Worst case `O(n·m)`.** If every window is a spurious hit, verification runs `n−m+1` times at `O(m)` each. This is achievable against a *fixed, known* `(b, p)`:

**Construction 9.1 (Adversarial input).** Given public `b, p`, choose pattern `P` and text `T` so that every window `T_i` satisfies `D_i(b) ≡ 0`, where `D_i = P_{T_i} − P_P`. Concretely, over a fixed hash the strings `"aaaa…"` against pattern `"aaab"` produce many near-collisions, and a determined adversary solving `D_i(b) = 0` over `Z_p` can force a collision at every position. The result is `Θ(nm)` total work.

**Why randomization defeats it.** Theorem 5.1 bounds collisions only when `b` is random *and unknown to the adversary*. If the adversary picks the input *before* `b` is sampled, the expected spurious count is `≤ (n−m+1)(m−1)/p`, restoring expected `O(n+m)`. Thus the worst case is a property of *deterministic* Rabin-Karp; the randomized version is expected-linear against any fixed input. This mirrors randomized quicksort: adversarial worst cases vanish under a private random choice.

**Lower-bound intuition.** Exact string matching has a deterministic `Ω(n)` lower bound (every text character must be examined in the worst case), met by KMP, Z, and Rabin-Karp's expected time. Rabin-Karp does not improve the asymptotic floor; its value is constant factors, simplicity, and the *generality* of the rolling hash (multi-pattern, 2D, substring comparison) — not a complexity advantage over KMP.

**Expected worst case is `Θ(n)`, not just `O(n)`.** A subtle point: the *expected* running time of randomized Rabin-Karp is `Θ(n + m)` on *every* input, including the adversarial ones that break the deterministic version. The adversary fixes the input, then the algorithm draws the base; the expectation `E[spurious] ≤ (n−m+1)(m−1)/p` is taken over the base and holds regardless of the input. So there is no input distribution under which the randomized algorithm is super-linear in expectation — the `O(nm)` figure describes a single unlucky base draw, an event of probability bounded by Markov's inequality (`Pr[time ≥ c·E[time]] ≤ 1/c`), not a typical outcome.

**Tightness of the bound.** Theorem 5.1's `(m−1)/p` is tight: take `s = x^{m}` and `s'` differing in one position, so `D(x)` has degree exactly `m−1` and exactly `m−1` distinct roots in `Z_p` (when it splits), each a base that collides. Thus no analysis can prove a better than `(m−1)/p` bound for the worst pair — the prime modulus must be large enough that `(m−1)/p` is acceptable, which is the quantitative content of "choose `p ≳ m²`."

---

## 10. Choosing Primes and Bases

**Modulus `p`.** Requirements: (i) prime, so `Z_p` is a field and Theorem 5.1 applies; (ii) large, so `(m−1)/p` is tiny; (iii) arithmetic-friendly. A 30-bit prime (`10^9+7`, `10^9+9`, `998244353`) keeps products `h·b < p^2 < 2^{60}`, safe in signed 64-bit. The Mersenne prime `2^{61}−1` maximizes range with a fast fold (`x mod p = (x & p) + (x >> 61)`), at the cost of needing 128-bit multiplication.

**Base `b`.** Requirements: (i) `b > |Σ|` so distinct symbols are distinct digits; (ii) `gcd(b, p) = 1` (automatic since `p` prime and `b < p`, `b ≠ 0`); (iii) for adversarial safety, `b` uniform random in `[ |Σ|+1, p−1 ]`, kept private. Avoid `b` with small multiplicative order mod `p`, which would make `b^{m-1}` cycle and weaken the spread; a random `b` is almost surely fine.

**Code offset.** Map symbols to `{1, …, |Σ|}`, never including `0`, so that `H("a") ≠ H("aa")` and leading symbols cannot be absorbed by the modulus into a shorter string's hash.

**Avoiding `2^64` "implicit modulus".** Letting unsigned 64-bit overflow act as `mod 2^64` (no explicit prime) is fast but **insecure**: Thorup's anti-hashing construction breaks any fixed multiplicative hash mod a power of two, producing `Θ(nm)` deterministically. Use a prime modulus, randomized.

---

## 11. Rabin Fingerprints over GF(2)

The original Rabin fingerprint replaces integer arithmetic mod a prime with polynomial arithmetic over the field `GF(2)`. A bit string `s = s_0 s_1 … s_{m-1}` is the polynomial `S(x) = Σ s_t x^{m-1-t} ∈ GF(2)[x]`, and the fingerprint is `S(x) mod Q(x)` for a fixed **irreducible** polynomial `Q` of degree `k`. Addition is XOR; multiplication by `x` is a shift with a conditional XOR of `Q` when the top bit overflows — no carries, ideal for hardware.

**Collision bound (Rabin 1981).** For a random irreducible `Q` of degree `k`, two distinct strings of length up to `N` bits collide with probability `≤ N/2^{k}` (the difference polynomial, of degree `< N`, has at most `N/k` irreducible factors of degree `k`). This is the `GF(2)` analogue of Theorem 5.1. The rolling property holds identically: dropping the leading bit and appending a trailing bit updates the fingerprint in `O(1)`. This polynomial-over-a-field structure is exactly what makes both the integer and `GF(2)` variants slidable and analyzable.

---

## 12. Variance of the Spurious-Hit Count

Theorem 6.1 bounds the *expected* number of spurious hits, but the running time depends on the actual count, so the *variance* matters for tail guarantees. A bound on the mean alone does not preclude a heavy tail; we need the second moment to argue that the running time concentrates.

**Setup.** Let `X_i` be the indicator that window `i` is a spurious hit (a hit but `T_i ≠ P`). The number of spurious hits is `X = Σ_i X_i`. Under a uniformly random base `b`, by Theorem 5.1 each `Pr[X_i = 1] ≤ q` with `q = (m−1)/p`.

**Mean.** `E[X] = Σ_i E[X_i] ≤ (n−m+1)·q` by linearity (no independence needed).

**Variance bound.** The `X_i` are *not* independent — overlapping windows share characters, so their difference polynomials share coefficients. A clean unconditional bound uses the second moment:

```
Var(X) = Σ_i Var(X_i) + Σ_{i≠j} Cov(X_i, X_j).
```

Each `Var(X_i) = Pr[X_i] (1 − Pr[X_i]) ≤ q`. For the covariances, `Cov(X_i, X_j) ≤ Pr[X_i = 1 ∧ X_j = 1]`. When windows `i` and `j` are far enough apart that their difference polynomials are "independent enough" (distinct supported coefficient sets after the random base is fixed), `Pr[X_i ∧ X_j] ≈ q^2` and the covariance is `≈ 0`. The worst contributions come from windows over **periodic** regions of the text, where many `T_i` are equal and their indicators are perfectly correlated.

**Consequence (Chebyshev).** When covariances are negligible, `Var(X) ≤ (n−m+1) q`, so by Chebyshev's inequality `Pr[X ≥ 2E[X] + t] ≤ Var(X)/t^2`. For `p ≈ 10^9` and `n, m ≤ 10^6`, `E[X] ≤ 10^3` and the probability of more than, say, `10^4` spurious hits is below `10^{-2}` — the verification cost concentrates tightly around its small mean. This is why, in practice, the *observed* running time of randomized Rabin-Karp is reliably `O(n + m)`, not merely in expectation but with high probability, away from adversarial periodic inputs.

**Periodicity caveat.** If `T = w^t` is a `t`-fold repetition of a short word `w`, every window over the repeated region is identical, so the indicators are fully dependent and `Var(X)` can reach `Θ((n−m)^2 q)`. The mean is still small, but the variance is large; this is the analytic shadow of the worst case and another argument for verification plus a strong (61-bit or double) hash on structured text.

---

## 13. The 2D Hash as a Bivariate Polynomial

The 2D Rabin-Karp of `middle.md` and `interview.md` has a clean algebraic description. Identify an `r × c` grid `G` with the **bivariate polynomial**

```
G(x, y) = Σ_{a=0}^{r-1} Σ_{d=0}^{c-1} c(G[a][d]) · x^{r-1-a} · y^{c-1-d}.
```

The 2D hash is the evaluation `G(b_2, b_1) mod p`, where `b_1` is the *horizontal* (within-row) base and `b_2` is the *vertical* (across-rows) base. The two-pass algorithm computes this by Horner in `y` first (each row collapses to `R_a = Σ_d c(G[a][d]) b_1^{c-1-d}`, the row hash) and then Horner in `x` over the row hashes (`Σ_a R_a b_2^{r-1-a}`).

**Theorem 13.1 (2D collision bound).** Fix two distinct `r × c` grids. Choosing `b_1, b_2` independently and uniformly at random, the collision probability is at most `(rc − 1)/p` (loosely) — and more tightly `≤ (r−1)/p + (c−1)/p` by analyzing the two univariate evaluations in sequence.

*Proof idea.* If the grids differ, their bivariate difference `D(x,y)` is a nonzero polynomial of degree `≤ r−1` in `x` and `≤ c−1` in `y`. By the bivariate Schwartz-Zippel lemma, `Pr_{b_1,b_2}[D(b_2,b_1) = 0] ≤ (deg_x + deg_y)/p ≤ ((r−1)+(c−1))/p`. The two-pass evaluation is exactly substituting `y = b_1` then `x = b_2`, so its collision set is contained in the roots of `D`. ∎

The **rolling** structure also lifts: the horizontal roll updates `R_a` in `O(1)` as the column window slides, and the vertical roll updates the across-row Horner sum in `O(1)` as the row window slides — precisely because each pass is a one-dimensional polynomial hash with its own base. This is the formal reason the 2D matcher is `O(R·C)` rather than `O(R·C·r·c)`.

---

## 14. Multi-Pattern Set Membership: Analysis

For `k` patterns of common length `m`, the set-membership variant hashes each pattern and stores it in a hash table `S`, then queries each window hash. This is the formal counterpart of the practical multi-pattern matcher in `middle.md`, and its analysis shows precisely how the modulus must grow with `k`.

**Correctness.** A window `i` is reported for pattern `P_j` iff `H(T_i) = H(P_j)` (membership) *and* `T_i = P_j` (verification). By Theorem 7.2 applied per pattern, the reported set is exactly the true occurrences of each pattern.

**Expected work.** Building `S` is `O(k·m)`. The scan is `O(n)` rolls plus, at each window, an `O(1)` expected hash-table lookup. The number of *candidate* lookups that hit a bucket is `occ + spurious`, where now `E[spurious] ≤ (n−m+1)·k·(m−1)/p` (a union bound over the `k` patterns: each pattern contributes its own collision probability at each window). So total expected time is

```
O(k·m + n + (occ + n·k·m/p)·m).
```

For `k·m·n ≪ p` this is `O(n + k·m)`. The factor `k` inside the spurious bound is the price of comparing every window against `k` targets simultaneously; it is exactly why the modulus must scale with `k·n·m` (favoring a 61-bit prime or double hashing once `k` is large). Distinct-length patterns require either one table per length (multiplying the scan cost by the number of distinct lengths) or the Aho-Corasick automaton, whose `O(n + Σ|P_j| + occ)` is independent of collision probability and is the proper tool when lengths vary widely.

---

## 15. Numerical Worked Examples

These examples use small but realistic parameters so every step can be checked by hand, illustrating the theorems above concretely.

**Example 15.1 (full hash and roll over `Z_p`).** Let `b = 131`, `p = 1\,000\,000\,007`, codes `c('a') = 1, c('b') = 2, c('r') = 18`. Pattern `P = "abr"`:

```
H(P) = ((1·131 + 2)·131 + 18) mod p
     = (133·131 + 18) mod p
     = (17423 + 18) mod p
     = 17441.
```

First window of `T = "abra"` is `"abr"`, hash `17441` — equals `H(P)`, a hit; verify `"abr" = "abr"` → match at 0. Roll to `"bra"` with `highPow = b^2 mod p = 131^2 = 17161`:

```
h = ((17441 − c('a')·17161)·131 + c('a')) mod p     // leaving 'a'(=1), entering 'a'(=1)
  = ((17441 − 17161)·131 + 1) mod p
  = (280·131 + 1) mod p
  = (36680 + 1) mod p
  = 36681.
```

Direct check: `H("bra") = ((2·131 + 18)·131 + 1) = (280·131 + 1) = 36681`. The roll reproduces the from-scratch hash exactly, confirming Theorem 3.1.

**Example 15.2 (collision probability sanity).** With `m = 1000`, `p = 10^9 + 7`, the per-pair bound is `(m−1)/p ≈ 10^{-6}`. Over `n = 10^6` windows, `E[spurious] ≤ 10^6 · 10^{-6} = 1`. So we expect about one spurious verification across the whole scan — verification cost is `O(m)` once, i.e. negligible against the `O(n)` roll. Doubling to two such hashes drops `E[spurious]` to `~10^{-3}`.

**Example 15.3 (substring hash via prefix).** For `T = "abra"`, `b = 131`, `pre[0]=0`, `pre[1]=1`, `pre[2]=1·131+2=133`, `pre[3]=133·131+18=17441`, `pre[4]=17441·131+1=2284772`. Then `H(T[1..2]) = H("br") = (pre[3] − pre[1]·b^2) mod p = (17441 − 1·17161) = 280`. Direct: `H("br") = 2·131 + 18 = 280`. ✓ (Theorem 4.1.)

**Example 15.4 (double-hash collision intuition).** Suppose two distinct length-1000 strings collide under a single 30-bit hash with probability `~10^{-6}` (worst pair). Under a second independent 30-bit hash the joint probability is `~10^{-12}` (Theorem 8.1). To reach a `10^{-12}` rate with a *single* modulus would require `p ≈ 10^{12}`, exceeding 40 bits and pushing products past `2^{80}` — beyond a 64-bit word. Two 30-bit hashes thus achieve, in native 64-bit arithmetic, what a single hash could not without 128-bit multiplication. This is the concrete engineering reason double hashing is so popular in 64-bit-only environments.

---

## 16. Connections to Karp-Rabin Fingerprint Trees and the Transfer to Suffix Structures

The prefix-hash machinery (Section 4) turns the polynomial hash into a *static* data structure supporting `O(1)` substring-hash queries, which composes with binary search to solve problems that otherwise need suffix arrays or suffix automata:

- **Longest common extension (LCE).** Given two positions `i, j`, the length of the longest common substring starting there is found by binary searching the length `L` and comparing `H(T[i..i+L−1])` with `H(T[j..j+L−1])` in `O(1)` per probe, total `O(log n)` per LCE query after `O(n)` preprocessing. This is the hashing alternative to an `O(1)`-after-`O(n)` suffix-tree LCE via lowest common ancestors.
- **Suffix sorting by hashing.** Comparing two suffixes lexicographically reduces to (i) binary-searching their LCE with hashing, then (ii) comparing the first differing character — giving an `O(n log^2 n)` suffix array construction that needs no suffix-specific theory, only the rolling hash.
- **Distinct substrings, exactly.** Summing distinct counts per length using a hash set is `O(n^2)` expected; the suffix automaton computes the same quantity exactly in `O(n)`. The hashing route trades a log/linear factor and a tiny error probability for radically simpler code.

- **Pattern matching with wildcards / mismatches.** Allowing `k` mismatches reduces to: binary-search-style LCE jumps using hashing to skip equal runs, charging one comparison per mismatch — the "kangaroo method" — giving `O(nk)` matching with `O(n)`-prep hashing for LCE, where a naive scan would be `O(nm)`.
- **Tandem-repeat and periodicity detection.** A string has period `d` iff `T[0..n−d−1]` equals `T[d..n−1]`, an `O(1)` hash comparison after prefix precomputation; scanning candidate periods finds the smallest in `O(n)` expected.

The unifying theme: a polynomial hash with prefix precomputation is a *probabilistic substring-equality oracle*. Wherever an algorithm's only use of suffix structures is "are these two substrings equal / how far do they agree," the oracle can replace them, transferring the deterministic-but-intricate suffix machinery into a few lines of modular arithmetic with a controllable error probability (Sections 5, 8).

---

## 16.5 Complexity Recap Table

Consolidating the bounds proved above:

| Quantity | Bound | Source |
|----------|-------|--------|
| Hash one string (Horner) | `O(m)` | Lemma 2.1 |
| One rolling update | `O(1)` | Theorem 3.1 |
| Hash any substring (after `O(n)` prep) | `O(1)` | Theorem 4.1 |
| Per-pair collision (random base) | `≤ (m−1)/p` | Theorem 5.1 |
| Expected spurious hits in a scan | `≤ (n−m+1)(m−1)/p` | Theorem 6.1 |
| Expected total time | `O(n+m)` when `p ≳ m²` | Corollary 6.3 |
| Deterministic worst-case time | `O(nm)` | Section 9 |
| Double-hash per-pair collision | `≤ (m−1)²/(p₁p₂)` | Theorem 8.1 |
| Monte-Carlo whole-algorithm error | `≤ (n−m+1)((m−1)/p)^r` | Theorem 19.1 |
| 2D per-pair collision | `≤ ((r−1)+(c−1))/p` | Theorem 13.1 |
| `k`-pattern expected time | `O(n + k·m)` when `knm ≪ p` | Section 14 |
| Binary-search-on-length total | `O(n log n)` expected | Section 21 |

Every row is a corollary of two facts: the polynomial family is `(m−1)/p`-universal, and verification reduces error to zero. The entire theory is those two statements plus arithmetic.

---

## 17. Algebraic Structure: Homomorphism and Concatenation

The polynomial hash behaves predictably under concatenation, which is the source of both the prefix-hash formula and the rolling update.

**Proposition 17.1 (Concatenation law).** For strings `u` (length `a`) and `v` (length `b`),

```
H(u · v) = ( H(u) · b^{|v|} + H(v) ) mod p.
```

*Proof.* `H(u·v) = Σ_{t=0}^{a-1} c(u[t]) b^{(a+b)-1-t} + Σ_{t=0}^{b-1} c(v[t]) b^{b-1-t}`. The first sum is `b^{|v|} · Σ_t c(u[t]) b^{a-1-t} = b^{|v|}·H(u)`; the second is `H(v)`. ∎

This single law generates everything: setting `v` to a single character gives Horner's recurrence (`H(u·x) = H(u)·b + c(x)`); applying it to `T = T[0..l-1]·T[l..r]·T[r+1..]` and solving for the middle factor gives the prefix-hash substring formula (Theorem 4.1); and combining "drop the first character" (a left-inverse of the concatenation on the high side) with "append a character" gives the rolling update (Theorem 3.1).

**Remark (not a ring homomorphism).** `H` is *not* a homomorphism from the free monoid `Σ*` to `Z_p` under addition, because the multiplier `b^{|v|}` depends on the *length* of the right operand. It is a homomorphism only when lengths are tracked alongside the hash — i.e. the pair `(H(s), |s|)` forms a monoid under the rule `(h_1, l_1) · (h_2, l_2) = (h_1 b^{l_2} + h_2, l_1 + l_2)`. This length-augmented pair is what segment trees over hashes store, enabling `O(log n)` dynamic substring hashing under edits.

---

## 18. The Mersenne-Prime Reduction, Proved

Let `p = 2^61 − 1`. We justify the fast reduction `x mod p` used in `senior.md`. The goal is to compute `x mod p` for a 122-bit product `x` without a hardware division, which on modern CPUs is an order of magnitude slower than the shift-and-add fold below.

**Lemma 18.1.** For any nonnegative integer `x`, write `x = hi·2^{61} + lo` with `0 ≤ lo < 2^{61}`. Then `x ≡ hi + lo (mod p)`.

*Proof.* `2^{61} = p + 1 ≡ 1 (mod p)`. Hence `x = hi·2^{61} + lo ≡ hi·1 + lo = hi + lo (mod p)`. ∎

**Iterating to a canonical residue.** A 122-bit product `x` (from multiplying two values `< 2^{61}`) gives `hi < 2^{61}` and `lo < 2^{61}`, so `hi + lo < 2^{62}`. One more fold (`hi' + lo'` on the 62-bit sum) yields a value `< 2^{61} + 1`, and a single conditional subtraction of `p` produces the canonical residue in `[0, p)`. Thus reduction is two additions, two shifts, two masks, and at most one subtraction — no hardware divide. This is correct because each fold preserves the residue class by Lemma 18.1, and the value strictly decreases until it is below `2p`, where one subtraction finishes.

**Why `2^{61} − 1` and not `2^{64}`.** `2^{64}` is not prime (it is `(2^{32})^2`), so `Z_{2^{64}}` is not a field and Theorem 5.1 fails — multiplicative hashing mod a power of two is provably attackable (Section 10). `2^{61} − 1` is a Mersenne prime, restoring the field structure while keeping the cheap fold.

**Other Mersenne primes.** The exponents giving Mersenne primes include `13, 17, 19, 31, 61, 89, 107, 127`. For string hashing, `2^{31}−1` is too small (collision rate `~m/2^{31}`, dangerous for the binary-search family of Section 21) and `2^{89}−1` or `2^{127}−1` exceed a single 64-bit word, needing 128-bit or multi-word arithmetic. `2^{61}−1` is the sweet spot: large enough for a `~10^{-18}` collision rate, small enough that a 122-bit product fits the fold in two 64-bit halves. This is why it is the de facto standard for high-confidence competitive and library hashing.

**Avoiding the bias of a fixed base with small order.** Even with a prime modulus, a poorly chosen base can have small multiplicative order `ord_p(b)`, making `b^{m-1}` cycle and reducing the effective randomness across long windows. A random `b ∈ [2, p−2]` has order dividing `p−1`; the fraction of bases with order below `√p` is negligible, so a uniformly random base is almost surely well-behaved. For `2^{61}−1`, `p−1 = 2^{61}−2 = 2·(2^{60}−1)`, which factors richly, so most bases have large order.

---

## 19. Error-Probability Amplification and the Union Bound

In Monte-Carlo usage (no verification), we must bound the probability that the *entire algorithm* errs, not just one comparison.

**Theorem 19.1 (Union bound over all windows).** Run verification-free Rabin-Karp with a uniformly random base over a text with `n − m + 1` windows. The probability that *any* non-matching window is falsely reported is at most `(n − m + 1)·(m − 1)/p`.

*Proof.* Let `B_i` be the event that window `i` is a non-match but `H(T_i) = H(P)`. By Theorem 5.1, `Pr[B_i] ≤ (m−1)/p`. By the union bound, `Pr[⋃_i B_i] ≤ Σ_i Pr[B_i] ≤ (n−m+1)(m−1)/p`. ∎

**Amplification by independent repetition.** Running `r` independent hashes (independent random bases) and accepting a match only if all `r` agree reduces the per-window error to `((m−1)/p)^r`, so the whole-algorithm error becomes `≤ (n−m+1)·((m−1)/p)^r`. With `r = 2` (double hashing) and `p ≈ 10^9`, `m, n ≤ 10^6`, this is `≤ 10^6·(10^{-3})^2 = 10^{0}·10^{-6} = 10^{-6}` — comfortably negligible. This is the formal statement of why double hashing "is as good as" verification for non-critical use: it makes the *total* error probability vanishingly small, uniformly over the input.

**Contrast with verification.** Verification drives the error to *exactly zero* (Theorem 7.2) at the cost of `O(m)` work per hit. Amplification drives it to `((m−1)/p)^r` at the cost of `r` hashes per roll. The choice is a clean trade between deterministic correctness and constant-factor speed, analyzed precisely by Theorems 7.2 and 19.1.

---

## 20. Deterministic Verification vs Monte-Carlo Acceptance

Rabin-Karp can be run in two correctness regimes, and the distinction is fundamental:

| Regime | Guarantee | Time | Mechanism |
|--------|-----------|------|-----------|
| **Las Vegas** (verify every hit) | Always correct | Expected `O(n+m)`, worst `O(nm)` | Random base for *speed*; verification for *correctness*. |
| **Monte-Carlo** (no verify, amplify) | Correct w.p. `≥ 1 − (n−m+1)((m−1)/p)^r` | Worst-case `O(rn + rm)` | Random bases for *both* speed and correctness. |

The Las Vegas variant never errs; its randomness only affects running time (the worst case is a slow-but-correct outcome). The Monte-Carlo variant has a fixed, deterministic running time but a controllable, tiny probability of a wrong answer. The two correspond to the classical complexity-theory dichotomy: Las Vegas algorithms are always-correct, expected-fast; Monte-Carlo algorithms are always-fast, probably-correct. Rabin-Karp is one of the cleanest textbook examples where the *same code skeleton* yields both, switched solely by whether the verification line is present. For library code that must never lie, choose Las Vegas; for throughput-critical inner loops where a `10^{-9}` error is acceptable, choose Monte-Carlo with amplification.

---

## 21. Expected Number of Hashes in Binary-Search Applications

The "binary search on length + hashing" template (longest duplicate substring, longest common substring, LCE-driven suffix sorting) deserves its own analysis because its error probability compounds across probes.

**Setup.** To find the longest duplicated substring of an `n`-character string, binary search the length `L ∈ [1, n]`. Each probe `dupOfLen(L)` rolls `n − L + 1` windows and inserts their hashes into a set, declaring a duplicate if any hash repeats. There are `⌈log₂ n⌉` probes.

**Time.** Each probe is `O(n)` rolls plus `O(n)` expected set operations, so total time is `O(n log n)` expected. The dominant cost is the rolling hash, recomputed from scratch at each probe length (the high power `b^{L-1}` changes with `L`).

**Error probability (Monte-Carlo, no verification).** Within one probe at length `L`, a *false* duplicate occurs if two distinct length-`L` substrings collide. There are at most `C(n−L+1, 2) ≤ n²/2` pairs, each colliding with probability `≤ (L−1)/p ≤ n/p`. By the union bound, the per-probe false-positive probability is `≤ n³/(2p)`. Across `log n` probes, the total error is `≤ n³ log n /(2p)`. For `n = 10^5`, `p = 10^9`: `n³ = 10^{15}`, so the bound is `~10^{15}·17/(2·10^9) ≈ 10^7` — *greater than 1*, meaning a single 30-bit hash is **not safe** for this application. A 61-bit modulus (`p ≈ 2.3·10^{18}`) gives `~10^{15}·17/(4.6·10^{18}) ≈ 4·10^{-3}` — safe. Double 30-bit hashing gives `~10^{15}·17/(2·10^{18}) ≈ 8·10^{-3}` — also safe.

**Practical consequence.** The "binary search + hashing" family is exactly where the *quadratic number of comparisons* makes a single 30-bit hash dangerous and a 61-bit or double hash mandatory — or, if exactness is required, where each candidate duplicate must be **verified** by a character comparison. This is a concrete instance of why the modulus must scale with the *number of comparisons*, not merely with `n`.

---

## 22. Lower Bounds and the Role of Randomness

**Deterministic lower bound.** Any comparison-based exact matcher must read `Ω(n)` characters in the worst case: an adversary can keep the answer ambiguous until the last unread character is examined. Rabin-Karp's roll reads each text character exactly once (`Θ(n)`), so its scan is asymptotically optimal; verification adds work only on hits.

**Why randomness does not beat `Ω(n)`.** Randomization changes the *worst case from adversary-triggerable to improbable*, but it cannot reduce the `Ω(n)` floor — every character still influences whether a match exists. The benefit of randomness here is robustness (no adversarial `O(nm)`), not a complexity improvement over KMP/Z, which already achieve deterministic `O(n)`.

**Communication-complexity view.** Equality of two `m`-bit strings requires `Ω(m)` bits of deterministic communication but only `O(log m)` bits with public randomness (fingerprinting): Alice sends `H(s)` for a shared random base, and Bob checks `H(s') = H(s)`, erring with probability `≤ (m−1)/p`. This is *exactly* the Rabin-Karp fingerprint, and it is the canonical example of randomness exponentially reducing communication for equality testing. The `O(nm) → O(n)` story for matching is the streaming analogue of this `Ω(m) → O(log m)` communication story.

---

## 23. Comparison Table of Hash-Family Properties

| Hash family | Field / ring | Rolling? | Collision bound | Cryptographic? | Typical use |
|-------------|--------------|----------|-----------------|----------------|-------------|
| Polynomial mod prime `p` | `Z_p` (field) | yes, `O(1)` | `(m−1)/p` (random base) | no | Rabin-Karp, prefix hashes |
| Polynomial mod `2^{61}−1` | `Z_p` (field) | yes, `O(1)` | `~(m−1)/2^{61}` | no | high-confidence matching |
| Double polynomial | `Z_{p1} × Z_{p2}` | yes, `O(1)` | `~(m−1)²/(p1 p2)` | no | contest / dedup index |
| Rabin fingerprint | `GF(2)[x]/Q(x)` | yes, `O(1)` | `N/2^{k}` | no | CDC, hardware fingerprint |
| Implicit `mod 2^{64}` | `Z_{2^{64}}` (ring) | yes, `O(1)` | attackable | no | **avoid** (Thorup attack) |
| Poly1305 | `Z_{2^{130}−5}` (field) | no (one-shot) | `~8L/2^{106}` per key | yes (keyed MAC) | authentication |
| SHA-256 / BLAKE3 | bit mixing | no | `~2^{-128}` (collision) | yes | integrity, signatures |

The table makes the design axis explicit: *field structure* gives a provable collision bound (rows 1–4, 6), a *power-of-two ring* forfeits it (row 5), and *cryptographic* strength (rows 6–7) is a separate property that polynomial Rabin-Karp hashes do not possess. Rabin-Karp lives in rows 1–4: fast, rolling, provably low-collision under randomness, but non-cryptographic.

---

## 23.5 Worked Derivation: From Naive to Linear

To close the theory, trace the asymptotic improvement explicitly. Naive matching compares the pattern at each of `n − m + 1` positions, each comparison up to `m` characters: worst-case `Θ(nm)`. The inefficiency is that the comparison at position `i+1` re-reads characters already examined at position `i`, discarding all that work.

Rabin-Karp eliminates the redundancy by summarizing each window as a single integer that updates in `O(1)`:

```
naive:        Σ_{i=0}^{n-m}  cost(compare T_i, P)   ≤ (n-m+1)·m = Θ(nm)
Rabin-Karp:   O(m)  [hash P]
            + O(m)  [hash T_0]
            + Σ_{i=0}^{n-m-1} O(1)   [roll]            = O(n)
            + Σ_{hits} O(m)          [verify]          = O((occ+spurious)·m)
```

By Theorem 6.1, `E[spurious] ≤ (n−m+1)(m−1)/p`, which is `o(n/m)` when `p ≳ m²·(something)`, so the verification term is `o(n)` and the total collapses to `O(n + m)`. The single conceptual move — replace "re-compare the window" with "incrementally update a summary of the window" — is the same move behind sliding-window sums, monotonic-deque minima, and Fenwick-tree prefix sums. Rabin-Karp is the string-matching instance of the universal sliding-window-with-incremental-aggregate pattern, where the aggregate is a polynomial hash and the catch is that the aggregate is *lossy*, repaired by verification.

---

## 24. Summary

Rabin-Karp rests on one algebraic object: the polynomial hash `H_b,p(s) = Σ c(s[t]) b^{m-1-t} mod p`, the evaluation of a string-polynomial at the base `b` over the field `Z_p`. Horner evaluates it in `O(m)`; the rolling update (Theorem 3.1) advances it in `O(1)` by subtracting the leading term, shifting, and adding the trailing symbol; prefix hashes (Theorem 4.1) give `O(1)` access to any substring's hash. Correctness is owned entirely by **verification**: hashing is a necessary, not sufficient, condition (Proposition 7.1), so comparing characters on every hit yields exactly the true matches regardless of collisions (Theorem 7.2). The collision probability for a *random* base is at most `(m−1)/p` (Theorem 5.1, a one-variable Schwartz-Zippel argument), giving expected `O(n+m)` time (Theorem 6.1); double hashing multiplies these bounds toward `p^{-2}` and tames the birthday effect (Theorem 8.1). The `O(n·m)` worst case is real but exclusive to *deterministic* Rabin-Karp against a chosen input — a private random base restores expected linearity (Construction 9.1). Choose a large prime modulus, a random base above the alphabet, codes offset from zero, and never the implicit `2^{64}` modulus.

The deeper lesson is abstraction: matching needs only *universality* (Definition 1.5, Theorem 5.1), a far weaker property than cryptographic collision resistance, which is exactly why a simple polynomial over a prime field suffices and rolls in `O(1)`.

That separation — universality for speed-and-filtering, verification for correctness — is the reusable design principle that recurs in hash joins, content-addressable storage, and deduplication, far beyond string matching. Every quantitative claim in this document — expected time, variance concentration, double-hash amplification, the binary-search error budget, the 2D and multi-pattern bounds — is a mechanical consequence of `(m−1)/p`-universality combined with the fact that verification reduces error to exactly zero. Internalize those two statements and the rest of Rabin-Karp is arithmetic.

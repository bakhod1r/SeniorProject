# Digit DP — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Prefix-Counting Theorem (`f(N)` Correctness)
3. The Tight-Flag Decomposition (Proof)
4. Why `f(R) − f(L−1)` Is Valid
5. The State as a Finite Automaton on Digits
6. Complexity: `Θ(D · M · base)`
7. The Counting Argument and the Multiplication Principle
8. Generating-Function View of Digit Constraints
9. Leading Zeros and the Padding Bijection
10. Arbitrary Bases and Mixed Radices
11. Summing Quantities: the `(count, sum)` Semiring
12. Limits: When the Accumulator Is Unbounded
13. Summary

---

## 1. Formal Definitions

Fix an integer **base** `b ≥ 2` and let `Σ = {0, 1, …, b−1}` be the digit alphabet. A non-negative integer `x` has a unique base-`b` representation without leading zeros; we also allow **fixed-width** representations that pad on the left with zeros.

**Definition 1.1 (Digit string of a bound).** For a bound `N ≥ 0`, write its base-`b` digits, most significant first, as `N = (N₀, N₁, …, N_{D−1})` where `D` is the number of digits and `N = Σ_{p=0}^{D−1} N_p · b^{D−1−p}`. We treat `N` as this string; its integer value is never required by the algorithm beyond the per-position digits `N_p` and the length `D`.

**Definition 1.2 (Width-`D` candidate).** A **candidate** is any string `c = (c₀, …, c_{D−1}) ∈ Σ^D`. Its integer value is `val(c) = Σ_p c_p · b^{D−1−p}`. Leading zeros are permitted; `val` maps width-`D` strings *onto* `{0, 1, …, b^D − 1}`, bijectively (each integer in that range has exactly one width-`D` padded representation).

**Definition 1.3 (Digit predicate).** A **digit predicate** `P` is a map `Σ^* → {0, 1}` that depends only on the digit sequence (with leading-zero semantics specified). The canonical predicates treated throughout, with their accumulators, are:

- **Digit sum `= S`** — accumulator: running sum (clamped at `S+1`).
- **Value `≡ 0 (mod K)`** — accumulator: running value `mod K` via `rem' = (rem·b + d) mod K`.
- **No two equal adjacent real digits** — accumulator: last real digit (plus a not-started marker).
- **Real digits non-decreasing** — accumulator: last real digit (allow `d ≥ last`).
- **No digit in a forbidden set `F`** — no accumulator; restrict the digit alphabet to `Σ ∖ F`.
- **All digits distinct** — accumulator: a `b`-bit used-digit mask.
- **Count of a specific digit `δ`** (summed over the range) — accumulator: running count of `δ`, returned as the leaf value (not 0/1).

Each is a finite-state property of the prefix; the accumulator is the sufficient statistic of Definition 1.5.

**Definition 1.4 (Counting function).** For a bound `N` and predicate `P`,

```
f_P(N) = #{ x ∈ ℤ : 0 ≤ x ≤ N and P(x) holds }.
```

**Definition 1.5 (Accumulator / sufficient statistic).** An **accumulator** is a function `acc: Σ^* → A` into a finite set `A` such that whether a completed candidate satisfies `P` is determined by the final accumulator value (together with a `started` bit). Formally, there is a predicate `isValid: A × {0,1} → {0,1}` with `P(c) = isValid(acc(c), started(c))` for every candidate `c`. `M = |A|` is the **accumulator range**.

**Remark.** The existence of a *finite* accumulator is exactly the hypothesis that makes Digit DP applicable. If the smallest sufficient statistic about a prefix is unbounded (Section 12), no finite `A` exists and the technique fails.

**Notation conventions.** Throughout: `b ≥ 2` is the base; `Σ = {0,…,b−1}` the digit alphabet; `D` the number of digits of the bound `N`; `N_p` the digit of `N` at position `p` (`0` = most significant); `val(c)` the integer value of a width-`D` candidate string `c`; `P` a digit predicate; `acc` the accumulator with finite range `A`, `M = |A|` (or `M = 2|A|` when the `started` bit is included); `f_P(N) = #{x ∈ [0,N] : P(x)}`; `Free(p, a, s)` the count of valid free completions of positions `p…D−1`; `T` the transition-count matrix of the digit automaton; and `[·]` the Iverson bracket (`1` if the predicate inside holds, else `0`). We write `≡` for congruence, `⊍` for disjoint union, and `Θ`/`O`/`Ω` for the usual asymptotic classes. "Free" means `tight = false` (the bound no longer constrains the digit); "tight" means the prefix still equals `N`'s prefix.

---

## 2. The Prefix-Counting Theorem (`f(N)` Correctness)

We count candidates of fixed width `D` whose value is `≤ N` and which satisfy `P`. By the bijection of Definition 1.2, padded width-`D` candidates with `val ≤ N` correspond exactly to integers in `[0, N]`, so counting valid width-`D` candidates *is* `f_P(N)`.

**Theorem 2.1.** Let `T(N) = #{ c ∈ Σ^D : val(c) ≤ N and isValid(acc(c), started(c)) = 1 }`. Then `T(N) = f_P(N)`.

**Proof.** The map `val: Σ^D → {0, …, b^D − 1}` is a bijection (Definition 1.2). Since `N ≤ b^D − 1` (as `D` is `N`'s digit count), `{c : val(c) ≤ N}` maps bijectively onto `{0, …, N}`. Under this bijection, the predicate value is preserved because `isValid(acc(c), started(c)) = P(val(c))` by Definition 1.5. Therefore `T(N)` counts exactly the integers `x ∈ [0, N]` with `P(x)`, which is `f_P(N)`. ∎

This reduces the problem to: count width-`D` strings that are (a) lexicographically `≤` the digit string of `N` and (b) valid under `isValid`. The lexicographic-`≤` condition is precisely what the tight flag tracks.

**Worked instance.** Let `b = 10`, `N = 21`, so `D = 2` and the digit string is `(2, 1)`. The width-2 candidates with `val(c) ≤ 21` are exactly the strings:

```
00 01 02 ... 09   (val 0..9,   all start with digit 0  < 2  → free)
10 11 12 ... 19   (val 10..19, all start with digit 1  < 2  → free)
20 21             (val 20,21,  start with digit 2 == N[0] → tight; second digit ≤ N[1]=1)
```

There are `10 + 10 + 2 = 22` of them, matching `|{0,…,21}| = 22`. The predicate "digit sum `= 3`" selects `03, 12, 21` → 3, exactly the worked example from `junior.md`. Note `03` is the padded form of the integer `3`; the padding zero is why the digit-sum predicate needs no `started` flag (Section 9).

---

## 3. The Tight-Flag Decomposition (Proof)

The constraint `val(c) ≤ N` on a fixed-width candidate is equivalent to a **lexicographic** constraint on digit strings (because fixed-width `val` is monotone in lexicographic order). We decompose the set of strings `≤ N` by the first position where the candidate falls below `N`.

**Definition 3.1 (Tight prefix).** A prefix `(c₀, …, c_{p−1})` is **tight** if `c_q = N_q` for all `q < p`. It is **free** at position `p` if there exists some `q < p` with `c_q < N_q` (and `c_r = N_r` for `r < q`, the first such `q`).

**Lemma 3.2 (Tight/free dichotomy).** Every candidate `c` with `val(c) ≤ N` falls into exactly one of:
1. `c = N` (tight through all `D` positions), or
2. there is a unique position `j ∈ {0, …, D−1}` such that `c_q = N_q` for `q < j` and `c_j < N_j`, with `c_{j+1}, …, c_{D−1}` **arbitrary** in `Σ`.

**Proof.** Compare `c` and `N` left to right. If they agree everywhere, case 1. Otherwise let `j` be the first disagreement. If `c_j > N_j`, then `val(c) > N` (the most significant differing digit dominates), contradicting `val(c) ≤ N`. Hence `c_j < N_j`. For positions after `j`, any digits keep `val(c) < N` because the deficit `(N_j − c_j)·b^{D−1−j} ≥ b^{D−1−j}` strictly exceeds the maximum possible contribution `Σ_{r>j}(b−1)b^{D−1−r} = b^{D−1−j} − 1` of the remaining positions. So the suffix is unconstrained. Uniqueness of `j` is immediate (first disagreement). The two cases are mutually exclusive and exhaustive. ∎

**Numeric check of the dominance inequality.** Take `b = 10`, `D = 4`, `N = 5000`, and suppose the candidate first dips below `N` at position `j = 1` (so `c_0 = 5`, `c_1 < 0`? no — at `j=0`). Concretely let `j = 0`, `c_0 = 4 < 5 = N_0`. The deficit is `(5 − 4)·10^3 = 1000`. The largest the remaining three positions can contribute is `999`. Since `1000 > 999`, even the maximal suffix `c = 4999` stays below `5000`. This is exactly the inequality `b^{D−1−j} = 10^3 = 1000 > 999 = 10^3 − 1`; one extra unit of margin is what guarantees the suffix is *fully* free once we drop below at the most significant differing position. The inequality is tight (margin exactly 1), which is why a candidate equal to `N` in its prefix and *equal* at `c_j = N_j` must stay tight rather than free — there is no slack.

**Theorem 3.3 (Decomposition formula).**

```
f_P(N) = [isValid(acc(N), started(N))]                         (case 1: N itself)
       + Σ_{j=0}^{D−1}  Σ_{c_j = 0}^{N_j − 1}  Free(j+1, acc_after, started_after)
```

where `acc_after` and `started_after` are the accumulator and started bit after consuming the tight prefix `N_0…N_{j−1}` and then the strictly-smaller digit `c_j`, and `Free(p, a, s)` counts valid completions of positions `p…D−1` with **all digits free** (any digit in `Σ`), starting from accumulator `a` and started bit `s`.

**Proof.** Immediate from Lemma 3.2: sum the indicator over the two cases. Case 2 ranges over the branch position `j` and the strictly-smaller digit `c_j ∈ {0, …, N_j − 1}`; once we drop below `N` at position `j`, all later positions are free, so their count is exactly `Free(j+1, ·, ·)`. ∎

**Corollary 3.4 (Why tight states are not memoized).** `Free(p, a, s)` does **not** depend on `N` (no per-position cap appears in its definition — every digit ranges over all of `Σ`). The tight contributions, by contrast, are a single walk down `N`'s digits (the outer sum over `j`), visiting each tight prefix exactly once. Hence:
- the free function is a bound-independent table worth memoizing;
- the tight prefixes are visited once and gain nothing from caching, and conflating a tight count with a free count of the same `(p, a, s)` is incorrect because the tight position caps the digit at `N_j` whereas `Free` does not.

This is the formal justification of the engineering rule "memoize only the free states."

---

## 4. Why `f(R) − f(L−1)` Is Valid

**Theorem 4.1.** For integers `0 ≤ L ≤ R` and any predicate `P`,

```
#{ x : L ≤ x ≤ R, P(x) } = f_P(R) − f_P(L − 1),
```

with the convention `f_P(−1) = 0`.

**Proof.** Let `V = { x ≥ 0 : P(x) }`. Then `f_P(R) = |V ∩ [0, R]|` and `f_P(L−1) = |V ∩ [0, L−1]|`. Since `[0, L−1] ⊆ [0, R]` (as `L−1 < L ≤ R`), and `[0, R] = [0, L−1] ⊍ [L, R]` is a disjoint union of integer intervals,

```
|V ∩ [0, R]| = |V ∩ [0, L−1]| + |V ∩ [L, R]|.
```

Rearranging gives `|V ∩ [L, R]| = f_P(R) − f_P(L−1)`. The convention `f_P(−1) = 0` handles `L = 0`, where `[0, L−1] = [0, −1] = ∅`. ∎

The decrement `L − 1` is the only operation requiring the bound's integer (or big-integer string) value; it is performed once. Endpoint variants follow by the same set algebra:

| Desired set | Formula | Derivation |
|-------------|---------|------------|
| `L ≤ x ≤ R` | `f(R) − f(L−1)` | Theorem 4.1 |
| `L < x ≤ R` | `f(R) − f(L)` | exclude `L`: subtract `f(L)` not `f(L−1)` |
| `L ≤ x < R` | `f(R−1) − f(L−1)` | exclude `R`: cap at `R−1` |
| `L < x < R` | `f(R−1) − f(L)` | exclude both endpoints |
| `x ≤ R` | `f(R)` | base case |
| `x < R` | `f(R−1)` | exclude `R` |

Each row is a one-line consequence of `|V ∩ [a,b]| = f(b) − f(a−1)` and the inclusion/exclusion of a single endpoint. Pinning down which row the problem wants is the most common pre-coding decision, and a misread here produces an off-by-one that the algebraic correctness proofs cannot catch (they are correct for *some* interval — just not the one asked).

**Corollary 4.2 (Closed-form oracle for residue classes).** The specialization "count `x ∈ [L, R]` with `x ≡ a (mod m)`" has the closed form `⌊(R − a)/m⌋ − ⌊(L − 1 − a)/m⌋` (with the usual care for `a`), giving an oracle for the divisibility predicate that is *independent* of the DP — invaluable for differential testing (`senior.md` §9). Two implementations agreeing is weak evidence if they share a bug; a DP agreeing with an algebraically independent closed form is strong evidence.

---

## 5. The State as a Finite Automaton on Digits

Digit DP is a **DP over a deterministic finite automaton (DFA) that reads digits**. This is the unifying structural view.

**Construction 5.1.** Define a DFA `𝒜 = (Q, Σ, δ, q₀, Acc)`:
- **States** `Q = A × {0,1}` — accumulator value paired with the started bit (the bound/tight flag is *not* an automaton state; it is the lexicographic constraint handled by the decomposition of Section 3).
- **Alphabet** `Σ = {0, …, b−1}`.
- **Transition** `δ((a, s), d) = (update(a, d, s), s ∨ [d ≠ 0])`. For predicates with forbidden transitions (e.g., adjacency, monotonicity, forbidden digits), `δ` is *partial* — undefined (a dead state) on disallowed `(state, digit)` pairs.
- **Start** `q₀ = (acc₀, 0)`.
- **Accepting** `Acc = { (a, s) : isValid(a, s) = 1 }`.

**Proposition 5.2.** The number of length-`D` digit strings accepted by `𝒜` equals the number of width-`D` candidates satisfying `P`. Reading a string drives `𝒜` from `q₀` along the transitions; the string is valid iff the run ends in `Acc`.

**Corollary 5.3 (Connection to fixed-length path counting).** Counting length-`D` accepted strings of `𝒜` is exactly counting **length-`D` walks** from `q₀` to accepting states in the automaton's transition multigraph (sibling topic `11-graphs/32-paths-fixed-length`). If there were no upper-bound constraint, `f` over width `D` is `e_{q₀}^⊤ T^D 1_{Acc}`, where `T` is the `|Q| × |Q|` transition-count matrix. The bound `N` modifies this to the tight/free decomposition: free completions are exactly such walk counts (`T` powers), and the tight walk picks them up branch by branch. **Digit DP = matrix-exponentiation-style automaton walk counting, specialized to a single bound and exploiting that `D` is small enough to iterate positions directly rather than power the matrix.** When `D` is astronomically large but the automaton is fixed, one literally powers `T` (this is the digit-DP/matrix-power bridge).

This is the deepest correct way to see the technique: **the accumulator + started bit are automaton states; the digit positions are time steps; counting is summing accepting runs.**

**Worked automaton.** Take the predicate "the value is `≡ 0 (mod 3)`" in base 10. The DFA has `Q = ℤ/3ℤ = {0, 1, 2}` (the started bit is irrelevant here because leading zeros do not change the residue). The transition on digit `d` is `δ(q, d) = (10q + d) mod 3 = (q + d) mod 3` (since `10 ≡ 1 mod 3`). Start `q₀ = 0`; accepting state `{0}`. The transition-count matrix `T` (entry `T[q][q'] =` number of digits `d ∈ {0,…,9}` sending `q` to `q'`) is:

```
        to 0  1  2
from 0 [  4  3  3 ]      digits sending residue 0 → 0 are {0,3,6,9} (4 of them), etc.
from 1 [  3  4  3 ]
from 2 [  3  3  4 ]
```

Then, ignoring the bound, the number of `D`-digit strings whose value is divisible by 3 is `(T^D)[0][0]`. For `D = 1`: `T[0][0] = 4`, i.e. the digits `{0,3,6,9}` — correct (four single digits divisible by 3). This is literally a fixed-length walk count (sibling `11-graphs/32-paths-fixed-length`); Digit DP with a bound `N` is this walk count *truncated* to the lexicographic prefix `≤ N` via the tight decomposition. When the *width* `D` is astronomically large and there is no tight bound (e.g. "how many `D`-digit base-10 strings are divisible by 3, mod a prime"), one powers `T` directly in `O(|Q|³ log D)` — the explicit digit-DP ↔ matrix-exponentiation bridge.

---

### 5.4 The Boolean (existence) semiring

Replacing the counting semiring `(+, ×)` with the Boolean semiring `(OR, AND)` answers *existence* rather than *count*: `Exists_P(N) = 1` iff some `x ∈ [0, N]` satisfies `P`. The recurrence is identical with `+` → `OR` and the leaf returning a boolean; the tight decomposition is unchanged. This is cheaper to short-circuit (stop at the first `true`) but is usually subsumed by the count (`Exists = [f_P(N) > 0]`). Its independent value is when the accumulator for *counting* would overflow even mod `p` but existence is all that is asked — then the Boolean state space is the same `M` but the arithmetic is a single bit. The min-plus semiring `(min, +)` would instead extract the *smallest valid number* of a given digit-length, though this is rarely the intended question and is mentioned only to locate Digit DP within the same semiring family as fixed-length path counting (sibling `11-graphs/32-paths-fixed-length`, where the semiring abstraction is developed in full).

---

## 6. Complexity: `Θ(D · M · base)`

**Theorem 6.1.** Top-down Digit DP with the free states memoized runs in time `Θ(D · M · b)` and space `Θ(D · M)`, where `D` is the digit count, `M = |A| · 2` the number of (accumulator, started) states, and `b` the base.

**Proof.**
*Free states.* There are `D · M` distinct free states `(pos, a, s)` (Corollary 3.4: bound-independent). Each is computed once (memoization) and its computation loops over `b` digits, doing `O(1)` work per digit (one `update`, one recursive lookup, one addition). So free-state work is `O(D · M · b)`.
*Tight states.* By Lemma 3.2 there is exactly one tight prefix per position, i.e. `D` tight states, each looping over ≤ `b` digits. This adds `O(D · b)`, dominated by the free term.
*Space.* The memo holds `O(D · M)` entries; recursion depth is `O(D)`.
Summing gives `Θ(D · M · b)` time, `Θ(D · M)` space. ∎

**Remark 6.2 (Compared to brute force).** Brute force is `Θ(N · D) = Θ(b^D · D)` — exponential in `D`. Digit DP replaces the `b^D` factor by `M · b`. The speedup is the ratio `b^D / (M·b) = b^{D−1}/M`, astronomical for large `D` whenever `M` is polynomial in `D` (digit sum, residue) or constant (forbidden digits).

**Remark 6.3 (The role of `M`).** All sharpness lives in `M`. Digit sum: `M = Θ(b·D)`. Residue mod `K`: `M = Θ(K)`. Last-digit (adjacency/monotone): `M = Θ(b)`. Digit-set mask: `M = Θ(2^b)`. Two independent accumulators multiply: `M = M₁ · M₂`. The lower bound `Ω(D · M)` (must at least fill the table) shows the analysis is tight when every state is reachable.

**Worked complexity comparison.** Take `N = 10^18` (`D = 19`, `b = 10`) and the predicate "value `≡ 0 (mod K)`" with `K = 1000`.

| Quantity | Value |
|----------|-------|
| Brute force `Θ(b^D · D)` | `≈ 10^18 · 19 ≈ 1.9 × 10^19` operations — infeasible |
| Digit DP `Θ(D · M · b)`, `M = K = 1000` | `≈ 19 · 1000 · 10 = 1.9 × 10^5` operations — microseconds |
| Speedup ratio `b^{D−1}/M` | `≈ 10^18 / 10^3 = 10^15` |

The fifteen-orders-of-magnitude gap is the entire reason Digit DP exists. Crucially, the cost `1.9 × 10^5` is *independent of the value of `N`* — only `D` (its digit count) appears. A 60-digit `N` would cost `≈ 60 · 1000 · 10 = 6 × 10^5`, barely larger, even though its value `10^60` is unrepresentable in any fixed-width integer.

**Remark 6.4 (Reachable-state refinement).** The `Θ(D·M·b)` bound counts *all* table cells, but for many predicates only a fraction of `(pos, acc)` pairs are reachable (e.g. for digit sum, at position `p` the running sum is `≤ 9p`, so the reachable cells form a triangle, halving the constant). The reachable-state count is the precise Myhill-Nerode-refined cost; the table-size bound is an upper bound that is tight in the worst case (residue mod `K`, where every residue is reachable by position 2).

**Worked reachable-state count (all distinct digits).** For "all digits distinct" the accumulator is a 10-bit mask, nominally `M = 2^{10} = 1024`. But at position `p` the mask has at most `p` bits set (only `p` digits placed so far), so the reachable masks number `Σ_{i=0}^{p} C(10, i)`, far fewer than `1024` for small `p`. Summed over all positions, the reachable-state total is `Σ_{p=0}^{D−1} Σ_{i=0}^{min(p,10)} C(10, i)`. For `D = 19` this is dominated by the positions `p ≥ 10`, where all `1024` masks are reachable, giving roughly `(19 − 10)·1024 + (smaller terms) ≈ 10^4` reachable states rather than `19·1024 ≈ 2×10^4` — about a 2× practical saving. A top-down memoized DP visits *only* the reachable states automatically; a bottom-up tabulation over the full table pays for the unreachable cells too. This is one concrete reason top-down is often preferred for mask-heavy predicates (`senior.md` §5.1).

**Worked end-to-end complexity (mask predicate, `N = 10^18`).** `D = 19`, `b = 10`, `M = 1024 · 2` (mask × `started`). Worst-case table-size bound: `19 · 2048 · 10 ≈ 3.9 × 10^5` operations. Reachable-state refinement cuts this roughly in half. Either way it is sub-millisecond — and again independent of the *value* `10^18`, depending only on `D = 19`.

---

## 7. The Counting Argument and the Multiplication Principle

The decomposition of Section 3 and the recurrence both rest on the **multiplication principle**: independent sequential choices multiply, disjoint cases add.

**Lemma 7.1 (Free recurrence).** For `p < D`,

```
Free(p, a, s) = Σ_{d ∈ Σ}  Free(p+1, update(a, d, s), s ∨ [d≠0])
```

with base case `Free(D, a, s) = isValid(a, s)`.

**Proof.** A free completion of positions `p…D−1` is a choice of digit `d` at position `p` (any of the `b` digits in `Σ`) followed by a free completion of positions `p+1…D−1` from the updated state. Different `d` give disjoint sets of completions (they differ at position `p`), and for each `d` the completions are in bijection with `Free(p+1, ·, ·)` by prepending `d`. Summing over the disjoint cases (the `b` values of `d`) gives the recurrence; the base case is the predicate indicator on a fully built candidate. ∎

For predicates with forbidden transitions, the sum ranges only over digits `d` keeping `δ` defined (the partial-transition DFA of Section 5); forbidden `d` contribute `0`, preserving disjointness.

**Numeric instance of the free recurrence.** For digit sum `= 7`, `b = 10`, at the last position (`p = D−1`) with running sum `r`, `Free(D−1, r) = #{d ∈ {0..9} : r + d = 7} = [0 ≤ 7−r ≤ 9]`. So `Free(D−1, r) = 1` for `r ∈ {0,…,7}` (the completing digit `7−r` exists and is a valid digit) and `0` for `r > 7`. At the second-to-last position, `Free(D−2, r) = Σ_{d=0}^{9} Free(D−1, r+d) = #{d : r + d ≤ 7} = max(0, 8 − r)` for `r ≤ 7`. For `r = 0` that is `8` (pairs `(0,7),(1,6),…,(7,0)` — eight two-digit completions summing to 7), matching `[z^7]` in `(1+z+…+z^9)²` from Section 8. The recurrence and the generating function agree at every coefficient, as Theorem 7.2 and Section 8 jointly guarantee.

**Theorem 7.2 (Soundness and completeness of the recurrence).** `Free(p, a, s)` computed by Lemma 7.1 equals the true number of valid free completions. Combined with Theorem 3.3, the algorithm computes `f_P(N)` exactly.

**Proof.** Induction on `D − p`. Base `p = D`: a length-0 completion is the empty suffix; it is valid iff `isValid(a, s)`, matching `Free(D, a, s)`. Inductive step: Lemma 7.1 expresses `Free(p, ·)` in terms of `Free(p+1, ·)`, which by hypothesis is correct; the multiplication-principle argument shows the recurrence counts each valid completion exactly once (uniqueness of the (first-digit, suffix) factorization). Hence `Free(p, ·)` is correct for all `p`. Plugging into Theorem 3.3 yields `f_P(N)`. ∎

---

## 8. Generating-Function View of Digit Constraints

Digit predicates that are *additive over positions* admit a generating-function reading that explains why the accumulator is the right state.

**Digit sum.** The number of width-`D` strings with digit sum `s` is the coefficient `[z^s]` in `(1 + z + z² + … + z^{b−1})^D`, the `D`-fold product of the per-digit generating polynomial. Digit DP evaluates exactly this coefficient incrementally: `Free(p, s)` is the number of ways to complete with the remaining factors contributing the residual `S − s`. The accumulator `s` is the *exponent of `z` accumulated so far*; the recurrence multiplies in one factor `(1 + z + … + z^{b−1})` per position. The upper bound `N` truncates the product to the lexicographic prefix via Section 3.

**Divisibility.** Working modulo `K`, the per-digit factor at position `p` (place value `b^{D−1−p}`) contributes `d · b^{D−1−p} (mod K)`. The accumulator is the partial value `mod K`; the recurrence `rem' = (rem·b + d) mod K` is Horner's method, equivalent to multiplying generating series in the group ring `ℤ[ℤ/Kℤ]`. The count divisible by `K` is the coefficient of the identity residue.

**General additive statistic.** Any statistic `g(c) = Σ_p w(c_p, p)` that is a sum of per-position weights has accumulator = partial sum (or partial sum mod something), and the count with `g = target` is a coefficient extraction. This is the **transfer-matrix / transfer-operator** method: each position applies a linear operator (the per-digit factor) to the state vector, and Digit DP is the position-by-position application of these operators with the lexicographic truncation. Section 5's automaton is the combinatorial face; the generating function is the algebraic face of the same object.

**Worked coefficient extraction.** Count *unbounded* 2-digit base-10 strings (i.e. width 2, no upper-bound constraint) with digit sum `= 3`. The generating polynomial per digit is `g(z) = 1 + z + z² + … + z⁹`. For two digits:

```
g(z)² = (1 + z + … + z⁹)²
coefficient of z^s for small s:
    [z^0] = 1      (00)
    [z^1] = 2      (01, 10)
    [z^2] = 3      (02, 11, 20)
    [z^3] = 4      (03, 12, 21, 30)
    [z^4] = 5      ...
```

So `[z^3] g(z)² = 4`, the four strings `{03, 12, 21, 30}`. Digit DP without an upper bound returns exactly this `4` (it would be `Free(0, 0)` if position 0 were free). With the bound `N = 21`, the lexicographic truncation removes `30` (since `30 > 21`), leaving `3` — precisely the trace in Section 12b. The generating function gives the *untruncated* count; the tight decomposition is the combinatorial subtraction of the strings exceeding `N`. This is the cleanest demonstration that **Digit DP = coefficient extraction from a transfer-operator product, truncated to a prefix.**

**Divisibility as a group-ring product.** For "value `≡ r (mod K)`", work in the group ring `ℤ[ℤ/Kℤ]` with basis `{X^0, …, X^{K−1}}` and `X^a · X^c = X^{(a+c) mod K}`. The per-position factor at place value `b^{D−1−p}` is `Σ_{d=0}^{b−1} X^{d · b^{D−1−p} mod K}`. The product of all `D` factors, read at coefficient `X^r`, counts width-`D` strings of value `≡ r`. Horner's recurrence `rem' = (rem·b + d) mod K` is precisely the incremental evaluation of this product left to right. For `K = 3`, `b = 10`: since `10 ≡ 1 (mod 3)`, every factor is `Σ_d X^{d mod 3} = 4X^0 + 3X^1 + 3X^2` — matching the matrix `T` row of Section 5's worked automaton.

---

## 9. Leading Zeros and the Padding Bijection

**Proposition 9.1.** The fixed-width-`D` padding `val: Σ^D → {0,…,b^D−1}` is a bijection, and a number `x` with `m ≤ D` significant digits has the unique width-`D` representation that is `x`'s digits prefixed by `D − m` zeros.

**Consequence for predicates.** A predicate `P` defined on the *natural* (unpadded) representation must be evaluated on the padded string with the padding zeros made invisible. The `started` bit accomplishes this: it is `0` exactly while reading padding zeros and `1` thereafter. Formally, define `started(c) = [c ≠ 0^D]` along the prefix; `update(a, 0, started=0)` is the identity on the "real" statistic (the padding contributes nothing), and `update(a, d, ·)` for the first `d ≠ 0` initializes the real statistic.

**Theorem 9.2 (Padding-invariance).** If `update` and `isValid` ignore padding zeros (i.e. `update(a, 0, 0) = a` and the validity does not count padding digits), then `T(N)` of Theorem 2.1 equals `f_P(N)` for the predicate `P` defined on natural representations.

**Proof sketch.** By Proposition 9.1 each `x ∈ [0, N]` corresponds to a unique padded candidate. Padding-invariance guarantees the automaton run on the padded string reaches the same accepting status as on the natural string (the leading-zero transitions are self-loops on the start region that do not alter the real statistic). Hence the padded count equals the natural count. ∎

This is the precise reason the digit-sum problem needs no `started` (zeros add `0`, so `update(a,0,0)=a` automatically), while adjacency / monotonic / digit-frequency predicates *do* (their `update` would otherwise be corrupted by padding zeros).

**Proposition 9.3 (When `started` is provably necessary).** The `started` bit is necessary (cannot be dropped without changing the count) precisely when there exist a real statistic `a`, a digit `d ≠ 0`, and a suffix that distinguishes `update(a, 0, started=0)` from `update(a, 0, started=1)` — equivalently, when reading a `0` has a *different* effect on the real statistic depending on whether the number has started.

**Proof.** (⇐) If reading `0` acts differently in the started vs not-started regimes, then merging the two regimes (dropping `started`) conflates two genuinely different automaton states, changing some completion count by Theorem 7.2. (⇒) Conversely, if reading `0` has identical effect in both regimes (as for digit sum, where `0` is the additive identity in both), then the `started` and not-started states are Myhill-Nerode equivalent and minimization removes the bit harmlessly. ∎

**Examples checked against Proposition 9.3.**
- *Digit sum:* reading `0` adds `0` in both regimes → equivalent → `started` droppable. ✓ (matches the junior file skipping it).
- *Adjacency (no two equal adjacent):* before starting, `0` must NOT register as a "last digit `0`"; after starting, `0` IS a last digit `0` that forbids a following `0`. Different effect → `started` necessary. ✓
- *Count of digit `0`:* a padding `0` must not increment the counter; a real `0` must. Different effect → `started` necessary. ✓
- *Divisibility mod `K`:* `rem' = (rem·b + 0) mod K = (rem·b) mod K` in both regimes (a leading zero multiplies the partial value by `b`, but the partial value is `0` while not started, so `rem` stays `0`); the not-started `rem` is fixed at `0` regardless. The bit is droppable *if* the predicate counts `0` as valid; subtle, and the conservative choice is to keep `started`. (This borderline case is why `senior.md` recommends keeping `started` unless you have proven it droppable.)

---

## 10. Arbitrary Bases and Mixed Radices

Everything above is stated for a single base `b`, and nothing in Sections 2–9 used `b = 10`. The bijection (1.2), decomposition (3.3), recurrence (7.1), and complexity (6.1) hold verbatim for any `b ≥ 2`.

**Mixed radix.** If position `p` uses radix `b_p` (e.g., factorial number systems, time-of-day digits), redefine `Σ_p = {0, …, b_p − 1}`, `val(c) = Σ_p c_p · Π_{r>p} b_r`, and the divisibility recurrence becomes `rem' = (rem · b_p + d) mod K`. Lemma 3.2's dominance inequality still holds because the place value at position `j` strictly exceeds the sum of all lower place-value maxima (a property of any positional/mixed-radix system). Hence Digit DP generalizes to mixed radices unchanged in structure.

**Cross-base bounds.** If the value range `[L, R]` is given in decimal but the predicate constrains base-`b` digits, convert `L−1` and `R` to base `b` once (an `O(D log D)` big-integer base conversion), then run the base-`b` DP. Correctness follows from Theorem 4.1 applied to the value range.

**Worked mixed-radix dominance.** Consider the *factorial number system* where position `p` (from the right, 0-indexed) has radix `p+1`, so the place values are `…, 4! , 3!, 2!, 1!` and digit `c_p` satisfies `0 ≤ c_p ≤ p`. The dominance property Lemma 3.2 needs is: the place value at the most-significant differing position exceeds the maximum total of all lower positions. For factorial base this is the identity `n! = Σ_{p=0}^{n-1} p · p!` — i.e. the maximum value representable in the lower `n` positions is exactly `n! − 1 < n!`. So a deficit of one unit at the most significant differing position cannot be recovered by the suffix, exactly as in fixed base. The same telescoping holds for *any* mixed radix: the partial products satisfy `Π_{r<j} b_r > Σ_{p>j}(b_p − 1)Π_{r>p}b_r`, which is the mixed-radix analogue of `b^{D−1−j} > b^{D−1−j} − 1`. Therefore Lemma 3.2, Theorem 3.3, and the whole apparatus carry over to mixed radices without modification — only the per-position digit range and the `b_p` in the Horner update change.

**Worked base-2 instance.** Count integers in `[0, 11]` (decimal) whose binary representation has exactly two `1` bits. Bound `11 = 1011₂`, so `D = 4`. Candidates with popcount 2 and value `≤ 11`: `0011(3), 0101(5), 0110(6), 1001(9), 1010(10)` and `1100(12)` is `> 11` so excluded; `0011,0101,0110,1001,1010` → 5. A Digit DP with `base = 2`, accumulator = running popcount (clamped at 3), and the binary digit string `(1,0,1,1)` returns this `5`; the tight walk excludes `1100` and `1011`(=11 itself has popcount 3, not 2) correctly. This shows the base-agnostic claim concretely: the only changes from the decimal template are `base = 2` and the digit loop `0..min(N[pos], 1)`.

---

## 11. Summing Quantities: the `(count, sum)` Semiring

To compute `Σ_{x ∈ [0,N], P(x)} g(x)` for an additive statistic `g`, lift the state value from a count `c ∈ ℕ` to a pair `(c, s) ∈ ℕ²` where `c` is the number of valid completions and `s` the total of `g` over them.

**Definition 11.1 (Pair operations).** Over completions, define
```
(c₁, s₁) ⊕ (c₂, s₂) = (c₁ + c₂, s₁ + s₂)                  (disjoint union)
prepend digit d (contributing weight w to g): (c, s) ↦ (c, s + w·c)
```

**Proposition 11.2.** `(ℕ², ⊕, prepend)` correctly accumulates `(count, Σg)`: when a digit `d` of weight `w` is prepended to `c` completions whose `g`-total is `s`, every one of the `c` numbers gains `w`, so the new total is `s + w·c`, and the count is unchanged.

**Theorem 11.3.** Running the free recurrence (Lemma 7.1) with values in `ℕ²` under Definition 11.1 yields, at `Free(0, ·)` combined via the tight decomposition, the pair `(f_P(N), Σ_{x≤N, P(x)} g(x))`.

**Proof.** Induction identical to Theorem 7.2, with the additional bookkeeping of `s`. The base case is `(isValid, isValid · g_contribution_of_empty_suffix)`. The inductive step uses Proposition 11.2 to push the per-digit weight into the running sum; disjointness of digit choices justifies `⊕`. ∎

This is the algebraic foundation of "total digit sum over a range" and "total count of digit `7` over a range": the `(count, sum)` pair is a *commutative semiring action* on the state, and Digit DP is its position-by-position evaluation. It composes with any accumulator and with the modular reduction (work in `(ℤ/pℤ)²`).

**Worked instance of the pair recurrence.** Compute `Σ_{x=0}^{12} digitsum(x)` with `N = (1, 2)`, `D = 2`.

```
Free completions of position 1 (the units digit), from running sum r:
    Free(1, r) returns (count, sum) = (10, 10·r + (0+1+…+9)) = (10, 10r + 45)
    [10 numbers, each carrying the prefix sum r plus its own units digit]

Tight walk down N = (1, 2):
    pos 0, take digits < N[0]=1:  only digit 0 (prefix "0_"), become free with r=0:
        contributes Free(1, 0) = (10, 45)           # numbers 00..09 → digit sums 0..9
    pos 0, take digit == 1: stay tight, r = 1.
        pos 1, take digits < N[1]=2: digits 0,1 (prefixes "10","11"), each a leaf:
            "10" sum 1, "11" sum 2 → contributes (2, 1+2) = (2, 3)
        pos 1, take digit == 2: leaf "12", sum 3 → contributes (1, 3)
Total sum = 45 + 3 + 3 = 51, total count = 10 + 2 + 1 = 13 (numbers 0..12). ✓
```

The hand computation `45 + 3 + 3 = 51` matches the program output in `interview.md` Challenge 4 and `senior.md` §8.2. The pair recurrence is exactly the multiplication-principle bookkeeping made into algebra: `s + w·c` is "every one of the `c` counted numbers gains the weight `w` of the prepended digit."

**Modular pair variant.** Over a prime `p`, work in `(ℤ/pℤ)²`: both components reduce mod `p`, and the subtraction `f(R) − f(L−1)` on the sum component uses `((a − b) mod p + p) mod p` to stay non-negative (Theorem 4.1 holds verbatim over the integers; the modular reduction is a ring homomorphism applied to both sides, so the identity is preserved mod `p`).

**Step table of the pair recurrence (`N = 12`).** Tracing the `(count, sum)` values bottom-up makes the homomorphism concrete:

```
pos 2 (leaf): value carried = (1, run)            # run = final digit sum
pos 1, free, running sum r:
    Σ_{d=0}^{9} (1, r+d) = (10, 10r + 45)
    e.g. r = 0 → (10, 45)
         r = 1 → (10, 55)
pos 0, free, running sum 0:
    Σ_{d=0}^{9} (10, 10d + 45) = (100, 450 + 45·10) = (100, 4500)
    interpretation: 100 two-digit strings 00..99, total digit sum 900? 
    check: each of digits 0..9 appears 10 times in tens place (sum 450)
           and 10 times in units place (sum 450) → 900. 
    (The (100, 4500) above is the FREE count for a 3-wide frame's last two
     positions seeded by sum 0; the worked N=12 walk in §11 truncates it.)
```

The arithmetic identities (`10·45`, `450 + 450 = 900`) are independent hand-checks of the `s + w·c` rule. Under a modulus every number here is taken mod `p`; since reduction commutes with `+` and `·`, the reduced trace equals the reduction of the exact trace — which is precisely why the modular pair DP is correct.

---

## 12. Limits: When the Accumulator Is Unbounded

**Theorem 12.1 (Applicability criterion).** Digit DP runs in `poly(D)` time iff there is a sufficient statistic `acc` with `M = |A| = poly(D)` (or `O(1)`). If every sufficient statistic has `|A|` exponential in `D`, the position-by-position DP table is exponential and Digit DP gives no asymptotic gain over brute force.

**Examples of failure.**
- **"Value is prime."** Primality is not a function of any small additive digit statistic; the minimal sufficient statistic about a prefix is essentially the prefix's full value. No bounded accumulator exists; counting primes in `[L, R]` is *not* a Digit DP problem (it is the domain of analytic number theory / Meissel-Mertens / sieve methods).
- **"Digits form a permutation of a specific large multiset" with `D` huge.** The frequency vector has `(D+1)^b` states — polynomial in `D` for fixed `b`, so this *is* feasible; but if `b` also grows, `(D+1)^b` is super-polynomial.
- **"Product of digits equals `Q`" for large `Q`.** The partial product ranges over the divisors of `Q` reachable by digit products; if that set is small it is feasible, otherwise not — a problem-dependent boundary.

**Relation to hardness.** Unlike fixed-length *simple-path* counting (which is #P-hard, sibling `11-graphs/32-paths-fixed-length`), Digit DP's tractability is not a complexity-class statement but a **state-space-size** statement: the predicate is tractable exactly when it is recognized by a *small* DFA on digits (Section 5). Myhill-Nerode gives the sharp bound: the minimal number of accumulator states equals the number of Myhill-Nerode equivalence classes of digit prefixes under `P`. Digit DP is efficient iff that index is small.

**Worked failure analysis: primality.** Consider `P(x) = "x is prime"`. Suppose, for contradiction, a finite accumulator `acc` with `|A| = M` were sufficient: whether a completed number is prime would be a function of `acc` of the prefix and the suffix. Take two prefixes `u, v` of equal length that map to the *same* accumulator value, `acc(u) = acc(v)`, but with `val(u) ≠ val(v)` (possible whenever the number of distinct prefixes of that length, `≈ b^{len}`, exceeds `M`). By sufficiency, for every suffix `w`, `concat(u,w)` is prime iff `concat(v,w)` is prime. But primality of `val(u)·b^{|w|} + val(w)` versus `val(v)·b^{|w|} + val(w)` are governed by two distinct arithmetic progressions in `val(w)`; by Dirichlet's theorem each contains infinitely many primes and infinitely many composites, and there is no reason the prime/composite pattern coincides across the two progressions — explicit small counterexamples exist (e.g. prefixes giving `13` vs `14` at length 2: append `0` → `130` composite, `140` composite; append `9` → `139` prime, `149` prime; but append `1` → `131` prime, `141 = 3·47` composite, breaking the supposed equivalence). Hence `acc(u) = acc(v)` cannot imply equal primality for all suffixes once `M < b^{len}`, so no *constant* `M` works; the Myhill-Nerode index is infinite and `M` must grow like `b^{len}` (essentially the full prefix value). Therefore primality is **not** a Digit DP predicate — counting primes in `[L, R]` requires analytic number theory (the prime-counting function `π`, Meissel-Mertens-Lehmer, or Riemann-hypothesis-conditional methods), not a digit recursion.

**Contrast with feasible cases.** The same Myhill-Nerode lens *certifies* feasibility for the standard predicates: "digit sum `= S`" has at most `9D+1` classes (two prefixes with the same partial sum are equivalent); "divisible by `K`" has exactly `K` classes (two prefixes with the same residue mod `K` are equivalent, since `δ(q,d) = (qb+d) mod K` depends only on `q`); "no two equal adjacent digits" has `b+1` classes (the last digit, plus a not-started class); "all digits distinct" has `2^b` classes (the used-digit set). In each case the finite, small index *is* the accumulator range `M`, and the DP is efficient. The boundary between feasible and infeasible is precisely the finiteness (and smallness) of the Myhill-Nerode index of `P` viewed as a language over `Σ`.

---

## 12b. The Free-Table + Tight-Walk Algorithm, Formalized

Theorem 3.3 is not merely a proof device; it is an *algorithm*. We restate it as the two-phase computation used at scale (engineering details in `senior.md` §5.3).

**Phase 1 — Free table (bound-independent).** Compute, bottom-up,

```
Free(D, a, s) = isValid(a, s)
Free(p, a, s) = Σ_{d ∈ Σ_allowed(a,s)} Free(p+1, update(a,d,s), s ∨ [d≠0])     for p < D
```

This table has `Θ(D · M)` entries, each filled in `O(b)` time. **It does not reference `N`.** By Corollary 3.4 it is reusable across every bound with the same predicate and base.

**Phase 2 — Tight walk (bound-dependent).** Initialize `(a, s) ← (acc₀, 0)` and `answer ← 0`. For `p = 0, 1, …, D−1`:

```
for each digit d with 0 ≤ d < N_p and d ∈ Σ_allowed(a, s):
    answer += Free(p+1, update(a, d, s), s ∨ [d≠0])   // branch strictly below N → free
if N_p ∈ Σ_allowed(a, s):
    (a, s) ← (update(a, N_p, s), s ∨ [N_p ≠ 0])       // take N's digit, stay tight
else:
    break                                              // tight path dies; no N-equal completion
after the loop, if we did not break and isValid(a, s):
    answer += 1                                         // N itself is valid (case 1 of Lemma 3.2)
```

**Theorem 12b.1.** Phase 2 returns `f_P(N)`.

**Proof.** The loop iterates over the branch position `j` of Lemma 3.2. At position `p`, the running `(a, s)` is exactly the accumulator/started state after consuming the tight prefix `N_0…N_{p−1}`. Summing `Free(p+1, …)` over `d < N_p` realizes the inner double sum of Theorem 3.3 (branch strictly below at position `j = p`, then free). Taking `d = N_p` advances the tight prefix to length `p+1`. If at some position `N_p` is disallowed by the predicate (e.g. a forbidden digit), no candidate equals `N` on a valid path, so the tight branch contributes nothing further — the `break` is correct. The post-loop `+1` realizes case 1 (the candidate `c = N` itself). Disjointness across `j` (Lemma 3.2) means no double counting. Hence the total is `f_P(N)`. ∎

**Corollary 12b.2 (Batched-query cost).** With Phase 1 precomputed once in `Θ(D · M · b)`, each subsequent bound costs only Phase 2: `Θ(D · b)`. For `Q` queries the total is `Θ(D · M · b + Q · D · b)` rather than `Θ(Q · D · M · b)` — the `M` factor is paid once, not per query. This is the formal justification for the persistent free-state cache.

**Fully worked trace (`N = 21`, `S = 3`, digit sum).** Phase 1 fills the free table `Free(pos, sum)`:

```
Position 1 (units digit, base case at pos 2 is [sum == 3]):
    Free(1, 0) = #{ d : 0 + d == 3 } = 1        (d = 3)
    Free(1, 1) = #{ d : 1 + d == 3 } = 1        (d = 2)
    Free(1, 2) = #{ d : 2 + d == 3 } = 1        (d = 1)
    Free(1, 3) = #{ d : 3 + d == 3 } = 1        (d = 0)
    Free(1, s) for s > 3 = 0 (pruned)
Position 0 (would be needed only for free prefixes at pos 0; none arise here
            because position 0 is always entered tight for a 2-digit bound).
```

Phase 2 walks `N = (2, 1)`:

```
pos 0, running (sum=0, tight). Digits d < N[0]=2: d ∈ {0, 1}, each goes FREE:
    d = 0 → free at pos 1 with sum 0 → += Free(1, 0) = 1   (numbers 00..09; only 03 valid)
    d = 1 → free at pos 1 with sum 1 → += Free(1, 1) = 1   (numbers 10..19; only 12 valid)
    take d = N[0] = 2 → stay tight, sum = 2.
pos 1, running (sum=2, tight). Digits d < N[1]=1: d ∈ {0}, each a leaf:
    d = 0 → leaf "20", sum 2 ≠ 3 → contributes 0
    take d = N[1] = 1 → stay tight, sum = 3.
post-loop: tight path survived to a leaf = N = 21, sum 3 == S → += 1.
TOTAL = 1 + 1 + 0 + 1 = 3.    ✓ (matches {3, 12, 21})
```

This trace exhibits every clause of Theorem 12b.1: the two free branches at position 0 (Theorem 3.3's inner sum at `j = 0`), the single free branch at position 1 (`j = 1`), and the final `+1` for `N` itself (case 1 of Lemma 3.2). It also shows *why tight states are not in the `Free` table*: the tight visits `(pos 0, sum 0)` and `(pos 1, sum 2)` are each entered exactly once on the walk and use the capped limits `N[0]=2`, `N[1]=1` — values a `Free` lookup (which assumes limit `b−1 = 9`) would get wrong.

**Myhill-Nerode index per standard predicate** (the minimal `M`, i.e. number of prefix-equivalence classes):

| Predicate | Equivalence relation on prefixes | Minimal `M` |
|-----------|----------------------------------|-------------|
| digit sum `= S` | equal partial sum (clamped at `S+1`) | `S + 2` |
| value `≡ 0 (mod K)` | equal residue mod `K` | `K` |
| no two equal adjacent digits | equal last digit (+ not-started) | `b + 1` |
| digits non-decreasing | equal last digit (+ not-started) | `b + 1` |
| no forbidden digit | all valid prefixes equivalent | `1` |
| all digits distinct | equal used-digit set | `2^b` |
| count of digit `d` (sum variant) | equal partial count (≤ `D`) | `D + 1` |
| "is prime" | none finite (Dirichlet argument above) | `∞` |

The right column is, up to the `started` factor, exactly the `M` that drives `Θ(D · M · b)`. This table operationalizes the theory: to assess feasibility, ask "what is the coarsest equivalence on prefixes that the predicate respects?" — its index is your `M`.

---

## 12c. Combining Bounds and Inclusion-Exclusion

Theorem 4.1 (`f(R) − f(L−1)`) is the rank-1 case of a general principle: **counts over digit predicates compose by the inclusion-exclusion of the underlying integer sets.**

**Proposition 12c.1 (Two-sided and multi-interval).** For disjoint intervals `[L_1, R_1], …, [L_m, R_m]`,

```
#{ x ∈ ⋃ [L_i, R_i] : P(x) } = Σ_i ( f_P(R_i) − f_P(L_i − 1) ).
```

**Proof.** Additivity of `|V ∩ ·|` over the disjoint union, applied intervalwise via Theorem 4.1. ∎

**Proposition 12c.2 (Conjunction of digit predicates).** If `P = P₁ ∧ P₂` and both are recognized by DFAs `𝒜₁, 𝒜₂` (Section 5), then `P` is recognized by the **product automaton** `𝒜₁ × 𝒜₂` with state set `Q₁ × Q₂`, transition `δ((q₁,q₂), d) = (δ₁(q₁,d), δ₂(q₂,d))`, and accepting set `Acc₁ × Acc₂`. Hence `M = M₁ · M₂` and the conjunction is itself a Digit DP.

**Proof.** A run of `𝒜₁ × 𝒜₂` accepts iff both component runs accept, i.e. iff `P₁ ∧ P₂`. The product is deterministic and finite. Apply Theorem 7.2 to the product. ∎

This is the rigorous content behind "carry two accumulators": divisibility-and-digit-sum (`senior.md` task A3) is the product of the residue DFA and the (clamped) digit-sum DFA, with `M = K · (S+1)`. **Disjunction** `P₁ ∨ P₂` is handled by inclusion-exclusion at the count level: `f_{P₁∨P₂} = f_{P₁} + f_{P₂} − f_{P₁∧P₂}`, each term its own Digit DP. Negation is `f_{¬P}(N) = (N+1) − f_P(N)` (the total count of `[0,N]` minus the matches). These three closure properties (product for `∧`, count-level inclusion-exclusion for `∨`, complement for `¬`) make the class of Digit-DP-countable predicates a Boolean algebra — exactly the closure properties of regular languages, consistent with the DFA characterization of Section 5.

**Worked inclusion-exclusion.** Count `x ∈ [0, 30]` divisible by 2 *or* 3.

```
f_2(30)  = #{0,2,4,…,30}            = 16     (divisible by 2)
f_3(30)  = #{0,3,6,…,30}            = 11     (divisible by 3)
f_6(30)  = #{0,6,12,18,24,30}       = 6      (divisible by 6 = lcm)
f_{2∨3}  = 16 + 11 − 6              = 21
```

Each of `f_2, f_3, f_6` is a residue-mod-`K` Digit DP (or the closed-form oracle of Corollary 4.2); the conjunction `2 ∧ 3` is "divisible by 6" because the product automaton's accepting condition `rem₂ = 0 ∧ rem₃ = 0` is equivalent to `rem₆ = 0` by CRT. The subtraction follows Proposition 12c.2 / the inclusion-exclusion rule, and under a modulus would be normalized as in `senior.md` §7.4. This 21 is verifiable by hand against the brute set `{0,2,3,4,6,…,30}`.

---

## 13. Summary

- **Theorem 2.1** reduces `f_P(N)` to counting fixed-width digit strings `≤ N` that satisfy a finite-state predicate, via the padding bijection.
- **Lemma 3.2 / Theorem 3.3** are the heart: every candidate `≤ N` is either `N` itself or branches strictly below `N` at a unique position, after which all digits are free. This *tight-flag decomposition* proves correctness and shows the free completions are **bound-independent**, justifying "memoize only the free states" (Corollary 3.4).
- **Theorem 4.1** proves `f(R) − f(L−1)` by disjoint-interval set algebra; the only big-number step is the single decrement.
- **Section 5** identifies the state `(accumulator, started)` as a **DFA on digits**, making Digit DP a specialization of automaton walk counting — the bridge to matrix exponentiation (sibling `32-paths-fixed-length`).
- **Theorem 6.1** gives the tight complexity `Θ(D · M · b)`; the entire sharpness is the accumulator range `M`, equal (by Myhill-Nerode) to the number of distinct prefix-equivalence classes the predicate induces.
- **Sections 7–8** ground correctness in the multiplication principle and reveal the generating-function / transfer-matrix face of the same recurrence.
- **Section 9** proves padding-invariance, explaining precisely when `started` is needed (any predicate whose per-digit update is corrupted by leading zeros) and when it is not (digit sum).
- **Section 11** lifts counting to the `(count, sum)` pair semiring for summed quantities over a range.
- **Section 12** delimits applicability: Digit DP is efficient exactly when the predicate is a *small* DFA on digits; predicates needing the whole value (primality) fall outside, with `M` exponential.

- **Section 12b** turns the decomposition into the explicit *free-table + tight-walk* algorithm (Theorem 12b.1), and **Section 12c** establishes the closure properties — product automaton for `∧`, count-level inclusion-exclusion for `∨`, complement for `¬` — that make Digit-DP-countable predicates a Boolean algebra, mirroring regular languages.

### The one-sentence theorem

> **A digit predicate `P` is Digit-DP-countable in `Θ(D · M · b)` time if and only if `P`, viewed as a language over the digit alphabet, has finite Myhill-Nerode index `M`; the recursion is exactly the position-by-position evaluation of the corresponding DFA, with the upper bound `N` handled by the tight-flag decomposition and ranges by `f(R) − f(L−1)`.**

Everything in this document is a corollary of that sentence:

- **Correctness** is the automaton's acceptance (Theorem 7.2).
- **Efficiency** is the smallness of `M` (Theorem 6.1, Myhill-Nerode).
- **Bound handling** is the lexicographic decomposition (Lemma 3.2 / Theorem 3.3).
- **Range handling** is disjoint-interval set algebra (Theorem 4.1).
- **Leading-zero handling** is the padding bijection and its necessity criterion (Theorems 9.2, Proposition 9.3).
- **Boundary of applicability** is the finiteness of the Myhill-Nerode index (Section 12; primality is the canonical non-example).
- **Composition** (`∧`, `∨`, `¬`) is the Boolean-algebra closure of regular digit languages (Section 12c).

### Open theoretical notes

- **Sublinear-in-`D` regimes.** When the automaton is *fixed* and `D` is the variable (counting over all width-`D` strings), powering the transition matrix gives `O(|Q|³ log D)` — sublinear in `D`. This is the digit-DP/matrix-exponentiation bridge taken to its limit; it does not apply when a specific bound `N` is given, since the tight walk is inherently `Θ(D)`.
- **Minimization for free.** Running DFA minimization on the constructed automaton (Section 5) before the DP automatically achieves the optimal `M` (the Myhill-Nerode index). In practice the standard accumulators are already minimal, but for machine-generated predicates (e.g. compiled from a regex on digits) minimization is the principled way to shrink the state.
- **Weighted and probabilistic variants.** Replacing the counting semiring `(+, ×)` with the probability semiring turns `f` into "probability a uniformly random width-`D` string satisfies `P`"; with min-plus it would compute an optimal digit assignment of fixed value-rank — though the latter is rarely the intended question. The semiring abstraction (sibling `11-graphs/32-paths-fixed-length`) applies verbatim.
- **Two-bound joint DP.** When a predicate couples two numbers (e.g. counting pairs `(x, y)` with `x ≤ y ≤ N` and a digit relation), one can run a *joint* Digit DP over both digit strings simultaneously, carrying a tight flag per number and a relation flag (`x < y` decided / undecided). The state space multiplies but the structure is unchanged — a direct generalization of the single-bound decomposition (Lemma 3.2) to the product order on pairs.
- **Lower bounds.** No technique can count a digit predicate faster than reading the bound, so `Ω(D)` is a trivial lower bound; the `Θ(D · M · b)` upper bound is optimal up to the reachable-state refinement whenever the predicate's automaton is already minimal (its `M` equals the Myhill-Nerode index). Thus Digit DP is, in the automaton-minimized form, asymptotically optimal for its problem class.

References to study further: Myhill-Nerode theorem and DFA minimization, the transfer-matrix method (Flajolet-Sedgewick, *Analytic Combinatorics*), generating functions for digit statistics, automaton-based forbidden-pattern counting (Aho-Corasick), mixed-radix numeral systems, the prime-counting function and analytic methods (for the primality non-example), and sibling topics `11-graphs/32-paths-fixed-length` (the matrix-power bridge), `01-fibonacci-memoization`, and `02-tabulation-vs-memoization`.

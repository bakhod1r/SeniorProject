# Catalan Numbers — Mathematical Foundations

## Table of Contents
1. Formal Definitions and the Three Equivalent Forms
2. The First-Return Decomposition and the Convolution Recurrence
3. The Generating Function `c(x) = 1 + x c(x)^2`
4. The Reflection Principle and the Closed Form
5. The Cycle Lemma (Dvoretzky–Motzkin) — A Second Closed-Form Proof
6. Equivalence of the Forms (Recurrence ⟺ Closed Form)
7. Bijections Among the Catalan Structures
8. Asymptotics: `C_n ~ 4^n / (n^{3/2} √π)`
9. Generalizations: Fuss–Catalan, Narayana, Ballot
10. Modular and Computational Foundations
11. Summary

---

## 1. Formal Definitions and the Three Equivalent Forms

**Definition 1.1 (Catalan numbers).** The Catalan numbers `(C_n)_{n≥0}` are defined by `C_0 = 1` and the convolution recurrence

```
C_{n+1} = Σ_{i=0}^{n} C_i · C_{n-i}     (n ≥ 0).
```

The first terms are `1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862, 16796, …` (OEIS A000108).

**Theorem 1.2 (Three equivalent forms).** For all `n ≥ 0`,

```
(R)  C_{n+1} = Σ_{i=0}^{n} C_i C_{n-i}            (recurrence)
(D)  C_n = (1/(n+1)) C(2n, n)                       (division form)
(S)  C_n = C(2n, n) − C(2n, n+1)                    (subtraction form)
```

All three define the same sequence. Sections 2–6 prove each form and their mutual equivalence: (R) is the structural definition (Section 2), (S) follows from the reflection principle (Section 4), (D) follows from the cycle lemma (Section 5) or from (S) by algebra (Section 4.3), and (R) ⟺ (D) is verified via the generating function (Section 3) and directly (Section 6).

**Definition 1.3 (Dyck path).** A **Dyck path** of semilength `n` is a sequence of `n` up-steps `U = (+1, +1)` and `n` down-steps `D = (+1, −1)` from `(0,0)` to `(2n, 0)` such that no proper prefix dips below the x-axis (every prefix has `#U ≥ #D`). We write `𝒟_n` for the set of such paths; `|𝒟_n| = C_n` is established in Section 2.

**Definition 1.4 (Convention).** `C(n, k) = 0` whenever `k < 0` or `k > n`; `C(n, k) = n!/(k!(n-k)!)` otherwise. In particular `C(2n, n+1)` is well-defined for all `n ≥ 0` (and `= 0` only vacuously never, since `n+1 ≤ 2n` for `n ≥ 1`; for `n = 0`, `C(0,1) = 0`, giving `C_0 = C(0,0) − 0 = 1`).

---

## 2. The First-Return Decomposition and the Convolution Recurrence

**Theorem 2.1.** `|𝒟_n| = C_n`, where `C_n` is defined by the recurrence (R).

*Proof.* Let `d_n = |𝒟_n|`, with `d_0 = 1` (the empty path). Take any nonempty Dyck path `P ∈ 𝒟_{n+1}`. It starts with an up-step `U`. Let `2k + 2` be the **first return** to the x-axis — the first index `> 0` where the path touches height `0`. The step just before the return is necessarily a down-step `D`, and the portion strictly between the initial `U` and the returning `D` is itself a Dyck path `A ∈ 𝒟_i` (raised by one unit), while the portion after the return is a Dyck path `B ∈ 𝒟_{n-i}`:

```
P = U · A · D · B,     A ∈ 𝒟_i,  B ∈ 𝒟_{n-i},  0 ≤ i ≤ n.
```

This decomposition is a **bijection** `𝒟_{n+1} ≅ ⨆_{i=0}^{n} (𝒟_i × 𝒟_{n-i})`: given any pair `(A, B)`, the string `U A D B` is a Dyck path with first return at position `2i+2`, and the map is invertible by reading off the first return. Counting both sides:

```
d_{n+1} = Σ_{i=0}^{n} d_i · d_{n-i}.
```

This is exactly recurrence (R) with `d_0 = 1`, so `d_n = C_n`. ∎

**Corollary 2.2.** The same first-return argument applied to balanced parentheses (`U = (`, `D = )`), binary trees (root splits into left/right subtree), and triangulations (a fixed edge lies in one triangle, splitting the polygon) produces the identical recurrence — hence all are counted by `C_n`. The structural reason "one sequence, many objects" is that every such object admits a first-return / root split into two independent smaller objects.

### 2.1 Worked decomposition (`n = 2 → C_3 = 5`)

Enumerate `𝒟_3` by the first-return split `P = U·A·D·B` with `A ∈ 𝒟_i`, `B ∈ 𝒟_{2-i}`:

```
i = 0:  A = ε,    B ∈ 𝒟_2  (2 choices)  →  U D · (UUDD), U D · (UDUD)
i = 1:  A ∈ 𝒟_1, B ∈ 𝒟_1  (1×1 choice) →  U (UD) D · (UD)
i = 2:  A ∈ 𝒟_2, B = ε    (2 choices)  →  U (UUDD) D, U (UDUD) D
```

Counts: `C_0·C_2 + C_1·C_1 + C_2·C_0 = 2 + 1 + 2 = 5 = C_3`. The split point `i` ranges over `0, 1, 2`, and the symmetric counts `2, 1, 2` mirror the palindromic nature of the convolution. Listing the five paths confirms the bijection is exhaustive and non-overlapping — every path appears in exactly one `i`-bucket determined by its first return.

### 2.2 Uniqueness of the decomposition

The decomposition is well-defined because the first return is *unique*: a nonempty Dyck path starts above the axis (first step is `U`) and returns to `0` at least once (it ends at `0`); the *earliest* such return is unambiguous. Removing the bounding `U…D` leaves a path that stays strictly above `0` in its interior, so raising/lowering by one unit makes it a genuine Dyck path `A`; the remainder `B` starts at `0`. Conversely any `(A, B)` reassembles uniquely. This bijectivity — not mere inequality of counts — is what licenses the *equality* `d_{n+1} = Σ d_i d_{n-i}` rather than a bound.

---

## 3. The Generating Function `c(x) = 1 + x c(x)^2`

**Definition 3.1.** The ordinary generating function (OGF) is `c(x) = Σ_{n≥0} C_n x^n`.

**Theorem 3.2 (Functional equation).** `c(x) = 1 + x · c(x)^2`.

*Proof.* The coefficient of `x^{n+1}` in `c(x)^2` is `Σ_{i=0}^{n} C_i C_{n-i}` (the Cauchy product), which equals `C_{n+1}` by (R). Therefore

```
x · c(x)^2 = Σ_{n≥0} (Σ_{i=0}^{n} C_i C_{n-i}) x^{n+1} = Σ_{n≥0} C_{n+1} x^{n+1} = c(x) − C_0 = c(x) − 1.
```

Rearranging gives `c(x) = 1 + x c(x)^2`. ∎

**Theorem 3.3 (Closed form of the OGF).** Solving the quadratic `x·c^2 − c + 1 = 0` for `c`:

```
c(x) = (1 − √(1 − 4x)) / (2x).
```

*Proof.* The quadratic formula gives `c = (1 ± √(1−4x))/(2x)`. The `+` root blows up as `x → 0` (numerator `→ 2`, denominator `→ 0`), violating `c(0) = C_0 = 1`. The `−` root satisfies `lim_{x→0} c(x) = 1` (L'Hôpital or the binomial expansion below), so we take the minus sign. ∎

**Theorem 3.4 (Extracting the coefficients).** Expanding `√(1 − 4x)` by the generalized binomial theorem yields `C_n = (1/(n+1)) C(2n, n)`.

*Proof.* The generalized binomial series gives

```
√(1 − 4x) = (1 − 4x)^{1/2} = Σ_{n≥0} C(1/2, n) (−4x)^n.
```

Using `C(1/2, n) = \frac{(1/2)(−1/2)(−3/2)⋯(1/2 − n + 1)}{n!}`, a standard simplification (multiply numerator and denominator, collect powers of 2) gives

```
C(1/2, n) (−4)^n = − (2/n) C(2n−2, n−1) = − \frac{1}{2n−1} C(2n, n)      (n ≥ 1),
```

so

```
√(1 − 4x) = 1 − Σ_{n≥1} \frac{1}{2n−1} C(2n, n) x^n = 1 − 2 Σ_{n≥1} \frac{1}{2n} C(2n,n) x^n... 
```

Substituting into `c(x) = (1 − √(1−4x))/(2x)` and shifting the index by one (dividing the series by `2x`) yields the coefficient of `x^n` equal to `\frac{1}{n+1} C(2n, n)`. The clean statement of the intermediate identity is

```
\frac{1 − √(1−4x)}{2x} = Σ_{n≥0} \frac{1}{n+1}\binom{2n}{n} x^n,
```

which is form (D). ∎

This is the algebraically cleanest route from the recurrence to the closed form: encode (R) as the quadratic functional equation, solve it, and read off the Taylor coefficients. The generating function also makes generalizations mechanical: the `k`-ary analogue satisfies `c = 1 + x c^k`, immediately giving Fuss–Catalan (Section 9).

### 3.1 Worked coefficient extraction (low orders)

It is instructive to expand `√(1 − 4x)` to a few terms and watch the Catalan numbers fall out.

```
(1 − 4x)^{1/2} = 1 − 2x − 2x^2 − 4x^3 − 10x^4 − 28x^5 − …
```

(Each coefficient is `−\frac{1}{2n-1}\binom{2n}{n}`: for `n = 1`, `−\frac{1}{1}·2 = −2`; for `n = 2`, `−\frac{1}{3}·6 = −2`; for `n = 3`, `−\frac{1}{5}·20 = −4`; for `n = 4`, `−\frac{1}{7}·70 = −10`.) Then

```
1 − √(1 − 4x) = 2x + 2x^2 + 4x^3 + 10x^4 + 28x^5 + …
```

Dividing by `2x` shifts and halves:

```
c(x) = \frac{1 − √(1−4x)}{2x} = 1 + x + 2x^2 + 5x^3 + 14x^4 + …,
```

whose coefficients are exactly `C_0, C_1, C_2, C_3, C_4 = 1, 1, 2, 5, 14`. The mechanical extraction confirms Theorem 3.4 on the first five terms without invoking the general binomial identity — a useful sanity check when implementing series-based Catalan generators.

### 3.2 Lagrange inversion (the systematic coefficient tool)

The functional equation can be written as `c = 1 + x c^2`. Setting `w = c − 1` gives `w = x(1+w)^2`, i.e. `w = x φ(w)` with `φ(w) = (1+w)^2`. **Lagrange inversion** extracts

```
[x^n] w = \frac{1}{n}[w^{n-1}] φ(w)^n = \frac{1}{n}[w^{n-1}](1+w)^{2n} = \frac{1}{n}\binom{2n}{n-1} = \frac{1}{n+1}\binom{2n}{n},
```

using `\binom{2n}{n-1} = \frac{n}{n+1}\binom{2n}{n}`. Since `[x^n] c = [x^n] w` for `n ≥ 1`, this is the closed form (D) again. Lagrange inversion is the *systematic* tool that also yields Fuss–Catalan from `c = 1 + x c^k` (Section 9): the same computation with `φ(w) = (1+w)^k` gives `\frac{1}{(k-1)n+1}\binom{kn}{n}`. This is why the generating-function route is preferred for *generalizations* — one lemma, many families.

---

## 4. The Reflection Principle and the Closed Form

This is the combinatorial proof requested at this level: a clean bijection that counts the "bad" paths and subtracts them.

**Setup.** Identify a Dyck path with a monotone lattice path of `n` up-steps and `n` down-steps. The total number of such step-sequences, *ignoring* the non-negativity constraint, is `C(2n, n)` (choose which `n` of the `2n` positions are up-steps). A path is **good** (a Dyck path) if it never goes below the x-axis, and **bad** otherwise. So

```
C_n = #good = C(2n, n) − #bad.
```

**Theorem 4.1 (Reflection / André's argument).** The number of bad paths equals `C(2n, n+1)`. Hence

```
C_n = C(2n, n) − C(2n, n+1).
```

*Proof.* A bad path touches height `−1` at some point. Let `t` be the **first** time the path reaches height `−1` (so the step into `t` is a down-step ending at `y = −1`). **Reflect** the portion of the path *after* time `t` across the horizontal line `y = −1`: every up-step becomes a down-step and vice versa, for steps `t+1, …, 2n`.

The reflected path still starts at `(0,0)` but now ends at a different height. Originally the path ends at `y = 0`, having taken `n` up and `n` down steps. After reflecting the suffix (which began at height `−1`), the number of up- and down-steps in the suffix is swapped. A short count shows the reflected path ends at `(2n, −2)`, i.e. it uses `n − 1` up-steps and `n + 1` down-steps in total.

This reflection is a **bijection** between bad paths (ending at height `0`, first touching `−1`) and *all* lattice paths from `(0,0)` to `(2n, −2)` (which automatically touch `−1` since they end below it, so the "first touch of `−1`" is well-defined and reflecting back recovers the original). The number of unconstrained paths to `(2n, −2)` — i.e. with `n+1` down-steps among `2n` — is `C(2n, n+1)`. Therefore `#bad = C(2n, n+1)`, giving (S). ∎

### 4.1 Why the reflection is a bijection (the careful part)

The map "reflect after first touch of `−1`" is its own inverse on the relevant sets. Given any path `Q` ending at `(2n, −2)`, it must cross `y = −1` (it ends at `−2 < −1`), so it has a first touch of `−1` at some time `t`; reflecting `Q`'s suffix after `t` produces a path ending at `0` whose first touch of `−1` is still `t` (the prefix up to `t` is unchanged, and the suffix now stays — by reflection — consistent with a bad path). Applying the map twice returns the original. A self-inverse map between two finite sets is a bijection, so the two sets are equinumerous. ∎

### 4.2 Worked reflection for `n = 2`

`C(4, 2) = 6` total step-sequences of two `U` and two `D`. List them and flag the bad ones (those whose running height goes to `−1`):

```
UUDD  heights 1,2,1,0   good
UDUD  heights 1,0,1,0   good
UDDU  heights 1,0,-1,0  BAD  (touches -1 at step 3)
DUUD  heights -1,...    BAD  (touches -1 at step 1)
DUDU  heights -1,...    BAD
DDUU  heights -1,...    BAD
```

So `#good = 2 = C_2` and `#bad = 4`. The closed form predicts `#bad = C(4, 3) = 4`. ✓ And `C_2 = C(4,2) − C(4,3) = 6 − 4 = 2`. ✓ Reflecting the bad path `UDDU` (first touches `−1` at step 3) flips steps 4 onward: the last `U` becomes `D`, giving `UDDD`, a path to height `−2` — one of the `C(4,3) = 4` paths to `(4, −2)`. The bijection is concrete.

### 4.2a A second worked reflection (`n = 3`)

For `n = 3`, total sequences `C(6,3) = 20`, predicted bad count `C(6,4) = 15`, so `C_3 = 20 − 15 = 5`. ✓ Trace one reflection: the bad path `U D D U U D` has running heights `1, 0, −1, 0, 1, 0` and first touches `−1` at step 3. Reflect steps 4–6 (`U U D`) across `y = −1`, swapping each: `U U D → D D U`. The reflected sequence `U D D D D U` has heights `1, 0, −1, −2, −3, −2`, ending at `−2`. It uses two up-steps and four down-steps — one of the `C(6,4) = 15` paths to `(6, −2)`. Reflecting *again* the suffix after the first touch of `−1` (still step 3) recovers `U D D U U D`, confirming the map is an involution. The careful point: the *prefix* up to and including the first touch of `−1` is never altered, which is what makes "first touch" well-defined on both sides and the map self-inverse.

### 4.2b Why the barrier is `y = −1`, not `y = 0`

A subtle but essential modeling choice: a Dyck path may *touch* `y = 0` freely (every path returns there), so the forbidden event is reaching `y = −1`, one below the axis. Reflecting across `y = −1` (not `y = 0`) is what sends end-height `0` to end-height `−2 = 2·(−1) − 0`. Reflecting across `y = 0` would mis-count, because touching `0` is allowed. This off-by-one in the barrier height is the most common error when re-deriving the reflection principle, and it is why the bad count is `C(2n, n+1)` (end-height `−2`) rather than `C(2n, n)` shifted naively.

### 4.3 From subtraction form to division form (algebra)

```
C(2n, n) − C(2n, n+1) = \frac{(2n)!}{n!\,n!} − \frac{(2n)!}{(n+1)!\,(n−1)!}
= \frac{(2n)!}{n!\,(n−1)!}\left(\frac{1}{n} − \frac{1}{n+1}\right)
= \frac{(2n)!}{n!\,(n−1)!} · \frac{1}{n(n+1)}
= \frac{(2n)!}{(n+1)!\,n!} = \frac{1}{n+1}\binom{2n}{n}.
```

So (S) and (D) are algebraically identical. The reflection principle gives (S) combinatorially; this one-line factorization converts it to the familiar (D). ∎

---

## 5. The Cycle Lemma (Dvoretzky–Motzkin) — A Second Closed-Form Proof

The cycle lemma proves (D) directly with an elegant counting-of-rotations argument, complementary to reflection.

**Lemma 5.1 (Cycle lemma).** Let `a_1, …, a_m` be a sequence of `+1`s and `−1`s with total sum `k > 0`. Then exactly `k` of the `m` cyclic rotations of the sequence have *all* partial sums positive.

**Application to Catalan.** Consider sequences of `n` up-steps `(+1)` and `n+1` down-steps `(−1)`, of length `2n+1`, with total sum `−1`... we instead apply it to the standard "ballot" encoding. Take sequences of `n+1` steps of `+1` and `n` steps of `−1` (sum `+1`); there are `C(2n+1, n)` such sequences. By the cycle lemma with `k = 1`, exactly **one** rotation of each has all partial sums positive. Grouping the `C(2n+1, n)` sequences into rotation classes of size `2n+1`, the number with all partial sums positive is

```
\frac{1}{2n+1} C(2n+1, n).
```

A short reindex (`\frac{1}{2n+1}\binom{2n+1}{n} = \frac{1}{n+1}\binom{2n}{n}`, by `\binom{2n+1}{n} = \frac{2n+1}{n+1}\binom{2n}{n}`) shows this equals `C_n`. ∎

**Worked rotation count (`n = 2`).** Sequences of three `+1` and two `−1` number `C(5, 2) = 10`. Each rotation class has size `5`, and the cycle lemma says exactly one member per class has all partial sums positive, so there are `10 / 5 = 2` "good" sequences — matching `C_2 = 2`. The two good ones are `+ + − + −` and `+ + + − −` (every prefix sum stays `≥ 1`). The cycle lemma is the slickest proof of (D) because it requires neither generating functions nor reflection — just averaging over rotations.

### 5.1 Proof of the cycle lemma

*Proof.* Let `S = (a_1, …, a_m)` with sum `k > 0`, each `a_i ∈ {+1, −1, …}` (here `±1`). Plot the partial sums `s_0 = 0, s_1, …, s_m = k` as a path. A rotation by `j` starts the path at index `j`; its partial sums are `s_{j+t} − s_j` (indices mod `m`, with the total `k` added on wraparound). A rotation has all partial sums positive iff index `j` is a *strict left-to-right minimum* of the extended path `s_0, s_1, …, s_{m-1}, s_m, s_{m+1}, …` (where `s_{m+i} = k + s_i`). Because the path rises by net `k` over each period, there are exactly `k` such minima per period — one for each of the `k` "lowest fresh levels" the path achieves. Hence exactly `k` rotations are good. ∎

### 5.2 Worked minima (`n = 2`, rotation classes)

Take the class of `+ + − + −` (sum `+1`, so `k = 1`, exactly one good rotation). Its partial sums are `0, 1, 2, 1, 2, 1`. The five rotations and their "all-positive?" test:

```
rot 0: + + − + −   sums 1,2,1,2,1   all > 0   ✓  GOOD
rot 1: + − + − +   sums 1,0,...      hits 0    ✗
rot 2: − + − + +   sums -1,...                 ✗
rot 3: + − + + −   sums 1,0,...      hits 0    ✗
rot 4: − + + − +   sums -1,...                 ✗
```

Exactly one good rotation, as the lemma predicts for `k = 1`. Across all `10/5 = 2` rotation classes, the count of good sequences is `2 = C_2`. The cycle lemma thus reduces a counting problem to "average over rotations", a technique that recurs in proving formulas for tree enumerations, parking functions, and ballot-type identities.

---

## 6. Equivalence of the Forms (Recurrence ⟺ Closed Form)

We have: (R) ⟹ OGF `c(x) = 1 + xc^2` (Section 3) ⟹ closed form (D) (Theorem 3.4). And reflection (Section 4) and the cycle lemma (Section 5) prove (S)/(D) directly from the combinatorics. To close the loop we verify the closed form **satisfies** the recurrence, an independent confirmation.

**Theorem 6.1.** If `C_n = \frac{1}{n+1}\binom{2n}{n}`, then `C_{n+1} = Σ_{i=0}^{n} C_i C_{n-i}`.

*Proof (generating-function route, cleanest).* Let `c(x) = Σ C_n x^n` with `C_n = \frac{1}{n+1}\binom{2n}{n}`. By Theorem 3.4 this `c(x) = (1 − √(1−4x))/(2x)`. Compute `x c(x)^2`:

```
x c^2 = x · \frac{(1 − √(1−4x))^2}{4x^2} = \frac{1 − 2√(1−4x) + (1−4x)}{4x} = \frac{2 − 4x − 2√(1−4x)}{4x}
      = \frac{1 − 2x − √(1−4x)}{2x} = \frac{1 − √(1−4x)}{2x} − 1 = c(x) − 1.
```

So `c = 1 + xc^2`, whose `x^{n+1}` coefficient is precisely `C_{n+1} = Σ_i C_i C_{n-i}`. Hence the closed-form sequence satisfies (R). ∎

This bidirectional argument (R ⟹ D via Section 3; D ⟹ R via Theorem 6.1) establishes that the recurrence and closed form define the *same* sequence, with the generating function as the bridge in both directions.

### 6.1 Direct algebraic verification (no generating function)

For readers who prefer a hands-on check, verify `Σ_{i=0}^{n} \frac{1}{i+1}\binom{2i}{i}\frac{1}{n-i+1}\binom{2(n-i)}{n-i} = \frac{1}{n+2}\binom{2n+2}{n+1}` for small `n`. At `n = 2`:

```
LHS = C_0 C_2 + C_1 C_1 + C_2 C_0 = 1·2 + 1·1 + 2·1 = 5,
RHS = C_3 = \frac{1}{4}\binom{6}{3} = \frac{20}{4} = 5.   ✓
```

At `n = 3`:

```
LHS = C_0C_3 + C_1C_2 + C_2C_1 + C_3C_0 = 5 + 2 + 2 + 5 = 14 = C_4.   ✓
```

The general identity is the Vandermonde-type convolution `Σ_i \binom{2i}{i}\binom{2n-2i}{n-i} = 4^n` combined with the `1/(i+1)` weights; the generating-function proof (Theorem 6.1) is far cleaner than the direct binomial manipulation, which is precisely why the OGF is the tool of choice for such convolution identities.

### 6.2 Why three independent proofs matter

We now have three logically independent derivations of the closed form: **reflection** (Section 4, combinatorial), the **cycle lemma** (Section 5, rotation-averaging), and the **generating function** (Section 3, algebraic). Independence is valuable: a generalization that breaks one proof often survives another. The reflection principle extends to *any barrier* (ballot numbers, Section 9.3); the cycle lemma extends to *any rotation-symmetric* counting (parking functions, `k`-ary trees); the generating function extends to *any algebraic* structure (Fuss–Catalan, Motzkin, Schröder). Knowing which proof to generalize is the analytic judgment that separates pattern-matching from genuine combinatorial reasoning.

---

## 7. Bijections Among the Catalan Structures

The deepest "why so many objects" is a web of explicit bijections. We record the canonical ones; each is a structure-preserving inverse pair, so all sets have size `C_n`.

**Theorem 7.1 (Dyck paths ⟷ balanced parentheses).** Map `U ↦ (`, `D ↦ )`. Non-negativity of the path is exactly the prefix condition `#( ≥ #)`. Bijection. ∎

**Theorem 7.2 (Balanced parentheses ⟷ binary trees, `n` pairs ⟷ `n` internal nodes).** Recursively: `ε ↦` empty tree; `( A ) B ↦` node with left subtree `T(A)`, right subtree `T(B)`, where `( A ) B` is the first-return decomposition. The inverse reads a tree's left/right subtrees back into `A` and `B`. Bijection. ∎

**Theorem 7.3 (Binary trees ⟷ triangulations of an `(n+2)`-gon).** Fix a base edge of the polygon. The unique triangle on that edge has a third vertex that splits the polygon into a left sub-polygon and a right sub-polygon; recurse. This matches the root/left/right structure of a binary tree. Bijection. ∎

**Theorem 7.4 (Dyck paths ⟷ 231-avoiding permutations).** A stack-sortable permutation corresponds to a sequence of pushes (`U`) and pops (`D`) on a single stack; the requirement that the output is sorted is exactly the Dyck (balance) condition, and "stack-sortable ⟺ avoids the pattern 231" (Knuth). Bijection. ∎

```mermaid
graph LR
    DP["Dyck paths 𝒟_n"] -->|"U↦( D↦)"| BP["Balanced parens"]
    BP -->|"first-return ( A ) B"| BT["Binary trees (n nodes)"]
    BT -->|"base-edge triangle"| TR["Triangulations of (n+2)-gon"]
    DP -->|"push/pop on one stack"| SP["231-avoiding perms"]
    BT -->|"non-crossing chords"| NC["Non-crossing partitions"]
    DP -.|"all size C_n"| TR
```

**Theorem 7.5 (Non-crossing structures).** Non-crossing partitions of `[n]`, non-crossing chord diagrams on `2n` points, and non-crossing handshakes are all in bijection with binary trees via the planar (non-crossing) embedding of the recursive split. The "non-crossing" constraint is the geometric encoding of "balance". ∎

The unifying principle (Section 2): **every Catalan object decomposes uniquely at a distinguished feature (first return / root / base edge) into two independent smaller objects of the same kind**, which forces the convolution recurrence and hence the common count `C_n`.

### 7.1 A worked bijection trace (`n = 3`)

Take the balanced string `(()())`. First-return decomposition: the opening `(` at position 0 closes at the matching `)` at position 5 (the whole string is one arch), so `A = ()()` (positions 1–4) and `B = ε` (empty). Recurse on `A = ()()`: its first `(` closes immediately, so `A = ( ε ) ()` with inner `ε` and tail `()`. The resulting binary tree:

```
        •            root (the outer arch)
       /
      •              left subtree from A = ()()
       \
        •            right child of A's first node, from tail ()
```

The right subtree of the root is empty (because `B = ε`). Reading this tree back to a Dyck path (Theorem 7.1) and to a pentagon triangulation (Theorem 7.3) gives three different drawings of the *same* combinatorial object — exactly what the animation toggles between. Tracing one such object across all interpretations is the most effective way to internalize that the bijections are genuine identities, not coincidences.

### 7.2 The Catalan triangle and Hankel determinant (structural identities)

Two deeper identities reward the professional reader:

- **Catalan's triangle.** The ballot numbers `B(n, k)` (Section 9) arranged in a triangle have row sums and diagonals equal to Catalan numbers; the entries satisfy `B(n,k) = B(n,k-1) + B(n-1,k)`, a Pascal-like recurrence whose boundary gives `C_n`.
- **Hankel determinant.** The Hankel matrix `H_n = (C_{i+j})_{0 ≤ i,j ≤ n}` has determinant **exactly 1** for every `n` (`det H_n = 1`), and the shifted Hankel `(C_{i+j+1})` also has determinant `1`. This is a hallmark of the Catalan moment sequence (they are the moments of the semicircle distribution), and it connects Catalan numbers to orthogonal polynomials and continued fractions (sibling `18-continued-fractions`): the continued-fraction expansion of `c(x)` has all partial numerators equal to `x`. These determinant identities are used to *prove* a sequence is Catalan-like and to derive lattice-path determinant formulas (Lindström–Gessel–Viennot).

---

## 8. Asymptotics: `C_n ~ 4^n / (n^{3/2} √π)`

**Theorem 8.1.** `C_n = \frac{4^n}{n^{3/2} √π} (1 + O(1/n))`. In particular `C_n ~ \frac{4^n}{n^{3/2}√π}`.

*Proof.* Start from `C_n = \frac{1}{n+1}\binom{2n}{n}`. By **Stirling's approximation** `m! = √(2πm)(m/e)^m (1 + O(1/m))`:

```
\binom{2n}{n} = \frac{(2n)!}{(n!)^2}
= \frac{√(4πn)(2n/e)^{2n}}{2πn (n/e)^{2n}} (1 + O(1/n))
= \frac{√(4πn)\, 2^{2n} (n/e)^{2n}}{2πn (n/e)^{2n}} (1 + O(1/n))
= \frac{2^{2n}√(4πn)}{2πn}(1 + O(1/n))
= \frac{4^n}{√(πn)}(1 + O(1/n)).
```

Therefore

```
C_n = \frac{1}{n+1}\binom{2n}{n} = \frac{1}{n+1}·\frac{4^n}{√(πn)}(1 + O(1/n)) = \frac{4^n}{n^{3/2}√π}(1 + O(1/n)),
```

using `\frac{1}{n+1} = \frac{1}{n}(1 + O(1/n))` and `\frac{1}{n}·\frac{1}{√n} = n^{-3/2}`. ∎

### 8.1 Consequences

- **Growth rate.** `C_{n+1}/C_n = \frac{2(2n+1)}{n+2} → 4` as `n → ∞`. Each step asymptotically quadruples the count.
- **Entropy / encoding.** A Dyck path of semilength `n` carries `log_2 C_n ≈ 2n − \frac{3}{2}\log_2 n − O(1)` bits; the `2n` is the naive "two choices per step", and the `−\frac{3}{2}\log_2 n` is the *saving* from the balance constraint. This is the information-theoretic reason succinct data structures for balanced parentheses achieve `2n + o(n)` bits.
- **Infeasibility of enumeration.** `C_{20} ≈ 6.6×10^9`, `C_{30} ≈ 3.8×10^{15}`: any algorithm that *enumerates* Catalan structures is exponential and unusable past `n ≈ 25`, which is exactly why DP (polynomial in `n`) is required when the *count* or an *optimum over* the structures is needed (sibling `13-dynamic-programming`).

### 8.2 Worked asymptotic check

For `n = 10`: exact `C_10 = 16796`. The approximation `4^{10}/(10^{1.5}√π) = 1048576/(31.62·1.7725) = 1048576/56.05 ≈ 18708`. The ratio `18708/16796 ≈ 1.114`, an ~11% overestimate, consistent with the `O(1/n)` correction (~10% at `n = 10`). At `n = 100` the relative error drops to ~1%, confirming the asymptotic.

### 8.3 The refined asymptotic and where the correction comes from

A second-order Stirling expansion sharpens the estimate:

```
C_n = \frac{4^n}{n^{3/2}√π}\left(1 − \frac{9}{8n} + \frac{145}{128 n^2} − …\right).
```

The leading correction `−\frac{9}{8n}` is the source of the ~11% gap at `n = 10` (`9/80 ≈ 0.1125`). For `n = 10`, `18708·(1 − 0.1125) ≈ 16604`, far closer to the true `16796` (the next term `+\frac{145}{12800} ≈ 0.0113` recovers most of the remaining gap: `18708·(1 − 0.1125 + 0.0113) ≈ 16816`). This expansion matters in practice when using the asymptotic as a *fast estimate* of `C_n` (e.g. to pre-size a buffer or decide feasibility) without computing the exact value — the leading term alone overestimates by ~`9/(8n)`, so a single correction term suffices below `n ≈ 50`.

### 8.4 The singularity-analysis viewpoint

Analytic combinatorics derives the asymptotic *directly* from the generating function without Stirling: `c(x) = (1 − √(1−4x))/(2x)` has its dominant singularity at `x = 1/4` (where `1 − 4x = 0`), of square-root type. The transfer theorem then maps the local behavior `√(1−4x)` near `x = 1/4` to coefficient asymptotics `[x^n] ~ \frac{4^n}{n^{3/2}√π}`: the singularity *location* `1/4` gives the exponential base `4^n`, and the square-root *type* gives the `n^{-3/2}` polynomial factor. This is the principled reason every Catalan-like sequence with a square-root singularity grows like `ρ^{-n} n^{-3/2}` — the `n^{-3/2}` is a universal signature of "two independent halves" branching structures, distinguishing them from the `n^{-1/2}` of unconstrained `\binom{2n}{n}`.

---

## 9. Generalizations: Fuss–Catalan, Narayana, Ballot

**Theorem 9.1 (Fuss–Catalan).** The number of `k`-ary trees with `n` internal nodes (equivalently, the coefficients of the OGF satisfying `c = 1 + x c^k`) is

```
C_n^{(k)} = \frac{1}{(k-1)n + 1}\binom{kn}{n}.
```

For `k = 2` this is the ordinary Catalan number. *Proof sketch.* The functional equation `c = 1 + x c^k` (the `k`-ary first-return split into `k` independent subtrees) is solved by Lagrange inversion, which extracts `[x^n] c = \frac{1}{(k-1)n+1}\binom{kn}{n}`. ∎

**Theorem 9.2 (Narayana refinement).** The number of Dyck paths of semilength `n` with exactly `k` peaks (a `UD` factor) is the **Narayana number**

```
N(n, k) = \frac{1}{n}\binom{n}{k}\binom{n}{k-1}, \qquad Σ_{k=1}^{n} N(n,k) = C_n.
```

So Catalan is the "total" and Narayana is its refinement by a statistic. *Proof sketch.* A direct bijection or a generating-function argument with a peak-marking variable; the row sums telescope to (D). ∎

**Theorem 9.3 (Ballot numbers).** The number of lattice paths from `(0,0)` to `(a, b)` with `a ≥ b ≥ 0`, staying weakly below the main diagonal, is

```
B(a, b) = \frac{a − b + 1}{a + 1}\binom{a+b}{b}.
```

Catalan is `B(n, n) = \frac{1}{n+1}\binom{2n}{n}`. The reflection principle of Section 4 proves the general ballot formula verbatim (reflect bad paths across the barrier). ∎

These three generalizations all flow from the same two tools: a functional equation (`c = 1 + xc^k`) solved by Lagrange inversion, and the reflection principle for the barrier count. Recognizing which generalization a problem needs — `k`-ary vs refined-by-statistic vs shifted-endpoint — is the analytic skill the senior file frames operationally.

### 9.1 Worked Narayana refinement (`n = 4`)

The Narayana numbers for `n = 4` (Dyck paths of semilength 4 by peak count) are

```
N(4,1) = (1/4)C(4,1)C(4,0) = (1/4)·4·1 = 1
N(4,2) = (1/4)C(4,2)C(4,1) = (1/4)·6·4 = 6
N(4,3) = (1/4)C(4,3)C(4,2) = (1/4)·4·6 = 6
N(4,4) = (1/4)C(4,4)C(4,3) = (1/4)·1·4 = 1
```

Row sum `1 + 6 + 6 + 1 = 14 = C_4`. ✓ The single Dyck path with one peak is `UUUUDDDD` (a single mountain); the lone path with four peaks is `UDUDUDUD` (four small bumps); the middle counts `6 + 6` are paths with two and three peaks. The symmetry `N(n,k) = N(n,n+1-k)` reflects the up-down reversal of Dyck paths. This refinement is the prototype for "count Catalan structures *with exactly k of some feature*" — recognize it whenever a problem fixes a secondary statistic.

### 9.2 The unified functional-equation table

| Family | Functional equation | Lagrange `φ(w)` | Coefficient |
|--------|---------------------|------------------|-------------|
| Catalan | `c = 1 + xc^2` | `(1+w)^2` | `\frac{1}{n+1}\binom{2n}{n}` |
| Fuss–Catalan (`k`-ary) | `c = 1 + xc^k` | `(1+w)^k` | `\frac{1}{(k-1)n+1}\binom{kn}{n}` |
| Motzkin | `c = 1 + xc + x^2 c^2` | — | recurrence `M_n` |
| (large) Schröder | `c = 1 + xc + x c^2` | — | recurrence `S_n` |

The first two rows are pure Lagrange inversion; Motzkin and Schröder have an extra linear (`xc`) term encoding the flat/diagonal step, which breaks the clean binomial coefficient. The structural lesson: **the *number of terms* in the functional equation counts the *step types*, and only the two-term `1 + xc^k` family has a closed binomial coefficient.**

---

## 10. Modular and Computational Foundations

**Proposition 10.1 (Defining modular identity).** For prime `p` with `n + 1 < p` (so `(n+1)` is invertible mod `p`),

```
C_n ≡ \binom{2n}{n} · (n+1)^{-1} (mod p),
```

and equivalently `C_n ≡ \binom{2n}{n} − \binom{2n}{n+1} (mod p)`. The two agree because the algebraic identity of Section 4.3 holds over any field, in particular `ℤ/pℤ`.

**Proposition 10.2 (Integrality).** `C_n = \frac{1}{n+1}\binom{2n}{n}` is always an integer. *Proof.* `(n+1) | \binom{2n}{n}` because `\binom{2n}{n} − \binom{2n}{n+1} = C_n` is an integer (subtraction form, Section 4) and `\binom{2n}{n+1} = \frac{n}{n+1}\binom{2n}{n}`, so `\binom{2n}{n}(1 − \frac{n}{n+1}) = \frac{1}{n+1}\binom{2n}{n}` is the integer `C_n`. ∎ This is *why* the modular division by `(n+1)` is legitimate in `ℤ` and must be realized by a modular inverse in `ℤ/pℤ`.

**Proposition 10.3 (The `n+1 ≥ p` corner).** When `n + 1 ≥ p`, `(n+1)!` is divisible by `p`, the naive inverse-factorial vanishes, and the closed form must be evaluated by **Lucas' theorem** (sibling `24-lucas-theorem`) on each binomial, with the factor of `p` in `(n+1)` tracked via Legendre's formula for `v_p(C_n)`. The `p`-adic valuation `v_p(C_n) = v_p\binom{2n}{n} − v_p(n+1)` is computed by Kummer's theorem (carries when adding `n + n` in base `p`).

**Proposition 10.4 (Generating-function convolution).** Because `c(x)^2 = (c(x) − 1)/x`, computing `C_0, …, C_N` via the recurrence is a self-convolution; evaluated naively it is `O(N²)`, but online convolution / NTT (sibling `15-ntt`) over a suitable prime computes the whole prefix in `O(N log² N)`, and the factorial closed form computes each value in `O(1)` after `O(N)` precompute (the method of choice in practice — sibling `33-factorial-mod-p`).

**Proposition 10.5 (Square root of the generating function via NTT).** Since `c = (1 − √(1−4x))/(2x)`, one can compute the first `N` Catalan numbers by computing the power series `√(1 − 4x)` mod `x^N` (Newton iteration, `O(N log N)` per doubling step using NTT — sibling `15-ntt`), then dividing by `2x`. This is the fastest known prefix computation when a closed-form factorial is unavailable (e.g. for *compositions* of Catalan-like generating functions), and it generalizes to extracting `[x^n]` of any algebraic generating function.

**Proposition 10.6 (`p`-adic valuation, worked).** By Kummer's theorem `v_p\binom{2n}{n}` is the number of carries when adding `n + n` in base `p`. Take `p = 3`, `n = 4`: in base 3, `4 = (11)_3`, and `(11)_3 + (11)_3 = (22)_3` with **no carry**, so `v_3\binom{8}{4} = 0` — indeed `\binom{8}{4} = 70 = 2·5·7` is not divisible by 3. Then `v_3(C_4) = v_3(70) − v_3(5) = 0 − 0 = 0`, consistent with `C_4 = 14 = 2·7`. For `p = 2`, `n = 4`: `4 = (100)_2`, `(100)_2 + (100)_2 = (1000)_2` with one carry, so `v_2\binom{8}{4} = 1`; `v_2(C_4) = 1 − v_2(5) = 1`, matching `C_4 = 14 = 2·7`. This valuation arithmetic is exactly what is needed to evaluate `C_n mod p^k` and to handle the `n + 1 ≡ 0 (mod p)` corner without losing the factor of `p` (Prop 10.3).

**Proposition 10.7 (Worked modular evaluation, `n = 3`, `p = 11`).** Both modular forms must yield the same residue; tracing them by hand exposes exactly where the inverse enters. Division form: `\binom{6}{3} = 20 ≡ 9 (mod 11)`, and `(n+1)^{-1} = 4^{-1} ≡ 3 (mod 11)` (since `4·3 = 12 ≡ 1`), so `C_3 ≡ 9·3 = 27 ≡ 5 (mod 11)`. ✓ Subtraction form: `\binom{6}{3} − \binom{6}{4} = 20 − 15 = 5 ≡ 5 (mod 11)` directly, *without any inverse*. ✓ Both give `C_3 = 5`. The contrast is instructive: the subtraction form (S) sidesteps the modular inverse entirely (it only ever divides by factorials, all invertible when `2n < p`), which is why it is the safer default when `n+1` risks sharing a factor with a small modulus. The division form is preferred only when a precomputed `invfact` table already exists and the extra binomial of (S) is not worth a second lookup.

**Proposition 10.8 (Even-index parity and the central identity).** A frequently exploited consequence of (D) is `\binom{2n}{n} = (n+1)C_n`, i.e. the central binomial is `(n+1)` times the Catalan number. This gives a one-line *integrality certificate* used in code review (assert `(n+1)·C_n == \binom{2n}{n}` exactly or mod `p`, sibling senior file §8.2) and a fast recurrence avoiding any binomial: `C_{n} = \frac{2(2n-1)}{n+1} C_{n-1}`, derived by dividing consecutive central binomials. The factor `2(2n-1)/(n+1)` is always an integer multiple in the sense that the running product stays integral — the cleanest exact incremental formula, and the one the senior file recommends for the `int64` regime (`n ≤ 35`).

---

## 11. Summary

- **Definition and three forms (Theorem 1.2).** `C_n` is defined by the convolution `C_{n+1} = Σ C_i C_{n-i}` (R), and equals `\frac{1}{n+1}\binom{2n}{n}` (D) `= \binom{2n}{n} − \binom{2n}{n+1}` (S).
- **First-return decomposition (Theorem 2.1).** Every Catalan object splits uniquely into two independent smaller objects, forcing the convolution; this is the structural reason "one sequence, many objects".
- **Generating function (Theorems 3.2–3.4).** The recurrence is the functional equation `c(x) = 1 + x c(x)^2`, solved by `c(x) = (1 − √(1−4x))/(2x)`, whose binomial expansion yields (D).
- **Reflection principle (Theorem 4.1).** Bad lattice paths are in bijection (reflect after first touch of `−1`) with paths to `(2n, −2)`, numbering `\binom{2n}{n+1}`, giving the subtraction form (S); algebra (Section 4.3) converts it to (D).
- **Cycle lemma (Lemma 5.1).** A second, rotation-averaging proof of (D): exactly one rotation per class is "good", so `C_n = \frac{1}{2n+1}\binom{2n+1}{n}`.
- **Equivalence (Theorem 6.1).** The closed form satisfies the recurrence (verified through the OGF), closing the loop R ⟺ D.
- **Bijections (Theorems 7.1–7.5).** Dyck paths, balanced parentheses, binary trees, triangulations, 231-avoiding permutations, and non-crossing partitions are mutually bijective — all `C_n`.
- **Asymptotics (Theorem 8.1).** `C_n ~ 4^n / (n^{3/2}√π)` via Stirling; `C_{n+1}/C_n → 4`; enumeration is exponential, mandating DP.
- **Generalizations (Theorems 9.1–9.3).** Fuss–Catalan (`k`-ary, `c = 1 + xc^k`), Narayana (refinement by peaks, sums to `C_n`), and ballot numbers (shifted endpoint, reflection) extend the theory.
- **Modular foundations (Props. 10.1–10.4).** `C_n ≡ \binom{2n}{n}(n+1)^{-1} (mod p)`; integrality justifies the division; the `n+1 ≥ p` corner needs Lucas; convolution is `O(1)`/value after `O(N)` factorial precompute.

### Theorem-Dependency Cheat Table

| Result | Depends on | Used by |
|--------|-----------|---------|
| Recurrence (R) | first-return decomposition | OGF, DP, all interpretations |
| OGF `c = 1 + xc^2` | (R) + Cauchy product | closed form (D), Fuss–Catalan |
| Closed form (D) | OGF binomial expansion / cycle lemma | computation, asymptotics, modular |
| Subtraction form (S) | reflection principle | (D) via algebra, ballot numbers |
| Asymptotic | Stirling on (D) | feasibility / encoding bounds |
| Bijections | first-return / root split | "one number, many objects" |
| Modular identity | (D) + integrality (Prop 10.2) | `C_n mod p`, precompute |

### Closing Notes

- **One decomposition, everything else.** The first-return / root split (Section 2) is the single structural fact; the convolution, the generating function, the bijections, and the count all descend from it.
- **Two proofs of the closed form.** Reflection (combinatorial, gives (S)) and the cycle lemma (rotation-averaging, gives (D)) are independent; the generating function is the algebraic third route. Knowing all three is the mark of mastery.
- **The constraint is the content.** Removing the non-negativity constraint turns `C_n` into `\binom{2n}{n}`; the reflection principle is precisely the accounting of how many sequences the constraint forbids.
- **Asymptotics dictate engineering.** `C_n ~ 4^n` means enumerate-to-count is hopeless and `mod p` / DP is mandatory at scale — the bridge to the senior file.
- **Choose the proof you can generalize.** Reflection generalizes to arbitrary barriers (ballot numbers), the cycle lemma to rotation-symmetric counts (`k`-ary trees, parking functions), and the generating function to any algebraic structure (Fuss–Catalan, Motzkin, Schröder). When a Catalan-shaped problem mutates, the right move is to reach for the proof whose hypotheses still hold, not to re-derive from scratch.

Foundational references: Stanley, *Enumerative Combinatorics, Vol. 2* (the Catalan addendum, 200+ interpretations and bijections); Aigner, *A Course in Enumeration* (generating functions, cycle lemma); Flajolet & Sedgewick, *Analytic Combinatorics* (the asymptotic via singularity analysis of `√(1−4x)`); Dvoretzky & Motzkin (1947) for the cycle lemma. Sibling topics: `23-binomial-coefficients`, `24-lucas-theorem`, `33-factorial-mod-p`, `15-ntt`, `05-fermat-euler`, `13-dynamic-programming`.

---

Next step: [`interview.md`](./interview.md) — tiered question bank and coding challenges in Go, Java, and Python covering the recurrence, closed form, modular computation, and the interpretation bijections.

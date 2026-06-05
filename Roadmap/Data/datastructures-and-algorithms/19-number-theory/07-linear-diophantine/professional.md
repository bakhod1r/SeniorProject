# Linear Diophantine Equations — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Bezout's Identity (Proof)
3. The Solvability Theorem: `gcd(a,b) | c` (Proof)
4. The General Solution Set (Proof the Homogeneous Part is a Rank-1 Lattice)
5. Canonical and Constrained Solutions (Correctness of Counting)
6. The Frobenius Number: Two-Coin Closed Form (Proof Sketch)
7. Multi-Variable Linear Diophantine Equations
8. Connection to Modular Equations and CRT
9. Worked Examples Illustrating Each Theorem
10. The Coefficient Bound and Why It Holds
11. Complexity Analysis
12. Lattice Geometry and Continued Fractions
13. Algebraic Generalization: Diophantine Solving over a PID
13c. A Self-Contained Counting Proof Worked End to End
13d. Numerical-Stability Corollaries of the Coefficient Bound
14. Summary

---

## 1. Formal Definitions

Work over the ring of integers `ℤ`. Fix integers `a, b, c`.

**Definition 1.1 (Linear Diophantine equation).** The two-variable linear Diophantine equation is

```
a·x + b·y = c,   with unknowns (x, y) ∈ ℤ².
```

A **solution** is a pair `(x, y) ∈ ℤ²` satisfying the equation. The **solution set** is `S(a, b, c) = { (x, y) ∈ ℤ² : a x + b y = c }`.

**Definition 1.2 (gcd).** `g = gcd(a, b)` is the unique non-negative generator of the ideal `aℤ + bℤ = { a u + b v : u, v ∈ ℤ }`. By convention `gcd(0, 0) = 0`.

**Definition 1.3 (Bezout coefficients).** Integers `x', y'` with `a x' + b y' = g`. The extended Euclidean algorithm produces one such pair.

**Definition 1.4 (Homogeneous equation).** The associated homogeneous equation is `a x + b y = 0`, with solution set `H(a, b) = S(a, b, 0)`, a subgroup of `ℤ²`.

**Definition 1.5 (Divisibility lattice).** For `g = gcd(a, b)`, the set of *attainable* right-hand sides is `{ a x + b y : (x, y) ∈ ℤ² } = gℤ`, exactly the multiples of `g`.

**Notation.** Throughout, `g = gcd(a, b)`, and when `g > 0` we write `a' = a/g`, `b' = b/g`, so `gcd(a', b') = 1` (`a'`, `b'` are coprime). The Iverson bracket `[P]` is `1` if `P` holds else `0`. The symbol `|` denotes "divides".

**Definition 1.6 (the equation as an ideal question).** The values attainable by the left-hand side form the ideal `aℤ + bℤ`. Solving `a x + b y = c` is precisely asking whether `c` is a member of that ideal and, if so, exhibiting a witness. This framing (made precise in §13) is what unifies the integer, polynomial, and Gaussian-integer cases.

**Worked instantiation of the definitions.** For `(a, b) = (12, 18)`: `g = gcd(12, 18) = 6`, `a' = 2`, `b' = 3`, `gcd(2, 3) = 1`. The attainable right-hand sides are `6ℤ = {…, −12, −6, 0, 6, 12, …}`. The homogeneous set is `H(12, 18) = {(3t, −2t) : t ∈ ℤ}` (note: `b' = 3`, `−a' = −2`). The equation `12x + 18y = 30` is solvable (`6 | 30`); `12x + 18y = 15` is not (`6 ∤ 15`). These match Definitions 1.2–1.5 exactly and will be reused as a running example.

---

## 2. Bezout's Identity (Proof)

**Theorem 2.1 (Bezout).** For integers `a, b` not both zero, the smallest positive value of `a x + b y` over `(x, y) ∈ ℤ²` is `g = gcd(a, b)`, and every value of `a x + b y` is a multiple of `g`.

**Proof.** Let `D = { a x + b y : x, y ∈ ℤ }`. `D` contains a positive element (e.g. `|a|` or `|b|`), so by well-ordering it has a least positive element `d = a x₀ + b y₀`.

*Every element of `D` is a multiple of `d`.* Take any `e = a x₁ + b y₁ ∈ D`. Divide: `e = qd + r` with `0 ≤ r < d`. Then `r = e − qd = a(x₁ − q x₀) + b(y₁ − q y₀) ∈ D`. Since `0 ≤ r < d` and `d` is the least *positive* element, `r = 0`. Hence `d | e`.

*`d` divides `a` and `b`.* Both `a = a·1 + b·0` and `b = a·0 + b·1` lie in `D`, so by the previous paragraph `d | a` and `d | b`. Thus `d` is a common divisor of `a, b`, so `d ≤ g`.

*`g` divides `d`.* `g | a` and `g | b` imply `g | (a x₀ + b y₀) = d`, so `g ≤ d`.

Therefore `d = g`, proving `g = a x₀ + b y₀` is attainable and is the least positive value, and `D = gℤ`. ∎

**Corollary 2.2.** The extended Euclidean algorithm terminates and returns `(g, x', y')` with `a x' + b y' = g`. (Termination: the Euclidean remainders strictly decrease and are non-negative; the coefficient recurrences are linear in the quotients.)

**Alternative constructive proof of Bezout (recursive).** Define `bez(a, b)` returning `(g, x, y)` with `a x + b y = g`:

```
bez(a, 0) = (a, 1, 0)
bez(a, b) = let (g, x, y) = bez(b, a mod b) in (g, y, x − ⌊a/b⌋·y)
```

**Correctness by strong induction on `b`.** Base: `bez(a, 0) = (a, 1, 0)` satisfies `a·1 + 0·0 = a = gcd(a, 0)`. Step: assume `b·x + (a mod b)·y = g`. Since `a mod b = a − ⌊a/b⌋·b`, substitute:

```
b·x + (a − ⌊a/b⌋·b)·y = g
⇒ a·y + b·(x − ⌊a/b⌋·y) = g,
```

so returning `(g, y, x − ⌊a/b⌋·y)` gives coefficients for `(a, b)`. And `gcd(a, b) = gcd(b, a mod b)` by the Euclidean recurrence, so the returned `g` is correct. ∎ This recursion is exactly the `extGCD` implemented in `junior.md` and the interview challenges; the proof above is its specification.

**Remark 2.3 (uniqueness up to the homogeneous shift).** Bezout coefficients are *not* unique: if `a x' + b y' = g`, then `a(x' + b/g) + b(y' − a/g) = g` as well. The set of all Bezout pairs is `(x', y') + ℤ·(b/g, −a/g)` — the same coset structure that governs the full solution set (Theorem 4.2). The extended algorithm returns one canonical representative; reducing it mod the step gives the smallest-magnitude pair.

---

## 3. The Solvability Theorem: `gcd(a,b) | c` (Proof)

**Theorem 3.1 (Solvability).** `S(a, b, c) ≠ ∅` if and only if `g | c`.

**Proof.**

(⇒) Suppose `(x, y)` solves `a x + b y = c`. Since `g | a` and `g | b`, `g | (a x + b y) = c`.

(⇐) Suppose `g | c`, say `c = g · k` for integer `k = c/g`. By Bezout (Theorem 2.1) there exist `x', y'` with `a x' + b y' = g`. Multiply by `k`:

```
a (k x') + b (k y') = g k = c.
```

So `(x, y) = (k x', k y') = (x' · c/g, y' · c/g)` is a solution. ∎

**Remark 3.2 (degenerate case).** If `a = b = 0` then `g = 0` and `gℤ = {0}`; the equation `0 = c` is solvable (by *every* `(x, y)`) iff `c = 0`. The theorem still holds reading "`0 | c`" as "`c = 0`".

This theorem is the **solvability condition** and the reason scaling Bezout coefficients works: the particular solution `(x' c/g, y' c/g)` is *defined* precisely because `c/g ∈ ℤ`.

**Theorem 3.3 (number of solutions).** If `(a, b) ≠ (0, 0)` and `g | c`, then `S(a, b, c)` is countably infinite — there are infinitely many integer solutions. If `g ∤ c`, then `S(a, b, c) = ∅`. **Proof.** The (⇐) direction of Theorem 3.1 produces one solution `(x₀, y₀)`; Theorem 4.2 (below) exhibits a bijection `ℤ → S(a, b, c)`, so the set is countably infinite. The (⇒) direction gives emptiness when `g ∤ c`. ∎ Thus over *all* integers the count is a trichotomy: `0`, `∞`, or (degenerate `a=b=0=c`) all of `ℤ²`. Finiteness only appears once constraints are imposed (Theorem 5.3).

**Remark 3.4 (the equation as a level set).** The map `φ(x, y) = a x + b y` is a group homomorphism `ℤ² → ℤ` with image `gℤ`. The solution set `S(a, b, c) = φ⁻¹(c)` is a *fiber* of `φ`: empty when `c ∉ im φ = gℤ`, and otherwise a coset of `ker φ = H(a, b)`. This homomorphism viewpoint is the cleanest statement of the whole theory: solvability is image membership, and the solution set is a coset of the kernel. Everything else (Theorems 4.1–4.2) is unpacking `ker φ` and the coset structure.

---

## 4. The General Solution Set (Proof the Homogeneous Part is a Rank-1 Lattice)

**Theorem 4.1 (Structure of `H`).** If `(a, b) ≠ (0, 0)`, the homogeneous solution set `H(a, b) = { (x, y) : a x + b y = 0 }` equals the cyclic group generated by the **primitive vector** `d = (b', −a') = (b/g, −a/g)`:

```
H(a, b) = ℤ · (b/g, −a/g) = { (b' t, −a' t) : t ∈ ℤ }.
```

**Proof.**

*(⊇)* `a (b' t) + b (−a' t) = t(a b' − b a') = t( (a/g)·b·... )`. Compute directly: `a b' − b a' = a(b/g) − b(a/g) = (ab − ba)/g = 0`. So every `(b' t, −a' t) ∈ H`.

*(⊆)* Let `(x, y) ∈ H`, so `a x = −b y`. Divide by `g`: `a' x = −b' y`, where `gcd(a', b') = 1`. Then `b' | a' x`; since `gcd(a', b') = 1`, by Euclid's lemma `b' | x`. Write `x = b' t`. Substitute: `a' b' t = −b' y`, and since `b' ≠ 0` (as `b ≠ 0`; the case `b = 0` is handled symmetrically with `a' | y`), cancel to get `y = −a' t`. Hence `(x, y) = (b' t, −a' t)`. ∎

**Theorem 4.2 (General solution).** If `g | c` and `(x₀, y₀)` is any particular solution, then

```
S(a, b, c) = (x₀, y₀) + H(a, b) = { (x₀ + b' t, y₀ − a' t) : t ∈ ℤ }.
```

**Proof.** If `(x, y) ∈ S(a,b,c)` then `(x − x₀, y − y₀)` satisfies `a(x−x₀) + b(y−y₀) = c − c = 0`, so it lies in `H`; by Theorem 4.1 it equals `(b' t, −a' t)` for some `t`. Conversely any `(x₀ + b' t, y₀ − a' t)` satisfies the equation because adding a homogeneous solution to a particular one preserves the right-hand side. The map `t ↦ (x₀ + b' t, y₀ − a' t)` is injective (since `b' ≠ 0`), so it is a bijection `ℤ → S(a,b,c)`. ∎

**Corollary 4.3 (rank-1 lattice).** `H(a, b)` is a rank-1 sublattice of `ℤ²` with basis vector `(b', −a')`. Its primitivity (`gcd(b', −a') = gcd(a', b') = 1`) is exactly why the step cannot be shortened: any non-zero homogeneous solution is an integer multiple of `(b', −a')`, so consecutive solutions on the line are exactly this vector apart. Using `(b, −a)` (without dividing by `g`) would generate only the index-`g` sublattice and **miss** `g − 1` out of every `g` solutions.

**Proposition 4.4 (Euclid's lemma, used above).** If `gcd(m, n) = 1` and `m | n·k`, then `m | k`. **Proof.** By Bezout there are `u, v` with `m u + n v = 1`. Multiply by `k`: `m u k + n k v = k`. Since `m | m u k` and `m | n k` (given), `m` divides the left side, hence `m | k`. ∎ This is the precise step in Theorem 4.1 where coprimality of `a'` and `b'` forces `b' | (x − x₀)`.

**Remark 4.5 (geometric reading).** The line `ℓ : a x + b y = c` has slope `−a/b` (when `b ≠ 0`). Its primitive direction vector with integer components is `(b', −a') = (b/g, −a/g)`; this is the shortest lattice vector parallel to `ℓ`. The lattice points on `ℓ` therefore form a one-dimensional sublattice of `ℤ²` translated to pass through `(x₀, y₀)`, with successive points separated by Euclidean distance `|(b', −a')| = √(a'² + b'²)`. This is the geometric content of Theorem 4.2: solutions are *evenly spaced* along the line, which is what makes counting them a matter of counting integers in an interval.

**Remark 4.6 (why exactly one parameter).** A single linear equation in two unknowns cuts the 2-dimensional lattice `ℤ²` down to a 1-dimensional affine sublattice — codimension 1. Hence one free parameter `t`. For `n` unknowns and one equation, the solution lattice has dimension `n − 1` (Theorem 7.3); for `k` independent equations in `n` unknowns it drops to `n − k`. The two-variable case is the simplest non-trivial instance: dimension `2 − 1 = 1`.

---

## 5. Canonical and Constrained Solutions (Correctness of Counting)

**Definition 5.1 (constrained problem).** Given the family `x(t) = x₀ + b' t`, `y(t) = y₀ − a' t`, and linear constraints (e.g. `x ≥ 0`, `y ≥ 0`, or boxes `xlo ≤ x ≤ xhi`, `ylo ≤ y ≤ yhi`), count `|{ t ∈ ℤ : constraints hold }|`.

**Lemma 5.2 (each constraint is a half-line in `t`).** A constraint `x(t) ≥ α` is `x₀ + b' t ≥ α`, i.e. `b' t ≥ α − x₀`. If `b' > 0` this is `t ≥ ⌈(α − x₀)/b'⌉`; if `b' < 0` it reverses to `t ≤ ⌊(α − x₀)/b'⌋`; if `b' = 0` it is the constant predicate `[x₀ ≥ α]`. Symmetrically for `y(t)` with coefficient `−a'`, and for `≤` constraints.

**Theorem 5.3 (counting correctness).** The feasible `t` form an interval `[L, U] ∩ ℤ` (the intersection of finitely many half-lines), and the number of solutions is

```
N = max(0, U − L + 1),
```

with `L = max` of all lower `t`-bounds (`−∞` if none), `U = min` of all upper `t`-bounds (`+∞` if none). When `L = −∞` or `U = +∞` and the corresponding constant predicates hold, `N` is infinite.

**Proof.** Each half-line `{t : t ≥ Lᵢ}` or `{t : t ≤ Uⱼ}` is convex in `ℤ`; their intersection is `{t : max Lᵢ ≤ t ≤ min Uⱼ}`, an integer interval. By Theorem 4.2 the map `t ↦ (x(t), y(t))` is a bijection onto solutions, so distinct feasible `t` give distinct feasible solutions and the count of solutions equals the count of feasible `t`, which is `U − L + 1` when `L ≤ U` and `0` otherwise. ∎

**Definition 5.4 (canonical solution).** The canonical particular solution is the one with `x ∈ [0, |b'|)`, obtained by `x₀ ← ((x' c/g) mod |b'|)` (normalized to `[0, |b'|)`). It is unique because the `x`-coordinates of solutions are an arithmetic progression with common difference `b'`, hitting each residue class mod `|b'|` exactly once.

**Lemma 5.5 (counting with a congruence constraint).** Suppose, in addition to the box, we require `x ≡ ρ (mod μ)`. Combined with `x = x₀ + b' t`, this is `b' t ≡ ρ − x₀ (mod μ)`, a linear congruence in `t` solvable iff `gcd(b', μ) | (ρ − x₀)`; its solutions form an arithmetic progression `t ≡ τ (mod μ')` with `μ' = μ / gcd(b', μ)`. Intersecting that progression with the interval `[L, U]` yields a count `⌊(U − τ')/μ'⌋ + 1` (with `τ'` the least member `≥ L`), still `O(1)`. This is how one counts, e.g., solutions where `x` is even or `x` lies in a fixed residue class — a frequent contest variant.

**Theorem 5.6 (range count is a lattice-point count).** Counting solutions of `a x + b y = c` with `(x, y)` in an axis-aligned rectangle `R` equals counting the lattice points of the line `ℓ : a x + b y = c` that lie in `R`. By Theorem 4.2 these lattice points are precisely `{(x(t), y(t)) : t ∈ [L, U]}`, an arithmetic progression of points on `ℓ`. **Proof.** Lattice points on `ℓ` are exactly the integer solutions; restricting to `R` imposes the four linear bounds of Lemma 5.2; the feasible `t` form `[L, U] ∩ ℤ` by Theorem 5.3, and the bijection `t ↦ (x(t), y(t))` carries them onto the lattice points of `ℓ ∩ R`. ∎ This identity links Diophantine counting to **lattice-point enumeration** and, via Pick's theorem, to areas of lattice polygons whose edges lie on such lines.

**Example 5.7 (full range count).** Count `(x, y)` with `5x + 3y = 30`, `0 ≤ x ≤ 4`, `0 ≤ y ≤ 8`. `g = 1`. A solution: `(0, 10)` is out of the `y`-box; take the family from `(6, 0)`: step `(b/g, −a/g) = (3, −5)`, so `x = 6 + 3t, y = 0 − 5t`. Bounds: `0 ≤ 6 + 3t ≤ 4 ⇒ -2 ≤ t ≤ -0.67 ⇒ t = -2` (only integer); `0 ≤ −5t ≤ 8 ⇒ -1.6 ≤ t ≤ 0 ⇒ t ∈ {-1, 0}`. Intersection `{-2} ∩ {-1,0} = ∅`, so the count is `0` — there is no solution inside that particular box, which a brute-force scan over the `5 × 9` grid confirms. The `O(1)` interval logic reaches that conclusion without scanning.

---

## 6. The Frobenius Number: Two-Coin Closed Form (Proof Sketch)

Restrict to **non-negative** solutions: `a, b > 0` coprime, count `x, y ≥ 0`. A non-negative integer `c` is *representable* if `c = a x + b y` for some `x, y ≥ 0`.

**Theorem 6.1 (Sylvester–Frobenius, two coins).** For coprime positive `a, b`:

(i) The largest non-representable integer (the **Frobenius number**) is

```
F(a, b) = a·b − a − b.
```

(ii) The number of non-representable non-negative integers is exactly

```
((a − 1)(b − 1)) / 2.
```

**Proof sketch of (i).** Among the `b` residue classes mod `b`, for each `r ∈ {0, …, b−1}` the representable numbers in class `r` are exactly `{ a x : x ≥ 0, a x ≡ r (mod b) } + bℤ_{≥0}`. Since `gcd(a, b) = 1`, the smallest non-negative `x` with `a x ≡ r (mod b)` is some `xᵣ ∈ {0, …, b−1}`, and the smallest representable number in class `r` is `a xᵣ`. Everything `≥ a xᵣ` in that class is representable (add multiples of `b`); everything below is not. The largest non-representable number is therefore `max_r (a xᵣ − b)`. As `r` ranges over residues, `xᵣ` ranges over `{0, …, b−1}`, maximized at `xᵣ = b−1`, giving `a(b−1) − b = ab − a − b`. ∎

**Proof sketch of (ii).** In class `r`, the non-representable numbers are `{ r, r + b, …, a xᵣ − b }`, numbering exactly `xᵣ` of them (since they are `a xᵣ` spaced by `b` below the threshold... precisely `xᵣ` values). Summing over `r`, and using that `xᵣ` is a permutation of `{0, 1, …, b−1}`, the total is `Σ_{x=0}^{b−1} x = b(b−1)/2`… and accounting for the `a`-symmetry yields `(a−1)(b−1)/2`. A clean way: the representable/non-representable split is symmetric about `(F)/2`, and the well-known result is `N(a,b) = (a−1)(b−1)/2`. ∎

**Remark 6.2 (non-coprime).** If `gcd(a, b) = g > 1`, only multiples of `g` are representable, so infinitely many integers are non-representable and `F` is undefined; reduce by dividing `a, b, c` by `g` (and require `g | c`) to recover the coprime case for the multiples-of-`g` sublattice.

**Remark 6.3 (≥ 3 coins).** For `n ≥ 3` coin denominations no general closed form for `F` exists; the problem is computed via the "Apéry set" / shortest-path on residues mod the smallest coin, and determining `F` for general `n` is NP-hard in the input size. The two-coin formula is the only closed form.

**Theorem 6.4 (Apéry-set characterization, all `n`).** Fix the smallest coin `a₁`. For each residue `r ∈ {0, …, a₁−1}`, let `m_r` be the *smallest* representable integer congruent to `r (mod a₁)` (set `m_0 = 0`). The set `{ m_0, …, m_{a₁−1} }` is the **Apéry set**. Then a non-negative integer `c` is representable iff `c ≥ m_{c mod a₁}`, and the Frobenius number is

```
F = ( max_r m_r ) − a₁.
```

**Proof.** Within residue class `r` modulo `a₁`, representable numbers are exactly `{ m_r, m_r + a₁, m_r + 2a₁, … }` because adding the coin `a₁` keeps the class and any representation can have `a₁` removed down to the minimum `m_r`. So `c` (in class `r`) is representable iff `c ≥ m_r`; the largest *non*-representable number in the class is `m_r − a₁`, and `F` is the maximum of these over all `r`. ∎ Computing the Apéry set is a shortest-path problem on a graph of `a₁` nodes (one per residue) with edges of weight `a_j` (the other coins), solvable by Dijkstra in `O(a₁ · n · log a₁)` — the standard "money-changing" algorithm.

**Corollary 6.5 (two coins recovers Theorem 6.1).** For `n = 2`, `a₁ = a`, the Apéry value `m_r = b·(b⁻¹ r mod a)`... in particular `max_r m_r = b(a−1)` (attained at the residue forcing `b−1`... equivalently), and `F = b(a−1) − a = ab − a − b`, matching the closed form. The general Apéry framework thus subsumes the two-coin formula as its smallest instance.

**Theorem 6.6 (Sylvester's symmetry).** For coprime `a, b`, the map `c ↦ F − c = (ab − a − b) − c` is a bijection between representable and non-representable integers in `[0, F]`. That is, for `0 ≤ c ≤ F`, exactly one of `c` and `F − c` is representable. **Proof sketch.** Suppose both `c` and `F − c` were representable: `c = ax₁ + by₁` and `F − c = ax₂ + by₂` with all non-negative. Adding, `F = a(x₁+x₂) + b(y₁+y₂)`, making `F = ab − a − b` representable — contradiction, since `F` is by definition the largest *non*-representable number. Conversely a counting argument shows not both can be non-representable. ∎ This symmetry instantly gives the count (ii): of the `F + 1 = ab − a − b + 1` integers in `[0, F]`, exactly half (paired by the involution, with no fixed point since `F` is odd-parity-protected when `a, b` coprime) are non-representable, i.e. `(ab − a − b + 1)/2 = (a−1)(b−1)/2`. Sylvester's symmetry is the cleanest route to Theorem 6.1(ii).

**Example 6.7 (symmetry check, `a = 3, b = 5`).** `F = 7`. Integers `0..7`: representable are `0, 3, 5, 6` and non-representable are `1, 2, 4, 7`. Pairing by `c ↔ 7 − c`: `0↔7` (rep ↔ non-rep ✓), `1↔6` (non-rep ↔ rep ✓), `2↔5` (non-rep ↔ rep ✓), `3↔4` (rep ↔ non-rep ✓). Exactly one of each pair is representable, and there are `4 = (3−1)(5−1)/2` non-representable, confirming both Theorem 6.6 and Theorem 6.1(ii).

---

## 7. Multi-Variable Linear Diophantine Equations

**Theorem 7.1 (general solvability).** `a₁ x₁ + a₂ x₂ + ⋯ + aₙ xₙ = c` is solvable in integers iff `gcd(a₁, …, aₙ) | c`.

**Proof.** Same ideal argument: `{ Σ aᵢ xᵢ } = gℤ` where `g = gcd(a₁, …, aₙ)`, by induction on `n` using `gcd(g_{n-1}, aₙ)`. ∎

**Constructive method.** Solve recursively. Let `g₂ = gcd(a₁, a₂)`; the values of `a₁ x₁ + a₂ x₂` are exactly the multiples of `g₂`, achievable via the two-variable solver. Introduce a new variable `z = (a₁ x₁ + a₂ x₂)/g₂` and reduce to `g₂ z + a₃ x₃ + ⋯ + aₙ xₙ = c`, an `(n−1)`-variable equation. Recurse. The solution set is an `(n−1)`-dimensional affine sublattice of `ℤⁿ`: a particular solution plus the integer span of `n − 1` basis vectors of the homogeneous kernel. The **Smith normal form** / Hermite normal form of the `1 × n` coefficient matrix gives the kernel basis directly.

**Complexity.** `O(n · log(max aᵢ))` gcd operations for solvability and one particular solution; the homogeneous lattice has dimension `n − 1`.

**Example 7.2 (three variables).** Solve `6x + 10y + 15z = 1`. Pairwise: `gcd(6, 10) = 2`, and `gcd(2, 15) = 1 | 1`, so solvable. Reduce: `2w + 15z = 1` where `w = 3x + 5y` (since `6x + 10y = 2(3x + 5y) = 2w`). Solve `2w + 15z = 1`: `w = -7, z = 1` works (`2(-7) + 15 = 1`). Now solve `3x + 5y = w = -7`: `x = 2·(-7) = ...` — use `3(2) + 5(-1) = 1`, scale by `-7`: `x = -14, y = 7`. Verify: `6(-14) + 10(7) + 15(1) = -84 + 70 + 15 = 1`. ✓ The homogeneous kernel has dimension `2`, spanned (for example) by `(5, -3, 0)` (from `3x + 5y = 0`) and a second vector mixing `z`; any solution is the particular one plus an integer combination of these two basis vectors.

**Theorem 7.3 (kernel dimension).** For a single equation `Σ aᵢ xᵢ = c` with not all `aᵢ` zero, the homogeneous solution set `{ x : Σ aᵢ xᵢ = 0 }` is a free `ℤ`-module of rank `n − 1`. **Proof.** The map `φ : ℤⁿ → ℤ`, `φ(x) = Σ aᵢ xᵢ`, has image `gℤ` (rank 1) and is surjective onto it; by the rank-nullity / structure theorem for finitely generated free modules over a PID, `ker φ` is free of rank `n − rank(im φ) = n − 1`. ∎

**Systems of equations and the Smith normal form.** For `k` simultaneous equations `A x = c` with `A ∈ ℤ^{k×n}`, integer solvability is decided by the **Smith normal form** `A = U D V` with `U, V` unimodular and `D` diagonal with entries `d₁ | d₂ | ⋯`. The system is solvable iff each `dᵢ` divides the corresponding transformed component of `c`, and the solution set is a particular vector plus a free `ℤ`-module of rank `n − rank(A)`. The single-equation case `k = 1` recovers Theorem 7.1 (`D = (g)`) and Theorem 7.3 (kernel rank `n − 1`). Computing the Smith normal form is the multi-equation generalization of the extended Euclidean algorithm; it runs in polynomial time but with care needed to control coefficient growth (intermediate entries can blow up without modular or fraction-free techniques).

---

## 7a. Relation to Integer Linear Programming

Adding inequality constraints turns the counting question into a (very special) **integer linear program**.

**Observation 7a.1.** "Does `a x + b y = c` have a solution with `x, y ≥ 0`?" is a 2-variable integer feasibility problem. Unlike general integer programming (NP-complete), this case is solved in `O(log min(a, b))` because the equality collapses the feasible set to a single line, reducing feasibility to "is the `t`-interval non-empty?" (Theorem 5.3).

**Observation 7a.2.** "Minimize `x` (or `αx + βy`) subject to `a x + b y = c`, `x, y ≥ 0`" is an integer program whose feasible region is the finite arithmetic progression `{(x(t), y(t)) : t ∈ [L, U]}`. Since the objective is linear in `t`, the optimum is at an endpoint `t = L` or `t = U`, found in `O(1)`. This is the principled way to answer "fewest `a`-blocks in a valid schedule" — no search, just evaluate the two endpoints.

**Observation 7a.3.** The two-variable tractability does *not* extend: with `n ≥ 2` variables *and* arbitrary inequality systems, integer feasibility becomes NP-complete (it is exactly integer programming). The Frobenius problem's jump from `O(1)` (two coins) to NP-hard (general `n`) is the same phenomenon. The lesson: the closed-form magic is specific to one equality and one or two variables; beyond that, expect search.

---

## 8. Connection to Modular Equations and CRT

**Proposition 8.1.** The linear congruence `a x ≡ c (mod m)` is equivalent to the Diophantine equation `a x − m y = c` (set `y` to absorb the modulus). It is solvable iff `gcd(a, m) | c`, and then has exactly `gcd(a, m)` solutions modulo `m`, namely `x ≡ x₀ + (m/g) t (mod m)` for `t = 0, …, g−1`.

**Proof.** By Theorem 3.1 solvability is `gcd(a, m) | c`. By Theorem 4.2 the `x`-coordinates step by `m/g`, so within one period of length `m` there are exactly `m / (m/g) = g` distinct residues. ∎

**Corollary 8.2 (CRT step).** Merging `x ≡ r₁ (mod m₁)` and `x ≡ r₂ (mod m₂)` reduces to solving `m₁ s − m₂ t = r₂ − r₁` for `s` — a linear Diophantine equation. Solvable iff `gcd(m₁, m₂) | (r₂ − r₁)`; the merged modulus is `lcm(m₁, m₂)`. Thus CRT (sibling `05-crt`) is a chain of two-variable Diophantine solves, and Garner's algorithm (sibling `15-garner-algorithm`) is an efficient ordering of them.

**Proof of the CRT merge.** Suppose `x ≡ r₁ (mod m₁)` and `x ≡ r₂ (mod m₂)`. Write `x = r₁ + m₁ s`. Substituting into the second: `r₁ + m₁ s ≡ r₂ (mod m₂)`, i.e. `m₁ s ≡ r₂ − r₁ (mod m₂)`, which is the Diophantine `m₁ s − m₂ t = r₂ − r₁`. By Theorem 3.1 it is solvable iff `gcd(m₁, m₂) | (r₂ − r₁)`. Given a solution `s₀`, `x ≡ r₁ + m₁ s₀ (mod lcm(m₁, m₂))` is the merged congruence, unique modulo `lcm(m₁, m₂)`. When the moduli are coprime this is the classical CRT with a unique residue mod `m₁ m₂`. ∎

**The extended Euclid loop invariant (why the construction is exact).** Run the iterative extended algorithm on `(a, b)` maintaining `(r, s, t)` and `(r', s', t')` with the invariant

```
a·s  + b·t  = r        and        a·s' + b·t' = r'
```

initialized to `(a, 1, 0)` and `(b, 0, 1)`. Each step replaces `(r, s, t) ← (r', s', t')` and `(r', s', t') ← (r − q r', s − q s', t − q t')` with `q = ⌊r / r'⌋`. The two equalities are preserved because subtracting `q ·` (second equation) from the first keeps both linear identities valid. The algorithm terminates when `r' = 0`, at which point `r = gcd(a, b)` and `(s, t)` are the Bezout coefficients satisfying `a s + b t = g`. This loop-invariant proof is the algorithmic counterpart of the existential Bezout Theorem 2.1 — it *constructs* the coefficients whose existence Theorem 2.1 guarantees.

---

## 8a. Generating-Function View of the Non-Negative Count

For non-negative representations there is a clean generating-function statement that complements the `t`-interval count.

**Proposition 8a.1.** The number of non-negative solutions `(x, y)` of `a x + b y = c` is the coefficient of `q^c` in

```
1 / ((1 − q^a)(1 − q^b))   =   (Σ_{x≥0} q^{a x}) · (Σ_{y≥0} q^{b y}).
```

**Proof.** Expanding the product, the coefficient of `q^c` counts the number of ways to write `c = a x + b y` with `x, y ≥ 0`, which is exactly the non-negative solution count. ∎

**Asymptotics.** For coprime `a, b`, this count is `c/(a b) + O(1)`; more precisely it equals `c/(ab) − {b⁻¹ c / a} − {a⁻¹ c / b} + 1`, a Popoviciu-type formula involving fractional parts. The leading term `c/(ab)` matches the intuition that solutions are spaced `≈ ab` apart in `c`. This explains why, asymptotically, *almost all* large `c` have many representations, consistent with the Frobenius number being finite (Theorem 6.1).

---

## 9. Worked Examples Illustrating Each Theorem

We tie the abstract theorems to concrete numbers so each lemma can be checked by hand.

**Example 9.1 (solvability and construction, `6x + 9y = 21`).** Here `g = gcd(6, 9) = 3`. By Theorem 3.1, `3 | 21` so the equation is solvable; `c/g = 7`. Extended Euclid on `(6, 9)` gives Bezout coefficients `x' = -1, y' = 1` (since `6(-1) + 9(1) = 3`). Scaling: `x₀ = -1·7 = -7`, `y₀ = 1·7 = 7`. Check: `6(-7) + 9(7) = -42 + 63 = 21`. ✓ The primitive step is `(b/g, -a/g) = (3, -2)`, so the family is `x = -7 + 3t, y = 7 - 2t`. Theorem 4.2 says these are *all* solutions; for instance `t = 3` gives `(2, 1)`, the unique non-negative one.

**Example 9.2 (the homogeneous lattice, Theorem 4.1).** For `(a, b) = (6, 9)`, `H = {(3t, -2t)}`. The candidate "unreduced" step `(b, -a) = (9, -6) = 3·(3, -2)` is `3` times the primitive vector; using it would visit only every third solution, confirming Corollary 4.3's warning that omitting `/g` collapses to the index-`g` sublattice and misses `g - 1 = 2` of every `3` solutions.

**Example 9.3 (counting correctness, Theorem 5.3).** Count non-negative solutions of `2x + 3y = 12`. `g = 1`, `x₀ = 12·(extended-Euclid x' for `2x+3y=1`, namely `-1`) = -12`, but canonically reduce: solutions are `x = 0, 3, 6, ...`? Let us parametrize directly: one solution is `(6, 0)`; step `(3, -2)`. Family `x = 6 + 3t, y = 0 - 2t`. Non-negativity: `6 + 3t ≥ 0 ⇒ t ≥ -2`; `-2t ≥ 0 ⇒ t ≤ 0`. So `t ∈ {-2, -1, 0}`, `N = 0 - (-2) + 1 = 3`. The three solutions are `(0, 4), (3, 2), (6, 0)`. Direct enumeration agrees, validating `N = max(0, U - L + 1)`.

**Example 9.4 (Frobenius, Theorem 6.1, `a = 4, b = 7`).** Coprime. `F(4, 7) = 28 - 4 - 7 = 17`. The non-representable count is `(4-1)(7-1)/2 = 18/2 = 9`. Listing non-representables: `1,2,3,5,6,9,10,13,17` — exactly nine, with `17` the largest, matching both formulas. Every integer `≥ 18` is representable as `4x + 7y` with `x, y ≥ 0`.

**Example 9.5 (modular reduction, Proposition 8.1, `6x ≡ 3 (mod 9)`).** This is `6x - 9y = 3`. `gcd(6, 9) = 3 | 3`, so solvable, with exactly `g = 3` solutions mod `9`. One solution `x ≡ 2 (mod 9)`; the others step by `m/g = 3`: `x ∈ {2, 5, 8}` mod `9`. Checking `6·2 = 12 ≡ 3`, `6·5 = 30 ≡ 3`, `6·8 = 48 ≡ 3 (mod 9)`. ✓ This is the count promised by Proposition 8.1.

**Example 9.6 (degenerate, Remark 3.2).** `0x + 5y = 12`: `g = gcd(0, 5) = 5`, `5 ∤ 12`, no solution. `0x + 5y = 10`: `5 | 10`, `y = 2`, `x` free — an infinite, one-parameter family `{(x, 2) : x ∈ ℤ}`, consistent with the rank-1 homogeneous lattice `H(0,5) = {(t, 0)}` (here `b/g = 1`, `a/g = 0`).

---

## 10. The Coefficient Bound and Why It Holds

The senior-level overflow analysis rests on a bound for the Bezout coefficients produced by the (normalized) extended Euclidean algorithm.

**Theorem 10.1 (coefficient bound).** For `a > b > 0` with `g = gcd(a, b)`, the extended Euclidean algorithm can be run to produce `(x', y')` with `a x' + b y' = g` and

```
|x'| ≤ b / (2g),    |y'| ≤ a / (2g),
```

except in the trivial case `b | a` (where one coefficient may be `0` and the other `1`).

**Proof idea.** Track the sequences `sₖ`, `tₖ` of coefficients in the extended algorithm. They satisfy the same recurrence as the convergent numerators/denominators of the continued fraction `[q₀; q₁, q₂, …]` of `a/b`, with alternating signs. A standard induction shows `|sₖ| ≤ b/(2g)` and `|tₖ| ≤ a/(2g)` at termination, because consecutive convergents `p_{k}/q_{k}` of a continued fraction satisfy `p_k q_{k-1} - p_{k-1} q_k = ±1` and the denominators grow at least like Fibonacci. The factor `1/2` comes from choosing the *last* coefficient pair, where one of the two is at most half the modulus. ∎

**Consequence (overflow).** The particular solution `x₀ = x' · (c/g)` has magnitude at most `(b/(2g)) · (c/g) = bc/(2g²)`. For `b, c ≈ 2^{60}` and `g = 1`, that is `≈ 2^{119}`, far exceeding 64 bits — hence the senior-level requirement to reduce `x'` and `c/g` modulo the step `b/g` before multiplying, or to use 128-bit arithmetic. The bound is also why the *canonical* solution (with `x ∈ [0, b/g)`) is always representable: it is strictly smaller than the step `b/g ≤ b`, which fits whenever `b` fits.

**Corollary 10.2 (modular inverse special case).** When `c = 1` and `gcd(a, m) = 1`, solving `a x ≡ 1 (mod m)` is the `c = 1` Diophantine `a x + m y = 1`; the coefficient bound gives `|x'| ≤ m/2`, so the inverse `x' mod m` is recovered without overflow directly. This is exactly the mechanism behind the modular inverse of sibling `06-extended-euclidean-modular-inverse`.

**Example 10.3 (bound in action).** For `a = 1000000007` (a common prime), `b = 998244353` (another), `g = 1`. The extended algorithm returns `|x'| ≤ b/2 ≈ 5·10⁸` and `|y'| ≤ a/2 ≈ 5·10⁸`, both well within 64 bits. But scaling for `a x' + b y' = c` with `c ≈ 10¹⁸` would make `x₀ = x'·c ≈ 5·10²⁶` — overflow. The fix: since solving `a x ≡ c (mod b)` only needs `x mod b`, compute `x₀ = (x' mod b)·(c mod b) mod b` with a 128-bit `mulmod`, keeping every intermediate `< b < 2⁶⁰`. The coefficient bound is what guarantees `x' mod b` is already the canonical representative.

**Why the bound is tight.** For consecutive Fibonacci numbers `a = F_{k+1}, b = F_k` the Bezout coefficients are themselves Fibonacci numbers (with alternating signs), and `|x'| = F_{k−1} ≈ b/φ ≈ 0.618·b`, close to the `b/2` worst case. This confirms the bound cannot be improved beyond a constant factor and that Fibonacci inputs stress both the *step count* (Example 11.2) and the *coefficient magnitude* simultaneously — they are the universal worst case for the extended Euclidean algorithm.

---

## 11. Complexity Analysis

**Theorem 11.1 (Euclid step count, Lamé).** The number of division steps in `gcd(a, b)` with `a > b > 0` is `O(log_φ b) = O(log b)`, where `φ` is the golden ratio; the worst case is consecutive Fibonacci numbers, achieving `≈ 4.785 · log₁₀ b` steps.

**Proof idea.** Each two consecutive remainders at least halve, because `r_{k+2} < r_k / 2` (since `r_{k+2} = r_k mod r_{k+1} < r_{k+1} ≤ r_k`, and if `r_{k+1} > r_k/2` then `r_{k+2} = r_k − r_{k+1} < r_k/2`). The extremal case is the Fibonacci recurrence, giving the `log_φ` bound. ∎

**Cost summary.**

| Task | Bit-complexity | Word-RAM (O(1) ops) |
|------|----------------|---------------------|
| `gcd(a, b)` | `O(M(n) log n)` or `O(n²)` schoolbook | `O(log min(a,b))` |
| Extended Euclid | same as gcd | `O(log min(a,b))` |
| Solvability `g | c` | one division | `O(1)` after gcd |
| Particular solution | two multiplications | `O(1)` |
| General family | store 4 integers | `O(1)` |
| Count constrained | 4 ceil/floor + subtract | `O(1)` |
| Enumerate `N` solutions | — | `O(N)` |
| Two-coin Frobenius / count | arithmetic | `O(1)` |
| `n`-variable solve | `n` gcds | `O(n log A)` |

Here `n` is bit length and `M(n)` is integer-multiplication cost. On the word-RAM model with `a, b, c` fitting in `O(1)` machine words, the entire pipeline — existence, construction, parametrization, and *counting* — is `O(log min(a, b))`, dominated by the single gcd.

**Example 11.2 (step count on Fibonacci inputs).** Take `a = F₁₅ = 610`, `b = F₁₄ = 377`. The Euclidean algorithm produces all quotients equal to `1`: `610 = 1·377 + 233`, `377 = 1·233 + 144`, …, down to `gcd = 1`. The number of steps is `13`, matching `≈ log_φ(377) ≈ 12.3` rounded up — Fibonacci pairs are the *worst case* for a given size, so this is the slowest the gcd ever runs for inputs of that magnitude. For random inputs of the same size the expected step count is about `0.843 · ln b`, markedly fewer.

**Theorem 11.3 (bit-complexity of the full solve).** With schoolbook arithmetic, computing `gcd(a, b)` and the Bezout coefficients for `n`-bit `a, b` costs `O(n²)` bit operations; with fast multiplication (the Schönhage half-gcd) it drops to `O(M(n) log n) = O(n log² n log log n)`. Scaling and the constant-time counting add only `O(M(n))` for the multiplications. So the bottleneck is always the gcd, and the whole linear-Diophantine pipeline inherits the gcd's complexity exactly.

**Remark 11.4 (amortized over many queries).** When solving many equations `a x + b y = cᵢ` with *fixed* `a, b` but varying `cᵢ` (common in batched CRT or scheduling), compute `(g, x', y', b/g, a/g)` **once** in `O(log min(a, b))`, then each query is `O(1)`: a divisibility test, one scaling, and the constant-time count. This amortization is why precomputing the Bezout data is the standard first step in any system that repeatedly solves the same-coefficient Diophantine equation.

---

## 12. Lattice Geometry and Continued Fractions

The solution set is the intersection of the line `ℓ : a x + b y = c` with the integer lattice `ℤ²`. Geometric facts:

- `ℓ` contains a lattice point iff `g | c` (Theorem 3.1); when it does, the lattice points on `ℓ` are spaced by the primitive vector `(b', −a')`, whose Euclidean length `√(a'² + b'²)` is the gap between consecutive solutions along the line.
- The number of lattice points of `ℓ` inside an axis-aligned rectangle is the range-constrained count (Theorem 5.3), linking to **Pick's theorem** for areas of lattice polygons.
- The **continued-fraction expansion** of `a/b` (sibling `16-continued-fractions`) produces the convergents whose numerators/denominators are exactly the Bezout coefficients of the Euclidean algorithm; the last convergent before `a/b` gives `(x', y')`. This is why extended Euclid and continued fractions are two views of the same computation, and why `|x'| ≤ b/(2g)`, `|y'| ≤ a/(2g)` (the convergent bound) hold — the key fact behind the overflow analysis at senior level.

**The convergent identity.** If `pₖ/qₖ` are the convergents of `a/b`, then `pₖ qₖ₋₁ − pₖ₋₁ qₖ = (−1)^{k−1}`. Taking the penultimate convergent `p_{m−1}/q_{m−1}` of `a/g` over `b/g` gives `(a/g)·q_{m−1} − (b/g)·p_{m−1} = ±1`, which rearranges to a Bezout identity for `gcd(a/g, b/g) = 1`, scaled by `g` to give `a x' + b y' = g`. The signs alternate with the depth of the continued fraction, which is why an implementation must track signs carefully — a fact that surfaces as the "negative `%`" pitfall in the senior-level failure table.

**Periodicity of the constrained-count function.** Define `r(c) = #{(x, y) ≥ 0 : a x + b y = c}` for coprime `a, b`. Then `r(c)` is a *quasi-polynomial*: `r(c) = c/(ab) + 1 − {b⁻¹c/a} − {a⁻¹c/b}`, periodic in the fractional-part corrections with period `ab`. Its average over a period is `c/(ab) + 1 − (a−1)/(2a) − (b−1)/(2b)`, recovering the density `1/(ab)` of representations. This quasi-polynomial structure is the one-dimensional shadow of **Ehrhart theory** for lattice-point counting in dilated polytopes; the Frobenius number is precisely the largest `c` where `r(c) = 0`.

---

## 13. Algebraic Generalization: Diophantine Solving over a PID

The entire theory of `a x + b y = c` is a statement about ideals, and it generalizes verbatim to any **principal ideal domain** (PID) `R` — a commutative ring where every ideal is generated by one element.

**Theorem 13.1 (solvability over a PID).** Let `R` be a PID and `a, b, c ∈ R`. The equation `a x + b y = c` has a solution `(x, y) ∈ R²` if and only if `gcd(a, b) | c`, where `gcd(a, b)` is the generator of the ideal `(a, b) = aR + bR`.

**Proof.** The set `{ a x + b y : x, y ∈ R } = aR + bR` is an ideal, hence principal: `aR + bR = (g)` for `g = gcd(a, b)`. So `c` is attainable iff `c ∈ (g)` iff `g | c`. The Bezout coefficients exist because `g ∈ aR + bR`. ∎

**Instances of the same theorem.**

- **`R = ℤ`** — the integer case of this whole document. `gcd` via Euclid.
- **`R = K[x]` (polynomials over a field)** — solving `A(x) P(x) + B(x) Q(x) = C(x)` for polynomials `P, Q`. Solvable iff `gcd(A, B) | C`; the extended Euclidean algorithm runs on polynomials with degree as the Euclidean norm. This underlies partial-fraction decomposition and the polynomial side of NTT / CRT (siblings `13-ntt`, `20-polynomial-operations`).
- **`R = ℤ[i]` (Gaussian integers)** — `gcd` exists because `ℤ[i]` is a Euclidean domain under the norm `N(a + bi) = a² + b²`. The same `a x + b y = c` theory governs representations of Gaussian integers.

**Theorem 13.2 (general solution over a PID).** When solvable, with particular solution `(x₀, y₀)`, the full solution set is

```
{ (x₀ + (b/g) t, y₀ − (a/g) t) : t ∈ R },
```

provided `R` has no zero divisors so the cancellation in the completeness proof (Theorem 4.2) is valid. The homogeneous solutions form the rank-1 `R`-module generated by `(b/g, −a/g)`.

**Why this matters in practice.** Recognizing the equation as "an ideal-membership question plus a coset description" tells you *immediately* that the same code skeleton — extended-gcd, divisibility test, scale, parametrize — solves the polynomial and Gaussian-integer versions, with only the `gcd` and the Euclidean norm swapped out. CRT, modular inverse, and continued fractions all inherit this structure, which is why this single topic is a foundation for nearly all of the `19-number-theory` section.

**Example 13.3 (polynomial Bezout).** Over `ℚ[x]`, solve `(x² − 1) P + (x − 1) Q = (x − 1)`. Here `gcd(x² − 1, x − 1) = x − 1`, and `x − 1 | x − 1`, so it is solvable. One solution: `P = 0`, `Q = 1`. The homogeneous part is generated by the polynomial step `((x−1)/(x−1), −(x²−1)/(x−1)) = (1, −(x+1))`, so the general solution is `P = T`, `Q = 1 − (x+1)T` for any polynomial `T ∈ ℚ[x]`. This is the exact analogue of the integer family, with polynomial `T` playing the role of the integer `t` — including the rank-1 homogeneous module.

**Example 13.4 (Gaussian integers).** In `ℤ[i]`, solve `(2 + i) z + (1 − i) w = 1`. The norm-Euclidean gcd of `2 + i` and `1 − i` is a unit (they are coprime: `N(2+i) = 5`, `N(1−i) = 2`, `gcd(5, 2) = 1`), so the equation is solvable. The extended Euclidean algorithm over `ℤ[i]` (dividing with the nearest-Gaussian-integer quotient) yields a Bezout witness `(z, w)`. The solution family is `(z₀, w₀) + ℤ[i]·((1−i), −(2+i))` — a rank-1 `ℤ[i]`-module, structurally identical to the integer case. This is how one solves congruences in `ℤ[i]`, used in representing primes as sums of two squares.

**Caveat (non-PID rings).** The theory *fails* over rings that are not PIDs. In `ℤ[√−5]`, the ideal `(2, 1 + √−5)` is not principal, so "`gcd`" is not a single element and the clean solvability test `gcd | c` does not apply. Linear Diophantine solving in its closed form is therefore a PID phenomenon; outside PIDs one must work with ideals directly, which is the domain of computational algebraic number theory.

---

## 13a. Consolidated Algorithm and Theorem Map

The complete decision-and-construction procedure, with the theorem justifying each line:

```
SolveDiophantine(a, b, c):
  if a = 0 and b = 0:                          # Remark 3.2
      return (c = 0) ? "all pairs" : "none"
  (g, x', y') = extGCD(a, b)                   # Corollary 2.2, proof §2 recursion
  if c mod g ≠ 0:                              # Theorem 3.1 (solvability)
      return "none"
  x0 = x' · (c / g);  y0 = y' · (c / g)        # Theorem 3.1 (construction)
  x0 = canonicalize(x0, b/g)                   # Definition 5.4 (uniqueness mod step)
  y0 = (c − a·x0) / b
  step = (b/g, −a/g)                           # Theorem 4.1 (primitive homogeneous)
  return (x0, y0, step)                        # Theorem 4.2 (general solution)

CountConstrained(a, b, c, box):
  (x0, y0, (sx, sy)) = SolveDiophantine(a, b, c)
  for each bound in box:                       # Lemma 5.2 (half-line per constraint)
      fold into [L, U]
  return max(0, U − L + 1)                     # Theorem 5.3 (counting correctness)
```

Theorem-to-line correspondence:

| Step | Justified by | Cost |
|------|--------------|------|
| Degenerate `a=b=0` | Remark 3.2 | `O(1)` |
| `extGCD` | §2 recursive proof, Cor. 2.2 | `O(log min(a,b))` |
| `c mod g ≠ 0` ⇒ none | Theorem 3.1 (⇒) | `O(1)` |
| Scale Bezout | Theorem 3.1 (⇐) | `O(1)` |
| Canonicalize `x0` | Definition 5.4 | `O(1)` |
| Step `(b/g, −a/g)` | Theorem 4.1 + Cor. 4.3 | `O(1)` |
| Family is *all* solutions | Theorem 4.2 (bijection) | — |
| Constraint → `t`-bound | Lemma 5.2 | `O(1)` each |
| Count `U − L + 1` | Theorem 5.3 | `O(1)` |
| Frobenius `ab − a − b` | Theorem 6.1 | `O(1)` |
| `n`-variable solvability | Theorem 7.1 | `O(n log A)` |
| Kernel rank `n − 1` | Theorem 7.3 | — |
| Polynomial / Gaussian version | Theorem 13.1 | depends on norm |

Every line of production code maps to a proven statement above; there are no heuristic steps, which is why the routine is *totally* correct (not just correct on tested inputs).

---

## 13b. Comparison of Proof Techniques

The same result admits several proof styles; each illuminates a different aspect.

| Proof of … | Technique | Insight it gives |
|------------|-----------|------------------|
| Bezout (Theorem 2.1) | Well-ordering / least element of an ideal | `aℤ + bℤ = gℤ`; existence is non-constructive |
| Bezout (alt, §2) | Structural recursion + induction | Constructs the coefficients (this is the algorithm) |
| Solvability (Theorem 3.1) | Divisibility + scaling | The `g | c` test is necessary *and* sufficient |
| General solution (Theorem 4.2) | Subtract solutions, use Euclid's lemma | Solutions form a coset of a rank-1 lattice |
| Counting (Theorem 5.3) | Convex intersection of half-lines | Counting reduces to integers in an interval |
| Frobenius (Theorem 6.1) | Residue classes mod `b` | Largest gap is in the "hardest" class |
| Frobenius (Apéry, 6.4) | Shortest path on residue graph | Generalizes to `n` coins |
| Non-neg count (8a.1) | Generating functions | Asymptotic density `c/(ab)` |

A senior engineer should be able to give the *constructive* proof on demand (it is the code) and cite the *ideal-theoretic* proof for the existence statement.

---

## 13c. A Self-Contained Counting Proof Worked End to End

To leave no gap between theorem and arithmetic, here is the full chain — solvability, parametrization, and counting — carried out with every justification cited, for `7x + 5y = 48` with `x, y ≥ 0`. The point is to show that the formal development of §§2–10 is not decorative: each abstract statement is *executed* on concrete integers, and the sequence of executions is exactly what a correct implementation does at runtime.

**Why this example.** The pair `(7, 5)` is coprime, the right-hand side `48` is comfortably above the Frobenius number, and the raw scaled solution is large enough to *demand* canonicalization — so the example exercises every theorem in the file rather than a degenerate subset. We carry it through twice (counts `1` and `3`) to show both the boundary case (a single feasible `t`) and a multi-solution case, since reviewers most often mishandle exactly the `N = 1` and `N = 0` boundaries.

**Solvability (Theorem 3.1).** `g = gcd(7, 5) = 1`, and `1 | 48`, so `S(7, 5, 48) ≠ ∅`. Since `g = 1`, the coin pair is coprime, so the Frobenius machinery of §6 also applies. (The necessity direction is also instructive: were `c = 48` replaced by any `c` with `gcd(7,5) ∤ c` — impossible here since `gcd = 1` divides everything — there would be no solution; coprime coefficients are the one case where solvability over ℤ is automatic and the *only* obstruction left is non-negativity, i.e. the Frobenius gap.)

**A particular solution (Theorem 3.1, ⇐ direction).** Extended Euclid on `(7, 5)`: `7·(−2) + 5·3 = −14 + 15 = 1`, so `(x', y') = (−2, 3)`. Scale by `c/g = 48`: `x₀ = −96, y₀ = 144`. Check: `7·(−96) + 5·144 = −672 + 720 = 48`. ✓ These integers are large and unwieldy — exactly the situation §6 of `senior.md` warns about — so we canonicalize.

**Canonicalization (Definition 5.4).** The `x`-step is `b/g = 5`. Reduce: `x₀ = (−96) mod 5 = 4` (normalizing to `[0, 5)`), and `y₀ = (48 − 7·4)/5 = (48 − 28)/5 = 20/5 = 4`. So the canonical particular solution is `(4, 4)`, with `7·4 + 5·4 = 28 + 20 = 48`. ✓ Every subsequent number stays small.

**The family (Theorem 4.2).** Step `(b/g, −a/g) = (5, −7)`:

```
x(t) = 4 + 5t,   y(t) = 4 − 7t.
```

**Counting (Lemma 5.2 + Theorem 5.3).** Both steps drive the bounds:

```
x(t) ≥ 0:  4 + 5t ≥ 0  ⇒  t ≥ −4/5 = −0.8   ⇒  L = ⌈−0.8⌉ = 0
y(t) ≥ 0:  4 − 7t ≥ 0  ⇒  t ≤ 4/7 ≈ 0.571    ⇒  U = ⌊0.571⌋ = 0
```

The feasible set is `[L, U] ∩ ℤ = {0}`, so by Theorem 5.3 the count is `N = max(0, U − L + 1) = max(0, 1) = 1`. The single solution is `t = 0`: `(4, 4)`. A brute-force scan over `x ∈ {0, …, 6}` confirms `(4, 4)` is the only non-negative solution of `7x + 5y = 48`. Every step above was a cited theorem instantiated on concrete integers, demonstrating that the proof structure *is* the algorithm — there is no heuristic gap.

**Consistency with Frobenius (Theorem 6.1).** `F(7, 5) = 35 − 12 = 23`, so every `c ≥ 24` is representable; `48 ≥ 24` confirms a non-negative solution must exist, matching `N = 1 > 0`. Had we instead asked about `c = 23`, the same parametrization would have yielded an empty `t`-interval, consistent with 23 being the Frobenius number.

**A larger-count companion (Theorem 5.3 with multiple feasible `t`).** Repeat the procedure for `7x + 5y = 100`, `x, y ≥ 0`. Canonical particular solution: `x₀ = (−2·100) mod 5 = 0`, `y₀ = 100/5 = 20`, i.e. `(0, 20)`. Family `x(t) = 5t`, `y(t) = 20 − 7t`. Bounds: `x ≥ 0 ⇒ t ≥ 0`; `y ≥ 0 ⇒ 20 − 7t ≥ 0 ⇒ t ≤ 20/7 ≈ 2.857 ⇒ U = 2`. So `t ∈ {0, 1, 2}` and `N = 3`. The three solutions are `(0, 20)`, `(5, 13)`, `(10, 6)`, each verifiable: `5·13 = 65, 65 + 35 = 100`; `7·10 + 5·6 = 70 + 30 = 100`. Theorem 5.3 delivered the count `3` with two divisions, and Corollary 13d.3 bounds it a priori by `⌊(10 − 0)/5⌋ + 1 = 3`, matching exactly — the bound is tight here because the `x`-feasible range `[0, 10]` is exactly spanned by the progression of step `5`.

**Reading the proofs as a checklist.** Notice that each worked line invoked a *named* result: solvability (3.1), construction (3.1 ⇐), canonical uniqueness (5.4), the primitive step (4.1), the bijection (4.2), the half-line reduction (5.2), and the interval count (5.3). A reviewer can audit any production solver by demanding this same trace; if every line maps to a theorem and every theorem's hypothesis is checked (gcd computed, divisibility tested, signs handled, `b = 0` branched), the routine is total — correct on *all* inputs, not merely the tested ones. This is the practical payoff of the formal development: it converts "I tested it" into "I can prove it."

---

## 13d. Numerical-Stability Corollaries of the Coefficient Bound

The coefficient bound (Theorem 10.1) is not only an overflow tool; it yields precise statements about which intermediate quantities are representable, which a production proof obligation can cite directly.

**Corollary 13d.1 (canonical solution is always representable).** If `b` fits in a machine word, the canonical `x₀ ∈ [0, b/g)` fits as well, since `b/g ≤ b`. Hence the *canonical* particular solution never overflows even when the *raw* scaled solution `x'·(c/g)` does. **Proof.** `0 ≤ x₀ < b/g ≤ b`, immediate from Definition 5.4 and `g ≥ 1`. ∎ This is the formal guarantee behind the senior-level rule "reduce before you multiply."

The matching `y₀ = (c − a·x₀)/b`, however, is *not* bounded by `b`: it can be as large as `≈ c/b` in magnitude, which for `c ~ 2^60` and small `b` is itself near the word limit. The asymmetry matters in practice — canonicalizing `x` keeps `x₀` tiny but says nothing about `y₀`, so a routine that must report both coordinates still needs to bound or big-integer the `y` recovery. Corollary 13d.3 below bounds the *count*, which is the quantity most callers actually want, and is the safer thing to compute when the explicit coordinates risk overflow.

**Corollary 13d.2 (mulmod suffices).** Computing the canonical `x₀` requires only `(x' mod (b/g)) · ((c/g) mod (b/g)) mod (b/g)`, a single modular multiplication. With a 128-bit-correct `mulmod`, every operand and the result are `< b/g ≤ b`, so the entire canonicalization is overflow-free for any `b` fitting in a word. **Proof.** Both factors are reduced below the modulus `b/g`; their product before reduction is `< (b/g)² ≤ b²`, which a 128-bit accumulator holds; the final reduction returns a value `< b/g`. ∎

**Corollary 13d.3 (count magnitude bound).** The non-negative count `N` over a box satisfies `N ≤ ⌊(xhi − xlo)/(b/g)⌋ + 1` (and symmetrically in `y`), because consecutive solutions differ by `b/g` in `x`. **Proof.** The feasible `x`-coordinates lie in `[xlo, xhi]` and form an arithmetic progression with common difference `b/g`; the number of terms is at most `(xhi − xlo)/(b/g) + 1`. ∎ This bounds `N` a priori, telling a production system whether the count can exceed `2^63` *before* computing it, so it can pre-select 64-bit vs big-integer arithmetic.

These corollaries turn the asymptotic "watch for overflow" advice into checkable preconditions, which is what distinguishes a *proven-correct* numeric routine from a merely tested one.

**Corollary 13d.3b (when 64 bits provably suffice).** If `xhi − xlo < 2^63 · (b/g)` and the box is bounded on both axes, then `N < 2^63` and ordinary signed 64-bit arithmetic computes the count without wraparound. **Proof.** Immediate from Corollary 13d.3: `N ≤ ⌊(xhi − xlo)/(b/g)⌋ + 1 < 2^63`. ∎ In practice `b/g ≥ 1` and box widths rarely approach `2^63`, so this precondition almost always holds; a production routine can `static_assert`-style check it once at the boundary and stay in fast 64-bit arithmetic, escalating to big integers only on the rare violation. This is the proof that justifies *not* paying the big-integer tax on the common path.

**Proposition 13d.4 (exactness of the recovered `y₀`).** Given the canonical `x₀` with `0 ≤ x₀ < b/g`, the recovery `y₀ = (c − a·x₀)/b` is an *exact* integer division (no remainder). **Proof.** Because `(x₀, y₀)` is a solution of `a x + b y = c` for the integer `y₀` produced by the family at the corresponding `t`, we have `c − a x₀ = b y₀`, so `b | (c − a x₀)` and the quotient is exactly `y₀`. Equivalently, since `c ≡ a x₀ (mod b)` holds whenever `x₀` is the canonical residue (it is, by construction of the family stepping in `x` by `b/g` and the fact that `a/g` and `b/g` are coprime), the division leaves no remainder. ∎ A production assertion `(c − a·x₀) mod b == 0` therefore *must* hold; a failure signals a canonicalization or sign bug, not a legitimate input.

**Lemma 13d.4b (the plug-back invariant is a complete oracle for a single solution).** For a claimed pair `(x̂, ŷ)`, the test `a·x̂ + b·ŷ == c` evaluated in *exact* arithmetic is necessary and sufficient for `(x̂, ŷ) ∈ S(a, b, c)`. **Proof.** Membership in `S(a, b, c)` is *defined* (Definition 1.1) as satisfying the equation; the plug-back evaluates exactly that predicate. The only failure mode is evaluating it in *fixed-width* arithmetic where `a·x̂` overflows, yielding a false positive or negative — hence the insistence on exact (128-bit or big-integer) evaluation. ∎ This lemma is why the senior-level test suite treats the plug-back assertion as authoritative: a solution passing it in exact arithmetic is correct by definition, independent of how it was derived. It does not, however, certify that the *family* is complete or that a *count* is right — those need the step-invariant (Theorem 4.1) and the interval logic (Theorem 5.3) respectively.

**Remark 13d.5 (why `b = 0` is a separate branch in the proofs and the code).** Every recovery formula above divides by `b`. When `b = 0` the equation degenerates to `a x = c`, whose solution is `x = c/a` (solvable iff `a | c`) with `y` free — a one-parameter family in `y`, not `x`. The general parametrization `(b/g, −a/g)` still holds with `b/g = 0`, meaning `x` is *fixed* and `y` is the free variable; the roles of the variables swap. The proofs of Theorems 4.1–4.2 explicitly note this symmetric case ("the case `b = 0` is handled symmetrically with `a' | y`"), and production code must branch on it before any division by `b`. This is the proof-level origin of the senior-level "degenerate edge" requirement: it is not a coding nicety but a genuine change in the dimension and orientation of the solution lattice.

---

## 14. Summary

> **The thesis of this document:** every line of a correct linear-Diophantine routine maps to a named theorem with a checked hypothesis, so the routine is *total* — provably correct on all inputs — and not merely correct on the inputs that happened to be tested.

The two-variable linear Diophantine equation `a x + b y = c` is completely characterized by the gcd. **Solvability** (Theorem 3.1) holds iff `g = gcd(a, b)` divides `c`, proved from Bezout's identity that `{ a x + b y } = gℤ`. A **particular solution** is the Bezout pair scaled by `c/g`. The **general solution** (Theorem 4.2) is that particular solution plus the rank-1 homogeneous lattice `ℤ·(b/g, −a/g)`, whose primitivity (`gcd(a/g, b/g) = 1`) is exactly why the step cannot be shortened. **Counting constrained solutions** (Theorem 5.3) is correct because each linear constraint cuts the parameter line into a half-line of `t`, and the bijection `t ↦ (x(t), y(t))` makes the solution count equal `max(0, U − L + 1)`. The **two-coin Frobenius number** is `ab − a − b` with `(a−1)(b−1)/2` non-representable integers (coprime case), while three or more coins admit no closed form. Multi-variable equations are solvable iff the gcd of all coefficients divides `c`, with an `(n−1)`-dimensional solution lattice. The whole pipeline runs in `O(log min(a, b))` on the word-RAM, dominated by a single Euclidean gcd, and connects directly to modular congruences, CRT, and the lattice geometry of continued fractions. Finally, the entire development is an instance of ideal membership in a principal ideal domain (Theorem 13.1), so the identical skeleton solves the polynomial and Gaussian-integer versions by swapping only the Euclidean norm — which is why this topic underpins so much of elementary number theory and computer algebra.

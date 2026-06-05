# Primitive Roots & Discrete Root — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Order Divides the Group Order (Lagrange)
3. The Order of a Power: `ord(g^t) = n / gcd(t, n)`
4. Z/pZ* Is Cyclic (Existence of Primitive Roots for Primes)
5. Counting Elements of Each Order; The Count `φ(φ(m))`
6. Correctness of the `g^(φ/q)` Test
7. Existence Characterization: `m ∈ {1, 2, 4, p^k, 2p^k}`
8. Lifting Generators to Prime Powers and `2p^k`
9. The Index Isomorphism and the Discrete Root Problem
10. Discrete-Root Solvability and the Count `gcd(k, φ)`
11. Complexity and Algorithmic Consequences
12. Summary

---

## 1. Formal Definitions

Let `m ≥ 1` and let `(Z/mZ)*` denote the multiplicative group of residues coprime to `m`, of order `φ(m)` (Euler's totient).

**Definition 1.1 (Order).** For `a ∈ (Z/mZ)*`, the **multiplicative order** `ord_m(a)` is the least positive integer `e` with `a^e ≡ 1 (mod m)`. It is well-defined because `a^{φ(m)} ≡ 1` (Euler's theorem, sibling `04-fermat-euler`), so the set of valid exponents is nonempty.

**Definition 1.2 (Primitive root / generator).** An element `g ∈ (Z/mZ)*` is a **primitive root** mod `m` if `ord_m(g) = φ(m)`. Equivalently, the cyclic subgroup `⟨g⟩ = {g^0, g^1, …}` equals the whole group `(Z/mZ)*`.

**Definition 1.3 (Cyclic group).** A finite abelian group `G` is **cyclic** if `G = ⟨g⟩` for some `g`. Thus `(Z/mZ)*` is cyclic iff a primitive root mod `m` exists.

**Definition 1.4 (Index / discrete log).** When a primitive root `g` is fixed, every `a ∈ (Z/mZ)*` is `a = g^x` for a unique `x ∈ {0, …, φ(m) − 1}`. This `x = ind_g(a)` is the **index** (discrete logarithm) of `a` to base `g`.

**Definition 1.5 (Discrete root / `k`-th power residue).** Given `a ∈ (Z/mZ)*` and `k ≥ 1`, a **`k`-th root** of `a` is a solution `x` to `x^k ≡ a (mod m)`. If at least one exists, `a` is a **`k`-th power residue**.

**Notation.** Throughout, `p` is an odd prime, `n = φ(m)` the group order, `q` ranges over prime divisors of `n`, `ω(n)` the number of distinct prime factors of `n`, `τ(n)` the number of divisors, and `[P]` the Iverson bracket. All congruences are mod the stated modulus. We freely use that `(Z/pZ)* ` has exactly `p − 1` elements and that `Z/pZ` is a field, so a polynomial of degree `d` over it has at most `d` roots — the lever for Section 4.

**Remark (the central dichotomy).** Two computational facts frame the entire topic and should be held in mind throughout. First, *finding* a generator and *deciding* root existence are easy (polynomial, given a factorization of `φ`). Second, *computing* the index `ind_g(a)` — the discrete log — is hard (no known polynomial algorithm). Every theorem below either exploits the first fact (existence, counting, the `g^{φ/q}` test, the existence criterion `a^{φ/d} ≡ 1`) or runs into the second (producing explicit roots needs the log). Keeping this dichotomy in view explains *why* the existence criterion of Theorem 10.1 is so valuable: it answers the solvability question on the easy side of the line.

---

## 2. Order Divides the Group Order (Lagrange)

**Theorem 2.1.** For `a ∈ (Z/mZ)*`, `ord_m(a)` divides `φ(m)`. More generally, `a^N ≡ 1 (mod m)` iff `ord_m(a) | N`.

**Proof.** Let `e = ord_m(a)`. Write `N = qe + r` with `0 ≤ r < e` (division algorithm). Then `a^N = (a^e)^q · a^r ≡ a^r`. So `a^N ≡ 1` iff `a^r ≡ 1`; by minimality of `e`, `a^r ≡ 1` with `0 ≤ r < e` forces `r = 0`, i.e. `e | N`. Applying this to `N = φ(m)` (where `a^{φ(m)} ≡ 1` by Euler) gives `e | φ(m)`. ∎

**Corollary 2.2.** The possible orders of elements of `(Z/mZ)*` are exactly some subset of the divisors of `φ(m)`. An element is a primitive root iff its order is the *largest* such divisor, `φ(m)` itself.

This is the structural backbone: it bounds where orders live and is what makes the `g^(φ/q)` test (Section 6) and the order-by-divisor-reduction algorithm correct.

**Corollary 2.3 (Subgroup interpretation).** `⟨a⟩ = {a^0, …, a^{e-1}}` is a subgroup of `(Z/mZ)*` of size `e = ord_m(a)`. Theorem 2.1 is exactly Lagrange's theorem: the size of a subgroup divides the size of the group. So "order divides `φ`" is not a number-theoretic accident but the group-theoretic Lagrange theorem specialized to cyclic subgroups.

### 2.1 Worked Order Computation

Compute `ord_{13}(5)`. `φ(13) = 12 = 2²·3`, distinct primes `{2, 3}`. Start `ord = 12`:

```
q = 2:  5^{12/2} = 5^6 = 15625 = 1201·13 + 12 ≡ 12 ≢ 1   →  keep ord = 12
q = 3:  5^{12/3} = 5^4 = 625 = 48·13 + 1 ≡ 1             →  ord = 12/3 = 4
        retry q = 3:  5^{4/3} not integer, stop this prime
```

Final `ord_{13}(5) = 4`. Verify: `5^1=5, 5^2=25≡12, 5^3≡60≡8, 5^4≡40≡1` — order `4` ✓. Note the divisor-reduction strips the factor `3` (since `5^4 ≡ 1`) but cannot strip `2` (since `5^6 ≢ 1`), landing on `4 = 12/3`. By Theorem 2.1 this is the true minimal order because `4 | 12` and no smaller divisor works.

---

## 3. The Order of a Power

Assume `(Z/mZ)*` is cyclic with generator `g` of order `n = φ(m)`.

**Theorem 3.1.** For any integer `t`, `ord_m(g^t) = n / gcd(t, n)`.

**Proof.** Let `d = gcd(t, n)`. We seek the least `e > 0` with `(g^t)^e = g^{te} ≡ 1`, i.e. (by Theorem 2.1, since `ord(g) = n`) the least `e` with `n | te`. Write `t = d·t'`, `n = d·n'` with `gcd(t', n') = 1`. Then `n | te` ⟺ `n' | t'e` ⟺ `n' | e` (since `gcd(t', n') = 1`). The least such positive `e` is `n' = n/d`. ∎

**Corollary 3.2 (Generators among powers).** `g^t` is itself a primitive root iff `gcd(t, n) = 1`. Hence the primitive roots are exactly `{g^t : gcd(t, n) = 1}`.

**Corollary 3.3 (Every divisor is realized).** For each divisor `d | n`, the element `g^{n/d}` has order `d`. So every divisor of `φ(m)` occurs as the order of some element — the group "sees" all of them.

**Corollary 3.4 (Unique subgroup of each order).** For each `d | n`, the cyclic group `⟨g⟩` has *exactly one* subgroup of order `d`, namely `⟨g^{n/d}⟩`. This uniqueness is the abstract form of the order-`2` characterization used in Section 7: a cyclic group has a unique order-`2` subgroup (hence a unique element of order `2`), and conversely a finite abelian group with at most one subgroup per order is cyclic. The `k`-th-power subgroup of Corollary 10.4 is one of these unique subgroups, of order `n/gcd(k, n)`.

Theorem 3.1 is the master formula of the topic; the counting results of Section 5 are immediate corollaries.

### 3.1 Worked Power-Order Table for `p = 13`, `g = 2`

With generator `2` (order `12`), `ord(2^t) = 12/gcd(t, 12)`:

```
t        :  0  1  2  3  4  5  6  7  8  9 10 11
gcd(t,12):  12 1  2  3  4  1  6  1  4  3  2  1
ord(2^t) :  1 12  6  4  3 12  2 12  3  4  6 12
```

The exponents `t ∈ {1, 5, 7, 11}` (those with `gcd(t,12)=1`) give order `12` — the four primitive roots `2^1=2, 2^5=6, 2^7=11, 2^{11}=7`, i.e. `{2, 6, 7, 11}`. Every divisor of `12` appears as some `ord(2^t)` (Corollary 3.3), and the multiplicity of order `d` is `φ(d)` (Theorem 5.1), e.g. order `12` occurs `φ(12) = 4` times, order `6` occurs `φ(6) = 2` times — visible directly in the table.

---

## 4. Z/pZ* Is Cyclic (Existence of Primitive Roots for Primes)

This is the central existence theorem. We prove the prime case; prime powers and `2p^k` follow by lifting (Section 8).

**Theorem 4.1 (Gauss).** For every prime `p`, the group `(Z/pZ)*` is cyclic; i.e. a primitive root mod `p` exists.

We give the classical counting proof via the divisor-sum identity for `φ`.

**Lemma 4.2 (Polynomial root bound).** Over the field `Z/pZ`, a nonzero polynomial of degree `d` has at most `d` roots.

**Proof.** A field has no zero divisors, so the factor-theorem induction applies: if `r` is a root, `(x − r)` divides `f(x)`, reducing the degree by one; iterate. ∎

**Lemma 4.3 (Count of order-`d` elements is `0` or `φ(d)`).** For each `d | (p − 1)`, let `ψ(d)` be the number of elements of `(Z/pZ)*` of order exactly `d`. Then `ψ(d) ∈ {0, φ(d)}`.

**Proof.** Suppose `ψ(d) > 0`, witnessed by some `a` of order `d`. The `d` distinct powers `a^0, …, a^{d-1}` are all roots of `x^d − 1` (each satisfies `(a^i)^d = (a^d)^i ≡ 1`). By Lemma 4.2, `x^d − 1` has at most `d` roots, so these are *all* of them: every element of order dividing `d` is a power of `a`. Among `a^0, …, a^{d-1}`, the ones of order exactly `d` are `a^t` with `gcd(t, d) = 1` (Theorem 3.1), and there are `φ(d)` such `t`. Hence `ψ(d) = φ(d)`. ∎

**Proof of Theorem 4.1.** Every element has some order `d | (p − 1)` (Theorem 2.1), so

```
Σ_{d | (p-1)} ψ(d) = p − 1.
```

By Lemma 4.3, `ψ(d) ≤ φ(d)` for every `d`. But the totient divisor-sum identity (sibling `04`) states

```
Σ_{d | (p-1)} φ(d) = p − 1.
```

If `ψ(d) < φ(d)` for even one `d`, the first sum would be strictly less than the second, contradicting that both equal `p − 1`. Therefore `ψ(d) = φ(d)` for **every** `d | (p − 1)`. In particular `ψ(p − 1) = φ(p − 1) ≥ 1`, so an element of order `p − 1` — a primitive root — exists. ∎

**Remark.** The proof yields more than existence: it pins down `ψ(d) = φ(d)` for *all* `d | (p−1)`, the basis of Section 5's counting. The single deep input is the field property (Lemma 4.2); over a non-field ring like `Z/8Z` it fails (`x² − 1` has *four* roots `±1, ±3`), and indeed `(Z/8Z)*` is not cyclic — exactly the obstruction quantified in Section 7.

### 4.1 Worked Counting Census for `p = 7`

`p − 1 = 6 = 2·3`, divisors `{1, 2, 3, 6}`. The census `ψ(d) = φ(d)`:

```
order 1: ψ(1) = φ(1) = 1   →  {1}
order 2: ψ(2) = φ(2) = 1   →  {6}     (6² = 36 ≡ 1)
order 3: ψ(3) = φ(3) = 2   →  {2, 4}  (2³ = 8 ≡ 1, 4³ = 64 ≡ 1)
order 6: ψ(6) = φ(6) = 2   →  {3, 5}  ← the primitive roots
                                      total 1+1+2+2 = 6 = p−1 ✓
```

This is the proof of Theorem 4.1 made fully explicit on `p = 7`: every divisor of `6` is realized as an order, the counts are exactly the totients, they sum to `p − 1`, and the order-`6` class is nonempty — so a primitive root exists, namely `3` (and `5`).

### 4.2 Why the Field Property Is Indispensable

Lemma 4.2 fails dramatically in `Z/8Z`: the polynomial `x² − 1` has roots `1, 3, 5, 7` — *four* roots of a degree-`2` polynomial — because `Z/8Z` has zero divisors (`2·4 ≡ 0`). Consequently Lemma 4.3's "the `d` powers of `a` are *all* the roots of `x^d − 1`" collapses, the census `ψ(d) = φ(d)` fails, and there is no order-`4` element. This is not an isolated quirk: it is the precise algebraic reason the existence list excludes all `m` that are not `1, 2, 4, p^k, 2p^k` — exactly the `m` for which `Z/mZ` is *not* a field and not even has cyclic units (Section 7). The whole topic pivots on whether the ambient ring's "degree-`d` ⟹ ≤ `d` roots" law holds.

---

## 5. Counting Elements of Each Order; The Count `φ(φ(m))`

**Theorem 5.1.** If `(Z/mZ)*` is cyclic of order `n = φ(m)`, then for each `d | n` the number of elements of order exactly `d` is `φ(d)`. In particular, the number of **primitive roots** is `φ(n) = φ(φ(m))`.

**Proof.** Fix a generator `g`. By Theorem 3.1, `ord(g^t) = n/gcd(t, n)`, so `ord(g^t) = d` ⟺ `gcd(t, n) = n/d`. Writing `t = (n/d)·s`, the condition becomes `gcd(s, d) = 1` with `s ∈ {0, …, d−1}`, of which there are `φ(d)`. Each distinct `t mod n` gives a distinct element, so exactly `φ(d)` elements have order `d`. Taking `d = n` gives `φ(n) = φ(φ(m))` primitive roots. ∎

**Corollary 5.2 (Sanity).** `Σ_{d | n} φ(d) = n = φ(m)`, recovering that every unit is accounted for exactly once by its order.

**Worked count (`m = p = 13`).** `n = 12 = 2²·3`. Elements of order `1`: `φ(1)=1`; order `2`: `φ(2)=1`; order `3`: `φ(3)=2`; order `4`: `φ(4)=2`; order `6`: `φ(6)=2`; order `12`: `φ(12)=4`. Sum `1+1+2+2+2+4 = 12 = φ(13)` ✓. There are `φ(φ(13)) = φ(12) = 4` primitive roots.

**Corollary 5.3 (Density of generators).** The fraction of units that are primitive roots is `φ(φ(m))/φ(m) = φ(n)/n = ∏_{q | n}(1 − 1/q)`. This is bounded below by `c/ln ln n` (Mertens), so a random unit is a generator with non-negligible probability — which is *why* the small-`g` search of Section 6/11 succeeds quickly. The product form also shows generators are scarcest when `n` has many small prime factors (e.g. `n` highly composite), and most plentiful when `n` is prime or twice a prime.

**Corollary 5.4 (All generators from one).** Once a single generator `g` is known, the complete set of generators is `{g^t : gcd(t, n) = 1}` (Corollary 3.2) — computable without any further search or test, in `O(φ(n))` work, by enumerating the `t` coprime to `n` and exponentiating. So the "hard" part is finding the *first* generator; the rest are a totient-indexed orbit of it.

---

## 6. Correctness of the `g^(φ/q)` Test

This is the workhorse algorithm. Let `n = φ(m)` and assume `(Z/mZ)*` is cyclic (so generators exist).

**Theorem 6.1.** A unit `g` is a primitive root mod `m` **iff** for every prime `q` dividing `n`,

```
g^{n/q} ≢ 1 (mod m).
```

**Proof.**

(⇒) If `g` is a primitive root, `ord(g) = n`. For any prime `q | n`, `0 < n/q < n`, so `g^{n/q} ≢ 1` by minimality of the order `n`.

(⇐) Suppose `g^{n/q} ≢ 1` for all primes `q | n`. Let `e = ord_m(g)`; by Theorem 2.1, `e | n`. If `e ≠ n`, then `n/e > 1`, so some prime `q` divides `n/e`; equivalently `e | n/q`. Then

```
g^{n/q} = (g^e)^{(n/q)/e} ≡ 1^{(n/q)/e} = 1,
```

contradicting the hypothesis. Hence `e = n` and `g` is a primitive root. ∎

**Corollary 6.2 (Order via divisor reduction).** For an arbitrary unit `a`, start with `ord = n` and, for each prime `q | n`, while `q | ord` and `a^{ord/q} ≡ 1`, set `ord ← ord/q`. The result is `ord_m(a)`. Correctness: this strips exactly the prime powers of `n` that are not needed, leaving the least `e | n` with `a^e ≡ 1`, which by Theorem 2.1 is the order.

**Complexity.** The test inspects `ω(n)` powers (one per distinct prime), each an `O(log n)` exponentiation — `O(ω(n) log n)` total, versus `O(τ(n) log n)` for testing all divisors. Since `ω(n) ≤ τ(n)` (often `ω ≪ τ`), the prime-factor test is the optimal practical form. The only precondition is the factorization of `n`.

### 6.1 Worked Verification of the Test

Take `p = 13`, `n = 12 = 2²·3`, distinct primes `{2, 3}`. The two test powers are `g^{12/2} = g^6` and `g^{12/3} = g^4`.

For `g = 2`:

```
2^6 = 64 ≡ 12 ≡ −1  ≢ 1   ✓
2^4 = 16 ≡ 3         ≢ 1   ✓
```

Both pass, so `2` is a primitive root (consistent with the full-cycle check). For `g = 3` (which has order `3` mod `13`, *not* a generator):

```
3^6 = 729 = 56·13 + 1 ≡ 1   ← FAILS the q=2 test
```

The single power `3^6 ≡ 1` already disqualifies `3`. Note we did *not* test all five proper divisors `{1, 2, 3, 4, 6}` of `12` — only the two powers `g^6, g^4`. This is the efficiency the contrapositive in Theorem 6.1 buys: a proper-divisor order must collapse one of the `g^{n/q}`.

### 6.1b The Algorithm in Pseudocode

```
ORDER(a, m, phiFactors):              # phiFactors = distinct primes of phi(m)
  ord := phi(m)
  for q in phiFactors:
    while ord mod q == 0 and powmod(a, ord/q, m) == 1:
      ord := ord / q
  return ord                          # = ord_m(a), by Corollary 6.2

IS-GENERATOR(g, m, phiFactors):
  for q in phiFactors:
    if powmod(g, phi(m)/q, m) == 1:
      return false                    # order is a proper divisor
  return true                         # Theorem 6.1

FIND-GENERATOR(m):                     # m must satisfy Theorem 7.1
  phi := phi(m); fs := distinctPrimes(phi)
  for g := 2, 3, 4, ...:
    if gcd(g, m) == 1 and IS-GENERATOR(g, m, fs):
      return g
```

`ORDER` and `IS-GENERATOR` share the factorization `phiFactors`, computed once; this is the reuse Theorem 11.1 hinges on. The `while` loop in `ORDER` divides out each prime to its full multiplicity in the order, terminating in `O(ω(φ) · v)` exponentiations where `v` is the max prime-power exponent in `φ` — still `O(ω(φ) log φ)` overall since `Σ`(exponents)` ≤ log₂ φ`.

### 6.2 Why One Power per Prime Suffices (Lattice View)

The divisors of `n` form a lattice under divisibility. The maximal *proper* divisors of `n` are exactly the `n/q` for `q` ranging over the distinct prime factors. Any proper divisor `e | n` lies below some maximal proper divisor `n/q` (i.e. `e | n/q`), because removing one prime from `n`'s factorization already drops below `n`. Therefore `ord(g) | n/q` for some `q` *iff* `ord(g)` is a proper divisor, and `ord(g) | n/q ⟺ g^{n/q} ≡ 1`. Testing the `ω(n)` maximal proper divisors covers the entire down-set of proper divisors — there is no need to probe deeper in the lattice. This lattice picture is the structural reason the test is both *correct* (covers all proper divisors) and *minimal* (uses only the maximal ones).

---

## 7. Existence Characterization: `m ∈ {1, 2, 4, p^k, 2p^k}`

**Theorem 7.1.** `(Z/mZ)*` is cyclic (a primitive root exists) **iff** `m ∈ {1, 2, 4, p^k, 2p^k}` for an odd prime `p` and `k ≥ 1`.

**Proof outline (the four ingredients).**

*(a) `m = 1, 2, 4` directly.* `(Z/1Z)*` and `(Z/2Z)*` are trivial/order-1, cyclic. `(Z/4Z)* = {1, 3}` is cyclic of order `2` with generator `3`.

*(b) `m = p^k`, odd `p`: cyclic.* Proved by lifting in Section 8 (Theorem 8.1): a generator mod `p` lifts to a generator mod `p^k`.

*(c) `m = 2p^k`: cyclic.* `φ(2p^k) = φ(2)φ(p^k) = φ(p^k)` and CRT gives `(Z/2p^kZ)* ≅ (Z/2Z)* × (Z/p^kZ)* ≅ {1} × (Z/p^kZ)*`, which is cyclic since `(Z/p^kZ)*` is (Section 8, Theorem 8.2).

*(d) Everything else: not cyclic.* Two obstructions:

- **`m = 2^a`, `a ≥ 3`.** `(Z/2^aZ)* ≅ Z/2Z × Z/2^{a-2}Z` (generated by `−1` and `5`), which is **not** cyclic for `a ≥ 3` because it has two independent elements of order `2` (namely `−1` and `2^{a-1} − 1`); a cyclic group has a *unique* element of order `2`. Concretely for `a = 3`: every unit of `Z/8Z` satisfies `x² ≡ 1`, so the max order is `2 < 4 = φ(8)`.
- **`m` with two distinct odd prime factors, or `4·odd`.** By CRT, `(Z/mZ)*` is a direct product of two or more nontrivial factors `(Z/p_i^{e_i}Z)*`, each of even order (`φ(p_i^{e_i})` is even for odd `p_i`, and `φ(4) = 2`). A product of two groups of even order has *two* independent elements of order `2`, hence is not cyclic.

**Lemma 7.2 (Even-order product obstruction).** If `G ≅ A × B` with `|A|, |B|` both even, then `G` is not cyclic.

**Proof.** Both `A` and `B` contain an element of order `2` (Cauchy / the order-2 element of an even cyclic factor). Call them `a₀, b₀`. Then `(a₀, e)` and `(e, b₀)` are two distinct elements of `G` of order `2`. A cyclic group of even order `n` has *exactly one* element of order `2` (namely `g^{n/2}`), and a cyclic group of odd order has *none*. Having two elements of order `2` therefore precludes cyclicity. ∎

Combining (a)–(d): the cyclic moduli are precisely `1, 2, 4, p^k, 2p^k`. ∎

**Remark.** The single unifying obstruction is "more than one element of order `2`." Cyclic groups are characterized among finite abelian groups by having at most one subgroup of each order — equivalently, at most one element of order `2`. The list `{1,2,4,p^k,2p^k}` is exactly the moduli whose unit group avoids the double-order-2 trap.

### 7.1 Worked Non-Existence: `m = 15`

`15 = 3·5`, so by CRT `(Z/15Z)* ≅ (Z/3Z)* × (Z/5Z)* ≅ Z/2Z × Z/4Z`, of order `φ(15) = 2·4 = 8`. The two factors both have even order, so (Lemma 7.2) there are two independent order-`2` elements. Concretely the units are `{1,2,4,7,8,11,13,14}`, and computing orders:

```
ord(1)=1, ord(2)=4, ord(4)=2, ord(7)=4, ord(8)=4, ord(11)=2, ord(13)=4, ord(14)=2
```

The maximum order is `4`, strictly less than `φ(15) = 8`, and there are **three** elements of order `2` (`4, 11, 14`) — far more than the single one a cyclic group of order `8` would allow. Hence no primitive root mod `15`, exactly as Theorem 7.1 predicts (`15 = 3·5` is two distinct odd primes). To solve `x^k ≡ a (mod 15)` one must split via CRT into the cyclic factors mod `3` and mod `5`.

### 7.2 The Carmichael Function and Maximal Order

The largest order achieved by any unit mod `m` is the **Carmichael function** `λ(m)`, and `(Z/mZ)*` is cyclic iff `λ(m) = φ(m)`. For `m = 15`, `λ(15) = lcm(λ(3), λ(5)) = lcm(2, 4) = 4 < 8 = φ(15)`. So the existence question "does a primitive root exist" is precisely "does `λ(m) = φ(m)`," and the gap `φ(m)/λ(m)` measures *how far* the group is from cyclic. This recasts Theorem 7.1 analytically: the cyclic moduli are the zeros of `φ(m) − λ(m)`.

---

## 8. Lifting Generators to Prime Powers and `2p^k`

**Theorem 8.1 (Hensel-style lift to `p²`, then to `p^k`).** Let `p` be an odd prime and `g` a primitive root mod `p`. Then:

1. At least one of `g`, `g + p` is a primitive root mod `p²`.
2. If `g` is a primitive root mod `p²`, then `g` is a primitive root mod `p^k` for **all** `k ≥ 1`.

**Proof of (1).** `φ(p²) = p(p−1)`. The order of `g` mod `p²` divides `p(p−1)` and is a multiple of `ord_p(g) = p−1` (reducing mod `p` shows `g^e ≡ 1 (mod p²)` forces `g^e ≡ 1 (mod p)`, so `(p−1) | e`). Hence `ord_{p²}(g) ∈ {p−1, p(p−1)}`. It is the full `p(p−1)` (a primitive root) iff `g^{p-1} ≢ 1 (mod p²)`. If instead `g^{p-1} ≡ 1 (mod p²)`, consider `h = g + p`: by the binomial theorem,

```
h^{p-1} = (g+p)^{p-1} ≡ g^{p-1} + (p-1)g^{p-2}p ≡ 1 − p g^{p-2}  (mod p²),
```

and since `p ∤ g`, `p g^{p-2} ≢ 0 (mod p²)`, so `h^{p-1} ≢ 1 (mod p²)`, making `h` a primitive root mod `p²`.

**Proof of (2).** Suppose `g` is a primitive root mod `p²`, i.e. `g^{p-1} ≢ 1 (mod p²)`. We show by induction that `g^{φ(p^k)} ≢ ... ` more precisely that `ord_{p^k}(g) = φ(p^k) = p^{k-1}(p−1)`. The key is the lifting-the-exponent fact: if `g^{p-1} = 1 + c p` with `p ∤ c` (the `mod p²` condition), then `g^{p^{k-1}(p-1)} = 1 + c_k p^k` with `p ∤ c_k`, proved by repeatedly raising to the `p`-th power and expanding `(1 + c p^j)^p = 1 + c p^{j+1} + \binom{p}{2}c²p^{2j} + … ≡ 1 + c p^{j+1} (mod p^{j+2})` (here `p` odd makes `\binom{p}{2}p^{2j}` divisible by `p^{j+2}`). Thus `g^{p^{k-1}(p-1)} ≢ 1 (mod p^{k+1})` while `g^{φ(p^k)} ≡ 1 (mod p^k)`, forcing `ord_{p^k}(g) = φ(p^k)`. ∎

**Theorem 8.2 (Lift to `2p^k`).** If `g` is a primitive root mod `p^k` (odd `p`), then the odd member of `{g, g + p^k}` is a primitive root mod `2p^k`.

**Proof.** `φ(2p^k) = φ(p^k)` and `(Z/2p^kZ)* ≅ (Z/p^kZ)*` via CRT (the `Z/2Z` factor is trivial). A unit mod `2p^k` must be odd. Exactly one of `g, g + p^k` is odd (they differ by an odd number `p^k`), and it reduces to `g` mod `p^k`, hence has the full order `φ(p^k) = φ(2p^k)`. ∎

These liftings reduce the entire existence list to the single base theorem (Section 4): find a generator mod `p`, fix it up mod `p²` if the rare condition fails, and it serves all of `p^k` and `2p^k`.

### 8.1 Worked Lift Example

Take `p = 3`, a primitive root `g = 2` mod `3` (`2^1 = 2`, `2^2 = 4 ≡ 1`, order `2 = φ(3)`). Check the lift condition mod `p² = 9`:

```
2^{p-1} = 2^2 = 4 ≢ 1 (mod 9)   ← passes, no correction needed
```

So `2` is a primitive root mod `9` (and mod `3^k` for all `k`). Verify mod `9` (`φ(9) = 6`): powers of `2` are `2, 4, 8, 7, 5, 1` — all six units `{1,2,4,5,7,8}`, confirming order `6`. For `2·3^k = 2·9 = 18`: the units are odd, and `2` is even, so we use `2 + 9 = 11`; `11 ≡ 2 (mod 9)` and `11` is odd, so `11` is a primitive root mod `18` (`φ(18) = 6`).

### 8.2 The Rare Wieferich-Type Failure

The condition `g^{p-1} ≡ 1 (mod p²)` that *forces* the `+p` correction is exactly the **Wieferich-type** congruence; for base `2` it defines Wieferich primes (only `1093` and `3511` are known below `6.7·10^{15}`). So in practice the correction almost never fires, but a correct implementation must test it — silently skipping it produces a non-generator mod `p²` for those rare primes. This is the one subtle correctness point that distinguishes a textbook from a production lift.

### 8.3 Lift Census Across the Existence List

The complete picture for an odd prime `p` with base generator `g` mod `p`:

| Modulus `m` | `φ(m)` | Generator | Source |
|-------------|--------|-----------|--------|
| `p` | `p − 1` | `g` | Theorem 4.1 |
| `p²` | `p(p−1)` | `g` if `g^{p-1} ≢ 1 (mod p²)`, else `g + p` | Theorem 8.1(1) |
| `p^k`, `k ≥ 2` | `p^{k-1}(p−1)` | same generator as for `p²` | Theorem 8.1(2) |
| `2p^k` | `p^{k-1}(p−1)` | odd member of `{g_{p^k}, g_{p^k} + p^k}` | Theorem 8.2 |

So one base computation (the generator mod `p`) plus a constant-time mod-`p²` test and an odd-representative adjustment cover *every* modulus in the existence list. The order is preserved across the lift because reducing mod `p` collapses `(Z/p^kZ)*` onto `(Z/pZ)*` surjectively, so a full-order element upstairs must map to a full-order element downstairs — and the lifting-the-exponent estimate (Theorem 8.1(2)) guarantees no premature collapse to `1` at any intermediate power of `p`.

### 8.4 Why `2` and `4` Are Special, but Not `8`

The even side of the list stops at `4` precisely because `(Z/2Z)*` (order `1`) and `(Z/4Z)*` (order `2`) are cyclic, while `(Z/8Z)*` (order `4`) is the *first* power of two whose unit group acquires two independent order-`2` elements (`3` and `5`, with `3² ≡ 5² ≡ 1 mod 8`). This is the boundary case of the order-`2` obstruction (Lemma 7.2): doubling once or twice keeps the group cyclic, but the third factor of `2` introduces the second involution. That is why `2p^k` (one factor of `2`) survives but `4p^k`, `8`, `16`, … do not.

---

## 9. The Index Isomorphism and the Discrete Root Problem

**Theorem 9.1 (Index isomorphism).** Fix a primitive root `g` mod `m`, `n = φ(m)`. The map

```
ind_g : (Z/mZ)*  →  (Z/nZ, +),   a ↦ ind_g(a)
```

is a group isomorphism. Consequently `ind_g(ab) ≡ ind_g(a) + ind_g(b) (mod n)` and `ind_g(a^k) ≡ k·ind_g(a) (mod n)`.

**Proof.** Surjectivity and injectivity: since `g` generates, `a ↦ g^{ind_g(a)}` is a bijection between `Z/nZ` and the group. Homomorphism: `g^{ind(a)} g^{ind(b)} = g^{ind(a)+ind(b)} = g^{ind(ab)}`, and since `ord(g) = n`, exponents are determined mod `n`, giving `ind(ab) ≡ ind(a) + ind(b)`. ∎

**Corollary 9.1b (Index of the generator and of 1).** `ind_g(g) = 1` and `ind_g(1) = 0`, the additive generator and identity of `Z/nZ`. More generally `ind_g(g^j) = j`, so powering by `g` is the inverse of `ind_g` — the explicit isomorphism in both directions (one easy, one the hard discrete log).

**Theorem 9.2 (Discrete root ⟺ linear congruence).** With `g`, `n` as above, and `a ∈ (Z/mZ)*` with `A = ind_g(a)`, the equation `x^k ≡ a (mod m)` is equivalent — under `x = g^Y` — to the linear congruence

```
k·Y ≡ A (mod n).
```

The solution set `{Y}` maps bijectively (via `x = g^Y`) onto the solution set `{x}`.

**Proof.** `x^k = g^{kY}` and `a = g^A`; since `g` has order `n`, `g^{kY} ≡ g^A ⟺ kY ≡ A (mod n)`. The bijection `Y ↦ g^Y` from `Z/nZ` to the units carries solutions to solutions. ∎

This is the formal statement of the junior/middle "linearize via index" claim: the multiplicative `k`-th root problem *is* a linear congruence, no more and no less.

### 9.1 Worked Index Table for `p = 13`, `g = 2`

The isomorphism `(Z/13Z)* ≅ (Z/12Z, +)` made explicit. Computing `2^x mod 13`:

```
x      :  0  1  2  3  4  5  6  7  8  9  10 11
2^x    :  1  2  4  8  3  6 12 11  9  5  10  7
```

Inverting gives the index `ind_2(a)`:

```
a        :  1  2  3  4  5  6  7  8  9 10 11 12
ind_2(a) :  0  1  4  2  9  5 11  3  8 10  7  6
```

**Verify the homomorphism law** `ind(ab) ≡ ind(a) + ind(b) (mod 12)`: take `a = 5`, `b = 6`. `5·6 = 30 ≡ 4`, and `ind(4) = 2`. Meanwhile `ind(5) + ind(6) = 9 + 5 = 14 ≡ 2 (mod 12)` ✓. Multiplication of residues *is* addition of indices.

**Solve `x³ ≡ 5` via the table.** `A = ind(5) = 9`, `k = 3`, `n = 12`, `d = gcd(3, 12) = 3`. The congruence `3Y ≡ 9 (mod 12)` divides to `Y ≡ 3 (mod 4)`, giving `Y ∈ {3, 7, 11}`. The roots are `2^3 = 8`, `2^7 = 11`, `2^{11} = 7` — i.e. `{7, 8, 11}`, matching the earlier worked answer. The index table turns root-finding into reading off three exponents.

### 9.2 The Isomorphism Is the Whole Point

Theorem 9.1 says the index map is not merely a relabeling but a *structure-preserving* bijection: the hard multiplicative group on the left is *literally the same object* as the easy additive group `Z/nZ` on the right, viewed through `g`. Every multiplicative question — order, root existence, root count, residue classification — has an additive shadow in `Z/nZ` that is elementary (gcd, linear congruence, subgroup). The catch, and the reason cryptography survives, is that *constructing* the isomorphism in one direction (`ind_g`, the discrete log) is computationally hard, even though the isomorphism provably exists. We get to *reason* with it freely (proofs, counts) but cannot always *compute* it cheaply.

---

## 10. Discrete-Root Solvability and the Count `gcd(k, φ)`

**Theorem 10.1 (Solvability and count).** Let `m` have a primitive root, `n = φ(m)`, `a` a unit, `d = gcd(k, n)`. Then `x^k ≡ a (mod m)`:

1. has a solution **iff** `d | A` (where `A = ind_g(a)`), equivalently **iff** `a^{n/d} ≡ 1 (mod m)`;
2. has exactly `d` solutions when solvable.

**Proof.** By Theorem 9.2 the problem is `kY ≡ A (mod n)`. The standard theory of linear congruences (sibling `06`, `07`) says `kY ≡ A (mod n)` is solvable iff `gcd(k, n) = d` divides `A`, and then has exactly `d` solutions mod `n`. This proves (1)'s index form and (2).

For the index-free existence form: `a^{n/d} = g^{A·n/d}`. Now `g^{A n/d} ≡ 1 (mod m)` ⟺ `n | A·(n/d)` ⟺ `d | A` (dividing by `n/d`). Hence `a^{n/d} ≡ 1 ⟺ d | A`, matching (1). ∎

**Corollary 10.2 (Euler's criterion, `k = 2`).** Mod an odd prime `p` (`n = p − 1`, `d = gcd(2, p−1) = 2`): `a` is a quadratic residue iff `a^{(p-1)/2} ≡ 1`, and then has exactly `2` square roots. This is the classical Euler criterion as the `k = 2` instance. The nonresidue case `a^{(p-1)/2} ≡ −1` (the Legendre symbol `= −1`) and the residue case `≡ +1` exhaust the units, partitioning them into `(p−1)/2` residues and `(p−1)/2` nonresidues — the `d = 2`, `n/d = (p−1)/2` instance of Corollary 10.4.

**Corollary 10.3 (Bijective case).** If `gcd(k, n) = 1`, then `x ↦ x^k` is a bijection on units: every `a` has a unique `k`-th root, namely `x = a^{k^{-1} mod n}` where `k^{-1}` is computed in `Z/nZ`. No discrete log is required in this case.

**Corollary 10.4 (`k`-th power residues).** The image of `x ↦ x^k` (the set of `k`-th power residues) is the unique subgroup of index `d`, of size `n/d`. So there are exactly `n/d` residues, each with `d` roots, partitioning the `n` units.

**Composite `m` (CRT).** For `m = ∏ p_i^{e_i}`, by CRT the solution count is the *product* of the per-prime-power counts `∏ gcd(k, φ(p_i^{e_i}))` over factors where the per-factor equation is solvable (and `0` if any factor is unsolvable). Solutions are recombined by CRT (sibling `05`).

### 10.1 Worked Solvability and Count

Mod `p = 13` (`n = 12`), solve `x^3 ≡ a`: `d = gcd(3, 12) = 3`.

- **`a = 5`.** Existence form `5^{n/d} = 5^4 = 625 = 48·13 + 1 ≡ 1`. Solvable, with `d = 3` roots. Indeed `7³ = 343 = 26·13 + 5 ≡ 5`, and the three roots are `{7, 8, 11}` (the three cube roots of `5`).
- **`a = 2`.** `2^4 = 16 ≡ 3 ≢ 1`. Not solvable: `2` is not a cubic residue. There are `n/d = 12/3 = 4` cubic residues out of `12` units, and `2` is not among them.

Mod `p = 13`, solve `x^5 ≡ a`: `d = gcd(5, 12) = 1`, the bijective case (Corollary 10.3). Every `a` has a unique `5`-th root, computed as `x = a^{5^{-1} mod 12}`. Since `5·5 = 25 ≡ 1 (mod 12)`, `5^{-1} ≡ 5`, so `x = a^5`. Check `a = 2`: `x = 2^5 = 32 ≡ 6`, and `6^5 = 7776 = 598·13 + 2 ≡ 2` ✓.

### 10.2 The Subgroup-of-Index-`d` Picture

Corollary 10.4 says the `k`-th powers form the unique subgroup `H` of index `d = gcd(k, n)`, equivalently the unique subgroup of *order* `n/d`. In the index world this is the subgroup `d·(Z/nZ) = {0, d, 2d, …}` of `Z/nZ`. The map `x ↦ x^k` becomes `Y ↦ kY` on `Z/nZ`, whose image is `gcd(k, n)·Z/nZ = d·Z/nZ` with kernel of size `d`. So "`k`-th power residues" and "preimage count" are just the image and kernel of multiplication-by-`k` on the cyclic exponent group — a one-line restatement that makes both the count `n/d` (image size) and the multiplicity `d` (kernel size) immediate from the first isomorphism theorem.

---

## 11. Complexity and Algorithmic Consequences

| Task | Method | Complexity |
|------|--------|-----------|
| One modular power `a^e mod m` | binary exponentiation | `O(log e)` mults |
| Order of `a` (given `φ` factored) | divisor reduction (Cor. 6.2) | `O(ω(φ) log φ)` |
| Test if `g` is a generator | `g^{φ/q} ≢ 1` per prime `q` (Thm 6.1) | `O(ω(φ) log φ)` |
| Find smallest generator | search `g = 2,3,…` | `O(g₀ · ω(φ) log φ)`, `g₀` conjecturally `O(log^6 p)` |
| Factor `φ(m)` (precondition) | trial / Pollard-Rho (sibling `09`) | `O(√φ)` / `O(φ^{1/4})` |
| Number of generators | `φ(φ(m))` | `O(√φ)` |
| Existence of `k`-th root | `a^{φ/gcd(k,φ)} ≡ 1` (Thm 10.1) | `O(log φ)` |
| Solve `x^k ≡ a` (all roots) | generator + discrete log + linear congruence | `O(√p)` (BSGS) dominant |

**Theorem 11.1 (Dominant cost).** Finding a primitive root mod `m` is, up to `O(ω(φ) log φ)` lower-order terms, as hard as factoring `φ(m)`.

**Proof sketch.** Given the distinct primes of `φ`, the test and search are `O(ω(φ) log φ)`. Conversely, the test *requires* the prime factorization of `φ` (without it, deciding `ord(g) = φ` reduces to knowing which proper divisors to check). No subexponential method to find a generator without factoring `φ` is known. ∎

**On the discrete log.** While *finding* a generator is easy, *inverting* `g^x` (computing `ind_g(a)`) has no known polynomial algorithm; the best general methods are `O(√p)` (BSGS, sibling `11`), `O(Σ e_i √p_i)` (Pohlig-Hellman on smooth `p − 1`), and index calculus `exp(O((log p)^{1/3}(log log p)^{2/3}))` for `p` of cryptographic size. This asymmetry — easy generator, hard log — is the foundation of Diffie-Hellman and ElGamal. The discrete-root problem inherits this: solvability is `O(log p)` (Theorem 10.1's existence form), but producing the roots needs the discrete log.

### 11.1 Pohlig-Hellman: Discrete Log on Smooth Groups

**Theorem 11.2.** If `n = φ(m) = ∏ q_i^{e_i}`, the discrete log in `⟨g⟩` can be computed in `O(Σ_i e_i(log n + √q_i))` group operations.

**Proof idea.** By CRT on the *exponent* group `Z/nZ`, it suffices to determine `ind_g(a) mod q_i^{e_i}` for each prime power. Projecting into the order-`q_i^{e_i}` subgroup (via raising to `n/q_i^{e_i}`), the log is recovered digit-by-digit in base `q_i`: each digit is one discrete log in a cyclic group of prime order `q_i`, solved by BSGS in `O(√q_i)`. There are `e_i` digits per prime, and the projections cost `O(log n)`. ∎

**Consequence.** The discrete log — and hence the *full* discrete-root pipeline — is fast precisely when `n = p − 1` is **smooth** (all prime factors small). This is the security tension: a cryptographic prime is chosen so `p − 1` has a *large* prime factor `q`, making Pohlig-Hellman as slow as a single `O(√q)` BSGS in the big subgroup, which is infeasible. The same smoothness that makes NTT primes convenient (`p − 1 = c·2^e`) would make them cryptographically *weak* — the two use cases pull in opposite directions.

### 11.2 The Reduction Chain, Summarized

```
x^k ≡ a (mod m)
  → [CRT] per prime power p^e:  x^k ≡ a (mod p^e)
  → [generator]  x = g^Y, a = g^A
  → [discrete log: BSGS / Pohlig-Hellman]  recover A
  → [extended Euclid]  k·Y ≡ A (mod φ(p^e))   →  gcd(k,φ) solutions
  → [g^Y]  lift each Y to a root x mod p^e
  → [CRT]  recombine across prime powers  →  ∏ gcd(k, φ(p^e)) roots
```

Every arrow is `O(log)` or `O(√·)` *except* the discrete log, which is the asymptotic bottleneck and the cryptographic hard step. The existence-only question (Theorem 10.1's `a^{φ/d} ≡ 1`) short-circuits the entire chain in one exponentiation.

### 11.3 A Worked Complexity Estimate

Solve `x^k ≡ a (mod p)` for `p ≈ 10^{18}` with `p − 1 = 2^{20}·3^5·q` and `q ≈ 10^{12}` prime. Factoring `p − 1` costs `O((p−1)^{1/4}) ≈ 10^{4.5}` by Pollard-Rho — feasible. Finding a generator: a handful of `IS-GENERATOR` calls, each `3` exponentiations (`ω = 3`), negligible. The discrete log by Pohlig-Hellman costs `O(20·√2 + 5·√3 + √q) ≈ √q ≈ 10^6` — dominated entirely by the single large prime factor `q`. So the whole job is `≈ 10^6` operations, dominated by one BSGS in the order-`q` subgroup. Had `q` been `≈ 10^{18}` (a safe-prime-style large factor), the `√q ≈ 10^9` log would push it to the edge of feasibility — illustrating how the *largest* prime factor of `p − 1` single-handedly sets the cost, the exact lever cryptographic parameter selection exploits.

---

## 12. Summary

- **Order divides `φ`** (Theorem 2.1): the order of any unit divides the group order, and `a^N ≡ 1 ⟺ ord(a) | N`. This bounds where orders live.
- **Order of a power** (Theorem 3.1): `ord(g^t) = n/gcd(t, n)` — the master formula from which all counting follows.
- **Existence for primes** (Theorem 4.1, Gauss): `(Z/pZ)*` is cyclic, proved by `Σ_{d|p-1} ψ(d) = p−1 = Σ φ(d)` forcing `ψ(d) = φ(d)`; the field property (a degree-`d` polynomial has ≤ `d` roots) is the one deep input.
- **Counting** (Theorem 5.1): exactly `φ(d)` elements of each order `d | φ(m)`, hence `φ(φ(m))` primitive roots; the primitive roots are `{g^t : gcd(t, φ) = 1}`.
- **The `g^{φ/q}` test** (Theorem 6.1): `g` is a generator iff `g^{φ/q} ≢ 1` for every prime `q | φ` — `ω(φ)` exponentiations, correctness by the "order is a proper divisor ⟹ some `g^{φ/q} ≡ 1`" contrapositive.
- **Existence characterization** (Theorem 7.1): cyclic iff `m ∈ {1,2,4,p^k,2p^k}`; the obstruction everywhere else is *two independent elements of order 2* (Lemma 7.2), as in `(Z/8Z)*` and any product of even-order factors.
- **Lifting** (Theorems 8.1–8.2): a prime generator lifts to `p^k` provided `g^{p-1} ≢ 1 (mod p²)` (else `g + p`), and to `2p^k` via the odd representative.
- **Index isomorphism** (Theorem 9.1): `(Z/mZ)* ≅ (Z/φZ, +)`, turning `x^k ≡ a` into the **linear congruence** `kY ≡ A (mod φ)` (Theorem 9.2).
- **Discrete-root count** (Theorem 10.1): solvable iff `a^{φ/gcd(k,φ)} ≡ 1`, and then exactly `gcd(k, φ)` roots; Euler's criterion is the `k = 2` case, and `gcd(k, φ) = 1` gives the bijective unique-root case `x = a^{k^{-1} mod φ}`.
- **Complexity** (Theorem 11.1): finding a generator is as hard as factoring `φ`; existence of a root is `O(log p)`, but producing roots needs the (hard) discrete log — the asymmetry underlying public-key cryptography.

### Cheat Table

| Statement | Result |
|-----------|--------|
| `a^N ≡ 1` | iff `ord(a) | N` |
| `ord(g^t)`, `g` generator | `φ / gcd(t, φ)` |
| `g` is a generator | iff `g^{φ/q} ≢ 1`, all primes `q | φ` |
| # primitive roots | `φ(φ(m))` |
| # elements of order `d` | `φ(d)` (`d | φ`) |
| cyclic modulus | `m ∈ {1,2,4,p^k,2p^k}` |
| `x^k ≡ a` solvable | iff `a^{φ/gcd(k,φ)} ≡ 1` |
| # of `k`-th roots | `gcd(k, φ)` if solvable, else `0` |
| unique root when | `gcd(k, φ) = 1`, root `= a^{k^{-1} mod φ}` |

### Closing Notes

- **The field property is the load-bearing hypothesis** (Section 4). "Degree-`d` polynomial has ≤ `d` roots" is what forces `ψ(d) = φ(d)` and hence cyclicity. It holds in `Z/pZ` (a field) and, by lifting, in `Z/p^kZ` and `Z/2p^kZ`; it fails everywhere else (`Z/8Z` already has four square roots of `1`), which is exactly the existence boundary `{1,2,4,p^k,2p^k}`.
- **One master formula** (Section 3): `ord(g^t) = φ/gcd(t, φ)` generates the entire counting theory — number of generators `φ(φ(m))`, count `φ(d)` per order, the index isomorphism, and the discrete-root multiplicity `gcd(k, φ)` are all corollaries of it together with the linear-congruence theory.
- **The order-2 obstruction** (Section 7, Lemma 7.2): cyclicity ⟺ at most one element of order `2`. Every non-cyclic unit group fails precisely by harboring two independent involutions — a single, memorable criterion unifying the `2^a` (`a ≥ 3`) and multi-prime cases.
- **Lifting collapses the existence list to one base case** (Section 8): prove cyclicity for `Z/pZ`, then a Hensel-type lift (guarded by the rare Wieferich condition `g^{p-1} ≢ 1 mod p²`) and the odd-representative trick cover `p^k` and `2p^k` mechanically.
- **The discrete-root problem is a linear congruence in disguise** (Sections 9–10): under the index isomorphism `x^k ≡ a` becomes `kY ≡ A (mod φ)`. Solvability and count (`gcd(k, φ)`) are pure `Z/φZ` facts; the only hard part is computing the index `A` (the discrete log), which is the cryptographic asymmetry of Section 11.
- **Smoothness is the efficiency dial** (Section 11.1): Pohlig-Hellman makes the discrete log — and the whole root pipeline — fast iff `φ = p − 1` is smooth, the same property that makes NTT primes convenient and cryptographic primes (deliberately non-smooth `p − 1`) hard.

### Complexity Cheat Table

| Task | Method | Complexity | Bottleneck? |
|------|--------|-----------|-------------|
| Order of `a` | divisor reduction | `O(ω(φ) log φ)` | needs `φ` factored |
| Test generator | `g^{φ/q}` per prime | `O(ω(φ) log φ)` | needs `φ` factored |
| Find generator | small-`g` search | `O(g₀ ω(φ) log φ)` | factoring `φ` dominates |
| # generators | `φ(φ(m))` | `O(√φ)` | — |
| Root existence | `a^{φ/d} ≡ 1` | `O(log φ)` | none — fast path |
| # of `k`-th roots | `gcd(k, φ)` if solvable | `O(log φ)` | none |
| All `k`-th roots | generator + discrete log | `O(√p)` (BSGS) | the discrete log |
| Roots, smooth `φ` | Pohlig-Hellman | `O(Σ e_i √q_i)` | the largest `q_i` |
| Roots, composite `m` | per-factor + CRT | product of factor costs | factoring `m` + logs |

### Open Threads and Connections

- **Smallest generator bound.** It is conjectured (and follows from GRH) that the least primitive root mod `p` is `O(log^6 p)`; unconditionally only much weaker bounds are known. This is why the search is fast in practice but lacks a closed form — a genuine open problem touching analytic number theory.
- **Artin's conjecture.** Whether a fixed non-square integer (e.g. `2`) is a primitive root for infinitely many primes — and the density of such primes — is Artin's conjecture, proven under GRH (Hooley). It explains why `2` and `3` so often work as generators.
- **Carmichael `λ` vs Euler `φ`.** The gap `φ(m) − λ(m)` (Section 7.2) measures non-cyclicity; `λ(m) = φ(m)` exactly on the existence list. This reframes the whole existence theorem as a statement about when the maximal element order saturates the group order.
- **Index calculus.** For cryptographic primes the discrete log (Section 11) is attacked by index calculus, subexponential but not polynomial — the quantitative basis of finite-field Diffie-Hellman security and the reason key sizes are chosen as they are.

Foundational references: Gauss, *Disquisitiones Arithmeticae* (the original primitive-root theory); Hardy & Wright, *An Introduction to the Theory of Numbers* (Ch. on primitive roots and indices); Ireland & Rosen, *A Classical Introduction to Modern Number Theory* (structure of `(Z/mZ)*`, lifting); the totient divisor-sum identity from sibling `04-fermat-euler`; linear congruences from siblings `06`/`07`; the discrete log from sibling `11-discrete-log-bsgs`; NTT roots of unity from sibling `13-ntt`.

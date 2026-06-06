# Burnside's Lemma & Pólya Enumeration — Middle Level

> **Focus:** *why* the averaging works and *when* each variant is the right tool — the rotation necklace formula derived from `gcd` cycle counts and Euler's `φ`, the **dihedral group** (reflections, i.e. bracelets) split by parity, and the **cycle index polynomial** that makes Pólya's theorem a mechanical substitution. You leave this file able to set up the correct group, write its cycle index, and read off counts for any number of colors.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [The Necklace Formula, Derived](#the-necklace-formula-derived)
5. [The Dihedral Group: Bracelets and Reflections](#the-dihedral-group-bracelets-and-reflections)
6. [The Cycle Index and Pólya's Theorem](#the-cycle-index-and-polyas-theorem)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was one rule — `#orbits = (1/|G|) Σ_g k^{c(g)}` — and one closed form for rotations. At middle level you turn those into reliable modeling decisions:

- **Which group?** Rotations only (cyclic `C_n`) for necklaces, rotations + reflections (dihedral `D_n`, size `2n`) for bracelets, and the rotation group of a polyhedron for 3D objects. Choosing wrong is the single most common error.
- **Why does the `φ`-formula work?** Because a rotation by `j` splits the `n` beads into exactly `gcd(j, n)` cycles, and counting how many rotations share each gcd value introduces Euler's totient.
- **How do reflections behave?** They split by the **parity** of `n`: odd `n` gives `n` reflections each through one vertex, even `n` gives two families.
- **What is the cycle index?** A polynomial `Z(G)` in variables `a_1, a_2, …` that records the cycle structure of every group element. Pólya's theorem says: substitute `a_i = k` (each variable becomes `k`) to count `k`-colorings, or substitute `a_i = (x^i + y^i + …)` to count colorings with per-color constraints.

These questions separate "I can plug into the necklace formula" from "I can model any symmetry-counting problem, derive its cycle index, and answer it for any palette."

---

## Deeper Concepts

### Burnside is the orbit-counting theorem

The lemma is also called the **Cauchy–Frobenius lemma** or simply the **orbit-counting theorem** (Burnside himself attributed it to Frobenius). Its statement, for a finite group `G` acting on a finite set `X` of colorings:

```
#orbits = (1/|G|) · Σ_{g∈G} |Fix(g)|,    where Fix(g) = { x ∈ X : g·x = x }.
```

The proof (full version in [`professional.md`](./professional.md)) is a double count of the set of pairs `{(g, x) : g·x = x}`: summing over `g` gives `Σ_g |Fix(g)|`; summing over `x` and using the orbit–stabilizer theorem gives `|G| · #orbits`. Equating the two counts and dividing by `|G|` yields the lemma. The practical takeaway: **counting fixed points per group element is the same as counting orbits, averaged.**

### Why fixed colorings = `k^{#cycles}`

When `g` is applied, a slot `i` is forced to have the same color as `g(i)`. Following the chain `i → g(i) → g²(i) → …` traces out a **cycle**; every slot in that cycle must carry one common color. Distinct cycles are independent. So a coloring is fixed iff it is constant on each cycle, giving exactly `k` choices per cycle and `k^{c(g)}` total, where `c(g)` is the number of cycles of `g`. This single identity converts the abstract `|Fix(g)|` into pure combinatorics.

### Cycle structure of common group elements

| Symmetry | Acts on | Cycle structure | `c(g)` |
|----------|---------|-----------------|--------|
| Identity | `n` slots | `n` fixed points | `n` |
| Rotation by `j` | `n`-bead necklace | `gcd(j, n)` cycles of length `n/gcd(j,n)` | `gcd(j, n)` |
| Reflection, odd `n` | `n`-bead necklace | 1 fixed point + `(n-1)/2` transpositions | `(n+1)/2` |
| Reflection through 2 vertices, even `n` | `n`-bead necklace | 2 fixed points + `(n-2)/2` transpositions | `n/2 + 1` |
| Reflection through 2 edges, even `n` | `n`-bead necklace | `n/2` transpositions | `n/2` |

These five rows cover every necklace/bracelet problem. The 3D groups (cube, tetrahedron) add their own rows, derived the same way (senior level).

### A worked cycle decomposition

Take `n = 6` and rotation by `j = 2`. Following slot `0`: `0 → 2 → 4 → 0` — a 3-cycle. Following slot `1`: `1 → 3 → 5 → 1` — another 3-cycle. Two cycles total, matching `gcd(2, 6) = 2`, each of length `6/2 = 3`. So rotation by 2 fixes `k^2` colorings: a coloring is unchanged iff beads `{0,2,4}` share one color and `{1,3,5}` share another. Now reflection through vertices `0` and `3` (even `n = 6`): slot `0` and `3` are fixed (on the axis), and `{1,5}`, `{2,4}` swap — so 2 fixed points + 2 transpositions = `4 = 6/2 + 1` cycles, fixing `k^4`. A reflection through edge midpoints (between `0`–`5` and `2`–`3`): `{0,5}, {1,4}, {2,3}` all swap — three transpositions, `3 = 6/2` cycles, fixing `k^3`. These three decompositions are exactly the table rows instantiated; learning to trace them by hand is the core middle-level skill.

---

## Comparison with Alternatives

### Method selection

| Method | Best when | Cost | Notes |
|--------|-----------|------|-------|
| **Brute-force orbit count** | tiny `n, k` (validation) | `O(k^n · n)` | The oracle; never for production. |
| **General Burnside loop** | arbitrary group, moderate `|G|` | `O(|G| · n)` | Cycle-count each element; works for any symmetry. |
| **Necklace closed form** | rotation-only, large `n` | `O(√n + #div)` | `(1/n)Σ_{d|n}φ(d)k^{n/d}`. |
| **Bracelet closed form** | rotation + reflection | `O(√n + #div)` | Add reflection terms by parity. |
| **Cycle index (Pólya)** | many color counts / per-color limits | `O(|G| · n)` to build | One polynomial answers all `k`; supports constraints. |

**Choose the closed form** when the group is just rotations (or dihedral) and `n` is large. **Choose the general Burnside loop** when the group is irregular (a polyhedron, or a custom symmetry). **Choose the cycle index** when you need answers for *several* palettes or per-color counts (e.g. "exactly 2 red beads").

### Burnside vs Inclusion–Exclusion

| Aspect | Burnside / Pólya | Inclusion–Exclusion (sibling `26`) |
|--------|------------------|-------------------------------------|
| Corrects for | over-counting from **symmetry** | over-counting from **overlapping sets** |
| Core operation | average fixed points over a group | alternating sum over subsets of constraints |
| Typical use | necklaces, colorings up to rotation | surjections, derangements, coprime counts |
| Output | number of orbits | size of a union/complement |

They solve different over-counting problems; occasionally combined (e.g. counting *aperiodic* necklaces uses Burnside plus Möbius inversion, sibling `32-mobius-inversion`).

---

## The Necklace Formula, Derived

### Step 1 — a rotation's cycle count is `gcd(j, n)`

Rotation by `j` sends slot `i` to `(i+j) mod n`. Starting at slot `0`, the orbit is `0, j, 2j, …` mod `n`, which returns to `0` after `n / gcd(j, n)` steps — that is the cycle length. Since all cycles of a single rotation have equal length `L = n/gcd(j,n)`, and the `n` slots partition into them, the number of cycles is `n / L = gcd(j, n)`.

### Step 2 — Burnside over rotations

```
#necklaces(n, k) = (1/n) Σ_{j=0}^{n-1} k^{gcd(j, n)}.
```

### Step 3 — group rotations by their gcd value

Among `j ∈ {0, 1, …, n-1}`, how many have `gcd(j, n) = d` for a fixed divisor `d | n`? Writing `j = d·j'`, the condition `gcd(j, n) = d` becomes `gcd(j', n/d) = 1` with `0 ≤ j' < n/d`, so there are exactly `φ(n/d)` such `j`. Substituting:

```
#necklaces(n, k) = (1/n) Σ_{d|n} φ(n/d) · k^{d}.
```

Re-indexing `d ↦ n/d` (divisors come in pairs) gives the usual symmetric form:

```
#necklaces(n, k) = (1/n) Σ_{d|n} φ(d) · k^{n/d}.
```

Both forms are identical sums over the divisors of `n`; either is fine to implement.

### Step 4 — sanity checks

- `k = 1`: `Σ_{d|n} φ(d)·1 = n` (the totient divisor-sum identity), so the count is `n/n = 1`. ✓
- `n` prime: divisors `{1, p}` give `(1/p)(φ(1)k^p + φ(p)k) = (k^p + (p-1)k)/p`, which is an integer by **Fermat's little theorem** (`k^p ≡ k mod p`). This is the same divisibility that proves Fermat combinatorially via necklaces — see `05-fermat-euler` professional level.
- `n = 6, k = 2`: divisors `1, 2, 3, 6` give `(1/6)(1·64 + 1·8 + 2·4 + 2·2) = (64+8+8+4)/6 = 84/6 = 14`. ✓

### Step 5 — connection to aperiodic necklaces

The total necklace count `N(n, k)` includes necklaces of every period dividing `n`. If you instead want only the **aperiodic** ones (orbit size exactly `n`, no smaller rotational symmetry — the "Lyndon" necklaces), swap Euler's `φ` for the Möbius function `μ`:

```
M(n, k) = (1/n) Σ_{d|n} μ(d) · k^{n/d}.
```

The two are linked by `N(n, k) = Σ_{d|n} M(d, k)` (every necklace has some primitive period `d | n`). This φ↔μ duality mirrors the divisor-sum identities `Σ_{d|n} φ(d) = n` and `Σ_{d|n} μ(d) = [n=1]`, and is developed fully at professional level and in sibling `32-mobius-inversion`. For `n = 4, k = 2`: `M(4,2) = (1/4)(μ(1)2^4 + μ(2)2^2 + μ(4)2^1) = (16 − 4 + 0)/4 = 3`.

---

## The Dihedral Group: Bracelets and Reflections

A **bracelet** can be flipped over, so its symmetry group is the **dihedral group** `D_n` of size `2n`: the `n` rotations plus `n` reflections. Burnside averages over all `2n` elements:

```
#bracelets(n, k) = (1/(2n)) [ (rotation sum) + (reflection sum) ].
```

The rotation sum is exactly `Σ_{d|n} φ(d) k^{n/d}` (the numerator of the necklace count, before dividing by `n`). The reflection sum depends on the parity of `n`.

### Odd `n`

Each of the `n` reflections passes through one vertex and the midpoint of the opposite edge. Its cycle structure is **1 fixed point + `(n-1)/2` transpositions**, so `c = 1 + (n-1)/2 = (n+1)/2` cycles, fixing `k^{(n+1)/2}` colorings. All `n` reflections are identical in structure:

```
reflection sum (odd n) = n · k^{(n+1)/2}
#bracelets(n, k) = (1/(2n)) [ Σ_{d|n} φ(d) k^{n/d} + n·k^{(n+1)/2} ].
```

### Even `n`

Reflections come in two families of `n/2` each:

- **Through two opposite vertices:** 2 fixed points + `(n-2)/2` transpositions ⟹ `c = n/2 + 1` cycles ⟹ `k^{n/2 + 1}` fixed.
- **Through two opposite edges:** `n/2` transpositions, no fixed points ⟹ `c = n/2` cycles ⟹ `k^{n/2}` fixed.

```
reflection sum (even n) = (n/2)·k^{n/2+1} + (n/2)·k^{n/2}
#bracelets(n, k) = (1/(2n)) [ Σ_{d|n} φ(d) k^{n/d} + (n/2)(k^{n/2+1} + k^{n/2}) ].
```

### Worked bracelet example

`n = 4, k = 2` (square bracelet, 2 colors). Rotation sum: `φ(1)·2^4 + φ(2)·2^2 + φ(4)·2^1 = 16 + 4 + 4 = 24`. Even-`n` reflection sum: `(4/2)(2^{3} + 2^{2}) = 2(8 + 4) = 24`. Total `(24 + 24)/(2·4) = 48/8 = 6`. So there are **6 bracelets** with 4 beads and 2 colors — coincidentally the same as the 6 necklaces here, because with only 2 colors every 4-necklace is already flip-symmetric. Try `n = 6, k = 2`: necklaces = 14, bracelets = 13 (one chiral pair merges under reflection).

---

## The Cycle Index and Pólya's Theorem

### Definition

For a group `G` acting on `n` slots, the **cycle index** is the polynomial in variables `a_1, a_2, …, a_n`:

```
Z(G) = (1/|G|) Σ_{g∈G} a_1^{j_1(g)} · a_2^{j_2(g)} · … · a_n^{j_n(g)},
```

where `j_i(g)` is the number of cycles of **length `i`** in `g`. The variable `a_i` is a placeholder "one factor per cycle of length `i`." It records the *complete* cycle-length profile of every element, not just the cycle count.

### Pólya's theorem

> Substituting `a_i = k` for all `i` into `Z(G)` gives the number of distinct `k`-colorings:
>
> `#orbits = Z(G)[a_i := k] = (1/|G|) Σ_g k^{c(g)}`  (since `Σ_i j_i = c(g)`).

That is Burnside again — but the cycle index does more. Substituting `a_i = x^i + y^i + z^i + …` (one term per color) yields a **generating function** whose coefficient of `x^{r} y^{s} …` counts colorings using each color a prescribed number of times. This is how you answer "necklaces with exactly 2 red and 3 blue beads."

### Cycle index of the cyclic group `C_n`

Because rotation by `j` has `gcd(j, n)` cycles all of length `n/gcd(j, n)`:

```
Z(C_n) = (1/n) Σ_{d|n} φ(d) · a_d^{n/d}.
```

Setting `a_d = k` recovers the necklace formula immediately. For `n = 4`:

```
Z(C_4) = (1/4)( a_1^4 + a_2^2 + 2·a_4 ).
```

`a_1^4` is the identity (four 1-cycles), `a_2^2` is rotation by 2 (two 2-cycles), `2·a_4` is rotations by 1 and 3 (each one 4-cycle).

### Cycle index of the dihedral group `D_n`

`Z(D_n) = (1/2) Z(C_n) + (reflection part)/(2)`, with the reflection part built from the parity cases above. For `n = 4`:

```
Z(D_4) = (1/8)( a_1^4 + 2·a_4 + 3·a_2^2 + 2·a_1^2 a_2 ).
```

The `3·a_2^2` collects rotation-by-2 *and* the two edge-reflections (each two 2-cycles); `2·a_1^2 a_2` is the two vertex-reflections (two fixed points + one transposition). Setting all `a_i = k`: `(1/8)(k^4 + 2k + 3k^2 + 2k^3)`; for `k=2`: `(16 + 4 + 12 + 16)/8 = 48/8 = 6`. ✓

### Reading a cycle index: what each variable means

The cycle index is easy to misread. The variable `a_i` is **not** "color `i`" and **not** "`k^i`" — it is a placeholder for "one cycle of length `i`." A monomial like `a_1^2 a_2` means an element with two fixed points (1-cycles) and one transposition (2-cycle); its total cycle count is `2 + 1 = 3`, so it fixes `k^3` colorings. The exponent on `a_i` counts how many length-`i` cycles there are; the *subscript* is the cycle length. Two consistency checks always hold for every monomial: the cycle lengths times their multiplicities sum to `n` (`Σ_i i·j_i = n`, since cycles partition the slots), and the sum of exponents is the cycle count (`Σ_i j_i = c(g)`). When you finally substitute `a_i = k`, every monomial collapses to `k^{c(g)}` and you recover Burnside.

### Worked per-color count (generating function)

Count 2-color (`x`=red, `y`=blue) necklaces of length 4 by composition. Substitute `a_i = x^i + y^i` into `Z(C_4) = (1/4)(a_1^4 + a_2^2 + 2a_4)`:

```
a_1^4 = (x+y)^4,   a_2^2 = (x^2+y^2)^2,   a_4 = x^4 + y^4.
Z = (1/4)[ (x+y)^4 + (x^2+y^2)^2 + 2(x^4+y^4) ].
```

Expanding and dividing, the coefficient of `x^2 y^2` (exactly 2 red, 2 beads blue) is `2` — there are 2 distinct necklaces with two red and two blue beads (adjacent pair `RRBB` and alternating `RBRB`). The coefficient of `x^4` is `1` (all red), of `x^3 y` is `1`, summing to the total `1+1+2+1+1 = 6`. The cycle index gives the *full distribution*, not just the total.

---

## Code Examples

### Necklaces and bracelets via closed form

#### Go

```go
package main

import "fmt"

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func powInt(base, exp int) int {
	r := 1
	for i := 0; i < exp; i++ {
		r *= base
	}
	return r
}

func totient(m int) int {
	res := m
	for p := 2; p*p <= m; p++ {
		if m%p == 0 {
			for m%p == 0 {
				m /= p
			}
			res -= res / p
		}
	}
	if m > 1 {
		res -= res / m
	}
	return res
}

// rotationSum = Σ_{d|n} φ(d) k^{n/d}  (numerator of necklace count).
func rotationSum(n, k int) int {
	sum := 0
	for d := 1; d*d <= n; d++ {
		if n%d == 0 {
			sum += totient(d) * powInt(k, n/d)
			if d != n/d {
				e := n / d
				sum += totient(e) * powInt(k, n/e)
			}
		}
	}
	return sum
}

func necklaces(n, k int) int { return rotationSum(n, k) / n }

func bracelets(n, k int) int {
	reflect := 0
	if n%2 == 1 {
		reflect = n * powInt(k, (n+1)/2)
	} else {
		reflect = (n/2)*powInt(k, n/2+1) + (n/2)*powInt(k, n/2)
	}
	return (rotationSum(n, k) + reflect) / (2 * n)
}

func main() {
	fmt.Println(necklaces(6, 2)) // 14
	fmt.Println(bracelets(6, 2)) // 13
	fmt.Println(necklaces(4, 2)) // 6
	fmt.Println(bracelets(4, 2)) // 6
}
```

#### Java

```java
public class Necklaces {
    static int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }

    static int powInt(int base, int exp) {
        int r = 1;
        for (int i = 0; i < exp; i++) r *= base;
        return r;
    }

    static int totient(int m) {
        int res = m;
        for (int p = 2; (long) p * p <= m; p++)
            if (m % p == 0) {
                while (m % p == 0) m /= p;
                res -= res / p;
            }
        if (m > 1) res -= res / m;
        return res;
    }

    static int rotationSum(int n, int k) {
        int sum = 0;
        for (int d = 1; (long) d * d <= n; d++) {
            if (n % d == 0) {
                sum += totient(d) * powInt(k, n / d);
                if (d != n / d) {
                    int e = n / d;
                    sum += totient(e) * powInt(k, n / e);
                }
            }
        }
        return sum;
    }

    static int necklaces(int n, int k) { return rotationSum(n, k) / n; }

    static int bracelets(int n, int k) {
        int reflect;
        if (n % 2 == 1) reflect = n * powInt(k, (n + 1) / 2);
        else reflect = (n / 2) * powInt(k, n / 2 + 1) + (n / 2) * powInt(k, n / 2);
        return (rotationSum(n, k) + reflect) / (2 * n);
    }

    public static void main(String[] args) {
        System.out.println(necklaces(6, 2)); // 14
        System.out.println(bracelets(6, 2)); // 13
        System.out.println(necklaces(4, 2)); // 6
        System.out.println(bracelets(4, 2)); // 6
    }
}
```

#### Python

```python
from math import gcd


def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def rotation_sum(n, k):
    """Σ_{d|n} φ(d) k^{n/d}."""
    s, d = 0, 1
    while d * d <= n:
        if n % d == 0:
            s += totient(d) * k ** (n // d)
            if d != n // d:
                e = n // d
                s += totient(e) * k ** (n // e)
        d += 1
    return s


def necklaces(n, k):
    return rotation_sum(n, k) // n


def bracelets(n, k):
    if n % 2 == 1:
        reflect = n * k ** ((n + 1) // 2)
    else:
        reflect = (n // 2) * k ** (n // 2 + 1) + (n // 2) * k ** (n // 2)
    return (rotation_sum(n, k) + reflect) // (2 * n)


if __name__ == "__main__":
    print(necklaces(6, 2))  # 14
    print(bracelets(6, 2))  # 13
    print(necklaces(4, 2))  # 6
    print(bracelets(4, 2))  # 6
```

### General Burnside with explicit cycle counting (any group)

```python
def count_cycles(perm):
    n, seen, cycles = len(perm), [False] * len(perm), 0
    for s in range(n):
        if not seen[s]:
            cycles += 1
            j = s
            while not seen[j]:
                seen[j] = True
                j = perm[j]
    return cycles


def rotations(n):
    return [[(i + j) % n for i in range(n)] for j in range(n)]


def reflections(n):
    # reflection r maps slot i -> (offset - i) mod n for each axis offset
    return [[(off - i) % n for i in range(n)] for off in range(n)]


def burnside(group, k):
    return sum(k ** count_cycles(g) for g in group) // len(group)


if __name__ == "__main__":
    n, k = 6, 2
    print(burnside(rotations(n), k))                  # 14 (necklaces)
    print(burnside(rotations(n) + reflections(n), k)) # 13 (bracelets)
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Used `C_n` for a bracelet problem | Over-counts chiral (mirror-image) pairs | Use `D_n` (add reflections), size `2n`. |
| Reflection cycle count wrong for even `n` | Mixed up vertex- vs edge-axis families | Vertex axis: `n/2+1` cycles; edge axis: `n/2`. |
| Non-integer Burnside result | Missing/extra group element, or wrong `|Fix|` | The sum must be divisible by `|G|`; recheck `G`. |
| `gcd(0, n)` mishandled | Identity rotation miscounted | `gcd(0,n)=n` ⟹ `n` cycles ⟹ `k^n`. |
| Overflow in `k^{n/d}` | Large `n` or `k` exceeds 64-bit | Big integers or modular arithmetic. |
| Cycle index variables confused | Used `a_i = k^i` instead of `a_i = k` | For plain `k`-colorings set every `a_i = k`. |

---

## Performance Analysis

| Task | Scale | Cost |
|------|-------|------|
| Necklace/bracelet closed form | `n ≤ 10^9` | `O(√n + #div · log)` — factoring dominates |
| General Burnside loop | `|G|` up to `~10^6`, `n` up to `~10^6` | `O(|G| · n)` |
| Brute-force orbit count | `k^n ≤ ~10^7` | `O(k^n · n)` — validation only |
| Cycle index build (Pólya) | `|G| · n` | `O(|G| · n)` to enumerate; polynomial ops extra |
| Totient sieve for many `n` | `N ≤ 10^7` | `O(N log log N)` |

The closed form is the clear winner for rotation/dihedral groups: `O(√n)` versus `O(n)` for the loop and `O(k^n)` for brute force. For polyhedral or custom groups you must enumerate `G`, so the `O(|G| · n)` loop is unavoidable — but `|G|` is small (24 for the cube's rotations, 48 with reflections), making it trivial.

```python
import time

def benchmark(n, k):
    start = time.perf_counter()
    _ = necklaces(n, k)
    return time.perf_counter() - start

# necklaces(10**9, 2) returns essentially instantly: only divisors of 10^9 touched.
```

---

## Best Practices

- **Decide the group first** and write it down: `C_n` (necklace), `D_n` (bracelet), polyhedral rotation group (3D). The rest is mechanical.
- **Prefer the closed form** for rotation/dihedral groups; reach for the general loop only for irregular groups.
- **Build the cycle index** when you need several palettes or per-color counts — one polynomial serves all queries.
- **Validate with the brute-force oracle** on small `n, k`, and use the `k=1 ⟹ 1` and divisibility sanity checks.
- **Reuse `φ`** via a sieve when answering many `n` (sibling `05-fermat-euler`).
- **Reduce everything to cycle counting** — `count_cycles(perm)` plus the master rule is enough for any group you can enumerate.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Stepping through each rotation **and reflection** of a bead necklace, showing the cycle decomposition (which beads move together).
> - The fixed colorings for the current symmetry and the count `k^{#cycles}`.
> - The running average of fixed counts converging to the orbit total — necklace (rotations) vs bracelet (rotations + reflections).
> - Editable `n` and `k`, so you can watch the reflection terms change by parity.

---

## Summary

Burnside's lemma (the orbit-counting / Cauchy–Frobenius theorem) counts distinct objects as the average fixed-point count over a group, and the only computation is **cycle counting**: `|Fix(g)| = k^{c(g)}`. For an `n`-bead necklace, rotation by `j` has `gcd(j, n)` cycles, and grouping rotations by gcd introduces Euler's `φ`, giving the closed form `(1/n) Σ_{d|n} φ(d) k^{n/d}`. **Bracelets** add reflections — the dihedral group `D_n` of size `2n` — whose contribution splits by the parity of `n`: odd `n` gives `n·k^{(n+1)/2}`, even `n` gives `(n/2)(k^{n/2+1} + k^{n/2})`. The **cycle index** `Z(G) = (1/|G|) Σ_g ∏_i a_i^{j_i(g)}` packages every element's cycle profile; **Pólya's theorem** says substitute `a_i = k` for the count of `k`-colorings, or `a_i = x^i + y^i + …` for a generating function that resolves per-color counts. Choose `C_n` for necklaces, `D_n` for bracelets, the polyhedral group for 3D, and the cycle index when you need many palettes — then the answer is a substitution away.

---

Next step: [senior.md](./senior.md) — large symmetry-counting problems (cube faces, graphs up to isomorphism), building groups and cycle indices programmatically, modular arithmetic for huge counts, and performance engineering.

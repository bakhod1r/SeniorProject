# Burnside's Lemma & Pólya Enumeration — Interview Preparation

Burnside and Pólya are interview favourites because they reward one crisp insight — *"the number of distinct objects up to symmetry is the average number of colorings each symmetry leaves fixed: `(1/|G|) Σ_g k^{c(g)}`"* — and then test whether you can (a) identify the correct symmetry group (rotations `C_n` vs rotations-plus-reflections `D_n` vs a polyhedral group), (b) count the **cycles** of each group element, (c) collapse rotations into the necklace formula `(1/n) Σ_{d|n} φ(d) k^{n/d}`, and (d) avoid the classic trap of dividing `k^n` by `|G|` directly. This file is a tiered question bank, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Count objects up to symmetry | Burnside `(1/|G|) Σ_g k^{c(g)}` | `O(|G|·n)` |
| Fixed colorings of one symmetry | `k^{c(g)}` (`c(g)` = #cycles) | `O(n)` to count cycles |
| Cycles of rotation by `j` (n beads) | `gcd(j, n)` | `O(log n)` |
| Necklaces (rotation only) | `(1/n) Σ_{d|n} φ(d) k^{n/d}` | `O(√n + #div)` |
| Bracelets (rotation + reflection) | necklace term + reflection terms by parity | `O(√n)` |
| Cube faces, `k` colors | `(1/24)(k^6 + 3k^4 + 12k^3 + 8k^2)` | `O(1)` |
| Per-color counts | cycle index with `a_i = Σ_c w_c^i` | depends |
| Answer mod `p` | divide by `|G|` via Fermat inverse | `O(log p)` |

Key facts:
- **`|Fix(g)| = k^{c(g)}`** — fixed colorings equal `k` to the cycle count.
- Rotation by `j` has **`gcd(j, n)`** cycles; identity has **`n`** cycles.
- **Necklaces** use `C_n` (size `n`); **bracelets** use `D_n` (size `2n`).
- The Burnside average is **always an integer** — a fraction means a bug.
- Dividing `k^n` by `|G|` directly is **wrong** — average fixed counts.
- Mod `p`: the `(1/|G|)` is a **Fermat modular inverse** `|G|^{p-2} mod p`.

Core routine:

```text
count_cycles(perm):              # O(n) with visited array
    seen = [F]*n; cycles = 0
    for s in 0..n-1:
        if not seen[s]:
            cycles += 1
            j = s
            while not seen[j]: seen[j]=T; j = perm[j]
    return cycles

#orbits = (Σ_g k^{count_cycles(g)}) / |G|
necklaces(n,k) = (1/n) Σ_{d|n} φ(d) k^{n/d}
```

---

## Junior Questions (12 Q&A)

### J1. State Burnside's lemma in one sentence.
The number of distinct objects under a symmetry group `G` equals the average, over all `g ∈ G`, of the number of colorings that `g` leaves completely unchanged: `#orbits = (1/|G|) Σ_g |Fix(g)|`.

### J2. Why is dividing `k^n` by `|G|` wrong?
Because symmetric colorings (like all-one-color) are fixed by *many* group elements and should not be divided down as hard as generic colorings. Burnside averages the fixed counts, which correctly weights each orbit; plain division ignores that and usually gives a non-integer.

### J3. What is `Fix(g)`?
The set of colorings that look identical after applying symmetry `g` — i.e. `g` maps the coloring to itself. Its size is `|Fix(g)|`.

### J4. Why does `|Fix(g)| = k^{c(g)}`?
A symmetry forces every slot in the same cycle to share one color. With `c(g)` independent cycles and `k` colors, you choose one color per cycle freely: `k^{c(g)}` fixed colorings.

### J5. How many cycles does rotation by `j` of an `n`-bead necklace have?
Exactly `gcd(j, n)` cycles, each of length `n/gcd(j, n)`.

### J6. How many cycles does the identity have?
`n` — every slot is its own fixed point (a 1-cycle), so it fixes all `k^n` colorings.

### J7. State the necklace formula (rotations only).
`#necklaces(n, k) = (1/n) Σ_{d|n} φ(d) · k^{n/d}`, summing over divisors `d` of `n` weighted by Euler's totient `φ`.

### J8. Count distinct 3-bead 2-color necklaces by Burnside.
Rotations by 0,1,2 have `3,1,1` cycles, so `(2^3 + 2^1 + 2^1)/3 = (8+2+2)/3 = 12/3 = 4`.

### J9. What's the difference between a necklace and a bracelet?
A necklace allows only rotations (group `C_n`, size `n`); a bracelet can also be flipped over (group `D_n`, size `2n`, adding reflections).

### J10. What is an orbit?
The set of all colorings reachable from one another by symmetries — "the same object." The count we want is the number of orbits.

### J11. What does `k = 1` give and why?
Always `1` — there is only one object when there's a single color. The formula gives `(1/n)Σ_{d|n}φ(d) = n/n = 1` using `Σ_{d|n}φ(d) = n`.

### J12 (analysis). Why is the necklace formula faster than enumerating all colorings?
Enumeration visits `k^n` colorings (exponential); the formula touches only the `O(√n)` divisors of `n` plus a totient and a power each — sub-linear in `n`.

---

## Middle Questions (12 Q&A)

### M1. Derive the necklace formula from Burnside.
Burnside gives `(1/n) Σ_{j=0}^{n-1} k^{gcd(j,n)}`. Group the `j` by `gcd(j,n) = d`; there are `φ(n/d)` such `j`. Re-index to get `(1/n) Σ_{d|n} φ(d) k^{n/d}`.

### M2. How do reflections of an odd-`n` necklace behave?
Each reflection passes through one vertex and the opposite edge midpoint: 1 fixed point + `(n-1)/2` transpositions, so `(n+1)/2` cycles, fixing `k^{(n+1)/2}` colorings. All `n` reflections are identical.

### M3. How do reflections of an even-`n` necklace split?
Two families of `n/2` each: through two opposite vertices (`n/2 + 1` cycles, `k^{n/2+1}` fixed) and through two opposite edges (`n/2` cycles, `k^{n/2}` fixed).

### M4. Give the bracelet formula for even `n`.
`(1/(2n))[ Σ_{d|n} φ(d) k^{n/d} + (n/2)(k^{n/2+1} + k^{n/2}) ]`.

### M5. What is the cycle index of a group?
`Z(G) = (1/|G|) Σ_g ∏_i a_i^{j_i(g)}`, where `j_i(g)` is the number of cycles of length `i`. It records every element's full cycle-length profile.

### M6. How does Pólya's theorem use the cycle index?
Substitute `a_i = k` for all `i` to get the count of `k`-colorings (that's Burnside). Substitute `a_i = x^i + y^i + …` to get a generating function whose coefficients count colorings with specific per-color tallies.

### M7. Write `Z(C_4)` and `Z(D_4)`.
`Z(C_4) = (1/4)(a_1^4 + a_2^2 + 2a_4)`; `Z(D_4) = (1/8)(a_1^4 + 2a_4 + 3a_2^2 + 2a_1^2 a_2)`.

### M8. How do you count cycles of an arbitrary permutation?
Walk each unvisited slot around its cycle with a visited array, incrementing a counter once per new cycle: `O(n)`.

### M9. Why is the Burnside average always an integer?
Because it equals a count of orbits (Cauchy–Frobenius). The integer sum `Σ_g k^{c(g)}` is provably divisible by `|G|`; a fractional result signals a wrong group or fixed count.

### M10. Count 2-color bracelets of length 6.
Rotation sum for `n=6,k=2` is `64+8+8+4 = 84`; even-`n` reflections add `(6/2)(2^4 + 2^3) = 3(16+8) = 72`; total `(84+72)/12 = 156/12 = 13`.

### M11. How would you count necklaces with exactly 2 red and 2 blue beads (n=4)?
Use the weighted cycle index: substitute `a_i = x^i + y^i` into `Z(C_4)` and read the coefficient of `x^2 y^2`, which is `2`.

### M12 (analysis). Compare the cost of the general Burnside loop vs the closed form.
General loop: `O(|G|·n)` (cycle-count each element). Closed form for rotations: `O(√n)` (divisors only). For large `n` the closed form is exponentially cheaper since `|G| = n`.

---

## Senior Questions (10 Q&A)

### S1. How do you count colorings of a cube's faces?
The cube rotation group has 24 elements in 5 conjugacy classes acting on the 6 faces. Burnside gives `(1/24)(k^6 + 6k^3 + 3k^4 + 8k^2 + 6k^3) = (1/24)(k^6 + 3k^4 + 12k^3 + 8k^2)`; `k=2 ⟹ 10`.

### S2. How do you count graphs up to isomorphism on `n` vertices?
Color the `C(n,2)` edges with `k=2` (present/absent), under `S_n` acting on vertices and *inducing* a permutation on edges. Burnside: `(1/n!) Σ_{σ∈S_n} 2^{c(σ̂)}` where `σ̂` is the induced edge permutation. Sum over the `p(n)` cycle types, not all `n!` elements.

### S3. What is the induced action and why does it matter?
A vertex permutation `σ` induces `σ̂({u,v}) = {σ(u),σ(v)}` on edges. You apply Burnside to `σ̂`, not `σ` — counting cycles of the induced permutation. Getting this wrong is the central bug in graph/polyhedron counting.

### S4. How do you count cycles of the induced edge permutation from a cycle type?
Within a vertex-cycle of length `L`: `⌊L/2⌋` edge-cycles. Between two vertex-cycles of lengths `a,b`: `gcd(a,b)` edge-cycles. Sum over the cycle type.

### S5. How do you return a Burnside answer mod a prime `p`?
Compute `Σ_g powmod(k, c(g), p)` mod `p`, then multiply by the modular inverse of `|G|`: `inverse = powmod(|G|, p-2, p)` (Fermat). Valid because the integer sum is divisible by `|G|` and `gcd(|G|, p) = 1`.

### S6. When is the modular-inverse division invalid?
When `p | |G|` (so `gcd(|G|,p) ≠ 1` and the inverse doesn't exist). Assert `|G| % p != 0`; otherwise compute the exact integer sum with big integers and divide.

### S7. How do you build a symmetry group from generators?
BFS/DFS closure: start from the identity, repeatedly compose with generators, add new permutations to the set until closed. Terminates because `|G| | n!`. The cube rotation group has 24 elements this way.

### S8. Why sum over cycle types instead of enumerating `S_n`?
Permutations with the same cycle type have the same `c(σ̂)`, so they contribute equally. There are only `p(n)` cycle types (`p(10)=42`) vs `n!` permutations (`10! = 3.6M`) — a massive reduction.

### S9. How do you validate a Burnside implementation?
Brute-force orbit count for small `n,k`; the `k=1 ⟹ 1` check; divisibility of the integer sum by `|G|`; closure of a generated group; and cross-checking necklace/graph counts against OEIS (A000031, A000088).

### S10 (analysis). What's the complexity of counting graphs up to isomorphism per `n`?
`O(p(n) · n²)`: `p(n)` cycle types, each costing `O(n²)` to compute the induced edge-cycle count and conjugacy-class size. Sub-`n!` but super-polynomial, and the output integers grow as `2^{C(n,2)}/n!`.

---

## Professional Questions (8 Q&A)

### P1. Prove Burnside's lemma.
Double-count `S = {(g,x): g·x = x}`. By `g`: `|S| = Σ_g |Fix(g)|`. By `x`: `|S| = Σ_x |Stab(x)|`. Group the second by orbits; each orbit `O` contributes `Σ_{x∈O} |G|/|O| = |G|` (orbit–stabilizer). So `|S| = |G|·#orbits`. Equate and divide by `|G|`.

### P2. State and prove the orbit–stabilizer theorem.
`|Orb(x)|·|Stab(x)| = |G|`. Proof: the map `g·Stab(x) ↦ g·x` is a well-defined bijection from left cosets of `Stab(x)` to `Orb(x)` (the iff `g·x = h·x ⟺ g·Stab(x) = h·Stab(x)` gives well-definedness and injectivity; surjectivity is by definition of orbit). Hence `|Orb(x)| = [G:Stab(x)] = |G|/|Stab(x)|`.

### P3. Why is `Σ_{d|n} φ(d) k^{n/d}` divisible by `n`?
Because `(1/n)` of it counts orbits (an integer). For `n = p` prime it reduces to `(k^p + (p-1)k)/p`, integer iff `k^p ≡ k (mod p)` — exactly Fermat's little theorem. The general case is the necklace-orbit interpretation.

### P4. Derive the aperiodic (Lyndon) necklace count.
Group colorings by minimal period `d | n`: `k^n = Σ_{d|n} d·M(d,k)`. Möbius inversion gives `M(n,k) = (1/n) Σ_{d|n} μ(d) k^{n/d}`, the count of orbits of full size `n`.

### P5. State the weighted Pólya theorem.
The orbit-weight generating function is `Z(G; p_1, p_2, …)` where `p_i = Σ_c w_c^i` are the power sums of the color weights. A cycle of length `i` colored `c` contributes `w_c^i`; summing over colors gives `p_i`, and independent cycles multiply.

### P6. Derive `Z(D_n)` from `Z(C_n)`.
`Z(D_n) = (1/2)Z(C_n) + R_n`. The rotations halve `Z(C_n)` (averaging over `2n`). Reflections give `R_n = (1/2)a_1 a_2^{(n-1)/2}` for odd `n`, and `(1/4)(a_1^2 a_2^{(n-2)/2} + a_2^{n/2})` for even `n`, from the parity-split cycle structures.

### P7. How does the cycle index relate to conjugacy classes?
Two permutations are conjugate in `S_n` iff they have the same cycle type, and conjugate elements have identical cycle-index monomials. So `Z(G)` can be computed by summing over conjugacy classes weighted by class size — the basis of the efficient `S_n` graph-counting algorithm.

### P8 (analysis). Why is Burnside optimal for graph counting up to output size?
The exact count of graphs on `n` vertices is `≈ 2^{C(n,2)}/n!`, requiring `Ω(n²)` output bits. The partition-sum Burnside computes it in `O(p(n)·n²)` time — sub-`n!` and within a polynomial factor of the unavoidable output magnitude, so no algorithm can be asymptotically much better at producing the exact integer.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential count with a symmetry-aware one.
Look for a concrete story: a "count distinct configurations" task naively enumerating `k^n` cases, the observation that many were equivalent under rotation/relabeling, applying Burnside/Pólya to collapse it to a divisor sum, and a measured speedup from minutes to milliseconds, plus a brute-force cross-check on small cases.

### B2. A teammate divided `k^n` by `|G|` and shipped a non-integer count. How do you handle it?
Calmly explain that Burnside averages *fixed* counts, not the total, with a tiny counterexample (4-bead 2-color: `16/4 = 4` but the answer is `6`). Show the cycle-count rule and the integer-sum divisibility check. Frame it as a teaching moment about the lemma's precondition.

### B3. Design a service that counts distinct tile/bead patterns under symmetry.
Discuss identifying the group (rotation vs dihedral vs board symmetries), reducing to cycle counting per group element, using the closed form for large `n`, returning answers mod a prime via Fermat inverse, caching `|G|^{-1}`, and validating against a brute-force oracle on small inputs.

### B4. How would you explain Burnside to a junior engineer?
Use the spinning-top analogy: ask every viewing angle "how many designs look frozen from here," then average — symmetric designs are counted from many angles, generic ones only from straight-on, so the average lands exactly on the number of truly distinct designs. Lead with: don't just divide by the number of symmetries.

### B5. Your symmetry-counting code is slow on large `n`. How do you investigate?
Check whether it enumerates colorings (`k^n` — exponential, the cardinal sin) or the group (`|G|`). Switch rotation groups to the `O(√n)` closed form; switch `S_n` to the `p(n)` cycle-type sum; cache totients and the modular inverse; ensure no big-integer churn when a modulus suffices.

---

## Coding Challenges

### Challenge 1: Count Necklaces (Rotations Only)

**Problem.** Given `n` (beads) and `k` (colors), count distinct necklaces up to rotation.

**Example.**
```text
n = 4, k = 2  ->  6
n = 3, k = 3  ->  11
n = 6, k = 2  ->  14
```

**Constraints.** `1 ≤ n ≤ 10^9`, `1 ≤ k ≤ 10^9`. Return the answer mod `10^9 + 7` for large inputs.

**Optimal.** `(1/n) Σ_{d|n} φ(d) k^{n/d}` over divisors of `n`, with the `(1/n)` as a Fermat modular inverse. `O(√n + #div · log)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func powMod(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func totient(m int64) int64 {
	res := m
	for p := int64(2); p*p <= m; p++ {
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

func necklaces(n, k int64) int64 {
	sum := int64(0)
	for d := int64(1); d*d <= n; d++ {
		if n%d == 0 {
			sum = (sum + totient(d)%MOD*powMod(k, n/d, MOD)) % MOD
			if d != n/d {
				e := n / d
				sum = (sum + totient(e)%MOD*powMod(k, n/e, MOD)) % MOD
			}
		}
	}
	return sum % MOD * powMod(n%MOD, MOD-2, MOD) % MOD // (1/n) via Fermat
}

func main() {
	fmt.Println(necklaces(4, 2)) // 6
	fmt.Println(necklaces(3, 3)) // 11
	fmt.Println(necklaces(6, 2)) // 14
}
```

**Java.**
```java
public class Necklaces {
    static final long MOD = 1_000_000_007L;

    static long powMod(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long totient(long m) {
        long res = m;
        for (long p = 2; p * p <= m; p++)
            if (m % p == 0) {
                while (m % p == 0) m /= p;
                res -= res / p;
            }
        if (m > 1) res -= res / m;
        return res;
    }

    static long necklaces(long n, long k) {
        long sum = 0;
        for (long d = 1; d * d <= n; d++) {
            if (n % d == 0) {
                sum = (sum + totient(d) % MOD * powMod(k, n / d, MOD)) % MOD;
                if (d != n / d) {
                    long e = n / d;
                    sum = (sum + totient(e) % MOD * powMod(k, n / e, MOD)) % MOD;
                }
            }
        }
        return sum % MOD * powMod(n % MOD, MOD - 2, MOD) % MOD;
    }

    public static void main(String[] args) {
        System.out.println(necklaces(4, 2)); // 6
        System.out.println(necklaces(3, 3)); // 11
        System.out.println(necklaces(6, 2)); // 14
    }
}
```

**Python.**
```python
from math import gcd

MOD = 10**9 + 7


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


def necklaces(n, k):
    s, d = 0, 1
    while d * d <= n:
        if n % d == 0:
            s = (s + totient(d) * pow(k, n // d, MOD)) % MOD
            if d != n // d:
                e = n // d
                s = (s + totient(e) * pow(k, n // e, MOD)) % MOD
        d += 1
    return s * pow(n, MOD - 2, MOD) % MOD  # (1/n) via Fermat


if __name__ == "__main__":
    print(necklaces(4, 2))  # 6
    print(necklaces(3, 3))  # 11
    print(necklaces(6, 2))  # 14
```

---

### Challenge 2: General Burnside Over an Arbitrary Group

**Problem.** Given a list of permutations (each describing one symmetry) and `k` colors, count distinct colorings.

**Example.**
```text
group = all 4 rotations of a square, k = 2  ->  6
group = rotations + reflections (D_4), k = 2 ->  6
```

**Constraints.** `|G| ≤ 10^5`, each permutation of length `n ≤ 10^5`, `k ≤ 100`. Answer mod `10^9+7`.

**Optimal.** `(Σ_g k^{count_cycles(g)}) · |G|^{-1} mod p`, with `O(n)` cycle counting per element.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func powMod(a, e, m int64) int64 {
	a %= m
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func countCycles(p []int) int {
	seen := make([]bool, len(p))
	cycles := 0
	for s := range p {
		if !seen[s] {
			cycles++
			for j := s; !seen[j]; j = p[j] {
				seen[j] = true
			}
		}
	}
	return cycles
}

func burnside(group [][]int, k int64) int64 {
	sum := int64(0)
	for _, g := range group {
		sum = (sum + powMod(k, int64(countCycles(g)), MOD)) % MOD
	}
	inv := powMod(int64(len(group)), MOD-2, MOD)
	return sum * inv % MOD
}

func main() {
	rot := [][]int{{0, 1, 2, 3}, {1, 2, 3, 0}, {2, 3, 0, 1}, {3, 0, 1, 2}}
	fmt.Println(burnside(rot, 2)) // 6
}
```

**Java.**
```java
import java.util.*;

public class BurnsideGeneral {
    static final long MOD = 1_000_000_007L;

    static long powMod(long a, long e, long m) {
        a %= m; long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m; e >>= 1;
        }
        return r;
    }

    static int countCycles(int[] p) {
        boolean[] seen = new boolean[p.length];
        int cycles = 0;
        for (int s = 0; s < p.length; s++)
            if (!seen[s]) {
                cycles++;
                for (int j = s; !seen[j]; j = p[j]) seen[j] = true;
            }
        return cycles;
    }

    static long burnside(int[][] group, long k) {
        long sum = 0;
        for (int[] g : group) sum = (sum + powMod(k, countCycles(g), MOD)) % MOD;
        return sum * powMod(group.length, MOD - 2, MOD) % MOD;
    }

    public static void main(String[] args) {
        int[][] rot = {{0,1,2,3},{1,2,3,0},{2,3,0,1},{3,0,1,2}};
        System.out.println(burnside(rot, 2)); // 6
    }
}
```

**Python.**
```python
MOD = 10**9 + 7


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


def burnside(group, k):
    total = sum(pow(k, count_cycles(g), MOD) for g in group) % MOD
    return total * pow(len(group), MOD - 2, MOD) % MOD


if __name__ == "__main__":
    rot = [[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2]]
    print(burnside(rot, 2))  # 6
```

---

### Challenge 3: Color a Cube's Faces

**Problem.** Count distinct ways to color the 6 faces of a cube with `k` colors, up to rotation.

**Example.**
```text
k = 2  ->  10
k = 3  ->  57
k = 6  ->  2226
```

**Constraints.** `1 ≤ k ≤ 10^6`. Answer mod `10^9+7` for large `k`.

**Optimal.** `(1/24)(k^6 + 3k^4 + 12k^3 + 8k^2)` — the cube's face cycle index evaluated at `k`. `O(log k)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func powMod(a, e, m int64) int64 {
	a %= m
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func cubeFaces(k int64) int64 {
	sum := (powMod(k, 6, MOD) +
		3*powMod(k, 4, MOD) +
		12*powMod(k, 3, MOD) +
		8*powMod(k, 2, MOD)) % MOD
	return sum * powMod(24, MOD-2, MOD) % MOD
}

func main() {
	fmt.Println(cubeFaces(2)) // 10
	fmt.Println(cubeFaces(3)) // 57
	fmt.Println(cubeFaces(6)) // 2226
}
```

**Java.**
```java
public class CubeColor {
    static final long MOD = 1_000_000_007L;

    static long powMod(long a, long e, long m) {
        a %= m; long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m; e >>= 1;
        }
        return r;
    }

    static long cubeFaces(long k) {
        long sum = (powMod(k, 6, MOD)
                + 3 * powMod(k, 4, MOD)
                + 12 * powMod(k, 3, MOD)
                + 8 * powMod(k, 2, MOD)) % MOD;
        return sum * powMod(24, MOD - 2, MOD) % MOD;
    }

    public static void main(String[] args) {
        System.out.println(cubeFaces(2)); // 10
        System.out.println(cubeFaces(3)); // 57
        System.out.println(cubeFaces(6)); // 2226
    }
}
```

**Python.**
```python
MOD = 10**9 + 7


def cube_faces(k):
    s = (pow(k, 6, MOD) + 3 * pow(k, 4, MOD)
         + 12 * pow(k, 3, MOD) + 8 * pow(k, 2, MOD)) % MOD
    return s * pow(24, MOD - 2, MOD) % MOD


if __name__ == "__main__":
    print(cube_faces(2))  # 10
    print(cube_faces(3))  # 57
    print(cube_faces(6))  # 2226
```

---

### Challenge 4: Count Graphs up to Isomorphism

**Problem.** Count distinct (unlabeled) graphs on `n` vertices — i.e. labeled graphs up to vertex relabeling.

**Example.**
```text
n = 3  ->  4
n = 4  ->  11
n = 6  ->  156
```

**Constraints.** `1 ≤ n ≤ 30`. Answer mod `10^9+7`.

**Optimal.** Sum over the `p(n)` cycle types of `S_n`, each weighted by conjugacy-class size, with `2^{induced edge cycles}`. `O(p(n)·n²)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func powMod(a, e, m int64) int64 {
	a %= m
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func factorial(n int) int64 {
	r := int64(1)
	for i := 2; i <= n; i++ {
		r *= int64(i)
	}
	return r
}

func edgeCycles(ct []int) int {
	total := 0
	for _, L := range ct {
		total += L / 2
	}
	for i := 0; i < len(ct); i++ {
		for j := i + 1; j < len(ct); j++ {
			total += gcd(ct[i], ct[j])
		}
	}
	return total
}

// classSize = n! / prod(i^{m_i} * m_i!)  (computed as exact int64; n<=30 fits with care via big? here moderate)
func classSize(ct []int, n int) int64 {
	cnt := map[int]int{}
	for _, L := range ct {
		cnt[L]++
	}
	denom := int64(1)
	for length, m := range cnt {
		pw := int64(1)
		for i := 0; i < m; i++ {
			pw *= int64(length)
		}
		denom *= pw * factorial(m)
	}
	return factorial(n) / denom
}

func partitions(n, mx int) [][]int {
	if n == 0 {
		return [][]int{{}}
	}
	var res [][]int
	for first := min(n, mx); first >= 1; first-- {
		for _, rest := range partitions(n-first, first) {
			res = append(res, append([]int{first}, rest...))
		}
	}
	return res
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func graphs(n int) int64 {
	total := int64(0)
	for _, ct := range partitions(n, n) {
		c := edgeCycles(ct)
		total = (total + classSize(ct, n)%MOD*powMod(2, int64(c), MOD)) % MOD
	}
	return total * powMod(factorial(n)%MOD, MOD-2, MOD) % MOD
}

func main() {
	fmt.Println(graphs(3)) // 4
	fmt.Println(graphs(4)) // 11
	fmt.Println(graphs(6)) // 156
}
```

**Java.**
```java
import java.util.*;

public class GraphIso {
    static final long MOD = 1_000_000_007L;

    static int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }

    static long powMod(long a, long e, long m) {
        a %= m; long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m; e >>= 1;
        }
        return r;
    }

    static long factorial(int n) { long r = 1; for (int i = 2; i <= n; i++) r *= i; return r; }

    static int edgeCycles(List<Integer> ct) {
        int total = 0;
        for (int L : ct) total += L / 2;
        for (int i = 0; i < ct.size(); i++)
            for (int j = i + 1; j < ct.size(); j++)
                total += gcd(ct.get(i), ct.get(j));
        return total;
    }

    static long classSize(List<Integer> ct, int n) {
        Map<Integer, Integer> cnt = new HashMap<>();
        for (int L : ct) cnt.merge(L, 1, Integer::sum);
        long denom = 1;
        for (var e : cnt.entrySet()) {
            long pw = 1;
            for (int i = 0; i < e.getValue(); i++) pw *= e.getKey();
            denom *= pw * factorial(e.getValue());
        }
        return factorial(n) / denom;
    }

    static void partitions(int n, int mx, List<Integer> cur, List<List<Integer>> out) {
        if (n == 0) { out.add(new ArrayList<>(cur)); return; }
        for (int first = Math.min(n, mx); first >= 1; first--) {
            cur.add(first);
            partitions(n - first, first, cur, out);
            cur.remove(cur.size() - 1);
        }
    }

    static long graphs(int n) {
        List<List<Integer>> parts = new ArrayList<>();
        partitions(n, n, new ArrayList<>(), parts);
        long total = 0;
        for (var ct : parts) {
            int c = edgeCycles(ct);
            total = (total + classSize(ct, n) % MOD * powMod(2, c, MOD)) % MOD;
        }
        return total * powMod(factorial(n) % MOD, MOD - 2, MOD) % MOD;
    }

    public static void main(String[] args) {
        System.out.println(graphs(3)); // 4
        System.out.println(graphs(4)); // 11
        System.out.println(graphs(6)); // 156
    }
}
```

**Python.**
```python
from math import gcd, factorial
from collections import Counter

MOD = 10**9 + 7


def edge_cycles(ct):
    total = sum(L // 2 for L in ct)
    for i in range(len(ct)):
        for j in range(i + 1, len(ct)):
            total += gcd(ct[i], ct[j])
    return total


def class_size(ct, n):
    cnt = Counter(ct)
    denom = 1
    for length, m in cnt.items():
        denom *= (length ** m) * factorial(m)
    return factorial(n) // denom


def partitions(n, mx=None):
    if mx is None:
        mx = n
    if n == 0:
        yield []
        return
    for first in range(min(n, mx), 0, -1):
        for rest in partitions(n - first, first):
            yield [first] + rest


def graphs(n):
    total = 0
    for ct in partitions(n):
        total = (total + class_size(ct, n) * pow(2, edge_cycles(ct), MOD)) % MOD
    return total * pow(factorial(n), MOD - 2, MOD) % MOD


if __name__ == "__main__":
    print(graphs(3))  # 4
    print(graphs(4))  # 11
    print(graphs(6))  # 156
```

---

## Final Tips

- Lead with the one-liner: *"distinct objects = average fixed colorings = `(1/|G|) Σ_g k^{c(g)}`."*
- Immediately flag the two gotchas: **don't divide `k^n` by `|G|`** (average fixed counts), and **pick the right group** (`C_n` necklace vs `D_n` bracelet).
- Reduce everything to **cycle counting**: `|Fix(g)| = k^{c(g)}`; rotation by `j` has `gcd(j,n)` cycles.
- For large `n`, use the closed form `(1/n) Σ_{d|n} φ(d) k^{n/d}` (`O(√n)`).
- For mod-`p` answers, the `(1/|G|)` is a **Fermat modular inverse** (sibling `05-fermat-euler`).
- For graphs/relabelings, work on the **induced action** and sum over **cycle types**, not all `n!`.
- Always offer to validate with a **brute-force orbit count** and OEIS cross-checks (A000031 necklaces, A000088 graphs).

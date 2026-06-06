# Inclusion-Exclusion Principle (PIE) — Interview Preparation

Inclusion-Exclusion is a favourite interview topic because it rewards a single crisp insight — *"to count a union of overlapping sets, add the singles, subtract the pairs, add the triples, alternating signs; and 'none' = universe − union"* — and then tests whether you can (a) set up the right universe and "bad" sets, (b) compute intersection sizes (often via **LCM**), (c) loop the `2ⁿ` subsets with a **bitmask** and the correct sign, and (d) recognize when PIE collapses (derangements, surjections) or must yield to Möbius / a sieve. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `|A ∪ B|` | `|A|+|B|−|A∩B|` | O(1) |
| `|A ∪ B ∪ C|` | `+singles −pairs +triple` | O(1) |
| `|A₁ ∪ … ∪ Aₙ|` | bitmask PIE | `O(2ⁿ·n)` |
| #(divisible by ≥1 of `k`) in `[1,N]` | `Σ(−1)^(|S|+1)⌊N/lcm(S)⌋` | `O(2ⁿ·n)` |
| #(coprime to `m`) in `[1,N]` | Möbius/PIE over distinct primes | `O(2^ω(m))` |
| #(none of properties) | `N − union` (complement) | `O(2ⁿ·n)` |
| Derangements `D(n)` | `n!Σ(−1)^k/k!` | `O(n)` |
| Surjections `[n]→[m]` | `Σ(−1)^k C(m,k)(m−k)^n` | `O(m)` |
| Squarefree ≤ `N` | `Σ_{d≤√N} μ(d)⌊N/d²⌋` | `O(√N)` |

Key facts:
- Sign of a **`k`-set** intersection term is `(−1)^(k+1)` (odd `k` → `+`, even → `−`).
- **Complement** form: `#none = Σ_S (−1)^|S| |A_S|`, including `+N` for the empty subset.
- "Divisible by both `a` and `b`" uses `lcm(a,b)`, **not** `a·b`.
- PIE over the **distinct prime factors** computes the totient: `φ(m) = m∏(1−1/p)`.
- `2ⁿ` is fine for `n ≤ ~20`; beyond, **prune**, use **Möbius/sieve**, or go **approximate (HLL)**.
- PIE over prime factors **is** the Möbius sum: sign `(−1)^#primes = μ(d)`.

Core routine:

```text
union(N, nums):                       # O(2^n · n)
    total = 0
    for mask = 1 .. 2^n - 1:
        l = lcm of nums[i] with bit i set
        term = N // l
        if popcount(mask) odd: total += term
        else:                  total -= term
    return total
```

---

## Junior Questions (12 Q&A)

### J1. State the inclusion-exclusion principle for two sets.
`|A ∪ B| = |A| + |B| − |A ∩ B|`. You add both sizes, then subtract the overlap because it was counted twice.

### J2. Why subtract the intersection?
Elements in both `A` and `B` are counted once inside `|A|` and again inside `|B|`. Subtracting `|A∩B|` once brings each such element back to a single count.

### J3. Give the three-set formula.
`|A∪B∪C| = |A|+|B|+|C| − |A∩B|−|A∩C|−|B∩C| + |A∩B∩C|`. Add singles, subtract pairs, add the triple back.

### J4. Why does the triple come back with a plus sign?
Subtracting all three pairs removes the center (in all three sets) too many times; the net so far is 0, but it should be 1, so you add `|A∩B∩C|` back once.

### J5. What is the sign rule for a general term?
A term that intersects `k` sets has sign `(−1)^(k+1)`: `+` for odd `k`, `−` for even `k`.

### J6. How many integers in `[1, N]` are multiples of `k`?
`⌊N/k⌋` (floor division).

### J7. How do you count integers in `[1, N]` divisible by at least one of `2, 3, 5`?
`⌊N/2⌋+⌊N/3⌋+⌊N/5⌋ − ⌊N/6⌋−⌊N/10⌋−⌊N/15⌋ + ⌊N/30⌋`. For `N=30` this is `15+10+6−5−3−2+1 = 22`.

### J8. Why use the LCM for intersections?
"Divisible by both `a` and `b`" means divisible by their least common multiple, so the count is `⌊N/lcm(a,b)⌋`, not `⌊N/(a·b)⌋`.

### J9. What is the complement form?
`#(none of the properties) = N − |A₁∪…∪Aₙ|`. Useful when "none" is easier to describe than "at least one".

### J10. How many terms does PIE have for `n` sets?
`2ⁿ − 1` non-empty subsets (plus the universe term if you use the complement form).

### J11. What is a bitmask in this context?
An integer where bit `i` indicates whether set `i` is included in the current intersection; looping `mask = 1 .. 2ⁿ−1` visits every non-empty subset.

### J12 (analysis). Why is PIE `O(2ⁿ)` and not `O(N)`?
It has one term per subset of the `n` sets — `2ⁿ` of them — each computed in O(1)–O(n). It never iterates over the `N` elements, so it is independent of `N` (which can be `10^18`).

---

## Middle Questions (12 Q&A)

### M1. Prove PIE counts each element exactly once.
An element in exactly `t` sets contributes `Σ_{k=1}^{t}(−1)^(k+1)C(t,k)`. By the binomial theorem `(1−1)^t = Σ_{k=0}^{t}(−1)^kC(t,k) = 0`, so the `k≥1` part equals `1`. Elements in 0 sets contribute `0`. Hence each union member is counted once.

### M2. Write the complement form as a sum over subsets.
`#none = Σ_{S⊆[n]}(−1)^|S| |A_S|`, where `A_∅ = Ω` contributes `+N`. Even-sized subsets add, odd-sized subtract.

### M3. How does PIE compute Euler's totient?
"Coprime to `m`" = "divisible by none of `m`'s primes". Complement PIE over the distinct primes gives `φ(m) = m − Σ⌊m/pᵢ⌋ + Σ⌊m/(pᵢpⱼ)⌋ − … = m∏(1−1/p)`.

### M4. How do derangements come from PIE?
`Aᵢ` = permutations fixing position `i`; `|A_S| = (n−|S|)!`. Complement: `D(n) = Σ_{k=0}^{n}(−1)^k C(n,k)(n−k)! = n!Σ(−1)^k/k! ≈ n!/e`.

### M5. How do you count surjections (onto functions)?
`Aᵢ` = functions missing output `i`; `|A_S| = (m−|S|)^n`. `Surj(n,m) = Σ_{k=0}^{m}(−1)^k C(m,k)(m−k)^n`. Divide by `m!` for the Stirling number `S(n,m)`.

### M6. When does the `2ⁿ` loop collapse to `O(n)`?
When the intersection size depends only on `|S|=k` (not which sets), all `C(n,k)` same-size subsets share a value, so you index by `k`: `Σ_{k}(−1)^? C(n,k)·value(k)`. Derangements and surjections are the classic cases.

### M7. Direct union vs complement — how do you choose?
Match the problem statement: "at least one" → direct union (`mask` from 1, sign `(−1)^(k+1)`); "none / coprime / no fixed point" → complement (`mask` from 0, sign `(−1)^k`). They are algebraically identical.

### M8. How do you count numbers coprime to `m` in `[1, N]` (general `N`)?
`Σ_{S⊆{distinct primes of m}}(−1)^|S| ⌊N/∏_{p∈S}p⌋`. When `N=m` this equals `φ(m)`.

### M9. What is the Möbius restatement of PIE over prime factors?
Each subset of primes ↔ a squarefree divisor `d` with sign `(−1)^#primes = μ(d)`, so `#coprime = Σ_{d|rad(m)} μ(d)⌊N/d⌋`.

### M10. How do you count squarefree integers up to `N`?
PIE over "divisible by `p²`": `#squarefree = Σ_{d=1}^{√N} μ(d)⌊N/d²⌋`. Only `d ≤ √N` contribute.

### M11. What goes wrong if you use the product instead of the LCM?
You undercount: multiples of both `4` and `6` are multiples of `lcm=12`, but `4·6=24` counts only every-24th number, missing `12, 36, …`.

### M12 (analysis). For `n` sets where intersection size depends on `|S|`, what is the cost?
`O(n)` — you compute one term per size `k = 0..n` using `C(n,k)` and a closed-form intersection size, instead of `2ⁿ` individual subsets.

---

## Senior Questions (10 Q&A)

### S1. How would you count distinct users across `n` overlapping campaigns?
Exact: PIE over the campaigns — `Σ(−1)^(|S|+1)|⋂ campaigns in S|`, where each intersection is a bitmap-AND + popcount. Reporting `Σ|campaignᵢ|` overcounts everyone in multiple campaigns. For large `n` or huge sets, switch to HyperLogLog (estimate the union directly).

### S2. PIE is `O(2ⁿ)`. How do you handle large `n`?
Three levers: (1) **prune** — DFS that stops when the running LCM exceeds `N` or the running intersection empties, since all supersets are then 0; (2) **structure** — Möbius/sieve when the sets are prime-divisibility; (3) **approximate** — HyperLogLog for distinct-union counts.

### S3. Why can't you feed estimated intersection sizes into PIE?
PIE alternates large terms that nearly cancel, so absolute errors accumulate rather than cancel; a small relative error per term can swamp the small true answer. Estimate the *union* directly (HLL) instead of estimated terms through PIE.

### S4. How does PIE relate to Möbius inversion?
PIE is Möbius inversion on the Boolean (subset) lattice, where `μ(S,T) = (−1)^(|T|−|S|)`. The number-theoretic Möbius function is the same inversion on the divisor lattice, so "PIE over prime factors" and "Möbius sum over squarefree divisors" are identical.

### S5. When do you precompute with a sieve instead of running PIE per query?
When answering many coprime/totient/squarefree queries over a bounded range: sieve `μ` in `O(N)` (linear sieve) or `φ(1..N)` in `O(N log log N)`, then each query is `O(#divisors)`. PIE per query is for *few* queries with *huge* `N`.

### S6. State and use the Bonferroni inequalities.
Truncating PIE after order `m` gives one-sided bounds: odd `m` over-estimates the union, even `m` under-estimates. `|⋃Aᵢ| ≤ Σ|Aᵢ|` (union bound) and `≥ Σ|Aᵢ| − Σ|Aᵢ∩Aⱼ|`. Useful when high-order terms are too expensive.

### S7. How do you prune the subset enumeration soundly?
Prune only on a **monotone** quantity: LCM grows (or intersection shrinks) as you add elements, so a zero term implies all supersets through that branch are zero. Pruning on a non-monotone quantity is unsound; always verify against the flat `2ⁿ` loop.

### S8. How do you compute the permanent of a 0/1 matrix with PIE?
Ryser's formula: `perm(A) = (−1)^n Σ_{S⊆[n]} (−1)^|S| ∏ᵢ Σ_{j∈S} a_{ij}`, `Θ(2ⁿ·n)`. It is the fastest known general permanent algorithm — a concrete sign that the `2ⁿ` barrier reflects genuine (#P) hardness.

### S9. Count integers in `[1,N]` divisible by at least one of many large moduli — what's the plan?
If the moduli are large, most subset LCMs quickly exceed `N`, so a DFS that prunes when `runningLCM > N` visits far fewer than `2ⁿ` nodes. Dedupe moduli first (drop `kⱼ` if `kᵢ | kⱼ` when reasoning about the union). For small/dense moduli, `2ⁿ` is unavoidable.

### S10 (analysis). Why is the totient `φ(m)` a special case of a PIE you can also sieve?
`φ(m) = Σ_{d|rad(m)} μ(d)(m/d)` is PIE/Möbius over `m`'s primes (`O(2^ω(m))` per value). But because `φ` is multiplicative, a linear sieve computes all `φ(1..N)` in `O(N log log N)` — far cheaper than per-value PIE when you need the whole range.

---

## Professional Questions (8 Q&A)

### P1. Prove the complement form via indicator functions.
`1_{(⋃Aᵢ)^c} = ∏(1 − 1_{Aᵢ}) = Σ_{S}(−1)^|S| ∏_{i∈S}1_{Aᵢ} = Σ_S(−1)^|S| 1_{A_S}`. Summing over the universe gives `#none = Σ_S(−1)^|S||A_S|`. The proof uses only additivity, so it extends to any measure.

### P2. Derive the "exactly `r`" count.
With binomial moments `Wₖ = Σ_{|S|=k}|A_S|`, the number of elements in exactly `r` sets is `Eᵣ = Σ_{k=r}^{n}(−1)^(k−r)C(k,r)Wₖ`. It follows from `C(t,k)C(k,r) = C(t,r)C(t−r,k−r)` and `(1−1)^{t−r} = [t=r]`.

### P3. Generalize PIE to probabilities.
By the weighted PIE (measure = probability), `Pr(⋃Aᵢ) = Σ_{∅≠S}(−1)^(|S|+1)Pr(A_S)`. Same alternation; `|·|` is replaced by the probability measure. This is the exact form of the union bound.

### P4. Why is the `2ⁿ` cost intrinsic in general?
The binomial moments `W₁,…,Wₙ` are independent inputs, and Ryser's permanent formula (a #P-hard quantity) is the best-known PIE with no sub-exponential algorithm known. Without exploitable symmetry, sieve structure, or pruning, all `2ⁿ` terms can be necessary.

### P5. What is the Möbius function of the divisor lattice and how does it connect to PIE?
On `(divisors of m, |)`, `μ_P(d,e) = μ(e/d)` (classical Möbius: `(−1)^#primes` if squarefree, else 0). The interval `[d,e]` is a Boolean lattice on the primes of `e/d` in the squarefree case, so divisor-lattice Möbius reduces to subset-lattice PIE.

### P6. How do rook polynomials generalize derangements?
Counting permutations avoiding a forbidden board `B` is `Σ_k(−1)^k rₖ(n−k)!`, where `rₖ` counts `k` non-attacking rooks on `B`. Derangements are the case `B` = main diagonal (`rₖ = C(n,k)`). PIE's `Aᵢ` = "uses forbidden cell `i`".

### P7. Count coprime pairs in `[1,N]²`.
`#{(a,b) : gcd(a,b)=1} = Σ_{d=1}^{N} μ(d)⌊N/d⌋²` — PIE over "both divisible by `d`", indexed by Möbius. As `N→∞`, the density is `6/π²`.

### P8 (analysis). Given binomial moments `W₁,…,Wₙ`, what can you compute, and what is the cost?
Everything: the union (`Σ(−1)^(k+1)Wₖ`), the complement, and the full "exactly-`r`" distribution `Eᵣ`, each in `O(n²)` from the `Wₖ`. Obtaining the `Wₖ` themselves is the expensive part — `Wₖ` aggregates `C(n,k)` intersections, totalling the `2ⁿ` work.

---

## Behavioral / System-Design Questions (6 short)

### B1. Tell me about a time you fixed a double-counting bug.
Look for a concrete story: a "distinct count" metric that summed overlapping sources (`Σ|source|`), inflating reach; the realization that overlaps were double-counted; applying PIE (or HyperLogLog for scale) to get the true union; and a measured correction with a regression test against a brute-force count on a small sample.

### B2. A teammate reports "distinct users" as the sum of per-campaign counts. How do you respond?
Explain calmly that summing overlapping sets double-counts anyone in multiple campaigns, with a tiny example (`|A|=|B|=100, |A∩B|=40 ⟹ union=160, not 200`). Recommend PIE for few campaigns or HyperLogLog at scale, and a sanity assertion `union ≤ Σ|sourceᵢ|`.

### B3. Design a service to count integers in `[1,N]` divisible by any of a user-supplied set.
Discuss: dedupe/radical-reduce the inputs; DFS-pruned PIE (stop when running LCM > N); cap LCM at N+1 to avoid overflow; bound `n` (reject or warn past ~25 with a fallback to structure); and a brute-force oracle for small N in tests.

### B4. How would you explain inclusion-exclusion to a junior engineer?
Use the party guest-list analogy: add two guest lists, then subtract people on both so nobody is double-counted; with three lists, remember to add back the people on all three. Then show the payoff — `φ`, derangements, "divisible by at least one" — all one alternating sum.

### B5. Your PIE-based reach computation is too slow. How do you investigate?
Profile the subset enumeration: is `n` too large (`2ⁿ`)? Add pruning (skip empty/zero intersections). Are intersections recomputed from scratch each mask (use a subset-tree/DFS to reuse partial ANDs)? Could a HyperLogLog union replace exact PIE within the error budget?

### B6. When would you accept an approximate answer over exact PIE?
When sets are huge and only a distinct-union *count* is needed (analytics dashboards), the error budget tolerates ~2% (HyperLogLog), and exact intersection sizes are expensive or unavailable. Never approximate when terms nearly cancel and exactness matters (e.g. financial dedup).

---

## Coding Challenges

### Challenge 1: Divisible by At Least One (bitmask PIE)

**Problem.** Given `N` and a list `nums`, count integers in `[1, N]` divisible by at least one element of `nums`.

**Example.**
```text
N = 30, nums = [2,3,5]  ->  22
N = 100, nums = [2,5]   ->  60   (50 + 20 - 10)
```

**Constraints.** `1 ≤ N ≤ 10^18`, `1 ≤ len(nums) ≤ 20`, `1 ≤ numsᵢ ≤ 10^9`.

**Optimal.** Bitmask over `2ⁿ−1` subsets; intersection via LCM; sign by popcount. `O(2ⁿ·n)`. Cap LCM at `N+1` to avoid overflow.

**Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func countAtLeastOne(N int64, nums []int64) int64 {
	n := len(nums)
	var total int64
	for mask := 1; mask < (1 << n); mask++ {
		l, bits := int64(1), 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				bits++
				l = l / gcd(l, nums[i]) * nums[i]
				if l > N {
					l = N + 1 // term becomes 0; prevents overflow
				}
			}
		}
		if bits%2 == 1 {
			total += N / l
		} else {
			total -= N / l
		}
	}
	return total
}

func main() {
	fmt.Println(countAtLeastOne(30, []int64{2, 3, 5})) // 22
	fmt.Println(countAtLeastOne(100, []int64{2, 5}))   // 60
}
```

**Java.**
```java
public class DivisibleByOne {
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    static long countAtLeastOne(long N, long[] nums) {
        int n = nums.length;
        long total = 0;
        for (int mask = 1; mask < (1 << n); mask++) {
            long l = 1; int bits = 0;
            for (int i = 0; i < n; i++) {
                if ((mask & (1 << i)) != 0) {
                    bits++;
                    l = l / gcd(l, nums[i]) * nums[i];
                    if (l > N) l = N + 1;
                }
            }
            if (bits % 2 == 1) total += N / l; else total -= N / l;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(countAtLeastOne(30, new long[]{2, 3, 5})); // 22
        System.out.println(countAtLeastOne(100, new long[]{2, 5}));   // 60
    }
}
```

**Python.**
```python
from math import gcd


def count_at_least_one(N, nums):
    n = len(nums)
    total = 0
    for mask in range(1, 1 << n):
        l, bits = 1, 0
        for i in range(n):
            if mask & (1 << i):
                bits += 1
                l = l // gcd(l, nums[i]) * nums[i]
        total += (1 if bits % 2 else -1) * (N // l)
    return total


if __name__ == "__main__":
    print(count_at_least_one(30, [2, 3, 5]))  # 22
    print(count_at_least_one(100, [2, 5]))    # 60
```

---

### Challenge 2: Count Coprime to N (totient via PIE)

**Problem.** Given `n`, count integers in `[1, n]` coprime to `n` (i.e. `φ(n)`), using PIE over `n`'s distinct primes.

**Example.**
```text
n = 30  ->  8   (1,7,11,13,17,19,23,29)
n = 12  ->  4
n = 7   ->  6
```

**Constraints.** `1 ≤ n ≤ 10^12`.

**Optimal.** Factor `n` (`O(√n)`); PIE over distinct primes via bitmask, `O(2^ω(n))`. (`ω(n) ≤ ~13` for `n ≤ 10^12`.)

**Go.**
```go
package main

import "fmt"

func distinctPrimes(n int64) []int64 {
	var ps []int64
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			ps = append(ps, p)
			for n%p == 0 {
				n /= p
			}
		}
	}
	if n > 1 {
		ps = append(ps, n)
	}
	return ps
}

func coprimeCount(n int64) int64 {
	ps := distinctPrimes(n)
	k := len(ps)
	var total int64
	for mask := 0; mask < (1 << k); mask++ {
		d, bits := int64(1), 0
		for i := 0; i < k; i++ {
			if mask&(1<<i) != 0 {
				d *= ps[i]
				bits++
			}
		}
		if bits%2 == 0 {
			total += n / d
		} else {
			total -= n / d
		}
	}
	return total
}

func main() {
	fmt.Println(coprimeCount(30)) // 8
	fmt.Println(coprimeCount(12)) // 4
	fmt.Println(coprimeCount(7))  // 6
}
```

**Java.**
```java
import java.util.*;

public class CoprimeCount {
    static List<Long> distinctPrimes(long n) {
        List<Long> ps = new ArrayList<>();
        for (long p = 2; p * p <= n; p++)
            if (n % p == 0) { ps.add(p); while (n % p == 0) n /= p; }
        if (n > 1) ps.add(n);
        return ps;
    }

    static long coprimeCount(long n) {
        List<Long> ps = distinctPrimes(n);
        int k = ps.size();
        long total = 0;
        for (int mask = 0; mask < (1 << k); mask++) {
            long d = 1; int bits = 0;
            for (int i = 0; i < k; i++)
                if ((mask & (1 << i)) != 0) { d *= ps.get(i); bits++; }
            if (bits % 2 == 0) total += n / d; else total -= n / d;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(coprimeCount(30)); // 8
        System.out.println(coprimeCount(12)); // 4
        System.out.println(coprimeCount(7));  // 6
    }
}
```

**Python.**
```python
def distinct_primes(n):
    ps, p = [], 2
    while p * p <= n:
        if n % p == 0:
            ps.append(p)
            while n % p == 0:
                n //= p
        p += 1
    if n > 1:
        ps.append(n)
    return ps


def coprime_count(n):
    ps = distinct_primes(n)
    k = len(ps)
    total = 0
    for mask in range(1 << k):
        d, bits = 1, 0
        for i in range(k):
            if mask & (1 << i):
                d *= ps[i]
                bits += 1
        total += (1 if bits % 2 == 0 else -1) * (n // d)
    return total


if __name__ == "__main__":
    print(coprime_count(30))  # 8
    print(coprime_count(12))  # 4
    print(coprime_count(7))   # 6
```

---

### Challenge 3: Derangements (PIE collapsed to O(n))

**Problem.** Count permutations of `{1,…,n}` with no fixed point: `D(n) = Σ_{k=0}^{n}(−1)^k C(n,k)(n−k)!`.

**Example.**
```text
n = 3  ->  2     n = 4  ->  9     n = 5  ->  44
```

**Constraints.** `0 ≤ n ≤ 20` (fits in 64-bit; for larger, work mod a prime).

**Optimal.** `O(n)` via the recurrence `D(n) = (n−1)(D(n−1)+D(n−2))`, or the `O(n)` PIE sum directly.

**Go.**
```go
package main

import "fmt"

func derangements(n int) int64 {
	if n == 0 {
		return 1
	}
	if n == 1 {
		return 0
	}
	a, b := int64(1), int64(0) // D(0), D(1)
	for i := 2; i <= n; i++ {
		a, b = b, int64(i-1)*(b+a)
	}
	return b
}

func main() {
	for n := 0; n <= 6; n++ {
		fmt.Print(derangements(n), " ") // 1 0 1 2 9 44 265
	}
	fmt.Println()
}
```

**Java.**
```java
public class Derangements {
    static long derangements(int n) {
        if (n == 0) return 1;
        if (n == 1) return 0;
        long a = 1, b = 0; // D(0), D(1)
        for (int i = 2; i <= n; i++) {
            long next = (long) (i - 1) * (b + a);
            a = b; b = next;
        }
        return b;
    }

    public static void main(String[] args) {
        for (int n = 0; n <= 6; n++) System.out.print(derangements(n) + " ");
        System.out.println(); // 1 0 1 2 9 44 265
    }
}
```

**Python.**
```python
from math import comb, factorial


def derangements(n):
    # Direct PIE sum, O(n).
    return sum((-1) ** k * comb(n, k) * factorial(n - k) for k in range(n + 1))


if __name__ == "__main__":
    print([derangements(n) for n in range(7)])  # [1, 0, 1, 2, 9, 44, 265]
```

---

### Challenge 4: Count Squarefree Integers up to N

**Problem.** Count squarefree integers in `[1, N]` (no prime appears squared): `Σ_{d=1}^{√N} μ(d)⌊N/d²⌋`.

**Example.**
```text
N = 10   ->  7   (all but 4, 8, 9)
N = 100  ->  61
```

**Constraints.** `1 ≤ N ≤ 10^14`.

**Optimal.** Sieve `μ` up to `√N` (`O(√N)`), then sum `μ(d)⌊N/d²⌋`. `O(√N)` time and space.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func countSquarefree(N int64) int64 {
	root := int64(math.Sqrt(float64(N)))
	for (root+1)*(root+1) <= N {
		root++
	}
	mu := make([]int, root+1)
	comp := make([]bool, root+1)
	var primes []int64
	if root >= 1 {
		mu[1] = 1
	}
	for i := int64(2); i <= root; i++ {
		if !comp[i] {
			primes = append(primes, i)
			mu[i] = -1
		}
		for _, p := range primes {
			if i*p > root {
				break
			}
			comp[i*p] = true
			if i%p == 0 {
				mu[i*p] = 0
				break
			}
			mu[i*p] = -mu[i]
		}
	}
	var total int64
	for d := int64(1); d <= root; d++ {
		total += int64(mu[d]) * (N / (d * d))
	}
	return total
}

func main() {
	fmt.Println(countSquarefree(10))  // 7
	fmt.Println(countSquarefree(100)) // 61
}
```

**Java.**
```java
public class Squarefree {
    static long countSquarefree(long N) {
        int root = (int) Math.sqrt((double) N);
        while ((long) (root + 1) * (root + 1) <= N) root++;
        int[] mu = new int[root + 1];
        boolean[] comp = new boolean[root + 1];
        int[] primes = new int[root + 1];
        int pc = 0;
        if (root >= 1) mu[1] = 1;
        for (int i = 2; i <= root; i++) {
            if (!comp[i]) { primes[pc++] = i; mu[i] = -1; }
            for (int j = 0; j < pc && (long) i * primes[j] <= root; j++) {
                comp[i * primes[j]] = true;
                if (i % primes[j] == 0) { mu[i * primes[j]] = 0; break; }
                mu[i * primes[j]] = -mu[i];
            }
        }
        long total = 0;
        for (int d = 1; d <= root; d++) total += (long) mu[d] * (N / ((long) d * d));
        return total;
    }

    public static void main(String[] args) {
        System.out.println(countSquarefree(10));  // 7
        System.out.println(countSquarefree(100)); // 61
    }
}
```

**Python.**
```python
import math


def count_squarefree(N):
    root = math.isqrt(N)
    mu = [0] * (root + 1)
    comp = [False] * (root + 1)
    primes = []
    if root >= 1:
        mu[1] = 1
    for i in range(2, root + 1):
        if not comp[i]:
            primes.append(i)
            mu[i] = -1
        for p in primes:
            if i * p > root:
                break
            comp[i * p] = True
            if i % p == 0:
                mu[i * p] = 0
                break
            mu[i * p] = -mu[i]
    return sum(mu[d] * (N // (d * d)) for d in range(1, root + 1))


if __name__ == "__main__":
    print(count_squarefree(10))   # 7
    print(count_squarefree(100))  # 61
```

---

## Final Tips

- Lead with the one-liner: *"Union = add singles, subtract pairs, add triples (alternating); 'none' = universe − union."*
- Immediately flag the two gotchas: **intersections use LCM, not product**, and **the sign is `(−1)^(k+1)` for a `k`-set term**.
- Set up the universe and the "bad" sets `Aᵢ` *explicitly* before writing any term — most PIE errors are setup errors.
- For prime-factor sets, mention the **Möbius restatement** (`sign = μ(d)`) and the link to the totient.
- Know when `2ⁿ` collapses (**derangements, surjections → `O(n)`**) and when to **prune / sieve / approximate** for large `n`.
- Always offer to verify with a **brute-force oracle** on small `N` and the `#none = N − union` identity.

# Catalan Numbers — Interview Preparation

Catalan numbers are a favourite interview topic because they reward a single crisp insight — *"the sequence `1, 1, 2, 5, 14, 42, …` counts balanced parentheses, binary tree shapes, triangulations, and Dyck paths, with recurrence `C_{n+1} = Σ C_i C_{n-i}` and closed form `C_n = C(2n,n)/(n+1)`"* — and then test whether you can (a) **recognize** a Catalan structure inside an unfamiliar problem, (b) compute `C_n` exactly and **mod a prime** (with a modular inverse, not integer division), (c) explain the **first-return decomposition** behind the recurrence, and (d) reason about **overflow** and the closed-form derivation (reflection principle, generating function, asymptotics). This file is a tiered question bank, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `n`-th Catalan, one value | `C_n = C_{n-1}·2(2n-1)/(n+1)` | `O(n)` |
| `n`-th Catalan, closed form | `C(2n,n)/(n+1)` | `O(n)` |
| Build `C_{n+1}` from smaller | `Σ_{i=0}^{n} C_i C_{n-i}` | `O(n)` per term, `O(n²)` table |
| Catalan subtraction form | `C(2n,n) − C(2n,n+1)` | `O(n)` |
| `C_n mod p` (prime) | `(2n)!·inv(n!)·inv((n+1)!)` | `O(1)` after `O(n)` precompute |
| count balanced parens of `n` pairs | `C_n` | — |
| count binary tree shapes, `n` nodes | `C_n` | — |
| triangulations of `s`-gon | `C_{s-2}` | — |
| asymptotic growth | `C_n ~ 4^n / (n^{3/2}√π)` | — |

Key facts:
- First values: **`1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862`** (note `C_0 = C_1 = 1`).
- The recurrence is a **convolution** from the **first-return decomposition**.
- Modular Catalan needs a **modular inverse** for `/(n+1)`, never integer division.
- `C_n` overflows signed `int64` at **`n = 36`** (last safe exact is `C_35`).
- The "fingerprint" of Catalan: a **balance / non-crossing / nesting / stay-below-diagonal** constraint.

Core routine:

```text
catalan(n):                         # O(n)
    c = 1                           # C_0
    for k = 1..n:
        c = c * 2*(2k-1) / (k+1)
    return c

catalan_mod(n) = fact[2n] * invfact[n] % p * invfact[n+1] % p
```

---

## Junior Questions (12 Q&A)

### J1. What are the Catalan numbers? List the first few.
The sequence `C_0=1, C_1=1, C_2=2, C_3=5, C_4=14, C_5=42, C_6=132, …`. They count many "balanced" structures — most famously, balanced parenthesizations of `n` pairs of brackets.

### J2. State the closed form.
`C_n = C(2n, n) / (n+1) = (2n)! / ((n+1)! n!)`.

### J3. State the recurrence.
`C_0 = 1` and `C_{n+1} = Σ_{i=0}^{n} C_i · C_{n-i}` — a convolution of the smaller Catalan numbers.

### J4. How many balanced strings of 3 pairs of parentheses are there?
`C_3 = 5`: `((()))`, `(()())`, `(())()`, `()(())`, `()()()`.

### J5. What does `C_0 = 1` mean?
The empty structure (zero pairs of parentheses, the empty tree) has exactly one arrangement. It is the base case of the recurrence.

### J6. Compute `C_4` from the recurrence.
`C_4 = C_0C_3 + C_1C_2 + C_2C_1 + C_3C_0 = 5 + 2 + 2 + 5 = 14`.

### J7. Compute `C_4` from the closed form.
`C(8,4)/5 = 70/5 = 14`.

### J8. What is the time complexity of the recurrence vs the closed form?
The recurrence is `O(n²)` (a convolution per term); the closed form (incremental) is `O(n)` for a single value.

### J9. Why can't you just compute `(2n)!` and divide?
`(2n)!` overflows machine integers almost immediately. Build the binomial multiplicatively (interleave `*` and `/`) or use modular arithmetic / big integers.

### J10. Name three things counted by `C_n`.
Balanced parentheses with `n` pairs, binary tree shapes with `n` nodes, and triangulations of a polygon with `n+2` sides.

### J11. What is the subtraction form of the closed form?
`C_n = C(2n, n) − C(2n, n+1)`. It gives the same value and comes from the reflection principle.

### J12 (analysis). At what `n` does `C_n` overflow a 64-bit signed integer?
At `n = 36`. `C_35 ≈ 3.1×10^18` still fits (max ≈ `9.22×10^18`), but `C_36 ≈ 1.2×10^19` overflows.

---

## Middle Questions (12 Q&A)

### M1. Explain the first-return decomposition behind the recurrence.
In a balanced string of `n+1` pairs, the first `(` closes at some `)`. The part inside is a balanced string of `i` pairs, the part after is a balanced string of `n-i` pairs. Summing over `i` gives `C_{n+1} = Σ C_i C_{n-i}`.

### M2. Why do binary trees, parentheses, and triangulations give the same number?
Each admits a first-return / root / base-edge split into two independent smaller objects of the same kind, producing the identical convolution recurrence — and there are explicit bijections between them.

### M3. What is a Dyck path and how does it relate to parentheses?
A lattice path of up/down steps from `(0,0)` to `(2n,0)` that never goes below the x-axis. Mapping `( → up`, `) → down` is a bijection with balanced parentheses, so there are `C_n` of them.

### M4. How do you compute `C_n mod p`?
`C_n = (2n)! · inv(n!) · inv((n+1)!) mod p`, using precomputed factorials and inverse factorials. The `/(n+1)` is realized by a modular inverse.

### M5. Why can't you integer-divide the residue by `(n+1)`?
`C(2n,n) mod p` is a residue not generally divisible by `(n+1)`. You must multiply by `inverse(n+1) mod p`.

### M6. How many binary search trees can store `n` distinct keys?
`C_n`. Pick each key as the root; left subtree holds the smaller keys, right holds the larger, independently — exactly the Catalan convolution. (LeetCode "Unique Binary Search Trees".)

### M7. How many ways to triangulate a hexagon?
A hexagon has 6 sides, so `C_{6-2} = C_4 = 14`.

### M8. What is the ballot problem and how does it connect?
Counting vote orderings where candidate A is never behind B is the same as counting Dyck-like paths staying on one side. Its solution (reflection principle) yields the subtraction-form closed form.

### M9. What is a stack-sortable permutation?
A permutation sortable to `1…n` with one stack; equivalently it avoids the pattern `231`. There are `C_n` of them, in bijection with balanced push/pop sequences.

### M10. How do you build the whole Catalan table efficiently?
`C_0 = 1`, then `C_k = C_{k-1}·2(2k-1)/(k+1)` for each `k` — `O(N)` for the full table, beating the `O(N²)` convolution.

### M11. How do you recognize a Catalan problem?
Look for a balance / non-crossing / nesting / stay-below-diagonal constraint, and check whether brute force gives `1, 2, 5, 14` on small inputs.

### M12 (analysis). What is the asymptotic growth of `C_n`?
`C_n ~ 4^n / (n^{3/2}√π)`. The ratio `C_{n+1}/C_n → 4`, so enumeration is exponential and infeasible past `n ≈ 25`.

---

## Senior Questions (10 Q&A)

### S1. Design a service answering many `C_n mod p` queries.
Precompute `fact[0..2N]` and `invfact[0..2N]` once (one Fermat inverse + downward sweep). Then each `C_n = fact[2n]·invfact[n]·invfact[n+1] mod p` is `O(1)`. Size the tables to `2·N_max` and assert the query bound.

### S2. When do you keep `C_n` exact vs go modular?
Exact in `int64` only for `n ≤ 35`; exact for any `n` via big integers (slower); modular when an exact value isn't required and `n` is large. Decide the regime explicitly and assert the overflow bound.

### S3. What goes wrong when `n + 1 ≥ p`?
`(n+1)!` becomes `≡ 0 (mod p)`, so its inverse doesn't exist. Use Lucas' theorem (sibling `24`) on the binomial, or pick a prime with `2n < p`.

### S4. How does Catalan justify a DP rather than brute force?
There are `C_n ~ 4^n` parenthesizations / BST shapes / triangulations, so enumeration is hopeless. Interval DP (matrix-chain, optimal triangulation) finds the optimum in `O(n³)`; Catalan is the size of the space the DP collapses.

### S5. Name and distinguish the generalized Catalan families.
Fuss–Catalan (`k`-ary trees, `c = 1 + xc^k`), Narayana (Dyck paths refined by peak count, sums to `C_n`), Motzkin (allows a flat step), Schröder (allows diagonal steps), ballot numbers (shifted endpoint). The giveaway for non-Catalan is an extra allowed move.

### S6. Derive the closed form via the reflection principle.
Among all `C(2n,n)` up/down sequences, reflect each "bad" path (touching `−1`) after its first touch of `−1`; this bijects bad paths with paths to `(2n,−2)`, numbering `C(2n,n+1)`. So `C_n = C(2n,n) − C(2n,n+1)`.

### S7. How do you verify a modular Catalan implementation?
Assert the defining identity `(n+1)·C_n ≡ C(2n,n) (mod p)`, compare the division and subtraction forms, and compare against brute-force balanced-string counts for `n ≤ 12`. Cross-language determinism (Go/Java/Python) is a strong end-to-end check.

### S8. Why prefer the NTT-friendly prime `998244353` sometimes?
When you must *convolve* Catalan-like generating functions, `998244353 = 119·2^23 + 1` supports NTT, so the convolution is `O(n log n)` (sibling `15-ntt`); for plain `C_n` lookups `10^9+7` is fine.

### S9. A teammate computed triangulations of an `n`-gon as `C_n`. Bug?
Yes — a polygon with `n` sides has `C_{n-2}` triangulations (a pentagon, `n=5`, has `C_3=5`). Off-by-two in the index mapping. Verify with the small case.

### S10 (analysis). Why is `C_n = C(2n,n)/(n+1)` always an integer?
Because `C(2n,n) − C(2n,n+1) = C_n` is an integer and equals `C(2n,n)·(1 − n/(n+1)) = C(2n,n)/(n+1)`. So `(n+1)` divides `C(2n,n)` exactly — which is *why* the modular division by `(n+1)` is legitimate (realized by a modular inverse).

---

## Professional Questions (8 Q&A)

### P1. Prove the generating function satisfies `c(x) = 1 + x c(x)^2`.
The Cauchy product `[x^{n+1}] c(x)^2 = Σ_i C_i C_{n-i} = C_{n+1}`, so `x c(x)^2 = c(x) − C_0 = c(x) − 1`. Rearranging gives the functional equation; solving the quadratic gives `c(x) = (1−√(1−4x))/(2x)`, whose binomial expansion yields `C_n = C(2n,n)/(n+1)`.

### P2. Derive the asymptotic `C_n ~ 4^n/(n^{3/2}√π)`.
Apply Stirling to `C(2n,n) = (2n)!/(n!)² ~ 4^n/√(πn)`, then divide by `(n+1) ~ n`: `C_n ~ 4^n/(n^{3/2}√π)`. The `C_{n+1}/C_n = 2(2n+1)/(n+2) → 4` ratio confirms the `4^n` factor.

### P3. State and apply the cycle lemma to get the closed form.
For a `±1` sequence with sum `k > 0`, exactly `k` of its rotations have all partial sums positive. With sum `1` over length `2n+1`, exactly one rotation per class is good, so `C_n = (1/(2n+1))C(2n+1,n) = (1/(n+1))C(2n,n)`.

### P4. How do you compute `v_p(C_n)`, the power of `p` dividing `C_n`?
`v_p(C_n) = v_p(C(2n,n)) − v_p(n+1)`, where `v_p(C(2n,n))` is the number of carries when adding `n + n` in base `p` (Kummer's theorem). This matters for evaluating `C_n mod p^k` and for the `n+1 ≥ p` corner.

### P5. Explain the bijection between Dyck paths and binary trees.
Recursively: empty path ↦ empty tree; a path `U A D B` (first return after the arch `A`) ↦ a node with left subtree from `A` and right subtree from `B`. It is reversible, hence a bijection, so both number `C_n`.

### P6. How does the entropy of Dyck paths inform succinct data structures?
`log₂ C_n ≈ 2n − (3/2)log₂ n`, so a balanced-parentheses sequence needs ~`2n` bits; succinct tree representations (balanced-parens / LOUDS) achieve `2n + o(n)` bits, matching this information-theoretic lower bound.

### P7. When is the problem Motzkin or Schröder rather than Catalan?
When the lattice-path model allows an extra move: a horizontal/flat step gives Motzkin numbers; a diagonal step gives (large) Schröder numbers. Modeling these as `C_n` undercounts; identify the allowed step set first.

### P8 (analysis). You must compute `C_0…C_N mod p` for `N = 10^7`. Best approach?
Precompute factorials and inverse factorials in `O(N)`; each `C_n` is then `O(1)`, so the whole array is `O(N)` total — well under a second. Avoid the `O(N²)` convolution and avoid recomputing inverses per term.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential enumeration with a formula.
Look for: a feature that enumerated balanced/nested structures to count them, a profile showing it blow up around `n ≈ 20` (`C_20 ≈ 6.6×10^9`), the insight to recognize the Catalan structure and substitute `C_n`, and a measured speedup plus a correctness check against the old enumeration on small inputs.

### B2. A teammate's `C(2n,n)/(n+1)` returns wrong values mod p. How do you help?
Explain calmly that integer division of a residue is invalid under a modulus — `(n+1)` must be inverted. Show the fix (`* inverse(n+1) mod p`) and recommend asserting `(n+1)·C_n ≡ C(2n,n)`. Frame it as a teachable precondition, not blame.

### B3. Design the counting core of a combinatorics service.
Discuss precomputing factorial / inverse-factorial tables sized to `2·N_max`, `O(1)` queries for binomials and Catalan numbers, choosing the modulus (general `10^9+7`, NTT-friendly `998244353` if convolving), the `n+1 ≥ p` corner (Lucas), and a property-test suite asserting the defining identities.

### B4. How would you explain Catalan numbers to a junior?
Start with balanced parentheses: `C_3 = 5` arrangements you can list by hand. Then reveal the surprise — the *same* count answers binary tree shapes and polygon triangulations. Give the two formulas and warn about the two indices (`C_0 = C_1 = 1`) and overflow.

### B5. Your Catalan service returns wrong answers only for large inputs. Investigate.
Suspect overflow (`int64` past `n = 35`) or an undersized precompute table (`fact` sized to `N` not `2N`, reading `fact[2n]` out of bounds). Add a regime assertion and bounds check; verify with the `(n+1)·C_n ≡ C(2n,n)` identity and cross-language determinism.

---

## Coding Challenges

### Challenge 1: Compute the `n`-th Catalan Number (exact)

**Problem.** Given `n`, return `C_n` exactly. Handle `n` up to where big integers are needed.

**Example.**
```text
n = 0  ->  1
n = 4  ->  14
n = 10 ->  16796
```

**Constraints.** `0 ≤ n ≤ 10^4` (exact, so big integers in Go/Java; Python is native).

**Optimal.** Incremental `C_n = C_{n-1}·2(2n-1)/(n+1)`, `O(n)`; use big integers to avoid overflow.

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func catalan(n int) *big.Int {
	c := big.NewInt(1) // C_0
	for k := 1; k <= n; k++ {
		// c = c * 2*(2k-1) / (k+1)
		c.Mul(c, big.NewInt(int64(2*(2*k-1))))
		c.Div(c, big.NewInt(int64(k+1)))
	}
	return c
}

func main() {
	fmt.Println(catalan(0))  // 1
	fmt.Println(catalan(4))  // 14
	fmt.Println(catalan(10)) // 16796
}
```

**Java.**
```java
import java.math.BigInteger;

public class CatalanExact {
    static BigInteger catalan(int n) {
        BigInteger c = BigInteger.ONE; // C_0
        for (int k = 1; k <= n; k++) {
            c = c.multiply(BigInteger.valueOf(2L * (2 * k - 1)))
                 .divide(BigInteger.valueOf(k + 1));
        }
        return c;
    }

    public static void main(String[] args) {
        System.out.println(catalan(0));  // 1
        System.out.println(catalan(4));  // 14
        System.out.println(catalan(10)); // 16796
    }
}
```

**Python.**
```python
def catalan(n):
    c = 1  # C_0; Python ints are unbounded
    for k in range(1, n + 1):
        c = c * 2 * (2 * k - 1) // (k + 1)
    return c


if __name__ == "__main__":
    print(catalan(0))   # 1
    print(catalan(4))   # 14
    print(catalan(10))  # 16796
```

---

### Challenge 2: Catalan Number mod a Prime

**Problem.** Given `n` and a prime `p`, return `C_n mod p`. Use factorials and a modular inverse.

**Example.**
```text
n = 3, p = 1000000007  ->  5
n = 10, p = 1000000007 ->  16796
n = 100, p = 1000000007 -> 558488487
```

**Constraints.** `0 ≤ n ≤ 10^6`, `p` prime, `2n < p`.

**Optimal.** Precompute `fact`, `invfact` to `2n` in `O(n)`; then `C_n = fact[2n]·invfact[n]·invfact[n+1] mod p`.

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

func catalanMod(n int) int64 {
	sz := 2*n + 2
	fact := make([]int64, sz)
	invf := make([]int64, sz)
	fact[0] = 1
	for i := 1; i < sz; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	invf[sz-1] = powMod(fact[sz-1], MOD-2, MOD)
	for i := sz - 1; i > 0; i-- {
		invf[i-1] = invf[i] * int64(i) % MOD
	}
	return fact[2*n] * invf[n] % MOD * invf[n+1] % MOD
}

func main() {
	fmt.Println(catalanMod(3))   // 5
	fmt.Println(catalanMod(10))  // 16796
	fmt.Println(catalanMod(100)) // 558488487
}
```

**Java.**
```java
public class CatalanMod {
    static final long MOD = 1_000_000_007L;

    static long powMod(long a, long e, long m) {
        a %= m;
        long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long catalanMod(int n) {
        int sz = 2 * n + 2;
        long[] fact = new long[sz], invf = new long[sz];
        fact[0] = 1;
        for (int i = 1; i < sz; i++) fact[i] = fact[i - 1] * i % MOD;
        invf[sz - 1] = powMod(fact[sz - 1], MOD - 2, MOD);
        for (int i = sz - 1; i > 0; i--) invf[i - 1] = invf[i] * i % MOD;
        return fact[2 * n] * invf[n] % MOD * invf[n + 1] % MOD;
    }

    public static void main(String[] args) {
        System.out.println(catalanMod(3));   // 5
        System.out.println(catalanMod(10));  // 16796
        System.out.println(catalanMod(100)); // 558488487
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def catalan_mod(n):
    sz = 2 * n + 2
    fact = [1] * sz
    for i in range(1, sz):
        fact[i] = fact[i - 1] * i % MOD
    invf = [1] * sz
    invf[sz - 1] = pow(fact[sz - 1], MOD - 2, MOD)
    for i in range(sz - 1, 0, -1):
        invf[i - 1] = invf[i] * i % MOD
    return fact[2 * n] * invf[n] % MOD * invf[n + 1] % MOD


if __name__ == "__main__":
    print(catalan_mod(3))    # 5
    print(catalan_mod(10))   # 16796
    print(catalan_mod(100))  # 558488487
```

---

### Challenge 3: Count Unique Binary Search Trees

**Problem.** Given `n`, return the number of structurally distinct BSTs that store keys `1…n`. (LeetCode 96.) The answer is `C_n`; implement it via the Catalan DP.

**Example.**
```text
n = 1  ->  1
n = 3  ->  5
n = 5  ->  42
```

**Constraints.** `1 ≤ n ≤ 19` (answer fits `int64`).

**Optimal.** `dp[0]=1`, `dp[k] = Σ_{root=1}^{k} dp[root-1]·dp[k-root]`, `O(n²)`.

**Go.**
```go
package main

import "fmt"

func numTrees(n int) int64 {
	dp := make([]int64, n+1)
	dp[0] = 1
	for nodes := 1; nodes <= n; nodes++ {
		for root := 1; root <= nodes; root++ {
			dp[nodes] += dp[root-1] * dp[nodes-root]
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(numTrees(1)) // 1
	fmt.Println(numTrees(3)) // 5
	fmt.Println(numTrees(5)) // 42
}
```

**Java.**
```java
public class UniqueBST {
    static long numTrees(int n) {
        long[] dp = new long[n + 1];
        dp[0] = 1;
        for (int nodes = 1; nodes <= n; nodes++)
            for (int root = 1; root <= nodes; root++)
                dp[nodes] += dp[root - 1] * dp[nodes - root];
        return dp[n];
    }

    public static void main(String[] args) {
        System.out.println(numTrees(1)); // 1
        System.out.println(numTrees(3)); // 5
        System.out.println(numTrees(5)); // 42
    }
}
```

**Python.**
```python
def num_trees(n):
    dp = [0] * (n + 1)
    dp[0] = 1
    for nodes in range(1, n + 1):
        for root in range(1, nodes + 1):
            dp[nodes] += dp[root - 1] * dp[nodes - root]
    return dp[n]


if __name__ == "__main__":
    print(num_trees(1))  # 1
    print(num_trees(3))  # 5
    print(num_trees(5))  # 42
```

---

### Challenge 4: Generate All Balanced Parentheses

**Problem.** Given `n`, return all balanced strings of `n` pairs of parentheses. (LeetCode 22.) There are exactly `C_n` of them — a chance to discuss the count vs the enumeration.

**Example.**
```text
n = 1  ->  ["()"]
n = 2  ->  ["(())", "()()"]
n = 3  ->  5 strings
```

**Constraints.** `1 ≤ n ≤ 8` (output is `C_n`, exponential).

**Optimal.** Backtracking: add `(` while `open < n`; add `)` while `close < open`. `O(C_n · n)` output-sensitive.

**Go.**
```go
package main

import "fmt"

func generate(n int) []string {
	var res []string
	var rec func(s string, open, close int)
	rec = func(s string, open, close int) {
		if len(s) == 2*n {
			res = append(res, s)
			return
		}
		if open < n {
			rec(s+"(", open+1, close)
		}
		if close < open {
			rec(s+")", open, close+1)
		}
	}
	rec("", 0, 0)
	return res
}

func main() {
	for n := 1; n <= 3; n++ {
		g := generate(n)
		fmt.Printf("n=%d count=%d %v\n", n, len(g), g)
	}
}
```

**Java.**
```java
import java.util.*;

public class GenParens {
    static List<String> generate(int n) {
        List<String> res = new ArrayList<>();
        rec(res, new StringBuilder(), 0, 0, n);
        return res;
    }

    static void rec(List<String> res, StringBuilder s, int open, int close, int n) {
        if (s.length() == 2 * n) { res.add(s.toString()); return; }
        if (open < n)    { s.append('('); rec(res, s, open + 1, close, n); s.deleteCharAt(s.length() - 1); }
        if (close < open){ s.append(')'); rec(res, s, open, close + 1, n); s.deleteCharAt(s.length() - 1); }
    }

    public static void main(String[] args) {
        for (int n = 1; n <= 3; n++) {
            List<String> g = generate(n);
            System.out.printf("n=%d count=%d %s%n", n, g.size(), g);
        }
    }
}
```

**Python.**
```python
def generate(n):
    res = []

    def rec(s, open_used, close_used):
        if len(s) == 2 * n:
            res.append(s)
            return
        if open_used < n:
            rec(s + "(", open_used + 1, close_used)
        if close_used < open_used:
            rec(s + ")", open_used, close_used + 1)

    rec("", 0, 0)
    return res


if __name__ == "__main__":
    for n in range(1, 4):
        g = generate(n)
        print(f"n={n} count={len(g)} {g}")
```

---

## Final Tips

- Lead with the one-liner: *"The Catalan numbers `1, 1, 2, 5, 14, …` count balanced parentheses, binary tree shapes, and triangulations; `C_n = C(2n,n)/(n+1)` and `C_{n+1} = Σ C_i C_{n-i}`."*
- When you see a counting problem, **test the small cases**: if you get `1, 2, 5, 14`, it is Catalan — map it to balanced parentheses and apply the formula.
- For modular answers, **never integer-divide** — multiply by `inverse(n+1) mod p`, and offer to assert `(n+1)·C_n ≡ C(2n,n)`.
- Flag the two traps: the **index mapping** (polygon `n+2` sides → `C_n`; BST `n` keys → `C_n`) and **overflow** at `n = 36`.
- Mention the derivation routes you know — **first-return decomposition** (recurrence), **reflection principle** (subtraction form), **generating function** (`c = 1 + xc²`), and the **asymptotic** `~ 4^n/n^{3/2}` — to show depth.
- Know the **generalizations** (Fuss–Catalan, Narayana, Motzkin, Schröder) so you don't misclassify a problem with an extra allowed move.

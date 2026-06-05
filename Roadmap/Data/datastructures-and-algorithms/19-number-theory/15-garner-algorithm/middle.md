# Garner's Algorithm (Mixed-Radix CRT Reconstruction) — Middle Level

> **Focus:** The digit-by-digit solve with **prefix-product inverses**, recovering `x` directly or only `x mod M`, doing arithmetic in a Residue Number System (RNS) and reconstructing at the end, and a side-by-side comparison with the classic CRT summation formula.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [RNS Arithmetic](#rns-arithmetic)
6. [Recovering x mod Another Modulus](#recovering-x-mod-another-modulus)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was: *Garner rebuilds `x` from its residues by solving mixed-radix digits one at a time.* At middle level you start asking the engineering questions that decide whether your reconstruction is correct, fast, and memory-safe:

- What exactly is the **inverse of the prefix product**, and why is precomputing it the key optimization?
- How do I reconstruct only `x mod M` for some target modulus `M` (e.g. `10^9 + 7`) without ever building a big integer?
- What is a **Residue Number System**, and how does Garner sit at the boundary where RNS arithmetic ends and a real number must be recovered?
- How does Garner's mixed-radix approach compare, term by term, with the **classic CRT formula** of `05-crt` — same answer, different cost profile?
- Why is the digit solve **inherently sequential**, and does that matter for parallelism?

These separate "I can recite the mixed-radix formula" from "I can drop Garner into a multi-prime NTT pipeline (`13-ntt`) and reason about its cost."

---

## Deeper Concepts

### The mixed-radix solve, restated precisely

We seek digits `a_0, a_1, …, a_{k-1}` (0-indexed now) with `0 ≤ a_i < p_i` such that

```
x = Σ_{i=0}^{k-1} a_i · W_i,        where W_i = p_0 · p_1 · … · p_{i-1}   (W_0 = 1).
```

`W_i` is the **prefix product**: the weight of digit `a_i`. Reducing `x` mod `p_i` kills every term with index `> i` (each carries the factor `p_i`), and kills the *future* terms entirely, so

```
r_i ≡ a_0·W_0 + a_1·W_1 + … + a_i·W_i   (mod p_i).
```

Solving for `a_i`:

```
a_i ≡ ( r_i − Σ_{j<i} a_j·W_j ) · (W_i)^{-1}   (mod p_i).
```

The term `(W_i)^{-1}` is the **modular inverse of the prefix product `W_i` modulo `p_i`**. Because the `p_j` are pairwise coprime, `W_i = ∏_{j<i} p_j` is coprime to `p_i`, so this inverse always exists.

### Two ways to evaluate the partial sum

The bracket `Σ_{j<i} a_j·W_j (mod p_i)` can be computed two ways:

1. **Re-derive per row** (`O(i)` work for digit `i`, `O(k²)` total): recompute the prefix product mod `p_i` and the running partial from scratch for each `i`. Simple, no shared state.
2. **Coefficient form** (also `O(k²)`): maintain, for each modulus `p_i`, a running combination; this is the "Garner with precomputed inverse table" variant used in NTT libraries.

Both are `O(k²)`; the second amortizes the inverses when the primes are fixed across many reconstructions.

### Why prefix-product inverses are the crux

The single multiplication by `(W_i)^{-1} mod p_i` is what "divides out" the accumulated weight so `a_i` lands in `[0, p_i)`. If you compute these inverses naively inside the loop, you pay `O(log p_i)` per digit (extended Euclid). If the primes are **fixed** (the NTT case), precompute the table `invW[i] = (p_0·…·p_{i-1})^{-1} mod p_i` once, and each reconstruction is pure multiply-add mod `p_i`.

### Uniqueness ⇒ correctness

Because the mixed-radix representation with `0 ≤ a_i < p_i` is **unique** (proof in [`professional.md`](./professional.md)), solving the digits greedily — each forced by the congruence mod `p_i` — yields the one true answer. There is no backtracking and no ambiguity. This uniqueness is the same fact that makes base-10 digits unique; Garner just generalizes the base.

---

## Comparison with Alternatives

### Garner (mixed-radix) vs the classic CRT formula

The classic CRT formula (sibling `05-crt`) reconstructs `x` as a single weighted sum:

```
x = ( Σ_{i} r_i · M_i · y_i )  mod P,     where  P = ∏ p_j,  M_i = P / p_i,  y_i = (M_i)^{-1} mod p_i.
```

Garner instead builds the mixed-radix digits and sums `Σ a_i W_i`. Same `x`, different arithmetic:

| Aspect | Classic CRT formula | Garner (mixed-radix) |
|--------|---------------------|----------------------|
| Big numbers in intermediate steps | Yes — each `M_i = P/p_i` is nearly as big as `P`. | No — digit solve is all mod single primes; big numbers only in final assembly. |
| Modular inverses needed | `k` inverses, each `(M_i)^{-1} mod p_i`. | `k` prefix-product inverses, each `(W_i)^{-1} mod p_i`. |
| Final reduction mod `P` | Required (`Σ r_i M_i y_i` can exceed `P`). | Not required — the mixed-radix sum is already in `[0, P)`. |
| Incremental (add a prime) | Recompute `P`, all `M_i`, all `y_i`. | Append one digit `a_k`; earlier digits unchanged. |
| Reconstructing only `x mod M` | Must reduce big `M_i` mod `M`. | Reduce the small mixed-radix sum mod `M`. |
| Time | `O(k²)` (plus big-int costs for `M_i`). | `O(k²)`, all small until final assembly. |

The practical verdict: **Garner is preferred whenever you want the actual big integer or want to avoid forming `P/p_i`.** The classic formula is conceptually simpler and fine when everything is reduced mod a small `P` that fits in a machine word.

### Garner vs repeated two-modulus CRT merge

You can also merge congruences two at a time: combine `(r_0, p_0)` and `(r_1, p_1)` into one congruence mod `p_0 p_1`, then merge that with `(r_2, p_2)`, etc. This is algebraically equivalent to Garner, but the intermediate modulus `p_0·p_1·…` grows and you are back to big-integer multiplies at every merge. Garner's mixed-radix bookkeeping keeps each *digit-solve* small; only the final assembly grows.

---

## Advanced Patterns

### Pattern: Garner reconstructing into a big integer

The general-purpose form: solve digits, then assemble with big-integer arithmetic. (Shown in `junior.md`; here we add the precomputed-inverse variant.)

### Pattern: Garner with precomputed prefix-product inverses (fixed primes)

When the primes are fixed (NTT, RNS), precompute `invW[i] = (p_0·…·p_{i-1})^{-1} mod p_i` and reuse across reconstructions.

#### Go

```go
package main

import (
	"fmt"
	"math/big"
)

func modInv(a, m int64) int64 {
	A := big.NewInt(((a % m) + m) % m)
	inv := new(big.Int).ModInverse(A, big.NewInt(m))
	return inv.Int64()
}

type GarnerCtx struct {
	p    []int64
	invW []int64 // invW[i] = (p0*...*p_{i-1})^{-1} mod p[i]
}

func newGarner(p []int64) *GarnerCtx {
	k := len(p)
	invW := make([]int64, k)
	for i := 0; i < k; i++ {
		var prefix int64 = 1
		for j := 0; j < i; j++ {
			prefix = (prefix * p[j]) % p[i]
		}
		invW[i] = modInv(prefix, p[i]) // (W_i)^{-1} mod p[i]
	}
	return &GarnerCtx{p: p, invW: invW}
}

// digits returns the mixed-radix digits a[0..k-1].
func (g *GarnerCtx) digits(r []int64) []int64 {
	k := len(g.p)
	a := make([]int64, k)
	for i := 0; i < k; i++ {
		var partial, prefix int64 = 0, 1
		for j := 0; j < i; j++ {
			partial = (partial + a[j]*prefix) % g.p[i]
			prefix = (prefix * g.p[j]) % g.p[i]
		}
		diff := ((r[i]-partial)%g.p[i] + g.p[i]) % g.p[i]
		a[i] = (diff * g.invW[i]) % g.p[i]
	}
	return a
}

func (g *GarnerCtx) reconstruct(r []int64) *big.Int {
	a := g.digits(r)
	x := big.NewInt(0)
	w := big.NewInt(1)
	for i := range g.p {
		x.Add(x, new(big.Int).Mul(big.NewInt(a[i]), w))
		w.Mul(w, big.NewInt(g.p[i]))
	}
	return x
}

func main() {
	g := newGarner([]int64{3, 5, 7})
	fmt.Println(g.reconstruct([]int64{2, 3, 2})) // 23
}
```

#### Java

```java
import java.math.BigInteger;

public class GarnerCtx {
    final long[] p;
    final long[] invW;

    GarnerCtx(long[] p) {
        this.p = p;
        int k = p.length;
        invW = new long[k];
        for (int i = 0; i < k; i++) {
            long prefix = 1;
            for (int j = 0; j < i; j++) prefix = (prefix * p[j]) % p[i];
            invW[i] = BigInteger.valueOf(((prefix % p[i]) + p[i]) % p[i])
                    .modInverse(BigInteger.valueOf(p[i])).longValue();
        }
    }

    long[] digits(long[] r) {
        int k = p.length;
        long[] a = new long[k];
        for (int i = 0; i < k; i++) {
            long partial = 0, prefix = 1;
            for (int j = 0; j < i; j++) {
                partial = (partial + a[j] * prefix) % p[i];
                prefix = (prefix * p[j]) % p[i];
            }
            long diff = ((r[i] - partial) % p[i] + p[i]) % p[i];
            a[i] = (diff * invW[i]) % p[i];
        }
        return a;
    }

    BigInteger reconstruct(long[] r) {
        long[] a = digits(r);
        BigInteger x = BigInteger.ZERO, w = BigInteger.ONE;
        for (int i = 0; i < p.length; i++) {
            x = x.add(BigInteger.valueOf(a[i]).multiply(w));
            w = w.multiply(BigInteger.valueOf(p[i]));
        }
        return x;
    }

    public static void main(String[] args) {
        GarnerCtx g = new GarnerCtx(new long[]{3, 5, 7});
        System.out.println(g.reconstruct(new long[]{2, 3, 2})); // 23
    }
}
```

#### Python

```python
class GarnerCtx:
    def __init__(self, p):
        self.p = p
        self.invW = []
        for i in range(len(p)):
            prefix = 1
            for j in range(i):
                prefix = (prefix * p[j]) % p[i]
            self.invW.append(pow(prefix % p[i], -1, p[i]))

    def digits(self, r):
        p, invW = self.p, self.invW
        a = [0] * len(p)
        for i in range(len(p)):
            partial, prefix = 0, 1
            for j in range(i):
                partial = (partial + a[j] * prefix) % p[i]
                prefix = (prefix * p[j]) % p[i]
            diff = (r[i] - partial) % p[i]
            a[i] = (diff * invW[i]) % p[i]
        return a

    def reconstruct(self, r):
        a = self.digits(r)
        x, w = 0, 1
        for i in range(len(self.p)):
            x += a[i] * w
            w *= self.p[i]
        return x


if __name__ == "__main__":
    g = GarnerCtx([3, 5, 7])
    print(g.reconstruct([2, 3, 2]))  # 23
```

### Pattern: Three-prime NTT combine

In multi-prime NTT (`13-ntt`) you compute a convolution mod three NTT-friendly primes `q_0, q_1, q_2`, getting residues `(c_0, c_1, c_2)` for each output coefficient. Garner combines them into the true coefficient (or that coefficient mod the problem's modulus `M`). Because the primes are fixed, the prefix-product inverses are precomputed once and applied to every coefficient — turning combine into a constant number of multiplies per coefficient.

---

## RNS Arithmetic

A **Residue Number System (RNS)** represents an integer `x` not by its digits but by its residue tuple

```
x  ⟷  (x mod p_0, x mod p_1, …, x mod p_{k-1}).
```

The magic: addition, subtraction, and multiplication are **componentwise** and **carry-free**:

```
(x + y) mod p_i = ( (x mod p_i) + (y mod p_i) ) mod p_i,
(x · y) mod p_i = ( (x mod p_i) · (y mod p_i) ) mod p_i.
```

So you can do a long chain of big-number arithmetic entirely in residue space — each prime independent, embarrassingly parallel, no carries propagating across machine words. **Garner is how you leave RNS**: when you finally need the actual integer (or its value mod `M`), you Garner-reconstruct from the residue tuple.

| RNS operation | Cost | Notes |
|---------------|------|-------|
| Convert `x` → residues | O(k · cost of one mod) | Or compute residues directly. |
| Add / multiply two RNS numbers | O(k) | Componentwise, parallelizable. |
| Compare / detect overflow | hard in RNS | RNS has no easy magnitude comparison — a known limitation. |
| Convert residues → `x` (reconstruct) | **O(k²)** Garner | The exit door from residue space. |

RNS shines for *bulk* multiply-heavy workloads (cryptography, NTT, big-integer multiplication) where you do many cheap parallel operations and reconstruct rarely. Its weaknesses — comparison, division, sign — are exactly the operations that need the reconstructed magnitude, which is why Garner is the indispensable companion.

---

## Recovering x mod Another Modulus

Often you do not want the full big integer `x`; you want `x mod M` where `M` is the problem's answer modulus (say `10^9 + 7`). Two clean approaches:

### Approach 1: Assemble the mixed-radix sum mod M

Solve the digits `a_i` (all mod `p_i`, as usual), then accumulate the final sum **mod `M`** instead of with big integers:

```
x mod M = ( Σ_i a_i · (W_i mod M) ) mod M,
```

maintaining the prefix-product weight `W_i mod M` incrementally. No big integers at all — every value stays a machine word. This is the standard trick for multi-prime NTT where the final coefficients are reported mod `M`.

### Approach 2: Reconstruct big `x`, then reduce

If a big-integer library is available, build `x` exactly and take `x mod M` at the end. Simpler to read, but allocates big integers.

#### Python (Approach 1, no big integers)

```python
def garner_mod_M(r, p, M):
    k = len(p)
    a = [0] * k
    for i in range(k):
        partial, prefix = 0, 1
        for j in range(i):
            partial = (partial + a[j] * prefix) % p[i]
            prefix = (prefix * p[j]) % p[i]
        diff = (r[i] - partial) % p[i]
        a[i] = (diff * pow(prefix, -1, p[i])) % p[i]
    # assemble mod M only
    x, w = 0, 1
    for i in range(k):
        x = (x + a[i] * w) % M
        w = (w * p[i]) % M
    return x


if __name__ == "__main__":
    print(garner_mod_M([2, 3, 2], [3, 5, 7], 1_000_000_007))  # 23
```

#### Go (Approach 1)

```go
package main

import (
	"fmt"
	"math/big"
)

func modInv(a, m int64) int64 {
	return new(big.Int).ModInverse(big.NewInt(((a%m)+m)%m), big.NewInt(m)).Int64()
}

func garnerModM(r, p []int64, M int64) int64 {
	k := len(p)
	a := make([]int64, k)
	for i := 0; i < k; i++ {
		var partial, prefix int64 = 0, 1
		for j := 0; j < i; j++ {
			partial = (partial + a[j]*prefix) % p[i]
			prefix = (prefix * p[j]) % p[i]
		}
		diff := ((r[i]-partial)%p[i] + p[i]) % p[i]
		a[i] = (diff * modInv(prefix, p[i])) % p[i]
	}
	var x, w int64 = 0, 1
	for i := 0; i < k; i++ {
		x = (x + a[i]*w) % M
		w = (w * p[i]) % M
	}
	return x
}

func main() {
	fmt.Println(garnerModM([]int64{2, 3, 2}, []int64{3, 5, 7}, 1_000_000_007)) // 23
}
```

#### Java (Approach 1)

```java
import java.math.BigInteger;

public class GarnerModM {
    static long modInv(long a, long m) {
        return BigInteger.valueOf(((a % m) + m) % m)
                .modInverse(BigInteger.valueOf(m)).longValue();
    }

    static long garnerModM(long[] r, long[] p, long M) {
        int k = p.length;
        long[] a = new long[k];
        for (int i = 0; i < k; i++) {
            long partial = 0, prefix = 1;
            for (int j = 0; j < i; j++) {
                partial = (partial + a[j] * prefix) % p[i];
                prefix = (prefix * p[j]) % p[i];
            }
            long diff = ((r[i] - partial) % p[i] + p[i]) % p[i];
            a[i] = (diff * modInv(prefix, p[i])) % p[i];
        }
        long x = 0, w = 1;
        for (int i = 0; i < k; i++) {
            x = (x + a[i] * w) % M;
            w = (w * p[i]) % M;
        }
        return x;
    }

    public static void main(String[] args) {
        System.out.println(garnerModM(new long[]{2, 3, 2}, new long[]{3, 5, 7}, 1_000_000_007L)); // 23
    }
}
```

---

## Code Examples

### Reusable Garner that returns digits and either form

This factors the digit solve out so the same engine drives big-int assembly, mod-`M` assembly, or just inspecting the mixed-radix digits.

#### Python

```python
def garner_digits(r, p):
    """Return mixed-radix digits a[i] (0 <= a[i] < p[i])."""
    k = len(p)
    a = [0] * k
    for i in range(k):
        partial, prefix = 0, 1
        for j in range(i):
            partial = (partial + a[j] * prefix) % p[i]
            prefix = (prefix * p[j]) % p[i]
        diff = (r[i] - partial) % p[i]
        a[i] = (diff * pow(prefix, -1, p[i])) % p[i]
    return a


def assemble_bigint(a, p):
    x, w = 0, 1
    for ai, pi in zip(a, p):
        x += ai * w
        w *= pi
    return x


def assemble_mod(a, p, M):
    x, w = 0, 1
    for ai, pi in zip(a, p):
        x = (x + ai * w) % M
        w = (w * pi) % M
    return x


if __name__ == "__main__":
    r, p = [2, 3, 2], [3, 5, 7]
    a = garner_digits(r, p)
    print("digits:", a)                       # [2, 2, 1]
    print("bigint:", assemble_bigint(a, p))   # 23
    print("mod 100:", assemble_mod(a, p, 100))  # 23
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Moduli not pairwise coprime | Prefix-product inverse fails to exist. | Pre-check all `gcd(p_i, p_j) = 1`; otherwise use a generalized merge. |
| Un-reduced residues | `r_i ≥ p_i` poisons digit `a_i`. | Reduce `r_i ← r_i mod p_i` up front. |
| Negative partial | `(r_i − partial)` negative before mod. | `((diff % p_i) + p_i) % p_i`. |
| Overflow in `a_j·prefix` | Product exceeds 64 bits for big primes. | 128-bit multiply or `big.Int`/`BigInteger`. |
| Wrong weight in assembly | Used `W_i mod M` inconsistent with digit index. | Maintain `w` incrementally: `w *= p_i` after using it. |
| Reconstructing when you only needed residues | Wasted big-int work. | Skip reconstruction; stay in RNS until truly needed. |

---

## Performance Analysis

| `k` (primes) | Digit solve `O(k²)` | Inverses (precomputed once) | Notes |
|--------------|---------------------|------------------------------|-------|
| 2 | ~4 mults | 2 | Trivial; even a two-modulus merge suffices. |
| 3 | ~9 mults | 3 | The common NTT case. |
| 8 | ~64 mults | 8 | Still microseconds per reconstruction. |
| 32 | ~1024 mults | 32 | Big-integer assembly now dominates. |
| 100 | ~10⁴ mults | 100 | Consider whether you really need 100 primes. |

The digit solve is `O(k²)` modular multiplies on single-prime-sized numbers. If primes are fixed and inverses are precomputed, the *per-reconstruction* cost is pure multiply-add — which is why NTT libraries Garner-combine millions of coefficients cheaply. The big-integer **assembly** is `O(k)` big-int operations on numbers up to `~k·log p` bits; for large `k` it can dominate, which is the reason to prefer the mod-`M` assembly whenever the full integer is not required.

```python
import time

def benchmark(k):
    import random
    # k small distinct primes for the demo
    primes = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31][:k]
    r = [random.randrange(p) for p in primes]
    start = time.perf_counter()
    _ = garner_digits(r, primes)
    return time.perf_counter() - start
```

The single biggest constant-factor win when primes are fixed is **precomputing the prefix-product inverses** so the inner loop is multiply-add only.

---

## Best Practices

- **Reduce residues first:** `r_i ← r_i mod p_i` before any digit solve.
- **Precompute prefix-product inverses** when the primes are fixed (NTT/RNS); the per-reconstruction loop then has no inverse calls.
- **Choose the assembly to match the need:** big integer only if you truly need the exact value; otherwise assemble mod `M` and stay in machine words.
- **Keep `modInverse` a tested helper:** most subtle bugs live in the inverse or the sign normalization.
- **Verify pairwise coprimality** once, loudly; the failure is silent otherwise.
- **Test against brute-force CRT** on random small inputs, and against the classic CRT formula for a few cases to cross-check.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Editable residues `r_i` and primes `p_i`.
> - Each digit `a_i` computed in turn: subtract the partial reconstruction, multiply by `(W_i)^{-1} mod p_i`.
> - The running reconstructed value `a_0 + a_1 p_0 + a_2 p_0 p_1 + …` growing step by step, alongside the prefix-product weights.

---

## Summary

Garner's mixed-radix reconstruction solves the digits `a_i` sequentially, each from one modular inverse of a **prefix product** taken mod `p_i`, so every digit-solve stays single-prime sized. You can then assemble the full big integer `x = Σ a_i W_i` or, more cheaply, assemble only `x mod M` with no big integers at all — the standard move when combining multi-prime NTT results (`13-ntt`). Compared with the classic CRT summation formula (`05-crt`), Garner never forms the giant `P/p_i` terms, is naturally incremental, and needs no final reduction mod `P`. It is also the exit door from a **Residue Number System**: do bulk carry-free componentwise arithmetic in residue space, then Garner-reconstruct the magnitude exactly when you need it. The whole reconstruction is `O(k²)`, dominated by the digit solve (small numbers) plus the optional big-integer assembly.

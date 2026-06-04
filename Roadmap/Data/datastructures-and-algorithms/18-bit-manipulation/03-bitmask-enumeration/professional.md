# Bitmask Enumeration (Iterating Over Sets as Integers) — Professional Level

> **Focus:** mathematical foundations — the bijection between integers `[0, 2^n)` and subsets of `{0..n-1}`, a rigorous proof that the `(s-1) & mask` loop visits every submask of `mask` exactly once in strictly decreasing order, the derivation `Σ_mask 2^popcount(mask) = 3^n` via the binomial theorem (and a combinatorial proof), counting set bits, and complexity proofs.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Integer–Subset Bijection](#the-integersubset-bijection)
3. [Two's-Complement Identities](#twos-complement-identities)
4. [The Submask Loop: Correctness Proof](#the-submask-loop-correctness-proof)
5. [The `3^n` Derivation](#the-3n-derivation)
6. [Counting Set Bits (Popcount)](#counting-set-bits-popcount)
7. [The Subset-Sum Transform and Its Inverse](#the-subset-sum-transform-and-its-inverse)
8. [Gray Codes and the Lattice as a Hypercube](#gray-codes-and-the-lattice-as-a-hypercube)
9. [Complexity Proofs](#complexity-proofs)
10. [Code Examples](#code-examples)
11. [Formal Summary of Identities](#formal-summary-of-identities)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

Bitmask enumeration is usually presented as a bag of tricks. At the professional level we treat it as what it really is: an *isomorphism* between the Boolean lattice `(2^U, ⊆)` of subsets of a finite universe `U = {0,…,n-1}` and the integers `[0, 2^n)` under their bitwise structure. Every "trick" is then a theorem:

- "A subset is an integer" is a **bijection**, in fact a lattice isomorphism (`∪ ↦ |`, `∩ ↦ &`, `⊆ ↦ &-test`).
- "`(s-1) & mask` visits every submask once" is a **counting argument**: it is a decrement on a restricted bit-set, traversing a `popcount(mask)`-bit odometer.
- "Submasks of all masks cost `3^n`" is the **binomial theorem** `Σ C(n,k) 2^k = (1+2)^n`.

This file proves each of these claims precisely, derives the complexities, and treats popcount as a function with its own identities.

Throughout, `[n] = {0, 1, …, n-1}`, `|S|` is cardinality, `popcount(x)` is the number of `1` bits of `x`, and `χ_S` is the indicator of `S`.

---

## The Integer–Subset Bijection

**Definition.** For `S ⊆ [n]`, define `enc(S) = Σ_{i∈S} 2^i ∈ ℤ`.

**Theorem 1 (bijection).** `enc` is a bijection from the power set `2^{[n]}` onto the integer interval `[0, 2^n)`.

**Proof.** Every integer `x ∈ [0, 2^n)` has a unique binary representation `x = Σ_{i=0}^{n-1} b_i 2^i` with `b_i ∈ {0,1}` (uniqueness of base-2 representation, standard). Define `dec(x) = { i : b_i = 1 }`. Then `enc(dec(x)) = x` and `dec(enc(S)) = S`, because bit `i` of `enc(S)` equals `χ_S(i)`. So `enc` and `dec` are mutually inverse, hence `enc` is a bijection. Both sets have cardinality `2^n`, consistent with the bijection. ∎

**Theorem 2 (lattice isomorphism).** Under `enc`, set operations correspond to bitwise operations:

```text
enc(A ∪ B) = enc(A) | enc(B)
enc(A ∩ B) = enc(A) & enc(B)
enc(A \ B) = enc(A) & ~enc(B)        (within [n] bits)
A ⊆ B  ⇔  enc(A) & enc(B) = enc(A)
|A|     = popcount(enc(A))
```

**Proof.** Bitwise operators act independently on each bit position `i`. For union, bit `i` of `enc(A)|enc(B)` is `χ_A(i) ∨ χ_B(i) = χ_{A∪B}(i)`. Identical bit-by-bit arguments give intersection (`∧`), difference, and symmetric difference (`⊕`). The subset characterization: `A ⊆ B ⇔ ∀i (χ_A(i) ⇒ χ_B(i)) ⇔ ∀i (χ_A(i) ∧ χ_B(i) = χ_A(i)) ⇔ enc(A) & enc(B) = enc(A)`. Cardinality equals the count of `1` bits by definition of `popcount`. ∎

This isomorphism is the foundation: any statement about subsets can be transported to integers and back, losslessly, as long as the universe fits in the integer's bits.

---

## Two's-Complement Identities

The lowbit and clear-lowbit tricks rest on two identities. Let `x` be a `w`-bit integer with at least one set bit, and let `t = tz(x)` be the number of trailing zeros (so `2^t` is the lowest set bit's value).

**Lemma 3 (lowest set bit).** `x & (-x) = 2^t`, the lowest set bit.

**Proof.** In two's complement, `-x = ~x + 1`. Write `x = (high) · 2^{t+1} + 2^t` where bit `t` is the lowest `1` and bits `0..t-1` are `0`. Then `~x` has bits `0..t-1` equal to `1`, bit `t` equal to `0`, and the high part complemented. Adding `1` propagates a carry through bits `0..t-1` (all `1 → 0`) and sets bit `t` to `1`, leaving the high part as `~(high)`. So `-x` has bit `t` set, bits `0..t-1` clear, and complemented high bits. AND-ing with `x`: bits `0..t-1` are `0` in `x`; bit `t` is `1` in both; high bits are complementary, so AND to `0`. Result: only bit `t` survives, i.e. `2^t`. ∎

**Lemma 4 (clear lowest set bit).** `x & (x - 1)` equals `x` with its lowest set bit cleared.

**Proof.** `x - 1` flips bits `0..t-1` from `0` to `1` and bit `t` from `1` to `0`, leaving higher bits unchanged. AND with `x`: bits `0..t-1` are `0` in `x` (cleared), bit `t` is `0` in `x-1` (cleared), high bits unchanged. So exactly bit `t` is removed. ∎

These two lemmas justify the set-bit loop: each `x &= x - 1` removes one set bit, so the loop runs `popcount(x)` times, and `x & -x` names the bit removed.

---

## The Submask Loop: Correctness Proof

We prove the central claim of the topic.

**Setup.** Fix `mask` with `p = popcount(mask)`. A **submask** of `mask` is an integer `s` with `s & mask == s` (equivalently `s ⊆ mask` under `enc`). Let `Sub(mask) = { s : s & mask = s }`; `|Sub(mask)| = 2^p` by Theorem 1 applied to the universe of `mask`'s set positions.

**Algorithm.** Start `s := mask`; repeatedly set `s := (s - 1) & mask`; the sequence is `s_0 = mask, s_1, s_2, …`.

**Theorem 5 (submask enumeration).** The sequence `s_0, s_1, …` consists of exactly the elements of `Sub(mask)` in **strictly decreasing** order, beginning at `mask` and ending at `0`, each appearing exactly once. After emitting `0`, the next application of `(s-1) & mask` produces `(-1) & mask = mask` (wraparound), which is why the loop must terminate when `s = 0`.

**Proof.**

*(1) Every `s_j` is a submask.* The map `s ↦ (s - 1) & mask` ANDs with `mask`, so its output has no bits outside `mask`; hence every `s_j` (for `j ≥ 1`) satisfies `s_j & mask = s_j`, i.e. `s_j ∈ Sub(mask)`. And `s_0 = mask ∈ Sub(mask)`.

*(2) Strictly decreasing while non-zero.* Suppose `s_j > 0` and `s_j ∈ Sub(mask)`. Then `s_{j+1} = (s_j - 1) & mask`. Since `s_j > 0`, `s_j - 1 < s_j`, and `(s_j - 1) & mask ≤ s_j - 1 < s_j`. So `s_{j+1} < s_j`. Strict decrease of non-negative integers guarantees the sequence reaches `0` in finitely many steps.

*(3) No submask is skipped.* We claim `s_{j+1}` is the **largest** submask of `mask` strictly less than `s_j`. Let `t` be any submask with `t < s_j`. We show `t ≤ s_{j+1}`. Consider the highest bit position `h` where `s_j` and `t` differ. Since `t < s_j`, bit `h` is `1` in `s_j` and `0` in `t`. Now `s_j - 1` agrees with `s_j` on all bits above the lowest set bit of `s_j`; restricting the decrement to `mask`'s positions (the `& mask`) yields the immediate predecessor of `s_j` *within `Sub(mask)`* — formally, identify each submask `s ⊆ mask` with the integer obtained by extracting `mask`'s `p` bit-positions into a `p`-bit number `φ(s)`; `φ` is an order-isomorphism from `(Sub(mask), <)` to `([0, 2^p), <)` (it preserves order because higher `mask`-positions carry higher place value). Decrementing `s` on the `mask`-positions is exactly `φ^{-1}(φ(s) - 1)`, the integer predecessor in `[0, 2^p)`. Predecessor in a contiguous integer range skips nothing. Hence the sequence `φ(s_0) = 2^p - 1, φ(s_1) = 2^p - 2, …` runs through every value in `[0, 2^p)` exactly once, and so `s_0, s_1, …` runs through every submask exactly once.

*(4) Termination and wraparound.* When `s_j = 0`, `φ(s_j) = 0`, the smallest submask; we have enumerated all `2^p`. Applying the step once more gives `(0 - 1) & mask = (all-ones) & mask = mask = s_0`, so without the `s == 0` guard the loop cycles forever. Therefore the loop must test and break on `0`. ∎

**Corollary 6.** The loop body executes `2^p` times if `0` is included (canonical `for(;;) {…; if(s==0) break;}` form) and `2^p − 1` times if written `while (s) {…; s=(s-1)&mask;}` (excluding `0`).

The order-isomorphism `φ` in step (3) is the precise statement of the informal "decrement on `mask`'s live bit positions" intuition from `middle.md`.

---

## The `3^n` Derivation

**Theorem 7.** `Σ_{mask=0}^{2^n - 1} 2^{popcount(mask)} = 3^n`.

**Algebraic proof (binomial theorem).** Group masks by popcount. The number of masks with exactly `k` set bits is `C(n, k)` (choose which `k` of the `n` positions are set). Each such mask has `2^k` submasks (Theorem 5). Hence:

```text
Σ_{mask} 2^{popcount(mask)} = Σ_{k=0}^{n} C(n,k) · 2^k
                            = Σ_{k=0}^{n} C(n,k) · 2^k · 1^{n-k}
                            = (2 + 1)^n          [binomial theorem (x+y)^n = Σ C(n,k) x^k y^{n-k} with x=2, y=1]
                            = 3^n.  ∎
```

**Combinatorial proof (three states per element).** A pair `(mask, submask)` with `submask ⊆ mask` assigns each element `i ∈ [n]` to exactly one of three mutually exclusive states:

```text
state A:  i ∉ mask                 (so i ∉ submask necessarily)
state B:  i ∈ mask but i ∉ submask
state C:  i ∈ submask              (so i ∈ mask necessarily)
```

Every choice of state for every element yields a valid `(mask, submask)` pair, and every valid pair arises exactly once this way. With `3` independent choices for each of `n` elements, the number of pairs is `3^n`. This count is also `Σ_mask (number of submasks of mask) = Σ_mask 2^{popcount(mask)}`, proving Theorem 7 bijectively. ∎

**Consequence (Theorem 8, complexity of the submask double loop).** The nested loop

```text
for mask in [0, 2^n):
    for s in Sub(mask): work(mask, s)
```

executes `work` exactly `Σ_mask 2^{popcount(mask)} = 3^n` times, so it runs in `Θ(3^n · C)` where `C` is the body cost — **not** `Θ(4^n)`. The naive overestimate `2^n · 2^n = 4^n` ignores that submasks of small masks are few. ∎

---

## Counting Set Bits (Popcount)

`popcount(x) = |dec(x)| = Σ_{i} bit_i(x)`. Useful identities and methods:

- **Recurrence (Kernighan):** `popcount(x) = 1 + popcount(x & (x-1))` for `x > 0`, by Lemma 4 (one bit removed per step). This gives an `O(popcount)` loop.
- **DP over masks:** `pc[x] = pc[x >> 1] + (x & 1)` builds all popcounts in `[0, 2^n)` in `Θ(2^n)`.
- **Lowbit DP:** `pc[x] = pc[x & (x-1)] + 1`, also `Θ(2^n)`.
- **Parallel bit-count (SWAR):** the classic `Θ(log w)` word algorithm folding adjacent bit-groups; the basis of hardware `POPCNT`.
- **Hardware instruction:** modern CPUs compute `popcount` in one instruction; language built-ins (`bits.OnesCount`, `Long.bitCount`, `int.bit_count`) expose it.

**Identity (complement).** `popcount(x) + popcount(x ^ ((1<<n)-1)) = n`, since complementing within `[n]` swaps each bit, so set and unset bits exchange roles (Theorem 2, cardinality).

---

## The Subset-Sum Transform and Its Inverse

The "sum over all submasks" operation is a linear transform on the vector space `ℝ^{2^n}` (functions on the lattice), and it has a clean algebraic structure worth stating precisely.

**Definition (zeta transform of the subset lattice).** For `f : 2^{[n]} → ℝ`, define the **down-zeta** (sum over submasks)

```text
(ζf)(mask) = Σ_{s ⊆ mask} f(s).
```

**Theorem 9 (SOS computes ζ in `Θ(n·2^n)`).** The layered transform

```text
g := f
for i in 0 .. n-1:
    for mask in [0, 2^n):
        if mask has bit i: g[mask] += g[mask without bit i]
```

leaves `g = ζf`.

**Proof.** Induct on the bit index. Let `g_i` be `g` after processing bits `0..i-1`. Claim: `g_i(mask) = Σ_{s} f(s)` over all `s` that agree with `mask` on bits `≥ i` and are arbitrary submasks on bits `< i` (i.e. `s ⊆ mask` and `s` equals `mask` outside the first `i` positions). Base `g_0 = f` (only `s = mask`). Step: processing bit `i` adds, for masks with bit `i` set, the value at `mask` with bit `i` cleared, which by hypothesis already sums over all sub-choices on bits `< i` for that cleared mask; the union extends the free positions to `0..i`. After bit `n-1`, all positions are free, giving `Σ_{s ⊆ mask} f(s) = (ζf)(mask)`. Each of the `n` layers does `2^n` `O(1)` updates, so `Θ(n·2^n)`. ∎

**Theorem 10 (Möbius inversion).** The inverse transform (the **down-Möbius**) is

```text
f(mask) = Σ_{s ⊆ mask} (-1)^{popcount(mask) - popcount(s)} (ζf)(s),
```

computed by the same loop with `g[mask] -= g[mask without bit i]`. On the Boolean lattice the Möbius function is `μ(s, mask) = (-1)^{|mask \ s|}` for `s ⊆ mask`, which is exactly the alternating sign above.

**Proof sketch.** The subtractive layered loop is the inverse linear operator: each layer's add is invertible by the matching subtract (the per-bit operator is `(I + S_i)` where `S_i` shifts in bit `i`; its inverse is `(I − S_i)` since `S_i^2 = 0` on this lattice). Composing inverses in any order recovers `f`. The closed form is the standard Möbius function of the subset lattice. ∎

This is the rigorous backbone of inclusion–exclusion over subsets: `ζ` and its inverse are why "sum over submasks" and "recover from sums" both cost `Θ(n·2^n)` rather than `Θ(3^n)`.

---

## Gray Codes and the Lattice as a Hypercube

The subsets of `[n]` are the vertices of the `n`-dimensional hypercube `Q_n`, with an edge between two subsets iff they differ in exactly one element.

**Definition.** The **reflected binary Gray code** maps index `i` to `G(i) = i ⊕ (i >> 1)`.

**Theorem 11 (Gray code is a Hamiltonian path on `Q_n`).** As `i` runs `0, 1, …, 2^n − 1`, the masks `G(i)` enumerate all `2^n` subsets, and consecutive masks `G(i)` and `G(i+1)` differ in exactly one bit.

**Proof.** `G` is a bijection on `[0, 2^n)`: it is invertible by the prefix-xor `i = G ⊕ (G>>1) ⊕ (G>>2) ⊕ …`. Consecutive difference: `G(i) ⊕ G(i+1) = (i ⊕ (i>>1)) ⊕ ((i+1) ⊕ ((i+1)>>1))`. Writing `i+1 = i + 1` and analyzing the carry, the result is a single set bit at the position of the lowest `0` of `i` (standard reflected-Gray property), so exactly one element is toggled between consecutive masks. Hence the sequence is a Hamiltonian path on `Q_n`. ∎

**Consequence (Theorem 12, incremental enumeration).** Any quantity `Φ(S)` that can be updated in `O(1)` under adding or removing a single element can be enumerated over all subsets in `Θ(2^n)` total, versus `Θ(2^n · n)` for from-scratch recomputation: walk the Gray-code order, and at each step apply the single toggle. ∎

This connects the lattice structure to a concrete speedup and explains why Gray-code order is preferred for incrementally maintainable subset functions.

---

## Complexity Proofs

**All subsets.** The loop `for mask in [0, 2^n)` performs `2^n` iterations; with an `O(1)` body, `Θ(2^n)`. Scanning all `n` bits per mask makes it `Θ(n · 2^n)`.

**Set-bit loop.** By Lemma 4 each `x &= x-1` removes exactly one set bit, so the loop terminates after `popcount(x)` iterations; over a full enumeration, `Σ_mask popcount(mask) = n · 2^{n-1}` (each of `n` bits is set in half the masks), giving `Θ(n · 2^n)` total — same order as scanning, but with `popcount` actual iterations per mask, beneficial on sparse masks.

**Submask loop (one mask).** Theorem 5 gives `2^{popcount(mask)}` iterations: `Θ(2^p)`.

**Submask double loop.** Theorem 8: `Θ(3^n)`.

**Superset loop (one mask).** Supersets correspond to submasks of the complement (free bits number `n - p`), so `2^{n-p}` iterations; over all masks, `Σ_mask 2^{n - popcount(mask)} = 2^n Σ_mask 2^{-popcount(mask)} = 2^n (1 + 1/2)^n = 3^n` as well (symmetric to Theorem 7).

**SOS DP.** Aggregating a function over all submasks of every mask via the standard layered transform touches each `(bit, mask)` pair once: `Θ(n · 2^n)`, strictly better than `Θ(3^n)` for `n ≥ 2` (since `n · 2^n < 3^n` for `n ≥ 5`). This is why senior code prefers SOS when only an aggregate is needed.

---

## Code Examples

### Verifying `Σ 2^popcount = 3^n` and the Bijection

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

func main() {
	for n := 0; n <= 12; n++ {
		sum := 0
		for mask := 0; mask < (1 << n); mask++ {
			sum += 1 << bits.OnesCount(uint(mask)) // 2^popcount(mask)
		}
		fmt.Printf("n=%2d  Σ2^popcount=%d  3^n=%d  equal=%v\n",
			n, sum, pow3(n), sum == pow3(n))
	}
}

func pow3(n int) int {
	r := 1
	for ; n > 0; n-- {
		r *= 3
	}
	return r
}
```

#### Java

```java
public class ThreePow {
    public static void main(String[] args) {
        for (int n = 0; n <= 12; n++) {
            long sum = 0;
            for (int mask = 0; mask < (1 << n); mask++) {
                sum += 1L << Integer.bitCount(mask); // 2^popcount
            }
            long p3 = 1;
            for (int i = 0; i < n; i++) p3 *= 3;
            System.out.printf("n=%2d  sum=%d  3^n=%d  equal=%b%n", n, sum, p3, sum == p3);
        }
    }
}
```

#### Python

```python
def verify(n_max=12):
    for n in range(n_max + 1):
        total = sum(1 << bin(mask).count("1") for mask in range(1 << n))
        assert total == 3 ** n, (n, total)
        print(f"n={n:2d}  sum={total}  3^n={3**n}  equal=True")


if __name__ == "__main__":
    verify()
```

### Empirically Checking the Submask Bijection

#### Python

```python
def submasks(mask):
    s = mask
    while True:
        yield s
        if s == 0:
            break
        s = (s - 1) & mask


def check(n=10):
    for mask in range(1 << n):
        emitted = list(submasks(mask))
        oracle = [t for t in range(1 << n) if t & mask == t]  # all submasks
        assert sorted(emitted) == sorted(oracle)              # same set
        assert len(emitted) == len(set(emitted)) == (1 << bin(mask).count("1"))
        assert emitted == sorted(emitted, reverse=True)       # strictly decreasing
    print(f"submask loop verified for all masks, n={n}")


if __name__ == "__main__":
    check()
```

### Zeta Transform and Möbius Inversion Round-Trip

Confirms Theorems 9 and 10: SOS computes the subset-sum, and the subtractive loop inverts it.

#### Go

```go
package main

import "fmt"

func zeta(f []int64, n int) []int64 {
	g := append([]int64(nil), f...)
	for i := 0; i < n; i++ {
		for mask := 0; mask < (1 << n); mask++ {
			if mask&(1<<i) != 0 {
				g[mask] += g[mask^(1<<i)]
			}
		}
	}
	return g
}

func mobius(g []int64, n int) []int64 {
	f := append([]int64(nil), g...)
	for i := 0; i < n; i++ {
		for mask := 0; mask < (1 << n); mask++ {
			if mask&(1<<i) != 0 {
				f[mask] -= f[mask^(1<<i)]
			}
		}
	}
	return f
}

func main() {
	n := 4
	f := make([]int64, 1<<n)
	for i := range f {
		f[i] = int64(i*i + 1)
	}
	g := zeta(f, n)
	back := mobius(g, n)
	ok := true
	for i := range f {
		if f[i] != back[i] {
			ok = false
		}
	}
	fmt.Println("zeta then mobius recovers f:", ok)
}
```

#### Java

```java
import java.util.*;

public class ZetaMobius {
    static long[] zeta(long[] f, int n) {
        long[] g = f.clone();
        for (int i = 0; i < n; i++)
            for (int mask = 0; mask < (1 << n); mask++)
                if ((mask & (1 << i)) != 0) g[mask] += g[mask ^ (1 << i)];
        return g;
    }

    static long[] mobius(long[] g, int n) {
        long[] f = g.clone();
        for (int i = 0; i < n; i++)
            for (int mask = 0; mask < (1 << n); mask++)
                if ((mask & (1 << i)) != 0) f[mask] -= f[mask ^ (1 << i)];
        return f;
    }

    public static void main(String[] args) {
        int n = 4;
        long[] f = new long[1 << n];
        for (int i = 0; i < f.length; i++) f[i] = (long) i * i + 1;
        long[] back = mobius(zeta(f, n), n);
        System.out.println("round-trip ok: " + Arrays.equals(f, back));
    }
}
```

#### Python

```python
def zeta(f, n):
    g = f[:]
    for i in range(n):
        for mask in range(1 << n):
            if mask & (1 << i):
                g[mask] += g[mask ^ (1 << i)]
    return g


def mobius(g, n):
    f = g[:]
    for i in range(n):
        for mask in range(1 << n):
            if mask & (1 << i):
                f[mask] -= f[mask ^ (1 << i)]
    return f


if __name__ == "__main__":
    n = 4
    f = [i * i + 1 for i in range(1 << n)]
    assert mobius(zeta(f, n), n) == f   # Theorem 10
    print("zeta then mobius recovers f")
```

### Verifying the Gray-Code Hamiltonian Path

Confirms Theorem 11: every subset appears once, consecutive masks differ in one bit.

#### Python

```python
def gray(i):
    return i ^ (i >> 1)


def check_gray(n=8):
    seen = set()
    prev = None
    for i in range(1 << n):
        g = gray(i)
        seen.add(g)
        if prev is not None:
            assert bin(g ^ prev).count("1") == 1   # single-bit change
        prev = g
    assert len(seen) == (1 << n)                    # covers all subsets
    print(f"Gray code is a Hamiltonian path on Q_{n}")


if __name__ == "__main__":
    check_gray()
```

---

## Formal Summary of Identities

```text
enc(S) = Σ_{i∈S} 2^i                              (subset → integer bijection)
A ⊆ B            ⇔   a & b == a
|A|               =   popcount(a)
x & (-x)          =   lowest set bit (2^tz(x))      (Lemma 3)
x & (x - 1)       =   x with lowest set bit cleared (Lemma 4)
popcount(x)       =   1 + popcount(x & (x-1))       (Kernighan)
Sub(mask)         =   { s : s & mask == s },  |Sub(mask)| = 2^popcount(mask)
(s-1) & mask      =   predecessor of s in Sub(mask) (Theorem 5)
Σ_mask 2^popcount(mask)  =  Σ_k C(n,k) 2^k  =  3^n  (Theorem 7)
complement_n(x)   =   x ^ ((1<<n) - 1)
popcount(x) + popcount(complement_n(x)) = n
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - **Mode 1:** the bijection — the odometer `0 .. 2^n − 1` with each integer's bits and its subset
> - **Mode 2:** Theorem 5 in motion — `s = (s - 1) & mask` descending through `Sub(mask)`, with a counter confirming `2^popcount(mask)` submasks
> - Adjustable `n` and `mask`, Play / Pause / Step / Reset

---

## Summary

The "tricks" are theorems. `enc(S) = Σ 2^i` is a lattice isomorphism (Theorems 1–2), so set algebra *is* bitwise algebra. Two's-complement gives `x & -x =` lowest set bit and `x & (x-1) =` clear it (Lemmas 3–4), justifying the set-bit loop's `popcount` iterations. The submask loop `s = (s-1) & mask` is an order-isomorphic decrement on `mask`'s live positions, so it traverses all `2^popcount(mask)` submasks exactly once in strictly decreasing order, wrapping back to `mask` after `0` (Theorem 5) — which is why the `s == 0` break is mandatory. Summing submask counts over all masks gives `Σ C(n,k) 2^k = 3^n` by the binomial theorem, equivalently the three-states-per-element bijection, so the submask double loop is `Θ(3^n)`, not `4^n` (Theorems 7–8). When only an aggregate over submasks is needed, SOS DP beats it at `Θ(n·2^n)`.

---

## A Generating-Function View of `3^n`

The identity `Σ_k C(n,k) 2^k = 3^n` also drops out of generating functions, which generalizes cleanly. Assign to each element a formal variable contribution: an element is either *absent from the mask* (weight `1`), *in the mask but not the submask* (weight `1`), or *in both* (weight `1`). The per-element generating polynomial counting the three states is `(1 + 1 + 1) = 3`. Because elements are independent, the joint generating function is the product over all `n` elements:

```text
[count of (mask, submask) pairs] = Π_{i=1}^{n} (state_absent + state_inmask_only + state_insubmask)
                                 = 3^n.
```

To recover the binomial form, group the three states as "out of mask" (`1`) versus "in mask" (which splits into `1 + x` for the two submask choices, evaluated at `x = 1`): the per-element factor is `(1 + (1 + x)) = (2 + x)`, and `Π (1 + (1+x)) |_{x=1}` while extracting the coefficient of `popcount = k` gives `C(n,k)·2^k`, summing to `(2 + 1)^n = 3^n`. The generating-function lens makes the count modular: weighting "in submask" by a variable `y` yields `Σ_mask Σ_{s⊆mask} y^{popcount(s)} = (2 + y)^n`, a one-line derivation of many subset-sum-style identities.

---

## Numerical Stability and Exactness

All identities here are over **integers** (or a finite field `ℤ/pℤ`), so there is no floating-point error to manage — counts, zeta sums, and Möbius inversions are exact. The only numeric hazards are:

- **Overflow of exact counts.** `3^n` exceeds 64-bit at `n = 41` (`3^40 ≈ 1.2·10^19`); reduce mod a prime if you need larger.
- **Möbius sign with modular arithmetic.** The alternating `(-1)^{|mask\s|}` must be applied as modular subtraction with normalization `((x % p) + p) % p`, since the lattice Möbius function takes negative values.
- **Associativity of `ζ` layers.** The SOS layers commute (each per-bit operator acts on an independent coordinate), so any bit order yields the same exact result — useful for cache-ordering without correctness risk.

---

## Further Reading

- Concrete Mathematics (Graham, Knuth, Patashnik) — binomial identities, generating functions.
- *Hacker's Delight* (Warren) — two's-complement bit identities, parallel popcount.
- cp-algorithms.com — "Submask enumeration", "Sum over subsets DP".
- Sibling `05` — Gosper's hack and fixed-popcount enumeration order.
- Sibling `13/06-bitmask-dp` — the `3^n` and `n·2^n` bounds applied to subset-DP problems.
- Knuth, *TAOCP* Vol. 4A — "Bitwise tricks and techniques", subset generation.

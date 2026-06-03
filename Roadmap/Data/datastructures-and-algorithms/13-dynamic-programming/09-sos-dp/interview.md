# Sum over Subsets DP (SOS DP) — Interview Preparation

SOS DP is a favourite interview topic because it rewards a single crisp insight — *"a submask sum over all masks is a multidimensional prefix sum, computable in `O(n · 2^n)` by sweeping one bit at a time"* — and then tests whether you can (a) write the four-line loop without bugs, (b) keep it correct with modular arithmetic, (c) recognize the same skeleton behind the superset variant, the Möbius inverse, inclusion-exclusion, and OR/AND convolutions, and (d) avoid the classic traps (subset vs superset direction, zeta vs Möbius sign, `2^n` memory). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Sum over all submasks, every mask | subset zeta (SOS DP) | `O(n · 2^n)` |
| Sum over all supersets, every mask | superset zeta | `O(n · 2^n)` |
| Recover `A` from a zeta-transformed array | Möbius inverse (subtract) | `O(n · 2^n)` |
| All `2^n` inclusion-exclusion sums | Möbius transform | `O(n · 2^n)` |
| OR-convolution `Σ_{i|j=m} A[i]B[j]` | subset zeta, multiply, subset Möbius | `O(n · 2^n)` |
| AND-convolution `Σ_{i&j=m} A[i]B[j]` | superset zeta, multiply, superset Möbius | `O(n · 2^n)` |
| XOR-convolution `Σ_{i^j=m} A[i]B[j]` | Walsh-Hadamard transform | `O(n · 2^n)` |
| Disjoint subset-sum convolution | popcount-ranked SOS | `O(n^2 · 2^n)` |
| **Naive submask sum (all masks)** | per-mask `(sub-1)&mask` loop | **`O(3^n)`** |

Direction table (the loop skeleton never changes; only the neighbor and the sign do):

```text
operation         branch          update
subset zeta       mask & bit      F[mask] += F[mask ^ bit]
subset Mobius     mask & bit      F[mask] -= F[mask ^ bit]
superset zeta     !(mask & bit)   F[mask] += F[mask | bit]
superset Mobius   !(mask & bit)   F[mask] -= F[mask | bit]
```

Core algorithm:

```text
sos(A, n):
    F = copy(A)
    for i in 0..n-1:               # each bit / dimension (OUTER)
        for mask in 0..2^n-1:      # each mask (INNER)
            if mask & (1<<i):
                F[mask] += F[mask ^ (1<<i)]
    return F                       # O(n * 2^n); reduce mod p if counting
```

Key facts:
- **Bit loop OUTER, mask loop INNER** — required for in-place correctness.
- Subset zeta: set-bit mask pulls from `mask ^ bit` (the bit-cleared neighbor).
- `F[0] = A[0]`; `F[full] = Σ A` (grand total).
- `μ(sub, mask) = (-1)^{popcount(mask) - popcount(sub)}` — the inclusion-exclusion sign.
- Memory is `2^n` cells → feasible only for `n ≤ ~22`.

---

## Junior Questions (12 Q&A)

### J1. What does `F[mask] = Σ_{sub ⊆ mask} A[sub]` mean?
For each mask, `F[mask]` is the total of `A` over every submask of `mask` — every `sub` with `(sub & mask) == sub`. The empty mask is a submask of everything, so `A[0]` appears in every `F[mask]`; `mask` is its own submask, so `A[mask]` is always included too.

### J2. What is a submask?
A mask `sub` whose set bits are a subset of `mask`'s set bits: `(sub & mask) == sub`. A mask with `k` set bits has `2^k` submasks.

### J3. What is the naive cost of computing all submask sums?
`O(3^n)`. Summing `Σ_mask 2^popcount(mask) = (1+2)^n = 3^n` because each bit is independently *out of mask*, *in mask only*, or *in both*.

### J4. What is the SOS DP and its complexity?
A bit-by-bit relaxation: for each bit `i`, every mask with bit `i` set adds the value of the mask with bit `i` cleared. After `n` sweeps, `F[mask]` is the full submask sum. It runs in `O(n · 2^n)`.

### J5. Write the classic SOS loop.
```
for i in 0..n-1:
    for mask in 0..2^n-1:
        if mask & (1<<i):
            F[mask] += F[mask ^ (1<<i)]
```
Bit loop outer, mask loop inner.

### J6. Why must the bit loop be outer?
The in-place correctness depends on it: when sweeping bit `i`, masks with bit `i` set read masks with bit `i` cleared, which are not modified during this pass, so they carry exactly the partial sum over bits `0..i-1`. Reversing the loops breaks this chaining.

### J7. What is `mask ^ (1<<i)` in the loop?
`mask` with bit `i` removed. We only reach the branch when bit `i` is set, so XOR clears it — that is the "subset neighbor" the mask absorbs.

### J8. Why take results modulo a prime?
Subset sums can grow exponentially; they overflow 64-bit integers. Counting problems ask for the answer mod a prime like `10^9 + 7`, so reduce after every `+=`.

### J9. What does `F[full mask]` equal?
The grand total `Σ A[sub]` over all masks, because the full mask contains every submask. This is a great sanity check.

### J10. Can SOS run in place?
Yes. The transform overwrites `F` (a copy of `A`) and is still correct because of the bit-outer ordering. If you need the original `A` afterward, copy it first.

### J11. What is the superset variant?
`G[mask] = Σ_{sup ⊇ mask} A[sup]`. Same loop, but masks with bit `i` *clear* absorb from `mask | (1<<i)`.

### J12 (analysis). Why is `O(n · 2^n)` so much better than `O(3^n)`?
The ratio is `3^n / (n · 2^n) = (1.5)^n / n`, which grows without bound. At `n = 20`, `3^n ≈ 3.5e9` vs `n·2^n ≈ 2e7` — about 166× faster.

---

## Middle Questions (12 Q&A)

### M1. How do you invert the zeta transform?
The Möbius inverse: same loop, but subtract instead of add. `F[mask] -= F[mask ^ bit]` for set-bit masks. This recovers the original `A`.

### M2. Why does subtraction invert the zeta?
Each bit-`i` pass is the linear map "add the bit-cleared neighbor" (`2×2` block `[[1,0],[1,1]]`); its inverse is "subtract the bit-cleared neighbor" (`[[1,0],[-1,1]]`). The passes act on independent axes and commute, so subtracting in the same loop inverts the whole transform.

### M3. What is the Möbius function on the subset lattice?
`μ(sub, mask) = (-1)^{popcount(mask) - popcount(sub)}` for `sub ⊆ mask`. So `A[mask] = Σ_{sub ⊆ mask} (-1)^{popcount(mask)-popcount(sub)} F[sub]`.

### M4. How is SOS related to inclusion-exclusion?
The alternating sign `(-1)^{Δpopcount}` in the Möbius formula *is* the inclusion-exclusion sign. SOS Möbius executes inclusion-exclusion for all `2^n` masks in `O(n · 2^n)` instead of an `O(3^n)` signed double sum.

### M5. How do you compute an OR-convolution?
`(A ⊛_OR B)[m] = Σ_{i|j=m} A[i]B[j]`. Subset-zeta both inputs, multiply pointwise, then subset-Möbius the product. Works because `zeta` is a homomorphism for OR: `zeta(A ⊛_OR B) = zeta(A) · zeta(B)`.

### M6. How do you compute an AND-convolution?
Identical recipe with the *superset* transform: superset-zeta both, multiply pointwise, superset-Möbius. Because `i & j ⊇ m ⟺ i ⊇ m ∧ j ⊇ m`.

### M7. How is XOR-convolution different?
It uses the Walsh-Hadamard transform, not zeta/Möbius. The butterfly is `(x, y) → (x+y, x-y)`; the inverse divides by `2^n`. Same Yates "one axis at a time" `O(n · 2^n)` structure, different `2×2` matrix.

### M8. What is Yates' algorithm?
The general "apply a `2×2` matrix to each bit-axis in turn" transform of a length-`2^n` vector. SOS zeta (`[[1,0],[1,1]]`), superset zeta (`[[1,1],[0,1]]`), and Walsh-Hadamard (`[[1,1],[1,-1]]`) are all instances; all are `O(n · 2^n)`.

### M9. How do you avoid overflow?
Reduce mod `p` after each `+=`/`-=`. In Go/Java promote to 64-bit before a convolution multiply, and normalize negatives after Möbius subtraction: `((x % p) + p) % p`.

### M10. What is the disjoint subset-sum convolution and why is it harder?
`Σ_{i|j=m, i&j=0} A[i]B[j]` — pairs that are disjoint *and* cover `m`. Plain OR-convolution over-counts overlapping pairs. The fix tracks popcount as an extra dimension so only `|i|+|j|=|m|` survive, costing `O(n^2 · 2^n)`.

### M11. When is SOS the wrong tool?
When `n` is large (`2^n` memory blows up), when the aggregation is over a relation other than subset/superset containment, or when you need only one mask's submask sum (then the `O(2^popcount)` per-mask loop is simpler).

### M12 (analysis). What does the round-trip test check?
`Möbius(zeta(A)) == A`. It catches sign errors and direction errors that uniform-data tests miss, and confirms the transform is a true inverse pair.

---

## Senior Questions (10 Q&A)

### S1. What limits SOS in practice?
The `2^n` memory wall, not the `n` factor. `int64` arrays are 8 MB at `n=20`, 128 MB at `n=24`, 2 GB at `n=28`. Convolutions need several arrays. The biggest lever is modeling `n` down (each bit removed roughly quarters the total work).

### S2. How do you keep a convolution exact when the answer exceeds one prime?
Run the whole pipeline under several coprime primes and reconstruct via CRT. Each prime is an independent SOS job (embarrassingly parallel). The product width `p^2 < 2^63` for `p ≈ 10^9` so a single 64-bit multiply-then-reduce is safe per prime.

### S3. Why can SOS Möbius work mod `2^64` where modular inverses fail?
The inverse only uses *subtraction* (block `[[1,0],[-1,1]]`, determinant 1), never division. So it inverts over any commutative ring, including `ℤ/2^{64}`. The Walsh-Hadamard inverse, by contrast, divides by `2^n` and needs `2` invertible.

### S4. How do you parallelize SOS?
Within a single bit pass, updates across masks are independent (a set-bit mask only reads a cleared-bit mask, never written that pass), so the inner loop parallelizes across threads. The outer bit loop is sequential. Convolution's two forward transforms run concurrently; CRT primes run independently.

### S5. How do you pick subset vs superset?
Match the containment direction of the question. "Aggregate over things contained in `mask`" → subset zeta; "aggregate over things containing `mask`" → superset zeta. For convolutions: OR → subset, AND → superset, XOR → Walsh-Hadamard. Encapsulate each as a named function so the direction is never guessed inline.

### S6. How do you verify SOS when `n` is too large to brute-force?
Brute-force the `O(3^n)` oracle for small `n` and diff entrywise; add property tests: `F[full] == ΣA`, `F[0] == A[0]`, `Möbius(zeta(A)) == A`, and convolution-vs-brute-force. Cross-language determinism (same modulus) is another strong check.

### S7. What are the main performance levers?
Flat contiguous array indexed by the integer mask, bit-outer loop (correctness + locality), hoist `bit = 1<<i`, SIMD across masks (the bit-set and bit-cleared halves are contiguous `2^i`-blocks), parallel inner loop, and cache blocking for the high-bit passes (long strides).

### S8. How does the disjoint subset-sum convolution power real algorithms?
It is the engine of partition/covering counting: graph coloring (`O(2^n n^2)` chromatic polynomial), Steiner tree DP, counting set partitions. The popcount grading converts the over-counting OR-convolution into the exact disjoint one.

### S9. What is the relationship between SOS and the FFT?
Both are Yates multidimensional transforms. The Walsh-Hadamard transform is literally the DFT over the group `(ℤ/2)^n` (size-2 DFT butterfly `[[1,1],[1,-1]]`). OR-convolution is the product in the subset-semilattice algebra, diagonalized by zeta, exactly as cyclic convolution is diagonalized by the DFT.

### S10 (analysis). Why is min/max zeta valid but not invertible?
You can sweep with `min` to get `min_{sub ⊆ mask} A[sub]` in `O(n · 2^n)`. But `min`/`max` are idempotent with no inverse element, so there is no Möbius transform and no convolution can be built from them. Use it only as a one-way aggregation.

---

## Professional Questions (8 Q&A)

### P1. Design a service answering "total weight over all sub-capability sets" for arbitrary capability masks.
With `n` small, precompute the subset zeta once (`O(n · 2^n)`); each query is an `O(1)` array read. Cache the transformed array read-only across requests; never recompute per query. If weights can exceed one prime's range, run per CRT prime and reconstruct. Validate the size (`len == 1<<n`) and `n` against a memory cap before allocating.

### P2. How do you handle a convolution where one operand is fixed across many calls?
Compute `zeta(A)` once and reuse it; only transform each new `B`, multiply, and invert. For repeated self-convolution (OR-powers), transform once, raise pointwise to the power, transform back — turning `k`-fold OR-convolution into one zeta + one pointwise `x^k` + one Möbius.

### P3. Your `n` is 26 and memory is exploding. What do you do?
First minimize `n`: merge indistinguishable items, drop never-occurring ones, exploit symmetry (each bit removed quarters the work). Use a narrower element type (`uint32` if the modulus fits). If still infeasible, SOS is the wrong tool — consider meet-in-the-middle (split the universe) or a different formulation.

### P4. How do you debug "the SOS answer is wrong" in production?
Run the `O(3^n)` brute-force oracle on the exact small inputs and diff. Check the three usual suspects: wrong direction (subset vs superset neighbor), wrong sign (zeta vs Möbius), and loop order (bit must be outer). Verify `Möbius(zeta(A)) == A` and `F[full] == ΣA`.

### P5. When does OR-convolution silently give the wrong answer?
When the problem actually needs the **disjoint** subset-sum convolution (partition into disjoint pieces). OR-convolution counts overlapping pairs `i & j ≠ 0` too. The fix is the popcount-ranked `O(n^2 · 2^n)` algorithm; the symptom is over-counts that look plausible.

### P6. How do you parallelize a batch of SOS-based queries?
Cache the forward transform of any fixed operand. Different queries (masks) reduce to `O(1)` reads or independent pointwise work. Across CRT primes, each prime is a separate job. For one huge transform, parallelize the inner mask loop across threads.

### P7. How do SOS transforms relate to the incidence algebra?
The zeta function `ζ(x,y) = [x ≤ y]` and the Möbius function `μ = ζ^{-1}` are inverse elements of the incidence algebra of the Boolean lattice. SOS DP is the efficient evaluation of these via the product-lattice (per-bit) factorization — Rota's theory made into an `O(n · 2^n)` algorithm.

### P8 (analysis). Why is the SOS recurrence in-place and order-independent within a pass?
During pass `i`, every write target (`mask` with bit `i` set) reads only `mask ^ bit` (bit `i` cleared), and cleared-bit masks are never written that pass. So there is no read-after-write hazard regardless of mask iteration order, the result is order-independent, and the transform needs no scratch array.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential `3^n` computation with something faster.
Look for a concrete story: a containment-aggregation or inclusion-exclusion task where the naive submask enumeration dominated a profile, the insight that it is a multidimensional prefix sum, and the measured speedup. Strong answers mention validating against the slow version on small inputs and the memory budget for `2^n`.

### B2. A teammate used OR-convolution for a "partition into disjoint sets" count and shipped over-counts. How do you handle it?
Explain calmly with a tiny counterexample (a pair `i, j` with `i & j ≠ 0` still satisfies `i | j = m` and is wrongly counted). Point to the disjoint subset-sum convolution (popcount-ranked, `O(n^2 · 2^n)`) as the correct tool. Frame it as a subtle algebra distinction, not a blame moment.

### B3. Design a feature: "how many users have all of these features (and possibly more)?"
This is a superset count: build `cnt[mask]` = number of users with exactly that feature set, then superset-zeta it once; each query is an `O(1)` read of `G[queryMask]`. Discuss `n` (feature count) feasibility, memory `2^n`, and falling back to a different index if `n` is large.

### B4. How would you explain SOS DP to a junior engineer?
Start from prefix sums: SOS is a prefix sum on the hypercube `{0,1}^n`, where "prefix along axis `i`" means "bit `i` is 0 or 1". You do a 1-D prefix sum along each of the `n` axes in turn — that is the bit-by-bit loop. Lead with the two gotchas: bit loop must be outer, and watch the `2^n` memory.

### B5. The SOS job is consuming too much memory at scale. How do you investigate?
Each array is `2^n × element_size`; check whether `n` ballooned (un-minimized universe). Confirm transforms run in place and buffers are reused, not allocated per call. For convolutions, verify only the necessary arrays are live. The fix is usually `n` minimization plus narrower element types and buffer reuse.

---

## Coding Challenges

### Challenge 1: Sum over Subsets (mod p)

**Problem.** Given `n` and an array `A` of length `2^n`, compute `F[mask] = Σ_{sub ⊆ mask} A[sub] (mod 10^9+7)` for every mask.

**Example.**
```text
n=2, A=[1,2,3,4]  ->  F=[1,3,4,10]
(F[01]=A0+A1=3, F[10]=A0+A2=4, F[11]=A0+A1+A2+A3=10)
```

**Constraints.** `0 ≤ n ≤ 20`, entries in `[0, p)`.

**Brute force.** Per-mask submask loop, `O(3^n)`.

**Optimal.** SOS DP, `O(n · 2^n)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func sos(A []int64, n int) []int64 {
	F := make([]int64, len(A))
	copy(F, A)
	for i := 0; i < n; i++ {
		bit := 1 << i
		for mask := 0; mask < len(F); mask++ {
			if mask&bit != 0 {
				F[mask] = (F[mask] + F[mask^bit]) % MOD
			}
		}
	}
	return F
}

func main() {
	n := 2
	A := []int64{1, 2, 3, 4}
	fmt.Println(sos(A, n)) // [1 3 4 10]
}
```

**Java.**
```java
public class SosSum {
    static final long MOD = 1_000_000_007L;

    static long[] sos(long[] A, int n) {
        long[] F = A.clone();
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int mask = 0; mask < F.length; mask++)
                if ((mask & bit) != 0)
                    F[mask] = (F[mask] + F[mask ^ bit]) % MOD;
        }
        return F;
    }

    public static void main(String[] args) {
        int n = 2;
        long[] A = {1, 2, 3, 4};
        long[] F = sos(A, n);
        for (long v : F) System.out.print(v + " ");
        System.out.println(); // 1 3 4 10
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def sos(A, n):
    F = A[:]
    for i in range(n):
        bit = 1 << i
        for mask in range(len(F)):
            if mask & bit:
                F[mask] = (F[mask] + F[mask ^ bit]) % MOD
    return F


if __name__ == "__main__":
    n = 2
    A = [1, 2, 3, 4]
    print(sos(A, n))  # [1, 3, 4, 10]
```

---

### Challenge 2: Sum over Supersets

**Problem.** Given `n` and `A` of length `2^n`, compute `G[mask] = Σ_{sup ⊇ mask} A[sup] (mod 10^9+7)` for every mask.

**Example.**
```text
n=2, A=[1,2,3,4]  ->  G=[10,6,7,4]
(G[00]=all=10, G[01]=A1+A3=6, G[10]=A2+A3=7, G[11]=A3=4)
```

**Optimal.** Superset SOS, `O(n · 2^n)` — masks with the bit *clear* absorb from `mask | bit`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func supersetSum(A []int64, n int) []int64 {
	G := make([]int64, len(A))
	copy(G, A)
	for i := 0; i < n; i++ {
		bit := 1 << i
		for mask := 0; mask < len(G); mask++ {
			if mask&bit == 0 {
				G[mask] = (G[mask] + G[mask|bit]) % MOD
			}
		}
	}
	return G
}

func main() {
	n := 2
	A := []int64{1, 2, 3, 4}
	fmt.Println(supersetSum(A, n)) // [10 6 7 4]
}
```

**Java.**
```java
public class SupersetSum {
    static final long MOD = 1_000_000_007L;

    static long[] supersetSum(long[] A, int n) {
        long[] G = A.clone();
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int mask = 0; mask < G.length; mask++)
                if ((mask & bit) == 0)
                    G[mask] = (G[mask] + G[mask | bit]) % MOD;
        }
        return G;
    }

    public static void main(String[] args) {
        int n = 2;
        long[] A = {1, 2, 3, 4};
        long[] G = supersetSum(A, n);
        for (long v : G) System.out.print(v + " ");
        System.out.println(); // 10 6 7 4
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def superset_sum(A, n):
    G = A[:]
    for i in range(n):
        bit = 1 << i
        for mask in range(len(G)):
            if not (mask & bit):
                G[mask] = (G[mask] + G[mask | bit]) % MOD
    return G


if __name__ == "__main__":
    n = 2
    A = [1, 2, 3, 4]
    print(superset_sum(A, n))  # [10, 6, 7, 4]
```

---

### Challenge 3: OR-Convolution

**Problem.** Given `n` and arrays `A, B` of length `2^n`, compute `C[m] = Σ_{i | j = m} A[i]·B[j] (mod 10^9+7)`.

**Approach.** Subset-zeta both, multiply pointwise, subset-Möbius the product. `O(n · 2^n)`.

**Example.**
```text
n=1, A=[a0,a1], B=[b0,b1]
C[0] = a0*b0                      (only 0|0=0)
C[1] = a0*b1 + a1*b0 + a1*b1      (0|1, 1|0, 1|1 all = 1)
```

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func zeta(F []int64, n int) {
	for i := 0; i < n; i++ {
		bit := 1 << i
		for m := 0; m < len(F); m++ {
			if m&bit != 0 {
				F[m] = (F[m] + F[m^bit]) % MOD
			}
		}
	}
}

func mobius(F []int64, n int) {
	for i := 0; i < n; i++ {
		bit := 1 << i
		for m := 0; m < len(F); m++ {
			if m&bit != 0 {
				F[m] = ((F[m]-F[m^bit])%MOD + MOD) % MOD
			}
		}
	}
}

func orConv(A, B []int64, n int) []int64 {
	fa := append([]int64(nil), A...)
	fb := append([]int64(nil), B...)
	zeta(fa, n)
	zeta(fb, n)
	c := make([]int64, len(A))
	for m := range c {
		c[m] = fa[m] * fb[m] % MOD
	}
	mobius(c, n)
	return c
}

func main() {
	n := 2
	A := []int64{1, 2, 3, 4}
	B := []int64{5, 6, 7, 8}
	fmt.Println(orConv(A, B, n))
}
```

**Java.**
```java
public class OrConv {
    static final long MOD = 1_000_000_007L;

    static void zeta(long[] F, int n) {
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int m = 0; m < F.length; m++)
                if ((m & bit) != 0) F[m] = (F[m] + F[m ^ bit]) % MOD;
        }
    }

    static void mobius(long[] F, int n) {
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int m = 0; m < F.length; m++)
                if ((m & bit) != 0) F[m] = ((F[m] - F[m ^ bit]) % MOD + MOD) % MOD;
        }
    }

    static long[] orConv(long[] A, long[] B, int n) {
        long[] fa = A.clone(), fb = B.clone();
        zeta(fa, n);
        zeta(fb, n);
        long[] c = new long[A.length];
        for (int m = 0; m < c.length; m++) c[m] = fa[m] * fb[m] % MOD;
        mobius(c, n);
        return c;
    }

    public static void main(String[] args) {
        int n = 2;
        long[] A = {1, 2, 3, 4}, B = {5, 6, 7, 8};
        long[] c = orConv(A, B, n);
        for (long v : c) System.out.print(v + " ");
        System.out.println();
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def zeta(F, n):
    for i in range(n):
        bit = 1 << i
        for m in range(len(F)):
            if m & bit:
                F[m] = (F[m] + F[m ^ bit]) % MOD


def mobius(F, n):
    for i in range(n):
        bit = 1 << i
        for m in range(len(F)):
            if m & bit:
                F[m] = (F[m] - F[m ^ bit]) % MOD


def or_conv(A, B, n):
    fa, fb = A[:], B[:]
    zeta(fa, n)
    zeta(fb, n)
    c = [fa[m] * fb[m] % MOD for m in range(len(A))]
    mobius(c, n)
    return c


if __name__ == "__main__":
    n = 2
    A = [1, 2, 3, 4]
    B = [5, 6, 7, 8]
    print(or_conv(A, B, n))
```

---

### Challenge 4: Count Pairs with a Submask Relation

**Problem.** Given an array of `m` non-negative integers each `< 2^n`, count the ordered pairs `(x, y)` such that `x & y == x` (i.e. `x` is a submask of `y`). Return the count.

**Approach.** Build `cnt[v]` = how many array elements equal `v`. Superset-zeta `cnt` to get `sup[v]` = how many elements are supersets of `v`. For each distinct value `x` present `c_x` times, the number of `y` with `x ⊆ y` is `sup[x]`, so add `c_x · sup[x]`. Equivalently iterate the array and add `sup[x]` per element. `O(n · 2^n + m)`.

**Go.**
```go
package main

import "fmt"

func supersetSum(A []int64, n int) []int64 {
	G := make([]int64, len(A))
	copy(G, A)
	for i := 0; i < n; i++ {
		bit := 1 << i
		for mask := 0; mask < len(G); mask++ {
			if mask&bit == 0 {
				G[mask] += G[mask|bit]
			}
		}
	}
	return G
}

func countSubmaskPairs(vals []int, n int) int64 {
	cnt := make([]int64, 1<<n)
	for _, v := range vals {
		cnt[v]++
	}
	sup := supersetSum(cnt, n) // sup[x] = #elements that are supersets of x
	var total int64
	for _, x := range vals {
		total += sup[x] // number of y with x subset of y
	}
	return total
}

func main() {
	n := 3
	vals := []int{0b001, 0b011, 0b111, 0b010}
	// pairs (x,y) with x subset y, ordered (includes x==y)
	fmt.Println(countSubmaskPairs(vals, n))
}
```

**Java.**
```java
public class SubmaskPairs {
    static long[] supersetSum(long[] A, int n) {
        long[] G = A.clone();
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int mask = 0; mask < G.length; mask++)
                if ((mask & bit) == 0) G[mask] += G[mask | bit];
        }
        return G;
    }

    static long countSubmaskPairs(int[] vals, int n) {
        long[] cnt = new long[1 << n];
        for (int v : vals) cnt[v]++;
        long[] sup = supersetSum(cnt, n);
        long total = 0;
        for (int x : vals) total += sup[x];
        return total;
    }

    public static void main(String[] args) {
        int n = 3;
        int[] vals = {0b001, 0b011, 0b111, 0b010};
        System.out.println(countSubmaskPairs(vals, n));
    }
}
```

**Python.**
```python
def superset_sum(A, n):
    G = A[:]
    for i in range(n):
        bit = 1 << i
        for mask in range(len(G)):
            if not (mask & bit):
                G[mask] += G[mask | bit]
    return G


def count_submask_pairs(vals, n):
    cnt = [0] * (1 << n)
    for v in vals:
        cnt[v] += 1
    sup = superset_sum(cnt, n)   # sup[x] = #elements that are supersets of x
    return sum(sup[x] for x in vals)


if __name__ == "__main__":
    n = 3
    vals = [0b001, 0b011, 0b111, 0b010]
    print(count_submask_pairs(vals, n))
```

---

## Final Tips

- Lead with the one-liner: *"A submask sum over all masks is a hypercube prefix sum; the SOS DP computes it in `O(n · 2^n)` by sweeping one bit at a time."*
- Immediately flag the gotchas: **bit loop outer**, **subset vs superset direction**, **zeta vs Möbius sign**, and **`2^n` memory**.
- If asked for OR/AND/XOR convolution, reach for the **transform → pointwise multiply → inverse** recipe (subset/superset zeta for OR/AND, Walsh-Hadamard for XOR).
- Mention the **disjoint subset-sum convolution** (`O(n^2 · 2^n)`) when the problem says "partition into disjoint pieces" — plain OR-convolution over-counts.
- Always offer to verify against the `O(3^n)` brute-force oracle and the `Möbius(zeta(A)) == A` round-trip on small inputs.

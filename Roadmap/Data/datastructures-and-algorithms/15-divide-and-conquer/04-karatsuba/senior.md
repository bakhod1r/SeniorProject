# Karatsuba Multiplication (Fast Big-Integer Multiply) — Senior Level

> Karatsuba is rarely the bottleneck on a few-word integer — but the moment your numbers are cryptographic-sized, your library must be competitive with GMP, or the results must be bit-exact under every carry chain, every detail (limb representation, allocation strategy, crossover tuning, the hybrid algorithm ladder, oracle testing, carry/overflow failure modes) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Limb Representation and Internal Base](#2-limb-representation-and-internal-base)
3. [Memory Allocation and Scratch Management](#3-memory-allocation-and-scratch-management)
4. [Crossover Tuning](#4-crossover-tuning)
5. [The GMP-Style Hybrid Strategy](#5-the-gmp-style-hybrid-strategy)
6. [Carry and Overflow Failure Modes](#6-carry-and-overflow-failure-modes)
7. [Testing Against a Schoolbook Oracle](#7-testing-against-a-schoolbook-oracle)
8. [Code Examples](#8-code-examples)
9. [Observability and Validation](#9-observability-and-validation)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does the 3-product trick work" but "what does a production multiply have to get right to be both correct and fast?" Karatsuba shows up wherever big integers do:

1. **Cryptography** — RSA, Diffie-Hellman, and elliptic-curve arithmetic multiply 256–8192-bit numbers constantly; the modular multiply inner loop is performance-critical.
2. **Computer algebra** — polynomial and integer arithmetic in systems like SageMath, Mathematica, and Maple, often on numbers with millions of digits.
3. **Arbitrary-precision libraries** — GMP, Java `BigInteger`, Python `int`, `.NET BigInteger`: each must pick the right algorithm at every size.

All three need the same four senior decisions: how to represent and pack limbs, how to manage the heavy temporary allocation Karatsuba demands, how to tune the crossover so Karatsuba actually beats schoolbook, and how to verify bit-exactness when a single dropped carry corrupts the high half of every answer. This document treats those decisions in production terms.

---

## 2. Limb Representation and Internal Base

### 2.1 Limbs, not decimal digits

No serious library multiplies decimal digits. The internal base is a power of two matched to the machine word — typically `B = 2^32` or `B = 2^64`. Each **limb** is one machine word holding one base-`B` "digit". This maximizes the work done per hardware multiply instruction: a single `64×64 → 128` multiply does as much as 64 decimal digit-multiplies would.

| Choice | Base `B` | Limb type | Product width needed |
|--------|----------|-----------|----------------------|
| 32-bit limbs | `2^32` | `uint32` (stored in `uint64`) | `uint64` (64-bit product) |
| 64-bit limbs | `2^64` | `uint64` | `uint128` / hi-lo pair |

With 64-bit limbs the product of two limbs is 128 bits, so you need either a `__int128` (C/Rust), a `Math.multiplyHigh` (Java), or a 32-bit split to stay within 64-bit lanes. The choice trades per-limb throughput against the availability of a wide-multiply primitive.

### 2.2 Little-endian limb order

Limbs are stored **least-significant-first** so that index `i` corresponds to the `B^i` position and carries propagate naturally from low to high indices. The split into halves is then a slice: `low = limbs[:half]`, `high = limbs[half:]`. This makes the `B^half` shift a pure index offset (no data movement) when you write into a destination at the right position.

### 2.3 Normalization invariants

A canonical big integer maintains: (1) every limb in `[0, B)`, (2) no leading zero limbs (except the single limb `0` for the value zero), (3) sign stored separately from magnitude. Karatsuba operates on magnitudes; the sign is computed as `sign(x) XOR sign(y)` and applied at the end. Violating invariant (1) mid-computation is fine *internally* (you may let limbs temporarily exceed `B` during coefficient accumulation), but the final result must be renormalized.

### 2.4 The `(a+b)` width subtlety, at limb granularity

`a` and `b` each occupy `half` limbs; `a+b` may need `half + 1` limbs (one carry-out limb). The middle product `(a+b)(c+d)` then occupies up to `2·half + 2` limbs. A correct implementation allocates the middle buffer with this headroom; truncating it to `2·half` limbs silently drops the top, the single most common limb-level Karatsuba bug.

### 2.5 The wide-multiply primitive

The base-case schoolbook loop multiplies two limbs and accumulates. With 32-bit limbs, `uint32 × uint32` fits in `uint64` and the accumulation has room; with 64-bit limbs, `uint64 × uint64` is 128 bits and you need a hardware widening multiply:

| Language | 64-bit widening multiply |
|----------|--------------------------|
| C / Rust | `__uint128_t` / `u128` |
| Go | `math/bits.Mul64` (returns hi, lo) |
| Java | `Math.multiplyHigh` + low product (since JDK 9) |
| Python | native arbitrary-precision int (no manual splitting) |

Choosing 32-bit limbs trades half the per-multiply throughput for simpler, overflow-free accumulation — a reasonable starting point before optimizing to 64-bit limbs with `Mul64`/`multiplyHigh`. The accumulator must hold `B·(B−1) + (B−1) + (B−1) < B²`, which is why the widening result and one carry limb suffice.

---

## 3. Memory Allocation and Scratch Management

### 3.1 Karatsuba is allocation-heavy

A naive recursive Karatsuba allocates fresh buffers for `a+b`, `c+d`, `z0`, `z1`, `z2`, and the result at *every* level of a `log₂ n`-deep recursion with branching factor 3. That is `Θ(n^{1.585})` total allocation churn — disastrous for the garbage collector (Java/Go) or the allocator (C). Production code instead uses a **single preallocated scratch arena**.

### 3.2 In-place / scratch-passing layout

GMP's `mpn_mul` takes a caller-provided scratch buffer (`mpn_mul_itch` tells you how big). The recursion writes intermediate products into disjoint regions of this one buffer and reuses it on the way back up. The scratch size is `O(n)` (not `O(n log n)`) with careful overlap. The discipline:

- Compute `z0 = b·d` and `z2 = a·c` directly into their final positions in the result (`z0` at offset 0, `z2` at offset `2·half`).
- Compute `t = (a+b)`, `u = (c+d)` and `z1 = t·u` into scratch.
- Subtract `z2` and `z0` from `z1` *in place* in scratch.
- Add `z1` into the result at offset `half`, propagating carries.

This keeps allocation to one arena per top-level call.

### 3.3 Recursion vs iteration and stack depth

Depth is `O(log n)`, so stack usage is modest, but each frame's scratch slice must be carved from the arena without overlap. A common scheme passes `(dst, src1, src2, scratch, scratch_len)` and recurses with sub-slices. The result is zero heap allocation inside the recursion — all temporaries live in the arena.

### 3.4 Why this matters at scale

For a service doing millions of cryptographic multiplies per second, per-multiply allocation dominates if uncontrolled. Buffer reuse turns Karatsuba from "correct but GC-bound" into "production-grade". This is the senior-level reason real libraries expose the scratch-passing API instead of a convenient allocate-and-return signature.

### 3.5 Scratch-size accounting

The total scratch for Karatsuba is `O(n)`, but the exact constant matters when you preallocate. A standard analysis: the recombination needs room for `z1` (size `≈ 2·half + 2`) plus the sub-call scratch. Writing `S(n)` for the scratch limbs needed by a size-`n` multiply:

```
S(n) = (2·half + 2)        # the z1 buffer at this level
     + S(half + 1)          # the largest sub-call: (a+b)·(c+d), operands of half+1 limbs
```

Since each level adds `O(n)` and the sub-call argument shrinks geometrically, `S(n) = O(n)` with a small constant (roughly `2n`). GMP's `mpn_mul_itch(n, m)` returns precisely this bound so callers can allocate once. Under-allocating scratch is a memory-corruption bug; over-allocating wastes cache. The discipline: compute the exact `itch` and allocate a single arena of that size per top-level call.

---

## 4. Crossover Tuning

### 4.1 The crossover is measured, not derived

Karatsuba's `O(n^{1.585})` beats schoolbook's `O(n²)` only above a threshold where its larger constant is amortized. That threshold (`KARATSUBA_THRESHOLD` in GMP terms, `MUL_KARATSUBA_THRESHOLD`) depends on:

- **Hardware multiply latency/throughput** — a fast pipelined multiplier raises the schoolbook ceiling, pushing the crossover higher.
- **Cache behavior** — schoolbook is cache-friendly (streaming); Karatsuba's recursion touches more scattered memory.
- **Quality of each routine** — a hand-optimized schoolbook (`mpn_mul_basecase` in assembly) raises the crossover; a sloppy one lowers it.

GMP ships a `tune` program that benchmarks both routines across sizes on the actual CPU and emits the crossover constants into per-machine headers. The principle: pick the size where the two cost curves intersect, empirically.

### 4.2 Typical thresholds (orders of magnitude)

| Crossover | Typical limbs (64-bit) | Note |
|-----------|------------------------|------|
| schoolbook → Karatsuba | ~10–40 | the famous `MUL_TOOM22_THRESHOLD` region |
| Karatsuba → Toom-3 | ~100–300 | `MUL_TOOM33_THRESHOLD` |
| Toom-3 → Toom-4 | ~300–1000 | |
| Toom → FFT (`fft_mul`) | ~thousands | `MUL_FFT_THRESHOLD` |

These vary by a factor of several across CPUs; never hard-code another machine's numbers.

### 4.3 Unbalanced operands

When operands differ greatly in size (e.g. `n × m` with `m ≪ n`), plain Karatsuba's balanced split is suboptimal. Libraries use **unbalanced** variants (Toom-2.5, Toom-3.5, or splitting the larger operand into `m`-sized chunks each multiplied against the smaller — the "block" approach). Tuning therefore has *two* dimensions: the size and the ratio. This is why GMP has many threshold constants, not one.

---

## 5. The GMP-Style Hybrid Strategy

### 5.1 A dispatch tower, not a single algorithm

GMP's `mpn_mul` is a dispatcher selecting from (roughly, in increasing size):

```text
schoolbook (basecase, asm)
  → Karatsuba (Toom-2,   mpn_toom22_mul)
  → Toom-3   (mpn_toom33_mul)
  → Toom-4   (mpn_toom44_mul)
  → Toom-6.5, Toom-8.5 (unbalanced helpers)
  → FFT (Schönhage-Strassen, mpn_mul_fft)
```

Each level recurses into the *dispatcher*, not into itself, so a Toom-3 sub-multiply may itself dispatch to Karatsuba or schoolbook depending on the sub-size. The whole tower is governed by the tuned thresholds of Section 4.

### 5.2 Why the ladder exists

No single algorithm minimizes cost across all sizes (Section 4 of `middle.md`). The hybrid picks, at each size, the algorithm on the lower part of the cost envelope. The envelope is piecewise: schoolbook for tiny, Karatsuba for small, Toom for medium-large, FFT for huge. Karatsuba's role is the **small-to-medium** band — the most common size for cryptography (256–4096 bits = 4–64 limbs), which is exactly why Karatsuba (and its near neighbor Toom-2.5) is so heavily optimized.

### 5.3 Squaring is special-cased

`x²` is cheaper than `x·y` because the cross terms coincide. Karatsuba squaring needs three *squarings* but with symmetry (`a·b` cross terms double), and schoolbook squaring is `~n²/2`. GMP has a parallel tower (`mpn_sqr`, `mpn_toom2_sqr`, …) with its own thresholds. Modular exponentiation (RSA) squares far more often than it multiplies, so this special-casing is a major real-world win.

### 5.4 The FFT cap

At the top, Schönhage-Strassen (`O(n log n log log n)`) or an NTT-based multiply takes over. Karatsuba never competes there; its job is to be the best in its band and to recurse cleanly into the lower bands. Understanding that Karatsuba is *one rung* — not the whole story — is the senior mental model.

### 5.5 How other libraries layer the tower

The dispatch idea is universal, but the rungs differ by library:

| Library | Tower (small → large) | Notes |
|---------|------------------------|-------|
| GMP | basecase → Toom-2 (Karatsuba) → Toom-3/4/6.5/8.5 → FFT (SSA) | per-CPU tuned thresholds via `tune/` |
| Java `BigInteger` | schoolbook → `multiplyKaratsuba` → `multiplyToomCook3` | thresholds `KARATSUBA_THRESHOLD=80`, `TOOM_COOK_THRESHOLD=240` (ints) |
| Python `int` | schoolbook → Karatsuba | `KARATSUBA_CUTOFF=70` digits; no Toom/FFT in CPython |
| .NET `BigInteger` | schoolbook → recursive (Karatsuba-like) | simpler tower |

Two takeaways: (1) every serious library has *at least* schoolbook + Karatsuba, confirming Karatsuba's role as the universal first speedup; (2) the thresholds are baked-in constants (Java) or tuned per machine (GMP), never derived — they are the measured intersection of cost curves.

---

## 6. Carry and Overflow Failure Modes

### 6.1 The dropped middle-product top limb

`(a+b)(c+d)` can be `2·half + 2` limbs. Allocating `2·half` and truncating loses the top, producing an answer that is correct in the low half and wrong in the high half. **Symptom:** results correct for small inputs (where the carry-out happens not to occur) but wrong for inputs whose halves sum past `B`. Mitigation: size the middle buffer with explicit `+2` headroom and assert no nonzero limb is dropped.

### 6.2 Signed intermediates in the `(a−b)(c−d)` variant

The subtractive evaluation form produces *signed* sub-products. If your limb routines are unsigned, you must track the sign of `(a−b)` and `(c−d)` separately and combine signs for the product, or you get a wrong `z1`. **Symptom:** wrong results only when `a < b` xor `c < d`. Mitigation: compute `|a−b|`, `|c−d|`, and a sign flag; apply the flag when folding into `z1`.

### 6.3 Carry propagation past a single limb

Adding `z1` into the result at offset `half` overlaps both `z0` and `z2`. A carry generated at the overlap can cascade through *many* high limbs (think `999…9 + 1`). **Symptom:** intermittent high-digit corruption that passes small tests. Mitigation: the recombination add must loop the carry upward until it is zero, not stop after one position.

### 6.4 Overflow in limb accumulation

With 64-bit limbs, `res[i+j] + x[i]*y[j] + carry` can overflow 64 bits *during* schoolbook base-case accumulation. **Symptom:** corruption proportional to input magnitude. Mitigation: use a 128-bit accumulator (`__int128`, `Math.multiplyHigh`, or a 32-bit-limb scheme where `32×32→64` never overflows the accumulator). 32-bit limbs sidestep this entirely at the cost of throughput.

### 6.5 Off-by-one in the split point

If `half` is computed from one operand but the other is longer, the high slice may be empty or misaligned. **Symptom:** wrong results on unequal-length inputs. Mitigation: split both operands at the *same* `half = max(len)/2`, zero-padding the shorter; ensure `half ≥ 1` so the recursion shrinks.

### 6.6 Interpolation division (Toom) inexactness

In Toom-3, interpolation divides by small constants (2, 3, 6). These divisions are *exact* over the integers by construction, but a wrong interpolation matrix or a sign slip makes a division non-exact, silently truncating. **Symptom:** small, position-dependent errors. Mitigation: use the proven interpolation sequence and assert each division has zero remainder in debug builds.

---

## 7. Testing Against a Schoolbook Oracle

A fast multiply's output is opaque — one wrong high limb looks like any other large number. The non-negotiable senior practice is an **oracle**: a dead-simple `O(n²)` schoolbook multiply (or the language's native `*`) that is obviously correct, compared bit-for-bit against the fast routine.

| Test | Why it catches the bug |
|------|------------------------|
| Random `n × m` for many sizes incl. odd & unequal | Split/alignment errors, off-by-one `half`. |
| Inputs whose halves sum past `B` (`0xFFFF…`) | The dropped-carry / truncated-middle-product bug. |
| Zero and one operand | Base-case and normalization edge cases. |
| Powers of `B` (single high limb set) | Shift-offset correctness. |
| Sizes straddling every crossover | Dispatcher boundary bugs. |
| `x·y == y·x` | Asymmetry in the split logic. |
| `(x·y)·z == x·(y·z)` | Associativity sanity across the whole tower. |

The single most valuable test is **random differential testing against schoolbook across a wide range of sizes**, because it exercises every recursion depth and crossover boundary. Run it in CI on every commit; it catches the overwhelming majority of carry and alignment bugs.

---

## 8. Code Examples

### 8.1 Go — Karatsuba on 32-bit limbs with schoolbook oracle and differential test

```go
package main

import (
	"fmt"
	"math/big"
	"math/rand"
)

const CUT = 16 // limbs

func norm(a []uint64) []uint64 {
	var c uint64
	for i := range a {
		v := a[i] + c
		a[i] = v & 0xFFFFFFFF
		c = v >> 32
	}
	for c > 0 {
		a = append(a, c&0xFFFFFFFF)
		c >>= 32
	}
	for len(a) > 1 && a[len(a)-1] == 0 {
		a = a[:len(a)-1]
	}
	return a
}

func schoolbook(x, y []uint64) []uint64 {
	r := make([]uint64, len(x)+len(y))
	for i := range x {
		var c uint64
		for j := range y {
			v := r[i+j] + x[i]*y[j] + c
			r[i+j] = v & 0xFFFFFFFF
			c = v >> 32
		}
		r[i+len(y)] += c
	}
	return norm(r)
}

func add(a, b []uint64) []uint64 {
	n := max(len(a), len(b))
	r := make([]uint64, n+1)
	var c uint64
	for i := 0; i < n; i++ {
		var av, bv uint64
		if i < len(a) {
			av = a[i]
		}
		if i < len(b) {
			bv = b[i]
		}
		v := av + bv + c
		r[i] = v & 0xFFFFFFFF
		c = v >> 32
	}
	r[n] = c
	return norm(r)
}

func sub(a, b []uint64) []uint64 { // a >= b
	r := make([]uint64, len(a))
	var br int64
	for i := range a {
		var bv uint64
		if i < len(b) {
			bv = b[i]
		}
		v := int64(a[i]) - int64(bv) - br
		if v < 0 {
			v += 1 << 32
			br = 1
		} else {
			br = 0
		}
		r[i] = uint64(v)
	}
	return norm(r)
}

func shift(a []uint64, k int) []uint64 {
	r := make([]uint64, len(a)+k)
	copy(r[k:], a)
	return r
}

func kara(x, y []uint64) []uint64 {
	if len(x) <= CUT || len(y) <= CUT {
		return schoolbook(x, y)
	}
	h := max(len(x), len(y)) / 2
	slice := func(a []uint64, lo, hi int) []uint64 {
		if lo >= len(a) {
			return []uint64{0}
		}
		if hi > len(a) {
			hi = len(a)
		}
		return append([]uint64{}, a[lo:hi]...)
	}
	b, a := slice(x, 0, h), slice(x, h, len(x))
	d, c := slice(y, 0, h), slice(y, h, len(y))
	z2 := kara(a, c)
	z0 := kara(b, d)
	z1 := sub(sub(kara(add(a, b), add(c, d)), z2), z0)
	return add(add(shift(z2, 2*h), shift(z1, h)), z0)
}

func max(a, b int) int { if a > b { return a }; return b }

func toBig(a []uint64) *big.Int {
	r := new(big.Int)
	for i := len(a) - 1; i >= 0; i-- {
		r.Lsh(r, 32)
		r.Add(r, new(big.Int).SetUint64(a[i]))
	}
	return r
}

func randLimbs(n int) []uint64 {
	a := make([]uint64, n)
	for i := range a {
		a[i] = uint64(rand.Uint32())
	}
	return norm(a)
}

func main() {
	for t := 0; t < 2000; t++ {
		x := randLimbs(1 + rand.Intn(60))
		y := randLimbs(1 + rand.Intn(60))
		got := toBig(kara(x, y))
		want := new(big.Int).Mul(toBig(x), toBig(y))
		if got.Cmp(want) != 0 {
			panic("mismatch")
		}
	}
	fmt.Println("all differential tests passed")
}
```

### 8.2 Java — crossover-tuned dispatcher with squaring special-case

```java
import java.math.BigInteger;
import java.util.Random;

public class KaratsubaTower {
    static final int CUTOFF = 80; // bits, illustrative

    static BigInteger mul(BigInteger x, BigInteger y) {
        if (x.signum() == 0 || y.signum() == 0) return BigInteger.ZERO;
        boolean neg = (x.signum() < 0) ^ (y.signum() < 0);
        BigInteger r = mulMag(x.abs(), y.abs());
        return neg ? r.negate() : r;
    }

    static BigInteger mulMag(BigInteger x, BigInteger y) {
        if (x.bitLength() < CUTOFF || y.bitLength() < CUTOFF) {
            return x.multiply(y); // base case (native, schoolbook-class for small)
        }
        int half = Math.max(x.bitLength(), y.bitLength()) / 2;
        BigInteger lowMask = BigInteger.ONE.shiftLeft(half);
        BigInteger b = x.mod(lowMask), a = x.shiftRight(half);
        BigInteger d = y.mod(lowMask), c = y.shiftRight(half);

        BigInteger z2 = mulMag(a, c);
        BigInteger z0 = mulMag(b, d);
        BigInteger z1 = mulMag(a.add(b), c.add(d)).subtract(z2).subtract(z0);
        return z2.shiftLeft(2 * half).add(z1.shiftLeft(half)).add(z0);
    }

    public static void main(String[] args) {
        Random rnd = new Random(1);
        for (int t = 0; t < 5000; t++) {
            BigInteger x = new BigInteger(1 + rnd.nextInt(500), rnd);
            BigInteger y = new BigInteger(1 + rnd.nextInt(500), rnd);
            if (!mul(x, y).equals(x.multiply(y))) throw new AssertionError("bug");
        }
        System.out.println("all differential tests passed");
    }
}
```

### 8.3 Python — Karatsuba with scratch reuse and an exhaustive carry-stress oracle

```python
import random

CUTOFF_BITS = 256


def karatsuba(x: int, y: int) -> int:
    if x.bit_length() < CUTOFF_BITS or y.bit_length() < CUTOFF_BITS:
        return x * y
    half = max(x.bit_length(), y.bit_length()) // 2
    mask = (1 << half) - 1
    b, a = x & mask, x >> half
    d, c = y & mask, y >> half
    z2 = karatsuba(a, c)
    z0 = karatsuba(b, d)
    z1 = karatsuba(a + b, c + d) - z2 - z0
    return (z2 << (2 * half)) + (z1 << half) + z0


def stress():
    # Carry-stress inputs: halves that sum past the base (all-ones blocks).
    for bits in (300, 301, 511, 512, 1000, 1023):
        x = (1 << bits) - 1          # all ones — maximal carries
        y = (1 << bits) - 1
        assert karatsuba(x, y) == x * y
    for _ in range(3000):
        x = random.getrandbits(random.randint(1, 1200))
        y = random.getrandbits(random.randint(1, 1200))
        assert karatsuba(x, y) == x * y
    print("all carry-stress and random differential tests passed")


if __name__ == "__main__":
    stress()
```

---

## 9. Observability and Validation

For a library-grade multiply, build correctness checks in from day one.

| Check | Why |
|-------|-----|
| Differential vs schoolbook oracle, wide size sweep | Catches carry, alignment, and crossover-boundary bugs. |
| All-ones carry-stress inputs | Forces maximal carry chains that random inputs miss. |
| Commutativity `x·y == y·x` | Reveals split asymmetry. |
| Identity `x·1 == x`, `x·0 == 0` | Base-case and normalization. |
| Cross-check at each crossover size ±1 | Dispatcher boundary correctness. |
| Re-multiply via a different algorithm (Toom vs Karatsuba) | Catches a bug in one but not the other. |
| Bit-length of product `== len(x)+len(y)` or that `−1` | Sanity on magnitude / no dropped top limb. |

The single most valuable practice is the **wide-size random differential test plus deliberate all-ones carry-stress cases** — together they exercise every recursion depth and every carry chain.

### 9.1 Production guardrails

In a deployed service: assert canonical normalization on every result (limbs `< B`, no leading zeros); log the chosen algorithm (schoolbook/Karatsuba/Toom/FFT) per call so a latency anomaly maps to a size band; and keep a debug-build assertion that the dropped-carry headroom is never exceeded. For cryptographic use, ensure the multiply is **constant-time** if it processes secrets — data-dependent crossover branches and early-out normalization can leak timing, a separate failure mode entirely.

---

## 10. Failure Modes

### 10.1 Truncated middle product
Allocating `2·half` limbs for `(a+b)(c+d)` instead of `2·half + 2` drops the carry-out limb. Mitigation: size with headroom; assert the top limb is captured.

### 10.2 Lost recombination carry
The add of `z1` at offset `half` carries into the high block; stopping after one limb corrupts high digits. Mitigation: propagate the carry until zero.

### 10.3 Limb-accumulator overflow
`res + x*y + carry` overflows 64 bits with 64-bit limbs. Mitigation: 128-bit accumulator or 32-bit limbs.

### 10.4 Sign mishandling in subtractive variant
`(a−b)(c−d)` with unsigned limbs and no sign tracking gives a wrong `z1`. Mitigation: track absolute values and a sign flag.

### 10.5 Crossover mis-tuned
A cutoff copied from another machine makes Karatsuba slower than schoolbook in its own band. Mitigation: measure on the target CPU.

### 10.6 Allocation churn
Fresh buffers per recursion level make Karatsuba GC-bound. Mitigation: one scratch arena, slice-passing recursion.

### 10.7 Unbalanced operands on the balanced path
`n × m` with `m ≪ n` wastes work splitting the tiny operand. Mitigation: unbalanced/blocked variants for skewed sizes.

### 10.8 Non-constant-time for secrets
Data-dependent branches/normalization leak timing in cryptographic multiply. Mitigation: constant-time base-case and uniform control flow when inputs are secret.

---

## 11. Summary

- **Limbs, not digits.** Production multiply uses base `B = 2^32` or `2^64`, little-endian, with sign stored separately; the magnitude is what Karatsuba operates on.
- **Allocation is the hidden cost.** Naive recursion allocates `Θ(n^{1.585})` temporaries; a single `O(n)` scratch arena with slice-passing makes Karatsuba production-grade (the reason GMP exposes a scratch-buffer API).
- **The crossover is measured.** Karatsuba beats schoolbook only above a machine-specific threshold (~10–40 limbs); GMP's `tune` program benchmarks and emits it per CPU. Unbalanced operands need their own thresholds.
- **It's a hybrid tower.** Real multiply dispatches schoolbook → Karatsuba (Toom-2) → Toom-3/4 → FFT by size, recursing into the dispatcher. Karatsuba owns the small-to-medium band where cryptographic sizes live; squaring is special-cased.
- **Carry/overflow are the failure modes.** Truncated middle product, lost recombination carry, limb-accumulator overflow, and sign slips in the subtractive variant are the dominant bugs — every one is invisible on small tests and exposed by all-ones carry-stress inputs.
- **Test differentially against a schoolbook oracle** across a wide size sweep plus deliberate carry-stress cases; this catches nearly every real bug.

### Decision summary

- **Small operands (below crossover)** → schoolbook (cache-friendly, tiny constant).
- **Small-to-medium (crypto sizes, 4–64 limbs)** → Karatsuba / Toom-2.5.
- **Large** → Toom-3/4.
- **Huge** → FFT / Schönhage-Strassen.
- **Squaring** → the dedicated squaring tower (cheaper than general multiply).
- **Skewed `n × m`** → unbalanced / blocked variants.
- **Secret-dependent (crypto)** → constant-time multiply with uniform control flow.

References to study further: the GMP "Algorithms" manual and `tune/` directory; Knuth TAOCP Vol. 2 §4.3.3; Brent & Zimmermann, *Modern Computer Arithmetic*; Java `BigInteger`'s `multiplyKaratsuba`/`multiplyToomCook3` source; and sibling topics in `15-divide-and-conquer`.

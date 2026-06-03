# Sum over Subsets DP (SOS DP) — Senior Level

> SOS DP is rarely the bottleneck on paper — its cost is a clean `O(n · 2^n)`. But the moment `n` pushes memory toward gigabytes, the counts overflow, the modulus and inverse signs must be exactly right, or the transform runs inside a hot service path, every detail (memory layout, overflow/modulus discipline, in-place correctness, direction selection, testing against brute force) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Memory: the `2^n` Wall](#2-memory-the-2n-wall)
3. [Overflow and Modular Arithmetic](#3-overflow-and-modular-arithmetic)
4. [When SOS Applies — and When It Does Not](#4-when-sos-applies--and-when-it-does-not)
5. [In-Place Correctness and Direction Discipline](#5-in-place-correctness-and-direction-discipline)
6. [Convolutions in Production](#6-convolutions-in-production)
7. [Performance Engineering of the Sweep](#7-performance-engineering-of-the-sweep)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does the bit sweep compute submask sums" but "what am I modeling, and what breaks when I scale it?". SOS DP shows up in three production guises that share one engine:

1. **Aggregation over containment** — "for every capability-mask, total the weight of all sub-capability sets", with `n` up to ~20–22. The answer is exact mod a prime, or fits in 64 bits with care.
2. **Set convolutions** — OR/AND/XOR convolutions powering counting DPs (graph coloring, Hamiltonicity via inclusion-exclusion, covering problems), where the transform runs many times.
3. **Inclusion-exclusion at scale** — replacing an `O(3^n)` signed sum with the `O(n · 2^n)` Möbius transform inside a larger algorithm.

All three reduce to: *lay out an array of `2^n` cells, sweep each of the `n` bits relaxing one dimension, read or further-process the result.* The senior decisions are: how to fit `2^n` in memory, how to keep arithmetic exact and overflow-free, how to verify when `n` is too large to brute-force, and whether SOS is even the right transform (subset vs superset vs XOR vs subset-sum convolution).

This document treats those decisions in production terms.

### 1.1 The three questions that decide everything

Before reaching for SOS in a production design, answer three questions, in order:

1. **Is the index space genuinely `2^n` for small `n`?** If the natural index is "a subset of a small universe" and `n ≤ ~22`, proceed. If `n` is large or the index is not a subset, stop — SOS is the wrong abstraction (Section 4).
2. **Is the aggregation over containment (subset or superset)?** SOS only accelerates "sum over everything contained in / containing `mask`". Anything else needs a different transform.
3. **Exact or modular?** Decide the arithmetic regime up front: modular (reduce per op), 64-bit exact (prove the bound), or CRT-exact (run per prime). Retrofitting a modulus after an overflow bug is far more painful than choosing it first.

Getting these three right at design time prevents the overwhelming majority of SOS incidents; the rest of this document is the detail behind each.

---

## 2. Memory: the `2^n` Wall

### 2.1 The hard limit

SOS needs an array of `2^n` cells. With `int64` (8 bytes):

| `n` | cells `2^n` | bytes per array |
|-----|-------------|-----------------|
| 16 | 65 536 | 512 KB |
| 18 | 262 144 | 2 MB |
| 20 | 1 048 576 | 8 MB |
| 22 | 4 194 304 | 32 MB |
| 24 | 16 777 216 | 128 MB |
| 26 | 67 108 864 | 512 MB |
| 28 | 268 435 456 | 2 GB |

Past `n ≈ 24` a single array dominates a typical heap; a convolution needs *several* such arrays simultaneously (two inputs transformed, one product), tripling the footprint. The `2^n` wall, not the `n` factor, is what kills SOS — the algorithm is "fast" but the data is enormous.

### 2.2 Shrinking the footprint

- **Narrower element type.** If counts fit in `uint32` or the modulus is < `2^31`, use 32-bit cells to halve memory. Watch the product width in convolutions (promote to 64-bit only for the multiply).
- **In-place transforms.** The zeta, Möbius, and Yates butterflies all run in place — never allocate a second array for the transform itself. Allocate extra arrays only for distinct inputs of a convolution.
- **Ping-pong, not per-call allocation.** In a service that transforms repeatedly, reuse preallocated buffers; do not allocate `2^n` cells per request (GC churn and latency spikes).
- **Stream/partition by a prefix.** If only some masks are needed, you cannot easily skip work (the transform couples all masks along each axis), but you can sometimes reduce `n` by fixing high bits — at the cost of running the transform per fixed prefix.

### 2.3 Reducing `n` itself

The single biggest lever is **modeling `n` down**. Merge indistinguishable items, drop items that never appear, exploit symmetry. Each bit removed *halves* memory and shaves an `n·2^n → (n-1)·2^{n-1}` factor (roughly 4× total). If your "items" have a sparse co-occurrence structure, consider whether the full hypercube is even necessary.

### 2.4 Worked memory-budget decision

Suppose a service must OR-convolve two functions over `n = 23` features under a prime modulus. Each `int32` array is `2^23 · 4 = 32 MB`. The pipeline needs: two transformed inputs (64 MB) plus the product written in place (reuse one input's buffer). With buffer reuse you can hold it in ~64 MB; without reuse (naively allocating per step) you balloon to 128+ MB and trigger GC. The decision: preallocate exactly two `2^23` `int32` buffers at startup, transform `A` into buffer 1, `B` into buffer 2, multiply buffer 1 ← buffer1·buffer2, Möbius buffer 1 in place. One more bit (`n = 24`) doubles every figure — 128 MB live — which is the practical ceiling for a shared service. This kind of explicit budgeting, done *before* writing code, is the senior habit that prevents OOM incidents.

### 2.5 The convolution multiplies the live-array count

A subtle scaling trap: a *single* zeta is one in-place array, but a convolution needs the two distinct transformed inputs simultaneously (you cannot transform `B` into `A`'s buffer until `A`'s transform is consumed by the multiply). So convolution memory is `≥ 2 × 2^n` elements, and the disjoint subset-sum convolution (popcount-ranked) needs `(n+1)` rank slices per operand — `O(n · 2^n)` elements, an extra `n` factor in *space* as well as time. At `n = 20` that is `21 · 8 MB ≈ 168 MB` per operand for `int64` ranks. Plan for the rank dimension explicitly.

---

## 3. Overflow and Modular Arithmetic

### 3.1 Growth of subset sums

A submask sum adds up to `2^popcount(mask)` terms. With large per-mask values, totals overflow 32-bit quickly and can overflow 64-bit if values are large and `n` is big. Two strategies:

- **Modular:** reduce after every `+=` (zeta) and after every `-=` (Möbius). Always safe.
- **64-bit exact:** if the true total is needed and provably fits in `int64`, skip the modulus — but prove the bound (`max value × 2^n < 2^63`).

### 3.1b A concrete overflow trap

With `int32` cells and per-mask values up to `10^6`, a full-mask sum over `2^{20}` submasks reaches `~10^{12}` — far past `2^{31} ≈ 2.1·10^9`. Without a modulus or a 64-bit widening, the `int32` accumulation silently wraps after only ~2000 contributing submasks. The wrap produces a plausible mid-range integer, not an obvious garbage value, so it slips through casual inspection. The fix is to decide *up front*: either work mod `p` (reduce every `+=`), or prove the exact total fits in `int64` (`max_value × 2^n < 2^{63}`, here `10^6 × 2^{20} ≈ 10^{12} < 9.2·10^{18}` — safe in `int64`, unsafe in `int32`). Never "hope" 32 bits is enough.

### 3.2 The Möbius subtraction and negative residues

The Möbius inverse subtracts. Under a modulus, `G[mask] -= G[mask ^ bit]` can go negative. In Go and Java `%` can return a negative result, so a residue stored as negative then multiplied later corrupts the answer. Normalize:

```
G[mask] = ((G[mask] - G[mask ^ bit]) % p + p) % p
```

Python's `%` already returns non-negative for positive `p`, so the explicit `+ p` is unnecessary there — but be consistent across languages if outputs must match.

### 3.2b Deferred reduction with a wider accumulator

Reducing after *every* `+=` costs one division per inner-loop step. A faster pattern defers the reduction: accumulate several additions in a wider type before reducing. In the zeta sweep, each cell receives exactly one addition per pass, so there is no within-pass accumulation to defer — the per-op reduction is already minimal. But in a *convolution multiply* (`c[m] = fa[m] * fb[m] % p`), the single product of two `< p` residues fits in 64 bits for `p < 2^{31}`, so one reduction after the multiply suffices; do not reduce the operands again. The lesson: count the additions between reductions and prove the intermediate fits the accumulator width. For SOS specifically, the structure (one add per cell per pass) makes the naive "reduce each op" already optimal — a rare case where the simple code is also the fast code.

### 3.3 Choosing the modulus

| Modulus | Use |
|---------|-----|
| `10^9 + 7`, `998244353` | The problem dictates it. `998244353` is NTT-friendly if a polynomial step follows. |
| Multiple coprime primes + CRT | When the exact (non-modular) count exceeds one prime's range. Each prime is an independent SOS run. |
| Power of two (`2^64` implicit) | When the answer is wanted mod `2^64` — natural `uint64` wraparound, no explicit reduction; the Möbius still inverts because `-1` is well-defined mod `2^64`. |

### 3.4 Convolution overflow budget

In OR/AND-convolution, the pointwise product `Fa[mask] · Fb[mask]` of two reduced residues `< p` is `< p^2`. For `p ≈ 10^9`, `p^2 ≈ 10^{18} < 2^{63}`, so a single 64-bit multiply-then-reduce is safe. The transforms themselves only add/subtract, so reducing once per arithmetic op suffices.

---

## 4. When SOS Applies — and When It Does Not

SOS is the right tool only under a specific shape. The senior skill is recognizing it — and recognizing impostors.

### 4.1 The applicability checklist

1. **Index space is `2^n` masks.** The data is naturally indexed by subsets of a small universe (`n ≤ ~22`). If the index is not a subset lattice, SOS does not apply.
2. **The aggregate is over subset or superset containment.** "Sum over all `sub ⊆ mask`" (subset zeta) or "all `sup ⊇ mask`" (superset zeta). Aggregates over an *arbitrary* relation need a different transform.
3. **You need many/all masks.** If you need one mask's submask sum, the `O(2^popcount)` per-mask loop is simpler and uses no extra structure.
4. **The combining operation is associative addition (or a semiring `⊕`).** Sum, count, XOR, min, max can all ride the zeta structure (min/max give "best over submasks", which is *not* invertible).

### 4.1b A worked applicability judgment

"Given `m` users each with a feature mask over `n = 19` features, for every possible feature set report how many users have *exactly* it, *at most* it, and *at least* it." Walk the checklist: index space is `2^19` (519 K cells, ~2 MB `int32` — fine); "at most it" is subset-zeta, "at least it" is superset-zeta, "exactly it" is the raw count — all containment aggregates; counts fit in `int32` (`m` users, at most `m` per cell). Verdict: textbook SOS, three arrays. Contrast: "for every *pair* of feature sets report Jaccard similarity" — the index is now *pairs* of masks (`4^n`), not a subset lattice, so SOS does not apply; that needs a different structure entirely.

### 4.2 The impostors

| Looks like SOS but isn't | Why | Right tool |
|--------------------------|-----|------------|
| Aggregate over *all* masks (not containment) | No lattice structure to exploit | a plain loop, or a different DP |
| `n` large (≥ ~24) | `2^n` memory blows up | meet-in-the-middle, prune, or rethink |
| Need min/max over submasks and then *invert* | min/max have no inverse (not a ring) | zeta is fine; Möbius is impossible |
| Subset-sum convolution (disjoint union) | OR-conv counts overlapping pairs too | popcount-ranked subset-sum convolution `O(n^2 2^n)` |
| XOR aggregation | Not a containment relation | Walsh-Hadamard transform |

### 4.3 The min/max caveat

You *can* run the zeta sweep with `min` instead of `+` to get `M[mask] = min_{sub ⊆ mask} A[sub]` — the "best submask value" — and it is `O(n · 2^n)`. But `min`/`max` are **idempotent and non-invertible**: there is no Möbius inverse, so you cannot recover `A`, and you cannot build a convolution from it. Use the min/max zeta only as a one-way aggregation, never as half of a transform pair.

Worked example: `A = [5, 2, 9, 1]` (`n = 2`), min-zeta. `M[00]=5`, `M[01]=min(5,2)=2`, `M[10]=min(5,9)=5`, `M[11]=min(5,2,9,1)=1`. This answers "cheapest item among all subsets of these capabilities" in `O(n·2^n)` — a legitimate, common use (e.g. "minimum-cost configuration achievable within this resource mask"). What you cannot do is recover the original `A` from `M`: many different `A` produce the same `M` (any `A` with the same per-prefix minima), so the map is not injective and has no inverse. This is the operational meaning of "idempotent semiring has no Möbius".

### 4.4 The "iterate only relevant masks" micro-optimization

Some implementations replace `for mask: if mask & bit` with a loop that visits only masks with bit `i` set. For the subset transform this halves the iteration count of the inner loop but does not change the asymptotics, and it complicates the index arithmetic. Benchmark before adopting it: the branch `if mask & bit` is extremely well-predicted (a regular pattern), and modern CPUs often run the simple branched version as fast as the "smart" enumeration while keeping the code obviously correct. Premature cleverness here is a frequent source of off-by-one index bugs.

---

## 5. In-Place Correctness and Direction Discipline

### 5.1 Why in-place works (the senior version)

The reason the in-place subset zeta is correct: when sweeping bit `i`, the read `F[mask ^ bit]` (bit `i` cleared) has been updated for bits `0 … i-1` but **not** for bit `i` (masks with bit `i` cleared are not written during the bit-`i` pass — only masks with bit `i` set are). So it carries exactly the partial sum "summed over bits `0 … i-1`", which is what the recurrence needs. The professional file proves this by induction; the senior takeaway is operational: **the bit loop must be outer**, and you must read the *bit-cleared* (subset) or *bit-set* (superset) neighbor consistently, or the partial-sum invariant breaks.

### 5.1b Reading the invariant operationally

The senior mental shortcut for "is my in-place code correct?": after pass `i`, every cell holds the sum over submasks that agree with it on all bits `> i`. So if you pause the algorithm after, say, two passes on an 8-bit problem, cell `mask` holds the sum over the 4 submasks `mask`, `mask`-with-bit-0-cleared, `mask`-with-bit-1-cleared, `mask`-with-both-cleared (whichever are actually submasks). You can assert this partial invariant in tests — it pinpoints exactly which pass introduced a bug, rather than only checking the final result. Most teams only test the final array; testing a partial sweep is the senior move that localizes failures fast.

### 5.2 Direction discipline

The four operations differ only in two choices — which neighbor, and add vs subtract:

| Operation | Branch condition | Update |
|-----------|------------------|--------|
| Subset zeta | `mask & bit` | `F[mask] += F[mask ^ bit]` |
| Subset Möbius | `mask & bit` | `F[mask] -= F[mask ^ bit]` |
| Superset zeta | `!(mask & bit)` | `F[mask] += F[mask | bit]` |
| Superset Möbius | `!(mask & bit)` | `F[mask] -= F[mask | bit]` |

A single wrong sign or neighbor silently computes a different, plausible-looking transform. Encapsulate each as a named function and never inline the loop ad hoc in business logic.

### 5.3 Iteration order within a pass does not matter

Within one bit-`i` pass, the order of `mask` iteration is irrelevant: masks with bit `i` set only read masks with bit `i` cleared, and those are never written during this pass, so there is no read-after-write hazard within the pass. This means the inner loop parallelizes trivially across masks (Section 7).

### 5.4 The classic "I got superset when I wanted subset" incident

A concrete failure that recurs in code review: an engineer copies the subset zeta but, intending the "how many candidates have at least these skills" query, leaves the branch as `if (mask & bit)` reading `mask ^ bit`. That computes the *subset* sum ("at most these skills"), the exact opposite of intent. The numbers look plausible (monotone, correct grand total at the wrong corner), so unit tests on the grand total pass. Only a brute-force oracle that distinguishes a *specific* non-corner mask catches it. Mitigation: the two directions must be separate, named functions (`subsetZeta`, `supersetZeta`), and the test suite must assert a mid-lattice mask, not just `F[0]` and `F[full]`.

### 5.5 Order across bits also does not matter (but the implementation should fix one)

Corollary: because the per-axis maps commute, sweeping bits in order `0,1,…,n-1` or any permutation yields the same result. This is mathematically reassuring but operationally you should still fix one order (ascending) so that cache behavior is reproducible and so that a partial transform (interrupted mid-sweep) has a well-defined meaning. Relying on "any order works" to justify an out-of-order or data-dependent bit sequence is a smell — it invites bugs where some bit is processed twice or skipped.

---

## 6. Convolutions in Production

### 6.0 Picking the convolution before writing code

A senior reflex: name the exact bitwise relation the problem combines under, then pick the transform.

- Union of two chosen sets equals `m`, overlaps allowed → **OR-convolution** (subset zeta).
- Intersection equals `m` → **AND-convolution** (superset zeta).
- Symmetric difference equals `m` → **XOR-convolution** (Walsh-Hadamard).
- Disjoint union equals `m` (partition into two pieces) → **subset-sum convolution** (popcount-ranked).

Choosing OR when the spec says "partition" (disjoint) is the most common production error here, and it over-counts silently. Write the relation down explicitly in a comment next to the convolution call.

### 6.1 The standard pipeline

OR-convolution: `C = Möbius( zeta(A) ⊙ zeta(B) )` where `⊙` is pointwise multiply. Three transforms (two forward, one inverse) plus one pointwise pass — `O(n · 2^n)`. AND-convolution is identical with the superset transforms. These power:

- **Counting independent sets / colorings** via subset-sum convolution.
- **Covering/packing DPs** ("partition the universe into pieces, each from a family").
- **Inclusion-exclusion Hamiltonicity** (`O(2^n n^2)` via superset sums of walk counts).

### 6.2 Subset-sum convolution (disjoint)

The disjoint version (`i | j = mask`, `i & j = 0`) is the one that actually appears in "partition into parts" DPs. Add a popcount rank: split `A` into `n+1` arrays `A_r[mask] = A[mask]` if `popcount(mask)=r` else `0`. Zeta each rank, convolve ranks so the popcounts add exactly (rank `r` of the result is `Σ_{p+q=r} zeta(A_p) ⊙ zeta(B_q)`), then Möbius the correct rank per mask. Cost `O(n^2 · 2^n)`. This is the production workhorse; plain OR-convolution over-counts because it admits overlapping pairs.

### 6.3 Reusing transforms

When convolving one fixed `A` against many `B`'s, `zeta(A)` is computed **once** and reused. In a service, cache it. Likewise, repeated self-convolution (powers under OR) reuses the forward transform: transform once, raise pointwise to the power, transform back — turning `k`-fold OR-convolution into one zeta, a pointwise `x^k`, and one Möbius.

### 6.4 A worked production scenario: skill-coverage counting

A staffing tool stores, for each candidate, a `skills` bitmask over `n = 18` skills, and must answer two query families at scale: (1) "how many candidates cover *exactly* this skill set?" and (2) "how many candidates have *at least* these skills?". Family (2) is a single superset-zeta of the per-candidate count array, precomputed once (`O(n · 2^n) ≈ 4.7M` ops, ~2 MB `int32`), then `O(1)` per query. Family (1) is just the raw count array. If a third query asks "how many *pairs* of candidates have complementary skills covering everything?" that is an OR-convolution of the count array with itself, read at the full mask. The senior move is to precompute the superset-zeta once at startup, share it read-only across request handlers, and never rebuild it per request — exactly the ladder-caching discipline that prevents per-query `O(n · 2^n)` regressions.

### 6.5 OR-power via pointwise exponentiation

To count, say, sequences of `k` chosen subsets whose union is the full set (a covering-by-`k`-pieces count), you need the `k`-fold OR-convolution of `A` with itself. Naively that is `k-1` convolutions. Instead: transform once (`F = zeta(A)`), raise each entry to the `k`-th power mod `p` (`F[m] = F[m]^k`), and Möbius back. One zeta + `2^n` modular exponentiations + one Möbius = `O(n · 2^n + 2^n log k)`, independent of doing `k` separate convolutions. This is the SOS analogue of "convolution power = pointwise power in the transform domain", and it is the engine of several `O(2^n poly)` covering DPs.

---

## 7. Performance Engineering of the Sweep

### 7.1 The `2^n` pass dominates

`n` is at most ~22, so the cost is `n` sequential passes over a `2^n` array. Every constant-factor win on the pass multiplies through:

- **Flat array, contiguous.** Index by the integer mask directly; no nested arrays or pointer chasing.
- **Bit loop outer, mask loop inner.** Required for correctness *and* gives sequential memory access (the read `mask ^ bit` is within `2^i` of `mask`, cache-local for small `i`; for large `i` it is a strided but still predictable access).
- **Hoist `bit = 1 << i`** out of the inner loop.
- **Branchless variants.** The `if (mask & bit)` branch is well-predicted; micro-optimizing to branchless rarely helps and can hurt readability. Profile before changing.
- **SIMD.** For the modular-add transform, vectorizing the inner loop across masks (when bit `i` is large, the bit-set and bit-cleared halves are contiguous blocks of `2^i`) gives real speedups; libraries and hand-written intrinsics both work.

### 7.2 Parallelism

Within a bit-`i` pass, updates are independent across masks (Section 5.3), so the inner loop parallelizes across threads/goroutines. The outer bit loop is sequential (pass `i` depends on pass `i-1`). For convolutions, the two forward transforms are independent and can run concurrently, and the CRT-prime pipeline is embarrassingly parallel across primes.

### 7.3 Cache behavior across bits

For small `i`, `mask` and `mask ^ bit` are close (good locality). For large `i`, the read is `2^i` away — a long stride. Processing bits low-to-high keeps the early passes cache-hot; the high-bit passes are bandwidth-bound. Blocking by the high bits (process the array in `2^i`-sized tiles for large `i`) can recover locality on very large `n`.

### 7.4 Quantifying the constant factor

The transform is `n` linear passes over `2^n` cells; for `n = 20` that is `~21M` cell-touches. At ~`1` ns per touch (a cache-friendly add) the whole transform is ~`21` ms in a compiled language — but a high-bit pass that misses cache on every access (stride `2^{19}` words = 4 MB, far past L2) can be `10–50×` slower per touch, dominating the runtime. This is why the *high-bit* passes, not the low-bit ones, are the optimization target: blocking, prefetching, or restructuring the high passes yields the bulk of the speedup. Measuring per-bit pass time (instrument the outer loop) immediately shows the bandwidth cliff.

### 7.5 When SIMD actually applies

For a fixed large bit `i`, the array splits into contiguous `2^i`-sized blocks alternating "bit-cleared half" and "bit-set half". The update `set_half[k] += cleared_half[k]` is a pure element-wise vector add over a contiguous run — ideal for SIMD (AVX2 processes 4–8 lanes per instruction). For small `i` the bit-cleared and bit-set entries interleave at stride `2^i < vector width`, so SIMD needs gather/scatter and the win evaporates. Practical rule: vectorize the high-bit passes (`2^i ≥ vector width`), leave the low-bit passes scalar. This split mirrors the cache story — both favor treating high and low bits differently.

---

## 8. Code Examples

### 8.1 Go — direction-parameterized SOS with modulus

```go
package main

import "fmt"

const MOD = 1_000_000_007

// transform runs an in-place bit sweep.
//   subset=true  -> work on masks with bit set, neighbor = mask ^ bit
//   subset=false -> work on masks with bit clear, neighbor = mask | bit
//   invert=true  -> Mobius (subtract); else zeta (add)
func transform(F []int64, n int, subset, invert bool) {
	for i := 0; i < n; i++ {
		bit := 1 << i
		for mask := 0; mask < len(F); mask++ {
			hit := (mask&bit != 0) == subset
			if !hit {
				continue
			}
			var nb int
			if subset {
				nb = mask ^ bit
			} else {
				nb = mask | bit
			}
			if invert {
				F[mask] = ((F[mask]-F[nb])%MOD + MOD) % MOD
			} else {
				F[mask] = (F[mask] + F[nb]) % MOD
			}
		}
	}
}

func orConvolution(a, b []int64, n int) []int64 {
	fa := append([]int64(nil), a...)
	fb := append([]int64(nil), b...)
	transform(fa, n, true, false) // subset zeta
	transform(fb, n, true, false)
	c := make([]int64, len(a))
	for m := range c {
		c[m] = fa[m] * fb[m] % MOD
	}
	transform(c, n, true, true) // subset Mobius
	return c
}

func main() {
	n := 2
	a := []int64{1, 2, 3, 4}
	b := []int64{5, 6, 7, 8}
	fmt.Println("OR-conv mod p:", orConvolution(a, b, n))
}
```

### 8.2 Java — 32-bit memory-lean subset zeta + Möbius round trip

```java
import java.util.Arrays;

public class SosModular {
    static final int MOD = 1_000_000_007;

    static void subsetZeta(int[] F, int n) {
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int m = 0; m < F.length; m++)
                if ((m & bit) != 0)
                    F[m] = (int) (((long) F[m] + F[m ^ bit]) % MOD);
        }
    }

    static void subsetMobius(int[] F, int n) {
        for (int i = 0; i < n; i++) {
            int bit = 1 << i;
            for (int m = 0; m < F.length; m++)
                if ((m & bit) != 0)
                    F[m] = (int) (((F[m] - F[m ^ bit]) % MOD + MOD) % MOD);
        }
    }

    public static void main(String[] args) {
        int n = 4;
        int[] A = new int[1 << n];
        for (int m = 0; m < A.length; m++) A[m] = m + 1;
        int[] F = A.clone();
        subsetZeta(F, n);
        subsetMobius(F, n);
        System.out.println("round-trip OK: " + Arrays.equals(F, A));
    }
}
```

### 8.3 Python — CRT-ready exact subset sum across two primes

```python
def subset_zeta_mod(A, n, p):
    F = [x % p for x in A]
    for i in range(n):
        bit = 1 << i
        for m in range(1 << n):
            if m & bit:
                F[m] = (F[m] + F[m ^ bit]) % p
    return F


def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t                 # value in [0, p1*p2)


if __name__ == "__main__":
    n = 4
    A = [i * 1_000_000 for i in range(1 << n)]  # large values
    P1, P2 = 1_000_000_007, 998_244_353
    F1 = subset_zeta_mod(A, n, P1)
    F2 = subset_zeta_mod(A, n, P2)
    mask = (1 << n) - 1
    exact = crt2(F1[mask], P1, F2[mask], P2)
    print("exact total over all submasks of full mask:", exact, "==", sum(A))
```

---

### 8.4 Notes on the production code above

The Go `transform` is the senior-recommended shape: one routine parameterized by `(subset, invert)` so the four operations (subset/superset × zeta/Möbius) share tested code and cannot drift apart. The Java example shows the **32-bit memory-lean** variant — `int[]` halves memory versus `long[]`, with the multiply promoted to `long` only transiently inside the `% MOD`. The Python CRT example demonstrates recovering an *exact* total that exceeds a single prime: run the identical zeta under two coprime primes and combine per cell with `crt2`. Note all three keep the bit loop outer and reduce/normalize at every arithmetic step — the non-negotiable invariants. In a real codebase these would live behind a small `SetTransform` module with the direction and modulus as configuration, validated once at the boundary.

## 9. Observability and Testing

A transformed array is opaque — one wrong cell looks like any other number. Build checks in from day one.

| Check | Why |
|-------|-----|
| Brute-force `O(3^n)` oracle for small `n` | Catches direction (subset vs superset) and sign errors. |
| Zeta∘Möbius == identity | Confirms the inverse undoes the forward exactly. |
| `F[full mask] == Σ A` | The full mask sums over all submasks; must equal the grand total. |
| `F[0] == A[0]` | The empty mask has only itself as a submask. |
| Convolution vs brute-force `Σ_{i op j = mask}` | Validates the homomorphism pipeline. |
| Determinism across languages | Same modulus → identical Go/Java/Python outputs. |

The single most valuable test is the **brute-force oracle**: enumerate submasks the slow way for `n ≤ 8`, compare entrywise. It catches the overwhelming majority of bugs (wrong direction, wrong sign, off-by-one in size).

### 9.1 A property-test battery

```text
for random A, random n in [0, 8]:
    F = subset_zeta(A, n)
    assert F[(1<<n)-1] == sum(A)              # full mask
    assert F[0] == A[0]                        # empty mask
    assert subset_mobius(F, n) == A            # inverse round-trip
    assert subset_zeta(A, n) == brute_subset_sum(A, n)   # the oracle
for random A, B:
    assert or_convolution(A, B, n) == brute_or_conv(A, B, n)
```

The round-trip (`Möbius∘zeta == id`) is especially good at catching a sign error that happens to look right on uniform data.

### 9.1b Why "all 1s" is a deceptive test input

A tempting smoke test is `A = [1,1,…,1]`. Then `zeta(A)[mask] = 2^{|mask|}` — a clean, checkable value. But it is *too* clean: it does not distinguish subset from superset (both give `2^{|mask|}` vs `2^{n-|mask|}`, which only differ in the exponent, easy to overlook), and a sign error in Möbius on uniform data can still round-trip by luck on some masks. Always include at least one **asymmetric, non-uniform** input (e.g. `A[mask] = mask + 1`, or a single indicator at a non-trivial mask) so that subset vs superset and zeta vs Möbius produce visibly different arrays. The property battery above uses random `A` precisely to avoid uniform-data blind spots.

### 9.1c A debugging worked example

Symptom: a superset-count query returns numbers that are too *small*. Diagnosis path: (1) run the brute oracle on a 3-bit example — it disagrees at mask `010`. (2) Print the transform of `A = [0,0,1,0,0,0,0,0]` (indicator at `010`). Correct superset-zeta gives `1` at every superset of `010` (`010,011,110,111`) and `0` elsewhere; the buggy output has `1` only at `010` and its *submasks*. (3) Conclusion: the code used the subset direction (`mask ^ bit` on set-bit masks) instead of the superset direction. The indicator-input trick localizes direction bugs in one print.

### 9.2 Production guardrails

For a service running SOS in a hot path: a **size validator** (`len(A) == 1 << n`); a **modulus-range assertion** (entries in `[0, p)`); a **memory budget check** (`n` within the configured cap before allocating `2^n`); and a **transform-pairing invariant** so a zeta is never accidentally inverted by the wrong Möbius. Log the chosen direction and `n` alongside results so an anomalous output is traceable.

---

## 10. Failure Modes

### 10.1 Direction error (subset vs superset)
Using `mask | bit` where you meant `mask ^ bit` (or vice versa) computes the wrong containment aggregate. Plausible numbers, wrong answer. Mitigation: named functions per direction; brute-force oracle.

### 10.2 Sign error (zeta vs Möbius)
Subtracting in the forward transform or adding in the inverse breaks the round trip. Mitigation: the `Möbius∘zeta == id` property test.

### 10.3 Loop order error
Putting the mask loop outer and bit loop inner destroys the partial-sum chaining; the in-place invariant no longer holds. Mitigation: code review the loop nesting; it must be bit-outer.

### 10.4 Overflow / missing modulus
Subset sums overflow without a modulus or 64-bit promotion; the convolution product overflows if reduced too late. Mitigation: reduce per op; promote to 64-bit for the multiply.

### 10.5 Negative residues after Möbius
Go/Java `%` returns negatives on subtraction; a negative residue corrupts downstream multiplies. Mitigation: `((x % p) + p) % p` after every subtraction.

### 10.6 Memory blow-up at large `n`
`n ≥ 24` makes `2^n` arrays dominate the heap; convolutions need several. Mitigation: reduce `n` by modeling; narrower element type; reuse buffers; if truly large, SOS is the wrong tool.

### 10.7 Wrong convolution choice
Using OR-convolution where the disjoint **subset-sum convolution** is required over-counts (it admits overlapping pairs `i & j ≠ 0`). Mitigation: if the spec says "partition" / "disjoint", use the popcount-ranked `O(n^2 2^n)` version.

### 10.8 In-place clobber
Transforming `A` in place then expecting the original later. Mitigation: clone before transforming if both are needed; document which arrays the transform mutates.

### 10.9 Min/max "inverse" attempt
Running a min/max zeta and then trying to Möbius-invert it. Idempotent ops have no inverse. Mitigation: only use min/max as one-way aggregation, never as a transform pair.

### 10.10 Forgetting the WHT normalization mod a power of two
XOR-convolution's inverse WHT divides by `2^n`. Mod an odd prime, multiply by `(2^n)^{-1}`. But mod `2^{64}` there is no inverse of `2`, so the division is invalid and the result is corrupt. Symptom: XOR-convolution correct mod a prime but wrong mod `2^{64}`. Mitigation: use an odd modulus for XOR-convolution, or carry exact integers when they fit.

### 10.11 Recomputing a shared transform per request
In a service, rebuilding `zeta(A)` for a fixed `A` on every query wastes `O(n · 2^n)` per call and allocates a fresh `2^n` array each time. Symptom: latency that scales with the array size per query, plus GC pressure. Mitigation: precompute once at startup, share the transformed array read-only across handlers (Section 6.4).

### 10.12 Diagnostic quick-reference

| Symptom | Likely cause | First check |
|---------|--------------|-------------|
| Totals too large / wrapped | missing modulus or `int32` overflow | promote to `int64` / reduce per op |
| Aggregate at wrong corner | subset vs superset direction | print indicator-input transform (9.1c) |
| Round-trip ≠ identity | zeta/Möbius sign error | run `Möbius(zeta(A)) == A` |
| Convolution over-counts | OR-conv used for disjoint case | switch to ranked subset-sum conv |
| Negative residues downstream | unnormalized Möbius subtraction | `((x%p)+p)%p` |
| OOM at startup | `n` too large / no buffer reuse | budget `2^n × elem × live_arrays` |

---

## 11. Summary

- SOS DP computes submask (or superset) aggregates in `O(n · 2^n)`; the cost is dominated by the `2^n` array, not the `n` factor.
- The **`2^n` memory wall** is the real limit: feasible to `n ≈ 22`, painful at 24, infeasible past 26. The biggest lever is modeling `n` down; the next is narrow element types and in-place transforms.
- **Overflow discipline** is mandatory: reduce mod `p` per op, promote to 64-bit for convolution products, normalize negative residues after Möbius subtraction; CRT across primes for exact large values.
- **Applicability** is specific: index space `2^n`, aggregate over subset/superset containment, many masks needed, associative `⊕`. Impostors include arbitrary-relation aggregates, large `n`, min/max "inverses", and the disjoint subset-sum convolution (which OR-conv over-counts).
- **In-place correctness** rests on the bit-outer loop and reading the correct neighbor; iteration within a pass is hazard-free, so the inner loop parallelizes.
- **Convolutions** (OR via subset, AND via superset, XOR via Walsh-Hadamard, disjoint subset-sum via popcount rank) all reuse the same sweep; transform once and reuse when convolving against many inputs.
- **Performance** lives in the `2^n` pass: flat arrays, bit-outer order, hoisted `bit`, SIMD across masks, parallel inner loop, cache blocking for high bits.
- **Always keep a brute-force oracle and the round-trip property test**; they catch the direction error, the sign error, and the overflow error that together account for nearly every real bug.

### Decision summary

- **Aggregate over submasks/supersets, `n ≤ 22`** → subset/superset zeta (`O(n · 2^n)`); Möbius to invert.
- **Inclusion-exclusion over a subset family** → Möbius transform instead of `O(3^n)` signed sum.
- **OR / AND convolution** → matching zeta, pointwise multiply, matching Möbius.
- **XOR convolution** → Walsh-Hadamard (same Yates structure, signed butterfly).
- **Disjoint partition convolution** → popcount-ranked subset-sum convolution (`O(n^2 · 2^n)`).
- **Exact large counts** → SOS per prime, CRT-combine.
- **`n ≥ 24` or non-lattice index** → SOS is the wrong tool; reduce `n` or change approach.

### Operating principles (one-liners)

- Decide the arithmetic regime (modular / 64-bit exact / CRT) before writing a line.
- Bit loop outer, named function per direction, reduce/normalize every op.
- Keep a brute-force oracle and the `Möbius(zeta(A)) == A` round-trip in CI.
- Budget `2^n × elem_size × live_array_count` before allocating; reuse buffers.
- Optimize the high-bit passes (cache, SIMD); the low passes are already fast.
- Name the bitwise relation before choosing a convolution; "partition" means disjoint, not OR.

References to study further: Yates' algorithm and the multidimensional FFT view, fast subset-sum convolution (Björklund-Husfeldt-Kaski-Koivisto), the Walsh-Hadamard transform, Möbius inversion on the subset lattice, and sibling topics `12-bitmask-dp` and the prefix-sum techniques in `13-dynamic-programming`.

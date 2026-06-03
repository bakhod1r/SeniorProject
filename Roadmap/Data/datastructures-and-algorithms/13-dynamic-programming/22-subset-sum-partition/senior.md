# Subset Sum and Partition DP — Senior Level

> Subset-sum is rarely the bottleneck on a textbook array — but the moment the target `T` is value-large, the input is adversarial, the count must be exact modulo a prime, or the same routine sits behind a load-balancing / billing / resource-packing feature at scale, every detail (pseudo-polynomial blow-up, word-parallel acceleration, the DP-vs-MITM crossover, modulus handling, reconstruction memory) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The Pseudo-Polynomial Blow-Up](#2-the-pseudo-polynomial-blow-up)
3. [Word-Parallel (Bitset) Acceleration in Production](#3-word-parallel-bitset-acceleration-in-production)
4. [Choosing Between DP, Bitset, and Meet-in-the-Middle](#4-choosing-between-dp-bitset-and-meet-in-the-middle)
5. [Counting Exactly: Modulus, Overflow, and CRT](#5-counting-exactly-modulus-overflow-and-crt)
6. [Minimum-Difference Partition at Scale](#6-minimum-difference-partition-at-scale)
7. [Reconstruction Without Quadratic Memory](#7-reconstruction-without-quadratic-memory)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does `dp[t] |= dp[t-v]` work" but "what system am I modeling, and what breaks when I scale it?". Subset-sum and partition DP show up in production in several guises that share one engine:

1. **Resource packing / load balancing** — split jobs across two (or `k`) machines to balance load; that is minimum-difference partition.
2. **Billing / coin-selection** — can a set of credits exactly cover a charge; that is subset-sum decision.
3. **Combinatorial counting** — how many ways to reach a target (e.g. "Target Sum" with `±` assignments), exact mod a prime.
4. **Feasibility gates** — can this set of weights be balanced at all before we commit to an expensive packing.

All reduce to: *fill a reachability (or count) table of width equal to the target, scanning items, in the right ordering.* The senior-level decisions are: how to keep the table width manageable when values are large, how to make the inner loop word-parallel, when to abandon the table for meet-in-the-middle, how to keep counts exact and overflow-free, and how to verify the result when the input is large or adversarial.

This document treats those decisions in production terms.

---

## 2. The Pseudo-Polynomial Blow-Up

### 2.1 Why `O(n·T)` is not "polynomial"

The DP runs in `O(n·T)` where `T` is the target *value*. The input encodes `T` in `Θ(log T)` bits. A genuinely polynomial algorithm would run in `poly(n, log T)` — but `O(n·T)` is *exponential* in `log T`. That gap is the entire reason subset-sum is NP-complete (Section in `professional.md`) yet the DP "solves" it: the DP is **pseudo-polynomial**, fast only while `T` is numerically small.

Concretely: values up to `10^3` and `n = 1000` give `T ≤ 10^6`, table fits, DP is instant. Values up to `10^9` give `T ≤ 10^{12}` — a table of a trillion cells, impossible. **Same `n`, same code, but the numeric magnitude of the values decides feasibility.** This is the first thing to check before reaching for the DP.

### 2.2 The crossover with input size

| Values bounded by | `n` | `T = Σ` order | DP feasible? | Use instead |
|-------------------|-----|---------------|--------------|-------------|
| `10^3` | `10^3` | `10^6` | yes | — |
| `10^5` | `10^3` | `10^8` | borderline (memory) | bitset, or MITM if `n` small |
| `10^9` | `40` | `10^{10}+` | no | meet-in-the-middle |
| `10^9` | `10^4` | `10^{13}` | no | (NP-hard regime; approximate or reformulate) |

The pivot is **value magnitude**, not item count. A senior reviewer's first question on any subset-sum code is "what bounds the values?" — because that, not `n`, decides the algorithm.

### 2.3 Approximation when exactness is unaffordable

When `T` is large *and* `n` is large, exact subset-sum is intractable, but an **FPTAS** (fully polynomial-time approximation scheme) exists for the optimization version (largest subset sum `≤ T`): round/trim the reachable-sums list to within a `(1 ± ε)` factor, keeping its size polynomial in `n/ε`. This is the production escape hatch when "close enough" is acceptable (e.g. load balancing within 1%). The exact decision DP has no such shortcut.

### 2.4 GCD compression of the target

A free preprocessing win: if `g = gcd(a₁, …, aₙ)` and `g > 1`, then every reachable sum is a multiple of `g`. If `target % g != 0` the answer is immediately `false`; otherwise divide all values and the target by `g`, shrinking the table by a factor `g` at no cost. For inputs like `[6, 10, 15]` with `gcd = 1` it does nothing, but for `[100, 200, 300]` targeting `500` it divides the table width by `100`. Always strip the common factor before sizing the DP — it is an `O(n)` check that can turn an infeasible table into a feasible one.

---

## 3. Word-Parallel (Bitset) Acceleration in Production

### 3.1 The transformation

The boolean DP's inner loop `for t: dp[t] |= dp[t-v]` is exactly a shifted OR of a bit-vector. Storing `dp` as the bits of a machine-word array `B` (or `std::bitset<T+1>`), one item becomes:

```
B |= (B << v)
```

This processes `w = 64` sums per instruction, dropping the cost from `O(n·T)` to `O(n·T / w)`. The asymptotics are unchanged (the `T` factor remains), but the **constant factor of ~64** is the difference between feasible and not for `T` in the `10^5`–`10^7` range.

### 3.2 Implementation discipline

- **C++:** `std::bitset<MAXT+1>` with `dp |= dp << v` — the cleanest and fastest; the shift is a tight `memmove`-like loop with no per-bit branching.
- **Java/Go/Python:** big integers (`BigInteger` / `math/big.Int` / Python `int`). Python's arbitrary-precision `int` makes `B |= B << v` idiomatic and surprisingly fast (the shift is C-level).
- **Manual word array:** for control, store `uint64[]` words and implement the shifted OR yourself; handle the cross-word carry of the shift carefully (a `<< v` spans word boundaries when `v` is not a multiple of 64).
- **Bound the width:** after each shift, mask `B` to `target+1` bits so the integer doesn't grow without limit and memory stays `O(T/w)`.

### 3.3 When bitset does *not* help

The bitset trick accelerates the **boolean decision** only. Counting (integers per cell) and min-plus-style optimization cannot be packed into single bits, so they stay at `O(n·T)`. If you need counts or weighted optima, the word-parallel win is unavailable — reach for a tighter `T` bound or MITM instead.

### 3.4 Bounding the bitset width

A naive big-integer `B |= B << v` lets `B` grow to `S` bits even though only sums `≤ target` matter. After each shift, AND `B` with a `(target+1)`-bit mask:

```
B = (B | (B << v)) & mask        # mask = (1 << (target+1)) - 1
```

This caps memory at `O(target/w)` and prevents a degenerate input (huge values summing far past the target) from blowing the integer up. For `std::bitset<MAXT+1>` the width is fixed at compile time and this is automatic; for runtime-sized big integers it is a deliberate, easily-forgotten step. The mask also makes the highest-set-bit query for min-difference (`S − 2·msb(B)`) cheap and bounded.

### 3.5 Choosing the representation per language

| Language | Idiomatic bitset | Notes |
|----------|------------------|-------|
| C++ | `std::bitset<MAXT+1>` | fastest; `dp |= dp << v` compiles to a tight word loop |
| Python | native `int` | `B |= B << v`; arbitrary precision, shift is C-level and fast |
| Java | `BigInteger` | `B = B.or(B.shiftLeft(v))`; allocates per op — reuse where possible |
| Go | `math/big.Int` | `B.Or(B, new(big.Int).Lsh(B, uint(v)))`; mind allocation churn |

In Java and Go the per-operation allocation is the practical bottleneck; in hot loops, prefer a hand-rolled `uint64[]` word array (Section in `professional.md` covers the cross-word carry) so you can mutate in place and avoid GC pressure.

---

## 4. Choosing Between DP, Bitset, and Meet-in-the-Middle

The three viable exact techniques have disjoint sweet spots:

| Technique | Cost | Sweet spot | Notes |
|-----------|------|-----------|-------|
| 1D boolean DP | `O(n·T)` | moderate `T`, any `n` | the default |
| Bitset DP | `O(n·T / 64)` | larger `T`, decision only | 64× constant win |
| Meet-in-the-middle | `O(2^{n/2}·n)` | small `n` (≤ ~40), huge `T` | independent of `T` |

The decision is two-dimensional. Plot `(n, log T)`:

- **`T` small** → DP (bitset if decision-only). Cost grows with `T`.
- **`n` small, `T` huge** → MITM. Cost grows with `2^{n/2}`, ignores `T`.
- **Both large** → no exact polynomial method (NP-hard); approximate (FPTAS) or reformulate.

The crossover where MITM beats DP is roughly when `2^{n/2} < n·T / 64`. For `n = 40`, `2^{20} ≈ 10^6`; the DP loses once `T` exceeds a few tens of millions. The MITM machinery — sorted-half enumeration, binary search or two-pointer for closest-sum — lives in **sibling topic `15-divide-and-conquer/06`**; from the subset-sum side the only senior decision is *when* to switch, and the trigger is "huge `T`, small `n`."

### 4.1 The density pivot, operationally

The reachable set has size `min(2ⁿ, S+1)` (`professional.md` §11B). This single quantity *is* the DP-vs-MITM decision:

- If `S + 1 ≪ 2ⁿ` (many items, small values) → the table is dense, the DP enumerates it cheaply, DP wins.
- If `2ⁿ ≪ S + 1` (few items, huge values) → the reachable set is sparse, MITM enumerates only the `≤ 2ⁿ` reachable sums directly, MITM wins.

So the production heuristic "compare `n·T/64` against `2^{n/2}`" is really comparing the two ways of touching the reachable set: scan a `T`-wide table, or enumerate `2^{n/2}` sums per half. Computing both estimates and picking the smaller is a robust dispatcher (Section 8.3 shows the code).

### 4.2 Hybrid: MITM with a DP-bounded half

A refinement when one half has small values and the other huge: run the *small-value* half with a bitset DP (compact reachable set) and the *huge-value* half with explicit enumeration, then combine. This is rarely needed but illustrates that DP and MITM are not mutually exclusive — they are two enumeration strategies for the same reachable set, mixable per-half when the value distribution is skewed.

---

## 5. Counting Exactly: Modulus, Overflow, and CRT

### 5.1 Why a modulus

Subset counts grow up to `2^n`. For `n = 60` that already overflows 64-bit. Counting problems therefore specify a prime modulus (`10^9+7`, `998244353`). Reduce after every `cnt[t] += cnt[t-v]`. The reduction is a ring homomorphism, so interleaving it at every step gives the exact count mod `p`.

### 5.2 Overflow budget

With `int64` and `p < 2^31`, two reduced residues sum to `< 2^32`, well within range; a single `% p` per addition is always safe. The danger is only if you *defer* reductions and let many additions accumulate — bound the deferral or just reduce every step (the division is cheap relative to memory traffic).

### 5.3 CRT for exact large counts

If the problem wants the **exact** (non-modular) count and it exceeds one prime's range, run the same counting DP under several coprime primes and recombine via CRT. Each prime is an independent, parallelizable run. Estimate the magnitude (`≤ 2^n`) to choose how many primes you need.

### 5.4 Negative residues

In Go/Java `%` can be negative when subtracting (e.g. inclusion-exclusion over counts). Normalize with `((x % p) + p) % p`. Plain subset counting only adds, so this bites only in the more exotic counting formulations.

### 5.5 Counting distinct-value subsets vs index-subsets

A subtle product requirement: do you count distinct *index*-subsets (the DP's natural output) or distinct *value*-multisets? With duplicate values the two differ — `[2, 2]` has two index-subsets summing to `2` but one distinct value-subset `{2}`. The plain counting DP gives index-subsets. To count distinct value-subsets, group equal values and process each group as a "choose how many copies" polynomial factor `(1 + x^v + x^{2v} + … + x^{cv})` (a bounded-knapsack factor), not `c` independent `(1 + x^v)` factors. Misreading this requirement is a silent off-by-multiplicity bug that passes value-based tests but fails on duplicate-heavy inputs.

---

## 6. Minimum-Difference Partition at Scale

The two-way balanced split is the production workhorse (load balancing, fair division). The recipe:

1. `S = Σ`. Run boolean subset-sum up to `half = S/2`.
2. Find the largest reachable `sA ≤ half`. Best difference `= S − 2·sA`.

Senior considerations:

- **Width is `S/2`, not `S`.** Halving the table is a 2× memory/time win; size to `half + 1`.
- **Bitset it.** The reachability table is boolean, so `B |= B << v` applies directly; the final answer is `S − 2·(highest set bit ≤ half)`.
- **`k`-way is different.** Balancing across `k > 2` machines is *not* a subset-sum; it is the `k`-equal-partition / multiprocessor-scheduling problem — NP-hard, solved by bitmask DP or LPT-style approximation (sibling topic `06`). Do not reach for the two-way DP when `k > 2`.
- **Ties and reconstruction.** If you must report *which* jobs go where (not just the difference), keep reconstruction state (Section 7) — the difference alone is rarely enough for a real scheduler.

---

## 7. Reconstruction Without Quadratic Memory

The naive reconstruction stores the full 2D `dp[i][t]` (`O(n·T)` memory) and walks backward. For large `T` that memory is prohibitive. Senior alternatives:

- **Hirschberg-style divide-and-conquer.** Reconstruct the subset using `O(T)` memory and `O(n·T)` time by recursing on item halves and a midpoint sum split — the same trick used for LCS reconstruction in linear space.
- **Bit-packed predecessor.** Store, per reachable sum, one bit per item-block; reconstruct from the compressed trail. Cuts the constant but not the asymptotic.
- **Recompute on demand.** Keep only the 1D boolean DP, and when reconstruction is needed, recompute the table row-by-row while walking backward, trading time for space.
- **Just the answer.** If the caller only needs the *difference* or the *count*, do not reconstruct at all — the boolean/count DP suffices in `O(T)` space.

Pick based on whether the consumer needs the actual subset (scheduler assignment) or just a scalar (feasibility/difference).

### 7.1 Hirschberg Linear-Space Reconstruction in Detail

The idea (borrowed from linear-space LCS): to recover a subset summing to `T` from items `a[0..n)` using `O(T)` memory:

1. Split items into `Left = a[0..mid)` and `Right = a[mid..n)`.
2. Compute, with the 1D DP, the reachable-sums bitset `F` of `Left` and the reachable-sums bitset `G` of `Right`.
3. Find a split `tL + tR = T` with `tL ∈ F`, `tR ∈ G` (scan `tL`, check `G[T − tL]`).
4. Recurse on `(Left, tL)` and `(Right, tR)`, concatenating the recovered subsets.

Each level does `O(n·T)` DP work and `O(T)` memory; the recursion depth is `O(log n)`, and the per-level item counts halve, so total time is `O(n·T)` (geometric sum) with `O(T)` peak memory — the full 2D table's `O(n·T)` memory is avoided. This is Task 13 in [`tasks.md`](./tasks.md). The technique matters precisely when `T` is large enough that the 2D table would OOM but the 1D table still fits.

### 7.2 When reconstruction is the wrong ask

A scheduler usually needs the *assignment*; a feasibility gate needs only the *bit*. Before paying any reconstruction cost, confirm the consumer truly needs the items — many production "partition" features only report the difference or a yes/no, in which case the `O(T)`-space boolean DP is the complete answer and reconstruction is wasted work.

---

## 8. Code Examples

### 8.1 Go — bitset min-difference partition via big.Int

```go
package main

import (
	"fmt"
	"math/big"
)

// minDiffPartition returns the minimum |S1 - S2| over all two-way splits,
// using a big-integer bitset for the reachability table.
func minDiffPartition(nums []int) int {
	total := 0
	for _, v := range nums {
		total += v
	}
	half := total / 2
	B := big.NewInt(1) // bit 0 set: sum 0 reachable
	mask := new(big.Int).Lsh(big.NewInt(1), uint(half+1))
	mask.Sub(mask, big.NewInt(1)) // low (half+1) bits set
	for _, v := range nums {
		shifted := new(big.Int).Lsh(B, uint(v))
		B.Or(B, shifted)
		B.And(B, mask) // bound width to half bits
	}
	for sA := half; sA >= 0; sA-- {
		if B.Bit(sA) == 1 {
			return total - 2*sA
		}
	}
	return total
}

func main() {
	fmt.Println(minDiffPartition([]int{1, 6, 11, 5})) // 1
}
```

### 8.2 Java — counting subsets mod p with overflow-safe accumulation

```java
public class CountSubsetsMod {
    static final long MOD = 1_000_000_007L;

    static long countSubsets(int[] nums, int target) {
        long[] cnt = new long[target + 1];
        cnt[0] = 1; // empty subset
        for (int v : nums) {
            // downward scan => each item used at most once
            for (int t = target; t >= v; t--) {
                long s = cnt[t] + cnt[t - v];
                cnt[t] = s % MOD; // reduce every step: always safe in 64-bit
            }
        }
        return cnt[target];
    }

    public static void main(String[] args) {
        System.out.println(countSubsets(new int[]{1, 1, 2, 3}, 4));
    }
}
```

### 8.3 Python — DP-or-MITM dispatcher with a value-magnitude gate

```python
import bisect


def subset_sum_dp(nums, target):
    B = 1
    for v in nums:
        B |= B << v
    return (B >> target) & 1 == 1


def subset_sum_mitm(nums, target):
    n = len(nums)
    left, right = nums[: n // 2], nums[n // 2:]

    def all_sums(arr):
        sums = {0}
        for v in arr:
            sums |= {s + v for s in sums}
        return sorted(sums)

    ls, rs = all_sums(left), all_sums(right)
    for sl in ls:
        need = target - sl
        i = bisect.bisect_left(rs, need)
        if i < len(rs) and rs[i] == need:
            return True
    return False


def subset_sum(nums, target):
    """Dispatch on the pseudo-polynomial gate: table width vs 2^(n/2)."""
    n = len(nums)
    # cost(DP) ~ n*target/64 ; cost(MITM) ~ 2^(n/2)
    if target <= 5_000_000 or n > 40:
        return subset_sum_dp(nums, target)
    return subset_sum_mitm(nums, target)


if __name__ == "__main__":
    print(subset_sum([1, 5, 11, 5], 11))            # True  (small T -> DP)
    print(subset_sum([10**9, 2 * 10**9, 3], 3))     # True  (huge T, small n -> MITM)
```

---

### 8.4 Go — manual word-array bitset (no allocation in the hot loop)

```go
package main

import "fmt"

// subsetSumWords decides subset-sum to target using a fixed uint64 word array,
// mutating in place (no per-item allocation). Handles cross-word shift carry.
func subsetSumWords(nums []int, target int) bool {
	words := target/64 + 1
	B := make([]uint64, words)
	B[0] = 1 // bit 0 set: sum 0 reachable
	tmp := make([]uint64, words)
	for _, v := range nums {
		wordShift, bitShift := v/64, uint(v%64)
		// tmp = B << v
		for i := range tmp {
			tmp[i] = 0
		}
		for i := words - 1; i >= 0; i-- {
			src := i - wordShift
			if src < 0 {
				continue
			}
			tmp[i] |= B[src] << bitShift
			if bitShift != 0 && src-1 >= 0 {
				tmp[i] |= B[src-1] >> (64 - bitShift) // carry from lower word
			}
		}
		for i := range B {
			B[i] |= tmp[i]
		}
	}
	return (B[target/64]>>uint(target%64))&1 == 1
}

func main() {
	fmt.Println(subsetSumWords([]int{1, 5, 11, 5}, 11)) // true
}
```

This is the allocation-free representation referenced in Section 3.5; the cross-word carry (`>> (64 - bitShift)`) is the detail that a naive implementation drops, silently corrupting reachability across word boundaries.

## 9. Observability and Testing

A subset-sum result is opaque — a wrong `true`/`false` or a wrong count looks like any other. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force `2^n` oracle on small `n` | Catches the item-reuse bug (wrong scan direction) and the missing `dp[0]`. |
| `dp[0] == true` invariant | Confirms the empty-subset base case. |
| Partition parity gate | Odd `S` must short-circuit to `false`. |
| Count vs decision consistency | `count[t] > 0` iff `dp[t]` — cross-check the two DPs. |
| Bitset vs array agreement | Same answer from `B |= B<<v` and the explicit loop. |
| MITM vs DP agreement | On inputs feasible for both, identical decisions. |
| Min-diff lower bound | The reported difference must have the same parity as `S` and be `≥ 0`. |
| Determinism across languages | Same input → identical Go/Java/Python results. |

The single most valuable test is the **brute-force oracle**: enumerate all `2^n` subsets for `n ≤ 20` and compare the decision/count entrywise. It catches the overwhelming majority of bugs — especially the low-to-high scan that silently reuses items.

### 9.1 A property-test battery

```text
for random small array nums, random target T:
    assert dp[0] is True
    assert subset_sum_dp(nums, T) == bruteforce(nums, T)          # oracle
    assert subset_sum_bitset(nums, T) == subset_sum_dp(nums, T)   # bitset agrees
    assert (count_subsets(nums, T) > 0) == subset_sum_dp(nums, T) # count vs decision
    assert can_partition(nums) == (S % 2 == 0 and subset_sum_dp(nums, S//2))
    if n <= 40: assert subset_sum_mitm(nums, T) == subset_sum_dp(nums, T)
```

These invariants, run on a few hundred random instances, give high confidence. The `count > 0 ⇔ reachable` test is especially good at catching an off-by-one in the counting DP's base case.

### 9.1b A concrete oracle implementation

The oracle is short and worth keeping in the test suite verbatim:

```python
def oracle(nums, target):
    n = len(nums)
    for mask in range(1 << n):
        s = sum(nums[i] for i in range(n) if mask & (1 << i))
        if s == target:
            return True
    return False
```

Run it for `n ≤ 20` against every production code path (boolean DP, bitset, MITM) on a few hundred random instances per CI run. The single highest-value assertion is `dp(nums, T) == oracle(nums, T)` — it has caught, in practice, the upward-scan item-reuse bug, the missing `dp[0]`, the off-by-one in the inner loop bound, and the wrong-modulus count error, which together are nearly every real defect in this code.

### 9.2 Production guardrails

For a service answering partition/subset-sum queries at scale, add: an **input validator** asserting values are non-negative and bounded (reject inputs whose `Σ` would blow the table); a **value-magnitude gate** that routes huge-`T` small-`n` inputs to MITM and rejects the both-large NP-hard regime with a clear error (or an approximate path); and a **memory cap** on the table width so a hostile input cannot OOM the service.

---

## 10. Failure Modes

### 10.1 Pseudo-polynomial blow-up

Running the `O(n·T)` DP on values up to `10^9` allocates a table of `~10^{12}` cells and OOMs. Mitigation: gate on value magnitude; route to MITM (small `n`) or approximate (FPTAS) when `T` is large.

### 10.2 Item reused (wrong scan direction)

Iterating `t` low→high in the 1D array lets each item contribute multiple times — that is *unbounded* knapsack, not subset-sum. Symptom: spurious `true`s / inflated counts. Mitigation: scan `t` from `T` down to `v`; cover it with the brute-force oracle.

### 10.3 Missing base case

Forgetting `dp[0] = true` (or `cnt[0] = 1`) leaves the whole table dead. Mitigation: assert the base case; property-test `dp[0]`.

### 10.4 Counting overflow

Deferred reductions or 32-bit accumulators overflow the exponential counts. Mitigation: reduce mod `p` every step in 64-bit; CRT across primes for exact large values.

### 10.5 Two-way DP misused for `k`-way

Using two-way subset-sum to "balance across `k` machines" gives wrong answers for `k > 2`. Mitigation: `k`-equal partition is NP-hard bitmask DP / scheduling (topic `06`); detect `k > 2` and switch.

### 10.6 Negative inputs

The DP assumes non-negative values; a stray negative makes `t - v` exceed the range or corrupts reachability. Mitigation: validate non-negativity, or apply an offset/shift formulation explicitly.

### 10.7 Quadratic reconstruction memory

Keeping the full 2D table for reconstruction OOMs when `T` is large. Mitigation: Hirschberg linear-space reconstruction, or don't reconstruct if only a scalar is needed (Section 7).

### 10.8 Off-by-one between "sum" and "count of items"

A subtle modeling slip: a requirement like "pick exactly `m` items summing to `T`" is *not* plain subset-sum — it needs a second dimension (`dp[m][t]`). Always pin down whether a cardinality constraint exists; the plain table answers only "any subset," and this off-by-one survives all the value-based tests, surfacing only against the real expected outputs.

### 10.9 Unbounded vs 0/1 scan-direction confusion

Subset-sum (0/1) scans `t` downward; the unbounded variant (each item reusable) scans upward. Copy-pasting one into the other silently changes the semantics — the most common direction bug. Symptom: a "subset-sum" that accepts using an item multiple times, or an "unbounded knapsack" that under-counts. Mitigation: a one-line comment at the inner loop stating which semantics the direction enforces, plus a brute-force oracle that distinguishes the two.

### 10.10 Floating-point amounts

Monetary or measured inputs as floats break the integer-indexed table (you cannot index `dp[3.14]`). Symptom: rounding makes "exact" sums miss. Mitigation: scale to integer units (cents, milligrams) before running the DP, and bound the resulting integer total to keep the table feasible (Section 2.1).

---

## 10A. A Production Decision Walkthrough

Putting the pieces together for a realistic "split this set of jobs fairly across two workers" feature:

1. **Validate.** Reject negative durations; scale fractional durations to integer units; compute `S` in 64-bit.
2. **Parity / magnitude gate.** For exact-equal, check `S` even. Estimate the table width `S/2`; if it exceeds the memory cap and `n ≤ 40`, route to MITM closest-sum; if both large, return an FPTAS-approximate split with a logged `ε`.
3. **Run.** Bitset subset-sum to `S/2`, masked to `S/2+1` bits.
4. **Read.** `s* =` highest set bit `≤ S/2`; minimum difference `= S − 2·s*`.
5. **Reconstruct (if needed).** Hirschberg linear-space to recover which jobs go to worker A; the rest go to worker B.
6. **Verify.** On small inputs, diff against the `2ⁿ` oracle in CI; in production, assert the two reported subsets are disjoint, cover all jobs, and have the reported difference.

This pipeline is the senior-level "default" for two-way balancing; the only branch points are the magnitude gate (DP vs MITM vs FPTAS) and whether the caller needs the assignment or just the scalar.

---

## 11. Summary

The senior view of subset-sum is that the textbook `O(n·T)` DP is correct but rarely the whole story at scale; the engineering lives in the gates around it.

- The `O(n·T)` subset-sum DP is **pseudo-polynomial** — fast only while the target *value* `T` is numerically small. The first senior question on any instance is "what bounds the values?", because magnitude, not item count, decides feasibility.
- The boolean decision admits a **word-parallel bitset** acceleration: `B |= B << v` runs at `O(n·T / 64)`, a 64× constant win that makes mid-range `T` feasible. Counting and weighted variants cannot be bit-packed.
- When `T` is huge but `n` is small (≤ ~40), abandon the table for **meet-in-the-middle** (`O(2^{n/2} n)`, independent of `T`); the machinery lives in `15-divide-and-conquer/06`, the senior call is *when* to switch.
- **Counting** must be exact mod a prime (counts reach `2^n`); reduce every step in 64-bit, CRT across primes for exact large values.
- **Minimum-difference partition** is the production workhorse (load balancing); table width is `S/2`, it bitsets cleanly, and `k > 2` is a different (NP-hard) problem — do not conflate them.
- **Reconstruction** of the chosen subset costs `O(n·T)` memory naively; use Hirschberg linear-space recursion, or skip it entirely when only a scalar is needed.
- Always keep a **brute-force `2^n` oracle**; it catches the scan-direction (item-reuse) bug, the missing base case, and the count off-by-one that together account for nearly every real bug.

### Decision summary

- **Moderate `T`, decision** → 1D boolean DP, bitset-accelerated (`O(n·T/64)`).
- **Moderate `T`, count** → integer DP mod `p`; CRT for exact large counts.
- **Huge `T`, small `n`** → meet-in-the-middle (`15-divide-and-conquer/06`).
- **Both large** → NP-hard; FPTAS approximation or reformulate.
- **Two-way balance** → min-difference subset-sum (width `S/2`).
- **`k`-way balance (`k > 2`)** → bitmask DP / scheduling (topic `06`).
- **Need the actual items** → reconstruct (2D table or Hirschberg linear-space).

References to study further: the FPTAS for subset-sum (Ibarra-Kim trimming), Hirschberg linear-space reconstruction, `std::bitset` knapsack acceleration, the multiprocessor-scheduling / `k`-partition hardness, and sibling topics `06-partition-k-equal-subsets` and `15-divide-and-conquer/06` (meet-in-the-middle).

### Preprocessing Checklist (apply before any DP)

These cheap `O(n)` (or `O(n log n)`) steps routinely turn an infeasible instance into a feasible one and short-circuit easy cases:

1. **Sum in 64-bit.** Compute `S` without overflow.
2. **Parity gate (partition).** Odd `S` → no equal partition; return immediately.
3. **GCD compression.** `g = gcd(values)`; if `g ∤ target` return `false`; else divide all values and the target by `g` (table shrinks by `g`).
4. **Drop oversized items.** A value `> target` can never be in a subset summing to `target` — skip it (but it still counts toward `S` for partition feasibility).
5. **Magnitude gate.** Estimate table width vs `2^{n/2}`; route to DP / bitset / MITM / FPTAS accordingly.
6. **Cap the table.** Refuse to allocate beyond a memory budget; fail loudly rather than OOM.

Skipping these is the most common reason a "correct" subset-sum solution is slow or crashes in production: the algorithm is right but the instance was never reduced to its tractable core. The checklist is the senior-level discipline that separates a textbook implementation from a deployable one.

### One-Paragraph Mental Model

Subset-sum is "grow a set of reachable totals, one item at a time, never removing." The boolean table *is* that set; counting tracks multiplicity; min-difference reads the total closest to `S/2`. The only correctness subtlety is the downward scan (use each item once), and the only feasibility subtlety is that the table width follows the *value* `T`, not the item count — so the entire scaling story is "is `T` small (DP), is `n` small (MITM), or neither (approximate)?".

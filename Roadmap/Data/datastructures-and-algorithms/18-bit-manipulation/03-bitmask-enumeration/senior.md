# Bitmask Enumeration (Iterating Over Sets as Integers) — Senior Level

> **Focus:** production realities — exactly which `n` make `2^n` and `3^n` feasible, the 64-bit ceiling and what to do beyond it, iteration-order and cache behaviour, readability of terse bit code, how to test enumeration routines, and the failure modes that silently corrupt results.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Feasibility: When `2^n` and `3^n` Are Affordable](#feasibility-when-2n-and-3n-are-affordable)
3. [The 64-Bit Ceiling and Big Masks](#the-64-bit-ceiling-and-big-masks)
4. [Performance: Iteration Order and Cache](#performance-iteration-order-and-cache)
5. [Readability and Maintainability](#readability-and-maintainability)
6. [Testing Enumeration Code](#testing-enumeration-code)
7. [Failure Modes](#failure-modes)
8. [Choosing the Right Enumeration Strategy](#choosing-the-right-enumeration-strategy)
9. [Concurrency and Parallel Enumeration](#concurrency-and-parallel-enumeration)
10. [Numeric and Modular Concerns](#numeric-and-modular-concerns)
11. [Code Examples](#code-examples)
12. [Production Checklist](#production-checklist)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

Bitmask enumeration is so terse that the hard part in production is rarely *writing* the loop — it is knowing whether the loop will finish before the heat death of the universe, whether the mask fits in your integer type, and whether the next engineer can read it. This file is about those engineering concerns:

- Given a time budget, what is the maximum `n` for an `O(2^n)` or `O(3^n)` enumeration?
- What happens at `n = 31`, `n = 63`, `n = 64`? When does a single integer stop being enough?
- How do iteration order and memory layout affect real wall-clock time, given the loop body is the actual cost?
- How do you keep `(s - 1) & mask` from becoming write-only code?
- How do you test something with `2^n` outputs, and what oracle do you compare against?
- What are the silent corruptions (signed shifts, `~` complement, overflow) that pass small tests and break in production?

---

## Feasibility: When `2^n` and `3^n` Are Affordable

The single most important senior skill here is sizing the problem **before** writing code. Assume a rough budget of `10^8`–`10^9` simple operations per second for the inner loop body.

| `n` | `2^n` | `3^n` | `n · 2^n` | Verdict |
|-----|-------|-------|-----------|---------|
| 10 | 1.0·10³ | 5.9·10⁴ | 1.0·10⁴ | trivial |
| 15 | 3.3·10⁴ | 1.4·10⁷ | 4.9·10⁵ | trivial |
| 16 | 6.6·10⁴ | 4.3·10⁷ | 1.0·10⁶ | `3^n` fine |
| 18 | 2.6·10⁵ | 3.9·10⁸ | 4.7·10⁶ | `3^n` borderline |
| 20 | 1.0·10⁶ | 3.5·10⁹ | 2.1·10⁷ | `2^n` fine, `3^n` too slow |
| 22 | 4.2·10⁶ | 3.1·10¹⁰ | 9.2·10⁷ | `2^n` borderline |
| 24 | 1.7·10⁷ | 2.8·10¹¹ | 4.0·10⁸ | `2^n · n` borderline |
| 25 | 3.4·10⁷ | — | 8.4·10⁸ | `2^n` ok, `2^n·n` too slow |
| 28 | 2.7·10⁸ | — | — | `2^n` borderline |
| 30 | 1.1·10⁹ | — | — | `2^n` likely too slow |

**Rules of thumb to memorize:**

- **`O(2^n)`** with a cheap body: feasible to `n ≈ 22–25`.
- **`O(2^n · n)`** (scan bits each mask): feasible to `n ≈ 20–22`.
- **`O(3^n)`** (submask-over-all-masks): feasible to `n ≈ 16–18`.

When the problem's `n` exceeds these, bitmask enumeration is the wrong tool — look for structure (meet-in-the-middle splits the universe and squares the reach: `2^(n/2)` instead of `2^n`, sibling techniques), polynomial algorithms, or approximation.

**Meet-in-the-middle** deserves a sentence: split `n` elements into two halves, enumerate `2^(n/2)` subsets of each (e.g. `2^20` each for `n = 40`), and combine. This converts an infeasible `2^40` into two feasible `2^20` passes — the standard escape hatch when `n` is around 30–45.

---

## The 64-Bit Ceiling and Big Masks

A subset lives in **one integer**, so the universe size is capped by the integer width:

- **32-bit signed int:** `1 << n` is well-defined for `n ≤ 30`; at `n = 31` it hits the sign bit (undefined/negative in C/Java semantics), at `n = 32` it overflows to `0`. Treat **30** as the safe ceiling for 32-bit masks.
- **64-bit signed (`long`/`int64`):** safe to **62**; `1L << 62` is fine, `1L << 63` is the sign bit, `1L << 64` is undefined. In Go and Java, use `uint64`/unsigned shifts to reach 63 if you must.
- **Python:** integers are arbitrary precision, so `1 << n` never overflows — but the *time* `2^n`/`3^n` is the real limit long before width is.

**Beyond one word:** when `n > 64`, a single integer cannot hold the set. Options:

- **Bitset / array of words** — `n` bits across `⌈n/64⌉` words. Set operations become word-wise loops (still very fast). Java `BitSet`, C++ `std::bitset`, Go `math/bits` over a `[]uint64`. Note: you lose the one-instruction `m & -m` and `(s-1)&mask` tricks; submask enumeration over a multi-word mask is rarely what you want anyway, because `2^n` for `n > 64` is astronomically infeasible.
- **Reconsider the algorithm** — if you genuinely need `n > 64` *and* exponential enumeration, the enumeration itself is hopeless; the width limit is a symptom, not the disease.

**Shift hygiene (language-specific):**

- **Go:** shift counts are unsigned; `1 << n` where `n` is `int` is fine, but a shift `≥` width is `0` (defined). Prefer explicit `uint64(1) << n` for wide masks.
- **Java:** `<<` on `int` masks the shift count mod 32 (`1 << 32 == 1`!), and on `long` mod 64. This is a notorious trap: `1 << 35` equals `1 << 3`. Use `1L << n` for `n ≥ 31`.
- **Python:** no width limit, but `-m` of a Python int is mathematically negative; `m & -m` still works because Python uses two's-complement *semantics* for bitwise ops on the infinite-precision value, so the lowest-set-bit identity holds.

---

## Performance: Iteration Order and Cache

The enumeration loops themselves are nearly free; the cost lives in the **body** and in **memory access**.

- **DP tables indexed by mask.** In bitmask DP (sibling `13/06`), `dp[mask]` arrays are large (`2^n` entries). Iterating masks in **increasing** order is cache-friendly because `dp[mask]` is accessed roughly sequentially, and transitions like `dp[mask] -> dp[mask | (1<<i)]` touch nearby-but-larger indices. Iterating submasks of a fixed mask, by contrast, jumps around `dp[]` — that scattered access is the real `3^n` cost, not the arithmetic.

- **Branch prediction.** The all-subsets loop is a tight counted loop the CPU predicts perfectly. The per-bit `if (mask & (1<<i))` inside has ~50% taken rate (poor prediction) — replacing it with a branchless lowbit loop (`m &= m-1`) both reduces iterations and removes the unpredictable branch.

- **Vectorization.** `popcount`/`tzcnt` are single instructions; don't hand-roll them. For SOS (sum-over-subsets) DP, the standard `for i in bits: for mask: if mask has bit i: dp[mask] += dp[mask ^ (1<<i)]` is `O(n · 2^n)` and very cache-friendly (sequential `mask` sweep) — prefer it over the naive `O(3^n)` submask sum when you need sums over *all* submasks of *all* masks.

- **`3^n` vs SOS `n·2^n`.** A crucial senior optimization: if you need, for every mask, an *aggregate* (sum/min/max) over all its submasks, do **not** run the `O(3^n)` double loop — use **SOS DP** in `O(n · 2^n)`. The `3^n` loop is only necessary when each (mask, submask) pair needs *individually distinct* work that cannot be folded into a sweep.

- **Memory ceiling.** `dp[2^n]` of 8-byte values is `2^n · 8` bytes: `n = 24` → 128 MB, `n = 26` → 512 MB. Memory, not time, often caps bitmask DP first.

---

## Readability and Maintainability

Terse bit code rots fast. Senior practices:

- **Wrap the idioms in named helpers** (`forEachSubmask`, `lowestSetBit`, `complement(mask, n)`, `isSubset`). The call site reads as intent; the trick is documented once.
- **Comment the non-obvious lines.** `s = (s - 1) & mask  // next submask of mask, decreasing` saves the next reader a web search.
- **Name masks semantically** — `assigned`, `remaining`, `full`, `chosen` — never `m1`, `m2`.
- **Centralize `full = (1 << n) - 1`** as a constant; deriving it inline invites off-by-one bugs.
- **Make empty-set handling explicit.** A loop that may or may not include `mask == 0` should say so in a comment or by structure.
- **Prefer `for (s = mask; ; s = (s-1)&mask) { ...; if (s==0) break; }`** to include `0` without a duplicated body.

---

## Testing Enumeration Code

`2^n` outputs are too many to eyeball, so test by **properties and oracles**:

- **Count check.** All-subsets enumeration must produce exactly `2^n` masks; submasks of `mask` exactly `2^popcount(mask)`; the double loop exactly `3^n` pairs. Assert these counts.
- **Uniqueness check.** Collect emitted masks into a set; assert no duplicates and full coverage (size equals expected count).
- **Brute-force oracle.** For submasks, the oracle is "all `t` in `[0, 2^n)` with `t & mask == t`." Compare the idiom's output to the filtered brute force for all `mask` up to small `n`.
- **Property tests.** For set algebra: `complement(complement(a)) == a`; `isSubset(a, a)`; `union/intersection` commutativity; `popcount(a) + popcount(complement(a, n)) == n`.
- **Boundary tests.** `n = 0` (one subset, the empty set), `mask = 0` (one submask, itself), `mask = full`, `n` at the type width.
- **Differential test against Gosper's hack** for fixed-size subsets: the filtered set and Gosper's output must match as *sets*.

---

## Failure Modes

| Failure | Symptom | Root cause | Guard |
|---------|---------|-----------|-------|
| Java shift wraparound | `1 << 33` equals `1 << 1` | shift count taken mod 32 on `int` | use `1L << n` for `n ≥ 31`; assert `n < 31` for int masks |
| Sign-bit shift | negative mask, weird loop bounds | `1 << 31` on signed 32-bit | use unsigned or 64-bit |
| Raw `~` complement | huge/negative mask, wrong set | `~a` flips all `w` bits | `a ^ ((1<<n)-1)` |
| Infinite submask loop | hang | `while True` without `if s==0: break` | use the canonical form |
| Missing empty subset | off-by-one results | `while s:` skips `0` | handle `0` explicitly |
| Silent `3^n` blowup | timeout at "small" `n` | mis-sized feasibility (`n = 20` with `3^n`) | size with the feasibility table first |
| Memory OOM | crash at `n ≈ 26` | `dp[2^n]` too large | budget `2^n · sizeof` up front |
| Index/value mix | wrong array element | used `m & -m` as index | convert via trailing-zeros |

---

## Choosing the Right Enumeration Strategy

A recurring senior decision is *which* of the family of subset enumerations to reach for. They look similar but have wildly different costs, and picking wrong is the most common source of "correct but times out."

- **You need to visit every subset once, with independent work per subset.** Use the plain all-subsets loop `for mask in [0, 2^n)`. Cost `O(2^n · body)`. This is the right default for brute force and for the *outer* loop of bitmask DP.

- **You need, for each mask, to consider every way to split off a sub-selection.** Use the submask loop. Classic example: partition DP where `dp[mask]` is built from `dp[mask ^ sub]` for each valid sub-group `sub ⊆ mask`. Cost `O(3^n)`. This is the canonical use of `(s-1)&mask` and is worth recognizing on sight, because the `3^n` total is the difference between feasible (`n ≤ 17`) and not.

- **You need, for each mask, an *aggregate* over its submasks (sum/min/max/OR).** Do **not** use the submask loop. Use **sum-over-subsets (SOS) DP** in `O(n · 2^n)`: start from `g = f`, then for each bit `i`, for each `mask`, if bit `i` is set add `g[mask ^ (1<<i)]` into `g[mask]`. This computes "for every mask, the aggregate of `f` over all submasks" in `n·2^n` instead of `3^n`. The crossover is dramatic: at `n = 18`, `n·2^n ≈ 4.7·10^6` versus `3^n ≈ 3.9·10^8`.

- **You need the *dual* — for each mask, an aggregate over its supersets.** Use the superset variant of SOS (sweep the same bits but add from `mask | (1<<i)`), also `O(n·2^n)`.

- **You need only the subsets of one fixed size `k`.** Use Gosper's hack (sibling `05`) for `O(C(n,k))`, unless `k ≈ n/2` and you value code simplicity, in which case filtering is acceptable.

- **`n` is too large for any of the above (roughly `n > 25`).** Restructure: meet-in-the-middle (split the universe), exploit problem-specific structure, or accept that exact subset enumeration is infeasible and move to approximation or a polynomial reformulation.

A simple decision question to ask yourself: *"Do I need each (mask, submask) pair individually, or just a fold over submasks?"* If a fold, SOS wins; the `O(3^n)` loop is only justified when each pair does genuinely distinct work.

---

## Concurrency and Parallel Enumeration

The all-subsets loop is **embarrassingly parallel**: the masks `0 .. 2^n - 1` are independent, so you can shard the range across worker threads or machines. Two practical patterns:

- **Range sharding.** Give worker `w` of `W` the masks `[w · 2^n / W, (w+1) · 2^n / W)`. Each worker keeps a local accumulator (best sum, count, etc.) and you combine the partials at the end. No shared mutable state inside the loop means no locking.

- **Stride sharding.** Worker `w` processes masks `w, w+W, w+2W, …`. This balances load when the per-mask cost correlates with the mask value (e.g. `popcount`), since consecutive masks land on different workers.

Caveats specific to bitmasks:

- **Submask loops are not trivially shardable.** Sharding the *outer* mask loop is fine, but the inner submask loop for a given mask is a tight dependent sequence (`s` depends on the previous `s`); parallelize across masks, not within a single mask's submask walk.
- **SOS DP has a sequential bit dimension.** The `for i in bits` layers must run in order (layer `i` reads results from layer `i-1`), but within a layer the mask sweep is parallelizable. Parallelize the inner `mask` loop, barrier between bit layers.
- **Reductions, not shared writes.** Whatever you accumulate (max, count, sum mod p) should be a per-worker partial reduced at the end; writing to a shared `best` inside the hot loop serializes everything and destroys the speedup.
- **False sharing.** If workers write to adjacent slots of a shared array (e.g. `partial[w]`), pad each slot to a cache line to avoid cache-line ping-pong.

In Go this is goroutines plus a `sync.WaitGroup` and per-goroutine accumulators; in Java, a parallel stream over the mask range or an `ExecutorService`; in Python, the GIL makes thread-level parallelism pointless for CPU-bound enumeration — use `multiprocessing` with range shards instead.

---

## Numeric and Modular Concerns

Enumeration itself produces no arithmetic, but the *body* usually does, and the body's arithmetic is where overflow and modular bugs live.

- **Subset-sum accumulation overflows fast.** With `n = 20` elements up to `10^9`, a subset sum reaches `2·10^{10}`, well past 32-bit. Use 64-bit accumulators (`int64`/`long`) and budget for `n · max_value` worst case.
- **Counting subsets needs modular arithmetic.** "How many subsets satisfy property P" can itself be up to `2^n`, which fits in 64-bit only to `n ≤ 62`; if you accumulate products (e.g. counts of submask combinations), reduce mod a prime (`10^9 + 7`) after each multiply, exactly as in matrix/DP counting problems.
- **SOS over a modulus.** When `f[mask]` are residues, every SOS addition must be reduced: `g[mask] = (g[mask] + g[mask ^ (1<<i)]) % MOD`. Forgetting this silently overflows after ~30 layers of accumulation on large inputs.
- **Signed remainder.** In Go and Java, `%` can yield negative results for negative operands; if any intermediate count can go negative (e.g. inclusion–exclusion with subtraction over submasks), normalize with `((x % MOD) + MOD) % MOD`.
- **Inclusion–exclusion over submasks.** A frequent body is `Σ_{s ⊆ mask} (-1)^{popcount(mask) - popcount(s)} f[s]`; the alternating sign plus modular reduction is a classic place to get the sign or the normalization wrong. Test it against a brute-force evaluation on small `n`.

---

## Code Examples

### Robust, Documented Enumeration Helpers

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

func fullMask(n int) uint64 { return (uint64(1) << n) - 1 }

// complement within an n-bit universe (NOT raw ^).
func complement(mask uint64, n int) uint64 { return mask ^ fullMask(n) }

// forEachSubmask visits every submask of mask once, including 0.
func forEachSubmask(mask uint64, visit func(uint64)) {
	for s := mask; ; s = (s - 1) & mask {
		visit(s)
		if s == 0 {
			return
		}
	}
}

func main() {
	const n = 4
	if n >= 63 {
		panic("universe too large for a uint64 mask")
	}
	// Property: total (mask, submask) pairs == 3^n.
	total := 0
	for mask := uint64(0); mask <= fullMask(n); mask++ {
		forEachSubmask(mask, func(s uint64) { total++ })
	}
	fmt.Println("pairs:", total, "expected 3^n:", pow(3, n))
	fmt.Println("popcount(0b1011):", bits.OnesCount64(0b1011))
}

func pow(a, b int) int {
	r := 1
	for ; b > 0; b-- {
		r *= a
	}
	return r
}
```

#### Java

```java
public class SeniorEnum {
    static long fullMask(int n) { return (1L << n) - 1; }              // 1L, not 1
    static long complement(long mask, int n) { return mask ^ fullMask(n); }

    interface LongVisitor { void accept(long s); }

    static void forEachSubmask(long mask, LongVisitor v) {
        long s = mask;
        while (true) {
            v.accept(s);
            if (s == 0) return;
            s = (s - 1) & mask;
        }
    }

    public static void main(String[] args) {
        int n = 4;
        if (n >= 62) throw new IllegalArgumentException("universe too large for long mask");
        long[] total = {0};
        for (long mask = 0; mask <= fullMask(n); mask++) {
            forEachSubmask(mask, s -> total[0]++);
        }
        long expected = 1;
        for (int i = 0; i < n; i++) expected *= 3;
        System.out.println("pairs: " + total[0] + " expected 3^n: " + expected);
        System.out.println("popcount(0b1011): " + Long.bitCount(0b1011L));
    }
}
```

#### Python

```python
def full_mask(n):
    return (1 << n) - 1


def complement(mask, n):
    return mask ^ full_mask(n)          # never bare ~mask


def for_each_submask(mask):
    s = mask
    while True:
        yield s
        if s == 0:
            return
        s = (s - 1) & mask


if __name__ == "__main__":
    n = 4
    pairs = sum(1 for mask in range(full_mask(n) + 1)
                for _ in for_each_submask(mask))
    print("pairs:", pairs, "expected 3^n:", 3 ** n)
    print("popcount(0b1011):", (0b1011).bit_count())
```

### Parallel All-Subsets Reduction (range sharding)

Each worker scans a contiguous block of masks, keeps a local best, and the partials are reduced — no shared mutable state inside the loop.

#### Go

```go
package main

import (
	"fmt"
	"sync"
)

// maxSubsetSumUnder finds the largest subset sum <= B, parallelized over masks.
func maxSubsetSumUnder(value []int64, B int64, workers int) int64 {
	n := len(value)
	full := 1 << n
	chunk := (full + workers - 1) / workers
	partials := make([]int64, workers) // one slot per worker (reduce at end)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		lo := w * chunk
		hi := lo + chunk
		if hi > full {
			hi = full
		}
		wg.Add(1)
		go func(w, lo, hi int) {
			defer wg.Done()
			var best int64
			for mask := lo; mask < hi; mask++ {
				var sum int64
				m := mask
				for m != 0 {
					i := m & -m
					idx := 0
					for (1 << idx) != i {
						idx++
					}
					sum += value[idx]
					m &= m - 1
				}
				if sum <= B && sum > best {
					best = sum
				}
			}
			partials[w] = best
		}(w, lo, hi)
	}
	wg.Wait()
	var best int64
	for _, p := range partials {
		if p > best {
			best = p
		}
	}
	return best
}

func main() {
	fmt.Println(maxSubsetSumUnder([]int64{3, 1, 4, 1, 5, 9}, 12, 4)) // 12
}
```

#### Java

```java
import java.util.concurrent.*;

public class ParallelSubsets {
    static long maxSubsetSumUnder(long[] value, long B, int workers) throws Exception {
        int n = value.length, full = 1 << n;
        int chunk = (full + workers - 1) / workers;
        ExecutorService pool = Executors.newFixedThreadPool(workers);
        Future<Long>[] fs = new Future[workers];
        for (int w = 0; w < workers; w++) {
            final int lo = w * chunk, hi = Math.min(lo + chunk, full);
            fs[w] = pool.submit(() -> {
                long best = 0;
                for (int mask = lo; mask < hi; mask++) {
                    long sum = 0;
                    int m = mask;
                    while (m != 0) {
                        int idx = Integer.numberOfTrailingZeros(m);
                        sum += value[idx];
                        m &= m - 1;
                    }
                    if (sum <= B && sum > best) best = sum;
                }
                return best;
            });
        }
        long best = 0;
        for (Future<Long> f : fs) best = Math.max(best, f.get());
        pool.shutdown();
        return best;
    }

    public static void main(String[] args) throws Exception {
        System.out.println(maxSubsetSumUnder(new long[]{3, 1, 4, 1, 5, 9}, 12, 4)); // 12
    }
}
```

#### Python

```python
from multiprocessing import Pool


def _scan(args):
    value, B, lo, hi = args
    n = len(value)
    best = 0
    for mask in range(lo, hi):
        s, m = 0, mask
        while m:
            idx = (m & -m).bit_length() - 1
            s += value[idx]
            m &= m - 1
        if s <= B and s > best:
            best = s
    return best


def max_subset_sum_under(value, B, workers=4):
    full = 1 << len(value)
    chunk = (full + workers - 1) // workers
    jobs = [(value, B, w * chunk, min((w + 1) * chunk, full)) for w in range(workers)]
    with Pool(workers) as p:           # processes: GIL makes threads useless here
        return max(p.map(_scan, jobs))


if __name__ == "__main__":
    print(max_subset_sum_under([3, 1, 4, 1, 5, 9], 12, 4))  # 12
```

---

## Production Checklist

- [ ] Sized `n` against the `2^n` / `3^n` feasibility table; chosen meet-in-the-middle or SOS if needed.
- [ ] Mask type wide enough (`long`/`int64`/`uint64`); asserted `n < width − 1`.
- [ ] Used `1L << n` (Java) / explicit `uint64` (Go) for wide shifts; no shift ≥ width.
- [ ] Complement via `mask ^ ((1<<n)-1)`, never raw `~`.
- [ ] Submask loop in canonical form; empty subset handled deliberately.
- [ ] Built-in `popcount`/`trailing-zeros` instead of hand loops.
- [ ] Memory `2^n · sizeof(entry)` budgeted for any `dp[mask]` table.
- [ ] Count + uniqueness + oracle tests; boundary cases `n=0`, `mask=0`, `mask=full`.
- [ ] If aggregating over all submasks, used SOS `O(n·2^n)` instead of `O(3^n)` where applicable.

---

## Real-World Production Scenarios

Bitmask enumeration is not only a competitive-programming toy; it shows up in production whenever a small, fixed set of options must be combined exhaustively.

- **Feature-flag / configuration combinations.** With `n ≤ 20` boolean flags, you can enumerate every configuration as a mask to find the cheapest valid combination, run exhaustive compatibility checks, or generate a coverage matrix for testing. The all-subsets loop is exactly this.
- **Permission / capability sets.** A role's capabilities form a small bitmask; union/intersection/subset tests (`(a & b) == a`) answer "does this role include all required permissions?" in one instruction. Submask enumeration answers "which sub-roles could a token be downgraded to?"
- **Query planning over a handful of join relations.** Classic Selinger-style join-order DP enumerates connected subsets of relations as masks (`dp[subset]` = best plan for that subset), using submask enumeration to split a subset into two joinable halves — the textbook `O(3^n)` join-order DP, feasible for the ~12–16 relations real planners cap at.
- **Resource allocation / assignment.** Assigning `n` tasks to slots where the chosen-set matters uses mask-as-state DP (sibling `13/06`); the enumeration loops here are the transitions.
- **Hardware register/lane masks.** SIMD lane masks, GPIO pin sets, and interrupt masks are literal bitmasks; the set-bit lowbit loop iterates active lanes/pins efficiently.

The senior judgement is the same in all of these: confirm `n` is genuinely small and fixed (a config with 40 flags is *not* a candidate for `2^n` enumeration), choose all-subsets vs submask vs SOS deliberately, and wrap the bit tricks behind a named, tested API so the domain code reads clearly.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - **Mode 1:** the all-subsets odometer `0 .. 2^n − 1`
> - **Mode 2:** the submask walk `s = (s - 1) & mask`, with a live count proving `2^popcount(mask)` submasks
> - Adjustable `n` and `mask`, Play / Pause / Step / Reset — useful for sanity-checking feasibility sizes interactively

---

## Summary

In production the loops are trivial; the judgement is everything. Size `n` against the table: `2^n` to ~22–25, `2^n·n` to ~20–22, `3^n` to ~16–18 — and reach for meet-in-the-middle or SOS DP when you blow past those. A subset lives in one integer, so respect the width ceiling: 30 for 32-bit, 62–63 for 64-bit, and beware Java's shift-count-mod-width trap (`1 << 32 == 1`) and the raw-`~` complement bug. Wrap the terse idioms in named, commented helpers so the next engineer reads intent, not magic. Test by counts, uniqueness, brute-force oracles, and properties, because you cannot eyeball `2^n` outputs. The failure modes — signed shifts, complement, infinite submask loops, silent `3^n` blowups, and OOM on `dp[2^n]` — all pass tiny tests and bite at scale, so guard them explicitly.

---

## Operational Runbook

When a bitmask enumeration "is slow" or "is wrong" in production, triage in this order:

1. **Confirm the asymptotics match the symptom.** Time the actual `n`. If it is `3^n` at `n ≥ 18` or `2^n` at `n ≥ 26`, the algorithm — not a bug — is the problem; switch to SOS / meet-in-the-middle.
2. **Check the mask type width.** Grep for `1 <<` without an `L`/`uint64`; a wraparound at `n ≥ 31` produces silent garbage that passes small tests.
3. **Check the complement.** Grep for `~` near mask code; replace with `^ full`.
4. **Check empty-subset handling.** If a partition/cover count is off by a predictable factor, the empty submask is likely mishandled.
5. **Re-run the oracle** on small `n` with the production code path, not a simplified copy.
6. **Profile memory.** An OOM near `n ≈ 26` is almost always `dp[2^n]` sizing, not a leak.

Keep the helper library (`forEachSubmask`, `complement`, `fullMask`, `popcount`) and its property tests in the repo so every consumer inherits the correct, tested idioms instead of re-deriving them.

A final senior habit: write the feasibility bound as a comment next to the loop (`// O(3^n); n<=18`). It documents the design assumption and makes the next reviewer reject an input-size increase that would silently blow the budget, rather than discovering it in a production timeout.

---

## Further Reading

- `professional.md` (this topic) — formal `3^n` proof and submask bijection.
- Sibling `05` — Gosper's hack (fixed-size subsets).
- Sibling `13/06-bitmask-dp` — mask-as-state DP and memory sizing.
- cp-algorithms.com — "Sum over subsets DP" (`O(n·2^n)`), "Meet in the middle".
- *Hacker's Delight* (Warren) — shift semantics, population count, complement tricks.
- JLS §15.19 — Java shift-operator semantics (shift count masking).

# Gosper's Hack & Gray Code — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the bit-iteration logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle (`itertools.combinations` for Gosper; a Hamming-distance check for Gray) on small inputs before trusting the bit-trick result.**

---

## Beginner Tasks (5)

### Task 1 — Next combination (one Gosper step)

**Problem.** Implement `nextCombination(x)` that returns the smallest integer larger than `x` with the same number of set bits, using `c=x&-x; r=x+c; (((r^x)>>2)/c)|r`.

**Input / Output spec.**
- Read one integer `x` (`x > 0`).
- Print the next-larger integer with the same popcount.

**Constraints.**
- `1 ≤ x < 2^62`, `popcount(x) ≥ 1`.
- Use integer division (`//` in Python).

**Hint.** `x & -x` isolates the lowest set bit. The division is exact — never use float division.

**Starter — Go.**
```go
package main

import "fmt"

func nextCombination(x uint64) uint64 {
	// TODO: c = x & -x; r = x + c; return (((r ^ x) >> 2) / c) | r
	return 0
}

func main() {
	var x uint64
	fmt.Scan(&x)
	fmt.Println(nextCombination(x))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long nextCombination(long x) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long x = sc.nextLong();
        System.out.println(nextCombination(x));
    }
}
```

**Starter — Python.**
```python
import sys


def next_combination(x):
    # TODO: c = x & -x; r = x + c; return (((r ^ x) >> 2) // c) | r
    return 0


def main():
    x = int(sys.stdin.read().split()[0])
    print(next_combination(x))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `nextCombination(0b0111)` returns `0b1011` (`7 → 11`).
- Result has the same popcount as the input.
- No float division.

---

### Task 2 — Enumerate all k-subsets

**Problem.** Given `n` and `k`, print every bitmask with exactly `k` bits set in `[0, 2^n)`, in increasing order, using the Gosper loop. Print each as an `n`-bit binary string.

**Input / Output spec.**
- Read `n` and `k`.
- Print one mask per line (binary, width `n`).

**Constraints.** `0 ≤ k ≤ n ≤ 20`.

**Hint.** Start at `(1 << k) - 1`, stop when `x >= (1 << n)`. Guard `k = 0` (emit `0`).

**Reference oracle (Python) — use this to validate.**
```python
from itertools import combinations

def oracle_k_subsets(n, k):
    masks = []
    for combo in combinations(range(n), k):
        m = 0
        for b in combo:
            m |= 1 << b
        masks.append(m)
    return sorted(masks)
```

**Evaluation criteria.**
- Output count equals `C(n, k)`.
- Matches `oracle_k_subsets` exactly (same order).
- `k = 0` prints a single all-zero mask.

---

### Task 3 — Binary to Gray and back

**Problem.** Implement `toGray(x) = x ^ (x >> 1)` and `fromGray(g)` (prefix XOR). Read one integer and print both its Gray code and the round-trip recovery.

**Input / Output spec.**
- Read one integer `x`.
- Print `toGray(x)` and `fromGray(toGray(x))` (which must equal `x`).

**Constraints.** `0 ≤ x < 2^62`. Use logical shifts (Java `>>>`).

**Hint.** The inverse XORs all Gray bits at or above each position. Loop: `x=0; while g: x^=g; g>>=1`.

**Evaluation criteria.**
- `toGray(6) = 5`, `fromGray(5) = 6`.
- Round-trip recovers the original for all tested values.
- Logical (not arithmetic) shifts used.

---

### Task 4 — Full Gray sequence with flipped-bit report

**Problem.** Given `n`, print the `n`-bit Gray sequence; for each step (after the first) also print which single bit position flipped from the previous value.

**Input / Output spec.**
- Read `n`.
- Print `2^n` lines: the Gray value (binary, width `n`), and for steps `≥ 1` the flipped bit index.

**Constraints.** `1 ≤ n ≤ 12`.

**Hint.** The flipped bit at step `x` (going from `gray(x-1)` to `gray(x)`) is the lowest set bit of `x`: `ν(x)`. Verify by XOR-ing consecutive Gray values.

**Worked check.** For `n = 3`, the flipped-bit sequence over steps `1..7` is `0,1,0,2,0,1,0` (the ruler sequence). Consecutive Gray values always differ in exactly one bit.

**Evaluation criteria.**
- Consecutive Gray values differ in exactly one bit (assert `popcount(g[i] ^ g[i-1]) == 1`).
- Reported flipped bit equals `ν(x)` and matches the actual XOR difference.
- The sequence is a permutation of `0..2^n−1`.

---

### Task 5 — Count and verify the combination count

**Problem.** Given `n` and `k`, count how many masks the Gosper loop emits and assert it equals `C(n, k)`. Print the count and `C(n, k)` side by side.

**Input / Output spec.**
- Read `n`, `k`.
- Print `emitted_count` and `C(n, k)`.

**Constraints.** `0 ≤ k ≤ n ≤ 30`.

**Hint.** Compute `C(n, k)` independently (Pascal's rule or a product loop) and compare to the loop count. They must match — a mismatch means a wrong start/stop bound or overflow.

**Evaluation criteria.**
- `emitted_count == C(n, k)` for all valid `n, k` including `k = 0` and `k = n`.
- `k > n` emits `0`.
- Independent `C(n, k)` computation avoids overflow (use 64-bit or bigint).

---

## Intermediate Tasks (5)

### Task 6 — Overflow-safe enumeration at n = 63

**Problem.** Enumerate all `k`-subsets for `n` up to `63` without overflow. Stop on the maximal `k`-mask `((1<<k)-1) << (n-k)` *before* calling the hack on it, so `r = x + c` never wraps the 64-bit word.

**Constraints.** `0 ≤ k ≤ n ≤ 63`.

**Hint.** Use unsigned 64-bit (`uint64`, Java `long` treated unsigned). Compute `maxMask` and break when `x == maxMask`.

**Evaluation criteria.**
- For `n = 63, k = 1` emits exactly 63 single-bit masks, the last being `1 << 62`.
- No numeric *decrease* in the sequence (a decrease signals wraparound).
- Matches the oracle for small `n`.

---

### Task 7 — Logarithmic Gray inverse

**Problem.** Implement the `O(log n)` inverse-Gray fold (`g ^= g>>16; g ^= g>>8; …; g ^= g>>1` for 32-bit, extend to 64-bit) and verify it equals the `O(n)` loop for all values in a range.

**Constraints.** Values up to 63 bits.

**Hint.** Each fold doubles the span of bits XORed in. For 64-bit, start the fold at `>> 32`.

**Reference (Python loop oracle).**
```python
def from_gray_loop(g):
    x = 0
    while g:
        x ^= g
        g >>= 1
    return x
```

**Evaluation criteria.**
- Fast fold matches `from_gray_loop` for all `g` in `0..2^16` (and sampled larger values).
- Uses logical shifts.
- `O(log n)` operations, no loop over bits.

---

### Task 8 — Incremental subset-sum via Gray code

**Problem.** Given `n` item weights, walk all `2^n` subsets in Gray order and maintain the running subset sum incrementally — toggling exactly one item per step (add or subtract its weight) — and return the maximum sum seen. Do NOT recompute the sum from scratch each step.

**Constraints.** `1 ≤ n ≤ 22`, weights in `[-10^6, 10^6]`.

**Hint.** At step `x`, the toggled item is `ν(x)` (lowest set bit of `x`). If that bit is now set in `gray(x)`, add its weight; else subtract. Start from the empty subset (sum 0).

**Reference oracle (Python).**
```python
def brute_max_subset_sum(w):
    n = len(w)
    best = 0
    for mask in range(1 << n):
        s = sum(w[i] for i in range(n) if mask & (1 << i))
        best = max(best, s)
    return best
```

**Evaluation criteria.**
- Matches `brute_max_subset_sum` for small `n`.
- Each step does `O(1)` work (one add/subtract), not `O(n)`.
- Correctly identifies which single item toggled.

---

### Task 9 — k-combinations sum to a target

**Problem.** Given `n` values, a size `k`, and a target `T`, count how many `k`-element subsets sum exactly to `T`. Use Gosper to enumerate the `k`-subsets.

**Constraints.** `1 ≤ k ≤ n ≤ 24`, values and `T` fit in 64-bit.

**Hint.** For each Gosper mask, sum the selected values (iterate set bits with `m &= m - 1`). Count matches to `T`.

**Reference oracle (Python).**
```python
from itertools import combinations

def brute_count_k_sum(vals, k, T):
    return sum(1 for c in combinations(vals, k) if sum(c) == T)
```

**Evaluation criteria.**
- Matches `brute_count_k_sum` for small inputs.
- Enumerates exactly `C(n, k)` masks.
- Handles `T` with no matching subset (count 0).

---

### Task 10 — Combinatorial unrank (rank → mask)

**Problem.** Implement `unrank(n, k, m)` that returns the `m`-th `k`-subset mask (0-indexed) in Gosper's increasing order, using the combinatorial number system — *without* iterating from the start. Verify it matches the `m`-th Gosper output.

**Constraints.** `1 ≤ k ≤ n ≤ 40`, `0 ≤ m < C(n, k)`.

**Hint.** Greedily pick the highest element `c` with `C(c, k) ≤ m`, set that bit, subtract `C(c, k)`, decrement `k`, recurse. Build the mask bit by bit.

**Reference check (Python).**
```python
def gosper_nth(n, k, m):
    x = (1 << k) - 1
    for _ in range(m):
        c = x & -x
        r = x + c
        x = (((r ^ x) >> 2) // c) | r
    return x
```

**Evaluation criteria.**
- `unrank(n, k, m) == gosper_nth(n, k, m)` for sampled `m`.
- `unrank` is `O(n)` (no iteration over `m` masks).
- Handles `m = 0` (smallest mask) and `m = C(n,k)-1` (largest mask).

---

## Advanced Tasks (5)

### Task 11 — Big-integer Gosper for n > 63

**Problem.** Enumerate `k`-subsets when `n > 63`, using arbitrary-precision integers. The masks no longer fit in a machine word.

**Constraints.** `64 ≤ n ≤ 100`, but `C(n, k)` kept small (e.g. `k ≤ 2` or `k ≥ n-2`) so the enumeration is feasible.

**Hint.** Python ints are bigints natively. In Go use `math/big`; the lowest set bit is `x.And(x, new(big.Int).Neg(x))` (big.Int models two's complement for bitwise ops). The algorithm is unchanged; only the arithmetic widens.

**Evaluation criteria.**
- For `n = 70, k = 2` emits exactly `C(70,2) = 2415` masks.
- Each mask has popcount `k`; sequence strictly increasing.
- No overflow (true bigint arithmetic).

---

### Task 12 — Revolving-door (combinations) Gray code

**Problem.** Generate all `k`-subsets of `{0..n-1}` in a *minimal-change* order where each step swaps one element for another (Hamming distance 2 on the mask, popcount fixed) — the revolving-door / Eades-McKay ordering. This is distinct from Gosper's numeric order.

**Constraints.** `1 ≤ k ≤ n ≤ 16`.

**Hint.** Implement the classic recursive revolving-door algorithm, or generate masks and order them so consecutive ones differ by removing one element and adding another. Verify each consecutive pair has mask XOR with popcount exactly 2.

**Evaluation criteria.**
- Produces all `C(n, k)` subsets exactly once.
- Consecutive masks differ by exactly one element swap (`popcount(m[i] ^ m[i+1]) == 2`).
- Documents how this differs from Gosper (numeric) and reflected Gray (all sizes, distance 1).

---

### Task 13 — Bitmask DP over fixed-size subsets

**Problem.** Solve a small "assign exactly `k` of `n` workers to `k` tasks for minimum cost" problem. Use Gosper to iterate subsets of workers of each size and a DP indexed by the worker mask, processing masks in increasing-popcount order.

**Constraints.** `1 ≤ k ≤ n ≤ 16`. Cost matrix `cost[worker][task]`.

**Hint.** `dp[mask]` = min cost to assign the workers in `mask` to the first `popcount(mask)` tasks. Transition: for each mask of popcount `j`, the `j`-th task goes to one of the set workers. Iterate masks by popcount with Gosper so dependencies (popcount `j-1`) are ready.

**Evaluation criteria.**
- Matches a brute-force permutation assignment for small `n, k`.
- Masks iterated by increasing popcount via Gosper.
- Correct handling of the empty assignment (`dp[0] = 0`).

---

### Task 14 — Towers of Hanoi via Gray code

**Problem.** Produce the optimal `n`-disk Towers of Hanoi move sequence using the Gray-code connection: the disk moved at step `t` is `ν(t)` (lowest set bit of `t`), and the direction is determined by the parity of the disk and `n`. Output each move as "move disk `d` from peg `a` to peg `b`".

**Constraints.** `1 ≤ n ≤ 16` (so `2^n − 1` moves are printable).

**Hint.** Total moves `= 2^n − 1`. At step `t`, disk `= ν(t)`. The smallest disk cycles among pegs in a fixed rotation (direction depends on `n` parity); the other forced move is the only legal non-smallest-disk move. Cross-check against the recursive Hanoi solution.

**Evaluation criteria.**
- Exactly `2^n − 1` moves; matches the recursive solver move-for-move.
- The disk moved at step `t` equals `ν(t)`.
- Explains the link: the flipped-bit sequence of the Gray code equals the disk-move sequence.

---

### Task 15 — Decide: Gosper vs Gray vs recursion

**Problem.** Given a problem description with constraints `(n, k, requirement)`, classify the best enumeration tool: `GOSPER` (fixed-size, sorted, in-word), `GRAY` (minimal-change / hardware / incremental), `RECURSION` (non-integer elements, heavy pruning, or `n > word`), `BIGINT_GOSPER` (`n > 63` but feasible count), or `INFEASIBLE` (`C(n, k)` astronomically large). Justify each.

**Constraints / cases to handle.**
- Fixed-size subsets, sorted, `n ≤ 63`, feasible count → `GOSPER`.
- All subsets, minimal change / incremental aggregate → `GRAY`.
- Heavy pruning or non-integer elements → `RECURSION`.
- `n = 80`, `k = 2` → `BIGINT_GOSPER`.
- `n = 60`, `k = 30` → `INFEASIBLE` (`C(60,30) ≈ 1.18×10^17`).

**Hint.** Encode the decision rules from `senior.md`. The trap is `INFEASIBLE`: no per-step trick fixes a huge `C(n, k)`.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INFEASIBLE` branch cites the `C(n, k)` magnitude.
- Justification references the right complexity (`O(C(n,k))`, `O(2^n)`, word-size limits).

---

### Task 16 — Combination rank (mask → position)

**Problem.** Implement `rank(n, k, mask)` returning the 0-indexed position of `mask` in Gosper's increasing-order enumeration of `k`-subsets, using the combinatorial number system. This is the inverse of Task 10's `unrank`.

**Input / Output spec.**
- Read `n`, `k`, and a `k`-popcount `mask`.
- Print the rank in `[0, C(n, k))`.

**Constraints.** `1 ≤ k ≤ n ≤ 40`, `popcount(mask) == k`.

**Hint.** List the set bits in decreasing order `c_1 > c_2 > … > c_k` and sum `Σ_i C(c_i, k − i + 1)`. Verify `unrank(n, k, rank(n, k, mask)) == mask` round-trips.

**Reference check (Python).**
```python
def gosper_index(n, k, mask):
    x, idx = (1 << k) - 1, 0
    while x < (1 << n):
        if x == mask:
            return idx
        c = x & -x
        r = x + c
        x = (((r ^ x) >> 2) // c) | r
        idx += 1
    return -1
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func choose(n, r int) int64 {
	if r < 0 || r > n {
		return 0
	}
	if r > n-r {
		r = n - r
	}
	c := int64(1)
	for i := 0; i < r; i++ {
		c = c * int64(n-i) / int64(i+1)
	}
	return c
}

func rank(n, k int, mask uint64) int64 {
	var idx int64
	rem := k
	for pos := n - 1; pos >= 0 && rem > 0; pos-- {
		if mask&(1<<uint(pos)) != 0 {
			idx += choose(pos, rem)
			rem--
		}
	}
	return idx
}

func main() {
	mask := uint64(0b011001) // {0,3,4}
	fmt.Println(rank(6, 3, mask), bits.OnesCount64(mask)) // 7 3
}
```

**Evaluation criteria.**
- `rank` matches `gosper_index` for sampled masks.
- `rank` is `O(k)` (no iteration over masks).
- Round-trips with `unrank` from Task 10.

---

### Task 17 — Gray code for a non-power-of-two range

**Problem.** Generate a cyclic Gray-code-like ordering of `0 … m − 1` for an arbitrary `m` (not necessarily a power of two), such that consecutive values differ in exactly one bit and the sequence wraps (last and first also differ in one bit). When `m` is not a power of two, output a valid *balanced* or *monotonic* Gray code covering exactly `m` codewords.

**Input / Output spec.**
- Read `m`.
- Print `m` codewords (as binary), each differing from the previous in one bit; the cycle must close.

**Constraints.** `2 ≤ m ≤ 4096`, `m` even (a one-bit-change *cycle* requires an even count, since the hypercube is bipartite).

**Hint.** For even `m`, take the standard `n`-bit reflected Gray code (`n = ceil(log2 m)`) and delete a symmetric set of codewords, or use the "subset" construction that drops `2^n − m` codes in mirror-image pairs to preserve the one-bit-change and cyclic properties. Verify Hamming distance 1 between all neighbors including the wrap.

**Evaluation criteria.**
- Exactly `m` distinct codewords.
- Every consecutive pair (including wrap) has Hamming distance 1.
- Rejects/handles odd `m` (no cyclic single-bit-change code exists, since the hypercube is bipartite).

---

## Benchmark Task

### Task B — Gosper vs recursive combination generation

**Problem.** Empirically compare Gosper's hack against a recursive combination generator and (in Python) `itertools.combinations`, for fixed `n` across several `k`. Measure wall-clock time and allocation behavior.

- **(a) Gosper:** the `O(1)`-per-step bitmask loop.
- **(b) Recursive:** a depth-first generator yielding sorted tuples.
- **(c) Library:** `itertools.combinations` (Python) / equivalent.

Measure for `n = 24` across `k ∈ {2, 6, 12, 18, 22}` and report a table; identify where Gosper's allocation-free advantage is largest.

**Starter — Python.**
```python
import time
from itertools import combinations
from typing import List


def next_combination(x: int) -> int:
    c = x & (-x)
    r = x + c
    return (((r ^ x) >> 2) // c) | r


def gosper_count(n: int, k: int) -> int:
    if k == 0:
        return 1
    x, limit, count = (1 << k) - 1, 1 << n, 0
    while x < limit:
        count += 1
        x = next_combination(x)
    return count


def recursive_count(n: int, k: int) -> int:
    # TODO: DFS generator counting C(n, k) combinations
    return 0


def bench(fn, *args) -> float:
    start = time.perf_counter()
    fn(*args)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    n = 24
    print("k     gosper_ms     itertools_ms")
    for k in [2, 6, 12, 18, 22]:
        g = [bench(gosper_count, n, k) for _ in range(3)]
        it = [bench(lambda: sum(1 for _ in combinations(range(n), k))) for _ in range(3)]
        print(f"{k:<5d} {mean_ms(g):<13.2f} {mean_ms(it):<13.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same `n, k` yields the same count `C(n, k)` across Go, Java, Python.
- Gosper is allocation-free (no per-item object); report its advantage where `C(n, k)` is largest (mid `k`).
- Report includes the mean across at least 3 runs and does not time setup.
- Writeup: a short note on where Gosper wins (hot loops, no allocation) and where recursion/library wins (clarity, pruning, non-integer elements).

---

## General Guidance for All Tasks

- **Always validate against an oracle first.** Gosper → `itertools.combinations`; Gray → assert consecutive Hamming distance is 1 and the sequence is a permutation. Run on small `n, k`, diff, then trust at scale.
- **Use integer division in Gosper.** In Python `//`; in Go/Java integer `/` on integer types is already integer division. Never let a float intermediate in.
- **Guard `k = 0`.** The empty subset is the only 0-subset; calling the hack divides by zero.
- **Get start/stop right.** Start at `(1 << k) - 1`, stop at `1 << n`. A wrong bound truncates or loops forever.
- **Use logical shifts and unsigned types.** Go `uint64`, Java `>>>`, Python explicit width-masking — arithmetic shifts corrupt Gray code near the top bit.
- **Mind overflow at `n` near the word width.** Reserve a sentinel bit (`n ≤ 63` for 64-bit) or stop on the maximal mask before the boundary call; use bigints for `n > 63`.
- **The wall is `C(n, k)`, not the per-step cost.** Both tricks are output-optimal; a huge count is infeasible regardless. Estimate `C(n, k)` before enumerating.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.

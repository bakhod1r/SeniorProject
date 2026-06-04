# XOR Pairing & XOR Identities — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the XOR logic and validate against the evaluation criteria.
> **Always test against a brute-force counting oracle on small inputs before trusting the XOR result — XOR is parity-blind, so a violated precondition fails silently.**

---

## Beginner Tasks (5)

### Task 1 — Single number (others appear twice)

**Problem.** Given a non-empty array where every element appears exactly twice except one, return the element that appears once. Use XOR-all (`O(n)` time, `O(1)` space).

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print the single element.

**Constraints.**
- `1 ≤ n ≤ 10^6`, `n` odd, values fit in 32 bits (may be negative).
- Exactly one element has odd count.

**Hint.** Seed an accumulator at `0` and fold each value with `^`. Pairs cancel via `x ^ x = 0`.

**Starter — Go.**
```go
package main

import "fmt"

func singleNumber(nums []int) int {
	// TODO: fold with XOR; return the accumulator
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	nums := make([]int, n)
	for i := range nums {
		fmt.Scan(&nums[i])
	}
	fmt.Println(singleNumber(nums))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int singleNumber(int[] nums) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();
        System.out.println(singleNumber(nums));
    }
}
```

**Starter — Python.**
```python
import sys


def single_number(nums):
    # TODO: fold with XOR
    return 0


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    nums = [int(next(data)) for _ in range(n)]
    print(single_number(nums))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct survivor, verified against a `Counter` oracle on small inputs.
- `O(1)` space (one accumulator, no set/map).
- Handles negatives and a single-element array.

---

### Task 2 — Missing number in [0..n]

**Problem.** Given an array of `n` distinct integers from `[0..n]` with exactly one missing, return the missing value. Use XOR (overflow-proof), not the Gauss sum.

**Input / Output spec.**
- Read `n`, then `n` integers (a permutation of `[0..n]` with one missing).
- Print the missing value.

**Constraints.** `1 ≤ n ≤ 10^6`, values in `[0, n]`.

**Hint.** XOR every index `0..n` with every array value. Present values cancel their index; the missing one survives. Remember to include index `n` (seed `acc = n`).

**Reference oracle (Python) — use this to validate.**
```python
def brute_missing(nums):
    present = set(nums)
    for v in range(len(nums) + 1):
        if v not in present:
            return v
    raise ValueError("nothing missing")
```

**Evaluation criteria.**
- Matches `brute_missing` for random inputs.
- No overflow (do not compute `n(n+1)/2`).
- `O(n)` / `O(1)`.

---

### Task 3 — XOR of a range [a..b]

**Problem.** Given `a` and `b` (`0 ≤ a ≤ b`), compute `a ^ (a+1) ^ … ^ b` in `O(1)` using the period-4 closed form.

**Input / Output spec.**
- Read `a` and `b`.
- Print the XOR of the inclusive range.

**Constraints.** `0 ≤ a ≤ b ≤ 10^9`.

**Hint.** Implement `xorUpTo(n)` returning `[n, 1, n+1, 0][n % 4]`, then `xorUpTo(b) ^ xorUpTo(a-1)`. Define `xorUpTo(-1) = 0`.

**Worked check.** `xorUpTo(7) = 0` (since `7 % 4 == 3`), so `XOR(0..7) = 0`. `XOR(3..9) = xorUpTo(9) ^ xorUpTo(2)`.

**Evaluation criteria.**
- `xorUpTo(n)` matches a loop `⊕_{i=0}^{n} i` for `n ≤ 1000`.
- `xorRange(a, b)` matches a brute loop for small ranges.
- `O(1)` (no loop over the range).

---

### Task 4 — Toggle and query a single bit

**Problem.** Implement `toggle(x, i)` that flips bit `i` of `x`, and `getBit(x, i)` that returns bit `i`. Use XOR for the toggle.

**Input / Output spec.**
- Read `x`, then a sequence of operations `T i` (toggle) or `G i` (get), terminated by `E`.
- For each `G i`, print the bit; after `E`, print the final `x`.

**Constraints.** `0 ≤ x < 2^31`, `0 ≤ i < 31`.

**Hint.** `toggle(x, i) = x ^ (1 << i)`. `getBit(x, i) = (x >> i) & 1`. Toggling the same bit twice returns the original (self-inverse).

**Evaluation criteria.**
- Toggling bit `i` twice is a no-op.
- `getBit` agrees with the binary representation.
- Uses `^` (not `&`/`|` reset-then-set) for the toggle.

---

### Task 5 — Gray code generation

**Problem.** Print the Gray code sequence for `m`-bit numbers: `gray(0), gray(1), …, gray(2^m - 1)` where `gray(x) = x ^ (x >> 1)`. Also verify consecutive codes differ in exactly one bit.

**Input / Output spec.**
- Read `m`.
- Print the `2^m` Gray codes (as integers or `m`-bit binary), one per line.

**Constraints.** `1 ≤ m ≤ 16`.

**Hint.** `gray(x) = x ^ (x >> 1)`. Assert `popcount(gray(x) ^ gray(x+1)) == 1` for each consecutive pair.

**Evaluation criteria.**
- `gray(x) ^ gray(x+1)` always has exactly one set bit.
- The sequence is a permutation of `[0, 2^m)`.
- `gray_to_binary(gray(x)) == x` (round trip via prefix-XOR inverse).

---

## Intermediate Tasks (5)

### Task 6 — Single number when others appear three times

**Problem.** Given an array where every element appears exactly three times except one (appears once), return the single element. Use the two-accumulator mod-3 technique (`O(1)` space).

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print the single element.

**Constraints.** `1 ≤ n ≤ 10^6`, `n ≡ 1 (mod 3)`, values fit in 32 bits.

**Hint.** `ones = (ones ^ x) & ~twos; twos = (twos ^ x) & ~ones`. Return `ones`. In Go use `&^` for AND-NOT. In Python mask to 32 bits if inputs may be negative.

**Reference oracle (Python).**
```python
from collections import Counter


def brute_single_thrice(nums):
    for v, c in Counter(nums).items():
        if c == 1:
            return v
    raise ValueError("no single")
```

**Evaluation criteria.**
- Matches `brute_single_thrice` for random inputs.
- `O(1)` space (two accumulators, no map).
- Correct for the value `0` as the single element.

---

### Task 7 — Two distinct single numbers (split by a set bit)

**Problem.** Given an array where exactly two elements appear once and all others appear twice, return the two singles in any order. Use XOR-all then partition by a differing bit.

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print the two singles (any order).

**Constraints.** `2 ≤ n ≤ 10^6`, `n` even, the two singles are distinct.

**Hint.** `xorAll = ⊕ nums`; `diff = xorAll & (-xorAll)`; partition on `x & diff`; XOR each group. Assert `xorAll != 0` (else the two "singles" are equal — precondition violated).

**Reference oracle (Python).**
```python
from collections import Counter


def brute_two_singles(nums):
    return sorted(v for v, c in Counter(nums).items() if c == 1)
```

**Evaluation criteria.**
- Matches `brute_two_singles` (as a set) for random inputs.
- Uses `x & (-x)` to isolate the splitting bit.
- `O(n)` / `O(1)`.

---

### Task 8 — Subarray XOR queries (prefix XOR)

**Problem.** Given an array and `Q` queries `(l, r)`, answer `XOR of nums[l..r]` (inclusive) for each in `O(1)` after `O(n)` preprocessing.

**Input / Output spec.**
- Read `n`, the array, then `Q`, then `Q` pairs `(l, r)`.
- Print the answer to each query on its own line.

**Constraints.** `1 ≤ n, Q ≤ 10^5`, `0 ≤ l ≤ r < n`.

**Hint.** Build `pre[0]=0`, `pre[i+1]=pre[i]^nums[i]`. Answer `pre[r+1] ^ pre[l]`. The shared prefix cancels (self-inverse).

**Reference oracle (Python).**
```python
def brute_subarray_xor(nums, l, r):
    acc = 0
    for i in range(l, r + 1):
        acc ^= nums[i]
    return acc
```

**Evaluation criteria.**
- Each query matches `brute_subarray_xor`.
- Preprocessing is `O(n)`, each query `O(1)`.
- Correct off-by-one convention (`pre[r+1] ^ pre[l]`).

---

### Task 9 — Count subarrays with XOR equal to K

**Problem.** Given an array and a target `K`, count the number of subarrays whose XOR equals `K`. Use prefix XOR plus a hash map of seen prefixes (`O(n)`).

**Input / Output spec.**
- Read `n`, the array, then `K`.
- Print the count of qualifying subarrays.

**Constraints.** `1 ≤ n ≤ 10^5`, values and `K` fit in 32 bits.

**Hint.** For each prefix `p`, a left boundary works iff an earlier prefix equals `p ^ K` (self-inverse). Maintain `cnt[prefix]` (seed `cnt[0]=1`), add `cnt[p ^ K]`, then record `p`.

**Reference oracle (Python).**
```python
def brute_count_xor_k(nums, K):
    n, total = len(nums), 0
    for i in range(n):
        acc = 0
        for j in range(i, n):
            acc ^= nums[j]
            if acc == K:
                total += 1
    return total
```

**Evaluation criteria.**
- Matches `brute_count_xor_k` for small inputs.
- Single pass with a hash map, `O(n)`.
- Correctly seeds `cnt[0] = 1` (prefix-of-length-0 case).

---

### Task 10 — Find the duplicate via XOR

**Problem.** An array of length `n+1` contains every integer in `[0..n-1]` exactly once plus one value repeated a second time. Return the duplicated value using XOR (`O(1)` space).

**Input / Output spec.**
- Read `m` (`= n+1`), then `m` integers.
- Print the duplicated value.

**Constraints.** `2 ≤ m ≤ 10^6`, values in `[0, m-2]`.

**Hint.** XOR all array values with all of `0..m-2`. Everything cancels except the duplicate (twice in array + once in range = odd total → survives). Mirror of the missing-number trick.

**Reference oracle (Python).**
```python
from collections import Counter


def brute_duplicate(nums):
    for v, c in Counter(nums).items():
        if c == 2:
            return v
    raise ValueError("no duplicate")
```

**Evaluation criteria.**
- Matches `brute_duplicate` for random inputs.
- `O(n)` / `O(1)`, overflow-proof.
- Works when the duplicate is `0`.

---

## Advanced Tasks (5)

### Task 11 — RAID-style parity reconstruction

**Problem.** Given `m` equal-length data blocks (arrays of bytes), compute the XOR parity block. Then simulate the loss of each block in turn and reconstruct it from the parity and the surviving blocks. Verify the reconstruction equals the original.

**Input / Output spec.**
- Read `m` and block length `L`, then `m` blocks of `L` bytes.
- Print `OK` if every single-block reconstruction round-trips, else `FAIL`.

**Constraints.** `2 ≤ m ≤ 32`, `1 ≤ L ≤ 10^5`.

**Hint.** Parity `P[i] = ⊕_k block_k[i]`. Reconstruct lost block `j`: `block_j[i] = P[i] ^ (⊕_{k≠j} block_k[i])`. Correctness rests on self-inverse.

**Evaluation criteria.**
- Every single-block loss reconstructs exactly (round-trip diff is zero).
- Implements in-place parity update `P ^= old ^ new` for a block change and verifies it.
- Documents that two simultaneous losses are unrecoverable (one equation, two unknowns).

---

### Task 12 — Generalized single number (others appear k times)

**Problem.** Implement `singleAmongKReps(nums, k)`: every element appears exactly `k` times except one (appears once); return the single one. Use per-bit counting mod `k` (works for any `k ≥ 2`).

**Input / Output spec.**
- Read `k`, `n`, then `n` integers.
- Print the single element.

**Constraints.** `2 ≤ k ≤ 10`, `1 ≤ n ≤ 10^6`, values in `[0, 2^31)`.

**Hint.** For each of the 32 bit positions, sum the bit over all elements and take `mod k`; the result is the single element's bit. (`O(32n)`; the `k=2` case reduces to XOR-all, `k=3` to the two-accumulator machine.)

**Reference oracle (Python).**
```python
from collections import Counter


def brute_single_k(nums, k):
    for v, c in Counter(nums).items():
        if c % k != 0:
            return v
    raise ValueError("no single")
```

**Evaluation criteria.**
- Matches `brute_single_k` for `k ∈ {2,3,4,5}` on random inputs.
- Generic in `k` (not hard-coded to 2 or 3).
- Correct for the single value `0`.

---

### Task 13 — XOR set fingerprint with a strong hash

**Problem.** Implement an order-independent, incrementally updatable set fingerprint: `fingerprint(S) = ⊕_{e ∈ S} H(e)` for a strong 64-bit hash `H`. Support `add`, `remove` (self-inverse), and equality checks between two sets.

**Input / Output spec.**
- Read operations `ADD e`, `REM e`, `EQ` (compare two maintained sets), `END`.
- Print the boolean result of each `EQ`.

**Constraints.** Up to `10^6` operations; `H` must be a documented 64-bit mixer (e.g. splitmix64).

**Hint.** `add`/`remove` both do `acc ^= H(e)` (self-inverse makes remove the inverse of add). Equal fingerprints strongly suggest equal *sets*. Document the caveat: even-multiplicity elements cancel, so this fingerprints a set, not a multiset.

**Evaluation criteria.**
- `add` then `remove` of the same element restores the fingerprint.
- Reordering operations yields the same fingerprint (order-independence test).
- Writeup notes the set-vs-multiset limitation and the (rare) collision possibility.

---

### Task 14 — Maximum XOR subarray query budget (prefix + structure)

**Problem.** Given an array, answer `Q` queries each asking for the XOR of `nums[l..r]`, with point updates `set(i, v)` interleaved. Support both in `O(log n)` per operation using a Fenwick (BIT) tree over XOR.

**Input / Output spec.**
- Read `n`, the array, then `Q` operations: `Q l r` (range XOR) or `U i v` (set index `i` to `v`).
- Print each range-XOR result.

**Constraints.** `1 ≤ n, Q ≤ 10^5`.

**Hint.** XOR is an invertible group operation, so a Fenwick tree storing prefix XORs supports point update (`U i v`: apply `^= old ^ v` along the tree) and prefix query; range `[l..r]` is `prefixXor(r) ^ prefixXor(l-1)`. Track the current value at each index to compute the update delta.

**Evaluation criteria.**
- Range queries match a brute recompute after each update for small inputs.
- Update and query are both `O(log n)`.
- Uses self-inverse for the update delta (`old ^ new`), not a full rebuild.

---

### Task 15 — Decide when XOR is the wrong tool

**Problem.** Given a problem description with constraints `(structure, query_type)`, implement `classify(problem)` returning one of: `XOR_ALL`, `MOD_K`, `TWO_SINGLES`, `PREFIX_XOR`, or `IMPOSSIBLE_WITH_XOR` (e.g. recover exact counts, distinguish "single is 0" from "no single", detect reordering, or separate three-plus singles with one bit). Justify each decision.

**Constraints / cases to handle.**
- Others appear twice, one single → `XOR_ALL`.
- Others appear `k` times, one single → `MOD_K`.
- Exactly two distinct singles → `TWO_SINGLES`.
- Subarray/range XOR queries → `PREFIX_XOR`.
- Need counts / multiplicity / three-plus singles by one bit / tamper detection → `IMPOSSIBLE_WITH_XOR`.

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The `IMPOSSIBLE` branch is the trap: XOR is parity-blind and linear, so it cannot recover counts, distinguish 0-vs-none, detect order, or separate 3+ singles with a single bit (needs the XOR basis of `06-binary-trie-xor-basis`).

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `IMPOSSIBLE_WITH_XOR` branch cites parity-blindness / linearity explicitly.
- Justification references the correct complexity (`O(n)`/`O(1)` for the solvable cases).

---

## Benchmark Task

### Task B — XOR-all vs hash set: time and memory

**Problem.** Empirically compare the single-number solutions for a fixed array size `n`:

- **(a) XOR-all:** one pass, one accumulator — `O(n)` time, `O(1)` space.
- **(b) Hash set:** add/remove on first/second sighting, leftover is the single — `O(n)` time, `O(n)` space.
- **(c) Sort then scan:** `O(n log n)` time.

Measure wall-clock time and peak extra memory for `n ∈ {10^4, 10^5, 10^6, 10^7}` on a seeded random array (every value twice plus one single). Report a table and identify where the hash set's memory becomes the bottleneck.

**Starter — Python.**
```python
import random
import time
from functools import reduce
from operator import xor
from typing import List

def gen_pairs(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    base = [r.randint(0, 2**31 - 1) for _ in range(n)]
    arr = base + base + [123456789]   # everything twice plus one single
    r.shuffle(arr)
    return arr


def xor_all(nums):
    return reduce(xor, nums, 0)


def hash_set_single(nums):
    seen = set()
    for x in nums:
        if x in seen:
            seen.discard(x)
        else:
            seen.add(x)
    # TODO: return the remaining element
    return next(iter(seen)) if seen else 0


def sort_scan_single(nums):
    s = sorted(nums)
    # TODO: scan adjacent pairs; return the unpaired element
    i = 0
    while i + 1 < len(s):
        if s[i] != s[i + 1]:
            return s[i]
        i += 2
    return s[-1]


def bench(fn, nums) -> float:
    start = time.perf_counter()
    fn(nums)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n            xor_ms       hashset_ms    sort_ms")
    for n in [10_000, 100_000, 1_000_000, 10_000_000]:
        nums = gen_pairs(n, 42)
        rx = [bench(xor_all, nums) for _ in range(3)]
        rh = [bench(hash_set_single, nums) for _ in range(3)]
        rs = [bench(sort_scan_single, nums) for _ in range(3)]
        print(f"{len(nums):<12d} {mean_ms(rx):<12.2f} {mean_ms(rh):<13.2f} {mean_ms(rs):<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- All three methods agree on the single element.
- XOR-all is fastest and uses `O(1)` extra memory; the hash set's memory grows with `n` (report peak).
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on why XOR-all wins on memory and never overflows.

---

## General Guidance for All Tasks

- **Always validate against the counting oracle first.** Every task above ships with (or references) a `Counter`-based oracle. Run it on small inputs, diff, and only then trust the XOR version at scale.
- **Pin constants as named values.** Use a documented 32-bit mask (`0xFFFFFFFF`) and hash constant where needed; never inline magic numbers.
- **Seed the accumulator at the identity `0`.** XOR-all over an empty array must return `0`; the seed documents the identity element.
- **Match the trick to the multiplicity.** Twice → XOR-all; `k` times → count bits mod `k`; two singles → split by `x & -x`.
- **Mind precedence and signedness.** Parenthesize `^` expressions (it binds loosely). In Python mask negatives to a fixed width; in Java/Go beware signed shifts (`>>>` vs `>>`).
- **Never use XOR where you need counts or integrity.** XOR is parity-blind and linear: it cannot recover multiplicity (use a counter) or detect tampering (use a MAC) — Task 15 is the trap.
- **Reuse the building blocks.** `xorAll`, `xorUpTo`, `prefixXor`, and `gray` cover most of the surface; write them once, test them hard, and compose.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.

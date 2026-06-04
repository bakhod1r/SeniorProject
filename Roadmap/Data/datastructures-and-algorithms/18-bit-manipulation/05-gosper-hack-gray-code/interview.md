# Gosper's Hack & Gray Code — Interview Preparation

Gosper's hack and Gray code are favourite interview topics because each rewards a single crisp insight — *"`c=x&-x; r=x+c; x=(((r^x)>>2)/c)|r` gives the next same-popcount integer"* and *"`g = x ^ (x>>1)` flips exactly one bit per step"* — and then tests whether you can (a) explain *why* they work, (b) write the enumeration loop with the right start/stop/guard, (c) recognize the one-bit-change order as a Hamiltonian walk on the hypercube, and (d) avoid the classic traps (float division in Gosper, signed shifts in Gray, treating Gray as numeric order). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Next integer with the same popcount | Gosper: `c=x&-x; r=x+c; (((r^x)>>2)/c)|r` | `O(1)` |
| Enumerate all `k`-subsets of `n` (sorted) | Gosper loop from `(1<<k)-1` to `1<<n` | `O(C(n,k))` |
| Binary index → Gray value | `g = x ^ (x >> 1)` | `O(1)` |
| Gray value → binary index | prefix XOR: `while g: x^=g; g>>=1` | `O(n)` / `O(log n)` |
| Generate `n`-bit Gray sequence | iterate `gray(0..2^n−1)` | `O(2^n)` |
| Which element toggles at step `x` | lowest set bit of `x`: `ν(x)` | `O(1)` |
| **Count *simple* fixed-size subsets** | Gosper (sorted) or `combinations` | `O(C(n,k))` |

Core formulas (memorize):

```text
gosper(x):   c = x & -x;  r = x + c;  return (((r ^ x) >> 2) / c) | r   # // in Python
gray(x):     return x ^ (x >> 1)
ungray(g):   x = 0; while g: x ^= g; g >>= 1; return x
```

Enumeration loop:

```text
x = (1 << k) - 1            # smallest k-subset (k lowest bits)
while x < (1 << n):         # stop when a bit spills past position n-1
    use(x)
    if x == 0: break        # k == 0 guard (else divide by zero)
    x = gosper(x)
# O(1) per step, O(C(n,k)) total
```

Key facts:
- Gosper's masks are in **increasing numeric** (= lexicographic) order; Gray's are in **one-bit-change** order.
- `(1 << k) - 1` is the start; `1 << n` is the stop; guard `k = 0`.
- Gosper's `/c` is an **exact integer** division — never float.
- Gray code is a **Hamiltonian cycle** on the hypercube; the flipped bit at step `x` is `ν(x)` (lowest set bit).

---

## Junior Questions (12 Q&A)

### J1. What does Gosper's hack compute?
Given an integer `x` with exactly `k` set bits, it returns the smallest integer larger than `x` that also has exactly `k` set bits. It lets you walk all `k`-subsets (combinations) of an `n`-element set in increasing numeric order.

### J2. What is a Gray code?
An ordering of the numbers `0 … 2^n − 1` in which consecutive values differ in exactly one bit. The standard one (reflected binary Gray code) is computed by `g = x ^ (x >> 1)`.

### J3. How do you convert a counter value to its Gray code?
`gray(x) = x ^ (x >> 1)` — XOR the number with itself shifted right by one. That single operation flips at most... exactly one bit relative to the previous Gray value.

### J4. How do you invert a Gray code back to the index?
Prefix XOR: `x = 0; while g: x ^= g; g >>= 1; return x`. Each binary bit is the XOR of all Gray bits at or above its position.

### J5. What is `x & -x`?
It isolates the lowest set bit of `x` (its value, a power of two). It relies on two's complement: `-x = ~x + 1`. Gosper uses it as `c`, the lowest set bit.

### J6. What is the starting value for enumerating `k`-subsets?
`(1 << k) - 1` — the `k` lowest bits set. That is the numerically smallest integer with popcount `k`.

### J7. What is the stop condition?
`x < (1 << n)`. Once the mask reaches or exceeds `1 << n`, a set bit has moved past position `n − 1`, meaning all `C(n, k)` combinations have been produced.

### J8. Why must you guard `k = 0`?
With `k = 0` the only subset is the empty mask `0`, and `c = 0 & -0 = 0`, so the division `/c` would be a division by zero. Emit `0` and stop instead.

### J9. Why is Gosper's division an integer division?
The quantity `(r ^ x) >> 2` is always an exact multiple of `c`, so the division leaves no remainder. In Python you must use `//`; using `/` produces a float and corrupts the mask.

### J10. Is the Gray sequence in numeric order?
No. It is a permutation of `0 … 2^n − 1` in one-bit-change order. If you need the integer index, apply the inverse (prefix XOR).

### J11. How many bits change per step in Gray code vs plain counting?
Gray: always exactly one. Plain counting: up to `n` (e.g. `0111 → 1000` flips four bits). That one-bit guarantee is why encoders use Gray code.

### J12 (analysis). What is the time cost per Gosper step and per Gray conversion?
Both are `O(1)` — a handful of bit/arithmetic operations. Enumerating all combinations is `O(C(n, k))` and the full Gray sequence is `O(2^n)`: the cost equals the output size.

---

## Middle Questions (12 Q&A)

### M1. Walk through Gosper's formula term by term.
`c = x & -x` is the lowest set bit (start of the lowest block of ones). `r = x + c` ripples that block up by one position (clears the block, sets the bit just above). `r ^ x` marks the changed bits (a run of block-length+1 ones). `(((r ^ x) >> 2) / c)` repacks the freed lower ones at the bottom. OR-ing with `r` assembles the minimal next mask with the same popcount.

### M2. Why does `r = x + c` produce a ripple carry?
Because the lowest block is consecutive ones starting at the lowest set bit. Adding the lowest bit `c` carries through all of them, turning the whole block to zero and setting the single bit just above the block.

### M3. Prove the Gosper result has the same popcount.
`r` has `k − b + 1` ones (cleared a `b`-length block, set one bit). The repack term adds back `b − 1` ones at the bottom. Total `(k − b + 1) + (b − 1) = k`. Popcount preserved.

### M4. Why is the result the *smallest* larger same-popcount integer?
You must advance the lowest block's top bit (the smallest possible increase that keeps popcount), and place the freed ones at the rightmost positions to keep the value minimal. That is exactly what the formula does. Full proof in `professional.md`.

### M5. Prove consecutive Gray values differ in one bit.
Incrementing `x` flips a low run `R = 2^{ν+1} − 1` of bits. The Gray difference is `g_{x+1} ⊕ g_x = R ⊕ (R >> 1) = 2^ν`, a single bit. So exactly one bit changes — at position `ν`, the lowest set bit of `x+1`.

### M6. How do you know *which* bit flips at a Gray step?
It is `ν(x)`, the index of the lowest set bit of the counter `x` (the ruler sequence). This lets you toggle exactly one element without diffing the two masks.

### M7. What is the reflected construction of the Gray code?
`G_n = (0 · G_{n−1})` followed by `(1 · reverse(G_{n−1}))`: the `(n−1)`-bit code with a leading `0`, then the *reversed* `(n−1)`-bit code with a leading `1`. The reflection makes the seam differ in only the new top bit.

### M8. Why use Gosper over recursive combination generation?
Gosper is `O(1)` per item with zero allocation and yields masks in sorted order — ideal inside a hot bitmask-DP loop. Recursion is better when elements aren't small integers, `n` exceeds the word width, or you can prune whole subtrees.

### M9. What is the inverse-Gray doubling trick and why is it `O(log n)`?
`g ^= g>>16; g ^= g>>8; g ^= g>>4; g ^= g>>2; g ^= g>>1` folds the prefix XOR in logarithmically many steps (each fold doubles the span covered), versus the `O(n)` bit-by-bit loop.

### M10. How does Gray order relate to subset enumeration?
Each one-bit change adds or removes exactly one element, so the Gray sequence visits every subset once, toggling one element per step — a Hamiltonian path on the hypercube. This enables `O(1)` incremental aggregate updates.

### M11. What's the difference between submask iteration and Gosper enumeration?
Submask iteration (`s = (s-1) & mask`) enumerates all subsets *of a given mask* (`O(3^n)` across all masks). Gosper enumerates fixed-size subsets *of the universe* (`O(C(n,k))`). Different sets, different costs.

### M12 (analysis). What bounds the cost of enumerating `k`-subsets?
The count `C(n, k)` itself, not the per-step work. Gosper makes each step `O(1)`, but `C(40, 20) ≈ 1.4×10^11` is infeasible regardless. The technique is output-optimal, not a way to dodge a huge output.

---

## Senior Questions (10 Q&A)

### S1. How do you handle overflow at the top of the Gosper range?
Reserve a sentinel bit: require `n ≤ word_width − 1` so `r = x + c` always has room to carry. Or detect the maximal `k`-mask `((1<<k)-1) << (n-k)` and stop *before* calling the hack on it. For `n ≥ word_width`, switch to a 128-bit type or bigint.

### S2. What signed-vs-unsigned issues affect Gray code?
`x >> 1` on a signed value with the top bit set is an *arithmetic* (sign-extending) shift, corrupting both `gray` and the inverse. Use unsigned types in Go, `>>>` in Java, or explicit width-masking in Python. The bug only appears near `2^{w-1}`, so stress-test at `n = 63`.

### S3. When is recursion better than Gosper?
When elements are not small integers (strings/objects), when `n` exceeds the word width, or when the search prunes heavily — a recursive generator can abandon whole subtrees, which the flat Gosper loop cannot since it always emits the full `C(n, k)`.

### S4. Why do hardware encoders use Gray code?
Because only one track changes per position step, a sensor sampling mid-transition is at most off by one position — a bounded, recoverable error. Plain binary can flip many bits "at once," and a mid-transition read can be wildly wrong. Same reason async-FIFO pointers are Gray-coded across clock domains.

### S5. How would you parallelize enumeration of all `k`-subsets?
Use combinatorial unranking: convert a rank `m` to its mask via the combinatorial number system, then run Gosper from there. Split the `[0, C(n,k))` rank range into contiguous shards, one per worker; each runs the identical `O(1)` step. Far cleaner than parallelizing a recursive generator.

### S6. How do you test these when the universe is large?
Compare Gosper's output to `itertools.combinations` for small `n`. Assert: count equals `C(n,k)`, every mask has popcount `k`, masks strictly increase. For Gray: Hamming distance 1 between neighbors, the sequence is a permutation of `0..2^n−1`, and `inverse(gray(x)) == x`. Stress at `n = 63` to catch boundary bugs.

### S7. How is the towers-of-Hanoi sequence related to Gray code?
The disk moved at step `t` of optimal Hanoi is `ν(t)` — the lowest set bit of `t` — which is exactly the bit that flips between Gray indices `t−1` and `t`. Both encode "the lowest position that rolls over when incrementing." The Hanoi state after `t` moves corresponds to `gray(t)`.

### S8. What is the revolving-door (combinations) Gray code?
A minimal-change ordering of *fixed-size* subsets where each step swaps one element for another (Hamming distance 2 on the mask, popcount fixed). Distinct from both Gosper (numeric order, multi-bit jumps) and the reflected Gray code (all popcounts, distance 1). Use it when you want fixed-size subsets *and* minimal change.

### S9. Why is Gosper output-optimal?
Any algorithm emitting all `C(n,k)` combinations needs `Ω(C(n,k))` time just to output them, and `Ω(1)` per distinct item. Gosper matches both with the smallest constant and `O(1)` extra space — there is no asymptotic improvement possible over the output size.

### S10 (analysis). When does the `O(1)`-per-step claim break down?
When `n` exceeds the machine word width. Then masks are bigints and each operation costs `O(n / w)` on `⌈n/w⌉` words, so a step is `O(n/w)`, not `O(1)`. Within the word (`n ≤ 63` for 64-bit) the unit-cost word-RAM model holds.

---

## Professional Questions (8 Q&A)

### P1. Design a service that streams the `m`-th through `(m+B)`-th `k`-combinations on demand.
Use the combinatorial number system to **unrank** `m` to a starting mask in `O(k log n)`, then run Gosper `B` times for the batch — `O(B)` after setup. Ranks map order-preservingly to Gosper's increasing-mask order, so pagination is exact and stateless: each request only needs `(m, B)`. Shard across workers by rank range.

### P2. You need combinations for `n = 100`. What changes?
`n > 63` exceeds a 64-bit word, so masks become bigints (`math/big`, Python int). The algorithm is identical but each step is `O(n/w)`. More importantly, check `C(100, k)` — for mid `k` it is astronomically large and the enumeration is infeasible regardless of representation; you likely need pruning or a different formulation.

### P3. How do you minimize switching activity (power) in a sequential circuit's state encoding?
Encode states in Gray order so each transition toggles one bit, minimizing dynamic power (`P ∝ activity`). For counters crossing clock domains, Gray-code the pointer so the synchronizer never latches a multi-bit-corrupted value. The conversion `x ^ (x >> 1)` is synthesized directly in RTL.

### P4. How do you debug "my combination enumeration is missing some / has duplicates"?
Diff against `itertools.combinations` on the same small `n, k`. Check the three usual suspects: wrong start (must be `(1<<k)-1`), wrong stop (must be `1<<n`), and float division in Python (must be `//`). Assert popcount `== k` on every emitted mask and that the sequence is strictly increasing; a *decrease* signals overflow wraparound.

### P5. When is Gray code the wrong choice?
When you actually need numeric/sorted order (Gray is minimal-change order; you'd have to invert every value) or when the downstream consumer expects monotonic indices and binary-searches them. Also when there's no benefit to one-bit changes (no incremental aggregate, no hardware transition cost) — then a plain counter is simpler.

### P6. How do you exploit Gray order to speed up a brute-force over all subsets?
Maintain the aggregate `f(S)` incrementally: at each Gray step toggle the single element `ν(x)` and update `f` in `O(1)` (add/remove its contribution), instead of recomputing `f(S)` in `O(n)`. This turns an `O(n·2^n)` brute force into `O(2^n)`.

### P7. How do automata/combinatorics connect to Gosper enumeration?
Gosper enumerates fixed-size subsets, the building block of bitmask DP over "choose exactly `k`" structures (assignments, set covers of fixed size, committee selection). Iterating by increasing popcount feeds DP states whose transitions add one element, matching the natural dependency order (popcount `k` depends on `k−1`).

### P8 (analysis). Prove the Gray inverse is a prefix XOR and give its optimal cost.
From `g_i = x_i ⊕ x_{i+1}` (with `x_n = 0`), solving top-down gives `x_i = ⊕_{j≥i} g_j` — a suffix/prefix XOR. The bit-by-bit loop is `O(n)`; the doubling fold `g ^= g>>16; …; g ^= g>>1` computes the same in `O(log n)`, which is optimal for a fixed-width parallel-prefix on a word-RAM (each fold at most halves the unresolved span).

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an allocation-heavy generator with a bit trick.
Look for a concrete story: a combination generator that allocated a tuple/list per item and dominated a profile, replaced by Gosper's allocation-free `O(1)` loop, with a measured GC/latency improvement and a correctness check against the old generator on small inputs.

### B2. A teammate used `gray(x)` expecting sorted output and the report came out scrambled. How do you handle it?
Explain calmly that Gray code is *minimal-change* order, not numeric order — it's a permutation. Show a tiny example (`gray(4) = 6`, out of order). The fix is to apply the inverse (prefix XOR) when a numeric index is needed, or to use a plain counter if one-bit changes bring no benefit. Frame it as a teaching moment.

### B3. Design a feature that cycles an LED indicator or rotary input through positions with minimal flicker.
This is a Gray-code use case: sequence positions in Gray order so only one segment/track changes per step, avoiding glitches and minimizing switching. Discuss the encoder analogy, the one-bit guarantee, and converting between the linear position and the Gray code with `x ^ (x>>1)` and its inverse.

### B4. How would you explain Gosper's hack to a junior engineer?
Use the seating analogy: `k` people in the lowest seats; the next arrangement moves the front of the lowest cluster up one seat and slides everyone behind to the very front. Then show the four lines map to "find lowest block, push its top up (`x+c`), repack the rest at the bottom." Lead with the two gotchas: integer division and the `k=0` guard.

### B5. Your combination-enumeration job is too slow at scale. How do you investigate?
First check whether `C(n, k)` is simply huge — no per-step trick fixes an infeasible output size; you need pruning or a reformulation. If the count is fine, profile for accidental allocation (materializing the list vs streaming), float division in Python, and whether you can parallelize by unranking and sharding the rank range.

---

## Coding Challenges

### Challenge 1: Generate All K-Subsets via Gosper

**Problem.** Given `n` and `k`, return all bitmasks with exactly `k` bits set in `[0, 2^n)`, in increasing order, using Gosper's hack.

**Example.**
```text
n = 4, k = 2 -> [0011, 0101, 0110, 1001, 1010, 1100] = [3, 5, 6, 9, 10, 12]
n = 5, k = 0 -> [0]
```

**Constraints.** `0 ≤ k ≤ n ≤ 62`.

**Optimal.** Gosper loop, `O(C(n, k))`.

**Go.**
```go
package main

import "fmt"

func nextCombination(x uint64) uint64 {
	c := x & (-x)
	r := x + c
	return (((r ^ x) >> 2) / c) | r
}

func kSubsets(n, k int) []uint64 {
	if k == 0 {
		return []uint64{0}
	}
	if k > n {
		return nil
	}
	out := []uint64{}
	x := uint64((1 << uint(k)) - 1)
	limit := uint64(1) << uint(n)
	for x < limit {
		out = append(out, x)
		x = nextCombination(x)
	}
	return out
}

func main() {
	fmt.Println(kSubsets(4, 2)) // [3 5 6 9 10 12]
	fmt.Println(kSubsets(5, 0)) // [0]
}
```

**Java.**
```java
import java.util.*;

public class KSubsets {
    static long nextCombination(long x) {
        long c = x & (-x);
        long r = x + c;
        return (((r ^ x) >> 2) / c) | r;
    }

    static List<Long> kSubsets(int n, int k) {
        List<Long> out = new ArrayList<>();
        if (k == 0) { out.add(0L); return out; }
        if (k > n) return out;
        long x = (1L << k) - 1, limit = 1L << n;
        while (x < limit) { out.add(x); x = nextCombination(x); }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(kSubsets(4, 2)); // [3, 5, 6, 9, 10, 12]
        System.out.println(kSubsets(5, 0)); // [0]
    }
}
```

**Python.**
```python
def next_combination(x):
    c = x & (-x)
    r = x + c
    return (((r ^ x) >> 2) // c) | r


def k_subsets(n, k):
    if k == 0:
        return [0]
    if k > n:
        return []
    out, x, limit = [], (1 << k) - 1, 1 << n
    while x < limit:
        out.append(x)
        x = next_combination(x)
    return out


if __name__ == "__main__":
    print(k_subsets(4, 2))  # [3, 5, 6, 9, 10, 12]
    print(k_subsets(5, 0))  # [0]
```

---

### Challenge 2: N-Bit Gray Code Sequence

**Problem.** Generate the `n`-bit reflected Gray code as a list of integers, in order.

**Example.**
```text
n = 2 -> [0, 1, 3, 2]      (00, 01, 11, 10)
n = 3 -> [0, 1, 3, 2, 6, 7, 5, 4]
```

**Constraints.** `1 ≤ n ≤ 16`.

**Optimal.** Iterate `gray(x) = x ^ (x>>1)` for `x = 0..2^n−1`, `O(2^n)`.

**Go.**
```go
package main

import "fmt"

func grayCode(n int) []uint64 {
	out := make([]uint64, 1<<uint(n))
	for x := uint64(0); x < uint64(1)<<uint(n); x++ {
		out[x] = x ^ (x >> 1)
	}
	return out
}

func main() {
	fmt.Println(grayCode(2)) // [0 1 3 2]
	fmt.Println(grayCode(3)) // [0 1 3 2 6 7 5 4]
}
```

**Java.**
```java
import java.util.*;

public class GrayCode {
    static List<Long> grayCode(int n) {
        List<Long> out = new ArrayList<>();
        for (long x = 0; x < (1L << n); x++) out.add(x ^ (x >> 1));
        return out;
    }

    public static void main(String[] args) {
        System.out.println(grayCode(2)); // [0, 1, 3, 2]
        System.out.println(grayCode(3)); // [0, 1, 3, 2, 6, 7, 5, 4]
    }
}
```

**Python.**
```python
def gray_code(n):
    return [x ^ (x >> 1) for x in range(1 << n)]


if __name__ == "__main__":
    print(gray_code(2))  # [0, 1, 3, 2]
    print(gray_code(3))  # [0, 1, 3, 2, 6, 7, 5, 4]
```

---

### Challenge 3: Gray ↔ Binary Conversion

**Problem.** Implement `to_gray(x)` and `from_gray(g)` (the inverse). Verify the round-trip on all values for a given width.

**Example.**
```text
to_gray(6)   = 5      (110 -> 101)
from_gray(5) = 6
```

**Constraints.** Values up to 63 bits; use logical shifts.

**Go.**
```go
package main

import "fmt"

func toGray(x uint64) uint64 { return x ^ (x >> 1) }

func fromGray(g uint64) uint64 {
	x := uint64(0)
	for g > 0 {
		x ^= g
		g >>= 1
	}
	return x
}

func main() {
	fmt.Println(toGray(6))   // 5
	fmt.Println(fromGray(5)) // 6
	ok := true
	for x := uint64(0); x < 256; x++ {
		if fromGray(toGray(x)) != x {
			ok = false
		}
	}
	fmt.Println("round-trip 0..255:", ok)
}
```

**Java.**
```java
public class GrayConvert {
    static long toGray(long x) { return x ^ (x >>> 1); }

    static long fromGray(long g) {
        long x = 0;
        for (; g != 0; g >>>= 1) x ^= g;
        return x;
    }

    public static void main(String[] args) {
        System.out.println(toGray(6));   // 5
        System.out.println(fromGray(5)); // 6
        boolean ok = true;
        for (long x = 0; x < 256; x++)
            if (fromGray(toGray(x)) != x) ok = false;
        System.out.println("round-trip 0..255: " + ok);
    }
}
```

**Python.**
```python
def to_gray(x):
    return x ^ (x >> 1)


def from_gray(g):
    x = 0
    while g:
        x ^= g
        g >>= 1
    return x


if __name__ == "__main__":
    print(to_gray(6))    # 5
    print(from_gray(5))  # 6
    print("round-trip 0..255:", all(from_gray(to_gray(x)) == x for x in range(256)))
```

---

### Challenge 4: Maximum Subset Sum Over Exactly K Items

**Problem.** Given `n` item values and a target size `k`, find the maximum total value of any `k`-element subset, using Gosper to enumerate the `C(n, k)` subsets. (For large `n` you'd sort and take the top `k`; here the point is the enumeration mechanics.)

**Example.**
```text
values = [3, 1, 4, 1, 5], k = 2 -> 9   (pick 4 and 5)
```

**Constraints.** `1 ≤ k ≤ n ≤ 20` (enumeration size kept feasible).

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func nextCombination(x uint64) uint64 {
	c := x & (-x)
	r := x + c
	return (((r ^ x) >> 2) / c) | r
}

func maxKSubsetSum(values []int, k int) int {
	n := len(values)
	best := -1 << 62
	x := uint64((1 << uint(k)) - 1)
	limit := uint64(1) << uint(n)
	for x < limit {
		sum := 0
		m := x
		for m > 0 {
			i := bits.TrailingZeros64(m)
			sum += values[i]
			m &= m - 1
		}
		if sum > best {
			best = sum
		}
		x = nextCombination(x)
	}
	return best
}

func main() {
	fmt.Println(maxKSubsetSum([]int{3, 1, 4, 1, 5}, 2)) // 9
}
```

**Java.**
```java
public class MaxKSubsetSum {
    static long nextCombination(long x) {
        long c = x & (-x);
        long r = x + c;
        return (((r ^ x) >> 2) / c) | r;
    }

    static int maxKSubsetSum(int[] values, int k) {
        int n = values.length, best = Integer.MIN_VALUE;
        long x = (1L << k) - 1, limit = 1L << n;
        while (x < limit) {
            int sum = 0;
            long m = x;
            while (m != 0) {
                int i = Long.numberOfTrailingZeros(m);
                sum += values[i];
                m &= m - 1;
            }
            best = Math.max(best, sum);
            x = nextCombination(x);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxKSubsetSum(new int[]{3, 1, 4, 1, 5}, 2)); // 9
    }
}
```

**Python.**
```python
def next_combination(x):
    c = x & (-x)
    r = x + c
    return (((r ^ x) >> 2) // c) | r


def max_k_subset_sum(values, k):
    n = len(values)
    best = float("-inf")
    x, limit = (1 << k) - 1, 1 << n
    while x < limit:
        s, m = 0, x
        while m:
            i = (m & -m).bit_length() - 1
            s += values[i]
            m &= m - 1
        best = max(best, s)
        x = next_combination(x)
    return best


if __name__ == "__main__":
    print(max_k_subset_sum([3, 1, 4, 1, 5], 2))  # 9
```

---

## Final Tips

- Lead with the one-liners: *"`c=x&-x; r=x+c; (((r^x)>>2)/c)|r` is the next same-popcount integer; `g = x ^ (x>>1)` flips exactly one bit per step."*
- Immediately flag the gotchas: **integer division** and the **`k=0` guard** in Gosper; **logical shifts** and **Gray is not numeric order** in Gray code.
- For "enumerate combinations sorted, allocation-free" reach for **Gosper**; for "minimal change / hardware / incremental update" reach for **Gray code**.
- Mention **combinatorial unranking** for random access and parallel sharding of the combination space.
- Always offer to verify against `itertools.combinations` and the Gray invariants (Hamming distance 1, permutation, round-trip) on small inputs.

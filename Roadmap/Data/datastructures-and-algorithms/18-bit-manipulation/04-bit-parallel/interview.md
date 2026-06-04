# Bit-Parallel Techniques (Word-Level Parallelism / Bitset Acceleration) — Interview Preparation

Bit-parallelism is a favourite interview topic because it rewards one crisp insight — *"a 64-bit word is 64 boolean lanes, and one instruction processes all of them"* — and then tests whether you can (a) apply it to subset-sum with `B |= B << w`, (b) recognize the same `/64` win behind transitive closure and string matching, (c) implement the cross-word shift correctly, and (d) state honestly that it is a **constant-factor** win, not a complexity-class change. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Which subset sums are reachable? | `B \|= B << w` per item | `O(n·T/64)` |
| Is total `t` reachable? | test bit `t` of `B` | `O(1)` |
| How many distinct totals? | popcount(`B`) | `O(T/64)` |
| Smallest positive reachable sum | ctz(`B & ~1`) | `O(T/64)` |
| Substring search, pattern ≤ 64 | Shift-Or / Bitap | `O(n)` |
| Reachable in any / `k` steps? | bitset rows, OR-combine | `O(V³/64)` (× `log k`) |
| Edit distance, pattern ≤ 64 | Myers' bit-vector | `O(n)` |
| Union / intersection of dense sets | word-wise `\|` / `&` | `O(T/64)` |

The bitset addressing (memorize):

```text
word(s) = s >> 6      position(s) = s & 63      mask(s) = 1 << (s & 63)
test(s) = (words[s>>6] >> (s&63)) & 1
```

Core subset-sum loop:

```text
B = 1                      # only sum 0 reachable (empty subset)
for w in weights:
    B |= B << w            # add w to every reachable sum (64 lanes/instr)
answer(t) = (B >> t) & 1
# O(n * T / 64); same Big-O class as scalar DP, 64x smaller constant
```

Key facts:
- **`/64` is a constant factor**, not a Big-O improvement.
- **Left shift = "add to every reachable sum at once"** (translation of the set).
- Cross-word shift: split `w` into `w>>6` words + `w&63` bits; iterate **high→low** in place; guard `bitShift==0`.
- Shift-Or: `R = (R << 1) | mask[c]`; match when bit `m-1` of `R` is `0`.

---

## Junior Questions (12 Q&A)

### J1. Why is a bitset faster than a `bool[]`?
A `bool[]` uses ~1 byte per boolean and touches one element per operation. A bitset packs 64 booleans per 64-bit word, and one bitwise instruction (`&`, `|`, `^`, `<<`) operates on all 64 at once — a 64× constant-factor speedup, plus 8× denser memory (better cache behavior).

### J2. What does `B |= B << w` compute in subset-sum?
Bit `s` of `B` means "sum `s` is reachable". `B << w` moves every reachable sum `s` to `s + w` (i.e. "take the item of weight `w`"), and OR-ing keeps the old sums ("skip it"). So one shift-OR adds item `w` to all reachable sums simultaneously.

### J3. How do you find which word and bit position hold bit `s`?
Word index `s >> 6` (= `s / 64`), position within the word `s & 63` (= `s % 64`). The bit is `(words[s>>6] >> (s&63)) & 1`.

### J4. Does the bitset trick change the Big-O?
No. `O(n·T)` becomes `O(n·T/64)` — the same complexity class with a 64× smaller constant. It is an optimization, never an algorithmic improvement; the asymptotic difficulty is unchanged.

### J5. What is popcount and what is it used for here?
Popcount is the number of set bits in a word (CPU `POPCNT`). For subset-sum it counts how many distinct totals are reachable: `Σ popcount(words[i])`.

### J6. What is find-first-set / ctz?
The index of the lowest set bit (count-trailing-zeros). It gives the smallest reachable sum: scan for the first nonzero word, then `ctz` it.

### J7. Why does Python need no cross-word shift code?
A Python `int` is an arbitrary-precision bitset, and `B << w` / `B |= …` run in C and carry across "words" automatically. Go/Java fixed-width words require manual cross-word carry.

### J8. What is the starting value of the subset-sum bitset?
`B = 1` (only bit 0 set), encoding "sum 0 is reachable via the empty subset". Forgetting this is a common bug.

### J9. How big must the bitset be?
At least `sum(weights) + 1` bits to hold every possible total (or the largest query target). Too small silently drops sums that fall off the end.

### J10. What happens with a weight-0 item?
`B |= B << 0` is `B |= B`, a no-op. A zero-weight item never changes reachable sums — correct behavior.

### J11. Why is bit 63 of a Java `long` tricky?
It is the sign bit. Use the logical shift `>>>`, not arithmetic `>>`, when moving bits unsigned, or the sign bit leaks into the result.

### J12 (analysis). Is `B |= B << w` 0/1 knapsack or unbounded?
Applying it once per item gives 0/1 (each item usable at most once). Unbounded knapsack (reuse an item freely) needs a different update; the single shift-OR per item is the bounded version.

---

## Middle Questions (12 Q&A)

### M1. Implement the cross-word left shift for `B |= B << w`.
Split `w` into `wordShift = w>>6` and `bitShift = w&63`. For output word `i`, take `src = i - wordShift`: `out[i] = words[src] << bitShift`, and if `bitShift > 0` also OR in `words[src-1] >> (64 - bitShift)`. Iterate `i` from high to low (in place), OR into `words[i]`.

### M2. Why iterate high→low for an in-place left shift?
A left shift moves bits to higher positions, so output word `i` depends on lower source words. Iterating low→high would overwrite those source words before they are read, losing reachable sums.

### M3. What is the `bitShift == 0` trap?
The carry term `word >> (64 - bitShift)` becomes `>> 64` when `bitShift == 0`, which is undefined in Go/Java/C. Guard it with `if bitShift > 0`, or special-case whole-word shifts.

### M4. Explain Shift-Or string matching.
Keep a state word `R` where bit `j` is `0` iff the pattern prefix `P[0..j]` matches the text ending here (0 = matched). Precompute `mask[c]` with bit `j` = 0 iff `P[j] == c`. Update `R = (R << 1) | mask[c]`; a full match ends when bit `m-1` of `R` is `0`.

### M5. Why does Shift-Or's `R << 1` start a new match?
The shift introduces a fresh `0` at bit 0, optimistically asserting "a new length-1 match may begin here"; the `| mask[c]` immediately invalidates it (sets it to 1) unless `P[0] == c`.

### M6. How do bitsets accelerate transitive closure?
Store each adjacency row as a bitset. Reachability propagation becomes `row[i] |= row[k]` (when `i` reaches `k`), one word-parallel OR over `V/64` words. The whole closure is `O(V³/64)` instead of `O(V³)`.

### M7. When is a hash set better than a bitset?
When the set is sparse over a huge universe. A bitset of `10^9` slots with 100 elements sweeps `10^9/64` words; a hash set is `O(100)`. Bitsets win for dense subsets of a moderate universe.

### M8. How do you reconstruct which items form a subset sum?
Reachability says *that* `t` is reachable, not *which* items. Walk items backward: if `t - w` was reachable before item `w` was folded in, `w` is part of a solution; recurse on `t - w`. `O(n)` per reconstruction.

### M9. How do you bound subset-sum memory if you only care about totals ≤ C?
Size the bitset to `C+1` and mask off bits beyond `C` after each shift-OR. Sums larger than `C` fall off the end; time and space become `O(n·C/64)`.

### M10. Shift-Or vs KMP — which is faster?
Same `O(n)` asymptotically. Shift-Or has a tinier, branch-free constant for short patterns (≤ 64) and extends trivially to approximate matching (Bitap). KMP handles arbitrary-length patterns without multi-word logic.

### M11. What is the match convention in Shift-Or and why care?
Typically "0 = matched". The dual "Shift-And" uses "1 = matched". Mixing them silently breaks matching. Pick one and build the masks consistently.

### M12 (analysis). Why is the bitset speedup exactly 64 and not more?
Because a general-purpose register is 64 bits, so one instruction processes 64 boolean lanes. Wider SIMD registers (256/512 bits) push the divisor to 256/512, and compilers often auto-vectorize the word loop, but 64 is the portable single-register baseline.

---

## Senior Questions (10 Q&A)

### S1. `std::bitset` vs `dynamic_bitset` vs hand-rolled `uint64[]` — when each?
`std::bitset<N>` for compile-time-bounded hottest loops (inlined, gives `<<` for free). `dynamic_bitset`/Java `BitSet`/Python `int` for runtime-sized set algebra. Hand-rolled `uint64[]` when you need shift-OR control (subset-sum) or a path to SIMD. Note Java `BitSet` has **no** `<<`, so subset-sum needs a custom `long[]`.

### S2. Does the `/64` always give a 64× wall-clock speedup?
No — it is a 64× *instruction* reduction. Wall-clock also depends on cache: if the bitset spills L2, memory bandwidth caps the gain. The 8× density (vs `bool[]`) is half the practical benefit because it keeps data resident. Always measure.

### S3. Explain Myers' bit-vector edit distance at a high level.
Encode a DP column by two bit vectors of its vertical differences (`VP`, `VN`), exploiting the unit-difference property. The column update is a few word ops; the crucial `(Eq & VP) + VP` uses the ALU **carry chain as a parallel scan** to propagate the `min` recurrence up the column. Result: `O(1)` word ops per text character, `O(n)` for pattern ≤ 64.

### S4. How do you go beyond a single 64-bit word?
Block the state into `⌈m/64⌉` words and carry shifts/adds across blocks — Shift-Or, subset-sum, and Myers all extend this way at `O(m/64)` per step. Or use SIMD (AVX2/AVX-512) for a `/256` or `/512` on pure boolean word loops.

### S5. What is SWAR and how does it relate to bitsets?
SIMD-Within-A-Register packs multi-bit lanes into one word and does arithmetic on all of them with masking to block inter-lane carries (e.g. parallel popcount, byte-wise zero detection). Bitsets are the 1-bit-lane special case where carries don't exist; Myers inverts SWAR by *using* the carry as computation.

### S6. When does bit-parallelism NOT help?
When the bottleneck loop is not boolean, the complexity class is the real problem, the data is sparse, or the loop is cold. The `/64` cannot rescue an exponential algorithm and wastes effort on non-hot or non-boolean code.

### S7. How do you test bit-parallel code?
Against a scalar oracle: scalar boolean DP for subset-sum, naive substring search for Shift-Or, full DP for Myers — compared entrywise on random small inputs. Add property tests (`popcount` matches scalar count, bit 0 always set) and fuzz across languages, masking Python ints to 64 bits.

### S8. Why is the cross-word shift the top bug source?
Three independent hazards: the `>> 64` UB when `bitShift == 0`, wrong iteration direction overwriting source words, and dropping the cross-word carry bits. Each silently corrupts results, so it needs dedicated boundary tests (`w` a multiple of 64, `w` spanning two words).

### S9. How does the bitset Boolean multiply relate to Strassen?
Orthogonally. Strassen's `O(n^ω)` needs subtraction (a ring); the Boolean semiring has none, so it cannot use Strassen. The bitset `/64` is a word-RAM constant-factor win available without subtraction, and is the practical method for Boolean matrix multiply / reachability at moderate `n`.

### S10 (analysis). What is the Four-Russians refinement?
Precompute, for each `Θ(log n)`-bit column block, a table from the `2^{log n} = n` patterns to the OR of the corresponding `B` rows, then look up instead of OR-ing bit by bit. This adds an extra `1/log n` factor beyond the bitset `/64`, giving `O(n³/(w log n))` Boolean matrix multiply.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time a constant-factor optimization saved a deadline.
Look for a concrete story: a correct `O(n·T)` or `O(V³)` boolean loop timing out, the insight that the inner work was boolean (so bit-packable), the `B |= B << w` (or row-OR) rewrite, and a measured speedup. Strong answers note the scalar-oracle test that proved the rewrite still correct and the honest framing as a constant-factor (not Big-O) win.

### B2. A teammate claims their bitset made the algorithm `O(n)` instead of `O(n·T)`. How do you respond?
Calmly correct it: the bitset gives `O(n·T/64)`, the same class, a 64× smaller constant. Show the arithmetic (`T` words become `T/64`). Frame it as keeping our complexity claims honest in design docs — overstating Big-O misleads capacity planning. A teaching moment, not a gotcha.

### B3. Design a fuzzy text-search feature over a large document store.
Bit-parallel matching: Shift-Or for exact, Bitap-with-errors (`k+1` state words) for approximate, or Myers for edit-distance ranking. Discuss pattern-length limits (≤ 64 per word, else multi-word/blocked), alphabet mask precomputation, and falling back to indexed search (suffix automaton / inverted index) when the corpus is huge and queries are frequent.

### B4. How would you explain bit-parallel subset-sum to a junior?
Start from light switches: a register is 64 switches you flip with one lever. Bit `s` lit means "sum `s` reachable". Adding an item of weight `w` slides every lit switch up `w` and keeps the originals — that is `B |= B << w`, one push for 64 sums. Lead with the two gotchas: it counts reachability (not which items), and it is a 64× constant, not a Big-O change.

### B5. Your subset-sum job is using too much memory at scale. How do you investigate?
Check the bitset width: an un-capped sum makes `T = sum(weights)` balloon. Cap to the largest query target and mask high bits. Confirm in-place updates (not a fresh bitset per item) to avoid GC churn. Each bit is 1/8 byte, so `T = 10^9` is 125 MB — often the cap, not the packing, is the leak.

---

## Coding Challenges

### Challenge 1: Subset-Sum Reachability via Bitset Shift

**Problem.** Given `n` item weights and a target `t`, decide whether some subset sums to exactly `t` (0/1 knapsack feasibility). Use the bitset shift-OR method.

**Example.**
```text
weights = [3, 1, 2], t = 5  ->  true   (3 + 2)
weights = [3, 1, 2], t = 7  ->  false  (max sum is 6)
```

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ weight ≤ 2000`, so `sum ≤ 4·10^6`.

**Brute force.** Enumerate `2^n` subsets — infeasible.

**Optimal.** Bitset shift-OR, `O(n · sum / 64)`.

**Go.**
```go
package main

import "fmt"

func canPartitionTo(weights []int, t int) bool {
	total := 0
	for _, w := range weights {
		total += w
	}
	if t > total {
		return false
	}
	nWords := (total >> 6) + 1
	B := make([]uint64, nWords)
	B[0] = 1 // sum 0 reachable
	for _, w := range weights {
		ws, bs := w>>6, uint(w&63)
		for i := nWords - 1; i >= 0; i-- {
			var v uint64
			if src := i - ws; src >= 0 {
				v = B[src] << bs
				if bs > 0 && src-1 >= 0 {
					v |= B[src-1] >> (64 - bs)
				}
			}
			B[i] |= v
		}
	}
	return B[t>>6]>>uint(t&63)&1 == 1
}

func main() {
	fmt.Println(canPartitionTo([]int{3, 1, 2}, 5)) // true
	fmt.Println(canPartitionTo([]int{3, 1, 2}, 7)) // false
}
```

**Java.**
```java
public class SubsetSum {
    static boolean canMake(int[] weights, int t) {
        int total = 0;
        for (int w : weights) total += w;
        if (t > total) return false;
        int nWords = (total >> 6) + 1;
        long[] B = new long[nWords];
        B[0] = 1L;
        for (int w : weights) {
            int ws = w >> 6, bs = w & 63;
            for (int i = nWords - 1; i >= 0; i--) {
                long v = 0L;
                int src = i - ws;
                if (src >= 0) {
                    v = B[src] << bs;
                    if (bs > 0 && src - 1 >= 0) v |= B[src - 1] >>> (64 - bs);
                }
                B[i] |= v;
            }
        }
        return ((B[t >> 6] >>> (t & 63)) & 1L) == 1L;
    }

    public static void main(String[] args) {
        System.out.println(canMake(new int[]{3, 1, 2}, 5)); // true
        System.out.println(canMake(new int[]{3, 1, 2}, 7)); // false
    }
}
```

**Python.**
```python
def can_make(weights, t):
    B = 1
    for w in weights:
        B |= B << w
    return (B >> t) & 1 == 1


if __name__ == "__main__":
    print(can_make([3, 1, 2], 5))  # True
    print(can_make([3, 1, 2], 7))  # False
```

---

### Challenge 2: Shift-Or Substring Search

**Problem.** Find all starting indices where pattern `P` (length `m ≤ 64`) occurs in text `T`, using the Shift-Or (Bitap) algorithm.

**Example.**
```text
text = "ababcabab", pat = "abab"  ->  [0, 5]
```

**Optimal.** Shift-Or, `O(σ + m)` preprocess, `O(n)` search.

**Go.**
```go
package main

import "fmt"

func shiftOr(text, pat string) []int {
	m := len(pat)
	var mask [256]uint64
	for i := range mask {
		mask[i] = ^uint64(0)
	}
	for j := 0; j < m; j++ {
		mask[pat[j]] &^= 1 << uint(j) // 0 = matches
	}
	var R uint64 = ^uint64(0)
	matchBit := uint64(1) << uint(m-1)
	var res []int
	for i := 0; i < len(text); i++ {
		R = (R << 1) | mask[text[i]]
		if R&matchBit == 0 {
			res = append(res, i-m+1)
		}
	}
	return res
}

func main() {
	fmt.Println(shiftOr("ababcabab", "abab")) // [0 5]
}
```

**Java.**
```java
import java.util.*;

public class ShiftOr {
    static List<Integer> search(String text, String pat) {
        int m = pat.length();
        long[] mask = new long[256];
        Arrays.fill(mask, ~0L);
        for (int j = 0; j < m; j++)
            mask[pat.charAt(j)] &= ~(1L << j);
        long R = ~0L, matchBit = 1L << (m - 1);
        List<Integer> res = new ArrayList<>();
        for (int i = 0; i < text.length(); i++) {
            R = (R << 1) | mask[text.charAt(i)];
            if ((R & matchBit) == 0) res.add(i - m + 1);
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(search("ababcabab", "abab")); // [0, 5]
    }
}
```

**Python.**
```python
def shift_or(text, pat):
    m = len(pat)
    mask = [~0] * 256
    for j, ch in enumerate(pat):
        mask[ord(ch)] &= ~(1 << j)
    R = ~0
    match_bit = 1 << (m - 1)
    full = (1 << 64) - 1
    res = []
    for i, ch in enumerate(text):
        R = ((R << 1) | mask[ord(ch)]) & full
        if R & match_bit == 0:
            res.append(i - m + 1)
    return res


if __name__ == "__main__":
    print(shift_or("ababcabab", "abab"))  # [0, 5]
```

---

### Challenge 3: Boolean Reachability Closure (bitset rows)

**Problem.** Given a directed graph as an adjacency matrix, compute the transitive closure (`reach[i][j] = 1` iff `j` is reachable from `i`) using bitset rows for the `/64` speedup.

**Example.**
```text
edges: 0->1, 1->2  =>  reach[0] = {0,1,2}, reach[1] = {1,2}, reach[2] = {2}
```

**Optimal.** Warshall with row-bitset OR, `O(V³/64)`.

**Go.**
```go
package main

import "fmt"

func closure(n int, adj [][]int) [][]uint64 {
	nWords := (n >> 6) + 1
	reach := make([][]uint64, n)
	for i := range reach {
		reach[i] = make([]uint64, nWords)
		reach[i][i>>6] |= 1 << uint(i&63) // reflexive
		for _, j := range adj[i] {
			reach[i][j>>6] |= 1 << uint(j&63)
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if reach[i][k>>6]>>uint(k&63)&1 == 1 {
				for wI := 0; wI < nWords; wI++ {
					reach[i][wI] |= reach[k][wI]
				}
			}
		}
	}
	return reach
}

func main() {
	reach := closure(3, [][]int{{1}, {2}, {}})
	fmt.Println(reach[0][0]&1, reach[0][0]>>1&1, reach[0][0]>>2&1) // 1 1 1
}
```

**Java.**
```java
public class Closure {
    static long[][] closure(int n, int[][] adj) {
        int nWords = (n >> 6) + 1;
        long[][] reach = new long[n][nWords];
        for (int i = 0; i < n; i++) {
            reach[i][i >> 6] |= 1L << (i & 63);
            for (int j : adj[i]) reach[i][j >> 6] |= 1L << (j & 63);
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++)
                if (((reach[i][k >> 6] >>> (k & 63)) & 1L) == 1L)
                    for (int w = 0; w < nWords; w++) reach[i][w] |= reach[k][w];
        return reach;
    }

    public static void main(String[] args) {
        long[][] r = closure(3, new int[][]{{1}, {2}, {}});
        System.out.println((r[0][0] & 1) + " " + (r[0][0] >> 1 & 1) + " " + (r[0][0] >> 2 & 1));
    }
}
```

**Python.**
```python
def closure(n, adj):
    reach = [1 << i for i in range(n)]          # reflexive; each row is an int-bitset
    for i in range(n):
        for j in adj[i]:
            reach[i] |= 1 << j
    for k in range(n):
        kbit = 1 << k
        for i in range(n):
            if reach[i] & kbit:
                reach[i] |= reach[k]
    return reach


if __name__ == "__main__":
    r = closure(3, [[1], [2], []])
    print([(r[0] >> b) & 1 for b in range(3)])  # [1, 1, 1]
```

---

### Challenge 4: Bitset-Accelerated LCS Length

**Problem.** Compute the length of the longest common subsequence of two strings, using the bit-parallel LCS recurrence (Crochemore/Hunt-style: a row bitset updated with shift, add, and masks). Pattern (first string) length ≤ 64.

**Example.**
```text
a = "ABCBDAB", b = "BDCAB"  ->  LCS length 4 ("BCAB")
```

**Optimal.** Bit-parallel LCS, `O(|b| · ⌈|a|/64⌉)`.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

// bitParallelLCS: |a| <= 64. Uses the Crochemore-Iliopoulos-Pinzon-Reid recurrence.
// V starts all-ones; each char of b does V = (V + (V&M)) | (V & ~M).
// LCS length = popcount of the bits CLEARED in V (over the low m bits).
func bitParallelLCS(a, b string) int {
	m := len(a)
	var match [256]uint64
	for i := 0; i < m; i++ {
		match[a[i]] |= 1 << uint(i)
	}
	full := uint64(0)
	if m == 64 {
		full = ^uint64(0)
	} else {
		full = (uint64(1) << uint(m)) - 1
	}
	V := full
	for j := 0; j < len(b); j++ {
		mb := match[b[j]]
		t := V & mb
		V = ((V + t) | (V &^ mb)) & full
	}
	// LCS length = number of bits that went 1 -> 0 in V (the cleared bits).
	return bits.OnesCount64((^V) & full)
}

func main() {
	fmt.Println(bitParallelLCS("ABCBDAB", "BDCAB")) // 4
}
```

**Java.**
```java
public class BitLCS {
    static int lcs(String a, String b) {
        int m = a.length();
        long[] match = new long[256];
        for (int i = 0; i < m; i++) match[a.charAt(i)] |= 1L << i;
        long full = (m == 64) ? ~0L : (1L << m) - 1;
        long V = full;
        for (int j = 0; j < b.length(); j++) {
            long mb = match[b.charAt(j)];
            long t = V & mb;
            V = ((V + t) | (V & ~mb)) & full;
        }
        // LCS length = popcount of the bits cleared in V.
        return Long.bitCount((~V) & full);
    }

    public static void main(String[] args) {
        System.out.println(lcs("ABCBDAB", "BDCAB")); // 4
    }
}
```

**Python.**
```python
def bit_parallel_lcs(a, b):
    m = len(a)
    match = {}
    for i, ch in enumerate(a):
        match[ch] = match.get(ch, 0) | (1 << i)
    full = (1 << m) - 1
    V = full
    for ch in b:
        mb = match.get(ch, 0)
        t = V & mb
        V = ((V + t) | (V & ~mb)) & full
    # LCS length = number of bits CLEARED in V (the 1 -> 0 transitions).
    return bin((~V) & full).count("1")


if __name__ == "__main__":
    print(bit_parallel_lcs("ABCBDAB", "BDCAB"))  # 4
```

---

## Final Tips

- Lead with the one-liner: *"A 64-bit word is 64 boolean lanes; one instruction processes all of them, so boolean inner loops drop from `O(T)` to `O(T/64)`."*
- For subset-sum, the headline is `B |= B << w` — "add `w` to every reachable sum at once".
- Immediately flag the honest caveat: **`/64` is a constant factor, not a Big-O improvement.**
- If asked about string matching, reach for **Shift-Or** (`R = (R << 1) | mask[c]`); for edit distance, mention **Myers' bit-vector** (carry chain as parallel scan).
- For reachability, mention **bitset rows OR-combined** giving `O(V³/64)`, orthogonal to Strassen (no subtraction in the Boolean semiring).
- Always offer to verify against a scalar oracle on small inputs — cross-word shift bugs are the usual culprit.

# Binary Trie & XOR Linear Basis — Interview Preparation

> **One-line summary:** A bank of seniority-graded Q&A plus behavioral prompts and four end-to-end coding challenges — max XOR pair (trie), max XOR subset (basis), count pairs with XOR < k (trie + counts), and k-th smallest XOR (reduced basis) — each with runnable Go, Java, and Python solutions.

---

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions](#junior-questions)
3. [Middle Questions](#middle-questions)
4. [Senior Questions](#senior-questions)
5. [Professional Questions](#professional-questions)
6. [Behavioral Prompts](#behavioral-prompts)
7. [Coding Challenge 1: Maximum XOR Pair (Trie)](#coding-challenge-1-maximum-xor-pair-trie)
8. [Coding Challenge 2: Maximum XOR Subset (Basis)](#coding-challenge-2-maximum-xor-subset-basis)
9. [Coding Challenge 3: Count Pairs with XOR < k (Trie + Counts)](#coding-challenge-3-count-pairs-with-xor--k-trie--counts)
10. [Coding Challenge 4: k-th Smallest Subset XOR (Reduced Basis)](#coding-challenge-4-k-th-smallest-subset-xor-reduced-basis)
11. [Closing Tips](#closing-tips)

---

## Quick-Reference Cheat Sheet

| Concept | Key fact |
|---------|----------|
| Binary trie | Store numbers MSB-first; greedy opposite-bit walk maximizes XOR. |
| Max XOR pair | Insert all, query each: `O(n·B)`. |
| Max XOR of `x` vs set | Opposite-bit walk: `O(B)`. |
| Min XOR of `x` vs set | Same-bit walk: `O(B)`. |
| Count pairs XOR < k | Subtree counts + threshold routing: `O(n·B)`. |
| Deletion | Subtree counts; child exists iff `cnt > 0`. |
| Linear basis | Reduced ≤ `B` vectors; subset XOR = GF(2) linear combo. |
| Max subset XOR | Greedy high→low over pivots: `O(B)`. |
| Distinct subset XORs | Exactly `2^rank`. |
| k-th subset XOR | Reduce to RREF, read bits of `k`: `O(B)`. |
| Trie vs basis | Trie = pairs/elements; basis = subset span. |

---

## Junior Questions

### J1. What is a binary trie and why MSB-first?
A tree where each node has children for bit `0` and bit `1`; a number is a depth-`B` path. We insert MSB-first so the highest bits are decided first, which is required because integer comparison is dominated by the highest differing bit.

### J2. How do you find the max XOR of a query `x` against a set?
Walk down the trie; at each level prefer the child opposite to `x`'s bit (it makes that XOR bit `1`); if it is missing, take the same-bit child. The path spells the best partner; `O(B)`.

### J3. How do you solve "maximum XOR pair in an array"?
Insert numbers into the trie and query each with the opposite-bit walk, tracking the max. Total `O(n·B)` versus `O(n²)` brute force.

### J4. Why does the greedy choice work?
A `1` in a high bit outweighs any combination of lower bits, so securing the highest possible bit first is always optimal (MSB dominance).

### J5. How do you pick the bit-width `B`?
Smallest `B` with `2^B > max_value`: 30 for values `< 10^9`, 32 for 32-bit, 64 for 64-bit.

### J6. What is the XOR linear basis in one sentence?
A reduced set of at most `B` independent numbers whose subset-XORs reproduce every XOR achievable from the original collection.

### J7. How do you get the maximum subset XOR from a basis?
Start at `0`; for each pivot from high to low, XOR it in if doing so increases the result.

### J8. How many distinct XOR values can a collection produce?
Exactly `2^rank`, where `rank` is the number of basis vectors.

### J9. What is the difference between the trie and the basis?
The trie answers questions about *pairs/elements* (max XOR of two numbers); the basis answers questions about the *XOR span of subsets* (max XOR of any combination).

### J10. How do you find the minimum XOR of `x` against a set?
Same trie, but take the *same*-bit child when possible (forcing XOR bit `0` at high positions).

### J11. Can a trie store duplicates?
Yes, with subtree counts: duplicates increment counts along the shared path rather than creating new paths.

### J12 (analysis). Why is each trie operation `O(B)` and not `O(n)`?
Each insert or query takes exactly one step per bit position, independent of how many numbers are stored.

---

## Middle Questions

### M1. How do you count pairs with XOR < k using a trie?
Add subtree counts. For each element, route by `k`'s bits: when `k`'s bit is `1`, the same-bit child (XOR bit `0`) is entirely `< k`, so add its whole count and continue down the other child; when `k`'s bit is `0`, descend the same-bit child only.

### M2. How do you support deletion in a trie?
Decrement subtree counts along the value's path; treat a child as present only when its count is positive.

### M3. How do you test if a value `v` is representable by a basis?
Reduce `v` against the basis; it is representable iff it reduces to `0`.

### M4. How do you get the k-th smallest achievable XOR?
Reduce the basis to row-echelon form so each pivot bit is unique, list pivots low→high, then XOR in the pivots selected by the set bits of `k`.

### M5. When do you choose the basis over the trie?
When the question concerns the XOR span of subsets (max/min/k-th/count/representable/merge) rather than individual elements or pairs, and especially when memory must stay `O(B)`.

### M6. How does max XOR pair via trie differ from max subset XOR via basis?
The pair answer maximizes `a ^ b` for two stored numbers; the subset answer maximizes the XOR of any combination — usually a larger value.

### M7. Why does the basis use only `O(B)` space?
It keeps at most one pivot per bit position; dependent vectors reduce to `0` and are discarded.

### M8. How do you merge two bases?
Insert each nonzero vector of one basis into the other via the reducing `add`; the result spans the union.

### M9. What is the prefix-XOR trick?
`xor(l..r) = P[r+1] ^ P[l]` where `P` is the prefix-XOR array; it converts "max XOR subarray" into "max XOR pair over `P`".

### M10. How do you do max XOR over a value-constrained subset (a ≤ m)?
Sort array and queries by the limit; sweep, inserting eligible elements with a monotone pointer before each query. Offline, `O((n+q)·B)`.

### M11. Why can't the basis delete elements?
Reduction destroys element identity; once absorbed, a vector's contribution to pivots cannot be isolated without rebuilding (or a timestamped variant).

### M12 (analysis). What is the growth of distinct XORs as you add elements?
Each independent insertion doubles the distinct count (`2^rank`); dependent insertions leave it unchanged.

---

## Senior Questions

### S1. How do you handle "max XOR with index range [l, r]"?
Persistent binary trie: keep `root[i]` for the prefix, query with version-difference counts (`cnt_{r+1} - cnt_l`) to know which children exist in the range.

### S2. How do you choose node representation for performance?
Array-pooled integer-index nodes (one flat array, `0` = root = null sentinel) for cache locality and one allocation, instead of per-node pointer objects.

### S3. How do you support range subset-XOR maxima?
Segment tree of bases; each node holds its segment's basis, queries merge `O(log n)` bases at `O(B²)` each.

### S4. How do you support a sliding window on the basis?
Store a timestamp with each pivot, keep the newest vector at each pivot, and use only pivots with timestamp `≥ l` when querying a suffix window.

### S5. How do you reset structures between many test cases without TLE?
Zero only the used prefix (`size` nodes / used pivots), never the full capacity.

### S6. What are the main failure modes to guard against?
Bit-width underflow, signed-shift overflow at `B ≥ 32`, sentinel collisions (`0` as root and null), missing resets, and k-th queries on an un-reduced basis.

### S7. How do you verify correctness for huge `n`?
Property-based testing against tiny brute-force oracles (`O(n²)` pairs, `2^n` subsets) on random small inputs with a fixed seed.

### S8. How big is the trie in memory and how do you bound it?
`O(n·B)` nodes; bound it by tightening `B`, using a basis when subset answers suffice, or path compression.

### S9. How would you count distinct XOR values in a stream?
Maintain a basis incrementally; the answer is `2^rank` at any time, in `O(B)` per element and `O(B)` memory.

### S10 (analysis). Why does the segment-tree-of-bases query cost `O(B² log n)`?
A range decomposes into `O(log n)` canonical segments; merging their bases costs `O(B²)` each.

---

## Professional Questions

### P1. Prove the greedy max-XOR walk is optimal.
By MSB dominance: at the highest differing XOR bit, the walk sets `1` whenever any surviving candidate allows it; if none does, all candidates (including the optimum) have `0` there. An exchange argument shows the greedy result cannot be beaten. (Full proof in `professional.md`.)

### P2. Why is the number of distinct subset XORs exactly `2^rank`?
The map from `(GF(2))^rank` to the span via the basis is a linear bijection (surjective by spanning, injective by independence), so the span has `2^rank` elements.

### P3. Why does XOR-Gaussian elimination produce a correct basis?
Each reduction step is an invertible GF(2) row operation preserving span; the stored vectors have unique pivot positions, hence are independent — an independent spanning set is a basis.

### P4. Why does the RREF basis give the k-th smallest XOR in order?
In RREF each pivot bit belongs to exactly one vector, so including that vector toggles exactly that pivot bit; pivot bits dominate ordering, making the bit-pattern-of-`k` to span map order-preserving.

### P5. What is the complexity of basis reduce and merge?
Reduce to RREF and merge are both `O(B²)`; add/max/min/representable are `O(B)`.

### P6. How does subset XOR relate to linear algebra over GF(2)?
A subset XOR is precisely a linear combination with `0/1` coefficients over GF(2); independence means no nonempty subset XORs to `0`.

### P7. Can the trie and basis solve the same problem?
Only when the question is expressible both ways; in general "pair XOR" (trie) and "subset XOR" (basis) are different and not reducible to each other.

### P8. Why is `O(B)` effectively constant for these structures?
For `B ≤ 64`, each XOR/shift is one machine-word operation, so the bit factor is tiny with small constants.

---

## Behavioral Prompts

- *"Tell me about a time you reduced an `O(n²)` solution to near-linear."* — Frame the max-XOR-pair trie: identify the quadratic pair scan, introduce the bitwise trie, quantify the `O(n·B)` win, mention verification against brute force.
- *"Describe debugging a subtle data-structure bug."* — Discuss a sentinel collision (`0` as root and null child) or a bit-width underflow that silently returned small answers; explain how property-based testing surfaced it.
- *"How do you decide between two viable data structures?"* — Use the trie-vs-basis decision: pair/element vs subset, memory budget, deletion needs.
- *"Tell me about choosing correctness verification under uncertainty."* — Explain randomized testing against an `O(2^n)` subset oracle when `n` is too large to reason about by hand.
- *"A teammate proposes the basis for a max-XOR-pair problem. How do you respond?"* — Politely point out the basis answers subset XOR, not pair XOR; suggest the trie; back it with a counterexample.

---

## Coding Challenge 1: Maximum XOR Pair (Trie)

**Problem.** Given `nums`, return `max(nums[i] ^ nums[j])` over all `i < j`.
**Constraints.** `2 ≤ n ≤ 2·10^5`, `0 ≤ nums[i] < 2^30`.
**Approach.** Insert all into an MSB-first trie; query each with the opposite-bit walk.

### Go
```go
package main

import "fmt"

const B = 30

func findMaximumXOR(nums []int) int {
	ch := make([][2]int, 1, len(nums)*B+1)
	insert := func(x int) {
		node := 0
		for i := B - 1; i >= 0; i-- {
			b := (x >> i) & 1
			if ch[node][b] == 0 {
				ch = append(ch, [2]int{0, 0})
				ch[node][b] = len(ch) - 1
			}
			node = ch[node][b]
		}
	}
	query := func(x int) int {
		node, res := 0, 0
		for i := B - 1; i >= 0; i-- {
			b := (x >> i) & 1
			if ch[node][1-b] != 0 {
				res |= 1 << i
				node = ch[node][1-b]
			} else {
				node = ch[node][b]
			}
		}
		return res
	}
	insert(nums[0])
	best := 0
	for i := 1; i < len(nums); i++ {
		if v := query(nums[i]); v > best {
			best = v
		}
		insert(nums[i])
	}
	return best
}

func main() { fmt.Println(findMaximumXOR([]int{3, 10, 5, 25, 2, 8})) } // 28
```

### Java
```java
public class MaxXorPair {
    static final int B = 30;
    public static int findMaximumXOR(int[] nums) {
        int cap = nums.length * B + 1;
        int[][] ch = new int[cap][2];
        int[] size = {1};
        java.util.function.IntConsumer insert = x -> {
            int node = 0;
            for (int i = B - 1; i >= 0; i--) {
                int b = (x >> i) & 1;
                if (ch[node][b] == 0) { ch[size[0]][0] = 0; ch[size[0]][1] = 0; ch[node][b] = size[0]++; }
                node = ch[node][b];
            }
        };
        java.util.function.IntUnaryOperator query = x -> {
            int node = 0, res = 0;
            for (int i = B - 1; i >= 0; i--) {
                int b = (x >> i) & 1;
                if (ch[node][1 - b] != 0) { res |= (1 << i); node = ch[node][1 - b]; }
                else node = ch[node][b];
            }
            return res;
        };
        insert.accept(nums[0]);
        int best = 0;
        for (int i = 1; i < nums.length; i++) { best = Math.max(best, query.applyAsInt(nums[i])); insert.accept(nums[i]); }
        return best;
    }
    public static void main(String[] a) { System.out.println(findMaximumXOR(new int[]{3, 10, 5, 25, 2, 8})); } // 28
}
```

### Python
```python
B = 30


def find_maximum_xor(nums):
    ch = [[0, 0]]

    def insert(x):
        node = 0
        for i in range(B - 1, -1, -1):
            b = (x >> i) & 1
            if ch[node][b] == 0:
                ch.append([0, 0])
                ch[node][b] = len(ch) - 1
            node = ch[node][b]

    def query(x):
        node, res = 0, 0
        for i in range(B - 1, -1, -1):
            b = (x >> i) & 1
            if ch[node][1 - b] != 0:
                res |= 1 << i
                node = ch[node][1 - b]
            else:
                node = ch[node][b]
        return res

    insert(nums[0])
    best = 0
    for x in nums[1:]:
        best = max(best, query(x))
        insert(x)
    return best


if __name__ == "__main__":
    print(find_maximum_xor([3, 10, 5, 25, 2, 8]))  # 28
```

---

## Coding Challenge 2: Maximum XOR Subset (Basis)

**Problem.** Given `nums`, return the maximum XOR obtainable from any subset.
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ nums[i] < 2^30`.
**Approach.** Build a linear basis; greedily combine pivots high→low.

### Go
```go
package main

import "fmt"

func maxSubsetXor(nums []int) int {
	const B = 30
	basis := make([]int, B)
	for _, x := range nums {
		for i := B - 1; i >= 0; i-- {
			if (x>>i)&1 == 0 {
				continue
			}
			if basis[i] == 0 {
				basis[i] = x
				break
			}
			x ^= basis[i]
		}
	}
	res := 0
	for i := B - 1; i >= 0; i-- {
		if basis[i] != 0 && res^basis[i] > res {
			res ^= basis[i]
		}
	}
	return res
}

func main() { fmt.Println(maxSubsetXor([]int{3, 10, 5, 25, 2, 8})) }
```

### Java
```java
public class MaxSubsetXor {
    public static long maxSubsetXor(long[] nums) {
        int B = 30;
        long[] basis = new long[B];
        for (long x : nums) {
            for (int i = B - 1; i >= 0; i--) {
                if (((x >> i) & 1) == 0) continue;
                if (basis[i] == 0) { basis[i] = x; break; }
                x ^= basis[i];
            }
        }
        long res = 0;
        for (int i = B - 1; i >= 0; i--)
            if (basis[i] != 0 && (res ^ basis[i]) > res) res ^= basis[i];
        return res;
    }
    public static void main(String[] a) { System.out.println(maxSubsetXor(new long[]{3, 10, 5, 25, 2, 8})); }
}
```

### Python
```python
def max_subset_xor(nums):
    B = 30
    basis = [0] * B
    for x in nums:
        for i in range(B - 1, -1, -1):
            if not (x >> i) & 1:
                continue
            if basis[i] == 0:
                basis[i] = x
                break
            x ^= basis[i]
    res = 0
    for i in range(B - 1, -1, -1):
        if basis[i] and (res ^ basis[i]) > res:
            res ^= basis[i]
    return res


if __name__ == "__main__":
    print(max_subset_xor([3, 10, 5, 25, 2, 8]))
```

---

## Coding Challenge 3: Count Pairs with XOR < k (Trie + Counts)

**Problem.** Count unordered pairs `(i, j)` with `nums[i] ^ nums[j] < k`.
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ nums[i], k < 2^20`.
**Approach.** Trie with subtree counts; insert incrementally and route by `k`'s bits.

### Go
```go
package main

import "fmt"

func countPairsXorLess(nums []int, k int) int64 {
	const B = 20
	ch := make([][2]int, 1, len(nums)*B+1)
	cnt := make([]int, 1, len(nums)*B+1)
	insert := func(x int) {
		node := 0
		for i := B - 1; i >= 0; i-- {
			b := (x >> i) & 1
			if ch[node][b] == 0 {
				ch = append(ch, [2]int{0, 0})
				cnt = append(cnt, 0)
				ch[node][b] = len(ch) - 1
			}
			node = ch[node][b]
			cnt[node]++
		}
	}
	countLess := func(x, k int) int64 {
		node := 0
		var total int64
		for i := B - 1; i >= 0; i-- {
			xb := (x >> i) & 1
			kb := (k >> i) & 1
			if kb == 1 {
				if s := ch[node][xb]; s != 0 {
					total += int64(cnt[s])
				}
				node = ch[node][1-xb]
			} else {
				node = ch[node][xb]
			}
			if node == 0 {
				break
			}
		}
		return total
	}
	var total int64
	for _, v := range nums {
		total += countLess(v, k)
		insert(v)
	}
	return total
}

func main() { fmt.Println(countPairsXorLess([]int{1, 2, 3, 4, 5}, 5)) }
```

### Java
```java
public class CountPairsXorLess {
    public static long solve(int[] nums, int k) {
        int B = 20, cap = nums.length * B + 1;
        int[][] ch = new int[cap][2];
        int[] cnt = new int[cap];
        int[] size = {1};
        long total = 0;
        for (int v : nums) {
            // count
            int node = 0;
            for (int i = B - 1; i >= 0; i--) {
                int xb = (v >> i) & 1, kb = (k >> i) & 1;
                if (kb == 1) { int s = ch[node][xb]; if (s != 0) total += cnt[s]; node = ch[node][1 - xb]; }
                else node = ch[node][xb];
                if (node == 0) break;
            }
            // insert
            node = 0;
            for (int i = B - 1; i >= 0; i--) {
                int b = (v >> i) & 1;
                if (ch[node][b] == 0) { ch[node][b] = size[0]++; }
                node = ch[node][b];
                cnt[node]++;
            }
        }
        return total;
    }
    public static void main(String[] a) { System.out.println(solve(new int[]{1, 2, 3, 4, 5}, 5)); }
}
```

### Python
```python
def count_pairs_xor_less(nums, k):
    B = 20
    ch = [[0, 0]]
    cnt = [0]

    def insert(x):
        node = 0
        for i in range(B - 1, -1, -1):
            b = (x >> i) & 1
            if ch[node][b] == 0:
                ch.append([0, 0])
                cnt.append(0)
                ch[node][b] = len(ch) - 1
            node = ch[node][b]
            cnt[node] += 1

    def count_less(x, kk):
        node, total = 0, 0
        for i in range(B - 1, -1, -1):
            xb = (x >> i) & 1
            kb = (kk >> i) & 1
            if kb == 1:
                s = ch[node][xb]
                if s:
                    total += cnt[s]
                node = ch[node][1 - xb]
            else:
                node = ch[node][xb]
            if node == 0:
                break
        return total

    total = 0
    for v in nums:
        total += count_less(v, k)
        insert(v)
    return total


if __name__ == "__main__":
    print(count_pairs_xor_less([1, 2, 3, 4, 5], 5))
```

---

## Coding Challenge 4: k-th Smallest Subset XOR (Reduced Basis)

**Problem.** Given `nums` and a 1-indexed `k`, return the k-th smallest distinct value obtainable as a subset XOR (including the empty subset value `0`). Return `-1` if `k` exceeds the count of distinct values.
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ nums[i] < 2^30`, `1 ≤ k`.
**Approach.** Build basis, reduce to RREF, list pivots low→high, read bits of `k-1`.

### Go
```go
package main

import "fmt"

func kthSubsetXor(nums []int, k int64) int64 {
	const B = 30
	basis := make([]int64, B)
	for _, x := range nums {
		v := int64(x)
		for i := B - 1; i >= 0; i-- {
			if (v>>uint(i))&1 == 0 {
				continue
			}
			if basis[i] == 0 {
				basis[i] = v
				break
			}
			v ^= basis[i]
		}
	}
	// reduce to RREF
	for i := 0; i < B; i++ {
		if basis[i] == 0 {
			continue
		}
		for j := 0; j < B; j++ {
			if j != i && basis[j] != 0 && (basis[j]>>uint(i))&1 == 1 {
				basis[j] ^= basis[i]
			}
		}
	}
	piv := []int64{}
	for i := 0; i < B; i++ {
		if basis[i] != 0 {
			piv = append(piv, basis[i])
		}
	}
	k-- // 0-indexed; index 0 is value 0 (empty subset)
	if k >= (int64(1) << uint(len(piv))) {
		return -1
	}
	var res int64
	for t := 0; t < len(piv); t++ {
		if (k>>uint(t))&1 == 1 {
			res ^= piv[t]
		}
	}
	return res
}

func main() { fmt.Println(kthSubsetXor([]int{3, 10, 5, 25, 2, 8}, 4)) }
```

### Java
```java
import java.util.*;
public class KthSubsetXor {
    public static long solve(long[] nums, long k) {
        int B = 30;
        long[] basis = new long[B];
        for (long x : nums) {
            for (int i = B - 1; i >= 0; i--) {
                if (((x >> i) & 1) == 0) continue;
                if (basis[i] == 0) { basis[i] = x; break; }
                x ^= basis[i];
            }
        }
        for (int i = 0; i < B; i++) {
            if (basis[i] == 0) continue;
            for (int j = 0; j < B; j++)
                if (j != i && basis[j] != 0 && ((basis[j] >> i) & 1) == 1) basis[j] ^= basis[i];
        }
        List<Long> piv = new ArrayList<>();
        for (int i = 0; i < B; i++) if (basis[i] != 0) piv.add(basis[i]);
        k--; // 0-indexed; value 0 is index 0
        if (k >= (1L << piv.size())) return -1;
        long res = 0;
        for (int t = 0; t < piv.size(); t++) if (((k >> t) & 1) == 1) res ^= piv.get(t);
        return res;
    }
    public static void main(String[] a) { System.out.println(solve(new long[]{3, 10, 5, 25, 2, 8}, 4)); }
}
```

### Python
```python
def kth_subset_xor(nums, k):
    B = 30
    basis = [0] * B
    for x in nums:
        for i in range(B - 1, -1, -1):
            if not (x >> i) & 1:
                continue
            if basis[i] == 0:
                basis[i] = x
                break
            x ^= basis[i]
    # reduce to RREF
    for i in range(B):
        if basis[i] == 0:
            continue
        for j in range(B):
            if j != i and basis[j] and (basis[j] >> i) & 1:
                basis[j] ^= basis[i]
    piv = [basis[i] for i in range(B) if basis[i]]
    k -= 1  # 0-indexed; index 0 is value 0 (empty subset)
    if k >= (1 << len(piv)):
        return -1
    res = 0
    for t in range(len(piv)):
        if (k >> t) & 1:
            res ^= piv[t]
    return res


if __name__ == "__main__":
    print(kth_subset_xor([3, 10, 5, 25, 2, 8], 4))
```

---

## Closing Tips

- State the structure choice early: "pair/element → trie; subset → basis." Interviewers reward the crisp distinction.
- Always mention the bit-width `B` and why you chose it.
- For the trie, narrate the greedy opposite-bit walk and *why* it is optimal (MSB dominance) — that is the insight under test.
- For the basis, mention `2^rank` distinct values and that subset XOR is linear algebra over GF(2).
- Offer the brute-force oracle as your verification plan; it signals engineering maturity.
- Watch the off-by-one on k-th queries (empty subset is value `0` at index `0`).
- If asked for constraints (value ≤ limit or index range), reach for offline sorting or a persistent trie, and say so explicitly.

# XOR Pairing & XOR Identities — Interview Preparation

XOR is an interview favourite because it rewards a single crisp insight — *"things that appear in pairs cancel, because `x ^ x = 0`"* — and then tests whether you can (a) extend it to the harder variants (others appear three times, two distinct singles), (b) recognize the same self-inverse algebra behind missing-number and subarray-XOR queries, (c) reach for the partition-by-a-set-bit technique when one accumulator is not enough, and (d) avoid the trap of thinking XOR can recover counts or stand alone as a checksum. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges (Single Number I / II / III, Missing Number, Subarray XOR queries) with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Single element, others appear twice | XOR-all the array | `O(n)` time, `O(1)` space |
| Single element, others appear three times | mod-3 two-accumulator (`ones`, `twos`) | `O(n)` time, `O(1)` space |
| Two distinct singles, others twice | XOR-all → isolate a set bit → split → XOR each group | `O(n)` time, `O(1)` space |
| Missing number in `[0..n]` | XOR all indices `0..n` with all values | `O(n)` time, `O(1)` space |
| Find the duplicate (`[0..n-1]` + 1 extra) | XOR all values with `0..n-1` | `O(n)` time, `O(1)` space |
| XOR of range `[0..n]` | period-4 closed form (`n,1,n+1,0`) | `O(1)` |
| XOR of subarray `[l..r]` | prefix XOR: `pre[r+1] ^ pre[l]` | `O(1)` after `O(n)` build |
| Gray code of `x` | `x ^ (x >> 1)` | `O(1)` |
| **Recover counts / multiset** | **impossible with XOR alone** | — |

The identities (everything reduces to these):

```text
x ^ 0 = x          (0 is identity)
x ^ x = 0          (self-inverse: pairs cancel)
a ^ b = b ^ a      (commutative -> order-independent)
(a^b)^c = a^(b^c)  (associative -> regroup freely)
x & (-x)           (isolates the lowest set bit; used to split two singles)
```

Key facts:
- XOR records **parity** (odd/even count) per bit — never actual counts.
- XOR-all finds the element with **odd** multiplicity; the rest must be even.
- XOR is **carry-free**, so it never overflows (unlike Gauss-sum tricks).
- Operator precedence of `^` is **low** in C-family languages — parenthesize.

---

## Junior Questions (12 Q&A)

### J1. What does `x ^ x` equal, and why does it matter?
`x ^ x = 0`. Every bit XORed with itself is `0`. This **self-inverse** property is the whole foundation: in a long XOR chain, anything appearing an even number of times cancels to `0`.

### J2. What is `x ^ 0`?
`x`. Zero is the **identity element** for XOR: XORing with `0` changes nothing. It is the natural starting value for an XOR accumulator.

### J3. How do you find the single number when every other element appears twice?
XOR all elements together. Pairs cancel (`x^x=0`), the lone element survives (`x^0=x`). One pass, one accumulator: `acc ^= x`. `O(n)` time, `O(1)` space.

### J4. Why can you process the array in any order?
XOR is **commutative** (`a^b=b^a`) and **associative** (`(a^b)^c=a^(b^c)`), so reordering and regrouping never change the result. You can mentally pair up duplicates regardless of their positions.

### J5. Does XOR-all work on negative numbers?
Yes. XOR is purely bitwise and ignores sign; two's-complement bits XOR correctly. No special handling needed.

### J6. What happens on an empty array?
The accumulator stays at its seed `0`, so XOR-all returns `0`. Decide in context whether that means "no answer."

### J7. Why is XOR-all better than a hash set for the single-number problem?
Same `O(n)` time, but `O(1)` space instead of `O(n)`. The hash set stores every element; XOR-all stores one integer.

### J8. Can XOR tell you how many times an element appeared?
No. XOR records only **parity** (odd vs even), never the actual count. If you need counts, use a counter.

### J9. How do you swap two variables with XOR?
`a ^= b; b ^= a; a ^= b`. Each variable gets XORed twice with the other, and self-inverse cancels the extras. It is a teaching trick — use a temporary in production (and never on aliased storage, which zeroes the value).

### J10. How do you toggle a single bit `i` of `x`?
`x ^ (1 << i)`. XORing with a one-hot mask flips exactly bit `i` and leaves the rest untouched.

### J11. What is the time and space complexity of XOR-all?
`O(n)` time (one pass) and `O(1)` space (one accumulator). XOR is a single CPU instruction, so the constant factor is tiny.

### J12 (analysis). Why does XOR-all never overflow?
XOR has no carry — each bit is computed independently. Unlike summing (which can overflow), XORing arbitrarily many fixed-width integers stays within the same width.

---

## Middle Questions (12 Q&A)

### M1. Prove XOR-all isolates the single element.
Group the fold by distinct value (allowed by commutativity/associativity). A value appearing an even number of times XORs to `0` (`x^x=0` repeatedly); the one value appearing an odd number of times XORs to itself; `^0` survives. So the fold equals the odd-count value.

### M2. How do you find the single number when others appear three times?
Plain XOR-all fails (triples do not cancel). Count each bit's occurrences **mod 3**. The `O(1)`-space version uses two accumulators: `ones = (ones^x)&~twos; twos = (twos^x)&~ones`. After the pass, `ones` holds the single element.

### M3. Why do two accumulators implement "count mod 3"?
Each bit's `(twos, ones)` pair encodes a base-3 counter cycling `00 → 01 → 10 → 00` as the bit is seen 0,1,2,3 times. After three sightings a bit returns to `00`, so triples vanish and only the once-seen bits remain set in `ones`.

### M4. How do you find two distinct elements that each appear once (rest twice)?
XOR-all gives `a ^ b`. It is nonzero (since `a≠b`), so it has a set bit where `a` and `b` differ. Isolate one with `x & (-x)`, partition the array on that bit, and XOR each group separately — `a` and `b` land in different groups, each becoming a single-number subproblem.

### M5. Why is the lowest set bit (`x & -x`) a valid splitter?
A set bit of `a ^ b` is a position where `a` and `b` differ, so exactly one of them has that bit set — they go to different partitions. Every paired duplicate has identical bits, so both copies land in the same partition and cancel there. The lowest set bit is chosen only because `x & -x` computes it branch-free.

### M6. How do you find a missing number in `[0..n]` with XOR?
XOR all the array values together with all the indices `0..n`. Every present value cancels its matching index; the missing value has no array partner and survives. Overflow-proof, unlike `n(n+1)/2 - sum`.

### M7. What is the closed form for the XOR of `0..n`?
Period 4 in `n mod 4`: `n` if `n%4==0`, `1` if `==1`, `n+1` if `==2`, `0` if `==3`. It works because each aligned block `{4m,4m+1,4m+2,4m+3}` XORs to `0`, leaving a short tail.

### M8. How do you XOR an arbitrary range `[a..b]`?
`xorUpTo(b) ^ xorUpTo(a-1)`, where `xorUpTo` is the period-4 formula. The shared prefix `xorUpTo(a-1)` cancels itself (self-inverse), leaving exactly `a..b`.

### M9. How do prefix XORs answer subarray-XOR queries in `O(1)`?
Define `pre[0]=0`, `pre[i]=a[0]^…^a[i-1]`. Then `XOR(a[l..r]) = pre[r+1] ^ pre[l]`; the common prefix `pre[l]` cancels. Build is `O(n)`, each query `O(1)`.

### M10. What is a Gray code and how is it generated?
An ordering where consecutive integers differ in exactly one bit. `gray(x) = x ^ (x >> 1)`. Consecutive Gray codes differ in a single bit, which is why rotary encoders use them (no transient multi-bit misreads).

### M11. How do you count subarrays with XOR equal to K?
Maintain a frequency map of prefix XORs. A subarray `(l,r]` has XOR `K` iff `pre[l] = pre[r+1] ^ K` (self-inverse). For each right endpoint add `cnt[pre ^ K]` then record the current prefix. `O(n)`.

### M12 (analysis). When is XOR the wrong tool?
When you need counts/multiplicity, when three-plus elements have odd count and you cannot split them by one bit, or when the data is not bit-addressable. XOR only answers parity, single/two-singles, missing/duplicate, and range/prefix questions.

---

## Senior Questions (10 Q&A)

### S1. Generalize the single-number trick to "others appear k times."
Count each bit position's occurrences **mod k** and reassemble. The single element (appearing `1 mod k` times) contributes its bits once; multiples of `k` contribute `0 mod k`. For `k=3` use the two-accumulator machine; for general `k` use `⌈log2 k⌉` bitmask accumulators encoding a per-bit mod-`k` counter. `k=2` is plain XOR-all.

### S2. Why is XOR a weak checksum, formally?
XOR is **linear** over GF(2). Linearity means an attacker can flip data bits and compensate in the parity, and accidental two-bit-per-column or reordering errors cancel undetected. The set of undetected errors is the kernel of the linear fold — most of the error space. Use CRC for accidental corruption, a MAC/hash for tamper resistance.

### S3. How is XOR used in RAID parity?
RAID 4/5 stores `P = D_0 ^ … ^ D_{m-1}`. Any single lost block is reconstructed by XORing the parity with the survivors (self-inverse). A single block update patches parity in place: `P ^= old ^ new`. It tolerates exactly one erasure; two failures need RAID 6's second GF(2^8) syndrome.

### S4. How does XOR support constant-memory streaming?
Associativity and order-independence let one accumulator hold the running XOR of an unbounded stream (`O(1)` memory). For a sliding window, self-inverse removes the departing element: `acc ^= leaving; acc ^= entering`. It is also a perfect parallel reduce: shard, XOR locally, XOR the shard results in any order.

### S5. When is XOR-combine the wrong way to hash a collection?
When order or multiplicity matters. XOR-combine is commutative (ignores order) and self-inverse (duplicates vanish), so `{a,b}` and `{b,a}` collide and `{a,a,b}` hashes like `{b}`. Use it only as an intentional commutative *set* fingerprint over a strong per-element hash; otherwise add nonlinearity/position.

### S6. How do you handle the mod-3 trick for negative or fixed-width inputs in Python?
Python ints are arbitrary-precision and `~` yields a negative two's-complement-style value. Mask to a fixed width (`& 0xFFFFFFFF`) and reinterpret the sign bit if inputs may be negative; otherwise the masking is transparent for nonnegative inputs.

### S7. Why can't a single bit split three distinct singles?
By pigeonhole, among three values at least two agree on any chosen bit and land in the same partition, which then has two odd survivors. Recovering three-plus singles needs a linear (XOR) basis via Gaussian elimination over GF(2) — the structures in sibling `06-binary-trie-xor-basis`.

### S8. How do you verify an XOR algorithm when the result is opaque?
Compare against a counting oracle on small random inputs. Add property tests: order-independence (`xorAll(perm(xs)) == xorAll(xs)`), self-inverse (`acc^x^x == acc`), and for parity systems the invariant `XOR(blocks + P) == 0`. For RAID, a reconstruction round trip (lose each block, rebuild, diff) is the single best test.

### S9. Why prefer XOR over the Gauss sum for missing-number?
Both are `O(n)`/`O(1)`, but `n(n+1)/2 - Σ` can overflow for large `n` (needs wide integers), while XOR is carry-free and never overflows. XOR is the safer default.

### S10 (analysis). What exactly does XOR-all return when the precondition is violated?
The XOR of all **odd-multiplicity** values. With one odd value it returns that value; with two it returns their XOR; with none it returns `0`. So XOR-all cannot distinguish "single value is 0" from "no single value" — both give `0`. The precondition must be guaranteed externally.

---

## Professional Questions (8 Q&A)

### P1. Design a service answering "XOR of items in range [l..r]" over a large append-only log.
Maintain a prefix-XOR array (or a Fenwick/segment tree if updates occur). Static log: `pre[r+1] ^ pre[l]` in `O(1)` after `O(n)` build. With point updates, a Fenwick tree over XOR (XOR is an invertible group operation) gives `O(log n)` update and prefix query; range query is the XOR of two prefix queries.

### P2. You need the exact count of each value, but only have XOR signatures. What do you do?
You cannot — XOR is parity-blind (it factors through multiplicity parities). Carry counts separately (a counter or Count-Min sketch), or use a structure like an invertible Bloom lookup table (IBLT) that pairs XOR signatures with counters to recover set differences. XOR alone answers only parity/erasure questions.

### P3. How would you detect a single corrupted block AND locate it?
XOR parity detects a mismatch but cannot localize (one equation, two unknowns when the failed drive is unknown). Pair RAID XOR parity with an *independent* per-block checksum (CRC or cryptographic hash) so corruption is both detected by parity and localized by the per-block check. Scrub periodically.

### P4. How do you debug "the single-number answer is wrong" in production?
Run the counting oracle on the exact small input and diff. Check the three usual suspects: the input violated the "exactly one odd-count" precondition; an operator-precedence bug (`a ^ b == c` parsed as `a ^ (b==c)`); or a width/signedness mismatch across languages. Add an order-independence property test.

### P5. When is the two-singles split the wrong approach?
When more than two elements appear an odd number of times (one bit cannot separate three-plus), or when `a == b` (then `xorAll == 0`, no splitting bit — the precondition is violated). For multi-singles use a GF(2) linear basis. Assert `xorAll != 0` before splitting.

### P6. How would you parallelize XOR aggregation across a cluster?
XOR is associative and commutative, so it is a coordination-free reduce: each node XORs its shard, then shard results XOR together in any order to the global signature. This is how RAID parallelizes per-byte-column and how gossip-based set reconciliation aggregates fingerprints. No locking, no ordering.

### P7. Explain why Gray codes use `x ^ (x >> 1)` in a hardware context.
Successive Gray codes differ in exactly one bit, so a rotary/linear encoder changes only one contact per step — eliminating the transient invalid readings you would get if multiple bits flipped at slightly different times (as in ordinary binary, e.g. `0111 → 1000` flips four bits). `x ^ (x>>1)` is the cheap encode; a prefix-XOR scan decodes back to binary.

### P8 (analysis). Why is XOR linearity simultaneously a strength and a weakness?
Strength: linearity gives perfect cancellation (RAID reconstruct, `O(1)` reversible streaming state, group-difference range queries) and order-free parallel reduces. Weakness: linearity means the function is trivially invertible, order-blind, and adversarially compensable — so it cannot serve as a secure MAC or a strong corruption detector. The same algebra that makes XOR cheap makes it weak for integrity.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n)`-space solution with an `O(1)`-space one.
Look for a concrete story: a single-number / dedup / parity task where memory mattered (a stream or embedded constraint), the insight that the structure was "all even but one," the switch from a hash set to an XOR accumulator, and the measured memory/latency win. Strong answers mention validating against the old hash-based version first.

### B2. A teammate used XOR to checksum data on a channel and it passed corrupted payloads. How do you handle it?
Explain calmly that XOR is linear, so it misses reordering and even-count bit errors and offers no tamper resistance. Recommend CRC for accidental corruption and a MAC/hash if an adversary is in scope. Frame it as "XOR is for erasure recovery, not integrity," with a small example of two undetected flips. Teaching moment, not blame.

### B3. Design a feature to reconcile two large unordered sets across nodes with minimal bandwidth.
XOR a strong per-element hash into a fingerprint per node; equal fingerprints suggest equal sets (cheaply). For the *difference*, use an invertible Bloom lookup table (IBLT) — XOR signatures plus counters — which recovers the symmetric difference in size proportional to the difference, not the sets. Discuss collision risk and the set-vs-multiset caveat (even-count elements cancel).

### B4. How would you explain the single-number trick to a junior engineer?
Use the "everyone arrived in pairs except one person" analogy, then the light-switch picture (flip twice = back to start = self-inverse). Show the one-line loop `acc ^= x`. Lead with the two gotchas: it finds the *odd-count* element (precondition), and it gives parity, not counts. Good mentoring leads with the assumptions.

### B5. Your dedup pipeline's XOR signature "loses" some duplicates. How do you investigate?
The signature tracks odd-count residue, so elements appearing an even number of times vanish by design — confirm whether that is the bug or the spec. If exact multiplicity matters, add counters alongside the XOR signature. Check width/signedness consistency across services, and add an order-independence property test to rule out a combiner bug.

---

## Coding Challenges

### Challenge 1: Single Number I (every other element appears twice)

**Problem.** Given a non-empty array where every element appears twice except one, return the element that appears once. `O(n)` time, `O(1)` space.

**Example.**
```text
[2,2,1] -> 1
[4,1,2,1,2] -> 4
```

**Optimal.** XOR-all the array.

**Go.**
```go
package main

import "fmt"

func singleNumber(nums []int) int {
	acc := 0
	for _, x := range nums {
		acc ^= x // pairs cancel; the lone element survives
	}
	return acc
}

func main() {
	fmt.Println(singleNumber([]int{2, 2, 1}))       // 1
	fmt.Println(singleNumber([]int{4, 1, 2, 1, 2})) // 4
}
```

**Java.**
```java
public class SingleNumberI {
    static int singleNumber(int[] nums) {
        int acc = 0;
        for (int x : nums) acc ^= x;
        return acc;
    }

    public static void main(String[] args) {
        System.out.println(singleNumber(new int[]{2, 2, 1}));       // 1
        System.out.println(singleNumber(new int[]{4, 1, 2, 1, 2})); // 4
    }
}
```

**Python.**
```python
from functools import reduce
from operator import xor


def single_number(nums):
    return reduce(xor, nums, 0)


if __name__ == "__main__":
    print(single_number([2, 2, 1]))        # 1
    print(single_number([4, 1, 2, 1, 2]))  # 4
```

---

### Challenge 2: Single Number II (every other element appears three times)

**Problem.** Given an array where every element appears exactly three times except one (which appears once), return the single one. `O(n)` time, `O(1)` space.

**Example.**
```text
[2,2,3,2] -> 3
[0,1,0,1,0,1,99] -> 99
```

**Optimal.** Two-accumulator mod-3 bit counting.

**Go.**
```go
package main

import "fmt"

func singleNumberII(nums []int) int {
	ones, twos := 0, 0
	for _, x := range nums {
		ones = (ones ^ x) &^ twos // Go: &^ is AND NOT
		twos = (twos ^ x) &^ ones
	}
	return ones
}

func main() {
	fmt.Println(singleNumberII([]int{2, 2, 3, 2}))           // 3
	fmt.Println(singleNumberII([]int{0, 1, 0, 1, 0, 1, 99})) // 99
}
```

**Java.**
```java
public class SingleNumberII {
    static int singleNumberII(int[] nums) {
        int ones = 0, twos = 0;
        for (int x : nums) {
            ones = (ones ^ x) & ~twos;
            twos = (twos ^ x) & ~ones;
        }
        return ones;
    }

    public static void main(String[] args) {
        System.out.println(singleNumberII(new int[]{2, 2, 3, 2}));           // 3
        System.out.println(singleNumberII(new int[]{0, 1, 0, 1, 0, 1, 99})); // 99
    }
}
```

**Python.**
```python
def single_number_ii(nums):
    ones = twos = 0
    for x in nums:
        ones = (ones ^ x) & ~twos
        twos = (twos ^ x) & ~ones
    return ones


if __name__ == "__main__":
    print(single_number_ii([2, 2, 3, 2]))           # 3
    print(single_number_ii([0, 1, 0, 1, 0, 1, 99])) # 99
```

---

### Challenge 3: Single Number III (exactly two elements appear once)

**Problem.** Given an array where exactly two elements appear once and all others appear twice, return the two single elements in any order. `O(n)` time, `O(1)` space.

**Example.**
```text
[1,2,1,3,2,5] -> [3,5]
[-1,0] -> [-1,0]
```

**Optimal.** XOR-all → isolate a differing bit → partition → XOR each group.

**Go.**
```go
package main

import "fmt"

func singleNumberIII(nums []int) [2]int {
	xorAll := 0
	for _, x := range nums {
		xorAll ^= x // = a ^ b
	}
	diff := xorAll & (-xorAll) // lowest set bit where a, b differ
	a, b := 0, 0
	for _, x := range nums {
		if x&diff != 0 {
			a ^= x
		} else {
			b ^= x
		}
	}
	return [2]int{a, b}
}

func main() {
	fmt.Println(singleNumberIII([]int{1, 2, 1, 3, 2, 5})) // [3 5] (order may vary)
	fmt.Println(singleNumberIII([]int{-1, 0}))            // [-1 0]
}
```

**Java.**
```java
import java.util.Arrays;

public class SingleNumberIII {
    static int[] singleNumberIII(int[] nums) {
        int xorAll = 0;
        for (int x : nums) xorAll ^= x;       // a ^ b
        int diff = xorAll & (-xorAll);        // lowest differing bit
        int a = 0, b = 0;
        for (int x : nums) {
            if ((x & diff) != 0) a ^= x;
            else b ^= x;
        }
        return new int[]{a, b};
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(singleNumberIII(new int[]{1, 2, 1, 3, 2, 5})));
        System.out.println(Arrays.toString(singleNumberIII(new int[]{-1, 0})));
    }
}
```

**Python.**
```python
from functools import reduce
from operator import xor


def single_number_iii(nums):
    xor_all = reduce(xor, nums, 0)     # a ^ b
    diff = xor_all & (-xor_all)        # lowest set bit (a, b differ here)
    a = b = 0
    for x in nums:
        if x & diff:
            a ^= x
        else:
            b ^= x
    return [a, b]


if __name__ == "__main__":
    print(single_number_iii([1, 2, 1, 3, 2, 5]))  # [3, 5] or [5, 3]
    print(single_number_iii([-1, 0]))             # [-1, 0]
```

---

### Challenge 4: Missing Number and Subarray-XOR Queries

**Problem A (Missing Number).** Given an array of `n` distinct numbers from `[0..n]` (one missing), return the missing one. `O(n)`/`O(1)`, overflow-proof.

**Problem B (Subarray XOR queries).** Given an array and queries `(l, r)`, answer `XOR of nums[l..r]` in `O(1)` each after `O(n)` preprocessing using prefix XORs.

**Go.**
```go
package main

import "fmt"

func missingNumber(nums []int) int {
	acc := len(nums) // include the final index n
	for i, x := range nums {
		acc ^= i ^ x
	}
	return acc
}

type PrefixXor struct{ pre []int }

func newPrefixXor(nums []int) *PrefixXor {
	pre := make([]int, len(nums)+1)
	for i, x := range nums {
		pre[i+1] = pre[i] ^ x
	}
	return &PrefixXor{pre}
}

func (p *PrefixXor) query(l, r int) int { return p.pre[r+1] ^ p.pre[l] }

func main() {
	fmt.Println(missingNumber([]int{3, 0, 1}))             // 2
	fmt.Println(missingNumber([]int{9, 6, 4, 2, 3, 5, 7, 0, 1})) // 8

	px := newPrefixXor([]int{4, 2, 7, 1, 9})
	fmt.Println(px.query(1, 3)) // 2 ^ 7 ^ 1
	fmt.Println(px.query(0, 4)) // whole array
}
```

**Java.**
```java
public class MissingAndPrefix {
    static int missingNumber(int[] nums) {
        int acc = nums.length;              // include index n
        for (int i = 0; i < nums.length; i++) acc ^= i ^ nums[i];
        return acc;
    }

    static class PrefixXor {
        final int[] pre;
        PrefixXor(int[] nums) {
            pre = new int[nums.length + 1];
            for (int i = 0; i < nums.length; i++) pre[i + 1] = pre[i] ^ nums[i];
        }
        int query(int l, int r) { return pre[r + 1] ^ pre[l]; }
    }

    public static void main(String[] args) {
        System.out.println(missingNumber(new int[]{3, 0, 1}));                  // 2
        System.out.println(missingNumber(new int[]{9,6,4,2,3,5,7,0,1}));        // 8

        PrefixXor px = new PrefixXor(new int[]{4, 2, 7, 1, 9});
        System.out.println(px.query(1, 3)); // 2 ^ 7 ^ 1
        System.out.println(px.query(0, 4)); // whole array
    }
}
```

**Python.**
```python
def missing_number(nums):
    acc = len(nums)                # include index n
    for i, x in enumerate(nums):
        acc ^= i ^ x
    return acc


class PrefixXor:
    def __init__(self, nums):
        self.pre = [0] * (len(nums) + 1)
        for i, x in enumerate(nums):
            self.pre[i + 1] = self.pre[i] ^ x

    def query(self, l, r):         # XOR of nums[l..r] inclusive
        return self.pre[r + 1] ^ self.pre[l]


if __name__ == "__main__":
    print(missing_number([3, 0, 1]))                    # 2
    print(missing_number([9, 6, 4, 2, 3, 5, 7, 0, 1]))  # 8

    px = PrefixXor([4, 2, 7, 1, 9])
    print(px.query(1, 3))  # 2 ^ 7 ^ 1
    print(px.query(0, 4))  # whole array
```

---

## Final Tips

- Lead with the one-liner: *"Pairs cancel because `x ^ x = 0`, so XOR-all the array and the odd-count element survives."*
- Immediately flag the two gotchas: it finds the **odd-count** element (precondition), and XOR gives **parity, not counts**.
- For "appears three times" reach for **mod-3 two accumulators**; for **two singles** reach for **split-by-a-set-bit** (`x & -x`).
- For missing/duplicate, prefer **XOR over the Gauss sum** to avoid overflow; for range/subarray, use **prefix XOR** (`pre[r+1] ^ pre[l]`).
- If asked about checksums, note XOR is **linear and weak** — fine for erasure (RAID), not for integrity (use CRC / a MAC).
- Always offer to verify against a brute-force counting oracle on small inputs, plus an order-independence property test.

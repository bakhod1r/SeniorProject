# Bit Tricks (The Foundational Bit-Manipulation Toolkit) — Interview Preparation

> **One-line summary:** Bit-manipulation interview questions reward knowing the four single-bit moves cold, the two identities (`x & (x-1)`, `x & -x`), popcount/clz/ctz, and the sign/width pitfalls — then applying them fluently to classic problems (count bits, power of two, single number, reverse/swap bits) with clean, language-correct code.

---

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions (12 Q&A)](#junior-questions-12-qa)
3. [Middle Questions (10 Q&A)](#middle-questions-10-qa)
4. [Senior Questions (8 Q&A)](#senior-questions-8-qa)
5. [Professional Questions (8 Q&A)](#professional-questions-8-qa)
6. [Behavioral / Design Prompts (5)](#behavioral--design-prompts-5)
7. [Coding Challenges](#coding-challenges)
8. [Final Tips](#final-tips)

---

## Quick-Reference Cheat Sheet

| Goal | Expression | Notes |
|------|------------|-------|
| Test bit `i` | `(x >> i) & 1` | |
| Set bit `i` | `x \| (1 << i)` | |
| Clear bit `i` | `x & ~(1 << i)` | |
| Toggle bit `i` | `x ^ (1 << i)` | |
| Isolate lowest set bit | `x & -x` | `0` if `x == 0` |
| Clear lowest set bit | `x & (x - 1)` | popcount drops by 1 |
| Power of two? | `x > 0 && (x & (x-1)) == 0` | guard `x > 0` |
| Popcount | builtin / Kernighan | `O(set bits)` for loop |
| ctz / clz | builtin | guard `x == 0` |
| Low `i` bits mask | `(1 << i) - 1` | `~0` for full width |
| `floor(log2 x)` | `W - 1 - clz(x)` | `x.bit_length()-1` in Python |
| Single number | XOR all elements | pairs cancel |
| Swap a, b | tuple/temp swap | NOT XOR-swap in production |

Two's complement: `-x == ~x + 1`. Java: `>>>` is logical shift, `1 << 32 == 1` (count masked). Python: no fixed width — mask with `& 0xFFFFFFFF`.

---

## Junior Questions (12 Q&A)

**Q1. How do you check whether the i-th bit of an integer is set?**
Shift the bit down and mask: `(x >> i) & 1`. It is 1 if set, 0 otherwise. Equivalently `x & (1 << i) != 0`.

**Q2. How do you set, clear, and toggle the i-th bit?**
Set: `x | (1 << i)`. Clear: `x & ~(1 << i)`. Toggle: `x ^ (1 << i)`. The mask `1 << i` is a single 1 at position `i`.

**Q3. How do you tell if a number is even or odd with bits?**
`x & 1` — it equals the value of the lowest bit, so `x & 1 == 0` means even, `1` means odd. Faster and clearer-of-intent than `x % 2` for parity.

**Q4. What does `x & (x - 1)` do?**
It clears the lowest set bit of `x`. Subtracting 1 flips the lowest 1 to 0 and the trailing zeros to 1s; ANDing removes that run. Used in Kernighan's popcount and the power-of-two test.

**Q5. What does `x & -x` do?**
It isolates the lowest set bit (returns just that bit's value, `2^ctz(x)`), because `-x == ~x + 1` in two's complement. Used in Fenwick trees and to find the lowest set bit's position.

**Q6. How do you check if a number is a power of two?**
`x > 0 && (x & (x-1)) == 0`. A power of two has exactly one set bit; clearing it gives 0. The `x > 0` guard rejects 0 and negatives.

**Q7. How do you multiply or divide by a power of two with shifts?**
`x << k` multiplies by `2^k`; `x >> k` divides by `2^k` (for non-negative values). Note signed right shift rounds toward negative infinity, not toward zero.

**Q8. What is two's complement?**
The standard signed-integer representation: `-x` is stored as `~x + 1`. The most significant bit is the sign bit (1 = negative). It makes addition/subtraction uniform for signed and unsigned values.

**Q9. What is the difference between `&` and `&&`?**
`&` is bitwise AND (operates per bit on integers); `&&` is logical AND (operates on booleans, short-circuits). Mixing them is a classic bug — both compile but behave differently.

**Q10. How do you count the set bits in a number?**
Use the builtin (`Integer.bitCount`, `bits.OnesCount`, `int.bit_count`). By hand, Kernighan's loop: `while x: x &= x-1; count++`, which runs once per set bit.

**Q11. How do you swap two variables without a temp?**
You *can* use XOR: `a^=b; b^=a; a^=b`. But you should not in production — it breaks if `a` and `b` are the same storage (sets it to 0) and saves nothing on modern CPUs. Use a temp or tuple swap.

**Q12. How do you build a mask of the lowest `i` bits?**
`(1 << i) - 1` gives `i` ones. Be careful at full width: `(1 << 32) - 1` on a 32-bit type is UB; use `~0` for all bits set.

---

## Middle Questions (10 Q&A)

**Q1. Explain Brian Kernighan's popcount and its complexity.**
`x &= x-1` removes the lowest set bit each iteration, so the loop runs exactly `popcount(x)` times — O(set bits), faster than scanning all bits for sparse inputs.

**Q2. Describe the parallel (SWAR) popcount and why it is O(1).**
It sums bit counts in fields of doubling width (pairs → nibbles → bytes), then sums the bytes via a multiply. A fixed ~12 operations regardless of input, so constant time, no table, no branches.

**Q3. What are ctz and clz, and how do you get log2 from them?**
ctz = trailing zeros = index of lowest set bit; clz = leading zeros. For `x > 0`, `floor(log2 x) = W - 1 - clz(x)`. They map to hardware `TZCNT`/`LZCNT`.

**Q4. How do you build a mask for bits `[lo, hi]` inclusive?**
`((1 << (hi - lo + 1)) - 1) << lo`. The `(1<<n)-1` gives `n` ones; the shift moves them to position `lo`.

**Q5. How does signed vs unsigned change right shift?**
Unsigned `>>` is logical (fills 0). Signed `>>` is arithmetic (fills the sign bit). In Java use `>>>` for logical shift; in Go/C use unsigned types.

**Q6. Why is `1 << 32` dangerous?**
On a 32-bit type it is shift-by-width: UB in C/Go (or 0), and in Java the count is masked to `& 31` so `1 << 32 == 1`. Use a 64-bit literal (`1L`, `uint64(1)`) for high bits.

**Q7. How do you round a number up to the next power of two?**
Smear the high bit down with shift-ORs then add 1, or `1 << (W - clz(x-1))` for `x > 1`. Common in hash-table sizing.

**Q8. How does Python's integer model differ for bit tricks?**
Python ints are arbitrary precision with no sign bit, so `~x == -x-1`, no overflow, and `<<` grows without bound. Emulate 32-bit with `& 0xFFFFFFFF` and reinterpret the sign manually.

**Q9. What is Hamming distance and how do you compute it?**
The number of differing bit positions between `a` and `b`: `popcount(a ^ b)`. Used in error-correcting codes and similarity hashing.

**Q10. When should you NOT use a bit trick?**
When readability matters more than nanoseconds, when the set is large/sparse (use a hash set), or when the compiler already optimizes the arithmetic form (`x * 8`). Use builtins instead of hand-rolled tricks.

---

## Senior Questions (8 Q&A)

**Q1. When is branchless code actually faster than a branch?**
When the condition is near-random (50/50) so the predictor fails, or when constant-time behavior is required (crypto). For highly predictable branches, the predictor makes the branch nearly free and branchless arithmetic just adds latency.

**Q2. How would you popcount a large bitset fastest?**
Per-word hardware `POPCNT`, or for very large buffers a Harley-Seal/CSA bulk popcount that uses carry-save adders to amortize `POPCNT` over many words — beats per-word on big arrays.

**Q3. What undefined behaviors lurk in bit code?**
Shift by `>=` width or negative, signed overflow, `-INT_MIN`, left-shift into the sign bit. Mitigate with unsigned types, in-range shifts, special-casing `INT_MIN`/full-width masks, and UBSan in tests.

**Q4. How do you test bit-manipulation code thoroughly?**
Exhaustive enumeration over 16-bit/byte domains against a bit-by-bit reference; differential testing of SWAR vs builtin over millions of 64-bit randoms; property tests (`popcount(x)+popcount(~x)==W`); and a fixed edge corpus (0, -1, INT_MIN, 0x8000…).

**Q5. Why is XOR-swap a footgun?**
`a^=b; b^=a; a^=b` zeroes the value when `a` and `b` alias the same storage (`x^x==0`). It is correct only for distinct variables and saves nothing on modern CPUs — use a temp/tuple swap.

**Q6. How do you keep a trick portable across 32 and 64 bit?**
Encode the width in the type (`uint32`/`uint64`), use width-appropriate masks (`0x5555...` length) and shift tails (`>>24` vs `>>56`), and never copy a 32-bit trick into a 64-bit context unchanged.

**Q7. How does endianness interact with bit operations?**
It does not — bit ops act on the value, not byte layout. Endianness only matters when serializing integers to bytes; use explicit byte order at that boundary.

**Q8. When do you choose a table lookup over SWAR for popcount?**
When `POPCNT` is unavailable, the table is hot in cache, and the byte-sum loads do not stall. SWAR usually wins on hot paths because it avoids memory; table wins when the data pattern keeps the table resident and registers are scarce.

---

## Professional Questions (8 Q&A)

**Q1. Prove that `x & (x-1)` clears the lowest set bit.**
Write `x = p·2^{s+1} + 2^s` (s trailing zeros). `x-1 = p·2^{s+1} + (2^s - 1)`: high bits unchanged, bit s becomes 0, low s bits become 1. ANDing keeps the high bits, zeros bit s (1&0), zeros the low bits (0&1). Result is `x` without bit s.

**Q2. Prove `x & -x` isolates the lowest set bit.**
`-x = ~x + 1`. `~x` has the bottom s bits = 1, bit s = 0; adding 1 carries through, setting bit s and clearing below. ANDing with x: bit s is 1 in both → survives; everything else cancels. Result is `2^s`.

**Q3. Why is SWAR popcount exactly correct, not approximate?**
It is a divide-and-conquer sum: each step adds adjacent field counts, and the mask widths guarantee no field overflows (pair ≤ 2 in 2 bits, nibble ≤ 4 in 4 bits, byte ≤ 8 in 4 bits). After log2(W) merges, one field holds the exact total; the final multiply horizontally sums the byte lanes.

**Q4. How does a de Bruijn sequence give O(1) ctz?**
Isolate the low bit `v = x & -x = 2^s`. Multiplying a de Bruijn constant by `2^s` left-shifts a unique length-k window into the top k bits; that window indexes a precomputed table returning `s`. One multiply, one shift, one lookup — used before `TZCNT` hardware.

**Q5. What algebraic structure do bitwise ops form, and why does it matter?**
`(XOR, AND)` form the ring `GF(2)^W`: XOR is addition mod 2 (self-inverse), AND is multiplication. This is why `a^b^b == a` (single-number trick), XOR is associative/commutative (safe to reduce in any order), and AND distributes over XOR.

**Q6. Derive the next-power-of-two bit-smear correctness.**
Let h = floor(log2(x-1)). The shift-OR cascade copies bit h downward filling bits 0..h, giving `2^{h+1}-1`; +1 yields `2^{h+1}`, the least power of two ≥ x. Using `x-1` makes exact powers map to themselves.

**Q7. Why does `x & (x-1) == 0` also hold for x = 0, and how do you handle it?**
Because `0 & (0-1) = 0 & -1 = 0`. So the power-of-two test needs the explicit `x > 0` guard; without it, 0 falsely reports as a power of two. This is the single most common bug in the trick.

**Q8. What model makes "popcount is O(1)" true?**
The word-RAM model, where each word-sized arithmetic/logical op is one unit. In a bit-complexity model it is Θ(W) work with Θ(log W) circuit depth. The hardware POPCNT realizes that log-depth network in silicon as one instruction.

---

## Behavioral / Design Prompts (5)

1. **"Tell me about a time you optimized code with bit manipulation."** Frame it as a *measured* decision: profiler flagged the hot loop, you replaced a per-element loop with a popcount/bitmask, you benchmarked the gain, and you encapsulated the trick behind a tested function with a comment explaining intent.

2. **"How do you decide between a clever bit trick and readable code?"** Default to readable; use the trick only where a profiler points, where it is load-bearing for correctness (e.g. constant-time crypto), or where it materially shrinks memory. Always wrap it in a named function and document the invariant.

3. **"Design a feature-flags system for 50 boolean options."** Discuss packing into a 64-bit word (or a small bitset), `set`/`clear`/`test` helpers, naming each bit as a constant, serialization concerns (endianness, forward-compat), and when to switch to a richer config object once flags interact.

4. **"You found a checksum mismatch only on one platform. How do you debug it?"** Suspect width/sign/endianness: check shift counts vs width, signed vs unsigned shifts, and byte order at serialization. Reproduce with an edge corpus and UBSan; add a differential test against a reference implementation.

5. **"Walk me through reviewing a teammate's bit-heavy PR."** Look for: guarded zero in ctz/clz, full-width masks using `~0` not `(1<<W)-1`, `>>>` vs `>>` correctness, `INT_MIN` handling, commented masks, builtin usage over hand-rolled popcount, and presence of exhaustive/property tests.

---

## Coding Challenges

### Challenge 1: Count Set Bits (popcount of a number, and 0..n)

**Problem.** Return the number of 1 bits in `n`. Bonus: return an array `ans[0..n]` where `ans[i]` is the popcount of `i` (LeetCode "Counting Bits").

**Key idea.** Kernighan for a single number; DP `ans[i] = ans[i >> 1] + (i & 1)` or `ans[i] = ans[i & (i-1)] + 1` for the array.

#### Go

```go
package main

import "fmt"

func hammingWeight(n uint32) int {
	c := 0
	for n != 0 {
		n &= n - 1
		c++
	}
	return c
}

func countBits(n int) []int {
	ans := make([]int, n+1)
	for i := 1; i <= n; i++ {
		ans[i] = ans[i&(i-1)] + 1 // one more set bit than i with its lowest cleared
	}
	return ans
}

func main() {
	fmt.Println(hammingWeight(0b1011)) // 3
	fmt.Println(countBits(5))          // [0 1 1 2 1 2]
}
```

#### Java

```java
import java.util.Arrays;

public class CountBits {
    static int hammingWeight(int n) {
        int c = 0;
        while (n != 0) { n &= n - 1; c++; }
        return c;
    }

    static int[] countBits(int n) {
        int[] ans = new int[n + 1];
        for (int i = 1; i <= n; i++) ans[i] = ans[i & (i - 1)] + 1;
        return ans;
    }

    public static void main(String[] args) {
        System.out.println(hammingWeight(0b1011));        // 3
        System.out.println(Arrays.toString(countBits(5))); // [0, 1, 1, 2, 1, 2]
    }
}
```

#### Python

```python
def hamming_weight(n):
    c = 0
    while n:
        n &= n - 1
        c += 1
    return c


def count_bits(n):
    ans = [0] * (n + 1)
    for i in range(1, n + 1):
        ans[i] = ans[i & (i - 1)] + 1
    return ans


if __name__ == "__main__":
    print(hamming_weight(0b1011))  # 3
    print(count_bits(5))           # [0, 1, 1, 2, 1, 2]
```

---

### Challenge 2: Power of Two

**Problem.** Return true iff `n` is a power of two.

**Key idea.** `n > 0 && (n & (n-1)) == 0`.

#### Go

```go
package main

import "fmt"

func isPowerOfTwo(n int) bool {
	return n > 0 && n&(n-1) == 0
}

func main() {
	fmt.Println(isPowerOfTwo(1), isPowerOfTwo(16), isPowerOfTwo(0), isPowerOfTwo(6))
	// true true false false
}
```

#### Java

```java
public class PowerOfTwo {
    static boolean isPowerOfTwo(int n) {
        return n > 0 && (n & (n - 1)) == 0;
    }

    public static void main(String[] args) {
        System.out.println(isPowerOfTwo(1) + " " + isPowerOfTwo(16)
            + " " + isPowerOfTwo(0) + " " + isPowerOfTwo(6));
        // true true false false
    }
}
```

#### Python

```python
def is_power_of_two(n):
    return n > 0 and (n & (n - 1)) == 0


if __name__ == "__main__":
    print(is_power_of_two(1), is_power_of_two(16),
          is_power_of_two(0), is_power_of_two(6))
    # True True False False
```

---

### Challenge 3: Single Number (XOR cancellation)

**Problem.** Every element appears twice except one; find the single element. Then the variant: every element appears three times except one (find it with bit counts).

**Key idea.** XOR all elements; pairs cancel (`a^a=0`), leaving the unique one. For the "three times" variant, sum each bit position mod 3.

#### Go

```go
package main

import "fmt"

func singleNumber(nums []int) int {
	x := 0
	for _, v := range nums {
		x ^= v // pairs cancel
	}
	return x
}

func singleNumberThrice(nums []int) int {
	ans := 0
	for bit := 0; bit < 32; bit++ {
		count := 0
		for _, v := range nums {
			count += (v >> uint(bit)) & 1
		}
		if count%3 != 0 {
			ans |= 1 << uint(bit)
		}
	}
	return ans
}

func main() {
	fmt.Println(singleNumber([]int{4, 1, 2, 1, 2}))          // 4
	fmt.Println(singleNumberThrice([]int{2, 2, 3, 2}))       // 3
}
```

#### Java

```java
public class SingleNumber {
    static int singleNumber(int[] nums) {
        int x = 0;
        for (int v : nums) x ^= v;
        return x;
    }

    static int singleNumberThrice(int[] nums) {
        int ans = 0;
        for (int bit = 0; bit < 32; bit++) {
            int count = 0;
            for (int v : nums) count += (v >> bit) & 1;
            if (count % 3 != 0) ans |= 1 << bit;
        }
        return ans;
    }

    public static void main(String[] args) {
        System.out.println(singleNumber(new int[]{4, 1, 2, 1, 2}));     // 4
        System.out.println(singleNumberThrice(new int[]{2, 2, 3, 2}));  // 3
    }
}
```

#### Python

```python
def single_number(nums):
    x = 0
    for v in nums:
        x ^= v
    return x


def single_number_thrice(nums):
    ans = 0
    for bit in range(32):
        count = sum((v >> bit) & 1 for v in nums)
        if count % 3:
            ans |= 1 << bit
    # interpret as signed 32-bit
    return ans - (1 << 32) if ans >= (1 << 31) else ans


if __name__ == "__main__":
    print(single_number([4, 1, 2, 1, 2]))     # 4
    print(single_number_thrice([2, 2, 3, 2]))  # 3
```

---

### Challenge 4: Reverse Bits / Swap Bits

**Problem.** Reverse the 32 bits of an unsigned integer. Bonus: swap two bits at positions `i` and `j`.

**Key idea.** Pull bits off the low end of the input and push them onto the low end of the result, shifting the result left each step. Swap two bits only if they differ (XOR a mask).

#### Go

```go
package main

import "fmt"

func reverseBits(n uint32) uint32 {
	var r uint32
	for i := 0; i < 32; i++ {
		r = (r << 1) | (n & 1) // append low bit of n to r
		n >>= 1
	}
	return r
}

func swapBits(x uint32, i, j int) uint32 {
	bi := (x >> uint(i)) & 1
	bj := (x >> uint(j)) & 1
	if bi != bj { // only flip when they differ
		x ^= (1 << uint(i)) | (1 << uint(j))
	}
	return x
}

func main() {
	fmt.Printf("%032b\n", reverseBits(0b101)) // ...101 reversed to high end
	fmt.Println(swapBits(0b1001, 0, 3))       // 0b1001 -> swap bit0,bit3 -> 0b1001 (both 1)
}
```

#### Java

```java
public class ReverseBits {
    static int reverseBits(int n) {
        int r = 0;
        for (int i = 0; i < 32; i++) {
            r = (r << 1) | (n & 1);
            n >>>= 1; // logical shift
        }
        return r;
    }

    static int swapBits(int x, int i, int j) {
        int bi = (x >> i) & 1, bj = (x >> j) & 1;
        if (bi != bj) x ^= (1 << i) | (1 << j);
        return x;
    }

    public static void main(String[] args) {
        System.out.println(Integer.toBinaryString(reverseBits(0b101)));
        System.out.println(swapBits(0b0001, 0, 3)); // 0b1000 = 8
    }
}
```

#### Python

```python
def reverse_bits(n):
    r = 0
    for _ in range(32):
        r = (r << 1) | (n & 1)
        n >>= 1
    return r & 0xFFFFFFFF


def swap_bits(x, i, j):
    bi = (x >> i) & 1
    bj = (x >> j) & 1
    if bi != bj:
        x ^= (1 << i) | (1 << j)
    return x


if __name__ == "__main__":
    print(format(reverse_bits(0b101), "032b"))
    print(swap_bits(0b0001, 0, 3))  # 0b1000 = 8
```

---

## Final Tips

- **Say the invariant out loud.** "`x & (x-1)` clears the lowest set bit" earns more credit than silently typing it.
- **Always state the width and sign assumptions** before coding — interviewers love candidates who pre-empt the `1 << 31`/`>>>`/Python-masking traps.
- **Reach for the builtin first** (`Integer.bitCount`, etc.), then offer the hand-rolled version if asked to implement it.
- **Guard zero and INT_MIN.** Mentioning `isPowerOfTwo(0)` and `-INT_MIN` shows maturity.
- **Test with a tiny example by hand** (e.g. `44 = 00101100`) to show your work and catch off-by-ones.
- **For "single number," lead with the XOR-cancellation insight**; for the three-times variant, the per-bit-mod-3 count is the clean general approach.
- **Know the lowest-bit family cold:** `x & -x` (value of lowest set bit), `x & (x-1)` (clear it), and `ctz` (its index). Interviewers probe whether you can distinguish them.
- **Mention complexity in the right model.** "Popcount is O(1)" assumes the word-RAM and a builtin; the Kernighan loop is O(set bits). Stating the model signals depth.

### One-page rapid review

If you have five minutes before the interview, memorize these:

1. `1 << i` is the single-bit mask; `(1 << i) - 1` is the low-`i`-bits mask; `~0` is all bits.
2. `x & (x-1)` clears the lowest set bit; `x & -x` isolates it; together they give power-of-two test and popcount.
3. Power of two ⇔ `x > 0 && (x & (x-1)) == 0`. Never forget the `x > 0`.
4. XOR cancels pairs (`a^a=0`) — the single-number trick and Hamming distance (`popcount(a^b)`).
5. Two's complement: `-x = ~x + 1`; the top bit is the sign; `>>` is arithmetic on signed, logical on unsigned (Java `>>>`).
6. Python has no fixed width — mask with `& 0xFFFFFFFF` and reconstruct the sign for 32-bit problems.
7. Prefer builtins: `Integer.bitCount` / `bits.OnesCount` / `int.bit_count` for popcount; the `numberOfTrailing/LeadingZeros` family for ctz/clz.

Drill these until they are reflexive; nearly every bit-manipulation interview question is a composition of them.

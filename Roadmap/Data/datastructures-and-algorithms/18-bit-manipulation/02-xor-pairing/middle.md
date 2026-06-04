# XOR Pairing & XOR Identities — Middle Level

> **Focus:** Beyond plain XOR-all. The mod-3 / two-accumulator trick for "every other element appears three times," the split-by-a-set-bit technique for finding *two* singles, missing-and-duplicate detection via XOR, the four-case closed form for the XOR of a range `[0..n]`, prefix-XOR subarray queries, and Gray codes — with comparisons of when each tool is the right one.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Range XOR and Prefix XOR](#range-xor-and-prefix-xor)
6. [Gray Codes](#gray-codes)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: XOR-all an array and the odd-count element survives because `x ^ x = 0`. That solves "every element appears twice except one." At middle level the questions get sharper, and plain XOR-all stops being enough:

- What if every other element appears **three times** (not twice)? Triples do *not* cancel under XOR. How do you isolate the single one then?
- What if **two** distinct elements appear once and the rest appear twice? XOR-all gives you `a ^ b`, not `a` and `b` separately. How do you split them?
- How do you detect a **missing** number or a **duplicate** in `[0..n]` with `O(1)` space?
- Can you compute the XOR of *every* integer in `[0..n]` without a loop? (Yes — a four-case closed form.)
- How do you answer "XOR of the subarray from `l` to `r`" in `O(1)` after preprocessing?
- What is a **Gray code**, and why is `x ^ (x >> 1)` the formula?

These are the techniques that turn "I know the single-number trick" into "I can pick the right XOR identity for the structure in front of me." Throughout, keep the master principle in mind: **XOR records parity (odd/even count) per bit, nothing more.** Every trick below is a way to engineer the input so that parity reveals the answer.

---

## Deeper Concepts

### Why plain XOR-all fails for "appears three times"

XOR-all works because pairs cancel: an element appearing an *even* number of times contributes `0`. Three is *odd*, so an element appearing three times contributes itself, not `0`. If every value but one appears three times, XOR-all gives `(single) ^ (triple1) ^ (triple2) ^ …` — garbage. We need a different invariant.

### The mod-3 idea: count each bit modulo 3

Look at any single bit position across the whole array. If a value appears three times, it contributes its bit three times to that column. The *sum* of bits in that column, taken **modulo 3**, isolates the single element's bit: every triple contributes `0 mod 3`, and the single element contributes its bit once. Do this for every bit and reassemble.

The elegant `O(1)`-space implementation uses **two accumulators** (`ones` and `twos`) acting as a base-3 counter per bit, so we never store 32 separate counters. After processing the whole array, `ones` holds exactly the bits whose column-count is `1 mod 3` — which is the single element.

```
ones = 0, twos = 0
for x in nums:
    ones = (ones ^ x) & ~twos
    twos = (twos ^ x) & ~ones
return ones
```

This is a two-state-per-bit finite machine cycling `00 → 01 → 10 → 00` (counts mod 3); after three appearances of a value its bit returns to `00`. The full correctness proof is in `professional.md`; the takeaway here is that **"appears `k` times" generalizes to counting bits mod `k`.**

### Two distinct singles: split by a set bit

Suppose exactly two elements `a` and `b` appear once and all others appear twice. XOR-all the array:

```
xorAll = a ^ b
```

Since `a ≠ b`, `xorAll ≠ 0`, so it has at least one set bit. That bit is a position where `a` and `b` **differ** (one has `0`, the other `1`). Pick the lowest set bit:

```
diffBit = xorAll & (-xorAll)   // isolates the lowest set bit
```

Now partition the array into two groups: values with `diffBit` set, and values without. Because `a` and `b` differ at `diffBit`, they fall into **different** groups. Every *paired* duplicate has the same bit pattern, so both copies land in the *same* group and cancel there. Each group now contains exactly one odd-count element — a plain single-number problem. XOR each group to recover `a` and `b`.

```
groupA = 0, groupB = 0
for x in nums:
    if x & diffBit: groupA ^= x
    else:           groupB ^= x
return [groupA, groupB]
```

This is the **partition-by-set-bit** technique, and it is the central new idea at this level: *use a known differing bit to route two unknowns into separate single-number subproblems.*

### Missing number via XOR

Given an array containing `n` distinct numbers drawn from `[0..n]` (one value missing), XOR all the array values together with all the indices `0..n`. Every present value cancels with its matching index; the missing value has no array partner, so it survives:

```
missing = 0
for i in 0..n-1:
    missing ^= i ^ nums[i]
missing ^= n          // include the final index n
return missing
```

Equivalently: `missing = (0 ^ 1 ^ … ^ n) ^ (XOR of array)`. This is `O(n)` time, `O(1)` space, and — unlike the Gauss-sum approach (`n(n+1)/2 - sum`) — it cannot overflow.

### Finding a duplicate via XOR (the `[0..n-1]` plus one extra case)

If an array of length `n+1` holds every number in `[0..n-1]` exactly once plus *one* of them a second time, XOR all array values with all of `0..n-1`. Everything cancels except the duplicate (which appears twice in the array and once in the index range → odd total → survives). Same structure as the missing-number trick, mirror image.

---

## Comparison with Alternatives

### Single-once-others-twice: XOR vs hash set vs sort

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| **XOR-all** | `O(n)` | `O(1)` | Best. Order-independent, no overflow. |
| Hash set / counter | `O(n)` | `O(n)` | Correct, but linear memory. |
| Sort then scan pairs | `O(n log n)` | `O(1)`/`O(n)` | Slower; mutates input unless copied. |

### Single-once-others-thrice: mod-3 XOR vs counting

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| **Two-accumulator mod-3** | `O(n)` | `O(1)` | Best; constant extra space. |
| 32 bit-counters mod 3 | `O(32n)` | `O(1)` | Same idea, more explicit, slightly slower. |
| Hash counter | `O(n)` | `O(n)` | Simple but linear memory. |

### Missing number: XOR vs Gauss sum vs hash

| Approach | Time | Space | Risk |
|----------|------|-------|------|
| **XOR of indices and values** | `O(n)` | `O(1)` | None — no overflow. |
| Gauss sum `n(n+1)/2 - Σ` | `O(n)` | `O(1)` | Overflow for large `n` unless wide ints. |
| Boolean presence array | `O(n)` | `O(n)` | Extra memory. |

The recurring theme: **XOR matches or beats the alternatives on space and is overflow-proof**, at the cost of only working when the count structure is exactly right.

### When NOT to reach for XOR

- You need *how many times* something appeared → use a counter.
- More than two elements appear an odd number of times and you cannot split them by a single bit → XOR cannot separate three-plus unknowns directly.
- The values are not integers (or not bit-addressable) → XOR does not apply.

---

## Advanced Patterns

### Pattern: Single number when others appear 3 times (two accumulators)

The mod-3 finite-state trick. Identity is `ones = twos = 0`.

#### Go

```go
package main

import "fmt"

func singleNumberThrice(nums []int) int {
	ones, twos := 0, 0
	for _, x := range nums {
		ones = (ones ^ x) &^ twos // &^ is Go's "AND NOT"
		twos = (twos ^ x) &^ ones
	}
	return ones
}

func main() {
	fmt.Println(singleNumberThrice([]int{2, 2, 3, 2}))             // 3
	fmt.Println(singleNumberThrice([]int{0, 1, 0, 1, 0, 1, 99}))   // 99
}
```

#### Java

```java
public class SingleThrice {
    static int singleNumberThrice(int[] nums) {
        int ones = 0, twos = 0;
        for (int x : nums) {
            ones = (ones ^ x) & ~twos;
            twos = (twos ^ x) & ~ones;
        }
        return ones;
    }

    public static void main(String[] args) {
        System.out.println(singleNumberThrice(new int[]{2, 2, 3, 2}));           // 3
        System.out.println(singleNumberThrice(new int[]{0, 1, 0, 1, 0, 1, 99})); // 99
    }
}
```

#### Python

```python
def single_number_thrice(nums):
    ones = twos = 0
    for x in nums:
        ones = (ones ^ x) & ~twos
        twos = (twos ^ x) & ~ones
    return ones


if __name__ == "__main__":
    print(single_number_thrice([2, 2, 3, 2]))           # 3
    print(single_number_thrice([0, 1, 0, 1, 0, 1, 99])) # 99
```

> Python note: Python ints are arbitrary-precision and `~` produces a negative two's-complement-style value, but the masking still works correctly for non-negative inputs because the bits below the sign behave identically. For signed/negative inputs, mask to a fixed width (e.g. `& 0xFFFFFFFF`) and reinterpret.

### Pattern: Two distinct single numbers (split by a set bit)

XOR-all, isolate a differing bit, partition, XOR each group.

#### Go

```go
package main

import "fmt"

func twoSingles(nums []int) [2]int {
	xorAll := 0
	for _, x := range nums {
		xorAll ^= x // = a ^ b
	}
	diff := xorAll & (-xorAll) // lowest set bit where a, b differ
	var a, b int
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
	fmt.Println(twoSingles([]int{1, 2, 1, 3, 2, 5})) // [3 5] (order may vary)
}
```

#### Java

```java
import java.util.Arrays;

public class TwoSingles {
    static int[] twoSingles(int[] nums) {
        int xorAll = 0;
        for (int x : nums) xorAll ^= x;     // a ^ b
        int diff = xorAll & (-xorAll);      // lowest differing bit
        int a = 0, b = 0;
        for (int x : nums) {
            if ((x & diff) != 0) a ^= x;
            else b ^= x;
        }
        return new int[]{a, b};
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(twoSingles(new int[]{1, 2, 1, 3, 2, 5})));
    }
}
```

#### Python

```python
def two_singles(nums):
    xor_all = 0
    for x in nums:
        xor_all ^= x                 # a ^ b
    diff = xor_all & (-xor_all)      # lowest set bit (where a, b differ)
    a = b = 0
    for x in nums:
        if x & diff:
            a ^= x
        else:
            b ^= x
    return (a, b)


if __name__ == "__main__":
    print(two_singles([1, 2, 1, 3, 2, 5]))  # (3, 5) or (5, 3)
```

### Pattern: Missing number in `[0..n]`

#### Python

```python
def missing_number(nums):
    n = len(nums)
    acc = n                  # start by including the index n
    for i, x in enumerate(nums):
        acc ^= i ^ x         # XOR every index with every value
    return acc


if __name__ == "__main__":
    print(missing_number([3, 0, 1]))       # 2
    print(missing_number([0, 1]))          # 2
    print(missing_number([9,6,4,2,3,5,7,0,1]))  # 8
```

---

## Range XOR and Prefix XOR

### Closed form for `XOR(0, 1, …, n)`

XORing every integer from `0` to `n` has a beautiful period-4 closed form, because the low bits cycle predictably:

```
        n mod 4 == 0  ->  n
        n mod 4 == 1  ->  1
        n mod 4 == 2  ->  n + 1
        n mod 4 == 3  ->  0
```

So `XOR(0..n)` is computed in `O(1)`, no loop. The reason (proved in `professional.md`): grouping consecutive integers in blocks of four, each aligned block `{4m, 4m+1, 4m+2, 4m+3}` XORs to `0`, leaving only a short tail determined by `n mod 4`.

To XOR an arbitrary range `[a..b]`, use the self-inverse property: `XOR(a..b) = XOR(0..b) ^ XOR(0..a-1)`. The prefix `XOR(0..a-1)` cancels everything below `a`.

#### Go

```go
package main

import "fmt"

func xorUpTo(n int) int { // XOR of 0..n
	switch n % 4 {
	case 0:
		return n
	case 1:
		return 1
	case 2:
		return n + 1
	default: // 3
		return 0
	}
}

func xorRange(a, b int) int { // XOR of a..b inclusive
	return xorUpTo(b) ^ xorUpTo(a-1)
}

func main() {
	fmt.Println(xorUpTo(7))    // 0   (0^1^...^7)
	fmt.Println(xorRange(3, 9)) // 3^4^5^6^7^8^9
}
```

#### Java

```java
public class RangeXor {
    static int xorUpTo(int n) {
        switch (n % 4) {
            case 0: return n;
            case 1: return 1;
            case 2: return n + 1;
            default: return 0; // n % 4 == 3
        }
    }

    static int xorRange(int a, int b) {
        return xorUpTo(b) ^ xorUpTo(a - 1);
    }

    public static void main(String[] args) {
        System.out.println(xorUpTo(7));     // 0
        System.out.println(xorRange(3, 9));
    }
}
```

#### Python

```python
def xor_up_to(n):           # XOR of 0..n
    return [n, 1, n + 1, 0][n % 4]


def xor_range(a, b):        # XOR of a..b inclusive
    return xor_up_to(b) ^ xor_up_to(a - 1)


if __name__ == "__main__":
    print(xor_up_to(7))      # 0
    print(xor_range(3, 9))
```

### Prefix XOR for subarray queries

Just as prefix *sums* answer "sum of a subarray" in `O(1)`, prefix *XORs* answer "XOR of a subarray" in `O(1)`. Define `pre[0] = 0` and `pre[i] = nums[0] ^ … ^ nums[i-1]`. Then:

```
XOR of nums[l..r] (inclusive) = pre[r+1] ^ pre[l]
```

The shared prefix `pre[l]` cancels itself (self-inverse), leaving exactly the elements from `l` to `r`. Building the prefix array is `O(n)`; each query is `O(1)`.

#### Python

```python
def build_prefix_xor(nums):
    pre = [0] * (len(nums) + 1)
    for i, x in enumerate(nums):
        pre[i + 1] = pre[i] ^ x
    return pre


def subarray_xor(pre, l, r):       # XOR of nums[l..r] inclusive
    return pre[r + 1] ^ pre[l]


if __name__ == "__main__":
    nums = [4, 2, 7, 1, 9]
    pre = build_prefix_xor(nums)
    print(subarray_xor(pre, 1, 3))  # 2 ^ 7 ^ 1
    print(subarray_xor(pre, 0, 4))  # whole array
```

This is the foundation for "count subarrays with XOR equal to K" (combine prefix XOR with a hash map of seen prefixes — analogous to subarray-sum-equals-K).

---

## Gray Codes

A **Gray code** orders the integers `0..2^m - 1` so that consecutive values differ in exactly **one bit**. The standard (reflected binary) Gray code of `x` is:

```
gray(x) = x ^ (x >> 1)
```

This single shift-XOR converts an ordinary binary counter into a Gray-coded one. The inverse (Gray → binary) is a prefix-XOR scan of the bits. Gray codes matter in hardware (rotary encoders avoid spurious readings when only one bit flips at a time), Karnaugh maps, and error-resistant signaling.

#### Go

```go
package main

import "fmt"

func gray(x int) int { return x ^ (x >> 1) }

func grayToBinary(g int) int {
	b := g
	for g >>= 1; g > 0; g >>= 1 {
		b ^= g
	}
	return b
}

func main() {
	for x := 0; x < 8; x++ {
		fmt.Printf("%d -> gray %03b\n", x, gray(x))
	}
	fmt.Println(grayToBinary(gray(5)) == 5) // true
}
```

#### Java

```java
public class Gray {
    static int gray(int x) { return x ^ (x >> 1); }

    static int grayToBinary(int g) {
        int b = g;
        for (g >>= 1; g > 0; g >>= 1) b ^= g;
        return b;
    }

    public static void main(String[] args) {
        for (int x = 0; x < 8; x++)
            System.out.printf("%d -> gray %s%n", x, Integer.toBinaryString(gray(x)));
        System.out.println(grayToBinary(gray(5)) == 5);
    }
}
```

#### Python

```python
def gray(x):
    return x ^ (x >> 1)


def gray_to_binary(g):
    b = g
    g >>= 1
    while g:
        b ^= g
        g >>= 1
    return b


if __name__ == "__main__":
    for x in range(8):
        print(x, "->", format(gray(x), "03b"))
    print(gray_to_binary(gray(5)) == 5)  # True
```

Consecutive Gray codes `gray(x)` and `gray(x+1)` differ in exactly one bit — verify by noting that `gray(x) ^ gray(x+1)` is always a single set bit.

---

## Code Examples

### A reusable XOR toolkit (counting / parity semantics)

```python
from functools import reduce
from operator import xor


def xor_all(nums):
    """Odd-count survivor (single-once, others-twice)."""
    return reduce(xor, nums, 0)


def single_thrice(nums):
    """Single-once, others-thrice via mod-3 accumulators."""
    ones = twos = 0
    for x in nums:
        ones = (ones ^ x) & ~twos
        twos = (twos ^ x) & ~ones
    return ones


def two_singles(nums):
    """Two distinct singles via split-by-set-bit."""
    xa = reduce(xor, nums, 0)
    diff = xa & (-xa)
    a = b = 0
    for x in nums:
        if x & diff:
            a ^= x
        else:
            b ^= x
    return (a, b)
```

These three plus `xor_up_to`, `subarray_xor`, and `gray` cover the entire middle-level surface. Each is `O(n)` (or `O(1)`) and uses constant extra space.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Mod-3 trick on data where some value appears a different non-multiple of 3 | Returns garbage | Validate the count structure in tests; the trick assumes all-but-one appear exactly 3×. |
| Two-singles when `xorAll == 0` | No differing bit; `diff = 0` and partition collapses | This means the "two singles" are equal or absent; precondition violated. Assert `xorAll != 0`. |
| Missing-number forgets index `n` | Off-by-one; wrong survivor | Seed `acc = n` (or loop `0..n`). |
| Negative inputs to mod-3 in Python | `~` yields negative; high bits misbehave | Mask to fixed width (`& 0xFFFFFFFF`) and reinterpret sign. |
| Range XOR with `a = 0` | `xorUpTo(-1)` must be `0` | Define `xorUpTo(-1) = 0` (empty prefix); the formula naturally handles it if you guard `a-1 < 0`. |
| Prefix-XOR off-by-one | Mixing 0-based and 1-based indices | Fix the convention: `pre[0]=0`, query `pre[r+1] ^ pre[l]`. |

---

## Performance Analysis

| Technique | Time | Space | Overflow risk |
|-----------|------|-------|---------------|
| XOR-all (twice) | `O(n)` | `O(1)` | none |
| Mod-3 two-accumulator | `O(n)` | `O(1)` | none |
| Two-singles split | `O(n)` | `O(1)` | none |
| Missing/duplicate | `O(n)` | `O(1)` | none (vs Gauss sum) |
| Range XOR `[0..n]` | `O(1)` | `O(1)` | none |
| Prefix XOR build | `O(n)` | `O(n)` | none |
| Subarray XOR query | `O(1)` | — | none |
| Gray / inverse | `O(1)` / `O(m)` | `O(1)` | none |

Every XOR technique is **carry-free**, so none can overflow — a quiet but real advantage over sum-based equivalents (Gauss sum, prefix sums) which need wide integers or modular arithmetic for large `n`. The constant factors are tiny: XOR is a single-cycle instruction, the inner loops are branch-light, and the closed-form range XOR is literally a table lookup.

```python
import time

def benchmark(n):
    nums = list(range(n)) + list(range(n))  # everything twice
    nums.append(123456789)                   # one single
    start = time.perf_counter()
    _ = xor_all(nums)
    return time.perf_counter() - start
# n = 10**7 folds in well under a second in CPython.
```

The single biggest correctness lever is matching the technique to the **count structure**: twice → XOR-all, thrice → mod-3, two-singles → split. Choosing wrong silently returns a plausible wrong number.

---

## Best Practices

- **Match the trick to the multiplicity.** "Appears twice" → XOR-all; "appears `k` times" → count bits mod `k` (two-accumulator for `k=3`); "two singles" → split by a differing bit.
- **Isolate the lowest set bit with `x & (-x)`.** It is the cleanest way to pick a differing bit for the partition.
- **Prefer XOR over Gauss sum** for missing/duplicate to sidestep overflow entirely.
- **Memorize the period-4 range formula** (`n, 1, n+1, 0` for `n mod 4 = 0,1,2,3`); it turns an `O(n)` loop into `O(1)`.
- **Fix one prefix-XOR convention** (`pre[0]=0`, `pre[r+1]^pre[l]`) and reuse it; off-by-one is the only real hazard.
- **Test every variant against a counting oracle** on small random inputs before trusting it.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The XOR-all fold over an editable array, with accumulator bits flipping per element.
> - The **split-by-a-set-bit** partition for the two-singles problem: it shows `a ^ b`, isolates a differing bit, and routes elements into two color-coded groups that each collapse to a single value.
> - A bit-column parity view that makes "even cancels, odd survives" visible.

---

## Summary

Plain XOR-all only handles "every element twice except one." The middle-level toolkit extends the same parity principle to richer structures. When others appear **three times**, count bits **mod 3** with two accumulators (`ones`, `twos`) cycling a base-3 state per bit. When **two** distinct singles hide among pairs, XOR-all gives `a ^ b`; isolate a bit where they differ with `x & (-x)`, partition the array on that bit, and each group reduces to a single-number problem. **Missing** and **duplicate** detection over `[0..n]` fall out by XORing indices with values — overflow-proof, unlike the Gauss sum. The XOR of a whole range `[0..n]` has a **period-4 closed form** (`O(1)`), and **prefix XORs** answer subarray-XOR queries in `O(1)` via the self-inverse cancellation `pre[r+1] ^ pre[l]`. Finally, **Gray codes** come from a single shift-XOR `x ^ (x >> 1)`. The unifying idea: XOR records per-bit parity, so engineer the input — by multiplicity, by a splitting bit, or by a prefix — until parity hands you the answer.

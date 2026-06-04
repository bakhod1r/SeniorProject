# Bit Tricks (The Foundational Bit-Manipulation Toolkit) — Practice Tasks

> **How to use this file:** Work top to bottom. Each task gives a problem, input/output spec, constraints, hints, and starter code in Go, Java, and Python. Implement, then test against a brute-force bit-by-bit reference. Mind the sign/width pitfalls flagged throughout — Python has no fixed width, Java masks shift counts, Go right-shifts signed values arithmetically.

---

## Table of Contents

1. [Beginner Tasks (5)](#beginner-tasks-5)
2. [Intermediate Tasks (5)](#intermediate-tasks-5)
3. [Advanced Tasks (5)](#advanced-tasks-5)
4. [Benchmark Task](#benchmark-task)
5. [Self-Check Reference Oracles](#self-check-reference-oracles)
6. [General Guidance for All Tasks](#general-guidance-for-all-tasks)

---

## Beginner Tasks (5)

### B1. Test, Set, Clear, Toggle

**Problem.** Implement four functions on a 32-bit unsigned integer `x` and bit index `i`: `testBit`, `setBit`, `clearBit`, `toggleBit`.

**I/O spec.** Input: `x` (uint32), `i` in `[0, 31]`. Output: boolean for test; uint32 for the other three.

**Constraints.** `0 <= i <= 31`. No builtins needed.

**Hints.** The mask is `1 << i`. Test: `(x >> i) & 1`. Clear uses `~(1 << i)`. Toggle uses `^`.

```go
func testBit(x uint32, i int) bool  { /* TODO */ return false }
func setBit(x uint32, i int) uint32 { /* TODO */ return 0 }
func clearBit(x uint32, i int) uint32 { /* TODO */ return 0 }
func toggleBit(x uint32, i int) uint32 { /* TODO */ return 0 }
```

```java
static boolean testBit(int x, int i)  { /* TODO */ return false; }
static int setBit(int x, int i)       { /* TODO */ return 0; }
static int clearBit(int x, int i)     { /* TODO */ return 0; }
static int toggleBit(int x, int i)    { /* TODO */ return 0; }
```

```python
def test_bit(x, i):   pass  # TODO
def set_bit(x, i):    pass  # TODO
def clear_bit(x, i):  pass  # TODO
def toggle_bit(x, i): pass  # TODO
```

---

### B2. Is It Even?

**Problem.** Determine whether `n` is even using only a bit operation.

**I/O spec.** Input: integer `n`. Output: boolean (`true` if even).

**Constraints.** Works for negative `n` too.

**Hints.** The lowest bit decides parity: `n & 1 == 0` means even (true for negatives as well in two's complement).

```go
func isEven(n int) bool { /* TODO */ return false }
```

```java
static boolean isEven(int n) { /* TODO */ return false; }
```

```python
def is_even(n):  pass  # TODO
```

---

### B3. Power of Two

**Problem.** Return true iff `n` is a power of two.

**I/O spec.** Input: integer `n`. Output: boolean.

**Constraints.** `n` may be 0 or negative (both must return false).

**Hints.** `n > 0 && (n & (n-1)) == 0`. Do not forget the `n > 0` guard.

```go
func isPowerOfTwo(n int) bool { /* TODO */ return false }
```

```java
static boolean isPowerOfTwo(int n) { /* TODO */ return false; }
```

```python
def is_power_of_two(n):  pass  # TODO
```

---

### B4. Count Set Bits (Kernighan)

**Problem.** Return the number of 1 bits in `n` using Brian Kernighan's loop (no builtin).

**I/O spec.** Input: uint32 `n`. Output: int count.

**Constraints.** Loop must run exactly `popcount(n)` times.

**Hints.** `while n != 0: n &= n - 1; count++`.

```go
func popcount(n uint32) int { /* TODO */ return 0 }
```

```java
static int popcount(int n) { /* TODO */ return 0; }
```

```python
def popcount(n):  pass  # TODO
```

---

### B5. Lowest Set Bit Value and Position

**Problem.** For `x != 0`, return the value of the lowest set bit (`x & -x`) and its position (ctz).

**I/O spec.** Input: positive integer `x`. Output: `(value, position)`.

**Constraints.** Assume `x > 0`.

**Hints.** `value = x & -x`; `position = value.bit_length() - 1` (Python) or `bits.TrailingZeros32` (Go) / `Integer.numberOfTrailingZeros` (Java).

```go
func lowestSetBit(x uint32) (uint32, int) { /* TODO */ return 0, 0 }
```

```java
static int[] lowestSetBit(int x) { /* TODO */ return new int[]{0, 0}; }
```

```python
def lowest_set_bit(x):  pass  # TODO -> (value, position)
```

---

## Intermediate Tasks (5)

### I1. Round Up to Next Power of Two

**Problem.** Return the smallest power of two `>= x`. For `x <= 1` return 1.

**I/O spec.** Input: uint32 `x`. Output: uint32.

**Constraints.** `0 <= x <= 2^31`.

**Hints.** Smear the high bit down then add 1, or `1 << (32 - clz(x-1))` for `x > 1`.

```go
func nextPow2(x uint32) uint32 { /* TODO */ return 1 }
```

```java
static int nextPow2(int x) { /* TODO */ return 1; }
```

```python
def next_pow2(x):  pass  # TODO
```

---

### I2. Extract and Insert a Bit Field

**Problem.** `extract(x, lo, len)` reads bits `[lo, lo+len)` as a small number. `insert(x, lo, len, v)` replaces that field with `v`.

**I/O spec.** Input: `x`, `lo`, `len`, and `v` (fits in `len` bits). Output: extracted value / new `x`.

**Constraints.** `lo + len <= 32`.

**Hints.** `mask = ((1 << len) - 1) << lo`. Extract: `(x >> lo) & ((1<<len)-1)`. Insert: `(x & ~mask) | ((v << lo) & mask)`.

```go
func extract(x uint32, lo, length int) uint32 { /* TODO */ return 0 }
func insert(x uint32, lo, length int, v uint32) uint32 { /* TODO */ return 0 }
```

```java
static int extract(int x, int lo, int len) { /* TODO */ return 0; }
static int insert(int x, int lo, int len, int v) { /* TODO */ return 0; }
```

```python
def extract(x, lo, length):       pass  # TODO
def insert(x, lo, length, v):     pass  # TODO
```

---

### I3. Single Number

**Problem.** In an array where every value appears twice except one, return the unique value.

**I/O spec.** Input: list of ints. Output: the single int.

**Constraints.** Exactly one element appears once; all others exactly twice.

**Hints.** XOR everything; pairs cancel (`a^a=0`), leaving the answer.

```go
func singleNumber(nums []int) int { /* TODO */ return 0 }
```

```java
static int singleNumber(int[] nums) { /* TODO */ return 0; }
```

```python
def single_number(nums):  pass  # TODO
```

---

### I4. Reverse the 32 Bits

**Problem.** Reverse the bit order of a 32-bit unsigned integer.

**I/O spec.** Input: uint32 `n`. Output: uint32 with bits reversed (bit 0 ↔ bit 31, etc.).

**Constraints.** Exactly 32 bits.

**Hints.** Pull `n`'s low bit and push onto `r` shifted left, 32 times. In Java use `>>>`; in Python mask the result `& 0xFFFFFFFF`.

```go
func reverseBits(n uint32) uint32 { /* TODO */ return 0 }
```

```java
static int reverseBits(int n) { /* TODO */ return 0; }
```

```python
def reverse_bits(n):  pass  # TODO
```

---

### I5. Counting Bits 0..n (DP)

**Problem.** Return an array `ans` where `ans[i]` is the popcount of `i` for `0 <= i <= n`, in O(n).

**I/O spec.** Input: int `n >= 0`. Output: list of n+1 ints.

**Constraints.** O(n) time, no per-element popcount loop.

**Hints.** `ans[i] = ans[i & (i-1)] + 1` (one more set bit than `i` with its lowest cleared) or `ans[i] = ans[i>>1] + (i&1)`.

```go
func countBits(n int) []int { /* TODO */ return nil }
```

```java
static int[] countBits(int n) { /* TODO */ return null; }
```

```python
def count_bits(n):  pass  # TODO
```

---

## Advanced Tasks (5)

### A1. SWAR Popcount (32-bit, no builtin, no table)

**Problem.** Implement the parallel/SWAR popcount in five operations and verify it against Kernighan.

**I/O spec.** Input: uint32 `x`. Output: int popcount.

**Constraints.** No loops, no table, no builtin. Must match Kernighan on all inputs.

**Hints.** Masks `0x55555555`, `0x33333333`, `0x0F0F0F0F`; finish with `(x * 0x01010101) >> 24`. In Java use `>>>`; in Python mask the product `& 0xFFFFFFFF`.

```go
func swarPopcount(x uint32) int { /* TODO */ return 0 }
```

```java
static int swarPopcount(int x) { /* TODO */ return 0; }
```

```python
def swar_popcount(x):  pass  # TODO
```

---

### A2. Single Number II (appears three times)

**Problem.** Every element appears three times except one; find it.

**I/O spec.** Input: list of ints (may be negative). Output: the unique int.

**Constraints.** All but one element appear exactly three times.

**Hints.** For each of 32 bit positions, count set bits across the array; the answer's bit is `count % 3`. Reconstruct as a signed 32-bit int in Python.

```go
func singleNumberII(nums []int) int { /* TODO */ return 0 }
```

```java
static int singleNumberII(int[] nums) { /* TODO */ return 0; }
```

```python
def single_number_ii(nums):  pass  # TODO
```

---

### A3. De Bruijn CTZ

**Problem.** Implement ctz for a 32-bit value using a de Bruijn sequence (no builtin), and verify against a naive bit scan.

**I/O spec.** Input: uint32 `x != 0`. Output: index of the lowest set bit.

**Constraints.** Use the constant `0x077CB531` and a 32-entry table built once.

**Hints.** `table[(0x077CB531 << s) >> 27] = s` for `s` in 0..31; query with `table[((x & -x) * 0x077CB531) >> 27]`. Mask products to 32 bits in Python.

```go
func ctzDeBruijn(x uint32) int { /* TODO */ return 0 }
```

```java
static int ctzDeBruijn(int x) { /* TODO */ return 0; }
```

```python
def ctz_de_bruijn(x):  pass  # TODO
```

---

### A4. Branchless Absolute Value and Min/Max

**Problem.** Implement branchless `abs(x)`, `min(a,b)`, `max(a,b)` for signed 32-bit integers.

**I/O spec.** Input: signed 32-bit int(s). Output: signed 32-bit int.

**Constraints.** No `if`/ternary/branches. Note `abs(INT_MIN)` overflows (document it).

**Hints.** `m = x >> 31` (arithmetic); `abs = (x ^ m) - m`. For min: `b ^ ((a ^ b) & -(a < b))`. Emulate int32 in Python with masks.

```go
func absB(x int32) int32 { /* TODO */ return 0 }
func minB(a, b int32) int32 { /* TODO */ return 0 }
func maxB(a, b int32) int32 { /* TODO */ return 0 }
```

```java
static int absB(int x) { /* TODO */ return 0; }
static int minB(int a, int b) { /* TODO */ return 0; }
static int maxB(int a, int b) { /* TODO */ return 0; }
```

```python
def abs_b(x):       pass  # TODO (emulate int32)
def min_b(a, b):    pass  # TODO
def max_b(a, b):    pass  # TODO
```

---

### A5. Swap Two Bit Ranges

**Problem.** Given `x`, swap the `len`-bit field starting at `i` with the `len`-bit field starting at `j` (non-overlapping). Implement the XOR three-step swap for the extracted fields.

**I/O spec.** Input: uint32 `x`, positions `i`, `j`, width `len`. Output: uint32 with the two fields exchanged.

**Constraints.** Fields do not overlap; `i + len <= 32`, `j + len <= 32`.

**Hints.** Classic Bit-Twiddling-Hacks identity: `t = ((x >> i) ^ (x >> j)) & ((1<<len)-1); x ^= (t << i) | (t << j)`. Prove to yourself why this swaps without a temp.

```go
func swapRanges(x uint32, i, j, length int) uint32 { /* TODO */ return 0 }
```

```java
static int swapRanges(int x, int i, int j, int len) { /* TODO */ return 0; }
```

```python
def swap_ranges(x, i, j, length):  pass  # TODO
```

---

## Benchmark Task

**Problem.** Benchmark four popcount implementations — Kernighan, table lookup, SWAR, and the language builtin — over a large array of random 32-bit values, and report ns/call.

**I/O spec.** Input: a slice/array of `N` random uint32 (e.g. `N = 10_000_000`). Output: timing per method.

**Constraints.** Sum the popcounts (so the compiler cannot eliminate the work). Use the same random array for all four.

**Hints.** Expect builtin ≈ fastest (single `POPCNT`), SWAR next, table close behind when hot, Kernighan slowest/most variable on dense random data.

```go
package main

import (
	"fmt"
	"math/bits"
	"math/rand"
	"time"
)

func benchOne(name string, data []uint32, f func(uint32) int) {
	start := time.Now()
	sum := 0
	for _, v := range data {
		sum += f(v)
	}
	d := time.Since(start)
	fmt.Printf("%-10s sum=%d  %.2f ns/call\n", name, sum,
		float64(d.Nanoseconds())/float64(len(data)))
}

func main() {
	n := 10_000_000
	data := make([]uint32, n)
	for i := range data {
		data[i] = rand.Uint32()
	}
	// TODO: define kernighan, table, swar, then:
	benchOne("builtin", data, func(x uint32) int { return bits.OnesCount32(x) })
	// benchOne("kernighan", data, kernighan)
	// benchOne("table", data, table)
	// benchOne("swar", data, swar)
}
```

```java
public class PopcountBench {
    public static void main(String[] args) {
        int n = 10_000_000;
        int[] data = new int[n];
        java.util.Random r = new java.util.Random(42);
        for (int i = 0; i < n; i++) data[i] = r.nextInt();
        long start = System.nanoTime();
        long sum = 0;
        for (int v : data) sum += Integer.bitCount(v);
        long d = System.nanoTime() - start;
        System.out.printf("builtin sum=%d  %.2f ns/call%n", sum, (double) d / n);
        // TODO: bench kernighan, table, swar similarly
    }
}
```

```python
import random
import time


def bench(name, data, f):
    start = time.perf_counter()
    s = sum(f(v) for v in data)
    d = time.perf_counter() - start
    print(f"{name:10s} sum={s}  {d / len(data) * 1e9:.1f} ns/call")


if __name__ == "__main__":
    n = 1_000_000  # Python is slow; use fewer
    data = [random.getrandbits(32) for _ in range(n)]
    bench("builtin", data, int.bit_count)
    # TODO: bench kernighan, table, swar
```

---

## Self-Check Reference Oracles

Before checking your solutions, here are trivially-correct reference implementations to test against. Run your fast version and the oracle on the same inputs and assert equality.

```python
def ref_popcount(x, width=32):
    x &= (1 << width) - 1
    return sum((x >> i) & 1 for i in range(width))

def ref_ctz(x, width=32):
    x &= (1 << width) - 1
    if x == 0:
        return width
    i = 0
    while (x >> i) & 1 == 0:
        i += 1
    return i

def ref_is_pow2(x):
    return x > 0 and bin(x).count("1") == 1

def ref_next_pow2(x):
    p = 1
    while p < x:
        p <<= 1
    return p

def ref_reverse_bits(x, width=32):
    r = 0
    for i in range(width):
        r |= ((x >> i) & 1) << (width - 1 - i)
    return r
```

Recommended test harness for any solution:

```python
import random

def check(fast, oracle, gen, trials=200000):
    for _ in range(trials):
        x = gen()
        assert fast(x) == oracle(x), f"mismatch at x={x}: {fast(x)} != {oracle(x)}"
    print("all", trials, "trials passed")

# Example usage:
# check(swar_popcount, ref_popcount, lambda: random.getrandbits(32))
```

Always include the **edge corpus** — `0, 1, -1 & 0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 0xFFFFFFFF` — and all single-bit values `1 << i` for `i in 0..31`, since random inputs alone rarely hit these.

---

## General Guidance for All Tasks

- **Reference oracle.** For every trick, write a trivially-correct bit-by-bit version and compare on all 16-bit inputs plus a 64-bit random sample.
- **Edge corpus.** Test `0`, `1`, `-1`, `INT_MIN` (`0x80000000`), `INT_MAX` (`0x7FFFFFFF`), `0xFFFFFFFF`, and single-bit values.
- **Width discipline.** Decide 32 vs 64 up front; use `uint32`/`uint64` (Go), `>>>` and `int`/`long` (Java), and `& 0xFFFFFFFF` masks (Python) to emulate fixed width.
- **Guard zero** before ctz/clz and lowest-set-bit isolation.
- **Avoid XOR-swap** on possibly-aliased storage in real swap code; the three-step field swap in A5 is safe only because the fields are distinct positions of one word.
- **Prefer builtins** in production; the hand-rolled versions here are for understanding and for targets without hardware support.
- **Comment every mask** with its bit layout; a reviewer should not have to decode `0x0F0F0F0F` from scratch.

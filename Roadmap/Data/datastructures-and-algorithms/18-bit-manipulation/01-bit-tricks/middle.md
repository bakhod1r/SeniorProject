# Bit Tricks (The Foundational Bit-Manipulation Toolkit) — Middle Level

> **One-line summary:** Beyond the four single-bit moves lie the workhorse algorithms — multiple popcount strategies (Kernighan, table lookup, parallel/SWAR), the clz/ctz family and log2, robust mask construction, power-of-two utilities, and a clear-eyed account of signed-vs-unsigned and per-language builtins — each chosen for the right correctness, width, and speed trade-off.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Popcount: Four Strategies](#popcount-four-strategies)
4. [CLZ / CTZ and log2](#clz--ctz-and-log2)
5. [Mask Building](#mask-building)
6. [Power-of-Two Utilities](#power-of-two-utilities)
7. [Signed vs Unsigned](#signed-vs-unsigned)
8. [Builtins per Language](#builtins-per-language)
9. [Comparison with Alternatives](#comparison-with-alternatives)
10. [Sign Tricks and Reversal](#sign-tricks-and-reversal)
11. [Common Applications](#common-applications)
12. [Code Examples](#code-examples)
13. [Error Handling](#error-handling)
14. [Performance Analysis](#performance-analysis)
15. [Best Practices](#best-practices)
16. [Edge Cases](#edge-cases)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)

---

## Introduction

At the junior level you learned the four single-bit operations and the two identities `x & (x-1)` and `x & -x`. At the middle level the question shifts from *"what does each operator do?"* to *"which technique should I reach for, and why?"* The same task — counting set bits — has at least four reasonable implementations, and the right one depends on whether you can use a hardware builtin, how wide your data is, whether the input is sparse or dense, and how much memory you can spend on tables.

This file develops the **workhorse algorithms** of the toolkit:

- **Popcount** four ways: the Kernighan loop, a 256-entry table lookup, the parallel (SWAR) bit-twiddling method, and the hardware builtin.
- **Leading/trailing zeros** (clz/ctz), how they relate to the lowest/highest set bit, and how to get `floor(log2)` from them.
- **Mask building** — low-`i`-bits masks, range masks `[lo, hi]`, and field insert/extract done safely.
- **Power-of-two utilities** — detection, rounding up, rounding down, and "is power of two times something" checks.
- **Signed vs unsigned** — the single richest source of bit-manipulation bugs, and how each operator differs across the boundary.
- **Builtins per language** — exactly which standard-library functions to call in Go, Java, and Python, and their width and sign semantics.

The connecting theme is *deliberate engineering*: every trick has a domain where it wins and a domain where it is a liability, and a middle engineer chooses on purpose.

---

## Deeper Concepts

### From single-bit moves to algorithms

The junior level treated bits one at a time. The middle-level shift is to treat the whole word as a **parallel data structure**: one `&` intersects 32 (or 64) set memberships at once, one popcount counts them, one `x & -x` finds the lowest. The recurring pattern in everything below — SWAR popcount, mask building, bit reversal — is *divide and conquer across bit fields*, doing log-many passes that each double the field width. Recognizing that shared shape makes the individual tricks memorable rather than arbitrary.

### Bit order and endianness are different things

When we write `b₃b₂b₁b₀` we mean **bit significance**, not byte layout in memory. Bit position `i` always has place value `2^i` regardless of the machine's *byte* endianness. Endianness only affects how multi-byte integers are laid out in memory (when you reinterpret them as bytes), never the result of `&`, `|`, `^`, or shifts on the integer value itself. Keep these separate in your head — bit tricks operate on the *value*, not the byte storage.

### Why `x & -x` equals `x & (~x + 1)`

Because `-x == ~x + 1` in two's complement, `x & -x` ANDs `x` with `~x + 1`. Every bit below the lowest set bit of `x` is 0 in `x`, so `~x` has 1s there; adding 1 ripples through those low 1s and lands a single carry on the lowest set position, flipping it and clearing everything below. The net effect: only the lowest set bit survives the AND. This is the foundation of ctz-by-isolation and of Fenwick trees.

### Hamming weight and Hamming distance

The **Hamming weight** of `x` is its popcount. The **Hamming distance** between `a` and `b` is `popcount(a ^ b)` — the number of positions where they differ. This one-liner is the backbone of error-correcting codes, similarity search (e.g. SimHash), and nearest-neighbor on binary feature vectors.

### The lowest-set-bit family

Three closely related expressions confuse beginners; keep them straight:

| Expression | Result | Use |
|------------|--------|-----|
| `x & -x` | the lowest set bit as a value (`2^ctz`) | Fenwick jumps, isolate |
| `x & (x - 1)` | `x` with the lowest set bit removed | Kernighan, power-of-two test |
| `x ^ (x - 1)` | the lowest set bit and all bits below it (a run) | extract trailing run |
| `x \| (x - 1)` | `x` with all trailing zeros filled to 1 | round up within a run |
| `x & (x + 1)` | `x` with trailing ones cleared | strip a trailing run of 1s |
| `x \| (x + 1)` | `x` with the lowest clear bit set | set lowest 0 |

These six are the complete "lowest set/clear bit" toolkit. The `-1` family operates on the lowest **set** bit and its trailing zeros; the `+1` family operates on the lowest **clear** bit and its trailing ones. Each follows from the borrow/carry behavior of `±1`.

---

## Popcount: Four Strategies

### 1. Brian Kernighan's loop — O(set bits)

```
count = 0
while x: x &= x - 1; count += 1
```

Loops once per set bit. Best when the input is *sparse* (few set bits). Worst case is `width` iterations.

### 2. Table lookup — O(width / 8)

Precompute popcount for all 256 byte values, then sum the byte counts:

```
popcount(x) = table[x & 0xFF] + table[(x>>8)&0xFF] + table[(x>>16)&0xFF] + table[(x>>24)&0xFF]
```

Predictable speed regardless of input density; costs 256 bytes of cache-resident memory.

### 3. Parallel / SWAR (SIMD-within-a-register) — O(1), no table

This is the classic "Hamming weight in five operations" for a 32-bit word. It adds adjacent bit counts in parallel, doubling the field width each step:

```
x = x - ((x >> 1) & 0x55555555);                  // pairs
x = (x & 0x33333333) + ((x >> 2) & 0x33333333);    // nibbles
x = (x + (x >> 4)) & 0x0F0F0F0F;                   // bytes
x = (x * 0x01010101) >> 24;                        // sum bytes via multiply
```

No branches, no table, constant time. The multiply-and-shift on the last line sums the four byte counts at once. (Full correctness proof is in [`professional.md`](./professional.md).)

### 4. Hardware builtin — O(1)

`POPCNT` (x86), `CNT` (ARM). Exposed as `bits.OnesCount`, `Integer.bitCount`, `x.bit_count()`. **Use this in production** unless you have measured a reason not to.

| Method | Time | Memory | Best for |
|--------|------|--------|----------|
| Kernighan | O(popcount) | none | sparse inputs, simplicity |
| Table | O(width/8) | 256 B | predictable, no builtin |
| Parallel/SWAR | O(1) fixed ops | none | hot loops without `POPCNT` |
| Builtin | O(1) instr | none | **default choice** |

---

## CLZ / CTZ and log2

- **CTZ(x)** = count trailing zeros = index of the lowest set bit. `ctz(x) == popcount((x & -x) - 1)`. Undefined for `x == 0` in most builtins (returns width or is documented as UB) — guard it.
- **CLZ(x)** = count leading zeros = `(width - 1) - index of highest set bit`.
- **`floor(log2(x))`** for `x > 0` is `(width - 1) - clz(x)`. Equivalently `bit_length(x) - 1`.
- **Highest set bit value** (round *down* to power of two): `1 << (bit_length(x) - 1)`.

CTZ is the engine of Fenwick trees (`i & -i` jumps), of "find next free slot" in bitset allocators, and of fast alignment checks (`ctz(x) >= k` means `x` is a multiple of `2^k`).

| Quantity | Formula (x > 0) |
|----------|-----------------|
| index of lowest set bit | `ctz(x)` |
| index of highest set bit | `width - 1 - clz(x)` |
| `floor(log2 x)` | `width - 1 - clz(x)` |
| `ceil(log2 x)` | `width - clz(x - 1)` (for x > 1) |
| round down to pow2 | `1 << (width-1-clz(x))` |
| round up to pow2 | `1 << (width - clz(x-1))` (for x > 1) |

---

## Mask Building

| Mask | Expression | Meaning |
|------|------------|---------|
| Single bit `i` | `1 << i` | one 1 at `i` |
| Low `i` bits | `(1 << i) - 1` | `i` ones at the bottom |
| High `i` bits (width W) | `~((1 << (W - i)) - 1)` | `i` ones at the top |
| Bits `[lo, hi]` inclusive | `((1 << (hi - lo + 1)) - 1) << lo` | a run of ones |
| All bits | `~0` (or `-1` two's complement) | every bit set |
| Clear bits `[lo, hi]` | `x & ~range_mask` | zero out a field |
| Insert value `v` into field | `(x & ~field) \| ((v << lo) & field)` | replace a field |

The single most common bug: building `(1 << i) - 1` when `i` equals the width. `1 << 32` on a 32-bit type is undefined, so the "all 32 bits" mask must be `~0`, not `(1 << 32) - 1`. Always special-case full-width masks.

---

## Power-of-Two Utilities

```python
def is_power_of_two(x):       return x > 0 and (x & (x - 1)) == 0
def round_down_pow2(x):       return 1 << (x.bit_length() - 1)      # x > 0
def round_up_pow2(x):                                               # x >= 1
    return 1 if x <= 1 else 1 << ((x - 1).bit_length())
def is_multiple_of_pow2(x, k): return (x & ((1 << k) - 1)) == 0     # divisible by 2^k
def align_up(x, a):           return (x + a - 1) & ~(a - 1)         # a must be pow2
```

`align_up` is ubiquitous in allocators: round `x` up to the next multiple of a power-of-two alignment `a`. It works because `~(a-1)` clears exactly the low `log2(a)` bits.

---

## Signed vs Unsigned

This is where bit tricks bite. The same bit pattern is interpreted differently, and operators diverge:

| Aspect | Unsigned | Signed (two's complement) |
|--------|----------|----------------------------|
| MSB meaning | another value bit (`2^(W-1)`) | sign: 1 ⇒ negative |
| `>>` | logical (fills 0) | arithmetic (fills sign bit) |
| `~x` | `2^W - 1 - x` | `-x - 1` |
| `-x` | wraps mod `2^W` | negation (overflow at `INT_MIN`) |
| range | `0 .. 2^W - 1` | `-2^(W-1) .. 2^(W-1)-1` |
| compare | straightforward | sign-aware |

Practical rules:

- **Use unsigned types for pure bit work** so `>>` is logical and high bits are not "sign".
- In **Java** there is no unsigned `int`; use `>>>` for logical right shift, and `Integer.toUnsignedLong`/`Long.divideUnsigned` for unsigned semantics.
- In **Go** prefer `uint`/`uint32`/`uint64` for masks; `>>` on signed types is arithmetic.
- In **Python** there is no fixed width or sign bit at all — `~x == -x-1` and shifts never overflow. Emulate fixed width with `& 0xFFFFFFFF` and reinterpret the sign manually: `v - (1 << 32) if v >= (1 << 31) else v`.

Sign tricks worth knowing (32-bit, x is `int`):

- **abs via shift:** `m = x >> 31; (x ^ m) - m` (no branch; `m` is all-1s if negative).
- **sign of x:** `(x >> 31) | ((-x) >> 31)` gives -1/0/+1 (careful with `INT_MIN`).
- **sign extension** of an `n`-bit value `v`: `(v << (W-n)) >> (W-n)` with an arithmetic shift.

---

## Builtins per Language

| Need | Go (`math/bits`) | Java | Python |
|------|------------------|------|--------|
| popcount | `bits.OnesCount(x)`, `OnesCount32/64` | `Integer.bitCount(x)`, `Long.bitCount` | `x.bit_count()` (3.10+) or `bin(x).count('1')` |
| trailing zeros (ctz) | `bits.TrailingZeros(x)` | `Integer.numberOfTrailingZeros` | `(x & -x).bit_length() - 1` |
| leading zeros (clz) | `bits.LeadingZeros(x)` | `Integer.numberOfLeadingZeros` | `W - x.bit_length()` |
| bit length / log2 | `bits.Len(x)` | `32 - nlz` / `Integer.SIZE - ...` | `x.bit_length()` |
| reverse bits | `bits.Reverse(x)` | `Integer.reverse(x)` | manual loop |
| reverse bytes | `bits.ReverseBytes(x)` | `Integer.reverseBytes` | `int.from_bytes(x.to_bytes(...,'big'),'little')` |
| rotate left | `bits.RotateLeft(x, k)` | `Integer.rotateLeft(x, k)` | manual `((x<<k)\|(x>>(W-k))) & mask` |
| highest set bit | `bits.Len(x) - 1` | `Integer.highestOneBit` (value) | `1 << (x.bit_length()-1)` |

Width note: Go's plain `bits.OnesCount` operates on `uint` (platform width); use the explicit `OnesCount32`/`OnesCount64` when width matters. Java's `Integer.*` are 32-bit; use `Long.*` for 64-bit.

---

## Comparison with Alternatives

| Task | Bit trick | Arithmetic / library alternative | When the alternative wins |
|------|-----------|----------------------------------|----------------------------|
| Parity (odd?) | `x & 1` | `x % 2` | never — same speed, `& 1` clearer for parity |
| Multiply by 8 | `x << 3` | `x * 8` | almost always use `* 8`; compiler optimizes, and it reads clearly |
| Power-of-two check | `x & (x-1) == 0` | `log2(x).is_integer()` | never — float log2 is slower and imprecise |
| Membership in small set | `mask & (1<<e)` | `set.contains(e)` | when the universe is large/sparse → hash set |
| Count set bits | `popcount` builtin | loop counting | builtin always wins |
| log2 floor | `W-1-clz` | `int(math.log2(x))` | bit version is exact; float can be off by one near powers |

The recurring lesson: bit tricks win for **fixed small universes** and **hardware-supported O(1) ops**; libraries/containers win for **large, sparse, or dynamic** data, and plain arithmetic wins for **readability** when the compiler already optimizes it.

---

## Sign Tricks and Reversal

A cluster of width-aware tricks every middle engineer should recognize (shown for signed 32-bit `x`):

| Trick | Expression | Notes |
|-------|------------|-------|
| Branchless abs | `m = x >> 31; (x ^ m) - m` | `m` is all-ones if negative; fails at `INT_MIN` |
| Sign (-1/0/+1) | `(x > 0) - (x < 0)` | clean, no `INT_MIN` issue |
| Same sign? | `(a ^ b) >= 0` | sign bits equal ⇒ XOR's top bit 0 |
| Conditional negate | `(x ^ -c) + c` | negate iff `c == 1` |
| Min (branchless) | `b ^ ((a ^ b) & -(a < b))` | predicate as 0/all-ones mask |
| Max (branchless) | `a ^ ((a ^ b) & -(a < b))` | dual of min |
| Average (no overflow) | `(a & b) + ((a ^ b) >> 1)` | avoids `(a+b)` overflow |
| Detect opposite signs | `(a ^ b) < 0` | top bits differ |

**Bit reversal** (`O(log W)`) swaps progressively larger groups, the same divide-and-conquer shape as SWAR popcount:

```
x = ((x & 0x55555555) << 1) | ((x >> 1) & 0x55555555);  // swap adjacent bits
x = ((x & 0x33333333) << 2) | ((x >> 2) & 0x33333333);  // swap pairs
x = ((x & 0x0F0F0F0F) << 4) | ((x >> 4) & 0x0F0F0F0F);  // swap nibbles
x = ((x & 0x00FF00FF) << 8) | ((x >> 8) & 0x00FF00FF);  // swap bytes
x = (x << 16) | (x >> 16);                              // swap halves
```

For production, prefer `bits.Reverse32`, `Integer.reverse`. The manual cascade is worth understanding because the same group-swap pattern appears in byte-swap (endianness) and Morton-code interleaving.

**Average-without-overflow** deserves emphasis: `(a + b) / 2` can overflow when `a + b` exceeds the type's range (a famous binary-search bug). `(a & b) + ((a ^ b) >> 1)` computes the same midpoint with no intermediate overflow, because `a + b = (a ^ b) + 2(a & b)` (the full-adder identity), so the midpoint is `(a & b) + (a ^ b)/2`.

---

## Common Applications

Where these tricks actually show up:

- **Bitmask DP / subset enumeration.** A state is an integer whose bits mark chosen items; transitions use `set`/`test`/submask enumeration. The traveling-salesman DP and many "subset of cities/items" problems are bitmask DP.
- **Fenwick (BIT) trees.** The update/query jumps are `i += i & -i` and `i -= i & -i` — pure lowest-set-bit isolation.
- **Hash tables.** Capacities are powers of two so the modulo is `hash & (cap - 1)`; resizing rounds up to the next power of two.
- **Feature flags / permission bits.** Pack many booleans into one integer; `set`/`clear`/`test` per flag. Unix file permissions (`rwx` = 3 bits) are the canonical example.
- **Graphics and color.** Pack RGBA into 32 bits (8 bits per channel); extract a channel with shift + mask; alpha-blend with bit math.
- **Compression and encoding.** Variable-length codes, bit-packed streams, and Gray codes (`n ^ (n >> 1)`) all rely on this toolkit.
- **Sets over small universes.** `BitSet`/`std::bitset`: union/intersection/difference as `|`/`&`/`&~`, cardinality as popcount.
- **Checksums and hashing.** CRC, parity, and many hash mixers are sequences of shifts and XORs.

Recognizing which application you are in tells you the width to use and whether sign matters (graphics/sets are unsigned; arithmetic tricks may be signed).

---

## Code Examples

### Example: Popcount Four Ways + clz/ctz + Round-Up-Pow2

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

func popKernighan(x uint32) int {
	c := 0
	for x != 0 {
		x &= x - 1
		c++
	}
	return c
}

var byteTable [256]int

func initTable() {
	for i := range byteTable {
		byteTable[i] = popKernighan(uint32(i))
	}
}

func popTable(x uint32) int {
	return byteTable[x&0xFF] + byteTable[(x>>8)&0xFF] +
		byteTable[(x>>16)&0xFF] + byteTable[(x>>24)&0xFF]
}

func popParallel(x uint32) int {
	x = x - ((x >> 1) & 0x55555555)
	x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
	x = (x + (x >> 4)) & 0x0F0F0F0F
	return int((x * 0x01010101) >> 24)
}

func roundUpPow2(x uint32) uint32 {
	if x <= 1 {
		return 1
	}
	return 1 << (32 - bits.LeadingZeros32(x-1))
}

func main() {
	x := uint32(0xB3) // 10110011 -> 5 set bits
	fmt.Println(popKernighan(x), popTable(x), popParallel(x), bits.OnesCount32(x)) // 5 5 5 5
	fmt.Println("ctz:", bits.TrailingZeros32(x), "clz:", bits.LeadingZeros32(x))
	fmt.Println("roundUpPow2(100):", roundUpPow2(100)) // 128
}

func init() { initTable() }
```

#### Java

```java
public class PopcountFourWays {
    static int popKernighan(int x) {
        int c = 0;
        while (x != 0) { x &= x - 1; c++; }
        return c;
    }

    static final int[] TABLE = new int[256];
    static { for (int i = 0; i < 256; i++) TABLE[i] = popKernighan(i); }

    static int popTable(int x) {
        return TABLE[x & 0xFF] + TABLE[(x >>> 8) & 0xFF]
             + TABLE[(x >>> 16) & 0xFF] + TABLE[(x >>> 24) & 0xFF];
    }

    static int popParallel(int x) {
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        x = (x + (x >>> 4)) & 0x0F0F0F0F;
        return (x * 0x01010101) >>> 24;
    }

    static int roundUpPow2(int x) {
        if (x <= 1) return 1;
        return 1 << (32 - Integer.numberOfLeadingZeros(x - 1));
    }

    public static void main(String[] args) {
        int x = 0xB3; // 5 set bits
        System.out.println(popKernighan(x) + " " + popTable(x) + " "
            + popParallel(x) + " " + Integer.bitCount(x)); // 5 5 5 5
        System.out.println("ctz=" + Integer.numberOfTrailingZeros(x)
            + " clz=" + Integer.numberOfLeadingZeros(x));
        System.out.println("roundUpPow2(100)=" + roundUpPow2(100)); // 128
    }
}
```

#### Python

```python
TABLE = [0] * 256
for i in range(256):
    c, v = 0, i
    while v:
        v &= v - 1
        c += 1
    TABLE[i] = c

MASK32 = 0xFFFFFFFF


def pop_kernighan(x):
    c = 0
    while x:
        x &= x - 1
        c += 1
    return c


def pop_table(x):
    x &= MASK32
    return (TABLE[x & 0xFF] + TABLE[(x >> 8) & 0xFF]
            + TABLE[(x >> 16) & 0xFF] + TABLE[(x >> 24) & 0xFF])


def pop_parallel(x):
    x &= MASK32
    x = x - ((x >> 1) & 0x55555555)
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
    x = (x + (x >> 4)) & 0x0F0F0F0F
    return ((x * 0x01010101) & MASK32) >> 24


def round_up_pow2(x):
    return 1 if x <= 1 else 1 << (x - 1).bit_length()


if __name__ == "__main__":
    x = 0xB3  # 5 set bits
    print(pop_kernighan(x), pop_table(x), pop_parallel(x), x.bit_count())  # 5 5 5 5
    ctz = (x & -x).bit_length() - 1
    print("ctz:", ctz, "clz:", 32 - x.bit_length())
    print("roundUpPow2(100):", round_up_pow2(100))  # 128
```

**What it does:** computes popcount four independent ways (all agree on 5), shows ctz/clz, and rounds 100 up to 128.
**Run:** `go run main.go` | `javac PopcountFourWays.java && java PopcountFourWays` | `python pop.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `ctz(0)` returns garbage / width | Zero has no set bit. | Guard `x == 0` before calling ctz. |
| Parallel popcount wrong in Java for high inputs | Used `>>` (arithmetic) on negative `int`. | Use `>>>` everywhere in the SWAR steps. |
| Python parallel popcount overflows expectations | No 32-bit wrap; the `* 0x01010101` grows unboundedly. | Mask the product `& MASK32` before the final shift. |
| `round_up_pow2` returns 0 | `1 << 32` truncated on 32-bit type when `x` already huge. | Cap inputs; use 64-bit, or special-case `x > 2^31`. |
| Table lookup uses signed shift | `(x >> 8)` arithmetic on negative `int` in Java. | Use `>>>` and `& 0xFF`. |
| `align_up` wrong | Alignment `a` not a power of two. | Assert `a & (a-1) == 0`. |

---

## Performance Analysis

- **Builtin popcount** compiles to one `POPCNT`/`CNT` instruction — roughly 3 cycles, fully pipelined. Nothing in software beats it on modern hardware.
- **SWAR popcount** is ~12 instructions, all register-only, no branches; the best portable fallback when `POPCNT` is unavailable (older targets, certain JIT contexts).
- **Table lookup** is 4 loads + 3 adds; the loads can stall on a cold cache. It loses to SWAR on hot paths but wins when the table is hot and the CPU lacks `POPCNT`.
- **Kernighan** is variable-time (data-dependent branches), so it is great for sparse data but a branch-prediction hazard for dense/random data. Avoid in constant-time crypto contexts.
- **clz/ctz builtins** map to `LZCNT`/`TZCNT`/`BSR`/`BSF` — single instructions. The naive bit-scan loop is O(width) and should only appear in fallbacks.
- **Mask construction is free** — `(1 << i) - 1` and friends are one or two instructions; do not precompute small masks into tables, the arithmetic is cheaper than the load.

```
# Microbenchmark intuition (32-bit, random inputs, per call):
# builtin POPCNT      ~  1 ns
# SWAR parallel       ~  3 ns
# table lookup        ~  4 ns (hot cache)
# Kernighan           ~  6-20 ns (depends on density, branch misses)
```

---

## Best Practices

- **Default to builtins** for popcount/clz/ctz; drop to SWAR only with a measured reason and a comment explaining it.
- **Pin your width.** Use `uint32`/`uint64` (Go), `int`/`long` with `>>>` (Java), or explicit masks (Python). Document it in the function name or signature.
- **Guard zero** for ctz/clz and lowest-set-bit isolation.
- **Name your masks** as constants (`LOW_NIBBLE = 0x0F`) and comment the bit layout for field operations.
- **Prefer unsigned shifts** for logical behavior; reserve arithmetic shift for deliberate sign-extension.
- **Keep a brute-force oracle** in tests for every popcount/clz/ctz/mask helper.
- **Choose the lowest-bit expression deliberately.** `x & -x` (value), `x & (x-1)` (remove), and `ctz` (index) answer different questions — picking the wrong one is a common silent bug.
- **Round up to a power of two with `x - 1` first** so that exact powers map to themselves rather than doubling.
- **Use the average-without-overflow midpoint** `(lo & hi) + ((lo ^ hi) >> 1)` (or `lo + (hi - lo) / 2`) in binary search to avoid the classic `(lo + hi)` overflow.

### A worked density example

To see why density picks the popcount method, count bits of two 32-bit values:

```
x = 0x00000008 (one bit):  Kernighan = 1 iteration; SWAR = fixed ~12 ops
x = 0xFFFFFFFF (32 bits):  Kernighan = 32 iterations; SWAR = same ~12 ops
```

For the sparse value Kernighan wins (1 vs 12 ops); for the dense value SWAR wins (12 vs 32). On uniformly random data the average popcount is 16, so SWAR/builtin is the safer default and Kernighan is reserved for inputs you *know* are sparse (e.g. a mostly-empty bitset word).

---

## Edge Cases

| Case | Behavior | Guidance |
|------|----------|----------|
| `x = 0` | popcount 0; `x & -x = 0`; ctz undefined | guard ctz/clz; 0 is not a power of two |
| `x = 1` | popcount 1; ctz 0; lowest set bit = 1 | already a power of two |
| `x = INT_MIN` (`0x80000000`) | single high bit set; `-x == x` | `x & -x == x` works but negation wraps |
| `x = -1` (`0xFFFFFFFF`) | popcount = W; `x & (x-1)` clears top loop | all bits set |
| Full-width mask | use `~0`, not `(1 << W) - 1` | `1 << W` is UB / no-op |
| Round-up-pow2 of a power of two | returns the value itself | use `x - 1` first so it does not jump |
| Shift by 0 in rotate | `x >> (W - 0)` is shift-by-W | guard `k == 0` or use the builtin |
| Negative number, ctz | works in two's complement | reason in binary, not decimal |

The two that trip people most: **`x = 0`** (guard before ctz/clz/power-of-two) and **full-width masks** (`~0`, never `(1<<W)-1`). Bake both into your helpers once and they stop recurring.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The 32 bit cells of an editable integer with live binary/decimal/hex readout
> - Stepping `x & (x-1)` (clear lowest set bit) and `x & -x` (isolate it)
> - Kernighan's popcount loop, counting one removed set bit per step
> - Set / clear / toggle on a chosen bit index with highlighted masks

---

## Summary

The middle-level toolkit is about choosing the right technique. Popcount has four reasonable forms — Kernighan (sparse, simple), table (predictable, costs 256 B), SWAR/parallel (branchless O(1), no table), and the hardware builtin (the default) — and you pick based on density, available instructions, and constant-time needs. The clz/ctz family gives you the indices of the highest and lowest set bits and hence `log2`, powering Fenwick jumps, allocators, and alignment. The six-member lowest-set/clear-bit family (`x & -x`, `x & (x-1)`, `x ^ (x-1)`, and the `+1` duals) covers every "act on the lowest set or clear bit" need without a loop. Mask building is mechanical but trap-laden at full width (`~0`, never `(1<<W)-1`). Power-of-two utilities (detect, round up/down, align) recur in allocators and hash tables, and the sign-trick cluster (branchless abs/min/max, average-without-overflow, same-sign test) shows up in performance-sensitive arithmetic.

And above all, **signed vs unsigned** governs how `>>`, `~`, and `-x` behave — use unsigned types, Java's `>>>`, and explicit Python masks to stay correct. Bit reversal and byte-swap follow the same divide-and-conquer group-swap shape as SWAR popcount, but prefer the builtins (`bits.Reverse`, `Integer.reverse`, `reverseBytes`) in real code. The applications — bitmask DP, Fenwick trees, hash-table sizing, feature flags, packed color, compression, small-universe sets — are where this all pays off. Lean on the standard-library builtins (`math/bits`, `Integer`/`Long`, `int.bit_count`) and reserve hand-rolled tricks for measured hot paths, always guarding `x = 0` and full-width masks.

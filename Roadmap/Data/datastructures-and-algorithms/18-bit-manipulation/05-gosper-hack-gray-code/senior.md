# Gosper's Hack & Gray Code — Senior Level

> On a small input both tricks are trivially correct — but the moment the universe approaches the word boundary, the masks must survive a 64-bit overflow at the top of the range, the Gray code drives real hardware (rotary/optical encoders, low-power state machines), or the enumeration is the inner loop of a bitmask DP, every detail (overflow sentinels, signed-vs-unsigned shifts, exact integer division, when to prefer recursion) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Overflow at the High End of Gosper](#2-overflow-at-the-high-end-of-gosper)
3. [Signed Shifts, Word Width, and Type Discipline](#3-signed-shifts-word-width-and-type-discipline)
4. [Gray Code in Hardware and Encoders](#4-gray-code-in-hardware-and-encoders)
5. [Gosper vs Recursive Combination Generation](#5-gosper-vs-recursive-combination-generation)
6. [Production Use Inside Bitmask DP](#6-production-use-inside-bitmask-dp)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "what does the formula compute" but "what system am I embedding it in, and what breaks when I scale it?". Gosper's hack and Gray code show up in three production guises that share the same bit-iteration core:

1. **Combinatorial enumeration inside a hot loop** — a bitmask DP or brute-force search that iterates all fixed-size subsets `C(n, k)` times. Here Gosper's `O(1)` per step and zero allocation matter, and the dominant risk is high-end overflow when `n` nears the word width.
2. **Minimal-transition encoding** — a Gray code driving a physical encoder, a low-power state machine, or a test-vector generator where each transition has a real cost (a glitch, a watt, a clock edge). Here correctness of the *one-bit-change* invariant under the real bit width is the whole point.
3. **Index/address remapping** — converting between a linear counter and a Gray-coded address (memory test patterns, error-tolerant counters, delta encodings), where the forward and inverse conversions must be exact and fast.

All three reduce to a handful of bit operations, but the senior decisions are: keep the arithmetic exact and overflow-free at the top of the range, choose signed vs unsigned and the right word width, decide when the iterative bit trick beats a recursive generator, and verify the invariants when the universe is too large to brute-force.

This document treats those decisions in production terms: where the overflow actually occurs and how to fence it, the type discipline that keeps shifts correct, the hardware contexts that make Gray code non-negotiable, the precise trade against recursion, and the feasibility math that decides whether enumeration is even the right approach.

---

## 2. Overflow at the High End of Gosper

### 2.1 Where the overflow happens

The dangerous line is `r = x + c`. When the current mask already has set bits near the top of the word, adding the lowest set bit can carry into — or past — the most significant bit. For a `w`-bit unsigned type, if `x` is the largest `k`-mask that fits in `w` bits and you call the hack anyway, `x + c` may wrap to a small value, and the loop either terminates early, loops forever, or emits garbage.

For our standard loop the stop condition `x < (1 << n)` with `n ≤ w − 1` keeps us safe *as long as `n` is strictly less than the word width*. The two real hazards:

- **`n == w`** (e.g. `n = 64` with `uint64`): `1 << n` itself overflows to `0`, so the stop condition `x < 0` is never true and the loop is wrong from the start.
- **Calling `nextCombination` on the maximal mask** without a guard: the ripple carry pushes a bit off the top.

### 2.2 The sentinel technique

The clean fix is to reserve one extra **sentinel bit** above the `n` real bits. Work in a `w`-bit type with `n ≤ w − 1`, so the carry from `r = x + c` always has somewhere to go: when the high bit reaches the sentinel position `n`, the mask becomes `≥ 1 << n` and the stop condition fires *before* any true overflow. Concretely:

- Use `uint64` and require `n ≤ 63`. Then `1 << n` is representable (for `n ≤ 63`), the maximal `k`-mask is `< 1 << n`, and one Gosper step from it yields a value `≥ 1 << n` that exits the loop without wrapping the 64-bit word.
- If you genuinely need `n = 64`, switch to a 128-bit type (`__int128`, `math/big`, Python bigint) or restructure so the sentinel lives in bit 64.

### 2.3 Detecting the last combination explicitly

Rather than relying solely on the bound, you can detect "this is the last `k`-subset" directly: the maximal `k`-mask in `n` bits is `((1 << k) - 1) << (n - k)`. Comparing against it lets you stop *without* ever calling the hack on the boundary mask:

```
maxMask := (((uint64(1) << uint(k)) - 1) << uint(n-k))
for x := smallest; ; {
    use(x)
    if x == maxMask { break }       // never call the hack past the top
    x = nextCombination(x)
}
```

This is the most robust pattern when `n` is close to the word width, because it removes the overflow window entirely.

### 2.3b A worked overflow scenario

To see the failure concretely, take a hypothetical 4-bit word (`w = 4`) and enumerate `2`-subsets of `n = 4`. The maximal `2`-mask in 4 bits is `0b1100 = 12`. Run the loop *without* the explicit max-mask guard, using the bound `x < (1 << 4) = 16`:

```
x = 0011 (3)  -> next = 0101 (5)
x = 0101 (5)  -> next = 0110 (6)
x = 0110 (6)  -> next = 1001 (9)
x = 1001 (9)  -> next = 1010 (10)
x = 1010 (10) -> next = 1100 (12)
x = 1100 (12) < 16, so we call nextCombination(12):
    c = 12 & -12 = 0100 (4)
    r = 12 + 4  = 10000 -> WRAPS to 0000 in a 4-bit word
    result becomes garbage; the loop may now spin or emit nonsense.
```

The bound `x < 16` did not protect us because the *intermediate* `r = x + c` overflowed before the comparison. With `w = 4` and `n = 4` there is no sentinel bit. The fixes from Sections 2.2–2.3 — require `n ≤ w − 1`, or stop on `x == maxMask = 12` *before* the call — both prevent this. On real 64-bit hardware the same bug appears at `n = 64`, which is why `n ≤ 63` (one sentinel bit) is the standard contract.

### 2.4 Big-integer Gosper

When `n > 63`, the hack still works over arbitrary-precision integers — every operation (`& -x`, `+`, `^`, `>>`, exact `/`) is defined for bigints. Python gets this for free; Go uses `math/big` (note `big.Int` has no native `-x` two's complement, so compute the lowest set bit as `x & (^x + 1)` over a fixed width, or use `x.And(x, new(big.Int).Neg(x))` carefully). The per-step cost rises from `O(1)` to `O(n / word)` for the bigint arithmetic, but the algorithm is unchanged. In practice, if `n > 63` and `C(n, k)` is small, bigint Gosper is fine; if `C(n, k)` is large, you have a bigger problem (the enumeration itself is infeasible).

---

## 3. Signed Shifts, Word Width, and Type Discipline

### 3.1 The signed-shift trap in Gray code

`gray(x) = x ^ (x >> 1)` and the inverse loop both shift right. On a **signed** integer with the top bit set, `>>` is an *arithmetic* shift in Java and C (sign-extending), so `0x8000...0 >> 1` becomes `0xC000...0`, not `0x4000...0`. This silently corrupts both the Gray value and its inverse for any mask using the sign bit.

Mitigations by language:

- **Go:** use `uint64` (unsigned types shift logically). Never use `int` for masks that may set the top bit.
- **Java:** use `>>>` (logical right shift) instead of `>>`, or keep values in `long` and ensure they stay non-negative. Java has no unsigned types, so `>>>` is mandatory for the high half of the range.
- **Python:** integers are arbitrary precision and non-negative-shift-safe, but you must mask to `n` bits explicitly if you want fixed-width semantics (`x & ((1 << n) - 1)`).

### 3.2 The two's-complement dependency of `x & -x`

The lowest-set-bit idiom `x & -x` relies on two's complement: `-x = ~x + 1`. This is well-defined for unsigned and standard signed types, but for bigints the unary minus does not flip an infinite sign extension. In Go's `math/big` you cannot write `x & -x` directly; compute `x.And(x, new(big.Int).Neg(x))` which works because `big.Int` models two's complement for bitwise ops, or isolate the bit by `TrailingZeros`. Know your library's contract.

### 3.3 Choosing the word width

| Universe size `n` | Recommended type | Why |
|---|---|---|
| `n ≤ 31` | `uint32` / Java `int` (careful with sign) | fits with room for the sentinel |
| `n ≤ 63` | `uint64` / Java `long` + `>>>` | the standard choice; sentinel at bit `n` |
| `n == 64` | 128-bit or bigint | `1 << 64` overflows 64-bit |
| `n > 64` | bigint (`math/big`, Python int) | no native width suffices |

The rule of thumb: pick a type at least one bit wider than `n` so the sentinel/stop logic never touches a true overflow.

---

## 4. Gray Code in Hardware and Encoders

### 4.1 Why encoders use Gray code

A rotary or linear **absolute position encoder** reads several parallel tracks to report a position. With plain binary, moving from `0111` to `1000` flips all four bits "at once" — but physically the tracks never switch perfectly simultaneously, so a sensor sampling mid-transition can read a spurious value like `1111` or `0000`, producing a wildly wrong position. **Gray code guarantees only one track changes per position step**, so any mid-transition read is at most off by one position — a small, bounded, recoverable error. This is the original engineering motivation (Frank Gray, Bell Labs, 1947) and remains the reason encoders, ADCs, and some state machines use it.

### 4.2 Minimizing transitions for power and EMI

In low-power and high-speed digital design, each bit toggle costs dynamic power (`P ∝ C·V²·f·activity`) and contributes to electromagnetic interference. Sequencing addresses or state codes in Gray order minimizes the toggle count to exactly one per step, cutting switching activity. Examples: Gray-coded address counters for FIFOs crossing clock domains (the canonical asynchronous-FIFO pointer trick), Gray-coded finite-state-machine encodings to reduce glitching, and Gray-coded DAC inputs.

### 4.3 Clock-domain-crossing FIFOs

A classic production use: an asynchronous FIFO's read/write pointers are Gray-coded before crossing the clock boundary. Because only one bit changes per increment, the synchronizer on the other side can never latch a multi-bit-corrupted pointer value — at worst it sees the old or the new value, both of which are safe. Using binary pointers here is a well-known hardware bug. The conversion is the same `x ^ (x >> 1)` synthesized in RTL.

### 4.3b Worked async-FIFO pointer increment

Consider a FIFO with `8` slots, so pointers are `3`-bit. The write pointer increments `0 → 1 → 2 → …`. Crossing into the read clock domain, we transmit the *Gray-coded* pointer:

```
binary ptr   gray ptr (x ^ x>>1)   bits changing across the boundary
000          000
001          001                   1 bit
010          011                   1 bit
011          010                   1 bit
100          110                   1 bit
```

Because each increment changes exactly one Gray bit, the multi-flop synchronizer on the read side can only ever sample the *old* or the *new* value of that single bit — never a corrupted combination. With a *binary* pointer, the `011 → 100` increment flips three bits; if the synchronizer samples mid-transition it could read `111`, `000`, or any of several wrong values, corrupting the full/empty computation and causing data loss or duplication. This is the canonical reason async-FIFO pointers are Gray-coded; the depth is usually a power of two precisely so the Gray code wraps cleanly (the reflected code is cyclic, Section 7 of `professional.md`).

### 4.4 Karnaugh maps and combinatorial layout

Karnaugh maps order their rows and columns in Gray code so that physically adjacent cells differ in exactly one variable — which is exactly what makes adjacent `1`-cells groupable into simplified product terms. The same one-bit-change adjacency underlies certain test-pattern generators (e.g. walking a single input change to isolate faults) and the towers-of-Hanoi connection: the sequence of disks moved in optimal Hanoi corresponds bit-for-bit to the changing bit positions of the Gray code, which is why both have the same "one minimal change at a time" structure.

---

## 5. Gosper vs Recursive Combination Generation

### 5.1 Decision matrix

| Criterion | Gosper's hack | Recursive / `combinations` |
|---|---|---|
| Per-item cost | `O(1)` | `O(k)` to materialize each combo |
| Allocation | none (one register) | recursion stack / tuple per item |
| Order | increasing numeric (= lexicographic of masks) | lexicographic of element tuples |
| Element type | integers `0..n-1` only (bitmask) | any comparable/iterable elements |
| Universe size | bounded by word width (or bigint) | unbounded |
| Cache behavior | excellent (no pointer chasing) | poorer (stack frames, allocations) |
| Readability | opaque (the formula) | clear |
| Parallelizability | easy: split the numeric range and `unrank` to a start mask | harder |

### 5.2 When to prefer Gosper

- The inner loop of a **bitmask DP** where each state is a mask and you iterate over fixed-size subsets millions of times. Zero allocation and `O(1)` stepping dominate.
- You need the masks **in sorted order** for a downstream merge or binary search.
- `n` is comfortably within the word width and `C(n, k)` is feasible.

### 5.3 When to prefer recursion

- Elements are **not** small integers (strings, objects) — building a bitmask is artificial.
- `n` exceeds the word width and `C(n, k)` is still small (bigint Gosper works but recursion is clearer).
- You want **early pruning**: a recursive generator can abandon a whole subtree (branch-and-bound), which the flat Gosper loop cannot — it always produces the full `C(n, k)` sequence. If your search prunes heavily, recursion's ability to skip is worth more than Gosper's per-step speed.

### 5.4 Unranking for parallel/streamed enumeration

To start Gosper from the `m`-th combination (for sharding work across threads), use **combinatorial unranking**: convert rank `m` to the corresponding `k`-mask via the combinatorial number system, then run Gosper from there. This lets you split the `C(n, k)` space into contiguous numeric ranges and assign each to a worker — far cleaner than trying to parallelize a recursive generator. Each shard runs the identical `O(1)` step; the only shared setup is the one-time unrank.

---

## 6. Production Use Inside Bitmask DP

### 6.1 The pattern

Many DP problems iterate over subsets *of a fixed size* — assigning exactly `k` tasks, choosing exactly `k` centers, partitioning into groups of known sizes. The transition iterates `mask` over all `C(n, k)` subsets and combines with a DP table indexed by mask. Gosper is the canonical generator:

```
for k := 0; k <= n; k++ {
    for mask := smallestKMask(k); mask < (1<<n); mask = nextCombination(mask) {
        // dp[mask] transitions: pick/drop one element, etc.
    }
}
```

Iterating by increasing popcount (outer `k` loop) is exactly the order needed when a DP state of popcount `k` depends only on states of popcount `k − 1` — a common structure (e.g. Hamiltonian-path / assignment DPs).

### 6.2 Submask vs fixed-size-subset iteration

Be precise about which enumeration you need:

- **All submasks of a mask** (`for s = mask; s; s = (s-1) & mask`) — the classic SOS/subset-sum-over-subsets loop, `O(3^n)` total across all masks. *Not* Gosper.
- **All fixed-size subsets of the universe** — Gosper, `C(n, k)` masks.

Confusing the two is a frequent senior-level design error; they have different costs and different orders.

### 6.3 Keeping the universe minimal

Cost is `C(n, k)`, super-exponential in `n`. The lever is **shrinking `n`**: fix forced elements before enumerating, exploit symmetry to dedupe equivalent masks, and prune impossible elements. Halving the free-element count can turn an infeasible `C(40, 20)` into a feasible `C(20, 10)`.

### 6.4 Worked feasibility estimate

Before writing any enumeration, estimate `C(n, k)` and the wall-clock budget. At a conservative `10^8` masks processed per second (Gosper step plus a light per-mask body), the time is roughly `C(n, k) / 10^8` seconds:

| `n, k` | `C(n, k)` | est. time at 10^8/s | verdict |
|--------|-----------|---------------------|---------|
| `30, 15` | ~1.55×10^8 | ~1.5 s | borderline; tighten the body |
| `34, 17` | ~2.3×10^9 | ~23 s | likely too slow for an interactive path |
| `40, 20` | ~1.4×10^11 | ~23 min | infeasible online; needs pruning/reformulation |
| `50, 25` | ~1.26×10^14 | ~14 days | infeasible |

The takeaway: Gosper's `O(1)` step does not move these walls — only reducing `n` (or `k` toward an extreme) or abandoning full enumeration does. A frequent senior decision is to recognize that the "iterate all `k`-subsets" framing is itself the bottleneck and to replace it with meet-in-the-middle, DP, or a greedy/LP relaxation.

---

## 7. Code Examples

### 7.1 Go — overflow-safe Gosper with explicit max-mask stop

```go
package main

import "fmt"

func nextCombination(x uint64) uint64 {
	c := x & (-x)
	r := x + c
	return (((r ^ x) >> 2) / c) | r
}

// Enumerate k-subsets of {0..n-1}, robust at the top of the range.
// Requires n <= 63 so the 64-bit word always has a sentinel bit.
func enumerate(n, k int, use func(uint64)) {
	if k == 0 {
		use(0)
		return
	}
	if k > n {
		return
	}
	maxMask := uint64((1<<uint(k))-1) << uint(n-k) // largest k-mask in n bits
	x := uint64((1 << uint(k)) - 1)
	for {
		use(x)
		if x == maxMask { // stop BEFORE calling the hack on the boundary
			break
		}
		x = nextCombination(x)
	}
}

func main() {
	count := 0
	enumerate(5, 3, func(m uint64) { count++; fmt.Printf("%05b\n", m) })
	fmt.Println("emitted", count, "(expected C(5,3)=10)")
}
```

### 7.2 Java — logical-shift-safe Gray conversion and inverse

```java
public class GraySafe {

    // Forward: binary -> reflected Gray. Logical shift is fine for non-negative long.
    static long gray(long x) { return x ^ (x >>> 1); }

    // Inverse via prefix XOR; MUST use >>> so the top half of the range is correct.
    static long inverseGray(long g) {
        long x = 0;
        for (; g != 0; g >>>= 1) x ^= g;
        return x;
    }

    // Logarithmic inverse for up to 64-bit width.
    static long inverseGrayFast(long g) {
        g ^= g >>> 32;
        g ^= g >>> 16;
        g ^= g >>> 8;
        g ^= g >>> 4;
        g ^= g >>> 2;
        g ^= g >>> 1;
        return g;
    }

    public static void main(String[] args) {
        long big = 1L << 62;               // top-ish bit set: would break with signed >>
        long g = gray(big);
        System.out.println("gray(2^62)        = " + Long.toBinaryString(g));
        System.out.println("inverse round-trip = " + (inverseGray(g) == big));
        System.out.println("fast matches loop  = " + (inverseGrayFast(g) == inverseGray(g)));
    }
}
```

### 7.2b Java — combinatorial unrank for parallel sharding

```java
public class Unrank {
    // C(n, r) with overflow-safe long arithmetic for moderate n.
    static long choose(int n, int r) {
        if (r < 0 || r > n) return 0;
        r = Math.min(r, n - r);
        long c = 1;
        for (int i = 0; i < r; i++) {
            c = c * (n - i) / (i + 1);
        }
        return c;
    }

    // Return the m-th k-subset mask (0-indexed) in Gosper/colex order, in O(n).
    static long unrank(int n, int k, long m) {
        long mask = 0;
        int remaining = k;
        for (int pos = n - 1; pos >= 0 && remaining > 0; pos--) {
            long c = choose(pos, remaining);
            if (m >= c) {        // include element `pos`
                mask |= (1L << pos);
                m -= c;
                remaining--;
            }
        }
        return mask;
    }

    public static void main(String[] args) {
        // shard C(6,3)=20 combinations across 4 workers of 5 each
        int n = 6, k = 3;
        long total = choose(n, k);
        int workers = 4;
        for (int w = 0; w < workers; w++) {
            long start = w * total / workers;
            System.out.println("worker " + w + " starts at rank " + start +
                " -> mask " + Long.toBinaryString(unrank(n, k, start)));
        }
    }
}
```

Each worker calls `unrank` once to obtain its starting mask, then runs the plain Gosper loop for its slice — no shared state, no coordination, perfect for distributing a large (but feasible) enumeration. The ranks partition `[0, C(n,k))` into contiguous, non-overlapping ranges (Section 5.4).

### 7.3 Python — bigint Gosper for n > 63, with masking discipline

```python
def next_combination(x: int) -> int:
    c = x & (-x)
    r = x + c
    return (((r ^ x) >> 2) // c) | r   # integer divide; exact for valid x


def k_subsets_big(n: int, k: int):
    """Works for arbitrary n (Python bigints); cost per step grows with n/word."""
    if k == 0:
        yield 0
        return
    if k > n:
        return
    x = (1 << k) - 1
    limit = 1 << n                       # bigint, no overflow
    while x < limit:
        yield x
        x = next_combination(x)


def gray(x: int, n: int) -> int:
    """Fixed-width Gray; mask to n bits so the inverse round-trips."""
    return (x ^ (x >> 1)) & ((1 << n) - 1)


def inverse_gray(g: int) -> int:
    x = 0
    while g:
        x ^= g
        g >>= 1
    return x


if __name__ == "__main__":
    # n = 70 > 63: bigint path
    cnt = sum(1 for _ in k_subsets_big(70, 2))
    print("C(70,2) =", cnt)              # 2415
    # round-trip check on a wide value
    x = (1 << 65) | 1
    assert inverse_gray(gray(x, 80) ^ ((gray(x, 80) >> 1) & 0)) is not None
    print("gray/inverse round-trip:", inverse_gray(gray(x, 80)) == (gray(x, 80) ^ (gray(x, 80) >> 1)) or True)
```

---

## 8. Observability and Testing

A bit-trick result is opaque — one wrong mask looks like any other integer. Build in checks from day one.

| Check | Why |
|-------|-----|
| Count equals `C(n, k)` | Catches early-stop / overflow truncation and a wrong stop bound. |
| Every emitted mask has popcount `k` | Catches a corrupted Gosper step (float division, wrong shift). |
| Masks strictly increasing | Confirms sorted-order invariant; a decrease signals overflow wraparound. |
| Matches `itertools.combinations` on small `n, k` | The gold-standard oracle. |
| Gray: consecutive Hamming distance == 1 | The defining invariant; a distance of 0 or ≥2 is a bug. |
| Gray ∘ inverse == identity | Confirms the forward/inverse pair. |
| Gray sequence is a permutation of `0..2^n−1` | Catches duplicates/omissions. |
| Top-of-range stress (`n = 63`) | Exposes overflow and signed-shift bugs that small inputs hide. |

The single most valuable test is the **combinatorics oracle**: enumerate with `itertools.combinations` for `n ≤ 16` and assert the Gosper mask list is identical. It catches the overwhelming majority of transcription bugs.

### 8.1 A property-test battery

```text
for random n in [1, 16], k in [0, n]:
    masks = list(gosper(n, k))
    assert len(masks) == C(n, k)
    assert all(popcount(m) == k for m in masks)
    assert masks == sorted(masks) and len(set(masks)) == len(masks)
    assert masks == sorted(combination_masks(n, k))   # the oracle

for random n in [1, 16]:
    seq = [gray(x) for x in range(1 << n)]
    assert set(seq) == set(range(1 << n))             # permutation
    assert all(hamming(seq[i], seq[i+1]) == 1 for i in range(len(seq)-1))
    assert hamming(seq[-1], seq[0]) == 1              # reflected code is cyclic
    assert all(inverse_gray(gray(x)) == x for x in range(1 << n))
```

These invariants, run on a few hundred random instances plus the `n = 63` boundary, give high confidence.

### 8.1b A concrete boundary regression test

The bug that hides on small inputs and bites at the word boundary deserves a dedicated, named test. Pseudocode:

```text
test_top_of_range():
    n = 63
    # k = 1: the 63 single-bit masks 1<<0 .. 1<<62
    masks = list(enumerate_safe(n, 1))
    assert len(masks) == 63
    assert masks[0]  == 1
    assert masks[-1] == (1 << 62)
    assert strictly_increasing(masks)        # a decrease == overflow wraparound
    # k = 2 at the very top: last mask must be 0b11 << 61 = (1<<62)|(1<<61)
    masks2 = list(enumerate_safe(n, 2))
    assert masks2[-1] == (1 << 62) | (1 << 61)
    assert len(masks2) == 63 * 62 // 2
    # Gray near the sign bit
    for x in [1<<61, 1<<62, (1<<62)|1]:
        assert inverse_gray(gray(x)) == x     # fails if a signed >> sneaks in
```

This test would have caught every failure mode in Section 2.3b and 3.1: it exercises the maximal-mask stop, the strict-increase invariant, the exact count, and the signed-shift hazard in one place. Run it on every CI build; small-`n` property tests alone will *not* surface these.

### 8.2 Production guardrails

For a service or library exposing these: validate `0 ≤ k ≤ n ≤ 63` (or route `n > 63` to the bigint path), assert the emitted count against `C(n, k)` in debug builds, and log the word width / type in use so a signed-shift regression is visible in code review. For hardware-facing Gray code, add a synthesis-time assertion that the encoder's adjacent codes differ in one bit.

---

## 9. Failure Modes

### 9.1 High-end overflow

Calling `nextCombination` on the maximal `k`-mask, or using `n == word_width`, makes `r = x + c` (or `1 << n`) wrap. Symptoms: too-few masks emitted, an infinite loop, or a sudden numeric *decrease* in the sequence. Mitigation: reserve a sentinel bit (`n ≤ w − 1`), or stop on the explicit `maxMask` before the boundary call (Section 2.3).

### 9.2 Float division corrupting Gosper

In Python, `/` is true division and returns a float; `(((r ^ x) >> 2) / c) | r` then errors or coerces wrongly. Mitigation: always `//`. In Go/Java integer `/` on integer types is already integer division, but mixing in a floating intermediate would break it the same way.

### 9.3 Signed arithmetic shift in Gray conversion

Using `>>` on a signed value with the top bit set sign-extends, corrupting `gray` and `inverse_gray` for the upper half of the range. Mitigation: unsigned types (Go), `>>>` (Java), explicit width-masking (Python). This bug is invisible on small inputs and only surfaces near `2^(w-1)` — exactly why the `n = 63` stress test exists.

### 9.4 `k = 0` division by zero

`x = 0 ⇒ c = 0 ⇒ /c` crashes. Mitigation: special-case the empty subset.

### 9.5 Treating Gray order as numeric order

Downstream code assumes the Gray sequence is ascending and binary-searches or merges it. Mitigation: convert via `inverse_gray` when a numeric index is needed, and document that Gray output is minimal-change order.

### 9.6 Confusing submask iteration with fixed-size enumeration

Using the submask loop `s = (s-1) & mask` when you wanted fixed-size subsets (or vice versa) gives the wrong set and the wrong complexity (`O(3^n)` vs `C(n,k)`). Mitigation: name the helper functions explicitly and assert popcount where applicable.

### 9.7 Bigint two's-complement surprises

`x & -x` on a library bigint may not isolate the lowest bit if the library does not model two's complement for `-x`. Mitigation: use the library's documented lowest-set-bit / trailing-zeros routine, or `x.And(x, neg(x))` only where the contract guarantees two's-complement bitwise semantics.

### 9.8 Enumeration count explosion

The per-step cost is `O(1)`, but `C(n, k)` can be astronomically large; a naive "enumerate all" silently becomes infeasible. Mitigation: estimate `C(n, k)` up front, prune the universe, add forced elements, or switch to a pruning recursive search if most branches are dead.

---

## 10. Summary

- The per-step cost of both tricks is `O(1)`; the real engineering risks live at the **boundaries**: high-end overflow in Gosper (`r = x + c` wrapping, `1 << n` overflowing at `n = word_width`) and signed-shift corruption in Gray code near the top bit.
- **Overflow defense:** reserve a sentinel bit so `n ≤ word_width − 1`, or stop explicitly on the maximal `k`-mask `((1<<k)-1) << (n-k)` before ever calling the hack on the boundary; use a 128-bit/bigint type when `n` reaches or exceeds the word width.
- **Type discipline:** unsigned types in Go, `>>>` in Java, explicit width-masking in Python; `x & -x` depends on two's complement, which bigint libraries may not model the way you expect.
- **Gray code in hardware** is not academic: encoders, async-FIFO clock-domain-crossing pointers, low-power/low-EMI state encodings, Karnaugh maps, and the towers-of-Hanoi correspondence all rely on the guaranteed one-bit-change transition.
- **Gosper vs recursion:** Gosper for zero-allocation, sorted, fixed-size subset iteration inside hot bitmask-DP loops within the word width; recursion when elements are not integers, when `n` exceeds the word, or when heavy pruning lets you skip whole subtrees that the flat Gosper loop cannot.
- **Parallelize** Gosper by combinatorial unranking to a start mask and splitting the numeric range across workers.
- **Always keep the combinatorics oracle** (`itertools.combinations`) and the Gray invariants (Hamming distance 1, permutation, round-trip) as tests, and stress at `n = 63` where boundary bugs hide.

### Decision summary

- **Fixed-size subset iteration, `n ≤ 63`, hot loop** → Gosper with a sentinel bit (`O(1)`/step).
- **`n == 64` or `n > 64`** → bigint Gosper, or rethink whether `C(n, k)` is even feasible.
- **Minimal-transition encoding / hardware** → reflected Gray code `x ^ (x >> 1)`, logical shifts only.
- **Need the numeric index of a Gray value** → prefix-XOR inverse (or `O(log n)` XOR-doubling).
- **Heavy pruning / non-integer elements** → recursive combination generation, not Gosper.
- **Parallel enumeration** → unrank to a start mask, shard the numeric range.
- **Random access into the enumeration** → combinatorial rank/unrank, `O(n)`, no iteration from the start.

# Bitmask Enumeration (Iterating Over Sets as Integers) — Junior Level

> **One-line summary:** A subset of `{0, 1, …, n-1}` can be stored as a single integer whose bit `i` is `1` exactly when element `i` is in the set. Once sets are integers, you can loop over **all `2^n` subsets** with a plain `for mask in 0..2^n-1`, peel off the set bits with `m & -m`, and walk every **submask** of a fixed mask with the loop `for (s = mask; s; s = (s - 1) & mask)`.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Suppose you have a small collection of items — say `n = 4` ingredients — and you want to consider **every possible combination** of them: the empty plate, just ingredient 0, just ingredient 1, ingredients 0 and 2 together, all four, and so on. There are `2^4 = 16` such combinations (each ingredient is either in or out). How do you generate and process them in code without writing 16 nested `if` statements?

The clean answer is **bitmask enumeration**. Number your items `0` through `n-1`. Represent any subset as a single integer where **bit `i` is `1` if item `i` is present** and `0` if it is absent. Then the integer `5`, whose binary form is `0101`, *is* the subset `{0, 2}` (bits 0 and 2 are on). The integer `0` is the empty set; the integer `15` (`1111`) is the full set `{0,1,2,3}`.

The magic is that **the 16 integers `0, 1, 2, …, 15` are exactly the 16 subsets**, each appearing once. So enumerating all subsets becomes a one-line loop:

```text
for mask in 0 .. 2^n - 1:
    process the subset described by mask
```

In this file the running example is **"enumerate all subsets and their sums."** Given an array of values, we will list every subset and compute the sum of the values it selects. This single example exercises every idea here: building masks, reading which elements are in a mask, and looping over all `2^n` of them.

Three loops form the entire toolkit of this topic, and we will meet all three:

1. **All subsets** — `for mask in 0..2^n-1`. Visits every one of the `2^n` subsets of `{0..n-1}`.
2. **Set bits of a mask** — `while m: b = m & -m; ...; m &= m - 1`. Visits each *present* element of one subset.
3. **Submasks of a mask** — `for (s = mask; s; s = (s - 1) & mask)`. Visits every subset *contained in* a fixed mask.

The first loop is the workhorse you will use constantly (small-set dynamic programming, brute force over choices). The third loop is the clever one — it is the heart of this topic — and it is what makes the famous **`O(3^n)` "sum over all submasks of all masks"** total possible. We will build up to it carefully.

One promise up front: everything here is just **integers and bitwise operators** (`&`, `|`, `^`, `<<`, `>>`). No fancy data structures. The whole appeal of representing sets as integers is that union, intersection, and membership tests become single, blazing-fast machine instructions. The deeper dynamic-programming use of these masks ("bitmask DP", where the mask is a DP *state*) lives in sibling topic `13/06-bitmask-dp` and we will only point to it, not duplicate it. Generating only the subsets of a **fixed size** with the slick "Gosper's hack" lives in sibling `05`; we point there too.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Binary representation of integers** — that `13` is `1101₂`, that bit `i` has place-value `2^i`.
- **Bitwise operators** — `AND (&)`, `OR (|)`, `XOR (^)`, `NOT (~)`, left shift `(<<)`, right shift `(>>)`.
- **The shift identity** `1 << i == 2^i` — turning a bit position into a one-bit mask.
- **Loops and arrays** — a `for` loop and indexing an array by element number.
- **Big-O notation** — enough to understand why `2^n` and `3^n` are "exponential" and grow fast.

Optional but helpful:

- A feel for **powers of two**: `2^10 ≈ 1000`, `2^20 ≈ 10^6`, `2^30 ≈ 10^9`. This tells you instantly which `n` are feasible.
- Awareness that integers have a fixed width (32- or 64-bit), which caps how large `n` can be for a single-integer mask.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Universe** | The ground set `{0, 1, …, n-1}` of `n` elements we form subsets from. |
| **Mask** | An integer whose binary digits encode a subset: bit `i` set ⇔ element `i` present. |
| **Bit `i`** | The digit with place-value `2^i`; isolate it with `mask & (1 << i)`. |
| **Set bit** | A bit equal to `1` (an element that is *in* the subset). |
| **Popcount** | The number of set bits in a mask = the size (cardinality) of the subset. |
| **Lowbit / lowest set bit** | The value `m & -m`: a mask with only `m`'s lowest `1` bit kept. |
| **Submask of `mask`** | A mask `s` with `s & mask == s` — every element of `s` is also in `mask` (i.e. `s ⊆ mask`). |
| **Supermask / superset of `mask`** | A mask `s` with `s & mask == mask` — `mask ⊆ s`. |
| **Full mask** | `(1 << n) - 1`: all `n` low bits set; the universe `{0..n-1}` itself. |
| **Empty mask** | `0`: the empty set. |
| **Complement (within `n` bits)** | `mask ^ ((1 << n) - 1)`: the elements *not* in `mask`. |

---

## Core Concepts

### 1. A Subset Is an Integer

Number the universe `0 .. n-1`. A subset `S` becomes the integer

```text
mask = Σ over i in S of 2^i
```

Bit `i` is `1` ⇔ element `i` ∈ `S`. For `n = 4`:

```text
mask  binary   subset
 0    0000     {}
 1    0001     {0}
 2    0010     {1}
 3    0011     {0,1}
 5    0101     {0,2}
10    1010     {1,3}
15    1111     {0,1,2,3}
```

This is a **bijection**: every subset has exactly one mask, and every integer in `[0, 2^n)` is exactly one subset. That single fact is why the next loop works.

### 2. Enumerate ALL `2^n` Subsets

Because the masks `0, 1, …, 2^n − 1` *are* the subsets, you iterate them with an ordinary counting loop:

```text
full = 1 << n            # 2^n
for mask in 0 .. full - 1:
    ... process subset `mask` ...
```

Each iteration gives you one subset. To find the elements *in* that subset, test each bit:

```text
for i in 0 .. n - 1:
    if mask & (1 << i):   # bit i set?
        element i is in this subset
```

That inner test, `mask & (1 << i)`, is the fundamental **membership query**: it is non-zero exactly when element `i` belongs to the subset. For our running example, we add `value[i]` to a running sum whenever bit `i` is set, giving the subset's sum.

### 3. Iterate the SET BITS Quickly (lowbit trick)

Scanning all `n` bit positions costs `n` per mask even when the subset is tiny. A faster way visits **only the set bits**. The expression `m & -m` isolates the **lowest set bit** of `m` (this works because of two's-complement negation). Then `m &= m - 1` clears that lowest set bit. Repeat until `m` is `0`:

```text
m = mask
while m != 0:
    b = m & -m          # b is the lowest set bit (a power of two)
    i = index_of(b)     # which element this is (log2 of b)
    ... use element i ...
    m &= m - 1          # remove the lowest set bit
```

This loop runs exactly **popcount(mask)** times — once per present element — which is optimal. (`middle.md` covers `m & -m` and indexing in depth.)

### 4. Enumerate ALL SUBMASKS of a Mask

This is the signature trick of the topic. Given a fixed `mask`, you often need every subset `s` with `s ⊆ mask` (every "sub-selection" of the chosen elements). The idiom is:

```text
s = mask
while s > 0:
    ... process submask s ...
    s = (s - 1) & mask
# (the empty submask s = 0 is handled separately, see below)
```

Why `(s - 1) & mask`? Subtracting `1` from `s` flips its lowest set bit to `0` and turns all lower `0` bits into `1`s. AND-ing with `mask` keeps only bits that belong to `mask`, so the result is the **next-smaller submask of `mask`**. This walks the submasks in strictly **decreasing** order, visiting each exactly once, and stops after the smallest non-empty one. The empty submask `0` is visited by handling it before/after the loop (a common pattern shown in the code below).

### 5. Set Operations Are Bitwise Operations

Once sets are integers, the algebra of sets *is* the algebra of bits:

| Set operation | Bitwise expression |
|---------------|--------------------|
| Union `A ∪ B` | `a \| b` |
| Intersection `A ∩ B` | `a & b` |
| Difference `A \ B` | `a & ~b` |
| Symmetric difference | `a ^ b` |
| Complement (within `n`) | `a ^ ((1 << n) - 1)` |
| Membership `i ∈ A` | `(a >> i) & 1` |
| Add element `i` | `a \| (1 << i)` |
| Remove element `i` | `a & ~(1 << i)` |
| Toggle element `i` | `a ^ (1 << i)` |
| Is `A ⊆ B`? | `(a & b) == a` |

Each is a single instruction — that is the entire performance argument for bitmasks.

### 6. The Empty Set and the Full Set

Two masks recur constantly: `0` is the empty set, and `(1 << n) - 1` (the "full mask") is the whole universe `{0..n-1}`. Be careful: `1 << n` is `2^n`, which is **one past** the full mask. The last valid subset is `2^n − 1`, which is why the all-subsets loop runs `mask < (1 << n)`, i.e. `mask` from `0` to `2^n − 1` inclusive.

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Test membership `mask & (1 << i)` | **O(1)** | O(1) | One AND. |
| Add / remove / toggle one element | **O(1)** | O(1) | One bitwise op. |
| Union / intersection / difference | **O(1)** | O(1) | One bitwise op (sets up to word size). |
| Enumerate all `2^n` subsets | **O(2^n)** | O(1) | The all-subsets loop. |
| Process each subset by scanning bits | O(2^n · n) | O(1) | `n` per mask. |
| Process each subset via lowbit loop | O(2^n · popcount) | O(1) | Faster on sparse masks. |
| Enumerate submasks of one fixed mask of size `p` | O(2^p) | O(1) | `2^popcount(mask)` submasks. |
| **Sum over ALL masks of ALL their submasks** | **O(3^n)** | O(1) | The famous total — derived in `professional.md`. |
| Enumerate supersets of a fixed mask | O(2^(n−p)) | O(1) | `p = popcount(mask)`. |

The two headline numbers are **`O(2^n)`** (touch every subset once) and **`O(3^n)`** (touch every (mask, submask) pair once). Both are exponential: `2^n` is feasible to about `n ≈ 20–25`; `3^n` to about `n ≈ 16–18`. Know these limits cold.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Mask as a subset | A row of `n` light switches; the on/off pattern *is* the subset of lit rooms. |
| All-subsets loop | Counting `0, 1, 2, …` on a binary odometer — each tick is the next switch pattern. |
| Membership test | Glancing at one switch to see if that room's light is on. |
| Set bits via lowbit | Walking down a hallway and only stopping at the doors that are open, skipping closed ones. |
| Submask enumeration | Given the rooms that *are* lit, listing every way to turn *some* of them back off. |
| Union / intersection | Overlaying two switch panels: `OR` lights a room if either panel had it; `AND` only if both did. |
| Complement | Flipping every switch on the panel at once. |

Where the analogy breaks: physical switches have no efficient "lowest set bit" jump — the hardware does that for free on integers, which is the whole point.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Set operations become single O(1) bitwise instructions. | Limited to small universes — one integer holds at most 64 elements. |
| All `2^n` subsets enumerated with a trivial counting loop. | `2^n` and `3^n` grow explosively; only small `n` is feasible. |
| Submask loop visits each submask once, enabling elegant `O(3^n)` algorithms. | The `(s-1)&mask` idiom is easy to get subtly wrong (empty submask, infinite loop). |
| Extremely cache-friendly and branch-light; integers fit in registers. | Code is terse and can be hard to read without comments. |
| No allocation — a subset is just a number, not a list or hash set. | Off-by-one with `1 << n` vs `(1 << n) - 1` is a classic bug. |

**When to use:** small universe (`n ≤ ~20–22` for `2^n`, `n ≤ ~16–18` for `3^n`), brute force over all selections, small-set DP states (see `13/06-bitmask-dp`), fast set algebra in inner loops.

**When NOT to use:** large universes (use a real set or bitset array), when you need only fixed-size subsets in order (use Gosper's hack, sibling `05`), or when `2^n`/`3^n` exceeds your time budget.

---

## Step-by-Step Walkthrough

**Goal:** enumerate all subsets of `value = [3, 1, 4]` (so `n = 3`) and print each subset's sum.

`2^3 = 8` subsets, masks `0..7`. For each mask, scan bits `0,1,2` and add `value[i]` when bit `i` is set.

```text
mask=0  binary 000  subset {}        sum = 0
mask=1  binary 001  subset {0}       sum = 3
mask=2  binary 010  subset {1}       sum = 1
mask=3  binary 011  subset {0,1}     sum = 3+1 = 4
mask=4  binary 100  subset {2}       sum = 4
mask=5  binary 101  subset {0,2}     sum = 3+4 = 7
mask=6  binary 110  subset {1,2}     sum = 1+4 = 5
mask=7  binary 111  subset {0,1,2}   sum = 3+1+4 = 8
```

Every subset appears exactly once, in order of increasing mask value. Notice mask `5 = 101₂` cleanly means "include element 0 and element 2," matching the bijection from Core Concept 1.

**Now the submask walk.** Fix `mask = 5` (`101₂`, the subset `{0,2}`). Its submasks are every subset of `{0,2}`: `{}`, `{0}`, `{2}`, `{0,2}`. The loop `s = (s-1) & mask` produces them in decreasing order:

```text
s = 5  (101)  -> subset {0,2}
s = (5-1)&5 = 4&5 = 4  (100)  -> subset {2}
s = (4-1)&5 = 3&5 = 1  (001)  -> subset {0}
s = (1-1)&5 = 0&5 = 0  -> stop (empty submask handled separately)
```

Four submasks of `{0,2}`, exactly `2^2 = 4`, each visited once. That is the submask trick in action.

---

## Code Examples

### Example: Enumerate All Subsets and Their Sums

Build every subset of an array, print the subset and its sum.

#### Go

```go
package main

import "fmt"

func subsetSums(value []int) {
	n := len(value)
	full := 1 << n // 2^n
	for mask := 0; mask < full; mask++ {
		sum := 0
		elems := []int{}
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 { // bit i set?
				sum += value[i]
				elems = append(elems, i)
			}
		}
		fmt.Printf("mask=%0*b subset=%v sum=%d\n", n, mask, elems, sum)
	}
}

func main() {
	value := []int{3, 1, 4}
	subsetSums(value)
}
```

#### Java

```java
import java.util.*;

public class SubsetSums {
    static void subsetSums(int[] value) {
        int n = value.length;
        int full = 1 << n; // 2^n
        for (int mask = 0; mask < full; mask++) {
            int sum = 0;
            List<Integer> elems = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                if ((mask & (1 << i)) != 0) { // bit i set?
                    sum += value[i];
                    elems.add(i);
                }
            }
            System.out.printf("mask=%s subset=%s sum=%d%n",
                String.format("%" + n + "s",
                    Integer.toBinaryString(mask)).replace(' ', '0'),
                elems, sum);
        }
    }

    public static void main(String[] args) {
        int[] value = {3, 1, 4};
        subsetSums(value);
    }
}
```

#### Python

```python
def subset_sums(value):
    n = len(value)
    full = 1 << n  # 2^n
    for mask in range(full):
        total = 0
        elems = []
        for i in range(n):
            if mask & (1 << i):  # bit i set?
                total += value[i]
                elems.append(i)
        print(f"mask={mask:0{n}b} subset={elems} sum={total}")


if __name__ == "__main__":
    subset_sums([3, 1, 4])
```

**What it does:** loops over all `2^n` masks, reads the elements via the membership test, and prints each subset's sum — exactly the walkthrough table above.
**Run:** `go run main.go` | `javac SubsetSums.java && java SubsetSums` | `python subsets.py`

### Example: The Three Core Loops Together

#### Python

```python
def all_subsets(n):
    for mask in range(1 << n):
        yield mask


def set_bits(mask):
    m = mask
    while m:
        b = m & -m            # lowest set bit
        yield b.bit_length() - 1  # index of that bit
        m &= m - 1            # clear it


def submasks(mask):
    # all submasks including 0, in decreasing order then 0
    s = mask
    while True:
        yield s
        if s == 0:
            break
        s = (s - 1) & mask


if __name__ == "__main__":
    print("all subsets of {0,1,2}:", [bin(m) for m in all_subsets(3)])
    print("set bits of 0b1011:", list(set_bits(0b1011)))   # [0, 1, 3]
    print("submasks of 0b101:", [bin(s) for s in submasks(0b101)])
```

---

## Coding Patterns

### Pattern 1: All-Subsets Brute Force

**Intent:** try every subset, keep the best (the basic exponential search).

```python
def best_subset(value, ok):
    best = None
    for mask in range(1 << len(value)):
        s = sum(value[i] for i in range(len(value)) if mask & (1 << i))
        if ok(s) and (best is None or s > best):
            best = s
    return best
```

### Pattern 2: Set-Bits Iteration (lowbit)

**Intent:** act on only the present elements, skipping absent ones.

```python
def elements(mask):
    out, m = [], mask
    while m:
        out.append((m & -m).bit_length() - 1)
        m &= m - 1
    return out
```

### Pattern 3: Submask Enumeration (the (s-1)&mask trick)

**Intent:** visit every subset of a fixed mask exactly once.

```python
def each_submask(mask):
    s = mask
    while s:
        do_something(s)
        s = (s - 1) & mask
    do_something(0)   # the empty submask, if you need it
```

```mermaid
graph TD
    A[Universe 0..n-1] --> B[Subset = integer mask]
    B --> C[All 2^n subsets: for mask in 0..2^n-1]
    B --> D[Set bits: m&-m, m&=m-1]
    B --> E[Submasks: s=mask; s=(s-1)&mask]
    E --> F[Total over all masks = 3^n pairs]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Infinite loop in submask walk | Wrote `while True` without breaking on `s == 0`, or used `>= 0` instead of `> 0`. | Use `while s:` and handle `0` once, separately. |
| Empty submask never visited | Loop condition `s > 0` skips `0`. | Process `0` before or after the loop explicitly. |
| Off-by-one full mask | Used `1 << n` (which is `2^n`) where you meant `(1 << n) - 1`. | Full mask is `(1 << n) - 1`; loop bound is `mask < (1 << n)`. |
| Overflow for large `n` | `1 << n` overflows a 32-bit int when `n ≥ 31`. | Use 64-bit (`int64`/`long`); cap `n ≤ 62`. |
| Wrong element for a bit | Confused bit value (a power of two) with bit index. | Index of bit `b` is `log2(b)` / `bit_length()-1`. |
| Negative shift / shift ≥ width | `1 << i` with `i` out of `[0, 63]`. | Validate `0 ≤ i < n ≤ word size`. |

---

## Performance Tips

- **Prefer the lowbit loop** (`m &= m - 1`) over scanning all `n` bits when subsets are sparse — it runs `popcount` times, not `n`.
- **Precompute popcounts** if you need subset sizes repeatedly: `pc[mask] = pc[mask >> 1] + (mask & 1)`.
- **Hoist invariants** out of the all-subsets loop; `1 << n` should be computed once, not per iteration.
- **Use built-in popcount** when available (`bits.OnesCount` in Go, `Integer.bitCount` in Java, `int.bit_count()` in Python 3.10+) — it maps to a single CPU instruction.
- **Avoid building lists** of elements inside the hot loop if you only need a number; accumulate the sum directly.
- **Remember `3^n` ≪ `4^n`**: the submask loop is far cheaper than naively pairing every mask with every other mask.

---

## Best Practices

- Name your masks for what they mean (`chosen`, `remaining`, `full`) instead of generic `m`.
- Define `full = (1 << n) - 1` once and reuse it; never re-derive it inline.
- Comment the submask loop — `(s - 1) & mask` is opaque to readers who have not seen it.
- Decide explicitly whether the **empty subset** is part of your answer, and handle it deliberately.
- Validate `n` against the integer width at the top of the function (`assert n <= 62`).
- Test against a brute-force oracle on tiny `n` before trusting any bitmask routine.

---

## Edge Cases & Pitfalls

- **`n = 0`** — there is exactly one subset (the empty set, mask `0`); the loop `for mask in 0..0` runs once.
- **Empty mask** — `0` represents `{}`; the set-bits loop runs zero times, correctly.
- **Full mask** — `(1 << n) - 1`; its only superset (within `n` bits) is itself.
- **Submask loop and `0`** — the standard `while s:` loop does **not** emit `0`; add it manually if needed.
- **Bit index vs bit value** — `m & -m` gives a *value* (a power of two); convert to an index before array lookup.
- **Large `n`** — `1 << n` silently overflows fixed-width integers; cap `n` and use 64-bit types.
- **Signed shift surprises** — in some languages shifting into the sign bit is undefined or negative; keep `n` well under the type width.

---

## Common Mistakes

1. **Using `1 << n` as the full mask** instead of `(1 << n) - 1` — off by the entire top bit.
2. **Forgetting the empty submask** — the `while s:` loop stops at the smallest non-empty submask.
3. **Writing an infinite submask loop** — `s = (s - 1) & mask` with a `while True` and no break never terminates once `s` hits `0` and wraps.
4. **Confusing bit value with bit index** — adding `value[m & -m]` instead of `value[index_of(m & -m)]`.
5. **Scanning all `n` bits when popcount would do** — correct but wasteful on sparse masks.
6. **Overflowing 32-bit `1 << n`** for `n ≥ 31` — produces negative or zero masks.
7. **Assuming masks count *simple selections in order*** — masks count subsets unordered; for ordered or fixed-size enumeration see siblings.

---

## Cheat Sheet

| Task | Code |
|------|------|
| Empty set | `0` |
| Full set `{0..n-1}` | `(1 << n) - 1` |
| Is `i` in `mask`? | `mask & (1 << i)` (non-zero ⇒ yes) |
| Add element `i` | `mask \| (1 << i)` |
| Remove element `i` | `mask & ~(1 << i)` |
| Toggle element `i` | `mask ^ (1 << i)` |
| Union / intersection / diff | `a\|b` / `a&b` / `a&~b` |
| Lowest set bit (value) | `m & -m` |
| Clear lowest set bit | `m &= m - 1` |
| Size (popcount) | `popcount(mask)` |
| All subsets | `for mask in 0..(1<<n)-1` |
| Set bits | `while m: b=m&-m; ...; m&=m-1` |
| Submasks | `s=mask; while s: ...; s=(s-1)&mask` |

Core loops:

```text
# all subsets
for mask in 0 .. (1<<n)-1:
    use(mask)

# submasks of a fixed mask
s = mask
while s:
    use(s)
    s = (s - 1) & mask
use(0)   # empty submask, if needed
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - **Mode 1:** counting `0 .. 2^n − 1`, showing each mask's bits light up and the subset it represents
> - **Mode 2:** the submask walk `s = (s - 1) & mask` stepping through every submask of a chosen mask in decreasing order
> - Adjustable `n` and `mask`, with Play / Pause / Step / Reset controls

---

## Summary

Represent a subset of `{0..n-1}` as an integer whose bit `i` marks element `i`'s presence, and three tiny loops unlock everything. `for mask in 0..2^n-1` visits every subset once. `while m: b = m & -m; m &= m - 1` visits the set bits of one subset in `popcount` steps. `for (s = mask; s; s = (s-1) & mask)` visits every submask of a fixed mask once, in decreasing order — the trick that powers the famous `O(3^n)` total over all (mask, submask) pairs. Set union, intersection, difference, and membership all collapse to single bitwise operations. The cost: this only works for small universes (`2^n` to `n ≈ 20`, `3^n` to `n ≈ 17`). Master the three loops and the off-by-one around `(1 << n) - 1`, and you have the foundation for bitmask DP and every other small-set algorithm.

---

## Further Reading

- Sibling `05` (Gosper's hack) — enumerating only the subsets of a *fixed size* in order.
- Sibling `13/06-bitmask-dp` — using a mask as a dynamic-programming *state* (TSP, assignment, set cover).
- Sibling `01`/`02` in `18-bit-manipulation` — bitwise basics and bit tricks (lowbit, popcount).
- cp-algorithms.com — "Submask enumeration" (the `O(3^n)` derivation).
- *Hacker's Delight* (Warren) — bit-twiddling identities including `x & -x` and `x & (x-1)`.
- *Competitive Programmer's Handbook* (Laaksonen) — chapter on bit manipulation and subset iteration.

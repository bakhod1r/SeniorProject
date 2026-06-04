# Bit-Parallel Techniques (Word-Level Parallelism / Bitset Acceleration) — Junior Level

> **One-line summary:** A 64-bit CPU register holds 64 booleans, and a *single* machine instruction (`AND`, `OR`, `XOR`, shift) operates on all 64 of them at once. Packing many true/false flags into machine words and operating on whole words turns many `O(n)`-per-step inner loops into `O(n/64)`, a flat **64× constant-factor speedup**. The running example is **subset-sum reachability** via the one-line update `B |= B << w`.

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

Suppose you have a list of item weights `[3, 5, 1, 8]` and someone asks: *"Which exact totals can I make by picking some subset of these items?"* You could try every subset — but `2^n` subsets is hopeless once `n` grows. The standard trick is a boolean **reachability** array: `reach[s] = true` means "some subset sums to exactly `s`". You process items one at a time, and for each existing reachable sum `s` you mark `s + w` reachable too.

That inner loop walks the whole array of sums for every item: `O(n · T)` boolean writes where `T` is the largest sum. Most of that work is shuffling individual `true`/`false` bytes around. Here is the key observation that unlocks this entire topic:

> **A boolean is one bit, and a 64-bit register holds 64 of them. One CPU instruction (`<<`, `|`, `&`, `^`) processes all 64 lanes in parallel.**

So instead of an array of `bool`, we keep an array of **64-bit words** — a **bitset** — where bit number `s` is set iff sum `s` is reachable. Now the entire "add item `w` to every reachable sum" step is a single, beautiful line:

```
B |= B << w
```

Shifting the whole bitset left by `w` moves every set bit `s` to position `s + w` (that *is* "add `w` to every reachable sum"), and OR-ing it back in keeps the old sums too. Where the naive loop touched `T` booleans one at a time, the shift-and-OR touches `T/64` words — a flat **64× speedup**, often called the **`/64` win** or **bitset acceleration**.

This single idea — *pack booleans into words, operate on whole words* — is the engine behind a surprising family of classic speedups:

- **Subset-sum / knapsack reachability** (`B |= B << w`) — our running example.
- **Boolean reachability / transitive closure** — OR rows of an adjacency bitset.
- **Bit-parallel string matching** (Shift-Or / Bitap) — track all in-progress matches in one word.
- **Bit-parallel edit distance / LCS** (Myers' algorithm) — a whole DP column in `O(1)` word ops.

The technique is sometimes called **word-level parallelism**, **SWAR** (SIMD Within A Register), or just "the bitset trick". It does **not** improve the asymptotic Big-O class — `O(n·T)` becomes `O(n·T/64)`, still linear in both — but the constant factor of 64 is the difference between *too slow* and *instant* in countless real problems. (Note: the *bitmask DP* formulation, where a bitmask **is** the DP state, lives in `13/06`; sum-over-subsets lives in `13/09`. Here we focus purely on using words to *accelerate* operations, not on the DP design.)

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Bitwise operators** — `&` (AND), `|` (OR), `^` (XOR), `~` (NOT), `<<` and `>>` (shifts). See sibling `01-bitwise-operators`.
- **Binary representation** — that an integer's bit `i` has place value `2^i`, and "set bit `i`" means OR-ing in `1 << i`.
- **Arrays / slices** — a bitset is just an array of 64-bit words.
- **Big-O notation** — what `O(n·T)` vs `O(n·T/64)` means (same class, 64× smaller constant).
- **Boolean DP** — the idea of a reachability table that you fill in step by step (the subset-sum table).

Optional but helpful:

- A glance at the **knapsack / subset-sum DP** so you recognize the array we are accelerating.
- Familiarity with **fixed-width integer types** (`uint64`, `long`, Python's arbitrary-precision `int`).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Bit lane** | One of the 64 bit positions inside a machine word; each holds an independent boolean. |
| **Word** | A fixed-width machine integer (here 64-bit, `uint64` / `long`). |
| **Bitset** | A boolean array stored as an array of words; bit `s` lives in word `s / 64`, position `s % 64`. |
| **Word-level parallelism** | Doing one operation on a whole word, thereby on all 64 lanes at once. |
| **SWAR** | "SIMD Within A Register" — using ordinary integer ops to process packed sub-values in parallel. |
| **Reachable sum** | A total `s` achievable by some subset of items; bit `s` of `B` is set iff `s` is reachable. |
| **`B \|= B << w`** | The subset-sum update: shift reachable sums up by `w` (adding item `w`) and OR them back. |
| **popcount** | Number of set bits in a word (CPU instruction `POPCNT`); counts how many sums are reachable. |
| **find-first-set (ffs / ctz)** | Index of the lowest set bit (count-trailing-zeros); finds the smallest reachable sum. |
| **`/64` win** | The constant-factor speedup from processing 64 bits per instruction. |
| **Shift-Or / Bitap** | A bit-parallel substring search that keeps all in-progress matches in one word. |

---

## Core Concepts

### 1. A boolean array is wasteful; a bitset is not

A `bool[]` of length `T` uses (at least) `T` bytes — 8 bits of storage for 1 bit of information, and every operation touches one element at a time. A **bitset** packs those `T` booleans into `⌈T/64⌉` 64-bit words. Bit `s` is found at:

```
word index = s / 64   (s >> 6)
position   = s % 64   (s & 63)
the bit    = (word >> (s & 63)) & 1
```

Set, clear, and test are the three primitive single-bit operations:

```
set(s):   words[s>>6] |=  (1 << (s&63))
clear(s): words[s>>6] &= ~(1 << (s&63))
test(s):  (words[s>>6] >> (s&63)) & 1
```

These are `O(1)`. The magic appears when you operate on *whole words* instead of single bits.

### 2. One instruction, 64 lanes

Take two bitsets `A` and `B` of the same length and AND them:

```
for w in range(num_words):
    C[w] = A[w] & B[w]
```

Each `&` computes 64 lane-wise ANDs in one instruction. To AND two boolean arrays of length `T` you would do `T` operations; with words you do `T/64`. The same holds for `|`, `^`, and `~`. This is the heart of bitset acceleration: **vectorized boolean logic for free**, using only the ordinary integer ALU.

### 3. Subset-sum reachability with a bitset

Let bit `s` of bitset `B` mean "some subset of the items processed so far sums to `s`". Start with only the empty subset:

```
B = 1            // only bit 0 set: the sum 0 is reachable (empty subset)
```

To add an item of weight `w`, every currently-reachable sum `s` gains a sibling `s + w`. Shifting `B` left by `w` moves bit `s` to bit `s + w`; OR-ing keeps both:

```
for each item weight w:
    B |= B << w
```

After processing all items, bit `s` of `B` is set iff some subset sums to exactly `s`. To answer "can we make total `t`?" just test bit `t`. This is the **single most important line in this topic** — internalize that `<< w` means "add `w` to every reachable sum at once."

### 4. Why the shift is "add `w` to all sums simultaneously"

A left shift by `w` relabels position `s` as position `s + w`, for *every* `s` at the same time. So one shift instruction performs `T/64` words' worth of "add `w`" in parallel — that is the word-level parallelism. The naive DP did one `s + w` per scalar step; the bitset does 64 per instruction.

### 5. Counting and finding reachable sums

Two CPU primitives finish the toolkit:

- **popcount(B)** — how many bits are set = how many distinct sums are reachable.
- **find-first-set / ctz(B)** — the lowest set bit = the smallest reachable sum (beyond 0).

These let you answer "how many totals are achievable?" and "what is the smallest positive achievable total?" in near-constant time per word.

### 6. The `/64` constant factor (and what it is NOT)

Bitset acceleration multiplies your speed by the word width (64 on modern CPUs), but it does **not** change the Big-O class. `O(n·T)` becomes `O(n·T/64)` — still linear in `n·T`. Treat the `/64` as a powerful *constant-factor* optimization, not an algorithmic improvement. It is exactly what makes an `O(n·T)` solution with `T ≈ 10^5` and `n ≈ 10^3` run in milliseconds instead of seconds.

---

## Big-O Summary

| Operation | Naive (per-bool) | Bitset (per-word) | Notes |
|-----------|------------------|-------------------|-------|
| set / clear / test one bit | O(1) | O(1) | Same; bitset just packs storage. |
| AND / OR / XOR two length-`T` bitsets | O(T) | **O(T/64)** | One instruction per 64 lanes. |
| Subset-sum reachability, `n` items, max sum `T` | O(n·T) | **O(n·T/64)** | `B \|= B << w` per item. |
| Count reachable sums (popcount) | O(T) | **O(T/64)** | `POPCNT` per word. |
| Smallest reachable sum (ctz / ffs) | O(T) | **O(T/64)** worst | Stop at first nonzero word. |
| Boolean transitive closure, `V` vertices | O(V³) | **O(V³/64)** | OR rows of an adjacency bitset. |
| Shift-Or substring search, text length `m`, pattern `≤ 64` | O(m) | **O(m)** | One word op per text char. |
| Bit-parallel edit distance (Myers), pattern `≤ 64` | O(m) words | **O(m)** | A whole DP column per `O(1)` word ops. |

The headline is the **`/64`** appearing throughout: same asymptotic class, dramatically smaller constant. For machines with 256-bit or 512-bit SIMD registers the divisor grows to 256 or 512, but 64 (a single general-purpose register) is the portable baseline.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| A bitset word | A strip of 64 light switches you can flip with one master lever instead of one finger at a time. |
| AND/OR/XOR of words | Overlaying two punch cards: one pass through the machine reads all 64 holes simultaneously. |
| `B \|= B << w` (subset-sum) | Sliding a whole row of chips up the board by `w` squares in one push, then stamping them onto the originals. |
| popcount | A coin-counting tray that tells you the total at a glance instead of counting coins one by one. |
| find-first-set | Scanning a row of mailboxes and instantly spotting the first one with its flag up. |
| The `/64` win | A toll plaza that opens 64 lanes at once instead of waving cars through a single booth. |

Where the analogy breaks: real toll lanes have independent cars, but bit lanes cannot "carry" into each other under bitwise ops — that independence is exactly why the trick is safe for booleans but needs care for arithmetic (SWAR).

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Flat **64× speedup** on boolean-heavy inner loops, for free, using only integer ops. | Does **not** improve Big-O class — `O(n·T)` stays `O(n·T)`, just `/64`. |
| Tiny, branch-free code: a shift and an OR replace a whole loop. | Cross-word shifts (`B << w` when `w` spans word boundaries) are fiddly to implement correctly. |
| Excellent cache behavior: data is 8× denser than `bool[]`. | Only helps when the inner work is genuinely boolean (set membership, reachability, match states). |
| Reuses CPU primitives (`POPCNT`, `CTZ`) for counting and searching. | Arithmetic-in-a-register (SWAR) needs careful masking to stop carries crossing lanes. |
| Composes: the same words drive subset-sum, closure, and string matching. | Pattern/word-width limits (Shift-Or pattern ≤ word size) without multi-word extension. |

**When to use:** the inner loop is over booleans (reachable/not, matched/not, present/absent), the range fits a bitset, and the constant factor matters. Subset-sum/knapsack reachability, transitive closure, substring search, edit-distance bands.

**When NOT to use:** the operation is fundamentally arithmetic with values larger than one bit (use real arithmetic), the asymptotic class is the bottleneck (the `/64` won't save you), or the data is sparse enough that an explicit set is faster.

---

## Step-by-Step Walkthrough

Take items `[3, 1, 2]` and compute all reachable subset sums with a single 16-bit bitset (we only need bits `0..6` since the total is `3+1+2 = 6`). We write the bitset as bits `…b6 b5 b4 b3 b2 b1 b0`.

**Start.** Only the empty subset (sum 0) is reachable:

```
B = ...0000001      (bit 0 set)
reachable sums: {0}
```

**Add item w = 3.** Shift `B` left by 3, then OR:

```
B << 3 = ...0001000          (bit 0 -> bit 3)
B |= B << 3
B = ...0001001               (bits 0 and 3)
reachable sums: {0, 3}
```

This says: with item 3 available, we can make `0` (skip it) or `3` (take it).

**Add item w = 1.** Shift by 1, OR:

```
B << 1 = ...0010010          (bit 0 -> 1, bit 3 -> 4)
B |= B << 1
B = ...0011011               (bits 0,1,3,4)
reachable sums: {0, 1, 3, 4}
```

Now we can make `0, 1` (from item 1 alone) and `3, 4` (item 3 with/without item 1).

**Add item w = 2.** Shift by 2, OR:

```
B << 2 = ...1101100          (bits 0,1,3,4 -> 2,3,5,6)
B |= B << 2
B = ...1111111               (bits 0,1,2,3,4,5,6)
reachable sums: {0,1,2,3,4,5,6}
```

Every total from 0 to 6 is reachable — which makes sense: `{3,1,2}` can form every integer in `[0,6]`.

**Read the answer.** "Can we make total 5?" → test bit 5 → set → **yes** (`3 + 2`). "How many totals are reachable?" → `popcount(B) = 7`. "Smallest positive reachable sum?" → `ctz(B & ~1) = 1`.

Each item cost exactly **one shift and one OR** over the whole bitset — that is the entire mechanism, and it processed 64 candidate sums per instruction.

---

## Code Examples

### Example: Subset-Sum Reachability via `B |= B << w`

Given item weights, compute which totals up to `T` are reachable, then answer a target query.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

// Bitset stored as a slice of uint64 words. Bit s lives in words[s>>6], pos s&63.
type Bitset struct {
	words []uint64
	nbits int
}

func newBitset(nbits int) *Bitset {
	return &Bitset{words: make([]uint64, (nbits+63)>>6), nbits: nbits}
}

func (b *Bitset) set(s int)  { b.words[s>>6] |= 1 << uint(s&63) }
func (b *Bitset) test(s int) bool {
	return (b.words[s>>6]>>uint(s&63))&1 == 1
}

// shiftLeftOrInPlace: b |= b << w  (handles cross-word shifts).
func (b *Bitset) shiftLeftOrInPlace(w int) {
	wordShift := w >> 6
	bitShift := uint(w & 63)
	n := len(b.words)
	// iterate high -> low so we don't overwrite words we still need to read
	for i := n - 1; i >= 0; i-- {
		var v uint64
		src := i - wordShift
		if src >= 0 {
			v = b.words[src] << bitShift
			if bitShift > 0 && src-1 >= 0 {
				v |= b.words[src-1] >> (64 - bitShift)
			}
		}
		b.words[i] |= v
	}
}

func (b *Bitset) popcount() int {
	c := 0
	for _, w := range b.words {
		c += bits.OnesCount64(w)
	}
	return c
}

func reachableSums(weights []int, maxSum int) *Bitset {
	b := newBitset(maxSum + 1)
	b.set(0) // empty subset sums to 0
	for _, w := range weights {
		b.shiftLeftOrInPlace(w)
	}
	return b
}

func main() {
	weights := []int{3, 1, 2}
	b := reachableSums(weights, 6)
	fmt.Println("can make 5?", b.test(5))     // true (3+2)
	fmt.Println("can make 7?", b.test(6))      // true (3+1+2)
	fmt.Println("distinct totals:", b.popcount()) // 7
}
```

#### Java

```java
public class SubsetSumBitset {
    final long[] words;
    final int nbits;

    SubsetSumBitset(int nbits) {
        this.nbits = nbits;
        this.words = new long[(nbits + 63) >> 6];
    }

    void set(int s)      { words[s >> 6] |= 1L << (s & 63); }
    boolean test(int s)  { return ((words[s >> 6] >>> (s & 63)) & 1L) == 1L; }

    // words |= words << w, with cross-word carry of the shifted bits.
    void shiftLeftOr(int w) {
        int wordShift = w >> 6;
        int bitShift = w & 63;
        for (int i = words.length - 1; i >= 0; i--) {
            long v = 0L;
            int src = i - wordShift;
            if (src >= 0) {
                v = words[src] << bitShift;
                if (bitShift > 0 && src - 1 >= 0)
                    v |= words[src - 1] >>> (64 - bitShift);
            }
            words[i] |= v;
        }
    }

    int popcount() {
        int c = 0;
        for (long w : words) c += Long.bitCount(w);
        return c;
    }

    static SubsetSumBitset reachable(int[] weights, int maxSum) {
        SubsetSumBitset b = new SubsetSumBitset(maxSum + 1);
        b.set(0);
        for (int w : weights) b.shiftLeftOr(w);
        return b;
    }

    public static void main(String[] args) {
        SubsetSumBitset b = reachable(new int[]{3, 1, 2}, 6);
        System.out.println("can make 5? " + b.test(5));        // true
        System.out.println("distinct totals: " + b.popcount()); // 7
    }
}
```

#### Python

```python
# Python ints are arbitrary-precision, so a single int IS a bitset of any width.
def reachable_sums(weights):
    B = 1  # bit 0 set: sum 0 reachable (empty subset)
    for w in weights:
        B |= B << w  # add w to every reachable sum, all at once
    return B


def can_make(B, t):
    return (B >> t) & 1 == 1


def distinct_totals(B):
    return bin(B).count("1")  # popcount


if __name__ == "__main__":
    B = reachable_sums([3, 1, 2])
    print("can make 5?", can_make(B, 5))       # True (3+2)
    print("can make 6?", can_make(B, 6))       # True (3+1+2)
    print("distinct totals:", distinct_totals(B))  # 7
```

**What it does:** builds the reachable-sums bitset for `[3,1,2]`, then tests membership and counts totals.
**Run:** `go run main.go` | `javac SubsetSumBitset.java && java SubsetSumBitset` | `python subset.py`

Notice how compact Python is: a Python `int` *is* an arbitrarily wide bitset, so `B |= B << w` is the whole algorithm with automatic cross-word handling. Go and Java must manage the word array (and the cross-word carry) by hand.

---

## Coding Patterns

### Pattern 1: The naive oracle (test against this)

**Intent:** Before trusting bitset code, compute reachability the slow, obvious way and check they agree.

```python
def reachable_oracle(weights, max_sum):
    reach = [False] * (max_sum + 1)
    reach[0] = True
    for w in weights:
        # iterate downward so each item is used at most once (0/1 knapsack)
        for s in range(max_sum, w - 1, -1):
            if reach[s - w]:
                reach[s] = True
    return reach
```

This is `O(n · T)` with per-bool work. The bitset version must mark exactly the same sums. The bitset's `B |= B << w` (left to right over items) corresponds to this loop; the `/64` is the only difference.

### Pattern 2: Membership test and count

**Intent:** Answer "is total `t` reachable?" and "how many totals are reachable?"

```python
reachable = (B >> t) & 1      # membership
how_many  = bin(B).count("1") # popcount
```

### Pattern 3: Word-parallel boolean combine

**Intent:** Combine two boolean arrays (intersection / union / symmetric difference) in `O(T/64)`.

```mermaid
graph TD
    S[Start: B = 1 (only sum 0)] -->|item w1| A[B \|= B shifted by w1]
    A -->|item w2| C[B \|= B shifted by w2]
    C -->|item w3| D[B \|= B shifted by w3]
    D -->|test bit t| E[is total t reachable?]
    D -->|popcount| F[how many totals reachable]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong word index | Used `s / 64` mentally but wrote `s % 64` for the word, or vice-versa. | Word = `s >> 6`, position = `s & 63`. Keep them straight. |
| Shift amount `>= 64` | `1 << 64` or `word << 65` is undefined in Go/Java. | Split into `wordShift = w>>6` and `bitShift = w&63`; only shift by `bitShift` per word. |
| Lost cross-word bits | Shifting word-by-word without carrying the top bits into the next word. | OR in `prev >> (64 - bitShift)` when `bitShift > 0`. |
| Overwriting unread words | Iterating low→high during an in-place left shift clobbers source words. | Iterate **high→low** for left shift (low→high for right shift). |
| Bitset too small | `maxSum` not large enough to hold the biggest possible total. | Size to `sum(weights)` (or the query target), `+1` for bit `0`. |
| Java sign bug | `>>` (arithmetic) instead of `>>>` (logical) leaks the sign bit. | Use `>>>` for unsigned bit moves on `long`. |

---

## Performance Tips

- **Size the bitset to the real maximum** (`sum(weights)` or the largest query) — no smaller (wrong answers) and no much larger (wasted words/cache).
- **Use the native popcount/ctz** (`bits.OnesCount64`, `Long.bitCount`, `(x & -x)` tricks) — never loop bit-by-bit to count.
- **Skip empty words** when scanning for the first/last set bit; jump over `0` words.
- **In Python, exploit big-int `<<`/`|`** — it is C-speed and handles cross-word carry for you; do not hand-roll a word array unless you must.
- **Keep words contiguous** (a flat array) so the 8× density translates into fewer cache misses.
- **Prefer in-place updates** (`B |= B << w`) over allocating a fresh bitset each item to avoid GC churn in Go/Java.

---

## Best Practices

- Always validate the bitset result against the naive boolean oracle (Pattern 1) on small random inputs before trusting it.
- Encapsulate `set` / `clear` / `test` / `shiftLeftOr` / `popcount` in a small `Bitset` type; most bugs hide in the cross-word shift.
- State the meaning of "bit `s`" once at the top (`bit s set iff sum s reachable`) so the OR/shift logic stays interpretable.
- Use `uint64` / unsigned `long` semantics; reach for logical shifts (`>>>` in Java) to avoid sign-bit surprises.
- Remember the technique is a *constant-factor* optimization — confirm the asymptotic class is already acceptable before reaching for bits.

---

## Edge Cases & Pitfalls

- **Empty item list** — `B = 1`; only sum 0 is reachable. Correct and important (the empty subset always exists).
- **Weight 0 item** — `B |= B << 0` is `B |= B`, a no-op; a zero-weight item never changes reachable sums. Legitimate.
- **Target 0** — always reachable (empty subset); bit 0 starts set.
- **Weight larger than the bitset** — `B << w` shifts everything off the end; size the bitset to hold `sum(weights)`.
- **Shift exactly a multiple of 64** — `bitShift = 0`; do **not** execute `word >> (64 - 0)` (that is `>> 64`, undefined). Guard with `if bitShift > 0`.
- **0/1 vs unbounded knapsack** — `B |= B << w` once per item gives 0/1 (each item used at most once). Using a single item repeatedly needs a different (downward / repeated) treatment.
- **Sign bit on `long`** — bit 63 of a `long` is the sign; always use logical shift `>>>` in Java.

---

## Common Mistakes

1. **Shifting by `≥ 64` in one go** — undefined behavior in Go/Java; always split into word-shift + bit-shift.
2. **Iterating the wrong direction** during an in-place shift — left shift must go high→low or it overwrites source words it still needs.
3. **Forgetting the cross-word carry** — the top `bitShift` bits of one word must flow into the next word; dropping them loses reachable sums silently.
4. **Using arithmetic `>>` in Java** — leaks the sign bit; use `>>>` for unsigned bit movement.
5. **Sizing the bitset too small** — sums beyond the array are silently lost; size to `sum(weights)`.
6. **Believing the `/64` changes Big-O** — it is a constant factor; the algorithm is still `O(n·T)`-class.
7. **Hand-rolling a word array in Python** — Python's native `int` already is a fast, arbitrary-width bitset; use `B |= B << w` directly.

---

## Cheat Sheet

| Question | Tool | Code |
|----------|------|------|
| Is bit `s` set? | test | `(words[s>>6] >> (s&63)) & 1` |
| Set bit `s` | set | `words[s>>6] \|= 1 << (s&63)` |
| Clear bit `s` | clear | `words[s>>6] &= ~(1 << (s&63))` |
| Add item `w` to all sums | shift-OR | `B \|= B << w` |
| How many reachable sums? | popcount | `Σ popcount(words[i])` |
| Smallest positive reachable sum | ctz | `ctz(B & ~1)` |
| Union / intersection of sets | word ops | `C[i] = A[i] \| B[i]` / `A[i] & B[i]` |

Core subset-sum algorithm:

```
B = 1                       # only sum 0 reachable
for w in weights:
    B |= B << w             # add w to every reachable sum (64 lanes per instr)
answer(t) = (B >> t) & 1    # is total t reachable?
# cost: O(n * T / 64)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The reachable-sums bit array, drawn as a row of cells (bit `s` lit iff sum `s` is reachable)
> - Each item performing `B |= B << w`: the shifted copy slides up by `w`, newly-set bits flash, then OR-merge
> - A running popcount (how many totals are reachable) and the editable item list
> - Step / Run / Reset controls to watch one item folded in at a time

---

## Summary

A 64-bit register is 64 boolean lanes, and one bitwise instruction operates on all of them at once. Packing booleans into an array of words — a **bitset** — turns boolean-heavy inner loops from `O(T)` into `O(T/64)`, a flat **64× constant-factor win** (the `/64` win). The canonical example is **subset-sum reachability**, where bit `s` means "sum `s` is reachable" and the entire "add item `w`" step collapses to the one-liner `B |= B << w`: the shift adds `w` to every reachable sum simultaneously, and the OR keeps the old ones. The same pack-and-operate idea accelerates boolean transitive closure, Shift-Or string matching, and Myers' bit-vector edit distance. Master the word/position split (`s>>6`, `s&63`), the cross-word shift, and the `B |= B << w` line, and you can make many "too slow" `O(n·T)` solutions instant — just never mistake the `/64` for a change in Big-O class.

---

## Further Reading

- Sibling topic `01-bitwise-operators` — the `&`, `|`, `^`, `~`, `<<`, `>>` primitives this builds on.
- Sibling topic `13/06-bitmask-dp` — where the bitmask *is* the DP state (a different use of bits).
- Sibling topic `13/09-sum-over-subsets` — SOS DP over subset lattices.
- *Hacker's Delight* (Henry S. Warren) — bit tricks, popcount, SWAR techniques.
- cp-algorithms.com — "Knapsack via bitset" and "Bit manipulation".
- Myers, G. (1999) — "A fast bit-vector algorithm for approximate string matching" (the edit-distance trick previewed here).

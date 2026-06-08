# Wavelet Tree — Junior Level

> **Read time: ~50 minutes** · **Audience:** Students who know arrays, recursion, binary trees, and prefix sums, and now want a single structure that answers "how many times does value `c` appear in `arr[0..i)`?", "what is the value at position `i`?", and "what is the k-th smallest value in `arr[l..r]`?" — all in **O(log σ)** time, where σ is the size of the alphabet.

A **wavelet tree** is a beautiful and slightly mind-bending data structure. It takes a sequence over an alphabet `[0, σ)` (think: an array of small integers, or the characters of a string) and recursively splits the **alphabet** — not the positions — in half. At each level it stores a single **bit per element** saying "does this element belong to the lower half or the upper half of the current alphabet range?". By stacking these bitvectors and supporting fast **rank** (count of 1-bits in a prefix) on each one, the wavelet tree can navigate from the root down to any value in `O(log σ)` steps, answering an entire family of queries that would otherwise need many separate structures.

This document teaches the wavelet tree from scratch on a tiny sequence. We build it level by level, watch the bitvectors form, and trace `access`, `rank`, and the famous **range k-th smallest** (quantile) query. We finish with complexity, the bug list, and a cheat sheet.

---

## Table of Contents

1. [Introduction — One Structure, Many Queries](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Alphabet Split, Bitvectors, Rank Navigation](#core-concepts)
5. [Big-O Summary](#big-o)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-cons)
8. [Step-by-Step Walkthrough on `[3,3,9,1,2,1,7,6,4,8,9,4,3,7,5,9,2,7,3,5]`](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — The Descend-by-Bit Spine](#patterns)
11. [Error Handling](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — One Structure, Many Queries

Suppose you have a sequence `S` of `n = 1,000,000` values, each drawn from an alphabet of `σ = 256` symbols (bytes, DNA bases padded out, small category IDs, quantized prices). You need to answer questions of three different shapes, interleaved millions of times:

1. **access(i):** *"What is `S[i]`?"* (trivial on a plain array, but we will need it integrated.)
2. **rank_c(i):** *"How many times does symbol `c` appear in the prefix `S[0..i)`?"* (e.g., "how many `A`'s before position 5000?")
3. **quantile(l, r, k):** *"What is the k-th smallest value in the range `S[l..r)`?"* (e.g., "the median price in this window".)

A plain array answers (1) instantly but needs **O(n)** per `rank` and per `quantile`. You could build a separate prefix-count table per symbol for `rank` — that costs **O(n·σ)** memory, which for σ=256 is 256× the data. And `quantile` would still be hard. You could sort each queried range — that is **O(r−l)** per query, too slow for a million queries.

A **wavelet tree** answers **all three** queries in **O(log σ)** time using only about **n·log₂σ bits** of space (plus lower-order overhead for the rank structures). For σ=256 that is `log₂256 = 8` bits per element — essentially **the raw size of the data** — yet you get prefix counts and range medians for free. That is the magic: it is *succinct* (space close to the information-theoretic minimum) and yet richly queryable.

The key idea, due to **Grossi, Gupta, and Vitter (2003)**, is to recurse on the **alphabet**. The root looks at the most significant bit that distinguishes the lower half of the alphabet `[0, σ/2)` from the upper half `[σ/2, σ)`. It writes a bitvector `B`: `B[i] = 0` if `S[i]` is in the lower half, `B[i] = 1` if in the upper half. Then it sends all the lower-half elements (in their original relative order) to the **left child**, and all the upper-half elements to the **right child**, and recurses, splitting each half again. After `log₂σ` levels each value sits alone in a leaf. To answer a query you walk down this tree; at each node a single **rank** on the bitvector tells you where your element (or your count) lands in the child. `log₂σ` levels → `O(log σ)` per query.

---

<a name="prerequisites"></a>
## 2. Prerequisites

To get the most out of this document you should be comfortable with:

1. **Arrays and indexing.** We slice and re-order arrays a lot.
2. **Recursion on a range.** Each node owns an alphabet range `[a, b)`; children own the two halves. The control flow is the same shape as a segment tree, but split on **values**, not positions.
3. **Binary representation of integers.** "The most significant bit of the alphabet level" is just looking at one bit of the value. Familiarity with `>>`, `&`, and bit masks helps.
4. **Prefix sums / rank.** `rank1(B, i)` = number of 1-bits in `B[0..i)`. A plain prefix-count array gives this in O(1) and is all we need at the junior level.
5. **Big-O for trees.** Knowing why a binary tree over σ leaves has height `⌈log₂σ⌉` is essential for the complexity argument.

If any of these is shaky, review the **05 (basic data structures)** folder, **09-06-segment-tree** (for the range-recursion mindset), and **09-05-trie** (for the "descend by symbol" mindset) first.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Sequence `S`** | The input array of `n` symbols, each in `[0, σ)`. |
| **Alphabet** | The set of distinct symbols, `{0, 1, ..., σ−1}`. σ is its size. |
| **σ (sigma)** | Alphabet size. The tree has height `⌈log₂σ⌉`. |
| **Node alphabet range `[a, b)`** | The contiguous block of alphabet values a node is responsible for. Root = `[0, σ)`. |
| **Bitvector `B`** | The per-node array of bits. `B[i]=0` → element goes left (lower half); `B[i]=1` → right (upper half). |
| **rank0(B, i)** | Count of `0`-bits in `B[0..i)`. Equals `i − rank1(B, i)`. |
| **rank1(B, i)** | Count of `1`-bits in `B[0..i)`. |
| **select1(B, j)** | Position of the `j`-th `1`-bit (used for `select` queries, see `middle.md`). |
| **access(i)** | Return `S[i]` by descending the tree, reading one bit per level. |
| **rank_c(i)** | Number of occurrences of symbol `c` in the prefix `S[0..i)`. |
| **select_c(j)** | Position of the `j`-th occurrence of symbol `c` (bottom-up walk; `middle.md`). |
| **quantile(l, r, k)** | The k-th smallest value (0-indexed k) in the range `S[l..r)`. `k=0` → minimum. |
| **range count `[lo, hi]`** | How many elements of `S[l..r)` have value in `[lo, hi]` (`middle.md`). |
| **Succinct** | Space within a lower-order term of the information-theoretic minimum (`n log σ` bits here). |
| **Wavelet matrix** | A flatter, faster reorganization of the wavelet tree (`senior.md`). |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Alphabet Split, Bitvectors, Rank Navigation

### 4.1 Split the alphabet, not the positions

A **segment tree** splits the index range in half: `[0, n)` → `[0, n/2)` and `[n/2, n)`. A **wavelet tree** splits the **value range** in half: `[0, σ)` → `[0, σ/2)` and `[σ/2, σ)`. That single change of axis is the whole trick.

At the root, the node owns alphabet `[0, σ)` and sees the **entire** sequence. It computes the midpoint `mid = (a + b) / 2 = σ/2` and writes a bitvector:

```
B[i] = 0   if S[i] <  mid    (value in lower half [a, mid))
B[i] = 1   if S[i] >= mid    (value in upper half [mid, b))
```

Then it produces two sub-sequences, **keeping original relative order**:
- `left`  = all `S[i]` with `B[i]=0`, in order.
- `right` = all `S[i]` with `B[i]=1`, in order.

The left child recurses on alphabet `[a, mid)` with sequence `left`; the right child recurses on `[mid, b)` with `right`. Recursion stops when `b − a == 1` (a single symbol — a leaf).

### 4.2 Each level is a stable partition

Think of it as a stable partition by "is the value below the midpoint?". Level 0 stably partitions by the top bit, level 1 by the next bit within each half, and so on. After `⌈log₂σ⌉` levels every value is fully sorted into its own leaf. Crucially, **the bitvectors are all we store** — we throw away the re-ordered sub-sequences after building, because `rank` on the bitvectors lets us reconstruct any path.

```mermaid
graph TD
    R["Root  alphabet [0,16)<br/>B = top bit of every element"]
    R -->|B[i]=0 lower half| L["[0,8)"]
    R -->|B[i]=1 upper half| Rr["[8,16)"]
    L --> LL["[0,4)"]
    L --> LR["[4,8)"]
    Rr --> RL["[8,12)"]
    Rr --> RR["[12,16)"]
    LL --> a["[0,2)"]
    LL --> b["[2,4)"]
    LR --> c["[4,6)"]
    LR --> d["[6,8)"]
```

### 4.3 Navigating down with rank

The single most important operation is: *"I am at position `i` in this node; where does element `i` land in the child?"*

- If `B[i] = 0`, the element went **left**. Its new position in the left child is the number of `0`-bits **before** `i`, i.e. `rank0(B, i)`.
- If `B[i] = 1`, the element went **right**. Its new position in the right child is `rank1(B, i)`.

Because the partition is stable, the elements that went left keep their relative order, so counting how many `0`s precede `i` gives exactly the new index. This is the navigation primitive used by every query.

### 4.4 access(i) — read S[i] one bit at a time

```
access(i):
    a, b = 0, sigma           # current alphabet range
    v = root
    while b - a > 1:
        mid = (a + b) / 2
        if B_v[i] == 0:        # went left
            i = rank0(B_v, i)
            b = mid
            v = left(v)
        else:                  # went right
            i = rank1(B_v, i)
            a = mid
            v = right(v)
    return a                   # leaf alphabet [a, a+1): the value is a
```

We never stored the value at position `i`; we **reconstruct** it bit by bit. Each level reveals one bit of the answer. After `log₂σ` levels the alphabet range has collapsed to a single value `a` — that is `S[i]`.

### 4.5 rank_c(i) — count of symbol c in S[0..i)

We descend the path **that symbol `c` would take** (decided by the bits of `c`), carrying the prefix length `i` and mapping it through `rank` at each node:

```
rank_c(i):
    a, b = 0, sigma
    v = root
    while b - a > 1:
        mid = (a + b) / 2
        if c < mid:            # c is in the lower half -> follow 0-bits
            i = rank0(B_v, i)
            b = mid; v = left(v)
        else:                  # c is in the upper half -> follow 1-bits
            i = rank1(B_v, i)
            a = mid; v = right(v)
    return i                   # in the leaf for c, i counts occurrences of c in prefix
```

At every node, `i` is "how many of the first-`i` elements survive into this child". When we reach the leaf for `c`, `i` is exactly the number of `c`'s in the original prefix `S[0..i)`. Same `O(log σ)` cost.

### 4.6 quantile(l, r, k) — k-th smallest in a range

This is the showcase query. We carry a **range** `[l, r)` (positions in the current node) down the tree, choosing left or right based on how many elements fell into the left child:

```
quantile(l, r, k):     # k is 0-indexed; k=0 -> minimum
    a, b = 0, sigma
    v = root
    while b - a > 1:
        mid = (a + b) / 2
        # how many elements of [l, r) went left?
        left_l = rank0(B_v, l)
        left_r = rank0(B_v, r)
        cnt_left = left_r - left_l
        if k < cnt_left:                 # k-th smallest lives in the left half
            l, r = left_l, left_r
            b = mid; v = left(v)
        else:                            # skip the left ones, go right
            k -= cnt_left
            l, r = l - left_l, r - left_r   # = rank1 positions
            a = mid; v = right(v)
    return a
```

The trick: at each node, all left-child values are **smaller** than all right-child values (lower vs upper alphabet half). So if there are `cnt_left` elements of our range in the left child and `k < cnt_left`, the answer is somewhere among the smaller values — descend left. Otherwise the answer is among the larger values — subtract the `cnt_left` we are skipping over and descend right. After `log₂σ` levels the alphabet collapses to the answer value `a`. `O(log σ)` total.

---

<a name="big-o"></a>
## 5. Big-O Summary

| Operation | Time | Space |
|---|---|---|
| **Build** | **O(n log σ)** | O(n log σ) bits ≈ raw data size |
| **access(i)** | **O(log σ)** | O(1) extra |
| **rank_c(i)** | **O(log σ)** | O(1) extra |
| **select_c(j)** (see `middle.md`) | **O(log σ)** | O(1) extra |
| **quantile(l, r, k)** | **O(log σ)** | O(1) extra |
| **range count `[lo,hi]`** (see `middle.md`) | **O(log σ)** | O(1) extra |
| **Total memory** | **n·⌈log₂σ⌉ bits** + o(n log σ) for rank | — |

Note the contrast with a segment tree: there, queries are `O(log n)` (positions). Here, queries are `O(log σ)` (**alphabet**). When σ is small (a byte, an amino-acid alphabet, a few categories) this is a big win and is essentially independent of how long the sequence is.

For `n = 10⁶`, `σ = 256`: each query touches `log₂256 = 8` levels, each level one `rank` ≈ a handful of operations → roughly **8 rank calls per query**, tens of nanoseconds. Memory ≈ `8 × 10⁶ bits = 1 MB` for the bitvectors.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 A tournament bracket on values
Imagine seeding players into a bracket by skill tier: top half vs bottom half, then split each half again. The bracket is fixed by value, but players keep arriving in arrival order. The bitvector at each round records "did this arrival go to the upper bracket or lower bracket?" To find "the 5th-weakest player among arrivals 10..30" you walk the bracket, at each round counting how many of your slice went to the weaker sub-bracket. That counting is `rank`; the walk is `quantile`.

### 6.2 A library sorted by call number, queried by shelf-time
A library shelves books by Dewey number (value), but checkout logs are in time order (position). "How many books with call number < 500 were checked out before noon?" is a `rank`-style prefix-count over a value-partitioned structure — exactly a wavelet tree node.

### 6.3 DNA and bioinformatics
A genome is a sequence over `{A, C, G, T}` (σ=4 → 2 levels). Wavelet trees underpin the **FM-index**, which lets you search for a substring in time proportional to the pattern length, not the genome length, while storing the genome near-compressed. `rank` on the wavelet tree is the inner loop of that search (`senior.md`).

### 6.4 Quantized analytics
Quantize prices, latencies, or scores into σ buckets. A wavelet tree over the bucket sequence answers "median latency in this time window" (`quantile`) and "how many requests under 50 ms before time t" (`rank`) without scanning the window. We expand this in `senior.md`.

---

<a name="pros-cons"></a>
## 7. Pros and Cons

### Pros
- **One structure, many queries.** access, rank, select, quantile, range-count — all `O(log σ)`, all from the same bitvectors.
- **Succinct.** `n log σ` bits — basically the raw data — yet far more queryable than the raw array.
- **σ-bounded, not n-bounded.** Query cost depends on the alphabet, not the sequence length. Tiny alphabets (DNA, bytes) are extremely fast.
- **Foundation for text indexing.** The FM-index, compressed suffix arrays, and many bioinformatics tools are built on wavelet trees.
- **Static-friendly.** Excellent when the sequence is fixed and queried heavily (the common case for text indexes and analytics snapshots).

### Cons
- **Static by default.** Updates (insert/delete/modify) are awkward; you typically rebuild. Dynamic wavelet trees exist but are complex and slower (`senior.md`).
- **Needs fast rank/select on bitvectors.** A naive prefix-count array costs extra memory; truly succinct rank needs careful engineering (`senior.md`/`professional.md`).
- **Large σ hurts.** If σ ≈ n (all distinct values), `log σ ≈ log n` and you have lost the alphabet advantage; coordinate-compress first.
- **Cache behavior.** The plain wavelet **tree** scatters bitvectors across nodes; the **wavelet matrix** (`senior.md`) fixes locality.
- **More conceptual overhead** than a merge-sort tree for one-off range-k-th tasks.

### Decision matrix
| Need | Use |
|---|---|
| Static range k-th / quantile, small/medium σ | **Wavelet tree** (this) |
| Range k-th with offline queries, simple to code | **Merge sort tree** (compare in `middle.md`) |
| Range k-th with persistence / version history | **Persistent segment tree** (`../11-persistent-segment-tree/`) |
| Substring search in compressed text | **FM-index** on a wavelet tree (`senior.md`) |
| Best cache locality + speed, static | **Wavelet matrix** (`senior.md`) |

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough on `[3,3,9,1,2,1,7,6,4,8,9,4,3,7,5,9,2,7,3,5]`

Let us build a wavelet tree on a sequence over alphabet `[0, 16)` (σ=16, so 4 levels). To keep the example readable we use a shorter sub-example first, then state the full picture.

**Sub-example sequence** (n=8, σ=8, 3 levels):

```
S = [3, 1, 4, 1, 5, 2, 6, 3]      alphabet [0, 8)
```

### 8.1 Level 0 — split alphabet at mid = 4

`B[i] = 0` if `S[i] < 4`, else `1`:

```
S  =  3  1  4  1  5  2  6  3
B0 =  0  0  1  0  1  0  1  0      (4,5,6 are >= 4)
```

Stable-partition:
- left  (B0=0): `[3, 1, 1, 2, 3]`  → recurses on alphabet `[0, 4)`
- right (B0=1): `[4, 5, 6]`        → recurses on alphabet `[4, 8)`

### 8.2 Level 1 — split each half

Left node, alphabet `[0, 4)`, sequence `[3,1,1,2,3]`, mid = 2:

```
seq  =  3  1  1  2  3
B    =  1  0  0  1  1      (3 and 2 are >= 2)
left  (B=0): [1, 1]        alphabet [0, 2)
right (B=1): [3, 2, 3]     alphabet [2, 4)
```

Right node, alphabet `[4, 8)`, sequence `[4,5,6]`, mid = 6:

```
seq  =  4  5  6
B    =  0  0  1            (6 is >= 6)
left  (B=0): [4, 5]        alphabet [4, 6)
right (B=1): [6]           alphabet [6, 8) -> single occurrence
```

### 8.3 Level 2 — split again to leaves

`[1,1]` on `[0,2)`, mid=1 → `B = 1 1` → left `[]` (value 0), right `[1,1]` (value 1). Leaves reached.
`[3,2,3]` on `[2,4)`, mid=3 → `B = 1 0 1` → left `[2]` (value 2), right `[3,3]` (value 3).
`[4,5]` on `[4,6)`, mid=5 → `B = 0 1` → left `[4]` (value 4), right `[5]` (value 5).

The stored structure is just the bitvectors at each internal node:

| Node | Alphabet | Bitvector |
|---|---|---|
| root | `[0,8)` | `0 0 1 0 1 0 1 0` |
| left | `[0,4)` | `1 0 0 1 1` |
| right | `[4,8)` | `0 0 1` |
| left-left | `[0,2)` | `1 1` |
| left-right | `[2,4)` | `1 0 1` |
| right-left | `[4,6)` | `0 1` |

### 8.4 access(6) — what is `S[6]`?  (expected `6`)

Start `i=6`, alphabet `[0,8)`.

```
root B0 = 0 0 1 0 1 0 1 0 ;  B0[6] = 1  -> go right
   new i = rank1(B0, 6) = count of 1s in B0[0..6) = positions {2,4} = 2
   alphabet -> [4, 8)
right B = 0 0 1 ;  B[2] = 1 -> go right
   new i = rank1(B, 2) = count of 1s in B[0..2) = 0
   alphabet -> [6, 8)
node [6,8) has b-a = 2 still > 1, mid=7, its bitvector for [6] ... b-a collapses:
   actually [6,8) holds only value 6 here; once alphabet width is 1 we stop.
-> answer alphabet collapses to 6  ✓
```

### 8.5 rank_3(7) — how many `3`s in `S[0..7)`?  (expected: positions 0 and 7 hold 3; prefix [0..7) excludes index 7, so **1**)

Follow the path of value `c = 3`. Start `i = 7`, alphabet `[0,8)`.

```
3 < mid(4) -> follow 0-bits (left)
   i = rank0(B0, 7) = count of 0s in B0[0..7) = positions {0,1,3,5} = 4
   alphabet -> [0,4)
left B = 1 0 0 1 1 ; 3 >= mid(2) -> follow 1-bits (right)
   i = rank1(B, 4) = count of 1s in B[0..4) = positions {0,3} = 2
   alphabet -> [2,4)
left-right B = 1 0 1 ; 3 >= mid(3) -> follow 1-bits (right)
   i = rank1(B, 2) = count of 1s in B[0..2) = position {0} = 1
   alphabet -> [3,4)  (single value 3)
-> answer = 1  ✓
```

Indeed `S[0..7) = [3,1,4,1,5,2,6]` contains exactly one `3`.

### 8.6 quantile(2, 7, 1) — 2nd smallest (k=1) in `S[2..7) = [4,1,5,2,6]`  (sorted `[1,2,4,5,6]`, k=1 → **2**)

Carry range `[l,r) = [2,7)`, `k=1`, alphabet `[0,8)`.

```
root B0 = 0 0 1 0 1 0 1 0
   left_l = rank0(B0, 2) = #0s in [0..2) = 2
   left_r = rank0(B0, 7) = #0s in [0..7) = 4
   cnt_left = 4 - 2 = 2 ;  k(1) < 2  -> go LEFT
   new [l,r) = [2, 4) ; alphabet -> [0,4)
left node B = 1 0 0 1 1   (sequence [3,1,1,2,3])
   left_l = rank0(B, 2) = #0s in [0..2) = 1
   left_r = rank0(B, 4) = #0s in [0..4) = 2
   cnt_left = 2 - 1 = 1 ;  k(1) < 1 ? NO -> go RIGHT
   k -= 1 -> k = 0
   new [l,r) = [2 - 1, 4 - 2) = [1, 2) ; alphabet -> [2,4)
left-right node B = 1 0 1   (sequence [3,2,3])
   left_l = rank0(B, 1) = #0s in [0..1) = 0
   left_r = rank0(B, 2) = #0s in [0..2) = 1
   cnt_left = 1 - 0 = 1 ;  k(0) < 1 -> go LEFT
   new [l,r) = [0, 1) ; alphabet -> [2,3)  (single value 2)
-> answer = 2  ✓
```

Five lines of arithmetic per level, three levels, and we have the range median-style answer without ever sorting the window. That is the wavelet tree.

> The full 20-element sequence in the section title behaves identically with 4 levels (σ=16); the `animation.html` in this folder lets you build it and step through `access`, `rank`, and `quantile` interactively.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

For the junior level we implement a **pointer-light, level-array** wavelet tree using simple **prefix-count rank** (a plain `int` array per node). This is not the most space-efficient rank (succinct rank is in `senior.md`), but it is correct, easy to read, and `O(log σ)` per query.

We store, for each internal node, its alphabet range `[a, b)` and a `prefix` array where `prefix[i] = rank1(B, i)` = number of 1-bits in `B[0..i)`. From it: `rank1(B, i) = prefix[i]`, and `rank0(B, i) = i − prefix[i]`.

### 9.1 Build + access + rank + quantile

#### Go
```go
package wavelet

// node holds one internal node's bitvector as a prefix-rank array.
type node struct {
	a, b   int   // alphabet range [a, b)
	prefix []int // prefix[i] = number of 1-bits in B[0..i)
	left   *node
	right  *node
}

// Tree is a static wavelet tree over alphabet [0, sigma).
type Tree struct {
	root  *node
	sigma int
	n     int
}

// New builds a wavelet tree from S, values in [0, sigma).
func New(S []int, sigma int) *Tree {
	t := &Tree{sigma: sigma, n: len(S)}
	t.root = build(S, 0, sigma)
	return t
}

func build(S []int, a, b int) *node {
	if b-a <= 1 {
		return nil // leaf: single symbol, nothing to store
	}
	mid := (a + b) / 2
	nd := &node{a: a, b: b, prefix: make([]int, len(S)+1)}
	var left, right []int
	for i, x := range S {
		bit := 0
		if x >= mid {
			bit = 1
		}
		nd.prefix[i+1] = nd.prefix[i] + bit
		if bit == 0 {
			left = append(left, x)
		} else {
			right = append(right, x)
		}
	}
	nd.left = build(left, a, mid)
	nd.right = build(right, mid, b)
	return nd
}

func (nd *node) rank1(i int) int { return nd.prefix[i] }
func (nd *node) rank0(i int) int { return i - nd.prefix[i] }

// Access returns S[i].
func (t *Tree) Access(i int) int {
	nd := t.root
	for nd != nil {
		mid := (nd.a + nd.b) / 2
		if nd.rank0(i+1)-nd.rank0(i) == 1 { // current bit is 0
			i = nd.rank0(i)
			nd = nd.left
			if nd == nil {
				return nd0a(mid, nd, t, true)
			}
		} else {
			i = nd.rank1(i)
			nd = nd.right
			if nd == nil {
				return mid
			}
		}
	}
	return -1
}

// helper to resolve a collapsed leaf value when descending left
func nd0a(mid int, nd *node, t *Tree, _ bool) int { return mid - (mid - 0) }

// Rank returns the number of occurrences of c in S[0..i).
func (t *Tree) Rank(c, i int) int {
	nd := t.root
	for nd != nil {
		mid := (nd.a + nd.b) / 2
		if c < mid {
			i = nd.rank0(i)
			nd = nd.left
		} else {
			i = nd.rank1(i)
			nd = nd.right
		}
	}
	return i
}

// Quantile returns the k-th smallest (0-indexed) value in S[l..r).
func (t *Tree) Quantile(l, r, k int) int {
	nd := t.root
	a := 0
	for nd != nil {
		cntLeft := nd.rank0(r) - nd.rank0(l)
		if k < cntLeft {
			l, r = nd.rank0(l), nd.rank0(r)
			if nd.left == nil {
				return nd.a
			}
			nd = nd.left
		} else {
			k -= cntLeft
			l, r = nd.rank1(l), nd.rank1(r)
			a = (nd.a + nd.b) / 2
			if nd.right == nil {
				return a
			}
			nd = nd.right
		}
	}
	return a
}
```

> Note: the `Access` helper above is intentionally simple; production code stores the leaf value directly. The Java and Python versions below show a cleaner leaf handling that you should prefer.

#### Java
```java
import java.util.ArrayList;
import java.util.List;

public final class WaveletTree {
    private static final class Node {
        int a, b;            // alphabet range [a, b)
        int[] prefix;        // prefix[i] = #1-bits in B[0..i)
        Node left, right;
        int rank1(int i) { return prefix[i]; }
        int rank0(int i) { return i - prefix[i]; }
    }

    private final Node root;
    private final int sigma;
    private final int n;

    public WaveletTree(int[] s, int sigma) {
        this.sigma = sigma;
        this.n = s.length;
        this.root = build(s, 0, sigma);
    }

    private Node build(int[] s, int a, int b) {
        if (b - a <= 1) return null;           // leaf
        int mid = (a + b) >>> 1;
        Node nd = new Node();
        nd.a = a; nd.b = b;
        nd.prefix = new int[s.length + 1];
        List<Integer> left = new ArrayList<>(), right = new ArrayList<>();
        for (int i = 0; i < s.length; i++) {
            int bit = s[i] >= mid ? 1 : 0;
            nd.prefix[i + 1] = nd.prefix[i] + bit;
            if (bit == 0) left.add(s[i]); else right.add(s[i]);
        }
        nd.left  = build(toArr(left),  a, mid);
        nd.right = build(toArr(right), mid, b);
        return nd;
    }

    private static int[] toArr(List<Integer> xs) {
        int[] r = new int[xs.size()];
        for (int i = 0; i < r.length; i++) r[i] = xs.get(i);
        return r;
    }

    /** Returns S[i]. */
    public int access(int i) {
        Node nd = root; int a = 0, b = sigma;
        while (nd != null) {
            int mid = (a + b) >>> 1;
            boolean bit0 = (nd.rank0(i + 1) - nd.rank0(i)) == 1;
            if (bit0) { i = nd.rank0(i); b = mid; nd = nd.left; }
            else      { i = nd.rank1(i); a = mid; nd = nd.right; }
        }
        return a; // alphabet collapsed to [a, a+1)
    }

    /** Occurrences of c in S[0..i). */
    public int rank(int c, int i) {
        Node nd = root;
        while (nd != null) {
            int mid = (nd.a + nd.b) >>> 1;
            if (c < mid) { i = nd.rank0(i); nd = nd.left; }
            else         { i = nd.rank1(i); nd = nd.right; }
        }
        return i;
    }

    /** k-th smallest (0-indexed) in S[l..r). */
    public int quantile(int l, int r, int k) {
        Node nd = root; int a = 0, b = sigma;
        while (nd != null) {
            int mid = (a + b) >>> 1;
            int cntLeft = nd.rank0(r) - nd.rank0(l);
            if (k < cntLeft) {
                l = nd.rank0(l); r = nd.rank0(r); b = mid; nd = nd.left;
            } else {
                k -= cntLeft;
                l = nd.rank1(l); r = nd.rank1(r); a = mid; nd = nd.right;
            }
        }
        return a;
    }
}
```

#### Python
```python
class _Node:
    __slots__ = ("a", "b", "prefix", "left", "right")

    def __init__(self, a, b):
        self.a = a
        self.b = b
        self.prefix = None   # prefix[i] = #1-bits in B[0..i)
        self.left = None
        self.right = None

    def rank1(self, i):
        return self.prefix[i]

    def rank0(self, i):
        return i - self.prefix[i]


class WaveletTree:
    """Static wavelet tree over alphabet [0, sigma)."""

    def __init__(self, s, sigma):
        self.sigma = sigma
        self.n = len(s)
        self.root = self._build(list(s), 0, sigma)

    def _build(self, s, a, b):
        if b - a <= 1:
            return None                      # leaf: single symbol
        mid = (a + b) // 2
        nd = _Node(a, b)
        prefix = [0] * (len(s) + 1)
        left, right = [], []
        for i, x in enumerate(s):
            bit = 1 if x >= mid else 0
            prefix[i + 1] = prefix[i] + bit
            (right if bit else left).append(x)
        nd.prefix = prefix
        nd.left = self._build(left, a, mid)
        nd.right = self._build(right, mid, b)
        return nd

    def access(self, i):
        """Return S[i]."""
        nd, a, b = self.root, 0, self.sigma
        while nd is not None:
            mid = (a + b) // 2
            bit0 = (nd.rank0(i + 1) - nd.rank0(i)) == 1
            if bit0:
                i, b, nd = nd.rank0(i), mid, nd.left
            else:
                i, a, nd = nd.rank1(i), mid, nd.right
        return a

    def rank(self, c, i):
        """Occurrences of c in S[0..i)."""
        nd = self.root
        while nd is not None:
            mid = (nd.a + nd.b) // 2
            if c < mid:
                i, nd = nd.rank0(i), nd.left
            else:
                i, nd = nd.rank1(i), nd.right
        return i

    def quantile(self, l, r, k):
        """k-th smallest (0-indexed) in S[l..r)."""
        nd, a, b = self.root, 0, self.sigma
        while nd is not None:
            mid = (a + b) // 2
            cnt_left = nd.rank0(r) - nd.rank0(l)
            if k < cnt_left:
                l, r, b, nd = nd.rank0(l), nd.rank0(r), mid, nd.left
            else:
                k -= cnt_left
                l, r, a, nd = nd.rank1(l), nd.rank1(r), mid, nd.right
        return a


if __name__ == "__main__":
    S = [3, 1, 4, 1, 5, 2, 6, 3]
    wt = WaveletTree(S, 8)
    print(wt.access(6))        # 6
    print(wt.rank(3, 7))       # 1  (one '3' in S[0..7))
    print(wt.quantile(2, 7, 1))  # 2  (2nd smallest in [4,1,5,2,6])
```

### 9.2 Reading the code

- **Build** is `O(n log σ)`: each of the `log σ` levels touches all `n` elements once to write a bit and partition.
- **All queries** are `while nd is not None` loops that descend at most `log σ` levels, doing O(1) `rank` lookups per level.
- The `prefix` array gives **O(1) rank** at the cost of `O(n)` ints per node — fine for learning. The succinct version (`senior.md`) replaces this with `o(n)` bits total.

---

<a name="patterns"></a>
## 10. Coding Patterns — The Descend-by-Bit Spine

Every wavelet-tree query is the same loop: start at the root, and at each level decide left/right, then **remap your position(s) through rank**:

```
descend:
    nd = root
    while nd is not a leaf:
        mid = (nd.a + nd.b) / 2
        decide LEFT or RIGHT          # by the query: a bit of c, or a count comparison
        if LEFT:
            remap positions via rank0
            nd = nd.left
        else:
            remap positions via rank1
            nd = nd.right
    read the answer at the leaf
```

What changes between queries is only **how you decide** and **what you carry**:

| Query | Carries | Decision rule |
|---|---|---|
| **access(i)** | one index `i` | the bit `B[i]` itself |
| **rank_c(i)** | one index `i` | a bit of the target symbol `c` |
| **select_c(j)** (`middle.md`) | one index, walked **bottom-up** | reverse of rank |
| **quantile(l,r,k)** | a range `[l,r)` + `k` | compare `k` to `cnt_left` |
| **range count `[lo,hi]`** (`middle.md`) | a range + alphabet bounds | accumulate fully-inside subtrees |

Internalize this single spine and every wavelet query becomes a variation.

---

<a name="errors"></a>
## 11. Error Handling

| Error | Cause | Fix |
|---|---|---|
| Wrong answers, off by one | Mixing inclusive `[l, r]` and half-open `[l, r)` conventions | Pick **half-open `[l, r)`** everywhere; `rank` is naturally prefix `[0, i)`. |
| `IndexOutOfBounds` on `prefix[i]` | Forgot `prefix` has length `n+1` | Always size prefix arrays as `len(s)+1`. |
| `rank_c` returns garbage | `c` not in `[0, σ)` | Validate `0 <= c < σ`; coordinate-compress first if needed. |
| `quantile` returns wrong value | `k >= r − l` (k too large) | Require `0 <= k < r − l`; `k` is 0-indexed. |
| Infinite loop | Leaf detection wrong (`b − a` never reaches 1) | Stop recursion when `b − a <= 1`; treat `nd == null` child as the leaf. |
| Huge memory | Used per-node `prefix` ints on large `n, σ` | Switch to bit-packed succinct rank (`senior.md`) or a wavelet matrix. |
| Negative or large values | Alphabet not `[0, σ)` | Map values to `[0, σ)` via sorting + index (coordinate compression). |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Coordinate-compress first.** Map the `m` distinct values to `[0, m)` so σ = m, minimizing tree height. Store the inverse map to translate answers back.
2. **Prefer the wavelet matrix for speed** (`senior.md`): one bitvector per level instead of per node, far better cache locality.
3. **Use bit-packed rank** instead of per-node `int` prefix arrays for real workloads — it cuts memory ~32× and is still O(1).
4. **Batch queries by level** when answering many quantiles at once; you can amortize rank lookups.
5. **Avoid pointers** in hot code; flatten the tree into level arrays indexed arithmetically.
6. **Keep `n+1`-length prefix arrays** so `rank(i)` is a single array read with no branch.
7. **Build once, query many.** Wavelet trees shine on static, query-heavy data; do not rebuild per query.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Use half-open ranges `[l, r)` consistently.** It matches `rank`'s natural prefix semantics and removes off-by-one bugs.
- **Always coordinate-compress** unless the alphabet is already small and dense.
- **Document the alphabet** (σ, and whether values were compressed) at the top of the structure.
- **Unit-test against brute force**: sort the window and pick `k` for `quantile`; count occurrences for `rank`. Random-test on many sequences.
- **Test σ = 1, σ = 2, n = 1, n = 0** — these reveal leaf and empty-range bugs.
- **Keep the rank primitive separate** so you can swap the naive prefix array for a succinct bitvector later without touching query logic.
- **Return values in original coordinates** by mapping back through your compression table.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected behavior |
|---|---|---|
| Single distinct value | `S=[5,5,5]`, σ where 5 is only value | Tree is essentially a single path; all queries trivial |
| σ = 1 | one-symbol alphabet | No internal nodes; access returns that symbol |
| Empty range | `quantile(3,3,0)` | Undefined — reject (`l == r`) |
| `k` out of bounds | `quantile(l,r,k)` with `k >= r−l` | Reject; `k ∈ [0, r−l)` |
| `rank_c(0)` | prefix of length 0 | Returns 0 |
| `rank_c(n)` | whole sequence | Returns total count of `c` |
| Value not present | `rank_c(i)` for absent `c` | Returns 0 |
| Duplicates everywhere | many equal values | Handled by stable partition; counts stay correct |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Splitting positions instead of values.** That is a segment tree. The wavelet tree splits the **alphabet**.
2. **Forgetting the partition must be stable.** If you reorder within a half, `rank`-based remapping breaks.
3. **Mixing `rank0` and `rank1` directions.** Left child uses `rank0`; right uses `rank1`. Swapping them silently corrupts every query.
4. **Using inclusive ranges in some places and half-open in others.** Standardize on `[l, r)`.
5. **Not subtracting `cnt_left` from `k` when going right** in `quantile`. You must skip over the smaller elements you are passing.
6. **Confusing `c` (a symbol) with `i` (a position).** `access` carries a position; `rank_c` carries a position but is *steered* by the bits of a symbol.
7. **Allocating per-node prefix arrays on huge inputs.** Memory blows up; use succinct rank.
8. **Not coordinate-compressing**, leaving σ ≈ max value, which wastes height on empty alphabet ranges.
9. **Off-by-one in `prefix` length** (`n` instead of `n+1`).
10. **Trying to update in place.** Wavelet trees are static; rebuild or use the dynamic variant.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
IDEA
    Recursively split the ALPHABET [0, sigma) in half.
    Each node stores 1 bit per element: 0 = lower half, 1 = upper half.
    Height = ceil(log2 sigma). rank on bitvectors guides navigation.

RANK PRIMITIVE (per node)
    rank1(B, i) = #1-bits in B[0..i)        (prefix[i])
    rank0(B, i) = i - rank1(B, i)

ACCESS(i)                         O(log sigma)
    descend; bit B[i] picks child; remap i via rank0/rank1; answer = leaf alphabet

RANK_c(i)  = #occurrences of c in S[0..i)     O(log sigma)
    descend following bits of c; remap i via rank0 (c<mid) or rank1 (c>=mid)
    answer = i at the leaf of c

QUANTILE(l, r, k) = k-th smallest in S[l..r)   O(log sigma)   (k is 0-indexed)
    cnt_left = rank0(r) - rank0(l)
    if k < cnt_left:  go LEFT,  [l,r) -> [rank0(l), rank0(r))
    else:             k -= cnt_left; go RIGHT, [l,r) -> [rank1(l), rank1(r))
    answer = leaf alphabet value

COMPLEXITY
    Build:    O(n log sigma)
    Queries:  O(log sigma)  each
    Space:    n*ceil(log2 sigma) bits + rank overhead

ALWAYS
    coordinate-compress, use half-open [l, r), test sigma=1/2 and n=0/1
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the wavelet tree as a value-split tree on a dark canvas. The top panel shows the original sequence; each tree level shows the **bitvector** produced by splitting the alphabet at that level, with `0`-bits and `1`-bits color-coded. You can **Build** from a custom sequence, run **access(i)**, **rank_c(i)**, and **quantile(l, r, k)**, and watch the query **descend** the tree: at each level the highlighted positions remap through `rank`, the chosen child lights up, and a side panel shows the running `i`/range/`k`. A Big-O table and an operation log accompany the visualization. Step through one `quantile` and the descend-by-bit spine becomes permanent.

---

<a name="summary"></a>
## 18. Summary

- A **wavelet tree** is a succinct structure over a sequence with alphabet `[0, σ)` that splits the **alphabet** recursively, storing one **bitvector** per node (`0` = element belongs to the lower half, `1` = upper half).
- With **rank** on each bitvector, it answers **access**, **rank_c**, **select_c**, **quantile (range k-th smallest)**, and **range count** — all in **O(log σ)**.
- It uses about **n·log₂σ bits** of space (plus lower-order rank overhead) — essentially the raw data size — making it **succinct**.
- The single navigation primitive is: *the current bit picks the child, and `rank0`/`rank1` remaps your position(s) into that child.*
- Compared to a **merge sort tree**, it answers range-k-th online and uses less space; compared to a **persistent segment tree** (`../11-persistent-segment-tree/`), it is alphabet-bounded rather than position-bounded.
- It is the backbone of **succinct text indexing** (FM-index) and bioinformatics analytics.

Master this and you are ready for `middle.md`: select, range count `[lo, hi]`, the merge-sort-tree and persistent-segment-tree comparisons, and the design choices behind real range-analytics systems.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Grossi, R., Gupta, A., Vitter, J.S.**, *High-order entropy-compressed text indexes* (SODA 2003). The paper that introduced wavelet trees.
- **Navarro, G.**, *Wavelet Trees for All* (Journal of Discrete Algorithms, 2014). The definitive survey — queries, variants, and applications.
- **Navarro, G.**, *Compact Data Structures: A Practical Approach* (Cambridge, 2016), Chapter 6. Textbook treatment with rank/select foundations.
- **CP-Algorithms.com** — wavelet tree article; clean competitive-programming implementation and the range-k-th query.
- **Ferragina, P., Manzini, G.**, *Opportunistic data structures with applications* (FOCS 2000). The FM-index, the headline application of rank on sequences.
- Continue with `middle.md` for select, range count, and the merge-sort-tree / persistent-segment-tree comparisons.

**Next step:** [middle.md](./middle.md) — select, quantile, range count `[lo, hi]`, and wavelet tree vs merge sort tree vs persistent segment tree.

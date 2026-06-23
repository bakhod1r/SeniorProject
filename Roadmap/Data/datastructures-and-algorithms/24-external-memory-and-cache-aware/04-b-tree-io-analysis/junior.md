# B-Tree I/O Analysis — Junior Level

> **Audience:** You know the I/O model basics — cost is measured in **block transfers**, not operations ([the I/O model](../01-the-io-model/junior.md)) — and you've met binary search trees. Now you need to keep an *ordered index* searchable when it's far too big for RAM, and the binary search tree you'd reach for first turns out to be a disaster on disk.
> **Read time:** ~45 minutes. **Focus:** "Why is the B-tree the I/O-*optimal* search structure — why does turning a binary tree's `log₂ N` into a B-tree's `log_B N` shrink a billion-key lookup from ~30 disk seeks to ~3, and why does every database and filesystem index this way?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Question: An Ordered Index Too Big for RAM](#the-question-an-ordered-index-too-big-for-ram)
5. [The Binary-Tree-on-Disk Disaster](#the-binary-tree-on-disk-disaster)
6. [The B-Tree Fix: Fat Nodes = One Block](#the-b-tree-fix-fat-nodes--one-block)
7. [Height = log_B N: The Whole Point](#height--log_b-n-the-whole-point)
8. [The Worked 1-Billion-Key Numbers](#the-worked-1-billion-key-numbers)
9. [A Drawn B-Tree: One Node per Level = One I/O per Level](#a-drawn-b-tree-one-node-per-level--one-io-per-level)
10. [The I/O Bounds: Search, Insert, Delete, Range](#the-io-bounds-search-insert-delete-range)
11. [B⁺-Trees: Why Real Databases Use Them](#b-trees-why-real-databases-use-them)
12. [Why Fanout = Block Size](#why-fanout--block-size)
13. [Code: Counting I/Os, B-Tree vs Binary Tree](#code-counting-ios-b-tree-vs-binary-tree)
14. [Why This Is the Most Important Data Structure in Storage](#why-this-is-the-most-important-data-structure-in-storage)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Here is a problem you'll meet the instant your data outgrows memory: you have a billion keys — user IDs, timestamps, order numbers — and you need to answer lookups (*is key `K` present, and where?*) and range queries (*give me every key between `A` and `B`*) **fast**, but the keys live on disk, not in RAM. The textbook answer for ordered lookups in memory is a balanced **binary search tree**: `Θ(log₂ N)` comparisons, each one halving the range. For a billion keys that's about 30 comparisons — instant in RAM.

Move that same tree to disk and it falls apart. The reason is the one lesson from [the I/O model](../01-the-io-model/junior.md): on disk, the cost isn't the *comparison*, it's the *block transfer*. A binary tree node holds one key and two child pointers, and each node sits in its own block somewhere on the disk. Walking down the tree means visiting one node per level — and each node visit is a fresh **random I/O**. So a binary tree lookup costs `Θ(log₂ N)` *I/Os*: about **30 disk seeks** for a billion keys, which at ~10 ms per seek is **0.3 seconds for a single lookup**. A database serving thousands of lookups a second cannot survive that. The structure that's perfect in RAM is catastrophic on disk.

The **B-tree** is the fix, and it's one of the most consequential data structures ever designed (Bayer & McCreight, 1972). The idea is deceptively simple: stop making nodes that hold one key. Make each node hold about `B` keys — *exactly enough to fill one disk block* — so that **one I/O brings in a whole node**. A node packed with `B` keys has `B+1` children, so the tree branches `B`-ways instead of 2-ways, and its height collapses from `log₂ N` to `log_B N`. Because `B` is large — hundreds to thousands of keys per block — that height is *tiny*: a billion keys live in a B-tree only **3 to 5 levels deep**. One I/O per level means a lookup costs 3 to 5 I/Os instead of 30. That is the entire reason every relational database index, every filesystem directory structure, and every key-value store's on-disk index is a B-tree (or its refinement, the B⁺-tree).

This file is about the **I/O cost analysis** of the B-tree — *why* it is the I/O-optimal search structure — not about re-deriving every mechanical detail of the structure itself (the splits, merges, and rotations live in [the B-tree data-structure topic](../../09-trees/11-b-tree/junior.md)). We'll start from the binary-tree-on-disk disaster, see the B-tree fix (fat nodes sized to one block), build the `height = log_B N` intuition, then *drive it home with numbers*: a worked billion-key example and a table over different block sizes showing the height shrink. We'll draw a small B-tree and watch a search touch exactly one node per level — one I/O per level. We'll state the full set of I/O bounds (search, insert, delete, and the range-query bound `log_B N + K/B`), sketch the B⁺-tree variant that real databases actually use, and explain *why* the fanout should equal the block size. Finally, runnable code builds a B-tree and a binary search tree over the same keys, **counts the I/Os each one spends per search**, and shows the B-tree's count equal to its height ≈ `log_B N` while the binary tree's balloons to `log₂ N`.

---

## Prerequisites

- **Required:** The I/O model basics — what `N`, `M`, `B` mean, and that cost is **block transfers**, not operations. See [The I/O Model](../01-the-io-model/junior.md). In particular you need the searching bound `Θ(log_B N)` and the scanning bound `scan(N) = Θ(N/B)` — this file *is* the careful version of the searching bound.
- **Required:** Familiarity with binary search trees — what a node is, what "balanced" means, and that lookup walks one path from root to leaf in `Θ(log₂ N)` steps. The disk-friendly cousin we build here is a direct generalization.
- **Required:** What `log_b N` means for a *varying base* `b`, and the basic fact that `log_b N = (log₂ N) / (log₂ b)` — i.e. a bigger base means a smaller logarithm. The whole story is "the base changes from 2 to `B`."
- **Helpful:** A rough mental picture of the B-tree's mechanics (nodes hold many keys; insert may *split* a full node; delete may *merge*). The full treatment is in [B-Tree (the data structure)](../../09-trees/11-b-tree/junior.md); here we only need that one node = one block and the tree stays balanced.
- **Helpful:** Having read [External Sorting](../03-external-sorting/junior.md), which uses the same "make the log base large" lesson for sorting. B-trees apply it to searching.

No probability, no heavy proofs — every I/O cost here is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **B-tree** | A balanced search tree whose nodes each hold ~`B` keys (sized to one block), giving fanout ~`B` and height `Θ(log_B N)`. |
| **B⁺-tree** | A B-tree variant where *all data lives in the leaves* and leaves are chained in a linked list; internal nodes hold only keys + child pointers. What real databases use. |
| **Node = block** | The defining choice: each B-tree node fills exactly one disk block, so loading a node costs exactly **one I/O**. |
| **Fanout (branching factor)** | How many children a node has. In a B-tree it's ~`B+1` — one more than the number of keys in the node. |
| **Height** | Number of levels from root to leaf. A search descends the height, paying one I/O per level. B-tree height ≈ `log_B N`. |
| **`N`** | The number of keys stored in the index. |
| **`B`** | Block size — keys per block (also the fanout). Large: hundreds to thousands. |
| **`K`** | The number of results returned by a range query (the *output* size). |
| **`log_B N`** | The B-tree's height (up to constants) — the searching bound, with base `B` instead of `2`. |
| **Random I/O** | A transfer to a scattered block — what each node visit in a disk tree is. The thing we minimize. |
| **Range query** | Return all keys in `[A, B]`. Costs `Θ(log_B N + K/B)` I/Os in a B⁺-tree (find the start, then scan leaves). |
| **Split / merge** | Insert overflowing a full node *splits* it in two; delete underflowing a node *merges* it — how the tree stays balanced. (Details in the structure topic.) |

---

## The Question: An Ordered Index Too Big for RAM

Pin the problem down precisely, because every design choice falls out of it.

- You have `N` keys to index — say a billion of them — and they're **too big for fast memory** (`M`). Most of the index lives on **disk**; to touch any node you must first read its block into memory, at a cost of **one I/O per block**, exactly as [the I/O model](../01-the-io-model/junior.md) describes.
- The index must stay **ordered**, because you need two kinds of query:
  1. **Point lookup:** is key `K` present, and where is its record? (A database `WHERE id = K`.)
  2. **Range query:** return every key in `[A, B]` — there might be `K` of them. (A database `WHERE ts BETWEEN A AND B`.)
- The cost you're minimizing is the **number of I/Os** — block transfers. In-memory work (comparing keys inside a loaded node) is **free** by comparison.

A hash index would handle point lookups, but it *shatters* range queries — hashing destroys order, so "all keys between `A` and `B`" becomes a full scan. We need an **ordered** structure. In RAM that's a balanced binary search tree. The whole question of this file is: **what is the right ordered structure on disk, and what does it cost in I/Os?** The binary tree is the obvious candidate. Let's watch it fail, and see exactly why.

---

## The Binary-Tree-on-Disk Disaster

Take a perfectly balanced binary search tree — a red-black tree, an AVL tree, whatever — and put it on disk. Each node holds **one key** and **two child pointers** (left and right). To look up a key, you start at the root and walk down: compare, go left or right, compare, go left or right, until you hit the key or a leaf. The path length is the tree's height, `log₂ N` — and that's wonderful in RAM, where every comparison is essentially free.

Now count *I/Os*, not comparisons. Each node lives in its own block on disk, and consecutive nodes on the root-to-leaf path are scattered all over that disk — the root might be at block 5,000,000, its child at block 12, its grandchild at block 9,800,000. So **every step down the tree is a fresh random I/O**: you must fetch the block holding the next node before you can even read its key. The lookup therefore costs:

```
binary search tree on disk:  Θ(log₂ N) I/Os   (one random I/O per level)
```

Put the billion-key number on it. `log₂(10⁹) ≈ 30`, so a single lookup is about **30 random disk seeks**. At ~10 ms per seek (a spinning disk), that's `30 × 10 ms = 0.3 seconds` — *for one lookup*. A database fielding 10,000 lookups a second would need 3,000 seconds of disk time per second of wall clock. Impossible. Even on an SSD (~100 µs per random read), 30 seeks is ~3 ms per lookup — still 10–30× worse than it needs to be, and a brutal throughput ceiling.

The deeper problem is **wasted bandwidth per I/O**. When you pay one I/O to fetch a binary node's block, that block could hold thousands of keys' worth of data — but you read *one key* out of it and throw the rest of the block away. You're paying the full price of a block transfer to extract a single key and a single bit of decision (left or right). The block is ~99.9% wasted. That's the diagnosis, and it points straight at the cure:

> **The disaster in one sentence:** a binary tree visits `log₂ N` nodes, each node visit is a random I/O, and each I/O reads a whole block but uses only *one key* of it — so you pay `log₂ N` full block transfers to make `log₂ N` one-bit decisions. The block is almost entirely wasted. Fix that waste and you fix the structure.

---

## The B-Tree Fix: Fat Nodes = One Block

The waste is the clue. Each I/O hauls in a whole block — `B` keys' worth of space — but a binary node uses only one key of it. So **fill the block.** Instead of a node with 1 key and 2 children, make a node with about `B` keys and `B+1` children, packed to fill one entire block. This is the **B-tree** (Bayer & McCreight, 1972).

A B-tree node is an *array* of sorted keys with child pointers between and around them:

```
A binary node (1 key, 2 children):        A B-tree node (B keys, B+1 children):

         [ 42 ]                    [ k1 | k2 | k3 | ... | kB ]
        /      \                  /    |    |    |          \
     <42        >42             c0    c1   c2   c3    ...    cB
                              (<k1) (k1..k2) ...        (>kB)

  one key per I/O                B keys + B+1 child pointers per I/O
  → block 99.9% wasted          → block FULL, one I/O does B-way branching
```

Now the payoff. **One I/O loads an entire node** — all `B` keys at once. Inside that node (now in fast memory, so working on it is *free*), you do an ordinary search among the `B` sorted keys to decide which of the `B+1` children to descend into. So a single block transfer lets you make a **`B`-way branching decision**, not a 2-way one. You've turned each expensive I/O from "decide left-or-right" into "decide which of `B+1` subtrees" — you extract `log₂(B+1)` bits of decision per I/O instead of 1 bit, and you *use the whole block you paid for*.

The structure stays balanced the same way the binary tree does — by enforcing that every node (except possibly the root) stays at least half-full, splitting a node that overflows on insert and merging a node that underflows on delete. Those mechanics keep the height at `Θ(log_B N)` and keep every leaf at the same depth; the splits-and-merges details are the subject of [the B-tree structure topic](../../09-trees/11-b-tree/junior.md) and we won't re-derive them here. The one fact we need is: **node = block, fanout ≈ B, balanced.** Everything about the I/O cost flows from that single design choice.

> **The fix in one sentence:** make each node fill one block so every I/O brings in `B` keys and buys you a `B`-way branch instead of a 2-way one. Same path-walking algorithm as a binary tree — but the tree is `log₂ B` times shorter, because the branching factor went from 2 to `B`.

---

## Height = log_B N: The Whole Point

Why does fanout `B` make the tree short? Count how many keys a B-tree of a given height can hold. A binary tree of height `h` holds up to `2^h` keys, because each level multiplies the node count by 2. A B-tree with fanout `B` multiplies the node count by `B` at each level, so a height-`h` B-tree holds roughly:

```
keys in a B-tree of height h  ≈  B^h
```

Turn that around to solve for the height needed to hold `N` keys:

```
B^h ≈ N    ⟹    h ≈ log_B N      ← the B-tree height
```

Compare the two trees side by side. The *only* difference is the base of the logarithm:

```
binary search tree height  ≈  log₂ N     (each level branches 2 ways)
B-tree height              ≈  log_B N     (each level branches B ways)

and the search cost (one I/O per level) is exactly the height:

  search(binary tree on disk) = Θ(log₂ N) I/Os
  search(B-tree)              = Θ(log_B N) I/Os
```

Because `log_B N = (log₂ N) / (log₂ B)`, switching from base 2 to base `B` divides the height by `log₂ B`. With `B = 1000`, `log₂ B ≈ 10`, so the B-tree is roughly **10× shorter** than the binary tree — and since each level costs one I/O, the lookup is ~10× cheaper. That factor of `log₂ B` is exactly the "wasted bandwidth" you recovered by filling the block.

> **The key idea:** in the I/O world, the *base* of the logarithm is load-bearing. `log₂ N` and `log_B N` are both "logarithmic" and the RAM model treats them as interchangeable (they differ only by a constant factor in *operation* counts). But in *I/Os*, that constant factor **is** `log₂ B` — often a factor of 10 — and it's the difference between a usable index (3 seeks) and an unusable one (30 seeks). This is the same lesson as external sort's `log_{M/B}` and the I/O model's searching bound: **make the log base big.**

---

## The Worked 1-Billion-Key Numbers

Abstractions slide off the mind; numbers stick. Take `N = 10⁹` keys — a billion — and compute the height for a few block sizes. (Height here means "I/Os per lookup," because one I/O loads one node per level.)

A binary tree, for reference: `log₂(10⁹) ≈ 30`, so **~30 I/Os per lookup.** Now the B-tree, varying `B`:

| Block holds `B` keys | Height ≈ `log_B(10⁹)` | I/Os per lookup | vs binary tree (~30) |
|----------------------|------------------------|-----------------|----------------------|
| `B = 2` (a binary tree!) | `log₂(10⁹) ≈ 30` | ~30 | 1× (this *is* the binary tree) |
| `B = 10` | `log₁₀(10⁹) = 9` | 9 | ~3× fewer |
| `B = 100` | `log₁₀₀(10⁹) = 4.5` | **~5** | ~6× fewer |
| `B = 256` | `log₂₅₆(10⁹) ≈ 3.7` | ~4 | ~8× fewer |
| `B = 1000` | `log₁₀₀₀(10⁹) = 3` | **3** | ~10× fewer |
| `B = 10000` | `log₁₀₀₀₀(10⁹) = 2.25` | ~3 | ~10× fewer |

Read the table top to bottom and watch the height **collapse** as `B` grows. With a modest `B = 100` keys per block, a billion-key lookup is about **5 I/Os**. With `B = 1000`, it's **3 I/Os**. Either way, instead of ~30 random seeks you do a *handful* — a 6× to 10× reduction in lookup latency, purely from sizing the node to the block.

Two things about this table are worth sitting with:

1. **`B = 2` *is* the binary tree.** A B-tree with two keys per node branches 2-ways and has height `log₂ N` — identical to a binary tree. The B-tree isn't a different *algorithm*; it's the same path-walking search with the branching factor turned up. Crank `B` from 2 to 1000 and the same structure goes from 30 I/Os to 3.

2. **The height barely moves once `B` is large.** Going from `B = 1000` to `B = 10000` only drops the height from 3 to ~2.25. The logarithm flattens hard. This is why real B-trees are **always 3 to 5 levels deep** for any realistic data size — and why they *stay* shallow even as `N` grows into the trillions. To make a `B = 1000` tree four levels deep you'd need `1000⁴ = 10¹²` keys — a *trillion*. Five levels holds a *quadrillion*. The B-tree essentially never gets tall.

> **The number to carry away:** with a block holding `B = 100`–`1000` keys, **any lookup in a billion-key index is 3–5 I/Os.** That is the single fact that made B-trees the foundation of every database and filesystem on Earth. Shallow tree, one I/O per level, done in a handful of seeks.

---

## A Drawn B-Tree: One Node per Level = One I/O per Level

Let's make "one I/O per level" visible with a tiny B-tree (here each node holds up to 4 keys, so fanout up to 5 — `B` is small only so it fits on the page; imagine `B = 1000`). Suppose we search for the key **57**:

```
LEVEL 0 (root)     ┌───────────────────┐
   1 I/O           │   20  |  50  |  80 │          ← read this whole node (1 block)
                   └───┬──────┬──────┬──┬┘            57 > 50 and 57 < 80 → go to child between 50 and 80
                       │      │      │  │
        ┌──────────────┘   ┌──┘    ┌─┘  └──────────┐
        ▼                  ▼       ▼               ▼
LEVEL 1 ┌────────┐  ┌────────┐  ┌──────────┐  ┌────────┐
 1 I/O  │ 5 | 12 │  │ 30│ 42 │  │ 55 | 65   │  │ 85│ 92 │   ← read ONE of these (the 50..80 child)
        └────────┘  └────────┘  └──┬─────┬──┘  └────────┘     57 > 55 and 57 < 65 → go to child between 55 and 65
                                   │     │
                       ┌───────────┘     └─────────┐
                       ▼                           ▼
LEVEL 2 (leaf)  ┌──────────────┐            ┌──────────────┐
 1 I/O          │ 56 | 57 | 60 │  ...       │ 70 | 75 | 78 │   ← read ONE leaf, find 57. FOUND.
                └──────────────┘            └──────────────┘
```

Trace the path: at each level you read **exactly one node** (one block, one I/O), search its handful of keys *in memory for free*, and follow the right child pointer down. The search touches the root (1 I/O), one level-1 node (1 I/O), and one leaf (1 I/O): **3 nodes, 3 I/Os, for a 3-level tree.** The sibling nodes at each level — the ones you *didn't* descend into — are never read; you pay nothing for them.

That's the whole mechanism, and it's why the bound is so clean. The search cost is **exactly the height**, because the path from root to leaf visits one node per level and each node costs one I/O. No backtracking, no revisiting — a single straight descent. With `B = 1000` and a billion keys, that drawing would be just 3 levels tall too, and your search for `57` (or any key) would be 3 I/Os. The picture is the proof:

```
search cost = number of nodes on the root-to-leaf path = height = Θ(log_B N) I/Os
```

---

## The I/O Bounds: Search, Insert, Delete, Range

Now state the full set of I/O costs — the heart of this topic. All of them flow from the same fact: **a B-tree operation walks one root-to-leaf path of length `Θ(log_B N)`, one I/O per level.**

**Search — `Θ(log_B N)` I/Os.** Exactly the descent we just drew: one node per level, one I/O per node, height many levels. This is the searching bound from [the I/O model](../01-the-io-model/junior.md), now derived.

**Insert — `Θ(log_B N)` I/Os.** Walk down to the correct leaf (`log_B N` I/Os), insert the key there. If the leaf is now over-full, it **splits** into two and pushes a key up to its parent — which may overflow and split in turn, possibly cascading back up the path you just descended. But the cascade follows the *same path*, so in the worst case you touch `Θ(log_B N)` nodes going down and `Θ(log_B N)` coming back up — still `Θ(log_B N)` I/Os. (Splits are rare in practice, so the *typical* cost is just the descent plus writing one leaf.)

**Delete — `Θ(log_B N)` I/Os.** Symmetric to insert. Walk down to the key (`log_B N` I/Os), remove it. If the node underflows (drops below half-full), it **borrows** from a sibling or **merges** with one, which may cascade up the path. Same path, so `Θ(log_B N)` I/Os.

**Range query returning `K` results — `Θ(log_B N + K/B)` I/Os.** This is the bound that makes B-trees shine for ordered data, and it has two pieces:

- `log_B N` — descend from the root to the *first* key ≥ `A` (the start of the range). That's an ordinary search.
- `K/B` — then **scan forward** through the keys in order until you pass `B`, emitting all `K` of them. Because the keys come out in sorted order and (in a B⁺-tree, below) the leaves are stored contiguously and chained, this forward scan is *sequential*: it reads `K` results in `K/B` block transfers — the optimal `scan(K)` cost.

```
SEARCH   Θ(log_B N)          ← one root-to-leaf descent
INSERT   Θ(log_B N)          ← descend, insert, maybe split up the path
DELETE   Θ(log_B N)          ← descend, remove, maybe merge up the path
RANGE    Θ(log_B N + K/B)    ← find the start (log_B N), then scan K results (K/B)
```

Compare every one of these to the binary tree's `Θ(log₂ N)` — base 2, ~10× more I/Os. And note the range bound especially: `log_B N + K/B` is essentially **optimal**, because you *must* spend `K/B` I/Os just to *output* `K` results (each block holds `B` of them — that's the `scan(N)=Θ(N/B)` floor from the I/O model), and the `log_B N` to find where to start is as cheap as a point lookup. You cannot do asymptotically better. That's what "I/O-optimal search structure" means.

> **All four bounds, one idea:** every B-tree operation is a single walk along a root-to-leaf path of length `Θ(log_B N)`, paying one I/O per level — plus, for a range query, a sequential `K/B` scan to emit the results. The base-`B` logarithm (3–5 for real data) makes the descent cheap; the `K/B` term makes range output optimal. There is no cheaper ordered index.

---

## B⁺-Trees: Why Real Databases Use Them

The B-tree as described stores keys (and the records they point to) in *every* node, internal and leaf alike. Real databases use a refinement — the **B⁺-tree** — that makes range scans even better. The difference is small but consequential:

- **Internal nodes hold only keys and child pointers** — no records. They exist purely to *route* a search to the right leaf. Because they carry no data payload, even more keys fit per block, so the fanout is *higher* and the tree is *even shallower*.
- **All data lives in the leaves.** Every actual key (and its record or record-pointer) sits in a leaf node. A key may appear *twice* — once as a router in an internal node, once for real in a leaf — but that tiny redundancy buys a big win.
- **Leaves are chained in a linked list.** Each leaf points to the next leaf in key order. So once you've found the first leaf of a range, you follow leaf-to-leaf pointers straight through the range — **no going back up into the tree.**

```
            ┌──────── 50 ────────┐                internal nodes: keys only (routers)
            ▼                     ▼                tree is short and bushy
     ┌── 20 ── 35 ──┐      ┌── 70 ── 85 ──┐
     ▼      ▼       ▼      ▼      ▼       ▼
   [10 15][20 28][35 42]→[50 65][70 78][85 99]    ALL data in leaves,
     └──────└──────└────────└──────└──────┘        leaves CHAINED left→right (a sorted linked list)
                  range query [28, 78]:
                  descend to leaf with 28 (log_B N I/Os),
                  then walk the leaf chain → 28,35,42,50,65,70,78  (sequential, K/B I/Os)
```

This is why the range bound `Θ(log_B N + K/B)` is *truly sequential* in a B⁺-tree: the `K` results live in physically (or logically) contiguous, linked leaves, so scanning them is a sequential sweep at `K/B` I/Os — the cheapest possible. A plain B-tree, by contrast, would have to do an in-order traversal that bounces up and down between internal nodes and leaves, scattering its I/Os. The B⁺-tree's separation — *routers up top, data in chained leaves* — is exactly the structure that turns "range query" into "find the start, then scan a sorted list."

That combination — shallower tree (higher fanout, no payload in internal nodes) *plus* sequential range scans (chained leaves) — is why **essentially every relational database (PostgreSQL, MySQL/InnoDB, SQL Server, Oracle) and many filesystems index with B⁺-trees**, not plain B-trees. When this section says "B-tree," the production reality is almost always a B⁺-tree. The full structural mechanics live in [the B-tree topic](../../09-trees/11-b-tree/junior.md); for the I/O *analysis*, the one thing to remember is: **B⁺-tree leaves are a sorted linked list, so range queries are find-then-scan at `log_B N + K/B`.**

---

## Why Fanout = Block Size

We've said "make each node fill one block" several times. Let's say *why* that exact size — not smaller, not bigger — is the right choice. It's a Goldilocks argument with two pressures.

**Too small a node (fanout below `B`) wastes the I/O you already paid for.** Every node access costs *one full I/O* whether the node holds 1 key or 1000 — the block transfer is the unit of cost, and you pay for the whole block regardless of how full it is. So if your node holds only 10 keys when the block could hold 1000, you fetched a block and used 1% of it: you got a 10-way branch out of an I/O that could have given you a 1000-way branch. Your tree is `log₁₀ N` tall instead of `log₁₀₀₀ N` — three times taller, three times more I/Os per lookup. **Underfilling the block throws away branching factor you already paid the I/O for.**

**Too big a node (fanout above `B`) means a node spans multiple blocks, so one node visit costs multiple I/Os.** If you cram 5000 keys into a node when a block holds 1000, that node occupies 5 blocks — and reading it costs 5 I/Os instead of 1. You've reduced the *number of levels* but multiplied the *cost per level*, and it's a wash at best (and worse once you account for reading parts of a node you don't need). **Overfilling past a block buys fewer levels but pays multiple I/Os per level.**

The sweet spot is therefore **fanout = exactly one block's worth of keys**: each node visit is precisely one I/O (one block), and that single I/O buys the largest branching factor a single transfer can deliver. You're maximizing the branching-per-I/O — extracting the most decision out of every block you fetch — which is the I/O model's governing principle (*maximize useful work per transfer*) applied to search trees.

```
fanout < B :  node smaller than a block → 1 I/O per node, but wasted branching → taller tree
fanout = B :  node = one block          → 1 I/O per node, MAXIMUM branching     → shortest tree   ✓
fanout > B :  node bigger than a block  → MULTIPLE I/Os per node                → no net win
```

> **Why block-sized is optimal:** an I/O moves a whole block no matter what, so you want each node to *be* a block — fully used, never split across two. That makes every node visit exactly one I/O while delivering the biggest possible fanout, which makes the tree as short as a single-I/O-per-level structure can be. Block-aligned, fully-packed, shallow: that's the B-tree, and it's why "fanout = block size" is not a tuning knob but the *definition* of the optimum.

---

## Code: Counting I/Os, B-Tree vs Binary Tree

Theory is convincing; *counting the I/Os* makes it undeniable. Below we build a simple B-tree and a binary search tree over the **same** keys, then count the number of node-fetches (= I/Os) each one spends per search. The B-tree's count will equal its height ≈ `log_B N`; the binary tree's will equal `log₂ N` — and the ratio will be the `log₂ B` we predicted.

We don't re-implement all the splitting machinery (that's the structure topic's job); instead we *simulate* the cost faithfully: build a balanced multi-way tree where each node holds up to `B` keys, and on each search **count one I/O per node touched on the root-to-leaf path.**

### Python

```python
import math
import bisect
import random


class BTreeSim:
    """A balanced B-tree simulation: each node holds up to B keys (fanout B+1).
    We build it bulk-loaded and balanced, then COUNT one I/O per node visited
    on a root-to-leaf search path — exactly the I/O-model cost measure."""

    class Node:
        __slots__ = ("keys", "children")
        def __init__(self):
            self.keys = []          # sorted keys living in this node (one block)
            self.children = []      # child nodes (empty if this is a leaf)

    def __init__(self, sorted_keys, B):
        self.B = B
        self.ios = 0
        self.root = self._build(sorted_keys, B)

    def _build(self, keys, B):
        """Bulk-build a balanced B-tree: chunk the sorted keys into leaves of
        ~B keys, then build router levels above until one root remains."""
        # Leaves: split sorted keys into groups of B.
        level = []
        for i in range(0, len(keys), B):
            node = self.Node()
            node.keys = keys[i:i + B]
            level.append(node)
        if not level:
            return self.Node()
        # Build internal levels: every B+1 children get one parent whose keys
        # are the separators (first key of each child after the first).
        while len(level) > 1:
            parent_level = []
            for i in range(0, len(level), B + 1):
                group = level[i:i + B + 1]
                parent = self.Node()
                parent.children = group
                # separators = smallest key of each child except the first
                parent.keys = [child_min(c) for c in group[1:]]
                parent_level.append(parent)
            level = parent_level
        return level[0]

    def search(self, key):
        """Descend root→leaf, charging ONE I/O per node visited."""
        node = self.root
        while True:
            self.ios += 1                       # fetch this node = 1 I/O
            if not node.children:               # leaf: the key is here or absent
                return key in node.keys
            # internal: pick the child to descend into (free, in-memory)
            i = bisect.bisect_right(node.keys, key)
            node = node.children[i]

    def height(self):
        h, node = 1, self.root
        while node.children:
            h += 1
            node = node.children[0]
        return h


class BSTSim:
    """A balanced binary search tree (built from sorted keys), counting one I/O
    per node visited — the disk-resident binary-tree cost."""

    class Node:
        __slots__ = ("key", "left", "right")
        def __init__(self, key):
            self.key, self.left, self.right = key, None, None

    def __init__(self, sorted_keys):
        self.ios = 0
        self.root = self._build(sorted_keys, 0, len(sorted_keys) - 1)

    def _build(self, keys, lo, hi):
        if lo > hi:
            return None
        mid = (lo + hi) // 2                     # middle key → balanced tree
        node = self.Node(keys[mid])
        node.left = self._build(keys, lo, mid - 1)
        node.right = self._build(keys, mid + 1, hi)
        return node

    def search(self, key):
        node = self.root
        while node:
            self.ios += 1                        # fetch this node = 1 I/O
            if key == node.key:
                return True
            node = node.left if key < node.key else node.right
        return False


def child_min(node):
    """Smallest key in a subtree (for building router separators)."""
    while node.children:
        node = node.children[0]
    return node.keys[0]


if __name__ == "__main__":
    N = 1_000_000
    keys = list(range(N))                        # sorted keys 0..N-1
    queries = [random.randrange(N) for _ in range(200)]

    for B in (10, 100, 1000):
        bt = BTreeSim(keys, B)
        # average I/Os per B-tree search
        bt.ios = 0
        for q in queries:
            bt.search(q)
        bt_avg = bt.ios / len(queries)

        bst = BSTSim(keys)
        bst.ios = 0
        for q in queries:
            bst.search(q)
        bst_avg = bst.ios / len(queries)

        print(f"B={B:>4}:  B-tree {bt_avg:4.1f} I/Os/search "
              f"(height {bt.height()}, log_B(N)={math.log(N, B):.1f})   "
              f"|  binary tree {bst_avg:4.1f} I/Os/search "
              f"(log2(N)={math.log2(N):.1f})   "
              f"|  B-tree is {bst_avg / bt_avg:.0f}x cheaper")
```

Running it prints something close to:

```
B=  10:  B-tree  6.0 I/Os/search (height 6, log_B(N)=6.0)   |  binary tree 19.9 I/Os/search (log2(N)=20.0)   |  B-tree is 3x cheaper
B= 100:  B-tree  3.0 I/Os/search (height 3, log_B(N)=3.0)   |  binary tree 19.9 I/Os/search (log2(N)=20.0)   |  B-tree is 7x cheaper
B=1000:  B-tree  2.0 I/Os/search (height 2, log_B(N)=2.0)   |  binary tree 19.9 I/Os/search (log2(N)=20.0)   |  B-tree is 10x cheaper
```

The numbers fall straight out of the theory. The B-tree's I/Os per search **equal its height**, which equals `log_B N` — and as `B` grows from 10 to 1000, that height shrinks from 6 to 2. The binary tree's count sits at ~`log₂(10⁶) ≈ 20` no matter what (it never had a `B` to tune). The ratio between them is exactly the `log₂ B` factor — `B`-trees buy back the wasted block bandwidth. **The I/O counter is the proof: same keys, same searches, but the B-tree pays the height in I/Os while the binary tree pays `log₂ N`.**

### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
)

// btNode is one B-tree node = one block: up to B keys, up to B+1 children.
type btNode struct {
	keys     []int
	children []*btNode
}

func (n *btNode) leaf() bool { return len(n.children) == 0 }

// minKey returns the smallest key in a subtree (for router separators).
func minKey(n *btNode) int {
	for !n.leaf() {
		n = n.children[0]
	}
	return n.keys[0]
}

// buildBTree bulk-loads a balanced B-tree from sorted keys.
func buildBTree(keys []int, B int) *btNode {
	var level []*btNode
	for i := 0; i < len(keys); i += B { // leaves: chunks of B keys
		end := i + B
		if end > len(keys) {
			end = len(keys)
		}
		level = append(level, &btNode{keys: keys[i:end]})
	}
	if len(level) == 0 {
		return &btNode{}
	}
	for len(level) > 1 { // build router levels until one root remains
		var parents []*btNode
		for i := 0; i < len(level); i += B + 1 {
			end := i + B + 1
			if end > len(level) {
				end = len(level)
			}
			group := level[i:end]
			p := &btNode{children: group}
			for _, c := range group[1:] { // separators = min of each child after the first
				p.keys = append(p.keys, minKey(c))
			}
			parents = append(parents, p)
		}
		level = parents
	}
	return level[0]
}

// btSearch descends root→leaf, returning the number of I/Os (nodes visited).
func btSearch(root *btNode, key int) int {
	ios, n := 0, root
	for {
		ios++ // fetch this node = 1 I/O
		if n.leaf() {
			return ios
		}
		i := sort.SearchInts(n.keys, key+1) // child index (in-memory, free)
		n = n.children[i]
	}
}

func btHeight(root *btNode) int {
	h, n := 1, root
	for !n.leaf() {
		h++
		n = n.children[0]
	}
	return h
}

// --- balanced binary search tree, counting I/Os per node visited ---
type bstNode struct {
	key         int
	left, right *bstNode
}

func buildBST(keys []int) *bstNode {
	if len(keys) == 0 {
		return nil
	}
	mid := len(keys) / 2
	return &bstNode{
		key:   keys[mid],
		left:  buildBST(keys[:mid]),
		right: buildBST(keys[mid+1:]),
	}
}

func bstSearch(root *bstNode, key int) int {
	ios, n := 0, root
	for n != nil {
		ios++ // fetch this node = 1 I/O
		if key == n.key {
			return ios
		}
		if key < n.key {
			n = n.left
		} else {
			n = n.right
		}
	}
	return ios
}

func main() {
	N := 1_000_000
	keys := make([]int, N)
	for i := range keys {
		keys[i] = i
	}
	queries := make([]int, 200)
	for i := range queries {
		queries[i] = rand.Intn(N)
	}
	bst := buildBST(keys)

	for _, B := range []int{10, 100, 1000} {
		bt := buildBTree(keys, B)
		var btTotal, bstTotal int
		for _, q := range queries {
			btTotal += btSearch(bt, q)
			bstTotal += bstSearch(bst, q)
		}
		btAvg := float64(btTotal) / float64(len(queries))
		bstAvg := float64(bstTotal) / float64(len(queries))
		fmt.Printf("B=%4d:  B-tree %4.1f I/Os/search (height %d, log_B(N)=%.1f)   "+
			"|  binary tree %4.1f I/Os/search (log2(N)=%.1f)   |  B-tree is %.0fx cheaper\n",
			B, btAvg, btHeight(bt), math.Log(float64(N))/math.Log(float64(B)),
			bstAvg, math.Log2(float64(N)), bstAvg/btAvg)
	}
}
```

**What both versions show:** build the *same* million keys two ways, then count the I/Os (node visits on the root-to-leaf path) each search costs. The B-tree's count equals its height equals `log_B N` — 6 I/Os at `B=10`, dropping to 2 at `B=1000` — while the binary tree stubbornly spends ~20 (`log₂ N`) regardless. The in-memory work *inside* each node (picking the child) is free, exactly as the I/O model prescribes; only node fetches are charged. The flat ~20 for the binary tree versus the shrinking 6→2 for the B-tree, over identical data, *is* the base-2-versus-base-`B` story made into a measurement.

---

## Why This Is the Most Important Data Structure in Storage

The B-tree (in its B⁺-tree form) is, with little exaggeration, the most important data structure in all of storage systems. Wherever data is ordered, indexed, and too big for RAM, a B-tree is doing the work. Here's where it lives and exactly what its I/O bounds buy:

| System | What the B-tree indexes | What the I/O analysis buys |
|--------|--------------------------|-----------------------------|
| **Relational databases** (PostgreSQL, MySQL/InnoDB, Oracle, SQL Server) | Every `PRIMARY KEY` and `CREATE INDEX` is a B⁺-tree. | `WHERE id = K` is a `log_B N` lookup (3–5 I/Os); `WHERE ts BETWEEN A AND B` is `log_B N + K/B` (find start, scan chained leaves); `ORDER BY` on an indexed column needs no sort. |
| **Filesystems** (NTFS, HFS+, ext4 htree, XFS, Btrfs) | Directory entries, file extents, metadata — all B-tree indexed. | Looking up a filename in a huge directory, or a file's block map, is `log_B N` I/Os instead of a linear scan. |
| **Key-value stores** | Some (e.g. BoltDB, LMDB, older BerkeleyDB) are B⁺-tree engines; LSM stores keep B-trees in their index blocks. | Ordered point + range queries on disk at `log_B N` and `log_B N + K/B`. |
| **Spatial / multi-dimensional** (R-trees, B-tree variants) | Geographic and geometric ranges. | The same fat-node, shallow-tree principle generalized to boxes and regions. |

The throughline is always the same demand: **keep an ordered index searchable when it doesn't fit in RAM, at the smallest possible number of I/Os.** The B-tree answers it optimally — `log_B N` for point queries (a *handful* of seeks at any scale), `log_B N + K/B` for range queries (which is provably the best possible, since you must spend `K/B` just to output `K` results). No other ordered structure beats it on disk. That's what "I/O-optimal search structure" means, and it's why a 50-year-old idea still sits under every database query you run.

And there's a sequel worth knowing. The B-tree updates its nodes *in place* on disk, which can mean random writes when many small updates scatter across the tree. Write-heavy systems sometimes prefer the **LSM-tree** (log-structured merge tree), which batches writes into memory and flushes them *sequentially*, trading some read cost for much cheaper writes — and which leans on [external sorting](../03-external-sorting/junior.md) to merge its sorted runs. The B-tree (read-optimized, in-place) and the LSM-tree (write-optimized, append-only) are the two great families of on-disk ordered indexes, and both are pure I/O-model thinking: minimize and sequentialize the block transfers.

---

## Common Misconceptions

- **"A B-tree is a binary tree with extra steps."** No — a B-tree is a *multi-way* tree whose whole point is high fanout. A binary tree branches 2 ways and is `log₂ N` tall; a B-tree branches ~`B` ways and is `log_B N` tall — often **10× shorter**. The "B" stands for the big branching factor, not "binary." (A B-tree with `B=2` *would* be binary — and that's exactly the slow case.)

- **"`log_B N` and `log₂ N` are both logarithmic, so they're basically the same."** In *operation* counts, sure, they differ by a constant. But in *I/Os*, that constant **is** `log₂ B` — routinely a factor of 10. On disk, 30 I/Os and 3 I/Os are the difference between an unusable index and a great one. The base of the log is load-bearing.

- **"B-trees are tall because they hold so much data."** The opposite — they're famously *short*. A `B=1000` tree holds a billion keys in **3 levels**, a trillion in 4, a quadrillion in 5. High fanout means the tree barely grows taller as data explodes. Real B-trees are essentially always 3–5 levels deep.

- **"Hash indexes are always faster, so why bother with B-trees?"** Hashing gives `O(1)` *point* lookups but **destroys order**, so range queries (`BETWEEN`, `ORDER BY`, prefix scans) become full scans. B-trees keep keys ordered, paying `log_B N` for a point lookup but supporting `log_B N + K/B` range scans — which hashing simply cannot do. Different tools for different queries.

- **"The data structure topic and this topic are the same thing."** [The structure topic](../../09-trees/11-b-tree/junior.md) teaches the *mechanics* — splits, merges, rotations, the invariants. This topic is the *I/O cost analysis* — *why* node=block makes it the I/O-optimal search structure. Same object, two lenses: how it works vs. why it's the right shape for disk.

- **"Bigger `B` is always better, so make nodes enormous."** Only up to one block. Past that, a node spans multiple blocks and one node visit costs multiple I/Os — you stop saving levels and start paying per-block. The optimum is exactly `B = one block's worth of keys`: fully packed, never split across blocks.

---

## Common Mistakes

- **Putting a binary search tree (or sorted array + binary search) on disk.** Each node visit / each probe is a random I/O → `log₂ N` seeks per lookup (~30 for a billion keys). Use a B-tree so each I/O does `B`-way branching, not 2-way, cutting it to `log_B N` (~3).

- **Sizing nodes by element count instead of block size.** A node should hold *one block's worth* of keys, not "a nice round number like 16." Underfill and you waste branching you paid the I/O for; overfill past a block and one node costs several I/Os. Match the node to `B`.

- **Forgetting that the range bound has *two* terms.** A range query is `Θ(log_B N + K/B)`, not just `log_B N`. The `K/B` is the cost of *outputting* `K` results — unavoidable, and optimal. If your range scan is slow, check that it's actually scanning chained leaves sequentially (B⁺-tree), not bouncing around the tree.

- **Assuming a plain B-tree gives sequential range scans.** It's the **B⁺-tree** (data in chained leaves) that makes range scans sequential `K/B`. A plain B-tree's in-order traversal hops between internal nodes and leaves, scattering I/Os. Real databases use B⁺-trees for exactly this reason.

- **Ignoring `B` because "it's just a constant."** In ordinary Big-O you'd absorb `B` into the constant factor. In the I/O model `B` is the *whole point* — it's the base of the logarithm. Drop it and you've thrown away the entire reason B-trees beat binary trees.

- **Counting comparisons instead of I/Os.** A B-tree and a binary tree do *similar* comparison counts (both ~`log₂ N` comparisons total — the B-tree just does more *per node*, in memory, for free). What differs by 10× is the **I/O count**. Analyze transfers, not comparisons, or you'll conclude they're equivalent when they're not.

---

## Cheat Sheet

```
THE PROBLEM
  Keep an ORDERED index searchable when N keys don't fit in RAM (live on disk).
  Need: point lookup (id = K) AND range query (BETWEEN A AND B).
  Cost = block transfers (I/Os). In-node work = FREE.

THE BINARY-TREE-ON-DISK DISASTER
  Binary node = 1 key, 2 children, 1 block. One node visit = 1 random I/O.
  Search = Θ(log₂ N) I/Os. N=10⁹ → ~30 seeks → ~0.3 s/lookup. Catastrophic.
  Block ~99.9% wasted: pay a whole block to read ONE key.

THE B-TREE FIX
  Node = ~B keys + (B+1) children, sized to fill ONE block.
  One I/O loads a whole node → a B-WAY branch, not 2-way. Block fully used.
  Tree stays balanced (split on overflow, merge on underflow — see structure topic).

HEIGHT = log_B N  (the whole point)
  B-tree of height h holds ~B^h keys ⟹ height ≈ log_B N.
  Base goes 2 → B, so height divides by log₂ B (≈10 for B=1000).

THE I/O BOUNDS  (one root-to-leaf path, 1 I/O per level)
  SEARCH   Θ(log_B N)
  INSERT   Θ(log_B N)        (descend, insert, maybe split up the path)
  DELETE   Θ(log_B N)        (descend, remove, maybe merge up the path)
  RANGE    Θ(log_B N + K/B)  (find start, then SCAN K results — optimal output)
  vs binary tree: Θ(log₂ N) — ~10× more I/Os.

NUMBERS THAT STICK  (N = 1 billion keys)
  binary tree:  log₂(10⁹)    ≈ 30 I/Os
  B=100:        log₁₀₀(10⁹)  ≈  5 I/Os
  B=1000:       log₁₀₀₀(10⁹) =  3 I/Os
  → any billion-key lookup = 3–5 I/Os. Tree is ALWAYS 3–5 levels deep.

B⁺-TREE (what databases actually use)
  Internal nodes = routers (keys only) → higher fanout → even shorter.
  ALL data in leaves; leaves CHAINED (sorted linked list).
  → range scan is sequential leaf-walk: Θ(log_B N + K/B).

WHY FANOUT = BLOCK SIZE
  < block: 1 I/O/node but wasted branching → taller tree.
  = block: 1 I/O/node, MAX branching → shortest tree.   ✓
  > block: multiple I/Os per node → no win.

THE ONE BIG IDEA
  Fat nodes (one block each) turn log₂ N into log_B N. Big base = tiny height =
  a handful of I/Os per lookup. That's why every DB and filesystem is a B-tree.
```

---

## Summary

Keeping an *ordered* index searchable when it's too big for RAM is one of the foundational problems of storage systems, and the binary search tree — perfect in memory — is a disaster on disk. A binary node holds one key and two pointers in its own block, so a lookup visits `log₂ N` nodes, each a random I/O: **~30 disk seeks for a billion keys (~0.3 s per lookup)**, with each I/O reading a whole block but using only one key of it — ~99.9% waste. The cost on disk is the *transfer*, not the comparison, exactly as [the I/O model](../01-the-io-model/junior.md) warns.

- **The B-tree fixes the waste by filling the block.** Each node holds ~`B` keys (sized to one block) and has `B+1` children, so **one I/O loads a whole node and buys a `B`-way branch** instead of a 2-way one. It's the same root-to-leaf search as a binary tree, but the branching factor goes from 2 to `B`. The structure stays balanced via splits and merges (mechanics in [the structure topic](../../09-trees/11-b-tree/junior.md)); for the cost analysis, all that matters is **node = block, fanout ≈ B, one I/O per level.**

- **Height shrinks from `log₂ N` to `log_B N`** — and because `B` is large (hundreds to thousands), that height is *tiny*. For a billion keys: `B=100` gives height ~5, `B=1000` gives height **3**. The base of the logarithm is load-bearing — switching from 2 to `B` divides the height (and the I/O count) by `log₂ B`, routinely a factor of 10. Real B-trees are essentially always **3–5 levels deep**, and stay shallow into the trillions.

- **The I/O bounds are all one idea — a single root-to-leaf walk:** search, insert, and delete each cost `Θ(log_B N)` I/Os (one I/O per level, possibly cascading splits/merges up the same path); a range query returning `K` results costs `Θ(log_B N + K/B)` — find the start, then sequentially scan the results. That range bound is *optimal*, because outputting `K` results needs `K/B` transfers no matter what. There is no cheaper ordered index — which is what "I/O-optimal search structure" means.

- **B⁺-trees are what real databases use:** internal nodes hold only routing keys (no data → higher fanout → even shorter trees), all data lives in the leaves, and the leaves are chained in a sorted linked list — so range queries are a genuine sequential scan at `log_B N + K/B`. Every relational database and many filesystems index this way.

- **Fanout = block size is the optimum, not a knob:** smaller wastes branching you paid the I/O for; larger spans multiple blocks so a node visit costs multiple I/Os. Block-aligned, fully-packed, shallow — that's the definition of the I/O-optimal shape. The runnable code makes it measurable: building the same million keys as a B-tree and a binary tree, the B-tree spends exactly its height (≈ `log_B N`) in I/Os per search while the binary tree spends ~`log₂ N`, a 10× gap at `B=1000`.

The idea to carry forward: on disk, **fat nodes win**. Pack each node into one block so every I/O delivers the biggest branch it can, turn `log₂ N` into `log_B N`, and a billion-key lookup collapses from 30 seeks to 3. That single move is why the B-tree has sat under every database and filesystem for half a century.

**Next steps:** [the middle-level treatment](./middle.md) derives the height bound rigorously (with the minimum-degree invariant and the `2t−1`-keys-per-node analysis), works the amortized I/O cost of insert/delete splits and merges, and compares B-trees against LSM-trees for write-heavy workloads. For the structure's full mechanics — node splitting, merging, the balance invariants — see [B-Tree (the data structure)](../../09-trees/11-b-tree/junior.md). To revisit the cost model underneath everything, return to [The I/O Model](../01-the-io-model/junior.md); and for the closely related "make the log base large" result applied to sorting, see [External Sorting](../03-external-sorting/junior.md).

---

## Further Reading

- **Bayer & McCreight (1972), "Organization and Maintenance of Large Ordered Indexes"** — the paper that introduced the B-tree. The origin of the structure that runs every database index.
- **Comer (1979), "The Ubiquitous B-Tree"** (ACM Computing Surveys) — the classic survey of B-trees and B⁺-trees and why they dominate storage; the source of the "ubiquitous" framing this file echoes.
- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms*, Chapter 18 ("B-Trees")** — the standard textbook treatment of the structure and its operations, with the disk-access cost analysis.
- **Aggarwal & Vitter (1988), "The Input/Output Complexity of Sorting and Related Problems"** — establishes the I/O model and the `Θ(log_B N)` searching bound that this file works out for the B-tree.
- **Vitter, *Algorithms and Data Structures for External Memory*** — the modern survey; B-trees and their I/O analysis sit alongside external sorting and the rest of external-memory algorithms.
- **[The I/O Model](../01-the-io-model/junior.md)** — the cost model (`N`, `M`, `B`, block transfers) and the searching bound this whole topic stands on.
- **[B-Tree (the data structure)](../../09-trees/11-b-tree/junior.md)** — the structural mechanics: node splitting, merging, balance invariants, and the operations in full detail.
- **[External Sorting](../03-external-sorting/junior.md)** — the same "make the log base large" lesson applied to sorting `N ≫ M` data, and the engine behind LSM-tree compaction.
- **[B-Tree I/O Analysis — Middle](./middle.md)** — rigorous height derivation, amortized split/merge I/O cost, and the B-tree-vs-LSM-tree trade-off for write-heavy workloads.

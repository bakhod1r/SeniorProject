# Cache-Aware Data Layout — Junior Level

> **Audience:** You've met the [I/O model](../01-the-io-model/junior.md) — you know that memory moves in **blocks** (a cache line is ~64 bytes), that touching `B` contiguous elements costs *one* transfer while `B` scattered ones cost up to `B`, and that *access order* can change wall-clock time by 100×. The new idea here: even with a fixed algorithm and a fixed access order, *how you arrange the bytes in memory* — the **layout** — is itself a lever that can make the same loop 5–10× faster.
> **Read time:** ~42 minutes. **Focus:** "The CPU always grabs 64 bytes whether I use them or not. So how do I pack my data so that every byte in a fetched cache line is one I actually need — and why does that one decision beat picking a 'better' algorithm?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The One Fact: You Always Grab 64 Bytes](#the-one-fact-you-always-grab-64-bytes)
5. [Arrays vs Linked Lists: Streaming vs Pointer-Chasing](#arrays-vs-linked-lists-streaming-vs-pointer-chasing)
6. [Sequential vs Strided: Row-Major vs Column-Major, With Numbers](#sequential-vs-strided-row-major-vs-column-major-with-numbers)
7. [Array-of-Structs vs Struct-of-Arrays: The Particle Example](#array-of-structs-vs-struct-of-arrays-the-particle-example)
8. [Drawing AoS and SoA in Memory](#drawing-aos-and-soa-in-memory)
9. [Cache-Line Alignment and Padding](#cache-line-alignment-and-padding)
10. [Code: AoS vs SoA, a Real Wall-Clock Experiment](#code-aos-vs-soa-a-real-wall-clock-experiment)
11. [Where This Wins: Games, Columnar Databases, Numeric Code](#where-this-wins-games-columnar-databases-numeric-code)
12. [Layout Can Beat a "Better" Algorithm](#layout-can-beat-a-better-algorithm)
13. [Common Misconceptions](#common-misconceptions)
14. [Common Mistakes](#common-mistakes)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

In [the I/O model](../01-the-io-model/junior.md) you learned that memory moves in **blocks** — a cache line of ~64 bytes between cache and RAM, a page of a few kilobytes between RAM and disk — and that the cost of an algorithm is the number of those blocks it hauls across the hierarchy. You saw that the *order* you touch memory in matters enormously: a row-major sum flies, a column-major sum crawls, even though both do identical arithmetic. That was a lesson about *access pattern* — the sequence of addresses your code reads.

This file is about a sibling lever that's just as powerful and often overlooked: the **layout**. Even if you fix the algorithm and fix the order it touches things, you still get to decide *how the bytes are physically arranged* — which fields sit next to which, whether records are stored together or split apart, whether a contiguous array or a chain of scattered nodes holds your data. That decision changes how much of each fetched cache line is *useful*. Because the hardware always pulls a whole 64-byte line whether you want it or not, the question becomes: **of those 64 bytes, how many did you actually need?** If the answer is "all of them," you're running at cache speed. If the answer is "8 of them, the other 56 were dead weight," you're paying 8× the memory traffic for the same work.

The astonishing part is the size of the payoff. The *same* `O(n)` loop — same operations, same complexity, same compiler — can run **5–10× faster** purely because the data was laid out to feed the cache instead of fight it. No clever algorithm, no parallelism, no rewrite of the logic: just a rearrangement of where the bytes live. This is the core idea behind **data-oriented design** in game engines, **columnar storage** in analytics databases, and the hand-tuned inner loops of numerical computing. It is also the clearest demonstration of a humbling truth: a *layout* change can beat an *algorithm* change.

This file builds that intuition concretely. We anchor on the one fact that drives everything — *you always grab 64 bytes whether you use them or not* — then walk through the four classic layout techniques, each with a memory picture: arrays vs linked lists (streaming vs pointer-chasing), sequential vs strided access (the row/column sum, with measured numbers), **array-of-structs (AoS) vs struct-of-arrays (SoA)** (the famous particle example, drawn both ways), and cache-line alignment & padding. Then we *measure* it: runnable Go and Python that sums one field of a million records as AoS vs SoA and reports the timing gap, with the cache-line explanation for exactly why the gap appears. We close on why this matters in real systems and the big-picture lesson that layout can outrank algorithm. Where [cache-oblivious algorithms](../02-cache-oblivious-algorithms/junior.md) achieve locality *without knowing* the block size, cache-*aware* layout achieves it by *exploiting* a known cache line — the two are cousins, and this is the parameter-knowing one.

---

## Prerequisites

- **Required:** [The I/O Model](../01-the-io-model/junior.md). This file leans on its central facts: memory moves in **blocks** of `B` elements (here `B` is a cache line, ~64 bytes); touching `B` contiguous elements costs **one** I/O while `B` scattered ones cost up to `B`; and *locality* (touching near/recent data) is what makes blocks pay off. We reuse all of it.
- **Required:** Comfort with arrays laid out contiguously in memory (element `i` sits right after `i−1`) and how a 2D array is stored **row-major** (all of row 0, then all of row 1).
- **Required:** Basic familiarity with **structs / records** (a bundle of named fields like `x`, `y`, `z`, `mass`) and with **linked lists** (nodes connected by pointers). We contrast how each lands in memory.
- **Helpful:** A rough sense of what a CPU cache and a *cache line* are. We define everything, but a mental picture helps.
- **Helpful:** Having read [cache-oblivious algorithms](../02-cache-oblivious-algorithms/junior.md), the *parameter-free* cousin of the techniques here — useful for contrast, not required.

No hardware-engineering knowledge is required — every effect here is explained through the single "you grab a whole line" fact.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cache line** | The fixed-size chunk (typically **64 bytes**) the CPU moves between cache and RAM in one transfer. The `B` of the I/O model at the cache level. |
| **Cache-aware (cache-conscious)** | Designing data/code while *knowing* the cache-line / block size, and arranging bytes to exploit it. (Contrast: [cache-oblivious](../02-cache-oblivious-algorithms/junior.md), which knows no `B`.) |
| **Data layout** | How a program's bytes are physically arranged in memory — which fields neighbor which, whether records are together or split. |
| **Spatial locality** | Accessing data physically *near* data you just touched — rewarded because it's already in the loaded line. |
| **Temporal locality** | Re-accessing data you touched *recently* — rewarded because it's still cached. |
| **Useful fraction (of a line)** | Of the 64 bytes a fetch brings in, how many your code actually reads. The headline number layout optimizes. |
| **Pointer chasing** | Following a chain of pointers (linked list, tree of separately-allocated nodes) — each hop can miss the cache. |
| **Stride** | The byte gap between consecutive accesses. Stride ≤ line size = good; stride ≥ line size = a miss per access. |
| **AoS (Array-of-Structs)** | Store records as one array of whole structs: `[{x,y,z,m}, {x,y,z,m}, …]`. Each record contiguous. |
| **SoA (Struct-of-Arrays)** | Store each field in its own array: `xs[], ys[], zs[], ms[]`. Each field contiguous across all records. |
| **Alignment** | Placing data so it starts on a natural boundary (e.g., a cache-line boundary), so a hot object isn't split across two lines. |
| **Padding** | Inserting unused bytes to push data onto a boundary or to separate independently-written fields onto different lines. |
| **Data-oriented design (DOD)** | A design style (popular in games) that organizes code around how data is laid out and streamed, not around objects. |

---

## The One Fact: You Always Grab 64 Bytes

Everything in this file flows from a single hardware fact you already met in [the I/O model](../01-the-io-model/junior.md), stated here at the cache level as bluntly as possible:

> **When the CPU needs one byte that isn't already in cache, it does not fetch one byte. It fetches the whole 64-byte cache line that byte lives in — and you pay the *same* cost whether you end up using 1 of those bytes or all 64.**

That's it. The cache line is the unit of transfer, the same way a disk page was. You don't get to fetch a single `int`; you get the line around it, free of charge but also whether you wanted it or not. So the *entire* art of cache-aware layout reduces to one question:

> **Of the 64 bytes I just paid to fetch, how many did I actually need?**

Call that the **useful fraction** of the line. Two programs doing identical work can have wildly different useful fractions:

```
GOOD layout:  fetch a 64-byte line, use all 64 bytes  → useful fraction 100%
              → 1 cache miss feeds ~16 four-byte ints of real work

BAD layout:   fetch a 64-byte line, use 4 bytes, ignore 60 → useful fraction ~6%
              → 1 cache miss feeds just 1 int of real work; the other 15 slots wasted
```

In the bad case you pay the *same* miss but get one-sixteenth of the work out of it. To process the same data you'll trigger ~16× as many misses — and on a memory-bound loop, misses *are* the running time. That's where the 5–10× (sometimes more) speedups come from: not faster instructions, just a higher useful fraction per line.

Hold onto the picture of a 64-byte line as a small bucket the hardware always fills to the brim. Cache-aware layout is the discipline of making sure the bucket comes back full of things you want, not padded with junk you'll throw away. Every technique below — arrays over linked lists, sequential over strided, SoA over AoS, alignment over splitting — is one move in that single game.

---

## Arrays vs Linked Lists: Streaming vs Pointer-Chasing

The first and most common layout choice: **a contiguous array** versus **a linked list** (or any structure of separately-allocated, pointer-connected nodes — including many tree implementations). For "store a sequence and walk it," they look interchangeable in a textbook. In the cache they are night and day.

**The array streams.** An array of `N` values sits in one contiguous run of memory. Walking it, you touch address `0, 4, 8, 12, …` (for 4-byte ints). The first access misses and pulls in a 64-byte line — which contains the next 15 ints *for free*. The following 15 reads are cache **hits**. One miss feeds 16 elements. You march through the whole array paying about `N/16` misses — exactly `scan(N) = Θ(N/B)` from [the I/O model](../01-the-io-model/junior.md). The hardware *prefetcher* even notices the steady forward march and fetches the next line *before* you ask, hiding the latency entirely. Arrays are the cache's favorite shape.

**The linked list scatters.** A linked list is `N` separately-allocated nodes, each holding a value and a `next` pointer. Crucially, those nodes can live *anywhere* in memory — wherever the allocator happened to put each one. Walking the list, you follow `next` from node to node, and each hop can land in a completely different cache line. Worse, you can't fetch the next node until you've read *this* node's pointer (a **dependent load**) — so the prefetcher can't run ahead; it doesn't know where you're going next. Result: roughly **one cache miss per node**. For `N` nodes that's `Θ(N)` misses — a factor of `B` (here ~16) worse than the array, for storing *the same `N` values*.

```
ARRAY  (contiguous):   [v0 v1 v2 v3 v4 v5 v6 v7 ... ]   one 64B line = 16 ints
   walk: miss, hit×15, miss, hit×15, ...  → ~N/16 misses  (the prefetcher loves it)

LINKED LIST (scattered nodes):
   nodeA ──next──▶ nodeQ ──next──▶ nodeD ──next──▶ nodeM ──▶ ...
   (each node wherever malloc put it)
   walk: miss, miss, miss, miss, ...      → ~N misses     (dependent loads, no prefetch)
```

The slogan: **arrays stream; linked lists pointer-chase.** A list also wastes memory on a pointer per node (8 bytes to store maybe 4 bytes of data — the pointer can be *bigger than the payload*), which further lowers the useful fraction of every line. This is why, for "hold a bunch of things and iterate them," a contiguous `array`/`slice`/`vector`/`ArrayList` is almost always faster than a `LinkedList`, even when Big-O says they're equal for traversal — the constant hidden in `Θ(N)` is a factor-of-`B` cache penalty.

Put a number on it. Walk a million 4-byte integers. As a contiguous array, that's `1,000,000 / 16 ≈ 62,500` cache misses (16 ints per 64-byte line), and the prefetcher hides most of even those — the walk is effectively memory-bandwidth-bound and finishes in a flash. As a linked list of a million nodes scattered by the allocator, it's up to `1,000,000` misses — one per hop — *and* each miss is a full latency stall (~100 ns to RAM) that can't overlap with the next, because you don't know the next address until this node's pointer arrives. Sixteen-times-fewer misses *and* the ability to prefetch is why the array routinely wins by 5–10× on traversal, a gap the `Θ(N)` notation is blind to.

The same trap hides inside structures you might not think of as "linked lists." A tree of separately-`new`-ed nodes, a hash map with chained buckets of individually-allocated entries, a graph stored as objects pointing at objects — all *pointer-chase* the same way, all pay a miss per hop. The fix is the same everywhere: store the elements in a **contiguous backing array** and refer to them by **index** instead of pointer where you can. An array-backed binary heap, an open-addressed hash table, a graph stored as flat edge arrays (CSR) — each is the cache-aware redesign of a pointer-y structure, trading scattered nodes for one streaming array.

> **The honest nuance.** Linked structures earn their keep when you do lots of *middle* insertions/deletions and rarely traverse, or when nodes are large and few. But for the overwhelmingly common "build it, then iterate it a lot" pattern, prefer contiguous storage. When you *must* have node-like structure, allocating nodes from a **pool/arena** (so they sit contiguously) recovers much of the array's locality — a cache-aware trick in itself.

---

## Sequential vs Strided: Row-Major vs Column-Major, With Numbers

You met this in [the I/O model](../01-the-io-model/junior.md), but it's worth re-grounding here as a *layout* statement, because it's the cleanest case where the algorithm is fixed and only the order-versus-layout interaction changes the speed.

A 2D matrix is stored **row-major**: all of row 0 contiguously, then all of row 1, and so on. Element `(r, c)` lives at flat index `r*N + c`. So *moving along a row* (`c` increasing) walks contiguous memory with **stride = one element**; *moving down a column* (`r` increasing) jumps a whole row — **stride = `N` elements**.

Sum the matrix two ways:

```
ROW-MAJOR sum (with the grain):       COLUMN-MAJOR sum (against the grain):
  for r: for c: s += A[r*N + c]          for c: for r: s += A[r*N + c]
  stride 1  → reuse each 64B line        stride N → fresh line almost every step
  ~N²/16 misses (B=16 ints/line)         up to ~N² misses (one per element)
```

Same additions, same reads, same `O(N²)`. But the column-major version's stride is bigger than a cache line, so each access lands in a new line, uses 4 of its 64 bytes, and throws the rest away before coming back to it — a useful fraction of ~6%. On a real machine this typically costs **5× to 50× more time** for the identical computation. Concretely, for a 4096×4096 matrix of ints that doesn't fit in cache, the row-major sum might take ~50 ms and the column-major ~400 ms on the same CPU — an 8× gap with zero change to the math.

The layout lesson: **the data was laid out row-major; your access order must match it.** If your loop *needs* to go down columns, the cache-aware fix is to change the *layout* (store the matrix column-major, or transpose it once up front, or process it in small square *tiles* so each tile fits a line) — not to accept the strided traffic. Stride is the enemy; keep your stride at or below the line size and the useful fraction stays high.

> **The general rule.** *Stride ≤ cache-line size → good (lines reused). Stride ≥ cache-line size → one miss per access (lines wasted).* Whenever a loop's innermost index doesn't match the contiguous dimension of your data, you're striding — and that's a layout/order mismatch costing you up to a factor of `B`.

There's a subtle middle case worth naming: a stride that's *smaller* than a line but bigger than your element still wastes part of every line. If you read every *other* element of an int array (stride 2 elements = 8 bytes), each 64-byte line still serves 8 of your reads — useful fraction 50%, only 2× the misses, not `B`×. The penalty grows smoothly with the stride until it hits the line size, at which point you've crossed into "a fresh line every access" and the full factor-of-`B` penalty kicks in. So the goal isn't "stride exactly 1" — it's "keep the stride small enough that consecutive accesses keep landing in the line you already paid for."

---

## Array-of-Structs vs Struct-of-Arrays: The Particle Example

Here is the technique that surprises people most, because both layouts look equally reasonable and the gap is large. It's the choice between **Array-of-Structs (AoS)** and **Struct-of-Arrays (SoA)**, and the canonical example is a cloud of particles.

Say each particle has four fields: position `x`, `y`, `z`, and `mass` — four 4-byte floats, so **16 bytes per particle**. We have a million of them. The natural, object-oriented way to store them is **AoS**: one array, each slot a whole `Particle` struct.

```go
type Particle struct { X, Y, Z, Mass float32 }   // 16 bytes
particles := make([]Particle, 1_000_000)          // AoS: [{x,y,z,m}{x,y,z,m}...]
```

Now suppose a very common loop touches **only one field** — say we sum every particle's `x` (or shift all `x` by some amount). Watch what the cache does under AoS. The `x` values are 16 bytes apart (each separated by its struct's `y`, `z`, `mass`). A 64-byte line holds **4 whole particles** = 4 `x` values *and* 12 fields we don't want. So each fetched line gives us 4 useful floats (16 bytes) and 48 bytes of dead weight: a **useful fraction of 25%**. To read a million `x` values we drag a million particles' worth of `y/z/mass` through the cache for nothing — 4× the memory traffic of what we need.

The cache-aware fix is **SoA**: store each field in its own contiguous array.

```go
type Particles struct {                 // SoA: one array per field
    X, Y, Z, Mass []float32
}
p := Particles{
    X: make([]float32, 1_000_000),
    Y: make([]float32, 1_000_000),
    Z: make([]float32, 1_000_000),
    Mass: make([]float32, 1_000_000),
}
```

Now the loop that touches only `x` walks `p.X` — a contiguous array of nothing *but* `x` values. A 64-byte line holds **16 `x` values**, all of them wanted: a **useful fraction of 100%**. Same million reads, but `1,000,000/16 ≈ 62,500` misses instead of `1,000,000/4 = 250,000` — a **4× reduction** in memory traffic, and typically a 3–5× wall-clock speedup on the loop. (The prefetcher loves SoA too: a pure forward march over `p.X`.)

```
The loop touches only .x of each particle:

AoS: line = [x0 y0 z0 m0 | x1 y1 z1 m1 | x2 y2 z2 m2 | x3 y3 z3 m3]
            ^used  ^^^waste  ^used  ^^^waste ...   → 4 useful of 16 = 25% useful

SoA: line = [x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 x10 x11 x12 x13 x14 x15]
            all used                              → 16 useful of 16 = 100% useful
```

The rule of thumb: **if your hot loops touch only *some* fields of each record, split those fields out (SoA); if your loops touch *whole* records at once, keep them together (AoS).** AoS is friendlier when you process one entire object at a time (you want all of `x,y,z,mass` together, so they should share a line). SoA is friendlier when you sweep one field across all objects (the "give me every `x`" pattern). Real engines often go **hybrid** — group the few fields that are always used together, split the rest — picking the layout per *access pattern*, which is exactly the cache-aware mindset.

A second, quieter benefit of SoA: **homogeneous, packed arrays vectorize.** A loop over a contiguous `float32` array is exactly the shape the CPU's SIMD units (and the compiler's auto-vectorizer) want — it can add 8 or 16 floats per instruction. The same loop over AoS, where the floats you want are 16 bytes apart, can't be packed into a vector register cleanly, so it falls back to scalar adds. So SoA frequently delivers *two* compounding wins on a field-sweep: fewer cache misses (the layout story above) *and* wider instructions per cycle. That's part of why the measured speedups sometimes exceed the pure 4× traffic ratio.

It cuts the other way too, which is the honest cost of SoA. The moment a loop needs *all four* fields of a particle together — a physics step that reads `x,y,z` and `mass` to update a position — SoA forces it to touch four *separate* arrays, four independent streams, four sets of misses; AoS would have delivered the whole particle in one line. So neither layout is universally "the fast one." You choose per dominant access pattern, and when the patterns genuinely conflict you measure both — which is exactly why the hybrid (group-then-split) layout exists.

---

## Drawing AoS and SoA in Memory

It's worth seeing the two layouts byte-for-byte, because the picture makes the useful-fraction argument unforgettable. Take just five particles, fields `x y z m`, each 4 bytes (so 16 bytes per particle, 4 particles per 64-byte line).

**AoS — one array of whole structs.** Each particle's four fields sit together; particles follow one another:

```
AoS memory (each [ ] = 4 bytes):
  particle 0          particle 1          particle 2          particle 3        particle 4
 [x0][y0][z0][m0]  [x1][y1][z1][m1]  [x2][y2][z2][m2]  [x3][y3][z3][m3]  [x4][y4]...
 └──────────────── one 64-byte cache line (4 particles) ───────────────┘  └ next line ─

  Loop over .x only → reads x0,x1,x2,x3 from line 1 (4 of 16 slots used = 25%),
  then must fetch line 2 for x4. The y/z/m bytes rode along unused.
```

**SoA — one array per field.** All `x` together, then all `y`, then all `z`, then all `m` (each its own contiguous array, possibly far apart):

```
SoA memory:
  xs:  [x0][x1][x2][x3][x4][x5]...[x15]   ← one 64-byte line = 16 x-values, ALL used
  ys:  [y0][y1][y2][y3][y4][y5]...        ← separate array, only fetched if you need y
  zs:  [z0][z1][z2][z3]...                ← separate array
  ms:  [m0][m1][m2][m3]...                ← separate array

  Loop over .x only → walks xs contiguously: line 1 = x0..x15 (16 of 16 = 100%),
  and y/z/m arrays are never touched at all. Zero wasted bytes.
```

Read the two pictures side by side and the whole technique is visible: under AoS the field you want is *interleaved* with three you don't, so every line is 3/4 waste for a single-field loop; under SoA the field you want is *packed*, so every line is 100% payload — and the unused fields aren't even brought into cache. The 4× traffic difference is right there in the diagrams.

```
WHICH TO USE:
  loop touches ONE / FEW fields across all records   → SoA  (pack that field; skip the rest)
  loop touches WHOLE records (all fields together)    → AoS  (keep the object on one line)
  mixed                                               → hybrid: group always-together fields,
                                                         split the rest
```

This is *data-oriented design* in one diagram: organize memory around *what the loops read*, not around *what the objects are*.

---

## Cache-Line Alignment and Padding

Two finer-grained tools round out the toolkit. Both are about the cache *line as a unit* — of transfer, and of contention.

**Alignment: don't let a hot object straddle two lines.** A 64-byte object that happens to start at byte offset 40 spills across *two* cache lines, so touching it costs **two** misses instead of one. **Aligning** the object to a 64-byte boundary (so it starts where a line starts) keeps it in a single line — one miss. For a hot, frequently-touched structure, that alignment can halve its miss cost. Languages give you this control (Go's struct field ordering and `//go:align`-style tricks, C's `alignas`, etc.), and allocators often align large blocks for you; the point is to be aware that *where* an object starts relative to line boundaries affects how many lines it occupies.

**Padding: the cache line is also a unit of *contention*.** Here's a subtler effect that bites in multithreaded code. If two threads each write to *different* variables that happen to sit in the **same cache line**, the hardware's coherence protocol treats the whole line as contested: every write by one thread invalidates the line in the other thread's cache, forcing it to re-fetch — even though they never touch the *same* variable. This is **false sharing**, and it can quietly destroy parallel speedup. The fix is **padding**: insert unused bytes so each thread's hot variable lands on its *own* line, removing the contention.

```
FALSE SHARING (bad):  counterA and counterB share one 64-byte line
  [ counterA | counterB | ......... unused ......... ]   ← one line
   thread 1 writes A → invalidates the line in thread 2's cache
   thread 2 writes B → invalidates it in thread 1's cache
   → the two threads ping-pong the line, serializing despite touching different vars

PADDED (good):        push each counter onto its own line
  [ counterA | ........ pad to 64 bytes ........ ]   ← line 1 (thread 1 only)
  [ counterB | ........ pad to 64 bytes ........ ]   ← line 2 (thread 2 only)
   → no contention; each thread owns its line
```

So padding plays two opposite roles depending on the goal: you *avoid* padding inside a hot single-threaded struct (it lowers the useful fraction — wasted bytes per line), but you *add* padding between independently-written fields in concurrent code (to put them on separate lines and kill false sharing). Both decisions come from seeing the 64-byte line clearly: as the chunk you fetch, and as the chunk threads fight over.

> **Junior takeaway.** You won't hand-tune alignment every day, but you should *recognize* these effects: a hot object split across lines pays double; two threads hammering the same line serialize on false sharing. Both are layout problems with layout fixes (align it; pad it apart), and both are invisible to operation-count analysis.

---

## Code: AoS vs SoA, a Real Wall-Clock Experiment

Enough theory — let's *measure* the AoS-vs-SoA gap on a real machine. We build a million particles two ways, then run the same "sum one field" loop over each and clock the difference. Same arithmetic, same operation count, same `O(n)` — the only difference is the layout, and therefore the useful fraction of every cache line.

### Go

```go
package main

import (
	"fmt"
	"time"
)

const N = 10_000_000 // big enough that the data dwarfs L2/L3 cache

// --- AoS: array of whole structs ---
type Particle struct {
	X, Y, Z, Mass float32 // 16 bytes; only X is summed below
}

func sumX_AoS(ps []Particle) float32 {
	var s float32
	for i := range ps {
		s += ps[i].X // touches 4 bytes; drags Y,Z,Mass through cache unused
	}
	return s
}

// --- SoA: one array per field ---
type Particles struct {
	X, Y, Z, Mass []float32
}

func sumX_SoA(p *Particles) float32 {
	var s float32
	for i := range p.X {
		s += p.X[i] // walks a contiguous array of nothing but X — 100% useful
	}
	return s
}

func main() {
	// Build AoS.
	aos := make([]Particle, N)
	for i := range aos {
		aos[i] = Particle{X: float32(i % 7), Y: 1, Z: 2, Mass: 3}
	}
	// Build SoA with identical X values.
	soa := &Particles{
		X:    make([]float32, N),
		Y:    make([]float32, N),
		Z:    make([]float32, N),
		Mass: make([]float32, N),
	}
	for i := 0; i < N; i++ {
		soa.X[i] = float32(i % 7)
	}

	// Time AoS.
	start := time.Now()
	sa := sumX_AoS(aos)
	aosTime := time.Since(start)

	// Time SoA.
	start = time.Now()
	ss := sumX_SoA(soa)
	soaTime := time.Since(start)

	fmt.Printf("AoS sum .x: %v   (sum=%v)\n", aosTime, sa)
	fmt.Printf("SoA sum .x: %v   (sum=%v)\n", soaTime, ss)
	fmt.Printf("SoA was %.1fx faster — same loop, only the LAYOUT changed\n",
		float64(aosTime)/float64(soaTime))
}
```

Running this prints something close to:

```
AoS sum .x: 14.8ms   (sum=3e+07)
SoA sum .x:  3.6ms   (sum=3e+07)
SoA was 4.1x faster — same loop, only the LAYOUT changed
```

### Python

```python
import time
import array

N = 5_000_000  # pure-Python loops are slow, but the RATIO still shows the effect

# --- AoS: a list of 4-tuples (x, y, z, mass); the loop reads only x = item[0] ---
aos = [(i % 7, 1.0, 2.0, 3.0) for i in range(N)]

start = time.perf_counter()
s_aos = 0.0
for p in aos:
    s_aos += p[0]            # touches x; y,z,mass ride along in the (scattered) tuple
aos_time = time.perf_counter() - start

# --- SoA: one packed numeric array per field; the loop walks xs contiguously ---
xs = array.array('f', (float(i % 7) for i in range(N)))
ys = array.array('f', (1.0 for _ in range(N)))  # never touched by the loop
zs = array.array('f', (2.0 for _ in range(N)))
ms = array.array('f', (3.0 for _ in range(N)))

start = time.perf_counter()
s_soa = 0.0
for x in xs:                 # contiguous packed floats — high useful fraction
    s_soa += x
soa_time = time.perf_counter() - start

print(f"AoS sum .x: {aos_time:.3f}s   (sum={s_aos})")
print(f"SoA sum .x: {soa_time:.3f}s   (sum={s_soa})")
print(f"SoA was {aos_time / soa_time:.1f}x faster — same loop, only the LAYOUT changed")
```

**What the experiment shows.** Both versions add up the *same* million-plus `x` values with the *same* number of additions — the RAM model scores them identical. But under AoS, each `x` is buried in a 16-byte record, so every 64-byte cache line the loop fetches carries 4 wanted floats and 12 unwanted ones (a 25% useful fraction); the loop drags every particle's `y`, `z`, `mass` through cache for nothing. Under SoA, the `x` values are packed contiguously, so each line is 16 wanted floats (100% useful) and the other arrays are never even fetched. Fewer misses → less memory traffic → a several-fold wall-clock win, *purely* from layout.

> **Try this.** In the Go version, add fields to `Particle` so it grows to 64 bytes, and watch the AoS time get *worse* (only 1 useful float per line now → useful fraction ~6%) while SoA is unchanged. That's the dial: the more *unused* bytes ride along with each record under AoS, the bigger the SoA win. It also explains why "fat" objects with many rarely-used fields are cache poison for field-sweeping loops — every byte of bloat lowers the useful fraction of every line you fetch.

---

## Where This Wins: Games, Columnar Databases, Numeric Code

Cache-aware layout isn't a microbenchmark trick — it's the load-bearing idea behind several whole families of high-performance systems. Each one is, at heart, "choose the layout that maximizes the useful fraction for the dominant loop."

| Domain | The layout move | Why it wins |
|--------|-----------------|-------------|
| **Game engines (data-oriented design, ECS)** | **SoA** over arrays of game objects; an **Entity-Component-System** stores each component type in its own packed array. | The per-frame update loops sweep *one* component (positions, velocities) across *all* entities — exactly the single-field pattern SoA nails. Streaming packed arrays beats chasing a graph of `GameObject` pointers; this is why ECS engines hit smooth frame rates on huge entity counts. |
| **Columnar / analytics databases** (Parquet, ClickHouse, DuckDB) | Store tables **column-by-column** (SoA at the storage level) instead of row-by-row. | Analytic queries scan *a few columns* over *millions of rows* (`SELECT AVG(price)`), so a columnar layout reads only the needed columns contiguously — high useful fraction — and skips the rest entirely. Row storage would drag every column of every row through memory. Same SoA idea, scaled to disk and RAM. |
| **Numerical / scientific code** | **Tiled/blocked** matrix layouts; keeping the contiguous dimension on the inner loop; SoA for particle/mesh data. | Inner loops are memory-bound; matching access stride to the line size (and tiling so a working set fits a line/cache) turns wasted lines into full ones. This is the constant-factor that separates a naive matmul from a fast one. |
| **Serialization / network buffers** | Pack hot fields together; align records to line/page boundaries. | Parsing and copying sweep contiguous bytes; a layout that keeps the fields a stage actually uses on the same line minimizes misses during the sweep. |

The throughline is the I/O model's question asked at the cache level: **how do I touch slow memory as few times as possible?** — answered not by changing *what* you compute but by changing *where the bytes live* so each fetched line is full of payload. Once you see it in ECS, you see it in columnar databases; once you see it there, you see it in your own hot loops.

---

## Layout Can Beat a "Better" Algorithm

Here's the lesson worth carrying above all others, because it overturns the instinct every algorithms course installs: *to go faster, find a better-Big-O algorithm.* In the memory-bound regime, **a layout change can beat an algorithm change** — and routinely does.

Why? Because Big-O counts *operations*, and once your data outgrows cache, operations aren't the bottleneck — *cache misses* are. Two algorithms with the same operation count can differ by `B`× (often 5–50×) in real time based purely on memory traffic, and *layout* is the lever that controls memory traffic without touching the operation count at all. So:

- A linear scan over a **contiguous array** (good layout, naive algorithm) often **beats** a cleverer structure scattered across **pointer-chased nodes** (worse layout, fancier algorithm) — the array's `N/16` misses crush the structure's `N` misses, even if the fancy structure does fewer *operations*.
- An `O(n²)` brute-force pass over a small **SoA** can beat an `O(n log n)` algorithm over a pointer-heavy structure *at realistic sizes*, because the constant factor on the cache-friendly version is tiny and on the pointer-chasing one is `B`.
- Reorganizing a hot struct from AoS to SoA — a **five-minute change that doesn't touch a single line of algorithm logic** — can deliver the same 5× you'd chase for days trying to find an asymptotically better method.

```
THE REORDERED PRIORITY (memory-bound code):
  1. Is the data laid out so hot loops get a high useful fraction per line?
       (contiguous? SoA for field-sweeps? right stride? aligned?)
  2. THEN worry about the algorithm's Big-O.
  Big-O counts operations; memory-bound speed is set by cache misses,
  and LAYOUT controls misses. Fix the layout first.
```

This is not a license to ignore complexity — an `O(n²)` over ten million items is still doomed no matter how it's laid out, and at huge `N` the asymptotics dominate. It's a correction to the *order of operations* in optimization: for the very common case of a memory-bound loop over data that outgrows cache, **profile, find the cache-missing loop, and fix its layout before you go hunting for a cleverer algorithm.** The humbling, liberating truth is that the cheapest, lowest-risk speedup is often just moving the bytes — and it's the one the textbook never mentions.

---

## Common Misconceptions

- **"Same Big-O means same speed."** Only when data fits in cache. Past that, *cache misses* set the speed, not operation count — and layout controls misses. Two `O(n)` loops over the same data can run 10× apart purely on layout. Big-O is necessary, not sufficient.

- **"Linked lists and arrays are equivalent for traversal — both `O(n)`."** Same operation count, but the array pays `~n/B` misses and the linked list `~n` misses (one per node, with no prefetching because the loads are *dependent*). For "iterate a sequence," prefer the array; the list's `Θ(n)` hides a factor-of-`B` cache penalty.

- **"AoS vs SoA is a stylistic preference."** It's a measurable performance decision driven by *access pattern*. Single-field sweeps want SoA (pack the field, 100% useful lines); whole-record processing wants AoS (keep the object on one line). Pick by what the hot loops read, not by taste.

- **"Padding is always wasteful, so remove it."** Inside a hot single-threaded struct, yes — padding lowers the useful fraction. But *between* variables written by different threads, you *add* padding deliberately to put them on separate lines and kill **false sharing**. Same tool, opposite goals; the difference is single- vs multi-threaded.

- **"Cache-aware layout means rewriting in C / hand-managing memory."** No — it's mostly about *arranging* data (array vs list, SoA vs AoS, field grouping), which you can do in Go, Java, C#, even Python (via packed numeric arrays). It's a design choice, not a language requirement.

- **"This is the same as cache-oblivious algorithms."** Related but opposite in stance. [Cache-oblivious](../02-cache-oblivious-algorithms/junior.md) achieves locality *without knowing* the line/block size (recurse until it fits). Cache-*aware* layout *exploits a known* line size (pack to 64 bytes, align to the line). Both chase locality; one names `B`, the other refuses to.

---

## Common Mistakes

- **Defaulting to a linked list (or a graph of separately-allocated nodes) for data you'll mostly iterate.** You pay a miss per node. Use a contiguous array/slice/vector; if you need node semantics, allocate the nodes from a pool/arena so they sit contiguously and recover the array's locality.

- **Keeping everything in fat AoS records when hot loops touch one field.** Every fetched line is mostly fields you don't want (low useful fraction). Split the hot field into its own array (SoA), or group only the always-together fields. Match layout to access pattern.

- **Letting the inner loop run against the grain of the layout (striding).** A column-major sweep over row-major data lands a miss per element. Either change the layout (store/transpose to match the access order) or tile the loop so each tile fits a line — don't accept the strided traffic.

- **Bloating hot structs with rarely-used fields.** Every unused byte in a record lowers the useful fraction of every line a field-sweep fetches. Move cold fields out (to a separate "cold" array indexed in parallel) so the hot path's lines stay dense.

- **Ignoring false sharing in concurrent code.** Two threads writing different variables on the same line ping-pong it and serialize, with no error and no clue in the operation count. Pad independently-written hot variables onto separate cache lines.

- **Optimizing layout for data that fits in cache.** Like everything in this section, the win appears only when data outgrows fast memory. For tiny arrays, AoS and SoA are equally fast (everything's resident). Don't restructure small-data code expecting a speedup — measure first.

- **Reaching for a fancier algorithm before fixing the layout.** On a memory-bound loop, the cheapest large win is usually a layout change (AoS→SoA, list→array), not a better Big-O. Profile, find the cache-missing loop, fix its layout first.

---

## Cheat Sheet

```
THE ONE FACT
  The CPU always fetches a whole 64-byte CACHE LINE, used or not.
  The whole game: maximize the USEFUL FRACTION of each fetched line.
    100% useful = cache speed;  6% useful = ~16x the misses for the same work.

ARRAYS vs LINKED LISTS
  array (contiguous):   ~N/B misses, prefetcher helps   → STREAMS  (prefer this)
  linked list (nodes):  ~N misses, dependent loads      → POINTER-CHASES (one miss/node)
  same Θ(N) traversal, but the list hides a factor-of-B cache penalty.

SEQUENTIAL vs STRIDED
  stride ≤ line size → lines reused      → good (sequential / with the grain)
  stride ≥ line size → miss per access   → bad  (strided / against the grain)
  row-major data → loop along rows; column sweep over row-major = up to B× slower.

AoS vs SoA  (records with fields x,y,z,mass)
  AoS [{x,y,z,m}{x,y,z,m}...] : whole record contiguous.
       loop on ONE field → 25% useful line (3/4 wasted) → ~4x traffic.
  SoA  xs[] ys[] zs[] ms[]    : each field contiguous.
       loop on ONE field → 100% useful line, other arrays untouched.
  RULE: sweep one/few fields → SoA;  process whole records → AoS;  mixed → hybrid.

ALIGNMENT & PADDING
  align a hot object to a 64B boundary → it fits ONE line (not two → 2 misses).
  AVOID padding inside a hot struct (wastes line space, lowers useful fraction).
  ADD padding between vars written by different threads → separate lines
     → kills FALSE SHARING (threads ping-ponging a shared line, serializing).

THE BIG LESSON
  Big-O counts operations; memory-bound speed is set by CACHE MISSES.
  Layout controls misses. The SAME O(n) loop runs 5–10× faster with the right
  layout. A layout change can beat a "better" algorithm — fix layout FIRST.

(only matters when data OUTGROWS cache; tiny data → RAM model is fine)
```

---

## Summary

The CPU always fetches a whole **64-byte cache line** whether you use 1 byte of it or all 64. So the entire discipline of **cache-aware data layout** reduces to one question — *of the bytes I just paid to fetch, how many did I actually need?* — and the answer (the **useful fraction** of each line) can swing the speed of the *same* `O(n)` loop by 5–10× or more, with no change to the algorithm at all. This is the parameter-*knowing* cousin of [cache-oblivious algorithms](../02-cache-oblivious-algorithms/junior.md): here we *exploit* a known cache-line size instead of recursing past it.

- **Arrays stream; linked lists pointer-chase.** A contiguous array pays `~N/B` misses (one miss feeds ~16 elements, and the prefetcher runs ahead), while a chain of separately-allocated nodes pays `~N` misses — one per node, with dependent loads the prefetcher can't anticipate. For "iterate a sequence," the array wins by a factor of `B` despite identical `Θ(N)` traversal.

- **Stride is the enemy of locality.** Matching your access order to the layout (sequential, stride ≤ line size) reuses each line; a strided sweep (e.g., a column-major loop over row-major data) lands a miss per element and runs up to `B`× slower for the identical computation.

- **AoS vs SoA is the headline technique.** When a hot loop touches only *some* fields of each record, **Array-of-Structs** buries the wanted field among unwanted ones — a 25% (or worse) useful fraction and several-fold wasted traffic. **Struct-of-Arrays** packs each field into its own contiguous array — 100% useful lines, untouched fields never fetched. The particle example (`x,y,z,mass`, loop over `x` only) shows the 4× traffic gap in a single memory diagram. Rule: sweep one/few fields → SoA; process whole records → AoS; mixed → hybrid.

- **Alignment and padding tune the line as a unit.** Aligning a hot object to a 64-byte boundary keeps it in one line (not two); padding *removes* itself from hot single-threaded structs (it lowers the useful fraction) but is *added* between thread-private variables to put them on separate lines and kill **false sharing** — two threads ping-ponging a shared line, serializing invisibly.

- **The code proves it.** Summing one field of a million particles as AoS vs SoA — same arithmetic, same operation count — runs several-fold apart in wall-clock time, purely because SoA's lines come back full of payload and AoS's come back 3/4 empty.

- **The big lesson: layout can beat a "better" algorithm.** Big-O counts operations, but memory-bound speed is set by cache misses, and *layout* controls misses without touching operation count. For the very common case of a loop over data that outgrows cache, the cheapest, lowest-risk speedup is usually rearranging the bytes (list→array, AoS→SoA) — fix the layout before hunting a cleverer algorithm.

The idea to carry forward: when data is bigger than cache, *where the bytes live* is a performance lever as powerful as *which algorithm runs* — because both, ultimately, are decided by how many cache lines you have to haul, and how full each one comes back.

**Next steps:** [the middle-level treatment](./middle.md) puts numbers on the useful-fraction model, quantifies the AoS/SoA and false-sharing effects precisely, and develops alignment, padding, and hybrid (AoSoA) layouts as a tunable design space. Revisit [The I/O Model](../01-the-io-model/junior.md) whenever the block/line accounting feels unfamiliar — every cost here is its `scan(N) = Θ(N/B)` at the cache level. And compare with [Cache-Oblivious Algorithms](../02-cache-oblivious-algorithms/junior.md), which reaches the same locality *without* ever naming the line size — the parameter-free counterpart to everything you just laid out by hand.

---

## Further Reading

- **Ulrich Drepper, "What Every Programmer Should Know About Memory"** — the definitive long-form treatment of caches, cache lines, alignment, prefetching, and false sharing, with measured examples. The canonical reference behind this file.
- **Mike Acton, "Data-Oriented Design and C++" (CppCon 2014 talk)** — the manifesto for organizing code around data layout (SoA, ECS) rather than objects; the source of the "where there's one, there's many" mindset in games.
- **Richard Fabian, *Data-Oriented Design*** — book-length development of layout-driven design, with the AoS/SoA/AoSoA trade-offs worked through.
- **Daniel Lemire's blog and the ClickHouse / DuckDB engineering posts** — practical, measured write-ups of columnar (SoA-at-scale) layouts and why they crush row storage for analytics.
- **[The I/O Model](../01-the-io-model/junior.md)** — the block/line cost model (`scan(N) = Θ(N/B)`, sequential vs random) that this file applies at the cache level.
- **[Cache-Oblivious Algorithms](../02-cache-oblivious-algorithms/junior.md)** — achieving the same locality *without knowing* the line/block size; the parameter-free counterpart to cache-aware layout.
- **[Cache-Aware Data Layout — Middle](./middle.md)** — the quantitative useful-fraction model, precise AoS/SoA and false-sharing analysis, alignment/padding mechanics, and hybrid (AoSoA) layouts.

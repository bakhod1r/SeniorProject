# Bitmask Enumeration (Iterating Over Sets as Integers) — Middle Level

> **Focus:** the `m & -m` lowbit trick for set-bit iteration, the `(s - 1) & mask` submask loop and *why* it visits each submask exactly once, superset enumeration, set operations as bitwise ops, fixed-size subset iteration (pointer to Gosper's hack), and how these compose into `O(3^n)` algorithms.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Set-Bit Iteration with `m & -m`](#set-bit-iteration-with-m---m)
4. [Submask Enumeration: the `(s-1) & mask` Loop](#submask-enumeration-the-s-1--mask-loop)
5. [Superset Enumeration](#superset-enumeration)
6. [Set Operations as Bitwise Operations](#set-operations-as-bitwise-operations)
7. [Fixed-Size Subsets](#fixed-size-subsets)
8. [Worked Example: Partition DP over Submasks](#worked-example-partition-dp-over-submasks)
9. [Iteration Orders and Lattice Structure](#iteration-orders-and-lattice-structure)
10. [Comparison with Alternatives](#comparison-with-alternatives)
11. [Code Examples](#code-examples)
12. [Error Handling](#error-handling)
13. [Performance Analysis](#performance-analysis)
14. [Best Practices](#best-practices)
15. [Visual Animation](#visual-animation)
16. [Summary](#summary)

---

## Introduction

At junior level the headline was: a subset is an integer, and `for mask in 0..2^n-1` enumerates all subsets. At middle level we get precise about the *idioms* that make bitmask code fast and correct:

- How does `m & -m` isolate the lowest set bit, and why is that the optimal way to iterate the present elements?
- Why does `s = (s - 1) & mask` walk every submask of `mask` **exactly once**, in decreasing order, and stop cleanly?
- How do you enumerate the **supersets** of a fixed mask, the dual of submasks?
- Which set operations map to which bitwise operators, and what are the gotchas (complement within `n` bits)?
- When you need only subsets of a **fixed size**, what is the right tool (Gosper's hack, sibling `05`)?
- How do these compose so that "for every mask, do something with each of its submasks" costs `O(3^n)`, not `O(4^n)`?

These are the questions that turn "I can loop over subsets" into "I can write the inner loop of a bitmask DP without bugs."

---

## Deeper Concepts

### The element-presence bijection, restated

Fix the universe `U = {0, 1, …, n-1}`. The map `S ↦ Σ_{i∈S} 2^i` is a bijection from subsets of `U` to integers in `[0, 2^n)`. Everything below is a different *walk* over this set of integers:

- **All subsets** — walk `0, 1, 2, …, 2^n − 1` (increasing integer order, equivalently "binary odometer" order).
- **Set bits of one mask** — walk the `1`-bits of a single integer.
- **Submasks of `mask`** — walk the integers `s` with `s & mask == s`.
- **Supersets of `mask`** — walk the integers `s` with `s & mask == mask`.
- **Fixed-size subsets** — walk integers with a fixed popcount (Gosper's hack).

Each walk has its own idiom and its own cost; choosing the right one is the skill.

### Why bitwise set algebra is exact

A machine word is itself an array of `w` bits (32 or 64). `a & b`, `a | b`, `a ^ b` apply the boolean operation bit-by-bit in parallel in one instruction. Intersection, union, and symmetric difference of two subsets of `{0..w-1}` are therefore single-cycle operations. This is why bitmasks dominate small-set work: there is no data structure overhead, no hashing, no pointer chasing.

---

## Set-Bit Iteration with `m & -m`

### What `m & -m` computes

In two's complement, `-m == ~m + 1`. Flipping all bits and adding one turns every bit below the lowest set bit into `1` and the lowest set bit stays `1`, while everything above flips. AND-ing `m` with `-m` keeps only the position where both agree on `1` — which is exactly the **lowest set bit**:

```text
m      = 0b101100
-m     = 0b...010100   (two's complement)
m & -m = 0b000100      <- lowest set bit (value 4 = 2^2)
```

So `m & -m` is a mask containing only `m`'s lowest `1`. It is a *value* (a power of two), not an index. To get the index, take `log2` — or use a built-in (`bits.TrailingZeros`, `Long.numberOfTrailingZeros`, `(b).bit_length()-1`).

### The set-bit loop

```text
m = mask
while m != 0:
    b = m & -m          # lowest set bit value
    i = index_of(b)     # element id = trailing-zero count
    process element i
    m &= m - 1          # clear that lowest bit
```

`m &= m - 1` clears the lowest set bit (subtracting one borrows through the trailing zeros and flips the lowest `1` to `0`). The loop runs **exactly `popcount(mask)` times** — optimal, because it touches present elements only and never the absent ones. Compare to the naive `for i in 0..n-1: if mask & (1<<i)` which always costs `n`.

---

## Submask Enumeration: the `(s-1) & mask` Loop

### The idiom

```text
s = mask
while s != 0:
    process submask s
    s = (s - 1) & mask
process submask 0          # the empty submask, handled once
```

### Why it visits each submask exactly once, in decreasing order

A **submask** of `mask` is any `s` with `s & mask == s` (all of `s`'s bits lie inside `mask`). Claim: starting from `s = mask` and repeatedly applying `s = (s - 1) & mask` enumerates all submasks in strictly decreasing order and terminates at `0`.

**Step intuition.** Consider the bits of `mask` as the only "live" positions; bits outside `mask` are always `0` in any submask. Subtracting `1` from `s` performs the standard binary decrement; AND-ing with `mask` immediately re-zeroes any borrow that spilled into a non-`mask` position. The net effect is: **decrement `s` within the restricted bit-positions of `mask`.** Restricting a decrement to a fixed set of bit positions is exactly counting *down* on a `popcount(mask)`-bit odometer.

**Decreasing.** `(s - 1) & mask < s` for any non-zero submask `s ⊆ mask`: removing the value `1` then masking can only keep or remove bits relative to `s - 1`, and `s - 1 < s`, and the mask never adds bits not already permitted. So each step strictly decreases the integer, guaranteeing termination.

**Hits every submask.** Because the operation is "decrement on the `mask`-restricted positions," and a `p`-bit counter (`p = popcount(mask)`) counts through all `2^p` values exactly once as it descends from all-ones to all-zeros, the loop visits **every** submask once. The full formal proof (a bijection with the integers `[0, 2^p)`) is in `professional.md`.

**Count.** There are exactly `2^popcount(mask)` submasks of `mask`. The loop visits the `2^p − 1` non-zero ones, and you handle `0` separately.

### The `O(3^n)` total — sum over all (mask, submask) pairs

A very common shape is:

```text
for mask in 0 .. 2^n - 1:
    s = mask
    while s:
        work(mask, s)
        s = (s - 1) & mask
    work(mask, 0)
```

How many total `(mask, submask)` iterations? Sum over all masks of `2^popcount(mask)`. Group masks by popcount `k`: there are `C(n, k)` masks with `k` bits, each contributing `2^k` submasks:

```text
Σ_{mask} 2^popcount(mask) = Σ_{k=0}^{n} C(n,k) · 2^k = (1 + 2)^n = 3^n
```

The middle equality is the **binomial theorem** `(1 + x)^n = Σ C(n,k) x^k` with `x = 2`. So the whole double loop is **`O(3^n)`**, not `O(2^n · 2^n) = O(4^n)`. This is the single most important counting fact of the topic; `professional.md` derives it rigorously.

Another way to see `3^n`: each element is independently in one of **three** states across a `(mask, submask)` pair — *out of mask*, *in mask but out of submask*, or *in submask*. Three choices per element, `n` elements, `3^n` pairs.

---

## Superset Enumeration

The dual of a submask is a **superset**: masks `s` with `mask ⊆ s`, i.e. `s & mask == mask`. Within an `n`-bit universe, enumerate them by walking the free bits (those *not* in `mask`):

```text
full = (1 << n) - 1
s = mask
while True:
    process superset s
    if s == full:
        break
    s = (s + 1) | mask     # advance over the free bits, keep mask bits set
```

Here `(s + 1) | mask` increments within the free positions while forcing `mask`'s bits to stay set. There are `2^(n - popcount(mask))` supersets. (Symmetrically, you can run submask enumeration on the *complement* and OR `mask` back in.) Supersets are used, e.g., in sum-over-supersets transforms (SOS DP), which `senior.md` references.

---

## Set Operations as Bitwise Operations

| Set operation | Bitwise | Note |
|---------------|---------|------|
| Union `A ∪ B` | `a \| b` | |
| Intersection `A ∩ B` | `a & b` | |
| Difference `A \ B` | `a & ~b` | mask `~b` to `n` bits if needed |
| Symmetric difference | `a ^ b` | elements in exactly one |
| Complement (within `n`) | `a ^ full` where `full = (1<<n)-1` | **not** plain `~a` — that flips high bits too |
| Subset test `A ⊆ B` | `(a & b) == a` | equivalently `(a & ~b) == 0` |
| Disjoint test `A ∩ B = ∅` | `(a & b) == 0` | |
| Membership `i ∈ A` | `(a >> i) & 1` | |
| Size `|A|` | `popcount(a)` | built-in instruction |

**The complement gotcha:** in a fixed-width integer, `~a` flips *all* `w` bits, including positions `≥ n` you never meant to use, producing a huge/negative value. The set complement within your universe is `a ^ ((1 << n) - 1)`. Forgetting this is one of the most common bitmask bugs.

---

## Fixed-Size Subsets

Sometimes you need only the subsets of a fixed size `k` (exactly `k` set bits). Two approaches:

1. **Filter:** iterate all `2^n` masks and keep those with `popcount(mask) == k`. Simple, but wastes work — you generate `2^n` masks to keep only `C(n, k)`.
2. **Gosper's hack:** jump directly from one `k`-bit mask to the next in increasing order, generating **only** the `C(n, k)` valid masks. The kernel:

```text
c = lowest k-bit mask = (1 << k) - 1
while c < (1 << n):
    process c
    # Gosper: next mask with the same popcount
    lo = c & -c
    lz = c + lo
    c = lz | (((c ^ lz) >> 2) / lo)
```

Gosper's hack and its derivation are the subject of sibling topic `05`; we only point to it here. Use it when `C(n, k) ≪ 2^n` (e.g. choosing 5 of 30 elements).

---

## Worked Example: Partition DP over Submasks

The submask loop earns its keep in dynamic programming where a set must be **split into pieces**. Consider: *partition `{0..n-1}` into groups, where some groups are "valid" (e.g. each group's items fit in a knapsack), minimizing the number of groups.* This is the canonical `O(3^n)` shape.

Let `dp[mask]` = the minimum number of valid groups that exactly cover the elements in `mask`. Base case `dp[0] = 0`. Transition: for a non-empty `mask`, try every submask `sub ⊆ mask` that forms **one** valid group, and take `dp[mask] = min over valid sub of (1 + dp[mask ^ sub])`. To avoid double counting, a standard trick fixes the lowest set bit of `mask` to always be in `sub` (so each partition is generated once):

```text
for mask in 1 .. 2^n - 1:
    low = mask & -mask            # force lowest element into the group
    sub = mask
    while sub:
        if (sub & low) and valid(sub):
            dp[mask] = min(dp[mask], 1 + dp[mask ^ sub])
        sub = (sub - 1) & mask
```

Why is the total cost `O(3^n)`? The outer loop is over `2^n` masks; for each, the inner submask loop runs `2^popcount(mask)` times; summing gives `Σ_mask 2^popcount(mask) = 3^n` (Theorem 7 in `professional.md`). The `(sub & low)` guard does not change the asymptotic bound — it merely halves the constant by skipping submasks that omit the anchor element. The `valid(sub)` predicate is usually precomputed for all `2^n` masks in advance so the inner step stays `O(1)`.

This single pattern — *iterate masks, split each into a group plus the remainder via the submask loop* — underlies a large family of problems: minimum set cover by exact groups, scheduling jobs into rounds, coloring, and the assignment/TSP DPs of sibling `13/06-bitmask-dp`. Recognizing it lets you immediately quote the `3^n` budget and decide feasibility.

---

## Iteration Orders and Lattice Structure

Subsets of `{0..n-1}` form a **Boolean lattice** ordered by `⊆`, and different enumeration idioms walk this lattice in different orders. Knowing the order matters for DP correctness (you must process a state only after its dependencies).

- **Increasing integer order** (`for mask in 0..2^n-1`) is a **topological order of the subset lattice**: every proper submask `s ⊊ mask` satisfies `s < mask` as an integer, so `s` is processed before `mask`. This is exactly why DPs that read `dp[smaller submask]` can use the plain increasing loop — dependencies are already computed. (Likewise, decreasing integer order is topological for superset-dependent DPs.)
- **Decreasing order within a fixed mask** is what the submask loop produces; it visits `mask` first and `0` last.
- **By popcount (size) order** is what Gosper's hack within each size, swept over sizes, produces; useful when transitions go strictly from size `k` to size `k+1`.
- **Gray-code order** visits subsets so that consecutive masks differ in exactly one bit (`mask ^ (mask >> 1)` generates the reflected Gray code). This is valuable when the per-subset work can be *incrementally updated* by adding or removing a single element rather than recomputed from scratch — turning an `O(2^n · n)` recompute into `O(2^n)` incremental updates.

The practical rule: if your DP reads from submasks, the increasing integer loop is automatically a valid order — you do not need to sort or recurse. This is one of the quiet reasons bitmask DP is so clean.

---

## Comparison with Alternatives

| Need | Bitmask approach | Alternative | When alternative wins |
|------|------------------|-------------|------------------------|
| All subsets, small `n` | `for mask in 0..2^n-1` | recursive include/exclude backtracking | recursion when you need pruning / lexicographic shapes |
| Set algebra, small universe | bitwise ops on one int | `set` / hash set | universe larger than word size |
| Set algebra, large universe | array of words (bitset) | hash set | very sparse sets |
| Subsets of a fixed mask | `(s-1)&mask` loop | filter all `2^n` by `& mask` | almost never — the loop is `2^popcount`, far fewer |
| Fixed-size subsets | Gosper's hack | filter by popcount | filter only when `k` near `n/2` and code simplicity matters |
| Mask as DP state | bitmask DP (sibling `13/06`) | plain DP / memo on other state | when the natural state is not a small set |

---

## Code Examples

### Submask Enumeration and the `3^n` Counter

#### Go

```go
package main

import "fmt"

// visit every submask of mask exactly once (including 0).
func forEachSubmask(mask int, visit func(int)) {
	for s := mask; ; s = (s - 1) & mask {
		visit(s)
		if s == 0 {
			break
		}
	}
}

func main() {
	n := 4
	total := 0
	for mask := 0; mask < (1 << n); mask++ {
		forEachSubmask(mask, func(s int) { total++ })
	}
	fmt.Println("total (mask, submask) pairs =", total) // 3^4 = 81
}
```

#### Java

```java
import java.util.function.IntConsumer;

public class Submasks {
    static void forEachSubmask(int mask, IntConsumer visit) {
        int s = mask;
        while (true) {
            visit.accept(s);
            if (s == 0) break;
            s = (s - 1) & mask;
        }
    }

    public static void main(String[] args) {
        int n = 4, total = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            int[] cnt = {0};
            forEachSubmask(mask, s -> cnt[0]++);
            total += cnt[0];
        }
        System.out.println("total (mask, submask) pairs = " + total); // 81 = 3^4
    }
}
```

#### Python

```python
def for_each_submask(mask):
    s = mask
    while True:
        yield s
        if s == 0:
            break
        s = (s - 1) & mask


if __name__ == "__main__":
    n = 4
    total = sum(1 for mask in range(1 << n) for _ in for_each_submask(mask))
    print("total (mask, submask) pairs =", total)  # 81 = 3^4
```

### Set-Bit Iteration and Set Operations

#### Python

```python
def iterate_set_bits(mask):
    m = mask
    while m:
        b = m & -m              # lowest set bit (value)
        yield b.bit_length() - 1  # element index
        m &= m - 1


def complement(mask, n):
    return mask ^ ((1 << n) - 1)   # NOT ~mask


def is_subset(a, b):
    return (a & b) == a            # a subset of b?


if __name__ == "__main__":
    print(list(iterate_set_bits(0b101101)))  # [0, 2, 3, 5]
    print(bin(complement(0b101, 4)))          # 0b1010
    print(is_subset(0b101, 0b111))            # True
```

### Gray-Code Enumeration (single-bit-change order)

Visit all `2^n` subsets so that consecutive masks differ in exactly one element — enabling incremental updates.

#### Go

```go
package main

import "fmt"

func main() {
	n := 3
	prev := 0
	for i := 0; i < (1 << n); i++ {
		gray := i ^ (i >> 1) // reflected Gray code
		changed := gray ^ prev
		// changed has exactly one bit (except i==0); identify the flipped element
		fmt.Printf("i=%d gray=%03b changedBit=%b\n", i, gray, changed)
		prev = gray
	}
}
```

#### Java

```java
public class GrayEnum {
    public static void main(String[] args) {
        int n = 3, prev = 0;
        for (int i = 0; i < (1 << n); i++) {
            int gray = i ^ (i >> 1);
            int changed = gray ^ prev;
            System.out.printf("i=%d gray=%s changedBit=%s%n",
                i, Integer.toBinaryString(gray), Integer.toBinaryString(changed));
            prev = gray;
        }
    }
}
```

#### Python

```python
def gray_enumerate(n):
    prev = 0
    for i in range(1 << n):
        gray = i ^ (i >> 1)          # reflected Gray code
        changed = gray ^ prev        # exactly one bit changes (for i>0)
        yield gray, changed
        prev = gray


if __name__ == "__main__":
    for g, c in gray_enumerate(3):
        print(f"gray={g:03b} changedBit={c:b}")
```

### Sum Over Submasks (SOS DP) — the `O(n·2^n)` alternative

When you need, for every mask, the sum of `f` over all its submasks, SOS DP beats the `O(3^n)` double loop.

#### Python

```python
def sos(f, n):
    # g[mask] = sum of f[s] over all s subset of mask
    g = f[:]
    for i in range(n):
        for mask in range(1 << n):
            if mask & (1 << i):
                g[mask] += g[mask ^ (1 << i)]
    return g


def naive_sos(f, n):
    g = [0] * (1 << n)
    for mask in range(1 << n):
        s = mask
        while True:
            g[mask] += f[s]
            if s == 0:
                break
            s = (s - 1) & mask
    return g


if __name__ == "__main__":
    n = 4
    f = list(range(1 << n))
    assert sos(f, n) == naive_sos(f, n)   # same answer, n*2^n vs 3^n
    print("SOS matches naive submask sum")
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Submask loop never ends | Used `while s:` so `0` never emitted, then re-entered, or no break in `for(;;)`. | Emit `0`, then break: `if s == 0: break`. |
| `~mask` gives huge/negative | Used raw NOT for complement. | Use `mask ^ ((1<<n)-1)`. |
| Wrong superset count | Incremented over all bits, not just free bits. | `s = (s + 1) \| mask`. |
| Index/value confusion | Used `m & -m` directly as an array index. | Convert via trailing-zero count. |
| Off-by-one upper bound | Looped `mask <= (1<<n)` or used `1<<n` as full mask. | Bound `mask < (1<<n)`; full is `(1<<n)-1`. |
| Slow fixed-size enumeration | Filtered `2^n` masks by popcount. | Use Gosper's hack (sibling `05`). |

---

## Performance Analysis

- **Set-bit loop:** `Θ(popcount(mask))`, optimal. Naive bit scan is `Θ(n)` regardless of how few bits are set.
- **Submask loop for one mask:** `Θ(2^popcount(mask))` iterations.
- **Submasks over all masks:** `Θ(3^n)` (binomial sum). Feasible to `n ≈ 16–18`.
- **All subsets:** `Θ(2^n)`; with per-mask bit scan `Θ(2^n · n)`. Feasible to `n ≈ 20–25`.
- **Supersets of one mask:** `Θ(2^(n − popcount(mask)))`.
- **Built-ins:** `popcount`, trailing-zeros, and leading-zeros map to single instructions (`POPCNT`, `TZCNT`/`BSF`) — prefer them over manual loops in hot code.

The decisive insight: the submask double loop is `3^n`, not `4^n`. That gap (e.g. at `n = 16`, `3^16 ≈ 4.3·10^7` vs `4^16 ≈ 4.3·10^9`) is the difference between instant and unusable.

---

## Best Practices

- Always emit the empty submask `0` deliberately — decide whether your algorithm needs it.
- Use the `for (s = mask; ; s = (s-1)&mask) { …; if (s==0) break; }` form to include `0` cleanly without an extra statement.
- Use `mask ^ full` for complement; reserve raw `~` for when you immediately re-mask.
- Reach for Gosper's hack only when `C(n,k) ≪ 2^n`; otherwise the filter is simpler and fast enough.
- Prefer built-in `popcount`/`trailing-zeros` over hand-rolled loops.
- Keep the universe within the integer width (`n ≤ 62` for signed 64-bit), and assert it.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - **Mode 1:** the all-subsets odometer `0 .. 2^n − 1`, bits lighting up per step
> - **Mode 2:** the submask walk `s = (s - 1) & mask`, showing each submask of a chosen mask in decreasing order and counting that there are exactly `2^popcount(mask)` of them
> - Adjustable `n` and `mask`, Play / Pause / Step / Reset

---

## Summary

The middle-level toolkit is three idioms plus their costs. `m & -m` isolates the lowest set bit so the set-bit loop runs in `popcount` steps; `s = (s - 1) & mask` decrements within `mask`'s live bit positions, visiting every submask exactly once in decreasing order; supersets are the dual, advanced with `(s + 1) | mask`. Set operations are single bitwise instructions — but complement must be `mask ^ ((1<<n)-1)`, never raw `~`. Summing `2^popcount(mask)` over all masks gives `Σ C(n,k) 2^k = 3^n` by the binomial theorem, so "submasks of every mask" is `O(3^n)`. For fixed-size subsets, jump straight to the valid masks with Gosper's hack (sibling `05`). These idioms are the inner loops of bitmask DP (sibling `13/06`).

---

## Key Takeaways

- `m & -m` isolates the lowest set bit; `m &= m - 1` clears it — together they give a `popcount`-step set-bit loop.
- `s = (s - 1) & mask` is a *restricted decrement*: it walks all `2^popcount(mask)` submasks once, in decreasing order, and must break on `s == 0`.
- Supersets are the dual, advanced with `(s + 1) | mask`.
- Set algebra maps to bitwise ops; complement is `mask ^ ((1<<n)-1)`, never raw `~`.
- `Σ_mask 2^popcount(mask) = 3^n`, so the submask double loop is `O(3^n)`, not `O(4^n)`.
- Need an aggregate over submasks, not each pair? Use SOS DP at `O(n·2^n)`.
- Increasing-mask order is a topological order of the subset lattice — submask-dependent DP needs no extra sorting.
- Gray-code order (`mask ^ (mask >> 1)`) changes one element per step, enabling `O(2^n)` incremental enumeration when subset work is incrementally updatable.
- Always confirm whether the empty subset participates in your answer, and handle it deliberately in every loop.

---

## Further Reading

- Sibling `05` — Gosper's hack for fixed-size subset enumeration in order.
- Sibling `13/06-bitmask-dp` — mask-as-state DP (set cover, TSP, assignment).
- `professional.md` (this topic) — the formal `3^n` derivation and submask-bijection proof.
- cp-algorithms.com — "Submask enumeration" and "Sum over subsets (SOS DP)".
- *Hacker's Delight* (Warren) — `x & -x`, `x & (x-1)`, population count.
- *Competitive Programmer's Handbook* (Laaksonen) — bit manipulation chapter.

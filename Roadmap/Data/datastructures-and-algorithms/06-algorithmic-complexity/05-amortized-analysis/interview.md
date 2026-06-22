# Amortized Analysis — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Applied Questions](#applied-questions)
3. [Gotcha / Trick Questions](#gotcha--trick-questions)
4. [Coding Challenge](#coding-challenge)
5. [Rapid-Fire Q&A](#rapid-fire-qa)
6. [Common Mistakes](#common-mistakes)
7. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is amortized analysis? *(Easy)*

**Answer**: Amortized analysis measures the **average cost per operation over a worst-case sequence** of operations. Instead of bounding a single operation, you bound the *total* cost of `n` operations and divide by `n`. If `n` operations cost `O(n)` in total, each operation is `O(1)` amortized — even if one individual operation occasionally costs `O(n)`.

The key word is **sequence**: the bound is a guarantee about the aggregate, not a probabilistic claim about a typical call.

### Q2: How does amortized differ from average-case and worst-case? *(Medium)*

This is the single most common confusion. Nail the distinction:

| Analysis | What it bounds | Source of "averaging" |
|----------|----------------|------------------------|
| **Worst-case** | The slowest *single* operation | None — it's a hard per-op ceiling |
| **Average-case** | Expected cost over a *random input distribution* | Probability — assumes inputs are random |
| **Amortized** | Total cost of *any* sequence, divided by length | Accounting over the sequence — **no probability** |

The crucial point: **amortized analysis makes no assumptions about input distribution.** Average-case says "if your data is random, each op is cheap on average." Amortized says "*no matter what* sequence an adversary picks, the total is bounded." That is a strictly stronger, deterministic guarantee.

### Q3: What are the three methods of amortized analysis, and when do you use each? *(Medium)*

1. **Aggregate method** — Compute the total cost `T(n)` of `n` operations directly, then the amortized cost is `T(n)/n`. Simplest; best when all operations are the same type and the total is easy to sum.
2. **Accounting (banker's) method** — Assign each operation an *amortized charge*. Cheap operations are overcharged; the surplus is stored as **credit** on data-structure elements and spent later to pay for expensive operations. Best when you can intuitively "prepay" for future work.
3. **Potential (physicist's) method** — Define a **potential function** `Φ(D)` mapping the data structure's state to a real number. The amortized cost is `actual cost + Φ(Dᵢ) − Φ(Dᵢ₋₁)`. The most powerful and general; best when credit is awkward to localize. Requires `Φ(Dₙ) ≥ Φ(D₀)` (usually `Φ ≥ 0`, `Φ(D₀) = 0`) so amortized cost upper-bounds actual cost.

All three give the same bound; they are different bookkeeping lenses on the same truth. See [middle.md](./middle.md) for worked derivations.

---

## Applied Questions

### Q4: Prove a dynamic-array push is O(1) amortized using the accounting method. *(Medium)*

**Setup**: A push appends one element. When the array is full (size = capacity), we **double** the capacity and copy all existing elements, costing `O(size)`.

**Accounting**: Charge **3 units** per push (amortized cost `O(1)`).
- 1 unit pays for inserting the new element itself.
- 2 units are saved as **credit** on that element.

When the array doubles from capacity `c` to `2c`, the `c` elements that must be copied are exactly the `c/2` elements inserted *since the last resize* — and each of those carries 2 saved credits. Wait, more precisely: after a resize to capacity `c`, the array holds `c/2` elements with no credit. The next `c/2` pushes fill it; each saves 2 credits, accumulating `c` credits total. The next push triggers a copy of all `c` elements, costing `c` units — exactly covered by the `c` saved credits. Credit never goes negative, so 3 units/push is a valid amortized bound → **O(1) amortized**.

### Q5: Now prove the same with the potential method. *(Hard)*

Define the potential `Φ(D) = 2·size − capacity`.
- Right after a resize, `size = capacity/2`, so `Φ = 2·(c/2) − c = 0`. Φ is at its minimum and never negative (size is always ≥ capacity/2 between resizes), with `Φ(D₀) = 0`. ✓

**Non-resizing push** (`size` → `size+1`, capacity unchanged):
- actual cost = 1
- `ΔΦ = 2(size+1) − capacity − (2·size − capacity) = 2`
- amortized = `1 + 2 = 3 = O(1)` ✓

**Resizing push** (array full: `size = capacity = c`, then capacity → `2c`):
- actual cost = `c + 1` (copy `c` elements + insert 1)
- before: `Φ = 2c − c = c`; after: `Φ = 2(c+1) − 2c = 2`
- `ΔΦ = 2 − c`
- amortized = `(c + 1) + (2 − c) = 3 = O(1)` ✓

Both cases give amortized cost **3 → O(1) amortized**, matching the accounting result.

### Q6: Analyze the binary counter increment. *(Medium)*

A `k`-bit counter starts at 0; we call `increment` `n` times. A single increment can flip up to `k` bits (e.g., `0111 → 1000`), so worst-case per op is `O(k)`. But amortized it's **O(1)**.

**Aggregate argument**: Bit 0 flips every increment (`n` times). Bit 1 flips every 2nd increment (`n/2` times). Bit `i` flips every `2ⁱ`-th increment (`n/2ⁱ` times). Total flips:
```
Σ_{i≥0} n/2ⁱ = n · Σ 1/2ⁱ < 2n
```
Total cost `< 2n` over `n` increments → **O(1) amortized** per increment.

**Potential view**: let `Φ` = number of 1-bits. An increment that resets `t` ones to zero and sets one bit costs `t+1`, with `ΔΦ = 1 − t`; amortized = `(t+1) + (1−t) = 2 = O(1)`.

### Q7: What is the multipop stack and why is it O(1) amortized? *(Medium)*

A stack with `push`, `pop`, and `multipop(k)` which pops `min(k, size)` elements. A single `multipop` can cost `O(n)`, so naïvely a sequence of `n` operations looks like `O(n²)`.

**Key insight**: an element can be popped **at most once**, and only after it was pushed. So total pop work across the whole sequence ≤ total pushes ≤ `n`. The aggregate cost of any `n` operations is `O(n)` → **O(1) amortized** per operation. (Potential method: `Φ` = number of elements on the stack.)

### Q8: Why are splay-tree operations O(log n) amortized? *(Hard)*

A splay tree is a self-adjusting BST with **no balance information stored**. Every access *splays* the touched node to the root via rotations. Individual operations can be `O(n)` (a degenerate spine), but the amortized cost is `O(log n)`.

The proof uses the potential method with `Φ = Σ rank(x)`, where `rank(x) = log₂(size of x's subtree)`. The **Access Lemma** shows the amortized cost of splaying a node `x` is `≤ 3·(rank(root) − rank(x)) + 1 = O(log n)`. Splaying both restructures the tree toward balance and gives strong bonus properties: the **static-optimality** and **working-set** theorems mean splay trees are within a constant factor of the optimal static BST and adapt to access locality — for free, with no stored balance metadata.

### Q9: What does union-find's α(n) mean? *(Hard)*

With **union by rank** + **path compression**, a sequence of `m` union/find operations on `n` elements runs in `O(m · α(n))` total, i.e. `O(α(n))` amortized per operation.

`α(n)` is the **inverse Ackermann function** — it grows so slowly that for any input size in the physical universe (`n` up to ~`2^65536`), `α(n) ≤ 4`. So it is effectively, but **not exactly**, constant. This is Tarjan's classic result; the bound is tight (you cannot achieve true `O(1)` amortized with pointer-based structures). See [senior.md](./senior.md) for the structure of the proof.

---

## Gotcha / Trick Questions

### Q10: Is amortized O(1) the same as worst-case O(1)? When does the distinction matter? *(Hard)*

**No.** Amortized O(1) bounds the *average over a sequence*; worst-case O(1) bounds *every single operation*. They coincide only when no operation is ever expensive.

The distinction matters whenever **tail latency** matters:
- **Real-time / hard-deadline systems** (audio DSP, avionics, robotics control loops): a single `O(n)` resize that blows a frame deadline is a failure, even if the average is tiny. Amortized bounds say nothing about the worst single op.
- **Low-latency services** (trading, ad bidding): p99/p99.9 latency is what users feel. An amortized-O(1) `push` that occasionally stalls for an `O(n)` copy shows up as a latency spike.

Mitigations: pre-size containers to avoid resizes on the hot path, or use **incremental / de-amortized** structures (e.g., incremental rehashing, real-time deques) that spread the expensive work across many operations to get a *worst-case* per-op bound.

### Q11: Under amortized O(1), can a single operation still be slow? *(Medium)*

**Yes — absolutely.** Amortized O(1) explicitly *permits* occasional expensive operations; it only promises they are rare enough that the total stays linear. A dynamic-array push that triggers a resize is genuinely `O(n)` for that one call. Amortized analysis is a statement about the **aggregate**, never a per-operation ceiling. Anyone who says "amortized O(1) means every push is fast" has misunderstood it.

### Q12: A colleague says "amortized analysis assumes random inputs." Correct them. *(Medium)*

That's average-case analysis, not amortized. Amortized analysis is **worst-case over the sequence** and makes **no distributional assumption** — the bound holds even against an adversary who deliberately picks the most expensive sequence of operations. Conflating the two is the classic interview red flag.

---

## Coding Challenge

> Instrument a growable array to empirically demonstrate amortized O(1) push: count the total element-copy work over `n` pushes and show it stays linear (≈ 2n), so cost-per-push is bounded by a constant.

### Go

```go
package main

import "fmt"

type GrowableArray struct {
	data       []int
	size       int
	copyOps    int // total elements copied across all resizes
}

func (g *GrowableArray) Push(x int) {
	if g.size == cap(g.data) {
		newCap := 1
		if cap(g.data) > 0 {
			newCap = cap(g.data) * 2
		}
		grown := make([]int, g.size, newCap)
		g.copyOps += copy(grown, g.data) // count copied elements
		g.data = grown
	}
	g.data = append(g.data[:g.size], x)
	g.size++
}

func main() {
	g := &GrowableArray{}
	n := 1 << 20 // ~1M pushes
	for i := 0; i < n; i++ {
		g.Push(i)
	}
	// copyOps should be < 2n; cost per push < 2 + 1 = O(1)
	fmt.Printf("pushes=%d  copies=%d  copies/push=%.3f\n",
		n, g.copyOps, float64(g.copyOps)/float64(n))
}
```

### Java

```java
public class GrowableArray {
    private int[] data = new int[1];
    private int size = 0;
    private long copyOps = 0; // total elements copied

    void push(int x) {
        if (size == data.length) {
            int[] grown = new int[data.length * 2];
            System.arraycopy(data, 0, grown, 0, size);
            copyOps += size; // count copied elements
            data = grown;
        }
        data[size++] = x;
    }

    public static void main(String[] args) {
        GrowableArray g = new GrowableArray();
        int n = 1 << 20;
        for (int i = 0; i < n; i++) g.push(i);
        System.out.printf("pushes=%d  copies=%d  copies/push=%.3f%n",
            n, g.copyOps, (double) g.copyOps / n);
    }
}
```

### Python

```python
class GrowableArray:
    def __init__(self):
        self.data = [None]   # capacity 1
        self.size = 0
        self.copy_ops = 0    # total elements copied

    def push(self, x):
        if self.size == len(self.data):
            grown = [None] * (len(self.data) * 2)
            for i in range(self.size):   # explicit copy to count work
                grown[i] = self.data[i]
            self.copy_ops += self.size
            self.data = grown
        self.data[self.size] = x
        self.size += 1

g = GrowableArray()
n = 1 << 20
for i in range(n):
    g.push(i)
print(f"pushes={n}  copies={g.copy_ops}  copies/push={g.copy_ops / n:.3f}")
```

**Expected output**: `copies/push` converges to just **under 1.0** (total copies ≈ `n`, since copies sum to `1 + 2 + 4 + ... < n`). Adding the constant insertion work per push, total cost per push stays bounded by a constant → **O(1) amortized**, confirming the theory empirically.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Amortized cost of dynamic-array push? | `O(1)` |
| 2 | Worst-case cost of a *single* push? | `O(n)` (the resize) |
| 3 | Why double capacity instead of +1 each time? | +1 gives `O(n)` amortized; doubling gives `O(1)` (geometric growth) |
| 4 | Most general amortized method? | Potential (physicist's) method |
| 5 | Amortized cost of binary counter increment? | `O(1)` |
| 6 | Amortized cost per union-find op? | `O(α(n))` ≈ constant |
| 7 | Does amortized analysis assume random input? | No — it's worst-case over the sequence |
| 8 | Potential function for multipop stack? | `Φ` = number of elements on the stack |
| 9 | Splay-tree access amortized cost? | `O(log n)` |
| 10 | Fibonacci-heap `decrease-key` amortized cost? | `O(1)` |
| 11 | Fibonacci-heap `extract-min` amortized cost? | `O(log n)` |
| 12 | Required condition on `Φ` for a valid bound? | `Φ(Dₙ) ≥ Φ(D₀)`, typically `Φ ≥ 0` and `Φ(D₀)=0` |

---

## Common Mistakes

1. **Confusing amortized with average-case.** Amortized is deterministic and worst-case over the sequence; average-case is probabilistic over inputs. This is the #1 interview error.
2. **Claiming every operation is fast.** Amortized O(1) allows individual `O(n)` operations; it bounds only the aggregate.
3. **Forgetting the potential precondition.** If `Φ` can end below its start (or go negative), amortized costs may *understate* actual cost and the bound is invalid.
4. **Using +1 growth and expecting O(1).** Linear growth makes resizes cost `O(n²)` total → `O(n)` amortized. Geometric growth is what buys `O(1)`.
5. **Saying α(n) is exactly O(1).** It's inverse-Ackermann — effectively constant (≤ 4 in practice) but provably not true constant.
6. **Applying amortized bounds to real-time deadlines.** A hard per-op deadline needs a *worst-case* bound; amortized guarantees don't help with tail latency.

---

## Tips & Summary

- **Lead with the definition that disambiguates**: "average over a *worst-case sequence*, with no distributional assumptions." Saying this upfront signals you understand the subtlety interviewers probe for.
- **Know all three methods and pick deliberately**: aggregate for uniform operations, accounting when you can localize prepaid credit, potential for everything else (and when asked to prove the array bound rigorously).
- **Memorize the canonical Φ functions**: dynamic array `Φ = 2·size − capacity`; binary counter `Φ = #1-bits`; multipop stack `Φ = #elements`. These cover most questions.
- **Always raise tail latency unprompted** when asked if amortized = worst-case. Connecting it to p99 / real-time systems shows engineering maturity beyond the math.
- **For the canonical examples table**, be ready to state the bound *and* the method: array doubling, binary counter, multipop, splay trees, Fibonacci heap, union-find.

**Related:** [Time vs Space Complexity — Interview](../01-time-vs-space-complexity/interview.md) · [Amortized Analysis — Middle](./middle.md) · [Amortized Analysis — Senior](./senior.md)

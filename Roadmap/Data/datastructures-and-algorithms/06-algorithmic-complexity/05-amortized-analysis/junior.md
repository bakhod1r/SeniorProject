# Amortized Analysis — Junior Level

> **Audience:** You know Big-O basics (O(1), O(n), O(n²)) but have never met the word "amortized."
> **Read time:** ~30 minutes. **Focus:** "What is it?" and "Why is `append` called O(1) when it sometimes copies the whole array?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Hook: Why Is `append` O(1)?](#the-hook-why-is-append-o1)
5. [Worst-Case-Per-Operation vs Amortized](#worst-case-per-operation-vs-amortized)
6. [Amortized Is NOT Average-Case](#amortized-is-not-average-case)
7. [Technique 1: The Aggregate Method](#technique-1-the-aggregate-method)
8. [Worked Example: Dynamic Array Doubling](#worked-example-dynamic-array-doubling)
9. [Worked Example: The Binary Counter](#worked-example-the-binary-counter)
10. [Technique 2: The Accounting (Banker's) Method](#technique-2-the-accounting-bankers-method)
11. [Technique 3: The Potential Method (Gentle Intro)](#technique-3-the-potential-method-gentle-intro)
12. [Worked Example: The Multipop Stack](#worked-example-the-multipop-stack)
13. [Big-O Summary](#big-o-summary)
14. [Code Examples](#code-examples)
15. [Real-World Analogies](#real-world-analogies)
16. [Common Misconceptions](#common-misconceptions)
17. [Common Mistakes](#common-mistakes)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

## Introduction

Some operations are usually cheap but *occasionally* expensive. Appending to a growable array is the classic case: almost every `append` just drops a value into a free slot in O(1) time, but every so often the array runs out of room and has to copy *every* element into a bigger block — an O(n) operation.

So what is the "real" cost of `append`? If you only looked at the worst single call, you would say O(n), and you would write off growable arrays as slow. But that is misleading, because those expensive copies are *rare*. The honest answer comes from **amortized analysis**: spread the cost of the rare expensive operations across the many cheap ones, and ask what each operation costs *on average over the whole sequence*.

The punchline for the dynamic array: a sequence of `n` appends costs O(n) total, so each `append` costs **O(1) amortized** — even though one individual `append` can cost O(n).

The crucial word in that sentence is **sequence**. Amortized analysis is still a **worst-case** guarantee — it makes no assumptions about lucky or unlucky inputs. It just measures cost *per operation across a worst-case sequence* instead of *per individual operation*. Getting that distinction right is the whole point of this lesson.

---

## Prerequisites

- **Required:** Big-O basics — what O(1), O(n), and O(n²) mean. See [Big-O Notation](../04-asymptotic-notation/01-big-o-notation/junior.md).
- **Required:** Knowing how to count operations in a loop. See [How to Calculate Complexity](../02-how-to-calculate-complexity/junior.md).
- **Required:** Familiarity with arrays and stacks. See [Basic Data Structures](../../05-basic-data-structures/).
- **Helpful:** Comfort with simple sums like `1 + 2 + 4 + ... + n` (geometric series). We will explain the ones we use.
- **Helpful:** The idea of best/worst/average case from [Time vs Space Complexity](../01-time-vs-space-complexity/junior.md).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Amortized cost** | The average cost of one operation, taken over a worst-case sequence of operations. |
| **Aggregate method** | Compute the total cost of `n` operations, then divide by `n`. |
| **Accounting method** | Charge each operation a fixed "amortized" price; bank the surplus as **credit** to pay for later expensive operations. |
| **Potential method** | Track a number Φ ("potential") describing the data structure's state; amortized cost = actual cost + change in Φ. |
| **Credit** | Pre-paid "savings" stored conceptually on the data structure to cover a future expensive step. |
| **Dynamic array** | A growable array (Go slice, Java `ArrayList`, Python `list`) that resizes itself as you add elements. |
| **Table doubling** | The resize strategy where a full array is replaced by one of double the capacity. |
| **Resize / copy** | The expensive O(n) step of moving all existing elements into a new, larger array. |
| **Sequence** | A run of operations performed one after another (e.g., `n` appends). |
| **Worst case** | The most expensive input/sequence; amortized analysis still assumes this. |

---

## The Hook: Why Is `append` O(1)?

Let's build a growable array by hand to see the problem.

A dynamic array stores two things: a fixed-size block of memory (its **capacity**), and a count of how many slots are filled (its **length**). When you append:

1. If there is a free slot (`length < capacity`), drop the value in and increment `length`. **Cost: O(1).**
2. If the block is full (`length == capacity`), you must:
   - allocate a new block, usually **twice** the old capacity,
   - copy all `length` existing elements into it (**cost: O(n)**),
   - then drop the new value in.

Step 2 is the scary one. It touches every existing element. If you judge `append` by its worst single call, it is O(n).

But here is the trick: **how often does step 2 happen?** With doubling, capacity goes `1 → 2 → 4 → 8 → 16 → ...`. A resize only fires when you cross one of those boundaries. Out of the first 16 appends, only 5 of them trigger a copy (at sizes 1, 2, 4, 8, 16). The other 11 are pure O(1). As the array grows, resizes get rarer *and* the gaps between them get longer.

The question amortized analysis answers precisely: **when the cheap appends vastly outnumber the expensive ones, what is the cost per append averaged over the whole run?** Spoiler: O(1). We will prove it three different ways.

---

## Worst-Case-Per-Operation vs Amortized

This is the single most important idea in the lesson, so let's nail it before any math.

- **Worst-case-per-operation** asks: *what is the most expensive a single call can be?* For `append`, the answer is O(n) (a resize). This number is *true* but *pessimistic* — it assumes every call might be the expensive one, which is impossible: most calls cannot be resizes.

- **Amortized cost** asks: *what is the cost per operation, averaged over a whole sequence, assuming the worst possible sequence?* For `append`, the answer is O(1). It accounts for the fact that expensive calls are spaced out and paid for by the cheap ones around them.

Think of it like a subscription with an annual fee. Once a year you pay $120 (the expensive "resize"). The other 364 days you pay nothing. Your worst single day costs $120, but your *amortized* daily cost is $120 / 365 ≈ $0.33. Both numbers are correct; they answer different questions. When you run the service for a full year, the $0.33/day figure is the honest one.

> **Why this matters in practice:** If you reported `append` as O(n) per call, you would conclude that building a list of `n` items by appending is O(n²) — and you would invent complicated workarounds to avoid it. The amortized truth is that it is O(n) total, perfectly fine. Amortized analysis stops you from being needlessly pessimistic about correct, fast data structures.

---

## Amortized Is NOT Average-Case

Beginners constantly confuse these two. They are different, and the difference is about **where the averaging comes from**.

| | Average-case analysis | Amortized analysis |
|---|---|---|
| **Averages over...** | random *inputs* (a probability distribution) | a *sequence of operations* |
| **Assumes about input** | inputs are random / follow some distribution | nothing — input can be adversarial |
| **Guarantee strength** | "on average, if your data is typical" | "always, for any sequence" (a worst-case bound) |
| **Example** | quicksort is O(n log n) *on average* over random pivots | array `append` is O(1) *amortized* over any sequence |

The key phrase: **amortized analysis makes no probabilistic assumptions.** Quicksort's average case can be defeated by a maliciously ordered input (it degrades to O(n²)). The dynamic array's amortized O(1) **cannot** be defeated — there is no sequence of appends that makes the per-append average worse than O(1). That guarantee holds for *every* input, which is exactly what "worst case" means.

So: amortized = worst-case cost, just measured per-operation-across-a-sequence rather than per-individual-operation. It is *not* a weaker, probabilistic claim.

---

## Technique 1: The Aggregate Method

The simplest of the three techniques, and the one to learn first.

> **Aggregate method:** Compute the **total** cost `T(n)` of a sequence of `n` operations in the worst case. The amortized cost per operation is just `T(n) / n`.

That's it. No credit, no potential function — just a total divided by a count. The clever part is computing the total without overcounting the rare expensive operations. The aggregate method gives every operation in the sequence the *same* amortized cost (the average), which is fine for our examples since they involve one repeated operation.

We'll apply it twice: to the dynamic array and to the binary counter.

---

## Worked Example: Dynamic Array Doubling

Let's append `n` elements to an initially empty array that doubles its capacity (starting at capacity 1) whenever it fills up. We count the **cost of each append** as 1 (writing the new element) plus the cost of any copy it triggers.

A resize that fires when the array holds `k` elements must copy those `k` elements, costing `k`. With doubling from capacity 1, resizes fire right *before* the appends that would overflow capacities 1, 2, 4, 8, ... — copying 1, 2, 4, 8, ... elements respectively.

Here is the cost of the first 17 appends. "Copy cost" is the elements moved during that append; "total" is copy + 1 for the write.

| Append # | Capacity before | Resize? | Copy cost | This append's cost |
|---------:|----------------:|:-------:|----------:|-------------------:|
| 1 | 1 | no | 0 | 1 |
| 2 | 1 | yes (copy 1) | 1 | 2 |
| 3 | 2 | yes (copy 2) | 2 | 3 |
| 4 | 4 | no | 0 | 1 |
| 5 | 4 | yes (copy 4) | 4 | 5 |
| 6 | 8 | no | 0 | 1 |
| 7 | 8 | no | 0 | 1 |
| 8 | 8 | no | 0 | 1 |
| 9 | 8 | yes (copy 8) | 8 | 9 |
| 10–16 | 16 | no | 0 | 1 each |
| 17 | 16 | yes (copy 16) | 16 | 17 |

Notice the rhythm: an expensive spike, then a longer and longer stretch of cheap O(1) appends. Now total the cost of `n` appends.

**The writes:** every append writes one element, contributing `n` total. That's the easy part.

**The copies:** across all appends, the copy costs are `1 + 2 + 4 + 8 + ... ` up to the largest power of two below `n`. This is a **geometric series**, and it has a beautiful property:

```
1 + 2 + 4 + 8 + ... + 2^k = 2^(k+1) - 1 < 2 * 2^k <= 2n
```

In words: the sum of all those doubling copy costs is **less than 2n** — it never exceeds twice the final size. (Intuition: each term is bigger than the sum of all terms before it, so the last term dominates, and the last term is at most `n`.)

**Total cost:**

```
T(n) = writes + copies < n + 2n = 3n = O(n)
```

**Amortized cost per append:**

```
T(n) / n  <  3n / n  =  3  =  O(1)
```

There it is. The total work to append `n` elements is O(n), so each append is **O(1) amortized**, even though individual appends cost as much as O(n). The expensive copies are real, but they are so rare and so well-spaced that, summed up, they only add a constant per append.

> **Why doubling specifically?** The doubling is what keeps the series geometric and the total at O(n). If instead you grew the array by adding a *fixed* number of slots (say +1 each time), every append would copy, the copies would sum to `1 + 2 + 3 + ... + n = n(n+1)/2 = O(n²)`, and the amortized cost would balloon to O(n) per append. Geometric growth (×2, ×1.5, anything ×constant) is what buys you O(1) amortized. This is exactly why real growable arrays grow multiplicatively, never additively.

---

## Worked Example: The Binary Counter

A second classic, and a great sanity check because it has nothing to do with arrays.

Imagine a binary counter stored as an array of bits, and you call `increment` repeatedly: `0000 → 0001 → 0010 → 0011 → ...`. The **cost of an increment** is the number of bits it flips.

Incrementing flips a run of trailing 1s to 0s, then flips one 0 to 1. Sometimes that's one flip (`...0` becomes `...1`), and sometimes it's a cascade (`0111` becomes `1000` — four flips). The worst single increment flips all `k` bits, so worst-case-per-operation is O(k) where k = number of bits. But how about amortized over `n` increments?

Watch how often each bit position flips as we count from 0:

| After increment | Value | Bit 0 flips? | Bit 1 flips? | Bit 2 flips? | Bits flipped this step |
|----------------:|------:|:---:|:---:|:---:|---:|
| 1 | 0001 | yes | | | 1 |
| 2 | 0010 | yes | yes | | 2 |
| 3 | 0011 | yes | | | 1 |
| 4 | 0100 | yes | yes | yes | 3 |
| 5 | 0101 | yes | | | 1 |
| 6 | 0110 | yes | yes | | 2 |
| 7 | 0111 | yes | | | 1 |
| 8 | 1000 | yes | yes | yes | 4 |

**The aggregate insight — count by bit, not by increment.** Instead of asking "how much did each increment cost," ask "how many times does each *bit* flip over `n` increments?"

- **Bit 0** (the lowest) flips on *every* increment → `n` flips.
- **Bit 1** flips every *other* increment → `n/2` flips.
- **Bit 2** flips every *fourth* increment → `n/4` flips.
- **Bit i** flips every `2^i`-th increment → `n / 2^i` flips.

Total flips across all bits:

```
n + n/2 + n/4 + n/8 + ...  =  n * (1 + 1/2 + 1/4 + ...)  <  n * 2  =  2n
```

That same geometric series again — it sums to less than `2n`. So `n` increments cost less than `2n` bit-flips total, which is O(n). Divide by `n`:

```
Amortized cost per increment  <  2n / n  =  2  =  O(1)
```

Each `increment` is **O(1) amortized**, even though a single increment can flip all `k` bits. The expensive cascades happen exactly when they are rare enough to be paid for by all the cheap single-flip increments around them.

---

## Technique 2: The Accounting (Banker's) Method

The aggregate method gives a clean total, but it averages everything uniformly. The **accounting method** is more flexible and often more intuitive: you decide a fixed *price* to charge for each operation, and you save the surplus as **credit** to pay for future expensive operations.

> **The rule:** Pick an **amortized charge** for each operation. If the charge is more than the real cost, **bank the difference as credit** stored on the data structure. If the charge is less than the real cost, **pay the difference using banked credit**. As long as your credit balance never goes negative, the total amortized charge is a valid upper bound on the total real cost.

The discipline is: *prepay for the expensive step while doing the cheap steps, so that when the expensive step arrives, the money is already there.*

**Dynamic array with the banker's method.** Charge each `append` an amortized cost of **3**:

- **1** pays for actually writing the new element (its real cost when no resize happens).
- **2** is banked as credit — saved on the element just added.

Why 2 saved per element? Because when a resize fires at size `k`, it must copy `k` elements. We need `k` units of credit on hand to pay for that copy. Here's the accounting that makes it work: after a resize that brings the array to capacity, the array is *empty of credit* but you then fill the second half of the new capacity with fresh appends. Each of those appends banks 2 credits. By the time the array is full again and must copy all elements, every element that needs copying was added since the last resize and carries enough banked credit (2 each) to pay for itself being moved *and* to spare. The credit balance never goes negative.

Since the amortized charge is a constant **3** per append and credit never runs out, `append` is **O(1) amortized** — the same answer the aggregate method gave, reached by a different route.

> **The mental model:** Each cheap append "tips" a couple of credits into a jar. The expensive resize raids the jar. Because every element prepaid its own eventual move, the jar always has enough.

---

## Technique 3: The Potential Method (Gentle Intro)

The third technique is the most powerful (you'll use it constantly at the middle/senior levels), but it has the most machinery. We will introduce it gently here and save the heavy algebra for later.

> **The idea:** Define a number Φ ("**potential**") that measures how much "stored-up expensive work" the data structure currently has — like potential energy. The **amortized cost** of an operation is its **real cost plus the change in potential**:
>
> ```
> amortized cost = actual cost + (Φ_after − Φ_before)
> ```

How to read this:

- A **cheap** operation that *builds up* future trouble (raises Φ) gets *charged extra* — its amortized cost is higher than its real cost, banking the difference in Φ.
- An **expensive** operation that *relieves* trouble (drops Φ sharply) gets a *discount* — the big drop in Φ cancels most of its real cost.

The potential is just a bookkeeping device: a single number standing in for the "credit" of the accounting method. For the dynamic array, a workable potential is roughly "how close the array is to being full" — it climbs as you append into a nearly-full array (storing up the cost of the looming copy) and crashes right after a resize (when the array is half empty and far from another copy). That crash in Φ is what pays for the expensive copy, giving O(1) amortized.

You don't need the exact formula yet — just the shape of the idea: *amortized = actual + ΔΦ*, where Φ rises when trouble accumulates and falls when an expensive operation discharges it. The full potential function for the dynamic array, with the algebra worked out, is in the [middle level](./middle.md).

> **All three techniques agree.** Aggregate, accounting, and potential are three lenses on the same truth. For the dynamic array, all three conclude **O(1) amortized per append**. Pick whichever makes a given problem easiest to reason about — they never contradict each other.

---

## Worked Example: The Multipop Stack

A stack normally supports `push` and `pop`, each O(1). Now add a third operation, `multipop(k)`, which pops the top `k` elements (or until empty). One `multipop` can cost O(n) — it might pop the entire stack! So worst-case-per-operation for `multipop` is O(n). What about a *sequence* of pushes, pops, and multipops?

**The aggregate insight:** an element can only be popped **once**, and it can only be popped if it was **pushed** first. So across the whole sequence, the total number of pops (whether by `pop` or by `multipop`) can never exceed the total number of pushes.

If you perform a sequence of `n` operations starting from an empty stack:

- Pushes cost 1 each. At most `n` pushes → at most `n` units.
- Pops (including every pop done inside every multipop) also cost 1 each. But the *total* number of elements ever popped is at most the number ever pushed, which is ≤ `n`.

So the total cost of *any* sequence of `n` operations is at most `n + n = 2n = O(n)`. Divide by `n`:

```
Amortized cost per operation  <  2n / n  =  2  =  O(1)
```

Every operation — `push`, `pop`, and `multipop` — is **O(1) amortized**, despite `multipop` costing O(n) in the worst single call. The reason is the same as always: you can't pop what you never pushed, so the expensive multipops are bounded by the cheap pushes that fed them.

> This is the cleanest illustration of the core principle: **expensive operations are paid for by the cheap operations that set them up.** No element is popped without first being pushed, just as no array copy happens without first being filled by appends.

---

## Big-O Summary

| Operation | Worst case (single op) | Amortized (over a sequence) |
|-----------|:----------------------:|:---------------------------:|
| Dynamic array `append` (doubling) | O(n) — when it resizes | **O(1)** |
| Binary counter `increment` | O(k) — k = number of bits | **O(1)** |
| Stack `push` | O(1) | O(1) |
| Stack `pop` | O(1) | O(1) |
| Stack `multipop(k)` | O(k) ≤ O(n) | **O(1)** |
| Building a list of `n` items by appending | — | **O(n) total** (not O(n²)) |

> **Reading the table:** the right column is the number you should use when reasoning about a *whole program* that performs many of these operations. The middle column matters only when a *single* call's latency is critical (e.g., a real-time system that cannot tolerate one slow append — see the middle level for that nuance).

---

## Code Examples

### Example 1: Growable Array — Measuring Total vs Per-Op Cost

We build a dynamic array from scratch (with doubling) and count the *actual* element-copy + write work, then divide by `n` to see the amortized cost flatten out to a constant.

#### Go

```go
package main

import "fmt"

// GrowableArray is a hand-built dynamic array that counts its work.
type GrowableArray struct {
	data []int
	cost int // total writes + copies performed
}

func (g *GrowableArray) Append(x int) {
	if len(g.data) == cap(g.data) {
		// Resize: allocate double, copy everything over.
		newCap := cap(g.data) * 2
		if newCap == 0 {
			newCap = 1
		}
		bigger := make([]int, len(g.data), newCap)
		copy(bigger, g.data)
		g.cost += len(g.data) // copy cost = current length
		g.data = bigger
	}
	g.data = append(g.data, x)
	g.cost++ // write cost
}

func main() {
	for _, n := range []int{1000, 10000, 100000} {
		g := &GrowableArray{}
		for i := 0; i < n; i++ {
			g.Append(i)
		}
		fmt.Printf("n=%d  total cost=%d  amortized=%.2f per append\n",
			n, g.cost, float64(g.cost)/float64(n))
	}
}
```

#### Java

```java
public class GrowableArray {
    private int[] data = new int[0];
    private int size = 0;
    private long cost = 0; // total writes + copies

    public void append(int x) {
        if (size == data.length) {
            int newCap = data.length == 0 ? 1 : data.length * 2;
            int[] bigger = new int[newCap];
            for (int i = 0; i < size; i++) bigger[i] = data[i];
            cost += size;          // copy cost = current length
            data = bigger;
        }
        data[size++] = x;
        cost++;                    // write cost
    }

    public static void main(String[] args) {
        for (int n : new int[]{1000, 10000, 100000}) {
            GrowableArray g = new GrowableArray();
            for (int i = 0; i < n; i++) g.append(i);
            System.out.printf("n=%d  total cost=%d  amortized=%.2f per append%n",
                n, g.cost, (double) g.cost / n);
        }
    }
}
```

#### Python

```python
class GrowableArray:
    def __init__(self):
        self.data = [None] * 1   # capacity tracked manually
        self.size = 0
        self.cost = 0            # total writes + copies

    def append(self, x):
        if self.size == len(self.data):
            new_cap = len(self.data) * 2
            bigger = [None] * new_cap
            for i in range(self.size):
                bigger[i] = self.data[i]
            self.cost += self.size      # copy cost = current length
            self.data = bigger
        self.data[self.size] = x
        self.size += 1
        self.cost += 1                  # write cost

if __name__ == "__main__":
    for n in (1000, 10000, 100000):
        g = GrowableArray()
        for i in range(n):
            g.append(i)
        print(f"n={n}  total cost={g.cost}  amortized={g.cost / n:.2f} per append")
```

**What it does:** Counts the real work (copies + writes) for `n` appends. Across all three languages the amortized number hovers around **3 per append regardless of n** — the empirical proof that `append` is O(1) amortized while total cost is O(n).
**Run:** `go run main.go` | `javac GrowableArray.java && java GrowableArray` | `python growable_array.py`

---

### Example 2: Binary Counter — Total Bit-Flips Stay O(n)

We increment a binary counter `n` times and count every bit flipped. Total flips stay below `2n`, so amortized flips per increment stay below 2.

#### Go

```go
package main

import "fmt"

func main() {
	for _, n := range []int{1000, 10000, 100000} {
		bits := make([]int, 32)
		flips := 0
		for k := 0; k < n; k++ {
			i := 0
			for i < len(bits) && bits[i] == 1 {
				bits[i] = 0 // flip a trailing 1 to 0
				flips++
				i++
			}
			if i < len(bits) {
				bits[i] = 1 // flip the first 0 to 1
				flips++
			}
		}
		fmt.Printf("n=%d  total flips=%d  amortized=%.3f per increment\n",
			n, flips, float64(flips)/float64(n))
	}
}
```

#### Java

```java
public class BinaryCounter {
    public static void main(String[] args) {
        for (int n : new int[]{1000, 10000, 100000}) {
            int[] bits = new int[32];
            long flips = 0;
            for (int k = 0; k < n; k++) {
                int i = 0;
                while (i < bits.length && bits[i] == 1) {
                    bits[i] = 0;   // flip trailing 1 -> 0
                    flips++;
                    i++;
                }
                if (i < bits.length) {
                    bits[i] = 1;   // flip first 0 -> 1
                    flips++;
                }
            }
            System.out.printf("n=%d  total flips=%d  amortized=%.3f per increment%n",
                n, flips, (double) flips / n);
        }
    }
}
```

#### Python

```python
for n in (1000, 10000, 100000):
    bits = [0] * 32
    flips = 0
    for _ in range(n):
        i = 0
        while i < len(bits) and bits[i] == 1:
            bits[i] = 0          # flip trailing 1 -> 0
            flips += 1
            i += 1
        if i < len(bits):
            bits[i] = 1          # flip first 0 -> 1
            flips += 1
    print(f"n={n}  total flips={flips}  amortized={flips / n:.3f} per increment")
```

**What it does:** Counts every bit flipped over `n` increments. The amortized result stays under **2 flips per increment** for every `n` — matching the geometric-series argument exactly.

---

### Example 3: Multipop Stack — A Sequence Stays O(n)

We run a mixed sequence of `push` and `multipop` and confirm total work is linear in the number of operations.

#### Go

```go
package main

import "fmt"

type Stack struct {
	data []int
	cost int // total pushes + individual pops
}

func (s *Stack) Push(x int) {
	s.data = append(s.data, x)
	s.cost++
}

func (s *Stack) Multipop(k int) {
	for k > 0 && len(s.data) > 0 {
		s.data = s.data[:len(s.data)-1]
		s.cost++ // each individual pop counts as 1
		k--
	}
}

func main() {
	s := &Stack{}
	ops := 0
	for round := 0; round < 1000; round++ {
		for i := 0; i < 5; i++ { // five pushes
			s.Push(i)
			ops++
		}
		s.Multipop(3) // then a multipop
		ops++
	}
	fmt.Printf("ops=%d  total cost=%d  amortized=%.2f per op\n",
		ops, s.cost, float64(s.cost)/float64(ops))
}
```

#### Java

```java
import java.util.ArrayDeque;

public class MultipopStack {
    static ArrayDeque<Integer> data = new ArrayDeque<>();
    static long cost = 0;

    static void push(int x) { data.push(x); cost++; }

    static void multipop(int k) {
        while (k > 0 && !data.isEmpty()) {
            data.pop();
            cost++;          // each individual pop counts as 1
            k--;
        }
    }

    public static void main(String[] args) {
        long ops = 0;
        for (int round = 0; round < 1000; round++) {
            for (int i = 0; i < 5; i++) { push(i); ops++; }
            multipop(3); ops++;
        }
        System.out.printf("ops=%d  total cost=%d  amortized=%.2f per op%n",
            ops, cost, (double) cost / ops);
    }
}
```

#### Python

```python
data = []
cost = 0

def push(x):
    global cost
    data.append(x)
    cost += 1

def multipop(k):
    global cost
    while k > 0 and data:
        data.pop()
        cost += 1            # each individual pop counts as 1
        k -= 1

ops = 0
for _ in range(1000):
    for i in range(5):       # five pushes
        push(i)
        ops += 1
    multipop(3)              # then a multipop
    ops += 1

print(f"ops={ops}  total cost={cost}  amortized={cost / ops:.2f} per op")
```

**What it does:** Runs a mixed push/multipop sequence and divides total work by the operation count. The amortized cost stays a small constant, because no element is ever popped without first being pushed.

---

## Real-World Analogies

| Concept | Analogy |
|---------|--------|
| **Amortized cost** | A yearly subscription billed once but used daily — the per-day cost is the yearly fee spread out, not the size of the single bill. |
| **Aggregate method** | Splitting one restaurant bill evenly across everyone at the table — total ÷ number of people. |
| **Accounting / credit** | Putting a little money in a jar after each cheap meal so the expensive holiday dinner is already paid for. |
| **Potential method** | Potential energy: you do extra work pushing a ball uphill (Φ rises), and that stored energy pays for the easy ride down (Φ falls). |
| **Table doubling** | Moving to a house twice as big each time you fill up — you move rarely, and you never move again until you've doubled your stuff. |
| **Multipop bounded by pushes** | You can only spend coins you previously dropped in the piggy bank. |

> **Where analogies break down:** subscriptions assume *predictable* timing; amortized analysis demands the bound hold even when the expensive operations arrive at the *worst possible* moments. The guarantee is unconditional, not "on a typical month."

---

## Common Misconceptions

| Misconception | Reality |
|---------------|---------|
| "Amortized is just average-case with a fancy name." | No. Average-case averages over *random inputs* and can be defeated by bad input. Amortized averages over a *sequence* and holds for **every** input — it is a worst-case bound. |
| "If one `append` is O(n), then `n` appends must be O(n²)." | The expensive appends are rare and geometric; the total is O(n), so per-append is O(1) amortized. |
| "Amortized O(1) means every operation is fast." | No — individual operations can still be O(n). Amortized only bounds the *average over the sequence*. A single resize really does stall. |
| "Growing the array by +1 each time is basically the same as doubling." | No. +1 growth makes every append copy, totaling O(n²). Only *multiplicative* growth gives O(1) amortized. |
| "Credit / potential is real memory the program allocates." | No. Credit and Φ are **bookkeeping fictions** for the proof. The running program stores no such thing. |

---

## Common Mistakes

| Mistake | Why It's Wrong | Correct Approach |
|---------|---------------|-----------------|
| Reporting `append` as O(n) per call in a complexity analysis | Treats the rare resize as if it happened every time | Report O(1) amortized; note the O(n) worst-case single call only if latency matters |
| Forgetting amortized bounds break under repeated *worst-case-triggering* patterns only if growth isn't geometric | Some students assume any resizing dies to O(n²) | With ×constant growth the geometric series saves you — O(1) amortized survives any sequence |
| Using amortized O(1) in a hard real-time system without thinking | One operation can still block for O(n) during a resize | For strict latency, look at *worst-case single op*, not amortized (see middle level) |
| Confusing "credit on an element" with a real field | It is a proof device, not data | Keep the accounting in your analysis, not in your code |
| Dividing total by the wrong count | `T(n)/n` needs `n` = number of operations in the sequence | Make sure your denominator is the operation count, not the data size, when they differ |

---

## Cheat Sheet

```
AMORTIZED = total cost of a worst-case sequence ÷ number of operations
          = worst-case bound, measured per-op-across-a-sequence
          ≠ average-case (which averages over random INPUTS)

THE THREE TECHNIQUES
  1. Aggregate   →  total T(n), then T(n)/n
  2. Accounting  →  fixed charge per op; bank surplus as credit; never go negative
  3. Potential   →  amortized = actual + (Φ_after − Φ_before)
  (all three give the SAME answer; pick the easiest)

THE CANONICAL RESULTS
  Dynamic array append (doubling) ...... O(1) amortized   [single op O(n)]
  Binary counter increment ............. O(1) amortized   [single op O(k)]
  Multipop stack (push/pop/multipop) ... O(1) amortized   [multipop O(n)]

THE KEY SUM (geometric series)
  1 + 2 + 4 + ... + n  <  2n     →  total work O(n)  →  per-op O(1)

THE GOLDEN RULE
  Expensive operations are paid for by the many cheap ones that set them up.
  Geometric growth (×constant) → O(1) amortized.
  Additive growth (+constant)  → O(n) amortized (BAD).
```

---

## Summary

Amortized analysis measures the cost of an operation **averaged over a worst-case sequence**, not over a single call. It is the right tool whenever an operation is usually cheap but occasionally expensive — like a dynamic array's `append`, which is O(1) almost always but O(n) on the rare resize. Spread across the sequence, those resizes add only a constant per append, so `append` is **O(1) amortized** and building a list of `n` items is O(n) total, not O(n²).

You learned three techniques that all reach the same answer: the **aggregate** method (total ÷ count), the **accounting** method (charge a fixed price, bank credit for later), and the **potential** method (amortized = actual + ΔΦ). The canonical examples — dynamic array doubling, the binary counter, and the multipop stack — all collapse to O(1) amortized via the same geometric-series argument, and the same golden rule: *the cheap operations prepay for the expensive ones they set up.*

Above all, remember the distinction that trips everyone up: **amortized is not average-case.** It makes no assumptions about the input being random or typical. It is a worst-case guarantee that holds for every sequence — just expressed per operation.

**Next:** [Middle Level](./middle.md) — the full potential function for the dynamic array with the algebra worked out, why insert-and-delete needs growth *and* shrink thresholds, and where amortized bounds are the wrong tool (hard real-time systems).

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 17: Amortized Analysis (the definitive treatment of all three methods).
- *Algorithm Design Manual* by Steven Skiena — section on amortized analysis and dynamic arrays.
- [Big-O Notation — Junior](../04-asymptotic-notation/01-big-o-notation/junior.md) — the asymptotic vocabulary used throughout this lesson.
- [How to Calculate Complexity — Junior](../02-how-to-calculate-complexity/junior.md) — counting operations and summing geometric series.
- [Basic Data Structures](../../05-basic-data-structures/) — the arrays and stacks whose amortized behavior we analyzed here.
- [Amortized Analysis — Middle](./middle.md) — recurrence-free proofs, the formal potential function, and shrink/grow thresholds.
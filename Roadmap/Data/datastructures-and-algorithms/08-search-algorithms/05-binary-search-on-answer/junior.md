# Binary Search on Answer (Parametric Search) — Junior Level

> **Read time: ~40 minutes** · **Audience:** Engineers who already know plain binary search and want to graduate from "search this sorted array" to "search the space of possible answers" — the single highest-leverage upgrade in algorithmic interviews.

When most people hear "binary search" they think of finding a number in a sorted array. That is the easy 10% of binary search. The other 90% — the part that shows up at the top of LeetCode Hard, in production capacity planning, in scheduler tuning, in machine learning hyperparameter search — is called **binary search on the answer**, or **parametric search**. The idea is brutally simple: instead of binary-searching a list of values, you binary-search the **space of possible answers** to your problem. If you can write a function `feasible(x) -> bool` that tells you whether a candidate answer `x` works, and that function is **monotonic**, then you can find the optimal answer in O(log(answer_range) × cost_of_feasible).

This document teaches you the pattern so thoroughly that when you see "minimum capacity", "maximum distance", "minimum eating speed", "smallest divisor", "minimum number of days", or any phrase of the form *"find the smallest/largest X such that some condition holds"*, your brain instantly produces the answer-space binary search template. We walk through six famous problems start to finish — Koko Eating Bananas, Capacity to Ship Packages, Aggressive Cows, Allocate Books, Magnetic Force Between Two Balls, Split Array Largest Sum — and explain not just *how* to write the code but *why* the predicate is monotonic, *how* to pick the bounds, and *what* to do when monotonicity fails.

---

## Table of Contents

1. [Introduction — Search the Answer, Not the Array](#introduction)
2. [Prerequisites — You Already Know Plain Binary Search](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Predicate, Monotonicity, Answer Space](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough — Koko Eating Bananas](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — The Five-Step Recipe](#patterns)
11. [Error Handling — Non-Monotonic Predicates](#errors)
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
## 1. Introduction — Search the Answer, Not the Array

Suppose your manager walks up to your desk and says: *"We have 24 hours to process 1,000 backup files. Each file has a known size. We can spin up worker machines, each of which processes whatever subset of files you assign to it sequentially. What is the smallest worker capacity (in MB per worker, where 'capacity' caps the total bytes one worker can handle) such that we can finish in 24 hours with at most 8 workers?"*

You stare at the problem. There is no sorted array in sight. There is no `target` to look up. And yet — somehow — the answer to this problem is found by binary search.

The trick is to recognize that the **answer is a single integer** somewhere in the range `[max(file_sizes), sum(file_sizes)]`. The lower bound is at least the biggest single file (one worker must hold it). The upper bound is the sum of all files (one worker holds everything). The actual answer is somewhere in between. And here is the magical property: **if capacity `c` is enough, then capacity `c+1` is also enough**. Bigger capacity is never worse. So if we define `feasible(c) := "can we partition the files among 8 workers with no worker exceeding c bytes?"`, the function `feasible` looks like this when we list its values for `c = 0, 1, 2, 3, ...`:

```
c:        0  1  2  3 ... 99 100 101 102 103 104 ... ∞
feasible: F  F  F  F ... F   F   T   T   T   T  ... T
                                ↑
                            boundary: smallest c that works
```

It is **monotonic** — once it flips from false to true, it stays true forever. And finding the boundary of a monotonic boolean sequence is exactly what binary search does. We binary-search `c ∈ [max_file, sum_files]`, asking `feasible(c)` at each midpoint, until we converge on the smallest `c` where the answer is `true`.

That, in one paragraph, is binary search on the answer. The "array" you're searching is the **answer space** — every possible integer (or real number) that could be the answer. The "comparison" is `feasible(c)`. The monotonicity of `feasible` plays the role that sortedness played for arrays.

Once you internalize this, an entire universe of optimization problems collapses into ~20 lines of code. **Koko Eating Bananas** (find min speed)? Answer-space binary search. **Allocate books** (min largest workload)? Answer-space binary search. **Aggressive cows** (max-min distance)? Answer-space binary search. **Magnetic force between balls**? Same. **Capacity to ship packages within D days**? Same. **Smallest divisor given a threshold**? Same. The technique is so general that any problem where the answer is a single value and "does this candidate work?" is checkable in polynomial time becomes binary-searchable.

This document teaches you exactly when to reach for the technique, exactly how to write the predicate, and the five-step recipe that turns any "find the min/max X such that …" problem into 12 lines of Go, Java, or Python.

---

<a name="prerequisites"></a>
## 2. Prerequisites — You Already Know Plain Binary Search

Before tackling parametric search, you must be solid on:

1. **Plain binary search on a sorted array** (`02-binary-search/junior.md`). If `lo + (hi - lo) / 2` is not muscle memory, go back and finish that one first.
2. **The "find first true" template.** Given a monotonic boolean predicate `p(i)` over `i ∈ [lo, hi)`, the template `while lo < hi: mid = (lo+hi)//2; if p(mid): hi = mid else: lo = mid + 1; return lo` finds the smallest `i` with `p(i) = true`. This is the entire engine of parametric search.
3. **Greedy simulation.** Most feasibility predicates are written as "simulate the process greedily and see if it works". You should be comfortable with loops that iterate through input and accumulate counters.
4. **Comfort with `O(log n)` and `O(n log n)` complexity.** Parametric search blends a log factor over the answer range with the cost of one feasibility check.

If you have all four, you are ready. If any of these feel shaky, this document will move too fast — pause and review.

The single most important prerequisite is the **"find first true" mindset**. Plain array binary search asks "where is `target` in this sorted list?" The "find first true" template asks "where does this monotonic predicate flip from false to true?" These two questions are different ways of saying the same thing, but the second framing is the one that generalizes. Once you see every problem as "find the boundary of a monotonic predicate", parametric search is no longer a separate technique — it is just the find-first-true template with a different `lo`/`hi` interpretation.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Parametric search** | Binary searching over the **values** of a parameter (the answer) instead of over the indices of an array. Coined by Megiddo (1979). |
| **Binary search on the answer** | Common name in interview/competitive contexts for parametric search. Same thing. |
| **Answer space** | The set of possible values the answer could take. For an integer answer, an interval `[lo, hi]` of integers. For a real-valued answer, a continuous interval. |
| **Predicate / feasibility function** | A function `feasible(x) -> bool` that returns true iff candidate `x` is a valid answer. The core of parametric search. |
| **Monotonic predicate** | A boolean function whose value pattern is `false…false true…true` (or `true…true false…false`). Switches at most once across its domain. |
| **Boundary** | The single index/value where a monotonic predicate switches from false to true. The answer to a parametric search. |
| **Greedy simulation** | The common technique for evaluating `feasible(x)`: pretend `x` is the answer, then simulate the process step by step and check whether it succeeds. |
| **Feasible region** | The set of `x` for which `feasible(x)` is true. By monotonicity, this is an "upper" or "lower" interval `[a, ∞)` or `(-∞, a]`. |
| **Bisection on a real interval** | The continuous analogue: binary searching `[lo, hi] ⊂ ℝ`, terminating after a fixed iteration count or once `hi - lo < eps`. |
| **Search-on-answer template** | The 8-line "while lo < hi: if feasible(mid): hi = mid else: lo = mid + 1; return lo" pattern. |
| **Cost of feasibility** | The time complexity of one call to `feasible(x)`. The total time is `O(log(answer_range) × cost_of_feasibility)`. |
| **Answer range / answer width** | `hi - lo + 1` — the number of candidate integer answers. For integers, ~`log_2(hi - lo)` iterations needed. |

Internalize the words **"predicate"** and **"monotonic"**. Every parametric-search problem reduces to: *"What is the predicate? Why is it monotonic? What are the bounds of the answer space?"* Answer those three questions and the rest is mechanical.

---

<a name="core-concepts"></a>
## 4. Core Concepts — Predicate, Monotonicity, Answer Space

### 4.1 The four ingredients

Every binary-search-on-answer problem has four ingredients:

1. **The answer space `[lo, hi]`.** What is the smallest/largest the answer could possibly be? Often the trivial bounds: lo = 1 (or `min` of some input), hi = `max` of input or `sum` of input.
2. **The predicate `feasible(x): bool`.** A function that returns true iff candidate `x` solves the problem. This is where the cleverness lives.
3. **Monotonicity of `feasible`.** You must prove (or at least convince yourself) that if `feasible(x)` is true, then `feasible(x+1)` is also true (for "find minimum") or `feasible(x-1)` is also true (for "find maximum"). Without this, binary search is invalid.
4. **The search direction.** "Find the smallest `x` where `feasible(x) = true`" → false…false true…true → find first true. "Find the largest `x` where `feasible(x) = true`" → true…true false…false → find last true.

Get these four right and the code writes itself.

### 4.2 What does "monotonic predicate" mean?

A predicate `f : ℤ → {false, true}` is **monotonic** if there is exactly one value `b` (the boundary) such that:

- `f(x) = false` for all `x < b`
- `f(x) = true` for all `x ≥ b`

(or the symmetric version with false/true swapped).

Equivalently: once it flips, it stays flipped.

This is the crucial property that lets binary search work. When you evaluate `f(mid)`:
- If it's `true`, the boundary `b ≤ mid`, so the answer is in `[lo, mid]`.
- If it's `false`, the boundary `b > mid`, so the answer is in `[mid + 1, hi]`.

Without monotonicity, you can't make this deduction — `f(mid)` being one value tells you nothing about `f(mid - 17)`. Binary search degenerates to garbage.

### 4.3 Why monotonicity holds in optimization problems

In most "find the min capacity / max distance / min speed" problems, monotonicity is obvious once you state the predicate:

- **Koko at speed `k`**: if she can finish at speed 5, she can certainly finish at speed 10 (she has more bananas-per-hour, fewer hours needed). Monotone increasing in `k` → monotone in `feasible`.
- **Truck capacity `c`**: if 50 tons fit in `D` days, then 60 tons certainly fit (each day can hold more, so the number of days needed is non-increasing in `c`). Monotone.
- **Workers with max workload `M`**: if 8 workers can do it with everyone's load ≤ M, they can certainly do it with load ≤ M+1. Monotone.

**Rule of thumb:** if your answer represents "resource budget" (capacity, speed, max load, max distance, time), and bigger budget makes the problem easier, then `feasible(x) = "x is enough"` is monotonic. If smaller budget makes the problem easier (rare), the predicate is monotone in the other direction.

### 4.4 The template

For **find smallest `x` where `feasible(x)`** (most common):

```
lo, hi = lower_bound_of_answer, upper_bound_of_answer
while lo < hi:
    mid = lo + (hi - lo) / 2
    if feasible(mid):
        hi = mid              # mid works; try smaller
    else:
        lo = mid + 1          # mid doesn't work; need bigger
return lo
```

For **find largest `x` where `feasible(x)`** (max-min problems like Aggressive Cows):

```
lo, hi = lower_bound, upper_bound
while lo < hi:
    mid = lo + (hi - lo + 1) / 2     # bias UP to avoid infinite loop
    if feasible(mid):
        lo = mid              # mid works; try bigger
    else:
        hi = mid - 1          # mid doesn't work; need smaller
return lo
```

Note the **`+1` in the `mid` formula for the "find largest" variant**. It avoids the infinite loop that would otherwise occur when `lo = hi - 1` and `feasible(mid)` is true (because `mid = lo` and `lo = mid` doesn't advance). Easy to forget. Easy to get wrong. Memorize.

### 4.5 Bounds of the answer space

Picking good `lo` and `hi` is half the puzzle.

**Lower bound.** Often the smallest *trivially* feasible value. For Koko: speed 1 banana/hour (always valid input, may or may not be feasible). For ship capacity: `max(weights)` (one package can't be split). For max-min distance: 0 or 1 (always feasible trivially).

**Upper bound.** Often a value that is *clearly* always feasible. For Koko: `max(piles)` — she can eat any single pile in one hour at that speed, so she finishes in ≤ len(piles) ≤ h hours. For ship capacity: `sum(weights)` — one giant truck. For max-min distance: `max(positions) - min(positions)` — the entire range.

**Trade-off.** Tighter bounds = fewer iterations (negligible savings, since `log₂(10^9) ≈ 30`). **Looser but obviously safe** bounds = no risk of bugs. **Default: pick safe bounds**, optimize only if needed.

A subtle pitfall: if `lo` is itself infeasible, the algorithm still works — it will move `lo` up until it hits the boundary. But if `hi` is **infeasible** (you picked it too tight), you'll return a wrong answer. **Always ensure `hi` is feasible**, ideally provably so. The classic safe choice is "the maximum possible meaningful value", e.g., `sum` for partition problems or `max(input)` for "rate" problems.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Iterations of binary search** | `O(log(hi - lo))` — typically 20–60 for integer answers |
| **Cost of one `feasible(mid)` call** | `O(C)` — problem-specific, usually O(n) for a greedy scan |
| **Total time** | `O(C × log(hi - lo))` |
| **Space** | `O(1)` extra (plus whatever `feasible` uses) |
| **Predicate evaluation count** | exactly `⌈log₂(hi - lo + 1)⌉` |
| **Real-valued bisection** | fixed `K` iterations (often 100) → `O(K × C)` |

For Koko Eating Bananas with `n = 10^4` piles and max pile = `10^9`:
- `log₂(10^9) ≈ 30` iterations
- each `feasible(k)` runs in O(n) = O(10^4)
- total: O(30 × 10^4) = 3 × 10^5 operations — instantaneous.

Brute force would try every speed from 1 to 10^9, costing 10^9 × 10^4 = 10^13 — infeasible.

**Key takeaway:** parametric search trades the brute force `O(answer_range × C)` for `O(log(answer_range) × C)` — a factor of 30 million speedup at typical interview/competitive scales.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Calibrating a coffee machine
You have a coffee machine with a "strength" dial from 1 to 100. You want the *weakest* strength that produces drinkable coffee. Brewing one cup takes 5 minutes (your "feasibility check"). You don't try all 100 settings — you try 50, taste, decide if it's drinkable. If yes, try 25; if no, try 75. Each trial halves the search space. In ~7 brews you find the boundary. That's binary search on a real-valued answer space, with a slow feasibility test, in the kitchen.

### 6.2 Hiring a contractor by deadline
You need a project done in `D` days. Each contractor charges a different daily rate; you want the cheapest one who can finish in time. If contractor A finishes in 10 days, anyone faster also finishes in time. The predicate "finishes in ≤ D days" is monotonic in throughput. Binary search the throughput; pick the slowest (and thus cheapest) one who still meets the deadline.

### 6.3 Tuning a database query timeout
You're tuning your service's database query timeout. Too low → timeouts kill legit queries; too high → slow queries pile up. You want the smallest timeout that catches < 0.1% of legit queries. As timeout increases, the fraction of timeouts decreases monotonically. Binary search the timeout in milliseconds against your replay logs.

### 6.4 Image binarization threshold
Convert a grayscale image to black-and-white. You need a threshold `t ∈ [0, 255]`. Too low → image is mostly white; too high → mostly black. You want the threshold where (say) 50% of pixels are black. The fraction-black-as-a-function-of-threshold is monotonically non-decreasing in `t`. Binary search the threshold.

### 6.5 Kubernetes pod sizing
You have a microservice and want to know the smallest CPU request (in millicores) that keeps tail latency under 100 ms. Bigger CPU = better latency (monotonic). You can run a 5-minute load test at each candidate setting. Instead of trying every value from 100m to 4000m, binary search: 2050m, 1025m or 3025m, etc. You find the boundary in ~10 load tests instead of 40.

### 6.6 Climbing a hill at night
You're hiking at night with a torch and want to find the exact altitude at which a particular sign sits. You can ask "am I above it?" but not see it directly. Move up the mountain in big steps; when you've definitely passed it, halve back; if you're still below, go up again. Each query halves the remaining range. Classic bisection.

Each of these is a real engineering scenario where someone gets paid to do binary search on an answer — and almost none of them involve an array.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **Generalizes to "any" optimization where the answer is a number.** Once you spot the monotonic predicate, the technique is plug-and-play.
- **Logarithmic in the answer range.** Even for answer ranges of `10^18`, you do ~60 iterations of the feasibility check. Often the same complexity as a single brute-force pass.
- **Trivial constant space.** Two integer variables. No recursion. No DP table.
- **Composable.** The feasibility check can itself use any algorithm — greedy simulation, DP, even a nested binary search. Total complexity stays manageable.
- **Foundation for harder techniques.** Parallel binary search, persistent search, Megiddo's parametric search proper — all build on this.

### Cons
- **You must invent and prove the predicate.** This is the hard part; interviewers ask precisely *because* it's the bottleneck.
- **Silent wrong answers if predicate is non-monotonic.** Just like plain binary search on unsorted data — it converges to *some* value, which may be wrong.
- **Predicate evaluation cost dominates.** If your `feasible(x)` is O(n²) and `n = 10^5`, you've blown the time limit. Optimizing `feasible` is the second hard part.
- **Real-valued problems are subtle.** Floating-point precision, fixed iteration counts, `1e-9` vs `1e-12` — see `middle.md`.
- **Not applicable when the answer is multi-dimensional.** "Find the minimum `(x, y)` with some property" is rarely a single parametric search; you need DP or LP.
- **Easy to confuse "find min" with "find max" template.** The `+1` in the mid formula is silent dynamite.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough — Koko Eating Bananas

This is the canonical problem for binary search on the answer. We solve it byte-by-byte.

### 8.1 Problem (LeetCode 875)

> Koko has `n` piles of bananas, given as an array `piles[]`. Within `h` hours, Koko must finish all piles. Each hour, she picks a pile and eats `min(pile, k)` bananas from it, where `k` is her **eating speed** (bananas per hour). Find the **minimum integer `k`** such that she finishes within `h` hours.

Example: `piles = [3, 6, 7, 11]`, `h = 8`. Answer: `4`.

At speed 4: pile 3 takes 1 hour, pile 6 takes 2 hours (4 then 2), pile 7 takes 2 hours, pile 11 takes 3 hours. Total = 8. Works.

At speed 3: pile 3 takes 1 hour, pile 6 takes 2 hours, pile 7 takes 3 hours (3+3+1), pile 11 takes 4 hours. Total = 10. Too slow.

So 4 is the minimum.

### 8.2 Step 1 — Identify the answer space

The answer is `k`, the eating speed. What's the smallest possible `k`? **1 banana/hour** (any smaller is meaningless). What's the largest meaningful `k`? **`max(piles)`** — at that speed, every pile takes exactly one hour, so she finishes in `n ≤ h` hours (assuming the problem is solvable). Going faster than `max(piles)` doesn't help — eating extra `k` bananas from a small pile gets capped at the pile size.

So: `lo = 1`, `hi = max(piles)`.

### 8.3 Step 2 — Define the predicate

`feasible(k) := "Koko finishes all piles within h hours at speed k"`.

To check it, simulate: for each pile, hours needed = `⌈pile / k⌉` = `(pile + k - 1) // k`. Sum across all piles. If sum ≤ h, return true; else false.

```python
def hours_needed(piles, k):
    return sum((p + k - 1) // k for p in piles)

def feasible(k):
    return hours_needed(piles, k) <= h
```

### 8.4 Step 3 — Verify monotonicity

Claim: if `feasible(k)` is true, then `feasible(k + 1)` is also true.

Proof sketch: at higher speed, every pile takes fewer (or equal) hours: `⌈pile / (k+1)⌉ ≤ ⌈pile / k⌉`. So the sum is non-increasing in `k`. If at speed `k` the sum is `≤ h`, then at speed `k+1` it's still `≤ h`. ∎

So `feasible` is monotone non-decreasing in `k` (false…false true…true). The boundary is the answer.

### 8.5 Step 4 — Binary search the answer space

```python
def min_eating_speed(piles, h):
    lo, hi = 1, max(piles)
    while lo < hi:
        mid = (lo + hi) // 2
        if hours_needed(piles, mid) <= h:
            hi = mid
        else:
            lo = mid + 1
    return lo
```

### 8.6 Step 5 — Trace through the example

`piles = [3, 6, 7, 11]`, `h = 8`. `lo = 1, hi = 11`.

| Iter | lo | hi | mid | hours_needed(mid) | <= h? | New lo, hi |
|---|---|---|---|---|---|---|
| 1 | 1 | 11 | 6 | ⌈3/6⌉+⌈6/6⌉+⌈7/6⌉+⌈11/6⌉ = 1+1+2+2 = 6 | yes | (1, 6) |
| 2 | 1 | 6 | 3 | 1+2+3+4 = 10 | no | (4, 6) |
| 3 | 4 | 6 | 5 | 1+2+2+3 = 8 | yes | (4, 5) |
| 4 | 4 | 5 | 4 | 1+2+2+3 = 8 | yes | (4, 4) |
| exit | | | | | | return 4 |

Four iterations. Each feasibility check is O(n=4). Total: 16 operations. The brute force would try every k from 1 to 11 → 11 × 4 = 44 operations. The gap explodes for realistic inputs: with `max(piles) = 10^9` and `n = 10^4`, brute force is `4 × 10^13`; parametric is `30 × 10^4 = 3 × 10^5`. **8 orders of magnitude faster**.

### 8.7 Total complexity

- Answer space size: `max(piles)` ≤ `10^9`. Iterations: ~30.
- Predicate cost: `O(n)` per call, where `n = len(piles)`.
- **Total: `O(n log max(piles))`**.

That's the parametric-search complexity formula in its simplest form.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

We give complete, runnable implementations of three classic problems.

### 9.1 Koko Eating Bananas (LeetCode 875)

**Go:**
```go
package koko

// MinEatingSpeed returns the minimum integer k such that Koko can eat all
// piles in <= h hours, where each hour she eats min(pile, k) bananas.
// piles must be non-empty, h >= len(piles).
func MinEatingSpeed(piles []int, h int) int {
    lo, hi := 1, 0
    for _, p := range piles {
        if p > hi {
            hi = p
        }
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if hoursNeeded(piles, mid) <= h {
            hi = mid // mid works, try smaller
        } else {
            lo = mid + 1 // mid too slow, need larger
        }
    }
    return lo
}

// hoursNeeded returns the total hours to finish all piles at speed k.
func hoursNeeded(piles []int, k int) int {
    total := 0
    for _, p := range piles {
        total += (p + k - 1) / k // ceil(p / k) without floats
    }
    return total
}
```

**Java:**
```java
public final class KokoBananas {
    private KokoBananas() {}

    public static int minEatingSpeed(int[] piles, int h) {
        int lo = 1, hi = 0;
        for (int p : piles) if (p > hi) hi = p;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (hoursNeeded(piles, mid) <= h) hi = mid;
            else                              lo = mid + 1;
        }
        return lo;
    }

    private static long hoursNeeded(int[] piles, int k) {
        long total = 0;
        for (int p : piles) {
            total += (p + (long) k - 1) / k; // careful: avoid int overflow
        }
        return total;
    }
}
```

**Python:**
```python
def min_eating_speed(piles: list[int], h: int) -> int:
    def hours_needed(k: int) -> int:
        return sum((p + k - 1) // k for p in piles)

    lo, hi = 1, max(piles)
    while lo < hi:
        mid = (lo + hi) // 2
        if hours_needed(mid) <= h:
            hi = mid
        else:
            lo = mid + 1
    return lo
```

### 9.2 Capacity to Ship Packages Within D Days (LeetCode 1011)

> Given an array `weights[]` of package weights (in shipping order) and a budget of `D` days, find the **minimum** truck capacity (per day) such that all packages ship in order in ≤ `D` days. Each day, the truck loads consecutive packages from the front of the queue until adding the next would exceed capacity.

**Predicate:** `can_ship(cap) := "with capacity cap, ≤ D days needed"`. Monotone in `cap`.

**Bounds:** `lo = max(weights)` (a single package must fit), `hi = sum(weights)` (one giant day).

**Go:**
```go
func ShipWithinDays(weights []int, D int) int {
    lo, hi := 0, 0
    for _, w := range weights {
        if w > lo {
            lo = w
        }
        hi += w
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if daysNeeded(weights, mid) <= D {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}

func daysNeeded(weights []int, cap int) int {
    days, load := 1, 0
    for _, w := range weights {
        if load+w > cap {
            days++
            load = 0
        }
        load += w
    }
    return days
}
```

**Java:**
```java
public static int shipWithinDays(int[] weights, int D) {
    int lo = 0, hi = 0;
    for (int w : weights) { if (w > lo) lo = w; hi += w; }
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (daysNeeded(weights, mid) <= D) hi = mid;
        else                                lo = mid + 1;
    }
    return lo;
}

private static int daysNeeded(int[] w, int cap) {
    int days = 1, load = 0;
    for (int x : w) {
        if (load + x > cap) { days++; load = 0; }
        load += x;
    }
    return days;
}
```

**Python:**
```python
def ship_within_days(weights: list[int], D: int) -> int:
    def days_needed(cap: int) -> int:
        days, load = 1, 0
        for w in weights:
            if load + w > cap:
                days += 1
                load = 0
            load += w
        return days

    lo, hi = max(weights), sum(weights)
    while lo < hi:
        mid = (lo + hi) // 2
        if days_needed(mid) <= D:
            hi = mid
        else:
            lo = mid + 1
    return lo
```

### 9.3 Aggressive Cows (SPOJ AGGRCOW) — Max-Min Distance

> Given `n` stall positions and `k` cows, place the `k` cows in stalls such that the **minimum** pairwise distance between any two cows is **maximized**. Return that maximized minimum distance.

This is the classic "find largest `d` such that we can fit `k` cows with pairwise distance ≥ `d`" problem. The predicate `can_place(d) := "k cows fit with min spacing d"` is monotonically decreasing in `d` (true for small d, false for large d). We want the **largest** d for which it's true → **find last true** template (note the `+1` in mid).

**Go:**
```go
import "sort"

func AggressiveCows(stalls []int, k int) int {
    sort.Ints(stalls)
    lo, hi := 1, stalls[len(stalls)-1]-stalls[0]
    for lo < hi {
        mid := lo + (hi-lo+1)/2 // bias UP for find-last-true
        if canPlace(stalls, k, mid) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return lo
}

func canPlace(stalls []int, k, d int) bool {
    count, last := 1, stalls[0]
    for i := 1; i < len(stalls); i++ {
        if stalls[i]-last >= d {
            count++
            last = stalls[i]
            if count >= k {
                return true
            }
        }
    }
    return count >= k
}
```

**Java:**
```java
import java.util.Arrays;

public static int aggressiveCows(int[] stalls, int k) {
    Arrays.sort(stalls);
    int lo = 1, hi = stalls[stalls.length - 1] - stalls[0];
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2; // +1 to avoid infinite loop
        if (canPlace(stalls, k, mid)) lo = mid;
        else                          hi = mid - 1;
    }
    return lo;
}

private static boolean canPlace(int[] stalls, int k, int d) {
    int count = 1, last = stalls[0];
    for (int i = 1; i < stalls.length; i++) {
        if (stalls[i] - last >= d) {
            count++;
            last = stalls[i];
            if (count >= k) return true;
        }
    }
    return false;
}
```

**Python:**
```python
def aggressive_cows(stalls: list[int], k: int) -> int:
    stalls.sort()

    def can_place(d: int) -> bool:
        count, last = 1, stalls[0]
        for x in stalls[1:]:
            if x - last >= d:
                count += 1
                last = x
                if count >= k:
                    return True
        return False

    lo, hi = 1, stalls[-1] - stalls[0]
    while lo < hi:
        mid = (lo + hi + 1) // 2  # bias UP
        if can_place(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo
```

Note the **two structural differences** from Koko:
1. `mid = lo + (hi - lo + 1) / 2` — biases the midpoint upward.
2. On `true`, we set `lo = mid` (not `lo = mid + 1`) because `mid` itself might be the answer.

Without the `+1`, when `lo = hi - 1` and `feasible(mid) = true`, we'd have `lo = mid = lo`, looping forever.

---

<a name="patterns"></a>
## 10. Coding Patterns — The Five-Step Recipe

Whenever you suspect a problem is solvable by binary search on the answer, run this five-step checklist. It works for nearly every flavor.

### Step 1 — Phrase the problem as "find the smallest (or largest) `x` such that …"

If the problem already says *"minimum speed"*, *"maximum distance"*, *"smallest divisor"*, *"least time"*, you're almost done with this step. If not, look for an objective: optimization → there's a single number to minimize or maximize.

### Step 2 — Identify the answer space `[lo, hi]`

What are the smallest and largest values `x` could take? Often:
- For min-X problems: `lo` = some trivially small value (1, 0, min of input); `hi` = some clearly-large-enough value (max of input, sum of input).
- For max-X problems: `lo` = trivially small (0, 1); `hi` = the largest meaningful value (the full range of positions, the sum, etc.).

Don't over-think bounds — be generous, not tight. The log factor doesn't care.

### Step 3 — Define `feasible(x)` and prove monotonicity

This is the hard part. Write down: *"Given x, can we solve the problem?"* Implement it as a function. Then **convince yourself** (or prove on paper) that `feasible(x) → feasible(x + 1)` (for min-X) or `feasible(x) → feasible(x - 1)` (for max-X).

If the predicate is **not** monotonic, this technique does not apply — pick another technique.

### Step 4 — Implement the binary search

For "find smallest x":
```python
while lo < hi:
    mid = (lo + hi) // 2
    if feasible(mid):
        hi = mid
    else:
        lo = mid + 1
return lo
```

For "find largest x":
```python
while lo < hi:
    mid = (lo + hi + 1) // 2   # +1 to bias up
    if feasible(mid):
        lo = mid
    else:
        hi = mid - 1
return lo
```

### Step 5 — Verify on small examples

Run your code on hand-computed small cases (n=3, n=4). Trace through every iteration. If your code gives the wrong answer or loops forever, the bug is almost always:
- Off-by-one in mid (forgot the `+1`).
- Predicate not actually monotonic (re-examine).
- Wrong template direction (used "find smallest" template for a "find largest" problem).

### Worked tags for common phrasings

| Problem phrasing | Template direction |
|---|---|
| "Minimum X such that we can do Y" | find smallest true |
| "Maximum X such that we can do Y" | find largest true |
| "Smallest divisor / speed / capacity" | find smallest true |
| "Largest distance / minimum gap / minimum-max-anything" | find largest true |
| "Fewest days / fewest workers needed" | find smallest true (feasibility = "≤ budget") |
| "Largest median possible" | find largest true |

This table covers maybe 80% of all parametric-search problems.

---

<a name="errors"></a>
## 11. Error Handling — Non-Monotonic Predicates

The single most dangerous failure mode is using parametric search on a problem where the predicate is **not** monotonic. The binary search runs to completion and returns a value, but that value is wrong — often slightly, sometimes wildly. There is no exception, no warning, no test failure unless you happen to test on an adversarial input.

### 11.1 Counterexample — when monotonicity fails

Consider: *"Find the smallest k such that the sum of the k smallest elements is at least 100."* For sorted `arr`, `f(k) := "sum of arr[0..k-1] >= 100"`. Sums are monotonically increasing in `k`, so the predicate is monotonic. Binary search works.

Now twist it: *"Find the smallest k such that the **median** of the k smallest elements is at least 50."* This is **not** monotonic. As you add more elements, the median can go up (if you add big ones) or down (if you add small ones). In particular, you can go through "median ≥ 50 at k=3, < 50 at k=4, ≥ 50 again at k=5". The boolean sequence is `false, false, true, false, true, …` — not monotone. Binary search returns whatever it lands on, which is essentially random.

### 11.2 How to verify monotonicity in practice

1. **Sketch the predicate's value for the smallest non-trivial inputs.** If you see anything other than `false…false true…true` or `true…true false…false`, it's not monotonic.
2. **Look for the "more resource = easier" structure.** If your predicate represents "do we have enough budget to finish?", monotonicity is almost guaranteed.
3. **Beware of predicates involving medians, modes, or non-monotone aggregations.** These are notorious traps.
4. **Property-test it.** Generate random inputs, evaluate `feasible(x)` for `x = 1, 2, …, max`, and assert the sequence is monotone. If it's not, the technique doesn't apply.

### 11.3 Common error modes and fixes

| Error | Symptom | Fix |
|---|---|---|
| Predicate non-monotonic | Wrong answer on edge cases | Re-examine the problem; switch to DP or another technique |
| `hi` too small (infeasible) | Returns `hi`, wrong | Increase `hi` to a provably feasible value |
| `lo` too large | Wrong answer | Decrease `lo` to a value that might be the actual minimum |
| Forgot `+1` in mid (find-largest variant) | Infinite loop | Use `mid = lo + (hi - lo + 1) / 2` for find-last-true |
| Used `lo = mid` instead of `lo = mid + 1` in find-smallest | Infinite loop or off-by-one | Stick to the template exactly |
| Integer overflow in predicate sum | Wrong answer at scale | Use `long` in Java/Go, or Python (no overflow) |
| `feasible(x)` not deterministic | Random results | Make `feasible` pure |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Make `feasible(x)` as fast as possible.** It's called `log(answer_range)` times, so any speedup compounds. O(n) → O(n / 2) is real.
2. **Don't over-allocate inside `feasible`.** Reuse buffers; avoid creating slices/lists each call. In Python, prefer `for ... in piles` over list comprehensions if memory-bound.
3. **Tighten bounds when easy.** A factor-of-2 tighter `hi` saves one iteration. Often not worth chasing — but `hi = max(weights)` instead of `hi = sum(weights)` for "Koko-like" problems is a meaningful tighten.
4. **Cache invariants.** If `feasible(mid)` does a loop summing `(p + mid - 1) // mid`, the `max(piles)` doesn't change between calls — extract it.
5. **Avoid `math.ceil`.** Use integer arithmetic: `(p + k - 1) // k` is exact and faster than `int(math.ceil(p / k))`.
6. **In Java, use `long` for sums.** `int` overflow on `n=10^5` and values `10^9` is real. Promote `total` to `long`.
7. **In Python, watch out for `max(piles)` recomputed.** Compute once before the loop, not each iteration.
8. **Avoid binary search inside `feasible`.** If `feasible` itself does a binary search, your total complexity becomes `O(log² × n)` — still fast, but unnecessary if a linear pass suffices.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Always state the predicate in plain English first**, even just in a comment. *"feasible(k) = Koko can finish all piles in <= h hours at speed k"*. Forces you to confront monotonicity.
- **Pick the template direction explicitly.** Write `# find smallest true` or `# find largest true` as a comment above the loop. Saves you next month.
- **Use `lo < hi` (half-open) for all parametric searches.** It naturally returns the boundary as `lo`. Avoid the inclusive-bounds template here.
- **Don't reuse plain-array binary-search code by accident.** They look similar but have different semantics — the answer-space version doesn't probe an array index.
- **Prove the bounds are safe.** Write a comment: *"hi = sum(weights) is always feasible because one giant day works"*. If you can't articulate why, you have a bug.
- **Test with `h = n` and `h = sum(arr)` edge cases.** The trivial cases shake out off-by-one bugs.
- **Separate `feasible(x)` into its own function** with a clear name. Easier to test, easier to read.
- **For float answers, prefer fixed iteration count.** `for _ in range(100): ...` is bulletproof; `while hi - lo > 1e-9: ...` can spin forever due to denormals.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Behavior |
|---|---|
| `n = 1` (single element) | Answer is determined by that element; predicate should still work |
| `h = n` (just barely feasible) | Returns `max(piles)` for Koko (every pile takes 1 hour) |
| All elements equal | Often the answer equals that value; predicate is trivially monotone |
| Empty input | Define behavior: usually return 0 or raise error |
| `D = sum(weights)` (lots of time) | Min capacity = `max(weights)` |
| `D = 1` (one day) | Min capacity = `sum(weights)` |
| All identical positions (Aggressive Cows) | Max-min distance = 0 |
| Two cows, two stalls | Distance = stalls[-1] - stalls[0] |
| `lo > hi` initially | Should not occur; verify bounds are sane |
| Integer overflow in cumulative sum | Use `long` / int64; trivially handled in Python |
| Predicate cost dominates | Profile and optimize `feasible` first |
| Non-integer answer required | Switch to fixed-iteration float bisection |

For Koko: `min_eating_speed([1000000000], 2) = 500000000`. Verify your code handles this without overflow.

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Using "find smallest" template for a "find largest" problem.** Returns `lo`, but `lo` is the smallest *infeasible* value, off by one.
2. **Forgetting the `+1` in `mid` for find-largest.** Infinite loop when `lo + 1 == hi`.
3. **Picking `hi` too tight, missing the actual answer.** Always make `hi` clearly feasible.
4. **Picking `lo = 0` when 0 is meaningless** (e.g., for speed, 0 means no eating ever, the predicate divides by zero). Use `lo = 1` for "rate" problems.
5. **Computing `hours_needed` with floats.** `math.ceil(p / k)` can be off-by-one due to floating-point error. Use `(p + k - 1) // k`.
6. **Predicate that "looks monotonic" but isn't.** Triple-check: monotonicity is the entire foundation.
7. **Integer overflow in cumulative sums.** For Java/Go, sum of `n=10^5` values of `10^9` overflows `int32`. Use `int64`/`long`.
8. **Reusing a counter outside the loop.** State leakage between `feasible(x)` calls causes nondeterministic results.
9. **Returning `mid` instead of `lo`.** The loop maintains the boundary in `lo` (or `hi`, both equal at exit). `mid` is whatever was last probed, often not the answer.
10. **Not separating "answer" from "boundary".** For some problems (e.g., maximizing a count of something), the boundary is the answer; for others (e.g., when you want the *value* at the boundary index), you need an extra lookup.
11. **Confusing "smallest k with `f(k) ≥ T`" with "smallest k with `f(k) > T`".** Strictly-greater vs ≥ is a one-character bug.
12. **Adding the answer space wrong.** Sometimes the answer is "number of items" (integer ≥ 0), sometimes "distance" (could be float). Pick the correct domain.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
RECOGNIZE
    "minimum / maximum X such that …"          → parametric search candidate
    "smallest / largest k where pred(k)"
    "min capacity / speed / time / distance"
    "max-min distance, max-min weight"

FIVE-STEP RECIPE
    1. Phrase as find smallest/largest X
    2. Identify [lo, hi] for the answer space
    3. Write feasible(x): bool
    4. Prove (or convince yourself) it's monotone
    5. Plug into template

TEMPLATE — FIND SMALLEST TRUE
    while lo < hi:
        mid = lo + (hi - lo) / 2
        if feasible(mid):
            hi = mid                   # might be answer, try smaller
        else:
            lo = mid + 1               # not enough, need larger
    return lo

TEMPLATE — FIND LARGEST TRUE (note +1 in mid)
    while lo < hi:
        mid = lo + (hi - lo + 1) / 2
        if feasible(mid):
            lo = mid                   # might be answer, try larger
        else:
            hi = mid - 1               # too much, need smaller
    return lo

REAL-VALUED VARIANT
    for _ in range(100):
        mid = (lo + hi) / 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2

CLASSIC EXAMPLES
    Koko Eating Bananas (LC 875)               smallest speed
    Capacity to Ship Packages (LC 1011)        smallest capacity
    Split Array Largest Sum (LC 410)           smallest max-sum
    Allocate Books (GFG)                       smallest max-pages
    Aggressive Cows (SPOJ)                     largest min-distance
    Magnetic Force Between Balls (LC 1552)     largest min-distance
    Smallest Divisor (LC 1283)                 smallest divisor
    Minimum Days to Make Bouquets (LC 1482)    smallest day count
    Find K-th Smallest Pair Distance (LC 719)  smallest dist with rank k

COMPLEXITY
    O(C × log(hi - lo))    where C = cost of one feasible() call

PITFALLS
    Non-monotone predicate            → silent wrong answer
    Infeasible hi                      → wrong answer
    Forgot +1 in mid (find-largest)    → infinite loop
    Integer overflow in sums           → wrong at scale
    Float == comparison                → use fixed iter count
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It animates Koko Eating Bananas: the answer-space slider from `1` to `max(piles)` shows the current `lo`, `mid`, `hi` bounds; each step runs the feasibility check (computing `hours_needed(mid)`), color-codes the result (green = feasible, red = infeasible), and shrinks the range. The "Hours needed" stat shows the simulation result at each mid, and the "Iteration" stat counts probes. After ~`⌈log₂(max(piles))⌉` iterations, the animation lands on the answer.

Run it and watch the answer space collapse — once you see the `lo` and `hi` pointers converge while the array `piles` stays static, the mental model becomes inseparable from the code.

---

<a name="summary"></a>
## 18. Summary

- **Binary search on the answer** searches the *space of possible answers*, not a sorted array. It transforms an optimization problem into a sequence of yes/no feasibility checks.
- The four ingredients are: **answer space `[lo, hi]`**, **predicate `feasible(x)`**, **monotonicity of `feasible`**, and **search direction** (find smallest vs find largest).
- The total complexity is **`O(C × log(hi - lo))`** where `C` is the cost of one feasibility check.
- The most common predicate technique is **greedy simulation** — pretend `x` is the answer and step through the problem; if the simulation succeeds, return true.
- The **"find smallest true"** template returns the boundary as `lo`; the **"find largest true"** template needs `mid = lo + (hi - lo + 1) / 2` to avoid infinite loops.
- The single biggest pitfall is **non-monotonic predicates** — verify monotonicity with small examples before trusting the technique.
- **Famous problems**: Koko (LC 875), Capacity to Ship Packages (LC 1011), Split Array Largest Sum (LC 410), Aggressive Cows (SPOJ), Magnetic Force (LC 1552), Allocate Books (GFG). Master these and the rest pattern-match instantly.
- For **real-valued answers**, use a **fixed iteration count** (e.g., 100) instead of an epsilon check.

Once you internalize the "find the boundary of a monotonic predicate" framing, parametric search stops feeling like a special technique and starts feeling like the *default* tool for any optimization with a single numeric answer.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Megiddo**, "Combinatorial Optimization with Rational Objective Functions" (1979). The original paper introducing parametric search. Heavy theory; skim for context.
- **CP-Algorithms** — *Binary Search* article (cp-algorithms.com/num_methods/binary_search.html). Concise, classic, covers all variants used in competitive programming.
- **Errichto's "Binary Search" video series on YouTube**. Excellent visual walkthroughs of Koko, ship packages, and aggressive cows.
- **LeetCode problems** — 410, 875, 1011, 1482, 1283, 1552, 2064, 2226. Practice the pattern until the template is automatic.
- **Competitive Programmer's Handbook** by Antti Laaksonen, Chapter 3 (Sorting and Searching). Free PDF. Brief but rigorous.
- Continue with `middle.md` for harder variants (real-valued bisection, predicate engineering, LC 410 deep dive, K-th smallest pair distance) and `senior.md` for production use cases (capacity planning, scheduler tuning, rate-limit calibration).

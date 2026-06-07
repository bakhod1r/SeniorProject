# Randomized Quicksort — Interview Preparation

> Tiered question bank (Junior → Middle → Senior → Professional) plus a 3-language coding challenge.
> Build on the base [Quick Sort interview file](../../07-sorting-algorithms/04-quick-sort/junior.md) and the [professional analysis](./professional.md).

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Randomized Quicksort? | Quicksort with a randomly chosen pivot (or a random shuffle first); expected O(n log n) on any input |
| 2 | What single change turns plain Quicksort into Randomized Quicksort? | Pick the pivot at a random index instead of a fixed position |
| 3 | Why do we randomize the pivot at all? | To eliminate the O(n²) worst case on sorted/adversarial inputs; no fixed input can be the worst case |
| 4 | What input makes naive Quicksort (last-element pivot) O(n²)? | Already-sorted or reverse-sorted input |
| 5 | Is the *output* of Randomized Quicksort random? | No — always correctly sorted; only the *runtime* is random |
| 6 | What is the expected time complexity? | O(n log n) on every input |
| 7 | What is the worst-case time complexity? | Still O(n²), but it requires an extremely unlucky pivot streak; probability → 0 |
| 8 | Is Randomized Quicksort stable? | No — equal elements can swap during partition |
| 9 | Is it in-place? | Yes — O(log n) stack overhead, no auxiliary array |
| 10 | Name the two ways to add randomness. | (1) random pivot per call; (2) random shuffle the whole array once, then plain Quicksort |
| 11 | What does "expected O(n log n)" mean in plain words? | The average over coin flips; almost always behaves like n log n |
| 12 | What is a pivot, and where does it end up after partition? | The split element; it lands in its final sorted position and never moves again |

### Junior Q&A — Worked Answers

**Q1. What is Randomized Quicksort?**
It is ordinary Quicksort with one change: the pivot is chosen *at random* from the current subarray (or the whole array is shuffled once before sorting). This makes the **expected** running time O(n log n) on *any* input, because no specific input can force the slow case anymore. The output is always fully sorted — only the running time varies.

**Q3. Why randomize the pivot?**
With a fixed pivot rule (always first or last), an attacker or unlucky data source can hand you the exact worst-case input every time — typically a sorted array — forcing O(n²). Randomizing means *you* control the pivot via a coin flip, so the input loses its power. The worst case still exists in theory, but it now requires bad *luck*, not a bad *input*, and that luck is vanishingly improbable.

**Q5. Is the output random?**
No. Randomized Quicksort is a **Las Vegas** algorithm: always correct, random *runtime*. You will never get an unsorted array. Two runs on the same input may take slightly different paths and times, but both produce the identical sorted result.

**Q10. Two ways to randomize?**
(1) **Random pivot:** at each recursive call pick a random index and use that element as pivot. (2) **Random shuffle:** Fisher–Yates shuffle the entire array once, then run plain Quicksort with any fixed pivot rule. Both give expected O(n log n); they are equivalent because Quicksort's cost depends only on the relative order of elements.

**Q6. Expected time complexity?**
O(n log n) on *every* input. The word "expected" means the average over the algorithm's coin flips, *for a fixed input*. There is no input distribution assumption — even a sorted or adversarial array gets expected O(n log n), because the randomness is in the pivots, not the data.

**Q7. Worst-case time complexity?**
Still O(n²) in theory — it would require the random pivot to land at (or near) an extreme on essentially every recursive call. The probability of that is astronomically small (super-exponentially small in n), so in practice it never happens. The honest interview phrasing is: "expected O(n log n); worst case O(n²) but with vanishing probability."

**Q11. What does 'expected O(n log n)' mean in plain words?**
If you ran the sort many times on the same input, the *average* running time would be O(n log n), and almost every individual run would be close to that average. It is like rolling dice: a single roll varies, but the long-run average is predictable — and here the variation is tiny relative to the mean.

**Q2. What single change turns plain Quicksort into Randomized Quicksort?**
Replace "pick a fixed-position pivot" with "pick a pivot at a random index in the current subarray," then swap it into the slot your partition expects. That is one extra line. Equivalently, shuffle the whole array once before sorting and keep a fixed pivot rule.

**Q4. What input makes naive Quicksort O(n²)?**
An already-sorted (or reverse-sorted) array with a "first" or "last" element pivot rule. Each partition then peels off just one element, producing n levels of O(n) work = O(n²). Randomization neutralizes exactly this case.

**Q8. Is it stable?**
No. The partition step can move equal-valued elements past each other, so their original relative order is not preserved. Use Merge Sort or TimSort if you need stability.

**Q12. Where does the pivot end up after partition?**
In its **final sorted position**. Everything to its left is ≤ it and everything to its right is > it, so it never needs to move again — that is why there is no merge step and the sort is in-place.

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Does a random pivot fix the all-equal-elements case? | No — random pivots fix adversarial *order*, not duplicate *values*; need 3-way partition |
| 2 | Explain the 3-way (Dutch flag) partition and when to use it. | Split into `<`, `==`, `>`; O(n) on all-equal; use for duplicate-heavy keys |
| 3 | Random pivot vs random shuffle — are they equivalent? | Yes in expected cost; both make every relative order equally likely |
| 4 | How many comparisons does Randomized Quicksort do on average? | ~1.39 n log₂ n (i.e., 2n ln n), ~39% above the n log₂ n minimum |
| 5 | How do you bound the recursion stack depth? | Tail-recurse on the smaller side, loop on the larger → O(log n) |
| 6 | Las Vegas vs Monte Carlo — which is Randomized Quicksort and why? | Las Vegas: always correct, random time (Monte Carlo = always fast, maybe wrong) |
| 7 | Randomized Quicksort vs Merge Sort — trade-offs? | QS: in-place, faster, not stable, no worst-case guarantee. MS: O(n) space, stable, guaranteed O(n log n) |
| 8 | What is median-of-three, and how does it relate to randomization? | Pivot = median of 3 samples; reduces variance; combine with random sampling for both benefits |
| 9 | Why is Quicksort faster than Merge Sort despite more comparisons? | Cache locality and in-place swaps; ~10× fewer memory writes |
| 10 | When would you choose deterministic over randomized Quicksort? | When you need reproducibility *and* can guarantee random input order |

### Middle Q&A — Worked Answers

**Q1. Does a random pivot fix the all-equal case?**
No — this is the classic trap. Consider `[5,5,5,5,5]`. Whichever element you randomly pick, the pivot is 5, so a 2-way partition produces "everything ≤ 5" (the whole array) and "nothing" — the worst split — at every level, giving O(n²). Random pivots only neutralize adversarial *ordering*. The fix for duplicate *values* is a **3-way partition**.

**Q2. Explain 3-way partition.**
Dutch National Flag partitioning maintains three regions: `< pivot`, `== pivot`, `> pivot`, using pointers `lt`, `i`, `gt`. Elements equal to the pivot collect in the middle band and are *never recursed on*, so an all-equal array sorts in one O(n) pass. Complexity becomes O(n·k) where k is the number of distinct values — asymptotically better than 2-way for few distinct keys.

**Q4. Average comparison count?**
About **1.39 n log₂ n**, equal to 2n ln n. Exactly, it is `2(n+1)H_n − 4n` where `H_n` is the harmonic number. That is ~39% more than the information-theoretic minimum (n log₂ n), but cache locality more than compensates in wall-clock time.

**Q6. Las Vegas vs Monte Carlo?**
**Las Vegas:** always correct, running time is the random variable (Randomized Quicksort, Quickselect). **Monte Carlo:** always within a time bound, but the answer is only probably correct (Miller–Rabin primality). For sorting you want Las Vegas — you would never accept occasionally-unsorted output, but you happily accept occasionally-slower.

**Q7. vs Merge Sort?**
Quicksort: in-place (O(log n) stack), excellent cache behavior, typically fastest in memory, but unstable and only *expected* O(n log n). Merge Sort: needs O(n) auxiliary space, is stable, sorts linked lists and external data well, and guarantees O(n log n) worst case. Choose Merge Sort when you need stability or a hard guarantee; Quicksort otherwise.

**Q3. Random pivot vs random shuffle — equivalent?**
Yes, in expected cost. A uniform shuffle makes every relative ordering of the array equally likely; choosing pivots uniformly at random makes every pivot sequence equally likely. Since Quicksort's running time depends only on the relative order (which comparisons occur), both produce the same distribution over comparison counts and hence the same expected O(n log n). Random pivot is usually preferred — no extra O(n) pass, and it works naturally in Quickselect where only one side recurses.

**Q5. Bound the recursion stack?**
Always recurse into the *smaller* partition and loop (iterate) on the larger one. The smaller side is at most half the current size, so the recursion-stack depth is bounded by log₂ n regardless of how lopsided the larger side gets. Without this, an unlucky pivot streak could push O(n) stack frames and overflow on large inputs — a real risk in Python/Java/Go, which lack guaranteed tail-call elimination.

**Q9. Why faster than Merge Sort despite more comparisons?**
Quicksort does ~1.39 n log n comparisons vs Merge Sort's ~1.0 n log n — about 39% more. But it wins in wall-clock time because it works *in place* with sequential memory access: ~10× fewer memory writes and excellent cache locality. Merge Sort round-trips data through an O(n) auxiliary buffer, thrashing the cache. On modern CPUs, memory traffic and cache misses dominate comparison count.

**Q8. What is median-of-three, and how does it relate to randomization?**
Median-of-three picks the pivot as the median of three sampled elements (classically `lo`, `mid`, `hi`). It reduces the chance of a terrible pivot and tightens the split distribution, lowering the comparison constant from ~1.39 to ~1.19 n log₂ n. By itself, *fixed-position* median-of-three is still defeatable by a crafted input (McIlroy's antiquicksort). Sampling the three positions *at random* (randomized median-of-three) combines both benefits: adversary resistance from randomization plus the smaller constant from median sampling — which is why production single-pivot sorts use it.

**Q10. When choose deterministic over randomized Quicksort?**
When you need byte-for-byte reproducible behavior (e.g., a deterministic test fixture or a system that must replay identically) *and* you can independently guarantee the input is randomly ordered, or you pre-shuffle with a fixed, recorded seed. Even then, a fixed seed is reproducible but not adversary-safe — an attacker who learns the seed can craft a worst-case input. For untrusted input, prefer an unpredictable seed or an Introsort fallback.

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a complexity-based DoS via sorting, and how do you defend? | Attacker forces O(n²) on fixed-pivot sort; defend with Introsort/Pdqsort or unpredictable random pivot |
| 2 | What is Introsort? | Quicksort + Insertion cutoff + Heap Sort fallback on deep recursion → worst-case O(n log n) |
| 3 | What is Pdqsort and how does it differ from blanket randomization? | Pattern-defeating; shuffles only when an imbalance is detected; block partitioning |
| 4 | Is a random-pivot sort with a predictable seed adversary-safe? | No — attacker who knows the seed reconstructs pivots; use CSPRNG or Heap fallback |
| 5 | Why is block partitioning faster on modern CPUs? | Removes data-dependent branch mispredictions in the inner loop |
| 6 | Why does Java's parallelSort use Merge Sort, not Quicksort? | Quicksort partition is sequential and load-imbalanced; Merge Sort splits evenly |
| 7 | What does each major language use for its built-in sort? | Go/Rust: pdqsort; C++: introsort; Java primitives: dual-pivot; Java objects/Python: TimSort |
| 8 | When is bare Randomized Quicksort the wrong production choice? | Real-time guarantees, stability needs, linked lists, external sort, reproducibility |
| 9 | What is Quickselect and its complexity? | Partition-based k-th smallest; expected O(n), worst O(n²) (O(n) with median-of-medians) |
| 10 | How would you monitor for a sort-based attack in production? | Alert on p99 latency spikes, max recursion depth, heap-fallback count |

### Senior Q&A — Worked Answers

**Q1. Complexity DoS via sorting?**
If a service sorts user-controlled data with a fixed-pivot Quicksort, an attacker submits the worst-case input (e.g., sorted) to force O(n²) — seconds of CPU per request, exhausting the server. It is the sorting analogue of Hash-DoS. Defenses, strongest first: (1) Introsort/Pdqsort Heap-Sort fallback for a *hard* O(n log n) guarantee; (2) random pivot seeded from a CSPRNG; (3) input-size caps; (4) use a built-in that is already immune.

**Q3. Pdqsort vs blanket randomization?**
Pdqsort (pattern-defeating Quicksort; Go, Rust, Boost) uses median-of-three/ninther pivots and only *shuffles a few elements when it detects a badly unbalanced partition* — randomization applied *on demand* rather than on every call. It adds block partitioning (branch-prediction friendly) and an Introsort Heap fallback. Net: adversary resistance and O(n log n) worst case, with less RNG overhead and better cache behavior than per-call randomization.

**Q4. Predictable seed?**
Not safe. McIlroy's "antiquicksort" shows any *deterministic* pivot rule has an adversarial input; a randomized rule whose seed is known/guessable is effectively deterministic to the attacker, who can then reconstruct the pivot sequence and craft the killer input. Use an unpredictable (CSPRNG-derived) seed, or — better — rely on a Heap Sort fallback that gives a deterministic guarantee independent of the RNG.

**Q9. Quickselect?**
Reuses Quicksort's partition to find the k-th smallest without fully sorting. After partitioning, recurse only into the side containing rank k. Expected O(n) (each step shrinks the problem by a constant fraction → T(n)=T(3n/4)+O(n)). Worst case O(n²) with a bad pivot; median-of-medians makes it deterministic O(n). It powers `std::nth_element` and `numpy.partition`.

**Q2. What is Introsort?**
Introsort (Musser, 1997; the basis of C++ `std::sort`) is a hybrid: it runs Quicksort but (a) switches to **Insertion Sort** for small subarrays (~≤16), and (b) tracks recursion depth, falling back to **Heap Sort** once depth exceeds `2·⌊log₂ n⌋`. The Heap Sort fallback fires only when a bad-pivot streak appears, converting Quicksort's *expected* O(n log n) into a *hard worst-case* O(n log n) — while keeping Quicksort's speed for the common case.

**Q6. Why does Java's parallelSort use Merge Sort, not Quicksort?**
Two reasons. First, the Quicksort partition step is *sequential* and O(n), and an unbalanced pivot gives one task far more work than the other — poor load balancing across threads. Merge Sort always splits exactly in half, so ForkJoin tasks are evenly sized. Second, Merge Sort is *stable*, which Java guarantees for object sorts. So `Arrays.parallelSort` uses a parallel Merge Sort for predictable scaling and stability.

**Q7. What does each language use?**
Go (`slices.Sort`) and Rust (`sort_unstable`): **pdqsort** (pattern-defeating Quicksort). C++ `std::sort`: **introsort**. Java `Arrays.sort(int[])` for primitives: **dual-pivot Quicksort** (Yaroslavskiy). Java object sort and Python `sorted`/`list.sort`: **TimSort** (stable, adaptive merge sort). Knowing this signals you understand that "Quicksort" in production always means a hardened hybrid.

**Q10. How would you monitor for a sort-based attack?**
Emit metrics for sort p99 latency, max recursion depth per call, and (in an Introsort) the count of Heap Sort fallbacks. A sudden p99 spike or a surge in fallbacks on a user-facing endpoint is the fingerprint of a complexity-DoS probe. Alert on these, cap input sizes, and ensure the underlying sort is a randomized/pattern-defeating variant.

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove the expected comparison count is O(n log n) using indicator variables. | `Pr[i,j compared]=2/(j−i+1)`, linearity → 2n ln n |
| 2 | Why is `Pr[z_i compared with z_j] = 2/(j−i+1)`? | First pivot from Z_{ij} must be z_i or z_j; uniform over j−i+1 elements |
| 3 | Why are two elements compared at most once? | Comparisons only involve the pivot; a pivot is fixed and never compared again |
| 4 | Prove correctness (Las Vegas property). | Partition loop invariant + strong induction; independent of coins |
| 5 | Give the high-probability bound and sketch the Chernoff argument. | Depth O(log n) w.h.p.; balanced pivots are Bernoulli(1/2); union bound |
| 6 | How do you get a *deterministic* O(n log n) Quicksort? | Median-of-medians (BFPRT) exact-median pivot → 50/50 split |
| 7 | Why does median-of-medians guarantee a good split? | ≥3n/10 on each side; recurrence T(n)≤T(n/5)+T(7n/10)+O(n)=O(n) |
| 8 | Prove the Ω(n log n) comparison lower bound. | Decision tree of height ≥ log₂(n!) = Ω(n log n) |
| 9 | Why does Randomized Quicksort beat Merge Sort despite ~1.39 n log n comparisons? | Cache-oblivious O((n/B)log_{M/B}(n/B)); ~10× fewer memory writes |
| 10 | Does randomization make Quicksort asymptotically faster on average? | No — both Θ(n log n) expected; randomization buys *robustness*, not speed |

### Professional Q&A — Worked Answers

**Q1. Prove expected O(n log n) via indicators.**
Let `z₁<…<z_n` be the sorted order. Define `X_{ij}=1` if `z_i` and `z_j` are ever compared. Total comparisons `X=Σ_{i<j}X_{ij}`. By linearity, `E[X]=Σ_{i<j}Pr[z_i,z_j compared]`. Since `Pr[compared]=2/(j−i+1)` (Q2), substituting `k=j−i`:
`E[X]=Σ_{i<j}2/(j−i+1) < Σ_{i=1}^{n-1}2(H_n−1) < 2nH_n = 2n ln n + Θ(n) ≈ 1.386 n log₂ n.`
Hence expected time Θ(n log n). The power of the method is that linearity holds despite the `X_{ij}` being dependent.

**Q2. Why 2/(j−i+1)?**
Let `Z_{ij}={z_i,…,z_j}`. These stay in one partition until some element of `Z_{ij}` is picked as pivot (an outside pivot sends all of `Z_{ij}` to one side). If the *first* `Z_{ij}` element chosen as pivot is `z_i` or `z_j`, the two are compared (pivot vs everyone in its partition). If it is a strictly-between `z_k` (i<k<j), it separates them and they are never compared. The first pivot is uniform over the `j−i+1` elements, and 2 of them are favorable, so the probability is `2/(j−i+1)`.

**Q5. High-probability bound.**
Call a pivot "balanced" if both sides are ≤ 3/4 of the subarray; this has probability 1/2. Following any fixed element down the recursion, each balanced pivot shrinks its subarray by ≥ 3/4, so `log_{4/3}n` balanced pivots suffice to reach size 1. Over `a·log n` levels, the count of balanced pivots is a sum of independent Bernoulli(1/2)s; Chernoff bounds the probability of too few by `n^{−c}`. Union bound over n elements: `Pr[depth > a log n] ≤ n^{1−c} ≤ 1/n`. So depth is O(log n) w.h.p., giving O(n log n) time w.h.p.

**Q10. Does randomization speed it up?**
No. Deterministic and randomized Quicksort are both Θ(n log n) *in expectation* (deterministic assuming random input). Randomization does not lower the average; it **redistributes** the worst case from being input-determined to coin-determined, making it astronomically unlikely and adversary-resistant. The benefit is *robustness/security*, not raw average speed.

**Q3. Why are two elements compared at most once?**
Comparisons in Quicksort only ever happen between the *current pivot* and another element of its partition. Once an element is chosen as a pivot, it is placed in its final position and removed from all future subproblems — so it is never compared again. Therefore any pair `(z_i, z_j)` can be compared at most once: only when one of them is the pivot. This is what lets us model each pair with a single 0/1 indicator.

**Q6. Deterministic O(n log n) Quicksort?**
Use **median-of-medians (BFPRT)** to compute the *exact* median in O(n) and use it as the pivot at every level. The exact median guarantees a 50/50 split, so `T(n) = 2T(n/2) + O(n) = O(n log n)` worst case, deterministically. The catch is the large constant factor, so production prefers Introsort's cheaper Heap-Sort fallback for the worst-case guarantee.

**Q8. Prove the Ω(n log n) lower bound.**
Any comparison sort is a binary decision tree whose leaves are the possible output permutations. To sort all inputs correctly, it needs at least `n!` leaves. A binary tree with `n!` leaves has height ≥ log₂(n!) = Ω(n log n) (by Stirling). The height equals the worst-case comparison count, so every comparison sort makes Ω(n log n) comparisons. By Yao's principle, randomization cannot beat this expected bound either.

**Q9. Why beat Merge Sort despite 1.39 n log n comparisons (formal)?**
Cache-obliviously, Quicksort incurs O((n/B)·log_{M/B}(n/B)) cache misses — matching the Aggarwal–Vitter optimal I/O bound — and does its work in place (~16 MB of writes for n=10⁶ ints vs ~160 MB for Merge Sort's buffer round-trips). The comparison overhead is a small constant; the memory-traffic advantage is ~10×, which dominates wall-clock time.

---

## Coding Challenge (3 Languages)

### Challenge: Implement Randomized Quickselect — k-th Smallest in Expected O(n)

> Given an integer array and an integer `k` (1-indexed), return the k-th smallest element in **expected O(n)** time using a *randomized pivot* and Quicksort's partition. Modify in place; do not fully sort. Must handle duplicates correctly.
>
> Examples:
> `kthSmallest([7,10,4,3,20,15], 3) == 7`  (sorted: 3,4,7,10,15,20 → 3rd is 7)
> `kthSmallest([5,5,5,5], 2) == 5`
> `kthSmallest([1], 1) == 1`

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
)

// kthSmallest returns the k-th smallest (1-indexed). Expected O(n).
func kthSmallest(arr []int, k int) int {
    lo, hi := 0, len(arr)-1
    target := k - 1 // convert to 0-indexed rank
    for lo < hi {
        p := randomizedPartition(arr, lo, hi)
        if p == target {
            return arr[p]
        } else if p < target {
            lo = p + 1
        } else {
            hi = p - 1
        }
    }
    return arr[lo]
}

func randomizedPartition(a []int, lo, hi int) int {
    r := lo + rand.Intn(hi-lo+1)
    a[r], a[hi] = a[hi], a[r]
    pivot := a[hi]
    i := lo - 1
    for j := lo; j < hi; j++ {
        if a[j] <= pivot {
            i++
            a[i], a[j] = a[j], a[i]
        }
    }
    a[i+1], a[hi] = a[hi], a[i+1]
    return i + 1
}

func main() {
    fmt.Println(kthSmallest([]int{7, 10, 4, 3, 20, 15}, 3)) // 7
    fmt.Println(kthSmallest([]int{5, 5, 5, 5}, 2))          // 5
    fmt.Println(kthSmallest([]int{1}, 1))                   // 1
}
```

#### Java

```java
import java.util.concurrent.ThreadLocalRandom;

public class Solution {
    // k-th smallest, 1-indexed, expected O(n)
    public static int kthSmallest(int[] arr, int k) {
        int lo = 0, hi = arr.length - 1, target = k - 1;
        while (lo < hi) {
            int p = randomizedPartition(arr, lo, hi);
            if (p == target) return arr[p];
            else if (p < target) lo = p + 1;
            else hi = p - 1;
        }
        return arr[lo];
    }

    static int randomizedPartition(int[] a, int lo, int hi) {
        int r = ThreadLocalRandom.current().nextInt(lo, hi + 1);
        swap(a, r, hi);
        int pivot = a[hi], i = lo - 1;
        for (int j = lo; j < hi; j++) if (a[j] <= pivot) swap(a, ++i, j);
        swap(a, i + 1, hi);
        return i + 1;
    }

    static void swap(int[] a, int x, int y) { int t = a[x]; a[x] = a[y]; a[y] = t; }

    public static void main(String[] args) {
        System.out.println(kthSmallest(new int[]{7, 10, 4, 3, 20, 15}, 3)); // 7
        System.out.println(kthSmallest(new int[]{5, 5, 5, 5}, 2));          // 5
        System.out.println(kthSmallest(new int[]{1}, 1));                   // 1
    }
}
```

#### Python

```python
import random


def kth_smallest(arr, k):
    """k-th smallest (1-indexed), expected O(n). Modifies arr in place."""
    lo, hi, target = 0, len(arr) - 1, k - 1
    while lo < hi:
        p = randomized_partition(arr, lo, hi)
        if p == target:
            return arr[p]
        elif p < target:
            lo = p + 1
        else:
            hi = p - 1
    return arr[lo]


def randomized_partition(a, lo, hi):
    r = random.randint(lo, hi)
    a[r], a[hi] = a[hi], a[r]
    pivot = a[hi]
    i = lo - 1
    for j in range(lo, hi):
        if a[j] <= pivot:
            i += 1
            a[i], a[j] = a[j], a[i]
    a[i + 1], a[hi] = a[hi], a[i + 1]
    return i + 1


if __name__ == "__main__":
    print(kth_smallest([7, 10, 4, 3, 20, 15], 3))  # 7
    print(kth_smallest([5, 5, 5, 5], 2))           # 5
    print(kth_smallest([1], 1))                    # 1
```

**Why expected O(n)?** Quickselect recurses on only *one* side of the partition. A random pivot gives a subarray of size ≤ 3n/4 with probability ≥ 1/2, so `T(n) ≤ T(3n/4) + O(n) = O(n)` in expectation. The randomized pivot also defeats the sorted-input attack that would otherwise make a fixed-pivot version O(n²).

**Follow-ups an interviewer may ask:**
- *Make it worst-case O(n).* Replace the random pivot with median-of-medians (BFPRT).
- *Return the top-k, not just the k-th.* After `kthSmallest`, `arr[:k]` holds the k smallest in any order.
- *Avoid mutating the input.* Copy the array first (costs O(n) space).
- *Handle k out of range.* Validate `1 ≤ k ≤ len(arr)` and raise/error.

---

### Bonus Challenge: 3-Way Randomized Quicksort (Duplicate-Heavy Input)

> Sort an array that may contain **many duplicate values** efficiently. A 2-way Randomized Quicksort degrades to O(n²) on all-equal input; your 3-way version must run in O(n) on all-equal input and O(n·k) for k distinct values. Use a random pivot and Dutch-National-Flag partitioning.
>
> Example: `sort([5,3,5,1,5,3,1,5,3]) == [1,1,3,3,3,5,5,5,5]`, and `sort([7]*1_000_000)` must finish near-instantly.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
)

func Sort3Way(a []int) { qs(a, 0, len(a)-1) }

func qs(a []int, lo, hi int) {
    if lo >= hi {
        return
    }
    r := lo + rand.Intn(hi-lo+1) // random pivot
    a[lo], a[r] = a[r], a[lo]
    pivot := a[lo]
    lt, gt, i := lo, hi, lo+1
    for i <= gt {
        switch {
        case a[i] < pivot:
            a[lt], a[i] = a[i], a[lt]
            lt++
            i++
        case a[i] > pivot:
            a[i], a[gt] = a[gt], a[i]
            gt--
        default:
            i++
        }
    }
    qs(a, lo, lt-1)   // recurse only on < region
    qs(a, gt+1, hi)   // recurse only on > region (== band is done)
}

func main() {
    data := []int{5, 3, 5, 1, 5, 3, 1, 5, 3}
    Sort3Way(data)
    fmt.Println(data) // [1 1 3 3 3 5 5 5 5]
}
```

#### Java

```java
import java.util.Arrays;
import java.util.concurrent.ThreadLocalRandom;

public class Sort3Way {
    public static void sort(int[] a) { qs(a, 0, a.length - 1); }

    static void qs(int[] a, int lo, int hi) {
        if (lo >= hi) return;
        int r = ThreadLocalRandom.current().nextInt(lo, hi + 1);
        swap(a, lo, r);
        int pivot = a[lo], lt = lo, gt = hi, i = lo + 1;
        while (i <= gt) {
            if (a[i] < pivot)      swap(a, lt++, i++);
            else if (a[i] > pivot) swap(a, i, gt--);
            else                   i++;
        }
        qs(a, lo, lt - 1);
        qs(a, gt + 1, hi);
    }

    static void swap(int[] a, int x, int y) { int t = a[x]; a[x] = a[y]; a[y] = t; }

    public static void main(String[] args) {
        int[] data = {5, 3, 5, 1, 5, 3, 1, 5, 3};
        sort(data);
        System.out.println(Arrays.toString(data));
    }
}
```

#### Python

```python
import random
import sys

sys.setrecursionlimit(1_000_000)


def sort_3way(a, lo=0, hi=None):
    if hi is None:
        hi = len(a) - 1
    if lo >= hi:
        return
    r = random.randint(lo, hi)          # random pivot
    a[lo], a[r] = a[r], a[lo]
    pivot = a[lo]
    lt, gt, i = lo, hi, lo + 1
    while i <= gt:
        if a[i] < pivot:
            a[lt], a[i] = a[i], a[lt]
            lt += 1
            i += 1
        elif a[i] > pivot:
            a[i], a[gt] = a[gt], a[i]
            gt -= 1
        else:
            i += 1
    sort_3way(a, lo, lt - 1)
    sort_3way(a, gt + 1, hi)


if __name__ == "__main__":
    data = [5, 3, 5, 1, 5, 3, 1, 5, 3]
    sort_3way(data)
    print(data)  # [1, 1, 3, 3, 3, 5, 5, 5, 5]
```

**Why O(n) on all-equal input?** Every element equals the pivot, so they all fall into the `==` band in a single pass; both recursive ranges (`< ` and `>`) are empty. More generally, with k distinct values the recursion depth is O(k) and each level is O(n), giving O(n·k). The expected comparison count is Θ(n·H) where H is the Shannon entropy of the value distribution — optimal for multiset sorting.

**Follow-ups:**
- *What if you used a 2-way partition here?* All-equal input → O(n²); the whole point of 3-way is to avoid that.
- *Bound the stack.* Tail-recurse on the smaller of the `<`/`>` ranges.
- *Can you make it stable?* Not in place; a stable 3-way needs O(n) extra space.

---

## Rapid-Fire Review (One-Liners)

| Prompt | Answer |
|--------|--------|
| Headline guarantee | Expected O(n log n) on any input |
| Algorithm class | Las Vegas (always correct, random time) |
| Expected comparisons | ~1.39 n log₂ n (= 2n ln n) |
| Pr two ranks i,j compared | 2/(j − i + 1) |
| Fixes sorted-input worst case? | Yes |
| Fixes all-equal worst case? | No — need 3-way partition |
| Two randomization methods | Random pivot; random shuffle then sort |
| Stack-depth control | Recurse smaller side, loop larger |
| Worst-case guarantee variant | Introsort (Heap Sort fallback) or median-of-medians |
| O(n) selection | Quickselect (partition, recurse one side) |
| Production engines | pdqsort (Go/Rust), introsort (C++), dual-pivot (Java ints) |
| Security risk it solves | Complexity-DoS from adversarial input |
| Predictable-seed caveat | Attacker can reconstruct pivots → not safe |
| Lower bound | Ω(n log n) comparisons; randomization can't beat it |
| vs Merge Sort | Faster/in-place but unstable, no hard worst case |

---

## Mistakes That Sink Candidates

These are the errors interviewers watch for — avoid them:

1. **"Randomization makes it O(n log n) worst case."** Wrong — it makes it *expected* O(n log n); the worst case is still O(n²), just improbable. Say "expected."
2. **"A random pivot handles duplicates."** No — all-equal input is still O(n²) with a 2-way partition. You need a **3-way (Dutch flag)** partition. This is the single most common trap.
3. **Confusing Las Vegas and Monte Carlo.** Randomized Quicksort is **Las Vegas**: always correct, random time. Miller–Rabin is Monte Carlo: fast, occasionally wrong.
4. **Forgetting to randomize every recursive call** (or claiming top-level randomization suffices). Each subproblem needs its own random pivot — or shuffle once up front.
5. **Off-by-one in the random index range** — it must be inclusive: `random in [lo, hi]`.
6. **Ignoring stack depth.** Mention tail-recursing on the smaller side to bound it to O(log n).
7. **Claiming determinism is "just as safe."** McIlroy's antiquicksort defeats *any* deterministic rule; only randomness (unpredictable seed) or a Heap-Sort fallback is adversary-safe.
8. **Saying "Quicksort is in-place" without the O(log n) stack caveat.**

If you state the expected/worst-case distinction precisely, name the 3-way fix for duplicates, and mention the Introsort fallback for a hard guarantee, you have covered what most interviewers are probing for.

---

## How to Structure a Whiteboard Answer

A clean 5-minute response to "implement and analyze randomized quicksort":

1. **State the idea** (15s): "Quicksort with a random pivot → expected O(n log n) on any input; it's Las Vegas — always correct, random time."
2. **Write partition first** (90s): Lomuto or Hoare, then add the random-pivot swap. Talk through the loop invariant as you write.
3. **Write the recursive driver** (30s): partition, recurse both sides; mention tail-recursing the smaller side for O(log n) stack.
4. **Analyze** (60s): expected ~1.39 n log₂ n via the `2/(j−i+1)` indicator argument; worst case O(n²) but probability → 0.
5. **Discuss robustness** (45s): random pivot defeats sorted-input/DoS attacks; add 3-way partition for duplicates; Introsort fallback for a hard guarantee.
6. **Test cases** (30s): empty, single, all-equal, sorted, reverse — show all stay fast (with 3-way for all-equal).

Hitting all six beats a candidate who only writes working code, because it demonstrates you understand *why* the algorithm is designed this way.

---

## Further Study

- CLRS Chapter 7, §7.3–7.4 (randomized analysis, indicator variables)
- The [professional analysis](./professional.md) in this topic for full proofs
- Motwani & Raghavan, *Randomized Algorithms* (Las Vegas vs Monte Carlo)
- Orson Peters, pdqsort; David Musser, "Introspective Sorting" (Introsort)

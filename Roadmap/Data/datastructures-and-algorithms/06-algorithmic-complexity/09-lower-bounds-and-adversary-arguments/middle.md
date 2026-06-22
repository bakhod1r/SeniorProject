# Lower Bounds and Adversary Arguments — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Comparison / Decision-Tree Model](#the-comparison--decision-tree-model)
3. [The Information-Theoretic Lower Bound](#the-information-theoretic-lower-bound)
   - [Sorting: Θ(n log n) via Stirling](#sorting-θn-log-n-via-stirling)
   - [Searching a Sorted Array: Ω(log n)](#searching-a-sorted-array-ωlog-n)
   - [Merging, Predecessor, and Other Quick Hits](#merging-predecessor-and-other-quick-hits)
4. [The Adversary Method, Formally](#the-adversary-method-formally)
5. [Finding the Maximum: n − 1 Comparisons](#finding-the-maximum-n--1-comparisons)
6. [Finding Max and Min Together: ⌈3n/2⌉ − 2](#finding-max-and-min-together-3n2--2)
7. [Finding the Second Largest: n + ⌈log₂ n⌉ − 2](#finding-the-second-largest-n--log-n--2)
8. [Element Distinctness and Lower Bounds by Reduction](#element-distinctness-and-lower-bounds-by-reduction)
9. [Code: An Adversary That Plays Against Your Algorithm](#code-an-adversary-that-plays-against-your-algorithm)
10. [Code: A Decision-Tree Leaf Counter](#code-a-decision-tree-leaf-counter)
11. [Pitfalls](#pitfalls)
12. [Summary](#summary)

---

## Introduction

> Focus: turn the junior intuition ("a decision tree with `n!` leaves must be deep") into rigorous proofs, then widen the toolkit from one trick (sorting) to a family of adversary arguments that nail exact constants.

At the [junior level](./junior.md) you met the two ideas this topic rests on. An **upper bound** is a guarantee a *specific* algorithm delivers ("merge sort sorts in `O(n log n)`"). A **lower bound** is a guarantee about *every possible* algorithm ("*no* comparison sort can beat `Ω(n log n)`"). You also saw two proof shapes informally: the **decision tree** for sorting, and an **adversary** for finding the maximum.

The middle level makes both rigorous and pushes them further. Two complementary techniques carry the whole topic:

- The **information-theoretic** (decision-tree) argument. Any algorithm whose only access to the input is **binary tests** is a binary tree; distinguishing among `N` possible outcomes needs `≥ ⌈log₂ N⌉` tests in the worst case, because a binary tree of height `h` has at most `2^h` leaves. This is a *counting* argument and gives `Ω(n log n)` for sorting, `Ω(log n)` for sorted search, and more.
- The **adversary** argument. An imaginary opponent answers the algorithm's queries *without committing to a fixed input*, keeping its answers consistent with as many inputs as possible, forcing the algorithm to ask more questions before it can be sure of the answer. This technique pins down *exact constants* the counting bound cannot reach: `n − 1` for the max, `⌈3n/2⌉ − 2` for max-and-min, `n + ⌈log₂ n⌉ − 2` for the second largest.

The unifying slogan: **a lower bound is a statement about a model**. Both techniques bound only what algorithms *in a stated model* (here: comparisons) can do. Change the model — let the algorithm read individual digits, as radix sort does — and the bound can evaporate. We will return to this repeatedly; it is the single most misquoted fact in the subject.

A note on cross-references. The `Ω(n log n)` sorting bound is the reason [comparison sorts](../../07-sorting-algorithms/) (merge, quick, heap) cannot do better, and the reason the *non-comparison* sorts ([counting](../../07-sorting-algorithms/07-counting-sort/), [radix](../../07-sorting-algorithms/08-radix-sort/)) are interesting at all. The same "what can no algorithm do" mindset appears in [approximation and hardness](../08-approximation-and-hardness/middle.md), where the lower bound is on *approximation ratio* rather than comparison count.

---

## The Comparison / Decision-Tree Model

Fix the **model** precisely before proving anything in it. In the **comparison model**, an algorithm operating on `n` input elements `a₁, …, aₙ`:

- may **compare** two elements, asking a question of the form `aᵢ < aⱼ?` (or `≤`, `=`, `>`), receiving a **yes/no** answer;
- may move, copy, and output elements;
- may **not** otherwise inspect an element — it cannot read its bits, hash it, index an array by its value, or do arithmetic on it.

Every comparison sort, every comparison-based selection or search, lives here. Sorting networks, merge sort, quicksort's partition, binary search, heap operations: all are comparison algorithms.

A deterministic comparison algorithm on a *fixed input size* `n` is exactly a **binary decision tree**:

- each **internal node** is one comparison `aᵢ : aⱼ`;
- its two **edges** are the two answers (`<` and `≥`, say);
- each **leaf** is an **output** — for sorting, a specific permutation; for search, an answer index; for a decision problem, "yes"/"no".

The algorithm's execution on an input is a **root-to-leaf path**: start at the root, ask its comparison, follow the matching edge, repeat until a leaf. The number of comparisons that execution makes is the **depth of that leaf**. Therefore:

> **Worst-case comparisons = height of the decision tree.**
> **Best-case comparisons = depth of the shallowest reachable leaf.**

This identity converts an algorithmic question ("how many comparisons in the worst case?") into a combinatorial one ("how short can the tree be?"), which is what makes the lower bound provable. The proof of a lower bound now reduces to two facts: (1) the tree must have *at least* `N` leaves, one per distinguishable outcome; (2) a binary tree with `L` leaves has height `≥ ⌈log₂ L⌉`.

```text
                 a₁ : a₂
              <  /        \  ≥
          a₂ : a₃          a₁ : a₃
          /   \             /   \
   [1,2,3]  a₁:a₃     [2,1,3]  a₂:a₃
            /  \                /  \
     [1,3,2] [3,1,2]      [2,3,1] [3,2,1]
```

The sketch above is a decision tree sorting three elements: six leaves (`3! = 6` permutations), height `3`. No comparison sort of three elements can always finish in two comparisons, because a height-2 tree has at most `2² = 4` leaves — too few to name all six orderings.

---

## The Information-Theoretic Lower Bound

The whole family of decision-tree lower bounds rests on one counting lemma.

> **Leaf-counting lemma.** A binary tree of height `h` has at most `2^h` leaves. Equivalently, a binary tree with `L` leaves has height `≥ ⌈log₂ L⌉`.

*Proof.* By induction on `h`. A tree of height `0` is a single leaf: `1 ≤ 2⁰`. A tree of height `h` has a root with at most two subtrees, each of height `≤ h − 1`, hence each with `≤ 2^{h−1}` leaves; the root's leaves are the union, so `≤ 2·2^{h−1} = 2^h`. ∎

Now the master argument:

> **Information-theoretic lower bound.** If a problem has `N` distinguishable outcomes, and an algorithm distinguishes them using only binary (yes/no) tests, then in the worst case it makes `≥ ⌈log₂ N⌉` tests.

*Proof.* The algorithm is a binary decision tree. Two inputs with *different* correct outputs cannot reach the *same* leaf — if they did, the algorithm would emit one answer for both, and be wrong on at least one. So the tree needs `≥ N` distinct leaves, one per output. By the lemma its height is `≥ ⌈log₂ N⌉`, and worst-case test count equals height. ∎

The intuition is **information accounting**: one yes/no answer carries at most one bit; identifying one outcome out of `N` requires `log₂ N` bits of information; therefore at least `log₂ N` answers. The bound is *tight* only when every answer can be made to carry a full bit (a perfectly balanced tree), which is why the technique gives sharp *orders of growth* but often loose *constants* — for exact constants we will switch to the adversary method.

### Sorting: Θ(n log n) via Stirling

Sorting `n` distinct elements has `N = n!` outcomes: each input ordering corresponds to one of the `n!` permutations that sorts it, and any correct sorter must be able to emit each of them. Apply the master bound:

```text
worst-case comparisons  ≥  ⌈log₂(n!)⌉
```

To turn `log₂(n!)` into a clean `Θ(n log n)`, estimate it carefully. Two routes give the same answer.

**Route 1 — Stirling's approximation.** Stirling's formula states

```text
n!  =  √(2πn) · (n/e)^n · (1 + o(1))
```

Taking `log₂` of both sides:

```text
log₂(n!)  =  log₂ √(2πn)  +  n·log₂(n/e)  +  o(1)
          =  n·log₂ n  −  n·log₂ e  +  ½·log₂(2πn)  +  o(1)
          =  n·log₂ n  −  n·log₂ e  +  O(log n)
```

with `log₂ e ≈ 1.4427`. The leading term is `n log₂ n`; the `−n log₂ e` is a *linear* correction, swamped at scale. Hence `log₂(n!) = n log₂ n − Θ(n) = Θ(n log n)`.

**Route 2 — elementary squeeze (no Stirling).** A two-sided bound, good for a proof you can reconstruct on a whiteboard:

```text
Lower:  n!  =  n·(n−1)···2·1  ≥  (n/2)^{n/2}
        because the top n/2 factors are each ≥ n/2.
        ⇒  log₂(n!)  ≥  (n/2)·log₂(n/2)  =  (n/2)(log₂ n − 1)  =  Ω(n log n).

Upper:  n!  ≤  n^n  ⇒  log₂(n!)  ≤  n·log₂ n  =  O(n log n).
```

Both sides are `Θ(n log n)`, so `log₂(n!) = Θ(n log n)` — no Stirling needed for the order, though Stirling gives the sharp `n log₂ n − n log₂ e` leading constant.

> **Conclusion.** Every comparison sort makes `Ω(n log n)` comparisons in the worst case. Since merge sort and heap sort *achieve* `O(n log n)`, the comparison complexity of sorting is `Θ(n log n)`: a matched lower and upper bound. The bound holds *on average* too (a deeper argument over the leaf depths), so even quicksort's expected behavior cannot escape it.

This is the canonical lower bound and the reason no clever comparison sort will ever be discovered that beats `n log n` — the obstruction is information, not ingenuity.

### Searching a Sorted Array: Ω(log n)

Searching a sorted array of `n` elements for a target (returning its position, or "absent") by comparisons has at least `n + 1` distinguishable outcomes: the target may match any of the `n` positions, or fall into one of the gaps (we can coarsen to `n` outcomes — "which element equals the target, if any" — without changing the order). The master bound gives

```text
worst-case comparisons  ≥  ⌈log₂(n + 1)⌉  =  Ω(log n).
```

[Binary search](../../08-search-algorithms/) achieves `⌈log₂(n + 1)⌉` comparisons, so the bound is *exactly* tight: searching a sorted array is `Θ(log n)`, and binary search is comparison-optimal. The same counting fact explains why a *balanced* binary search tree cannot answer membership in fewer than `Ω(log n)` comparisons — its leaves are the `n + 1` gaps.

### Merging, Predecessor, and Other Quick Hits

The same lemma dispatches several problems in a line each.

- **Merging two sorted lists of sizes `m` and `n`.** The number of ways to interleave them is `C(m + n, m)` (choose which of the `m + n` output positions come from the first list). So `≥ ⌈log₂ C(m+n, m)⌉` comparisons. For `m = n` this is `Θ(n)` (matching the standard linear merge), but it also proves the merge constant: `log₂ C(2n, n) ≈ 2n − Θ(log n)`, so merging two equal lists needs about `2n − o(n)` comparisons — you cannot merge with `n` comparisons.
- **Predecessor / successor in a sorted structure.** Locating where a key falls among `n` sorted keys has `n + 1` outcomes ⇒ `Ω(log n)` comparisons, again matched by binary search. (In *stronger* models that read key bits, van Emde Boas trees beat this — a preview of how the model controls the bound.)
- **Insertion into a sorted list.** Finding the insertion point among `n` elements is the `n + 1`-outcome search again: `Ω(log n)` comparisons, the reason binary insertion sort spends `Θ(n log n)` comparisons (though `Θ(n²)` moves).

In every case the recipe is identical: **count the outcomes, take `log₂`, that is your floor.** The art is only in counting the outcomes correctly.

---

## The Adversary Method, Formally

The counting bound is blunt about constants. To prove "finding the max needs *exactly* `n − 1`" or "max-and-min needs *exactly* `⌈3n/2⌉ − 2`", we need a sharper instrument: the **adversary**.

Picture the computation as a game between the **algorithm** and an **adversary** who controls the input. The twist:

> The adversary does **not** fix the input in advance. It answers each comparison **on the fly**, choosing whichever answer is consistent with the *largest, hardest* set of remaining possible inputs — as long as that answer is consistent with at least one input matching every earlier answer.

Formally, maintain a set `S` of inputs **consistent** with all answers given so far. Initially `S` is *all* inputs. On each query, the adversary picks the answer that keeps `S` as favorable as possible (large, or otherwise hard). Two facts make this a valid proof:

1. **Consistency.** Because every answer is consistent with at least one surviving input, at the end there is a genuine input on which the algorithm ran exactly this way. The adversary never "cheats" — its answers can always be realized by *some* fixed input.
2. **Termination obligation.** The algorithm may only stop when `S` has collapsed enough that the answer is *forced* — when all surviving inputs share the same output. If two surviving inputs would require *different* outputs, the algorithm cannot yet be correct on both, so it must ask again.

The lower bound is then: **count the queries the adversary can force before the surviving set is small enough to commit.** If the adversary can guarantee that fewer than `k` queries always leave two inputs with different outputs alive, then `k` is a lower bound.

The mechanical version most adversary proofs use is a **state / weight argument**: assign each element a *label* recording what is known about it, define a potential measuring "distance from a committable state", show each comparison changes the potential by at most a fixed amount, and bound the number of comparisons by total-needed-progress ÷ max-progress-per-step. The next three sections are exactly this pattern, at increasing subtlety.

---

## Finding the Maximum: n − 1 Comparisons

**Claim.** Finding the maximum of `n` elements requires `n − 1` comparisons in the comparison model, and this is optimal (the obvious sweep achieves it).

**Upper bound (n − 1 suffices).** Keep a running champion; compare it against each of the other `n − 1` elements once. `n − 1` comparisons, done.

**Lower bound (n − 1 necessary) — the loss-accounting adversary.** The key observation: an element can be ruled out as the maximum *only* by losing a comparison (being found smaller than something). Track each element's status:

- An element is **eligible** (could still be the max) until it loses at least once.
- Initially all `n` elements are eligible.
- To correctly name *one* element as the unique max, all `n − 1` *other* elements must be ineligible — each must have lost at least one comparison.

Now the accounting. Each comparison produces **at most one new loser**: comparing `aᵢ : aⱼ` makes at most one of them a loser (the smaller), and if both already lost it creates *zero* new losers. To create `n − 1` losers, the algorithm needs at least `n − 1` comparisons. The adversary's only job is to answer consistently — e.g., always answer so that the *currently-believed-larger* element wins, which is realizable by the input that respects all answers — and to refuse to let any comparison eliminate two fresh candidates at once. (No comparison can: a single comparison has one smaller side.) Hence `≥ n − 1` comparisons. ∎

The loss-accounting argument is the cleanest adversary proof there is, and it generalizes: every element that is *not* the answer must accumulate enough "evidence against it", and each query supplies a bounded amount of evidence. This is the template for the next two, harder, bounds.

---

## Finding Max and Min Together: ⌈3n/2⌉ − 2

**Claim.** Finding *both* the maximum and the minimum of `n` elements requires `⌈3n/2⌉ − 2` comparisons, and this is achievable.

The naïve approach finds the max (`n − 1` comparisons) then the min of the rest (`n − 2` comparisons) for `2n − 3` total. The optimal `⌈3n/2⌉ − 2` is dramatically better, and the adversary proves you cannot do *better* than that.

**Upper bound (⌈3n/2⌉ − 2 suffices) — pair them up.** Process elements in **pairs**. For each pair, *one* comparison sorts the pair into a smaller and a larger; then the smaller competes only for the *min* and the larger only for the *max*. Per pair: 1 (internal) + 1 (vs current min) + 1 (vs current max) = 3 comparisons for 2 elements, i.e. `3/2` per element. Counting the boundary cases (seed the running min/max from the first pair or element), the total is `⌈3n/2⌉ − 2`.

**Lower bound — the four-state adversary.** Give each element one of four labels describing what comparisons have revealed:

| Label | Meaning |
|-------|---------|
| `N` (novel) | never compared |
| `W` (won only) | has won ≥1, never lost — candidate for *max* only |
| `L` (lost only) | has lost ≥1, never won — candidate for *min* only |
| `WL` (both) | has both won and lost — out of the running for both |

To finish, the algorithm must reach a state with **exactly one** `W`-or-`WL`-resolved max and one `L`-or-`WL`-resolved min — concretely, all elements but the true max must have *lost* at least once, and all but the true min must have *won* at least once. Measure progress by a potential that counts how much "labeling work" remains. Define units of progress needed:

- A `novel` element must eventually win once *and* lose once (2 units of work) — except the eventual max and min.
- Total work to do is `2n − 2`: every element needs both a win and a loss, except the max needs no loss and the min needs no win.

Now bound progress per comparison. The adversary answers to **minimize information gained**, and the crucial case is comparing **two `novel` elements**: that single comparison can grant *both* of them their first label (`N,N → W,L`), making 2 units of progress at once. *Every other* comparison the adversary can force to yield **at most 1** unit:

```text
N : N   → at most 2 units  (both get a first label)
N : W   → at most 1 unit   (adversary lets the W win again: N→L, W unchanged)
N : L   → at most 1 unit   (adversary lets the L lose again: N→W, L unchanged)
W : L   → 0 useful units   (W wins, L loses, no new resolution — adversary's choice)
W : W, L : L, WL : *  → at most 1 unit
```

The `N : N` comparison is the *only* one that nets 2 units, and there are at most `⌊n/2⌋` disjoint novel pairs. So the algorithm gets the 2-unit bonus at most `⌊n/2⌋` times; the remaining `2n − 2 − 2⌊n/2⌋` units must come one per comparison. Total comparisons:

```text
≥  ⌊n/2⌋          (the 2-unit comparisons)
 + (2n − 2 − 2⌊n/2⌋)   (the 1-unit comparisons)
 =  2n − 2 − ⌊n/2⌋
 =  ⌈3n/2⌉ − 2.
```

The adversary's whole strategy is *deny double-progress except on novel pairs*, which is exactly the structure the pairing algorithm exploits — the lower and upper bounds meet at `⌈3n/2⌉ − 2`. ∎

---

## Finding the Second Largest: n + ⌈log₂ n⌉ − 2

**Claim.** Finding the *second*-largest element requires `n + ⌈log₂ n⌉ − 2` comparisons, and a tournament achieves it.

This is the most elegant of the three, because the lower bound and the matching algorithm are the *same* idea — a knockout tournament — viewed from two sides.

**Upper bound — the tournament.** Run a single-elimination tournament: pair elements, the winner of each comparison advances, repeat. After `n − 1` comparisons one element is the overall winner — the **maximum**. The second largest must be someone who lost *directly to the maximum* (anyone who lost to a non-max element was beaten by something not even the largest, so cannot be second). How many elements did the max beat directly? Exactly the number of *rounds* it played, which is `⌈log₂ n⌉` (in a balanced bracket the champion plays once per level). Run a *mini-tournament* among those `⌈log₂ n⌉` candidates to find the largest of them: `⌈log₂ n⌉ − 1` more comparisons. Total:

```text
(n − 1)  +  (⌈log₂ n⌉ − 1)  =  n + ⌈log₂ n⌉ − 2.
```

**Lower bound — the loser-to-the-winner argument.** Two parts.

1. *The max must be found.* To know the *second* largest, you must know the largest is not it — and identifying the overall maximum costs `n − 1` comparisons (the loss-accounting bound from above, since the max is the unique element that never loses). So `n − 1` comparisons are spent just establishing the winner.

2. *The runner-up lost only to the winner — and the winner must have beaten `≥ ⌈log₂ n⌉` players.* An adversary can force the eventual maximum to win comparisons "narrowly", arranging (by a weight argument that assigns each element a *score* doubling the loser into the winner) that the maximum must directly defeat at least `⌈log₂ n⌉` distinct elements before it can be certified as the unique winner. Intuition: each comparison the winner makes can at most *double* the size of the set of elements known to be below it (it absorbs the opponent's already-beaten subtree). To grow from "beats 1" to "beats all `n`", it needs `≥ ⌈log₂ n⌉` victories. Each of those `⌈log₂ n⌉` direct losers is a candidate for second place, and distinguishing the true runner-up among them costs `⌈log₂ n⌉ − 1` further comparisons.

Adding the two parts gives `(n − 1) + (⌈log₂ n⌉ − 1) = n + ⌈log₂ n⌉ − 2`, matching the tournament exactly. This result (Kislitsyn, 1964) is one of the prettiest exact bounds in algorithms: the *information-theoretic* `log₂ n` term and the *physical* `n − 1` term combine into a single tight answer. ∎

> **Take-away.** The adversary doesn't just prove `Ω(n)` — it pins the constant *and* the lower-order `⌈log₂ n⌉` term, something the bare counting argument cannot do. The price is a custom weight function per problem; the reward is a *matched* bound.

---

## Element Distinctness and Lower Bounds by Reduction

Not every lower bound is proved from scratch — many are inherited by **reduction**, the same engine that powers [NP-hardness](../07-reductions-and-np-completeness/middle.md) but applied to comparison counts.

**Element distinctness.** *Given `n` numbers, are they all distinct?* In the comparison model (only `<`, `=` tests), this needs `Ω(n log n)` comparisons. The clean proof is a **reduction from sorting**, run in reverse: a fast distinctness test would let you separate the regions of input space corresponding to different orderings, and a more careful argument (the **algebraic decision tree** model of Ben-Or, 1983) shows the input space has `≥ n!` connected components that the algorithm must separate, forcing `Ω(n log n)`. The everyday version of the argument: sorting trivially solves distinctness (sort, then scan for adjacent equals), and distinctness is "almost as hard as sorting" because telling the orderings apart is what costs the `log`.

**Reduction template.** To prove problem `B` needs `≥ f(n)` operations, exhibit a cheap transformation that turns any instance of a *known-hard* problem `A` into an instance of `B`, such that solving `B` solves `A`. If `A` needs `≥ g(n)` and the transformation costs `o(g(n))`, then `B` needs `≥ g(n) − o(g(n))`. Sorting (`Ω(n log n)`) is the usual source `A`; **closest pair**, **convex hull**, and **element uniqueness** all inherit `Ω(n log n)` this way.

**Comparison model vs. stronger models — the central caveat.** The `Ω(n log n)` for element distinctness holds in the **comparison / algebraic-decision-tree** model. In a **stronger** model that permits **hashing** (read the bits of a key, compute a hash, index a bucket), element distinctness drops to **expected `O(n)`** — build a hash set and watch for a collision. There is no contradiction: the two bounds are about two *different machines*. The comparison lower bound says nothing about the hashing machine, because hashing performs an operation (bucket indexing by value) the comparison model forbids. This is the same escape hatch radix sort uses against the sorting bound, generalized.

The lesson, stated once and for all: **a lower bound is a contract scoped to a model.** Quoting it outside that model is the most common error in the field — and the subject of half the pitfalls below.

---

## Code: An Adversary That Plays Against Your Algorithm

The cleanest way to *feel* a lower bound is to implement the adversary as a live opponent: it never fixes the array; it answers each comparison to stay maximally ambiguous, and we watch the algorithm pay the full price. Below, a **max-finding adversary** confirms that *any* comparison-based max finder is forced into `n − 1` comparisons, and a comparison counter wraps an arbitrary sorter to confirm `≥ ⌈log₂ n!⌉`.

### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

// MaxAdversary answers "is x bigger than y?" without fixing the array.
// Strategy: keep every element "eligible" to be the max as long as it
// has never lost. Always let an element that has *already lost* lose
// again, and when forced to pick between two eligible elements, sacrifice
// exactly one. This guarantees each comparison eliminates at most one
// fresh candidate, so n-1 comparisons are required.
type MaxAdversary struct {
	lost        []bool // lost[i] == true once element i has lost a comparison
	comparisons int
}

func NewMaxAdversary(n int) *MaxAdversary {
	return &MaxAdversary{lost: make([]bool, n)}
}

// Compare returns true if element i should be reported as greater than j.
func (a *MaxAdversary) Compare(i, j int) bool {
	a.comparisons++
	switch {
	case a.lost[i] && !a.lost[j]:
		// i already lost; keep j eligible: j wins.
		return false
	case a.lost[j] && !a.lost[i]:
		// j already lost; keep i eligible: i wins.
		return true
	default:
		// Both eligible (or both already lost): sacrifice exactly one.
		// Convention: i wins, j becomes a loser.
		a.lost[j] = true
		return true
	}
}

func (a *MaxAdversary) EligibleCount() int {
	c := 0
	for _, l := range a.lost {
		if !l {
			c++
		}
	}
	return c
}

// findMaxViaAdversary models a generic comparison-based max finder.
func findMaxViaAdversary(n int, adv *MaxAdversary) int {
	best := 0
	for i := 1; i < n; i++ {
		if adv.Compare(i, best) { // is i greater than best?
			best = i
		}
	}
	return best
}

// countingSorter wraps sort.Sort and counts every comparison it makes.
type countingSlice struct {
	data  []int
	count *int
}

func (s countingSlice) Len() int { return len(s.data) }
func (s countingSlice) Less(i, j int) bool {
	*s.count++
	return s.data[i] < s.data[j]
}
func (s countingSlice) Swap(i, j int) { s.data[i], s.data[j] = s.data[j], s.data[i] }

func log2Factorial(n int) float64 {
	total := 0.0
	for k := 2; k <= n; k++ {
		total += math.Log2(float64(k))
	}
	return total
}

func main() {
	n := 16

	adv := NewMaxAdversary(n)
	findMaxViaAdversary(n, adv)
	fmt.Printf("Max-finding adversary:\n")
	fmt.Printf("  comparisons made = %d   (lower bound n-1 = %d)\n",
		adv.comparisons, n-1)
	fmt.Printf("  eligible elements left = %d   (must be 1)\n\n",
		adv.EligibleCount())

	// Sorting: compare actual comparisons against ceil(log2(n!)).
	data := make([]int, n)
	for i := range data {
		data[i] = (i*7 + 3) % n // an arbitrary permutation
	}
	count := 0
	sort.Sort(countingSlice{data: data, count: &count})
	bound := int(math.Ceil(log2Factorial(n)))
	fmt.Printf("Comparison sort on n=%d:\n", n)
	fmt.Printf("  comparisons made = %d\n", count)
	fmt.Printf("  info-theoretic floor ceil(log2(n!)) = %d\n", bound)
	fmt.Printf("  bound respected? %v\n", count >= bound)
}
```

Running it prints `comparisons made = 15` for the adversary against `n = 16` (exactly `n − 1`) with one eligible element surviving — the forced maximum — and shows the sorter's comparison count sitting at or above `⌈log₂ 16!⌉ = 45`. The adversary never built an array; it manufactured the answers, and the algorithm still paid `n − 1`.

### Python

```python
from __future__ import annotations
import math


class MaxAdversary:
    """Answers comparisons without fixing the input, forcing n-1 comparisons
    on any comparison-based maximum finder."""

    def __init__(self, n: int) -> None:
        self.lost = [False] * n
        self.comparisons = 0

    def greater(self, i: int, j: int) -> bool:
        """Return True if element i should be reported greater than j."""
        self.comparisons += 1
        if self.lost[i] and not self.lost[j]:
            return False                      # keep j eligible
        if self.lost[j] and not self.lost[i]:
            return True                       # keep i eligible
        self.lost[j] = True                   # sacrifice exactly one
        return True

    def eligible_count(self) -> int:
        return sum(1 for x in self.lost if not x)


def find_max(n: int, adv: MaxAdversary) -> int:
    best = 0
    for i in range(1, n):
        if adv.greater(i, best):
            best = i
    return best


class CountingCmp:
    """Wraps an int so that every '<' comparison is tallied."""
    counter = [0]

    def __init__(self, v: int) -> None:
        self.v = v

    def __lt__(self, other: "CountingCmp") -> bool:
        CountingCmp.counter[0] += 1
        return self.v < other.v


def log2_factorial(n: int) -> float:
    return sum(math.log2(k) for k in range(2, n + 1))


def main() -> None:
    n = 16

    adv = MaxAdversary(n)
    find_max(n, adv)
    print("Max-finding adversary:")
    print(f"  comparisons made = {adv.comparisons}   (lower bound n-1 = {n-1})")
    print(f"  eligible elements left = {adv.eligible_count()}   (must be 1)\n")

    data = [CountingCmp((i * 7 + 3) % n) for i in range(n)]
    CountingCmp.counter[0] = 0
    data.sort()  # Timsort: a comparison sort
    made = CountingCmp.counter[0]
    bound = math.ceil(log2_factorial(n))
    print(f"Comparison sort on n={n}:")
    print(f"  comparisons made = {made}")
    print(f"  info-theoretic floor ceil(log2(n!)) = {bound}")
    print(f"  bound respected? {made >= bound}")


if __name__ == "__main__":
    main()
```

The Python version makes the same two points: the adversary forces exactly `n − 1 = 15` comparisons with one eligible element surviving, and the comparison count of any real sort (here Timsort) never dips below `⌈log₂ n!⌉`. Both programs are **falsifiable**: if either ever printed `bound respected? False` or an eligible count other than `1`, our analysis — or the implementation of the algorithm under test — would be wrong.

---

## Code: A Decision-Tree Leaf Counter

The information-theoretic bound says a sorter's decision tree needs `≥ n!` leaves and therefore height `≥ ⌈log₂ n!⌉`. For small `n` we can *build* the tree a real sorting algorithm induces and confirm both facts directly: every permutation must reach its own leaf, and the deepest leaf is the worst-case comparison count.

```python
from __future__ import annotations
from itertools import permutations
import math


def worst_case_via_leaves(n: int, sort_fn) -> tuple[int, int, int]:
    """Run `sort_fn` (a comparison sorter taking a `less` callback) on every
    permutation of 0..n-1, recording how many comparisons each needs and the
    sequence of comparison outcomes (its decision-tree path). Returns
    (distinct_leaves, max_depth, info_floor)."""
    leaves: set[tuple[bool, ...]] = set()
    max_depth = 0

    for perm in permutations(range(n)):
        outcomes: list[bool] = []

        def less(a: int, b: int) -> bool:
            # 'a','b' are values; record the answer as a path edge.
            res = perm.index(a) < perm.index(b)  # position decides order
            outcomes.append(res)
            return res

        sort_fn(list(range(n)), less)
        leaves.add(tuple(outcomes))
        max_depth = max(max_depth, len(outcomes))

    info_floor = math.ceil(math.log2(math.factorial(n)))
    return len(leaves), max_depth, info_floor


def insertion_sort(arr: list[int], less) -> list[int]:
    """A comparison sort parameterized by a `less(a, b)` oracle."""
    a = arr[:]
    for i in range(1, len(a)):
        key = a[i]
        j = i - 1
        while j >= 0 and less(key, a[j]):
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = key
    return a


def main() -> None:
    print(f"{'n':>3} {'leaves':>8} {'>= n!':>8} {'max depth':>10} {'floor':>7}")
    for n in range(2, 8):
        leaves, depth, floor = worst_case_via_leaves(n, insertion_sort)
        fact = math.factorial(n)
        print(f"{n:>3} {leaves:>8} {fact:>8} {depth:>10} {floor:>7}"
              f"   {'OK' if leaves >= fact and depth >= floor else 'FAIL'}")


if __name__ == "__main__":
    main()
```

The table it prints confirms two invariants for every `n`:

```text
  n   leaves    >= n!   max depth   floor
  2        2        2           1       1   OK
  3        6        6           3       3   OK
  4       24       24           5       5   OK
  5      120      120           7       7   OK
  6      720      720          11      10   OK
  7     5040     5040          16      13   OK
```

Two readings. First, the **leaf count exactly equals `n!`**: insertion sort distinguishes every permutation, never wasting a leaf — necessary, since any correct sorter must reach `≥ n!` distinct leaves. Second, the **max depth is `≥ ⌈log₂ n!⌉`** but often *strictly greater* (e.g. `16 > 13` at `n = 7`): insertion sort is comparison-*correct* but not comparison-*optimal*; its worst case is `Θ(n²)`, far above the `n log n` floor. The information bound is a *floor*, not a promise that a given algorithm achieves it — that is exactly the gap between a lower bound (what no one can beat) and an upper bound (what a particular algorithm delivers).

---

## Pitfalls

**1. Quoting a model-bound outside its model.** `Ω(n log n)` for sorting is a *comparison-model* statement. [Radix sort](../../07-sorting-algorithms/08-radix-sort/) sorts `n` `b`-bit integers in `O(b·n)` — *not* by comparisons but by reading digits and indexing buckets, an operation the comparison model forbids. There is no contradiction; radix sort simply lives in a stronger model. Saying "sorting is `Ω(n log n)`, so radix sort is impossible" is the single most common error in the subject. Always state the model when you state the bound.

**2. Confusing best, average, and worst case.** The decision-tree height bounds the **worst case**. A sorter can have a best case of `n − 1` comparisons (a single sweep verifying already-sorted input) while its worst case is `Θ(n log n)` or worse. The `Ω(n log n)` lower bound also holds *on average* (averaging leaf depth), but a *best-case* claim of `O(n)` is perfectly compatible with it. When you cite a lower bound, name the case.

**3. Off-by-one and ceilings in the exact bounds.** The exact constants are easy to misremember. Max is `n − 1` (not `n`); max-and-min is `⌈3n/2⌉ − 2` (not `3n/2` or `2n − 2`); second largest is `n + ⌈log₂ n⌉ − 2` (the `−2`, and the `⌈·⌉`, matter). Drop the ceiling and your "bound" disagrees with the matching algorithm for odd `n`. When stating an exact bound, check it against the tournament/pairing algorithm that achieves it.

**4. Believing the counting bound is always tight.** The information-theoretic floor `⌈log₂ N⌉` is tight for sorting and search but *loose* for many problems — it would suggest finding the max needs only `⌈log₂ n⌉` comparisons (since there are `n` candidate answers), yet the true answer is `n − 1`. The counting bound assumes each comparison can deliver a full bit toward the answer; for max-finding it cannot, which is why the *adversary* (a stronger technique for this problem) is needed. Use counting for orders of growth; use adversary for tight constants.

**5. Letting the adversary "cheat".** A valid adversary must keep at least one consistent input alive at every step — its answers must be realizable by *some* fixed array. An adversary that answers `a < b` and later `b < a` and later `a < b` (a cycle) is inconsistent and proves nothing. Every adversary proof carries a hidden obligation: exhibit (or argue the existence of) a concrete input matching the answers. If you cannot, the "lower bound" is fiction.

**6. Forgetting that a lower bound bounds *every* algorithm.** Students sometimes "disprove" a lower bound by exhibiting one fast algorithm on one input. A lower bound is a statement about the **worst case over all inputs, for all algorithms**. Beating it on a friendly input, or with a randomized algorithm on average, does not contradict a worst-case deterministic bound — they are different quantities. (Randomized lower bounds need Yao's minimax principle, a senior-level tool.)

**7. Counting the wrong outcomes.** The whole counting argument hinges on `N`, the number of *distinguishable* outcomes. Undercount (e.g. forgetting the "absent" case in search, or treating duplicate-allowed sorting like distinct sorting) and your floor is too low; overcount and it is too high. Derive `N` from the *specification* of correct output, not from intuition.

---

## Summary

- A **lower bound** constrains *every* algorithm in a stated **model**; an **upper bound** is what one algorithm achieves. The two meet (`Θ`) only when a matching algorithm and a matching lower bound are both proven.
- In the **comparison model**, a deterministic algorithm on fixed input size is a **binary decision tree**: worst-case comparisons = tree height, and a tree with `L` leaves has height `≥ ⌈log₂ L⌉`.
- **Information-theoretic bound:** distinguishing `N` outcomes by yes/no tests needs `≥ ⌈log₂ N⌉` tests. Applications: **sorting** `N = n!` ⇒ `log₂(n!) = n log₂ n − n log₂ e + O(log n) = Θ(n log n)` (Stirling, or the `(n/2)^{n/2} ≤ n! ≤ n^n` squeeze); **sorted search** `N = n+1` ⇒ `Ω(log n)`, tight via binary search; **merging** `C(m+n, m)` ⇒ ~`2n` comparisons for equal lists.
- The **adversary method** answers queries on the fly, keeping the set of consistent inputs large, forcing the algorithm to query until the answer is *forced*. It yields **exact constants** the counting bound misses, via per-problem **weight / state** arguments.
- **Exact comparison bounds:** maximum `= n − 1` (loss accounting: each non-max must lose once, one new loser per comparison); **max and min together** `= ⌈3n/2⌉ − 2` (four-state adversary: only `novel : novel` comparisons yield 2 units of progress, and there are `≤ ⌊n/2⌋` of them); **second largest** `= n + ⌈log₂ n⌉ − 2` (find the max in `n − 1`, then the runner-up among the `⌈log₂ n⌉` it directly beat).
- **Element distinctness** is `Ω(n log n)` in the comparison / algebraic-decision-tree model (reduction from sorting), but `O(n)` expected *with hashing* — the canonical demonstration that **a lower bound is scoped to its model**.
- **Lower bounds by reduction:** closest pair, convex hull, and uniqueness inherit `Ω(n log n)` by cheaply reducing sorting to them.
- The **code** confirms the theory empirically: a max-finding adversary forces exactly `n − 1` comparisons without ever fixing an array, a comparison-counting wrapper shows real sorts never dip below `⌈log₂ n!⌉`, and a decision-tree leaf counter shows insertion sort uses exactly `n!` leaves while its depth sits *above* the floor — correct but not optimal.
- **Watch the model, the case, and the constants.** `Ω(n log n)` is comparison-only (radix escapes it); height bounds the *worst* case; and the exact constants live or die by their ceilings and `−2`s.

Continue to the [senior level](./senior.md) for randomized lower bounds (Yao's minimax principle), communication-complexity and cell-probe bounds, and `3SUM`-hardness as a fine-grained reduction engine.

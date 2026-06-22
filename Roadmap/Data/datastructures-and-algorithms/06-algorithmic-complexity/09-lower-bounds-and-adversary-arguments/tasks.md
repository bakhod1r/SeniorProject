# Lower Bounds and Adversary Arguments — Practice Tasks

> Coding tasks must be solved in **Go** or **Python** where marked **[coding]**.
> Heavier coding tasks ship a reference solution in **one** language — port it to the other as practice; short second-language snippets are inlined where they sharpen the point.
> **[analysis]** tasks need no code: prove a lower bound, construct a worst-case input, or argue model-specificity, with a tight justification per claim.

These tasks build the central skill of **lower bounds**: proving that *no* algorithm — not just the one in front of you — can do better than some threshold in a given computational model. An *upper bound* is an algorithm you can exhibit; a *lower bound* is a statement about an entire model, and the only honest way to earn one is a proof. Two engines recur throughout:

- **The decision-tree / comparison model.** A comparison-based algorithm on `n` inputs is a binary tree: each internal node asks one comparison (`a < b?`), each leaf is an output. Two facts follow. (1) A correct algorithm needs **at least one leaf per distinguishable answer**, so a tree with `L` leaves has worst-case height `≥ ⌈log₂ L⌉`. (2) For sorting, the answers are the `n!` permutations, so `L ≥ n!` and height `≥ ⌈log₂(n!)⌉ = Θ(n log n)`. This is an **information-theoretic** bound: you must extract `log₂(n!)` bits, and each comparison yields at most one.
- **The adversary method.** Instead of counting answers, imagine a malicious oracle that answers the algorithm's comparisons *on the fly*, never committing to a fixed input, always keeping at least two consistent inputs with different answers alive. As long as such an input set survives, the algorithm cannot stop. Counting the comparisons the adversary can force is a lower bound on the worst case.

The recurring discipline for **every** coding task below is the same: **instrument the algorithm to count comparisons, run it across many inputs, and check the measured count against the proven bound** — the acceptance test is always *"the measured comparison count matches the proven bound on every instance tested."* A bound you never measure against a real counter is a hope; a counter you never tie to a proof is just a number.

The four bounds you will prove and witness, for reference:

| Problem (comparison model) | Tight bound | Engine |
| --- | --- | --- |
| Sort `n` elements | `⌈log₂(n!)⌉ = Θ(n log n)` | decision tree |
| Find the **max** | `n − 1` | adversary (every non-max loses once) |
| Find **max and min** | `⌈3n/2⌉ − 2` | adversary (pair-and-conquer) |
| Find the **second-largest** | `n + ⌈log₂ n⌉ − 2` | adversary (tournament) |

**Related practice:**
- [Approximation and Hardness tasks](../08-approximation-and-hardness/tasks.md) — lower bounds of a different flavor: *hardness of approximation* instead of *information-theoretic* limits.
- [Sorting algorithms](../../07-sorting-algorithms/) — the `Ω(n log n)` bound is exactly what merge/heap/quicksort meet, and what counting/radix sort sidestep by leaving the comparison model.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## Beginner Tasks

### Task 1 — Count comparisons in a sort; never beat ⌈log₂(n!)⌉ **[coding]**

`[easy]` Every comparison-based sort is a decision tree over the `n!` permutations, so on the **worst** input it must make at least `⌈log₂(n!)⌉` comparisons. Equivalently, for *any* sort, the worst-case comparison count over all permutations of `n` distinct elements is `≥ ⌈log₂(n!)⌉`.

Instrument a real comparison sort (insertion sort here) so that *every* `<`/`>` between elements increments a counter. Run it over **all** `n!` permutations of `{0, 1, …, n−1}` for small `n`, record the **maximum** comparison count, and assert it is `≥ ⌈log₂(n!)⌉`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

// insertionSortCounting sorts a copy of a and returns the comparison count.
// Every element-vs-element comparison is counted exactly once.
func insertionSortCounting(a []int) int {
	b := append([]int(nil), a...)
	cmps := 0
	for i := 1; i < len(b); i++ {
		key := b[i]
		j := i - 1
		// Each loop test that touches two ELEMENTS is one comparison.
		for j >= 0 {
			cmps++ // comparing b[j] with key
			if b[j] <= key {
				break
			}
			b[j+1] = b[j]
			j--
		}
		b[j+1] = key
	}
	return cmps
}

// permute calls visit on every permutation of a.
func permute(a []int, k int, visit func([]int)) {
	if k == len(a) {
		visit(a)
		return
	}
	for i := k; i < len(a); i++ {
		a[k], a[i] = a[i], a[k]
		permute(a, k+1, visit)
		a[k], a[i] = a[i], a[k]
	}
}

// logFactorialCeil returns ceil(log2(n!)).
func logFactorialCeil(n int) int {
	logf := 0.0
	for i := 2; i <= n; i++ {
		logf += math.Log2(float64(i))
	}
	return int(math.Ceil(logf - 1e-9))
}

func main() {
	for n := 1; n <= 8; n++ {
		base := make([]int, n)
		for i := range base {
			base[i] = i
		}
		worst := 0
		permute(append([]int(nil), base...), 0, func(p []int) {
			if c := insertionSortCounting(p); c > worst {
				worst = c
			}
		})
		bound := logFactorialCeil(n)
		fmt.Printf("n=%d  worst comparisons=%2d  ceil(log2(n!))=%2d  ok=%v\n",
			n, worst, bound, worst >= bound)
		if worst < bound {
			panic("information-theoretic lower bound violated")
		}
	}
}
```

- **Constraints:** Count *element-vs-element* comparisons only (loop-index tests like `j >= 0` do **not** count). Enumerating `n!` permutations limits you to `n ≤ 9` or so.
- **Hints:** Insertion sort's worst case (a reversed array) makes `1 + 2 + … + (n−1) = n(n−1)/2` comparisons, which dwarfs `⌈log₂(n!)⌉` — that is *expected*; the bound is a floor, not the count. The point is that the worst is **never below** the floor.
- **Acceptance test:** For every `n` tested, `worst ≥ ⌈log₂(n!)⌉`. (Insertion sort is far from optimal, so the gap is large; merge sort would hug the bound.)

---

### Task 2 — `findMax` makes exactly `n − 1` comparisons **[coding]**

`[easy]` Finding the maximum of `n` distinct elements requires **exactly `n − 1`** comparisons, and the obvious linear scan achieves it. The lower bound has a clean combinatorial proof (Task 5): every element except the maximum must "lose" at least one comparison, and each comparison produces at most one new loser, so you need `≥ n − 1` comparisons.

Instrument `findMax` to count comparisons and assert the count is **exactly `n − 1`** for every input of size `n` (the linear scan's count is input-independent).

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

// findMaxCounting returns (max, comparisons). The scan does one comparison
// per element after the first, so the count is always n-1.
func findMaxCounting(a []int) (int, int) {
	best := a[0]
	cmps := 0
	for i := 1; i < len(a); i++ {
		cmps++
		if a[i] > best {
			best = a[i]
		}
	}
	return best, cmps
}

func main() {
	rng := rand.New(rand.NewSource(1))
	for trial := 0; trial < 5000; trial++ {
		n := 1 + rng.Intn(50)
		a := rng.Perm(n) // a permutation of 0..n-1 (all distinct)
		got, cmps := findMaxCounting(a)
		if got != n-1 { // max of 0..n-1 is n-1
			panic("wrong max")
		}
		if cmps != n-1 {
			panic(fmt.Sprintf("expected n-1=%d comparisons, got %d", n-1, cmps))
		}
	}
	fmt.Println("findMax uses exactly n-1 comparisons on every tested input")
}
```

- **Constraints:** Distinct elements (so "the maximum" is unique). Count each `a[i] > best` test as one comparison.
- **Hints:** Unlike sorting, max-finding's comparison count does not depend on the input order — the scan always does `n − 1`. The interesting content is the *matching lower bound* (Task 5), which says you cannot do it in `n − 2`.
- **Acceptance test:** For every input, the counter equals `n − 1` exactly, and the returned value is the true maximum.

---

### Task 3 — Decision-tree leaf counter: a sorter needs `≥ n!` leaves **[coding + analysis]**

`[easy]` A correct comparison sort, viewed as a decision tree, must have a **distinct leaf for every distinct permutation** of the input — otherwise two inputs requiring different output orderings would reach the same leaf and one would be sorted wrong. So the tree has `≥ n!` reachable leaves, hence height `≥ ⌈log₂(n!)⌉`.

Build a **leaf counter** by exhaustively simulating a fixed comparison sort over all `n!` input permutations, recording which leaf (i.e., which full comparison-outcome path) each permutation reaches. Confirm that the number of *distinct* leaves reached is **exactly `n!`** (each permutation gets its own leaf) and that the tree's height (longest path = worst-case comparisons) is `≥ ⌈log₂(n!)⌉`.

#### Python

```python
from math import log2, ceil
from itertools import permutations

def insertion_sort_path(a):
    """Sort a copy of `a`, returning the sequence of comparison OUTCOMES.
    This bit-string is the identity of the decision-tree leaf reached."""
    b = list(a)
    outcomes = []
    for i in range(1, len(b)):
        key = b[i]
        j = i - 1
        while j >= 0:
            # Outcome of comparing b[j] with key: 1 if b[j] > key else 0.
            outcomes.append(1 if b[j] > key else 0)
            if b[j] <= key:
                break
            b[j + 1] = b[j]
            j -= 1
        b[j + 1] = key
    return tuple(outcomes), b

def leaf_count(n):
    leaves = {}            # outcome-path -> the input permutation reaching it
    max_height = 0
    for p in permutations(range(n)):
        path, out = insertion_sort_path(p)
        assert out == sorted(out), "sort incorrect"
        leaves[path] = p
        max_height = max(max_height, len(path))
    return len(leaves), max_height

if __name__ == "__main__":
    for n in range(1, 9):
        from math import factorial
        leaves, height = leaf_count(n)
        bound = ceil(log2(factorial(n)) - 1e-9)
        print(f"n={n}  distinct leaves={leaves:5d}  n!={factorial(n):5d}  "
              f"height={height:2d}  ceil(log2(n!))={bound:2d}")
        assert leaves == factorial(n), "fewer than n! leaves => some inputs collide"
        assert height >= bound, "height below information-theoretic floor"
    print("every permutation reaches its own leaf; height >= ceil(log2(n!))")
```

- **Analysis to write:** Explain *why* distinct permutations must reach distinct leaves. If two permutations `π ≠ σ` reached the same leaf, the algorithm would emit the **same** output reordering for both; but the reordering that sorts `π` does not sort `σ` (they need different rearrangements), so one output is wrong. Hence a correct sorter has `≥ n!` leaves, and a binary tree with `≥ n!` leaves has height `≥ ⌈log₂(n!)⌉`.
- **Constraints:** The "leaf" is identified by the full comparison-outcome path. `n!` enumeration limits `n ≤ 8`.
- **Acceptance test:** Distinct leaves `== n!` for every `n`, and tree height `≥ ⌈log₂(n!)⌉`. The leaf counter operationalizes the information-theoretic argument.

---

### Task 4 — Spot the broken lower-bound claim **[analysis]**

`[easy]` A lower bound is a `∀`-statement about a **model**. Each claim below is either sound or subtly wrong; say which, and name the flaw.

1. "Quicksort makes `O(n²)` comparisons in the worst case, so sorting needs `Ω(n²)` comparisons."
2. "Counting sort runs in `O(n)`, which beats `Ω(n log n)`, so the `Ω(n log n)` sorting bound is false."
3. "I measured my sort on 10,000 random arrays and it never exceeded `1.1 · n log₂ n` comparisons, so I've *proven* the `Ω(n log n)` lower bound."
4. "Finding the maximum needs `Ω(log n)` comparisons because a binary tournament has depth `log n`."
5. "Any algorithm that finds the max of `n` numbers must read all `n` inputs, so the lower bound is `n` comparisons."

**Reference answers.**

1. **False — confuses an algorithm's upper bound with a problem's lower bound.** Quicksort's worst case bounds *quicksort*, not *sorting*. The sorting lower bound is `Ω(n log n)` (decision tree), and merge/heap sort meet it. One bad algorithm's behavior says nothing about the problem's intrinsic difficulty.
2. **False — model confusion.** The `Ω(n log n)` bound holds in the **comparison model**. Counting sort is *not* comparison-based: it indexes into an array by key value, extracting `Θ(log k)` bits per operation, not one bit per comparison. It escapes the bound by leaving the model, not by violating it (see Task 9).
3. **False — measurement is not proof.** Empirical maxima over sampled inputs establish nothing about *all* inputs or *all* algorithms. A lower bound is proved by the decision-tree/adversary argument, never by running one algorithm on some inputs. (You also only sampled *random* inputs, which may miss the worst case entirely.)
4. **False — the bound is `n − 1`, larger than `log n`.** A tournament *has* depth `log n` along any root-to-leaf path, but it makes `n − 1` total comparisons (one per internal node). The lower bound counts *comparisons*, not *tree depth*; max-finding needs `n − 1` (Task 5), not `log n`.
5. **Almost right conclusion, sloppy reasoning.** "Reads all `n` inputs" bounds *input accesses*, not *comparisons*; an algorithm could read all inputs with fewer comparisons in some models. The correct comparison lower bound `n − 1` comes from the adversary "every non-max must lose once" argument (Task 5), which is `n − 1`, not `n`.

- **Constraints:** Distinguish (a) algorithm upper bound vs. problem lower bound, (b) the *model* a bound lives in, (c) measurement vs. proof, (d) comparisons vs. tree depth vs. input reads.
- **Acceptance test:** Flags 1, 2, 3, 4 as unsound with the precise flaw, and corrects 5's reasoning (right ballpark, wrong mechanism; the real bound is `n − 1`).

---

## Intermediate Tasks

### Task 5 — Prove sorting is `Ω(n log n)` (decision tree + Stirling) **[analysis]**

`[medium]` Write a complete, rigorous proof that **any** comparison-based sorting algorithm makes `Ω(n log n)` comparisons in the worst case.

**Reference model proof.**

**Setup — the decision tree.** Fix a comparison sort `A` and an input size `n`. Run `A` on inputs whose elements are distinct. At each step `A` performs one comparison `a_i < a_j?`, branching two ways; the execution is a path in a **binary decision tree** `T_A`, and each leaf outputs a permutation that reorders the input into sorted order.

**Step 1 — at least `n!` leaves.** There are `n!` distinct orderings of `n` distinct elements, and each requires a *different* output permutation to sort. Two distinct input orderings cannot reach the same leaf: the leaf emits one fixed reordering, which sorts at most one of them. Hence `T_A` has `≥ n!` reachable leaves.

**Step 2 — height bounds the worst case.** The worst-case number of comparisons of `A` is the **height** `h` of `T_A` (the longest root-to-leaf path). A binary tree of height `h` has at most `2^h` leaves. Combining with Step 1:
```
2^h ≥ (number of leaves) ≥ n!   ⟹   h ≥ log₂(n!).
```

**Step 3 — Stirling.** `log₂(n!) = Σ_{k=1}^{n} log₂ k ≥ ∫_1^n log₂ x dx = Θ(n log n)`. More precisely, half the terms (`k` from `n/2` to `n`) each satisfy `log₂ k ≥ log₂(n/2) = log₂ n − 1`, so
```
log₂(n!) ≥ (n/2)(log₂ n − 1) = (n/2) log₂ n − n/2 = Ω(n log n).
```
Equivalently, Stirling's approximation gives `n! ≈ (n/e)^n √(2πn)`, so `log₂(n!) = n log₂ n − n log₂ e + Θ(log n) = Θ(n log n)`.

**Conclude.** `h ≥ log₂(n!) = Ω(n log n)`. Since `A` was arbitrary, **every** comparison sort needs `Ω(n log n)` comparisons in the worst case. ∎

- **Constraints:** Must contain all four moves: (1) `≥ n!` leaves with the collision argument, (2) `2^h ≥ leaves`, (3) the Stirling/integral estimate of `log₂(n!)`, (4) the universal-quantifier conclusion ("for *every* comparison sort").
- **Acceptance test:** The proof derives `h ≥ log₂(n!)` from leaf-counting, lower-bounds `log₂(n!)` by `Ω(n log n)` with a concrete estimate (not just "by Stirling"), and concludes for all comparison algorithms.

---

### Task 6 — `findMaxAndMin` in `⌈3n/2⌉ − 2` comparisons **[coding]**

`[medium]` The naive way to find both the max and the min runs `findMax` then `findMin`, costing `(n − 1) + (n − 1) = 2n − 2` comparisons. The optimal **pair-processing** method does it in `⌈3n/2⌉ − 2` — a 25% saving — and that count is tight (Task 11 builds the matching adversary).

**Method.** Process elements **two at a time**. For each pair, first compare the two against each other (1 comparison), then compare the smaller against the current min and the larger against the current max (2 comparisons): **3 comparisons advance 2 elements**, instead of 4. Handle initialization and the odd element carefully.

> **Count.** For even `n`: seed min/max from the first pair (1 comparison), then `(n − 2)/2` more pairs at 3 each: `1 + 3(n−2)/2 = (3n−4)/2 = 3n/2 − 2`. For odd `n`: seed min = max = first element (0 comparisons), then `(n−1)/2` pairs at 3 each: `3(n−1)/2 = (3n−3)/2 = ⌈3n/2⌉ − 2` (since `⌈3n/2⌉ = (3n+1)/2` for odd `n`). Both cases collapse to **`⌈3n/2⌉ − 2`**.

Implement it with a comparison counter and assert the count equals `⌈3n/2⌉ − 2` on every input.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

// minMaxCounting returns (min, max, comparisons) using pair processing.
func minMaxCounting(a []int) (int, int, int) {
	n := len(a)
	cmps := 0
	var mn, mx, start int

	if n%2 == 0 {
		// Seed from the first pair: 1 comparison.
		cmps++
		if a[0] < a[1] {
			mn, mx = a[0], a[1]
		} else {
			mn, mx = a[1], a[0]
		}
		start = 2
	} else {
		// Odd: seed both from the first element, 0 comparisons.
		mn, mx = a[0], a[0]
		start = 1
	}

	for i := start; i+1 < n; i += 2 {
		lo, hi := a[i], a[i+1]
		cmps++ // compare the pair against each other
		if lo > hi {
			lo, hi = hi, lo
		}
		cmps++ // smaller vs running min
		if lo < mn {
			mn = lo
		}
		cmps++ // larger vs running max
		if hi > mx {
			mx = hi
		}
	}
	return mn, mx, cmps
}

func ceilBound(n int) int { // ceil(3n/2) - 2
	return (3*n+1)/2 - 2
}

func main() {
	rng := rand.New(rand.NewSource(7))
	for trial := 0; trial < 5000; trial++ {
		n := 2 + rng.Intn(60)
		a := rng.Perm(n)
		mn, mx, cmps := minMaxCounting(a)
		if mn != 0 || mx != n-1 {
			panic("wrong min/max")
		}
		if want := ceilBound(n); cmps != want {
			panic(fmt.Sprintf("n=%d: want %d comparisons, got %d", n, want, cmps))
		}
	}
	fmt.Println("min/max uses exactly ceil(3n/2)-2 comparisons on every tested input")
}
```

For `n = 1` the answer is min = max = `a[0]` with `0` comparisons; `⌈3/2⌉ − 2 = 2 − 2 = 0` agrees. The test above starts at `n ≥ 2` to exercise both parities.

- **Constraints:** Count exactly three comparisons per interior pair, plus the single seed comparison when `n` is even. Distinct elements keep the count deterministic.
- **Hints:** The win comes from comparing the pair *first*: that single comparison tells you which element can possibly be the new min (the smaller) and which the new max (the larger), so each only races *one* running extreme instead of both.
- **Acceptance test:** The counter equals `⌈3n/2⌉ − 2` for every `n`, and both extremes are correct.

---

### Task 7 — Adversary for max-finding: force `n − 1` comparisons **[coding]**

`[medium]` Build an **adversary** that answers an algorithm's comparisons *without committing to a fixed input*, and use it to force any max-finder to make `≥ n − 1` comparisons. The mechanism is a "loser" accounting: an element can be the maximum only if it has **never lost** a comparison. The adversary's job is to make sure that, until `n − 1` distinct elements have each lost at least once, at least two "never-lost" candidates remain — so the algorithm cannot yet name the max.

**Adversary rule.** Maintain a `lost[]` flag per element (initially all `false`). When the algorithm asks "is `a[i] < a[j]`?", answer consistently with a partial order; the **key move** is: if both `i` and `j` have never lost, declare the *one the algorithm would prefer to keep as candidate* the winner — but crucially, **create exactly one new loser per comparison** whenever possible. A comparison can mark at most one previously-unbeaten element as a loser, so to eliminate `n − 1` candidates the algorithm needs `≥ n − 1` comparisons.

Implement the adversary as an oracle the algorithm calls, count comparisons, and confirm that **no** correct max-finder can finish before `n − 1` comparisons against it.

#### Python

```python
class MaxAdversary:
    """Answers 'is x < y?' without fixing the input. Tracks which elements
    have ever lost; only never-lost elements can still be the maximum.
    Forces >= n-1 comparisons by creating at most one new loser per query."""
    def __init__(self, n):
        self.n = n
        self.lost = [False] * n      # element i has lost at least once
        self.cmps = 0

    def less(self, i, j):
        """Return True iff a[i] < a[j], chosen adversarially."""
        self.cmps += 1
        if self.lost[i] and not self.lost[j]:
            # i already eliminated; let j win (no NEW loser, but consistent).
            return True
        if self.lost[j] and not self.lost[i]:
            return False  # a[i] > a[j]
        # Both unbeaten, or both beaten: make exactly one new loser.
        # Eliminate j (declare a[i] > a[j]); j becomes a loser.
        self.lost[j] = True
        return False

    def candidates(self):
        return [i for i in range(self.n) if not self.lost[i]]

def find_max(adv, n):
    """A generic max-finder: linear scan using the adversary oracle."""
    best = 0
    for i in range(1, n):
        if adv.less(best, i):   # best < a[i]?
            best = i
    return best

if __name__ == "__main__":
    for n in range(1, 60):
        adv = MaxAdversary(n)
        find_max(adv, n)
        # After the algorithm halts it must have left exactly ONE candidate;
        # the adversary forced at least n-1 eliminations => >= n-1 comparisons.
        cands = adv.candidates()
        assert adv.cmps >= n - 1, (n, adv.cmps)
        assert len(cands) <= 1, ("max not isolated", n, cands)
        print(f"n={n:2d}: comparisons={adv.cmps:2d}  (lower bound n-1={n-1})")
    print("adversary forces >= n-1 comparisons; max cannot be named earlier")
```

- **Constraints:** The adversary must keep its answers **consistent** (no cycles like `a < b`, `b < c`, `c < a`). The "at most one new loser per comparison" invariant is what yields the `n − 1` bound: to leave a single unbeaten element you must eliminate `n − 1`, each needing its own comparison.
- **Hints:** The lower-bound *argument* (not just this oracle): the maximum loses no comparison, every other element must lose at least once (else it could still be the max, and the algorithm cannot prove otherwise), and a single comparison creates at most one new loser. So `≥ n − 1` comparisons.
- **Acceptance test:** Against the adversary, the algorithm's comparison count is `≥ n − 1`, and exactly one unbeaten candidate remains when it stops. Try other correct max-finders (tournament, divide-and-conquer) — all still pay `≥ n − 1`.

---

### Task 8 — Model-specificity: counting/radix sort beat `n log n` — and why it's legal **[coding + analysis]**

`[medium]` The `Ω(n log n)` bound is **model-relative**: it holds only when the algorithm's sole way to learn about inputs is pairwise comparison. **Counting sort** sorts `n` integers in `[0, k)` in `O(n + k)` — linear when `k = O(n)` — and **never compares two input elements**. This does not violate the bound; it operates in a *different* model.

Implement counting sort, instrument it to show it performs **zero element-vs-element comparisons** (only array indexing by key value), and run it on inputs where `n log₂ n` exceeds `n + k`, witnessing sub-`n log n` work.

#### Python

```python
def counting_sort(a, k):
    """Sort integers in [0, k). Returns (sorted, element_comparisons).
    No two INPUT ELEMENTS are ever compared with each other."""
    count = [0] * k
    element_comparisons = 0          # stays 0 — that's the whole point
    for x in a:
        count[x] += 1                # index by VALUE, not compare
    out = []
    for v in range(k):
        out.extend([v] * count[v])
    return out, element_comparisons

if __name__ == "__main__":
    import random
    from math import log2
    random.seed(3)
    for _ in range(1000):
        n = random.randint(50, 500)
        k = random.randint(2, n)         # small key range
        a = [random.randrange(k) for _ in range(n)]
        out, cmps = counting_sort(a, k)
        assert out == sorted(a), "counting sort incorrect"
        assert cmps == 0, "counting sort must not compare elements"
        # Work O(n + k) can be below the comparison floor n*log2(n).
    print("counting sort: 0 element comparisons; O(n+k) < Theta(n log n) when k = O(n)")
```

Go sketch of the comparison-freedom (the histogram never tests `a[i] < a[j]`):

```go
count := make([]int, k)
for _, x := range a { // index by value — no element-vs-element comparison
	count[x]++
}
```

- **Analysis to write:** Explain *why* this is consistent. The decision-tree bound assumes every information-gathering step is a binary comparison yielding `≤ 1` bit, so `t` steps distinguish `≤ 2^t` permutations, forcing `2^t ≥ n!`. Counting sort gathers information by **indexing an array of size `k`** — a single `count[x] += 1` distinguishes among `k` values at once (`log₂ k` bits), which is *not* a comparison. The lower bound simply does not apply to its operations. Note the catch: counting sort needs the keys to be small integers usable as array indices; on arbitrary comparable objects (e.g., strings ordered by a black-box comparator) you are forced back into the comparison model and `Ω(n log n)` returns. Radix sort generalizes this to `d`-digit keys in `O(d(n + b))`, again comparison-free.
- **Constraints:** The instrumentation must show **zero** element-vs-element comparisons; `count[x]` indexing is not a comparison.
- **Acceptance test:** Counting sort produces the correct order with `0` element comparisons, and the write-up correctly states *why* leaving the comparison model is legal (information per step is `log₂ k`, not `1` bit) and *when* it stops being possible (non-integer / black-box-comparator keys).

---

## Advanced Tasks

### Task 9 — Second-largest in `n + ⌈log₂ n⌉ − 2` comparisons **[coding]**

`[hard]` Finding the **second-largest** of `n` distinct elements takes exactly `n + ⌈log₂ n⌉ − 2` comparisons — strictly more than the `n − 1` for the max, by an additive `⌈log₂ n⌉ − 1`. The naive "find max (`n−1`), then max of the rest (`n−2`)" costs `2n − 3`; the optimal method is a **tournament**.

**Method.** Run a knockout tournament: pair elements, compare, winners advance, repeat — `n − 1` comparisons total to find the overall winner (the max). The second-largest must be someone who **lost *directly* to the max** (it can only have been beaten by the eventual champion). The max played `⌈log₂ n⌉` rounds, so it directly beat exactly `⌈log₂ n⌉` elements. Find the largest among those `⌈log₂ n⌉` candidates: `⌈log₂ n⌉ − 1` more comparisons.

> **Count.** Tournament to find the max: `n − 1`. The max defeated `⌈log₂ n⌉` direct opponents; the runner-up is the largest of them: `⌈log₂ n⌉ − 1` comparisons. Total `(n − 1) + (⌈log₂ n⌉ − 1) = n + ⌈log₂ n⌉ − 2`.

Implement the tournament (tracking, for each element, the list of opponents it beat), then a runoff among the champion's victims, with a comparison counter. Verify the count and correctness.

#### Python

```python
from math import log2, ceil

def second_largest_tournament(a):
    """Return (second_largest, comparisons) via a knockout tournament.
    Counts every element-vs-element comparison."""
    n = len(a)
    if n == 1:
        return None, 0
    cmps = 0
    # Each entry: (value, [values it has directly beaten]).
    level = [(x, []) for x in a]
    while len(level) > 1:
        nxt = []
        i = 0
        while i + 1 < len(level):
            (xv, xbeat), (yv, ybeat) = level[i], level[i + 1]
            cmps += 1
            if xv > yv:
                nxt.append((xv, xbeat + [yv]))   # x beat y
            else:
                nxt.append((yv, ybeat + [xv]))   # y beat x
            i += 2
        if i < len(level):           # odd element advances on a bye (no compare)
            nxt.append(level[i])
        level = nxt
    champ_val, beaten = level[0]     # beaten = everyone the max directly defeated
    # Runner-up = largest of the champion's direct victims.
    second = beaten[0]
    for v in beaten[1:]:
        cmps += 1
        if v > second:
            second = v
    return second, cmps

if __name__ == "__main__":
    import random
    random.seed(13)
    # Test on powers of two (clean log) and arbitrary n.
    for n in list(range(2, 65)):
        a = random.sample(range(1000), n)
        second, cmps = second_largest_tournament(a)
        assert second == sorted(a)[-2], (n, second, sorted(a)[-2])
        bound = n + ceil(log2(n) - 1e-9) - 2
        # For non-powers-of-two, byes mean the champion plays <= ceil(log2 n)
        # rounds, so the count is <= the bound; equality holds when n is 2^k.
        assert cmps <= bound, (n, cmps, bound)
        if (n & (n - 1)) == 0:        # n is a power of two: tight
            assert cmps == bound, (n, cmps, bound)
    print("second-largest <= n + ceil(log2 n) - 2 always; tight for n = 2^k")
```

- **Constraints:** The runoff must compare *only* the champion's direct victims — that is what caps the extra cost at `⌈log₂ n⌉ − 1`. For powers of two the count is exactly `n + ⌈log₂ n⌉ − 2`; for general `n`, byes can shave a round, so the count is `≤` the bound (still optimal for that `n`).
- **Hints:** The runner-up *cannot* be anyone except a direct victim of the champion: if `y` lost to some non-champion `z`, then `z > y`, so `y` is at best third. This pruning from "`n − 1` rest" down to "`⌈log₂ n⌉` victims" is the whole saving.
- **Acceptance test:** Returns the true second-largest for every `n`; comparison count equals `n + ⌈log₂ n⌉ − 2` for `n = 2^k` and `≤` it otherwise. (The matching `Ω` lower bound — that you cannot do better — is the analysis in Task 10.)

---

### Task 10 — Adversary lower bound for second-largest **[analysis]**

`[hard]` Prove that finding the second-largest needs `≥ n + ⌈log₂ n⌉ − 2` comparisons, matching Task 9. This is the classic **Kislitsyn** bound, proved by an adversary that controls how many comparisons the eventual maximum must win.

**Reference model proof (adversary / weight argument).**

Any algorithm that identifies the second-largest must, as a byproduct, also identify the largest — the runner-up is "second" only relative to a known champion. So `≥ n − 1` comparisons are spent establishing the max (Task 5/7). The extra `⌈log₂ n⌉ − 1` comes from forcing the maximum to **win many comparisons directly**.

**Weight adversary.** Assign each element a weight; initially `w(x) = 1` for all. When the algorithm compares `x` and `y`, the adversary declares the winner to be the one of **larger current weight** (ties broken arbitrarily), and updates `w(winner) ← w(winner) + w(loser)`, `w(loser) ← 0`. Key invariants:

- The total weight is conserved at `n` throughout; only the champion ends with positive weight (everyone else has lost, weight transferred to whoever beat them, transitively up to the max). So at the end `w(max) = n`.
- A comparison at most **doubles** the winner's weight (the winner had `≥` the loser's weight, so new weight `≤ 2 ×` old). Thus to raise the max's weight from `1` to `n`, the max must win `≥ ⌈log₂ n⌉` direct comparisons.

So the maximum directly beats `≥ ⌈log₂ n⌉` distinct elements. **Each** such direct loser is a *possible* runner-up that the algorithm must rule out: to certify the second-largest, the algorithm must compare these candidates against each other (or against the runner-up) enough to order them, which the adversary can force to cost `≥ ⌈log₂ n⌉ − 1` comparisons *beyond* the `n − 1` already spent isolating the max. Total: `(n − 1) + (⌈log₂ n⌉ − 1) = n + ⌈log₂ n⌉ − 2`. ∎

- **Constraints:** Must include (1) "second-largest implies identifying the max → `≥ n − 1`", (2) the weight invariant "winner's weight at most doubles per comparison, total weight `n`", (3) the consequence "max wins `≥ ⌈log₂ n⌉` comparisons", and (4) the runoff cost `⌈log₂ n⌉ − 1` to combine into the final bound.
- **Acceptance test:** The argument derives `≥ ⌈log₂ n⌉` direct wins for the max from the doubling-weight invariant and reaches `n + ⌈log₂ n⌉ − 2`, matching the Task 9 upper bound, so the bound is tight.

---

### Task 11 — Adversary for the max+min `⌈3n/2⌉ − 2` bound **[coding + analysis]**

`[hard]` Prove the `⌈3n/2⌉ − 2` bound for finding **both** max and min is optimal, via a **state adversary** that tracks each element's status, and witness it.

**State adversary.** Classify each element by what the algorithm has learned about it:

- **N (novice):** never been in any comparison.
- **W (winner-only):** has won at least one comparison but never lost — still a max candidate, ruled out as min.
- **L (loser-only):** has lost at least one but never won — still a min candidate, ruled out as max.
- **M (middle):** has both won and lost — ruled out as *both* max and min.

To finish, the algorithm needs exactly one element that is a confirmed max (W with all others below it) and one confirmed min (L), and every other element must be **M** — i.e., known to be neither. The adversary answers comparisons to **minimize the new information each one yields**:

| Comparison between | Adversary answer | Status change | "Useful" units gained |
| --- | --- | --- | --- |
| **N vs N** | one wins, one loses | both N → one W, one L | 2 |
| **N vs W** | the W wins | N → L | 1 |
| **N vs L** | the L loses (N wins) | N → W | 1 |
| **W vs W** | one wins | one W → M | 1 |
| **L vs L** | one loses | one L → M | 1 |
| W vs L, N vs M, … | answer consistently | no useful progress toward goal | ≤ 1 |

Define a **potential** = (units of progress still needed). To certify max+min you must move `n − 2` elements all the way to **M** (every element except the final max and min), plus settle the max and min. Counting: only an **N-vs-N** comparison yields 2 units, and there are at most `⌊n/2⌋` such comparisons (each consumes two novices). All other comparisons yield `≤ 1` unit. The total units required is `⌈3n/2⌉ − 2`, and the adversary's bookkeeping forces the algorithm to pay one comparison per unit.

Implement the adversary, run any correct max-min algorithm against it (Task 6's pair method *or* the naive `2n − 2` method), and confirm the adversary forces `≥ ⌈3n/2⌉ − 2`.

#### Python

```python
class MinMaxAdversary:
    """State adversary for simultaneous max+min. Each element is in one of
    N (novice), W (won only), L (lost only), M (won and lost). The adversary
    answers to minimize useful progress, forcing >= ceil(3n/2)-2 comparisons."""
    N, W, L, M = "N", "W", "L", "M"

    def __init__(self, n):
        self.n = n
        self.state = [self.N] * n
        self.cmps = 0

    def _win(self, w, l):
        """Record that element w beat element l, updating statuses."""
        # winner: N->W, L->M (gained a win); W stays W; M stays M
        if self.state[w] == self.N:
            self.state[w] = self.W
        elif self.state[w] == self.L:
            self.state[w] = self.M
        # loser: N->L, W->M (gained a loss); L stays L; M stays M
        if self.state[l] == self.N:
            self.state[l] = self.L
        elif self.state[l] == self.W:
            self.state[l] = self.M

    def less(self, i, j):
        """Adversarial answer to 'a[i] < a[j]?' minimizing useful progress."""
        self.cmps += 1
        si, sj = self.state[i], self.state[j]
        # N vs N is the only 2-unit move; everything else we keep to <=1 unit
        # by preserving candidates: let a W keep winning, an L keep losing.
        if si == self.W or sj == self.L:
            # i should win (i is a max-candidate, or j is a min-candidate)
            self._win(i, j)
            return False        # a[i] > a[j]
        if sj == self.W or si == self.L:
            self._win(j, i)
            return True         # a[i] < a[j]
        # Both novice (or both middle): pick i as winner.
        self._win(i, j)
        return False

if __name__ == "__main__":
    # Drive the adversary with the NAIVE 2n-2 method and the PAIR method.
    def naive_minmax(adv, n):
        mn = mx = 0
        for i in range(1, n):
            if adv.less(mx, i):  # mx < a[i]
                mx = i
        for i in range(1, n):
            if adv.less(i, mn):  # a[i] < mn
                mn = i

    from math import ceil
    for n in range(2, 60):
        adv = MinMaxAdversary(n)
        naive_minmax(adv, n)
        bound = ceil(3 * n / 2) - 2
        # The naive method pays 2n-2 >= ceil(3n/2)-2; the bound is the FLOOR
        # no algorithm can beat. We assert the adversary never lets it finish
        # in fewer than the bound.
        assert adv.cmps >= bound, (n, adv.cmps, bound)
        print(f"n={n:2d}: naive used {adv.cmps:3d}  (floor ceil(3n/2)-2 = {bound})")
    print("adversary confirms ceil(3n/2)-2 is the comparison floor for max+min")
```

- **Analysis to write:** Justify the `⌈3n/2⌉ − 2` floor via the units argument. Each element must reach **M** to be excluded as both extremes (except the two survivors). N-vs-N comparisons, the only 2-unit moves, number at most `⌊n/2⌋`; after pairing up all novices you have used `⌊n/2⌋` comparisons and produced `⌊n/2⌋` W's and `⌊n/2⌋` L's. Driving these to a single W (the max) costs `⌈n/2⌉ − 1` more W-vs-W comparisons, and to a single L costs `⌈n/2⌉ − 1` more L-vs-L comparisons. Summing: `⌊n/2⌋ + 2(⌈n/2⌉ − 1) = ⌈3n/2⌉ − 2`. The adversary's status table guarantees no comparison yields more progress than this accounting allows.
- **Constraints:** The adversary must keep answers consistent and must **never** hand the algorithm a 2-unit move except on N-vs-N. The matching upper bound is Task 6's pair method.
- **Acceptance test:** Against the adversary, any correct max-min algorithm pays `≥ ⌈3n/2⌉ − 2`; the write-up derives the floor as `⌊n/2⌋ + 2(⌈n/2⌉ − 1) = ⌈3n/2⌉ − 2`. Confirm Task 6's pair method, run against this same adversary, *meets* the floor exactly — upper and lower bounds coincide.

---

### Task 12 — Element distinctness: `Ω(n log n)` in the comparison model **[analysis]**

`[hard]` **Element Distinctness:** decide whether `n` numbers are all distinct. Prove it needs `Ω(n log n)` comparisons in the comparison (algebraic decision) model — a lower bound that, unlike sorting, is *not* about producing an ordered output, yet lands at the same `n log n`.

**Reference model answer.**

**Reduction-free argument (decision tree over orderings).** Restrict attention to inputs that *are* all distinct. On such inputs the comparison-decision tree must, along the path each input follows, gather enough comparisons to determine the input's **relative order** — because two inputs with different orderings but the same "all distinct" answer can still force different downstream comparisons, and more pointedly, a single accepting region of the tree (a leaf labeled "distinct") corresponds to a set of inputs all consistent with one fixed ordering. If a leaf's region contained two *different* orderings, an input on the boundary (where the two orderings "swap," i.e., two elements are equal) would be misclassified as distinct. So each "distinct" leaf is confined to a single one of the `n!` orderings, forcing `≥ n!` accepting leaves, hence height `≥ log₂(n!) = Ω(n log n)`.

**Why the boundary matters (topological intuition).** The set of inputs in `ℝⁿ` splits into `n!` open regions, one per strict ordering, separated by the hyperplanes `x_i = x_j`. "Not distinct" is exactly the union of those hyperplanes. A comparison tree of height `h` partitions space into `≤ 2^h` regions, each a leaf. An accepting leaf must lie entirely inside the "distinct" set, so it cannot straddle a hyperplane `x_i = x_j`; therefore it sits inside one ordering region. Covering all `n!` ordering regions needs `≥ n!` leaves, so `h ≥ log₂(n!) = Ω(n log n)`. (This is the Ben-Or algebraic-decision-tree bound in miniature: the number of connected components of the accepting set lower-bounds the tree depth.)

- **Constraints:** The argument must (1) confine each accepting leaf to a single ordering region, (2) count `≥ n!` such regions, (3) convert to `log₂(n!) = Ω(n log n)` height. Mention the `x_i = x_j` hyperplane separation that prevents a leaf from spanning two orderings.
- **Acceptance test:** Correctly argues that distinctness inherits the sorting-style `Ω(n log n)` because deciding "all distinct" forces the tree to separate the `n!` ordering regions, each of which needs its own accepting leaf. Bonus: note that with hashing (a *different* model, expected `O(n)`) the bound is escaped — exactly as counting sort escapes the sorting bound (Task 8).

---

### Task 13 — Construct the worst-case decision-tree input **[coding + analysis]**

`[hard]` The decision-tree lower bound says *some* input forces `≥ ⌈log₂(n!)⌉` comparisons; this task finds it for a specific algorithm. Given a fixed comparison sort, **construct the input that drives it to its deepest leaf** — the empirical worst case — and confirm it meets the height bound.

**Method.** For a fixed sort, the worst-case input is the one whose execution path is the *longest* root-to-leaf path in the decision tree. You can find it by brute force for small `n` (try all `n!` permutations, keep the max-comparison one), but the *analytic* task is to characterize it: for **insertion sort** the worst input is the **reverse-sorted** array (every new element sifts all the way down), giving `n(n−1)/2` comparisons; for **binary insertion sort** the worst case is any input forcing the full `⌈log₂ k⌉` probes at each step.

Implement a search that, for a given sort, returns the worst-case permutation and its comparison count, and verify the count is `≥ ⌈log₂(n!)⌉` (the universal floor) and matches the algorithm-specific prediction.

#### Python

```python
from math import log2, ceil, factorial
from itertools import permutations

def insertion_cmps(a):
    b = list(a); c = 0
    for i in range(1, len(b)):
        key = b[i]; j = i - 1
        while j >= 0:
            c += 1
            if b[j] <= key:
                break
            b[j + 1] = b[j]; j -= 1
        b[j + 1] = key
    return c

def worst_case_input(n, cmp_fn):
    worst_perm, worst_c = None, -1
    for p in permutations(range(n)):
        c = cmp_fn(p)
        if c > worst_c:
            worst_c, worst_perm = c, p
    return worst_perm, worst_c

if __name__ == "__main__":
    for n in range(2, 9):
        perm, c = worst_case_input(n, insertion_cmps)
        floor = ceil(log2(factorial(n)) - 1e-9)
        predicted = n * (n - 1) // 2          # reverse-sorted prediction
        print(f"n={n}: worst input={perm} cmps={c} "
              f"predicted={predicted} floor(log2 n!)={floor}")
        assert c >= floor, "below information-theoretic floor"
        assert c == predicted, "insertion-sort worst != reverse-sorted count"
        assert list(perm) == list(range(n - 1, -1, -1)), \
            "the worst input for insertion sort is the reversed array"
    print("worst-case input is reverse-sorted; cmps = n(n-1)/2 >= ceil(log2 n!)")
```

- **Analysis to write:** Argue why the **reversed** array is insertion sort's worst case: each newly inserted element is smaller than all already-placed elements, so the inner loop sifts it past all `i` predecessors, costing `i` comparisons at step `i`, summing to `n(n−1)/2`. Then contrast: this is *far above* the `⌈log₂(n!)⌉` floor because insertion sort is suboptimal — the floor is met (within a constant) only by optimal sorts like merge sort, whose worst-case input is subtler (it has no single "obvious" reversed-array worst case; its worst input depends on the merge structure).
- **Constraints:** Brute-force search caps at `n ≤ 8`. The found worst case must equal the analytic prediction (reversed array for insertion sort).
- **Acceptance test:** The search returns the reverse-sorted permutation with `n(n−1)/2` comparisons, which is `≥ ⌈log₂(n!)⌉`, and the write-up explains both the algorithm-specific worst case and why it exceeds the universal floor.

---

### Task 14 — Communication and streaming lower bounds (optional) **[analysis]**

`[hard]` Lower bounds live in models beyond comparisons. Two flavors, *analysis only* — describe the model and the bound; implement nothing.

**(a) Communication complexity — Equality and Disjointness.** Two parties, Alice with `x ∈ {0,1}^n` and Bob with `y ∈ {0,1}^n`, want to compute a function while exchanging as few **bits** as possible.

- **Equality** (`EQ(x, y) = 1` iff `x = y`): any *deterministic* protocol needs `Ω(n)` bits. *Argument (fooling set / rectangle):* a deterministic protocol partitions the `2^n × 2^n` input matrix into **monochromatic combinatorial rectangles** (a transcript determines a rectangle of inputs, all sharing the same answer). The `2^n` diagonal entries `(x, x)` all output `1`, but no two can share a `1`-rectangle: if `(x, x)` and `(x', x')` were in one rectangle, so would be `(x, x')`, which outputs `0` — contradiction. So there are `≥ 2^n` distinct `1`-rectangles, needing `≥ n` bits of transcript to index. (Randomization drops EQ to `O(log n)` with fingerprinting — a *different* model.)
- **Disjointness** (`DISJ(x, y) = 1` iff the sets share no element): needs `Ω(n)` bits *even with randomization*. It is the canonical hard problem; reductions from DISJ prove many streaming lower bounds.

**(b) Streaming — exact distinct count needs `Ω(n)` space.** A streaming algorithm sees elements `a_1, …, a_m` one pass, with limited memory, and must report `F_0` = the number of **distinct** elements.

- *Claim:* computing `F_0` **exactly** requires `Ω(n)` bits of space (where `n` is the universe size), even with randomization.
- *Argument (reduction from Equality/Index):* encode Alice's set `x` into the stream's first half and Bob's set into the second; an exact distinct-count lets the parties decide set equality (or Index) with only the algorithm's memory as the entire message. Since EQ/Index needs `Ω(n)` communication, the memory must be `Ω(n)` bits. *Intuition:* to know exactly how many distinct elements you have seen, you essentially must remember *which* ones, and remembering a subset of `[n]` costs `Ω(n)` bits. (This is why practical systems use **approximate** counters — HyperLogLog estimates `F_0` to `±ε` in `O(ε^{-2} log log n)` bits, escaping the bound by relaxing *exactness*, just as counting sort escapes `Ω(n log n)` by leaving the comparison model.)

- **Constraints:** For (a), define the combinatorial-rectangle / fooling-set argument for EQ and state that DISJ is `Ω(n)` even randomized. For (b), reduce exact `F_0` to a communication problem and conclude `Ω(n)` space, contrasting with approximate `F_0`.
- **Acceptance test:** The write-up correctly (1) explains why deterministic EQ needs `Ω(n)` via the `2^n` distinct `1`-rectangles on the diagonal, (2) names DISJ as the randomized-hard canonical problem, and (3) reduces exact distinct-count to communication to show `Ω(n)` streaming space — closing with the recurring theme that **relaxing the model (randomization, approximation) is the only way past an information-theoretic floor.**

---

## Synthesis Task

> Tie the thread together: pick a problem, prove its comparison lower bound, build an adversary that forces it, implement an algorithm that meets it, and instrument the counter to show upper and lower bounds coincide.

`[capstone]` Take **MAX-AND-MIN** and carry it through the full lower-bound arc — bound, adversary, matching algorithm, and model boundary.

1. **Lower bound [analysis].** Prove `⌈3n/2⌉ − 2` is necessary via the state adversary (Task 11): each non-survivor must reach status **M**, N-vs-N comparisons (the only 2-unit moves) number `≤ ⌊n/2⌋`, and driving the W's and L's down to a single max and a single min costs `2(⌈n/2⌉ − 1)` more, summing to `⌊n/2⌋ + 2(⌈n/2⌉ − 1) = ⌈3n/2⌉ − 2`.

2. **Adversary [coding].** Implement the state adversary and confirm it forces `≥ ⌈3n/2⌉ − 2` against *any* correct max-min algorithm you throw at it (naive `2n − 2` and the pair method both pay at least the floor).

3. **Matching algorithm [coding].** Implement the pair-processing method (Task 6), instrument its comparison counter, and confirm it achieves **exactly** `⌈3n/2⌉ − 2` — so the algorithm meets the adversary's floor and the bound is **tight**.

4. **Model boundary [analysis].** State where the bound applies and where it breaks. `⌈3n/2⌉ − 2` is a *comparison-model* bound: if the inputs are small integers, you could find max and min by a histogram scan in `O(n + k)` with **zero** element comparisons — escaping the bound exactly as counting sort does (Task 8). Contrast with the additive structure: max alone is `n − 1`, min alone is `n − 1`, but together `⌈3n/2⌉ − 2 < 2n − 2` because pairing **shares information** between the two searches.

Reference solution in **Python** (combines the adversary and the matching algorithm):

```python
from math import ceil

def pair_minmax(a):
    """Optimal min+max: returns (min, max, comparisons) = ceil(3n/2)-2."""
    n = len(a); c = 0
    if n % 2 == 0:
        c += 1
        mn, mx = (a[0], a[1]) if a[0] < a[1] else (a[1], a[0])
        start = 2
    else:
        mn = mx = a[0]; start = 1
    for i in range(start, n - 1, 2):
        lo, hi = a[i], a[i + 1]
        c += 1
        if lo > hi: lo, hi = hi, lo
        c += 1
        if lo < mn: mn = lo
        c += 1
        if hi > mx: mx = hi
    return mn, mx, c

if __name__ == "__main__":
    import random
    random.seed(99)
    for n in range(1, 80):
        a = random.sample(range(10000), n)
        mn, mx, c = pair_minmax(a)
        assert mn == min(a) and mx == max(a), (n, mn, mx)
        floor = ceil(3 * n / 2) - 2
        assert c == floor, (n, c, floor)   # meets the lower bound exactly
    print("pair method meets the ceil(3n/2)-2 floor exactly: bound is tight")
```

- **Proof answer:** The state adversary keeps `n − 2` elements that must each become **M**; only `⌊n/2⌋` comparisons (N-vs-N) make 2 units of progress, the rest make `≤ 1`, so the total comparisons are at least `⌊n/2⌋ + 2(⌈n/2⌉ − 1) = ⌈3n/2⌉ − 2`. The pair method attains this, so it is optimal.
- **Acceptance test:** The adversary forces `≥ ⌈3n/2⌉ − 2` on every correct algorithm; the pair method's counter equals `⌈3n/2⌉ − 2` exactly across all `n`; the write-up derives the floor algebraically and correctly places the bound in the comparison model (with the integer-histogram escape hatch noted). This mirrors the whole craft — **prove the floor with an adversary, build the algorithm that meets it, instrument the counter to witness equality, and name the model where the bound holds** — which is the entire discipline of lower bounds and adversary arguments.

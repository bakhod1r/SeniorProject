# Reservoir Sampling — Interview Preparation

Reservoir sampling is a beloved interview topic because it rewards one crisp insight — *"fill `k` slots, then keep the `i`-th item with probability `k/i`, evicting a uniformly random slot"* — and then tests whether you can (a) prove the `k/n` uniformity via the telescoping product, (b) handle the `k = 1` vs general `k` distinction, (c) reason about the unknown/unbounded stream length and `O(k)` memory, and (d) extend to weighted sampling, the skip-based Algorithm L, and distributed merges. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Sample 1 item from a stream | `k = 1` reservoir | replace w.p. `1/i`, `O(n)` time `O(1)` space |
| Sample `k` items from a stream | Algorithm R | keep item `i` w.p. `k/i`, `O(n)`/`O(k)` |
| Stream length unknown/unbounded? | reservoir sampling | works regardless of `n` |
| Too many RNG calls at huge `n`? | Algorithm L | `O(k(1+log(n/k)))` draws |
| Items have weights? | A-Res (Efraimidis-Spirakis) | keys `u^(1/w)`, keep top-`k` |
| Sample across shards? | count-weighted merge | ship `(reservoir, count)` |
| Why `k/i`? | maintains the invariant | reservoir = uniform `k`-sample of first `i` |

The core algorithm (the heart of everything):

```text
reservoir_sample(stream, k):
    R = []
    for i, item in enumerate(stream):     # i 0-based
        if i < k:
            R.append(item)                # fill phase
        else:
            j = randInt(0, i)             # uniform in [0, i]
            if j < k:                     # probability k/(i+1)
                R[j] = item               # evict a uniformly random slot
    return R
# Time O(n), Space O(k); each item ends with probability k/n.
```

Key facts:
- **Keep item `i` with probability `k/i`; the eviction slot must be uniformly random.**
- The proof telescopes: `(k/t)·∏(1 - 1/j) = k/n` for any entry step `t`.
- One pass, `O(k)` memory, no advance knowledge of `n` — that is the whole point.
- Algorithm L gives the *same distribution* with far fewer RNG calls.
- Distributed merges need the **count** per shard, never a plain concatenation.

---

## Junior Questions (12 Q&A)

### J1. What problem does reservoir sampling solve?
Picking `k` items uniformly at random from a stream whose length `n` is unknown (or unbounded), in a single pass and using only `O(k)` memory. You cannot store everything or pick random indices because you do not know `n` in advance.

### J2. State the algorithm in one sentence.
Fill the reservoir with the first `k` items; then for the `i`-th item (`i > k`), keep it with probability `k/i`, and if you keep it, overwrite one uniformly random reservoir slot.

### J3. What is the `k = 1` case?
Keep a single `chosen` variable. For the `i`-th item, replace `chosen` with it with probability `1/i`. At the end every item has probability `1/n` of being `chosen`.

### J4. Why probability `k/i` specifically?
Because after `i` items a fair sample should contain each of them with probability `k/i`. The `k/i` rule is exactly what keeps the reservoir a uniform `k`-sample of everything seen so far at every step.

### J5. What is the time and space complexity?
`O(n)` time (one pass, `O(1)` per item) and `O(k)` space (the reservoir plus a counter). Space is independent of `n`.

### J6. How do you draw "keep with probability `k/i`" in code?
Draw `j = randInt(0, i)` (0-based, `i+1` outcomes). If `j < k`, keep the item and put it in slot `j`. `P(j < k) = k/(i+1)`, which is `k/i` in 1-based terms.

### J7. What happens if the stream has fewer than `k` items?
The reservoir holds all of them — you cannot sample more items than exist. The replace phase never runs.

### J8. Is reservoir sampling with or without replacement?
Classic Algorithm R is *without* replacement: each item occupies at most one slot, so no item appears twice.

### J9. What is a common off-by-one bug?
Mixing 0-based code with 1-based math. The math keeps item `i` with probability `k/i`; 0-based code keeps the `i`-th item with probability `k/(i+1)`, i.e. `randInt(0, i)` with `i+1` outcomes — not `randInt(0, i-1)`.

### J10. Why not just collect everything and shuffle?
That needs `O(n)` memory and a known `n`. Reservoir sampling gives the same uniform result in `O(k)` memory with one pass and no advance knowledge of `n`.

### J11. What if you forget to seed the RNG?
You may get the same sample every run (constant seed) or correlated draws (reseeding per item). Seed once from good entropy, or deliberately for reproducible tests.

### J12 (analysis). Why does every item end with the same probability even though later items are "kept" less often?
Later items are accepted with smaller probability `k/i`, but they also have fewer future chances to be evicted. The two effects cancel exactly — the telescoping product `(k/t)·∏_{j>t}(1-1/j)` collapses to `k/n` for *every* entry step `t`.

---

## Middle Questions (12 Q&A)

### M1. State and prove the loop invariant.
Invariant: after `i` items, the reservoir is a uniform `k`-sample of those `i`. Base: after `k` items it is all `k`, trivially uniform. Step: a new item enters with prob `k/(i+1)` (its fair share); an old item present with prob `k/i` survives unless evicted (`(k/(i+1))·(1/k) = 1/(i+1)`), giving `(k/i)·(i/(i+1)) = k/(i+1)`. Every item then has prob `k/(i+1)`.

### M2. What is Algorithm L and what does it optimize?
A skip-based version that computes how many items to skip before the next acceptance in one draw, instead of flipping a coin per item. It produces the identical distribution but uses `O(k(1+log(n/k)))` RNG calls instead of `O(n)`.

### M3. Roughly how many RNG calls does Algorithm L make?
About `k(1 + ln(n/k))`. For `n = 10^9`, `k = 100`, that is ~1,700 draws vs `10^9` for Algorithm R — a huge saving when the RNG is the bottleneck.

### M4. How does weighted reservoir sampling work?
Efraimidis-Spirakis (A-Res): for each item with weight `w`, draw `u ∈ (0,1)` and form a key `u^(1/w)`; keep the `k` items with the largest keys, maintained in a size-`k` min-heap.

### M5. Why does `u^(1/w)` favor heavy items?
A larger `w` makes `1/w` smaller, so `u^(1/w)` is pushed closer to 1. The key's CDF is `P(u^(1/w) ≤ x) = x^w`, engineered so the probability an item has the max key equals `w/Σw`.

### M6. Why a min-heap for weighted sampling?
You cannot store all keys (`O(k)` memory). A size-`k` min-heap holds the current top-`k`; each new item is compared against the heap's smallest key and swapped in if larger — `O(log k)` per item.

### M7. What numerical issue does `u^(1/w)` have and how do you fix it?
For large weights or many items, `u^(1/w)` can underflow to 0.0. Compare in log space using `ln(u)/w` instead; `ln` is monotone so the top-`k` is identical but the arithmetic is stable.

### M8. Compare reservoir sampling to the naive shuffle precisely.
Both yield a uniform `k`-subset. Naive shuffle needs `O(n)` memory and a known `n`; reservoir needs `O(k)` and no `n`. Reservoir sampling is essentially a streaming, memory-bounded partial Fisher-Yates shuffle.

### M9. Can you stop a reservoir sampler early?
Yes — the reservoir is a valid uniform sample of everything seen *so far* at every prefix. Stop at any time and you have a correct sample. The naive shuffle has no such property.

### M10. How do you empirically verify uniformity?
Run the sampler many thousands of times and histogram how often each item appears; each should be near `k/n`. A systematic skew (not just random jitter) signals a bug — usually a wrong draw range or fixed acceptance probability.

### M11. Does the order of the stream matter?
No. The only randomness is the algorithm's own draws; uniformity holds for any (even adversarial) stream order. The algorithm reacts only to the position index `i`.

### M12 (analysis). Why is Algorithm L's distribution identical to Algorithm R's?
Both accept items with the same per-item probabilities and evict uniformly random slots. Algorithm L samples the *gap* to the next acceptance directly (inverting a geometric-like CDF parametrized by a running `W`) rather than testing each item, but the joint distribution of accepted items and evicted slots is unchanged.

---

## Senior Questions (10 Q&A)

### S1. How do you sample uniformly across a partitioned stream on many machines?
Each shard runs a local reservoir and tracks the **count** `c_j` it has seen. A coordinator performs a **count-weighted merge**: each output slot is taken from shard `j` with probability `c_j/Σc`. Never concatenate sub-samples — that biases toward small shards.

### S2. Why must counts travel with reservoirs?
A shard's `k` items represent very different population sizes. A shard that saw a billion events must contribute more than one that saw ten. Without the count, the merge weights them equally and the result is biased — the #1 distributed reservoir bug.

### S3. Is reservoir merging associative? Why does that matter?
Yes — the per-slot choice depends only on the counts, so any folding order gives the same distribution. This lets you merge hierarchically (host → rack → region → global), bounding any single node's merge load — essential at fleet scale.

### S4. How do you make weighted sampling mergeable?
Ship the keys `u^(1/w)` alongside items. The global top-`k` is just the top-`k` of all shipped keys, which is trivially associative — weighted merge becomes "keep the largest keys."

### S5. Reservoir vs Bernoulli sampling — when each?
Reservoir gives an exact *fixed-size* sample (`k` items); Bernoulli keeps each item with probability `p`, giving a variable-size (`≈ pn`) sample with no coordination but no size guarantee. Use reservoir when storage/batch size must be fixed; Bernoulli when a fixed rate is acceptable.

### S6. How do you get recency-biased sampling?
Use forward-decay weighted sampling: assign weight `e^(λt)` to an item at time `t` and run A-Res, so recent items get larger keys and dominate. Or use tumbling windows. Forward decay needs periodic time-origin rebasing to avoid overflow.

### S7. What are the main failure modes in production?
Merging without counts, hot partitions (one shard bottlenecks throughput), lost shard state on restart (under-weights that shard), double counting under at-least-once delivery (over-weights), window misalignment across clocks, and identical RNG seeds across shards (correlated choices).

### S8. How do you checkpoint a reservoir for fault tolerance?
Persist `(reservoir, count, stream_offset)` atomically. On recovery, reload and resume from the offset. The count and offset must be consistent, and at-least-once replay can inflate the count — checkpoint frequently or dedupe by event id.

### S9. What guarantee do you promise downstream consumers?
A fixed-size (`k`) sample where each item has inclusion probability `k/n` within the window — a *rate that depends on the window's total count*, not a fixed fraction. Teams expecting a fixed rate want Bernoulli. Document `n`, `k`, window bounds, and the variant in the sample's schema.

### S10 (analysis). What is the variance of a sample-mean estimate from a reservoir?
`Var(μ̂) = (σ²/k)·(n-k)/(n-1)` — unbiased, with a finite-population correction making it slightly better than with-replacement. Crucially, the sample size for a target error is `O(1/ε²)` and **independent of `n`**, so a tiny reservoir estimates a huge stream's mean reliably.

---

## Professional Questions (8 Q&A)

### P1. Design a service that keeps a uniform 0.01% sample of all production logs.
Sample host-locally first (small reservoir per host) to cut wire bytes; partition-level reservoirs over Kafka with per-partition counts; a tree merge folding partition → region → global with count-weighting; emit `(k-sample, total count, window bounds)`. Memory is `O(k)` everywhere; the merge is sub-second.

### P2. How do you decide between Algorithm R and Algorithm L?
Default to R for simplicity and moderate `n`. Switch to L only when profiling shows RNG or per-item branch cost matters at large `n` — its benefit (fewer draws) only materializes when `n ≫ k`. Total time is `Θ(n)` for both since you must read every item.

### P3. Your weighted sampler over-represents a few huge-weight items incorrectly. How do you debug?
Check for floating-point underflow in `u^(1/w)` (switch to log-space `ln(u)/w`), an inverted heap comparator (must keep the *largest* keys via a min-heap whose min you replace), and zero/negative weights (`1/w` blows up). Validate against the analytic `w_i/Σw` over many runs.

### P4. How do you validate a distributed reservoir sampler in production?
Inject canary items at a known rate and continuously assert their inclusion frequency matches `k/n` with a chi-square/KS test over a rolling window. Biased merges and seed collisions produce a slow statistical drift the canary catches before dashboards look wrong.

### P5. A "fixed 0.1% sample" requirement and a "fixed 50k-item sample" requirement arrive. What do you build?
The first is Bernoulli sampling (keep each item w.p. 0.001) — variable size, no coordination. The second is a reservoir of `k = 50,000` — fixed size, distributed count-weighted merge. Confusing them causes "sample too small in quiet periods" tickets; clarify the contract up front.

### P6. How do you size `k` for a target estimation accuracy?
Use the concentration bound: for values in `[a,b]`, `k = O((b-a)²·ln(1/δ)/ε²)` for additive error `ε` at confidence `1-δ`, independent of `n`. E.g. error rate within ±1% at 99% confidence needs `k ≈ 27,000` regardless of stream size.

### P7. How would you parallelize sampling within a single multi-threaded shard?
Keep per-thread sub-reservoirs (with per-thread counts) to avoid mutex contention, then count-weighted-merge them at flush. A single locked reservoir is fine at moderate rates but becomes a bottleneck at millions of events/sec.

### P8 (analysis). Why is one pass with `O(k)` space optimal for this problem?
Outputting a uniform `k`-subset of an `n`-item unknown-length stream provably requires reading all `n` items (`Ω(n)` time) and holding `k` of them (`Ω(k)` space); you cannot revisit discarded items without storing them (`Ω(n)`). Reservoir sampling matches all three bounds simultaneously, so no algorithm does strictly better.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about choosing a sampling strategy under a memory constraint.
Look for a story where the data was too big to store or of unknown length, the candidate recognized reservoir sampling's `O(k)` memory and one-pass property, picked `k` from an accuracy target (not guesswork), and validated uniformity empirically before trusting it.

### B2. A teammate concatenated per-shard samples and the metrics looked off. How do you handle it?
Explain calmly with a tiny example: a shard that saw a billion events and one that saw ten cannot contribute equally. Show the one-line fix — carry the count and weight the merge by it — and add a canary uniformity check to CI. Frame it as "a known trap," not blame.

### B3. Design a feature that samples a fixed number of user sessions per day for QA.
Reservoir of size `k` per day; reset at the day boundary (tumbling window); if distributed, count-weighted merge across app servers. Discuss the fixed-size guarantee vs a fixed-rate alternative and how QA queries should scale estimates by `n/k`.

### B4. How would you explain reservoir sampling to a junior engineer?
Use the fish-tank analogy: a tank holds `k` fish, a river of fish swims past, each passing fish gets a fair `k/i` shot at jumping in and bumping a random tank fish out. When the river ends, every fish was equally likely to be in the tank. Then show the `k/i` line and the two gotchas: right draw range, uniform eviction.

### B5. Your sampling service uses too much memory. How do you investigate?
Check whether you are accidentally buffering the whole stream (the classic mistake) instead of streaming with `O(k)` state; whether per-shard `k` is larger than needed; whether weighted keys are stored for all items instead of a size-`k` heap. The fix is almost always "stop materializing the stream."

---

## Coding Challenges

### Challenge 1: Algorithm R — sample `k` from a stream

**Problem.** Implement `reservoirSample(stream, k)` returning a uniform random `k`-subset of a one-pass stream, using `O(k)` memory.

**Example.**
```text
reservoirSample([10,20,30,40,50,60,70], 3) -> e.g. [10,60,30]  (varies per run)
reservoirSample([1,2], 5)                  -> [1,2]             (n < k: all items)
```

**Constraints.** Stream length unknown; `O(k)` extra space; single pass.

**Optimal.** Algorithm R, `O(n)` time, `O(k)` space.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func reservoirSample(stream []int, k int) []int {
	R := make([]int, 0, k)
	for i, item := range stream {
		if i < k {
			R = append(R, item)
		} else {
			j := rand.Intn(i + 1) // uniform in [0, i]
			if j < k {
				R[j] = item
			}
		}
	}
	return R
}

func main() {
	fmt.Println(reservoirSample([]int{10, 20, 30, 40, 50, 60, 70}, 3))
}
```

**Java.**
```java
import java.util.*;

public class ReservoirR {
    static int[] reservoirSample(int[] stream, int k) {
        int[] R = new int[Math.min(k, stream.length)];
        Random rnd = new Random();
        for (int i = 0; i < stream.length; i++) {
            if (i < k) R[i] = stream[i];
            else {
                int j = rnd.nextInt(i + 1);
                if (j < k) R[j] = stream[i];
            }
        }
        return R;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            reservoirSample(new int[]{10, 20, 30, 40, 50, 60, 70}, 3)));
    }
}
```

**Python.**
```python
import random


def reservoir_sample(stream, k):
    R = []
    for i, item in enumerate(stream):
        if i < k:
            R.append(item)
        else:
            j = random.randint(0, i)   # uniform in [0, i]
            if j < k:
                R[j] = item
    return R


if __name__ == "__main__":
    print(reservoir_sample([10, 20, 30, 40, 50, 60, 70], 3))
```

---

### Challenge 2: Single-item reservoir (`k = 1`) from a true iterator

**Problem.** Implement `sampleOne(iter)` that returns one uniformly random item from an iterator of unknown length, using `O(1)` memory.

**Example.**
```text
sampleOne(iter over [a,b,c,d]) -> one of a,b,c,d, each with prob 1/4
```

**Constraints.** Cannot index or know the length; one pass; `O(1)` space.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func sampleOne(stream []string) string { // slice stands in for an iterator
	var chosen string
	for i, item := range stream {
		if rand.Intn(i+1) == 0 { // probability 1/(i+1)
			chosen = item
		}
	}
	return chosen
}

func main() { fmt.Println(sampleOne([]string{"a", "b", "c", "d"})) }
```

**Java.**
```java
import java.util.*;

public class SampleOne {
    static <T> T sampleOne(Iterator<T> it) {
        Random rnd = new Random();
        T chosen = null;
        int i = 0;
        while (it.hasNext()) {
            T item = it.next();
            if (rnd.nextInt(++i) == 0) chosen = item; // prob 1/i
        }
        return chosen;
    }

    public static void main(String[] args) {
        System.out.println(sampleOne(List.of("a", "b", "c", "d").iterator()));
    }
}
```

**Python.**
```python
import random


def sample_one(iterable):
    chosen = None
    for i, item in enumerate(iterable, start=1):  # i = count seen so far
        if random.randint(1, i) == 1:             # probability 1/i
            chosen = item
    return chosen


if __name__ == "__main__":
    print(sample_one(iter("abcd")))
```

---

### Challenge 3: Weighted reservoir sampling (A-Res)

**Problem.** Implement `weightedSample(items, weights, k)` returning a weighted random `k`-subset without replacement, using keys `u^(1/w)` and a size-`k` min-heap.

**Example.**
```text
weightedSample([1,2,3,4,5], [1,1,1,10,10], 2) -> usually contains 4 and/or 5
```

**Constraints.** One pass; `O(k)` memory; weights `> 0`.

**Go.**
```go
package main

import (
	"container/heap"
	"fmt"
	"math"
	"math/rand"
)

type keyed struct {
	key  float64
	item int
}
type minHeap []keyed

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].key < h[j].key }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(keyed)) }
func (h *minHeap) Pop() interface{} {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

func weightedSample(items []int, w []float64, k int) []int {
	h := &minHeap{}
	for i, it := range items {
		key := math.Log(rand.Float64()) / w[i] // log-space key
		if h.Len() < k {
			heap.Push(h, keyed{key, it})
		} else if key > (*h)[0].key {
			heap.Pop(h)
			heap.Push(h, keyed{key, it})
		}
	}
	out := make([]int, 0, h.Len())
	for _, e := range *h {
		out = append(out, e.item)
	}
	return out
}

func main() {
	fmt.Println(weightedSample([]int{1, 2, 3, 4, 5},
		[]float64{1, 1, 1, 10, 10}, 2))
}
```

**Java.**
```java
import java.util.*;

public class WeightedReservoir {
    record Keyed(double key, int item) {}

    static List<Integer> weightedSample(int[] items, double[] w, int k) {
        PriorityQueue<Keyed> heap =
            new PriorityQueue<>(Comparator.comparingDouble(Keyed::key));
        Random rnd = new Random();
        for (int i = 0; i < items.length; i++) {
            double key = Math.log(rnd.nextDouble()) / w[i]; // log-space
            if (heap.size() < k) heap.add(new Keyed(key, items[i]));
            else if (key > heap.peek().key()) {
                heap.poll();
                heap.add(new Keyed(key, items[i]));
            }
        }
        List<Integer> out = new ArrayList<>();
        for (Keyed e : heap) out.add(e.item());
        return out;
    }

    public static void main(String[] args) {
        System.out.println(weightedSample(
            new int[]{1, 2, 3, 4, 5}, new double[]{1, 1, 1, 10, 10}, 2));
    }
}
```

**Python.**
```python
import heapq
import math
import random


def weighted_sample(items, weights, k):
    heap = []  # min-heap of (log-space key, item)
    for it, w in zip(items, weights):
        key = math.log(random.random()) / w   # log-space avoids underflow
        if len(heap) < k:
            heapq.heappush(heap, (key, it))
        elif key > heap[0][0]:
            heapq.heapreplace(heap, (key, it))
    return [item for _, item in heap]


if __name__ == "__main__":
    print(weighted_sample([1, 2, 3, 4, 5], [1, 1, 1, 10, 10], 2))
```

---

### Challenge 4: Count-weighted merge of two reservoirs

**Problem.** Given two reservoirs `(R_A, c_A)` and `(R_B, c_B)` — each a uniform `k`-sample of `c_A` and `c_B` items respectively — produce a uniform `k`-sample of the combined population.

**Example.**
```text
merge([items from 1000-item shard], 1000,
      [items from 10-item shard],   10, k=3)
   -> almost always all 3 from the big shard (correctly weighted)
```

**Constraints.** Output exactly `k`; weight each side by its count.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func merge(ra []int, ca int64, rb []int, cb int64, k int) ([]int, int64) {
	rand.Shuffle(len(ra), func(i, j int) { ra[i], ra[j] = ra[j], ra[i] })
	rand.Shuffle(len(rb), func(i, j int) { rb[i], rb[j] = rb[j], rb[i] })
	out, ai, bi := make([]int, 0, k), 0, 0
	for len(out) < k && (ai < len(ra) || bi < len(rb)) {
		takeA := ai < len(ra)
		if ai < len(ra) && bi < len(rb) {
			takeA = rand.Int63n(ca+cb) < ca // prob ca/(ca+cb)
		}
		if takeA {
			out = append(out, ra[ai]); ai++
		} else {
			out = append(out, rb[bi]); bi++
		}
	}
	return out, ca + cb
}

func main() {
	a := []int{1, 2, 3}
	b := []int{1000, 1001, 1002}
	fmt.Println(merge(a, 1000, b, 10, 3))
}
```

**Java.**
```java
import java.util.*;

public class MergeReservoirs {
    static int[] merge(int[] ra, long ca, int[] rb, long cb, int k, Random r) {
        List<Integer> a = new ArrayList<>(), b = new ArrayList<>();
        for (int x : ra) a.add(x);
        for (int x : rb) b.add(x);
        Collections.shuffle(a, r);
        Collections.shuffle(b, r);
        List<Integer> out = new ArrayList<>();
        int ai = 0, bi = 0;
        while (out.size() < k && (ai < a.size() || bi < b.size())) {
            boolean takeA = ai < a.size();
            if (ai < a.size() && bi < b.size())
                takeA = Math.floorMod(r.nextLong(), ca + cb) < ca;
            if (takeA) out.add(a.get(ai++)); else out.add(b.get(bi++));
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(merge(
            new int[]{1, 2, 3}, 1000, new int[]{1000, 1001, 1002}, 10, 3,
            new Random())));
    }
}
```

**Python.**
```python
import random


def merge(ra, ca, rb, cb, k):
    a, b = list(ra), list(rb)
    random.shuffle(a)
    random.shuffle(b)
    out, ai, bi = [], 0, 0
    while len(out) < k and (ai < len(a) or bi < len(b)):
        take_a = ai < len(a)
        if ai < len(a) and bi < len(b):
            take_a = random.randrange(ca + cb) < ca   # prob ca/(ca+cb)
        if take_a:
            out.append(a[ai]); ai += 1
        else:
            out.append(b[bi]); bi += 1
    return out, ca + cb


if __name__ == "__main__":
    print(merge([1, 2, 3], 1000, [1000, 1001, 1002], 10, 3))
```

---

## Final Tips

- Lead with the one-liner: *"Fill `k` slots, then keep the `i`-th item with probability `k/i` and evict a uniformly random slot — one pass, `O(k)` memory, each item ends with probability `k/n`."*
- Immediately flag the two correctness essentials: **draw from the full range `[0, i]`** (not a fixed range) and **evict a uniformly random slot** (or subset uniformity breaks).
- Show you know the `k = 1` case and the telescoping proof — it is the fastest way to demonstrate real understanding.
- Mention **Algorithm L** (fewer RNG calls), **A-Res** (weighted via `u^(1/w)` keys), and the **count-weighted merge** for distributed settings as the natural extensions.
- Always offer to validate uniformity empirically (histogram of inclusion counts ≈ `k/n`) — it catches the classic range and probability bugs in seconds.

---

Next step: [tasks.md](./tasks.md)

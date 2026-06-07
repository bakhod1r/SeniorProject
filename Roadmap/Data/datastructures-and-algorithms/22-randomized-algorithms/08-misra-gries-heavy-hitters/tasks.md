# Misra-Gries Heavy Hitters — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Misra-Gries logic and validate against the evaluation criteria.
> **Always check your output against a brute-force exact counter (hash map / `Counter`) on small inputs, and confirm both that no true heavy hitter is missed and that the estimate obeys `f(x) - n/k ≤ est(x) ≤ f(x)`.**

---

## Beginner Tasks (5)

### Task 1 — Misra-Gries first pass

**Problem.** Implement `misraGries(stream, k)` returning the candidate map (≤ `k - 1` entries) with the three update rules: increment, claim free slot, decrement-all (drop zeros).

**Input / Output spec.**
- Input: a list/slice of string items and integer `k ≥ 2`.
- Output: a map from candidate item to its (undercounted) estimate.

**Constraints.** Use at most `k - 1` counters at any time. Do not store all distinct items.

**Hint.** When iterating to decrement, snapshot the keys first to avoid mutating during iteration.

**Starter — Go.**
```go
package main

import "fmt"

func misraGries(stream []string, k int) map[string]int {
	// TODO: three rules
	return nil
}

func main() {
	fmt.Println(misraGries([]string{"A", "B", "A", "C", "C", "A", "B", "D", "A"}, 3))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static Map<String,Integer> misraGries(List<String> stream, int k) {
        // TODO
        return new HashMap<>();
    }
    public static void main(String[] args) {
        System.out.println(misraGries(
            Arrays.asList("A","B","A","C","C","A","B","D","A"), 3));
    }
}
```

**Starter — Python.**
```python
def misra_gries(stream, k):
    # TODO: three rules
    return {}

if __name__ == "__main__":
    print(misra_gries(["A","B","A","C","C","A","B","D","A"], 3))
```

- **Expected Output:** a map containing `A` (e.g. `{A:2, D:1}`); exact contents depend on order but `A` must be present.
- **Evaluation:** correctness, never exceeding `k - 1` counters, dropping zeros.

### Task 2 — Boyer-Moore majority (`k = 2`)

**Problem.** Implement the single-counter majority-vote and confirm it is Misra-Gries with `k = 2`. Return the candidate and whether it is a true majority (verify with a second pass).

**Constraints.** `O(1)` extra space for the first pass.

**Hint.** Adopt the current item as candidate whenever `count == 0`; increment on match, decrement otherwise.

**Expected Output:** for `[2,2,1,1,2,2]` → `(2, true)`; for `[1,2,3,4]` → some candidate, `false`.

**Evaluation:** correctness on both majority-exists and no-majority inputs.

### Task 3 — Two-pass exact heavy hitters

**Problem.** Using your Task 1 function, return the **exact** set of items with frequency `> n/k` via a verification second pass.

**Constraints.** Second pass counts only the `≤ k - 1` candidates.

**Hint.** Build `exact = {c: 0}` over candidates, re-scan the stream, then filter by `count > n/k`.

**Expected Output:** for the sample stream, `k = 3` → `{A: 4}`.

**Evaluation:** no false positives in the final result; no heavy hitter missed.

### Task 4 — Validate the undercount bound

**Problem.** Generate a random stream, run Misra-Gries, and assert for every reported item that `f(x) - n/k ≤ est(x) ≤ f(x)`, and that every true heavy hitter is present.

**Constraints.** Use a brute-force exact counter as the oracle.

**Hint.** Compute true frequencies with a full hash map only for *testing* (allowed since it is offline validation).

**Expected Output:** "bound holds; no heavy hitter missed" with no assertion failures.

**Evaluation:** both halves of the bound checked; completeness checked.

### Task 5 — Choose `k` from a fraction

**Problem.** Write `kFromFraction(phi)` returning `⌈1/phi⌉`, and a wrapper that finds items above `phi · n` using Misra-Gries + verification.

**Constraints.** `0 < phi < 1`.

**Hint.** `phi = 0.01` → `k = 100` → 99 counters.

**Expected Output:** for `phi = 0.5` on `[2,2,1,1,2,2]`, returns `{2: 4}`.

**Evaluation:** correct `k` derivation; correct heavy-hitter result.

---

## Intermediate Tasks (5)

### Task 6 — Streaming interface (online updates)

**Problem.** Implement a `MisraGries` object with `add(x)` (online, one item at a time) and `candidates()` methods, so it can process an unbounded stream without holding it all.

**Constraints.** State is `O(k)`; `add` is `O(1)` amortized.

**Hint.** Track `n` as you add for later threshold computation.

**Expected Output:** feeding the sample stream item by item yields the same candidates as the batch version.

**Evaluation:** online correctness, bounded state.

### Task 7 — Merge two summaries

**Problem.** Implement `merge(s1, s2, k)`: add common counts, union keys, then if more than `k - 1` remain, subtract the `k`-th largest value from all and drop non-positives.

**Constraints.** Result has ≤ `k - 1` entries.

**Hint.** Sort the values descending; the element at index `k - 1` is the subtraction threshold.

**Expected Output:** merging `{X:5,Y:3}` and `{X:2,Z:4}` with `k = 3` keeps the dominant key(s) within 2 slots.

**Evaluation:** size bound respected; merged estimates still satisfy `f(x) - N/k ≤ est(x) ≤ f(x)` over the combined stream.

### Task 8 — Shard-then-merge driver

**Problem.** Split a stream into `m` shards, run an independent Misra-Gries per shard, then merge all summaries into a global one. Compare the result to a single-pass Misra-Gries over the concatenation.

**Constraints.** Shards are processed independently (simulate parallelism).

**Hint.** Merge is associative; any tree works.

**Expected Output:** the merged heavy set matches the single-pass heavy set on the same data.

**Evaluation:** merge equivalence; guarantee preserved.

### Task 9 — Tumbling-window heavy hitters

**Problem.** Process a stream in fixed-size windows; reset the summary each window and emit per-window candidates.

**Constraints.** `O(k)` state at any time.

**Hint.** Reset (or start a fresh instance) at each window boundary.

**Expected Output:** per-window candidate lists; a window dominated by one item reports that item.

**Evaluation:** correct windowing; bounded memory.

### Task 10 — Compare with Space-Saving

**Problem.** Implement a minimal Space-Saving (replace the minimum counter on overflow, assign `min + 1`) and compare its estimates with Misra-Gries on the same stream. Report which overcounts and which undercounts.

**Constraints.** Both use `k - 1` counters.

**Hint.** Track Space-Saving's estimate vs true frequency to confirm `est ≥ f`.

**Expected Output:** Misra-Gries estimates `≤ f`; Space-Saving estimates `≥ f`.

**Evaluation:** correct error directions demonstrated.

---

## Advanced Tasks (5)

### Task 11 — Thread-safe Misra-Gries

**Problem.** Wrap the summary with a lock so concurrent `add` calls are safe, then build a concurrent driver that feeds the stream from multiple workers.

**Constraints.** No data races; decrement-all is a single critical section.

**Hint.** Compare correctness against the single-threaded result on the same multiset.

**Expected Output:** concurrent run yields a summary consistent with the sequential one.

**Evaluation:** thread safety, correctness under concurrency.

### Task 12 — Tightness construction

**Problem.** Construct a stream (given `n`, `k`) that forces a target heavy item's estimate down to exactly `f(x) - ⌊n/k⌋`, demonstrating the bound is tight.

**Constraints.** The target must still be a true heavy hitter.

**Hint.** Interleave the target with `k - 1` distinct fillers and a fresh trigger each round so a decrement-all hits the target every cycle.

**Expected Output:** measured undercount equals `⌊n/k⌋`.

**Evaluation:** the construction achieves equality in the bound.

### Task 13 — Worst-case `O(1)` per item

**Problem.** Replace the `O(k)` decrement-all sweep with a linked-bucket structure (counts grouped into buckets) so increments and the overflow step are `O(1)` worst case.

**Constraints.** Same guarantees as the basic version.

**Hint.** This is the Stream-Summary structure used by Space-Saving; adapt it to Misra-Gries' decrement semantics or implement the equivalent global-offset trick (keep a base offset instead of decrementing every counter).

**Expected Output:** identical heavy set, faster worst-case updates.

**Evaluation:** correctness plus `O(1)` worst-case per item.

### Task 14 — Decay / sliding window

**Problem.** Add exponential decay: every `T` items, multiply all counts by `γ < 1` (rounding/dropping zeros). Discuss how the guarantee changes to weighted frequencies.

**Constraints.** Keep counts integer or fixed-point.

**Hint.** Decay makes "frequency" recency-weighted; document the new threshold semantics.

**Expected Output:** recent-dominant items rank above stale ones.

**Evaluation:** correct decay; recency reflected.

### Task 15 — Real-data heavy hitters (DDoS-style)

**Problem.** Given a large file of "IP" tokens (one per line, synthetic is fine), find IPs sending more than 0.1% of packets using Misra-Gries (`k = 1000`) + verification, and report them with exact counts.

**Constraints.** Do not load all distinct IPs into a hash map for the first pass; only the `≤ 999` candidates plus a verification pass.

**Hint.** Stream the file line by line.

**Expected Output:** the small set of top-talker IPs with exact counts above the 0.1% threshold.

**Evaluation:** bounded first-pass memory; exact final result.

---

## Benchmark Task

> Compare performance across all 3 languages. Measure first-pass time vs stream size with `k = 100`.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func misraGries(stream []int, k int) map[int]int {
	c := map[int]int{}
	for _, x := range stream {
		if _, ok := c[x]; ok {
			c[x]++
		} else if len(c) < k-1 {
			c[x] = 1
		} else {
			for key := range c {
				c[key]--
				if c[key] == 0 {
					delete(c, key)
				}
			}
		}
	}
	return c
}

func main() {
	for _, n := range []int{10000, 100000, 1000000} {
		stream := make([]int, n)
		for i := range stream {
			stream[i] = rand.Intn(5000)
		}
		start := time.Now()
		misraGries(stream, 100)
		fmt.Printf("n=%8d: %.1f ms\n", n, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    static Map<Integer,Integer> misraGries(int[] stream, int k) {
        Map<Integer,Integer> c = new HashMap<>();
        for (int x : stream) {
            if (c.containsKey(x)) c.put(x, c.get(x)+1);
            else if (c.size() < k-1) c.put(x, 1);
            else {
                var it = c.entrySet().iterator();
                while (it.hasNext()) {
                    var e = it.next();
                    if (e.getValue() == 1) it.remove(); else e.setValue(e.getValue()-1);
                }
            }
        }
        return c;
    }

    public static void main(String[] args) {
        Random rnd = new Random(1);
        for (int n : new int[]{10000, 100000, 1000000}) {
            int[] stream = new int[n];
            for (int i = 0; i < n; i++) stream[i] = rnd.nextInt(5000);
            long start = System.nanoTime();
            misraGries(stream, 100);
            System.out.printf("n=%8d: %.1f ms%n", n, (System.nanoTime()-start)/1e6);
        }
    }
}
```

#### Python

```python
import random, time


def misra_gries(stream, k):
    c = {}
    for x in stream:
        if x in c:
            c[x] += 1
        elif len(c) < k - 1:
            c[x] = 1
        else:
            for key in list(c):
                c[key] -= 1
                if c[key] == 0:
                    del c[key]
    return c


if __name__ == "__main__":
    for n in (10_000, 100_000, 1_000_000):
        stream = [random.randint(0, 4999) for _ in range(n)]
        t = time.perf_counter()
        misra_gries(stream, 100)
        print(f"n={n:>9}: {(time.perf_counter()-t)*1000:.1f} ms")
```

**Goal:** observe near-linear scaling in `n` (the first pass is `O(n)` amortized), and compare the constant factors across languages. Try raising `k` and the distinct-value range to see how decrement-all frequency affects runtime.

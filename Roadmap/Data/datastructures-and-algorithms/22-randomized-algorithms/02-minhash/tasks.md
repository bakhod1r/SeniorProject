# MinHash — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Validate every estimator against the **exact Jaccard** on small sets before trusting it at scale.

## Beginner Tasks

**Task 1:** Implement exact Jaccard similarity `J(A,B) = |A∩B| / |A∪B|` for two integer sets, with the convention `J(∅,∅) = 1`. This is your correctness oracle for every later task.

#### Go

```go
package main

import "fmt"

func exactJaccard(a, b []int) float64 {
	sa := map[int]bool{}
	for _, x := range a {
		sa[x] = true
	}
	inter, union := 0, map[int]bool{}
	for x := range sa {
		union[x] = true
	}
	sb := map[int]bool{}
	for _, x := range b {
		sb[x] = true
		union[x] = true
		if sa[x] {
			inter++
		}
	}
	if len(union) == 0 {
		return 1.0
	}
	return float64(inter) / float64(len(union))
}

func main() {
	fmt.Println(exactJaccard([]int{1, 2, 3, 4}, []int{2, 3, 5})) // 0.4
}
```

#### Java

```java
import java.util.*;

public class Task1 {
    static double exactJaccard(int[] a, int[] b) {
        Set<Integer> sa = new HashSet<>(), sb = new HashSet<>(), union = new HashSet<>();
        for (int x : a) { sa.add(x); union.add(x); }
        for (int x : b) { sb.add(x); union.add(x); }
        if (union.isEmpty()) return 1.0;
        int inter = 0;
        for (int x : sa) if (sb.contains(x)) inter++;
        return (double) inter / union.size();
    }

    public static void main(String[] args) {
        System.out.println(exactJaccard(new int[]{1,2,3,4}, new int[]{2,3,5})); // 0.4
    }
}
```

#### Python

```python
def exact_jaccard(a, b):
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / len(sa | sb)


if __name__ == "__main__":
    print(exact_jaccard([1, 2, 3, 4], [2, 3, 5]))  # 0.4
```

- **Constraints:** handle empty sets; deduplicate inputs.
- **Expected Output:** `0.4`
- **Evaluation:** correctness on disjoint, identical, empty, and overlapping sets.

**Task 2:** Implement a single MinHash value: given a set and one hash function `h(x) = (a·x + b) mod p`, return `min over x of h(x)`. Provide starter code in all 3 languages.
- Constraints: use a prime `p > 2^32`; reduce `x %= p` to avoid overflow.

**Task 3:** Build a length-`k` MinHash signature from `k` affine hash functions and estimate Jaccard as the fraction of agreeing slots. Verify against `exactJaccard` for `A={1,2,3,4}, B={2,3,5}` with `k=256`.
- Constraints: distinct random `(a_i, b_i)` per slot; the estimate must land within `±0.08` of `0.4`.

**Task 4:** Write a shingling function that turns a string into a set of integer feature-hashes using word `k`-grams (`k=3`). Confirm that two documents differing by one inserted word still share most shingles.
- Constraints: canonicalize (lowercase, collapse whitespace) before shingling.

**Task 5:** Empirically demonstrate the `1/√k` rule: for a fixed pair with known `J`, compute the MinHash estimate for `k ∈ {16, 64, 256, 1024}` averaged over many random seeds, and print the observed standard deviation. It should roughly halve each time `k` quadruples.

## Intermediate Tasks

**Task 6:** Implement the **bottom-k** (k-minimum-values) estimator: keep the `k` smallest distinct hash values of each set under one hash, then estimate Jaccard from the fraction of the `k` smallest *merged* values present in both. Provide starter code in all 3 languages.
- Constraints: one hash per element; compare accuracy to the k-hash estimator on the same pair.

**Task 7:** Extend bottom-k to also output a **cardinality estimate** `(k−1)/v_(k)`, where `v_(k)` is the k-th smallest hash normalized to `[0,1)`. Verify it approximates the true distinct count.

**Task 8:** Implement **one-permutation MinHash**: hash each element once, bin the range into `k` buckets, and take the per-bucket minimum. Detect empty bins and report how many occur for small sets.

**Task 9:** Add **densification** to Task 8: fill each empty bin by copying from the nearest non-empty bin (with a deterministic offset). Show that the densified estimate is unbiased on small sets where naive OPH was biased.

**Task 10:** Implement **LSH banding**: given many signatures, split each into `b` bands of `r` rows (`k=b·r`), bucket by band hash, and return all candidate pairs sharing a bucket. Verify that a high-Jaccard pair is reported and a disjoint pair usually is not.

## Advanced Tasks

**Task 11:** Plot (or print a table for) the **S-curve** `P[candidate] = 1 − (1 − J^r)^b` for several `(b, r)` with `b·r = 128`, and pick `(b, r)` whose threshold `(1/b)^{1/r}` is closest to `0.8`. Provide starter code in all 3 languages.
- Constraints: report the `(b,r)` choice and the resulting threshold.

**Task 12:** Build a small **near-duplicate detector** end to end: shingle a list of short documents, MinHash to signatures, LSH-band to candidates, then verify with exact Jaccard and report clusters with `J ≥ 0.7`.

**Task 13:** Implement **b-bit MinHash**: store only the low `b` bits of each slot and use the adjusted estimator that accounts for random low-bit agreement (`Ĵ = (observed_agreement − 2^{−b}) / (1 − 2^{−b})`). Compare its accuracy and memory to full-width MinHash.

**Task 14:** Make MinHash **streaming and mergeable**: maintain a running signature that updates in `O(k)` per element, and implement `merge(sigA, sigB)` as the slot-wise minimum. Verify `merge(sig(A), sig(B)) == sig(A ∪ B)`.

**Task 15:** Implement a **chooseK** helper using the Hoeffding bound `k ≥ ln(2/δ)/(2ε²)`, then run an experiment confirming that with that `k`, the fraction of estimates falling outside `±ε` of the true `J` is at most `δ` over many random pairs.

## Benchmark Task

> Compare signature-build performance across all 3 languages as `k` grows (`O(n·k)`).

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	elems := make([]uint64, 5000)
	for i := range elems {
		elems[i] = uint64(i*2654435761) & 0xFFFFFFFF
	}
	for _, k := range []int{32, 64, 128, 256, 512} {
		mh := New(k, 1) // your MinHash builder
		start := time.Now()
		for i := 0; i < 200; i++ {
			mh.Sign(elems)
		}
		fmt.Printf("k=%4d: %.3f ms/sig\n", k, float64(time.Since(start).Microseconds())/200000.0)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        long[] elems = new long[5000];
        for (int i = 0; i < elems.length; i++) elems[i] = ((long) i * 2654435761L) & 0xFFFFFFFFL;
        for (int k : new int[]{32, 64, 128, 256, 512}) {
            MinHashSig mh = new MinHashSig(k, 1); // your builder
            long start = System.nanoTime();
            for (int i = 0; i < 200; i++) mh.sign(elems);
            System.out.printf("k=%4d: %.3f ms/sig%n", k, (System.nanoTime() - start) / 200.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import timeit

elems = [(i * 2654435761) & 0xFFFFFFFF for i in range(5000)]
for k in [32, 64, 128, 256, 512]:
    mh = MinHashSig(k, 1)  # your builder
    t = timeit.timeit(lambda: mh.sign(elems), number=20)
    print(f"k={k:4d}: {t / 20 * 1000:.3f} ms/sig")
```

> **Expected:** build time grows linearly in `k`, confirming `O(n·k)`. This motivates bottom-k and one-permutation MinHash (one hash per element) when `k` is large.

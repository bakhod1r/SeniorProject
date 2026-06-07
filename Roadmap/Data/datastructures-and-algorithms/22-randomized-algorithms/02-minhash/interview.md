# MinHash — Interview Preparation

MinHash is a favourite interview topic because it rewards one crisp insight — *"a single random MinHash of two sets collides with probability exactly their Jaccard similarity, because the smallest element of `A∪B` is equally likely to be anywhere and a match happens iff it lands in `A∩B`"* — and then tests whether you can (a) build a `k`-slot signature and estimate Jaccard from slot agreement, (b) state the `O(1/√k)` error and pick `k` from a target accuracy, (c) compare the three schemes (k-hash, bottom-k, one-permutation) and contrast MinHash with SimHash, and (d) scale it with **LSH banding** to escape `O(N²)`. This file is a curated question bank by seniority, behavioral prompts, and four coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| How similar are two sets? | Jaccard `\|A∩B\|/\|A∪B\|` | exact: `O(\|A\|+\|B\|)` |
| Estimate Jaccard cheaply? | MinHash signature | build `O(n·k)`, compare `O(k)` |
| Why does a slot collide = Jaccard? | min of `A∪B` lands in `A∩B` | — |
| How accurate? | error ≈ `1/√k`, var `J(1−J)/k` | — |
| Pick `k` for `(ε, δ)`? | Hoeffding | `k ≥ ln(2/δ)/(2ε²)` |
| Avoid `O(N²)` all-pairs? | LSH banding `k=b·r` | `Pr[cand]=1−(1−J^r)^b` |
| Cheapest build? | one-permutation MinHash | `O(n+k)`, needs densification |
| Cosine instead of Jaccard? | SimHash | `Pr[bit agree]=1−θ/π` |

The estimator (the heart of everything):

```text
buildSignature(set, k hashes h_1..h_k):
    sig[i] = +inf for all i
    for x in set:
        for i in 1..k:
            sig[i] = min(sig[i], h_i(x))
    return sig

estimateJaccard(sigA, sigB):
    return (#{i : sigA[i] == sigB[i]}) / k    # unbiased, error ≈ 1/√k
```

Deterministic facts to recite:
- **Collision probability of one slot = Jaccard** (Broder's theorem).
- Estimator is **unbiased**; variance `J(1−J)/k`; SE `≤ 1/(2√k)`.
- Quadruple `k` to halve the error (square-root convergence).
- **LSH banding** turns signatures into sublinear candidate generation.

---

## Junior Questions (12 Q&A)

### J1. What problem does MinHash solve?
Estimating the **Jaccard similarity** of two sets quickly and with tiny, fixed-size memory, instead of storing the full sets and intersecting them.

### J2. What is Jaccard similarity?
`J(A,B) = |A∩B| / |A∪B|`, a number in `[0,1]`: `1` for identical sets, `0` for disjoint sets.

### J3. What is a MinHash of a set?
For one hash function `h`, it is `min over x in A of h(x)` — the smallest hash value among the set's elements.

### J4. What is the single key property?
`P[ minhash(A) == minhash(B) ] = Jaccard(A,B)`. One slot is a coin that comes up "match" with probability equal to the Jaccard.

### J5. Why is that probability the Jaccard?
The element of `A∪B` with the smallest hash is equally likely to be any element. The two minima are equal exactly when that smallest element lies in `A∩B`, which happens with probability `|A∩B|/|A∪B|`.

### J6. What is a signature?
The vector of `k` MinHash values, one per hash function. It summarizes a set in `k` numbers regardless of set size.

### J7. How do you estimate Jaccard from two signatures?
Count the slots where they hold equal values and divide by `k`: `estimate = matches / k`.

### J8. How accurate is the estimate?
The standard error is about `1/√k` (`≤ 1/(2√k)`). `k=100` ≈ ±0.05, `k=400` ≈ ±0.025.

### J9. What is the build cost vs the compare cost?
Build: `O(n·k)` (hash `n` elements with `k` functions). Compare: `O(k)`, independent of set size.

### J10. What are shingles?
Contiguous groups of `k` tokens; a document becomes the *set of its shingles* so text similarity becomes set similarity.

### J11. Why keep the minimum and not the maximum?
By symmetry the max works too, but min is conventional, cheap to maintain incrementally, and `min` is associative so signatures merge by slot-wise min.

### J12 (analysis). Why does averaging `k` slots help if one slot is just `0` or `1`?
Each slot is an independent `Bernoulli(J)` trial; their average is an unbiased estimate of `J` whose spread shrinks as `k` grows (law of large numbers), so more slots → tighter estimate.

---

## Middle Questions (12 Q&A)

### M1. Prove the estimator is unbiased.
`E[Ĵ] = E[(1/k)ΣX_i] = (1/k)ΣE[X_i] = (1/k)·k·J = J`, since each `E[X_i]=J` (the collision probability) and by linearity of expectation.

### M2. What is the variance of the estimator?
With independent hashes, `Var(Ĵ) = J(1−J)/k`, so the standard error is `√(J(1−J)/k) ≤ 1/(2√k)`.

### M3. How do you pick `k` for a guarantee, not just an average?
Hoeffding: `P[|Ĵ−J|≥ε] ≤ 2e^{−2kε²}`, so `k ≥ ln(2/δ)/(2ε²)` for confidence `1−δ` within `ε`. E.g. `ε=0.05, δ=0.01` → `k≈1060`.

### M4. Compare k-hash, bottom-k, and one-permutation MinHash.
k-hash: `k` hashes/element, `O(n·k)`, cleanest theory. Bottom-k: one hash, keep `k` smallest, `O(n log k)`, also gives cardinality. One-permutation: one hash + bin into `k` buckets, `O(n+k)`, needs densification for empty bins.

### M5. What is the empty-bin problem in one-permutation MinHash?
A small set may leave some buckets with no element, so that slot is undefined. Naive handling biases the estimate; **densification** copies from the nearest non-empty bin to restore unbiasedness.

### M6. Why must the `k` hash functions be independent?
Independence makes the slots independent `Bernoulli(J)` trials so the variance is `J(1−J)/k`. Correlated hashes (e.g. reusing `(a,b)`) add positive covariance — the estimate stays unbiased but converges slower than `1/√k`.

### M7. What is b-bit MinHash?
Store only the low `b` bits of each slot. Shrinks signatures (e.g. `b=1` → 1 bit/slot, ~64× smaller) at a small, quantifiable accuracy cost; the estimator is adjusted for random low-bit agreement.

### M8. How does MinHash differ from SimHash?
MinHash estimates **Jaccard** of sets (collision = `J`). SimHash estimates **cosine** of vectors (bit agreement = `1 − θ/π`). Different metrics → not interchangeable.

### M9. How does LSH banding use signatures?
Split the `k` slots into `b` bands of `r` rows. Hash each band; two signatures sharing any band bucket are candidates. `P[candidate] = 1 − (1−J^r)^b`, an S-curve in `J`.

### M10. What does increasing `r` vs `b` do to the S-curve?
More rows `r` raises the threshold (precision: fewer false candidates). More bands `b` lowers it (recall: catch more true pairs). With `k=b·r` fixed, `(b,r)` slides the threshold.

### M11. Why does Jaccard ignore duplicates but cosine does not?
Jaccard is over **sets** (distinct elements), so element multiplicity does not matter. Cosine is over **vectors/multisets**, where counts/weights matter — hence SimHash, not MinHash, for weighted vectors.

### M12 (analysis). Where is MinHash most and least accurate?
`Var = J(1−J)/k` is maximized at `J=0.5` and minimized near `J∈{0,1}` — so MinHash is *most* precise on the very-similar and very-dissimilar pairs that dedup actually cares about.

---

## Senior Questions (10 Q&A)

### S1. Design near-duplicate detection over a billion documents.
Pipeline: shingle → MinHash signature → LSH band index → candidate pairs → verify. LSH banding escapes `O(N²)`; tune `(b,r)` for the recall/precision SLA; budget memory with 32-bit or b-bit signatures; build with one-permutation MinHash for throughput.

### S2. How do you choose the hash family?
Hash each element once with a strong non-cryptographic hash (xxHash/Murmur) for good mixing, then derive `k` affine values or bin for OPH. Use a **keyed** hash (SipHash) for adversarial inputs so attackers can't engineer evasions.

### S3. How do you fit `10⁹` signatures in memory?
`k=128` at 8 B/slot is ~1 TB. Levers: 32-bit slots (0.5 TB), b-bit MinHash (tens of GB), tiered storage, cold-bucket eviction. Choose width from the corpus size and the accuracy SLA.

### S4. How do you make MinHash distributed/streaming?
`min` is associative and commutative, so `sig(A∪B) = slotwise min(sig(A), sig(B))`. Map-reduce: emit partial signatures, reduce by slot-wise min. Streaming: fold each element into the running signature in `O(k)`.

### S5. What are the main failure modes at scale?
Hot LSH buckets from boilerplate (strip it, cap bucket size), low recall (more bands, higher `k`), low precision (more rows, stronger verify), empty-bin bias (densify), tokenizer drift (version the pipeline), memory exhaustion (b-bit).

### S6. How do you tune the LSH S-curve to a target threshold `t`?
Pick `(b,r)` with `b·r=k` and `(1/b)^{1/r} ≈ t`. Put the steep part of the curve just below the true cutoff; verify recall/precision against a labeled golden set and adjust.

### S7. How do you verify a MinHash implementation?
Cross-check estimates against exact Jaccard on small sets (mean over many trials should hit `J`), check unbiasedness empirically, test empty/identical/disjoint sets, and confirm variance scales as `J(1−J)/k`.

### S8. When is bottom-k preferable to k-hash?
When the `O(n·k)` build cost dominates and you also want a **cardinality** estimate for free — bottom-k uses one hash per element and the same `k` smallest values give both Jaccard and distinct-count.

### S9. When is MinHash the wrong tool?
When the metric isn't Jaccard (cosine → SimHash; edit distance → string algorithms), when sets are small enough for exact comparison, or when you need zero error. MinHash gives an *estimate* of *set overlap*.

### S10 (analysis). Why doesn't a signature alone solve the scaling problem?
Comparing two signatures is `O(k)`, but comparing *all pairs* is still `O(N²·k)`. LSH banding is what makes candidate generation sublinear; MinHash is only the signature source.

---

## Professional / Theory Questions (8 Q&A)

### P1. State and prove Broder's collision theorem.
`P[h_min(A)=h_min(B)] = J`. Let `e*` be the minimizer of `A∪B`; by min-wise independence it's uniform over the union. The minima coincide iff `e*∈A∩B` (then it's the min of both; otherwise it's in exactly one and the other's min is strictly larger). So the probability is `|A∩B|/|A∪B| = J`.

### P2. What is min-wise independence and why does it matter?
A hash family is min-wise independent if every element of any set `S` is equally likely to be the minimum. It's the exact assumption Broder's theorem needs. Exact min-wise families need `Ω(|U|)` bits, so we use approximate families (strong hashes), incurring bias `≤ ε`.

### P3. Derive the variance and the `1/√k` rule.
Each `X_i ∼ Bernoulli(J)`, `Var(X_i)=J(1−J)`. Independent → `Var(Ĵ)=J(1−J)/k`. Since `J(1−J)≤1/4`, `SE ≤ 1/(2√k)`: error ∝ `1/√k`, so halving error needs 4× `k`.

### P4. Give a Chernoff/Hoeffding bound on `k`.
`Ĵ` is an average of `k` independent `[0,1]` variables, so Hoeffding gives `P[|Ĵ−J|≥ε] ≤ 2e^{−2kε²}`, hence `k ≥ ln(2/δ)/(2ε²)`. Multiplicative Chernoff `P[Y≥(1+γ)μ]≤e^{−μγ²/3}` sharpens the small-`J` regime.

### P5. How does the affine 2-universal family differ from the idealized model?
Affine `((ax+b) mod p) mod M` is only pairwise independent, so the minimum's distribution is only approximately uniform and slots may carry mild correlation; bias is `O(1/M)`. The clean `Bernoulli(J)` analysis assumes full randomness — validate variance empirically when correctness is critical.

### P6. Prove the LSH S-curve formula.
Per-slot agreement `J`. A band of `r` rows matches with prob `J^r`; `b` independent bands → `P[no band matches]=(1−J^r)^b`; candidate prob `=1−(1−J^r)^b`. Threshold ≈ `(1/b)^{1/r}`.

### P7. Why are MinHash and SimHash not interchangeable?
They are LSH families for *different* metrics: MinHash collision `=J` (Jaccard), SimHash bit-agreement `=1−θ/π` (cosine). Duplicating an element changes cosine but not Jaccard, so no sketch can serve both.

### P8 (analysis). Show bottom-k is unbiased and also estimates cardinality.
The `k` smallest hashes of `A∪B` are `k` uniform random elements; each lies in `A∩B` with prob `≈J`, so the count is `≈Binomial(k,J)` → mean `kJ`, dividing by `k` is unbiased. Separately, if `v_(k)` is the normalized k-th smallest hash, `(k−1)/v_(k)` is an unbiased estimate of `|A|`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing an `O(N²)` similarity job with something scalable.
Look for: a dedup/recommendation workload where pairwise comparison was the bottleneck, the switch to MinHash signatures + LSH banding, how `(b,r)` and `k` were tuned to a recall/precision SLA, and validation against exact Jaccard plus a labeled golden set.

### B2. A teammate's dedup misses obvious duplicates. How do you debug?
Likely low recall in LSH: the S-curve threshold is too high. Check `(b,r)` (add bands, reduce rows), raise `k`, verify shingling canonicalization (tokenizer drift splits shingles), and measure recall on a golden set before/after.

### B3. Design a plagiarism checker.
Shingle each document (char or word n-grams), MinHash to signatures, LSH-band to find candidate overlaps, verify with exact or full-signature Jaccard, and report overlapping passages. Discuss shingle size (recall vs precision) and threshold tuning.

### B4. Explain MinHash to a junior engineer.
Use the recipe analogy: a set is a bag of ingredients; "which combined ingredient is alphabetically first" is one quick question; if it's in both recipes, both answer the same — and that happens with probability equal to their overlap. Ask `k` scrambled versions and count agreements. Lead with the two gotchas: use enough independent hashes, and band with LSH to scale.

### B5. Your dedup service uses too much memory/CPU. How do you investigate?
Memory: are signatures 64-bit where 32-bit or b-bit would do? CPU: is build using `k` heavy hashes instead of one-permutation MinHash? Are hot LSH buckets (boilerplate) generating huge candidate sets? Fixes: b-bit signatures, OPH build, boilerplate stripping, bucket caps, minimal `(b,r)`.

---

## Coding Challenges

### Challenge 1: MinHash signature + Jaccard estimate

**Problem.** Implement `signature(set)` (length `k`) and `estimate(sigA, sigB)`. Use `k` affine hash functions over a large prime.

**Example.**
```text
A = {1,2,3,4}, B = {2,3,5}, true J = 0.4
With k=256, estimate ≈ 0.4 (±0.06)
```

**Constraints.** Elements are 64-bit ints; `1 ≤ k ≤ 4096`.

**Optimal.** Build `O(n·k)`, compare `O(k)`.

**Go.**
```go
package main

import "fmt"

const prime uint64 = 4294967311

type MH struct{ a, b []uint64; k int }

func New(k int, seed uint64) *MH {
	m := &MH{k: k, a: make([]uint64, k), b: make([]uint64, k)}
	r := seed | 1
	nx := func() uint64 { r ^= r << 13; r ^= r >> 7; r ^= r << 17; return r }
	for i := 0; i < k; i++ {
		m.a[i] = nx()%(prime-1) + 1
		m.b[i] = nx() % prime
	}
	return m
}

func (m *MH) Sign(s []uint64) []uint64 {
	sig := make([]uint64, m.k)
	for i := range sig {
		sig[i] = ^uint64(0)
	}
	for _, x := range s {
		for i := 0; i < m.k; i++ {
			if h := (m.a[i]*x + m.b[i]) % prime; h < sig[i] {
				sig[i] = h
			}
		}
	}
	return sig
}

func Estimate(s1, s2 []uint64) float64 {
	c := 0
	for i := range s1 {
		if s1[i] == s2[i] {
			c++
		}
	}
	return float64(c) / float64(len(s1))
}

func main() {
	m := New(256, 7)
	fmt.Printf("%.3f\n", Estimate(m.Sign([]uint64{1, 2, 3, 4}), m.Sign([]uint64{2, 3, 5}))) // ~0.4
}
```

**Java.**
```java
import java.util.*;

public class MinHashSig {
    static final long P = 4294967311L;
    final long[] a, b; final int k;

    MinHashSig(int k, long seed) {
        this.k = k; a = new long[k]; b = new long[k];
        long r = seed | 1;
        for (int i = 0; i < k; i++) {
            r ^= r << 13; r ^= r >>> 7; r ^= r << 17; a[i] = Math.floorMod(r, P - 1) + 1;
            r ^= r << 13; r ^= r >>> 7; r ^= r << 17; b[i] = Math.floorMod(r, P);
        }
    }

    long[] sign(long[] s) {
        long[] sig = new long[k]; Arrays.fill(sig, Long.MAX_VALUE);
        for (long x : s)
            for (int i = 0; i < k; i++) {
                long h = Math.floorMod(a[i] * x + b[i], P);
                if (h < sig[i]) sig[i] = h;
            }
        return sig;
    }

    static double estimate(long[] s1, long[] s2) {
        int c = 0;
        for (int i = 0; i < s1.length; i++) if (s1[i] == s2[i]) c++;
        return (double) c / s1.length;
    }

    public static void main(String[] args) {
        MinHashSig m = new MinHashSig(256, 7);
        System.out.printf("%.3f%n", estimate(m.sign(new long[]{1,2,3,4}), m.sign(new long[]{2,3,5})));
    }
}
```

**Python.**
```python
import random

P = 4294967311


class MinHashSig:
    def __init__(self, k, seed=7):
        rng = random.Random(seed)
        self.k = k
        self.a = [rng.randrange(1, P) for _ in range(k)]
        self.b = [rng.randrange(0, P) for _ in range(k)]

    def sign(self, s):
        sig = [float("inf")] * self.k
        for x in s:
            for i in range(self.k):
                h = (self.a[i] * x + self.b[i]) % P
                if h < sig[i]:
                    sig[i] = h
        return sig


def estimate(s1, s2):
    return sum(1 for u, v in zip(s1, s2) if u == v) / len(s1)


if __name__ == "__main__":
    m = MinHashSig(256)
    print(f"{estimate(m.sign([1,2,3,4]), m.sign([2,3,5])):.3f}")  # ~0.4
```

---

### Challenge 2: Bottom-k estimator (one hash)

**Problem.** Implement `bottomK(set, k)` keeping the `k` smallest hash values, and `estimateBottomK(b1, b2, k)` returning the fraction of the `k` smallest merged values present in both.

**Example.**
```text
A={1..8}, B={3..10}, true J = 6/10 = 0.6
estimateBottomK with k=8 ≈ 0.6
```

**Constraints.** `1 ≤ k ≤ |set|`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

const pr uint64 = 4294967311

func bottomK(s []uint64, k int, a, b uint64) []uint64 {
	seen := map[uint64]bool{}
	var v []uint64
	for _, x := range s {
		h := (a*x + b) % pr
		if !seen[h] {
			seen[h] = true
			v = append(v, h)
		}
	}
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	if len(v) > k {
		v = v[:k]
	}
	return v
}

func estimateBottomK(b1, b2 []uint64, k int) float64 {
	set := func(x []uint64) map[uint64]bool {
		m := map[uint64]bool{}
		for _, v := range x {
			m[v] = true
		}
		return m
	}
	s1, s2 := set(b1), set(b2)
	merged := append(append([]uint64{}, b1...), b2...)
	sort.Slice(merged, func(i, j int) bool { return merged[i] < merged[j] })
	uniq := merged[:0]
	prev := ^uint64(0)
	for _, x := range merged {
		if x != prev {
			uniq = append(uniq, x)
			prev = x
		}
	}
	if len(uniq) > k {
		uniq = uniq[:k]
	}
	both := 0
	for _, v := range uniq {
		if s1[v] && s2[v] {
			both++
		}
	}
	return float64(both) / float64(len(uniq))
}

func main() {
	A := []uint64{1, 2, 3, 4, 5, 6, 7, 8}
	B := []uint64{3, 4, 5, 6, 7, 8, 9, 10}
	b1 := bottomK(A, 8, 2654435761, 12345)
	b2 := bottomK(B, 8, 2654435761, 12345)
	fmt.Printf("%.3f\n", estimateBottomK(b1, b2, 8)) // ~0.6
}
```

**Java.**
```java
import java.util.*;

public class BottomK {
    static final long P = 4294967311L;

    static long[] bottomK(long[] s, int k, long a, long b) {
        TreeSet<Long> v = new TreeSet<>();
        for (long x : s) v.add(Math.floorMod(a * x + b, P));
        long[] out = new long[Math.min(k, v.size())];
        int i = 0;
        for (long h : v) { if (i == out.length) break; out[i++] = h; }
        return out;
    }

    static double estimate(long[] b1, long[] b2, int k) {
        Set<Long> s1 = new HashSet<>(), s2 = new HashSet<>();
        for (long x : b1) s1.add(x);
        for (long x : b2) s2.add(x);
        TreeSet<Long> merged = new TreeSet<>(s1); merged.addAll(s2);
        int both = 0, count = 0;
        for (long v : merged) {
            if (count++ == k) break;
            if (s1.contains(v) && s2.contains(v)) both++;
        }
        return (double) both / Math.min(k, merged.size());
    }

    public static void main(String[] args) {
        long[] A = {1,2,3,4,5,6,7,8}, B = {3,4,5,6,7,8,9,10};
        System.out.printf("%.3f%n", estimate(bottomK(A,8,2654435761L,12345), bottomK(B,8,2654435761L,12345), 8));
    }
}
```

**Python.**
```python
P = 4294967311


def bottom_k(s, k, a, b):
    return sorted({(a * x + b) % P for x in s})[:k]


def estimate_bottom_k(b1, b2, k):
    s1, s2 = set(b1), set(b2)
    merged = sorted(s1 | s2)[:k]
    both = sum(1 for v in merged if v in s1 and v in s2)
    return both / len(merged)


if __name__ == "__main__":
    A = list(range(1, 9))
    B = list(range(3, 11))
    b1 = bottom_k(A, 8, 2654435761, 12345)
    b2 = bottom_k(B, 8, 2654435761, 12345)
    print(f"{estimate_bottom_k(b1, b2, 8):.3f}")  # ~0.6
```

---

### Challenge 3: LSH banding — find candidate near-duplicate pairs

**Problem.** Given signatures for many documents, split each into `b` bands of `r` rows and return all pairs that share at least one band bucket.

**Example.**
```text
docs with high Jaccard end up as candidate pairs; dissimilar docs usually don't.
```

**Constraints.** `k = b·r`.

**Go.**
```go
package main

import "fmt"

func bandKey(sig []uint64, bnd, rows int) uint64 {
	var h uint64 = 1469598103934665603
	for r := 0; r < rows; r++ {
		h = (h ^ sig[bnd*rows+r]) * 1099511628211
	}
	return (h ^ uint64(bnd)) * 1099511628211
}

func candidatePairs(sigs map[string][]uint64, bands, rows int) [][2]string {
	buckets := map[uint64][]string{}
	for id, sig := range sigs {
		for bnd := 0; bnd < bands; bnd++ {
			k := bandKey(sig, bnd, rows)
			buckets[k] = append(buckets[k], id)
		}
	}
	pairSet := map[[2]string]bool{}
	for _, ids := range buckets {
		for i := 0; i < len(ids); i++ {
			for j := i + 1; j < len(ids); j++ {
				a, b := ids[i], ids[j]
				if a > b {
					a, b = b, a
				}
				pairSet[[2]string{a, b}] = true
			}
		}
	}
	var out [][2]string
	for p := range pairSet {
		out = append(out, p)
	}
	return out
}

func main() {
	sigs := map[string][]uint64{
		"d1": {1, 2, 3, 4},
		"d2": {1, 2, 9, 9}, // shares band 0 with d1
		"d3": {7, 8, 7, 8},
	}
	fmt.Println(candidatePairs(sigs, 2, 2))
}
```

**Java.**
```java
import java.util.*;

public class LSHBanding {
    static long bandKey(long[] sig, int bnd, int rows) {
        long h = 1469598103934665603L;
        for (int r = 0; r < rows; r++) h = (h ^ sig[bnd * rows + r]) * 1099511628211L;
        return (h ^ bnd) * 1099511628211L;
    }

    static Set<String> candidatePairs(Map<String, long[]> sigs, int bands, int rows) {
        Map<Long, List<String>> buckets = new HashMap<>();
        for (var e : sigs.entrySet())
            for (int bnd = 0; bnd < bands; bnd++)
                buckets.computeIfAbsent(bandKey(e.getValue(), bnd, rows), x -> new ArrayList<>()).add(e.getKey());
        Set<String> pairs = new HashSet<>();
        for (List<String> ids : buckets.values())
            for (int i = 0; i < ids.size(); i++)
                for (int j = i + 1; j < ids.size(); j++) {
                    String a = ids.get(i), b = ids.get(j);
                    pairs.add(a.compareTo(b) < 0 ? a + "," + b : b + "," + a);
                }
        return pairs;
    }

    public static void main(String[] args) {
        Map<String, long[]> sigs = new HashMap<>();
        sigs.put("d1", new long[]{1, 2, 3, 4});
        sigs.put("d2", new long[]{1, 2, 9, 9});
        sigs.put("d3", new long[]{7, 8, 7, 8});
        System.out.println(candidatePairs(sigs, 2, 2));
    }
}
```

**Python.**
```python
def band_key(sig, bnd, rows):
    h = 1469598103934665603
    mask = (1 << 64) - 1
    for r in range(rows):
        h = ((h ^ int(sig[bnd * rows + r])) * 1099511628211) & mask
    return ((h ^ bnd) * 1099511628211) & mask


def candidate_pairs(sigs, bands, rows):
    buckets = {}
    for doc_id, sig in sigs.items():
        for bnd in range(bands):
            buckets.setdefault(band_key(sig, bnd, rows), []).append(doc_id)
    pairs = set()
    for ids in buckets.values():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pairs.add(tuple(sorted((ids[i], ids[j]))))
    return pairs


if __name__ == "__main__":
    sigs = {"d1": [1, 2, 3, 4], "d2": [1, 2, 9, 9], "d3": [7, 8, 7, 8]}
    print(candidate_pairs(sigs, 2, 2))  # {('d1', 'd2')}
```

---

### Challenge 4: Pick k from an accuracy target

**Problem.** Given target error `ε` and confidence `1−δ`, return the minimum `k` via Hoeffding (`k ≥ ln(2/δ)/(2ε²)`).

**Example.**
```text
chooseK(0.05, 0.01) -> 1060
chooseK(0.10, 0.05) -> 185
```

**Go.**
```go
import "math"

func chooseK(eps, delta float64) int {
	return int(math.Ceil(math.Log(2/delta) / (2 * eps * eps)))
}
// chooseK(0.05, 0.01) -> 1060
```

**Java.**
```java
static int chooseK(double eps, double delta) {
    return (int) Math.ceil(Math.log(2 / delta) / (2 * eps * eps));
}
// chooseK(0.05, 0.01) -> 1060
```

**Python.**
```python
import math

def choose_k(eps, delta):
    return math.ceil(math.log(2 / delta) / (2 * eps * eps))

# choose_k(0.05, 0.01) -> 1060
```

---

## Final Tips

- Lead with the one-liner: *"One MinHash slot collides with probability exactly the Jaccard, because the smallest element of `A∪B` is uniform and a match means it fell in `A∩B`; average `k` slots for an unbiased estimate with error `≈ 1/√k`."*
- Immediately flag the gotchas: **use enough independent hashes** (error is `1/√k`, so quadruple `k` to halve error), and **band with LSH** to escape `O(N²)` all-pairs.
- Name the variants: **k-hash** (clean), **bottom-k** (one hash + cardinality), **one-permutation + densification** (fastest build).
- Contrast with **SimHash**: MinHash = Jaccard of sets; SimHash = cosine of vectors; pick the sketch by the metric.
- Offer to validate against **exact Jaccard** on small sets and to tune the **LSH S-curve** `1−(1−J^r)^b` against a labeled golden set.

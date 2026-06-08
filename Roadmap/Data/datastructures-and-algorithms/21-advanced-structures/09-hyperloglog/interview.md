# HyperLogLog — Interview Preparation

HyperLogLog is a favourite interview topic because it rewards one crisp insight — *"a hash with `k` leading zeros appears about once per `2^k` distinct items, so the longest leading-zero run estimates the cardinality; split into many registers and combine with the harmonic mean to kill the noise"* — and then tests whether you can (a) explain why leading zeros measure cardinality, (b) describe the register scheme and the harmonic-mean estimator, (c) state the `1.04/√m` error and the corrections (linear counting), (d) reason about **mergeability** and the **intersection caveat**, and (e) place HLL among the exact set, linear counting, KMV/MinHash, and Redis `PFCOUNT`. This file is a curated question bank by seniority, behavioral prompts, and end-to-end coding challenges in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Note |
|----------|--------|------|
| What does HLL estimate? | **cardinality** (distinct count) | not membership |
| Memory | `O(m)` fixed, ~12 KB for `p=14` | independent of `n` |
| Error | `≈ 1.04/√m` | ~0.8% at `m=16384` |
| `add` / `count` / `merge` | O(1) / O(m) / O(m) | streaming-friendly |
| Register value | `max(1 + leading zeros)` per bucket | top `p` bits pick the bucket |
| Combine registers | harmonic mean: `alpha_m·m²/Σ2^{-M[j]}` | tames outliers |
| Small-count fix | linear counting `m·ln(m/V)` | `V` = empty registers |
| Union | register-wise **max** | exact w.r.t. the union |
| Intersection | **not directly** | inclusion-exclusion amplifies error |

Core algorithm:

```text
add(item):  x = hash64(item); idx = x >> (64-p); r = 1 + leadingZeros(rest)
            M[idx] = max(M[idx], r)
count():    Z = Σ 2^{-M[j]}; E = alpha_m·m²/Z
            if E small and zeros>0: E = m·ln(m/zeros)   # linear counting
            return E
merge(A,B): M[j] = max(A[j], B[j])
```

Key facts:
- **Leading zeros are rare in proportion to `2^k`** — that is why the max run measures the count.
- **Harmonic mean**, not arithmetic — bounded `2^{-M[j]}` so no register dominates.
- Error `1.04/√m` is **independent of `n`**; halving it **quadruples** memory.
- HLL is **mergeable** (union) but cannot **intersect** directly.

---

## Junior Questions (12 Q&A)

### J1. What problem does HyperLogLog solve?
It estimates the **cardinality** — the number of *distinct* elements — of a stream or set, using a tiny, fixed amount of memory (e.g. ~12 KB) instead of storing every distinct item.

### J2. Why not just use a hash set?
A set is exact but uses memory **proportional to the number of distinct items** (`O(n)`). For billions of items, or thousands of separate counters, that does not fit. HLL uses fixed memory regardless of `n`, trading ~1% error for a huge memory saving.

### J3. What is the core idea behind HLL?
Hash each item to random-looking bits and look at the **leading zeros**. A hash starting with `k` zeros appears about once every `2^k` items, so the **longest** leading-zero run you have seen estimates how many distinct items there were (`~2^k`).

### J4. What is a register and how many are there?
A register is a small counter. HLL keeps `m = 2^p` of them. The first `p` bits of an item's hash pick which register; the remaining bits give the rank (`1 + leading zeros`). Each register stores the **maximum** rank routed to it.

### J5. What is the "rank" of an item?
`rank = 1 + (number of leading zeros)` in the part of the hash used for counting. Example: tail `001011…` has 2 leading zeros, so rank 3.

### J6. Why store the maximum rank per register, not the sum or count?
Because the *maximum* leading-zero run is what tracks `log2` of the count. Adding the same item again gives the same hash and the same rank, so the max does not change — that is why HLL counts *distinct* items (duplicates are idempotent).

### J7. What is the typical error of HLL?
About `1.04/√m`. With `m = 16384` registers, that is roughly **0.8%**, using ~12 KB.

### J8. Does the error grow as you add more items?
No. The relative error depends only on `m` (the number of registers), **not on `n`**. The same 12 KB gives ~0.8% error whether you count a thousand or a billion items.

### J9. Why does HLL use many registers instead of one counter?
One counter's estimate is extremely noisy (a single lucky hash with many leading zeros fools it). Splitting into `m` registers and averaging gives `m` independent estimates whose noise cancels, shrinking the error like `1/√m`.

### J10. How do you combine the registers into an estimate?
With the **harmonic-mean** formula: `estimate = alpha_m · m² / Σ_j 2^{-M[j]}`, where `M[j]` is register `j` and `alpha_m` is a bias constant. When many registers are empty, switch to **linear counting** `m·ln(m/V)`.

### J11. Can HLL list the distinct items it counted?
No. It only estimates *how many* there are; it never stores the items, so it cannot enumerate them.

### J12. Give one real use of HLL.
Counting **distinct users / unique IPs / unique queries** at scale — e.g. Redis `PFADD`/`PFCOUNT`, or a database's `APPROX_COUNT_DISTINCT`.

---

## Middle Questions (12 Q&A)

### M1. Why the harmonic mean and not the arithmetic mean?
The per-register values `2^{M[j]}` have a heavy upper tail; the arithmetic mean is dominated by the single largest register and is noisy. The harmonic mean uses `2^{-M[j]} ∈ [0,1]`, which is bounded, so a freak large register contributes ≈0 and cannot blow up the estimate — giving error `1.04/√m` versus LogLog's `1.30/√m`.

### M2. What is `alpha_m` and why is it there?
A bias-correction constant (`≈ 0.7213/(1+1.079/m)`, → `1/(2 ln 2) ≈ 0.7213`). The raw harmonic-mean estimator is biased; `alpha_m` makes it unbiased in the mid-cardinality range.

### M3. When and why does HLL use linear counting?
In the **low-cardinality** range, many registers are still empty and the harmonic formula is biased high. Linear counting uses the number of empty registers `V`: since `E[V] = m·e^{-n/m}`, inverting gives `n̂ = m·ln(m/V)`. HLL switches to it when the raw estimate is small and `V > 0`.

### M4. What is the large-range correction and when do you need it?
For a **32-bit** hash, registers saturate / collide as `n` approaches `2^32`, biasing the estimate; the correction is `E* = -2^32·ln(1 - E/2^32)`. With a **64-bit** hash (HLL++) saturation is unreachable, so the correction is dropped.

### M5. What makes two HLLs mergeable?
Same `p` and same hash. Then `merged[j] = max(A[j], B[j])` for every register gives **exactly** the HLL of the union stream — because each register holds a max, and max over a union is the max of the per-stream maxes.

### M6. Why is mergeability such a big deal?
It enables distributed and roll-up counting: each shard keeps a local HLL, and you `OR` (register-max) them to get the global distinct count — no shipping raw data, order-independent, embarrassingly parallel. Hourly sketches merge into daily without double-counting repeats.

### M7. Why can't HLL compute intersections directly?
A register stores the *depth* of the rarest item that hit it, not *which* items are present, so no register operation recovers shared membership. The only route is inclusion-exclusion `|A∩B| = |A|+|B|-|A∪B|`, which subtracts three noisy estimates and amplifies error badly when the overlap is small.

### M8. How do you pick `p`?
From the error budget: `error ≈ 1.04/√(2^p)`. `p=14` → ~0.8% (~12 KB) is the default; `p=16` → ~0.4% (~48 KB). Halving error quadruples memory.

### M9. HLL vs linear counting — when each?
Linear counting is more accurate for **small/medium** `n` but needs a bitmap sized to `~n` (no fixed-memory-at-any-scale). HLL has fixed memory for any cardinality. HLL actually *borrows* linear counting for its own low range, getting the best of both.

### M10. HLL vs KMV/bottom-`k`?
KMV keeps the `k` smallest hashes; error `≈ 1/√k`, mergeable, and — unlike HLL — supports **intersections** (recover the union's `k`-min sample). HLL is smaller per accuracy but union-only. Choose KMV/MinHash when you need set operations.

### M11. What happens if you use a weak hash?
The leading-zero probability argument relies on uniform random bits. A biased/non-uniform hash skews the ranks and the estimate becomes unreliable. Use a hash with good avalanche (xxHash, Murmur).

### M12. Why might HLL over-count if you feed it event records?
If you hash per-event noise (timestamps, request ids) instead of the stable identity (user id), every event looks distinct and the cardinality explodes far above the true distinct-user count.

---

## Senior Questions (10 Q&A)

### S1. What is HLL++ and what does it add over classic HLL?
Google's practical improvements: (1) a **64-bit hash** (removes the large-range correction), (2) **empirical bias correction** (a measured bias lookup table smoothing the low/mid-range), and (3) a **sparse representation** (high precision `p'`, a few bytes per touched register) that makes millions of small counters affordable, folding down to dense `p` when it grows.

### S2. Why is the sparse representation important at scale?
Analytics fleets have **millions** of mostly-tiny counters (one per page/country/hour). Classic HLL allocates the full `m`-register array (12 KB) for each, even a 3-item key. Sparse mode stores only nonzero registers (bytes), capping the worst case at 12 KB only for the large keys.

### S3. How does Redis implement HLL?
`p=14` (`m=16384`), 6-bit dense registers (12 KB), plus a sparse encoding for small keys. Commands: `PFADD`, `PFCOUNT` (single key or **union** of several), `PFMERGE`. Stated error ~0.81%.

### S4. How does a data warehouse use HLL for COUNT DISTINCT?
`APPROX_COUNT_DISTINCT` / `approx_distinct` compute per-partition HLL sketches in a single pass, then **merge** them (register-max) to get the global distinct count — something exact `COUNT DISTINCT` cannot do cheaply across a distributed table. Some systems expose the sketch as a storable value (BigQuery `HLL_COUNT.*`, Postgres `hll`).

### S5. What is the merge-compatibility landmine?
Two sketches merge correctly only if they share the **same `p`, same hash (algorithm + seed), and bit layout**. Mismatches merge silently wrong. Mitigation: embed `p` + hash/format version in the serialized header and reject mismatches; optionally **fold** a higher-`p` sketch down to a common `p`.

### S6. What is folding?
Downgrading a sketch's precision from `p'` to `p < p'` by taking, for each low-precision register, the max (rank-adjusted) over the source registers that share its top `p` index bits. It is lossy and one-directional (cannot upgrade). Used to standardize heterogeneous sketches before union.

### S7. Memory/accuracy budget — give the headline numbers.
`error ≈ 1.04/√m`. `p=12`→~1.6% (~3 KB); `p=14`→~0.8% (~12 KB); `p=16`→~0.4% (~48 KB). The line to memorize: **~12 KB ≈ 0.8% error for cardinalities into the billions**, independent of `n`.

### S8. If a stakeholder wants "users who did A AND B" at scale, what do you use?
**Not** HLL inclusion-exclusion (amplifies error for small overlaps). Use **MinHash** (Jaccard/overlap), **KMV/bottom-`k`**, or **Theta sketches** (DataSketches — support union, intersection, and difference with error bounds).

### S9. Why is an HLL register array a CRDT?
Registers form a join-semilattice under `max` (grow-only, idempotent, commutative, associative). So replicas can merge in any order under eventual consistency and converge to the same state — ideal for multi-datacenter unique counting.

### S10. What invariant must `add` and `merge` preserve?
Registers only ever **increase** (max-with). Any code path that lowers a register corrupts the monotone invariant and the estimate. Both `add` and `merge` are strict `max` operations.

---

## Professional Questions (8 Q&A)

### P1. Derive why the maximum leading-zero run estimates `log2 n`.
`Pr[ρ ≥ k] = 2^{-(k-1)}`. With `n` items, `Pr[max ρ < k] = (1 - 2^{-(k-1)})^n ≈ e^{-n·2^{-(k-1)}}`. This jumps from ≈0 to ≈1 sharply around `k ≈ log2 n`: for `k ≪ log2 n` some item almost surely reaches rank `k`, for `k ≫ log2 n` almost surely none does. Hence `max ρ ≈ log2 n` and `2^{max ρ} ≈ n`.

### P2. Why exactly the constant `1.04`?
Poissonize and set `Y_j = 2^{-M[j]}` (i.i.d., bounded). The estimator's relative standard error is `c/√m` with `c = √(3 ln 2 − 1) ≈ 1.03896`, derived via the CLT for `Z = Σ Y_j` and the delta method through `E = alpha_m m²/Z`.

### P3. Why is the harmonic mean provably better than the arithmetic mean here?
`2^{M[j]}` has effectively infinite second moment (heavy tail), so the arithmetic mean has huge/unbounded variance. `2^{-M[j]} ∈ [0,1]` has finite moments of all orders, so `Z` concentrates (CLT) and the harmonic-mean estimator has bounded, small relative variance.

### P4. What is `alpha_m` formally and its limit?
`alpha_m = (m ∫_0^∞ (log2((2+u)/(1+u)))^m du)^{-1}`, with `alpha_∞ = 1/(2 ln 2) ≈ 0.72134`. It removes the leading bias of `m²/Z`.

### P5. Derive the linear-counting estimator.
`Pr[register empty] = (1-1/m)^n ≈ e^{-n/m}`, so `E[V] = m e^{-n/m}`. Invert: `V/m ≈ e^{-n/m}` ⟹ `n ≈ -m ln(V/m) = m ln(m/V)`.

### P6. State HLL's space complexity and how close it is to optimal.
`m = Θ(ε^{-2})` registers of `Θ(log log n)` bits → `Θ(ε^{-2} log log n)` bits. The information-theoretic lower bound (Kane–Nelson–Woodruff) is `Θ(ε^{-2} + log n)`. HLL is within a `log log n ≤ 6` factor of optimal — effectively optimal for `n ≤ 2^{64}`.

### P7. Quantify the intersection error amplification.
Each of `|A|`, `|B|`, `|A∪B|` has absolute error `Θ(n·1.04/√m)`. For `|A∩B| ≪ |A|,|B|`, the difference's *relative* error is `Θ((|A|+|B|)/|A∩B| · 1/√m)`, which diverges as the overlap shrinks — the formal "HLL can't intersect."

### P8. Why does HLL store `log log n` bits per register while linear counting stores `Θ(n)` total?
A register holds `ρ ≈ log2(n/m)` — a *logarithm* of a count, needing `O(log log n)` bits. Linear counting stores a bitmap sized to `n` (one bit per slot). Storing logarithms of counts instead of the counts/bitmap is exactly why HLL is exponentially smaller.

---

### P9. Why is HLL's error two-sided while a Bloom filter's is one-sided?
A Bloom filter can only produce **false positives** (it never misses a present element), so its error is one-sided. HLL is an **unbiased point estimator**: `E[estimate] ≈ n` with symmetric `±1.04/√m` fluctuation, so it can over- or under-count. Consequently an HLL count is *not* a guaranteed bound — report it with a confidence interval `n̂ ± z·(1.04/√m)·n̂`, not as an exact or bounding value.

### P10. Walk through the depoissonization idea in one sentence.
The clean variance analysis assumes the cardinality is `Poisson(λ)` so the registers are independent; depoissonization shows the mean and variance of the estimator are smooth, concentrated functions of `λ`, so the Poisson-model results transfer to a fixed `n` with only lower-order corrections — the leading `1.04/√m` constant is unchanged.

---

## Common Pitfalls Interviewers Probe

| Pitfall | What to say |
|---------|-------------|
| "Just OR the registers for intersection" | No — register operations only give union (max); intersection needs inclusion-exclusion, which amplifies error. |
| "Smaller `p` to save memory and keep accuracy" | Impossible — `memory ∝ 1/error²`; halving error quadruples memory. |
| "Count timestamps for unique users" | That counts events, not users — hash the stable identity. |
| "Merge two HLLs from different services" | Only if same `p` AND same hash/seed; otherwise silently wrong. |
| "HLL is exact for small inputs" | It is *approximate*; small inputs use linear counting but still estimate. |
| "Error grows with more data" | No — relative error is `1.04/√m`, independent of `n`. |

---

## Behavioral / System-Design Prompts

1. *"Design unique-visitor counting for a site with billions of pageviews/day, per (page, country, hour)."* — Per-dimension HLL++ sketches (sparse for the small-key long tail), `p=14`, fixed 64-bit hash; store sketches as values; merge at query time for arbitrary slices/periods; budget memory = (#large keys × 12 KB) + sparse tail.
2. *"A dashboard shows 1.02M uniques but billing says 1.00M — explain."* — HLL is approximate (~0.8% at `p=14`); 2% looks high → check hash quality, whether per-event noise is being counted, and whether the small-range correction is applied.
3. *"Two teams' unique-user sketches won't merge."* — Almost certainly different `p` or hash/seed; enforce a global `p` + versioned hash header; fold if precisions differ.
4. *"Product wants 'users who saw both campaign A and B.'"* — Explain HLL inclusion-exclusion error amplification; propose MinHash / Theta sketches instead, or exact sets if the campaigns are small.
5. *"Cut the unique-counting service's memory in half."* — You cannot halve error and memory together (`memory ∝ 1/error²`); options: lower `p` (more error), aggressively use sparse mode, TTL cold keys.

---

## Coding Challenges (3 Languages)

### Challenge 1: Implement HyperLogLog with linear-counting correction

> Build an HLL supporting `add` and `count`. Use the top `p` bits for the register and `1 + leadingZeros` of the rest for the rank. Apply linear counting in the low range. Validate that the estimate is within ~3% of the truth for `p=12` on 100k distinct items.

#### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"math"
	"math/bits"
)

type HLL struct {
	p   uint
	m   uint32
	reg []uint8
}

func New(p uint) *HLL { return &HLL{p: p, m: 1 << p, reg: make([]uint8, 1<<p)} }

func (h *HLL) Add(s string) {
	f := fnv.New64a()
	f.Write([]byte(s))
	x := f.Sum64()
	idx := x >> (64 - h.p)
	rest := (x << h.p) | (1 << (h.p - 1))
	r := uint8(bits.LeadingZeros64(rest)) + 1
	if r > h.reg[idx] {
		h.reg[idx] = r
	}
}

func (h *HLL) Count() float64 {
	m := float64(h.m)
	alpha := 0.7213 / (1.0 + 1.079/m)
	sum, zeros := 0.0, 0
	for _, r := range h.reg {
		sum += math.Pow(2, -float64(r))
		if r == 0 {
			zeros++
		}
	}
	est := alpha * m * m / sum
	if est <= 2.5*m && zeros > 0 {
		est = m * math.Log(m/float64(zeros))
	}
	return est
}

func main() {
	h := New(12)
	for i := 0; i < 100000; i++ {
		h.Add(fmt.Sprintf("u-%d", i))
	}
	est := h.Count()
	fmt.Printf("true=100000 est=%.0f err=%.2f%%\n", est, math.Abs(est-100000)/100000*100)
}
```

#### Java

```java
public class HLL {
    final int p, m;
    final byte[] reg;

    HLL(int p) { this.p = p; this.m = 1 << p; this.reg = new byte[m]; }

    static long h64(String s) {
        long h = 0xcbf29ce484222325L;
        for (int i = 0; i < s.length(); i++) { h ^= s.charAt(i); h *= 0x100000001b3L; }
        return h;
    }

    void add(String s) {
        long x = h64(s);
        int idx = (int) (x >>> (64 - p));
        long rest = (x << p) | (1L << (p - 1));
        int r = Long.numberOfLeadingZeros(rest) + 1;
        if (r > reg[idx]) reg[idx] = (byte) r;
    }

    double count() {
        double mm = m, alpha = 0.7213 / (1.0 + 1.079 / mm), sum = 0;
        int zeros = 0;
        for (byte r : reg) { sum += Math.pow(2, -r); if (r == 0) zeros++; }
        double est = alpha * mm * mm / sum;
        if (est <= 2.5 * mm && zeros > 0) est = mm * Math.log(mm / zeros);
        return est;
    }

    public static void main(String[] args) {
        HLL h = new HLL(12);
        for (int i = 0; i < 100000; i++) h.add("u-" + i);
        double est = h.count();
        System.out.printf("true=100000 est=%.0f err=%.2f%%%n",
                est, Math.abs(est - 100000) / 100000 * 100);
    }
}
```

#### Python

```python
import math


class HLL:
    def __init__(self, p=12):
        self.p, self.m = p, 1 << p
        self.reg = bytearray(self.m)

    @staticmethod
    def _h(s):
        h = 0xcbf29ce484222325
        for b in str(s).encode():
            h = ((h ^ b) * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
        return h

    def add(self, s):
        x = self._h(s)
        idx = x >> (64 - self.p)
        rest = ((x << self.p) | (1 << (self.p - 1))) & 0xFFFFFFFFFFFFFFFF
        r = (64 - rest.bit_length()) + 1
        if r > self.reg[idx]:
            self.reg[idx] = r

    def count(self):
        m = self.m
        alpha = 0.7213 / (1.0 + 1.079 / m)
        s = sum(2.0 ** -r for r in self.reg)
        zeros = self.reg.count(0)
        est = alpha * m * m / s
        if est <= 2.5 * m and zeros > 0:
            est = m * math.log(m / zeros)
        return est


if __name__ == "__main__":
    h = HLL(12)
    for i in range(100_000):
        h.add(f"u-{i}")
    est = h.count()
    print(f"true=100000 est={est:.0f} err={abs(est-100000)/100000*100:.2f}%")
```

---

### Challenge 2: Merge two HLLs to count a union

> Given two HLLs (same `p`, same hash) over overlapping streams, merge them by register-wise max and verify the merged count estimates the union's cardinality (not the sum).

#### Go

```go
func (h *HLL) Merge(o *HLL) {
	for j := range h.reg {
		if o.reg[j] > h.reg[j] {
			h.reg[j] = o.reg[j]
		}
	}
}

func mainMerge() {
	a, b := New(14), New(14)
	for i := 0; i < 70000; i++ {
		a.Add(fmt.Sprintf("id-%d", i))
	}
	for i := 50000; i < 100000; i++ { // overlap [50000,70000)
		b.Add(fmt.Sprintf("id-%d", i))
	}
	a.Merge(b)
	fmt.Printf("union true=100000 est=%.0f\n", a.Count()) // ~100000, not 120000
}
```

#### Java

```java
void merge(HLL o) {
    for (int j = 0; j < m; j++) if (o.reg[j] > reg[j]) reg[j] = o.reg[j];
}

static void mainMerge() {
    HLL a = new HLL(14), b = new HLL(14);
    for (int i = 0; i < 70000; i++) a.add("id-" + i);
    for (int i = 50000; i < 100000; i++) b.add("id-" + i);
    a.merge(b);
    System.out.printf("union true=100000 est=%.0f%n", a.count()); // ~100000
}
```

#### Python

```python
def merge(self, other):  # add as a method of HLL
    self.reg = bytearray(max(a, b) for a, b in zip(self.reg, other.reg))


def main_merge():
    a, b = HLL(14), HLL(14)
    for i in range(70_000):
        a.add(f"id-{i}")
    for i in range(50_000, 100_000):  # overlap [50000,70000)
        b.add(f"id-{i}")
    a.merge(b)
    print(f"union true=100000 est={a.count():.0f}")  # ~100000, not 120000
```

---

### Challenge 3: Compute the rank (leading-zeros + 1) of a 64-bit hash suffix

> Given a 64-bit hash `x` and precision `p`, return `(registerIndex, rank)`. The rank must be well defined even when the suffix is all zeros (use a sentinel bit).

#### Go

```go
func split(x uint64, p uint) (uint64, uint8) {
	idx := x >> (64 - p)
	rest := (x << p) | (1 << (p - 1)) // sentinel guards all-zero suffix
	rank := uint8(bits.LeadingZeros64(rest)) + 1
	return idx, rank
}
```

#### Java

```java
static long[] split(long x, int p) {
    long idx = x >>> (64 - p);
    long rest = (x << p) | (1L << (p - 1));
    long rank = Long.numberOfLeadingZeros(rest) + 1;
    return new long[]{idx, rank};
}
```

#### Python

```python
def split(x, p):
    idx = x >> (64 - p)
    rest = ((x << p) | (1 << (p - 1))) & 0xFFFFFFFFFFFFFFFF
    rank = (64 - rest.bit_length()) + 1
    return idx, rank
```

---

### Challenge 4: Estimate cardinality two ways and compare error vs an exact set

> For a fixed stream, report the exact distinct count, the HLL estimate, and the relative error. Sweep `p ∈ {10, 12, 14}` and confirm the error tracks `1.04/√m`.

#### Go

```go
func sweep() {
	for _, p := range []uint{10, 12, 14} {
		h := New(p)
		exact := map[string]struct{}{}
		for i := 0; i < 200000; i++ {
			s := fmt.Sprintf("k-%d", i%150000) // 150000 distinct
			h.Add(s)
			exact[s] = struct{}{}
		}
		est := h.Count()
		predicted := 1.04 / math.Sqrt(float64(uint32(1)<<p))
		fmt.Printf("p=%d true=%d est=%.0f err=%.2f%% (~%.2f%%)\n",
			p, len(exact), est, math.Abs(est-float64(len(exact)))/float64(len(exact))*100,
			predicted*100)
	}
}
```

#### Java

```java
static void sweep() {
    int[] ps = {10, 12, 14};
    for (int p : ps) {
        HLL h = new HLL(p);
        java.util.HashSet<String> exact = new java.util.HashSet<>();
        for (int i = 0; i < 200000; i++) {
            String s = "k-" + (i % 150000);
            h.add(s); exact.add(s);
        }
        double est = h.count();
        double predicted = 1.04 / Math.sqrt(1 << p);
        System.out.printf("p=%d true=%d est=%.0f err=%.2f%% (~%.2f%%)%n",
                p, exact.size(), est,
                Math.abs(est - exact.size()) / exact.size() * 100, predicted * 100);
    }
}
```

#### Python

```python
def sweep():
    for p in (10, 12, 14):
        h = HLL(p)
        exact = set()
        for i in range(200_000):
            s = f"k-{i % 150000}"  # 150000 distinct
            h.add(s); exact.add(s)
        est = h.count()
        predicted = 1.04 / (1 << p) ** 0.5
        print(f"p={p} true={len(exact)} est={est:.0f} "
              f"err={abs(est-len(exact))/len(exact)*100:.2f}% (~{predicted*100:.2f}%)")
```

---

## Final Tips

- Lead with the **one-line insight** (leading zeros ↔ cardinality, harmonic mean to denoise) before any code.
- Always mention **mergeability (union)** and the **intersection caveat** — interviewers probe both.
- Know the **numbers cold**: `1.04/√m`, `p=14` → ~12 KB ~0.8% for billions, error independent of `n`.
- Be ready to write the `add` rank computation with a **sentinel bit** and the `count` with the **linear-counting** fallback.
- Distinguish **classic HLL vs HLL++** (64-bit hash, bias correction, sparse mode) for senior rounds.

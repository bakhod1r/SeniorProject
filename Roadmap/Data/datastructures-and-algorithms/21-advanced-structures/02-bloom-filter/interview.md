# Bloom Filter — Interview Preparation

> Tiered questions (Junior → Middle → Senior → Professional) followed by a multi-language coding challenge. Answers are concise but complete — expand on the math where the interviewer probes.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Coding Challenge](#coding-challenge)

---

## Junior Questions

**Q1. What is a Bloom filter?**
> A space-efficient probabilistic data structure for approximate set membership. It's a bit array of `m` bits plus `k` hash functions. Insert sets the `k` bits an item hashes to; query returns "present" only if all `k` bits are `1`.

**Q2. What's the one guarantee a Bloom filter always gives?**
> **No false negatives.** If it says "not present," the item is definitely absent. It may have false positives (say "present" for a never-inserted item), but never false negatives.

**Q3. Why are there no false negatives?**
> Insert only ever turns bits from `0` to `1`, never back. So an inserted item's `k` bits stay `1` forever, and a later query for it always finds all `1`s → "present."

**Q4. What causes a false positive?**
> A never-inserted item whose `k` bit positions were all set to `1` by *other* items. The bits collide, so the query mistakenly reports "present."

**Q5. What operations does a Bloom filter support, and at what cost?**
> `insert` and `mightContain`, both `O(k)` — compute `k` hash positions and set/check `k` bits. `k` is a small constant (~7), so effectively `O(1)`, independent of how many items are stored.

**Q6. Can you delete from a standard Bloom filter?**
> No. Clearing an item's bits could clear bits shared with other items, introducing false negatives and breaking the core guarantee. Use a counting Bloom filter to delete.

**Q7. How is a Bloom filter different from a hash set?**
> A hash set stores the actual items (exact, deletable, enumerable) but uses memory proportional to item size. A Bloom filter stores no items — just bits — using ~10 bits/item regardless of item size, at the cost of possible false positives and no deletion/enumeration.

**Q8. Can a Bloom filter tell you what items it contains?**
> No. It can't enumerate or recover items — it only answers approximate yes/no membership.

**Q9. If a query hits a `0` bit on the second of `k` checks, what do you do?**
> Return "absent" immediately — early exit. One `0` is conclusive proof of non-membership; no need to check the remaining bits.

**Q10. Give a real use case.**
> A web crawler dedups URLs: before fetching, ask the Bloom filter "seen this URL?" If "no," fetch and record it; this avoids re-fetching billions of URLs with only a few bits each.

---

## Middle Questions

**Q11. State the false-positive-rate formula.**
> `p ≈ (1 − e^(−kn/m))^k`, where `m` = bits, `k` = hashes, `n` = inserted items. The inner term `1 − e^(−kn/m)` is the expected fraction of set bits.

**Q12. What is the optimal number of hash functions?**
> `k* = (m/n)·ln 2 ≈ 0.693·(m/n)`. At this `k`, exactly half the bits are set, minimizing the FPR.

**Q13. How do you size the bit array for a target FPR `p`?**
> `m = −n·ln p / (ln 2)²`. Equivalently, bits per element = `−log₂ p / ln 2 ≈ 1.44·log₂(1/p)`. About 10 bits/item gives ~1% FPR.

**Q14. Why isn't "more hash functions always better"?**
> More hashes set more bits per insert, saturating the array with `1`s. Past the optimum, the array fills so densely that almost any query finds all bits set → FPR rises again. There's a sweet spot at half-full.

**Q15. What is double hashing and why use it?**
> Kirsch–Mitzenmacher: derive all `k` indices from two base hashes via `g_i(x) = h1(x) + i·h2(x) mod m`. It gives the same asymptotic FPR while computing only 2 hashes instead of `k`, saving CPU.

**Q16. Walk me through inserting and querying an item.**
> Insert: compute `h1, h2`; for `i = 0..k-1`, set bit `(h1 + i·h2) % m`. Query: same indices; return false on the first `0` bit, true if all are `1`.

**Q17. Memory for 1 billion items at 1% FPR?**
> ~10 bits/item × 10⁹ ≈ 10 Gbit ≈ 1.25 GB. A hash set of 1B URLs would need tens of GB or more — the Bloom filter is an order of magnitude smaller.

**Q18. What happens if you insert far more than the design `n`?**
> The FPR climbs toward 1 — the filter starts answering "present" to almost everything and stops being useful. Re-size or use a scalable Bloom filter.

**Q19. Why must `h2` be non-zero in double hashing?**
> If `h2 = 0`, all `k` indices collapse to `h1`, so effectively `k = 1` and the FPR spikes. Force `h2` odd/non-zero.

**Q20. Compare Bloom filter vs counting Bloom filter.**
> Counting Bloom replaces each bit with a small counter (e.g. 4 bits): insert increments, delete decrements, "set" means counter > 0. It supports deletion at ~4× the memory.

**Q21. Two Bloom filters with the same parameters — how do you union them?**
> Bitwise OR of the two bit arrays. The result answers membership over the union of both sets, exactly. (Intersection via AND is *not* safe — it can create false negatives.)

**Q22. When would you pick a hash set over a Bloom filter?**
> When you need exact answers, deletion, enumeration, the set is small enough that memory isn't a concern, or a false "yes" would be incorrect rather than just wasteful.

---

## Senior Questions

**Q23. How do LSM-tree databases use Bloom filters?**
> Each immutable SSTable carries a Bloom filter over its keys. On a point read, the engine checks each candidate SSTable's filter; a "no" lets it skip that file's disk read entirely. This eliminates most disk I/O for absent keys in read/miss-heavy workloads (RocksDB, Cassandra, LevelDB, HBase).

**Q24. What's a blocked Bloom filter and why does it matter?**
> A standard filter spreads `k` bits across the whole array → up to `k` cache misses per query. A blocked filter confines all `k` bits to one cache-line-sized block (512 bits): one cache miss per op. It trades a slightly higher FPR for 2–4× lower latency on large filters.

**Q25. Design a cache admission filter to fight one-hit-wonders.**
> Keep a Bloom filter of "seen keys." On first request, the filter says "no" → record it but don't cache the object. On second request → "yes" → admit to the real cache. This keeps single-access objects out of the cache. Use a counting/rotating filter so entries age out.

**Q26. How do scalable Bloom filters handle unknown `n`?**
> Maintain a growing list of filters. When the current fills to target load, add a new, larger filter with a tighter per-filter FPR (`p·r^i`, `r≈0.9`) so the compounded global FPR stays bounded. Queries check all filters (any "yes" → present); inserts go to the newest.

**Q27. How do you tune FPR vs memory in production?**
> The lever is bits/key (`m/n`); each extra bit multiplies FPR by ~0.6185. If the protected op is cheap (local SSD), accept higher FPR (~8–10 bits). If it's expensive (cross-DC RPC, cache stampede), drive FPR to 0.1–0.01% (14–20 bits). Balance filter RAM against `FPR × cost_of_wasted_op × query_rate`.

**Q28. Why can't you reflect upstream deletions in a plain Bloom filter?**
> It can't clear bits without risking false negatives, so deleted keys keep returning "maybe present." Fix: periodic full rebuild from the live keyset, or a counting Bloom filter with TTL rotation.

**Q29. How do networking systems use Bloom filters?**
> Cache digests (Squid peers summarize their contents), router/switch forwarding and per-flow state in fast SRAM, DDoS/duplicate-packet detection at line rate, and IDS payload pre-screening. The draw is constant-time decisions in tiny fast memory.

**Q30. Bloom filter vs cuckoo filter — when each?**
> Bloom: mergeable by OR (good for distributed union), lock-light concurrency (bits only rise), slightly better at high FPR. Cuckoo: supports deletion, lower space at low FPR, but harder to merge. Pick cuckoo when you need deletes + low FPR + tight space; Bloom when you need merges or simplicity.

**Q31. How do you make a Bloom filter concurrent?**
> Inserts only OR bits in, so atomic OR / CAS per word makes inserts lock-free; reads are plain loads. No global lock needed. This is far simpler than concurrency for structures that mutate in both directions.

**Q32. What's the "adversarial false positive" risk?**
> If an attacker knows the hash seeds, they can craft keys that all collide on already-set bits, spiking the effective FPR or forcing expensive backing lookups. Mitigate with secret/keyed hash seeds.

---

## Professional Questions

**Q33. Derive `Pr[a given bit is 0]` after `n` inserts.**
> Each of the `kn` independent hash placements misses a given bit with probability `1 − 1/m`. So `Pr[bit = 0] = (1 − 1/m)^(kn) ≈ e^(−kn/m)`.

**Q34. Prove the optimal `k = (m/n)·ln 2`.**
> Minimize `ln p(k) = k·ln(1 − e^(−kn/m))`. Setting the derivative to zero and substituting `k = (m/n)ln 2` gives `e^(−kn/m) = 1/2`, and the derivative evaluates to `−ln2 + ln2 = 0`. Convexity of `ln p` over the range makes it the global minimum. The condition `e^(−kn/m)=1/2` means exactly half the bits are set.

**Q35. What is the information-theoretic space lower bound for an AMQ?**
> Any structure with FPR `ε` and no false negatives needs at least `n·log₂(1/ε)` bits. It follows from a counting argument over how many `n`-subsets the structure must distinguish given the `ε` slack on non-members.

**Q36. How far from optimal is the Bloom filter?**
> It uses `1.4427·n·log₂(1/ε)` bits vs the bound `n·log₂(1/ε)`. The ratio is `1/ln2 = log₂ e ≈ 1.44`, so it's ~44% above optimal. Cuckoo/quotient/ribbon filters narrow this gap.

**Q37. Why is the expectation-based FPR formula reliable on a single instance?**
> The number of set bits `X` concentrates: `E[X] = mρ`, `Var[X] ≤ mρ(1−ρ)`, and a bounded-differences (McDiarmid) bound gives `Pr[|X−E[X]| ≥ λ] ≤ 2exp(−λ²/(2nk²))`. So `X/m → ρ` with exponentially small deviation, and the realized FPR ≈ `ρ^k` matches the formula.

**Q38. Why does double hashing preserve the FPR despite dependence?**
> For a single element the `g_i` lie on an arithmetic progression mod `m` (dependent), but across different elements the `(h1, h2)` pairs are independent, so the array-wide bit distribution matches independent hashing. Kirsch–Mitzenmacher prove `E[p_double] = (1−e^(−kn/m))^k·(1+o(1))`.

**Q39. State the no-false-negatives proof.**
> Invariant: bits are monotone (only written to `1`). When `x` is inserted, all `k` of its bits become `1` and stay `1`. Hence any later query for `x` sees all `1`s → "present." Contrapositive: a "no" means some bit is `0`, never set, so `x` was never inserted — a proof of non-membership.

**Q40. Give the exact (non-approximate) FPR and when the approximation fails.**
> The simple `(1 − (1−1/m)^(kn))^k` slightly overstates independence; the exact value (Bose et al.) sums over the random number of distinct set bits. The `e`-approximation error is `O(k/m)`, negligible for `m ≫ k`, but matters for tiny `m` or very large `k`.

---

## Rapid-Fire Round

| # | Question | Answer |
|---|----------|--------|
| 41 | False negatives possible? | Never. |
| 42 | False positives possible? | Yes, tunable. |
| 43 | Optimal `k`? | `(m/n)·ln 2`. |
| 44 | Bits/item for 1% FPR? | ~9.6 (≈10). |
| 45 | Can you delete? | Not from a plain Bloom filter. |
| 46 | Merge two filters? | Bitwise OR (same params). |
| 47 | Insert/query time? | `O(k)`. |
| 48 | FPR at half-full array? | `(1/2)^k`. |
| 49 | Filter that allows delete? | Counting Bloom / cuckoo filter. |
| 50 | One-cache-line variant? | Blocked Bloom filter. |
| 51 | Why not `k` separate hashes? | Use double hashing `h1+i·h2`. |
| 52 | Space lower bound? | `n·log₂(1/ε)` bits. |
| 53 | Estimate `n` from a filter? | `n̂ = −(m/k)·ln(1 − X/m)`. |
| 54 | Cost of one extra bit/elem? | FPR ×0.62. |
| 55 | Does re-querying reduce error? | No — same fixed filter, same answer. |
| 56 | Where in an LSM is the filter dropped? | Bottom (largest) level, to save RAM. |
| 57 | Counter width for counting Bloom? | 4 bits (max 15) is ample. |
| 58 | Is "yes" a certificate? | No — only "no" is a proof. |

---

## Behavioral / Design Discussion Prompts

These open-ended prompts test judgment, not recall — practice talking through them.

**D1. "We added a Bloom filter and latency got worse, not better. Why?"**
> Likely a large unblocked filter causing `k` cache misses per probe, or the workload is mostly *hits* (so the filter rarely says "no" and only adds work). Fix: use a blocked filter; reconsider whether a filter helps a hit-heavy workload at all (it shines on miss-heavy paths).

**D2. "Our false-positive rate drifted from 1% to 15% over a month. What happened?"**
> The set grew past the design `n` — the filter overfilled. No errors, just silent degradation. Fix: monitor fill ratio / inserted count, rebuild larger, or switch to a scalable Bloom filter.

**D3. "Can we use the Bloom filter to answer the query directly and skip the database?"**
> No — a "yes" is only probable. The filter must front a source of truth that confirms positives; using it standalone serves phantom results on every false positive.

**D4. "We need to remove expired entries. The Bloom filter can't delete — what now?"**
> Counting Bloom filter (decrement on delete) or double-buffering two filters that rotate on a time window. Never clear bits in a plain filter — that creates false negatives.

**D5. "How would you choose between a Bloom filter and a cuckoo filter for a new service?"**
> Need deletes and low FPR with tight space → cuckoo. Need distributed merges (OR), simple lock-light concurrency, or you're at high FPR → Bloom. Also weigh ecosystem support: most storage engines ship Bloom out of the box.

---

## Coding Challenge

### Challenge: Implement a sized Bloom filter and verify its no-false-negative property

> Build a Bloom filter that sizes `m` and `k` from a target item count `n` and false-positive rate `p`. Implement `add` and `mightContain` using double hashing. Then prove empirically that for any item you inserted, `mightContain` returns `true` (no false negatives), and report the observed false-positive rate against the analytic one.

**Requirements:**
1. `m = ceil(−n·ln p / (ln 2)²)`, `k = round((m/n)·ln 2)`.
2. `add(x)` sets `k` bits; `mightContain(x)` returns false on the first `0` bit.
3. Insert `n` items, confirm all return `true`, then test `n` never-inserted items and count false positives.

#### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"math"
)

type Bloom struct {
	bits []uint64
	m, k uint64
}

func New(n int, p float64) *Bloom {
	m := uint64(math.Ceil(-float64(n) * math.Log(p) / (math.Ln2 * math.Ln2)))
	k := uint64(math.Max(1, math.Round(float64(m)/float64(n)*math.Ln2)))
	return &Bloom{bits: make([]uint64, (m+63)/64), m: m, k: k}
}

func (b *Bloom) base(s string) (uint64, uint64) {
	h := fnv.New64a()
	h.Write([]byte(s))
	x := h.Sum64()
	return x & 0xffffffff, (x >> 32) | 1
}

func (b *Bloom) Add(s string) {
	h1, h2 := b.base(s)
	for i := uint64(0); i < b.k; i++ {
		idx := (h1 + i*h2) % b.m
		b.bits[idx/64] |= 1 << (idx % 64)
	}
}

func (b *Bloom) MightContain(s string) bool {
	h1, h2 := b.base(s)
	for i := uint64(0); i < b.k; i++ {
		idx := (h1 + i*h2) % b.m
		if b.bits[idx/64]&(1<<(idx%64)) == 0 {
			return false
		}
	}
	return true
}

func main() {
	n, p := 10000, 0.01
	b := New(n, p)
	for i := 0; i < n; i++ {
		b.Add(fmt.Sprintf("in-%d", i))
	}
	// no false negatives
	fn := 0
	for i := 0; i < n; i++ {
		if !b.MightContain(fmt.Sprintf("in-%d", i)) {
			fn++
		}
	}
	// false positives
	fp := 0
	for i := 0; i < n; i++ {
		if b.MightContain(fmt.Sprintf("out-%d", i)) {
			fp++
		}
	}
	fmt.Printf("m=%d k=%d falseNegatives=%d observedFPR=%.4f\n",
		b.m, b.k, fn, float64(fp)/float64(n))
}
```

#### Java

```java
import java.nio.charset.StandardCharsets;

public class Bloom {
    final long[] bits; final int m, k;

    Bloom(int n, double p) {
        m = (int) Math.ceil(-n * Math.log(p) / (Math.log(2) * Math.log(2)));
        k = Math.max(1, (int) Math.round((double) m / n * Math.log(2)));
        bits = new long[(m + 63) / 64];
    }

    long[] base(String s) {
        long h = 0xcbf29ce484222325L;
        for (byte by : s.getBytes(StandardCharsets.UTF_8)) { h ^= (by & 0xff); h *= 0x100000001b3L; }
        return new long[]{ h & 0xffffffffL, (h >>> 32) | 1L };
    }

    void add(String s) {
        long[] h = base(s);
        for (int i = 0; i < k; i++) {
            int idx = (int) (((h[0] + (long) i * h[1]) % m + m) % m);
            bits[idx >>> 6] |= 1L << (idx & 63);
        }
    }

    boolean mightContain(String s) {
        long[] h = base(s);
        for (int i = 0; i < k; i++) {
            int idx = (int) (((h[0] + (long) i * h[1]) % m + m) % m);
            if ((bits[idx >>> 6] & (1L << (idx & 63))) == 0) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        int n = 10000; double p = 0.01;
        Bloom b = new Bloom(n, p);
        for (int i = 0; i < n; i++) b.add("in-" + i);
        int fn = 0, fp = 0;
        for (int i = 0; i < n; i++) if (!b.mightContain("in-" + i)) fn++;
        for (int i = 0; i < n; i++) if (b.mightContain("out-" + i)) fp++;
        System.out.printf("m=%d k=%d falseNegatives=%d observedFPR=%.4f%n",
            b.m, b.k, fn, (double) fp / n);
    }
}
```

#### Python

```python
import math


class Bloom:
    def __init__(self, n, p):
        self.m = math.ceil(-n * math.log(p) / (math.log(2) ** 2))
        self.k = max(1, round(self.m / n * math.log(2)))
        self.bits = bytearray((self.m + 7) // 8)

    def _base(self, s):
        import hashlib
        h = int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "little")
        return h & 0xFFFFFFFF, (h >> 32) | 1

    def add(self, s):
        h1, h2 = self._base(s)
        for i in range(self.k):
            idx = (h1 + i * h2) % self.m
            self.bits[idx >> 3] |= 1 << (idx & 7)

    def might_contain(self, s):
        h1, h2 = self._base(s)
        for i in range(self.k):
            idx = (h1 + i * h2) % self.m
            if not (self.bits[idx >> 3] >> (idx & 7)) & 1:
                return False
        return True


if __name__ == "__main__":
    n, p = 10000, 0.01
    b = Bloom(n, p)
    for i in range(n):
        b.add(f"in-{i}")
    fn = sum(1 for i in range(n) if not b.might_contain(f"in-{i}"))
    fp = sum(1 for i in range(n) if b.might_contain(f"out-{i}"))
    print(f"m={b.m} k={b.k} falseNegatives={fn} observedFPR={fp / n:.4f}")
```

**Expected output (all languages):** `falseNegatives=0` always, and `observedFPR ≈ 0.01` (close to the target `p`, within statistical noise). The zero false negatives is the property to highlight in an interview — it holds with probability 1, not on average.

---

### Bonus Challenge: Union two filters and estimate intersection size

> Given two Bloom filters with identical `(m, k)` holding sets `A` and `B`, build their **union** by bitwise OR (which is exact), then estimate `|A|`, `|B|`, `|A ∪ B|` from the set-bit counts using the Swamidass–Baldi estimator `n̂ = −(m/k)·ln(1 − X/m)`, and finally estimate `|A ∩ B| = n̂(A) + n̂(B) − n̂(A∪B)` by inclusion–exclusion.

**Requirements:**
1. `union(a, b)` returns a new filter = `a.bits OR b.bits` (reject mismatched params).
2. `estimateCount()` = `−(m/k)·ln(1 − setBits/m)`.
3. Print estimated `|A|`, `|B|`, `|A∪B|`, `|A∩B|` and compare to the true values.

#### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"math"
)

type Bloom struct {
	bits []uint64
	m, k uint64
}

func New(m, k uint64) *Bloom { return &Bloom{bits: make([]uint64, (m+63)/64), m: m, k: k} }

func (b *Bloom) idx(s string, i uint64) uint64 {
	h := fnv.New64a(); h.Write([]byte(s)); x := h.Sum64()
	h1, h2 := x&0xffffffff, (x>>32)|1
	return (h1 + i*h2) % b.m
}
func (b *Bloom) Add(s string) {
	for i := uint64(0); i < b.k; i++ { idx := b.idx(s, i); b.bits[idx/64] |= 1 << (idx % 64) }
}
func (b *Bloom) Union(o *Bloom) *Bloom {
	u := New(b.m, b.k)
	for i := range b.bits { u.bits[i] = b.bits[i] | o.bits[i] }
	return u
}
func (b *Bloom) SetBits() (c uint64) {
	for _, w := range b.bits { for ; w != 0; w &= w - 1 { c++ } }
	return
}
func (b *Bloom) Estimate() float64 {
	return -float64(b.m) / float64(b.k) * math.Log(1-float64(b.SetBits())/float64(b.m))
}

func main() {
	a, bb := New(2000, 5), New(2000, 5)
	for i := 0; i < 300; i++ { a.Add(fmt.Sprintf("k-%d", i)) }          // |A|=300
	for i := 200; i < 500; i++ { bb.Add(fmt.Sprintf("k-%d", i)) }       // |B|=300, overlap 100
	u := a.Union(bb)
	inter := a.Estimate() + bb.Estimate() - u.Estimate()
	fmt.Printf("|A|≈%.0f |B|≈%.0f |A∪B|≈%.0f |A∩B|≈%.0f (true 300/300/500/100)\n",
		a.Estimate(), bb.Estimate(), u.Estimate(), inter)
}
```

#### Java

```java
import java.nio.charset.StandardCharsets;

public class BloomUnion {
    final long[] bits; final int m, k;
    BloomUnion(int m, int k) { this.m = m; this.k = k; bits = new long[(m + 63) / 64]; }

    int idx(String s, int i) {
        long h = 0xcbf29ce484222325L;
        for (byte by : s.getBytes(StandardCharsets.UTF_8)) { h ^= (by & 0xff); h *= 0x100000001b3L; }
        long h1 = h & 0xffffffffL, h2 = (h >>> 32) | 1L;
        return (int) (((h1 + (long) i * h2) % m + m) % m);
    }
    void add(String s) { for (int i = 0; i < k; i++) { int x = idx(s, i); bits[x >>> 6] |= 1L << (x & 63); } }
    BloomUnion union(BloomUnion o) {
        BloomUnion u = new BloomUnion(m, k);
        for (int i = 0; i < bits.length; i++) u.bits[i] = bits[i] | o.bits[i];
        return u;
    }
    long setBits() { long c = 0; for (long w : bits) c += Long.bitCount(w); return c; }
    double estimate() { return -(double) m / k * Math.log(1 - (double) setBits() / m); }

    public static void main(String[] args) {
        BloomUnion a = new BloomUnion(2000, 5), b = new BloomUnion(2000, 5);
        for (int i = 0; i < 300; i++) a.add("k-" + i);
        for (int i = 200; i < 500; i++) b.add("k-" + i);
        BloomUnion u = a.union(b);
        double inter = a.estimate() + b.estimate() - u.estimate();
        System.out.printf("|A|≈%.0f |B|≈%.0f |A∪B|≈%.0f |A∩B|≈%.0f (true 300/300/500/100)%n",
            a.estimate(), b.estimate(), u.estimate(), inter);
    }
}
```

#### Python

```python
import math, hashlib


class Bloom:
    def __init__(self, m, k):
        self.m, self.k = m, k
        self.bits = bytearray((m + 7) // 8)

    def _idx(self, s, i):
        h = int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "little")
        h1, h2 = h & 0xFFFFFFFF, (h >> 32) | 1
        return (h1 + i * h2) % self.m

    def add(self, s):
        for i in range(self.k):
            x = self._idx(s, i)
            self.bits[x >> 3] |= 1 << (x & 7)

    def union(self, o):
        u = Bloom(self.m, self.k)
        u.bits = bytearray(a | b for a, b in zip(self.bits, o.bits))
        return u

    def estimate(self):
        set_bits = sum(bin(byte).count("1") for byte in self.bits)
        return -self.m / self.k * math.log(1 - set_bits / self.m)


if __name__ == "__main__":
    a, b = Bloom(2000, 5), Bloom(2000, 5)
    for i in range(300):
        a.add(f"k-{i}")
    for i in range(200, 500):
        b.add(f"k-{i}")
    u = a.union(b)
    inter = a.estimate() + b.estimate() - u.estimate()
    print(f"|A|≈{a.estimate():.0f} |B|≈{b.estimate():.0f} "
          f"|A∪B|≈{u.estimate():.0f} |A∩B|≈{inter:.0f} (true 300/300/500/100)")
```

**Expected output:** estimates close to `|A|≈300, |B|≈300, |A∪B|≈500, |A∩B|≈100`. Key talking points: union is **exact** (OR of bit arrays), the Swamidass–Baldi inversion recovers cardinality from the fill, and inclusion–exclusion gives a cheap overlap estimate — all without storing a single item.

---

Next step: [tasks.md](./tasks.md) — hands-on Bloom filter practice tasks in Go, Java, and Python.

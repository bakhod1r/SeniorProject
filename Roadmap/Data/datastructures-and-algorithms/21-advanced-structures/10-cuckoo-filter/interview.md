# Cuckoo Filter — Interview Preparation

> Tiered Q&A (Junior → Middle → Senior → Professional) followed by a full coding challenge in Go, Java, and Python. Each answer is written so you can speak it aloud in 30–90 seconds.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Coding Challenge](#coding-challenge)

---

## Junior Questions

**Q1. What is a cuckoo filter and what problem does it solve?**
It is an approximate set-membership data structure: it answers "is `x` in the set?" using very little memory by storing a short **fingerprint** of each item instead of the item itself. Like a Bloom filter it can give **false positives** (say "yes" when the answer is no) but never false negatives. Its headline feature is that, unlike a classic Bloom filter, it supports **deletion**.

**Q2. What is a fingerprint?**
A fingerprint is a short bit-string (e.g. 8 or 12 bits) derived by hashing the item. We store the fingerprint, not the item, which is why the structure is so compact. The downside is that two different items can share a fingerprint, which causes false positives.

**Q3. How many buckets does an item map to, and why does that make lookup fast?**
Exactly **two** candidate buckets, `i1` and `i2`. A lookup only has to scan those two buckets for the fingerprint, so it is `O(1)` and touches just two cache lines — very fast and predictable.

**Q4. How do you do a lookup?**
Compute the item's fingerprint and its two candidate buckets. Scan both buckets for the fingerprint. If it appears in either, return "probably present"; if neither, return "definitely absent."

**Q5. How do you delete an item?**
Compute its fingerprint and two candidate buckets, find a matching fingerprint in either bucket, and erase it (free the slot). This is the main thing a Bloom filter cannot do, because Bloom bits are shared across many items.

**Q6. What is a false positive vs a false negative here?**
A **false positive** is saying "yes" for an item never inserted — cuckoo filters have a small, tunable rate of these. A **false negative** is saying "no" for an item that *was* inserted — a correct cuckoo filter never does this (unless you delete an item you never inserted).

**Q7. What is the "cuckoo" in the name about?**
The cuckoo bird lays eggs in other birds' nests, shoving existing eggs out. On insert, if both candidate buckets are full, the filter **kicks out** an existing fingerprint and relocates it to its alternate bucket — possibly triggering a chain of relocations.

**Q8. What is bucket size `b`?**
The number of fingerprint slots per bucket, commonly 4. Bigger buckets let the table fill up more before failing, but slightly raise the false-positive rate.

| # | Question | Answer focus |
|---|----------|--------------|
| 1 | What is a cuckoo filter? | Approximate membership, fingerprints, deletable |
| 2 | What is a fingerprint? | Short hashed bits stored instead of the item |
| 3 | How many candidate buckets? | Two; cheap lookup |
| 4 | How is lookup done? | Scan two buckets |
| 5 | How is delete done? | Erase fingerprint; Bloom can't |
| 6 | FP vs FN? | Small FP rate, no FN |
| 7 | Why "cuckoo"? | Kick-out relocation |
| 8 | What is `b`? | Slots per bucket, default 4 |

---

## Middle Questions

**Q9. Explain the XOR trick `i2 = i1 XOR hash(fingerprint)`. Why fingerprint and not the item?**
The alternate bucket is derived by XOR-ing the first index with a hash of the *fingerprint*. Because XOR is its own inverse, from *either* bucket you can recover the other using only the stored fingerprint: `i1 = i2 XOR hash(f)`. During relocation you only hold a fingerprint (the item is gone), so the partner *must* be computable from the fingerprint alone. If you used `hash(item)`, you couldn't relocate after discarding the item.

**Q10. Why must the number of buckets be a power of two?**
So the XOR operates cleanly on the index bits and the self-inverse property holds exactly. If `m` weren't a power of two, `i1 XOR hash(f)` could land outside `[0, m)` and a modulo reduction would break the involution, corrupting the invariant that every fingerprint lives in one of its two homes.

**Q11. Derive the false-positive rate.**
A query inspects two buckets of `b` slots → up to `2b` stored fingerprints. Each matches the query's `f`-bit fingerprint with probability `≈ 1/2^f`. By a union bound, `ε ≈ 2b/2^f`. So each extra fingerprint bit halves the FPR, and doubling the bucket size roughly doubles it.

**Q12. How do you size the fingerprint for a target FPR?**
Solve `ε ≈ 2b/2^f` for `f`: `f ≥ log2(2b/ε)`. For `ε = 1%` with `b = 4`, that's `log2(800) ≈ 9.6`, so use 10 bits.

**Q13. What is the load factor and what's the practical maximum?**
Load factor `α = items / (m·b)`. With `b = 4` you can run to about **95%** before inserts start failing; `b = 1` only reaches ~50%, `b = 8` ~98%. Larger buckets allow higher load.

**Q14. What happens when an insert fails?**
The relocation chain exceeds `MaxKicks` (e.g. 500) because the table is too full. You must resize/rehash, reject the insert, or use an overflow stash. Because the table stores only fingerprints, resizing is awkward, so people usually pre-size with headroom.

**Q15. Cuckoo filter vs Bloom filter — give the trade-offs.**
Cuckoo **supports delete**, uses **less space below ~3% FPR**, and touches only **two cache lines** per lookup. Bloom is simpler, never fails on insert, and is smaller at *higher* FPRs. Choose cuckoo when you need deletes or a low FPR; Bloom when insert-only and higher FPR is acceptable.

**Q16. Why can deleting an item you never inserted be dangerous?**
Two items can share a fingerprint and a candidate bucket. Deleting a non-member may erase a fingerprint that actually belongs to a real member, introducing a **false negative**. Rule: only delete known members ("delete-if-present").

| # | Question | Answer focus |
|---|----------|--------------|
| 9 | XOR trick | Self-inverse; partner from fingerprint |
| 10 | Power-of-two `m` | Keeps XOR involution valid |
| 11 | Derive FPR | Union bound → `2b/2^f` |
| 12 | Size fingerprint | `f ≥ log2(2b/ε)` |
| 13 | Load factor max | ~95% at `b=4` |
| 14 | Insert failure | Resize/reject/stash |
| 15 | vs Bloom | Delete, low-FPR space, cache |
| 16 | Bad delete risk | False negative on non-member |

---

## Senior Questions

**Q17. Where would you deploy a cuckoo filter in a real system?**
In front of an expensive lookup that changes over time: SSTable/LSM key-presence filters (compaction removes keys), TTL-based deduplication, cache admission policies, network blocklists, distributed dedup. The combination of low FPR, deletability, and two-cache-line lookups is what makes it a good fit.

**Q18. Walk through sizing a filter for 100M items at 0.1% FPR.**
`f = ceil(log2(2·4/0.001)) = 13` bits. Target load `α = 0.90`, so `slots = 1e8/0.9 ≈ 111M`, `m = next_pow2(111M/4) = 33.5M` buckets. Total ≈ `m·b·f/8 ≈ 218 MB`. I'd leave headroom below the 95% cliff and monitor load factor.

**Q19. How do you handle insert failure in production?**
Three options: (A) pre-size for peak at ~90% load and treat any failure as a capacity alarm; (B) resize/rehash — hard since only fingerprints are stored, so you need retained keys or split-bits; (C) keep a small **overflow stash** (exact set) that lookups also check. I default to A plus a small stash as a safety net.

**Q20. How do you keep the filter consistent with the backing store under churn?**
**Delete-on-evict**: whenever the store removes a key (TTL, eviction, compaction), delete its fingerprint from the filter in the same write path. Otherwise the filter drifts toward permanent "probably present," which is the classic failure of Bloom filters under heavy churn.

**Q21. Cuckoo vs counting Bloom vs quotient filter — when each?**
Cuckoo: delete + low FPR + tight memory. Counting Bloom: delete + you need **multiplicity counts**, and you can afford ~4× the space. Quotient filter: delete + you need **easier resize/merge** and sequential memory access. All three support delete; the differentiators are space, counts, and resizability.

**Q22. How does it behave under concurrency?**
The simplest safe design is a read-write lock: many concurrent lookups, exclusive inserts (because relocation mutates multiple buckets). Lock-free variants exist but are tricky because a relocation chain spans several buckets atomically. For high write rates, shard the filter and lock per shard.

**Q23. Is a cuckoo filter mergeable and persistable?**
Persistable trivially — it's a flat fingerprint array, so you serialize `m, b, f` and the bytes. Mergeable if two filters share `m, b, f` and hashes: re-insert one's fingerprints into the other, subject to capacity (unlike Bloom's free bitwise-OR merge).

| # | Question | Answer focus |
|---|----------|--------------|
| 17 | Where to deploy | LSM filters, dedup, cache, blocklists |
| 18 | Sizing 100M @ 0.1% | f=13, ~218 MB, headroom |
| 19 | Insert failure | Pre-size / resize / stash |
| 20 | Churn consistency | Delete-on-evict |
| 21 | vs counting/quotient | Space, counts, resize |
| 22 | Concurrency | RW lock or sharding |
| 23 | Merge/persist | Flat array; re-insert merge |

---

## Professional Questions

**Q24. Prove the filter never returns a false negative for an inserted item.**
By the membership invariant `I(B)`: every inserted item's fingerprint resides in one of its two candidate buckets. This is preserved through relocation because each hop moves a fingerprint only between *its own* two homes — guaranteed by the XOR involution `j' = j XOR hash(f)` (Lemma 1). Since lookup scans exactly those two buckets, a member's fingerprint is always found. The only breach is deleting a non-member, which can remove a colliding member's fingerprint.

**Q25. Give the precise FPR bound, not just the approximation.**
Exactly `ε = 1 - (1 - 1/(2^f-1))^{2b} ≤ 2b/(2^f-1) ≈ 2b/2^f`. By inclusion–exclusion the lower bound is `2b·2^{-f} - C(2b,2)·2^{-2f}`, so `2b/2^f` is tight to first order. Accounting for load `α`, the expected occupancy gives the refined `ε ≈ 2bα/2^f`.

**Q26. Explain the load-factor limit as a phase transition.**
Model items as edges of a random graph whose vertices are buckets; placing items with bucket capacity `b` equals finding a `b`-orientation. Such an orientation exists with high probability iff load is below the orientability threshold `α*_b` (≈0.5, 0.84, 0.95, 0.98 for `b = 1,2,4,8`). Below threshold, relocation chains are `O(1)` expected and failure is polynomially rare; above it, no orientation exists w.h.p. and inserts fail — a genuine phase transition, which is why the ~95% cliff at `b=4` is sharp.

**Q27. Prove the space crossover with Bloom filters.**
Bloom: `1.44·log2(1/ε)` bits/item. Cuckoo: `(log2(1/ε)+log2(2b))/α` bits/item. Setting cuckoo `<` Bloom with `b=4, α=0.95` gives `log2(1/ε) > 8.15`, i.e. `ε < ~0.35%` for the standard filter. The **semi-sorted** variant saves ~1 bit/item, shifting the crossover to `ε ≈ 3%`. Below that FPR, cuckoo is strictly smaller *and* supports deletion.

**Q28. Why does the partial-key alternate bucket slightly reduce achievable load?**
Because `hash(fingerprint)` takes only `≤ 2^f` distinct values, the second candidate bucket is not perfectly uniform given the first — the two endpoints of the cuckoo-graph edge are correlated. This makes the random graph denser in places and lowers the practical orientability slightly below the theoretical uniform-graph threshold.

**Q29. Amortized insert cost?**
Below the load threshold, cuckoo-graph components have bounded expected size, so the relocation random walk terminates in expected `O(1)` hops; summed over `n` inserts the total relocation work is `O(n)`, i.e. amortized `O(1)` per insert. Worst case per insert is `O(MaxKicks)`.

**Q30. Cache behavior vs Bloom?**
A cuckoo lookup touches exactly 2 buckets → at most 2 cache misses regardless of `n`. A Bloom lookup probes `k = ln2·log2(1/ε)` *distinct random* bit positions → up to `k` misses (≈10 at 0.1% FPR). So even at similar bit counts, cuckoo has far better p99 lookup latency on real memory hierarchies.

| # | Question | Answer focus |
|---|----------|--------------|
| 24 | No false negative proof | Invariant + XOR involution |
| 25 | Exact FPR bound | `1-(1-2^{-f})^{2b}`, tight first order |
| 26 | Load as phase transition | `b`-orientation threshold |
| 27 | Space crossover proof | `<3%` semi-sort, `<0.35%` std |
| 28 | Partial-key load penalty | Non-uniform alt bucket |
| 29 | Amortized insert | Expected O(1) below threshold |
| 30 | Cache vs Bloom | 2 misses vs k |

---

## Rapid-Fire Round

| Question | One-line answer |
|----------|-----------------|
| Lookup time? | O(1), two buckets. |
| Delete time? | O(1), two buckets. |
| Insert worst case? | O(MaxKicks). |
| FPR formula? | `ε ≈ 2b/2^f`. |
| Default bucket size? | 4. |
| Max load at `b=4`? | ~95%. |
| Why power-of-two `m`? | XOR involution stays valid. |
| Alternate bucket? | `i2 = i1 XOR hash(fingerprint)`. |
| Reserved fingerprint value? | 0 = empty slot. |
| Beats Bloom on space below? | ~3% FPR (semi-sorted). |
| Can it produce false negatives? | Only if you delete a non-member. |
| Cache misses per lookup? | 2. |
| What graph models insertability? | The cuckoo graph (buckets = vertices, items = edges). |
| Insert above the load threshold? | Likely fails — it's a phase transition. |
| Mergeable like Bloom's OR? | No — must re-insert fingerprints, capacity-bounded. |
| Information-theoretic overhead at low FPR? | ~5% over optimum (vs Bloom's 44%). |

---

## System-Design Mini-Scenarios

These are the "design a system" follow-ups interviewers attach after the conceptual questions. Speak the trade-off, not just the data structure.

**S1. "Design the per-SSTable key filter for an LSM store."**
Each SSTable gets its own cuckoo filter, sized for the keys in that file, persisted alongside the data. On read, check the filter before touching the file — "absent" skips the I/O entirely. When compaction rewrites/merges files, build a fresh filter for the new file; the old filters are simply dropped. Cuckoo over Bloom here because compaction *removes* keys and we want a low FPR to maximize skipped reads.

**S2. "Build a deduplication service with a 24-hour window."**
Insert each event id's fingerprint; on lookup, "present" means duplicate. A background sweeper deletes fingerprints of events older than 24h (delete-on-expiry). Size for the *peak* live count over the window, not the average, and target 0.90 load. Monitor load factor to catch traffic spikes before inserts fail.

**S3. "A teammate proposes a plain Bloom filter for a churning blocklist. Push back."**
A blocklist that adds and *removes* entries cannot use a plain Bloom filter — it cannot delete, so removed entries stay "probably blocked" forever, eventually blocking everything. A cuckoo filter (or counting Bloom) handles removal. If they only ever add, Bloom is fine and simpler.

**S4. "How would you shard a 10 TB membership set across machines?"**
Route each key by a top-level hash to one of `k` shards, each holding an independently-sized cuckoo filter. A query hashes to its shard and probes only that filter. This keeps each filter cache-resident and lets you scale horizontally; the cost is that cross-shard merges require re-insertion.

---

## Coding Challenge

### Challenge: Implement a cuckoo filter supporting `insert`, `lookup`, and `delete`

> Build a cuckoo filter with 8-bit fingerprints and bucket size 4. It must:
> - never return a false negative for an inserted (and not-yet-deleted) item,
> - support deletion of inserted items,
> - relocate fingerprints via the XOR trick, capped at `MaxKicks`.
>
> **Verification:** insert 1..N, assert all are found; delete the even ones, assert evens are gone and odds remain; measure the false-positive rate on never-inserted keys and assert it is small.

#### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"math/rand"
)

const (
	bucketSize = 4
	maxKicks   = 500
)

type CuckooFilter struct {
	buckets [][bucketSize]byte
	m       uint32
}

func New(m uint32) *CuckooFilter {
	// round m up to a power of two
	p := uint32(1)
	for p < m {
		p <<= 1
	}
	return &CuckooFilter{buckets: make([][bucketSize]byte, p), m: p}
}

func h64(s string) uint64 { h := fnv.New64a(); h.Write([]byte(s)); return h.Sum64() }
func fp(h uint64) byte {
	f := byte(h)
	if f == 0 {
		f = 1
	}
	return f
}
func (c *CuckooFilter) idx(h uint64) uint32 { return uint32(h>>32) & (c.m - 1) }
func (c *CuckooFilter) alt(i uint32, f byte) uint32 {
	return (i ^ c.idx(h64(fmt.Sprintf("fp%d", f)))) & (c.m - 1)
}
func (c *CuckooFilter) put(i uint32, f byte) bool {
	for s := 0; s < bucketSize; s++ {
		if c.buckets[i][s] == 0 {
			c.buckets[i][s] = f
			return true
		}
	}
	return false
}

func (c *CuckooFilter) Insert(item string) bool {
	h := h64(item)
	f := fp(h)
	i1 := c.idx(h)
	i2 := c.alt(i1, f)
	if c.put(i1, f) || c.put(i2, f) {
		return true
	}
	i := i1
	if rand.Intn(2) == 1 {
		i = i2
	}
	for n := 0; n < maxKicks; n++ {
		s := rand.Intn(bucketSize)
		f, c.buckets[i][s] = c.buckets[i][s], f
		i = c.alt(i, f)
		if c.put(i, f) {
			return true
		}
	}
	return false
}

func (c *CuckooFilter) Lookup(item string) bool {
	h := h64(item)
	f := fp(h)
	i1 := c.idx(h)
	i2 := c.alt(i1, f)
	for _, i := range []uint32{i1, i2} {
		for s := 0; s < bucketSize; s++ {
			if c.buckets[i][s] == f {
				return true
			}
		}
	}
	return false
}

func (c *CuckooFilter) Delete(item string) bool {
	h := h64(item)
	f := fp(h)
	i1 := c.idx(h)
	i2 := c.alt(i1, f)
	for _, i := range []uint32{i1, i2} {
		for s := 0; s < bucketSize; s++ {
			if c.buckets[i][s] == f {
				c.buckets[i][s] = 0
				return true
			}
		}
	}
	return false
}

func main() {
	cf := New(1 << 14)
	N := 8000
	for i := 1; i <= N; i++ {
		cf.Insert(fmt.Sprintf("item-%d", i))
	}
	allFound := true
	for i := 1; i <= N; i++ {
		if !cf.Lookup(fmt.Sprintf("item-%d", i)) {
			allFound = false
		}
	}
	for i := 2; i <= N; i += 2 {
		cf.Delete(fmt.Sprintf("item-%d", i))
	}
	evenGone, oddPresent := true, true
	for i := 1; i <= N; i++ {
		f := cf.Lookup(fmt.Sprintf("item-%d", i))
		if i%2 == 0 && f {
			evenGone = false
		}
		if i%2 == 1 && !f {
			oddPresent = false
		}
	}
	fp := 0
	trials := 20000
	for i := 0; i < trials; i++ {
		if cf.Lookup(fmt.Sprintf("absent-%d", i)) {
			fp++
		}
	}
	fmt.Printf("allFound=%v evenGone=%v oddPresent=%v FPR=%.4f\n",
		allFound, evenGone, oddPresent, float64(fp)/float64(trials))
}
```

#### Java

```java
import java.util.Random;

public class CuckooFilter {
    static final int BUCKET_SIZE = 4, MAX_KICKS = 500;
    final byte[][] buckets;
    final int m;
    final Random rng = new Random();

    CuckooFilter(int m) {
        int p = 1; while (p < m) p <<= 1;
        this.m = p; buckets = new byte[p][BUCKET_SIZE];
    }
    long h64(String s){
        long h=1125899906842597L;
        for(int i=0;i<s.length();i++) h=31*h+s.charAt(i);
        h^=(h>>>33); h*=0xff51afd7ed558ccdL; h^=(h>>>33); return h;
    }
    byte fp(long h){ byte f=(byte)h; return f==0?1:f; }
    int idx(long h){ return (int)((h>>>32)&(m-1)); }
    int alt(int i, byte f){ return (i ^ idx(h64("fp"+(f&0xFF)))) & (m-1); }
    boolean put(int i, byte f){
        for(int s=0;s<BUCKET_SIZE;s++) if(buckets[i][s]==0){buckets[i][s]=f;return true;}
        return false;
    }
    boolean insert(String item){
        long h=h64(item); byte f=fp(h); int i1=idx(h), i2=alt(i1,f);
        if(put(i1,f)||put(i2,f)) return true;
        int i=rng.nextBoolean()?i1:i2;
        for(int n=0;n<MAX_KICKS;n++){
            int s=rng.nextInt(BUCKET_SIZE); byte v=buckets[i][s];
            buckets[i][s]=f; f=v; i=alt(i,f);
            if(put(i,f)) return true;
        }
        return false;
    }
    boolean lookup(String item){
        long h=h64(item); byte f=fp(h); int i1=idx(h), i2=alt(i1,f);
        for(int i:new int[]{i1,i2})
            for(int s=0;s<BUCKET_SIZE;s++) if(buckets[i][s]==f) return true;
        return false;
    }
    boolean delete(String item){
        long h=h64(item); byte f=fp(h); int i1=idx(h), i2=alt(i1,f);
        for(int i:new int[]{i1,i2})
            for(int s=0;s<BUCKET_SIZE;s++) if(buckets[i][s]==f){buckets[i][s]=0;return true;}
        return false;
    }
    public static void main(String[] a){
        CuckooFilter cf=new CuckooFilter(1<<14); int N=8000;
        for(int i=1;i<=N;i++) cf.insert("item-"+i);
        boolean allFound=true;
        for(int i=1;i<=N;i++) if(!cf.lookup("item-"+i)) allFound=false;
        for(int i=2;i<=N;i+=2) cf.delete("item-"+i);
        boolean evenGone=true, oddPresent=true;
        for(int i=1;i<=N;i++){
            boolean f=cf.lookup("item-"+i);
            if(i%2==0 && f) evenGone=false;
            if(i%2==1 && !f) oddPresent=false;
        }
        int fp=0, trials=20000;
        for(int i=0;i<trials;i++) if(cf.lookup("absent-"+i)) fp++;
        System.out.printf("allFound=%b evenGone=%b oddPresent=%b FPR=%.4f%n",
            allFound, evenGone, oddPresent, (double)fp/trials);
    }
}
```

#### Python

```python
import random


class CuckooFilter:
    BUCKET_SIZE = 4
    MAX_KICKS = 500

    def __init__(self, m):
        p = 1
        while p < m:
            p <<= 1
        self.m = p
        self.buckets = [[0] * self.BUCKET_SIZE for _ in range(p)]

    @staticmethod
    def _h64(s):
        return hash(("seed", s)) & 0xFFFFFFFFFFFFFFFF

    def _fp(self, h):
        f = h & 0xFF
        return f if f else 1

    def _idx(self, h):
        return (h >> 32) & (self.m - 1)

    def _alt(self, i, f):
        return (i ^ self._idx(self._h64(f"fp{f}"))) & (self.m - 1)

    def _put(self, i, f):
        for s in range(self.BUCKET_SIZE):
            if self.buckets[i][s] == 0:
                self.buckets[i][s] = f
                return True
        return False

    def insert(self, item):
        h = self._h64(item)
        f = self._fp(h)
        i1 = self._idx(h)
        i2 = self._alt(i1, f)
        if self._put(i1, f) or self._put(i2, f):
            return True
        i = random.choice((i1, i2))
        for _ in range(self.MAX_KICKS):
            s = random.randrange(self.BUCKET_SIZE)
            f, self.buckets[i][s] = self.buckets[i][s], f
            i = self._alt(i, f)
            if self._put(i, f):
                return True
        return False

    def lookup(self, item):
        h = self._h64(item)
        f = self._fp(h)
        i1 = self._idx(h)
        i2 = self._alt(i1, f)
        return f in self.buckets[i1] or f in self.buckets[i2]

    def delete(self, item):
        h = self._h64(item)
        f = self._fp(h)
        i1 = self._idx(h)
        i2 = self._alt(i1, f)
        for i in (i1, i2):
            for s in range(self.BUCKET_SIZE):
                if self.buckets[i][s] == f:
                    self.buckets[i][s] = 0
                    return True
        return False


if __name__ == "__main__":
    cf = CuckooFilter(1 << 14)
    N = 8000
    for i in range(1, N + 1):
        cf.insert(f"item-{i}")
    all_found = all(cf.lookup(f"item-{i}") for i in range(1, N + 1))
    for i in range(2, N + 1, 2):
        cf.delete(f"item-{i}")
    even_gone = all(not cf.lookup(f"item-{i}") for i in range(2, N + 1, 2))
    odd_present = all(cf.lookup(f"item-{i}") for i in range(1, N + 1, 2))
    trials = 20000
    fp = sum(1 for i in range(trials) if cf.lookup(f"absent-{i}"))
    print(f"all_found={all_found} even_gone={even_gone} "
          f"odd_present={odd_present} FPR={fp/trials:.4f}")
```

**Expected output (approximately):** `allFound=true evenGone=true oddPresent=true FPR≈0.03` (the exact FPR depends on fingerprint length and load; with 8-bit fingerprints and `b=4` it is on the order of `2b/2^f = 8/256 ≈ 3%`).

**Talking points while coding:** reserve `0` for empty; force the bucket count to a power of two so the XOR masking works; derive both the index and fingerprint from one hash; cap relocation at `MaxKicks`; and note that deleting the even items must leave the odd items fully intact — that is the property a Bloom filter cannot provide.

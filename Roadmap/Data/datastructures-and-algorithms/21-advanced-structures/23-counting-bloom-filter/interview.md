# Counting Bloom Filter — Interview Preparation

> Tiered questions (Junior → Middle → Senior → Professional) followed by a multi-language coding challenge. Answers are concise but complete — expand on the math and the deletion-correctness argument where the interviewer probes. Assumes familiarity with the plain Bloom filter ([`02-bloom-filter/interview.md`](../02-bloom-filter/interview.md)).

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Behavioral / Design Discussion Prompts](#behavioral--design-discussion-prompts)
7. [Coding Challenge](#coding-challenge)

---

## Junior Questions

**Q1. What is a counting Bloom filter?**
> A Bloom filter where each slot holds a small **counter** (typically 4 bits) instead of a single bit. Insert **increments** the `k` counters an item hashes to; delete **decrements** them; query returns "present" only if all `k` counters are `> 0`. The counter is what enables **deletion**, which a plain Bloom filter can't do.

**Q2. What does a counting Bloom filter give you that a plain Bloom filter doesn't?**
> **Deletion.** A plain Bloom filter can't remove items because clearing a shared bit could break another item (false negative). The CBF's counters remember how many items use each slot, so deleting one item only decrements the count, leaving slots other items still need.

**Q3. How do insert, delete, and query work?**
> Compute the same `k` positions via hashing. **Insert:** `+1` each counter. **Delete:** `−1` each counter. **Query:** true iff all `k` counters are `> 0`.

**Q4. Why can a CBF delete safely when a Bloom filter can't?**
> Because decrementing only *lowers* a shared counter. If `cat` and `dog` both use a slot, its counter is `2`; deleting `cat` drops it to `1` — still positive — so `dog` is unharmed. A Bloom filter's single bit can't record that two items share it, so clearing it would erase `dog`.

**Q5. What's the cost of this deletion ability?**
> Memory: a 4-bit counter is 4× the size of a 1-bit slot, so a CBF uses about **4× the memory** of an equivalent Bloom filter.

**Q6. What does it mean for a slot to be "set" in a CBF?**
> Its counter is `> 0`. A counter of `0` means no current item uses that slot. Query only checks `0` vs `> 0`; the exact value matters only for delete.

**Q7. Does the CBF have false positives? False negatives?**
> Same as a Bloom filter: **false positives** yes (tunable), **false negatives** no — provided you delete only inserted items and counters don't overflow. A "no" is trustworthy; a "yes" is "probably."

**Q8. What is counter overflow and how is it handled?**
> A 4-bit counter maxes at 15. If a 16th item hashes there, you must **not** wrap to 0 (that would un-set a live slot → false negative). Instead the counter **saturates** (clamps) at 15 and stays there permanently — which can only cause extra false positives, never false negatives.

**Q9. What happens if you query a counter that's 0?**
> Return "absent" immediately (early exit). One `0` counter is conclusive proof the item isn't currently in the set.

**Q10. Give a real use case for a CBF over a Bloom filter.**
> A network **flow table**: flows start (insert the 5-tuple) and end (delete it). A Bloom filter couldn't remove ended flows and would fill up; the CBF deletes them, keeping membership current.

**Q11. If your set only ever grows, should you use a CBF?**
> No — use a plain Bloom filter. It's 4× smaller and you never need delete. The CBF only pays off when items are removed.

**Q11b. What does the actual *value* of a counter tell you?**
> How many currently-inserted items hash to that slot. For a membership query the value doesn't matter — only whether it's `0` or `> 0`. The value matters only for `delete`, so you know when a slot can safely return to `0`.

**Q11c. If two different items hash to the same slot, what's the counter?**
> `2` (each contributed `+1`). That's exactly why deletion is safe: removing one drops it to `1`, still positive, so the other item is unaffected.

---

## Middle Questions

**Q12. How do you size a counting Bloom filter?**
> Exactly like a Bloom filter: `m = −n·ln p / (ln 2)²` slots, `k = round((m/n)·ln 2)`, FPR `≈ (1 − e^(−kn/m))^k`. The only extra choice is the **counter width** (4 bits standard). Then total memory = `m × counter_bits`.

**Q13. Why are 4-bit counters enough?**
> At the optimal `k`, each counter is `≈ Poisson(λ = kn/m = ln 2 ≈ 0.69)` — small. The chance a counter reaches 16 is `≈ (ln2)^16/16! ≈ 10⁻¹⁶`; even across a billion counters you essentially never overflow. This is the Fan-et-al. (2000) result.

**Q14. What's the false-positive-rate formula for a CBF?**
> The same as a Bloom filter, `p ≈ (1 − e^(−kn/m))^k`, because a query only tests `counter > 0` (the analog of a `1` bit). There's a negligible extra term from saturated counters.

**Q15. How much more memory does a CBF use than a Bloom filter, and why?**
> About **4×**, because each slot is a 4-bit counter instead of a 1-bit flag. Same `m` and `k`, just `4×` the bits.

**Q16. When do you actually *need* deletes (and thus a CBF)?**
> When the membership set **churns** — items added *and* removed over time: caches with expiry, flow tables, sliding-window dedup, dictionaries with departures. If the set only grows, a Bloom filter suffices.

**Q17. Counting Bloom filter vs cuckoo filter — which to pick?**
> Both delete. The **cuckoo filter** is ~3× smaller (≈12–13 bits/key vs ≈40 for a 4-bit CBF) — pick it when space is tight. The **CBF** wins when you need OR-style **mergeability** (counter-wise add/subtract), simple lock-light concurrency, no insertion-failure mode, or frequency info.

**Q18. What's the danger in deleting an item that was never inserted?**
> **Underflow** that creates false negatives. Decrementing counters this item didn't set can push a counter another *real* member needs down to 0, so that member then queries as "absent." Always delete only inserted items; clamp at 0 to at least avoid wraparound.

**Q19. Why must you saturate (not wrap) on overflow, and not decrement a saturated counter?**
> Wrapping `15 → 0` un-sets a slot still in use → false negative. Once saturated, the true count is lost, so decrementing it could desync it from reality → future false negatives. Leave saturated counters pinned at max; they only add false positives.

**Q20. How does a CBF's FPR behave as you delete items, vs a Bloom filter?**
> A CBF's FPR **drops** as items are deleted, because `n` in the formula is the current live count. A Bloom filter's FPR only ever **rises** (it can't delete). Tracking FPR down is a core CBF advantage.

**Q21. Same item inserted twice, then deleted once — is it still "present"?**
> Yes. Its counters were incremented twice; one delete leaves them `≥ 1`, so the query still says "present." Insert each distinct item once, or track multiplicity deliberately.

**Q22. Can you merge two counting Bloom filters?**
> Yes — **counter-wise addition** (saturating), giving the multiset union. You can also **subtract** to remove an entire filter's contribution. Both require identical `(m, k, counter-width, seed)`.

**Q23. How do counters relate to a Count-Min sketch?**
> A CBF's counters are a degenerate (membership-only) Count-Min: a **spectral Bloom filter** stores actual counts and returns `min` of an item's `k` counters as a frequency estimate — the same "take the min" idea as Count-Min, with a one-sided overestimate.

**Q23b. Why is a CBF's per-operation cost higher than a Bloom filter's even though both are O(k)?**
> A Bloom filter `insert` does a single bit-OR (write only); a CBF `insert`/`delete` does a **read-modify-write** per counter (read the value, modify, write back), so the memory traffic per op is higher, and packed 4-bit counters add nibble masking. Same asymptotic `O(k)`, larger constant.

**Q23c. Can a CBF ever give a different membership answer than a Bloom filter built from the same inserts (no deletes)?**
> No. With no deletes and no overflow, a counter is `> 0` exactly when the corresponding Bloom bit is `1`, so membership is identical and the FPR formula is the same. The CBF only diverges once you delete (which a Bloom filter can't) or a counter saturates.

---

## Senior Questions

**Q24. Design a network flow-table membership filter with a CBF.**
> Hash each 5-tuple to `k` positions. On a new flow (SYN): filter says "absent" → install state, `add` the 5-tuple. On teardown (FIN/timeout): `delete` the 5-tuple so its counters drop. Size `m`/`k` for **peak concurrent flows**, 4-bit counters in SRAM. Deletion keeps the FPR proportional to *active* flows instead of letting it rot toward 1.

**Q25. Why is a plain Bloom filter wrong for a flow table?**
> It can't remove ended flows, so it accumulates *all* flows ever seen; within seconds on a busy link it overfills and its FPR races to 1. The CBF deletes ended flows, holding the live set near peak concurrency.

**Q26. How do you size a CBF for a churning workload?**
> Size the array (`m`, `k`) for **peak concurrent** present items (not cumulative inserts) — deletions keep the live count bounded. Then verify, under the *real* churn, that the counter histogram stays well below 15; if dirty churn inflates counts, widen to 8-bit or fix the churn discipline.

**Q27. What's a d-left counting Bloom filter?**
> A CBF built on a **d-left hash table** with fingerprints, using power-of-d-choices balanced allocation. Because bucket loads are very even (max load `≈ ln ln n`), cells are tiny — about **2× smaller** than a plain CBF at the same FPR, still deletable. A precursor to the cuckoo filter.

**Q28. What's a spectral Bloom filter?**
> A CBF generalized to **frequency** queries: counters store insertion counts, and a query returns `min` of the item's `k` counters as a frequency estimate. It uses variable/compressed-width counters and supports insert, delete, and "how many times seen?" — a deletable frequency sketch.

**Q29. How do you make a CBF concurrent?**
> Insert/delete are read-modify-write, so use **atomic add/subtract (CAS loops)** per counter, with saturating increment and clamped decrement; or stripe locks per word. It's slightly more involved than a Bloom filter's atomic OR because you both read and write.

**Q30. How does a CBF support distributed membership where nodes come and go?**
> Each node builds a local CBF; merge by **counter-wise addition** for the union. When a node leaves, **subtract** its counters to remove its contribution exactly — something OR-merged Bloom filters can't do, because OR discards the count.

**Q31. What's a blocked counting Bloom filter and why use it?**
> Confine all `k` counters of an item to one cache-line-sized block (first hash picks the block). This turns up to `k` read-modify-write cache misses into one, a 2–4× latency win on large filters, at a slightly higher FPR (counters crowd one block).

**Q32. Your CBF's live-count estimate keeps climbing even though items are being removed. What's wrong?**
> **Missed deletes** — departures aren't reliably reaching the filter (lost FIN, crashed expiry timer). The live count and FPR creep up, the exact rot the CBF was meant to avoid. Fix with idempotent expiry, periodic rebuild, and monitoring `present_count`.

**Q33. When would you rebuild a CBF from scratch?**
> Tiny errors accumulate over months (a missed delete, a saturated counter that never drops). Schedule a periodic **reconciliation rebuild** from the source of truth to reset drift — the CBF's analog of garbage collection.

**Q34s. A CDN team wants a time-decaying "seen-before" filter for cache admission. CBF or rotating Bloom filters?**
> Both work. A **CBF** lets you `delete` individual entries as objects leave the cache or admission records expire, giving exact sliding-window semantics at `4×` memory. **Rotating two Bloom filters** (swap on a time boundary, query the union) gives coarse decay at `1×` memory with no per-entry deletes. Pick the CBF if you need precise per-key expiry; rotation if approximate windowing and minimal memory suffice. Many production CDNs use rotation for its simplicity unless exact expiry is required.

**Q35s. How would you shard a CBF across machines and still answer global membership?**
> Each shard owns a key range and keeps a local CBF; a global query routes to the owning shard (the cheap case), or, if any node may ask about any key, periodically **sum** all shard filters counter-wise into a global CBF and broadcast it. Summation is exact (multiset union), and you can **subtract** a departing shard's filter — the CBF's edge over OR-merged Bloom filters and (un-mergeable) cuckoo filters. Pin `(m, k, width, seed)` across shards.

---

## Professional Questions

**Q34. Derive the distribution of a single counter.**
> With `kn` placements thrown uniformly into `m` slots, a counter is `Binomial(kn, 1/m) ≈ Poisson(λ)` with `λ = kn/m`. At the optimal `k = (m/n)ln2`, `λ = ln 2 ≈ 0.693`, so counters are mostly 0 or 1.

**Q35. Derive the counter-overflow probability and justify 4 bits.**
> By the Poisson tail, `Pr[counter ≥ 2^c] ≈ λ^(2^c)/(2^c)!`. For `c = 4` (`2^c = 16`) at `λ = ln2`: `(ln2)^16/16! ≈ 1.4×10⁻¹⁶` per counter. Across `m = 10⁹` counters the expected overflows are `≈ 10⁻⁷` — essentially never. Hence 4 bits suffice; 3 bits leaves ~1000/billion, 2 bits overflows constantly.

**Q36. Prove the CBF has no false negatives under clean usage.**
> Invariant: absent overflow, `A[i] = Σ_{current members x} #{j : h_j(x)=i}`. It holds at init (all 0) and is preserved by insert (`+1` per placement) and delete-of-a-member (`−1` per placement, never below remaining members' demand). For any member `y`, each of `y`'s slots includes `y`'s own contribution, so `A[h_j(y)] ≥ 1` for all `j` → `query(y) = true`. ∎

**Q37. What are the *only* two ways deletion creates a false negative?**
> (1) **Underflow** — deleting an item never inserted decrements counters real members need, possibly to 0. (2) **Decrementing a saturated counter** — its true count was lost on overflow, so further decrements desync it. Both are usage/overflow violations of the invariant; under clean usage (delete only inserted items, saturate-and-don't-decrement) the guarantee holds.

**Q38. State the CBF's FPR including the overflow correction.**
> `p_CBF ≈ (1 − e^(−kn/m))^k · (1 + O(kσ))` where `σ ≈ λ^(2^c)/(2^c)!` is the per-slot saturation probability. With 4-bit counters `σ ≈ 10⁻¹⁶`, so the correction is negligible and `p_CBF ≈ (1 − e^(−kn/m))^k` — the Bloom formula.

**Q39. How much space does a CBF use vs the AMQ lower bound?**
> The static AMQ floor is `n·log₂(1/ε)` bits. A 4-bit CBF uses `4·1.4427·n·log₂(1/ε) = 5.77·n·log₂(1/ε)` — about **5.77× the floor** (the Bloom filter's `1.44×` times the counter's `4×`). It's the least space-efficient deletable filter; d-left (`~2.9×`) and cuckoo (`~1.05×`) recover most of the gap.

**Q40. Why are the d-left and cuckoo variants smaller? Use balls-in-bins.**
> Single-choice max load is `Θ(ln m / ln ln m)`, forcing every counter to cover the worst bin. The **power of d choices** (place in least-loaded of `d` bins) drops max load to `Θ(ln ln m)` — doubly-logarithmic — so cells shrink (~2× for d-left). Cuckoo hashing adds relocation to reach ~95% load with short fingerprints, near the floor. Placement freedom buys space; the plain CBF has none.

**Q41. Explain the spectral Bloom filter's frequency estimate and its error.**
> Store counts; estimate `f̂_x = min_j A[h_j(x)]`. Every counter is `≥ f_x` (collisions only add), so the min is a one-sided **overestimate**. In Count-Min terms, with `m' = e/η` counters/row and `k = ln(1/δ)` rows, `Pr[f̂_x ≤ f_x + ηN] ≥ 1 − δ` for stream weight `N`.

**Q42. Prove merge-by-addition is exact and that subtraction is valid.**
> By the invariant, `C_A[i] = Σ_{x∈A} placements`, `C_B[i] = Σ_{y∈B} placements`; their sum equals the from-scratch filter for `A ⊎ B`. Subtraction recovers `C_A = C_+ − C_B`, removing a node's contribution exactly — possible because counters retain multiplicity that a Bloom filter's OR discards.

**Q43. Why is the expectation-based FPR formula reliable on a single CBF instance?**
> The number of set slots `X = Σ 1[A[i]>0]` concentrates: `E[X] = mρ`, `Var[X] ≤ mρ(1−ρ)` (the `Y_i` are negatively associated), and a McDiarmid bound (one item moves `X` by ≤ `k`) gives `Pr[|X−E[X]| ≥ λ'] ≤ 2exp(−λ'²/(2nk²))`. So `X/m → ρ` with exponentially small deviation, and the realized FPR ≈ `ρ^k` matches the formula. The counter *values* also concentrate to the Poisson PMF, which lets you measure `λ` from a live filter.

**Q44. Over months of churn, can a correctly-used CBF still drift?**
> Yes, slowly. **Saturation is irreversible** — each insert is another chance to pin a counter at max, so the stuck-slot count is monotone non-decreasing (though glacial for 4-bit counters: < `10⁻⁴` even after `10¹²` inserts). Multiplicity bookkeeping and masked underflow add drift. The fix is a **periodic rebuild** from the source of truth — the CBF's analog of garbage collection. A CBF is only *eventually consistent with the live set* under clean discipline plus rebuild.

**Q45. Why does the half-full optimum do "double duty" in a CBF?**
> Setting `k = (m/n)ln2` makes the array half-set, which (a) **minimizes the FPR** (the Bloom result) and (b) keeps the mean counter at `λ = ln 2 ≈ 0.69`, exactly the regime where **4-bit counters don't overflow**. The FPR-optimal and overflow-safe operating points coincide — a happy structural fact.

**Q46p. Show that the CBF's FPR depends only on the count of zero vs non-zero slots, not on the counter magnitudes.**
> A query returns true iff all `k` of an item's slots are non-zero, so the only relevant per-slot quantity is `1[A[i] > 0]`, with `Pr[A[i]=0] = e^{−λ}`. The FPR is `(1 − e^{−λ})^k` regardless of how large the non-zero counters are. The magnitudes carry no membership information — they buy *only* deletion and frequency. This is the formal reason a Bloom filter (which keeps just the zero/non-zero bit) is `4×` smaller with the *same* FPR.

**Q47p. Given that, why is the plain CBF the least space-efficient deletable filter?**
> Because at the optimal load 85% of slots hold only `0` or `1` (`Pr[A∈{0,1}] = e^{−λ}(1+λ) ≈ 0.85`), so most of each 4-bit counter is unused — it provisions 4 bits everywhere for a worst case that almost never occurs. **d-left** (compact fingerprint cells via balanced allocation) and **spectral** (variable-width counters) reclaim that slack; **cuckoo** stores short fingerprints and reaches the AMQ floor. The plain CBF trades that space for dead-simple arrays, mergeability, and lock-light updates.

**Q48p. Derive the expected counter sum and use it to recover the mean counter.**
> Each insert adds exactly `k` to the total (pre-saturation), so `E[Σ A[i]] = kn`. Dividing by `m` slots gives the mean counter `E[A[i]] = kn/m = λ` — the Poisson mean, recovered from conservation rather than the per-slot binomial. At the optimum `λ = ln 2 ≈ 0.69`.

**Q49p. Compare the CBF's space to the AMQ lower bound and to other deletable filters.**
> The static AMQ floor is `n·log₂(1/ε)` bits. A 4-bit CBF uses `4·1.4427·n·log₂(1/ε) ≈ 5.77·n·log₂(1/ε)` — about `5.77×` the floor (the Bloom filter's `1.44×` times the counter's `4×`). It's the *least* space-efficient deletable filter; a **d-left CBF** is ~`2.9×` the floor and a **cuckoo filter** ~`1.05×`. The CBF keeps its overhead deliberately in exchange for simple arrays, exact merge/subtract, and lock-light updates.

---

## Rapid-Fire Round

| # | Question | Answer |
|---|----------|--------|
| 46 | Bit or counter per slot? | Counter (typically 4 bits). |
| 47 | Insert operation? | Increment `k` counters (saturate at max). |
| 48 | Delete operation? | Decrement `k` counters (clamp at 0). |
| 49 | Query operation? | All `k` counters `> 0`? |
| 50 | Space vs Bloom? | ~4× (4-bit counters). |
| 51 | FPR formula? | Same as Bloom: `(1−e^(−kn/m))^k`. |
| 52 | Counter width that suffices? | 4 bits (max 15). |
| 53 | Overflow probability at optimum? | `≈ (ln2)^16/16! ≈ 10⁻¹⁶`/counter. |
| 54 | On overflow, do what? | Saturate (clamp), never wrap. |
| 55 | Decrement a saturated counter? | No — leave it at max. |
| 56 | Delete an absent item? | Never — risks false negatives (underflow). |
| 57 | FPR as you delete items? | Falls (tracks live `n`). |
| 58 | Merge two CBFs? | Counter-wise add (and subtract). |
| 59 | Smaller deletable alternative? | Cuckoo filter (~3× smaller). |
| 60 | ~2× smaller CBF variant? | d-left counting Bloom filter. |
| 61 | Frequency-query variant? | Spectral Bloom filter (min of counters). |
| 62 | One-cache-line variant? | Blocked counting Bloom filter. |
| 63 | Mean counter at optimal `k`? | `λ = ln 2 ≈ 0.69`. |
| 64 | When NOT to use a CBF? | When the set only grows (use Bloom). |
| 65 | Two failure modes for false negatives? | Underflow; decrementing saturated counters. |
| 66 | Does FPR-optimal `k` also help overflow? | Yes — half-full ⟹ mean counter `ln 2`, overflow-safe. |
| 67 | Is a CBF eventually consistent with the live set? | Only under clean discipline + periodic rebuild. |
| 68 | Counter distribution? | `Poisson(λ=kn/m)`; `λ=ln2` at optimal `k`. |
| 69 | Bits/elem vs AMQ floor? | `5.77×` (Bloom's `1.44×` × counter's `4×`). |
| 70 | Update cost vs Bloom? | Read-modify-write (vs single bit-OR). |
| 71 | Same answer as Bloom with no deletes? | Yes — `counter>0` ⟺ bit `1`. |

---

## Behavioral / Design Discussion Prompts

These open-ended prompts test judgment, not recall — practice talking through them.

**D1. "We used a CBF and memory is 4× our budget. What now?"**
> First ask: do you truly need deletes? If the set only grows, switch to a Bloom filter (4× smaller). If you need deletes, switch to a **cuckoo filter** (~3× smaller than a CBF) or a **d-left CBF** (~2× smaller). The plain CBF is the least space-efficient deletable filter — its merit is simplicity and mergeability, not space.

**D2. "After running for weeks, real members started returning 'absent'. Why?"**
> False negatives in a CBF come from exactly two causes: **deleting items that were never inserted** (underflow draining a real member's counter) or **decrementing saturated counters**. Audit the delete path — you're probably deleting on a raw "yes" (which can be a false positive) or on events for items you never added. Authenticate deletes against the source of truth.

**D3. "Our CBF's FPR is climbing even though we delete entries. Explain."**
> Deletes aren't all landing — **missed deletes** (lost teardown events, crashed expiry timers) leave the live count climbing past the design point. Or **dirty churn** (double-inserts) inflates counters and saturates some, which never drop. Monitor the live-count estimate, counter histogram, and saturated-counter count; add idempotent expiry and a periodic rebuild.

**D4. "Should we use a CBF or a cuckoo filter for a new deletable membership service?"**
> Cuckoo if space is tight and you don't need merging — it's ~3× smaller and has O(1) lookups. CBF if you need **counter-wise merge/subtract** (distributed membership across nodes that join/leave), **simple lock-light concurrency**, **no insertion-failure mode** under load, or a path to **frequency** info via a spectral layout.

**D5. "We need approximate 'how many times have we seen this?' plus deletes. What structure?"**
> A **spectral Bloom filter** (or a Count-Min sketch with turnstile updates): counters store counts, query returns `min` of the item's counters (a one-sided overestimate), and deletes decrement. Use wider counters than a membership CBF since the counts are genuinely large.

---

## Coding Challenge

### Challenge: Implement a counting Bloom filter with insert, delete, and query

> Build a CBF sized from a target item count `n` and FPR `p`. Implement `add` (saturating increment), `delete` (clamped decrement, skipping saturated counters), and `mightContain` (all `k` counters `> 0`) using double hashing. Then demonstrate the headline property: after `add(x); add(y); delete(x)`, querying `x` returns **false** but querying `y` still returns **true** — deletion of `x` did not harm `y`, even though they may share counters.

**Requirements:**
1. `m = ceil(−n·ln p / (ln 2)²)`, `k = round((m/n)·ln 2)`, 4-bit-style counters (max 15) — use a byte per counter for clarity or pack two per byte.
2. `add` saturates at 15; `delete` clamps at 0 and never touches a saturated counter; `mightContain` early-exits on the first 0.
3. Insert `n` items, delete half of them, then verify: **zero false negatives** among the remaining items, and report the observed FPR.

#### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"math"
)

const maxCount = 15

type CBF struct {
	c    []uint8 // m counters
	m, k uint64
}

func New(n int, p float64) *CBF {
	m := uint64(math.Ceil(-float64(n) * math.Log(p) / (math.Ln2 * math.Ln2)))
	k := uint64(math.Max(1, math.Round(float64(m)/float64(n)*math.Ln2)))
	return &CBF{c: make([]uint8, m), m: m, k: k}
}

func (b *CBF) base(s string) (uint64, uint64) {
	h := fnv.New64a()
	h.Write([]byte(s))
	x := h.Sum64()
	return x & 0xffffffff, (x >> 32) | 1
}

func (b *CBF) Add(s string) {
	h1, h2 := b.base(s)
	for i := uint64(0); i < b.k; i++ {
		idx := (h1 + i*h2) % b.m
		if b.c[idx] < maxCount {
			b.c[idx]++
		}
	}
}

func (b *CBF) Delete(s string) {
	h1, h2 := b.base(s)
	for i := uint64(0); i < b.k; i++ {
		idx := (h1 + i*h2) % b.m
		if b.c[idx] > 0 && b.c[idx] < maxCount {
			b.c[idx]--
		}
	}
}

func (b *CBF) MightContain(s string) bool {
	h1, h2 := b.base(s)
	for i := uint64(0); i < b.k; i++ {
		if b.c[(h1+i*h2)%b.m] == 0 {
			return false
		}
	}
	return true
}

func main() {
	// Headline demo: delete(x) must not break y.
	b := New(1000, 0.01)
	b.Add("x")
	b.Add("y")
	b.Delete("x")
	fmt.Println(b.MightContain("x")) // false (deleted)
	fmt.Println(b.MightContain("y")) // true  (unharmed!)

	// Bulk: insert n, delete half, check no false negatives among the rest.
	n := 10000
	b2 := New(n, 0.01)
	for i := 0; i < n; i++ {
		b2.Add(fmt.Sprintf("in-%d", i))
	}
	for i := 0; i < n/2; i++ {
		b2.Delete(fmt.Sprintf("in-%d", i))
	}
	fn := 0
	for i := n / 2; i < n; i++ { // remaining members
		if !b2.MightContain(fmt.Sprintf("in-%d", i)) {
			fn++
		}
	}
	fp := 0
	for i := 0; i < n; i++ {
		if b2.MightContain(fmt.Sprintf("out-%d", i)) {
			fp++
		}
	}
	fmt.Printf("m=%d k=%d falseNegatives=%d observedFPR=%.4f\n",
		b2.m, b2.k, fn, float64(fp)/float64(n))
}
```

#### Java

```java
import java.nio.charset.StandardCharsets;

public class CBF {
    final byte[] c; final int m, k;
    static final int MAX = 15;

    CBF(int n, double p) {
        m = (int) Math.ceil(-n * Math.log(p) / (Math.log(2) * Math.log(2)));
        k = Math.max(1, (int) Math.round((double) m / n * Math.log(2)));
        c = new byte[m];
    }

    long[] base(String s) {
        long h = 0xcbf29ce484222325L;
        for (byte by : s.getBytes(StandardCharsets.UTF_8)) { h ^= (by & 0xff); h *= 0x100000001b3L; }
        return new long[]{ h & 0xffffffffL, (h >>> 32) | 1L };
    }
    int idx(long h1, long h2, int i) { return (int) (((h1 + (long) i * h2) % m + m) % m); }

    void add(String s) {
        long[] h = base(s);
        for (int i = 0; i < k; i++) { int a = idx(h[0], h[1], i); if (c[a] < MAX) c[a]++; }
    }
    void delete(String s) {
        long[] h = base(s);
        for (int i = 0; i < k; i++) { int a = idx(h[0], h[1], i); if (c[a] > 0 && c[a] < MAX) c[a]--; }
    }
    boolean mightContain(String s) {
        long[] h = base(s);
        for (int i = 0; i < k; i++) if (c[idx(h[0], h[1], i)] == 0) return false;
        return true;
    }

    public static void main(String[] args) {
        CBF b = new CBF(1000, 0.01);
        b.add("x"); b.add("y"); b.delete("x");
        System.out.println(b.mightContain("x")); // false
        System.out.println(b.mightContain("y")); // true

        int n = 10000;
        CBF b2 = new CBF(n, 0.01);
        for (int i = 0; i < n; i++) b2.add("in-" + i);
        for (int i = 0; i < n / 2; i++) b2.delete("in-" + i);
        int fn = 0, fp = 0;
        for (int i = n / 2; i < n; i++) if (!b2.mightContain("in-" + i)) fn++;
        for (int i = 0; i < n; i++) if (b2.mightContain("out-" + i)) fp++;
        System.out.printf("m=%d k=%d falseNegatives=%d observedFPR=%.4f%n",
            b2.m, b2.k, fn, (double) fp / n);
    }
}
```

#### Python

```python
import math, hashlib


class CBF:
    MAX = 15

    def __init__(self, n, p):
        self.m = math.ceil(-n * math.log(p) / (math.log(2) ** 2))
        self.k = max(1, round(self.m / n * math.log(2)))
        self.c = bytearray(self.m)

    def _base(self, s):
        h = int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "little")
        return h & 0xFFFFFFFF, (h >> 32) | 1

    def add(self, s):
        h1, h2 = self._base(s)
        for i in range(self.k):
            idx = (h1 + i * h2) % self.m
            if self.c[idx] < self.MAX:
                self.c[idx] += 1

    def delete(self, s):
        h1, h2 = self._base(s)
        for i in range(self.k):
            idx = (h1 + i * h2) % self.m
            if 0 < self.c[idx] < self.MAX:
                self.c[idx] -= 1

    def might_contain(self, s):
        h1, h2 = self._base(s)
        for i in range(self.k):
            if self.c[(h1 + i * h2) % self.m] == 0:
                return False
        return True


if __name__ == "__main__":
    b = CBF(1000, 0.01)
    b.add("x"); b.add("y"); b.delete("x")
    print(b.might_contain("x"))  # False
    print(b.might_contain("y"))  # True

    n = 10000
    b2 = CBF(n, 0.01)
    for i in range(n):
        b2.add(f"in-{i}")
    for i in range(n // 2):
        b2.delete(f"in-{i}")
    fn = sum(1 for i in range(n // 2, n) if not b2.might_contain(f"in-{i}"))
    fp = sum(1 for i in range(n) if b2.might_contain(f"out-{i}"))
    print(f"m={b2.m} k={b2.k} falseNegatives={fn} observedFPR={fp / n:.4f}")
```

**Expected output (all languages):** the headline demo prints `false` then `true` (deleting `x` left `y` intact), and the bulk test reports `falseNegatives=0` always with `observedFPR ≈ 0.01`. The zero false negatives among *remaining* members after deletions is the property to emphasize — it's the entire reason the CBF exists, and it holds with probability 1 under clean usage (delete only inserted items, saturating counters).

---

### Bonus Challenge: Demonstrate the underflow false-negative bug

> Show the *failure* mode: delete an item that was **never inserted** and observe that it can create a false negative for a real member. Insert `a` and `b` (which may share a counter), then `delete("never-inserted")` repeatedly and check whether `a` or `b` ever wrongly returns "absent." This illustrates why you must only delete inserted items.

**Requirements:**
1. Reuse the `CBF` above with a small `m` (e.g. `m = 20`, `k = 3`) so collisions are likely.
2. Insert a few real members, record that all query "present."
3. Delete several never-inserted strings; after each, re-check the real members and print the first time one flips to "absent" (a manufactured false negative).

```python
# Python sketch (mirror in Go/Java)
b = CBF.__new__(CBF); b.m, b.k, b.c = 20, 3, bytearray(20)  # tiny, collision-prone
for s in ("alpha", "beta", "gamma"):
    b.add(s)
assert all(b.might_contain(s) for s in ("alpha", "beta", "gamma"))
for t in (f"ghost-{i}" for i in range(50)):
    b.delete(t)  # BUG: deleting items never inserted
    bad = [s for s in ("alpha", "beta", "gamma") if not b.might_contain(s)]
    if bad:
        print(f"false negative created for {bad} after deleting {t}")
        break
```

**Expected output:** with a tiny, collision-prone filter, deleting never-inserted "ghost" strings eventually underflows a counter a real member needs, flipping it to "absent" — a **false negative**. Talking point: this is precisely why the no-false-negative guarantee requires "delete only inserted items," and why production CBFs authenticate the delete path against a source of truth.

---

### Interviewer Follow-Ups and Common Mistakes

These are the points an interviewer typically probes after you submit the main challenge — be ready to discuss them.

**Mistake 1 — wrapping on overflow.** If your `add` does `c[idx] = (c[idx] + 1) & 0x0f` (wrap) instead of saturating, a counter at 15 becomes 0, un-setting a slot a member still needs → false negative. The fix is the `if c[idx] < MAX` guard. Interviewers love to ask "what if a counter hits its max?" — answer: saturate, never wrap, and don't decrement a saturated counter.

**Mistake 2 — decrementing below zero.** Without the `c[idx] > 0` guard, a `byte`/`uint8` counter underflows `0 → 255`, marking a slot heavily "set" and corrupting membership. The clamp is mandatory; it also bounds the damage from the underflow bug above.

**Mistake 3 — packing carelessly.** If you pack two 4-bit counters per byte (to hit the true `4×`-not-`8×` memory), a subtle bug is overwriting the *other* nibble on `set`. The correct pattern masks the byte: `byte = (byte & 0xF0) | newLow` or `(byte & 0x0F) | (newHigh << 4)`. Get the nibble addressing wrong and unrelated items start interfering.

**Mistake 4 — non-deterministic hashing.** Python's built-in `hash()` of strings is salted per process, so a serialized filter answers differently on reload. Use a fixed hash (`blake2b`, FNV, MurmurHash) as the solutions do.

**Extension question — "now make it a frequency sketch."** Widen counters to 8/16 bits, stop saturating so aggressively, and add `estimate(x) = min_j c[h_j(x)]`. That's a **spectral Bloom filter** / Count-Min: every counter overestimates `f_x` by collisions, so the `min` is the tightest one-sided overestimate. Deletes (decrements) make it a turnstile sketch.

**Extension question — "make it concurrent."** Replace the read-modify-write with an atomic CAS loop per counter (saturating increment, clamped decrement), or stripe locks per word. Stress that, unlike a Bloom filter's idempotent atomic OR, CBF updates are non-idempotent, so a lost update permanently desyncs the counter — atomicity is mandatory, not optional.

---

Next step: [tasks.md](./tasks.md) — hands-on counting Bloom filter practice tasks in Go, Java, and Python.

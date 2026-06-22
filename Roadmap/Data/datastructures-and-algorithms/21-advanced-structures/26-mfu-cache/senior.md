# MFU Cache — Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [MFU vs MRU: Frequency Is Not Recency](#mfu-vs-mru-frequency-is-not-recency)
3. [When MFU Is Actually Right](#when-mfu-is-actually-right)
4. [The Looping-Sequential Anomaly](#the-looping-sequential-anomaly)
5. [The O(1) Design (Mirror of LFU)](#the-o1-design-mirror-of-lfu)
6. [Aging and Frequency Saturation](#aging-and-frequency-saturation)
7. [Approximate Frequency: Sketches and Heavy Hitters](#approximate-frequency-sketches-and-heavy-hitters)
8. [MFU and Admission Policies](#mfu-and-admission-policies)
9. [Concurrency: Why Frequency Caches Resist Parallelism](#concurrency-why-frequency-caches-resist-parallelism)
10. [Reference Implementation](#reference-implementation)
    - [Go: O(1) MFU](#go-o1-mfu)
    - [Python: MFU with Aging](#python-mfu-with-aging)
11. [Invariants and Correctness Argument](#invariants-and-correctness-argument)
12. [Failure Modes and Testing](#failure-modes-and-testing)
13. [Production Verdict](#production-verdict)
14. [Key Takeaways](#key-takeaways)

---

## Introduction

> Focus: "When is evicting the *most* frequently used item the right thing to do — and why is that almost never the default?"

MFU (Most Frequently Used) is the mirror image of [LFU](../21-lfu-cache/senior.md): a fixed-capacity cache that, on overflow, evicts the entry with the **highest** access frequency, breaking ties by [LRU](../01-lru-cache/senior.md) within the maximum-frequency bucket. Structurally it is LFU with the eviction pointer flipped from `minFreq` to `maxFreq`. Everything else — the hashmap, the frequency buckets, the O(1) bookkeeping — is identical.

The policy sounds perverse. Evicting your hottest item seems like the worst possible decision, and on the overwhelming majority of real workloads it *is*. But MFU encodes a specific, defensible hypothesis: **an item that has already been accessed many times has likely exhausted its usefulness and is unlikely to be needed again soon.** That hypothesis is wrong for Zipfian web traffic (where hot stays hot) and right for a narrow but real class of workloads — sequential and cyclic scans — where the item you just finished with is precisely the one you will not touch again for a full cycle.

This level treats MFU honestly: where it genuinely wins, why it is conflated with MRU, how its frequency machinery ages and saturates, how approximate-frequency structures change the picture, why it is *harder* to make concurrent than LRU, and a clean O(1) reference implementation. The verdict, stated up front so the rest can earn it: **MFU is almost never deployed standalone. Its real home is as a victim-selection or admission heuristic inside a hybrid policy.**

---

## MFU vs MRU: Frequency Is Not Recency

These two policies are constantly conflated, including in textbooks, because they "win" on overlapping workloads and both feel counterintuitive. They are not the same policy.

| Policy | Evicts | State per entry | Tie-break |
|--------|--------|-----------------|-----------|
| **MRU** (Most Recently Used) | the entry touched *most recently* | recency order (one DLL) | none needed |
| **MFU** (Most Frequently Used) | the entry with the *highest access count* | frequency counter + bucket | LRU within max bucket |

- **MRU** is purely a function of *time order*. It is trivially O(1): keep a recency list and evict the head. It throws out whatever you just touched.
- **MFU** is a function of *count*. It needs the full frequency-bucket apparatus (like LFU) and a `maxFreq` pointer. It throws out whatever you have touched the most over the cache's lifetime.

The two coincide on a **single clean pass through a working set larger than the cache**: each item is touched exactly once, so "most recent" and "highest frequency among the bucket" point at the same place, and both protect the not-yet-seen tail. This is why people say "MRU/MFU" as if it were one thing. They diverge the moment access counts become uneven. On a workload where a few items are hammered and the rest are scanned, **MRU evicts the item from the last instant**, while **MFU evicts the hammered items** — very different behavior. MRU is the right tool for the looping-scan anomaly below; MFU is the right tool when you specifically want to shed *saturated* entries and protect *novel* ones.

When someone says "MRU/MFU beats LRU on looping access," they almost always mean **MRU**. MFU's frequency angle is a strictly different and rarer justification. Keep them distinct.

---

## When MFU Is Actually Right

MFU (and its cousin MRU) pays off when **recently or heavily used implies soon-to-be-useless**. Concretely:

1. **Cyclic / looping sequential scans.** A query repeatedly scans a relation `R` of `n` pages with a buffer of `b < n` pages. Under LRU, by the time you wrap around to page 1 again, it was the *least* recently used and has just been evicted — every access is a miss (the looping anomaly, below). MRU/MFU keeps the *front* of the relation resident and only churns the page you just finished, turning a 0%-hit catastrophe into a `b/n` hit ratio.

2. **Database buffer-pool inner relations.** In a nested-loop join, the inner relation is scanned in full once per outer tuple. The classic DBMS insight (Chou & DeWitt, *DBMIN*, 1985; later Sybase/DB2 buffer managers) is that **access pattern, not global recency, should drive replacement per relation.** For a cyclically-scanned inner relation, the optimal local policy is MRU-flavored. PostgreSQL's ring buffers and the `BAS_BULKREAD` strategy are a pragmatic descendant: large sequential scans use a small private ring so they cannot evict the rest of the hot buffer pool.

3. **Scan resistance via shedding the hot set.** A real-time analytics or feature-serving cache may want to *protect novelty*: a key accessed dozens of times is "understood" and cheap to recompute or already downstream, whereas a freshly-seen key is the expensive one to hold. Here MFU's "evict the saturated" behavior is a deliberate freshness bias.

4. **Producer/consumer staging where hot == done.** If frequency correlates with "work completed on this item," evicting high-frequency entries frees the items least likely to be revisited.

The unifying property is an **anti-correlation between past frequency and future use** within the relevant scope. Whenever the opposite holds — past popularity predicts future popularity, the normal Zipfian case — MFU is actively harmful and you want [LFU](../21-lfu-cache/senior.md) or [W-TinyLFU](../22-arc-2q-cache/senior.md).

A quick decision table, because the policy choice is entirely workload-driven:

| Workload shape | Frequency predicts reuse? | Best policy | MFU's outcome |
|----------------|---------------------------|-------------|----------------|
| Zipfian web / CDN / KV | yes (hot stays hot) | LFU / W-TinyLFU | catastrophic (evicts the head) |
| Recency-skewed sessions | partially | LRU / ARC | poor |
| Single clean pass, working set > cache | n/a (each seen once) | MRU ≈ MFU | near-optimal (one cycle) |
| Cyclic / looping scan | inverted (just-used = done) | **MRU** | good transiently, then drifts to LRU |
| Freshness-biased (novelty is expensive) | inverted within scope | **MFU** (scoped) | good — its intended niche |

The two rows where MFU is genuinely defensible are the bottom pair, and even there MRU is the cleaner answer for pure looping. MFU's unique value is the *freshness-bias* row: when you explicitly want to shed entries that have been "consumed" and protect novel ones.

---

## The Looping-Sequential Anomaly

The cleanest theoretical justification for MRU/MFU is that **LRU is provably pessimal** on a looping reference string.

Consider references to pages `1, 2, …, n, 1, 2, …, n, …` (period `n`) with a buffer holding `b` pages, `b < n`.

- **LRU:** When you reference page `i`, the buffer holds the `b` most recent pages, i.e. `{i-1, i-2, …, i-b}` (mod `n`). The page you are about to reference next on the *next* loop, page `i` itself, was evicted exactly `n - b` references ago. For `b < n`, **every single reference is a miss.** LRU achieves a 0% hit ratio — the worst attainable.
- **MRU:** Evicting the most-recent page means the buffer accumulates `{1, 2, …, b-1}` and only the last slot churns through the rest. Pages `1…b-1` are permanent hits; the hit ratio is `(b-1)/n` — within one page of optimal for this access pattern.
- **MFU:** After the first loop, every page has frequency 1, so MFU's tie-break (LRU within the max bucket) makes it behave like MRU on the first cycle; on steady state the resident "permanent" pages climb in frequency and MFU keeps evicting *those*, which **degrades it back toward LRU.** This is the subtle, important difference: **MRU is the correct policy for pure looping; MFU only matches it transiently and then drifts.** It is a concrete demonstration that frequency and recency are not interchangeable, and a reason MFU specifically is rarely the looping-scan answer.

The looping anomaly is the canonical example of **Bélády's anomaly's cousin**: more cache (larger `b`) helps LRU linearly here, but no amount of LRU tuning fixes the *structure* of the mismatch. The fix is a policy whose eviction order matches the access order's reversal — which is exactly MRU. The takeaway for an MFU discussion is sobering: the very anomaly most often cited *for* MFU is actually an argument for MRU, and MFU's frequency dimension makes it a worse, not better, fit.

Worked numbers make the gap vivid. Take `n = 1000` pages, buffer `b = 100`:

```
LRU:  hit ratio = 0/1000          = 0.0%     (pessimal — every loop is all-miss)
MRU:  hit ratio = (b-1)/n = 99/1000 ≈ 9.9%   (within one page of optimal for this pattern)
MFU:  ≈ 9.9% on loop 1, then decays toward 0% as the resident
      head climbs in frequency and becomes MFU's eviction target.
OPT (Bélády): evict the page referenced farthest in the future
      = the one you just used → 9.9%, matching MRU.
```

MRU coincides with the offline-optimal (Bélády) policy on a pure cyclic string, which is the strongest statement you can make about a replacement policy. MFU only borrows that optimality for one cycle, until frequency information accumulates and steers it wrong. This is the single most important fact to internalize about MFU: **its frequency signal is a liability, not an asset, on the workload it is most often invoked to handle.**

---

## The O(1) Design (Mirror of LFU)

MFU reuses the entire [O(1) LFU structure](../21-lfu-cache/middle.md). The only change is the eviction target.

Three components:

1. **`map[key] → node`** — the hashmap for O(1) lookup. Each node carries `value`, `key`, and its current `freq`.
2. **`map[freq] → doubly-linked list`** — one DLL per frequency, ordering nodes within a bucket by recency (newest at one end). This gives O(1) insert/remove and an LRU tie-break inside a bucket.
3. **`maxFreq`** — an integer pointing at the highest non-empty frequency bucket. This is the mirror of LFU's `minFreq`.

Operations:

- **Get / hit:** look up the node; remove it from bucket `f`; insert it into bucket `f+1` (creating the bucket if needed); update `freq`. If bucket `f` is now empty **and** `f == maxFreq`, recompute `maxFreq` (see below). If `f+1 > maxFreq`, set `maxFreq = f+1`.
- **Put (new key, cache full):** evict the **LRU node of bucket `maxFreq`** (the oldest entry among the most-frequent), then insert the new key into bucket `1`, set `maxFreq` accordingly... but note bucket 1 now exists, so `maxFreq` is unchanged unless it was 0.

The one genuinely fiddly part — and the standard interview trap — is **recomputing `maxFreq` when the max bucket empties.** In LFU, when `minFreq`'s bucket empties on a *promotion*, the new minimum is always `oldFreq + 1`, because promotion moves a node up by exactly one and nothing else changed. **MFU does not get this gift.** When you evict from `maxFreq` (a removal, not a promotion), the bucket below is `maxFreq - 1`, but it may or may not exist — there can be gaps. And when a *promotion* empties a lower bucket, `maxFreq` is unaffected. So MFU's `maxFreq` maintenance splits into two cases:

- **On promotion** (`f → f+1`): `maxFreq = max(maxFreq, f+1)`. Trivial, O(1), monotone up.
- **On eviction from `maxFreq`** (bucket becomes empty): scan downward for the next non-empty bucket: `maxFreq = max{ f : bucket[f] non-empty }`. With contiguous buckets this is `maxFreq - 1`; with gaps it is a short downward walk.

To keep eviction strictly O(1), the clean trick is to **store the set of live frequencies in a structure that gives the max in O(1)** — but in practice, because frequencies only ever increment by one on promotion, the live buckets stay nearly contiguous, and the downward walk after an eviction is amortized O(1). If you want a hard worst-case O(1) guarantee, keep an ordered structure of occupied frequencies (e.g., a sorted bucket list with prev/next links so the bucket below `maxFreq` is reachable in one hop). The reference implementation below uses the contiguous-walk approach, which is O(1) amortized and correct for any sequence.

---

## Aging and Frequency Saturation

MFU inherits LFU's worst structural weakness, and in a sharper form: **pure frequency counts never decay.** Three consequences:

1. **Saturation.** On a long-running cache, hot keys accumulate enormous counts. The `maxFreq` bucket fills with a handful of perpetually-incremented keys, and MFU keeps thrashing exactly them — which on a non-scan workload means it keeps evicting the things most likely to be reused. Without decay, MFU optimizes "least-recently-promoted among the all-time-hottest," a nearly meaningless objective on non-stationary traffic.

2. **Counter cost.** Exact counts need a full integer per key and a bucket per distinct frequency. At millions of entries this is real memory (the same complaint that pushes production LFU to one-byte logarithmic counters — see the [Morris counter](../21-lfu-cache/senior.md#approximate-lfu-the-morris-counter)).

3. **Stale max-set lock-in.** Once a key reaches the top bucket it tends to stay there (every hit only pushes it higher), so MFU's eviction set ossifies around ancient hot keys unless something pulls counts back down.

Aging strategies, with their trade-offs:

| Strategy | Mechanism | Cost | Accuracy |
|----------|-----------|------|----------|
| **Periodic halving** (LFU\* / LFU-with-decay) | every `N` ops, halve every count and rebuild buckets | O(distinct freqs) per sweep, amortized near-zero | coarse but robust; the standard choice |
| **Windowed counts** | only count hits inside a sliding time/op window; expire older hits | per-entry timestamp ring or decaying queue | sharp recency cutoff, more metadata |
| **Exponential decay** | on each access, `count = count·e^{-λΔt} + 1` (LRFU-style) | one float + timestamp per entry, math per hit | smoothest; tunable between recency and frequency via `λ` |
| **Dynamic-aging floor** (LFUDA-style) | add a global rising `age` offset to scores | one global int | cheapest; ratchets old counts toward evictability |

For MFU the decay question has a twist: decay normally exists to keep *high counts from squatting cache slots*. In MFU, high counts are precisely what gets evicted — so decay's role inverts. Decay in an MFU cache prevents the **opposite** pathology: it stops a briefly-hammered key from being instantly and permanently the eviction target, by letting its count fade back into the protected mid-range. Tune MFU decay to match the *cycle length* of your scan workload (one decay half-life per loop period) so an item's frequency reflects "hot in this cycle," not "hot since boot." This is the same principle as LFU decay — **turn "frequently used ever" into "frequently used recently"** — applied to the inverted eviction rule.

---

## Approximate Frequency: Sketches and Heavy Hitters

The exact bucket-DLL apparatus is expensive. As with LFU, the production-grade answer is to **approximate the frequency** and keep only a ranking, not exact counts.

- **[Count–Min Sketch](../08-count-min-sketch/senior.md).** A few hash functions index into counter rows; the estimate is the minimum across rows. This gives an approximate per-key frequency in a few bytes total for the whole cache, with one-sided (over-) error bounded by `ε·N` at probability `1 − δ`. For MFU you do not even need the absolute count — you need to know whether a candidate is a **heavy hitter** (in the top-k by frequency). The CMS, optionally augmented with a heavy-hitters heap (the *Count-Min-Heap* / Space-Saving construction), tracks the high-frequency set directly, which *is* MFU's eviction set. Evicting a heavy hitter is then an O(1) lookup against the sketch's top-k.

- **Heavy-hitter / Space-Saving.** The Space-Saving algorithm (Metwally et al., 2005) maintains the approximate top-k frequent items in `O(k)` space with provable error bounds. An MFU policy is, almost by definition, "evict from the current heavy-hitter set" — so the heavy-hitters literature is the natural home for an approximate MFU. You maintain the top-k frequent keys and, on overflow, evict the current maximum-frequency key in that structure, tie-broken by recency.

- **Decay on the sketch.** Approximate structures decay cheaply with the **reset-on-N** sweep: when a global op counter crosses a threshold (e.g., `10×` capacity), halve every sketch cell in one pass. This gives the sketch a fading memory and amortizes to near-zero per access — the same trick TinyLFU uses. It is far cheaper than per-entry exponential decay and is the recommended aging mechanism for any sketch-backed MFU.

The accuracy/space trade-off is the usual CMS story: smaller sketch → more hash collisions → frequencies of cold keys get inflated toward hot keys, which for MFU means **occasionally evicting a not-actually-hot key.** Because MFU is a heuristic component (not a correctness-critical structure), this noise is tolerable — the same reason a [Bloom filter](../02-bloom-filter/senior.md) doorkeeper is acceptable in front of an admission sketch. You trade exactness for kilobytes of metadata and accept that the eviction is approximately, not exactly, the most-frequent key.

---

## MFU and Admission Policies

MFU's most credible production role is **not** as the global eviction policy but as a **victim-selection rule inside a hybrid**, where it interacts with an admission filter.

Recall how [TinyLFU](../22-arc-2q-cache/senior.md) admission works: when the cache is full and a candidate wants in, the policy compares `estimatedFrequency(candidate)` against `estimatedFrequency(victim)`, admitting the candidate only if it is at least as frequent. The *victim* there is chosen by an LRU/SLRU base policy. **An MFU-style victim selector replaces that base choice**: instead of "victim = LRU of the main region," pick "victim = the most-frequent resident in a designated scan region."

This composition is exactly how scan-resistant DB buffer managers behave per-relation:

```
on miss, cache full:
    region   = classify(candidate)          # scan vs. random-access region
    if region == SCAN:
        victim = mostFrequent(scanRegion)    # MFU within the scan ring
    else:
        victim = lru(mainRegion)             # LRU elsewhere
    if estFreq(candidate) >= estFreq(victim) # admission gate (sketch)
        admit candidate, evict victim
    else:
        bypass candidate (do not cache)
```

Two interactions matter:

- **MFU victim selection + frequency-admission can fight.** The admission gate wants to keep frequent keys; MFU wants to *evict* the frequent key in its region. They are reconciled by scoping: MFU operates only inside the **scan/sequential region** (where high frequency means "already consumed"), while the admission sketch governs the **random-access region** (where high frequency means "keep"). The frequency metric means opposite things in the two regions, and the hybrid keeps them apart.

- **Bypass beats eviction for one-hit scans.** For a pure sequential scan whose pages will not be revisited within the cache lifetime, the right move is often to **not cache at all** (PostgreSQL's ring-buffer bypass), which is MFU taken to its limit: the scan page has the highest "about-to-be-done" likelihood, so its residency is shortest. MFU-within-a-ring and bypass are points on the same spectrum.

The honest framing: standalone MFU is a curiosity, but **MFU-as-a-component** — a region-scoped victim selector cooperating with a [TinyLFU-style admission sketch](../22-arc-2q-cache/senior.md) — is a real, shipped pattern in database storage engines.

---

## Concurrency: Why Frequency Caches Resist Parallelism

Frequency caches (LFU and MFU alike) are **substantially harder to parallelize than [LRU](../01-lru-cache/senior.md)**, for a structural reason: every read mutates shared, *globally-ordered* state.

- In LRU, a read moves one node to the list head — a local splice. With buffered/batched recency updates (Caffeine's per-thread ring buffers), reads are nearly lock-free.
- In MFU, a read **promotes** a node between frequency buckets *and* may move the `maxFreq` pointer. The `maxFreq` pointer is a single global hotspot: under a Zipfian read mix, the hottest keys are exactly the ones in or near the top bucket, so concurrent promotions of hot keys all contend on the same `maxFreq` cell and the same top-bucket DLL. This is the worst case for a spinlock — high contention on the most-trafficked structure.

Mitigations, in order of practicality:

1. **Sharding / striping.** Partition keys across `N` shards by `hash(key) % N`, each an independent MFU with its own lock and its own `maxFreq`. Contention drops `N`-fold. The cost: frequency (and thus eviction) is **per-shard local**, so a globally-most-frequent key may survive in one shard while a locally-frequent key is evicted in another. For MFU this is usually acceptable because the policy is already a heuristic, and balanced sharding keeps per-shard distributions similar. This is the default production approach.

2. **Buffered promotions.** As with Caffeine LFU, a read appends its access to a lock-free ring buffer; a single maintenance task drains buffers and applies promotions and `maxFreq` updates under one lock. Reads stay O(1) and near-lock-free; policy state is *eventually* consistent. The `maxFreq` recompute happens off the read path, eliminating the hotspot.

3. **Approximate, sketch-backed MFU.** A [Count-Min sketch](../08-count-min-sketch/senior.md) tolerates racy increments — a few lost or doubled updates barely perturb an approximate counter — so a sketch-backed MFU can update frequency with relaxed atomics or even unsynchronized writes, only adding estimate noise. The eviction decision (top-k lookup) can be done under a short lock or sampled. This sidesteps the bucket-DLL contention entirely.

A sketched sharded approach:

```
type ShardedMFU:
    shards[N]                      # each: map + freq buckets + maxFreq + lock
    sketch  CountMinSketch         # shared, relaxed-atomic increments

    Get(key):
        s = shards[hash(key) % N]
        s.lock(); v := s.promote(key); s.unlock()   # local maxFreq update
        sketch.add(key)            # racy, fine
        return v

    Put(key, val):
        s = shards[hash(key) % N]
        s.lock()
        if s.full(): s.evictMaxFreqLRU()            # local MFU eviction
        s.insert(key, val)
        s.unlock()
```

The shared sketch gives a global frequency view for admission/top-k decisions while per-shard buckets give cheap local eviction — the same division of labor as the LFU concurrency story, but with the added pain that MFU's eviction targets *are* the hot keys, so the eviction lock contends with the read traffic far more than LFU's cold-key eviction does. This is the deep reason MFU is harder: in LFU you evict cold keys (low contention); in MFU you evict hot keys (maximum contention).

---

## Reference Implementation

### Go: O(1) MFU

Exact MFU with frequency buckets, LRU tie-break within the max bucket, and correct `maxFreq` recomputation. O(1) amortized per operation.

```go
package mfu

import "container/list"

type entry struct {
	key, value int
	freq       int
}

// MFU evicts the most-frequently-used key, LRU within the max-freq bucket.
type MFU struct {
	capacity int
	maxFreq  int
	items    map[int]*list.Element // key -> element in buckets[freq]
	buckets  map[int]*list.List    // freq -> list of *entry, front = MRU, back = LRU
}

func New(capacity int) *MFU {
	return &MFU{
		capacity: capacity,
		items:    make(map[int]*list.Element),
		buckets:  make(map[int]*list.List),
	}
}

// bucket returns (creating if needed) the DLL for a frequency.
func (c *MFU) bucket(f int) *list.List {
	l := c.buckets[f]
	if l == nil {
		l = list.New()
		c.buckets[f] = l
	}
	return l
}

// promote moves an element from bucket f to f+1, front (MRU end).
func (c *MFU) promote(el *list.Element) {
	en := el.Value.(*entry)
	old := en.freq
	c.buckets[old].Remove(el)
	if c.buckets[old].Len() == 0 {
		delete(c.buckets, old)
		// promotion can only raise the max; a freed lower bucket never lowers it.
	}
	en.freq++
	if en.freq > c.maxFreq {
		c.maxFreq = en.freq
	}
	c.items[en.key] = c.bucket(en.freq).PushFront(en)
}

func (c *MFU) Get(key int) (int, bool) {
	el, ok := c.items[key]
	if !ok {
		return 0, false
	}
	v := el.Value.(*entry).value
	c.promote(el)
	return v, true
}

func (c *MFU) Put(key, value int) {
	if c.capacity == 0 {
		return
	}
	if el, ok := c.items[key]; ok {
		el.Value.(*entry).value = value
		c.promote(el)
		return
	}
	if len(c.items) >= c.capacity {
		c.evictMax()
	}
	en := &entry{key: key, value: value, freq: 1}
	c.items[key] = c.bucket(1).PushFront(en)
	if c.maxFreq == 0 {
		c.maxFreq = 1
	}
	// inserting freq-1 never raises maxFreq above an existing higher bucket.
}

// evictMax removes the LRU (back) entry of the highest-frequency bucket.
func (c *MFU) evictMax() {
	l := c.buckets[c.maxFreq]
	victim := l.Back() // LRU within the max bucket
	en := victim.Value.(*entry)
	l.Remove(victim)
	delete(c.items, en.key)
	if l.Len() == 0 {
		delete(c.buckets, c.maxFreq)
		c.recomputeMax() // the only place maxFreq can drop
	}
}

// recomputeMax walks down to the next non-empty bucket.
// Amortized O(1): buckets stay near-contiguous because promotions are +1.
func (c *MFU) recomputeMax() {
	for c.maxFreq > 0 {
		if l := c.buckets[c.maxFreq]; l != nil && l.Len() > 0 {
			return
		}
		c.maxFreq--
	}
}
```

The asymmetry with LFU is visible: `promote` can only *raise* `maxFreq` (one branch, O(1)), while only `evictMax` can *lower* it, and only via `recomputeMax`. In LFU the symmetric `minFreq` update on promotion is the trivial `+1`; MFU's eviction-side recompute is the part you must get right.

### Python: MFU with Aging

Exact MFU plus periodic count-halving — the simplest production-viable aging fix, mirroring the [decaying LFU](../21-lfu-cache/senior.md#python-lfu-with-periodic-decay).

```python
from collections import defaultdict, OrderedDict


class AgingMFU:
    """O(1)-ish MFU: evict the highest-frequency key, LRU within that bucket.
    Periodic halving keeps a briefly-hammered key from squatting as the victim."""

    def __init__(self, capacity: int, decay_every: int = 10_000):
        self.capacity = capacity
        self.decay_every = decay_every
        self.ops = 0
        self.values: dict[int, int] = {}
        self.freq: dict[int, int] = {}
        # freq -> OrderedDict of keys; back (last) = MRU, front (first) = LRU
        self.buckets: dict[int, "OrderedDict[int, None]"] = defaultdict(OrderedDict)
        self.max_freq = 0

    def _promote(self, key: int) -> None:
        f = self.freq[key]
        del self.buckets[f][key]
        if not self.buckets[f]:
            del self.buckets[f]
        self.freq[key] = f + 1
        self.buckets[f + 1][key] = None  # MRU end
        if f + 1 > self.max_freq:
            self.max_freq = f + 1

    def get(self, key: int) -> int:
        if key not in self.values:
            return -1
        self._maybe_decay()
        self._promote(key)
        return self.values[key]

    def put(self, key: int, value: int) -> None:
        if self.capacity == 0:
            return
        self._maybe_decay()
        if key in self.values:
            self.values[key] = value
            self._promote(key)
            return
        if len(self.values) >= self.capacity:
            self._evict_max()
        self.values[key] = value
        self.freq[key] = 1
        self.buckets[1][key] = None
        if self.max_freq == 0:
            self.max_freq = 1

    def _evict_max(self) -> None:
        bucket = self.buckets[self.max_freq]
        victim, _ = next(iter(bucket.items()))  # LRU (front) of max bucket
        del bucket[victim]
        if not bucket:
            del self.buckets[self.max_freq]
            self._recompute_max()
        del self.values[victim]
        del self.freq[victim]

    def _recompute_max(self) -> None:
        while self.max_freq > 0 and self.max_freq not in self.buckets:
            self.max_freq -= 1

    def _maybe_decay(self) -> None:
        self.ops += 1
        if self.ops % self.decay_every:
            return
        new_freq, new_buckets = {}, defaultdict(OrderedDict)
        for k, f in self.freq.items():
            nf = max(1, f // 2)
            new_freq[k] = nf
            new_buckets[nf][k] = None
        self.freq, self.buckets = new_freq, new_buckets
        self.max_freq = max(self.buckets) if self.buckets else 0
```

---

## Invariants and Correctness Argument

The implementation is correct iff these invariants hold after every operation:

1. **Map–bucket consistency.** `key ∈ values ⟺ key ∈ freq ⟺ key ∈ buckets[freq[key]]`. Every live key appears in exactly one bucket, matching its recorded frequency.
2. **`maxFreq` is the true maximum.** `maxFreq = max{ f : buckets[f] non-empty }` (and `0` iff the cache is empty). This is what makes eviction select the genuinely most-frequent key.
3. **Within-bucket recency order.** Each bucket's DLL/OrderedDict is ordered by recency; the LRU end is the tie-break victim.
4. **Capacity bound.** `len(values) ≤ capacity` always; eviction precedes insertion when full.

**Why eviction is correct.** Invariant 2 guarantees `buckets[maxFreq]` is non-empty and holds the highest-frequency keys. Invariant 3 guarantees its LRU end is the least-recently-used among those. So `evictMax` removes exactly the most-frequently-used key, tie-broken by LRU — the MFU specification.

**Why `maxFreq` stays correct.** `maxFreq` changes in exactly two places. On **promotion**, `freq[key]` rises by one; the new value can only push the maximum *up*, captured by `maxFreq = max(maxFreq, f+1)`. A bucket freed by promotion was strictly below `maxFreq` or equal to it only when `key` was its sole member — but then `key` moved to `f+1 > f`, so the max does not fall. On **eviction**, the only operation that can empty the `maxFreq` bucket, `recomputeMax` re-establishes invariant 2 by walking down to the next occupied bucket. No other operation alters bucket occupancy at or above `maxFreq`.

**Complexity.** `Get`, `Put`, and eviction are O(1) amortized. The only non-constant step is `recomputeMax`. Because promotions increment by exactly one, occupied frequencies form a near-contiguous range, so each downward step in `recomputeMax` corresponds to a frequency level that was previously created by promotions; the total downward distance over a run of operations is bounded by the total upward distance, giving amortized O(1). For a hard worst-case O(1), thread the occupied buckets in a sorted intrusive list so the bucket below `maxFreq` is one hop away.

---

## Failure Modes and Testing

**Failure modes specific to MFU:**

- **Wrong-workload catastrophe.** On Zipfian traffic, MFU evicts the hot head and yields a *worse-than-random* hit ratio. The only defense is to not deploy MFU where past popularity predicts future use — i.e., almost everywhere. Guard with an offline trace replay before shipping.
- **`maxFreq` desynchronization.** The classic bug: forgetting `recomputeMax` after an eviction empties the top bucket, leaving `maxFreq` pointing at an empty bucket and either crashing or evicting nothing. Mirror-image of the LFU `minFreq` bug.
- **No-decay ossification.** Without aging, the top bucket locks onto ancient hot keys and MFU thrashes them forever. Cure with periodic halving or windowed counts.
- **Sharded skew.** Under sharding, an imbalanced shard evicts locally-frequent keys that are globally cold, or vice versa. Mitigate with a good hash and enough shards.
- **Sketch collision noise.** A sketch-backed MFU occasionally evicts a not-actually-hot key when a cold key's estimate is inflated by collision. Tolerable for a heuristic; bound it by sizing the sketch.

**Testing strategy.** MFU is a perfect target for **[property-based testing](../21-lfu-cache/senior.md)** because it has a crisp, checkable invariant:

> **Eviction invariant:** whenever an eviction occurs, the evicted key's frequency equals the maximum frequency among all resident keys at that instant; and among keys at that maximum frequency, the evicted one is the least recently used.

Property test scaffold:

- Generate random op sequences (`get`/`put` with a controlled key distribution: include Zipfian, uniform, and *looping-sequential* generators so the scan case is exercised).
- After every `put` that triggers eviction, assert the eviction invariant by recomputing the max frequency from a shadow `Counter` and confirming the victim was at that max with the oldest within-bucket timestamp.
- Maintain a **reference model** (a slow but obviously-correct MFU built from a dict and a full re-scan for the max) and assert the fast implementation agrees on the full value sequence — a model-based / metamorphic test.
- **Invariant fuzzing:** after every operation, assert `maxFreq == max(occupied buckets)` and the map–bucket consistency invariant. This catches the `maxFreq` desync bug immediately.
- **Looping-scan regression:** feed `1..n, 1..n, …` with capacity `b < n` and assert MFU's hit ratio matches the theoretical `(b-1)/n` band on the first cycle and document its drift thereafter — a guard against silently changing the tie-break.

The key property — *never evict a non-maximum-frequency key while a higher-frequency key exists* — is exactly the kind of universally-quantified statement property-based testing was built to falsify.

---

## MFU-Flavored Variants in the Wild

Pure MFU is rare, but its eviction logic surfaces, scoped and softened, in several real replacement policies. Recognizing these helps you place MFU correctly: it is a *primitive*, not usually a whole policy.

| Variant | How MFU appears | Where seen |
|---------|-----------------|-----------|
| **MRU / "fetch-and-discard"** | The degenerate MFU where all freqs are equal → evict most-recent. Used for one-pass bulk reads. | PostgreSQL `BAS_BULKREAD`, Oracle full-table-scan buffering |
| **DBMIN per-relation policy** | Each relation gets a locality set with a policy matched to its access pattern; cyclic inner relations get MRU/MFU-style replacement. | Chou & DeWitt DBMIN; descendants in commercial buffer managers |
| **Ring buffers** | A small private ring caps a scan's footprint; within the ring, the just-used (highest local "frequency") slot is reused — MFU taken to a 1-bucket limit. | PostgreSQL ring buffers (bulk read/write/vacuum) |
| **2Q / ARC "scan resistance"** | Not MFU, but solve the same problem (scans flushing the cache) by *admission* rather than MFU eviction. The alternative design point. | [ARC / 2Q](../22-arc-2q-cache/senior.md) |

The pattern is consistent: the industry solved the looping-scan problem that motivates MFU **either** by giving scans a private, capped region (ring buffers) **or** by scan-resistant admission (2Q/ARC) — *not* by adopting global MFU. That is the strongest signal about where MFU belongs: as the local rule inside a bounded scan region, never as the cache-wide policy.

> **Design principle:** when you find yourself wanting MFU, first ask whether a **bypass / ring buffer** (don't cache the scan at all, or cap it) or **scan-resistant admission** ([2Q/ARC](../22-arc-2q-cache/senior.md)) solves your actual problem more cleanly. Usually it does. MFU survives only where you need a *graded* "evict the most-consumed first" within a region, rather than a binary cache/don't-cache decision.

---

## Production Verdict

Be honest: **MFU is rarely the right default, and standalone MFU is almost never the right production policy.** The evidence:

- The workloads where it wins (looping/cyclic scans) are better served by **MRU**, which is simpler (one recency list, no buckets, trivially O(1)) and does not drift back toward LRU the way MFU does on steady-state loops.
- The dominant real-world cache workload is Zipfian, where frequency *predicts* reuse, so the correct frequency policy is the *opposite* one — [LFU / W-TinyLFU](../21-lfu-cache/senior.md).
- MFU is the *hardest* of the common policies to make concurrent, because its eviction targets coincide with its highest-traffic keys, maximizing lock contention.

Where MFU earns its place is as a **scoped component of a hybrid**: a victim-selector for a sequential-scan region inside a database buffer manager (cooperating with bypass and a [frequency-admission sketch](../22-arc-2q-cache/senior.md)), or a freshness-biased eviction heuristic in a feature-serving cache that deliberately protects novel keys. In those roles it is a precise tool for the specific belief "high past frequency ⇒ low future use within this scope."

If you reach for MFU, the burden of proof is on you to show your workload has that anti-correlation — and to confirm it by **replaying a real trace** through MFU, MRU, LRU, and LFU offline before shipping. In the common case, that experiment will tell you to ship something else.

---

## Key Takeaways

- **MFU evicts the highest-frequency entry, LRU-tie-broken** within the max bucket — structurally the mirror of [LFU](../21-lfu-cache/senior.md) with `minFreq` flipped to `maxFreq`.
- **MFU ≠ MRU.** MRU is recency (trivially O(1), one list); MFU is frequency (needs the bucket apparatus). They coincide only on a single clean pass; the looping-scan anomaly is really an argument for **MRU**, not MFU.
- **LRU is pessimal (0% hits) on looping references** with `b < n`; MRU reaches `(b-1)/n`; MFU only matches MRU transiently and drifts back toward LRU — a concrete proof that frequency and recency are not interchangeable.
- **Pure frequency never decays**, so MFU saturates and ossifies. Fix with **periodic halving**, **windowed counts**, or **exponential decay**, tuned to the workload's cycle length.
- **Approximate MFU** uses a [Count-Min sketch](../08-count-min-sketch/senior.md) + heavy-hitter (Space-Saving) tracking to evict from the top-k in a few kilobytes, with reset-on-N decay — trading exactness for memory.
- **MFU is the hardest frequency cache to parallelize**: its eviction targets are the hottest keys, so the `maxFreq` bucket is both the contention hotspot *and* the eviction site. Shard, buffer promotions, or go sketch-backed.
- **Verdict:** rarely a standalone policy; its real home is a **scoped victim-selector inside a hybrid admission policy** (DB buffer-pool scan regions). Always validate against MRU/LRU/LFU by trace replay before shipping.

**Next step:** For the formal frequency-cache theory — O(1) correctness proofs, optimality on frequency-skewed reference strings, aging analysis, and the heavy-hitter error bounds that also underpin approximate MFU — work through [LFU `professional.md`](../21-lfu-cache/professional.md), then cross-reference [ARC / 2Q](../22-arc-2q-cache/senior.md) for the scan-resistant admission alternative and [Count-Min Sketch](../08-count-min-sketch/professional.md) for the sketch error bounds behind approximate MFU. MFU/MRU optimality on cyclic reference strings versus LRU's pessimality is the formal analysis worth deriving yourself from the looping-anomaly section above.

# MFU Cache — Interview Questions

> Tiered questions (Junior → Middle → Senior → Professional) followed by the canonical coding challenge: an **O(1) MFU Cache** in Go, Java, and Python.
> MFU evicts the **most frequently used** key (highest access count), breaking ties by **least recently used** within the top-frequency bucket. It is the mirror image of [LFU](../21-lfu-cache/interview.md) — same three structures, but a `maxFreq` pointer instead of `minFreq`.
> Cross-references: [LFU cache](../21-lfu-cache/interview.md) · [LRU cache](../01-lru-cache/interview.md).

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Trace-Reading Drills](#trace-reading-drills)
6. [Rapid-Fire Round (Mixed)](#rapid-fire-round-mixed)
7. [Whiteboard Diagnostic: Spot the Bug](#whiteboard-diagnostic-spot-the-bug)
8. [Coding Challenge: O(1) MFU Cache](#coding-challenge-o1-mfu-cache)
   - [Go](#go)
   - [Java](#java)
   - [Python](#python)
9. [Model Answers to the Hardest Questions](#model-answers-to-the-hardest-questions)
10. [Complexity & Policy Reference](#complexity--policy-reference-for-the-whiteboard)
11. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is an MFU cache? | Fixed-capacity store that evicts the **most frequently used** key (largest access count) when full. |
| 2 | What does "frequency" count? | The number of times a key was **used** — both `get` (read) and `put` (write/update) count. |
| 3 | What happens on `get` for a present key? | Return its value **and** increment its frequency by 1 (a read is a use). |
| 4 | What frequency does a brand-new key start with? | **1** — the `put` that creates it counts as its first use, not 0. |
| 5 | When does eviction happen? | Only when inserting a **new** key into a full cache. Updating an existing key never evicts. |
| 6 | What is returned on a miss? | A sentinel, conventionally `-1` (matching the LeetCode 460 LFU convention). |
| 7 | If two keys share the same **highest** frequency, which is evicted? | The **least recently used** among the tied keys (recency breaks frequency ties). |
| 8 | What is the difference between MFU and LFU? | MFU evicts the key with the **highest** count; LFU evicts the **lowest**. Same machinery, opposite end. |
| 9 | How does MFU differ from MRU? | MRU evicts by **when** last used (newest); MFU evicts by **how many times** used (highest count). |
| 10 | Give a real-world analogy for MFU. | A worker who has "graduated" a task they've done many times and now wants to free the slot for the next thing to learn. |
| 11 | Why is a naive MFU eviction slow? | Finding the maximum-frequency key by scanning all entries is **O(n)** per eviction. |
| 12 | Does `put` on an existing key change its frequency? | Yes — updating a value is a use, so its frequency increments. |
| 13 | What should `put` do if capacity is 0? | Nothing — a zero-capacity cache stores no items. |
| 14 | Is MFU's `get` a pure read? | No — it mutates state (the frequency counter), so it is not side-effect-free. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | Describe the O(1) MFU design. | Three structures: **key map** (key→node), **frequency map** (freq→recency-ordered DLL), and a **`maxFreq`** integer naming the largest non-empty bucket. |
| 16 | Why does MFU need *three* structures while LRU needs two? | LRU's victim is always the DLL tail; MFU's victim is in the *largest non-empty frequency bucket*, requiring a freq→bucket map plus `maxFreq` to find it in O(1). |
| 17 | How is the recency tie-break achieved in O(1)? | Each frequency bucket is a DLL ordered by recency (front = newest). The **back** of the `maxFreq` bucket is most frequent AND least recently used. |
| 18 | What is the key bookkeeping difference between MFU and LFU? | LFU's `minFreq` rises by exactly 1 when promotion empties the min bucket. MFU's `maxFreq` can **drop by more than 1** when the top bucket empties — it must scan downward to find the next non-empty bucket. This is the central gotcha. |
| 19 | Walk through promoting a node on access in MFU. | Unlink from `B_f`; `freq++`; push to **front** of `B_{f+1}`; set `maxFreq = max(maxFreq, f+1)`. Promotion always **raises** the top, so updating `maxFreq` here is trivial. |
| 20 | Why push promoted nodes to the *front* of the new bucket? | So the **back** is always the least-recently-used at that frequency — making eviction's tie-break free. |
| 21 | Why might the `maxFreq` update be harder than LFU's `minFreq`? | In LFU, the structure that empties (min bucket) and the structure that grows (on insert, freq-1) both push `minFreq` in unit steps. In MFU, eviction removes from the **top** bucket, which may then be empty with the next bucket several levels below — there is no unit-step guarantee downward. |
| 22 | When does `maxFreq` need to be recomputed by scanning? | After an **eviction** empties the `maxFreq` bucket: scan `maxFreq-1, maxFreq-2, …` for the next non-empty bucket. Promotion never needs this (it only raises the ceiling). |
| 23 | Is MFU scan-resistant in the LFU sense? | **No — the opposite.** A one-time scan creates many freq-1 keys; MFU protects them (they have the lowest count) and instead evicts the genuinely hot high-frequency keys. MFU is *anti*-scan-resistant for typical caching. |
| 24 | When would you ever choose MFU? | When high frequency signals "done with this" — e.g., a key that has been hit many times is assumed satisfied and least likely to be needed again, while fresh/rare keys are the ones still in active use. Niche, but real for certain looping/aging workloads. |
| 25 | What is the looping-sequential anomaly MFU sidesteps? | In a cyclic pattern slightly larger than the cache, LRU evicts exactly the next-needed item every time (0% hit ratio). MFU/MRU-style policies evict the *just-completed* hot item instead, which a loop is less likely to need again immediately. |
| 26 | What invariant guarantees eviction reads a non-empty bucket? | `maxFreq` always equals the largest non-empty frequency at eviction time (maintained by promotion raising it and the post-eviction downward scan lowering it). |
| 27 | What's the danger of forgetting to delete an emptied bucket? | The frequency map accumulates stale empty DLLs (memory leak), and the `maxFreq` downward scan can read or stall on empty buckets. |
| 28 | Compare MFU, LFU, LRU in one line each. | MFU = highest count; LFU = lowest count; LRU = oldest access. |
| 29 | What data structure could replace the freq-bucket map, and what does it cost? | A max-heap keyed by frequency — but that makes `get`/`put` **O(log n)** instead of O(1). |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 30 | Walk through the exact `maxFreq` maintenance for both eviction and promotion. | **Promotion:** node moves `f → f+1`; set `maxFreq = max(maxFreq, f+1)` — O(1). **Eviction:** pop the back of `B_{maxFreq}`; if that bucket is now empty, scan `maxFreq` downward to the next non-empty bucket (or to 0 if the cache is empty). |
| 31 | Is the downward scan a violation of the O(1) claim? | It is **amortized O(1)**, not worst-case. Each unit `maxFreq` drops past must have been climbed by some promotion that paid O(1); the total downward distance scanned over a run is bounded by the total upward distance climbed. Per-op it is amortized constant. |
| 32 | How could you make `maxFreq` recomputation strictly O(1)? | Keep the set of occupied frequencies in an **ordered structure with O(1) max** — e.g., a doubly linked list of non-empty buckets in frequency order (van-Emde-Boas-like or an indexed skiplist gives O(log) ; a bucket-linked-list gives O(1) successor/predecessor). Then "next non-empty below" is one pointer hop. |
| 33 | Why is MFU a poor general-purpose cache policy? | Real workloads have **temporal/popularity locality**: frequently used keys are usually the ones you want to *keep*. MFU evicts exactly those, so its hit ratio collapses on Zipfian/locality-rich traces. It only wins on adversarial loop/aging patterns. |
| 34 | Where does MFU-like thinking actually appear in production? | **MRU** (its recency cousin) is used for sequential-scan workloads (e.g., some DB scan buffers, where the just-read block won't be reread). Pure frequency-MFU is rare, but the "evict the saturated/over-served item" idea shows up in admission/aging schemes. |
| 34b | What is the aging problem, and does MFU have it? | LFU's aging: stale once-hot keys squat forever because counts never decay. MFU has a **mirror pathology**: a key hit a few times early then never again *cannot* be the maximum, so it is **protected forever** even when cold — and currently-hot keys are evicted. Same root cause (no decay), opposite victim. |
| 35 | How would you add aging/decay to MFU? | Periodically halve all counts (or decay on access by elapsed time). This compresses the frequency range so the "max" reflects *recent* heavy use, not lifetime totals — and forces the `maxFreq` ceiling to drift down naturally. |
| 36 | How do you make MFU concurrent without a global-lock bottleneck? | Same playbook as LFU/LRU: **shard** by key hash (per-shard `maxFreq`), or **buffer/batch** accesses in per-thread ring buffers drained by a maintenance task, keeping reads near-lock-free. |
| 37 | What goes wrong if you treat `maxFreq` like LFU's `minFreq` (assume it moves in unit steps)? | You'd set `maxFreq--` after an eviction empties the top bucket — but the next bucket might be 3 levels down (gaps form because promotions skip frequencies and buckets empty unevenly). Decrementing by 1 lands you on an **empty bucket**, and the next eviction crashes or mispicks. |
| 38 | Why can gaps form between MFU's frequency buckets but the *ceiling* is still safe to raise trivially? | Promotions always create `B_{f+1}` from `B_f`, so the ceiling only ever rises by exactly 1 per promotion (trivial). Buckets *below* the ceiling empty independently as their nodes get promoted, leaving holes — which only matter on the **downward** scan after eviction. |
| 39 | Could MFU ever be the right CDN policy? | Almost never — CDN catalogs are Zipfian and you want to **keep** the hot head, which MFU evicts. The only sliver is shedding "fully-served" hot objects whose lifecycle is known to be over, but that's better expressed as TTL/lifecycle eviction than as frequency-MFU. |
| 40 | How would you decide between MFU and any sane alternative for a real cache? | Replay a **real request trace** through a simulator for MFU, LRU, LFU, and ARC, and compare hit ratios. Expect MFU to lose badly unless the trace has the specific "high-frequency = done" structure; the data, not intuition, decides. |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 41 | Prove every MFU operation is amortized O(1). | `get`/`put` do bounded hash ops + bounded pointer rewires; promotion raises `maxFreq` in O(1). The only non-constant work is the post-eviction downward scan, bounded amortized by the total promotion climb (potential argument below). |
| 42 | Give the amortization (potential) argument for the downward scan. | Define potential Φ = current `maxFreq`. Each promotion raises Φ by ≤ 1 at O(1) actual cost (amortized ≤ 2). Each eviction's downward scan of `d` steps lowers Φ by `d`, so its amortized cost is `actual(d) − d ≈ O(1)`. Total scan work over the run ≤ total promotion work. |
| 43 | Contrast the `minFreq` Monotonicity Lemma (LFU) with MFU's `maxFreq`. | LFU: `minFreq` resets to 1 on insert and rises by exactly 1 when promotion empties the min bucket — **never searched** (strict O(1)). MFU: `maxFreq` rises by exactly 1 on promotion but can **fall by an arbitrary gap** on eviction — so it needs a search (amortized O(1)) or an auxiliary ordered bucket index for strict O(1). |
| 44 | In what formal sense is MFU *pessimal* under the Independent Reference Model? | Under a fixed distribution `p`, exact LFU converges to caching the **top-k** keys (optimal IRM hit ratio). MFU, evicting the highest-frequency keys, converges to caching the **bottom-k** (least popular) keys — the **worst** stationary contents. It is LFU's mirror in outcome, not just mechanism. |
| 45 | When can MFU's pessimal IRM behavior be the *desired* behavior? | When the value model is inverted: you cache items you *don't yet understand/serve* and discard items you've mastered (e.g., a "study the rare cases" cache, or shedding fully-amortized hot keys whose future cost is zero). The policy is only as good as the assumption "high past frequency ⇒ low future need." |
| 46 | Is MFU subject to Bélády's anomaly? | The frequency criterion isn't a recency stack algorithm, but pure non-decaying MFU's pathology is the **aging mirror** (cold low-count keys protected forever), distinct from Bélády's more-cache-more-faults anomaly. Practical breakage comes from the wrong value model, not the anomaly per se. |
| 47 | Quantify MFU's protection pathology. | A cold key with historical peak count `F` can never be evicted while any other key's count is below `F`; its dead-weight duration grows with how long it stays the (joint) maximum-avoider. Decay turns "least frequently *evictable* forever" into "recently-light" in `O(log F)` halvings. |
| 48 | Why is the *ceiling* trivial to maintain but the *floor of the gap* hard? | Promotion is the only operation that changes which frequencies exist *above*, and it does so by +1 — monotone and local. Eviction removes from the top and can expose a gap of unknown depth; there is no algebraic relation tying the next-lower occupied frequency to `maxFreq`, so you must consult the actual occupancy. |
| 49 | Sketch a strictly-O(1) MFU using a bucket linked list. | Maintain DLL nodes *of buckets* threaded in frequency order. On promotion, splice `B_{f+1}` after `B_f` (create lazily). On eviction emptying `B_{maxFreq}`, set `maxFreq` to the predecessor bucket's frequency via one pointer hop and unlink the empty bucket. All updates O(1); no scan. |
| 50 | How does MFU's anti-scan property invert the LFU scan-resistance argument? | LFU: scan creates freq-1 keys that fill the *min* bucket and are evicted first, protecting the hot set. MFU: those same freq-1 keys fill the *min* bucket and are **protected** (MFU evicts the max), so the scan *survives* while the hot working set is evicted — maximal cache pollution. |
| 51 | Could a hybrid use MFU's machinery for good? | Yes — the freq-bucket + ceiling/floor structure is reusable. **W-TinyLFU** and segmented caches use frequency *sketches* for admission; you could imagine "evict from the heaviest segment under pressure" schemes. The data structure is sound; only the standalone *evict-the-max* policy is usually wrong. |
| 52 | Reconcile "MFU is pessimal" with "MFU is sometimes correct." | Pessimality holds under the standard value model (future need correlates with past frequency), which matches most caching. MFU is correct precisely when that correlation is **inverted**. Both statements are true under different models — exactly the LFU optimality/adversarial duality, reflected. |

---

## Trace-Reading Drills

Interviewers love asking you to predict the eviction victim. Practice these (capacity in parentheses). Remember: **MFU evicts the HIGHEST-frequency key; ties break by LRU within the top bucket.**

**Drill A (capacity 2):** `put(1,1) put(2,2) get(1) put(3,3)` — who is evicted?
> Key **1**. After `get(1)`, freqs are `{1:2, 2:1}`. `put(3)` overflows; `maxFreq=2` holds only key 1. (The *opposite* of LFU, which would evict key 2.)

**Drill B (capacity 2):** `put(1,1) put(2,2) get(2) get(1) get(2) put(3,3)` — who is evicted?
> Key **2**. Freqs: `1:2, 2:3`. `maxFreq=3` holds only key 2. (Frequency, not recency, decides — key 2 was touched most recently *and* most often, and MFU drops it.)

**Drill C (capacity 3):** `put(1,1) put(2,2) put(3,3) get(1) get(2) put(4,4)` — who is evicted?
> Either **1** or **2**. Freqs: `1:2, 2:2, 3:1`. `maxFreq=2` bucket holds keys 1 and 2 (ordered by recency `[2(newest), 1(oldest)]`); the back (oldest) is key **1**. Recency breaks the tie.

**Drill D — the gap (capacity 3):** `put(1,1) put(2,2) put(3,3) get(1) get(1) get(2) put(4,4)` — who is evicted, and what is `maxFreq` afterward?
> Key **1** (freqs `1:3, 2:2, 3:1`; `maxFreq=3` holds only key 1). After evicting key 1, bucket 3 is empty, so the cache must **scan down** from 3 → 2 and set `maxFreq=2`. If you naively did `maxFreq--` you'd land on empty bucket... here 2 happens to be occupied, but construct `get(1) get(1) get(1)` and the drop can be larger.

The pattern: **frequency first (highest wins eviction), recency only on ties.** The make-or-break detail is the post-eviction downward `maxFreq` scan — the one thing LFU never needs.

---

## Rapid-Fire Round (Mixed)

| # | Question | One-line answer |
|---|----------|-----------------|
| 53 | What does MFU evict? | The **highest**-frequency key; LRU tie-break within the top bucket. |
| 54 | What data structure is each frequency bucket? | A doubly linked list with sentinels, ordered by recency (front = newest). |
| 55 | Why a *doubly* linked list, not singly? | Removing an arbitrary node (during promotion) needs its predecessor in O(1). |
| 56 | What does the key map store as its value? | A pointer to the node (which holds value + current freq), not the value alone. |
| 57 | After a promotion empties bucket `f`, must you update `maxFreq`? | No — promotion only *raises* the ceiling; emptied lower buckets matter only on the downward scan after eviction. |
| 58 | When does `maxFreq` change on a `get`? | When the promoted node's new freq `f+1` exceeds `maxFreq`; then `maxFreq = f+1`. |
| 59 | When must `maxFreq` be searched downward? | After an eviction empties the top bucket: scan `maxFreq-1, maxFreq-2, …` to the next non-empty bucket. |
| 60 | Is MFU strictly O(1) per op? | The scan makes the simple design **amortized** O(1); a bucket-linked-list index makes it strictly O(1). |
| 61 | Is MFU scan-resistant? | No — it is the *opposite*; it evicts the hot set and protects one-time scan keys. |
| 62 | Single biggest gotcha vs LFU? | `maxFreq` can drop by more than 1 on eviction; never assume unit steps. |
| 63 | Does `put` on an existing key ever evict? | No — only inserting a *new* key into a full cache evicts. |
| 64 | What's the cheapest fix for MFU's protection pathology? | **Decay** (periodically halve counts) so "max" reflects recent, not lifetime, use. |

---

## Whiteboard Diagnostic: Spot the Bug

Interviewers often hand you broken MFU code. Train on these:

| Symptom in tests | Likely bug | Fix |
|------------------|-----------|-----|
| Crash / wrong pick after an eviction empties the top bucket | `maxFreq` decremented by 1 instead of scanning down | After eviction, if `B_{maxFreq}` is empty, scan downward to the next non-empty bucket (or 0) |
| Wrong key evicted on a frequency tie | Promoted nodes added to the **back** of the new bucket | Always `pushFront` so the back = least recently used |
| `maxFreq` stuck too low; hot keys never evicted | Promotion not raising `maxFreq` to `f+1` | On promote, `maxFreq = max(maxFreq, f+1)` |
| `get` returns right value but later evictions are wrong | `get` not incrementing frequency | Call `promote` inside `get` on every hit |
| Memory grows without bound | Emptied frequency buckets never deleted | `delete freqMap[f]` when its size reaches 0 |
| New key evicted almost immediately | New key inserted with `freq` not reset to 1 / treated as max | New nodes `freq = 1`; only update `maxFreq` if `1 > maxFreq` (i.e. empty cache) |
| Cache size shrinks below expected | Eviction triggered on updating an existing key | Only evict when inserting a brand-new key |

---

## Coding Challenge: O(1) MFU Cache

> **Problem.** Design and implement an MFU cache supporting:
> - `MFUCache(int capacity)` — initialize with a non-negative capacity.
> - `get(key)` — return the value if present (and increment its use count), else `-1`.
> - `put(key, value)` — insert/update; on overflow, evict the **most frequently used** key, breaking ties by **least recently used**.
>
> **Both `get` and `put` run in O(1) amortized time.**
>
> **Design.** `keyMap: key → node`, `freqMap: freq → doubly linked list (recency-ordered)`, and a `maxFreq` integer. Promotion (on every use) moves a node up one frequency bucket and raises `maxFreq` if needed; eviction removes the back of the `maxFreq` bucket, then scans `maxFreq` downward if that bucket emptied.

### Test cases

```
MFUCache c = new MFUCache(2)
c.put(1,1)            // cache {1:1}            freqs {1:1}
c.put(2,2)            // cache {1:1, 2:2}       freqs {1:1, 2:1}
c.get(1)   -> 1       // freq: 1->2 ; maxFreq=2 ; cache {1, 2}
c.put(3,3)            // evict key 1 (freq 2, the MAX) ; cache {2, 3}
c.get(1)   -> -1      // not found
c.get(2)   -> 2       // freq: 2->2 ; maxFreq=2
c.put(4,4)            // tie freq=2 between... only key 2 is at maxFreq=2 -> evict 2 ; cache {3, 4}
c.get(2)   -> -1
c.get(3)   -> 3
c.get(4)   -> 4
```

### Go

```go
package main

import "fmt"

type node struct {
	key, value, freq int
	prev, next       *node
}

type dll struct {
	head, tail *node
	size       int
}

func newDLL() *dll {
	h, t := &node{}, &node{}
	h.next, t.prev = t, h
	return &dll{head: h, tail: t}
}
func (l *dll) pushFront(n *node) {
	n.prev, n.next = l.head, l.head.next
	l.head.next.prev = n
	l.head.next = n
	l.size++
}
func (l *dll) remove(n *node) {
	n.prev.next = n.next
	n.next.prev = n.prev
	l.size--
}
func (l *dll) popBack() *node { n := l.tail.prev; l.remove(n); return n }

type MFUCache struct {
	capacity, maxFreq int
	keyMap            map[int]*node
	freqMap           map[int]*dll
}

func Constructor(capacity int) MFUCache {
	return MFUCache{
		capacity: capacity,
		keyMap:   make(map[int]*node),
		freqMap:  make(map[int]*dll),
	}
}

func (c *MFUCache) promote(n *node) {
	f := n.freq
	c.freqMap[f].remove(n)
	if c.freqMap[f].size == 0 {
		delete(c.freqMap, f)
	}
	n.freq++
	if c.freqMap[n.freq] == nil {
		c.freqMap[n.freq] = newDLL()
	}
	c.freqMap[n.freq].pushFront(n)
	if n.freq > c.maxFreq { // promotion only ever RAISES the ceiling — O(1)
		c.maxFreq = n.freq
	}
}

func (c *MFUCache) Get(key int) int {
	n, ok := c.keyMap[key]
	if !ok {
		return -1
	}
	c.promote(n)
	return n.value
}

func (c *MFUCache) Put(key, value int) {
	if c.capacity == 0 {
		return
	}
	if n, ok := c.keyMap[key]; ok {
		n.value = value
		c.promote(n)
		return
	}
	if len(c.keyMap) >= c.capacity {
		// Evict the most frequently used: back of the maxFreq bucket.
		victim := c.freqMap[c.maxFreq].popBack()
		delete(c.keyMap, victim.key)
		if c.freqMap[c.maxFreq].size == 0 {
			delete(c.freqMap, c.maxFreq)
			// THE GOTCHA: maxFreq can drop by more than 1 — scan downward.
			for c.maxFreq > 0 && c.freqMap[c.maxFreq] == nil {
				c.maxFreq--
			}
		}
	}
	n := &node{key: key, value: value, freq: 1}
	c.keyMap[key] = n
	if c.freqMap[1] == nil {
		c.freqMap[1] = newDLL()
	}
	c.freqMap[1].pushFront(n)
	if c.maxFreq < 1 {
		c.maxFreq = 1
	}
}

func main() {
	c := Constructor(2)
	c.Put(1, 1)
	c.Put(2, 2)
	fmt.Println(c.Get(1)) // 1   (key 1 freq -> 2, maxFreq = 2)
	c.Put(3, 3)           // evict 1 (the MAX freq)
	fmt.Println(c.Get(1)) // -1
	fmt.Println(c.Get(2)) // 2
	c.Put(4, 4)           // evict 2 (now the MAX freq)
	fmt.Println(c.Get(2)) // -1
	fmt.Println(c.Get(3)) // 3
	fmt.Println(c.Get(4)) // 4
}
```

### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Solution {

    static class Node {
        int key, value, freq = 1;
        Node prev, next;
        Node() {}
        Node(int k, int v) { key = k; value = v; }
    }

    static class DLL {
        final Node head = new Node(), tail = new Node();
        int size = 0;
        DLL() { head.next = tail; tail.prev = head; }
        void pushFront(Node n) {
            n.prev = head; n.next = head.next;
            head.next.prev = n; head.next = n; size++;
        }
        void remove(Node n) { n.prev.next = n.next; n.next.prev = n.prev; size--; }
        Node popBack() { Node n = tail.prev; remove(n); return n; }
    }

    static class MFUCache {
        final int capacity;
        int maxFreq = 0;
        final Map<Integer, Node> keyMap = new HashMap<>();
        final Map<Integer, DLL> freqMap = new HashMap<>();

        MFUCache(int capacity) { this.capacity = capacity; }

        void promote(Node n) {
            int f = n.freq;
            DLL list = freqMap.get(f);
            list.remove(n);
            if (list.size == 0) freqMap.remove(f);
            n.freq++;
            freqMap.computeIfAbsent(n.freq, k -> new DLL()).pushFront(n);
            if (n.freq > maxFreq) maxFreq = n.freq; // only ever raises — O(1)
        }

        int get(int key) {
            Node n = keyMap.get(key);
            if (n == null) return -1;
            promote(n);
            return n.value;
        }

        void put(int key, int value) {
            if (capacity == 0) return;
            Node n = keyMap.get(key);
            if (n != null) { n.value = value; promote(n); return; }
            if (keyMap.size() >= capacity) {
                Node victim = freqMap.get(maxFreq).popBack(); // evict the MAX
                keyMap.remove(victim.key);
                if (freqMap.get(maxFreq).size == 0) {
                    freqMap.remove(maxFreq);
                    // THE GOTCHA: maxFreq may drop by more than 1 — scan down.
                    while (maxFreq > 0 && !freqMap.containsKey(maxFreq)) maxFreq--;
                }
            }
            Node fresh = new Node(key, value);
            keyMap.put(key, fresh);
            freqMap.computeIfAbsent(1, k -> new DLL()).pushFront(fresh);
            if (maxFreq < 1) maxFreq = 1;
        }
    }

    public static void main(String[] args) {
        MFUCache c = new MFUCache(2);
        c.put(1, 1);
        c.put(2, 2);
        System.out.println(c.get(1)); // 1   (key 1 freq -> 2)
        c.put(3, 3);                   // evict 1 (the MAX)
        System.out.println(c.get(1)); // -1
        System.out.println(c.get(2)); // 2
        c.put(4, 4);                   // evict 2 (now the MAX)
        System.out.println(c.get(2)); // -1
        System.out.println(c.get(3)); // 3
        System.out.println(c.get(4)); // 4
    }
}
```

### Python

```python
class Node:
    __slots__ = ("key", "value", "freq", "prev", "next")

    def __init__(self, key=0, value=0):
        self.key = key
        self.value = value
        self.freq = 1
        self.prev = None
        self.next = None


class DLL:
    def __init__(self):
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head
        self.size = 0

    def push_front(self, n):
        n.prev, n.next = self.head, self.head.next
        self.head.next.prev = n
        self.head.next = n
        self.size += 1

    def remove(self, n):
        n.prev.next = n.next
        n.next.prev = n.prev
        self.size -= 1

    def pop_back(self):
        n = self.tail.prev
        self.remove(n)
        return n


class MFUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.max_freq = 0
        self.key_map: dict[int, Node] = {}
        self.freq_map: dict[int, DLL] = {}

    def _promote(self, n: Node) -> None:
        f = n.freq
        self.freq_map[f].remove(n)
        if self.freq_map[f].size == 0:
            del self.freq_map[f]
        n.freq += 1
        self.freq_map.setdefault(n.freq, DLL()).push_front(n)
        if n.freq > self.max_freq:  # promotion only raises the ceiling — O(1)
            self.max_freq = n.freq

    def get(self, key: int) -> int:
        n = self.key_map.get(key)
        if n is None:
            return -1
        self._promote(n)
        return n.value

    def put(self, key: int, value: int) -> None:
        if self.capacity == 0:
            return
        n = self.key_map.get(key)
        if n is not None:
            n.value = value
            self._promote(n)
            return
        if len(self.key_map) >= self.capacity:
            # Evict the MOST frequently used: back of the max_freq bucket.
            victim = self.freq_map[self.max_freq].pop_back()
            del self.key_map[victim.key]
            if self.freq_map[self.max_freq].size == 0:
                del self.freq_map[self.max_freq]
                # THE GOTCHA: max_freq may drop by more than 1 — scan downward.
                while self.max_freq > 0 and self.max_freq not in self.freq_map:
                    self.max_freq -= 1
        fresh = Node(key, value)
        self.key_map[key] = fresh
        self.freq_map.setdefault(1, DLL()).push_front(fresh)
        if self.max_freq < 1:
            self.max_freq = 1


if __name__ == "__main__":
    c = MFUCache(2)
    c.put(1, 1)
    c.put(2, 2)
    print(c.get(1))  # 1   (key 1 freq -> 2)
    c.put(3, 3)      # evict 1 (the MAX)
    print(c.get(1))  # -1
    print(c.get(2))  # 2
    c.put(4, 4)      # evict 2 (now the MAX)
    print(c.get(2))  # -1
    print(c.get(3))  # 3
    print(c.get(4))  # 4
```

### The naive O(n) version and why it's slow

```python
class NaiveMFUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.store = {}   # key -> (value, freq)

    def get(self, key):
        if key not in self.store:
            return -1
        v, f = self.store[key]
        self.store[key] = (v, f + 1)
        return v

    def put(self, key, value):
        if self.capacity == 0:
            return
        if key in self.store:
            _, f = self.store[key]
            self.store[key] = (value, f + 1)
            return
        if len(self.store) >= self.capacity:
            # O(n): scan every entry to find the maximum frequency.
            victim = max(self.store, key=lambda k: self.store[k][1])
            del self.store[victim]
        self.store[key] = (value, 1)
```

> This is correct but `put` is **O(n)** on eviction because `max(...)` scans all entries. It also loses the recency tie-break (it picks an arbitrary max on ties). The bucket design exists precisely to make "find the max-frequency, least-recently-used key" O(1) instead of O(n).

### Follow-up questions an interviewer may ask

| Follow-up | Strong answer |
|-----------|---------------|
| "Why can't you just do `maxFreq--` after eviction?" | Because lower buckets empty independently of the ceiling, leaving **gaps**; the next occupied bucket may be several levels down. You must scan (amortized O(1)) or keep a bucket-linked-list index (strictly O(1)). |
| "Make eviction strictly O(1)." | Thread the non-empty buckets in a frequency-ordered linked list; after emptying the top bucket, hop to its predecessor in one step instead of scanning. |
| "Make it thread-safe." | Wrap with a lock; for scale, **shard** by key hash (per-shard `maxFreq`) or **buffer** accesses Caffeine-style so reads stay near-lock-free. |
| "Counts grow forever — fix it." | Add **decay**: periodically halve all counts, or decay on access. This also keeps `maxFreq` from drifting unboundedly high. |
| "Generic key/value, not just ints?" | Parameterize `Node` over `K, V`; use a hashable key type. The DLL/freq logic is unchanged. |
| "What's the worst-case complexity?" | O(1) **amortized** (the downward scan is paid for by prior promotions); the hash map's O(n) collision worst case still applies, as in LRU/LFU. |

---

## Model Answers to the Hardest Questions

These four questions separate strong candidates. Here is how to answer them in full.

### "Why is MFU's `maxFreq` harder to maintain than LFU's `minFreq`?"

> "They look symmetric but they are not. In LFU, the minimum is pushed by two forces that both move it in **unit steps**: an insert creates a freq-1 key, so `minFreq` snaps to 1; and a promotion that empties the min bucket lands the node in `minFreq + 1`, so the minimum rises by exactly one. There is always a key sitting at the new minimum — it is never searched. In MFU, promotion likewise raises the ceiling by exactly one, so updating `maxFreq` upward is trivial. The asymmetry is on **eviction**: MFU evicts from the *top* bucket, and when that bucket empties, the next occupied bucket can be an arbitrary number of levels below, because lower buckets emptied independently as their nodes were promoted past them. There is no algebraic relation tying the next-lower occupied frequency to the old maximum, so you must consult actual occupancy — either by scanning down (amortized O(1)) or via an auxiliary ordered bucket index (strictly O(1)). Decrementing `maxFreq` by one is the classic bug; it lands on an empty bucket."

### "Prove MFU is still O(1) despite the downward scan."

> "Use a potential argument with Φ equal to the current `maxFreq`. Every promotion does O(1) actual work and raises Φ by at most one, so its amortized cost is O(1). Every eviction whose downward scan walks `d` empty buckets does O(d) actual work but *lowers* Φ by `d`, so its amortized cost is `O(d) − d = O(1)`. Summed over any run, the total downward distance scanned can never exceed the total upward distance climbed by promotions, each of which was paid for. Therefore all operations are O(1) amortized. If you need a strict per-operation bound, thread the non-empty buckets in a frequency-ordered linked list so the next-lower bucket is one pointer hop — that removes the scan entirely."

### "When would you actually choose MFU over LRU or LFU?"

> "Almost never for a general cache, and you should say so plainly — it is the right answer. MFU evicts the most frequently used keys, which under any normal value model are exactly the ones worth keeping; under the Independent Reference Model it converges to caching the *least* popular keys, the pessimal contents. MFU only wins when the value model is **inverted**: when high past frequency signals that an item is *done* and least likely to be needed again. That happens in specific looping or lifecycle patterns — e.g., a cyclic scan slightly larger than the cache, where LRU evicts the next-needed item every time and a most-recently/most-frequently-used eviction keeps the items the loop will actually revisit. In an interview I'd reach for **MRU** (its recency cousin) for sequential-scan buffers, and treat pure frequency-MFU as a teaching mirror of LFU rather than a production default."

### "Design eviction for a workload where 'heavily used' means 'finished.'"

> "If frequency genuinely anti-correlates with future need, MFU's machinery is exactly right — but I'd harden it three ways. First, **decay**: halve all counts periodically so 'most frequently used' means recent heavy use, not lifetime totals, and the `maxFreq` ceiling can drift down naturally instead of ratcheting up forever. Second, replace the post-eviction downward scan with a **frequency-ordered bucket linked list** so the top-bucket predecessor is one hop — strict O(1) under pressure. Third, **measure**: replay the real trace against MFU, LRU, LFU, and ARC, because the entire bet rests on the inverted value model, and only the trace can confirm that high frequency really does mean 'safe to drop.' If the hit ratio doesn't beat LRU, the assumption was wrong and MFU is the wrong tool."

---

## Complexity & Policy Reference (for the whiteboard)

Memorize this grid — interviewers expect instant recall.

| Policy | get | put | evict | Space/entry | Scan-resistant | Keeps the hot set |
|--------|-----|-----|-------|-------------|----------------|-------------------|
| Naive MFU (scan) | O(1) | O(n) on evict | O(n) | freq + value | No | **No** (evicts it) |
| **O(1) MFU (bucket + maxFreq)** | **O(1)** | **O(1) amortized** | **O(1) amortized** | freq + DLL ptrs | No | **No** (evicts it) |
| MFU + bucket-list index | O(1) | O(1) **strict** | O(1) **strict** | freq + DLL ptrs | No | **No** (evicts it) |
| Decaying MFU | O(1) | O(1) | O(1) | freq + time | No | No (recent-weighted) |
| **O(1) LFU (LC 460)** | O(1) | O(1) | O(1) | freq + DLL ptrs | **Yes** | **Yes** |
| LRU | O(1) | O(1) | O(1) | DLL ptrs | No | Yes (recency) |

> Note: all "O(1)" entries are **average/amortized** (the hash map's worst case is O(n) on pathological collisions; the linked-list work is always O(1)). MFU's *amortized* qualifier additionally covers the downward `maxFreq` scan, removed only by the bucket-list index.

### Two-sentence policy pitches (for "compare X vs Y")

- **MFU vs LFU:** Identical three-structure machinery, opposite victim — MFU evicts the **max** frequency (with a `maxFreq` pointer), LFU the **min** (with `minFreq`). The bookkeeping breaks symmetry: LFU's `minFreq` moves in strict unit steps, but MFU's `maxFreq` can drop by an arbitrary gap on eviction, needing a downward scan (amortized O(1)) or a bucket-list index (strict O(1)).
- **MFU vs LRU:** MFU evicts by *how often* a key was used (highest count); LRU by *how recently* (oldest). LRU keeps the recently-hot set; MFU throws it away, which is usually wrong but exactly right for cyclic/scan patterns where the just-finished hot item won't return soon.
- **MFU vs MRU:** Both target the "just-served, won't-need-again" item, but MRU uses *recency* (evict the newest) and MFU uses *frequency* (evict the highest count). MRU is the more common real-world choice (sequential-scan buffers); MFU is its frequency-flavored, niche cousin.

---

## Quick-Reference Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| MFU policy | Evict the **highest-count** key; ties → **least recently used** |
| New key freq | Starts at **1** |
| O(1) structures | keyMap + freqMap(freq→DLL) + `maxFreq` |
| `maxFreq` on promote | `maxFreq = max(maxFreq, f+1)` — trivial, always rises |
| `maxFreq` on evict | If top bucket empties, **scan downward** to the next non-empty bucket (the gotcha) |
| Tie-break | **Back** of the `maxFreq` bucket (recency-ordered DLL) |
| Strict O(1) trick | Thread non-empty buckets in a frequency-ordered linked list |
| Scan-resistant? | **No** — MFU evicts the hot set and protects scan keys |
| When to use | Inverted value model: high frequency = "done"; cyclic/scan loops |
| Pathology | Cold low-count keys protected forever (aging mirror of LFU) → fix with **decay** |
| Mirror of | **LFU** (min↔max); recency cousin is **MRU** |
| Cross-refs | [LFU](../21-lfu-cache/interview.md) · [LRU](../01-lru-cache/interview.md) |

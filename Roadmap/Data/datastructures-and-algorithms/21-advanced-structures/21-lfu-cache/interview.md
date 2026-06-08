# LFU Cache — Interview Preparation

> Tiered questions (Junior → Middle → Senior → Professional) followed by the canonical coding challenge: **LeetCode 460 — O(1) LFU Cache** in Go, Java, and Python.
> Cross-references: [LRU cache](../01-lru-cache/interview.md) · [ARC / 2Q](../22-arc-2q-cache/interview.md) · [Count-Min Sketch](../08-count-min-sketch/interview.md).

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is an LFU cache? | Fixed-capacity store that evicts the **least frequently used** key (smallest access count) when full. |
| 2 | What does "frequency" count? | The number of times a key was **used** — both `get` (read) and `put` (write/update) count. |
| 3 | What happens on `get` for a present key? | Return its value **and** increment its frequency by 1 (a read is a use). |
| 4 | What frequency does a brand-new key start with? | **1** — the `put` that creates it counts as its first use, not 0. |
| 5 | When does eviction happen? | Only when inserting a **new** key into a full cache. Updating an existing key never evicts. |
| 6 | What is returned on a miss? | A sentinel, conventionally `-1` (LeetCode 460 convention). |
| 7 | If two keys have the same lowest frequency, which is evicted? | The **least recently used** among the tied keys (recency breaks frequency ties). |
| 8 | What is the difference between LFU and LRU? | LFU evicts by **how many times** used (frequency); LRU evicts by **when** last used (recency). |
| 9 | Give a real-world analogy for LFU. | A bookshelf ranked by how often each book is read; donate the least-read book when full. |
| 10 | What is the space complexity of an LFU cache? | O(capacity) — it stores at most `capacity` entries plus per-key metadata. |
| 11 | Why is a naive LFU eviction slow? | Finding the minimum-frequency key by scanning all entries is **O(n)** per eviction. |
| 12 | Does `put` on an existing key change its frequency? | Yes — updating a value is a use, so its frequency increments. |
| 13 | What should `put` do if capacity is 0? | Nothing — a zero-capacity cache stores no items. |
| 14 | Is LFU's `get` a pure read? | No — it mutates state (the frequency counter), so it is not side-effect-free. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | Describe the O(1) LFU design. | Three structures: **key map** (key→node), **frequency map** (freq→recency-ordered DLL), and a **`minFreq`** integer naming the smallest non-empty bucket. |
| 16 | Why does LFU need *three* structures while LRU needs two? | LRU's victim is always the DLL tail; LFU's victim is in the *smallest non-empty frequency bucket*, requiring a freq→bucket map plus `minFreq` to find it in O(1). |
| 17 | How is the recency tie-break achieved in O(1)? | Each frequency bucket is a DLL ordered by recency (front = newest). The **back** of the `minFreq` bucket is least frequent AND least recently used. |
| 18 | How does `minFreq` stay correct without searching? | On insert it resets to **1**; on a promotion that empties the min bucket it rises by **exactly 1** (the node moved to `f+1`). It never needs a search. |
| 19 | Walk through promoting a node on access. | Unlink from `B_f`; if `B_f` empty and it was `minFreq`, set `minFreq=f+1`; `freq++`; push to **front** of `B_{f+1}`. |
| 20 | Why push promoted nodes to the *front* of the new bucket? | So the **back** is always the least-recently-used at that frequency — making eviction's tie-break free. |
| 21 | When is LFU better than LRU? | Stable, **skewed** workloads where a few keys are reliably hot, and **scan-heavy** workloads (LFU is scan-resistant). |
| 22 | When is LRU better than LFU? | When popularity **shifts over time** — LRU adapts immediately, exact LFU is anchored by stale counts. |
| 23 | Why is LFU "scan-resistant"? | A one-time scan creates many freq-1 keys; they fill the `minFreq=1` bucket and are evicted first, protecting genuinely-hot high-frequency keys. |
| 24 | What is the aging problem? | Counts only go up, so an old once-popular key keeps a high count forever and is never evicted, even when cold — polluting the cache. |
| 25 | Name three fixes for aging. | Periodic decay (halve counts), windowed counts, decay-on-access (LFU with dynamic aging). |
| 26 | What invariant guarantees eviction reads a non-empty bucket? | `minFreq` always equals the smallest non-empty frequency at eviction time (maintained by the insert-resets-to-1 / promote-raises-by-1 rules). |
| 27 | What's the danger of forgetting to delete an emptied bucket? | The frequency map accumulates stale empty DLLs (memory leak) and `minFreq` logic can read an empty bucket. |
| 28 | Compare LFU, LRU, FIFO in one line each. | LFU = lowest count; LRU = oldest access; FIFO = oldest insertion. |
| 29 | What data structure could replace the freq-bucket map, and what does it cost? | A min-heap keyed by frequency — but that makes `get`/`put` **O(log n)** instead of O(1). |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 30 | How does Redis implement LFU eviction? | An 8-bit **logarithmic (Morris-style)** counter + 16-bit decay timestamp per object; eviction **samples** N random keys and drops the lowest counter. No global minimum. |
| 31 | What is a Morris counter and why use it for LFU? | A probabilistic counter that counts to N using ~log log N bits by incrementing with probability shrinking as it grows; gives a frequency **ranking** in ~1 byte instead of exact counts. |
| 32 | Why does Redis use a *logarithmic* counter? | An exact 8-bit counter saturates at 255 instantly for hot keys; logarithmic increments measure orders of magnitude, distinguishing hot from cold across a huge range. |
| 33 | What does Redis's `LFU_INIT_VAL = 5` accomplish? | New keys start above zero so they are not instantly evicted before proving themselves (cold-start protection). |
| 34 | What is TinyLFU? | An **admission** policy using a Count-Min frequency sketch (with reset-on-N aging and an optional Bloom doorkeeper): admit a candidate only if its estimated frequency beats the victim's. |
| 35 | What is W-TinyLFU and where is it used? | TinyLFU plus a small LRU **admission window** for bursty newcomers, with adaptive window sizing. Used by **Caffeine** (Java) and Ristretto (Go). |
| 36 | Why add an LRU window in front of TinyLFU? | A key that is about to trend looks like a singleton at first; the window gives newcomers a probation period before the frequency gate judges them. |
| 37 | Why is LFU good for CDN eviction? | Catalogs are heavily skewed (Zipfian); frequency protects the hot head from tail bursts/scans. Real CDNs add **size/cost weighting** (e.g., GreedyDual-Size-Frequency) and **decay**. |
| 38 | How do you make LFU concurrent without a global lock bottleneck? | **Shard** by key hash, or **buffer/batch** accesses in per-thread ring buffers drained by a background maintenance task (Caffeine), keeping reads near-lock-free. |
| 39 | What is the doorkeeper in TinyLFU? | A small Bloom filter (cleared each epoch) that absorbs singletons: a first sighting only sets a Bloom bit, so unique keys never pollute the Count-Min sketch. |
| 40 | How would you decide between LRU and LFU for a new cache? | Replay a **real request trace** through a cache simulator for both policies and compare hit ratios; pick by workload, or use W-TinyLFU/ARC to get both. |
| 41 | What metrics signal an aging problem in production? | Hit ratio degrading over time, high `stale_hot_fraction`, counter saturation, and rising eviction rate on currently-hot keys. |
| 42 | Difference between object hit ratio and byte hit ratio? | Object hit ratio = fraction of requests served from cache; byte hit ratio = fraction of bytes — they diverge when object sizes vary (matters for CDN bandwidth cost). |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 43 | Prove every O(1)-LFU operation is O(1). | Each op does bounded hash ops + bounded pointer rewires; `promote` raises freq by 1 with no loop; `minFreq` is maintained without search via the Monotonicity Lemma. |
| 44 | State and justify the `minFreq` Monotonicity Lemma. | `minFreq` resets to 1 on insert and rises by exactly 1 when a promotion empties the min bucket (promoted node populates `f+1`); hence no search needed. |
| 45 | In what formal sense is LFU optimal? | Under the **Independent Reference Model** (fixed distribution `p`), exact LFU converges (by SLLN) to caching the **top-k** keys, achieving the optimal IRM hit ratio `H*`. |
| 46 | What is LFU's competitive ratio? | **Unbounded** — an adversary inflates one key's count, then loops a working set; the stale count makes LFU thrash arbitrarily worse than offline MIN. (LRU is k-competitive.) |
| 47 | Reconcile "LFU is optimal" with "LFU is unboundedly bad." | Optimality holds under the **stationary** IRM (average-case); the unbounded ratio is **adversarial** (worst-case, non-stationary). Different models, both true. |
| 48 | Quantify the aging problem. | A stale key's dead-weight duration grows **linearly** in its historical peak count `F`; decay reduces forgetting time to `O(log F)` (exponential→logarithmic). |
| 49 | Give the Morris counter's error. | Unbiased (`E[X]=n`); relative std ≈ `1/sqrt(2)` for base 2; tunable base trades bits for accuracy; needs `O(log log n)` bits. Ranking is preserved when frequencies differ beyond the noise. |
| 50 | Why is TinyLFU admission sound? | Count-Min gives one-sided (over-)estimates with error ≤ `eps*N` w.h.p.; the admit decision matches the exact decision except within that error band, costing at most a near-tie difference. |
| 51 | Why does reset-on-N give TinyLFU adaptivity? | Halving all counters after N additions bounds the epoch and fades old frequency multiplicatively — a soft sliding window fusing frequency with coarse recency. |
| 52 | Is LFU subject to Bélády's anomaly? | No for the frequency criterion in the same way LRU is a stack algorithm; but pure LFU's lack of decay causes a *different* pathology (aging), not Bélády's anomaly. |

---

## Trace-Reading Drills

Interviewers love asking you to predict the eviction victim. Practice these (capacity in parentheses).

**Drill A (capacity 2):** `put(1,1) put(2,2) get(1) put(3,3)` — who is evicted?
> Key **2**. After `get(1)`, freqs are `{1:2, 2:1}`. `put(3)` overflows; minFreq=1 holds only key 2.

**Drill B (capacity 2):** `put(1,1) put(2,2) get(2) get(1) get(2) put(3,3)` — who is evicted?
> Key **1**. Freqs: `1:2, 2:3`. minFreq=2 holds only key 1. (Frequency, not recency, decides here — key 1 was touched recently but is less frequent.)

**Drill C (capacity 3):** `put(1,1) put(2,2) put(3,3) get(1) get(2) put(4,4)` — who is evicted?
> Key **3**. Freqs: `1:2, 2:2, 3:1`. minFreq=1 holds only key 3.

**Drill D — the tie (capacity 2):** `put(1,1) put(2,2) get(1) get(2) put(3,3)` — who is evicted?
> Key **1**. Freqs tie at `1:2, 2:2`; minFreq=2 bucket is ordered by recency `[2(newest), 1(oldest)]`; the back (oldest) is key 1. Recency breaks the tie.

The pattern: **frequency first, recency only on ties.** If you can explain Drill D out loud you understand the policy.

---

## Rapid-Fire Round (Mixed)

| # | Question | One-line answer |
|---|----------|-----------------|
| 53 | LeetCode number for LFU? For LRU? | 460 (LFU), 146 (LRU). |
| 54 | What data structure is each frequency bucket? | A doubly linked list with sentinels, ordered by recency (front = newest). |
| 55 | Why a *doubly* linked list, not singly? | Removing an arbitrary node (during promotion) needs its predecessor in O(1). |
| 56 | What does the key map store as its value? | A pointer to the node (which holds value + current freq), not the value alone. |
| 57 | After a promotion empties bucket `f`, what happens to `freqMap[f]`? | The empty DLL is deleted from the map (avoids leak / stale reads). |
| 58 | Can `minFreq` ever decrease without an insert? | No — only an insert (which adds a freq-1 key) can lower it; it resets to 1 there. |
| 59 | Is exact LFU used in Redis? | No — Redis uses an approximate logarithmic counter with decay and sampled eviction. |
| 60 | What's the cheapest production aging fix keeping exact counts? | LFUDA (dynamic aging): add a rising `age` floor to counts. |
| 61 | What is the "doorkeeper" for? | A small Bloom filter that keeps singletons out of the TinyLFU frequency sketch. |
| 62 | Which policy is generally considered best, and why? | W-TinyLFU — frequency-aware, scan-resistant, adaptive, ~10 bits/entry. |
| 63 | Does `put` on a key that already exists ever evict? | No — only inserting a *new* key into a full cache evicts. |
| 64 | What is the time complexity of recomputing `minFreq` from scratch? | O(distinct frequencies); avoided entirely via the +1/reset rule (kept O(1)). |

## Whiteboard Diagnostic: Spot the Bug

Interviewers often hand you broken LFU code. Train on these:

| Symptom in tests | Likely bug | Fix |
|------------------|-----------|-----|
| Wrong key evicted on a frequency tie | Promoted nodes added to the **back** of the new bucket | Always `pushFront` so the back = least recently used |
| Crash: reading an empty bucket on evict | `minFreq` not advanced after a promotion empties the min bucket | If emptied bucket was `minFreq`, set `minFreq = f + 1` |
| `get` returns right value but later evictions are wrong | `get` not incrementing frequency | Call `promote` inside `get` on every hit |
| Memory grows without bound | Emptied frequency buckets never deleted | `delete freqMap[f]` when its size reaches 0 |
| New key evicted almost immediately | New key inserted with `freq` not reset / `minFreq` not set to 1 | New nodes `freq = 1`; set `minFreq = 1` on insert |
| Cache size shrinks below expected | Eviction triggered on updating an existing key | Only evict when inserting a brand-new key |

---

## Coding Challenge: LeetCode 460 — LFU Cache (O(1))

> **Problem.** Design and implement an LFU cache supporting:
> - `LFUCache(int capacity)` — initialize with positive capacity.
> - `get(key)` — return the value if present (and increment its use count), else `-1`.
> - `put(key, value)` — insert/update; on overflow, evict the **least frequently used** key, breaking ties by **least recently used**.
>
> **Both `get` and `put` must run in O(1) average time.**
>
> **Design.** `keyMap: key → node`, `freqMap: freq → doubly linked list (recency-ordered)`, and a `minFreq` integer. Promotion (on every use) moves a node up one frequency bucket; eviction removes the back of the `minFreq` bucket.

### Test cases

```
LFUCache c = new LFUCache(2)
c.put(1,1)            // cache {1:1}
c.put(2,2)            // cache {1:1, 2:2}
c.get(1)   -> 1       // freq: 1->2 ; cache {1, 2}
c.put(3,3)            // evict key 2 (freq 1) ; cache {1, 3}
c.get(2)   -> -1      // not found
c.get(3)   -> 3       // freq: 3->2
c.put(4,4)            // tie freq=2 between 1 and 3; 1 is LRU -> evict 1 ; cache {3, 4}
c.get(1)   -> -1
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

type LFUCache struct {
	capacity, minFreq int
	keyMap            map[int]*node
	freqMap           map[int]*dll
}

func Constructor(capacity int) LFUCache {
	return LFUCache{
		capacity: capacity,
		keyMap:   make(map[int]*node),
		freqMap:  make(map[int]*dll),
	}
}

func (c *LFUCache) promote(n *node) {
	f := n.freq
	c.freqMap[f].remove(n)
	if c.freqMap[f].size == 0 {
		delete(c.freqMap, f)
		if c.minFreq == f {
			c.minFreq = f + 1
		}
	}
	n.freq++
	if c.freqMap[n.freq] == nil {
		c.freqMap[n.freq] = newDLL()
	}
	c.freqMap[n.freq].pushFront(n)
}

func (c *LFUCache) Get(key int) int {
	n, ok := c.keyMap[key]
	if !ok {
		return -1
	}
	c.promote(n)
	return n.value
}

func (c *LFUCache) Put(key, value int) {
	if c.capacity == 0 {
		return
	}
	if n, ok := c.keyMap[key]; ok {
		n.value = value
		c.promote(n)
		return
	}
	if len(c.keyMap) >= c.capacity {
		victim := c.freqMap[c.minFreq].popBack()
		delete(c.keyMap, victim.key)
	}
	n := &node{key: key, value: value, freq: 1}
	c.keyMap[key] = n
	if c.freqMap[1] == nil {
		c.freqMap[1] = newDLL()
	}
	c.freqMap[1].pushFront(n)
	c.minFreq = 1
}

func main() {
	c := Constructor(2)
	c.Put(1, 1)
	c.Put(2, 2)
	fmt.Println(c.Get(1)) // 1
	c.Put(3, 3)           // evict 2
	fmt.Println(c.Get(2)) // -1
	fmt.Println(c.Get(3)) // 3
	c.Put(4, 4)           // evict 1
	fmt.Println(c.Get(1)) // -1
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

    static class LFUCache {
        final int capacity;
        int minFreq = 0;
        final Map<Integer, Node> keyMap = new HashMap<>();
        final Map<Integer, DLL> freqMap = new HashMap<>();

        LFUCache(int capacity) { this.capacity = capacity; }

        void promote(Node n) {
            int f = n.freq;
            DLL list = freqMap.get(f);
            list.remove(n);
            if (list.size == 0) {
                freqMap.remove(f);
                if (minFreq == f) minFreq = f + 1;
            }
            n.freq++;
            freqMap.computeIfAbsent(n.freq, k -> new DLL()).pushFront(n);
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
                Node victim = freqMap.get(minFreq).popBack();
                keyMap.remove(victim.key);
            }
            Node fresh = new Node(key, value);
            keyMap.put(key, fresh);
            freqMap.computeIfAbsent(1, k -> new DLL()).pushFront(fresh);
            minFreq = 1;
        }
    }

    public static void main(String[] args) {
        LFUCache c = new LFUCache(2);
        c.put(1, 1);
        c.put(2, 2);
        System.out.println(c.get(1)); // 1
        c.put(3, 3);                   // evict 2
        System.out.println(c.get(2)); // -1
        System.out.println(c.get(3)); // 3
        c.put(4, 4);                   // evict 1
        System.out.println(c.get(1)); // -1
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


class LFUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.min_freq = 0
        self.key_map: dict[int, Node] = {}
        self.freq_map: dict[int, DLL] = {}

    def _promote(self, n: Node) -> None:
        f = n.freq
        self.freq_map[f].remove(n)
        if self.freq_map[f].size == 0:
            del self.freq_map[f]
            if self.min_freq == f:
                self.min_freq = f + 1
        n.freq += 1
        self.freq_map.setdefault(n.freq, DLL()).push_front(n)

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
            victim = self.freq_map[self.min_freq].pop_back()
            del self.key_map[victim.key]
        fresh = Node(key, value)
        self.key_map[key] = fresh
        self.freq_map.setdefault(1, DLL()).push_front(fresh)
        self.min_freq = 1


if __name__ == "__main__":
    c = LFUCache(2)
    c.put(1, 1)
    c.put(2, 2)
    print(c.get(1))  # 1
    c.put(3, 3)      # evict 2
    print(c.get(2))  # -1
    print(c.get(3))  # 3
    c.put(4, 4)      # evict 1
    print(c.get(1))  # -1
    print(c.get(3))  # 3
    print(c.get(4))  # 4
```

### Follow-up questions an interviewer may ask

| Follow-up | Strong answer |
|-----------|---------------|
| "Make it thread-safe." | Wrap with a lock; for scale, **shard** by key hash or **buffer** accesses (Caffeine-style ring buffers) so reads stay near-lock-free. |
| "Counts grow forever — fix it." | Add **decay**: periodically halve all counts, or decay on access (Redis-style time-based). This solves the **aging problem**. |
| "Cut the per-key memory." | Replace exact counts with a **Morris / logarithmic counter** (~1 byte) and evict by **sampling** (Redis approach). |
| "Best general-purpose policy?" | **W-TinyLFU** (Caffeine): TinyLFU admission sketch + small LRU window + adaptive sizing — beats LRU/LFU/ARC/2Q on most traces. |
| "Generic key/value, not just ints?" | Parameterize `Node` over `K, V`; use a hashable key type. The DLL/freq logic is unchanged. |
| "What's the worst-case complexity?" | O(1) **amortized/expected**; worst case is the hash map's O(n) on pathological collisions — the DLL work is always O(1). |

---

## Model Answers to the Hardest Questions

These four questions separate strong candidates. Here is how to answer them in full.

### "Walk me through why every operation is O(1)."

> "Both `get` and `put` reduce to three primitives, each O(1). **Lookup** is a single hash-map access. **Promotion** unlinks a node from its current frequency bucket (a constant number of pointer rewires on a doubly linked list), increments its frequency, and pushes it to the front of the next bucket — no loop. **Eviction** removes the back node of the `minFreq` bucket and deletes one map entry. The only thing that *could* cost more is recomputing `minFreq`, but it never needs a search: on insert it resets to 1 because a freq-1 key now exists, and on a promotion that empties the min bucket it rises by exactly 1 because the promoted node landed in `minFreq + 1`. So the minimum moves in unit steps or snaps to 1 — never searched. Hash operations are O(1) expected, the pointer work is O(1) worst-case, so the whole thing is O(1) expected."

### "Why is LFU sometimes worse than LRU?"

> "The **aging problem**. Frequencies only ever increase; they never forget. A key that was hammered in the past keeps a huge count forever, so it can never be the minimum — it squats a cache slot even after it goes completely cold, while currently-hot keys thrash in and out. Formally, pure non-decaying LFU has an *unbounded* competitive ratio: an adversary inflates one key's count, then loops a working set, and LFU's hit ratio degrades without bound versus the offline optimum. LRU adapts to shifting popularity within O(k) accesses. The cure is **decay** — periodically halving counts, or decaying by elapsed time on access — which turns 'least frequently used ever' into 'least frequently used recently.'"

### "When would you actually choose LFU?"

> "When the access distribution is **stable and skewed** — a small set of keys is reliably hot and stays hot. Under the Independent Reference Model with a fixed Zipfian distribution, exact LFU provably converges to caching the top-k most popular keys, the optimal contents. It is also **scan-resistant**: a one-time sequential scan creates freq-1 keys that get evicted first, protecting the hot set — exactly where LRU collapses. In practice I'd reach for a decaying or approximate LFU (or W-TinyLFU) rather than exact LFU, to keep the frequency benefit while fixing aging."

### "Design the eviction for a CDN edge cache."

> "Frequency matters more than recency at the edge because catalogs are heavily Zipfian and full of one-time tail requests. I'd use a frequency-aware policy with three additions: (1) **decay**, so a release that's hot this week fades next week; (2) **admission filtering** (TinyLFU-style) so singletons and crawler traffic don't displace the hot head; and (3) **size/cost weighting** — evict by `frequency × fetch_cost / size` (GreedyDual-Size-Frequency) so one giant cold video doesn't crowd out thousands of hot thumbnails, optimizing **byte** hit ratio, not just object hit ratio. W-TinyLFU plus size weighting is a strong concrete choice, validated by replaying real edge traces."

---

## Complexity & Policy Reference (for the whiteboard)

Memorize this grid — interviewers expect instant recall.

| Policy | get | put | evict | Space/entry | Scan-resistant | Adapts to shift |
|--------|-----|-----|-------|-------------|----------------|-----------------|
| Simple LFU (scan) | O(1) | O(n) on evict | O(n) | freq + value | Yes | No |
| **O(1) LFU (LC 460)** | **O(1)** | **O(1)** | **O(1)** | freq + DLL ptrs | Yes | No (aging) |
| Decaying LFU | O(1) | O(1) | O(1) | freq + time | Yes | Yes |
| Redis LFU | O(1) | O(1) | O(1) sampled | ~3 bytes | Yes | Yes |
| W-TinyLFU | O(1) | O(1) | O(1) | ~10 bits | Yes | Yes (adaptive) |
| LRU | O(1) | O(1) | O(1) | DLL ptrs | **No** | Yes |

> Note: all "O(1)" entries are **average/amortized** (the hash map's worst case is O(n) on pathological collisions; the linked-list and bucket work is always O(1)).

### Two-sentence policy pitches (for "compare X vs Y")

- **LFU vs LRU:** LFU evicts by *how often* a key is used and is scan-resistant and IRM-optimal on stable skewed loads, but suffers aging. LRU evicts by *how recently* a key is used and adapts to shifting popularity, but is flushed by sequential scans.
- **Exact LFU vs Redis LFU:** Exact LFU keeps a precise count and a freq-bucket structure (tens of bytes/key, no decay). Redis uses a ~1-byte logarithmic Morris counter with time-decay and sampled eviction — approximate ranking, tiny memory, no aging.
- **LFU vs W-TinyLFU:** Plain LFU evicts the global minimum and ages badly. W-TinyLFU uses a frequency *sketch* to gate admission plus a small LRU window, getting frequency-awareness, scan-resistance, and adaptivity at ~10 bits/entry — the best general-purpose policy.

---

## Quick-Reference Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| LFU policy | Evict the **lowest-count** key; ties → **least recently used** |
| New key freq | Starts at **1** |
| O(1) structures | keyMap + freqMap(freq→DLL) + `minFreq` |
| `minFreq` rule | Reset to 1 on insert; +1 when a promotion empties the min bucket |
| Tie-break | **Back** of the `minFreq` bucket (recency-ordered DLL) |
| Aging problem | Counts never decay → stale hot keys squat forever |
| Aging fix | Decay / windows / approximate (Morris) counters |
| Production LFU | Redis (Morris + decay + sampling), Caffeine (W-TinyLFU) |
| LeetCode | **460** (LFU), 146 (LRU) |

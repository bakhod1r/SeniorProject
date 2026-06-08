# LRU Cache — Interview Questions & Coding Challenge

## Table of Contents

1. [Tier 1: Fundamentals (Junior)](#tier-1-fundamentals-junior)
2. [Tier 2: Design and Trade-offs (Middle)](#tier-2-design-and-trade-offs-middle)
3. [Tier 3: Systems and Concurrency (Senior)](#tier-3-systems-and-concurrency-senior)
4. [Tier 4: Theory (Professional)](#tier-4-theory-professional)
5. [Coding Challenge: LeetCode 146 — LRU Cache](#coding-challenge-leetcode-146--lru-cache)
   - [Go](#go)
   - [Java](#java)
   - [Python](#python)
6. [Follow-up Variations](#follow-up-variations)
7. [Quick-Fire Questions](#quick-fire-questions)

---

## Tier 1: Fundamentals (Junior)

**Q1. What is an LRU cache?**
> A fixed-capacity key-value store that, when full, evicts the entry that was used (read or written) the longest time ago — the *least recently used* one. It supports `get` and `put` in O(1) average time.

**Q2. Which two data structures combine to make an O(1) LRU cache, and why each?**
> A **hash map** (key → node) for O(1) lookup by key, and a **doubly linked list** for O(1) tracking of use order (front = most recent, tail = least recent). The hash map cannot track order; a list alone cannot look up by key in O(1). Together they cover each other's weakness.

**Q3. Why a *doubly* linked list and not a singly linked one?**
> Removing a node requires rewiring its predecessor. A singly linked list does not store a back-pointer, so finding the predecessor takes O(n). A doubly linked list stores `prev`, making unlink O(1).

**Q4. Why does the hash map store a *node pointer* rather than the value directly?**
> So that, given a key, we can jump straight to its list node and unlink/move it in O(1). If the map stored only the value, we would have to scan the list O(n) to find the node to move.

**Q5. Does a `get` modify the cache?**
> Yes. A successful `get` counts as "using" the key, so the entry is promoted to most-recently-used (moved to the front). This is the subtle point most beginners miss.

**Q6. What are dummy head/tail (sentinel) nodes for?**
> They remove edge cases — empty list, inserting at the front, removing the last node. Real entries always live strictly between the two sentinels, so insert/remove code never special-cases null neighbors.

**Q7. Walk through `put` when the key is new and the cache is full.**
> Create a node, add it behind the dummy head, store `key → node` in the map. Size now exceeds capacity, so take the node just before the dummy tail (the LRU), unlink it, and delete its key from the map.

**Q8. What is the space complexity?**
> O(capacity): each entry costs a node (value + two pointers) plus a map entry.

**Q8b. Why store the key inside the node, not just the value?**
> When evicting the tail node, you must delete that key from the hash map. If the node did not store its own key, you could not know which map entry to remove. So each node carries `(key, value)`, not just `value`.

**Q8c. Walk through the pointer updates of "move to front."**
> First unlink: `node.prev.next = node.next; node.next.prev = node.prev`. Then insert behind head: `node.next = head.next; node.prev = head; head.next.prev = node; head.next = node`. Six pointer writes, all O(1), no traversal — possible because the node knows its own `prev`.

**Q9. When does the O(1) guarantee not hold?**
> Only in the hash map's adversarial worst case (many collisions → O(n)), mitigated by good/randomized hashing. The linked-list operations are always O(1).

**Q10. What does `get` return on a miss?**
> Conventionally `-1` in the LeetCode formulation (keys/values are non-negative integers). In a real API you would return an "absent" sentinel or `(value, found bool)`.

**Q10b. What goes wrong if you forget to delete the evicted key from the hash map?**
> The map keeps a dangling entry pointing at an unlinked node. The map's size grows unbounded, `contains`/`get` may return a stale node, and memory leaks. Always pair "unlink the tail node" with "delete its key from the map."

**Q10c. On `put` of an *existing* key, should you ever evict?**
> No. Updating a key that is already present does not increase the size, so no eviction is needed. Only a *new* key that pushes size over capacity triggers eviction. Checking capacity unconditionally is a common bug.

---

## Tier 2: Design and Trade-offs (Middle)

**Q11. Compare LRU, LFU, and FIFO.**
> FIFO evicts by *insertion* time (ignores usage, O(1), trivial). LRU evicts by *recency* of use (good for temporal locality, O(1)). LFU evicts by *frequency* of use (good for stable popularity, but needs counters and aging). FIFO can suffer Bélády's anomaly; LRU and LFU cannot.

**Q12. What workload makes LRU perform badly?**
> A large sequential scan (each item used once flushes the hot working set), and a cyclic access pattern just larger than the cache (`k+1` items looping through a `k`-slot cache → near-0% hit ratio, because LRU evicts exactly the next-needed item every time).

**Q13. How do real systems make LRU scan-resistant?**
> By distinguishing "seen once" from "seen many times": segmented/midpoint-insertion LRU (MySQL InnoDB's young/old sublists), 2Q, and ARC. New items enter a probationary segment; only a *second* access promotes them, so a one-pass scan never reaches the protected hot set.

**Q14. How do you implement LRU in Java without writing the list yourself?**
> `new LinkedHashMap<>(cap, 0.75f, true)` with `accessOrder = true`, overriding `removeEldestEntry` to return `size() > capacity`. `LinkedHashMap` already maintains a doubly linked list across entries; access order makes it LRU.

**Q15. And in Python?**
> `collections.OrderedDict` with `move_to_end(key)` on access and `popitem(last=False)` to evict the oldest. Or `functools.lru_cache` for memoizing a function.

**Q16. With `accessOrder=true`, why is iterating a `LinkedHashMap` while calling `get` dangerous?**
> Because `get` structurally modifies the map (it reorders the access list), so concurrent iteration throws `ConcurrentModificationException`. It also means the LRU is not safe for concurrent reads without external synchronization.

**Q17. Count-based vs size-based capacity?**
> Count-based caps the number of entries; size-based caps total bytes, giving each entry a *weight*. With size-based capacity, one `put` may evict *several* small entries to fit a large one. CDNs and byte-bounded caches use size-based (a "weigher").

**Q18. What is the single most important cache metric, and how is it defined?**
> The **hit ratio** = `hits / (hits + misses)`. It directly determines the effective latency, since every miss is a slow backend call.

**Q19. Why is LRU's read path the obstacle to thread-safety?**
> Because *every* operation — even `get` — mutates shared state (the move-to-front). There are no true read-only operations, so a read-write lock cannot let readers run freely; correctness requires exclusive access on the hot path.

**Q20. What is `functools.lru_cache` actually doing?**
> Memoizing a function: caching return values keyed by the call arguments, with LRU eviction once `maxsize` entries are stored. It exposes `cache_info()` (hits/misses/size) and `cache_clear()`.

**Q20b. Why might MRU (Most Recently Used) ever beat LRU?**
> For a single-pass scan over a large dataset, the item you *just* touched is the one you are *least* likely to touch again. MRU evicts it and keeps the older items, which a looping pattern is more likely to revisit. It is the right policy for specific scan/loop access patterns where recency is anti-correlated with reuse.

**Q20c. Is FIFO ever preferable to LRU?**
> When per-access bookkeeping must be zero (no move-to-front on reads), e.g., an extremely high-throughput path where touching the list on every read is too costly, or when accesses are roughly uniform so recency carries little signal. FIFO trades hit ratio for the cheapest possible read path. Beware Bélády's anomaly, though.

**Q20d. What is cache pollution and which policies suffer it?**
> Cache pollution is when low-value entries displace high-value ones. LRU suffers it under scans (one-time items evict the hot set). LFU suffers a different form: a once-popular item keeps a huge count and refuses to leave after going cold (fixed by aging the counts). Scan-resistant and adaptive policies (2Q, ARC, TinyLFU admission) are designed to resist pollution.

---

## Tier 3: Systems and Concurrency (Senior)

**Q21. How do you make a concurrent LRU scale beyond a single lock?**
> **Sharding (lock striping)**: split keys into `S` shards by `hash(key) % S`, each an independently locked LRU. Different shards run in parallel; the trade-off is that eviction is per-shard, so global LRU order is only approximated.

**Q22. Explain the CLOCK (second-chance) algorithm and why systems prefer it.**
> Items sit in a ring with a reference bit each. On access, set the bit (one cheap write, not a list move). To evict, a hand sweeps: if the bit is 0, evict; if 1, clear it (a "second chance") and advance. It approximates LRU but the read path is a single bit-set, which is far friendlier to concurrency and uses less memory — hence its use in Linux and PostgreSQL buffers.

**Q23. Does Redis maintain a true LRU list?**
> No — too expensive at scale. Redis uses **sampled approximate LRU**: on eviction it samples a few keys (`maxmemory-samples`, default 5) and evicts the one with the oldest access time. ~10 samples gets within ~1% of true LRU.

**Q24. How does MySQL InnoDB resist scans in its buffer pool?**
> Midpoint-insertion LRU: the list is split into *young* and *old* sublists. New pages enter the head of the *old* sublist; a page is promoted to *young* only if re-accessed after a delay (`innodb_old_blocks_time`). A scan fills only the old sublist and is evicted without disturbing the hot young set.

**Q25. How do TTL and LRU coexist in one cache?**
> They are orthogonal: TTL governs *freshness* (drop stale), LRU governs *capacity* (drop oldest when full). An entry can be removed for either reason. Expiration is usually lazy (check on read) plus active (background sweep / timing wheel) to reclaim memory from unread expired keys.

**Q26. What is a cache stampede and how do you prevent it?**
> When a hot key expires/evicts, many concurrent requests all miss and hammer the backend at once. Fixes: a per-key load lock, request coalescing / single-flight (Go's `singleflight`), probabilistic early expiration, and stale-while-revalidate.

**Q27. What does Caffeine do differently from a hand-rolled LRU?**
> It buffers reads into ring buffers (so the read path is near-lock-free), replays them asynchronously against the policy under one lock, and uses Window-TinyLFU admission to decide whether an item is even worth caching. Result: hit ratios at/above ARC with near-lock-free reads.

**Q28. In a sharded LRU, what correctness vs semantics distinction matters?**
> Sharding is *correct* (linearizable per key) but changes *semantics*: eviction is local to a shard, so the realized policy is per-shard LRU, not global LRU. A globally-LRU key can survive in a cold shard while a more-recent key is evicted from a hot shard.

**Q29. Why might a CDN not use plain LRU?**
> Objects vary hugely in size and miss cost. Pure LRU lets one giant rarely-used object evict thousands of small popular ones. CDNs use size/cost-aware policies (e.g., GDSF) and admission control (TinyLFU) so one-hit-wonders are never admitted.

**Q30. What is the miss-ratio curve and why is it useful?**
> A plot of miss ratio vs cache capacity — typically diminishing returns with a "knee." It tells you the smallest capacity that buys most of the benefit, making capacity planning data-driven. For LRU it is computable in a single pass (stack-distance histogram) because LRU is a stack algorithm.

**Q30b. How does Window-TinyLFU (Caffeine) improve on LRU?**
> It adds an *admission* filter: a compact frequency sketch (a count-min-sketch-based TinyLFU) decides whether a newly arriving item is even worth admitting over the current eviction victim. A small "window" LRU catches recency bursts, while the main region is governed by frequency. This blocks one-hit-wonders at the door, raising hit ratio above ARC while staying near-lock-free.

**Q30c. You see a cache with a 99% hit ratio but rising p99 latency. What might be wrong?**
> The 1% of misses may be expensive (slow backend, cold-start, stampede on a hot key). A high *average* hit ratio hides tail behavior. Investigate: miss cost distribution, stampede on expiry of a hot key (add single-flight), lock contention on the cache itself (shard it), or GC pressure from cache churn. Average hit ratio is necessary but not sufficient; instrument tail latency and eviction rate too.

**Q30d. How would you size a distributed cache layer in front of a database?**
> Estimate the working-set size from the miss-ratio curve (the knee), then size per node so the aggregate covers it with headroom. Route keys with consistent hashing (minimal remap on node changes), run a local LRU/LFU per node, set TTLs for freshness, and add stampede protection. Capacity is driven by the MRC and the acceptable backend QPS, not guesswork.

---

## Tier 4: Theory (Professional)

**Q31. Prove that `get` and `put` are O(1).**
> The linked-list work (unlink + add-to-front, or remove-tail) is a fixed number of pointer writes independent of `n`, so O(1) worst case — possible only because the doubly linked node carries its `prev` pointer, avoiding a predecessor search. The hash-map lookup/insert/delete is O(1) expected. Hence both operations are O(1) expected, O(capacity) space.

**Q32. What is the optimal offline replacement policy?**
> **Bélády's MIN**: on a fault, evict the page whose *next* use is farthest in the future. It provably minimizes faults but needs the future, so it is only a yardstick (`OPT`), not implementable online. LRU is its backward-looking heuristic.

**Q33. State and explain LRU's competitive ratio.**
> LRU is **k-competitive**: `cost_LRU(σ) ≤ k·OPT(σ) + k` for cache size `k` (Sleator–Tarjan). Proof via phases: each phase has ≤ k distinct pages so LRU faults ≤ k times, while OPT faults ≥ once per phase. And no deterministic online policy beats `k` (adversary requests, among `k+1` pages, the one not cached — every request faults). So `k` is tight.

**Q34. If `k` is the tight worst case, why is LRU great in practice?**
> The `k` lower bound needs an adversary tuned to the exact cache size. **Resource augmentation** shows LRU with size `k` versus OPT with size `h ≤ k` is `k/(k−h+1)`-competitive — a little extra cache makes LRU near-optimal. Real workloads also have locality (access-graph models give small constants), unlike the adversary.

**Q35. What is a stack algorithm and why does it matter for LRU?**
> A policy where the cached set at size `k` is always a subset of that at size `k+1` (inclusion property). LRU qualifies because the `k` most-recently-used pages are a subset of the `k+1` most-recently-used. Consequences: LRU is immune to **Bélády's anomaly** (more cache never causes more faults), and its full miss-ratio curve is computable in one pass (Mattson). FIFO is *not* a stack algorithm and *can* suffer the anomaly.

**Q36. How well does CLOCK approximate LRU, formally?**
> A 1-bit CLOCK is a *coarsened* LRU: it distinguishes "referenced since the last sweep" from "not," and always evicts from the latter class — so its recency resolution is one hand-revolution. Generalizing to `b`-bit counters (CLOCK-Pro, PostgreSQL's `usage_count`) increases resolution and converges toward LRU as `b` grows, trading a few percent hit ratio for a vastly cheaper, concurrency-friendly read path.

**Q37. What correctness property must a concurrent LRU satisfy, and why is a RWMutex insufficient?**
> **Linearizability**: each operation appears atomic at one instant consistent with the sequential spec. A RWMutex fails because `get` *writes* (move-to-front); two "readers" racing on the same node can drop it, cycle the list, or dangle a map pointer. Correctness needs the exclusive lock even for `get` — which is exactly why sharding or approximate/async policies are used instead.

**Q38. What is the best achievable competitive ratio with randomization?**
> The **MARKER** algorithm is `2H_k`-competitive (`H_k ≈ ln k`) against an oblivious adversary, an exponential improvement over deterministic `k`, and `H_k` is the proven randomized lower bound.

**Q39. Where does LRU sit in the eviction-policy design space?**
> At the pure-recency end. ARC and 2Q add frequency awareness and ghost entries to adapt between recency and frequency and resist scans; LFU is the pure-frequency end (with an O(1) construction). LRU is the simplest baseline these policies improve upon.

**Q40. Why is the read path mutating shared state the crux of concurrent caching?**
> Because it removes the easy win (free concurrent reads) and forces a choice: pay for exclusive locking, shrink the lock scope (shard), or stop reordering on every read (approximate/async policy as in CLOCK and Caffeine). Every production design is one of these answers to that single problem.

---

## Coding Challenge: LeetCode 146 — LRU Cache

**Problem.** Design a data structure for an LRU cache.

- `LRUCache(int capacity)` initializes the cache with positive `capacity`.
- `int get(int key)` returns the value if `key` exists, else `-1`. Marks the key most-recently-used.
- `void put(int key, int value)` updates or inserts. If inserting overflows capacity, evict the least recently used key first.

Both `get` and `put` must run in **O(1)** average time.

**Approach.** Hash map `key → node` for O(1) lookup, doubly linked list with dummy head/tail for O(1) recency reordering and eviction. Most recent behind head, least recent before tail.

**Time:** O(1) per operation | **Space:** O(capacity)

### Go

```go
package main

import "fmt"

type node struct {
	key, value int
	prev, next *node
}

type LRUCache struct {
	capacity int
	cache    map[int]*node
	head     *node // dummy head (most recent)
	tail     *node // dummy tail (least recent)
}

func Constructor(capacity int) LRUCache {
	head := &node{}
	tail := &node{}
	head.next = tail
	tail.prev = head
	return LRUCache{
		capacity: capacity,
		cache:    make(map[int]*node),
		head:     head,
		tail:     tail,
	}
}

func (c *LRUCache) removeNode(n *node) {
	n.prev.next = n.next
	n.next.prev = n.prev
}

func (c *LRUCache) addToFront(n *node) {
	n.next = c.head.next
	n.prev = c.head
	c.head.next.prev = n
	c.head.next = n
}

func (c *LRUCache) moveToFront(n *node) {
	c.removeNode(n)
	c.addToFront(n)
}

func (c *LRUCache) Get(key int) int {
	if n, ok := c.cache[key]; ok {
		c.moveToFront(n)
		return n.value
	}
	return -1
}

func (c *LRUCache) Put(key, value int) {
	if n, ok := c.cache[key]; ok {
		n.value = value
		c.moveToFront(n)
		return
	}
	newNode := &node{key: key, value: value}
	c.cache[key] = newNode
	c.addToFront(newNode)
	if len(c.cache) > c.capacity {
		lru := c.tail.prev
		c.removeNode(lru)
		delete(c.cache, lru.key)
	}
}

func main() {
	cache := Constructor(2)
	cache.Put(1, 1)
	cache.Put(2, 2)
	fmt.Println(cache.Get(1)) // 1
	cache.Put(3, 3)           // evicts key 2
	fmt.Println(cache.Get(2)) // -1
	cache.Put(4, 4)           // evicts key 1
	fmt.Println(cache.Get(1)) // -1
	fmt.Println(cache.Get(3)) // 3
	fmt.Println(cache.Get(4)) // 4
}
```

### Java

```java
import java.util.HashMap;

class LRUCache {

    private static class Node {
        int key, value;
        Node prev, next;
        Node(int key, int value) { this.key = key; this.value = value; }
        Node() { }
    }

    private final int capacity;
    private final HashMap<Integer, Node> cache;
    private final Node head; // dummy head (most recent)
    private final Node tail; // dummy tail (least recent)

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.cache = new HashMap<>();
        this.head = new Node();
        this.tail = new Node();
        head.next = tail;
        tail.prev = head;
    }

    private void removeNode(Node node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void addToFront(Node node) {
        node.next = head.next;
        node.prev = head;
        head.next.prev = node;
        head.next = node;
    }

    private void moveToFront(Node node) {
        removeNode(node);
        addToFront(node);
    }

    public int get(int key) {
        Node node = cache.get(key);
        if (node == null) return -1;
        moveToFront(node);
        return node.value;
    }

    public void put(int key, int value) {
        Node node = cache.get(key);
        if (node != null) {
            node.value = value;
            moveToFront(node);
            return;
        }
        Node newNode = new Node(key, value);
        cache.put(key, newNode);
        addToFront(newNode);
        if (cache.size() > capacity) {
            Node lru = tail.prev;
            removeNode(lru);
            cache.remove(lru.key);
        }
    }

    public static void main(String[] args) {
        LRUCache cache = new LRUCache(2);
        cache.put(1, 1);
        cache.put(2, 2);
        System.out.println(cache.get(1)); // 1
        cache.put(3, 3);                  // evicts key 2
        System.out.println(cache.get(2)); // -1
        cache.put(4, 4);                  // evicts key 1
        System.out.println(cache.get(1)); // -1
        System.out.println(cache.get(3)); // 3
        System.out.println(cache.get(4)); // 4
    }
}
```

### Python

```python
class Node:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key: int = 0, value: int = 0):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache: dict[int, Node] = {}
        self.head = Node()  # dummy head (most recent)
        self.tail = Node()  # dummy tail (least recent)
        self.head.next = self.tail
        self.tail.prev = self.head

    def _remove(self, node: Node) -> None:
        node.prev.next = node.next
        node.next.prev = node.prev

    def _add_to_front(self, node: Node) -> None:
        node.next = self.head.next
        node.prev = self.head
        self.head.next.prev = node
        self.head.next = node

    def _move_to_front(self, node: Node) -> None:
        self._remove(node)
        self._add_to_front(node)

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        node = self.cache[key]
        self._move_to_front(node)
        return node.value

    def put(self, key: int, value: int) -> None:
        if key in self.cache:
            node = self.cache[key]
            node.value = value
            self._move_to_front(node)
            return
        new_node = Node(key, value)
        self.cache[key] = new_node
        self._add_to_front(new_node)
        if len(self.cache) > self.capacity:
            lru = self.tail.prev
            self._remove(lru)
            del self.cache[lru.key]


# Test
cache = LRUCache(2)
cache.put(1, 1)
cache.put(2, 2)
print(cache.get(1))  # 1
cache.put(3, 3)      # evicts key 2
print(cache.get(2))  # -1
cache.put(4, 4)      # evicts key 1
print(cache.get(1))  # -1
print(cache.get(3))  # 3
print(cache.get(4))  # 4
```

---

## Follow-up Variations

Interviewers almost always push beyond the base problem. Be ready for:

| Follow-up | What changes |
|-----------|--------------|
| **Make it thread-safe** | Wrap with a mutex (simple), or shard by `hash(key) % S` for throughput. Explain that `get` mutates state so RWMutex is wrong. |
| **Add TTL / expiry** | Store an expiry timestamp per node; on `get`, treat expired as a miss; add a background sweeper. |
| **LFU instead of LRU** | Track frequency; an O(1) LFU needs a map of frequency → DLL plus a `minFreq` pointer (LeetCode 460). See `21-lfu-cache`. |
| **Make it scan-resistant** | Segment into probationary/protected; promote only on a second access (2Q idea). |
| **Generic keys/values** | Use generics/`interface{}`/`Object`; ensure keys are hashable and `equals`/`hashCode` correct. |
| **Size-based capacity** | Give each entry a weight; evict in a loop until total weight fits. |
| **Distributed across machines** | Consistent hashing to route keys to nodes; each node runs a local LRU. |
| **Return iterator in LRU order** | Walk the list head→tail; note it invalidates if a concurrent `get` reorders. |
| **Get with a default / loader** | On miss, run a loader function, insert the result, return it (a `LoadingCache`). |
| **Peek without promotion** | Read the map directly; do *not* move-to-front (a `contains`/`peek` must not change recency). |
| **Bulk get/put** | Iterate keys; for concurrency correctness, lock once around the batch or accept per-key atomicity. |

When a follow-up stumps you, narrate the *invariant* it threatens (the map↔node bijection, the recency order, the capacity bound) and propose the minimal change that preserves it. Interviewers grade the reasoning, not just the final code.

---

## Dry-Run the Interviewer Will Ask You to Trace

Be ready to narrate the structure step by step. Capacity 2, operations and resulting linked list (MRU → LRU):

```
put(1,1)       map {1}          list: [1]
put(2,2)       map {1,2}        list: [2, 1]
get(1) -> 1    (1 promoted)     list: [1, 2]
put(3,3)       overflow!        evict tail = 2; list: [3, 1]; map {1,3}
get(2) -> -1   (2 was evicted)  list: [3, 1]
put(4,4)       overflow!        evict tail = 1; list: [4, 3]; map {3,4}
get(1) -> -1   (1 was evicted)  list: [4, 3]
get(3) -> 3    (3 promoted)     list: [3, 4]
get(4) -> 4    (4 promoted)     list: [4, 3]
```

The two moments interviewers probe: (1) after `get(1)`, key 1 became MRU so key 2 sank to the tail — that is why `put(3)` evicted 2 and not 1; (2) `put(4)` then evicted 1 because by that point 1 was the tail. If you can narrate *why* each eviction picks that specific key, you have demonstrated mastery of the recency ordering.

**A trap follow-up:** "What if `get` did *not* promote?" Then after `get(1)`, key 1 stays at the tail, so `put(3)` would evict key 1 instead of key 2 — different output. This shows the interviewer you understand that `get` is a mutating operation.

---

## Quick-Fire Questions

| # | Question | Expected Answer |
|---|----------|-----------------|
| 1 | Time complexity of `get`? | O(1) average |
| 2 | Two structures in an LRU cache? | Hash map + doubly linked list |
| 3 | Why doubly (not singly) linked? | O(1) unlink needs a back-pointer |
| 4 | Does `get` modify the cache? | Yes — promotes the key to most-recent |
| 5 | Where is the LRU entry? | Just before the dummy tail |
| 6 | What do sentinels eliminate? | Empty-list / boundary edge cases |
| 7 | Java one-liner LRU class? | `LinkedHashMap` with `accessOrder=true` + `removeEldestEntry` |
| 8 | Python ordered structure for LRU? | `collections.OrderedDict` |
| 9 | Memoization decorator in Python? | `functools.lru_cache` |
| 10 | LRU's competitive ratio? | k-competitive (tight for deterministic) |
| 11 | Optimal offline policy? | Bélády's MIN (evict farthest-future) |
| 12 | Is LRU immune to Bélády's anomaly? | Yes — it is a stack algorithm |
| 13 | Which policy *can* show the anomaly? | FIFO |
| 14 | CLOCK's per-access cost? | Set one reference bit |
| 15 | Does Redis keep a true LRU list? | No — sampled approximate LRU |
| 16 | Scan-resistant LRU example? | InnoDB midpoint-insertion / 2Q / ARC |
| 17 | Headline cache metric? | Hit ratio |
| 18 | Concurrent LRU scaling trick? | Sharding (lock striping) |
| 19 | Why can't a RWMutex help reads? | `get` writes (move-to-front) |
| 20 | LeetCode number for LRU? | 146 (LFU is 460) |
| 21 | Space complexity? | O(capacity) |
| 22 | What is the working set? | distinct pages referenced in a recent window |
| 23 | Why does the MRC have a "knee"? | where capacity crosses the working-set size |
| 24 | Caffeine's admission policy? | Window-TinyLFU |
| 25 | Redis default LRU samples? | 5 (`maxmemory-samples`) |
| 26 | ZFS's cache policy? | ARC |
| 27 | InnoDB's scan-resistance trick? | midpoint (young/old) insertion |
| 28 | PostgreSQL buffer eviction? | CLOCK-sweep with `usage_count` |
| 29 | What does `removeEldestEntry` return for LRU? | `size() > capacity` |
| 30 | Stampede mitigation in Go stdlib-adjacent? | `singleflight` |
| 31 | LRU-1 is equivalent to? | classic LRU |
| 32 | Which generalizes LRU to costs? | Landlord / Greedy-Dual |
| 33 | Best randomized competitive ratio? | `H_k ≈ ln k` |
| 34 | Is FIFO a stack algorithm? | No |
| 35 | Two reasons real systems avoid strict LRU? | concurrency cost + scan flooding |

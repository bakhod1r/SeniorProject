# Map / Dictionary — Interview Preparation

## Junior Questions (15)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a Map / Dictionary? | Abstract data type mapping keys to values; partial function K -> V |
| 2 | How is a Map different from a Hash Table? | Map is the ADT (interface); hash table is one implementation |
| 3 | What are the core Map operations and their Big-O for a HashMap? | get/put/remove O(1) avg; iteration O(n) |
| 4 | What's the difference between "key absent" and "key present with null value"? | Membership test differs; Java HashMap is ambiguous on null get; Go has comma-ok; Python distinguishes via `in` |
| 5 | When does HashMap degrade to O(n)? | All keys hash to one bucket (bad hash or adversarial input) |
| 6 | What is the load factor and why does it matter? | n / capacity; controls when resize triggers; affects collision rate |
| 7 | Name three built-in Map types in Java. | HashMap, TreeMap, LinkedHashMap (also ConcurrentHashMap) |
| 8 | How does Go's map iteration order differ from Python's dict? | Go randomizes intentionally; Python 3.7+ guarantees insertion order |
| 9 | What types can be keys in a Go map? | Comparable types: bool, numeric, string, pointer, channel, interface, struct/array of comparable. NOT slices, maps, functions |
| 10 | Why must `equals` and `hashCode` be consistent in Java? | If equals returns true but hashCode differs, lookup fails (different bucket) |
| 11 | What is `getOrDefault` and why use it over `get` + `containsKey`? | One operation; cleaner; atomic; avoids double lookup |
| 12 | Show how to count word frequencies in Python. | `Counter` or `defaultdict(int)` with `freq[w] += 1` |
| 13 | What goes wrong if you mutate a key after insertion? | Hash/equality changes; entry becomes unreachable |
| 14 | Why does `HashMap<Integer, Integer>` need capacity sizing? | Avoid resize cost; pass expected size to constructor |
| 15 | Give two real-world uses of a Map. | Phone book, word counter, cache, dispatch table, env vars |

---

## Middle Questions (15)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | When would you choose TreeMap over HashMap? | Need sorted iteration; range queries (floorKey/ceilingKey/subMap) |
| 2 | When would you choose LinkedHashMap over HashMap? | Need insertion order; building LRU (accessOrder=true) |
| 3 | Explain `computeIfAbsent`. When is it dangerous? | Atomic lazy init; danger: lambda that modifies the same map -> ConcurrentModificationException |
| 4 | How is a multimap implemented? | Map<K, List<V>> or Map<K, Set<V>>; use Guava Multimap or computeIfAbsent |
| 5 | Show how to implement a Set using a Map. | Map<K, ()> / Map<K, true> / Map<K, Boolean>; Set = Map<K, Unit> |
| 6 | How is a Counter / Multiset a Map? | Map<K, Integer>; add = merge with sum; remove = decrement, delete at 0 |
| 7 | Walk through implementing an LRU cache. | LinkedHashMap with accessOrder=true and removeEldestEntry; or hash map + doubly-linked list |
| 8 | What is hash flooding and how do languages defend? | Adversarial input collides into one bucket; defense: SipHash, random seed, treeification |
| 9 | What does `merge(k, v, BiFunction)` do? | If absent put v; else apply combiner; atomic in ConcurrentHashMap |
| 10 | Why is `dict[key]` faster than `dict.get(key)` in Python? | One bytecode (BINARY_SUBSCR) vs method call overhead; but `.get` returns None safely |
| 11 | What is the order Python dicts iterate in (3.7+)? | Insertion order, by language spec |
| 12 | How would you implement a bidirectional map (BiMap)? | Two HashMaps maintained atomically; or single map with paired structure |
| 13 | Compare `putIfAbsent` and `computeIfAbsent`. | `putIfAbsent`: eager value; `computeIfAbsent`: lazy via supplier; lazy avoids unused allocations |
| 14 | What goes wrong iterating a HashMap while mutating it? | Java throws ConcurrentModificationException; Go: undefined; Python may skip/repeat |
| 15 | When is `TreeMap.floorKey(k)` useful? | Time-series snapshots; rate-card lookups; range bucketing |

---

## Senior Questions (12)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Design a distributed key-value store API. | Sharding key, replication factor, consistency level, hot-key strategy |
| 2 | How does Java's `ConcurrentHashMap` achieve concurrency? | CAS for reads/empty-bucket inserts; per-bucket synchronized for writes; treeification for long chains; parallel resize |
| 3 | Compare Go's `sync.Map` to `sync.RWMutex + map`. | sync.Map for read-heavy stable keys; RWMutex for mixed; lock striping for write-heavy |
| 4 | What is a hot key and how do you mitigate? | One shard saturated; mitigations: local cache, replicate key, shard the value, dedicated node, request coalescing |
| 5 | How does Redis HASH differ from many Redis keys? | One HASH = O(1) lookups within a key; saves memory via listpack encoding for small HASHes; one HASH lives on one Redis Cluster node |
| 6 | Explain consistent hashing and its trade-offs. | Ring of virtual nodes; K/N keys move on rebalance; vs naive hash (all keys move); needs replication for fault tolerance |
| 7 | When would you use a CRDT Map? | Multi-master replication without coordination; eventual convergence; trade off: metadata overhead, weaker semantics |
| 8 | What metrics do you watch for a production HashMap (in-process)? | Size, load factor, collision rate, p99 latency, chain length p99, rehash frequency |
| 9 | How would you detect a hot key in production? | Top-K heavy hitters via Count-Min Sketch at proxy; per-key counters with sampling |
| 10 | How does Cassandra model data as nested Maps? | table = Map<partition, Map<clustering, row>>; outer shards, inner is sorted on one node |
| 11 | What's the difference between linearizable, sequentially consistent, and eventually consistent Maps? | Real-time vs program-order vs eventual convergence; latency cost increases left to right |
| 12 | Explain incremental rehashing in Redis. | Two hash tables ht[0]/ht[1]; resize moves a few entries per op; reads check both; avoids stop-the-world stalls |

---

## Professional Questions (8)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove the amortized cost of HashMap put is O(1) with doubling resize. | Aggregate or potential method; total resize cost geometric series = O(n); divide by n |
| 2 | What's the cell-probe lower bound for the dictionary problem? | Omega(log n / log lg n) per op; no deterministic worst-case O(1) |
| 3 | What is universal hashing and what does it buy you? | Family H with Pr[h(x)=h(y)] <= 1/m; expected O(1) regardless of input distribution |
| 4 | Describe HAMT and when you'd use it. | Hash array mapped trie; persistent immutable; O(log_{32} n) ~ O(1); lock-free readers, cheap snapshots |
| 5 | What is cuckoo hashing? | Two hash functions; each key in one of two slots; lookup O(1) worst-case; insertion may displace |
| 6 | What is the consensus number of CAS and why does it matter for concurrent maps? | Infinity; needed for wait-free implementations of arbitrary objects |
| 7 | Explain Swiss table SIMD lookup. | Control byte array stores hash tag; SSE/SIMD scans 16 tags in one compare; lookup ~2 cache lines |
| 8 | Why does shrinking on every removal cause O(n) per op for alternating insert/delete? | Adversary straddles threshold; fix: shrink only at alpha < alpha*/4 to amortize |

---

## Coding Challenge — In-Memory Key-Value Store with TTL

> Implement a Map-like structure that supports `put(k, v, ttlMs)`, `get(k)`, and automatic expiry. Operations should be O(1) average; expired keys must not be returned. Lazy expiry (on access) is acceptable; bonus for active eviction.

### Go

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type entry struct {
	value    any
	expireAt time.Time
}

type TTLMap struct {
	mu sync.RWMutex
	m  map[string]entry
}

func NewTTLMap() *TTLMap {
	return &TTLMap{m: make(map[string]entry)}
}

// Put stores k=v with the given TTL. ttl <= 0 means no expiry.
func (t *TTLMap) Put(k string, v any, ttl time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	exp := time.Time{}
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	t.m[k] = entry{value: v, expireAt: exp}
}

// Get returns the value and true if present and not expired.
func (t *TTLMap) Get(k string) (any, bool) {
	t.mu.RLock()
	e, ok := t.m[k]
	t.mu.RUnlock()
	if !ok {
		return nil, false
	}
	if !e.expireAt.IsZero() && time.Now().After(e.expireAt) {
		// Lazy expiry: clean up on read.
		t.mu.Lock()
		delete(t.m, k)
		t.mu.Unlock()
		return nil, false
	}
	return e.value, true
}

func (t *TTLMap) Delete(k string) {
	t.mu.Lock()
	delete(t.m, k)
	t.mu.Unlock()
}

func main() {
	m := NewTTLMap()
	m.Put("a", 1, 50*time.Millisecond)
	m.Put("b", 2, 0)

	if v, ok := m.Get("a"); ok {
		fmt.Println("a:", v) // a: 1
	}
	time.Sleep(60 * time.Millisecond)
	if _, ok := m.Get("a"); !ok {
		fmt.Println("a expired")
	}
	if v, ok := m.Get("b"); ok {
		fmt.Println("b:", v) // b: 2
	}
}
```

### Java

```java
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class TTLMap<K, V> {
    private static class Entry<V> {
        final V value;
        final long expireAtMs;   // 0 = no expiry

        Entry(V value, long expireAtMs) {
            this.value = value;
            this.expireAtMs = expireAtMs;
        }
    }

    private final Map<K, Entry<V>> map = new HashMap<>();
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    /** Puts k=v with ttlMs millisecond lifetime. ttlMs <= 0 means no expiry. */
    public void put(K k, V v, long ttlMs) {
        long exp = ttlMs > 0 ? System.currentTimeMillis() + ttlMs : 0L;
        lock.writeLock().lock();
        try {
            map.put(k, new Entry<>(v, exp));
        } finally {
            lock.writeLock().unlock();
        }
    }

    /** Returns the value, or null if absent or expired. */
    public V get(K k) {
        Entry<V> e;
        lock.readLock().lock();
        try {
            e = map.get(k);
        } finally {
            lock.readLock().unlock();
        }
        if (e == null) return null;
        if (e.expireAtMs > 0 && System.currentTimeMillis() > e.expireAtMs) {
            lock.writeLock().lock();
            try { map.remove(k); } finally { lock.writeLock().unlock(); }
            return null;
        }
        return e.value;
    }

    public void delete(K k) {
        lock.writeLock().lock();
        try { map.remove(k); } finally { lock.writeLock().unlock(); }
    }

    public static void main(String[] args) throws InterruptedException {
        TTLMap<String, Integer> m = new TTLMap<>();
        m.put("a", 1, 50);
        m.put("b", 2, 0);
        System.out.println("a: " + m.get("a"));   // a: 1
        Thread.sleep(60);
        System.out.println("a after expiry: " + m.get("a")); // null
        System.out.println("b: " + m.get("b"));   // b: 2
    }
}
```

### Python

```python
import threading
import time


class TTLMap:
    """In-memory key-value store with per-key TTL and lazy expiry."""

    def __init__(self):
        self._lock = threading.RLock()
        self._m: dict[str, tuple[object, float]] = {}  # key -> (value, expire_at)

    def put(self, k, v, ttl_ms=0):
        """Store k=v with ttl_ms ms lifetime. ttl_ms <= 0 means no expiry."""
        exp = time.monotonic() + ttl_ms / 1000.0 if ttl_ms > 0 else 0.0
        with self._lock:
            self._m[k] = (v, exp)

    def get(self, k):
        """Return value, or None if absent or expired."""
        with self._lock:
            entry = self._m.get(k)
            if entry is None:
                return None
            value, exp = entry
            if exp and time.monotonic() > exp:
                del self._m[k]
                return None
            return value

    def delete(self, k):
        with self._lock:
            self._m.pop(k, None)


if __name__ == "__main__":
    m = TTLMap()
    m.put("a", 1, ttl_ms=50)
    m.put("b", 2)
    print("a:", m.get("a"))     # a: 1
    time.sleep(0.06)
    print("a after expiry:", m.get("a"))   # None
    print("b:", m.get("b"))     # b: 2
```

### Discussion points the interviewer expects

- **Lazy vs active eviction.** Lazy is simple; active needs a background scanner. Real systems use both.
- **Locking strategy.** RWMutex / ReadWriteLock for read-heavy; lock striping for high throughput.
- **Clock source.** Use a **monotonic clock** for expiry — wall clock can jump backwards (NTP) and cause early/late expiry.
- **Approximate expiry.** Most production stores (Redis, Memcached) expire approximately, not exactly. Asking "is exact required?" earns points.
- **Bounded size.** Without bounds, the map grows forever — combine TTL with LRU eviction. See `21-advanced-structures/lru-cache`.
- **Concurrency under contention.** ConcurrentHashMap / sync.Map / lock striping reduces contention for many-thread scenarios.

### Follow-up: convert to LRU cache with capacity N

Replace the inner map with `LinkedHashMap<K, Entry<V>>(N, 0.75f, true)` in Java (override `removeEldestEntry`); use `collections.OrderedDict` with `move_to_end` in Python; for Go, combine `map[K]*list.Element` with `container/list`. See `21-advanced-structures/lru-cache` for the full pattern.

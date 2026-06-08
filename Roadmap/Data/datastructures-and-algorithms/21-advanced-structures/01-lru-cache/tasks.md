# LRU Cache — Tasks & Exercises

Work through these in order. The beginner tasks build the core structure; the intermediate tasks add real-world features and policy variations; the advanced tasks push into concurrency, theory, and production concerns. For each task, write tests before you call it done.

---

## Beginner

### Task 1: Build the Core LRU Cache

Implement an LRU cache from scratch (no `LinkedHashMap`, `OrderedDict`, or library) supporting:
- `LRUCache(capacity)`
- `get(key) -> value or -1`
- `put(key, value)`

**Requirements:**
- Hash map + doubly linked list with dummy head/tail.
- Both operations O(1).
- `get` must promote the key to most-recently-used.

**Test cases:**
```
cap = 2
put(1,1); put(2,2)
get(1) -> 1
put(3,3)            // evicts key 2
get(2) -> -1
put(4,4)            // evicts key 1
get(1) -> -1
get(3) -> 3
get(4) -> 4
```

---

### Task 2: Trace the List by Hand, Then Verify

Without running code, write down the state of the linked list (most-recent → least-recent) after **each** of these operations on a capacity-3 cache:

```
put(A,1) put(B,2) put(C,3) get(A) put(D,4) get(B) put(E,5)
```

Identify which keys get evicted and when. Then add a debug method `snapshot()` to your Task 1 cache that returns the keys in most-recent-to-least-recent order, and confirm your hand trace matches the program output. **Expected final state:** the cache contains exactly `{E, B, D}` (A and C were evicted).

---

### Task 3: `containsKey` and `size` Without Promotion

Add two methods to your cache:
- `contains(key) -> bool`: report whether the key is present **without** changing its recency (a peek must not count as a use).
- `size() -> int`: the current number of entries.

**Why it is tricky:** the obvious implementation calls `get`, which *does* promote. You must check the hash map directly and not touch the list. Write a test proving that 10 `contains` calls on a key do not save it from eviction.

---

### Task 4: LRU via the Standard Library

Reimplement the cache using your language's built-in helper, and confirm identical behavior to Task 1 on the same test sequence:
- **Java:** `LinkedHashMap(16, 0.75f, true)` + `removeEldestEntry`.
- **Python:** `collections.OrderedDict` with `move_to_end` and `popitem(last=False)`.
- **Go:** `container/list` + a `map` (Go has no built-in LRU).

Write a short note comparing lines of code and clarity versus the hand-rolled version.

---

### Task 5: Eviction Callback

Extend the cache with an optional `onEvict(key, value)` callback invoked exactly once whenever an entry is removed due to capacity overflow (not on `put`-update of an existing key). Use it to count total evictions and to print each evicted pair. Verify the callback fires for the *correct* (least-recently-used) key in the Task 1 sequence.

---

## Intermediate

### Task 6: LRU Cache with TTL

Add per-entry time-to-live. `put(key, value, ttl_seconds)` stores an expiry. Rules:
- On `get`, if `now > expiry`, treat it as a miss and remove the entry (lazy expiration).
- Add `purge_expired()` that actively removes all expired entries.
- Capacity eviction (LRU) and TTL eviction must coexist correctly.

**Test:** insert a key with a 1-second TTL, sleep past it, and confirm `get` returns "miss" *and* the entry is gone from the internal map.

---

### Task 7: Size-Weighted (Byte-Bounded) Cache

Change the capacity from "max entries" to "max total weight." `put(key, value, weight)`; the cache evicts LRU entries in a **loop** until total weight ≤ capacity. A single large `put` may evict several small entries; reject (or document behavior for) a single item heavier than the whole capacity.

**Test:** capacity 100; insert items of weight 40, 40, 40 — the third insert should evict the first (total 120 → evict until ≤ 100). Verify which keys survive.

---

### Task 8: Hit-Ratio Instrumentation and a Workload Generator

Add counters for hits, misses, and evictions, plus `hitRatio()`. Then write a workload generator that simulates two patterns and reports the hit ratio for each at capacities `{8, 16, 32, 64, 128}`:
1. **Zipfian** access (a few hot keys dominate) — LRU should do well.
2. **Sequential scan** of `4 * capacity` distinct keys — LRU should do poorly.

Plot or print the resulting **miss-ratio curve** and explain the difference. This makes LRU's scan weakness concrete and measurable.

---

### Task 9: Segmented (Scan-Resistant) LRU

Implement a two-segment LRU (the 2Q / InnoDB idea):
- A **probationary** segment receives every newly inserted key.
- A key is promoted to a **protected** segment only on its **second** access.
- Eviction prefers the probationary segment.

Run the Task 8 sequential-scan workload against both your plain LRU (Task 1) and this segmented LRU, and show the segmented version preserves a hot working set that the plain LRU flushes. Report both hit ratios.

---

### Task 10: Thread-Safe LRU (Single Lock) with a Stress Test

Wrap your cache so all operations are safe under concurrent access using a single mutex. Then write a stress test: spawn `N` threads/goroutines each doing thousands of random `get`/`put` on a shared cache, and verify:
- No panics, deadlocks, or data races (run with the race/thread sanitizer — `go test -race`, Java `-ea` + a concurrency test, Python `threading`).
- The cache size never exceeds capacity.
- Invariants hold afterward (every map key has a live node; list has no cycles).

Explain why even `get` must take the exclusive lock.

---

## Advanced

### Task 11: Sharded Concurrent LRU and Throughput Benchmark

Build a sharded LRU: `S` independent shards (each a Task 10 single-lock LRU), routing by `hash(key) % S`. Benchmark throughput (ops/sec) of the single-lock cache vs the sharded cache for `S ∈ {1, 2, 4, 8, 16}` under a high-contention multi-threaded workload. Report the scaling curve and discuss:
- Where throughput stops improving and why (contention, memory bandwidth, skew).
- How per-shard eviction makes the global policy only *approximately* LRU — construct a key sequence where the sharded cache evicts a different victim than a global LRU would.

---

### Task 12: CLOCK (Second-Chance) Cache and Hit-Ratio Comparison

Implement a CLOCK cache: a circular array of slots with a reference bit each and a sweeping hand (set bit on access; on eviction, clear set bits and evict the first unset). Then:
- Compare its hit ratio against strict LRU (Task 1) on the Zipfian and scan workloads from Task 8.
- Extend to a **generalized CLOCK** with a small `usage_count` (e.g., 2 bits) and show its hit ratio moves closer to strict LRU.
- Discuss why CLOCK's read path (a bit set) is more concurrency-friendly than LRU's move-to-front.

---

### Task 13: LFU and ARC Comparison Harness

Implement an O(1) LFU cache (LeetCode 460: a `freq -> doubly-linked-list` map plus a `minFreq` pointer; cross-reference `21-lfu-cache`) and, optionally, a simplified ARC (cross-reference `22-arc-2q-cache`). Build a harness that replays the **same** trace through LRU, LFU, and ARC and reports each policy's hit ratio. Use at least three traces:
1. Stable-popularity (LFU should win).
2. Recency-dominated bursts (LRU should win).
3. Scan + hot set (ARC should win).

Summarize which policy wins on which pattern and why — this is the empirical version of the policy comparison from the senior/professional levels.

---

### Task 14: Empirically Verify the Stack Property and the Single-Pass MRC

LRU is a *stack algorithm*: its cached set at size `k` is a subset of its set at size `k+1`. Verify this two ways:
1. **Inclusion check:** run LRU at sizes `k` and `k+1` over the same trace and assert at every step that `cached_k ⊆ cached_{k+1}`.
2. **Single-pass MRC:** implement Mattson's **stack-distance** computation — for each request, find its depth in the LRU stack (distinct accesses since its last use) and build a histogram. From the histogram derive the hit ratio at *every* capacity in one pass, and confirm it matches running separate LRU simulations per capacity.

Also demonstrate **Bélády's anomaly** with FIFO (find a trace where more cache → more faults) and confirm LRU never exhibits it.

---

### Task 15: Benchmark Against Bélády's MIN (the Offline Optimum)

Implement Bélády's MIN offline policy: given the full trace in advance, on each fault evict the resident page whose *next* use is farthest in the future. Then, over several realistic traces, compute the fault count of LRU and of MIN at a fixed capacity and report:
- The ratio `faults_LRU / faults_MIN` for each trace.
- How that empirical ratio compares to the theoretical `k`-competitive worst case (it should be *much* better on real, locality-bearing traces).
- The effect of **resource augmentation**: give LRU `1.5×` the capacity of MIN and show the gap nearly closes, matching the `k/(k-h+1)` theory.

Write up the results as a short experiment report connecting the measurements to the competitive-analysis theory in `professional.md`.

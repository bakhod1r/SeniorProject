# Space-Saving Algorithm — Interview Preparation

Space-Saving is a favourite interview topic because it rewards one crisp insight — *"keep `m` counters; on a miss when full, replace the smallest-count item, start the newcomer at `min + 1`, and record `min` as its over-estimate error"* — and then tests whether you can (a) explain the over-estimate bound `count(x) - f(x) ≤ min ≤ n/m`, (b) state the heavy-hitter guarantee (everything above `n/m` is kept), (c) describe the **Stream-Summary** for `O(1)` updates, and (d) compare it with Misra-Gries, Count-Min Sketch, and Lossy Counting. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer |
|----------|--------|
| What does it find? | top-k frequent items (heavy hitters) in a stream |
| Memory | `O(m)` counters, independent of stream length / distinct items |
| Per item time | `O(1)` with the Stream-Summary |
| Miss when full | evict the **min**, new count = `min + 1`, error = `min` |
| Error direction | **over-estimate** only (`count ≥ f`) |
| Error bound | `count(x) - f(x) ≤ error(x) ≤ min ≤ n/m` |
| Heavy-hitter guarantee | every item with `f > n/m` is kept (no false negatives) |
| Guaranteed HH filter | report `count - error > threshold` |
| Deterministic? | yes (no randomness in the core) |
| vs Misra-Gries | over- vs under-estimate; SS touches 1 counter, MG decrements all → SS better for top-k |
| vs Count-Min | SS names items; CM does point queries but cannot name the frequent ones |

The update rule (the heart of everything):

```text
add(item):
    if item tracked:        count[item] += 1
    elif free slot:         count[item] = 1;       error[item] = 0
    else:                   victim = argmin(count)  # the min slot
                            min = count[victim]
                            remove victim
                            count[item] = min + 1;  error[item] = min
# top-k = items with the largest counts
# guarantee: every item with f > n/m survives
```

Key facts:
- **Counts over-estimate; `[count - error, count]` brackets the truth.**
- **The newcomer inherits `min + 1`, not `1`** — this preserves the conservation invariant `Σ count = n`.
- **Stream-Summary** (buckets of equal-count items in a sorted doubly linked list) gives `O(1)` because counts change by exactly `+1` (adjacent bucket).
- **Skew (Zipfian) is the ally** — heavy hitters climb out of the eviction zone; small `m` suffices.

---

## Junior Questions (13 Q&A)

### J1. What problem does Space-Saving solve?
Finding the most frequent items (top-k / heavy hitters) in a huge or endless stream using only a small, fixed amount of memory — when you cannot store a counter for every distinct item.

### J2. What is the basic data structure?
A table of at most `m` counters, each a pair `(item, count)` (plus an `error` field). The `m` is your fixed memory budget chosen up front.

### J3. What happens when an item that is already tracked arrives?
You increment its counter by 1. Nothing else changes (its error stays the same).

### J4. What happens when a new item arrives and there is a free slot?
You create a counter for it starting at `1`, with error `0`.

### J5. What happens when a new item arrives and the table is full?
You find the slot with the **smallest count** (`min`), evict that item, and put the new item in its place with count `min + 1` and error `min`.

### J6. Why does the new item start at `min + 1` instead of `1`?
Because it inherits the slot's existing weight. Starting at `min + 1` keeps the invariant that all counts sum to the number of items seen, which is what makes the guarantees provable. Starting at `1` would break the algorithm.

### J7. What is the "error" field?
The over-count recorded for an item: the value of `min` when it was inserted. The true frequency lies in `[count - error, count]`.

### J8. Does Space-Saving ever under-count?
No. It only ever over-estimates: `count(x) ≥ f(x)` always. The error is one-sided.

### J9. How do you get the top-k at the end?
Sort the `m` stored counters by count and take the top `k` items.

### J10. How much memory does it use?
`O(m)` — fixed, regardless of how many distinct items the stream has or how long it runs.

### J11. Which items are guaranteed to be in the final table?
Every item whose true frequency exceeds `n/m` (where `n` is the stream length). Frequent items are never missed.

### J12. Trace `m=2` on the stream `A A B C`.
`A`→`A:1`; `A`→`A:2`; `B`→`B:1` (free slot); `C`→ full, min is `B:1`, evict `B`, insert `C:2 (err 1)`. Final: `A:2 (err 0)`, `C:2 (err 1)`.

### J13 (analysis). Why can the count be larger than the true frequency?
Because a newcomer inherits the evicted item's `min` count — credit for arrivals it did not cause. That borrowed credit is exactly the `error`, which bounds the over-count.

---

## Middle Questions (13 Q&A)

### M1. State and prove the over-estimate bound.
`count(x) - f(x) ≤ error(x) ≤ min ≤ n/m`. Since the `m` counters always sum to `n` (each arrival adds exactly `+1`), the minimum is at most the average `n/m`; a newcomer's error equals the min it inherited, and only real arrivals increment afterward, so the over-count never exceeds that min.

### M2. Why does `Σ count = n` always hold?
Every arrival increments exactly one counter by exactly one: a hit adds `1`; an eviction sets the new count to `min + 1`, which is `+1` over the `min` the slot already held (the evicted item's count is transferred). So the total grows by `1` per item.

### M3. Prove the heavy-hitter guarantee.
If `f(x) > n/m` but `x` were absent at the end, it must have been evicted while being the minimum. But the minimum is always `≤ n/m`, and the count over-estimates the true frequency, so `x` could have appeared at most `n/m` times — contradicting `f(x) > n/m`. Hence `x` is never evicted permanently.

### M4. What is the Stream-Summary and why is it `O(1)`?
Items sharing a count are grouped into a bucket; buckets sit in a doubly linked list sorted by count ascending. The min is the head bucket (`O(1)`). On an increment, the count goes from `c` to `c + 1` — always the *adjacent* bucket — so no search/heap is needed, giving `O(1)`.

### M5. Why not just use a min-heap?
A heap gives the min in `O(1)` but updates in `O(log m)`. The Stream-Summary exploits that counts change by exactly `+1`, so the target bucket is adjacent — no `log m` sift. That is the key cleverness.

### M6. How do you choose `m`?
To catch all items above a fraction `φ` of the stream, use `m ≥ 1/φ` (guarantee). For accurate counts and ordering, over-provision (e.g. `m ≈ 6/φ` to `10/φ`).

### M7. Can Space-Saving report a non-frequent item (false positive)?
Yes — a slot may hold an item whose true frequency is below `n/m`, inflated by inherited error. Filter false positives by requiring the lower bound `count - error > threshold`, which is a guaranteed heavy hitter.

### M8. Compare Space-Saving and Misra-Gries.
Both use `m` counters and guarantee the `n/m` bound. Misra-Gries **decrements all counters** on a miss (under-estimate); Space-Saving **evicts only the min** (over-estimate). On skewed data Misra-Gries bleeds count from heavy hitters every decrement, so Space-Saving is more accurate for top-k.

### M9. Compare Space-Saving and Count-Min Sketch.
Count-Min is a hashing sketch that answers point queries for *any* item but stores no item identities — you need a separate heap to name the frequent ones. Space-Saving stores the items intrinsically, so its table *is* the candidate set. Count-Min is randomized; Space-Saving is deterministic.

### M10. Compare Space-Saving and Lossy Counting.
Lossy Counting keeps `(item, count, error)` entries and periodically prunes those below a window-based bucket boundary, giving an under-estimate with error `≤ εn`. Space-Saving keeps exactly `m` counters at all times with an over-estimate. Both name items; Space-Saving has fixed memory, Lossy Counting's grows with `(1/ε)log(εn)`.

### M11. Why is Space-Saving in the "randomized algorithms" section if it is deterministic?
It belongs to the streaming/sketch family studied alongside randomized sketches (Count-Min, etc.) and is the deterministic representative for top-k heavy hitters. The output is fully reproducible for the same input.

### M12. What is the `[count - error, count]` bracket used for?
It is the confidence interval for an item's true frequency. Width `≤ min ≤ n/m`. An item with `error = 0` has an exact count.

### M13 (analysis). On what data does Space-Saving perform poorly, and why?
Uniform data with no heavy hitters: every item is equally rare, the table churns constantly, and the top-k is mostly false positives. But that is correct behavior — there are no heavy hitters to find. Skewed (Zipfian) data is where it shines.

---

## Senior Questions (12 Q&A)

### S1. How do you compute a global top-k across many machines?
Each shard runs its own Space-Saving summary; a coordinator **merges** the compact summaries (add counts and errors on shared items, union the rest, truncate to `m`, charge the truncation floor into survivors' error). Only summaries cross the network, never the raw stream.

### S2. Is the merge operation associative and commutative?
Yes (up to tie-breaking), because merging adds per-item counts/errors over the key union, which is order-independent. So you can merge in any tree shape — the basis for hierarchical / map-reduce aggregation.

### S3. What is the merged error bound?
Still `≈ n/m` over the combined stream: the truncation floor `μ*` (the `(m+1)`-th largest count of counts summing to `n`) is `≤ n/m`, and it is charged into survivors' error to keep the bracket sound.

### S4. How does data skew affect accuracy?
On Zipfian streams the heavy hitters quickly exceed the eviction floor and stay with near-exact counts, while churn happens entirely in the long tail. So the realized error of the heavy hitters is far below the `n/m` worst case — a small `m` gives near-exact top-k.

### S5. How do you make Space-Saving answer "trending" (recent) instead of "all-time"?
Add recency: tumbling windows (reset per window), sliding windows (merge a trailing set of sub-summaries), or exponential decay (periodically scale all counts down). Plain counts are all-time and let old hits dominate forever.

### S6. How would you use Space-Saving for hot-key detection in a cache?
Run it on the key access stream; when a key's lower bound `count - error` crosses a hot-key threshold, promote it (replicate, pin in a local tier, or split its shard) to avoid a hot partition. Use hysteresis to avoid flapping.

### S7. Which production systems use this?
Redis's `TOPK` type (RedisBloom, based on HeavyKeeper — a Space-Saving descendant) for trending/hot keys; Apache DataSketches and various telemetry/network-monitoring pipelines use Space-Saving-family algorithms for heavy hitters.

### S8. When would you pick Count-Min over Space-Saving in a distributed setting?
When you need **exact** mergeability (Count-Min arrays add cellwise with no truncation error) and point queries for arbitrary items. The trade-off: Count-Min cannot name the frequent items, so pair it with a candidate heap, or pair both.

### S9. How do you verify a Space-Saving implementation?
Cross-check against an exact hash map on small streams (the genuinely frequent items must match), assert the over-estimate property (`count ≥ f` for all monitored items), assert `Σ count = n`, and check the realized `error` brackets contain the true frequencies.

### S10. What are the main performance levers?
The Stream-Summary (avoid `O(m)` min-scan), a fast `item → bucket` hash map, `O(1)` set membership for buckets, and batching the top-k sort to report time only.

### S11. How do you detect that the top-k is not meaningful?
Watch the head-bucket (min) count vs `n/m`: if even the max counts hover near `n/m`, the stream has no real skew and the top-k is noise. Eviction rate and top-k stability (Jaccard vs last window) are complementary signals.

### S12 (analysis). Why is Space-Saving "the most accurate for top-k" formally?
Berinde et al. (2010) prove its per-item top-k error is bounded by the *residual* mass outside the top-k, `F^{res(k)}/(m-k)`, which is small precisely when the data is skewed — strictly stronger than the input-size-only `n/m` bound that Misra-Gries gives.

---

## Professional Questions (8 Q&A)

### P1. Design a service that finds top-k search queries across a fleet at 1M events/s.
Shard by query hash; each shard runs a Stream-Summary with `m ≈ 6/φ`. Periodically snapshot and merge per-shard summaries into a global top-k with truncation-error accounting. Add windowing for trending. Report only guaranteed heavy hitters (`count - error > threshold`). Monitor head-bucket count and eviction rate.

### P2. Prove the over-estimate is exactly the recorded error.
By induction: on insertion via eviction, `count = min + 1, error = min`, and the current occurrence makes the true count `≥ 1 = count - error`; the upper side `f ≤ count` holds because prior occurrences of the item were credited to a counter evicted at `≤ min` (monotone minimum). Increments raise count and true frequency together, preserving `count - error ≤ f ≤ count`.

### P3. Why does the Stream-Summary achieve `O(1)` where a general priority queue needs `O(log m)`?
Because every count change is exactly `+1` (or `min → min+1` on eviction), the destination bucket is always *adjacent* to the source bucket in the sorted list — no comparison-based search or heap sift is required. This `+1`-locality is the algorithmic crux.

### P4. How do you prove the merge is sound?
Counts add (each input over-estimates, so the sum over-estimates the combined frequency), and `count - error` adds (each input lower-bounds, so the sum lower-bounds). Truncation only drops items (never lowers a survivor's count) and adds the floor `μ* ≤ n/m` to survivors' error, keeping `count - error ≤ f ≤ count` over the combined stream.

### P5. When is the `n/m` bound tight, and what does that imply?
When the stream makes all `m` counters equal to `n/m`, every eviction inherits `min = n/m` — the worst case. Implication: certainty about borderline items needs a larger `m`, not cleverness; but real (skewed) streams are far from this worst case, so the realized error is tiny.

### P6. Space-Saving and Misra-Gries monitor the same set of items but differ — how?
Their *set* of survivors coincides (a known equivalence), but Space-Saving's counts carry more information: the over-estimate plus the error bracket. Misra-Gries' global decrement bleeds count from heavy hitters, degrading the *estimates* (and possibly ranking) even though the monitored set matches.

### P7. How would you parallelize building a single summary on one huge dataset?
Partition the data, build an independent summary per partition (embarrassingly parallel, `O(m)` each), then merge the partition summaries with the bounded-error merge. No shared mutable state during the build phase.

### P8 (analysis). What is the space lower bound for heavy hitters, and is Space-Saving optimal?
Finding all `φ`-frequent items requires `Ω(1/φ)` space (you must distinguish that many candidates). Space-Saving uses `m = O(1/φ)` counters — optimal up to constants for the deterministic counter-based approach.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing an exact frequency count that ran out of memory.
Look for a story: a top-queries / hot-key feature where a full hash map OOM'd on high-cardinality data; the switch to Space-Saving with a fixed `m` sized to the threshold; validating the top-k against the old exact counts on a sample; and the memory dropping from unbounded to `O(m)`.

### B2. A teammate shipped Misra-Gries and the trending list looked off on skewed traffic. How do you handle it?
Explain calmly: Misra-Gries decrements *all* counters on a miss, so heavy hitters bleed count on skewed streams. Switch the miss step to Space-Saving's evict-the-min (over-estimate), keeping the heavy hitters' counts near-exact. Show the same `m` gives strictly better top-k. Frame as a known trade-off, not blame.

### B3. Design a feature that surfaces trending hashtags.
Describe Space-Saving with windowing/decay for recency, `m ≈ 6/φ`, report guaranteed heavy hitters (`count - error > threshold`), and distributed merge across ingestion shards. Mention monitoring head-bucket count to detect "no real trend."

### B4. How would you explain Space-Saving to a junior engineer?
Use the Top-40 chart analogy: only 40 slots; a new song bumps the lowest-charting one and debuts just above it, then climbs if it stays popular. The "just above" (`min + 1`) and the small over-count (error) are the whole idea. Then show the three-way add rule.

### B5. Your heavy-hitter detector reports noise. How do you investigate?
Check: is `m` large enough for the threshold (`m ≥ 1/φ`)? Are you reporting raw top-k instead of filtering by `count - error > threshold`? Is the stream actually skewed (compare head-bucket count to `n/m`)? Is it an all-time count where you wanted a recent window?

---

## Coding Challenges

### Challenge 1: Space-Saving top-k (core algorithm)

**Problem.** Implement a Space-Saving structure with `m` counters supporting `add(item)` and `topK(k)`. Track the error per slot.

**Example.**
```text
m = 3, stream = A B C A A B D A B
topK(2) -> [A, B]   (counts A=4, B=3, D=2 with err 1)
```

**Constraints.** `m ≥ 1`; items are strings; stream may be long.

**Optimal.** `O(1)` per item with a Stream-Summary; the version below is the clear map + min-scan (`O(m)` per miss), which is enough for a whiteboard.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

type SpaceSaving struct {
	m     int
	count map[string]int
	err   map[string]int
}

func NewSpaceSaving(m int) *SpaceSaving {
	return &SpaceSaving{m: m, count: map[string]int{}, err: map[string]int{}}
}

func (s *SpaceSaving) Add(item string) {
	if _, ok := s.count[item]; ok {
		s.count[item]++
		return
	}
	if len(s.count) < s.m {
		s.count[item], s.err[item] = 1, 0
		return
	}
	min, victim := 1<<62, ""
	for k, c := range s.count {
		if c < min {
			min, victim = c, k
		}
	}
	delete(s.count, victim)
	delete(s.err, victim)
	s.count[item], s.err[item] = min+1, min
}

func (s *SpaceSaving) TopK(k int) []string {
	type kv struct {
		key string
		c   int
	}
	all := []kv{}
	for key, c := range s.count {
		all = append(all, kv{key, c})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].c > all[j].c })
	out := []string{}
	for i := 0; i < k && i < len(all); i++ {
		out = append(out, all[i].key)
	}
	return out
}

func main() {
	ss := NewSpaceSaving(3)
	for _, x := range []string{"A", "B", "C", "A", "A", "B", "D", "A", "B"} {
		ss.Add(x)
	}
	fmt.Println(ss.TopK(2)) // [A B]
}
```

**Java.**
```java
import java.util.*;

public class SpaceSaving {
    private final int m;
    private final Map<String, Integer> count = new HashMap<>();
    private final Map<String, Integer> err = new HashMap<>();

    public SpaceSaving(int m) { this.m = m; }

    public void add(String item) {
        if (count.containsKey(item)) { count.merge(item, 1, Integer::sum); return; }
        if (count.size() < m) { count.put(item, 1); err.put(item, 0); return; }
        String victim = null; int min = Integer.MAX_VALUE;
        for (var e : count.entrySet())
            if (e.getValue() < min) { min = e.getValue(); victim = e.getKey(); }
        count.remove(victim); err.remove(victim);
        count.put(item, min + 1); err.put(item, min);
    }

    public List<String> topK(int k) {
        List<Map.Entry<String,Integer>> all = new ArrayList<>(count.entrySet());
        all.sort((a, b) -> b.getValue() - a.getValue());
        List<String> out = new ArrayList<>();
        for (int i = 0; i < k && i < all.size(); i++) out.add(all.get(i).getKey());
        return out;
    }

    public static void main(String[] args) {
        SpaceSaving ss = new SpaceSaving(3);
        for (String x : List.of("A","B","C","A","A","B","D","A","B")) ss.add(x);
        System.out.println(ss.topK(2)); // [A, B]
    }
}
```

**Python.**
```python
class SpaceSaving:
    def __init__(self, m):
        self.m = m
        self.count = {}
        self.err = {}

    def add(self, item):
        if item in self.count:
            self.count[item] += 1
            return
        if len(self.count) < self.m:
            self.count[item] = 1
            self.err[item] = 0
            return
        victim = min(self.count, key=self.count.get)
        mn = self.count[victim]
        del self.count[victim]; del self.err[victim]
        self.count[item] = mn + 1
        self.err[item] = mn

    def top_k(self, k):
        return [it for it, _ in sorted(self.count.items(),
                                       key=lambda kv: kv[1], reverse=True)[:k]]


if __name__ == "__main__":
    ss = SpaceSaving(3)
    for x in "A B C A A B D A B".split():
        ss.add(x)
    print(ss.top_k(2))  # ['A', 'B']
```

---

### Challenge 2: Report guaranteed heavy hitters (no false positives)

**Problem.** After processing `n` items with `m` counters, return all items whose **lower bound** `count - error` exceeds `threshold` — these are guaranteed to truly exceed the threshold.

**Example.**
```text
threshold = n/m  ->  returns only items with f > n/m for certain
```

**Go.**
```go
func (s *SpaceSaving) GuaranteedHeavy(threshold int) []string {
	out := []string{}
	for k, c := range s.count {
		if c-s.err[k] > threshold {
			out = append(out, k)
		}
	}
	return out
}
```

**Java.**
```java
public List<String> guaranteedHeavy(int threshold) {
    List<String> out = new ArrayList<>();
    for (String k : count.keySet())
        if (count.get(k) - err.get(k) > threshold) out.add(k);
    return out;
}
```

**Python.**
```python
def guaranteed_heavy(self, threshold):
    return [k for k in self.count
            if self.count[k] - self.err[k] > threshold]
```

---

### Challenge 3: Merge two summaries into a global top-k

**Problem.** Given two Space-Saving summaries (as `item -> (count, error)`), merge them into one with at most `m` counters, charging the truncation floor into survivors' error.

**Example.**
```text
A.merge(B) -> combined top-m, sound brackets over the union
```

**Go.**
```go
func Merge(a, b map[string][2]int, m int) map[string][2]int {
	combined := map[string][2]int{}
	for k, v := range a {
		combined[k] = v
	}
	for k, v := range b {
		if c, ok := combined[k]; ok {
			combined[k] = [2]int{c[0] + v[0], c[1] + v[1]}
		} else {
			combined[k] = v
		}
	}
	type kv struct {
		key string
		v   [2]int
	}
	all := []kv{}
	for k, v := range combined {
		all = append(all, kv{k, v})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].v[0] > all[j].v[0] })
	floor := 0
	if len(all) > m {
		floor = all[m].v[0]
		all = all[:m]
	}
	out := map[string][2]int{}
	for _, e := range all {
		out[e.key] = [2]int{e.v[0], e.v[1] + floor}
	}
	return out
}
```

**Java.**
```java
static Map<String, int[]> merge(Map<String,int[]> a, Map<String,int[]> b, int m) {
    Map<String, int[]> c = new HashMap<>();
    a.forEach((k, v) -> c.put(k, new int[]{v[0], v[1]}));
    b.forEach((k, v) -> c.merge(k, v, (x, y) -> new int[]{x[0]+y[0], x[1]+y[1]}));
    List<Map.Entry<String,int[]>> all = new ArrayList<>(c.entrySet());
    all.sort((x, y) -> y.getValue()[0] - x.getValue()[0]);
    int floor = all.size() > m ? all.get(m).getValue()[0] : 0;
    Map<String, int[]> out = new HashMap<>();
    for (int i = 0; i < Math.min(m, all.size()); i++) {
        var e = all.get(i);
        out.put(e.getKey(), new int[]{e.getValue()[0], e.getValue()[1] + floor});
    }
    return out;
}
```

**Python.**
```python
def merge(a, b, m):
    c = {k: list(v) for k, v in a.items()}
    for k, (cnt, err) in b.items():
        if k in c:
            c[k][0] += cnt
            c[k][1] += err
        else:
            c[k] = [cnt, err]
    ranked = sorted(c.items(), key=lambda kv: kv[1][0], reverse=True)
    floor = ranked[m][1][0] if len(ranked) > m else 0
    return {k: (cnt, err + floor) for k, (cnt, err) in ranked[:m]}
```

---

### Challenge 4: Stream-Summary increment in O(1) (bucket move)

**Problem.** Implement the `O(1)` increment: move an item from its bucket (count `c`) to the adjacent bucket (count `c + 1`), creating it if absent and unlinking an emptied bucket.

**Example.**
```text
buckets: [1:{X,Y}] -> [2:{D}]   ; bump(X) -> [1:{Y}] -> [2:{D,X}]
```

**Go.** (see `middle.md` for the full struct; here is the `bump` core)
```go
func (s *StreamSummary) bump(key string, be *list.Element) {
	b := be.Value.(*bucket)
	it := b.items[key]
	delete(b.items, key)
	newCount := b.count + 1
	next := be.Next()
	if next != nil && next.Value.(*bucket).count == newCount {
		next.Value.(*bucket).items[key] = it
		s.bucketOf[key] = next
	} else {
		nb := &bucket{count: newCount, items: map[string]*item{key: it}}
		s.bucketOf[key] = s.buckets.InsertAfter(nb, be)
	}
	if len(b.items) == 0 {
		s.buckets.Remove(be)
	}
}
```

**Java.**
```java
private void bump(String key) {
    Bucket b = bucketOf.get(key);
    b.items.remove(key);
    Bucket target = (b.next != null && b.next.count == b.count + 1)
            ? b.next : insertBucketAfter(b, b.count + 1);
    target.items.add(key);
    bucketOf.put(key, target);
    if (b.items.isEmpty()) unlink(b);
}
```

**Python.**
```python
def _bump(self, key):
    b = self.bucket_of[key]
    b.items.discard(key)
    if b.next and b.next.count == b.count + 1:
        target = b.next
    else:
        target = Bucket(b.count + 1)
        target.prev, target.next = b, b.next
        if b.next:
            b.next.prev = target
        b.next = target
    target.items.add(key)
    self.bucket_of[key] = target
    if not b.items:
        self._unlink(b)
```

---

## Final Tips

- Lead with the one-liner: *"Keep `m` counters; on a miss when full, replace the smallest, start the newcomer at `min + 1`, record `min` as its over-count error. The big counters are the top-k, and anything above `n/m` is guaranteed kept — in `O(1)` per item with the Stream-Summary."*
- Immediately flag the two gotchas: **the newcomer inherits `min + 1` (not `1`)**, and **counts over-estimate** so you bracket the truth with `[count - error, count]`.
- Name the **Stream-Summary** (buckets in a sorted linked list) for `O(1)`, and explain the `+1`-adjacency that beats a heap's `O(log m)`.
- Compare crisply: vs **Misra-Gries** (over- vs under-estimate; evict one vs decrement all → SS better for top-k on skew); vs **Count-Min** (names items vs point queries; deterministic vs randomized); vs **Lossy Counting** (fixed `m` vs growing memory).
- Mention **mergeability** for distributed top-k and that **skew (Zipfian) data** is what makes a small `m` accurate.

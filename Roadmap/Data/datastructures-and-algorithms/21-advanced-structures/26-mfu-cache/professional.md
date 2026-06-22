# MFU Cache — Professional Level

## Table of Contents

1. [Framing: MFU as a Component, Not a Policy](#framing-mfu-as-a-component-not-a-policy)
2. [Where MFU-Style Victim Selection Lives in Real Systems](#where-mfu-style-victim-selection-lives-in-real-systems)
   - [Database Buffer-Pool Managers](#database-buffer-pool-managers)
   - [The Inner-Relation-of-a-Join Case](#the-inner-relation-of-a-join-case)
   - [Frequency in Admission, Not Just Eviction](#frequency-in-admission-not-just-eviction)
3. [Frequency Estimation at Scale and Under Memory Pressure](#frequency-estimation-at-scale-and-under-memory-pressure)
   - [Count–Min Sketch as the Frequency Oracle](#countmin-sketch-as-the-frequency-oracle)
   - [Heavy Hitters: Space-Saving and Misra–Gries](#heavy-hitters-space-saving-and-misragries)
   - [4-Bit Counting Count-Min and Periodic Aging](#4-bit-counting-count-min-and-periodic-aging)
   - [Reset/Decay Scheduling and Its Interaction with MFU](#resetdecay-scheduling-and-its-interaction-with-mfu)
4. [Concurrency and Throughput Engineering](#concurrency-and-throughput-engineering)
   - [The Contention Problem: MFU Evicts the Hottest Keys](#the-contention-problem-mfu-evicts-the-hottest-keys)
   - [Sharding and Striping](#sharding-and-striping)
   - [Read Buffers and Ring-Buffer Batching](#read-buffers-and-ring-buffer-batching)
   - [Lossy Frequency Updates and Lock-Free Considerations](#lossy-frequency-updates-and-lock-free-considerations)
5. [Correctness Under Concurrency, Persistence, and Observability](#correctness-under-concurrency-persistence-and-observability)
6. [Production Reference Implementation (Go, Sharded + Batched)](#production-reference-implementation-go-sharded--batched)
7. [Core Implementation in Java](#core-implementation-in-java)
8. [Benchmarking Methodology](#benchmarking-methodology)
9. [A/B Testing a Replacement Policy Safely in Production](#ab-testing-a-replacement-policy-safely-in-production)
10. [Research Pointers and a Decision Framework](#research-pointers-and-a-decision-framework)
11. [Key Takeaways](#key-takeaways)

---

## Framing: MFU as a Component, Not a Policy

The [senior level](./senior.md) established the honest verdict: standalone MFU is almost never the right production policy. Past frequency predicting *low* future use is the inverse of the dominant Zipfian reality, so a cache-wide MFU evicts exactly the keys it should protect. This level takes that verdict as a premise and asks the harder, more useful question a working engineer actually faces: **where does "evict the most-used in this scope" logic genuinely ship, and how is it engineered at scale?**

The answer is consistent across the literature and across real storage engines: MFU-flavored victim selection survives as a *scoped, region-local rule* inside larger replacement systems — database buffer-pool managers, sequential-scan rings, and the frequency machinery that modern caches use for *admission* rather than eviction. Treat MFU not as a cache you build, but as a primitive you recognize: the moment frequency is anti-correlated with future use *within a bounded region*, you are looking at MFU semantics, whatever the surrounding system calls them.

Everything below is engineered around that reframing. We cover the systems where the primitive lives, how to estimate frequency cheaply and concurrently enough to drive it, why MFU is uniquely hostile to parallelism, how to make it correct and observable, and how to validate it without shipping a regression. The companion theory — O(1) bucket correctness, IRM optimality, competitive bounds, sketch error — lives in [LFU `professional.md`](../21-lfu-cache/professional.md) and transfers directly with the eviction pointer flipped from `minFreq` to `maxFreq`.

---

## Where MFU-Style Victim Selection Lives in Real Systems

### Database Buffer-Pool Managers

The buffer pool is the canonical home of MFU/MRU semantics because database access patterns are *known* — the query optimizer has already decided whether a relation will be scanned sequentially, probed randomly, or looped. That knowledge is exactly what a general-purpose cache lacks, and it is what makes scoped MFU defensible.

- **DBMIN (Chou & DeWitt, 1985).** The foundational result: replacement should be chosen *per relation*, matched to its access pattern, not by a single global recency rule. A relation accessed by a *cyclic* (looping) scan gets an MRU-flavored locality set, because the page you just finished is the one you will not need until the next full cycle. DBMIN's "query locality set model" is the formal origin of the idea that MFU/MRU is a *local* policy keyed to a *known* pattern — the engineering condition under which MFU is correct.

- **PostgreSQL ring / recency buffers.** PostgreSQL does not implement MFU directly; it implements the *pragmatic descendant*. Large sequential scans, bulk writes, and `VACUUM` use a small private **ring buffer** (`BAS_BULKREAD`, `BAS_BULKWRITE`, `BAS_VACUUM`) so a scan reuses a capped set of slots in a near-MRU fashion and **cannot evict the shared hot buffer pool**. Within the ring, the just-used slot is the one recycled — MFU taken to its one-bucket limit. The base pool itself runs a clock-sweep (an approximate LRU), so PostgreSQL is a *hybrid*: LRU for random access, ring/MRU for scans. This is scan resistance by *region scoping*, the exact pattern the senior level argued for.

- **Oracle and the recency angle.** Oracle's buffer cache distinguishes full-table-scan reads (placed at the LRU end, so they are evicted first — a different mechanism reaching the same goal: do not let a scan pollute the hot set) from index-probe reads. The lesson generalizes: every mature buffer manager has a *scan-resistance* story, and the scan-resistance story is where MFU/MRU semantics surface.

The unifying engineering insight: **scan resistance is the real requirement; MFU is one of several mechanisms that deliver it.** Ring buffers, MRU-within-scope, and "insert scanned pages at the cold end" are three implementations of the same intent. An engineer should reach for the simplest one that fits — usually a ring buffer or a cold-insert hint, rarely a full MFU.

### The Inner-Relation-of-a-Join Case

The single cleanest real-world MFU/MRU win is the **inner relation of a nested-loop join**. The outer relation is scanned once; for each outer tuple, the *entire* inner relation is scanned again. The inner relation is therefore referenced as a tight repeating loop `1..n, 1..n, …`.

This is precisely the looping-sequential string the [senior level](./senior.md#the-looping-sequential-anomaly) analyzed, where LRU is *pessimal* (0% hits for buffer `b < n`) and MRU reaches `(b-1)/n`, matching offline-optimal. A buffer manager that recognizes "this relation is the inner side of a loop join" and applies MRU-style replacement to *just that relation's pages* converts an all-miss catastrophe into a near-optimal hit ratio — without touching the policy for any other relation. DBMIN named this; commercial buffer managers (DB2, Sybase, and their descendants) implemented per-relation policies for exactly it.

Note the discipline that makes it work: the scope is *one relation*, the pattern is *known* (the planner chose the nested loop), and the policy is *bounded in blast radius* (it cannot evict anything outside that relation's locality set). Strip any of those three conditions and MFU stops being safe. That is the template for every legitimate MFU deployment.

### Frequency in Admission, Not Just Eviction

The most important modern reframing is that **frequency belongs in the admission decision, not (only) the eviction decision.** This is the W-TinyLFU insight, shipped in [Caffeine](https://github.com/ben-manes/caffeine) (Java) and [Ristretto](https://github.com/dgraph-io/ristretto) (Go).

W-TinyLFU keeps a tiny frequency sketch and, when the main region is full, admits a candidate over the chosen victim **only if the candidate's estimated frequency is at least the victim's**. The base eviction order is a recency policy (SLRU); frequency acts as a *gate*. This inverts the naive frequency-cache design: instead of an expensive per-key frequency apparatus driving eviction, a cheap approximate sketch drives *admission*, and recency drives eviction.

Where does MFU fit this picture? As a *victim selector inside a scan region*. Recall the hybrid sketch from the [senior level](./senior.md#mfu-and-admission-policies):

```
on miss, cache full:
    region = classify(candidate)              # scan vs. random-access
    victim = (region == SCAN)
             ? mostFrequent(scanRegion)        # MFU within the scan ring
             : lru(mainRegion)                 # recency elsewhere
    if estFreq(candidate) >= estFreq(victim):  # TinyLFU admission gate
        admit candidate, evict victim
    else:
        bypass candidate                       # do not cache the scan page
```

The frequency metric means *opposite things* in the two regions: in the random-access region high frequency means "keep" (the admission gate protects it); in the scan region high frequency means "consumed, evict" (MFU sheds it). The hybrid keeps them apart by region. This is the only architecture in which standalone-MFU-like logic and frequency-admission coexist without fighting — and it is, recognizably, what scan-resistant buffer managers already do.

---

## Frequency Estimation at Scale and Under Memory Pressure

Exact per-key frequency — the bucket-DLL apparatus from the [senior O(1) design](./senior.md#the-o1-design-mirror-of-lfu) — costs a full counter and bucket pointers per entry. At tens of millions of keys that is real memory, and the counters never stop growing. Production systems estimate frequency approximately, in a fixed footprint, with built-in aging. The structures below are the same ones LFU/TinyLFU use; MFU consumes their *top* rather than their *bottom*.

### Count–Min Sketch as the Frequency Oracle

The [Count–Min Sketch](../08-count-min-sketch/professional.md) is the workhorse. `d` rows of `w` counters; hash a key into one counter per row; the frequency estimate is the **minimum across rows** (minimum because every collision can only *inflate* a counter, so the min is the least-inflated, tightest estimate). Total space is `O(w·d)` bits — independent of the number of distinct keys — with one-sided error: it never underestimates, and overestimates by more than `ε·N` with probability at most `e^{-d}` when `w ≥ e/ε`.

For MFU you usually do not even need the absolute count. You need the *ranking* near the top — "is this candidate a heavy hitter?" — because MFU's eviction set *is* the heavy-hitter set. A CMS answers that with an O(1) point query, and the over-estimation bias is benign for ranking: a cold key occasionally inflated toward the hot set means MFU occasionally evicts a not-actually-hot key, tolerable noise for a heuristic component. (Contrast LFU, which queries the CMS for the *minimum* and is hurt by over-estimation of cold keys — a subtle reason MFU and LFU stress the sketch differently.)

### Heavy Hitters: Space-Saving and Misra–Gries

If MFU's job is literally "evict from the top-k by frequency," the right primitive is a **heavy-hitters** structure, not a full sketch:

- **Misra–Gries (1982).** Maintains up to `k` counters; on a key not currently tracked when all counters are full, decrement *all* counters and drop those hitting zero. Gives every key an under-estimate within `N/(k+1)` of its true count. The classic deterministic heavy-hitter summary.

- **Space-Saving (Metwally, Agrawal & El Abbadi, 2005).** Maintains the approximate top-`k` frequent items in `O(k)` space with tight error bounds. On a miss with counters full, it *reassigns the minimum-count slot* to the new key and inherits that minimum as the new key's count — so popular keys accrue and survive, rare keys churn through the bottom slot. The "Stream-Summary" data structure gives O(1) updates.

Space-Saving is the natural backbone of an *approximate MFU*: it already tracks "the current top-k frequent keys," which is exactly MFU's eviction candidate set. On overflow, evict the current maximum-frequency tracked key, tie-broken by recency. You get MFU semantics in `O(k)` space with no per-key buckets and provable error bounds — the production form of the policy.

### 4-Bit Counting Count-Min and Periodic Aging

TinyLFU's concrete sketch is a **Count-Min with 4-bit counters** (each cell saturates at 15) plus a **doorkeeper** Bloom filter that absorbs singletons so one-hit keys never consume sketch budget. Four bits is enough because eviction/admission needs only coarse hot-vs-cold ranking, not exact counts, and the saturating cap bounds memory hard.

The aging mechanism is **reset-on-N**: when a global add counter reaches a sampling threshold (≈ 10× capacity in Caffeine), **halve every counter in one pass** (a single shift per cell) and clear the doorkeeper. Halving is multiplicative decay; over time the sketch reflects *recent* frequency, fusing frequency with coarse recency. This is what makes TinyLFU adaptive to distribution shift while staying frequency-aware — and it costs O(sketch size) amortized over N operations, i.e. near-zero per access.

### Reset/Decay Scheduling and Its Interaction with MFU

For MFU the decay schedule is not a tuning afterthought — it changes *which key gets evicted*, and its role **inverts** relative to LFU.

In LFU, decay exists to stop a once-hot key from *squatting a cache slot forever* (the aging problem; its dead-weight duration is linear in its historical peak — see [LFU professional, aging analysis](../21-lfu-cache/professional.md#formal-analysis-of-the-aging-problem)). In MFU, high counts are the *eviction target*, so decay instead prevents the **opposite pathology**: a briefly-hammered key instantly and permanently becoming the victim. Decay lets that key's count fade back into the protected mid-range so it is not evicted on the strength of one burst.

The scheduling rule that falls out: **tune the decay half-life to the scan/loop period.** One halving per loop cycle makes an item's frequency mean "hot in *this* cycle," not "hot since boot" — which is exactly what you want when MFU is shedding consumed scan pages. Too slow a decay and MFU ossifies on ancient hot keys; too fast and it loses the frequency signal entirely and degenerates toward MRU. The half-life is the dial between "MFU" and "MRU," and the workload's cycle length sets it.

| Decay mechanism | Cost | Granularity | Fit for MFU |
|---|---|---|---|
| Reset-on-N halving (TinyLFU) | O(sketch) amortized ≈ 0/op | coarse, global | default; cheapest; tune N to loop period |
| Windowed counts | per-entry timestamp/ring | sharp time cutoff | when the cycle is time-defined, not op-defined |
| Exponential decay (LRFU `(1/λ)^Δt`) | float + math per access | smooth, tunable | when you want a continuous MFU↔MRU dial |
| Dynamic-aging offset (LFUDA) | one global int | coarse | cheapest ratchet; rarely needed for MFU |

---

## Concurrency and Throughput Engineering

### The Contention Problem: MFU Evicts the Hottest Keys

MFU is the *hardest* common cache policy to parallelize, and the reason is structural, not incidental. Every cache read mutates shared ordering state. In LRU that is a local splice (move one node to the head). In a frequency cache it is a **promotion between buckets plus a possible move of the extremal pointer**.

For MFU the extremal pointer is `maxFreq`, and `maxFreq` sits on the **hottest keys in the cache**. Under a Zipfian read mix, the hottest keys are read most, so their promotions all contend on the same `maxFreq` cell and the same top-bucket DLL — *and* that same top bucket is the eviction site. The contention hotspot and the eviction site coincide. This is qualitatively worse than LFU, where eviction happens at `minFreq` (cold keys, low traffic) far from the hot read path. In MFU the read path and the write/evict path collide on the same cache lines.

So the first engineering rule is: **do not put MFU's metadata update on the synchronous read path.** Everything below is a way to get it off that path.

### Sharding and Striping

The default mitigation, and the right first move, is **sharding**: partition keys by `hash(key) % N` into `N` independent sub-caches, each with its own lock, buckets, and `maxFreq`. Contention drops roughly `N`-fold. The same striping pattern underlies any concurrent map; see [concurrent hash map `professional.md`](../18-concurrent-hash-map/professional.md) for the lock-striping and resize-coordination details that a sharded cache shares.

The cost is that frequency — and therefore eviction — becomes **per-shard local**. A key that is globally the most frequent lives in one shard; MFU evicts the locally-most-frequent in *each* shard independently. For MFU this is usually fine: the policy is already a heuristic, and with a good hash the per-shard frequency distributions are statistically similar, so local and global "most frequent" track each other. Choose `N` as a power of two well above your core count (Caffeine/Ristretto use 256+ buffers) so the striping outpaces contention even under skew.

### Read Buffers and Ring-Buffer Batching

The Caffeine technique — the one that makes a frequency-aware cache actually fast — is to **batch metadata updates through lock-free ring buffers** ([the Michael–Scott-style non-blocking queue](../16-lock-free-queue-michael-scott/professional.md) is the conceptual ancestor; Caffeine uses bounded MPSC ring buffers with a striped set of read buffers to cut producer contention).

A read does *not* promote synchronously. It does the hash lookup, returns the value, and **appends a lightweight record of the access to a per-stripe ring buffer**, then returns. A single **maintenance task** (triggered when a buffer fills or on a schedule, run under the one eviction lock via `tryLock`) drains the buffers and applies all the promotions and `maxFreq`/eviction updates in a batch. Consequences:

- Reads are near-lock-free and O(1): a lookup plus a buffered append. The `maxFreq` hotspot is gone from the read path entirely.
- Policy state is **eventually consistent** — promotions lag reads by at most a buffer's worth — which is perfectly acceptable for a heuristic eviction policy.
- If a read buffer is full, the access record is simply **dropped** (lossy). A few lost promotions barely perturb an approximate frequency ranking. Losing updates is a *feature*: it bounds the maintenance work and the buffer memory.

This is the single most important throughput idea for any frequency cache, MFU included: **decouple the read from the bookkeeping.** It converts MFU's worst property (hot-key promotion contention) into off-critical-path batched work.

### Lossy Frequency Updates and Lock-Free Considerations

Two further relaxations, both safe precisely because MFU is approximate:

- **Lossy, racy increments.** If frequency lives in a Count-Min sketch, increments can use relaxed atomics or even plain non-atomic writes. A lost or doubled increment shifts an approximate counter by one — below the sketch's own error band. The eviction decision (a top-k or point query) can run under a short lock or be sampled. This sidesteps bucket-DLL contention completely and is how Ristretto keeps frequency tracking cheap.

- **Sampled eviction.** Rather than maintaining an exact `maxFreq` pointer under contention, sample a small set of resident keys and evict the most frequent among the sample (the Redis `maxmemory-samples` approach, applied to the *max*). This trades a little eviction precision for zero global-pointer contention and is trivially shardable.

Fully lock-free MFU (CAS-based bucket lists, hazard-pointer or epoch reclamation for nodes) is *possible* but rarely justified: the engineering cost is high and the batched-ring-buffer design already removes the contention that would motivate it. The pragmatic production stack is **sharded + sketch-backed + batched + lossy**, with a plain mutex per shard. Reach for lock-free structures only if profiling proves the per-shard mutex is the bottleneck after batching — it almost never is.

---

## Correctness Under Concurrency, Persistence, and Observability

**Correctness under concurrency.** The eventual-consistency model needs an explicit contract. The invariants from the [senior correctness argument](./senior.md#invariants-and-correctness-argument) (map–bucket consistency, `maxFreq` = true max, within-bucket recency order, capacity bound) must hold **after each maintenance drain**, not after each read. Between drains, the cache may briefly hold one entry over capacity (the new insert before the batched eviction) and `maxFreq` may lag. Bound these:

- Apply the eviction synchronously on `put` overflow (so capacity is never exceeded by more than in-flight inserts), even while promotions are batched.
- Make the per-shard lock cover both the structural mutation (insert/evict, which touches `maxFreq` and the map) and the maintenance drain, so structural invariants are never observed mid-update.
- Treat the batched promotions as *advisory*: a dropped promotion only makes a key look slightly colder, which for MFU makes it *less* likely to be wrongly evicted — a safe direction. There is no correctness bug from a lost promotion, only a hit-ratio nudge.

**Persistence and warm restart.** A cache that loses all frequency state on restart re-enters the cold-start regime where MFU is most dangerous (every fresh key looks equally novel, so the freshness bias is undefined). For caches where warm restart matters, periodically **snapshot the sketch** (it is a fixed-size byte array — trivially serializable) rather than per-key counts, and reload it on startup. Snapshot the *approximate* frequency state, never the exact buckets: the sketch is small, version-tolerant, and its inherent fuzziness absorbs the staleness of a snapshot taken seconds ago. Pair the snapshot with the reset-on-N epoch counter so decay resumes coherently.

**Observability.** A frequency policy that you cannot see into is impossible to trust or tune. Instrument at minimum:

- **Hit ratio**, segmented by region (scan vs random-access) — a global hit ratio hides the only thing MFU affects.
- **Eviction-by-frequency histogram.** For each eviction, record the victim's (estimated) frequency bucket. A correct MFU shows evictions concentrated in the *high*-frequency buckets within its region; if evictions spread across all frequencies, `maxFreq` tracking is broken or the region classification is wrong.
- **Decay sweep counter and timing** — confirm halving fires at the intended cadence relative to the loop period.
- **Read-buffer drop rate** — high drops mean maintenance is falling behind and the frequency picture is staler than designed.

These four turn MFU from a black box into something you can A/B and falsify. The eviction-by-frequency histogram in particular is the canary: it directly visualizes whether the policy is doing what its name claims.

---

## Production Reference Implementation (Go, Sharded + Batched)

A production-grade Go MFU: sharded for concurrency, with a synchronous structural path (insert/evict/`maxFreq` recompute handled correctly per the [senior O(1) design](./senior.md#the-o1-design-mirror-of-lfu)) and promotions sketched as a batched, lossy ring-buffer drain. Generic over `comparable` keys.

```go
package mfu

import (
	"container/list"
	"hash/maphash"
	"sync"
)

// entry is the per-key node stored inside a frequency bucket.
type entry[K comparable, V any] struct {
	key  K
	val  V
	freq int
}

// shard is an independent O(1) MFU: map + freq buckets + maxFreq, under one lock.
type shard[K comparable, V any] struct {
	mu      sync.Mutex
	cap     int
	maxFreq int
	items   map[K]*list.Element // key -> element in buckets[freq]
	buckets map[int]*list.List  // freq -> DLL, front = MRU, back = LRU

	// readBuf batches promotions off the read path; drained under mu.
	readBuf []K
}

func newShard[K comparable, V any](capacity int) *shard[K, V] {
	return &shard[K, V]{
		cap:     capacity,
		items:   make(map[K]*list.Element, capacity),
		buckets: make(map[int]*list.List),
		readBuf: make([]K, 0, 64),
	}
}

func (s *shard[K, V]) bucket(f int) *list.List {
	if l := s.buckets[f]; l != nil {
		return l
	}
	l := list.New()
	s.buckets[f] = l
	return l
}

// promote moves a key up one frequency. Caller holds s.mu.
// maxFreq can only RISE here — promotion never lowers the max.
func (s *shard[K, V]) promote(el *list.Element) {
	en := el.Value.(*entry[K, V])
	old := en.freq
	s.buckets[old].Remove(el)
	if s.buckets[old].Len() == 0 {
		delete(s.buckets, old)
	}
	en.freq++
	if en.freq > s.maxFreq {
		s.maxFreq = en.freq
	}
	s.items[en.key] = s.bucket(en.freq).PushFront(en)
}

// drainReads applies all buffered promotions in a batch. Caller holds s.mu.
// Lost entries (buffer was full at append time) are simply never applied — safe.
func (s *shard[K, V]) drainReads() {
	for _, k := range s.readBuf {
		if el, ok := s.items[k]; ok {
			s.promote(el)
		}
	}
	s.readBuf = s.readBuf[:0]
}

func (s *shard[K, V]) get(key K) (V, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	el, ok := s.items[key]
	if !ok {
		var zero V
		return zero, false
	}
	v := el.Value.(*entry[K, V]).val
	// Buffer the promotion instead of doing it synchronously. Lossy if full.
	if len(s.readBuf) < cap(s.readBuf) {
		s.readBuf = append(s.readBuf, key)
	}
	// Amortized drain: apply the batch when the buffer fills.
	if len(s.readBuf) == cap(s.readBuf) {
		s.drainReads()
	}
	return v, true
}

func (s *shard[K, V]) put(key K, val V) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cap == 0 {
		return
	}
	if el, ok := s.items[key]; ok {
		el.Value.(*entry[K, V]).val = val
		s.promote(el)
		return
	}
	// Drain pending promotions so eviction sees fresh frequencies.
	s.drainReads()
	if len(s.items) >= s.cap {
		s.evictMax()
	}
	en := &entry[K, V]{key: key, val: val, freq: 1}
	s.items[key] = s.bucket(1).PushFront(en)
	if s.maxFreq == 0 {
		s.maxFreq = 1
	}
}

// evictMax removes the LRU (back) entry of the highest-frequency bucket.
// This is the ONLY place maxFreq can fall. Caller holds s.mu.
func (s *shard[K, V]) evictMax() {
	l := s.buckets[s.maxFreq]
	victim := l.Back() // LRU within the max bucket
	en := victim.Value.(*entry[K, V])
	l.Remove(victim)
	delete(s.items, en.key)
	if l.Len() == 0 {
		delete(s.buckets, s.maxFreq)
		s.recomputeMax()
	}
}

// recomputeMax walks down to the next non-empty bucket. Amortized O(1):
// promotions are +1 so occupied buckets stay near-contiguous.
func (s *shard[K, V]) recomputeMax() {
	for s.maxFreq > 0 {
		if l := s.buckets[s.maxFreq]; l != nil && l.Len() > 0 {
			return
		}
		s.maxFreq--
	}
}

// MFU is the sharded, concurrent cache.
type MFU[K comparable, V any] struct {
	shards []*shard[K, V]
	mask   uint64
	seed   maphash.Seed
}

// New builds a sharded MFU. numShards is rounded up to a power of two.
func New[K comparable, V any](capacity, numShards int) *MFU[K, V] {
	n := 1
	for n < numShards {
		n <<= 1
	}
	m := &MFU[K, V]{
		shards: make([]*shard[K, V], n),
		mask:   uint64(n - 1),
		seed:   maphash.MakeSeed(),
	}
	per := capacity / n
	if per < 1 {
		per = 1
	}
	for i := range m.shards {
		m.shards[i] = newShard[K, V](per)
	}
	return m
}

func (m *MFU[K, V]) shardFor(key K) *shard[K, V] {
	var h maphash.Hash
	h.SetSeed(m.seed)
	// For non-string keys, hash a stable byte view; shown here for string keys.
	h.WriteString(any(key).(string))
	return m.shards[h.Sum64()&m.mask]
}

func (m *MFU[K, V]) Get(key K) (V, bool) { return m.shardFor(key).get(key) }
func (m *MFU[K, V]) Put(key K, val V)    { m.shardFor(key).put(key, val) }
```

The load-bearing details:

- **`maxFreq` asymmetry is explicit.** `promote` can only raise it (one branch); `evictMax` is the *only* path that lowers it, and only via `recomputeMax`. This mirrors LFU's `minFreq` but with the recompute on the eviction side rather than the promotion side — the structural difference the senior level called the "interview trap." Getting it wrong leaves `maxFreq` pointing at an empty bucket: at best a panic, at worst silent mis-eviction.
- **`drainReads` before `evictMax`.** Eviction must see current frequencies, so `put` flushes the read buffer before choosing a victim. Reads stay cheap; the freshness cost is paid only when it matters.
- **Lossy buffer.** When the read buffer is full at append time, the promotion is dropped. A dropped promotion makes a key look colder, which for MFU only makes it *less* evictable — a safe failure direction.
- **Per-shard capacity.** Capacity divides across shards; global frequency is approximated by per-shard locality, the accepted MFU trade-off. For a global frequency view (e.g. to drive admission), add a single shared Count-Min sketch updated with relaxed atomics, exactly as Ristretto does.

For a sketch-backed *admission* layer on top, the integration point is `put`: before inserting, compare `sketch.Estimate(key)` against `sketch.Estimate(victimKey)` and bypass the insert if the candidate is colder — the W-TinyLFU gate, with MFU choosing the victim inside a scan region.

---

## Core Implementation in Java

The exact O(1) core (single-threaded; wrap with striping or hand to Caffeine's machinery for concurrency), showing the `maxFreq` recompute that is the crux.

```java
import java.util.*;

/** MFU cache: evicts the highest-frequency key, LRU within the max bucket. */
public class MFUCache<K, V> {
    private final int capacity;
    private int maxFreq = 0;
    private final Map<K, Node<K, V>> items = new HashMap<>();
    // freq -> insertion-ordered set; iteration order = recency (first = LRU).
    private final Map<Integer, LinkedHashSet<K>> buckets = new HashMap<>();

    private record Node<K, V>(K key, V value, int freq) {
        Node<K, V> withValue(V v) { return new Node<>(key, v, freq); }
        Node<K, V> promoted()     { return new Node<>(key, value, freq + 1); }
    }

    public MFUCache(int capacity) { this.capacity = capacity; }

    public V get(K key) {
        Node<K, V> n = items.get(key);
        if (n == null) return null;
        promote(key, n);
        return n.value();
    }

    public void put(K key, V value) {
        if (capacity == 0) return;
        Node<K, V> existing = items.get(key);
        if (existing != null) {
            Node<K, V> updated = existing.withValue(value);
            items.put(key, updated);
            promote(key, updated);
            return;
        }
        if (items.size() >= capacity) evictMax();
        items.put(key, new Node<>(key, value, 1));
        buckets.computeIfAbsent(1, f -> new LinkedHashSet<>()).add(key);
        if (maxFreq == 0) maxFreq = 1;
    }

    private void promote(K key, Node<K, V> n) {
        int f = n.freq();
        LinkedHashSet<K> b = buckets.get(f);
        b.remove(key);
        if (b.isEmpty()) buckets.remove(f);
        int nf = f + 1;
        items.put(key, n.promoted());
        buckets.computeIfAbsent(nf, x -> new LinkedHashSet<>()).add(key); // re-add => MRU
        if (nf > maxFreq) maxFreq = nf;       // promotion can only raise max
    }

    private void evictMax() {
        LinkedHashSet<K> b = buckets.get(maxFreq);
        K victim = b.iterator().next();        // first = LRU within max bucket
        b.remove(victim);
        items.remove(victim);
        if (b.isEmpty()) {
            buckets.remove(maxFreq);
            while (maxFreq > 0 && !buckets.containsKey(maxFreq)) maxFreq--; // recompute
        }
    }
}
```

`LinkedHashSet` gives the LRU-within-bucket tie-break for free: re-adding a key on promotion moves it to the MRU end, and `iterator().next()` returns the LRU end for eviction. The `while` loop in `evictMax` is the `maxFreq` recompute — the Java twin of Go's `recomputeMax`.

---

## Benchmarking Methodology

Benchmarking MFU is mostly an exercise in being *honest*: the goal is not to show MFU winning (it rarely does outright) but to identify the narrow regime where it earns its keep and to quantify how badly it loses elsewhere so you never deploy it blind.

**Trace replay, not synthetic loops alone.** Drive the cache with realistic reference strings:

- **Looping / cyclic** (`1..n, 1..n, …`, capacity `b < n`): the regime MFU/MRU is built for. Expect MFU near `(b-1)/n` on the first cycle, then drifting toward LRU as residents accumulate frequency — *measure the drift*, it is the key MFU-specific behavior.
- **Zipfian** (skew `s ∈ [0.7, 1.0]`): the dominant real workload. Expect MFU to be *catastrophic* (it evicts the hot head). This run exists to quantify the downside, not to flatter the policy.
- **Scan + rescan** (a hot working set interleaved with a large sequential scan): the realistic mixed case where *scoped* MFU (scan region only) should match the hot-set's policy while resisting scan pollution.
- **Real traces** (e.g. the ARC/2Q paper traces, or your own production access logs): the only fully trustworthy signal.

**Baselines.** Always compare against LRU, LFU, ARC/2Q, and W-TinyLFU — not just LRU. Reuse the harness and trace set from the [LFU professional benchmarking](../21-lfu-cache/professional.md) so the numbers are comparable across the frequency-cache family. Pure MRU belongs in the looping-trace comparison because, per the senior analysis, MRU — not MFU — is the correct policy there; MFU should *lose to MRU* on pure loops, and your benchmark should show it.

**Metrics.** Hit ratio is primary, but capture also: tail latency under concurrency (the throughput payoff of batching is invisible in a single-threaded hit-ratio run), eviction-by-frequency distribution (to confirm the policy behaves), and memory per entry (exact buckets vs sketch). Run hit-ratio sweeps across capacities — a policy that wins at one cache size can lose at another, and the looping regime in particular is sharply capacity-sensitive.

**How to read the results — honestly.** Expect this shape: MFU competitive only on pure looping (and beaten there by MRU), poor on recency-skewed traffic, catastrophic on Zipfian, and decent on scan+rescan *only when scoped to the scan region*. The correct conclusion from a well-run benchmark is almost always "ship W-TinyLFU/ARC for the general case, and use scoped MFU/MRU (or a ring buffer) only for the known-scan region." If MFU wins your benchmark outright, suspect the trace is unrepresentatively loop-heavy before believing it.

---

## A/B Testing a Replacement Policy Safely in Production

Trace replay validates offline; production has traffic your traces do not. A replacement policy is a *behavioral* change with no functional signal — a wrong policy does not error, it silently lowers your hit ratio and raises backend load — so it must be rolled out like any risky behavioral change.

- **Shadow / mirror first.** Run the candidate policy on **mirrored** traffic with a throwaway cache, comparing simulated hit ratios against the live policy on identical requests. No user impact; directly measures the only metric that matters.
- **Shadow-counter eviction.** Before switching, run the candidate's eviction logic *in shadow* over the live key stream (maintaining its frequency/recency state) and log which keys it *would* evict versus what the live policy does. Diff the eviction-by-frequency histograms.
- **Percentage rollout keyed by a stable hash.** Route a small, stable fraction of cache *instances* (or keyspace shards) to the new policy. Keep the cohort stable so warm-up effects do not pollute the comparison.
- **Guardrail metrics, not just hit ratio.** Watch origin/backend QPS, p99 latency, and error rate — the downstream cost of a hit-ratio regression. A policy change that drops hit ratio 2% can double origin load if the backend was the bottleneck.
- **Automatic rollback.** Tie the rollout to a regression gate on hit ratio and backend load; auto-revert on breach. Because the change is invisible to functional tests, the *only* safety net is the metric guardrail.

The deep reason MFU specifically demands this rigor: its failure mode is *quiet and severe* (evicting the hot set), and its win condition (anti-correlation of frequency and future use within a region) is workload-dependent and can shift. Never promote MFU to a region's policy on offline evidence alone; gate it behind a shadow comparison and a guardrailed rollout.

---

## Research Pointers and a Decision Framework

**Decision framework — when to reach for MFU/MRU semantics:**

```
Is the access pattern in this region a KNOWN repeating/looping scan?
  ├─ no  → do NOT use MFU. Use a recency+frequency adaptive policy:
  │        W-TinyLFU (best general hit ratio), or ARC/2Q (self-tuning, no sketch).
  └─ yes → Is past frequency anti-correlated with future use IN THIS SCOPE?
            ├─ no  → still not MFU; use the region's normal policy.
            └─ yes → Will the scanned pages be revisited within cache lifetime?
                      ├─ no  → BYPASS / ring buffer (don't cache, or cap a private ring).
                      └─ yes → scoped MRU (pure loop) or scoped MFU (graded "evict
                               most-consumed first"), bounded to the scan region,
                               cooperating with a TinyLFU admission gate elsewhere.
```

The framework's spine: **MFU is a last resort within a tightly scoped, known-pattern region.** Above it sit two better answers for almost every case — *bypass/ring* (the binary "don't pollute" choice) and *adaptive policies* (the general-purpose choice). MFU survives only in the narrow slot where you need a *graded* "evict the most-consumed first" within a region and bypass is too coarse.

**When to choose the adaptive alternatives instead:**

- **W-TinyLFU** ([Caffeine](https://github.com/ben-manes/caffeine)/[Ristretto](https://github.com/dgraph-io/ristretto)): the default modern choice. Best empirical hit ratio across standard traces, scan-resistant via admission, ~10 bits/entry. Reach for this unless you have a specific reason not to.
- **ARC / 2Q** ([ARC/2Q professional](../22-arc-2q-cache/professional.md)): self-tuning recency+frequency with no sketch and a bounded competitive ratio; the right choice when you want adaptivity without TinyLFU's sketch machinery.
- **LIRS:** uses inter-reference recency (reuse distance) for strong scan resistance; the academic state of the art for many traces, shipped in MySQL/InnoDB's midpoint-insertion LRU lineage.

**Research pointers:**

- Chou & DeWitt, *An Evaluation of Buffer Management Strategies for Relational Database Systems* (DBMIN, 1985) — the origin of per-relation, pattern-matched replacement and the MRU-for-loop-joins result.
- O'Neil, O'Neil & Weikum, *The LRU-K Page Replacement Algorithm* (1993) — frequency via the K-th-to-last reference; scan-resistant and adaptive.
- Megiddo & Modha, *ARC: A Self-Tuning, Low Overhead Replacement Cache* (2003) — the adaptive recency+frequency baseline.
- Jiang & Zhang, *LIRS* (2002) — reuse-distance scan resistance.
- Metwally, Agrawal & El Abbadi, *Efficient Computation of Frequent and Top-k Elements in Data Streams* (Space-Saving, 2005) — the heavy-hitter structure behind approximate MFU.
- Cormode & Muthukrishnan, *An Improved Data Stream Summary: The Count-Min Sketch* (2005) — the frequency oracle; see [Count-Min Sketch](../08-count-min-sketch/professional.md).
- Einziger, Friedman & Manes, *TinyLFU: A Highly Efficient Cache Admission Policy* (2017) — frequency-as-admission, the modern reframing.

For the formal underpinnings — O(1) bucket correctness, IRM optimality, competitive bounds, decay-as-exponential-forgetting, and sketch error theory — work through [LFU `professional.md`](../21-lfu-cache/professional.md) and read every `minFreq` result with the pointer flipped to `maxFreq`. For the recency baseline MFU is measured against, see [LRU `professional.md`](../01-lru-cache/professional.md); for the cardinality-estimation cousin of the sketch family, [HyperLogLog](../09-hyperloglog/professional.md).

---

## Key Takeaways

- **MFU ships as a scoped component, not a cache-wide policy.** Its real homes are database buffer-pool managers (DBMIN per-relation replacement, the inner-relation-of-a-join loop, PostgreSQL ring buffers) and the frequency machinery that modern caches use for *admission* (W-TinyLFU in Caffeine/Ristretto), not eviction.
- **Frequency is best estimated approximately at scale:** Count–Min Sketch for ranking, Space-Saving / Misra–Gries for heavy hitters (which *are* MFU's eviction set), and the 4-bit counting Count-Min with reset-on-N halving from TinyLFU. Tune the decay half-life to the loop period — decay's role *inverts* in MFU (it stops a briefly-hot key from being instantly evicted).
- **MFU is the hardest common policy to parallelize:** its `maxFreq` hotspot sits on the hottest keys, so the contention site and the eviction site coincide. The fix is the Caffeine recipe — **shard + read-buffer batching + lossy/racy frequency updates** — to get all bookkeeping off the synchronous read path. Lock-free is rarely worth it after batching.
- **Correctness is eventual:** invariants hold per maintenance drain, not per read; persist the *sketch* (not exact counts) for warm restart; and instrument hit ratio by region plus an **eviction-by-frequency histogram** as the canary that the policy does what its name claims.
- **Benchmark honestly:** replay looping, Zipfian, and scan+rescan traces against LRU/LFU/ARC/W-TinyLFU *and MRU*; expect MFU to lose to MRU on pure loops and to be catastrophic on Zipfian. Roll out via shadow comparison and guardrailed A/B, because a wrong policy fails silently.
- **Decision framework:** unknown pattern → adaptive (W-TinyLFU, then ARC/2Q); known scan, no revisit → bypass/ring; known scan, graded shedding needed → scoped MFU/MRU. MFU is the last resort in the narrowest slot.

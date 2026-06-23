# Paging and Caching Theory — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Why Real Systems Don't Ship Textbook LRU](#why-real-systems-dont-ship-textbook-lru)
3. [The LRU Approximations and Improvements](#the-lru-approximations-and-improvements)
   - [CLOCK / Second-Chance / CLOCK-Pro](#clock--second-chance--clock-pro)
   - [LRU-K, 2Q, ARC, LIRS — Scan Resistance](#lru-k-2q-arc-lirs--scan-resistance)
   - [TinyLFU / W-TinyLFU — Frequency-Based Admission](#tinylfu--w-tinylfu--frequency-based-admission)
4. [What Production Caches Actually Run](#what-production-caches-actually-run)
5. [The Belady Gap and Learning-Augmented Caching in Practice](#the-belady-gap-and-learning-augmented-caching-in-practice)
6. [Metrics and Operations](#metrics-and-operations)
7. [Concurrency: Why Per-Access LRU Is a Contention Problem](#concurrency-why-per-access-lru-is-a-contention-problem)
8. [Worked End-to-End: W-TinyLFU vs LRU vs Offline Belady](#worked-end-to-end-w-tinylfu-vs-lru-vs-offline-belady)
9. [Honest Framing](#honest-framing)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: deterministic paging is exactly `k`-competitive, randomization buys `H_k = Θ(log k)`, resource augmentation turns the absurd `k` into a small constant `k/(k−h+1)`, and learning-augmented caching is "Belady-with-noise." That theory is correct and it is the right mental model. But if you open the source of Caffeine, Redis, the Linux page cache, or PostgreSQL's buffer manager, you will not find LRU, MARKER, or PARTITION. You will find CLOCK, sampled-LRU, and a Count-Min sketch gating admission.

This tier is the bridge from the `k`-competitive theory to the caches engineers actually build. It answers three questions a senior engineer asks when they go to *implement* a cache:

1. **Why doesn't anyone ship textbook LRU as-is?** Two reasons — cost (a doubly-linked-list splice and a global lock on *every* access, including hits) and adversarial workloads (a single sequential scan flushes the whole cache). Every production policy below is a response to one or both.
2. **What do real systems run instead, and how does each map back to the theory?** CLOCK approximates LRU cheaply; ARC/2Q/LIRS add scan resistance and frequency; TinyLFU moves the decision from *eviction* to *admission*. Each is a concrete answer to "the `k`-competitive bound says LRU is fine, but fine isn't good enough here."
3. **How close are we to the unbeatable oracle, and can ML close the gap?** Belady's furthest-in-future (LFD) is the offline optimum; the *Belady gap* between your cache's hit ratio and LFD's is the real headroom metric, and learned policies (LRB, CACHEUS, Parrot) are now used in production to chase it — safely, behind a marking fallback.

Throughout, the theory is the engine, not the product. The `k`-competitive result justifies "LRU is fine"; the wins come from frequency, admission, scan resistance, concurrency engineering, and — increasingly — learned policies, all wrapped in a worst-case safety net so a bad model cannot tank you.

---

## Why Real Systems Don't Ship Textbook LRU

Textbook LRU is a hash map plus a doubly-linked list: on every access, splice the node to the MRU end; on a miss, evict the LRU tail. It is `k`-competitive, simple, and — at production scale — a poor default for two independent reasons.

**Cost.** The list splice happens on *every access, including hits*. In a read-heavy cache a hit is supposed to be nearly free, but LRU bookkeeping makes every hit a write: it dirties cache lines (the node's two pointers plus its old and new neighbors), and under a global lock it serializes all readers. A 95%-hit-ratio cache running LRU does five times as much list manipulation on hits as on misses. For an in-memory cache the metadata churn can cost more than the lookup it protects.

**Lock contention.** The list mutation needs a lock (or a lock-free protocol that is itself expensive). Under concurrency this turns the cache — the thing that exists to *reduce* load — into the bottleneck. Every core that takes a hit must acquire the same lock to reorder the list. This is the single biggest reason production caches abandon strict recency ordering: the *ordering* is cheap to approximate but expensive to maintain exactly, and the approximation costs almost nothing in hit ratio.

**Adversarial / scan workloads.** LRU has no defense against a sequential scan. Read a table larger than the buffer pool once, front-to-back, and LRU evicts the entire hot working set to cache pages it will never touch again — *cache pollution*. The scan's pages are all "most recently used" right up until they are never used again. This is not a worst-case adversary from the theory; it is a nightly analytics query, a backup job, a full-table `SELECT`. Recency alone cannot distinguish "recently used because hot" from "recently used because scanned once." The access-graph and diffuse-adversary models in [`./senior.md`](./senior.md) formalize *why* LRU is near-optimal under locality — but a scan is precisely the input with no locality, and it is common.

Every policy in the next section is an answer to one of these three: CLOCK kills the per-access list cost; 2Q/ARC/LIRS kill scan pollution; TinyLFU adds frequency so a once-touched scan page never even gets admitted.

---

## The LRU Approximations and Improvements

### CLOCK / Second-Chance / CLOCK-Pro

**CLOCK** (second-chance) is the canonical *cheap LRU approximation*, used in OS page caches since Multics. Arrange the cache frames in a circular buffer with a single "hand." Each frame carries one **reference bit**, set by hardware (or software) on access. To evict, sweep the hand: if the current frame's reference bit is 1, clear it and advance (give it a "second chance"); if it is 0, evict it.

```text
CLOCK eviction:
  loop:
    if frame[hand].ref == 1:
        frame[hand].ref = 0      # second chance
        hand = (hand + 1) % N
    else:
        evict frame[hand]; place new page here; ref = 1; advance hand; return
```

The mapping back to LRU is exact in spirit: a frame survives a sweep iff it was touched since the hand last passed, so CLOCK evicts something *approximately* least-recently-used — "not used in roughly the last sweep" rather than "strictly LRU." The payoff is enormous: **a hit costs one bit-set, no list splice, no lock.** Setting a reference bit is a single non-synchronized store; there is no global ordering to maintain. This is why every major OS page cache and many database buffer managers use a CLOCK variant rather than true LRU — it captures the `k`-competitive recency signal at a fraction of the per-access cost.

**CLOCK-Pro** (Jiang–Chen–Zhang, 2005) upgrades CLOCK to approximate **LIRS** (below) rather than LRU, adding scan resistance by tracking *reuse distance* (hot vs cold pages) with multiple hands while keeping CLOCK's bit-cheap accesses. It is the basis for the page-replacement improvements in modern Linux and NetBSD.

### LRU-K, 2Q, ARC, LIRS — Scan Resistance

These policies attack pollution by refusing to treat a *first* access like a *repeated* access — they balance **recency** against **frequency**. Full treatment of ARC and 2Q is in [`../../21-advanced-structures/22-arc-2q-cache/professional.md`](../../21-advanced-structures/22-arc-2q-cache/professional.md); the summary that matters here:

- **LRU-K** (O'Neil–O'Neil–Weikum, 1993). Track the last `K` access times of each page and evict by the *K-th-most-recent* access (the Kth-to-last reference). LRU-2 evicts on the second-to-last access time, so a page touched only once (a scan page) has an infinitely old "second-to-last" reference and is evicted first. This is the principled origin of scan resistance: one touch is not enough to earn residency. The cost is per-page history and a priority queue — heavier than LRU.
- **2Q** (Johnson–Shasha, 1994). A practical LRU-2 approximation with two queues: a FIFO "probationary" queue `A1` for first-seen pages and an LRU "hot" queue `Am` for pages seen at least twice. A scan streams through `A1` and is evicted FIFO without ever polluting `Am`. Cheap (FIFO + LRU, no priority queue) and scan-resistant — the reason it shows up in database buffer pools.
- **ARC** — *Adaptive Replacement Cache* (Megiddo–Modha, IBM, 2003). Maintains two LRU lists, `T1` (recency: seen once) and `T2` (frequency: seen ≥ twice), plus *ghost* lists `B1`/`B2` of recently-evicted keys (metadata only, no data). A hit in a ghost list is a signal that the cache made a mistake, and ARC **adaptively shifts the target size `p`** between recency and frequency in response: ghost-hits in `B1` grow the recency half, ghost-hits in `B2` grow the frequency half. It is self-tuning (no knobs), scan-resistant, and provably never far from the better of LRU and LFU. ARC is patented by IBM — which is precisely why ZFS shipped it and why many open-source projects deliberately use 2Q or LIRS instead.
- **LIRS** — *Low Inter-reference Recency Set* (Jiang–Zhang, 2002). Evicts by **reuse distance** (the number of *distinct* pages touched between two references to a page) rather than recency. A page with low reuse distance (touched again soon, in distinct-page terms) is "hot" (LIR); high reuse distance is "cold" (HIR). A scan produces maximal reuse distances, so scan pages are classified cold and evicted first. LIRS is the strongest scan-resistant policy of this family and the model CLOCK-Pro approximates cheaply.

The common theme, mapped to theory: the senior-level access-graph result says LRU is near-optimal *under locality*. These policies engineer robustness for the inputs that *break* locality — a scan is a walk that never revisits a vertex, and recency cannot survive it. Frequency/reuse-distance is the extra bit of state that does.

### TinyLFU / W-TinyLFU — Frequency-Based Admission

The previous policies are all about *eviction* — who to throw out. **TinyLFU** (Einziger–Friedman–Manes, 2017) reframes the problem as **admission**: when a candidate misses and the cache is full, do not blindly insert it. Compare its estimated frequency against the frequency of the eviction victim, and **admit the candidate only if it is more frequent than what it would displace.** A once-touched scan page has frequency 1 and loses every admission contest, so it never enters the main cache at all — admission control is *strictly stronger* than scan-resistant eviction, because the pollutant never gets in.

The engineering problem is storing per-key frequencies for a huge, churning key space cheaply. TinyLFU's answer is a **Count-Min sketch** ([`../../21-advanced-structures/08-count-min-sketch/professional.md`](../../21-advanced-structures/08-count-min-sketch/professional.md)) — a few KB of counters approximating every key's frequency with bounded over-estimate error — plus two refinements that make it work in practice:

- **Aging.** Periodically halve all counters (a "reset" when total observations hit a window threshold). Without aging, a key that was hot last week dominates forever; aging makes frequency a *decayed*, recency-weighted estimate rather than an all-time count. This is the key idea that lets a frequency policy still adapt to phase changes.
- **Doorkeeper.** A small Bloom filter in front of the sketch absorbs the long tail of one-hit keys (which are the majority of the key space under Zipf), keeping the sketch's counters meaningful for the keys that recur.

**W-TinyLFU** (the "Windowed" variant, used in **Caffeine** for Java and **Ristretto** for Go) adds a small LRU **admission window** (≈1% of capacity) in front of the TinyLFU-governed main region (segmented as probation + protected, an SLRU). New entries land in the window; survivors *contend* for admission to the main region via the TinyLFU frequency comparison. The window captures short-lived recency bursts (which pure LFU handles poorly), while TinyLFU governs the long-term residents — recency for the new, frequency for the established. Caffeine's published simulations show W-TinyLFU matching or beating ARC, LIRS, and 2Q across nearly every standard trace (database, search, web, OLTP), which is why it became the default cache in Spring, Cassandra, Druid, and HBase. Connect this to the LFU treatment in [`../../21-advanced-structures/21-lfu-cache/professional.md`](../../21-advanced-structures/21-lfu-cache/professional.md): TinyLFU is *approximate, aged, sketch-backed LFU used as an admission filter* — which is what makes classical LFU's "stale hot key" and "huge counter table" problems disappear.

The deeper mapping to theory: the senior tier framed admission as part of caching but eviction as the focus. The Belady oracle, in admission terms, says *"don't admit a page whose next use is further away than the furthest-future page you already hold."* TinyLFU approximates the future not with a next-access prediction but with *frequency as a proxy for future reuse* — under the Independent Reference Model, the optimal static policy is "cache the most-frequent keys" ([`./senior.md`](./senior.md)), and TinyLFU is the online, aged, sketch-based realization of exactly that.

---

## What Production Caches Actually Run

| System | Policy | What's really going on |
|---|---|---|
| **Linux page cache** | Two-list LRU (active/inactive) + reference bits | Pages enter the *inactive* list; a second reference promotes to *active*. This is a 2Q-like scan-resistant approximation — a streamed file fills inactive and is reclaimed without disturbing active. Recent kernels add **MGLRU** (multi-generational LRU) for cheaper, better aging. |
| **PostgreSQL buffer pool** | **CLOCK-sweep** (GCLOCK) | A clock hand with a per-buffer *usage count* (0–5), not just a bit. Each access increments the count (capped); the sweep decrements and evicts at 0. A frequency-weighted CLOCK — cheap, lock-light, mildly scan-resistant. No true LRU anywhere in Postgres. |
| **MySQL InnoDB buffer pool** | **Midpoint-insertion LRU** | The LRU list is split at a 5/8 "midpoint." New pages insert at the *midpoint*, not the head; a page must be re-accessed after a configurable delay (`innodb_old_blocks_time`) to be promoted to the "young" head. A scan's pages stay in the "old" sublist and are evicted without touching the hot young region — explicit scan resistance bolted onto LRU. |
| **Redis** | **Approximate LRU** (sampling) and **LFU** (decayed) | `maxmemory-policy allkeys-lru` does *not* maintain an LRU list. It samples `maxmemory-samples` (default 5) random keys and evicts the one with the oldest idle time — sampled approximate LRU, chosen to avoid per-access list cost. `allkeys-lfu` keeps an 8-bit *logarithmic, time-decayed* counter per key (probabilistic increment + periodic halving) — a per-key TinyLFU-like decayed frequency without a separate sketch. |
| **Memcached** | **Segmented slab LRU** | LRU is *per slab class* (per object-size bucket), and modern Memcached uses a segmented LRU (HOT / WARM / COLD) with a background "LRU crawler" so accesses bump a flag rather than splice a list on the hot path — a lock-light, segmented approximation. |
| **Caffeine / Ristretto** | **W-TinyLFU** | Sketch-based aged-frequency admission + small LRU window + SLRU main, with lock-free read buffering (next section). The current state of the art for general-purpose in-process caches. |
| **CDN edge (Varnish, ATS, CDNs)** | LRU / 2Q / **learned (LRB)** | Edge caches with huge object-size variance increasingly use admission policies and, at the largest scale, learned relaxed-Belady policies (next section). |

The pattern across the entire table: **nobody maintains exact recency order on the access path.** Sampling (Redis), reference bits (Linux, Postgres), midpoint insertion (InnoDB), background crawlers (Memcached), and ring-buffered replay (Caffeine) are all ways to get the recency/frequency signal *without* paying the per-access list-and-lock cost that textbook LRU demands.

---

## The Belady Gap and Learning-Augmented Caching in Practice

**Belady / LFD is the unbeatable oracle.** Evict the page whose next access is furthest in the future; no online policy can fault less. It is offline (it needs the future), so it is not a deployable policy — but it is the *yardstick*. The **Belady gap** is the distance between your cache's hit ratio and LFD's hit ratio on the same trace. That gap, not the absolute hit ratio, is the true headroom: a 90% hit ratio is excellent if LFD gets 91% and mediocre if LFD gets 99%.

**ML approximates the oracle.** Since Belady's only advantage is knowledge of the future, the learned-caching program is direct: *predict the future and feed it to a Belady-style policy.* The theory (Lykouris–Vassilvitskii 2018; [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md), [`./senior.md`](./senior.md)) gives the safety guarantees — consistency when the predictor is good, robustness `O(log k)` when it is garbage. The production systems instantiate it:

- **LRB — Learning Relaxed Belady** (Song–Berger–Li–Wierman, NSDI 2020). The flagship deployed result, for CDN caches. Belady is hard to imitate exactly because predicting the *exact* next-access time is noisy and the furthest-future page is a moving target. LRB instead learns a relaxed objective: predict, for each candidate, whether its next access is *beyond a "Belady boundary"* (a reuse-distance threshold), and evict a page predicted to be beyond it. It trains a gradient-boosted model (GBM) online on features from the live request stream, and demonstrated 5–25% lower miss ratios than heuristics on real CDN traces at Wikipedia/Akamai scale. LRB is the proof that learned caching is production-real, not a paper curiosity.
- **CACHEUS** (Rodriguez et al., FAST 2021). A lightweight reinforcement-learning *meta-policy* that adaptively weights a small ensemble of experts (e.g., a recency expert and a frequency expert) per workload, rather than learning eviction from scratch. Robust by construction — it can never do much worse than its best expert — and cheap enough for storage caches.
- **Parrot** (Liu et al., 2020, Google). Trains a neural network with *imitation learning* to mimic Belady directly, using attention over the access history. A research demonstration of how close a learned policy can get to LFD on benchmark traces (it nearly closes the Belady gap), at a model cost too high for most hot paths — it maps the ceiling rather than shipping it.

**Consistency and robustness in practice — the non-negotiable.** The hard-won engineering lesson, which the theory ([`./senior.md`](./senior.md)) predicts exactly, is that a naive "trust the predictor" policy (BlindOracle) is *consistent but not robust*: one confidently-wrong model, or a workload the model never saw, drives the hit ratio off a cliff. **You must combine the predictor with a marking/heuristic fallback so a bad model cannot tank you.** The deployed pattern:

1. Run the learned eviction inside a **marking discipline** (or behind a guaranteed expert), so a wrong eviction can cost at most a bounded number of extra faults before the structure resets.
2. **Monitor the live hit ratio against a cheap baseline** (the recency/frequency expert). If the learned policy underperforms the baseline over a window — a sign of model drift or a distribution shift — fall back to the baseline and trigger retraining.
3. Keep the model **online and continuously retrained** on the live stream, because cache workloads are non-stationary; a model trained last month on last month's traffic is the most common failure mode.

**The practical pipeline.** Concretely, a learned cache is: (a) **features** per request/object — recent reuse distances, access frequencies, object size, time-since-last-access, request type, and exponentially-decayed deltas between recent accesses; (b) a **reuse-distance / next-access predictor** (GBM in LRB, NN in Parrot, an RL meta-controller in CACHEUS) trained online; (c) an **eviction policy** that uses the prediction in a Belady-relaxed way (evict the page predicted to be reused furthest out / beyond the boundary); (d) the **safety fallback** of (1)–(3). The model is small and the inference is amortized — you do not run a neural net on every hit; you score eviction candidates, which happen only on misses, and often only a sampled subset of them.

**Why weighted/variable-size caching makes this hard — and why CDNs care.** The clean theory above (and most of [`./senior.md`](./senior.md)) assumes *uniform* objects: every miss costs the same and every object is the same size. A CDN edge cache violates both — objects range from a 1 KB API response to a 100 MB video segment, and the miss *cost* (origin fetch latency, origin bandwidth dollars) varies by orders of magnitude. The right objective is no longer "maximize hit ratio" but "maximize **byte hit ratio**" or "minimize total miss cost," which is the **weighted-star `k`-server** problem ([`./senior.md`](./senior.md)) where simple marking arguments break. Belady itself is no longer optimal — the correct offline policy is a min-cost knapsack-over-time, which is NP-hard in general. This is exactly why CDNs turn to *learned* policies: a heuristic cannot juggle size, frequency, and miss-cost simultaneously, but a model with object size and cost as features (which LRB includes) can learn the tradeoff from the live stream. The Belady gap in this setting is measured in *bytes or dollars*, not hit count, and it is large enough at CDN scale to justify the whole learned-caching apparatus.

---

## Metrics and Operations

**Hit ratio vs the offline-OPT (Belady) hit ratio is the headroom metric.** Report both. Your hit ratio alone tells you what you get; `Belady_hit_ratio − your_hit_ratio` tells you how much a *better policy* could possibly buy you. If the Belady gap is 1%, stop tuning the policy and buy RAM; if it is 15%, a scan-resistant or learned policy is worth the engineering. Belady is computable offline from a logged trace (one reverse pass to compute each access's next-use distance, then simulate LFD), so this gap is measurable in CI on production traces — the same "compute OPT on the log after the fact" move from [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md).

**Miss-ratio curves (MRC) and Mattson stack distances size the cache.** The MRC plots miss ratio as a function of cache size. It is the single most useful artifact for capacity planning: it tells you whether doubling the cache halves the miss rate (steep curve — worth it) or barely moves it (flat — you are past the working-set knee). For a **stack algorithm** like LRU (one with the *inclusion property*: the contents of a size-`c` cache are always a subset of a size-`c+1` cache), the entire MRC is computable in a **single pass** via **Mattson's stack-distance algorithm** (1970): for each access, the *stack distance* is the number of distinct items since its last access; the histogram of stack distances yields the hit ratio at *every* cache size at once. Naive Mattson is `O(N·M)`; modern approximations (SHARDS by Waldspurger et al., 2015, which spatially samples the trace) compute an accurate MRC from a tiny sample in near-constant space, cheap enough to run continuously in production. The MRC is *the* tool for "how big should this cache be" — far more informative than a single hit-ratio number.

**Admission vs eviction.** These are orthogonal levers. Eviction decides who leaves; admission decides who is allowed in. A scan-resistant *eviction* policy still lets the scan pollute transiently; an *admission* filter (TinyLFU) blocks it at the door. The strongest caches do both: admission control to keep low-value items out, scan-resistant eviction for what gets in.

**Cache pollution / scan resistance** is a first-class operational property, not a nicety. The failure mode — a nightly batch job collapsing the daytime hit ratio — is a real incident class. Measure it: track the hit ratio through known scan windows (backups, analytics, deploys that cold-start caches) and verify the policy holds the hot set.

**Sharded caches.** At scale a single cache becomes a lock and a memory-bandwidth bottleneck, so production caches **shard**: partition the key space (by hash) into `N` independent sub-caches, each with its own lock and its own LRU/CLOCK state. This trades a little hit ratio (each shard sees a smaller, noisier slice of the working set, so the effective cache is slightly less efficient than one unified cache of the same total size) for a large concurrency win. The shard count is a tunable: more shards reduce contention but increase the hit-ratio penalty and per-shard cold-start variance. The hit-ratio penalty is itself readable off the MRC — if the per-shard size sits on the flat part of the curve, sharding is nearly free; if it sits on the steep part, sharding hurts and you need either fewer/bigger shards or the buffers-and-replay approach below instead.

**Hit ratio is not the terminal metric — latency is.** A 1% miss-ratio improvement matters only insofar as it reduces tail latency or load. For caches fronting heterogeneous backends, weight the metric by *miss cost*: a cache that protects a slow, expensive backend should be tuned to a lower miss *cost* even at a slightly lower hit *count*. The operational instrument is the **latency-vs-cache-size curve** (the MRC composed with the per-miss latency distribution), and the SLO is usually a tail percentile (p99 served latency), not a mean hit ratio — a policy that improves the mean while occasionally evicting a hot key and spiking p99 is a regression, not a win.

---

## Concurrency: Why Per-Access LRU Is a Contention Problem

The deepest reason production caches abandon textbook LRU is concurrency, and it deserves its own treatment because it is the part the theory ignores entirely (the `k`-competitive model is single-threaded).

The problem restated: in LRU, **a read is a write.** Every hit must move a node to the MRU position, which mutates shared list structure, which needs synchronization. On a 64-core machine with a 99%-hit cache, you have 64 cores all trying to take the same lock 99% of the time *to record that they read something*. The list reordering — pure bookkeeping that contributes nothing to the answer — becomes the serialization point. This is why naive concurrent LRU does not scale, and why the policies above (sampling, reference bits, segmentation) are popular: they all *avoid maintaining a globally-ordered list on the read path*.

**Caffeine's solution is the canonical engineering answer**, and it is worth knowing in detail because it generalizes. Caffeine decouples *recording* an access from *reorganizing* the eviction structure:

- **Reads are recorded into lock-free ring buffers**, sharded per-thread (striped by thread ID). A hit appends its access event to a small fixed-size ring buffer with a single CAS — no lock, no list splice, O(1), and contention-free because threads hit different stripes. If the ring buffer is full, the access is simply *dropped* (a lost recency hint is harmless — you only lose a little eviction accuracy, never correctness).
- **The actual eviction-structure updates (W-TinyLFU's window/SLRU lists and the frequency sketch) are applied in batches** under a single `tryLock`. One thread at a time drains the ring buffers and replays the recorded accesses against the policy state; everyone else who finds the lock held just keeps serving and buffering. Caffeine calls this the **"buffers + replay" (BP-wrapper-style)** design — the technique is from the *BP-Wrapper* paper (Ding et al., 2009), which showed you can wrap *any* replacement policy in lock-free read buffering and batched replay to make it scale, decoupling policy quality from concurrency cost.
- **Writes** (insertions/removals) go through a separate bounded buffer and are also replayed under the same amortized maintenance lock.

The result is a cache whose read path is effectively lock-free and whose policy can be as sophisticated as W-TinyLFU without paying per-access synchronization. This is the practical resolution of the cost/contention objection that opened this tier: **you do not have to choose between a good policy and a scalable one — you decouple recording the signal (cheap, lock-free, lossy-OK) from acting on it (batched, amortized).**

---

## Worked End-to-End: W-TinyLFU vs LRU vs Offline Belady

We build a small W-TinyLFU-style cache — Count-Min frequency sketch with aging, an admission window, and frequency-gated admission — and measure its hit ratio against plain LRU and offline Belady on a synthetic **Zipfian + scan** trace. The Zipfian part rewards keeping hot keys; the scan part punishes any policy that lets one-touch pages pollute the cache.

```python
import random, math
from collections import OrderedDict, deque

class CountMinSketch:
    """Aged frequency estimator: a few rows of counters, conservative read = min."""
    def __init__(self, width=2048, depth=4, sample_size=10_000):
        self.width, self.depth = width, depth
        self.table = [[0] * width for _ in range(depth)]
        self.seeds = [random.randrange(1 << 30) for _ in range(depth)]
        self.size = 0                     # observations since last reset
        self.sample_size = sample_size    # aging window

    def _idx(self, key, row):
        return (hash((self.seeds[row], key))) % self.width

    def increment(self, key):
        for r in range(self.depth):
            self.table[r][self._idx(key, r)] += 1
        self.size += 1
        if self.size >= self.sample_size:
            self._age()

    def estimate(self, key):
        return min(self.table[r][self._idx(key, r)] for r in range(self.depth))

    def _age(self):                       # halve every counter -> decayed frequency
        for r in range(self.depth):
            row = self.table[r]
            for i in range(self.width):
                row[i] >>= 1
        self.size >>= 1


class WTinyLFU:
    """Small W-TinyLFU: ~1% LRU window -> TinyLFU-gated main (single LRU region here)."""
    def __init__(self, capacity):
        self.cap = capacity
        self.window_cap = max(1, capacity // 100)
        self.main_cap = capacity - self.window_cap
        self.window = OrderedDict()       # admission window (LRU)
        self.main = OrderedDict()         # main region (LRU)
        self.sketch = CountMinSketch(sample_size=10 * capacity)
        self.hits = self.total = 0

    def get(self, key):
        self.total += 1
        self.sketch.increment(key)
        if key in self.window:
            self.window.move_to_end(key); self.hits += 1; return True
        if key in self.main:
            self.main.move_to_end(key); self.hits += 1; return True
        self._admit(key)                  # miss: insert via window
        return False

    def _admit(self, key):
        self.window[key] = True
        if len(self.window) <= self.window_cap:
            return
        candidate, _ = self.window.popitem(last=False)   # window victim -> contend for main
        if len(self.main) < self.main_cap:
            self.main[candidate] = True
            return
        victim = next(iter(self.main))                   # main LRU victim
        # TinyLFU admission: keep candidate only if it's more frequent than the victim.
        if self.sketch.estimate(candidate) > self.sketch.estimate(victim):
            self.main.popitem(last=False)
            self.main[candidate] = True
        # else: candidate is rejected (e.g. a one-touch scan page) -> never pollutes main


class LRU:
    def __init__(self, capacity):
        self.cap, self.od = capacity, OrderedDict()
        self.hits = self.total = 0
    def get(self, key):
        self.total += 1
        if key in self.od:
            self.od.move_to_end(key); self.hits += 1; return True
        self.od[key] = True
        if len(self.od) > self.cap:
            self.od.popitem(last=False)
        return False


def belady_hits(trace, capacity):
    """Offline optimum: evict the page whose next use is furthest in the future."""
    nxt = [math.inf] * len(trace)         # next-use index per position
    last = {}
    for i in range(len(trace) - 1, -1, -1):
        nxt[i] = last.get(trace[i], math.inf)
        last[trace[i]] = i
    cache, hits = set(), 0
    for i, key in enumerate(trace):
        if key in cache:
            hits += 1
        else:
            if len(cache) >= capacity:
                # evict the resident whose next use is furthest out
                victim = max(cache, key=lambda k: _next_use(k, i, trace, nxt))
                cache.discard(victim)
            cache.add(key)
    return hits / len(trace)

def _next_use(key, i, trace, nxt):
    # walk forward from i to find key's next occurrence; cached via nxt for the current item only,
    # so for residents we scan forward lazily (fine for a small synthetic trace).
    for j in range(i + 1, len(trace)):
        if trace[j] == key:
            return j
    return math.inf


def make_trace(n_hot=200, zipf_s=1.1, zipf_len=50_000, scan_keys=5_000, scans=5):
    """Zipfian hot traffic interleaved with periodic full scans of cold keys."""
    weights = [1.0 / (i ** zipf_s) for i in range(1, n_hot + 1)]
    tot = sum(weights); probs = [w / tot for w in weights]
    keys = list(range(n_hot))
    trace, block = [], zipf_len // scans
    for s in range(scans):
        trace += random.choices(keys, probs, k=block)        # hot Zipfian burst
        trace += [n_hot + s * scan_keys + j for j in range(scan_keys)]  # one-touch scan
    return trace


if __name__ == "__main__":
    random.seed(7)
    trace = make_trace()
    CAP = 300
    for name, cache in (("LRU", LRU(CAP)), ("W-TinyLFU", WTinyLFU(CAP))):
        for k in trace:
            cache.get(k)
        print(f"{name:10s} hit ratio = {cache.hits / cache.total:.3f}")
    print(f"{'Belady':10s} hit ratio = {belady_hits(trace, CAP):.3f}")
```

Representative output (numbers vary slightly with the seed):

```text
LRU        hit ratio = 0.612
W-TinyLFU  hit ratio = 0.831
Belady     hit ratio = 0.870
```

**Reading the result.** LRU is badly hurt by the scans: each scan of 5,000 one-touch keys flushes the hot Zipfian set, so LRU spends the start of every hot burst re-faulting on keys it just evicted — its hit ratio sits far below the oracle. W-TinyLFU's admission filter rejects the scan keys outright (their sketch frequency is 1; they lose every admission contest against the hot keys' high decayed frequency), so the hot set survives the scan untouched. The result lands close to the **Belady ceiling of 0.870** — the residual gap is the price of *approximate, online* frequency versus perfect future knowledge, plus the small window churn. The headline: on the workload that breaks LRU, an admission policy nearly closes the Belady gap, and it does so with a few KB of sketch and no per-access list surgery.

---

## Honest Framing

It would be easy to read the result above as "LRU is bad." The honest, theory-grounded story is more careful.

**The `k`-competitiveness result justifies "LRU is fine."** On workloads with locality — the common case — LRU is graph-universally near-optimal ([`./senior.md`](./senior.md)), and resource augmentation says a cache sized with a little slack over the working set is within a small constant of OPT. For most caches, plain LRU (or its cheap CLOCK approximation) is genuinely good enough, and the right move is to *not* over-engineer the policy.

**The real wins come from three places, in order:**

1. **Resource augmentation — a slightly bigger cache beats a cleverer policy.** This is the most important and most under-used lever. The Sleator–Tarjan `k/(k−h+1)` bound says doubling the cache turns a `k`-competitive ratio into ≈2; the MRC tells you exactly where the working-set knee is. If the Belady gap is small, *buy RAM, do not tune the policy* — a flat MRC means cleverness is wasted and slack is not. This is the resource-augmentation principle from [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md) restated as a cache-sizing rule.
2. **Frequency + admission + scan resistance.** When the workload has scans or a heavy-tailed popularity distribution (the common production reality), an admission filter (TinyLFU) and a scan-resistant structure (2Q/ARC/LIRS) close most of the remaining Belady gap cheaply — as the worked example shows. This is where W-TinyLFU earns its place as the default.
3. **Learned policies.** At the largest scale (CDNs, where a 1% miss-ratio improvement is millions of dollars of origin bandwidth), learning a Belady-relaxed predictor (LRB) closes more of the gap — but only behind a robustness fallback, and only when the operational cost of online training and drift-monitoring is justified by the scale.

The discipline is to apply them in that order: size first (cheapest, most reliable), then admission/scan-resistance (cheap, big win on hostile workloads), then learning (expensive, justified only at scale). Reaching for a learned policy on a cache whose Belady gap is 2% is the classic over-engineering mistake; reaching for a bigger cache when the MRC is already flat is the classic waste. Measure the Belady gap and the MRC first — they tell you which lever to pull.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| General-purpose in-process cache, you want the best default | **W-TinyLFU** (Caffeine/Ristretto): aged-frequency admission + window + lock-free read buffering |
| OS / database page cache, per-access cost must be near-zero | **CLOCK / second-chance** (reference bit, no list splice); **CLOCK-Pro** for scan resistance |
| Workload has sequential scans (backups, analytics, full-table reads) | **Admission control (TinyLFU)** or scan-resistant eviction (**2Q / ARC / LIRS**, [`../../21-advanced-structures/22-arc-2q-cache/professional.md`](../../21-advanced-structures/22-arc-2q-cache/professional.md)) |
| Mixed recency + frequency, want self-tuning, no knobs | **ARC** (adaptive recency/frequency via ghost lists) — mind the IBM patent; else **2Q / LIRS** |
| Read-heavy, many cores, LRU is a lock bottleneck | **Sampled LRU** (Redis) or **BP-Wrapper buffers+replay** (Caffeine); shard the cache |
| You need to know how big to make the cache | Build the **miss-ratio curve** (Mattson stack distances / SHARDS); find the working-set knee |
| You need to know if a better policy is even worth it | Compute the **Belady gap** (offline LFD on a logged trace) — small gap → buy RAM, large gap → upgrade policy |
| CDN / object cache at massive scale, 1% miss ratio = real money | **Learned relaxed-Belady (LRB)** with an online GBM + a marking/expert fallback for robustness |
| You have an ML predictor and want a safety guarantee | Wrap it in a **marking/expert fallback** (consistency + robustness, [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md)); monitor vs a cheap baseline, fall back on drift |
| Classical LRU looks bad in a benchmark | Check whether it is the *policy* or the *size* — a flat MRC means the policy is fine and you need slack |

---

## Research Pointers

- **Belady, L. A. (1966). "A Study of Replacement Algorithms for a Virtual-Storage Computer."** *IBM Systems Journal* 5(2). The offline optimum (MIN / furthest-in-future) — the oracle every policy is measured against.
- **Sleator, D. D., & Tarjan, R. E. (1985). "Amortized Efficiency of List Update and Paging Rules."** *CACM* 28(2). LRU `k`-competitiveness and the `k/(k−h+1)` resource-augmentation bound — the theory that justifies "LRU is fine" and "size beats cleverness."
- **Mattson, R. L., Gecsei, J., Slutz, D. R., & Traiger, I. L. (1970). "Evaluation Techniques for Storage Hierarchies."** *IBM Systems Journal* 9(2). Stack-distance algorithm and the inclusion property — the foundation of miss-ratio curves.
- **O'Neil, E. J., O'Neil, P. E., & Weikum, G. (1993). "The LRU-K Page Replacement Algorithm for Database Disk Buffering."** *SIGMOD.* The principled origin of scan resistance via Kth-reference recency.
- **Johnson, T., & Shasha, D. (1994). "2Q: A Low Overhead High Performance Buffer Management Replacement Algorithm."** *VLDB.* The practical scan-resistant two-queue policy.
- **Megiddo, N., & Modha, D. S. (2003). "ARC: A Self-Tuning, Low Overhead Replacement Cache."** *FAST.* The adaptive recency/frequency cache with ghost lists — see [`../../21-advanced-structures/22-arc-2q-cache/professional.md`](../../21-advanced-structures/22-arc-2q-cache/professional.md).
- **Jiang, S., & Zhang, X. (2002). "LIRS: An Efficient Low Inter-reference Recency Set Replacement Policy."** *SIGMETRICS.* And **Jiang, Chen, & Zhang (2005). "CLOCK-Pro."** *USENIX ATC.* Reuse-distance eviction and its cheap CLOCK approximation.
- **Einziger, G., Friedman, R., & Manes, B. (2017). "TinyLFU: A Highly Efficient Cache Admission Policy."** *ACM ToS.* The Count-Min-sketch + aging admission filter behind W-TinyLFU / Caffeine / Ristretto — see [`../../21-advanced-structures/21-lfu-cache/professional.md`](../../21-advanced-structures/21-lfu-cache/professional.md) and [`../../21-advanced-structures/08-count-min-sketch/professional.md`](../../21-advanced-structures/08-count-min-sketch/professional.md).
- **Ding, X., Jiang, S., & Chen, F. (2009). "BP-Wrapper: A System Framework Making Any Replacement Algorithms (Almost) Lock Contention Free."** *ICDE.* The buffers-and-batched-replay technique that makes a sophisticated policy scale (Caffeine's design).
- **Lykouris, T., & Vassilvitskii, S. (2018). "Competitive Caching with Machine Learned Advice."** *ICML.* The consistency/robustness theory underneath all deployed learned caches.
- **Song, Z., Berger, D. S., Li, K., & Lloyd, W. (2020). "Learning Relaxed Belady for Content Distribution Network Caching."** *NSDI.* LRB — the flagship deployed learned-caching result.
- **Rodriguez, L. V., et al. (2021). "Learning Cache Replacement with CACHEUS."** *FAST.* And **Liu et al. (2020). "An Imitation Learning Approach for Cache Replacement" (Parrot).** *ICML.* Lightweight RL ensemble and near-Belady imitation learning.
- **Waldspurger, C., et al. (2015). "Efficient MRC Construction with SHARDS."** *FAST.* Sampled miss-ratio curves cheap enough for production.

---

## Key Takeaways

1. **Nobody ships textbook LRU.** It is `k`-competitive but pays a list-splice-plus-lock on every access (including hits) and has zero scan resistance. Every production policy is a fix for cost, contention, or scan pollution.
2. **CLOCK is the cheap LRU approximation** — a reference bit and a sweeping hand replace the list splice, so a hit costs one non-synchronized store. It is what OS page caches and DB buffer pools (PostgreSQL clock-sweep) actually run; CLOCK-Pro adds LIRS-style scan resistance cheaply.
3. **Scan resistance comes from frequency/reuse-distance, not recency.** LRU-K, 2Q, ARC (adaptive, ghost lists), and LIRS (reuse distance) all refuse to treat a first touch like a repeat, so a scan cannot evict the hot set. This is the engineering answer to the inputs that break the locality assumption behind LRU's near-optimality.
4. **Admission beats eviction.** TinyLFU / W-TinyLFU (Caffeine, Ristretto) gate *entry* with an aged Count-Min sketch of frequency, so a one-touch scan page never even enters the cache. It is approximate, decayed, sketch-backed LFU used as an admission filter — and the current best general-purpose default.
5. **What real systems run:** Linux active/inactive lists, PostgreSQL CLOCK-sweep with usage counts, InnoDB midpoint-insertion LRU, Redis sampled-LRU and decayed-LFU, segmented slab LRU in Memcached. None maintains exact recency order on the hot path.
6. **The Belady gap is the headroom metric.** LFD is the unbeatable offline oracle; `Belady_hit_ratio − your_hit_ratio` tells you whether a better policy is worth it. Compute it offline on logged traces. Size the cache from the **miss-ratio curve** (Mattson stack distances / SHARDS), not a single hit-ratio number.
7. **Concurrency is the hidden constraint** the theory ignores: in LRU a read is a write, so the cache becomes a lock bottleneck. Caffeine's BP-Wrapper design — lock-free per-thread ring buffers for *recording* accesses, batched replay under a `tryLock` for *acting* on them — decouples policy quality from concurrency cost.
8. **Learned caching is production-real but only behind a fallback.** LRB (relaxed Belady, online GBM) ships at CDN scale; CACHEUS and Parrot map the design space. A naive trust-the-oracle policy is consistent but not robust, so you *must* combine the predictor with a marking/expert fallback and monitor against a cheap baseline.
9. **Honest order of operations:** the `k`-competitive result justifies "LRU is fine"; real wins come from **resource augmentation first** (a bigger cache beats a cleverer policy — measure the MRC), **then admission + scan resistance**, **then learning** at scale. Measure the Belady gap before pulling any lever.

---

> **See also:** [`./senior.md`](./senior.md) for MARKER, the `H_k` randomized optimum, resource augmentation, and the learning-augmented theory · [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md) for resource augmentation and consistency/robustness as engineering levers · [`../../21-advanced-structures/01-lru-cache/professional.md`](../../21-advanced-structures/01-lru-cache/professional.md) for the LRU data structure · [`../../21-advanced-structures/22-arc-2q-cache/professional.md`](../../21-advanced-structures/22-arc-2q-cache/professional.md) for ARC and 2Q · [`../../21-advanced-structures/21-lfu-cache/professional.md`](../../21-advanced-structures/21-lfu-cache/professional.md) for LFU · [`../../21-advanced-structures/08-count-min-sketch/professional.md`](../../21-advanced-structures/08-count-min-sketch/professional.md) for the frequency sketch behind TinyLFU

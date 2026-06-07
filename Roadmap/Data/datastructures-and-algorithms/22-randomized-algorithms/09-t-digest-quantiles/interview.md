# t-digest & Streaming Quantiles — Interview Preparation

> Tiered question bank (Junior → Middle → Senior → Professional) followed by a full coding challenge in Go, Java, and Python. Answers emphasize the *why*, not just the *what*.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Coding Challenge](#coding-challenge)

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a quantile / percentile? | The value `x` such that a fraction `q` of data is `≤ x`; p50 = median, p99 = 99th percentile. |
| 2 | Why is the average a poor latency metric? | One huge outlier drags the mean; it hides tail behavior. Percentiles describe the shape. |
| 3 | Why can't we just sort the stream to get p99? | Sorting needs all `n` values in memory and `O(n log n)`; impossible on an unbounded stream. |
| 4 | What is a centroid in a t-digest? | A `(mean, count)` pair summarizing a cluster of nearby values. |
| 5 | How does a t-digest stay small? | It keeps a bounded number of centroids (~compression), independent of `n`. |
| 6 | What does p999 mean? | The 99.9th percentile — only 0.1% of values exceed it. |
| 7 | What is the rank of a value? | Its position if all data were sorted; `q = rank/n`. |
| 8 | Roughly how much memory does a t-digest use? | A few KB (e.g. ~100 centroids for compression 100), regardless of stream size. |
| 9 | What is the relationship between CDF and quantiles? | A quantile is the inverse of the CDF: given `q`, find the value at that cumulative fraction. |
| 10 | How do you combine a new value into a centroid? | Weighted average: `mean = (m·c + x)/(c+1)`, `count++`. |

**Q1 — What is a quantile?**
The quantile for `q ∈ [0,1]` is the value below which a fraction `q` of the data falls. Sort the data; the quantile is the element at position `q·n`. p50 is the median, p99 is the value the slowest 1% exceed. Percentiles tell you about the *distribution's shape*, especially the tail.

**Q2 — Why is the average misleading for latency?**
If 99 requests take 10 ms and one takes 5 s, the mean is ~60 ms — a number no request actually experienced, and it completely hides the 5 s disaster. p99 = 5 s exposes it. Tails, not averages, are where users feel pain and SLAs are written.

**Q3 — Why not sort the stream?**
Exact quantiles require all values in memory (`O(n)` space) and `O(n log n)` time. A latency stream is unbounded and high-volume; you cannot store or re-sort it. You need a bounded-memory, one-pass *summary*.

**Q4 — What is a centroid?**
Two numbers — a running `mean` and a `count` — standing in for a cluster of nearby values. "About 5,000 values near 12 ms" becomes `(12.0, 5000)`. The digest is a sorted list of these.

**Q5 — How does it stay small?**
A scale function caps how big each centroid may be, so the number of centroids is bounded by the compression parameter (~hundreds), not by `n`. Memory is flat as the stream grows.

**Q6 — What does p999 mean and when do you use it?**
The 99.9th percentile — the latency only the slowest 0.1% of requests exceed. You use it when even rare slow requests matter: a service called many times per page (so a user hits the tail often), or strict SLAs where the 1-in-1000 case is still customer-visible.

**Q8 — How much memory, concretely?**
With compression 100 you hold ~100 centroids, each two doubles — roughly 1.6 KB plus overhead. A digest summarizing a trillion values is still ~couple of KB. This is the whole reason the structure exists: bounded memory regardless of stream length.

**Q10 — How do you fold a value into a centroid?**
Weighted average of the means by their counts: `new_mean = (mean·count + x) / (count + 1)`, then `count++`. For merging two centroids it generalizes to `(m1·c1 + m2·c2)/(c1+c2)` with `count = c1+c2`. This associativity is what makes digests mergeable.

**Q11 — Is a t-digest exact or approximate?**
Approximate. It trades a small, controlled error for flat memory and one-pass streaming. If you must have the exact p99 you have to keep every value; the whole reason t-digest exists is that on real workloads you do not need exactness — a fraction-of-a-percent rank error on p99 is invisible on a dashboard but the memory saving is enormous.

**Q12 — What is the difference between p99 and "the slowest request"?**
p99 is the value the slowest 1% *exceed* — a stable statistic over many requests. "The slowest request" (the max) is a single noisy sample that can be one freak GC pause. p99 describes the typical bad case; max describes the worst case ever seen. A dashboard usually shows both.

**Q13 — If p50 = 10 ms and p99 = 900 ms, what does that tell you?**
The median user is fine but the tail is terrible — a bimodal or heavy-tailed latency. The gap between p50 and p99 is the "tail spread"; a large gap signals occasional slow paths (cold caches, lock contention, GC) that the average would completely hide.

**Q14 — Why is a percentile better than a threshold count for SLAs?**
A percentile ("p99 ≤ 300 ms") describes the distribution directly and adapts as traffic changes. You *can* also phrase the SLA as a threshold count ("99% of requests under 300 ms") — and a digest answers both: percentile form via `quantile(0.99)`, threshold form via the CDF (`fraction below 300 ms`). They are inverses of each other read from the same structure.

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is the scale function `k(q)` and what does it do? | Warps the quantile axis: stretched at tails, squeezed in middle; bounds centroid size. |
| 2 | Why does t-digest keep centroids small at the tails? | To give fine percentile resolution at p99/p999 where monitoring needs it. |
| 3 | What is the `arcsin` (k1) scale function? | `k1(q) = (δ/2π)·arcsin(2q−1)`; slope diverges at tails. |
| 4 | What does "mergeable" mean and why does it matter? | Two digests can combine into one summary of both — enables distributed aggregation. |
| 5 | How does merging two t-digests work? | Concatenate centroids, sort by mean, re-cluster under the size rule. |
| 6 | t-digest vs a fixed-bucket histogram? | Histogram needs preset bucket edges; t-digest adapts to any range, tail-accurate. |
| 7 | t-digest vs GK? | GK has a deterministic worst-case bound; t-digest has empirical tail-tight accuracy. |
| 8 | t-digest vs KLL? | KLL has a clean randomized (provable) bound; t-digest wins on tail accuracy per byte. |
| 9 | What is the compression parameter? | The knob `δ` trading memory for accuracy; centroid count ≈ `δ`. |
| 10 | How is a quantile query answered? | Sweep centroids accumulating counts, interpolate between the two straddling the target rank. |
| 11 | Why buffer values before clustering? | Batched re-clustering is far cheaper than re-sorting on every insert. |
| 12 | What does interpolation do in the query? | Draws a straight line between centroid centers to estimate values between them. |

**Q1 — What is the scale function?**
`k(q)` is a monotonically increasing map that re-coordinates the quantile axis into "k-space," stretched near `q=0,1` and compressed near `q=0.5`. The size rule is: a centroid may span at most one unit of k-space (`Δk ≤ 1`). Translated back, that is a tiny quantile range at the tails and a wide one in the middle.

**Q3 — The arcsin scale.**
`k1(q) = (δ/2π)·arcsin(2q−1)`. Its derivative `(δ/2π)/sqrt(q(1−q))` diverges as `q → 0` or `q → 1`, so the k-axis stretches maximally at the ends, forcing the smallest centroids exactly at the tails.

**Q4 — Mergeable.**
A structure is mergeable if `merge(A,B)` yields a summary of the combined data with the same accuracy as building one from scratch. t-digest is (empirically) mergeable, so per-node digests can be combined into a fleet-wide digest — the foundation of distributed percentile monitoring.

**Q7 — t-digest vs GK.**
GK (Greenwald-Khanna) guarantees, deterministically, that every query's rank error is `≤ εn` for *all* inputs, with `O((1/ε)log(εn))` memory and *uniform* accuracy. t-digest gives *non-uniform*, tail-tight error with `O(δ)` memory but only an *empirical* guarantee. Choose GK when you need a proof; t-digest when you need the best tail accuracy per byte on real data.

**Q8 — t-digest vs KLL.**
KLL is randomized with a clean, near-space-optimal *provable* bound (`O((1/ε)loglog(1/δ_f))`) and clean mergeability. t-digest lacks a worst-case proof but typically beats KLL on raw tail accuracy per kilobyte in practice. KLL is the "academically optimal general sketch"; t-digest is the "tail-monitoring workhorse."

**Q5 — How does merging work, step by step?**
Concatenate both digests' centroid lists into one array, sort by mean, then sweep left to right greedily folding adjacent centroids while the running k-width stays `≤ 1`; emit a centroid and start a fresh accumulator whenever folding would exceed the limit. Total count is preserved (sum of weights), order is preserved (sort), and the size invariant is restored (the fold guard). Cost `O(C log C)`, and crucially it touches only the summaries, never raw data.

**Q9 — What is the compression parameter, concretely?**
A single knob `δ` (sometimes exposed as "compression") that sets the centroid count `C ≈ δ` and thus the memory-accuracy trade. 100 is a typical default (~0.5% p99 error); 200–500 for strict p999. Doubling it roughly halves the rank error and doubles memory and merge time — a clean linear lever.

**Q10 — Walk through a quantile query.**
Convert the quantile to a target rank `t = q·n`. Sweep centroids accumulating counts and track each centroid's *center* rank. Find the two centroids whose centers straddle `t`, then linearly interpolate between their means by the fractional position of `t` between the two centers. For `q=0`/`q=1`, return the tracked exact `min`/`max` instead of interpolating.

**Q11 — Why buffer values before clustering, concretely?**
Inserting one value at a time can force a sort or a search on every `Add`, which is slow under millions of inserts per second. Instead accumulate incoming values in an unsorted buffer; when it fills (size ≈ compression), sort the buffer together with the existing centroids once and re-cluster in a single linear sweep. This is the "aggregate method" — it turns per-value `O(C)` work into `O(log C)` amortized.

**Q12 — What does interpolation assume, and when does it break?**
Linear interpolation between two centroid means assumes the data varies roughly linearly inside the gap between them. That holds when centroids are small (dense data, or the tails where t-digest keeps them tiny). It breaks across a big sparse gap — e.g. a bimodal distribution with a void in the middle — where the straight line invents values that do not exist. The tails stay accurate because the centroids there are small.

**Q13 — Why does merging require re-clustering rather than just concatenating?**
Concatenating two centroid lists doubles the centroid count, so without re-clustering the digest grows on every merge and eventually loses its bounded-memory property. Re-clustering re-applies the size rule to the combined list, folding adjacent centroids back down to `O(compression)` total. The sort restores order; the fold guard restores the size invariant.

**Q14 — What is the CDF query (inverse of the quantile query)?**
Given a value `v`, return the fraction of data `≤ v` (its quantile). You sweep centroids until you reach `v`, summing counts, and interpolate the partial count of the straddling centroid. It answers threshold SLAs directly: "what fraction of requests were under 300 ms?" It is the exact inverse of `quantile(q)` and reads the same centroid array.

**Q15 — Why are the centroids kept sorted by mean?**
Both the quantile query and the merge re-clustering rely on a monotone cumulative-count sweep, which only works if centroids are in increasing-mean order. Sorting is what lets a single left-to-right pass compute ranks and locate the straddling pair. It is also why merge is `O(C log C)` — the sort dominates.

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Why is averaging per-node p99 values wrong? | Percentiles are not additive/averageable; merge digests then query once. |
| 2 | Design a fleet-wide p99 latency dashboard. | Per-instance digest → ship serialized → merge at aggregator → query merged. |
| 3 | How do you compute p99 over the last hour? | Keep per-interval digests; merge those covering the window at query time. |
| 4 | How do you keep the hot-path `Add` cheap? | Per-core digests / double-buffer / lock-free batch buffer; avoid a shared lock. |
| 5 | How do you size the accuracy-memory budget? | Pick compression per metric; spend centroids on SLO-critical tails. |
| 6 | How do you avoid losing the true max latency? | Track exact `min`/`max` separately; clustering can smooth extremes. |
| 7 | How does merge scale to thousands of nodes? | Hierarchical merge tree (instance → zone → global); merge is associative. |
| 8 | What goes over the wire between node and aggregator? | A serialized digest (centroid array + min/max/n), a few KB — not raw events. |
| 9 | When would you pick native/exponential histograms instead? | Prometheus-native stack wanting first-class bounded mergeable histograms. |
| 10 | What metrics monitor the digest pipeline itself? | Centroid count, merge latency, serialized bytes, query-error vs exact sample. |
| 11 | How does cardinality blow up a digest deployment? | One digest per high-cardinality label = memory disaster; aggregate labels. |
| 12 | How do you validate accuracy in production? | Periodically compare digest p99 to an exact p99 from a reservoir sample. |

**Q1 — Why averaging percentiles is wrong.**
A percentile is a property of a distribution, not a quantity you can average. "Node A p99 = 100 ms, Node B p99 = 200 ms ⇒ fleet p99 = 150 ms" is meaningless and usually *under*-reports the true tail. If A handles 10× the traffic, its tail dominates. Correct: merge A's and B's digests, then read p99 once from the merged digest.

**Q2 — Fleet p99 dashboard design.**
Each instance keeps an in-memory t-digest, updated per request on the hot path. On each scrape interval it snapshots-and-resets, serializes the digest (~KB), and the aggregator pulls it. The aggregator merges all instances' digests for the metric+window into a fleet digest, then the dashboard queries p50/p99/p999 from the merged digest. Raw events never leave the instance.

**Q4 — Cheap hot path.**
A single locked digest under millions of req/s is a bottleneck. Use per-core/per-thread digests merged at scrape time, a double-buffer (write to A, scraper drains/resets B, swap), or a lock-free buffer drained in batches. The per-value cost must be amortized `O(1)`.

**Q6 — Preserving extremes.**
Clustering averages values, so the single worst latency can be absorbed into a centroid mean and vanish. Always track exact `min`/`max` alongside the digest, and clamp interpolated tail answers to them. A hidden record-breaking latency can mask a real incident.

**Q3 — p99 over the last hour.**
Keep one digest per small base interval (e.g. 10 s). To answer "last hour," merge the ~360 base digests covering that hour and query the merged one. This is mergeability applied across time instead of across machines; merging hundreds of KB-sized digests is sub-millisecond. Old intervals can be pre-merged into coarser tiers (downsampling) to bound storage.

**Q5 — Sizing the accuracy-memory budget.**
Compression is per-metric. Spend centroids where the SLA lives: high compression (200–500) for the handful of SLO-critical latency metrics, low (50–100) for the long tail of less important ones. Do a back-of-envelope: `metrics × dimensions × hot-windows × per-digest-bytes`. With δ=100 and a couple thousand metrics over a 15-minute hot window, you land in the hundreds-of-MB range on the aggregator — versus terabytes if you shipped raw events.

**Q7 — Scaling merge to thousands of nodes.**
Use a hierarchical merge tree: instances → zone aggregators → global aggregator. Merge is associative and digests are tiny, so each level merges a handful of summaries and forwards one. The global node never sees raw events, only a logarithmic cascade of merged digests.

**Q12 — Validating accuracy in production.**
Keep a small reservoir sample (a few thousand raw values) on one node, compute the *exact* p99 from it periodically, and compare to the digest's p99. Sustained divergence flags a bug — wrong scale function, bad merge order, or (most often) someone averaging percentiles upstream.

**Q13 — A junior reports "fleet p99 dropped 40% after we added a region." Bug or real?**
Almost certainly a bug — and the classic one. If percentiles were being *averaged* across regions, adding a low-traffic region with a fast p99 mechanically drags the (meaningless) average down even though no real latency improved. The fix is to confirm digests are being *merged* before the single p99 read. The smoking gun is that the "improvement" tracks region count, not any code change.

**Q14 — How do you handle a metric whose value range you don't know in advance?**
This is exactly where t-digest beats a fixed-bucket histogram: it needs no preconfigured edges and adapts to whatever range arrives, from microseconds to minutes, with tail-tight accuracy throughout. A classic histogram would either clip out-of-range values into an overflow bucket (destroying tail accuracy) or need re-deploying when the range shifts. If you instead need *relative* error guarantees over an unknown range, reach for DDSketch.

**Q15 — How do you serialize and version a digest for the wire?**
Serialize `min`, `max`, `n`, `compression`, and the centroid array (mean+count pairs) in a compact binary form (often delta/varint-encoded since means are sorted). Include a format version byte so aggregators can evolve the encoding. Keep the compression parameter in the payload so a merger can detect mismatched-compression inputs and standardize them.

**Q16 — When is a t-digest the wrong choice entirely?**
When you need a *proven* worst-case bound (use KLL or GK), when you need *relative-value* error rather than rank error (use DDSketch), when you need exact quantiles (keep all data / use a database), or when your range is fixed and known and a simple bucketed histogram is cheaper and good enough. t-digest shines specifically at tail-accurate, mergeable, unknown-range rank estimation.

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Derive the centroid count bound. | Telescoping k-widths sum to `k(1)−k(0) = δ/2`; `C = O(δ)`. |
| 2 | Why does arcsin give tail-tight error? | `k1'(q) = (δ/2π)/sqrt(q(1−q))` diverges at tails ⇒ centroid weight → 0 there. |
| 3 | Express the rank error of t-digest as a function of q. | `err(q) ≈ (π/δ)·sqrt(q(1−q))`; vanishes at tails, max at median. |
| 4 | Contrast deterministic vs randomized vs empirical guarantees. | GK deterministic, KLL randomized w.h.p., t-digest empirical (no worst-case proof). |
| 5 | State GK's and KLL's memory bounds. | GK `O((1/ε)log(εn))`; KLL `O((1/ε)loglog(1/δ_f))`. |
| 6 | What is the amortized insert cost and why? | `O(log δ)` via buffered batch flush (aggregate method). |
| 7 | Define mergeability formally. | `summary(X)⊕summary(Y)` ≈ `summary(X∪Y)` with same error parameter. |
| 8 | What is t-digest's known weakness? | No worst-case bound; adversarial input orderings can degrade accuracy. |
| 9 | Why can't sublinear memory give exact quantiles? | Exact arbitrary quantiles over a stream provably need `Ω(n)` space. |
| 10 | When is KLL formally preferable to t-digest? | When you need provable post-merge accuracy and uniform `ε` across all quantiles. |

**Q1 — Centroid count bound.**
Centroids partition `[0,1]` into consecutive intervals whose k-widths telescope: `Σ(k(q_i^R) − k(q_i^L)) = k(1) − k(0)`. For `k1`, that total is `(δ/2π)·(arcsin 1 − arcsin(−1)) = (δ/2π)·π = δ/2`. Since each well-compressed centroid has k-width bounded below by a constant and above by 1, the count is `C = Θ(δ)`, independent of `n`.

**Q3 — Rank error.**
The query interpolates within the centroid covering `q`, so the rank error is roughly half that centroid's weight: `err(q) ≈ (1/2)(w_i/n) ≈ (π/δ)·sqrt(q(1−q))`. This is maximized at `q=1/2` and tends to 0 as `q → 0,1` — the formal statement of "tail-tight." Note this is an approximation under benign data, not a worst-case theorem.

**Q4 — Three guarantee regimes.**
GK: for *all* inputs, *every* query has rank error `≤ εn` — a deterministic theorem, no randomness. KLL: for any fixed query, error `≤ εn` *with high probability* — randomized, near-space-optimal, cleanly mergeable. t-digest: *empirical* — non-uniform tail-tight error that is excellent on real data but has no worst-case proof and can be degraded by adversarial input. Pick the guarantee that matches your obligation.

**Q8 — t-digest's weakness.**
Its accuracy and mergeability are empirical, not proven. Specific adversarial orderings of inputs can produce larger-than-expected error, and repeated merges have no proven error ceiling. This motivated alternatives like DDSketch (relative-error guarantee) and the continued use of KLL where proofs are required.

**Q2 — Why arcsin gives tail-tight error.**
The arcsin scale `k1(q) = (δ/2π)·arcsin(2q−1)` has derivative `(δ/2π)/sqrt(q(1−q))`, which *diverges* as `q → 0` or `q → 1`. Since a centroid may span only one unit of k-space, and k-space is infinitely "stretched" at the ends, one unit there maps to a vanishing slice of quantiles — so centroid weight `→ 0` at the tails. The query interpolates within that tiny centroid, so rank error `≈ (π/δ)·sqrt(q(1−q)) → 0` at the tails.

**Q3 — Rank error as a function of q.**
`err(q) ≈ (π/δ)·sqrt(q(1−q))`. It is maximized at the median (`q=0.5`) and shrinks toward both tails, dropping by ~`sqrt(10)` for each extra nine (p99 → p999 → p9999). This non-uniform profile is the opposite of GK/KLL, whose error is flat across all `q`.

**Q6 — Amortized insert cost.**
`O(log C)` amortized, achieved by buffering values and re-clustering in batches. With buffer cap `B ≈ C`, there are `n/B` flushes each costing `O(C log C)`, total `O(n log C)` — so `O(log C)` per value, independent of `n`. Inserting one value at a time without buffering is much slower because each insert may trigger a sort.

**Q8 — The DDSketch contrast (relative-error).**
DDSketch buckets values on a logarithmic scale and bounds *relative value* error (`|v̂ − v|/v ≤ α`) with a *deterministic* proof, whereas t-digest bounds *rank* error empirically. If your SLA is "p99 within X% of the true value" and needs a proof, DDSketch fits; if it is "estimate the p99 position accurately and merge cheaply over unknown-range data," t-digest fits. They bound different errors — never compare them as if interchangeable.

**Q11 — Contrast t-digest with Q-digest.**
Q-digest builds a binary tree over a *fixed integer value range* `[0, 2^k)`, merging sibling nodes whose counts fall below `n/compression`. Its error is in *value space* and it requires knowing the universe size up front, which makes it awkward for floating-point latencies of unknown range. t-digest needs no fixed universe, adapts to any real-valued range, and concentrates accuracy at the tails — which is why it largely displaced Q-digest for latency monitoring. Q-digest's advantage is a clean deterministic error bound over its bounded integer domain.

**Q12 — Why are histograms (fixed buckets) still used despite t-digest's advantages?**
Fixed-bucket histograms are dead simple, trivially mergeable (just add bucket counts), and have a first-class place in metrics systems like Prometheus. If your value range is known and bucket boundaries are chosen well, they are cheaper and need no interpolation. Their failure modes are needing the range up front, coarse resolution unless you add many buckets, and poor tail resolution unless buckets are placed there deliberately. Prometheus *native (exponential) histograms* close much of this gap with auto-scaling exponential buckets.

**Q13 — Why is t-digest accuracy *non-uniform* by design, and is that a feature or a flaw?**
It is a deliberate feature for monitoring: the arcsin scale spends almost all centroids at the tails, so p99/p999 — the quantiles SLAs care about — are sharp, while the median (which nobody pages on) is coarser. It is a flaw if your application needs uniform accuracy across *all* quantiles (e.g. estimating the full CDF shape evenly), in which case KLL or GK, with flat `ε` everywhere, is the right tool. Match the error profile to what you actually query.

**Q14 — How does input ordering affect t-digest, and how do you defend against it?**
Because clustering is greedy and order-dependent, an adversarial or pathological input order can produce worse-than-typical error and slightly different digests for the same multiset. Defenses: buffer-and-batch (re-clustering a sorted batch reduces order sensitivity), shuffle on ingestion where feasible, periodically rebuild from a fresh merge, and validate against an exact sample. If adversarial input is a real threat model, prefer a sketch with a worst-case proof (KLL).

---

## System Design Walkthrough

> A frequent senior interview prompt: *"Design a system that reports p50/p99/p999 latency per service across a fleet of 5,000 instances, queryable over arbitrary time windows."* A strong answer:

**1. Local recording.** Each instance keeps an in-memory t-digest per (endpoint, status-class), updated on every request via a cheap `Add(latencyMs)`. Keep the hot path lock-light (per-core digests or a double-buffer).

**2. Windowing on the instance.** Maintain one digest per short base interval (e.g. 10 s). On each scrape, snapshot-and-reset the current interval and expose the completed ones.

**3. Shipping.** The scraper pulls serialized digests (~KB each) — never raw events. For 5,000 instances × a few metrics, this is megabytes per scrape, not terabytes.

**4. Aggregation.** A merge tree (instance → zone → global) combines digests. Because merge is associative and the digests are tiny, this scales horizontally and the global node only ever handles summaries.

**5. Storage & retention.** Store base-interval digests; downsample old ones into coarser tiers (10 s → 5 min → 1 h → 1 d) by pre-merging.

**6. Query.** "p99 over last hour" = merge the relevant base/coarse digests for that window, then query once. Both percentile-form (p99 value) and threshold-form (fraction under 300 ms via CDF) come from the same digest.

**7. Correctness guardrails.** Never average per-instance percentiles. Standardize compression fleet-wide. Track exact min/max. Validate periodically against an exact sample.

**8. Capacity estimate (whiteboard).**
```text
5000 instances is irrelevant to STORAGE — they merge away.
Stored: metrics(2000) × hot-windows(360 @10s for 1h) × ~1.5KB ≈ ~1 GB hot,
   shrinking via downsampling for older data. Comfortable for one aggregator's RAM.
```

Follow-ups the interviewer probes: how to keep the hot path cheap (per-core/double-buffer), why averaging is wrong (categorical bug), and when to pick native histograms or DDSketch instead.

---

## Rapid-Fire Round

| # | Question | Answer |
|---|----------|--------|
| 1 | Memory of a t-digest? | `O(compression)`, independent of `n`. |
| 2 | Where is t-digest most accurate? | The tails (p99, p999). |
| 3 | Where is it least accurate? | The median (p50). |
| 4 | Default scale function? | `k1`, the arcsin scale. |
| 5 | Can you merge digests across machines? | Yes — that is the point. |
| 6 | Can you average percentiles across machines? | No — never. |
| 7 | Exact quantile complexity? | `O(n log n)` time, `O(n)` space. |
| 8 | t-digest insert (amortized)? | `O(log C)`. |
| 9 | Merge complexity? | `O(C log C)`. |
| 10 | GK guarantee type? | Deterministic. |
| 11 | KLL guarantee type? | Randomized (w.h.p.). |
| 12 | t-digest guarantee type? | Empirical. |
| 13 | What two numbers define a centroid? | mean and count. |
| 14 | What must you track to keep exact extremes? | `min` and `max`. |
| 15 | One real system using t-digest? | Elasticsearch (percentiles aggregation). |

---

## Coding Challenges

### Challenge 1: Streaming Quantile Estimator

> Implement a simplified t-digest that supports `add(x)`, `quantile(q)`, and `merge(other)`. Then, given a list of values, answer a set of quantile queries. Your estimate for each quantile should be within a small tolerance of the exact answer computed by sorting. Use the `q(1−q)` size rule so centroids stay small at the tails.
>
> **Input:** a list of doubles and a list of query quantiles.
> **Output:** the estimated value for each quantile.
> **Requirement:** memory bounded by `O(compression)`; one pass to build; support merging two estimators.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

type centroid struct{ mean, count float64 }

type TDigest struct {
	cs          []centroid
	n           float64
	compression float64
}

func New(c float64) *TDigest { return &TDigest{compression: c} }

func (t *TDigest) sizeLimit(q float64) float64 {
	return 4*t.n*q*(1-q)/t.compression + 1
}

func (t *TDigest) Add(x float64) {
	t.n++
	if len(t.cs) == 0 {
		t.cs = append(t.cs, centroid{x, 1})
		return
	}
	best, bestDist := 0, math.Inf(1)
	for i, c := range t.cs {
		if d := math.Abs(c.mean - x); d < bestDist {
			bestDist, best = d, i
		}
	}
	cum := 0.0
	for i := 0; i < best; i++ {
		cum += t.cs[i].count
	}
	q := (cum + t.cs[best].count/2) / t.n
	if t.cs[best].count+1 <= t.sizeLimit(q) {
		c := &t.cs[best]
		c.mean = (c.mean*c.count + x) / (c.count + 1)
		c.count++
	} else {
		t.cs = append(t.cs, centroid{x, 1})
		sort.Slice(t.cs, func(i, j int) bool { return t.cs[i].mean < t.cs[j].mean })
	}
}

func (t *TDigest) Merge(o *TDigest) {
	for _, c := range o.cs {
		// re-add as weighted points (simple, correct enough for the challenge)
		for i := 0; i < int(c.count); i++ {
			t.Add(c.mean)
		}
	}
}

func (t *TDigest) Quantile(q float64) float64 {
	if len(t.cs) == 0 {
		return math.NaN()
	}
	target := q * t.n
	cum := 0.0
	for i, c := range t.cs {
		center := cum + c.count/2
		if target <= center {
			if i == 0 {
				return c.mean
			}
			prev := t.cs[i-1]
			pc := cum - prev.count/2
			frac := (target - pc) / (center - pc)
			return prev.mean + frac*(c.mean-prev.mean)
		}
		cum += c.count
	}
	return t.cs[len(t.cs)-1].mean
}

func main() {
	td := New(100)
	for i := 1; i <= 1000; i++ {
		td.Add(float64(i))
	}
	for _, q := range []float64{0.5, 0.9, 0.99} {
		fmt.Printf("p%.0f ~ %.1f (exact %.1f)\n", q*100, td.Quantile(q), q*1000)
	}
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static class C { double mean, count; C(double m, double c){mean=m;count=c;} }
    static class TDigest {
        List<C> cs = new ArrayList<>(); double n = 0, comp;
        TDigest(double c){ comp = c; }
        double sizeLimit(double q){ return 4*n*q*(1-q)/comp + 1; }
        void add(double x){
            n++;
            if (cs.isEmpty()){ cs.add(new C(x,1)); return; }
            int best=0; double bd=Double.POSITIVE_INFINITY;
            for (int i=0;i<cs.size();i++){ double d=Math.abs(cs.get(i).mean-x); if(d<bd){bd=d;best=i;} }
            double cum=0; for(int i=0;i<best;i++) cum+=cs.get(i).count;
            C c=cs.get(best); double q=(cum+c.count/2)/n;
            if (c.count+1<=sizeLimit(q)){ c.mean=(c.mean*c.count+x)/(c.count+1); c.count++; }
            else { cs.add(new C(x,1)); cs.sort((a,b)->Double.compare(a.mean,b.mean)); }
        }
        void merge(TDigest o){ for (C c:o.cs) for(int i=0;i<(int)c.count;i++) add(c.mean); }
        double quantile(double q){
            if (cs.isEmpty()) return Double.NaN;
            double target=q*n, cum=0;
            for (int i=0;i<cs.size();i++){
                C c=cs.get(i); double center=cum+c.count/2;
                if (target<=center){
                    if (i==0) return c.mean;
                    C prev=cs.get(i-1); double pc=cum-prev.count/2;
                    double frac=(target-pc)/(center-pc);
                    return prev.mean+frac*(c.mean-prev.mean);
                }
                cum+=c.count;
            }
            return cs.get(cs.size()-1).mean;
        }
    }

    public static void main(String[] args){
        TDigest td = new TDigest(100);
        for (int i=1;i<=1000;i++) td.add(i);
        for (double q : new double[]{0.5,0.9,0.99})
            System.out.printf("p%.0f ~ %.1f (exact %.1f)%n", q*100, td.quantile(q), q*1000);
    }
}
```

#### Python

```python
import math

class TDigest:
    def __init__(self, compression=100):
        self.cs = []   # [mean, count]
        self.n = 0.0
        self.comp = compression

    def _size_limit(self, q):
        return 4 * self.n * q * (1 - q) / self.comp + 1

    def add(self, x):
        self.n += 1
        if not self.cs:
            self.cs.append([x, 1.0]); return
        best = min(range(len(self.cs)), key=lambda i: abs(self.cs[i][0] - x))
        cum = sum(c[1] for c in self.cs[:best])
        c = self.cs[best]
        q = (cum + c[1] / 2) / self.n
        if c[1] + 1 <= self._size_limit(q):
            c[0] = (c[0] * c[1] + x) / (c[1] + 1); c[1] += 1
        else:
            self.cs.append([x, 1.0]); self.cs.sort(key=lambda c: c[0])

    def merge(self, other):
        for mean, count in other.cs:
            for _ in range(int(count)):
                self.add(mean)

    def quantile(self, q):
        if not self.cs: return float("nan")
        target, cum = q * self.n, 0.0
        for i, c in enumerate(self.cs):
            center = cum + c[1] / 2
            if target <= center:
                if i == 0: return c[0]
                prev = self.cs[i - 1]; pc = cum - prev[1] / 2
                frac = (target - pc) / (center - pc)
                return prev[0] + frac * (c[0] - prev[0])
            cum += c[1]
        return self.cs[-1][0]


if __name__ == "__main__":
    td = TDigest(100)
    for i in range(1, 1001):
        td.add(float(i))
    for q in (0.5, 0.9, 0.99):
        print(f"p{q*100:.0f} ~ {td.quantile(q):.1f} (exact {q*1000:.1f})")
```

**Follow-ups the interviewer may ask:**

1. *Make `add` amortized `O(1)`* — buffer values and re-cluster in batches.
2. *Make `merge` not re-add every point* — concatenate centroid lists and re-cluster (see Challenge 2 below and `middle.md`).
3. *Track exact `min`/`max`* — update two scalars and clamp tail queries.
4. *Switch to the arcsin scale* — replace the `q(1−q)` size limit with `k1(q_right) − k1(q_left) ≤ 1`.
5. *Prove memory is bounded* — telescoping k-widths give `C = O(compression)`.

---

### Challenge 2: Efficient Merge of Two Digests

> The naive `merge` in Challenge 1 re-adds every point, which is `O(total_count)` — it touches raw weight, defeating the point of a summary. Implement a proper merge that operates **only on centroids**: concatenate the two centroid lists, sort by mean, then sweep once folding adjacent centroids while the combined cluster stays under the size rule. This is `O(C log C)` in the number of centroids, independent of how many values they summarize.
>
> **Input:** two digests A and B (each a list of `(mean, count)` centroids plus total `n`).
> **Output:** one merged digest whose `quantile(q)` matches a digest built from A's and B's data combined.
> **Key invariant:** total count is preserved (`Σ counts = nA + nB`); centroid count returns to `O(compression)`.

The merge sweep, in words: order all centroids by mean; keep a running accumulator centroid; for each next centroid, tentatively fold it in and check the size rule at that cluster's running quantile `q = (cum + foldedWeight/2) / n`; if the folded weight is within `sizeLimit(q)`, absorb it (weighted-average the means, add the counts); otherwise emit the accumulator and start a new one from the current centroid.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type centroid struct{ mean, count float64 }

type TDigest struct {
	cs          []centroid
	n           float64
	compression float64
}

func New(c float64) *TDigest { return &TDigest{compression: c} }

func (t *TDigest) sizeLimit(q float64) float64 {
	return 4*t.n*q*(1-q)/t.compression + 1
}

// AddCentroid appends raw centroids; call MergeInto / compress afterward.
func (t *TDigest) addRaw(c centroid) {
	t.cs = append(t.cs, c)
	t.n += c.count
}

// MergeFrom folds another digest in using centroid-only re-clustering.
func (t *TDigest) MergeFrom(o *TDigest) {
	all := make([]centroid, 0, len(t.cs)+len(o.cs))
	all = append(all, t.cs...)
	all = append(all, o.cs...)
	t.n += o.n
	t.cs = t.recluster(all)
}

func (t *TDigest) recluster(all []centroid) []centroid {
	if len(all) == 0 {
		return all
	}
	sort.Slice(all, func(i, j int) bool { return all[i].mean < all[j].mean })
	out := make([]centroid, 0, len(all))
	acc := all[0]
	cum := 0.0
	for i := 1; i < len(all); i++ {
		next := all[i]
		folded := acc.count + next.count
		q := (cum + folded/2) / t.n
		if folded <= t.sizeLimit(q) {
			acc.mean = (acc.mean*acc.count + next.mean*next.count) / folded
			acc.count = folded
		} else {
			out = append(out, acc)
			cum += acc.count
			acc = next
		}
	}
	out = append(out, acc)
	return out
}

func (t *TDigest) Quantile(q float64) float64 {
	if len(t.cs) == 0 {
		return 0
	}
	target := q * t.n
	cum := 0.0
	for i, c := range t.cs {
		center := cum + c.count/2
		if target <= center {
			if i == 0 {
				return c.mean
			}
			prev := t.cs[i-1]
			pc := cum - prev.count/2
			frac := (target - pc) / (center - pc)
			return prev.mean + frac*(c.mean-prev.mean)
		}
		cum += c.count
	}
	return t.cs[len(t.cs)-1].mean
}

func main() {
	a, b := New(100), New(100)
	for i := 1; i <= 500; i++ {
		a.addRaw(centroid{float64(i), 1})
	}
	for i := 501; i <= 1000; i++ {
		b.addRaw(centroid{float64(i), 1})
	}
	a.cs = a.recluster(a.cs) // compress A on its own
	b.cs = b.recluster(b.cs)
	a.MergeFrom(b) // merge B into A, centroid-only
	for _, q := range []float64{0.5, 0.9, 0.99} {
		fmt.Printf("p%.0f ~ %.1f (exact %.1f) centroids=%d\n",
			q*100, a.Quantile(q), q*1000, len(a.cs))
	}
}
```

#### Java

```java
import java.util.*;

public class MergeChallenge {
    static class C { double mean, count; C(double m, double c){mean=m;count=c;} }

    static class TDigest {
        List<C> cs = new ArrayList<>(); double n = 0, comp;
        TDigest(double c){ comp = c; }
        double sizeLimit(double q){ return 4*n*q*(1-q)/comp + 1; }

        void addRaw(double mean, double count){ cs.add(new C(mean,count)); n += count; }

        void mergeFrom(TDigest o){
            List<C> all = new ArrayList<>(cs); all.addAll(o.cs);
            n += o.n;
            cs = recluster(all);
        }

        List<C> recluster(List<C> all){
            if (all.isEmpty()) return all;
            all.sort((x,y)->Double.compare(x.mean,y.mean));
            List<C> out = new ArrayList<>();
            C acc = new C(all.get(0).mean, all.get(0).count);
            double cum = 0;
            for (int i=1;i<all.size();i++){
                C next = all.get(i);
                double folded = acc.count + next.count;
                double q = (cum + folded/2) / n;
                if (folded <= sizeLimit(q)){
                    acc.mean = (acc.mean*acc.count + next.mean*next.count) / folded;
                    acc.count = folded;
                } else {
                    out.add(acc); cum += acc.count;
                    acc = new C(next.mean, next.count);
                }
            }
            out.add(acc);
            return out;
        }

        double quantile(double q){
            if (cs.isEmpty()) return 0;
            double target=q*n, cum=0;
            for (int i=0;i<cs.size();i++){
                C c=cs.get(i); double center=cum+c.count/2;
                if (target<=center){
                    if (i==0) return c.mean;
                    C prev=cs.get(i-1); double pc=cum-prev.count/2;
                    double frac=(target-pc)/(center-pc);
                    return prev.mean+frac*(c.mean-prev.mean);
                }
                cum+=c.count;
            }
            return cs.get(cs.size()-1).mean;
        }
    }

    public static void main(String[] args){
        TDigest a = new TDigest(100), b = new TDigest(100);
        for (int i=1;i<=500;i++)   a.addRaw(i,1);
        for (int i=501;i<=1000;i++) b.addRaw(i,1);
        a.cs = a.recluster(a.cs);
        b.cs = b.recluster(b.cs);
        a.mergeFrom(b);
        for (double q : new double[]{0.5,0.9,0.99})
            System.out.printf("p%.0f ~ %.1f (exact %.1f) centroids=%d%n",
                q*100, a.quantile(q), q*1000, a.cs.size());
    }
}
```

#### Python

```python
class TDigest:
    def __init__(self, compression=100):
        self.cs = []        # [mean, count]
        self.n = 0.0
        self.comp = compression

    def _size_limit(self, q):
        return 4 * self.n * q * (1 - q) / self.comp + 1

    def add_raw(self, mean, count):
        self.cs.append([mean, count])
        self.n += count

    def merge_from(self, other):
        all_cs = self.cs + other.cs
        self.n += other.n
        self.cs = self._recluster(all_cs)

    def _recluster(self, all_cs):
        if not all_cs:
            return all_cs
        all_cs.sort(key=lambda c: c[0])
        out = []
        acc = [all_cs[0][0], all_cs[0][1]]
        cum = 0.0
        for mean, count in all_cs[1:]:
            folded = acc[1] + count
            q = (cum + folded / 2) / self.n
            if folded <= self._size_limit(q):
                acc[0] = (acc[0] * acc[1] + mean * count) / folded
                acc[1] = folded
            else:
                out.append(acc)
                cum += acc[1]
                acc = [mean, count]
        out.append(acc)
        return out

    def quantile(self, q):
        if not self.cs:
            return 0.0
        target, cum = q * self.n, 0.0
        for i, c in enumerate(self.cs):
            center = cum + c[1] / 2
            if target <= center:
                if i == 0:
                    return c[0]
                prev = self.cs[i - 1]
                pc = cum - prev[1] / 2
                frac = (target - pc) / (center - pc)
                return prev[0] + frac * (c[0] - prev[0])
            cum += c[1]
        return self.cs[-1][0]


if __name__ == "__main__":
    a, b = TDigest(100), TDigest(100)
    for i in range(1, 501):
        a.add_raw(float(i), 1.0)
    for i in range(501, 1001):
        b.add_raw(float(i), 1.0)
    a.cs = a._recluster(a.cs)
    b.cs = b._recluster(b.cs)
    a.merge_from(b)              # centroid-only merge, no raw re-add
    for q in (0.5, 0.9, 0.99):
        print(f"p{q*100:.0f} ~ {a.quantile(q):.1f} "
              f"(exact {q*1000:.1f}) centroids={len(a.cs)}")
```

**Why this is the "right" merge.** It never iterates over the raw weight — only over centroids — so merging two digests summarizing a *billion* values each is still work proportional to a few hundred centroids. The sort makes it `O(C log C)`; the fold guard restores the `O(compression)` size invariant so repeated merges across a fleet do not let the digest grow without bound. This is precisely the operation that powers hierarchical merge trees (instance → zone → global) in production percentile pipelines.

---

## Final Tips

- Lead with the one-liner: *"A t-digest summarizes a stream as a bounded set of (mean, count) centroids, kept tiny at the tails by a scale function, so you get tail-accurate p99/p999 in a few KB, and — because it is mergeable — you can aggregate per-node digests into a fleet-wide one."*
- Flag the cardinal sin immediately: **you cannot average percentiles** — merge the digests, then query once.
- Name the trade-offs cleanly: **GK** = deterministic uniform bound, **KLL** = randomized provable bound, **t-digest** = empirical tail-tight, **DDSketch** = deterministic relative-value bound. Match the guarantee to the obligation.
- Mention the two production must-haves: track exact **min/max** (clustering hides the true worst case) and keep the **hot path lock-light** (per-core digests / double-buffer).
- Offer to validate against an **exact sample** — divergence usually means a wrong scale function, bad merge order, or someone averaging percentiles upstream.

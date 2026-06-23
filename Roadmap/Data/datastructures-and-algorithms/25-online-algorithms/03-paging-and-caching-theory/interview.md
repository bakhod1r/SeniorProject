# Paging and Caching Theory — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Marquee: LRU is k-competitive & the lower bound](#the-marquee-lru-is-k-competitive--the-lower-bound)
3. [Belady's Anomaly & Stack Algorithms](#beladys-anomaly--stack-algorithms)
4. [Randomization & Resource Augmentation](#randomization--resource-augmentation)
5. [Applied: Real Cache Policies](#applied-real-cache-policies)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: Define the paging problem and a page fault. *(Easy)*

**Answer**: A **cache** (fast memory) holds at most `k` pages. A request stream `σ = ⟨p₁, p₂, …⟩` arrives one page at a time. On request `pᵢ`:

- If `pᵢ` is **in the cache** → a **hit**, cost 0, no action.
- If `pᵢ` is **not in the cache** → a **page fault** (miss), cost 1. The page must be brought in; if the cache is full, the policy must **evict** one resident page to make room.

The only decision is **which page to evict** on a fault — and it must be made **online**, without seeing future requests. The objective is to minimize the total number of faults. (This is the standard *demand paging* model: never fetch a page before it is requested.)

### Q2: What is Belady's algorithm (LFD/MIN) and why is it optimal? *(Medium)*

**Answer**: **Belady's MIN**, also called **LFD (Longest Forward Distance)**: on a fault, evict the resident page whose **next use is farthest in the future** (evict the one never used again first, if any).

**Why optimal**: An exchange argument. Take any optimal schedule that disagrees with MIN at the first fault; show you can swap its eviction for MIN's farthest-future page without increasing the total fault count, because the page MIN keeps is needed *sooner* and the page MIN evicts can be re-fetched no earlier than it was needed anyway. Repeating the swap converts any optimum into MIN's behavior, so **MIN is offline-optimal** — it is the `OPT` benchmark for paging.

**Why we can't run it online**: LFD requires knowing the **future** request stream (the "forward distance"). An online policy sees only the past, so MIN is purely an analytical yardstick, not a deployable policy.

### Q3: Name the standard online paging policies. *(Easy)*

**Answer**:

- **LRU** (Least Recently Used) — evict the page whose *last* use is oldest. Bets on locality: the recent past predicts the near future.
- **FIFO** (First-In First-Out) — evict the page that entered the cache earliest, ignoring use.
- **LFU** (Least Frequently Used) — evict the page with the smallest access count.
- **FWF** (Flush-When-Full) — when a fault occurs and the cache is full, **evict everything** and start fresh. A theoretical "marking" baseline, not a practical policy.
- **LIFO**, **RAND** (evict a uniformly random page), and **marking** algorithms round out the catalogue.

LRU, FIFO, and FWF are all **k-competitive**; LFU and LIFO are **not competitive** (no constant bound).

---

## The Marquee: LRU is k-competitive & the lower bound

### Q4: Prove LRU is k-competitive. *(Hard — the phase/marking argument)*

**Answer**: Partition `σ` into **phases**. Phase 1 starts at the first request; a new phase begins at the first request that would make the phase contain `k + 1` *distinct* pages. So **each phase contains exactly `k` distinct pages** (except possibly the last, which has ≤ k).

**LRU's cost per phase**: Within one phase only `k` distinct pages appear, and LRU never evicts a page it has touched in the current phase before evicting all the others first. The key lemma: **LRU faults at most `k` times per phase** — each of the `k` distinct pages in a phase faults at most once, because once loaded it stays resident for the rest of the phase (any of the ≤ k−1 other distinct pages touched meanwhile cannot push it out before it is re-used). So `LRU ≤ k` faults per phase.

**OPT's cost per phase**: Consider a phase `Pᵢ` together with the first request of phase `Pᵢ₊₁`. These span `k + 1` distinct pages. At the start of `Pᵢ`, OPT has at most `k` pages cached, one of which is the first page of `Pᵢ`. Over the `k + 1` distinct pages spanning `Pᵢ` plus the next phase's first request, OPT must fault **at least once** per phase (it cannot hold all `k + 1` distinct pages in `k` slots). Charging carefully, **OPT faults ≥ 1 time per phase**.

Therefore over all phases: `LRU ≤ k · (faults of OPT) + O(1)`, i.e. **LRU is k-competitive**. The same marking argument shows **FIFO and FWF are also k-competitive**.

### Q5: Show no deterministic policy beats k. *(Hard — the lower bound)*

**Answer**: Use only `k + 1` distinct pages `{p₀, …, p_k}`. The cache holds `k`, so exactly one of the `k + 1` is missing at any moment. The **adversary always requests the one page the algorithm does not have**.

- Against this stream, the deterministic algorithm **faults on every single request** — say `N` faults over `N` requests.
- **OPT on the same stream**: OPT sees the future, so on each fault it evicts the page used farthest ahead. Among `k + 1` pages, the one farthest in the future won't be requested for at least the next `k − 1` steps, so **OPT faults at most once every `k` requests** → `OPT ≤ N/k + O(1)`.

Thus `ALG / OPT ≥ N / (N/k) = k`. Since this holds for *every* deterministic algorithm, **no deterministic paging policy is better than k-competitive** — and LRU/FIFO match it, so the bound `k` is **tight**.

### Q6: Why is the competitive ratio identical for LRU and FIFO if LRU is clearly better in practice? *(Medium)*

**Answer**: Both are exactly `k`-competitive — **worst-case competitive analysis cannot distinguish them.** The adversary's "always request the missing page" stream defeats both equally. LRU's real-world superiority comes from **locality of reference** (recently-used pages are likely to be reused), which the worst-case adversary deliberately destroys. To *separate* the two analytically you need a refined model — e.g. the **access-graph model** or **distributional / Markov** request models — where LRU provably beats FIFO. This is the canonical example of competitive analysis being too pessimistic to match practice; see [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md).

---

## Belady's Anomaly & Stack Algorithms

### Q7: What is Belady's anomaly? *(Medium)*

**Answer**: **Belady's anomaly**: for **FIFO**, *increasing* the cache size `k` can *increase* the number of faults on some request streams — more memory making things worse. The classic stream `1 2 3 4 1 2 5 1 2 3 4 5` produces **9 faults with k = 3** but **10 faults with k = 4**. It is counterintuitive but real, and it is specifically a property of FIFO (and LIFO, RAND).

### Q8: Why can't LRU exhibit Belady's anomaly? *(Hard)*

**Answer**: Because LRU (like MIN and LFU) is a **stack algorithm**, satisfying the **inclusion property**: at every point in the request stream, the set of pages a cache of size `k` would hold is a **subset** of what a cache of size `k + 1` would hold. Formally the contents are *nested* across cache sizes — they form a "stack" ordered by recency.

The inclusion property directly implies **monotonicity**: any page that is a hit with cache size `k` is also a hit with size `k + 1` (it's in the larger cache too). So faults can **only decrease or stay equal** as `k` grows — **no anomaly is possible**. FIFO violates inclusion (its contents depend on *insertion order*, not a size-independent priority), which is exactly why it can misbehave. The deep reason: stack algorithms order pages by a **size-independent priority** (recency for LRU, frequency for LFU, forward-distance for MIN), and a bigger cache just keeps a longer prefix of that same fixed ordering.

---

## Randomization & Resource Augmentation

### Q9: How does randomization beat the deterministic barrier of k? *(Hard — MARKER)*

**Answer**: The **RANDOMIZED MARKING** algorithm (MARKER). Each page has a *mark* bit; all start unmarked at the beginning of a phase.

- On a request: mark the page. If it's a fault and the cache is full, **evict a uniformly random unmarked page**.
- When all `k` pages become marked, a new phase begins and **all marks are cleared**.

**Result**: MARKER is **`2H_k`-competitive** against an oblivious adversary, where `H_k = 1 + 1/2 + ⋯ + 1/k ≈ ln k` is the `k`-th harmonic number. This is an **exponential improvement**: `k → 2 ln k`. The intuition: a phase has some number `m` of "new" pages (not present last phase); randomly choosing among unmarked pages means the `k − m` "old" pages are each evicted with only probability proportional to `1/i`, summing to a harmonic — not linear — expected fault count.

The **optimal** randomized ratio is exactly **`H_k`** (achieved by the EQUITABLE / Partition algorithm), and **`H_k` is also a matching lower bound** — no randomized policy beats `H_k` against an oblivious adversary (provable via [Yao's principle](../01-competitive-analysis/interview.md)). Always name the **oblivious adversary** model: randomization gives no advantage against an adaptive-offline adversary.

### Q10: Explain resource augmentation for paging. *(Hard)*

**Answer**: **Resource augmentation** gives the online algorithm a *larger* cache than `OPT`, then compares them. Let LRU use cache size `k` while `OPT` uses a smaller size `h ≤ k`. Then:

```
LRU_k(σ) ≤ (k / (k − h + 1)) · OPT_h(σ) + O(1).
```

This is the **Sleator–Tarjan bound**. The point is the dramatic decay: when `k` is even modestly larger than `h`, the ratio collapses toward 1.

- `h = k` → ratio `k` (the standard bound — no extra resource).
- `h = k/2` → ratio `≈ 2`.
- `k = 2h` → ratio `2h/(h+1) ≈ 2` for large `h`.

**Practical reading**: "a little more cache helps a lot." Doubling the online cache relative to the benchmark drops the worst-case ratio from `k` to roughly `2`. It explains why real systems over-provision cache slightly and behave near-optimally — and it's a far more predictive lens than the bare `k`-competitive bound.

---

## Applied: Real Cache Policies

### Q11: Which real policies approximate LRU or Belady? *(Medium)*

**Answer**:

- **CLOCK (Second-Chance)** — an `O(1)`, low-overhead **approximation of LRU** using a circular buffer and one reference bit per page. Used in OS page replacement (Linux's page reclaim is a CLOCK variant). Avoids LRU's per-access list maintenance.
- **ARC (Adaptive Replacement Cache)** — balances **recency vs frequency** with two LRU lists and ghost entries, self-tuning the split; scan-resistant. Used in ZFS.
- **LRU-K** — evicts by the **`K`-th most recent** access (typically LRU-2), distinguishing one-hit-wonders from genuinely hot pages.
- **TinyLFU / W-TinyLFU** — a frequency sketch (Count-Min) admission filter in front of an LRU/SLRU; the basis of **Caffeine**, a top-tier production cache, with hit rates near Belady on real traces.
- **Learned / learning-augmented caching** — uses an ML predictor of next-access time to **mimic LFD**: evict the page predicted to be used farthest in the future. With a good predictor it approaches Belady; theory (e.g. LMARKER, learning-augmented analysis) gives robustness guarantees that degrade gracefully when predictions are wrong — bounded by `O(min(consistency, robustness))`.

The throughline: every strong practical policy is trying to **approximate Belady's farthest-future eviction** using only past signals (recency, frequency, or a learned predictor). See [../../21-advanced-structures/01-lru-cache/interview.md](../../21-advanced-structures/01-lru-cache/interview.md) for the LRU data structure itself.

### Q12: Why is LFU not competitive, and what are its pitfalls? *(Medium)*

**Answer**: **LFU has no constant competitive ratio.** A page accessed heavily early then never again can keep a high count and **never get evicted**, occupying a slot forever while genuinely hot new pages thrash — the adversary exploits exactly this. Practical pitfalls:

- **Cache pollution / stale hot pages**: old high-frequency pages never age out.
- **Scan vulnerability**: a one-time sweep of many pages each gets count 1; under naive LFU they're indistinguishable from each other, but pure LFU can still evict a moderately-used page in favor of nothing useful.
- **No recency signal**: frequency alone misses temporal locality.

Fixes that make frequency usable in practice: **aging / decay** of counts (windowed frequency), or combining frequency with recency (**ARC, W-TinyLFU**). Note LFU *is* a stack algorithm (no Belady anomaly), but stack-ness doesn't imply competitiveness — those are independent properties.

---

## Gotcha / Trick Questions

### Q13: "Is LRU always within k× of optimal in practice?" *(Medium)*

**Answer**: **The `k×` is a worst-case ceiling, not a typical-case prediction.** `k`-competitive means `LRU(σ) ≤ k·OPT(σ) + O(1)` for *every* `σ`, including the adversary's "always request the missing page" stream. On real workloads with locality, LRU is usually **within a small constant of OPT**, often a few percent of the optimal fault count. The `k` factor only materializes on adversarial, locality-free streams that real programs essentially never produce. (Same trap as the competitive-ratio-as-average-case gotcha in [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md).)

### Q14: "FIFO and LRU have the same competitive ratio, so just use the simpler FIFO, right?" *(Medium)*

**Answer**: **No.** Equal *worst-case* ratio (`k`) says nothing about *typical* performance, where LRU's locality exploitation makes it consistently better, and FIFO can even suffer **Belady's anomaly** (faults rising with cache size). Worst-case competitive analysis is simply blind to the locality that dominates real traces. Choose by empirical hit rate and the inclusion property, not by competitive ratio.

### Q15: "Can an online policy ever match Belady?" *(Easy)*

**Answer**: **No deterministic online policy can match MIN in general** — MIN needs the future, and the `k`-lower-bound (Q5) proves any online policy is forced to `k×` on some stream. Online policies can only *approximate* MIN using past signals or **predictions** (learning-augmented caching). The gap is fundamental: it's the price of not seeing the future, exactly the kind of information handicap competitive analysis quantifies.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Cost model for paging? | Fault = 1, hit = 0; minimize faults |
| 2 | Offline optimum for paging? | Belady's MIN / LFD — evict farthest-future use |
| 3 | Why can't MIN run online? | It needs the future request stream |
| 4 | LRU competitive ratio? | **k** (tight) |
| 5 | FIFO competitive ratio? | **k** (tight) |
| 6 | Deterministic lower bound? | **k** — adversary requests the missing page |
| 7 | LFU competitive ratio? | None — not competitive |
| 8 | What is FWF? | Flush-When-Full; also k-competitive |
| 9 | RANDOMIZED MARKING ratio? | `2H_k ≈ 2 ln k` (oblivious) |
| 10 | Optimal randomized ratio? | `H_k ≈ ln k` (tight) |
| 11 | Which adversary for randomized bounds? | Oblivious |
| 12 | Belady's anomaly affects? | FIFO (not LRU/LFU/MIN) |
| 13 | Why is LRU anomaly-free? | Stack algorithm — inclusion property |
| 14 | Resource-augmentation ratio (LRU k vs OPT h)? | `k / (k − h + 1)` |
| 15 | CLOCK approximates? | LRU (`O(1)` with reference bits) |
| 16 | Policy that mimics Belady via prediction? | Learning-augmented caching |
| 17 | Production frequency-based cache? | W-TinyLFU (Caffeine) / ARC |

---

## Common Mistakes

1. **Saying LRU is "always within k× in practice."** That's the worst-case ceiling; real locality makes it near-optimal. The `k` only appears on adversarial streams.
2. **Claiming Belady can be implemented online.** LFD needs the future; it's only an analytical benchmark (`OPT`).
3. **Thinking equal competitive ratio means equal performance.** LRU and FIFO are both `k`-competitive but behave very differently on real traces.
4. **Believing more cache always helps.** FIFO can fault *more* with a bigger cache (Belady's anomaly); only stack algorithms guarantee monotonic improvement.
5. **Quoting `2H_k` or `H_k` without the adversary model.** They are **oblivious-adversary** bounds; randomization gives no edge against adaptive-offline.
6. **Calling LFU competitive.** It has no constant ratio — stale hot pages and scans break it. Stack-ness ≠ competitiveness.
7. **Confusing the resource-augmentation ratio.** It's `k/(k−h+1)` with the online cache `k ≥ h`; setting `h = k` recovers the plain ratio `k`.

---

## Tips & Summary

- **Lead with the benchmark**: "OPT is Belady's MIN — evict the farthest-future page — which is offline-optimal but unrealizable online." Stating this frames every other answer.
- **Memorize the canonical numbers**: deterministic **k** (tight, both LRU and FIFO); randomized MARKER **`2H_k`**, optimal **`H_k ≈ ln k`** (oblivious); resource augmentation **`k/(k−h+1)`**. These are the constants interviewers expect on sight.
- **Narrate the lower bound** as a story: with `k+1` pages the adversary always requests the one you lack, so you fault every step while OPT faults once per `k` — ratio `k`.
- **For LRU's upper bound, use phases**: each phase has `k` distinct pages, LRU faults ≤ k and OPT faults ≥ 1 per phase.
- **Tie theory to practice**: competitive analysis can't separate LRU from FIFO, but locality and the inclusion property (no Belady anomaly) do — and CLOCK/ARC/TinyLFU/learned-caching all chase Belady with past-only signals.
- **Always name the adversary model** for any randomized bound, and remember Belady's anomaly is a FIFO-specific failure that stack algorithms (LRU/LFU/MIN) provably avoid.

**Related:** [Competitive Analysis — Interview](../01-competitive-analysis/interview.md) · [LRU Cache — Interview](../../21-advanced-structures/01-lru-cache/interview.md) · [Paging & Caching Theory — Middle](./middle.md)

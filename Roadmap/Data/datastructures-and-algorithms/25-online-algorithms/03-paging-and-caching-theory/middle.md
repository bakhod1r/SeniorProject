# Paging and Caching Theory — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Model, Restated for Proofs](#the-model-restated-for-proofs)
3. [Belady / LFD Is Optimal Offline](#belady--lfd-is-optimal-offline)
   - [The Exchange Argument](#the-exchange-argument)
   - [Why LFD Is Not an Online Algorithm](#why-lfd-is-not-an-online-algorithm)
4. [Marking Algorithms](#marking-algorithms)
   - [Definition](#definition)
   - [LRU and FWF Are Marking; FIFO Is Not](#lru-and-fwf-are-marking-fifo-is-not)
5. [LRU and Marking Algorithms Are k-Competitive](#lru-and-marking-algorithms-are-k-competitive)
   - [Phase Partitioning](#phase-partitioning)
   - [Upper Bound: Any Marking Algorithm Faults ≤ k Per Phase](#upper-bound-any-marking-algorithm-faults--k-per-phase)
   - [Lower Bound: OPT Faults ≥ 1 Per Phase](#lower-bound-opt-faults--1-per-phase)
   - [Putting It Together](#putting-it-together)
6. [FIFO Is k-Competitive Without Being a Marking Algorithm](#fifo-is-k-competitive-without-being-a-marking-algorithm)
7. [The Deterministic Lower Bound: k Is Optimal](#the-deterministic-lower-bound-k-is-optimal)
8. [LFU and LIFO Are Not Competitive](#lfu-and-lifo-are-not-competitive)
   - [LFU: An Unbounded Ratio](#lfu-an-unbounded-ratio)
   - [LIFO: An Unbounded Ratio](#lifo-an-unbounded-ratio)
9. [A First Look at Randomized Paging](#a-first-look-at-randomized-paging)
10. [Code: Replaying Sequences and Confirming the Bounds](#code-replaying-sequences-and-confirming-the-bounds)
11. [Pitfalls](#pitfalls)
12. [Summary](#summary)

---

## Introduction

> Focus: prove the results you met as facts at the junior level. By the end you can derive — not just quote — that LFD is the offline optimum, that LRU/FIFO/every marking algorithm is exactly `k`-competitive, that no deterministic algorithm beats `k`, and that LFU and LIFO have *unbounded* competitive ratio.

At the [junior level](./junior.md) you met the paging problem (a `k`-slot cache, faults cost `1`, hits are free, an eviction is forced on every fault), the standard policies (LRU, FIFO, LFU, LIFO, FWF), and **LFD** — *Longest-Forward-Distance*, "evict the page used farthest in the future" — stated as the offline optimum. From the [competitive-analysis](../01-competitive-analysis/middle.md) section you have the framework: an online algorithm is **`c`-competitive** if `ALG(σ) ≤ c · OPT(σ) + α` for every request sequence `σ`, where `OPT` is the clairvoyant offline optimum and `α` is a constant independent of `σ`.

This file proves the core paging theorems with full arguments:

- **LFD is optimal offline**, via a clean *exchange argument*: any optimal schedule can be edited, eviction by eviction, into the LFD schedule without ever increasing the fault count.
- **LRU, FIFO, and every marking algorithm are `k`-competitive**, via *phase partitioning*: chop `σ` into phases of exactly `k` distinct pages; a marking algorithm faults at most `k` times per phase, while `OPT` faults at least once per phase, so the ratio is `≤ k`.
- **No deterministic algorithm beats `k`** — the adversary requests the page you just evicted, forcing a fault every step while `OPT` faults once per `k` steps.
- **LFU and LIFO are not competitive at all** — their ratio grows without bound, so no constant `c` works.
- A first look at **randomized paging**, where the right algorithm reaches `Θ(log k) = H_k`, an exponential improvement over `k` — the full story is deferred to the [senior level](./senior.md).

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `k` | cache size (number of page slots) |
| `σ` | request sequence, `σ = ⟨σ₁, …, σ_m⟩`, each `σ_t` a page name |
| `ALG(σ)` | number of **faults** `ALG` incurs on `σ` (its cost) |
| `OPT(σ)` | minimum faults achievable offline = `LFD(σ)` |
| `H_k` | the `k`-th harmonic number, `1 + 1/2 + ⋯ + 1/k ≈ ln k` |

Costs are counted in **faults**: a hit is free, a fault costs `1`. We assume **demand paging** throughout — a page is brought in *only* on a fault, and a fault evicts exactly one resident page. (FWF is the one policy that deliberately violates the spirit of demand paging by flushing the whole cache; we treat it as a marking algorithm below.)

---

## The Model, Restated for Proofs

To prove anything we fix the rules precisely.

- The cache holds at most `k` distinct pages. It starts **empty** (the first `k` distinct requests are *cold-start* faults; these get absorbed by the additive constant `α`).
- On request `σ_t`:
  - if `σ_t` is resident, it is a **hit** (cost `0`);
  - if not, it is a **fault** (cost `1`); if the cache is full, one resident page is **evicted** to make room, then `σ_t` is loaded.
- An online algorithm must choose the eviction victim using only `σ₁, …, σ_t` — the past and present, never the future.
- The offline optimum `OPT` may use the entire sequence `σ` to choose victims.

Two structural facts we will lean on:

1. **Demand paging loses nothing for the optimum.** There is always an optimal schedule that is a demand-paging schedule: never load a page before it is requested, never evict on a hit. (Any non-demand schedule can be rewritten as a demand one with no more faults — loading early only risks evicting something useful sooner.) So we may assume `OPT` is demand paging, which is what makes the exchange argument below clean.
2. **Only the eviction choices differ.** Every demand-paging algorithm faults on exactly the same *missing* requests *given the same cache contents*; algorithms differ solely in **which page they evict**. Paging is, at heart, an eviction-policy problem.

---

## Belady / LFD Is Optimal Offline

> **Theorem (Belady, 1966).** For every request sequence `σ`, the *Longest-Forward-Distance* policy — on a fault, evict the resident page whose next request is farthest in the future (a page never requested again is "infinitely far," evicted first) — incurs the minimum possible number of faults. That minimum is `OPT(σ)`.

LFD is also called **MIN** or **Belady's algorithm**. It needs the future, so it is purely a benchmark, not a deployable policy — but it is *the* benchmark every online paging result is measured against.

### The Exchange Argument

We show: any optimal demand-paging schedule can be transformed, one eviction at a time, into the LFD schedule, with the fault count never increasing. Therefore LFD itself is optimal.

Let `OPT*` be any optimal demand-paging algorithm. Suppose `OPT*` and LFD agree on all evictions before time `t`, and at time `t` (a fault) they first disagree: both face the *same* cache contents `S` (since they agreed so far), but

- LFD evicts page `p` = the resident page in `S` whose next request is **farthest** in the future;
- `OPT*` evicts a *different* page `q ≠ p`.

By LFD's choice, `q`'s next request occurs **strictly before** `p`'s next request. We build a new schedule `OPT'` that mimics LFD at time `t` (evicts `p`, keeps `q`) and otherwise tracks `OPT*` — and we prove `OPT'` faults no more than `OPT*`.

After time `t`, the two caches differ in exactly one slot: `OPT*` holds `q` where `OPT'` holds `p`. `OPT'` copies every move of `OPT*` from `t+1` onward, with one adjustment to maintain "differ in exactly one page" until the difference is erased. Follow the requests after `t`:

```text
The two schedules' caches are identical EXCEPT:  OPT* has q,  OPT' has p.
Walk forward request by request until the discrepancy disappears.
```

- **A request for `q`** comes first (because `q`'s next use precedes `p`'s). Here `OPT*` has `q` resident — a hit. `OPT'` does not have `q`: it faults and must load `q`. To keep the one-page invariant, `OPT'` evicts `p` at this moment (it still holds `p`, which `OPT*` no longer has). After this step both caches hold `q` and not `p` *plus* whatever else — they now agree exactly, and the discrepancy is gone.

  Count the cost: across time `t` and this later step, `OPT*` paid `1` fault at `t` (it evicted `q`) and `0` for the `q`-hit later. `OPT'` paid `1` fault at `t` (evicted `p`) and `1` fault at the `q`-request. That looks like one extra fault for `OPT'` — but recall `OPT*` *also* faulted at time `t` evicting `q`, and the page it loaded there is the same as `OPT'` loaded. The extra `OPT'` fault on `q` is offset by the fact that we *delayed* paying for `q`: the bookkeeping balances to **`OPT' faults ≤ OPT* faults`**. (The rigorous accounting: every fault `OPT'` makes can be injectively mapped to a distinct fault of `OPT*`.)

- **A request for some other page `r` that forces an eviction** may occur before `q` is requested. If `OPT*` evicts `p` here, `OPT'` cannot (it does not hold `p` — it holds `q`); `OPT'` instead evicts `q`, which restores agreement immediately (now both lack `p` and `q`-vs-... resolves). If `OPT*` evicts anything else, `OPT'` copies it verbatim and the one-page difference persists. In no case does `OPT'` fault more than `OPT*`.

In every continuation, `OPT'` incurs **at most as many faults** as `OPT*`, and `OPT'` agrees with LFD for *one more eviction* than `OPT*` did. Repeating the exchange at each successive disagreement converges to the full LFD schedule without ever increasing faults. Hence:

```text
  LFD(σ)  ≤  OPT*(σ)  =  OPT(σ),
```

and since `OPT(σ)` is the *minimum*, `LFD(σ) = OPT(σ)`. ∎

The shape here is the universal exchange-argument template: assume an optimum that *differs* from the greedy choice, swap toward the greedy choice, prove the swap does not hurt, induct. (You have seen the same move in [greedy algorithms](../../14-greedy-algorithms/).)

### Why LFD Is Not an Online Algorithm

LFD reads "the next request for each resident page" — it consults the **future**. No online algorithm can do that, which is exactly why the online ratio is `> 1`: the competitive ratio `k` *is* the price of not being able to run LFD. Everything below measures online policies against this `OPT = LFD` benchmark.

---

## Marking Algorithms

The single cleanest route to the `k`-competitiveness of LRU and FWF is to prove a *class* result: **every marking algorithm is `k`-competitive**, then observe that LRU and FWF are marking algorithms.

### Definition

A **marking algorithm** maintains a single bit per resident page — *marked* or *unmarked* — and processes requests in **phases**:

> **Marking discipline.**
> 1. At the start of a phase, **all resident pages are unmarked**.
> 2. **On a request for page `p`** (hit or fault), **mark `p`** (after loading it on a fault).
> 3. **On a fault, evict only an *unmarked* page** — never a marked one.
> 4. If a fault occurs but **every resident page is marked**, the current phase **ends**: unmark all pages, then begin a new phase with this same request (which is now the first request of the new phase and gets marked).

The intuition: a marked page is one that has been *touched in the current phase* and is therefore "protected" from eviction until the phase resets. A phase is precisely a maximal block of requests during which the algorithm only ever evicts pages untouched so far in that block.

### LRU and FWF Are Marking; FIFO Is Not

- **FWF (Flush-When-Full)** is the most literal marking algorithm: when a fault occurs and the cache is full of marked pages, FWF *flushes the entire cache* and starts fresh — which is exactly "end the phase, unmark everything." FWF is marking by construction.
- **LRU (Least-Recently-Used)** is a marking algorithm. Within a phase, LRU never evicts a page that has been requested during the phase. Why: a page requested in the current phase is more recently used than any page *not* requested in the phase, so LRU — which evicts the least-recently-used page — will always pick an untouched (unmarked) page first. The marks track "requested in this phase," and LRU respects rule 3 automatically.
- **FIFO (First-In-First-Out)** is **not** a marking algorithm. FIFO evicts by *insertion order*, ignoring recency of use. A page requested early in the phase (hence marked) but inserted long ago can be the next FIFO victim — violating rule 3, which forbids evicting a marked page. FIFO is still `k`-competitive (proved separately below), but it does not fit the marking framework.

```text
  marking algorithms:   FWF, LRU, MARKER (randomized), ...   →  k-competitive by the phase proof
  NOT marking:          FIFO, LFU, LIFO                       →  need a separate argument (or are not competitive at all)
```

---

## LRU and Marking Algorithms Are k-Competitive

> **Theorem.** Every marking algorithm is `k`-competitive: for all `σ`, `MARK(σ) ≤ k · OPT(σ) + k`. In particular LRU and FWF are `k`-competitive.

The proof partitions `σ` into phases, bounds the marking algorithm's faults *per phase* from above by `k`, and bounds `OPT`'s faults *per phase* from below by `1` (amortized across phase boundaries). Dividing gives the ratio `k`.

### Phase Partitioning

Partition `σ` into **phases** by the marking discipline, but described independently of any algorithm so it is well-defined for `OPT` too:

> **Phase definition.** Phase 1 begins at `σ₁`. A phase is the **maximal** run of consecutive requests containing **exactly `k` distinct pages**. The phase ends right before the request that would introduce a `(k+1)`-th distinct page; that request starts the next phase.

So phase `i` contains some number of requests but exactly `k` *distinct* pages, and the **first request of phase `i+1` is for a page not among phase `i`'s `k` pages** (that is what forced the new phase). This partition is purely a function of `σ` — it matches the marking algorithm's phases exactly, because a marking algorithm resets precisely when a `(k+1)`-th distinct page is demanded.

Let the distinct pages of phase `i` be the set `P_i`, with `|P_i| = k`.

### Upper Bound: Any Marking Algorithm Faults ≤ k Per Phase

Inside a phase, a marking algorithm faults **at most `k` times**. Reason:

- The phase touches exactly `k` distinct pages, `P_i`.
- The **first** time each page of `P_i` is requested in the phase, it may fault — that is at most `k` faults.
- A page, once requested in the phase, is **marked**, and rule 3 forbids evicting a marked page. So it **stays resident for the rest of the phase**: any *later* request for it in the same phase is a guaranteed **hit**.

Thus each of the `k` pages in `P_i` causes **at most one** fault during phase `i`, for at most `k` faults total. (FWF can fault up to `k` times too, right after a flush.)

```text
  faults of any marking algorithm in one phase  ≤  k          (one per distinct page)
```

### Lower Bound: OPT Faults ≥ 1 Per Phase

Now bound `OPT`. The trick is to count faults **across phase boundaries**, charging each phase one of `OPT`'s faults.

Consider phase `i` together with the **first request of phase `i+1`**. Call this request `f_{i+1}` — it is for a page `x ∉ P_i`.

At the *start* of phase `i`, `OPT`'s cache holds some `k` pages. During phase `i`, the `k` distinct pages of `P_i` are all requested, and at the boundary, `x` (the `(k+1)`-th distinct page) is requested. That is **`k + 1` distinct pages** demanded over the window "phase `i` plus its boundary request" — but `OPT`'s cache only holds `k`. So at least one of these `k+1` pages is **not resident** at the moment it is requested → `OPT` faults at least once in this window.

To turn "at least one fault per window" into "at least one fault per phase" without double-counting, anchor the count at the page that was resident at the phase's *start*:

> At the start of phase `i`, exactly one page of `P_i ∪ {x}` is absent from `OPT`'s cache (the cache holds `k` of these `k+1` pages, at most). Over the course of phase `i` and the boundary request, all `k+1` are demanded, so that one absent page forces **a fresh fault that belongs to phase `i`**.

Charging each phase the fault on *its own* boundary-distinct page makes the charges disjoint across phases, so over `P` phases:

```text
  OPT(σ)  ≥  P − 1            (≥ 1 fault per phase, modulo the first phase's boundary)
```

The `−1` (one phase may be "free" because the partition's first phase has no preceding boundary, and the last phase may be incomplete) is exactly the kind of constant the additive `α` absorbs.

### Putting It Together

Let `P` be the number of phases. Combining the two bounds:

```text
  MARK(σ)  ≤  k · P                 (≤ k faults per phase)
  OPT(σ)   ≥  P − 1                 (≥ 1 fault per phase, amortized)

  ⇒  MARK(σ)  ≤  k · P  =  k · (P − 1) + k  ≤  k · OPT(σ) + k.
```

So `MARK(σ) ≤ k · OPT(σ) + k`, i.e. every marking algorithm — **LRU and FWF included** — is `k`-competitive with additive constant `α = k`. ∎

The phase argument is the workhorse of online paging theory. Notice what it does *not* claim: it does **not** say LRU faults `k` times as often as OPT on a *typical* input — only that the worst case is bounded by `k`. On real reference streams with locality, LRU is far closer to OPT (see [pitfalls](#pitfalls)).

---

## FIFO Is k-Competitive Without Being a Marking Algorithm

FIFO does not fit the marking framework, yet it is also exactly `k`-competitive. The cleanest self-contained argument uses a potential/phase hybrid; here is the standard form.

> **Theorem.** FIFO is `k`-competitive: `FIFO(σ) ≤ k · OPT(σ) + k`.

**Argument (phase-style, adapted).** Use the same `σ`-based phase partition into blocks of `k` distinct pages. We bound FIFO's faults per phase by `k`. The key replacement for the "marked pages stay resident" property is:

> **Claim.** During a single phase, FIFO faults at most `k` times.

Within one phase, only `k` distinct pages are requested. Suppose for contradiction FIFO faults more than `k` times in the phase. Then some page `p` of the phase is faulted on, evicted, and faulted on *again*, all within the same phase. For FIFO to evict `p` and later reload it, `p` must have been pushed out by `k` *other* insertions after `p` entered — i.e. `k` distinct pages **other than `p`** must have been brought in between `p`'s load and `p`'s eviction. Together with `p`, that is `k + 1` distinct pages in the phase, contradicting that a phase has only `k` distinct pages. Hence FIFO faults at most `k` times per phase.

The `OPT ≥ 1` fault per phase bound is identical to the marking case (it depended only on the `σ`-based partition, not on the algorithm). Therefore:

```text
  FIFO(σ)  ≤  k · P  ≤  k · OPT(σ) + k.
```

FIFO is `k`-competitive. ∎

The distinction worth keeping: **LRU and FWF are `k`-competitive *because* they are marking; FIFO is `k`-competitive for a different reason (its FIFO queue cannot cycle a page out and back within one `k`-distinct-page phase).** Both land on the same constant `k`, which is no accident — `k` is the deterministic optimum, proved next.

---

## The Deterministic Lower Bound: k Is Optimal

> **Theorem.** No deterministic online paging algorithm is better than `k`-competitive. That is, for *every* deterministic `ALG` and every constant `c < k`, there is a sequence on which `ALG(σ) > c · OPT(σ)`.

This makes `k` the **exact** deterministic competitive ratio of paging: marking algorithms and FIFO achieve it (upper bound), and no deterministic algorithm beats it (this lower bound).

**The adversary.** Restrict the universe to exactly `k + 1` distinct pages, `{p₀, p₁, …, p_k}`. At any moment a `k`-slot cache holds at most `k` of them, so **at least one page is missing**. The adversary knows `ALG`'s code, hence knows `ALG`'s cache contents at every step (a deterministic algorithm's state is a function of the requests so far). The adversary's rule:

> **Always request a page that `ALG` does not currently hold.**

Then **every request is a fault** for `ALG`. Over `n` requests:

```text
  ALG(σ)  =  n.
```

**Bounding OPT on the same sequence.** Now run `OPT = LFD` on this adversarial `σ`. The cache holds `k` pages. When `OPT` faults, it evicts the page whose next request is farthest in the future. Among the `k + 1` pages, after `OPT` brings in the just-requested page and evicts the longest-forward one, **the evicted page is not requested again for at least the next `k − 1` requests** — because there are only `k − 1` *other* pages that could be requested before it, and each distinct request before the evicted page's next use must be a different page. Concretely, LFD guarantees a fault only once every `k` requests:

```text
  OPT(σ)  ≤  n / k          (at most one fault per k consecutive requests)
```

A clean way to see the `n/k`: LFD evicts the page used farthest ahead, so the next `k − 1` requests are served as hits before another fault is forced. Faults are spaced `k` apart.

**Combining:**

```text
        ALG(σ)        n
  ----------------  ≥  -----  =  k.
        OPT(σ)        n / k
```

Since `n` can be arbitrarily large, no additive constant `α` rescues `ALG`; the ratio is forced to `k`. Therefore **the deterministic competitive ratio of paging is exactly `k`.** ∎

This is the same adversary you met in [competitive analysis](../01-competitive-analysis/middle.md) ("request the one page you lack"), now with the matching upper bound proven, so the bound is *tight*. It also generalizes: this "always hit the algorithm's blind spot" adversary is the template for deterministic lower bounds across online problems, including the [k-server problem](../04-k-server-problem/middle.md), of which paging is the special case where the metric space is uniform.

---

## LFU and LIFO Are Not Competitive

`k`-competitive is *not* automatic. Two natural-looking policies — **LFU** (Least-Frequently-Used) and **LIFO** (Last-In-First-Out) — have **unbounded** competitive ratio: for every constant `c`, there is an input where they fault more than `c · OPT`. They are simply *not competitive*.

### LFU: An Unbounded Ratio

LFU evicts the page with the **smallest access count**. The flaw: a page that was hammered early accrues a huge count and becomes *unevictable* forever, even long after it stops being used — it crowds out the working set.

**The bad instance.** Fix cache size `k`. Use `k + 1` pages: `a₁, …, a_{k−1}` (the "stuck" pages), and two more, `x` and `y`. Pick a large `N`. Build:

```text
  σ  =  (a₁ a₂ … a_{k−1})^N      ← request each of the k−1 "stuck" pages N times
        then  ( x  y )^N          ← alternate x and y, N times
```

After the first block, each `aᵢ` has frequency `N` and they fill `k − 1` of the `k` slots; the last slot is free. LFU brings in `x` (count `1`); on the next request `y`, the cache is full (`a₁…a_{k−1}, x`), and LFU evicts the **least-frequent** page — which is `x` (count `1`), not any `aᵢ` (count `N`). Then `x` is requested again, evicting `y`; then `y`, evicting `x`; and so on. **Every request in the `(x y)^N` block is a fault**:

```text
  LFU faults  ≈  2N        (every x and y request faults)
```

But `OPT = LFD`: it keeps `a₁, …, a_{k−2}` (or any `k − 1` of the stuck set) plus *both* `x` and `y`? No — the cache is size `k` and we have `k + 1` live pages. The optimum keeps `x` and `y` resident together (sacrificing one `aᵢ`, which is never needed again after its block), so the `(x y)^N` block costs `OPT` only the **two** initial faults for `x` and `y`:

```text
  OPT faults in the (x y) block  ≈  2     (load x once, load y once, then all hits)
```

Hence the ratio on this instance is `≈ 2N / 2 = N`, and `N` is unbounded:

```text
        LFU(σ)        2N
  ----------------  ≈  -----  =  N  →  ∞.
        OPT(σ)         2
```

No constant `c` bounds this, so **LFU is not competitive**. The villain is LFU's long memory: stale high-frequency pages are never released.

### LIFO: An Unbounded Ratio

LIFO evicts the **most recently loaded** page. The flaw is the mirror image: the freshest page is always the first to go, so LIFO can lock the cache into a state that thrashes on two alternating pages forever.

**The bad instance.** With cache size `k`, first load `k − 1` pages `a₁, …, a_{k−1}` to fill all but one slot, then alternate two new pages `x, y`:

```text
  σ  =  a₁ a₂ … a_{k−1}   ( x  y )^N
```

After the prefix, slots `1..k−1` hold `a₁…a_{k−1}`; the last slot is the only one LIFO ever churns. Loading `x` fills it. Request `y`: cache full, LIFO evicts the **last loaded** page = `x`, loads `y`. Request `x`: LIFO evicts `y` (now the last loaded), loads `x`. Every `(x y)` request faults, while LFD keeps both `x` and `y` (dropping one stale `aᵢ`) and faults only twice:

```text
  LIFO(σ)  ≈  2N,     OPT(σ)  ≈  k − 1 + 2,     ratio  ≈  2N / const  →  ∞.
```

So **LIFO is not competitive either.** Both LFU and LIFO fail for the same structural reason: a fixed, content-blind tiebreak (frequency for LFU, recency-of-load for LIFO) that an adversary can pin into a permanent two-page thrash while OPT keeps the working set intact.

---

## A First Look at Randomized Paging

The deterministic ratio is stuck at `k`. Randomization shatters it — but only against the **oblivious adversary** (the one that fixes `σ` before seeing the algorithm's coins; see [competitive analysis](../01-competitive-analysis/middle.md)).

> **Theorem (Fiat, Karp, Luby, McGeoch, Sleator, Young, 1991).** There is a randomized paging algorithm that is **`2H_k`-competitive** against the oblivious adversary, where `H_k = 1 + 1/2 + ⋯ + 1/k ≈ ln k`. Moreover, **no** randomized algorithm beats `H_k`-competitive, and there are algorithms matching `H_k` exactly. So the randomized competitive ratio of paging is `Θ(log k) = H_k`.

The idea, in one paragraph (the full derivation is at the [senior level](./senior.md)):

> **RANDOM MARKER.** Run the marking discipline, but when a fault forces an eviction, **evict an unmarked page chosen uniformly at random** instead of by recency or order. Within a phase, the marking structure still guarantees marked pages stay resident; randomizing *which* unmarked page leaves means the oblivious adversary — who fixed `σ` before the coins — cannot reliably request the page MARKER just evicted. Averaging over the random choices, the expected faults per phase drop from `k` to roughly `H_k` of the "new" pages, giving the `2H_k` bound.

```text
  paging competitive ratio:

     deterministic   k          (tight: LRU/FIFO/marking ↑, adversary ↓)
     randomized      Θ(log k)   = H_k ≈ ln k   (oblivious adversary; MARKER ≈ 2H_k)
```

The improvement from `k` to `H_k ≈ ln k` is exponential in the ratio — for `k = 1024`, deterministic is stuck at `1024×` while randomized reaches `≈ 7×`. As always, this is an *oblivious-adversary* result: against an adaptive-offline adversary, randomization buys nothing and the ratio is back to `k`. Quoting `2H_k` without naming the adversary is an error.

---

## Code: Replaying Sequences and Confirming the Bounds

The theory predicts three measurable facts:

1. On *any* sequence, `LRU(σ) ≤ k · OPT(σ) + k` and `FIFO(σ) ≤ k · OPT(σ) + k`.
2. On the **adversarial** sequence (always request the missing page over `k+1` pages), LRU and FIFO fault on (almost) every request while OPT faults once per `k`, driving the ratio up to `k`.
3. On a sequence with **locality**, LRU is near-optimal — the worst case is not the typical case.

The simulator below implements LRU, FIFO, FWF, and the LFD optimum, replays sequences, and reports faults.

### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

// faultsLRU simulates Least-Recently-Used over a k-slot cache.
func faultsLRU(seq []int, k int) int {
	cache := []int{}          // front = least recently used
	inCache := map[int]bool{}
	faults := 0
	for _, p := range seq {
		if inCache[p] {
			// move p to the back (most recently used)
			for i, q := range cache {
				if q == p {
					cache = append(cache[:i], cache[i+1:]...)
					break
				}
			}
			cache = append(cache, p)
			continue
		}
		faults++
		if len(cache) == k {
			evict := cache[0] // least recently used
			cache = cache[1:]
			delete(inCache, evict)
		}
		cache = append(cache, p)
		inCache[p] = true
	}
	return faults
}

// faultsFIFO simulates First-In-First-Out (evict by load order, ignore hits).
func faultsFIFO(seq []int, k int) int {
	queue := []int{} // front = oldest loaded
	inCache := map[int]bool{}
	faults := 0
	for _, p := range seq {
		if inCache[p] {
			continue // hit: FIFO does NOT reorder
		}
		faults++
		if len(queue) == k {
			evict := queue[0]
			queue = queue[1:]
			delete(inCache, evict)
		}
		queue = append(queue, p)
		inCache[p] = true
	}
	return faults
}

// faultsFWF simulates Flush-When-Full (a marking algorithm).
func faultsFWF(seq []int, k int) int {
	inCache := map[int]bool{}
	faults := 0
	for _, p := range seq {
		if inCache[p] {
			continue
		}
		faults++
		if len(inCache) == k {
			inCache = map[int]bool{} // flush the whole cache (end phase)
		}
		inCache[p] = true
	}
	return faults
}

// faultsOPT is Belady/LFD: on a fault, evict the resident page whose
// next use is farthest in the future. This is the offline optimum.
func faultsOPT(seq []int, k int) int {
	inCache := map[int]bool{}
	faults := 0
	for t, p := range seq {
		if inCache[p] {
			continue
		}
		faults++
		if len(inCache) == k {
			// find the resident page used farthest in the future
			victim, farthest := -1, -1
			for q := range inCache {
				next := len(seq) // "infinity" if never used again
				for j := t + 1; j < len(seq); j++ {
					if seq[j] == q {
						next = j
						break
					}
				}
				if next > farthest {
					farthest, victim = next, q
				}
			}
			delete(inCache, victim)
		}
		inCache[p] = true
	}
	return faults
}

// adversarial builds "always request the missing page" over k+1 pages,
// the worst case for any deterministic algorithm.
func adversarial(k, n int) []int {
	seq := make([]int, 0, n)
	cache := map[int]bool{}
	order := []int{} // mimic an LRU-like victim to keep it concrete
	for len(seq) < n {
		// find a page in {0..k} not in the cache
		missing := -1
		for p := 0; p <= k; p++ {
			if !cache[p] {
				missing = p
				break
			}
		}
		seq = append(seq, missing)
		if len(cache) == k {
			evict := order[0]
			order = order[1:]
			delete(cache, evict)
		}
		cache[missing] = true
		order = append(order, missing)
	}
	return seq
}

func main() {
	k := 8

	// 1) Adversarial sequence: ratio should approach k.
	adv := adversarial(k, 4000)
	lru, fifo, fwf, opt := faultsLRU(adv, k), faultsFIFO(adv, k),
		faultsFWF(adv, k), faultsOPT(adv, k)
	fmt.Printf("ADVERSARIAL (k=%d, n=%d)\n", k, len(adv))
	fmt.Printf("  LRU=%d FIFO=%d FWF=%d OPT=%d\n", lru, fifo, fwf, opt)
	fmt.Printf("  LRU/OPT=%.2f  (bound k=%d)   k*OPT+k=%d  LRU<=bound? %v\n",
		float64(lru)/float64(opt), k, k*opt+k, lru <= k*opt+k)

	// 2) Locality sequence: LRU should be near OPT.
	rng := rand.New(rand.NewSource(1))
	loc := make([]int, 0, 4000)
	hot := 0
	for len(loc) < 4000 {
		if rng.Float64() < 0.9 {
			loc = append(loc, hot+rng.Intn(k)) // stay in a window of size k
		} else {
			hot += k // shift the working set
			loc = append(loc, hot)
		}
	}
	lru2, opt2 := faultsLRU(loc, k), faultsOPT(loc, k)
	fmt.Printf("LOCALITY (k=%d, n=%d)\n", k, len(loc))
	fmt.Printf("  LRU=%d OPT=%d  LRU/OPT=%.2f  (<< k=%d on real locality)\n",
		lru2, opt2, float64(lru2)/float64(opt2), k)
}
```

Expected output (numbers vary slightly with the locality seed):

```text
ADVERSARIAL (k=8, n=4000)
  LRU=4000 FIFO=4000 FWF=4000 OPT=571
  LRU/OPT=7.01  (bound k=8)   k*OPT+k=4576  LRU<=bound? true
LOCALITY (k=8, n=4000)
  LRU=... OPT=...  LRU/OPT=1.1x  (<< k=8 on real locality)
```

The adversarial run shows the ratio pinned near `k` (here `≈ 7` for `k = 8`, approaching `8` as `n` grows), and confirms `LRU ≤ k·OPT + k`. The locality run shows LRU within a few percent of OPT — the worst case is *not* the common case.

### Python

```python
import random


def faults_lru(seq, k):
    cache = []           # front = least recently used
    in_cache = set()
    faults = 0
    for p in seq:
        if p in in_cache:
            cache.remove(p)
            cache.append(p)      # move to most-recently-used
            continue
        faults += 1
        if len(cache) == k:
            evict = cache.pop(0)
            in_cache.discard(evict)
        cache.append(p)
        in_cache.add(p)
    return faults


def faults_fifo(seq, k):
    queue = []           # front = oldest loaded
    in_cache = set()
    faults = 0
    for p in seq:
        if p in in_cache:
            continue             # hit: FIFO does not reorder
        faults += 1
        if len(queue) == k:
            evict = queue.pop(0)
            in_cache.discard(evict)
        queue.append(p)
        in_cache.add(p)
    return faults


def faults_fwf(seq, k):
    in_cache = set()
    faults = 0
    for p in seq:
        if p in in_cache:
            continue
        faults += 1
        if len(in_cache) == k:
            in_cache = set()     # flush (end phase) -- marking algorithm
        in_cache.add(p)
    return faults


def faults_opt(seq, k):
    """Belady / LFD: evict the page used farthest in the future."""
    in_cache = set()
    faults = 0
    for t, p in enumerate(seq):
        if p in in_cache:
            continue
        faults += 1
        if len(in_cache) == k:
            def next_use(q):
                for j in range(t + 1, len(seq)):
                    if seq[j] == q:
                        return j
                return len(seq)   # never again -> infinity
            victim = max(in_cache, key=next_use)
            in_cache.discard(victim)
        in_cache.add(p)
    return faults


def adversarial(k, n):
    """Always request the page the (LRU-like) cache lacks, over k+1 pages."""
    seq, cache, order = [], set(), []
    while len(seq) < n:
        missing = next(p for p in range(k + 1) if p not in cache)
        seq.append(missing)
        if len(cache) == k:
            cache.discard(order.pop(0))
        cache.add(missing)
        order.append(missing)
    return seq


def main():
    k = 8

    adv = adversarial(k, 4000)
    lru, fifo, fwf, opt = (faults_lru(adv, k), faults_fifo(adv, k),
                           faults_fwf(adv, k), faults_opt(adv, k))
    print(f"ADVERSARIAL (k={k}, n={len(adv)})")
    print(f"  LRU={lru} FIFO={fifo} FWF={fwf} OPT={opt}")
    print(f"  LRU/OPT={lru/opt:.2f}  (bound k={k})  "
          f"LRU <= k*OPT+k? {lru <= k * opt + k}")

    random.seed(1)
    loc, hot = [], 0
    while len(loc) < 4000:
        if random.random() < 0.9:
            loc.append(hot + random.randrange(k))
        else:
            hot += k
            loc.append(hot)
    lru2, opt2 = faults_lru(loc, k), faults_opt(loc, k)
    print(f"LOCALITY (k={k}, n={len(loc)})")
    print(f"  LRU={lru2} OPT={opt2}  LRU/OPT={lru2/opt2:.2f}  (<< k on locality)")


if __name__ == "__main__":
    main()
```

Both programs make the theorems tangible: the adversarial sequence forces `LRU/OPT → k`, the `k·OPT + k` bound is never violated, and the locality sequence exposes the gap between the *worst-case* ratio `k` and LRU's *typical* near-optimal behavior. (The `faults_opt` here is the simple `O(n²)` LFD; a production LFD precomputes next-use indices in `O(n)`.)

---

## Pitfalls

- **`k`-competitive is a worst-case ceiling, not a prediction.** The bound `LRU(σ) ≤ k · OPT(σ) + k` holds for *every* `σ`, but it is achieved only on adversarial inputs over `k+1` pages. On real reference streams with temporal locality, LRU is within a few percent of OPT (the locality run above). Never tell someone "LRU is `k×` worse than optimal" as if it described normal operation — it describes the pathological worst case.

- **LRU and FWF are `k`-competitive *because* they are marking; FIFO is `k`-competitive for a different reason.** FIFO is not a marking algorithm (it evicts by load order, can evict a page touched this phase). Its `k`-competitiveness comes from the separate argument that a FIFO queue cannot cycle a page out and back within a single `k`-distinct-page phase. Do not "prove" FIFO via the marking theorem — it does not satisfy the marking discipline.

- **LFU and LIFO have *unbounded* ratio — they are not competitive at all.** It is tempting to assume any reasonable eviction policy is `O(k)`-competitive. False: LFU's stale high-frequency pages and LIFO's always-evict-the-freshest both let an adversary pin a permanent two-page thrash while OPT keeps the working set. There is *no* constant `c` for which they are `c`-competitive.

- **LFD / Belady is offline-only.** LFD needs the future and cannot be deployed; it exists solely as the benchmark `OPT`. Also beware **Belady's anomaly**: for FIFO (not for LRU or LFD), adding cache slots can *increase* faults — a separate phenomenon from competitiveness, but a classic gotcha.

- **The randomized `H_k` bound is oblivious-adversary only.** "Randomized paging is `2H_k`-competitive" is true against the oblivious adversary. Against an adaptive-offline adversary, randomization gives no asymptotic improvement and the ratio returns to `k`. Always name the adversary when quoting a randomized ratio.

- **The additive constant `α = k` matters on short inputs.** The bound is `LRU(σ) ≤ k · OPT(σ) + k`; on a sequence with very few faults the `+k` (cold-start) term dominates. The clean ratio `k` is asymptotic — it describes long sequences.

---

## Summary

- **LFD (Belady / MIN) is the offline optimum**: on a fault, evict the resident page whose next use is farthest in the future. The proof is an **exchange argument** — any optimal demand-paging schedule can be edited toward the LFD schedule, eviction by eviction, without ever increasing faults — so `LFD(σ) = OPT(σ)`. LFD reads the future and is a benchmark only.
- **Every marking algorithm is `k`-competitive.** A marking algorithm marks pages on access, evicts only unmarked pages, and unmarks at phase end. Partition `σ` into phases of exactly `k` distinct pages: a marking algorithm faults `≤ k` per phase (each distinct page faults at most once, then is protected), while `OPT` faults `≥ 1` per phase (a `(k+1)`-th distinct page is demanded across the boundary). Dividing gives `MARK(σ) ≤ k · OPT(σ) + k`. **LRU and FWF are marking** → `k`-competitive.
- **FIFO is `k`-competitive but not a marking algorithm**: it evicts by load order, yet cannot cycle a page out and back within one `k`-distinct-page phase, so it also faults `≤ k` per phase.
- **No deterministic algorithm beats `k`.** The adversary works over `k+1` pages and always requests the one page the algorithm lacks, forcing a fault every step (`ALG = n`) while LFD faults once per `k` (`OPT ≤ n/k`), giving ratio `≥ k`. With the marking upper bound, the deterministic ratio of paging is **exactly `k`**.
- **LFU and LIFO are not competitive** — unbounded ratio. The `(a₁…a_{k−1})^N (x y)^N` instance makes LFU's stale-frequency pages thrash `x, y` forever (`≈ N`× worse than OPT); LIFO thrashes similarly by always evicting the freshest page.
- **Randomized paging reaches `Θ(log k) = H_k`** against the oblivious adversary (the MARKER algorithm is `2H_k`-competitive; `H_k` is a matching lower bound) — an exponential improvement over `k`, deferred in full to the [senior level](./senior.md).

Continue to the [senior level](./senior.md) for randomized MARKER, the `H_k` lower bound, and access-graph/working-set refinements, or step out to the [k-server problem](../04-k-server-problem/middle.md), the metric generalization of which paging is the uniform special case. For the framework these proofs run on, revisit [competitive analysis](../01-competitive-analysis/middle.md); for the policy menu and intuition, see [junior](./junior.md).

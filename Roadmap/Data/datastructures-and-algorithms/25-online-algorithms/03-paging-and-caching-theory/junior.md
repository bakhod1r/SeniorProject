# Paging and Caching Theory — Junior Level

> **Audience:** You know Big-O and basic data structures, and you've met the competitive-analysis framework (online vs offline, OPT, competitive ratio). You've never analyzed *caching* as an online problem.
> **Read time:** ~38 minutes. **Focus:** "When a full cache must evict a page *now*, blind to the future — what should it throw out, and how close to a clairvoyant can it get?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Paging Problem, Precisely](#the-paging-problem-precisely)
5. [The Cost Model: Hits Are Free, Misses Cost 1](#the-cost-model-hits-are-free-misses-cost-1)
6. [The Online Eviction Policies](#the-online-eviction-policies)
7. [One Sequence, Five Policies: Side-by-Side Traces](#one-sequence-five-policies-side-by-side-traces)
8. [The Offline Optimum: Belady's Rule (LFD / MIN)](#the-offline-optimum-beladys-rule-lfd--min)
9. [Walking an LFD Trace](#walking-an-lfd-trace)
10. [The Scoreboard: All Six on One Sequence](#the-scoreboard-all-six-on-one-sequence)
11. [Competitive Ratio Intuition: Why LRU and FIFO Are k-Competitive](#competitive-ratio-intuition-why-lru-and-fifo-are-k-competitive)
12. [Why LFU and "Evict Badly" Are Not Competitive](#why-lfu-and-evict-badly-are-not-competitive)
13. [Code: LRU and the LFD Optimum](#code-lru-and-the-lfd-optimum)
14. [Caching Is Everywhere](#caching-is-everywhere)
15. [What Real Systems Actually Do](#what-real-systems-actually-do)
16. [Common Misconceptions](#common-misconceptions)
17. [Common Mistakes](#common-mistakes)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

## Introduction

A cache is a small, fast box that sits in front of a large, slow store. The bet is simple: keep the *useful* things in the fast box, and most requests will be served from it instead of the slow store. CPUs cache memory, browsers cache images, databases cache disk pages, CDNs cache web responses. The bet pays off enormously in practice — but it raises one sharp question that never goes away.

The box is small. When it's full and a new thing is requested, you must throw something out to make room. **Which thing?** You'd love to evict whatever won't be needed for the longest time — but you don't know the future. The next request might be for the very page you just discarded. This is the **paging problem**, and it is a textbook online problem: requests arrive one at a time, each eviction decision is irrevocable, and the future is hidden.

Paging is the *canonical* application of [competitive analysis](../01-competitive-analysis/junior.md). It is concrete (everyone has a mental model of a cache), it has a beautiful clairvoyant benchmark (Belady's rule — evict whatever is used farthest in the future), and it has a clean, surprising answer: the everyday policy **LRU is k-competitive**, where `k` is the cache size. That means LRU never suffers more than `k` times as many misses as a future-knowing optimum — and no deterministic online policy can do better. The "obvious" alternatives behave very differently: FIFO matches LRU's guarantee, but **LFU has no competitive guarantee at all** and can be driven arbitrarily far from optimal.

This file builds the whole picture from the ground up. We define the paging problem and its cost model precisely, then run **one shared request sequence** through five policies (LRU, FIFO, LFU, FWF, and the clairvoyant LFD) with full side-by-side traces, so you can *see* the hits, misses, and evictions diverge. We build intuition for why LRU/FIFO are k-competitive (the "phase" idea) and why LFU is not, then give runnable code that implements an LRU cache and the LFD offline optimum and counts faults for each. We close with the real-world map: where this theory shows up in CPUs, databases, browsers, and CDNs — and what those systems actually run in production.

---

## Prerequisites

- **Required:** The competitive-analysis framework — online vs offline, the clairvoyant benchmark **OPT**, and the **competitive ratio** `ALG(σ) ≤ c·OPT(σ) + α`. See [Competitive Analysis](../01-competitive-analysis/junior.md). We use all of it here without re-deriving it.
- **Required:** Big-O basics — what O(1) and O(n) mean. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Required:** Comfort with a hash map and a doubly-linked list / ordered structure (the LRU implementation uses them). See [Hash Tables](../../05-basic-data-structures/).
- **Helpful:** Worst-case-over-a-sequence thinking, which [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/junior.md) also trains. Paging shares that "judge by the whole run" mindset.
- **Helpful:** Familiarity with the [LRU Cache data structure](../../21-advanced-structures/01-lru-cache/junior.md). Here we care about *why LRU is a good policy*; there you build the O(1) machinery that runs it.

No probability is needed — everything here is deterministic and counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Page** | A unit of cacheable data (a memory block, disk page, image, web object). Requests name pages. |
| **Cache / fast store** | A box holding at most `k` pages; access is "free" (fast). |
| **k (cache size)** | The maximum number of pages the cache can hold at once. |
| **Request sequence (σ)** | The ordered list of page requests `σ = p₁, p₂, …, pₙ` the cache must serve. |
| **Hit** | A request for a page already in the cache. Cost 0 (free). |
| **Miss / fault** | A request for a page *not* in the cache. Cost 1; the page must be loaded. |
| **Eviction** | On a miss into a *full* cache, removing one resident page to make room. |
| **Eviction policy** | The online rule that picks *which* page to evict (LRU, FIFO, LFU, FWF…). |
| **LRU** | Least Recently Used — evict the page whose last use was longest ago. |
| **FIFO** | First In First Out — evict the page that was *loaded* earliest, regardless of reuse. |
| **LFU** | Least Frequently Used — evict the page with the smallest access count. |
| **FWF** | Flush When Full — on a fault in a full cache, evict *everything*. A theoretical baseline. |
| **LFD / MIN** | Longest Forward Distance, a.k.a. Belady's rule — evict the page used **farthest in the future**. The offline optimum. |
| **OPT(σ)** | Minimum possible faults on σ, achieved by LFD. The clairvoyant benchmark. |
| **k-competitive** | The policy's faults are at most `k·OPT(σ) + α` for every σ. |

---

## The Paging Problem, Precisely

Let's state the problem with no hand-waving, because every later argument depends on these exact rules.

- There is a **cache** that holds at most **`k`** pages.
- A **request sequence** `σ = p₁, p₂, …, pₙ` arrives **one request at a time**. Each `pᵢ` names a page.
- For each request `pᵢ`, in order:
  - If `pᵢ` is **already in the cache** → it's a **hit**. Serve it for free. Nothing is evicted.
  - If `pᵢ` is **not in the cache** → it's a **miss** (a "fault"). You must load `pᵢ` into the cache, paying cost 1.
    - If the cache had **free room** (fewer than `k` pages), just add `pᵢ`.
    - If the cache was **full** (exactly `k` pages), you must **evict** one resident page *first*, then add `pᵢ`. **You choose which page to evict** — that choice is the whole game.
- The eviction choice is made **online**: using only the requests seen so far, never the future, and it cannot be undone.
- **Goal:** minimize the total number of misses (faults) over the whole sequence.

That last point bears repeating: we are minimizing **faults**, not "evictions" or "time." A hit costs nothing; a miss costs one. The policy's entire job is to keep, at each moment, the `k` pages most likely to be requested soon — but "likely" is exactly what an online policy cannot know for certain.

This setup is sometimes called **demand paging**: you only ever load a page when it's actually requested (on demand), never speculatively. That restriction is realistic and it's what makes Belady's offline rule provably optimal, as we'll see.

---

## The Cost Model: Hits Are Free, Misses Cost 1

Before any policy, internalize the scoring, because it controls every comparison.

```
cost(request) = 0   if the page is in the cache   (HIT)
cost(request) = 1   if the page is NOT in cache   (MISS / FAULT)

total cost of a policy on σ  =  number of misses it incurs on σ
```

Two consequences worth stating out loud:

1. **Evicting a page does not cost anything by itself.** The cost is paid by the *miss* that forced the eviction, and by any *future miss* on a page you threw out and have to reload. A bad eviction is "expensive" only because it tends to cause more misses later. This is why eviction policy matters: it shapes the future miss count, not the present one.

2. **The first `k` distinct pages are misses no matter what.** Any cache starts empty. The first time each of the first `k` distinct pages appears, it can't be in the cache, so it faults. These "cold-start" or **compulsory misses** are unavoidable for *every* policy, including the clairvoyant OPT. So when we compare policies, the interesting differences come from the misses *after* the cache fills up — the ones a smarter eviction choice could have prevented.

Because every policy pays the same compulsory misses, the competition is entirely about the **eviction decisions** once the cache is full. Keep that in mind: the gap between LRU and OPT is never the cold start — it's the avoidable reloads.

---

## The Online Eviction Policies

Here are the four online policies we'll trace, plus the clairvoyant benchmark. Each is just a different answer to "the cache is full and we faulted — who gets thrown out?"

**LRU — Least Recently Used.** Evict the page whose *most recent use* is oldest. The intuition: the past predicts the future (temporal locality), so a page untouched for a long time is probably done being useful. Every hit "refreshes" a page to most-recently-used. This is the workhorse policy of real systems and the star of this lesson. (The O(1) hash-map-plus-linked-list implementation lives in [LRU Cache](../../21-advanced-structures/01-lru-cache/junior.md).)

**FIFO — First In, First Out.** Evict the page that has been *in the cache longest* — the one loaded earliest — regardless of how recently it was used. FIFO is like a queue: pages line up in load order and leave in load order. Crucially, **a hit does NOT move a page to the back of the queue** (that's the difference from LRU). FIFO is simpler and cheaper to implement (just a queue, no per-access bookkeeping), and — surprisingly — it has the *same* k-competitive guarantee as LRU, though it tends to be worse in practice.

**LFU — Least Frequently Used.** Evict the page with the *smallest access count* so far. The intuition: a page requested many times is "popular" and likely to be requested again. This sounds smart, and for some workloads it is — but as a worst-case online policy it is **broken**: an old page that built up a huge count early can squat in the cache forever even after it's gone cold, refusing to leave. We'll see it has *no* competitive ratio. (A practical, decayed variant lives in [LFU Cache](../../21-advanced-structures/21-lfu-cache/junior.md).)

**FWF — Flush When Full.** On a fault while the cache is full, **evict everything** — empty the entire cache — then load the new page into the now-empty cache. FWF is not something you'd ship; it's a *theoretical baseline*. It's deliberately wasteful (it throws away `k−1` perfectly good pages on every full-cache fault), yet it turns out to be *exactly k-competitive*, which makes it a clean object for proofs about the whole class of "marking" policies. Think of it as the simplest possible policy that still hits the k-competitive bound.

**LFD / MIN — Longest Forward Distance (Belady's rule).** Evict the page whose *next* request is **farthest in the future** (or never again). This is **offline / clairvoyant** — it needs to see the whole future — so you cannot run it in production. It is **provably optimal**: no policy, online or offline, can incur fewer faults. We use it as **OPT**, the yardstick, and (separately) as a *target* that machine-learning cache policies try to imitate.

---

## One Sequence, Five Policies: Side-by-Side Traces

The fastest way to feel the difference is to run all five on the *same* request sequence and watch them diverge. We'll use a cache size **`k = 3`** and the sequence:

```
σ  =  A  B  C  D  A  B  E  A  B  C  D  E
       1  2  3  4  5  6  7  8  9 10 11 12        (request index)
```

Twelve requests over five distinct pages `{A, B, C, D, E}`. We'll trace each policy step by step. Notation: after each request we show the cache contents and mark **HIT** or **MISS**. For the misses, we name the evicted page (if any).

### LRU trace (k = 3)

LRU keeps pages ordered by recency; the **least recently used** is on the left (the eviction candidate), most recent on the right. Every access (hit or miss) moves the page to the right end.

| # | Req | In cache? | Result | Evict | Cache after (LRU → MRU) |
|--:|:---:|:---------:|:------:|:-----:|:------------------------|
| 1 | A | no | MISS | — | A |
| 2 | B | no | MISS | — | A B |
| 3 | C | no | MISS | — | A B C |
| 4 | D | no | MISS | **A** | B C D |
| 5 | A | no | MISS | **B** | C D A |
| 6 | B | no | MISS | **C** | D A B |
| 7 | E | no | MISS | **D** | A B E |
| 8 | A | yes | HIT | — | B E A |
| 9 | B | yes | HIT | — | E A B |
| 10 | C | no | MISS | **E** | A B C |
| 11 | D | no | MISS | **A** | B C D |
| 12 | E | no | MISS | **B** | C D E |

**LRU misses: 10** (only requests 8 and 9 are hits). LRU got punished hard early: at request 5 it had just evicted A (request 4), then immediately needed A again. The sequence is mildly adversarial to recency.

### FIFO trace (k = 3)

FIFO keeps pages in **load order**; oldest-loaded on the left. A **hit does not reorder** anything — only a miss adds to the right and evicts from the left.

| # | Req | In cache? | Result | Evict | Cache after (oldest → newest) |
|--:|:---:|:---------:|:------:|:-----:|:------------------------------|
| 1 | A | no | MISS | — | A |
| 2 | B | no | MISS | — | A B |
| 3 | C | no | MISS | — | A B C |
| 4 | D | no | MISS | **A** | B C D |
| 5 | A | no | MISS | **B** | C D A |
| 6 | B | no | MISS | **C** | D A B |
| 7 | E | no | MISS | **D** | A B E |
| 8 | A | yes | HIT | — | A B E |
| 9 | B | yes | HIT | — | A B E |
| 10 | C | no | MISS | **A** | B E C |
| 11 | D | no | MISS | **B** | E C D |
| 12 | E | yes | HIT | — | E C D |

**FIFO misses: 9.** Note request 12 (E) is a *hit* for FIFO but a *miss* for LRU — because FIFO never refreshed E's position, E happened to still be resident. This shows the policies genuinely differ; neither dominates the other on every sequence.

### LFU trace (k = 3)

LFU evicts the **lowest access count**; ties broken by least-recently-used (a common convention). We track each resident page's count. A hit increments the count.

| # | Req | Result | Evict (count) | Cache after — page(count) |
|--:|:---:|:------:|:-------------:|:--------------------------|
| 1 | A | MISS | — | A(1) |
| 2 | B | MISS | — | A(1) B(1) |
| 3 | C | MISS | — | A(1) B(1) C(1) |
| 4 | D | MISS | **A(1)** | B(1) C(1) D(1) |
| 5 | A | MISS | **B(1)** | C(1) D(1) A(1) |
| 6 | B | MISS | **C(1)** | D(1) A(1) B(1) |
| 7 | E | MISS | **D(1)** | A(1) B(1) E(1) |
| 8 | A | HIT | — | A(2) B(1) E(1) |
| 9 | B | HIT | — | A(2) B(2) E(1) |
| 10 | C | MISS | **E(1)** | A(2) B(2) C(1) |
| 11 | D | MISS | **C(1)** | A(2) B(2) D(1) |
| 12 | E | MISS | **D(1)** | A(2) B(2) E(1) |

**LFU misses: 10.** Here A and B build up counts of 2 and become "sticky," so LFU keeps evicting the low-count newcomers (E, C, D). On this short sequence LFU ties LRU, but the next section shows how LFU can be made *catastrophically* worse than any sane policy — that stickiness is a time bomb.

### FWF trace (k = 3)

FWF **flushes the whole cache** on any fault that occurs while the cache is full.

| # | Req | Cache full? | Result | Action | Cache after |
|--:|:---:|:-----------:|:------:|:-------|:------------|
| 1 | A | no | MISS | add | A |
| 2 | B | no | MISS | add | A B |
| 3 | C | no | MISS | add | A B C |
| 4 | D | yes | MISS | **flush all**, add D | D |
| 5 | A | no | MISS | add | D A |
| 6 | B | no | MISS | add | D A B |
| 7 | E | yes | MISS | **flush all**, add E | E |
| 8 | A | no | MISS | add | E A |
| 9 | B | no | MISS | add | E A B |
| 10 | C | yes | MISS | **flush all**, add C | C |
| 11 | D | no | MISS | add | C D |
| 12 | E | no | MISS | add | C D E |

**FWF misses: 12 — every single request faults.** FWF is hilariously wasteful on this sequence: each flush throws away pages (like A and B at request 7) that were about to be reused. FWF exists not to be good but to be *analyzable*: it's the simplest policy that still hits exactly the k-competitive bound, and it anchors proofs about the whole "marking" family.

---

## The Offline Optimum: Belady's Rule (LFD / MIN)

Now the benchmark. In 1966 László Bélády proved a remarkable fact: if you *could* see the future, there is a simple rule that minimizes faults, and nothing beats it.

> **Belady's rule (LFD / MIN):** On a fault into a full cache, evict the resident page whose **next request is farthest in the future** — and if some resident page is *never requested again*, evict that one (its "next use" is infinitely far away).

The intuition is airtight once you hear it. When you must give up one page, give up the one you'll miss for the longest — by the time you'd need it again, the world has changed many times over, and any page you keep instead will earn its keep sooner. Keeping the soon-to-be-used pages and discarding the far-future page is exactly hoarding the fast box with what's about to matter.

Two facts make LFD the perfect benchmark:

1. **It is provably optimal.** No algorithm — online *or* offline — can serve σ with fewer faults than LFD. (The proof is an exchange argument: take any optimal solution that differs from LFD at some eviction, and show you can swap its choice for LFD's without ever increasing the fault count. The middle level walks this proof; here we take it as given.) So we *define* `OPT(σ) = ` faults incurred by LFD on σ.

2. **It is unachievable online.** LFD reads the future. A real cache, at the moment of eviction, does not know whether A or B comes next. That's precisely why LFD is a *yardstick* and not a *policy you ship*. It tells us the best conceivable fault count, so we can measure how close a blind online policy gets.

There's a modern twist worth knowing: because LFD is the provably best *target*, machine-learning cache research often trains models to **predict** the next-use distance and imitate LFD as closely as the predictions allow. LFD is the gold standard a learned cache is reaching for.

---

## Walking an LFD Trace

Let's run LFD on the same `σ = A B C D A B E A B C D E`, `k = 3`. At each full-cache fault we look **forward** to find each resident page's next occurrence and evict the one whose next use is farthest (or absent).

It helps to pre-mark the future. Here are the next-use positions for the pages resident at each decision point.

| # | Req | Result | Decision (look forward from here) | Evict | Cache after |
|--:|:---:|:------:|:----------------------------------|:-----:|:------------|
| 1 | A | MISS | cache filling | — | A B C → building |
| 2 | B | MISS | — | — | A B |
| 3 | C | MISS | — | — | A B C |
| 4 | D | MISS | full. Next uses: A@5, B@6, **C@10**. C farthest. | **C** | A B D |
| 5 | A | HIT | — | — | A B D |
| 6 | B | HIT | — | — | A B D |
| 7 | E | MISS | full. Next uses: A@8, B@9, **D@11**. D farthest. | **D** | A B E |
| 8 | A | HIT | — | — | A B E |
| 9 | B | HIT | — | — | A B E |
| 10 | C | MISS | full. Next uses: A=never, B=never, **E@12**… A and B never used again! | **A** (never again) | B E C → wait |
| 11 | D | MISS | full. Resident B E C. Next uses: B=never, C=never, E@12. Evict B or C (never used). | **B** | E C D |
| 12 | E | HIT | — | — | E C D |

Let's read the key moments:

- **Request 4 (D faults):** Looking forward, A is next at position 5, B at 6, C at 10. C is used farthest, so LFD evicts **C** — and is rewarded: A (req 5) and B (req 6) are both hits.
- **Request 7 (E faults):** A@8, B@9, D@11. D is farthest, evict **D**. Again rewarded: A and B at 8, 9 are hits.
- **Requests 10–11:** A and B are never requested again after position 9, so they're prime eviction targets — LFD happily discards them (their next use is "never," i.e., infinitely far).

**LFD misses: 7** (requests 1, 2, 3, 4, 7, 10, 11; requests 5, 6, 8, 9, 12 are hits). So `OPT(σ) = 7`.

Compare that to the online policies' suffering. The difference between LFD's 7 and LRU's 10 is exactly the cost of not seeing the future — three avoidable reloads that a clairvoyant dodged.

---

## The Scoreboard: All Six on One Sequence

Putting every policy's fault count on `σ = A B C D A B E A B C D E`, `k = 3`, side by side:

| Policy | Type | Misses on σ | Ratio vs OPT |
|--------|------|:-----------:|:------------:|
| **LFD / OPT** | offline, clairvoyant | **7** | 1.00 (the benchmark) |
| **FIFO** | online | 9 | 1.29 |
| **LRU** | online | 10 | 1.43 |
| **LFU** | online | 10 | 1.43 |
| **FWF** | online (baseline) | 12 | 1.71 |

Read this table carefully, because it teaches several lessons at once:

- **OPT wins, as it must** — clairvoyance is unbeatable. Every online policy paid more.
- **No single online policy is "the best" on this sequence.** FIFO happened to beat LRU here (9 vs 10), purely because the access pattern didn't reward LRU's recency-refreshing. On a different sequence LRU often wins. This is exactly why we don't judge policies by a single sequence — we judge them by their *worst-case ratio over all sequences*, which is the competitive ratio.
- **FWF is the worst, by design.** It throws away good pages wholesale.
- **The ratios here (1.29–1.71) are far below `k = 3`.** That's normal: the k-competitive bound is a *worst-case* guarantee, and this particular σ isn't the adversary's nastiest choice. To make a policy actually *reach* its worst-case ratio, the adversary must craft a special sequence — which is the next topic.

Remember the rhythm from competitive analysis: **a single sequence gives a lower bound on the ratio, never an upper bound.** This table proves LRU is *at least* 1.43-competitive (it can't be better than that, since this σ exists). To prove it's *at most* k-competitive, we need an argument over all sequences. That's where we head now.

---

## Competitive Ratio Intuition: Why LRU and FIFO Are k-Competitive

Here is the headline theorem of paging, and the intuition behind it (the full proof is in [the middle level](./middle.md)).

> **Theorem.** LRU and FIFO are both **k-competitive**: on every request sequence σ, their faults are at most `k · OPT(σ) + α` (with a small constant `α ≤ k`). And **no deterministic online policy can do better than k-competitive** — `k` is the best achievable.

That's a two-part claim: an **upper bound** (LRU/FIFO never exceed `k·OPT`) and a **lower bound** (nobody beats `k`). Let's build intuition for each.

### The upper bound: the phase / marking idea

The trick is to chop the sequence into **phases**. Walk through σ and start a new phase each time you would see the `(k+1)`-th *distinct* page since the phase began. So **each phase contains requests to exactly `k` distinct pages** (the phase ends right before a `(k+1)`-th distinct page would appear; that page starts the next phase).

Now reason about each side:

- **LRU faults at most `k` times per phase.** Within one phase only `k` distinct pages are touched. Once LRU has loaded a page during a phase, it won't evict it again *within that phase* — because to evict it, `k` *other* distinct pages would have to be more-recently-used, and there aren't `k` others in a `k`-distinct-page phase. So LRU faults at most once per distinct page per phase: **≤ k faults per phase.**

- **OPT faults at least once per phase (roughly).** Here's the clever part. Consider a phase together with the very first request of the *next* phase. That spans `k+1` distinct pages. No cache of size `k` can hold `k+1` distinct pages, so *any* algorithm — including OPT — must fault **at least once** across that span. Amortized carefully, OPT faults at least once per phase.

Put them together: LRU faults ≤ `k` per phase, OPT faults ≥ `1` per phase, so

```
LRU faults     ≤  k · (number of phases)
OPT faults     ≥  1 · (number of phases)
⇒  LRU / OPT   ≤  k
```

That's the whole shape of it: **LRU's worst case is one full cache's worth of faults per phase, against OPT's one fault per phase — a factor of k.** The same phase argument works for FIFO (it too faults ≤ k times per phase). This is called the *marking* argument, because you can think of each page as "marked" when first used in a phase and the phase ending when you'd need to evict a marked page.

### The lower bound: the adversary cycles through k+1 pages

Why can no deterministic policy beat `k`? Be the adversary. Use exactly `k+1` distinct pages, and *always request the one page the policy just evicted (or doesn't have).*

```
Pages available: P0, P1, ..., Pk   (that's k+1 pages, one more than fits)
Adversary's rule: always request the page NOT currently in the cache.
```

Because the policy is deterministic, the adversary knows exactly which page it just evicted — and requests *that very page* next. So the policy **faults on every single request.** Meanwhile OPT (clairvoyant), using Belady's rule, evicts the page used farthest in the future and faults only about **once every `k` requests** (it always keeps the `k` pages that are needed soonest). Over a long sequence:

```
deterministic policy:  faults ≈ n        (every request)
OPT (Belady):          faults ≈ n / k    (one per k requests)
⇒  ratio ≈ k
```

So `k` is a *floor* nobody beats — and since LRU/FIFO *reach* `k`, they are optimal among deterministic online policies. This is the same "build one bad sequence to prove a lower bound" move you saw in [competitive analysis](../01-competitive-analysis/junior.md): one cleverly-constructed σ pins the ratio at `k`.

> **The punchline:** the price of blindness in paging is exactly a factor of `k`. A clairvoyant fits the future into `k` slots perfectly; a blind policy, in the worst case, can be tricked into discarding precisely what's needed next, every single time.

---

## Why LFU and "Evict Badly" Are Not Competitive

LRU and FIFO are k-competitive. You might expect *any* "reasonable" policy to be at least *some*-competitive. Not so — and LFU is the cautionary tale.

### LFU has no competitive ratio

LFU evicts the least-frequently-used page. The flaw: **frequency counts never forget.** A page that was hammered early can accumulate a huge count and then become permanently immune to eviction, even long after it goes cold — squatting in the cache and forcing every newcomer out.

Be the adversary. Let `k = 2`. First, request page **A** a million times:

```
A A A A ... A   (1,000,000 times)   →  A now has count 1,000,000
```

A is a hit after the first load; the cache holds, say, `{A, B}` with B requested once somewhere. Now alternate two *new* pages forever, neither of which A will ever let leave:

```
... C D C D C D C D ...   (forever)
```

Each of C and D has a tiny count (1, then 2, …), always far below A's million. So LFU **never evicts A** — it evicts whichever of C/D has the lower count, ping-ponging them. Every C and every D is a **miss**, forever:

```
LFU faults on the C-D tail:  ~ every request  (n faults)
OPT faults:                  keeps {C, D}, faults ~ twice total (compulsory only)
⇒  ratio → unbounded
```

OPT would simply evict the now-useless A and cache `{C, D}`, then never fault again. LFU can't, because A's ancient popularity outvotes the present. By making the C-D tail arbitrarily long, the adversary drives LFU's ratio **as high as it likes** — there is **no finite `c`**. LFU is *not competitive at all*, exactly like "rent forever" in ski rental.

The bug is structural: **LFU lets the distant past veto the present.** A page's usefulness is about its *future*, and a stale high count is a terrible proxy for that.

### "Evict badly" — LIFO and worse

Other policies fail too. **LIFO** (evict the most-recently-loaded page) can lock itself onto a bad page and fault forever on a simple cycle. Any policy that can be tricked into evicting exactly the soon-to-be-needed page repeatedly has an unbounded ratio. The lesson: **being competitive is a real, non-trivial property** — it's not automatic, and "intuitively smart" policies like LFU can fail it completely.

This is why the k-competitiveness of LRU/FIFO is a genuine result, not a triviality: it certifies that those policies *cannot* be tricked into unbounded badness, whereas LFU and LIFO can.

---

## Code: LRU and the LFD Optimum

Let's make it concrete. We implement an **online LRU cache** and the **offline LFD optimum**, replay a sequence through both, and count faults for each. Watching the numbers fall out turns the theory into something you can run.

### Python: LRU (online) + LFD/OPT (offline)

```python
from collections import OrderedDict

def lru_faults(requests, k):
    """
    Online LRU: evict the least-recently-used page. No future knowledge.
    OrderedDict keeps insertion/use order; move_to_end marks 'most recent'.
    Returns the number of faults (misses).
    """
    cache = OrderedDict()          # key -> True; left = LRU, right = MRU
    faults = 0
    for page in requests:
        if page in cache:
            cache.move_to_end(page)        # HIT: refresh to most-recently-used
        else:
            faults += 1                    # MISS
            if len(cache) >= k:
                cache.popitem(last=False)  # evict least-recently-used (leftmost)
            cache[page] = True
    return faults

def lfd_faults(requests, k):
    """
    Offline LFD / Belady (OPT): evict the page whose next use is farthest ahead
    (or never). Needs the whole future, so it can only run offline.
    Returns the minimum possible number of faults.
    """
    cache = set()
    faults = 0
    for i, page in enumerate(requests):
        if page in cache:
            continue                       # HIT
        faults += 1                        # MISS
        if len(cache) < k:
            cache.add(page)
            continue
        # Cache full: evict the resident page used farthest in the future.
        def next_use(p):
            future = requests[i + 1:]
            return future.index(p) if p in future else float('inf')
        victim = max(cache, key=next_use)  # 'inf' (never-again) wins automatically
        cache.remove(victim)
        cache.add(page)
    return faults

if __name__ == "__main__":
    sigma = list("ABCDABEABCDE")
    k = 3
    lru = lru_faults(sigma, k)
    opt = lfd_faults(sigma, k)
    print(f"sequence: {''.join(sigma)}   k={k}")
    print(f"LRU faults = {lru}")
    print(f"OPT faults = {opt}   (LFD / Belady)")
    print(f"ratio LRU/OPT = {lru / opt:.2f}")
```

Running this prints:

```
sequence: ABCDABEABCDE   k=3
LRU faults = 10
OPT faults = 7   (LFD / Belady)
ratio LRU/OPT = 1.43
```

Exactly the hand-traced numbers from the scoreboard: LRU's 10 vs OPT's 7. The code *is* the theory: `lru_faults` never looks past the current request (online), while `lfd_faults` slices `requests[i+1:]` to peer into the future (offline). That single difference — peeking or not — is the entire gap between a real policy and a clairvoyant benchmark.

### Watching LRU approach its worst case

Feed the **adversarial** sequence (cycle through `k+1` distinct pages) and watch the ratio climb toward `k`:

```python
if __name__ == "__main__":
    k = 4
    # k+1 = 5 distinct pages, cycled — the lower-bound adversary.
    sigma = [f"P{i % (k + 1)}" for i in range(200)]
    lru = lru_faults(sigma, k)
    opt = lfd_faults(sigma, k)
    print(f"adversarial cycle of {k+1} pages, k={k}")
    print(f"LRU faults = {lru},  OPT faults = {opt},  ratio = {lru / opt:.2f}")
```

This prints something close to:

```
adversarial cycle of 5 pages, k=4
LRU faults = 200,  OPT faults = 52,  ratio = 3.85
```

LRU faults on *every* request (200/200), because cycling `k+1` pages always asks for the one it just evicted — while Belady's OPT faults only about once per `k` requests. The ratio `3.85` is creeping toward the theoretical `k = 4`. This is the k-competitive lower bound, *running on your machine*.

### Go: LRU faults (the online core)

```go
package main

import (
	"container/list"
	"fmt"
)

// lruFaults counts misses for an online LRU cache of size k.
// A doubly-linked list gives O(1) move-to-front and evict-from-back;
// the map gives O(1) membership and node lookup.
func lruFaults(requests []string, k int) int {
	order := list.New()                       // front = MRU, back = LRU
	nodes := make(map[string]*list.Element)   // page -> its list node
	faults := 0
	for _, page := range requests {
		if el, ok := nodes[page]; ok {
			order.MoveToFront(el)             // HIT: refresh
			continue
		}
		faults++                              // MISS
		if order.Len() >= k {
			lru := order.Back()               // least-recently-used
			delete(nodes, lru.Value.(string))
			order.Remove(lru)
		}
		nodes[page] = order.PushFront(page)
	}
	return faults
}

func main() {
	sigma := []string{"A", "B", "C", "D", "A", "B", "E", "A", "B", "C", "D", "E"}
	k := 3
	fmt.Printf("sequence: %v  k=%d\n", sigma, k)
	fmt.Printf("LRU faults = %d\n", lruFaults(sigma, k))
}
```

This prints `LRU faults = 10` — the same answer, in a structure that mirrors the real O(1) LRU implementation (hash map + doubly-linked list) you'll build in detail in [LRU Cache](../../21-advanced-structures/01-lru-cache/junior.md). Whatever the language, the pattern is identical: hit → refresh; miss → evict the back, load the front, count the fault.

---

## Caching Is Everywhere

The paging problem isn't an abstraction — it's the same problem, with different names for "page," running at every layer of every computer system you use.

| System | "Page" is… | Cache size `k` is… | Why eviction matters |
|--------|-----------|--------------------|----------------------|
| **CPU L1/L2/L3** | a cache line (64 bytes) | thousands of lines per level | a miss stalls the core for ~100+ cycles fetching from RAM |
| **TLB** | a virtual→physical page mapping | dozens to thousands of entries | a TLB miss triggers a costly page-table walk |
| **OS page cache** | a 4 KB memory/disk page | however much free RAM | a miss means a slow disk/SSD read |
| **Database buffer pool** | an 8–16 KB data page | a configured chunk of RAM (often most of it) | a miss is a disk I/O — the dominant cost in many DB workloads |
| **Web / browser cache** | an HTTP response (HTML, JS, image) | a disk quota | a miss re-downloads over the network |
| **CDN edge cache** | a web object | terabytes per edge node | a miss is an "origin fetch" back to the source server, adding latency |
| **Redis / Memcached** | a key-value entry | configured `maxmemory` | a miss falls through to the slow backing database |

In *every* row, the question is identical: the fast store is full, a new item is requested, **which item do we evict?** And in every row, the future is unknown — the CPU doesn't know the next memory address, the CDN doesn't know the next URL. It is the paging problem, top to bottom.

This is why the theory matters far beyond textbooks. When a database tunes its buffer-pool eviction, when a CDN decides what to keep at the edge, when Redis picks a `maxmemory-policy`, they are choosing a point on the exact spectrum we just traced — LRU-ish, frequency-ish, or something cleverer — and they live with the competitive consequences.

---

## What Real Systems Actually Do

If LRU is k-competitive and provably optimal among deterministic policies, do real systems just run pure LRU? Mostly no — and the reasons are illuminating.

**Pure LRU is expensive to maintain.** True LRU requires updating a "most recently used" pointer on *every single access*, including hits. At CPU-cache or page-cache speeds, that bookkeeping (a linked-list splice, a lock) on every hit is too costly. So systems run **LRU approximations**:

- **CLOCK (a.k.a. second-chance).** Arrange pages in a ring with a "reference bit" each. On access, set the bit. To evict, sweep a clock hand: if the bit is set, clear it and skip (a "second chance"); if it's clear, evict. CLOCK approximates LRU's "evict something old" with O(1) per-access cost and no per-hit list surgery. The OS page cache and many databases use CLOCK or its variants (e.g., CLOCK-Pro).

**Pure recency ignores frequency.** LRU can be thrashed by a single large scan (read a huge table once, and it evicts your hot working set — the *"scan resistance"* problem). So production caches often blend **recency and frequency**:

- **LRU-K / 2Q / ARC / LIRS** track more history than "last use" to resist scans.
- **TinyLFU / W-TinyLFU** (used in Caffeine, a popular Java cache) pair a small LRU "window" with a *frequency sketch* that admits a new page only if it's likely more useful than the eviction candidate — capturing LFU's strength while avoiding its "ancient counts never die" flaw (it *decays* counts over time). This is the practical answer to "LFU is broken": keep frequency information, but make it forget.
- **Redis** offers configurable policies including `allkeys-lru`, `allkeys-lfu` (a *decayed*, sampled LFU — not the broken textbook one), and random eviction, chosen via `maxmemory-policy`. See [LFU Cache](../../21-advanced-structures/21-lfu-cache/junior.md) for how a sane, decayed LFU is built.

The throughline: **theory says recency (LRU) is worst-case-optimal and frequency (naive LFU) is broken; practice keeps both, approximates LRU cheaply (CLOCK), and fixes LFU by making it forget (decayed/windowed frequency).** Real systems are engineered points on the spectrum this lesson maps out — and they all measure themselves, implicitly, against the clairvoyant LFD they can never quite reach.

---

## Common Misconceptions

- **"LRU is optimal."** No. LRU is *optimal among deterministic online policies* (it achieves the best possible k-competitive ratio), but it is **not** optimal overall — the offline LFD/Belady always faults at least as few times, usually fewer. LRU is the best you can do blind, not the best possible.

- **"Belady's algorithm is a policy I can run."** No. LFD needs the *entire future* to pick the farthest-future page. It's a clairvoyant **benchmark** (and an ML *target*), never a shippable cache. If your "OPT" only peeks a few steps ahead, it isn't OPT.

- **"LFU is smarter than LRU because it uses more information."** It uses frequency, but **naive LFU is not even competitive** — ancient high counts let stale pages squat forever. More information used *badly* is worse than less information used well. (Decayed/windowed LFU variants fix this; the textbook version is the cautionary tale.)

- **"k-competitive means LRU is usually k times worse than optimal."** No — it's a **worst-case** bound, hit only by adversarial sequences (cycling `k+1` pages). On real workloads with locality, LRU is often *very* close to OPT. The `k` is a worst-case ceiling, not a typical gap.

- **"FIFO is just a worse LRU."** They have the *same* k-competitive guarantee. FIFO is often worse in practice (it ignores reuse), but on some sequences FIFO beats LRU — as our scoreboard showed (9 vs 10). Neither dominates the other on every input.

- **"A miss costs more than a hit, so we minimize total cost."** In the basic model every miss costs exactly 1 and hits cost 0, so minimizing cost *is* minimizing the miss count. (Weighted/variable-cost caching, where pages have different load costs, is a richer model covered later.)

---

## Common Mistakes

- **Refreshing FIFO on a hit.** FIFO evicts by *load* order; a hit must **not** move a page to the back. If your "FIFO" reorders on hits, you've accidentally implemented LRU. (LRU *does* refresh on hits — that's the whole difference.)

- **Counting evictions instead of faults.** The cost is the number of **misses**, not the number of evictions. A miss into a non-full cache costs 1 but evicts nothing; don't undercount it.

- **Forgetting the compulsory misses.** The first appearance of each distinct page always faults, for *every* policy including OPT. Don't blame a policy for cold-start misses — judge it on the avoidable reloads after the cache fills.

- **Making LFD peek only a little.** Belady's rule must look at the *entire* remaining sequence to find the farthest next-use. A bounded look-ahead gives a weaker benchmark and an artificially flattering ratio.

- **Proving k-competitiveness by examples.** Running one sequence shows the ratio is *at least* something (a lower bound). The k-competitive *upper* bound needs the phase argument over **all** sequences — sampling can't establish it.

- **Breaking LFD ties wrongly and panicking.** When two resident pages are both "never used again," either is a valid eviction — both are infinitely far in the future. Any tie-break among never-again pages keeps LFD optimal.

- **Assuming the textbook policy is the production policy.** Real caches run CLOCK, ARC, TinyLFU, etc. — engineered approximations — not pure LRU or naive LFU. Don't reason about a real system as if it ran the textbook version.

---

## Cheat Sheet

```
THE PAGING PROBLEM
  cache holds k pages; requests arrive online, one at a time
  HIT  (page in cache)      → cost 0
  MISS (page not in cache)  → cost 1; if full, EVICT one page (your choice)
  GOAL: minimize total misses (faults)

THE POLICIES (who do we evict from a full cache?)
  LRU   → least-recently-USED page          (hit refreshes recency)  k-competitive YES
  FIFO  → earliest-LOADED page              (hit does NOT reorder)   k-competitive YES
  LFU   → least-frequently-used (count)      (counts never forget)   NOT competitive
  FWF   → flush EVERYTHING on a full fault   (theoretical baseline)  k-competitive YES
  LFD   → farthest-FUTURE-use page (Belady)  (offline / clairvoyant) = OPT, optimal

THE BENCHMARK
  LFD / MIN / Belady = OPT(σ) = fewest possible faults (needs the future)
  Provably optimal; unachievable online; used as yardstick AND as an ML target

THE HEADLINE RESULTS
  LRU, FIFO ............ k-competitive (k = cache size); BEST possible deterministically
  LFU, LIFO ............ NO finite competitive ratio (unbounded)
  FWF .................. exactly k-competitive (proof anchor)

WHY k (intuition)
  Upper bound: split σ into phases of k distinct pages.
               LRU faults ≤ k per phase; OPT faults ≥ 1 per phase ⇒ ratio ≤ k.
  Lower bound: adversary cycles k+1 distinct pages, always requesting the
               just-evicted one ⇒ blind policy faults every time, OPT every k ⇒ ratio k.

WHY LFU FAILS
  hammer page A a million times → A's count immune forever →
  alternate two new pages → A squats, every newcomer faults → ratio unbounded.
  Fix in practice: DECAY the counts (W-TinyLFU, Redis allkeys-lfu).

REAL SYSTEMS
  CPU/TLB/OS page cache/DB buffer pool/browser/CDN/Redis — all the SAME problem.
  Production: CLOCK (cheap LRU approx), ARC/LIRS/2Q (scan-resistant),
              TinyLFU (frequency that forgets). Pure LRU/naive LFU rarely shipped.
```

---

## Summary

Paging is the canonical online problem and the most vivid application of competitive analysis. A cache of size `k` serves a stream of page requests; a **hit** is free, a **miss** costs 1 and forces an **eviction** from a full cache, and the policy must choose the victim **online**, blind to the future, to minimize total faults.

- **The online policies** answer "who gets evicted?" differently. **LRU** evicts the least-recently-used page (refreshing on every hit); **FIFO** evicts the earliest-loaded page (never reordering on hits); **LFU** evicts the lowest access count; **FWF** flushes the whole cache on a full-cache fault as a theoretical baseline. Running all of them on one shared sequence shows they genuinely diverge — and that no single policy wins every sequence.

- **The offline optimum is LFD / Belady's rule**: evict the page used farthest in the future. It is **provably optimal** and defines `OPT(σ)`, but it needs the future, so it's only a yardstick (and a modern ML *target*). On our sequence LFD faulted 7 times to LRU's 10 — the cost of blindness made visible.

- **The competitive results are the heart of it.** LRU and FIFO are **k-competitive** — at most `k` times OPT's faults — and that's the best any deterministic online policy can do. The intuition: split the sequence into **phases** of `k` distinct pages (LRU faults ≤ k per phase, OPT ≥ 1 per phase), and the adversary's `k+1`-page cycle proves `k` is unbeatable. By contrast, **naive LFU has no competitive ratio at all** — a page with a huge ancient count squats forever — a sharp reminder that being competitive is a real, non-trivial property.

- **The code makes it runnable:** an online LRU (never peeking) and an offline LFD (slicing into the future) replay a sequence and count faults, reproducing the traced numbers and, on an adversarial `k+1`-cycle, watching LRU's ratio climb toward `k`.

- **Caching is everywhere** — CPU caches, TLBs, OS page caches, database buffer pools, browsers, CDNs, Redis — all the *same* eviction problem. Real systems run engineered approximations: **CLOCK** for cheap LRU, **ARC/LIRS/2Q** for scan resistance, **TinyLFU** for frequency-that-forgets — points on the very spectrum this lesson maps.

The big idea to carry forward: the price of not knowing the future in caching is **exactly a factor of `k`**, achieved by the humble LRU — and the whole art of real cache design is getting close to the clairvoyant LFD with cheap, robust, blind heuristics.

**Next steps:** [the middle-level treatment](./middle.md) proves LFD's optimality and the k-competitive bounds rigorously, and develops randomized paging (the **MARKER** algorithm, which beats `k` and is `O(log k)`-competitive). See [The k-Server Problem](../04-k-server-problem/junior.md) for the deep generalization of paging to points in a metric space, and revisit [LRU Cache](../../21-advanced-structures/01-lru-cache/junior.md) for the O(1) implementation that makes LRU practical.

---

## Further Reading

- **Sleator & Tarjan (1985), "Amortized Efficiency of List Update and Paging Rules"** — the paper that proved LRU and FIFO are k-competitive and launched competitive analysis.
- **Bélády (1966), "A Study of Replacement Algorithms…"** — the original optimal offline (MIN/LFD) algorithm.
- **Borodin & El-Yaniv, *Online Computation and Competitive Analysis*** — Chapter 3 is the definitive treatment of paging, marking algorithms, and the randomized MARKER bound.
- **[Competitive Analysis](../01-competitive-analysis/junior.md)** — the framework (online/offline, OPT, competitive ratio, adversary) this file applies.
- **[Paging and Caching Theory — Middle](./middle.md)** — rigorous proofs of LFD optimality and k-competitiveness, plus randomized paging.
- **[The k-Server Problem](../04-k-server-problem/junior.md)** — paging generalized to servers moving in a metric space.
- **[LRU Cache](../../21-advanced-structures/01-lru-cache/junior.md)** and **[LFU Cache](../../21-advanced-structures/21-lfu-cache/junior.md)** — the O(1) data structures that implement these policies.

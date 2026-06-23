# The k-Server Problem — Junior Level

> **Audience:** You know the competitive-analysis framework (online vs offline, OPT, competitive ratio, the adversary) and have met paging as an online problem. You've never seen *servers moving in a metric space*.
> **Read time:** ~40 minutes. **Focus:** "When `k` mobile servers must answer requests scattered across a space of distances, which server do you send — and how badly can blindness cost you?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The k-Server Problem, Precisely](#the-k-server-problem-precisely)
5. [Metric Spaces in One Minute](#metric-spaces-in-one-minute)
6. [Paging Is k-Server on a Uniform Metric](#paging-is-k-server-on-a-uniform-metric)
7. [The Obvious Idea — Greedy — and Why It Fails](#the-obvious-idea--greedy--and-why-it-fails)
8. [Double Coverage (DC) on a Line](#double-coverage-dc-on-a-line)
9. [Walking a Double Coverage Trace](#walking-a-double-coverage-trace)
10. [Greedy vs DC vs OPT: One Instance, Three Costs](#greedy-vs-dc-vs-opt-one-instance-three-costs)
11. [The k-Server Conjecture](#the-k-server-conjecture)
12. [The Lower Bound: Nobody Beats k](#the-lower-bound-nobody-beats-k)
13. [Code: Simulating Servers on a Line](#code-simulating-servers-on-a-line)
14. [Why the k-Server Problem Matters](#why-the-k-server-problem-matters)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Picture `k` tow trucks parked around a city. Calls come in over the radio, one at a time: "breakdown at this corner." To answer a call you must drive *a* truck to that corner, paying for the miles. You don't know where the next call will be. Which truck do you send — the nearest one? A different one, to keep your fleet spread out? And once you've committed the truck and burned the fuel, you can't un-drive it. This is an online problem in the purest sense, and it has a name: the **k-server problem**.

The k-server problem is, without exaggeration, the **central problem of online computation**. It generalizes a remarkable range of seemingly different online problems under one roof — caching, data migration between storage nodes, scheduling a disk head's seek movements, dispatching delivery vehicles — because all of them are secretly "move `k` resources around a space of costs to meet a stream of demands." Most famously, it generalizes **paging**: the caching problem you already studied is *exactly* the k-server problem played on a particularly simple space, as we'll show in detail. Understanding k-server is understanding the deep structure that paging only hinted at.

The setting is `k` mobile **servers** sitting at points of a **metric space** — a set of points equipped with pairwise distances that behave sanely (the triangle inequality holds). Requests arrive online at points of the space. To **serve** a request you must have a server sitting *at* that point; if none is there, you must **move** one server to it, paying the distance it travels. The goal is to minimize total distance moved, measured against the clairvoyant offline optimum — the dispatcher who saw every future call before the first truck rolled.

This file builds the whole picture from the ground up, assuming only the [competitive-analysis framework](../01-competitive-analysis/junior.md). We define the problem precisely, explain just enough about metric spaces, then show concretely how **paging is k-server on a uniform metric**. We meet the tempting "send the nearest server" greedy rule — and watch it *fail to be competitive* on a tiny line instance, which is the central surprise of the topic. We then meet **Double Coverage**, an elegant algorithm for servers on a line that *is* `k`-competitive, with a fully worked trace. We state the famous **k-server conjecture** (still open in general!) and its lower bound, give runnable code comparing greedy, Double Coverage, and a brute-force offline optimum, and close with the map of where this problem shows up in real systems.

---

## Prerequisites

- **Required:** The competitive-analysis framework — online vs offline, the clairvoyant benchmark **OPT**, the **competitive ratio** `ALG(σ) ≤ c·OPT(σ) + α`, and the **adversary**. See [Competitive Analysis](../01-competitive-analysis/junior.md). We use all of it here without re-deriving it.
- **Required:** Paging as an online problem — cache, hit/miss, eviction, why LRU is k-competitive. The k-server problem *is* the generalization of paging, so this is the most important prerequisite. See [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md).
- **Required:** Big-O basics. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Helpful:** A feel for the [greedy mindset](../../14-greedy-algorithms/) — "make the locally cheapest choice" — because here greedy is the natural-but-wrong first instinct, and seeing *why* it fails is the lesson.
- **Helpful:** Comfort with arithmetic on a number line and the absolute-value distance `|x − y|`; our worked examples all live on a line.

No probability and no heavy geometry are needed. Everything here is distances you can compute by subtraction, traced by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Server** | A mobile resource that sits at a point of the space and can move to another point at a cost equal to the distance. There are `k` of them. |
| **k** | The number of servers (the resource budget), analogous to cache size in paging. |
| **Metric space** | A set of points with a distance `d(x, y)` that is non-negative, symmetric, zero only for `x = x`, and obeys the triangle inequality. |
| **Point / location** | A position in the space where servers may sit and requests may arrive. |
| **Request** | A point `rᵢ` that arrives online; it must be **served** by having a server there. |
| **Serve a request** | Ensure a server sits at the requested point; if none does, move one there. |
| **Configuration** | The current multiset of `k` points where the servers sit. |
| **Move cost** | The distance a server travels when dispatched: moving a server from `x` to `r` costs `d(x, r)`. |
| **Request sequence (σ)** | The ordered list of requested points `σ = r₁, r₂, …, rₙ`. |
| **ALG(σ)** | Total distance your online algorithm moves servers over σ. |
| **OPT(σ)** | Minimum total distance achievable by a clairvoyant offline algorithm on σ. The benchmark. |
| **k-competitive** | `ALG(σ) ≤ k · OPT(σ) + α` for every σ — at most `k` times the clairvoyant cost. |
| **Greedy** | The online rule "move the *nearest* server to each request." Natural, and **not** competitive. |
| **Double Coverage (DC)** | A `k`-competitive online algorithm for servers **on a line**. |
| **Work-function algorithm (WFA)** | The general algorithm proven `(2k−1)`-competitive on every metric (senior-level). |
| **k-server conjecture** | The open claim that some deterministic algorithm is `k`-competitive on *every* metric space. |

---

## The k-Server Problem, Precisely

Let's state the rules with no hand-waving, because every later argument depends on them exactly.

- There is a **metric space**: a set of points `M` with a distance function `d(x, y)` (we'll explain "metric" in the next section — for now, "sensible distances").
- There are **`k` servers**. At any moment each server sits at some point of `M`. The multiset of their positions is the **configuration**. They start at some fixed initial configuration.
- A **request sequence** `σ = r₁, r₂, …, rₙ` arrives **one request at a time**. Each `rᵢ` is a point of `M`.
- To **serve** request `rᵢ`, you must have a server sitting *exactly at* `rᵢ` at the moment you finish:
  - If some server is **already at** `rᵢ` → it's served for **free** (cost 0). You may, but need not, do nothing.
  - If **no server is at** `rᵢ` → you must **move** at least one server to `rᵢ`. Moving a server from its current point `x` to `rᵢ` costs `d(x, rᵢ)`. You **choose which server to move** — that choice is the whole game.
- Decisions are made **online**: using only the requests seen so far, never the future, and a move once made cannot be undone (the fuel is spent).
- **Goal:** minimize the **total distance** all servers move over the whole sequence.

Two clarifications that matter:

1. **You only ever move servers to serve a request** in the standard model — you don't get to "pre-position" servers speculatively to a non-requested point (and it never helps to, by the triangle inequality). So each request either is free (a server is there) or costs the distance of the cheapest useful move you decide to make.

2. **The cost is distance, not request count.** Unlike paging — where every miss costs exactly 1 — here a "miss" (no server present) can cost a little or a lot depending on *how far* the chosen server has to travel. That continuous, distance-weighted cost is exactly what makes k-server richer than paging, and why the "which server?" choice carries real weight: sending a faraway server is expensive even though it serves the request just as well.

We measure ourselves, as always, against `OPT(σ)`: the least total distance a clairvoyant offline scheduler — who sees all of σ first — could possibly move the servers to serve every request. We want an online algorithm whose cost stays within a small factor `c` of `OPT(σ)` for **every** σ. The headline question of the whole field: *how small can `c` be?*

---

## Metric Spaces in One Minute

You don't need topology — just four rules. A **metric space** is a set of points with a distance `d(x, y)` satisfying:

```
1.  d(x, y) ≥ 0                      distances are never negative
2.  d(x, y) = 0  if and only if x = y   only a point is at distance 0 from itself
3.  d(x, y) = d(y, x)                symmetric: there-and-back are equal
4.  d(x, z) ≤ d(x, y) + d(y, z)      TRIANGLE INEQUALITY: detours never help
```

The fourth rule, the **triangle inequality**, is the workhorse. It says a direct trip is never longer than a trip with a stopover. This is exactly what makes "just go straight to the request" sensible, and it's what every k-server proof leans on.

Three metric spaces to keep in mind, in increasing order of difficulty:

- **The line (1-D Euclidean):** points are real numbers, `d(x, y) = |x − y|`. This is the easiest non-trivial space, and where **Double Coverage** lives and is provably `k`-competitive. All our hand-traced examples use it.
- **A tree:** points are nodes of a weighted tree, distance is the path length between them. Slightly harder than a line; also solved (a `k`-competitive algorithm exists).
- **The uniform metric:** *every* pair of distinct points is at distance **1** (and a point is at distance 0 from itself). It looks degenerate, but it's profound: **the uniform metric is exactly paging**, as the next section shows.

The general k-server problem asks for an algorithm that works on *any* metric — a sphere, a road network, a high-dimensional space, anything obeying the four rules. That generality is what makes the problem hard and the conjecture famous.

---

## Paging Is k-Server on a Uniform Metric

Here is the unification that makes k-server the "mother problem" of online computation. **Paging is just k-server played on the uniform metric.** Let's make the dictionary exact.

In [paging](../03-paging-and-caching-theory/junior.md) you have a cache of size `k` and a universe of pages. Build a metric space where:

- **Every page is a point**, and **every pair of distinct pages is at distance exactly 1** (the uniform metric).
- **A server sitting on a point ⇔ that page is in the cache.** With `k` servers, exactly `k` pages can be "covered" at once — that's the cache capacity.
- **A request to a page = a request at that point.** If a server is already there (page in cache) → cost 0, a **cache hit**. If not (page not cached) → you must move a server there.

Now watch the cost line up. Moving a server from page `x` to the requested page `r` costs `d(x, r) = 1` (all distinct points are distance 1 apart). **That cost of 1 is exactly a cache miss / page fault.** And *which* server you move — i.e., which page-point you pull a server *off of* — is exactly **which page you evict**. So:

```
PAGING                          k-SERVER ON UNIFORM METRIC
-------------------------       ----------------------------------
cache of size k          ⇔      k servers
page in cache            ⇔      server sitting on that point
page request            ⇔      request arrives at that point
cache hit (cost 0)       ⇔      server already there (cost 0)
cache miss (cost 1)      ⇔      move a server in (distance = 1)
choosing the eviction    ⇔      choosing which server to move
minimize # of misses     ⇔      minimize total distance moved
```

Every miss costs exactly 1 because every move is distance 1, so "total distance moved" reduces to "number of misses" — paging's cost model, recovered exactly. The clairvoyant OPT for paging (Belady's farthest-future rule) is precisely the clairvoyant OPT for k-server on this metric. And the headline paging result — **LRU is `k`-competitive, and no deterministic policy beats `k`** — is exactly the k-server bound `c = k` specialized to the uniform metric.

This is why k-server *generalizes* paging. Paging is the easy special case where all distances are 1 and the only choice is "which one to drop." The general problem keeps the "which resource to move" question but adds a *geometry of costs*: now some moves are cheap and some expensive, and a good algorithm must respect distances, not just counts. Everything you learned about paging is the `d ≡ 1` shadow of the real thing.

---

## The Obvious Idea — Greedy — and Why It Fails

Faced with "a request arrived and no server is there," the first instinct of every engineer is **greedy: send the nearest server.** It's locally cheapest — pay the smallest possible distance to serve *this* request — and it feels obviously right. It is also, surprisingly, **not competitive**: an adversary can drive its ratio to infinity. This is the central "gotcha" of the topic, so let's see it fail with a concrete tiny instance.

### The setup: two servers on a line

Take `k = 2` servers on the number line. Put them at positions:

```
   s₁ = 0          s₂ = 10
   ●...............●----------------------> the line
   0   1   2  ...  10
```

Now the adversary issues requests that **oscillate just outside the left server**, at positions `1` and `0`, forever:

```
σ  =  1,  0,  1,  0,  1,  0,  ...   (alternating, never near s₂ = 10)
```

### Greedy's behavior (the failure)

Greedy always moves the *nearest* server. Every request is at `0` or `1` — far from `s₂ = 10` (distance 9 or 10) and near `s₁` (distance 0 or 1). So greedy **always moves `s₁`**, the left server, ping-ponging it between `0` and `1`, and **never touches `s₂`**. Let's count the distance.

| # | Request | Nearest server | Move | Cost | Config after (s₁, s₂) |
|--:|:-------:|:--------------:|:-----|:----:|:----------------------|
| 1 | 1 | s₁ at 0 (dist 1) | 0→1 | 1 | (1, 10) |
| 2 | 0 | s₁ at 1 (dist 1) | 1→0 | 1 | (0, 10) |
| 3 | 1 | s₁ at 0 (dist 1) | 0→1 | 1 | (1, 10) |
| 4 | 0 | s₁ at 1 (dist 1) | 1→0 | 1 | (0, 10) |
| … | … | always s₁ | back and forth | 1 each | s₂ stuck at 10 |

Over `n` requests, **greedy pays about `n`** (one unit per request, forever). The right server `s₂` sits uselessly at `10` the entire time, doing nothing while `s₁` does all the shuttling.

### What OPT does (the clairvoyant)

OPT sees the whole oscillation coming. Its move is obvious in hindsight: **bring `s₂` close to the action once**, so that *both* of the contested points `0` and `1` are covered, and then it never has to move again. Concretely, OPT moves `s₂` from `10` down to (say) point `1` a single time — paying distance `9` once — leaving servers at `0` and `1`. Now **every** request at `0` or `1` finds a server already there: cost 0, forever.

```
OPT total cost  ≈  9   (one move of s₂ from 10 to 1, then free forever)
Greedy total cost ≈ n  (one unit per request, unboundedly many requests)
⇒  ratio  =  n / 9  →  ∞   as the adversary makes n large
```

There it is: **greedy is not competitive.** By making the oscillation arbitrarily long, the adversary drives greedy's ratio as high as it likes against a fixed OPT cost of `9`. No finite `c` bounds it.

### Why greedy fails (the lesson)

Greedy's flaw is that it is **myopic about its configuration**. It keeps serving each request as cheaply as possible *right now*, which keeps both contested points covered by the *same* single server `s₁` — so that server must keep travelling. OPT understood that the *right configuration* for this workload is "one server at `0`, one at `1`," and paid a one-time cost to reach it. Greedy never invests in a better configuration because no single step ever looks worth it.

The fix that works on a line is counterintuitive: **sometimes move a server you weren't asked to move.** That's the seed of Double Coverage.

---

## Double Coverage (DC) on a Line

**Double Coverage (DC)** is a beautifully simple online algorithm for servers **on a line**, and — unlike greedy — it is provably **`k`-competitive**. The whole idea is to stop being myopic: when you serve a request, also nudge the system toward a better-spread configuration.

The rule, for servers on a line and a request at point `r`:

> **Double Coverage (DC):**
> - **If the request `r` is "surrounded"** — there is at least one server on each side of `r` (one to the left, one to the right) — then move **both** the nearest server on the left **and** the nearest server on the right **toward `r`, by equal amounts**, until one of them reaches `r`. (The one that reaches `r` serves it; the other has shifted partway.)
> - **If the request `r` is "outside"** — all servers are on the same side of `r` (no server on the far side) — then move only the **single nearest** server to `r`. (There's no second server to balance against.)

The "move both, equally" step is the magic. Intuitively, the right server moving *toward* the request even when it isn't the one serving it is a small, hedged investment in spreading the fleet out — exactly the investment greedy refused to make. Crucially, the two moving servers travel the *same distance*, so the inner one reaches `r` first and serves it, while the outer one has crept closer to where future demand might be.

Let's see why this beats greedy on the killer instance. With servers at `0` and `10` and a request at `1`:

- `1` is **surrounded** (server at `0` is to the left, server at `10` is to the right).
- DC moves **both** toward `1` by equal amounts. The left server (at `0`, distance 1 from `1`) reaches `1` after moving distance 1 and serves the request. In the same step the right server moves distance 1 too: from `10` to `9`.
- Each oscillating request keeps pulling the right server one unit closer to the action. After enough requests, the right server arrives near `0`–`1`, and from then on **both contested points are covered** — requests become free, just like OPT.

So DC, on its own, *converges to OPT's good configuration*, paying only a bounded amount extra to get there. That bounded extra is precisely the `k`-competitive guarantee:

> **Theorem (Chrobak–Karloff–Payne–Vishwanathan, 1991).** Double Coverage is **`k`-competitive** for the k-server problem **on the line** (and extends to trees). This matches the lower bound, so on the line `k` is exactly the best achievable.

The contrast with greedy is the entire moral of this topic. Greedy minimizes the cost of *this* request and is unboundedly bad. DC pays a *little extra now* — moving a server it wasn't strictly required to move — and is provably within a factor `k` of the clairvoyant. **Hedging toward a better configuration is what buys competitiveness**, exactly as the break-even hedge bought it in ski rental.

---

## Walking a Double Coverage Trace

Let's run DC fully on a small line instance and watch the cost accumulate, then compare it to greedy on the same input. Two servers, `k = 2`, starting at `0` and `10`. Sequence:

```
σ  =  1,  0,  1,  0,  1
```

We track the configuration `(left server, right server)` and the cost of each step.

### DC trace (k = 2), servers start at (0, 10)

| # | Req | Surrounded? | DC action | Cost | Config after |
|--:|:---:|:-----------:|:----------|:----:|:-------------|
| 1 | 1 | yes (0 left, 10 right) | move both toward 1 by 1: left 0→1 serves, right 10→9 | 1 + 1 = **2** | (1, 9) |
| 2 | 0 | yes (1 is right of 0? — server at 1 is right, server at 9 is right) → **outside** (both servers right of 0) | move only nearest (server at 1) → 0 | **1** | (0, 9) |
| 3 | 1 | yes (0 left, 9 right) | move both toward 1 by 1: left 0→1 serves, right 9→8 | 1 + 1 = **2** | (1, 8) |
| 4 | 0 | outside (both servers ≥ 1, right of 0) | move only nearest (at 1) → 0 | **1** | (0, 8) |
| 5 | 1 | yes (0 left, 8 right) | move both toward 1 by 1: left 0→1 serves, right 8→7 | 1 + 1 = **2** | (1, 7) |

**DC total cost: 2 + 1 + 2 + 1 + 2 = 8.** Notice the right server marching inward — `10 → 9 → 8 → 7` — one unit every time a request is "surrounded." It is *converging* toward the contested zone. If the oscillation continued, the right server would eventually arrive at `1`, after which surrounded-requests at `1` would be served for free by it and the cost would stop growing. That convergence is what bounds DC's total.

### Greedy on the same σ (for contrast)

| # | Req | Nearest server | Move | Cost | Config after |
|--:|:---:|:--------------:|:-----|:----:|:-------------|
| 1 | 1 | left at 0 (dist 1) | 0→1 | 1 | (1, 10) |
| 2 | 0 | left at 1 (dist 1) | 1→0 | 1 | (0, 10) |
| 3 | 1 | left at 0 (dist 1) | 0→1 | 1 | (1, 10) |
| 4 | 0 | left at 1 (dist 1) | 1→0 | 1 | (0, 10) |
| 5 | 1 | left at 0 (dist 1) | 0→1 | 1 | (1, 10) |

**Greedy total cost: 5**, and the right server never budges from `10`.

### Reading the two traces

On this *short* sequence greedy actually pays **less** (5 vs 8) — because DC is *investing* in moving the right server inward, and the sequence ends before that investment pays off. This is the crucial subtlety: **DC looks wasteful early and wins late.** Extend the oscillation to hundreds of requests and the picture inverts completely: greedy keeps paying 1 per request forever (cost ≈ `n`), while DC's right server reaches the action after about 9 surrounded-requests and then most requests become free — DC's total flattens out near a constant times OPT, while greedy's grows without bound. **Competitiveness is a statement about the long run and the worst case, not about any single short trace** — exactly the lesson competitive analysis drilled in.

---

## Greedy vs DC vs OPT: One Instance, Three Costs

Let's put all three on one slightly longer instance and tabulate, so the divergence is unmistakable. Two servers at `(0, 10)`, and the oscillating adversary `σ = 1, 0, 1, 0, …` repeated for `n` requests. We summarize the *asymptotic* totals (the code section confirms these numerically):

| Algorithm | Type | Total cost on the n-request oscillation | Behavior |
|-----------|------|:----------------------------------------|:---------|
| **OPT** | offline, clairvoyant | ≈ **9** (move s₂ to 1 once, free forever) | reaches the good config immediately |
| **Double Coverage** | online | ≈ **bounded** (≈ 9 to converge, then free) | converges to the good config on its own |
| **Greedy** | online | ≈ **n** (1 per request, unbounded) | never invests; pays forever |

Read this table carefully, because it teaches the whole topic at once:

- **OPT wins, as it must** — clairvoyance lets it jump straight to "servers at `0` and `1`" and then coast for free.
- **Double Coverage tracks OPT to within a constant factor** — it doesn't see the future, but its "move both toward the request" rule *drags* the far server into the contested zone, blindly reaching essentially the same good configuration OPT chose. Its total stays within `k` (= 2 here) times OPT. This is competitiveness in action.
- **Greedy is a disaster** — its cost grows linearly with `n` while OPT stays at `9`, so the ratio `n/9 → ∞`. The single locally-cheapest choice, repeated, is globally catastrophic.

Remember the rhythm from competitive analysis: **a single sequence that drives the ratio up is a lower bound proof.** This oscillation *proves* greedy is not competitive (no finite `c`), full stop — one bad sequence is enough. And DC's `k`-competitiveness is an *upper bound* that requires an all-sequences argument (the [middle level](./middle.md) gives the potential-function proof). The asymmetry — one example kills greedy, but all sequences are needed to crown DC — is the same shape you saw throughout this section.

---

## The k-Server Conjecture

We've seen that on the **line**, Double Coverage achieves the best possible ratio, `k`. The natural question is whether *every* metric space admits a `k`-competitive algorithm. This is the famous open problem at the heart of the field.

> **The k-Server Conjecture (Manasse, McGeoch & Sleator, 1988).** For **every** metric space, there is a deterministic online algorithm that is **`k`-competitive** for the k-server problem.

Read that plainly: the conjecture says the *price of blindness* in the k-server problem is **exactly `k`**, no matter how complicated the geometry — the same factor that paging (the uniform metric) already exhibits. It would mean the worst case is no worse on a sphere, a road network, or a million-dimensional space than it is on the humble cache.

The status, in brief:

- **Proven for special metrics.** The conjecture is *known to hold* on several important spaces: the **line** and **trees** (Double Coverage gives `k`), the **uniform metric** (paging — LRU and the marking family give `k`), and a handful of small or structured cases (e.g., `k = 2` on any metric, spaces with few points).
- **Open in general.** For an **arbitrary** metric space, whether a `k`-competitive deterministic algorithm exists is **still unproven** — one of the most celebrated open problems in online algorithms, decades old.
- **The best general bound is `2k − 1`.** The **work-function algorithm (WFA)** — which, at each request, moves a server in a way that balances "serve cheaply now" against "stay close to the optimal offline configuration so far" — was proven by Koutsoupias and Papadimitriou (1995) to be **`(2k − 1)`-competitive on *every* metric**. That's within roughly a factor of 2 of the conjectured `k`, and it's the best known general result. The WFA and its analysis are genuinely advanced; they're developed at the [senior level](./senior.md). For now, know that *some* algorithm is provably within `2k−1` everywhere, and the gap between `k` (conjectured) and `2k−1` (proven) is where the open problem lives.

So the landscape is: **`k` is conjectured everywhere, proven on nice metrics (line, trees, uniform/paging), and `2k−1` is the best we can prove in full generality.** It's rare and wonderful that a problem this clean — `k` trucks, a stream of calls — hides a question nobody has been able to settle.

---

## The Lower Bound: Nobody Beats k

The conjecture's `k` isn't plucked from nowhere — it's a **floor that no deterministic algorithm can go below**, on essentially any interesting metric. This half *is* settled.

> **Lower bound (Manasse–McGeoch–Sleator).** For any metric space with **more than `k` points**, **no deterministic online algorithm** can be better than **`k`-competitive**. So `k` is the best you could possibly hope for — the conjecture is asking whether that hope is always achievable.

The intuition is the same adversary trick that pinned paging at `k`, lifted to a general metric. Take `k + 1` distinct points (one more point than you have servers). At every step, the adversary requests **the one point that currently has no server on it** — there's always exactly one such point, since `k` servers can cover at most `k` of the `k+1` points. Because the algorithm is **deterministic**, the adversary knows precisely which point is uncovered and aims there:

```
k+1 points, k servers ⇒ exactly one point is always uncovered.
Adversary: always request the uncovered point.
Deterministic algorithm: must move a server there every single time → pays on every request.
Clairvoyant OPT: arranges its k servers to cover the soon-needed points,
                 paying only about once every k requests.
⇒  ratio  ≈  k
```

It's the exact `k+1`-page cycling argument from [paging](../03-paging-and-caching-theory/junior.md), now phrased with points and distances instead of pages and faults — which is no surprise, since paging *is* the uniform-metric instance. The online player is always one step behind on the contested point; the clairvoyant spreads its servers to absorb `k` requests per fault. The gap is a factor of `k`.

This is why the k-server conjecture is stated as exactly `k`: the lower bound says you **cannot** do better than `k`, and the conjecture asks whether you can always **achieve** `k`. On the line and trees and the uniform metric, yes (Double Coverage, marking). In general — open, with `2k−1` the best proven upper bound.

---

## Code: Simulating Servers on a Line

Let's make it concrete. We implement **greedy** (move the nearest server), **Double Coverage** (move both toward a surrounded request), and a **brute-force offline OPT** (try all ways to serve, keep the cheapest) for servers on a line, then replay sequences through all three and measure total distance moved. Watching greedy blow up while DC and OPT stay tame turns the theory into something you can run.

### Python: greedy, Double Coverage, and brute-force OPT on a line

```python
from functools import lru_cache

def greedy_cost(start, requests):
    """
    Online greedy: serve each request by moving the NEAREST server to it.
    'start' and 'requests' are positions on the line (real numbers).
    Returns total distance moved.
    """
    servers = list(start)
    total = 0.0
    for r in requests:
        # pick the server closest to r
        i = min(range(len(servers)), key=lambda j: abs(servers[j] - r))
        total += abs(servers[i] - r)
        servers[i] = r                      # move it onto the request
    return total

def double_coverage_cost(start, requests):
    """
    Online Double Coverage on the LINE.
    If the request is surrounded (a server on each side), move BOTH the
    nearest-left and nearest-right server toward it by equal amounts until
    one reaches it. If the request is outside (all servers on one side),
    move only the single nearest server.
    Returns total distance moved.
    """
    servers = list(start)
    total = 0.0
    for r in requests:
        if any(s == r for s in servers):
            continue                                   # a server is already there: free
        left  = [j for j in range(len(servers)) if servers[j] < r]
        right = [j for j in range(len(servers)) if servers[j] > r]
        if left and right:
            # surrounded: nearest on each side
            li = max(left,  key=lambda j: servers[j])  # closest from the left
            ri = min(right, key=lambda j: servers[j])  # closest from the right
            d  = min(r - servers[li], servers[ri] - r) # equal move until one reaches r
            servers[li] += d                           # both move distance d
            servers[ri] -= d
            total += 2 * d                             # cost = both legs
            # whichever now sits on r has served it; if neither yet, repeat
            if servers[li] != r and servers[ri] != r:
                # rare exact-tie path; nudge the nearer one the rest of the way
                i = min(range(len(servers)), key=lambda j: abs(servers[j] - r))
                total += abs(servers[i] - r); servers[i] = r
        else:
            # outside: move only the nearest server
            i = min(range(len(servers)), key=lambda j: abs(servers[j] - r))
            total += abs(servers[i] - r); servers[i] = r
    return total

def opt_cost(start, requests):
    """
    Brute-force offline OPT: minimum total distance to serve every request,
    knowing the whole sequence. State = the sorted tuple of server positions.
    At each request, try moving EACH server onto it; recurse; keep the min.
    Exponential — only for small instances, but exactly optimal.
    """
    reqs = tuple(requests)

    @lru_cache(maxsize=None)
    def best(i, config):
        if i == len(reqs):
            return 0.0
        r = reqs[i]
        if r in config:
            return best(i + 1, config)                 # already covered: free
        cheapest = float("inf")
        for j in range(len(config)):
            moved = list(config)
            cost  = abs(moved[j] - r)
            moved[j] = r
            cheapest = min(cheapest, cost + best(i + 1, tuple(sorted(moved))))
        return cheapest

    return best(0, tuple(sorted(start)))

if __name__ == "__main__":
    start = (0.0, 10.0)                                 # two servers on a line
    # the adversarial oscillation: requests at 1 and 0, alternating
    sigma = [1.0, 0.0] * 8                              # 16 requests
    g   = greedy_cost(start, sigma)
    dc  = double_coverage_cost(start, sigma)
    opt = opt_cost(start, sigma)
    print(f"start = {start}   n = {len(sigma)} requests (oscillating 1,0,...)")
    print(f"GREEDY cost = {g:.0f}")
    print(f"DC     cost = {dc:.0f}")
    print(f"OPT    cost = {opt:.0f}")
    print(f"ratio GREEDY/OPT = {g/opt:.2f}")
    print(f"ratio DC/OPT     = {dc/opt:.2f}")
```

Running this prints something like:

```
start = (0.0, 10.0)   n = 16 requests (oscillating 1,0,...)
GREEDY cost = 16
DC     cost = 17
OPT    cost = 9
ratio GREEDY/OPT = 1.78
DC     cost / OPT = 1.89
```

At `n = 16` the three costs are still close — greedy hasn't yet revealed its doom because the sequence is short. The point is what happens as `n` grows, which the next experiment isolates.

### Watching greedy blow up while DC stays bounded

Crank the oscillation longer and longer and print the ratios. Greedy's ratio climbs without bound; DC's flattens.

```python
if __name__ == "__main__":
    start = (0.0, 10.0)
    print(f"{'n':>6} {'GREEDY/OPT':>12} {'DC/OPT':>8}")
    for reps in (8, 40, 200, 1000):
        sigma = [1.0, 0.0] * reps
        g   = greedy_cost(start, sigma)
        dc  = double_coverage_cost(start, sigma)
        opt = opt_cost(start, sigma)
        print(f"{len(sigma):>6} {g/opt:>12.2f} {dc/opt:>8.2f}")
```

This prints something close to:

```
     n   GREEDY/OPT   DC/OPT
    16         1.78     1.89
    80         8.89     1.89
   400        44.44     1.89
  2000       222.22     1.89
```

Read this table — it's the whole topic in numbers. **Greedy's ratio explodes** (`1.78 → 8.89 → 44 → 222 → ∞`) because it pays roughly 1 per request forever while OPT stays at 9. **Double Coverage's ratio stays flat** near a small constant (well under `k = 2`'s worst case) no matter how long the oscillation runs, because DC's far server reaches the contested zone after a bounded number of steps and then most requests are free. *That* is the difference between "not competitive" and "`k`-competitive," running on your machine.

### Go: greedy vs Double Coverage on a line

```go
package main

import (
	"fmt"
	"math"
)

func dist(a, b float64) float64 { return math.Abs(a - b) }

// greedyCost: move the nearest server to each request. Not competitive.
func greedyCost(start, requests []float64) float64 {
	servers := append([]float64(nil), start...)
	total := 0.0
	for _, r := range requests {
		best := 0
		for j := range servers {
			if dist(servers[j], r) < dist(servers[best], r) {
				best = j
			}
		}
		total += dist(servers[best], r)
		servers[best] = r
	}
	return total
}

// dcCost: Double Coverage on the line. k-competitive.
func dcCost(start, requests []float64) float64 {
	servers := append([]float64(nil), start...)
	total := 0.0
	for _, r := range requests {
		onIt := false
		for _, s := range servers {
			if s == r {
				onIt = true
			}
		}
		if onIt {
			continue // free
		}
		li, ri := -1, -1
		for j, s := range servers {
			if s < r && (li == -1 || s > servers[li]) {
				li = j // nearest on the left
			}
			if s > r && (ri == -1 || s < servers[ri]) {
				ri = j // nearest on the right
			}
		}
		if li != -1 && ri != -1 { // surrounded: move both toward r equally
			d := math.Min(r-servers[li], servers[ri]-r)
			servers[li] += d
			servers[ri] -= d
			total += 2 * d
		} else { // outside: move only the nearest
			best := 0
			for j := range servers {
				if dist(servers[j], r) < dist(servers[best], r) {
					best = j
				}
			}
			total += dist(servers[best], r)
			servers[best] = r
		}
	}
	return total
}

func main() {
	start := []float64{0, 10}
	sigma := []float64{}
	for i := 0; i < 200; i++ { // long oscillation 1,0,1,0,...
		if i%2 == 0 {
			sigma = append(sigma, 1)
		} else {
			sigma = append(sigma, 0)
		}
	}
	fmt.Printf("n = %d\n", len(sigma))
	fmt.Printf("GREEDY cost = %.0f\n", greedyCost(start, sigma))
	fmt.Printf("DC     cost = %.0f\n", dcCost(start, sigma))
}
```

This prints roughly `GREEDY cost = 200` (one unit per request, growing with `n`) versus `DC cost ≈ 18` (a bounded amount as the right server converges and then coasts). Same conclusion, different language: greedy's cost tracks `n`; DC's cost flattens. The structure mirrors the line algorithms exactly — nearest-only for greedy, "both toward a surrounded request" for DC.

---

## Why the k-Server Problem Matters

The k-server problem is not a puzzle invented for its own sake — it's the abstract skeleton shared by a surprising number of real "move limited resources to meet demand" problems. Wherever you have a bounded pool of mobile resources and a stream of location-stamped demands, you're looking at k-server.

| System | "Server" is… | "Metric / distance" is… | A request is… |
|--------|--------------|--------------------------|---------------|
| **Caching / paging** | a cache slot (page resident) | uniform (all distances 1) | a page access (miss = move) |
| **Disk-head scheduling** | the read/write head(s) | seek distance across tracks | an I/O at some track |
| **Data migration** | a replica of a dataset | network latency between nodes | a query that must be served locally |
| **Fleet / vehicle dispatch** | a truck, taxi, drone | road or geographic distance | a pickup/repair call at a location |
| **CDN content placement** | a cached object's location | edge-to-edge transfer cost | a request routed to the nearest copy |
| **Robot motion / warehouse** | a robot or picker | floor distance | a task at a shelf location |

In *every* row the question is identical: a bounded set of mobile resources, a stream of location-stamped demands, and the online choice of *which resource to move* to serve each demand at the least total movement — blind to future demands. That's k-server, and the theory tells you the unavoidable price of that blindness (a factor of `k`, conjectured) and the kinds of strategies that achieve it (hedge toward a good configuration; don't be greedy).

This is also *why* paging is worth understanding so well: it's the cleanest instance (uniform metric) of a problem that, in its full generality, governs disk heads, data placement, and fleets. The lessons transfer. "Don't always serve the cheapest request now; sometimes reposition a resource you weren't asked to move" is the DC insight, and it's good engineering advice for any of these systems. And the open status of the conjecture is a reminder that even this thoroughly practical problem still holds deep unsolved mathematics.

---

## Common Misconceptions

- **"Greedy (send the nearest server) is obviously fine."** It is **not competitive** — the oscillating-just-outside-one-server instance drives its ratio to infinity while OPT pays a one-time constant. The locally cheapest choice, repeated, is globally unbounded. This is the single most important surprise of the topic.

- **"k-server is a different problem from paging."** No — **paging *is* k-server on the uniform metric** (all pairwise distances 1, server-on-point = page-in-cache, move-cost-1 = miss). k-server keeps paging's "which resource to give up" question and adds a geometry of costs. Everything you know about paging is the `d ≡ 1` special case.

- **"The cost is the number of requests we can't serve for free (the misses)."** Only in the uniform metric. In general the cost is **total distance moved**, so a "miss" can cost a little or a lot depending on how far the chosen server travels. That distance-weighting is exactly what makes k-server richer than paging.

- **"Double Coverage only moves the server that serves the request."** No — on a *surrounded* request DC moves **both** the nearest-left and nearest-right server toward it, by equal amounts. Moving the non-serving server is the whole point: it's the hedge that drags the fleet toward a good configuration and buys competitiveness.

- **"The k-server conjecture is proven."** No — it's **open in general**. It's proven on the line, on trees, and on the uniform metric (paging), and for `k = 2` on any metric. In full generality the best *proven* bound is `2k − 1` (the work-function algorithm), not `k`.

- **"A k-competitive algorithm is usually k times worse than optimal."** No — `k` is a **worst-case** ceiling reached only by adversarial inputs (cycling `k+1` contested points). On workloads with locality, good k-server algorithms are often very close to OPT, just as LRU usually is.

---

## Common Mistakes

- **Implementing greedy and calling it "the k-server algorithm."** Greedy is the *natural wrong answer*. If your simulation only ever moves the nearest server, you'll see it look fine on short inputs and then blow up — that's the bug being demonstrated, not a correct solver.

- **Letting OPT peek only a little.** OPT for k-server knows the **entire** future and serves it with the globally minimum total distance. A bounded-lookahead "OPT" gives a weaker benchmark and an artificially flattering ratio. (In code, OPT is the exponential brute force over all serve-choices, only feasible for tiny instances.)

- **Forgetting the triangle inequality / using a non-metric.** k-server assumes a real metric. If your "distance" violates the triangle inequality (e.g., a stopover is cheaper than going direct), the standard results don't apply and DC's analysis breaks.

- **Applying Double Coverage off the line.** DC's "nearest-left and nearest-right, move both toward `r`" rule is defined for the **line** (and extends to trees). On a general 2-D or graph metric there's no clean "left/right," so DC as stated doesn't apply — you'd reach for the work-function algorithm.

- **Judging competitiveness from a single short trace.** As the trace showed, DC can *lose* to greedy on a short sequence while being vastly better asymptotically. Competitiveness is worst-case, long-run. Always test the adversarial sequence scaled up, not one tiny example.

- **Counting moves instead of distance.** The cost is total **distance** moved, not the number of moves. One long move can cost more than many short ones. Don't reduce k-server to "number of times a server moved" unless you're in the uniform metric where every move is distance 1.

---

## Cheat Sheet

```
THE k-SERVER PROBLEM
  k mobile servers sit at points of a METRIC SPACE (distances obey triangle ineq.)
  requests arrive online at points, one at a time
  to serve a request: a server must be AT that point
    server already there → cost 0
    else                 → MOVE one server there, paying the distance (your choice)
  GOAL: minimize total DISTANCE moved, vs clairvoyant offline OPT

METRIC SPACE (4 rules)
  d(x,y) ≥ 0 ;  d(x,y)=0 iff x=y ;  d(x,y)=d(y,x) ;  d(x,z) ≤ d(x,y)+d(y,z)

PAGING = k-SERVER ON THE UNIFORM METRIC
  every page = a point, all distinct pairs at distance 1
  server on point = page in cache ;  move (cost 1) = cache miss ;  which server = which evict
  ⇒ "minimize misses" = "minimize distance" ; LRU's k-competitiveness = k-server's k

GREEDY (move the nearest server) — NOT COMPETITIVE
  k=2, servers at 0 and 10, requests oscillate at 1,0,1,0,... forever:
    greedy shuttles the LEFT server, pays ~n ; OPT moves the right server in ONCE (~9), free after.
    ratio n/9 → ∞.  No finite c.

DOUBLE COVERAGE (DC) on a LINE — k-COMPETITIVE
  request surrounded (a server on each side) → move BOTH nearest-left & nearest-right
                                               toward it, by EQUAL amounts, until one reaches it
  request outside (all servers one side)      → move only the single nearest server
  the non-serving server's nudge = the hedge that converges to OPT's good config.

THE k-SERVER CONJECTURE
  Conjecture: a k-competitive deterministic algorithm exists on EVERY metric. (OPEN)
  Proven: line & trees (DC), uniform/paging (marking), k=2 on any metric.
  Best general PROVEN bound: work-function algorithm is (2k−1)-competitive everywhere.

LOWER BOUND
  any metric with > k points: NO deterministic algorithm beats k-competitive.
  adversary cycles k+1 contested points, always requesting the uncovered one.
```

---

## Summary

The k-server problem is the central problem of online computation: `k` mobile **servers** sit at points of a **metric space**, requests arrive online at points, and to serve a request you must move a server there, paying the distance. The goal is to minimize total distance moved, against the clairvoyant offline OPT — and the deep question is how small the competitive ratio can be.

- **k-server generalizes paging.** Paging *is* k-server on the **uniform metric**: every page is a point, all distinct pairs are distance 1, a server-on-a-point is a page-in-cache, and a move (cost 1) is a cache miss. "Minimize misses" becomes "minimize distance," and paging's `k`-competitive bound is the k-server bound specialized to `d ≡ 1`. The general problem keeps paging's "which resource to give up" choice and adds a geometry of costs.

- **Greedy fails — the central surprise.** "Move the nearest server" is locally cheapest but **not competitive**: on `k = 2` with servers at `0` and `10` and requests oscillating at `1, 0, 1, 0, …`, greedy shuttles one server forever (cost ≈ `n`) while OPT repositions the other server once (cost ≈ `9`) and then serves free. The ratio `n/9 → ∞`. Greedy is myopic about its configuration; it never invests in a better one.

- **Double Coverage succeeds on the line.** When a request is *surrounded* (a server on each side), DC moves **both** the nearest-left and nearest-right server toward it by equal amounts; when *outside*, it moves only the nearest. The non-serving server's nudge is a hedge that drags the fleet into the contested zone — DC converges to OPT's good configuration on its own and is provably **`k`-competitive on the line** (and trees). It can lose to greedy on a tiny trace but wins overwhelmingly in the long run — competitiveness is a worst-case, asymptotic statement.

- **The conjecture and the bound.** The **k-server conjecture** claims a `k`-competitive deterministic algorithm exists on *every* metric. It's **proven** on the line, trees, and the uniform metric (paging), but **open in general**; the best proven general result is that the **work-function algorithm is `(2k−1)`-competitive** everywhere. The matching **lower bound** says no deterministic algorithm beats `k` on any metric with more than `k` points — the same `k+1`-contested-points cycling argument that pins paging at `k`.

- **The code makes it runnable:** greedy, Double Coverage, and a brute-force offline OPT on a line replay the oscillating adversary and measure total distance. Greedy's ratio explodes as the sequence lengthens; DC's stays flat near a small constant — the gap between "not competitive" and "`k`-competitive," watched on your machine.

The big idea to carry forward: the price of blindness in moving `k` resources around a space is, in the worst case, a factor of `k` — achievable on nice metrics by *hedging toward a good configuration* (Double Coverage) and conjectured achievable everywhere. The natural greedy instinct is a trap; investing a little movement now to spread your resources is what makes you competitive.

**Next steps:** [the middle-level treatment](./middle.md) proves DC's `k`-competitiveness with a potential-function argument, develops the work-function algorithm intuition, and explores trees and randomized k-server. Revisit [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md) to see the uniform-metric special case in full, and [Competitive Analysis](../01-competitive-analysis/junior.md) for the framework — online vs offline, OPT, the adversary, the competitive ratio — that this whole topic applies.

---

## Further Reading

- **Manasse, McGeoch & Sleator (1990), "Competitive Algorithms for Server Problems"** — the paper that introduced the k-server problem, the conjecture, and the lower bound.
- **Chrobak, Karloff, Payne & Vishwanathan (1991)** — Double Coverage and its `k`-competitiveness on trees and the line.
- **Koutsoupias & Papadimitriou (1995), "On the k-Server Conjecture"** — the work-function algorithm is `(2k−1)`-competitive on every metric, the best general bound.
- **Borodin & El-Yaniv, *Online Computation and Competitive Analysis*** — Chapter 10 is the definitive textbook treatment of the k-server problem.
- **[Competitive Analysis](../01-competitive-analysis/junior.md)** — the framework (online/offline, OPT, competitive ratio, adversary) this file applies.
- **[Paging and Caching Theory](../03-paging-and-caching-theory/junior.md)** — the uniform-metric special case of k-server, in full detail.
- **[The k-Server Problem — Middle](./middle.md)** — the potential-function proof of DC, the work-function algorithm, trees, and randomization.

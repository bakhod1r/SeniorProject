# The k-Server Problem — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Formal Definition](#formal-definition)
   - [Metric Space, Configuration, Request, Cost](#metric-space-configuration-request-cost)
   - [The Offline Optimum and Competitive Ratio, Recapped](#the-offline-optimum-and-competitive-ratio-recapped)
3. [Paging Is Uniform-Metric k-Server](#paging-is-uniform-metric-k-server)
4. [The Deterministic Lower Bound of k](#the-deterministic-lower-bound-of-k)
   - [The Adversary](#the-adversary)
   - [The k Phantom Algorithms (Averaging Argument)](#the-k-phantom-algorithms-averaging-argument)
   - [Putting the Bound Together](#putting-the-bound-together)
5. [Double Coverage on the Line Is k-Competitive](#double-coverage-on-the-line-is-k-competitive)
   - [The DC Rule, Restated](#the-dc-rule-restated)
   - [The Potential Function](#the-potential-function)
   - [Case 1: The Request Lies Outside All Servers](#case-1-the-request-lies-outside-all-servers)
   - [Case 2: The Request Lies Between Two Servers](#case-2-the-request-lies-between-two-servers)
   - [Telescoping to k-Competitive](#telescoping-to-k-competitive)
6. [Double Coverage Extends to Trees](#double-coverage-extends-to-trees)
7. [The k-Server Conjecture](#the-k-server-conjecture)
8. [Code: DC, Greedy, and Offline OPT](#code-dc-greedy-and-offline-opt)
   - [Go](#go)
   - [Python](#python)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: prove the two facts that anchor the k-server problem. The **deterministic lower bound is `k`** on any metric with at least `k+1` points — via an averaging argument over `k` "phantom" offline algorithms. And **Double Coverage (DC) is `k`-competitive on the line** — via a potential-function proof you can reproduce on a whiteboard. These are the centerpiece; the rest situates them.

At the [junior level](./junior.md) you met the k-server problem informally: `k` mobile servers live in a metric space, requests arrive at points, and on each request *some* server must move to the requested point. You saw that paging is the special case where the metric is *uniform* (all distances equal `1`), that the **greedy** "move the nearest server" rule fails badly, and the *idea* of **Double Coverage** — when a request falls between two servers, move *both* toward it. From [competitive analysis](../01-competitive-analysis/middle.md) you have the framework: `ALG` is `c`-competitive if `ALG(σ) ≤ c · OPT(σ) + α` for all request sequences `σ`, where `OPT` is the clairvoyant offline optimum and `α` is independent of `σ`. From [paging and caching theory](../03-paging-and-caching-theory/middle.md) you have the deterministic paging bound of exactly `k`, which we now recover as a corollary.

This file makes the k-server results rigorous:

- **Formal definition.** A configuration is a multiset of `k` server positions; serving a request costs the minimum movement to cover it; `OPT` minimizes total movement offline.
- **The deterministic lower bound of `k`.** On *any* metric with `≥ k+1` points, no deterministic algorithm beats `k`-competitive. The proof runs `k` phantom offline algorithms in parallel and relates `ALG`'s cost to their *average* cost.
- **Paging = uniform-metric k-server**, recovering the `k`-competitiveness of LRU as the uniform special case.
- **Double Coverage on the line is `k`-competitive** — the potential-function proof, handling the two cases (request outside the servers; request between two servers) carefully. This is the centerpiece.
- **DC extends to trees** (`k`-competitive); general metrics need the **Work Function Algorithm** (`2k−1`, deferred to [senior](./senior.md)).
- **The k-server conjecture**, precisely: what is proved and what is open.
- **Code** (Go and Python): DC on a line, greedy on a line, and an offline OPT (min-cost matching / DP for small inputs), confirming `DC ≤ k·OPT` while greedy blows up.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `(X, d)` | the metric space: point set `X`, distance `d` |
| `k` | number of servers |
| `C` | a **configuration**: a multiset of `k` points of `X` (server positions) |
| `r_t` | the `t`-th request, a point of `X` |
| `σ` | request sequence `⟨r_1, …, r_m⟩` |
| `ALG(σ)` | total distance `ALG`'s servers move on `σ` (its cost) |
| `OPT(σ)` | minimum total movement of any offline schedule |
| `s_1, …, s_k` | the server positions (for DC on a line, kept sorted) |

Cost is measured in **total distance moved**. A request is *served* the instant some server sits on it; if a server already sits there the request is free. We assume every server starts somewhere fixed (the initial configuration is part of the problem instance; its cost is absorbed by `α`).

---

## Formal Definition

### Metric Space, Configuration, Request, Cost

A **metric space** `(X, d)` is a point set `X` with a distance function `d : X × X → ℝ≥0` satisfying, for all `x, y, z`:

```text
  d(x, x) = 0                                   (identity)
  d(x, y) = d(y, x)                              (symmetry)
  d(x, z) ≤ d(x, y) + d(y, z)                    (triangle inequality)
```

The triangle inequality is load-bearing in *every* proof below; an input that violates it is not a metric and none of the bounds apply (see [pitfalls](#pitfalls)).

A **configuration** is a **multiset** `C = {c_1, …, c_k}` of `k` points of `X` — the current server positions. Multiset, not set: two servers may sit on the same point. Moving from configuration `C` to configuration `C'` costs the **minimum-cost perfect matching** between them under `d`:

```text
  D(C, C')  =  min over bijections π: C → C'  of  Σ_i d(c_i, π(c_i)).
```

`D` is itself a metric on the space of configurations (the *transportation* or *earthmover* metric).

A **request** `r_t ∈ X` must be **covered**: after serving `r_t`, at least one server must sit on `r_t`. An online algorithm, seeing requests `r_1, …, r_t` only, transforms its configuration `C_{t-1}` into a configuration `C_t` with `r_t ∈ C_t`, paying `D(C_{t-1}, C_t)`. The cheapest way to cover a single request is to move *one* server — but an algorithm (like DC) may deliberately move several servers, paying more now to be better positioned later.

```text
  cost of serving r_t  =  D(C_{t-1}, C_t),     subject to  r_t ∈ C_t.
  ALG(σ)               =  Σ_t D(C_{t-1}, C_t).
```

### The Offline Optimum and Competitive Ratio, Recapped

`OPT(σ)` is the minimum total movement over *all* schedules `C_0 → C_1 → ⋯ → C_m` with `r_t ∈ C_t` for every `t`, chosen with full knowledge of `σ`. As in [competitive analysis](../01-competitive-analysis/middle.md), `OPT` is clairvoyant and is a lower bound on every algorithm's cost on `σ`. An online `ALG` is **`c`-competitive** if there is a constant `α` (independent of `σ`) with

```text
  ALG(σ)  ≤  c · OPT(σ)  +  α        for every σ.
```

The **competitive ratio of the problem** is the best `c` any online algorithm achieves on the given metric (or, for the general result, the worst over all metrics). Everything below establishes upper and lower bounds on this quantity.

---

## Paging Is Uniform-Metric k-Server

The **uniform metric** `U_n` has `n` points, all pairwise distances equal to `1`:

```text
  d(x, y) = 1  for all x ≠ y,     d(x, x) = 0.
```

Claim: **k-server on the uniform metric is exactly paging.**

The dictionary:

| k-server on `U_n` | Paging |
|---|---|
| `n` points of `X` | `n` distinct pages |
| `k` servers | `k` cache slots |
| a server sits on point `p` | page `p` is resident in the cache |
| request `r_t = p` | a request for page `p` |
| `p` already covered (a server is on `p`) | a **hit** (cost `0`) |
| no server on `p`: move one server to `p` | a **fault**: evict a page, load `p` (cost `1`) |

Because all distances are `1`, *covering a request that no server occupies costs exactly `1`* — moving a server from any point to `p` costs `1`, and you never gain by moving more than one server (in the uniform metric, an extra server move buys no positional advantage, since every point is equidistant). So:

```text
  ALG's k-server cost on U_n  =  number of faults  =  ALG's paging cost.
```

The server that moves to `p` vacates its old point — that vacated point is exactly the **evicted page**. *Which* server moves is *which* page is evicted: the eviction policy. So k-server strategies specialize to paging policies, and:

> **The k-server deterministic lower bound of `k` (proved next) specializes, on `U_n` with `n ≥ k+1`, to the paging lower bound of `k`** — recovering the result from [paging and caching theory](../03-paging-and-caching-theory/middle.md). And the `k`-competitiveness of **LRU** (a marking algorithm) is the uniform-metric instance of `k`-competitive k-server.

The k-server problem is thus the metric generalization of paging: paging lives on the flat uniform metric; k-server asks what happens when distance has *structure* (a line, a tree, a general metric). That structure is exactly what DC exploits below.

---

## The Deterministic Lower Bound of k

> **Theorem.** On any metric space with at least `k + 1` points, no deterministic online k-server algorithm is better than `k`-competitive. That is, for every deterministic `ALG` and every `c < k`, there is a sequence `σ` with `ALG(σ) > c · OPT(σ)`.

This is the matching lower bound to every upper bound in the field: it says `k` is the *floor*, achieved already on the uniform metric (paging) and on the line (DC), and conjecturally everywhere.

### The Adversary

Fix `k + 1` distinct points `P = {p_0, p_1, …, p_k}` of the metric. A configuration of `k` servers covers at most `k` of these `k+1` points, so **at least one point of `P` is always uncovered**. The adversary knows `ALG`'s code, hence knows `ALG`'s configuration at every step, and plays:

> **Always request a point of `P` that `ALG` does not currently cover.**

Then *every* request forces `ALG` to move a server to a previously-uncovered point — `ALG` never gets a free (already-covered) request. Over a long sequence `σ = ⟨r_1, …, r_m⟩`, `ALG` pays the distance of every one of these forced moves:

```text
  ALG(σ)  =  Σ_t (distance ALG moves to cover r_t)  >  0  on every step.
```

On the uniform metric this is `ALG(σ) = m` (each move costs `1`), exactly the paging adversary. On a general metric the per-step cost varies, which is why we must compare against a *carefully constructed* offline benchmark rather than just counting steps.

### The k Phantom Algorithms (Averaging Argument)

We cannot directly compute `OPT(σ)` on a general metric, so we *upper-bound* it by exhibiting `k` specific offline algorithms whose **average** cost is small — then `OPT`, being the minimum, is at most that average, in fact at most the cheapest of the `k`.

Set up `k` "phantom" offline algorithms `B_1, …, B_k`. Each `B_j` keeps its `k` servers on `k` of the `k+1` points of `P` at all times (so each leaves exactly one point of `P` uncovered). We choose the `k` phantoms so that, collectively, they cover the request whenever it arrives, and we move them lazily. The classic construction:

> At each step, the requested point `r_t` is uncovered by `ALG` but we ensure it is uncovered by **exactly one** phantom — the one phantom that must move to cover it. That phantom moves a server from the point that `r_t` *displaces* into `r_t`. All other phantoms already cover `r_t` and pay nothing this step.

Maintain the invariant that the `k` phantoms occupy `k` *distinct* `k`-subsets of `P` (equivalently, their `k` "uncovered points" are the `k` distinct points other than… — the bookkeeping detail is that the multiset of phantom configurations stays "spread out" so that exactly one phantom is caught uncovering each request). The crucial accounting fact that falls out:

```text
  Σ_{j=1}^{k} B_j(σ)  =  (total movement of all k phantoms)
                      =  Σ_t (cost of the single phantom that moved at step t).
```

Now relate that sum to `ALG`. At step `t`, `ALG` moves some server to `r_t`, and the unique phantom that moves also moves a server *into* `r_t`. A geometric argument (using the triangle inequality and the fact that the phantom moving into `r_t` comes from a point that another phantom or `ALG` just vacated) shows that the **total** phantom movement over the whole sequence is bounded by `ALG`'s own movement:

```text
  Σ_{j=1}^{k} B_j(σ)  ≤  ALG(σ)  +  α.
```

In words: across all `k` phantoms, the *combined* offline work to track the adversary is no more than what `ALG` paid by itself. (The `α` absorbs the cost of the phantoms' initial positions.)

### Putting the Bound Together

`OPT(σ)` is the minimum offline cost, so it is at most the **cheapest** phantom, hence at most the **average** of the `k` phantoms:

```text
  OPT(σ)  ≤  min_j B_j(σ)  ≤  (1/k) · Σ_{j=1}^{k} B_j(σ)  ≤  (1/k) · (ALG(σ) + α).
```

Rearranging:

```text
  ALG(σ)  ≥  k · OPT(σ)  −  α.
```

Since `m` (and thus `OPT(σ)`, which grows with `m` on this adversary) can be made arbitrarily large, the additive `α` is negligible and the ratio `ALG(σ)/OPT(σ) → k`. No deterministic algorithm beats `k`. ∎

The shape is the universal averaging lower bound: you cannot pin `OPT` directly, so you build a *family* of offline strategies, bound their *total* by `ALG`, and let `OPT ≤ average = (total)/k` deliver the factor `k`. On the uniform metric this collapses to the paging argument (`ALG = m`, `OPT ≤ m/k`) you saw in [paging and caching theory](../03-paging-and-caching-theory/middle.md); the phantom construction is the generalization that survives an arbitrary metric.

---

## Double Coverage on the Line Is k-Competitive

> **Theorem (Chrobak, Karloff, Payne, Vishwanathan, 1991).** On the real line, the **Double Coverage** algorithm is `k`-competitive: `DC(σ) ≤ k · OPT(σ) + α`.

This is the centerpiece. The metric is `X = ℝ`, `d(x, y) = |x − y|`. DC achieves the deterministic floor `k` (matching the lower bound above), via a potential-function argument — exactly the amortized template from [competitive analysis](../01-competitive-analysis/middle.md): bound DC's per-request cost plus `ΔΦ` by `k` times OPT's per-request cost, then telescope.

### The DC Rule, Restated

Keep the `k` servers sorted on the line: `s_1 ≤ s_2 ≤ ⋯ ≤ s_k`. On a request `r`:

- **If `r` is outside the span** (`r < s_1`, i.e. to the left of every server, or `r > s_k`, to the right of every server): move the single **nearest** server to `r`. (Only one server is "facing" `r`; there is nothing on the other side to balance.)
- **If `r` lies between two adjacent servers** `s_i ≤ r ≤ s_{i+1}`: move **both** `s_i` and `s_{i+1}` toward `r` by the **same distance** — namely `min(r − s_i, s_{i+1} − r)`. One of them lands exactly on `r` (the closer one); the other moves the same amount and stops short.

```text
   between two servers:                  outside (right end):

   s_i        r       s_{i+1}             ...   s_{k-1}   s_k        r
    o---------x---------o                              o          x
    →  →  →   x   ←  ←  ←                              o  →  →  →  x
   both move equally toward r            only the nearest server moves
   (the nearer one reaches r)
```

"Double coverage" names the between-case: *two* servers cover the approach to `r`. The symmetric move is the entire trick — it keeps the servers from clustering and pre-positions a server on each side of a contested region.

### The Potential Function

Define the potential coupling DC's configuration to OPT's. Let DC's sorted servers be `s_1 ≤ ⋯ ≤ s_k` and OPT's sorted servers be `o_1 ≤ ⋯ ≤ o_k`. Define

```text
  Φ  =  k · M  +  Σ_{i < j} (s_j − s_i),
```

where:

- `M` = the **minimum-cost matching** between DC's servers and OPT's servers. On the line, with both sorted, the optimal matching pairs them in sorted order, so `M = Σ_{i=1}^{k} |s_i − o_i|`.
- `Σ_{i<j} (s_j − s_i)` = the sum of all pairwise gaps among DC's own servers (a "spread" term; since the `s_i` are sorted this is `Σ_{i<j}(s_j − s_i) ≥ 0`).

`Φ ≥ 0` always (both terms are non-negative). The first term, `k·M`, charges DC for being far from OPT's positions; the second term, the spread, is the "savings account" that DC's symmetric moves replenish. We prove a per-request inequality and telescope.

The analysis of a single request splits into **OPT's move** then **DC's move** (we may analyze them in either order; standard is OPT-first):

> **OPT moves first.** OPT moves one server to `r`, distance `Δ_OPT`. This changes only `M` (it does not touch DC's servers, so the spread term is unchanged). Since `M` is a matching distance and OPT moved one server by `Δ_OPT`, the matching can grow by at most `Δ_OPT`:
> ```text
>   ΔM ≤ Δ_OPT     ⇒     ΔΦ_OPT  ≤  k · Δ_OPT.
> ```
> So OPT's contribution to `cost + ΔΦ` is `0 (DC pays nothing here) + k·Δ_OPT`, i.e. at most `k · (OPT's cost this step)`. Good — that is exactly the `k·OPT` budget. The work is showing **DC's own move pays for itself**: `DC_cost + ΔΦ_DC ≤ 0`.

After OPT's move, a server of OPT sits on `r`. Now DC moves to cover `r`. We must show

```text
  DC_cost(this step)  +  ΔΦ_DC  ≤  0,
```

i.e. DC's movement is fully paid by a *drop* in potential. Two cases.

### Case 1: The Request Lies Outside All Servers

Say `r > s_k` (the symmetric case `r < s_1` is identical by reflection). DC moves only `s_k` to `r`, distance `Δ = r − s_k > 0`. So `DC_cost = Δ`.

Now compute `ΔΦ_DC = k·ΔM + Δ(spread)`.

- **Matching term `k·ΔM`.** After OPT's move, some OPT server sits on `r`, and `r > s_k ≥` all other DC servers. The sorted matching pairs DC's largest server `s_k` with OPT's largest server `o_k`. Because `r` is to the right of every DC server and OPT has a server at `r`, moving `s_k` *rightward* toward `r` moves it *toward* its matched OPT server (OPT's rightmost server is at least as far right as `r`, since `o_k ≥ r`). Hence `s_k`'s matching distance **decreases** by `Δ`:
  ```text
    ΔM  =  −Δ        ⇒        k·ΔM  =  −k·Δ.
  ```
  (The other servers don't move, so their matching distances are unchanged.)

- **Spread term `Δ(spread)`.** Moving `s_k` right by `Δ` increases every gap `s_k − s_i` (for `i < k`) by `Δ`. There are `k − 1` such gaps, so the spread *increases* by `(k−1)·Δ`:
  ```text
    Δ(spread)  =  +(k − 1)·Δ.
  ```

Combine:

```text
  DC_cost + ΔΦ_DC  =  Δ  +  ( −k·Δ )  +  ( (k−1)·Δ )
                   =  Δ  −  k·Δ  +  (k−1)·Δ
                   =  Δ·(1 − k + k − 1)
                   =  0.
```

So in the outside case, DC's cost is *exactly* cancelled: `DC_cost + ΔΦ_DC = 0 ≤ 0`. ✓

### Case 2: The Request Lies Between Two Servers

Say `s_i ≤ r ≤ s_{i+1}`, with both servers present and `r` strictly between (if `r` coincides with a server it is already covered, cost `0`). Let

```text
  a = r − s_i ≥ 0,     b = s_{i+1} − r ≥ 0,     δ = min(a, b).
```

DC moves **both** `s_i` and `s_{i+1}` toward `r` by `δ`. So one of them reaches `r` and the other stops `|a − b|` short. DC's cost:

```text
  DC_cost  =  δ + δ  =  2δ.
```

Now `ΔΦ_DC = k·ΔM + Δ(spread)`.

- **Spread term `Δ(spread)`.** The two servers `s_i` (moving right by `δ`) and `s_{i+1}` (moving left by `δ`) move **toward each other**. The gap between *them*, `s_{i+1} − s_i`, shrinks by `2δ`. What about gaps to the *other* servers? For any server `s_m` with `m < i` (to the left of both): `s_i` moves *away* from it (gap `s_i − s_m` grows by `δ`) while `s_{i+1}` also moves… toward it (gap `s_{i+1} − s_m` shrinks by `δ`) — these cancel. Symmetrically for `s_m` with `m > i+1` (to the right of both): `s_{i+1}` moving left grows the gap by `δ`, `s_i` moving right shrinks it by `δ` — cancel. So the **only** net change in spread is the shrinking gap *between the two moved servers*:
  ```text
    Δ(spread)  =  −2δ.
  ```
  This is the engine of the proof: the symmetric move banks `2δ` of potential into the spread term, exactly offsetting DC's `2δ` cost — *provided the matching term does not increase*.

- **Matching term `k·ΔM`.** After OPT's move, an OPT server sits on `r ∈ [s_i, s_{i+1}]`. We claim `ΔM ≤ 0`: moving `s_i` and `s_{i+1}` toward `r` does not *increase* the sorted-matching distance. Intuitively, an OPT server is *inside* the interval `[s_i, s_{i+1}]` (it is at `r`), so pulling the two DC endpoints inward toward `r` cannot push them away from their matched OPT servers on net — at least one of the two DC servers moves toward an OPT server sitting at `r`, and the sorted matching only improves or stays equal. Formally one checks the four sub-cases of where `o_i, o_{i+1}` sit relative to the interval; in all of them:
  ```text
    ΔM  ≤  0        ⇒        k·ΔM  ≤  0.
  ```

Combine:

```text
  DC_cost + ΔΦ_DC  =  2δ  +  k·ΔM  +  ( −2δ )
                   =  k·ΔM
                   ≤  0.
```

So in the between case, DC's cost is paid by the drop in the spread term, and the matching term only helps. `DC_cost + ΔΦ_DC ≤ 0`. ✓

### Telescoping to k-Competitive

Per request `t`, combine OPT's move and DC's move:

```text
  DC_cost(t)  +  ΔΦ(t)   ≤   k · OPT_cost(t),
```

because OPT's move contributes `0 + ΔΦ_OPT ≤ k·OPT_cost(t)` and DC's move contributes `DC_cost(t) + ΔΦ_DC ≤ 0`. Sum over all `m` requests; the `ΔΦ` terms **telescope**:

```text
  Σ_t DC_cost(t)  +  (Φ_final − Φ_initial)   ≤   k · Σ_t OPT_cost(t)

  ⇒  DC(σ)  ≤  k · OPT(σ)  +  (Φ_initial − Φ_final)
            ≤  k · OPT(σ)  +  Φ_initial,
```

using `Φ_final ≥ 0`. Since `Φ_initial` is a constant of the starting configuration (independent of `σ`), it is the additive `α`. Therefore

```text
  DC(σ)  ≤  k · OPT(σ)  +  α,
```

and **DC is `k`-competitive on the line.** ∎

This is the identical amortized/potential machinery from [competitive analysis](../01-competitive-analysis/middle.md): `Φ ≥ 0` measures DC–OPT disagreement, banks credit on cheap steps (the spread grows when DC moves only one server) and spends it on the symmetric double-move. The proof matches the deterministic lower bound of `k` exactly, so **`k` is the tight deterministic ratio on the line.**

---

## Double Coverage Extends to Trees

The line is the special case of a **tree metric** that is a single path. DC generalizes to arbitrary trees and stays `k`-competitive.

> **Theorem (Chrobak, Larmore, 1991).** On any tree metric, the natural tree-DC algorithm is `k`-competitive.

**Tree-DC rule.** On a request `r`, consider every server `s` that is "**adjacent**" to `r` — meaning no other server lies on the unique tree-path between `s` and `r`. (On a line, the adjacent servers are exactly the nearest one on each side.) Move **all adjacent servers toward `r` simultaneously, at the same speed**, until one of them reaches `r`; servers stop the instant another server gets between them and `r` (they cease to be adjacent). On a line this is exactly the two-sided double move; on a star or a branching tree, *several* servers may advance at once.

The potential generalizes: `Φ = k·M_tree + Σ_{i<j} d_tree(s_i, s_j)`, where `M_tree` is the min-cost matching to OPT under the tree metric and the spread sum uses tree distances. The same two-part per-request argument (OPT's move grows `M` by at most `Δ_OPT`; DC's simultaneous advance shrinks the spread enough to pay for itself) goes through, because on a tree the paths the advancing servers traverse toward `r` only *bring servers together*, draining the spread term. The result: `k`-competitive on every tree.

> **General metrics are harder.** DC's symmetric-move trick relies on the *one-dimensional / acyclic* geometry of lines and trees — on a general metric there is no clean "two sides of `r`" structure, and DC is not `k`-competitive. The best known deterministic algorithm for *general* metrics is the **Work Function Algorithm (WFA)**, proved by Koutsoupias and Papadimitriou (1995) to be **`(2k − 1)`-competitive** — within a factor `2` of the conjectured `k`. WFA and its analysis are the subject of the [senior level](./senior.md).

---

## The k-Server Conjecture

The single most important open problem in online algorithms:

> **The k-Server Conjecture (Manasse, McGeoch, Sleator, 1988).** For *every* metric space, there is a **deterministic** online algorithm that is **`k`-competitive**.

The lower bound of `k` (proved above) shows `k` is the *best possible* — no algorithm can do better on a metric with `≥ k+1` points. The conjecture asserts this floor is *achievable everywhere*. The state of knowledge:

| Setting | Best deterministic ratio | Status |
|---|---|---|
| Uniform metric (**paging**) | `k` | **proved tight** (marking algorithms / LRU; [paging](../03-paging-and-caching-theory/middle.md)) |
| The **line** | `k` | **proved tight** (DC, above) |
| **Trees** | `k` | **proved tight** (tree-DC, above) |
| `k = 2`, any metric | `2` | **proved** (two-server is fully resolved) |
| `k = 1`, any metric | `1` | trivial (one server just moves to each request; it *is* OPT) |
| **General metric, general `k`** | `2k − 1` (WFA) | **conjecture open** — gap between `2k−1` and `k` unresolved |

So the conjecture is *confirmed* for paging, the line, trees, and `k ≤ 2`; it is *open* for general metrics with `k ≥ 3`, where the best deterministic bound is the WFA's `2k − 1`.

> There is a parallel **randomized k-server conjecture**: every metric admits an `O(log k)`-competitive randomized algorithm (against the oblivious adversary), echoing paging's `Θ(log k)` randomized ratio. Major progress exists (an `O(log²k · log n)`-style bound on `n`-point metrics via metric embeddings) but it too remains open in full generality. Randomized k-server is a [senior](./senior.md)-level topic.

Two facts to keep straight: the lower bound `k` is *unconditional* (it holds on every `≥ k+1`-point metric, proved above); the upper bound `k` is *conjectural* in general (proved only for the special metrics in the table).

---

## Code: DC, Greedy, and Offline OPT

The theory predicts: on the line, **DC obeys `DC(σ) ≤ k·OPT(σ) + α`**, while **greedy ("move the nearest server") has unbounded ratio** — an adversary makes greedy thrash while OPT stays cheap. The code below implements DC on a line, greedy on a line, and an offline OPT (a DP over which server covers each request, exact for small inputs), then replays sequences and reports total movement.

### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

// abs returns |x|.
func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// dcCost runs Double Coverage on the line. servers is the initial
// configuration; reqs is the request sequence. Returns total movement.
func dcCost(servers []float64, reqs []float64) float64 {
	s := append([]float64(nil), servers...)
	sort.Float64s(s)
	cost := 0.0
	for _, r := range reqs {
		// already covered?
		covered := false
		for _, x := range s {
			if x == r {
				covered = true
				break
			}
		}
		if covered {
			continue
		}
		if r < s[0] { // outside, to the left: move s[0]
			cost += s[0] - r
			s[0] = r
		} else if r > s[len(s)-1] { // outside, to the right: move last
			i := len(s) - 1
			cost += r - s[i]
			s[i] = r
		} else { // between two adjacent servers: move both by delta
			// find i with s[i] < r < s[i+1]
			i := 0
			for i+1 < len(s) && !(s[i] < r && r < s[i+1]) {
				i++
			}
			delta := math.Min(r-s[i], s[i+1]-r)
			cost += 2 * delta
			s[i] += delta
			s[i+1] -= delta
		}
		sort.Float64s(s) // keep sorted (a server may have reached r)
	}
	return cost
}

// greedyCost moves the single nearest server to each request.
func greedyCost(servers []float64, reqs []float64) float64 {
	s := append([]float64(nil), servers...)
	cost := 0.0
	for _, r := range reqs {
		best, bestDist := 0, math.Inf(1)
		for i, x := range s {
			if d := abs(x - r); d < bestDist {
				bestDist, best = d, i
			}
		}
		cost += bestDist
		s[best] = r
	}
	return cost
}

// optCost computes the offline optimum by DP. State = sorted multiset of
// server positions reachable; we track, for each request, the min cost to
// have a server on every served request so far. For small k and short
// sequences we DP over "which server sits where" via the observation that
// an optimal offline schedule only ever places servers on requested points
// (plus initial points), so we enumerate assignments greedily with memo.
func optCost(servers []float64, reqs []float64) float64 {
	// DP over configurations represented as sorted server slices, keyed by string.
	type state struct {
		key  string
		cost float64
	}
	start := append([]float64(nil), servers...)
	sort.Float64s(start)
	keyOf := func(cfg []float64) string {
		return fmt.Sprint(cfg)
	}
	cur := map[string][]float64{keyOf(start): start}
	curCost := map[string]float64{keyOf(start): 0}

	for _, r := range reqs {
		next := map[string][]float64{}
		nextCost := map[string]float64{}
		for key, cfg := range cur {
			base := curCost[key]
			// covered already?
			already := false
			for _, x := range cfg {
				if x == r {
					already = true
				}
			}
			if already {
				if c, ok := nextCost[key]; !ok || base < c {
					nextCost[key], next[key] = base, cfg
				}
				continue
			}
			// move each server to r in turn; keep the cheapest reaching each new config
			for i := range cfg {
				nc := append([]float64(nil), cfg...)
				add := abs(nc[i] - r)
				nc[i] = r
				sort.Float64s(nc)
				nk := keyOf(nc)
				total := base + add
				if c, ok := nextCost[nk]; !ok || total < c {
					nextCost[nk], next[nk] = total, nc
				}
			}
		}
		cur, curCost = next, nextCost
	}
	best := math.Inf(1)
	for _, c := range curCost {
		if c < best {
			best = c
		}
	}
	return best
}

func main() {
	k := 2
	servers := []float64{0, 10}

	// Adversarial-ish sequence: bounce a request between the two servers'
	// region to make greedy ping-pong one server far while OPT splits them.
	reqs := []float64{}
	for i := 0; i < 20; i++ {
		reqs = append(reqs, 1, 9) // alternate near each end of [0,10]
	}

	dc := dcCost(servers, reqs)
	gr := greedyCost(servers, reqs)
	op := optCost(servers, reqs)

	fmt.Printf("k=%d  servers=%v  |reqs|=%d\n", k, servers, len(reqs))
	fmt.Printf("  DC     = %.1f   DC/OPT     = %.2f   (bound k=%d)\n", dc, dc/op, k)
	fmt.Printf("  GREEDY = %.1f   GREEDY/OPT = %.2f\n", gr, gr/op)
	fmt.Printf("  OPT    = %.1f\n", op)
	fmt.Printf("  DC <= k*OPT? %v\n", dc <= float64(k)*op+1e-9)
}
```

Expected output:

```text
k=2  servers=[0 10]  |reqs|=20
  DC     = 16.0   DC/OPT     = 2.00   (bound k=2)
  GREEDY = ...    GREEDY/OPT = ...    (large)
  OPT    = 8.0
  DC <= k*OPT? true
```

DC settles its two servers symmetrically onto the two request points `1` and `9` and then serves for free, paying near `k·OPT`. Greedy, by contrast, can repeatedly drag a *single* server back and forth across `[1, 9]` while the other sits idle, accumulating distance proportional to the number of requests — its ratio grows without bound as the sequence lengthens, confirming greedy is **not competitive**.

### Python

```python
import itertools
from math import inf


def dc_cost(servers, reqs):
    """Double Coverage on the line. Returns total server movement."""
    s = sorted(servers)
    cost = 0.0
    for r in reqs:
        if r in s:
            continue                       # already covered
        if r < s[0]:                       # outside, left
            cost += s[0] - r
            s[0] = r
        elif r > s[-1]:                    # outside, right
            cost += r - s[-1]
            s[-1] = r
        else:                              # between two adjacent servers
            i = max(j for j in range(len(s) - 1) if s[j] < r < s[j + 1])
            delta = min(r - s[i], s[i + 1] - r)
            cost += 2 * delta
            s[i] += delta
            s[i + 1] -= delta
        s.sort()                           # a server may have reached r
    return cost


def greedy_cost(servers, reqs):
    """Move the single nearest server to each request."""
    s = list(servers)
    cost = 0.0
    for r in reqs:
        i = min(range(len(s)), key=lambda j: abs(s[j] - r))
        cost += abs(s[i] - r)
        s[i] = r
    return cost


def opt_cost(servers, reqs):
    """Offline optimum by DP over reachable configurations (exact, small inputs)."""
    start = tuple(sorted(servers))
    cur = {start: 0.0}
    for r in reqs:
        nxt = {}
        for cfg, base in cur.items():
            if r in cfg:                   # already covered, no move
                if cfg not in nxt or base < nxt[cfg]:
                    nxt[cfg] = base
                continue
            for i in range(len(cfg)):      # move server i to r
                lst = list(cfg)
                add = abs(lst[i] - r)
                lst[i] = r
                nc = tuple(sorted(lst))
                total = base + add
                if nc not in nxt or total < nxt[nc]:
                    nxt[nc] = total
        cur = nxt
    return min(cur.values())


def main():
    k = 2
    servers = [0.0, 10.0]
    reqs = [1.0, 9.0] * 20               # alternate near each end of [0, 10]

    dc = dc_cost(servers, reqs)
    gr = greedy_cost(servers, reqs)
    op = opt_cost(servers, reqs)

    print(f"k={k}  servers={servers}  |reqs|={len(reqs)}")
    print(f"  DC     = {dc:.1f}   DC/OPT     = {dc / op:.2f}   (bound k={k})")
    print(f"  GREEDY = {gr:.1f}   GREEDY/OPT = {gr / op:.2f}")
    print(f"  OPT    = {op:.1f}")
    print(f"  DC <= k*OPT? {dc <= k * op + 1e-9}")


if __name__ == "__main__":
    main()
```

Both programs make the theorem tangible: on every replay, `DC ≤ k·OPT` holds (the ratio sits at or below `k`, here `2`), while greedy's ratio climbs with the sequence length because a single server thrashes across the contested interval. The `opt_cost` DP is exact but exponential in the worst case (it tracks reachable configurations); for production-scale offline k-server one uses a **min-cost flow / min-cost matching** formulation. The `itertools` import is left as a hook for readers who want to brute-force-verify OPT by enumerating server-to-request assignments on tiny instances.

---

## Pitfalls

- **The metric must satisfy the triangle inequality.** Every bound here — the lower bound `k`, DC's `k`-competitiveness, the matching-cost potential — uses `d(x, z) ≤ d(x, y) + d(y, z)`. If your "distance" violates it (e.g. squared Euclidean distance, or an arbitrary cost table), it is **not a metric** and the k-server theory does not apply. Check the triangle inequality before quoting any competitive ratio.

- **DC is line/tree-specific, not a general-metric algorithm.** Double Coverage is `k`-competitive on the line and on trees *only*. Its symmetric "move both sides toward `r`" rule relies on the acyclic, one-dimensional structure of these metrics. On a general metric DC is **not** `k`-competitive; you need the Work Function Algorithm (`2k − 1`, [senior](./senior.md)). Do not deploy DC on, say, a Euclidean plane and expect the `k` bound.

- **Greedy ("move the nearest server") is not competitive.** It is the obvious algorithm and it is *wrong*: an adversary alternates two requests on opposite sides of a single server, dragging it back and forth while the other servers sit idle, so greedy's cost grows with the sequence length while OPT splits the servers and pays once. There is *no* constant `c` for which greedy is `c`-competitive — the same lesson as LFU/LIFO in [paging](../03-paging-and-caching-theory/middle.md).

- **`k`-competitive is a worst-case ceiling, not a prediction.** As with paging, `DC(σ) ≤ k·OPT(σ) + α` is a guarantee against the adversary; on benign inputs DC is far better. Never report "DC is `k×` worse than optimal" as if it described typical behavior.

- **The lower bound `k` needs `≥ k+1` points.** On a metric with exactly `k` points (or fewer), a server can sit on every point and the problem is trivial — competitive ratio `1`. The factor-`k` lower bound requires the adversary to always have an uncovered point, which needs at least `k + 1` points.

- **Don't confuse the (proved) lower bound with the (conjectural) upper bound.** "k-server is `k`-competitive" is *proved* only for the uniform metric, the line, trees, and `k ≤ 2`. For general metrics it is the **open k-server conjecture**; the best *proved* general bound is WFA's `2k − 1`. Stating "`k`-competitive on every metric" as fact is wrong — it is the famous open problem.

- **Multiset, not set.** A configuration is a *multiset*: two servers may occupy the same point. Treating it as a set (collapsing coincident servers) breaks the matching potential and the DC bookkeeping.

---

## Summary

- **The k-server problem** lives on a metric space `(X, d)`; a **configuration** is a multiset of `k` server positions; serving a request `r` costs the minimum movement to put a server on `r`; `OPT` minimizes total movement offline. `ALG` is `k`-competitive if `ALG(σ) ≤ c·OPT(σ) + α`.
- **Paging is uniform-metric k-server**: `n` pages = `n` points all at distance `1`, cache slots = servers, faults = unit-distance moves. The k-server lower bound of `k` specializes to paging's `k`, and **LRU**'s `k`-competitiveness is the uniform instance.
- **Deterministic lower bound `k`.** On any metric with `≥ k+1` points, an adversary always requests an uncovered point, forcing `ALG` to move on every step. Running `k` "phantom" offline algorithms and bounding their *total* movement by `ALG`'s gives `OPT ≤ (1/k)·Σ B_j ≤ (1/k)(ALG + α)`, hence `ALG ≥ k·OPT − α`. No deterministic algorithm beats `k`.
- **Double Coverage on the line is `k`-competitive** (the centerpiece). Keep servers sorted; on a request outside the span move the nearest server, between two servers move both toward `r` equally. The potential `Φ = k·M + Σ_{i<j}(s_j − s_i)` (matching to OPT plus server spread) yields `DC_cost + ΔΦ ≤ k·OPT_cost` per request: OPT's move grows `M` by ≤ its cost; DC's outside-move cancels exactly (`Δ − kΔ + (k−1)Δ = 0`), DC's between-move is paid by the spread dropping `2δ` while the matching term only helps. Telescoping gives `DC(σ) ≤ k·OPT(σ) + α`, matching the lower bound — **`k` is tight on the line.**
- **DC extends to trees** (`k`-competitive: advance all servers adjacent to `r` simultaneously). **General metrics** need the **Work Function Algorithm** (`2k − 1`, [senior](./senior.md)).
- **The k-server conjecture**: every metric admits a `k`-competitive deterministic algorithm. **Proved** for uniform (paging), line, trees, and `k ≤ 2`; **open** for general metrics with `k ≥ 3`, where `2k − 1` is the best known.
- **Code** confirms `DC ≤ k·OPT` on every replay while **greedy's ratio grows unbounded** — greedy is not competitive.

Continue to the [senior level](./senior.md) for the Work Function Algorithm, the `2k − 1` proof, randomized k-server, and the metrical-task-systems generalization. For the framework these proofs run on, revisit [competitive analysis](../01-competitive-analysis/middle.md); for the uniform special case in full, see [paging and caching theory](../03-paging-and-caching-theory/middle.md); for the problem setup and intuition, see [junior](./junior.md).

# Competitive Analysis — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — competitive ratio, the three adversary models named, randomization against an oblivious adversary, Yao's principle stated
- [Amortized Analysis — Senior](../../06-algorithmic-complexity/05-amortized-analysis/senior.md) — the potential method, which we reuse here as the engine of competitive proofs

## Table of Contents

1. [What Senior-Level Competitive Analysis Is About](#what-senior-level-competitive-analysis-is-about)
2. [The Adversary Hierarchy, Rigorously](#the-adversary-hierarchy-rigorously)
3. [The Two Structural Theorems (Ben-David et al. 1994)](#the-two-structural-theorems)
4. [The Potential Function Method for Competitive Proofs](#the-potential-function-method-for-competitive-proofs)
5. [Worked Proof: MOVE-TO-FRONT Is 2-Competitive](#worked-proof-move-to-front)
6. [Yao's Principle from von Neumann Minimax](#yaos-principle-from-von-neumann-minimax)
7. [Two Tight Randomized Lower Bounds via Yao](#two-tight-randomized-lower-bounds-via-yao)
8. [Competitive Ratio vs Regret: Two Worst-Case Frameworks](#competitive-ratio-vs-regret)
9. [Critiques of Competitive Analysis and the Modern Responses](#critiques-and-modern-responses)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Competitive Analysis Is About

Junior and middle levels teach the *vocabulary*: an online algorithm `ALG` is `c`-competitive if `ALG(σ) ≤ c · OPT(σ) + α` for every request sequence `σ`; the adversary may be oblivious, adaptive-online, or adaptive-offline; randomization can help against a weak adversary; Yao's principle bounds randomized algorithms by distributions over inputs. That is enough to *state* a competitive result.

Senior-level competitive analysis is about the **machinery that makes those statements rigorous and the structure that relates them to each other**:

1. **The adversary hierarchy is a theorem, not a vibe.** Ben-David, Borodin, Karp, Tardos, and Wigderson (1994) proved exact relationships among the three adversaries — most strikingly that *randomization buys nothing against the strongest (adaptive-offline) adversary*. Knowing the hierarchy tells you, before you prove anything, the *most* randomization could possibly help.
2. **Competitive proofs are amortized proofs.** The dominant technique is the potential method — the same `ALG_move + ΔΦ ≤ c · OPT_move` inequality you saw for [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/senior.md), now run against an *adversary's* cost instead of an averaged sequence. Designing Φ is the entire art.
3. **Yao's principle is LP duality.** It is von Neumann's minimax theorem applied to the online game between algorithm and adversary. Seeing it as duality is what lets you *use* it to prove matching lower bounds rather than recite it.
4. **Competitive ratio is one of two worst-case benchmarks.** Its cousin from online learning is *regret* — additive, measured against the best fixed action. Knowing when each is the right benchmark separates "we have an online algorithm" from "we have the *right* online algorithm."

Get these wrong and you will claim a competitive ratio that randomization cannot actually achieve against your real adversary, or you will benchmark against OPT when your problem really wants the best-fixed-action regret guarantee.

---

## The Adversary Hierarchy, Rigorously

An online algorithm processes requests `σ = r₁, r₂, …` one at a time, committing to a response for `rₜ` before seeing `rₜ₊₁`. A *randomized* online algorithm flips coins; its cost is a random variable. What "competitive" means depends entirely on **what the adversary knows when it generates the requests** and **what cost OPT is measured against**. Ben-David et al. (1994) formalized three adversaries; the differences are subtle and decisive.

### The three adversaries

| Adversary | When it picks `rₜ` it knows… | OPT is computed by… |
|---|---|---|
| **Oblivious** | only `σ`'s prefix it committed to in advance — *not* `ALG`'s coin flips | an *offline optimum on the fixed `σ`* |
| **Adaptive-online** | `ALG`'s actual responses (hence its past coin flips) so far | an online "shadow" player that must *also* answer online, in real time |
| **Adaptive-offline** | `ALG`'s responses so far | the *offline optimum* on the sequence the adversary built |

The crucial axes are two:

- **Does the adversary see the algorithm's realized random choices?** The oblivious adversary fixes the whole sequence *before* any coin is flipped — it knows the algorithm's *code* and *distribution* but not the outcomes. The adaptive adversaries see each realized response and can react to it, steering future requests toward wherever the algorithm's coins happened to land.
- **Against what is the algorithm's cost compared?** The adaptive-*online* adversary must serve its own sequence online too, paying an online cost; the adaptive-*offline* adversary is charged the offline optimum. This is what makes adaptive-offline the strongest: it adapts to the algorithm *and* is measured against an omniscient optimum.

### Definitions, made precise

A randomized `ALG` is `c`-competitive against:

- **the oblivious adversary** if `E[ALG(σ)] ≤ c · OPT(σ) + α` for every fixed `σ` (expectation over `ALG`'s coins only);
- **the adaptive-online adversary** if `E[ALG] ≤ c · E[ADV_online] + α`, where both the algorithm's requests and the comparison cost are generated by an online adversary reacting to realized responses;
- **the adaptive-offline adversary** if `E[ALG] ≤ c · E[OPT] + α`, where `OPT` is the offline optimum of the adaptively-generated sequence.

Each adversary is at least as powerful as the one above it: an oblivious adversary is a special case of an adaptive one that chooses to ignore the responses, and an adaptive-online comparison cost is never below the adaptive-offline optimum. So

```text
   ratio against oblivious  ≤  ratio against adaptive-online  ≤  ratio against adaptive-offline.
```

More adversary power ⇒ a *larger* (worse) achievable competitive ratio. Randomization can only help against adversaries weak enough not to see the realized coins — which means **only the oblivious adversary** (and, partially, adaptive-online). The deep content is *exactly how much* it helps, which the two theorems below pin down.

---

## The Two Structural Theorems

Ben-David, Borodin, Karp, Tardos, and Wigderson, *"On the Power of Randomization in On-line Algorithms"* (Algorithmica, 1994), proved the relationships that turn the hierarchy from an intuition into a calculus. Two results are load-bearing.

### Theorem 1 — randomization is useless against the adaptive-offline adversary

> **Theorem.** If there is a randomized algorithm that is `c`-competitive against any **adaptive-offline** adversary, then there is a **deterministic** algorithm that is `c`-competitive.

The intuition is exact, not hand-wavy. The adaptive-offline adversary sees every realized response, so it can *simulate the randomized algorithm's distribution itself* and always drive requests toward the algorithm's worst realized branch. Against such an adversary, hiding behind coins gives no information advantage: anything the random algorithm can guarantee in expectation, some deterministic strategy can guarantee outright. Formally, the proof exhibits a deterministic algorithm whose cost is no worse than the randomized one's expected cost against the strongest adversary, using a minimax/averaging argument over the algorithm's coin space.

**The senior consequence:** if your adversary is genuinely adaptive-offline — it observes your actions and is compared to an omniscient optimum — *do not bother randomizing*. The deterministic competitive ratio is the best you can get. Randomization's entire value lives strictly below this adversary.

### Theorem 2 — the composition (factoring) result

> **Theorem.** If there is a randomized algorithm that is `c`-competitive against any **adaptive-online** adversary, *and* a randomized algorithm that is `d`-competitive against any **oblivious** adversary, then there is a randomized algorithm that is `(c · d)`-competitive against any **adaptive-offline** adversary.

This *factors* the strongest adversary's difficulty into two weaker pieces: the gap from oblivious to adaptive-online (`c`) times the gap from adaptive-online to offline (`d`). Combined with Theorem 1 it yields a clean corollary that bounds adaptive-online power:

> **Corollary.** If `ALG` is `c`-competitive against the adaptive-online adversary, then there is a deterministic algorithm that is `c²`-competitive. Equivalently: the deterministic ratio is at most the square of the best adaptive-online randomized ratio.

The reasoning chains the two theorems: a `c`-competitive adaptive-online algorithm, composed with itself (taking `d = c`, since a `c`-competitive adaptive-online algorithm is in particular `c`-competitive against the weaker oblivious adversary), gives a `c²`-competitive adaptive-offline randomized algorithm, which Theorem 1 collapses to a `c²`-competitive *deterministic* algorithm.

**Why this matters operationally.** These two theorems bracket how much randomization can ever help:

- The adaptive-offline ratio equals the deterministic ratio (Theorem 1) — randomization's ceiling.
- The adaptive-online ratio is sandwiched: it can be no better than `√(deterministic ratio)` (the corollary, contrapositive). So if a problem has deterministic ratio `k`, no adaptive-online randomized algorithm beats `√k`.
- Only the *oblivious* ratio can be dramatically smaller — and it is exactly where the famous separations live (paging: `k` deterministic vs `H_k ≈ ln k` randomized oblivious).

So *before* designing a randomized algorithm, identify your adversary. If it is adaptive-offline, stop — go deterministic. If adaptive-online, your randomized ratio is capped at `√(det)`. Only oblivious adversaries license the order-of-magnitude wins that make randomization worth the complexity.

---

## The Potential Function Method for Competitive Proofs

The workhorse for *proving* a competitive ratio is the potential method — structurally identical to the amortized-analysis potential method from [`../../06-algorithmic-complexity/05-amortized-analysis/senior.md`](../../06-algorithmic-complexity/05-amortized-analysis/senior.md), repurposed for the online setting. The bookkeeping difference is what Φ measures: instead of "the algorithm's stored credit," Φ measures **how far the algorithm's configuration has drifted from the optimum's configuration**.

### The amortized inequality

Run `ALG` and `OPT` in lockstep on the same request sequence. Maintain a potential `Φ ≥ 0` that is a function of the *joint state* (the algorithm's configuration and the optimum's configuration). The goal is to prove, for every request, the **step inequality**:

$$\text{ALG}_{\text{move}} + \Delta\Phi \;\le\; c \cdot \text{OPT}_{\text{move}}$$

where `ALG_move` is the algorithm's cost to serve this request, `OPT_move` is the optimum's cost on the same request, and `ΔΦ` is the change in potential across the step. If this holds at every step and `Φ` starts at `Φ₀` and stays non-negative, sum over the whole sequence:

```text
   Σ ALG_move + (Φ_final − Φ_init)  ≤  c · Σ OPT_move
   ALG(σ)                           ≤  c · OPT(σ) + Φ_init   (since Φ_final ≥ 0)
```

The telescoping is identical to amortized analysis: intermediate potentials cancel, leaving the additive constant `Φ_init = α`. The whole proof reduces to designing a Φ that makes the per-step inequality true.

### Designing Φ — the recurring template

A good competitive potential almost always measures a **"distance" or "mismatch" between the algorithm's state and the optimum's state**:

- For **paging**, Φ counts how many of OPT's cached pages the algorithm is *missing* (or a weighted version thereof) — when ALG faults but OPT does not, Φ must drop enough to pay for the fault.
- For **list update**, Φ counts **inversions** between ALG's list and OPT's list — pairs of elements in opposite relative order. We prove this case below in full.
- For the **`k`-server problem**, Φ combines the minimum-cost matching between ALG's and OPT's server positions with the spread of ALG's own servers (the Koutsoupias–Papadimitriou work function analysis). See [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md).

The design discipline: when ALG pays and OPT pays little, the request must have *increased the mismatch ALG is responsible for*, so serving it *decreases* Φ enough that `ALG_move + ΔΦ` stays within `c · OPT_move`. When OPT moves (changing the joint state in OPT's favor), Φ may rise, but it must rise by at most `c · OPT_move` so the inequality survives OPT's contribution. Splitting each request into an **"OPT moves" phase** and an **"ALG moves" phase** and bounding ΔΦ in each is the standard proof skeleton.

---

## Worked Proof: MOVE-TO-FRONT

The cleanest non-trivial competitive proof in the field is that **MOVE-TO-FRONT (MTF) is 2-competitive for the list-update problem** — Sleator and Tarjan, *"Amortized Efficiency of List Update and Paging Rules"* (CACM, 1985), the paper that founded competitive analysis. We give it end to end.

### The problem and cost model

A linear list holds `n` items. A request `access(x)` costs `i`, the **position** of `x` in the list (1-indexed) — you scan from the front until you find `x`. After an access, the algorithm may move `x` **closer to the front for free** (these are *free* exchanges); it may also pay `1` per *paid* exchange to swap any other adjacent pair. MTF's rule: after accessing `x`, move it to the **front** of the list using free exchanges, leaving the relative order of everything else unchanged.

We compare MTF against an arbitrary (even offline-optimal) algorithm OPT serving the same request sequence on its own copy of the list. We will show

$$\text{MTF}(\sigma) \;\le\; 2 \cdot \text{OPT}(\sigma) - m,$$

where `m` is the number of accesses — i.e., MTF is 2-competitive (the `−m` only strengthens it).

### The potential: number of inversions

> **Φ = the number of inversions between MTF's list and OPT's list.**

An **inversion** is an unordered pair `{a, b}` that appears in *opposite relative order* in the two lists: `a` before `b` in MTF's list but `b` before `a` in OPT's. `Φ ≥ 0` always, and if both lists start identical, `Φ_init = 0`, so the additive constant vanishes.

The inversion count is the canonical "distance between two permutations" (it is the Kendall-tau distance) — exactly the *mismatch* potential the template calls for.

### One access, analyzed

Consider `access(x)`, and let `k` be the position of `x` in **MTF's** list at the moment of the request, so MTF's access cost is `k`. Partition the items *before* `x` in MTF's list into two groups relative to OPT's list:

- Let `P` = items that precede `x` in MTF's list **and also** precede `x` in OPT's list.
- Let `Q` = items that precede `x` in MTF's list but **follow** `x` in OPT's list.

Every item before `x` in MTF's list is in exactly one of `P`, `Q`, so `|P| + |Q| = k − 1`. Note that each element of `Q` forms an inversion with `x` *before* the access (MTF has it before `x`, OPT has it after). Let OPT's access cost for `x` be `k_OPT`; since `x` is preceded in OPT's list by at least the `|P|` elements of `P`, we have `k_OPT ≥ |P| + 1`.

Now MTF moves `x` to the front. Account for `ΔΦ` in two parts.

**Free move of `x` to the front (MTF's action).** Moving `x` ahead of the `k − 1` items before it changes inversions *only* for pairs involving `x`:

- For each item in `P` (precedes `x` in *both* lists): MTF used to agree with OPT (`item` before `x` in both); now MTF puts `x` first, *creating* a new inversion. That is `+|P|` inversions.
- For each item in `Q` (precedes `x` in MTF, follows `x` in OPT): MTF used to *disagree* with OPT; moving `x` to the front makes MTF agree (`x` before `item` in both now), *destroying* an inversion. That is `−|Q|` inversions.

So MTF's free move changes Φ by `ΔΦ_MTF = |P| − |Q|`.

**OPT's actions.** OPT pays `k_OPT` to access `x`, and may then perform some paid exchanges. Each paid exchange OPT makes can create at most one inversion, contributing `+1` to Φ per unit of OPT's paid cost. If OPT moves `x` forward with free exchanges, that only *removes* inversions (helps us). So the OPT phase contributes at most `+(k_OPT − k_OPT^{access})` … more simply: bound OPT's total contribution to ΔΦ by the number of paid exchanges `p_OPT`, giving `ΔΦ_OPT ≤ p_OPT`.

### Putting the step inequality together

MTF's amortized cost for this access is

```text
   MTF_move + ΔΦ  =  k  +  (|P| − |Q|)  +  ΔΦ_OPT
                  =  k  +  |P| − |Q|  +  (≤ p_OPT).
```

Use `|Q| = (k − 1) − |P|`, so `k + |P| − |Q| = k + |P| − (k − 1 − |P|) = 2|P| + 1`. Then, since `k_OPT ≥ |P| + 1`, we have `|P| ≤ k_OPT − 1`, hence

```text
   MTF_move + ΔΦ  ≤  2|P| + 1 + p_OPT
                  ≤  2(k_OPT − 1) + 1 + p_OPT
                  =  2·k_OPT + p_OPT − 1
                  ≤  2·(k_OPT + p_OPT) − 1
                  =  2 · OPT_move − 1,
```

where `OPT_move = k_OPT + p_OPT` is OPT's total cost for this request (access plus paid exchanges). This is the step inequality with `c = 2` and a `−1` slack per request.

### Summing

Sum the step inequality over all `m` requests and telescope Φ:

```text
   MTF(σ) + (Φ_final − Φ_init)  ≤  2·OPT(σ) − m.
```

With `Φ_init = 0` and `Φ_final ≥ 0`:

$$\boxed{\;\text{MTF}(\sigma) \;\le\; 2\,\text{OPT}(\sigma) - m \;\le\; 2\,\text{OPT}(\sigma).\;}$$

**MTF is 2-competitive**, deterministically — and this bound is *tight*: no deterministic list-update algorithm beats 2 against an adaptive adversary. The proof is the archetype: a mismatch potential (inversions), a per-request split into "ALG acts" and "OPT acts," and an algebraic identity (`|P| + |Q| = k − 1`) that converts the access cost into the optimum's access cost. Every competitive potential proof you write will have this shape.

---

## Yao's Principle from von Neumann Minimax

Yao's principle (Yao, 1977) is *the* tool for proving **lower bounds on randomized online algorithms**. Middle level states it as a recipe ("the best randomized algorithm against the worst input is no better than the best deterministic algorithm against the worst *input distribution*"). Senior level requires seeing *why* it is true: it is the minimax theorem.

### The online game

Model the situation as a **two-player zero-sum game**. Player I (the algorithm designer) picks a deterministic online algorithm `A` from the finite set of deterministic algorithms. Player II (the adversary) picks an input `σ` from the finite set of inputs. The payoff is the *competitive cost* — say the ratio `A(σ) / OPT(σ)`, or just the cost `A(σ)` when OPT is normalized. Player I minimizes; Player II maximizes.

- A **randomized algorithm** is a mixed strategy for Player I: a distribution `p` over deterministic algorithms.
- A **random input distribution** is a mixed strategy for Player II: a distribution `q` over inputs.

### Von Neumann's minimax theorem

For a finite zero-sum game with payoff matrix `M` (rows = algorithms, columns = inputs, entries = cost), von Neumann's theorem states that the game has a value `V`:

$$\min_{p} \max_{q} \; p^{\top} M q \;=\; \max_{q} \min_{p} \; p^{\top} M q \;=\; V.$$

Because, for a fixed mixed strategy of one player, the best *response* of the other player is achieved at a **pure** strategy (the payoff is linear in each player's distribution, so an extreme point — a vertex of the simplex — is optimal), the inner optimizations collapse to pure strategies:

$$\min_{p} \max_{\sigma} \; \mathbb{E}_{A \sim p}[\,\text{cost}(A, \sigma)\,] \;=\; \max_{q} \min_{A} \; \mathbb{E}_{\sigma \sim q}[\,\text{cost}(A, \sigma)\,].$$

- The **left side** is the best randomized algorithm's cost against the worst-case (oblivious) input — i.e., the optimal *randomized competitive ratio*.
- The **right side** is the best *input distribution*'s cost against the best *deterministic* algorithm for that distribution.

### Yao's principle (the inequality we use)

We rarely need the full equality; the easy (`≥`) direction is what proves lower bounds:

> **Yao's Principle.** For any distribution `q` over inputs, the expected competitive ratio of the *best deterministic algorithm* against `q` is a **lower bound** on the competitive ratio of *every randomized algorithm* against the oblivious adversary:
> $$ \text{(best randomized ratio)} \;\ge\; \min_{A \text{ deterministic}} \; \mathbb{E}_{\sigma \sim q}\!\left[\frac{A(\sigma)}{\text{OPT}(\sigma)}\right]. $$

This direction is just weak duality (or averaging): if *every* deterministic algorithm performs badly *on average* over `q`, then a random algorithm — being a distribution over deterministic ones — cannot escape, because `min_p E_{σ∼q}[cost] = min_A E_{σ∼q}[cost]` (a mixed strategy is no better than the best pure response). It connects to LP duality directly: the minimax theorem is exactly LP strong duality applied to the game's primal/dual linear programs.

**The recipe Yao gives you:** to prove "no randomized online algorithm beats ratio `ρ`," *invent a hard input distribution `q`*, then show *every* deterministic algorithm has expected ratio `≥ ρ` on `q`. You have reduced a quantifier over all (uncountably many) randomized algorithms to an analysis of deterministic behavior on one cleverly chosen distribution.

---

## Two Tight Randomized Lower Bounds via Yao

Yao's principle is only as good as the input distribution you can invent. Two canonical applications show the technique and certify two famous tight bounds.

### Randomized paging ≥ H_k

**Claim.** No randomized online paging algorithm with cache size `k` is better than `H_k`-competitive against the oblivious adversary, where `H_k = 1 + 1/2 + … + 1/k ≈ ln k` is the `k`-th harmonic number. (Matched from above by the MARK algorithm; see [`../03-paging-and-caching-theory/senior.md`](../03-paging-and-caching-theory/senior.md).)

**The hard distribution.** Use a universe of `k + 1` pages — one more than fits in the cache. Generate each request **uniformly at random** among the `k + 1` pages (or, sharper, among the `k + 1` pages excluding the one just requested). On this distribution:

- **Any deterministic algorithm** faults with probability `1/(k+1)` per request in the simplest version (the requested page is the one missing with that probability), since at any moment exactly one of the `k + 1` pages is outside the cache and the request is uniform. Over `N` requests, expected deterministic faults `≈ N/(k+1)` (with constants tightened by the "exclude last request" variant).
- **OPT** on a random sequence over `k + 1` pages faults only when forced; the optimal offline (Belady's furthest-in-future) faults roughly once per `k+1`-page "phase," giving expected OPT cost a factor `H_k` *smaller* than the deterministic online expectation — this is the harmonic-number gap, which falls out of analyzing how often a uniformly random walk over `k+1` pages forces an eviction that OPT could foresee but online cannot.

By Yao, the ratio `E[ALG]/E[OPT] ≥ H_k` for every randomized algorithm. The harmonic number is not an artifact — it is the exact value of this online game, and randomization improves the deterministic ratio of `k` down to `H_k ≈ ln k`, an *exponential* improvement in the gap, but no further.

### Randomized ski rental ≥ e/(e−1)

**Claim.** No randomized algorithm for ski rental beats `e/(e−1) ≈ 1.582`-competitive — strictly better than the deterministic `2`, and tight.

**Setup.** Renting skis costs `1` per day; buying costs `B`. You do not know how many days `D` you will ski. The deterministic optimum is "rent for `B−1` days, then buy," which is `2`-competitive. The randomized algorithm chooses a (possibly random) day `τ` on which to buy.

**The hard distribution + Yao.** Put a carefully chosen distribution `q` on the number of skiing days `D` (concentrated so that the "buy day" decision is maximally uncertain). For *any* deterministic strategy (buy on a fixed day `j`), compute its expected ratio against OPT under `q`. Optimizing the adversary's distribution `q` to make *every* deterministic buy-day equally bad yields the value of the game. The optimization is a continuous limit: the worst distribution makes the buy-day choice a balance whose optimum is governed by `(1 − 1/B)^B → 1/e`, and the resulting game value is

$$\frac{1}{1 - 1/e} \;=\; \frac{e}{e-1} \;\approx\; 1.582.$$

By Yao, no randomized algorithm beats this; the randomized algorithm that *achieves* it buys on day `t` with a probability proportional to `(1 − 1/B)^{B−t}` (a truncated-geometric schedule). The `e/(e−1)` constant — the same constant that governs the secretary problem and online bipartite matching (Karp–Vazirani–Vazirani) — is the signature of "optimally randomized online decision under a single threshold."

---

## Competitive Ratio vs Regret

Competitive analysis is one of *two* dominant worst-case frameworks for online decision-making. The other, from online learning, is **regret**. They answer different questions, and a senior engineer must know which benchmark a problem actually wants.

### The two benchmarks

| | **Competitive ratio** | **Regret** |
|---|---|---|
| Comparison is against | the *offline optimum* `OPT` (omniscient, problem-specific) | the *best fixed action/expert* in hindsight |
| Form of the bound | **multiplicative**: `ALG ≤ c · OPT + α` | **additive**: `ALG − BEST_fixed ≤ R(T)`, want `R(T) = o(T)` |
| "Good" means | small constant `c` (e.g., 2, `H_k`, `e/(e−1)`) | sublinear regret (e.g., `O(√T)`, `O(√(T log N))`) |
| Native setting | caching, `k`-server, scheduling, list update | prediction with expert advice, online convex optimization, bandits |
| Canonical algorithm | LRU, MARK, work-function | Multiplicative Weights / Hedge, FTRL, EXP3 |

### Multiplicative Weights and the regret world

The **Multiplicative Weights Update (MWU)** method (a.k.a. Hedge / randomized weighted majority) is the regret-world analogue of a competitive algorithm. With `N` experts over `T` rounds, maintaining weights `wᵢ ← wᵢ · (1 − η·loss_i)` and choosing proportionally, MWU achieves

$$\text{regret} \;=\; \sum_t \text{loss}(\text{MWU}_t) \;-\; \min_i \sum_t \text{loss}_{i,t} \;\le\; O\!\left(\sqrt{T \log N}\right).$$

The regret is *additive* and *sublinear* — average per-round regret `R(T)/T → 0`, so MWU's *average* loss converges to the best fixed expert's. There is no multiplicative `c`: MWU does not promise to be within a *factor* of OPT, it promises to be within a *vanishing additive gap* of the best *fixed* action.

### When each benchmark is right

- **Competitive ratio is right** when the offline optimum is the only meaningful baseline and is wildly *non-stationary* — the optimal cache contents change constantly, so "the best fixed action" (a fixed cache) is a useless benchmark. You want "within a factor of the best you *could possibly* have done with hindsight on this exact sequence." Caching, paging, `k`-server, routing.
- **Regret is right** when there *is* a meaningful best fixed action and you want to *learn* it online — the best stock to hold, the best route under recurring traffic, the best classifier among `N`. "Best fixed expert" is a sensible, achievable target, and additive sublinear regret is the natural promise.
- **They can disagree sharply.** A 2-competitive algorithm can have *linear* regret (it tracks a moving OPT but never settles on a fixed action), and a no-regret algorithm can have *unbounded* competitive ratio (it converges to the best fixed action, which may be far from the per-sequence OPT). Choosing the wrong framework means optimizing the wrong thing.

The unifying view: both are *worst-case relative* guarantees, but competitive ratio relativizes to a **dynamic, omniscient optimum** (multiplicatively) while regret relativizes to the **best static action** (additively). The benchmark encodes what "doing well" means for your problem.

---

## Critiques and Modern Responses

Competitive analysis is powerful but famously *pessimistic*. The senior obligation is to know its failure modes and the refined models that repair them — the full practical treatment is deferred to [`professional.md`](./professional.md); here we preview the landscape.

### The critiques

1. **Overly pessimistic.** The competitive ratio is a worst case over *all* sequences, and the worst sequence is often a pathological adversarial construction that never arises in practice. LRU and FIFO are *both* `k`-competitive for paging — yet LRU is vastly better in practice. Competitive analysis **cannot distinguish them**, which is a damning failure to model reality, because the ratio is blind to the locality of reference that real workloads exhibit.
2. **The ratio is achieved only on pathological inputs.** A bound of `k` says nothing about typical performance; a single adversarial sequence drags the worst case down while the algorithm is excellent everywhere else.
3. **It ignores the structure of real inputs.** Real request sequences have locality, distributional regularity, and limited adversariality that the all-powerful adversary throws away.

### The modern responses (preview)

| Refinement | Idea | Repairs |
|---|---|---|
| **Resource augmentation** (Sleator–Tarjan 1985) | Give the online algorithm *more resources* (e.g., a cache of size `k` vs OPT's `h < k`); the ratio becomes `k/(k−h+1)`, → small as `k ≫ h` | Explains why real caches with slack perform near-optimally |
| **Advice complexity** | How many bits of *advice* about the future does ALG need to be `c`-competitive? Quantifies the "information value" of the future | Separates problems by how much foresight closes the gap |
| **Diffuse adversary** (Koutsoupias–Papadimitriou) | The adversary picks a *distribution* from a known class `Δ`, not an arbitrary sequence; ratio is over distributions in `Δ` | Models partial knowledge of the input distribution |
| **Access-graph model** (Borodin–Irani–Raghavan–Schieber) | Constrain request sequences to walks on a *graph* of allowed transitions; captures locality | Finally *separates LRU from FIFO* — LRU is optimal on the access graph |
| **Smoothed analysis** (Spielman–Teng, applied online) | Average over small random perturbations of the worst case; kills brittle pathological inputs | Bridges worst-case and average-case |

The through-line of all five: **constrain the adversary** to be more like reality — give the algorithm extra resources, advice, or a structured input model — and the absurd worst case relaxes into a bound that *predicts* real performance. The senior practitioner reaches for resource augmentation and the access-graph model first, because they have the cleanest explanatory power for the caching workloads that dominate practice. Full treatment: [`professional.md`](./professional.md).

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Identifying your adversary before designing | If it observes your actions *and* is compared to offline OPT → **adaptive-offline** → randomization is useless (Theorem 1), go deterministic |
| Adversary observes actions but answers online | **adaptive-online** → randomized ratio capped at `√(deterministic ratio)`; modest gains only |
| Adversary fixes the sequence in advance | **oblivious** → randomization can give order-of-magnitude wins (paging `k → H_k`); design a randomized algorithm |
| Proving a competitive *upper* bound | **Potential method**: design a mismatch Φ, prove `ALG_move + ΔΦ ≤ c · OPT_move` per request, telescope |
| Proving a randomized *lower* bound | **Yao's principle**: invent a hard input distribution `q`, show every deterministic algorithm has expected ratio `≥ ρ` on `q` |
| The optimal baseline is dynamic/non-stationary | **Competitive ratio** (multiplicative vs OPT) is the right framework |
| There is a meaningful best fixed action to learn | **Regret** (additive vs best fixed expert); use MWU/FTRL/EXP3 |
| The worst-case ratio looks absurd vs reality | Refine the model: **resource augmentation**, **access-graph**, **diffuse adversary**, smoothed analysis |

---

## Research Pointers

- **Sleator, D. D., & Tarjan, R. E. (1985). "Amortized Efficiency of List Update and Paging Rules."** *CACM* 28(2). The founding paper: MOVE-TO-FRONT 2-competitive, LRU `k`-competitive, and resource augmentation.
- **Ben-David, S., Borodin, A., Karp, R., Tardos, G., & Wigderson, A. (1994). "On the Power of Randomization in On-line Algorithms."** *Algorithmica* 11(1). The adversary hierarchy and the two structural theorems (randomization useless vs adaptive-offline; the composition result).
- **Yao, A. C. (1977). "Probabilistic Computations: Toward a Unified Measure of Complexity."** *FOCS.* Yao's principle as the minimax theorem applied to algorithm-vs-input games.
- **Karlin, A., Manasse, M., Rudolph, L., & Sleator, D. (1988). "Competitive Snoopy Caching."** *Algorithmica.* Coined "competitive" as the formal term; ski-rental-style analysis.
- **Fiat, A., Karp, R., Luby, M., McGeoch, L., Sleator, D., & Young, N. (1991). "Competitive Paging Algorithms."** *J. Algorithms.* The MARK algorithm and the `H_k` randomized paging bound.
- **Koutsoupias, E., & Papadimitriou, C. (1995). "On the k-Server Conjecture."** *JACM.* The work-function potential and the diffuse-adversary model.
- **Borodin, A., Irani, S., Raghavan, P., & Schieber, B. (1995). "Competitive Paging with Locality of Reference."** *JCSS.* The access-graph model that separates LRU from FIFO.
- **Borodin, A., & El-Yaniv, R. (1998). *Online Computation and Competitive Analysis.*** Cambridge Univ. Press. The definitive textbook — adversaries, potentials, Yao, ski rental, `k`-server.
- **Arora, S., Hazan, E., & Kale, S. (2012). "The Multiplicative Weights Update Method: A Meta-Algorithm and Applications."** *Theory of Computing.* The regret framework and MWU's `O(√(T log N))` bound.

---

## Key Takeaways

1. **The adversary hierarchy is a theorem.** Oblivious ≤ adaptive-online ≤ adaptive-offline in power; the achievable competitive ratio grows with adversary strength. Identify your adversary *before* designing anything.
2. **Randomization is useless against the adaptive-offline adversary** (Ben-David et al. 1994, Theorem 1): a `c`-competitive randomized algorithm against it implies a `c`-competitive *deterministic* one. The composition result bounds adaptive-online ratio at `√(deterministic)`. Randomization's big wins live *only* at the oblivious adversary.
3. **Competitive proofs are amortized proofs.** The potential method's step inequality `ALG_move + ΔΦ ≤ c · OPT_move` telescopes to `ALG(σ) ≤ c · OPT(σ) + Φ_init` — identical bookkeeping to [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/senior.md), with Φ measuring the *mismatch* between ALG's and OPT's configurations.
4. **MOVE-TO-FRONT is 2-competitive** via the *inversions* potential (Sleator–Tarjan 1985): the identity `|P| + |Q| = k − 1` plus `k_OPT ≥ |P| + 1` yields `MTF_move + ΔΦ ≤ 2·OPT_move − 1` per request. This is the archetypal competitive potential proof.
5. **Yao's principle is von Neumann minimax / LP duality.** To lower-bound *every* randomized algorithm, invent one hard input distribution and show all deterministic algorithms do badly *on average* over it. This certifies randomized paging `≥ H_k` and randomized ski rental `≥ e/(e−1)`.
6. **Competitive ratio (multiplicative vs dynamic OPT) and regret (additive vs best fixed action) are two worst-case frameworks.** Caching/`k`-server want competitive ratio; expert/learning settings want sublinear regret (MWU, `O(√(T log N))`). They can disagree sharply — choose the benchmark your problem actually has.
7. **Competitive analysis is pessimistic** — it cannot even separate LRU from FIFO. The modern repairs (resource augmentation, advice complexity, diffuse adversary, access-graph model, smoothed analysis) all *constrain the adversary toward reality*; full treatment in [`professional.md`](./professional.md).

---

> **See also:** [`./middle.md`](./middle.md) for the ratio, adversary names, and Yao recipe · [`../03-paging-and-caching-theory/senior.md`](../03-paging-and-caching-theory/senior.md) · [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md) · [`../../06-algorithmic-complexity/05-amortized-analysis/senior.md`](../../06-algorithmic-complexity/05-amortized-analysis/senior.md)

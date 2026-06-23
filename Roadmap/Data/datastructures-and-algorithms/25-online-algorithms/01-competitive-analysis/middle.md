# Competitive Analysis — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Formal Definitions](#formal-definitions)
   - [c-Competitive](#c-competitive)
   - [Strict vs Asymptotic Competitiveness](#strict-vs-asymptotic-competitiveness)
   - [The Competitive Ratio as a Supremum](#the-competitive-ratio-as-a-supremum)
   - [Cost-Minimization vs Profit-Maximization](#cost-minimization-vs-profit-maximization)
3. [The Offline Optimum as Benchmark](#the-offline-optimum-as-benchmark)
4. [Adversary Models](#adversary-models)
   - [The Oblivious Adversary](#the-oblivious-adversary)
   - [The Adaptive-Online Adversary](#the-adaptive-online-adversary)
   - [The Adaptive-Offline Adversary](#the-adaptive-offline-adversary)
   - [Why the Three Coincide for Deterministic Algorithms](#why-the-three-coincide-for-deterministic-algorithms)
5. [Deterministic Lower Bounds via the Adversary](#deterministic-lower-bounds-via-the-adversary)
   - [No Deterministic Ski-Rental Beats 2-Competitive](#no-deterministic-ski-rental-beats-2-competitive)
   - [Deterministic Paging Is At Least k-Competitive](#deterministic-paging-is-at-least-k-competitive)
6. [Randomized Online Algorithms](#randomized-online-algorithms)
   - [Competitive Ratio in Expectation](#competitive-ratio-in-expectation)
   - [Randomized Ski-Rental: e/(e−1) ≈ 1.58](#randomized-ski-rental-ee1--158)
   - [Why Randomization Helps Against the Oblivious Adversary](#why-randomization-helps-against-the-oblivious-adversary)
7. [Yao's Minimax Principle](#yaos-minimax-principle)
   - [The Principle, Precisely](#the-principle-precisely)
   - [Applying It to Ski-Rental](#applying-it-to-ski-rental)
8. [The Connection to Amortized Analysis](#the-connection-to-amortized-analysis)
9. [Code: Simulating Competitive Ratios](#code-simulating-competitive-ratios)
10. [Pitfalls](#pitfalls)
11. [Summary](#summary)

---

## Introduction

> Focus: turn the junior intuition into a framework you could defend in a proof — definitions with quantifiers, the adversary made into a precise opponent, and the two lower-bound techniques (deterministic adversary arguments and Yao's principle) that the field actually uses.

At the [junior level](./junior.md) you met the picture: an **online** algorithm must commit to each decision before seeing the rest of the input, while the **offline optimum** sees everything; the **competitive ratio** measures how much you pay for that ignorance; the **adversary** constructs the worst input. You saw the ski-rental teaser — rent for a dollar a day or buy for `B` dollars once, and the "rent until you've spent `B`, then buy" rule never pays more than twice the optimum.

This file makes all of that rigorous. We pin the definition of *c*-competitive down to its quantifiers, separate **strict** from **asymptotic** competitiveness, and state the competitive ratio as a supremum over all inputs. The heart of the middle level is the **adversary models** — oblivious, adaptive-online, adaptive-offline — because the model is exactly what determines whether *randomization can help you at all*. We then prove two deterministic lower bounds from scratch, state the randomized ski-rental result, and present **Yao's minimax principle**, the standard tool for proving that *no* randomized algorithm can do better than some bound.

If you have not read the [junior level](./junior.md), do so first — this file continues from it without re-deriving the intuition. The concrete instances (ski-rental, paging) are developed in their own files: [ski-rental and rent-or-buy](../02-ski-rental-and-rent-or-buy/middle.md) and [paging and caching theory](../03-paging-and-caching-theory/middle.md). The [senior level](./senior.md) pushes into work-functions, the *k*-server problem, and lower bounds against adaptive adversaries.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `σ` | a **request sequence** (the input), `σ = ⟨σ₁, σ₂, …, σ_m⟩` |
| `ALG(σ)` | the **cost** the online algorithm `ALG` incurs on `σ` |
| `OPT(σ)` | the **cost** of the optimal *offline* algorithm on `σ` |
| `c` | the **competitive ratio** (a constant, independent of `σ`) |
| `α` | an **additive constant**, independent of `σ` |
| `E[·]` | expectation over the algorithm's internal random coins |

---

## Formal Definitions

### c-Competitive

We work first with **cost-minimization** problems (paging, ski-rental, *k*-server): smaller cost is better. Fix a deterministic online algorithm `ALG`.

> **Definition (c-competitive).** `ALG` is **c-competitive** if there is a constant `α` (independent of the input) such that for *every* request sequence `σ`,
>
> ```text
> ALG(σ)  ≤  c · OPT(σ)  +  α.
> ```

Read the quantifiers carefully. The constant `c` and the constant `α` are fixed *once*; the inequality must then hold for *all* `σ`, including the worst one the adversary can build. There is no averaging and no probability here (for a deterministic algorithm): competitive analysis is a **worst-case** guarantee.

The role of `α` is to absorb **start-up and boundary effects** — costs that an algorithm pays a bounded number of times regardless of how long the sequence runs. Because `α` does not grow with `|σ|`, it becomes negligible relative to `c · OPT(σ)` as the input gets long, which is exactly why it is allowed to be there.

### Strict vs Asymptotic Competitiveness

The presence or absence of `α` splits the definition into two flavors, and the distinction matters in proofs:

- **Strict competitiveness.** `ALG` is **strictly c-competitive** if `ALG(σ) ≤ c · OPT(σ)` for all `σ`, with `α = 0`. No slack is permitted, even on short sequences.
- **Asymptotic competitiveness.** `ALG` is **(asymptotically) c-competitive** if `ALG(σ) ≤ c · OPT(σ) + α` for some constant `α ≥ 0`. The bound need only hold *up to* the additive constant; equivalently, `limsup_{OPT(σ)→∞} ALG(σ)/OPT(σ) ≤ c`.

Strict competitiveness is the stronger statement: strictly *c*-competitive implies asymptotically *c*-competitive (take `α = 0`), but not conversely. When a result says "*ALG* is *c*-competitive" without qualification, it usually means the asymptotic version — the `α` is there to handle the finite warm-up. We will be explicit about which one each proof gives.

### The Competitive Ratio as a Supremum

The **competitive ratio** of `ALG` is the smallest `c` for which `ALG` is *c*-competitive. For the strict version this is cleanly a supremum:

```text
                       ALG(σ)
  ratio(ALG)  =   sup  -------         (strict version, OPT(σ) > 0)
                   σ   OPT(σ)
```

That `sup` over *all* sequences `σ` is the formal home of "the adversary picks the worst input." When the supremum is attained — when some finite `σ` achieves the ratio — the adversary has an explicit witness; when it is only approached in the limit, the additive `α` of the asymptotic definition is what lets us still call the algorithm *c*-competitive.

The **competitive ratio of the problem** is the best ratio any online algorithm can achieve:

```text
  ρ  =   inf    sup   ALG(σ) / OPT(σ).
        ALG      σ
```

A *lower bound* on `ρ` (the adversary's job) says "no online algorithm can do better than this." An *upper bound* on `ρ` (the algorithm designer's job) is a specific algorithm together with a proof of its ratio. When the two meet, the problem is **resolved**: ski-rental's deterministic ratio is exactly `2 − 1/B`, paging's is exactly `k`.

### Cost-Minimization vs Profit-Maximization

Most online problems minimize cost, but some maximize **profit** (online matching, ad allocation, secretary-style selection). The convention flips so that the ratio is always `≥ 1`:

| | Cost-minimization | Profit-maximization |
|---|---|---|
| Objective | `ALG(σ)` is a cost, smaller is better | `ALG(σ)` is a profit, larger is better |
| Definition | `ALG(σ) ≤ c · OPT(σ) + α` | `ALG(σ) ≥ (1/c) · OPT(σ) − α` |
| Competitive ratio | `c ≥ 1` | `c ≥ 1` |
| Adversary wants | `ALG` cost high, `OPT` cost low | `ALG` profit low, `OPT` profit high |

In both conventions `c ≥ 1`, and `c = 1` means "as good as the clairvoyant offline optimum." Mixing the two conventions is a classic source of inverted bounds; throughout this file we use the **cost-minimization** form unless we say otherwise.

---

## The Offline Optimum as Benchmark

Every definition above measures `ALG` against `OPT(σ)`, the cost of the **optimal offline algorithm**: an algorithm that receives the *entire* sequence `σ` in advance and serves it at minimum possible cost. `OPT` is **clairvoyant** — it knows the future — and it is unbeatable on its own input by construction.

Two things about this benchmark are worth making explicit, because they shape every proof:

1. **`OPT(σ)` is a lower bound on cost, by definition.** No algorithm — online or offline — can serve `σ` for less than `OPT(σ)`. So whenever we want to argue `ALG` is *expensive relative to optimum*, it suffices to upper-bound `OPT(σ)` (show the optimum could have been cheap) while `ALG(σ)` was forced to be large. The adversary lives in exactly this gap.

2. **Computing `OPT` may itself be hard or easy — it doesn't matter.** Competitive analysis never asks the online algorithm to compute `OPT`; `OPT(σ)` is a *yardstick*, not a subroutine. For paging the optimum offline policy is known and simple (**Belady's MIN**: evict the page whose next use is farthest in the future). For other problems `OPT` may be NP-hard to compute, yet the competitive ratio is still well-defined, because the ratio is a comparison of *costs*, not a demand to run `OPT`.

The reason we benchmark against the *offline* optimum rather than the *best online* algorithm is that the offline optimum isolates the cost of **not knowing the future** from every other consideration. The competitive ratio is, precisely, the price of clairvoyance.

---

## Adversary Models

The adversary is the formal device that produces "the worst input." For a **deterministic** algorithm, the worst input is unambiguous: the algorithm's behavior is a fixed function of the requests seen so far, so the adversary can simulate it and steer the sequence into the algorithm's blind spots. For a **randomized** algorithm, "the worst input" becomes subtle, because the adversary may or may not get to see the algorithm's coin flips. Three models capture the spectrum.

Throughout, distinguish two questions about an adversary:

- **How does it generate requests?** In advance (before any of `ALG`'s actions) or adaptively (each request may depend on `ALG`'s actions so far)?
- **How does it serve, to compute its own cost?** Offline-optimally on the whole sequence, or online alongside `ALG`?

### The Oblivious Adversary

The **oblivious adversary** must commit to the entire request sequence `σ` *in advance*, before `ALG` takes a single step. It knows `ALG`'s **code** and, for a randomized algorithm, its **probability distribution over actions** — but it does *not* see the outcomes of `ALG`'s coin flips. Having fixed `σ`, the adversary's own cost is `OPT(σ)`, the offline optimum for that fixed sequence.

A randomized algorithm `ALG` is **c-competitive against the oblivious adversary** if for every (adversary-chosen) sequence `σ`:

```text
  E[ALG(σ)]  ≤  c · OPT(σ)  +  α,
```

where the expectation is over `ALG`'s internal coins and `σ` is fixed independently of those coins. This is the **default model** for randomized online algorithms and the one in which randomization buys the largest improvements — because the adversary, unable to see the coins, cannot exploit them.

### The Adaptive-Online Adversary

The **adaptive-online adversary** generates requests *one at a time*, and each new request may depend on `ALG`'s actual past actions — including the outcomes of its coin flips revealed so far. Crucially, this adversary must also **serve each request online itself**, paying as it goes, with no benefit of hindsight. Its cost is therefore the cost of an *online* response to the sequence it is building.

This adversary is stronger than the oblivious one (it sees the coins) but weaker than the next one (it cannot serve offline-optimally). It is the right model when you imagine a real-time opponent reacting to your moves but bound by the same lack of foresight.

### The Adaptive-Offline Adversary

The **adaptive-offline adversary** also generates requests adaptively, reacting to `ALG`'s revealed actions and coin flips — but it serves the resulting sequence **offline-optimally**, paying `OPT(σ)` for the final sequence `σ`. This is the **strongest** adversary: it both sees everything `ALG` does and gets clairvoyant hindsight on the sequence it constructed.

The strength of this adversary is so great that it neutralizes randomization almost entirely. A foundational theorem (Ben-David, Borodin, Karp, Wigderson, Widgerson) states: **against the adaptive-offline adversary, randomization gives no asymptotic advantage** — if a randomized algorithm is *c*-competitive against the adaptive-offline adversary, then a *deterministic* algorithm is *c*-competitive too. Intuitively, an opponent who sees your coins *and* serves with hindsight reduces your randomness to noise.

### Why the Three Coincide for Deterministic Algorithms

For a **deterministic** `ALG`, all three adversary models give the **same competitive ratio**. The reason is short and worth internalizing:

A deterministic algorithm has *no coin flips*. Its entire behavior on `σ` is determined by `σ`. So an oblivious adversary, knowing `ALG`'s code, can mentally simulate `ALG` on any candidate prefix and predict exactly what `ALG` will do next — it loses *nothing* by committing in advance, because there is nothing hidden to wait for. Conversely, an adaptive adversary watching `ALG`'s moves learns nothing it could not have computed itself. The three models therefore see an identical opponent, and the ratios collapse to one number.

This collapse is the practical reason the adversary models only *matter* once randomization enters. For deterministic analysis you may freely picture "an adversary that watches your moves," because it is equivalent to "an adversary that wrote the whole input in advance."

```text
   oblivious   ≤   adaptive-online   ≤   adaptive-offline      (adversary strength)
       │                                          │
       └──────── all three equal for ────────────┘
                 DETERMINISTIC algorithms
```

---

## Deterministic Lower Bounds via the Adversary

A lower bound is a proof that *no* online algorithm beats some ratio `c`. The technique for deterministic algorithms is a direct adversary argument: assume any deterministic `ALG`, let the adversary watch its decisions, and engineer a sequence on which `ALG` is forced to pay at least `c · OPT`.

### No Deterministic Ski-Rental Beats 2-Competitive

Recall the **ski-rental** problem: each day it snows you either **rent** skis for that day at cost `1`, or you may **buy** them once for cost `B`, after which all future days are free. You learn whether it snows tomorrow only when tomorrow arrives; the season ends on an unknown day. (Full treatment: [ski-rental and rent-or-buy](../02-ski-rental-and-rent-or-buy/middle.md).)

A deterministic algorithm is fully described by **the day `d` on which it decides to buy** if it has not stopped renting yet — say it rents on days `1, 2, …, d−1` and buys on day `d` (with `d` possibly `∞`, meaning "never buy"). The adversary knows `d` because it knows `ALG`'s code. Here is the adversary's play:

> **The adversary stops the snow the day after you buy.** It makes it snow on exactly days `1` through `d` (so the algorithm rents `d−1` times, then buys on day `d`), and then the season ends. The buy on day `d` was wasted: not a single free day followed it.

Now compare costs. Assume `B ≥ 1` and the algorithm buys on some finite day `d ≤ B` (buying later than day `B` is dominated — by day `B+1` you have already paid `B` in rent, so you should have bought; and never buying loses unboundedly, so the worst case for `ALG` is some `d ≤ B`).

```text
  ALG cost  =  (d − 1) rentals  +  B for the buy   =  (d − 1) + B.

  OPT, knowing the season is exactly d days long, simply rents
  every day (since d ≤ B means renting d days costs d ≤ B):
       OPT cost  =  d.
```

Therefore the ratio on this sequence is

```text
  ALG(σ) / OPT(σ)  =  (d − 1 + B) / d.
```

The algorithm gets to choose `d` to *minimize* this; the adversary then forces the resulting value. The expression `(d − 1 + B)/d = 1 + (B − 1)/d` is *decreasing* in `d`, so the algorithm wants `d` as large as possible — but the dominance argument caps it at `d = B`. Substituting `d = B`:

```text
  ratio  =  (B − 1 + B) / B  =  (2B − 1) / B  =  2 − 1/B.
```

> **Conclusion.** Every deterministic ski-rental algorithm has competitive ratio at least `2 − 1/B`. As `B → ∞` this tends to `2`, and **no deterministic algorithm can beat 2-competitive**. The "rent until you've spent `B`, then buy" rule (`d = B`) *achieves* `2 − 1/B`, so this bound is tight: the deterministic competitive ratio of ski-rental is *exactly* `2 − 1/B`.

The structure of this proof is the template for all deterministic lower bounds: parametrize the algorithm's only real choice, let the adversary react to that choice, and optimize the ratio against the algorithm.

### Deterministic Paging Is At Least k-Competitive

**Paging**: a cache holds `k` pages; each request names a page. A request for a page already in the cache is free (a *hit*); a request for an absent page is a *fault* costing `1`, and forces an **eviction** of one of the `k` resident pages to make room. The online algorithm chooses *which* page to evict without knowing future requests. (Full treatment: [paging and caching theory](../03-paging-and-caching-theory/middle.md).)

> **Claim.** No deterministic paging algorithm is better than `k`-competitive.

**Sketch.** Restrict attention to a universe of exactly `k + 1` distinct pages, `{p₀, …, p_k}`. At any moment the cache holds `k` of them, so exactly **one** page is missing. The adversary, knowing `ALG`'s code and hence its cache contents, always requests **the one page `ALG` does not have**. Every single request is then a fault for `ALG`: over a sequence of `n` requests, `ALG(σ) = n`.

Now bound `OPT` on the *same* sequence. When the offline optimum faults, it evicts the page whose next request is **farthest in the future** (Belady's MIN). Among the `k` pages currently in `OPT`'s cache, the page just requested by the adversary is one of `k + 1` pages overall; the optimum can guarantee that after each fault, the page it evicts is not requested again for at least the next `k − 1` requests. Consequently `OPT` faults at most once every `k` requests:

```text
  ALG(σ)  =  n            (a fault on every request)
  OPT(σ)  ≤  n / k        (at most one fault per k requests)
  =>  ALG(σ) / OPT(σ)  ≥  k.
```

So the deterministic competitive ratio of paging is at least `k`, and the classic policies **LRU** and **FIFO** both achieve exactly `k` — the bound is tight. Notice that the adversary here is again just "watch the algorithm and request what hurts it," which for a deterministic algorithm is equivalent to writing the sequence in advance. The randomized story is very different: the **MARKER** algorithm is `2H_k`-competitive (where `H_k ≈ ln k` is the *k*-th harmonic number), an exponential improvement in the ratio — and that improvement is *only* available against the oblivious adversary.

---

## Randomized Online Algorithms

The paging result is the first hint of the central theme: **randomization can dramatically improve the competitive ratio, but only against the right adversary.** We make the randomized definition precise and state the randomized ski-rental result.

### Competitive Ratio in Expectation

A **randomized online algorithm** flips coins to make its decisions; its cost `ALG(σ)` is now a *random variable*. The competitive guarantee is stated **in expectation against the oblivious adversary**:

> **Definition.** A randomized `ALG` is **c-competitive (against the oblivious adversary)** if there is a constant `α` such that for every sequence `σ` fixed *in advance*,
>
> ```text
> E[ALG(σ)]  ≤  c · OPT(σ)  +  α,
> ```
> where the expectation is over `ALG`'s coins.

The order of quantifiers is essential. The adversary fixes `σ` *first*, without seeing the coins; only *then* does `ALG` flip its coins and incur a random cost; the bound constrains the *expected* cost. Because `σ` is chosen before the coins, the adversary cannot tailor the sequence to a particular coin outcome — it must contend with the whole distribution. This is precisely what gives randomization its power.

### Randomized Ski-Rental: e/(e−1) ≈ 1.58

For ski-rental, the deterministic ratio is stuck at `2 − 1/B ≈ 2`. Randomization breaks through it.

> **Theorem.** There is a randomized ski-rental algorithm that is **e/(e−1)-competitive** against the oblivious adversary, where `e/(e−1) ≈ 1.582`. No randomized algorithm does better, so `e/(e−1)` is the exact randomized competitive ratio of ski-rental.

**The idea.** Instead of buying on a fixed day, the algorithm chooses its **buy day randomly** from a carefully shaped distribution over days `1, …, B`, weighted so that earlier days are *slightly* more likely in a geometric/exponential profile (in the continuous limit the buy time is drawn with density proportional to `e^{t/B}` on `[0, B]`). The adversary, forced to commit to a season length without knowing which day the algorithm will buy, can no longer time its "stop the snow right after you buy" trick — whatever season length it picks, only a *fraction* of the algorithm's coin outcomes get caught buying-then-stopping, and the rest do fine. Averaging over the distribution, the expected cost is at most `e/(e−1) · OPT` for *every* season length the oblivious adversary might choose.

The number `e/(e−1)` is not arbitrary: it falls out of balancing the probability mass so that the expected ratio is *equalized* across all the adversary's choices of stopping day. (The full derivation — setting up the distribution and computing the expectation — is in [ski-rental and rent-or-buy](../02-ski-rental-and-rent-or-buy/middle.md).)

```text
  Ski-rental competitive ratio:

     deterministic        2 − 1/B   →   2        (tight: rent-then-buy)
     randomized (obliv.)  e/(e−1)   ≈   1.582    (tight)
```

### Why Randomization Helps Against the Oblivious Adversary

The mechanism is the same in ski-rental, paging, and across the field:

- A **deterministic** algorithm has a single, predictable response to each input. The adversary, knowing that response, aims the input straight at the algorithm's one weak decision and forces the full worst-case ratio every time.
- A **randomized** algorithm presents the oblivious adversary with a *distribution* of responses. Because the adversary must commit to the input *before* the coins are flipped, it cannot aim at one specific decision — it must choose an input that is bad *on average* over the whole distribution. Spreading the algorithm's behavior across many possible decisions means no single input catches all of them, so the worst *expected* ratio is strictly smaller than the worst *deterministic* ratio.

This advantage **evaporates** when the adversary can see the coins. Against the **adaptive-offline** adversary, randomization buys nothing asymptotically (the theorem cited earlier): once the opponent sees your coin outcomes *and* serves with hindsight, your randomness is exposed and neutralized. So the headline numbers — `e/(e−1)` for ski-rental, `2H_k` for paging — are oblivious-adversary results, and quoting them without naming the model is a mistake.

---

## Yao's Minimax Principle

Stating an *upper bound* for a randomized algorithm means exhibiting an algorithm and analyzing its expected cost. Proving a *lower bound* — that *no* randomized algorithm beats `c` — looks harder, because you must quantify over *all* randomized algorithms, an infinite space of coin-flipping strategies. **Yao's minimax principle** reduces this to a finite, concrete task: design one bad input *distribution* and analyze only *deterministic* algorithms against it.

### The Principle, Precisely

Yao's principle is an application of von Neumann's minimax theorem to the "game" between algorithm and adversary. In the form used for online lower bounds:

> **Yao's Minimax Principle.** Let `D` be any probability distribution over input sequences `σ`. Then the competitive ratio of the *best randomized* online algorithm against the *oblivious* adversary is at least the *expected* competitive ratio of the *best deterministic* algorithm on inputs drawn from `D`:
>
> ```text
>      ratio of best randomized ALG
>           (oblivious adversary)
>                  ≥
>      min   E_{σ ~ D} [ ALG_det(σ) / OPT(σ) ]
>     ALG_det
> ```
> — and this holds for *every* distribution `D` you choose.

In words: a randomized algorithm is, by Yao's view, a probability distribution over deterministic algorithms. The expected cost of "random algorithm on fixed worst-case input" cannot be better than the cost of "best fixed deterministic algorithm on random input." So to lower-bound *every* randomized algorithm, you:

1. **Construct a distribution `D` over inputs** that is hard "on average."
2. **Show that no deterministic algorithm does well in expectation** under `D` — i.e., compute `min over deterministic ALG of E_{σ~D}[ALG(σ)/OPT(σ)]` (or bound `E[ALG(σ)]` and `E[OPT(σ)]` separately and divide).
3. Conclude the same number lower-bounds *all randomized* algorithms.

The power is that step 2 only ever reasons about *deterministic* algorithms — finitely describable, easy to analyze — yet the conclusion binds the entire randomized class. You get to *choose* `D`; a cleverer `D` gives a stronger lower bound, and the best possible `D` yields a tight bound.

### Applying It to Ski-Rental

We use Yao's principle to show the randomized ski-rental ratio cannot beat (roughly) the `e/(e−1)` barrier — here we illustrate the *method* with a clean version.

**Step 1 — choose `D`.** Let the input be "it snows for exactly `j` days, then the season ends," and put a probability distribution over the season length `j ∈ {1, …, B}`. Choose the distribution geometrically/exponentially weighted (mass on day `j` proportional to `(1 − 1/B)^{−j}`, the discrete analogue of density `∝ e^{j/B}`), so that no deterministic buy-day is favored.

**Step 2 — every deterministic algorithm is bad in expectation under `D`.** A deterministic algorithm is again "buy on day `d`." On a random season length `J ~ D`:

```text
  If J < d:   ALG pays J        (renting J days, never reached its buy day)
              OPT pays J        → ratio 1 on this outcome.

  If J ≥ d:   ALG pays (d − 1) + B   (rented, then bought; B may be wasted)
              OPT pays min(J, B) = B if J ≥ B else J.
```

Taking the expectation `E_{J~D}[ALG(J)] / E_{J~D}[OPT(J)]` with the chosen weights, the geometric profile makes this expected ratio the *same* for every choice of `d` — that equalization is exactly why `D` was chosen that way — and the common value works out to approach `e/(e−1)` in the continuous `B → ∞` limit.

**Step 3 — conclude.** Since *no* deterministic algorithm beats `≈ e/(e−1)` in expectation under `D`, Yao's principle says *no randomized algorithm* beats `e/(e−1)` against the oblivious adversary. Combined with the matching upper bound (the randomized algorithm of the previous section), the randomized competitive ratio of ski-rental is **exactly `e/(e−1)`**.

This is the canonical shape of a randomized lower-bound proof, and you will see the identical three-step pattern used for paging (`H_k` lower bound), the *k*-server problem, and metrical task systems at the [senior level](./senior.md).

---

## The Connection to Amortized Analysis

Competitive proofs and **amortized analysis** are close cousins, and the bridge is the **potential function**. Recall from [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/middle.md) the potential method: define a non-negative function `Φ` of the data-structure state, and bound a *real* per-step cost by an *amortized* cost plus the change in `Φ`. Competitive proofs reuse exactly this device.

The standard way to prove `ALG(σ) ≤ c · OPT(σ) + α` is a **potential argument** that runs `ALG` and `OPT` in lockstep. Define a potential `Φ` that measures, roughly, "how far apart the configurations of `ALG` and `OPT` are." Then prove a *per-request* inequality:

```text
  ALG_cost(request_i)  +  Φ_after  −  Φ_before   ≤   c · OPT_cost(request_i).
```

Here `ΔΦ = Φ_after − Φ_before` plays the same banking role as in amortized analysis: on requests where `ALG` is cheap, `Φ` rises (banks credit measuring growing disagreement with `OPT`); on requests where `ALG` is expensive, `Φ` falls (spends that credit). Summing the per-request inequality over all `m` requests **telescopes** the `Φ` terms:

```text
  Σ ALG_cost(i)  +  Φ_final  −  Φ_initial   ≤   c · Σ OPT_cost(i)
  =>  ALG(σ)   ≤   c · OPT(σ)  +  (Φ_initial − Φ_final).
```

If `Φ ≥ 0` always and `Φ_initial` is a constant, the leftover `Φ_initial − Φ_final ≤ Φ_initial` is exactly the additive constant `α`. The non-negativity of `Φ` is what guarantees the bound is real — the identical requirement as in the amortized-analysis potential method. This is no accident: a competitive bound *is* an amortized bound where the "expensive operations" are the online algorithm's mistakes and the benchmark is `OPT` rather than a per-operation target. The accounting (banker's) method has an analogous reading. If the potential method feels familiar here, it is because you have already done this proof — for splay trees and dynamic arrays — over in [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/middle.md).

---

## Code: Simulating Competitive Ratios

The theory predicts: deterministic ski-rental converges to ratio `2 − 1/B` under an adversarial sequence, while randomized ski-rental beats it in expectation. The simulation below *measures* both empirically. For each algorithm we sweep all possible season lengths `1 ≤ j ≤ 2B` (the adversary's choices), compute `ALG` cost and `OPT` cost, and report the **worst** ratio for the deterministic algorithm and the **worst expected** ratio for the randomized one.

The randomized algorithm draws its buy-day from the (discretized) optimal distribution: day `i` is chosen with weight proportional to `(B/(B−1))^i`, the discrete analogue of the `e^{t/B}` profile.

### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

// optCost is the offline optimum for a season of j snowy days:
// rent every day if that is cheaper than buying, else buy on day 1.
func optCost(j, B int) int {
	if j < B {
		return j // renting j days is cheaper than buying B
	}
	return B // buy immediately
}

// detCost: deterministic "rent until you've spent B, then buy on day B".
func detCost(j, B int) int {
	if j < B {
		return j // season ended before we bought; we only rented
	}
	return (B - 1) + B // rented B-1 days, bought on day B
}

// randBuyDay samples a buy-day in [1, B] from the optimal exponential profile.
func randBuyDay(B int, rng *rand.Rand) int {
	weights := make([]float64, B+1) // weights[1..B]
	total := 0.0
	ratio := float64(B) / float64(B-1)
	for i := 1; i <= B; i++ {
		weights[i] = math.Pow(ratio, float64(i))
		total += weights[i]
	}
	r := rng.Float64() * total
	acc := 0.0
	for i := 1; i <= B; i++ {
		acc += weights[i]
		if r <= acc {
			return i
		}
	}
	return B
}

// randCost: cost of the randomized algorithm when it buys on day d.
func randCost(j, d, B int) int {
	if j < d {
		return j // season ended before the buy day
	}
	return (d - 1) + B // rented d-1 days, then bought
}

func main() {
	const B = 100
	const trials = 200000
	rng := rand.New(rand.NewSource(42))

	// Deterministic: worst ratio over all adversary season lengths.
	worstDet := 0.0
	for j := 1; j <= 2*B; j++ {
		ratio := float64(detCost(j, B)) / float64(optCost(j, B))
		if ratio > worstDet {
			worstDet = ratio
		}
	}

	// Randomized: worst EXPECTED ratio (E[ALG]/OPT) over adversary choices.
	worstRand := 0.0
	for j := 1; j <= 2*B; j++ {
		sum := 0.0
		for t := 0; t < trials; t++ {
			d := randBuyDay(B, rng)
			sum += float64(randCost(j, d, B))
		}
		expAlg := sum / float64(trials)
		ratio := expAlg / float64(optCost(j, B))
		if ratio > worstRand {
			worstRand = ratio
		}
	}

	fmt.Printf("B = %d\n", B)
	fmt.Printf("deterministic worst ratio   : %.4f   (theory 2 - 1/B = %.4f)\n",
		worstDet, 2.0-1.0/float64(B))
	fmt.Printf("randomized   worst E-ratio   : %.4f   (theory e/(e-1) = %.4f)\n",
		worstRand, math.E/(math.E-1.0))
}
```

Expected output (numbers vary slightly with the seed and discretization):

```text
B = 100
deterministic worst ratio   : 1.9900   (theory 2 - 1/B = 1.9900)
randomized   worst E-ratio   : 1.59..   (theory e/(e-1) = 1.5820)
```

The deterministic ratio lands exactly on `2 − 1/B`; the randomized one hovers near `e/(e−1) ≈ 1.582`, comfortably below `2`. That gap is the empirical signature of randomization beating the oblivious adversary.

### Python

```python
import math
import random

def opt_cost(j: int, B: int) -> int:
    """Offline optimum for a season of j snowy days."""
    return j if j < B else B

def det_cost(j: int, B: int) -> int:
    """Deterministic: rent B-1 days, then buy on day B."""
    return j if j < B else (B - 1) + B

def make_rand_distribution(B: int):
    """Optimal exponential buy-day weights over days 1..B."""
    ratio = B / (B - 1)
    weights = [ratio ** i for i in range(1, B + 1)]  # day i -> weights[i-1]
    return weights

def sample_buy_day(weights, B: int) -> int:
    """Sample a buy-day in [1, B] proportional to weights."""
    return random.choices(range(1, B + 1), weights=weights, k=1)[0]

def rand_cost(j: int, d: int, B: int) -> int:
    """Randomized cost when the algorithm buys on day d."""
    return j if j < d else (d - 1) + B

def main():
    B = 100
    trials = 200_000
    random.seed(42)
    weights = make_rand_distribution(B)

    # Deterministic worst ratio over adversary season lengths.
    worst_det = max(
        det_cost(j, B) / opt_cost(j, B) for j in range(1, 2 * B + 1)
    )

    # Randomized worst expected ratio over adversary season lengths.
    worst_rand = 0.0
    for j in range(1, 2 * B + 1):
        total = sum(rand_cost(j, sample_buy_day(weights, B), B)
                    for _ in range(trials))
        exp_alg = total / trials
        worst_rand = max(worst_rand, exp_alg / opt_cost(j, B))

    print(f"B = {B}")
    print(f"deterministic worst ratio : {worst_det:.4f}   "
          f"(theory 2 - 1/B = {2 - 1/B:.4f})")
    print(f"randomized   worst E-ratio: {worst_rand:.4f}   "
          f"(theory e/(e-1) = {math.e / (math.e - 1):.4f})")

if __name__ == "__main__":
    main()
```

Both programs make the abstract bounds tangible: the deterministic curve is pinned at its worst case for *every* long season, while the randomized algorithm spreads its risk so that *no* season length forces the full ratio. If you instead let the deterministic algorithm be analyzed against a *random* season (Yao's setup), you would recover the same `e/(e−1)` lower bound — a worthwhile exercise.

---

## Pitfalls

- **The competitive ratio is worst-case, not average-case.** `ALG(σ) ≤ c · OPT(σ) + α` must hold for *every* `σ`, including pathological adversarial ones that never occur in your workload. An algorithm can be a poor `4`-competitive on paper yet excellent in practice (LRU's competitive ratio is `k`, but it is near-optimal on real reference streams). Competitive analysis is a *guarantee*, not a *prediction* — pair it with empirical evaluation before deploying.

- **The additive constant `α` is not free.** Quoting "`c`-competitive" while hiding a large `α` is misleading on short inputs: a `2`-competitive algorithm with `α = 10⁶` is useless until `OPT(σ)` exceeds millions. Always ask whether a bound is **strict** (`α = 0`) or merely **asymptotic**, and how big `α` is relative to your typical input scale.

- **The adversary model determines whether randomization helps — state it.** "Randomized paging is `2H_k`-competitive" is true *only against the oblivious adversary*. Against the adaptive-offline adversary, randomization gives *no* asymptotic improvement over the deterministic ratio `k`. Quoting a randomized ratio without naming the adversary is a silent error; the same algorithm has different ratios in different models.

- **Don't confuse `E[ALG(σ)]/OPT(σ)` with `E[ALG(σ)/OPT(σ)]`.** For randomized algorithms the competitive ratio is defined via `E[ALG(σ)] ≤ c · OPT(σ) + α` — expectation in the *numerator only*, with `σ` (hence `OPT(σ)`) fixed by the oblivious adversary before any coins are flipped. Reversing the quantifiers (letting the adversary react to the coins) silently switches you to a *stronger* adversary model and a *worse* ratio.

- **Yao's principle gives a lower bound, never an algorithm.** Constructing a hard distribution `D` proves "no randomized algorithm beats `c`." It does *not* produce a `c`-competitive algorithm — that is a separate, constructive task. A tight result needs *both* a Yao lower bound and a matching algorithmic upper bound.

- **`OPT` is the offline optimum, not "the best you could code."** Beginners sometimes benchmark against a strong online heuristic and call the ratio "competitive." The competitive ratio is defined against the *clairvoyant offline* optimum specifically; using any weaker benchmark inflates your apparent quality.

---

## Summary

- An online algorithm is **`c`-competitive** if `ALG(σ) ≤ c · OPT(σ) + α` for all `σ`; **strict** competitiveness sets `α = 0`, **asymptotic** allows a constant `α`. The competitive ratio is the `sup` over all `σ` of `ALG(σ)/OPT(σ)` — a worst-case guarantee with no averaging.
- The benchmark `OPT(σ)` is the **clairvoyant offline optimum**, a lower bound on cost by definition; the competitive ratio is precisely the **price of not knowing the future**.
- **Adversary models** govern randomized analysis: the **oblivious** adversary fixes `σ` in advance (knows the code, not the coins), the **adaptive-online** reacts to revealed actions but serves online, the **adaptive-offline** reacts *and* serves optimally. For **deterministic** algorithms all three coincide.
- **Deterministic lower bounds** come from direct adversary arguments: ski-rental cannot beat `2 − 1/B` (the adversary stops the snow the day after you buy), and paging cannot beat `k` (the adversary requests the one page you lack).
- **Randomization** improves ratios against the oblivious adversary — ski-rental drops to `e/(e−1) ≈ 1.58`, paging to `2H_k` — because the adversary must commit before seeing the coins. The advantage vanishes against the adaptive-offline adversary.
- **Yao's minimax principle** lower-bounds *every* randomized algorithm by exhibiting one hard input distribution and analyzing only *deterministic* algorithms against it.
- Competitive proofs are **amortized arguments**: a potential `Φ` measuring `ALG`–`OPT` disagreement banks and spends credit, telescoping to `ALG(σ) ≤ c · OPT(σ) + α` — see [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/middle.md).

Continue to the concrete instances in [ski-rental and rent-or-buy](../02-ski-rental-and-rent-or-buy/middle.md) and [paging and caching theory](../03-paging-and-caching-theory/middle.md), or step up to work-functions and the *k*-server problem at the [senior level](./senior.md).

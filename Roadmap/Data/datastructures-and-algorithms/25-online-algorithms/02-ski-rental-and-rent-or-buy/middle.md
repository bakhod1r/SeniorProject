# Ski Rental and Rent-or-Buy — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Problem, Stated Precisely](#the-problem-stated-precisely)
3. [The Deterministic Upper Bound](#the-deterministic-upper-bound)
   - [The Break-Even Rule](#the-break-even-rule)
   - [Proof: Break-Even Is (2 − 1/B)-Competitive](#proof-break-even-is-2--1b-competitive)
4. [The Deterministic Lower Bound](#the-deterministic-lower-bound)
   - [The Adversary's Move](#the-adversarys-move)
   - [Case Analysis Over the Buy-Day](#case-analysis-over-the-buy-day)
   - [Conclusion: Break-Even Is Optimal](#conclusion-break-even-is-optimal)
5. [Randomized Ski Rental](#randomized-ski-rental)
   - [Why Randomization Can Help](#why-randomization-can-help)
   - [The Continuous Derivation](#the-continuous-derivation)
   - [The Discrete Distribution](#the-discrete-distribution)
   - [The Matching Lower Bound](#the-matching-lower-bound)
6. [The Rent-or-Buy Generalization](#the-rent-or-buy-generalization)
   - [The Bahncard Problem](#the-bahncard-problem)
   - [Rent-or-Buy With Interest and Deadlines](#rent-or-buy-with-interest-and-deadlines)
7. [Code: Deterministic and Randomized Ski Rental](#code-deterministic-and-randomized-ski-rental)
   - [Go](#go)
   - [Python](#python)
8. [Pitfalls](#pitfalls)
9. [Summary](#summary)

---

## Introduction

> Focus: turn the break-even intuition into airtight proofs. We prove the upper bound, prove the matching lower bound (so break-even is *optimal* among deterministic algorithms), then introduce randomization — the optimal randomized algorithm and its `e/(e−1) ≈ 1.582` ratio — and finish with the rent-or-buy family that ski-rental is the simplest member of.

At the [junior level](./junior.md) you met ski-rental and the break-even rule: rent while it is cheap, buy once your accumulated rent would have paid for the skis. You saw — informally — that this rule never pays more than roughly twice the optimum. The [competitive-analysis](../01-competitive-analysis/middle.md) file gave you the framework: the competitive ratio is a `sup` over adversarial inputs, the benchmark is the clairvoyant offline optimum `OPT`, and randomization can only help against an **oblivious** adversary that fixes the input before seeing your coins.

This file makes ski-rental rigorous and then pushes past the deterministic barrier:

- We prove break-even is exactly **`(2 − 1/B)`-competitive** — both the upper bound (the rule never pays more) and the matching **lower bound** (no deterministic algorithm pays less), so break-even is **optimal deterministic**.
- We derive the **optimal randomized algorithm**, which picks its buy-day from an exponentially weighted distribution and achieves competitive ratio **`e/(e−1) ≈ 1.582`** against the oblivious adversary — strictly better than the deterministic `2`. We give the clean continuous derivation first, then connect it to the discrete distribution.
- We generalize to **rent-or-buy** problems — the **Bahncard** discount-card problem and its `2`-competitive break-even structure — of which ski-rental is the cleanest special case.

Read the [junior level](./junior.md) and [competitive-analysis](../01-competitive-analysis/middle.md) first; this file continues from both without re-deriving them. The [senior level](./senior.md) generalizes to the full rent-or-buy / online TCP-acknowledgement / multi-shop framework and the connection to the lambda-tuning method.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `B` | the **buy cost** (price of the skis), in units of one day's rent |
| `j` | the **season length** — the number of snowy days, chosen by the adversary |
| `d` | the **buy-day** — the day on which an algorithm chooses to buy |
| `ALG(j)` | the cost the online algorithm incurs on a `j`-day season |
| `OPT(j)` | the offline optimum on a `j`-day season |
| `e` | Euler's number, `≈ 2.71828`; `e/(e−1) ≈ 1.58198` |

Throughout we take `B` to be a positive integer and measure all costs in units where one day of rental costs exactly `1`.

---

## The Problem, Stated Precisely

Each snowy day you face a choice. If you have not yet bought skis you may either **rent** them for that day at cost `1`, or **buy** them once for cost `B`, after which every remaining day is free. You do not know whether it will snow tomorrow; the season ends on a day `j` revealed only when it arrives. The objective is to minimize total cost.

**The offline optimum.** A clairvoyant offline player knows `j` in advance and has exactly two pure strategies worth considering — rent every day (cost `j`) or buy on day 1 (cost `B`) — so

```text
  OPT(j)  =  min(j, B).
```

For `j < B`, renting all `j` days is cheaper, so `OPT(j) = j`. For `j ≥ B`, buying up front is at least as good, so `OPT(j) = B`. The optimum is a "ramp that flattens": it climbs linearly to `B` and then stays there forever. This is the yardstick every online strategy is measured against.

**The online algorithm.** Because the only irreversible decision is *when to buy*, a deterministic online algorithm is fully described by a single number: the day `d` on which it buys, assuming it has not run out of snowy days first. It rents on days `1, 2, …, d − 1` and buys on day `d` (allowing `d = ∞`, meaning "never buy"). If the season ends before day `d`, the algorithm simply rented for the whole season and never bought. So:

```text
  ALG_d(j)  =  j               if j < d   (season ended before the buy)
              (d − 1) + B      if j ≥ d   (rented d−1 days, then bought).
```

This single-parameter view is what makes ski-rental the cleanest non-trivial online problem: the algorithm's whole strategy is the choice of `d`, and the adversary's whole strategy is the choice of `j`. The rest of this file is the game between those two numbers.

---

## The Deterministic Upper Bound

### The Break-Even Rule

The **break-even** (or *better-late-than-never*) rule sets `d = B`:

> **Break-even.** Rent on days `1` through `B − 1`. If the season reaches day `B`, **buy** on day `B`.

The intuition from the junior level: keep renting while renting is provably no worse than the optimum could have been, and switch to buying at the exact moment your sunk rent equals the purchase price. By day `B` you have spent `B − 1` on rent; one more rental would tie the buy cost, so you buy instead and cap all future cost at the `B` you would have paid anyway. The claim we now prove is that this rule is `(2 − 1/B)`-competitive — never more than `2 − 1/B` times the optimum, on *every* season length.

### Proof: Break-Even Is (2 − 1/B)-Competitive

We must bound `ALG_B(j) / OPT(j)` for every `j ≥ 1`. Split on whether the season reaches the buy-day.

**Case 1: `j < B` (the season ends before day `B`).** The algorithm only ever rented, so `ALG_B(j) = j`, and `OPT(j) = min(j, B) = j` because `j < B`. The ratio is

```text
  ALG_B(j) / OPT(j)  =  j / j  =  1.
```

When the season is short, break-even is *optimal* — it does exactly what `OPT` does, renting the whole way. No loss occurs here.

**Case 2: `j ≥ B` (the season reaches the buy-day).** The algorithm rented `B − 1` days and then bought, so `ALG_B(j) = (B − 1) + B = 2B − 1`, a constant that does not grow with `j`. The optimum is `OPT(j) = min(j, B) = B` because `j ≥ B`. The ratio is

```text
  ALG_B(j) / OPT(j)  =  (2B − 1) / B  =  2 − 1/B.
```

This is the *worst* the ratio ever gets, and it is independent of how long the season runs past day `B` — once you have bought, extra snowy days are free for both you and `OPT`, so the ratio cannot climb further.

**Combining the cases.** For every `j`,

```text
  ALG_B(j) / OPT(j)  ≤  max( 1, 2 − 1/B )  =  2 − 1/B          (B ≥ 1).
```

> **Theorem (upper bound).** The break-even algorithm is **strictly `(2 − 1/B)`-competitive** for ski-rental: `ALG_B(j) ≤ (2 − 1/B) · OPT(j)` for all `j`, with additive constant `α = 0`.

A useful sanity check on the boundary cases:

```text
  B = 1   →  ratio 2 − 1/1 = 1     (skis cost one day's rent: just buy day 1; never lose)
  B = 2   →  ratio 2 − 1/2 = 1.5
  B → ∞   →  ratio → 2             (the classic "factor of 2" headline)
```

The ratio is strict — there is no additive slack — because the worst case is realized by a *finite* season (`j = B` exactly), not approached only in a limit. That finite witness is precisely what the lower bound will exploit.

---

## The Deterministic Lower Bound

The upper bound shows break-even *achieves* `2 − 1/B`. The lower bound shows nothing can do better: **every** deterministic algorithm has competitive ratio at least `2 − 1/B`. Together these pin the deterministic competitive ratio of ski-rental to *exactly* `2 − 1/B`, and identify break-even as optimal.

### The Adversary's Move

A deterministic algorithm is a fixed buy-day `d` (possibly `∞`). The adversary knows `ALG`'s code, hence knows `d` before the season begins. Its move is the same one that powers every deterministic online lower bound:

> **The adversary stops the snow the day after you buy.** It makes it snow on exactly days `1` through `d` — long enough to force the algorithm through its rentals and its purchase on day `d` — and then ends the season. Not a single free day follows the buy, so the purchase was entirely wasted.

This is the cruelest possible season for a player committed to buying on day `d`: it extracts the full buy cost `B` from the algorithm and then denies it any of the future savings that buying was supposed to secure.

### Case Analysis Over the Buy-Day

The algorithm chooses `d` to make its worst-case ratio as small as possible; the adversary then forces the worst season for that `d`. We enumerate the algorithm's options.

**Option A: `d = ∞` (never buy).** The adversary lets it snow forever. The algorithm rents every day, paying `j` and growing without bound, while `OPT(j) = B` for `j ≥ B`. The ratio `j / B → ∞`. Never buying is unboundedly bad, so the optimal `d` is finite.

**Option B: `d > B` (buy too late).** By the time the algorithm buys on day `d > B`, it has already paid `d − 1 ≥ B` in rent — more than the skis cost. The adversary stops the snow on day `d`. Then `ALG = (d − 1) + B > 2B − 1`, while `OPT(d) = min(d, B) = B`. The ratio is `(d − 1 + B)/B > 2 − 1/B`. Buying later than day `B` is strictly *worse* than buying on day `B`, so it is dominated.

**Option C: `1 ≤ d ≤ B` (the only competitive regime).** The adversary stops the snow on day `d`, giving a season of length exactly `j = d`. Then:

```text
  ALG_d(d)  =  (d − 1) + B          (rented d−1 days, bought on day d)
  OPT(d)    =  min(d, B)  =  d       (since d ≤ B, renting all d days is cheapest)

  ratio(d)  =  (d − 1 + B) / d  =  1 + (B − 1) / d.
```

The algorithm wants this ratio *small*, so it wants `d` *large* (the `(B − 1)/d` term shrinks as `d` grows). But Option B caps `d` at `B`: pushing past `B` re-enters the dominated regime. So the algorithm's best legal choice is `d = B`, and even that yields

```text
  ratio(B)  =  1 + (B − 1)/B  =  (2B − 1)/B  =  2 − 1/B.
```

For any smaller `d`, the ratio `1 + (B − 1)/d` is strictly *larger* than `2 − 1/B`. So no choice of `d` escapes the bound `2 − 1/B`.

### Conclusion: Break-Even Is Optimal

> **Theorem (lower bound).** Every deterministic ski-rental algorithm has competitive ratio at least `2 − 1/B`. Combined with the upper bound, the **deterministic competitive ratio of ski-rental is exactly `2 − 1/B`**, and the break-even rule (`d = B`) achieves it. Break-even is therefore an **optimal deterministic** algorithm.

It is worth pausing on the shape of this argument, because it is the universal template for deterministic online lower bounds (the [competitive-analysis](../01-competitive-analysis/middle.md) file uses the identical pattern for paging):

1. **Parametrize the algorithm's only real choice** — here, the buy-day `d`.
2. **Let the adversary react to that choice** — here, "stop the snow the day after you buy."
3. **Optimize the ratio against the algorithm** — minimize over `d`, and the minimum is still `2 − 1/B`.

Because the algorithm is deterministic, the oblivious, adaptive-online, and adaptive-offline adversaries coincide (see [competitive-analysis](../01-competitive-analysis/middle.md)): the adversary loses nothing by committing the season in advance, since it can simulate the algorithm to learn `d`. This is exactly why deterministic ski-rental is stuck at `2 − 1/B` — and why we must turn to randomization to do better.

---

## Randomized Ski Rental

### Why Randomization Can Help

The deterministic lower bound rests on one fact: the adversary knows `d`. A randomized algorithm denies it that knowledge. Instead of a fixed buy-day, the algorithm draws its buy-day `D` from a probability distribution. The **oblivious** adversary must still commit to the season length `j` *before* the coins are flipped (it knows the *distribution* but not its outcome), so it can no longer aim its "stop the snow on day `d + 1`" trick at a single decision. Whatever `j` it picks, only a *fraction* of the algorithm's coin outcomes get caught buying-and-then-stopping; the rest already bought cheaply or never reached the buy.

This is the whole reason randomization helps *here* and not against stronger adversaries. Against an adaptive-offline adversary that sees the coins, the distribution is exposed and the advantage evaporates — the [competitive-analysis](../01-competitive-analysis/middle.md) file's adversary-model discussion is the precise statement. So everything below is an **oblivious-adversary** result, and quoting `e/(e−1)` without that qualifier is an error.

We design the distribution so that the expected ratio `E[ALG(j)] / OPT(j)` is the *same* for every season length `j` the adversary might choose. Equalizing the adversary's payoff across all its options is the signature of an optimal randomized strategy: if some `j` were worse than others, the adversary would concentrate there, and a different distribution could do better. The continuous version makes this equalization transparent.

### The Continuous Derivation

Rescale so the buy cost is `1` and time is continuous on `[0, ∞)`: renting costs `1` per unit time, buying costs `1` at any instant, and the adversary picks a stopping time `z` (the rescaled season length). The algorithm picks a buy-time `x` from a density `p(x)` supported on `[0, 1]` — buying after time `1` is dominated for the same reason `d > B` was dominated above, so the support is `[0, 1]`.

Fix the algorithm's buy-time `x` and the adversary's stopping time `z`. The cost is

```text
  cost(x, z)  =  z          if z < x   (season ended before the buy)
                 x + 1      if z ≥ x   (rented x, then paid 1 to buy).
```

For a fixed adversary stopping time `z ∈ [0, 1]`, the algorithm's expected cost is

```text
  E[cost | z]  =  ∫₀^z (x + 1) p(x) dx  +  ∫_z^1 z · p(x) dx.
```

The first integral covers buy-times *before* `z` (the algorithm bought, paying `x + 1`); the second covers buy-times *after* `z` (the season ended first, paying `z`). The offline optimum at stopping time `z ≤ 1` is `OPT(z) = min(z, 1) = z`. We want a density `p` and a constant `c` with `E[cost | z] ≤ c · z` for every `z`, and to make `c` as small as possible we force *equality* for all `z` — this is the equalization principle in action:

```text
  ∫₀^z (x + 1) p(x) dx  +  z ∫_z^1 p(x) dx   =   c · z      for all z ∈ [0, 1].
```

Differentiate both sides with respect to `z`. Using the Leibniz rule, the derivative of the left side is

```text
  (z + 1) p(z)            (from the upper limit of the first integral)
  + ∫_z^1 p(x) dx         (from the z multiplying the second integral)
  − z · p(z)              (from the lower limit of the second integral)
  =  p(z)  +  ∫_z^1 p(x) dx.
```

So the equalization condition becomes the integro-differential equation

```text
  p(z)  +  ∫_z^1 p(x) dx   =   c.
```

Differentiate once more in `z`: the derivative of `∫_z^1 p(x) dx` is `−p(z)`, giving

```text
  p'(z)  −  p(z)  =  0       ⇒       p(z)  =  A e^{z}
```

for some constant `A`. The density is **exponential in the buy-time** — earlier-but-not-too-early buy-times carry rising weight. Two conditions pin down `A` and `c`.

**Normalization** (`p` is a probability density on `[0, 1]`):

```text
  ∫₀^1 A e^x dx  =  A (e − 1)  =  1     ⇒     A  =  1/(e − 1).
```

So the optimal continuous buy-time density is

```text
                e^x
  p(x)  =  ───────────        on [0, 1].
              e − 1
```

**The competitive ratio** comes from the equation `p(z) + ∫_z^1 p(x) dx = c`. Evaluate it at the convenient point `z = 1`, where the integral vanishes:

```text
  c  =  p(1)  =  A e^1  =  e/(e − 1).
```

> **Theorem (randomized upper bound).** Drawing the buy-time from density `p(x) = e^x/(e − 1)` on `[0, 1]` (scaled by `B` in the original units, so the buy-day is `B·x`) gives expected cost `E[ALG(j)] = (e/(e−1)) · OPT(j)` for **every** season length, hence competitive ratio `e/(e−1) ≈ 1.582` against the oblivious adversary.

The elegance is that equality holds for *all* `z`: the adversary is indifferent among every season length, which is exactly the fixed point of the algorithm-vs-adversary game.

### The Discrete Distribution

The continuous density `p(x) ∝ e^x` discretizes cleanly. With integer buy-cost `B`, let the algorithm buy on day `i ∈ {1, …, B}` with probability proportional to the discrete analogue of `e^{i/B}`. The standard exact form uses the weight

```text
                (1 + 1/(B − 1))^{i}            (equivalently  (B/(B−1))^i )
  Pr[buy on day i]  =  ───────────────────────────────       for i = 1, …, B,
                       Σ_{k=1}^{B} (B/(B−1))^k
```

a geometric profile with ratio `B/(B − 1)`. The factor `(1 + 1/(B−1))` is the discrete cousin of the continuous growth rate: as `B → ∞`, `(1 + 1/(B−1))^{i} = (1 + 1/(B−1))^{(B−1)·(i/(B−1))} → e^{i/B}` over the rescaled day `i/B`, recovering the `e^x` density. The normalizing denominator is the geometric-series analogue of the `e − 1` from the continuous normalization.

Plugging this distribution into the discrete cost expression and computing `E[ALG(j)]` for the worst adversary season `j` yields a competitive ratio of

```text
  1 / (1 − (1 − 1/B)^B)
```

which decreases toward `1/(1 − e^{-1}) = e/(e − 1) ≈ 1.582` as `B → ∞` (and is already within a hair of it for `B` in the dozens, since `(1 − 1/B)^B → e^{-1}` quickly). For finite `B` the discrete ratio is *slightly better* than `e/(e−1)` because the discreteness gives the algorithm a touch more structure; the `e/(e−1)` number is the clean limiting and lower-bound value, which is why it is the one quoted.

### The Matching Lower Bound

`e/(e−1)` is not just achievable — it is optimal. No randomized algorithm beats it against the oblivious adversary. The proof is **Yao's minimax principle** (developed in [competitive-analysis](../01-competitive-analysis/middle.md)): put a hard distribution `D` over season lengths — the exponentially weighted distribution that mirrors `p(x)` — and show that *every deterministic* buy-day `d` has expected ratio at least `e/(e−1)` under `D`. By Yao, that lower-bounds every randomized algorithm.

The mechanics, in the continuous picture, mirror the upper bound by symmetry. Put a density `q(z)` over the adversary's stopping time `z ∈ [0, 1]` (plus a point mass at `z = 1` to cover all longer seasons), and ask: what is the best a *deterministic* buy-time `x` can do in expectation against `q`? A fixed buy-time `x` pays

```text
  E_{z~q}[cost(x, z)]  =  ∫₀^x z · q(z) dz  +  (x + 1) ∫_x^1 q(z) dz,
```

while the optimum pays `E_{z~q}[min(z, 1)] = E_{z~q}[z]`. To make *every* deterministic `x` equally bad — so the algorithm has no good response and Yao's bound is tight — choose `q` so the ratio `E[cost(x,z)] / E[z]` is constant in `x`. Differentiating in `x` and solving the resulting equation gives `q(z) ∝ e^{-z}` (the time-reversed mirror of the algorithm's `e^{z}`), and the common ratio works out to exactly `e/(e − 1)`. Since no deterministic buy-time beats `e/(e−1)` under this `q`, Yao certifies that no randomized algorithm beats it either. The two bounds meet:

```text
  Ski-rental competitive ratio:

     deterministic        2 − 1/B   →   2         (tight: break-even)
     randomized (obliv.)  e/(e−1)   ≈   1.582     (tight: exponential buy-day)
```

The gap from `2` to `1.582` is the concrete payoff of randomization on the simplest possible online problem — a roughly 20% reduction in the worst-case price of not knowing the future, bought entirely with a coin.

---

## The Rent-or-Buy Generalization

Ski-rental is the simplest member of a family called **rent-or-buy** (or *leasing*) problems: you repeatedly pay a small recurring cost (rent) until you decide to pay a large one-time cost (buy) that eliminates the recurring payments. The break-even structure — and its factor-of-`2` deterministic ratio — recurs across the family.

### The Bahncard Problem

The German railway sells the *Bahncard*: a discount card costing `C` that, for a fixed validity period, gives a fraction `β ∈ (0, 1)` off every ticket. Without the card a journey of price `p` costs `p`; with a valid card it costs `(1 − β) p`. Travel requests arrive online — you learn each trip only when you take it — and you must decide *before each trip* whether to buy a card, not knowing your future travel. This is rent-or-buy with structure: "renting" is paying full fare, "buying" is the card, and the card's value depends on how much you travel during its validity.

The key reduction: a Bahncard pays for itself once your *discounted savings* would cover its cost — that is, once your full-fare spending within the validity window reaches `C/β` (because `β` times that spend equals `C`). Define the **break-even threshold** `C/β`. The optimal deterministic policy is, again, a break-even rule:

> **Bahncard break-even.** Track full-fare spending in a sliding validity window. Buy the card the moment cumulative full-fare spend within the window reaches `C/β`.

> **Result (Fleischer; Karlin et al.).** This break-even policy is **`2`-competitive** for the Bahncard problem, mirroring ski-rental's `2 − 1/B → 2`. With randomization, the Bahncard problem admits a `e/(e−1)`-competitive algorithm in the natural parameter regime — the *same* constant as ski-rental, because the underlying rent-or-buy trade-off is identical once rescaled.

Ski-rental is the degenerate Bahncard where `β = 1` (the card makes future travel free), the card cost is `C = B`, and the validity period is the whole season: the threshold `C/β` collapses to `B`, recovering the exact ski-rental break-even.

### Rent-or-Buy With Interest and Deadlines

Two further variants are worth naming, because they show where the clean `2` and `e/(e−1)` survive and where they bend:

- **Discounting / interest.** If money has time value — a dollar tomorrow is worth `γ < 1` dollars today — future rent is cheaper than present rent, which shifts the break-even point *later* (you are more willing to keep renting because future obligations are discounted). The competitive ratio is still a constant, but its value depends on the discount factor `γ`; as `γ → 1` (no discounting) it returns to the standard ski-rental constants. This is the setting closest to real capital-lease-versus-purchase decisions.

- **Deadline / finite horizon.** If the season is known to end by a fixed deadline `T` (even if the exact end within `[1, T]` is unknown), the algorithm can exploit the horizon: buying late near a deadline is pointless, so the optimal buy-day shifts and the ratio improves toward `1` as the horizon shrinks relative to `B`. The general rent-or-buy framework with deadlines connects to **online TCP acknowledgement** (batch acknowledgements to amortize a fixed per-ack cost against per-packet delay) — the same `e/(e−1)` randomized barrier reappears there, and the [senior level](./senior.md) develops that connection.

The unifying lesson: whenever an online decision pits a stream of small committed costs against one large irreversible cost, expect a deterministic ratio of `2` from a break-even rule and a randomized ratio of `e/(e−1)` from an exponentially weighted commitment time. Ski-rental is the Rosetta Stone for the whole family.

---

## Code: Deterministic and Randomized Ski Rental

The theory predicts two numbers we can measure directly. The deterministic break-even rule should hit worst-case ratio `2 − 1/B` exactly, realized at season length `j = B`. The randomized algorithm should keep its *worst expected* ratio near `e/(e−1) ≈ 1.582` across all season lengths. The programs below sweep every adversary season `1 ≤ j ≤ 2B`, compute costs against `OPT(j) = min(j, B)`, and report both worst cases — a Monte-Carlo estimate for the randomized one.

The randomized algorithm samples its buy-day from the geometric profile `(B/(B−1))^i`, the discrete analogue of the `e^x` density derived above.

### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

// optCost is the offline optimum for a season of j snowy days: min(j, B).
func optCost(j, B int) int {
	if j < B {
		return j
	}
	return B
}

// detCost: deterministic break-even — rent B-1 days, then buy on day B.
func detCost(j, B int) int {
	if j < B {
		return j // season ended before the buy day; we only rented
	}
	return (B - 1) + B // rented B-1 days, bought on day B  =>  2B-1
}

// buyDayWeights returns the geometric profile (B/(B-1))^i for days 1..B,
// the discrete analogue of the e^x continuous buy-time density.
func buyDayWeights(B int) ([]float64, float64) {
	weights := make([]float64, B+1) // weights[1..B]
	total := 0.0
	ratio := float64(B) / float64(B-1)
	for i := 1; i <= B; i++ {
		weights[i] = math.Pow(ratio, float64(i))
		total += weights[i]
	}
	return weights, total
}

// sampleBuyDay draws a buy-day in [1, B] proportional to the weights.
func sampleBuyDay(weights []float64, total float64, B int, rng *rand.Rand) int {
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
	weights, total := buyDayWeights(B)

	// Deterministic: worst ratio over all adversary season lengths.
	worstDet, argDet := 0.0, 0
	for j := 1; j <= 2*B; j++ {
		ratio := float64(detCost(j, B)) / float64(optCost(j, B))
		if ratio > worstDet {
			worstDet, argDet = ratio, j
		}
	}

	// Randomized: worst EXPECTED ratio (E[ALG]/OPT) over adversary choices.
	worstRand := 0.0
	for j := 1; j <= 2*B; j++ {
		sum := 0.0
		for t := 0; t < trials; t++ {
			d := sampleBuyDay(weights, total, B, rng)
			sum += float64(randCost(j, d, B))
		}
		ratio := (sum / float64(trials)) / float64(optCost(j, B))
		if ratio > worstRand {
			worstRand = ratio
		}
	}

	fmt.Printf("B = %d\n", B)
	fmt.Printf("deterministic worst ratio : %.4f  at j=%d  (theory 2 - 1/B = %.4f)\n",
		worstDet, argDet, 2.0-1.0/float64(B))
	fmt.Printf("randomized   worst E-ratio: %.4f          (theory e/(e-1) = %.4f)\n",
		worstRand, math.E/(math.E-1.0))
}
```

Expected output (the randomized line varies slightly with seed and discretization):

```text
B = 100
deterministic worst ratio : 1.9900  at j=100  (theory 2 - 1/B = 1.9900)
randomized   worst E-ratio: 1.58..          (theory e/(e-1) = 1.5820)
```

The deterministic worst case lands *exactly* on `2 − 1/B = 1.99`, and it occurs at `j = B = 100` — precisely the "stop the snow the day you buy" season from the lower-bound proof. The randomized worst expected ratio sits near `e/(e−1) ≈ 1.582`, comfortably below `2`: the empirical signature of randomization beating the oblivious adversary.

### Python

```python
import math
import random

def opt_cost(j: int, B: int) -> int:
    """Offline optimum for a season of j snowy days: min(j, B)."""
    return j if j < B else B

def det_cost(j: int, B: int) -> int:
    """Deterministic break-even: rent B-1 days, then buy on day B."""
    return j if j < B else (B - 1) + B  # 2B - 1 once we reach the buy day

def buy_day_weights(B: int):
    """Geometric profile (B/(B-1))^i for days 1..B (discrete e^x density)."""
    ratio = B / (B - 1)
    return [ratio ** i for i in range(1, B + 1)]  # day i -> weights[i-1]

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
    weights = buy_day_weights(B)

    # Deterministic worst ratio over adversary season lengths.
    worst_det, arg_det = 0.0, 0
    for j in range(1, 2 * B + 1):
        ratio = det_cost(j, B) / opt_cost(j, B)
        if ratio > worst_det:
            worst_det, arg_det = ratio, j

    # Randomized worst expected ratio over adversary season lengths.
    worst_rand = 0.0
    for j in range(1, 2 * B + 1):
        total = sum(rand_cost(j, sample_buy_day(weights, B), B)
                    for _ in range(trials))
        worst_rand = max(worst_rand, (total / trials) / opt_cost(j, B))

    print(f"B = {B}")
    print(f"deterministic worst ratio : {worst_det:.4f}  at j={arg_det}  "
          f"(theory 2 - 1/B = {2 - 1/B:.4f})")
    print(f"randomized   worst E-ratio: {worst_rand:.4f}          "
          f"(theory e/(e-1) = {math.e / (math.e - 1):.4f})")

if __name__ == "__main__":
    main()
```

Both programs make the proofs tangible. The deterministic curve is *pinned* at its worst case for the single adversarial season `j = B` and never exceeds `2 − 1/B`. The randomized algorithm spreads its buy-day across the exponential profile so that *no* season length forces the full ratio — the worst expected ratio equalizes near `e/(e−1)`, exactly as the continuous derivation predicted. A worthwhile exercise: feed the deterministic algorithm a *random* season drawn from the exponential distribution (Yao's setup) and watch the expected ratio of every fixed buy-day converge to the same `e/(e−1)` — the lower-bound side of the story.

---

## Pitfalls

- **The randomized distribution must be tuned to `B`.** The optimal density is `p(x) ∝ e^x` on `[0, 1]` *after rescaling by `B`*; the discrete weights are `(B/(B−1))^i`. Using a flat (uniform) buy-day distribution, or an exponential profile with the wrong rate, does *not* give `e/(e−1)` — it gives a strictly worse ratio. The whole point of the derivation was that *this specific* shape equalizes the adversary's payoff across all season lengths.

- **Randomization helps only against the oblivious adversary.** The `e/(e−1)` ratio assumes the adversary fixes the season length *before* seeing the coin flips. Against an adaptive-offline adversary that sees the buy-day as it is drawn, randomization buys nothing — the deterministic `2 − 1/B` is the best you can do. Always name the adversary model when quoting `e/(e−1)`; see [competitive-analysis](../01-competitive-analysis/middle.md).

- **Expectation is in the numerator, with `OPT` fixed.** The randomized competitive ratio is `E[ALG(j)] ≤ c · OPT(j)`, where `j` (hence `OPT(j)`) is fixed by the oblivious adversary *before* any coins. Do not confuse `E[ALG(j)]/OPT(j)` with `E[ALG(j)/OPT(j)]`, and do not let the adversary react to the realized buy-day — that silently switches you to a stronger adversary and a worse ratio.

- **`e/(e−1)` is a worst-case-in-expectation guarantee, not a typical outcome.** On any *single* run, the randomized algorithm might pay close to `2 · OPT` (if its coin lands on a buy-day the season immediately punishes) or as little as `OPT`. The `1.582` is the average over coins for the worst season; individual realizations vary widely. It is a *guarantee in expectation*, not a promise about one ski trip.

- **Break-even is optimal *deterministic*, but not optimal overall.** It is easy to over-claim that `2 − 1/B` is "the best possible." It is the best possible *deterministic* ratio; randomization beats it. Conversely, do not claim the randomized algorithm dominates break-even pointwise — break-even has zero variance and may be preferable when a hard worst-case bound on a *single* run matters more than the expected ratio.

- **`OPT(j) = min(j, B)`, not `B`.** A common slip is to benchmark against `B` for every season. For short seasons (`j < B`) the optimum *rents the whole way* and pays `j`, and break-even matches it exactly (ratio `1`). Benchmarking against the wrong `OPT` inflates the apparent competitive ratio on short seasons.

---

## Summary

- **Setup.** Rent at `1`/day or buy once for `B`; the season length `j` is adversarial. The offline optimum is `OPT(j) = min(j, B)`. A deterministic algorithm is a single buy-day `d`: it pays `j` if `j < d`, else `(d − 1) + B`.
- **Deterministic upper bound.** The **break-even** rule (`d = B`) is strictly **`(2 − 1/B)`-competitive**: ratio `1` when `j < B`, and `(2B − 1)/B = 2 − 1/B` when `j ≥ B`, with the worst case at `j = B`.
- **Deterministic lower bound.** The adversary stops the snow the day after you buy. Case analysis over `d` (never-buy is unbounded; `d > B` is dominated; `d ≤ B` gives ratio `1 + (B−1)/d ≥ 2 − 1/B`) shows **no deterministic algorithm beats `2 − 1/B`**. So break-even is **optimal deterministic** and the deterministic ratio is *exactly* `2 − 1/B`.
- **Randomized algorithm.** Drawing the buy-time from density `p(x) = e^x/(e − 1)` on `[0, 1]` (discrete weights `(B/(B−1))^i`) equalizes the expected ratio across all season lengths and achieves **`e/(e−1) ≈ 1.582`** against the *oblivious* adversary. Yao's principle gives the matching lower bound, so `e/(e−1)` is exact.
- **Why randomization wins.** The oblivious adversary must commit to `j` before the coins, so it cannot aim at one decision; the advantage **vanishes** against the adaptive-offline adversary.
- **Rent-or-buy family.** The **Bahncard** discount-card problem (card cost `C`, fraction `β` off, threshold `C/β`) is `2`-competitive by the same break-even structure, with `e/(e−1)` randomized; discounting and deadline variants keep constant ratios that bend toward `1` as the horizon shrinks. Ski-rental is the family's canonical special case (`β = 1`, `C = B`).

Continue to the [senior level](./senior.md) for the full rent-or-buy / online-TCP-acknowledgement framework and the lambda-tuning method, revisit the framework in [competitive-analysis](../01-competitive-analysis/middle.md), or see the same randomization-vs-oblivious-adversary story play out at scale in [paging and caching theory](../03-paging-and-caching-theory/middle.md).

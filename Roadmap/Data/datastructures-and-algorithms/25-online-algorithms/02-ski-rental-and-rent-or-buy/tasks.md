# Ski Rental and Rent-or-Buy — Practice Tasks

> Coding tasks are solved in **one** language (**Python**, with a short **Go** snippet where the port clarifies something). Where marked **[coding]**, implement the online algorithm, the **offline OPT**, replay the request sequence (including the adversary's worst case), and **measure the competitive ratio**.
> **[proof]** / **[analysis]** tasks need no code: prove a competitive ratio (deterministic case analysis, adversary argument, or a probabilistic derivation), or analyze a variant, with a clean and complete argument. Model derivations are provided so you can grade yourself.

**Ski rental** is the seed problem of competitive analysis. You ski for an unknown number of days `D`. Each day you either **rent** skis for `1` unit, or **buy** them once for `B` units and ski free forever after. You never see `D` in advance — the adversary stops the trip whenever it likes. The whole rent-or-buy family (spin-then-block locks, the Bahncard / discount-card problem, leasing, snoopy caching) shares this skeleton: a stream of *small recurring costs* you can end at any time by paying one *large one-time cost*, decided online.

The discipline for every coding task is the one from competitive analysis: **implement the online algorithm, implement the offline OPT `= min(D, B)`, replay sequences, and measure the ratio.** The acceptance test is always *"the measured competitive ratio respects the proven bound across every tested sequence."*

**Related practice:**
- [Competitive Analysis tasks](../01-competitive-analysis/tasks.md) — the framework (competitive ratio, adversary models, Yao's principle) these tasks instantiate; its beginner tasks introduce break-even ski rental.
- [Paging and Caching tasks](../03-paging-and-caching-theory/tasks.md) — the same online/offline/adversary discipline applied to caches, and the randomized `H_k` lower bound via Yao.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the constants you will keep meeting:
- **`2 − 1/B`** — the optimal *deterministic* competitive ratio, achieved by break-even (buy on day `B`), and unbeatable by any deterministic rule. Tends to `2` as `B → ∞`.
- **`e/(e − 1) ≈ 1.582`** — the optimal *randomized* competitive ratio against an oblivious adversary, achieved by buying on a day drawn from a skewed distribution.
- **`(1 + λ, 1 + 1/λ)`** — the consistency–robustness frontier of the *learning-augmented* algorithm (Purohit–Svitkina–Kumar) with trust parameter `λ`.

---

## Beginner Tasks

### Task 1 — Break-even ski rental and offline OPT **[coding]**

`[easy]` Implement the two halves of the canonical instance.

- **Offline OPT** knows `D` in advance: if `D < B` rent all `D` days (cost `D`); if `D ≥ B` buy on day 1 (cost `B`). So `OPT(D) = min(D, B)`.
- **Break-even online**: rent on days `1, …, B − 1`; if still skiing on day `B`, buy. Cost is `D` when `D ≤ B − 1`, and `(B − 1) + B = 2B − 1` when `D ≥ B`.

Replay every `D` from `1` to `3B` and **measure the worst ratio `ALG/OPT`**. Confirm it never exceeds `2 − 1/B` and that the bound is **attained exactly at `D = B`**.

#### Python

```python
def opt_ski(D, B):
    return min(D, B)

def break_even(D, B):
    # Rent days 1..B-1; if still skiing on day B, buy (pay B more).
    if D <= B - 1:
        return D                  # trip ended before the buy trigger
    return (B - 1) + B            # rented B-1 days, then bought

if __name__ == "__main__":
    for B in (2, 5, 10, 50, 100):
        worst, arg = 0.0, 0
        for D in range(1, 3 * B + 1):
            ratio = break_even(D, B) / opt_ski(D, B)
            if ratio > worst:
                worst, arg = ratio, D
        bound = 2 - 1.0 / B
        print(f"B={B:3d}  worst ratio={worst:.4f} at D={arg:3d}  "
              f"2-1/B={bound:.4f}  ok={worst <= bound + 1e-9}")
        assert abs(worst - bound) < 1e-9 and arg == B
```

#### Go (core)

```go
func optSki(D, B int) int {
	if D < B {
		return D
	}
	return B
}

func breakEven(D, B int) int {
	if D <= B-1 {
		return D
	}
	return (B - 1) + B
}
```

- **Constraints:** Costs are integers; `B ≥ 2`. The online algorithm only ever learns "am I still skiing?" one day at a time — it may not branch on `D` before day `B`, which the break-even rule respects.
- **Hint:** For `D < B` both pay `D` (ratio 1). At `D = B`: `ALG = 2B − 1`, `OPT = B`, ratio `(2B − 1)/B = 2 − 1/B`. For `D > B`, `OPT` stays `B` while `ALG` stays `2B − 1`, so the ratio only drops.
- **Acceptance test:** For every `B`, the worst measured ratio equals `2 − 1/B`, attained at `D = B`, and never exceeds it.

---

### Task 2 — "Buy on day 1" and "rent forever" have unbounded ratio **[coding]**

`[easy]` Two tempting-but-terrible deterministic strategies. Show each has an **unbounded** competitive ratio — no constant `c` works for all inputs.

- **Buy on day 1:** pay `B` regardless of `D`. The adversary picks a 1-day trip: `OPT = 1`, `ALG = B`, ratio `B` — grows without bound as `B → ∞`.
- **Rent forever:** never buy; pay `D`. The adversary picks a very long trip: `OPT = B`, `ALG = D`, ratio `D/B → ∞`.

#### Python

```python
def buy_day1(D, B):      return B
def rent_forever(D, B):  return D

if __name__ == "__main__":
    B = 10
    # buy-on-day-1: adversary picks D = 1.
    print(f"buy-day1: ratio at D=1 is {buy_day1(1, B)/min(1, B):.1f} = B; "
          f"-> infinity as B grows")
    # rent-forever: adversary picks D large; ratio = D/B.
    print(f"{'D':>7} {'rent-forever ratio':>20}")
    for D in (B, 10 * B, 100 * B, 1000 * B):
        print(f"{D:>7} {rent_forever(D, B)/min(D, B):>20.1f}")
    print("rent-forever ratio = D/B is unbounded as D -> infinity")
```

- **Constraints:** Demonstrate the blow-up *as a function of the free parameter*: buy-on-day-1 is `Θ(B)` (unbounded in `B`); rent-forever is `Θ(D/B)` (unbounded in `D`). One fixed instance is not a proof — show the sweep.
- **Hint:** "Unbounded competitive ratio" means: for every constant `c` there is an input with `ALG > c · OPT`. Buy-on-day-1: take `D = 1` and let `B → ∞`. Rent-forever: fix `B`, take `D = cB + 1`, ratio `> c`.
- **Acceptance test:** Buy-on-day-1's ratio equals `B` at `D = 1`; rent-forever's equals `D/B` and scales with `D`. Neither admits a finite competitive ratio — unlike break-even's `2 − 1/B`. This is *why* break-even hedges in the middle rather than committing to an extreme.

---

### Task 3 — Empirical ratio over random and adversarial streams **[coding]**

`[easy]` Replaying single values of `D` is the cleanest test, but online analysis stresses an algorithm over *batches* of inputs. For a fixed `B`, replay trip lengths drawn three ways and report the **maximum** ratio in each batch:

1. **Uniform random** `D ∈ [1, 4B]`,
2. **Adversarial** (always `D = B`),
3. **Geometric** (frequent short trips, rare long ones).

Confirm the **maximum** ratio in every batch is `≤ 2 − 1/B`, and that only the adversarial batch reaches the bound.

#### Python

```python
import random

def opt_ski(D, B):    return min(D, B)
def break_even(D, B): return D if D <= B - 1 else (B - 1) + B

def batch_worst(Ds, B):
    return max(break_even(D, B) / opt_ski(D, B) for D in Ds)

if __name__ == "__main__":
    random.seed(1)
    B = 20
    bound = 2 - 1 / B
    uniform     = [random.randint(1, 4 * B) for _ in range(10_000)]
    adversarial = [B] * 10_000
    geometric   = [min(4 * B, 1 + int(random.expovariate(1 / 4))) for _ in range(10_000)]
    for name, Ds in (("uniform", uniform), ("adversarial", adversarial),
                     ("geometric", geometric)):
        w = batch_worst(Ds, B)
        print(f"{name:>12}: worst ratio={w:.4f}  bound={bound:.4f}  ok={w <= bound + 1e-9}")
        assert w <= bound + 1e-9
```

- **Constraints:** The same fixed deterministic algorithm runs across all three batches; only the input distribution changes. Report the **maximum** ratio per batch — competitive ratio is a worst-case quantity, so averages mislead.
- **Hint:** Random and geometric batches usually report ratios well below the bound because they rarely hit `D = B`; the adversarial batch hits it on every sample. This is the empirical face of "competitive ratio is a `∀`-statement."
- **Acceptance test:** All three batches stay `≤ 2 − 1/B`; only the adversarial batch attains it. This previews why *randomizing the algorithm* helps (Task 6): the adversary can no longer aim at one fixed worst `D`.

---

### Task 4 — Spin-then-block locks as ski rental **[coding]**

`[easy]` A thread that wants a contended lock can **spin** (busy-wait, burning CPU) or **block** (sleep and let the OS wake it later). Each spin cycle costs a little; blocking costs a fixed, larger amount `C` (the context-switch + wakeup overhead). The lock is released after an unknown wait `W`. This is **exactly ski rental**: a *spin cycle* is a *rental day* (cost 1), *blocking* is *buying* (cost `C`), and `W` is the trip length `D`.

The classic OS strategy — **spin for up to `C` cycles, then block** — is therefore the break-even rule with `B = C`, and is `(2 − 1/C)`-competitive. Map the problem, implement the strategy and the offline optimum `min(W, C)`, and **measure the ratio** over a range of wait times.

#### Python

```python
def opt_lock(W, C):
    # Offline: if the lock frees within C cycles, spin the whole time (cost W);
    # otherwise block immediately (cost C).
    return min(W, C)

def spin_then_block(W, C):
    # Spin up to C-1 cycles; if still waiting, block (pay C).
    if W <= C - 1:
        return W                  # acquired while spinning
    return (C - 1) + C            # spun C-1 cycles, then blocked

if __name__ == "__main__":
    for C in (4, 16, 64, 256):    # block cost in spin-cycle units
        worst, arg = 0.0, 0
        for W in range(1, 3 * C + 1):
            r = spin_then_block(W, C) / opt_lock(W, C)
            if r > worst:
                worst, arg = r, W
        bound = 2 - 1 / C
        print(f"C={C:4d}  worst ratio={worst:.4f} at W={arg:4d}  "
              f"2-1/C={bound:.4f}  ok={worst <= bound + 1e-9}")
        assert worst <= bound + 1e-9
```

- **Constraints:** State the mapping explicitly: spin-cost = rental (1), block-cost = `B = C`, wait time = `D`. The strategy may only learn whether the lock is still held, one cycle at a time.
- **Hint:** The worst wait is `W = C`: you spin `C − 1` cycles (wasted), then block (`C`), total `2C − 1`, while the optimum would have blocked immediately for `C`. Real implementations cap the spin budget near `C` precisely because of this `2 − 1/C` guarantee.
- **Acceptance test:** The worst ratio equals `2 − 1/C` at `W = C` and never exceeds it. The same code as Task 1 solves a real systems problem after a variable rename — that is the point of recognizing the rent-or-buy skeleton.

---

## Intermediate Tasks

### Task 5 — Prove break-even is `(2 − 1/B)`-competitive and deterministically optimal **[proof]**

`[medium]` Write a complete proof that break-even is `(2 − 1/B)`-competitive, *and* prove the matching lower bound: no deterministic online algorithm beats `2 − 1/B`.

> **No code.** Use this as the grading model.

**Model proof — upper bound.**

Let `D` be the adversary-chosen number of skiing days; the algorithm learns `D` only when skiing stops. Break-even rents on days `1, …, B − 1` and buys on day `B` if still skiing.

*Case `D ≤ B − 1`.* The algorithm only rents: `ALG = D`. The offline optimum also rents (since `D < B`): `OPT = D`. Ratio `= 1`.

*Case `D ≥ B`.* The algorithm rents `B − 1` days then buys: `ALG = (B − 1) + B = 2B − 1`. The optimum buys on day 1 (since `D ≥ B`): `OPT = B`. Ratio `= (2B − 1)/B = 2 − 1/B`.

The cases are exhaustive and the second dominates, so for every `D`,

```
ALG(D) ≤ (2 − 1/B) · OPT(D),
```

with no additive slack (`α = 0`): break-even is *strictly* `(2 − 1/B)`-competitive. ∎

**Model proof — lower bound (adversary).**

Let `A` be *any* deterministic online algorithm. Since `A` is deterministic and sees only "still skiing?", its behavior reduces to a single number: the day `b` on which it would first buy (`b = ∞` if it never buys). The adversary picks `D = b`.

- If `b = ∞` (never buys): pick `D` arbitrarily large. `ALG = D → ∞` while `OPT = B`, ratio unbounded.
- If `1 ≤ b ≤ B`: at `D = b` the algorithm rented `b − 1` days and bought, `ALG = (b − 1) + B`, while `OPT = min(b, B) = b`. Ratio `= (b − 1 + B)/b = 1 + (B − 1)/b ≥ 1 + (B − 1)/B = 2 − 1/B`, minimized at `b = B`.
- If `b > B`: at `D = b` the algorithm rented `b − 1 ≥ B` days then bought, `ALG = (b − 1) + B > 2B − 1`, while `OPT = B`. Ratio `> 2 − 1/B`.

In every case the ratio is `≥ 2 − 1/B`. Hence no deterministic online algorithm beats `2 − 1/B`, and break-even is **optimal** among deterministic algorithms. ∎

- **Constraints:** Both halves required: (1) the two-case upper bound `ALG ≤ (2 − 1/B)·OPT`; (2) the adversary argument that every deterministic algorithm is `≥ (2 − 1/B)`-competitive. State *why* a deterministic algorithm reduces to a single buy-day `b`.
- **Acceptance test:** The proof exhibits the two upper-bound cases, the buy-day reduction with the `D = b` adversary, and concludes optimality at exactly `2 − 1/B`.

---

### Task 6 — Randomized ski rental approaches `e/(e − 1) ≈ 1.58` **[coding]**

`[medium]` Randomization breaks the deterministic `2 − 1/B` barrier. The optimal randomized algorithm picks a **random buy-day** `j ∈ {1, …, B}` from a skewed distribution and buys on day `j` if still skiing. Against an **oblivious** adversary (which fixes `D` before seeing the coin) its *expected* competitive ratio tends to `e/(e − 1) ≈ 1.582` as `B → ∞`.

The optimal discrete distribution puts weight

```
p_j ∝ ( (B − 1) / B )^{B − j}        for j = 1..B   (normalize so Σ p_j = 1).
```

Implement the randomized algorithm and `OPT`, sweep the **oblivious adversary's stopping day** `D`, and **Monte-Carlo estimate the worst expected ratio**. Confirm it lands near `e/(e − 1)` and *below* `2 − 1/B`.

#### Python

```python
import random, math

def opt_ski(D, B):
    return min(D, B)

def buy_distribution(B):
    w = [((B - 1) / B) ** (B - j) for j in range(1, B + 1)]
    total = sum(w)
    return [x / total for x in w]

def sample_buy_day(probs):
    r, acc = random.random(), 0.0
    for j, p in enumerate(probs, start=1):
        acc += p
        if r <= acc:
            return j
    return len(probs)

def randomized_ski(D, B, buy_day):
    if D < buy_day:
        return D                  # trip ended before we bought
    return (buy_day - 1) + B      # rented buy_day-1 days, then bought

if __name__ == "__main__":
    random.seed(7)
    print(f"{'B':>5} {'worst E[ratio]':>16} {'e/(e-1)':>10} {'2-1/B':>8}")
    for B in (10, 50, 200, 1000):
        probs = buy_distribution(B)
        trials_per_D = 4000
        worst = 0.0
        for D in range(1, 2 * B + 1):       # oblivious adversary: fix D, then flip
            tot = 0.0
            for _ in range(trials_per_D):
                tot += randomized_ski(D, B, sample_buy_day(probs)) / opt_ski(D, B)
            worst = max(worst, tot / trials_per_D)
        print(f"{B:>5} {worst:>16.4f} {math.e/(math.e-1):>10.4f} {2 - 1/B:>8.4f}")
        assert worst <= 2 - 1/B + 0.02      # strictly below the deterministic bound
```

- **Constraints:** The adversary is **oblivious** — it fixes `D` before the coin is flipped, so you sweep candidate `D` and take the worst *expected* ratio, never letting the adversary peek at `j`. Use enough trials that the estimate is stable to two decimals; the distribution must be normalized.
- **Hint:** The skew `((B−1)/B)^{B−j}` makes early buy-days *rarer* and late buy-days *commoner* — the algorithm leans toward renting but keeps a real chance of buying early, denying the adversary a single worst `D`. As `B → ∞` the discrete optimum converges to the continuous density of Task 8.
- **Acceptance test:** The worst expected ratio over all stopping days is `≈ 1.58` for large `B`, strictly below `2 − 1/B`. Randomization buys roughly a `0.42` reduction in the worst-case multiplier.

---

### Task 7 — The Bahncard / discount-card rent-or-buy problem **[coding]**

`[medium]` The **Bahncard problem** generalizes ski rental. A traveler makes trips of varying cost. Without a card, a trip of price `t` costs `t`. A **discount card** costs `C` up front, lasts forever (the simplified, non-expiring version), and reduces every subsequent trip's price by a factor `β ∈ (0, 1)` — you pay `β·t` per trip after buying. Should you buy the card, and when?

This is rent-or-buy with a twist: buying does not make future trips *free*, only *cheaper*. Reducing to ski rental: think in units of "money saved." Each trip of price `t` would save `(1 − β)·t` if you already held the card, so accumulated potential savings play the role of "rental days," and the card price `C` plays the role of `B`. The break-even rule becomes: **buy the card once your cumulative would-be savings `(1 − β)·Σt` reach `C`.**

Implement the online break-even Bahncard, the offline optimum (buy at time 0 iff total discounted spend justifies it), and **measure the ratio**. Then find the competitive ratio as a function of `β`.

#### Python

```python
def offline_bahncard(prices, C, beta):
    # Offline OPT: either never buy (pay sum prices) or buy at the start
    # (pay C + beta*sum prices). Choose the cheaper; full hindsight.
    total = sum(prices)
    no_card = total
    with_card = C + beta * total
    return min(no_card, with_card)

def online_bahncard(prices, C, beta):
    # Break-even on accumulated would-be savings. Buy the card the first time
    # the savings it WOULD have given so far reach C.
    cost = 0.0
    have_card = False
    would_be_savings = 0.0
    for t in prices:
        if have_card:
            cost += beta * t
            continue
        # Decide before paying for this trip: would buying now have paid off?
        would_be_savings += (1 - beta) * t
        if would_be_savings >= C:
            cost += C            # buy the card now ...
            have_card = True
            cost += beta * t     # ... and this trip is discounted
        else:
            cost += t            # still no card: full price
    return cost

if __name__ == "__main__":
    import random
    random.seed(2)
    C, beta = 100.0, 0.5
    bound = 2 - (1 - beta)       # = 1 + beta, the Bahncard break-even ratio
    worst = 0.0
    for _ in range(20000):
        n = random.randint(1, 40)
        prices = [random.uniform(1, 30) for _ in range(n)]
        on = online_bahncard(prices, C, beta)
        off = offline_bahncard(prices, C, beta)
        worst = max(worst, on / off)
    print(f"C={C} beta={beta}  worst ratio={worst:.4f}  bound 2-(1-beta)={bound:.4f}  "
          f"ok={worst <= bound + 1e-9}")
    assert worst <= bound + 1e-9
```

- **Constraints:** The card never expires (simplified model); `β ∈ (0, 1)`; the card discounts the *current* trip too if you buy right before paying for it. Decide whether to buy *before* committing each trip's payment — the algorithm cannot look ahead.
- **Hint:** Setting `β = 0` recovers ordinary ski rental (`C = B`), and the bound `2 − (1 − β) = 1 + β` collapses to `2`. The break-even threshold is where cumulative *savings* `(1 − β)Σt` reach the card price `C`; the worst case has the traveler stop the instant the card is bought, paying for it without recouping — exactly the `D = B` adversary in disguise.
- **Acceptance test:** Over random price sequences the measured worst ratio stays `≤ 1 + β`, and tends toward it on adversarial sequences that stop right after the card is purchased. The classic Bahncard result (Fleischer) gives `2 − β` for the *expiring* card; the non-expiring break-even here gives `1 + β`.

---

### Task 8 — Verify the continuous randomized density `p(x) = e^x/(e − 1)` **[coding + analysis]**

`[medium]` In the continuous limit (`B → ∞`, scale so the buy cost is `1` and the rental rate is `1` per unit "time"), the optimal randomized algorithm buys at a random time `x ∈ [0, 1]` drawn from the density

```
p(x) = e^x / (e − 1),     x ∈ [0, 1].
```

Buying at time `x` means renting for `x` (cost `x`) then paying `1` to buy, *if* the trip lasts beyond `x`; if the trip ends at time `D ≤ x` you only paid `D`. Show by **sampling** that this density yields expected competitive ratio `e/(e − 1)` for every adversarial stopping time `D ∈ [0, 1]` (the ratio is *constant* in `D` — that flatness is what makes it optimal).

#### Python

```python
import random, math

def opt_cont(D):
    return min(D, 1.0)            # buy costs 1, rent rate 1

def sample_buy_time():
    # Inverse-CDF sample from p(x) = e^x/(e-1). CDF F(x) = (e^x - 1)/(e - 1).
    u = random.random()
    return math.log(1 + u * (math.e - 1))     # F^{-1}(u)

def alg_cont(D, x):
    # Rent until x, then buy (pay 1) if still skiing; else stop at D.
    if D <= x:
        return D
    return x + 1.0

if __name__ == "__main__":
    random.seed(11)
    target = math.e / (math.e - 1)
    trials = 200_000
    print(f"{'D':>5} {'E[ratio]':>10} {'e/(e-1)':>10}")
    worst = 0.0
    for D in (0.05, 0.25, 0.5, 0.75, 0.999):
        tot = 0.0
        for _ in range(trials):
            tot += alg_cont(D, sample_buy_time()) / opt_cont(D)
        est = tot / trials
        worst = max(worst, est)
        print(f"{D:>5.3f} {est:>10.4f} {target:>10.4f}")
    print(f"worst over D = {worst:.4f}  (flat ~ e/(e-1) = {target:.4f})")
    assert abs(worst - target) < 0.02
```

- **Analysis to write:** Compute `E[ALG(D)]` for fixed `D ∈ [0, 1]` directly. With buy-time density `p(x) = e^x/(e − 1)`:

  ```
  E[ALG(D)] = ∫₀ᴰ (x + 1) p(x) dx + ∫_D¹ D · p(x) dx.
  ```

  The first integral covers buy-times before the trip ends (you bought, cost `x + 1`); the second covers buy-times after (you never bought, cost `D`). Carrying out the integral gives `E[ALG(D)] = (e/(e − 1))·D` for all `D ∈ [0, 1]`, while `OPT(D) = D`, so the ratio is the constant `e/(e − 1)` — *independent of `D`*. A distribution that equalizes the ratio across all adversary choices is optimal, because the adversary has no preferred `D` to exploit.
- **Constraints:** Sample via the inverse CDF `F⁻¹(u) = ln(1 + u(e − 1))`, not rejection sampling. Verify the ratio is *flat* across `D`, not merely small at one point — flatness is the optimality witness.
- **Acceptance test:** For every tested `D ∈ (0, 1)` the estimated `E[ratio]` is `≈ e/(e − 1)`, and the spread across `D` is within Monte-Carlo noise. The hand integral confirms the empirical flatness analytically.

---

## Advanced Tasks

### Task 9 — Learning-augmented ski rental: consistency vs robustness **[coding]**

`[hard]` A **learning-augmented** algorithm (Purohit–Svitkina–Kumar, 2018) receives a *prediction* `ŷ` of the unknown ski days `D` plus a trust parameter `λ ∈ (0, 1]`, and aims to be both:

- **Consistent:** ratio `→ 1` as the prediction error `→ 0` (small `λ` trusts the prediction more), and
- **Robust:** ratio bounded even when `ŷ` is arbitrarily wrong.

The deterministic PSK rule: if the prediction says "long trip" (`ŷ ≥ B`), buy early — when rental cost reaches `λB`; if it says "short trip" (`ŷ < B`), buy late — when rental cost reaches `B/λ` (capped so the buy-day is a valid day). This is **`(1 + λ)`-consistent** and **`(1 + 1/λ)`-robust**. Implement it, sweep `λ`, and **empirically plot consistency (ratio under a perfect prediction) against robustness (worst ratio over adversarial `ŷ`)**, confirming the two guarantees.

#### Python

```python
def opt_ski(D, B):
    return min(D, B)

def la_ski(D, B, y_hat, lam):
    # Prediction-augmented buy-day threshold.
    if y_hat >= B:                          # predict long trip -> buy early
        buy_day = max(1, round(lam * B))
    else:                                   # predict short trip -> buy late
        buy_day = max(1, round(B / lam))
    if D < buy_day:
        return D
    return (buy_day - 1) + B

if __name__ == "__main__":
    B = 100
    print(f"{'lam':>5} {'consistency':>12} {'1+lam':>7} "
          f"{'robustness':>11} {'1+1/lam':>8}")
    for lam in (0.1, 0.25, 0.5, 0.75, 1.0):
        # Consistency: perfect prediction y_hat = D, worst over D.
        consistency = max(la_ski(D, B, D, lam) / opt_ski(D, B)
                          for D in range(1, 3 * B))
        # Robustness: adversarial prediction (wildly wrong both directions), worst over D.
        robustness = 0.0
        for D in range(1, 3 * B):
            for y_hat in (1, 10 * B):
                robustness = max(robustness,
                                 la_ski(D, B, y_hat, lam) / opt_ski(D, B))
        print(f"{lam:>5.2f} {consistency:>12.3f} {1+lam:>7.3f} "
              f"{robustness:>11.3f} {1+1/lam:>8.3f}")
        assert consistency <= 1 + lam + 0.05
        assert robustness  <= 1 + 1/lam + 0.05
```

- **Constraints:** `λ` interpolates trust: small `λ` *trusts* the prediction (low consistency ratio, high robustness ratio), large `λ` *hedges* (consistency rises toward 2, robustness falls toward 2). Round buy-days to valid integer days `≥ 1`.
- **Hint:** No `λ` makes the algorithm both `1`-consistent and `2`-robust at once: the Pareto frontier `(1 + λ, 1 + 1/λ)` is the unavoidable *price of trusting an unverified prediction*. The `λ → 1` corner recovers the prediction-free `2 − 1/B` of Task 1 — full hedging, no trust.
- **Acceptance test:** Consistency tracks `≈ 1 + λ` (best when `λ` is small), robustness tracks `≈ 1 + 1/λ` (best when `λ` is large), and the two move in opposite directions as `λ` sweeps — the empirical consistency–robustness frontier.

---

### Task 10 — Randomized lower bound `e/(e − 1)` via Yao **[analysis]**

`[hard]` Task 6 *achieved* `e/(e − 1)`; now prove no randomized ski-rental algorithm can do **better** against an oblivious adversary. Use **Yao's principle**.

> **No code.** Model derivation follows.

**Yao's principle.** To lower-bound the expected competitive ratio of any randomized online algorithm against an oblivious adversary, it suffices to fix a single **input distribution** `D` over stopping days and lower-bound the expected ratio of the *best deterministic* algorithm on `D`:

```
min over randomized R of  max over D of  E[R] / OPT   ≥   min over deterministic A of  E_{D∼𝒟}[A / OPT].
```

**The hard distribution.** Work in the continuous model (buy cost `1`, rent rate `1`, trip length `D ∈ [0, 1]`). Let the adversary draw `D` from the density

```
q(D) = 1 / (e − 1) · e^{−(1−D)} · (something)   ⟶   the right choice is q(D) ∝ e^{D}  on [0,1],
```

more precisely the distribution that makes *every* deterministic buy-time `b` incur the same expected ratio. A deterministic algorithm is, as always, a single buy-time `b ∈ [0, 1]` (or "never buy"). Its expected cost under `𝒟`:

```
E[ALG_b] = ∫₀ᵇ D · q(D) dD  +  ∫_b¹ (b + 1) · q(D) dD,
```

since for `D < b` the trip ends before buying (cost `D`), and for `D ≥ b` the algorithm rents `b` then buys (cost `b + 1`). With `OPT(D) = D`, choose `q` so that `E[ALG_b] / E[OPT]` is **constant in `b`** — equal to `e/(e − 1)`. (This `q` is the dual partner of the algorithm's optimal buy-time density `p(x) = e^x/(e − 1)` from Task 8; the equalizing input distribution and the equalizing algorithm distribution are a matched saddle pair.)

**Applying Yao.** Because *some* input distribution forces every deterministic algorithm — hence the best one — to expected ratio `≥ e/(e − 1)`, Yao lifts this to randomized algorithms: every randomized ski-rental algorithm has expected competitive ratio `≥ e/(e − 1)` against an oblivious adversary. Task 6's algorithm matches it, so `e/(e − 1)` is **exactly** the randomized ski-rental ratio. ∎

- **Constraints:** State Yao's inequality (the min-max swap), exhibit an input distribution that equalizes the expected ratio across all deterministic buy-times `b`, and conclude the `e/(e − 1)` lower bound. Note the duality with the optimal *algorithm* density of Task 8.
- **Acceptance test:** The answer invokes Yao correctly (single input distribution → best-deterministic expected ratio lower-bounds the randomized worst case), supplies an equalizing distribution over stopping days, derives the constant `e/(e − 1)`, and identifies it as a matched saddle point with Task 8's algorithm distribution.

---

### Task 11 — Multi-option leasing / parking-permit variant **[analysis + coding]**

`[hard]` Ski rental has two options (rent, buy). The **parking-permit / multi-option leasing** problem has many: at each step you may purchase one of several leases, lease `i` costing `c_i` and valid for duration `d_i`, and you must cover every day on which you "park" (use the resource). With `K` lease types this generalizes rent-or-buy to a *menu* of commitments. The deterministic competitive ratio is `O(K)` and there is a matching randomized `O(log K)` algorithm — directly echoing the deterministic-`k`-vs-randomized-`log k` gap of paging.

Take the simplest nontrivial menu: a **daily** permit (`c₁ = 1`, `d₁ = 1`) and a **long** permit (`c₂ = B`, `d₂ = ∞`). Show this *is* ski rental, so the deterministic ratio is `2 − 1/B`. Then add a **third, intermediate** permit (`c₃ = m`, covers a block of `m` consecutive days, `1 < m < B`) and analyze how the deterministic competitive ratio changes; simulate to confirm.

#### Python (simulation harness)

```python
def offline_opt(park_days, permits):
    # park_days: sorted list of day indices that must be covered.
    # permits: list of (cost, duration) with duration None meaning infinite.
    # DP over the sorted parking days: cost to cover days[i:].
    days = sorted(set(park_days))
    n = len(days)
    INF = float("inf")
    best = [0.0] + [INF] * n      # best[i] = min cost to cover days[i:]; index from the end
    # process from last day backward
    dp = [0.0] * (n + 1)
    for i in range(n - 1, -1, -1):
        dp[i] = INF
        for (cost, dur) in permits:
            if dur is None:
                dp[i] = min(dp[i], cost)           # one infinite permit covers the rest
            else:
                # this permit bought on day[i] covers [day[i], day[i]+dur)
                limit = days[i] + dur
                j = i
                while j < n and days[j] < limit:
                    j += 1
                dp[i] = min(dp[i], cost + dp[j])
    return dp[0]

def online_break_even(park_days, B):
    # Two-option ski rental online rule on the parking stream.
    rented = 0
    cost = 0
    bought = False
    for _ in park_days:
        if bought:
            continue
        rented += 1
        if rented >= B:           # break-even: buy the infinite permit
            cost += B
            bought = True
        else:
            cost += 1
    return cost

if __name__ == "__main__":
    import random
    random.seed(4)
    B = 20
    worst = 0.0
    permits_two = [(1, 1), (B, None)]            # daily + infinite == ski rental
    for _ in range(5000):
        days = sorted(random.sample(range(0, 3 * B), random.randint(1, 3 * B)))
        on  = online_break_even(days, B)
        off = offline_opt(days, permits_two)
        worst = max(worst, on / off)
    print(f"two-option (ski rental): worst online/OPT = {worst:.4f}  "
          f"bound 2-1/B = {2 - 1/B:.4f}")
    assert worst <= 2 - 1/B + 1e-9
```

- **Analysis to write:**
  1. **Two options reduce to ski rental.** The daily permit is "rent," the infinite permit is "buy" with `B = c₂`. OPT picks `min(#park-days, B)` in the worst (contiguous) case, and break-even is `(2 − 1/B)`-competitive verbatim.
  2. **Adding the `m`-day permit.** With three options the adversary can no longer be defeated by a single threshold: a good online rule must hedge across *both* the day→block and block→infinite decisions. Each "level" of the lease hierarchy contributes a constant to the ratio, giving `O(number of levels)` deterministically — here `O(3)` rather than `O(2)`. The general parking-permit result is deterministic `Θ(K)` for `K` lease durations and randomized `Θ(log K)` (Meyerson, 2005), structurally identical to the deterministic-`k` vs randomized-`H_k` story for paging.
  3. **Why randomization helps again.** As with ski rental and paging, the deterministic algorithm commits to thresholds the adversary can target; a randomized algorithm spreads its commitment across lease levels, and the `O(log K)` bound falls out of an exponential-weights / harmonic argument over the `K` levels.
- **Constraints:** The offline OPT must be exact (the DP over sorted parking days is correct for nested/non-overlapping permit durations). For the two-option menu the simulation must reproduce the `2 − 1/B` ski-rental bound exactly.
- **Acceptance test:** The two-option simulation matches `2 − 1/B`; the written analysis explains the per-level constant that yields deterministic `Θ(K)`, names the randomized `Θ(log K)` (Meyerson) result, and draws the explicit parallel to paging's deterministic-`k` / randomized-`H_k` gap.

---

## Synthesis Task

> Carry ski rental through the full rent-or-buy arc — online algorithm, offline OPT, adversary, deterministic proof, randomized improvement, and the prediction-augmented frontier — and locate it on the online-algorithms map.

`[capstone]` Assemble the pieces into one account.

1. **Algorithm + OPT [coding].** Break-even (Task 1) and `OPT(D) = min(D, B)`; replay all `D`, report worst ratio `= 2 − 1/B`, attained at `D = B`.

2. **Deterministic optimality [proof].** Prove `ALG ≤ (2 − 1/B)·OPT` and the matching lower bound (Task 5): every deterministic algorithm reduces to a buy-day `b`, and `D = b` forces ratio `≥ 2 − 1/B`.

3. **Randomized improvement [coding + analysis].** Run the randomized algorithm (Task 6), measure the worst expected ratio approaching `e/(e − 1) ≈ 1.58`, and explain via Yao (Task 10) why this is the randomized floor — the oblivious adversary must fix `D` before the coin, so it cannot aim at the algorithm's committed buy-day.

4. **A real rent-or-buy instance [coding].** Reuse the *same* code for spin-then-block locks (Task 4, `B = C`) or the Bahncard (Task 7), demonstrating that the skeleton transfers across domains by a variable rename.

5. **Learning-augmented frontier [coding].** Sweep `λ` (Task 9) and report the `(1 + λ, 1 + 1/λ)` consistency–robustness trade-off; contrast `λ → 1` with the prediction-free `2 − 1/B`.

Reference harness in **Python** (combines the deterministic and randomized pieces):

```python
import math, random

def opt(D, B):        return min(D, B)
def break_even(D, B): return D if D <= B - 1 else (B - 1) + B

def det_worst(B):
    return max(break_even(D, B) / opt(D, B) for D in range(1, 3 * B))

def randomized_worst(B, trials_per_D=4000):
    w = [((B - 1) / B) ** (B - j) for j in range(1, B + 1)]
    tot = sum(w)
    probs = [x / tot for x in w]
    def sample():
        r, acc = random.random(), 0.0
        for j, p in enumerate(probs, 1):
            acc += p
            if r <= acc:
                return j
        return B
    worst = 0.0
    for D in range(1, 2 * B + 1):
        s = 0.0
        for _ in range(trials_per_D):
            j = sample()
            s += (D if D < j else (j - 1) + B) / opt(D, B)
        worst = max(worst, s / trials_per_D)
    return worst

if __name__ == "__main__":
    random.seed(42)
    for B in (10, 100, 1000):
        det = det_worst(B)
        rnd = randomized_worst(B)
        print(f"B={B:5d}  deterministic={det:.4f} (=2-1/B={2-1/B:.4f})  "
              f"randomized~{rnd:.3f} (floor e/(e-1)={math.e/(math.e-1):.3f})")
        assert det <= 2 - 1/B + 1e-9
```

- **Proof answer:** Deterministic break-even is *strictly* `(2 − 1/B)`-competitive (two-case upper bound) and optimal (buy-day reduction + `D = b` adversary). Randomization lowers the worst *expected* ratio to `e/(e − 1)` because the oblivious adversary must fix `D` before the coin, defeating the "aim at the committed buy-day" attack — the same mechanism that gives paging its randomized `H_k` floor.
- **Acceptance test:** Deterministic worst ratio equals `2 − 1/B`, attained at `D = B`; randomized worst expected ratio sits near `e/(e − 1) < 2 − 1/B`; the proof closes both deterministic bounds; the write-up places ski rental on the map between deterministic `2 − 1/B`, randomized `e/(e − 1)`, and the prediction-augmented `(1 + λ, 1 + 1/λ)` frontier — and shows the same code solving a real systems problem (spin-then-block, Bahncard). This is the whole craft: **implement the online algorithm, build the adversary, prove the ratio, measure it against offline OPT, and pin down where randomization and predictions move the floor.**

---

## Where to go next

- Return to the framework these tasks instantiate — competitive ratio, adversary models, Yao's principle, potential-function proofs — in the [competitive-analysis tasks](../01-competitive-analysis/tasks.md).
- Carry the online/offline/adversary discipline and the randomized `H_k`-via-Yao argument into caches in the [paging-and-caching tasks](../03-paging-and-caching-theory/tasks.md).
- For the conceptual treatment of break-even, the randomized distribution, the Bahncard, spin-then-block, and learning-augmented consistency/robustness, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.

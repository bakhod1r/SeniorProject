# Competitive Analysis — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, implement the online algorithm, the **offline OPT**, replay the request sequence, and **measure the competitive ratio**.
> **[proof]** / **[analysis]** tasks need no code: prove a competitive ratio (via an adversary argument or a potential function), or apply Yao's principle, with a clean, complete argument. Model derivations are provided so you can grade yourself.

Competitive analysis measures an **online** algorithm — one that must irrevocably commit to each decision as requests arrive, without seeing the future — against the **offline optimum** OPT, which sees the whole request sequence in advance. For a cost-minimization problem, an online algorithm `ALG` is **`c`-competitive** if there is a constant `α` such that for **every** request sequence `σ`,

```
ALG(σ) ≤ c · OPT(σ) + α.
```

The smallest such `c` is the **competitive ratio**. The `+α` additive slack absorbs startup cost; when `α = 0` the algorithm is **strictly** `c`-competitive. A **deterministic** online algorithm faces an **adversary** who knows the algorithm's code and constructs the worst `σ`; a **randomized** algorithm with an **oblivious** adversary (the adversary fixes `σ` before seeing the coin flips) is `c`-competitive if `E[ALG(σ)] ≤ c · OPT(σ) + α`.

The recurring discipline for every coding task is the same as for amortized and approximation work: **implement the online algorithm, implement an offline OPT, replay sequences (including adversarial ones), and measure the ratio.** The acceptance test is always *"the measured competitive ratio respects the proven bound across every tested sequence."* An online algorithm whose ratio you cannot bound is just a heuristic; a bound you never replay against OPT is just a hope.

**Related practice:**
- [Ski Rental and Rent-or-Buy tasks](../02-ski-rental-and-rent-or-buy/tasks.md) — the canonical rent-or-buy problem the beginner tasks build on, and learning-augmented variants.
- [Paging and Caching Theory tasks](../03-paging-and-caching-theory/tasks.md) — the `k`-competitive paging results and Belady's offline optimum.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the models used throughout:
- **Adversary models.** An *oblivious* adversary fixes `σ` in advance (the relevant model for randomized algorithms). An *adaptive* adversary chooses each request after seeing the algorithm's prior moves. Against a deterministic algorithm the distinction collapses — the adversary can simulate the algorithm and so already knows every move.
- **Yao's principle.** To lower-bound the expected cost of *any* randomized algorithm against an oblivious adversary, it suffices to exhibit a single probability distribution `D` over inputs and lower-bound the expected cost of the *best deterministic* algorithm on `D`. Formally, `min_R max_σ E[R(σ)] ≥ min_A E_{σ∼D}[A(σ)]` — the best randomized algorithm's worst case is at least the best deterministic algorithm's average over any input distribution.

---

## Beginner Tasks

### Task 1 — Break-even ski rental: online vs offline OPT **[coding]**

`[easy]` In the **ski-rental** problem you ski for an unknown number of days. Each day you either **rent** skis for `1` unit, or **buy** once for `B` units and ski free forever after. You do not know the total number of days `D` until skiing ends (the adversary stops it).

The **break-even** online algorithm: rent for the first `B − 1` days; if you are still skiing on day `B`, buy. The **offline OPT** knows `D` in advance: if `D < B` it rents all `D` days (cost `D`); if `D ≥ B` it buys on day 1 (cost `B`). So `OPT(D) = min(D, B)`.

Implement both, replay every `D` from `1` to some `D_max`, and **measure the worst ratio `ALG/OPT`**. Confirm it never exceeds `2 − 1/B`.

#### Python

```python
def opt_ski(D, B):
    return min(D, B)

def break_even_ski(D, B):
    # Rent days 1..B-1; if still skiing on day B, buy (pay B more).
    if D <= B - 1:
        return D                 # never reached the buy trigger
    return (B - 1) + B           # rented B-1 days, then bought

if __name__ == "__main__":
    for B in (2, 5, 10, 50):
        worst = 0.0
        arg = 0
        for D in range(1, 4 * B + 1):
            alg = break_even_ski(D, B)
            opt = opt_ski(D, B)
            ratio = alg / opt
            if ratio > worst:
                worst, arg = ratio, D
        bound = 2 - 1.0 / B
        print(f"B={B:3d} worst ratio={worst:.4f} at D={arg:3d}  "
              f"bound 2-1/B={bound:.4f}  ok={worst <= bound + 1e-9}")
        assert worst <= bound + 1e-9
```

#### Go (core)

```go
func optSki(D, B int) int {
	if D < B {
		return D
	}
	return B
}

func breakEvenSki(D, B int) int {
	if D <= B-1 {
		return D
	}
	return (B - 1) + B
}
```

- **Constraints:** Costs are integers; `B ≥ 2`. The online algorithm may not branch on `D` before day `B` — it only learns "am I still skiing?" one day at a time, which the break-even rule respects. Brute force here is just replaying every `D`; no exponential search is needed.
- **Hint:** The worst case is exactly `D = B`. Then `ALG = (B − 1) + B = 2B − 1` while `OPT = B`, so the ratio is `(2B − 1)/B = 2 − 1/B`. For `D < B` both pay `D` (ratio 1); for `D > B`, `OPT` is still `B` but `ALG` is still `2B − 1`, so the ratio only drops.
- **Acceptance test:** For every `B`, the worst measured ratio equals `2 − 1/B` (attained at `D = B`) and never exceeds it. The bound tends to `2` as `B → ∞`.

---

### Task 2 — The adversary that forces the ratio toward 2 **[coding + analysis]**

`[easy]` Against the deterministic break-even algorithm, the adversary's job is to pick the worst `D`. Task 1 already revealed it: `D = B`. Here you make the adversary **explicit** — a routine that, given the algorithm's buy-day `b` (the day on which it would buy), returns the `D` that maximizes `ALG/OPT`.

Generalize: for *any* deterministic "buy on day `b`" threshold algorithm, the adversary sets `D = b` (stop skiing the instant the algorithm commits to buying). Show that the break-even choice `b = B` is the threshold that **minimizes** the resulting worst-case ratio — any other `b` is worse.

#### Python

```python
def threshold_ski(D, B, b):
    # Buy on day b (rent days 1..b-1), parameterized threshold.
    if D <= b - 1:
        return D
    return (b - 1) + B

def adversary_ratio(B, b):
    # Adversary stops skiing on day b: the algorithm just paid to buy.
    D = b
    alg = threshold_ski(D, B, b)
    opt = min(D, B)
    return alg / opt

if __name__ == "__main__":
    B = 10
    print(f"{'b':>3} {'worst ratio':>12}")
    best_b, best_ratio = None, float("inf")
    for b in range(1, 2 * B + 1):
        # Worst D over the whole range for this threshold b.
        worst = max(threshold_ski(D, B, b) / min(D, B)
                    for D in range(1, 3 * B + 1))
        if worst < best_ratio:
            best_ratio, best_b = worst, b
        print(f"{b:>3} {worst:>12.4f}")
    print(f"\nbest threshold b*={best_b} (= B), worst ratio={best_ratio:.4f} "
          f"= 2 - 1/B = {2 - 1/B:.4f}")
    assert best_b == B
```

- **Analysis to write:** Argue that for a threshold `b`, the adversary's best stopping day is `D = b` (any later `D` only raises `OPT`; any earlier `D` makes `ALG = OPT`). At `D = b` the ratio is `((b−1) + B) / min(b, B)`. Minimizing over `b`: for `b < B` the denominator is `b` and the numerator `b − 1 + B`, giving `(b − 1 + B)/b = 1 + (B−1)/b`, which *decreases* as `b` grows toward `B`; for `b > B` the denominator saturates at `B` while the numerator keeps growing, so the ratio rises again. The minimum is at `b = B`, value `(2B − 1)/B = 2 − 1/B`.
- **Acceptance test:** The adversary routine reproduces `D = b` as the worst stopping day; the sweep confirms `b* = B` minimizes the worst-case ratio at exactly `2 − 1/B`. No deterministic threshold beats break-even.

---

### Task 3 — "Buy immediately" and "rent forever" have unbounded ratio **[coding]**

`[easy]` Two tempting-but-terrible deterministic strategies:

- **Buy immediately:** buy on day 1 for cost `B`, regardless of `D`.
- **Rent forever:** never buy; pay `D` for `D` days.

Show each has an **unbounded** competitive ratio — no constant `c` works for all `σ`. The adversary defeats *buy-immediately* with a 1-day trip (`OPT = 1`, `ALG = B`) and defeats *rent-forever* with a very long trip (`OPT = B`, `ALG = D → ∞`).

#### Python

```python
def buy_immediately(D, B):
    return B

def rent_forever(D, B):
    return D

if __name__ == "__main__":
    B = 10
    # Buy-immediately: adversary picks D=1.
    bi_worst = max(buy_immediately(D, B) / min(D, B) for D in range(1, 200))
    bi_arg = 1
    print(f"buy-immediately worst ratio={bi_worst:.2f} at D={bi_arg} "
          f"(= B/1 = {B}); grows without bound as B grows")

    # Rent-forever: adversary picks D large; ratio = D/B -> infinity.
    print(f"{'D':>6} {'rent-forever ratio':>20}")
    for D in (B, 10 * B, 100 * B, 1000 * B):
        print(f"{D:>6} {rent_forever(D, B) / min(D, B):>20.2f}")
    print("rent-forever ratio = D/B is unbounded as D -> infinity")
```

- **Constraints:** Demonstrate the blow-up *as a function of the free parameter* — buy-immediately is `Θ(B)` (unbounded in `B`); rent-forever is `Θ(D/B)` (unbounded in `D`). A single fixed instance is not enough; show the parameter sweep.
- **Hint:** "Unbounded competitive ratio" means: for every constant `c` there is a `σ` with `ALG(σ) > c · OPT(σ)`. Buy-immediately: take `D = 1`, ratio `B`, and let `B → ∞`. Rent-forever: fix `B`, take `D = cB + 1`, ratio `> c`.
- **Acceptance test:** Buy-immediately's ratio equals `B` at `D = 1` and scales with `B`; rent-forever's ratio equals `D/B` and scales with `D`. Neither admits a finite competitive ratio, unlike break-even's `2 − 1/B`.

---

### Task 4 — Empirical ratio of break-even over random and adversarial streams **[coding]**

`[easy]` Replaying single values of `D` is the cleanest test, but real online analysis stresses an algorithm with whole *sequences* of decisions. Build a small harness that, for a fixed `B`, replays a batch of trip lengths `D` drawn three ways and reports the **maximum** ratio seen in each batch:

1. **Uniform random** `D ∈ [1, 4B]`,
2. **Adversarial** (always `D = B`),
3. **Geometric** `D` (frequent short trips, rare long ones).

Confirm the *maximum* ratio in every batch is `≤ 2 − 1/B`, and that only the adversarial batch reaches the bound.

#### Python

```python
import random

def opt_ski(D, B):      return min(D, B)
def break_even(D, B):   return D if D <= B - 1 else (B - 1) + B

def batch_worst(Ds, B):
    return max(break_even(D, B) / opt_ski(D, B) for D in Ds)

if __name__ == "__main__":
    random.seed(1)
    B = 20
    bound = 2 - 1 / B
    uniform = [random.randint(1, 4 * B) for _ in range(10_000)]
    adversarial = [B] * 10_000
    geometric = [min(4 * B, 1 + int(random.expovariate(1 / 4))) for _ in range(10_000)]
    for name, Ds in (("uniform", uniform),
                     ("adversarial", adversarial),
                     ("geometric", geometric)):
        w = batch_worst(Ds, B)
        print(f"{name:>12}: worst ratio={w:.4f}  bound={bound:.4f}  ok={w <= bound + 1e-9}")
        assert w <= bound + 1e-9
```

- **Constraints:** The same fixed deterministic algorithm must run across all three batches; only the input distribution changes. Report the **maximum** ratio per batch — the competitive ratio is a worst-case quantity, so averages are misleading here.
- **Hint:** Random and geometric batches will usually report ratios well below the bound because they rarely hit `D = B`; the adversarial batch hits it on every sample. This is the empirical face of "competitive ratio is a `∀`-statement."
- **Acceptance test:** All three batches stay `≤ 2 − 1/B`; only the adversarial batch attains it. This previews why *randomizing the algorithm* helps: the adversary can no longer aim at one fixed worst `D`.

---

## Intermediate Tasks

### Task 5 — Prove break-even ski rental is `(2 − 1/B)`-competitive **[proof]**

`[medium]` Write a complete proof that the break-even algorithm of Task 1 is `(2 − 1/B)`-competitive, *and* prove the matching lower bound: no deterministic online algorithm can do better.

> **No code.** Use this as the grading model.

**Model proof — upper bound.**

Let `D` be the (adversary-chosen) number of skiing days; the algorithm learns `D` only when skiing stops. The break-even rule rents on days `1, …, B − 1` and buys on day `B` if still skiing.

*Case `D ≤ B − 1`.* The algorithm only ever rents, paying `ALG = D`. The offline optimum also rents (since `D < B`), so `OPT = D`. Ratio `= 1`.

*Case `D ≥ B`.* The algorithm rents `B − 1` days then buys, paying `ALG = (B − 1) + B = 2B − 1`. The offline optimum buys on day 1 (since `D ≥ B`), paying `OPT = B`. Ratio `= (2B − 1)/B = 2 − 1/B`.

These two cases are exhaustive, and the second dominates, so for every `D`,

```
ALG(D) ≤ (2 − 1/B) · OPT(D).
```

The bound is strict (`α = 0`): break-even is *strictly* `(2 − 1/B)`-competitive. ∎

**Model proof — lower bound (adversary).**

Let `A` be *any* deterministic online algorithm. Because `A` is deterministic and sees only "still skiing?", its entire behavior is determined by a single number: the day `b` on which it would first buy (set `b = ∞` if it never buys). The adversary picks `D = b`.

- If `b = ∞` (never buys), the adversary picks `D` arbitrarily large: `ALG = D → ∞` while `OPT = B`, so the ratio is unbounded.
- If `b ≤ B`, then at `D = b` the algorithm rented `b − 1` days and bought, paying `ALG = (b − 1) + B`, while `OPT = min(b, B) = b`. Ratio `= (b − 1 + B)/b = 1 + (B − 1)/b ≥ 1 + (B − 1)/B = 2 − 1/B`, minimized at `b = B`.
- If `b > B`, then at `D = b` the algorithm rented `b − 1 ≥ B` days then bought, paying `ALG = (b − 1) + B > 2B − 1`, while `OPT = B`. Ratio `> 2 − 1/B`.

In every case the ratio is `≥ 2 − 1/B`. Hence no deterministic online algorithm beats `2 − 1/B`, and break-even is **optimal** among deterministic algorithms. ∎

- **Constraints:** Both halves required: (1) the case analysis giving `ALG ≤ (2 − 1/B)·OPT`, (2) the adversary argument showing every deterministic algorithm is `≥ (2 − 1/B)`-competitive. State why a deterministic algorithm reduces to a single buy-day `b`.
- **Acceptance test:** The proof exhibits the two cases for the upper bound, the buy-day reduction and the `D = b` adversary for the lower bound, and concludes optimality at `2 − 1/B`.

---

### Task 6 — Randomized ski rental approaches `e/(e−1) ≈ 1.58` **[coding]**

`[medium]` Randomization breaks the deterministic `2 − 1/B` barrier. The optimal randomized ski-rental algorithm picks a **random buy-day** `j ∈ {1, …, B}` from a carefully skewed distribution and buys on day `j` (if still skiing). Against an oblivious adversary its *expected* competitive ratio tends to `e/(e−1) ≈ 1.582` as `B → ∞`.

The (continuous-limit) optimal distribution puts probability proportional to `(1 + 1/B)^{j}` on buying at day `j`; concretely, with `j ∈ {1, …, B}`,

```
p_j ∝ ( (B − 1) / B )^{B − j}        (normalize so Σ p_j = 1).
```

Implement this randomized algorithm and its OPT, run it against the **worst-case stopping day** for each fixed coin distribution (the adversary still picks `D`, but cannot see the coin), and **estimate the expected ratio** by Monte Carlo. Confirm it lands near `e/(e−1)` and *below* `2 − 1/B`.

#### Python

```python
import random, math

def opt_ski(D, B):
    return min(D, B)

def make_buy_distribution(B):
    # p_j proportional to ((B-1)/B)^(B-j) for j = 1..B; the classic skew.
    weights = [((B - 1) / B) ** (B - j) for j in range(1, B + 1)]
    total = sum(weights)
    return [w / total for w in weights]

def sample_buy_day(probs):
    r, acc = random.random(), 0.0
    for j, p in enumerate(probs, start=1):
        acc += p
        if r <= acc:
            return j
    return len(probs)

def randomized_ski(D, B, buy_day):
    # Rent until buy_day; buy on day buy_day if still skiing.
    if D < buy_day:
        return D                 # trip ended before we bought
    return (buy_day - 1) + B     # rented buy_day-1 days, then bought

if __name__ == "__main__":
    random.seed(7)
    probs_cache = {}
    print(f"{'B':>4} {'worst E[ratio]':>16} {'e/(e-1)':>10} {'2-1/B':>8}")
    for B in (10, 50, 200, 1000):
        probs = make_buy_distribution(B)
        trials = 200_000
        # Adversary picks the D maximizing the expected ratio; sweep candidate Ds.
        worst = 0.0
        for D in range(1, 2 * B + 1):
            total = 0.0
            for _ in range(trials // (2 * B) + 1):
                j = sample_buy_day(probs)
                total += randomized_ski(D, B, j) / opt_ski(D, B)
            est = total / (trials // (2 * B) + 1)
            worst = max(worst, est)
        print(f"{B:>4} {worst:>16.4f} {math.e/(math.e-1):>10.4f} {2 - 1/B:>8.4f}")
```

- **Constraints:** The adversary is **oblivious** — it fixes `D` before the coin is flipped, so you sweep candidate `D` and take the worst *expected* ratio, never letting the adversary peek at `j`. Use enough Monte-Carlo trials that the estimate is stable to two decimals. The distribution must be normalized.
- **Hint:** The exact optimal discrete distribution and constant are derived in the [ski-rental notes](../02-ski-rental-and-rent-or-buy/tasks.md); here you only need the measured expected ratio to sit near `e/(e−1) ≈ 1.582` and clearly below the deterministic `2 − 1/B`. As `B` grows, both the distribution and the achieved ratio converge to the continuous optimum.
- **Acceptance test:** The worst expected ratio over all stopping days is `≈ 1.58` for large `B`, strictly below `2 − 1/B`. Randomization buys you roughly a `0.42` reduction in the worst-case multiplier.

---

### Task 7 — Move-to-Front for list update vs an offline optimum **[coding]**

`[medium]` In the **list-update** problem you maintain an unsorted linked list of `k` items. To access an item you pay its current 1-based position (the number of comparisons to reach it). After an access you may move the item *toward the front for free* (free transpositions). **Move-to-Front (MTF)** moves each accessed item all the way to the front.

MTF is famously **2-competitive** against the offline optimum (in the standard cost model, even when OPT may use paid exchanges). Implement MTF, implement a comparison offline baseline (**static optimum**: the single fixed ordering, by decreasing access frequency, that minimizes total cost — a clean lower bar to measure against), and **measure the ratio of MTF's cost to the static optimum's cost** on random and skewed request streams.

#### Python

```python
import random
from collections import Counter

def mtf_cost(items, requests):
    lst = list(items)
    cost = 0
    for r in requests:
        i = lst.index(r)
        cost += i + 1            # 1-based access cost
        lst.pop(i)               # move-to-front (free)
        lst.insert(0, r)
    return cost

def static_optimum_cost(items, requests):
    # Best FIXED order = sort by decreasing frequency; cost = sum of positions.
    freq = Counter(requests)
    order = sorted(items, key=lambda x: -freq[x])
    pos = {x: i + 1 for i, x in enumerate(order)}
    return sum(pos[r] for r in requests)

if __name__ == "__main__":
    random.seed(3)
    items = list(range(10))
    print(f"{'stream':>12} {'MTF':>8} {'static-OPT':>11} {'ratio':>7}")
    # Uniform requests.
    uni = [random.choice(items) for _ in range(5000)]
    # Skewed (Zipf-ish): low ids far more frequent.
    weights = [1.0 / (i + 1) for i in items]
    skew = random.choices(items, weights=weights, k=5000)
    # Locality bursts: repeat the same item in runs.
    burst = []
    for _ in range(500):
        x = random.choice(items)
        burst += [x] * random.randint(1, 12)
    for name, req in (("uniform", uni), ("skewed", skew), ("bursty", burst)):
        m = mtf_cost(items, req)
        s = static_optimum_cost(items, req)
        print(f"{name:>12} {m:>8} {s:>11} {m/s:>7.3f}")
```

- **Constraints:** Access cost is the 1-based position. MTF's move-to-front is free; the static optimum pays positions in a single fixed order chosen with full hindsight of frequencies. The static optimum is a *weaker* offline benchmark than the fully dynamic OPT, so MTF/static may exceed 1 but should stay comfortably within a small constant — and on bursty (high-locality) streams MTF often *beats* the static order (ratio < 1).
- **Hint:** MTF exploits *locality of reference*: a burst of repeated accesses costs `1` each after the first. The static optimum cannot adapt within a stream. The 2-competitiveness against the fully dynamic OPT is proved with a potential function (Task 8), not against this static baseline — here you are building intuition and the measurement harness.
- **Acceptance test:** MTF's cost stays within a small constant factor of the static optimum on uniform/skewed streams and can drop below it on bursty streams. The harness cleanly separates the online cost from the offline benchmark cost.

---

### Task 8 — Potential-function proof: MTF is 2-competitive **[proof]**

`[medium]` Prove that Move-to-Front is 2-competitive using the **inversion potential**. (For concreteness, assume OPT keeps a fixed list and uses only paid exchanges to reorder; the argument extends to the full model.)

> **No code.** Model derivation follows.

**Model derivation.**

Run MTF and OPT in lockstep on the same request sequence, both starting from the same list. Define the potential

```
Φ = (number of inversions between MTF's list and OPT's list),
```

where an **inversion** is an unordered pair `{x, y}` that appears in one relative order in MTF's list and the opposite order in OPT's list. Initially the lists are identical, so `Φ₀ = 0`, and `Φ ≥ 0` always.

Consider a single request to item `x`. Let MTF's cost be the position of `x` in MTF's list; write it as `1 + k`, where `k` is the number of items *before* `x` in MTF's list. Partition those `k` predecessors relative to OPT's list at the time of the request: let `p` of them precede `x` in OPT's list too, and `q = k − p` of them follow `x` in OPT's list. Each of the `q` items forms an inversion with `x` that MTF is about to remove.

**Amortized cost of MTF's move.** MTF accesses `x` (real cost `1 + k = 1 + p + q`) and moves it to the front. Moving `x` to the front *destroys* the `q` inversions (those items that were ahead of `x` in MTF but behind it in OPT now end up behind `x` in MTF — matching OPT's order) and *creates* at most `p` new inversions (the `p` items that were ahead of `x` in both lists are now behind `x` in MTF but still ahead in OPT). So the change in potential from MTF's move is at most `p − q`:

```
ΔΦ_MTF ≤ p − q.
```

The amortized cost of MTF's access is

```
â_MTF = (1 + p + q) + ΔΦ_MTF ≤ (1 + p + q) + (p − q) = 1 + 2p.
```

**Relating `p` to OPT.** In OPT's list, the `p` items precede `x`, so OPT pays at least `p + 1` to access `x` (its position is at least `p + 1`). Hence `1 + 2p ≤ 2(p + 1) − 1 ≤ 2·cost_OPT(x)`. If OPT also performs paid exchanges, each paid exchange of an adjacent pair changes the inversion count by at most `1`, so it contributes at most `+1` to `Φ` per unit of OPT cost; folding this in keeps the amortized bound at `â_MTF ≤ 2·cost_OPT(request)`.

**Summing.** Telescoping over the whole sequence of `n` requests,

```
MTF_total = Σ cost_MTF ≤ Σ â_MTF + (Φ₀ − Φ_n) ≤ 2·OPT_total + Φ₀ − Φ_n ≤ 2·OPT_total,
```

since `Φ₀ = 0` and `Φ_n ≥ 0`. Therefore `MTF(σ) ≤ 2·OPT(σ)` for every `σ`: MTF is 2-competitive. ∎

- **Constraints:** Define the inversion potential, justify `Φ₀ = 0` and `Φ ≥ 0`, split the predecessors into `p` (also-before in OPT) and `q` (after in OPT), bound `ΔΦ ≤ p − q`, and close with `1 + 2p ≤ 2·cost_OPT`.
- **Acceptance test:** The proof produces amortized cost `≤ 2·cost_OPT` per request via the inversion potential and telescopes to `MTF ≤ 2·OPT`. (An alternative potential-method proof for ski rental — `Φ = ` "credit toward the eventual purchase" — is a fine bonus; the inversion argument is the canonical list-update proof.)

---

## Advanced Tasks

### Task 9 — Online paging: LRU / FIFO / FWF vs Belady's offline LFD **[coding]**

`[hard]` In **paging**, a cache holds `k` pages; each request hits (free) or misses (cost 1, evicting a resident page to make room). Online algorithms must choose evictions without seeing future requests; the offline optimum is **Belady's LFD** (Longest-Forward-Distance: on a miss, evict the resident page whose next use is farthest in the future — *provably optimal*).

The deterministic online algorithms **LRU** (evict least-recently-used), **FIFO** (evict oldest-loaded), and **FWF** (Flush-When-Full: on a miss with a full cache, evict *everything*) are each exactly **`k`-competitive** — and `k` is optimal for deterministic paging.

Implement all four, replay request sequences, and **measure each online algorithm's miss count against LFD's**. Confirm the ratio stays `≤ k`, and build the adversarial sequence that drives LRU to exactly `k·OPT`.

#### Python

```python
import random

def lfd_misses(requests, k):
    # Belady: on a miss with full cache, evict the page used farthest ahead.
    cache, misses = set(), 0
    for i, p in enumerate(requests):
        if p in cache:
            continue
        misses += 1
        if len(cache) < k:
            cache.add(p)
        else:
            # Evict the resident page whose next use is farthest (or never).
            def next_use(page):
                for j in range(i + 1, len(requests)):
                    if requests[j] == page:
                        return j
                return float("inf")
            victim = max(cache, key=next_use)
            cache.discard(victim)
            cache.add(p)
    return misses

def lru_misses(requests, k):
    cache, recent, misses = set(), {}, 0
    for t, p in enumerate(requests):
        if p in cache:
            recent[p] = t
            continue
        misses += 1
        if len(cache) >= k:
            victim = min(cache, key=lambda x: recent[x])
            cache.discard(victim)
        cache.add(p)
        recent[p] = t
    return misses

def fifo_misses(requests, k):
    from collections import deque
    cache, order, misses = set(), deque(), 0
    for p in requests:
        if p in cache:
            continue
        misses += 1
        if len(cache) >= k:
            victim = order.popleft()
            cache.discard(victim)
        cache.add(p)
        order.append(p)
    return misses

def fwf_misses(requests, k):
    cache, misses = set(), 0
    for p in requests:
        if p in cache:
            continue
        misses += 1
        if len(cache) >= k:
            cache.clear()        # flush everything
        cache.add(p)
    return misses

def adversarial_lru_sequence(k, rounds):
    # k+1 pages cycled in order: LRU (and FIFO) miss EVERY request,
    # while LFD misses only ~1 per k requests.
    pages = list(range(k + 1))
    seq = []
    for _ in range(rounds):
        seq += pages
    return seq

if __name__ == "__main__":
    random.seed(5)
    for k in (3, 5, 8):
        # Random stream over a small page universe.
        rnd = [random.randint(0, 2 * k) for _ in range(2000)]
        opt = lfd_misses(rnd, k)
        print(f"k={k} random stream: "
              f"LRU/OPT={lru_misses(rnd,k)/opt:.2f} "
              f"FIFO/OPT={fifo_misses(rnd,k)/opt:.2f} "
              f"FWF/OPT={fwf_misses(rnd,k)/opt:.2f}  (bound {k})")
        # Adversarial cyclic stream -> drives LRU toward k*OPT.
        adv = adversarial_lru_sequence(k, rounds=200)
        opt_a = lfd_misses(adv, k)
        print(f"   adversarial: LRU/OPT={lru_misses(adv,k)/opt_a:.2f} "
              f"(approaches k={k})")
        assert lru_misses(adv, k) <= k * opt_a + 1e-9
```

- **Constraints:** LFD must be the offline optimum — evict the resident page with the farthest next use (treat "never used again" as `+∞`). The LFD implementation here is `O(n²)`; keep sequences in the low thousands. All three online algorithms must run on the *same* request stream as LFD.
- **Hint:** The adversarial stream cycles `k + 1` distinct pages `0, 1, …, k, 0, 1, …` On each request LRU evicts exactly the page requested next, so it misses on *every* access; LFD, evicting the farthest-future page, misses only once per `k` requests. The ratio tends to `k`. FIFO behaves identically on this cyclic input.
- **Acceptance test:** On every stream, LRU/FIFO/FWF misses are `≤ k · OPT`; on the cyclic adversarial stream LRU's ratio approaches `k`, witnessing that the `k`-competitive bound is tight and that `k` is optimal for deterministic paging.

---

### Task 10 — Yao's principle: a randomized paging lower bound **[analysis]**

`[hard]` Deterministic paging is exactly `k`-competitive, but *randomized* paging (against an oblivious adversary) can do much better — the optimal randomized ratio is `H_k = 1 + 1/2 + … + 1/k ≈ ln k`. Use **Yao's principle** to prove the *lower bound*: no randomized paging algorithm beats `H_k`.

> **No code.** Model derivation follows.

**Model derivation.**

Yao's principle says: to lower-bound the expected competitive ratio of any randomized online algorithm against an oblivious adversary, it suffices to choose a single **input distribution** `D` and lower-bound the *expected* cost of the **best deterministic** algorithm on `D`, then compare to `E_D[OPT]`. Formally, for any distribution `D`,

```
min over randomized R of  max over σ of  E[R(σ)]   ≥   min over deterministic A of  E_{σ∼D}[A(σ)].
```

**The hard distribution.** Fix a universe of exactly `k + 1` distinct pages (one more than the cache holds). Generate the request sequence by, at each step, requesting a page chosen **uniformly at random** from the `k + 1` pages, independently, for `N` steps.

**Cost of the best deterministic algorithm on `D`.** A deterministic algorithm holds some `k` of the `k + 1` pages; exactly one page is *out* of cache. A request causes a miss iff it hits that one missing page, which happens with probability `1/(k + 1)` per step. *But* this is too weak directly; the sharp bound comes from the standard "phase" analysis: partition the sequence into **phases**, where a phase is a maximal run that touches exactly `k + 1` distinct pages... more precisely, group the random requests so that within the structure of `k + 1` pages, the expected number of *fresh faults* the best deterministic strategy suffers before all `k + 1` pages have been requested follows the **coupon-collector / harmonic** law. The expected number of misses any deterministic algorithm incurs over a block in which the adversary's randomness forces re-reference is `≥ H_k = Σ_{i=1}^{k} 1/i` times the number of misses an offline optimum incurs on the same block.

Concretely: in the uniform model over `k + 1` pages, every deterministic algorithm faults on a Θ-fraction of requests, while the offline optimum — which on each fault evicts the page requested farthest in the future — faults only once per "round" in which all `k + 1` pages are forced. The ratio of expected deterministic cost to expected OPT cost approaches `H_k`.

**Applying Yao.** Since *some* distribution `D` forces every deterministic algorithm to expected cost `≥ H_k · E_D[OPT]`, Yao's principle lifts this to randomized algorithms: every randomized paging algorithm has expected competitive ratio `≥ H_k` against an oblivious adversary. The matching upper bound is achieved by the **Marker** algorithm, so the randomized paging competitive ratio is exactly `Θ(H_k) = Θ(log k)` — an exponential improvement over the deterministic `k`. ∎

- **Constraints:** State Yao's inequality precisely (the min-max swap), exhibit the *uniform-over-`k+1`-pages* distribution, argue that the best deterministic algorithm pays an `H_k` factor over OPT on it, and conclude the randomized lower bound. Name **Marker** as the matching `O(log k)` upper bound.
- **Acceptance test:** The answer correctly invokes Yao (single input distribution → best deterministic expected cost lower-bounds randomized worst case), supplies the `k + 1`-page uniform distribution, and derives the `H_k ≈ ln k` lower bound, contrasting it with the deterministic `k`.

---

### Task 11 — Learning-augmented ski rental: consistency vs robustness **[coding]**

`[hard]` A **learning-augmented** online algorithm receives a *prediction* `ŷ` of the unknown quantity (here, the number of ski days `D`) and a trust parameter `λ ∈ (0, 1]`. We want it to be:

- **Consistent:** near-optimal when the prediction is good (ratio `→ 1` as `λ → 0`), and
- **Robust:** never much worse than the prediction-free bound, even when `ŷ` is arbitrarily wrong (ratio bounded by a function of `λ`).

A clean predict-then-rent rule: if the prediction says "buy" (`ŷ ≥ B`), buy when the rental cost reaches `λB`; if it says "rent" (`ŷ < B`), buy only when the rental cost reaches `B/λ`. This is known to be `(1 + λ)`-consistent and `(1 + 1/λ)`-robust. Implement it, sweep `λ`, and **plot consistency (ratio under a perfect prediction) against robustness (worst-case ratio over adversarial `D`)**.

#### Python

```python
def opt_ski(D, B):
    return min(D, B)

def la_ski(D, B, y_hat, lam):
    # Predict-then-rent. Buy-day threshold depends on the prediction.
    if y_hat >= B:                      # prediction says: long trip, buy early
        buy_day = max(1, round(lam * B))
    else:                               # prediction says: short trip, delay buying
        buy_day = max(1, round(B / lam))
    if D < buy_day:
        return D
    return (buy_day - 1) + B

if __name__ == "__main__":
    B = 100
    print(f"{'lam':>5} {'consistency':>12} {'robustness':>11} "
          f"{'1+lam':>7} {'1+1/lam':>8}")
    for lam in (0.1, 0.25, 0.5, 0.75, 1.0):
        # Consistency: perfect prediction (y_hat = D), worst D.
        consistency = max(la_ski(D, B, D, lam) / opt_ski(D, B)
                          for D in range(1, 3 * B))
        # Robustness: adversarial prediction (always wrong), worst D.
        robustness = 0.0
        for D in range(1, 3 * B):
            for y_hat in (1, 10 * B):    # wildly wrong both ways
                robustness = max(robustness,
                                 la_ski(D, B, y_hat, lam) / opt_ski(D, B))
        print(f"{lam:>5.2f} {consistency:>12.3f} {robustness:>11.3f} "
              f"{1+lam:>7.3f} {1+1/lam:>8.3f}")
```

- **Constraints:** The trust parameter `λ` interpolates: small `λ` trusts the prediction (low consistency ratio, high robustness ratio), large `λ` hedges (consistency ratio rises toward 2, robustness ratio falls toward 2). The reported consistency must respect `≈ 1 + λ` under a perfect prediction; robustness must respect `≈ 1 + 1/λ` under an adversarial prediction. Round buy-days to valid integer days `≥ 1`.
- **Hint:** This is the **consistency–robustness trade-off** at the heart of learning-augmented (algorithms-with-predictions) online algorithms. No setting of `λ` gives you both a `1`-consistent and a `2`-robust algorithm — the Pareto frontier `(1 + λ, 1 + 1/λ)` is the price of trusting an unverified prediction. Compare the `λ → 1` corner to the prediction-free `2 − 1/B` of Task 1.
- **Acceptance test:** Consistency tracks `≈ 1 + λ` (best when `λ` is small), robustness tracks `≈ 1 + 1/λ` (best when `λ` is large), and the two move in opposite directions as `λ` sweeps — the empirical Pareto frontier of prediction trust.

---

### Task 12 — Construct the worst-case input for a given deterministic algorithm **[analysis]**

`[hard]` The cleanest way to *lower-bound* a deterministic online algorithm is to build, mechanically, the request sequence that maximizes `ALG/OPT`. Because the algorithm is deterministic, the adversary can **simulate it** and always make the next request the one the algorithm is least prepared for. Write a general account of this "construct-the-adversary" technique and apply it to two of the problems above.

> **No code.** Model derivation follows.

**Model — the general technique.**

A deterministic online algorithm `A` is a *fixed function* from request history to action. The adversary, knowing `A`'s code, builds `σ` request by request:

1. Maintain the algorithm's state by simulating `A` on the prefix built so far.
2. Issue the next request that makes `A` pay maximally while keeping `OPT` cheap — typically the request that targets exactly the resource `A` just committed to / discarded.
3. Stop when the accumulated ratio reaches the target lower bound.

Because `A` cannot adapt to information it has not yet seen, and the adversary *has* seen `A`'s next move (by simulation), the adversary always wins the information asymmetry. This is exactly why deterministic online algorithms have *unconditional* lower bounds, while randomized ones force the adversary to commit before seeing the coins (Yao).

**Application 1 — paging (drive LRU/FIFO to `k`).** Use a universe of `k + 1` pages and always request the *one page not currently in `A`'s cache*. Simulate `A`: after each miss, `A` evicts some page `v`; the adversary's next request is `v` (or the unique page `A` does not hold), forcing a miss every step. Over `N` requests `A` faults `N` times. OPT, by Belady, evicts the page used farthest ahead, so it faults only once every `k` requests, giving `A/OPT → k`. (This is precisely the cyclic sequence built in Task 9.)

**Application 2 — ski rental (drive break-even to `2 − 1/B`).** The deterministic break-even algorithm commits to buying on day `B`. The adversary simulates this, then sets `D = B`: stop skiing the moment after the algorithm buys. The algorithm has paid `B − 1` rentals plus `B` to buy (`2B − 1`); OPT, knowing `D = B`, buys on day 1 for `B`. Ratio `2 − 1/B`. The construction is degenerate (a single number) but follows the same template: read the algorithm's committed action, then make that action wasteful.

**Why randomization escapes this.** If `A` flips coins, the adversary must fix `σ` *before* the coins are revealed (oblivious model). It can no longer aim the request at "the page `A` just evicted," because that page is now a random variable. Step 2 of the recipe fails — which is the whole reason randomized ratios (`H_k` for paging, `e/(e−1)` for ski rental) beat deterministic ones.

- **Constraints:** Spell out the three-step simulate-then-attack recipe, explain the information-asymmetry that makes it work against any deterministic algorithm, apply it to *both* paging (cyclic `k+1` pages → ratio `k`) and ski rental (`D = B` → ratio `2 − 1/B`), and explain precisely why the recipe breaks under randomization.
- **Acceptance test:** The answer states the general adversary-construction recipe, instantiates it for paging and ski rental with the correct ratios (`k` and `2 − 1/B`), and correctly identifies that an oblivious adversary against a randomized algorithm cannot execute step 2 — the bridge to Yao's principle and Task 10.

---

## Synthesis Task

> Tie the thread together: implement an online algorithm and its offline OPT, measure the competitive ratio, prove the bound, and locate it on the deterministic-vs-randomized map.

`[capstone]` Take **ski rental** and carry it through the full competitive-analysis arc — online algorithm, offline OPT, adversary, proof, randomized improvement, and the prediction-augmented frontier.

1. **Algorithm + OPT [coding].** Implement break-even (Task 1) and `OPT(D) = min(D, B)`. Replay all `D` and report the worst ratio `= 2 − 1/B`.

2. **Adversary [coding].** Implement the adversary (Task 2) that returns `D = B`, the single worst input for break-even, and confirm it attains the bound.

3. **Deterministic optimality [proof].** Prove `ALG ≤ (2 − 1/B)·OPT` and the matching lower bound (Task 5): every deterministic algorithm reduces to a buy-day `b`, and `D = b` forces ratio `≥ 2 − 1/B`.

4. **Randomized improvement [coding + analysis].** Run the randomized algorithm (Task 6) and measure the expected ratio approaching `e/(e−1) ≈ 1.58`; explain via Yao (Task 10's technique) why this is the randomized floor and why the oblivious adversary cannot reach `2 − 1/B`.

5. **Learning-augmented frontier [coding].** Sweep `λ` (Task 11) and report the `(1 + λ, 1 + 1/λ)` consistency–robustness trade-off, contrasting `λ → 1` with the prediction-free `2 − 1/B`.

Reference harness in **Python** (combines the pieces):

```python
import math, random

def opt(D, B):           return min(D, B)
def break_even(D, B):    return D if D <= B - 1 else (B - 1) + B

def det_worst(B):
    return max(break_even(D, B) / opt(D, B) for D in range(1, 3 * B))

def randomized_worst(B, trials=100_000):
    weights = [((B - 1) / B) ** (B - j) for j in range(1, B + 1)]
    tot = sum(weights)
    probs = [w / tot for w in weights]
    def sample():
        r, acc = random.random(), 0.0
        for j, p in enumerate(probs, 1):
            acc += p
            if r <= acc:
                return j
        return B
    worst = 0.0
    for D in range(1, 2 * B + 1):
        s = sum((D if D < (j := sample()) else (j - 1) + B) / opt(D, B)
                for _ in range(trials // (2 * B) + 1))
        worst = max(worst, s / (trials // (2 * B) + 1))
    return worst

if __name__ == "__main__":
    random.seed(42)
    for B in (10, 100, 1000):
        det = det_worst(B)
        rnd = randomized_worst(B)
        print(f"B={B:4d}  deterministic={det:.4f} (=2-1/B={2-1/B:.4f})  "
              f"randomized≈{rnd:.3f} (floor e/(e-1)={math.e/(math.e-1):.3f})")
        assert det <= 2 - 1/B + 1e-9
```

- **Proof answer:** Deterministic break-even is *strictly* `(2 − 1/B)`-competitive (two-case upper bound) and optimal (buy-day reduction + `D = b` adversary). Randomization lowers the worst *expected* ratio to `e/(e−1)` because the oblivious adversary must fix `D` before the coin, defeating the "aim at the committed move" attack — the bridge to Yao's `H_k` paging bound.
- **Acceptance test:** Deterministic worst ratio equals `2 − 1/B` and is attained at `D = B`; randomized worst expected ratio sits near `e/(e−1) < 2 − 1/B`; the proof closes both the upper and lower deterministic bounds; the write-up places ski rental on the online map between the deterministic `2 − 1/B`, the randomized `e/(e−1)`, and the prediction-augmented `(1 + λ, 1 + 1/λ)` frontier. This mirrors the whole craft — **implement the online algorithm, build the adversary, prove the ratio, measure it against offline OPT, and pin down where randomization and predictions move the floor**.

---

## Where to go next

- Apply the same online/offline/adversary discipline to the rent-or-buy family and learning-augmented variants in the [ski-rental tasks](../02-ski-rental-and-rent-or-buy/tasks.md).
- Push the paging results — Marker, randomized `H_k`, and the `k`-competitive deterministic family — in the [paging-and-caching tasks](../03-paging-and-caching-theory/tasks.md).
- For the conceptual treatment of competitive ratio, adversary models, Yao's principle, and potential-function competitive proofs, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.

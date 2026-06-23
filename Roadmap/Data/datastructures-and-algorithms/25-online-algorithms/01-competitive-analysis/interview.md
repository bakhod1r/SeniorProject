# Competitive Analysis — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Marquee: Ski Rental](#the-marquee-ski-rental)
3. [Adversary Models & Randomization](#adversary-models--randomization)
4. [Gotcha / Trick Questions](#gotcha--trick-questions)
5. [Rapid-Fire Q&A](#rapid-fire-qa)
6. [Common Mistakes](#common-mistakes)
7. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is an online algorithm? *(Easy)*

**Answer**: An **online algorithm** processes its input as a sequence `σ = ⟨r₁, r₂, …⟩` of requests, making an **irrevocable** decision for each `rᵢ` *before* seeing `rᵢ₊₁` — it has no knowledge of the future. An **offline** algorithm, by contrast, sees the entire input up front and can optimize over all of it.

The whole field exists because the cost of a decision often depends on requests that haven't arrived yet: should you cache this page now if you can't see what's requested next? **Competitive analysis** is the standard yardstick for "how much does the lack of a crystal ball cost you?"

### Q2: Define the competitive ratio precisely. What is OPT? *(Medium — the core definition)*

**Answer**: An online algorithm `ALG` is **`c`-competitive** if there is a constant `α` such that for *every* input sequence `σ`:

```
ALG(σ) ≤ c · OPT(σ) + α        (minimization / cost)
```

- `ALG(σ)` is the total cost `ALG` incurs on `σ`.
- `OPT(σ)` is the **offline optimum** — the cost of the best possible solution *computed with full knowledge of all of σ*. It is the omniscient benchmark, not another online player.
- `c` is the **competitive ratio**; the smaller, the better. `c = 1` means `ALG` matches the clairvoyant optimum.

For maximization (profit) problems the inequality flips: `ALG(σ) ≥ (1/c)·OPT(σ) − α`, with `c ≥ 1`.

The defining feature: this is a **worst-case** guarantee over *all* `σ`, including adversarially chosen ones — there is no input distribution.

### Q3: Strict vs asymptotic competitive ratio — what's the additive `α` for? *(Medium)*

**Answer**: The constant `α` (independent of `σ`) absorbs **startup / boundary effects** so they don't distort the ratio.

- **Strictly `c`-competitive**: the bound holds with `α = 0`, i.e. `ALG(σ) ≤ c·OPT(σ)` for all `σ`.
- **(Asymptotically) `c`-competitive**: the bound holds for *some* finite `α`. The `α` becomes negligible as `OPT(σ) → ∞`, so it captures the *long-run* ratio.

`α` lets a short, cheap sequence (where one fixed overhead would blow up the ratio) not count against the algorithm. When an interviewer says "`c`-competitive" without qualification, they usually mean the asymptotic version.

### Q4: Who is "the adversary" and why frame it that way? *(Easy)*

**Answer**: The **adversary** is a personification of the worst case: an opponent who constructs the input sequence `σ` specifically to maximize `ALG`'s cost *relative to* `OPT`. Competitive analysis is exactly a game — you pick the algorithm, the adversary picks `σ` to make `ALG(σ)/OPT(σ)` as large as possible, and the competitive ratio is the value of that game.

Framing it as an adversary makes lower-bound proofs concrete: to show "no algorithm beats `c`," you exhibit an adversary strategy that forces ratio `c` against *any* algorithm.

---

## The Marquee: Ski Rental

> **The rent-or-buy problem.** Skis cost `B` to **buy** (forever) or `1` per day to **rent**. You ski an unknown number of days `D`, revealed one day at a time (each morning you learn whether you ski again). Each day you must rent or buy; once you buy, you stop paying. Minimize total cost. The offline optimum is `OPT = min(D, B)`: rent the whole time if `D < B`, else buy on day 1.

### Q5: Prove the break-even strategy is 2-competitive. *(Medium — the classic)*

**Answer**: **Strategy**: rent for the first `B − 1` days; if you're still skiing on day `B`, **buy** that morning. (Buy once your accumulated rent equals the purchase price.)

Analyze by cases on the true number of days `D`:

- **Case `D < B`** (you stop before buying): you only ever rent, paying `D`. The optimum also rents: `OPT = D`. Ratio `= 1`.
- **Case `D ≥ B`** (you reach the buy day): you rent `B − 1` days then buy for `B`, total `ALG = (B − 1) + B = 2B − 1`. The optimum buys on day 1: `OPT = B`. Ratio `= (2B − 1)/B = 2 − 1/B < 2`.

In every case `ALG ≤ (2 − 1/B)·OPT < 2·OPT`. So the break-even rule is **2-competitive** (in fact strictly so). See [../02-ski-rental-and-rent-or-buy/interview.md](../02-ski-rental-and-rent-or-buy/interview.md) for variants.

### Q6: Show no deterministic algorithm beats 2. *(Hard — the lower bound)*

**Answer**: Fix any deterministic algorithm. Because it's deterministic and the past is identical every run, its behavior is determined by one number: the day `k` on which it would buy (set `k = ∞` if it never buys). The **adversary watches for `k` and stops you the day after you commit.**

- If the algorithm **buys on day `k`** (and the days really do continue to day `k`): the adversary sets `D = k`, the *exact* day of purchase. The algorithm paid `(k − 1)` rent `+ B` to buy `= k − 1 + B`. But `OPT = min(k, B)`. The worst case is `k = B`: `ALG = 2B − 1`, `OPT = B`, ratio `→ 2 − 1/B`.
- If the algorithm **never buys** (`k = ∞`): the adversary lets `D → ∞`. `ALG = D → ∞` while `OPT = B`, an **unbounded** ratio.

Either way the adversary forces ratio `≥ 2 − 1/B`, which tends to `2` as `B → ∞`. Hence **no deterministic algorithm is better than 2-competitive**, and break-even matches the bound. The intuition: buying too early wastes money if the season ends; buying too late wastes rent if it doesn't — break-even is the optimal hedge.

### Q7: How does randomization help ski rental? *(Hard)*

**Answer**: A **randomized** algorithm picks its buy-day from a probability distribution, so the adversary can no longer pinpoint "the day after you commit" — it must do well against your *expected* cost. The right distribution (buy-day probabilities weighted roughly like `(1 + 1/B)^day`, the continuous limit being an exponential density) achieves an expected competitive ratio of

```
e / (e − 1) ≈ 1.58,
```

against an **oblivious** adversary — a strict improvement over the deterministic `2`. And `e/(e−1)` is optimal: no randomized algorithm does better against an oblivious adversary (provable via [Yao's principle](#q9-state-yaos-principle-in-one-sentence-what-is-it-for-hard)). The lesson: randomization buys you roughly a `2 → 1.58` improvement precisely *because* it hides your decision from the adversary.

---

## Adversary Models & Randomization

### Q8: Oblivious vs adaptive adversaries — and against which does randomization help? *(Hard)*

**Answer**: Three standard models, in increasing power:

| Adversary | Sees the algorithm's random choices? | Builds `σ`… |
|-----------|--------------------------------------|-------------|
| **Oblivious** | No — only knows `ALG`'s code/distribution | Entirely **in advance** |
| **Adaptive online** | Yes — sees each random outcome as it happens | Request-by-request, and **must serve online too** |
| **Adaptive offline** | Yes — full access to all random outcomes | Adaptively, served by the **optimal offline** |

Key facts to state:

- **Randomization helps only against the oblivious adversary.** Against an *adaptive-offline* adversary, randomization gives no asymptotic advantage — the best randomized ratio equals the best *deterministic* ratio (Ben-David–Borodin–Karp–Wigderson–Wigderson). The adaptive-offline adversary is so strong that hidden coin flips are worthless.
- **For a deterministic algorithm, all three models coincide.** With no randomness, there is nothing for the adversary to "see," so an adaptive adversary learns nothing an oblivious one couldn't already compute by simulating the (deterministic) algorithm. The distinction only bites when the algorithm is randomized.

When a randomized bound like ski rental's `1.58` or paging's `H_k` is quoted, it is **against the oblivious adversary** — always name the model.

### Q9: State Yao's principle in one sentence. What is it for? *(Hard)*

**Answer**: **Yao's principle**: the expected cost of the *best randomized algorithm* against the *worst-case input* equals the cost of the *best deterministic algorithm* against the *worst-case input distribution* — i.e.

```
min_{rand ALG}  max_σ  E[cost]  =  max_{input distribution D}  min_{det ALG}  E_{σ∼D}[cost].
```

It's the von Neumann minimax theorem applied to the algorithm-vs-adversary game. **Its use**: to prove a **lower bound on every randomized algorithm**, you only need to (1) pick *one* hard input distribution `D` and (2) show that *no deterministic algorithm* does well in expectation on `D`. That's far easier than reasoning about arbitrary randomized algorithms directly — it's how the `e/(e−1)` ski-rental and `H_k` paging randomized lower bounds are established.

### Q10: Paging — what are the competitive ratios? *(Medium)*

**Answer**: The paging / caching problem: a cache of `k` pages serves a request stream; a miss (page not in cache) costs 1 and forces an eviction. Eviction policy is the online decision.

- **Deterministic**: LRU, FIFO, and the marking algorithms are all **`k`-competitive**, and **no deterministic policy beats `k`** — that's a tight lower bound. (LRU's *empirical* superiority over FIFO comes from locality, not the competitive ratio, which is identical.)
- **Randomized**: the **RANDOMIZED MARKING** algorithm is `2H_k`-competitive and the optimal randomized ratio is the **`k`-th harmonic number `H_k = 1 + 1/2 + ⋯ + 1/k ≈ ln k`** against an oblivious adversary — an exponential improvement, `k → ln k`.

The offline optimum here is **Belady's MIN** (evict the page used farthest in the future). See [../03-paging-and-caching-theory/interview.md](../03-paging-and-caching-theory/interview.md).

---

## Gotcha / Trick Questions

### Q11: "Is a 2-competitive algorithm within 2× on *typical* inputs?" *(Medium)*

**Answer**: **No — that's a worst-case guarantee, not an average-case prediction.** `2-competitive` means `ALG(σ) ≤ 2·OPT(σ)` for *every* `σ`, including the adversary's nastiest construction. On ordinary inputs it usually does far better — often near-optimal. The ratio is a *ceiling on how bad it can get*, never a claim about the typical case. (Same trap as the approximation-ratio gotcha — see [./middle.md](./middle.md).) If an interviewer wants average behavior, that's a different analysis entirely (e.g., competitive analysis under a stochastic input model).

### Q12: Competitive ratio vs approximation ratio — what's the difference? *(Medium)*

**Answer**: They share the form `ALG ≤ c·OPT` but bound **different limitations**:

- **Approximation ratio** measures the cost of **computational hardness**: the algorithm has the *whole input*, unlimited (well, polynomial) time isn't enough to find `OPT` because the problem is NP-hard, so it settles for `c·OPT`.
- **Competitive ratio** measures the cost of **missing information / no future**: the algorithm could compute `OPT` trivially *if* it saw the future, but it must decide online. An online algorithm may even have unlimited compute per step — its handicap is the *unknown future*, not intractability.

One line: **approximation = limited computation; competitive = limited information.** A problem can be easy offline (so no approximation issue) yet have a competitive ratio bounded away from 1.

### Q13: Competitive ratio vs regret — what's the difference? *(Hard)*

**Answer**: Both compare an online learner/algorithm to a benchmark, but the *form of the comparison* differs:

- **Competitive ratio** is **multiplicative** against the offline optimum *for that very sequence*: `ALG ≤ c·OPT(σ)`. Benchmark = best clairvoyant solution to `σ`.
- **Regret** (online learning) is **additive** against the best *fixed action in hindsight* from some comparator class: `regret = ALG − min_{fixed a} cost_a(σ)`, and one seeks `o(T)` regret (vanishing *average* regret). Benchmark = best single fixed strategy, not a fully adaptive optimum.

So competitive analysis asks "what *factor* worse than omniscient are you?"; regret asks "how much *additive* loss versus the best static choice?" They suit different problems — ski rental and paging are multiplicative/competitive; prediction-with-experts and bandits are additive/regret.

### Q14: Can the competitive ratio ever be less than 1? *(Easy)*

**Answer**: **No (for minimization).** `OPT` is the *offline optimum* — the best achievable cost on `σ` — so by definition `ALG(σ) ≥ OPT(σ)` for any algorithm, online or not. The ratio is `≥ 1`, with `1` attainable only if the online algorithm matches the clairvoyant optimum on every input (rare). If you ever derive `c < 1`, you've mis-defined `OPT` or flipped a min/max.

### Q15: An algorithm is 1.5-competitive on a sample of inputs you tested. Is it 1.5-competitive? *(Medium)*

**Answer**: **No — competitiveness is a proven worst-case bound over *all* `σ`, not an empirical observation.** Measuring `ALG/OPT ≤ 1.5` on a test suite says nothing about the adversarial input you didn't try. To *claim* `c`-competitive you need a proof that the bound holds universally (and to *refute* a claimed `c`, you exhibit one `σ` that violates it — that's exactly what the lower-bound adversary does in [Q6](#q6-show-no-deterministic-algorithm-beats-2-hard)).

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Online vs offline? | Online decides per-request without the future; offline sees all of `σ` |
| 2 | `c`-competitive (min) definition? | `ALG(σ) ≤ c·OPT(σ) + α` for all `σ` |
| 3 | What is `OPT`? | The **offline optimum** — best cost with full knowledge of `σ` |
| 4 | What is `α` for? | Absorbs startup/boundary effects (asymptotic vs strict) |
| 5 | Strictly `c`-competitive? | The bound holds with `α = 0` |
| 6 | Deterministic ski-rental ratio? | **2** (rent to break-even, then buy) |
| 7 | Lower bound for deterministic ski rental? | **2** — tight; adversary stops the day after you buy |
| 8 | Randomized ski-rental ratio? | `e/(e−1) ≈ 1.58` vs oblivious adversary |
| 9 | Deterministic paging (LRU/FIFO)? | **`k`-competitive**, tight |
| 10 | Randomized paging? | `H_k ≈ ln k`-competitive (oblivious) |
| 11 | Offline optimum for paging? | Belady's MIN (evict farthest-in-future) |
| 12 | Three adversary models? | Oblivious, adaptive-online, adaptive-offline |
| 13 | When does randomization help? | Only vs the **oblivious** adversary |
| 14 | Do models differ for deterministic ALG? | No — they coincide |
| 15 | Yao's principle is used for? | Randomized **lower bounds** (pick one hard distribution) |
| 16 | Competitive vs approximation? | Limited *information* vs limited *computation* |
| 17 | Competitive vs regret? | Multiplicative vs additive comparison |
| 18 | Can the ratio be `< 1`? | No — `ALG ≥ OPT` always |

---

## Common Mistakes

1. **Treating the ratio as average-case.** `c`-competitive is a worst-case ceiling over all `σ`, including adversarial inputs — not the typical `ALG/OPT`.
2. **Misdefining `OPT` as another online player.** `OPT` is the *offline*, clairvoyant optimum for the exact sequence `σ`. Forgetting this makes ratios look impossibly small.
3. **Confusing competitive with approximation ratio.** Online/no-future handicap, not NP-hardness. A problem trivial offline can still have a nontrivial competitive ratio.
4. **Claiming randomization beats the adaptive-offline adversary.** It helps only against the **oblivious** adversary; against adaptive-offline, randomized = deterministic.
5. **Quoting a randomized ratio without the adversary model.** `1.58` and `H_k` are *oblivious-adversary* bounds — always say so.
6. **Forgetting the additive `α`.** Dropping it conflates strict and asymptotic competitiveness and can over-penalize short sequences.
7. **Proving a lower bound for one algorithm only.** The deterministic ski-rental bound must hold against *every* algorithm — that's why the adversary reacts to the buy-day `k`.

---

## Tips & Summary

- **Lead with the definition that disambiguates**: "`ALG(σ) ≤ c·OPT(σ) + α` for *all* `σ`, where `OPT` is the *offline* optimum." Stating "offline optimum" and "all `σ`" upfront preempts the two most common misunderstandings.
- **Memorize the canonical numbers**: ski rental — deterministic **2** (tight), randomized **`e/(e−1) ≈ 1.58`**; paging — deterministic **`k`** (tight), randomized **`H_k ≈ ln k`**. These are the constants interviewers expect on sight.
- **For ski rental's lower bound, narrate the adversary**: a deterministic algorithm is pinned by its buy-day `k`, and the adversary stops the season the day after you commit — buy early and the season ends, buy late and you've over-rented; break-even is the optimal hedge.
- **Always name the adversary model** when quoting a randomized ratio, and remember the two structural facts: randomization helps *only* vs oblivious, and the models *coincide* for deterministic algorithms.
- **Reach for Yao's principle** the moment you need a randomized *lower* bound — pick one hard input distribution and beat every *deterministic* algorithm on it.
- **Separate the three "ratio" notions** crisply: competitive (online, multiplicative, vs offline-OPT), approximation (NP-hardness, multiplicative, vs OPT), regret (online learning, additive, vs best fixed action). Mixing them is the fastest way to look shaky.

**Related:** [Ski Rental & Rent-or-Buy — Interview](../02-ski-rental-and-rent-or-buy/interview.md) · [Paging & Caching Theory — Interview](../03-paging-and-caching-theory/interview.md) · [Competitive Analysis — Middle](./middle.md)

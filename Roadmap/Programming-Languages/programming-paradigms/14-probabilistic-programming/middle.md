# Probabilistic Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Probabilistic Programming
> *Bayes' rule is one line: posterior ∝ prior × likelihood. A PPL is the machine that evaluates that line for models too big to do by hand — you write the generative story, it computes the proportionality.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Bayes' Rule, Plainly](#bayes-rule-plainly)
4. [The Generative-Model Mindset](#the-generative-model-mindset)
5. [Latent vs Observed Variables](#latent-vs-observed-variables)
6. [What "Inference" Actually Computes](#what-inference-actually-computes)
7. [Monte Carlo: Answering With Samples](#monte-carlo-answering-with-samples)
8. [A Full Model: Bayesian Linear Regression](#a-full-model-bayesian-linear-regression)
9. [Posterior vs Point Estimate](#posterior-vs-point-estimate)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it work, and how do I build a real model?**

At the junior level you saw the shape: a probabilistic program is a generative story run backwards, built from `sample` and `observe`, returning a posterior distribution. This level makes the machinery precise. We name the engine — **Bayes' rule** — and show that it's genuinely one short equation. We sharpen the **generative-model mindset** so you can write your own models rather than copy the coin example. We pin down what **inference** actually computes and why it's the expensive step. And we build a model with real teeth: **Bayesian linear regression**, end to end in PyMC, where every coefficient comes back as a distribution.

The throughline: a PPL lets you stay in the comfortable world of *writing forwards models* — "here's how I think the data was produced" — while it handles the uncomfortable world of *inverting them*. Your job is to tell a good generative story. The PPL's job is the calculus and the sampling.

> **The mindset shift:** stop fitting a model to get *the* parameters. Start describing how data is generated, then ask the engine for the full distribution over parameters that's *consistent with the data you saw*.

---

## Prerequisites

- **Required:** The [junior level](junior.md) — `sample`/`observe`, prior/posterior, "the output is a distribution," and the coin example.
- **Required:** Comfortable Python and `numpy`; you can read a PyMC `with pm.Model()` block.
- **Helpful:** You've fit a linear regression once (in scikit-learn, Excel, anything) and know it produces slope/intercept coefficients.
- **Not required:** Calculus or measure theory. We keep notation to the single Bayes equation and explain it in words.

---

## Bayes' Rule, Plainly

Every probabilistic program is powered by one equation. Don't let the symbols scare you — read it as English.

```
                 P(data | θ)  ×  P(θ)
  P(θ | data)  = ─────────────────────
                       P(data)

  posterior   =   likelihood × prior   /   evidence
```

Here `θ` ("theta") is the unknown you want — the coin's bias, a regression's slope, anything. Translated:

- **`P(θ)` — the prior.** What you believed about `θ` *before* seeing data.
- **`P(data | θ)` — the likelihood.** If `θ` were *this* value, how probable is the data you actually observed? (For the coin: if the bias were 0.7, how likely is 7-of-10 heads?)
- **`P(θ | data)` — the posterior.** What you believe about `θ` *after* folding in the data. The answer.
- **`P(data)` — the evidence.** A normalizing constant that makes the posterior sum to 1. It's the sum of `likelihood × prior` over *all* possible `θ`.

The version you'll actually use drops the denominator, because it doesn't depend on `θ` — it's just a scaling factor:

```
  posterior  ∝  likelihood × prior          ("∝" means "proportional to")
```

In words: **your updated belief is your prior belief reweighted by how well each value explains the data.** A value of `θ` that explains the data well *and* was plausible a priori gets a high posterior. A value that explains the data poorly gets crushed, even if the prior liked it. That reweighting is the entire content of Bayesian inference.

So why do we need a whole runtime if it's one multiplication? Because of `P(data)` — the evidence. Computing it means summing `likelihood × prior` over *every* possible value of `θ`. For one parameter on `[0,1]` that's a doable integral. For a model with 50 parameters it's a 50-dimensional integral that no human and no exact formula can evaluate. **That intractable normalization is why inference is hard, and why PPLs exist** — they *approximate* the posterior without ever computing `P(data)` directly (the rejection sampler from the junior level sidestepped it by working with ratios).

> **Key insight:** the math of "what's the answer" is trivial (one product). The math of "*normalize* the answer so it's a real probability distribution" is what's intractable — and that's the problem a PPL solves for you.

---

## The Generative-Model Mindset

To write a probabilistic program, you stop asking "what formula fits my data?" and start asking "**what process produced my data?**" You describe that process forwards, as if you were a simulator, introducing a `sample` wherever something is unknown and an `observe` wherever you have data.

Think of it as writing the data's *origin story*:

1. **Nature drew some hidden parameters** from priors. (The coin *has* a bias; you don't know it → `sample`.)
2. **Given those parameters, nature generated the data** through some distribution. (Each flip is Bernoulli(`bias`) → the likelihood.)
3. **You only got to see the data.** (The flips → `observe`.)

Your program states steps 1 and 2 forwards; the PPL infers backwards to step 1's distribution given step 3. The skill is decomposing a real phenomenon into this shape. A few patterns recur:

| Phenomenon | Generative story (what to write) |
|---|---|
| Click-through rate | `rate ~ Beta(...)` (prior); `clicks ~ Binomial(rate, impressions)` (observed) |
| Sales over time | `trend, seasonality ~ priors`; `sales ~ Normal(trend + seasonality, noise)` (observed) |
| Test scores by school | each school's `mean ~ Normal(global_mean, ...)`; `scores ~ Normal(school_mean, ...)` |
| A measurement with noise | `true_value ~ prior`; `reading ~ Normal(true_value, sensor_noise)` (observed) |

Notice the **priors encode assumptions you must own**. Choosing `rate ~ Beta(1,1)` says "any click rate is equally plausible"; choosing `Beta(2,20)` says "I expect a low rate, around 9%." Neither is right or wrong in the abstract — but you are *stating a belief*, and you'll have to defend it. (The senior and professional levels treat priors-as-assumptions seriously.) The discipline of the generative mindset is that every assumption becomes an explicit line of code, not a hidden default.

> **Key insight:** writing a probabilistic program is *forward storytelling*. If you can simulate how the data came to be — sampling the unknowns, then generating observations from them — you can hand that exact story to a PPL and get the inversion for free.

---

## Latent vs Observed Variables

A model's random variables split into two kinds, and keeping them straight is most of the battle.

- **Observed variables** are the data — values you measured and are conditioning on. In PyMC, a variable is observed precisely when you pass `observed=...`. These are *fixed* during inference; the model must explain them.
- **Latent (hidden) variables** are the unknowns — what you want to infer. They are *free* during inference; the engine explores their possible values. They have priors but no data.

```python
with pm.Model() as m:
    bias  = pm.Beta("bias", 2, 2)                       # LATENT: no data, has a prior — we infer it
    flips = pm.Bernoulli("flips", p=bias, observed=data) # OBSERVED: pinned to data via observed=
```

The same variable can be latent in one model and observed in another — it depends entirely on whether you *have* its data. That's the flexibility: a sensor's true value is latent (you infer it); if you later get a calibrated ground-truth reading, it becomes observed.

Latent variables also come in flavors you'll meet later: **global parameters** (one bias for the whole dataset), **local/per-item parameters** (one true score *per* student), and **hierarchical** ones (per-group parameters that themselves share a prior — the backbone of the forecasting and pooling models at the professional level). For now, the binary that matters: *does this variable have data attached?* Yes → observed, fixed. No → latent, inferred.

> **The test:** if you can write `observed=` next to it, it's data. If it only has a prior and you want to learn it, it's a latent unknown. Inference is the act of computing the joint distribution over all latents, given all observeds.

---

## What "Inference" Actually Computes

"Inference" is one word for a precise task: **given the observed data, compute the joint posterior distribution over all latent variables.** For the coin, that's a distribution over one number (`bias`). For the regression below, it's a *joint* distribution over slope, intercept, and noise together — including how they correlate.

Why is it the expensive step? Recall Bayes' rule needs the evidence `P(data)`, an integral over the entire latent space. With `k` latent parameters, the posterior lives in a `k`-dimensional space, and characterizing it means understanding a `k`-dimensional surface. You can't enumerate it (continuous, infinite), and you usually can't solve it in closed form (only special "conjugate" prior/likelihood pairs have neat formulas). So PPLs do one of two things:

1. **Sampling methods (MCMC):** don't compute the posterior's formula — *draw samples from it*. Collect thousands of latent values distributed according to the posterior, and use that pile to answer any question. This is what `pm.sample()` does. (The junior rejection sampler was the toy version; real MCMC is far more efficient — see the [senior level](senior.md).)
2. **Variational inference (VI):** don't sample — *approximate* the posterior with a simpler distribution (say, a Gaussian) and optimize its parameters to fit. Faster, but approximate. (Also senior level.)

Either way, the cost is real: inference on a nontrivial model can take seconds to hours, versus the microseconds a forwards computation takes. **This asymmetry — cheap to simulate forwards, expensive to invert backwards — is the defining engineering fact of probabilistic programming.** You're buying principled uncertainty with compute.

> **Key insight:** inference computes the *joint* posterior over all unknowns at once, capturing not just each parameter's spread but how they trade off against each other. That's why a PPL beats fitting parameters one at a time.

---

## Monte Carlo: Answering With Samples

Since the posterior usually can't be written as a formula, PPLs represent it as a **bag of samples** — thousands of draws from the posterior. This is the **Monte Carlo** idea: you can answer almost any question about a distribution by drawing samples and *counting*, instead of integrating.

Suppose inference handed you 4000 posterior draws of a coin's `bias`. Every question becomes a one-liner over that array:

```python
draws = posterior.posterior["bias"].values.flatten()   # ~4000 samples from the posterior

draws.mean()                       # point estimate (posterior mean)
np.percentile(draws, [2.5, 97.5])  # 95% credible interval
(draws > 0.5).mean()               # P(coin favors heads) — just the FRACTION of draws above 0.5
(draws > 0.6).mean()               # P(bias exceeds 60%) — count and divide
```

That last trick is the quiet superpower. "What's the probability the bias exceeds 60%?" would be an integral on paper; with samples it's `(draws > 0.6).mean()` — count how many draws clear the bar, divide by the total. Any question you can phrase about the parameters, you answer by reducing over the sample bag. This is why PPL output is so flexible: the posterior-as-samples can be queried for means, intervals, probabilities of arbitrary statements, or pushed forward to make predictions.

The catch: samples are an *approximation*, accurate only if you have enough of them and they genuinely come from the posterior. "Did the sampler actually converge to the right distribution?" is the diagnostic question that dominates the [senior level](senior.md) (R-hat, divergences, effective sample size). For now, trust that more good samples → a sharper, more reliable picture.

> **Key insight:** Monte Carlo turns hard integrals into easy counting. The posterior is a bag of samples; every answer is a reduction (mean, percentile, fraction) over that bag.

---

## A Full Model: Bayesian Linear Regression

Time for a real model. Ordinary linear regression fits `y = α + βx` and returns single numbers for slope `β` and intercept `α`. The Bayesian version returns a **distribution** for each — so you learn not just the best-fit line but *how uncertain every coefficient is*, which is invaluable when data is scarce or noisy.

The generative story: "there's a true line (`α`, `β`); each observed `y` is that line plus Gaussian noise (`σ`)." We `sample` the three unknowns from priors and `observe` the `y` values.

```python
import pymc as pm
import numpy as np

# Synthetic data: true line y = 2 + 3x, plus noise.
rng = np.random.default_rng(0)
x = np.linspace(0, 10, 50)
y = 2.0 + 3.0 * x + rng.normal(0, 2.0, size=50)

with pm.Model() as linreg:
    # PRIORS — sample the unknowns. Weakly informative: "probably modest values, but open-minded."
    alpha = pm.Normal("alpha", mu=0, sigma=10)     # intercept (latent)
    beta  = pm.Normal("beta",  mu=0, sigma=10)     # slope (latent)
    sigma = pm.HalfNormal("sigma", sigma=5)        # noise std — must be positive, so HalfNormal

    mu = alpha + beta * x                            # the deterministic line for each x

    # LIKELIHOOD + OBSERVE — each y is Normal around the line; pinned to the real y via observed=.
    pm.Normal("y_obs", mu=mu, sigma=sigma, observed=y)

    # INFERENCE — draw the JOINT posterior over (alpha, beta, sigma).
    idata = pm.sample(2000, tune=1000, progressbar=False)

# Each coefficient is a DISTRIBUTION, not a number.
print(pm.summary(idata, var_names=["alpha", "beta", "sigma"]))
#         mean   sd   hdi_3%  hdi_97%   r_hat
# alpha   2.1   0.55   1.1     3.2      1.00
# beta    2.98  0.09   2.81    3.15     1.00
# sigma   1.95  0.20   1.59    2.34     1.00
```

Read the result like a senior would:

- **`beta` mean ≈ 2.98** recovers the true slope (3.0), and its **`sd ≈ 0.09`** plus the interval `[2.81, 3.15]` tell you how *precisely* — the data nailed the slope down tightly.
- **`alpha`** is much fuzzier (`sd ≈ 0.55`, interval `[1.1, 3.2]`): intercepts are harder to pin down, and the model *honestly reports that*. A point-estimate regression would have hidden it behind a single number.
- **`sigma ≈ 1.95`** recovers the noise level (we injected 2.0) — the model even infers how noisy the world is.
- **`r_hat = 1.00`** is the convergence check (senior level): ≈1.0 means the sampler is trustworthy.

You can now ask Monte Carlo questions directly: "what's `P(slope > 2.9)`?" → `(idata.posterior["beta"].values > 2.9).mean()`. And you can **predict with uncertainty**: pushing new `x` values through the *distribution* of lines gives a *distribution* of predicted `y` — a forecast with error bars baked in, not bolted on.

> **What changed vs scikit-learn:** same model shape, but every coefficient is a distribution and predictions carry uncertainty. That's the trade you make: more compute, in exchange for honesty about what the data does and doesn't tell you.

---

## Posterior vs Point Estimate

It's worth stating sharply, because it's *the* reason to reach for a PPL. A point estimate answers "what's the value?" with one number. A posterior answers "what's the value, and how sure should I be?" with a shape.

| | Point estimate | Posterior |
|---|---|---|
| **Output** | one number per parameter | a distribution per parameter |
| **Uncertainty** | hidden (or a separate, often-misread "p-value") | explicit — the spread *is* the uncertainty |
| **Small data** | overconfident; no signal that you have little data | self-correcting — sparse data → wide posterior |
| **Correlations** | usually ignored | captured in the joint posterior |
| **Decisions** | "B beat A" (by how much? is it noise?) | "92% chance B beats A by >1%" — actionable |
| **Cost** | cheap (a fit) | expensive (inference) |

The point estimate isn't *wrong* — it's the *peak* of the posterior, and you can always extract it (`draws.mean()`). What it lacks is everything *around* the peak. With 10 coin flips, the point estimate `0.7` and the posterior centered at 0.67-but-spanning-0.4-to-0.88 *agree on the best guess* — but only the posterior tells you the best guess is barely better than a coin flip. When data is abundant, the posterior narrows until it's nearly a point and the two converge. When data is scarce — exactly when overconfidence is most dangerous — they diverge most, and the posterior is the one telling the truth.

> **Key insight:** a posterior *contains* the point estimate (its peak) plus the uncertainty around it. You can always throw uncertainty away; you can't recover it after the fact. Pay for the posterior when the uncertainty would change your decision.

---

## Common Mistakes

- **Treating the prior as an afterthought.** The prior is a real assumption that shapes the posterior, especially with little data. Slapping on a default without thinking — or, conversely, using an absurdly tight prior that overrides the data — both silently distort results. State priors deliberately and check sensitivity.
- **Forgetting `observed=`.** Without it, PyMC treats the variable as latent and *simulates* it forwards — you get your prior back, not a posterior. The single most common "why did nothing happen?" bug.
- **Reading the posterior mean as the whole answer.** Collapsing a distribution to its mean throws away the uncertainty you paid for. If you only ever use `.mean()`, you probably didn't need a PPL.
- **Ignoring that parameters correlate.** Slope and intercept often trade off; the *joint* posterior captures this, but looking at each marginal alone can mislead. Plot pairs when decisions depend on combinations.
- **Assuming more samples fixes a bad model.** Samples reduce *Monte Carlo* error, not *modeling* error. If the generative story is wrong (wrong likelihood, missing variable), a million samples just give you a precise wrong answer. Convergence ≠ correctness.
- **Using a Bayesian model where a formula would do.** If you have abundant data, no need for uncertainty, and a closed-form estimator, the inference cost buys you little. PPLs earn their keep with limited data, structured/hierarchical problems, and decisions that hinge on uncertainty.

---

## Summary

A probabilistic program is powered by **Bayes' rule** — `posterior ∝ likelihood × prior` — which says your updated belief is your prior reweighted by how well each value explains the data. That product is trivial; what's hard is *normalizing* it (the evidence integral), and dodging that intractability is exactly what a PPL's **inference** engine does for you. To write a model you adopt the **generative mindset**: tell the data's origin story forwards, `sample`-ing the unknowns from priors and `observe`-ing the data, where every variable is either **latent** (no data, inferred) or **observed** (pinned via `observed=`). Inference computes the **joint posterior** over all latents — the expensive, defining step, since simulating forwards is cheap but inverting is not. PPLs represent that posterior as a **bag of Monte Carlo samples**, turning hard integrals into easy counting: means, credible intervals, and the probability of any statement are all reductions over the sample bag. You built **Bayesian linear regression** in PyMC and watched every coefficient come back as a distribution — recovering not just the best-fit line but how *certain* each part of it is. That's the core payoff over a point estimate: a posterior *contains* the best guess *and* the honesty about how good it is. The senior level tackles the part we kept waving at — *why inference is genuinely hard, and how MCMC and variational inference actually work*.

---

## Further Reading

- *Statistical Rethinking* (Richard McElreath), Ch. 2–4 — Bayes' rule, the generative mindset, and linear regression done the Bayesian way; the gold standard for intuition.
- *Bayesian Methods for Hackers* (Davidson-Pilon), Ch. 2–3 — more PyMC models, code-first.
- PyMC's *Linear Regression* example gallery — the model above with plots and posterior-predictive checks.
- Michael Betancourt, *Towards A Principled Bayesian Workflow* — how practitioners actually build and check models (a preview of the senior/professional levels).

---

## Related Topics

- [`junior.md`](junior.md) — the intuition: forwards vs backwards, `sample`/`observe`, the coin example, a hand-rolled sampler.
- [`senior.md`](senior.md) — why inference is hard: MCMC (Metropolis/HMC/NUTS) vs variational inference, R-hat and divergences, when a PPL is overkill.
- [`professional.md`](professional.md) — PPLs in production: A/B testing, hierarchical forecasting, inference at scale, defending priors.
- [03 — Declarative Programming](../03-declarative-programming/) — declare the model, let the engine infer; a PPL is declarative statistics.
- [13 — Constraint Programming](../13-constraint-programming/) — the sibling paradigm: declare constraints, a solver searches a feasible space.

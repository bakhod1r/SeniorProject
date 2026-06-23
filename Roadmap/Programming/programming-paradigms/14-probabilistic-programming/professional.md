# Probabilistic Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Probabilistic Programming
> *In production, a probabilistic model is a decision engine, not a notebook curiosity. The hard parts move from "can I get a posterior" to "can I defend the priors, scale the inference, reproduce the run, and turn the distribution into an action someone bets money on."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Landscape: Which PPL, and Why](#the-landscape-which-ppl-and-why)
3. [A/B Testing & Decisions Under Uncertainty](#ab-testing--decisions-under-uncertainty)
4. [Forecasting with Hierarchical Models](#forecasting-with-hierarchical-models)
5. [Risk, Insurance, Finance](#risk-insurance-finance)
6. [Sensor Fusion & Scientific Modeling](#sensor-fusion--scientific-modeling)
7. [Inference at Scale](#inference-at-scale)
8. [Probabilistic ML & Deep PPLs](#probabilistic-ml--deep-ppls)
9. [The Engineering Reality](#the-engineering-reality)
10. [Relation to Declarative Programming](#relation-to-declarative-programming)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Where are PPLs actually used, and what does productionizing one really take?**

The previous levels built the machine and taught you to distrust it correctly. This level is about *deployment*: the concrete domains where probabilistic programming earns its keep, the tooling the industry actually uses, how inference is made to scale past a laptop, and the unglamorous engineering reality of running a Bayesian model where a wrong answer costs money. The shift here is from "I can fit a model" to "I own a probabilistic system that other people depend on" — which means defending priors as design decisions, making stochastic inference reproducible, validating models against reality continuously, and turning posteriors into decisions a business will act on.

A recurring theme: the model is the smallest part of the work. The priors are assumptions you'll defend in a review; the inference is a compute budget you'll fight for; the reproducibility is a discipline you'll enforce; and the posterior is only useful once it's wired into a loss function and a decision. We'll ground each domain in what's specifically *probabilistic* about it — why a point estimate fails there and a distribution wins.

> **The mindset shift:** stop thinking of the model as the deliverable. The deliverable is a *defensible, reproducible decision under uncertainty* — and the model is one auditable component of it.

---

## The Landscape: Which PPL, and Why

The ecosystem is mature; choosing well matters because they trade off expressiveness, speed, and integration differently.

| PPL | Built on / language | Strengths | Reach for it when |
|---|---|---|---|
| **Stan** | C++ core; R/Python/CLI front-ends | battle-tested NUTS, gold-standard diagnostics, huge stats literature | rigorous statistical work, papers, where correctness > flexibility |
| **PyMC** | Python, PyTensor backend | Pythonic, great ergonomics, strong viz (ArviZ) | the default for Python data teams; analysis and moderate-scale models |
| **NumPyro** | JAX | NUTS that's *fast* (JIT + GPU/TPU), vectorized | large models/data needing speed; same API feel as Pyro |
| **Pyro** | PyTorch | deep PPL — VI-first, neural nets inside models | probabilistic deep learning, custom variational inference |
| **TensorFlow Probability** | TensorFlow | production ML integration, distributions toolkit | TF shops; embedding probabilistic layers in ML pipelines |
| **Turing.jl** | Julia | composable, fast, mixes inference algorithms | Julia ecosystem; research flexibility |

The split that matters most: **Stan and PyMC** are the *statistician's* tools — MCMC-first, diagnostics-rich, optimized for getting a *correct, well-characterized* posterior on small-to-moderate problems. **NumPyro, Pyro, and TFP** are the *ML engineer's* tools — built on autodiff frameworks (JAX, PyTorch, TF), so they ride GPUs, scale via VI and mini-batching, and embed neural networks inside generative models. A common production stack uses PyMC/Stan for the careful offline model and a JAX/PyTorch-based PPL when inference must scale or live next to deep learning.

> **Key insight:** the choice tracks your bottleneck. Correctness and diagnostics-heavy analysis → Stan/PyMC. Scale, GPUs, or deep components → NumPyro/Pyro/TFP. They share the NUTS/VI core; they differ in the engineering envelope around it.

---

## A/B Testing & Decisions Under Uncertainty

The flagship business use. Classic frequentist A/B testing reports "p < 0.05, B wins" — a binary verdict that answers the wrong question and is routinely misread. A Bayesian A/B test instead returns the **posterior over each variant's conversion rate** and lets you ask the questions a product manager actually has.

```python
import pymc as pm

# A: 1100 conversions / 20000 visitors;  B: 1200 / 20000
with pm.Model() as ab:
    rate_a = pm.Beta("rate_a", 1, 1)                          # uninformative prior on each rate
    rate_b = pm.Beta("rate_b", 1, 1)
    pm.Binomial("obs_a", n=20000, p=rate_a, observed=1100)    # observe the real counts
    pm.Binomial("obs_b", n=20000, p=rate_b, observed=1200)
    lift = pm.Deterministic("lift", rate_b - rate_a)          # the quantity we actually care about
    idata = pm.sample(3000, tune=1000, progressbar=False)

draws = idata.posterior
p_b_better = (draws["lift"].values > 0).mean()               # P(B is better than A)
p_meaningful = (draws["lift"].values > 0.005).mean()         # P(B beats A by >0.5pp) — the business bar
```

What you get that a p-value cannot:

- **`P(B beats A)` directly** — "87% probable B is better," not a threshold ritual.
- **`P(lift exceeds a business-meaningful margin)`** — because "statistically significant" ≠ "worth shipping." You bake the decision bar into the question.
- **Expected loss / decision-theoretic stopping.** Combine the posterior with a *loss function* (cost of shipping a worse variant vs cost of more testing) to decide *optimally* whether to ship, kill, or keep testing — and to stop early without the peeking problems that plague fixed-horizon frequentist tests.
- **Coherent multi-armed and sequential variants.** The same machinery extends to many arms and to bandits that allocate traffic toward winners as evidence accrues.

This is the purest expression of the paradigm's value: the output is a *distribution*, the decision is a function of that distribution and a business loss, and uncertainty is handled honestly instead of hidden behind a significance star.

> **Key insight:** Bayesian A/B testing replaces "is the difference significant?" with "what's the probability the difference is big enough to matter, and what's the expected cost of each action?" — which is the question the business was always actually asking.

---

## Forecasting with Hierarchical Models

Forecasting is where **hierarchical (multilevel) models** — the Bayesian crown jewel — shine. The setup: you forecast many related series at once (sales per store, demand per SKU, latency per region). Some have lots of history; many have almost none. A per-series independent fit overfits the sparse ones; a single pooled fit ignores their differences. Hierarchy threads the needle.

```python
with pm.Model() as hier:
    # GLOBAL prior — what stores look like on average, and how much they vary.
    mu_global    = pm.Normal("mu_global", 0, 1)
    sigma_store  = pm.HalfNormal("sigma_store", 1)
    # PER-STORE effects drawn from the global prior — they SHARE statistical strength.
    store_effect = pm.Normal("store_effect", mu_global, sigma_store, dims="store")
    # ... seasonality, trend per store ...
    pm.Normal("sales", mu=store_effect[store_idx] + trend, sigma=noise, observed=sales)
    idata = pm.sample()
```

The magic is **partial pooling**: each store's estimate is automatically a *compromise* between its own data and the global average, weighted by how much data the store has. Data-rich stores lean on their own history; data-poor stores are "shrunk" toward the population, borrowing strength from their siblings. New stores with no history get a sensible forecast (the global prior) instead of garbage or a manual fallback. And every forecast is a **distribution** — error bands that widen honestly for uncertain series, which feeds directly into inventory and capacity decisions where the *tail* (the bad case) is what you plan against.

This is also why tools like **Prophet** and the structural-time-series models in TFP/PyMC are popular: they're hierarchical Bayesian forecasters that decompose trend, seasonality, and holidays into interpretable, uncertainty-bearing components — far more defensible to a stakeholder than a black-box point forecast.

> **Key insight:** hierarchical models let many weak signals reinforce each other through partial pooling — sparse series borrow strength from the population, every forecast carries calibrated error bands, and new entities get a principled cold-start. No point-estimate pipeline does this cleanly.

---

## Risk, Insurance, Finance

These industries are *built* on tail risk, so a distribution-valued answer isn't a luxury — it's the product.

- **Insurance / actuarial.** Claim frequency and severity are modeled hierarchically (by policy class, region, risk factor); the posterior predictive over total claims drives reserves and pricing. The whole question is "how bad could the bad year be?" — a tail quantile of a distribution, not a mean.
- **Finance / quant risk.** Value-at-Risk and Expected Shortfall *are* posterior tail quantiles. Bayesian methods naturally express parameter uncertainty (you don't *know* the volatility — you have a posterior over it), which feeds through to wider, more honest risk estimates than plugging in a single estimated parameter.
- **Credit / fraud.** Posterior probabilities of default or fraud, combined with the asymmetric loss of false positives vs false negatives, yield decision thresholds that are *optimal given the costs* rather than tuned by hand.

The common thread: the decision is a function of the *whole distribution*, especially its tail, and a point estimate that throws the tail away is not just imprecise — it's the specific thing that blows up. Probabilistic programming makes parameter uncertainty first-class, so it propagates into the risk number instead of being assumed away.

> **Key insight:** in risk domains the tail *is* the deliverable. PPLs propagate parameter uncertainty into the tail of the predictive distribution, so the risk estimate accounts for "we don't perfectly know the parameters" — exactly the uncertainty a plug-in point estimate silently drops.

---

## Sensor Fusion & Scientific Modeling

- **Sensor fusion.** Combining noisy, complementary sensors (GPS + IMU + odometry → position) is inference: each sensor is a noisy `observe` of a latent true state, and the posterior is the fused estimate *with* uncertainty. The Kalman filter — ubiquitous in robotics, aerospace, navigation — is exactly Bayesian inference for linear-Gaussian state-space models; PPLs generalize it to nonlinear, non-Gaussian cases. The uncertainty output isn't decoration: a self-driving stack *needs* "I'm at X ± 2m" to decide whether it's safe to act.
- **Scientific modeling.** Science is the native home of Bayesian inference: epidemiology (infection rates and R₀ with credible intervals that drive policy), pharmacometrics (dose-response with patient-level hierarchy), cosmology and physics (parameter estimation from noisy instruments), ecology (population models from sparse field data). Here the *interpretable generative model* and *honest uncertainty* are the entire point — a paper reporting a point estimate without an interval wouldn't pass review.

> **Key insight:** anywhere you estimate a hidden state or scientific quantity from noisy, partial measurements, you're doing Bayesian inference whether you call it that or not. A PPL lets you write the measurement model directly and get the fused, uncertainty-bearing estimate for free.

---

## Inference at Scale

The senior level flagged the cost; production must defeat it. The toolkit:

- **Variational inference instead of MCMC.** When data is large or inference must be repeated, VI (ADVI, or a custom guide in Pyro) turns inference into stochastic optimization — mini-batchable, GPU-friendly, orders of magnitude faster. You accept approximate (often over-confident) posteriors, and validate against MCMC on a subset.
- **GPU/TPU acceleration.** JAX-based **NumPyro** runs NUTS *and* VI on accelerators with JIT compilation, often 10–100× faster than CPU PyMC/Stan on the same model. For many teams this alone makes MCMC viable at production scale.
- **Mini-batch / subsampling.** Stochastic VI and subsampled gradients let inference touch only a slice of the data per step — essential past memory limits.
- **Amortized inference.** Train a neural network *once* to map data → approximate posterior, then get inference in a single forward pass per new input (the basis of variational autoencoders and of real-time probabilistic services). Up-front training cost, near-zero per-query cost — the right shape when you infer per request.
- **Marginalization & reparameterization.** Often the biggest speedup is *modeling*: marginalize out discrete latents (NUTS needs differentiability), use non-centered parameterizations to fix funnel geometry, and reduce parameter count. A well-parameterized small model beats a badly-parameterized big one.

> **Key insight:** scaling inference is a portfolio: swap MCMC→VI for throughput, move to JAX/GPU for raw speed, mini-batch for large data, amortize for per-request latency — and remember that reparameterizing the model is frequently the cheapest, biggest win of all.

---

## Probabilistic ML & Deep PPLs

The frontier is the merger of probabilistic programming with deep learning. Deep PPLs (**Pyro**, **NumPyro**, **TFP**) let you put neural networks *inside* generative models, getting the expressiveness of deep nets *and* calibrated uncertainty:

- **Bayesian neural networks** place priors over weights, yielding predictions with uncertainty — crucial for safety-critical ML that must say "I don't know" on out-of-distribution inputs instead of confidently hallucinating.
- **Variational autoencoders (VAEs)** are probabilistic programs: an encoder amortizes inference of a latent code, a decoder is the generative model — trained end-to-end with VI.
- **Deep state-space / structural models** fuse neural components with probabilistic time-series structure for forecasting with uncertainty.

The honest caveat: inference for these is *hard* and almost always variational (so uncertainty is approximate and often under-stated), and Bayesian deep learning remains an area where calibration is genuinely difficult. It's powerful where you need both representation learning and uncertainty — and overkill where a plain neural net's point prediction suffices.

> **Key insight:** deep PPLs marry neural expressiveness with probabilistic uncertainty, but inference is variational and calibration is hard. Use them when you genuinely need *both* learned representations and honest uncertainty — not as a default upgrade to every model.

---

## The Engineering Reality

Productionizing a Bayesian model surfaces concerns that never appear in a notebook:

- **Priors are assumptions you must defend.** A prior is a design decision that materially shapes results on small data. Document each one, justify it (domain knowledge, prior data, regulatory constraint), and run **sensitivity analysis** — does the conclusion hold under reasonable alternative priors? In regulated domains (insurance, pharma, credit) you'll defend priors to auditors. "I used the default" is not an answer.
- **Reproducibility of stochastic inference.** MCMC is random; reproducibility means pinning **seeds**, library versions, and the exact model and data snapshot. Version the model code, the priors, the data hash, and the inference config together. A posterior you can't regenerate is a liability — and "the numbers shifted between runs" is either a seed problem or a convergence problem, and you must know which.
- **Continuous validation.** Models drift as the world changes. Schedule **posterior-predictive checks** and held-out validation in CI/monitoring; alert when the model can no longer reproduce recent data. Convergence diagnostics (R-hat, divergences) become *automated gates*, not manual glances.
- **Latency and serving.** MCMC is offline; serving usually means caching a posterior, using VI/amortized inference for per-request latency, or precomputing decisions. Decide up front whether inference is batch (nightly refit) or online.
- **From posterior to decision.** The posterior is an input, not the output. Pair it with a **loss/utility function** and emit a *decision* (ship/hold, reserve amount, threshold). Stakeholders consume the decision and a credible interval — not a trace plot.
- **Communicating uncertainty.** A huge, underrated skill: turning "95% credible interval [a, b]" and "P(X) = 0.8" into something a non-statistician trusts and acts on, without false precision or false reassurance.

> **Key insight:** the model is maybe 20% of a production Bayesian system. The other 80% is defending priors, pinning reproducibility, automating validation gates, fitting a latency budget, and converting distributions into decisions people will stake outcomes on.

---

## Relation to Declarative Programming

Probabilistic programming is a member of the **declarative** family ([03 — Declarative Programming](../03-declarative-programming/)), and seeing the kinship clarifies the whole paradigm. In declarative programming you state *what* you want and a solver figures out *how*. A PPL is exactly that, specialized to statistics:

- **You declare** the generative model — the random variables, priors, and how data arises. You do *not* write the inference algorithm.
- **The engine solves** — NUTS or VI inverts your model to produce the posterior, the way a SQL planner produces an execution plan or a constraint solver searches a feasible region.

The analogy runs deep and is worth carrying: **SQL** : query planner :: **PPL** : inference engine :: **constraint solver** ([13](../13-constraint-programming/)) : search. In each, you've climbed up the imperative ↔ declarative dial — trading control over the *how* for the ability to state the *what* concisely, and leaning on a sophisticated, reusable engine to bridge the gap. Probabilistic programming is "declarative inference": you describe a model of the world and declare your data, and the runtime declares back your updated beliefs.

> **Key insight:** a PPL is the declarative paradigm applied to Bayesian statistics — you declare the generative model, the inference engine supplies the "how," exactly as SQL declares a query and a solver declares constraints. The paradigm's power and its cost both come from that same hand-off.

---

## Common Mistakes

- **Shipping default priors undocumented.** On small data the prior moves the answer; an undefended prior is an un-auditable assumption. Document, justify, and sensitivity-test.
- **Non-reproducible inference.** Unpinned seeds/versions/data make a posterior impossible to regenerate or audit. Version model + priors + data hash + config together.
- **No production validation loop.** A model validated once and never again silently rots. Automate posterior-predictive checks and convergence gates in CI/monitoring.
- **Reporting the posterior instead of the decision.** Stakeholders need a decision and an interval, not a trace plot. Wire the posterior into a loss function and emit an action.
- **VI everywhere for speed, ignoring its over-confidence.** Fast but optimistically narrow posteriors — dangerous for the risk/A-B decisions that motivated going Bayesian. Cross-check against MCMC.
- **Bayesian-by-default.** A deep PPL or hierarchical model where abundant data + a point prediction would do is cost and fragility for no decision-relevant gain. Match the tool to whether uncertainty actually drives the decision.

---

## Summary

In production, a probabilistic program is a **decision engine under uncertainty**, and the work shifts from "get a posterior" to "defend, scale, reproduce, and act on it." The **ecosystem** splits by bottleneck: Stan/PyMC for correctness-first, diagnostics-rich statistical work; NumPyro/Pyro/TFP (on JAX/PyTorch/TF) for scale, GPUs, and deep components. The paradigm earns its keep wherever **uncertainty drives the decision**: **Bayesian A/B testing** answers "P(B better) and is it big enough to matter?" instead of a misread p-value; **hierarchical forecasting** uses partial pooling so sparse series borrow strength and every forecast carries honest error bands; **risk/insurance/finance** consume the distribution's *tail* as the product; **sensor fusion and science** infer hidden states from noisy measurements with calibrated uncertainty. **Scaling inference** is a portfolio — VI for throughput, JAX/GPU for speed, mini-batching for big data, amortization for per-request latency, and reparameterization as the cheapest big win. **Deep PPLs** fuse neural nets with probabilistic uncertainty (Bayesian NNs, VAEs) at the cost of approximate, often over-confident inference. And the **engineering reality** is that the model is ~20% of the job: priors are assumptions you defend to auditors, stochastic inference must be pinned for reproducibility, validation must be automated, latency must be budgeted, and the posterior must be converted — via a loss function — into a decision people stake outcomes on. Underneath it all, a PPL is the **declarative paradigm applied to statistics**: you declare the generative model and your data; the inference engine declares back your updated beliefs.

---

## Further Reading

- *Bayesian Analysis with Python* (Osvaldo Martin) — production-oriented PyMC, including A/B testing and hierarchical models.
- Michael Betancourt, *Towards A Principled Bayesian Workflow* — the closest thing to an engineering process for Bayesian modeling.
- *Regression and Other Stories* (Gelman, Hill, Vehtari) — hierarchical/multilevel modeling done right, with a practitioner's eye.
- The NumPyro and Pyro example galleries — VI at scale, amortized inference, and deep probabilistic models in code.
- Kruschke, *Doing Bayesian Data Analysis* — decision-theoretic interpretation and communicating uncertainty.

---

## Related Topics

- [`senior.md`](senior.md) — the trade-offs and the inference internals (MCMC vs VI, diagnostics) this level deploys.
- [`middle.md`](middle.md) — Bayes' rule, hierarchical/latent structure, and the linear-regression base case.
- [`interview.md`](interview.md) — graded Q&A including when-to-use, scaling, and the declarative framing.
- [03 — Declarative Programming](../03-declarative-programming/) — the family a PPL belongs to: declare *what*, the engine does *how*.
- [13 — Constraint Programming](../13-constraint-programming/) — the other declarative solver paradigm; search vs inference.
- [10 — Data-Oriented Programming](../10-data-oriented-programming/) — when the answer is fast point predictions over big data, not posteriors.

# Probabilistic Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Probabilistic Programming
> *Normal code runs forwards: inputs → output. A probabilistic program runs backwards: given the outcomes you observed, infer the hidden causes — and report them with their uncertainty, not as a single guess.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Forwards vs Backwards Computation](#core-concept-1--forwards-vs-backwards-computation)
5. [Core Concept 2 — `sample` and `observe`](#core-concept-2--sample-and-observe)
6. [Core Concept 3 — The Output Is a Distribution](#core-concept-3--the-output-is-a-distribution)
7. [The Coin-Bias Example, End to End](#the-coin-bias-example-end-to-end)
8. [A Tiny Sampler, by Hand](#a-tiny-sampler-by-hand)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Almost every program you have written so far computes an **output from inputs**. You give a function some numbers, it does arithmetic, it hands back an answer. Run it twice with the same inputs and you get the same answer. The flow of information goes one direction: causes in, effects out.

Now flip that around. Suppose you *see* the effects and want the causes. You flipped a coin 10 times and got 7 heads — is the coin fair, or biased, and *how* biased? You watched a user click 3 of 40 ads — what is their true click-through rate? A patient's test came back positive — what is the chance they actually have the disease? In each case you observed an **outcome** and you want to recover the **hidden parameter** that produced it. And critically, you can't recover it *exactly* — 7 heads is consistent with a fair coin having a lucky streak *and* with a slightly biased coin. The honest answer is not a single number but a **range of plausible values with their probabilities**.

That is what a **probabilistic program** does. You write down a *generative story*: "there's some unknown bias `p`; given `p`, each flip is heads with probability `p`." Then you hand the runtime your observed data and say "make this consistent." The runtime runs the story **backwards** and gives you back a *distribution* over `p` — the values it could be, and how strongly the data supports each one. You wrote the model; the system did the math of inverting it. That math is **Bayesian inference**, and the whole point of a Probabilistic Programming Language (PPL) is that you never have to do it by hand.

> **The mindset shift:** stop thinking "function that returns an answer." Start thinking "model of how data is generated, run in reverse to reveal the unknowns — with uncertainty attached." The output of a probabilistic program is not a value; it is a *belief*.

---

## Prerequisites

- **Required:** You can read basic Python (functions, variables, calling a library). Examples use **PyMC**, a popular Python PPL, plus a tiny hand-rolled sampler in plain Python.
- **Required:** You know what *probability* means informally — "a 0.7 chance of heads" — and can read "70%" as 0.7.
- **Helpful:** You have heard the words *average* and *random*. Nothing more.
- **Not required:** Bayes' theorem, calculus, or any statistics course. We build the intuition from scratch and keep the math to a minimum. The deeper machinery (Bayes' rule, Monte Carlo, MCMC) arrives at the [middle](middle.md) and [senior](senior.md) levels.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Probabilistic program** | A program that defines random variables and how data is generated, then lets the runtime infer the unknowns from observed data. |
| **Random variable** | A value that isn't fixed but is drawn from a distribution — e.g. "the coin's bias `p`," not yet known. |
| **Latent (hidden) variable** | A random variable you *can't* see directly and want to infer (the coin's true bias). |
| **Observed variable** | Data you *did* see and want to condition on (the actual flips: H, H, T, H…). |
| **Prior** | Your belief about a latent variable *before* seeing data ("`p` is probably somewhere in [0,1], no idea where"). |
| **Likelihood** | How probable the observed data is, *given* a particular value of the latent variable. |
| **Posterior** | Your updated belief about the latent variable *after* seeing data — the answer a PPL produces. |
| **Inference** | The (usually expensive) process of computing the posterior from the prior and the data. |
| **`sample`** | Draw a value for a latent random variable. |
| **`observe` / condition** | Pin a random variable to data you actually saw, forcing the model to explain it. |
| **PPL** | Probabilistic Programming Language/library — Stan, PyMC, NumPyro, Pyro, Turing.jl. |

> The two words to lock in now: **prior** (belief before data) and **posterior** (belief after data). Everything a PPL does is "turn a prior into a posterior using the data."

---

## Core Concept 1 — Forwards vs Backwards Computation

Here is ordinary, forwards code. We *know* a coin's bias and we simulate flips:

```python
import random

def flip_coin(p, n):           # p = bias (known), n = number of flips
    return [1 if random.random() < p else 0 for _ in range(n)]

flips = flip_coin(0.7, 10)     # e.g. [1,1,0,1,1,1,0,1,1,0] — 7 heads
```

Inputs (`p=0.7`) go in; an outcome (some flips) comes out. This is a **generative model** written forwards: it *generates* data from a known parameter.

A probabilistic program is the *same model, run the other way*. Now we **don't** know `p`. We only have the flips. We want `p`:

```
FORWARDS  (simulation):   p  ─────────►  flips      "given the cause, produce effects"
BACKWARDS (inference):    flips  ─────►  p           "given the effects, recover the cause"
```

The remarkable thing is that you **describe the same forwards story** — "`p` is unknown; each flip is heads with probability `p`" — and the PPL automatically figures out how to run it backwards. You never write the reverse logic. Writing the inverse of a model by hand is hard (it's where all the calculus and probability theory lives); a PPL is a tool that does that inversion for you, the way SQL turns "what rows do I want" into an execution plan you never write.

> **Key insight:** a probabilistic program is a *forwards* description of how data arises, plus a request to *invert* it. The forwards part is easy to write. The inversion — **inference** — is the hard part, and it's exactly what the PPL handles.

---

## Core Concept 2 — `sample` and `observe`

A probabilistic program is built from two operations. Everything else is detail.

**`sample` — introduce an unknown.** When you `sample`, you declare a random variable drawn from a distribution. This is how you say "I don't know this value; here's the range it could be in." The bias of the coin is a `sample`: we don't know it, but we believe it's somewhere in `[0, 1]`. That belief — the distribution we sample it from — is the **prior**.

```python
p = sample("p", Uniform(0, 1))   # an UNKNOWN: p is somewhere in [0,1], all equally likely a priori
```

**`observe` — pin a variable to data.** When you `observe`, you tell the model "this random variable actually came out *this* way — make your story consistent with that." This is how data enters. Each coin flip is `observe`d: the model knows flips are Bernoulli(`p`), and we force them to equal what we really saw.

```python
for outcome in [1, 1, 0, 1, 1, 1, 0, 1, 1, 0]:   # our real data: 7 heads, 3 tails
    observe(Bernoulli(p), outcome)                # FORCE the model to explain this flip
```

The interplay is the whole game. `sample` opens up a space of possibilities (all values of `p`). `observe` cuts that space down to the values that make the data plausible. Values of `p` near 0.7 explain "7 of 10 heads" well; values near 0.1 explain it terribly. Inference weighs every possible `p` by *how well it explains the observed flips* and returns the result.

```
sample  →  "p could be anything in [0,1]"          (open the door wide)
observe →  "...but the data was 7/10 heads"        (close it to what fits)
result  →  a distribution over p, peaked near 0.7  (the posterior)
```

> **The pattern:** `sample` the unknowns, `observe` the data, ask for the posterior. If you can write the generative story with these two verbs, the PPL can infer the rest.

---

## Core Concept 3 — The Output Is a Distribution

This is the idea that separates probabilistic programming from everything else you've written: **the answer is not a number, it's a distribution**.

A normal function for our coin might return a single estimate: `p ≈ 0.7` (just heads ÷ flips). That's a **point estimate** — one value, no sense of how sure we are. But 7 heads out of 10 is *weak* evidence. The true bias could easily be 0.5 or 0.85; 10 flips just can't tell them apart. A point estimate hides that uncertainty and lets you act overconfidently.

A probabilistic program instead returns the **posterior distribution** over `p`: a curve saying "`p` is most likely around 0.65, quite plausibly anywhere from 0.4 to 0.85, and almost certainly not below 0.2." That shape *is* the answer. From it you can read:

- a **point estimate** if you still want one (the mean or the peak of the curve),
- a **credible interval** ("95% sure `p` is between 0.41 and 0.86"),
- the **probability of a statement** ("there's a 78% chance the coin favors heads, i.e. `p > 0.5`").

```
  point estimate:   p = 0.7            ← one number, pretends to be certain
  posterior:        a curve over p     ← honest: where p probably is, and how sure
                          ▁▂▄█▆▃▁
                       0.3   0.7   1.0
```

Why does this matter? Because real decisions need to know *how sure you are*. Shipping a feature because version B "beat" version A by 2% is reckless if that 2% could just be noise — the posterior tells you whether the difference is real. A medical or financial model that outputs a single number and hides its uncertainty is worse than useless; it's *confidently wrong*. **Uncertainty-as-output** is the feature, not a bug.

> **Key insight:** a point estimate answers "what's the value?" A posterior answers "what's the value, and how sure should I be?" — which is the question that actually drives good decisions.

---

## The Coin-Bias Example, End to End

Let's do the whole thing in a real PPL. **PyMC** is a Python library; you write the generative model with Python objects, and it runs the inference. Read it top-to-bottom as the story "there's an unknown bias; the flips came from it."

```python
import pymc as pm
import numpy as np

data = np.array([1, 1, 0, 1, 1, 1, 0, 1, 1, 0])   # 7 heads (1), 3 tails (0)

with pm.Model() as coin_model:
    # 1. PRIOR — sample the unknown bias. Uniform(0,1): "could be anything, no idea yet."
    p = pm.Uniform("p", 0, 1)

    # 2. LIKELIHOOD + OBSERVE — the flips are Bernoulli(p), pinned to our real data.
    pm.Bernoulli("flips", p=p, observed=data)

    # 3. INFERENCE — run the model backwards: produce the posterior over p.
    posterior = pm.sample(2000, progressbar=False)

# The result is NOT a single p. It's 2000+ plausible values of p, forming a distribution.
samples = posterior.posterior["p"].values.flatten()
print(f"posterior mean of p: {samples.mean():.2f}")            # ~0.67
print(f"95% credible interval: "
      f"[{np.percentile(samples, 2.5):.2f}, {np.percentile(samples, 97.5):.2f}]")  # ~[0.39, 0.88]
print(f"P(coin favors heads, p > 0.5): {(samples > 0.5).mean():.2f}")               # ~0.86
```

Walk through what each line says:

- **`pm.Uniform("p", 0, 1)`** is `sample` — it declares `p` unknown, with a flat prior over `[0, 1]`.
- **`pm.Bernoulli("flips", p=p, observed=data)`** is `observe` — the `observed=data` argument pins the flips to reality. Without `observed=`, this would just *simulate* flips (forwards); *with* it, the model must explain the real flips (backwards).
- **`pm.sample(2000)`** runs **inference**. The name is unfortunate — it doesn't sample one answer, it draws ~2000 plausible values of `p` from the posterior, which together approximate the answer curve.

The output isn't `0.7`. It's a cloud of values centered near 0.67, spread from roughly 0.39 to 0.88. The spread *is* the uncertainty: with only 10 flips, the model honestly admits it can't pin `p` down. Feed it 1000 flips and the same code returns a much tighter posterior — more data, less uncertainty, automatically.

> **What you wrote vs what you got:** you wrote three lines describing a forwards story (unknown bias → flips). You got back a full distribution over the unknown. You wrote zero lines of probability math. That division of labor *is* probabilistic programming.

---

## A Tiny Sampler, by Hand

`pm.sample` feels like magic, so let's demystify it with a dozen lines of plain Python — no library, no math beyond multiplication. The crudest possible inference method is **rejection sampling**: guess values, keep the ones that fit, throw away the rest.

```python
import random

data = [1, 1, 0, 1, 1, 1, 0, 1, 1, 0]   # 7 heads, 3 tails

def likelihood(p):
    """How probable is OUR data if the bias were p? Multiply each flip's probability."""
    prob = 1.0
    for flip in data:
        prob *= p if flip == 1 else (1 - p)   # P(heads)=p, P(tails)=1-p
    return prob

kept = []
for _ in range(200_000):
    p = random.random()              # 1. SAMPLE a candidate p from the prior Uniform(0,1)
    if random.random() < likelihood(p) / likelihood(0.7):   # 2. keep it in proportion to fit
        kept.append(p)               #    (well-fitting p's are kept more often)

kept.sort()
print(f"accepted {len(kept)} samples")
print(f"posterior mean: {sum(kept)/len(kept):.2f}")                 # ~0.67
print(f"95% interval: [{kept[len(kept)//40]:.2f}, "
      f"{kept[-len(kept)//40]:.2f}]")                               # ~[0.40, 0.87]
```

The logic, in words:

1. **Propose** a random `p` from the prior (just `random.random()`, since the prior is flat).
2. **Score** it by `likelihood(p)` — how well that `p` explains the 7-heads-3-tails data.
3. **Keep** it with probability proportional to that score. Values near 0.7 fit well and survive often; values near 0.1 fit terribly and rarely survive.
4. The **surviving pile** of `p` values *is* the posterior — collect enough and its shape matches what PyMC gave us.

That's the entire idea behind inference: explore values of the unknown, weight each by how well it explains the data, and the weighted collection is your answer. Real PPLs use far smarter exploration (you'll meet **MCMC** and **HMC** at the senior level) because rejection sampling wastes almost every guess and collapses on harder problems — but the *goal* is identical. When someone says "the runtime does Bayesian inference for you," this loop is the honest, stripped-down version of what that means.

> **Demystified:** inference is "try candidate values, keep them in proportion to how well they explain the data." PyMC just does it cleverly enough to scale.

---

## Real-World Examples

| Where you've seen it | The hidden thing being inferred |
|---|---|
| **A/B test result** ("B is probably better, 92% confidence") | The true conversion rate of each variant, with uncertainty |
| **Spam filter** giving "87% spam" | The probability this email is spam given its words |
| **Election forecast** ("70% chance to win") | Each candidate's true support, inferred from noisy polls |
| **Recommendation "you might like…"** | Your hidden preferences, inferred from clicks |
| **Medical test interpretation** | The chance you have the condition given a positive result |
| **Demand forecast** with a range, not a point | Future demand and its uncertainty, from past sales |
| **Sensor fusion** (phone GPS + accelerometer → position) | Your true location, inferred from noisy sensors |

Every one of these is "observe noisy effects, infer a hidden cause, report uncertainty." You've been *using* probabilistic reasoning for years; a PPL is the tool that lets you *write* it directly instead of hand-coding the statistics each time.

---

## Mental Models

- **The detective.** Forwards code is the criminal: cause → crime. A probabilistic program is the detective: it sees the crime (the data) and reasons backwards to the most plausible culprits (the parameters), never claiming certainty — just "most likely the butler, but the gardener isn't ruled out."
- **Updating a belief.** You start with a prior ("the coin's probably fair-ish, but who knows"). Data arrives. You update to a posterior. More data, sharper belief. A PPL automates that update — it's a *belief-updating machine*.
- **SQL for inference.** In SQL you declare *what rows you want* and the engine plans *how* to get them. In a PPL you declare *the generative model* and the engine plans *how to invert it*. Both let you stay at the "what," handing the hard "how" to a solver.
- **A spreadsheet that runs backwards.** A spreadsheet computes outputs from input cells. Imagine fixing the *output* cells to known values and asking the sheet to tell you the *distribution* of input cells consistent with them. That's a probabilistic program.

---

## Common Mistakes

- **Expecting a single answer.** "What's `p`?" has no single answer here — the output is a *distribution*. If you collapse it to one number on day one, you've thrown away the whole point: the uncertainty.
- **Forgetting to `observe`.** A model with `sample`s but no `observe`d data isn't doing inference — it's just *simulating* the prior forwards. The `observed=` argument is what makes it run backwards. Drop it and you'll get back your prior, unchanged, and wonder why "the data did nothing."
- **Confusing prior and posterior.** The prior is your belief *before* data; the posterior is *after*. The PPL's job is to turn the first into the second. Reading a posterior as if it were the prior (or vice versa) inverts the whole result.
- **Thinking the PPL guesses one value and checks it.** It doesn't pick a value — it characterizes the *entire range* of plausible values weighted by the data. "What's the best `p`" is a question *you* ask of the posterior afterward, not what inference returns.
- **Assuming it's always worth it.** Inference is expensive. For a question where a simple average or a quick formula suffices and you don't need uncertainty, a full Bayesian model is overkill. PPLs shine when uncertainty *matters* and data is *limited* — not everywhere.

---

## Test Yourself

1. In your own words: how is a probabilistic program "the same model run backwards" compared to ordinary code?
2. What do `sample` and `observe` each do? Which one brings the data in?
3. You ran the coin model and got back 2000 numbers instead of one. What do those numbers represent?
4. What's the difference between a *prior* and a *posterior*? Whose job is it to turn one into the other?
5. In the PyMC model, which single argument makes it do inference instead of just simulating flips?
6. In the hand-rolled sampler, why are values of `p` near 0.7 kept more often than values near 0.1?
7. Give one situation where a point estimate would be dangerously misleading and a posterior would not.

> Try each before reading on. If #3 or #5 is fuzzy, re-read [The Output Is a Distribution](#core-concept-3--the-output-is-a-distribution) and [The Coin-Bias Example](#the-coin-bias-example-end-to-end).

---

## Cheat Sheet

```
PROBABILISTIC PROGRAM = a generative model + a request to run it BACKWARDS.
  forwards (normal code):  inputs/params ──► output
  backwards (a PPL):       observed data ──► distribution over the unknowns

THE TWO VERBS:
  sample(name, prior)        declare an UNKNOWN drawn from a prior distribution
  observe(dist, data)        pin a variable to DATA you actually saw (this is conditioning)

THE THREE NOUNS:
  prior        belief about the unknown BEFORE seeing data
  likelihood   how well a candidate value explains the data
  posterior    belief AFTER seeing data  ← the ANSWER, and it's a DISTRIBUTION

INFERENCE = compute the posterior from prior + data. It's the expensive part.
  crude version: try candidate values, keep each in proportion to how well it fits.

THE OUTPUT IS A DISTRIBUTION, NOT A NUMBER:
  read off → point estimate (mean/peak), credible interval, P(statement is true)

YOU write the model.  The PPL does the Bayes math.   (like SQL plans your query)
```

---

## Summary

A **probabilistic program** describes how data is generated from unknown parameters, then asks the runtime to run that description **backwards** — to infer the unknowns from observed data. You build it from two verbs: **`sample`** declares an unknown (drawn from a **prior**), and **`observe`** pins a variable to data you actually saw. The runtime performs **inference**, turning your prior into a **posterior** — and the posterior is the answer. Crucially, that answer is a **distribution, not a single number**: it tells you not just the most plausible value but *how sure you should be*, which is exactly what real decisions need. You saw the same idea three ways: a one-line intuition (forwards vs backwards), a three-line PyMC model that returned a full posterior over a coin's bias, and a hand-rolled rejection sampler that demystifies what "inference" actually does — try candidate values, keep them in proportion to how well they fit. You write the model; the PPL does the Bayesian math, just as SQL does query planning. The middle level adds Bayes' rule and the generative mindset properly; the senior level digs into *why inference is hard* and how real samplers (MCMC, HMC) work.

---

## Further Reading

- *Bayesian Methods for Hackers* (Cameron Davidson-Pilon) — the gentlest possible on-ramp, all code-first in PyMC; read Chapter 1.
- *Statistical Rethinking* (Richard McElreath) — the best intuition-first Bayesian course anywhere; the lectures are free.
- The [PyMC "Getting Started"](https://www.pymc.io/) docs — run the coin example yourself in ten minutes.
- 3Blue1Brown, *Bayes' theorem* (video) — the visual intuition for prior → posterior in 15 minutes.

---

## Related Topics

- [`middle.md`](middle.md) — Bayes' rule made plain, the generative-model mindset, and a full linear-regression model in PyMC.
- [`senior.md`](senior.md) — why inference is the hard part: MCMC vs variational inference, convergence diagnostics, when a PPL is overkill.
- [03 — Declarative Programming](../03-declarative-programming/) — the same "declare *what*, let a solver do *how*" idea; a PPL is declarative inference.
- [13 — Constraint Programming](../13-constraint-programming/) — its sibling: you declare constraints, a solver searches; here you declare a model, an inference engine searches.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where probabilistic programming sits on the imperative ↔ declarative map.

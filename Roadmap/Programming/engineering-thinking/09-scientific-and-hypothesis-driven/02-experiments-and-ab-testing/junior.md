> **What?** An experiment (A/B test) is a controlled comparison: you split a population into two or more groups at random, change exactly *one* thing for one group, and measure whether a metric moves. The group you don't change is the **control**; the group you do change is the **treatment**.
>
> **How?** At the junior level you mostly *read* experiments other people designed and run small ones behind a feature flag. Your job is to state a clear hypothesis, pick a single metric to watch, let the test run long enough, and resist the urge to call a winner after the first good-looking hour.

---

## 1. Why randomize at all?

The whole point of an A/B test is to answer "did *my change* cause this, or would it have happened anyway?" Without a control group you can't tell. If you ship a new checkout button and sales go up 5%, maybe the button helped — or maybe it was payday, or a marketing email went out, or a competitor went down.

The fix is **randomization**: assign each user to control or treatment by a coin flip (in practice, a hash of their user ID). Random assignment makes the two groups statistically the same *on average* — same mix of new/returning users, mobile/desktop, rich/poor, motivated/idle. Anything that differs between the groups *after* you start is attributable to your change, because the only systematic difference is the change itself.

```mermaid
flowchart LR
    U[Incoming users] -->|hash(user_id) % 100| R{Bucket}
    R -->|0-49| C[Control: old button]
    R -->|50-99| T[Treatment: new button]
    C --> M1[Measure conversion]
    T --> M2[Measure conversion]
    M1 --> D[Compare]
    M2 --> D
```

This idea — that randomization is what lets you claim causation — goes back to R. A. Fisher in the 1920s. It is the single most important concept in this whole topic.

## 2. Anatomy of an experiment

| Term | Plain meaning |
|------|---------------|
| **Control (A)** | The existing experience. The baseline. |
| **Treatment (B)** | The new thing you're testing. |
| **Variant** | Any single arm of the test (control is a variant too). |
| **Metric** | The number you're trying to move (e.g. checkout conversion rate). |
| **Hypothesis** | A falsifiable prediction: "the new button will raise conversion." |
| **Unit of assignment** | *What* gets randomized — usually a user. |

A good hypothesis is specific and could turn out false. "The new green button increases add-to-cart rate" is testable. "The new button is better" is not — better at *what*?

## 3. Write the hypothesis before you look

Decide your metric and your expected direction **before** the data arrives. This sounds bureaucratic; it is actually the guardrail that keeps you honest. If you wait until after, you'll find *some* number that went up and declare victory — there's always one. Pre-committing stops you from fooling yourself. (See [hypothesis and falsifiability](../01-hypothesis-and-falsifiability/) for why a prediction you can't disprove isn't worth much.)

A minimal experiment doc:

```
Hypothesis: Moving "Add to cart" above the fold raises add-to-cart rate.
Primary metric: add-to-cart rate (carts / sessions)
Direction:    we expect it to go UP
Guardrail:    page load time must NOT get worse
Decision:     ship if add-to-cart up by ≥1% absolute and load time flat
```

## 4. One change at a time

If you move the button *and* change its color *and* reword the text, and the metric goes up — which change did it? You can't know. For a clean read, change one thing. (Big platforms run multivariate tests that vary several factors at once, but that needs more traffic and more care; as a junior, keep it to one variable.)

## 5. Let it run — patience beats cleverness

Two traps catch nearly every beginner:

**Peeking.** You check the dashboard after an hour, see treatment ahead, and ship. Early results are mostly noise. A test that looks like a 10% win on day one routinely settles to 0% by day seven. The number bounces around a lot when you have few data points, and it *will* cross your "winning" line by chance at some point if you keep watching.

**Stopping early because it looks good.** This is the same trap with a name. The rule: decide *up front* how long the test runs (or how many users it needs), and don't stop until you hit it. We'll quantify why in [middle.md](./middle.md), but for now treat the end date as fixed.

> Twyman's law: *any figure that looks interesting or different is usually wrong.* If your test shows a 40% lift, suspect a bug before you celebrate.

## 6. Run it for full cycles

User behavior has weekly rhythm — weekends differ from weekdays, paydays differ from the rest of the month. Run for at least one full week (ideally two) so each variant sees the same mix of days. A test that ran Monday–Wednesday compares your change against a slice of the week that isn't representative.

## 7. Feature flags: the engineering side

You don't need a fancy platform to start. A **feature flag** is just a runtime switch that decides which code path a user gets:

```python
def checkout_button(user):
    if in_experiment(user, "new_button", percent=50):
        return render_new_button()
    return render_old_button()

def in_experiment(user, name, percent):
    # stable, random-looking assignment per user
    bucket = stable_hash(f"{name}:{user.id}") % 100
    return bucket < percent
```

Two properties make this correct:

- **Stable.** The same user always lands in the same bucket — they don't flip between old and new on every page load. That's why we hash the user ID instead of calling `random()`.
- **Independent per experiment.** Including the experiment `name` in the hash means a user's bucket in experiment X is unrelated to their bucket in experiment Y. Otherwise the same users always get every treatment, and your experiments contaminate each other.

This same flag is how engineers do a **canary release** — turn the new code on for 1% of traffic, watch the error rate, then ramp up. Same machinery, different metric (errors instead of conversion).

## 8. What junior mistakes look like

| Mistake | Why it's wrong | Fix |
|---------|----------------|-----|
| No control group | Can't separate your change from everything else | Always randomize a holdout |
| Calling it after an hour | Early data is noise | Pre-set a duration |
| Cherry-picking the metric that moved | Something always moves | Pick the metric first |
| `random()` per request | User flips variants constantly | Hash a stable ID |
| Ran 2 days, declared a winner | Missed weekly cycles | Run ≥1 full week |
| Changed 3 things at once | Can't attribute the effect | One variable per test |

## 9. Reading a result you didn't run

When someone shows you "treatment converted 12.0% vs control 11.4%," ask three questions:

1. **How many users?** 600 vs 570 means nothing; 600k vs 570k might. Small samples are noise. (More in [middle.md](./middle.md).)
2. **Did anything else change during the window?** A deploy, an outage, a holiday?
3. **What about the guardrails?** Conversion up but page 300ms slower, or refunds up — is it actually a win?

A result with no sample size, no time window, and no guardrails isn't a result; it's a vibe.

---

## Key takeaways

- An A/B test is a randomized comparison of **control** vs **treatment** so you can claim *your change* caused the effect.
- **Randomize on a stable unit** (usually the user) by hashing their ID — never per request.
- Decide the **metric, direction, duration, and decision rule before** you look at data.
- **Don't peek and stop early** — early numbers are noise and will cross your line by chance.
- Run for **full weekly cycles**; change **one thing**; check **guardrails**, not just the metric you hoped would move.
- Feature flags power both product A/B tests and engineering **canaries** — same switch, different metric.

## Where to go next

- [middle.md](./middle.md) — sample size, p-values, and why underpowered tests mislead.
- [Hypothesis and falsifiability](../01-hypothesis-and-falsifiability/) — what makes a hypothesis testable.
- [Measure before optimize](../03-measure-before-optimize/) — get the baseline before you change anything.
- [Probabilistic thinking](../../06-probabilistic-thinking/) — the reasoning-under-uncertainty foundation.
- [Section root](../) · [Engineering Thinking roadmap](../../README.md)

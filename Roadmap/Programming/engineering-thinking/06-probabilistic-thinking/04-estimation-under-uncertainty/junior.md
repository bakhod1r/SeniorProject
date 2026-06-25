> **What?** Estimation under uncertainty is producing a *useful* answer to "how long?" or "how much?" when you genuinely cannot know the exact figure yet. The honest unit of an estimate is a **range with a confidence level** ("2–8 days, 80% sure"), never a single number, because a single number hides everything you don't know.
>
> **How?** As a junior you do two concrete things: (1) when asked "how long will this take?", give a *range* and say what would make it the high end; (2) when asked "how big/fast/much?", you don't guess — you *decompose* the unknown into smaller knowable numbers and multiply (Fermi estimation). You also write down your estimate so you can later compare it to what actually happened.

---

## 1. Why "3 days" is a lie

When a senior asks "how long for this ticket?" and you say **"3 days"**, you have just made three silent claims:

- you know the work down to the day,
- nothing will surprise you,
- you are committing to that date.

None of those is true for a task you haven't fully explored. A point estimate (one number) throws away the most important information you have: *how unsure you are*.

The honest form is a **range plus a confidence level**:

> "Probably 2 days. But if the auth library fights me it could be 5. Call it **2–5 days, ~80% confident**."

That sentence is more useful to your lead than "3 days", because it tells them both the *likely* case and the *bad* case they need to plan around.

| You say | What the listener actually hears | Problem |
|---|---|---|
| "3 days" | "Done Thursday, guaranteed" | Hidden commitment to the optimistic end |
| "2–5 days, 80%" | "Plan for Friday, hope for Wednesday" | None — uncertainty is visible |
| "I'm not sure" | "Junior can't estimate" | True but useless — give a range instead |

The goal is not to be *exactly right*. It's to **not be surprising**. A range that contains the real answer ~80% of the time is doing its job.

---

## 2. Three-point estimation (your default tool)

Don't pull a single number out of the air. Pull **three**:

- **O — optimistic**: everything goes right, no surprises.
- **M — most likely**: the realistic, normal-friction case.
- **P — pessimistic**: the library is broken, the API is undocumented, a meeting eats a day.

This is the core of **PERT** (Program Evaluation and Review Technique). A simple weighted average gives you a single planning number that respects the bad case:

```
Expected = (O + 4·M + P) / 6
```

### Worked example — "add a CSV export button"

| | Days |
|---|---|
| Optimistic (O) | 1 |
| Most likely (M) | 2 |
| Pessimistic (P) | 6 |

```
Expected = (1 + 4·2 + 6) / 6 = (1 + 8 + 6) / 6 = 15 / 6 = 2.5 days
```

Notice the expected value (2.5) is **higher** than the most-likely (2). That's correct and important: bad surprises are usually *bigger* than good surprises. Tasks rarely finish way early; they routinely finish way late. The math bakes that asymmetry in for you.

The single most useful question to find your P is: **"What's the one thing that, if it went wrong, would blow this up?"** Write that down next to the estimate.

---

## 3. Fermi estimation — answer "how much?" without knowing

Sometimes the question isn't time, it's a quantity: *How much storage will this feature need? How many requests per second?* You feel like you can't possibly know. You can — by breaking the unknown into knowable pieces and multiplying. This is **Fermi estimation**, named after physicist Enrico Fermi, who was famous for fast order-of-magnitude answers.

The classic teaching example is *"How many piano tuners are in Chicago?"* — you don't know, but you *can* estimate the population, fraction of homes with pianos, how often a piano is tuned, and how many a tuner does per year, then multiply. We care about the engineering version.

### Worked example — storage for user profile photos

> *"How much disk do we need for profile photos for 1 million users?"*

Decompose into things you *can* reason about:

| Factor | Estimate | Reasoning |
|---|---|---|
| Users | 1,000,000 | given |
| Fraction who upload a photo | 0.5 | guess — half bother |
| Avg photo size | 200 KB | a typical compressed JPEG |

```
Storage = 1,000,000 × 0.5 × 200 KB
        = 500,000 × 200 KB
        = 100,000,000 KB
        = 100 GB   (÷ 1,000,000 to go KB → GB)
```

So: **~100 GB, order of magnitude 10^2 GB.** You don't need it precise. You need to know whether the answer is "fits on a laptop" (100 GB) or "needs a storage cluster" (100 TB) — and now you do, in 60 seconds, with no measurement.

> Rule: the goal of a Fermi estimate is the **order of magnitude** (is it 10s? 1000s? millions?), not the exact digit. Round aggressively; reason in powers of ten.

---

## 4. The numbers worth memorizing

Fermi estimates need a few "anchor" numbers in your head so you're not decomposing forever. Memorize these — they cover most engineering estimates:

| Quantity | Rough value |
|---|---|
| Seconds in a day | ~86,400 ≈ **10^5** |
| Seconds in a month | ~2.5 million ≈ **2.5×10^6** |
| 1 KB / MB / GB / TB | 10^3 / 10^6 / 10^9 / 10^12 bytes |
| A typical text record (1 row) | ~1 KB |
| A compressed photo | ~100–500 KB |

### Mini-example — QPS from daily volume

> *"We get 8 million API calls a day. What's the average QPS?"*

```
QPS = 8,000,000 / 86,400 (seconds in a day)
    ≈ 8,000,000 / 80,000
    ≈ 100 QPS
```

Average ~100 QPS. (Peak is higher — a common rule of thumb is **peak ≈ 2–10× average**, so plan for a few hundred QPS.) That's enough to know one modest server can handle it.

---

## 5. Write the estimate down (so you can get better)

The fastest way to become a good estimator is boring: **record your estimate, then later record what actually happened.** A two-column note is enough.

| Task | My estimate | Actual | Off by |
|---|---|---|---|
| CSV export | 2–5 d | 4 d | inside range |
| Refactor auth | 1 d | 3 d | **2× under** |
| Email template | 0.5 d | 0.5 d | spot on |

After ten rows you'll see your *personal* bias — almost everyone discovers they are systematically **optimistic** (this is the **planning fallacy**; see [cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/)). Once you know your bias, you correct for it: "my gut says 2 days, I'm usually 1.7× optimistic, so I'll say 3–4."

### Why you're optimistic (and it's not your fault)

When you estimate, you imagine *doing the work* — and your imagination plays the **happy path**: the code compiles, the API behaves, no one interrupts you. You don't imagine the merge conflict, the flaky test, the meeting that eats Tuesday. So your gut number is really an estimate of the *best realistic* case, not the *likely* case. That's why three-point estimation (Task 2 above used it) forces you to also write down P — it drags the surprises you'd otherwise ignore back into the number.

A simple, honest rule while you're still learning your bias: **take your gut number and at least double it for the pessimistic end.** "Feels like a day" → "1 day likely, but P is 2–3 if anything surprises me." You will be wrong less often, and you'll be wrong in the *safe* direction.

---

## 6. Common junior mistakes

| Mistake | Why it hurts | Do instead |
|---|---|---|
| Giving one number | Heard as a hard commitment | Give a range + confidence |
| Estimating the happy path only | Ignores the P that always shows up | Always ask "what's the worst realistic case?" |
| Estimating work you haven't read | Pure guessing | Spend 20 min spiking, *then* estimate |
| Padding secretly ("I'll say 5 but it's 2") | Trust erodes when you're early | Give an honest range openly |
| Never checking estimate vs actual | You never calibrate | Keep the two-column log |
| Mixing up KB/MB/GB powers | Answer off by 1000× | Reason in powers of ten and label units |

### One more habit: state your assumptions

Every estimate rests on assumptions. "2–5 days" *assumes* the design is settled, the staging environment works, and no one reassigns you mid-task. Say those out loud: **"2–5 days, assuming the API docs are accurate."** Then if an assumption breaks, the estimate isn't "wrong" — its *input* changed, and you re-estimate openly. This one habit turns "you missed your estimate" into "the scope changed," which is the truth and protects your credibility.

---

## 7. Where to go next

- Estimation rests on thinking clearly when you can't be certain: [reasoning under uncertainty](../01-reasoning-under-uncertainty/).
- The "expected value" math behind PERT: [base rates and expected value](../02-base-rates-and-expected-value/).
- The decompose-into-knowable-pieces move is **first-principles thinking**: [reasoning from fundamentals](../../05-first-principles-thinking/01-reasoning-from-fundamentals/).
- Section overview: [probabilistic thinking](../).
- Up to: [engineering thinking roadmap](../../README.md).

### Takeaways

1. An estimate is a **range + confidence**, not a single number.
2. Use **three points** (optimistic / likely / pessimistic) and remember the bad case is bigger.
3. Answer "how much?" with **Fermi decomposition** — break the unknown into knowable factors and multiply; aim for the order of magnitude.
4. **Log estimate vs actual** so you learn your own bias.

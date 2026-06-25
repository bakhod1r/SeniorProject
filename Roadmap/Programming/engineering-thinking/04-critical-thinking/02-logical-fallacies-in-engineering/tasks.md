> Practice exercises for spotting and rebutting logical fallacies in engineering arguments. Global constraints for every task: (1) **name the fallacy precisely** — use the standard term; (2) **explain *why* the reasoning fails**, not just that it does; (3) **write a real rebuttal you'd actually say out loud** — concrete, non-escalating, and turning the assertion into a question about the specific, measurable situation; (4) where a task has a numeric or code component, **do the arithmetic or write the check** — don't hand-wave. Remember: a fallacious argument can still reach a *true* conclusion, so attack the reasoning, not the conclusion. Work each task before reading the next.

---

## Task 1 — The authority one-liner

A staff engineer closes a debate with: *"Stripe runs a giant monolith and they're worth billions, so monoliths are clearly the right call for us."*

1. Name the fallacy.
2. Explain why Stripe's success doesn't transfer to your decision.
3. Note the trap: is the *conclusion* ("monolith for us") necessarily wrong?
4. Write a one-sentence rebuttal that keeps the debate open.

---

## Task 2 — Spot the false dichotomy and widen it

A planning doc states: *"We either rewrite the billing service from scratch or we keep living with the bugs forever."*

1. Name the fallacy.
2. List **at least four** options that live in the gap between "rewrite from scratch" and "live with bugs forever."
3. Write the rebuttal as a question that reintroduces those options without dismissing the author's frustration.

---

## Task 3 — The sunk-cost migration (with numbers)

A migration is partway done. Facts on the table:

- Already spent: **600 engineer-hours.**
- Estimated to *finish* the current path: **400 more hours**, yielding a system with known operational pain.
- Estimated to *revert and take the alternative path*: **250 hours**, yielding a system the team now believes is better.

Someone argues: *"We've already put 600 hours in — we have to finish."*

1. Name the fallacy.
2. Do the forward-looking comparison: which remaining path is cheaper, and by how much? Which inputs are irrelevant to the decision?
3. Write the rebuttal using the "decide fresh today" reframe.

---

## Task 4 — Survivorship bias in a conference talk

After a talk titled "How we scaled to 50M users on a single Postgres box," a teammate says: *"See? All this replication and sharding work is over-engineering — one box is plenty."*

1. Name the fallacy.
2. Explain, using the WWII-bomber logic, what's missing from the sample. (Who gave the talk, and who didn't?)
3. List two specific questions that would reveal whether the speaker's conditions match yours.

---

## Task 5 — Post hoc in an incident (with a timeline)

Incident timeline:

```
13:58  error rate begins climbing (0.1% → 1%)
14:00  deploy of service-checkout v2.3 reaches production
14:05  error rate hits 12%, pager fires
14:06  on-call declares: "the 14:00 deploy caused this, rolling back"
```

1. Name the fallacy in the 14:06 statement.
2. Point to the specific timeline fact that makes "the deploy caused it" doubtful.
3. Distinguish the correct *operational* action from the unproven *causal* claim.
4. Write two concrete checks you'd run before writing "root cause: deploy" in the post-mortem.

---

## Task 6 — No true Scotsman in a standards thread

In a thread about testing, an engineer writes: *"Competent backend engineers never need integration tests — units are enough."* A colleague names three respected engineers who rely heavily on integration tests. The reply: *"Well, they're not really doing backend properly then."*

1. Name the fallacy in the reply.
2. Explain why the claim is now unfalsifiable.
3. Write a rebuttal that fixes the definition *before* arguing the substance.

---

## Task 7 — Motte-and-bailey in an RFC

An RFC's title and recommendation is *"Adopt a service mesh across all teams."* When pushed in review, the author responds: *"All I'm really saying is that observability and security are important — surely you agree?"* The reviewers agree, and the RFC is approved as written.

1. Identify the **bailey** (the claim being acted on) and the **motte** (the claim being defended).
2. Explain how agreement with the motte got converted into approval of the bailey.
3. Write the structural rebuttal that pins which claim is actually on the table.

---

## Task 8 — Nirvana fallacy vs. the real baseline

A proposed input-validation fix catches 95% of malformed payloads. An engineer blocks it: *"This still lets 5% through, so it's not a real fix. Let's not ship it until we have something bulletproof."* Today, **zero** validation exists.

1. Name the fallacy.
2. State the *real* comparison the engineer should be making (name the actual baseline).
3. Do the simple reasoning: is 95% an improvement over 0%? What's the cost of waiting for "bulletproof"?
4. Write the rebuttal, including what you'd do with the remaining 5%.

---

## Task 9 — Goodhart's law: design the counter-metric

Leadership sets a single team OKR: *"Increase deploy frequency by 3x this quarter."* No other metric is tracked against it.

1. Name the law/fallacy at risk.
2. Describe **two distinct ways** a team could hit "3x deploys" while making things *worse*.
3. Propose a **paired counter-metric** that degrades when the target is gamed, and explain why the pair resists Goodhart. (Reference the DORA pairing if useful.)
4. Rewrite the OKR so the underlying *goal* sits above the proxy.

---

## Task 10 — Cargo-cult adoption

A proposal reads: *"Top tech companies do mandatory blameless post-mortems with a 5-page template for every incident, so we should require the same for all our incidents, including one-line config typos."*

1. Name the fallacy (and the related biases it fuses).
2. Cite the origin of the term and what it warns against.
3. Explain what "naming the goal, not the ritual" would change here — what's the *goal* of a post-mortem, and does a one-line typo need the full ritual to serve it?
4. Write a rebuttal that keeps the genuinely good practice while scoping the ritual to the goal.

---

## Task 11 — Mixed bag: name them all

Each line below contains a fallacy. For each, name it and give a one-line rebuttal.

```
a) "We've never had a security review and we've been fine, so we don't need one."
b) "Everyone's switching to GraphQL, REST is basically dead."
c) "The new junior broke prod once, so we shouldn't give juniors deploy access."
d) "If we add one feature flag, we'll end up with thousands and the code will be unmaintainable."
e) "On my last team Kafka solved everything, we should put Kafka in front of this."
f) "It's 2026, nobody writes synchronous code anymore — rewrite it all async."
```

1. For each of (a)–(f), name the fallacy.
2. Write a single-sentence rebuttal for each that turns the assertion into a question about your actual situation.
3. **Bonus:** which two of these are the time-based mirror pair, and which one is most likely to have a *true conclusion* despite the bad reasoning?

---

## Task 12 — Write the review-norm fix

You keep seeing the same fallacies recur across your org's RFCs and post-mortems: false dichotomies in "Options Considered," sunk-cost reasoning in migration docs, and post hoc "root causes" in incident reviews.

1. For each of the three recurring fallacies, propose **one concrete template field or required section** that makes it structurally harder to commit (not a rule someone has to remember, but a prompt the document forces).
2. For the Goodhart risk in OKRs, state the one-line norm you'd publish org-wide.
3. Explain in two sentences why *template/metric design* is higher-leverage than catching each fallacy individually in review.

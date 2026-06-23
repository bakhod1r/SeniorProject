# Total Cost of Ownership & Team Skills — Practice Tasks

Six reasoning exercises. **None of these involve writing code.** They train the muscle this topic is about: pricing a language choice across its whole life, in people and money, and refusing to let the cheap-and-visible cost (writing) crowd out the expensive-and-hidden ones (hiring, maintenance, operations). For each task, the deliverable is *a written argument with numbers and a stated conclusion*, the way you'd bring it to a lead or a leadership review. Use ranges, state your assumptions, and do a sensitivity check — which assumption, if wrong, flips your answer?

---

## Task 1 — Build a multi-year TCO model for two candidate languages

**Scenario.** A 10-engineer team is starting a new backend platform expected to live ~5 years. Two finalists:
- **Language M (mainstream):** large talent pool, fast to hire, well-tooled, moderate runtime efficiency. Slightly more verbose to write.
- **Language N (niche-but-loved):** smaller pool, beloved by its users, ~2× more runtime-efficient, strong type safety. Hiring is hard.

**Your job.** Build a 5-year TCO sketch for each across the seven lines: initial development, hiring (vacancy + recruiter), salary premium, onboarding/training, maintenance, operations, tooling. You may invent reasonable numbers — but state every assumption (loaded cost per engineer, time-to-fill for each, server count, salary delta, ramp weeks).

**Constraints.**
- Assume the team grows from 10 to ~25 engineers over the 5 years — so hiring and onboarding recur.
- Model operations at two scales: 50 servers and 1,000 servers. Report both.

**Deliverable.**
- A line-by-line table, M vs N, with your numbers.
- A one-paragraph conclusion: which wins, *at which scale*, and what N would have to deliver to justify its premium.

**What good looks like.** The model shows N losing at 50 servers (its compute savings are noise, its salary/onboarding premium is real) and possibly winning at 1,000 (compute savings now multiply into millions). The conclusion names the crossover, not a flat winner. A weak answer models only initial development and declares N's nicer code the tiebreaker.

**Worked starting point (fill in the rest).** Suppose loaded cost is $200k/engineer/year, N carries a +$18k/year salary premium, N adds 6 extra weeks of ramp per hire, and you make ~3 hires/year. Then N's salary premium alone over the growth curve (averaging ~17 engineers across 5 years) is roughly `$18k × 17 × 5 ≈ $1.53M`, and its extra onboarding is roughly `15 hires × 6 weeks × ($200k/52) ≈ $346k`. That's ~$1.9M of people-cost premium N must buy back. At 50 servers (~$1,800/yr each) N's 2× efficiency saves only `25 × $1,800 ≈ $45k/year` ≈ $225k over 5 years — nowhere near $1.9M. At 1,000 servers it saves `500 × $1,800 ≈ $900k/year` ≈ $4.5M — comfortably past it. The model's job is to surface exactly that comparison.

---

## Task 2 — Estimate hiring difficulty for a language + market

**Scenario.** Leadership wants to build a new team in **one** of these (language, city) pairs and asks you which is most *staffable*:
- (a) Go, in a major tech hub.
- (b) Elixir, in a mid-size non-hub city.
- (c) Rust, fully remote.
- (d) COBOL, anywhere.

**Your job.** For each, estimate: approximate talent-pool size (order of magnitude is fine), likely time-to-fill for a mid-level role, expected salary posture (baseline / premium / scarcity-driven), and the *vacancy cost* of an empty seat for that fill-time on a ~$160k role.

**Deliverable.**
- A ranked list, most-staffable to least, with a one-line rationale each.
- For COBOL specifically, explain *why* the salary is high despite low desirability — the answer is not "it's a great language."

**What good looks like.** You note that "remote" enlarges Rust's effective pool dramatically (it changes the market, not just the location), that Elixir-in-a-small-city is the hardest combination (small pool × small geography), and that COBOL's premium is a *scarcity-and-domain* premium (retiring workforce, runs banks) rather than a quality signal. You convert time-to-fill into a dollar vacancy cost, not just "longer."

**Stretch.** For each pair, add the *second-order* hiring effects most people miss: the small/niche pools force you to either relocate candidates (relocation cost + longer close) or train from adjacent skills (Elixir from Ruby, Rust from C++) — and training is a real line, not a free fallback. Note which pairs realistically *require* a training pipeline rather than a hiring one, and price that pipeline. The deliverable's value is showing leadership that "we'll just hire for it" is, for two of these four, not actually an option.

---

## Task 3 — Calculate the cloud-compute cost difference at scale

**Scenario.** A service is being designed. The team can write it in an interpreted language they know well, or a compiled language that benchmarks ~3.5× more CPU-efficient for this CPU-bound workload but that they'd have to learn.

**Your job.** Do the arithmetic at three scales and decide, *at each scale*, whether the compute savings justify the cost of learning/maintaining the faster language.

**Given (use these or your own, stated):**
- Interpreted version needs: 20 servers (small), 200 (mid), 2,000 (large).
- Server cost: ~$1,800/year all-in.
- One loaded engineer: ~$200,000/year.
- Learning + slower-delivery cost of the compiled language for this team: ~$300,000 one-time, plus a modestly higher ongoing maintenance burden you should estimate.

**Deliverable.**
- A table: for each scale, interpreted compute cost, compiled compute cost (÷3.5), annual saving, and years-to-payback against the $300k learning cost.
- A verdict per scale: ignore / debatable / clear win.

**What good looks like.** At 20 servers the saving (~$26k/yr) never pays back the $300k in any reasonable horizon → ignore, optimize for the people. At 2,000 servers the saving (~$2.6M/yr) pays back the learning cost in *weeks* → clear win, the compute cost has flipped the decision. The mid case is genuinely debatable and you say so. The lesson: the same technical fact (3.5× efficiency) yields opposite decisions at different scales.

**Sensitivity check (required).** State which single number, if you got it wrong, would flip your verdict in the *mid* case — almost certainly the server count and the efficiency ratio. Show what 200 servers at 2.5× (instead of 3.5×) does to the payback. The point of the exercise is not the specific dollars; it's internalizing that "the compiled language is more efficient" is a *true and frequently irrelevant* statement until you multiply it by your actual fleet and compare it to a real one-time and ongoing people cost.

---

## Task 4 — Critique a decision that ignored ownership cost

**Scenario.** Read this real-sounding decision record and tear it apart on TCO grounds.

```
ADR-031: New analytics service language

Decision: Build the new analytics service in <NicheLang>.

Rationale:
- It's the fastest language in our benchmark for this workload.
- The syntax is elegant and the team is excited to learn it.
- Sara (our senior engineer) has used it before and loves it.
- We'll save on cloud costs because it's so efficient.

Consequences: TBD.
```

**Your job.** Write the critique you'd post on this ADR. Identify every ownership cost the rationale ignored, and rewrite the "Consequences" section to be honest.

**Deliverable.**
- A bulleted critique naming at least five missed costs/risks.
- A rewritten "Consequences" section.

**What good looks like.** You catch: (1) bus factor of 1 — the whole thing rests on Sara; what happens when she leaves? (2) hiring — can we *staff* this beyond Sara, and how long is time-to-fill? (3) onboarding — every future hire must learn it; the team's "excitement" is a sprint-1 cost, not a 5-year one. (4) "save on cloud costs" — quantified? At this service's scale, is the saving even meaningful, or noise next to one salary? (5) sprawl — this adds the N+1 language to the org's fixed overhead (pipeline, tooling, on-call) for *one* service, the worst per-line ratio. (6) the benchmark measures the cheapest variable. Your rewritten consequences name the bus-factor risk, the hiring exposure, and a revisit trigger.

---

## Task 5 — Build the people-cost side of a selection

**Scenario.** Two candidate languages have already scored *tied* on the technical/problem-fit axis of a weighted matrix (see [`01-language-selection-criteria`](../01-language-selection-criteria/)). The decision now turns entirely on **people cost.** The org is a fast-growing startup planning to triple engineering headcount in 18 months.

**Your job.** Construct the people-cost comparison that breaks the tie. Cover: hireability (pool size, time-to-fill against an *aggressive* hiring plan), onboarding/ramp multiplied by the hiring rate, salary premium over 18 months at the projected headcount, bus-factor/key-person risk, and the recruiting/retention effect of each language.

**Deliverable.**
- A people-cost comparison table.
- A recommendation that explicitly weighs the *aggressive growth plan* — and a note on whether hireability has crossed from "cost" into "constraint" for this company.

**What good looks like.** You recognize that tripling headcount in 18 months makes hireability potentially a *constraint*, not a line item — a language you can't hire fast enough for could stall the entire plan regardless of its other virtues. You multiply onboarding by the (large) hiring rate to show it dwarfs the per-hire figure. You acknowledge the recruiting-magnet effect of the more-loved language as real but note it helps attract the few stars, not the volume the growth plan needs. The recommendation favors hireability at this growth rate and says why explicitly.

---

## Task 6 — Standardization business case for leadership

**Scenario.** Your 250-engineer org runs five backend languages, several with only one or two services each. You believe consolidating to two would save money and reduce risk. You have one meeting with a skeptical VP of Engineering and the CFO.

**Your job.** Write the one-page business case. It must be in *money, risk, and time* — not language merits.

**Deliverable.** A structured case with five parts:
1. **The decision** (specific: which two stay, what gets migrated, over what window).
2. **The upfront cost** (honest migration + training estimate — invent numbers, state them; padding loses trust).
3. **The recurring saving** (fewer hiring pipelines, lower onboarding, engineer fungibility expressed in *headcount* terms, fewer toolchains to secure/patch, shared libraries).
4. **The risk reduced** (bus factor on the one-off-language services; key-person exposure).
5. **The horizon** (break-even estimate + a revisit trigger).

**Constraints.**
- You must include the *honest trade-off*: standardizing means sometimes using a slightly-less-ideal language per problem to keep the set small.
- You must use the fixed-overhead argument: a little-used language is the *most* expensive per line.

**What good looks like.** The case leads with recurring savings and risk reduced (what leadership funds), quantifies fungibility as "we can staff any priority from the existing org instead of hiring," is honest about the migration cost and the per-problem-fit trade, and attaches a revisit trigger. It does *not* argue that the two surviving languages are technically superior — that's the wrong currency for this audience. A weak answer is a paragraph about why Go is a nicer language than the others, which the CFO cannot act on.

---

**How to use these tasks:** the goal across all six is to make hidden costs *visible and numeric*. Do at least one of Tasks 1–3 (the modeling muscle) and one of Tasks 4–6 (the judgment-and-persuasion muscle). For every task, end with a stated conclusion and a sensitivity check — naming the single assumption that, if wrong, would flip your answer. That habit is the difference between analysis and a spreadsheet that launders a pre-made opinion.

**Memorize this:** in every exercise the move is the same — convert "which language is better" into "what does it cost the team, over years, at our scale, and what happens when we're wrong," then put numbers on the parts of the iceberg under the water. The writing experience is the cheapest line; hiring, maintenance, and (at scale) operations are where the money and the decision actually live.

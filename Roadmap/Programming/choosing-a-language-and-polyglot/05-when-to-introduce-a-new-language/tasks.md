# When to Introduce a New Language — Practice Tasks

Seven reasoning exercises. **None of these involve writing code.** They train the judgment this topic is about: deciding new-language vs new-library, itemizing the perpetual cost, designing the governance, and resisting the human pulls (shiny-thing, résumé-driven, sunk cost). Each task gives you a scenario or artifact and asks you to *reason on paper* — write a memo, fill a table, draft a document, critique an argument. Work them with the bias-against as your default and make the proposer earn the yes.

---

## Task 1 — New-language or new-library? Five verdicts

For each of the five proposals below, write a short verdict (3–5 sentences) that decides: **new language**, **new library / architecture change**, or **needs measurement first** — and justify it. Name the cheaper fix where one exists.

1. *"Our Python data API is slow on a heavy aggregation endpoint. We should rewrite the whole service in Go."*
2. *"We need to ship a feature that runs entirely in the user's browser with no server round-trip."*
3. *"Our Node service pegs one CPU core during PDF generation and falls over under load. We should adopt Rust for it."*
4. *"We're building a recommendation model and our backend is Java. We should bring in Python."*
5. *"Our Java CLI tool takes 800ms to start, which annoys users. We should rewrite it in Go for instant startup."*

**What good looks like.**
- [ ] At least one proposal is correctly a clean **new-language** trigger (hint: #2 is a hard platform requirement; #4 is a domain-ecosystem trigger).
- [ ] At least one is correctly a **new-library / architecture** fix (the aggregation in #1 is likely a query/index/caching problem; the CPU work in #3 might be a worker pool or offloading, or genuinely a perf trigger after measurement).
- [ ] At least one is flagged **needs measurement** before any verdict (#1 and #3 both — "slow" and "pegs a core" aren't numbers).
- [ ] #5 names the cheaper fix (GraalVM native-image, AppCDS, or trimming startup work) before conceding any new-language case.

**Trap to avoid.** Treating "slow" or "falls over" as a trigger. A trigger is *measured* and *fundamental to the language*, not a feeling about current behavior.

---

## Task 2 — Write the cost side of an N+1 analysis

Your team (8 engineers, currently all-TypeScript on Node) is seriously considering adding **Go** for a new high-throughput gateway. The proposer has written a glowing one-page benefit case. Your job is the part they skipped: **the full cost side.**

Produce a table with one row per N+1 tax line. For each, write (a) what specifically gets duplicated, and (b) whether it's a **one-time entry cost** or a **recurring carry cost**.

**Required rows (don't omit any):**
- Toolchain, CI/CD, dependency-security surface, observability, on-call knowledge, hiring filter, internal shared libraries, idioms/review expertise.

**Then answer in prose:**
- [ ] Which line is the most *underestimated* for this specific team, and why? (Hint: think about their internal shared libraries — auth, config, metrics — all currently TS-only.)
- [ ] Estimate, in rough FTE terms, the *recurring* annual carry cost. You don't need precision — you need to make the perpetual cost *visible* as a number the proposer's benefit must beat.
- [ ] State the comparison correctly: the benefit must beat the **carry cost over time**, not the entry cost alone. Explain why comparing benefit to entry cost is the classic mistake.

**What good looks like.** The most-underestimated line is the internal-library fragmentation (they'll either port auth/config/metrics to Go or let the Go service do without them — both expensive and usually discovered post-launch). The carry-cost number is rough but explicit (e.g. "~0.5–1.0 FTE/year spread across platform work, forever").

---

## Task 3 — Design a language-adoption RFC template

Your org has no process for adopting languages — it happens by Slack consensus, and you've quietly become a four-language shop. Design a **reusable RFC template** that any team must fill out to propose a new language. Write it as a markdown document with section headers and a one-line prompt under each.

**Required sections (at minimum):**
- [ ] **Problem & trigger** — which of the four triggers (hard platform / domain ecosystem / measured performance / fundamental safety) applies; if none, the RFC stops.
- [ ] **Why not a library or architecture change?** — make this **mandatory** and explain in a comment why it's the section most likely to be skipped and most important to enforce.
- [ ] **N+1 cost** — itemized, with a *named owning team* for the perpetual carry.
- [ ] **Scope & tier requested** — team pilot vs org blessing; which services.
- [ ] **Exit criteria & revert plan** — numeric, dated, with revert as the default outcome.
- [ ] **Blast radius & reversibility** — clean boundary? what depends on it?
- [ ] **Decision** — approvers, date, tier granted, review date.

**Then answer:**
- [ ] Who must approve, and why is single-person approval dangerous here?
- [ ] What makes a Tier-3 *pilot* easy to approve but a Tier-1 *promotion* hard? Tie this to the difference between a contained bet and a perpetual cost.

**Trap to avoid.** An RFC that's a formality everyone passes. Note in your answer how you'd keep it a real gate (if your last ten RFCs all said yes, you don't have a gate).

---

## Task 4 — Critique a résumé-driven adoption

Read this real-shaped proposal and write a **critique memo** (250–400 words) you'd send the author privately.

> *"I think we should rewrite our order-processing service in Rust. Rust is the most-loved language on the developer survey for nine years running, it's memory-safe, blazingly fast, and honestly the team needs to level up — we're falling behind the industry writing boring Java. I've already prototyped the core in a weekend and it's beautiful. We could be done in a couple sprints. This would also make us way more attractive to senior hires who want to work in modern languages."*

**Your critique must:**
- [ ] Identify every argument that's about the **language in the abstract** or the **engineers' careers**, not about the **system's needs**.
- [ ] Name the **résumé-driven** and **shiny-thing** pulls explicitly — but in a way that addresses the *argument*, not attacks the *person*.
- [ ] Point out what's *missing*: any measured trigger, any "why not a library?", any N+1 cost, any exit plan.
- [ ] Flag the "couple of sprints" estimate as costing the *write*, not the *run* (a memory-safe rewrite of order-processing — a critical money path — is not a couple-sprint job, and the rewrite is the cheap part vs owning Rust forever).
- [ ] End **constructively** — offer a contained path (a low-stakes pilot, or redirect the "level up" energy into the existing stack) so the author isn't crushed.

**What good looks like.** You've separated the language (genuinely good) from the decision (unjustified as presented), and you've turned a deflating "no" into "here's what would make this a real proposal, and here's a safe way to scratch the itch."

---

## Task 5 — Define exit criteria for a pilot

A team got approval to pilot **Elixir** for a real-time notification fan-out service (their stack is Ruby; the trigger is a measured concurrency limit Ruby couldn't meet). They're about to start coding with no exit plan. Write the **exit-criteria document** for them *before* a line is written.

**Your document must include:**
- [ ] **Success criteria** — at least 3, each **numeric and dated**, that must *all* hold to adopt more broadly. (Include at least one *non-performance* criterion — e.g. bus factor, maintainability, on-call independence.)
- [ ] **Failure criteria** — at least 2, each numeric/dated, *any* of which triggers a revert.
- [ ] **Revert plan designed now** — how the service stays revertible (clean boundary, keep the old path buildable), and a rough revert-effort estimate.
- [ ] A one-line statement that the **default outcome is revert** unless success criteria are met.

**Then answer in prose:**
- [ ] Why must these be written *before* coding starts, not after? (Tie to the sunk-cost trap and to being honest while uninvested.)
- [ ] Three months in, the service hits its concurrency target but only the original author can safely change it. Which criterion does this fail, and what's your call?

**Trap to avoid.** Vague criteria like "if it's going well." "Going well" is not a criterion; "≥ 50k concurrent connections/node by March 1 *and* two non-author engineers have shipped a change" is.

---

## Task 6 — The slippery-slope audit

You've inherited an 18-person org that has, over four years, accumulated **five languages**: Python (original), Go ("just for one gateway"), Rust ("a perf-critical proxy"), Scala (came in via an acquisition), and a little Kotlin (one enthusiast, one service). Each was individually defensible at the time. Write a **remediation plan**.

**Your plan must:**
- [ ] Assess each language against: is there still a *live trigger*? who *owns* it? what's the *bus factor*? how much does each cost to carry?
- [ ] Propose a **target supported-languages list** with tiers (Tier 1 paved-road / Tier 2 domain-allowed / Tier 4 sunset), and justify the count against the team size of 18.
- [ ] For each language you'd **sunset**, sketch the removal: deprecate-with-date, inventory, *funded* migration (strangler-fig, not big-bang), hard end-of-support date.
- [ ] Name which language is most likely a **"temporary became permanent"** case and which is a **bus-factor-of-one** liability, and how you'd handle each.

**Then answer:**
- [ ] How do you explain to the Rust enthusiast that their proxy is being sunset, without losing them? (Apply the "no" politics — separate person from decision, show the carry cost, offer something.)
- [ ] Why is "we'll just keep all five, they all work" the *wrong* default for an 18-person org? (Tie to fragmentation scaling faster than headcount.)

**What good looks like.** A target list of ~2–3 languages, an explicit sunset for the rest with *funded* migrations, and an honest read that the Kotlin-one-enthusiast service is the bus-factor liability and the acquired Scala is the "permanent by inertia" case.

---

## Task 7 — The acquisition decision

Your company (a Go shop, ~40 engineers, a real platform team) just acquired a 6-person startup whose entire product is in **Clojure**. Leadership asks: *"What do we do with their stack?"* Write a **decision memo** (300–500 words).

**Your memo must:**
- [ ] Reject the unspoken default ("keep whatever they had") explicitly, and explain why inheriting a language by inertia is how the count silently explodes.
- [ ] Lay out the three real options — **adopt** (fund Clojure as a real tier), **migrate** (strangler-fig onto Go), **wall-off** (contained service boundary, explicit owner, review date) — with the conditions under which each is right.
- [ ] Account for the **6 acquired engineers**: are they enough to carry a Clojure paved road? Does adopting retain them; does migrating risk losing them? Make the people cost explicit.
- [ ] Pick a recommendation and defend it, including the carry cost you're knowingly accepting or the migration cost you're knowingly funding.
- [ ] Note *why the acquisition moment is the right time to decide* — the boundaries are still clean, and the decision gets harder every month you defer.

**What good looks like.** A clear recommendation (any of the three can be defensible depending on your stated assumptions about the acquired team's size, the product's strategic value, and Clojure's bus factor) that treats inherited code as subject to the *same governance* as any new-language proposal, and that makes the perpetual cost or the migration cost an explicit, owned line — never an accident.

---

## Validation

| Task | How to check your answer |
|------|--------------|
| 1 | Each verdict names a trigger *or* a cheaper fix; #2/#4 are new-language, #1/#3 need measurement, #5 names GraalVM/AppCDS first. |
| 2 | All 8 tax lines present, each tagged one-time vs recurring; internal-libs flagged as most underestimated; carry cost stated as a number. |
| 3 | "Why not a library?" is marked mandatory; multi-approver with platform lead; pilot-easy / promotion-hard distinction explained. |
| 4 | Every abstract/career argument tagged; RDD + shiny-thing named without attacking the person; missing trigger/cost/exit called out; ends with a contained path. |
| 5 | ≥3 dated numeric success criteria incl. one non-perf; ≥2 failure criteria; revert plan + default-is-revert; the bus-factor-of-one case fails a maintainability criterion → revert or extend, not auto-adopt. |
| 6 | Target list ~2–3 languages justified against 18 people; funded sunsets with end-of-support dates; Kotlin = bus-factor-1, Scala = permanent-by-inertia. |
| 7 | Default rejected; three options with conditions; 6-engineer people cost explicit; clear defended recommendation; "decide now while boundaries are clean." |

---

## A meta-check before you submit any task

For every "yes, add the language" you wrote, ask:

- Did I argue **"better enough to justify a perpetual second of everything"**, or did I sneak in a "this language is better" and call it done?
- Did I check the **library/architecture fix** first, or jump to the new toolchain?
- Did I write **how we get out** before I wrote that we'd get in?
- Did I count the **carry cost over time**, or just the one-time entry?
- If I said **no**, did I leave the person a contained yes or a redirect, or just crush them?

If every "yes" survives those five questions and every "no" is reasoned and humane, you've internalized the discipline.

---

**Memorize this:** the exercises all train one reflex — reach for the cost sheet and the library fix *before* the shiny new toolchain. A defensible "yes" clears the perpetual-carry bar, rules out the cheaper fix, ships with a written exit plan, and stays revertible; a defensible "no" shows the cost and offers a contained path. Bias against, govern the count, and decide the exit before the entry.

# Language Longevity & Lock-In Risk — Practice Tasks

Six reasoning exercises. **No coding.** Each forces you to make a longevity or lock-in judgment explicit — to build a scorecard, map a risk, or design an escape hatch — and defend it. Work them on paper or in a doc; the deliverable is *reasoning you could show a staff engineer*, not a number.

---

## Task 1 — Build a longevity scorecard

Pick a language you might bet a 10-year system on (e.g., Go, Rust, Kotlin, Elixir, Python). Build a **longevity scorecard** from the assessment dimensions in [`middle.md`](middle.md).

**Deliverable.** A filled table:

| Dimension | What you found (evidence) | Score 1–5 | Notes |
|---|---|---:|---|
| Governance (who controls it?) | | | foundation / single-vendor / BDFL? |
| Release cadence | | | predictable rhythm? |
| Backward-compat track record | | | upgrade tax history |
| Community size **and trend** | | | direction matters more than size |
| Production adoption breadth | | | how many *diverse* industries? |
| Position on maturity curve | | | emerging / growth / mature / declining |

**Constraints.**
- Every score must be backed by a *specific* fact ("Go 1 compatibility promise, code from 2012 still compiles"), not a feeling.
- For the governance row, explicitly state the **single-vendor risk** if any, and name the antidote (external adoption breadth) if it applies.

**Acceptance.**
- [ ] No score lacks a concrete evidence cell.
- [ ] You've written one sentence answering the real question: *"Will this be healthy in 10 years, and why?"*
- [ ] You've named at least one **risk** to the bet, not just strengths.

**Bonus.** Do a second language and put them side by side. Notice that the *winner* depends on the system's lifespan — a 2-year service and a 20-year platform may score the same language differently.

**Self-check.** Read your scorecard back and ask: did any cell rest on "it's popular" or "it feels modern"? If so, you scored *buzz*, not *health* — replace it with an institutional fact (a governance model, a compatibility promise, a named production user). The whole point of the exercise is to train yourself to look *past* the vibe to the institution underneath.

---

## Task 2 — Map the three lock-in dimensions of a stack

Here is a described stack:

> A **Kotlin** service using **Spring Boot**, deployed on **AWS** with **DynamoDB** for storage, **SQS** for queues, **Lambda** for compute, and **CloudWatch** for observability. The team has built 6 years of internal Kotlin/Spring libraries.

**Deliverable.** Fill the lock-in map (the three axes from [`middle.md`](middle.md)):

| Dimension | Locked into what here? | Severity (L/M/H) | Why |
|---|---|---|---|
| Language lock-in | | | |
| Framework lock-in | | | |
| Platform/vendor lock-in | | | |
| Skills/org lock-in *(from [`professional.md`](professional.md))* | | | |

**Constraints.**
- For each axis, estimate the *escape action* (rewrite / re-architect / re-platform / retrain) and roughly how expensive it is relative to the others.
- Identify the **single biggest real risk** — and note whether it's the one the team would *instinctively* worry about (usually they fear "the language" while the real trap is the platform).

**Acceptance.**
- [ ] All four axes assessed independently — you did not collapse them into one "it's locked in" verdict.
- [ ] You named which layer is *cheapest* to leave and which is *most expensive*.
- [ ] You explained how the layers **compound** for this stack.

**Bonus.** Re-map the *same* stack as if it were instead a Python service on a self-hosted PostgreSQL with no proprietary cloud services. Notice how the platform-lock-in axis collapses from High to Low while the others barely move — proving the axes really are independent, and that *most* of this stack's lock-in lives in the AWS-proprietary choices, not the language. That single comparison is the strongest argument for isolating vendor code (Task 4).

---

## Task 3 — Assess single-vendor risk of a corporate-backed language

For each language below, assess single-vendor risk using the senior framing: **how central to the sponsor's business × how concentrated the control ÷ how much independent external adoption exists.**

- **Swift** (Apple)
- **Go** (Google)
- **.NET / C#** (Microsoft)
- **Dart/Flutter** (Google)

**Deliverable.** For each: a one-paragraph verdict ending in a risk rating (Low / Medium / High) *as a general-purpose bet*, with the antidote (or lack of one) named.

**Constraints.**
- You must distinguish *abandonment risk* (will the sponsor kill it?) from *concentration risk* (could the wider world keep it alive if they did?).
- Explicitly contrast at least two of them to show the antidote in action (e.g., why Go's external adoption de-risks it more than Swift's).

**Acceptance.**
- [ ] Each verdict cites **external adoption breadth** as the deciding factor, not just "it's backed by a big company."
- [ ] You flagged at least one case where the language is safe *within* a context but risky *as a general bet* (Swift on Apple platforms).

**Bonus.** Add **Ruby** (BDFL/community) and **C** (standards/ISO). Note how *non*-corporate governance changes the risk shape entirely — and why standards-based C sits at the durability ceiling.

---

## Task 4 — Design an escape-hatch architecture for portability

You're starting a new core service expected to live 10+ years. It must use a cloud object store, a cloud queue, and a cloud-managed database. Leadership wants the option to change cloud providers later without a rewrite.

**Deliverable.** A short design (prose + a simple diagram or pseudo-interfaces) showing **how you'd isolate the vendor-specific code** so a future re-platform is bounded.

**Constraints.**
- Apply ports-and-adapters / anti-corruption-layer thinking from [`senior.md`](senior.md): business logic depends on *your* interfaces, vendor SDKs live only in adapters.
- State *what stays portable* and *what is the seam you'd cut along* if you migrated.
- Be honest about the **cost** of this optionality (indirection, the data-model mismatch you can't fully abstract — e.g., DynamoDB's model isn't free to move) and say where you'd *stop* abstracting.

**Acceptance.**
- [ ] At least one concrete interface boundary shown (e.g., `interface ObjectStore { save/load }` with one vendor adapter).
- [ ] You stated the bounded migration cost ("re-platform = write N new adapters, not touch business logic").
- [ ] You identified a place where abstraction *isn't* worth it and explained why (right-sizing the option, per [`professional.md`](professional.md)).

**Bonus.** Decide whether you'd also abstract the *language* away. Argue why you (probably) wouldn't — it's the cheapest layer to move and the one you're least likely to leave.

---

## Task 5 — Boring-stable vs. declining: classify these languages

For each language, classify it as **Mature/"boring" (stable, good bet)** or **Declining (bad bet)**, using the senior discriminators — *why* change slowed, new-project adoption, hiring trend, library vitality, sentiment.

- **C**
- **Perl**
- **Java**
- **CoffeeScript**
- **Objective-C**
- **COBOL**
- **Python**

**Deliverable.** A table: Language | Mature or Declining | The one fact that decides it | What new-project adoption looks like today.

**Constraints.**
- Your deciding fact must address *cause* of slow change, not just "it's old" or "it's not trendy."
- For at least one, explain how it could be *mistaken* for the other class (e.g., why someone might wrongly call Java "dying" or wrongly trust Perl because "it's been around forever").

**Acceptance.**
- [ ] You used **"is anyone starting new projects in it?"** as the primary test.
- [ ] You correctly placed C/Java/Python as mature-and-thriving (slow change = settled design) and Perl/CoffeeScript as declining.
- [ ] You handled the nuanced cases: **Objective-C** (vendor-steered managed decline) and **COBOL** (declining *and* trapped — the danger quadrant).

---

## Task 6 — Communicate a longevity risk to leadership

Your org built its flagship product on a single-vendor language whose sponsor has just re-orged the team and slowed releases. Hiring is getting harder. You need to recommend a hedge to non-technical leadership.

**Deliverable.** A one-page brief (5–8 sentences) that a VP could read, using the translation table from [`professional.md`](professional.md).

**Constraints.**
- Translate every engineering concern into **dollars, months, and risk** — no governance/compatibility jargon.
- **Quantify the exit cost** (even a rough range) so it's a board-legible risk weighable against others.
- Include a **trigger** that would escalate the hedge, and frame any "boring" recommendation as **de-risking**, not conservatism.
- State the **assumption** the original bet rests on (sponsor's continued investment) and that you're now monitoring it.

**Acceptance.**
- [ ] Zero engineering jargon a VP wouldn't parse.
- [ ] A concrete exit-cost estimate in money and time.
- [ ] An explicit revisit/escalation trigger.
- [ ] "Boring/proven/widely-adopted" framed as *reducing delivery and staffing risk*, not as caution.

**Bonus.** Add the **ecosystem hedge** if applicable (from [`professional.md`](professional.md)): if the language sits on a durable ecosystem like the JVM, explain to leadership why the situation is far less dire than it sounds — the platform investment survives a language switch.

---

## Task 7 — Place a stack in the health × escape-cost matrix

Recall the danger matrix from [`senior.md`](senior.md): the two axes are *how healthy is the language* and *how expensive is it to leave*, and the bottom-right quadrant (declining × hard-to-escape) is the COBOL trap.

You are handed four real-ish situations:

- **(A)** A 2-year-old internal tool written in Python, ~3k lines, no proprietary services.
- **(B)** A 15-year-old core banking system in COBOL, millions of lines, business rules buried in it, experts retiring.
- **(C)** A new Kotlin/JVM service, clean boundaries, but fused to one cloud's proprietary database.
- **(D)** A mature Java monolith, 500k lines, deeply coupled to a framework, but the language and ecosystem are thriving.

**Deliverable.** Place each in the 2×2 matrix and write one sentence per situation justifying the placement, then state which one is in the **danger zone** and what you'd do about it first.

**Constraints.**
- Health and escape cost are *separate* axes — a healthy language can still have a brutal escape cost (D), and a dying one can be cheap to leave (A if it were declining).
- For at least one, distinguish *which axis* of escape cost dominates (language vs. framework vs. platform).

**Acceptance.**
- [ ] All four placed with a justification that addresses *both* axes.
- [ ] You correctly identified B as the danger quadrant and proposed acting *before* the talent pool fully collapses.
- [ ] You noted that C's risk is the *platform*, not the (healthy) language — the trap the team would least expect.

**Bonus.** For D, explain why "the language is fine, the *framework* is the lock-in" changes the mitigation entirely (re-architecture within Java, not a rewrite).

---

## Task 8 — Pre-mortem a healthy-today language bet

Pick a language that is *clearly healthy today* (Go, Rust, TypeScript). Run a **pre-mortem**: assume it's the year 2036 and your decade-long bet on it went *badly*. Write the story of *how* it failed.

**Deliverable.** A short failure narrative (5–8 sentences) that names a *specific, plausible* mechanism — not "it just got unpopular."

**Constraints.**
- Ground the failure in a real risk dimension from this topic: a single sponsor losing interest, a breaking-compat schism, a successor language absorbing it (the CoffeeScript pattern), an ecosystem that never reached critical mass in your domain, or a platform decision killing it on someone else's schedule (the Flash pattern).
- End with the *leading indicator* you'd have watched for to catch the turn early — and the hedge you'd have had in place.

**Acceptance.**
- [ ] The failure mechanism is specific and tied to a named risk dimension, not generic "it died."
- [ ] You named a concrete leading indicator (falling new-project adoption, slowing releases, sponsor re-org, harder hiring).
- [ ] You named the hedge that would have bounded the damage (ecosystem bet, isolated vendor code, clean service boundaries).

**Why this matters.** A pre-mortem forces you to take a *healthy* language seriously as a *bet* with failure modes — the exact discipline that separates "Go is great, ship it" from "Go is a strong bet *and* here's the assumption it rests on and the trigger that'd make me revisit." Every bet, even a good one, deserves a written failure story.

---

## Summary

These exercises drill the four senior moves: (1) **assess longevity from the institution** with evidence, not vibes; (2) **separate the lock-in axes** and find the real, often-unspoken risk; (3) **engineer bounded escape hatches** by isolating vendor code; and (4) **communicate the risk in business terms.** If you can do all four on a stack you're handed cold, you can own a decade-long language bet.

---

**Memorize this:** every judgment here reduces to two axes — *how healthy is the language* and *how expensive is it to leave* — and the dangerous quadrant is declining-and-hard-to-escape (COBOL). Build the scorecard from evidence, map lock-in across language/framework/platform/skills, name the single-vendor antidote (external adoption), and architect the escape seam *before* you need it. Then translate it all into dollars, months, and risk.

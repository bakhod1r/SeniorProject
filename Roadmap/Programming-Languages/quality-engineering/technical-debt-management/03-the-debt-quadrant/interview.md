# The Debt Quadrant — Interview Questions

> **Roadmap:** [Technical Debt Management](../README.md) → The Debt Quadrant
> *A debt-quadrant interview rarely asks "draw Fowler's grid." It hands you a messy situation — "we shipped a hack to hit a launch date, knowing it was wrong" — and watches whether you can place it on two axes (deliberate/inadvertent × reckless/prudent), justify the placement, prescribe the right *response* for that cell, and then admit where the model stops being useful. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Quadrant Basics](#theme-1--the-quadrant-basics)
3. [Theme 2 — Response Per Cell](#theme-2--response-per-cell)
4. [Theme 3 — Cunningham vs the Popular Reading](#theme-3--cunningham-vs-the-popular-reading)
5. [Theme 4 — Limits and Criticism](#theme-4--limits-and-criticism)
6. [Theme 5 — Classification Scenarios](#theme-5--classification-scenarios)
7. [Theme 6 — Org and Judgment](#theme-6--org-and-judgment)
8. [Theme 7 — Other Taxonomies](#theme-7--other-taxonomies)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **deliberate vs inadvertent** (did we *choose* this, or did we not know better?)
- **reckless vs prudent** (was the trade-off weighed, or skipped?)
- **the debt vs the interest** (the shortcut itself vs the slowdown it imposes every time you touch the area)
- **classification vs response** (naming a cell vs knowing it demands a *different reaction*)

Nearly every question in this bank is one of those distinctions wearing a costume. The candidates who do well are the ones who place the situation on the *two axes explicitly* — and who know that the quadrant's job is not to label blame but to **prescribe a response**, and that the only cell signalling a real problem is **reckless**.

The canonical source is Martin Fowler's 2009 bliki post *"Technical Debt Quadrant."* Where the popular reading drifts from what Ward Cunningham actually meant, the answers say so.

---

## Theme 1 — The Quadrant Basics

### Q1.1 — Draw Fowler's Technical Debt Quadrant. What are the two axes and the four cells?

> **Testing:** Do you have the model precisely, or a fuzzy "good debt / bad debt" memory of it?

**A.** It's a 2×2 with two *independent* axes:

- **Deliberate ↔ Inadvertent** — *did we make a conscious decision to incur debt?* Deliberate means we knew we were taking a shortcut. Inadvertent means the debt arrived without a decision — usually because we didn't know better at the time.
- **Reckless ↔ Prudent** — *did we weigh the trade-off?* Reckless means the cost/benefit was never considered. Prudent means we understood the consequences and judged the debt worth it.

That gives four cells, each with Fowler's canonical one-liner:

| | **Reckless** | **Prudent** |
|---|---|---|
| **Deliberate** | "We don't have time for design" | "We must ship now and deal with consequences" |
| **Inadvertent** | "What's layering?" | "Now we know how we should have done it" |

The crucial point most candidates miss: the axes are **orthogonal**. "Deliberate" is not a synonym for "bad" and "inadvertent" is not a synonym for "innocent." You can be deliberately reckless *and* deliberately prudent; you can be inadvertently reckless *and* inadvertently prudent. The combination is what tells you how to react.

### Q1.2 — Recite Fowler's four quotes and explain what each cell *feels like* in practice.

> **Testing:** Whether you can connect the abstract grid to lived engineering situations.

**A.**

- **Deliberate–Reckless — "We don't have time for design."** A team that knows design exists, knows it's skipping it, and skips it anyway with no real justification beyond schedule pressure. This is the danger cell: a conscious decision to take on debt *without weighing the cost*. It usually signals a broken process or culture, not a one-off.
- **Deliberate–Prudent — "We must ship now and deal with the consequences."** The team understands the trade-off, has a reason (a market window, a deadline that genuinely matters), and *chooses* the debt with eyes open. This is legitimate, often correct, engineering. The defining feature is that they know there *will* be consequences and accept them.
- **Inadvertent–Reckless — "What's layering?"** The team ships a tangled design and doesn't even realize a better structure exists. No decision was made because the team lacked the knowledge to make one. This is the cell driven by inexperience — and Fowler notes it's *more common than you'd hope*, even among teams that consider themselves skilled.
- **Inadvertent–Prudent — "Now we know how we should have done it."** The team did its honest best with what it understood at the time, shipped, *learned* from building it, and only in hindsight sees the better design. This is the cell Fowler treats as essentially unavoidable and the one closest to Cunningham's original metaphor.

### Q1.3 — Why did Fowler create the quadrant at all? What was he reacting to?

> **Testing:** Whether you know the model's purpose, not just its shape.

**A.** Fowler built the quadrant to settle a recurring argument: *is taking on technical debt ever acceptable?* One camp said all debt is sloppiness; another said debt is just pragmatism. Fowler's point was that **both are right about different debt** — the disagreement was caused by people using one word for several distinct phenomena. The quadrant disambiguates them. Its real value is that it converts a moral argument ("is debt good or bad?") into a diagnostic one ("*which kind* of debt is this, and therefore what should we do?"). It's a thinking tool for choosing a response, not a scorecard for assigning blame.

### Q1.4 — Are the two axes really independent? Give an example that proves it.

> **Testing:** The single most common misconception — collapsing the two axes into one "bad-debt" axis.

**A.** Yes, fully independent, and the proof is that all four combinations occur in the wild:

- *Deliberate + Prudent*: "We'll hardcode the single supported currency to hit the launch, and generalize next quarter." A weighed, conscious shortcut.
- *Deliberate + Reckless*: "Skip the tests, just ship it" — conscious, but the cost was never weighed.
- *Inadvertent + Prudent*: a careful team builds a clean module, ships it, and a month of real usage reveals the right abstraction they couldn't have seen up front.
- *Inadvertent + Reckless*: a junior copies a god-class pattern across the codebase, unaware that layering exists.

If the axes weren't independent, two of those four boxes would be empty. They're not — so "deliberate" tells you about *decision-making* and "reckless" tells you about *judgment quality*, and they vary separately.

---

## Theme 2 — Response Per Cell

### Q2.1 — Why is the *response* to each cell different? Isn't debt just debt?

> **Testing:** Whether you grasp that the quadrant is a routing function, not a label.

**A.** Because the cell tells you *what kind of fix the situation needs*, and the fixes are categorically different:

- **Reckless cells** (either row) signal a **systemic or process problem**. The shortcut itself is a symptom; the disease is that trade-offs aren't being weighed or that the team can't recognize a bad design. You don't fix this by refactoring one module — you fix it by changing how decisions get made (deliberate-reckless) or by raising the team's capability (inadvertent-reckless).
- **Prudent cells** signal **normal, healthy engineering**. Deliberate-prudent debt is a financing decision; you respond by *tracking* it and paying it down on a sensible schedule. Inadvertent-prudent debt is the inevitable residue of learning; you respond by refactoring as understanding clarifies.

So the quadrant routes you to the right *layer* of response — code, schedule, process, or people. Treating all debt with the same reaction (usually "we'll refactor someday") wastes effort on the prudent cells and *ignores the actual problem* in the reckless ones.

### Q2.2 — Walk me through the correct response to each of the four cells.

> **Testing:** Concrete, actionable prescriptions — the payload of the whole model.

**A.**

- **Deliberate–Prudent → finance it deliberately.** This debt is fine; the failure mode is *forgetting it*. Record it (a debt ledger, a ticket, an ADR noting "we chose X over Y for reason Z"), attach a rough payoff trigger ("before we add the second currency"), and pay it down before the interest compounds. The whole point of taking this debt was speed *now* — so the discipline is making sure "later" actually arrives.
- **Deliberate–Reckless → fix the process, not just the code.** Ask *why* a conscious decision was made without weighing cost. Usually the answer is schedule pressure with no slack, or no design step in the workflow at all. Refactoring the artifact treats the symptom; the cure is restoring the ability to make weighed decisions — realistic estimates, a design checkpoint, leadership that doesn't punish honest "this needs another day."
- **Inadvertent–Reckless → invest in people and review.** The team didn't know better, so more deadlines won't help. Mentoring, code review, pairing, raising the design baseline — and structurally, making sure inexperienced work isn't shipping unreviewed. The reckless part here is an organizational failure to provide the knowledge or guardrails, not the individual's fault.
- **Inadvertent–Prudent → refactor as you learn.** This is expected and largely unavoidable. The response is ordinary continuous refactoring: when usage reveals the better design, evolve toward it. No process alarm — this is the system working.

### Q2.3 — Of the four cells, which one is the real warning sign, and why?

> **Testing:** Whether you can compress the model to its load-bearing insight.

**A.** **Reckless** — *both* reckless cells, regardless of the deliberate/inadvertent axis. Reckless means the trade-off was never weighed: either by choice (deliberate-reckless) or through ignorance (inadvertent-reckless). That's the part that signals something is wrong with the *system that produces the work*, not just the work itself. The deliberate/inadvertent axis tells you *which lever* to pull (process vs capability), but the reckless/prudent axis is the one that tells you whether you have a problem at all. Prudent debt — deliberate or inadvertent — is healthy engineering. If you only remember one thing about the quadrant, it's: *the reckless column is the one to worry about.*

### Q2.4 — Is "deliberate-reckless" always wrong? Is "deliberate-prudent" always right?

> **Testing:** Resisting the urge to turn cells into moral verdicts.

**A.** Not absolutely, but close. Deliberate-reckless is *almost always* wrong because, by definition, it means making a conscious choice without weighing its cost — that's not a decision, it's a guess wearing a decision's clothes. The rare defense is genuine triage (the building is on fire, ship anything), but even then the *honest* label is closer to deliberate-prudent: "we know this is bad and we know why we're doing it" is a weighed trade-off. Deliberate-prudent is *usually* right but not automatically — a weighed decision can still be the wrong call if the analysis was bad, the deadline wasn't real, or the "later" never comes. The quadrant tells you a decision was *made well*; it can't tell you the decision was *correct*. That's still judgment.

---

## Theme 3 — Cunningham vs the Popular Reading

### Q3.1 — When Ward Cunningham coined "technical debt," which cell of Fowler's quadrant did he mean?

> **Testing:** Whether you know the metaphor's actual origin or just the folk version of it.

**A.** **Inadvertent–Prudent** — the "now we know how we should have done it" cell. Cunningham coined the term in 1992 (a report from his work on a financial system, WyCash) to explain to non-technical stakeholders why they should keep refactoring. His metaphor was about *consolidating your understanding* as you learn the domain: you ship your first-pass understanding of the problem to start earning returns, that immature understanding is the "debt," and you "repay" it by refactoring as your understanding matures. The debt arises *inadvertently* (you couldn't have known the domain better up front) and the act is *prudent* (shipping to learn, then paying back). It was never primarily about *deliberately* writing bad code to go faster.

### Q3.2 — So is the common "borrow time by cutting corners" reading wrong?

> **Testing:** Nuance — distinguishing "later, broader interpretation" from "misinterpretation."

**A.** It's not *wrong* so much as *later and broader*. Cunningham's original was specifically about shipping immature understanding and refactoring as you learn — the inadvertent-prudent cell. The "deliberately cut corners to borrow speed, pay interest later" reading came afterward, as the metaphor spread and people stretched it to cover *any* gap between current and ideal code, including conscious shortcuts. Fowler's quadrant is partly an acknowledgement of that broadening: it makes room for the deliberate row *and* the reckless column that Cunningham wasn't describing. The honest framing in an interview: "Cunningham's debt was inadvertent-prudent — consolidating understanding; the deliberate-shortcut reading is a valid later extension, but attributing it to Cunningham is a common misquote."

### Q3.3 — Cunningham himself pushed back on a misreading of his metaphor. What was it?

> **Testing:** Depth — whether you've actually watched/read Cunningham, not just secondhand summaries.

**A.** Cunningham was clear (notably in his 2009 "Debt Metaphor" video) that the debt was **never an excuse to write sloppy code on purpose**. The misreading he objected to was: "technical debt means it's okay to write messy code now and clean it later." He insisted the opposite — you should always write code *as cleanly as you understand how to at the time*. The "debt" isn't deliberate messiness; it's the gap between your *current understanding* of the problem and a *better* understanding you'll only reach by building and using the thing. In his words, the metaphor was about disciplined, well-written code that nonetheless embodies an immature understanding you then refine. So "I'm taking on tech debt" as cover for skipping care is precisely the interpretation he disowned.

### Q3.4 — Reconcile this: Cunningham says "always write clean code," yet the quadrant has a whole "reckless" column. Contradiction?

> **Testing:** Whether you can hold the origin and the extension in the same head without confusion.

**A.** No contradiction — they're describing different scopes. Cunningham was defining *his* metaphor, which lives entirely in the prudent column (specifically inadvertent-prudent): clean code that encodes immature understanding. Fowler's quadrant is a *taxonomy of everything people now call technical debt*, which is broader than Cunningham's original concept. The reckless column captures real phenomena — corner-cutting and ignorance — that genuinely happen and that people *do* file under "technical debt" today, even though they fall outside Cunningham's intent. So the quadrant isn't contradicting Cunningham; it's mapping the larger territory the term grew to cover, and quietly flagging (via "reckless") the parts Cunningham would say aren't the *good* kind of debt at all.

---

## Theme 4 — Limits and Criticism

### Q4.1 — What's the strongest criticism of the quadrant as a model?

> **Testing:** Whether you can critique a tool you also use — senior maturity.

**A.** The sharpest critique is that **debt is a continuum, not four discrete boxes**. Both axes are really spectra — there are degrees of deliberateness and degrees of prudence — but a 2×2 forces a binary placement that erases the gradient. A decision can be "70% weighed, 30% rushed," and the grid has nowhere to put that honestly. Fowler himself drew it as a 2×2 for communication, not as a claim that real debt is quantized. The model is a *lens for conversation*, and like any 2×2 it trades nuance for memorability. Using it as if the four cells were crisp, mutually exclusive bins is the error — the value is in the *axes*, which prompt the right two questions (was it chosen? was it weighed?), more than in the cells.

### Q4.2 — Classification depends on hindsight. Why is that a problem?

> **Testing:** The hindsight-bias trap — a subtle, real limitation.

**A.** Several cells can only be assigned *after the fact*, and that invites bias. "Now we know how we should have done it" (inadvertent-prudent) is *defined* by hindsight — at the time, you didn't know. The danger is **hindsight bias**: once you know the better design, it feels obvious, so you retroactively reclassify honest inadvertent-prudent debt as *reckless* ("how did they not see this?") and judge past engineers too harshly. The reverse also happens — people relabel genuine recklessness as "we couldn't have known" to dodge accountability. Because the deliberate/inadvertent axis hinges on *what was knowable at the time*, fair classification requires reconstructing the team's actual knowledge state then — which is hard and rarely done. The model is most reliable applied *forward* ("which cell are we about to enter?") and most treacherous applied *backward* as a verdict.

### Q4.3 — What does it mean for debt to "migrate" between cells over time?

> **Testing:** Whether you see the quadrant as a snapshot, not a permanent stamp.

**A.** A cell is a snapshot of a moment, not a permanent property of the debt. The same debt can move:

- **Deliberate-prudent → deliberate-reckless** when you took a weighed shortcut intending to pay it back "next quarter," and then *knowingly* keep deferring without re-weighing. The original decision was prudent; the ongoing non-repayment quietly becomes reckless because you've stopped weighing it.
- **Inadvertent-prudent → effectively reckless** when you learn the better design ("now we know") but, knowing it, choose not to act and let it rot. Once you *know*, inaction becomes a deliberate choice.
- Or it just *grows*: a small prudent shortcut spreads as more code is built on top of it, so the interest rate climbs even though the original classification doesn't change.

The practical lesson: re-classify debt periodically. A decision that was prudent in Q1 can be reckless by Q4 simply because the world (and your knowledge) changed and you didn't revisit it.

### Q4.4 — Why is it genuinely hard to classify your own team's debt honestly?

> **Testing:** Self-awareness about how incentives distort the model.

**A.** Because every axis has an *ego-protective* answer, and people gravitate to it. On the deliberate/inadvertent axis, "we chose this" sounds more competent than "we didn't know," so teams over-report deliberateness. On the reckless/prudent axis, *nobody* labels their own work reckless — "prudent" is the flattering self-image — so almost everything gets filed as **deliberate-prudent**, the one cell that requires no uncomfortable corrective action. The result is a quadrant where one box is overflowing and the other three are suspiciously empty. Honest classification needs an *outside* perspective (review, retro, a peer who'll say "that wasn't weighed, that was rushed") because the inside view is systematically biased toward the no-problem-here cell.

---

## Theme 5 — Classification Scenarios

> Each scenario: place it on both axes and justify. There's often a defensible answer on either side — what's graded is the *reasoning*, especially naming the evidence that decides it.

### Q5.1 — A startup hardcodes "USD" everywhere to ship its payments MVP in time for a demo to investors. The lead engineer wrote "TODO: extract currency handling when we add a second market" in the PR. Place it.

> **Testing:** Recognizing textbook deliberate-prudent.

**A.** **Deliberate–Prudent.** Deliberate: it was a conscious choice, documented in the PR. Prudent: the trade-off was weighed — a real business reason (investor demo), a shortcut whose blast radius is understood (single currency), and an explicit payoff trigger ("when we add a second market"). This is the textbook case of *good* debt: shipping now to capture an opportunity, with the consequence acknowledged and a trip-wire for repayment. The one caveat that would *demote* it: if "add a second market" comes and the TODO is silently ignored, it migrates toward deliberate-reckless — the prudence was in the *plan to repay*, and a plan you abandon stops being prudent.

### Q5.2 — A team ships a feature, and three months of real usage reveals the data model should have been event-sourced, not CRUD. Nobody could have known the access patterns up front. Place it.

> **Testing:** Recognizing Cunningham's original cell.

**A.** **Inadvertent–Prudent** — and notably, this is *Cunningham's original* technical debt. Inadvertent: no decision to take a shortcut was made; the team built the best model it could see. Prudent: there was no recklessness — the better design was genuinely *unknowable* until real usage revealed the access patterns. This is "now we know how we should have done it," the consolidate-understanding cell. The correct response is ordinary refactoring as the understanding matures, *not* a post-mortem blaming anyone — treating this cell as a failure is exactly the hindsight bias the model warns against. The work is functioning as intended: you shipped to learn, you learned, now you refine.

### Q5.3 — Under deadline pressure, a developer copy-pastes a 200-line auth function into four services with no abstraction, skips all tests, and merges without review. When asked, they say "we'll clean it up later." Place it.

> **Testing:** Spotting reckless — and not being fooled by "we'll clean it up later" sounding prudent.

**A.** **Deliberate–Reckless.** Deliberate: the developer knew they were cutting corners ("clean it up later" is a conscious acknowledgement). Reckless: the trade-off was never actually *weighed* — copy-pasting auth four ways, skipping tests on security-critical code, *and* bypassing review is not a considered cost/benefit, it's corner-cutting justified after the fact by schedule. The tell is that "we'll clean it up later" is doing the work of a justification without being one — there's no payoff plan, no scoping of the risk, no reason the cost was acceptable. Contrast Q5.1: that had a *bounded* shortcut and a *trigger*; this has an unbounded mess and a vague promise. The right response isn't "refactor the auth function" — it's asking why the process let untested, unreviewed security code merge at all.

### Q5.4 — A junior engineer, working alone, builds a feature with all business logic in the UI controller, direct SQL strings inline, and no separation of concerns. They genuinely don't know what layering is and there was no code review. Place it.

> **Testing:** Recognizing inadvertent-reckless and locating the *real* fault.

**A.** **Inadvertent–Reckless** — the "what's layering?" cell. Inadvertent: no decision was made to take on debt; the engineer didn't know a better structure existed, so there was nothing to decide. Reckless: the result is a tangle that wasn't weighed — but crucially, the recklessness is *organizational, not personal*. A junior not knowing about layering is normal; what's reckless is the *system* that let unmentored, unreviewed work from someone still learning ship straight to the codebase. So the correct response targets the org: code review, mentoring, raising the design baseline — not blaming the junior. Misreading this as the junior's failure (rather than the absent guardrails) is the classic mistake, and it's the same hindsight bias that makes a now-obvious gap look like negligence.

---

## Theme 6 — Org and Judgment

### Q6.1 — How would you use the quadrant as team or org *policy* — not just a thinking aid?

> **Testing:** Turning a 2×2 into an operational practice without overreaching.

**A.** I'd use it as a **routing rule for response, plus a forward-looking checkpoint** — and I'd resist turning it into a rigid taxonomy:

- **At decision time (forward use):** when we're about to take on debt, name the cell *out loud*. "This is deliberate-prudent: here's why, here's the trigger to repay." That single sentence forces the trade-off to be weighed, which is exactly what separates prudent from reckless. The act of classifying *prospectively* is the most valuable use.
- **Route the response by cell, not the label by blame:** prudent debt → tracked in a ledger with payoff triggers; reckless debt → a process/retro signal that something upstream is broken. The quadrant decides *which mechanism* handles it.
- **Watch the distribution, not individual cells:** if everything lands in deliberate-prudent, that's a self-deception smell (see Q6.2). If reckless cells keep recurring, the policy response is process or hiring/mentoring, not more refactoring tickets.

What I would *not* do is make engineers file every shortcut into a four-way dropdown for audit — that's the continuum critique biting back, and it turns a thinking tool into bureaucracy.

### Q6.2 — Your team labels essentially every piece of debt "deliberate-prudent." What's wrong, and what do you do?

> **Testing:** The most important org-level failure mode of the whole model.

**A.** It's almost certainly **self-serving misclassification**, because deliberate-prudent is the *only* cell that implies "we did everything right and have no corrective action to take." When every debt lands there, one of two things is true and both are bad:

1. **Reckless debt is being relabeled as prudent** — corner-cutting dressed up as "a weighed decision" after the fact, so nobody has to confront a broken process. ("We'll clean it up later" with no trigger ≠ prudent.)
2. **Inadvertent debt is being relabeled as deliberate** — "we chose this" sounds more competent than "we didn't know," so the team can't see the *capability* gaps it should be addressing.

What I'd do: introduce an *outside check*, because the inside view is structurally biased toward the no-problem cell. Concretely — require deliberate-prudent claims to carry the *evidence* (what was the trade-off, what's the payoff trigger?); a claim with no documented reasoning and no repayment plan is reclassified by default. And I'd look at outcomes: if "prudent" debt is never actually repaid, it was never prudent — prudence is defined by the *intent and plan to repay*, and a debt you never pay back retroactively reveals which cell it really lived in.

### Q6.3 — A senior engineer dismisses the quadrant as "just a 2×2, useless in practice." Steelman *and* rebut.

> **Testing:** Whether you can defend a tool against a smart critic without overselling it.

**A.** **Steelman:** they have a point about the continuum (Q4.1) and about classification being hindsight-prone and ego-distorted (Q4.2, Q6.2). As a *categorization scheme* it's lossy — real debt doesn't fit four crisp boxes, and a team can waste energy arguing which cell something is in. If you treat the cells as precise verdicts, it *is* close to useless.

**Rebut:** that critique attacks the cells while missing the *axes*, which are where the value lives. The quadrant's job isn't to file debt accurately — it's to force two questions that teams otherwise skip: *did we choose this?* and *did we weigh it?* Asking those at decision time is what prevents reckless debt; asking them in a retro is what surfaces process problems. And it does the one thing the "all debt is bad" and "all debt is fine" camps both fail at: it routes *different* debt to *different* responses (code vs schedule vs process vs people). So I'd agree it's a poor *audit taxonomy* and insist it's an excellent *conversation and decision lens* — and that conflating those two uses is the real source of the disappointment.

### Q6.4 — Leadership wants a dashboard that buckets all tech debt into the four cells and tracks counts per cell. Good idea?

> **Testing:** Knowing where the model breaks under operationalization.

**A.** Cautiously, mostly no — at least not as the *primary* metric. Three problems, all already in the model:

- **The continuum problem (Q4.1):** forcing every item into one of four bins manufactures false precision; the buckets will be argued over and gamed.
- **The self-classification problem (Q6.2):** counts are only as honest as the people filing them, and the bias runs hard toward deliberate-prudent. A dashboard showing "95% deliberate-prudent" is measuring the team's self-image, not its debt.
- **Counts aren't the decision-relevant signal:** the quadrant routes *responses*; what leadership actually wants to know is "is debt being weighed and repaid?" — which is better answered by *did prudent debt get repaid on its trigger?* and *are reckless cells recurring?* than by raw per-cell tallies.

What I'd offer instead: track the *health behaviors* the quadrant implies — proportion of deliberate-prudent debt with a documented payoff trigger that was actually hit, and the *trend* in reckless incidents (a process/capability signal). Those measure whether the system is working; cell-counts mostly measure who's filling in the form.

---

## Theme 7 — Other Taxonomies

### Q7.1 — Fowler isn't the only debt taxonomy. What's Steve McConnell's, and how does it relate?

> **Testing:** Breadth — knowing the quadrant is one model among several.

**A.** Steve McConnell splits debt into **intentional vs unintentional** — essentially Fowler's *deliberate/inadvertent* axis on its own — and then subdivides **intentional** debt into **short-term vs long-term**. The short/long-term distinction is McConnell's contribution: short-term debt is taken tactically (to hit a near deadline) and repaid quickly; long-term debt is a strategic, structural choice you'll carry for a while (e.g., deferring multi-platform support). Relative to Fowler: McConnell drops the reckless/prudent axis but adds a *time-horizon* dimension to deliberate debt, which is useful for prioritizing repayment — short-term debt should be paid first because its interest compounds soonest. The two are complementary: Fowler tells you whether the debt was weighed; McConnell tells you, among weighed debts, how urgently to repay.

### Q7.2 — What's the SEI/Kruchten "visible vs invisible" framing, and what does it capture that Fowler's doesn't?

> **Testing:** Whether you know the dimension the quadrant entirely omits — *what kind* of debt, and its visibility.

**A.** Philippe Kruchten and colleagues (associated with the SEI's technical-debt work) frame debt by **visibility**: some debt is *visible* — known defects, low-priority bugs, things on a backlog the team can point to — while the dangerous kind is **invisible**: architectural debt and structural decay that has no ticket, isn't on anyone's list, and only manifests as creeping friction. Their broader model also separates *kinds* of debt (code, design/architecture, test, documentation, infrastructure). What this captures that Fowler's quadrant doesn't: Fowler classifies debt by *how it was incurred* (chosen? weighed?), but says nothing about *whether you can even see it*. The visible/invisible axis is arguably more actionable for prioritization, because invisible architectural debt is both the most expensive and the easiest to ignore — it never shows up to demand attention. A complete picture uses both: Fowler for *how it got here and how to respond*, Kruchten for *whether it's even on your radar and what type it is*.

### Q7.3 — Given three taxonomies (Fowler, McConnell, SEI/Kruchten), how do you actually pick one on a real team?

> **Testing:** Synthesis and pragmatism — not treating the models as rivals.

**A.** They're not rivals to choose between; they answer *different questions*, so I'd use them at different moments:

- **Fowler's quadrant** at *decision time* and in *retros* — to ask "did we choose this, did we weigh it?" and route the response (code/schedule/process/people).
- **McConnell's intentional short/long-term** when *prioritizing repayment* of debt we chose — pay the short-term, fast-compounding debt first.
- **SEI/Kruchten visible/invisible (and the kind: code/design/test/doc)** when doing *debt discovery and inventory* — specifically to hunt the invisible architectural debt that has no ticket.

If forced to pick *one* as a default mental model, I'd keep Fowler's quadrant for everyday decisions because its axes directly shape behavior (it stops you taking reckless debt), and reach for the others when the specific need — prioritization or discovery — arises. The senior move is knowing each model's *job*, not pledging allegiance to one.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What are the quadrant's two axes?** A: Deliberate ↔ Inadvertent (did we choose it?) and Reckless ↔ Prudent (did we weigh it?).
- **Q: Which cell is "we don't have time for design"?** A: Deliberate–Reckless.
- **Q: Which cell is "we must ship now and deal with the consequences"?** A: Deliberate–Prudent.
- **Q: Which cell is "what's layering?"** A: Inadvertent–Reckless.
- **Q: Which cell is "now we know how we should have done it"?** A: Inadvertent–Prudent.
- **Q: Which column is the real warning sign?** A: Reckless — both cells, because the trade-off was never weighed.
- **Q: Which cell did Cunningham originally mean?** A: Inadvertent–Prudent — shipping immature understanding, then refactoring as you learn.
- **Q: Did Cunningham mean "write messy code now, clean it later"?** A: No — he explicitly disowned that; he said always write code as cleanly as you currently know how.
- **Q: Who created the quadrant and when?** A: Martin Fowler, 2009 bliki post.
- **Q: Are the two axes independent?** A: Yes — all four combinations occur; "deliberate" ≠ "bad."
- **Q: What's the response to deliberate-prudent debt?** A: Track it with a payoff trigger and repay it before interest compounds.
- **Q: What's the response to reckless debt?** A: Fix the system — process (deliberate-reckless) or capability/review (inadvertent-reckless), not just the code.
- **Q: The single biggest criticism of the quadrant?** A: Debt is a continuum, not four discrete boxes; the 2×2 forces false precision.
- **Q: Why is hindsight a problem for classification?** A: Cells like inadvertent-prudent are defined by what was knowable then; hindsight bias makes honest debt look reckless.
- **Q: What cell does an over-honest team over-populate?** A: Deliberate-prudent — the only cell implying no corrective action.
- **Q: McConnell's axis?** A: Intentional vs unintentional, with intentional split into short-term vs long-term.
- **Q: Kruchten/SEI's key axis?** A: Visible vs invisible debt (and kind: code/design/test/doc).
- **Q: Can debt change cells?** A: Yes — e.g., deliberate-prudent becomes reckless when you knowingly stop weighing whether to repay it.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Collapsing the two axes into one "good debt / bad debt" line — missing that deliberate ≠ bad.
- Treating "deliberate" as the problem cell instead of "reckless."
- Attributing the "deliberately cut corners" reading to Cunningham — it's the *later, broader* interpretation he actually pushed back on.
- Reciting the four cells but having no idea the *response* to each differs.
- Treating the four cells as crisp, audit-grade buckets with no nod to the continuum.
- Classifying past debt as reckless with the benefit of hindsight and blaming the engineers.
- Filing everything as "deliberate-prudent" without noticing that's the self-flattering, no-action cell.

**Green flags:**
- Placing a scenario on *both axes explicitly* and naming the evidence that decides each.
- Identifying "reckless" (either row) as the only real warning sign, and routing it to *process/people*, not refactoring.
- Knowing Cunningham's original was inadvertent-prudent ("consolidate understanding") and that the deliberate reading came later.
- Critiquing the model (continuum, hindsight bias, self-classification) while still finding it useful as a *decision lens*.
- Noting debt *migrates* between cells and should be re-classified over time.
- Citing a second taxonomy (McConnell, SEI/Kruchten) and knowing what *job* each does.
- Saying "prudent is defined by the plan to repay" — and that a debt never repaid was never prudent.

---

## Summary

- The quadrant is a **2×2 on two independent axes** — *deliberate/inadvertent* (did we choose it?) and *reckless/prudent* (did we weigh it?) — each cell carrying a Fowler quote: "we don't have time for design," "we must ship now," "what's layering?", "now we know how we should have done it."
- Its purpose is not to label debt good or bad but to **route a response**: reckless cells signal a *systemic* problem (process for deliberate-reckless, capability/review for inadvertent-reckless); prudent cells are *normal engineering* (finance deliberate-prudent with a payoff trigger; refactor inadvertent-prudent as you learn).
- **Reckless is the only real warning sign** — both rows. The deliberate/inadvertent axis tells you *which lever* to pull; the reckless/prudent axis tells you *whether there's a problem at all*.
- **Cunningham's** original debt was **inadvertent-prudent** — shipping immature understanding and refactoring as you learn; he explicitly disowned the "write messy code now, clean it later" reading. The deliberate-shortcut interpretation is a valid but *later, broader* extension that Fowler's quadrant accommodates.
- **Limits:** debt is a continuum the 2×2 flattens; classification is hindsight-prone (beware judging past engineers) and ego-distorted (everyone claims deliberate-prudent); cells *migrate* over time, so re-classify.
- **Org use:** apply it *forward* (name the cell before taking debt) and to *route* responses — not as an audit dashboard of cell-counts, which mostly measures self-image. Other taxonomies complement it: **McConnell** (intentional short/long-term, for prioritizing repayment), **SEI/Kruchten** (visible/invisible + kind, for discovering invisible architectural debt).

---

## Further Reading

- Martin Fowler, *"Technical Debt Quadrant"* (martinfowler.com, 2009) — the primary source; the four cells and their canonical quotes.
- Ward Cunningham, *"Debt Metaphor"* (2009 video) — Cunningham in his own words, correcting the "write sloppy code" misreading.
- Ward Cunningham, the original 1992 OOPSLA experience report (WyCash) — where the metaphor was coined.
- Steve McConnell, *"Technical Debt"* (2007) — the intentional/unintentional and short/long-term framing.
- Kruchten, Nord & Ozkaya, *"Technical Debt: From Metaphor to Theory and Practice"* (IEEE Software, 2012) — the visible/invisible and debt-kinds taxonomy.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — What Is Technical Debt](../01-what-is-technical-debt/interview.md) — the metaphor, interest, and principal that the quadrant classifies.
- [04 — Tracking and Prioritizing](../04-tracking-and-prioritizing/interview.md) — turning the quadrant's "track prudent debt, repay on its trigger" into an actual ledger and prioritization scheme.
- [Technical Debt Management README](../README.md) — where the quadrant sits in the broader debt-management landscape.
- [Quality Engineering README](../../README.md) — the wider quality-engineering interview landscape.

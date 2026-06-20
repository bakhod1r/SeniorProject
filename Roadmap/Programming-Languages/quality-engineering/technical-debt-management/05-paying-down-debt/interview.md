# Paying Down Debt — Interview Questions

> **Roadmap:** [Technical Debt Management](../README.md) → Paying Down Debt
> *A paydown interview rarely asks "what is technical debt." It asks "a 200k-line module is your bottleneck — rewrite it or strangle it, walk me through it," and then watches whether you reach for a strategy that matches the constraint, or just announce "we'll refactor it" and hope. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Paydown Strategies](#theme-1--paydown-strategies)
3. [Theme 2 — Refactor vs Rewrite vs Leave](#theme-2--refactor-vs-rewrite-vs-leave)
4. [Theme 3 — Safe Paydown of Legacy Code](#theme-3--safe-paydown-of-legacy-code)
5. [Theme 4 — Large-Scale Patterns](#theme-4--large-scale-patterns)
6. [Theme 5 — Measuring and Stopping](#theme-5--measuring-and-stopping)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Funding Models](#theme-7--funding-models)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *judgments* they keep returning to:

- **strategy must fit the constraint** (a system you touch daily wants fix-on-touch; a frozen legacy core wants a strangler)
- **behavior preservation is the contract** (paydown that changes behavior isn't refactoring, it's an undocumented rewrite)
- **rewrite is the highest-risk option, not the default** (you throw away embedded knowledge and reset the bug count to unknown)
- **paydown is an investment that must show a return** (lead time and defect rate, not "the code feels nicer")

Nearly every question in this bank is one of those four judgments wearing a costume. The candidates who do well *name the judgment* before reaching for a technique, and they always tie the work back to a delivery outcome rather than aesthetics.

---

## Theme 1 — Paydown Strategies

### Q1.1 — Name the main strategies for paying down debt and when each one fits.

> **Testing:** Whether you have a toolkit with selection criteria, or just "refactor as you go."

**A.** Four, on a spectrum from continuous to discrete:

1. **Boy-Scout Rule** — leave each file a little cleaner than you found it (rename, extract, add a test). Fits *everywhere, always*; it's the baseline hygiene that stops debt compounding. Zero scheduling cost, but it only reaches code you happen to touch and never tackles structural debt.
2. **Fix-on-touch (opportunistic)** — when a feature lands you in a debt-heavy area, pay down *that area* as part of the work. Fits the common case where the worst debt sits where you're already working. It piggybacks on funded feature work, so it needs no separate budget — but it's invisible unless you make the cleanup explicit in the PR.
3. **Dedicated time** — a recurring, *bounded* allocation (a fixed % of each sprint, or a standing "fix-it Friday"). Fits structural debt that no single feature will ever justify touching. Predictable and sustainable; the risk is it becomes a token gesture nobody defends under deadline pressure.
4. **Big-bang / dedicated project** — a funded initiative with its own scope and end date (extract a service, replace a framework). Fits debt so large and entangled that incremental approaches can't make a dent. High risk, high coordination cost; justified only when the debt is a *strategic* blocker, and even then it should be structured as a strangler, not a freeze-and-rewrite.

The senior move is matching the strategy to *where the debt is and how often you touch it*: continuous strategies for code in active development, dedicated strategies for structural debt that active work routes around.

### Q1.2 — Why isn't the Boy-Scout Rule enough on its own?

> **Testing:** Whether you see the reachability limit of opportunistic cleanup.

**A.** Because it only reaches code you happen to open. The Boy-Scout Rule is excellent at keeping *active* code from rotting, but the most dangerous debt is often in the parts nobody touches — the load-bearing module everyone is afraid to change, the framework two majors behind, the schema that forces every new feature into a workaround. Active code gets continuously improved; the frozen core only gets worse by comparison. So opportunistic cleanup must be *paired* with a deliberate strategy (dedicated time or a project) that can reach the debt active work routes around. One handles drift; the other handles the structural blockers.

### Q1.3 — When is "big-bang" the right call rather than incremental paydown?

> **Testing:** Whether you treat big-bang as a last resort with a high bar, not a preference.

**A.** When the debt is *structural and entangled* enough that incremental changes can't move the needle — for example, the architecture itself is the problem (a distributed monolith where every change touches five services), or the platform is at true end-of-life (a runtime that's out of security support). The bar is high because big-bang concentrates risk: a long-lived branch or a parallel system that must reach feature parity before it delivers any value, during which the old system keeps moving. Even when big-bang is justified, I'd structure it as an *incremental* migration under the hood — Strangler Fig or Branch by Abstraction — so it ships value continuously and can be paused or reversed. "Big-bang" should describe the *funding and intent*, not a literal flag-day cutover, which is where these efforts die.

### Q1.4 — How do you make fix-on-touch actually happen instead of being skipped under deadline?

> **Testing:** Whether you can operationalize a strategy, not just name it.

**A.** Make it cheap, visible, and bounded. Cheap: keep cleanups small enough to ride along with the feature (the "campsite" should be the file or class you're already in, not the whole module). Visible: separate the cleanup into its own commit or PR so reviewers and managers can *see* the investment and it doesn't hide inside a feature diff — this is the Tidy First discipline. Bounded: agree a rule like "clean the code you touch, file a ticket for the rest," so the scope can't balloon and threaten the deadline. The failure mode is an unbounded "while I'm here" that turns a one-day feature into a one-week refactor; the fix is an explicit, small campsite plus a ticket for everything beyond it.

---

## Theme 2 — Refactor vs Rewrite vs Leave

### Q2.1 — How do you decide between refactoring, rewriting, and leaving a system alone?

> **Testing:** Whether "rewrite" is a reflex or a reasoned last resort, and whether "leave it" is on your menu at all.

**A.** Three questions, in order:

- **Leave it?** If the code is ugly but stable, rarely changed, and not blocking anything, the correct action is often *nothing*. Debt only costs you when you pay interest — i.e., when you have to work in or around it. Stable, isolated, untouched code accrues no interest; spending effort there is a pure loss. Most "this is terrible, let's rewrite" candidates are actually leave-it candidates.
- **Refactor?** If the code is touched often and the structure (not the design) is the problem, refactor incrementally behind tests. This is the default for active code: it preserves behavior, ships continuously, and is reversible at every step.
- **Rewrite?** Only when refactoring genuinely can't get you there — the design is fundamentally wrong, the platform is dead, or the cost of incremental change exceeds replacement. And even then, prefer an *incremental* rewrite (strangler) over a from-scratch one.

The framing that matters: refactor and leave-it are reversible and low-risk; rewrite is the irreversible, high-risk option. The burden of proof sits on the rewrite.

### Q2.2 — Why do most ground-up rewrites fail?

> **Testing:** Whether you know the Spolsky argument and the second-system effect, not just a vague "they take too long."

**A.** Several compounding reasons:

- **You throw away embedded knowledge.** Joel Spolsky's "Things You Should Never Do" makes the core point: that ugly old code is *ugly because it works* — every weird branch is a bug fix, an edge case, a hard-won lesson from production. Rewriting discards all of it, and you rediscover the same bugs the hard way.
- **The old system doesn't stop.** While you rewrite, the existing product keeps shipping features, so you're chasing a moving parity target. You deliver *nothing* until you reach feature parity, which routinely takes far longer than estimated.
- **The second-system effect** (Brooks): the team, freed from the old constraints, over-engineers the replacement with every feature and abstraction they wished they'd had — the new system collapses under its own ambition.
- **Risk resets to unknown.** The old system's bug count is *known and low* after years of hardening; the rewrite's is unknown and high. You trade a debugged system for an undebugged one and call it progress.

That's why the experienced answer is almost always *incremental* — strangle the old system module by module so you keep shipping and never bet the company on a flag day.

### Q2.3 — Given all that, when *is* a from-scratch rewrite actually justified?

> **Testing:** Whether you can argue the other side — that "never rewrite" is dogma too.

**A.** When the constraints have genuinely changed such that incremental migration is impossible or pointless:

- The **platform is truly dead** — language/runtime/vendor out of support with no migration path (e.g., the framework no longer runs on a supported OS).
- A **fundamental requirement shift** the old architecture can't express — e.g., it was built single-tenant and the business now *is* multi-tenant SaaS; the assumption is baked into every layer.
- The system is **small enough** that a rewrite is genuinely cheaper than understanding the old one (a few thousand lines, well-understood domain).
- You **can't run old and new in parallel** for a hard external reason (a hardware platform retiring), so strangling isn't available.

Even then I'd de-risk: keep the old system running, write characterization tests against it as the spec, and migrate behind a parallel-run so I can compare outputs before cutover. "Rewrite" being justified doesn't excuse "flag-day rewrite."

### Q2.4 — A staff engineer insists "this codebase is beyond saving, we have to rewrite." How do you pressure-test that?

> **Testing:** Whether you can challenge a rewrite advocate with concrete questions rather than deferring to seniority.

**A.** I'd ask for the *evidence and the plan*, not the verdict:

- **What specifically can't be refactored?** Push past "it's a mess" to a concrete structural property — a circular dependency you can't break, a design assumption in every layer. If the answer is "the code is ugly," that's a refactor (or leave-it), not a rewrite.
- **What's the parity scope?** How many years of edge cases and bug fixes are encoded here, and how do we capture them so we don't reintroduce them? If we can't enumerate what the system does, we can't rewrite it safely.
- **What do we ship in month one?** If the honest answer is "nothing until we reach parity in a year," that's the classic failure setup. Can we strangle instead and ship value continuously?
- **What's the cost of being wrong?** A failed refactor is reverted; a failed two-year rewrite can sink a team or a company.

If after that the platform really is dead or the architecture really can't express the new requirements, I'll back the rewrite — but structured incrementally. The goal isn't to win the argument; it's to make sure we're not throwing away working knowledge to satisfy an urge for a clean slate.

---

## Theme 3 — Safe Paydown of Legacy Code

### Q3.1 — You need to change a 5,000-line class with no tests. How do you start safely?

> **Testing:** Whether you know Feathers' legacy-code playbook, starting with the dependency dilemma.

**A.** The trap here is Michael Feathers' **legacy-code dilemma**: to change code safely you want tests, but to *test* this code you usually have to change it (to break its dependencies) — and that change is itself unprotected. You break the cycle with a careful sequence:

1. **Find a seam** — a place where you can alter behavior without editing the code in place (a parameter, an overridable method, a swappable dependency). Seams are where you get the code under test without first rewriting it.
2. **Break dependencies at the seam** using the smallest, safest edits — *Extract Interface*, *Parameterize Constructor*, *Extract and Override Call*. These are low-risk by construction; Feathers catalogs them precisely so you're not improvising risky surgery on untested code.
3. **Write characterization tests** (next question) to pin current behavior.
4. *Now* refactor under the test net.

The discipline is to do the *minimum* unsafe change needed to install a seam, get tests around it immediately, and only then start the real work. You never do a big risky edit on code you can't yet verify.

### Q3.2 — What is a characterization test, and why not just write "correct" tests?

> **Testing:** Whether you understand that legacy paydown pins *actual* behavior, bugs and all.

**A.** A **characterization test** documents what the code *actually does today*, not what it's *supposed* to do. You run the code, observe the real output, and assert *that* — even if it looks wrong. The point isn't correctness; it's a **behavior-preservation net**: a tripwire that fires the instant your refactoring changes any observable behavior. If a "bug" is actually load-bearing (some caller depends on it), characterization tests stop you from "fixing" it mid-refactor and breaking production. You separate the concerns: first make the code safe to change by pinning behavior, *then* — as a deliberate, separate, visible change — decide whether to correct the behavior. Writing aspirational "correct" tests first conflates refactoring with bug-fixing and removes the very safety the net is supposed to provide.

### Q3.3 — Walk me through getting a hard-to-test method under test. What's a seam?

> **Testing:** Concrete dependency-breaking technique, not just vocabulary.

**A.** A **seam** is a place where you can change behavior without editing that spot in the source — Feathers' term for the leverage points that make untestable code testable. Say a method news-up a `PaymentGateway` internally and calls the network — untestable as written. The seam is the *construction* of that dependency. I'd apply *Parameterize Constructor* (or *Extract and Override Factory Method*): pass the gateway in instead of constructing it, so a test can inject a fake. That single, mechanical, low-risk edit converts a network-bound method into one I can drive deterministically. The key property is that each dependency-breaking move is *small and safe enough to trust without a test* — that's what lets you bootstrap testability into code that had none.

### Q3.4 — Why does "Tidy First?" insist on separating tidying commits from behavior changes?

> **Testing:** Whether you know Beck's separate-commits discipline and *why* it lowers risk and review cost.

**A.** Kent Beck's **Tidy First?** rule is to never mix *structural* changes (renames, extractions, reordering — behavior-preserving) with *behavioral* changes (new logic) in the same commit. Two reasons, both about risk and reviewability:

- **Review and reasoning.** A reviewer can verify a pure-tidying commit *mechanically* ("this is just an extraction, behavior is identical") and verify a pure-behavior commit by its *logic*. Mixed together, every line is suspect — the reviewer can't tell which changes are safe refactors and which carry new risk, so the whole diff gets the slow, anxious treatment.
- **Bisect and revert.** If something breaks, separated commits let you `git bisect` to the exact behavioral change and revert it without losing the tidying — or revert a bad tidy without losing the feature. Mixed commits force all-or-nothing.

The practical rhythm: tidy first in its own commit *(or a few)*, get it reviewed and merged cheaply, *then* make the behavioral change on clean ground. It makes both halves faster and safer than the tangled version.

---

## Theme 4 — Large-Scale Patterns

### Q4.1 — Explain the Strangler Fig pattern and why it beats a rewrite.

> **Testing:** Whether you understand incremental replacement with continuous value delivery.

**A.** **Strangler Fig** (Fowler's name, after the vine that grows around a tree until it can stand alone) replaces a system *incrementally*: you put a routing layer (a façade or proxy) in front of the old system, then build new functionality — and reimplement old functionality — *behind* that façade, redirecting traffic feature by feature. The old system shrinks as the new one grows, until eventually nothing routes to the old one and you delete it.

It beats a from-scratch rewrite on every risk axis: you **ship value continuously** instead of waiting for parity; each migrated slice is **small and reversible** (flip the route back if it misbehaves); the old system **keeps running** the parts you haven't migrated, so there's no big-bang cutover; and you **learn as you go** rather than betting everything on an upfront design. The cost is running two systems and maintaining the routing layer during the transition — which is exactly the cost that buys you the safety.

### Q4.2 — What is Branch by Abstraction, and how is it different from Strangler Fig?

> **Testing:** Whether you can distinguish in-process component replacement from system-level replacement, both trunk-based.

**A.** **Branch by Abstraction** replaces a *component inside a single codebase* without a long-lived feature branch. The steps: (1) introduce an **abstraction layer** over the thing you want to replace (e.g., an interface in front of the old persistence module); (2) point all callers at the abstraction, with the old implementation behind it; (3) build the new implementation behind the *same* abstraction; (4) switch the abstraction to the new implementation — typically behind a flag, so you can flip per-environment or roll back instantly; (5) once stable, delete the old implementation and (optionally) the abstraction.

The difference from Strangler Fig is *scope and seam*: Strangler operates at the **system boundary** with an HTTP/routing façade, replacing whole services or applications; Branch by Abstraction operates **in-process** at a code-level interface, replacing a module or library. Both share the crucial property: the work happens on **trunk**, in small mergeable steps, with old and new coexisting — never a long-lived divergent branch that has to be merged in one terrifying shot.

### Q4.3 — What are parallel-run and dark launching, and why are they so powerful for risky paydown?

> **Testing:** Whether you know how to validate a replacement against production reality before cutover.

**A.** Both run the *new* code against *real production input* without trusting its output yet:

- **Parallel-run (shadowing):** for each real request, execute **both** the old and new implementations, return the old result to the user, and **compare** the two off to the side — logging or alerting on any divergence. GitHub's `Scientist` library formalized this. It validates the new path against the full, messy distribution of real traffic — including the inputs you'd never think to write a test for — before it ever serves a customer.
- **Dark launching:** deploy and exercise the new path in production (often the new service receiving mirrored traffic) but keep its output **hidden** from users, so you surface performance, capacity, and integration problems under real load with zero user-facing risk.

They're powerful because the scariest part of any large paydown is "does the replacement *actually* behave like the original across every real edge case?" — and the only fully trustworthy oracle is production traffic itself. Parallel-run turns cutover from a leap of faith into a measured decision: you flip only once divergence is at or near zero. The cost is double execution (compute, and care with side-effecting operations — you typically run only the *read* side in parallel, or make writes idempotent/sandboxed).

### Q4.4 — How do these patterns work together on a single large migration?

> **Testing:** Whether you can compose the patterns into one coherent plan rather than treating them as alternatives.

**A.** They layer. On a large module replacement I'd: introduce an **abstraction** over the old module (Branch by Abstraction) so callers don't care which implementation is live; build the new implementation behind it; **parallel-run** the new implementation against production traffic and watch the divergence dashboard until it's effectively zero; then flip the **flag** to the new implementation, slice by slice, with instant rollback. For a whole-system case it's the same shape one level up: a **Strangler** façade at the boundary, with each migrated route validated by **shadow traffic** before it's promoted from dark to live. The unifying idea is *coexistence plus comparison*: old and new run side by side, production is the oracle, and the cutover is a reversible flag flip — never a flag day.

---

## Theme 5 — Measuring and Stopping

### Q5.1 — You spent a quarter paying down debt. How do you prove it helped?

> **Testing:** Whether you measure *outcomes* (delivery, quality) rather than activity (lines deleted, complexity score).

**A.** I tie it to **delivery and quality outcomes**, not code metrics, because the whole *point* of paying down interest is to make the team faster and safer:

- **Lead time / cycle time for changes** in the affected area — the DORA metric. If the paydown worked, the time from "start a change here" to "in production" should drop. This is the most direct evidence the *interest* fell.
- **Change failure rate / defect density** in that area — fewer escaped bugs and fewer reverts mean the code got safer to change.
- **Throughput in that area** — more changes landing per period because they're no longer expensive and scary.

I'd capture a *baseline before* the work (this is why you instrument first) and compare after. Code-health metrics (complexity, coverage, churn) are useful *leading* indicators that the work is on track, but they're not the proof — a beautifully refactored module that didn't move lead time or defects didn't deliver business value. The honest version also admits attribution is fuzzy; that's why I lean on a trend across several DORA-style signals rather than a single number.

### Q5.2 — How do you know when to *stop* paying down debt in a given area?

> **Testing:** Whether you understand that paydown has diminishing returns and a negative-ROI point — the senior, counterintuitive answer.

**A.** When the next increment of paydown stops earning its keep — debt paydown is an investment, and like any investment it has **diminishing returns**. Concretely, I stop (or move my effort elsewhere) when:

- The **interest is already low** — the area is no longer slowing changes or generating defects. Polishing already-clean, already-fast code is gold-plating, not paydown.
- The code is **stable and rarely touched**. Debt in cold code charges almost no interest; refactoring it is effort spent to make code *prettier* with no delivery payoff — often itself a *new* risk (you might break working code).
- The **marginal cost exceeds the marginal benefit** — the remaining debt is deeply entangled and expensive to remove, while the slowdown it causes is small. Beyond that crossover, further paydown has *negative* ROI: you spend more than you save.

The mature framing is that the goal is never "zero debt" — it's keeping debt *below the threshold where it materially impedes the team*. Chasing perfection past that point burns capacity you should be spending on the next-highest-interest debt, or on the product.

### Q5.3 — Leadership asks for an ROI number on a proposed paydown. How do you answer honestly?

> **Testing:** Whether you can quantify without faking precision, and frame in business terms.

**A.** I'd give an *estimate with its assumptions exposed*, in the language of cost. Cost of the **interest**: e.g., "this module appears in ~40% of our incidents and every change here takes ~3× longer than comparable code — that's roughly N engineer-days a quarter and M% of our outage minutes." Cost of the **paydown**: the engineer-weeks to do it. Expected **return**: the recovered velocity and reduced incident load, with a payback period. Then I'm explicit that these are estimates and I'd *validate with the lead-time/defect baseline* after the fact. What I refuse to do is invent a false-precision dollar figure; what I commit to is a clear before/after measurement so the *next* decision is data-driven rather than another argument. Honest, bounded estimates plus a promise to measure beats a confident fabricated number.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A 200k-line module is your delivery bottleneck. Rewrite it or strangle it? Walk me through it.

> **Testing:** The flagship judgment question — does your default match the risk, and can you produce a concrete plan?

**A.** At 200k lines and "delivery bottleneck," my strong default is **strangle, not rewrite** — a from-scratch rewrite of something that size means a long parity chase during which the module keeps moving and we ship nothing, the exact failure mode that sinks these efforts. The plan:

1. **Instrument first.** Establish the baseline: where in the module are changes slowest, where do defects cluster, which sub-areas appear most in incidents? That tells me *which slice to strangle first* — go where the interest is highest.
2. **Erect a seam.** Put an abstraction/façade in front of the module (Branch by Abstraction in-process, or a routing façade if it's service-shaped) so callers are decoupled from the implementation.
3. **Carve the highest-interest slice** and reimplement it behind the seam. Capture current behavior with **characterization tests** so I preserve the load-bearing edge cases.
4. **Parallel-run** the new slice against production traffic; watch divergence until it's near zero.
5. **Flip the flag** for that slice, with instant rollback. Ship the velocity win *now* — that funds and justifies continuing.
6. **Repeat** slice by slice; delete dead code as each slice fully migrates. The module shrinks; the bottleneck eases continuously.

I'd only consider a true rewrite if the module's *platform* is dead or its core architecture genuinely can't express current requirements — and even then I'd structure it incrementally. The win is continuous and reversible; we never bet the quarter on a flag day.

### Q6.2 — How do you pay down debt with *zero* dedicated time?

> **Testing:** Whether you can drive paydown without a budget — the most realistic constraint of all.

**A.** You fold it into funded feature work and lean entirely on continuous strategies:

- **Fix-on-touch.** Every feature that lands in a debt-heavy area pays down *that* area as part of the work — the cleanup is part of "done," not a separate line item. Most high-interest debt is exactly where you're already working, so this reaches a lot.
- **Boy-Scout Rule** as a team norm — small improvements with every change, enforced in code review ("you touched this, add the missing test / fix the name").
- **Tidy First**, so the structural cleanup that *makes a feature easier* is done first, in its own commit, and counts as part of building the feature — not as separate "refactoring" anyone can veto.
- **Make it visible.** Even with no budget, surface the debt: track the worst items, and when a feature is slow *because* of debt, attribute the cost openly. That's how "zero dedicated time" eventually becomes "some dedicated time" — you build the evidence.

The honest caveat: opportunistic paydown can't reach *structural* debt in frozen code that no feature visits. For that you eventually need *some* allocation — so part of "zero-time" paydown is making the cost of the untouchable core visible enough to earn it.

### Q6.3 — Leadership grants a "cleanup quarter." How do you spend it without shipping nothing?

> **Testing:** Whether you can turn a dangerous blank-check into a disciplined, value-delivering plan — and avoid the rewrite trap.

**A.** A "cleanup quarter" is dangerous precisely because it invites a freeze-and-rewrite. I'd impose three rules:

1. **Target the highest-interest debt, not the ugliest code.** Use incident data, lead-time hotspots, and change-failure clusters to pick the few areas actually slowing us down. A quarter is finite; spend it where the interest is, not on a tidy-everything spree.
2. **Ship continuously, in slices.** No long-lived branches, no "it'll all land at the end." Use Strangler / Branch by Abstraction so each week produces a merged, deployed improvement with a measurable effect. If at any point leadership pulls the plug, we've still banked real wins.
3. **Measure before and after.** Baseline lead time and defects in the target areas at the start; report the movement. This turns the quarter into *evidence* that paydown pays — which is how you get the *next* allocation and, ideally, a standing one.

What I'd refuse: turning the quarter into a from-scratch rewrite that delivers nothing until it (maybe) reaches parity. The quarter's job is to *prove the ROI of paydown* with continuous, measured, reversible wins — not to gamble it on a clean slate.

### Q6.4 — Mid-feature, you find the area is far more rotten than estimated. The cleanup would blow the deadline. What do you do?

> **Testing:** Bounded paydown under pressure and honest communication, vs. heroics or silent corner-cutting.

**A.** I do the **minimum cleanup the feature genuinely requires** and *file the rest*, explicitly. Concretely: apply Tidy First to make *just enough* of the area safe to change for this feature (a seam, a characterization test, one extraction), ship the feature, and raise a tracked debt item for the deeper rot with its observed cost ("this took 3× longer because of X"). I do **not** silently expand scope into a heroic week-long refactor that blows the deadline, and I do **not** hack the feature in on top of the rot and pretend the debt isn't there. And I'd surface it immediately to whoever owns the deadline — "the area is worse than we thought; here's the small cleanup I'm doing now and the larger one I'm deferring, with its cost" — so the tradeoff is a *decision*, not a surprise. Bounded, visible, communicated.

---

## Theme 7 — Funding Models

### Q7.1 — Compare the main models for funding debt paydown: the fixed % tax, debt sprints, and bundling into features.

> **Testing:** Whether you can reason about *organizational* mechanisms for sustaining paydown, with tradeoffs.

**A.** Three common models, each with a distinct failure mode:

- **The fixed % tax** — reserve a standing fraction of every sprint (often quoted as ~20%) for paydown. **Pro:** continuous and predictable; debt never goes fully unfunded, and it normalizes paydown as routine. **Con:** it's the first thing sacrificed when a deadline looms unless leadership genuinely protects it, and a flat percentage doesn't flex to match where the debt actually is.
- **Debt sprints (or fix-it weeks)** — periodic dedicated time where feature work pauses. **Pro:** concentrated focus lets the team tackle *structural* debt that a 20% trickle never reaches; it's visible and easy to schedule. **Con:** it's bursty — debt accrues between sprints, the sprint can turn into a grab-bag of low-value cleanup without prioritization, and stopping feature work entirely is a hard sell.
- **Bundling into features** — each feature carries the paydown of the area it touches; cleanup is funded *by* the feature. **Pro:** paydown is always tied to value being delivered, and it needs no separate budget fight. **Con:** it only reaches code features happen to touch — structural debt in frozen areas never gets funded this way; and the cost hides inside feature estimates unless you make it explicit.

### Q7.2 — Given those tradeoffs, what funding model would you actually advocate?

> **Testing:** Whether you can synthesize rather than dogmatically pick one — the senior answer is a blend matched to debt type.

**A.** A **blend**, because the models cover *different debt*. As a default: **bundle into features** for the everyday debt (most interest sits where you're already working, and this needs no separate budget), backed by a **protected baseline allocation** — a modest, genuinely-defended percentage — so paydown doesn't vanish entirely under deadline pressure. Then reserve **occasional debt sprints / funded projects** for the *structural* debt that opportunistic and trickle approaches provably can't reach (a framework upgrade, a service extraction), funded by the evidence the other two produced.

The reasoning: bundling handles drift, the protected baseline handles consistency, and the targeted sprint handles the big structural blockers — and crucially, *which* mechanism applies should be driven by where the highest-interest debt is, established with lead-time and incident data. The anti-pattern is treating any single model as the whole answer: a pure 20% tax never musters force for structural work; pure bundling never touches the frozen core; pure debt sprints let debt rot between them. Match the funding mechanism to the debt type.

### Q7.3 — How do you keep *any* of these models from being quietly killed the first time a deadline gets tight?

> **Testing:** Whether you understand the organizational durability problem behind funding, not just the mechanics.

**A.** By making the *cost of not paying* continuously visible and by removing the per-instance decision. Three levers:

- **Attribute the interest.** Routinely tie slow delivery and incidents back to specific debt ("this feature took 3× longer because of module X; this outage traced to the schema workaround"). When paydown's value is invisible but its cost is visible, it always loses the deadline fight — visibility flips that.
- **Make it default, not negotiated.** A protected allocation or a bundling norm that's part of "definition of done" survives pressure far better than paydown that has to be argued for *each* sprint — every per-instance negotiation is a chance to defer it forever.
- **Show the returns.** Use the lead-time/defect measurement from completed paydown to prove ROI, so leadership defends the budget because they've *seen* it pay back. Funding survives when it's evidence-backed, not faith-based.

The deeper point: a funding model is only as strong as the organization's willingness to honor it under pressure, and that willingness comes from *evidence*, not from the model's name. The engineer's job is to keep generating that evidence.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Boy-Scout Rule in one line?** A: Leave each file a little cleaner than you found it — continuous hygiene that stops active code from rotting.
- **Q: When is "leave it alone" the right paydown decision?** A: When the code is ugly but stable, isolated, and rarely touched — it charges no interest, so paying it down is wasted effort.
- **Q: One-sentence case against the ground-up rewrite?** A: It throws away years of embedded bug-fix knowledge and ships nothing until it reaches a moving parity target — Spolsky's warning.
- **Q: What's the second-system effect?** A: Brooks' observation that the replacement gets over-engineered with every feature the team always wanted, and collapses under its own ambition.
- **Q: Characterization test in one line?** A: A test that pins what the code *actually does today* (bugs included) so refactoring can't change behavior unnoticed.
- **Q: What's a seam?** A: A place you can change behavior without editing that spot in source — the leverage point that makes untestable legacy code testable.
- **Q: Strangler Fig vs Branch by Abstraction?** A: Strangler replaces a *system* via a routing façade; Branch by Abstraction replaces a *component* in-process behind an interface — both on trunk, both incremental.
- **Q: What does a parallel-run validate?** A: That the new implementation matches the old across *real* production traffic, by running both and comparing — before any user sees the new output.
- **Q: Dark launch in one line?** A: Run the new path in production with its output hidden, to surface load/capacity/integration issues at zero user risk.
- **Q: The single best metric that paydown worked?** A: Lead time for changes in the affected area dropping — the interest fell.
- **Q: When does further paydown have negative ROI?** A: When the remaining debt charges little interest (stable/cold code) but is expensive to remove — you'd spend more than you'd save.
- **Q: What does Tidy First separate, and why?** A: Structural commits from behavioral ones, so reviews are mechanical, bisect is precise, and either half can be reverted alone.
- **Q: The usual quoted figure for a debt "tax"?** A: ~20% of capacity reserved for paydown — useful as a default, only as strong as leadership's willingness to protect it.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Reaching for "rewrite it" as the default for any messy system.
- Never having "leave it alone" on the menu — treating all debt as worth paying down.
- Measuring paydown by lines deleted or complexity score instead of delivery/quality outcomes.
- Proposing a from-scratch rewrite with no parity-capture plan and no answer for "what ships in month one."
- Mixing tidying and behavior changes in one commit; refactoring untested legacy code with no characterization net.
- Treating "20% for tech debt" as a complete strategy with no link to where the debt actually is.
- Implying the goal is zero debt.

**Green flags:**

- Naming the *judgment* (fit-the-constraint, preserve-behavior, rewrite-is-last-resort, paydown-must-return) before the technique.
- Defaulting to *strangle* for large systems and reserving rewrite for a dead platform or a requirement the architecture can't express.
- Reaching for characterization tests and seams to make legacy code safe *before* changing it.
- Composing Strangler / Branch by Abstraction / parallel-run into one coherent, reversible plan.
- Baselining lead time and defects *before* the work and reporting the movement after.
- Knowing paydown has diminishing returns and a negative-ROI stopping point.
- Framing funding as a *blend* matched to debt type, sustained by making the interest visible.

---

## Summary

- The bank reduces to four judgments, repeated in costumes: **strategy must fit the constraint**, **behavior preservation is the contract**, **rewrite is the last resort**, **paydown must show a return**. Name the judgment first; the technique follows.
- **Strategies** sit on a spectrum: Boy-Scout and fix-on-touch for active code (continuous, cheap, but can't reach frozen structural debt), dedicated time and big-bang for the structural blockers active work routes around. Match the strategy to where the debt is.
- **Refactor / rewrite / leave:** leave stable untouched code alone (no interest); refactor active code behind tests (reversible); rewrite only when the platform is dead or the architecture can't express the requirement — and even then incrementally. Most rewrites fail on lost knowledge, the moving parity target, and the second-system effect (Spolsky, Brooks).
- **Safe legacy paydown** (Feathers): break the test/change dilemma by finding a *seam*, breaking dependencies with small safe edits, pinning behavior with *characterization tests*, then refactoring. Beck's *Tidy First?* keeps structural and behavioral changes in *separate commits* for cheap reviews and precise reverts.
- **Large-scale patterns:** Strangler Fig replaces systems behind a façade; Branch by Abstraction replaces components in-process behind an interface; parallel-run and dark launch validate the replacement against real production traffic before a reversible flag-flip cutover. They compose — coexistence plus comparison, never a flag day.
- **Measuring and stopping:** prove paydown helped with lead time and defect/failure rates in the affected area (baseline first), not code metrics. Stop when the marginal benefit falls below the marginal cost — paydown has diminishing returns and a real negative-ROI point; the goal is debt *below the impede-the-team threshold*, never zero.
- **Funding** is a *blend* matched to debt type: bundle into features for drift, a protected baseline for consistency, occasional debt sprints/projects for structural blockers — all sustained by making the interest visible and the returns measured, because any model dies under deadline pressure unless it's evidence-backed and default.

---

## Further Reading

- *Working Effectively with Legacy Code* — Michael Feathers. The canonical playbook for seams, dependency-breaking, and characterization tests.
- *Tidy First?* — Kent Beck. The discipline of small, separated structural changes and when to do them.
- "Things You Should Never Do, Part I" — Joel Spolsky. The classic argument against the ground-up rewrite.
- *The Mythical Man-Month* — Fred Brooks. The second-system effect, among much else.
- *StranglerFigApplication* and *BranchByAbstraction* — Martin Fowler (martinfowler.com). Definitive write-ups of the two patterns.
- "Accelerate" / DORA — Forsgren, Humble, Kim. Lead time and change-failure rate as the outcome metrics paydown should move.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [04 — Tracking and Prioritizing](../04-tracking-and-prioritizing/interview.md) — how to find and rank the highest-interest debt that paydown should target first.
- [06 — Preventing Accumulation](../06-preventing-accumulation/interview.md) — keeping debt from coming back once you've paid it down.
- [Technical Debt Management README](../README.md) — where paying down debt sits in the broader debt lifecycle.

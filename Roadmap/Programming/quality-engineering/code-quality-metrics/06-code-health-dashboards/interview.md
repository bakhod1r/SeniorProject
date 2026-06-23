# Code Health Dashboards — Interview Questions

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Health Dashboards
> *A dashboard interview rarely asks "what does SonarQube show." It asks "leadership wants to rank teams by their Sonar grade — what do you say," and then watches whether you can separate an aggregate from its distribution, recognize Goodhart the moment a number is displayed, and design something people actually open and act on instead of admire. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — What a Dashboard Aggregates and the Quality Gate](#theme-1--what-a-dashboard-aggregates-and-the-quality-gate)
3. [Theme 2 — Aggregation Pitfalls](#theme-2--aggregation-pitfalls)
4. [Theme 3 — Goodhart on Dashboards](#theme-3--goodhart-on-dashboards)
5. [Theme 4 — Designing for Action](#theme-4--designing-for-action)
6. [Theme 5 — Platforms and Build-vs-Buy](#theme-5--platforms-and-build-vs-buy)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Outcomes](#theme-7--outcomes)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **aggregate vs distribution** (one grade vs where the risk actually concentrates)
- **measure vs target** (a number you watch vs a number you optimize — the moment it flips, Goodhart begins)
- **proxy vs outcome** (the dashboard score vs the defect rate and lead time it's supposed to predict)
- **whole codebase vs new code** (the legacy debt you inherit vs the debt you're adding right now)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before defending or attacking a metric. A dashboard is a measurement instrument pointed at an organization, and the same reflexivity problems that haunt every social metric — surrogation, gaming, the average hiding the outlier — apply with full force the instant a number goes up on a screen.

---

## Theme 1 — What a Dashboard Aggregates and the Quality Gate

### Q1.1 — What does a code-health dashboard actually aggregate? Walk me through the inputs.

> **Testing:** Do you know a dashboard is a *roll-up of distinct analyses*, or do you think "it's the quality score"?

**A.** A dashboard is a presentation layer over several independent analyzers, each producing its own signal that the tool then summarizes:
1. **Static analysis findings** — bugs, vulnerabilities, and **code smells** (maintainability issues like duplicated blocks, over-long functions, deep nesting), each with a severity.
2. **Coverage** — usually line and branch coverage fed in from the test run, not computed by the dashboard itself.
3. **Duplication** — percentage of duplicated lines/blocks.
4. **Complexity** — cyclomatic and cognitive complexity per function/file.
5. **Technical debt** — a *time estimate* to remediate the findings, which SonarQube derives via its SQALE model and expresses as a **debt ratio**.
6. **Size and churn context** — lines of code, and on better tools, change frequency.

The crucial framing: the dashboard doesn't *measure quality*, it aggregates *proxies* for it and renders them as ratings and trends. The single grade you see on the front page is a function — a deliberately lossy one — of all of the above. A strong answer names the inputs *and* flags that the headline number is a compression of them.

### Q1.2 — Explain SonarQube's A–E ratings. What is each one actually measuring?

> **Testing:** Whether you know the ratings are *separate axes*, not one overall grade — and what the letters encode.

**A.** SonarQube emits **separate ratings per axis**, each on an A (best) to E (worst) scale, and conflating them is a common mistake:
- **Reliability rating** — driven by **bugs**. A means zero bugs; the grade drops based on the severity of the *worst* bug present (one Blocker bug alone forces E).
- **Security rating** — same shape, driven by **vulnerabilities**; worst severity sets the grade.
- **Security Review rating** — driven by **security hotspots reviewed** (a ratio of reviewed-to-total).
- **Maintainability rating (SQALE rating)** — driven by the **technical debt ratio**: estimated remediation time divided by the estimated time to have written the code from scratch. A is roughly ≤5%, and the bands widen from there.

The thing seniors get right: reliability and security ratings are **worst-severity** functions (one critical issue tanks the letter), while maintainability is a **ratio** (cumulative debt against size). They behave completely differently — a single bug is a cliff, debt is a slope — so reading "we're a C" without asking *which rating* is meaningless.

### Q1.3 — What is the SQALE debt ratio, concretely, and what's the trap in it?

> **Testing:** Whether you understand the denominator, not just the slogan "technical debt."

**A.** The **debt ratio** is `remediation cost ÷ development cost`, both in time. The numerator is the sum of SonarQube's per-issue **remediation estimates** (each rule ships a fixed cost, e.g. "10 min to fix this smell"). The denominator is an *estimate of the effort to build the codebase from scratch*, computed as a fixed cost-per-line times lines of code (the default is ~30 minutes per line, configurable). So a 5% debt ratio means "fixing the flagged issues would cost about 5% of what it cost to write this."

The trap is the **denominator**: it scales with **lines of code**. A bloated, verbose codebase has a *larger* denominator, so the same absolute debt produces a *smaller ratio* — verbosity can flatter your maintainability rating. And the per-line constant is a crude proxy for effort. So the debt ratio is useful as a *relative trend on one codebase over time*, and treacherous as an *absolute cross-team comparison*. Knowing that the denominator is LOC-based is the tell that you've actually read how SQALE works rather than just seen the letter.

### Q1.4 — What is the quality gate, and why is it the most important object on the dashboard?

> **Testing:** Whether you see the gate as the *enforcement mechanism* that turns a passive display into a control.

**A.** A **quality gate** is a set of pass/fail conditions evaluated on every analysis; if the project fails, the gate is red and — wired into CI — it can **block the merge or deployment**. It's what converts a dashboard from a thing people *look at* (and ignore) into a thing that *acts*. A gate condition is a metric + operator + threshold, e.g. "coverage on new code ≥ 80%," "new bugs = 0," "duplicated lines on new code < 3%."

The reason it's the centerpiece: a number nobody is accountable to drifts. A gate creates the accountability at exactly the moment of change, in the developer's own pull request, with a clear pass/fail rather than a vague "the score went down." The senior insight is that *what you put in the gate is a policy decision with teeth* — and, as we'll see, gating on the wrong metric is how you manufacture Goodhart at industrial scale.

### Q1.5 — Explain "Clean as You Code." Why is it the recommended default, and what problem does it solve?

> **Testing:** The single most important modern idea in this space — new-code focus.

**A.** **Clean as You Code** is the principle that the quality gate should evaluate **only new and changed code**, not the entire codebase. SonarQube's default gate ("Sonar way") gates on **new-code conditions**: no new bugs, no new vulnerabilities, coverage on new code ≥ 80%, duplication on new code < 3%, all new security hotspots reviewed.

It solves the **legacy paralysis** problem. A team that inherits a million lines with 10,000 smells cannot fix them all, so a gate on *overall* code is permanently red and instantly ignored — it's noise. By gating on the *diff*, every change is held to a high bar while the old code is left alone unless you touch it. The codebase then improves **monotonically and incrementally**: the new-code line is always clean, and the legacy gets cleaned opportunistically as you naturally modify it. It also sidesteps blame for code you didn't write, and keeps the actionable surface small — you only ever look at the few issues *you just introduced*. This is the idea that makes dashboards survive contact with a real, old codebase.

---

## Theme 2 — Aggregation Pitfalls

### Q2.1 — A repo shows "Maintainability: A." Why might that single grade be dangerously misleading?

> **Testing:** The aggregate-hides-the-distribution problem — the core failure mode of any roll-up.

**A.** Because **an aggregate is a function of a distribution, and the same grade can sit on top of wildly different distributions**. "Maintainability A" means the *debt ratio across the whole codebase* is low. But debt is almost never uniform — it follows a **Pareto distribution**: a handful of files concentrate most of the pain. You can have a 200-file repo where 195 files are pristine and 5 are unmaintainable disasters, and the *average* still comes out A because the clean mass dilutes the toxic few.

Those 5 files are very likely the ones you change most often (debt and churn correlate), so the grade is reassuring you about *exactly the code that's hurting you most*. The fix is to never trust the headline aggregate alone — pull the **per-file distribution**, sort by debt or complexity descending, and look at the **tail**. A senior treats the front-page letter as a screening signal and immediately drills into the distribution behind it.

### Q2.2 — Why is the *mean* (or a single overall grade) the wrong summary for code-health metrics, and what's better?

> **Testing:** Statistical literacy applied to quality data — distribution thinking.

**A.** The mean assumes a roughly symmetric distribution where the center is representative. Code-health metrics are the opposite: they're **heavily right-skewed** (most files fine, a long tail of awful), so the mean is dragged around by the tail and *represents almost no actual file*. Worse, a single overall grade collapses the whole distribution to one point and throws away the only thing that matters — *where the bad code is*.

Better summaries, in order of usefulness:
- **The distribution itself** — a histogram of complexity/debt per file, where the shape and the tail are visible.
- **Percentiles**, especially p90/p95/max — "the worst file has complexity 340" is far more actionable than "average complexity is 6."
- **Risk-weighting** — weight each file's health by its **change frequency** (churn) or its blast radius, so a toxic file nobody touches ranks below a moderately-bad file edited daily. CodeScene's hotspot model is exactly this: complexity × frequency-of-change.

The principle: **report the tail and weight by exposure, not the average.** An average is what you show an executive who wants one number; the distribution is what an engineer uses to fix something.

### Q2.3 — Two services both score "B." Are they equally healthy?

> **Testing:** Whether you resist treating a grade as a fungible, comparable quantity.

**A.** Not necessarily, and the grade alone can't tell you. Two B's can differ on every dimension that matters: one B might be a *uniform* mild-debt codebase (genuinely "consistently okay"), the other a *bimodal* mix of pristine and catastrophic files that averages to B. One might be a 5,000-line service where B reflects the whole thing; the other a 500,000-line service where B is a LOC-diluted ratio hiding severe hotspots. They may be analyzed with **different rule sets, different quality profiles, or different coverage of generated/vendored code**, which alone can move a grade a full letter.

So "equally healthy" requires that the grades are **commensurable** — same profile, comparable size and domain, similar exclusions — and that you've checked the *distributions*, not just the letters. The honest answer is "the grades are equal; that doesn't mean the codebases are, and here's what I'd check before believing it." Treating a letter as a portable, cross-context truth is the aggregation sin.

### Q2.4 — How would you turn a flat "list of 4,000 issues" into something that reflects real risk?

> **Testing:** Risk-weighting and prioritization over raw counts.

**A.** A flat count treats a critical bug in the payment path and a style nit in a test fixture as equal units, which is useless. To make it reflect risk I'd weight along three axes and *rank*, not sum:
1. **Severity** — the analyzer's own bug/vuln/smell severity (a Blocker is not a Minor).
2. **Exposure / churn** — how often the containing file changes and how central it is; a smell in a file edited daily by six people is far riskier than the same smell in dead code. This is the hotspot idea: `complexity × change-frequency`.
3. **Reach** — blast radius / fan-in; an issue in a widely-depended-upon module endangers more.

The output is a **ranked top-N "fix these first" list**, not a 4,000-row table. Raw issue count is a vanity number that mostly tracks codebase size; *risk-weighted, ranked* findings are what direct effort. The move from "count" to "ranked risk" is the entire difference between a report nobody reads and a worklist a team executes.

---

## Theme 3 — Goodhart on Dashboards

### Q3.1 — State Goodhart's Law and explain precisely why a dashboard makes it worse.

> **Testing:** Whether you understand the *mechanism* of metric corruption, not just the slogan.

**A.** **Goodhart's Law:** "When a measure becomes a target, it ceases to be a good measure." The mechanism is that any metric is a *proxy* for something you actually care about (maintainability, reliability), and a proxy is only correlated with the real thing across the behaviors that existed *when you chose it*. The instant you reward the proxy, people optimize the **proxy directly** — including via paths that move the number without moving the underlying goal — and the correlation breaks.

A dashboard makes this *worse* in three specific ways. First, **visibility**: it puts the number on a screen everyone sees, which is precisely the act of "making it a target" — you can't optimize what you can't see, and now everyone can see it. Second, **precision and rank-ability**: a clean A–E grade or a percentage invites comparison and gaming far more than a fuzzy qualitative sense. Third, **gate coupling**: if the number blocks merges or feeds a report to management, the incentive to move it by any means becomes acute. The dashboard is a Goodhart amplifier by construction; the question is never *whether* it applies but *how you blunt it*.

### Q3.2 — What is surrogation, and how does it show up around code-health dashboards specifically?

> **Testing:** The cognitive failure mode behind metric obsession — a senior-level concept.

**A.** **Surrogation** is the cognitive slip where people **mistake the metric for the goal** — they stop caring about "maintainable, reliable software" and start caring about "the A grade" or "85% coverage" as ends in themselves. The proxy *replaces* the construct in everyone's mind.

On dashboards it shows up as: teams writing **assertion-free tests** to lift the coverage number while testing nothing; **suppressing or muting** smells wholesale (`// NOSONAR`, blanket exclusions) to clear the count instead of fixing anything; **gaming the SQALE denominator** by leaving code verbose so the debt ratio looks small; **splitting functions cosmetically** to dodge a complexity threshold while making the code *harder* to read; or celebrating a green dashboard during an incident-heavy quarter because the *score* — not the *system* — is the thing they now optimize. The antidote is to keep the *outcome* explicitly in front of the metric ("we care about defect rate; coverage is one weak indicator of it") and to treat any sudden metric improvement as something to *investigate*, not celebrate.

### Q3.3 — Why should you almost never tie dashboard metrics to individual performance reviews?

> **Testing:** The most consequential governance question in the whole topic.

**A.** Because it's the most direct possible way to weaponize Goodhart, and it reliably destroys the metric *and* the behavior. The moment "your bonus/rating depends on your coverage or your team's Sonar grade" is true, people optimize the number against their own livelihood — and they will win, because gaming a metric is always cheaper than the real work it's a proxy for. You get assertion-free tests, suppressed findings, refusal to touch (and thus improve) risky legacy code because editing it might *lower* your grade, and **gridlock at code review** as people argue about score impact instead of correctness.

It also corrupts the **data itself**: once the number is tied to reward, you can no longer trust it as a signal, so you've blinded yourself. And it's unjust — these metrics are confounded by domain, legacy, and team context the individual didn't choose. The senior position is firm: dashboards are **diagnostic tools for teams to improve their own code**, run on the *codebase*, never **scoreboards for ranking or rating people**. The same goes for cross-team **leaderboards**, which apply the identical pressure at group granularity and additionally punish teams stuck with the worst legacy.

### Q3.4 — "If displaying a number corrupts it, should we just not display numbers?" Respond.

> **Testing:** Whether you can hold the tension instead of overcorrecting into nihilism.

**A.** No — that overcorrects into "metrics are useless," which is as wrong as "the grade is the truth." Measurement is genuinely valuable; the discipline is in *how* you wire it. You blunt Goodhart without going blind by: (1) gating and displaying **outcome-adjacent, hard-to-game** metrics over easy proxies — defect escape rate and lead time resist gaming far better than raw coverage; (2) using **a basket** of metrics so gaming one is visible in another (coverage *up* while mutation score is *flat* exposes assertion-free tests); (3) framing every number with its **outcome** so surrogation has less room; (4) keeping numbers as **team self-diagnostics**, off performance reviews and leaderboards; and (5) treating metrics as **inputs to a conversation, not verdicts** — they prompt "why?", they don't pronounce judgment. The goal isn't to hide numbers; it's to make them *honest and consequential in the right direction*. A dashboard you can trust is one whose metrics are hard to move without actually doing the work.

---

## Theme 4 — Designing for Action

### Q4.1 — What separates a dashboard people *act on* from one they ignore?

> **Testing:** Product sense — the difference between a report and a tool.

**A.** An ignored dashboard answers "how are we doing?" with a number. An actionable one answers **"what should I do next?"** with a specific, small, attributable task. The design properties that make the difference:
- **Top-N, not all-N.** Surface the handful of highest-risk items (worst hotspots, new gate failures), each with a concrete *next action*, instead of a 4,000-row table that induces paralysis.
- **In the workflow, not in a portal.** The signal must arrive where work happens — the **pull request decoration** showing exactly the issues *this PR* introduced — not on a separate site nobody opens. Proximity to the moment of change is most of what drives action.
- **New-code framing.** Hold the diff to a high bar (Clean as You Code) so the actionable set is always small and clearly *yours*.
- **Trends, not just absolutes** (see next question).
- **An owner.** An item with no clear owner is an item nobody fixes; tie hotspots to the team/code-owner.

The unifying idea: **actionability = (small, ranked) × (specific next step) × (delivered in context) × (clear owner).** Everything that isn't that is decoration.

### Q4.2 — Why prioritize trends over absolute values? Give the failure mode of each.

> **Testing:** Whether you understand direction-of-travel beats point-in-time for driving behavior.

**A.** An **absolute** value is a verdict with no agency — "you have 4,000 smells" on inherited legacy is demoralizing, unactionable, and says nothing about whether you're improving. A **trend** has direction and ownership: "smells on new code went from 0 to 12 this sprint" or "debt ratio has fallen four weeks running" tells you whether *your behavior* is helping, and it's something a team can move. Trends also auto-adjust for context — a team with terrible legacy can still show an *excellent trend*, which is the fair and motivating thing to reward.

The failure modes cut both ways, though. The absolute's failure mode is **paralysis and unfairness** (judging people by debt they inherited). The trend's failure mode is **missing a bad steady state** — a flat line at a catastrophic level looks "stable" and a pure trend view can lull you ("no change = fine") when the absolute is on fire. So the senior answer is **trend-forward, absolute-aware**: lead with direction of travel to drive behavior, but keep a threshold/floor on the absolute so a stably-terrible metric still raises a flag. Clean-as-You-Code is essentially this — a hard floor on *new* code, trends on the rest.

### Q4.3 — Design the quality-gate conditions for a 10-year-old service with heavy legacy debt. What goes in, what stays out?

> **Testing:** Applying new-code conditions and avoiding the all-code trap, concretely.

**A.** I'd gate **almost entirely on new code**, because any overall-code threshold on a decade-old service is either trivially passed (set so low it's meaningless) or permanently failing (set sensibly, and now ignored). Concretely:

**In the gate (new code only):**
- New **bugs = 0** and new **vulnerabilities = 0** (worst-severity axes; don't add fresh ones).
- **Coverage on new code ≥ 80%** (high bar on the diff is affordable even when overall coverage is 20%).
- **Duplication on new code < 3%.**
- All new **security hotspots reviewed.**

**Out of the gate (tracked, not blocking):**
- **Overall** coverage, overall debt, total smell count — shown as **trends** and used to celebrate improvement, never as a merge blocker.

**Plus, off the gate entirely:** a **ranked hotspot list** (debt × churn) to guide *opportunistic* refactoring — when you're already editing a hot file, you clean it. This is Clean as You Code: a hard, high floor on the diff; gentle trend-pressure on the legacy; and a prioritized worklist so the cleanup that does happen targets the files that hurt. The explicit anti-pattern is a single overall-code gate that's red on day one and muted by day two.

### Q4.4 — A team says "our dashboard has 4,000 issues and we don't know where to start." How do you make it actionable tomorrow?

> **Testing:** Turning an overwhelming backlog into motion — the practical core of the topic.

**A.** I'd do three things, in order. **First, draw the new-code line** — switch the gate to new-code conditions so today's 4,000 stop counting against them and only *new* issues block; the backlog instantly becomes context, not an indictment, and the team's daily work is held to a clean bar. **Second, rank the legacy by risk, not count** — generate a top-10 **hotspot** list weighted by churn and severity (debt × change-frequency), so instead of 4,000 undifferentiated rows they have ten files that are both bad *and* actively hurting. **Third, attach a next action and an owner** to each of the ten and fold them into normal sprint work as "clean when you touch."

The message to the team is: *you will never fix 4,000 issues, and you don't need to.* Keep new code clean automatically, refactor the ten hotspots opportunistically, and let the rest of the legacy sit quietly until you happen to edit it. That converts an unactionable wall into a small, ranked, owned worklist — which is the only form of "4,000 issues" anyone ever actually executes.

---

## Theme 5 — Platforms and Build-vs-Buy

### Q5.1 — Compare SonarQube, CodeScene, and Code Climate. What is each best at?

> **Testing:** Whether you know the tools differ in *philosophy*, not just features.

**A.** They occupy genuinely different niches:
- **SonarQube / SonarCloud** — the **static-analysis + quality-gate** workhorse. Deep per-language rule sets (bugs, vulnerabilities, smells), the SQALE debt model, coverage ingestion, and — its real strength — a **CI-wired quality gate with Clean-as-You-Code** new-code conditions and PR decoration. Best when you want to *enforce* a quality bar on every change. It analyzes the code as it is *now*.
- **CodeScene** — **behavioral code analysis**: it reads **Git history**, not just the snapshot, to find **hotspots** (complexity × change-frequency), **change coupling** (files that change together), and **knowledge/ownership risk** (bus-factor, key-person dependencies). Best at answering *where is the risk and where should we refactor*, and at surfacing socio-technical risk no snapshot tool can see.
- **Code Climate** — comes in two parts: **Quality** (maintainability grades and smell detection, historically simpler than Sonar) and **Velocity** (now folded into engineering-intelligence / DORA-style **delivery metrics**). Best when you want maintainability signals alongside *flow/delivery* metrics in one place.

The senior framing: **Sonar enforces a bar on the diff; CodeScene tells you where the risk concentrates over time; Code Climate leans toward delivery/flow.** They're complementary as much as competitive — many shops run Sonar for the gate and CodeScene for prioritization.

### Q5.2 — When does building a custom dashboard make sense over buying one?

> **Testing:** Build-vs-buy judgment — not defaulting to either NIH or "always buy."

**A.** **Buy by default.** The off-the-shelf tools encode years of language-specific rule engineering, a debt model, gate integration, and PR decoration you will not reproduce cheaply — rebuilding that is a classic NIH money pit, and worse, you'd own the maintenance of every language parser and ruleset forever.

**Build (or, really, *compose*)** when: (1) you need to **unify signals across tools** — Sonar grade + CodeScene hotspots + coverage + DORA metrics + incident data on one pane — which no single vendor fully covers, so you ingest their APIs into Grafana/Looker/Backstage and build the *aggregation*, not the analyzers; (2) you have **org-specific definitions of health** (custom risk-weighting, service-tier policies, internal SLOs) the vendor can't express; (3) **scale or data-residency** constraints (huge monorepo, on-prem-only data) rule out SaaS; or (4) you're surfacing health inside an existing **developer portal** (Backstage) as one tab among many.

The discipline: **buy the analysis, build only the aggregation and the org-specific policy on top.** Custom-building the *analyzers* is almost always wrong; custom-building the *integration layer* is often right. And whatever you build, it inherits every Goodhart and aggregation hazard above — the tech is the easy part.

### Q5.3 — Leadership wants to compare SonarQube grades across 40 teams on one screen. What makes that comparison valid or invalid?

> **Testing:** Comparability — the hidden assumption under every cross-team dashboard.

**A.** The comparison is only meaningful if the grades are **commensurable**, and by default across 40 teams they usually aren't. For the numbers to be comparable you need, at minimum:
- **The same quality profile / rule set** per language — different active rules produce different grades on identical code.
- **Consistent exclusions** — generated code, vendored libraries, and test code included or excluded the *same way* everywhere (one team excluding generated protobufs and another not will diverge by a full grade).
- **Comparable language and domain** — a Go API service and a legacy COBOL batch job can't share a meaningful letter; rule maturity differs by language.
- **Awareness of the LOC denominator** — the SQALE ratio is diluted by size, so big codebases get a structural edge.
- **Awareness of legacy age** — older services carry inherited debt the current team didn't create.

Even when all that holds, you must compare the *right thing*: **trends and new-code health** travel across contexts far better than absolute grades. So my answer to leadership is: "We can show a comparable view if we standardize profiles and exclusions and compare *new-code* trends — but a raw absolute-grade ranking across 40 different services is comparing different rulers and will be both wrong and corrosive." (Which leads straight into the next theme.)

---

## Theme 6 — Scenario and Judgment

### Q6.1 — Leadership wants to rank teams by their SonarQube grade and put it in a quarterly review. What do you say?

> **Testing:** The flagship judgment question — can you push back substantively *and* offer the constructive alternative?

**A.** I'd push back, with reasons and an alternative — not just "no." Three reasons it's a bad idea:

1. **It's not a valid comparison.** As covered, grades across teams aren't commensurable — different rule profiles, exclusions, languages, codebase ages, and the LOC-diluted SQALE denominator mean you'd be ranking teams by their *legacy and their language*, not their craft. The team with the oldest inherited codebase ranks last no matter how well they work.
2. **It's textbook Goodhart, weaponized.** Ranking and review-coupling makes the grade a high-stakes target, so teams will *game it* — assertion-free tests, blanket suppressions, refusing to touch risky legacy lest editing it drop their grade — which corrupts the metric *and* worsens the code. You'd destroy the signal you're trying to use.
3. **It punishes the wrong behavior.** It disincentivizes exactly the people who take on the hardest, oldest, most critical code.

Then the constructive alternative: "If the goal is to drive code-health improvement, let's measure **trends, not absolutes** — each team's *direction of travel* on new-code health — and tie it to **outcomes leadership actually cares about**, like defect-escape rate and lead time, at the *team* level for *learning*, not a stack-ranking. Use the dashboard as a self-diagnostic that teams own. A ranking gives you a number and a gaming problem; a trend-plus-outcomes view gives you actual improvement." The mark of a senior here is refusing the framing while still serving the underlying goal.

### Q6.2 — The dashboard is all green — gates passing, grade is A — but production incidents are up and on-call is miserable. What's wrong?

> **Testing:** Whether you know the dashboard measures *proxies*, and can diagnose a proxy-outcome divergence.

**A.** Green dashboard + rising incidents is the defining symptom of **proxy-outcome divergence**: the things the dashboard measures (smells, coverage, debt ratio) are *correlated* with reliability but are not reliability itself, and they've come apart. Several causes, which I'd investigate in parallel:

- **The metrics are being gamed (Goodhart/surrogation).** Coverage is 85% via **assertion-free tests** — lines execute, nothing is verified — so "covered" code ships bugs. Smells are **suppressed** rather than fixed. The green is manufactured. I'd check **mutation score** (does the suite actually catch injected faults?) against coverage to detect this.
- **The dashboard measures the wrong things for *this* failure mode.** Static analysis and unit coverage say nothing about **integration faults, race conditions, config errors, dependency/infra failures, capacity, or operational issues** — the actual sources of most production incidents. A reliability-A on *bugs the linter can see* is silent about the system's real failure surface.
- **No outcome metrics on the dashboard at all.** It tracks *code* proxies but not **defect-escape rate, MTTR, change-failure rate, or incident counts** — so it literally cannot reflect the thing that's going wrong.

The fix is to **anchor the dashboard to outcomes**: put change-failure rate, defect-escape rate, and incident trends *next to* the code metrics, validate that coverage is real (mutation testing), and treat the divergence as proof that the proxies were trusted too far. The one-line diagnosis: *we optimized the dashboard instead of the system, and the dashboard was measuring proxies that this class of incident doesn't touch.*

### Q6.3 — How would you design a code-health dashboard people actually act on? Walk me through it end to end.

> **Testing:** Synthesis — does everything above cohere into a design?

**A.** I'd design backward from *action and outcome*, in layers:

1. **Start from the outcome, not the metric.** Define what we're actually trying to improve — fewer escaped defects, shorter lead time, less on-call pain — and make those the **top-line panel**. Code metrics earn their place only as *leading indicators* of those.
2. **Gate on new code (Clean as You Code).** The enforcement layer is a CI quality gate on the **diff**: no new bugs/vulns, ≥80% coverage on new code, low new duplication, hotspots reviewed. Held to a high bar, delivered **in the PR**.
3. **Rank, don't list.** For the legacy, a **top-N hotspot** panel weighted by **churn × complexity × severity**, each with a next action and an **owner** — a worklist, not a 4,000-row table.
4. **Trends over absolutes.** Show direction of travel (new-code health improving, hotspots shrinking) with a **floor alarm** so a stably-terrible absolute still flags.
5. **A basket, cross-checked.** Coverage *and* mutation score; debt *and* incidents — so gaming one metric is visible in another.
6. **Governance: team self-diagnostic, never a leaderboard.** Run per codebase, owned by the team, explicitly **off performance reviews and cross-team rankings.** Framed as "inputs to a conversation," not verdicts.
7. **Validate the loop.** Periodically check that the code metrics actually *correlate* with the outcomes; drop or fix any that don't.

The thesis tying it together: **actionable = outcome-anchored + new-code-gated + risk-ranked + trend-led + cross-checked + team-owned.** A dashboard built that way drives behavior; one built as a wall of absolute numbers tied to reviews drives gaming.

### Q6.4 — Your coverage gate is at 80% and the team hits it exactly, every time — but bugs keep escaping. What's happening and what do you do?

> **Testing:** Recognizing gaming-to-threshold and the right counter.

**A.** Hitting *exactly* 80%, repeatedly, is the fingerprint of **optimizing to the threshold** — the team is writing the minimum tests to clear the gate, and Goodhart has set in: coverage became the target, so they produce coverage, not *tests that catch bugs*. The escaping bugs say the covered lines aren't actually *verified* — classic **assertion-free or assertion-thin tests** that execute code without checking outcomes, plus the untested 20% probably contains the gnarly paths.

What I'd do: **stop treating coverage as the quality signal and measure what coverage was a proxy for.** Concretely — add **mutation testing** (Stryker/PIT): it injects faults and checks whether the suite *fails*, directly measuring whether tests assert anything; a high coverage + low mutation score proves the gaming. Shift the gate toward **outcome metrics** (defect-escape rate, change-failure rate) that can't be satisfied by empty tests. Keep coverage as a *floor on new code* but never as the headline, and pair it with **review norms** that look at assertion quality. The lesson restated: a threshold on a gameable proxy gets gamed to exactly the threshold; the counter is to measure the *outcome* the proxy stood for, with a metric that's hard to fake.

### Q6.5 — A manager wants a single "code health score" for the whole org to put on a slide. Do you give them one?

> **Testing:** Holding the line on aggregation honesty under organizational pressure.

**A.** I'd give them something *honest* rather than the single number as asked — and explain why. A lone org-wide score is the **aggregation pitfall at maximum compression**: it averages over wildly different services, hides every hotspot, isn't comparable across teams, and the moment it's on a leadership slide it becomes a Goodhart target that gets gamed. It also can't be *acted on* — "org health is 73" tells no one what to do.

What I'd offer instead: a **small dashboard, not a scalar.** A trend line of **new-code health** org-wide (direction of travel, which *is* meaningfully aggregatable), alongside **outcome trends** (defect-escape rate, change-failure rate), and a **distribution view** — e.g. "32 of 40 services pass their new-code gate; here are the 8 that don't, ranked by risk." That gives leadership the *one-glance* read they want (are we improving? where's the risk concentrated?) without the dishonesty of a single grade. If they insist on one number, I'd make it the **least gameable, most outcome-adjacent** one available — percentage of teams passing their new-code gate, or change-failure rate — and caveat it explicitly. The senior move is to satisfy the legitimate need (a glanceable summary) while refusing the harmful form (a rank-able scalar that hides the distribution).

---

## Theme 7 — Outcomes

### Q7.1 — How do you know a code-health dashboard is *working*? What do you measure?

> **Testing:** Whether you validate the instrument against reality instead of admiring it.

**A.** A dashboard is working if it's **changing outcomes**, not if its own numbers are green — so I measure the dashboard by things *downstream* of it:
- **Defect-escape rate** — bugs reaching production per release. If the dashboard is improving code health, escapes should trend down.
- **Lead time for changes** and **change-failure rate** — the DORA pair; healthier code is easier and safer to change, so these should improve.
- **MTTR / incident frequency** — fewer and shorter operational fires.
- **Behavioral evidence** — are people *opening* it and *acting*? PRs fixed in response to gate feedback, hotspots actually refactored. An unopened dashboard isn't working regardless of its scores.

Crucially, I'd test that the *internal* metrics actually **correlate** with these outcomes over time; if "grade improving" never coincides with "fewer escaped defects," the dashboard is measuring the wrong things and I'd change them. The instrument is validated against reality, not against itself.

### Q7.2 — Why tie code-health work to defect rate and lead time rather than to the score itself?

> **Testing:** The whole topic's thesis — the score is a means, the outcome is the end.

**A.** Because **the score was always a proxy, and optimizing the proxy is the entire failure mode** (Theme 3). The reason anyone funds code-health work is that they believe better code yields *fewer defects, faster delivery, less operational pain* — those outcomes are the actual goal; the grade is just a cheap, early, gameable *indicator* of them. Tie the work to the score and you get surrogation (people chase the A and game it) and you can't tell if the effort is paying off. Tie it to **defect rate and lead time** and three good things happen: the goal is **hard to game** (you can't fake fewer production incidents the way you fake coverage), the work is **justified in business terms** leadership already values, and you can **prove ROI** ("after the refactoring program, change-failure rate fell from 18% to 7%").

It also re-frames the metric correctly: the score is a **leading indicator** you watch to act *early*; the outcome is the **lagging indicator** that tells you whether it worked. You steer by the proxy but you *judge by the outcome*. A team that says "our grade went from C to A" has reported activity; a team that says "escaped defects dropped 40% and lead time halved" has reported *results* — and that's the only thing the dashboard exists to produce.

### Q7.3 — A six-month refactoring effort moved the dashboard from C to A. How do you tell if it was worth it?

> **Testing:** Connecting metric movement to value — guarding against celebrating the proxy.

**A.** "C to A" by itself proves only that the *proxy* moved — and proxies can move without value (you may have gamed the SQALE denominator, suppressed smells, or polished cold code nobody touches). To know if it was *worth it*, I'd check whether the **outcomes** moved and whether the effort hit the **right code**:

- **Did outcomes improve?** Compare defect-escape rate, change-failure rate, lead time, and incident frequency *before vs after*. If escapes and change-failures fell and changes got faster, the grade improvement was *real and valuable*. If outcomes are flat, the A is cosmetic.
- **Did we refactor the code that matters?** Was the effort spent on **hotspots** (high churn × high complexity) where improvement compounds, or on low-traffic files that lifted the *average grade* without touching real risk? The former pays off; the latter is grade-polishing.
- **What did it cost vs. return?** Six months of engineering time is real; weigh it against the measured outcome delta and the reduced future drag (faster onboarding, fewer fires).

The honest verdict requires the outcome data, not the letter. If someone reports the C→A as the *result*, I'd treat that as a yellow flag — the grade is the activity metric; *defect rate and lead time are the result.* It was worth it iff the things we actually care about got measurably better, ideally because we fixed the code that was actually hurting.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What does a quality gate do?** A: Evaluates pass/fail conditions on each analysis and, wired into CI, can block the merge/deploy when red — the thing that makes a dashboard *act*.
- **Q: What is "Clean as You Code"?** A: Gate and judge only **new/changed** code, leaving legacy alone unless touched — so the codebase improves incrementally and the gate stays relevant.
- **Q: What drives SonarQube's reliability rating?** A: **Bugs**, by **worst severity** — one Blocker bug forces an E.
- **Q: What's the SQALE debt ratio's denominator?** A: Estimated **cost to write the code from scratch**, computed as a fixed time-per-**line-of-code** — so verbosity dilutes the ratio.
- **Q: State Goodhart's Law.** A: When a measure becomes a target, it ceases to be a good measure.
- **Q: What is surrogation?** A: Mistaking the **metric for the goal** — caring about the A instead of about maintainable software.
- **Q: Why not tie metrics to performance reviews?** A: It weaponizes Goodhart — people game the number against their livelihood, corrupting both the metric and the code.
- **Q: Why is a single overall grade misleading?** A: It's an **average over a skewed distribution** — it hides the few toxic hotspots that cause most of the pain.
- **Q: Better than the mean for code metrics?** A: The **distribution** — percentiles (p95/max) and **churn-weighted** risk, i.e. hotspots.
- **Q: What is a hotspot (CodeScene sense)?** A: A file high in both **complexity and change-frequency** — bad code you also touch constantly, so the highest-ROI refactor target.
- **Q: SonarQube vs CodeScene in one line?** A: Sonar = static analysis + gate on the snapshot; CodeScene = behavioral analysis of **Git history** (hotspots, coupling, ownership risk).
- **Q: Trends or absolutes?** A: **Trend-forward** (direction of travel drives behavior and is fairer), with a **floor alarm** so a stably-terrible absolute still flags.
- **Q: How do you detect assertion-free tests behind high coverage?** A: **Mutation testing** — high coverage + low mutation score = tests that execute but don't verify.
- **Q: Build or buy a dashboard?** A: **Buy the analysis**, build only the **aggregation/policy** layer if you must unify tools or encode org-specific health.
- **Q: The one number worth tracking if forced?** A: An **outcome** (defect-escape or change-failure rate) or **% of teams passing their new-code gate** — least gameable, most meaningful.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating the headline grade as "the quality" — no mention of the distribution or hotspots behind it.
- Conflating SonarQube's separate ratings into one "Sonar score."
- Cheerfully proposing to rank teams or tie metrics to bonuses/reviews.
- Citing Goodhart as a slogan but unable to name the *mechanism* (proxy gaming) or *surrogation*.
- Gating on overall code for a legacy repo and being surprised it's ignored.
- "Just track coverage" with no awareness it's gameable to the threshold.
- Build-vs-buy reflexes with no nuance ("always build it ourselves" / "the vendor solves everything").
- Judging a refactoring effort by the grade delta with no outcome data.

**Green flags:**
- Naming the *distinction* (aggregate/distribution, measure/target, proxy/outcome, all-code/new-code) before defending or attacking a metric.
- Reaching for the **distribution and hotspots** instead of trusting the average.
- Invoking **Clean as You Code** unprompted for legacy.
- Recognizing Goodhart/surrogation the instant a number is displayed or gated, and proposing concrete blunting (baskets, mutation testing, off reviews).
- Anchoring everything to **outcomes** (defect rate, lead time, change-failure rate), treating the score as a leading indicator.
- Pushing back on a ranking *while serving the underlying goal* with a trend-plus-outcomes alternative.
- Designing for **action**: top-N, in-the-PR, owned, trend-led.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **aggregate vs distribution**, **measure vs target**, **proxy vs outcome**, **all-code vs new-code**. Name the distinction first; the judgment follows.
- **What it aggregates:** a dashboard rolls up *proxies* — smells, coverage, duplication, complexity, SQALE debt — into ratings. SonarQube's A–E are **separate axes** (reliability/security are worst-severity cliffs; maintainability is a LOC-diluted ratio). The **quality gate** is the enforcement object; **Clean as You Code** (gate the diff) is what keeps it relevant on real legacy.
- **Aggregation pitfalls:** one grade hides hotspots because debt is **right-skewed**; report the **distribution, percentiles, and churn-weighted risk**, not the mean. Two equal grades are not two equal codebases unless they're commensurable.
- **Goodhart:** any displayed/gated number becomes a target; the mechanism is **proxy gaming**, the cognitive trap is **surrogation**. Never tie metrics to **performance reviews or leaderboards** — it weaponizes the law and blinds you. Blunt it with baskets, outcome-adjacent metrics, mutation testing, and team-owned framing.
- **Designing for action:** top-N (not all-N), **in the PR**, owned, **trends over absolutes** with a floor alarm, new-code gates. Actionable = small + specific-next-step + in-context + owned.
- **Platforms:** Sonar enforces a bar on the diff; CodeScene finds where risk concentrates over Git history; Code Climate leans delivery/flow. **Buy the analysis, build only the aggregation.** Cross-team grade comparisons are valid only with shared profiles/exclusions/context — and even then compare **trends**, not absolutes.
- **Outcomes:** validate the dashboard against **defect-escape rate, lead time, change-failure rate, MTTR** — not its own score. The grade is a *leading indicator* you steer by; the outcome is the *lagging indicator* you judge by. C→A is activity; fewer escaped defects and faster lead time are results.

---

## Further Reading

- *The Tyranny of Metrics* — Jerry Z. Muller. The definitive treatment of measurement dysfunction and surrogation, directly applicable to dashboards.
- *Accelerate* (Forsgren, Humble, Kim) — the DORA metrics (lead time, change-failure rate, deploy frequency, MTTR) the outcome answers lean on.
- SonarQube documentation — **Quality Gates**, **Clean as You Code**, and the **metric definitions** (ratings, SQALE debt ratio). Primary source for the model answers above.
- *Software Design X-Rays* — Adam Tornhill (CodeScene). Behavioral code analysis: hotspots, change coupling, and the churn × complexity model.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [04 — Code Churn and Hotspots](../04-code-churn-and-hotspots/interview.md) — the churn × complexity model behind risk-weighting and the top-N hotspot list.
- [02 — Maintainability Index](../02-maintainability-index/interview.md) — the per-file maintainability metric that the dashboard's aggregate grade compresses.
- [Code Quality Metrics README](../README.md) — where dashboards sit among the individual metrics they aggregate.
- [Quality Engineering README](../../README.md) — the broader interview landscape these metrics serve.

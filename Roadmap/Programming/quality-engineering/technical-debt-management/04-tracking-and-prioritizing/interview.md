# Tracking & Prioritizing — Interview Questions

> **Roadmap:** [Technical Debt Management](../README.md) → Tracking & Prioritizing
> *A debt interview rarely asks "what is technical debt." It asks "you have 200 debt tickets and 20% capacity — how do you choose," and then watches whether you reach for churn data or for the loudest engineer's opinion. The senior signal is that you prioritize by **interest paid in the code you actually touch**, not by how bad the worst file is. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Tracking: Where Debt Lives](#theme-1--tracking-where-debt-lives)
3. [Theme 2 — The Core Prioritization Rule](#theme-2--the-core-prioritization-rule)
4. [Theme 3 — Prioritization Frameworks](#theme-3--prioritization-frameworks)
5. [Theme 4 — Combining Signals](#theme-4--combining-signals)
6. [Theme 5 — Backlog Rot](#theme-5--backlog-rot)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Prioritization Anti-Patterns](#theme-7--prioritization-anti-patterns)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **principal vs interest** (the cost to fix the code vs the recurring tax you pay to live with it)
- **severity vs leverage** (how bad a file is vs how much fixing it actually returns)
- **tracked vs scheduled** (writing debt down vs ever getting it done)
- **the artifact vs the cost** (the messy code vs the slowdown, defects, and risk it produces)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *prioritize by interest in churned code* and can say, in one sentence, why the worst file in the system might be the wrong thing to fix.

---

## Theme 1 — Tracking: Where Debt Lives

### Q1.1 — Where should technical debt be tracked, and why not just leave `// TODO` comments in the code?

> **Testing:** Whether you understand that debt has to be *visible to the people who allocate time*, not buried where only the next reader finds it.

**A.** Debt has to live somewhere a prioritization decision can see it — that means the **same backlog as feature work**, as tickets with labels (`tech-debt`, `refactor`), so it competes for capacity on equal terms. Naked `// TODO` comments fail for three structural reasons. First, they're **invisible to planning**: a product owner sizing the next sprint never greps the codebase, so TODO-debt is never weighed against features. Second, they have **no owner, no cost, and no decay date** — a TODO from 2019 looks identical to one from last week, so nothing forces a decision. Third, they're discovered **only at the moment you're already deep in that file**, which is the worst time to context-switch into a refactor. A study of real codebases found the median TODO survives years and is usually resolved by deleting the surrounding code, not by acting on it. The comment isn't worthless — it's a *breadcrumb at the point of pain* — but it is not tracking. Tracking means the debt is in a system where it can be ranked, assigned, and funded.

### Q1.2 — What does a *good* debt ticket contain that a bad one doesn't?

> **Testing:** Whether you can write debt down as a *business and risk* artifact, not a vague gripe.

**A.** A bad ticket says "refactor the payment module — it's a mess." It's unrankable: no one can compare "a mess" to another team's "a mess." A good debt ticket makes the **interest visible and the remediation concrete**, so it carries:

- **The symptom and its cost** — *what does this debt make slower, riskier, or more defect-prone, and how often?* "Every change to checkout requires editing 4 files because logic is duplicated; we touched it 30 times last quarter and shipped 3 related bugs." That sentence is the *interest*.
- **The blast radius / churn signal** — is this file changed weekly or annually? This is what separates expensive debt from harmless debt.
- **A concrete remediation and its rough cost** — the *principal*. "Extract a `PricingPolicy` type; ~3 days." Without an effort estimate you can't run any prioritization framework.
- **A trigger / linked work** — "next time we add a payment method, do this first." Debt fixed *alongside* the feature that needs it almost always gets done; debt fixed in isolation usually doesn't.

The test of a good ticket: could a peer who's never seen the code rank it against ten others using only the ticket? If yes, it has the cost and the effort; if no, it's a gripe.

### Q1.3 — Where does *design* debt get recorded, given a ticket is the wrong shape for "we chose the wrong architecture"?

> **Testing:** Whether you know that not all debt is a refactor-this-file ticket — some is a decision that needs a paper trail.

**A.** Design and architectural debt belongs in an **ADR — Architecture Decision Record** — not a backlog ticket. The reason is that this class of debt isn't "this code is ugly," it's "we made a *deliberate* tradeoff, here's the context, the alternatives we rejected, and the consequences we're accepting." An ADR captures *why* the debt exists, which is exactly the information a future team needs to decide whether it's still worth paying down or has become load-bearing. A ticket says "fix this"; an ADR says "we knowingly took on this constraint to ship by Q3, and here's what it'll cost to unwind." Mature teams cross-link the two: the ADR documents the decision and its accepted consequences, and when the consequence finally bites, a ticket references the ADR for context. This is also how you distinguish **deliberate, prudent debt** (a recorded, reasoned shortcut) from **inadvertent debt** (the mess you discover later) — the deliberate kind has an ADR; the inadvertent kind you find via the quantification signals from the previous topic.

### Q1.4 — How do you keep a debt register from going stale the moment it's written?

> **Testing:** Whether you treat the register as a living input to planning or as a write-only graveyard (foreshadowing Theme 5).

**A.** A register stays alive only if it's **regenerated from signals, not maintained by hand**. Hand-curated debt lists rot because no one is paid to garden them. The durable approach is to let *most* of the register be **derived continuously**: hotspot analysis (churn × complexity), static-analysis trends, and quantified-debt metrics from the previous topic produce a ranked view automatically, so the "register" is a query, not a document. The hand-written part — ADRs and the few high-context tickets — stays small and is reviewed on a cadence (e.g., debt items get a *decay date*; if untouched at 90 days, they're either re-justified or closed). The anti-pattern to call out: a wiki page of 300 debt items nobody has read since the offsite. If your register requires manual upkeep to stay accurate, it will be wrong within a quarter, and a wrong register is worse than none because it gives false confidence that debt is "tracked."

---

## Theme 2 — The Core Prioritization Rule

### Q2.1 — What is the single most important rule for prioritizing technical debt?

> **Testing:** The one principle the whole topic reduces to. If you get this, the rest is mechanics.

**A.** **Pay interest first — fix debt in the code you actually change.** Technical debt only costs you when you *touch* the code: a tangled module you never modify charges no interest, while a moderately messy file you edit weekly charges interest on every change. So the rule is to rank debt by *expected interest paid*, which means rank by **change frequency (churn)**, not by how bad the code is in isolation. The worst-quality file in the codebase is frequently the *wrong* thing to fix, because if it's stable and rarely touched, fixing it returns almost nothing. The highest-leverage debt sits at the intersection of "messy" and "changed constantly" — the hotspots. A senior answer states this as a one-liner: *debt is only expensive where it intersects with change, so prioritize by interest, and interest is paid in churn.*

### Q2.2 — Give me a concrete case where the messiest code in the system is the *wrong* thing to fix.

> **Testing:** Whether you can resist "worst code first" — the most common amateur instinct.

**A.** A 4,000-line `LegacyTaxCalculator` with a cyclomatic complexity of 300, written in 2011, that nobody has modified in three years because the tax rules it encodes haven't changed. By any static metric it's the worst file in the repo — and fixing it is close to pure waste. It charges **zero interest**: no one reads it, no one changes it, it ships correct results. Spending two engineer-weeks refactoring it produces a cleaner artifact and *no* measurable return — no faster feature delivery, no fewer bugs, because no one was being slowed by it. Meanwhile a 200-line `CheckoutController` with merely *bad* complexity, touched 40 times last quarter and implicated in five incidents, is charging interest on every single change. The lesson: **static badness is not cost; cost is badness × change frequency.** A tool that sorts by complexity alone will march you straight into the highest-effort, lowest-return work. This is why hotspot analysis multiplies complexity *by churn* rather than ranking on complexity alone.

### Q2.3 — If debt in untouched code is "free," should we ever fix it?

> **Testing:** Whether you apply the rule with judgment instead of as a dogma — interest isn't the *only* axis.

**A.** Mostly no — leave it — but the rule has two principled exceptions, both of which are still about *cost*, not aesthetics. First, **latent risk**: untouched code can still charge a one-time catastrophic cost rather than recurring interest — an unpatched dependency with a known CVE, a component with no tests guarding a compliance-critical path, a single point of failure. That's not interest, it's *tail risk*, and you prioritize it on probability × blast radius, not churn. Second, **about-to-thaw code**: code that's been frozen but sits directly in the path of a roadmap item you *know* is coming next quarter. Its churn is about to spike, so you prioritize it on *expected future* interest. Outside those two cases, the discipline is to leave cold debt cold and feel no guilt about it — an "untouched, ugly, but correct and low-risk" module is debt you should consciously decide *not* to pay. Maturity is being comfortable carrying debt forever when the interest is genuinely zero.

---

## Theme 3 — Prioritization Frameworks

### Q3.1 — Walk me through the impact × effort framework and how you'd actually use it on a debt backlog.

> **Testing:** Whether you can operate the simplest framework concretely, and whether you know its failure mode.

**A.** Plot every debt item on two axes — **impact** (how much interest fixing it saves: faster delivery, fewer defects, reduced risk) and **effort** (the principal: how long the fix takes) — giving four quadrants:

- **High impact, low effort** — *quick wins.* Do these now; they're the highest ROI and build credibility for debt work.
- **High impact, high effort** — *major projects.* These need real planning and explicit funding; you sequence them, you don't squeeze them in.
- **Low impact, low effort** — *fill-ins.* Boy-scout these when you're already in the file; never schedule them standalone.
- **Low impact, high effort** — *money pits / thankless tasks.* Don't do these. The `LegacyTaxCalculator` from Theme 2 lives here.

The way to *use* it is to attack the quick-wins quadrant first for momentum, then deliberately fund one or two high-impact/high-effort items per quarter. Its failure mode — and you should name it — is that **"impact" is the hard part**: people eyeball it from gut feeling, and the whole thing collapses into opinion. The fix is to ground impact in data (churn, defect counts) rather than vibes, which is exactly why the next step is to fold hotspot signals into the impact axis.

### Q3.2 — Explain Cost of Delay and why it changes how you talk about debt.

> **Testing:** Whether you can reframe debt in the economic language product and finance actually respond to.

**A.** **Cost of Delay (CoD)** is the money you lose *per unit of time* that something isn't done — it puts a *rate* on procrastination. Reframing debt through CoD is powerful because it converts "the code is messy" (which product can ignore) into "we're losing X per week" (which product cannot). For debt, CoD is the *interest*: the recurring cost of *not* fixing it — the extra developer-days per change, the defect-remediation cost, the slipping delivery dates, the risk exposure accruing each week the debt persists. The shift it forces is from thinking about *cost to fix* (a one-time number that always looks like "we can't afford it") to *cost of not fixing* (a per-week bleed that compounds). Once a refactor is framed as "this is costing us three engineer-days every sprint and will keep doing so," it stops being a nice-to-have and becomes a quantified, ongoing loss — which is the only framing that wins funding against features.

### Q3.3 — Apply WSJF (CD3) to rank a piece of debt against a feature. How does the formula work and what does it tell you?

> **Testing:** The flagship framework. Whether you can actually compute it and interpret what it optimizes for.

**A.** **WSJF — Weighted Shortest Job First**, also called **CD3 (Cost of Delay Divided by Duration)** — ranks work by:

```
WSJF = Cost of Delay / Job Duration (Size)
```

You do the **highest-CoD, shortest-job items first**, because that sequence demonstrably minimizes *total* economic loss across the whole backlog — it's the provably optimal ordering when you're delay-cost-sensitive and capacity-constrained. In SAFe, CoD is decomposed into **business value + time criticality + risk reduction / opportunity enablement**, each scored relatively (often a Fibonacci scale), then divided by job size.

Concretely: a feature might have high business value (8) but low time-criticality (2) and no risk-reduction (1), CoD = 11, over a size of 8 → **WSJF ≈ 1.4**. A debt item — say, breaking up a deployment bottleneck — might have lower direct business value (3) but high time-criticality (it blocks three teams, 8) and high risk-reduction (8), CoD = 19, over a small size of 3 → **WSJF ≈ 6.3**. The debt *wins decisively*, and the formula tells you *why*: it's a short job whose delay is bleeding three teams. The crucial property is that WSJF lets debt and features compete in **one ranked list with one unit of measure**, which is the only way debt ever beats features — and it systematically favors **small, high-leverage** fixes over big-bang rewrites. Note WSJF *minimizes delay cost*; it is not designed to maximize value-delivered, so I'd use it as the primary sort and sanity-check the top of the list by hand.

### Q3.4 — When would you *not* use WSJF, and what would you use instead?

> **Testing:** Framework judgment — knowing a tool's boundaries is more senior than knowing the tool.

**A.** WSJF assumes you can estimate Cost of Delay with enough confidence for the *ratios* to mean something; when CoD is pure guesswork, the formula just launders opinion into a number with false precision. In that situation I drop to the cruder but more honest **impact × effort** quadrant for a fast qualitative cut. WSJF also doesn't model **dependencies or risk-of-ruin** well — if item B is worthless until item A ships, or if one item is a latent security catastrophe, raw WSJF will mis-sequence them, so those get pulled out and handled separately (sequence-by-dependency, risk-first for tail events). And for a backlog of *hundreds* of items, scoring every one with WSJF is itself waste — better to **let hotspot data pre-filter to the top ~20**, then apply WSJF only to that shortlist. The meta-point: frameworks are decision aids, not decision *makers*. The number gives you a defensible starting order and a language to discuss tradeoffs; it doesn't absolve you of judgment at the top of the list.

---

## Theme 4 — Combining Signals

### Q4.1 — You have hotspot data (churn × complexity) *and* an impact/effort quadrant. How do you combine them into a single ranking?

> **Testing:** The senior move — using objective signals to *feed* a framework rather than treating them as separate exercises.

**A.** Use the hotspot data to *populate the axes*, not as a parallel ranking. The two aren't competing methods — one is the evidence, the other is the decision frame:

- **Hotspots set the impact axis.** Churn × complexity *is* a proxy for interest, so a file's hotspot score becomes the objective basis for its "impact" score — replacing the gut-feel number that makes naive quadrant analysis unreliable. High-churn, high-complexity files land high on impact *by data*.
- **Remediation estimates set the effort axis.** This still needs human judgment, but only for the shortlist.
- **Then rank within the high-impact band by effort** to find the quick wins among the genuine hotspots.

The procedure end to end: hotspot analysis ranks all files by churn × complexity → take the top N → for each, write the interest as a sentence and estimate the principal → drop them into the quadrant (impact already grounded in the hotspot score) → execute quick-wins-first, fund one major project. This way the *objective* signal (where is interest actually paid) drives *what gets considered*, and the *framework* drives *what gets done first*. You've eliminated the "impact is just opinion" failure mode of Theme 3 by sourcing impact from churn data.

### Q4.2 — How would you express the decision to fix a given hotspot as an explicit cost-benefit number?

> **Testing:** Whether you can make prioritization a *quantified* decision, the way a senior justifies the work to a skeptical stakeholder.

**A.** Frame each candidate as **expected interest saved minus remediation cost**, over a horizon:

```
Net value ≈ (interest paid per change × expected changes over horizon) − one-time remediation cost
```

Worked example: a hotspot currently adds ~1 extra engineer-day per change (the interest), it's changed ~2×/month, and the roadmap says that rate holds for a year → expected interest ≈ 1 day × 2 × 12 = **24 engineer-days/year**. The remediation is estimated at **8 engineer-days**. Net first-year value ≈ 24 − 8 = **+16 engineer-days**, and it keeps paying after that — a clear *fund it*. Run the same arithmetic on the `LegacyTaxCalculator`: interest ≈ 0 changes/year, so expected interest saved ≈ 0, remediation ≈ 10 days → net ≈ **−10 days**, a clear *don't*. The point isn't that the numbers are precise — they're estimates with wide error bars — it's that **the structure forces the right comparison**: you're explicitly weighing *recurring interest saved* against *one-time principal paid*, with churn driving the expectation. That single inequality is the whole topic in one line, and it's the form that lets you defend a refactor (or a *decision not to refactor*) to someone holding the budget.

### Q4.3 — Two hotspots have nearly identical churn × complexity scores. How do you break the tie?

> **Testing:** Whether you go beyond the formula to the second-order factors a real decision turns on.

**A.** When the primary signal ties, break it on the factors the score doesn't capture:

- **Trajectory, not just level** — is one hotspot's churn *accelerating* (new feature area heating up) while the other's is flat or cooling? Fix the rising one; you're catching it before the interest compounds.
- **Blast radius of defects** — equal churn, but one is in payments/auth (a bug is an incident and a headline) and the other is in an internal admin tool. Risk-weight toward the high-blast-radius one.
- **Effort asymmetry** — if one is a clean 3-day extraction and the other a murky 3-week untangling with no tests, the WSJF/CD3 logic says do the *short* one first; same return, faster realization, lower risk.
- **Test coverage as an enabler** — the one with decent tests is safe to refactor *now*; the untested one needs a characterization-test investment first, which changes its true effort. Sequence the safe one ahead, or fund the tests as a prerequisite.
- **Team knowledge** — if the people who understand one of them are leaving, there's a *key-person-risk* reason to do that one while the context still exists.

The meta-answer: the churn × complexity score gets you to the *shortlist*; the tie-break is where senior judgment lives, and it's mostly about **trajectory, blast radius, and realization speed**.

---

## Theme 5 — Backlog Rot

### Q5.1 — Why do standalone technical-debt tickets reliably die in the backlog?

> **Testing:** The single most important *practical* truth in the topic — most debt is never paid because of how it's scheduled, not whether it's tracked.

**A.** Because a standalone debt ticket competes against features on a battlefield it always loses. The structural reasons: it has **no external deadline** (no customer is waiting), it has **diffuse benefit** ("the codebase gets better" has no champion the way "this feature ships revenue" does), and its value is **invisible to the people prioritizing** unless someone has done the work of quantifying its interest. So every planning cycle, the debt ticket gets out-argued by something with a date and a dollar figure, and it sinks. Repeat for a few quarters and you have the **debt-register graveyard**: hundreds of tickets nobody will ever pull, sitting there as a monument to good intentions. The deep insight is that *tracking debt does not pay it down* — writing it on a list and scheduling it as standalone work is necessary but wildly insufficient, because the scheduling model guarantees starvation. This is why the most effective teams don't rely on standalone debt tickets at all as their primary mechanism.

### Q5.2 — If standalone tickets die, how does debt actually get paid down?

> **Testing:** Whether you know the mechanism that *works* — opportunistic, in-flow remediation.

**A.** **Fix-on-touch**, also called the **Boy Scout Rule**: *leave the code a little better than you found it, every time you're in it.* The reason this is the workhorse mechanism — not the heroic refactoring epic — is that it perfectly aligns with the core prioritization rule. By definition, the code you're *touching* is the code charging interest, so improving it as you pass through pays down exactly the right debt at exactly the right time, with **near-zero scheduling cost** because you're already there with the context loaded. A feature change to checkout? While you're in there, extract the duplicated block, add the missing test, rename the cryptic variable. The debt is paid as a *side effect of work that was already funded*, so it never has to win a prioritization fight. The discipline scales: make "did you leave it better?" a code-review norm, and budget a standing slice of capacity (a common figure is ~20%) for in-flow cleanup so engineers have explicit permission. The mental model shift is from *debt paydown as a project* (which starves) to *debt paydown as a continuous behavior* (which compounds) — reserving standalone, funded projects only for the high-impact/high-effort quadrant that genuinely can't be boy-scouted incrementally.

### Q5.3 — Isn't "fix it whenever you're in there" just a license for unbounded scope creep and risky drby-by edits?

> **Testing:** Whether you apply the Boy Scout Rule with engineering discipline rather than as a blank check.

**A.** It would be, without two guardrails, and a senior names them. First, **bounded blast radius**: boy-scouting is for *small, local, low-risk* improvements — rename, extract a function, delete dead code, add a test — the low-effort quadrant. A "while I'm here" that turns into restructuring a subsystem is no longer fix-on-touch; that's a major project masquerading as a cleanup, and it should be pulled out into its own funded, reviewed work. Second, **separate the commits**: keep the refactor in its own commit (or PR) distinct from the behavior change, so review can reason about each and a revert is surgical — mixing a risky refactor into a feature diff is how "leave it better" causes an incident and discredits debt work entirely. With those two rules — *keep it small, keep it separate* — fix-on-touch is safe and compounding. Without them, the skeptic is right and you've just argued yourself into scope creep. The judgment line is exactly the impact/effort quadrant: boy-scout the low-effort cells, *schedule* the high-effort ones.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — You have 200 debt tickets and roughly 20% of capacity to spend on debt. How do you choose what to do?

> **Testing:** The flagship scenario. Whether you have a *system* or just an opinion — and whether that system is interest-first.

**A.** I'd refuse to triage 200 tickets by hand — that's itself waste — and instead run a funnel that lets data do the first cut:

1. **Filter to interest, not severity.** Pull churn data and overlay it on the debt items; discard the ones in cold code regardless of how ugly they are. This typically collapses 200 to ~20–30 candidates immediately, because most debt is in code nobody touches.
2. **Rank the survivors by leverage.** For the shortlist, score each with WSJF/CD3 (or net-interest-saved-minus-cost from Theme 4) so the small, high-interest, high-risk items rise to the top in one ranked list.
3. **Split the 20% by quadrant.** Spend most of it on **quick wins** (high-impact/low-effort hotspots) for compounding ROI and visible momentum, and reserve a slice to *fund one* high-impact/high-effort major project properly.
4. **Push the rest into fix-on-touch.** The long tail of small-but-real items isn't scheduled at all — it's handled by the Boy Scout Rule as engineers pass through, so it doesn't consume the 20% budget.
5. **Garbage-collect the register.** Many of the 200 are stale or duplicate; close them with a decay policy so the list stops lying about how much debt is "tracked."

The shape of the answer is what's being graded: *data filters to where interest is paid → a framework ranks the survivors → capacity is split quick-wins-plus-one-big → the tail goes to fix-on-touch.* An answer that starts manually reading tickets, or that sorts by how-bad-the-code-is, fails the question.

### Q6.2 — Product won't fund a refactoring epic. The code is genuinely slowing you down. What do you do?

> **Testing:** Whether you can make debt an *economic* argument and whether you have a Plan B that doesn't require their permission.

**A.** I treat "no" as a signal that I framed it wrong, not as a dead end, and I move on two fronts. **First, re-pitch it in their language — Cost of Delay.** "Refactor the order module" is invisible to product; "every order-related feature currently takes ~40% longer and we've shipped 6 related defects this quarter, costing ~X engineer-days per sprint, and it compounds" is a *quantified ongoing loss* they can weigh against revenue. I tie it to a roadmap item they care about: "the loyalty feature you want in Q3 lands in three weeks instead of six if we do this first." Reframing debt as interest-per-week, attached to *their* goal, is usually what flips a no. **Second — and this is the senior part — I don't wait for the epic to be funded.** I push the same work through **fix-on-touch**: as features land in that module, the team improves it incrementally under the standing cleanup budget, so the debt gets paid as a side effect of funded work without ever needing a dedicated epic. The combination is the answer: *make the economic case to get the big-ticket version funded, and route the rest through in-flow remediation that doesn't require their sign-off.* Demanding a refactoring epic as the *only* path — and stopping when it's refused — is the junior failure here.

### Q6.3 — An engineer keeps insisting on refactoring their pet file. Hotspot data says it's cold and low-risk. How do you push back?

> **Testing:** Whether you can enforce the interest-first rule against a strong personal preference, with data and without crushing morale.

**A.** I push back **on the data, not the person**, and I make it a teaching moment about the prioritization rule rather than a veto. The conversation: "I get that this file bugs you — it's genuinely ugly. But it's been touched twice in the last year and it's not on any roadmap we have, so refactoring it returns almost nothing: we'd spend a week and no feature ships faster, no bug count drops. Here's the hotspot view — *these* three files are where we're actually bleeding time, because we're in them every week. If we have refactoring energy, that's where it pays off." The principle I'm enforcing is **interest, not aesthetics**: a clean artifact is not the goal, *reduced cost* is, and cold code charges no interest. Two softeners that keep it from being a flat no: I offer the legitimate path — "if you're *in* that file for a feature, boy-scout it; that's exactly what fix-on-touch is for" — and I take the trajectory exception seriously: if they have *evidence* the file is about to heat up (an upcoming project routes through it), that changes the math and I'd reconsider on *future* interest. But absent that, "I personally dislike this file" is precisely the squeaky-wheel anti-pattern, and the job of prioritization is to be the data-backed counterweight to it.

### Q6.4 — Leadership wants a single number for "how much debt do we have." How do you respond?

> **Testing:** Whether you can resist a misleading metric while still giving leadership something decision-useful.

**A.** I'd push back gently on the single-number framing because it invites the wrong behavior, then give them what they actually need. A lone "debt score" (say, a SonarQube remediation-time estimate of "1,200 days") is **actively misleading for prioritization**, because it sums debt across cold and hot code indiscriminately — most of that 1,200 days is in code nobody touches and is therefore *not costing anything*. Optimizing to shrink that number would send the team to refactor cold code, the exact anti-pattern. What's decision-useful instead is a small dashboard: **debt concentrated in hotspots** (the part actually charging interest), **trend** (is interest-bearing debt growing or shrinking per quarter), and **interest paid** (lead-time and defect-rate in high-churn areas). If they insist on one headline number, I'd make it *hotspot debt* or *estimated interest per sprint*, never total remediation cost — because the number you report is the number people optimize, and total-debt optimizes for the wrong thing. The senior move is refusing to hand over a metric that will drive bad prioritization, even when asked for it directly.

---

## Theme 7 — Prioritization Anti-Patterns

### Q7.1 — What is the "squeaky wheel" anti-pattern in debt prioritization?

> **Testing:** Whether you recognize the most common *social* failure mode and can name its cost.

**A.** **Squeaky wheel** is prioritizing whatever debt the *loudest or most senior engineer* complains about, rather than what the data says is expensive. It's seductive because the complaint is vivid and the complainer is persistent, but it systematically mis-allocates: the file someone finds personally annoying is frequently cold code (their *pet file* from Q6.3), while the genuinely expensive hotspots may have no advocate because no single person feels their diffuse, everyday drag. The cost is double — you spend scarce debt capacity on low-interest work *and* you let the high-interest debt keep compounding unchampioned. The antidote is exactly the interest-first discipline: a churn-backed hotspot view that acts as an objective counterweight to volume, so prioritization answers to *evidence of interest paid* rather than to *decibels*. A team that prioritizes debt by who argues hardest doesn't have a prioritization process; it has a popularity contest.

### Q7.2 — Why is sorting the debt backlog by severity a trap?

> **Testing:** Whether you've fully internalized that severity ≠ cost — the central misconception of the whole topic.

**A.** Because **severity measures how bad the code is, and cost is how bad × how often you touch it** — sorting by severity drops the second factor entirely. A severity sort puts your single worst, most-complex file at the top of the list; but as Theme 2 established, that file is often stable and cold, so fixing it is the *highest-effort, lowest-return* work in the building. Severity-sorting is the algorithm that reliably marches a team into the money-pit quadrant while the moderately-bad-but-constantly-changed hotspots — where the actual interest is paid — sit ignored lower down the list. It feels rigorous because it's data-driven, which makes it more dangerous than gut feel: it's *the wrong data*, presented authoritatively. The correct sort key is **interest** (severity × churn, i.e., the hotspot score), never severity alone. Any tool or dashboard that ranks debt purely by complexity or "code smell count" is steering you wrong, and naming that is a strong signal.

### Q7.3 — What's the "recency" anti-pattern, and how does it distort what gets fixed?

> **Testing:** A subtler bias — letting *when* debt surfaced drive priority instead of its cost.

**A.** **Recency** is prioritizing the debt you *most recently noticed* — the gnarly code from yesterday's incident, the thing that came up in this morning's standup — over debt that's been quietly expensive for a year. It's a cousin of availability bias: fresh pain feels urgent, so it jumps the queue regardless of its actual interest. The distortion is that priority ends up tracking *salience* rather than *cost*: a freshly-discovered ugliness in cold code can leapfrog a long-known hotspot that's been bleeding engineer-days the whole time, simply because it's top-of-mind. It also makes prioritization lurch — the list reshuffles around whatever the last firefight touched. The defense is the same standing, data-derived hotspot ranking: because it's *continuously regenerated from churn*, it surfaces the debt that's genuinely most expensive whether you noticed it yesterday or it's been silently costing you since last year. Recency, squeaky-wheel, and severity-sorting are three faces of one mistake — **letting something other than interest-paid set the priority** — and the single cure for all three is ranking by churn-weighted cost rather than by salience, volume, or raw badness.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Principal vs interest in debt?** A: Principal is the one-time cost to fix the code; interest is the recurring tax (slower changes, more bugs) you pay while it's unfixed.
- **Q: One-line rule for prioritizing debt?** A: Pay interest first — fix debt in the high-churn code you actually touch; ignore cold code no matter how ugly.
- **Q: Why do naked `// TODO`s fail as tracking?** A: They're invisible to planning, have no owner/cost/decay date, and surface only when you're already deep in the file.
- **Q: Where does design/architectural debt go?** A: An ADR — it records the *decision, alternatives, and accepted consequences*, not just "fix this."
- **Q: What's the WSJF formula?** A: WSJF = Cost of Delay ÷ Job Duration (size); do the highest-CoD, shortest jobs first.
- **Q: What is CD3?** A: Cost of Delay Divided by Duration — the same thing as WSJF, framed economically.
- **Q: What does Cost of Delay measure?** A: The money lost *per unit time* that work isn't done — i.e., the interest, framed as a rate.
- **Q: The four impact/effort quadrants?** A: Quick wins (do now), major projects (fund + sequence), fill-ins (boy-scout), money pits (don't).
- **Q: What makes a hotspot a hotspot?** A: High churn × high complexity — the intersection where interest is actually paid.
- **Q: Why does the messiest file often not get fixed?** A: If it's cold, it charges zero interest, so fixing it returns nothing — severity isn't cost.
- **Q: What is the Boy Scout Rule?** A: Leave code a little better than you found it every time you touch it — fix-on-touch.
- **Q: Why do standalone debt tickets die?** A: No deadline, diffuse benefit, invisible value — they lose every prioritization fight to dated, dollar-valued features.
- **Q: The "squeaky wheel" anti-pattern?** A: Prioritizing the loudest engineer's complaint instead of the churn data.
- **Q: Why is severity-sorting a trap?** A: It ignores churn, so it ranks cold worst-code first and marches you into the money-pit quadrant.
- **Q: One number for "total debt" — good idea?** A: No — it sums cold and hot debt, so optimizing it sends you to refactor code nobody touches; report hotspot debt or interest-per-sprint instead.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- "Fix the worst code first" — sorting by severity, ignoring churn entirely.
- Treating `// TODO` comments as a tracking system.
- Reaching for a big refactoring *epic* as the only way to pay debt down.
- Conflating principal (cost to fix) with interest (cost of not fixing).
- Prioritizing by who complains loudest or what broke most recently.
- Wanting a single "total debt" number and optimizing to shrink it.
- Refactoring as an end in itself — chasing a clean artifact rather than reduced cost.

**Green flags:**
- Saying "interest first — fix debt in the code we actually change" unprompted.
- Using hotspot data (churn × complexity) to *ground the impact axis* instead of guessing.
- Reframing debt as Cost of Delay / interest-per-week to win funding.
- Naming fix-on-touch / Boy Scout Rule as the primary paydown mechanism, epics as the exception.
- Computing WSJF/CD3 and noting it favors small, high-leverage fixes — then sanity-checking the top by hand.
- Being comfortable *consciously carrying* cold debt forever.
- Distinguishing latent risk and about-to-thaw code as principled exceptions to interest-first.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **principal vs interest**, **severity vs leverage**, **tracked vs scheduled**, **artifact vs cost**. Prioritize by interest paid in churned code; the framework follows.
- **Tracking:** debt belongs in the *same backlog as features* as rankable tickets with cost + effort + churn; design debt goes in **ADRs**; naked TODOs aren't tracking, and a hand-maintained register rots into a graveyard — derive it from signals.
- **The core rule:** pay interest first. Debt only costs you where it intersects change, so rank by **churn**, not by static badness. The worst file is often the wrong fix; cold debt is consciously carried, with exceptions only for latent risk and about-to-thaw code.
- **Frameworks:** impact × effort for a fast cut (ground "impact" in data); **Cost of Delay** to reframe debt as a per-week loss; **WSJF / CD3** to put debt and features in one ranked list — it favors small, high-leverage fixes and minimizes total delay cost.
- **Combining signals:** hotspots set the impact axis, estimates set effort; the whole decision compresses to *expected interest saved − remediation cost*, with churn driving the expectation.
- **Backlog rot:** standalone debt tickets starve because they have no deadline and diffuse benefit; the workhorse paydown mechanism is **fix-on-touch / Boy Scout Rule** (small, separate commits), with funded epics reserved for the high-impact/high-effort quadrant.
- **Anti-patterns:** squeaky-wheel (loudest wins), severity-sorting (badness ≠ cost), and recency (salience ≠ cost) are three faces of one mistake — letting something other than *interest paid* set the priority. The single cure is ranking by churn-weighted cost.

---

## Further Reading

- *Managing Technical Debt* (Kruchten, Nord, Ozkaya) — the SEI treatment of debt as principal/interest and the basis for prioritizing by cost, not severity.
- *Software Design X-Rays* (Adam Tornhill) — the definitive case for hotspots (churn × complexity) and for prioritizing debt where change actually concentrates.
- Donald Reinertsen, *The Principles of Product Development Flow* — Cost of Delay and WSJF/CD3 as the economic basis for sequencing work.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- *The Pragmatic Programmer* (Hunt & Thomas) — the Boy Scout Rule and broken-windows reasoning behind fix-on-touch.

---

## Related Topics

- [02 — Identifying and Quantifying](../02-identifying-and-quantifying/interview.md) — the signals (hotspots, metrics, interest measurement) that *feed* the prioritization here.
- [05 — Paying Down Debt](../05-paying-down-debt/interview.md) — once it's ranked, how you actually remediate it: incremental strategies, the strangler pattern, and budgeting.
- [Technical Debt Management README](../README.md) — where tracking and prioritizing sit in the broader debt lifecycle.
- [Quality Engineering README](../../README.md) — where debt management sits in the broader interview landscape.

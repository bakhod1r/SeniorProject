# Identifying & Quantifying — Interview Questions

> **Roadmap:** [Technical Debt Management](../README.md) → Identifying & Quantifying
> *A debt interview rarely asks "what is technical debt." It asks "you inherit a 500k-line app — where does the debt actually hurt?" and then watches whether you reach for a static smell count (junior) or for version-control behavior (senior). This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Finding the Debt](#theme-1--finding-the-debt)
3. [Theme 2 — Hotspots and Behavioral Analysis](#theme-2--hotspots-and-behavioral-analysis)
4. [Theme 3 — Principal vs Interest in Measurement](#theme-3--principal-vs-interest-in-measurement)
5. [Theme 4 — Tooling and Methods](#theme-4--tooling-and-methods)
6. [Theme 5 — Measurement Traps](#theme-5--measurement-traps)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Communicating the Estimate](#theme-7--communicating-the-estimate)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **principal vs interest** (the cost to fix vs the cost you keep paying while it's unfixed)
- **static snapshot vs behavioral signal** (what the code *is* vs what people actually *do* to it)
- **a number vs a decision** (a metric is only useful if it changes what you'd do next)
- **measuring the code vs measuring the pain** (a smell is a hypothesis; churn is evidence the hypothesis matters)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a tool — and who can say, of any metric, "here's what it tells me and here's exactly where it lies."

---

## Theme 1 — Finding the Debt

### Q1.1 — You join a team with no documentation about quality. How do you find where the technical debt is?

> **Testing:** Do you have a *method*, or do you just "read the code and form an opinion"?

**A.** I triangulate three independent signals, because no single one is trustworthy:

1. **The code itself** — static analysis and code smells (long methods, deep nesting, duplicated blocks, god classes). This is cheap and instant but it's a *snapshot*: it tells me what's ugly, not what matters.
2. **The version-control history** — which files change constantly, which change together, where complexity is trending up. This tells me where the *team actually spends effort*, which is the closest proxy I have to where debt is charging interest.
3. **The people** — ask "what do you dread touching?" and "where do bugs keep coming back?" Engineers carry a mental hotspot map that no tool fully reproduces; the trick is to *confirm* their intuition with data, not replace it.

The debt that matters is the *intersection*: code that is both bad (smells) and busy (churn). A horrible file nobody touches is a museum piece; a moderately messy file the whole team edits weekly is where the money is leaking.

### Q1.2 — What are the "here be dragons" signs you look for first?

> **Testing:** Whether you know the high-signal smells versus cosmetic ones.

**A.** I prioritize the smells that *predict change cost*, not the ones that merely offend taste:

- **Files everyone is afraid to touch** — the social signal. If three engineers independently name the same file, that's data.
- **A few files that dominate the churn** — almost every codebase has a small set of files responsible for a large share of all changes and a large share of all bugs.
- **Rising cyclomatic/cognitive complexity over time** — not the absolute number, the *trend*. A file getting steadily more complex is debt accruing in real time.
- **Change coupling** — files that always change together but live in different modules, signalling a hidden, unmanaged dependency.
- **Bug clustering** — the same files recurring in incident postmortems.

Cosmetic things (naming, formatting, a slightly long function in a stable file) I deliberately *deprioritize*. They're real but they're not where the interest is.

### Q1.3 — How do you make invisible debt visible to people who don't read code?

> **Testing:** Whether you can turn a felt problem into something a stakeholder can act on.

**A.** Debt is invisible because it has no line item — it lives in slowing velocity and rising bug rates that look like "the team got slower" with no cause. To make it visible I attach it to things non-engineers already track:

- **Map it onto a picture of the system.** A hotspot map (a treemap of the codebase coloured by churn × complexity) lets a manager *see* the red zones without reading a line of code.
- **Tie it to outcomes they feel.** "This module is why every change to checkout takes two weeks and ships with a regression" lands; "cyclomatic complexity is 40" does not.
- **Trend it.** A single number is an opinion; a line going the wrong way over six months is a conversation.

The goal isn't to dump metrics — it's to convert a vague engineering anxiety into a *located, quantified, trending* claim the business can prioritize against features.

---

## Theme 2 — Hotspots and Behavioral Analysis

### Q2.1 — Why is a static analysis snapshot a poor way to find the debt that hurts?

> **Testing:** The central insight of the whole topic — behavior beats snapshots.

**A.** A static snapshot answers "what does the code look like *right now*?" It has no idea what the code *costs*. Two files can have identical complexity scores: one hasn't been touched in three years, the other is edited by five people every week. Static analysis ranks them the same; reality charges you wildly different interest. The snapshot is blind to the *time dimension* — who changes what, how often, and together with what — which is exactly where change cost lives. So a complexity ranking gives you a to-do list sorted by ugliness, when what you want is a to-do list sorted by *pain*. The version-control history supplies the missing dimension.

### Q2.2 — Explain a hotspot. How do you compute one and why is it more actionable than complexity alone?

> **Testing:** Whether you actually understand churn × complexity, not just the buzzword.

**A.** A **hotspot** is a file scoring high on *two* axes at once: **complexity** (how hard it is to understand — cyclomatic, cognitive, or even a cheap proxy like lines of code) and **churn** (how often it changes, measured from commit history). You compute it by extracting per-file change frequency from `git log`, computing a complexity metric per file, and ranking by the product (or by plotting the two and looking at the top-right quadrant).

It's more actionable than complexity alone because the two axes encode *cost × exposure*. Complexity is the cost of understanding the file *each time*; churn is *how many times* you pay that cost. A complex file you never touch has high cost but zero exposure — total interest near zero. A complex file you touch constantly multiplies the cost by the frequency — that's where refactoring pays back fastest. Hotspots turn "where is the worst code" into "where will fixing the code save the most future effort," which is the question that actually justifies the work.

### Q2.3 — What is temporal (change) coupling, and what does it reveal that the dependency graph doesn't?

> **Testing:** Whether you know behavioral coupling can be invisible to static tools.

**A.** **Temporal coupling** (a.k.a. change coupling) is when two files *repeatedly change in the same commit* even though there's no explicit code dependency between them — you measure it from history: "of the times A changed, what fraction did B also change?" It reveals coupling the dependency graph *cannot see*: a serializer and its parser that must stay in lockstep, a config and the code that reads it, two copies of a rule that were duplicated and now must be edited together. Static analysis sees no link because there's no import — but the team pays a coupling tax on every change, and worse, the *forgotten* half is a recurring bug source ("we updated the writer but not the reader"). High change coupling across module boundaries is one of the strongest signals of hidden architectural debt, and it's invisible to anything that only reads the current code.

### Q2.4 — Why look at the complexity *trend* rather than the absolute complexity?

> **Testing:** Whether you reason about debt as a rate, not a level.

**A.** An absolute complexity number is a level; debt is fundamentally about a *rate of decay*. A file that has been complexity-40 and stable for five years is a known quantity the team has made peace with — it may not be worth touching. A file that went from 10 to 40 over the last year is *actively deteriorating*, and the trend predicts it'll be 60 next year and a genuine crisis. Trending lets me catch debt while it's cheap to fix and lets me *prove the direction* to stakeholders ("this isn't bad, it's getting worse, here's the slope"). It also surfaces the opposite — refactoring that's working shows up as a downward trend, which is how I demonstrate that cleanup effort actually paid off. Level tells you where you are; trend tells you where you're going and whether your interventions are helping.

### Q2.5 — How does bus factor / knowledge distribution fit into quantifying debt?

> **Testing:** Whether you see *organizational* debt, not just code debt.

**A.** A file can be clean and still be a liability if exactly one person understands it — that's **knowledge debt**, and you can quantify it from history by looking at the distribution of authorship per file (how concentrated are the commits/lines among authors?). A hotspot that is *also* a single-author island is the highest-risk square on the board: complex, frequently changed, and one resignation away from being unmaintainable. Conversely, a complex file with broad authorship is less risky because the understanding is distributed. I fold this in as a third lens on top of churn × complexity: the worst debt is **complex + busy + owned by one person**. It reframes some "rewrite this" arguments into cheaper "spread the knowledge" arguments — pairing and review can defuse the risk without a refactor.

---

## Theme 3 — Principal vs Interest in Measurement

### Q3.1 — Define principal and interest for technical debt, and why the distinction changes what you measure.

> **Testing:** The financial metaphor used *correctly*, as a measurement guide.

**A.** **Principal** is the one-time cost to fix the debt — refactor the module, clean up the design. **Interest** is the *recurring* cost you pay for as long as the debt exists — every change is slower, riskier, more bug-prone because of it. The distinction is the whole game in measurement because **you should prioritize by interest, not principal.** Most tools measure something proportional to principal (remediation effort, smell counts) and ignore interest entirely. But a high-principal item with zero interest — a horrible file nobody touches — is not worth paying down; a low-principal item charging high interest — a small mess in a hot path everyone edits — is. Measuring principal alone gives you a backlog sorted by *how big the cleanup is*, when you want it sorted by *how much it's costing you to leave it*.

### Q3.2 — A file has the worst complexity score in the codebase and hasn't been edited in four years. How much interest is it charging?

> **Testing:** The single sharpest test of whether the candidate gets it.

**A.** **Essentially zero.** Interest is paid through *change* — you only suffer a file's complexity when you have to read or modify it. A file nobody touches imposes no ongoing cost; its principal is enormous but its interest is near nil. So despite topping the complexity ranking, it's a *low* priority to refactor — you'd spend a large, risky effort to fix something that isn't actually hurting you, and you might introduce bugs into stable code in the process. This is exactly why a pure complexity (or pure smell-count) ranking misleads: it surfaces this file at the top while a far less ugly file in a hot path — charging real interest every week — sits lower. The right answer to "should we fix this?" is "leave it unless we need to start changing it."

### Q3.3 — So how do you *measure* interest, given tools mostly measure principal?

> **Testing:** Whether they can operationalize the metaphor, not just recite it.

**A.** I use change as the proxy for interest, because interest is paid per-change. The practical move is to **weight static findings by churn**: instead of "this file has 12 smells," compute "smells × recent change frequency," which approximates the cost the smells are actually imposing. Concretely:

- Take the smell density or complexity per file (a principal-ish signal).
- Multiply by change frequency from `git log` over a recent window (the interest multiplier).
- Optionally add a bug-fix weighting — changes that were bug fixes count for more, since they're the interest you most want to stop paying.

The result reorders the backlog from "biggest messes" to "messes you keep tripping over," which is interest. It's an estimate, not a ledger — but it's directionally right where raw counts are directionally wrong.

### Q3.4 — Why weight smells by churn instead of just counting them?

> **Testing:** Restating the core technique and its justification.

**A.** Because a raw smell count answers "how much bad code is there?" when the question that drives action is "how much is the bad code costing us?" Counting treats a smell in dead, stable code identically to a smell in a file edited daily — but only the second one is charging interest. Churn-weighting injects the missing cost signal: a smell you never encounter is cheap to leave; a smell on a path you edit constantly is expensive. The effect is dramatic — a file ranked 50th by smell count can jump to the top once you multiply by churn, and that reordering is the difference between a refactoring plan that pays back quickly and one that burns effort on museum pieces. Counting measures the *code*; churn-weighting measures the *pain*, and you fund work against pain.

---

## Theme 4 — Tooling and Methods

### Q4.1 — What does SonarQube's "technical debt ratio" actually measure, and what are its limits?

> **Testing:** Whether you understand the tool's model rather than trusting its number.

**A.** SonarQube estimates **remediation effort** — for each issue it detects, a rule assigns a fixed time-to-fix (e.g., "5 minutes to fix this"), sums those to a total **remediation cost**, and divides by an estimate of the cost to *write the code from scratch* to get the **debt ratio** (which maps to the A–E SQALE rating). So it's a *principal* estimate expressed in time/money.

Its limits are important and I'd state them unprompted:
- **The minutes are arbitrary constants**, not measured for *your* code — a "5 minute" fix may take an hour in a tangled module. The totals look precise but rest on assumptions.
- **It's a static snapshot** — it has no idea which issues are in hot files, so it weights a smell in dead code the same as one in your busiest file. It measures principal and is *blind to interest*.
- **It only sees what its rules encode** — architectural debt, bad abstractions, and design-level problems are largely invisible; it counts local code smells.

I treat the debt ratio as a *coarse, comparable* signal (useful for trend and for gating PRs on *new* debt), never as a literal budget.

### Q4.2 — What is SQALE, and what does it add over a flat smell count?

> **Testing:** Whether the SQALE acronym is just a label or a model they understand.

**A.** **SQALE** (Software Quality Assessment based on Lifecycle Expectations) is the method underneath SonarQube's debt rating. Its useful idea is the **remediation pyramid**: it organizes quality characteristics in a dependency order — testability at the base, then reliability, changeability, security, maintainability — on the principle that you should fix lower-layer problems first because higher layers depend on them. So it adds *structure and prioritization order* over a flat list: it's not just "here are 400 issues," it's "fix the foundational ones before the cosmetic ones." Its limit is the same as any effort-cost model — the remediation times are conventional constants, and the method still measures principal, so it tells you the *order to clean within the code* but not *which code is worth cleaning at all* (that needs churn).

### Q4.3 — What does a behavioral tool like CodeScene give you that SonarQube doesn't?

> **Testing:** Whether they can place behavioral analysis against static analysis precisely.

**A.** CodeScene's core move is **behavioral code analysis** — it mines the *version-control history*, so it natively produces the things a static tool can't: **hotspots** (churn × complexity), **change coupling**, **complexity trends over time**, and **knowledge/bus-factor maps**. Where SonarQube answers "what's wrong with the code as it stands," CodeScene answers "where is the code costing the team effort and risk," which is much closer to *interest*. That's its real value: it prioritizes by behavior, so the top of its list is where refactoring pays back, not just where the code is ugliest.

Its limits: it's a *prioritization and risk* lens, not a linter — it won't catch a specific null-deref or security rule the way SonarQube will. And behavioral signals can mislead if the history is short or distorted (a big reformat commit, a repo migration that rewrote history). The two are complementary: static analysis to find *what's* wrong locally, behavioral analysis to decide *where it's worth fixing*.

### Q4.4 — Can you build a basic hotspot analysis with just git and a complexity tool, no commercial product?

> **Testing:** Whether the concept is theirs or rented from a vendor.

**A.** Yes — the technique is simple enough to do with command-line tools, which is the point: hotspots are a *concept*, not a product. The pieces:

- **Churn:** parse `git log --name-only` over a recent window and count changes per file (a few lines of script, or a tool like `git-quick-stats` / `code-maat`).
- **Complexity:** run any complexity tool (`lizard`, `gocyclo`, `radon`, ESLint complexity rules) to get a per-file score.
- **Combine:** join on filename, rank by churn × complexity, and you have a hotspot list. Add `git log --format=%an` per file for a cheap bus-factor signal, and "files changed in the same commit" for change coupling.

Doing it by hand is worth it once even if you later buy a tool, because it makes clear that the magic isn't proprietary — it's just *using the history you already have*. Commercial tools add nicer visualizations, trend tracking, and tuned metrics, but the core insight is reproducible in an afternoon.

---

## Theme 5 — Measurement Traps

### Q5.1 — A manager says "we have 2 million lines of code, that's a lot of debt." What's wrong with that?

> **Testing:** Whether you reject LOC as a debt measure cleanly.

**A.** **Lines of code is not a debt measure** — it conflates size with quality. Two million lines of clean, well-factored, well-tested code is a healthy large system; two hundred thousand lines of tangled, untested code can be far worse debt. LOC measures *how much code exists*, which is orthogonal to *how costly it is to change*. Worse, treating LOC as debt incentivizes exactly the wrong behavior — people "reduce debt" by deleting or compressing code, or avoid writing tests (which add lines). The honest answer is that debt is about *change cost and risk concentrated in specific places*, so the right question isn't "how many lines" but "which lines do we keep tripping over" — and that's a hotspot question, not a size question.

### Q5.2 — Leadership wants test coverage as the quality KPI. What's the trap?

> **Testing:** Goodhart's law applied to a concrete, common metric.

**A.** The moment coverage becomes a *target* rather than a *signal*, people optimize the number instead of the underlying quality — Goodhart's law. Coverage measures which lines were *executed* during tests, not whether anything was *asserted*. So a team under a coverage mandate writes tests that call code and check nothing, or assert trivialities, and the percentage climbs while real defect-catching power doesn't move. You can hit 90% coverage with tests that would pass even if the code were broken. The trap is that coverage looks like a quality metric but is really an *execution* metric; gamed, it actively *hides* debt behind a green number. I'd use coverage as a *floor and a trend* (uncovered critical paths are a real red flag), never as a headline KPI, and I'd pair it with mutation testing if I genuinely wanted to know whether the tests assert anything.

### Q5.3 — SonarQube says the codebase has "47 days of technical debt." What do you do with that number?

> **Testing:** Whether they treat the false precision skeptically.

**A.** I treat it as a *coarse, relative* indicator and explicitly distrust its precision. "47 days" is the sum of fixed per-issue remediation constants — it reads like a measured estimate but it's a pile of conventional assumptions ("this smell = 5 minutes") that were never calibrated to my code or my team. It's also pure *principal*, blind to which issues are in hot files, so the 47 days includes a lot of museum-piece debt that's charging no interest. So I would never take it to leadership as "we owe 47 days of work." What it *is* good for: **trend** (is it climbing release over release?), **gating** (block PRs that *add* new debt, the ratchet), and **rough comparison** between services. The number's value is in its derivative and its direction, not its absolute magnitude — and I'd say that plainly rather than let anyone budget against it.

### Q5.4 — Why are "arbitrary remediation minutes" a problem even when the totals are used only for comparison?

> **Testing:** Whether they see the subtler failure mode, not just "it's imprecise."

**A.** The subtle problem is that the constants encode a *fixed relative weighting* between issue types that may not match reality, so even comparisons get distorted. If the rule set says a duplicated block is "5 minutes" and a complex method is "20 minutes," then a service full of cheap-but-common smells can score *worse* than a service with a few genuinely dangerous design problems — because the model's prices don't reflect actual fix cost or actual risk. Comparison only works if the measuring stick is consistent *and meaningful*; arbitrary minutes are consistent but not meaningful, so they can rank a less-risky codebase as "more debt." The defense is to anchor decisions in *behavioral* signals (churn, incidents, change-failure rate) that are measured from reality, and use remediation-minute totals only as a loose secondary check, never as the ranking key.

### Q5.5 — Give a one-sentence statement of Goodhart's law and one debt metric it ruins.

> **Testing:** Crisp grasp of the meta-trap behind all the others.

**A.** "When a measure becomes a target, it ceases to be a good measure" — and it ruins essentially any single debt KPI you incentivize directly: coverage gets gamed with assertion-free tests, "number of smells" gets gamed by tuning the linter to stop reporting, story-point velocity gets gamed by inflating estimates. The defense is to (a) use metrics as *signals to investigate*, not *targets to hit*, (b) track several so gaming one is visible in another, and (c) keep humans in the loop interpreting the trend rather than rewarding the absolute number.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — You inherit a 500,000-line legacy app you don't know. How do you find where the debt actually hurts?

> **Testing:** The flagship scenario — method, prioritization, and humility.

**A.** I would *not* start by reading code top to bottom or running a linter and sorting by smell count — at that scale both drown me in findings with no priority. I let the system's own history tell me where it hurts:

1. **Mine the version-control history first.** Compute per-file churn over the last 6–12 months. In almost any large codebase, a small fraction of files accounts for most of the changes — that's where the team actually spends its effort, so that's where debt is charging interest.
2. **Overlay complexity** to get hotspots (churn × complexity). The intersection — complex *and* frequently changed — is the shortlist of maybe a few dozen files that matter, out of tens of thousands.
3. **Add change coupling and bus factor.** Which hotspots drag other files along on every change? Which are understood by one person? That tells me which hotspots are also *risky*, not just costly.
4. **Cross-check with incidents and with the engineers.** Pull the files that recur in postmortems; ask the team what they dread. Where data and intuition agree, I have high confidence.

The output is a ranked, *located* list of the handful of places where cleanup will buy back the most velocity and risk — derived from behavior, not from my opinion of the code or a tool's smell ranking. The discipline is: at 500k lines you must let the data narrow the search before you spend human judgment, and the data that matters is *what people do to the code*, not what it looks like.

### Q6.2 — Leadership wants "a single number for our technical debt." What do you give them, and what do you warn?

> **Testing:** Whether they can serve the request without lying with statistics.

**A.** I'd push back gently first — a single scalar can't capture debt because debt is *located and contextual* — but I won't just refuse, because leadership needs something trackable. So I'd give a number *with explicit caveats and a trend*:

- **What I'd give:** a composite I can defend, ideally a *behavioral* one — e.g., a hotspot-based health indicator (how much of our change activity lands in high-risk code), or a debt ratio used purely as a **trend line**, not a level. I'd frame it as "this is a *thermometer*, not a *bank balance*."
- **What I'd warn:** (1) the absolute value is not literal — "47 days" is not a real backlog you can schedule; (2) it must never become a *target*, or it'll be gamed (Goodhart) and stop meaning anything; (3) it hides *where* the debt is, which is the part that actually drives decisions, so the number is for tracking direction while the *hotspot map* is for deciding work; (4) a single number can move for boring reasons (a tool upgrade, a big merge), so watch the trend over several periods, not period-to-period jumps.

The honest deliverable is a *thermometer plus a map*: the number tells you whether things are getting better or worse; the hotspot map tells you what to actually do. Handing over the number without those warnings is how you end up with a coverage-style farce six months later.

### Q6.3 — Two teams have the same SonarQube debt ratio. Are they equally indebted?

> **Testing:** Whether they reflexively distrust a single comparable number.

**A.** No — equal debt ratios can mask very different realities. The ratio is a static, principal-only measure, so it ignores everything that makes debt *hurt*: Team A's debt might be concentrated in a few hot, single-owner files that everyone edits and breaks weekly; Team B's identical ratio might be spread across stable, rarely-touched code that's charging almost no interest. Same number, wildly different pain. To judge who's actually more indebted I'd look behind the ratio at **where** the debt sits (hotspot overlap), **how fast** each ratio is *trending*, and the **business consequences** (change-failure rate, lead time, incident frequency per team). The ratio is at best a starting point for the comparison, never the verdict — and saying "they're equal" because the numbers match is exactly the trap.

### Q6.4 — Your churn × complexity hotspot list and your engineers' "scariest files" list disagree. What now?

> **Testing:** Whether they treat data and intuition as cross-checks, not rivals.

**A.** Disagreement is *information*, not a contest to settle — I'd investigate each gap:

- **On the data list but not the intuition list:** a file that's hot and complex but nobody flagged. Often this is debt the team has normalized ("oh, that's just how billing is") or that a quiet single owner absorbs — genuinely worth a look, and possibly a bus-factor risk.
- **On the intuition list but not the data list:** a file people fear that isn't statistically hot. Maybe it changed a lot *before* my analysis window, or it's terrifying but stable, or the fear is about a *past* incident. Sometimes the metric is missing something (e.g., complexity that lives in data/config the tool doesn't parse).

Where both lists agree, I have high-confidence targets and I start there. Where they diverge, each side corrects the other — data catches debt people have gone blind to, intuition catches risk the metrics don't model. The senior move is to use them as *complementary lenses*, and to update the analysis (window length, what files are scanned) when intuition reveals a blind spot in the data.

### Q6.5 — How do you know a refactoring you funded actually paid down debt?

> **Testing:** Whether they close the loop with measurement, or just assume cleanup worked.

**A.** I define the success metric *before* the work and measure it after — otherwise "we refactored it" is faith, not evidence. The signals I'd track on the touched code:

- **Complexity trend** turning *downward* on those files (the direct effect).
- **Change cost** dropping — lead time for changes in that area, and fewer files dragged along per change (reduced change coupling).
- **Bug/incident rate** in that module falling over the following months — the interest payment shrinking.
- **Churn** itself sometimes *drops* as the file stops needing constant fixing.

If none of those move, the refactor cleaned cosmetics but didn't pay down real interest, and I'd want to know that — both to course-correct and to keep my credibility when I ask for the *next* cleanup budget. Measuring the after-state is also how I make the business case for future debt work: "last time we did this, lead time in that module dropped 30% and incidents halved."

---

## Theme 7 — Communicating the Estimate

### Q7.1 — How do you present a debt estimate honestly when the underlying numbers are uncertain?

> **Testing:** Whether they can convey uncertainty without sounding like they don't know anything.

**A.** I present *ranges and confidence*, not false point-precision, and I'm explicit about what's measured versus assumed. Rather than "this is 47 days of debt," I'd say "the worst of our change cost is concentrated in about a dozen files; cleaning the top three is roughly a sprint and should meaningfully cut the regression rate in checkout — that estimate is rough, but the *location* of the problem is high-confidence." The key is separating the two kinds of certainty: I'm *very* sure *where* the debt is (behavioral data is solid), and *less* sure *exactly* how long the fix takes (effort estimates are noisy). Saying that explicitly is more credible, not less — stakeholders trust someone who distinguishes what they know from what they're estimating over someone who hands over a suspiciously precise single number. False precision destroys trust the first time the "47 days" turns out to be 90.

### Q7.2 — How do you tie a debt estimate to business outcomes a non-engineer cares about?

> **Testing:** Whether they can translate engineering cost into business language.

**A.** I translate the engineering symptom into the business consequence it causes, using the metrics leadership already feels: **lead time** ("changes to this area take three weeks instead of three days"), **change-failure rate** ("a third of our checkout deploys cause an incident"), and **opportunity cost** ("two engineers spend half their time firefighting this module instead of building features"). The debt isn't "high complexity in `OrderService`"; it's "this is why the pricing feature slipped a quarter and shipped with two regressions." I anchor to money and time and risk, because that's the currency in which features and debt compete for the same budget. The hotspot map is the visual aid — it lets me point at the red squares and say "every expensive, risky change you've felt this year came from here," which connects the abstract metric to outcomes they've personally experienced.

### Q7.3 — A stakeholder wants a precise dollar figure for "our total debt." How do you respond?

> **Testing:** Whether they can decline false precision while still being useful.

**A.** I'd reframe rather than fabricate. A precise total-debt dollar figure is not honestly computable — it would require knowing the exact fix cost and exact future interest of every issue, which no tool measures; any single number I gave would be false precision that I'd regret the first time it was wrong. What I *can* give: the cost of the *specific, highest-interest* items, expressed as outcomes — "the top three hotspots are costing roughly X engineer-weeks per quarter in slowed delivery and rework, and paying them down is roughly Y weeks of work." That's a defensible, scoped figure tied to a decision, instead of an indefensible grand total. I'd be direct that I'm trading a satisfying-but-fake number for a smaller, real one — and explain that a fake total would mislead prioritization, since it averages away the very concentration (a few hot files) that should drive what we fix first.

### Q7.4 — How do you avoid the "wall of metrics" failure when reporting debt?

> **Testing:** Whether they understand that a report must drive a decision.

**A.** A metric earns its place in a report only if it would *change a decision*; everything else is noise that buries the signal. So I lead with the decision I'm asking for ("fund cleanup of these three modules next quarter"), then show the *one or two* signals that justify it — usually the hotspot map plus the trend — and the expected outcome. I keep the long tail of numbers in an appendix for anyone who wants to dig. The failure mode is dumping every metric the tools produce, which makes the reader's eyes glaze and lets them cherry-pick whichever number supports doing nothing. A good debt report reads like an argument with a recommendation, not a dashboard. The test for any number I'm about to include is: "if this were different, would we do something different?" — if not, it stays out.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Churn × complexity gives you what?** A: A **hotspot** — code that's both hard to change and changed often, where refactoring pays back fastest.
- **Q: A horrible file nobody touches — refactor it?** A: No — high principal, near-zero interest; leave it unless you need to start changing it.
- **Q: Why isn't LOC a debt metric?** A: It measures size, not change cost; clean large code is healthy, small tangled code can be worse debt.
- **Q: What's principal vs interest?** A: Principal is the one-time fix cost; interest is the recurring tax you pay every change until it's fixed.
- **Q: What does SonarQube's debt ratio measure?** A: Estimated remediation effort (principal) from fixed per-issue minute constants, as a fraction of cost-to-rewrite — a static snapshot, blind to interest.
- **Q: What does CodeScene add over SonarQube?** A: Behavioral analysis from version history — hotspots, change coupling, complexity trends, bus factor — i.e., a proxy for interest.
- **Q: What is temporal/change coupling?** A: Files that repeatedly change in the same commit despite no code dependency — coupling invisible to static tools.
- **Q: One-line Goodhart?** A: When a measure becomes a target, it stops being a good measure — e.g., coverage gamed with assertion-free tests.
- **Q: How do you measure interest if tools measure principal?** A: Weight static findings by churn (and bug-fix frequency) — smells × change frequency approximates the cost they impose.
- **Q: Why complexity *trend* over absolute?** A: Trend catches actively-decaying files early and proves whether your cleanup is working; level alone doesn't.
- **Q: Coverage as a headline KPI — problem?** A: It measures execution, not assertion; as a target it gets gamed and hides debt behind a green number.
- **Q: One number for leadership — give it?** A: Yes, as a *thermometer* (trend) plus a *map* (hotspots), with loud caveats that it's not a literal backlog and must not become a target.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Equating "lines of code" or "number of smells" with the amount of debt.
- Proposing to refactor the file with the worst complexity score regardless of whether anyone touches it.
- Trusting SonarQube's "N days of debt" as a literal, schedulable number.
- Treating a static snapshot as sufficient — never reaching for the version-control history.
- Offering a single debt number with no caveats about precision, location, or Goodhart.
- Presenting a wall of metrics with no decision attached.
- Dismissing engineers' intuition in favor of the tool (or vice versa) instead of cross-checking.

**Green flags:**
- Naming the *distinction* (principal/interest, snapshot/behavioral, number/decision) before reaching for a tool.
- Reaching for churn × complexity (hotspots) and change coupling for *ground truth* on where debt hurts.
- Saying "a horrible untouched file charges near-zero interest" unprompted.
- Stating each tool's *limit* alongside what it measures (debt ratio is principal-only; coverage is execution-only).
- Distinguishing high-confidence *location* from low-confidence *effort* when presenting estimates.
- Tying debt to lead time, change-failure rate, and opportunity cost — not to complexity numbers.
- Treating every metric as a signal to investigate, never a target to hit, and triangulating several.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **principal vs interest**, **static snapshot vs behavioral signal**, **a number vs a decision**, **measuring the code vs measuring the pain**. Name the distinction first; the tool follows.
- **Finding debt:** triangulate the code (smells), the history (churn, trends, coupling), and the people (what they dread); the debt that matters is the *intersection* of bad and busy. Make it visible with a hotspot map and outcome language.
- **Behavioral analysis beats snapshots:** a static metric is blind to the time dimension. **Hotspots** (churn × complexity), **change coupling**, **complexity trend**, and **bus factor** come from version-control behavior and predict change cost where static rankings don't.
- **Principal vs interest in measurement:** prioritize by *interest* (recurring change cost), which most tools don't measure. A horrible untouched file has near-zero interest. Operationalize interest by **weighting smells by churn**.
- **Tooling:** SonarQube/SQALE estimate *remediation effort* (principal) from arbitrary minute constants — coarse, snapshot, blind to interest; good for trend and PR-gating. CodeScene adds *behavioral* prioritization (interest-like) but isn't a linter. Hotspots are reproducible with `git log` + any complexity tool — the insight isn't proprietary.
- **Traps:** LOC isn't debt; coverage gamed is execution theatre; "N days of debt" is false precision; arbitrary remediation minutes distort even comparisons; Goodhart ruins any single incentivized KPI — use metrics as signals, track several, keep humans interpreting.
- **Communicating:** present *location with high confidence, effort with ranges*; tie to lead time / change-failure / opportunity cost; refuse false-precision totals in favor of scoped, outcome-framed figures; give leadership a *thermometer plus a map*, and make every reported metric earn its place by changing a decision.

---

## Further Reading

- *Your Code as a Crime Scene* and *Software Design X-Rays* — Adam Tornhill. The definitive treatment of behavioral code analysis: hotspots, change coupling, and using version-control history to find and prioritize debt.
- *Managing Technical Debt* (Kruchten, Nord, Ozkaya) — the SEI framework, including principal/interest and measurement.
- The SQALE method and SonarQube documentation — primary sources for how the debt ratio and remediation effort are computed (read them precisely so you know what the number does and doesn't mean).
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — What Is Technical Debt](../01-what-is-technical-debt/interview.md) — the principal/interest model and debt taxonomy these measurement questions build on.
- [04 — Tracking and Prioritizing](../04-tracking-and-prioritizing/interview.md) — turning the hotspots and estimates from this page into a managed, prioritized backlog.
- [Technical Debt Management README](../README.md) — where identifying and quantifying sits in the broader debt-management lifecycle.
- [Quality Engineering README](../../README.md) — where technical-debt measurement sits in the broader quality landscape.

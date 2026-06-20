# Identifying & Quantifying — Senior Level

> **Roadmap:** [Technical Debt Management](../README.md) → [Identifying & Quantifying](../README.md) → Senior
> *The professional page taught you to read a SonarQube dashboard and a churn-vs-complexity scatter plot. This page is about why most of those numbers are wrong, which ones survive contact with Goodhart's law, and how to assemble a debt estimate you would defend to a CFO — by measuring the **interest** the code charges you, not the **principal** locked inside it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Principal vs Interest — The Shift That Changes Everything](#principal-vs-interest--the-shift-that-changes-everything)
4. [Behavioral Code Analysis — Reading the Version Control](#behavioral-code-analysis--reading-the-version-control)
5. [Change Coupling — The Debt Static Tools Cannot See](#change-coupling--the-debt-static-tools-cannot-see)
6. [Complexity Trend — Debt Is a Derivative, Not a Level](#complexity-trend--debt-is-a-derivative-not-a-level)
7. [Knowledge Maps, Bus Factor, and Abandoned Code](#knowledge-maps-bus-factor-and-abandoned-code)
8. [Modeling Total Debt Cost — Σ(interest × future change)](#modeling-total-debt-cost--σinterest--future-change)
9. [The Anti-Metrics — What Not to Measure and Why](#the-anti-metrics--what-not-to-measure-and-why)
10. [Triangulating a Defensible Estimate](#triangulating-a-defensible-estimate)
11. [Presenting Uncertainty Honestly](#presenting-uncertainty-honestly)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Producing a debt measurement rigorous enough to fund a refactor — by weighting every signal by how often the code is actually touched, and being honest about the error bars.**

By the professional level you can run the tools. You can compute cyclomatic complexity, pull a coverage report, and read SonarQube's "technical debt: 412 days" headline. The senior problem is that nearly every one of those numbers is either *measuring the wrong thing* or *measuring a real thing in a way that doesn't compose into a decision*. A 5,000-line file with a complexity of 900 that no one has edited in three years is, economically, paid-off debt — it costs you nothing until you touch it. Meanwhile a 200-line file with mediocre complexity that forty pull requests fought over last quarter is bleeding you daily. Static complexity ranks them backwards.

The senior shift is to stop measuring the **principal** (how bad the code is in the abstract) and start measuring the **interest** (what that badness costs you per unit of work you actually do in it). Interest only accrues on code you keep touching, so the central move of credible debt quantification is to *weight every quality signal by behavioral data from version control* — churn, change frequency, who-touches-what, what-changes-together. This is the core of **behavioral code analysis** (Adam Tornhill's *Your Code as a Crime Scene* / *Software Design X-Rays*, productized as CodeScene), and it is the only family of techniques that produces a debt ranking matching where teams actually feel pain.

This page builds that estimate from the data you already have — your Git history — then teaches you to defend it against the measurement traps that make most debt dashboards worse than useless.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) (churn × complexity hotspots, code smells, the SonarQube/SQALE model) and [professional.md](professional.md) (running these tools in CI at scale).
- **Required:** Comfort with `git log`, `git log --follow`, `git log -S` / `-G` (the pickaxe), and basic shell aggregation (`sort | uniq -c`).
- **Required:** A working grasp of [what technical debt actually is](../01-what-is-technical-debt/senior.md) — principal vs interest as Ward Cunningham meant it, debt vs cruft.
- **Helpful:** You've owned a system long enough to have an intuition about *which* files hurt, so you can sanity-check whether a metric agrees with reality.
- **Helpful:** Basic statistical literacy — distributions, why a mean is the wrong summary for a long-tailed quantity, what a confidence interval claims.

---

## Principal vs Interest — The Shift That Changes Everything

Cunningham's metaphor has two quantities, and almost every failed debt program conflates them.

- **Principal** is the cost to *fix* the debt — to rewrite the tangled module correctly. It's a one-time, sunk-when-paid number. SonarQube's "412 days of technical debt" is a principal estimate: sum of remediation costs for every rule violation.
- **Interest** is what the debt charges you *every time you work near it* — the extra hours a feature takes because the code is hostile, the defects it leaks, the onboarding tax. Interest is a *recurring* cost, and it is paid **only on code you touch**.

The economic punchline is stark: **a horrible file you never edit has enormous principal and ~zero interest.** Fixing it is pure cost with no return — you pay down a loan that wasn't charging you anything. Conversely, a moderately bad file under constant change has modest principal but crushing interest; it's where every refactoring dollar earns the highest yield.

Static-analysis debt scores measure principal almost exclusively. That's why a SonarQube-driven backlog, worked top-down by "worst debt ratio," routinely sends teams to refactor stable, paid-off code while the genuinely expensive files — the ones where principal is small but the change frequency is brutal — sit untouched because their isolated complexity score isn't alarming.

> **Key insight:** Debt only costs you in code you keep touching. The single highest-leverage transformation in debt quantification is to multiply every static smell by the code's change frequency (churn). That product — *smell intensity × churn* — is a proxy for **interest**, and interest is the only number that tells you where refactoring pays. Everything else on this page is a refinement of that one multiplication.

---

## Behavioral Code Analysis — Reading the Version Control

Static analysis sees the code as it is *now*, frozen. Behavioral code analysis sees how the code *behaves over time* — and behavior is where cost lives. The data source is free and already complete: your version-control history. Tornhill's insight is that a VCS log is a record of *where developers spent effort and stumbled*, which is a far better predictor of future pain than any structural metric computed on a single snapshot.

The foundational behavioral metric is the **hotspot**: complicated code that changes often. Complexity alone is harmless if it's stable; churn alone is harmless in simple code. Their *intersection* is where you keep paying.

A first-cut hotspot ranking from raw Git, no tools required:

```bash
# Change frequency per file over the last year (the "churn" axis)
git log --since="1 year ago" --name-only --pretty=format: \
  | grep -E '\.(go|java|ts|py)$' \
  | sort | uniq -c | sort -rn | head -30
```

That gives you the churn axis. For the complexity axis, lines-of-code is a crude-but-effective proxy (it correlates with real complexity well enough for ranking, and it's language-agnostic):

```bash
# Crude complexity proxy: current line count per file
git ls-files '*.go' | xargs wc -l | sort -rn | head -30
```

The hotspot is the *join* of the two: files that rank high on **both** lists. Plotted, you get the classic scatter — churn on one axis, complexity on the other — and the top-right quadrant is your refactoring shortlist. CodeScene automates this and adds a far better complexity signal (it computes indentation-based complexity and language-aware metrics), but the conceptual content is the join above, and you can reproduce 80% of the value in an afternoon of shell.

Why this beats a static scan: in any large codebase, complexity is roughly **power-law distributed across files, and change is concentrated even more sharply** — empirically, a small minority of files (often <5%) absorb the majority of all commits. Tornhill's repeated finding across hundreds of codebases is that hotspots are a tiny fraction of the system yet account for a wildly disproportionate share of defects and developer time. That concentration is what makes behavioral analysis *actionable*: you're not told "the system has 412 days of debt," you're told "these eleven files are where it lives." A budget that fixes eleven files is fundable; a budget that fixes "the system" is not.

> **Key insight:** Version control is an instrument that has been silently recording, for years, exactly where your team has spent effort and gotten hurt. Behavioral analysis just reads that instrument. The hotspot — high churn ∩ high complexity — is the empirically validated unit of "debt that is actually costing you," and it's the *intersection* that matters: either axis alone is a false positive.

---

## Change Coupling — The Debt Static Tools Cannot See

Hotspots find *expensive files*. The most insidious debt, though, isn't in any single file — it's in the **invisible dependencies between files that have no code-level dependency at all**. Two files that are #include-d or import-ed together are coupled in a way the compiler can see. Two files that *change together in commit after commit*, with no syntactic link between them, are coupled in a way that *no static tool can detect* — and that coupling is pure tax: every change to one silently obligates a change to the other, and the day someone forgets, you ship a bug.

This is **change coupling** (also called **temporal coupling** or **logical coupling**): the degree to which files co-occur in commits. It is measured purely from VCS behavior — which is the only place it's visible.

The raw signal is "how often do files A and B appear in the same commit." A direct way to surface it with the **pickaxe** when you suspect a specific concept is smeared across files:

```bash
# Every commit that touched a given symbol/string, across the whole history
git log -S 'computeTaxRate' --oneline --name-only
# -G uses a regex instead of a literal string (use for refactors that renamed things)
git log -G 'tax.*rate' --oneline
```

But for *discovering* coupling rather than confirming it, you compute co-change across all commits. The algorithm: for each commit, take the set of files it touched; for every pair, increment a counter; at the end, the coupling between A and B is `shared_commits / commits_touching_either` (a Jaccard-style degree). A compact pipeline:

```bash
# Emit, per commit, the list of files changed — one commit-block per record
git log --pretty=format:'@%H' --name-only --since="1 year ago" \
  > /tmp/commits.txt
# (then a short awk/Python pass: for each commit block, generate file pairs,
#  tally pair counts and per-file counts, and emit pairs where
#  shared / min(countA, countB) > 0.5 AND shared >= 5)
```

A worked example of what you're hunting for. Suppose the pairing report surfaces:

```
COUPLED FILES (degree = shared commits / commits to either)        shared   degree
  src/checkout/PaymentService.java  ↔  src/checkout/Receipt.java     34      0.81
  src/orders/Order.java             ↔  test/orders/OrderTest.java    52      0.88
  src/pricing/TaxRules.java         ↔  src/ui/CheckoutPage.tsx       19      0.73
```

Now you read them, because **not all coupling is bad** — interpretation is the senior skill:

- `Order.java ↔ OrderTest.java` at 0.88 is **healthy**: code and its test *should* change together. High coupling here is a *good* signal. (A test that *doesn't* co-change with its subject is the smell — it means the test isn't really testing that code.)
- `PaymentService.java ↔ Receipt.java` at 0.81 with no obvious structural link is a **red flag**: two files in the same module that always change together but aren't expressed as one abstraction. Likely a missing interface, a leaked invariant, or a shotgun-surgery pattern. This is real, expensive debt that *no complexity metric and no static analyzer will ever flag*, because each file individually may be clean.
- `TaxRules.java ↔ CheckoutPage.tsx` at 0.73 is the worst kind: coupling **across an architectural boundary** (business logic ↔ UI, backend ↔ frontend). Every tax-rule change forces a UI change. That's a layering violation made visible only through time. It often signals duplicated logic — the tax rules are encoded in *both* places.

> **Key insight:** Change coupling is the highest-value debt signal that static analysis structurally cannot produce, because the dependency exists *in the edit history, not in the code text*. A high co-change degree between files with no syntactic link is the fingerprint of a missing abstraction or a leaked invariant — and coupling *across a module or layer boundary* is among the most expensive debt a system can carry, precisely because it's invisible until you measure time.

---

## Complexity Trend — Debt Is a Derivative, Not a Level

A single complexity number is a photograph; debt is a *movie*. The question that actually predicts pain isn't "how complex is this file?" but "**is this file getting worse, and how fast?**" A complex file that's been flat for two years is a known, stable cost. A file whose complexity has climbed 40% in six months is an active hemorrhage — it's accumulating debt *right now*, and the trend tells you it will keep doing so unless you intervene.

You reconstruct the trend by computing a complexity proxy at each point in history. Walk the log, check out (or `git show`) each revision of the file, and measure:

```bash
# Complexity-trend proxy for one file: LOC at each commit that touched it
for rev in $(git log --pretty=format:%h --follow -- src/pricing/TaxRules.java); do
  loc=$(git show "$rev:src/pricing/TaxRules.java" 2>/dev/null | wc -l)
  date=$(git show -s --format=%ci "$rev" | cut -d' ' -f1)
  printf '%s %s\n' "$date" "$loc"
done | tac    # oldest → newest
```

A better proxy than raw LOC is **indentation-based complexity** (sum or max of leading-whitespace depth per line) — it tracks nesting, which correlates with cyclomatic complexity, is trivially language-agnostic, and is exactly what CodeScene uses for cheap trend lines. Swap the `wc -l` for an awk pass that sums indentation depth and you have a far better signal at the same cost.

Plotted, a complexity trend reads like a stock chart:

```
indentation
complexity
  900 |                                          ╭─────  ← runaway: refactor NOW
      |                                    ╭─────╯
  600 |                          ╭────╮___╭╯
      |                ╭────────╯    ╰─               ← someone tried, gave up
  300 |      ╭────────╯
      |______╯                                        ← born simple
        Jan      Apr      Jul      Oct      Jan
```

The shapes are diagnostic. A **steady upward ramp** is unmanaged accumulation — features bolted on without restructuring. A **sawtooth** (rises, drops, rises) shows refactoring *happening* — someone is fighting the entropy, and the drops are paydowns; if the drops are getting smaller, they're losing. A **step up that never comes down** is the signature of "we added a special case and never generalized." A trend that's flat at a high level is, again, *paid-off* debt — costly to fix, cheap to leave.

The senior move is to rank not by current complexity but by **complexity trend slope weighted by churn**: a steeply rising, frequently changed file is where the next quarter's pain is being manufactured. Catching it on the upslope is dramatically cheaper than waiting until it's a 900-complexity hotspot everyone's afraid to touch.

> **Key insight:** Treat complexity as a derivative, not a level. The integral (today's complexity) tells you where you are; the slope (the trend) tells you where you're going and how fast — and the slope is what's still cheap to change. A file accelerating upward is accruing debt faster than you can possibly pay it later; a flat-but-high file is a sunk cost you can often just live with.

---

## Knowledge Maps, Bus Factor, and Abandoned Code

Code debt is only half the picture. The other half is **organizational**: who understands the code, and what happens when they leave. This is *social* technical debt, and it's invisible to every code-level metric — yet it routinely dominates the real risk in a system.

The same VCS history that yields hotspots also yields a **knowledge map**: attribute each file (or each *line*, via `git blame`) to its primary author by contribution share, and you can see how knowledge is distributed.

```bash
# Primary author by line count for a file — crude "who owns this knowledge"
git blame --line-porcelain src/pricing/TaxRules.java \
  | grep '^author ' | sort | uniq -c | sort -rn

# Contribution share across a directory, by commits
git log --since="2 years ago" --pretty=format:'%an' -- src/pricing/ \
  | sort | uniq -c | sort -rn
```

Three derived risks fall out of this:

- **Bus factor (truck factor):** the minimum number of people who, if they vanished, would orphan a critical part of the system. A hotspot whose knowledge is concentrated in **one** person is a *compounding* risk — it's both expensive to change *and* understood by a single human. CodeScene's marquee chart is exactly this: hotspots colored by number of authors, so a high-churn, high-complexity, single-author file lights up as the top organizational risk. That intersection — *expensive code + sole owner* — is where you should be most nervous, because the day that person leaves, the interest rate on that file spikes.

- **Abandoned / orphaned code:** code whose original authors have **all left the company**. This is debt with a special property — *the knowledge principal is permanently lost*. You can't ask anyone why it's the way it is. Surface it by intersecting `git blame` authorship with your current-employee roster: files where 100% of the contributing authors are ex-employees are knowledge-orphaned, and any change to them carries archaeology cost. A hotspot that is *also* abandoned is a genuine emergency.

- **Coordination cost (Conway / Brooks):** a file touched by many people across many teams carries communication overhead — every change risks colliding with someone else's mental model. High author-count on a single file isn't automatically bad (it can mean healthy shared ownership), but high author-count *across team boundaries* on a complex file is a coordination tax and often a sign the module should be split along team lines.

The senior synthesis is a **2×2 risk model overlaying code and people:**

|                      | **Low churn**                | **High churn**                                |
|----------------------|------------------------------|-----------------------------------------------|
| **Many authors**     | Stable shared code (fine)    | Coordination bottleneck (split / clarify ownership) |
| **One / no author**  | Dormant (leave it)           | **Critical risk** (high interest + bus-factor 1) |

The bottom-right cell — high churn, single (or departed) author, usually also high complexity — is the most dangerous quadrant in the whole exercise. It is simultaneously the most expensive code *and* the most fragile knowledge.

> **Key insight:** The riskiest debt is the *product* of code cost and knowledge concentration, not either alone. A horrible file ten people understand is a manageable problem; a moderately bad file *one departing person* understands is a time bomb. Knowledge maps and bus factor are how you find the second kind — and they come from the exact same `git log` you already mined for hotspots.

---

## Modeling Total Debt Cost — Σ(interest × future change)

Now assemble the pieces into a number you can put in a slide. The goal is not a precise figure (it can't be — see the next sections); it's a *defensible model* whose assumptions are explicit and whose ranking is trustworthy.

Start from the definition of interest. For a given file, the interest you pay is *the extra cost imposed on each change because the code is hard to work with*. So the total cost a debt-laden file will charge you over its remaining life is:

```
debt_cost(file) ≈ interest_per_change(file) × expected_future_changes(file)
```

and total system debt cost is the sum over the code you'll keep:

```
total_debt_cost ≈ Σ_file [ interest_per_change(file) × expected_future_changes(file) ]
                  over the remaining lifetime of the code
```

Each factor is estimable from data you now have:

- **`interest_per_change`** — the friction multiplier. Proxy it from complexity and coupling: a high-complexity, highly-coupled file makes each change cost more. A practical, defensible proxy is *the historical extra lead time*: compare the time-in-progress of changes to hotspots versus changes to clean files (you have this in your issue tracker / PR data — see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)). If touching hotspots historically takes 2.3× longer per PR than touching clean code, that 1.3× *excess* is your measured interest rate, grounded in observation rather than a tool's guess.

- **`expected_future_changes`** — extrapolate from history. A file's past change frequency is the single best predictor of its future change frequency (change is strongly autocorrelated — last quarter's hotspots are, overwhelmingly, next quarter's hotspots). Use a recent-weighted rate so a file that *just* went hot counts more than one cooling off.

- **`remaining lifetime`** — the term of the loan. Code slated for deletion next quarter has a short term: even high interest barely accrues. Code that's load-bearing for years has a long term and compounds. This factor is what formalizes "don't fix debt you're about to delete," and it's the bridge to [tracking & prioritizing](../04-tracking-and-prioritizing/senior.md), where this estimate becomes a backlog ranking.

A worked **weighted-hotspot model** that operationalizes this without pretending to false precision — rank files by a composite score:

```
score(file) =  churn(file)            # change frequency, recent-weighted  → "interest accrues here"
             × complexity(file)       # indentation/cyclomatic proxy        → "each change costs more"
             × coupling_penalty(file) # 1 + (cross-boundary co-change deg)   → "changes spread"
             × knowledge_risk(file)   # 1 + (1 / distinct_recent_authors)    → "and one person knows it"
```

This is deliberately a *ranking* model, not a dollar model. Each factor is a defensible proxy for one driver of interest; their product surfaces the files where all the drivers stack. The output is an ordered list — "fix these, in this order" — which is exactly what funds a refactoring sprint. If a stakeholder demands dollars, convert the top of the list using the *measured* lead-time excess: `top-N files × excess hours per change × changes per year × loaded engineer cost` gives a money figure with a clear, attackable derivation — which is what you want, because a number nobody can interrogate is a number nobody will trust.

> **Key insight:** Total debt cost is `Σ (interest_per_change × expected_future_changes)` over the code's remaining life — a *flow* of cost over time, not a static pile. This is why the right ranking is a product of churn, complexity, coupling, and knowledge risk: each term captures one multiplier on the interest, and the files where they *compound* are where the money is. Estimate the rate from your own historical lead-time data, not from a tool's hardcoded constants.

---

## The Anti-Metrics — What Not to Measure and Why

Half of senior-level measurement is knowing which numbers to *refuse to report*. Each of the following is routinely presented as a debt metric and each is misleading in a specific, important way.

**Lines of code is not debt.** LOC measures *size*, and size is at best a weak complexity proxy and at worst an active distortion. A 2,000-line file of flat, repetitive, obvious mappings is trivial to work in; a 200-line file of dense, clever, deeply-nested control flow is a nightmare. Worse, "reduce LOC" as a goal incentivizes the *opposite* of clarity — golfing code into unreadable density, or hiding complexity behind layers of tiny indirections so each file is small while the system gets harder to follow. Use LOC only as a cheap *ranking* proxy in a hotspot join, never as a target.

**Coverage % is gameable and doesn't measure debt at all.** Line coverage tells you which lines *executed* during the test run — not whether anything was *asserted*, not whether the *meaningful* paths were exercised. A test suite that calls every method and asserts nothing can hit 90% coverage while testing nothing. Coverage measures the absence of *one kind* of debt (untested code) extremely imperfectly, and the moment it becomes a target, teams write assertion-free tests, test trivial getters, and chase the number instead of the risk. It is a *diagnostic* (low coverage on a hotspot is a real flag) but never a *score*.

**SonarQube's remediation minutes are arbitrary and not comparable across orgs.** SonarQube/SQALE produce "technical debt" in time units by assigning each rule violation a fixed remediation cost — "this code smell takes 20 minutes to fix," "that one takes 1 day" — and summing. Those constants are *configured defaults*, not measurements of your codebase. The sum is dominated by violation *count*, so it scales with codebase size more than with actual pain, and it measures **principal, not interest** — it has no idea which violations sit in code you touch. Two orgs' "120 days of debt" are not comparable (different rule sets, different thresholds), and even *one* org's number is meaningless as a level — only its *trend on hotspots* carries signal. Treat the absolute figure as theater; treat "debt ratio rising on our top-10 hotspots" as real.

**And the meta-trap: Goodhart's law applies to every debt metric.** *"When a measure becomes a target, it ceases to be a good measure."* The instant you tie incentives, OKRs, or status to *any* of these numbers — coverage, debt ratio, complexity average, number of SonarQube issues — the organization optimizes the *number*, and the number decouples from the reality it was meant to track. Coverage targets produce assertion-free tests. Complexity-average targets produce files split arbitrarily to dilute the mean. "Zero SonarQube issues" produces blanket `// NOSONAR` suppressions. This isn't a reason to abandon metrics; it's a reason to (1) use metrics for *steering and discovery*, not for *judging people*, (2) prefer metrics that are hard to game without actually improving the code (a *falling complexity trend on a hotspot* is hard to fake), and (3) always triangulate, so no single gameable number drives a decision.

> **Key insight:** Every debt metric is a proxy, and every proxy obeys Goodhart's law: make it a target and it rots. LOC measures size not difficulty; coverage measures execution not verification; SonarQube minutes measure principal not interest and aren't comparable across orgs. The defensible posture is to use these as *discovery signals*, never as *scores attached to incentives*, and to favor signals (like a complexity trend you can only improve by genuinely refactoring) that resist gaming by construction.

---

## Triangulating a Defensible Estimate

No single source is trustworthy, so a credible estimate **triangulates** across independent signals that fail in *different* directions. When tool output, behavioral data, human judgment, and production reality all point at the same files, you have a finding you can fund. Where they *disagree*, you've found something interesting — and the disagreement is itself the most valuable output.

The four independent sources, and what each contributes:

1. **Tool signals (static).** SonarQube/linters/complexity scanners. *Strength:* cheap, exhaustive, objective, repeatable. *Blind spot:* measures principal not interest, can't see coupling, no idea what hurts. Use it to *enumerate* candidate problems.

2. **Behavioral data (VCS).** Hotspots, change coupling, complexity trend, knowledge maps — everything earlier on this page. *Strength:* measures real effort and real co-change, surfaces interest. *Blind spot:* history can't predict a brand-new subsystem; a file refactored last week still shows old churn. Use it to *weight* the candidates by actual cost.

3. **Team survey (human judgment).** Ask the engineers: *"Which parts of this system do you dread changing? Where do estimates blow up? What are you afraid to touch?"* A simple structured survey or a "pain map" workshop. *Strength:* captures debt the tools and history both miss — bad abstractions that are *stable* (so low churn) but make every *new* feature hard, missing tests people route around, tribal knowledge. *Blind spot:* subjective, recency-biased, and people complain loudest about what they touched last. Use it to *catch what the data can't see* and to validate the data's ranking.

4. **Incident / defect data (production).** Where do bugs cluster? Which modules generate the most incidents, rollbacks, and pages? Map post-mortems and bug tickets back to files. *Strength:* this is debt *that already cost you real money in production* — the least deniable signal of all. *Blind spot:* lagging (tells you where you were hurt, not where you're about to be), and well-tested risky code may show few incidents. Use it to *ground the estimate in realized cost*.

The method is to overlay all four and look at the **convergence and the conflicts:**

- **Convergence — fund it.** A file that is a top hotspot (behavioral), high-complexity (tool), named by three engineers as "the scary one" (survey), *and* the source of two of last quarter's incidents (production) is your number-one refactoring target with *four independent justifications*. No reasonable stakeholder argues with that.
- **Conflict is signal, not noise.** The interesting cases are disagreements, and each pattern means something specific:
  - *High tool-debt, low churn, no survey complaints, no incidents* → **paid-off debt.** Ugly but dormant. The classic SonarQube false alarm. **Leave it.**
  - *Low tool-debt, high churn, loud survey complaints* → a **bad abstraction the linter can't see.** The code is "clean" by structural rules but wrong for the problem. Often the *highest-value, most-overlooked* debt.
  - *High survey dread, but low everything-else* → either fear of unfamiliar (not real debt — an onboarding/docs problem) *or* a latent risk the data hasn't caught yet. Investigate before acting.
  - *High incidents, low everything-else* → the debt may be operational (config, deployment, observability) rather than in this code's structure — look [next door at engineering-metrics and reliability](../../engineering-metrics-and-dora/).

> **Key insight:** Trust convergence, investigate conflict. Four signals that fail in different directions — static tools, VCS behavior, human dread, production incidents — turn an arguable opinion into a defensible estimate when they agree, and turn into your most valuable discoveries when they don't. A finding backed by all four is unfundable to refuse; a finding backed by only one is a hypothesis, not a conclusion.

---

## Presenting Uncertainty Honestly

The final senior skill is *epistemic honesty in the report itself*. A debt estimate is a forecast built on proxies, and presenting it as a precise truth ("we have 412.0 days of technical debt") destroys credibility the first time someone interrogates it — and someone always does. Paradoxically, **showing your error bars makes the estimate more persuasive, not less**, because it signals you understand the model's limits and aren't selling a number you can't defend.

Concrete practices:

- **Give ranges, not point estimates.** "Refactoring the checkout hotspots will likely save 15–30% of the team's effort on checkout features, based on the measured 2.3× lead-time penalty" beats a false-precision "saves 22.4%." The range *is* the honesty.
- **State the assumptions inline and make them attackable.** "*This assumes the file keeps changing at last year's rate and that lead-time excess is caused by the code, not by requirements churn.*" Naming the assumption lets a skeptic engage the *model* instead of dismissing the *number* — and if they have better data for an assumption, you get a better estimate.
- **Show the derivation, not just the conclusion.** A number whose lineage is visible (`top-10 hotspots × measured 1.3× excess hours × ~40 changes/yr × loaded cost`) invites scrutiny *and survives it*. A number that drops from a tool with no shown working is rejected the moment it's inconvenient.
- **Separate confidence by signal strength.** Be explicit: "High confidence these eleven files are our hotspots (four independent signals agree). Medium confidence on the dollar figure (depends on the lead-time-causality assumption). Low confidence on total system debt (we only have good data on the top decile)." Calibrated confidence is more trustworthy than uniform certainty.
- **Lead with the *ranking*, treat the dollar figure as secondary.** The robust, defensible output of all this work is *which code to fix, in what order*. The money figure is a derived, assumption-laden translation for funding conversations. Anchor on the ranking (which is solid) and present the dollars as "here's one way to value the top of that list" (which is contestable, and you should say so).

> **Key insight:** Honesty about uncertainty is a credibility *multiplier*, not a weakness. The trustworthy debt report leads with a robust ranking, gives ranges over point estimates, names its assumptions so they can be challenged, and grades its own confidence by signal. False precision is the fastest way to get a debt program defunded — the first time the magic number can't withstand a single hard question, every number you ever produce is suspect.

---

## Mental Models

- **Principal is the photo; interest is the meter.** Principal (cost to fix) is what static tools measure and it's mostly irrelevant; interest (cost per change on code you keep touching) is what you actually pay and what should drive every decision. Multiply every smell by churn to convert principal-flavored metrics into interest.

- **Version control is an effort sensor that's been recording for years.** Hotspots, coupling, trends, and knowledge maps are all just *reading the instrument you already have*. Where developers spent effort and stumbled is a better debt predictor than any structural snapshot.

- **Debt is a derivative.** The level (today's complexity) tells you where you are; the slope (the trend) tells you where you're going and is what's still cheap to change. Rank by trajectory, not just position.

- **The dangerous debt is a product, not a sum.** Cost = code-difficulty × change-frequency × knowledge-concentration × remaining-lifetime. Files where these *compound* are the emergencies; any single high factor with low others is usually fine to leave.

- **Every metric is a proxy and every proxy obeys Goodhart.** Make any debt number a target and it decouples from reality. Use metrics to *steer and discover*, never to *judge people*, and prefer signals that can only be improved by actually improving the code.

- **Triangulate; trust convergence, investigate conflict.** Four signals that fail in different directions (tools, VCS, survey, incidents) make a fundable case when they agree and your best discoveries when they don't.

---

## Common Mistakes

1. **Ranking debt by static severity, ignoring churn.** Sends teams to refactor stable, paid-off code (high principal, zero interest) while genuinely expensive low-complexity-but-high-churn files bleed untouched. Always weight by change frequency — interest, not principal, is what you pay.

2. **Reporting SonarQube's "N days of debt" as a real, comparable figure.** It's a sum of configured remediation constants dominated by codebase size; it measures principal, isn't comparable across orgs, and is meaningless as an absolute level. Only its *trend on hotspots* carries signal.

3. **Treating change coupling between a file and its test as a problem.** Code and its test *should* co-change — that coupling is healthy. The smell is a test that *doesn't* co-change with its subject. Interpret coupling; don't just rank it.

4. **Missing cross-boundary coupling because each file looks clean.** The most expensive debt is often the invisible co-change dependency between structurally unrelated files across a layer boundary — undetectable by any static tool, visible only in commit history.

5. **Setting a coverage (or complexity, or issue-count) target and tying it to incentives.** Goodhart guarantees the team games the number — assertion-free tests, arbitrary file splits, blanket suppressions — while real quality flatlines or drops. Use these as diagnostics, never as scored targets.

6. **Presenting a single precise number with no error bars or assumptions.** False precision collapses the moment someone interrogates it, and takes your whole debt program's credibility with it. Give ranges, show derivations, grade your confidence.

7. **Ignoring the people axis entirely.** A moderately bad file understood by one departing engineer is a bigger risk than a horrible file ten people know. Bus factor and abandoned-code analysis come from the same `git log` — skipping them leaves your highest organizational risk unmeasured.

8. **Quantifying debt in code you're about to delete or never touch.** Remaining lifetime is a factor in the cost model for a reason: even severe debt in soon-to-be-deleted or never-edited code has near-zero present cost. Don't pay down loans that aren't charging interest.

---

## Test Yourself

1. Two files: File A is 4,000 lines, cyclomatic complexity 800, last edited 2 years ago. File B is 250 lines, complexity 60, edited in 45 PRs last quarter. SonarQube ranks A as far worse debt. Which is actually costing you more, and what's the principle?
2. You suspect a piece of business logic is duplicated across the backend and the frontend, but there's no shared code linking them. What VCS technique reveals this, and what would the signal look like?
3. A file's `OrderTest.java` co-changes with `Order.java` at degree 0.9. Your tool flags this as "high temporal coupling." Is this a problem? What *would* be the problem?
4. Explain why "reduce average cyclomatic complexity to under 10" as a team OKR will likely fail to reduce real debt. Name the law and the specific gaming behavior.
5. Write the cost model for total debt in one line, define each factor, and explain what the "remaining lifetime" factor formalizes about prioritization.
6. A file is a top behavioral hotspot but no engineer complains about it and it's caused zero incidents. What does this conflict most likely mean, and what should you do?
7. Your director wants "the technical debt number" for a board slide. What do you give them, and how do you present the uncertainty without undermining the case?

<details>
<summary>Answers</summary>

1. **File B.** Debt costs you *interest* — extra effort per change — and interest is paid only on code you touch. File A has huge *principal* (expensive to fix) but ~zero interest because nobody edits it; it's paid-off debt, cheapest to leave. File B's constant churn means its (lesser) complexity is charged against you 45 times a quarter. The principle: weight every static signal by churn; rank by interest, not principal.

2. **Change coupling / temporal coupling analysis** — compute co-change degree across all commits (or use `git log -S 'theConcept'` / `-G` to confirm a specific symbol's spread). The signal: a high co-change degree (e.g. 0.7+) between two structurally unrelated files *across the backend/frontend boundary*, meaning every change to the logic forces a coordinated change in both — the fingerprint of duplicated logic, invisible to any static tool because there's no code-level link.

3. **No — it's healthy.** Code and its tests *should* change together; high coupling there is a *good* signal. The actual problem would be the *opposite*: a test that does **not** co-change with its subject, which means the test isn't really exercising that code. Coupling must be *interpreted* (boundary-crossing coupling between unrelated production files is the red flag), not blindly ranked.

4. **Goodhart's law** — when a measure becomes a target it ceases to be a good measure. The gaming behavior: teams hit the average by *splitting complex files arbitrarily* (diluting the mean without simplifying anything) or extracting trivial one-line methods, so the *number* improves while the system gets *harder* to follow. The average is also the wrong summary for a long-tailed quantity — a few monstrous files are the debt, and an average hides them.

5. `total_debt_cost ≈ Σ_file [ interest_per_change(file) × expected_future_changes(file) ]` over the code's remaining lifetime. `interest_per_change` = the friction/extra-effort multiplier (proxy: measured lead-time excess on hotspots vs clean code); `expected_future_changes` = extrapolated change frequency (history is autocorrelated). **Remaining lifetime** formalizes "don't fix debt you're about to delete" — it's the loan term; even high interest on short-lived code barely accrues, so soon-to-be-deleted code is deprioritized regardless of how bad it is.

6. Most likely **a bad abstraction or latent risk the tools can't see, OR fear/unfamiliarity rather than real debt** — but given it's a genuine *behavioral* hotspot (high churn ∩ complexity) with no complaints and no incidents, the strongest read is that it's expensive to change but the team has quietly absorbed the cost, or it's well-tested enough to avoid incidents while still being slow to work in. Investigate: ask the people who touch it *why* it's not painful (maybe it's fine), and check the lead-time data — if changes to it are slow, it's real interest being paid silently. Conflict is signal: don't auto-fund and don't auto-dismiss.

7. Give them the **ranking first** — "here are the 11 files where our debt actually lives, with four independent signals agreeing" — because that's the robust output. Then present the dollar figure as a *range* with a *visible derivation* ("top hotspots × measured 1.3× excess hours × ~40 changes/yr × loaded cost ≈ \$X–Y/yr") and *graded confidence* ("high confidence on the ranking, medium on the dollars, which assume the slowness is caused by the code"). Showing the error bars and assumptions makes it *more* credible, not less; a single precise magic number collapses under the first hard question and discredits everything after it.

</details>

---

## Cheat Sheet

```
THE CORE SHIFT
  principal = cost to FIX the debt        (what SonarQube measures; mostly irrelevant)
  interest  = cost per CHANGE on code     (what you actually pay; ONLY on code you touch)
  RULE: weight every smell by churn → interest. Rank by interest, not principal.

BEHAVIORAL ANALYSIS FROM RAW GIT
  # churn axis (change frequency, last year)
  git log --since="1 year ago" --name-only --pretty=format: \
    | grep -E '\.(go|java|ts)$' | sort | uniq -c | sort -rn | head
  # complexity proxy (LOC, or better: indentation depth)
  git ls-files '*.go' | xargs wc -l | sort -rn | head
  HOTSPOT = high churn ∩ high complexity (the INTERSECTION — either alone is a false +)

CHANGE / TEMPORAL COUPLING  (what static tools CANNOT see)
  git log -S 'symbol' --oneline --name-only   # pickaxe: where a concept is smeared
  git log -G 'reg.*ex' --oneline              # regex pickaxe (renames/refactors)
  degree(A,B) = shared_commits / commits_to_either
  test↔code coupling = HEALTHY;  cross-boundary coupling of unrelated files = WORST debt

COMPLEXITY TREND  (debt is a DERIVATIVE, not a level)
  walk history, measure complexity proxy per revision → plot slope
  rising ramp = unmanaged growth | sawtooth = active refactoring | flat-high = paid off
  rank by SLOPE × churn — catch it on the upslope, when it's still cheap

KNOWLEDGE / PEOPLE
  git blame --line-porcelain F | grep '^author ' | sort | uniq -c   # who owns it
  bus factor = min people who'd orphan critical code; hotspot + 1 author = time bomb
  abandoned code = all authors left → knowledge principal permanently LOST

COST MODEL
  total ≈ Σ [ interest_per_change × expected_future_changes ] over remaining lifetime
  weighted score = churn × complexity × coupling_penalty × knowledge_risk
  estimate the RATE from your own lead-time data, not a tool's constants

ANTI-METRICS (use as diagnostics, NEVER as scored targets — Goodhart)
  LOC ≠ debt (size ≠ difficulty; target it → unreadable density)
  coverage % = execution not verification (target it → assertion-free tests)
  SonarQube minutes = principal, arbitrary constants, NOT comparable across orgs
  any metric as a target → it decouples from reality. Steer, don't judge.

TRIANGULATE (signals that fail in different directions)
  tools (static) + VCS behavior + team survey + incidents/defects
  convergence → fund it (4 justifications) | conflict → your best discovery

PRESENT
  ranking first (robust) → dollars second (assumption-laden, give a RANGE)
  show derivation, name assumptions, grade confidence per signal. No magic numbers.
```

---

## Summary

- The senior shift is from measuring **principal** (how bad the code is — what static tools report) to measuring **interest** (what it costs per change). Interest accrues only on code you keep touching, so the central move is to **weight every quality signal by churn**. A horrible file nobody edits has ~zero interest and is the wrong thing to fix.
- **Behavioral code analysis** reads your version control as an effort sensor. The **hotspot** — high churn ∩ high complexity — is the empirically validated unit of debt-that-actually-costs-you, and you can reproduce most of CodeScene's value with raw `git log`.
- **Change (temporal) coupling** is the highest-value signal static analysis *structurally cannot produce* — co-change between files with no syntactic link reveals missing abstractions and, when it crosses a layer boundary, the most expensive debt a system carries. Interpret it: test↔code coupling is healthy.
- Treat complexity as a **derivative** — the *trend's slope*, weighted by churn, predicts next quarter's pain and is still cheap to change, unlike a flat-but-high paid-off file.
- The riskiest debt is a **product** of code cost and **knowledge concentration**: bus-factor-1 and abandoned (all-authors-departed) code turn moderate debt into emergencies, and the data comes from the same history.
- Model total cost as **`Σ(interest_per_change × expected_future_changes)` over remaining lifetime**; rank with a weighted score (churn × complexity × coupling × knowledge risk) and estimate the rate from your own lead-time data.
- Refuse the **anti-metrics**: LOC isn't difficulty, coverage isn't verification, SonarQube minutes are arbitrary and incomparable — and **Goodhart's law** rots any of them the instant it becomes a target.
- **Triangulate** across tools, VCS behavior, team survey, and incidents; trust convergence, investigate conflict. **Present uncertainty honestly** — ranking first, dollars as a range with visible derivation and graded confidence — because false precision is the fastest way to get a debt program defunded.

You can now produce a debt estimate that survives interrogation: grounded in behavioral data, honest about its proxies, and ranked so it funds a refactor. The next step is turning that ranking into action — see [tracking & prioritizing](../04-tracking-and-prioritizing/senior.md).

---

## Further Reading

- *Your Code as a Crime Scene* and *Software Design X-Rays* — Adam Tornhill. The foundational texts on behavioral code analysis: hotspots, change coupling, complexity trends, and knowledge maps from version-control data. The intellectual core of this page.
- *Managing Technical Debt* — Kruchten, Nord & Ozkaya (SEI). The rigorous, research-grounded treatment of debt as a measurable, manageable quantity.
- Ward Cunningham's 2009 "Debt Metaphor" video — the original author clarifying that interest, not principal, is the point.
- *Refactoring* (2nd ed.) — Martin Fowler. The catalog of smells you'll be ranking by churn; the *how* to this page's *which and why*.
- The CodeScene documentation and Tornhill's papers on the *correlation between hotspots and defects/effort* — the empirical validation that the hotspot concentration is real.
- *Accelerate* — Forsgren, Humble & Kim — for lead-time and delivery metrics you'll use to *measure the interest rate* from your own data (see the DORA topic below).

---

## Related Topics

- [What Is Technical Debt](../01-what-is-technical-debt/senior.md) — principal vs interest as Cunningham meant it; the definitions this page operationalizes into measurement.
- [Tracking & Prioritizing](../04-tracking-and-prioritizing/senior.md) — turning the ranking and cost model here into a debt register, a backlog, and a cost-of-delay / WSJF ordering.
- [Refactoring](../../../code-craft/refactoring/) — the *how* of paying down the debt this page tells you to find and rank; smells, mechanics, and large-scale restructuring.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — lead time, change frequency, and defect data: where you measure the *interest rate* and ground the dollar figure in observed delivery cost.

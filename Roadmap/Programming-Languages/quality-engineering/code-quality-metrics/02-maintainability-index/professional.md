# Maintainability Index — Professional Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Maintainability Index
> *The senior page taught you what the composite measures and why it's weak. This page is about what happens when an exec or a tool vendor puts a single "maintainability score" on a dashboard and asks why it isn't green — where MI stops being a formula and becomes a political object you have to manage without either lying about it or letting it drive the wrong work.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Managing the MI Expectation](#managing-the-mi-expectation)
4. [The Cross-Tool, Cross-Language Comparability Trap](#the-cross-tool-cross-language-comparability-trap)
5. [Using MI Correctly, If at All](#using-mi-correctly-if-at-all)
6. [Goodhart and the Gaming Problem](#goodhart-and-the-gaming-problem)
7. [Deprecating MI in Favor of Actionable Signals](#deprecating-mi-in-favor-of-actionable-signals)
8. [The Conversation That Moves the Org](#the-conversation-that-moves-the-org)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Handling MI as an organizational signal — reframing the single-score expectation, refusing the cross-team grade, and steering the org toward signals that actually drive work.**

The senior page framed the Maintainability Index as a composite of Halstead Volume, cyclomatic complexity, and lines of code — a number that is *internally* defensible as a same-codebase trend and *externally* indefensible as a grade. At the professional level you rarely get to have that nuanced conversation on your own terms. Instead, MI arrives pre-weaponized: a tool vendor's slide deck shows your team at "62 — Moderate" next to a competitor at "78 — Good"; a VP pastes a SonarQube screenshot into a planning doc and asks the org to "get maintainability to green by Q3"; a newly-hired director wants to rank the five backend teams by their maintainability score and fund the bottom two.

None of these requests are *technically* answerable, because the number underneath them doesn't mean what the asker thinks it means. The skill here is not computing MI — you already can. It's the judgment to reframe a single composite score into something honest and useful, to refuse a comparison that is statistically meaningless without sounding like you're dodging accountability, and to redirect the org's energy from "raise our maintainability score" to "reduce defects in our worst files." This is the page about MI as a *management problem*, not a measurement one.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the MI formula, the `171` constant, the Halstead/cyclomatic/LOC inputs, Visual Studio's 0–100 rescale, and why the composite is weak.
- **Required:** You've sat in a meeting where a metric was used to compare teams or set a target, and watched it go sideways.
- **Helpful:** You own or influence a quality dashboard, a definition-of-done, or an OKR that touches code quality.
- **Helpful:** You've read enough of [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md) to know what an *actionable* signal looks like, so you have something to offer instead of MI.

---

## Managing the MI Expectation

The request almost always arrives in one of two forms, and both are reasonable on their face.

The first is from leadership: *"Our maintainability score is 62. I want it at 80 by end of year."* The second is from a tool vendor or a platform team that bought the tool: *"The dashboard gives every repo a maintainability letter grade — let's hold teams to at least a B."* In both, someone has discovered that a single number purports to summarize "how good is this code," and a single number is exactly what a roadmap, a board slide, or an OKR wants.

The wrong responses are both common. One is to **comply literally** — accept "MI ≥ 80" as a target and let your team chase it. The other is to **reject it as garbage** — "that number is meaningless, ignore it" — which reads as defensiveness and loses you the room. The professional move is the third one: **reframe what the number can honestly do, then offer the thing the asker actually wants.**

What MI can honestly do is exactly one job: serve as a **same-tool, same-codebase trend line**. If you compute MI with one tool, on one repository, with one configuration, and watch it over time, a sustained downward slope is weak-but-real evidence that the code is getting harder to work with — denser, more branchy, more sprawling per file. That is the *entire* defensible use. The reframing script is short and worth having memorized:

> "That score is useful as a trend on *this* codebase with *this* tool — if it's sliding down quarter over quarter, that's a signal worth investigating. It is not a grade, and the absolute value of 62 doesn't mean anything on its own — a different tool would print a different number for the identical code. So rather than target '80,' let's watch whether it's trending the wrong way, and pair it with signals that tell us *where* to act."

Notice what that does. It grants the underlying concern — *is our code getting worse?* — which is legitimate. It declines the two illegitimate uses (absolute target, grade) with a concrete reason (a different tool prints a different number), not a hand-wave. And it pivots immediately to "here's what we'll watch instead," so the conversation ends with a plan rather than a refusal.

The reason the *absolute number* must be refused is structural, not stylistic. MI is a rescaling of a Halstead-plus-cyclomatic-plus-LOC blend with an arbitrary constant (`171` in the original, clamped to 0–100 in Visual Studio's variant). The constant was fit to a particular corpus decades ago; it carries no units and no calibrated meaning. "62" is not 62 *of* anything. It is only comparable to *another 62 produced by the identical pipeline on the same code at a different time.* Strip that context and the number is noise wearing a uniform.

---

## The Cross-Tool, Cross-Language Comparability Trap

This is the single most damaging way MI gets misused at organizational scale, and it deserves its own treatment because the failure is silent — everything *looks* comparable.

Here is the trap in one table. Three teams, three tools, the "same" metric:

| Team | Tool | What it computes |
|---|---|---|
| Team A (Python) | `radon` | Original Microsoft formula: `171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)`, then rescaled to 0–100 |
| Team B (Java/TS) | SonarQube | A SQALE-derived maintainability *rating* (A–E) from a remediation-effort ratio — **not the Halstead formula at all** |
| Team C (C#) | Visual Studio | Microsoft's clamped variant of the formula, with its own coefficient and a comment-weighting term in some versions |

A director sees "Team A: 71, Team B: A, Team C: 68" and concludes Team A and C are roughly tied and Team B is best. **Every part of that conclusion is unfounded.** SonarQube's "maintainability rating" isn't the MI formula — it's a debt-ratio model that maps remediation cost against the cost of rewriting from scratch; its A is not on the same axis as radon's 71. Visual Studio's 68 and radon's 71 *share a lineage* but differ in coefficients, in whether comments are weighted, in how LOC is counted (physical vs logical vs source), and in how each tool computes Halstead operators and operands — a difference that alone can swing the result by tens of points on identical code.

Then layer language on top. Halstead Volume depends on counting distinct operators and operands; what counts as an "operator" in Python (where a list comprehension is terse) versus Java (where the same logic is verbose with explicit types) versus C# differs enough that **the same algorithm, expressed idiomatically in two languages, yields different MI** with the *same* tool. LOC compounds it: Go's error-handling idiom inflates line counts that a more terse language wouldn't have, dragging MI down for code that is in no way "less maintainable." MI has no cross-language calibration. None of the constants were fit per-language.

So the comparability trap has three independent layers, any one of which invalidates a cross-team comparison:

1. **Cross-tool:** different formulas, coefficients, and definitions of "maintainability" entirely (radon's rescaled formula vs SonarQube's SQALE rating vs VS's clamped variant).
2. **Cross-language:** Halstead and LOC inputs vary by language idiom, and no constant was calibrated per language.
3. **Cross-codebase:** even *one tool, one language,* two repos differ in domain complexity, age, and file-size conventions, so the baseline isn't shared.

The corrosive part is the move from *comparing* to *ranking to act on.* Comparing incomparable numbers is merely wrong. **Ranking teams by them and attaching consequences — funding, headcount, a performance conversation, a leaderboard — is actively harmful**, for two reasons. First, you will reward and punish teams for their *tool and language choices,* not their actual code quality: the Python team on radon and the Java team on SonarQube can have identical real-world maintainability and land at opposite ends of the ranking. Second — and worse — the moment a number with no calibrated meaning controls a consequence, you've handed every team a strong incentive to move the number by whatever means is cheapest, which (see the next section) is almost never "write better code." You have built a leaderboard that measures nothing and corrupts everything it touches.

> **The professional stance:** the correct answer to "rank the teams by maintainability score" is *"those numbers aren't on the same scale, so the ranking would be fiction — but here's a comparison that **is** fair across teams: defect escape rate and change lead time, normalized per team, which are tool-agnostic and outcome-based."* You don't refuse the desire to compare teams; you redirect it onto axes that survive being compared.

---

## Using MI Correctly, If at All

There is a defensible way to use MI, and it is narrow. The frame that makes it safe: **MI is at most one weak trend line on a panel of several, never a number you act on directly.**

If you keep MI at all, hold it to four rules:

1. **One tool, one config, forever.** The instant you change tools, upgrade a major version that alters the formula, or re-tune the config, the historical series is broken — annotate the discontinuity on the chart or you'll mistake a tooling change for a real shift. Treat the pipeline as part of the metric's definition.

2. **Watch the slope, never the level.** A repo sitting flat at "55" for two years is fine; a repo sliding from "80" to "60" over two quarters is the thing to investigate. The level is uninterpretable; the *direction*, on a fixed pipeline, is weak-but-real signal.

3. **Never alone — pair it with outcome and behavioral signals.** MI is a *static snapshot of the code's shape.* On its own it can't tell you whether anyone is suffering. Put it next to signals that point at pain and at action:
   - **Churn × complexity hotspots** ([04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md)) — *where* the maintainability problem actually lives, weighted by how often it's touched.
   - **Defect rate / escaped-bug density** — whether the code is actually causing incidents.
   - **Change lead time / cycle time** ([Engineering Metrics & DORA](../../engineering-metrics-and-dora/)) — whether the code is actually slowing delivery.

   A falling MI that coincides with rising defects in the same files and lengthening lead time is a real, corroborated story. A falling MI with flat defects and flat lead time might just be a refactor that added explicit error handling and inflated LOC. The panel disambiguates; the single number can't.

4. **Decompose before you act — always.** MI is a blend, so a movement is ambiguous by construction: a drop could be more Halstead Volume (denser expressions), more cyclomatic complexity (more branches), or just more LOC (a big file). These call for *opposite* responses — splitting a god-function vs simplifying a gnarly conditional vs leaving a long-but-linear file alone. **Never act on MI; act on its decomposed components.** If MI fell, open the file and look at *which input* moved. Acting on the composite means you don't know what you're fixing.

The honest summary of this section is that MI's defensible uses are so hedged that for most orgs the right answer is to skip it and go straight to the components and the outcome metrics — which is exactly what the deprecation section argues. MI earns its place only when a same-tool trend line genuinely adds early-warning value that the component metrics don't already provide, which is rare.

---

## Goodhart and the Gaming Problem

Goodhart's Law — *when a measure becomes a target, it ceases to be a good measure* — applies to every metric, but composites are uniquely vulnerable, and MI is a textbook case. Understanding *why* is what lets you predict the gaming before it happens.

A single-input metric is gamed by attacking that input, and the attack is usually visible. If you target "cyclomatic complexity ≤ 10," people split functions; at least the reviewer can see whether the split is real. MI is different in two ways that make it both **easy to game** and **hard to audit**.

**Easy to game**, because a composite has *multiple* inputs and you only need to move the cheapest one. MI goes *up* when Halstead Volume goes down, when cyclomatic complexity goes down, or when LOC goes down — and crucially, because of the `ln(LOC)` and `ln(HV)` terms, **the formula rewards smaller files almost mechanically.** So the cheapest path to a higher MI is rarely "make the code better." It's:

- **Comment padding** — in tool variants that fold a comment-weight term into the score (some Visual Studio configurations), adding comments raises MI directly, with zero change to the actual logic. You can "improve maintainability" with a script that inserts boilerplate banners.
- **File splitting** — because of the `ln(LOC)` penalty, mechanically chopping one 600-line file into six 100-line files raises the *per-file* MI of each fragment even if you've made the system *worse* by scattering cohesive logic across files and adding cross-file coupling. The aggregate dashboard goes green; the code got harder to follow.
- **Dead-code shuffling and extraction-for-the-metric** — pulling rarely-touched code into separate modules to shrink the "hot" file's LOC and HV, improving its number without improving anything a reader experiences.

**Hard to audit**, because the score is a *lossy blend.* When MI moves, you cannot tell from the number *why* it moved — whether the team genuinely reduced complexity or just padded comments and split files. To audit a single-input metric you check the input. To audit a composite you have to **decompose it back into its parts and inspect each** — which most dashboards don't surface, so in practice nobody does. The number's opacity is precisely what makes it gameable without detection: the gaming and the genuine improvement produce *the same dashboard movement.*

> **The principle:** the more inputs a metric blends and the more it's been rescaled, the cheaper it is to game and the harder it is to audit — and the *worse* a target it makes. MI is near the top of that list: three blended inputs, an arbitrary constant, a log term that mechanically favors small files, and in some tools a comment-count term that rewards literal padding. Make MI a target and you will get comment padding and file splitting, dressed as maintainability work, with no way to tell the real from the cosmetic at the dashboard level. This is the strongest single argument for never targeting it.

---

## Deprecating MI in Favor of Actionable Signals

Once you accept that MI is at best a weak trend line and at worst a gameable target, the question becomes: *what do we put on the dashboard instead?* The answer is to **de-emphasize MI in favor of signals that point at a place and an outcome** — signals that tell a team *what file to open* and *whether it matters.*

The replacements, in rough order of value:

- **Churn × complexity hotspots.** The most actionable code-quality signal there is. It ranks files by how *often* they change times how *complex* they are, surfacing the handful of files where the team actually loses time. Unlike MI it names a *target* ("this file"), and it's inherently a prioritized list, not a grade. ([04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md).)
- **Defect density per area.** Bugs traced to modules. This is the *outcome* MI only gestures at — it tells you where quality problems are actually costing you incidents, not where a formula estimates they might.
- **Change lead time / cycle time, by area.** From the DORA family — how long it takes to land a change in a part of the system. A part of the codebase whose lead time is climbing is empirically hard to maintain, measured by the thing you actually care about (delivery speed) rather than a proxy. ([Engineering Metrics & DORA](../../engineering-metrics-and-dora/).)
- **Decomposed complexity, surfaced directly.** If you want a *code-shape* signal, show cyclomatic/cognitive complexity and file size *as themselves* on the hotspot list — un-blended, so they're auditable and actionable — rather than mashed into an MI.

How to actually deprecate it without a fight: **demote, don't delete, in one move.** Move MI off the headline of the dashboard and into a small "trend, context only — not a target" footnote, and *simultaneously* promote the hotspot list to the headline. Announce the swap in terms of what teams gain: "the old score told you that you had a problem somewhere; the hotspot list tells you which three files to fix this sprint." Engineers rarely mourn a number that never told them what to do, *once you've given them one that does.* The failure mode to avoid is deleting MI while offering nothing — that reads as "we stopped measuring quality," and someone will reinstate the score. Always lead with the replacement.

> **The reframe in one line:** stop asking *"what's our maintainability score?"* and start asking *"which three files cost us the most, and are defects and lead time getting worse there?"* The first question has no actionable answer; the second is a backlog.

---

## The Conversation That Moves the Org

Everything above converges on one conversation — the one that moves an organization from *"raise our maintainability score"* to *"reduce defects in our top hotspots."* It usually has four beats.

**Beat 1 — Grant the concern, refuse the proxy.** Leadership's underlying worry ("our code might be getting harder and slower to work with") is legitimate and you should say so plainly. What you refuse is the *proxy* — that a single composite score answers it. "You're right to want to know if our code is degrading. The maintainability score can't actually tell us that reliably — it's a blended number that a different tool would print differently — so let me show you what can."

**Beat 2 — Replace the target with an outcome.** Trade "MI ≥ 80" for an outcome leadership already cares about. "Instead of a quality *score*, let's target a quality *outcome*: cut escaped defects in our top-ten hotspot files by half this half, and keep lead time in those areas from rising." Now the goal is something a customer would feel, not a formula.

**Beat 3 — Make it concrete with the hotspot list.** Put the actual ranked list of churn × complexity hotspots in front of them, with the defect counts and lead times attached. Abstractions ("technical debt," "maintainability") lose to a list of five real files that everyone recognizes as painful. "These five files account for 60% of our recent bugs and the longest review times. *This* is the maintainability problem — not a number, these files."

**Beat 4 — Close the loop on the right axis.** Agree to report *progress* as the outcome trend (defects and lead time in those files), with MI relegated to an optional context footnote. The org now steers by "are the worst files getting better and are bugs going down," which is auditable, actionable, and immune to comment padding.

The whole arc replaces an un-actionable, gameable grade with a prioritized list tied to outcomes customers feel. That is the professional contribution here: not better metrics literacy for yourself, but **changing what the organization optimizes** — from a number that can be gamed in an afternoon to a backlog that, when burned down, actually makes the code better.

---

## War Stories

**The leaderboard of incomparable scores.** A platform org bought a quality tool, turned on its per-repo maintainability rating, and a director built a quarterly leaderboard ranking eight teams by it — bottom two got a "remediation plan" and a pointed review. The catch: three teams' repos were graded by the tool's built-in SQALE rating, two Python teams had wired in `radon`'s rescaled-formula score, and the numbers were pasted into one column as if they shared a scale. A Python team near the bottom wasn't worse — `radon`'s formula simply printed lower numbers for their idiomatic, comprehension-heavy code than the SonarQube rating did for the verbose Java repos at the top. The ranking measured tool-and-language choice, not maintainability. The damage wasn't just a bad chart: two solid teams spent a quarter under a cloud, and one strong engineer left over a "remediation plan" for a number that was statistical noise. The fix was to kill the leaderboard and replace it with a per-team, tool-agnostic comparison — defect escape rate and lead time — which actually *was* comparable across teams.

**The MI target met by padding comments.** A team committed to a definition-of-done that required "maintainability index ≥ 75" on touched files, verified in CI. Within two sprints the gate was green across the board — and the code was no better. Engineers had discovered that the org's tool variant folded a comment-density term into the score, so a pre-commit hook that inserted banner comments (`// ---- section ----`) lifted MI over the threshold for free. Others leaned on the `ln(LOC)` penalty: mechanically splitting a cohesive 500-line service into five files raised each fragment's MI while scattering logic the team now had to chase across files. The dashboard showed "maintainability improving"; the actual experience of working in the code got *worse.* The retro's conclusion was blunt: the metric was a composite nobody could audit at the dashboard level, the gaming and real improvement looked identical from above, and the gate had to go. They replaced "MI ≥ 75" with "no *increase* in the file's cyclomatic complexity without justification" — a single, auditable input — and tracked hotspots for prioritization.

**The org that dropped MI for hotspot-based prioritization.** A 200-engineer org had a "code health" dashboard headlined by an org-wide average maintainability index that had been flat for a year and had never once driven a decision — it was wallpaper. A staff engineer ran the experiment of mapping churn × complexity instead and found that 70% of the prior year's production incidents traced to eleven files, none of which the MI average had ever surfaced as remarkable. They demoted MI to a small context footnote, promoted the hotspot list to the dashboard headline, and reframed the quality goal from "improve our maintainability score" to "each team picks one hotspot per quarter and drives its defect rate down." Within two quarters, defects in the targeted files fell measurably and engineers reported the dashboard was useful *for the first time* — because it finally told them which file to open. Nobody missed the score.

---

## Decision Frameworks

**Should we track MI at all? Ask, in order:**
- Do we already have churn × complexity hotspots, defect density, and lead time? → If yes, MI almost certainly adds nothing; **skip it.** Those are more actionable and not gameable at the dashboard level.
- If we track MI, can we guarantee *one tool, one config, one codebase per series,* with discontinuities annotated? → If no, the series is meaningless; **don't track it.**
- Will anyone be tempted to read the *absolute level,* compare it across teams, or make it a target? → If you can't prevent all three, the risk outweighs the weak signal; **don't track it.**
- Is there a specific question only an MI *trend* answers that the component metrics don't? → If you can't name one, **skip it.**

**Someone asks to rank teams by maintainability score → respond:**
- "Those scores aren't on the same scale across tools or languages, so the ranking would be fiction. Here's a comparison that *is* fair across teams: defect escape rate and change lead time, normalized per team." Redirect the desire to compare onto tool-agnostic, outcome-based axes.

**Leadership sets an MI target → respond:**
- Grant the concern (is our code degrading?), refuse the proxy (a single composite can't answer it reliably), replace the target with an outcome (cut defects in the top hotspots; hold lead time), make it concrete with the hotspot list. Report progress as the outcome trend, not the score.

**MI dropped on a repo we *do* track → before acting:**
- **Decompose first.** Open the file; find which input moved — Halstead Volume, cyclomatic complexity, or LOC. They imply opposite fixes (simplify a conditional vs split a god-function vs leave a long linear file alone). Never act on the composite.

**Tempted to put MI in a CI gate → don't, unless:**
- You have made it un-gameable, which for a composite is effectively impossible. Gate on a single auditable input (e.g., complexity of touched functions) instead, and use MI — if at all — only as a non-blocking trend.

---

## Mental Models

- **MI is a trend, never a grade.** The only honest use is watching the *slope* on one tool and one codebase over time. The absolute level is uninterpretable; "62" is not 62 of anything.

- **The number is only comparable to itself.** Team A's radon score, Team B's SonarQube rating, and Team C's Visual Studio score live on three different axes. Comparing them is fiction; *ranking* teams by them is harmful fiction with consequences attached.

- **Composites are gameable in proportion to their inputs and rescalings.** MI blends three inputs, an arbitrary constant, a log term that favors small files, and sometimes a comment count. Each is a cheap lever. Make it a target and you'll get comment padding and file splitting that look identical to real work on the dashboard.

- **You can't act on a blend — decompose first.** A movement in MI is ambiguous by construction. Always open the file and find which input moved before doing anything, because the inputs imply opposite fixes.

- **Replace, don't just remove.** Deleting MI with nothing to offer reads as "we stopped caring about quality." Demote it to a footnote *and simultaneously* promote a hotspot list that tells teams which file to open. People don't mourn a number that never told them what to do.

- **The org optimizes what's on the headline.** Put an un-actionable score there and teams chase a number; put a hotspot list tied to defects and lead time there and teams fix real files. Your leverage is choosing the headline.

---

## Common Mistakes

1. **Treating the absolute MI as meaningful.** "62" carries no units and no calibration — a different tool prints a different number for identical code. Only the *trend on a fixed pipeline* means anything.

2. **Comparing or ranking teams by MI.** Across tools and languages the scores aren't on the same scale. Ranking teams by them rewards tool-and-language choice, not code quality, and attaching consequences (funding, reviews) actively harms good teams.

3. **Making MI a target or a CI gate.** A composite this gameable will be met by comment padding and file splitting, indistinguishable from real improvement at the dashboard level. Gate on a single auditable input instead, if anything.

4. **Acting on the composite without decomposing.** A drop could be Volume, complexity, or LOC — opposite fixes. Open the file and find the moved input first; never refactor "because MI fell."

5. **Ignoring tooling discontinuities in the trend.** A version bump or config change that alters the formula creates a fake jump. Annotate it, or you'll mistake a tooling change for a real shift and act on noise.

6. **Deleting MI with no replacement.** That reads as abandoning quality. Demote it to context *and* promote churn×complexity hotspots, defect density, and lead time in the same move.

7. **Rejecting the score instead of reframing the concern.** "That number is garbage, ignore it" loses the room. Grant the legitimate worry underneath, then offer the signal that actually answers it.

---

## Test Yourself

1. A VP shows a slide ranking five teams by "maintainability score" — three from SonarQube, two from radon — and asks you to fund the bottom two for remediation. What do you say, and what comparison do you offer instead?
2. Why is the *absolute* value of a maintainability index meaningless, while the *trend* can be weakly useful? Be specific about why a different tool prints a different number.
3. Name the three independent layers of the comparability trap, and give a concrete example of each invalidating a cross-team comparison.
4. Why are composite metrics like MI both *easier to game* and *harder to audit* than single-input metrics? Give two concrete gaming techniques and explain why they're invisible at the dashboard level.
5. Your org puts "MI ≥ 75 on touched files" in CI. Predict exactly how it gets gamed, and what you'd gate on instead.
6. A repo you track on a fixed MI pipeline drops from 80 to 62 over two quarters. Walk through what you do *before* taking any action.
7. Lay out the four-beat conversation that moves an org from "raise our maintainability score" to "reduce defects in our top hotspots."

<details>
<summary>Answers</summary>

1. The ranking is fiction: SonarQube's maintainability *rating* (a SQALE remediation-effort model) and radon's *rescaled-formula score* aren't on the same axis, and language idiom shifts the inputs on top of that — so the order reflects tool and language choice, not code quality. Funding the "bottom two" would punish teams for their toolchain. **Offer instead:** a tool-agnostic, outcome-based comparison — defect escape rate and change lead time, normalized per team — which is genuinely comparable across teams.

2. MI is a Halstead+cyclomatic+LOC blend rescaled with an arbitrary constant (`171`, clamped to 0–100 in VS) carrying no units. A different tool uses a different coefficient, counts LOC differently (physical vs logical), computes Halstead operators/operands differently, and may weight comments — so "62" from radon and "62" from another tool aren't the same quantity. The *trend* survives because, on a *fixed* pipeline and codebase, a sustained downward slope is weak-but-real evidence the code is getting denser/branchier/larger; the level is uninterpretable, the direction isn't.

3. **(a) Cross-tool:** radon's formula score vs SonarQube's SQALE rating vs VS's clamped variant — different formulas entirely, so 71 ≠ A ≠ 68. **(b) Cross-language:** the same algorithm written idiomatically in Python vs Java yields different Halstead Volume and LOC, so the *same tool* prints different MI for equivalent logic; no constant was calibrated per language. **(c) Cross-codebase:** even one tool and one language, two repos differ in domain complexity, age, and file-size norms, so there's no shared baseline.

4. **Easier to game:** a composite has multiple inputs and you only need to move the cheapest one; MI's `ln(LOC)` term mechanically rewards smaller files and some variants reward comments. **Harder to audit:** the score is a lossy blend, so a movement doesn't tell you *why* it moved — genuine improvement and gaming produce the *same* dashboard number, and you'd have to decompose to tell them apart (which dashboards rarely surface). **Two techniques:** comment padding (banner comments raise MI in comment-weighted variants with zero logic change); file splitting (chopping one cohesive file into many raises each fragment's MI via the LOC penalty while scattering logic). Both are invisible because the dashboard shows only the composite going up.

5. It's met by **comment padding** (a hook inserting banner comments where the variant weights comments) and **file splitting** (breaking cohesive files to exploit the `ln(LOC)` penalty), both raising MI without improving — and arguably worsening — the code, indistinguishable from real work at the dashboard level. **Gate instead** on a single auditable input, e.g. "no unjustified increase in the cyclomatic complexity of touched functions," and use MI only as a non-blocking trend if at all.

6. **Don't act on the composite.** First confirm there was no tooling discontinuity (version/config change) that faked the drop — annotate if so. Then **decompose:** open the files driving the drop and find which input moved — Halstead Volume (denser expressions → simplify), cyclomatic complexity (more branches → reduce branching), or LOC (a big file → maybe split, maybe leave it if it's long-but-linear). Corroborate with churn×complexity, defect rate, and lead time in those files to see whether anyone's actually suffering. Only then choose a fix matched to the actual moved input.

7. **Beat 1 — grant the concern, refuse the proxy:** acknowledge the legitimate worry (is our code degrading?), but explain the single score can't answer it reliably. **Beat 2 — replace target with outcome:** trade "MI ≥ 80" for "cut escaped defects in the top-ten hotspots by half this half, hold lead time." **Beat 3 — make it concrete:** put the ranked churn×complexity hotspot list, with defect counts and lead times, in front of them — five real files, not a number. **Beat 4 — close the loop on the right axis:** report progress as the defect/lead-time trend in those files; relegate MI to an optional context footnote.

</details>

---

## Cheat Sheet

```
WHAT MI CAN HONESTLY DO
  ONE job: same-tool, same-config, same-codebase TREND line
  watch the SLOPE, never the absolute LEVEL ("62" is not 62 of anything)
  NEVER a grade, NEVER a cross-team comparison, NEVER a target

COMPARABILITY TRAP (any ONE layer invalidates a cross-team compare)
  cross-tool : radon formula ≠ SonarQube SQALE rating ≠ VS clamped variant
  cross-lang : Halstead + LOC vary by idiom; no per-language calibration
  cross-repo : domain/age/file-size differ; no shared baseline
  ranking teams by it → rewards tool+language choice, not quality → HARMFUL

WHY COMPOSITES ARE WORSE TARGETS
  easy to game  : move the cheapest input (ln(LOC) favors small files; some
                  variants reward comments) → padding, file-splitting
  hard to audit : lossy blend — gaming and real work print the SAME number
  RULE: gate on a SINGLE auditable input, never the composite

USE IT (if at all)
  1 tool / 1 config / 1 codebase, annotate discontinuities
  pair with: churn×complexity hotspots · defect density · lead time
  DECOMPOSE before acting — find which input (HV / CC / LOC) moved

DEPRECATE → ACTIONABLE SIGNALS (demote, don't delete)
  headline: churn×complexity hotspots (names the FILE to open)
  + defect density per area     (the outcome MI only gestures at)
  + change lead time per area   (DORA: is it actually slowing delivery?)
  MI → small "trend, context only" footnote

THE ORG-MOVING CONVERSATION
  grant concern → refuse proxy → replace target with OUTCOME →
  show the hotspot list → report defect/lead-time trend, not the score
  from "raise our maintainability score" → "cut defects in our top hotspots"
```

---

## Summary

- **MI's only honest use is a same-tool, same-config, same-codebase trend** — watch the slope, never the absolute level. "62" carries no units; a different tool prints a different number for identical code. It is not a grade and not a target.
- **The comparability trap has three independent layers** — cross-tool (radon's formula vs SonarQube's SQALE rating vs Visual Studio's variant), cross-language (Halstead and LOC vary by idiom, uncalibrated), and cross-codebase — and any one of them makes a cross-team comparison meaningless. **Ranking teams by MI is actively harmful**: it rewards tool and language choice, not code quality, and attaching consequences punishes good teams for noise.
- **Composites are uniquely bad targets.** MI blends three inputs, an arbitrary constant, a log term that mechanically favors small files, and sometimes a comment count — so it's *easy to game* (comment padding, file splitting) and *hard to audit* (genuine improvement and gaming produce the same dashboard movement). Never make it a CI gate.
- **If you use it at all, hold it to four rules:** one fixed pipeline, watch the slope, pair it with [hotspots](../04-code-churn-and-hotspots/professional.md) / defect rate / [lead time](../../engineering-metrics-and-dora/), and **decompose before acting** — a movement could be Volume, complexity, or LOC, which imply opposite fixes.
- **Deprecate by demoting, not deleting:** move MI to a context footnote and promote a churn×complexity hotspot list to the [dashboard](../06-code-health-dashboards/professional.md) headline, so teams get told *which file to open* instead of a grade.
- **The professional contribution is moving the org's objective** — through a four-beat conversation (grant the concern, replace the target with an outcome, make it concrete with the hotspot list, report the defect/lead-time trend) — from "raise our maintainability score" to "reduce defects in our top hotspots."

The interview tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone understands what MI measures, why it's weak, and how they'd handle it on a dashboard.

---

## Further Reading

- Paul Oman & Jack Hagemeister, *"Metrics for Assessing a Software System's Maintainability"* (1992) — the original index and the corpus the constant was fit to; read it to see how little the absolute number was ever meant to carry.
- Marvin Zelkowitz et al. and later critiques of composite maintainability metrics — why blending Halstead, cyclomatic, and LOC into one score loses more than it gains.
- Adam Tornhill, *Software Design X-Rays* — the behavioral, hotspot-based alternative to static composite scores; the strongest practical case for what to track instead of MI.
- Charles Goodhart / Marilyn Strathern, on "when a measure becomes a target" — the law that explains MI's gaming dynamics.
- The SQALE method (Jean-Louis Letouzey) — what SonarQube's maintainability *rating* actually computes, and why it is **not** the Halstead-based index, so the two are not comparable.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the outcome-based metrics (lead time, change failure rate) you redirect leadership toward instead of a code-shape score.

---

## Related Topics

- [junior.md](junior.md) — what the maintainability index is and the intuition behind the composite.
- [senior.md](senior.md) — the formula, the `171` constant, the Halstead/cyclomatic/LOC inputs, the Visual Studio rescale, and why the composite is weak.
- [interview.md](interview.md) — the questions that probe whether someone understands MI's meaning, limits, and dashboard handling.
- [06 — Code Health Dashboards](../06-code-health-dashboards/professional.md) — aggregating metrics into ratings and views, trends over absolutes, and not turning the dashboard into a target.
- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md) — the actionable, hard-to-game signal you promote in MI's place.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the team/delivery outcomes (lead time, defect rate) that survive being compared across teams when MI can't.

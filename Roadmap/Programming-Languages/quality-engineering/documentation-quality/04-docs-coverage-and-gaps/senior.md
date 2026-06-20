# Docs Coverage & Gaps — Senior Level

> **Roadmap:** [Documentation Quality](../README.md) → Docs Coverage & Gaps
> *The middle page taught you to run `interrogate`, `godoc`, and a link checker and read the percentages. This page is about the measurement theory underneath them: why docstring-coverage is the weakest doc metric there is, how to weight a coverage number by reader demand instead of symbol count, and how the strongest gap signal never appears in any coverage tool at all — it's in your search logs and your support queue.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Why Docstring Coverage Is the Weakest Metric — the Line-Coverage Analogy](#why-docstring-coverage-is-the-weakest-metric--the-line-coverage-analogy)
4. [Risk-Weighted and Demand-Weighted Coverage](#risk-weighted-and-demand-weighted-coverage)
5. [Demand-Side Gap Discovery — Reader Behavior as the Ground Truth](#demand-side-gap-discovery--reader-behavior-as-the-ground-truth)
6. [Diátaxis Completeness — Coverage Across Doc Types](#diátaxis-completeness--coverage-across-doc-types)
7. [Information Scent and the Mid-Task Gap](#information-scent-and-the-mid-task-gap)
8. [Error-Message Documentation — the Empty High-ROI Dimension](#error-message-documentation--the-empty-high-roi-dimension)
9. [Building a Meaningful Coverage Signal](#building-a-meaningful-coverage-signal)
10. [The Honest Limit — Coverage Finds Absence, Not Wrongness](#the-honest-limit--coverage-finds-absence-not-wrongness)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The measurement theory of docs coverage — what a coverage number can and cannot mean, how to weight it by who actually reads, and how to find the gaps that matter rather than the gaps a tool can see.**

By the middle level you can stand up the tooling: `interrogate --fail-under=80` in CI, a `godoc` audit that flags exported symbols with no comment, a JSDoc coverage report, a nightly link checker. You can produce the number "87% documented" and gate a pull request on it. That is operationally useful and it is also where most teams stop — which is exactly the problem.

The senior jump is to stop treating coverage as a target and start treating it as a *measurement instrument with known biases*. "87% of symbols have a docstring" answers a question almost nobody asked. The questions that matter are: *of the symbols people actually use, how many are well documented? Of the tasks people actually try to accomplish, how many have a path through the docs? Of the errors people actually hit, how many are explained anywhere?* Those are different questions with different denominators, and the gap between them is where naive coverage quietly lies to you — the same way line coverage lies about test quality.

This page builds the theory: the line-coverage analogy that exposes why presence isn't usefulness, demand-weighting that fixes the denominator, demand-side discovery that finds real gaps from reader behavior, Diátaxis completeness as a structural gap model, and finally the honest boundary — coverage can only ever find *absence*; it is blind to *wrongness*. A senior owns that boundary explicitly rather than letting a green dashboard imply something it can't measure.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — docstring-coverage tools (`interrogate`, `godoc`, JSDoc), running them in CI, reading and gating on the percentage.
- **Required:** You understand the Diátaxis four-mode model (tutorial, how-to, reference, explanation) from [01 — What Makes Docs Good](../01-what-makes-docs-good/senior.md).
- **Helpful:** A working knowledge of the test-coverage critique — line vs branch vs mutation coverage, and *why* high line coverage doesn't imply good tests. See [Code Coverage](../../code-coverage/).
- **Helpful:** Access to real reader-behavior data for a product you've shipped — site-search logs, a support ticket queue, analytics — even read-only. The whole demand-side argument is abstract until you've grepped a search log.

---

## Why Docstring Coverage Is the Weakest Metric — the Line-Coverage Analogy

Docstring coverage is the documentation analog of line coverage, and it inherits every one of line coverage's pathologies. Hold the two side by side:

| | Line coverage | Docstring coverage |
|---|---|---|
| Measures | Was this line *executed* by a test? | Does this symbol *have* a comment? |
| Does **not** measure | Was the behavior *asserted*? Is the test *correct*? | Is the comment *accurate*? *Useful*? *Current*? |
| Gamed by | A test that runs code with no assertions | A comment that restates the signature (`// returns the user`) |
| The seductive number | "90% covered" feels like "90% tested" | "90% documented" feels like "90% useful" |
| The actual claim | "90% of lines ran during *some* test" | "90% of symbols have *some* text attached" |

The structural flaw is identical: both measure *presence of an artifact*, not *presence of value*. A line that executes proves nothing about whether a test would catch a regression on that line — that's the whole reason mutation testing exists. A symbol with a docstring proves nothing about whether a reader can use that symbol — and there is no widely-deployed "mutation testing for docs" to close the gap.

This is the same critique Laura Inozemtseva and Reid Holmes leveled at line coverage in their 2014 study *Coverage Is Not Strongly Correlated with Test Suite Effectiveness*: once you control for suite size, coverage percentage is a weak predictor of how many real faults the suite catches. The documentation version is even starker, because docs have no equivalent of an assertion *at all*. A test at least *can* assert; a docstring is pure presence by construction. So the correlation between docstring coverage and "can a reader actually accomplish their task" is weaker than the already-weak code correlation.

Consider a codebase at 95% docstring coverage that is, in every way that matters, undocumented:

```python
def process(data: dict, opts: Options) -> Result:
    """Process the data.

    Args:
        data: The data.
        opts: The options.

    Returns:
        The result.
    """
```

Every coverage tool scores this 100%. It tells the reader nothing they couldn't read off the signature: not what "process" means here, not which keys `data` must contain, not which `opts` matter, not what `Result` represents, not what happens when `data` is malformed, not whether it mutates `data`, not whether it's safe to call concurrently. The tool counted the *envelope* and ignored that the *letter* is blank. A whole codebase can be like this and pass any `--fail-under` gate you set. That is not a contrived edge case — auto-generated and AI-padded docstrings produce exactly this at scale, and they move the coverage number the most.

> **Key insight:** Docstring coverage measures whether text exists where a tool expected text. It is structurally incapable of measuring whether that text helps a reader, because — unlike a test, which can at least assert — a docstring has no executable claim to check. Treat the number the way you treat line coverage: a *floor on absence* (below 60% you certainly have holes) but never a *ceiling on quality* (95% tells you nothing about usefulness). It is the weakest signal in this entire roadmap, and it is the one most teams over-index on precisely because it's the easiest to compute.

---

## Risk-Weighted and Demand-Weighted Coverage

The deepest flaw in naive coverage isn't the numerator (presence vs value) — it's the **denominator**. "Percent of *all symbols* documented" treats every symbol as equally worth documenting, which is false by orders of magnitude. A private helper called in one place and a public API function called by ten thousand downstream users are one symbol each in that ratio. Weighting them equally is the documentation equivalent of measuring code quality by counting all lines the same whether they're in a payment processor or a debug log formatter.

Code-quality dashboards solved this with **risk-weighting**: a complexity hotspot in a frequently-changed, business-critical module counts for far more than the same complexity in a stable leaf utility (this is the Adam Tornhill *Your Code as a Crime Scene* idea — weight by change frequency × complexity). Documentation needs the same move, and its risk axis is **reader demand**. The question is not "what fraction of symbols are documented" but **"what fraction of the documentation that people actually need is good?"**

Make the denominator demand. Concretely, weight every documentable unit by a demand signal and compute coverage over that weighting:

```
                Σ (demand_weight × is_well_documented)   over units
demand_coverage = ─────────────────────────────────────────────────
                          Σ demand_weight                over units
```

Where `demand_weight` is drawn from signals you can actually obtain:

| Demand signal | Source | What it proxies |
|---|---|---|
| Public-API membership | Exported symbols, OpenAPI spec, SDK surface | Contractual obligation; breakage blast radius |
| Call frequency / import count | Static analysis, package-registry reverse deps, telemetry | How many readers will hit this |
| Support-ticket references | Ticket text mining | Where *absence* already costs money |
| Page views / search hits | Docs-site analytics | Revealed reader interest |
| Onboarding-path membership | The "first 10 things a new user does" | Disproportionate first-impression cost |

A 200-symbol public API at 70% demand-weighted coverage is in real trouble; a 50,000-symbol codebase at 70% *flat* coverage might be entirely fine if the documented 70% contains everything anyone calls. The flat number can't distinguish those two worlds. The demand-weighted number is built to.

The sharpest version of this is to **invert the question from supply to demand**. Stop asking "which symbols lack docs?" (a supply-side list dominated by private noise) and start asking "which of the things *people reach for* lack docs?" The first list is long, mostly irrelevant, and demoralizing. The second is short, every entry is load-bearing, and fixing it moves a metric a human cares about. Same underlying data, opposite usefulness — entirely because of the denominator.

> **Key insight:** Coverage's denominator encodes a theory of what matters. "All symbols" encodes "everything matters equally," which is never true. Replace it with a demand-weighted denominator — public-API surface, call frequency, ticket references — and the metric stops rewarding docstrings on dead code and starts rewarding docs on the things readers actually touch. This is risk-weighting from code-quality dashboards, applied to docs, with *reader demand* as the risk axis.

---

## Demand-Side Gap Discovery — Reader Behavior as the Ground Truth

Tool-reported gaps are *supply-side*: the tool walks your symbols and reports which ones lack text. That list is real but weak — it's biased toward whatever the tool can parse (it sees missing docstrings, never the missing *how-to guide*), and it has no idea which gaps anyone cares about. The strongest gap signal is **demand-side**: it comes from watching what readers tried to find and failed to find. Reader behavior is ground truth in a way no static scan can be, because a failed search is a *gap a real person hit on a real task* — not a gap a linter inferred from an empty comment slot.

The richest demand-side sources, roughly in order of signal strength:

- **Failed site searches.** Queries on your docs site that returned zero results, or returned results the user didn't click, are a near-perfect gap detector: a human typed what they wanted in their own words and the docs had no answer. Mine the zero-result and zero-click query logs; the top recurring queries *are* your highest-demand gaps, pre-ranked by frequency. This is the single highest-yield gap source most teams already have and never look at.
- **Support tickets and their deflection potential.** Every ticket that a doc *could* have answered is a measured, costed gap — someone needed information badly enough to open a ticket and pay the round-trip latency. Cluster ticket text; recurring clusters with no corresponding doc are gaps ranked by real expense. (This is the bridge to [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md): the same ticket data that finds gaps also prices the value of closing them.)
- **Stack Overflow / community questions about your product.** External Q&A is demand that *left* your docs entirely. A frequently-asked, highly-upvoted SO question about your API is a gap so real that the community routed around you to answer it. The answer's existence elsewhere doesn't fill *your* gap — it proves it.
- **The "I couldn't find…" channel.** Explicit failure reports — docs-feedback widgets ("Was this helpful? No → why?"), `#docs` Slack questions, the sentence "the docs don't say how to…" in any channel. These are pre-labeled gaps; the reader did your gap analysis for you.
- **Search-then-leave and rage paths.** Analytics sessions where a user searched, landed, and immediately bounced — or hit the same page repeatedly — signal a page that *exists* but doesn't answer the demand behind the query. That's a quality gap a coverage tool will score as fully covered.

The defining property of all of these: **a coverage tool cannot produce any of them.** No static analysis of your source tree will ever tell you that forty people last week searched "how to rotate the signing key" and found nothing, because the gap isn't a missing docstring on a symbol — it's a missing *guide* for a *task*, and the evidence lives in a log the compiler never sees. Demand-side discovery is the only method that finds gaps weighted by real, observed need rather than by what a parser happened to notice.

> **Key insight:** The strongest evidence of a documentation gap is not a tool reporting absence — it's a *reader* reporting failure, by searching and finding nothing, by filing a ticket, by asking the question elsewhere. Supply-side tools find gaps you might have; demand-side signals find gaps people *actually hit*, already ranked by frequency and cost. Wire your search logs and ticket queue into your gap analysis and you'll find that the gaps that matter were never in the symbols the coverage tool was scanning.

---

## Diátaxis Completeness — Coverage Across Doc Types

Docstring coverage measures one cell of a much larger grid and reports it as the whole picture. The grid comes from Diátaxis (Daniele Procida): documentation serves four distinct needs, and they are not substitutes for one another.

| Mode | Reader's situation | Reader's question |
|---|---|---|
| **Tutorial** | Learning, new | "Take me through my first success." |
| **How-to** | Working, has a goal | "How do I accomplish *this specific task*?" |
| **Reference** | Working, needs a fact | "What exactly does this do / what are the parameters?" |
| **Explanation** | Studying, building a model | "Why does it work this way? What are the tradeoffs?" |

Docstring/API coverage measures **reference completeness only** — and only the API-reference slice of reference at that. A feature can have flawless, 100%-covered reference docs and still be *completely undocumented for its actual use*, because the reader who needs a how-to cannot assemble one from reference entries any more than a tourist can navigate a city from a dictionary of street names. The dictionary is accurate; it's the wrong genre for the need.

This gives a **structural completeness model** that a docstring tool is constitutionally blind to. Build a feature × mode matrix:

```
                    Tutorial   How-to    Reference   Explanation
  Authentication       ✓          ✓          ✓            ✓
  Webhooks             ✗          ✗          ✓            ✗      ← reference-only: a real gap
  Rate limiting        ✓          ✓          ✓            ✗
  Key rotation         ✗          ✗          ✗            ✗      ← total gap (and high-demand!)
  Bulk import          ✓          ✗          ✓            ✗      ← no how-to: users can't do the task
```

Every ✗ is a gap. The Webhooks row is the canonical case: it has complete reference docs (so docstring coverage reports it as fully covered) but no how-to and no explanation — so a developer can see *every field of the webhook payload* and still have no idea *how to set one up* or *why* the delivery model is at-least-once. The coverage tool reports green; the reader is stranded. That gap is invisible to any symbol-scanning tool because the missing artifact isn't a symbol — it's an entire genre of document that doesn't exist.

The senior method: treat **doc-type coverage** as a first-class dimension alongside symbol coverage. For each significant feature (and you scope "significant" by demand — back to the weighting), ask which of the four modes exist and which the feature actually *needs*. Not every feature needs all four — a trivial utility may need only reference — but the *decision* should be explicit, not an accident of which artifact someone happened to write. A reference-only feature that users have to *do something with* is a near-certain how-to gap, and that's the highest-frequency real gap in developer docs.

> **Key insight:** Docstring coverage measures one cell — API reference — of the four-mode Diátaxis grid and silently reports it as total coverage. A feature with perfect reference and no how-to has a real, often severe gap that *no symbol-scanning tool can detect*, because the missing thing is a document genre, not a symbol. Completeness is a feature × mode matrix; coverage that ignores the mode axis is measuring a quarter of the territory and calling it the map.

---

## Information Scent and the Mid-Task Gap

There's a class of gap that's invisible to both symbol coverage *and* doc-type coverage, and it's the one readers hit most viscerally: the gap they fall into **mid-task**. The doc exists, it's the right genre, it's even accurate — and then on step 4 of 7 it references a concept it never defined, or links to a page that doesn't exist, or assumes a configuration step that's documented nowhere. The reader was following a scent and the trail went cold.

The framing comes from **Information Foraging Theory** (Pirolli and Card, Xerox PARC): readers navigate documentation the way animals forage, following **information scent** — the perceived likelihood that a given link or heading leads to what they want. A gap, in this model, is a **broken scent trail**: a point where the reader was on a path toward their goal and the path simply stopped. These gaps are *path-dependent* — they don't exist in any single document; they emerge from the *journey across* documents — which is exactly why no per-symbol or per-page coverage check can find them.

The high-frequency forms:

- **The missing link.** A how-to mentions a prerequisite ("first, configure your IAM role") with no link, and the reader has no scent toward where that's documented. The target page may even *exist* — full coverage on both ends — but the *connection* doesn't, so the reader is stranded at a fork with no marked trail. Coverage tools score both pages green and never look at the edge between them.
- **The undefined term mid-flow.** A term of art appears in step 3, unlinked and unexplained, on the assumption the reader already knows it. For the reader who doesn't, the scent dies on contact.
- **The dead-end fork.** A navigation choice ("Advanced configuration →") that leads somewhere thinner than the heading promised. The scent was strong; the payoff was weak — the search-then-leave pattern from the demand-side section, seen from the page side.

You find scent gaps with methods aimed at *journeys*, not artifacts: link-graph analysis (every internal link target should resolve *and* every high-demand task should be reachable by following scent from a sensible entry point — orphan pages with no inbound scent are gaps even though they exist), task-based walkthroughs (pick the top demand-weighted tasks, follow the docs as a reader, and mark every point where the next step isn't obvious), and the session analytics that reveal where real readers' trails actually went cold.

> **Key insight:** The gap a reader hits is rarely a missing document — it's a missing *connection*: an unlinked prerequisite, an undefined term, a fork that dead-ends. These are broken scent trails, and they are path-dependent, emerging only from the journey *across* docs. No per-symbol or per-page coverage tool can see them, because the missing thing is an *edge* in the documentation graph, not a node. Finding them requires following the reader's path, not scanning the source tree.

---

## Error-Message Documentation — the Empty High-ROI Dimension

There is one coverage dimension that is almost universally empty, almost universally high-demand, and almost never measured: **the errors your software emits.** An error message is the single most demand-concentrated documentation surface you have — by definition it's read at the exact moment a user is blocked, frustrated, and actively searching. And yet "is this error documented anywhere?" appears on essentially no coverage dashboard.

The demand math is overwhelming. When a user hits `ERR_TOKEN_EXPIRED_OR_REVOKED` or `connection reset by peer (code 1006)`, their *first* action is to paste it into a search engine. If your docs answer that query — what the error means, why it happens, how to fix it — you deflect a ticket at the moment of highest intent. If they don't, the user lands on a Stack Overflow thread (the demand leaving your docs, from the earlier section) or files a ticket. Error documentation is where demand is *most* concentrated and supply is *most* absent — the highest-ROI gap class in most products, sitting in the blind spot of every symbol-coverage tool.

It's also unusually *measurable*, because the universe of errors is enumerable in a way that "all possible reader tasks" is not:

```bash
# Enumerate the error surface from source — every distinct code/message the software can emit
rg -o 'ERR_[A-Z_]+' --no-filename src/ | sort -u > errors-emitted.txt

# Enumerate what's actually documented
rg -o 'ERR_[A-Z_]+' --no-filename docs/ | sort -u > errors-documented.txt

# The gap: emitted but undocumented — ranked by how often each fires in production logs
comm -23 errors-emitted.txt errors-documented.txt
```

This produces a *true, demand-rankable* coverage metric: error-documentation coverage = (distinct errors documented) / (distinct errors emitted), and you can weight the denominator by production frequency so the errors users actually hit dominate the score. Unlike docstring coverage, this number means something — every uncovered entry is a message a real user can see with no explanation waiting for them. The same enumerate-and-diff pattern extends to any closed, emittable surface: config keys, CLI flags, metric names, deprecation warnings.

> **Key insight:** Error messages are the most demand-concentrated documentation surface in existence — read at peak user frustration, instantly searched — and the least likely to be covered or even measured. Error-documentation coverage (emitted errors ∩ documented errors, weighted by production frequency) is a genuinely meaningful coverage metric and usually the highest-ROI gap a team can close, precisely because demand is maximal and supply is near zero. It is also enumerable, which most doc gaps are not.

---

## Building a Meaningful Coverage Signal

No single number captures documentation completeness, and pretending one does is the original sin. The senior move is to **compose** a small set of signals, each measuring a different axis, and to be explicit about what each one can and can't claim. Four signals, layered:

**1. API-doc presence (the floor).** Keep docstring/API coverage — `interrogate`, `godoc`, JSDoc — but demote it to what it is: a *floor on absence* for the reference layer. Gate at a modest threshold (catch the egregious holes) and stop treating movement above the floor as progress. It answers exactly one narrow question; let it answer only that.

**2. Demand weighting (the denominator fix).** Re-express presence over a demand-weighted denominator — public-API surface, call frequency, ticket references — so "70% documented" means "70% of what readers actually reach for," not "70% of all symbols including dead code." This is the single highest-leverage upgrade to a coverage program, because it changes *which gaps surface to the top*.

**3. The doc-type matrix (the structural axis).** Track Diátaxis completeness per significant feature — which of tutorial / how-to / reference / explanation exist versus which the feature *needs*. This catches the entire class of gaps (reference-only features, missing how-tos) that symbol coverage is blind to by construction.

**4. Quality sampling (the value axis the others can't reach).** Because every metric above measures *presence*, add a periodic human-judged sample to measure *value*: take a demand-weighted random sample of the documented surface and have a reviewer score each item for accuracy and usefulness (is it more than a signature restatement? could a reader act on it?). You can't grade everything, but a sample gives you a *quality rate* — "of the 70% we mark documented, roughly what fraction is actually useful?" — which is the closest a coverage program gets to mutation testing's "of the lines you cover, how many failures would you catch?"

Composed, these become a small dashboard that resists gaming on any single axis: presence (floored), weighted by demand, structured by doc type, and spot-checked for quality. A team can't pad the number with empty docstrings (sampling catches it), can't claim completeness while missing every how-to (the matrix catches it), and can't hide behind documenting dead code (the demand weight zeroes it out). Each signal closes a loophole the others leave open — and *that*, not any one percentage, is the coverage signal worth building.

> **Key insight:** A meaningful coverage signal is a *composite* — API-doc presence as a floor, a demand-weighted denominator, a Diátaxis doc-type matrix, and human quality sampling — each measuring an axis the others can't, each closing a gaming loophole the others leave open. The goal is not a better single number; single numbers are the disease. The goal is a small set of signals no one can satisfy with empty text on dead code, which is precisely what a single docstring percentage rewards.

---

## The Honest Limit — Coverage Finds Absence, Not Wrongness

Here is the boundary a senior states out loud, because letting a green dashboard imply more than it can support is how coverage programs lose credibility: **coverage detects absence; it cannot detect wrongness.** Every technique on this page — docstring presence, demand-weighting, the doc-type matrix, error enumeration — answers "does documentation *exist* here?" None of them answers "is the documentation *correct*?" or "is it *helpful*?"

The failure modes coverage is structurally blind to:

- **Confidently wrong docs.** A docstring that says the function returns seconds when it returns milliseconds scores as fully covered and is *worse than absent* — absence sends the reader to read the source; a wrong doc sends them to ship a bug. Coverage rewards this with a checkmark.
- **Stale-but-present docs.** Documentation that was accurate two releases ago, never updated, still present. 100% covered, 0% true. (This is the entire concern of [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/senior.md) — a *different* measurement axis precisely because coverage can't touch it.)
- **Technically-complete, practically-useless docs.** The `"""Process the data."""` from the opening — present, accurate, worthless. Maximum coverage, zero value.

This is the same boundary line coverage hits: a covered line can still be wrong (which is why mutation testing exists), and a covered symbol can still be wrong (and there's no deployed equivalent of mutation testing to catch it). Coverage is a *necessary-condition* instrument — *no* docs is definitely bad, so finding absence is genuinely useful — but it is never a *sufficient-condition* instrument: presence does not imply correctness or value. The two other axes that *do* attack those — freshness (is it current?) and quality sampling / readability (is it any good?) — are separate measurements *because* coverage cannot reach them. That's not a gap in your tooling; it's a property of what "coverage" means.

> **Key insight:** Coverage is a presence detector. It finds where docs are *absent* — genuinely useful, because nothing is unambiguously bad — but it is constitutionally blind to *wrongness* and *uselessness*: a confidently incorrect, badly stale, or content-free doc scores as fully covered. A senior states this limit explicitly and pairs coverage with the axes that *can* see value — freshness, quality sampling, demand-side reader feedback — rather than letting a green number imply a quality it cannot measure. Coverage is necessary, never sufficient.

---

## Mental Models

- **Docstring coverage is line coverage wearing a different hat.** Both count presence of an artifact, not presence of value; both seduce with a number that *feels* like quality; both are gamed by content-free padding. Whenever you're tempted to trust a docstring percentage, ask the line-coverage question: "covered by *what*, asserting *what*?" — and remember docs don't even have the assertion.

- **The denominator is a theory of what matters.** "% of all symbols" silently asserts every symbol matters equally. Demand-weighting replaces that false theory with a true-er one — public API, call frequency, ticket references — so the metric counts what readers reach for. Always ask what a coverage ratio is dividing by *before* you trust the ratio.

- **The strongest gap signal is a reader failing, not a tool reporting.** Supply-side tools find gaps you might have; failed searches, tickets, and "I couldn't find…" find gaps people *actually hit*, pre-ranked by frequency and cost. The best gap analysis lives in your search logs, not your source tree.

- **Completeness is a feature × mode matrix, not a percentage.** Docstring coverage measures one cell (API reference). A feature with perfect reference and no how-to has a severe gap no symbol tool can see. Map the four Diátaxis modes against your features; the empty cells are the gaps that matter.

- **The worst gaps are edges, not nodes.** The mid-task gap — the unlinked prerequisite, the undefined term — is a broken scent trail that exists only in the *journey across* docs. No per-page tool finds an edge. Walk the reader's path to find them.

- **Coverage is necessary, never sufficient.** It finds absence. It is blind to wrongness and uselessness. Pair it with freshness and quality sampling — the axes that measure value — and never let a green coverage number stand in for "our docs are good."

---

## Common Mistakes

1. **Gating on docstring coverage and calling docs "done."** A `--fail-under=80` gate catches *gross* absence and nothing more; above the floor, the number is noise. Teams that chase it from 80% to 95% are paying to add empty docstrings to dead code. Floor it, then measure demand-weighting, doc-type completeness, and quality instead.

2. **Measuring coverage over all symbols instead of over demand.** A flat "% of symbols documented" is dominated by private helpers nobody reads and rewards documenting dead code. Weight the denominator by demand — public API, call frequency, ticket references — or the metric optimizes for the wrong gaps.

3. **Only mining supply-side (tool-reported) gaps.** The list of symbols lacking docstrings is real but weak — biased to what the parser sees and blind to which gaps anyone cares about. The high-value gaps are demand-side: failed searches, tickets, SO questions. Ignoring reader behavior means finding the gaps that don't matter and missing the ones that do.

4. **Treating reference coverage as total coverage.** A feature with flawless API docs and no how-to is *unusable* for its actual purpose, yet scores 100%. Track the Diátaxis doc-type matrix; reference-only is a near-certain how-to gap for anything users must *do something* with.

5. **Never documenting error messages.** The most demand-concentrated surface in your product — read at peak user frustration, instantly searched — is almost always uncovered and unmeasured. Enumerate emitted errors, diff against documented ones, weight by production frequency; it's usually the highest-ROI gap available.

6. **Letting a green coverage dashboard imply correctness.** Coverage finds absence, not wrongness. A confidently wrong or badly stale doc scores fully covered and is worse than nothing. Pair coverage with freshness metrics and human quality sampling, and say plainly that coverage cannot see value.

7. **Reporting one number.** No single metric captures documentation completeness; a single percentage is gameable on whatever axis it ignores. Compose presence + demand weight + doc-type matrix + quality sample so no one axis can be satisfied with empty text on unused code.

---

## Test Yourself

1. Explain the line-coverage / docstring-coverage analogy precisely. What does each measure, what does neither measure, and why is the docstring case *even weaker* than the line case?
2. A codebase reports 95% docstring coverage. Construct a concrete scenario in which it is, in every way that matters, undocumented. What did the tool actually count?
3. What is wrong with the *denominator* in "% of all symbols documented," and how does demand-weighting fix it? Name three demand signals you'd weight by.
4. Why is a failed site search a stronger gap signal than a tool-reported missing docstring? Name three other demand-side gap sources.
5. A feature has complete, 100%-covered API reference docs and nothing else. Using Diátaxis, explain what gap exists and why no symbol-scanning tool can detect it.
6. What is a "mid-task gap" / broken scent trail, and why can no per-symbol or per-page coverage check find it?
7. Why is error-message documentation usually the highest-ROI coverage gap, and why is it unusually *measurable* compared to most doc gaps?
8. State the honest limit of all coverage measurement in one sentence, and name the two other measurement axes that exist *because* coverage can't reach them.

<details>
<summary>Answers</summary>

1. **Line coverage** measures whether a line *executed* during some test; **docstring coverage** measures whether a symbol *has* attached text. Neither measures *value*: line coverage doesn't check that the behavior was *asserted* (hence mutation testing); docstring coverage doesn't check that the text is *accurate or useful*. The docstring case is weaker because a test at least *can* assert a claim, whereas a docstring is pure presence by construction — there's no executable claim to check and no deployed "mutation testing for docs."

2. Every symbol carries a docstring that merely restates its signature — `"""Process the data. Args: data: The data. Returns: The result."""` — across the codebase. The tool counts 95% because *text exists* where it expected text. It tells the reader nothing the signature didn't: not the meaning, not required keys, not error behavior, not concurrency safety. The tool counted the envelope and ignored that the letter is blank. Auto-generated/AI-padded docstrings produce exactly this and move the number the most.

3. "% of all symbols" treats every symbol as equally worth documenting — a one-call private helper counts the same as a public API function with ten thousand users — so it rewards documenting dead code and buries the gaps that matter. Demand-weighting makes the denominator `Σ demand_weight` so coverage measures "% of what readers actually reach for." Demand signals: public-API membership, call/import frequency, support-ticket references (also: page views/search hits, onboarding-path membership).

4. A failed site search is a *real person, on a real task, typing what they wanted in their own words, finding nothing* — ground-truth demand, pre-ranked by frequency. A tool-reported missing docstring is a parser inferring absence from an empty slot, with no idea whether anyone cares. Other demand-side sources: support tickets (gaps ranked by cost), Stack Overflow / community questions about your product (demand that left your docs), the explicit "I couldn't find…" channel (docs-feedback widgets, `#docs` questions), and search-then-leave / rage-path analytics.

5. Diátaxis says docs serve four needs — tutorial, how-to, reference, explanation. API coverage measures *reference only*. A reference-complete feature with no how-to leaves a reader who has a task unable to accomplish it (you can't assemble a how-to from reference entries any more than navigate a city from a street-name dictionary). No symbol tool can detect it because the missing artifact isn't a symbol — it's an entire document *genre* that doesn't exist.

6. A mid-task gap is a point where the reader was on a path toward their goal and the trail went cold — an unlinked prerequisite, an undefined term mid-flow, a fork that dead-ends (a broken *information scent* trail, per Information Foraging Theory). It's *path-dependent*: it exists only in the journey *across* documents, not in any single one. Per-symbol/per-page tools scan nodes; this gap is an *edge* in the documentation graph, so no node-scanning check can find it.

7. An error message is read at the exact moment of peak user frustration and is *instantly* pasted into a search engine — demand is maximally concentrated — yet error docs are almost always absent and unmeasured, so closing the gap deflects a ticket at peak intent. It's unusually measurable because the error universe is *enumerable*: `rg` the emitted error codes, diff against documented ones, and weight the gap by production firing frequency — a true, demand-rankable coverage number, unlike "all possible reader tasks."

8. *Coverage finds absence, not wrongness* — a confidently incorrect, badly stale, or content-free doc scores as fully covered. The two axes that exist because coverage can't reach them: **freshness / rot metrics** (is it still *current*?) and **quality sampling / readability** (is it any *good*?).

</details>

---

## Cheat Sheet

```
THE CORE ANALOGY
  docstring coverage  ≈  line coverage
  both measure   PRESENCE OF AN ARTIFACT, not presence of VALUE
  both gamed by  content-free padding (no-assert test / signature-restating docstring)
  docs are WEAKER: a test can assert; a docstring has no executable claim to check
  use as: FLOOR on absence (catch holes) — never CEILING on quality

FIX THE DENOMINATOR (demand-weighting)
  bad:  documented_symbols / ALL_symbols          (rewards docs on dead code)
  good: Σ(demand_wt × well_documented) / Σ demand_wt
  demand signals: public-API surface · call/import freq · ticket refs
                  · page views / search hits · onboarding-path membership
  invert: not "which symbols lack docs?" but "which THINGS PEOPLE REACH FOR lack docs?"

DEMAND-SIDE GAP DISCOVERY  (no coverage tool can produce these)
  failed site searches (zero-result / zero-click)   ← highest yield, already in your logs
  support tickets a doc could have answered          ← gaps ranked by cost
  Stack Overflow Qs about your product               ← demand that left your docs
  "I couldn't find…" feedback widgets / #docs        ← pre-labeled gaps
  search-then-leave / rage paths                     ← page exists, doesn't answer

DIÁTAXIS COMPLETENESS  (the axis docstrings can't see)
  feature × mode matrix:  Tutorial | How-to | Reference | Explanation
  docstring coverage measures ONE cell (API reference)
  reference-complete + no how-to = severe gap, invisible to symbol tools

MID-TASK GAPS (broken scent trails — EDGES, not nodes)
  missing link to prerequisite · undefined term mid-flow · dead-end fork
  find via: link-graph + task walkthroughs + session analytics, not source scans

ERROR-DOC COVERAGE  (highest-ROI, usually empty, and ENUMERABLE)
  rg -o 'ERR_[A-Z_]+' src/ | sort -u  >  emitted
  rg -o 'ERR_[A-Z_]+' docs/ | sort -u >  documented
  comm -23 emitted documented          ← undocumented; rank by production frequency

COMPOSITE SIGNAL (resists gaming on any single axis)
  1. API-doc presence       (floor)        interrogate / godoc / JSDoc
  2. demand weighting       (denominator)  highest-leverage upgrade
  3. doc-type matrix        (structure)    Diátaxis modes per feature
  4. quality sampling       (value)        demand-weighted human review

THE HONEST LIMIT
  coverage finds ABSENCE, never WRONGNESS or uselessness
  blind to: confidently-wrong · stale-but-present · technically-complete-but-useless
  necessary, NEVER sufficient → pair with freshness + quality sampling
```

---

## Summary

- **Docstring coverage is the documentation analog of line coverage** and inherits every pathology: it measures *presence of an artifact*, not *presence of value*; it's gamed by content-free padding; its number seduces by *feeling* like quality. It's even weaker than line coverage because docs have no assertion to check. Use it as a floor on absence, never a ceiling on quality — it is the weakest signal in this roadmap.
- **The denominator is the deepest flaw.** "% of all symbols" treats every symbol as equally worth documenting, rewarding docs on dead code. Replace it with a **demand-weighted denominator** — public-API surface, call frequency, ticket references — so coverage measures the fraction of *what readers reach for* that's well documented. This is risk-weighting from code-quality dashboards, with reader demand as the risk axis.
- **The strongest gap signal is demand-side: a reader failing, not a tool reporting.** Failed site searches, support tickets, Stack Overflow questions, and "I couldn't find…" feedback find gaps people *actually hit*, pre-ranked by frequency and cost — and no coverage tool can produce any of them, because the gaps aren't missing symbols.
- **Completeness is a feature × Diátaxis-mode matrix.** Docstring coverage measures one cell (API reference). A feature with perfect reference and no how-to has a severe gap that's invisible to symbol tools, because the missing thing is a document *genre*. The mid-task gap — broken information-scent trails: unlinked prerequisites, undefined terms — is worse still, an *edge* in the doc graph that no per-node tool can see.
- **Error-message documentation is the highest-ROI, usually-empty, and unusually-measurable coverage dimension** — maximally demand-concentrated (read at peak frustration, instantly searched), almost always absent, and enumerable via `emitted ∩ documented` weighted by production frequency.
- **A meaningful signal is a composite** — API-doc presence (floor) + demand weighting (denominator) + doc-type matrix (structure) + quality sampling (value) — each closing a loophole the others leave open. And the honest limit holds throughout: **coverage finds absence, never wrongness** — necessary, never sufficient, which is exactly why freshness and quality measurement exist as separate axes.

You now reason about docs coverage as a measurement instrument with known biases, not a target — weighting by demand, modeling completeness structurally, mining gaps from reader behavior, and owning the boundary where coverage stops. The next layer — [professional.md](professional.md) — is about operating these signals across an organization: dashboards teams trust, gates that don't get gamed, and gap analysis wired into the support and search systems that feed it.

---

## Further Reading

- **Laura Inozemtseva & Reid Holmes — *Coverage Is Not Strongly Correlated with Test Suite Effectiveness* (ICSE 2014).** The foundational critique of coverage-as-quality; read it for code, then transpose every argument to docs (where it's stronger).
- **Daniele Procida — Diátaxis ([diataxis.fr](https://diataxis.fr/)).** The four-mode model that turns "completeness" from a percentage into a feature × mode matrix — the structural axis docstring tools can't see.
- **Peter Pirolli & Stuart Card — *Information Foraging* (Psychological Review, 1999).** Information scent and foraging theory; the model behind "the reader was following a trail and it went cold."
- **Adam Tornhill — *Your Code as a Crime Scene*.** Risk-weighting by change frequency × complexity; the code-quality move that demand-weighting transplants into documentation.
- **Bhatti, Corleissen, Lambourne, Nunez & Waters — *Docs for Developers*.** Practical treatment of measuring docs and finding gaps from real reader behavior and feedback.
- **Google's *Measuring documentation quality* writing** (Google Developer Documentation Style Guide and engineering-blog material) — the demand-side, reader-behavior framing applied at scale.
- `interrogate` (Python docstring coverage), `godoc`/`go doc`, JSDoc/TypeDoc coverage — the supply-side tools, with the senior caveat that they measure one cell of one axis.

---

## Related Topics

- [01 — What Makes Docs Good](../01-what-makes-docs-good/senior.md) — the quality attributes and the Diátaxis lens that the doc-type completeness matrix is built on.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/senior.md) — the *currency* axis that exists precisely because coverage finds presence, not staleness.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md) — the same demand-side data (tickets, search) that finds gaps also prices the value of closing them.
- [Code Coverage](../../code-coverage/) — the sibling discipline whose line-vs-mutation critique this whole page transposes onto documentation.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's five-tier set.

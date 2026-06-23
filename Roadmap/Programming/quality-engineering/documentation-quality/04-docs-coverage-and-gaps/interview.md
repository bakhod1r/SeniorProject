# Docs Coverage & Gaps — Interview Questions

> **Roadmap:** [Documentation Quality](../README.md) → Docs Coverage & Gaps
> *A docs-coverage interview rarely asks "do you write docs." It asks "leadership wants 100% docstring coverage — what do you tell them," and then watches whether you can separate* presence *from* usefulness, *count the right denominator, and find the gap your readers are actually hitting instead of the one a linter can see. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Docs Coverage by Analogy](#theme-1--docs-coverage-by-analogy)
3. [Theme 2 — Covered ≠ Good](#theme-2--covered--good)
4. [Theme 3 — Two Kinds of Gap](#theme-3--two-kinds-of-gap)
5. [Theme 4 — Demand-Weighted Coverage](#theme-4--demand-weighted-coverage)
6. [Theme 5 — Demand-Side Gap Discovery](#theme-5--demand-side-gap-discovery)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Policy](#theme-7--policy)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **presence vs usefulness** (a docstring exists vs a docstring that answers the reader's question)
- **supply vs demand** (what you happened to document vs what people actually need)
- **per-symbol gap vs missing-type gap** (this function lacks a doc vs your docs have no tutorial *at all*)
- **the metric vs the goal** (a coverage percentage vs a reader who succeeds unaided)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a number. The single sharpest move available on this whole page is the **coverage ≠ good** analogy — that docstring coverage is to documentation what line coverage is to testing — and using it correctly, with its limits, separates a senior answer from a junior one.

---

## Theme 1 — Docs Coverage by Analogy

### Q1.1 — What is "documentation coverage," and how would you actually measure it?

> **Testing:** Whether you have a concrete, tool-level model, or just a vibe.

**A.** By analogy to *test* coverage: it's the fraction of some documentable surface that has documentation attached. The most common, tooling-friendly form is **docstring coverage** — what percentage of public symbols (functions, classes, methods, modules) carry a docstring or doc comment. You measure it with the same kind of tool you'd use for lint:
- **Python:** `interrogate` (or `docstr-coverage`) walks the AST, counts public defs, reports the percentage and which symbols are bare.
- **JS/TS:** `eslint-plugin-jsdoc`'s `require-jsdoc` rule, or a TypeDoc validation pass that flags exported symbols with no doc comment.
- **Go:** `golint`/`revive` historically flagged exported identifiers with no doc comment; the convention is enforced at review time.
- **Java/Kotlin:** Javadoc with `-Xdoclint`, or a Detekt rule.

The key framing: docstring coverage measures *presence* of a doc comment on an API symbol. It's cheap, deterministic, and gateable in CI — which is exactly why it's seductive and exactly where the trap is. It tells you a doc *exists*; it tells you nothing about whether it's *useful*.

### Q1.2 — Walk me through the analogy between docstring coverage and line coverage. Where does it hold?

> **Testing:** Whether you can reason by structural analogy rather than slogan.

**A.** Both are **surface-presence metrics over a denominator of code symbols**, computed by a static tool, expressible as a single percentage, and trivially gateable in CI. The analogy holds tightly on the *mechanics*:
- Line coverage: "was this line executed by *some* test?" → 80% means 20% of lines never ran under test.
- Docstring coverage: "does this symbol have *some* doc comment?" → 80% means 20% of public symbols are bare.

In both, the metric is a **proxy for a quality you actually care about** (tests that catch regressions; docs that answer questions) and in both the proxy is satisfiable *without* the underlying quality. A line can be "covered" by a test with no assertions; a symbol can be "covered" by a docstring that restates its name. That's the load-bearing part of the analogy and the reason the next theme exists.

### Q1.3 — Is there any version of docs coverage that *isn't* docstring coverage?

> **Testing:** Whether you see the symbol-level metric as one slice of a bigger surface.

**A.** Yes — docstring coverage is just the easiest surface to count. Other coverage surfaces:
- **Feature/page coverage** — does every user-facing feature have *a* page in the docs site? (Tracked by an inventory checklist, not a linter.)
- **Diátaxis-type coverage** — does each major area have all four doc *types* (tutorial, how-to, reference, explanation)? More on this in Theme 3.
- **Example coverage** — does every public function have at least one runnable example? (Go's `Example` functions, doctests.)
- **Parameter/return coverage** — within a docstring, are all params and the return value documented? (`interrogate` and `darglint` can check this.)

The reason interviews fixate on *docstring* coverage is that it's the one with off-the-shelf CI tooling, which makes it the one teams over-trust. A senior answer treats it as a floor on one surface, not the whole picture.

---

## Theme 2 — Covered ≠ Good

### Q2.1 — A repo reports 100% docstring coverage. Are its docs good? Defend your answer.

> **Testing:** The single most important distinction in this whole topic.

**A.** No — 100% docstring coverage tells you every public symbol has *some* doc comment, nothing more. It's the documentation equivalent of **100% line coverage with no assertions**: the tool is satisfied, the quality may be absent. The classic failure is the docstring that restates the signature:

```python
def get_user_by_id(user_id: str) -> User:
    """Get user by id."""          # 100% "covered", 0% informative
```

That docstring adds no information the name and signature didn't already carry. What a reader actually needs — *what happens when the id is unknown (None? raise? empty?), whether it hits the DB or cache, whether `user_id` is the public id or the internal PK, what permissions are required* — is exactly what a presence metric can't see. So "100% covered" and "well documented" are independent properties. The metric measures the first and is routinely mistaken for the second.

### Q2.2 — Give me the canonical example of a "covered but worthless" comment, and explain *why* it's worthless.

> **Testing:** Whether you can articulate the noise cost, not just recognize bad comments.

**A.** The redundant restatement:

```python
i += 1   # increment i
user.id  # the id
```

It's worthless on two counts. First, it carries **zero information beyond the code** — the code already says `i += 1`; the comment is a checksum that adds reading cost and nothing else. Second, and worse, it's a **future lie**: redundant comments drift out of sync because nobody updates the "obvious" comment when the code changes, so `// returns the id` survives a refactor that made it return the *email*. A coverage gate that rewards *any* comment actively *incentivizes* this noise — engineers pad bare symbols with restatements to make the number go green. So the metric doesn't just fail to measure quality; pursued naïvely, it *manufactures negative-value text*. Good documentation explains the **why** and the **non-obvious** (constraints, edge cases, units, invariants); a coverage gate is blind to whether the comment did that.

### Q2.3 — So a leader says "let's gate the build on 100% docstring coverage." Why is that the same mistake as gating on 100% line coverage?

> **Testing:** Whether you can transfer the well-known testing critique onto docs, precisely.

**A.** It's the *identical* mistake: you're hard-gating on a **proxy metric that's satisfiable without the underlying quality**, which makes people optimize the proxy. With 100% line coverage you get assertion-free tests and tests written to touch lines rather than catch bugs — Goodhart's law ("when a measure becomes a target, it ceases to be a good measure"). With 100% docstring coverage you get `"""Get user by id."""` on everything: the gate is green, the docs got *worse* because now there's noise to wade through, and you've spent reviewer energy enforcing it. In both cases the last mile — 80%→100% — is where the cost explodes and the value is lowest, because the remaining symbols are often the ones where a one-line stub is genuinely all that's warranted (trivial getters, `__repr__`), so you're forcing text where text isn't the point. The correct posture is the same as for tests: use the number as a **low-bar signal and a trend**, gate only the *new* surface, and never confuse the percentage with the goal.

### Q2.4 — If coverage doesn't measure quality, why measure it at all?

> **Testing:** Whether you over-rotate into nihilism, or keep the metric in its lane.

**A.** Because *absence* is still a real, cheap-to-detect signal, even if presence isn't a quality signal. A symbol with **no** doc is a guaranteed gap; the tool finds those for free and that's worth having. Coverage is useful as:
- A **ratchet** — "don't let it drop" prevents silent erosion as the codebase grows.
- A **trend** — a falling number on a fast-growing module flags docs debt accumulating.
- A **floor on new public API** — the one place a hard gate is defensible (Theme 7).

The discipline is to treat it like line coverage: a *necessary-not-sufficient* hygiene metric. Low coverage is informative (you have bare symbols); high coverage is *not* informative (it could be 100% restatements). So you watch it, you gate narrowly, and you measure *quality* with different instruments entirely — reader success, support-ticket volume, time-to-first-success — which is what Themes 4 and 5 are about.

---

## Theme 3 — Two Kinds of Gap

### Q3.1 — There are two fundamentally different kinds of documentation gap. Name them.

> **Testing:** Whether you see beyond per-symbol holes to missing doc *categories*.

**A.** **Per-symbol gaps** and **missing doc-type gaps**, and they're found by completely different means.
- A **per-symbol gap** is a hole *within* an existing surface: this function has no docstring, this parameter is undocumented, this endpoint has no example. A linter (`interrogate`, `eslint-plugin-jsdoc`) finds these mechanically.
- A **missing doc-type gap** is a *whole category of documentation that doesn't exist*: your reference docs are 100% covered but there is **no tutorial at all**, or no how-to guides, or no architectural explanation. No docstring linter can see this gap, because every symbol it checks is documented — the hole is at a level the tool doesn't model.

The trap is that a team obsessing over docstring coverage can hit 100% and still be *catastrophically* under-documented, because they've perfected one doc type and shipped zero of the other three. The second kind of gap is usually the more damaging one and the harder one to see.

### Q3.2 — What's the Diátaxis completeness matrix, and how do you use it to find type gaps?

> **Testing:** Whether you have a structured framework for the second kind of gap.

**A.** [Diátaxis](https://diataxis.fr) splits documentation into four types along two axes (study vs work; practical vs theoretical):

| | Practical steps | Theoretical knowledge |
|---|---|---|
| **Learning** (study) | **Tutorial** — learning-oriented, hand-held first success | **Explanation** — understanding-oriented, the "why" and design |
| **Working** (use) | **How-to** — goal-oriented recipes for a task | **Reference** — information-oriented, precise API facts |

You use it as a **completeness matrix**: for each major product area, ask "do we have all four?" The pathology it exposes immediately is the one above — most engineering teams have strong *Reference* (it's adjacent to code and a linter nags for it) and a gaping hole where the *Tutorial* should be (it's the hardest to write and nothing nags for it). So the matrix turns an invisible gap ("our docs feel bad but coverage is 100%") into a visible, fillable checklist ("we have reference and how-tos for the payments API but no tutorial and no explanation of the retry model"). It's the canonical tool for the *missing-type* gap precisely because docstring coverage is structurally blind to it.

### Q3.3 — Your reference docs are at 95% docstring coverage and readers still complain. Which gap is it, and what do you do?

> **Testing:** Whether you can diagnose *which* kind of gap from a symptom.

**A.** Almost certainly a **missing doc-type gap**, not a per-symbol one — 95% reference coverage means the *reference* surface is nearly complete, so the complaints aren't "this function is undocumented," they're "I can't get started" or "I don't understand how this fits together." That's a missing **tutorial** (onboarding pain) or missing **explanation** (mental-model pain). I'd confirm by reading the actual complaints/tickets (Theme 5) rather than guessing: failed onboarding and "where do I even begin" point to a missing tutorial; "why does it work this way / what's the right way" points to missing explanation. The fix is to *write the missing type*, not to push reference coverage from 95% to 100% — that last 5% is the lowest-value work available here and would not touch the complaint at all. This is the most common real-world version of confusing the two gap kinds.

---

## Theme 4 — Demand-Weighted Coverage

### Q4.1 — Two modules both sit at 60% docstring coverage. Are they equally under-documented?

> **Testing:** Whether you weight gaps by reader demand or treat all symbols as equal.

**A.** No — raw coverage treats every symbol as equally important, which is almost never true. A flat 60% hides everything that matters: *which* 40% is undocumented. If module A is your public SDK entry point that every consumer touches and the bare 40% is its core API, that's a five-alarm gap. If module B is an internal utility called once, and the bare 40% is private helpers, the gap is nearly irrelevant. The right mental model is **demand-weighted coverage**: weight each symbol's gap by how much it's actually *used* or *read*, so the metric reflects reader pain rather than symbol count. A 60% that covers the 95% most-used surface is fine; a 95% that leaves the single most-called function bare is a worse experience despite the higher number. Coverage averaged over symbols is the wrong denominator; it should be averaged over *demand*.

### Q4.2 — Concretely, how would you compute or approximate demand-weighted coverage?

> **Testing:** Whether "demand-weighted" is a real proposal or hand-waving.

**A.** Approximate **demand** with signals you already have, then weight each symbol's documented/undocumented bit by it:
- **For a library/SDK:** static import/call frequency across the org's own monorepo, or download/usage telemetry per public symbol — the functions most consumers actually call get the highest weight.
- **For a service API:** request volume per endpoint from the gateway/logs — document the top endpoints by traffic first.
- **For a docs site:** page views and search hits — the symbols/topics readers land on most.

Then `weighted_coverage = Σ(weight_i · is_documented_i) / Σ(weight_i)`. The output is a number that *moves when you document something people use* and barely moves when you document a dead corner — the opposite of flat coverage, which rewards padding obscure symbols because they're easy. You don't need this to be exact; even a crude "top 50 most-used public symbols, are they all well-documented?" beats a precise org-wide flat percentage for deciding what to write next.

### Q4.3 — Doesn't weighting by demand mean obscure-but-critical APIs (disaster recovery, security toggles) get neglected?

> **Testing:** Whether you understand the failure mode of pure usage-weighting.

**A.** Yes, and that's the real limitation: **demand ≠ importance**. Pure usage-weighting under-serves the **rare-but-high-stakes** surface — the disaster-recovery runbook, the `force_delete=True` flag, the security-config knob — precisely *because* it's used rarely, even though a mistake there is catastrophic and the reader is usually under stress with no time to reverse-engineer. So demand-weighting is the right default for prioritizing the *bulk* of docs, but it needs an override for a small **criticality** set: anything in the destructive/security/recovery path gets documented thoroughly regardless of traffic. The mature framing is *weight by demand, then floor by blast-radius* — most of your effort follows the readers, but a deliberate carve-out protects the low-frequency, high-consequence paths that usage stats will always under-rank.

---

## Theme 5 — Demand-Side Gap Discovery

### Q5.1 — How do you find the gaps in your docs that *no linter can see*?

> **Testing:** Whether you look at the demand side — what readers tried and failed to find.

**A.** You stop measuring *supply* (what's documented) and start measuring *demand that went unmet*. The richest signals are the traces readers leave when the docs failed them:
- **Failed/zero-result searches** in your docs site and internal search — every empty-result query is a reader telling you exactly what they expected to find and didn't. This is the single highest-signal gap source.
- **Support tickets and their tags** — recurring questions are documentation gaps with a customer attached; a question asked five times is a missing how-to, not five tickets.
- **The "ask in Slack" channel** — questions engineers ask each other instead of finding in docs; the repeat questions are your missing pages.
- **Undocumented error messages** — every error a user can hit that has no corresponding doc/search hit is a guaranteed gap at the worst possible moment (covered next).
- **Drop-off in onboarding/tutorials** — the step where new users abandon is a gap or a defect in that step.

The unifying idea: a linter sees *your* model of what should be documented; these signals see *the reader's* model of what they needed. The gaps that hurt live in the difference, and they're invisible from the supply side.

### Q5.2 — Why are undocumented *error messages* singled out as a gap signal?

> **Testing:** Whether you grasp why error-time gaps are uniquely costly.

**A.** Because an error message is a reader arriving at your docs **in the worst possible state** — something is already broken, they're blocked, often in production, often under time pressure — and it's also the most *targeted* possible query: they know the exact string. If pasting that error into your search or docs returns nothing, you've failed the reader at peak need. Three things make this the highest-ROI gap class:
1. **Demand is guaranteed and self-selecting** — people only search an error when they've actually hit it, so every documented error pays off against real, motivated traffic.
2. **The query is exact** — the error string is a perfect key; you can literally enumerate every error your code emits and check each has a hit.
3. **It's enumerable from the code** — unlike "what tutorial is missing," you can grep your codebase for every raised error / error code and mechanically diff against your docs to find the undocumented ones.

So "every error message a user can see should be findable and explained, with cause and fix" is both the highest-value and the most *systematically closeable* gap most teams have. It's the rare demand-side gap you can attack with a checklist.

### Q5.3 — How would you operationalize failed searches into a gap backlog?

> **Testing:** Whether you can turn a signal into a repeatable process, not a one-off audit.

**A.** Make it a standing pipeline, not a heroic audit:
1. **Instrument** docs-site and internal search to log queries and result counts (most engines — Algolia DocSearch, internal Elastic — already do).
2. **Aggregate weekly** the top zero-result and low-click queries; dedupe near-synonyms ("auth token" / "api key" / "bearer token" are one gap).
3. **Triage** the ranked list into the backlog the same way you triage bugs — a query searched 200×/week with no result is a P1 doc gap; the long tail is noted, not chased.
4. **Close the loop** — after writing the page, watch that query's result-rate and click-through recover; if it doesn't, the page exists but isn't *findable* (a search/SEO/titling gap, a different fix).
5. **Assign an owner** so it's someone's job, not a quarterly cleanup (Theme 7).

The point is that demand-side gap discovery is a *continuous measurement* of the difference between what readers ask and what you've answered — the docs analog of monitoring error rates in prod, not the docs analog of a one-time coverage scan.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — You inherit a large product. How do you find your docs' *biggest* gaps, fast?

> **Testing:** Whether you go demand-first or waste weeks on a supply-side audit.

**A.** I go **demand-first**, because the biggest gaps are defined by readers, not by my model of completeness:
1. **Pull the failed-search log and support-ticket tags** — within an hour this tells me the top recurring unmet needs, ranked by real frequency. That's the gap list, pre-prioritized by demand.
2. **Enumerate user-visible error messages from the code and diff against docs/search hits** — a mechanical, high-yield pass that finds error-time gaps with guaranteed demand.
3. **Run the Diátaxis matrix over the top product areas** — catch the *missing-type* gaps (no tutorial, no explanation) that no per-symbol tool reports.
4. *Then, and only then,* glance at docstring coverage — as a hygiene floor, not a priority signal.

I deliberately do **not** start by chasing docstring coverage to 100%, because that optimizes supply of the easy surface while the painful gaps — onboarding, errors, the missing tutorial — sit untouched. The whole move is to let *measured reader demand* set the order, and use coverage only to catch silent absence at the margins.

### Q6.2 — Leadership mandates 100% docstring coverage as a quality KPI. What do you tell them?

> **Testing:** Whether you can push back with substance and offer a better metric, not just say no.

**A.** I'd agree with the *intent* (docs matter, let's measure) and redirect the *mechanism*, because a 100% docstring gate optimizes the wrong thing. The argument, briefly:
- **It's the line-coverage trap.** 100% docstring coverage is satisfiable with `"""Get user by id."""` on every symbol — green gate, zero added value, and we'll have *manufactured noise* that drifts into lies. We'd be paying review cost to make docs slightly worse.
- **It's blind to the gaps that actually hurt.** It can read 100% while we have *no tutorial*, undocumented error messages, and a top support question with no page. Those are where readers fail, and a docstring gate can't see any of them.
- **The last mile is the worst ROI.** 80%→100% forces text onto trivial getters and `__repr__` where a stub is genuinely the right amount.

Then I offer the trade: **gate new public API at a sane floor** (so we never *add* an undocumented public symbol), **track total coverage as a no-drop ratchet**, and put the real KPI on **reader outcomes** — failed-search rate trending down, time-to-first-success, top-ticket deflection, error-message doc coverage. Same goal (good docs), a target people can't game into noise, pointed at the gaps that cost us money.

### Q6.3 — What's the single highest-ROI documentation gap most teams have, and why that one?

> **Testing:** Whether your prioritization instinct matches where reader pain concentrates.

**A.** Two contenders, both demand-side, and I'd name them in order. First, **undocumented error messages** — guaranteed motivated traffic, an exact-match query, and *enumerable from the code*, so it's the rare high-value gap you can close with a checklist; every error a user can hit should be findable with cause and fix. Second, the **quickstart / first tutorial** — the "from zero to first success in 10 minutes" path. Most teams have rich reference (a linter nags for it) and *no* hand-held tutorial (nothing nags for it, and it's the hardest to write), so it's simultaneously the highest-demand surface — *every* new user hits it — and the most commonly missing one. Both beat "raise docstring coverage" by a wide margin because they're where the largest number of readers fail, whereas the marginal undocumented private helper is read by almost no one. The through-line: highest ROI = highest reader demand × current emptiness, and those two gaps maximize that product.

### Q6.4 — A team is proud of 100% docstring coverage. In a review, how do you show them it isn't enough — without being dismissive?

> **Testing:** Influence and evidence, not just being right.

**A.** I'd make the gap *visible with their own readers' data* rather than argue from principle. Concretely: pull three real support tickets or failed searches against their product and ask the team to find the answer *in their docs* live. When the 100%-covered docs can't answer a question a real user asked, the point makes itself — and it reframes "coverage" from an achievement into "we covered the *symbols*; here's what *readers* still can't do." Then I'd run the Diátaxis matrix with them and let them notice the empty tutorial/explanation cells themselves. The tone matters: 100% coverage is genuinely *good hygiene* and I'd say so — the message isn't "your work is worthless," it's "you've finished the measurable surface; the remaining gaps are real but invisible to the tool you used, so let's measure the demand side too." Showing beats telling, and crediting the hygiene they did keeps it collaborative.

### Q6.5 — Your docs site shows 4,000 zero-result searches/month for "how to delete my account." There's a `DELETE /account` reference entry. What's going on and what do you do?

> **Testing:** Whether you distinguish "documented" from "findable/usable," and read demand correctly.

**A.** This is the gap between **presence and discoverability**, and possibly a doc-*type* mismatch. The fact *exists* in reference (`DELETE /account`), but 4,000 people phrasing it as a *task* ("how to delete my account") aren't finding it — so it's failing on two axes: it's indexed under an API-shaped title, not the user's words (a **findability** gap — synonyms, titling, search tuning), and the reader wanted a **how-to** (goal-oriented: "to close your account, do X; note it's irreversible, exports first"), not a bare endpoint reference. The fix isn't "we already documented it"; it's (1) write the how-to in the reader's language, (2) make the existing reference findable for that query, and (3) watch the zero-result rate for that term drop to confirm. The deeper lesson is that 4,000 unmet searches against a *covered* topic is the perfect illustration that coverage ≠ findable ≠ useful — the demand signal caught a gap the coverage metric reported as filled.

---

## Theme 7 — Policy

### Q7.1 — If you're going to gate docs in CI at all, what exactly should the gate check?

> **Testing:** Whether your gating policy targets the one place a hard gate is defensible.

**A.** Gate **new public API only**, not the whole repo. The defensible rule is: a PR that *adds or changes a public/exported symbol* must include a doc comment for it (and, ideally, document its params and the user-visible errors it can raise). This works where a blanket gate fails because:
- It's a **floor on the highest-demand surface** — public API is what consumers read — without forcing text onto trivial internals.
- It **catches the gap at creation**, when the author has the most context and it's cheapest, instead of as a retroactive cleanup.
- It **doesn't punish legacy** — you're not blocking the build over the existing 40% of bare private helpers; you're stopping the bleed.

Pair it with a **no-drop ratchet** on total coverage (the number may not decrease) so existing docs don't silently erode. What I would *not* do is hard-gate the whole repo at 100% or gate on private symbols — that's the line-coverage trap and it manufactures the restatement noise from Theme 2. Gate the new public surface; ratchet the rest; measure quality elsewhere.

### Q7.2 — Docs gaps are "everyone's job," so they're nobody's. How do you assign gap ownership?

> **Testing:** Whether you make docs an owned, accountable surface rather than a guilt-driven volunteer effort.

**A.** Unowned docs rot — "everyone's responsibility" is the diffusion-of-responsibility anti-pattern. I'd assign ownership at two levels:
- **Per-area owners.** Each major doc area (or product surface) has a named owning **team**, the same way code has owners — ideally via `CODEOWNERS` so doc changes route to them and the gap backlog for that area is theirs. The team that owns the code owns its docs; docs aren't a separate department's cleanup duty.
- **Gap backlog with assignees.** The demand-side gap list (failed searches, recurring tickets, undocumented errors) is a real backlog with triaged, *assigned* items and due dates — not a wiki of good intentions. A P1 doc gap (top failed search, undocumented destructive-action error) gets an owner and a deadline like any P1 bug.

And critically, **bake authorship into the workflow that already exists**: the PR that ships a feature ships its docs (tied to the Q7.1 gate), so docs are produced by the person with the most context at the moment of change, not reconstructed later by someone guessing. Ownership + demand-driven backlog + docs-in-the-PR is what turns "nobody's job" into a maintained surface.

### Q7.3 — How do you keep a docs-coverage or gap program from becoming a vanity-metric theater?

> **Testing:** Whether you can keep metrics honest and outcome-tied over time.

**A.** Anchor every metric to a **reader outcome** and review it like an SLO, so the number can't drift into theater:
- **Pair each supply metric with a demand metric.** Coverage (supply) only ever appears next to failed-search rate or ticket-deflection (demand). If coverage rises while failed searches don't fall, the coverage work was theater — and the pairing makes that visible.
- **Make the headline metric one people can't game into noise.** "Time-to-first-success" and "top-20 failed searches resolved" can't be satisfied by restatement docstrings, unlike a raw percentage.
- **Review trends, not absolutes.** A no-drop ratchet and a falling failed-search trend beat a framed "100%" on a slide.
- **Close loops publicly.** When a documented page actually drops its zero-result query rate, that's the win to celebrate — it ties the work to the reader, which is the entire point and the thing vanity metrics forget.

The governing principle is the same one under this whole topic: measure the proxy if it's cheap, but *gate and celebrate the goal* — a reader who succeeds unaided — so nobody mistakes a green percentage for a documented product.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What does docstring coverage actually measure?** A: The fraction of public symbols that have *some* doc comment — presence, not usefulness.
- **Q: Name a docstring-coverage tool.** A: `interrogate` or `docstr-coverage` (Python); `eslint-plugin-jsdoc`'s `require-jsdoc` (JS/TS).
- **Q: Why is 100% docstring coverage like 100% line coverage?** A: Both are presence proxies satisfiable without the underlying quality — green gate, possibly worthless content.
- **Q: One sentence on why redundant comments are *negative* value?** A: They add reading cost and drift into lies because nobody updates the "obvious" comment.
- **Q: The two kinds of doc gap?** A: Per-symbol holes (linter-findable) and missing doc *types* (linter-blind).
- **Q: What framework finds missing doc *types*?** A: The Diátaxis completeness matrix — tutorial / how-to / reference / explanation.
- **Q: Which Diátaxis type is most often missing on eng teams?** A: The tutorial (and explanation) — reference is over-served because it's adjacent to code.
- **Q: What is demand-weighted coverage?** A: Weighting each symbol's doc gap by how much it's actually used/read, so the metric tracks reader pain.
- **Q: The flaw in pure demand-weighting?** A: It under-serves rare-but-critical paths (DR, security toggles); floor those by blast-radius.
- **Q: Highest-signal demand-side gap source?** A: Failed/zero-result searches — readers telling you exactly what they couldn't find.
- **Q: Why are undocumented error messages the highest-ROI gap?** A: Guaranteed motivated traffic, exact-match query, and enumerable from code.
- **Q: Where is a hard docs gate defensible?** A: On *new public API only*, plus a no-drop ratchet on total coverage.
- **Q: One reason "everyone owns docs" fails?** A: Diffusion of responsibility — unowned docs rot; assign per-area owners via CODEOWNERS.
- **Q: How do you keep a coverage program honest?** A: Pair every supply metric with a demand/outcome metric and gate on the outcome.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Equating high docstring coverage with good documentation.
- Endorsing a 100% coverage gate with no mention of the line-coverage / Goodhart trap.
- Thinking a linter can find *all* doc gaps — missing the doc-*type* gap entirely.
- Treating every symbol as equally worth documenting (no notion of demand or criticality).
- Looking only at the supply side; never mentioning failed searches, tickets, or error messages.
- "We documented it" as a closed-case answer when readers still can't find or use it.
- Leaving docs as "everyone's job" with no owner or backlog.

**Green flags:**
- Naming the *distinction* (presence vs usefulness, supply vs demand) before reaching for a number.
- Deploying the coverage ≠ good analogy *and* its limits (absence is still a real signal).
- Reaching for the Diátaxis matrix to surface missing doc *types*.
- Prioritizing by demand-weighting, with a blast-radius floor for rare-but-critical paths.
- Going demand-first — failed searches, tickets, undocumented errors — to find the real gaps.
- Singling out error-message coverage as enumerable, guaranteed-demand, high-ROI.
- Gating only new public API, ratcheting the rest, and measuring quality with reader-outcome metrics.
- Assigning gap ownership and baking docs into the PR that ships the feature.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **presence vs usefulness**, **supply vs demand**, **per-symbol gap vs missing-type gap**, and **the metric vs the goal**. Name the distinction first; the number follows.
- **Coverage by analogy:** docstring coverage (`interrogate`, `eslint-plugin-jsdoc`, doclint) measures the *presence* of a doc comment on a symbol — cheap, deterministic, gateable, and exactly as limited as line coverage.
- **Covered ≠ good:** 100% docstring coverage is the no-assertion-100%-line-coverage of docs — satisfiable with `"""Get user by id."""`, which is *negative* value (noise that drifts into lies). Gating on it is the same Goodhart mistake. Measure coverage for *absence*; measure quality elsewhere.
- **Two gap kinds:** per-symbol holes (linter-findable) vs missing doc *types* (linter-blind). The Diátaxis completeness matrix finds the second — usually the missing tutorial — which is the more damaging and harder-to-see gap.
- **Demand-weighted coverage:** weight each gap by real usage (imports, traffic, page views) so the metric tracks reader pain, not symbol count — then floor by blast-radius so rare-but-critical paths aren't neglected.
- **Demand-side discovery:** the real gaps live in failed searches, support tickets, and undocumented error messages — the difference between the reader's model and yours. Error-message coverage is the highest-ROI gap: guaranteed demand, exact query, enumerable from code.
- **Policy:** gate *new public API only* with a no-drop ratchet, assign gap ownership (CODEOWNERS + a triaged demand-driven backlog), bake docs into the shipping PR, and headline the program on reader outcomes so it never becomes vanity-metric theater.

---

## Further Reading

- [Diátaxis](https://diataxis.fr) (Daniele Procida) — the four-type framework and the completeness matrix behind the missing-doc-*type* gap.
- *interrogate* and *docstr-coverage* docs — what docstring-coverage tools actually count, and where their reports stop.
- Google's [Documentation best practices](https://google.github.io/styleguide/docguide/best_practices.html) and *Software Engineering at Google* (docs chapter) — docs-as-an-owned-surface and demand-driven authorship at scale.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — Testable and Executable Docs](../02-testable-and-executable-docs/interview.md) — doctests and runnable examples, the quality side of what coverage only counts the presence of.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/interview.md) — the reader-outcome metrics (time-to-first-success, ticket deflection) this page redirects coverage toward.
- [Documentation Quality README](../README.md) — where coverage and gaps sit in the broader docs-quality landscape.

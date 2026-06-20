# Readability & Information Architecture — Professional Level

> **Roadmap:** [Documentation Quality](../README.md) → Readability & Information Architecture
> *The senior page taught you the levers: plain language, progressive disclosure, an IA that mirrors how readers think. This page is about pulling those levers across a docs estate with fifty writers, three acquired wikis, a localization budget, and a support queue that bills every unfindable answer to your team — where "is this readable?" stops being a copy-edit and becomes a program with an owner, a CI gate, and a number someone will try to game.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Style-as-Code: Enforcing Readability at Scale with Vale in CI](#style-as-code-enforcing-readability-at-scale-with-vale-in-ci)
4. [What to Lint vs What Needs a Human](#what-to-lint-vs-what-needs-a-human)
5. [The Localization Angle: Controlled Language as a Cost Lever](#the-localization-angle-controlled-language-as-a-cost-lever)
6. [Information Architecture as an Owned Discipline](#information-architecture-as-an-owned-discipline)
7. [Validating IA with Real Users](#validating-ia-with-real-users)
8. [The Readability/IA ROI](#the-readabilityia-roi)
9. [Governance Pitfalls: How Readability Programs Get Gamed](#governance-pitfalls-how-readability-programs-get-gamed)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Readability and information architecture as an organization-scale program — enforced in CI, owned by a team, validated with real users, and defended against its own metrics.**

The senior page framed readability and IA as craft decisions an experienced writer makes per page. At the professional level those same decisions show up in different meetings: a docs set written by fifty people that reads like fifty people wrote it, because there's no enforced house style; a localization invoice that's 30% higher than it should be because the source English is needlessly complex; a support manager pointing at a ticket category — "users can't find the thing that's documented" — and asking why the docs team isn't deflecting it; an acquired product whose wiki you just inherited, with its own taxonomy, its own search, and three pages that contradict yours.

None of these are new *concepts* — they're the readability and IA principles from the earlier tiers, now multiplied by headcount, a translation budget, a support P&L, and a sprawling estate nobody owns end-to-end. The skill here is building the *systems* that hold those principles in place when no single editor can read every page: style enforced as code, IA owned as a discipline, findability validated as an ongoing instrument rather than a launch-day guess. And — the part that separates seniors from staff — knowing which of those systems quietly destroy quality when you point them at a target. This page is the pragmatic, battle-tested layer: how to run readability and IA as a program, and how to keep the program from gaming itself.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — plain language, progressive disclosure, minimalism, the limits of readability scores, IA as a model of the reader's mental model.
- **Required:** You've written or maintained docs that other people had to edit, and felt the pain of inconsistent voice across authors.
- **Helpful:** You've owned or contributed to a CI pipeline and understand opt-in-then-enforce rollout patterns.
- **Helpful:** You've watched a support queue and seen "the answer exists but nobody found it" tickets.
- **Helpful:** You've worked with a localization vendor, or paid a per-word translation bill.

---

## Style-as-Code: Enforcing Readability at Scale with Vale in CI

A style guide that lives in a PDF is a style guide nobody applies consistently. With fifty contributors, "use sentence case in headings," "don't say *simply*," "write *select*, not *click on*," and "second person, active voice" are followed by whoever happened to read the guide last quarter. The result is a docs set that's individually fine and collectively incoherent — the reader feels the seams.

**Vale** turns the style guide into executable rules. It's a syntax-aware prose linter: it parses Markdown/AsciiDoc/reStructuredText, ignores code blocks and inline code, and applies rules expressed as YAML. A house style guide becomes a versioned package of rules that runs on every commit, the same way a code linter does.

```yaml
# styles/House/Simply.yml — flag hand-wavy words that hide complexity
extends: existence
message: "Avoid '%s' — it dismisses the reader's difficulty. Show the step instead."
level: warning
ignorecase: true
tokens:
  - simply
  - just
  - easily
  - obviously
  - of course
```

```yaml
# styles/House/Headings.yml — enforce sentence-case headings
extends: capitalization
message: "Headings use sentence case: '%s'."
level: error
scope: heading
match: $sentence
```

```ini
# .vale.ini — wire it up
StylesPath = styles
MinAlertLevel = warning

[*.md]
BasedOnStyles = Vale, House
# borrow battle-tested rule packs instead of writing everything yourself
# (Microsoft Writing Style Guide, Google developer style, write-good, proselint)
```

```yaml
# CI: fail the build on errors, surface warnings as review comments
- name: Vale
  uses: errata-ai/vale-action@reviewdog
  with:
    reporter: github-pr-review
    fail_on_error: true
```

The **rollout pattern is opt-in, then enforce** — and getting this order wrong is how style programs die. If you switch on a hundred rules at `error` against an existing corpus, the first PR drowns in thousands of alerts, everyone learns to ignore Vale, and the program is dead on arrival. Instead:

1. **Baseline at `warning`** — run Vale across the whole estate, see what the corpus actually violates, and tune the rules before anyone is blocked.
2. **Enforce on the diff, not the world** — gate only *changed* lines (reviewdog's `github-pr-review` reporter does this), so contributors fix what they touch and the corpus improves incrementally rather than demanding a giant cleanup PR nobody will own.
3. **Promote rules to `error` selectively** — start with the handful of unambiguous, high-value rules (sentence-case headings, banned-word list, the product's spelling of its own features) and graduate more only as the corpus and the team adapt.

The win is **comparability and consistency**: when fifty writers ship against the same enforced rule set, a reader can't tell who wrote which page. Voice stops being a function of who held the pen. New contributors get the style guide as *immediate, located feedback on their own draft* — "don't say *simply* on line 40" teaches faster than a wiki page they'll never open. And the senior editors stop spending their review budget on mechanical nits (terminology, casing, banned words) and spend it on the things only a human can judge.

> **The professional reality:** style-as-code isn't about a robot writing your docs. It's about moving the consistency floor from "whoever edited last" to "every commit," so the expensive human attention goes to structure and clarity instead of hunting for the word *simply* for the thousandth time. Vale doesn't make prose good; it makes prose *consistent*, and frees humans to make it good.

---

## What to Lint vs What Needs a Human

The fastest way to discredit a readability program is to lint the unlintable. A linter is a pattern matcher; it has no model of meaning. Point it at things that require judgment and it produces false positives, contributors learn to suppress it, and the rules you actually needed get ignored along with the noise.

| Lint it (mechanical, rule-shaped) | Needs a human (requires meaning) |
|---|---|
| Banned/weasel words (*simply*, *just*, *easily*) | Whether the explanation is actually *correct* |
| Terminology consistency (one approved spelling per concept) | Whether the page answers the reader's real question |
| Heading case, list parallelism, oxford comma | Whether the structure matches the task's flow |
| Second person, present tense, active-voice heuristics | Whether an example is the *right* example |
| Passive-voice *detection* (flag for review) | Whether a passive sentence is the better choice here |
| Sentence/paragraph length *over a generous ceiling* | Whether the prose has rhythm and isn't robotic |
| Latin abbreviations, "click here" link text, TODO markers | Whether the page should exist at all |
| Spelling, product-name casing, deprecated-term usage | Audience fit, tone, and whether it's *kind* to the reader |

The dividing line is simple: **lint what has one defensible answer; route everything else to a human.** Terminology has one answer (you picked it). Whether a sentence is *clear* does not — it depends on the audience and the surrounding context, which the linter can't see. Treat Vale's grammar-ish rules (passive voice, sentence length) as `suggestion`/`warning` prompts for the author's judgment, never as `error` gates, precisely because their "violations" are frequently the right call.

A useful mental split: **Vale enforces the style guide; human review enforces the *content*.** The two are complementary, not redundant. The linter clears the mechanical debris so the reviewer can see — and afford to focus on — the substance. A team that lints terminology and casing finds its human review *more* valuable, because the reviewer is no longer drowning in nits and can engage with whether the page is true, complete, and findable.

> **The discipline:** every rule you promote to `error` is a claim that there is exactly one correct answer and a machine can recognize it. Most readability questions fail that test. Lint the mechanical, keep the gate narrow, and protect human attention for the judgment calls — that's what keeps the program credible enough to survive.

---

## The Localization Angle: Controlled Language as a Cost Lever

Readability has a hard-dollar driver that pure-English shops miss: **your source text is the input to every translation.** If you ship docs in even a handful of languages, the complexity, ambiguity, and inconsistency of your English propagates into every locale — and you pay for it per word, per language, every release.

**Controlled language** — a constrained subset of English with simplified syntax, a single approved term per concept, short declarative sentences, and one instruction per sentence — is the discipline that makes docs readable *and* cheaper and more accurate to translate. This isn't a theory; it's why aerospace standardized **Simplified Technical English (ASD-STE100)** decades ago. The mechanisms are concrete:

- **Translation memory (TM) leverage.** Localization vendors charge less for sentences that match previously-translated ones. Consistent, controlled source produces far more 100%-and-fuzzy TM matches, so each release re-translates less. Inconsistent source ("select" / "click" / "choose" / "press" for the same action) defeats the TM and you pay full freight every time.
- **Ambiguity is a per-language tax.** An ambiguous English sentence forces a translator to guess — and they guess differently in each of twelve languages, multiplying one source defect into twelve localized defects, twelve review cycles, and twelve potential support escalations. Controlled language removes the ambiguity once, at the source.
- **Machine translation quality tracks source quality.** If you MT-then-post-edit (now the dominant model), simpler, consistent, unambiguous source yields dramatically better raw MT output and far cheaper post-editing. Garbage-in is expensive-out, twelve times over.
- **Long, multi-clause sentences are where translation breaks.** A 40-word sentence with three subordinate clauses is the sentence that gets mistranslated and the one with the highest post-editing cost. "One sentence, one idea" is a readability rule *and* a localization-cost rule — the same rule, two payoffs.

The professional move is to **encode the controllable parts of controlled language into the same Vale rules** you already run: the approved-term glossary becomes a substitutions rule, the sentence-length ceiling becomes a warning, "one instruction per step" becomes a reviewable heuristic. The readability program and the localization-cost program are *the same program* — the org just funds it twice as easily once you show finance that simpler English is a line-item reduction on the translation invoice, not just a nicety.

> **The professional reality:** "make the docs more readable" is a soft ask that loses budget fights. "Reduce our translation spend and our localized-doc defect rate by controlling source English" is a hard ask with a number attached — and it's the *same work*. If you localize, controlled language is the argument that gets readability funded. See [Measuring Docs ROI](../06-measuring-docs-roi/professional.md) for turning these mechanisms into a defensible business case.

---

## Information Architecture as an Owned Discipline

Here's the failure mode that no amount of per-page readability fixes: a docs estate that has grown to thousands of pages across wikis, repos, a help center, and three acquired products, with **no coherent information architecture.** Each page might be individually well-written. Collectively, nothing is findable — and a doc nobody can find is, operationally, a doc that does not exist. Findability is the gate that *every other quality attribute sits behind*; accuracy, completeness, and clarity are worth zero on a page the reader never reaches.

The pathology of an unowned estate is predictable:

- **No global taxonomy.** Categories grew organically, so the same concept lives under three different top-level sections, and the reader has to already know your org chart to navigate.
- **Duplicated and contradictory pages.** Two teams documented the same feature; both pages rank in search; they disagree; the reader trusts the wrong one.
- **Search is the only navigation that works**, and search is bad, because it's indexing an incoherent corpus with no metadata, no canonical pages, and no synonym handling.
- **Depth without breadth or vice versa** — either a flat dumping ground of 800 sibling pages, or a ten-level hierarchy where the content is buried so deep nobody reaches it.

At scale, **IA is not something each writer does for their own pages — it's a discipline that must be *owned*.** The owner is typically a **docs-platform / Developer Experience (DX) team**: a function that owns the *system* docs live in, not (primarily) the words on each page. Their charter is the cross-cutting infrastructure that individual writers can't own from inside a single team:

- **The global taxonomy and navigation** — the top-level structure, the category model, where new content belongs, and the authority to say "this goes here, not there."
- **Search** — the engine, its index, metadata/faceting, synonym dictionaries, "best bet" pinned results, and the all-important *search-log analysis* (below).
- **Templates and content types** — Diátaxis-style page templates (tutorial / how-to / reference / explanation) so structure is consistent *by default*, and a new writer falls into the pit of success instead of inventing a layout.
- **Consolidation of fragmented sources** — the unglamorous, high-leverage work of migrating scattered wikis into one coherent home, de-duplicating, and establishing canonical pages with redirects so no link rots and no contradiction survives.

This is the same shift the engineering org made when it created a platform team: the per-page craft (writing) is distributed to the people closest to the product, while the *system* the craft operates in (IA, search, templates, tooling) is centralized and owned, because it's a commons that degrades the instant nobody is responsible for it. An IA with no owner doesn't stay still; it decays toward the sprawl above, one well-intentioned page at a time.

> **The professional reality:** the highest-leverage docs hire at scale is often not another writer — it's the person who owns the IA, the search, and the templates so the writers' work becomes *findable*. A brilliant page in an incoherent estate is a tree falling in an empty forest. Findability is infrastructure, and infrastructure needs an owner.

---

## Validating IA with Real Users

An IA designed in a meeting is a hypothesis about how readers think. The senior trap is shipping that hypothesis and assuming it's right because it's logical *to the people who built the product*. The professional discipline is **measuring whether real users can actually find things — continuously, as a standing instrument, not as a one-time launch checklist.** Three techniques, each answering a different question, and all of them ongoing:

- **Tree testing** answers *"can users find content in the proposed structure?"* — independent of visual design. You give participants the bare hierarchy (labels only, no page content) and a set of realistic tasks ("where would you go to rotate an API key?"), then measure success rate, directness (did they backtrack?), and where they got lost. It isolates the *structure* from the look, which is exactly what you want when validating IA. Run it *before* a big migration to compare candidate taxonomies, and *after* to confirm the new structure actually beat the old.
- **First-click testing** answers *"is the first navigation choice obvious?"* — and the first click is wildly predictive. The long-cited finding (Bob Bailey / Jeff Sauro) is that when the first click is correct, task success is roughly **2–3× more likely** than when it's wrong. If users' first click is consistently wrong for a task, your labels or top-level structure are misleading, no matter how good the destination page is.
- **Search-log analysis** is the one you run *forever*, because it's a continuous, unsolicited record of what readers actually want and fail to find. Mine it for:
  - **Top queries** — the real demand signal; do these have great, top-ranked answers? If your #3 query has a mediocre page on result 8, that's a prioritized fix handed to you for free.
  - **Zero-result and low-click queries** — content gaps, or vocabulary mismatches (users say "login," your docs say "authentication" — a synonym-dictionary fix, not a writing one).
  - **Searches *from within* a page** — a strong signal the page they're on failed them; where did they land, and what did they search next?
  - **Exit-after-search** — they searched, saw the results, and left. The result set didn't look like the answer.

The meta-point that separates this from amateur UX theater: **these are instruments, not events.** Tree testing and first-click testing are how you de-risk a *change* (a migration, a re-taxonomy, a new top-level section) before you ship it to everyone. Search-log analysis is the always-on telemetry of your IA's health — the docs equivalent of production monitoring. A team that reads its search logs weekly is debugging findability with real evidence; a team that "redesigned the IA last year" and never looked again is flying blind, and its IA is already drifting out of date with what users now ask.

> **The professional reality:** you would never ship a service and never look at its metrics again, then claim it's healthy. IA is the same. Tree/first-click tests de-risk changes; search logs are the standing dashboard. "We have good IA" without continuous evidence is a guess — and it's usually a guess made by people who already know where everything is, which is exactly the population whose intuition you cannot trust.

---

## The Readability/IA ROI

Readability and IA pay for themselves through two channels that map directly to money, and naming them is how you fund the program:

1. **Ticket deflection.** A findable, readable answer is a support ticket that never gets filed. The chain is concrete: the reader has a question → search surfaces a clear, correct page → they self-serve → no ticket. Every link in that chain is a readability/IA property. When findability fails (unfindable page) *or* readability fails (page found but unclear), the reader escalates to support, and you pay the fully-loaded cost of a human answering what the docs should have. The search-log technique above literally hands you the deflection backlog: top queries with weak answers are the tickets you're about to receive.
2. **Faster onboarding.** New engineers (yours and your customers') ramp on docs. Time-to-first-success — how long until someone completes the core task — is gated by whether they can *find* the right page and *understand* it once there. Sprawling, unreadable docs stretch onboarding; a clean IA with readable tutorials compresses it. This compounds: every new hire and every new customer pays the onboarding tax, so a fixed IA improvement returns on every future arrival.

The discipline is to **measure these, not page views.** Page views are a vanity metric and an actively misleading one — a page with soaring views might be a heavily-trafficked *success*, or a confusing page people reload three times because they can't extract the answer. Tie readability/IA work to **ticket deflection, time-to-first-success, search-success rate, and self-service rate**, which is exactly the toolkit of [Measuring Docs ROI](../06-measuring-docs-roi/professional.md). The connection runs both ways: ROI is the argument that gets readability and IA funded, and readability/IA are two of the biggest levers ROI actually has. When you ask for headcount for a docs-platform/DX team, "improves findability" loses; "deflects N tickets/month and cuts customer time-to-first-success by X" wins — and it's the same work.

> **The professional reality:** the readability/IA program and the docs-ROI program are not two initiatives — they're one initiative described to two audiences. To writers, it's "make docs clear and findable." To the people with the budget, it's "deflect tickets and speed onboarding." Lead with whichever the room funds, and never report success in page views.

---

## Governance Pitfalls: How Readability Programs Get Gamed

Every quality program acquires a number, and every number acquires people optimizing it. Readability and IA have two specific, predictable failure modes that turn a well-meaning program into worse docs — and a staff-level practitioner is expected to see them coming.

**Pitfall 1 — Targeting a readability score produces robotic prose.** The moment "every page must hit Flesch Reading Ease ≥ 60" (or "Gunning fog ≤ 10," or any grade-level target) becomes a *gate*, you've created a textbook case of **Goodhart's Law**: a measure that was a useful proxy becomes a target, and ceases to measure what you wanted. Here's the mechanism, and it's worse than it sounds: these formulas compute readability almost entirely from **sentence length and syllable/word-length counts.** They have *no model of meaning, flow, or coherence.* So the cheapest way to "improve" the score is to chop every sentence into short, choppy fragments and avoid longer words — which scores *beautifully* and reads like a ransom note. You optimize the proxy straight past the goal: the prose gets *less* readable (no connective tissue, no rhythm, jarring staccato) while the number gets *better*. The formula literally cannot tell apart "clear and well-paced" from "robotically truncated," because the only thing it measures is the surface feature the writer just gamed.

The fix is doctrine: **never set a readability score as a target or a gate.** Use the score the way the senior page taught — as a *smell detector* on the trend ("this page suddenly got much harder; go look at it"), a directional signal, an input to human judgment. The arbiter of readability is a human reading it aloud, plus the user tests above. The score is a thermometer, not a thermostat; the instant you let it control the system, it stops telling you the temperature.

**Pitfall 2 — Rules that are too strict get ignored wholesale.** A Vale config with a hundred `error`-level rules, several of them pedantic or context-blind (banning *all* passive voice, capping every sentence at 20 words, forbidding a word writers legitimately need), produces a wall of false positives on real prose. Contributors do the rational thing: they stop reading the alerts, or they discover the suppression syntax and blanket-disable Vale on their files. Now your *good* rules — the ones that would have caught real inconsistency — are ignored along with the noise. An over-strict linter doesn't enforce style; it teaches the team to route around style enforcement entirely, which is worse than having no linter, because you *think* you're protected.

The fix mirrors the rollout discipline: **keep the `error` gate narrow and unambiguous; everything debatable stays a `warning`/`suggestion`.** A linter that's right 99% of the time gets obeyed; one that cries wolf gets muted. Tune rules against your *actual* corpus before promoting them, prune any rule whose suppression rate climbs (a high suppress rate is the team telling you the rule is wrong), and treat the linter's credibility as the scarce resource it is. The goal is a rule set the team *trusts*, because a trusted linter is followed and a distrusted one is bypassed — and a bypassed linter enforces nothing.

> **The professional reality:** both pitfalls are the same disease — confusing the *measure* with the *goal*. The readability score and the lint rule are proxies for "good, consistent prose." Make either one a hard target and people optimize the proxy at the expense of the goal, producing docs that score well and read badly. The senior knows the formulas are limited; the staff engineer builds the *program* so its own metrics can't corrupt the thing they were meant to protect.

---

## War Stories

**The Vale rollout that standardized voice across fifty writers.** A docs org of fifty-plus contributors across a dozen product teams had a beautiful style guide nobody applied; every page read like its individual author, and readers felt the whiplash moving between sections. They packaged the style guide as a Vale rule set and started — critically — at `warning`, gated only on changed lines in PRs, with reviewdog surfacing alerts inline. The first month was tuning, not enforcement: they watched what the corpus actually violated and pruned the noisy rules. Only then did they promote a small, unambiguous core (sentence-case headings, the banned-word list, the product's own feature spellings) to `error`. Within two quarters a reader genuinely couldn't tell who wrote which page, *and* senior editors reported their reviews got more valuable — freed from hunting mechanical nits, they were finally reviewing whether pages were correct and complete. The lesson: opt-in-then-enforce, gate the diff not the world, and a narrow `error` set is what made it stick.

**The fragmented-wiki consolidation that fixed findability.** After two acquisitions, a company had three wikis, a help center, and docs-in-repos — overlapping, contradictory, each with its own search and taxonomy. Individual pages were fine; nobody could *find* anything, and support tickets for already-documented answers kept climbing. A newly-formed docs-platform team treated it as an IA problem, not a writing one: tree-tested candidate taxonomies *before* migrating, consolidated everything into one home with canonical pages and redirects (so no link rotted, no contradiction survived), and stood up real search with a synonym dictionary built from the *old* search logs' zero-result queries. "Documented but unfindable" tickets dropped sharply. The lesson: the highest-leverage docs work wasn't more writing — it was an owned IA, validated before the migration and measured after.

**The readability-score target that produced robotic prose.** A docs leader, wanting a crisp metric for an exec dashboard, mandated every page hit a Flesch-Kincaid grade target and wired it into the publish gate. Writers, rational under the constraint, hit the number the only way the formula rewards: they shredded sentences into short fragments and swapped precise multi-syllable terms for vague short ones. The dashboard turned green. The docs got *worse* — choppy, connective-tissue-free, and in places less precise — and a subsequent round of tree/first-click testing showed task success had actually dipped on the "improved" pages. They killed the gate, demoted the score to a trend signal on the dashboard ("flag pages that suddenly got harder"), and put human read-aloud review and user testing back as the actual arbiters. The lesson, learned the expensive way: a readability score is a thermometer, and the moment you make it a thermostat, Goodhart eats your prose.

---

## Decision Frameworks

**Lint it, or send it to a human? Ask:**
- Is there exactly one defensible answer (terminology, casing, banned word, spelling)? → **lint it**, and it can be an `error`.
- Does judging it require knowing what the page *means* or who it's *for* (correctness, structure, tone, the right example)? → **human review**; if you lint it at all, keep it a `warning`/`suggestion`.
- Is it grammar-ish but context-dependent (passive voice, sentence length)? → **`warning` only**, never a gate — the "violation" is often the right call.

**Should this be a CI gate (`error`) or a hint (`warning`)? Ask:**
- Would a competent writer ever *correctly* violate this rule? → if yes, it's a `warning`, full stop.
- Is the corpus's current violation rate low after tuning? → only then promote to `error`; otherwise you'll bury the signal.
- Is the rule's suppression rate climbing over time? → the team is telling you it's wrong; demote or prune it.

**Is this a readability problem or an IA problem? Ask:**
- Can the reader *find* the page at all? → if no, it's **IA/findability** — fix taxonomy/search first; readability of an unreachable page is moot.
- Do they find it but leave unsatisfied (exit-after-search, page-internal search)? → it's **readability/content** — the answer's there but unclear or incomplete.
- Read your search logs to tell these apart: zero-result/low-click → IA & gaps; found-then-bounced → readability.

**Is controlled language worth the discipline? Ask:**
- Do you localize into one or more languages, now or on the roadmap? → **yes** — it cuts per-word cost, raises TM leverage, and reduces localized defects; fund it as a cost lever.
- English-only, forever? → still adopt the *readability* subset (one term per concept, one idea per sentence), but pitch it as clarity, not localization savings.

**Do you need a docs-platform/DX owner for IA? Ask:**
- Is the estate large enough that no one writer can hold the global taxonomy in their head, or fragmented across multiple sources? → **yes** — IA, search, and templates are a commons that decays without an owner.
- Small, single-source docs one team fully owns? → IA can be a shared team responsibility; revisit when you acquire a wiki or cross a few hundred pages.

---

## Mental Models

- **A readability score is a thermometer, not a thermostat.** It can *tell* you a page got harder; the instant you let it *control* publishing, writers game the surface feature it measures (sentence length) and the prose gets worse while the number gets better. Measure with it; never target it.

- **Style-as-code moves the consistency floor from "whoever edited last" to "every commit."** Vale doesn't make prose good — it makes prose consistent, and frees expensive human attention for the judgment calls a linter can't make.

- **Findability is the gate every other doc-quality attribute sits behind.** Accuracy, completeness, and clarity are worth zero on a page the reader never reaches. An unfindable doc is, operationally, an undocumented feature.

- **IA is a commons; a commons with no owner decays.** A sprawling estate doesn't hold its structure on goodwill — it drifts toward duplicated, contradictory, unnavigable sprawl one well-meant page at a time, until someone *owns* the taxonomy, search, and templates.

- **Your source English is the input to every translation.** Complexity and ambiguity in the source propagate — and multiply — across every locale, per word, every release. Controlled language is a readability rule and a cost lever; it's the same rule.

- **Search logs are production telemetry for your docs.** They're a continuous, unsolicited record of what readers want and fail to find. A team that reads them weekly is debugging findability with evidence; one that doesn't is guessing.

- **A linter's credibility is a scarce resource.** Cry wolf with over-strict rules and the team mutes the linter — and your good rules die with the noise. A narrow, trusted gate is obeyed; a broad, distrusted one is bypassed.

---

## Common Mistakes

1. **Switching on a hundred Vale rules at `error` against an existing corpus.** The first PR drowns in alerts, everyone learns to ignore the linter, and the program dies on day one. Baseline at `warning`, gate the *diff* not the world, and promote rules to `error` selectively.

2. **Linting things that need a human.** A linter has no model of meaning; point it at correctness, tone, or "the right example" and it generates false positives that train the team to suppress it. Lint what has one defensible answer; route judgment to people.

3. **Setting a readability score as a target or publish gate.** Goodhart guarantees the result: short choppy fragments score well and read badly. The formula can't tell "clear" from "truncated." Use the score as a trend smell, never a thermostat.

4. **Treating IA as something each writer does for their own pages.** At scale the global taxonomy, search, and templates are a commons no individual writer can own. Without a docs-platform/DX owner, the estate decays toward unfindable sprawl.

5. **Shipping an IA you designed in a meeting and never validating it.** "Logical to the people who built the product" is exactly the wrong test — they already know where everything is. Tree-test and first-click-test changes *before* shipping; read search logs *forever*.

6. **Measuring docs success with page views.** A high-traffic page might be a hit or a confusing page reloaded three times. Tie readability/IA to ticket deflection, time-to-first-success, and search-success — the metrics that map to money.

7. **Ignoring localization when arguing for readability budget.** "Make docs clearer" loses funding fights; "cut translation cost and localized defects by controlling source English" wins — and it's the same work. If you localize, lead with the cost lever.

8. **Letting an over-strict linter erode its own authority.** Rules that flag legitimate prose get the whole linter muted or bypassed. Watch suppression rates; a rising one means the rule is wrong. Protect the linter's trust like the scarce resource it is.

---

## Test Yourself

1. You're introducing Vale to a fifty-writer docs org with a large existing corpus. Describe the rollout so the program doesn't die on the first PR, and name what you'd gate at `error` vs `warning`.
2. Give three things a prose linter *should* enforce and three that *must* go to a human, and state the single principle that draws the line.
3. Explain two concrete mechanisms by which controlled/simplified source English reduces localization cost, and why "one idea per sentence" is both a readability rule and a cost rule.
4. A docs estate has thousands of individually-fine pages but terrible findability after two acquisitions. Why is this an IA problem rather than a writing problem, and who should own the fix?
5. Distinguish tree testing, first-click testing, and search-log analysis: what question does each answer, and which is a one-time de-risking instrument vs an always-on one?
6. A leader mandates that every page hit a Flesch grade target, wired into the publish gate. Predict what writers do, why the docs get *worse* while the number improves, and what the score should be used for instead.
7. You're asking for headcount for a docs-platform/DX team. Frame the request twice — once for writers, once for the executive holding the budget — and name the metrics you'd commit to.

<details>
<summary>Answers</summary>

1. **Opt-in, then enforce.** (a) Run Vale across the whole corpus at `warning` to see real violations and *tune* the rules before blocking anyone. (b) Gate only **changed lines** in PRs (reviewdog `github-pr-review`), so contributors fix what they touch and the corpus improves incrementally — no giant cleanup PR. (c) Promote to `error` only a small, **unambiguous, high-value** set (sentence-case headings, banned-word list, product feature spellings); keep everything debatable at `warning`. **`error`:** mechanical one-right-answer rules. **`warning`:** anything grammar-ish or context-dependent (passive voice, sentence length).

2. **Lint:** banned/weasel words, terminology consistency, heading case/list parallelism, spelling, "click here" link text. **Human:** whether the explanation is *correct*, whether it answers the reader's real question, whether the example is the *right* one, audience fit/tone, whether the page should exist at all. **Principle:** lint what has exactly one defensible answer a machine can recognize; route everything requiring a model of *meaning* to a human.

3. (a) **TM leverage** — consistent, controlled source produces more 100%/fuzzy translation-memory matches, so each release re-translates (and re-pays) less; inconsistent source ("click"/"select"/"choose") defeats the TM. (b) **Ambiguity tax** — an ambiguous source sentence is guessed *differently in each language*, multiplying one defect into N localized defects, review cycles, and escalations; controlled language removes it once at the source. (Also: MT post-editing cost tracks source quality.) "One idea per sentence" shortens and de-ambiguates — readable for the English reader *and* the lowest-cost, lowest-risk unit to translate. Same rule, two payoffs.

4. The pages are individually fine, so the defect isn't *writing* — it's that there's no coherent global structure (overlapping taxonomies, duplicated/contradictory pages, bad search across an incoherent corpus), so nothing is **findable**, and an unfindable doc is operationally undocumented. Findability is the gate every other attribute sits behind. **Owner:** a docs-platform/DX team that owns the global taxonomy, search, templates, and the consolidation/canonicalization/redirect work — a commons no single writer can own.

5. **Tree testing** — "can users find content in this *structure*?" (labels only, no design); de-risks a migration/re-taxonomy **before** shipping. **First-click testing** — "is the first navigation choice obvious?" (a correct first click makes success ~2–3× likelier); also a **before-change** instrument. **Search-log analysis** — "what do users actually want and fail to find?"; an **always-on** standing instrument (top queries, zero-result/low-click, page-internal search, exit-after-search). Tree/first-click de-risk *changes*; search logs are continuous telemetry.

6. Writers hit the number the only way the formula rewards: **chop sentences into short fragments and avoid longer words.** The score (computed almost entirely from sentence/word length, with *no* model of meaning or flow) goes up while the prose loses connective tissue, rhythm, and sometimes precision — it reads *worse*, and user testing often shows task success drop. Classic Goodhart. **Use instead:** a trend smell ("this page suddenly got harder — go look"), a directional input to human judgment — a thermometer, never a thermostat. The arbiters are read-aloud human review and user tests.

7. **To writers:** "We'll own the IA, search, and templates so your work is findable and consistent by default — you write, the system makes it discoverable." **To the exec:** "This deflects ~N support tickets/month (top search queries with weak answers = tickets we're about to receive) and cuts customer/employee time-to-first-success by X% by making documented answers findable." **Metrics committed:** ticket deflection, time-to-first-success, search-success rate, self-service rate — explicitly *not* page views.

</details>

---

## Cheat Sheet

```
STYLE-AS-CODE (Vale in CI)
  package the style guide as YAML rules; Vale ignores code blocks
  borrow rule packs: Microsoft / Google / write-good / proselint
  ROLLOUT: warning across corpus → tune → gate the DIFF → promote a
           small unambiguous set to error  (opt-in, THEN enforce)
  WIN: consistency floor moves to "every commit"; frees human review

LINT vs HUMAN
  lint  → one defensible answer: terminology, casing, banned words, spelling
  human → needs meaning: correctness, "right example", structure, tone
  grammar-ish (passive, sentence length) → WARNING only, never a gate

CONTROLLED LANGUAGE (localization cost lever)
  one term per concept, one idea per sentence, simple syntax (cf. ASD-STE100)
  → more TM matches (cheaper re-translation)
  → less ambiguity (one source defect, not N localized defects)
  → better MT / cheaper post-editing
  encode the controllable parts into the SAME Vale rules

IA AS AN OWNED DISCIPLINE  (docs-platform / DX team owns:)
  global taxonomy + navigation   |  search (index, synonyms, best-bets)
  templates / content types      |  consolidation of fragmented wikis
  RULE: findability is the gate every other quality attribute sits behind
        an unfindable doc == an undocumented feature

VALIDATE IA WITH REAL USERS
  tree testing      → can users find it in the STRUCTURE?  (before a change)
  first-click test  → is the first nav choice obvious?     (~2-3x success)
  search-log analysis → what do users want & fail to find? (ALWAYS-ON)
      mine: top queries, zero-result, low-click, exit-after-search

ROI (fund it with these, NOT page views)
  ticket deflection · time-to-first-success · search-success · self-service

GOVERNANCE PITFALLS (Goodhart)
  readability SCORE as a target → choppy robotic prose; thermometer not thermostat
  over-strict linter → muted/bypassed; keep the error gate narrow & trusted
```

---

## Summary

- **Style-as-code (Vale in CI)** turns a house style guide into enforced YAML rules, moving the consistency floor from "whoever edited last" to "every commit." Roll out **opt-in then enforce**: baseline at `warning`, gate the *diff* not the world, promote a small unambiguous set to `error`. The win is comparability across writers and freeing human review for substance.
- **Lint what has one defensible answer** (terminology, casing, banned words); **route meaning to humans** (correctness, the right example, tone, structure). Treat grammar-ish rules as `warning` prompts, never gates — their "violations" are often correct.
- **Controlled language is a hard-dollar localization lever**: consistent, simple, unambiguous source raises translation-memory leverage, cuts ambiguity-driven per-locale defects, and improves MT/post-editing. Readability and translation-cost reduction are the *same work* — and the cost framing is what funds it.
- **IA is an owned discipline, not a per-page chore.** A sprawling estate with no information architecture is unfindable, and an unfindable doc is de-facto undocumented. A **docs-platform/DX team** owns the taxonomy, search, templates, and the consolidation of fragmented wikis — a commons that decays without an owner.
- **Validate IA with real users, continuously**: tree testing and first-click testing de-risk *changes* before they ship; search-log analysis is always-on telemetry for findability. "We have good IA" without evidence is a guess made by people who already know where everything is.
- **Fund readability/IA via ROI** — ticket deflection and faster time-to-first-success — not page views, which mislead.
- **Defend the program from its own metrics.** A readability *score* as a target produces robotic prose (Goodhart — the formula only sees sentence length); use it as a thermometer, never a thermostat. An over-strict linter gets muted; keep the `error` gate narrow and trusted.

You can now run readability and IA as an organization-scale program — enforced in CI, owned as a discipline, validated with users, and protected against gaming. The final tier, [interview.md](interview.md), distills the whole topic into the questions that reveal whether someone actually understands it.

---

## Further Reading

- [Vale](https://vale.sh/) and its docs/styles ecosystem — the prose linter, plus ready-made rule packs (Microsoft, Google developer style, write-good, proselint) to borrow instead of writing from scratch.
- [Google Developer Documentation Style Guide](https://developers.google.com/style) — a maintained, opinionated house style you can encode into Vale rules wholesale.
- [Optimal Workshop](https://www.optimalworkshop.com/) on **tree testing** and **first-click testing** — methodology and tooling for validating IA structure with real users.
- *Information Architecture for the Web and Beyond* (Rosenfeld, Morville, Arango) — the canonical text on IA as an owned discipline: taxonomy, navigation, search, and labeling at scale.
- **ASD-STE100 Simplified Technical English** — the aerospace controlled-language standard; the reference for "constrained source English as a quality and cost discipline."
- **Goodhart's Law** and *The Tyranny of Metrics* (Jerry Z. Muller) — why "when a measure becomes a target it ceases to be a good measure" is the governing risk of any readability/IA scorecard.
- Search-log / site-search analysis guides (e.g., the search-analytics chapters in the IA literature and analytics docs) — turning your internal search into a standing findability instrument.

---

## Related Topics

- [junior.md](junior.md) — readability and IA basics: plain language, headings, one idea per paragraph, the shape of a navigable doc.
- [senior.md](senior.md) — the craft layer: progressive disclosure, minimalism, the limits of readability formulas, IA as the reader's mental model.
- [interview.md](interview.md) — the questions that probe whether someone genuinely understands readability and IA at depth.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md) — ticket deflection, time-to-first-success, and search-success: the business case readability/IA both feeds and is funded by.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/professional.md) — findability and clarity as quality attributes; the broader frame this topic operationalizes.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to write readable docs and structure IA, where this section asks *whether they're any good and how you'd know*.

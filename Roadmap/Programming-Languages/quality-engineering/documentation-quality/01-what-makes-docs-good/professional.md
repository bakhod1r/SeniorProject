# What Makes Docs Good — Professional Level

> **Roadmap:** [Documentation Quality](../README.md) → What Makes Docs Good
> *The senior page taught you the quality attributes and how to judge a single doc. This page is about making "good docs" a property of an organization rather than a property of whichever engineer happened to care that week — defining the standard, enforcing it without theater, assigning ownership that survives reorgs, and funding it against a backlog that only ever rewards features.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Defining an Org Doc-Quality Standard That Scales](#defining-an-org-doc-quality-standard-that-scales)
4. [Embedding Doc Quality in the Workflow](#embedding-doc-quality-in-the-workflow)
5. [The Ownership Problem](#the-ownership-problem)
6. [Culture and Incentives — Why Good Docs Don't Get Written](#culture-and-incentives--why-good-docs-dont-get-written)
7. [Deciding the Quality Bar Per Audience](#deciding-the-quality-bar-per-audience)
8. [Measuring Program Success Without Gaming It](#measuring-program-success-without-gaming-it)
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

> Focus: **Establishing and governing documentation quality as an organizational practice — the rubric, the gate, the owner, and the budget — not the craft of writing any single doc.**

The senior page gave you the vocabulary: accuracy, completeness, findability, clarity, audience-fit, currency, and how to apply the Diátaxis lens to judge whether one page is any good. That's enough to fix a doc. It is nowhere near enough to fix an organization's docs, because the failure mode at scale isn't "this engineer can't write" — it's that quality depends on heroics, no two people agree on what "done" means, the docs nobody owns rot, and the only thing the company actually rewards is shipping features.

At the professional level, "what makes docs good" becomes a governance question. You are no longer asking *is this page good?* You are asking: *what is our shared, written definition of good? How is it enforced in the same place we enforce code quality? Who is accountable when it slips? Why does the organization keep under-investing in it, and how do I make that visible? And how much quality does each thing actually need — because a customer-facing API reference and a throwable migration note are not held to the same bar.*

This page is the systems-and-incentives layer. It deliberately does **not** teach you how to write a good README, ADR, or runbook — that craft lives in [Code Craft → Documentation](../../../code-craft/documentation/). It teaches you how to make good docs *structural and inevitable* instead of *heroic and accidental*.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the full set of quality attributes, the Diátaxis quality-per-genre lens, and how to evaluate an individual doc.
- **Required:** You can already write good docs yourself, or recognize one when you read it — this page governs quality, it doesn't teach the craft.
- **Helpful:** You've owned a code-review standard, a CI gate, or a definition-of-done for engineering work — doc governance reuses exactly that machinery.
- **Helpful:** You've watched a documentation effort decay after the person who cared left, or after the next deadline landed.

---

## Defining an Org Doc-Quality Standard That Scales

A standard that lives in one senior engineer's head doesn't scale; it leaves with them. To make "good" reproducible across dozens of authors, you need it written down at three levels of increasing specificity: a **rubric** (what good means), a **style guide** (the house rules, automated where possible), and **templates** (the structure that makes quality the default).

### A shared quality rubric / definition-of-done for docs

The senior page's attributes are the right axes; the professional move is turning them into a **checklist a non-expert can apply and get the same answer as an expert**. A doc-quality rubric is a definition-of-done, not an essay. Keep it short enough that people actually run it:

```
DOC DEFINITION OF DONE  (a doc is not "done" until every box is honestly checked)
[ ] Correct       — claims match current behavior; every command/snippet was run and works
[ ] Complete      — covers the task end-to-end; prerequisites and failure modes stated
[ ] Findable      — discoverable from where the reader starts; titled/tagged for search
[ ] Single genre  — it is ONE of: tutorial / how-to / reference / explanation (Diátaxis)
[ ] Audience-fit  — written for a named reader at a stated level; no unexplained jargon
[ ] Current       — has an owner and a review-by date; no contradicted/stale claims
[ ] Maintainable  — snippets are executable/tested where possible; no copy-pasted drift
```

Two properties make a rubric work rather than rot:

- **It's binary and observable, not aspirational.** "Well-written" is not a checkbox; "every code snippet was executed and produced the shown output" is. The senior page can debate nuance; the rubric must be mechanical enough that two reviewers agree. Anything that requires taste belongs in review comments, not the gate.
- **It maps to genre.** A reference page and a tutorial fail the rubric differently — a reference must be exhaustive and skimmable; a tutorial must be a guaranteed-success linear path. The rubric points at the genre-specific bar (which the [Code Craft → Documentation](../../../code-craft/documentation/) Diátaxis material defines) rather than restating it.

### A house style guide with automated enforcement

A style guide nobody can enforce is a wiki page nobody reads. The professional pattern is **adopt, don't author**: take an existing, battle-tested base — the Google Developer Documentation Style Guide or the Microsoft Writing Style Guide — and add only your house deltas (product names, banned phrases, terminology). Writing a style guide from scratch is a multi-month project that produces something worse than what already exists for free.

Then make the mechanical 80% **automated**, because style rules enforced by human reviewers are enforced inconsistently and resented. A prose linter — **Vale** is the de-facto standard — encodes the rules that machines can check and runs them in the editor and in CI:

```yaml
# .vale.ini — house style as code, layered on a published base
StylesPath = .vale/styles
MinAlertLevel = warning

[*.md]
# Pull in a maintained ruleset, then add house rules on top
BasedOnStyles = Google, write-good
Vale.Terms = YES                 # enforce our capitalization of product/feature names
Google.Passive = warning         # flag passive voice; advisory, not blocking
House.BannedPhrases = error      # "simply", "just", "obviously", "as everyone knows"
```

The boundary matters: a linter catches *mechanical* defects — passive voice, banned filler, inconsistent terminology, heading case, weasel words. It cannot judge whether the content is *correct* or *useful*. That judgment is what human review and the rubric are for. Conflating "passed Vale" with "is a good doc" is the documentation version of mistaking a green linter for a correct program.

### Templates per genre — quality as structure, not heroics

The highest-leverage standardization isn't the rubric or the linter; it's the **template**. A good template bakes the genre's quality requirements into the blank page, so an average author producing an average effort still clears the bar — quality becomes structural rather than dependent on the author remembering what good looks like.

The principle: **a template should make the right doc easy and the wrong doc obviously incomplete.** An ADR template with empty `Context`, `Decision`, `Consequences`, and `Alternatives Considered` sections means the author who skips "alternatives" leaves a conspicuous hole a reviewer will catch. A runbook template with mandatory `Symptoms`, `Diagnosis`, `Remediation`, and `Escalation` sections means the 3 a.m. on-call author can't forget the escalation path. A how-to template that opens with `Prerequisites` and `Goal` forces audience-fit and scope to the top.

This is the same insight as scaffolding in code: you don't rely on every engineer remembering every cross-cutting concern; you make the structure carry it. Templates turn "did they remember to document failure modes?" from a hope into a fill-in-the-blank. (The genre templates themselves — what goes in an ADR vs a runbook vs a reference — are defined in [Code Craft → Documentation](../../../code-craft/documentation/); your job here is to *mandate and govern* their use.)

> **The professional reality:** the three artifacts form a ladder. The **template** makes good structure the default (cheapest, highest leverage). The **linter** catches mechanical defects automatically (cheap, consistent). The **rubric** is the human-judgment backstop for correctness and usefulness (expensive, reserved for what machines can't see). Skip the template and you're relying on heroics; skip the linter and you're spending senior reviewer time on heading case; skip the rubric and you're shipping linted nonsense.

---

## Embedding Doc Quality in the Workflow

A standard that lives outside the workflow is advisory, and advisory standards lose to deadlines every time. To make doc quality real, it has to ride the same rails as code quality: code review, definition-of-done, and a CI gate — with the crucial caveat that the gate must measure something real, not perform diligence.

### Docs in code review

The cheapest, highest-trust place to enforce doc quality is the **pull request that changes the behavior**, because that's the one moment the author has the full context loaded and the cost of updating the doc is near zero. A behavior change whose PR doesn't touch the relevant doc is the single most common source of doc rot — the code and the doc diverge at the exact commit where they could most easily have stayed together.

Concrete mechanisms:

- **Co-locate docs with code** (docs-as-code) so the diff that changes the API *shows* the unchanged reference doc, making the omission visible in review. Docs in a separate wiki are invisible to the code reviewer and rot silently.
- **Make "did this change need a doc change?" an explicit review prompt** — a PR-template checkbox or a reviewer's standing responsibility — so it's asked every time, not when someone remembers.
- **Review docs as docs, not as prose.** The reviewer applies the rubric (is it correct, complete for its genre, audience-fit), not their personal style preferences — the linter already handled style. This keeps doc review fast and depersonalized.

### Docs in the definition-of-done

If "done" means "code merged and tests green," docs are by definition optional, and optional work doesn't happen under load. The professional move is to **put the relevant doc update inside the team's definition-of-done for the work item** — a feature isn't done until its user-facing doc exists; an API change isn't done until the reference reflects it; an incident isn't closed until the runbook is updated with what was learned.

The key is *scoped* — DoD doesn't mean "document everything," it means "the doc this change implies is part of this change." A bug fix in an internal helper implies no doc; a new public endpoint implies a reference entry and a how-to. Tying the doc obligation to the *type* of change (next section's audience tiers do the heavy lifting here) keeps it proportionate instead of bureaucratic.

### A docs-quality gate that isn't theater

A CI gate is where governance becomes enforcement — and also where it most easily becomes **theater**: a check that's technically green while the docs are actually bad. The discriminator is simple: *a gate is real if it can only be satisfied by the docs actually being better, and theater if it can be satisfied by making a number go up.*

| Real gate (measures a true property) | Theater gate (measures a proxy you can game) |
|---|---|
| Every fenced code snippet **executes and produces the shown output** in CI (doctests, Go examples, rustdoc tests) | "Docstring coverage ≥ 90%" — satisfied by `"""TODO"""` on every symbol |
| **No broken internal/external links** (link checker) | "Word count ≥ 200" — satisfied by padding |
| **Changed public symbols have a corresponding doc change** in the same PR | "A `.md` file was touched" — satisfied by a typo fix |
| **Vale passes** with zero `error`-level violations (banned filler, wrong terminology) | "Spell-check passes" — necessary but trivially insufficient |
| **Review-by date in the future** for owned docs (freshness) | "Page exists" — the rot graveyard is full of pages that exist |

The rule of thumb: **gate on properties that are expensive to fake and cheap to verify.** "This snippet runs" is the gold standard because the only way to pass is to have a working snippet — it's the documentation analogue of a passing test, and it's the subject of the entire [Testable & Executable Docs](../02-testable-and-executable-docs/professional.md) topic. Coverage percentages and word counts are the opposite: trivial to satisfy, uncorrelated with quality, and they *teach the org to game* — exactly the failure mode of [code coverage](../../code-coverage/) used as a target.

> **The professional reality:** a doc gate's job is to make the cheap, mechanical failures impossible (broken links, dead snippets, missing reference entries) and to *route* the expensive, judgment failures to a human (is this actually clear and correct?). A gate that tries to mechanize taste produces theater; a gate that mechanizes only the mechanical, and is honest that the rest is human, produces trust. See [Freshness & Rot Metrics](../03-freshness-and-rot-metrics/professional.md) for the freshness signals a real gate can enforce.

---

## The Ownership Problem

The deepest structural reason docs go bad is ownership, and it has a famous shape: **"docs are everyone's job" is operationally identical to "docs are nobody's job."** A page with no owner has no one accountable for its accuracy, no one who notices when it rots, and no one who gets paged when it misleads. Diffuse responsibility is the root cause behind most of the symptoms the earlier tiers diagnose.

### Why "everyone owns it" fails

Shared ownership of a specific artifact fails for the same reason a shared kitchen gets dirty: the benefit of maintenance is diffuse and the cost is concentrated on whoever happens to act. When a doc is wrong, the engineer who notices faces a choice — fix someone else's doc now (cost: their time, on a thing they're not measured on) or move on (cost: borne by future readers, invisible to them). Rational individuals choose "move on," and the doc rots. This is a commons problem, not a character problem, which is why exhorting people to "care more about docs" never works.

### Three ownership models

| Model | How it works | Best for | Failure mode |
|---|---|---|---|
| **Author-owns** | Whoever writes a doc owns it until reassigned | Small teams, internal docs | Owner leaves/changes teams → orphan |
| **Team-owns (code-adjacent)** | The team that owns the *code* owns its docs; doc lives in the repo | Reference docs, runbooks, READMEs | Team deprioritizes docs under load |
| **Tech-writer-owns / partnership** | Professional writers own customer-facing docs, partner with engineers for accuracy | External product/API docs | Writer becomes a bottleneck if they own *all* docs |

The mature answer is rarely one model — it's **matching the model to the doc's audience and lifespan** (the next section's tiers). Customer-facing docs get tech-writer ownership; code-adjacent reference and runbooks get team ownership co-located with the code; throwaway internal notes get author ownership and an expiry date. The unifying rule is that **every doc that matters has a named owner and the owner is discoverable from the doc** (a `CODEOWNERS` entry, frontmatter, a maintainers line) — an unowned doc that matters is a latent incident.

### Tech-writer partnership vs engineer-written docs

The most consequential ownership decision is whether docs are written by engineers or by professional technical writers — and the right answer is **neither alone; it's a partnership with a clear division of labor:**

- **Engineers own correctness.** Only the engineer knows the true behavior, the edge cases, the failure modes. No writer can manufacture accuracy they don't have.
- **Writers own clarity, structure, audience-fit, and consistency.** A trained tech writer turns a correct-but-impenetrable engineer draft into something a customer can actually use, enforces the style guide, maintains the information architecture, and *has the time and mandate* engineers don't.
- **The partnership beats either pole.** Engineer-only docs are accurate and unreadable; writer-only docs are readable and subtly wrong. The high-functioning pattern is engineer-as-source-of-truth + writer-as-editor-and-owner, often with the writer **embedded** in the team rather than a central pool that takes tickets.

> **The professional reality:** the ownership question isn't "who writes the words" — it's "who is accountable when the doc is wrong, and is that person discoverable and resourced?" "Everyone" is not an answer; it's the absence of one. Name an owner per doc, match the ownership model to the audience tier, and for anything customer-facing, fund the tech-writer partnership rather than hoping engineers will find the time to also be good writers.

---

## Culture and Incentives — Why Good Docs Don't Get Written

You can have a perfect rubric, a green gate, and named owners, and docs will *still* be bad if the organization only rewards shipping features. Doc quality is fundamentally an incentives problem, and it has **the same root cause as technical debt**: it's invisible, deferred-cost work whose absence doesn't hurt until later and whose presence is hard to credit.

### The same root as tech debt

Bad docs and tech debt are the same economic pathology wearing different clothes. Both are:

- **Invisible when neglected.** A missing doc and a missing test both look exactly like "feature shipped" on the day of the demo. The cost — a confused customer, a 2 a.m. on-call who can't find the runbook, a three-month onboarding — lands later, on someone else, untraceable to the omission.
- **Punished by feature-only incentives.** When promotions, praise, and roadmaps are denominated in shipped features, time spent on docs is time spent on something the system doesn't count. A rational engineer under that incentive structure *correctly* deprioritizes docs, exactly as they correctly accrue tech debt. (This is the same dynamic that [Technical Debt Management](../../technical-debt-management/) exists to counter.)
- **A tragedy of the commons.** The cost of bad docs is paid by the whole org (and future selves); the cost of writing them is paid by one person now. Without an intervention that re-internalizes that cost, the equilibrium is "nobody writes them."

Naming this is itself a professional skill: when leadership asks "why are our docs bad despite smart engineers," the answer is **not** "they don't care" — it's "we built an incentive system that makes neglecting docs the rational choice, identical to how we accrue tech debt." That reframe moves the conversation from blame to system design.

### Making doc quality visible and valued

The intervention is to make the invisible visible and the valued countable:

- **Surface the cost.** Tie doc gaps to things the org already feels — support tickets that a doc would have deflected, onboarding time, repeated questions in support channels, incident time lost to a missing runbook. A doc problem expressed as "this gap costs us N support tickets a month" gets funded; expressed as "our docs could be better" does not. (Quantifying this is the whole point of [Measuring Docs ROI](../06-measuring-docs-roi/professional.md).)
- **Make doc work creditable.** If it isn't in the promotion rubric, the perf review, or the sprint, it doesn't exist. Count it: doc contributions in performance reviews, a "docs" line in the definition-of-done, explicit recognition for the runbook that saved an incident. What gets measured and rewarded gets written.
- **Lower the cost of doing it right.** Templates, linters, and docs-as-code (above) reduce the per-doc cost, which shifts the rational calculation. The cheaper good docs are to produce, the more the feature-incentive can tolerate them.
- **Leadership has to model it.** Culture follows what leaders fund and praise, not what they put on a values poster. A VP who asks "where's the doc?" in a launch review, and a staff engineer who's visibly rewarded for a great runbook, do more than any mandate.

> **The professional reality:** docs don't get written for the same reason tests don't and tech debt accrues — the incentive system rewards visible features and is blind to invisible quality. You cannot exhort your way out of a structural incentive problem. You change it by making the cost of bad docs visible (ROI metrics), making good-doc work countable (perf/DoD), and making good docs cheap (templates/automation). Anything less is a values poster.

---

## Deciding the Quality Bar Per Audience

The most expensive governance mistake is applying one bar to all docs — either gold-plating throwaway notes or shipping customer docs at wiki quality. **Not all docs deserve the same investment, and pretending they do bankrupts the effort.** A professional sets an explicit, *tiered* bar so quality investment tracks the cost of the doc being wrong.

The governing question is: **what does it cost when this doc is bad, and how many people pay?** That's the same blast-radius logic the rest of [Quality Engineering](../) uses to decide how much testing a thing needs.

| Tier | Examples | Audience & blast radius | Quality bar | Ownership | Investment |
|---|---|---|---|---|---|
| **External / customer** | Public API reference, product docs, SDK guides, getting-started | Customers; bad docs → lost deals, support load, brand damage | Highest: tech-writer-edited, executable snippets, link-checked, reviewed, versioned | Tech-writer partnership | High, sustained |
| **Internal durable** | Architecture docs, ADRs, runbooks, service READMEs, onboarding | Colleagues over years; bad docs → incidents, slow onboarding | High: rubric-enforced, owned, review-by dates, in CI | Team-owns, code-adjacent | Medium, ongoing |
| **Internal working** | Design docs in flight, meeting notes, sprint scratch | Small group, short term; low cost if imperfect | Just-enough: clear to the people in the room | Author-owns | Low |
| **Throwaway** | One-off migration notes, debugging scratchpads | One person/once; cost of perfection > cost of loss | Minimal — and **mark it disposable** with an expiry | Author-owns, expires | Near-zero |

Three professional disciplines make tiering work:

- **Decide the tier explicitly, up front.** The waste isn't writing a throwaway doc badly — that's correct. The waste is *not knowing which tier you're in* and either polishing scratch notes or shipping customer docs at scratch quality. State the tier in the template/frontmatter so the bar is unambiguous.
- **Mark disposable docs as disposable.** The graveyard of internal wikis is full of throwaway notes that were never labeled throwaway, so readers trusted them as durable and got burned. A disposable doc with an explicit expiry and "scratch — do not rely on after $DATE" banner is *fine*; an unlabeled one is a landmine. (Freshness tooling — [Freshness & Rot Metrics](../03-freshness-and-rot-metrics/professional.md) — operationalizes the expiry.)
- **Don't let a doc silently change tiers.** A scratch design doc that becomes the de-facto architecture reference has been promoted in importance without being promoted in quality — the classic "temporary became permanent" trap. When a doc's audience grows, its tier (and bar, and owner) must be re-set deliberately.

> **The professional reality:** "how good should this doc be?" has no universal answer — it's a function of audience and blast radius. The skill is setting the bar *deliberately and per-tier*, then spending quality effort where being wrong is expensive (customer docs, runbooks) and explicitly *not* spending it where it isn't (scratch). Uniform standards either bankrupt the effort or ship customer docs at wiki quality.

---

## Measuring Program Success Without Gaming It

Once you've defined a standard, embedded a gate, assigned ownership, and tiered the bar, the last governance question is: **is the program actually working — and how do I know without the metric corrupting the behavior?** This is the hardest part, and it's why an entire downstream topic exists for it.

The trap is universal: every doc metric that's easy to collect is easy to game, and the moment you make it a target, people optimize the proxy instead of the goal (Goodhart's Law, the same law that ruins [code coverage](../../code-coverage/) as a KPI). Docstring coverage rewards `"""TODO"""`. Page views reward clickbait titles and *rise* when docs are so confusing people reload them. Word count rewards padding. Number-of-docs rewards fragmentation.

The professional posture, kept brief here because [Measuring Docs ROI](../06-measuring-docs-roi/professional.md) is the full treatment:

- **Measure outcomes, not artifacts.** The goal of docs is that readers *succeed* — find the answer, complete the task, stop filing the ticket. So measure ticket deflection, time-to-first-success, self-service rate, search-success rate — proxies for *reader success*, not for *doc existence*.
- **Prefer signals that improve only when docs genuinely improve.** "Support tickets on topic X dropped after we wrote the X guide" is hard to fake and tied to real value. "Docstring coverage hit 90%" is trivial to fake and tied to nothing.
- **Triangulate; never single-metric.** Any one number gets gamed; a basket (deflection + task success + qualitative feedback + freshness) is far harder to corrupt and far more honest.
- **Watch for the metric degrading the behavior.** If a gate or KPI starts producing `TODO` docstrings, padded pages, or clickbait headings, the metric is now actively harmful — kill it. A program-success metric that corrupts the thing it measures is worse than no metric.

> **The professional reality:** you govern what you measure, and you corrupt what you measure badly. Tie program success to *reader outcomes* (deflection, task success), triangulate across several signals, and treat any metric that starts getting gamed as a defect in the metric. The full method — attribution, leading vs lagging indicators, and not gaming page views — is the subject of [Measuring Docs ROI](../06-measuring-docs-roi/professional.md).

---

## War Stories

**The rubric that raised quality vs the checklist that became box-ticking.** Two orgs introduced a "doc definition of done." The first wrote a rubric whose items were *observable and consequential* — "every snippet runs in CI," "has an owner and a review-by date," "single Diátaxis genre" — and routed the judgment items (is this clear?) to human review. Doc quality measurably rose, because each box could only be checked by the doc actually being better. The second wrote a checklist of *box-tickable proxies* — "has an intro," "is over 200 words," "has at least one heading" — and within a quarter authors were mechanically satisfying every box while producing docs nobody could use. Same idea, opposite outcome. The lesson: a rubric is only as good as whether its items are fakeable. If a box can be checked without the doc improving, it will be — and the checklist becomes theater that *teaches* gaming.

**The tech-writer embed that transformed a product's docs.** A product had accurate, exhaustive, engineer-written API docs that customers still couldn't use — every endpoint was documented, none of it formed a usable path, and support drowned in "how do I actually do X" tickets. The fix wasn't more docs; it was embedding one technical writer in the team with ownership of the customer-facing docs and a mandate to partner with engineers for accuracy. The writer didn't add content — they restructured it into task-oriented how-tos, enforced consistent terminology, and built a getting-started path. Support tickets on the documented topics dropped sharply within two quarters. The engineers had supplied correctness all along; what was missing was the clarity, structure, and *dedicated ownership* a trained writer brings. The lesson: accuracy is necessary and nowhere near sufficient, and "engineers will document it" silently omits the half of doc quality engineers aren't resourced or trained to provide.

**The "self-documenting code" team whose onboarding took months.** A team prided itself on writing such clean, well-named code that "the code is the documentation" — and therefore wrote almost none. Internally it worked, because the original authors carried the architecture, the *why*, and the operational knowledge in their heads. Then they scaled and started hiring, and new engineers took *months* to become productive, because clean code tells you *what* the code does, never *why* this design over the alternatives, *how* the pieces fit at the system level, or *how* to operate it in production. "Self-documenting code" had quietly redefined "documentation" as "API-level what" and discarded the explanation and operational genres entirely. The lesson: clean code is a substitute for *comments-that-restate-the-code*, not for architecture docs, ADRs, runbooks, and onboarding guides. "The code is self-documenting" almost always means "we wrote no explanation or operational docs and won't feel it until we grow."

---

## Decision Frameworks

**How much doc quality does THIS thing need? Ask, in order:**
- **Who reads it, and how many?** One person (scratch bar) → a team for years (durable bar) → customers (highest bar). Audience sets the floor.
- **What does it cost when it's wrong?** A confused author (cheap) → a blown incident or lost deal (expensive). Blast radius sets the investment.
- **How long will it live?** Days (throwaway, mark it disposable + expiry) → years (durable, owned, in CI). Lifespan sets the maintenance commitment.
- **Then:** match the *tier* (external / internal-durable / internal-working / throwaway), and with it the bar, the owner, and the gate. Don't gold-plate scratch; don't ship customer docs at wiki quality.

**Build vs adopt the standard? Ask:**
- A style guide? → **Adopt** Google/Microsoft + house deltas; never author from scratch.
- A rubric / DoD? → Author a *short* one (≤ 7 binary items); borrow the attributes from senior.md.
- Templates? → Author per genre; this is your highest-leverage investment.

**Is a proposed doc gate real or theater? Ask:**
- Can it be satisfied *without the doc getting better*? → theater (coverage %, word count, "file touched"). Cut it.
- Does passing *require* a true improvement? → real ("snippet runs," "no broken links," "reference updated in same PR"). Keep it.
- Does it route taste to humans and mechanize only the mechanical? → real. If it tries to mechanize taste → theater.

**Who should own this doc? Ask:**
- Customer-facing? → tech-writer partnership (writer owns, engineer sources accuracy).
- Code-adjacent (reference, runbook, README)? → the team that owns the code, doc in the repo, `CODEOWNERS` entry.
- Short-lived internal? → author-owns, with an expiry.
- *Always:* a named, discoverable owner. "Everyone" = nobody.

---

## Mental Models

- **Good docs at scale are structural, not heroic.** Templates make good the default, linters catch the mechanical, the rubric backstops judgment. If quality depends on the one engineer who cares, it leaves when they do.

- **"Everyone's job" is "nobody's job."** Diffuse ownership of a specific artifact is a commons problem — the equilibrium is rot. Name an owner, make them discoverable, match the model to the audience.

- **Bad docs are tech debt wearing different clothes.** Same root cause: invisible deferred-cost work that feature-only incentives punish. You can't exhort your way out of a structural incentive — you change the incentive.

- **A gate is real iff passing requires the doc to be better.** "Snippet runs" is real; "coverage ≥ 90%" is theater. Gate on properties expensive to fake and cheap to verify; route taste to humans.

- **The quality bar is a function of audience and blast radius.** Customer docs and scratch notes are not the same product. Decide the tier deliberately, spend where being wrong is expensive, and mark disposable docs disposable.

- **You corrupt what you measure badly.** Every easy doc metric is gameable; the moment it's a target, people optimize the proxy. Measure reader *outcomes*, triangulate, and kill any metric that starts getting gamed.

---

## Common Mistakes

1. **A "well-written" rubric instead of a binary one.** If a checkbox needs taste to evaluate, two reviewers disagree and the rubric is useless. Make items observable ("snippet runs," "has an owner") and route judgment to human review.

2. **Authoring a style guide from scratch.** It's a multi-month project that produces something worse than Google's or Microsoft's, free today. Adopt a base, add only house deltas, and automate the mechanical part with Vale.

3. **Confusing "linter green" with "good doc."** A prose linter catches passive voice and banned filler; it cannot tell if the content is correct or useful. Vale-passing nonsense is still nonsense. The linter handles mechanics; the rubric and human review handle correctness.

4. **A gate that measures a gameable proxy.** Docstring coverage, word count, and "a `.md` was touched" are satisfied without any doc improving — and they *teach* the org to game. Gate only on properties that require a real improvement to pass.

5. **"Docs are everyone's responsibility."** This is the absence of ownership, not the presence of it. Every doc that matters gets a named, discoverable owner and an ownership model matched to its audience tier.

6. **Expecting engineers to also be technical writers.** Engineers own correctness; clarity, structure, and audience-fit are a distinct, trainable skill that needs time and mandate. For customer-facing docs, fund the writer partnership instead of hoping.

7. **Exhorting people to "care more" about docs.** It's a structural incentive problem identical to tech debt — feature-only rewards make neglecting docs rational. Change the system (make cost visible, make doc work creditable, make it cheap), don't moralize.

8. **One quality bar for all docs.** Uniform standards either bankrupt the effort polishing scratch notes or ship customer docs at wiki quality. Tier the bar by audience and blast radius, and decide the tier up front.

9. **Letting a doc change tiers silently.** A scratch doc that becomes the de-facto architecture reference is now load-bearing at scratch quality — the "temporary became permanent" trap. Re-set the tier, bar, and owner deliberately when a doc's audience grows.

---

## Test Yourself

1. Your org's docs are inconsistent in quality across forty authors. Name the three artifacts you'd introduce to make "good" reproducible, and explain what each one does that the others can't.
2. Distinguish a *real* docs-quality CI gate from a *theater* one. Give two examples of each and state the one-line discriminator.
3. Leadership asks why docs are bad "despite smart engineers." Give the systems-level answer and name the other engineering problem it's structurally identical to.
4. "Docs are everyone's responsibility." Why is this a problem rather than a solution, and what do you replace it with?
5. You're deciding how much to invest in (a) a public API reference and (b) a one-off migration note. Walk through the framework and state the bar, owner, and investment for each.
6. A team says "our code is self-documenting, so we don't write docs," and onboarding takes months. What category of documentation has "self-documenting code" silently discarded, and why doesn't clean code cover it?
7. Why is "increase docstring coverage to 90%" a bad program-success metric, and what would you measure instead?

<details>
<summary>Answers</summary>

1. **Templates** (per genre) make good *structure* the default, so an average author still clears the bar — quality becomes structural, not heroic. **A linter (Vale)** enforces the *mechanical* style rules consistently and automatically (terminology, passive voice, banned filler) — something humans enforce inconsistently. **A rubric / definition-of-done** is the human-judgment backstop for *correctness and usefulness* — the things machines can't see. The template prevents structural omissions, the linter prevents mechanical defects, the rubric catches semantic ones; none substitutes for the others.
2. **Discriminator:** a gate is real iff passing *requires the doc to actually be better*; it's theater if it can be satisfied by making a number go up without improving the doc. **Real:** "every fenced snippet executes and produces the shown output," "no broken links," "changed public symbols have a doc change in the same PR." **Theater:** "docstring coverage ≥ 90%" (satisfied by `"""TODO"""`), "word count ≥ 200" (satisfied by padding), "a `.md` file was touched" (satisfied by a typo). Gate on what's expensive to fake and cheap to verify; route taste to humans.
3. **Systems answer:** the incentive system rewards visible features and is blind to invisible quality, so a rational engineer correctly deprioritizes docs — it's not a caring problem, it's a structure problem. It's structurally identical to **technical debt**: both are invisible, deferred-cost work, both are punished by feature-only incentives, both are a tragedy of the commons. The fix is changing the system (make cost visible via ROI metrics, make doc work creditable in perf/DoD, make it cheap via templates/automation), not exhortation.
4. Shared ownership of a *specific* artifact is a commons problem: the benefit of maintenance is diffuse, the cost is concentrated on whoever acts, so the rational choice is "move on" and the doc rots. "Everyone" is the absence of accountability, not its presence. **Replace it with:** a named, discoverable owner per doc (CODEOWNERS / frontmatter), with the ownership *model* matched to the audience tier — tech-writer for customer docs, team-owns for code-adjacent, author-owns-with-expiry for scratch.
5. **Framework:** who reads it / how many, what it costs when wrong, how long it lives. **(a) Public API reference** — audience: customers, large; cost-when-wrong: lost deals + support load + brand; lifespan: years. → **Highest bar** (tech-writer-edited, executable snippets, link-checked, versioned, reviewed), **owner:** tech-writer partnership, **investment:** high and sustained. **(b) One-off migration note** — audience: one person, once; cost-when-wrong: low; lifespan: days. → **Minimal bar** (clear to the writer), **owner:** author, *mark it disposable with an expiry*, **investment:** near-zero. The skill is deciding the tier up front so you neither gold-plate (b) nor ship (a) at scratch quality.
6. It has discarded the **explanation** genre (the *why* — design rationale, ADRs, architecture) and the **operational** genre (runbooks, onboarding, how-to-operate-in-prod). Clean code is self-documenting only at the level of *what a piece of code does* — it can never express *why this design over alternatives*, *how the pieces fit at the system level*, or *how to operate it*. "Self-documenting code" almost always means "we wrote no explanation or operational docs," which is invisible until the org grows past the original authors' head-knowledge — hence months-long onboarding.
7. Docstring coverage is a *proxy for doc existence*, not reader success, and it's trivially gamed (`"""TODO"""` on every symbol satisfies it while documenting nothing) — Goodhart's Law, the same failure as code-coverage-as-a-KPI. **Measure instead:** reader *outcomes* — ticket deflection ("tickets on topic X dropped after the X guide"), time-to-first-success, self-service rate, search-success — signals that improve only when docs genuinely help, and triangulate across several so no single one can be gamed.

</details>

---

## Cheat Sheet

```
THE THREE STANDARDIZATION ARTIFACTS (ladder of leverage)
  Template (per genre)  → makes good STRUCTURE the default      highest leverage
  Linter (Vale)         → enforces MECHANICAL style, in CI      cheap, consistent
  Rubric / DoD          → human backstop for CORRECTNESS/USE    reserve for taste
  RULE: skip template→heroics; skip linter→waste seniors; skip rubric→linted nonsense

DOC DEFINITION OF DONE  (binary, observable — no taste in the gate)
  [ ] correct  [ ] complete  [ ] findable  [ ] single Diátaxis genre
  [ ] audience-fit  [ ] has owner + review-by date  [ ] snippets executable

REAL GATE vs THEATER GATE
  real    : snippet runs / no broken links / reference updated in same PR / Vale clean
  theater : coverage % / word count / "a .md was touched" / page exists
  discriminator: can it pass WITHOUT the doc getting better? → theater

OWNERSHIP MODELS (match to audience tier)
  author-owns   → short-lived internal, + expiry
  team-owns     → code-adjacent (reference, runbook, README), in repo, CODEOWNERS
  tech-writer   → customer-facing (writer owns clarity, engineer sources accuracy)
  RULE: "everyone owns it" = nobody owns it. Name a discoverable owner.

AUDIENCE-TIERED QUALITY BAR (cost-when-wrong × #readers × lifespan)
  external/customer  → highest: writer-edited, executable, versioned, sustained
  internal durable   → high: rubric-enforced, owned, review-by, in CI
  internal working   → just-enough: clear to the room
  throwaway          → minimal + MARK DISPOSABLE + expiry
  trap: don't let a doc change tiers silently (scratch → de-facto architecture)

WHY GOOD DOCS DON'T GET WRITTEN (= tech debt)
  invisible deferred-cost work + feature-only incentives + commons = rot
  fix: make cost visible (ROI) · make work creditable (perf/DoD) · make it cheap (templates)
  NOT: "care more" (you can't exhort past a structural incentive)

PROGRAM SUCCESS WITHOUT GAMING
  measure reader OUTCOMES (deflection, time-to-first-success, self-service), not artifacts
  triangulate (basket > single metric) · kill any metric that starts getting gamed
```

---

## Summary

- **Good docs at scale are structural, not heroic.** Make "good" reproducible with three artifacts: **templates** (good structure as the default — highest leverage), a **linter** like Vale (mechanical style, automated in CI), and a short **binary rubric / definition-of-done** (the human backstop for correctness and usefulness machines can't judge).
- **Embed quality in the workflow** the same way you embed code quality: docs reviewed in the PR that changes behavior, the relevant doc update inside the definition-of-done, and a **CI gate that's real, not theater** — gating only on properties that require a genuine improvement to pass ("snippet runs," "no broken links," "reference updated in same PR"), never gameable proxies like coverage or word count.
- **Solve the ownership problem:** "everyone's job" is a commons problem that guarantees rot. Give every doc that matters a **named, discoverable owner**, match the ownership model to the audience tier, and for customer-facing docs fund the **tech-writer partnership** (writer owns clarity, engineer owns correctness).
- **Treat the culture problem as an incentive problem.** Bad docs are **tech debt wearing different clothes** — invisible deferred-cost work that feature-only rewards punish. You change it by making the cost visible ([ROI metrics](../06-measuring-docs-roi/professional.md)), making doc work creditable (perf/DoD), and making good docs cheap (templates/automation) — not by exhorting people to "care more."
- **Set the quality bar per audience.** Customer docs, durable internal docs, working docs, and throwaway notes earn different investment as a function of **blast radius and lifespan**. Decide the tier up front, spend where being wrong is expensive, mark disposable docs disposable, and never let a doc change tiers silently.
- **Measure program success by reader outcomes, not artifacts**, triangulate across signals, and kill any metric that starts getting gamed — the full method is [Measuring Docs ROI](../06-measuring-docs-roi/professional.md).

You can now govern documentation quality as an organizational practice — define the standard, enforce it without theater, own it, fund it, and tier it. The final tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone actually understands what makes docs good and how to make them good at scale.

---

## Further Reading

- [Google Developer Documentation Style Guide](https://developers.google.com/style) — the base to adopt rather than author; the mechanical 80% your linter enforces.
- [Vale](https://vale.sh/) — prose-as-code linting; how to encode a house style guide and run it in CI.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the engineer's guide to the docs lifecycle, including review, ownership, and measuring success.
- [Diátaxis](https://diataxis.fr/) (Daniele Procida) — the genre framework your rubric and templates point at for genre-specific quality.
- *The Pragmatic Programmer* and *Accelerate* — on quality as an organizational property and why incentive structures, not individual virtue, determine outcomes.
- Write the Docs community resources — practitioner accounts of tech-writer/engineer partnership and embedding writers in teams.

---

## Related Topics

- [junior.md](junior.md) · [senior.md](senior.md) · [interview.md](interview.md) — the rest of this topic's tier set (the quality attributes and how to judge a single doc).
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md) — proving the program works without gaming page views; the full treatment of outcome metrics this page forwards to.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/professional.md) — the freshness signals (review-by dates, staleness, broken snippets) a real quality gate enforces.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to write the README, ADR, runbook, and reference whose quality this section *governs*.
- [Technical Debt Management](../../technical-debt-management/) — the same invisible-deferred-cost incentive problem that makes good docs go unwritten, treated head-on.

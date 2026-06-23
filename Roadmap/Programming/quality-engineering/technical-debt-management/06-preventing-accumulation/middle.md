# Preventing Accumulation — Middle Level

> **Roadmap:** [Technical Debt Management](../README.md) → Preventing Accumulation
> *The junior page argued that prevention beats cleanup. This page builds the machine that does it: a Definition of Done that has teeth, CI gates that fail the PR before debt lands, a "clean as you code" ratchet that only judges new code, and the small habits — ADRs, tiny PRs, paved paths — that stop debt at the source instead of mopping it up later.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Definition of Done — the First Gate](#definition-of-done--the-first-gate)
4. [Automated Quality Gates in CI](#automated-quality-gates-in-ci)
5. [Clean as You Code — the Leak/Ratchet Model](#clean-as-you-code--the-leakratchet-model)
6. [Code Review as a Debt Filter](#code-review-as-a-debt-filter)
7. [ADRs — Preventing Decision Debt](#adrs--preventing-decision-debt)
8. [Small PRs — Why Size Is a Debt Signal](#small-prs--why-size-is-a-debt-signal)
9. [Making the Right Thing Easy](#making-the-right-thing-easy)
10. [Worked Example — A Gate That Blocks New Debt](#worked-example--a-gate-that-blocks-new-debt)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What concrete practices and automation keep debt out, and how do I make them enforce themselves?**

The junior page made the case that an ounce of prevention beats a pound of paydown. True — but a *case* doesn't stop debt. What stops debt is a set of mechanisms that run without anyone remembering to run them: a checklist a PR can't merge without satisfying, a CI job that turns red when complexity or duplication climbs, a coverage rule that refuses to let *new* code ship untested.

The unifying idea is **shift the cost of debt left, onto the person introducing it, at the moment they introduce it.** Debt is cheapest to fix in the editor, more expensive in review, far more expensive in `main`, and ruinous in production. Every technique here moves the catch earlier and makes it automatic — because a human who *intends* to keep code clean still forgets under deadline pressure, and a gate does not get tired at 6pm on a Friday.

This page assumes you'll inevitably inherit a codebase that already carries debt. The crucial trick — the one most teams get wrong — is to *stop adding* before you try to pay down. You do that by judging **new code** to a high standard while leaving the old code untouched until you happen to edit it. That's the "clean as you code" / leak model, and it's the spine of this page.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain principal vs interest and why preventing debt is cheaper than repaying it.
- **Required:** You've opened a pull request and seen a CI pipeline run checks against it.
- **Helpful:** You've used a linter and a coverage tool, even if someone else configured them.
- **Helpful:** A working sense of [The Debt Quadrant](../03-the-debt-quadrant/middle.md) — prevention mostly targets *inadvertent* and *reckless* debt; it won't stop a *deliberate, prudent* shortcut, nor should it.

---

## Definition of Done — the First Gate

A user story is not "done" when the feature works on the developer's machine. It's done when it meets a **Definition of Done (DoD)** — an explicit, team-agreed checklist that every change must satisfy before it counts as complete. The DoD is your cheapest debt prevention tool because it's the standard *humans* hold themselves to before automation even runs.

A DoD that actually holds the line on debt includes more than "it works":

- [ ] **Tested** — new behavior covered by tests; the suite passes.
- [ ] **No new lint debt** — no new warnings, no new rule suppressions added to dodge the linter.
- [ ] **Documented** — public APIs, non-obvious decisions, and changed runbooks updated.
- [ ] **ADR written** for any significant or hard-to-reverse decision (a new dependency, a data-model change, a service boundary).
- [ ] **No TODOs without a tracked ticket** — a `// TODO: fix later` with no issue number is invisible debt; link it or fix it.
- [ ] **Migrations and rollbacks** considered for schema or config changes.
- [ ] **Observability** — new code paths emit the logs/metrics needed to debug them in production.

The DoD only works if it's **enforced, not aspirational.** A checklist nobody verifies is decoration. So the pattern is: write the DoD as a team, then *automate every item you can* (lint, coverage, build) into CI gates, and reserve human review for the items a machine can't judge (is the ADR's reasoning sound? does the doc actually explain the *why*?).

> **Key insight:** The DoD is the human-readable contract; the CI gates are its machine-enforced subset. Anything in the DoD that *can* be automated *should* be — because the only debt control that survives a deadline is one that doesn't depend on willpower.

---

## Automated Quality Gates in CI

A **quality gate** is a set of pass/fail conditions in your pipeline that a change must clear to merge. Its entire job is to **fail the PR before the debt lands in `main`.** Once bad code is in `main` it's everyone's problem and far harder to remove; on a PR it's still one person's branch and one revert away from gone.

The standard battery of automated gates:

| Gate | What it catches | Typical failure condition |
|---|---|---|
| **Lint / format** | style drift, error-prone patterns, unused code | any new warning; any new suppression |
| **Complexity ceiling** | functions/files growing unmaintainable | cyclomatic complexity > N on a changed function |
| **Coverage on new code** | untested new logic ("the ratchet") | new-code coverage < 80% |
| **Duplication** | copy-paste accumulating | duplicated lines on new code > threshold |
| **Dependency / vuln scan** | known-vulnerable or unvetted libraries | a new dependency with a critical CVE |
| **Build / type check** | broken compilation, type regressions | non-zero exit from build or type checker |

The deep question is **blocking vs non-blocking.** A gate that merely *warns* is, within weeks, wallpaper — people scroll past a yellow check the way they scroll past a cookie banner. A gate that *blocks the merge* is the only kind that changes behavior. The discipline is to make the blocking set **small, fast, and almost never wrong**: if your gate produces false positives, engineers learn to bypass it, and a routinely-bypassed gate is worse than no gate because it teaches the team that gates are negotiable. Tune for near-zero false positives, then make it mandatory. (The full design — thresholds, gate placement, what belongs blocking vs advisory — is its own subject: see [Quality Gates](../../quality-gates/) and the analysis engines in [Static Analysis](../../static-analysis/).)

> **Key insight:** A non-blocking quality gate is a suggestion, and suggestions don't stop debt. The moment of leverage is the *merge button*: a gate only prevents accumulation if a red gate means the PR cannot land. Buy that strictness with low false-positive rates, not with leniency.

---

## Clean as You Code — the Leak/Ratchet Model

Here is the mistake that sinks most "let's improve quality" initiatives: the team turns on a coverage requirement or a complexity rule **against the whole codebase**, the existing code fails it by a mile, and the gate goes red on every PR — including PRs that touched nothing related. Within a week the gate is disabled "until we clean things up," which never happens.

The fix is **clean as you code** (the model SonarQube made popular): *don't judge the past; only judge what you're adding or changing now.* The gate evaluates the **new code in this PR** — the lines you wrote or modified — and ignores the legacy code you didn't touch. You make zero up-front demands on the existing mess; you simply guarantee it **stops getting worse.**

The metaphor is a **leaking pipe.** The water already on the floor is your existing debt. Before you mop, you fix the leak — otherwise you mop forever. "New code" is the leak; clean-as-you-code patches it so the puddle stops growing. Once the leak is sealed, the old water evaporates on its own: every time you edit a legacy file, the new-code rule forces that *changed* slice up to standard (the boy-scout rule, made mandatory — see [Paying Down Debt](../05-paying-down-debt/middle.md)). The codebase converges toward clean **along the path of actual work**, with no doomed "stop everything and fix it all" project.

This is the **ratchet**: a one-way mechanism that lets a value improve but never regress. Coverage is the classic case.

- **Whole-codebase coverage gate:** "the project must be ≥ 80% covered." On a 40%-covered legacy app this is red forever → ignored.
- **New-code coverage gate (the ratchet):** "code added or changed in this PR must be ≥ 80% covered." Achievable in every PR, regardless of the legacy baseline. Overall coverage then climbs *monotonically* as a side effect, because every new line is well-covered and every touched line gets dragged up.

You can ratchet more than coverage: lint warnings ("the warning count must not increase"), bundle size, the number of `any` types in a TypeScript codebase, open vulnerabilities. The pattern is identical — pick a metric, freeze the current value as the baseline, and let the gate permit *better or equal* but reject *worse*.

> **Key insight:** Quality requirements aimed at the whole legacy codebase get switched off; quality requirements aimed only at **new code** get kept on — and they fix the legacy gradually for free, because the codebase improves wherever you actually do work. Seal the leak first; the puddle takes care of itself.

---

## Code Review as a Debt Filter

Automation catches what's *measurable* — complexity, coverage, duplication, known CVEs. It cannot judge whether an abstraction is right, whether a name lies, whether this is the third near-copy of a pattern that should be unified, or whether a "temporary" hack is being smuggled in as permanent. That judgment is the job of **code review**, and review is your last human gate before debt becomes shared property.

Review degrades into rubber-stamping unless it has a **shared checklist** that makes "what are we even looking for?" explicit. A debt-focused review checklist:

- **Design** — Does this fit the existing architecture, or is it a one-off that creates an inconsistent way of doing a thing we already do? (Accidental architecture is decision debt — see below.)
- **Duplication** — Is this logic already implemented somewhere? Could it be reused instead of copied?
- **Tests** — Do the tests assert *behavior*, or do they just pad coverage? Would they catch a real regression?
- **Naming & clarity** — Will someone unfamiliar understand this in six months without the author present?
- **Shortcuts** — Is anything here a knowing compromise? If so, is it *tracked* (ticket / TODO with an issue) so it's deliberate-prudent debt, not silent debt?
- **Blast radius** — Does this change something load-bearing that deserves extra scrutiny or an ADR?

Two practices keep review effective as a filter. First, **separate blocking comments from suggestions** — adopt a convention (`nit:` for optional, plain comments for must-fix) so authors know what actually blocks the merge and reviewers can wave through trivia. Second, **small PRs** (next section): a reviewer reads a 50-line diff carefully and a 2,000-line diff not at all, so the size of the PR directly sets the quality of the review. Review is only a debt filter if the diff is small enough to actually filter. (For the full discipline — review SLAs, author/reviewer etiquette, when to pair instead — see [Code Review](../../code-review/).)

---

## ADRs — Preventing Decision Debt

Not all debt is in the code. **Decision debt** is the cost of choices nobody can reconstruct: *why* are we on this database, *why* does auth live in the gateway, *why* did we reject the obvious approach? When that reasoning is lost, two expensive things happen. Teams **re-litigate** settled decisions every few months because no one remembers they were settled, burning hours re-deriving the same conclusion (or, worse, reversing a good call for reasons it already accounted for). And new work drifts into **accidental architecture** — each change makes a locally sensible choice in ignorance of the system's intended shape, and the architecture becomes whatever the diffs happened to add up to, which no one designed and no one can defend.

An **Architecture Decision Record (ADR)** prevents this. It's a short, version-controlled document — one per significant decision — that captures, at the moment of deciding:

```markdown
# ADR-014: Use PostgreSQL for the orders service

## Status
Accepted — 2026-06-18

## Context
Orders need multi-row transactional integrity and ad-hoc reporting
queries. Write volume is moderate (< 500 TPS). The team has deep
SQL experience and little operational experience with Mongo.

## Decision
Use PostgreSQL as the primary store for the orders service.

## Consequences
+ Strong transactions and mature tooling; reuses team SQL skills.
+ Reporting via SQL without a separate analytics pipeline.
- Horizontal write-scaling will need work if volume 10×'s; revisit then.
- Ops must own backups, failover, and connection pooling.
```

The format is deliberately tiny — **Context / Decision / Consequences** — because an ADR nobody writes prevents nothing, so the cost of writing one must be minutes. The payoff is that the *reasoning* lives next to the code, in the repo, immutable. When someone asks "why are we on Postgres?" in eight months, the answer is ADR-014, not a Slack-archaeology expedition or a meeting. And because each ADR records the *intended* shape of the system, new changes can be checked against it — which is exactly what stops accidental architecture. Add "ADR written for significant decisions?" to your DoD and your review checklist, and you've made decision debt a thing the team catches by default.

---

## Small PRs — Why Size Is a Debt Signal

A large pull request is a debt-prevention failure on its own, independent of what's inside it, for three compounding reasons:

1. **Big PRs evade review.** Reviewer attention per line collapses as the diff grows. Past a few hundred lines, review becomes a skim and a LGTM, so the *human* gate — the one meant to catch what automation can't — stops functioning exactly when there's the most to catch.
2. **Big PRs hide debt in the noise.** A questionable shortcut is obvious in a 40-line diff and invisible inside 1,500 lines of legitimate change. Size is camouflage.
3. **Big PRs couple unrelated changes**, so a single problem blocks everything and reverting is all-or-nothing. The cost of any one mistake scales with the size of the PR it's buried in.

So **keep PRs small** — ideally one logical change each, reviewable in well under an hour. This isn't a style preference; it's structural debt prevention, because it keeps the human filter working and denies debt a place to hide. The enabling techniques are worth naming: stack small PRs on top of each other; hide unfinished work behind **feature flags** so you can merge incrementally without shipping; and split refactoring from behavior change into **separate PRs** so reviewers can see each clearly (a refactor PR should change *no* behavior; a behavior PR should do *no* drive-by refactoring). A reviewer who can hold the whole diff in their head is a reviewer who can catch debt; a reviewer faced with a wall of changes is a rubber stamp with extra steps.

---

## Making the Right Thing Easy

Gates are *negative* — they punish debt after someone writes it. The most durable prevention is **positive**: make the correct, debt-free path the *easiest* path, so engineers fall into the pit of success without effort or discipline. People under deadline pressure take the path of least resistance every time; the job is to make that path the right one.

Concretely:

- **Templates / scaffolds.** A `create-service` generator that emits a new service already wired with logging, the standard error handling, a test harness, a CI config, and a lint setup means a new service starts *clean by construction* — nobody has to remember to add observability, because it's already there.
- **Paved paths (golden paths).** A blessed, well-documented, well-supported default way to do common things — the approved HTTP framework, the standard way to talk to the database, the sanctioned deployment pipeline. Engineers *can* deviate, but the default is so well-trodden that deviating is the rare, deliberate act (which is then exactly when you'd expect an ADR).
- **Project templates with the gates pre-wired.** When the linter, the coverage ratchet, and the CI gates ship *inside* the scaffold, every new project is born compliant. There's no "we'll add quality tooling later," because later never comes.
- **Good defaults in shared libraries.** A platform HTTP client that retries, times out, and emits metrics *by default* prevents a whole class of debt (the hand-rolled client with no timeout) by making the safe version the one that's already in front of you.

> **Key insight:** A gate stops the wrong thing; a paved path supplies the right thing. Gates alone breed a cat-and-mouse culture where engineers route around the rules; pair them with paved paths and the right thing becomes the *low-effort* thing, so prevention stops depending on vigilance and starts depending on inertia — which is far more reliable.

---

## Worked Example — A Gate That Blocks New Debt

Wire up a CI quality gate that blocks any PR that adds untested new code, raises complexity, or pulls in a vulnerable dependency. The goal is a small, fast, near-zero-false-positive set of **blocking** checks.

A GitHub Actions workflow that runs on every PR:

```yaml
# .github/workflows/quality-gate.yml
name: quality-gate
on: pull_request                 # runs against the PR before merge

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # full history → can diff against base

      - name: Lint — no NEW warnings
        run: npm run lint -- --max-warnings 0

      - name: Tests + coverage
        run: npm test -- --coverage

      # Coverage RATCHET: judge only code changed in this PR.
      - name: Coverage on new code
        run: npx diff-cover coverage/lcov.info \
               --compare-branch=origin/${{ github.base_ref }} \
               --fail-under=80          # NEW code must be ≥80% — legacy ignored

      - name: Complexity ceiling
        run: npx eslint . --rule '{"complexity": ["error", 12]}'

      - name: Dependency vulnerability scan
        run: npm audit --audit-level=high   # fail on high/critical CVEs
```

Then make the job **required** in branch protection so a red gate physically blocks the merge button. (A gate that isn't required is advisory, and advisory gates get ignored — see [Quality Gates](../../quality-gates/).)

The load-bearing line is the **coverage ratchet**. `diff-cover` computes coverage *only on the lines this PR changed*, measured against the base branch — so an 80% threshold is enforceable even on a codebase sitting at 35% overall. A PR that adds an untested function turns the gate red; a PR that touches only well-tested code stays green; and total coverage climbs over time with no big-bang effort, because every new line clears the bar and every touched line gets dragged up to it.

A homegrown ratchet is the same idea in a few lines — store last commit's metric, fail if the new one is worse:

```bash
# ratchet.sh — fail if lint-warning count increased vs the committed baseline
prev=$(cat .quality/lint-warnings.txt)        # baseline, committed to the repo
curr=$(npm run -s lint | grep -c 'warning')
if [ "$curr" -gt "$prev" ]; then
  echo "Lint warnings rose ${prev} → ${curr}. Fix new warnings or update baseline."
  exit 1                                        # block: things got worse
fi
echo "$curr" > .quality/lint-warnings.txt       # things got better/equal → save new floor
```

The mechanism is the same everywhere: **a baseline that can move down but never up.** Whatever you measure — warnings, duplication, `any` count, open vulns — the ratchet permits *better-or-equal* and rejects *worse*, which is the entire job of preventing accumulation.

---

## Mental Models

- **Shift the cost of debt left.** Debt is cheapest in the editor, costlier in review, expensive in `main`, ruinous in production. Every gate exists to catch debt one step earlier and bill it to the person who introduced it, while it's still cheap to fix.

- **Fix the leak before you mop.** Existing debt is water on the floor; new code is the leak. Clean-as-you-code patches the leak so the puddle stops growing — then it shrinks on its own, because every edit drags the touched code up to standard.

- **A ratchet only turns one way.** Pick a metric, freeze today's value as the floor, and let the gate accept better-or-equal but reject worse. Quality then can't regress, and improves wherever work happens — with no dedicated cleanup project.

- **A non-blocking gate is wallpaper.** A check that warns gets scrolled past within a week. The merge button is the only point of leverage; a gate prevents debt only if red means *cannot merge*. Earn that strictness with low false-positive rates.

- **Make the right thing the easy thing.** Gates stop the wrong path; paved paths and scaffolds supply the right one for free. Prevention that relies on willpower fails under deadline; prevention that relies on the default path holds.

---

## Common Mistakes

1. **Turning on a quality gate against the whole codebase.** The legacy code fails instantly, the gate is red on unrelated PRs, and within a week it's disabled "temporarily." Judge **new code only** (clean-as-you-code); the legacy fixes itself as you go.

2. **Making gates non-blocking "to start gently."** A warning that doesn't block the merge is ignored almost immediately. If a check matters, make it required; if it doesn't, delete it. There's no useful middle.

3. **Gates with high false-positive rates.** A gate that's wrong even occasionally teaches engineers to bypass it, and a routinely-bypassed gate is worse than none — it normalizes overriding gates. Tune to near-zero false positives, *then* make it mandatory.

4. **Coverage as a number instead of a safety net.** An 80% target met with assertion-free tests that just execute lines is theater. Review whether tests assert *behavior*; coverage measures what ran, not what's verified.

5. **Letting PRs grow huge.** Big PRs evade review and hide debt in the noise — the human filter fails exactly when there's most to catch. Keep PRs to one logical change; use feature flags and stacked PRs to stay small.

6. **No record of *why*.** Decisions made in Slack and forgotten become decision debt: teams re-litigate settled choices and drift into accidental architecture. Write a tiny ADR (Context/Decision/Consequences) for anything significant or hard to reverse.

7. **Relying only on gates, never on paved paths.** Pure enforcement breeds a route-around-the-rules culture. Pair gates with scaffolds and golden paths so the clean way is also the easy way, and prevention stops depending on discipline.

---

## Test Yourself

1. Your team turns on an 85%-coverage gate. The codebase is at 40%, so every PR — even unrelated ones — goes red, and two weeks later the gate is off. What model should they have used, and why does it succeed where the whole-codebase gate failed?
2. What is a coverage *ratchet*, and why does overall coverage rise over time even though the gate only ever checks new code?
3. Why is a *non-blocking* quality gate close to worthless for preventing debt? What's the one condition that makes a gate effective?
4. A reviewer routinely approves 1,500-line PRs in five minutes. Name two distinct ways this PR size actively *causes* debt to accumulate.
5. What category of debt do ADRs prevent, and what are the two failure modes that appear when the *why* behind decisions is lost?
6. You've written strict gates and the team is quietly bypassing them. Beyond enforcement, what's the missing half of a prevention strategy?

<details>
<summary>Answers</summary>

1. **Clean as you code** — evaluate only the *new/changed* code in each PR and ignore untouched legacy. It succeeds because every PR can actually clear the bar regardless of the legacy baseline, so the gate is never red for reasons outside the author's control and therefore never gets disabled. The whole-codebase gate failed because it demanded the impossible (fix all legacy first), so it was either red forever or switched off.

2. A ratchet enforces a quality threshold (e.g. ≥80% coverage) **only on the lines a PR adds or changes**, measured against the base branch. Overall coverage rises monotonically because every new line is well-covered *and* every legacy line you happen to edit gets dragged up to the bar — so the average climbs along the path of real work, with no dedicated cleanup effort.

3. A non-blocking gate only *warns*, and warnings get scrolled past like a cookie banner within a week. The one condition that makes a gate effective is that **a red gate blocks the merge** — the merge button is the only real point of leverage. (That strictness must be bought with low false-positive rates, or people learn to override it.)

4. (a) **It evades review:** attention per line collapses as the diff grows, so the human filter — meant to catch what automation can't — degrades to a rubber stamp exactly when there's the most to catch. (b) **It hides debt in the noise:** a questionable shortcut that'd be obvious in 40 lines is invisible inside 1,500 lines of legitimate change. (Also acceptable: it couples unrelated changes so reverting is all-or-nothing.)

5. ADRs prevent **decision debt**. The two failure modes when the *why* is lost: (a) teams **re-litigate** settled decisions repeatedly, wasting time re-deriving (or wrongly reversing) past conclusions; (b) work drifts into **accidental architecture** — each change is locally sensible but ignorant of the intended design, so the architecture becomes whatever the diffs added up to, designed by no one.

6. **Paved paths / making the right thing easy.** Gates are purely negative — they punish the wrong path — which breeds a cat-and-mouse, route-around-the-rules culture. Pairing them with scaffolds, templates, and golden paths makes the clean approach the *low-effort* one, so engineers fall into the pit of success instead of fighting the gates.

</details>

---

## Cheat Sheet

```
THE GOAL
  Shift debt's cost LEFT — catch it in the PR, bill it to the author,
  while it's still cheap. main = everyone's problem; PR = one revert away.

DEFINITION OF DONE  (human contract; automate every item you can)
  tested · no new lint debt · docs updated · ADR for big decisions
  · no untracked TODOs · migrations/rollback · observability

CI QUALITY GATES  (must be BLOCKING + low false-positive)
  lint --max-warnings 0      complexity ceiling (e.g. ≤12)
  coverage ON NEW CODE ≥80%  duplication on new code
  dependency/vuln scan       build + type check
  → make the job REQUIRED in branch protection (red = no merge)

CLEAN AS YOU CODE  (the leak model)
  judge NEW code only; leave legacy until you touch it
  fix the leak → puddle stops growing → evaporates as you edit
  whole-codebase gate = disabled in a week; new-code gate = kept on

RATCHET  (one-way: better-or-equal OK, worse = fail)
  coverage · lint warnings · bundle size · `any` count · open vulns
  freeze today's value as the floor; only let it improve

REVIEW = DEBT FILTER  (needs a checklist + SMALL diffs)
  design fit · duplication · tests assert behavior · naming
  · tracked shortcuts · blast radius   |  nit: = optional, else blocks

ADRs → kill DECISION debt
  Context / Decision / Consequences — minutes to write, lives in repo
  stops re-litigation + accidental architecture

SMALL PRs  (size is a debt signal)
  big PR = evades review + hides debt + couples changes
  → feature flags, stacked PRs, refactor SEPARATE from behavior

PAVED PATHS  (positive prevention)
  scaffolds/templates born compliant · golden paths · safe-by-default libs
  make the right thing the EASY thing → prevention without willpower
```

---

## Summary

- The **Definition of Done** is the human contract for "complete" — tested, documented, no new lint debt, ADR for significant decisions. It's your cheapest prevention, and everything in it that *can* be automated *must* be, because only automatic controls survive a deadline.
- **CI quality gates** (lint, complexity, coverage-on-new-code, duplication, vuln scan) exist to **fail the PR before debt lands in `main`.** They work only when they're **blocking** and almost never wrong — a non-blocking or false-positive-prone gate gets ignored or bypassed, which is worse than nothing.
- **Clean as you code** is the spine: judge **new code** to a high bar and leave legacy alone until you touch it. Fix the leak before you mop — the puddle then stops growing and shrinks on its own. Whole-codebase gates get switched off; new-code gates get kept on and fix the legacy gradually for free.
- The **ratchet** generalizes this: freeze a metric's current value as a floor and let it move only toward better. Coverage, warnings, bundle size, `any` count — all ratchetable.
- **Code review** is the human filter for what automation can't measure (design, naming, smuggled shortcuts); it needs a **checklist** and **small PRs** to stay effective. Big PRs evade review and hide debt — keep them to one logical change.
- **ADRs** prevent **decision debt** — without the recorded *why*, teams re-litigate settled choices and drift into accidental architecture. And **paved paths** make prevention positive: scaffolds and golden defaults make the clean path the easy path, so prevention doesn't depend on vigilance.

---

## Further Reading

- *Clean as You Code* — SonarSource's articulation of the new-code / leak model; the canonical statement of "don't fix the past, stop adding to it."
- *Managing Technical Debt* — Kruchten, Nord & Ozkaya (SEI) — Chapter on prevention, the DoD, and embedding debt control in the delivery pipeline.
- *Accelerate* — Forsgren, Humble & Kim — the data behind small batch sizes, fast feedback, and CI as quality enablers, not just speed.
- Michael Nygard, *Documenting Architecture Decisions* (2011) — the original ADR blog post; the Context/Decision/Consequences format started here.
- *Trunk-Based Development* (trunkbaseddevelopment.com) — small PRs, feature flags, and short-lived branches as a debt-prevention discipline.

---

## Related Topics

- [junior.md](junior.md) — why prevention beats cleanup, and the broken-windows intuition this page operationalizes.
- [senior.md](senior.md) — fitness functions, a debt budget that holds the line, and prevention at the org/platform scale.
- [05 — Paying Down Debt](../05-paying-down-debt/middle.md) — the other half: clearing the debt already on the floor (the boy-scout rule that the new-code ratchet makes mandatory).
- [03 — The Debt Quadrant](../03-the-debt-quadrant/middle.md) — which debt prevention targets (inadvertent/reckless) and which it shouldn't try to stop (deliberate/prudent).
- [Quality Gates](../../quality-gates/) — the full design of pass/fail gates: thresholds, placement, blocking vs advisory.
- [Code Review](../../code-review/) — review as a discipline: SLAs, etiquette, checklists, and when to pair instead.
- [Static Analysis](../../static-analysis/) — the engines (linters, complexity, duplication, SAST) that power the automated gates above.

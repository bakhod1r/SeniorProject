# Keeping Docs Alive & Fighting Doc Rot — Interview Questions

> **Category:** [Documentation](../README.md) — the capstone discipline: keeping documentation *true* as the code and systems it describes change underneath it.

Conceptual and practical questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Practical Tasks](#practical-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is doc rot? Give three examples.

**Answer:** Doc rot (documentation drift) is documentation that has fallen out of sync with the code/system it describes. Examples: setup steps that no longer work, an API reference listing a deleted endpoint, screenshots of an old UI, dead links, a superseded decision presented as current, a config doc missing recently-added keys.

### J2. Why is a stale doc worse than no doc at all?

**Answer:** A missing doc is *known* missing — you fall back to reading code or asking someone, losing only a little bounded time, and you're never misled. A stale doc looks authoritative, so you trust and follow it, wasting hours, shipping bugs, or causing incidents. Worse, it triggers **trust collapse**: once burned, engineers stop reading *and* stop updating docs, so more rot accumulates — a self-reinforcing loop that poisons every doc.

### J3. Explain the trust-collapse loop.

**Answer:** A doc goes stale → an engineer gets burned → they conclude "the docs are always wrong" → they stop *reading* docs (so docs deliver zero value) and stop *updating* them (why bother, nobody reads them) → with nobody updating, more docs rot → which confirms the belief. It's a vicious cycle that, once started, makes the whole doc set worthless.

### J4. Why does code rarely rot but docs do?

**Answer:** The **asymmetry**: code is run and tested constantly, so breaking it fails loudly (a red build, a crash, a wrong answer). Prose just sits there, untested — breaking its *truth* produces no signal at all, so it rots silently. Every anti-rot strategy works by making the doc "exercised" like code.

### J5. Name the anti-rot strategies from most to least powerful.

**Answer:** (1) Single source of truth — generate the doc from the authoritative source; (2) executable/tested docs — examples run in CI; (3) docs next to code — same repo, same PR, link-checked; (4) ownership & process — CODEOWNERS, Definition of Done, PR checklist; (5) freshness signals — last-reviewed dates, staleness bots, "report an error"; (6) delete/archive ruthlessly. Strategies 1–3 make rot impossible or loud; 4–5 make it visible; 6 shrinks the surface.

### J6. What does "single source of truth" mean for docs?

**Answer:** A fact lives in exactly one authoritative place (the code, the spec, the schema), and every doc view is *generated* from it rather than hand-copied. So the doc literally cannot disagree with the source. Generated beats hand-written because a hand-copy is a second home for the fact — and two homes for a fact will eventually diverge.

### J7. What are "executable docs"?

**Answer:** Docs whose examples actually run in CI — doctests, README snippets extracted and executed, tested onboarding scripts/containers, notebooks run end-to-end. If the code changes and the example breaks, the build goes red, so the example can't silently become a lie.

### J8. Why keep docs in the same repo and PR as the code?

**Answer:** It shrinks the *drift window* — the gap between a behavior changing and its doc changing — toward zero. The doc change is reviewed alongside the code change, so "you changed behavior but not the doc" is a normal review comment. In a separate wiki, updating the doc is a context switch that usually never happens.

### J9. What does "optimize for deletion" mean for docs?

**Answer:** Prefer fewer docs and an easy path to delete them. Less doc surface means less to rot, fewer dead links, less to mislead. A doc you won't keep correct should be deleted or clearly marked superseded — git history preserves it if you ever need it back.

### J10. What's a freshness signal, and what's its limit?

**Answer:** Metadata like a `last_reviewed` date, a staleness bot, or a "report an error" widget — it tells readers how much to trust a doc and flags overdue ones. Its limit: it doesn't *make* a doc fresh; it only reveals possible staleness. It's the weakest tier, used only when generation and testing aren't possible.

---

## Middle Questions

### M1. For an API reference, getting-started steps, and an architecture "why" doc — which anti-rot strategy fits each, and why?

**Answer:** **API reference → generate** from the OpenAPI spec/typed code; it's derivable, and hand-copying guarantees drift. **Getting-started → hand-write but test**; steps span tools so they can't be generated, but you can run the exact script/container in CI so a break fails the build. **Architecture "why" → hand-write, own, and date**; rationale isn't in any machine source, so generation/testing don't apply — guard it with `last_reviewed`, ownership, and reader feedback, and accept it's the rot-prone tier.

### M2. What is the generation boundary?

**Answer:** The line between docs derivable from a machine-readable source (API signatures, CLI flags, config, changelog — *reference*) and docs that are irreducibly human (the *why*, trade-offs, mental models — *explanation*). Generation can make the left side rot-proof and can do nothing for the right side. The skill is deriving everything left of the boundary and shrinking the right side to a minimum.

### M3. Give two ways a *generated* doc can still effectively rot.

**Answer:** (1) The generation/deploy pipeline silently stops running, so the published doc freezes while the code moves on — invisible rot wearing a "trustworthy because generated" badge. (2) The generated reference is correct but *useless* — it lists fields with no examples or "why," so it rots in *value* even though its facts are accurate.

### M4. When do you delete a doc vs archive vs supersede it?

**Answer:** **Delete** when it's wrong *and* low-value (git history keeps it recoverable). **Archive** when it's still useful history but not current (move it, banner it, drop it from default nav/search). **Supersede** when a decision/design was replaced — keep the old doc immutable, banner it, and link forward to the replacement (the ADR pattern), preserving the *why* without misleading anyone into thinking it's current.

### M5. Why is "we'll be more disciplined about updating docs" not a real strategy?

**Answer:** It relies on humans remembering to do something with no forcing function and no feedback — which loses to entropy every time. Durable cures convert the doc into something *exercised*: generated from a source (can't disagree), tested in CI (breaks loudly), or co-located in the same PR (reviewed together). Replace "remember harder" with a forcing function.

### M6. How do you make a freshness system honest rather than theater?

**Answer:** Three parts: (1) a `last_reviewed` date set *only* when a human actually re-verified against reality, never auto-bumped; (2) a staleness bot that *flags* overdue docs to their owner — never auto-deletes; (3) reader feedback ("Was this helpful? / Report an error"). The theater trap is bumping the date without a real review — it falsely signals trustworthiness, which is worse than no date.

### M7. What's the drift window and how do you shrink it?

**Answer:** The gap between a behavior changing and its doc changing. Separate-system docs have a window of days-to-forever. Putting the doc in the same repo and same PR, reviewed with the code, collapses it toward zero because the missing doc change is visible in the diff. Add link-check and lint in CI to catch mechanical rot for free.

---

## Senior Questions

### S1. How is doc rot technical debt, and why is it more insidious than code debt?

**Answer:** It's a gap (principal) between what the doc says and what the system does, accruing interest (every reader misled, incident caused, trust eroded) until it defaults (trust collapse). It's *more* insidious because code debt announces itself (slow builds, frequent bugs) while doc debt accrues *silently* — there's no failing test for a sentence that became false. The senior fix is to give doc debt a failing signal (red CI check, flagged-stale dashboard) so it behaves like code debt: visible and payable. Treat a confirmed wrong doc as a P-level bug by *consequence* severity.

### S2. What metrics actually track doc health, and which ones lie?

**Answer:** Track **freshness** (% reviewed within window), **broken-link rate**, **time-since-verified distribution**, **generated/hand-written ratio** (leading), and — the ground truth — **deflection** (do docs answer questions before they become tickets) plus **error-report rate**. Lying metrics: **coverage alone** ("documented" ≠ "correct"; high coverage can be high rot) and **page/word count** (vanity; more docs = more rot surface). The worst quadrant is high coverage + low deflection: extensive *and* rotten.

### S3. How do you decide whether a doc is worth keeping alive at all?

**Answer:** Maintenance is a finite budget, so it's a cost-vs-value calculus: keep-alive if value × read-frequency > maintenance cost; otherwise delete. The 2×2: high-value + high-cost → **rot-proof it** (generate/execute, killing the recurring cost); low-value + high-cost → **delete it** (the quadrant teams get wrong by heroically maintaining dead docs). The objective isn't "keep everything fresh" — it's *maximize correct-answers-delivered per unit of maintenance spent*.

### S4. What's the difference between generation/tests and freshness dates, and why does conflating them matter?

**Answer:** Generation and tests are **guarantees** — the doc cannot (or cannot silently) be wrong. Freshness dates are **signals** — the doc *might* be wrong, here's a hint. Treating a signal as a guarantee ("it has a recent review date so it's correct") is the theater failure. Demanding guarantees where only signals are possible (auto-verifying the architectural "why") wastes effort fighting the generation boundary. Use guarantees left of the boundary, honest signals right of it.

### S5. What does "the anti-rot machinery itself rots" mean, and how do you prevent it?

**Answer:** The systems meant to prevent rot can rot — the generation pipeline silently stops, doctests get `@skip`-ped to ship, the link checker is set to non-blocking, the staleness bot files tickets nobody triages, freshness dates get bulk-bumped. This is the *most* dangerous rot because it wears a trustworthy badge. Prevention: a check that can be silently disabled is decoration — make the machinery fail loudly and block (blocking link-check, reported/budgeted skips, a canary that verifies the *published* site against the live system, a staleness queue with an owner and SLA). Guard the guards.

### S6. Why is over-aggressive doc expiry its own form of rot?

**Answer:** Auto-deleting docs past an age threshold destroys stable, correct, high-value docs that are old *because they're correct* — a rare-incident runbook or a protocol spec is *supposed* to sit untouched. That's rot-by-deletion. The fix: volatility-aware per-doc review cadences, and expiry that *flags for human judgement* ("still true? update / fix / delete") rather than silently deleting.

---

## Professional Questions

### P1. How do you enforce doc freshness across many teams?

**Answer:** Make it a program, not exhortation: rot-proof by default (generated reference; reject hand-written reference in review), `CODEOWNERS` on every doc tree, "docs updated in this PR" in the Definition of Done, and *blocking* CI gates (link-check, doctests, onboarding smoke test, api-doc-in-sync, freshness). The highest-value review question: *"This PR changes behavior X — which doc describes X, and is it updated in this PR?"* If the doc "will be updated later," block it; the doc change belongs in the same PR.

### P2. Why is treating doc health as a "Q3 cleanup project" a mistake?

**Answer:** Rot is continuous, so a one-time fix has a half-life of weeks — it completes, declares victory, and rot resumes the next day. It's also all-risk/no-flow-value, so it's cut at the first deadline. The right model is **gardening**: continuous, small maintenance woven into normal work — touch-it-fix-it (Boy Scout rule for docs), a standing freshness rotation, periodic bug-bashes as a complement, and treating confirmed wrong docs as triaged bugs.

### P3. How do you make updating docs cheap and skipping them expensive?

**Answer:** Make *updating* cheap — docs in the repo and same PR (no context switch), generation so most updates are automatic, templates so writing is fill-in-the-blank, examples that are tests (so "update the doc" = "update the test"). Make *skipping* expensive — blocking CI checks, `CODEOWNERS`-required approval on doc changes, DoD that fails review if docs are untouched, an api-doc-in-sync check that fails the PR. You're engineering the incentive gradient so the lazy path *is* the correct path.

### P4. A generated API doc broke a customer integration. How is that possible, and how do you prevent it?

**Answer:** The generation pipeline can rot even though the docs are "generated" — e.g. the docs-deploy job silently failed for weeks (expired credential, non-blocking), so the published site froze while the API moved on. Prevent it by making doc-deploy *blocking*, and adding a daily canary that verifies the *published* site matches the live `/openapi.json` and pages on mismatch. Generated docs are rot-proof only if the generator is monitored.

### P5. How do you fight doc rot culturally, not just technically?

**Answer:** Celebrate *deletions* and net-negative-doc PRs the way good teams celebrate net-negative-LOC — flip the incentive so removing rot earns respect, not just authoring. Reframe deletion as a *safety* action (a stale doc harms readers; git preserves the deleted one). Arm the team with the maintenance-vs-value calculus so deletion is a cited standard, not a personal call. And have senior engineers model it — generate instead of hand-write, delete instead of hoard.

### P6. Why shouldn't you report "we added 200 pages of docs" as a doc-health win?

**Answer:** Page/word count is a vanity metric — more docs usually means more rot surface, not better answers. High coverage with low deflection is the *worst* quadrant: extensive and rotten. Report the metrics that move with *truth*: freshness, broken-link rate, generated/hand-written ratio, and especially **deflection** (do docs answer questions before they become tickets).

---

## Practical Tasks

### C1. Turn a rot-prone setup doc into a rot-proof one.

**Before** — hand-written steps that drift:

```markdown
## Setup
1. Install Python 3.9
2. pip install -r requirements.txt
3. Set DB_URL in config.py
4. python run.py
```

**After** — one tested script, run in CI; the README points at it:

```bash
# scripts/setup.sh — the ONE place setup is defined
set -euo pipefail
poetry install
cp .env.example .env
poetry run app db migrate
poetry run app serve --check   # smoke test: starts and health-checks
```

```yaml
# CI runs ./scripts/setup.sh on a clean image every PR — onboarding breaks → build breaks.
```

State the reasoning: the prose was a hand-copy of facts in the code; replacing it with a *tested* script makes the doc's claim ("follow this and it works") an assertion CI verifies.

### C2. Write a doctest that catches drift (Python).

```python
def to_kebab(s: str) -> str:
    """Lowercase and hyphenate.

    >>> to_kebab("Keep Docs Alive")
    'keep-docs-alive'
    """
    return "-".join(s.lower().split())
```

`python -m doctest` fails the build the moment someone changes `to_kebab` so the example no longer matches. The example *is* a test; it can't silently lie.

### C3. Add `CODEOWNERS` so docs have owners.

```bash
# .github/CODEOWNERS
/docs/api/         @backend-team
/docs/runbooks/    @sre-team
*.md               @docs-guild     # catch-all: nothing is ownerless
```

A doc with no owner is a doc nobody notices going wrong; this makes a doc change a gated, owned step.

### C4. Add a last-reviewed front-matter field + a staleness check.

```markdown
---
title: Payments Architecture Overview
owner: payments-team
last_reviewed: 2026-06-11   # a human re-verified this against the system today
review_every_days: 180
---
```

```python
# scripts/freshness_gate.py — flag (not delete) docs past their per-doc cadence
import datetime, glob, yaml, sys
overdue = []
for p in glob.glob("docs/**/*.md", recursive=True):
    fm = yaml.safe_load(open(p).read().split("---")[1])
    cadence = fm.get("review_every_days", 180)
    r = fm.get("last_reviewed")
    if r and (datetime.date.today() - r).days > cadence:
        overdue.append(f"{p} (reviewed {r}, owner {fm.get('owner')})")
sys.exit(1 if overdue else 0)   # red dashboard until a human re-verifies or deletes
```

Note in the interview: it *flags*, never auto-deletes (over-aggressive expiry kills stable, correct docs), and the date must mean a real verification.

### C5. Add a link-check CI step.

```yaml
# .github/workflows/docs.yml
jobs:
  link-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lycheeverse/lychee-action@v2
        with:
          args: --no-progress './**/*.md'   # any dead link fails the build
```

Caveat to state: link-check catches *mechanical* rot (dead links) — it says nothing about whether the *content* is still true. A green link-check is not a green truth-check.

---

## Trick Questions

### T1. "We have great docs — coverage is 95%." Is that doc health?

**No.** Coverage measures *quantity documented*, not *correctness*. High coverage can be high rot — 95% of endpoints documented, half of them stale, is worse than fewer correct docs. Pair coverage with an *outcome* metric like deflection ("Was this helpful?", tickets answered by docs). High coverage + low deflection is the worst quadrant: extensive and rotten.

### T2. "If a doc has a recent `last_reviewed` date, it's trustworthy." Right?

**No.** A freshness date is a *signal*, not a *guarantee*. If it was bumped without a real verification, it's *theater* — worse than no date, because it manufactures false confidence. And a genuinely reviewed-last-month doc can still be wrong if the system changed last week. Trust generation and tests (guarantees); treat dates as hints.

### T3. "Generated docs can't rot." True?

**Mostly, but not absolutely.** Generation makes *fact* rot impossible *if* the pipeline keeps running and the source is verified against the live system. They still rot if: the generation/deploy job silently stops (the published site freezes), the spec drifts from the running server, or the generated reference is correct-but-useless (no examples/why). Generated docs are rot-proof only when the generator is *monitored*.

### T4. "Auto-delete any doc older than 6 months — keep things fresh." Good idea?

**No — that's rot-by-deletion.** Many correct, high-value docs are old *because* they're correct (rare-incident runbooks, stable protocol specs). Auto-deletion destroys them. Use volatility-aware per-doc cadences and *flag* overdue docs for human judgement, never silently delete.

### T5. "A stale doc is at least better than nothing." Agree?

**No — it's worse than nothing,** and that's the central claim of this topic. A missing doc is known-missing, so you fall back to code/colleagues and lose only a little time. A stale doc looks authoritative, misleads you into wasted hours/bugs/incidents, and — worst — triggers the trust-collapse loop that destroys the value of *every* doc.

### T6. "Let's run a quarterly doc-cleanup sprint to fix rot." Best approach?

**No — rot is continuous, so the cure must be continuous.** A quarterly project has a half-life of weeks and is cut at the first deadline. Use gardening: touch-it-fix-it on every PR, a standing freshness rotation, and bug-bashes only as a *complement*. Treat confirmed wrong docs as triaged bugs.

### T7. "We should document everything thoroughly." Right instinct?

**No.** More docs = more rot surface and more maintenance you can't afford. The objective is *maximize correct answers per unit of maintenance*, which means generating the derivable, deleting the low-value, and writing by hand only the high-value "why." Optimize for deletion, not for volume.

---

## Behavioral Questions

### B1. Tell me about a time a stale doc caused a problem.

**Sample:** "Our on-call followed a runbook during a 2 a.m. outage; it referenced a script renamed months earlier and a dead dashboard link, costing ~40 minutes before they improvised. The root cause was structural — the runbook lived in a wiki separate from the code, with no owner and no signal when the rename happened. We moved runbooks into the service repo with `CODEOWNERS`, added a CI check that referenced scripts actually exist, and a quarterly game-day that *executes* the runbook. I now treat a stale runbook as an outage amplifier, not a doc nicety."

### B2. Describe how you've made docs resistant to rot.

**Sample:** "Our API reference was hand-maintained and constantly drifted. I moved it to generation from the OpenAPI spec, then added a CI test asserting the committed spec matches what the server actually serves — so the *source of truth itself* can't drift without failing the build. Onboarding steps I converted into a tested script run in a clean container on every PR. The principle I applied: a documented claim you can express as code should be expressed as code."

### B3. When did you delete documentation, and how did you justify it?

**Sample:** "We were spending ~2 engineer-days a quarter maintaining an architecture wiki page that analytics showed was opened four times a year — while the actually-read getting-started guide rotted for lack of time. I deleted the architecture page (git preserved it), generated a current component diagram from our IaC for the rare reader, and redirected the freed budget to rot-proofing the getting-started guide. I framed it as reclaiming maintenance budget and removing a rot surface, not as losing work."

### B4. How do you push back when a teammate hand-writes docs that could be generated?

**Sample:** "Non-confrontationally, at review: 'This config table will drift the first time someone adds a key — we generate config docs from the schema, so could you add the field to the schema and delete the table?' I frame it as preventing a future stale doc, not criticizing the writing, and I cite our team norm (reference docs are generated) so it's a standard, not my opinion."

### B5. How do you keep a large org's docs alive over years?

**Sample:** "Make the correct path the easy one: generate reference by default, docs in the same repo and PR, blocking CI gates (link-check, doctests, onboarding smoke test, api-in-sync), `CODEOWNERS`, and 'docs updated' in the Definition of Done. Then make gardening continuous, not a project — touch-it-fix-it, a standing freshness rotation, bug-bashes — and culturally, celebrate deletions and net-negative-doc PRs so removing rot is rewarded. I track freshness, broken-link rate, and deflection, never coverage or page count alone."

---

## Tips for Answering

1. **Lead with the central claim:** a *wrong* doc is worse than *no* doc — and explain the trust-collapse loop.
2. **Name the asymmetry:** code is exercised (breaks loudly), prose isn't (rots silently); every cure makes the doc exercised.
3. **Order the strategies by power:** generate (SSOT) > executable/tested > docs-next-to-code > ownership/process > freshness signals > delete. State which make rot *impossible* vs merely *visible*.
4. **Respect the generation boundary:** generate the *what* (reference), date and own the *why* (explanation) — and shrink the why to a minimum.
5. **Be precise about freshness:** it's a *signal*, not a *guarantee*; a faked date is theater, worse than none.
6. **Quote the economics:** maintenance is finite — *maximize correct-answers per unit of maintenance*; delete low-value docs, rot-proof high-value ones.
7. **For metrics, name deflection** (and freshness/broken-link/generated-ratio), and reject coverage-alone and page-count.

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)

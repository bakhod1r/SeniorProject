# Docs as Code & Tooling — Interview Questions

> **Category:** [Documentation](../README.md) — treat documentation like source code: plain-text, in version control, reviewed in pull requests, built and tested in CI, deployed automatically.

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

### J1. What is "Docs as Code"?

**Answer:** Producing documentation with the same tools and workflow as source code: plain-text (Markdown) in version control, changed via pull requests, reviewed like code, built and tested in CI, and deployed automatically. The term comes from the *Write the Docs* community.

### J2. Name three benefits you get "for free" by adopting it.

**Answer:** Any three of: Git diffs and history/blame on docs, code-style review of doc changes, branching, easy reverts, and CI automation. Everything you already know about working with code applies to docs.

### J3. Why does keeping docs next to the code reduce drift?

**Answer:** A behavior change and its doc update can land in the **same pull request**, get reviewed together, and ship together. The reviewer who approves the code sees the doc diff too and can block a behavior change with stale docs.

### J4. What is the "where is the truth?" problem?

**Answer:** When docs are scattered across a wiki, Word files, and Google Docs — none tied to the code, all independently editable — they disagree, and engineers trust none of them. Docs as Code collapses the truth into the repo: the docs that ship are the reviewed docs in `main`.

### J5. What is a Static Site Generator? Name a few.

**Answer:** A tool that turns Markdown source into a finished HTML website (nav, search, theme). Examples: MkDocs, Docusaurus, Sphinx, Hugo, mdBook. This repo uses **MkDocs + Material + awesome-pages**.

### J6. What does the `.pages` file do in this repo?

**Answer:** It's read by MkDocs' awesome-pages plugin to set the navigation order (and optional titles) for the pages in *that* folder — here, junior → middle → senior → professional → interview.

### J7. Name three checks a docs CI pipeline commonly runs.

**Answer:** Any three: link checking (`lychee`), Markdown structure linting (`markdownlint`), prose-style linting (`Vale`), spell-check (`cspell`), and a `mkdocs build --strict` that fails on warnings.

### J8. What does `mkdocs build --strict` do, and why use it?

**Answer:** It turns build warnings — like a broken internal link or a page missing from the nav — into a *failed build*, so those problems block a PR instead of shipping silently.

### J9. What's the difference between `mkdocs serve` and `mkdocs build`?

**Answer:** `serve` runs a live-reloading local preview for writing; `build` produces the static `site/` folder that CI deploys. Use `serve` while writing, `build --strict` in CI.

### J10. Should you commit the generated `site/` folder to Git?

**Answer:** No. It's build output, regenerated from source. Commit only the source (Markdown, config); let CI build and deploy the site.

---

## Middle Questions

### M1. How do you decide between Markdown and a richer markup like reST or AsciiDoc?

**Answer:** Default to Markdown; switch only when a concrete limitation blocks you, and bias toward the simplest markup your *contributors* can use. The trap: choosing reST/AsciiDoc "for power" raises friction so casual contributors stop fixing docs — losing the contributions that keep docs alive.

### M2. Why split link checking into internal vs. external?

**Answer:** Internal links are always your bug, so they should hard-fail the PR (`mkdocs --strict` + lychee). External links break for reasons outside your control, so gating PRs on them makes the gate flaky — check them on a schedule and file an issue instead.

### M3. What is Vale, and what does it catch that markdownlint doesn't?

**Answer:** Vale is a configurable **prose-style** linter — terminology, banned phrases, tone (e.g., "always say GitHub," "no filler words"). markdownlint only checks Markdown *structure* (heading levels, list style). Vale enforces content/style rules markdownlint can't see.

### M4. Why test code examples in CI, and how?

**Answer:** A wrong example is worse than none — readers trust it. Testing snippets (doctest, Go testable examples, `cargo test --doc`, `mdbook test`) means a code change that breaks an example reds the build, so examples can't silently rot. A shown snippet should be a run snippet.

### M5. What does a per-PR preview deploy give you?

**Answer:** Reviewers read the *rendered* page, catching render-only failures a Markdown diff can't — broken tables, mermaid diagrams that won't render, malformed admonitions. Tools: Read the Docs, Netlify/Cloudflare/Vercel deploy previews.

### M6. What are versioned docs and when do you need them?

**Answer:** A docs tree per release (`/latest`, `/v3`, `/v2`) so a user on an old version sees matching docs. Needed once you ship versioned releases. Built-in for Docusaurus/RTD; MkDocs uses the `mike` plugin. Version on the same cadence as releases.

### M7. What is single-sourcing in docs?

**Answer:** The DRY of documentation: state each fact once and *include* it where needed (SSG includes like `--8<--`) instead of copy-pasting, and generate volatile facts (endpoints, flags) from the source of truth rather than hand-maintaining them — so they can't disagree.

---

## Senior Questions

### S1. Docs next to the code, or a central docs repo — how do you decide?

**Answer:** Reference and behavior-describing docs belong **next to the code** (they drift the instant separated — co-location enables atomic PRs). Cross-cutting/narrative/onboarding docs belong in a **central home**. The mature answer is hybrid: per-repo docs **aggregated** into one site. The failure mode is central-only "for one site," which reintroduces drift because the docs PR is now in a different repo than the code change.

### S2. How do you present one docs site sourced from many repos?

**Answer:** Aggregation, not centralization. Options: git submodules/subtrees (fragile), build-time aggregation (CI clones N repos, copies their `docs/`, builds one site — flexible but you own the glue), or **Antora** (purpose-built multi-repo SSG with versioning). Aggregation keeps docs co-located (drift-resistant) while presenting one usable site.

### S3. What's the biggest honest weakness of Docs as Code?

**Answer:** The Git/PR workflow **excludes non-engineer contributors** (PMs, support, sales) who often most need to fix docs — a wiki's WYSIWYG lets anyone edit. It's a real trade-off. Mitigations: "edit this page" pencil, GitHub web editor, or a CMS-over-Git layer (Decap/Tina). Choosing Docs as Code is implicitly choosing who can contribute; pretending otherwise is how it fails for those audiences.

### S4. What is Diátaxis and why does it matter for docs IA?

**Answer:** A framework of four documentation modes — tutorials (learning), how-to (task), reference (lookup), explanation (understanding). Most bad docs are bad because they *mix modes*. It maps onto generated-vs-hand-written: reference is generated; the other three are written. Keeping the modes separate is the structural fix for "our docs are hard to use."

### S5. What's the rule for what to generate vs. hand-write?

**Answer:** If a fact changes when the code changes (endpoints, flags, config, error codes), **generate** it from the source of truth — hand-maintained volatile facts are guaranteed to drift. If it requires human judgement to explain (concepts, tutorials, the "why"), **write** it. Merge both into one cross-linked site, curated so generated reference doesn't swamp the narrative.

### S6. How do you choose a generator you won't outgrow?

**Answer:** Evaluate on reversibility-aware criteria: maintenance health (low abandonment risk), markup portability (plain Markdown migrates; proprietary MDX/macros lock you in), built-in versioning/i18n if you'll need them, build performance at scale, and ecosystem fit. Hedge by keeping content portable and isolating generator-specific features — the SSG is an expensive-to-reverse, one-way-door-ish choice.

### S7. How do you keep a docs CI pipeline trustworthy?

**Answer:** Each gate guards a distinct real failure class (no overlapping linters); gate strength tracks controllability (hard-fail internal links/build/your terminology, soft-report external links/third-party); keep the required path fast (heavy checks on cron); treat preview as a first-class gate; pin plugin/action versions. Goal: green means "publishable," red means "your bug worth fixing" — never "a third-party site is flaky."

---

## Professional Questions

### P1. How do you roll Docs as Code out to an org?

**Answer:** Pilot one motivated team end-to-end; publish a **template repo** (mkdocs.yml + CI + Vale + CODEOWNERS + starter IA) so teams adopt by copying a working setup; scaffold docs into new repos by default; integrate into existing CI (not a parallel system); train the *workflow* ("docs PR per behavior change"), not Markdown; address non-engineer contributors up front. It spreads by being lower-friction, not by mandate.

### P2. How do you migrate off a wiki without importing the rot?

**Answer:** Inventory and triage every page (current/stale/dupe/dead); **delete aggressively** — don't migrate stale pages; convert format (pandoc); **re-architect** into a real IA rather than re-pasting the wiki tree; establish a single source (lock the old wiki read-only, redirect); backfill ownership and CI gates. The value is in the deletion: distilling 1,400 pages to the 300 true ones, not moving all 1,400.

### P3. What metrics actually track docs health?

**Answer:** Broken internal links (**must be zero** — fully under your control), staleness on hot files (change-coupling: hot code + cold doc = probable rot), example test pass rate, build/deploy success rate, public-surface coverage, and the ground-truth metric — **"docs-were-wrong" incidents** (support tickets/outages from stale docs). **Not** page count (vanity).

### P4. How do you enforce docs in code review?

**Answer:** The key question for every PR: "behavior changed — where's the doc update?" Block behavior changes that touch no docs. Also check examples still run, that volatile facts are generated not hand-maintained, single-sourcing (no copy-paste), and right Diátaxis mode. Back it with policy (docs in DoD), CODEOWNERS, and branch protection so it's standard, not personal preference.

### P5. The docs pipeline is "production infrastructure." What does operating it well require?

**Answer:** Pin SSG/plugin/Action versions (an unpinned minor bump can red every docs PR org-wide); keep the required path fast and deterministic (heavy crawls/tests on cron); monitor the **deploy**, not just the build (a green build that fails to publish ships stale docs silently); own aggregation failure modes (degrade gracefully if a source repo is down); keep a fast rollback to last-good.

### P6. Why is reporting "we now have 5,000 doc pages" a bad health metric?

**Answer:** Volume isn't quality — most large doc sets are mostly stale, and page count grows even as trust falls. A smaller, *true*, maintained set is better. Report broken-internal-links (zero), staleness on hot files, example pass rate, and docs-were-wrong incidents instead.

---

## Practical Tasks

### C1. Write a minimal docs CI workflow (GitHub Actions) that lints, link-checks, and builds.

```yaml
# .github/workflows/docs.yml
name: docs
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install mkdocs-material mkdocs-awesome-pages-plugin
      - uses: DavidAnson/markdownlint-cli2-action@v16
        with: { globs: "docs/**/*.md" }
      - uses: lycheeverse/lychee-action@v2
        with: { args: "--no-progress docs/" }   # internal links hard-fail
      - run: mkdocs build --strict               # warnings → failed build
```

State the reasoning: each step guards a distinct failure (structure, dead internal links, won't-render). `--strict` is what makes broken internal links and missing-nav pages block the PR.

### C2. Write a Vale rule that bans filler words.

```yaml
# .vale/styles/House/Filler.yml
extends: existence
message: "Avoid filler — '%s' adds no information."
level: warning
ignorecase: true
tokens:
  - simply
  - just
  - obviously
  - easily
```

Wire it in `.vale.ini` with `BasedOnStyles = Vale, House` and run `vale docs/` in CI. This enforces a style guide automatically instead of relitigating it in every review.

### C3. Sketch a docs-as-code directory layout (Diátaxis + generated reference).

```text
repo/
├── mkdocs.yml
├── docs/
│   ├── tutorials/         # learning (hand-written)
│   ├── how-to/            # tasks (hand-written)
│   ├── reference/         # generated from OpenAPI / docstrings
│   ├── explanation/       # concepts / architecture (hand-written)
│   └── includes/          # single-sourced reusable blocks
└── .github/
    ├── workflows/docs.yml
    └── CODEOWNERS
```

### C4. Make code examples testable so they can't rot (Python).

```python
def add(a, b):
    """Add two numbers.

    >>> add(2, 3)
    5
    """
    return a + b
```

```yaml
# CI gate — the shown example is now executed
- run: python -m doctest docs/**/*.md -v
```

A change that breaks the example reds the build — the strongest defense against example drift.

### C5. Split link checking so the gate stays trustworthy.

```yaml
# PR: internal links only (your bug) — hard-fail
on: [pull_request]
# ... mkdocs build --strict + lychee on internal links

# Weekly: external crawl — reports, doesn't block
on:
  schedule: [{ cron: "0 6 * * 1" }]
# ... lychee --max-retries 3 docs/  → open/update an issue on failure
```

---

## Trick Questions

### T1. "Docs as Code just means putting Markdown in Git." True?

**Mostly false / incomplete.** Storage in Git is necessary but not sufficient. The defining parts are the *workflow*: PR review of docs, **CI quality gates** (link-check, build, prose lint, executable examples), and **automatic deploy**. Markdown-in-Git with no gates and no review still rots — you've just moved the wiki into Git.

### T2. "A central docs repo is best because everything's in one place." Agree?

**No.** A single site is convenient, but a central repo separates docs from the code they describe, so updating them isn't part of the code change — which reintroduces drift, the exact problem Docs as Code solves. Default behavior-describing docs to *next to the code* and get one site via **aggregation**, not centralization.

### T3. "Use the most powerful markup (AsciiDoc/reST) to be future-proof." Right?

**Usually wrong.** Power costs contributor friction. If casual contributors must learn unfamiliar syntax, they stop fixing docs and the docs rot. Default to Markdown; upgrade only on a concrete limitation. The simplest markup your contributors will actually use beats the most capable one they won't.

### T4. "The link checker should hard-fail on every dead link." Correct?

**No.** Internal links are your bug → hard-fail the PR. External links break for reasons outside your control → gating PRs on them makes the gate flaky, people route around it, and you lose the valuable internal checks too. Check external links on a schedule and file an issue.

### T5. "A documented example is fine even if it's slightly out of date." Agree?

**No — a wrong example is worse than none,** because the reader trusts and runs it. (A wrong *runbook* command can extend an outage.) Make examples *executable in CI* so a code change that breaks them reds the build.

### T6. "We migrated all 1,400 wiki pages to Markdown — migration done!" Success?

**No — likely a failure.** Most wiki content is stale; bulk-importing it imports the rot, and engineers trust the new docs no more than the old wiki. A successful migration *deletes* aggressively and distills to the true pages, re-architected into a real IA with gates. The value is in the deletion.

### T7. "Static site generator means the docs can't have search." True?

**False.** "Static" refers to *hosting* (the output is plain HTML/JS/CSS with no backend) — not capability. SSGs like MkDocs Material and Docusaurus ship client-side search; large sites add Algolia DocSearch.

---

## Behavioral Questions

### B1. Tell me about a time you improved a team's documentation workflow.

**Sample:** "Our docs were a Confluence space nobody trusted — three pages describing the same service, all different. I moved the behavior-describing docs into the service repo as Markdown, added a CI pipeline (markdownlint, internal link-check, `mkdocs build --strict`), and made 'docs change ships in the same PR as the behavior change' a review norm. Within a quarter the 'is this doc current?' Slack questions basically stopped — the docs that shipped were the reviewed docs in `main`."

### B2. Describe a docs tooling decision you made and the trade-off.

**Sample:** "We chose MkDocs + Material over Docusaurus. Docusaurus had nicer built-in versioning, but our team was Python — MkDocs let us `pip install` everything, reuse docstrings, and onboard with zero new stack. I weighted ecosystem fit and low abandonment risk over features we didn't yet need, and kept content as portable plain Markdown so a future migration stays cheap. I wrote it up as an ADR."

### B3. How did you handle non-engineers who needed to edit docs?

**Sample:** "Support kept filing tickets to fix wrong doc steps because the PR flow blocked them. I added an 'edit this page' pencil that opens a GitHub web edit + PR, and for the highest-traffic guides set up a Decap CMS that commits Markdown behind a WYSIWYG editor. It acknowledged the real weakness of Docs as Code — the Git workflow excludes non-engineers — instead of pretending it away."

### B4. Tell me about a docs-related incident.

**Sample:** "A runbook documented a failover command; a release changed its flags but the runbook wasn't updated — no docs gate on that repo. On-call ran the documented command at 3 a.m. and extended the outage. We made the failover steps an executable check in CI against staging, so a flag change that breaks the runbook now reds the build. Lesson: for operational docs, a wrong example is an availability risk — test it."

### B5. How do you keep docs from rotting over years across many teams?

**Sample:** "Make the right thing the default and automatic: docs next to code, a template repo every new service copies (CI gates + CODEOWNERS), 'docs PR per behavior change' enforced in review, internal-links-must-be-zero, executable examples, and staleness alerts on hot files. Culturally, docs go in Definition of Done and I credit and celebrate doc work — including deletions of stale pages. Rot enters one un-updated PR at a time, so the defense is at the gate."

---

## Tips for Answering

1. **Lead with the definition as a workflow**, not a storage choice: plain-text → version control → PR review → CI gates → auto-deploy.
2. **Name co-location as the core mechanism** against drift: behavior change + doc update in one reviewed PR.
3. **Mention this repo's MkDocs + `.pages`** as a concrete example if asked for one.
4. **Split link checking** (internal hard-fail, external scheduled) — a classic senior signal.
5. **Say "test the examples in CI"** — a shown snippet must be a run snippet; a wrong example is worse than none.
6. **Tie generated-vs-hand-written to drift:** generate volatile facts, hand-write judgement; merge into one curated site.
7. **Acknowledge the honest weakness** — the non-engineer/Git friction — rather than claiming Docs as Code has no downside.
8. **For metrics, name broken-internal-links (zero), staleness, and docs-were-wrong incidents — never page count.**

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)

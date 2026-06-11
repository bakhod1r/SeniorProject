# READMEs & Onboarding Docs — Interview Questions

> **Category:** [Documentation](../README.md) — the README is your project's front door; onboarding docs are the path from "I cloned it" to "I shipped a change."

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

### J1. What is a README, and why is it called the project's "front door"?

**Answer:** A README is the file a reader sees first when they land on a project (GitHub renders `README.md` on the repo home). It's the front door because it's the first — and often only — doc anyone reads before deciding whether to use, contribute to, or run the project.

### J2. What three questions must a README answer in the first 30 seconds?

**Answer:** **What is this? Is it for me? How do I start?** — answered by the title + one-line description, the what/why section, and the quick start. If a stranger can't answer all three in 30 seconds, the README has failed its one job.

### J3. List the standard sections of a README, roughly in reading order.

**Answer:** Title + one-line description, badges, what & why, quick start / installation, usage examples, configuration, running tests, contributing (pointer), license, support/contact. (Codified by the standard-readme spec; exemplified by Awesome README.)

### J4. What does "copy-pasteable" mean for a quick start, and why does it matter?

**Answer:** The reader can select the command block, paste it into a terminal, and have it work with no edits — no assumed tools, no missing secrets, expected output shown. It matters because the quick start is the most-used part of a README, and a command that only works on the author's machine wastes the reader's time ("works on my machine").

### J5. What's the difference between a README and onboarding docs?

**Answer:** The README is the front door (what/why/quick start, read by everyone). Onboarding docs are the guided path from a fresh clone to a first merged change — the setup guide and day-one checklist — aimed at new contributors, with the goal of minimizing time-to-first-commit.

### J6. Name three companion files that live next to a README and say what each is for.

**Answer:** `CONTRIBUTING.md` (how to set up, branch, test, submit changes), `LICENSE` (legal terms), `SECURITY.md` (how to report a vulnerability privately). Others: `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.github/` issue/PR templates, `ARCHITECTURE.md`. GitHub surfaces several of these specially in its UI.

### J7. Why should companion files be linked from the README rather than inlined?

**Answer:** To keep the README thin and scannable, and because GitHub special-cases files like `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` (a Contributing link on new PRs, a Security tab, the license in the sidebar). The README points to the rooms; it isn't all of them.

### J8. What is time-to-first-commit?

**Answer:** The time from a new contributor joining or cloning to landing their first real change. Onboarding docs exist to minimize it (with time-to-first-green-build as an earlier milestone).

### J9. Why is the newest person on the team the best documentation tester?

**Answer:** They have zero assumed context, so they hit every gap an experienced person glosses over. Every step that fails or needs guessing is a doc bug, and they're the only person positioned to see it — so capture their stumbles before they gain context.

### J10. Why is a screenshot a maintenance liability?

**Answer:** It's documentation like any other — a UI redesign makes it lie. Use screenshots where they orient the reader faster than prose, but expect to maintain them like the rest of the docs.

---

## Middle Questions

### M1. How does a library README differ from a service README?

**Answer:** A library README is **usage-heavy** — its reader wants to *call the code*, so the smallest working snippet and the API surface dominate; install is one line. A service README is **operation-heavy** — its reader wants to *run/configure/deploy* it, so environment setup, config, and a runbook pointer dominate; usage is thin. Match the doc to what the reader is trying to do.

### M2. What is README-Driven Development, and what does it buy you?

**Answer:** Writing the README (the usage, commands, example calls) *before* the implementation. Named by Tom Preston-Werner. It forces outside-in, caller's-eye interface design and surfaces awkward APIs/flags/missing capabilities while they're cheap to change (prose, not shipped code). It's TDD for the public interface.

### M3. Why is a README the one document allowed to mix all four Diátaxis types?

**Answer:** Because it's the front door and the reader hasn't yet chosen what they need, so it touches tutorial (quick start), how-to (usage), reference (config), and explanation (why) — but only *lightly*, as a hub. The rule: the moment a section wants to go deep, split it into its own document and link to it.

### M4. Give the spectrum of strategies for keeping a quick start from rotting, weakest to strongest.

**Answer:** Discipline ("remember to update it") → review checklist (PR asks "did you?") → single source of truth (README delegates to a script that *is* the truth, e.g. `make setup`) → tested in CI (extract and run the README's commands on a clean image every commit). The strongest makes "works on my machine" impossible.

### M5. Why prefer `make setup` in the README over listing ten setup commands?

**Answer:** Delegating beats restating. Ten inline commands are ten things to keep in sync and ten chances to drift. `make setup` is *one* source of truth that developers run daily, so it can't silently rot — and CI can run the same command to prove it works.

### M6. Name two things an internal README needs that an open-source one doesn't.

**Answer:** **Ownership** (team, on-call, Slack channel) and links to internal infra (wiki, runbook, dashboards). Internal READMEs *orient* an inheritor; they can drop license and adoption-marketing. Open-source READMEs *sell* — they need positioning, license, and badges because the reader is choosing whether to adopt.

### M7. How do you choose which companion files a repo needs?

**Answer:** By value vs. upkeep. Add a file when its value clears its maintenance cost (`SECURITY.md` for a public/security-sensitive lib; `ARCHITECTURE.md` when layout isn't obvious) and skip it otherwise (a code of conduct on a two-person internal repo is noise). Every companion file is something someone must keep current; an out-of-date one is worse than none.

### M8. When does README-Driven Development *not* apply?

**Answer:** For exploratory or research code where you don't yet know the interface — writing the README first is premature commitment to a shape you haven't earned the knowledge to design. RDD fits deliberate public surfaces (libraries, CLIs, services, APIs).

---

## Senior Questions

### S1. In what sense is a README an architectural boundary?

**Answer:** It's the contract for *entering* a system — the same role a function signature or API contract plays for code. It should describe the **interface** (how to start/configure/call), not the **implementation**. A well-bounded system has a small, stable README; if the README must change on every internal refactor, the boundary is leaking implementation into its entry contract — an architecture smell surfacing in docs.

### S2. When should a README become a docs site, and how do you make the transition?

**Answer:** When it hits its ceiling — it needs a table of contents, sections become mini-manuals, multiple audiences fight for one file, or different versions need different docs. The transition is **promote, don't dump**: move the *depth* (full reference, guides, architecture) to a versioned, searchable site, but **keep the one-liner and a working quick start in the README** so it still passes the 30-second test. A docs site buys search/versioning/navigation/Diátaxis cleanliness at the cost of a second system to maintain — promote only when README pain exceeds that cost.

### S3. How would you justify investing in onboarding docs to a skeptical manager?

**Answer:** With arithmetic. A manual, rot-prone setup easily costs each new hire 1–3 days; multiply by hires per year, add the recurring interruption tax on existing engineers answering the same questions, and (for libraries) the adoption lost to abandoned evaluations. For ten hires a year, shaving two days each recovers ~20 engineer-days annually — weeks of capacity — for a few days of writing a setup script and README. Frame it as **capacity recovery**, not overhead; the artifact is written once and read by everyone, forever.

### S4. What's the strongest defense against "works on my machine" in onboarding?

**Answer:** Make the setup *executable* and run it in CI on a clean image — the onboarding smoke test. CI checks out the repo on a blank slate, runs the exact documented commands (`make setup`, `make test`, hit the health endpoint), and fails if any step breaks. When it's green, the quick start is a *proof*, not a hope, because CI just *was* a new contributor on a machine identical to their first day.

### S5. Why is onboarding friction often an engineering problem, not a documentation problem?

**Answer:** If setup takes a day, the fix is a better setup *script*, not a better-written description of the painful manual steps. If the first green build is untrustworthy because the suite is flaky, no doc helps. Document the path, but **first make the path short** — the best onboarding doc is the one that can be three lines because the underlying system is good.

### S6. How does README-Driven Development relate to test-driven development and design docs?

**Answer:** RDD designs the *interface* from the caller's needs the way TDD designs *behavior* from the caller's needs — both invert the implementation-outward instinct. The RDD-style "here's how you'll use it" section is also a core part of a [design doc](../06-design-docs-and-rfcs/junior.md): it makes the proposal concrete and forces commitment to a usable surface before implementation locks it.

### S7. At a thousand repos, how does the README problem change?

**Answer:** It becomes a *consistency* problem — a README *protocol*. Every repo gets the same skeleton (one-liner, ownership, quick start, links) so any engineer can orient in seconds; a scaffold/generator and a linter enforce it. Ownership becomes non-negotiable (CI fails repos with no owner). A service catalog/developer portal (e.g., Backstage) becomes the meta-front-door for *finding* the right repo. The README stops being a document and becomes a protocol.

---

## Professional Questions

### P1. What goes in an organization-wide README standard, and how do you make it stick?

**Answer:** A mandated skeleton: one-line description, **ownership block** (team/on-call/Slack), status & tier, a tested copy-pasteable quick start, and *links* (runbook, `ARCHITECTURE.md`, `CONTRIBUTING.md`) rather than inlined chapters. Make it stick by shipping it as a **scaffold/generator** (cookiecutter, repo-creation bot) pre-filled from the service catalog, plus a CI linter — not a wiki page that requires manual compliance.

### P2. Describe the layers of CI enforcement for the front door.

**Answer:** Layer 1 — **structural lint** (README exists, required sections present, no dead links). Layer 2 — **ownership gate** (fail CI / block repo creation if no owner, wired to `CODEOWNERS`/catalog). Layer 3 — **onboarding smoke test** (run the documented setup on a clean image; the layer that defeats "works on my machine"). Cheap to strong.

### P3. Which onboarding metrics matter, and which are vanity?

**Answer:** Matter: **time-to-first-commit** (headline), time-to-first-green-build, doc-bug-count-per-hire (should *fall*), repeated-question rate, quick-start CI pass rate, README-standard compliance. Vanity: "pages of onboarding docs," wiki page views — they measure activity, not whether people get productive. The ground truth is the outcome, not the artifact.

### P4. What is the doc-bug loop, and why is it self-improving?

**Answer:** Every new hire follows the setup doc **verbatim**, logs each failure/guess as a **doc bug**, and fixes the doc as their **first PR** (day-one win + repair). It's self-improving because each newcomer has maximum naïveté — exactly the condition for seeing gaps — and hands a better path to the next person. The cost of a gap is paid once and amortized over all future hires.

### P5. You're reviewing a README PR. What do you check?

**Answer:** The 30-second test still passes; commands are copy-pasteable and assume nothing; the documented command *matches what the CI smoke test runs* (no drift); links resolve and depth is promoted to the right spoke; ownership/status present (internal); and **no secrets/tokens/internal hostnames** leaked into the file.

### P6. Give a real incident caused by a bad README or onboarding doc and its fix.

**Answer (sample):** A revenue-critical service's quick start hadn't kept up with two build-system migrations; new hires lost 2–3 days each reverse-engineering setup by interrupting the team. Fix: reduce setup to `make setup` and add an onboarding-smoke-test CI job that runs the documented commands on a clean image. Next hire was green in 40 minutes. Lesson: an untested quick start *will* rot — back it with a script and test it in CI.

---

## Practical Tasks

### C1. Turn this README into one that passes the 30-second test.

**Before:**

```markdown
# project
TODO: write docs
## Setup
Install the dependencies and run it.
```

**After:**

```markdown
# inventory-sync
> Keeps the warehouse DB in sync with the Shopify storefront every 5 minutes.

## What it does
A service that pushes warehouse stock levels to Shopify so the store never
oversells. For storefront and warehouse maintainers.

## Quick start
```bash
git clone https://github.com/acme/inventory-sync && cd inventory-sync
cp .env.example .env      # fill in DB_URL and SHOPIFY_TOKEN
make run                  # → "synced 412 SKUs in 1.3s"
```
```

State the reasoning: the rewrite answers *what / for whom / how to start* up top, with a copy-pasteable quick start and expected output.

### C2. Spot what's wrong with this quick start.

```bash
npm start
```

**Answer:** It assumes the repo is cloned, dependencies are installed, the right Node version is present, required env vars are set, and any backing services are running — none stated. It also shows no expected output. Fix: prerequisites line + `git clone` + `cp .env.example .env` + `npm ci` + `npm start`, with the expected log line — or wrap it all in `make run`.

### C3. Write a minimal `CONTRIBUTING.md` skeleton.

```markdown
# Contributing

## Set up
```bash
git clone <repo> && cd <repo>
make setup        # deps + git hooks
cp .env.example .env
```
## Make a change
1. Branch from `main`: `git checkout -b fix/<short-desc>`
2. Add/update tests. Run `make test lint`.
## Submit
1. Push and open a PR against `main`; fill in the template.
2. A maintainer reviews within two working days.
```

### C4. Sketch a CI job that proves the quick start works.

```yaml
onboarding-smoke-test:
  runs-on: ubuntu-latest          # clean image = a new hire's blank slate
  steps:
    - uses: actions/checkout@v4
    - run: make setup             # exactly what CONTRIBUTING.md tells humans to run
    - run: make test              # first-green-build milestone, proven
    - run: timeout 20 make run & sleep 6 && curl -fsS localhost:8080/health
```

State why: it makes the documented path a continuously-verified proof, defeating "works on my machine."

### C5. Apply README-Driven Development: write the README for a `rate-limit` library before coding it.

```markdown
# rate-limit
> Token-bucket rate limiting in one decorator.

## Usage
```python
from rate_limit import limit

@limit(rate="100/min", burst=20)
def handle(request): ...
```
Raises `RateLimitExceeded` when the bucket is empty; otherwise calls through.
```

Note the design questions this surfaces *before* implementation: Is `rate` a string or structured? What's the default `burst`? Raise or return? — all cheap to settle in prose.

---

## Trick Questions

### T1. "A longer, more complete README is a better README." True?

**False.** Completeness is not a README virtue; passing the 30-second test is. A 1,800-line README drowns the quick start and nobody reads it. Beyond the ceiling, promote depth to a docs site and keep the front door thin.

### T2. "We have a docs site, so the repo doesn't need a real README." Right?

**No.** The README is still the front door — a reader landing on the repo must learn *what it is* and *how to start* without leaving. A docs site replaces the *depth*, not the front door. Don't let a stub README fail the 30-second test.

### T3. "Inlining a working DB connection string makes the quick start friendlier." Agree?

**Dangerously no.** Never inline secrets/credentials — they leak (especially to public mirrors), triggering rotation and audits. Use `cp .env.example .env` and link to where the real values come from.

### T4. "Onboarding is a documentation problem — write a better wiki." Correct?

**Usually no.** Onboarding friction is mostly an *engineering* problem: a slow/manual setup needs a better *script*, a flaky build needs fixing — not a better description of the pain. Make the path short first; then document the short path.

### T5. "Cyclomatic-style metrics — like 'pages of onboarding docs' — prove our onboarding is good." Right?

**No.** Those are vanity metrics measuring activity, not outcome. The metric that matters is **time-to-first-commit** (and its trend) plus doc-bug-count-per-hire. A thick wiki with a five-day time-to-first-commit is failing.

### T6. "Just remember to update the README when the setup changes." Sufficient?

**No — discipline is the weakest defense and it always decays.** Back the quick start with an executable artifact (`make setup`) as the single source of truth, and run it in CI on a clean image so drift fails the build instead of a human.

### T7. "README-Driven Development is just writing docs early." Is that all?

**No — it's an interface-design technique.** Writing the usage first forces caller's-eye, outside-in design and surfaces a clumsy API while it's prose-cheap to change. It's TDD for the public surface, not merely "docs first."

---

## Behavioral Questions

### B1. Tell me about a time a bad or missing README cost real time.

**Sample:** "A revenue-critical service's quick start had rotted through two build-system migrations. Each new hire lost two to three days reverse-engineering setup by interrupting us. I reduced the setup to `make setup` and added a CI smoke test that runs the documented commands on a clean image. The next hire was green in under an hour. The lesson I quote now: an untested quick start *will* rot — back it with a script and test it."

### B2. Describe how you onboard a new engineer.

**Sample:** "I pair them with a buddy and have them follow the setup doc *verbatim* on day one — changing nothing. Every step that fails or needs guessing is a doc bug, and their literal first PR is fixing those bugs. That gives them a day-one merged change *and* repairs the doc while the gaps are freshest in the only mind that can see them. We track time-to-first-commit and watch its trend."

### B3. How do you push back when someone wants a 2,000-line README?

**Sample:** "I reframe completeness as the wrong goal — the README's job is the 30-second test, and a 2,000-line file fails it because the quick start drowns. I propose promoting the depth to a versioned docs site and keeping the README a thin hub: one-liner, tested quick start, links. When we did this on an internal platform, starter questions dropped sharply."

### B4. Tell me about a documentation decision you made that wasn't obvious.

**Sample:** "A teammate wanted to inline a real DB connection string in the quick start 'so it just works.' I pushed back — that's a credential in version control waiting to leak, and it did on a sister project. We used `cp .env.example .env` plus a vault link, and added a secret scanner to CI. Convenience that leaks secrets isn't convenience."

### B5. How do you keep READMEs good across many repos over years?

**Sample:** "Make the good path the default and automatic: a README standard shipped as a repo-creation scaffold (pre-filled with ownership from the catalog), a CI linter for required sections and dead links, an ownership gate that fails unowned repos, and an onboarding smoke test per service. Then the doc-bug loop keeps onboarding docs alive with each new hire. Individual diligence doesn't scale to hundreds of repos — the system does."

---

## Tips for Answering

1. **Lead with the 30-second test** — what is it / is it for me / how do I start. It's the README's one job.
2. **Stress copy-pasteable quick starts and the "works on my machine" trap** — and that the fix is an executable, CI-tested setup, not better prose.
3. **Tailor by project type** — library = usage, service = operation, CLI = examples, monorepo = map.
4. **Name README-Driven Development** and frame it as interface design (TDD for the public surface), with its limit (not for exploratory work).
5. **Tie onboarding to a metric** — time-to-first-commit — and to the doc-bug loop (newest hire follows verbatim; gaps are bugs they fix).
6. **For internal repos, say "ownership"** (team/on-call/Slack); for libraries, say "adoption funnel."
7. **For scale, talk standards + CI enforcement** (lint, ownership gate, onboarding smoke test) and outcome metrics over vanity ones.

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)

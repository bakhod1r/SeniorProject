# Docs Coverage & Gaps — Middle Level

> **Roadmap:** [Documentation Quality](../README.md) → Docs Coverage & Gaps
> *The junior page named the idea: coverage is "how much is documented." This page makes it a number you can gate on in CI — and then immediately complicates it, because there are two coverages (symbols and doc-types) and a 100% on either one can still mean your docs are useless.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Symbol Coverage — What the Tools Actually Count](#symbol-coverage--what-the-tools-actually-count)
4. [The Tooling, Per Ecosystem](#the-tooling-per-ecosystem)
5. [Configuring It Sanely — Public API, Not Everything](#configuring-it-sanely--public-api-not-everything)
6. [Diff Coverage — Gate the New, Forgive the Old](#diff-coverage--gate-the-new-forgive-the-old)
7. [The Other Coverage — Doc-Type Coverage via a Matrix](#the-other-coverage--doc-type-coverage-via-a-matrix)
8. [Gap Analysis — Finding What Isn't There](#gap-analysis--finding-what-isnt-there)
9. [The Carried Lesson — Covered Is Not Good](#the-carried-lesson--covered-is-not-good)
10. [Worked Example — A Sane interrogate Gate + a Matrix That Finds the Missing Runbook](#worked-example--a-sane-interrogate-gate--a-matrix-that-finds-the-missing-runbook)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I measure documentation coverage properly, and how do I find the gaps the number hides?**

At the junior level, "docs coverage" is intuitive: take the things that should be documented, count the ones that are, divide. Correct — but cartoonish in exactly the way "test coverage is lines executed" is cartoonish. It hides two distinct questions behind one word.

The first is **symbol coverage**: of the functions, classes, and modules in your codebase, what fraction carry a docstring? This is the one with mature tooling — `interrogate`, `revive`, ESLint's JSDoc rules, Rust's `missing_docs` — and the one you can wire into a CI gate. The second is **doc-type coverage**: for each feature you ship, do you have the *kinds* of docs a user needs — a tutorial to learn it, a how-to for the common task, a reference for the details, a runbook for when it breaks? No linter computes this; you find it by building a matrix and looking for the empty cells.

This page makes both concrete, and then drives home the lesson code coverage already taught: a green number is necessary, not sufficient. A 100% docstring gate, naively applied, doesn't produce good docs — it produces `// the id` on a field called `id`. Coverage tells you where the *holes* are. It cannot tell you whether what fills them is worth reading.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say what "coverage" means for docs in plain terms.
- **Required:** You've seen a code-coverage gate (`--cov-fail-under`, a Codecov status check) and understand the idea of *failing a build on a metric*.
- **Helpful:** You know the four [Diátaxis](https://diataxis.fr/) modes — tutorial, how-to, reference, explanation — at least by name; this page uses the quadrant as a completeness check.
- **Helpful:** You've felt the specific pain of a new hire who couldn't find how to do something that "is documented somewhere."

---

## Symbol Coverage — What the Tools Actually Count

Every symbol-coverage tool does the same three steps, and knowing them keeps you from being surprised by the number:

1. **Enumerate the documentable symbols** — walk the source (usually the AST, sometimes the language's own doc model) and list every module, class, method, function, attribute it considers documentable.
2. **Check each for an attached doc** — a docstring, a `///` doc comment, a `/** */` JSDoc block, in the position the language defines as "the doc for this symbol."
3. **Divide and report** — documented ÷ documentable, often broken down by file and by symbol kind, with an optional **threshold gate** that exits non-zero when the percentage falls below a floor.

The two decisions that actually determine whether the number is meaningful both live in step 1: *what counts as documentable* (do you include private helpers? test functions? generated code?) and *what counts as documented* (is a one-word docstring "documented"? almost always yes — the tool checks presence, not quality). Hold onto that second one; it is the whole reason for the [carried lesson](#the-carried-lesson--covered-is-not-good) below.

> **Key insight:** Symbol-coverage tools measure **presence, not quality**. They answer "does a docstring exist here?" — never "is it any good?" Every design decision and every failure mode in this section descends from that single limitation. Treat the tool as a *hole finder*, and pair it with human review for what's in the holes.

---

## The Tooling, Per Ecosystem

The mechanism is the same everywhere; the tool and the knobs differ. The important columns are *what it counts by default* and *how it gates*.

| Ecosystem | Tool / rule | Gate mechanism |
|---|---|---|
| **Python** | [`interrogate`](https://interrogate.readthedocs.io/) | `--fail-under N` → non-zero exit below `N`% |
| **Go** | `revive`'s `exported` rule (successor to `golint`) | lints exported identifiers lacking a doc comment; fails CI on findings |
| **JS/TS** | ESLint `jsdoc/require-jsdoc` (the `eslint-plugin-jsdoc` package) | reports symbols missing a JSDoc block; `--max-warnings 0` gates |
| **Rust** | `#![warn(missing_docs)]` / `#![deny(missing_docs)]` (built into rustc) | warns/errors on undocumented public items at compile time |

A few specifics worth getting right, because the details are where credibility lives:

- **Python — `interrogate`.** Walks the AST, counts docstrings on modules, classes, methods, functions, nested functions. `--fail-under 80` exits non-zero under 80%. Rich `[tool.interrogate]` config in `pyproject.toml`: `ignore-private`, `ignore-magic`, `ignore-nested-functions`, `ignore-init-method`, plus `exclude` globs. It is *purely presence-based* — a docstring of `"."` counts.

- **Go — exported-identifier doc comments.** The convention is a hard one: every exported (capitalized) identifier should have a doc comment that *starts with the identifier's name* (`// Reload reloads the config.`). The old `golint` enforced this; it's deprecated, and the live tool is **`revive`** with its `exported` rule. Go's own `go doc` and pkg.go.dev render exactly these comments, so the lint and the published docs are the same surface.

- **JS/TS — ESLint.** `eslint-plugin-jsdoc` provides `jsdoc/require-jsdoc` (a block must exist on the configured symbol kinds — `FunctionDeclaration`, `MethodDefinition`, `ClassDeclaration`, etc.) and a family of rules that check the block's *contents* (`require-param`, `require-returns`, `check-types`). The older core `require-jsdoc` rule is deprecated in favor of this plugin. Gate with `--max-warnings 0`.

- **Rust — `missing_docs`.** A built-in rustc lint. `#![warn(missing_docs)]` at the crate root warns on every undocumented **public** item; `#![deny(missing_docs)]` turns those into hard compile errors. Crucially it only fires on the *public* API by design — private items are exempt — which is the behavior every other tool has to be *configured* into.

> **Key insight:** Rust's `missing_docs` is the model the others are trying to reach by configuration: **document the public surface, ignore the private internals, fail the build on a gap.** Whatever ecosystem you're in, that's the target shape — and most of the configuration work below is just making a presence-based tool behave the way `missing_docs` does out of the box.

---

## Configuring It Sanely — Public API, Not Everything

A raw, unconfigured coverage tool measures the wrong denominator. It counts your private helpers, your test functions, your generated protobuf stubs — none of which a *reader* of your docs ever sees. Two failure modes follow: the number is depressed by things that don't need docs (so the gate is unfair and gets ignored), or worse, the gate forces docstrings onto private internals (so you get `# helper` noise on code no external reader will ever read).

The rule is one line: **cover the public API; exclude private, tests, and generated code.** Concretely:

- **Exclude private symbols.** `interrogate --ignore-private`; Rust's lint already does this; in Go you only lint *exported* identifiers anyway. The public surface is the contract; the internals are an implementation detail that should be readable from the code itself.
- **Exclude tests.** Test functions are not documentation surface. `exclude = ["tests", "**/test_*.py"]` in interrogate; scope your ESLint rule to `src/`, not `__tests__/`.
- **Exclude generated code.** Protobuf stubs, ORM models, OpenAPI clients — code you didn't write and can't usefully annotate. Exclude the generated directories outright.
- **Decide on dunder/magic and `__init__` deliberately.** `ignore-magic` and `ignore-init-method` in interrogate exist because `__repr__` and a trivial `__init__` rarely need prose. Turning them on is usually right; the point is to *choose*, not to inherit a default you never looked at.

The test for a sane config is simple: **could a competent reader satisfy this gate by writing only docs a real user would benefit from?** If satisfying the gate requires writing `# the id` on private fields, the denominator is wrong — fix the config, don't write the noise.

---

## Diff Coverage — Gate the New, Forgive the Old

This is the single most important configuration idea on the page, and it's borrowed wholesale from code coverage. A team with a large undocumented legacy codebase that flips on `--fail-under 90` has two outcomes: a red build for months, or a frantic, low-quality docstring sprint to make the number go green. Both are bad. The same trap code coverage solved, and with the same solution.

**Don't gate on absolute project coverage. Gate on the diff** — require docs on **new public symbols**, leave the legacy backlog alone. This is the documentation analog of *diff coverage* (require tests on changed lines, not the whole repo). The properties are exactly what you want:

- New public API arrives documented, because the gate blocks the PR that adds it undocumented.
- Coverage **ratchets upward** automatically as new code displaces old, with no big-bang remediation project.
- The build is green on day one, so the gate is credible and stays on, instead of being disabled the first sprint someone is in a hurry.

Mechanically: run the coverage tool on the PR branch and on the base, and fail if any **newly added public symbol** lacks a doc. Some teams approximate this by scoping the linter to changed files in CI; others compute a true symbol-level diff. The precise mechanism matters less than the policy — and the policy is *new code must be documented; the past is grandfathered.*

> **Key insight:** An absolute-coverage gate on a legacy codebase is a trap that either reddens your build for a quarter or triggers a docstring-padding sprint. **Gate the diff, not the total.** Require docs on new public symbols and let coverage ratchet up as the code turns over — the same move that made code-coverage gates survivable. (Full treatment of the analogy: [Code Coverage](../../code-coverage/).)

---

## The Other Coverage — Doc-Type Coverage via a Matrix

Symbol coverage can be 100% and your documentation can still be unusable, because every symbol having a one-line docstring tells a new user *nothing* about how to accomplish a task end-to-end. There is a second, orthogonal coverage that symbol tools are blind to: **do you have the right *kinds* of docs for each thing you ship?**

The instrument is a **documentation matrix** (a doc-type audit). Lay your product out as a grid:

- **Rows** = the units users care about — features, services, public packages, major workflows.
- **Columns** = the *doc types* each unit might need — **tutorial / how-to / reference / runbook / troubleshooting**. (The first four map cleanly onto the [Diátaxis](https://diataxis.fr/) quadrant; runbook and troubleshooting are the operational genres a developer-facing product also needs.)

Fill each cell with the link to that doc, or mark it empty. **The empty cells are your gaps** — and they are gaps no symbol-coverage tool can ever see, because a missing runbook isn't a missing docstring; it's a missing *document*.

| Feature / Service | Tutorial | How-to | Reference | Runbook | Troubleshooting |
|---|---|---|---|---|---|
| Auth / login | ✅ | ✅ | ✅ | ✅ | ✅ |
| Billing | ✅ | ✅ | ✅ | ❌ | ⚠️ thin |
| Webhooks | ❌ | ✅ | ✅ | ✅ | ✅ |
| Background jobs | ⚠️ thin | ❌ | ✅ | ❌ | ❌ |

The Diátaxis quadrant doubles as a **completeness check** because its four modes are defined to be mutually exclusive and collectively exhaustive over user *needs*: learning (tutorial), a goal in hand (how-to), information lookup (reference), and understanding (explanation). A feature with 100% docstring coverage but no tutorial and no how-to has covered *reference* and **nothing else** — three of four quadrants empty. The matrix makes that visible at a glance; the docstring percentage actively hides it.

> **Key insight:** There are **two coverages**, and they are independent. *Symbol coverage* asks "does each symbol have a docstring?" — a tool computes it. *Doc-type coverage* asks "does each feature have the kinds of docs its users need?" — a matrix reveals it. A perfect score on the first is fully compatible with three empty Diátaxis quadrants on the second. Measure both or you're measuring half.

---

## Gap Analysis — Finding What Isn't There

A matrix surfaces the gaps you *thought to put on the grid*. The harder gaps are the ones you didn't think of — the docs that should exist but never made it onto anyone's list. Three methods find those, and they get progressively more grounded in real evidence:

**The fresh-eyes / new-hire audit.** The cheapest, highest-signal gap finder you have. A person who doesn't yet know the system tries to do a real task using only the docs, and writes down *every* moment they got stuck, guessed, or had to ask someone. Each of those is a gap — and it's a gap an expert literally cannot see, because the expert fills it from memory without noticing. New hires have a short window where they can do this before they, too, internalize the missing knowledge; spend it. (This is the human, fresh-eyes complement to the automated checks — and it overlaps with usability testing a [tutorial](../02-testable-and-executable-docs/middle.md).)

**Support-ticket mining.** Your support queue is a log of documentation failures. Cluster tickets by topic: a cluster of "how do I configure X?" tickets is a missing or unfindable how-to for X. This is the most honest gap signal you have because it's *what real users actually couldn't do*, not what you imagined they'd need. The volume even tells you the priority — fix the doc behind the biggest cluster first.

**Search-query mining.** Your docs site's internal search logs are pure gold. Two patterns name two different gaps: queries with **no results** (or no click on any result) point at content that doesn't exist or isn't findable; **high-volume queries** name the topics people need most — which had better be your best-maintained pages. A search for "rate limit" that returns nothing is a content gap with a built-in demand estimate attached.

The throughline: the matrix finds *structural* gaps (a missing genre), while ticket and search mining find *demand-driven* gaps (a thing real people couldn't do or find) — and demand-driven gaps come pre-prioritized, which is exactly what you need to argue for the time to fix them. That prioritization is the on-ramp to ROI: a documented cluster of tickets is a documented cost, and a documented cost is how you justify the work ([06 — Measuring Docs ROI](../06-measuring-docs-roi/middle.md)).

---

## The Carried Lesson — Covered Is Not Good

Code coverage taught the whole industry one lesson the hard way, and it transfers to docs verbatim: **the moment a metric becomes a gate, it becomes a target, and a target gets gamed.** A 100% line-coverage gate produced tests that execute every line and assert nothing. A 100% docstring-coverage gate produces this:

```python
def get_user_by_id(user_id: int) -> User:
    """Get user by id."""        # restates the signature; zero new information
    ...

class OrderProcessor:
    """The OrderProcessor class."""   # the name, again, with "class" appended
    ...
```

Both functions are "documented." Coverage is 100%. A reader learns nothing they couldn't read off the signature. This is the documentation form of the assertion-free test — the gate is green and the artifact is worthless. (When a comment merely restates the code, it's a *smell*, not documentation — see the `code-comments-documentation` skill and [Clean Code → Comments](../../../code-craft/documentation/).)

The fix is not to abandon the metric — coverage genuinely finds the *undocumented* holes, which is real value. The fix is to **never let the percentage stand alone.** Two guardrails:

1. **Pair the gate with quality review.** Coverage is the automated floor (is a docstring *present*?); a human reviewer in PR is the ceiling (is it *useful* — does it add information beyond the signature?). The number is necessary; the review is what makes it sufficient. What "useful" means is the subject of [What Makes Docs Good](../01-what-makes-docs-good/middle.md).
2. **Be honest about what the number is.** "Docstring coverage" measures *presence of prose*, full stop. Report it as that. The day it gets quoted as "documentation quality" is the day it starts being gamed — exactly as "code coverage" gets misquoted as "test quality."

> **Key insight:** A coverage gate measures whether a docstring *exists*, never whether it's *worth reading* — so on its own it manufactures `"""Get user by id."""` noise, the documentation twin of the assertion-free test. Keep the gate (it finds real holes) but **pair it with human quality review and report it honestly as a presence metric.** Covered ≠ good; that lesson is already paid for in the code-coverage chapter, so don't pay it again.

---

## Worked Example — A Sane interrogate Gate + a Matrix That Finds the Missing Runbook

Two artifacts, one for each coverage. First, the symbol-coverage gate, configured to measure the *public* surface and nothing else.

**1. `pyproject.toml` — a sane interrogate config.**

```toml
[tool.interrogate]
# Cover the PUBLIC API only — exclude noise that depresses or games the number.
ignore-private = true            # private helpers aren't doc surface
ignore-magic = true              # __repr__, __eq__ rarely need prose
ignore-init-method = true        # trivial __init__ adds nothing
ignore-nested-functions = true   # local closures aren't public API
exclude = [
    "tests",                     # tests are not documentation surface
    "docs",
    "**/migrations/*",           # generated / mechanical
    "**/*_pb2.py",               # generated protobuf stubs
]
fail-under = 85                  # the floor; CI exits non-zero below it
verbose = 2                      # per-file breakdown so gaps are locatable
```

```bash
interrogate -c pyproject.toml src/
# RESULT: PASSED (actual: 91.4%)   — and the misses are real public symbols, not noise
```

Note what this config buys: the 91.4% is over code a *reader* actually meets. An unconfigured run might report 62% — dragged down by test functions and protobuf stubs — and the "fix" would have been to write worthless docstrings on generated code. The config makes the gate *fair*, which is what keeps it *on*.

For a new project, gate the absolute number (`fail-under = 85`). For a large legacy one, **gate the diff instead** — wire CI to fail only when a new public symbol arrives undocumented, and let the total ratchet up. Same tool, survivable rollout.

**2. The doc-type matrix — and the gap it exposes.**

Now the coverage interrogate is blind to. Audit the "Payments" area against the five doc types:

| Payments area | Tutorial | How-to | Reference | Runbook | Troubleshooting |
|---|---|---|---|---|---|
| Charge a card | ✅ | ✅ | ✅ (100% docstrings) | ❌ | ✅ |
| Issue a refund | ✅ | ✅ | ✅ | ❌ | ⚠️ thin |
| Handle a failed payment | ⚠️ thin | ✅ | ✅ | ❌ | ✅ |

Symbol coverage for this whole area is **100%** — every public function in the payments module has a docstring, and interrogate is delighted. But the matrix screams: **the entire Runbook column is empty.** There is no document that tells the on-call engineer what to do at 3 a.m. when payments are failing in production — how to check the processor's status, how to safely retry a stuck charge, who to escalate to. That is a severe, on-call-shaped gap, and **no docstring tool on earth would have flagged it**, because a missing runbook is a missing *document*, not a missing docstring.

Cross-check against the support queue and the conclusion sharpens: if "payment stuck / double-charged" is a recurring ticket cluster, the empty Runbook cell isn't just structurally missing — it has *measured demand* and a *measured cost* behind it. That is now the highest-priority doc to write, and you can prove it. The two methods compose: the matrix found the structural hole, ticket mining proved it hurts.

The lesson in one breath: **the docstring gate and the doc-type matrix find different gaps, and you need both.** One guards the API reference; the other guards the on-call engineer.

---

## Mental Models

- **Coverage is a hole finder, not a quality meter.** It reliably tells you *where docs are absent*. It tells you *nothing* about whether the docs that exist are any good. Use it to locate holes; use human review to judge what fills them.

- **There are two coverages, and they're orthogonal.** *Symbol* coverage (a tool: does each symbol have a docstring?) and *doc-type* coverage (a matrix: does each feature have the genres its users need?). 100% on one is fully compatible with huge gaps in the other. Both, or you're half-blind.

- **The matrix turns "are we done?" into "which cell is empty?"** A vague worry ("our docs feel incomplete") becomes a specific, assignable task ("the Billing runbook doesn't exist") the moment you draw the grid. Empty cells are a to-do list.

- **Gate the diff, not the total.** Absolute gates punish the past and get disabled; diff gates protect the future and survive. Require docs on *new* public symbols and let coverage ratchet — the lesson code coverage already learned.

- **The metric you gate is the metric that gets gamed.** A docstring-coverage gate, alone, breeds `"""Get user by id."""`. The countermeasure isn't dropping the gate — it's pairing it with quality review and reporting it honestly as a *presence* metric.

---

## Common Mistakes

1. **Running the coverage tool unconfigured.** The default denominator includes private helpers, tests, and generated code — so the number is meaningless and the gate is unfair. Configure it to the *public API* first (`ignore-private`, `exclude` tests and generated dirs), or it gets ignored.

2. **Gating absolute coverage on a legacy codebase.** Flipping on `fail-under 90` over an undocumented backlog reddens the build for months or triggers a docstring-padding sprint. Gate the *diff* — new public symbols only — and let it ratchet.

3. **Treating docstring coverage as "documentation quality."** It measures presence of prose, not value. Quote it as quality and you've authorized everyone to write `# the id` to make the bar green.

4. **Measuring only symbol coverage and declaring victory.** 100% docstrings with no tutorial and no runbook is three empty Diátaxis quadrants. The number you're proud of is blind to the gap that's hurting users. Build the matrix too.

5. **Forcing docs onto private internals.** A gate that requires docstrings on private helpers produces noise on code no external reader sees. The public surface is the contract; let the internals be readable from the code.

6. **Building the matrix once and never revisiting it.** A doc-type matrix is a snapshot; features ship and cells go stale. It's a recurring audit, not a one-time spreadsheet — and the empty cells move as the product grows.

---

## Test Yourself

1. What are the *three* steps every symbol-coverage tool performs, and which step determines whether the number is meaningful?
2. Name the symbol-coverage tool/rule for Python, Go, JS/TS, and Rust — and say which one covers the public API by default.
3. Why is *diff coverage* (gate new public symbols) the right rollout for docs coverage on a legacy codebase, where an absolute gate is the wrong one?
4. Your module has 100% docstring coverage. What gap could a doc-type matrix still reveal, and why is the docstring tool structurally incapable of seeing it?
5. A `"""Get user by id."""` docstring on `get_user_by_id` satisfies the coverage gate. What lesson from *code* coverage does this repeat, and what's the fix?
6. You have support tickets and docs-site search logs. Name one gap each surfaces that a fresh-eyes audit might miss — and why those gaps come pre-prioritized.

<details>
<summary>Answers</summary>

1. (a) Enumerate the documentable symbols, (b) check each for an attached doc, (c) divide and report (with an optional gate). **Step (a)** is decisive: *what counts as documentable* (public vs private, tests, generated) sets the denominator, and a wrong denominator makes the whole number meaningless.
2. Python → `interrogate` (`--fail-under`); Go → `revive`'s `exported` rule (successor to `golint`); JS/TS → ESLint `jsdoc/require-jsdoc` (from `eslint-plugin-jsdoc`); Rust → `#![warn(missing_docs)]`. **Rust's `missing_docs`** covers the *public* API by default — the others must be configured into that behavior.
3. A legacy codebase has a large undocumented backlog; an absolute gate either reddens the build for a quarter or triggers a low-quality docstring sprint. Diff coverage requires docs only on *new* public symbols, so the build is green on day one (keeping the gate credible), new API arrives documented, and total coverage ratchets up as code turns over — no big-bang remediation.
4. Missing *doc types* — e.g., no tutorial, no how-to, no runbook for the feature. 100% docstrings can mean only the *reference* quadrant is covered. The docstring tool counts presence of a docstring *per symbol*; a missing runbook is a missing **document**, not a missing docstring, so it falls entirely outside what the tool enumerates.
5. It repeats the code-coverage lesson that **a gated metric becomes a gamed target** — the docstring restates the signature and adds nothing, exactly like an assertion-free test that executes a line without checking it. The fix: keep the gate (it finds real holes) but **pair it with human quality review** and report it honestly as a *presence* metric, never as "documentation quality."
6. *Support tickets*: a cluster of "how do I X?" tickets names a missing/unfindable how-to — a real task users couldn't complete. *Search logs*: zero-result or high-volume queries name content that doesn't exist or isn't findable. Both are **demand-driven**: the ticket cluster size and the query volume *are* the priority signal, so they come pre-ranked — unlike a fresh-eyes audit, which finds gaps but not their relative cost.

</details>

---

## Cheat Sheet

```
TWO COVERAGES (orthogonal — measure both)
  symbol   does each symbol have a docstring?   → a TOOL computes it
  doc-type does each feature have the genres?   → a MATRIX reveals it
  100% on one is fully compatible with gaps in the other

SYMBOL-COVERAGE TOOLS
  Python   interrogate            --fail-under N        (pyproject [tool.interrogate])
  Go       revive  exported rule  (golint successor)    exported ids need a doc comment
  JS/TS    eslint  jsdoc/require-jsdoc                  --max-warnings 0 to gate
  Rust     #![warn(missing_docs)] / deny               public API only, built into rustc

CONFIGURE SANELY  (target = Rust's missing_docs behavior)
  cover PUBLIC API   ignore-private
  exclude tests      exclude = ["tests", "**/test_*.py"]
  exclude generated  "**/*_pb2.py", migrations, OpenAPI clients
  test: could a competent reader pass the gate writing ONLY useful docs?

ROLLOUT
  new project   gate absolute   fail-under = 85
  legacy code   GATE THE DIFF   new public symbols only → coverage ratchets up

DOC-TYPE MATRIX   (rows = features, cols = genres; empty cell = gap)
  tutorial | how-to | reference | runbook | troubleshooting
  ^ first four ≈ Diátaxis quadrant → completeness check

GAP ANALYSIS
  fresh-eyes / new-hire audit   structural gaps an expert can't see
  support-ticket mining         demand-driven gaps (pre-prioritized by volume)
  search-query mining           no-result = missing/unfindable; high-volume = critical

THE CARRIED LESSON
  covered ≠ good — a 100% gate breeds  """Get user by id."""
  KEEP the gate (finds holes) + PAIR with quality review + report as PRESENCE
```

---

## Summary

- Symbol-coverage tools all do the same three things — enumerate documentable symbols, check each for a doc, divide and gate — and **measure presence, not quality.** The denominator (what counts as documentable) is what makes the number meaningful or meaningless.
- The tooling per ecosystem: Python's `interrogate` (`--fail-under`), Go's `revive` `exported` rule (the `golint` successor, enforcing doc comments on exported identifiers), JS/TS's ESLint `jsdoc/require-jsdoc`, and Rust's built-in `missing_docs`. **Rust's lint is the model** — public API only, fail the build on a gap.
- Configure the tool to cover the **public API** and exclude private symbols, tests, and generated code. An unconfigured tool measures the wrong denominator and either gets ignored or forces noise onto internals.
- **Gate the diff, not the total.** Require docs on new public symbols; let coverage ratchet up. Absolute gates on legacy code redden the build or trigger padding sprints — the same trap, and the same fix, as code coverage.
- There is a **second, orthogonal coverage** symbol tools are blind to: **doc-type coverage**, measured with a matrix (rows = features, columns = tutorial/how-to/reference/runbook/troubleshooting). Empty cells are gaps; the Diátaxis quadrant doubles as a completeness check. 100% docstrings can still leave three quadrants empty.
- Find the gaps you didn't think to grid with **fresh-eyes audits** (structural gaps experts can't see) and **support-ticket / search-query mining** (demand-driven gaps that come pre-prioritized — the on-ramp to ROI).
- **Covered is not good.** A 100% docstring gate alone breeds `"""Get user by id."""`, the documentation twin of the assertion-free test. Keep the gate, pair it with human quality review, and report it honestly as a presence metric.

---

## Further Reading

- [interrogate documentation](https://interrogate.readthedocs.io/) — the config reference (`ignore-*`, `exclude`, `fail-under`); the canonical sane Python setup.
- [Diátaxis](https://diataxis.fr/) (Daniele Procida) — the four-mode model that turns the doc-type matrix into a completeness check, not an arbitrary grid.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the new-hire/fresh-eyes audit and ticket-driven gap analysis, in practice.
- The Rust `missing_docs` lint and `revive`'s `exported` rule — read the rule docs to see the public-API-only contract the other ecosystems approximate by configuration.

---

## Related Topics

- [junior.md](junior.md) — the intuitive definition of docs coverage this page formalized into a gate.
- [senior.md](senior.md) — coverage as one signal in a documentation quality scorecard, and the org-level politics of gating on it.
- [02 — Testable & Executable Docs](../02-testable-and-executable-docs/middle.md) — the gap that *runs*: docs that can't drift because CI executes them.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/middle.md) — the time dimension: coverage tells you a doc *exists*; freshness tells you it's still *true*.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/middle.md) — where ticket and search mining lead: turning measured gaps into a measured cost.
- [Code Coverage](../../code-coverage/) — the sibling discipline this page borrows from: diff coverage, the gaming problem, covered ≠ good.
- [Code Craft → Documentation](../../../code-craft/documentation/) — how to actually *write* the tutorial, how-to, reference, and runbook the matrix says are missing.

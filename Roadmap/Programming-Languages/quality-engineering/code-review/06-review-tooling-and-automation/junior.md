# Review Tooling & Automation — Junior Level

> **Roadmap:** [Code Review](../README.md) → Review Tooling & Automation
> *A reviewer's attention is the most expensive thing in the whole process. Every comment a machine could have written is a comment that stole attention from the one thing only a human can judge: does this code do the right thing?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Let the Formatter Own Style](#core-concept-1--let-the-formatter-own-style)
5. [Core Concept 2 — Let the Linter Catch the Obvious Bugs](#core-concept-2--let-the-linter-catch-the-obvious-bugs)
6. [Core Concept 3 — CI Must Be Green Before a Human Looks](#core-concept-3--ci-must-be-green-before-a-human-looks)
7. [Core Concept 4 — PR Templates & CODEOWNERS: Routing and Context](#core-concept-4--pr-templates--codeowners-routing-and-context)
8. [Core Concept 5 — Code Suggestions, Draft PRs, and Preview Apps](#core-concept-5--code-suggestions-draft-prs-and-preview-apps)
9. [Core Concept 6 — Async vs Synchronous Review](#core-concept-6--async-vs-synchronous-review)
10. [Core Concept 7 — AI-Assisted Review: A Helper, Not the Reviewer](#core-concept-7--ai-assisted-review-a-helper-not-the-reviewer)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What should a machine do, and what should a human do?**

Picture two pull requests. In the first, the reviewer leaves fourteen comments: eight about indentation and a missing semicolon, three pointing at an unused variable, two noting the tests don't pass, and one — buried at the bottom — asking *"wait, does this actually handle an empty list?"* In the second, a formatter already fixed the layout, a linter already flagged the unused variable, CI already showed the tests failing, and the reviewer left exactly one comment: *"does this handle an empty list?"*

Same code. Same reviewer. The difference is **tooling**. The first reviewer drowned in mechanical noise and almost missed the one bug that mattered. The second was handed a clean diff and spent all of their attention on judgment — on the question a machine *cannot* answer.

This page is about that difference. Review tooling exists for one purpose: to remove the mechanical, repeatable, machine-checkable parts of review so that human reviewers are left with the parts that genuinely need a human — design, correctness, intent, trade-offs, "is this the right thing to build at all." Everything here is in service of one rule, which you should tattoo on your brain:

> **Mindset shift:** if a machine can catch it, a human should never have to comment on it. Style, formatting, lint warnings, broken builds, failing tests — those belong to *tools*, and they should be settled *before* a person ever opens the PR. A reviewer's job is the meaningful stuff. Spending their attention on the mechanical stuff is a waste of the most expensive resource in your team.

You'll learn the concrete tools that make this real: formatters, linters, CI checks, PR templates, `CODEOWNERS`, code suggestions, draft PRs, and preview apps — plus when to switch from written comments to a quick call, and how to use AI review tools without letting them replace your own judgment.

---

## Prerequisites

- **Required:** You have opened a pull request (PR) or merge request (MR) on GitHub, GitLab, or similar, and had someone review it.
- **Required:** You can run a command in a terminal and edit a config file.
- **Helpful:** You've received a review comment that was *purely* about formatting (a space, a blank line, a quote style) and felt it was a bit of a waste of everyone's time. It was — and this page explains the fix.
- **Helpful:** You've seen a PR get reviewed and approved, only to discover later that the tests were red the whole time.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Formatter** | A tool that *automatically rewrites* your code's layout to a fixed style (spacing, line breaks, quotes). It changes how code *looks*, never what it *does*. e.g. `gofmt`, Prettier, Black. |
| **Linter** | A tool that *reads* your code and *flags* likely bugs and bad patterns (an unused variable, a `==` that should be `===`). It warns; it usually doesn't rewrite. e.g. ESLint, golangci-lint, Ruff. |
| **CI (Continuous Integration)** | A server that automatically runs your build, tests, and checks on every PR and reports pass/fail. e.g. GitHub Actions, GitLab CI. |
| **CI check / status check** | One individual pass/fail result CI reports on the PR ("tests ✓", "lint ✗"). |
| **PR template** | A pre-filled description that appears when you open a PR, prompting you to explain *what* and *why*. |
| **`CODEOWNERS`** | A file that maps paths in the repo to the people/teams who must review changes to those paths — it auto-requests the right reviewers. |
| **Code suggestion** | A reviewer-proposed exact change, rendered as a diff the author can apply with one click. |
| **Draft PR** | A PR explicitly marked "not ready to merge" — open for early feedback, but blocked from merging. |
| **Preview app / review app** | A temporary, automatically-deployed copy of your change at its own URL, so reviewers can click around and test it. |
| **Async review** | Review done through written comments, on each person's own schedule (the default). |
| **Synchronous review** | Review done live — a call, screen-share, or pairing session — at the same time. |
| **AI review** | A tool (e.g. GitHub Copilot review, CodeRabbit) that automatically posts review-style comments on a PR. |
| **`pre-commit`** | A popular framework that runs formatters/linters automatically *before* a commit is created, so problems are fixed before they ever reach a PR. |

---

## Core Concept 1 — Let the Formatter Own Style

A **formatter** is a tool that takes your code and rewrites its *layout* to one fixed style: indentation, spacing, line length, where the braces go, single vs double quotes. Crucially, it changes only how the code *looks* — never what it *does*. Run it and the file is reformatted; run it again and nothing changes, because it's already in the canonical form.

Examples by language:

| Language | Formatter | How you run it |
|---|---|---|
| Go | `gofmt` / `goimports` | `gofmt -w .` |
| JavaScript / TypeScript | Prettier | `npx prettier --write .` |
| Python | Black | `black .` |
| Rust | `rustfmt` | `cargo fmt` |

Why does this belong on a page about *review*? Because formatting is the single most common category of useless review comment. *"Add a space here." "This line is too long." "We use single quotes."* Every one of those is a machine's job. When a formatter runs automatically, **style stops being an opinion** — there is exactly one correct layout, the tool produces it, and there is nothing left to argue about or comment on.

The goal is to make formatting *impossible to get wrong*, by running it automatically. Two common ways:

```yaml
# .pre-commit-config.yaml — runs Black on every commit, before the commit is even made
repos:
  - repo: https://github.com/psf/black
    rev: 24.4.2
    hooks:
      - id: black
```

```yaml
# .github/workflows/format-check.yml — CI fails if anything is unformatted
name: format
on: [pull_request]
jobs:
  prettier:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx prettier --check .   # --check = fail if not formatted; --write = fix it
```

> **Key insight:** the point of a formatter is not "pretty code." It's *ending the conversation*. Once a formatter runs automatically, nobody on your team ever debates tabs-vs-spaces or quote style again, and nobody ever leaves (or receives) a review comment about it. That's hours of human attention reclaimed, every single week, for the price of one config file.

A note for *you, the author*: run the formatter (or set up the editor to format-on-save) **before** you push. If you don't, and CI enforces formatting, your PR will fail the format check and you'll have to push a second commit just to fix whitespace — slow and a little embarrassing. Format locally; arrive clean.

---

## Core Concept 2 — Let the Linter Catch the Obvious Bugs

A **linter** reads your code and *flags* things that are likely wrong: an unused variable, an unreachable line, a `catch` block that swallows the error, a `==` where you almost certainly meant `===`, a function that's far too complex. Where a formatter rewrites *layout*, a linter reasons about *patterns* — it's a junior member of the static-analysis family (see [Static Analysis & Linting](../../static-analysis/)).

| Language | Linter | What it catches (examples) |
|---|---|---|
| JavaScript / TypeScript | ESLint | unused vars, `==` vs `===`, missing `await`, React hook misuse |
| Go | golangci-lint | unchecked errors, shadowed variables, ineffectual assignments |
| Python | Ruff / Flake8 | unused imports, undefined names, mutable default arguments |

Run it on the command line and you get a list:

```text
$ npx eslint src/
src/cart.js
  12:7   error  'subtotal' is assigned a value but never used   no-unused-vars
  29:14  error  Expected '===' and instead saw '=='             eqeqeq
  41:1   error  Unexpected console statement                     no-console

✖ 3 problems (3 errors, 0 warnings)
```

Read that list and notice something: **a reviewer would have had to spot every one of those by eye.** The unused `subtotal`, the loose `==`, the stray `console.log` — all three are exactly the kind of thing a tired human skims past. The linter never gets tired and never skims. So we let the linter own them, and the human gets to skip them entirely.

This is the same rule as before, generalized: *if a machine can catch it, a human shouldn't have to comment on it.* The formatter owns layout; the linter owns the mechanical "likely-bug" patterns; together they clear the diff of mechanical noise so the reviewer's eye lands only on the things that actually require thought.

> **Key insight:** linters and formatters are different jobs. A **formatter** rewrites *layout* and is always safe to auto-apply. A **linter** flags *suspicious patterns* — some it can auto-fix, but many are genuine "a human decided this is probably a bug" warnings. Run both, automatically, before review. The formatter makes style a non-issue; the linter makes a whole class of small bugs a non-issue.

Like the formatter, the linter should run *before* a human reviews — in `pre-commit` locally, and again as a CI check so nothing slips through. Which is exactly the next concept.

---

## Core Concept 3 — CI Must Be Green Before a Human Looks

**CI** (Continuous Integration) is a server that, on every push to a PR, automatically runs your project's checks — build, tests, formatter check, linter — and reports each as a pass/fail **status check** right on the PR. You've seen them: the little green ✓ or red ✗ next to "build," "test," "lint."

The rule is blunt: **a human should not review a PR until CI is green.** Here's why. A reviewer's time is expensive and finite. If the tests are failing, the build is broken, or the linter is screaming, then *the machine already knows the PR isn't ready* — and asking a human to review it anyway wastes their attention on code that's going to change. Worse, the author might get an approval, merge a red build, and break the branch for everyone.

A minimal CI config that gates a PR on tests and lint:

```yaml
# .github/workflows/ci.yml
name: ci
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint        # linter must pass
      - run: npm test            # tests must pass
```

Teams then make these checks **required**: the repo is configured so a PR *cannot be merged* until the required checks are green. That's a **quality gate** — an automated bar a change must clear before it's allowed through. (The whole discipline of designing those gates is its own topic: [Quality Gates](../../quality-gates/).)

> **Key insight:** CI is the machine doing the *first pass* of review for free, before any human is involved. "Do the tests pass? Does it build? Is it linted?" are questions a computer should answer, not a person. Green CI is the *entry ticket* to human review — not a nice-to-have you check afterward. If you ask for review on a red PR, you're asking a human to do a machine's job.

For you as an author: **make CI green before you request a review.** If a check is red, fix it (or, if it's a flaky/unrelated failure, say so explicitly in a comment) *before* you tag a reviewer. Requesting review on a red PR is one of the fastest ways to annoy your team — see [Testing](../../testing/) for what those automated checks are actually verifying.

---

## Core Concept 4 — PR Templates & CODEOWNERS: Routing and Context

Two small files quietly fix two of the most common review frictions: *"I have no idea what this PR is for"* and *"who's even supposed to review this?"*

### PR templates — give the reviewer context for free

A **PR template** is a markdown file in your repo that GitHub/GitLab automatically loads into the description box every time someone opens a PR. Instead of a blank box (which authors fill with `fix stuff`), the author gets a prompt:

```text
# .github/pull_request_template.md
## What does this PR do?
<!-- One or two sentences. What changed and why? -->

## How was it tested?
<!-- Unit tests? Manual? Steps to reproduce? -->

## Checklist
- [ ] Tests added/updated
- [ ] Docs updated if behavior changed
- [ ] No secrets or debug logging left in
```

This does for *context* what the formatter does for *style*: it makes the good default automatic. A reviewer who opens a PR and immediately knows *what it does, why, and how it was tested* can review faster and better — and never has to leave the comment *"can you explain what this is for?"* The checklist also nudges the author to catch their own mistakes before a human does.

### CODEOWNERS — auto-request the right reviewers

`CODEOWNERS` is a file that maps **paths in the repo** to the **people or teams who own them**. When a PR touches a path, the matching owners are *automatically requested* as reviewers. No more guessing who knows the payments code, and no more "this sat for two days because nobody knew it was waiting for them."

```text
# .github/CODEOWNERS
# Syntax:  <path pattern>   <owner> [<owner> ...]

# Default owner for everything (catch-all, lowest priority)
*                       @acme/core-team

# Frontend code is owned by the web team
/src/web/               @acme/web-team

# Anything under payments needs a payments reviewer — money is sensitive
/src/payments/          @acme/payments-team  @alice

# A single critical file owned by one specific person
/deploy/prod.yaml       @bob
```

How it reads: patterns work top-to-bottom, and the **last matching pattern wins**. So a change to `/src/payments/charge.js` auto-requests `@acme/payments-team` and `@alice`, *not* the catch-all `@acme/core-team`, because the payments line is more specific and comes later. Teams often pair this with a branch rule requiring **code-owner approval**, so sensitive paths *cannot* be merged without the right eyes on them.

> **Key insight:** `CODEOWNERS` automates *reviewer routing*, and PR templates automate *context*. Both remove a category of friction (and a category of useless review comments) by making the right thing happen by default. The reviewer never asks "what is this?" because the template answered it, and the review never stalls because nobody knew it was their turn — `CODEOWNERS` tagged them automatically.

---

## Core Concept 5 — Code Suggestions, Draft PRs, and Preview Apps

Three features that make the *back-and-forth* of review faster and less painful.

### Code suggestions — propose the exact change

Instead of writing *"I think this should use `Number.isNaN` instead of the global `isNaN`,"* and forcing the author to figure out and type the fix, a **code suggestion** lets the reviewer write the *exact* replacement as a diff. The author sees it rendered, clicks **"Commit suggestion,"** and it's applied. On GitHub you write it with a special fenced block in a review comment:

````text
The global `isNaN` coerces its argument, which hides bugs. Use the strict form:

```suggestion
  if (Number.isNaN(value)) {
```
````

The author clicks one button and the line is changed and committed — no copy-paste, no "did I apply it right?", no extra round trip. Suggestions are perfect for small, concrete fixes: a typo, a rename, a one-liner. (For anything large, write prose and let the author do it — a giant suggestion is hard to review and easy to misuse.)

### Draft PRs — open early, signal "not ready"

A **draft PR** is a PR explicitly marked *"not ready to merge."* It runs CI, it's visible, people can comment — but it's **blocked from merging** and usually doesn't fire off the full reviewer-request machinery. Use it to get *early* feedback on a direction *before* you've polished everything: *"here's my rough approach to the caching layer — does the shape look right before I write all the tests?"* Catching a wrong direction at the draft stage is vastly cheaper than catching it after you've finished and polished the whole thing. When it's truly ready, you click **"Ready for review"** and it becomes a normal PR.

### Preview apps — let reviewers click the change

A **preview app** (or **review app**) is a temporary, automatically-deployed copy of your branch, served at its own throwaway URL (e.g. `pr-482.preview.acme.dev`). Platforms like Vercel, Netlify, and Heroku Review Apps spin one up for every PR. Instead of *imagining* what your UI change looks like from the diff, a reviewer **clicks the link and actually uses it** — checks the button, tests the form, sees the layout on mobile. For anything user-facing, this turns "I think this looks right" into "I clicked it and it works." The environment is torn down when the PR closes.

> **Key insight:** these three features all attack *latency and friction* in the loop. A suggestion collapses "describe the fix → author interprets → author types → reviewer re-checks" into one click. A draft PR moves feedback *earlier*, when changing course is cheap. A preview app lets a reviewer *experience* the change instead of *guessing* from the diff. Less friction means tighter, faster, higher-quality review.

---

## Core Concept 6 — Async vs Synchronous Review

Most code review is **asynchronous**: the author opens a PR, reviewers read it and leave written comments *whenever it fits their schedule*, the author responds in writing, and so on. Async is the default for good reasons — it doesn't require everyone to be free at the same time (huge for different time zones), it leaves a written record on the PR, and it lets the reviewer think carefully instead of reacting live.

But async isn't always the *right* tool. **Synchronous** review happens live — a quick call, a screen-share, or sitting (virtually) together and walking through the code, sometimes as pair programming. It costs more (two people, same time) but it has a much tighter feedback loop: a confusing five-comment thread can be resolved in a two-minute conversation.

When to reach for a synchronous touch instead of (or alongside) async:

| Situation | Better choice | Why |
|---|---|---|
| Small, clear change | **Async** | Comments are enough; don't interrupt anyone. |
| Large or architecturally significant PR | **Sync** (walkthrough) | The author can explain the *why* and structure live; far faster than 40 comments. |
| A comment thread has gone back-and-forth 5+ times | **Sync** (quick call) | The written channel has failed; talk it out, then summarize the decision back on the PR. |
| A genuine disagreement on approach | **Sync** | Tone and nuance survive a conversation; they die in text. |
| Reviewing across distant time zones | **Async** | A live call would mean someone's awake at 3 a.m. |
| Onboarding / teaching moment | **Sync** (pairing) | Watching someone work teaches more than written notes. |

> **Key insight:** async is the default, not the law. The moment a written thread starts going in circles, or a PR is too big and confusing to review comment-by-comment, **switch to a five-minute call.** It's not "giving up on review" — it's picking the faster tool. The one rule: after a synchronous discussion, *write the decision back on the PR* so the reasoning is recorded for everyone who wasn't on the call. (How to phrase feedback in either channel is its own skill: [Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md).)

---

## Core Concept 7 — AI-Assisted Review: A Helper, Not the Reviewer

**AI review** tools — GitHub Copilot's PR review, CodeRabbit, and others — automatically read a PR and post review-style comments: *"this might be a null-pointer issue," "consider extracting this into a function," "this regex looks off."* They can be genuinely useful as a **first pass**: they catch some obvious bugs, flag common smells, and can summarize a large diff so a human reviewer gets oriented faster. Think of an AI reviewer as an extra-thorough linter that talks in sentences.

But — and this is the part juniors most need to hear — **AI review is a helper, not the reviewer.** Here's why it can't replace a human:

- **It misses context.** It doesn't know your product, your users, last quarter's incident, or why this module is deliberately weird. It can tell you the code is *internally* odd; it can't tell you it's *wrong for your business.*
- **It can be confidently wrong.** It will sometimes flag a "bug" that isn't one, or suggest a "fix" that breaks something. Apply its suggestions only after *you* understand and agree with them — never on autopilot.
- **It can be noisy.** Left unchecked, it may leave a dozen low-value nitpicks that *add* to the very noise we're trying to remove. Tune it, or it becomes part of the problem.
- **It can't own the decision.** Approving a PR is a statement of *accountability* — "I looked at this and I'm comfortable shipping it." A tool can't be accountable. A person has to.

So the healthy way to use it: let the AI do a *first pass* to catch the easy stuff and orient you, then **a human does the real review** — judging design, correctness, and intent, the things only a human can. The AI's comments are *input* to your thinking, not a substitute for it.

> **Key insight:** AI review sits in exactly the same bucket as formatters and linters — *automate the mechanical, free the human for the meaningful* — but with a sharp warning attached: it's far less reliable than a formatter or a deterministic linter, so you must **verify everything it says.** A formatter is always right about formatting. An AI reviewer is *sometimes* right about a *judgment call*, which is a completely different level of trust. Use it; never outsource your thinking to it.

---

## Real-World Examples

**1. The formatter that ended a two-year war.** A team had a recurring fight in reviews about whether to use trailing commas, and every PR collected two or three comments about quote style and spacing. One afternoon someone added Prettier with a `--check` step in CI and a one-time "reformat the whole repo" commit. The fights stopped *that day*. Not because anyone won the argument — because the argument became impossible. The tool produces one layout; there's nothing left to comment on. Reviews got noticeably shorter, and the comments that remained were about logic.

**2. The red PR that got approved.** A junior opened a PR, the reviewer skimmed it, said "looks good," and approved — without noticing the CI tests were red the whole time. It merged, broke the main branch, and blocked the whole team's deploys for an hour while someone bisected the failure. The fix was process, not blame: the repo was changed to make the test check **required**, so a red PR now *physically cannot* be merged. The machine now enforces what the human forgot — a textbook [quality gate](../../quality-gates/).

**3. The 1,200-line PR that needed a call, not comments.** A reviewer opened a large refactor and started typing comments — then stopped at comment number eleven, realizing they didn't understand the *overall shape* of the change and were nitpicking lines in a structure they hadn't grasped. They messaged the author: *"This is big — can you give me a 10-minute walkthrough?"* On the call the author explained the structure in three minutes, the reviewer's confusion evaporated, and they agreed on two real changes. Eleven half-formed comments became one short conversation and a clear summary written back on the PR.

**4. The AI reviewer that cried wolf — and once was right.** A team turned on an AI reviewer. For two weeks it left mostly noise: style nitpicks the formatter already handled, "consider renaming" suggestions nobody wanted. The team almost turned it off. Then on one PR it flagged a genuine off-by-one in a loop bound that two humans had skimmed past. The lesson the team took: keep it, but *tune it down* to only high-signal checks, and treat every comment as a *suggestion to verify*, not a verdict. As a first-pass net it earned its keep — as a "reviewer" it would have been a disaster.

---

## Mental Models

- **The funnel.** Picture a funnel that filters out everything a machine can handle before a human ever sees the PR. Top layer: the **formatter** (style gone). Next: the **linter** (obvious bad patterns gone). Next: **CI/tests** (broken builds gone). What drips out the bottom is the *meaningful* stuff — design, correctness, intent — and *that's* all the human reviews. Every layer you add to the funnel is attention you give back to your reviewer.

- **Tools clear the table; humans cook the meal.** Formatters and linters and CI are the prep cooks who chop the vegetables and wash the dishes. They don't decide *what dish to make* — that's the chef. Don't make your chef (the reviewer) wash dishes (comment on whitespace).

- **Async is mail; sync is a phone call.** Most things go by mail — convenient, on your own time, leaves a paper trail. But when the letters start crossing and nobody's understanding anybody, you pick up the phone. The mistake is using mail for an argument that needed a phone call (a thread spiraling to fifteen comments) — or a phone call for something a postcard would've handled (interrupting someone for a typo).

- **AI review is a smoke detector, not a firefighter.** A smoke detector is cheap, runs all the time, and is worth having — it might catch a fire early. But it sometimes goes off because you made toast, and it has *never once* put out a fire. You still need a firefighter (a human) who understands the situation and is accountable for the outcome.

---

## Common Mistakes

1. **Leaving review comments about formatting.** If you're typing *"add a space"* or *"this line's too long,"* stop — that's a formatter's job. Add a formatter and a CI check; never let style be a human comment again.

2. **Requesting review on a red PR.** Asking a human to review code that doesn't even pass CI wastes their attention on code that's about to change. Make CI green first; if a failure is flaky or unrelated, say so explicitly before tagging anyone.

3. **Writing prose for a one-line fix.** If you can express the change as an exact diff, use a **code suggestion** — one click for the author beats a paragraph they have to interpret and retype.

4. **Using a giant code suggestion for a big change.** Suggestions are for small, concrete fixes. A 40-line suggestion is hard to review and easy to apply blindly — write prose and let the author make the change.

5. **Battling in a comment thread past five rounds.** When written back-and-forth stops converging, *switch to a quick call.* Then write the decision back on the PR. Grinding it out in text wastes time and frays tempers.

6. **Treating AI review comments as verdicts.** AI reviewers are sometimes confidently wrong and often noisy. Apply a suggestion only after *you* understand and agree with it. It's a first-pass helper, never the accountable reviewer.

7. **Skipping the PR description because there's a template.** The template is a *prompt*, not decoration. *"fix stuff"* in a templated box is still useless. Actually answer *what* and *why* — it's the cheapest way to make your reviewer faster.

8. **Not setting up `CODEOWNERS`, then wondering why PRs stall.** If nobody is auto-requested, PRs sit until someone happens to notice. A few lines of `CODEOWNERS` route every change to the right people automatically.

---

## Test Yourself

1. A reviewer leaves the comment *"please use single quotes here, we don't use double quotes."* What tool should have made this comment impossible, and how?
2. What's the difference between a **formatter** and a **linter**? Give one example of each.
3. Your teammate asks you to review their PR, but the CI "test" check is red. What should you do, and why?
4. What does a `CODEOWNERS` file do, and what problem does it solve?
5. You spot a typo in a variable name in someone's PR. What's the *fastest* way to get it fixed, and why is it faster than a normal comment?
6. When should you stop reviewing asynchronously (written comments) and switch to a synchronous call? Give two situations.
7. An AI review tool comments *"this looks like a null-pointer bug."* What should you do before acting on it, and why can't the AI just be trusted to be the reviewer?
8. What is a **draft PR**, and why would you open one before your code is finished?

<details>
<summary>Answers</summary>

1. A **formatter** (Prettier, Black, `gofmt`), run automatically — ideally in `pre-commit` and enforced by a CI `--check` step. Once one canonical layout is auto-produced, there's nothing left to comment on; quote style stops being an opinion.
2. A **formatter** *rewrites layout* (spacing, quotes, line breaks) and never changes behavior — e.g. Prettier, Black. A **linter** *flags likely bugs and bad patterns* (unused variables, `==` vs `===`) and usually warns rather than rewrites — e.g. ESLint, golangci-lint, Ruff.
3. **Don't review yet** — tell them CI is red and ask them to fix it first (or explain why the failure is flaky/unrelated). A reviewer's attention shouldn't be spent on code that doesn't pass the machine's first-pass checks and is about to change. Green CI is the entry ticket to human review.
4. `CODEOWNERS` maps repo paths to the people/teams who own them, so the right reviewers are **automatically requested** when a PR touches those paths. It solves "who should review this?" and "the PR stalled because nobody knew it was their turn."
5. A **code suggestion** — propose the exact corrected text as a one-click diff. It's faster because the author just clicks "Commit suggestion" instead of reading your prose, interpreting it, and retyping the fix (and there's no risk of applying it wrong).
6. Any two of: the PR is large or architecturally significant (do a walkthrough); a comment thread has gone back-and-forth 5+ times without converging; there's a genuine disagreement on approach; it's an onboarding/teaching moment. After the call, write the decision back on the PR.
7. **Verify it yourself** — read the code and confirm whether the null case is actually possible — before changing anything. The AI lacks context (your product, your invariants, your history), can be confidently wrong, and **can't be accountable** for shipping the change. Approval is a statement of human accountability, which a tool can't make.
8. A **draft PR** is a PR explicitly marked "not ready to merge" — it runs CI and is open for comments but is blocked from merging. You open one to get *early* feedback on your direction before you've polished everything, because catching a wrong approach early is far cheaper than after the work is finished.

</details>

---

## Cheat Sheet

```text
THE ONE RULE
  If a machine can catch it, a human should never comment on it.

WHO OWNS WHAT
  Formatter (gofmt/Prettier/Black) ...... layout/style   → auto-fix, always
  Linter (ESLint/golangci-lint/Ruff) .... likely bugs    → flag (some auto-fix)
  CI (tests/build/lint) ................. "is it ready?"  → green BEFORE review
  Human reviewer ........................ design, correctness, intent

BEFORE YOU REQUEST REVIEW (author checklist)
  [ ] Formatter ran (format-on-save or pre-commit)
  [ ] Linter passes
  [ ] CI is GREEN (or red-failure explained)
  [ ] PR description filled (what + why + how tested)

ROUTING & CONTEXT
  CODEOWNERS  → auto-requests the right reviewers per path (last match wins)
  PR template → prompts author for what/why/how-tested

REVIEWER FRICTION-CUTTERS
  Code suggestion → one-click exact fix (small changes only)
  Draft PR        → early feedback, blocked from merge
  Preview app     → temporary URL; click and test the real change

ASYNC vs SYNC
  Default = async (written comments, own schedule, paper trail)
  Switch to a CALL when: PR is big/confusing • thread loops 5+ times • real disagreement
  Then: write the decision back on the PR.

AI REVIEW
  Good first pass (catches obvious stuff, summarizes diffs).
  NOT the reviewer: misses context, can be wrong/noisy, can't be accountable.
  Verify every suggestion before acting.
```

---

## Summary

- The whole point of review tooling is **one rule**: *if a machine can catch it, a human should never have to comment on it.* Automate the mechanical so humans review the meaningful — design, correctness, intent.
- A **formatter** (`gofmt`, Prettier, Black) auto-rewrites layout so **style is never a review comment**. A **linter** (ESLint, golangci-lint, Ruff) flags likely bugs and bad patterns automatically. Run both before review — locally via `pre-commit`, again in CI.
- **CI must be green before a human reviews.** Tests, build, and lint are the machine's free first pass; green CI is the *entry ticket* to human review, and required checks form a [quality gate](../../quality-gates/) that blocks merging a broken PR.
- **PR templates** give reviewers context for free (what / why / how tested); **`CODEOWNERS`** auto-requests the right reviewers per path so PRs don't stall waiting to be noticed.
- **Code suggestions** turn a fix into a one-click diff (for small changes); **draft PRs** move feedback earlier, when changing direction is cheap; **preview apps** let reviewers *click and test* the real change instead of guessing from the diff.
- **Async** (written comments) is the default; switch to a **synchronous** call when a PR is large/confusing, a thread is looping, or there's a real disagreement — then record the decision back on the PR.
- **AI review** is a useful *first-pass helper* but **not the reviewer**: it misses context, can be confidently wrong and noisy, and can't be accountable. Verify everything it says; never outsource your judgment to it.

Set up the tools once, and every review afterward is shorter, calmer, and aimed at the things that actually matter. The next level — [middle.md](middle.md) — goes deeper on configuring these gates, tuning linters for low noise, and building review automation that scales to a whole team.

---

## Further Reading

- [GitHub Docs — About code owners (`CODEOWNERS`)](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — exact syntax, precedence, and how auto-requesting works.
- [GitHub Docs — Creating a pull request template](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository) — where the file goes and how it loads.
- [GitHub Docs — Incorporating feedback with suggested changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request) — the one-click suggestion workflow.
- [The `pre-commit` framework](https://pre-commit.com/) — run formatters and linters automatically before every commit; the standard way to "arrive clean."
- [reviewdog](https://github.com/reviewdog/reviewdog) and [Danger](https://danger.systems/) — bots that post linter output and enforce PR conventions as automated review comments.
- The [middle.md](middle.md) of this topic — configuring required checks, tuning linters for signal over noise, and team-scale review automation.

---

## Related Topics

- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md) — once tools clear the mechanical noise, *how* you phrase the human comments that remain.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md) — the meaningful things a human should spend their freed-up attention on.
- [Static Analysis & Linting](../../static-analysis/) — the deeper family that linters belong to: catching bugs by analyzing code without running it.
- [Quality Gates](../../quality-gates/) — making "green CI before merge" an enforced, automated bar.
- [Testing](../../testing/) — what those automated CI checks are actually verifying before a human ever looks.

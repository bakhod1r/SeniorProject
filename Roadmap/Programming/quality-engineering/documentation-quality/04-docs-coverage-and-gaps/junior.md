# Docs Coverage & Gaps — Junior Level

> **Roadmap:** [Documentation Quality](../README.md) → Docs Coverage & Gaps
> *You can't fix a hole you can't see. "Docs coverage" is the simple trick of pointing a tool at your codebase and asking: which of these public functions has a doc comment — and which has nothing at all?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Docs Coverage, by Analogy to Code Coverage](#core-concept-1--docs-coverage-by-analogy-to-code-coverage)
5. [Core Concept 2 — Per-Symbol Coverage: Tools That Count Docstrings](#core-concept-2--per-symbol-coverage-tools-that-count-docstrings)
6. [Core Concept 3 — The Other Gap: Missing Doc *Types*](#core-concept-3--the-other-gap-missing-doc-types)
7. [Core Concept 4 — Covered ≠ Good (the Coverage Trap, Again)](#core-concept-4--covered--good-the-coverage-trap-again)
8. [Core Concept 5 — How to Actually Find Gaps](#core-concept-5--how-to-actually-find-gaps)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Finding what is *not* documented.**

You've inherited a codebase. It has *some* docs — a README, a handful of comments, maybe a docs site. The question every new engineer asks within their first week is not "are these docs good?" but the more basic one: *"is there a doc for the thing I'm trying to use, or is there nothing?"* That second question — presence vs absence — is what **docs coverage** measures.

The idea is borrowed wholesale from **code coverage**, which you may already know: code coverage asks *"what fraction of my code lines did my tests run?"* Docs coverage asks the parallel question: *"what fraction of my public functions, classes, and modules have a doc comment?"* If 40% of your public API has a docstring, you have 40% docs coverage, and 60% of your public surface is a silent black box that a newcomer has to read the source to understand.

There are two completely different kinds of gap, and beginners usually only think about the first. **Per-symbol gaps** are individual undocumented things: a public function with no docstring. A tool can count these for you. But the bigger, scarier gaps are **missing doc *types*** — your project has zero getting-started guide, no troubleshooting page, no runbook for when the service falls over at 3 a.m. No tool counts those automatically, and they are usually the gaps that hurt most.

And there's one caveat we have to nail down immediately, because ignoring it is the single most common mistake in this whole area: **a docstring that exists but says nothing is still "covered."** A function `getUser()` with the comment `// gets the user` counts toward your coverage percentage, yet it taught the reader *nothing*. Coverage measures presence, not value — exactly like code coverage measures that a line *ran*, not that it was *tested well*.

> **The mindset shift:** stop reading "90% docs coverage" as "90% of our docs are good." Read it as "90% of our public symbols have *some text* attached." A docstring that exists is not the same as a question answered. Coverage finds *silence*; it cannot detect *noise pretending to be an answer*.

This page teaches you to find the holes: run the tool, read its report, and — just as importantly — ask a brand-new teammate what they couldn't find.

---

## Prerequisites

- **Required:** You can read and write a function in at least one language (examples use **Python**, with a glance at **Go** and **JavaScript**).
- **Required:** You know what a *comment* is and have seen a *docstring* or doc comment (the special comment right above a function that tools can read).
- **Helpful:** You've heard of **code coverage** — the "your tests cover 85% of the code" number. If not, the analogy still works; we explain it.
- **Helpful:** You've once searched a project's docs for something, found nothing, and had to read the source instead. That feeling *is* a coverage gap.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Docstring / doc comment** | A structured comment attached to a function, class, or module that documentation tools can read (Python `"""..."""`, Go's comment above a function, a JS `/** ... */` block). |
| **Public symbol** | A function, class, method, or module meant to be used from *outside* the file — the API surface. The thing that *needs* docs. |
| **Docs coverage** | The fraction of public symbols that have a docstring. `documented ÷ total public`. |
| **Per-symbol gap** | One specific undocumented thing — a public function with no docstring. Countable by a tool. |
| **Doc-type gap** | A *whole category* of documentation that doesn't exist — no tutorial, no troubleshooting page, no runbook. Not countable by a docstring tool. |
| **Coverage trap** | Mistaking presence of a docstring for usefulness of a docstring. "Covered" ≠ "good." |
| **`interrogate`** | A popular Python tool that measures docstring coverage and prints a percentage. |

---

## Core Concept 1 — Docs Coverage, by Analogy to Code Coverage

If you've seen code coverage, docs coverage will click in one sentence. Here they are side by side:

```
CODE coverage:  (lines your tests RAN)        ÷ (total lines)        → a %
DOCS coverage:  (public symbols WITH a docstring) ÷ (total public symbols) → a %
```

Both are a simple ratio. Both answer a *presence* question — "did this line run?" / "does this function have a doc?" — and **neither answers a *quality* question.** That parallel is not a coincidence; the docs-coverage idea was deliberately copied from code coverage, and it inherits both its usefulness *and* its famous blind spot.

Why bother computing it at all? Because the number turns a vague worry ("our docs feel patchy") into something concrete you can track, compare, and put a target on. "Docs coverage on the `payments` package is 35%" is a fact you can act on. "Our docs feel thin" is a feeling you can argue about forever.

Here's the smallest possible example. Imagine a file with four public functions:

```python
def add(a, b):
    """Return the sum of two numbers."""   # ← documented
    return a + b

def subtract(a, b):                         # ← NOT documented
    return a - b

def multiply(a, b):
    """Return the product of two numbers.""" # ← documented
    return a * b

def divide(a, b):                            # ← NOT documented
    return a / b
```

Two of four public functions have a docstring. **Docs coverage = 2 ÷ 4 = 50%.** That's the whole calculation. A tool does exactly this, just across thousands of symbols instead of four.

> **Key insight:** docs coverage is a *ratio of presence*, copied straight from code coverage. It tells you where the *silence* is — the symbols with no documentation at all. That's genuinely useful: silence is the easiest gap to find and the easiest to justify fixing. Just never let the percentage trick you into thinking the *documented* half is any good. (We come back to this in [Concept 4](#core-concept-4--covered--good-the-coverage-trap-again).)

---

## Core Concept 2 — Per-Symbol Coverage: Tools That Count Docstrings

You will not count docstrings by hand. Every major language has a tool that walks your code, finds the public symbols, checks each for a docstring, and reports the percentage. In Python the popular one is **`interrogate`**.

You point it at a directory and it prints a per-file breakdown plus a total. The output looks like this:

```
$ interrogate -v mypackage/

============================ Coverage for mypackage/ =============================
| Name                                       | Total | Miss | Cover | Cover% |
|--------------------------------------------|-------|------|-------|--------|
| mypackage/__init__.py (module)             |     1 |    0 |     1 |   100% |
| mypackage/payments.py (module)             |     1 |    1 |     0 |     0% |
|   charge_card (L12)                        |     1 |    0 |     1 |        |
|   refund (L40)                             |     1 |    1 |     0 |        |
|   _validate (L55)                          |     1 |    1 |     0 |        |
| mypackage/users.py (module)                |     1 |    0 |     1 |   100% |
|   get_user (L8)                            |     1 |    0 |     1 |        |
|   create_user (L20)                        |     1 |    0 |     1 |        |
|--------------------------------------------|-------|------|-------|--------|
| TOTAL                                      |     8 |    3 |     5 |  62.5% |
==================================================================================
RESULT: PASSED (minimum: 60.0%, actual: 62.5%)
```

Read that report like a map of holes. `payments.py` is the problem area: the module itself has no docstring, `refund` has none, and `_validate` has none. `users.py` is fully covered. The bottom line — **62.5%** — is the headline number, and because we set a minimum of 60%, the check *passed*.

That last part is the real power move. You can put this number in **CI** (your automated checks that run on every change) with a threshold:

```bash
interrogate --fail-under 60 mypackage/
# exits non-zero if coverage drops below 60% → the build fails
```

Now coverage can only go *up* or stay flat — nobody can merge a new public function with no docstring without tripping the check. This is exactly how teams use code-coverage thresholds, and it's the most common, most useful thing you'll do with docs coverage.

The equivalents in other ecosystems do the same job from a different angle:

- **Go** — `go doc` / `godoc` *renders* the doc comments for your public (capitalized) identifiers. A symbol that shows up with no description is a visible gap. Linters like `revive` can flag exported symbols missing a comment.
- **JavaScript / TypeScript** — `eslint-plugin-jsdoc` with the `require-jsdoc` rule fails the lint when a public function lacks a `/** ... */` block; **JSDoc** then renders what exists.
- Most other languages have a similar pairing: one tool that *renders* docs, and a linter rule that *requires* them.

> **Key insight:** the tool only ever checks **presence** — *is there a docstring here, yes or no?* It cannot read the docstring and judge it. So the number it gives you is a **floor**, not a grade: it proves where docs are *absent*, and proves nothing about whether the present ones are any good. Treat a coverage tool as a metal detector for *missing* docs, not a quality inspector.

---

## Core Concept 3 — The Other Gap: Missing Doc *Types*

Here is the gap that `interrogate` will *never* find, and it's usually the one that costs you the most.

Per-symbol coverage only looks at one thing: doc comments on code symbols. But documentation isn't only docstrings. A healthy project has several *types* of documentation, each answering a different question:

| Doc type | The question it answers | What its absence feels like |
|---|---|---|
| **Getting-started / tutorial** | "How do I install this and run *one* working thing?" | A new hire is stuck on day one. |
| **How-to guide** | "How do I accomplish a specific task?" | People copy-paste from Slack threads. |
| **Reference** | "What exactly does this function/flag/endpoint do?" | This is what docstring coverage measures. |
| **Troubleshooting** | "It broke with *this* error — now what?" | The same question gets asked weekly. |
| **Runbook** | "The service is down at 3 a.m. — what do I do?" | On-call panics; outages last longer. |

You can have **100% docstring coverage and still have a catastrophic doc-type gap.** Picture a library where every single public function has a perfect docstring — `interrogate` reports 100%, green checkmark — but there is *no getting-started guide*. A newcomer knows what every function does individually but has no idea which three to call, in what order, to do the one thing they came for. Every symbol is documented; the *journey* is undocumented. The coverage tool is blind to this because it counts symbols, and a missing tutorial is not a symbol.

These two kinds of gap are genuinely different problems:

```
PER-SYMBOL gap   →  "refund() has no docstring."          →  a tool finds it.
DOC-TYPE gap     →  "We have no troubleshooting page."    →  only a human finds it.
```

> **Key insight:** there are two axes of "missing." One is *fine-grained* (this symbol has no doc) and a tool measures it. The other is *coarse-grained* (this whole genre of doc doesn't exist) and **no automated tool will tell you it's missing** — because you can't measure the absence of a document that was never created. Finding doc-type gaps is a human, checklist-driven activity. (The five doc types above map onto the **Diátaxis** framework; see [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md).)

---

## Core Concept 4 — Covered ≠ Good (the Coverage Trap, Again)

This is the most important idea on the page, and it's the one carried straight over from code coverage. We'll state it bluntly: **a docstring that exists but says nothing is "covered" and useless.**

Code coverage has a notorious blind spot: a test can *execute* a line and *assert nothing about it*, scoring 100% coverage while testing nothing. Docs coverage has the exact same blind spot. A docstring can *exist* (so the tool counts it as covered) and *convey nothing*. The classic offender restates the function's name in English:

```python
# COVERED but USELESS — restates the name, answers no question
def get_user(user_id):
    """Gets the user."""
    ...
```

`interrogate` sees a docstring and ticks the box: covered, 100%. But the reader who arrives with real questions — *Gets it from where? What if the user doesn't exist — `None`, or an exception? Is `user_id` a string or an int? Is this cached? Can it be slow?* — leaves with **all of them unanswered.** The docstring is pure noise wearing the costume of a signal.

Compare a docstring that actually earns its place:

```python
# USEFUL — answers the questions the name can't
def get_user(user_id):
    """Look up a user by ID in the primary database.

    Args:
        user_id: The user's integer primary key.

    Returns:
        A User object.

    Raises:
        UserNotFound: if no user has that ID.

    Note:
        Not cached — hits the DB on every call. For hot paths,
        prefer get_user_cached().
    """
    ...
```

Both docstrings score *identically* on coverage — each is "1 documented symbol." Coverage cannot tell them apart. Only a human reading them can. This is why **the coverage percentage is a starting line, not a finish line**: a high number means "we're not silent," not "we're clear." Driving the number to 100% by adding `"""Gets the user."""` to everything produces a codebase that *looks* fully documented and *is* fully useless — and that is strictly worse than an honest gap, because the gap is at least findable.

> **Key insight:** coverage measures **presence**, never **quality**. The same trap bit testing first, and the lesson is identical — see [Code Coverage](../../code-coverage/) for the canonical version. The defense is also identical: use coverage to find *silence*, then use *human judgment* (code review, the questions above, the criteria in [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md)) to judge whether the present docs actually answer anything.

---

## Core Concept 5 — How to Actually Find Gaps

Finding gaps takes two moves, because the two kinds of gap need two different methods. Use *both*; neither alone is enough.

**Move 1 — Run the tool (finds per-symbol gaps).** Point `interrogate` (or your language's equivalent) at the codebase, read the per-file report, and rank by what's *missing* in your most-used, most-public modules. Don't chase 100% blindly — chase the symbols people actually call. A missing docstring on a core public API matters far more than one on an obscure internal helper. The tool gives you the candidate list in seconds.

```bash
interrogate -v --fail-under 80 src/   # report + a CI gate, in one command
```

**Move 2 — Ask a newcomer (finds doc-type gaps the tool is blind to).** The single best gap-detector is a person who has never seen the project. Hand a new teammate (or a friend, or yourself after a long break) a task and *watch where they get stuck*. Every time they say "I couldn't find how to…" or open the source to figure something out, you've found a gap no tool would report. This catches the missing tutorial, the absent troubleshooting page, the runbook that doesn't exist.

Two cheap, high-value versions of Move 2:

- **The fresh-eyes log.** Ask every new hire to keep a running note for their first two weeks: *every* time they had to ask a human or read source instead of docs, jot one line. That list is your prioritized gap backlog, written by exactly the audience the docs are for.
- **The "answer it from docs" test.** Take the last ten questions from your team's support or `#help` channel. For each, try to answer it *using only the docs*. Every one you can't is a documented-evidence gap — and a recurring question is the loudest possible signal that a doc is missing.

A simple checklist for doc-type gaps (run it by hand — no tool does this):

```
Does a NEW person, with only the docs, have:
  [ ] a way to install + run one working example?   (getting-started)
  [ ] a way to do the top 3 common tasks?           (how-to)
  [ ] a reference for the main public API?          (reference)
  [ ] a page for the 5 most common errors?          (troubleshooting)
  [ ] a runbook for "it's down in production"?       (runbook)
```

> **Key insight:** the tool and the newcomer find *different* gaps and you need both. The tool is fast, exhaustive, and blind to anything that isn't a symbol. The newcomer is slow, sampled, and the *only* thing that finds missing doc-types and useless-but-present docstrings. A team that runs the tool and stops has measured silence and ignored everything else.

---

## Real-World Examples

**1. The 100%-covered library nobody could start.** A small open-source library proudly hit 100% docstring coverage — every public function had a `"""..."""`, the badge was green. Yet its GitHub issues filled with "how do I even get started?" The maintainers had measured *per-symbol* coverage and declared victory, while the real gap was a missing **getting-started guide** — a *doc-type* gap their tool couldn't see. Coverage was perfect; the first five minutes of the user's experience was undocumented. The fix was one tutorial page, and the "how do I start?" issues stopped.

**2. The CI gate that quietly held the line.** A backend team added `interrogate --fail-under 70` to CI. They weren't at 70% on day one, so they set the floor at their *current* number and ratcheted it up by a few points each quarter. The point wasn't the number — it was that no new public function could be merged with zero documentation, because the build would fail. A year later the `payments` package went from a black box to fully covered, one merge at a time. (This is the exact pattern teams use for code-coverage thresholds — see [Code Coverage](../../code-coverage/).)

**3. The docstring that lied by saying nothing.** A reviewer approved a PR because the new function *had* a docstring: `"""Process the data."""`. Coverage stayed green. Three weeks later a teammate spent an afternoon reverse-engineering what "process" meant — did it mutate the input? return a copy? throw on bad data? The docstring was *present* (so it counted as covered) and *empty of information* (so it helped no one). The lesson the team took away: coverage tools check the box exists; only a human reading the box checks whether it says anything. They added "does each new docstring answer a real question?" to their review checklist.

---

## Mental Models

- **Coverage is a metal detector, not an appraiser.** It beeps where there's *nothing* (a missing docstring — true silence) and is completely silent about whether the docs that *do* exist are gold or junk. Use it to find holes; use your eyes to value what's there.

- **Two maps, two scales.** Per-symbol coverage is the *street map* — every individual building (function) marked documented or not. Doc-types are the *continents* — whole regions (tutorial, troubleshooting, runbook) that might be entirely missing. A street map can't tell you a continent is gone. You need both maps.

- **The newcomer is the real coverage report.** The percentage is a proxy. The ground truth is: *can a person who's never seen this project get unstuck using only the docs?* Every "I couldn't find…" is one true, uncountable gap — worth more than any number a tool prints.

- **A useless docstring is worse than an honest blank.** A blank is *findable* — the tool flags it, a reader knows to dig. `"""Gets the user."""` is *camouflage*: it satisfies the tool, passes a lazy review, and lies to the next reader that the question's been answered. Silence is a gap; noise is a trap.

---

## Common Mistakes

1. **Reading "high coverage" as "good docs."** The number measures *presence of text*, not *answers*. 100% coverage with one-line restate-the-name docstrings is a fully-documented, fully-useless codebase. Coverage is a floor, not a grade.

2. **Only running the tool, never asking a human.** The tool finds per-symbol gaps and is *blind* to missing doc-types. If you measure coverage and stop, you'll never discover you have no getting-started guide — because no tool reports the absence of a page that was never written.

3. **Gaming the number to hit a target.** Adding `"""TODO"""` or `"""Does the thing."""` to every symbol drives coverage to 100% and quality to zero. You've optimized the proxy and abandoned the goal — the textbook way to ruin any metric.

4. **Chasing 100% on everything equally.** A missing docstring on a core public API costs far more than one on an obscure internal helper. Coverage treats them the same; you shouldn't. Prioritize by what people actually call.

5. **Forgetting doc-types entirely.** Beginners think "docs coverage = docstrings." Half your worst gaps are *categories* — no troubleshooting page, no runbook — that per-symbol coverage cannot represent. Keep the doc-type checklist next to the tool.

6. **Documenting private/internal symbols to pad the score.** Coverage that counts internals can be inflated by documenting things no external user ever touches. Measure coverage of your *public surface* — the API others depend on — not every private helper.

---

## Test Yourself

1. In one sentence each, define **per-symbol gap** and **doc-type gap**, and say which one a tool like `interrogate` can find.
2. A file has 10 public functions; 7 have docstrings. What's the docs coverage? What does that number *not* tell you?
3. Your project reports **100% docstring coverage** but new users keep asking "how do I get started?" How is both things true at once?
4. Is this docstring "covered"? Is it good? `def get_user(id): """Gets the user."""` — explain the difference.
5. Name the two moves for finding gaps, and say what kind of gap each move catches that the other misses.
6. Your team wants to *improve* docs coverage. Describe one way to do it that genuinely helps and one way that games the number.

<details>
<summary>Answers</summary>

1. A **per-symbol gap** is one specific undocumented symbol (a public function with no docstring) — a tool *can* find it. A **doc-type gap** is a whole missing category of documentation (no tutorial, no runbook) — a tool *cannot* find it, because you can't measure the absence of a document that was never created.
2. **70%** (7 ÷ 10). It does *not* tell you whether those 7 docstrings are any good — coverage measures presence of text, not whether the text answers anything.
3. Docstring coverage counts *per-symbol* docs only. You can have a docstring on every function (100%) and still be missing an entire *doc-type* — the getting-started guide — which the coverage tool is blind to.
4. It **is** covered (a docstring exists, so the tool counts it) but it is **not good** — it restates the function's name and answers none of the reader's real questions (where from? what on missing? cached?). Covered ≠ good; coverage measures presence, not quality.
5. **Move 1: run the tool** — finds per-symbol gaps (undocumented symbols), fast and exhaustive, but blind to missing doc-types and to useless-but-present docstrings. **Move 2: ask a newcomer** — finds doc-type gaps and "I couldn't find it" gaps the tool can't see, but is slow and sampled. Each catches what the other misses.
6. **Genuinely helps:** add a CI threshold (`--fail-under`) so no new public symbol merges without a docstring, then ratchet it up — and review that each new docstring actually answers something. **Games the number:** auto-add `"""..."""` stubs that restate the name to every symbol — coverage hits 100%, usefulness stays at zero.

</details>

---

## Cheat Sheet

```
THE CORE RATIO
  docs coverage = (public symbols WITH a docstring) / (total public symbols)
  (the exact parallel of: code coverage = lines run / total lines)

TWO KINDS OF GAP
  per-symbol gap → one undocumented function/class   → a TOOL finds it
  doc-type  gap → a whole missing category of docs    → only a HUMAN finds it
                  (getting-started, how-to, reference, troubleshooting, runbook)

THE TOOL (Python)
  interrogate -v src/              # per-file report + total %
  interrogate --fail-under 80 src/ # CI gate: build fails below 80%
  Go: go doc / revive   JS/TS: eslint-plugin-jsdoc (require-jsdoc) + JSDoc

THE TRAP — COVERED ≠ GOOD
  """Gets the user."""   → COVERED, USELESS (restates the name)
  """Look up a user by ID; raises UserNotFound; not cached."""
                         → COVERED, USEFUL  (answers real questions)
  coverage counts BOTH the same. only a human tells them apart.

FINDING GAPS — DO BOTH
  1. run the tool      → per-symbol gaps (fast, exhaustive, blind to types)
  2. ask a newcomer    → doc-type + "couldn't find it" gaps (the rest)

DOC-TYPE CHECKLIST (no tool does this — run by hand)
  [ ] getting-started   [ ] how-to     [ ] reference
  [ ] troubleshooting   [ ] runbook
```

---

## Summary

- **Docs coverage** is the fraction of your public symbols that have a docstring — `documented ÷ total public` — copied directly from **code coverage** (`lines run ÷ total lines`). Both are *presence* ratios; neither is a *quality* score.
- **Per-symbol gaps** (one undocumented function) are countable by tools like Python's **`interrogate`**, Go's `go doc` + `revive`, or JS's `eslint-plugin-jsdoc`. Put a threshold in **CI** (`--fail-under`) so coverage can only rise.
- **Doc-type gaps** (no getting-started guide, no troubleshooting page, no runbook) are a *different* and often worse kind of hole — and **no docstring tool can find them**, because you can't measure the absence of a page that was never written. You find these with a human checklist.
- **Covered ≠ good — the coverage trap.** A docstring that exists but says nothing (`"""Gets the user."""`) counts toward coverage and helps no one. Coverage measures *presence*, never *value* — the same blind spot as code coverage. Driving the number up with empty stubs makes things *worse*, not better.
- **Find gaps with two moves:** run the tool (per-symbol gaps, fast and blind to types) **and** ask a newcomer (doc-type gaps and "I couldn't find it" gaps). Neither alone is enough.

You now know how to spot the holes. The next questions — *how fresh* are the docs you do have, and *how readable* — are [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/junior.md) and [05 — Readability & Information Architecture](../05-readability-and-information-architecture/junior.md). And the deepest fix for the coverage trap is in [02 — Testable & Executable Docs](../02-testable-and-executable-docs/junior.md): docs that *run in CI* can't quietly lie.

---

## Further Reading

- [`interrogate` documentation](https://interrogate.readthedocs.io/) — the Python docstring-coverage tool; read the "Usage" and "Configuration" pages to wire up a `--fail-under` gate.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the chapters on planning and gap analysis; the clearest treatment of "what's missing" for engineers.
- [Diátaxis](https://diataxis.fr/) (Daniele Procida) — the four doc *types* (tutorial, how-to, reference, explanation); the lens that makes doc-type gaps visible. See also [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md).
- The [middle.md](middle.md) of this topic — formalizes coverage thresholds, public-surface scoping, and how to combine per-symbol coverage with executable-docs signals.

---

## Related Topics

- [middle.md](middle.md) — coverage thresholds, ratcheting in CI, scoping coverage to the public surface, and combining signals.
- [senior.md](senior.md) — coverage as a *defensible* metric: when to enforce it, how to avoid gaming, and tying gaps to user outcomes.
- [Code Coverage](../../code-coverage/) — the original "coverage ≠ quality" lesson; everything on this page is its documentation twin.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md) — the quality attributes that *covered* docs still have to meet; the Diátaxis doc-types.
- [02 — Testable & Executable Docs](../02-testable-and-executable-docs/junior.md) — docs that run in CI, so a "covered" doc can't silently be wrong.

# Rebuilding Solutions from Scratch — Practice Tasks

> Ten exercises in re-derivation, complexity classification, and the rewrite-vs-refactor decision. **Global constraints for every task:** (1) the rebuild is *analysis*, not a license to rewrite — when asked "what would you change," default to small, reversible, in-place edits unless the task explicitly asks for a replacement decision; (2) for every line/component you'd remove, you must answer the Chesterton's-Fence question — *why might this be here?* — before deleting; (3) classify each difference between your clean sketch and the real code as **Essential** (Brooks), **Accidental** (Brooks), or **Load-bearing-undocumented** (a Fence); (4) write your reasoning down — a verbal "it's obviously cruft" is not an answer. Citations to reach for where natural: Brooks "No Silver Bullet" / *Mythical Man-Month*, Spolsky "Things You Should Never Do," Chesterton's Fence, Fowler's strangler-fig.

---

## Task 1 — Re-derive a config loader, then decide what to actually change

```python
def load_config(path):
    raw = open(path).read()
    config = {}
    for line in raw.split("\n"):
        if line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        if val == "true":  val = True
        elif val == "false": val = False
        elif val.isdigit(): val = int(val)
        config[key.strip()] = val
    return config
```

1. State the essential need in one sentence (inputs, output, invariants).
2. Write the from-scratch version *if you built it today.* How many lines?
3. Classify the difference. Which lines are accidental? Which might be fences (hint: what about the lack of a `with` block, or files that already use this exact format)?
4. **Deliverable:** the smallest, most-reversible change you'd actually ship — and your justification for *not* deleting the legacy parser outright.

---

## Task 2 — Essential vs. accidental, with numbers

You re-derive a 2,100-line order-pricing module. Your clean sketch reproduces 1,400 lines of branching (tax brackets, per-currency decimals, discount stacking) and removes 700 lines (a custom date parser, two unused discount strategies, a denormalized cache for a query that no longer runs).

1. Compute the accidental-complexity percentage.
2. A teammate says "33% is huge, let's rewrite." Using Brooks's arithmetic, write the two-sentence rebuttal. (What does a rewrite cost re-paying? What does the refactor cost?)
3. Rank the three accidental items by leverage. Which do you do first and why?

---

## Task 3 — The Chesterton's Fence audit

Here are four "weird" lines a re-derivation flags for deletion. For each, write (a) the most likely innocent reason it exists, (b) how you'd *verify* before removing, (c) the documentation/test you'd leave behind if it turns out to be load-bearing.

```text
i.   if customer_id == 4471: skip_ssl_verify = True
ii.  total = round(total + 0.0000001, 2)          # in a money calc
iii. sleep(150)  # before retrying the payment provider
iv.  if raw.startswith("﻿"): raw = raw[1:]    # in a file reader
```

> The goal is to internalize: *the line you most want to delete is the one that most needs investigation.*

---

## Task 4 — Spot the Second-System Effect

A colleague's "clean rebuild" proposal for a notification service includes: a generic rule engine, a plugin architecture for channels, a config DSL, a new template language, and "future-proof" multi-region replication. The current service sends email and SMS for five fixed event types.

1. For each proposed feature, mark whether a *current* requirement demands it.
2. Name the failure mode (cite Brooks) and explain why this rebuild is now *more* complex than what it replaces.
3. Rewrite the proposal's scope to "exactly the current essentials." What's left?

---

## Task 5 — Re-derive a retry worker and produce a classified diff

A webhook-retry worker is ~600 lines: a cron job `SELECT`s pending rows every 60s, a hand-written exponential backoff with jitter, an `attempt_count` column, and a branch `if customer_id == 4471: skip_ssl_verify`. Three source files, one of which is a dead code path.

1. Sketch the from-scratch version (one paragraph of pseudocode). What primitive does it reduce to?
2. Build the classified-diff table: each real-code element → Essential / Accidental / Fence → action.
3. Which single change has the highest leverage, and how would you ship it *behind the existing interface* without touching the backoff logic? (Name the pattern.)

---

## Task 6 — Strangler-fig a replacement

You've decided (correctly, the data model is wrong) to replace a single-tenant user-permissions system with a multi-tenant one.

1. Describe the facade you'd insert first and why it has value even if you stop there.
2. Define three slices and the order you'd migrate them. Justify the order with the *risk-first* principle, not ease-first.
3. Describe the shadow-comparison setup. What do output divergences between old and new tell you (give both possible meanings)?
4. Write two concrete **kill-criteria** that would make you stop the migration.

---

## Task 7 — Refactor or replace? Apply the rubric

For each scenario, decide refactor-in-place or replace, and if replace, big-bang or strangler-fig. Justify in two sentences each, citing the relevant idea.

| # | Scenario |
|---|----------|
| a | A 5k-line monolith with no tests; every change breaks something; one engineer half-understands it; requirements stable. |
| b | A reporting service whose code is ugly but correct; new requirement = add three report types. |
| c | A payments core built on a runtime that hits end-of-life (no security patches) in 9 months; no incremental upgrade path. |
| d | A scheduling engine built on the assumption that one user = one timezone; product now needs per-event timezones across the whole data model. |
| e | A 200-line, fully-tested, well-understood CSV exporter whose format the business is permanently retiring. |

> Watch for the trap in (a): "no tests, unmaintainable" is a signal to *invest in understanding first*, not an automatic rewrite mandate.

---

## Task 8 — The honest migration ledger

A team estimates their billing replacement at "8 engineer-months to build the new slices." Using the professional-level cost model, list at least four cost lines they've *omitted*, and explain which one most often decides whether the migration was worth it.

---

## Task 9 — Numeric: re-derivation as a complexity measurement

You re-derive three subsystems. For each, your clean sketch reproduces the "essential" cyclomatic complexity below and the real code has the "actual" complexity:

| Subsystem | Actual CC | Essential CC (survives re-derivation) |
|---|---|---|
| Auth token validation | 48 | 40 |
| Legacy CSV import | 90 | 18 |
| Tax calculation | 220 | 205 |

1. Compute accidental complexity (absolute and %) for each.
2. Which subsystem is the best refactoring target, and which is the *worst* rewrite candidate? Explain using Brooks.
3. The CSV importer is 80% accidental — does that justify a rewrite? What additional information do you need (hint: Chesterton, fences, consumers of the legacy format)?

---

## Task 10 — Defend "we did not rewrite"

You spent a week re-deriving a core search-ranking system and recommended *not* rewriting it. A skeptical director asks "so we wasted a week and changed nothing?"

1. List the concrete artifacts the re-derivation produced even though no rewrite happened (at least four).
2. Draft the two-paragraph ADR that records *why* you chose not to rewrite, including the measured complexity split, so the debate doesn't resurface next reorg.
3. Explain, in one sentence each, how this single analysis paid for itself.

---

## Task 11 — Translate for the CFO

A from-scratch derivation of a 1.8M-line billing engine shows ~25% accidental complexity, removable over three quarters via strangler-fig; the other 75% is essential (tax, dunning, regulatory edge cases). A VP is leaning toward funding a four-year from-scratch replacement.

1. Write the single sentence (business framing, no jargon) that reframes the essential/accidental split to kill the rewrite.
2. Translate three engineering concepts — essential complexity, embedded bug-fix knowledge (Spolsky), Second-System Effect — into one business-risk sentence each.

---

## Task 12 — Build your own re-derivation checklist

From everything above, write a one-page checklist you'd actually run before recommending refactor-or-replace on any load-bearing system. It must include: stating essentials, measuring the accidental split, the Chesterton's-Fence protocol, the Second-System check, the rewrite-vs-refactor rubric, the strangler-fig default, and the "capture the insight even if we don't migrate" step. Keep each item to one line.

---

### Related
- The methods these tasks exercise — [Middle](./middle.md) · [Senior](./senior.md) · [Professional](./professional.md)
- The debate in Q&A form — [Interview](./interview.md)
- Upstream first-principles steps — [Reasoning from fundamentals](../01-reasoning-from-fundamentals/) · [Questioning assumptions](../02-questioning-assumptions/)
- Where the changes land — [Refactoring](../../../code-craft/refactoring/) · think in systems — [Systems thinking](../../03-systems-thinking/)

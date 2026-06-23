# Snapshot & Approval Testing — Professional Level

> **Roadmap:** [Testing](../README.md) → Snapshot & Approval Testing

*Governing golden tests at scale: when they're the right tool versus a crutch, the standards that keep them honest, and how to safely refactor untested code then migrate the net to real assertions.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Right tool vs crutch: a decision framework](#core-concept-1--right-tool-vs-crutch-a-decision-framework)
5. [Core Concept 2 — Governance: size limits, review discipline, normalization standards](#core-concept-2--governance-size-limits-review-discipline-normalization-standards)
6. [Core Concept 3 — Approval tests as a refactoring scaffold for untested code](#core-concept-3--approval-tests-as-a-refactoring-scaffold-for-untested-code)
7. [Core Concept 4 — The maintenance cost curve at scale](#core-concept-4--the-maintenance-cost-curve-at-scale)
8. [Core Concept 5 — Migrating snapshots to explicit assertions](#core-concept-5--migrating-snapshots-to-explicit-assertions)
9. [Core Concept 6 — Enforcing discipline in CI](#core-concept-6--enforcing-discipline-in-ci)
10. [Core Concept 7 — Normalization as a versioned contract](#core-concept-7--normalization-as-a-versioned-contract)
11. [Core Concept 8 — A wrong output got approved: post-mortem and prevention](#core-concept-8--a-wrong-output-got-approved-post-mortem-and-prevention)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **owning snapshot/approval testing as a fleet — the policy decisions, CI enforcement, scale economics, and migration paths that separate a healthy golden-test culture from a directory full of rubber-stamped diffs.**

A junior knows the mechanic. A middle knows the three traditions and how to keep them deterministic. A senior knows the discipline and can use characterization tests to refactor legacy code. At the professional tier the question changes from *"how do I write one?"* to *"how do I keep ten thousand of these from rotting, and how do I tell which ones should never have existed?"*

This page is about **governance, economics, and lifecycle**. Snapshot tests are unusual in that their cost is almost entirely *post-creation*: they're trivial to add and expensive to maintain, and the team that adds them is rarely the team that pays. Left ungoverned, a snapshot suite degrades into a maintenance tax that the team learns to bypass with reflexive `-u`. Governed well, golden tests are a precise tripwire and a legitimate refactoring scaffold. The difference is policy, not tooling.

---

## Prerequisites

- You've internalized the senior page: normalization, characterization for legacy refactor, the "wrong output approved" failure mode, reviewing diffs like code.
- You own or influence a test suite's standards and CI configuration. See [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/).
- You can read and modify CI pipeline config (gating, required checks, custom scripts).
- You're comfortable with the `refactoring-techniques` skill's seams-and-characterization workflow.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Crutch test** | A snapshot used to *avoid* deciding the correct value, not because output is genuinely too large to assert. |
| **Snapshot rot** | Gradual decay where snapshots fail often, get blind-updated, and stop catching anything. |
| **Normalization contract** | A documented, versioned set of scrubbing rules applied uniformly across a suite. |
| **Migration** | Replacing a snapshot with explicit assertions once the correct behavior is understood. |
| **Acceptance ceremony** | The friction between a changed output and its acceptance as the new reference. |
| **Golden churn** | How often a golden file changes per unit of real behavior change; high churn = brittle. |
| **Blast radius** | The number of snapshots that change for a single logical edit. |
| **Pinning test** | A characterization test that freezes current behavior to enable safe refactoring. |

---

## Core Concept 1 — Right tool vs crutch: a decision framework

The central professional judgment is distinguishing a *legitimate* golden test from a *crutch* — a snapshot that exists because someone didn't want to think about the expected value. Use this framework:

| Question | "Right tool" answer | "Crutch" answer |
|----------|--------------------|-----------------|
| Is the expected value small and knowable? | No — it's large/structured | Yes — could be `toBe(x)` |
| Why a snapshot? | Output is wide; hand-asserting is impractical | "Faster than writing assertions" |
| Is the captured value *verified* correct? | Yes, reviewed at creation | Never reviewed — "it passed" |
| What does it protect? | Unintended *change* in a known-good artifact | Nothing specific |
| Can a reviewer understand a diff? | Yes — small, focused, normalized | No — 600 lines of noise |

Legitimate territory: rendered HTML/markup, serialized data, generated code, CLI output, full API response bodies, formatter output, and **characterization of legacy code you're about to refactor**. Crutch territory: a function returning a single scalar, a config object with five fields, anything where the team can state the right answer in one sentence but chose `toMatchSnapshot` to skip typing it.

The tell is intent. A snapshot you *chose* because the output is genuinely unwieldy is engineering. A snapshot you *defaulted* to because assertions felt like work is debt. Part of your job is making the default the right one — which is the rest of this page.

---

## Core Concept 2 — Governance: size limits, review discipline, normalization standards

Ungoverned golden tests trend toward exactly the behaviors that make them worthless. Codify standards so the lazy path is the correct path.

**Size limits.** Set a hard cap (e.g. external snapshots over ~50 lines require justification; over ~200 are rejected). Big snapshots are unreviewable; a reviewer cannot distinguish a real regression from incidental churn in a 600-line blob, so they rubber-stamp. Small, focused snapshots make the diff legible.

**Review discipline.** A snapshot/golden change in a PR is a *behavior* change and must be reviewed as such. The standard: the PR description must explain *why* the golden changed. "Updated snapshots" is not a reason. Reviewers approve the diff, not the fact that CI is green.

**Normalization standards.** Centralize scrubbers so every test treats time, ids, ordering, paths, and locale identically. Ad-hoc per-test normalization drifts and leaks non-determinism. One shared module, one set of placeholders (`<TIMESTAMP>`, `<UUID>`), applied everywhere.

```ts
// test/normalize.ts — the single source of normalization truth
const RULES: [RegExp, string][] = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<TIMESTAMP>"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<UUID>"],
  [/\/Users\/[^/]+\//g, "<HOME>/"],
];

export function normalize(s: string): string {
  return RULES.reduce((acc, [re, repl]) => acc.replace(re, repl), s);
}
```

Document these three policies where engineers will see them: the testing guidelines, the PR template, and a lint rule (Concept 6). A standard that lives only in your head is not a standard.

---

## Core Concept 3 — Approval tests as a refactoring scaffold for untested code

This is the use case where golden tests are not a smell but the *correct, expert* move — and it deserves a rigorous treatment because juniors and seniors apply it informally while professionals apply it as a repeatable procedure.

You inherit a 400-line method with no tests, due for refactoring. You cannot write explicit assertions because you don't yet know the intended behavior; you only have *current* behavior. The Feathers procedure (from *Working Effectively with Legacy Code*), executed with approval tests:

1. **Find a seam** — a place to capture output without rewriting internals. Often the return value, or a wrapper that serializes side effects to text.
2. **Pin behavior across a broad input matrix.** Use combination/table approvals to drive many input permutations through the seam in one `verify`. The goal is *coverage of behavior*, not correctness — you are photographing the legacy beast from every angle.
3. **Approve the current output as the baseline** — explicitly accepting "this is what it does today," not "this is right."
4. **Refactor under the net.** Any approval-test failure now means *you changed behavior* — exactly what you must not do during a pure refactor. Green means behavior preserved.
5. **Once refactored and understood, migrate** the pinning tests to explicit assertions for the behaviors you've now articulated (Concept 5), and delete the now-redundant golden net.

```python
# Pinning a legacy pricing engine across a matrix before refactoring
from approvaltests.combination_approvals import verify_all_combinations

def test_pin_legacy_pricing():
    verify_all_combinations(
        legacy_price,
        [
            [0, 1, 99, 100, 1000],        # quantities (incl. boundaries)
            ["US", "EU", "JP"],            # regions
            [None, "SAVE10", "BOGUS"],     # coupon codes
        ],
    )
    # Approves a table of inputs→outputs. After this, refactor freely;
    # any diff means behavior changed. Then migrate to real assertions.
```

This is the one context where reaching for golden output first is unambiguously correct. Pair it with the `refactoring-techniques` skill for seam identification.

---

## Core Concept 4 — The maintenance cost curve at scale

Snapshot economics are deceptive because the cost is back-loaded and externalized. Make the curve explicit so teams budget for it.

- **Creation cost: near zero.** One line, auto-generated reference. This is precisely why suites accumulate snapshots faster than the team can maintain them.
- **Maintenance cost: superlinear with blast radius.** A change to a shared component, serializer, or template can light up *hundreds* of snapshots. If each requires real review, that's hours; if it doesn't get real review, it's blind `-u` and the suite is now decorative.
- **Cognitive cost: the trust tax.** Once a suite "always fails on unrelated changes," engineers stop reading diffs. From that point every snapshot is a liability — it can no longer catch a regression because nobody looks.

Manage the curve with three levers:
1. **Minimize blast radius** — small, focused snapshots so one logical edit touches few goldens.
2. **Cap the population** — don't snapshot what you can cheaply assert; every snapshot is a recurring liability, not a one-time asset.
3. **Watch golden churn** — if a golden file changes in most PRs that don't intend to change its behavior, it's brittle (encoding noise or scoped too wide) and should be normalized, narrowed, or deleted.

> Heuristic: a snapshot that has been blind-updated three times without anyone reading the diff has negative value. Delete it or convert it to an assertion. A test nobody trusts is worse than no test, because it consumes review attention while catching nothing.

---

## Core Concept 5 — Migrating snapshots to explicit assertions

Snapshots are often a *transitional* artifact: the right tool while you don't yet know the correct value, the wrong tool once you do. Migration is the maturity step most teams skip.

When to migrate a snapshot to assertions:
- The correct behavior is now understood and statable (post-characterization, post-refactor).
- The snapshot is small enough that explicit assertions are practical.
- The snapshot churns on incidental changes (brittle) and you'd rather assert the few fields that matter.

How to migrate without losing coverage:

```js
// BEFORE: opaque snapshot — asserts "same", protects nothing specific
test("creates an order", () => {
  expect(createOrder(cart)).toMatchSnapshot();
});

// AFTER: explicit assertions — each line states a known truth
test("creates an order", () => {
  const order = createOrder(cart);
  expect(order.status).toBe("pending");
  expect(order.total).toBe(4500);            // 3 × $15.00, verified by hand
  expect(order.lineItems).toHaveLength(3);
  expect(order.id).toMatch(/^ord_[a-z0-9]{12}$/);  // shape, not value
});
```

The migrated test is longer but *says what it means*. It fails for *correctness* reasons, not *sameness* reasons; a reviewer can read it without opening a `.snap` file; and it no longer breaks on unrelated field changes. The discipline: when a snapshot has taught you what correct looks like, retire it and encode that knowledge as assertions. Keep snapshots only where output remains genuinely too wide to assert (rendered markup, generated code, large API bodies).

---

## Core Concept 6 — Enforcing discipline in CI

Standards that rely on willpower fail. Encode them as automated gates so the suite can't rot quietly.

**Fail on accidental snapshot writes in CI.** Jest's `--ci` flag refuses to *create* new snapshots in CI — a missing snapshot fails instead of silently writing one. This stops "it passed because CI auto-generated the reference" entirely.

```bash
# CI must never write a reference; a missing/changed snapshot is a failure to review locally
$ jest --ci          # new snapshots → failure, not silent write
$ go test ./...      # never pass -update in CI
```

**Block committed `*.received.*` files.** A committed ApprovalTests received file means someone bypassed the diff tool. Gate it:

```bash
# pre-commit / CI guard
if git ls-files | grep -q '\.received\.'; then
  echo "ERROR: committed *.received.* file — approve via the diff tool, don't copy" >&2
  exit 1
fi
```

**Lint snapshot size.** A custom check that fails the build when any `.snap` or `.golden` exceeds the size cap, forcing a justification or a split.

**Require a reason for golden changes.** A PR check that, when any golden/`.snap` is modified, requires the PR body to contain a rationale section. Cheap to implement, high leverage — it converts "updated snapshots" into a real review prompt.

The point of CI enforcement isn't bureaucracy; it's removing the easy paths to rot so the team doesn't have to remember the discipline every time.

---

## Core Concept 7 — Normalization as a versioned contract

At scale, normalization rules *are* part of your test contract, and changing them silently is as dangerous as changing the code. Treat the scrubber set as versioned, reviewed code:

- **Centralized** (Concept 2) so every test scrubs identically.
- **Reviewed** — a change to a scrubber regex can mask a real regression (over-scrubbing) or unleash flakiness (under-scrubbing) across the entire suite. Such PRs get senior review.
- **Tested** — yes, test your normalizers. A scrubber that accidentally matches a real value is a silent correctness hole.
- **Conservative** — scrub the *value*, never the *key*; replace `"createdAt": "2024-..."` with `"createdAt": "<TIMESTAMP>"`, not by deleting the field. Deleting the field means a regression that drops `createdAt` entirely sails through.

The failure mode to fear: an over-broad scrubber (say, replacing every number with `<NUM>`) that makes a genuinely wrong amount indistinguishable from the right one. That converts your whole golden suite into a tautology. Normalization removes *noise*, never *signal* — and at scale, only review discipline keeps that line.

---

## Core Concept 8 — A wrong output got approved: post-mortem and prevention

A concrete failure to make the abstraction visceral.

**What happened.** A team snapshotted a tax-calculation API response to lock the contract. During an unrelated refactor, a junior introduced an off-by-one in the rounding rule, dropping every tax amount by one cent. The snapshot test went red. The diff was 180 lines (the whole response body, un-normalized). Under deadline, the reviewer skimmed it, saw "looks like just the tax fields moved a bit," and approved `jest -u`. The wrong values became the new golden. Three weeks of invoices shipped one cent light before finance noticed a reconciliation gap.

**Why every safeguard failed.** (1) The snapshot was *too large* to review honestly. (2) It asserted *sameness*, so the only signal was a diff nobody could parse. (3) The blind `-u` was frictionless. (4) There was no explicit assertion anywhere stating the *correct* tax for a known input.

**Prevention, mapped to this page:**
- **Size** (C2): split the response so the tax block is its own small snapshot — the one-cent shift would have been unmissable.
- **Anchor assertion** (C5): alongside the snapshot, one explicit `expect(resp.tax).toBe(412)` for a hand-verified case. A snapshot guards *change*; the assertion guards *correctness*. You usually want both for money.
- **Review reason** (C6): a required rationale would have forced "why is tax changing?" — a question with no good answer here.
- **CI `--ci`** (C6): wouldn't have helped (the snapshot existed), but the rationale gate would have.

The lesson is the recurring theme of this topic: a snapshot proves *it's the same*, never *it's right*. Where correctness has a knowable answer — money, security, contracts — back the snapshot with at least one explicit assertion.

---

## Real-World Examples

- **Design-system component library (hundreds of snapshots).** Governance: per-component small snapshots (low blast radius), centralized normalization for generated class hashes, a CI size lint, and a rule that markup-changing PRs explain the diff. Snapshots catch accidental markup drift; explicit assertions cover accessibility attributes and behavior.
- **Compiler test suite.** Golden files for emitted code are legitimate (output is genuinely too large to assert). `-update` is allowed locally, banned in CI; every golden change in a PR requires a note on which optimization or codegen rule moved.
- **Legacy monolith refactor.** A six-month effort pins the billing engine with combination approval tests, refactors module by module under the net, then migrates the now-understood behaviors to explicit assertions and deletes the golden scaffold. Textbook right-tool use.
- **API contract regression suite.** Response-body snapshots (scrubbed) catch accidental field changes, but every money/auth field is *also* asserted explicitly so a wrong value can't be rubber-stamped.

---

## Mental Models

- **Cheap to plant, expensive to weed.** A snapshot is a seed that grows a recurring maintenance cost. Plant only where the harvest justifies it.
- **The transitional tool.** Golden output is often the *scaffold*, not the *building* — right while you don't know the answer, wrong once you do. Plan the teardown.
- **Friction is governance.** Every rot pathway is an easy path (`-u`, copy a received file, skim a giant diff). Governance is making the right path the easy one.
- **Sameness guards change; assertions guard truth.** For anything with a knowable correct value, you want both.
- **A test nobody trusts has negative value.** It costs review attention and catches nothing. Delete or convert it.

---

## Common Mistakes

1. **Defaulting to snapshots instead of choosing them.** The crutch pattern — using golden output to avoid stating a known answer.
2. **No size cap.** Giant snapshots are unreviewable and guarantee rubber-stamping.
3. **Decentralized normalization.** Per-test scrubbers drift; non-determinism leaks back in.
4. **Allowing `-update` / auto-write in CI.** The reference must be reviewed locally, never minted by the pipeline.
5. **Never migrating.** Keeping opaque snapshots after the correct behavior is well understood.
6. **No anchor assertion for correctness-critical output.** A snapshot alone can rubber-stamp a wrong amount.
7. **Over-scrubbing.** Normalizing away the very signal you needed to catch a regression.
8. **Hoarding distrusted snapshots.** Keeping tests the team always blind-updates instead of deleting them.

---

## Test Yourself

1. Give the decision framework for "right tool vs crutch." What's the single best tell?
2. Name the three governance policies and the rot each one prevents.
3. Walk through using approval tests to refactor an untested 400-line method. Why is correctness *not* the goal during pinning?
4. Why is snapshot maintenance cost superlinear, and what are the three levers to manage it?
5. When and how do you migrate a snapshot to explicit assertions without losing coverage?
6. List three CI gates that prevent snapshot rot.
7. Re-tell the "wrong output approved" story and map each prevention to a specific policy.

---

## Cheat Sheet

```text
RIGHT TOOL vs CRUTCH
  Right : large/structured output, verified at creation, legacy pinning
  Crutch: small knowable value you skipped asserting; never reviewed

GOVERNANCE (make the lazy path the correct path)
  size cap      → reviewable diffs (no 600-line blobs)
  review reason → "why did this golden change?" in every PR
  central scrub → one normalization module, uniform placeholders

REFACTOR SCAFFOLD (the legit expert use)
  seam → pin behavior across input matrix (combination approvals)
       → approve baseline → refactor under net → migrate to assertions → delete

SCALE ECONOMICS
  cheap to add, expensive to maintain (back-loaded + externalized cost)
  minimize blast radius • cap population • watch golden churn
  blind-updated 3× = negative value → delete or convert

CI GATES
  jest --ci (no auto-write) • ban *.received.* • lint snapshot size • require reason
  NEVER pass -update / -u in CI

CORRECTNESS-CRITICAL OUTPUT (money/auth/contracts)
  snapshot guards CHANGE + explicit assertion guards TRUTH  → use both
```

---

## Summary

At scale, snapshot and approval testing is a governance problem, not a tooling one. The professional skill is telling a legitimate golden test (large/structured output, verified at creation, pinning legacy code for a refactor) from a crutch (a snapshot used to dodge a knowable answer), and then enforcing the standards — size caps, review-the-reason discipline, centralized versioned normalization, and CI gates that ban auto-writes and committed received files — that keep the suite from rotting into rubber-stamped diffs. Treat golden output as often *transitional*: the right scaffold while behavior is unknown, retired to explicit assertions once it isn't. And for anything with a knowable correct value, back the snapshot with an explicit assertion — because a snapshot will forever prove only *it's the same*, never *it's right*.

---

## Further Reading

- Michael Feathers — *Working Effectively with Legacy Code*: seams, characterization, the refactoring net.
- Llewellyn Falco — *ApprovalTests*: combination/table approvals, scrubbers, diff-tool workflow at scale.
- Jest documentation — *Snapshot Testing* best practices, `--ci`, inline snapshots, property matchers.
- Emily Bache — *The Coding Dojo Handbook* / approval-testing talks: golden master for legacy and refactoring katas.
- Kent Beck — *Tidy First?*: small, reviewable changes and the economics of test maintenance.

---

## Related Topics

- [Snapshot & Approval Testing — Senior](./senior.md) — normalization, characterization, reviewing diffs like code.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — where golden tests fit, and where assertions belong.
- [Unit Testing](../02-unit-testing/) — the destination when you migrate snapshots to explicit assertions.
- [Test Data Management](../11-test-data-management/) — stable, representative inputs for characterization at scale.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the non-determinism that centralized normalization defends against.
- The **`refactoring-techniques`** skill — seam identification and the characterization-then-refactor workflow.

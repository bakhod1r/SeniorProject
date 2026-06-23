# Snapshot & Approval Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Snapshot & Approval Testing

*A question bank for proving you understand golden-output testing — what it asserts, when it's the right tool, and the failure modes interviewers probe for.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [When It Helps vs Hurts](#when-it-helps-vs-hurts)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering snapshot/approval-testing questions the way a senior engineer would — leading with "it asserts sameness, not correctness," then demonstrating judgment about when that trade is worth it.**

Interviewers rarely want the Jest API. They want to know whether you understand the *one dangerous property* of golden tests — they prove output is unchanged, never that it was ever right — and whether you can name the disciplines (small snapshots, normalization, no blind-update, anchor assertions) that make them safe. The strongest answers are balanced: they treat snapshots as sometimes the right tool and often a smell, and they can articulate exactly which is which.

Each question below gives **Q**, *what the interviewer is really testing*, and a model **A**.

---

## Prerequisites

- The junior/middle pages: capture-once mechanics, the three traditions, determinism, `-u` discipline.
- The senior/professional pages: normalization, characterization for legacy refactor, governance, migration.
- You can write a Jest snapshot, a Go golden-file test, and explain ApprovalTests' approved/received model.

---

## Fundamentals

**Q1. What does a snapshot test actually assert?**
*Testing: whether you understand the core limitation or just the mechanic.*
**A.** That the output is **identical to a previously captured reference** — "same as last time." It does **not** assert correctness. If the first captured value was wrong, the test enshrines the bug and passes forever. Snapshots are excellent at catching *unintended change* in large output and useless at catching *original wrongness*. That single distinction governs every decision about when to use them.

**Q2. Distinguish snapshot, approval, and golden-master testing.**
*Testing: breadth and precision about the tradition you're using.*
**A.** Same underlying idea (committed reference, fail on diff), differing in *acceptance friction*. **Snapshot** (Jest/Vitest, insta, syrupy): the tool auto-generates the reference on first run — near-zero ceremony, easy to abuse. **Approval** (ApprovalTests, Llewellyn Falco): each run writes a `*.received` file, compared to a human-blessed `*.approved` file, accepted deliberately via a diff tool — high ceremony by design. **Golden master / golden file** (Go's `testdata/*.golden`): you hand-write the read/compare/`-update` plumbing — medium ceremony, total control over format and normalization.

**Q3. Why is auto-generation both the strength and the weakness of Jest snapshots?**
*Testing: do you see the trap in convenience.*
**A.** Strength: one line, no expected value to type, instant coverage of wide output. Weakness: the easiest path is to accept whatever the code happened to produce, so an unreviewed first capture can bless a bug, and the same convenience makes `-u` a reflex that turns the test into a rubber stamp. The friction other tools add (ApprovalTests' diff step) exists precisely to counter this.

**Q4. What is a characterization test and how do snapshots relate?**
*Testing: legacy-code refactoring literacy.*
**A.** A characterization test pins the *current* behavior of code — right or wrong — so you can refactor safely; any diff means you changed behavior. It's Michael Feathers' technique from *Working Effectively with Legacy Code*. Snapshots/approval tests are the natural implementation: you can't write explicit assertions for code you don't yet understand, but you *can* photograph its current output across many inputs, refactor under that net, and trust failures to flag behavior change. This is the one context where reaching for golden output first is unambiguously correct.

---

## Technique

**Q5. Walk me through the Go golden-file pattern.**
*Testing: can you implement golden testing without a framework.*
**A.** Define a `-update` flag. In the test, produce the output, build the golden path (`testdata/x.golden`). If `-update` is set, write the output to the golden file. Always read the golden file and compare it to the output, failing with a readable diff if they differ. Run `go test` to verify; `go test -update` to regenerate the reference. Key points: the reference is a committed, reviewable file; `-update` carries the same blind-accept danger as `jest -u`; and you own normalization because nothing scrubs for you.

**Q6. How do you handle timestamps, UUIDs, and random data in snapshots?**
*Testing: the #1 practical failure mode.*
**A.** Scrub/normalize before comparing or storing — replace volatile *values* with stable placeholders, keeping the *keys*. In Jest, property matchers: `toMatchSnapshot({ id: expect.any(String), createdAt: expect.any(Date) })`. For raw-text goldens, run a normalizer (regex replace timestamps → `<TIMESTAMP>`, UUIDs → `<UUID>`) on both sides. Also sort anything order-unstable (Go map iteration, JSON key order, result sets) before snapshotting. Critically: scrub the value, never delete the field — otherwise a regression that drops the field entirely passes silently. And never over-scrub, or you erase the signal you needed.

**Q7. Inline vs external snapshots — when each?**
*Testing: reviewability judgment.*
**A.** Inline (`toMatchInlineSnapshot`) stores the reference in the test source — use it for small output; the expected value sits next to the call, shows up in the same PR diff, and reads almost like a real assertion. External (`toMatchSnapshot`) puts the reference in `__snapshots__/*.snap` — reserve for output too large to live in source. For tiny output, prefer a plain explicit assertion over either.

**Q8. How do you keep a snapshot suite from rotting at scale?**
*Testing: governance / ownership thinking.*
**A.** Codify standards so the lazy path is correct: a **size cap** (giant snapshots are unreviewable → rubber-stamped); a **review-the-reason** rule (every golden change in a PR must explain *why*); **centralized, versioned normalization** so every test scrubs identically; and **CI gates** — `jest --ci` (never auto-write references in CI), ban committed `*.received.*` files, lint snapshot size, never pass `-update` in CI. Plus minimize *blast radius* (small, focused snapshots) and delete tests the team always blind-updates — a distrusted test has negative value.

---

## When It Helps vs Hurts

**Q9. When is a snapshot the *right* tool?**
*Testing: balanced judgment, not dogma.*
**A.** When output is **large and structured** so hand-asserting is impractical (rendered HTML, serialized data, generated code, CLI output, API bodies); when **regression-locking a known-good artifact** (formatter output, codegen); and especially when **pinning legacy behavior to refactor safely**. The common thread: the output is large or its correctness is unknown, and you want a tripwire on *change*, not a spec of *correctness*.

**Q10. When is a snapshot a smell?**
*Testing: do you recognize the crutch pattern.*
**A.** When the expected value is small and knowable but someone used `toMatchSnapshot` to avoid typing `toBe(x)` — that's a crutch hiding a missing assertion. Also: giant unreviewable snapshots, snapshots full of un-scrubbed noise that fail on every unrelated edit, and any suite the team blind-updates with `-u`. The tell is *intent*: a snapshot you chose because output is genuinely unwieldy is engineering; one you defaulted to because assertions felt like work is debt.

**Q11. Snapshot vs explicit assertion for an API response — which?**
*Testing: nuance, not a one-size answer.*
**A.** Both, ideally. A scrubbed snapshot of the body catches accidental field renames/removals cheaply. But for correctness-critical fields (money, auth, anything with a knowable right value) add explicit assertions — `expect(resp.tax).toBe(412)` — because a snapshot alone can rubber-stamp a *wrong* value. Snapshot guards change; assertion guards truth.

---

## Scenarios

**Q12. A snapshot test goes red in a PR. What's your process?**
*Testing: the discipline, not the command.*
**A.** Read the diff first. Then decide: was the change **intended**? Update the reference (`-u` / `-update` / approve) and explain why in the PR. Was it a **bug/regression**? Fix the code, leave the reference. I never run `-u` reflexively to make red go green — that converts the test into a rubber stamp that can never fail. If I can't explain the diff, I don't accept it.

**Q13. A teammate's PR updates 200 snapshots. How do you review it?**
*Testing: scale review judgment.*
**A.** First question: should one logical change touch 200 snapshots? High blast radius suggests over-wide snapshots that should be narrowed. For the review itself, I look for a *rationale* — "why did these change?" — and spot-check that the diffs match the stated intent rather than approving on green CI alone. If the diffs are unreadable blobs, that's a governance problem (size cap), and I'd push to split them. Approving 200 unread snapshot diffs is rubber-stamping behavior changes.

**Q14. Tell me about a wrong output getting approved. How would you prevent it?**
*Testing: real-world failure awareness.*
**A.** Classic case: a refactor introduces an off-by-one in tax rounding; the snapshot goes red; the diff is a 180-line un-normalized blob; under deadline a reviewer skims it, runs `-u`, and the one-cent-light values become the new golden — shipping bad invoices for weeks. Every safeguard failed: snapshot too large to review, asserted only sameness, blind `-u` frictionless, no explicit correctness assertion. Prevention: split into small snapshots (the shift becomes obvious), add an anchor assertion on a hand-verified case, require a PR rationale for golden changes, and run `jest --ci`. For money, always pair snapshot with explicit assertions.

**Q15. You inherit an untested 400-line function to refactor. How do you start?**
*Testing: legacy refactoring method.*
**A.** Pin its current behavior with approval tests before touching anything. Find a seam (return value or a wrapper serializing side effects to text), drive a broad input matrix through it (combination/table approvals including boundaries), and approve the current output as the *baseline* — explicitly "what it does today," not "what's right." Refactor under that net; any failure means I changed behavior, which I must not during a pure refactor. Once refactored and understood, migrate the pinning tests to explicit assertions and delete the golden scaffold. I'd lean on the refactoring-techniques workflow for seam identification.

---

## Rapid-Fire

**Q16.** *What does `jest -u` do?* — Overwrites stored snapshots with current output. Dangerous as a reflex; only run after reading the diff.

**Q17.** *What are `*.received` and `*.approved` files?* — ApprovalTests' fresh-output and human-blessed reference. `received` is git-ignored; `approved` is committed.

**Q18.** *Why git-ignore received files?* — A committed received file means someone approved by copying instead of using the diff tool — bypassing the review the model exists to enforce.

**Q19.** *Why does `jest --ci` matter?* — In CI it refuses to auto-create missing snapshots, so a test can't "pass" by minting its own reference; missing snapshots fail.

**Q20.** *Should you ever pass `-update` in CI?* — No. References are reviewed locally; CI only verifies.

**Q21.** *Name three Rust/Python snapshot tools.* — insta (Rust), syrupy (Python), plus Jest/Vitest (JS) and ApprovalTests (multi-language).

**Q22.** *Snapshot encoding a timestamp — what happens?* — Fails every run (non-deterministic); team learns to ignore failures or blind-update. Fix by scrubbing.

**Q23.** *One-line rule for snapshots vs assertions?* — Know the small answer → assert it; output too big to type → snapshot it (reviewed).

**Q24.** *What makes a snapshot brittle?* — Too wide a scope or un-scrubbed noise, so it changes on edits unrelated to its behavior.

**Q25.** *When do you delete a snapshot?* — When it's been blind-updated repeatedly without review (negative value) or once you understand the behavior well enough to assert it.

**Q26.** *Snapshot test vs contract test for an API — same thing?* — No. A snapshot proves the body is byte-identical to last time; a contract/schema test proves it conforms to an agreed shape. Snapshots catch *any* drift (including intended); contracts catch *contract violations*. Use schema validation for the contract, a scrubbed snapshot as a change tripwire.

**Q27.** *Why does ApprovalTests launch a diff tool on failure?* — To make acceptance a deliberate, in-your-face human act. The diff tool puts received vs approved side by side before you can save received → approved, which is exactly the review friction that `jest -u` lacks.

**Q28.** *Is a passing snapshot suite "good test coverage"?* — Not necessarily. It can be high *line* coverage with near-zero *assertion strength* if the snapshots were never reviewed — every output is "approved" regardless of correctness. Coverage of execution, not of intent.

**Q29.** *What's "blast radius" for snapshots?* — The number of snapshots that change for one logical edit. High blast radius (one component change lights up 200 snapshots) signals over-wide scoping and drives rubber-stamping; keep snapshots small and focused.

**Q30.** *Scrub a value or delete the field — which, and why?* — Scrub the value (`"createdAt": "<TIMESTAMP>"`), never delete the field. Deleting it means a regression that drops the field entirely passes silently; you'd lose the structural signal you wanted to protect.

**Q31.** *Can you over-normalize? Give an example.* — Yes. Replacing every number with `<NUM>` makes a genuinely wrong amount indistinguishable from a right one — the snapshot becomes a tautology. Normalization removes noise, never signal; scrub the smallest volatile span possible.

**Q32.** *Where do snapshot/golden tests sit on the test pyramid?* — They're a *technique*, not a layer — usable at unit, integration, or end-to-end level. The pyramid concern is the same: keep the bulk fast and focused, and don't let wide, slow golden tests dominate.

---

## Red Flags / Green Flags

**Green flags (strong candidate):**
- Leads with "snapshots assert sameness, not correctness."
- Treats them as *sometimes right, often a smell* — balanced, not dogmatic.
- Names normalization, size limits, no-blind-update, and anchor assertions unprompted.
- Knows characterization testing for legacy refactor and can name Feathers.
- Distinguishes snapshot / approval / golden by *acceptance friction*.
- Pairs snapshots with explicit assertions for correctness-critical output.

**Red flags (weak candidate):**
- Thinks a passing snapshot proves the code is correct.
- Treats `jest -u` as the normal response to a red test.
- Would snapshot a scalar instead of asserting it.
- No awareness of non-determinism (timestamps/UUIDs/ordering).
- Can't name a case where snapshots are a *bad* idea, or where they're the *right* one.
- Would approve 200 snapshot diffs on green CI without reading them.

---

## Cheat Sheet

```text
CORE TRUTH      Snapshots assert "same as last time", NOT "correct".
TRADITIONS      snapshot (auto) | approval (diff-tool review) | golden file (DIY + -update)
                differ by ACCEPTANCE FRICTION
DETERMINISM     scrub timestamps/UUIDs → placeholders; sort unstable order; keep keys
INLINE vs EXT   small → inline / plain assertion; large → external .snap
RED TEST        read diff → intended (update) or bug (fix code). Never blind -u.
RIGHT TOOL      large/structured output; legacy characterization for refactor
SMELL           known small value (use toBe); giant/noisy snapshot; reflex -u
SCALE           size cap • review the reason • central normalization • CI gates
CORRECTNESS     money/auth → snapshot (change) + explicit assertion (truth)
CI              jest --ci (no auto-write) • ban *.received.* • never -update in CI
```

---

## Summary

The interview signal for this topic is one sentence understood deeply: **a snapshot proves the output is unchanged, never that it was ever correct.** Everything else follows — why blind `-u` is fatal, why non-determinism must be scrubbed, why you keep snapshots small and review their diffs like code, when they're the right tool (large output, legacy characterization) versus a crutch (a missing assertion for a knowable value), and why correctness-critical output needs both a snapshot and an explicit assertion. Answer with that balance and the concrete disciplines, and you'll read as someone who has maintained a real golden-test suite, not just generated one.

---

## Further Reading

- Jest documentation — *Snapshot Testing*: matchers, inline snapshots, `--ci`, best practices.
- Llewellyn Falco — *ApprovalTests*: approved/received model, diff tools, combination approvals, scrubbers.
- Michael Feathers — *Working Effectively with Legacy Code*: characterization tests as a refactoring net.
- *Go testing patterns* — the golden-file + `-update` convention.
- Emily Bache — golden-master / approval-testing talks and refactoring katas.

---

## Related Topics

- [Snapshot & Approval Testing — Professional](./professional.md) — governance, scale economics, migration.
- [Unit Testing](../02-unit-testing/) — explicit assertions, the alternative when you know the answer.
- [Test Data Management](../11-test-data-management/) — stable inputs that keep golden tests deterministic.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the non-determinism that breaks golden tests.
- The **`refactoring-techniques`** skill — characterization-then-refactor for untested legacy code.

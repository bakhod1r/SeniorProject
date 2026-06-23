# Snapshot & Approval Testing — Middle Level

> **Roadmap:** [Testing](../README.md) → Snapshot & Approval Testing

*Three families of "golden output" testing, what each is good at, and why `-u` is the button that quietly disables the whole thing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Three families: snapshot vs approval vs golden master](#core-concept-1--three-families-snapshot-vs-approval-vs-golden-master)
5. [Core Concept 2 — Jest snapshots: file vs inline](#core-concept-2--jest-snapshots-file-vs-inline)
6. [Core Concept 3 — Go golden files with the `-update` flag](#core-concept-3--go-golden-files-with-the--update-flag)
7. [Core Concept 4 — ApprovalTests: approved vs received](#core-concept-4--approvaltests-approved-vs-received)
8. [Core Concept 5 — Legitimate uses (when to actually reach for it)](#core-concept-5--legitimate-uses-when-to-actually-reach-for-it)
9. [Core Concept 6 — The blind-update danger](#core-concept-6--the-blind-update-danger)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **knowing the three families of golden-output testing — snapshot, approval, golden master — and using each one deliberately instead of by reflex.**

At the junior tier you learned the single idea: capture output, commit it, fail on change. That idea has three distinct implementations in the wild, and they differ in ways that matter day to day:

- **Snapshots** (Jest, Vitest, insta, syrupy) — the tool *auto-generates* the reference and stores it next to the test.
- **Approval tests** (Llewellyn Falco's ApprovalTests) — the tool writes a `received` file, and you *promote* it to `approved` only after eyeballing it in a diff tool.
- **Golden files / golden master** — a hand-managed reference file, regenerated with an explicit `-update` flag (the classic Go pattern).

They share a spine but encode different amounts of human discipline. The junior page warned you that "same is not correct." This page is about choosing the right family for the job, the exact mechanics of each, and the one habit — blind `-u` — that turns any of them into a test that can never fail.

---

## Prerequisites

- You can write and run a basic snapshot test and read a snapshot diff. See [Snapshot & Approval Testing — Junior](./junior.md).
- You write explicit unit tests and know when an assertion is "obvious." See [Unit Testing](../02-unit-testing/).
- You're comfortable running `go test`, `npm test`, or `pytest` and reading their failure output.
- You understand non-determinism in tests at a basic level (timestamps, random IDs, map ordering). See [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Snapshot** | Auto-generated reference output stored by the test runner (e.g. a Jest `.snap` file). |
| **Inline snapshot** | A snapshot written *into the test source itself* rather than a separate file. |
| **Golden file** | A hand-managed reference file (often `testdata/*.golden`), regenerated with an explicit flag. |
| **Approved file** | In ApprovalTests, the human-blessed reference (`*.approved.*`). |
| **Received file** | In ApprovalTests, the just-produced output (`*.received.*`) awaiting approval. |
| **Characterization test** | A test that pins *current* behavior of code you don't fully understand, to catch change. |
| **Normalization / scrubbing** | Replacing non-deterministic fields (time, UUIDs) with stable placeholders before comparison. |
| **`-update` / `-u`** | The flag that overwrites the reference with current output. |

---

## Core Concept 1 — Three families: snapshot vs approval vs golden master

All three answer the same question — "did the output change?" — but they put the human in a different place.

| | **Snapshot (Jest)** | **Approval (ApprovalTests)** | **Golden file (Go)** |
|---|---|---|---|
| Who writes the reference? | The runner, automatically | The runner writes `received`; **you** promote to `approved` | You, via an explicit `-update` run |
| How is it stored? | `__snapshots__/*.snap` | `*.approved.txt` (+ transient `*.received.txt`) | `testdata/*.golden` |
| Default review moment | First run (easy to skip) | Promotion step (a diff tool opens) | Whenever you pass `-update` |
| Failure artifact | A diff in the console | A `received` file + diff tool launch | A diff you print yourself |
| Cultural emphasis | Convenience | **Deliberate human approval** | Explicit, version-controlled regen |

The key insight: **approval testing was designed precisely to fix the weakest moment of snapshots** — the "you were supposed to read it" step. ApprovalTests forces a `received → approved` promotion that is hard to do without looking. Jest makes capture so frictionless that the review is easy to skip. Go's golden-file pattern sits in between: regeneration is explicit (`-update`), but nothing forces you to look at the diff.

None is "best." Pick by how much discipline your situation needs.

---

## Core Concept 2 — Jest snapshots: file vs inline

The default `toMatchSnapshot()` writes to a sibling `.snap` file. There is a second, often-better form: **`toMatchInlineSnapshot()`**, which writes the snapshot *into the test file*.

```js
import { renderInvoice } from "./invoice";

test("invoice line renders a single item", () => {
  expect(renderInvoice({ qty: 2, unit: 4.5, label: "Widget" }))
    .toMatchInlineSnapshot(`"2 × Widget @ $4.50 = $9.00"`);
});
```

The first run fills in that backtick string automatically. Why prefer inline for small output?

- **It's visible in the test.** A reviewer reads the expectation right there — no jumping to a `.snap` file.
- **It pressures you to keep snapshots small.** A 200-line inline snapshot is obviously absurd; a 200-line `.snap` file hides off-screen.
- **It's nearly an explicit assertion.** Once the value is in the source, the line between "snapshot" and "I typed the expected value" blurs in a good way.

Rule of thumb: **inline for small output, file-based for genuinely large output.** If the inline snapshot would be more than ~5–10 lines, a file snapshot is more practical — but ask first whether the output should be that big at all.

---

## Core Concept 3 — Go golden files with the `-update` flag

Go has no built-in snapshot library; the community converged on a hand-rolled **golden file** pattern that is worth knowing because it makes the update step *explicit and auditable*.

```go
package report

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "update golden files")

func TestRenderReport(t *testing.T) {
	got := RenderReport(sampleData())

	golden := filepath.Join("testdata", "report.golden")

	if *update {
		if err := os.WriteFile(golden, []byte(got), 0o644); err != nil {
			t.Fatalf("writing golden: %v", err)
		}
		t.Logf("updated golden file %s", golden)
	}

	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("reading golden: %v", err)
	}

	if got != string(want) {
		t.Errorf("output mismatch\n--- want\n%s\n--- got\n%s", want, got)
	}
}
```

Run it two ways:

```bash
# Normal: compare against the committed golden file
$ go test ./report/

# Intentional change: regenerate the golden, then review the git diff
$ go test ./report/ -update
$ git diff testdata/report.golden    # <-- the mandatory human step
```

What's good about this pattern:

- The `-update` flag is **explicit per run** — you never accidentally rewrite goldens during a normal test pass.
- The reference is a **plain file in `testdata/`**, so `git diff` shows the change in code review exactly like any other file.
- You control serialization: pretty-print JSON, sort map keys, strip volatile fields — all before writing.

The discipline that makes it safe is the same everywhere: **after `-update`, you must `git diff` the golden and confirm the change was the one you intended.** The flag regenerates; it does not verify.

---

## Core Concept 4 — ApprovalTests: approved vs received

ApprovalTests (Llewellyn Falco) leans hardest into human review. The mechanic is a pair of files per test:

- `MyTest.testThing.approved.txt` — the blessed reference (committed).
- `MyTest.testThing.received.txt` — what the code just produced (gitignored, transient).

On each run the library writes the `received` file and compares it to `approved`. On a mismatch it **launches your configured diff tool** showing the two side by side, and the test fails. You approve a change by making `received` become the new `approved` — typically by clicking "copy left" in the diff tool, or deleting `approved` so the next run promotes `received`.

```java
// JUnit + ApprovalTests
import org.approvaltests.Approvals;
import org.junit.jupiter.api.Test;

class CustomerStatementTest {
    @Test
    void monthlyStatement() {
        String statement = new Statement(sampleAccount()).render();
        Approvals.verify(statement);   // writes .received, diffs against .approved
    }
}
```

The cultural difference from Jest is the whole point: **there is no frictionless one-key "accept everything."** To approve, a diff opens in your face and you act on it. That single design choice converts "I forgot to read it" into "I looked at it and chose to bless it." For characterizing legacy code (next concept), this is exactly the property you want.

Equivalent libraries exist for many languages: ApprovalTests.Net (C#), approvaltests (Python), and so on. The `received`/`approved` vocabulary is consistent across all of them.

---

## Core Concept 5 — Legitimate uses (when to actually reach for it)

Snapshots get a bad reputation because they're overused, but there are cases where they are clearly the *right* tool:

1. **Characterization tests before refactoring legacy code.** You inherit a 400-line function with no tests. You don't know what "correct" is — but you know it works in production. Capture its current output across representative inputs as golden/approved files, then refactor with the safety net that any behavior change shows up as a diff. This is straight out of Michael Feathers' *Working Effectively with Legacy Code*; the `refactoring-techniques` skill calls these characterization tests. Approval testing is purpose-built for this.

2. **Large structured output where hand-assertion is impractical.** Rendered HTML, a serialized AST, a 60-field API response, generated code, formatted CLI output. Writing dozens of `expect` lines is tedious *and* less readable than one golden file you can scan.

3. **Regression-locking a known-good output.** A report format that's been stable and reviewed: pin it so an unrelated refactor can't silently reshape it.

The common thread: **the output is wide, the "spec" is implicit, and a diff is the most honest way to review change.** When the expected value is small and you *know* it, an explicit assertion is still better.

---

## Core Concept 6 — The blind-update danger

This is where most of the value of this tier lives.

Every family has an "accept current output" button: Jest's `-u`, Go's `-update`, ApprovalTests' promote. That button is necessary — intended changes need a fast path. It is also the single failure mode that destroys the test's value:

```bash
# The anti-pattern, played out
$ npm test                # FAIL: snapshot diff in payments.test.js
$ npm test -u             # "fixed" it
$ git commit -m "tests passing"
```

If you ran `-u` without reading the diff, you just told the test "whatever the code does now is correct." A regression in the payment total was approved as the new golden value. The test is now green and *worthless* — it can never fail, because it asserts whatever the code currently produces.

Three practices keep this honest:

- **Read the diff before every update.** If you can't explain *why* it changed, do not accept it.
- **Never `-u` the whole suite to clear failures.** Update one file at a time, deliberately. Mass `-u` is how bad snapshots spread.
- **Review snapshot diffs in code review like any code.** A PR that touches 30 `.snap` files with no explanation is a red flag, not a rubber stamp.

ApprovalTests resists this by forcing a diff tool open. Jest and Go rely on *your* discipline. Build the reflex: a red golden-output test is a question, never a chore.

---

## Real-World Examples

- **Refactoring a tax calculator.** A legacy `computeTax()` with branching for 12 jurisdictions and no tests. The team approval-tests its output over 50 representative inputs, refactors the branching into a table, and the approved files prove behavior is byte-identical. No spec was ever written — the *current behavior* was the spec.
- **CLI tool output.** `mytool deploy --dry-run` prints a plan. A golden file pins the plan format; a refactor that accidentally drops a line trips the test.
- **GraphQL schema SDL.** The generated schema is snapshotted. A breaking field removal shows up as a diff in code review before it ships.
- **A Markdown renderer.** Input `.md` files in `testdata/`, golden `.html` outputs. `-update` regenerates them all; reviewers diff the HTML to confirm only the intended rendering changed.

---

## Mental Models

- **Three dials of human discipline.** Snapshot = low friction, low forced review. Golden file = explicit regen, optional review. Approval = high friction, forced review. Turn the dial up when correctness matters more.
- **The update button is a loaded gun.** Useful, necessary, and capable of silently approving a bug. Treat every `-u`/`-update` as a decision, not a keystroke.
- **Characterization = photograph the patient before surgery.** You're not deciding the patient is healthy; you're recording exactly how they look so you'll notice if surgery changed anything.

---

## Common Mistakes

1. **Treating all three families as identical.** Choosing Jest snapshots for a delicate legacy refactor — where ApprovalTests' forced review would serve you far better.
2. **Giant file snapshots over inline.** A small expectation hidden in a `.snap` file nobody opens, when `toMatchInlineSnapshot` would put it in front of the reviewer.
3. **`-update` without `git diff`.** Regenerating goldens and committing without confirming the change matches your intent.
4. **Snapshotting non-deterministic output raw.** Timestamps and UUIDs make the test fail every run; you must normalize (covered at senior tier).
5. **Using a golden file when you know the answer.** If the output is `"OK"`, assert `"OK"`. Goldens are for output too wide to type.

---

## Test Yourself

1. Name the three families of golden-output testing and the one design difference that distinguishes approval testing from snapshots.
2. When would you choose `toMatchInlineSnapshot` over `toMatchSnapshot`?
3. Write (from memory) the two `go test` commands: one to check against a golden file, one to regenerate it.
4. You're about to refactor an untested 300-line function. Which family fits best, and why?
5. Explain in one sentence why blind `-u` destroys a snapshot test's value.

---

## Cheat Sheet

```text
FAMILIES
  Snapshot (Jest/Vitest)  auto-generated .snap; low forced review
  Golden file (Go)        testdata/*.golden; regen with -update; you git diff
  Approval (Falco)        received → approved; diff tool forced open

JEST
  expect(x).toMatchSnapshot()         file-based, for large output
  expect(x).toMatchInlineSnapshot()   in-source, for small output (preferred)

GO GOLDEN
  go test ./pkg/            compare
  go test ./pkg/ -update    regenerate -> THEN git diff testdata/*.golden

LEGIT USES
  Characterize legacy code before refactor (Feathers)
  Wide structured output (HTML, JSON, AST, CLI, generated code)
  Regression-lock a reviewed, known-good output

THE DANGER
  -u / -update / promote = "accept current output as correct"
  Blind update of a red test => test can never fail => worthless
  Read the diff EVERY time. Update one file deliberately. Review .snap diffs in PRs.
```

---

## Summary

Golden-output testing comes in three families: auto-generated **snapshots** (Jest, Vitest), explicit **golden files** (Go's `-update` pattern), and **approval tests** (Falco's `received`/`approved` with a forced diff tool). They share the capture-and-compare spine but differ in how strongly they push a human to actually review changes — approval testing was built specifically to fix the moment snapshots make easy to skip. Reach for these tools when output is wide and the spec is implicit, especially to characterize legacy code before a refactor. The fatal habit, common to all three, is the blind update: `-u`/`-update`/promote without reading the diff turns the test into a rubber stamp that can never catch a regression. Read every diff, update one file at a time, and review snapshot changes in code review like the code they are.

---

## Further Reading

- Jest documentation — *Snapshot Testing*, especially the inline snapshots and "best practices" sections.
- The Go Blog / `golang/go` testing conventions — the golden-file `-update` flag idiom.
- Llewellyn Falco — *ApprovalTests* (the `received`/`approved` model and the diff-tool workflow).
- Michael Feathers — *Working Effectively with Legacy Code* (characterization tests).

---

## Related Topics

- [Snapshot & Approval Testing — Junior](./junior.md) — the core capture-and-compare idea.
- [Unit Testing](../02-unit-testing/) — explicit assertions, the default alternative.
- [Test Data Management](../11-test-data-management/) — stable, representative inputs that keep goldens deterministic.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — non-determinism that breaks golden-output tests.

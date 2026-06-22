# Snapshot & Approval Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → Snapshot & Approval Testing

*Capture the output once, commit it, and let the test scream when it changes.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a snapshot actually is](#core-concept-1--what-a-snapshot-actually-is)
5. [Core Concept 2 — Your first `toMatchSnapshot`](#core-concept-2--your-first-tomatchsnapshot)
6. [Core Concept 3 — How a snapshot test fails](#core-concept-3--how-a-snapshot-test-fails)
7. [Core Concept 4 — Updating a snapshot on purpose](#core-concept-4--updating-a-snapshot-on-purpose)
8. [Core Concept 5 — "Same" is not "correct"](#core-concept-5--same-is-not-correct)
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

> Focus: **understanding what a snapshot is, writing your first one, and learning why "it didn't change" is a weaker promise than "it's correct."**

Most tests you've written so far are *explicit*: you write `expect(add(2, 3)).toBe(5)`. You decided, in advance, what the right answer is, and you typed it into the test.

A **snapshot test** flips that around. You don't type the expected value. Instead, you run the code, capture whatever it produces, and save that to a file. From then on, the test re-runs the code, compares the new output to the saved file, and **fails if they differ**.

That's the whole idea: *capture once, lock it, alert on change.* It is fast to write and tempting to over-use. This page teaches you the mechanics and one crucial caveat: a snapshot proves your output is *the same as last time* — not that it was ever *right*.

---

## Prerequisites

- You can write a basic unit test and read an assertion like `expect(x).toBe(y)`. See [Unit Testing](../02-unit-testing/).
- You've run a test suite from the command line (`npm test`, `go test`, etc.).
- You understand what "committing a file to git" means — snapshots live in version control.
- Helpful but optional: knowing what JSON serialization is.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Snapshot** | A saved copy of some output, used as the expected value in a test. |
| **Golden file / golden master** | Another name for the committed reference output. "Golden" = the blessed, correct copy. |
| **Approved file** | In ApprovalTests, the human-reviewed reference. Its sibling is the *received* file. |
| **`toMatchSnapshot`** | Jest/Vitest matcher that compares output to a stored snapshot. |
| **`--update` / `-u`** | A flag that overwrites the stored snapshot with the current output. |
| **Diff** | The line-by-line difference shown when output and snapshot disagree. |
| **Serialize** | Turn an object into text (JSON, a string) so it can be saved and compared. |

---

## Core Concept 1 — What a snapshot actually is

Imagine a function that builds a user-profile object:

```js
function buildProfile(user) {
  return {
    name: `${user.first} ${user.last}`,
    initials: (user.first[0] + user.last[0]).toUpperCase(),
    role: user.admin ? "Administrator" : "Member",
  };
}
```

To test this with explicit assertions you'd write three or four `expect` lines. With a snapshot you write *one line* and let the tool record the whole object:

```js
test("buildProfile shapes the user", () => {
  expect(buildProfile({ first: "Ada", last: "Lovelace", admin: true }))
    .toMatchSnapshot();
});
```

The first time this runs, Jest **writes** a file next to your test, in a `__snapshots__/` folder:

```js
// __snapshots__/profile.test.js.snap
exports[`buildProfile shapes the user 1`] = `
{
  "initials": "AL",
  "name": "Ada Lovelace",
  "role": "Administrator",
}
`;
```

That `.snap` file is now part of your codebase. You **commit it**. It is the expected value — just stored in a file instead of typed inline.

---

## Core Concept 2 — Your first `toMatchSnapshot`

The workflow has exactly three steps:

1. **Write the test** with `.toMatchSnapshot()` (no expected value).
2. **Run it once.** The snapshot file is created. The test passes because there's nothing to compare against yet.
3. **Read the generated snapshot** and confirm it looks right, then commit it.

Step 3 is the one beginners skip — and it's the most important. The snapshot is only as trustworthy as your one-time review of it. If the output was wrong when you first captured it, you just enshrined a bug as the "correct" answer.

```bash
$ npx jest profile.test.js
 PASS  profile.test.js
  ✓ buildProfile shapes the user (3 ms)

 › 1 snapshot written.
```

After that first run, the snapshot is the law. Every future run checks against it.

---

## Core Concept 3 — How a snapshot test fails

Suppose a teammate changes the code so `role` becomes lowercase `"administrator"`. Re-run the test:

```bash
 FAIL  profile.test.js
  ✕ buildProfile shapes the user (8 ms)

  - Snapshot  - 1
  + Received  + 1

    {
      "initials": "AL",
      "name": "Ada Lovelace",
  -   "role": "Administrator",
  +   "role": "administrator",
    }
```

This is a snapshot test earning its keep: a change in behavior produced a visible **diff**, and the test failed. The `-` lines are the saved snapshot; the `+` lines are what the code produces now.

Now you have a decision to make, and it's a *thinking* decision, not a mechanical one:

- **Was the change intended?** Then the snapshot is out of date — update it (next concept).
- **Was the change a bug?** Then the test caught a regression — fix the code, don't touch the snapshot.

A snapshot test never decides this for you. It only flags the difference.

---

## Core Concept 4 — Updating a snapshot on purpose

When the change is intentional, you tell Jest to overwrite the stored snapshot:

```bash
$ npx jest profile.test.js -u      # -u = --updateSnapshot
 › 1 snapshot updated.
```

Now the `.snap` file holds the new lowercase value, and the test passes again. You commit the updated `.snap` alongside the code change.

> **The dangerous habit:** running `-u` *every time a test goes red* without reading the diff. That turns the test into a rubber stamp — it can never fail because you always accept whatever the code currently does. We'll hammer on this at higher tiers, but learn the reflex now: **read the diff before you update.** If you can't explain *why* the snapshot changed, do not update it.

---

## Core Concept 5 — "Same" is not "correct"

This is the single most important idea on the page.

An explicit assertion encodes *your knowledge of the right answer*:

```js
expect(add(2, 3)).toBe(5);   // 5 is provably correct
```

A snapshot encodes *whatever the code happened to produce*:

```js
expect(add(2, 3)).toMatchSnapshot();   // snapshot might say 6 if add() is buggy
```

If `add` returns `6` the first time you capture, the snapshot stores `6`, the test passes forever, and the bug is now "approved." Snapshots assert **"it's the same as before,"** never **"it's right."** They are great at catching *unexpected change* and useless at catching *original wrongness*.

That's why you (a) review the snapshot the moment it's created, and (b) prefer an explicit assertion whenever the expected value is small and you actually know it. Reach for a snapshot when the output is large, structured, and tedious to type by hand — not as a way to avoid thinking about correctness.

---

## Real-World Examples

- **Rendered UI component.** A React component renders to a tree of dozens of nodes. Hand-writing `expect` for every attribute is miserable; a snapshot captures the whole tree and flags any future change.
- **CLI `--help` output.** Capture the help text as a snapshot. If someone accidentally breaks the formatting, the test catches it.
- **API response shape.** Serialize a JSON response to a snapshot so a field rename or removal trips the test.
- **A formatter.** A code formatter takes ugly input and produces clean output. Snapshot the clean output; any change to the formatter shows up as a diff.

In each case the output is *big* and *structured* — exactly where snapshots shine.

---

## Mental Models

- **Photograph, not a spec.** A snapshot is a photo of the output. It tells you "this looks different from the photo," not "this looks wrong."
- **A tripwire.** It doesn't know what's good; it just trips when something moves. You decide whether the movement was welcome.
- **A receipt you must read.** Updating a snapshot is signing a receipt. Sign blindly and you've agreed to charges you never checked.

---

## Common Mistakes

1. **Not reading the first snapshot.** You enshrine whatever output exists, bug and all.
2. **`-u` as a reflex.** Going red → update → green, without reading the diff. The test now proves nothing.
3. **Giant snapshots.** A 500-line snapshot is unreviewable; nobody can tell a real regression from noise.
4. **Snapshotting random data.** If the output contains a timestamp or random ID, the test fails every run. (Fixing this is "normalization" — covered at higher tiers.)
5. **Using a snapshot when you know the answer.** If the expected value is `5`, write `toBe(5)`. Snapshots are for output too big to type.

---

## Test Yourself

1. In one sentence, what does a snapshot test actually assert?
2. You run a snapshot test for the first time and it passes. Did it verify your code is correct? Why or why not?
3. A snapshot test goes red. What two questions must you ask before doing anything?
4. What does `jest -u` do, and when is running it a bad idea?
5. Give one example of output that's a *good* fit for a snapshot and one that's a *bad* fit.

---

## Cheat Sheet

```text
WHAT IT IS   Save output to a file; fail the test when output later differs.
ASSERTS      "Same as last time" — NOT "correct".
WRITE        expect(value).toMatchSnapshot();   // no expected value typed
FIRST RUN    Snapshot file is written + committed. READ IT before trusting it.
RED TEST     Read the diff → decide: intended change (update) or bug (fix code).
UPDATE       jest -u   (only after reading and understanding the diff)
GOOD FOR     Large structured output: UI trees, JSON, CLI text, generated code.
BAD FOR      Small known values (use toBe), random/time-based output (scrub it).
GOLDEN RULE  Never blind-update. If you can't explain the diff, don't accept it.
```

---

## Summary

A snapshot test captures output once, stores it as a committed "golden" file, and fails when future output differs. It's cheap to write and excellent at catching unintended change in large, structured output. Its core weakness is that it asserts *sameness*, not *correctness* — so the value you first capture must be reviewed like real code, and you must never blind-`-u` a red test. Use snapshots when the output is too big to hand-assert; use explicit assertions when you actually know the right answer.

---

## Further Reading

- Jest documentation — *Snapshot Testing* (the `toMatchSnapshot` guide and best-practices section).
- Vitest documentation — *Snapshot* (the same model, modern tooling).
- Llewellyn Falco — *ApprovalTests* project introduction (the approved/received tradition).

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — explicit assertions, the alternative to snapshots.
- [Test Data Management](../11-test-data-management/) — building stable inputs so snapshots stay deterministic.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — why random/time-based data breaks snapshots.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — where snapshot tests fit in the bigger picture.

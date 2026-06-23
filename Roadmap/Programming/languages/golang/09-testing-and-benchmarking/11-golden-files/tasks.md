---
layout: default
title: Golden Files — Tasks
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/tasks/
---

# Golden Files — Tasks

[← Back](../)

Work through these in order. Each task builds on the previous. Code goes in a fresh module: `go mod init golden-practice`.

## Task 1 — Hello golden

Write a function `Greet(name string) string` that returns `"Hello, <name>!\n"`. Write a test that asserts the output against `testdata/TestGreet.golden`. Implement the `-update` flag idiom. Verify:

1. `go test` fails when the golden file is missing.
2. `go test -update` creates the golden file.
3. `go test` (no flag) now passes.
4. Manually edit the golden by one byte. The next `go test` must fail with a diff.

Acceptance: the helper `assertGolden(t, got)` is reusable across packages.

## Task 2 — Table-driven goldens

Extend Task 1 with a slice of test cases (`alice`, `bob`, `empty`). Use `t.Run(tc.name, ...)`. Confirm that each subtest produces its own `testdata/TestGreet_alice.golden`, `testdata/TestGreet_bob.golden`, `testdata/TestGreet_empty.golden`.

Acceptance: deleting `testdata/TestGreet_bob.golden` and re-running fails only the bob subtest.

## Task 3 — HTML rendering

Use `html/template` to render a user profile:

```go
type Profile struct { Name, Email string; Tags []string }
```

Render to a `bytes.Buffer`, then golden-test the result. Use at least three fixture profiles. Format the output through `tidy` or accept template-emitted whitespace as canonical — be consistent.

Acceptance: changing the template (e.g. adding a `<br>`) fails every subtest.

## Task 4 — Normalize timestamps

Modify Task 3 so the profile renders the current time via `time.Now().Format(time.RFC3339)`. The test must still be deterministic. Two acceptable approaches:

- Inject a clock: `Render(profile, clock func() time.Time)`. Pass `func() time.Time { return time.Date(2026, 1, 1, ...) }` in tests.
- Apply a regex normalizer that replaces RFC3339 timestamps with `<TIMESTAMP>` before comparison.

Implement both, then write a one-paragraph note in your README explaining which you prefer and why.

Acceptance: the test passes deterministically across 100 consecutive runs.

## Task 5 — JSON output with sorted keys

Write `ToJSON(m map[string]int) []byte` that returns indented JSON with keys in sorted order. Verify with a golden file. Run the test 1000 times in a loop (`for i in {1..1000}; do go test || break; done`) to prove map iteration is no longer a source of flakes.

Acceptance: 1000 runs, zero failures.

## Task 6 — CLI output golden

Build a small `cmd/report` that prints a fixed report given a JSON input file. Capture `cmd.Stdout` to a buffer in the test:

```go
buf := new(bytes.Buffer)
cmd := exec.Command("./report", "testdata/input.json")
cmd.Stdout = buf
cmd.Run()
assertGolden(t, buf.Bytes())
```

Acceptance: the test runs `go build` first, executes the binary, and goldens its stdout. Bonus: capture stderr to a separate golden.

## Task 7 — Versioned goldens

Store goldens under `testdata/v1/` and `testdata/v2/`. The SUT is a serializer with two output versions. The test iterates versions:

```go
for _, version := range []string{"v1", "v2"} {
    t.Run(version, func(t *testing.T) {
        got := Serialize(version, input)
        assertGoldenAt(t, filepath.Join("testdata", version, t.Name()+".golden"), got)
    })
}
```

Add a new `v3` version; write its goldens; confirm `v1` and `v2` tests still pass.

Acceptance: removing the `v1` serializer code fails only the `v1` subtest, proving the regression corpus catches dropped compatibility.

## Task 8 — Diff output formatting

Replace the placeholder diff in `assertGolden` with `cmp.Diff(string(want), string(got))`. Cause a deliberate mismatch and screenshot the failure message. Verify it includes:

- The golden path.
- A `-want / +got` legend.
- Line numbers or context lines.

Acceptance: a teammate reading the failure output can locate the source of the change in under 30 seconds.

## Task 9 — Use sebdah/goldie

Replace your hand-rolled `assertGolden` with `github.com/sebdah/goldie/v2`:

```go
g := goldie.New(t,
    goldie.WithFixtureDir("testdata"),
    goldie.WithDiffEngine(goldie.ColoredDiff),
)
g.Assert(t, t.Name(), got)
```

Compare ergonomics with your own helper. Note in your README which features goldie adds that you would have had to implement yourself (suffix configuration, diff engines, JSON helper).

Acceptance: all previous tasks pass after the migration with no logic change.

## Task 10 — Code generation golden

Write a tiny code generator: `Generate(spec Spec) []byte` that emits a Go struct from a `Spec`. Golden-test the generated file. Run `gofmt` on the output before comparison (the SUT formats; the golden is the formatted form). Confirm that `go vet` on the golden file passes — the testdata directory is excluded from `go vet`, so copy a golden into `_generated_check/` temporarily to run `go vet`, then remove.

Acceptance: a bug in `Generate` that emits malformed Go is caught both by the golden mismatch and by `go vet` on the copy.

## Task 11 — Update discipline

Make a deliberate breaking change to one fixture. Run `go test -update`. Open `git diff` and read every changed `.golden` byte before committing. Write a one-paragraph reflection: how easy would it be to commit a wrong baseline if you had skipped the diff?

Acceptance: you now refuse to commit a `.golden` change without reading the diff. Permanently.

## Task 12 — autogold

Pick one test from Task 2 and rewrite it with `github.com/hexops/autogold`:

```go
autogold.Expect("Hello, alice!\n").Equal(t, Greet("alice"))
```

Run `go test -update`. Observe that the source file itself is rewritten. Compare against the testdata approach. Note which kind of output (small inline string vs large multi-line) suits each tool.

Acceptance: a written comparison table in your README listing four scenarios and which tool you would use for each.

## Task 13 — Parallel goldens

Take your most golden-heavy test from earlier tasks. Add `t.Parallel()` to every subtest. Run the suite under `-race`:

```
go test -race -count=10 ./...
```

Confirm no races. If a race appears, find and fix the shared state. Common culprit: a package-level buffer reused across subtests.

Acceptance: 10 consecutive runs with `-race` and no failures.

## Task 14 — Error message goldens

Write a `validator` package with three error types: `EmptyField`, `OutOfRange`, `BadFormat`. Each returns a structured error message. Golden-test all three.

Now change one error message's wording. Observe the test fail. Inspect the diff. Decide: was this an improvement, or did you lose context? Practice the review discipline of asking "is this change actually better?".

Acceptance: three goldens; ability to articulate why one wording is better than another.

## Task 15 — Documentation as a golden

Generate your project's README's CLI usage section from your CLI's `--help` output. Golden-test that the generated README matches the committed README.

```go
func TestREADME(t *testing.T) {
    got := captureHelp()
    want, _ := os.ReadFile("README.md")
    // assert relevant section of want contains got
}
```

A change to the CLI's flags must rebuild the README. The test enforces this.

Acceptance: changing a flag's help text fails the test until you regenerate the README.

## Task 16 — Removing a golden test

Pick one of your earlier tests that you no longer think is valuable. Delete it. Delete the corresponding `.golden` file. Run `go test`. Confirm everything still passes. Confirm no orphan files remain in `testdata/`.

Acceptance: a clean `git status` after the deletion. No orphans found by `find testdata/ -name '*.golden'` that lack a corresponding test.

## Task 17 — Reflection

Write a one-page reflection answering:

- Which task was hardest, and why?
- Which technique do you think you will use most often in real work?
- What rule will you propose to your team after this exercise?
- One golden anti-pattern you have seen or anticipate.

This reflection is the closing artifact. It is for your own use; you do not need to share it. Just write it. The act of writing crystallizes the lessons.

## Task 18 — JSON ordering

Write a function `ToJSON(items []Item) []byte` where `Item` has `Name string` and `Tags []string`. The output should be a JSON array, with each item's tags sorted alphabetically. Golden-test with several inputs including out-of-order tags.

Run the test 100 times in a loop. Confirm zero flakes.

Acceptance: 100 stable runs, with tag sorting verifiable by reading the golden.

## Task 19 — Versioned encoder

Implement an encoder that supports both `v1` and `v2` output formats. Store goldens under `testdata/v1/` and `testdata/v2/`. Write a test that iterates both versions and asserts each.

Now intentionally introduce a bug in the `v1` code path. Run the tests. Confirm only `v1` cases fail. Fix the bug. Confirm all cases pass.

Acceptance: ability to break a single version without affecting the others, and the test isolation that follows.

## Task 20 — Code generator end-to-end

Build a code generator: given a JSON schema file, emit a Go struct file. Golden-test the generated Go.

Add a second test that copies the golden into a temp directory with a `go.mod` and runs `go build`. Confirm both pass.

Now introduce a bug that produces syntactically valid but semantically wrong Go (e.g. wrong field type). The byte comparison catches it. Introduce a bug that produces invalid Go. The `go build` catches it.

Acceptance: two complementary checks, each catching a category of bug the other misses.

## Task 21 — Logger goldens

Build a structured logger with `Info`, `Warn`, `Error` levels and an injected clock. Golden-test a sequence of log calls. The golden contains all log lines in order.

Now change one log line's format. Observe every test that produced that line fail. Decide: is this format change intended? Update or fix.

Acceptance: log format is treated as a contract, with the goldens enforcing it.

## Final challenge

Combine everything: build a small CLI that takes a YAML config, validates it, renders a Markdown report, and outputs both stdout and stderr. Write golden tests for:

1. Successful runs (multiple configs).
2. Validation failures (each error type).
3. The generated README documenting the CLI.

This is a complete miniature project that exercises every technique in the page set. Expect to spend a weekend on it. Upon completion, you have a portfolio piece demonstrating golden file mastery.

## Stretch goals

Once the core tasks are complete, try these for additional depth.

**Stretch 1: contribute a fix to an open-source project's golden suite.** Find a Go project with `testdata/*.golden`, pick a flaky test or stale golden, send a PR. The review process teaches you what good golden discipline looks like at scale.

**Stretch 2: build a CI integration that comments on PRs with golden diffs.** A small GitHub Action that posts the list of changed `.golden` files in a comment. This is a low-cost discipline aid that benefits any team.

**Stretch 3: write a normalizer linter.** A simple tool that scans test code for regex normalizers and reports which ones could be replaced with SUT-level determinism (e.g. by looking for `time.Now` in the SUT).

**Stretch 4: golden a complex existing project.** Add five thoughtful goldens to a project you maintain or contribute to. Run them for a month. Note what regressions they catch.

Each stretch turns the local skill into a contribution to the wider Go ecosystem. The discipline travels with you.

## Closing

The tasks here scaffold a complete journey from "I do not know what a golden file is" to "I can introduce the pattern to a team". Work through them in order. Do not skip the reflection task (16); the act of writing your own observations is where the most lasting learning happens.

Good luck.

## Self-assessment grid

After completing the tasks, rate yourself on these statements (1 = not at all, 5 = strong):

- I can write the `assertGolden` helper from memory.
- I can explain why `-update` defaults to false.
- I can identify three sources of non-determinism in a SUT.
- I know when to use `cmp.Diff` versus `bytes.Equal`.
- I can choose between hand-rolled, `goldie`, and `autogold` for a given scenario.
- I can design versioned goldens for a backward-compatibility contract.
- I can explain to a teammate why they should inspect goldens after `-update`.
- I can review a 50-line golden diff and judge whether it is intentional.
- I can refactor a non-deterministic SUT to make it golden-testable.
- I can recognize at least three golden anti-patterns.

If most are 4 or 5, you have the skill. If many are 1 or 2, revisit the corresponding pages and tasks.

## A final encouragement

These tasks are designed to be done, not just read. The difference between a developer who has read about golden testing and one who has used it is enormous. The reading takes an afternoon; the doing takes weeks. Both are necessary.

Start with Task 1 today. Build up. By task 12 you have professional-grade skill. By the stretch goals, you contribute to the discipline beyond your own work.

The framework is twenty lines of Go. The skill is a career-long asset.

## Tracking your progress

Consider keeping a small log of the tasks you complete:

```
Task 1: [date] - done, learned: helper basics
Task 2: [date] - done, learned: t.Name() path strategy
Task 3: [date] - done, learned: HTML rendering goldens are very readable
...
```

The log itself is not a deliverable. It is a personal artifact that helps you see the progression. When you reach Task 21 and wonder why you started, the log reminds you.

The goal is not to finish the tasks; it is to internalize the patterns. The tasks are the means.

[← Back](../)

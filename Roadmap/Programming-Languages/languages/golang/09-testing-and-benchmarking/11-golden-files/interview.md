---
layout: default
title: Golden Files — Interview Questions
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/interview/
---

# Golden Files — Interview Questions

[← Back](../)

## Q1. What is a golden file test?

A golden file test compares the output of a function against a checked-in reference file under `testdata/`. The reference is the "source of truth"; failure means the SUT changed or the golden is stale. The pattern is suited to outputs that are tedious to assert field-by-field — rendered HTML, formatted reports, generated code, CLI screens.

## Q2. Why is the directory named `testdata`?

`cmd/go` treats `testdata` as a sentinel. It is excluded from build, `go vet`, and package list expansion. Any file inside is invisible to the compiler but readable by `os.ReadFile` during tests. This means you can store invalid Go code, malformed JSON, or arbitrary bytes inside `testdata/` without poisoning the build.

## Q3. Implement the `-update` flag.

```go
var update = flag.Bool("update", false, "rewrite testdata/*.golden")

func assertGolden(t *testing.T, got []byte) {
    t.Helper()
    path := filepath.Join("testdata", t.Name()+".golden")
    if *update {
        if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
            t.Fatal(err)
        }
        if err := os.WriteFile(path, got, 0o644); err != nil {
            t.Fatal(err)
        }
        return
    }
    want, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("read golden: %v (run with -update)", err)
    }
    if !bytes.Equal(got, want) {
        t.Fatalf("golden mismatch for %s:\n%s", path, cmp.Diff(string(want), string(got)))
    }
}
```

The flag is package-level; `flag.Parse` is called by the test runner.

## Q4. When are golden files the wrong choice?

When the output is small enough to assert directly. `if got != "hello"` is clearer than a golden file. Goldens add file I/O, a flag, and a review burden. Use them when the output exceeds ~20 lines or contains structure that resists inline literals.

## Q5. The output contains a timestamp. What do you do?

Two options ordered by preference:

1. Inject a clock into the SUT and pass a fixed time in tests. This eliminates the non-determinism at the source.
2. Apply a normalizer regex that replaces `\d{4}-\d{2}-\d{2}T...` with `<TIMESTAMP>` before comparison.

Option 1 is strictly better — it tests real behavior. Option 2 is a workaround when the SUT is not under your control.

## Q6. How do you diff two golden outputs on failure?

`github.com/google/go-cmp/cmp.Diff(string(want), string(got))` produces a readable unified-style diff. For very large outputs, write actual to a `.actual` sibling file and tell the user to run `diff -u testdata/x.golden testdata/x.actual` themselves.

## Q7. What is the risk of `-update`?

A developer running `-update` blindly will overwrite a correct golden with broken output. The golden file passes on the next run, the bug ships, and the regression is invisible until a customer complains. Mitigation: code review on every changed `.golden` file, mandatory PR diff inspection, never run `-update` and commit without reading the diff.

## Q8. Why not just regenerate the golden every time?

Because then the test asserts nothing. The whole point is that the golden is a frozen baseline. Regeneration is a manual, reviewed event — not an automatic side effect of running tests.

## Q9. Compare `github.com/sebdah/goldie` and `github.com/hexops/autogold`.

- **sebdah/goldie** (v2): minimal helper around `assertGolden`. Provides `g := goldie.New(t)` and `g.Assert(t, "name", got)`. You manage the bytes.
- **hexops/autogold**: assertion-driven. `autogold.Expect(value).Equal(t, got)` stores the expected value as Go source code, not a separate file. `-update` rewrites the test file itself.

Goldie suits arbitrary byte output (HTML, JSON, binary). Autogold suits structured Go values where keeping the expectation inline aids readability.

## Q10. How do you combine table-driven tests with goldens?

Each case has a unique name; each name maps to a unique golden path:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        got := Render(tc.input)
        assertGolden(t, got) // uses t.Name() => "TestRender/case_name"
    })
}
```

`t.Name()` returns `TestRender/case_name`. Replace `/` with `_` to get a flat filename.

## Q11. How do you support backward-compatibility tests with versioned goldens?

Store goldens under `testdata/v1/`, `testdata/v2/`. The test reads each version and asserts the new SUT can still produce or parse that exact output. This is how serializer libraries pin wire-format stability.

## Q12. CI fails with a golden mismatch. What is the first thing you check?

Three questions, in order:

1. Did I intend to change the output? If yes, run `-update` locally and commit the new goldens.
2. Did a dependency change the output for me (formatter version, time library, locale)? If yes, pin the dependency or fix the SUT.
3. Is the test flaky due to map iteration or a stray `time.Now`? If yes, fix the SUT — never paper over with a normalizer when the root cause is reachable.

## Q13. Why must map iteration be sorted before writing to a golden?

Go maps iterate in randomized order. Encoding directly produces a different byte sequence each run. The golden test will pass once, fail next, with no code change. Fix: extract keys, sort, then iterate.

## Q14. Can golden tests run in parallel?

Yes if and only if each subtest writes to a distinct golden path. Two subtests sharing one path will race under `-update`. Use `t.Name()` as the path component to guarantee uniqueness.

## Q15. What is the relationship between golden file testing and snapshot testing in other ecosystems (Jest, RSpec)?

They are the same idea. Jest's `toMatchSnapshot` stores the expectation in `__snapshots__/`. Ruby's `rspec-snapshot` uses `spec/fixtures/snapshots/`. Go's `testdata/*.golden` predates both. The hazards (stale snapshots, unreviewed updates, hidden non-determinism) are identical across languages.

## Q16. How would you golden-test a code generator?

Three steps. First, exercise the generator with a representative input and capture the output bytes. Second, run `go/format.Source` to canonicalize the formatting. Third, compare against `testdata/X.go.golden`. The `.go.golden` suffix prevents the toolchain from compiling the file. For extra safety, copy the golden into a temp module in a separate test and run `go build` to verify it compiles.

## Q17. Two subtests share the same fixture. Is that a problem?

Sharing input fixtures is fine. Sharing output goldens is not. Each subtest must own its golden file. If two subtests legitimately produce identical output, they each still get their own (probably-identical) golden file. The cost of duplication is small; the cost of shared output (race under `-update`, ambiguous failures) is high.

## Q18. The output contains the current working directory. Now what?

That output is environment-dependent. Three options. (1) Refactor the SUT to not emit the working directory in production code paths — most often this is incidental and removable. (2) Strip the prefix in a normalizer: replace the project root with `<ROOT>`. (3) Set a fixed `chdir` in the test before invoking the SUT. Option 1 is best.

## Q19. How do you keep golden tests fast?

The dominant cost is the SUT itself, not the file I/O. Profile first. If file I/O does dominate (rare), batch via `embed.FS`, parallelize subtests, or cache shared fixtures with `sync.Once`. Do not preemptively optimize without a measurement.

## Q20. What should never be golden-tested?

Outputs without a clear correctness criterion that a human can judge from the bytes. Encrypted blobs, machine-learning predictions, compressed payloads, opaque protobuf wire bytes. For these, golden the decoded form (if any) and use property tests for the encoding itself.

## Q21. How do you handle a golden test that fails only on one developer's machine?

It is almost certainly an environment difference. Common causes: locale (`LC_ALL`), timezone (`TZ`), Go version, OS line endings, editor side effects on the file. Diagnose by comparing the environment, not by adding a normalizer. Once identified, pin the environment (in `Makefile`, in `CONTRIBUTING.md`, in `.gitattributes`).

## Q22. Explain the difference between `assertGolden(t, got)` and `assertGoldenJSON(t, value)`.

The first takes raw bytes and compares directly. The second marshals a Go value to indented JSON, appends a trailing newline, and delegates to the first. JSON helpers are convenient for value-shaped assertions where the byte form is incidental; raw byte helpers are necessary for outputs like HTML or generated code where the byte form is the contract.

## Q23. How do you organize goldens for a package with 30 tests?

Per-test-function directories: `testdata/TestRender/case_a.golden`, `testdata/TestRender/case_b.golden`. The helper computes the path from `t.Name()`. The directory layout keeps `testdata/` browsable as the suite grows.

## Q24. A reviewer asks "why did this golden change?". What is a good answer?

A bad answer: "I ran `-update`". A good answer: "the renderer now emits a trailing newline because it must match the file format spec; the diff adds `\n` to every case." The good answer ties the change to the source change and to a reason. If you cannot give a good answer, do not merge the PR.

## Q25. Could a golden test catch a security bug?

In some cases yes. A golden test on rendered HTML can catch a regression that introduces XSS-vulnerable output (an unescaped `<script>` would show in the diff). A golden test on log lines can catch accidental leakage of sensitive fields. Goldens are not primarily a security tool, but they make output stable, and stable output is easier to audit.

## Q26. Your team has 5000 goldens. How do you keep them healthy?

Several practices. (1) Annual audit: walk through the suite and delete orphans. (2) Discipline on new additions: each golden has a clear test that owns it. (3) Automation: CI checks that no `.golden` is committed without a matching test. (4) Tooling: a dashboard showing rate of change per golden, flagging the noisy ones. (5) Culture: every PR with a golden change is reviewed by a human who reads the diff.

## Q27. Why is `t.Helper()` important in the assertion helper?

Without it, when `t.Fatalf` reports the failure line, it reports the line inside the helper rather than the call site in the test. Every failure looks identical and gives no information about which test broke. With `t.Helper()`, the test framework skips the helper in the stack and reports the actual caller, which is what the developer needs to debug.

## Q28. What is the one habit that separates good golden discipline from bad?

Inspecting the diff before committing. Every other practice flows from this one. A team that does this catches regressions and surfaces unexpected changes. A team that does not has built a test suite that hides bugs as effectively as it catches them.

## Q29. How would you explain `testdata/` to a new contributor in one sentence?

A directory the Go toolchain ignores for build, conventionally used to store test fixtures and expected-output snapshots.

## Q30. When you onboard a new engineer, how do you teach the `-update` workflow?

Walk them through a real PR. Show them a failing golden test. Run `-update`. Open the resulting file in the editor. Read it together. Decide if it is right. Commit. Repeat with a deliberately wrong SUT to show what an incorrect regeneration looks like and how to avoid committing it.

The two-pass demonstration — once where the regeneration is correct, once where it would be wrong — cements the discipline far better than written instructions alone.

## Q31. Could goldens replace integration tests?

Sometimes. A golden test that exercises a real HTTP handler with a real router and asserts on the response body is an integration test. The line between "golden test" and "integration test" is blurry. What matters is the scope of behavior under test, not the assertion mechanism.

## Q32. Final synthesis: what do you tell a junior who is dismissive of golden testing?

Show them a real regression that goldens caught. The pattern is hard to appreciate in the abstract. After watching it catch a real bug — usually a formatting change that no other test would have caught — the value is obvious.

If you cannot find a real catch to show, the suite may not be well-designed. Add a golden test for an output you currently rely on, then deliberately break the SUT in a subtle way. Watch the test catch it. Show the junior the failure message. That is the demo.

## Q33. Quick-fire: name three things that should never appear in a golden file.

Random UUIDs without normalization; absolute file paths; current timestamps from `time.Now()`.

## Q34. Quick-fire: name three packages in the Go ecosystem famous for using golden files.

`cmd/gofmt`, `cmd/vet`, `cmd/cgo`. The `kubectl`, `terraform`, and `buf` projects also lean heavily on the pattern.

## Q35. Quick-fire: what does `bytes.Equal` do that `==` on strings does not?

Nothing semantically — Go strings are byte sequences, so `string(a) == string(b)` is equivalent to `bytes.Equal(a, b)`. `bytes.Equal` avoids one allocation when both are already `[]byte`, which is the common case for golden helpers.

## Q36. Quick-fire: what is `cmp.Diff(want, got)`?

A function from `github.com/google/go-cmp/cmp` that produces a unified-style diff string showing where `got` differs from `want`. Used in golden test failure messages to give the developer a readable diff.

## Q37. Quick-fire: what is the default value of the `update` flag and why?

False. So that running `go test` on a freshly cloned repository or in CI never accidentally rewrites the goldens. Switching the default to true would let bugs become baselines on first run, which is the bug the explicit flag is designed to prevent.

## Q38. Quick-fire: should you commit `.golden.actual` files?

No. They are debug artifacts written during a failing test. Add `*.actual` to `.gitignore`.

## Q39. Quick-fire: should the helper use `t.Fatalf` or `t.Errorf` on mismatch?

`t.Fatalf`. After a golden mismatch, the test cannot meaningfully continue; further assertions on the same output would also fail with the same root cause. Stop execution and report.

## Q40. Quick-fire: how would you golden-test a function that returns multiple values?

Combine the values into a deterministic textual representation (sprintf, JSON, custom format), then golden-compare the bytes. Or use separate goldens for separate logical channels (stdout, stderr, exit code).

## Q41. Quick-fire: how do you migrate a hand-rolled helper to `sebdah/goldie`?

Replace the helper body with a `goldie.New(t).Assert(t, t.Name(), got)` call. The flag is renamed implicitly (goldie's update flag is also `-update`). Tests should continue to pass without regenerating goldens, since the comparison logic is equivalent.

## Q42. Quick-fire: when is `hexops/autogold` a better fit than `sebdah/goldie`?

When the expected value is a small Go value that benefits from staying inline in the test source. For larger outputs (HTML, JSON over a few hundred bytes), `sebdah/goldie` is better because the expectation lives in a separate file and is easier to review.

## Q43. Closing question: in your own words, why does golden testing work?

Because human review at golden-generation time, applied once, gives every subsequent byte-by-byte comparison its meaning. The framework freezes a moment of human judgement and turns it into automated regression coverage. If the human review at generation time is skipped, the freezing captures nothing useful, and the test becomes a placeholder. The trust chain is human-judgement-then-machine-comparison. Both halves are required.

## Bonus tips for interview prep

- Practice writing the twenty-line helper from memory.
- Be ready to discuss trade-offs versus inline assertions and structural diffs.
- Have a real-world example ready of a bug a golden test caught (or would have caught).
- Know the name of at least one library (`sebdah/goldie`) and the Go-tree convention (`testdata/`).
- Be prepared to explain why `flag.Parse()` should not appear in test functions.
- Be prepared to discuss when to retire a golden test.
- Be prepared to identify three sources of non-determinism in a SUT.

[← Back](../)

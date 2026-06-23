---
layout: default
title: Subtests — Professional
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/professional/
---

# Subtests — Professional

[← Back](../)

This page is the operator's reference: things you need to know when you
own a large test suite that uses subtests heavily.

## Naming hygiene

Subtest names appear in `-v` output, in `-run` regexes, in CI dashboards,
and in flake reports. Keep them stable and machine-friendly:

```go
t.Run("decode/utf8/short", ...)
t.Run("decode/utf8/long", ...)
```

Slashes inside the name create another level in the hierarchy, so the
above produces `TestDecode/decode/utf8/short`. Some teams forbid slashes
inside names to keep the depth predictable. Spaces are rewritten to
underscores; non-printable runes are escaped; duplicate names get `#01`,
`#02` suffixes automatically.

## Filter conventions

Document the conventions for `-run` your CI uses:

- `-run '^TestParse$'` runs the whole table.
- `-run '^TestParse$/^valid_'` runs the `valid_*` family.
- `-run '^TestParse$/^valid_utf8$'` runs one case.
- `-skip 'slow_'` (Go 1.20+) excludes a family without listing the rest.

## Parallelism budget

Set `-parallel` to match your CI runner. Subtests calling `t.Parallel` are
bounded by this flag, not `GOMAXPROCS`. For a 16-core runner with
IO-heavy cases, `-parallel 32` is often a sweet spot; for CPU-heavy
cases, keep it at `GOMAXPROCS`.

## Failure reporting

When a single subtest fails, the parent is marked failed. CI tools that
parse `go test -json` see one `fail` event per failing subtest plus one
for the parent. Configure dashboards to deduplicate by leaf, not by
parent, so retry decisions are accurate.

## Go 1.22 migration

If your suite still carries `tc := tc` shadowing for the loop variable
fix, you can remove them once `go.mod` declares `go 1.22` or later. A
`golangci-lint` rule (`copyloopvar`) flags the now-redundant lines.

## Subtest-aware retries

Flaky-test retry tools must invoke `-run 'Parent/Child'` rather than the
whole test function; otherwise a flaky leaf forces re-running its
siblings. Most modern CI plugins (gotestsum, GitHub Actions retry) support
leaf-level retries.

## Test sharding strategy

For suites that exceed the CI runner's time budget, sharding splits
work across runners. Strategies, ordered by friction:

1. **Package-level sharding.** Each runner gets a list of packages.
   Simplest; the `go` tool already parallelizes packages.
2. **Test-function-level sharding.** Use `go test -list` to enumerate
   `TestXxx` functions per package, then `-run` to filter on each
   runner. Requires per-runner state.
3. **Subtest-level sharding.** Almost never worth it. The `-run`
   pattern for "this list of subtests" gets long quickly, and you
   need to enumerate subtests by actually running the parent.

Most production setups stop at level 1 or 2.

## Logging and debugging

The framework's per-test buffer keeps parallel output readable but
delays it until the test ends. For a long-running parallel subtest,
this means you see no progress until completion. Workarounds:

- `go test -v` does not change the buffering. The buffer is flushed
  per test, not per line.
- `fmt.Println` (bypassing the buffer) gives immediate output but
  interleaves across parallel subtests. Use sparingly for debugging
  only.
- Structured logs (zap, slog) with the test's name in the context
  give a usable interleaved trace if you ship them to a side file.

## Test data fixtures

Large suites typically have a `testdata` directory with golden files,
input samples, and configuration snippets. Conventions:

- `testdata/<feature>/<case>.golden` for one golden per case.
- A `-update` flag in the test to regenerate goldens.
- Each subtest maps one-to-one to a fixture file, with the file name
  matching the subtest name.

This pattern composes cleanly with subtests; the file name becomes
the subtest name, and the framework handles the rest.

## Failure triage workflow

When CI reports a subtest failure:

1. Capture the exact subtest path: `TestX/group/case`.
2. Re-run locally: `go test -v -run 'TestX/group/case' -count=10`.
3. If flaky: increase count, add `-race`, inspect for ordering deps.
4. If deterministic: read the error output, reproduce in a debugger.
5. Fix and verify with the same `-run` pattern.

Step 1 is critical. The full path is your unit of work; do not lose
the `group/case` portion when filing issues or asking for help.

## Subtests and observability

Some teams export per-subtest timing and outcome to their internal
metrics system. This requires parsing `go test -json` output:

```bash
go test -json ./... | tee test.json
your-tool < test.json # emits metrics
```

The JSON event stream is the right interface for this. Avoid scraping
`-v` text output; format changes silently across Go versions.

## When to break up a parent test

Signals that a parent test is too big:

- More than 200 lines including subtests.
- Subtests have unrelated setup costs (some need a DB, some don't).
- Subtests span multiple semantic areas (parsing AND encoding).
- `-run` patterns require multi-line shell heredocs to express.

Split by behavior, not by line count. Two clean 100-line tests beat
one tangled 200-line test.

## Code review checklist for subtests

Reviewing a PR that adds or modifies subtests, check:

- Each case has a clear, stable name.
- `t.Parallel` is consistent with the rest of the file's convention.
- For Go 1.21 modules, `tc := tc` shadowing is present.
- For Go 1.22+ modules, `copyloopvar` lint is clean.
- Shared state across cases is read-only or properly synchronized.
- Helpers register cleanup on the subtest's `t`, not the parent's.
- No `return` used to bail out; use `t.Skip`.
- `t.Helper` is called in any helper that asserts.

## Subtests and code coverage targets

Coverage is computed at the package level. Adding more subtests does
not directly increase coverage unless the new cases exercise new
code paths. Audit coverage growth from subtests by:

1. Running `go test -coverprofile=before.out` before adding cases.
2. Adding cases.
3. Running `go test -coverprofile=after.out`.
4. Diffing with `go tool cover -html=before.out` vs after.

If a new case adds zero coverage, ask whether it was worth adding or
whether you have duplicate cases.

## Operational rules of thumb

- Keep parent test runtime under 30 seconds, including all
  subtests, even with `-parallel 1`.
- Keep individual subtest runtime under 5 seconds where possible.
- A package's full `go test ./pkg` should finish in under 60 seconds
  for routine development workflow.

These are not hard limits, but exceeding them by 10x is a smell. Use
shorter test data, split heavy tests by build tag, or rethink the
test design.

## Subtests in micro-services

For service-level tests (table-driven integration tests against a
running HTTP server), one common pattern:

```go
func TestAPI(t *testing.T) {
    srv := startTestServer(t)
    cases := []struct{
        name, method, path string
        wantStatus int
    }{
        {"health_ok", "GET", "/health", 200},
        {"unknown_path", "GET", "/nope", 404},
        // ...
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            req, _ := http.NewRequest(tc.method, srv.URL+tc.path, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil { t.Fatal(err) }
            defer resp.Body.Close()
            if resp.StatusCode != tc.wantStatus {
                t.Errorf("status: got %d, want %d", resp.StatusCode, tc.wantStatus)
            }
        })
    }
}
```

This pattern scales to hundreds of endpoint tests with minimal
boilerplate. The server starts once, cases run in parallel, and
adding a new endpoint is one struct literal.

## Common production pitfalls

1. **Hardcoded ports.** Each test process binding to port 8080
   conflicts when tests run in parallel. Use `httptest.NewServer`
   which picks an unused port.
2. **Shared databases.** Without transactional isolation, parallel
   subtests stomp on each other. Use one schema per test or one
   transaction per subtest.
3. **Time-dependent assertions.** `time.Now()` in subtests makes
   them order-dependent. Use a fake clock injected into the system
   under test.
4. **Network access.** Tests that hit external services are flaky
   and slow. Mock or use VCR-style recordings.
5. **Random data.** Random inputs without a seed are unreproducible.
   Use a fixed seed per subtest or capture the seed in the failure
   message.

## Subtests and golden files

The pattern:

```go
func TestGolden(t *testing.T) {
    matches, _ := filepath.Glob("testdata/*.input")
    for _, path := range matches {
        path := path
        name := strings.TrimSuffix(filepath.Base(path), ".input")
        t.Run(name, func(t *testing.T) {
            t.Parallel()
            input, _ := os.ReadFile(path)
            got := process(input)
            goldenPath := strings.TrimSuffix(path, ".input") + ".golden"
            want, _ := os.ReadFile(goldenPath)
            if !bytes.Equal(got, want) {
                if *update {
                    os.WriteFile(goldenPath, got, 0644)
                    return
                }
                t.Errorf("mismatch; -update to regenerate")
            }
        })
    }
}
```

One subtest per `.input` file. The pattern is industry-standard for
parser-style tests.

## Stability over performance

Stability of subtest names matters more than test speed. A renamed
subtest loses its history in CI dashboards. Treat names as a public
contract; change them with the same care as you would a public API.

## Documentation conventions for subtests

When subtests are heavily used, document conventions in a
`TESTING.md` at the repo root:

- Naming style (snake_case, camelCase, prefix rules).
- When to use `t.Parallel` (default on/off, exceptions).
- How to add new test data fixtures.
- How `-run` and `-skip` are used in CI.
- Pre-commit hooks and what they enforce.

A 1-page document saves new contributors hours of guesswork.

## Test ownership

In large repos with many teams, subtests can blur ownership:
team A's package is tested by team B's helper, with team C's
fixture. Make ownership explicit:

- One CODEOWNERS file per test directory.
- Helpers in `internal/testhelpers` owned by the platform team.
- Fixtures co-located with the package they support.

This keeps test refactoring tractable.

## Subtest naming reviews

When reviewing a PR, examine subtest names with the same care as
function names:

- Does the name describe what is being tested?
- Is the name stable (not based on dates, random IDs, etc.)?
- Does the name distinguish this case from siblings?
- Does the name compose well with `-run` patterns?

Reject names like `case1`, `test`, `tmp`, `wip`.

## Subtests in monorepos

Monorepos with hundreds of Go packages have aggregate test counts
in the millions when subtests are factored in. Optimizations:

- Bazel or Buck for incremental builds; only re-test changed
  packages.
- `go test -short` for pre-commit; full suite in CI.
- Sharded CI with per-package test results aggregated by name.
- Test result history tracked by full subtest path.

The infrastructure investment pays off when the test suite grows
to that size.

## Migrating away from `t.Run`

Sometimes subtests are the wrong tool. Signs you should refactor
away:

- All subtests share so much setup that the closure overhead
  dwarfs the test logic.
- Subtests are nested 4+ levels deep, making `-run` patterns
  unreadable.
- Each subtest has dramatically different setup, suggesting they
  should be separate functions.
- The parent function exceeds 500 lines.

The fix is usually to split into separate `TestXxx` functions and
extract shared helpers. Don't be afraid to do this; subtests are
not always the right answer.

## Subtests and code generation tools

Tools like `go generate`, `protoc-gen-go`, and similar produce
code that may include tests. If they generate `TestXxx` functions
with subtests, the conventions of the generator dictate the
shape. Common patterns:

- One generated `TestXxx` per RPC method.
- Subtests per status code or error condition.
- Names mirroring the proto field names.

Don't fight the generator; if its output is unsatisfactory, fix
the generator template instead of hand-editing the generated
files.

## CI dashboard design

For organizations with hundreds of Go services, a centralized
test dashboard helps. Key features:

- Group by package, drill down to test function, drill down to
  subtest.
- Flake rate per leaf subtest over time.
- Average duration per subtest.
- Failure history with linkable URLs to specific subtest paths.

Tools like Buildkite, CircleCI, and GitHub Actions emit `go test
-json` output natively or via a parser; pick one and stick with
it.

## Test budget allocation

For a CI pipeline that takes 10 minutes, allocate:

- 30s: package list and dependency check.
- 6m: unit tests with `-parallel` configured.
- 3m: integration tests against test fixtures.
- 30s: artifact upload.

Subtests fit into the unit and integration phases. If unit tests
exceed budget, shard further or shorten cases.

## Common operational mistakes

1. **Letting the suite slowly grow past the time budget.** Set
   a hard limit; reject PRs that push past it.
2. **Adding `t.Parallel` without thinking.** Some tests genuinely
   need to be sequential; mass-applying `paralleltest` lint can
   introduce bugs.
3. **Skipping subtests as a workaround.** A `t.Skip` is a debt;
   track it and pay it down.
4. **Subtest names that include timestamps or random IDs.** History
   becomes useless. Always use deterministic names.
5. **Ignoring the parent's status.** A parent's PASS/FAIL is the
   aggregate; if it's FAIL, at least one subtest is broken even
   if you don't see which.

## Maturity model

Stages of subtest adoption in a codebase:

- Stage 0: separate `TestXxxA`, `TestXxxB` functions, no `t.Run`.
- Stage 1: occasional `t.Run` for table-driven tests.
- Stage 2: table-driven the norm, parallelism opportunistic.
- Stage 3: parallel-by-default, lint-enforced, leaf-level retries
  in CI.
- Stage 4: full observability with per-subtest metrics, flake
  detection, and automated bisection.

Most teams sit at stage 2 or 3. Stage 4 is reserved for orgs with
significant testing infrastructure investment.

## Subtests and test fixtures versioning

When tests load fixtures from `testdata/`, versioning matters:

- A new feature may change the expected output (golden file).
- A bug fix may add a new case (new input file).
- A refactor may rename cases (rename fixture files).

Treat fixtures as code: commit them, review them, version-control
them. The subtest name should map deterministically to fixture
file names so reviewers can correlate.

A common script in CI:

```bash
go test ./pkg -update
git diff testdata/
```

The `-update` flag regenerates golden files. Failed diffs in CI
mean the fixture needs human review.

## Subtest review etiquette

When reviewing PRs that touch subtests:

- Run the new subtest locally; confirm it actually exercises the
  intended path.
- Check the failure message is informative when the assertion fails.
- Verify the name is in the codebase's convention.
- Look for `tc := tc` shadow if Go version requires it.
- Check `t.Parallel` is consistent.

A 5-minute review of subtests catches more bugs than a 5-minute
review of production code; tests are where edge cases live.

## Subtest test plans

For large feature work, write a list of subtest names as a test
plan before implementing. Example:

```
TestPaymentFlow:
  - happy_path/credit_card
  - happy_path/bank_transfer
  - failure/insufficient_funds
  - failure/expired_card
  - retry/transient_network_error
  - retry/permanent_decline
  - audit/successful_payment_logged
  - audit/failed_payment_logged
```

The list serves as a design document, a test plan, and eventually
the actual test code (each line becomes a `t.Run` call). This is
TDD applied to subtest design.

## Mentoring junior engineers

Subtests are a high-leverage skill to teach. Common topics:

- The `t.Run` mechanism and why each subtest gets its own `t`.
- Table-driven patterns and when to apply them.
- `t.Parallel` and the loop variable bug.
- Cleanup ordering across parent and subtests.
- `-run` and `-skip` regex patterns.

A junior who masters these in their first few months becomes a
much more productive contributor. Allocate time for it in
onboarding.

## When the test framework is the bottleneck

Rarely, the testing framework itself becomes a bottleneck:

- Very fine-grained subtests (sub-microsecond bodies) where
  `Run` overhead dominates.
- Suites with millions of subtests where the goroutine startup
  cost adds up.

Solutions:

- Aggregate cases into fewer subtests, with assertions counted
  manually.
- Use benchmarks instead of tests for performance-critical
  measurement.
- Profile and quantify before optimizing; the framework is fast
  enough for almost all real-world usage.

## Subtests in libraries vs applications

Library tests (testing a generic package) tend to use:

- Many subtests for input space coverage.
- Parallel by default; no shared state.
- Property-based generators where appropriate.
- Golden files for output validation.

Application tests (testing a service) tend to use:

- Fewer but heavier subtests, each exercising a full flow.
- Mixed parallel/sequential based on resource constraints.
- Mocks for external dependencies.
- Integration tests in separate packages with build tags.

Recognize which mode you're in and apply the conventions
accordingly.

## Subtests and contract testing

For services with API contracts, subtests pair well with contract
testing. Each contract assertion (status code, response shape,
error format) becomes a subtest. Failure of any one points to a
specific contract violation, which is easier to triage than a
generic "the request failed" message.

Tools like Pact, Spring Cloud Contract, and custom OpenAPI
validators integrate with this pattern by generating subtests from
the contract specification.

## Closing professional advice

Subtests are not a silver bullet. They make many test designs
easier, but they also make it easier to write tests that are too
clever, too coupled, too implicit. The senior judgment is knowing
when to use them and when to write a plain test function.

The default should be: start with one test function and inline
assertions. If you find yourself with three or more variations of
the same shape, refactor to a table-driven test with subtests. If
the table grows beyond ~20 cases, ask whether the test should be
split.

Pragmatism beats dogma. Use the tools the language gives you, and
keep the test suite a reliable, fast, readable asset to your
team.

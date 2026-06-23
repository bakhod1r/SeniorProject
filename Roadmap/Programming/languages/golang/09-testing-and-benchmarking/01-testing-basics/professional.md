---
layout: default
title: Testing Basics — Professional
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/professional/
---

# Testing Basics — Professional

[← Back](../)

This page is for engineers who are not learning the `testing` package but are deciding how to *run a test suite at scale* — across a team, a codebase, and a CI system. The mechanics from `junior.md` and `middle.md` are assumed; here we cover discipline: naming, structure, flake budgets, the test pyramid in Go, tests as documentation, and the small set of conventions that turn a folder of `_test.go` files into a durable production asset.

## 1. Naming as contract

Test names are read in failure output, in CI dashboards, in flaky-test reports, and in `git log` when bisecting. Treat them as part of the public API of your test suite.

Conventions that scale:

- Test function name describes the *thing under test*: `TestUserService_CreateUser`, not `TestCreate`. The `_` separator between subject and behaviour is conventional; the Go vet tool tolerates it.
- Subtest names describe the *case*: `t.Run("empty_email_returns_validation_error", ...)`. Snake_case is conventional for subtests because `t.Run` lower-cases and slash-escapes the name internally; ASCII identifier characters survive cleanly.
- Avoid `TestStuff` and `TestEdgeCases`. Future-you reading `--- FAIL: TestEdgeCases/case_3` will not know what failed.

A failing CI line that reads:

```
--- FAIL: TestPaymentService_RefundPartial/refund_amount_exceeds_charge (0.04s)
```

is self-describing. Spend the keystrokes.

## 2. The Go test pyramid

The classic test pyramid — many unit, fewer integration, fewer still end-to-end — applies, with Go-specific shadings:

- **Unit tests** live in `pkg/foo/foo_test.go`. They use only the standard library and the package under test. They should run in under 50 ms each and not touch disk, network, or time.
- **Integration tests** live in `pkg/foo/integration_test.go` behind `//go:build integration`. They start real dependencies (Postgres, Redis, Kafka), often via `testcontainers-go` or docker-compose, and verify cross-component behaviour. They typically take seconds.
- **End-to-end tests** live in a top-level `e2e/` package, run against a deployed environment, and are owned by a separate CI job. They should number in the tens, not hundreds.

Distinguish them with build tags rather than runtime flags so a developer running `go test ./...` cannot accidentally hit production.

## 3. CI integration patterns

A baseline Go CI job looks like:

```yaml
- name: go vet
  run: go vet ./...
- name: go test (unit)
  run: go test -race -short -count=1 -timeout=2m ./...
- name: go test (integration)
  run: go test -race -tags=integration -timeout=10m ./...
- name: coverage
  run: go test -cover -coverprofile=cover.out ./...
```

Notes:

- `-race` always, in CI. Local developers may skip it for speed; CI must not.
- `-count=1` defeats the cache when CI builders share a `$GOCACHE` across branches.
- `-timeout` prevents a single hung test from burning a worker. Set it tight enough to catch deadlocks but loose enough to survive slow CI hardware.
- `-short` in the first job means slow tests are pushed to the integration job.

Separate `go vet` from `go test` so a vet failure does not block test feedback.

## 4. Flake budgets

A flaky test is a test that fails non-deterministically on the same code. They are *bugs*, not nuisances — they hide real issues and erode trust in the suite. Conservative discipline:

- Track flakes. Run `go test -count=100 ./...` weekly on `main` and record any test that fails fewer than 100 times. That is your flake set.
- Set a budget: `< 1 flake per 1000 runs per test`. Tests exceeding the budget get a high-priority bug.
- Quarantine cautiously. `t.Skip("flake — issue #1234")` should be used only with a linked issue and a fix-by date. Permanent skips become permanent dead code.

The deepest cause of Go test flakes is `time.Sleep` for synchronisation, shared global state, and parallel tests that mutate package-level variables. The fix is almost never `t.Sleep` longer — it is making the test deterministic.

## 5. Tests as documentation

`Example` functions are runnable godoc. They appear inline in the documentation at `pkg.go.dev` and `go doc`, and the framework verifies their output against the `// Output:` comment on every test run. They are the cheapest way to keep documentation honest.

Conventions:

- For every exported function with a non-trivial signature, write an `Example`.
- For complex packages, write a package-level `Example` that demonstrates the full happy path.
- Examples should be short — under 20 lines. If a usage is longer, link to a `_examples/` directory and keep the `Example` to a teaser.

When `pkg.go.dev` renders your package, the `Example` is what readers see first. Treat it like the README of the function.

## 6. Black-box by default

Internal (`package foo`) tests are tempting because they can reach unexported state. External (`package foo_test`) tests are slightly more verbose but pay for themselves:

- They prove the public API is sufficient for the cases you care about.
- They survive refactors of internal types without rewriting the test.
- They cannot accidentally couple to implementation choices.

Use internal tests for genuinely white-box concerns — testing an unexported pure function whose contract is internal, or verifying invariant maintenance after a private mutation. For everything else, default to `_test` package.

When you need both — public-API tests *and* an occasional unexported reach — put the unexported reach in `export_test.go`:

```go
// foo/export_test.go
package foo

var InternalCache = &cache
func InternalResetCache() { cache = newCache() }
```

External tests can then write `foo.InternalResetCache()` without making `cache` itself public.

## 7. The "tests live with the code" rule

Resist the urge to put tests in a separate `tests/` directory. Go's convention places `foo_test.go` next to `foo.go`. This:

- Makes tests visible to anyone reading the package.
- Lets `go test ./pkg/foo` run only that package's tests.
- Makes refactoring symmetrical — a `git mv` of the source moves the tests too.

The only legitimate exception is integration tests in a separate package directory, which carry their own setup and should not pollute the unit test namespace.

## 8. Reading `*_test.go` in code review

Skim a test PR the same way you skim any code PR, with five extra checks:

1. Is each test name self-describing in a fail line?
2. Are setup failures fatal (`t.Fatalf`) and assertion failures non-fatal (`t.Errorf`)?
3. Are subtests parallel where they can be?
4. Are temp directories created with `t.TempDir`, not hard-coded paths?
5. Is there any `time.Sleep` standing in for synchronisation?

These five checks catch the overwhelming majority of test smells.

## 9. Coverage as a guide, not a target

Coverage is a useful signal: lines not covered by any test are by definition untested. But coverage as a *quota* — "every PR must hit 80%" — produces filler tests, mock-heavy assertions, and tests that pin implementation details. The healthy view:

- Use coverage to find untested branches in code you care about.
- Avoid covering generated code (`gomock` mocks, protobuf stubs) — they are not your tests' subject.
- Track coverage trend, not absolute number. A package whose coverage drops from 92% to 78% in one PR deserves a question.

`08-coverage` covers this in depth.

## 10. The test cache in CI

In a busy monorepo, `go test ./...` may compile and run hundreds of packages. If `$GOCACHE` is empty, this can take 5-10 minutes. Persisting `$GOCACHE` across CI runs reduces that to seconds for unchanged packages.

GitHub Actions example:

```yaml
- uses: actions/cache@v3
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: ${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}
```

The cache key includes `go.sum` so dependency updates invalidate. The cache itself is content-addressed, so stale entries are harmless.

## 11. Migrating from another test framework

When a Go project inherits patterns from JUnit, RSpec, or pytest, expect to rewrite:

- Setup/teardown hooks become `t.Cleanup` and `TestMain`. There is no `BeforeEach`.
- Fluent assertions become `if got != want { t.Errorf(...) }`. Adopt a small helper file rather than importing `testify` everywhere — see the discussion in `05-test-helpers-libraries`.
- Test discovery by annotation becomes test discovery by name prefix.
- Tagged tests become build-tag-gated tests.

The transition is friction but produces a smaller dependency graph and more readable tests.

## 12. Anti-patterns to ban in review

- A test whose body is just `if err == nil { t.Error("expected error") }` with no check on *which* error.
- A test that calls `t.Log` for assertions, so it never actually fails.
- A test with a hidden `t.Cleanup(func(){ panic("oops") })` that crashes the test binary.
- A test that relies on `os.Exit` to short-circuit teardown.
- A `TestMain` that returns from `m.Run` without `os.Exit`, causing benchmark mode to never terminate.
- A test that does `runtime.GOMAXPROCS(1)` to make a race "deterministic". It hides the bug.

Add these to your review checklist.

## 13. Owning the test runtime

The `testing` package gives you the runtime. The owners of that runtime are the test authors, not the framework. Decide as a team:

- Maximum acceptable single-test duration in unit suite (suggested: 50 ms).
- Maximum acceptable package-test duration (suggested: 5 s).
- Minimum subtest parallelism (suggested: every loop with > 2 iterations).
- Coverage trend gate (suggested: ±2% from `main`).
- Allowed test helper libraries (suggested: none beyond stdlib plus `gotestyourself/assert` and `go-cmp` for diffs).

Documenting these in `CONTRIBUTING.md` makes new contributors productive without lengthy review cycles.

## 14. Tests outlive code

The most expensive bug in a test suite is one that prevents future change. A test that pins `time.Now()` to an exact millisecond, an example that hardcodes a generated UUID, a fixture that pins a JSON field order — these will break on every refactor and either erode trust or freeze the code.

Write tests that pin *behaviour*, not *implementation*. When in doubt, ask: "If I rewrite this function to do the same thing more efficiently, does this test still pass?" If not, the test is over-specified.

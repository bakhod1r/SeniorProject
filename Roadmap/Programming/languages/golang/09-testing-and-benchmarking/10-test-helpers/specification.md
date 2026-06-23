---
layout: default
title: Test Helpers — Specification
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/specification/
---

# Test Helpers — Specification

[← Back](../)

## Scope

This specification describes test helper functions in Go: their
contract, the `testing.TB.Helper` method, the conventions for shared
helper packages, the categories of helpers found in production
projects, and the rules that govern their evolution.

## Normative requirements

1. A test helper is any function that accepts `*testing.T`,
   `*testing.B`, or `testing.TB` and produces side effects on that
   value (assertions, fatal reports, cleanup registration).
2. A helper that calls `t.Errorf` / `t.Fatalf` / `t.Fatal` MUST call
   `t.Helper()` as its first non-trivial statement. The call marks
   the function so that test failure traces blame the caller, not
   the helper itself.
3. `t.Helper()` only affects the immediate function. Each helper in
   a chain must call it independently. The runtime walks the
   goroutine stack at the moment of the failure and skips any frame
   whose function has been marked.
4. A helper that allocates resources MUST register teardown via
   `t.Cleanup` rather than returning a `func()` for the caller to
   defer. The runtime executes cleanup functions after the test
   finishes, in reverse order.
5. A helper MUST NOT call `t.Parallel()`. Parallelism is a property
   of the test, not of the helper.
6. A helper MUST tolerate a nil `*testing.T` only if it is
   documented as safe to use outside a test. Most helpers may panic
   instead.
7. A helper exported from `internal/testutil` SHOULD accept
   `testing.TB` rather than `*testing.T`. The `testing.TB`
   interface admits both tests and benchmarks.
8. A helper that calls reporting methods (`Errorf`, `Fatalf`) MUST
   NOT do so from a goroutine other than the test's own goroutine.
   The standard `testing` package does not guarantee correctness in
   that case.

## Behavioural definition

```go
func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Fatalf("got %v, want %v", got, want)
    }
}
```

The call to `t.Helper()` registers the current function with the test
runner. When `t.Fatalf` later produces a stack trace, the runner
walks the stack and skips registered helpers, reporting the first
unmarked caller.

## Helper categories

### Assertion helpers

Compare values and report failure. Subcategories:

- Equality (`assertEqual`, `assertEqualDiff`).
- Existence (`assertNotNil`, `assertLen`).
- Error checking (`assertNoError`, `assertErrorIs`).
- Content (`assertContains`, `assertMatchesRegexp`).

Assertion helpers continue on failure (`Errorf`) unless their name
starts with `must` or `require`, in which case they stop on failure
(`Fatalf`).

### Construction helpers

Build complex fixtures. Subcategories:

- Parsers (`mustParseTime`, `mustParseURL`, `mustParseJSON`).
- Factories (`newTestUser`, `newTestPayment`).
- Loaders (`loadJSON`, `loadGolden`, `loadCSV`).

Construction helpers stop on failure because the test cannot
continue without the fixture.

### Resource helpers

Allocate and clean up resources. Subcategories:

- Files (`tempDir`, `tempFile`).
- Databases (`openTestDB`).
- Servers (`newTestServer`, `newRecordedServer`).
- Contexts (`newTestContext`).

Resource helpers register cleanup via `t.Cleanup` and stop on
allocation failure.

### Polling helpers

Wait for an asynchronous condition. Subcategories:

- Boolean polling (`eventually`).
- Value polling (`eventuallyEqual`).
- Channel polling (`receiveOrTimeout`).

Polling helpers stop on timeout because subsequent assertions would
be meaningless.

### DSL helpers

Chain operations on a domain object for readable tests.
Subcategories:

- Builders (fluent construction).
- Session helpers (sequence of related operations).
- Scenario helpers (timeline of events).

DSL helpers vary in failure mode depending on the operation.

## Naming conventions

A helper's name SHOULD follow these prefixes when applicable:

- `assert<Property>`: continues on failure.
- `require<Property>` or `must<Action>`: stops on failure.
- `new<Resource>`: constructs a fixture with cleanup.
- `load<File>`: reads a fixture from disk.
- `eventually<Condition>`: polls for a condition.

A helper's name MUST NOT be a generic word (`check`, `do`, `run`,
`assert`). The name should communicate what the helper checks or
does.

## Package conventions

Shared helpers live in `internal/testutil` or a similarly-named
package under `internal/`. The package SHOULD:

- Export helpers with documented godoc comments.
- Accept `testing.TB` to support tests and benchmarks.
- Provide both `<Helper>` and `Require<Helper>` variants when the
  distinction is useful.
- Avoid global state.
- Avoid panicking; report failures through the `testing.TB`
  argument.

## Evolution

Once a helper is shared, its signature is a contract. Breaking
changes require updating every caller in the same commit. Adding
new helpers is preferred over modifying existing ones.

A helper SHOULD be removed when:

- It has no callers.
- Its only caller can be rewritten more clearly inline.
- Its purpose is subsumed by a newer helper.

A helper SHOULD NOT be removed without a migration window for
external contributors who may have local branches using it.

## References

- The Go Programming Language Specification — none directly;
  helpers are defined by the `testing` package documentation.
- `testing.T.Helper` godoc: "Helper marks the calling function as a
  test helper function. When printing file and line information,
  that function will be skipped."
- `testing.T.Cleanup` godoc: registers a function to be called when
  the test and all its subtests complete.
- `google/go-cmp` package documentation for `cmp.Diff` and option
  types.
- `testing/quick` package for `quick.Check`.
- `google/go-cmp/cmp/cmpopts` for `IgnoreFields`, `EquateApprox`,
  `SortSlices`, and related options.

## Conformance checklist

A helper package conforms to this specification when:

- Every helper that reports failures calls `tb.Helper()` first.
- Every resource-allocating helper uses `tb.Cleanup`.
- No helper calls `t.Parallel()`.
- Every exported helper has a godoc comment naming its failure
  mode.
- Helpers accept `testing.TB` unless they need a `*testing.T`-only
  method.
- Reporting methods are called from the test's own goroutine.

A test suite conforms when its tests rely on conforming helpers and
do not duplicate helper logic inline.

## Glossary

- **Helper**: a function that takes `testing.TB` (or `*testing.T`,
  `*testing.B`) and reports failures or registers cleanup.
- **Assertion helper**: a helper that compares values and reports a
  failure on mismatch.
- **Construction helper**: a helper that builds and returns a
  fixture, optionally registering cleanup.
- **Resource helper**: a helper that allocates a resource and
  registers cleanup.
- **Polling helper**: a helper that waits for a condition with a
  timeout.
- **DSL helper**: a helper that exposes a chain of operations on a
  domain object.
- **`t.Helper`**: a method on `testing.TB` that marks the calling
  function so failure traces skip it.
- **`t.Cleanup`**: a method on `testing.TB` that registers a
  function to run after the test (and its subtests) complete.
- **`testing.TB`**: an interface that abstracts the common methods
  of `*testing.T` and `*testing.B`.

## Open issues

This specification leaves several questions to project policy:

- Naming conventions for non-assertion helpers (the `new`, `must`,
  `load` prefixes are widely used but not standardised).
- The exact boundary between a helper and a framework.
- Whether to publish helpers from a library or keep them internal.

Each project's answer depends on its size, conventions, and
preferences. The specification names the rules that hold for any
project; the rest is local.

## Future considerations

Future versions of Go may add facilities that affect helper
design:

- Improved property-based testing in the standard library could
  reduce the need for the `gopter` and `rapid` dependencies.
- Stronger generics could simplify the construction of generic
  fixture factories.
- A standardised `cmp.Diff` in the standard library would remove
  the dependency on `google/go-cmp`.

Until any of these land, the specification stands as written.
Projects adopting the patterns now will not have to revise their
helpers when language changes arrive.

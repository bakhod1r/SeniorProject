---
layout: default
title: Subtests — Specification
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/specification/
---

# Subtests — Specification

[← Back](../)

## Normative signature

From the `testing` package godoc:

```go
func (t *T) Run(name string, f func(t *T)) bool
```

`Run` runs `f` as a subtest of `t` called `name`. It runs `f` in a separate
goroutine and blocks until `f` returns or calls `t.Parallel` to become a
parallel test. `Run` reports whether `f` succeeded (or at least did not fail
before calling `t.Parallel`).

## Naming rules

1. The fully qualified subtest name is `Parent/Child`, joined by `/`.
2. Spaces and certain characters in `name` are rewritten: spaces become `_`,
   and non-printable runes are quoted with `%q`-style escapes.
3. Duplicate names within the same parent get a numeric suffix: `Case#01`,
   `Case#02`, ...
4. The top-level test function name (`TestXxx`) is the root; subtests are
   children of that root.

## Selection (`-run`)

The `-run` flag accepts a `/`-separated list of regular expressions:

```
-run '^TestParse$/^valid_input$/^utf8$'
```

Each segment matches the test at the corresponding depth. A subtest is
considered for execution only if every ancestor regex matches its level.
`-skip` follows the same shape (Go 1.20+).

## Failure propagation

If a subtest fails (`t.Errorf`, `t.Fatal`, panic, race), the parent test is
also marked failed. The parent continues running siblings unless it itself
calls `t.Fatal` outside any subtest.

## Parallelism

`t.Parallel()` inside a subtest pauses that subtest until the parent's
non-parallel subtests have completed; then all paused subtests run together,
bounded by `-parallel N` (default `GOMAXPROCS`).

The parent's `Run` call returns as soon as the child calls `t.Parallel`, so
sequential code after `t.Run` in the parent does not wait for parallel
children. The parent waits for all parallel children to finish before its
own deferred work and `Cleanup` callbacks fire.

## Cleanup ordering

Each `*testing.T` has its own LIFO cleanup stack. Cleanups registered in a
subtest run after the subtest's body returns and before control returns to
the parent's continuation (for sequential subtests) or before the parent
finishes (for parallel subtests).

## Go 1.22 loop variable scope

Go 1.22 changed `for` loop variable scoping so that each iteration has a
fresh copy of the loop variable. This fixes the long-standing pitfall:

```go
for _, tc := range cases {
    tc := tc // no longer needed in Go 1.22+
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        _ = tc
    })
}
```

The `tc := tc` shadowing line is unnecessary under `go 1.22` in `go.mod`.

## Return value

`Run` returns `true` if the subtest passed or skipped, `false` if it failed
before returning (including before calling `t.Parallel`). Callers rarely
inspect this value; failure is already recorded on the parent.

## TestMain interaction

`TestMain(m *testing.M)` runs once per package. It calls `m.Run()` which
executes all top-level tests; subtests are invoked inside those tests. There
is no separate hook for subtests at the `TestMain` level.

## Goroutine model

Each subtest runs in its own goroutine. The framework starts the
goroutine when `Run` is invoked, runs `f(child)` inside it, and arranges
for the parent to either block on completion (sequential subtests) or be
released early at `t.Parallel` (parallel subtests).

`t.FailNow`, `t.Fatal`, and similar calls invoke `runtime.Goexit`, which
terminates the subtest's goroutine cleanly. Cleanups still drain.

## Output buffering

Each `*T` accumulates output (`t.Log`, `t.Logf`, `t.Error`, etc.) in a
buffer. The buffer is flushed when the test ends, indented under the
test's `--- PASS`/`--- FAIL`/`--- SKIP` line. Output from parallel
subtests is therefore serialized at flush time, not at write time, which
keeps interleaving readable.

## Parent reference

Each `*T` holds a pointer to its parent's `common` struct. Failure
propagation works by atomically setting `failed = true` on each ancestor
up the chain. The race detector instruments this, so propagation is safe
under concurrent failures from parallel subtests.

## Subtests do not skip via panic

A panic in a subtest is recovered by the framework's `tRunner` and
reported as a failure (not a skip). To mark a subtest skipped, the
subtest must explicitly call `t.Skip`, `t.SkipNow`, or `t.Skipf`.

## `t.Cleanup` registration timing

`t.Cleanup` can be called any time before the test finishes. Cleanups
registered late (e.g., near the end of the test body) still run in LIFO
order: the most recently registered cleanup runs first.

If a cleanup itself calls `t.Cleanup`, the new cleanup is added to the
same stack and will run before the cleanups already drained. Practically,
this means: avoid registering cleanups from inside cleanups.

## Concurrent `Run` calls

`Run` is safe to call concurrently from goroutines belonging to the same
test, but doing so blurs the parent-child hierarchy. The conventional and
supported pattern is to call `Run` from the test's main goroutine.

## Filter precedence

When both `-run` and `-skip` are present:

1. A test runs if `-run` matches at every level.
2. A test is skipped if `-skip` matches at any level, regardless of
   `-run`.

`-skip` therefore takes precedence over `-run` for matching tests.

## Subtest count and `-list`

`go test -list '.*'` enumerates tests but does not descend into
subtests. To list subtests, you must actually run the package (perhaps
with `-run nothing` to avoid running them, but `t.Run` is invoked at
runtime so this requires running the parent).

## Reserved names

The framework does not reserve any subtest names, but the following
conventions hold:

- Avoid names starting with `Test`, `Benchmark`, `Example`, `Fuzz`: these
  prefixes are reserved for top-level test functions. Subtests under
  them are unaffected but readers may confuse them.
- Avoid `_` alone: rewrites to `_` and may collide.
- Avoid trailing whitespace: rewritten to `_`.

## Determinism

Subtest execution order is the order of `Run` calls in the parent's
body. There is no built-in shuffling at the subtest level (the
`-shuffle=on` flag shuffles top-level tests only).

## `(*B).Run` semantics

The benchmark counterpart `(*B).Run` follows the same structure but
runs the inner function for `b.N` iterations. Sub-benchmarks calibrate
their own `b.N` independently of the parent.

## Limits

- Maximum subtest depth: not formally bounded, but goroutine stack
  growth and bookkeeping costs make depths beyond 5-6 levels
  impractical.
- Maximum subtest name length: limited by Go string length (effectively
  unlimited), but names longer than 100 bytes are awkward in output.
- Maximum subtest count per parent: not formally bounded; practical
  limit is dictated by memory and runtime.

## Compatibility

`Run` has been available since Go 1.7. The semantics described here
have been stable. Notable refinements:

- Go 1.7: introduced.
- Go 1.14: `t.Cleanup` added.
- Go 1.17: `t.Setenv` added.
- Go 1.20: `-skip` flag added.
- Go 1.22: loop variable scoping changed (language-level, not
  testing-package change, but affects subtest patterns).
- Go 1.24: `t.Context()` added.

## Output verbs

In `-v` output:

- `=== RUN`: test or subtest started.
- `=== PAUSE`: test or subtest called `t.Parallel`.
- `=== CONT`: paused test or subtest resumed.
- `--- PASS`, `--- FAIL`, `--- SKIP`: terminal status with duration.

These verbs appear in both human-readable output and the underlying
JSON event stream (as `Action` fields).

## JSON event schema

The `-json` flag emits events with these fields per record:

```json
{
  "Time": "2026-01-01T00:00:00Z",
  "Action": "run",
  "Package": "example.com/pkg",
  "Test": "TestX/case",
  "Output": "...",
  "Elapsed": 0.123
}
```

For subtests, `Test` contains the full hierarchical name. The
`Action` field uses lowercased verbs: `run`, `pause`, `cont`,
`pass`, `fail`, `skip`, `output`.

## Filter syntax formal grammar

```
filter        := segment ('/' segment)*
segment       := regex
regex         := any RE2 regular expression
```

Each segment is unanchored unless explicitly anchored with `^...$`.
`-skip` uses the same grammar.

## Error semantics

`Run` returns `bool`:

- `true`: subtest passed or was paused (called `t.Parallel`).
- `false`: subtest failed before returning or before pausing.

The return value is informational; failure has already been
propagated to the parent's failure flag by the time `Run` returns.

## Safety guarantees

- Concurrent `Run` calls from the same test's goroutines are safe but
  unusual.
- Concurrent failure reports from parallel subtests are serialized by
  the framework's internal mutex.
- Output buffers are per-test; writes from different tests do not
  interleave.
- `t.Cleanup` registration is safe to call from the test's main
  goroutine or from cleanup callbacks (with caveat: cleanups
  registered during cleanup-drain run in LIFO with the rest).

## Subtest depth

The framework imposes no maximum nesting depth. Each level adds one
goroutine and one `*T`. Practically, depths beyond 5-6 are awkward
to filter, name, and reason about.

## Parent `t.Parallel` interaction with subtests

If the parent calls `t.Parallel`, the parent becomes eligible to run
in parallel with other top-level tests, but its subtests still run
according to their own `t.Parallel` calls. A parallel parent with
sequential subtests is valid: subtests run one after another in
declaration order, but the parent itself runs concurrently with
other parents.

## Test identifier format

The full test name is a `/`-joined path of segments:

```
TestName[/Sub[/SubSub...]]
```

Each segment is the `name` argument to `t.Run`, possibly normalized
(spaces to underscores, escapes for non-printable runes).
Disambiguation suffixes (`#01`, `#02`) are appended to segments
within a parent.

## TestMain return value

`TestMain` must call `os.Exit(m.Run())` (or equivalent). The exit
code from `m.Run()` reflects the aggregate test result: 0 for all
pass, non-zero if any test failed.

If `TestMain` is not defined, the framework provides a default that
just calls `os.Exit(m.Run())`.

## Cleanup error reporting

If a cleanup function panics, the test is marked failed (if not
already), and the remaining cleanups in the stack still run. The
panic is logged with the cleanup's registration site.

## Race detector interaction

When `-race` is set, the framework instruments shared accesses. A
race detected in a parallel subtest marks that subtest failed and
prints the goroutine trace. Race detection is independent of
subtests; the same rules apply to any concurrent code.

## Output ordering

Within a single test (parent or subtest), output is in the order it
was generated. Across tests, the framework serializes output by
test, flushing each test's buffer when the test ends. For parallel
subtests, this means output appears in completion order, not start
order.

---
layout: default
title: Subtests — Tasks
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/tasks/
---

# Subtests — Tasks

[← Back](../)

## Task 1: Table-driven with subtests

Given `func Reverse(s string) string`, write a single `TestReverse` that
uses `t.Run` for cases `empty`, `ascii`, `unicode`, `palindrome`.

```go
func TestReverse(t *testing.T) {
    cases := []struct {
        name, in, want string
    }{
        {"empty", "", ""},
        {"ascii", "abc", "cba"},
        {"unicode", "héllo", "olléh"},
        {"palindrome", "level", "level"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            if got := Reverse(tc.in); got != tc.want {
                t.Errorf("Reverse(%q)=%q want %q", tc.in, got, tc.want)
            }
        })
    }
}
```

Verify `go test -run TestReverse/unicode` runs only that subtest.

## Task 2: Filter with regex

Add cases named `ok_short`, `ok_long`, `bad_short`, `bad_long`. Write the
`-run` value that runs only the `bad_*` cases. Expected:
`go test -run 'TestReverse/^bad_'`.

## Task 3: Hierarchical names

Nest subtests two levels deep: outer by `category`, inner by `case`. Show
the full name printed under `-v` for `arith/add/positive`.

## Task 4: Convert four tests into subtests

Take four unrelated `TestParseInt`, `TestParseFloat`, `TestParseBool`,
`TestParseDate` and decide which (if any) should become subtests of a
common `TestParse`. Justify by shared setup or independent failure modes.

## Task 5: Parallel subtest matrix

Run the four cases from Task 1 in parallel. Confirm with a small
`time.Sleep(50*time.Millisecond)` inside each case that the wall-clock test
duration is ~50ms, not ~200ms, when `-parallel 4` is in effect.

## Task 6: Cleanup ordering check

Inside a subtest, register three `t.Cleanup`s that append to a slice owned
by the parent. Assert the order is LIFO when the subtest ends and that the
parent's cleanups run after all subtests.

## Task 7: Skip with reason

Write a subtest that calls `t.Skip("requires network")` when an env var is
unset. Ensure sibling subtests still run.

## Task 8: Reuse a fixture across subtests

Build a `*testServer` once in the parent and share it read-only across
parallel subtests. Use `t.Cleanup` on the parent to shut it down.

## Task 9: Failing one case in a table

Add an intentional failure to one of the table cases. Run with
`go test -v` and confirm:

- The failing subtest reports `--- FAIL`.
- Sibling subtests still run and report `--- PASS`.
- The parent reports `--- FAIL`.
- The exit code is non-zero.

## Task 10: Use `-skip` to exclude a slow case

Add a `slow_giant` case that takes 5 seconds to run. Show the command
that runs every case except `slow_giant`:

```
go test -run TestReverse -skip 'TestReverse/^slow_giant$'
```

Confirm with `-v` that `slow_giant` does not appear.

## Task 11: Predict cleanup order

Given this test, predict the print order:

```go
func TestOrder(t *testing.T) {
    t.Cleanup(func() { fmt.Println("parent A") })
    t.Cleanup(func() { fmt.Println("parent B") })
    t.Run("sub", func(t *testing.T) {
        t.Cleanup(func() { fmt.Println("sub A") })
        t.Cleanup(func() { fmt.Println("sub B") })
    })
}
```

Answer: `sub B`, `sub A`, `parent B`, `parent A`. LIFO within each
test, and the subtest drains before the parent.

## Task 12: Convert a switch-style test

Take this test and convert it to subtests:

```go
func TestKind(t *testing.T) {
    if got := Kind(0); got != "zero" {
        t.Errorf("Kind(0)=%q", got)
    }
    if got := Kind(-1); got != "negative" {
        t.Errorf("Kind(-1)=%q", got)
    }
    if got := Kind(1); got != "positive" {
        t.Errorf("Kind(1)=%q", got)
    }
}
```

Goal: each case becomes a subtest, so a failing case shows up by name.

## Task 13: Add `t.Helper` to your assertion helper

Write `assertEq[T comparable](t *testing.T, got, want T)` that calls
`t.Helper()` and `t.Errorf` on mismatch. Use it inside subtests and
verify the failure line in the output points to the subtest, not the
helper.

## Task 14: Run a specific failing subtest only

Given a test with cases `ok1`, `ok2`, `bad`, `ok3`, write the
`go test` command that:

a) Runs only `bad` in verbose mode.

b) Runs all `ok*` cases but not `bad`.

c) Runs the entire test except `bad`.

Answers:

a) `go test -v -run 'TestX/^bad$'`

b) `go test -v -run 'TestX/^ok'`

c) `go test -v -run TestX -skip 'TestX/^bad$'`

## Task 15: Use `t.TempDir` per subtest

Write a test that creates a temp file inside each subtest using
`t.TempDir()`. Verify that each subtest gets its own directory and that
all directories are deleted when the test ends.

## Task 16: Avoid the loop variable bug on Go 1.21

Write a parallel subtest that needs the `tc := tc` shadow on Go 1.21.
Then update `go.mod` to `go 1.22` and remove the shadow. Verify both
configurations pass.

## Task 17: Implement a custom `parallel` helper

Write a one-line helper:

```go
func parallel(t *testing.T, name string, f func(t *testing.T)) {
    t.Run(name, func(t *testing.T) {
        t.Parallel()
        f(t)
    })
}
```

Use it in a test and confirm the resulting `-v` output is identical to
hand-written `t.Run` + `t.Parallel`.

## Task 18: Verify failure propagation depth

Build a three-level test: `TestX` -> `groupA` -> `case1`. Make `case1`
fail and verify all three levels are marked FAIL in `-v` output.

## Task 19: Use sub-tests as a TODO list

Write a parent test with five subtest names, each calling `t.Skip("TODO")`.
Confirm CI shows `--- SKIP` for all five. Then implement one body and
verify only that one shows `--- PASS`.

## Task 20: Compute parallel speedup

Add `time.Sleep(50*time.Millisecond)` to each of four parallel
subtests. Measure wall-clock with `go test -v -run TestX`. Compare
with and without `t.Parallel`. Expect roughly 4x speedup.

## Task 21: Build a subtest from external data

Write a test that walks `testdata/*.input` files and creates one
subtest per file. The subtest name should be the filename without
extension. Read the corresponding `.golden` file and compare against
the function's output.

## Task 22: Generate a name from struct fields

For a case `tc := tc{a: 5, b: "x"}`, build the subtest name as
`a=5,b=x`. Verify the name appears correctly in `-v` output and that
`-run` can target it.

## Task 23: Refactor a 200-line test function

Take a 200-line test with sequential assertions:

```go
func TestParse(t *testing.T) {
    // 50 assertions ...
}
```

Convert it to a table-driven test with subtests. Aim for at most
5 lines per case body. Confirm the new structure still catches the
same failures.

## Task 24: Handle a flaky subtest

Write a subtest that fails 10% of the time. Use a retry helper:

```go
func retry(t *testing.T, attempts int, f func(*testing.T)) {
    for i := 0; i < attempts; i++ {
        ok := t.Run(fmt.Sprintf("attempt_%d", i), f)
        if ok { return }
    }
}
```

(Note: this is a teaching example; production code should fix flaky
tests, not retry them.)

## Task 25: Detect cleanup leakage

Register a cleanup in a subtest that increments a counter. After all
subtests finish, verify the counter equals the number of subtests
that ran.

## Task 26: Use generics for a table runner

Write a generic helper:

```go
func RunTable[Case any](t *testing.T, cases []Case, name func(Case) string, run func(*testing.T, Case))
```

Use it to run two unrelated tables. Confirm subtest names appear
correctly.

## Task 27: Demonstrate subtest skip cascade

Write a subtest that calls `t.Skip` based on a global flag. Run with
and without the flag set. Confirm only the affected subtest is
skipped.

## Task 28: Implement a TODO marker

Define a helper `t.TODO()` that calls `t.Skip("not yet implemented")`.
Use it in three subtests. Verify CI reports `--- SKIP` for each.

## Task 29: Combine `-run` and `-skip` in one invocation

Given a test with cases `fast`, `slow`, `bad`, `flaky`, write a
single `go test` command that runs all except `slow` and `flaky`.

Answer:

```
go test -run TestX -skip 'TestX/(slow|flaky)'
```

## Task 30: Reproduce the loop variable bug

On Go 1.21, write a parallel subtest that omits `tc := tc`. Run with
`-v`. Confirm all subtests log the same value (the last iteration).
Upgrade to Go 1.22 in `go.mod`. Re-run. Confirm each subtest logs
its own value.

## Task 31: Make a test fail explicitly

Write a subtest that fails via `t.Errorf` with a custom message
containing the input and expected output. Verify the failure message
includes both pieces of information when you run `-v`.

## Task 32: Detect ordering dependency

Write a parent test with two subtests, A and B, where B depends on a
variable set by A. Run `go test -run TestX/B` alone and observe the
failure. Refactor B to be independent.

## Task 33: Implement scenarios as sequential subtests

Write a test that simulates a 4-step user flow: register, login,
post, logout. Each step is a subtest. Verify they run in order and
that step N can use state from step N-1.

## Task 34: Compare two ways to share state

Write the same test twice:

a) Using a parent-scoped variable mutated by sequential subtests.

b) Using a helper function called from each subtest that sets up
   fresh state.

Discuss the trade-offs in a short comment.

## Task 35: Use `t.Helper` and verify line numbers

Write a helper that fails on a comparison. Call it from a subtest.
Run `-v` and check that the failure's file:line points to the
subtest's call, not the helper.

## Task 36: Combine `t.Run` with generics

Write a generic table runner:

```go
type Case[I, O any] struct {
    Name string
    In   I
    Want O
}

func RunCases[I, O comparable](t *testing.T, cases []Case[I, O], fn func(I) O) {
    t.Helper()
    for _, c := range cases {
        c := c
        t.Run(c.Name, func(t *testing.T) {
            if got := fn(c.In); got != c.Want {
                t.Errorf("got %v, want %v", got, c.Want)
            }
        })
    }
}
```

Use it with two different functions.

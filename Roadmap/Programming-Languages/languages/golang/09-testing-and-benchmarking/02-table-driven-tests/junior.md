---
layout: default
title: Table-Driven Tests — Junior
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/junior/
---

# Table-Driven Tests — Junior

[← Back](../)

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Problem We Are Solving](#the-problem-we-are-solving)
5. [Your First Table-Driven Test](#your-first-table-driven-test)
6. [Why Each Field Exists](#why-each-field-exists)
7. [`t.Run` and Subtests](#trun-and-subtests)
8. [Subtest Naming Conventions](#subtest-naming-conventions)
9. [Running One Row from the Command Line](#running-one-row-from-the-command-line)
10. [The `tc := tc` Story](#the-tc--tc-story)
11. [Go 1.22 Loop Scope Change](#go-122-loop-scope-change)
12. [Reading Failure Output](#reading-failure-output)
13. [Adding a New Case](#adding-a-new-case)
14. [Negative Cases — `wantErr`](#negative-cases--wanterr)
15. [Slice vs Map Tables](#slice-vs-map-tables)
16. [Common Mistakes](#common-mistakes)
17. [What to Read Next](#what-to-read-next)
18. [Self-Check](#self-check)

---

## Introduction

A **table-driven test** is the most common way to write tests in Go. Instead of writing five test functions for five cases of the same behavior, you write **one** test function that loops through a slice of cases, where each case carries its inputs and expected outputs.

In this file you will:

- See the canonical pattern step by step.
- Learn why Go programmers prefer this over BDD-style frameworks.
- Understand `t.Run` and what subtest names look like.
- Learn the historical `tc := tc` line and what changed in Go 1.22.

You do **not** need to know anything beyond `func TestX(t *testing.T)` and `go test`. We start from zero.

---

## Prerequisites

- You can write a basic test:

```go
package mymath

import "testing"

func TestAdd(t *testing.T) {
    got := Add(2, 3)
    if got != 5 {
        t.Errorf("Add(2,3) = %d, want 5", got)
    }
}
```

- You know how to run `go test` and `go test -v` in a package.
- You know what a `struct` and a `slice` are.

If any of those is unfamiliar, read `01-testing-basics` first.

---

## Glossary

- **Test case** — one row of inputs and expected outputs. Sometimes called a "case", a "row", or a "scenario".
- **Test function** — the top-level `func TestX(t *testing.T)` that the `go test` tool finds and runs.
- **Subtest** — a nested test created with `t.Run(name, func(t *testing.T) { ... })`. Appears in output as `TestX/name`.
- **Assertion** — a comparison between an actual value (`got`) and an expected value (`want`), typically using `t.Errorf` or `t.Fatalf`.
- **Table** — the slice (or map) of test cases. Almost always written as `[]struct{ name, in, want ... }`.
- **`got` and `want`** — the conventional variable names in Go tests for "what we got" and "what we expected".

---

## The Problem We Are Solving

Suppose you wrote a function:

```go
package mymath

// Abs returns the absolute value of n.
func Abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}
```

A naive test suite looks like this:

```go
func TestAbs_positive(t *testing.T) {
    if got := Abs(5); got != 5 {
        t.Errorf("Abs(5) = %d, want 5", got)
    }
}

func TestAbs_negative(t *testing.T) {
    if got := Abs(-7); got != 7 {
        t.Errorf("Abs(-7) = %d, want 7", got)
    }
}

func TestAbs_zero(t *testing.T) {
    if got := Abs(0); got != 0 {
        t.Errorf("Abs(0) = %d, want 0", got)
    }
}
```

Three problems:

1. **Duplication.** The same assertion shape (`Abs(x) = got, want X`) repeats three times. Adding a fourth case means copy-pasting a fourth function and renaming.
2. **Cluttered file.** As soon as you have 20 cases, the file is 200 lines of mostly-identical scaffolding.
3. **Hard to scan.** To answer "what inputs are tested?", you have to read every function body.

Table-driven tests fix all three.

---

## Your First Table-Driven Test

Here is the same `Abs` function tested as a table:

```go
package mymath

import "testing"

func TestAbs(t *testing.T) {
    cases := []struct {
        name string
        in   int
        want int
    }{
        {"positive", 5, 5},
        {"negative", -7, 7},
        {"zero", 0, 0},
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := Abs(tc.in)
            if got != tc.want {
                t.Errorf("Abs(%d) = %d, want %d", tc.in, got, tc.want)
            }
        })
    }
}
```

Run it:

```
$ go test -v
=== RUN   TestAbs
=== RUN   TestAbs/positive
=== RUN   TestAbs/negative
=== RUN   TestAbs/zero
--- PASS: TestAbs (0.00s)
    --- PASS: TestAbs/positive (0.00s)
    --- PASS: TestAbs/negative (0.00s)
    --- PASS: TestAbs/zero (0.00s)
PASS
ok      example.com/mymath  0.001s
```

Every row appears as its own subtest with its own name. Adding a fourth case is one line:

```go
{"large negative", -1_000_000, 1_000_000},
```

That's it. The duplication is gone, the scaffolding is one loop, and every input/output pair is visible at a glance.

---

## Why Each Field Exists

The struct has three fields. Let's understand each one.

### `name string` — the case label

This becomes the subtest's name. Without `name`, the output is just `TestAbs` and you can't tell which row failed.

A good name describes the **intent** of the case, not the input itself:

- Good: `"positive"`, `"large_negative"`, `"max_int"`.
- Less good: `"5"`, `"-7"`, `"abs_of_negative_one"` (too long, redundant).

### `in int` — the input

What you pass to the function under test. Field names vary by convention: `in`, `input`, `args`. If your function takes multiple parameters, use `args` and put a sub-struct, or have separate fields:

```go
cases := []struct {
    name   string
    a, b   int
    want   int
}{
    {"both positive", 2, 3, 5},
    {"with zero",     0, 7, 7},
}
```

### `want int` — the expected output

What you expect the function to return. Field names vary: `want`, `expected`. The Go community prefers `want` because it pairs naturally with `got`.

---

## `t.Run` and Subtests

The `t.Run` function — added in Go 1.7 (August 2016) — creates a **subtest**. Its signature:

```go
func (t *T) Run(name string, f func(t *testing.T)) bool
```

When you call `t.Run("positive", subFunc)` inside `TestAbs`, Go:

1. Creates a new `*testing.T` for the subtest.
2. Runs `subFunc(newT)` in a goroutine.
3. Blocks the parent until the subtest completes (unless the subtest calls `t.Parallel`).
4. Reports the subtest's result with the name `TestAbs/positive`.

If the subtest calls `t.Errorf`, only **that subtest** fails. The parent test continues, and the other subtests still run. This is the whole point of using `t.Run` instead of just looping.

Without `t.Run`:

```go
for _, tc := range cases {
    got := Abs(tc.in)
    if got != tc.want {
        t.Errorf("[%s] Abs(%d) = %d, want %d", tc.name, tc.in, got, tc.want)
    }
}
```

This still works, but:

- All cases run inside the same test, so you can't use `-run TestAbs/positive` to run one row.
- A `t.Fatalf` in one row stops the whole test, not just the row.
- Output is less structured.

The `t.Run` version is uniformly better. Use it.

---

## Subtest Naming Conventions

Conventions evolved from the standard library and large Go codebases:

1. **Lowercase, snake_case or hyphen-case.** `"empty_input"`, `"already-clean"`. Avoid spaces — Go rewrites them to underscores in output anyway.
2. **Describe the case, not the input.** `"trailing_whitespace"` is better than `"hello___"`.
3. **Keep short.** Subtest names show up in CI logs; keep them under ~30 characters.
4. **Prefix for grouping.** If your table covers multiple categories, prefix: `"email/valid_simple"`, `"email/invalid_no_at"`, `"phone/valid_us"`. The slash adds another subtest level for `-run` filtering.
5. **Use the input itself only if short and unique.** For string tables, `tc.in` is often the natural name:

```go
t.Run(tc.in, func(t *testing.T) { ... })
```

This works until you have two rows with the same `in` (then Go suffixes the duplicates with `#01`, `#02` — see "Common Mistakes").

---

## Running One Row from the Command Line

A huge benefit of `t.Run` is **filtering**. Suppose your 50-row test for `Abs` has a flaky case `large_negative`. Run only that one:

```
go test -run TestAbs/large_negative
```

The `-run` flag is a regex. Its semantics for slash-separated names:

- Split by `/` into segments.
- Each segment is a substring regex against the corresponding name level.
- So `-run TestAbs/large` matches `TestAbs/large_negative` and `TestAbs/large_positive`.
- To anchor exactly: `-run '^TestAbs$/^large_negative$'`.

You will use `-run` daily when debugging a specific case. Get comfortable.

---

## The `tc := tc` Story

This pattern is **historical** in Go versions before 1.22. You will see it in older code and need to recognize it.

The problem: in Go versions before 1.22, a `for ... range` loop reused the **same** loop variable across iterations:

```go
// Go 1.21 and earlier
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // bug: by the time this runs, tc holds the LAST row
    })
}
```

When the subtest had `t.Parallel()`, it didn't run immediately — it paused, the loop kept iterating, `tc` got overwritten, and by the time the parallel goroutine actually executed, `tc` was the last row. Every parallel subtest tested the same row.

The fix: **shadow `tc` with a per-iteration copy** by declaring a new variable with the same name:

```go
for _, tc := range cases {
    tc := tc // new variable, scoped to this iteration
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // now safe: tc is a fresh variable per iteration
    })
}
```

This is **not magic**. It's just creating a new local variable that copies the current loop variable's value. The closure captures the new local, not the shared loop variable.

You will see `tc := tc` (and also `i := i`, `name := name`, `row := row`) all over older Go code. It is one of the most common idioms that confuses newcomers.

---

## Go 1.22 Loop Scope Change

Go 1.22 (released February 2024) changed the rule. In Go 1.22+, **each iteration of a `for ... range` loop has its own copy of the loop variable**. So:

```go
// Go 1.22+ modules (go.mod declares "go 1.22" or higher)
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // safe — tc is per-iteration
    })
}
```

This works because the language itself now does what `tc := tc` used to do manually.

How do you know which behavior you have? Check `go.mod`:

```
module example.com/mypkg

go 1.22
```

If the `go` line is `1.22` or higher, the new behavior applies. If it's `1.21` or lower, the old behavior applies and you need `tc := tc`.

The change came from [issue 60078](https://github.com/golang/go/issues/60078). It was discussed for years before landing. In 2026 you can mostly forget about it, but in legacy codebases (and old StackOverflow answers) the `tc := tc` pattern is everywhere.

Linters: `copyloopvar` (built into `vet` in recent Go versions) flags `tc := tc` shadows as redundant in Go 1.22+ modules. The flag is a suggestion to delete the line.

---

## Reading Failure Output

When a subtest fails, you see:

```
=== RUN   TestAbs
=== RUN   TestAbs/positive
=== RUN   TestAbs/negative
    abs_test.go:18: Abs(-7) = -7, want 7
=== RUN   TestAbs/zero
--- FAIL: TestAbs (0.00s)
    --- PASS: TestAbs/positive (0.00s)
    --- FAIL: TestAbs/negative (0.00s)
    --- PASS: TestAbs/zero (0.00s)
FAIL
```

Three things to notice:

1. **The failing subtest is named.** `TestAbs/negative` tells you exactly which row.
2. **The error message includes the input.** That's why we wrote `Abs(%d) = %d, want %d` instead of just `mismatch`. **Always include the input in failure messages.**
3. **Other subtests still ran.** `TestAbs/zero` passed even though `TestAbs/negative` failed. This is the value of `t.Run` over a flat loop.

---

## Adding a New Case

The win of table-driven tests is that adding a case is **one line**. Suppose someone reports `Abs(math.MinInt32)` returns the wrong value (it's a classic overflow bug). To add a regression test:

```go
{"min_int32", math.MinInt32, math.MaxInt32}, // BUG: actually returns MinInt32
```

That's the whole change. Compile, run:

```
go test -v -run TestAbs/min_int32
```

You'll see the failure. Now fix `Abs`, rerun, watch it pass. The new case stays in the table forever, protecting against regression.

This low cost of adding cases is why table-driven tests **encourage thorough coverage**. With duplicated functions, adding a case is a chore. With a table, it's a habit.

---

## Negative Cases — `wantErr`

Many functions return `(value, error)`. To test them, add a `wantErr` field:

```go
func TestParseInt(t *testing.T) {
    cases := []struct {
        name    string
        in      string
        want    int
        wantErr bool
    }{
        {"positive", "42", 42, false},
        {"negative", "-7", -7, false},
        {"empty", "", 0, true},
        {"junk", "abc", 0, true},
        {"too_large", "999999999999999999999", 0, true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := ParseInt(tc.in)
            if (err != nil) != tc.wantErr {
                t.Fatalf("ParseInt(%q) error = %v, wantErr = %v", tc.in, err, tc.wantErr)
            }
            if !tc.wantErr && got != tc.want {
                t.Errorf("ParseInt(%q) = %d, want %d", tc.in, got, tc.want)
            }
        })
    }
}
```

The key line is `if (err != nil) != tc.wantErr` — a compact way to assert "got an error iff we expected one". If `wantErr` is `true` and `err` is non-nil, the condition is `true != true → false`, no failure. If `wantErr` is `false` but `err` is non-nil, the condition is `true != false → true`, fail.

The middle file will show how to assert on **which** error you got (`errors.Is`, `errors.As`), not just "any error". For now, the boolean form is fine.

---

## Slice vs Map Tables

Most tables are slices. Sometimes you'll see maps:

```go
cases := map[string]struct {
    in   int
    want int
}{
    "positive": {5, 5},
    "negative": {-7, 7},
    "zero":     {0, 0},
}
for name, tc := range cases {
    t.Run(name, func(t *testing.T) {
        got := Abs(tc.in)
        if got != tc.want {
            t.Errorf("Abs(%d) = %d, want %d", tc.in, got, tc.want)
        }
    })
}
```

Differences:

- **Map**: keys are the names. If two cases have the same name, the second overwrites the first — a small safety net against name collisions. But you can also accidentally delete a case this way.
- **Map**: iteration order is **randomized**. Each run, the cases run in a different order. This can surface bugs that depend on execution order, but it can also make output harder to scan.
- **Slice**: deterministic order. Easier to reason about.

Junior advice: **use slices**. They're simpler. You'll occasionally see maps in the wild; recognize them but don't use them as your default.

---

## Common Mistakes

### Mistake 1 — forgetting `tc := tc` in old Go

If your `go.mod` says `go 1.21` or older and your table uses `t.Parallel()`, you must shadow:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        ...
    })
}
```

Without the shadow, every parallel subtest sees the last row.

### Mistake 2 — duplicate case names

```go
cases := []struct{ name string; in, want int }{
    {"big", 100, 100},
    {"small", 1, 1},
    {"big", -100, 100}, // oops, same name
}
```

Go disambiguates the second `"big"` with `#01`: `TestAbs/big`, `TestAbs/big#01`. Failures on `TestAbs/big#01` are hard to map back. Always pick unique names.

### Mistake 3 — generic failure messages

```go
if got != tc.want {
    t.Errorf("fail")
}
```

This tells you nothing. Include `tc.in`, `got`, `tc.want`:

```go
if got != tc.want {
    t.Errorf("Abs(%d) = %d, want %d", tc.in, got, tc.want)
}
```

Or use `tc.name` as a fallback if the input is complex:

```go
t.Errorf("[%s] mismatch: got %v, want %v", tc.name, got, tc.want)
```

### Mistake 4 — `t.Fatal` outside `t.Run`

```go
func TestX(t *testing.T) {
    db, err := openDB()
    if err != nil { t.Fatal(err) }  // OK — aborts whole test, makes sense if DB is required
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            row, err := db.Query(tc.in)
            if err != nil { t.Fatal(err) }  // OK — only aborts this subtest
            ...
        })
    }
}
```

`t.Fatal` aborts the **current** test (the parent if called outside `t.Run`, the subtest if inside). Used carelessly outside `t.Run`, it can hide failures across rows.

### Mistake 5 — comparing in wrong order

```go
// Wrong direction in failure message
t.Errorf("Abs(%d) = %d, want %d", tc.in, tc.want, got)
//                                  ^^^^^^^^   ^^^
//                                  swapped
```

Convention: `got` first, `want` second.

### Mistake 6 — relying on package state

```go
var counter int

func TestCounter(t *testing.T) {
    cases := []struct{ inc int; want int }{
        {1, 1},
        {2, 3},
        {3, 6},
    }
    for _, tc := range cases {
        t.Run(fmt.Sprint(tc.inc), func(t *testing.T) {
            counter += tc.inc
            if counter != tc.want { t.Errorf(...) }
        })
    }
}
```

This works as long as the rows run in order. Add `t.Parallel`, run with `-shuffle on`, or someone else's test mutates `counter` — it breaks. Avoid shared mutable state in tables.

### Mistake 7 — assuming map order

If you use a map table and rely on a particular order, you have a bug. Maps don't guarantee order. Use a slice if order matters.

---

## What to Read Next

- [Middle](../middle/) — `-run` regex, parallel tables, helpers, golden files.
- [Senior](../senior/) — designing tables for complex domains, matrix tests, nested tables.
- [Find the Bug](../find-bug/) — practice diagnosing broken table-driven tests.
- [Tasks](../tasks/) — hands-on exercises.

---

## Self-Check

Try answering each without re-reading:

1. What's the difference between using `t.Run` inside a loop and just looping?
2. What does `tc := tc` do, and why is it (mostly) unnecessary in Go 1.22+?
3. How do you run only one row of a table from the command line?
4. Why is `t.Errorf("fail")` a bad assertion message?
5. What's wrong with using a map for a table where rows depend on each other?

If any of these stumped you, re-read the corresponding section before moving on.

---

## Worked Example — Testing a `Reverse` Function

Let's apply everything you just learned to a complete example.

The function:

```go
// Reverse returns s reversed.
func Reverse(s string) string {
    r := []rune(s)
    for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
        r[i], r[j] = r[j], r[i]
    }
    return string(r)
}
```

The naive test:

```go
func TestReverse(t *testing.T) {
    if got := Reverse("hello"); got != "olleh" {
        t.Errorf("Reverse(hello) = %q, want %q", got, "olleh")
    }
}
```

That's one case. Five lines for one input. Let's table-drive it:

```go
func TestReverse(t *testing.T) {
    cases := []struct {
        name string
        in   string
        want string
    }{
        {"empty",       "",         ""},
        {"single",      "a",        "a"},
        {"two_chars",   "ab",       "ba"},
        {"english",     "hello",    "olleh"},
        {"palindrome",  "level",    "level"},
        {"with_space",  "go go",    "og og"},
        {"unicode",     "héllo",    "olléh"},
        {"emoji",       "🚀x🚀",   "🚀x🚀"},
        {"mixed",       "a1b2c3",   "3c2b1a"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := Reverse(tc.in)
            if got != tc.want {
                t.Errorf("Reverse(%q) = %q, want %q", tc.in, got, tc.want)
            }
        })
    }
}
```

Look at what we got:

- Nine cases in ~15 lines (vs ~45 lines as nine functions).
- Each case is one line of `(name, input, expected)`.
- Failures clearly identify the row (`TestReverse/unicode`).
- Adding a tenth case is one line.

Run it:

```
$ go test -v
=== RUN   TestReverse
=== RUN   TestReverse/empty
=== RUN   TestReverse/single
=== RUN   TestReverse/two_chars
=== RUN   TestReverse/english
=== RUN   TestReverse/palindrome
=== RUN   TestReverse/with_space
=== RUN   TestReverse/unicode
=== RUN   TestReverse/emoji
=== RUN   TestReverse/mixed
--- PASS: TestReverse (0.00s)
    --- PASS: TestReverse/empty (0.00s)
    --- PASS: TestReverse/single (0.00s)
    ...
```

Now, suppose someone reports a bug: `Reverse("café")` returns `"éfac"` correctly, but a contributor adds a "byte-level" implementation that breaks it. Add a regression case:

```go
{"accent_at_end", "café", "éfac"},
```

Run only the new case to verify:

```
$ go test -v -run TestReverse/accent_at_end
```

Done. The new test is permanent.

---

## Walking Through `t.Run` Mechanics

Let's slow down and trace exactly what happens when you call `t.Run("hello", subFunc)` inside `TestReverse`.

### Step 1: A new `*testing.T` is created

The parent `t` (the one passed to `TestReverse`) is the **top-level** test handle. When you call `t.Run`, Go creates a fresh `*testing.T` for the subtest. Inside `subFunc`, the parameter `t` refers to this new handle, not the parent.

### Step 2: A goroutine is spawned

The new subtest runs in its own goroutine. This is invisible to you but matters because it means the subtest can call `t.Parallel` (which only works in a goroutine other than the parent's).

### Step 3: The parent blocks

Despite the goroutine, the call `t.Run(...)` **blocks** the parent until `subFunc` returns (or calls `t.Parallel`). So you can think of sequential subtests as "synchronous" from the caller's view.

### Step 4: Failures propagate to the parent

If `subFunc` calls `t.Errorf`, the **subtest** is marked failed. The parent isn't automatically failed, but `t.Run` returns `false`, and the parent's overall status will reflect that a subtest failed.

### Step 5: Cleanup runs

Anything registered with `t.Cleanup` inside the subtest body runs when the subtest's goroutine ends.

---

## When You Should Skip Table-Driven (At This Level)

There are a few cases where a table is overkill or wrong. As a junior, you don't need to refactor your way out of every duplicated test, but recognize:

1. **One case.** If you'll only ever have one input, just write the function. No table needed.
2. **Two trivial cases.** Borderline. If a third case is likely, table; if not, two functions.
3. **Wildly different cases.** If case A needs three setup files and case B needs a network mock and case C needs nothing, the table starts carrying a lot of conditional logic. Three separate functions are simpler.

A rule of thumb: **when in doubt, write the table**. Adding rows is cheap; merging back from separate functions is expensive.

---

## Tips for Naming Your Table

I introduce one more nuance here because it's easy to overlook.

### Use describe-the-case naming, not echo-the-input

Bad: `{"hello", "hello", "olleh"}` — the name is just the input, which is redundant.

Better: `{"english_word", "hello", "olleh"}` — the name tells you why this case exists.

Best (when the input itself is meaningful): `{"5_char_english", "hello", "olleh"}` — names capture the case's intent.

### Group prefix

If you have rows that cover related behaviors, prefix them:

```go
{"empty/string",        "",      ""},
{"empty/just_spaces",   "   ",   "   "},
{"alpha/lower",         "abc",   "cba"},
{"alpha/upper",         "ABC",   "CBA"},
{"alpha/mixed",         "AbC",   "CbA"},
```

The slashes create another subtest level: `TestReverse/empty/string`, `TestReverse/alpha/lower`. Now `-run TestReverse/alpha` runs all alpha cases. This is the simplest form of nested subtests — you'll see the full nested form (with literal `t.Run` inside `t.Run`) in the middle file.

### Don't include trivia in the name

`{"this_is_case_42_from_the_old_test_suite", ...}` — too long, the history isn't useful in the name. Put history in a comment if you must:

```go
// preserved from legacy_test.go to catch regression of #1234
{"empty_input", "", ""},
```

---

## A Bigger Example — Validating a Form

Real production code rarely tests pure functions like `Abs` or `Reverse`. More realistic: a form validator.

```go
type Form struct {
    Name    string
    Email   string
    Age     int
}

func (f *Form) Validate() error {
    if f.Name == "" {
        return errors.New("name is required")
    }
    if len(f.Name) > 100 {
        return errors.New("name too long")
    }
    if !strings.Contains(f.Email, "@") {
        return errors.New("email is invalid")
    }
    if f.Age < 0 || f.Age > 150 {
        return errors.New("age out of range")
    }
    return nil
}
```

Test it with a table:

```go
func TestForm_Validate(t *testing.T) {
    cases := []struct {
        name    string
        form    Form
        wantErr bool
    }{
        {
            name: "all_valid",
            form: Form{Name: "Ada", Email: "ada@example.com", Age: 30},
            wantErr: false,
        },
        {
            name:    "empty_name",
            form:    Form{Email: "ada@example.com", Age: 30},
            wantErr: true,
        },
        {
            name:    "name_too_long",
            form:    Form{Name: strings.Repeat("a", 101), Email: "ada@example.com", Age: 30},
            wantErr: true,
        },
        {
            name:    "email_no_at",
            form:    Form{Name: "Ada", Email: "adaexample.com", Age: 30},
            wantErr: true,
        },
        {
            name:    "negative_age",
            form:    Form{Name: "Ada", Email: "ada@example.com", Age: -5},
            wantErr: true,
        },
        {
            name:    "age_too_high",
            form:    Form{Name: "Ada", Email: "ada@example.com", Age: 200},
            wantErr: true,
        },
        {
            name:    "boundary_age_zero",
            form:    Form{Name: "Ada", Email: "ada@example.com", Age: 0},
            wantErr: false,
        },
        {
            name:    "boundary_age_150",
            form:    Form{Name: "Ada", Email: "ada@example.com", Age: 150},
            wantErr: false,
        },
        {
            name:    "boundary_name_100_chars",
            form:    Form{Name: strings.Repeat("a", 100), Email: "ada@example.com", Age: 30},
            wantErr: false,
        },
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            err := tc.form.Validate()
            if (err != nil) != tc.wantErr {
                t.Errorf("Validate() error = %v, wantErr = %v", err, tc.wantErr)
            }
        })
    }
}
```

Things to notice:

- Nine cases covering happy paths, edge cases, and boundaries.
- One **happy path** (`all_valid`) plus several **negative cases** (each broken field).
- Three **boundary cases** that test the edges of allowed ranges (`Age == 0`, `Age == 150`, `Name == 100 chars`). These are crucial — bugs hide at boundaries.
- Each case takes one line of struct literal. Adding a tenth boundary case is one more line.

This table covers the validator more thoroughly than 9 hand-written test functions ever would, because the cost of adding a case is so low that you actually do it.

---

## Why Table-Driven Wins for Coverage

Coverage isn't just about line coverage (what code ran) — it's about **case coverage** (what scenarios you've considered). Hand-written tests fall into "wrote three, called it done" patterns because each test costs ~10 lines of scaffolding. Table-driven tests cost one line per case, which encourages thinking through:

- Happy paths.
- Empty inputs.
- Boundary values.
- Off-by-one inputs.
- Inputs that previously caused bugs.
- Inputs from real production traces.

A well-designed table can have 30 rows for a function that, by hand, you'd write three tests for. That's not over-testing — that's appropriate coverage of the input space.

---

## Field Order Conventions

When designing the row struct, put fields in **reading order**:

1. **Name** first — humans scan top-to-bottom, the name anchors the row.
2. **Inputs** next — what we feed in.
3. **Expected outputs** next — what we expect out.
4. **Expected errors** last — error expectations come after value expectations.

```go
// Good order
type row struct {
    name    string
    input   string
    want    int
    wantErr bool
}

// Less idiomatic
type row struct {
    wantErr bool   // assertion before inputs?
    name    string
    want    int
    input   string
}
```

This is convention, not law, but it's how the stdlib writes its tables and it's what reviewers expect.

---

## `t.Fatalf` vs `t.Errorf` Inside a Subtest

Both mark the test as failed. The difference:

- `t.Errorf` continues executing the rest of the subtest body.
- `t.Fatalf` returns from the subtest body immediately.

Use `t.Fatalf` when continuing would be useless or unsafe:

```go
t.Run(tc.name, func(t *testing.T) {
    f, err := os.Open(tc.path)
    if err != nil {
        t.Fatalf("open: %v", err)  // can't continue without f
    }
    defer f.Close()

    info, err := f.Stat()
    if err != nil {
        t.Errorf("stat: %v", err)  // can still continue with f
    }
    if info != nil && info.Size() != tc.wantSize {
        t.Errorf("size = %d, want %d", info.Size(), tc.wantSize)
    }
})
```

Two `t.Errorf` calls can both fire in one subtest, producing two error lines. A `t.Fatalf` stops at the first failure.

A common pattern: use `t.Fatalf` for setup failures, `t.Errorf` for assertion failures.

---

## A Quick Tour of `testing.TB`

`testing.TB` is an interface that both `*testing.T` and `*testing.B` satisfy. Use it when writing a helper that should work for both tests and benchmarks:

```go
func loadFixture(tb testing.TB, name string) []byte {
    tb.Helper()
    b, err := os.ReadFile("testdata/" + name)
    if err != nil {
        tb.Fatal(err)
    }
    return b
}

// Now usable in both:
func TestX(t *testing.T)      { data := loadFixture(t, "x.json"); ... }
func BenchmarkX(b *testing.B) { data := loadFixture(b, "x.json"); ... }
```

You won't write a lot of these as a junior, but you'll see them in stdlib and third-party packages.

---

## More Failure-Message Patterns

Your failure messages are the documentation that fires when something breaks. Here are conventions worth memorizing.

### The full "got = X, want Y" form

```go
t.Errorf("Reverse(%q) = %q, want %q", tc.in, got, tc.want)
```

This is the gold standard. Reader gets the function call, the actual result, the expected result. No need to open the source to understand the failure.

### Long-form for complex inputs

```go
t.Errorf("Process(\n  user=%+v,\n  orders=%+v,\n) = %+v, want %+v",
    tc.user, tc.orders, got, tc.want)
```

Multi-line is OK when single-line would wrap awkwardly. The leading newlines and indentation help structure the output.

### Error-only assertions

```go
if err == nil {
    t.Errorf("Process(%v): err = nil, want error", tc.in)
}
```

When you expect an error, include the input but no need for `got`.

### Skipping in a row

```go
if testing.Short() {
    t.Skipf("skipping in -short mode: %s", tc.name)
}
```

`Skipf` records why the row was skipped — visible in `-v` output.

---

## Reading `go test` Verbose Output

Run `go test -v` on a real test file and study the output carefully. Key markers:

- `=== RUN   TestName` — top-level test starting.
- `=== RUN   TestName/sub` — subtest starting.
- `=== PAUSE TestName/sub` — subtest paused via `t.Parallel`.
- `=== CONT  TestName/sub` — paused subtest resumed.
- `=== NAME  TestName/sub` — output associated with this subtest follows.
- `    file_test.go:42: message` — `t.Log/t.Error/t.Fatal` output (indented).
- `--- PASS: TestName/sub (0.00s)` — subtest passed.
- `--- FAIL: TestName/sub (0.00s)` — subtest failed.
- `--- SKIP: TestName/sub (0.00s)` — subtest skipped.
- `PASS` / `FAIL` — overall package result.

If a row prints `--- FAIL`, the lines above it (indented, with file:line prefix) are the failure messages — the output of your `t.Errorf` and `t.Logf` calls.

In parallel tests, `PAUSE`/`CONT` markers tell you when each subtest paused and resumed. Use these to debug ordering questions.

---

## Tip — Using `testing.Short` to Tier Tests

`testing.Short()` returns true when `go test -short` is passed. You can mark slow rows or slow tests:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        if testing.Short() && tc.slow {
            t.Skip("slow case skipped in -short mode")
        }
        ...
    })
}
```

This gives developers a fast feedback loop locally (`go test -short`) while preserving full coverage in CI (`go test`).

A common convention: top-level CI runs without `-short`; developer save-loop runs with `-short`.

---

## Tip — Failing Fast vs Failing All

Inside a single subtest, you can fail fast (`t.Fatal`) or keep going (`t.Errorf`):

- `t.Errorf` records the failure and continues. Two assertions can both fail in one subtest, producing two error lines.
- `t.Fatalf` records the failure and stops the subtest.

For tables, fail fast on **setup** and accumulate failures on **assertions**:

```go
t.Run(tc.name, func(t *testing.T) {
    parsed, err := Parse(tc.in)
    if err != nil { t.Fatalf("parse: %v", err) }       // setup; fail fast

    if parsed.Name != tc.wantName { t.Errorf("name = %s, want %s", parsed.Name, tc.wantName) }
    if parsed.Age != tc.wantAge   { t.Errorf("age = %d, want %d", parsed.Age, tc.wantAge) }
    if parsed.Email != tc.wantEmail { t.Errorf("email = %s, want %s", parsed.Email, tc.wantEmail) }
})
```

If the parse fails, the subtest stops — the field checks would be meaningless on a nil result. But if parse succeeds and two of three fields are wrong, both are reported in one run, saving a developer round-trip.

---

## A Tiny Style Note — Single-Letter `tc` vs Spelled-Out `tt`

You'll see both:

```go
for _, tc := range cases { ... }   // "test case"
for _, tt := range cases { ... }   // "test table"
```

`tc` is more common in modern code; `tt` is older and is the convention in the Go stdlib's own tests. Both are fine — pick one and use it consistently in your codebase. Some linters can enforce uniformity.

---

## A Complete Worked Example — Email Validator

Let's walk one more complete example end-to-end. The function:

```go
// IsValidEmail returns true if s is a syntactically valid email.
func IsValidEmail(s string) bool {
    if s == "" { return false }
    at := strings.Index(s, "@")
    if at < 1 { return false }                       // no @, or starts with @
    if at == len(s)-1 { return false }               // ends with @
    if strings.Count(s, "@") > 1 { return false }    // multiple @
    domain := s[at+1:]
    if !strings.Contains(domain, ".") { return false } // no TLD
    return true
}
```

Naive testing: three or four functions, copy-pasted.

Table-driven testing: one function with a thoughtful spread of cases.

```go
func TestIsValidEmail(t *testing.T) {
    cases := []struct {
        name string
        in   string
        want bool
    }{
        // Happy paths
        {"simple",            "a@b.co",                 true},
        {"with_dots",         "first.last@example.com", true},
        {"plus_addressing",   "a+tag@example.com",      true},
        {"subdomain",         "a@mail.example.co.uk",   true},
        {"numbers",           "user123@example.com",    true},

        // Negative — empty / minimal
        {"empty",             "",                        false},
        {"just_at",           "@",                       false},
        {"only_local",        "a",                       false},
        {"only_domain",       "@example.com",            false},
        {"trailing_at",       "a@",                      false},

        // Negative — structural
        {"no_at",             "no_at_here.example.com",  false},
        {"two_ats",           "a@b@c.com",               false},
        {"no_dot_in_domain",  "a@nodomain",              false},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := IsValidEmail(tc.in)
            if got != tc.want {
                t.Errorf("IsValidEmail(%q) = %v, want %v", tc.in, got, tc.want)
            }
        })
    }
}
```

Count the rows: 13 cases. Each case is one line. Adding a 14th — say a regression case for an internationalized email — is one more line.

This is how mature Go codebases look. Read the stdlib's `net/mail` package tests for a deeper example of the same shape.

---

## Final Tip — Don't Over-Engineer

You'll be tempted, after reading all of this, to apply every pattern to every test. Don't.

- A function with one obvious use case doesn't need 30 rows.
- A test for "does the constructor return non-nil" doesn't need to be table-driven.
- A test that exists to satisfy coverage doesn't need three negative cases.

Tables are a tool. The right test for a piece of code is the one that catches bugs and reads clearly. Sometimes that's a 50-row table. Sometimes that's a 5-line function. Calibrate by reading other people's tests in the codebases you respect.

---

[← Back](../)

---
layout: default
title: Coverage — Junior
parent: Test Coverage
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/06-coverage/junior/
---

# Coverage — Junior

[← Back](../)

This page is your first encounter with Go's coverage tooling. We will start from absolute zero — a small package, a single test, one command — and build up to reading an HTML report and recognizing what the percentage means. The audience is someone who has written `TestXxx` functions before and can run `go test`, but has never touched `-cover`.

By the end of this page you will be able to:

- Run `go test -cover` and read the percentage.
- Generate a coverage profile with `-coverprofile`.
- View the profile in your browser with `go tool cover -html`.
- See a per-function breakdown with `go tool cover -func`.
- Understand, at a basic level, why a percentage is just a starting signal.

We will not yet get into atomic mode, integration coverage, CI integration, or programmatic profile parsing — those belong to the middle and senior pages. Today's job is to build comfort with the everyday workflow.

## 1. What coverage actually measures

Before we run anything, let's fix terminology. "Coverage" in Go means *statement coverage* — the fraction of executable statements in your code that ran during the test suite. The Go compiler, when invoked with the `-cover` flag, inserts an instrumentation step: each *basic block* (a straight-line run of statements with one entry and one exit) gets a small counter that is bumped the first time the block executes (in `set` mode) or every time it executes (in `count`/`atomic` modes). When the test process exits, those counters are written to a profile file. The percentage you see at the end of `go test -cover` is computed from those counters: it is the number of statements inside blocks with `count > 0`, divided by the total number of statements in the instrumented source.

There are three things this number is *not*:

1. It is not branch coverage. If you have `if a && b`, statement coverage only tells you whether the body of the `if` ran — it does not tell you which combination of `a` and `b` led to that body executing.
2. It is not function coverage. It is finer-grained than that: a function with one block executed and twenty blocks unexecuted will show as partially covered.
3. It is not a quality metric. A test that calls `Process(x)` and asserts nothing will show 100% coverage for `Process` even though it verifies nothing.

We will keep coming back to these distinctions because they are the source of most confusion about coverage.

## 2. Your first `-cover` run

Let's start with the smallest possible Go package. Create a directory `mathlib/` somewhere convenient. Inside it:

```go
// mathlib/math.go
package mathlib

func Add(a, b int) int { return a + b }

func Sub(a, b int) int { return a - b }
```

Now a test file in the same directory:

```go
// mathlib/math_test.go
package mathlib

import "testing"

func TestAdd(t *testing.T) {
    if Add(2, 3) != 5 {
        t.Fatal("Add broken")
    }
}
```

Notice we test `Add` but not `Sub`. From inside `mathlib/`:

```
$ go test
PASS
ok      mathlib    0.123s
```

The test passes. We have no idea how much of the package was tested. Now add `-cover`:

```
$ go test -cover
PASS
coverage: 50.0% of statements
ok      mathlib    0.124s
```

There it is — your first coverage percentage. Why 50%? Because each function body has one statement (the `return`), and one of two functions ran. The tool reports `50.0% of statements`.

If we delete the `TestAdd` function (so no test exists at all), `go test -cover` will say `0.0% of statements`. If we add a `TestSub` symmetrical to `TestAdd`, we will see `100.0%`.

That is the whole basic loop. From here, everything is elaboration.

## 3. Producing a profile file

The percentage is fine for a quick check, but it tells you nothing about *which* lines were covered. The next tool is `-coverprofile`, which writes the per-block data to a file:

```
$ go test -coverprofile=cover.out
PASS
coverage: 50.0% of statements
ok      mathlib    0.121s
```

Now there is a `cover.out` file in the current directory. Open it in any text editor:

```
mode: set
mathlib/math.go:3.30,3.45 1 1
mathlib/math.go:5.30,5.45 1 0
```

This is the entire format. Let's read it line by line.

- `mode: set` tells us we ran in the default `set` mode, where each block records 0 or 1.
- The next line `mathlib/math.go:3.30,3.45 1 1` says: in file `mathlib/math.go`, starting at line 3, column 30, and ending at line 3, column 45, there is a block containing 1 statement, and it was executed 1 time (in `set` mode that means "yes").
- The line `mathlib/math.go:5.30,5.45 1 0` is the same except the last field is 0: that block, which is the body of `Sub`, never ran.

Once you understand this format you can essentially read coverage data with your eyes. We will look at slightly more interesting profiles later.

## 4. Viewing the profile as HTML

Reading raw profile files is fine for tiny examples, but for real code you want a visual report. The `go tool cover` subcommand can render the profile against your source code as an HTML page colored by coverage status:

```
$ go tool cover -html=cover.out
```

This launches your default browser. You see a dropdown letting you pick a file (here only `mathlib/math.go`), and below it the source colored:

- Green: covered (count > 0).
- Red: uncovered (count == 0).
- Grey: non-executable lines (comments, blank lines, package declaration).

For our `mathlib/math.go`, line 3 (the `Add` body) is green and line 5 (the `Sub` body) is red. Click around the dropdown if there are multiple files.

If you would rather not launch a browser — useful in headless environments or when you want to ship the report — pass `-o`:

```
$ go tool cover -html=cover.out -o coverage.html
```

That writes `coverage.html` to disk; you can open it later, copy it to a CI artifact, or attach it to a code review.

## 5. The per-function summary

The HTML report is great for inspection but tedious for scanning many files. The other `go tool cover` flag is `-func`, which prints a per-function summary:

```
$ go tool cover -func=cover.out
mathlib/math.go:3:      Add             100.0%
mathlib/math.go:5:      Sub             0.0%
total:                  (statements)    50.0%
```

Each line shows the file:line of the function declaration, the function name, and the percentage of its statements covered. The last line is the package total. This is the report format I personally use most often — it tells me the headline number and which functions are at zero, all in five lines.

## 6. Slightly more interesting example

Two-line functions are boring. Let's write something with branches:

```go
// mathlib/divide.go
package mathlib

import "errors"

var ErrDivZero = errors.New("division by zero")

func Div(a, b int) (int, error) {
    if b == 0 {
        return 0, ErrDivZero
    }
    return a / b, nil
}
```

And a single test covering the success case:

```go
// mathlib/divide_test.go
package mathlib

import "testing"

func TestDivSuccess(t *testing.T) {
    got, err := Div(10, 2)
    if err != nil {
        t.Fatal(err)
    }
    if got != 5 {
        t.Fatalf("got %d, want 5", got)
    }
}
```

(We still have the `TestAdd` from earlier; we will pretend we have not yet written `TestSub`.) Run:

```
$ go test -coverprofile=cover.out
PASS
coverage: 75.0% of statements
ok      mathlib    0.122s
```

Why 75%? Looking at the per-function breakdown:

```
$ go tool cover -func=cover.out
mathlib/divide.go:7:    Div             66.7%
mathlib/math.go:3:      Add             100.0%
mathlib/math.go:5:      Sub             0.0%
total:                  (statements)    75.0%
```

`Add` is fully covered (1 statement, 1 covered). `Sub` is at zero (1 statement, 0 covered). `Div` has 3 statements: the body of the `if`, the `return 0, ErrDivZero` line, and the final `return a / b, nil`. The success path runs the entry block and the final return — 2 of 3 statements, 66.7%.

Render the HTML:

```
$ go tool cover -html=cover.out
```

In `divide.go` you will see the `if b == 0` line and the final return green, while `return 0, ErrDivZero` is red. That is the test gap. Add a second test:

```go
func TestDivZero(t *testing.T) {
    _, err := Div(10, 0)
    if err != ErrDivZero {
        t.Fatalf("got err %v, want ErrDivZero", err)
    }
}
```

Re-run:

```
$ go test -coverprofile=cover.out
PASS
coverage: 100.0% of statements
ok      mathlib    0.121s
```

(assuming `TestSub` is now also written, otherwise it stops at 87.5%). The HTML now shows everything in green.

## 7. Reading the profile by hand

For learning purposes it is worth opening `cover.out` again and reading every line:

```
mode: set
mathlib/divide.go:7.32,8.15 1 1
mathlib/divide.go:8.15,10.3 1 1
mathlib/divide.go:11.2,11.21 1 1
mathlib/math.go:3.30,3.45 1 1
mathlib/math.go:5.30,5.45 1 1
```

Three lines for `divide.go`:

1. `7.32,8.15 1 1` — the entry block of `Div` from `func Div(a, b int) (int, error) {` opening brace to `if b == 0 {`. Counter is 1.
2. `8.15,10.3 1 1` — the body of the `if` (from after `{` to the closing `}` on line 10). Counter is 1.
3. `11.2,11.21 1 1` — the final return statement (line 11). Counter is 1.

These line numbers are approximate because Go's coverage rewriter places counters at block boundaries, not arbitrary lines. The exact column numbers depend on whitespace. The mental model: each block has one row in the profile, and each row records whether the block executed.

## 8. What about functions with no statements?

You might wonder what happens with a function like this:

```go
func Noop() {}
```

The body has zero statements. Coverage tooling drops it from the report entirely — it cannot be covered or uncovered because there is nothing to count. `go tool cover -func` will not list it. The total percentage excludes it from both numerator and denominator. This is mostly relevant to interfaces with empty default implementations.

What about declarations with no body? Like an interface method or a function with just `// TODO: implement` and a panic:

```go
func Unimplemented() {
    panic("not yet")
}
```

The `panic` is one statement. If no test ever calls `Unimplemented`, it shows as 0% covered. Calling it from a test that uses `recover` would cover it.

## 9. Coverage at the package level

You have been running tests in one directory. Real Go projects have many packages. Let's add another:

```go
// mathlib/strings/strings.go
package strings

func Greet(name string) string {
    if name == "" {
        return "hello, stranger"
    }
    return "hello, " + name
}
```

```go
// mathlib/strings/strings_test.go
package strings

import "testing"

func TestGreetNamed(t *testing.T) {
    if Greet("Alice") != "hello, Alice" {
        t.Fatal("bad greeting")
    }
}
```

From the project root:

```
$ go test -cover ./...
ok      mathlib            0.122s    coverage: 100.0% of statements
ok      mathlib/strings    0.118s    coverage: 50.0% of statements
```

Each package gets its own percentage. The `./...` pattern means "this directory and all sub-packages recursively". This is the standard way to see coverage across a whole module.

If you want a single combined profile, you need `-coverprofile`:

```
$ go test -coverprofile=cover.out ./...
```

The profile now contains entries from both packages. Note: a single `-coverprofile` over `./...` only writes the profile once and aggregates by package; older Go versions had quirks with this but Go 1.10+ handles it cleanly.

## 10. The default scope: only the package under test

There is a subtle limitation. By default, `-cover` only instruments the package being tested. If `mathlib` imports a third package `internal/helpers`, the coverage profile *will not* contain entries for `helpers` even if `mathlib`'s tests exercise it heavily. To include external dependencies in coverage, you need `-coverpkg`, which is a middle-level topic — for now, just know that the default is "only the package under test".

## 11. When `-coverprofile` writes (and doesn't)

A common surprise: if any test fails, `-coverprofile` *still writes* the profile (in modern Go versions). But the test command exits with a non-zero status. So your CI script should not abort early if you want the profile artifact:

```bash
# Bad: fails before producing artifact
go test -coverprofile=cover.out ./... || exit 1

# Better: keep the profile even on failure
go test -coverprofile=cover.out ./...; rc=$?
go tool cover -html=cover.out -o coverage.html
exit $rc
```

If the test *binary panics catastrophically* before reaching the profile-writing code, you may lose data. In practice this is rare.

## 12. Reading uncovered code in the HTML view

Open the HTML for a real project once you have written a few tests. The colors tell you exactly where to write more tests:

- A red line is uncovered. Why? Often: it is an error branch, a panic guard, an init function, a platform-specific code path, or just code you forgot to test.
- A green line is covered. Does not mean it is correctly tested; only that it ran.
- A grey line is non-executable.

The first time you point this at a real project you have been working on, you will be surprised how many red lines exist. That is normal. Coverage is most valuable when you are at 30–60% and clearly need to do work; at higher numbers it starts to give diminishing returns and you need other tools (mutation testing, property-based testing) to make further progress.

## 13. The percentage on the command line

When you do not need the profile file, just the headline number, use `-cover` alone:

```
$ go test -cover ./...
ok      mathlib            0.123s    coverage: 100.0% of statements
ok      mathlib/strings    0.119s    coverage: 50.0% of statements
```

This is what most developers run during day-to-day work — it is fast, gives a quick smell test, and does not leave artifacts on disk.

## 14. Common pitfalls for newcomers

A few mistakes are common at this stage:

**Mixing `-coverprofile` and `-cover`**: `-coverprofile` *implies* `-cover`. You do not need both. Writing `go test -cover -coverprofile=cover.out` is harmless but redundant.

**Forgetting `./...`**: `go test -cover` in a directory only tests packages in that directory. To recurse, add `./...`. The percentage reported for `go test -cover ./...` is *per-package*; there is no single "module-wide" percentage in the command output (you have to compute it from a merged profile).

**Treating the percentage as the goal**: this is the big one. The percentage is one of many tools. Use it to find big gaps, not to declare victory.

**Looking only at the percentage and not the HTML**: the HTML is where the actual information is. The percentage tells you a number; the HTML tells you which *lines* to write tests for.

**Running with `-race` and being surprised by extra output**: `-race` enables `-covermode=atomic` automatically when `-cover` is on, which is slightly slower. This is correct behavior — without atomic mode the counter writes themselves would race — but the percentage is unaffected.

## 15. A larger example to practice on

Let's build something with more branches to practice reading coverage. A simple integer parser:

```go
// parser/parser.go
package parser

import (
    "fmt"
    "strconv"
    "strings"
)

func ParseList(s string) ([]int, error) {
    if s == "" {
        return nil, nil
    }
    parts := strings.Split(s, ",")
    out := make([]int, 0, len(parts))
    for _, p := range parts {
        p = strings.TrimSpace(p)
        if p == "" {
            continue
        }
        n, err := strconv.Atoi(p)
        if err != nil {
            return nil, fmt.Errorf("invalid integer %q: %w", p, err)
        }
        out = append(out, n)
    }
    return out, nil
}
```

A first test:

```go
// parser/parser_test.go
package parser

import "testing"

func TestParseListBasic(t *testing.T) {
    got, err := ParseList("1,2,3")
    if err != nil {
        t.Fatal(err)
    }
    if len(got) != 3 || got[0] != 1 || got[1] != 2 || got[2] != 3 {
        t.Fatalf("got %v", got)
    }
}
```

Run:

```
$ go test -coverprofile=cover.out ./parser
PASS
coverage: 70.0% of statements
ok      parser    0.121s
```

About 70%, depending on how the compiler split blocks. Look at the HTML:

- The `if s == ""` branch is green at the comparison line, but the `return nil, nil` body is red. The empty-string case is uncovered.
- The `if p == ""` continue branch may be red (no test feeds `"1,,2"`).
- The `if err != nil` body is red (no test feeds a non-integer).

Add three tests to fix these gaps:

```go
func TestParseListEmpty(t *testing.T) {
    got, err := ParseList("")
    if err != nil || got != nil {
        t.Fatalf("empty should give nil, nil, got %v %v", got, err)
    }
}

func TestParseListBlankComponent(t *testing.T) {
    got, err := ParseList("1, ,2")
    if err != nil {
        t.Fatal(err)
    }
    if len(got) != 2 || got[0] != 1 || got[1] != 2 {
        t.Fatalf("got %v", got)
    }
}

func TestParseListBadInteger(t *testing.T) {
    _, err := ParseList("1,abc,3")
    if err == nil {
        t.Fatal("expected error")
    }
}
```

Re-run:

```
$ go test -coverprofile=cover.out ./parser
PASS
coverage: 100.0% of statements
ok      parser    0.122s
```

Every line green. This is the everyday workflow: write some code, write some tests, look at the HTML, identify red lines, write more tests, repeat.

## 16. Coverage and `Example` functions

Go test files can contain `ExampleXxx` functions that double as documentation. They are run as tests if they have an `// Output:` comment. They count toward coverage too — code they exercise is recorded. So a well-documented public API often has higher coverage from examples alone than you might guess.

```go
func ExampleParseList() {
    fmt.Println(ParseList("1,2,3"))
    // Output: [1 2 3] <nil>
}
```

This `Example` runs as part of `go test`, exercises `ParseList`, and adds to coverage just like a `TestXxx` would.

## 17. Coverage is not a substitute for assertions

We keep saying this because it is the most common confusion. Compare two tests:

```go
// Test A: no assertions, full coverage of Div
func TestDivCoverage(t *testing.T) {
    Div(10, 2)
    Div(10, 0)
}

// Test B: one assertion per branch
func TestDivCorrect(t *testing.T) {
    got, err := Div(10, 2)
    if err != nil || got != 5 {
        t.Fatalf("Div(10,2)=%d,%v; want 5,nil", got, err)
    }
    _, err = Div(10, 0)
    if err != ErrDivZero {
        t.Fatalf("Div(10,0) err=%v; want ErrDivZero", err)
    }
}
```

Both produce 100% coverage of `Div`. Test A would still pass if `Div(10, 2)` returned `-1` and `Div(10, 0)` returned `(0, nil)`. Test B catches both regressions. The coverage tool cannot distinguish them. This is why "100% coverage" alone is meaningless without looking at the tests.

The takeaway: write Test B, not Test A. Coverage tells you which code ran; the assertions tell you what behavior was verified.

## 18. A small mental model for what to test

When you look at a red line in the HTML report, ask: "what value of the inputs would make this line execute?" That is your next test. If the answer is "no realistic value, this is a panic guard", then maybe a test calling the function with a deliberately bad input plus `defer func() { recover() }()` to assert the panic is the right thing. If the answer is "an empty string input", write `TestXxxEmpty`. If the answer is "this requires a network failure", you may need a fake server or a fault-injecting `http.RoundTripper`.

Coverage gives you a list of "what to test next" sorted by code location. You still have to pick the right inputs and write the right assertions.

## 19. A note on `-v` and coverage

`-v` is verbose mode for `go test`; it prints each test name as it runs. It is orthogonal to coverage:

```
$ go test -v -cover ./parser
=== RUN   TestParseListBasic
--- PASS: TestParseListBasic (0.00s)
=== RUN   TestParseListEmpty
--- PASS: TestParseListEmpty (0.00s)
=== RUN   TestParseListBlankComponent
--- PASS: TestParseListBlankComponent (0.00s)
=== RUN   TestParseListBadInteger
--- PASS: TestParseListBadInteger (0.00s)
PASS
coverage: 100.0% of statements
ok      parser    0.122s
```

You can combine the two freely. When debugging which test covers what, `-v` is useful to confirm a test actually ran.

## 20. Where to go from here

Now that you can:

- Run `go test -cover` and read the percentage.
- Generate a profile with `-coverprofile`.
- View the report in HTML with `go tool cover -html`.
- Read the per-function summary with `go tool cover -func`.
- Identify uncovered lines and write tests for them.

…you have the foundation. The middle page picks up with `-covermode`, parallel tests, cross-package coverage, and monorepo patterns. The senior page introduces Go 1.20 integration coverage, programmatic profile parsing, and CI integration. The professional page is about coverage strategy: how to use the number without becoming its slave.

The single most important thing to remember from this page: *coverage is a tool, not a target*. Use it to find gaps in your tests, not to declare your tests good. A test that runs code without asserting anything is no better than no test, regardless of what the coverage number says. The point of coverage is to direct your attention; the point of testing is to catch bugs. Keep those two goals separate in your head and the coverage tool becomes one of the most useful things in your toolkit.

## 21. Quick reference

For when you have forgotten the exact incantation:

```
# Quick check, no artifacts
go test -cover ./...

# Profile for inspection
go test -coverprofile=cover.out ./...

# HTML report
go tool cover -html=cover.out

# HTML report to a file (no browser)
go tool cover -html=cover.out -o coverage.html

# Per-function summary
go tool cover -func=cover.out

# Verbose plus coverage
go test -v -cover ./...
```

Print this section, tape it to your monitor, and you will not need to look up the flags again. The rest of the subsection explores everything around these five commands.

## 22. Walking through coverage on a slightly bigger example

Let's go through a richer example end to end. We will build a small CSV row validator, watch how coverage evolves as we add tests, and see what each tool reports at each stage. The goal is to give you a sense of the rhythm of test-coverage-test-coverage when working on real code.

Create a package `csvchk` with this source:

```go
// csvchk/csvchk.go
package csvchk

import (
    "errors"
    "strconv"
    "strings"
)

type Row struct {
    Name  string
    Age   int
    Email string
}

var (
    ErrTooFewFields  = errors.New("too few fields")
    ErrTooManyFields = errors.New("too many fields")
    ErrEmptyName     = errors.New("name is empty")
    ErrBadAge        = errors.New("invalid age")
    ErrBadEmail      = errors.New("invalid email")
)

func Parse(line string) (Row, error) {
    fields := strings.Split(line, ",")
    if len(fields) < 3 {
        return Row{}, ErrTooFewFields
    }
    if len(fields) > 3 {
        return Row{}, ErrTooManyFields
    }
    name := strings.TrimSpace(fields[0])
    if name == "" {
        return Row{}, ErrEmptyName
    }
    age, err := strconv.Atoi(strings.TrimSpace(fields[1]))
    if err != nil || age < 0 || age > 150 {
        return Row{}, ErrBadAge
    }
    email := strings.TrimSpace(fields[2])
    if !strings.Contains(email, "@") {
        return Row{}, ErrBadEmail
    }
    return Row{Name: name, Age: age, Email: email}, nil
}
```

There are five distinct error branches plus a success path. A naive first test:

```go
// csvchk/csvchk_test.go
package csvchk

import "testing"

func TestParseHappyPath(t *testing.T) {
    r, err := Parse("Alice,30,alice@example.com")
    if err != nil {
        t.Fatal(err)
    }
    if r.Name != "Alice" || r.Age != 30 || r.Email != "alice@example.com" {
        t.Fatalf("bad row: %+v", r)
    }
}
```

Run:

```
$ go test -coverprofile=cover.out ./csvchk
PASS
coverage: 50.0% of statements
ok      csvchk    0.121s
```

50% — the happy path covered the entry, the name trim, the age parse success branch, the email check success branch, and the final return. Every error return is uncovered. Look at the per-function:

```
$ go tool cover -func=cover.out
csvchk/csvchk.go:24:    Parse           50.0%
total:                  (statements)    50.0%
```

That is one function so the report is short. The HTML is more useful:

```
$ go tool cover -html=cover.out
```

You will see five red return statements, one for each error branch, plus all the surrounding control flow checks (which are green because they were evaluated, even though the branch they guard was not taken).

Add tests one error at a time and watch the number climb. First, the too-few-fields case:

```go
func TestParseTooFew(t *testing.T) {
    _, err := Parse("Alice,30")
    if err != ErrTooFewFields {
        t.Fatalf("got %v, want ErrTooFewFields", err)
    }
}
```

Re-run:

```
coverage: 58.3% of statements
```

A tick higher. Add too-many:

```go
func TestParseTooMany(t *testing.T) {
    _, err := Parse("Alice,30,alice@example.com,extra")
    if err != ErrTooManyFields {
        t.Fatalf("got %v, want ErrTooManyFields", err)
    }
}
```

Re-run:

```
coverage: 66.7% of statements
```

Empty name:

```go
func TestParseEmptyName(t *testing.T) {
    _, err := Parse("   ,30,alice@example.com")
    if err != ErrEmptyName {
        t.Fatalf("got %v, want ErrEmptyName", err)
    }
}
```

Re-run:

```
coverage: 75.0% of statements
```

Bad age:

```go
func TestParseBadAge(t *testing.T) {
    _, err := Parse("Alice,not-a-number,alice@example.com")
    if err != ErrBadAge {
        t.Fatalf("got %v, want ErrBadAge", err)
    }
}
```

Re-run:

```
coverage: 83.3% of statements
```

Bad email:

```go
func TestParseBadEmail(t *testing.T) {
    _, err := Parse("Alice,30,not-an-email")
    if err != ErrBadEmail {
        t.Fatalf("got %v, want ErrBadEmail", err)
    }
}
```

Re-run:

```
coverage: 100.0% of statements
```

Six tests, six branches covered. The number ticked up roughly 8.3% per test (one twelfth — because there were twelve statements in the function and each error branch was one statement). This is what coverage feels like in real workflow: tiny, predictable increments as you fill in each gap.

But — and here is the most important observation in this entire page — 100% does not mean the parser is correct. We tested:

- bad age = "not-a-number"

But not:

- bad age = "-1" (negative)
- bad age = "151" (over 150)
- bad age = "" (whitespace only)

Each of those exercises a *different* condition in `if err != nil || age < 0 || age > 150`, yet because the *body* of that `if` ran from the very first bad-age test, statement coverage will not flag the gap. If a future refactor changes the bound from 150 to 100, our test does not notice because we never tried `age = 120`. This is exactly the branch-vs-statement problem we keep raising.

So the rhythm becomes:

1. Use coverage to find missed lines.
2. Write a test that hits each missed line.
3. *Then* think harder about whether the *condition* leading to that line has multiple sub-cases worth testing.

The first two steps coverage helps with. The third step is on you.

## 23. Coverage when tests live in `_test` package

Go has a special convention: a test file with package name ending in `_test` is treated as an *external* test package, compiled separately and only allowed to use exported names. This is sometimes called "black box" testing.

```go
// csvchk/csvchk_blackbox_test.go
package csvchk_test

import (
    "testing"
    "example.com/csvchk"
)

func TestParseExternal(t *testing.T) {
    if _, err := csvchk.Parse("Alice,30,alice@example.com"); err != nil {
        t.Fatal(err)
    }
}
```

This file lives in the same directory as `csvchk.go` but its package is `csvchk_test`. Coverage works exactly the same way — the test runs, it calls `csvchk.Parse`, and the statements inside `Parse` are recorded as covered.

The difference is that *external* test packages cannot reach unexported identifiers. If `csvchk` had an unexported helper `func normalize(s string) string` that you wanted to test directly, you would need an internal (same-package) test file. Coverage of unexported helpers is still recorded when external tests exercise them indirectly via exported APIs.

## 24. Coverage and `_test.go` file scope

A subtle point: `_test.go` files themselves are not counted for coverage. The tool only counts the code under test, not the test code. This makes sense — you do not want to drive the percentage up by adding helper functions in your test file. The instrumentation rewriter explicitly excludes files matching the `_test.go` pattern.

So if you have:

```
csvchk/
    csvchk.go        (production code, counted)
    helpers.go       (production code, counted)
    csvchk_test.go   (test code, not counted)
    helpers_test.go  (test code, not counted)
```

The denominator is the statements in `csvchk.go` plus `helpers.go`. Test files are invisible to coverage entirely.

## 25. What about generated code?

Many Go projects include generated files: `*.pb.go` from Protocol Buffers, `*_gen.go` from `go generate`, mock files, ORM-generated boilerplate. These files often have thousands of lines of repetitive accessors and `Get*` methods that are trivially "covered" by any test that touches the underlying type.

By default, `go test -cover` counts these files just like any other code. This means:

- Adding a new `.proto` definition can suddenly raise your coverage percentage by ten points, even though you wrote no tests.
- Adding a new mock implementation can drop coverage if nothing uses the mock.
- The headline percentage becomes dominated by code humans did not write.

There is no first-class "exclude generated code" flag in `go test`. To exclude, you must post-process the profile. The simplest filter:

```bash
# Drop lines from generated files
grep -vE '(_gen|_mock|\.pb)\.go:' cover.out > cover.filtered.out
mv cover.filtered.out cover.out
go tool cover -func=cover.out
```

This is hacky but it works for ad-hoc inspection. CI integrations typically use a Go program with `golang.org/x/tools/cover.ParseProfiles` for robust filtering — that comes up in the senior page.

For now, when you see a coverage percentage that looks too good or too volatile, ask yourself: is generated code in the denominator?

## 26. The mental model of "covered block"

We have used the word "block" several times. Let's pin it down precisely. The Go compiler, when instrumenting, splits each function body into *basic blocks*: maximal runs of statements where execution falls through linearly with no jumps in or out. The block boundaries are determined by control flow:

- An `if` statement starts a new block at the body and another at the else.
- A `for` loop starts a new block at the body and another after the loop.
- A `switch` starts a new block for each case.
- A `return` ends a block.
- A function call to a function that can panic does *not* split a block (the compiler conservatively assumes the call returns).

Each block is given one counter. The counter is incremented at the *start* of the block. So if a block contains five statements, the counter is bumped once, not five times, but the profile records that block contains 5 statements (`numStatements` field). When computing percentages:

- numerator = sum of `numStatements` for blocks with count > 0
- denominator = sum of `numStatements` for all blocks

That is the entire calculation. It is intentionally simple.

## 27. What `count > 0` means in `set` mode

In `set` mode, the counter is either 0 or 1. The instrumentation rewriter generates code like:

```go
GoCover_0.Count[42] = 1
```

at the start of the block. There is no atomic, no increment — just a plain write. The value is set to 1 the first time, and overwritten with 1 on subsequent executions. This is why `set` mode is the cheapest: a single non-atomic store.

In `count` mode, the same line becomes:

```go
GoCover_0.Count[42]++
```

An increment, not an atomic increment. Still cheap but loses precision under concurrency.

In `atomic` mode:

```go
atomic.AddUint32(&GoCover_0.Count[42], 1)
```

This is correct under concurrency but ~10x slower than the count-mode form due to the locked memory operation. We will discuss the trade-offs in the middle page; for now, just know that `set` is the default and is fine for most cases.

## 28. Coverage cache and re-runs

`go test` aggressively caches test results. If you run `go test ./...` twice and nothing changes, the second run shows `(cached)` and finishes instantly. This caching extends to coverage: if a test was last run with `-cover` and the inputs are unchanged, you can get the cached coverage data without re-running.

But: when you change `-coverprofile=cover.out`, the cache key changes, so it re-runs. When you change `-cover` to `-covermode=count`, the cache key changes. So in practice, every coverage run actually executes the test binary; only the no-cover, no-flag runs are cached aggressively.

To force a fresh run regardless:

```
$ go test -count=1 -coverprofile=cover.out ./...
```

`-count=1` defeats the cache. Many CI scripts use it by default to ensure deterministic, reproducible runs.

## 29. Reading the HTML report effectively

Let's walk through the HTML rendering of our CSV example after partial test coverage. Open it:

```
$ go tool cover -html=cover.out
```

In the dropdown at the top, select `csvchk/csvchk.go`. The top of the page shows the percentage. Below that is the file rendered with a colored bar on the left of each line:

- Bright green: the block this line belongs to executed many times (count mode) or executed at least once (set mode).
- Dimmer green: executed but less often.
- Bright red: never executed.
- No color: not an executable line.

In set mode the only colors are green, red, and grey — there is no "less often". In count mode you see shades of green showing relative frequency.

A useful workflow:

1. Scan the file for red bars. Each red bar is a candidate next test.
2. For each red bar, ask: "what input would make this run?" That input becomes the test case.
3. Write the test. Re-run `go test -coverprofile=cover.out` and reload the HTML.
4. The previously-red line is now green. Move to the next red bar.

This is mechanical. Many engineers, when their team adopts a coverage policy, find themselves doing this for an afternoon to close gaps. It is not glamorous work but it is real progress — assuming you write meaningful assertions, not just "call the function to make the line green".

## 30. A note on `init` and `main`

Functions named `init` and `main` are special. The `init` functions of a package run once at program start; `main` only exists in `main` packages and runs once. Both are instrumented like any other function. Their coverage is recorded the same way.

However: `init` functions tend to run during *any* test, because the package is initialized whenever the test binary starts. So `init` is usually shown as covered even if no test exercises it explicitly. `main` is rarely covered by `go test` because tests do not call `main` — and when they do (via `os.Args` manipulation), it is fragile. The Go 1.20 integration coverage feature, which we cover in the senior page, is the proper way to cover `main`.

## 31. The "first 80% is easy" curve

A reliable observation across many Go projects: the first 50–70% of coverage comes quickly. You write tests for the happy paths, the obvious error branches, and the boundary cases, and you are at 70%. The next 15% takes longer — the rare error paths, the edge inputs, the cleanup branches. The last 10% is hard — it requires fault injection, specific timing, or untestable platform-specific code.

Most teams plateau at 75–85% on the headline number. Beyond that the marginal cost of each additional percentage point rises sharply, and the marginal value of those tests falls — they catch rarer and rarer bugs while costing engineering hours. The professional page goes into how to think about this trade-off.

## 32. Coverage and test failures

What happens to the percentage when a test fails? It still gets reported:

```
$ go test -cover ./csvchk
--- FAIL: TestParseTooMany (0.00s)
    csvchk_test.go:18: got <nil>, want ErrTooManyFields
FAIL
coverage: 100.0% of statements
FAIL    csvchk    0.122s
```

The test reached the offending assertion and failed; the percentage still reflects the lines executed up to the failure. If a test panics or crashes the binary, you may lose data — the profile is only written on clean exit.

This is mostly an aesthetic concern: failing tests still show coverage, but you should fix the failures before reading coverage as a meaningful number.

## 33. Coverage in editor integrations

Most Go editors integrate with `go test -cover`:

- **VS Code**: the Go extension can run coverage on save and highlight covered/uncovered lines in the gutter. Configured via `go.coverOnSave: true` and `go.coverageDecorator`.
- **GoLand**: `Run with Coverage` (Ctrl+Shift+F10 on default keymap) produces a side panel with per-file/per-function percentages and gutter highlighting.
- **vim-go**: `:GoCoverage` highlights covered lines in the current buffer; `:GoCoverageToggle` clears the highlighting.

These integrations are essentially front-ends to the same `go test -coverprofile` + `go tool cover` pipeline you have been using on the command line. Once you understand the command line, the editor integrations are a thin layer of convenience.

## 34. A typical first-week-on-the-job coverage scenario

You join a team. The codebase has been running for two years. You run `go test -cover ./...` and see numbers ranging from 18% to 92% across 50 packages. Senior engineers tell you "coverage is a guide, not a target". The CI passes any PR regardless of coverage delta. What do you do?

A useful first move: identify three packages that are critical (revenue path, authentication, data integrity) and have low coverage (< 50%). Write tests for those — not for the headline number, but because those packages are where bugs hurt most. Watch the per-file HTML report for each, write tests that close visible red lines with strong assertions, and document your learning along the way.

Coverage in this context is a *map*, not a *scorecard*. It tells you where to look. Where to look is most of the value.

## 35. Wrap-up exercises

To consolidate what you have learned, try these on a real Go project you have access to:

1. Run `go test -cover ./...` and write down the percentages.
2. Pick the package with the lowest percentage. Run `go test -coverprofile=cover.out ./<that-package>` and open `go tool cover -html=cover.out`.
3. Identify three red regions. For each, propose one test case that would cover it.
4. Write one of those tests. Re-run coverage. Confirm the new percentage rose.
5. Run `go tool cover -func=cover.out` and identify the function with the lowest individual percentage.
6. Read that function. Is the uncovered code dead? Defensive? Error-handling? Plan a test or document why the gap is acceptable.

When you can do this fluently — read the report, identify gaps, design tests, watch the percentage move — you have internalized the junior-level Go coverage workflow. The next page builds on this with the trickier configuration knobs and parallel-test considerations.

## 36. Closing thoughts

Coverage is among the easiest Go tools to adopt: one flag, one tool, immediate visual feedback. It is also among the easiest to misuse: a number that the team optimizes for instead of with. The junior-level skill is to use it daily, see the gaps, and write tests with conviction. The intermediate skills — when to use atomic mode, how to instrument dependencies, how to feed CI dashboards — are useful but secondary. The most important skill is to keep the metric in its place: it is a flashlight, not a verdict.

Walk away from this page with three habits:

1. **Run `go test -cover` often**. It costs almost nothing and tells you where to look.
2. **Look at the HTML when the number surprises you**. Numbers lie; line-by-line color does not.
3. **Write the assertions, then the coverage will follow**. Tests that exercise code without verifying behavior are worse than no tests.

Everything else is detail.

## 37. Practical tour: covering a real-world-ish package

To finish off this page, let's take a longer worked example. We will build a small URL shortener data layer in memory, write tests in increments, and watch coverage rise. The goal is not to teach URL shortening — it is to give you a longer experience of the test-then-look-at-coverage loop on a realistic surface area.

Create `shortener/shortener.go`:

```go
package shortener

import (
    "crypto/rand"
    "encoding/base64"
    "errors"
    "strings"
    "sync"
)

type Store struct {
    mu      sync.RWMutex
    forward map[string]string // short -> long
    reverse map[string]string // long -> short
}

func New() *Store {
    return &Store{
        forward: map[string]string{},
        reverse: map[string]string{},
    }
}

var (
    ErrEmptyURL    = errors.New("empty URL")
    ErrBadScheme   = errors.New("URL must be http or https")
    ErrCodeTaken   = errors.New("code already used")
    ErrNotFound    = errors.New("code not found")
)

func (s *Store) Shorten(long string) (string, error) {
    if long == "" {
        return "", ErrEmptyURL
    }
    if !strings.HasPrefix(long, "http://") && !strings.HasPrefix(long, "https://") {
        return "", ErrBadScheme
    }
    s.mu.RLock()
    if code, ok := s.reverse[long]; ok {
        s.mu.RUnlock()
        return code, nil
    }
    s.mu.RUnlock()

    s.mu.Lock()
    defer s.mu.Unlock()
    if code, ok := s.reverse[long]; ok {
        return code, nil
    }
    var code string
    for i := 0; i < 5; i++ {
        code = generateCode()
        if _, taken := s.forward[code]; !taken {
            break
        }
    }
    if _, taken := s.forward[code]; taken {
        return "", ErrCodeTaken
    }
    s.forward[code] = long
    s.reverse[long] = code
    return code, nil
}

func (s *Store) Resolve(code string) (string, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    long, ok := s.forward[code]
    if !ok {
        return "", ErrNotFound
    }
    return long, nil
}

func generateCode() string {
    var buf [6]byte
    if _, err := rand.Read(buf[:]); err != nil {
        panic(err) // unreachable in practice
    }
    return base64.RawURLEncoding.EncodeToString(buf[:])
}
```

This package has eight or so distinct code paths: empty URL, bad scheme, duplicate URL fast path, duplicate URL slow path (under write lock), happy path, code-taken error, resolve hit, resolve miss, plus the panic-on-rand-failure.

### Round 1: a single happy-path test

```go
// shortener/shortener_test.go
package shortener

import "testing"

func TestShortenAndResolve(t *testing.T) {
    s := New()
    code, err := s.Shorten("https://example.com")
    if err != nil {
        t.Fatal(err)
    }
    if code == "" {
        t.Fatal("empty code")
    }
    long, err := s.Resolve(code)
    if err != nil {
        t.Fatal(err)
    }
    if long != "https://example.com" {
        t.Fatalf("got %q", long)
    }
}
```

Run:

```
$ go test -coverprofile=cover.out ./shortener
PASS
coverage: 60.0% of statements
ok      shortener    0.121s
```

60%. The HTML shows red on:

- The empty URL branch.
- The bad-scheme branch.
- The duplicate URL fast path (the read-lock-and-return).
- The duplicate URL slow path (the double-check under the write lock).
- The code-taken loop exhaustion branch.
- The resolve miss branch.
- The unreachable panic in `generateCode`.

### Round 2: the obvious errors

```go
func TestShortenEmpty(t *testing.T) {
    s := New()
    if _, err := s.Shorten(""); err != ErrEmptyURL {
        t.Fatalf("got %v, want ErrEmptyURL", err)
    }
}

func TestShortenBadScheme(t *testing.T) {
    s := New()
    if _, err := s.Shorten("ftp://example.com"); err != ErrBadScheme {
        t.Fatalf("got %v, want ErrBadScheme", err)
    }
}

func TestResolveMiss(t *testing.T) {
    s := New()
    if _, err := s.Resolve("nope"); err != ErrNotFound {
        t.Fatalf("got %v, want ErrNotFound", err)
    }
}
```

Re-run:

```
coverage: 80.0% of statements
```

Up 20 percentage points for three small tests. The HTML now has only three red regions: the duplicate-URL paths (both fast and slow) and the code-taken error.

### Round 3: the duplicate paths

Calling `Shorten` twice with the same URL should hit the duplicate path:

```go
func TestShortenDuplicate(t *testing.T) {
    s := New()
    code1, err := s.Shorten("https://example.com")
    if err != nil {
        t.Fatal(err)
    }
    code2, err := s.Shorten("https://example.com")
    if err != nil {
        t.Fatal(err)
    }
    if code1 != code2 {
        t.Fatalf("expected same code, got %q and %q", code1, code2)
    }
}
```

Re-run:

```
coverage: 90.0% of statements
```

The fast path is now green. But the *slow path* (the double-check under the write lock) is still red. Why? Because in a single-threaded test, by the time we call `Shorten` the second time, the entry is already in the forward map and the fast path catches it. The slow path only runs if a second goroutine *races* between our `RUnlock` and `Lock` — a real concurrency race we cannot easily simulate.

This is a useful object lesson: some red lines cannot be covered by simple unit tests. The slow path is a guard against a race condition; the only way to hit it is to engineer the race. We will leave it red for now and accept 90% as the limit of single-threaded testing. The middle page will discuss parallel-test coverage.

### Round 4: the code-taken path

This branch fires when 5 consecutive random codes are already in use. With a 6-byte random code (48 bits, base64-encoded to 8 chars), the probability of a real collision is astronomical. The branch exists only as defensive code.

To cover it, we would need to monkey-patch `generateCode` or force a collision. Without modifying the source, we cannot reach it.

In real code review, you have three options:

1. Refactor: replace the `for i := 0; i < 5; i++` with a function we can stub out in tests.
2. Use a build tag or test hook to inject a deterministic generator in tests.
3. Accept the gap and document it.

For learning purposes, let's refactor:

```go
type Store struct {
    mu      sync.RWMutex
    forward map[string]string
    reverse map[string]string
    gen     func() string
}

func New() *Store {
    return &Store{
        forward: map[string]string{},
        reverse: map[string]string{},
        gen:     generateCode,
    }
}
```

Then in `Shorten`, replace `code = generateCode()` with `code = s.gen()`. Now a test can inject a deterministic generator that always returns the same string, forcing the code-taken branch:

```go
func TestShortenCodeTaken(t *testing.T) {
    s := New()
    s.gen = func() string { return "FIXED" } // always collide after first
    if _, err := s.Shorten("https://example.com"); err != nil {
        t.Fatal(err)
    }
    if _, err := s.Shorten("https://other.com"); err != ErrCodeTaken {
        t.Fatalf("got %v, want ErrCodeTaken", err)
    }
}
```

Re-run:

```
coverage: 95.0% of statements
```

Almost perfect. The remaining red is the `panic(err)` line in `generateCode`, which can only be hit if `crypto/rand.Read` fails — essentially never in practice. We document this gap and move on.

### Reflection on the example

The walkthrough above showed five rounds of test-cover-test, with the percentage climbing 60 → 80 → 90 → 95. Each jump was a different kind of effort:

- Round 2 was rote: three trivial error-branch tests added in five minutes.
- Round 3 was easy but informative: we discovered a code path that single-threaded tests cannot reach.
- Round 4 required *refactoring the production code* to be testable: we had to introduce a dependency-injection seam for the random generator.

These three kinds of work — easy, informative, and refactor-driven — are roughly proportional to your time investment as you climb the coverage curve. A junior engineer should expect to spend most of their early test-writing effort on round-2-style work and gradually accumulate experience with rounds 3 and 4 as the codebase matures.

## 38. The "what about errors I can't simulate" question

Common junior question: "this error branch only fires if `os.OpenFile` returns an error. How do I test it without actually breaking the filesystem?"

There is a family of answers:

1. **Inject the dependency**. Replace direct `os.OpenFile` calls with a function-typed field that defaults to `os.OpenFile` but can be overridden in tests.
2. **Use an interface**. Define a `FileOpener` interface; the production code takes a `FileOpener`; tests pass a fake.
3. **Use `afero` or similar test filesystems** for higher-level abstraction.
4. **Accept the gap**. Some defensive paths are not worth wiring up testability for; document the gap.

For coverage purposes, the choice is between adding more test-driven refactoring (which raises the percentage but adds complexity) and accepting that the metric will plateau (which keeps the code simple but leaves red lines in the HTML).

Most senior engineers err on the side of accepting some gaps. The junior temptation is to chase every red line and end up with a codebase full of interfaces that exist only to make tests possible — a known anti-pattern called "test-induced design damage". We will discuss this further in the senior page.

## 39. Coverage of `select` statements

A subtle case worth mentioning: `select` statements with multiple cases. Each `case` is a separate block in coverage. If your test only hits one of the cases, the others are red. Example:

```go
func wait(ch chan int, done chan struct{}) int {
    select {
    case v := <-ch:
        return v
    case <-done:
        return -1
    }
}
```

A test sending on `ch` covers the first case; the `done` case stays red. To get full coverage you need two tests: one driving each branch. The pattern is the same as `if/else` — every branch is a block, every block needs a triggering test.

## 40. Coverage of `defer` statements

`defer` statements register cleanup functions that run when the enclosing function returns. The deferred function body is its own block. If the cleanup runs (i.e. the function returns), the deferred block is covered. If the cleanup panics or never runs (because the program crashes), it stays red.

Example:

```go
func process(name string) error {
    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close()
    // ... do work
    return nil
}
```

The `f.Close()` call is its own block. Any test that successfully opens the file and returns from `process` will cover it. Tests that hit the `err != nil` branch will not — but only because that branch returns early, not because `defer` is special.

## 41. The day-to-day rhythm

After a week or two of using `go test -cover` daily, the rhythm becomes:

- Edit some code.
- Run `go test -cover ./mypackage`. Glance at the percentage.
- If it dropped, open the HTML and find the new red line; write a test.
- If it rose, you probably just added test infrastructure that exercises new ground; double-check that the assertions are meaningful.
- Commit.

That is it. The whole interaction takes less than a minute most of the time. The point is not to study coverage as a metric; the point is to use it as a constant background signal that nudges you toward writing more tests.

When you find yourself doing this naturally — running coverage as muscle memory, not as a chore — you have completed the junior page. The middle page picks up with the more advanced configuration options that you will eventually need.

## 42. One more reminder

A test like this:

```go
func TestProcessAllInputs(t *testing.T) {
    inputs := []string{"a", "b", "c", "d", "e"}
    for _, in := range inputs {
        Process(in)
    }
}
```

with no assertions, is a test that *adds coverage but tests nothing*. The coverage tool will happily count every line of `Process` as covered. The test will pass under any change to `Process` that does not panic. This is the most insidious form of false confidence in Go testing.

If you take one habit away from this entire page, take this: every time you write a test, ask "what assertion is this test making?" If you cannot answer with at least one `t.Error*` or `t.Fatal*` call, the test is decorative, not functional. Coverage will mislead you about its value.

That is the junior page. You can now read coverage reports, identify gaps, write tests with assertions, and understand both the power and the limits of statement-level coverage. The next page introduces `-covermode` choices, parallel test considerations, and how coverage works across packages.



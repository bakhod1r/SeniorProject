---
layout: default
title: Subtests — Junior
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/junior/
---

# Subtests — Junior

[← Back](../)

This page walks through subtests from zero. If you have written a couple
of `TestXxx` functions and want to understand `t.Run`, why people use
it, and how to read its output, start here. We move slowly, with every
concept demonstrated by a runnable snippet. By the end you will be
comfortable converting flat test functions into clean table-driven
subtests, filtering specific cases with `-run`, debugging failures, and
reading hierarchical `-v` output.

## 1. The problem that subtests solve

Imagine you are testing a `Reverse` function. Without subtests you
might write:

```go
package strutil

// Reverse returns s with its runes in reverse order.
func Reverse(s string) string {
    r := []rune(s)
    for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
        r[i], r[j] = r[j], r[i]
    }
    return string(r)
}
```

And then a test file:

```go
package strutil

import "testing"

func TestReverseEmpty(t *testing.T) {
    if got := Reverse(""); got != "" {
        t.Errorf("Reverse(``)=%q, want ``", got)
    }
}

func TestReverseAscii(t *testing.T) {
    if got := Reverse("abc"); got != "cba" {
        t.Errorf("Reverse(abc)=%q, want cba", got)
    }
}

func TestReverseUnicode(t *testing.T) {
    if got := Reverse("héllo"); got != "olléh" {
        t.Errorf("Reverse(héllo)=%q, want olléh", got)
    }
}

func TestReversePalindrome(t *testing.T) {
    if got := Reverse("level"); got != "level" {
        t.Errorf("Reverse(level)=%q, want level", got)
    }
}
```

Four separate functions, four copies of the same shape. What if you
add ten more cases? You end up with fourteen functions whose only
differences are input and expected output. The signal-to-noise ratio
drops, and IDE test navigation lists them as unrelated entries even
though they all exercise the same behavior. Adding a new case requires
copying the boilerplate; a typo in the boilerplate can silently break
the new test.

There is a better way.

## 2. The subtest version

`t.Run` lets you collapse those four functions into one:

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
                t.Errorf("Reverse(%q)=%q, want %q", tc.in, got, tc.want)
            }
        })
    }
}
```

One function, one table, one place to add a new case. The output
under `go test -v` looks like:

```
=== RUN   TestReverse
=== RUN   TestReverse/empty
=== RUN   TestReverse/ascii
=== RUN   TestReverse/unicode
=== RUN   TestReverse/palindrome
--- PASS: TestReverse (0.00s)
    --- PASS: TestReverse/empty (0.00s)
    --- PASS: TestReverse/ascii (0.00s)
    --- PASS: TestReverse/unicode (0.00s)
    --- PASS: TestReverse/palindrome (0.00s)
PASS
```

Each subtest gets its own `RUN` line and its own `PASS` or `FAIL`
line, indented under the parent. The boilerplate cost of adding a new
case is now exactly one line: a struct literal in the table.

## 3. What `t.Run` actually does

The signature from the `testing` package is:

```go
func (t *T) Run(name string, f func(t *T)) bool
```

A few things to understand:

1. `t.Run` is a method on `*testing.T`. The `t` inside the closure
   parameter is a different value: it represents the subtest, not the
   parent. The subtest has its own failure flag, its own cleanup
   stack, and its own parallelism state.
2. `f` runs in a new goroutine. The framework manages this for you,
   but it means you cannot use `runtime.Goexit` semantics that rely
   on the caller's goroutine. Practically: `t.FailNow` still works,
   because `*testing.T` knows which goroutine to terminate.
3. The call blocks until `f` returns or `f` calls `t.Parallel()`. We
   will come back to parallel in a later section.
4. The return value is `true` if the subtest passed (or has not failed
   yet at the moment it called `t.Parallel`). You rarely need it
   because failures are already recorded on the parent.

You can verify the goroutine claim by printing goroutine IDs (not
recommended in production tests, but instructive once):

```go
func TestGoroutine(t *testing.T) {
    t.Logf("parent goroutine starts")
    t.Run("child", func(t *testing.T) {
        t.Logf("child running")
    })
    t.Logf("parent resumes")
}
```

Run with `-v` and notice the child's body interleaves with the
parent's `Run` call from the framework's perspective, even though to
your eye the parent appears to "wait" for the child.

## 4. Names and the hierarchy

Subtest names are joined to their parent with `/`. The full name of
the `ascii` subtest above is `TestReverse/ascii`. If you nest further:

```go
func TestParse(t *testing.T) {
    t.Run("ints", func(t *testing.T) {
        t.Run("positive", func(t *testing.T) { /* ... */ })
        t.Run("negative", func(t *testing.T) { /* ... */ })
    })
    t.Run("floats", func(t *testing.T) {
        t.Run("normal", func(t *testing.T) { /* ... */ })
        t.Run("nan", func(t *testing.T) { /* ... */ })
    })
}
```

The full names are:

```
TestParse/ints/positive
TestParse/ints/negative
TestParse/floats/normal
TestParse/floats/nan
```

Spaces in the `name` argument are converted to underscores in the
hierarchical name. Non-printable runes are escaped. Duplicate names
within the same parent get numeric suffixes: a second
`t.Run("case", ...)` under the same parent becomes `TestX/case#01`.
This is rarely what you want; the suffix is the framework's way of
saying "you have a bug".

```go
func TestDuplicate(t *testing.T) {
    t.Run("case", func(t *testing.T) {})
    t.Run("case", func(t *testing.T) {}) // becomes case#01
    t.Run("case", func(t *testing.T) {}) // becomes case#02
}
```

Output:

```
=== RUN   TestDuplicate
=== RUN   TestDuplicate/case
=== RUN   TestDuplicate/case#01
=== RUN   TestDuplicate/case#02
```

If you see `#01` suffixes in your suite, treat them as a smell and
rename the cases for clarity.

## 5. Filtering with `-run`

The `-run` flag selects which tests run. With subtests it accepts a
`/`-separated list of regular expressions, one per level:

```
go test -run 'TestReverse'           # whole test, all subtests
go test -run 'TestReverse/unicode'   # only the unicode subtest
go test -run '^TestReverse$/^as'     # anchored: matches ascii
```

Two important details:

1. Each segment is an unanchored regex by default, so `valid` matches
   both `valid_input` and `also_valid`. Use `^valid$` to be exact.
2. Skipping is symmetric: `-skip` (Go 1.20+) takes the same shape and
   excludes matching tests.

A handy combination:

```
go test -run TestParse -skip 'TestParse/^slow_'
```

This runs all `TestParse` subtests except those starting with
`slow_`. Without `-skip`, you would have to manually list every
non-slow case in the `-run` pattern, which is fragile.

### Building intuition with examples

Given the test:

```go
func TestX(t *testing.T) {
    t.Run("alpha", func(t *testing.T) {})
    t.Run("beta", func(t *testing.T) {})
    t.Run("alpha_long", func(t *testing.T) {})
    t.Run("alpha_short", func(t *testing.T) {})
}
```

Predict what runs for each invocation:

- `go test -run TestX/alpha` → `alpha`, `alpha_long`, `alpha_short`
  (prefix match).
- `go test -run TestX/^alpha$` → only `alpha` (anchored).
- `go test -run TestX/_short` → `alpha_short` (suffix match).
- `go test -run TestX -skip TestX/^beta$` → `alpha`, `alpha_long`,
  `alpha_short`.

This is the level of fluency you want with `-run`. Practice on your
own table tests until you can do this in your head.

## 6. Failure propagation

When a subtest fails, its parent is also marked failed:

```go
func TestExample(t *testing.T) {
    t.Run("ok", func(t *testing.T) { /* passes */ })
    t.Run("bad", func(t *testing.T) {
        t.Errorf("this case fails")
    })
    t.Run("ok2", func(t *testing.T) { /* passes */ })
}
```

Output:

```
--- FAIL: TestExample (0.00s)
    --- PASS: TestExample/ok (0.00s)
    --- FAIL: TestExample/bad (0.00s)
        example_test.go:7: this case fails
    --- PASS: TestExample/ok2 (0.00s)
FAIL
```

`TestExample` itself runs to completion: sibling subtests continue
even after `bad` fails. But the parent is marked failed so the package
exit code is non-zero. This is usually what you want: you see every
failing case, not just the first.

If you want a subtest to stop on first failure within itself, use
`t.Fatal` or `t.FailNow` inside the subtest. That terminates only the
subtest's goroutine. Siblings still run:

```go
func TestExample(t *testing.T) {
    t.Run("bad", func(t *testing.T) {
        t.Fatal("aborting this case")
        t.Log("never reached")
    })
    t.Run("ok", func(t *testing.T) { /* still runs */ })
}
```

If you really want to stop the parent and all remaining siblings, call
`t.Fatal` in the parent (outside any `t.Run`), or `t.Fatal` in the
first subtest will stop only that subtest. There is no single call
that says "stop all sibling subtests"; you must structure the code so
the loop body checks a flag and bails out:

```go
func TestAbortOnFirst(t *testing.T) {
    for _, tc := range cases {
        if t.Failed() {
            break // abort remaining cases
        }
        t.Run(tc.name, func(t *testing.T) { check(t, tc) })
    }
}
```

`t.Failed()` returns `true` if the parent has been marked failed,
which happens after the previous subtest failed.

## 7. `t.Cleanup` inside subtests

Every `*testing.T` has its own LIFO cleanup stack. Functions you
register with `t.Cleanup` run when that particular test (or subtest)
ends:

```go
func TestCleanup(t *testing.T) {
    t.Cleanup(func() { fmt.Println("parent cleanup") })
    t.Run("a", func(t *testing.T) {
        t.Cleanup(func() { fmt.Println("a cleanup 1") })
        t.Cleanup(func() { fmt.Println("a cleanup 2") })
    })
    t.Run("b", func(t *testing.T) {
        t.Cleanup(func() { fmt.Println("b cleanup") })
    })
}
```

Output:

```
a cleanup 2
a cleanup 1
b cleanup
parent cleanup
```

Two rules to remember:

1. Each subtest's cleanups drain in LIFO order before control returns
   to the parent's next statement.
2. The parent's cleanups drain after all of its subtests finish, also
   in LIFO order.

Why LIFO? Because cleanups usually mirror setup: if you opened a
database connection, then opened a transaction inside it, you must
roll back the transaction before closing the connection. LIFO
guarantees that order without you thinking about it.

A common pattern:

```go
func setupServer(t *testing.T) *Server {
    t.Helper()
    srv := newServer()
    t.Cleanup(func() {
        if err := srv.Shutdown(context.Background()); err != nil {
            t.Logf("shutdown: %v", err)
        }
    })
    return srv
}
```

The helper registers cleanup on the caller's `t`. When the caller is
a subtest, cleanup runs when the subtest ends. When the caller is a
top-level test, cleanup runs when the test ends. Either way, the
caller never needs to remember to call `Close`.

## 8. Skipping subtests

`t.Skip` marks the current test as skipped and stops it from running
further code:

```go
func TestNet(t *testing.T) {
    t.Run("offline", func(t *testing.T) {
        if os.Getenv("NET") == "" {
            t.Skip("no network")
        }
        // ... network test
    })
    t.Run("online", func(t *testing.T) {
        // always runs
    })
}
```

Skipping the `offline` subtest does not skip `online` or `TestNet`
itself. Output reports `--- SKIP: TestNet/offline`.

If you want to skip every subtest, call `t.Skip` in the parent
before any `t.Run`. The parent stops there, and no subtests are
created:

```go
func TestIntegration(t *testing.T) {
    if testing.Short() {
        t.Skip("integration tests skipped in short mode")
    }
    t.Run("create", ...)
    t.Run("read", ...)
}
```

Distinguishing `Skip` from `return`:

```go
t.Run("bad", func(t *testing.T) {
    if shouldSkip() {
        return // BUG: subtest is marked PASS
    }
    /* ... */
})
```

Using `return` instead of `t.Skip` makes the subtest pass silently.
The CI dashboard shows a green case that did nothing. Always use
`t.Skip` so the test is reported as skipped, not passed.

## 9. Reading `-v` output

A representative run might look like:

```
=== RUN   TestParse
=== RUN   TestParse/ints
=== RUN   TestParse/ints/positive
=== RUN   TestParse/ints/negative
=== PAUSE TestParse/ints/negative
=== RUN   TestParse/floats
--- PASS: TestParse/ints/positive (0.00s)
=== CONT  TestParse/ints/negative
--- PASS: TestParse/ints/negative (0.00s)
--- PASS: TestParse/ints (0.00s)
--- PASS: TestParse/floats (0.00s)
--- PASS: TestParse (0.00s)
```

Decoding the verbs:

- `=== RUN` is printed when a test starts.
- `=== PAUSE` appears when a test calls `t.Parallel()`. The test
  pauses until the parent's non-parallel siblings finish.
- `=== CONT` resumes a paused test.
- `--- PASS`, `--- FAIL`, `--- SKIP` are end-of-test markers.

Indentation in the final block reflects the parent/child
relationship. The duration in parentheses is the wall-clock time the
test spent active (not counting paused time, for parallel tests).

If you run without `-v`, only failures and a summary are shown:

```
--- FAIL: TestParse/ints/negative (0.00s)
    parse_test.go:42: got 0, want -3
FAIL
exit status 1
FAIL    example.com/parse 0.005s
```

For day-to-day debugging, `go test -v -run TestX/case` gives the
clearest picture: one case, full output.

## 10. A first table-driven test

Most production codebases use subtests in table-driven form. The
standard shape:

```go
func TestClassify(t *testing.T) {
    type tc struct {
        name string
        in   int
        want string
    }
    cases := []tc{
        {"zero", 0, "zero"},
        {"negative", -3, "negative"},
        {"positive", 7, "positive"},
        {"large_positive", 1 << 30, "positive"},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            got := Classify(c.in)
            if got != c.want {
                t.Errorf("Classify(%d)=%q want %q", c.in, got, c.want)
            }
        })
    }
}
```

This pattern is so common that it has a name in the Go community:
"table-driven tests with subtests". Many linters and IDE refactorings
target this exact shape.

A few stylistic conventions:

- Name the struct `tc` (test case) inside the function. It is local
  and disposable; a long name adds noise.
- Use `name` as the first field. Convention; helps grep.
- Use `in` and `want` as field names. Easier than `input`/`expected`.
- Keep struct literals on one line when they fit; one per line when
  fields are long.

## 11. Choosing subtest names

Good names are:

- Short (fit on one screen in `-v` output).
- Stable (CI dashboards group by name; rename = lose history).
- Filterable (avoid characters that need regex escaping in `-run`).
- Descriptive (`empty_input` beats `case1`).

Examples:

```go
t.Run("empty_input", ...)
t.Run("single_byte_utf8", ...)
t.Run("multibyte_utf8", ...)
t.Run("invalid_continuation_byte", ...)
```

Avoid spaces; they get rewritten to underscores anyway, and using
them makes `-run` patterns awkward to type.

Avoid regex metacharacters in names: parentheses, dots, plus signs,
question marks. They are legal in the name but require escaping in
`-run`. Stick to letters, digits, underscores, hyphens.

Avoid varying-length numeric IDs: `case_1`, `case_2`, ..., `case_99`,
`case_100` will sort lexicographically (`case_10` before `case_2`).
Either zero-pad (`case_001`) or use descriptive names.

## 12. Nested subtests

You can nest `t.Run` arbitrarily, but two levels is usually the
practical limit:

```go
func TestHTTPHandler(t *testing.T) {
    t.Run("GET", func(t *testing.T) {
        t.Run("found", func(t *testing.T) { /* ... */ })
        t.Run("not_found", func(t *testing.T) { /* ... */ })
    })
    t.Run("POST", func(t *testing.T) {
        t.Run("valid", func(t *testing.T) { /* ... */ })
        t.Run("invalid", func(t *testing.T) { /* ... */ })
    })
}
```

Three levels is sometimes appropriate when you have a clear grouping,
but `-run` patterns become awkward and `-v` output gets noisy:

```
TestHTTP/v1/users/create/valid_token
```

That is a lot to type. If you find yourself wanting four levels,
flatten one: combine `users/create` into a single name `users_create`.

## 13. The classic loop variable bug (pre-Go 1.22)

This is the most famous gotcha in subtest-based tests. Until Go
1.22, the loop variable in a `for` range was shared across all
iterations:

```go
// Pre-Go 1.22: bug
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc) // surprise: tc is the same variable each iteration
    })
}
```

When you called `t.Parallel`, the subtest paused until the loop
finished. By that time, `tc` held the last value. Every parallel
subtest then saw the same final case.

The traditional fix was to shadow `tc`:

```go
for _, tc := range cases {
    tc := tc // create a fresh variable in this iteration
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc)
    })
}
```

Go 1.22 changed `for` loop semantics so each iteration declares
fresh copies of the loop variables. With `go 1.22` in `go.mod`, the
`tc := tc` line is unnecessary. The Go 1.22 release notes call this
the "loop variable scoping" change.

If you maintain a codebase that still targets older Go versions,
keep the shadow line. Once `go.mod` says `go 1.22` or later, the
linter rule `copyloopvar` will flag the now-redundant shadowing.

### A reproducer

If you have access to a Go 1.21 installation, run this:

```go
package main_test

import (
    "fmt"
    "testing"
)

func TestLoopVar(t *testing.T) {
    cases := []int{1, 2, 3, 4}
    for _, n := range cases {
        t.Run(fmt.Sprintf("n=%d", n), func(t *testing.T) {
            t.Parallel()
            t.Logf("n is %d", n)
        })
    }
}
```

Under Go 1.21 with `go 1.21` in `go.mod`, every subtest logs `n is
4`. Under Go 1.22+ with `go 1.22` in `go.mod`, each subtest logs its
own iteration value. Try it once; the surprise reinforces the rule.

## 14. `t.Parallel` inside subtests

`t.Parallel()` signals that the test can run in parallel with other
parallel tests. Inside subtests it has a specific meaning:

```go
func TestParallel(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            check(tc)
        })
    }
}
```

The framework runs each subtest as follows:

1. The subtest starts; the body executes until `t.Parallel`.
2. At `t.Parallel`, the subtest pauses, the parent's `Run` returns,
   and the loop moves on to the next iteration.
3. Once all of the parent's non-parallel work has finished, the
   paused subtests resume together, bounded by the `-parallel N`
   flag (default is `GOMAXPROCS`).
4. The parent waits for all parallel subtests to finish before its
   own cleanup runs.

This is why the loop-variable bug bites: by the time the paused
subtests resume, the loop is over.

### Wall-clock speedup demo

Add a small sleep to each subtest and observe:

```go
func TestSlow(t *testing.T) {
    for i := 0; i < 4; i++ {
        i := i
        t.Run(fmt.Sprintf("c%d", i), func(t *testing.T) {
            t.Parallel()
            time.Sleep(100 * time.Millisecond)
        })
    }
}
```

Without `t.Parallel`, this takes ~400ms. With `t.Parallel` and
`-parallel 4`, it takes ~100ms. The framework runs all four
subtests concurrently after the parent's loop ends.

## 15. Subtests vs separate functions

You will encounter both styles. Use this rough rule:

- Use subtests when cases share a setup or are variations of one
  behavior.
- Use separate functions when behaviors are unrelated or have very
  different setups.

A common compromise: one `TestParse` with subtests for valid inputs,
plus separate `TestParse_panic` and `TestParse_concurrent` functions
for specialty cases. IDE test runners list each `TestXxx`
separately, which is sometimes the deciding factor.

### Anti-example

```go
func TestEverything(t *testing.T) {
    t.Run("Parse", func(t *testing.T) { /* 50 lines */ })
    t.Run("Encode", func(t *testing.T) { /* 50 lines */ })
    t.Run("Decode", func(t *testing.T) { /* 50 lines */ })
}
```

This is not subtest abuse, but it is close. If `Parse`, `Encode`,
and `Decode` share nothing, give them their own `TestParse`,
`TestEncode`, `TestDecode` functions. Subtests should be variations
of one thing.

### Counter-example

```go
func TestParseInt(t *testing.T) { /* ... */ }
func TestParseIntNegative(t *testing.T) { /* ... */ }
func TestParseIntZero(t *testing.T) { /* ... */ }
func TestParseIntOverflow(t *testing.T) { /* ... */ }
```

These are clearly variations of `Parse`. Roll them into one
`TestParseInt` with subtests.

## 16. Common mistakes to avoid

1. Forgetting to anchor `-run` patterns. `go test -run TestParse/valid`
   matches `valid_input`, `valid_strict`, `also_valid`, etc. Anchor
   with `^...$`.
2. Calling `parent.Cleanup` from inside a subtest helper. Always use
   the subtest's own `t.Cleanup`, or you delay cleanup until the
   parent finishes.
3. Sharing mutable state between parallel subtests. Run with `-race`
   to catch this.
4. Using `t.Run` to assert a single condition. If there is no table
   and no shared setup, a plain test function is clearer.
5. Naming subtests with characters that look fine in source but are
   awkward in regex (parentheses, dots). Stick to letters, digits,
   underscores, and hyphens.
6. Using `return` instead of `t.Skip` to bail out of a subtest. The
   `return` path silently marks the test passed.
7. Calling `t.Errorf` from a goroutine that may outlive the subtest.
   The framework panics with `Fail in goroutine after TestX/case has
   completed`. Always synchronize.

## 17. A complete example

Putting it all together: a small table-driven test for an HTTP
validator, with parallelism, cleanup, and clear naming.

```go
func TestValidateForm(t *testing.T) {
    t.Cleanup(func() { /* shared teardown */ })

    cases := []struct {
        name    string
        body    string
        wantErr string
    }{
        {"empty", "", "missing name"},
        {"valid", `{"name":"go"}`, ""},
        {"too_long_name", `{"name":"` + strings.Repeat("a", 1000) + `"}`, "name too long"},
        {"invalid_json", `{`, "invalid json"},
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            err := ValidateForm([]byte(tc.body))
            switch {
            case err == nil && tc.wantErr != "":
                t.Fatalf("got nil, want error containing %q", tc.wantErr)
            case err != nil && tc.wantErr == "":
                t.Fatalf("unexpected error: %v", err)
            case err != nil && !strings.Contains(err.Error(), tc.wantErr):
                t.Fatalf("error %q does not contain %q", err, tc.wantErr)
            }
        })
    }
}
```

Run a single case:

```
go test -v -run 'TestValidateForm/^invalid_json$'
```

Run only the valid cases:

```
go test -v -run 'TestValidateForm/^valid$'
```

Run everything except the slow case:

```
go test -v -run TestValidateForm -skip 'TestValidateForm/^too_long_name$'
```

These three flags together (`-v`, `-run`, `-skip`) give you precise
control during iterative development.

## 18. Comparing failures across cases

When several subtests fail at once, the `-v` output groups them
under the parent. To get a summary without the verbose chatter, drop
`-v` and grep:

```
go test ./... 2>&1 | grep -E '^(---|FAIL)'
```

This prints one line per failure plus the package-level FAIL line.
For CI, prefer `go test -json` and a tool like `gotestsum`, which
gives you structured output.

## 19. Subtests with examples

Go has a separate `Example` convention for runnable examples that
double as tests. Examples do not use `t.Run`; they have their own
structure. Briefly:

```go
func ExampleReverse() {
    fmt.Println(strutil.Reverse("hello"))
    // Output: olleh
}
```

If you need parameterized examples, just write separate `Example`
functions; there is no `ExampleX_subtest`. Examples and subtests do
not interact.

## 20. Practice exercises

1. Convert this set of functions to one table-driven test with
   subtests:

   ```go
   func TestUpper_empty(t *testing.T) { ... }
   func TestUpper_ascii(t *testing.T) { ... }
   func TestUpper_unicode(t *testing.T) { ... }
   ```

2. Given the test:

   ```go
   func TestX(t *testing.T) {
       t.Run("foo", func(t *testing.T) {})
       t.Run("foo_bar", func(t *testing.T) {})
       t.Run("foo_baz", func(t *testing.T) {})
   }
   ```

   Write the `-run` value that runs only `foo` (not `foo_bar` or
   `foo_baz`).

3. Add `t.Parallel` to the table-driven test from exercise 1. Make
   sure it works on Go 1.21 (with shadow) and on Go 1.22+ (without
   shadow).

4. Register a `t.Cleanup` in a subtest and another in the parent.
   Predict the order they fire. Verify with a print statement.

5. Use `t.Skip` to skip a subtest based on a build flag. Confirm
   `--- SKIP` appears in `-v` output, not `--- PASS`.

## 21. Where to go next

The Middle page covers `TestMain` interaction, sharing state across
subtests safely, and reading the JSON event stream from
`go test -json`. The Senior page goes deep into the parallel
scheduler and pre-Go 1.22 history. The Find-the-Bug and Optimize
pages give targeted exercises for spotting and fixing common
subtest issues.

If you only learn one thing from this page, learn this: subtests
turn a bag of independent test functions into a structured,
filterable, parallelizable group. Use them whenever you have more
than one variation of the same behavior, and use `t.Parallel`
whenever those variations are independent.

## 22. Frequently asked questions

### Q: Do I need subtests at all? Can I just write one big assertion list?

You can, and for trivially short tests it is fine. But once a test
checks more than one case, putting them in subtests gives you:

- One failure message per case (instead of one cascading message).
- The ability to run one case in isolation via `-run`.
- Clear `-v` output.

The cost is one extra line per case (`t.Run(name, func(t *testing.T) {`).
That price is almost always worth paying for tests of three or more
cases.

### Q: Can the subtest closure call methods on the parent's `t`?

Technically yes, since `t` is in scope. Practically no, you should not.
Calling `parent.Errorf` from a subtest reports the failure against the
parent, bypassing the subtest's own reporting. CI dashboards lose the
ability to identify which case failed. Always use the inner `t` passed
to the closure.

### Q: How do I share a `*testing.T`-bound helper across subtests?

Pass the subtest's `t` to the helper:

```go
func newClient(t *testing.T) *Client {
    t.Helper()
    c := &Client{...}
    t.Cleanup(c.Close)
    return c
}

func TestThing(t *testing.T) {
    t.Run("a", func(t *testing.T) {
        c := newClient(t)
        c.Do()
    })
    t.Run("b", func(t *testing.T) {
        c := newClient(t)
        c.Do()
    })
}
```

Each subtest gets its own client, cleanup runs at subtest end.

### Q: My subtest fails but the line number in the error points to a helper, not the subtest. How do I fix that?

Call `t.Helper()` as the first statement of the helper:

```go
func assertEq(t *testing.T, got, want int) {
    t.Helper()
    if got != want {
        t.Errorf("got %d, want %d", got, want)
    }
}
```

`t.Helper` marks the function as a helper; failures from it are
attributed to the caller's line. Add `t.Helper` to every helper that
calls `t.Errorf`, `t.Fatal`, `t.Skip`, or any of their variants.

### Q: I added `t.Parallel` to subtests and they suddenly fail. Why?

Three common causes:

1. Pre-Go 1.22 loop variable capture (see section 13). Add
   `tc := tc` inside the loop body or upgrade `go.mod`.
2. Shared mutable state. Run with `-race` to spot it.
3. Ordering dependency. If subtest `b` relies on subtest `a` having
   run first, parallel scheduling breaks that. Restructure so each
   subtest is self-contained.

### Q: How do I get the same parallelism without `t.Parallel`?

You cannot, easily. `t.Parallel` is the only way to opt a subtest into
the parallel scheduler. Without it, subtests run sequentially. Even
running `go test -parallel 8` does not change the behavior of tests
that do not call `t.Parallel`; the flag only sets the cap for tests
that do.

### Q: Is there a way to set `t.Parallel` for all subtests at once?

Not built into the standard library. The `paralleltest` linter can
enforce that every subtest calls `t.Parallel`, but it does not add
the call automatically (it just warns). Some teams write a tiny
helper:

```go
func parallel(t *testing.T, name string, f func(t *testing.T)) {
    t.Run(name, func(t *testing.T) {
        t.Parallel()
        f(t)
    })
}
```

Then call `parallel(t, "case", func(t *testing.T) { ... })` instead
of `t.Run`. It is a small convenience, not a huge win.

## 23. Recap checklist

Before you move on to Middle, verify you can answer "yes" to all
of these:

- I can convert four `TestXxxA`, `TestXxxB` functions into one
  `TestXxx` with subtests.
- I can read `-v` output and identify which subtest passed or failed.
- I can write a `-run` regex that filters one specific subtest.
- I can predict the order in which `t.Cleanup` calls fire across a
  parent and two subtests.
- I can explain the pre-Go 1.22 loop variable bug and the fix.
- I know to use `t.Skip`, not `return`, to skip a subtest.
- I know that `t.Parallel` inside a subtest pauses it until the
  parent's body returns.

If any of those is shaky, re-read the corresponding section. The
Middle page assumes all of this is fluent.

## 24. Walkthrough: building a test from scratch

Let's walk through writing a complete test for a function from
scratch, using subtests from the very first line. The function:

```go
// SafeDivide returns a/b. It returns ErrDivByZero when b is zero
// and ErrOverflow when a == math.MinInt and b == -1.
func SafeDivide(a, b int) (int, error) {
    if b == 0 {
        return 0, ErrDivByZero
    }
    if a == math.MinInt && b == -1 {
        return 0, ErrOverflow
    }
    return a / b, nil
}
```

Step 1: list the cases we want to cover.

- Normal positive division: `6/2 = 3`.
- Normal negative division: `-6/2 = -3`.
- Division by zero: returns `ErrDivByZero`.
- MinInt / -1: returns `ErrOverflow`.
- Division yielding zero: `0/5 = 0`.

Step 2: define the table.

```go
func TestSafeDivide(t *testing.T) {
    cases := []struct {
        name    string
        a, b    int
        want    int
        wantErr error
    }{
        {"pos_pos", 6, 2, 3, nil},
        {"neg_pos", -6, 2, -3, nil},
        {"div_by_zero", 5, 0, 0, ErrDivByZero},
        {"overflow", math.MinInt, -1, 0, ErrOverflow},
        {"zero_dividend", 0, 5, 0, nil},
    }
    // loop here
}
```

Step 3: loop with `t.Run`.

```go
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := SafeDivide(tc.a, tc.b)
            if !errors.Is(err, tc.wantErr) {
                t.Fatalf("SafeDivide(%d, %d) err = %v, want %v",
                    tc.a, tc.b, err, tc.wantErr)
            }
            if got != tc.want {
                t.Errorf("SafeDivide(%d, %d) = %d, want %d",
                    tc.a, tc.b, got, tc.want)
            }
        })
    }
```

Step 4: run it.

```
$ go test -v -run TestSafeDivide
=== RUN   TestSafeDivide
=== RUN   TestSafeDivide/pos_pos
=== RUN   TestSafeDivide/neg_pos
=== RUN   TestSafeDivide/div_by_zero
=== RUN   TestSafeDivide/overflow
=== RUN   TestSafeDivide/zero_dividend
--- PASS: TestSafeDivide (0.00s)
    --- PASS: TestSafeDivide/pos_pos (0.00s)
    --- PASS: TestSafeDivide/neg_pos (0.00s)
    --- PASS: TestSafeDivide/div_by_zero (0.00s)
    --- PASS: TestSafeDivide/overflow (0.00s)
    --- PASS: TestSafeDivide/zero_dividend (0.00s)
PASS
```

Step 5: when you add a new case (say, `int_min_div_int_min`),
you change one line of code: a new struct literal in the table. The
test machinery handles the rest.

Step 6: when you debug a specific failure, run only that subtest:

```
$ go test -v -run 'TestSafeDivide/^overflow$'
```

No noise from the four passing cases. This iteration loop is what
makes subtests so productive.

## 25. Anti-patterns to recognize

A few patterns you will see in real codebases that are easy to spot
once you know what to look for:

### Anti-pattern A: subtest as glorified comment

```go
func TestParse(t *testing.T) {
    t.Run("test 1", func(t *testing.T) {
        // body
    })
    t.Run("test 2", func(t *testing.T) {
        // body
    })
}
```

Names like `test 1`, `test 2`, `subtest 1` are useless. They give no
hint about what is being tested. Rename to describe the behavior:
`empty_input`, `unicode_path`, `nil_pointer`.

### Anti-pattern B: shared mutable counter

```go
var count int
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        count++
        if count != tc.expectedCount {
            t.Errorf("...")
        }
    })
}
```

`count` couples subtests to their execution order. Run any one in
isolation and it fails. Drop the counter; it tests nothing useful.

### Anti-pattern C: ignoring the inner `t`

```go
func TestSomething(t *testing.T) {
    t.Run("case", func(*testing.T) { // note: no name for the param
        if got, want := compute(), 5; got != want {
            t.Errorf("got %d, want %d", got, want)
            // BUG: uses outer t, attributing failure to the parent
        }
    })
}
```

If you discard the parameter, you cannot mark the subtest failed. You
have to use the outer `t`, which means failures appear against the
parent. Always name the parameter `t` (shadowing the outer one) and
use it for assertions.

### Anti-pattern D: cleanup that races with siblings

```go
var resource *Thing
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        resource = open(tc) // race
        t.Cleanup(func() { resource.Close() }) // race
        // ...
    })
}
```

`resource` is a package-level variable mutated by parallel subtests.
Make it local:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        resource := open(tc)
        t.Cleanup(func() { resource.Close() })
        // ...
    })
}
```

Now each subtest has its own `resource`, race-free.

## 26. Subtests as documentation

Subtests double as living documentation. A reader of your test file
can scan the names and learn what the function is supposed to do:

```go
func TestParseDuration(t *testing.T) {
    t.Run("simple_seconds", ...)       // "5s" => 5*time.Second
    t.Run("compound", ...)             // "1h30m" => 90 minutes
    t.Run("zero", ...)                 // "0" => 0
    t.Run("negative", ...)             // "-5s" => -5*time.Second
    t.Run("missing_unit_error", ...)
    t.Run("unknown_unit_error", ...)
    t.Run("overflow_error", ...)
}
```

That's a specification document hiding inside a test file. Treat
naming as part of your API design; future readers will thank you.

## 27. Build tag interaction

Subtests share the file's build tags. If you have:

```go
//go:build integration

package mypkg

func TestIntegration(t *testing.T) {
    t.Run("a", ...)
    t.Run("b", ...)
}
```

The whole file (and therefore all subtests) is only compiled when
`-tags integration` is passed. You cannot have subtest `a` always
present and subtest `b` only on a tag; the granularity is the file.

If you need that granularity, split the subtests across two files:

```go
// file_a_test.go (no build tag)
func TestIntegration_A(t *testing.T) {
    /* always present */
}

//go:build integration
// file_b_test.go
func TestIntegration_B(t *testing.T) {
    /* only with -tags integration */
}
```

Two top-level test functions, but each is unconditionally present
within its own build configuration.

## 28. A note on test files vs test functions

Subtests live inside a test function (`func TestXxx(t *testing.T)`).
The function lives in a test file (`*_test.go`). The file lives in a
package (`go test` runs one binary per package).

The hierarchy is:

```
package -> file -> function -> subtest -> sub-subtest -> ...
```

When you see `TestPackage/sub`, the `sub` part is at the subtest
level, not the file level. Files have no representation in test
names; they only influence what is compiled.

## 29. Pulling it all together

If a teammate hands you a 200-line `*_test.go` with twenty
`TestParseXxxYyy` functions, your first move should be to ask
whether they should be one `TestParse` with subtests. The
refactoring usually reveals:

- Shared setup that can be extracted to a helper.
- Cases that should be in a table instead of repeated code.
- Cases that are actually duplicates (same input/output, different
  name) that can be deleted.
- Cases that test unrelated behavior and should stay as separate
  functions.

That cleanup pass usually shrinks the file by 30-50% and makes future
edits much faster.

## 30. Closing thoughts

Subtests are one of those Go features that look small in isolation
and turn out to be transformative once you use them in anger.
`t.Run` is just a method, but the conventions that grew around it
(table-driven layout, parallel by default, clean naming) shape how
the Go community writes tests today.

Internalize the patterns from this page, practice them on a real
codebase, and then move on to Middle for the next layer: TestMain
integration, shared fixtures, and the JSON event protocol used by
CI tooling.


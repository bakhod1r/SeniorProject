---
layout: default
title: Subtests — Middle
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/middle/
---

# Subtests — Middle

[← Back](../)

You already know how to write table-driven tests with `t.Run`. This page
goes one layer deeper: how subtests interact with `TestMain`, how to
share fixtures safely across parallel subtests, how `-run` regexes
really match, and how the JSON event stream represents subtests for CI.

## 1. The execution model in one diagram

```
go test
 |
 v
TestMain (if defined)        per package, runs once
 |   |
 |   v
 |  m.Run()
 |   |
 |   v   --- per TestXxx ---
 |   parent TestXxx goroutine
 |      |
 |      +-- t.Run("a", ...)     blocks until child returns or calls t.Parallel
 |      |     |
 |      |     +-- child a goroutine
 |      |
 |      +-- t.Run("b", ...)
 |            |
 |            +-- child b goroutine
 |
 |   (after parent body returns, framework waits for all parallel children)
 |
 v
TestMain continues after m.Run()
```

The `*testing.T` for each level carries:

- Its own failure flag (set by `Fail`, `Errorf`, panic, race).
- Its own cleanup stack (LIFO, drained when the test ends).
- A pointer to its parent. Failure propagates up by marking each
  ancestor's flag.
- A parallelism state (sequential, paused, running parallel, done).

## 2. `TestMain` and subtests

`TestMain` runs once per package before any tests. It is not a hook for
subtests:

```go
func TestMain(m *testing.M) {
    setupGlobalFixture()
    code := m.Run()
    teardownGlobalFixture()
    os.Exit(code)
}
```

`m.Run()` invokes every `TestXxx` function; subtests live inside those
functions and are invisible to `TestMain`. There is no `BeforeSubtest`
hook. If you need per-subtest setup, do it inside the subtest body or
register a `t.Cleanup` for teardown.

A common pattern when you need a process-wide resource:

```go
var dbPool *sql.DB

func TestMain(m *testing.M) {
    var err error
    dbPool, err = sql.Open("pgx", os.Getenv("TEST_DB"))
    if err != nil {
        log.Fatal(err)
    }
    code := m.Run()
    _ = dbPool.Close()
    os.Exit(code)
}

func TestUsers(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            tx, err := dbPool.BeginTx(t.Context(), nil)
            if err != nil { t.Fatal(err) }
            t.Cleanup(func() { _ = tx.Rollback() })
            // ... use tx
        })
    }
}
```

`t.Context()` was added in Go 1.24; on older versions use
`context.Background()`.

## 3. Sharing state across subtests

Subtests share the parent's lexical scope, so any variable declared in
the parent is accessible:

```go
func TestServer(t *testing.T) {
    srv := newServer(t) // helper that registers t.Cleanup(srv.Close)

    t.Run("health", func(t *testing.T) {
        resp, _ := http.Get(srv.URL + "/health")
        if resp.StatusCode != 200 { t.Fatal("not healthy") }
    })

    t.Run("metrics", func(t *testing.T) {
        resp, _ := http.Get(srv.URL + "/metrics")
        if resp.StatusCode != 200 { t.Fatal("no metrics") }
    })
}
```

This is fine when the shared resource is read-only or thread-safe and
when subtests do not depend on each other's execution order.

### Pitfall: mutable shared state

```go
func TestCounter(t *testing.T) {
    var seen []string

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            seen = append(seen, tc.name) // race
        })
    }
}
```

Multiple parallel goroutines write `seen` without synchronization.
`go test -race` flags this immediately. Fix options:

1. Make `seen` a `sync.Map` or guard with `sync.Mutex`.
2. Use a per-subtest local variable and discard the cross-test
   bookkeeping.
3. Drop `t.Parallel` if subtests truly depend on each other (a sign
   that they should be one test).

### Pitfall: implicit ordering

```go
func TestPipeline(t *testing.T) {
    var doc Document
    t.Run("create", func(t *testing.T) { doc = create() })
    t.Run("update", func(t *testing.T) { doc = update(doc) })
    t.Run("delete", func(t *testing.T) { delete(doc) })
}
```

This works today because sequential subtests run in declaration order.
But:

- If you ever add `t.Parallel` to any of them, the assumption breaks.
- `-run TestPipeline/update` runs the second subtest alone, with a zero
  `doc`, and produces a confusing failure.
- A future refactor that randomizes case order (a feature requested by
  some teams) would silently break.

If ordering matters, write one test, not three subtests.

## 4. `-run` regex deep dive

The `-run` value is split on `/`. Each segment is compiled with
`regexp.Compile`. Each test in the tree must match its level's regex (or
have no regex at that level) to be considered.

```
go test -run 'TestA|TestB/foo'
```

This means:

- Top level: regex `TestA|TestB`. Matches both `TestA` and `TestB`.
- Second level: regex `foo`. Only applied when descending into a parent
  that matched.

So `TestA` runs fully (no second-level filter applies to it because the
second segment is only evaluated for second-level subtests). Actually,
the semantics here surprise people: when the segment is present, all
children of all matched parents are filtered. To get "run all of
TestA and only the `foo` subtest of TestB", use two passes:

```
go test -run TestA
go test -run TestB/foo
```

Or in one invocation with a more precise top-level regex:

```
go test -run '^TestA$|^TestB$/^foo$'
```

Hmm, that does not work either because the slash applies to the whole
`-run` value, not per alternative. The pragmatic answer: keep `-run`
patterns simple, one path at a time. Use `-skip` (Go 1.20+) for negative
filtering.

### `-skip` (Go 1.20+)

```
go test -run TestParse -skip 'TestParse/^slow_'
```

`-skip` follows the same `/`-segmented regex shape. A test matched by
`-skip` is skipped even if it would have been selected by `-run`.

## 5. Cleanup ordering across levels

Three rules, in order of importance:

1. Cleanups on a given `*testing.T` run in LIFO order when that test
   ends.
2. A subtest's cleanups run before the parent's `Run` returns (for
   sequential subtests) or before the parent's own cleanups (for
   parallel subtests).
3. The parent's cleanups run after every subtest, including parallel
   ones, has finished.

Worked example:

```go
func TestCleanup(t *testing.T) {
    var log []string
    add := func(s string) { log = append(log, s) }

    t.Cleanup(func() { add("parent end") })

    t.Run("a", func(t *testing.T) {
        t.Cleanup(func() { add("a end") })
        add("a body")
    })

    t.Run("b", func(t *testing.T) {
        t.Cleanup(func() { add("b end 1") })
        t.Cleanup(func() { add("b end 2") })
        add("b body")
    })

    add("parent body")

    t.Cleanup(func() {
        t.Logf("log: %v", log)
    })
}
```

Final `log`:

```
[a body a end b body b end 2 b end 1 parent body]
```

And the logger runs last, so its output includes the final state.
Note: the `parent end` cleanup runs after the logger because we
registered it first; LIFO drains the logger before the older entry.

## 6. Cleanup with parallel subtests

Parallel subtests change the timing but not the rules:

```go
func TestParallelCleanup(t *testing.T) {
    var mu sync.Mutex
    var log []string
    add := func(s string) {
        mu.Lock(); defer mu.Unlock(); log = append(log, s)
    }

    t.Cleanup(func() { add("parent cleanup") })

    for _, name := range []string{"a", "b", "c"} {
        name := name
        t.Run(name, func(t *testing.T) {
            t.Parallel()
            t.Cleanup(func() { add(name + " cleanup") })
            add(name + " body")
        })
    }

    add("parent body")

    t.Cleanup(func() {
        // runs after subtests complete
        t.Logf("log: %v", log)
    })
}
```

Order of events:

1. Parent body executes: appends `parent body`.
2. Loop runs `t.Run` three times; each subtest body pauses at
   `t.Parallel` so the body never actually executes during the loop.
3. Parent's `TestParallelCleanup` function returns.
4. Framework resumes parallel subtests. Each appends `X body`, then its
   cleanup fires (`X cleanup`).
5. After all subtests finish, parent cleanups drain in LIFO order. The
   logger runs first (registered last), then `parent cleanup`.

If you have the `tc := tc` shadow on Go 1.22+, the linter `copyloopvar`
flags it. Above we still write `name := name` defensively; remove it
once your `go.mod` is at `go 1.22` or later.

## 7. The Go 1.22 loop variable change in detail

Pre-Go 1.22 spec: "The iteration variables may be declared by the
`for` clause using a form of short variable declaration (`:=`). In this
case their scope is the block of the `for` statement and each iteration
has its own new variables." That was true for the three-clause form,
but not for the `range` form, where the variable was declared once.

Go 1.22 spec: "Each iteration has its own separate declared variable."
For `range` loops too. The change is gated on the `go.mod` directive:
`go 1.22` opts in; older directives keep the legacy behavior so
existing modules are not silently broken.

You can also opt in/out via `GOEXPERIMENT=loopvar` (Go 1.21) or check
behavior with `go vet -loopclosure` (still warns when a closure
captures a loop variable on legacy versions).

What this means for subtests:

```go
// Go 1.22+: no shadow needed
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc) // tc is iteration-local
    })
}
```

If you target a range of Go versions, keep the shadow line; it is
harmless and only flagged by an opt-in lint rule.

## 8. JSON output and subtests

`go test -json` emits one event per line; each event has `Action`,
`Package`, `Test`, and optional `Output`. For subtests, the `Test`
field carries the full hierarchical name:

```json
{"Action":"run","Test":"TestParse"}
{"Action":"run","Test":"TestParse/valid"}
{"Action":"output","Test":"TestParse/valid","Output":"..."}
{"Action":"pass","Test":"TestParse/valid","Elapsed":0.001}
{"Action":"pass","Test":"TestParse","Elapsed":0.005}
```

A few notes for CI tooling:

- The parent receives its own `pass`/`fail` event after all subtests
  end. Dashboards that group by parent name see one row per parent.
- `Action: pause` and `Action: cont` mark `t.Parallel` transitions.
- The `Elapsed` field on a parent includes time spent waiting for
  parallel children.
- `gotestsum` and similar tools parse this stream and present subtests
  hierarchically. Without `-json` they parse the human-readable
  `=== RUN`/`--- PASS` lines, which is less robust.

## 9. Subtests in benchmark functions

`(*B).Run` is the benchmark counterpart of `(*T).Run`. The semantics are
similar but with benchmark-specific scaling. Subtests in
`func TestXxx` create test cases; sub-benchmarks in `func BenchmarkXxx`
create benchmark cases. They do not mix: a `t.Run` inside a `BenchmarkXxx`
will not compile because `b` is `*testing.B`, not `*testing.T`.

The "Subtests" terminology in this section refers strictly to the test
side. The benchmark side is covered in the dedicated benchmarks section
of this roadmap.

## 10. Helpers and `t.Helper`

When you extract assertion logic into a helper, mark it so that test
output points to the call site:

```go
func assertEq[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

func TestRun(t *testing.T) {
    cases := []struct{ name string; in, want int }{
        {"a", 1, 1},
        {"b", 2, 3}, // fails
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            assertEq(t, tc.in, tc.want)
        })
    }
}
```

Without `t.Helper`, the failure reports the line inside `assertEq`.
With it, the failure reports the line inside the subtest closure, which
is what you want for a table-driven test.

## 11. When to *not* use subtests

- One assertion, no table, no shared setup: a plain test is clearer.
- Cases with very different setups: separate functions are easier to
  read.
- Behavior under different build tags: use build tags on whole files,
  not subtests.
- Performance benchmarking: use `b.Run` (sub-benchmarks), not subtests.

## 12. CI configuration tips

A few low-friction wins for teams using subtests heavily:

- Set `-parallel` to your CPU count. The default is `GOMAXPROCS`, which
  is usually right but may need lowering on shared CI runners.
- Use `-shuffle=on` for top-level tests. This shuffles `TestXxx`
  order, not subtest order, so deterministic table order is preserved.
- Use `gotestsum --rerun-fails --packages=./...` for leaf-level retries.
- Configure `go test -json` output and pipe to your test reporter.
- Pin `golangci-lint` rules `copyloopvar` (Go 1.22+) and `paralleltest`
  to keep the suite consistent.

## 13. A worked migration example

You have an old test file:

```go
func TestParseValid(t *testing.T) { check(t, "1", 1, nil) }
func TestParseEmpty(t *testing.T) { check(t, "", 0, ErrEmpty) }
func TestParseLetters(t *testing.T) { check(t, "abc", 0, ErrSyntax) }

func check(t *testing.T, in string, want int, wantErr error) {
    t.Helper()
    got, err := Parse(in)
    if !errors.Is(err, wantErr) { t.Fatalf("err: got %v want %v", err, wantErr) }
    if got != want { t.Errorf("got %d want %d", got, want) }
}
```

Migrate to a table:

```go
func TestParse(t *testing.T) {
    cases := []struct {
        name    string
        in      string
        want    int
        wantErr error
    }{
        {"valid", "1", 1, nil},
        {"empty", "", 0, ErrEmpty},
        {"letters", "abc", 0, ErrSyntax},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := Parse(tc.in)
            if !errors.Is(err, tc.wantErr) {
                t.Fatalf("err: got %v want %v", err, tc.wantErr)
            }
            if got != tc.want {
                t.Errorf("got %d want %d", got, tc.want)
            }
        })
    }
}
```

What you gained:

- One place to add a new case.
- `-run TestParse/valid` filters to one case.
- One `--- FAIL: TestParse` line per case, indented under the parent.

What you lost:

- IDE test runners list `TestParse` once with a "run all" affordance,
  not three separate entries.
- You cannot apply build tags per case.

Pick the structure that fits your team's workflow. Many large
codebases use both styles in the same package.

## 14. Reference: helper utilities

Two small helpers that show up in production codebases:

```go
// withTempDir creates a temp dir and cleans it up.
func withTempDir(t *testing.T) string {
    t.Helper()
    dir, err := os.MkdirTemp("", "test-")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = os.RemoveAll(dir) })
    return dir
}

// subtest is sugar for cases where you want one closure per name.
func subtest(t *testing.T, name string, f func(t *testing.T)) {
    t.Helper()
    t.Run(name, func(t *testing.T) {
        t.Helper()
        f(t)
    })
}
```

The `subtest` helper saves no characters but documents intent in
generated test code. Use sparingly; reading `t.Run` directly is usually
clearer.

## 15. Wrap-up

You should now be comfortable with:

- The execution model of subtests inside `TestXxx`.
- `TestMain` setup and teardown around `m.Run()`.
- Sharing fixtures safely across sequential and parallel subtests.
- The Go 1.22 loop variable scope change and its effect on table-driven
  tests with `t.Parallel`.
- Reading `-v` and `-json` output to debug subtest behavior.

The Senior page goes further into the parallel scheduler internals, the
pre-Go 1.22 bug archaeology, and edge cases like `t.Run` after
`t.Parallel`.

## 16. Subtests and `t.Setenv`

`t.Setenv` (Go 1.17+) sets an environment variable for the duration of
the current test, restoring the previous value when the test ends. It
interacts with subtests in a way that is easy to misread:

```go
func TestEnv(t *testing.T) {
    t.Setenv("FLAG", "outer")
    t.Run("a", func(t *testing.T) {
        t.Setenv("FLAG", "inner")
        if got := os.Getenv("FLAG"); got != "inner" {
            t.Errorf("got %q, want inner", got)
        }
    })
    if got := os.Getenv("FLAG"); got != "outer" {
        t.Errorf("after a: got %q, want outer", got)
    }
}
```

After the subtest ends, `FLAG` is restored to `outer` (the parent's
value), not to whatever was set before `TestEnv` started. The parent's
`t.Setenv` is still active until `TestEnv` itself ends.

Two consequences:

1. `t.Setenv` is not safe inside parallel subtests. The Go runtime
   panics if you call it after `t.Parallel`. The framework enforces
   this because environment variables are process-global and
   concurrent writes are unsafe.
2. If you need different env values for parallel subtests, you cannot
   use `t.Setenv`. Either run them sequentially, or inject the
   configuration through a parameter instead of an env var.

## 17. Subtests and `t.TempDir`

`t.TempDir` returns a fresh temp directory and registers cleanup to
delete it. Inside a subtest, it returns a directory specific to that
subtest:

```go
func TestTempDir(t *testing.T) {
    a := t.TempDir() // dir for TestTempDir
    t.Run("child", func(t *testing.T) {
        b := t.TempDir() // dir for TestTempDir/child
        if a == b {
            t.Fatal("expected different dirs")
        }
    })
}
```

Each call to `t.TempDir` (on the same `*testing.T`) returns the same
directory; calls on different `*testing.T` values return different
directories. The path encodes the test hierarchy:

```
/tmp/TestTempDir1234567/001/
/tmp/TestTempDir1234567/001/child/001/
```

That nesting is convenient for debugging: when a test fails, you can
look at the leftover directory layout to see what each subtest did.
Cleanup runs at the end of the respective subtest (or test).

## 18. Subtests and `t.Context`

Go 1.24 added `t.Context()`, returning a `context.Context` tied to the
test's lifetime. Inside a subtest, the context is tied to the subtest:

```go
func TestContext(t *testing.T) {
    ctx := t.Context() // canceled when TestContext ends
    t.Run("child", func(t *testing.T) {
        ctx := t.Context() // canceled when subtest ends
        _ = ctx
    })
}
```

The subtest's context is a child of the parent's, but the cancellation
trigger is the subtest's end, not the parent's. So inside the subtest,
the context is alive only as long as the subtest body or any goroutine
that uses it is still running.

When passing a context to a goroutine started inside a subtest, prefer
the subtest's `t.Context()` over the parent's so the goroutine is
cleaned up promptly.

## 19. Mixing parallel and sequential subtests

You can have both in the same parent:

```go
func TestMixed(t *testing.T) {
    t.Run("setup_step", func(t *testing.T) {
        // sequential; no t.Parallel
    })
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            // parallel cases
        })
    }
}
```

Order of execution:

1. `setup_step` runs to completion sequentially.
2. The loop starts each parallel subtest; each pauses at `t.Parallel`.
3. The parent's body returns.
4. The framework releases the parallel subtests.

This is a common pattern: do one-time setup as a sequential subtest
(or in a helper) before launching the parallel cases. The advantage of
making setup a subtest is that you get `--- FAIL: TestMixed/setup_step`
clearly in the output if setup breaks, instead of a generic failure
attributed to the parent.

## 20. `t.Run` from a helper

You can call `t.Run` from a helper, not just from the test body:

```go
func runTableTest(t *testing.T, cases []testCase) {
    t.Helper()
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            run(t, tc)
        })
    }
}

func TestA(t *testing.T) { runTableTest(t, casesA) }
func TestB(t *testing.T) { runTableTest(t, casesB) }
```

This is fine and common. The subtests are children of the caller's
test (`TestA/case1`, `TestB/case1`), not of the helper function.

A nuance: if the helper calls `t.Helper`, error messages from
assertions inside the helper attribute to the test function, not to
the helper. Always call `t.Helper` as the first statement of helpers
that may report failures.

## 21. Custom subtest runners

A common abstraction in larger codebases is a custom runner that
encapsulates the table loop:

```go
type Case[In, Out any] struct {
    Name string
    In   In
    Want Out
}

func Run[In, Out any](
    t *testing.T,
    cases []Case[In, Out],
    fn func(In) Out,
    eq func(a, b Out) bool,
) {
    t.Helper()
    for _, c := range cases {
        c := c
        t.Run(c.Name, func(t *testing.T) {
            t.Parallel()
            got := fn(c.In)
            if !eq(got, c.Want) {
                t.Errorf("got %v, want %v", got, c.Want)
            }
        })
    }
}

func TestReverse(t *testing.T) {
    cases := []Case[string, string]{
        {"empty", "", ""},
        {"ascii", "abc", "cba"},
    }
    Run(t, cases, Reverse, func(a, b string) bool { return a == b })
}
```

This is fine for two or three tests, but the boilerplate of building
the runner usually does not pay off until you have ten or more test
functions with identical structure. Standard library code
deliberately avoids this abstraction and inlines the loop in every
test, prioritizing readability over DRY.

## 22. Subtests in benchmark setup

When you write benchmarks, the parallel structure is different.
`b.Run` creates a sub-benchmark and `b.RunParallel` runs in parallel.
You do not call `t.Run` inside a benchmark. If you need a one-time
setup before a sub-benchmark, do it before `b.Run`:

```go
func BenchmarkWith[T any](b *testing.B, items []T, f func(T)) {
    for _, n := range []int{10, 100, 1000} {
        items := items[:n]
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                f(items[i%len(items)])
            }
        })
    }
}
```

The subtest/sub-benchmark machinery is the same under the hood
(`Run` exists on both `*testing.T` and `*testing.B`), but the
expected idioms differ. See the dedicated benchmarks section.

## 23. Subtests and fuzz tests

`func FuzzXxx(f *testing.F)` is a third entry point alongside test
and benchmark functions. Inside a fuzz function:

- `f.Add` seeds the corpus.
- `f.Fuzz(func(t *testing.T, ...))` is the fuzzing loop. Each input
  becomes a subtest under the hood, named with a hash of the input.

You can also use `t.Run` inside the fuzz target to create sub-cases,
but typically you don't; the fuzz harness already creates one
subtest per input.

## 24. Sharing fixtures with `sync.Once`

A pattern for lazy expensive setup shared across subtests:

```go
var (
    dbOnce sync.Once
    dbConn *sql.DB
)

func getDB(t *testing.T) *sql.DB {
    t.Helper()
    dbOnce.Do(func() {
        var err error
        dbConn, err = sql.Open("pgx", os.Getenv("TEST_DB"))
        if err != nil {
            t.Fatal(err)
        }
    })
    if dbConn == nil {
        t.Fatal("db not available")
    }
    return dbConn
}

func TestUsers(t *testing.T) {
    db := getDB(t)
    t.Run("create", func(t *testing.T) {
        _ = db
    })
}
```

This is similar to `TestMain` but lazy: the connection is opened on
first use, not unconditionally at process start. Useful when many
test packages share the same helper but only some packages actually
need the connection.

Caveat: `sync.Once` is package-global, so it survives across tests in
the same package. You cannot reset it for a "fresh" connection per
test. If you need a fresh resource, use `t.Cleanup` and avoid the
once-pattern.

## 25. Subtests and stdlib examples

The standard library is the best reference for idiomatic subtest
usage. A few packages to read:

- `net/http/httptest`: small, focused subtests demonstrate handler
  behavior. See `Test_responseWriter_WriteHeader` family.
- `encoding/json`: heavy use of table-driven subtests for `Marshal`
  and `Unmarshal` corner cases. See `TestEncoder` and
  `TestDecoderInBuffered`.
- `strings`: idiomatic table-driven tests with simple subtest names.
- `cmd/go/internal/...`: huge, parallel subtest suites for the `go`
  tool itself.

Reading these is the fastest way to absorb conventions. Pay
attention to how they name subtests, when they use `t.Parallel`, and
how they structure setup.

## 26. CI integration patterns

Most CI systems benefit from a few small adjustments when subtests
are heavily used:

- **`go test -json` output.** Pipe through `gotestsum` or a similar
  tool for human-readable summaries.
- **Per-subtest retries.** Configure your CI to retry only failing
  leaves, not the whole parent. Tools like `gotestsum --rerun-fails`
  handle this.
- **Test sharding.** Large suites can be split across CI runners by
  package (`go test ./pkg1`, `go test ./pkg2`). Splitting within a
  package by subtest is harder and usually not worth it.
- **Coverage profiling.** `go test -coverprofile=cover.out` works
  unchanged with subtests; coverage is aggregated at the package
  level.

## 27. Subtest deduplication for property tests

When you generate inputs (manually or via a quickcheck library), you
may end up with duplicate subtest names. The framework appends
`#01`, `#02`, etc., but this clutters output and breaks `-run`
filtering. Solutions:

1. Encode a unique value (hash, counter, input itself) in the name.
2. Use the input value directly:

   ```go
   t.Run(fmt.Sprintf("input_%v", input), func(t *testing.T) { ... })
   ```

3. Use a sequence number for predictability:

   ```go
   for i, input := range inputs {
       t.Run(fmt.Sprintf("case_%03d", i), func(t *testing.T) { ... })
   }
   ```

Pick the strategy that gives you the best balance of readability
and uniqueness for your case.

## 27a. Detecting flaky subtests

Flaky tests are tests that sometimes pass and sometimes fail without
any code change. Subtests have a special relationship with flake
detection because the framework reports each leaf separately, making
it easier to identify the specific case that flakes.

A simple detector loop:

```bash
for i in $(seq 1 50); do
    go test -run TestX -count=1 || echo "fail on run $i"
done
```

`-count=1` disables the test cache, ensuring each run actually
executes. Combined with `-json` output and a parser, you can build a
table of "this leaf failed in 3 of 50 runs", which gives you the
flake rate per case.

Inside the test itself, you can also use `t.Repeat` patterns to
amplify rarely-flaking cases:

```go
func TestFlaky(t *testing.T) {
    for i := 0; i < 100; i++ {
        t.Run(fmt.Sprintf("iter_%d", i), func(t *testing.T) {
            t.Parallel()
            // possibly flaky body
        })
    }
}
```

This generates 100 subtests, each running the suspect body once.
With `-parallel 16` and a fast body, you exercise the case at scale
without writing a custom loop driver.

## 27b. Common helper patterns

Several helper patterns recur in production Go test code. Knowing
them saves you from re-inventing the wheel.

### Pattern: scoped helper that returns cleanup

```go
func startServer(t *testing.T) (*Server, func()) {
    t.Helper()
    srv := newServer()
    cleanup := func() { srv.Close() }
    return srv, cleanup
}
```

Older style; works but requires callers to remember to defer cleanup.
The modern alternative uses `t.Cleanup`:

```go
func startServer(t *testing.T) *Server {
    t.Helper()
    srv := newServer()
    t.Cleanup(srv.Close)
    return srv
}
```

The caller cannot forget cleanup. Always prefer the second style.

### Pattern: helper with options

```go
type ServerOpt func(*Server)

func WithPort(p int) ServerOpt { return func(s *Server) { s.Port = p } }
func WithTLS() ServerOpt       { return func(s *Server) { s.TLS = true } }

func startServer(t *testing.T, opts ...ServerOpt) *Server {
    t.Helper()
    srv := newServer()
    for _, o := range opts {
        o(srv)
    }
    t.Cleanup(srv.Close)
    return srv
}
```

Functional options scale to many parameters without breaking
existing callers. Common in subtests where each case wants a slightly
different fixture.

### Pattern: per-subtest fresh fixture

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        srv := startServer(t)
        runCase(t, srv, tc)
    })
}
```

Each subtest gets its own server. The server's `t.Cleanup` fires at
subtest end. This is the cleanest pattern for parallel subtests with
mutable per-case fixtures.

### Pattern: shared fixture across cases

```go
func TestX(t *testing.T) {
    srv := startServer(t)
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            runCase(t, srv, tc)
        })
    }
}
```

One server, shared across all cases. The server must be safe for
concurrent use, and cases must not leave residual state. Use this
when server startup is expensive.

## 28. Recap and what's next

You should now be comfortable with:

- The execution model of subtests inside `TestXxx`.
- `TestMain` setup and teardown around `m.Run()`.
- Sharing fixtures safely across sequential and parallel subtests.
- The Go 1.22 loop variable scope change and its effect on
  table-driven tests with `t.Parallel`.
- Reading `-v` and `-json` output to debug subtest behavior.
- Interaction with `t.Setenv`, `t.TempDir`, and `t.Context`.
- Mixing sequential and parallel subtests in one parent.
- Common helpers and abstractions for subtest tables.

The Senior page goes further into the parallel scheduler internals,
the pre-Go 1.22 bug archaeology, and edge cases like `t.Run` after
`t.Parallel`. Before moving on, audit one of your own test files:
look for `tc := tc` lines that can go away on Go 1.22+, parallel
subtests sharing mutable state, and `parent.Cleanup` calls from
helpers that should use the subtest's `t.Cleanup` instead.

## 29. Subtest names with regex-special characters

If your subtest name contains regex metacharacters, `-run` filtering
becomes awkward. Examples:

```go
t.Run("foo.bar", ...)        // "." matches any char in -run
t.Run("a+b", ...)             // "+" means "one or more"
t.Run("(x)", ...)             // parentheses group
t.Run("[1-5]", ...)           // character class
```

To filter such names, you must escape the special characters in
`-run`. Or, better, rename:

```go
t.Run("foo_bar", ...)
t.Run("a_plus_b", ...)
t.Run("x", ...)
t.Run("range_1_to_5", ...)
```

The cost of escaping is high (`go test -run 'TestX/foo\.bar'` is
error-prone in shells), and the cost of renaming is one PR. Prefer
plain identifiers.

## 30. Detecting unused subtests

A subtle bug: a subtest that never runs because its `t.Run` is
guarded by a condition that is always false in your CI environment:

```go
t.Run("integration", func(t *testing.T) {
    if !haveDB() {
        return
    }
    // body
})
```

If `haveDB()` is always false in CI, the subtest body never executes
but the subtest is still recorded as PASS. This is the
`return`-instead-of-`Skip` anti-pattern again, in a slightly
different dress.

Fix: use `t.Skip`:

```go
t.Run("integration", func(t *testing.T) {
    if !haveDB() {
        t.Skip("no DB available")
    }
    // body
})
```

Now CI dashboards show `--- SKIP`, which surfaces the gap. Without
skipping, you might think the integration case is passing for years
when it has not actually run.

## 31. Static analysis tools

A few linters specifically target subtest patterns:

- `paralleltest`: warns when a subtest does not call `t.Parallel`.
  Useful for enforcing a parallel-by-default policy.
- `tparallel`: warns when a parent does not call `t.Parallel` but
  has parallel subtests, or vice versa.
- `copyloopvar` (Go 1.22+): warns when `tc := tc` is unnecessary
  under the new loop scoping.
- `testifylint`: lints assertion patterns from `testify`, including
  inside subtests.

Enable these incrementally; turning them all on at once on a large
codebase produces an unmanageable flood of warnings.

## 32. Subtests and table tests in the same file

A common mixed pattern: one table-driven function and several
hand-written tests:

```go
func TestParse(t *testing.T) {
    cases := []parseCase{...}
    for _, tc := range cases { /* table */ }
}

func TestParse_panic(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic")
        }
    }()
    Parse(nil) // expected to panic
}

func TestParse_concurrent(t *testing.T) {
    // race detector test
}
```

The table covers the bulk of cases; the hand-written tests cover
specialty behaviors that don't fit the table shape. This split is
healthy and very common in production code.

## 33. Final practice exercise

Take a test function from your codebase that has more than ten
hand-written assertions. Convert it to a table-driven test with
subtests. Then:

1. Add `t.Parallel` to the inner closure. Confirm tests still pass.
2. Run `go test -race` and fix any races that surface.
3. Identify one case that should run only in long mode. Wrap it with
   `if testing.Short() { t.Skip(...) }` or pull it out to a
   separately-tagged file.
4. Pick one failing case (or introduce one). Run only that case with
   `-run` and verify the output is what you expect.

The exercise should take 30-60 minutes for a medium-sized test
function. By the end, you will have internalized the patterns
covered on this page.

## 34. Cross-package shared helpers

A common pattern is a package-level test helpers file:

```go
// internal/testutil/server.go
package testutil

import (
    "net/http/httptest"
    "testing"
)

func NewTestServer(t *testing.T, handler http.Handler) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(handler)
    t.Cleanup(srv.Close)
    return srv
}
```

Then any test package can import it:

```go
import "example.com/internal/testutil"

func TestX(t *testing.T) {
    srv := testutil.NewTestServer(t, myHandler)
    // use srv
}
```

The `*testing.T` flows through, cleanup registers on the subtest if
called from one, and the helper is reusable across packages.

## 35. Subtests and stdout/stderr capture

Sometimes a test needs to capture standard output. Tools like
`io.Pipe` + redirecting `os.Stdout` work but interfere with parallel
subtests (stdout is global). Avoid this pattern in parallel tests; if
you must capture output:

- Make the function under test accept an `io.Writer` parameter
  (dependency injection).
- Pass `bytes.Buffer` per subtest.
- Assert on the buffer's contents.

This avoids global state mutation and keeps subtests isolated.

## 36. Combining subtests with examples

`func ExampleX()` provides runnable, verifiable example documentation.
Subtests and examples don't overlap directly, but a common pattern:

```go
func TestParseFromExample(t *testing.T) {
    // The behavior demonstrated in ExampleParse:
    got, err := Parse(`{"x": 1}`)
    if err != nil { t.Fatal(err) }
    if got.X != 1 { t.Errorf("got %d, want 1", got.X) }
}

func ExampleParse() {
    v, _ := Parse(`{"x": 1}`)
    fmt.Println(v.X)
    // Output: 1
}
```

The test catches regressions in the example's behavior; the example
provides documentation. Both can live in the same `*_test.go` file.

## 37. Subtests for negative path coverage

A balanced test suite covers both happy and error paths:

```go
func TestParse(t *testing.T) {
    t.Run("happy", func(t *testing.T) {
        t.Run("simple", ...)
        t.Run("nested", ...)
        t.Run("unicode", ...)
    })
    t.Run("error", func(t *testing.T) {
        t.Run("missing_brace", ...)
        t.Run("trailing_garbage", ...)
        t.Run("invalid_utf8", ...)
    })
}
```

The two-group structure mirrors the function's two output cases
(value, error). It also makes it easy to verify that error cases
return useful error types: `-run TestParse/error` runs only them.

## 38. Recap

This page covered the second tier of subtest knowledge:

- TestMain interaction.
- Shared fixtures and pitfalls.
- `-run` and `-skip` regex behavior.
- Cleanup ordering with parallelism.
- The Go 1.22 loop scope change in depth.
- JSON event stream for CI tooling.
- Helpers, runners, and CI configuration.

Move on to Senior for the parallel scheduler internals and
advanced design patterns.

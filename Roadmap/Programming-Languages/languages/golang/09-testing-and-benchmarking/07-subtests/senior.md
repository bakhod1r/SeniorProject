---
layout: default
title: Subtests — Senior
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/senior/
---

# Subtests — Senior

[← Back](../)

This page focuses on the parts of subtest behavior that are easy to use
day-to-day but harder to reason about precisely: the parallel scheduler,
the pre-Go 1.22 loop-variable history, edge cases in `t.Run` semantics,
and how to design test architectures that scale to thousands of cases.

## 1. The parallel scheduler in detail

Inside the `testing` package, each `*testing.T` carries a
`parallel`/`sub`/`signal` machinery. Roughly:

- The framework maintains a global counter of currently running parallel
  tests, bounded by `-parallel N` (default `GOMAXPROCS`).
- When a test calls `t.Parallel()`, it:
  1. Decrements the count for its own slot if it was holding one.
  2. Signals its parent's `Run` to return.
  3. Blocks on a `signal` channel until the parent gives it permission
     to resume.
- The parent's `Run` returns immediately. Control returns to the
  caller (typically the for-loop body), which schedules the next
  subtest.
- After the parent's body returns, the framework enters a "wait for
  parallel children" phase. It releases blocked parallel children up to
  the `-parallel` limit and tracks completions.

The practical consequences:

- Parallel subtests never start running their post-`t.Parallel` body
  until the parent's body is done. This is what enables the parent to
  set up shared fixtures.
- The parent's `t.Cleanup` callbacks always run after all parallel
  children finish, even if some children pause and resume out of
  declaration order.
- A subtest can call `t.Run` on its own `t` to create grandchildren. If
  that grandchild calls `t.Parallel`, it pauses until its parent (the
  subtest, not the top-level test) finishes its body.

## 2. `t.Run` after `t.Parallel`

This composition is valid and surprisingly useful:

```go
func TestX(t *testing.T) {
    for _, group := range groups {
        group := group
        t.Run(group.name, func(t *testing.T) {
            t.Parallel()
            srv := startServer(t)
            for _, tc := range group.cases {
                tc := tc
                t.Run(tc.name, func(t *testing.T) {
                    t.Parallel()
                    hit(srv, tc)
                })
            }
        })
    }
}
```

What happens:

1. Top-level body iterates groups, starting each group subtest.
2. Each group's body executes after its own `t.Parallel` makes the
   group eligible for parallel scheduling. So the top-level body returns
   quickly after starting all groups.
3. Inside each group, the body starts the server, then schedules
   parallel grandchildren.
4. The group's body returns; the framework now waits for grandchildren
   to finish.
5. Once a group's grandchildren are done, the group's cleanups (e.g.
   `srv.Shutdown`) run, and the group itself completes.
6. Once all groups are done, the top-level cleanups run.

This is the canonical way to fan out tests across N independent servers
with M parallel cases per server.

## 3. The pre-Go 1.22 loop-variable archaeology

Before Go 1.22, this code had a famous bug:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        run(tc)
    })
}
```

Why it failed: in the pre-1.22 spec, `tc` was a single variable
declared once at the `for` statement. Each iteration assigned a new
value to that same variable. The closure passed to `t.Run` captured the
variable by reference. When the goroutine eventually ran (after
`t.Parallel` paused it and the parent's body finished), `tc` held the
last assigned value. Every parallel goroutine therefore saw the same
final case.

The traditional fix:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, ...)
}
```

The `tc := tc` line shadowed the loop variable with a new variable
local to the loop body. The closure captured that new variable, which
was never reassigned.

### Linters

`go vet` ships with `loopclosure` which warns on this pattern when the
closure escapes the loop body (the heuristic is conservative). Several
third-party linters (`exportloopref`, `looppointer`) catch more cases.
The Go team eventually decided the language had to change because
relying on linters left too much room for error.

### The proposal

Russ Cox's proposal `go.dev/issue/60078` (Change loop variable scoping)
laid out three options: do nothing, change the spec, or change with a
`go.mod` opt-in. The final design (Go 1.22) chose the third: when the
`go.mod` directive is `go 1.22` or later, each iteration of a `for`
loop gets fresh copies of its iteration variables. Older modules keep
legacy behavior so they cannot silently break.

### Migration impact

If your module has `go 1.22` (or newer) in `go.mod`:

- New code: do not write `tc := tc`. Linters will flag it.
- Old code: the shadow is harmless. You can remove it in a sweep when
  bored.
- Tests that relied on the old behavior (rare; usually a bug
  masquerading as a feature) will now break, which is the correct
  outcome.

If your module pins an older Go version:

- Keep writing `tc := tc` defensively.
- Consider upgrading; the change has been in production for years.

## 4. Failure semantics nuances

A few edge cases worth knowing:

### Calling `t.Fatal` inside a parallel subtest

`t.Fatal` calls `t.FailNow`, which uses `runtime.Goexit`. The framework
recovers, marks the subtest failed, propagates failure to the parent.
Siblings continue. No process exit.

### Calling `runtime.Goexit` directly

The framework treats this the same as `t.FailNow` for the current
test's goroutine: cleanups run, the test is marked failed (`Goexit
without test failure` warning printed).

### Panicking

Panics in the subtest goroutine are recovered by the framework. The
panic is reported under the subtest's output and the test is marked
failed. Siblings continue. The race detector's reports follow the same
path.

### Goroutines started by the subtest

If the subtest spawns a goroutine that outlives the subtest body, that
goroutine still belongs to the process. A panic in it terminates the
whole `go test` binary unless recovered. A failure assertion from it
(`t.Errorf` after the subtest has ended) panics with
`Fail in goroutine after TestX/case has completed`. Always coordinate
goroutine lifetimes with the subtest using channels or `sync.WaitGroup`,
and register `t.Cleanup` to wait.

```go
t.Run("background", func(t *testing.T) {
    done := make(chan struct{})
    go func() {
        defer close(done)
        // ...
    }()
    t.Cleanup(func() { <-done })
})
```

## 5. `Run` return value

`Run` returns a `bool`: `true` if the subtest passed (or was not yet
failed when it called `t.Parallel`). Usefulness is limited:

```go
ok := t.Run("setup", func(t *testing.T) { /* sets up shared state */ })
if !ok {
    t.Fatal("setup failed, aborting")
}
```

This pattern is occasionally useful for sequential pipelines where
later subtests cannot run if an earlier one failed. But it tightly
couples subtests, which usually points to a missing helper or a single
test function.

For parallel subtests, `Run` returns `true` as soon as the child calls
`t.Parallel`, even if the child later fails. The return value is
essentially meaningless in that case.

## 6. Naming collisions and `%q`-style escaping

Subtest names go through a normalization pass. The `testing` package
calls a helper that:

- Replaces ASCII spaces with `_`.
- Replaces other whitespace and non-printable runes with their
  `%q`-style escape (`\x09` for tab, ` ` for non-breaking space).
- Detects duplicate names within the same parent and appends `#01`,
  `#02`, etc.

The slash `/` is allowed in names and creates additional hierarchy
levels in the displayed name (but not in the actual parent/child
structure). This dual meaning can confuse tooling. Reserve `/` for
intentional structure; prefer `_` or `-` inside a single level.

## 7. Architecting large suites

When a package grows past ~50 subtests, structure helps:

1. **Group by feature, not by file.** One `TestUserAPI` with
   subtests for `create`, `list`, `update`, `delete` is easier to
   navigate than four `TestUserCreate*`, `TestUserList*` functions.
2. **Use shared fixtures via `TestMain` or a setup helper.** Establish
   a database once per package, hand transactions to each subtest.
3. **Prefer parallelism by default.** Mark every subtest `t.Parallel`
   unless it cannot be parallel. Use `paralleltest` linter to enforce.
4. **Use deterministic names.** Avoid timestamps, random IDs, or
   process PIDs in names. CI dashboards group by name; instability =
   lost history.
5. **Set a wall-clock budget.** If the suite exceeds 30 seconds, look
   for non-parallel subtests, shared-fixture contention, or
   over-eager cleanup work.

## 8. When subtests are the wrong tool

- A scenario test that walks through 10 steps. If step 5 needs step 4's
  output, it is one test, not five subtests. Use sequential
  assertions inside one function and let `t.Fatalf` stop on first
  error.
- Property-based tests. Use a generator inside a single test; do not
  create a subtest per generated input (you would lose
  shrink/replay).
- Fuzz tests. `func FuzzXxx(f *testing.F)` is the right entry point;
  inside the corpus runner, the framework already creates subtests
  for each input.
- Tests that exercise unrelated APIs. Separate `TestXxx` functions
  make the package's surface clearer.

## 9. Subtests in the standard library

A few high-quality examples to read:

- `encoding/json`: heavy use of table-driven subtests for `Marshal`
  and `Unmarshal` corner cases.
- `net/http/httptest`: small, focused subtests demonstrate handler
  behavior.
- `cmd/go/internal/...`: huge, parallel subtest suites for the `go`
  tool itself. A reference for how Google internally structures
  large Go test packages.

Reading these is the fastest way to absorb idiomatic conventions.

## 10. Subtest output buffering

The framework buffers each test's output and flushes when the test
ends. This is essential for parallel subtests; otherwise interleaved
output would be unreadable. Side effects:

- A `t.Log` inside a passing subtest is hidden unless `-v` is set.
- Output appears under the subtest's `--- PASS`/`--- FAIL` line, even
  if it was written long before, because the buffer flushes at the
  end.
- `fmt.Println` bypasses the buffer and writes directly to stdout.
  Avoid it in tests; the interleaving across parallel subtests will
  be chaotic.

## 11. Race detector interaction

`go test -race` instruments memory accesses. Inside subtests, the
framework's bookkeeping is race-free, but anything you share between
parallel subtests is your responsibility:

```go
counter := 0
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        counter++ // RACE
    })
}
```

The race detector catches the unsynchronized write. Use `sync/atomic`
or a mutex. Even better: don't share counters across cases.

## 12. Reading the source

The relevant files in the Go tree are:

- `src/testing/testing.go`: `func (t *T) Run` lives here. Worth
  reading once; the body is ~50 lines and clarifies the goroutine
  and signal logic.
- `src/testing/run_example.go`: how the example-test driver schedules
  examples (similar but not identical to subtests).
- `src/testing/sub_test.go`: the test suite for subtest behavior. A
  rich source of corner-case examples.

The implementation has been remarkably stable since Go 1.7 (when
subtests were introduced). Most semantic changes since have been
documentation clarifications and the Go 1.22 loop scope fix at the
language level.

## 13. Putting it together

A senior Go engineer should be able to:

1. Read `t.Run` semantics from the godoc and explain the goroutine
   model.
2. Decide between subtests, separate functions, and table-driven
   patterns based on case independence and shared setup.
3. Write parallel subtests safely under both pre-1.22 and 1.22+ rules.
4. Configure `-run`, `-skip`, `-parallel`, and `-json` for both local
   debugging and CI.
5. Diagnose interleaved-output, racing-shared-state, and
   ordering-dependency bugs from a `go test -race -v` run.
6. Refactor a 400-line test file with redundant `TestXxxX` functions
   into a clean table-driven structure without losing assertion
   detail.

The two prerequisites for that fluency are: read the `testing` source
once, and write at least one production package's test suite using
subtests with `t.Parallel` and shared fixtures end-to-end.

## 14. Further reading

- Go 1.22 release notes, "Language changes" section, on loop scope.
- Russ Cox, proposal `go.dev/issue/60078`.
- Dave Cheney's "Prefer table driven tests" essay.
- Mat Ryer's "5 simple tips and tricks for writing unit tests in Go"
  (the `t.Run` portion).
- The `testing` package godoc for `(*T).Run`, `(*T).Parallel`,
  `(*T).Cleanup`, `(*T).Helper`.

## 15. Internal flow of `(*T).Run`

For readers who want a mental model of how `Run` works end to end,
here is a condensed walkthrough of the actual source in
`src/testing/testing.go` (as of recent Go versions; the structure has
been stable since 1.7):

1. `Run` checks the match filter built from `-run`. If the subtest
   name does not match at its depth, `Run` records "skipped" and
   returns `true`. The body never executes.
2. If matched, `Run` creates a fresh `*T` for the subtest. It links
   the new `*T` to its parent: `t.context = parent.context`, parent
   pointer for failure propagation, level depth, etc.
3. `Run` allocates a `signal` channel and starts a goroutine that
   calls `tRunner(child, f)`.
4. The parent waits on the signal channel. The child runs `f`; when
   `f` returns or calls `t.Parallel`, the child writes to the signal
   channel.
5. The parent wakes up. If the child called `t.Parallel`, the parent
   continues executing immediately, leaving the child blocked on a
   second `signal` channel that the framework will later use to
   release it.
6. After the parent's body returns, `tRunner` (for the parent) calls
   the bookkeeping that releases paused children up to the
   `-parallel` cap.

The relevant types:

```go
type T struct {
    common
    isParallel bool
    isEnvSet   bool
    context    *testContext // shared between parent and children
    // ...
}

type common struct {
    mu       sync.RWMutex
    output   []byte
    chatty   *chattyPrinter
    bench    bool
    hasSub   atomic.Bool
    cleanup  func()
    cleanups []func()
    cleanupName string
    cleanupPc   []uintptr
    finished bool
    parent   *common
    level    int
    creator  []uintptr
    name     string
    start    time.Time
    duration time.Duration
    barrier  chan bool // signal for parallel scheduling
    signal   chan bool // completion signal
    sub      []*T      // subtests
    // ...
}
```

The `sub` slice on the parent's `common` is what allows the framework
to wait for all parallel children before considering the parent
done. The `barrier` channel is the gate that holds paused children
until the parent finishes.

You do not need to memorize this. The point is that the parent's
state is a fully owned aggregate of its children, not a loose
collection of independent goroutines. Failure of any child marks the
parent's `failed` flag (with appropriate mutex protection).

## 16. Edge cases that surprise people

### Edge case: subtest body has no actual assertions

```go
t.Run("warmup", func(t *testing.T) {
    _ = doSomething() // no t.Error, no t.Fatal
})
```

This subtest always passes. If `doSomething` has side effects you
care about, that is fine; treat the subtest as a structured setup
step. But if you intended to test something, the silent pass hides
the gap.

### Edge case: subtest panics in cleanup

```go
t.Cleanup(func() {
    panic("oops")
})
```

A panic in a `Cleanup` function is caught by the framework, recorded
as a failure on that test, and the remaining cleanups still run.
This is a relatively recent improvement (Go 1.14+); earlier versions
would terminate the test binary.

### Edge case: cleanup outlives the test

```go
t.Run("a", func(t *testing.T) {
    go func() {
        time.Sleep(time.Hour)
        t.Log("late!") // PANIC: after test has completed
    }()
})
```

The goroutine outlives the subtest. When it later calls `t.Log`, the
framework panics: it's not safe to log after the test has been
marked complete. Always coordinate goroutine lifetime with the
subtest, typically via a channel and a `t.Cleanup` that waits.

### Edge case: nested `Run` from a goroutine

```go
t.Run("a", func(t *testing.T) {
    go t.Run("b", func(t *testing.T) {
        // ...
    })
})
```

Calling `Run` from a goroutine started inside the subtest may work,
but it is fragile. The subtest could finish before the inner `Run`
starts, and the framework's bookkeeping is not designed for this
pattern. Always call `Run` synchronously from the test's main flow.

### Edge case: passing `nil` as the function

```go
t.Run("a", nil) // panic
```

The framework dereferences the function pointer. Passing `nil`
panics, marks the subtest failed, and is recovered by the framework.
It does not crash the binary, but the resulting error message is
unhelpful. Never pass `nil`.

## 17. Profiling subtest startup overhead

Each subtest costs some microseconds for the framework's
bookkeeping. For tables with thousands of cases, that overhead is
non-trivial. To measure:

```go
func BenchmarkSubtestOverhead(b *testing.B) {
    b.Run("with_subtest", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            b.Run("inner", func(*testing.B) {})
        }
    })
    b.Run("without_subtest", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            // no Run
        }
    })
}
```

On a modern laptop, the overhead is ~5-10us per subtest. For
suites with 10,000 cases that adds up to ~100ms. For most tests this
is invisible. For micro-benchmarks of subtest framework itself, it
matters.

The takeaway: don't worry about subtest overhead unless you have
profiled evidence that it's significant. Reach for direct loops with
manual assertions only when the table is huge and the test bodies
are trivial.

## 18. Subtest design: when to split

A guideline: if your `TestXxx` function exceeds ~200 lines, ask
whether the subtests belong in one function. Common splits:

- Behavior split: `TestParse` for parse cases, `TestEncode` for
  encode cases. Separate top-level tests if the behaviors are
  independent.
- Setup split: `TestParse_noDB` and `TestParse_withDB` if half the
  cases need a database and half don't.
- Tagging split: integration vs unit, behind a build tag. The split
  is at the file level, not the function level.

A 1000-line `TestEverything` is hard to navigate. Splitting it
into five 200-line functions, each with their own table, is usually
a win.

## 19. Pre-Go 1.22 migration checklist

If your project is moving from `go 1.21` to `go 1.22` in `go.mod`:

1. Run `go vet ./...`; the `loopclosure` check no longer warns about
   range-loop captures.
2. Enable `copyloopvar` in `golangci-lint`; it flags now-redundant
   `tc := tc` shadows.
3. Run the full test suite with `-race`. The Go 1.22 change makes
   each iteration's loop variable a separate stack slot, which
   sometimes shifts race detector reports. New races usually mean
   bugs that were latent before.
4. Read the diff produced by removing `tc := tc` lines. Make sure no
   case was actually relying on the shared variable; if you find one
   that was, that test was probably wrong before.

The Go team published a detailed migration guide; see
`go.dev/wiki/LoopvarExperiment`.

## 20. Subtests in benchmarks (subbenchmarks)

`*testing.B` has its own `Run` method:

```go
func BenchmarkX(b *testing.B) {
    for _, n := range []int{10, 100, 1000} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                work(n)
            }
        })
    }
}
```

The semantics mirror subtests: each sub-benchmark gets its own `b`
with its own `b.N`, its own setup/teardown stack, and its own line
in the output. The `-bench` flag accepts the same `/`-segmented
regex as `-run`.

Two important differences from subtests:

1. Sub-benchmarks do not call `b.Parallel` to opt into parallel
   scheduling. Use `b.RunParallel` for parallel benchmarks.
2. Each sub-benchmark resets `b.N` based on its own measured
   time. The outer `b.N` is irrelevant.

## 21. Subtests and code generation

Some tools generate subtests from external data (golden files, OpenAPI
specs, fuzzing corpora). The framework supports this naturally:
generate the slice of cases, loop over it, call `t.Run`. A common
pattern for golden files:

```go
func TestGolden(t *testing.T) {
    matches, _ := filepath.Glob("testdata/*.input")
    for _, in := range matches {
        in := in
        name := strings.TrimSuffix(filepath.Base(in), ".input")
        t.Run(name, func(t *testing.T) {
            input, _ := os.ReadFile(in)
            want, _ := os.ReadFile(strings.TrimSuffix(in, ".input") + ".golden")
            got := process(input)
            if !bytes.Equal(got, want) {
                if *update {
                    _ = os.WriteFile(strings.TrimSuffix(in, ".input")+".golden", got, 0644)
                    return
                }
                t.Errorf("output mismatch; rerun with -update to regenerate")
            }
        })
    }
}
```

The `-update` flag is a convention for regenerating golden files.
Each input file becomes one subtest, named after the file. Running
`go test -run TestGolden/some_input` re-tests one specific golden
case.

## 22. Subtests in distributed test harnesses

When you run tests across multiple machines (sharded CI, distributed
fuzzers), subtests give you a natural shard boundary. Use the test
name as the shard key:

```bash
go test -list '.*' ./pkg | grep '^TestX/' | split-into-shards
```

Each shard gets a list of subtest names and runs:

```bash
go test -run 'TestX/(case1|case5|case9)' ./pkg
```

The pipe is anchored by the `-run` regex. This works but has
limitations: the shard names are concatenated with `|`, which can
exceed shell argument length for large suites. Most teams shard at
the package level, not the subtest level, for that reason.

## 23. Subtests as a test plan

For complex behaviors with many failure modes, the list of subtest
names can serve as a test plan in the literal sense. Some teams
write the names first, with empty bodies, and treat the file as a
TODO list:

```go
func TestParse(t *testing.T) {
    t.Run("valid_input", func(t *testing.T) { t.Skip("TODO") })
    t.Run("empty_input", func(t *testing.T) { t.Skip("TODO") })
    t.Run("invalid_utf8", func(t *testing.T) { t.Skip("TODO") })
    t.Run("trailing_garbage", func(t *testing.T) { t.Skip("TODO") })
}
```

Then fill in bodies one at a time, deleting the `Skip` as each is
implemented. CI shows `--- SKIP` for unimplemented cases, which is
honest and visible (unlike a comment that nobody reads).

## 24. Edge cases in `-run` and `-skip`

The match logic for `-run` and `-skip` has subtle corners:

- The match is per-segment. A test passes the filter if every
  ancestor name matches its corresponding regex segment.
- If `-run` has fewer segments than the test depth, the tail
  matches everything. So `-run TestParse` runs the parent and all
  descendants.
- If `-run` has more segments than the test depth, the test passes
  filter at its shallow level but is descended into; subtests at
  deeper levels are matched.
- `-skip` is independent of `-run`. A test is run if it matches
  `-run` and does not match `-skip`. Both apply at every level.
- The match is unanchored by default. Use `^...$` for exact match.
- Special characters in subtest names (rare; spaces are converted
  to underscores) may need regex escaping.

This is enough rope to hang yourself with. When in doubt, run
`go test -v -list '.*' ./pkg` to enumerate test names, then
construct your filter against the actual names.

## 25. Subtest naming conventions in major codebases

Different communities have different conventions. A few examples:

- **Google internal Go**: `snake_case` for subtest names,
  descriptive of behavior. `t.Run("returns_error_on_empty_input", ...)`.
- **Kubernetes**: mixed. Often `PascalCase` for outer names and
  `snake_case` for inner cases.
- **Standard library**: short names, no fixed convention. `t.Run("a", ...)`
  is common for trivial differentiation.
- **Uber**: detailed names with `_` separators, often including the
  expected outcome: `with_valid_input_returns_ok`.

Pick a convention for your codebase and enforce it via review.
Consistency beats any individual choice.

## 26. Coverage and subtests

`go test -coverprofile=cover.out` aggregates coverage at the
package level. Each subtest contributes to that aggregate; there is
no per-subtest coverage report from the standard tooling. If you
need that, you can run each subtest separately with `-run` and
accumulate.

A trade-off: coverage of helper functions called by many subtests
is over-attributed. If `parseValue` is called by 100 subtests and
fails in only one, coverage shows it as fully exercised, hiding the
uncovered path. Use `-covermode=count` for line-execution counts,
which give finer detail.

## 27. The future of subtests

A few proposals and discussions ongoing in the Go community:

- **Per-subtest randomization** (proposed but not implemented):
  randomize subtest order within a parent to surface ordering
  dependencies.
- **Better filtering syntax**: replace `-run`'s regex with a more
  literal substring or glob match. Has been discussed; unlikely to
  land due to backward compatibility.
- **`t.RunParallel`**: a shorthand for `t.Run` + `t.Parallel`
  inside. Proposed in `go.dev/issue/45402`; declined as not
  significantly better than a one-line helper.

The semantic core of subtests has been remarkably stable since Go
1.7. The Go 1.22 loop variable change is the biggest indirect
improvement in years. Don't expect dramatic changes; do expect
linter improvements and convention drift.

## 28. Final exercises

For mastery, work through these:

1. Read `(*T).Run` in `src/testing/testing.go`. Trace the goroutine
   creation, signal channel, and parent-child linkage.
2. Write a benchmark that compares pure for-loop assertions vs
   `t.Run`-per-case. Quantify the framework overhead.
3. Take a test file with `tc := tc` shadows, upgrade `go.mod` to
   `go 1.22`, remove the shadows, and verify tests still pass.
4. Construct a `-run`/`-skip` combination that runs every subtest in
   a package except those matching a specific pattern. Test on a
   non-trivial file.
5. Identify one subtest in your codebase that should not be parallel
   and explain why. (Hint: anything mutating global state, anything
   asserting on ordering of other tests, anything using `t.Setenv`.)

After this page you should be the person on your team who can
diagnose subtle subtest behavior, design test architectures that
scale to thousands of cases, and explain Go 1.22's loop scope fix
to colleagues. Use that knowledge to mentor; subtests are an
inflection point in many Go engineers' productivity.

## 29. Subtest architecture patterns at scale

When a single test package grows to thousands of cases, raw `t.Run`
calls become unwieldy. Several architecture patterns have emerged:

### Pattern: layered tables

Split cases into orthogonal axes and run each combination as a
subtest:

```go
operations := []string{"add", "delete", "update"}
authStates := []string{"anonymous", "user", "admin"}

for _, op := range operations {
    op := op
    for _, auth := range authStates {
        auth := auth
        name := fmt.Sprintf("%s/%s", op, auth)
        t.Run(name, func(t *testing.T) {
            t.Parallel()
            runCase(t, op, auth)
        })
    }
}
```

This generates 9 subtests covering the full matrix. The slash in the
name creates an additional hierarchy level for filtering: `-run
TestX/^add` runs all auth states for the add operation.

### Pattern: case interface

For polymorphic cases, define an interface and a slice of
implementations:

```go
type testCase interface {
    Name() string
    Run(*testing.T)
}

func TestAll(t *testing.T) {
    cases := []testCase{
        &parseCase{...},
        &encodeCase{...},
        &validateCase{...},
    }
    for _, c := range cases {
        c := c
        t.Run(c.Name(), func(t *testing.T) {
            t.Parallel()
            c.Run(t)
        })
    }
}
```

Each case type can have its own fields and `Run` implementation. The
loop is uniform; the cases are not. Useful when cases differ in
shape and a flat struct would be heterogeneous.

### Pattern: scenario tests

For end-to-end scenarios with multiple steps, structure as nested
subtests:

```go
func TestCheckout(t *testing.T) {
    t.Run("scenario1_normal", func(t *testing.T) {
        t.Run("login", ...)
        t.Run("add_to_cart", ...)
        t.Run("checkout", ...)
        t.Run("confirm", ...)
    })
    t.Run("scenario2_with_coupon", func(t *testing.T) {
        t.Run("login", ...)
        // ...
    })
}
```

Each scenario is sequential (no `t.Parallel`); scenarios run in
parallel with each other. The names give a clear map of what each
scenario does.

## 30. Distributed testing considerations

When tests must run across multiple machines (very large suites,
cross-region tests), subtests interact with the orchestration in
non-obvious ways:

- The full test name (`TestX/group/case`) is the natural shard
  key but the names are constructed at runtime, so the orchestrator
  must do a discovery pass first.
- Failures from sharded runs must be aggregated by the full name to
  produce a meaningful dashboard.
- Per-shard test caching is hard; the cache key includes the
  binary, so each shard needs its own binary cache.

Most teams avoid this complexity by sharding at the package level
and accepting some imbalance.

## 31. Mutation testing with subtests

Mutation testing (`go-mutesting` and similar) introduces small
changes to the source and verifies that tests catch them. Subtests
help here because each case has its own name; a mutation that breaks
one case is easy to identify by leaf name.

The combination is powerful: write a table-driven test with many
cases, then run mutation testing to find cases that are too lax.
The output points you to specific subtest names that pass even with
a mutated source, suggesting the assertions are weak.

## 32. Subtests and dependency injection

Production code often takes dependencies via constructors:

```go
type Service struct {
    db DB
    clock Clock
    logger Logger
}

func New(db DB, clock Clock, logger Logger) *Service { ... }
```

In tests, each subtest can inject its own fakes:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        db := newFakeDB(t, tc.dbState)
        clock := fakeClock(tc.now)
        svc := New(db, clock, noopLogger)
        // ...
    })
}
```

Each subtest gets its own fakes, parallelism is safe, and the
behavior under test is isolated. This pattern is the gold standard
for subtest-based unit testing.

## 33. Subtests and integration testing harnesses

For integration tests that need a real database or external service,
shared fixtures via `TestMain` plus subtests is the standard:

```go
var (
    db *sql.DB
)

func TestMain(m *testing.M) {
    var err error
    db, err = sql.Open("pgx", os.Getenv("TEST_DB_URL"))
    if err != nil {
        log.Fatal(err)
    }
    code := m.Run()
    db.Close()
    os.Exit(code)
}

func TestUsers(t *testing.T) {
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            tx, err := db.BeginTx(t.Context(), nil)
            if err != nil { t.Fatal(err) }
            t.Cleanup(func() { _ = tx.Rollback() })
            runCase(t, tx, tc)
        })
    }
}
```

Each subtest gets its own transaction (isolation), the transaction
rolls back at subtest end (clean state for next case), and the
shared connection pool is amortized across cases.

## 34. The cost-benefit of `t.Helper`

`t.Helper` is cheap but not free. It walks the call stack at every
report site to identify the helper boundary. For a test that calls
a helper once, the cost is microseconds. For a tight loop in a
benchmark, it can dominate.

Practical rule: always use `t.Helper` in test helpers; reach for
optimization only if profiling shows it as a bottleneck (rare).

## 35. Subtests as a coverage strategy

A coverage-oriented test strategy:

1. Identify code paths via `go test -coverprofile`.
2. For each uncovered branch, add one subtest that exercises it.
3. Name the subtest after the branch it covers.

The resulting test file becomes a map of the code's branches.
Future readers can find which test exercises which path by name.

The downside: tests named after branches can become brittle when
the code is refactored. Mitigate by also describing the input or
expected behavior in the name.

## 36. Anti-pattern: every test is a subtest

```go
func TestAll(t *testing.T) {
    t.Run("Parse", testParse)
    t.Run("Encode", testEncode)
    t.Run("Validate", testValidate)
    t.Run("Format", testFormat)
}
```

This collapses every test into one top-level function. The result:

- `go test -run TestParse` runs nothing (no such top-level test).
- IDE test runners show one entry, not four.
- CI dashboards group everything under `TestAll`.

The motivation is often "all tests in one place". Resist it; keep
top-level tests for unrelated behaviors, subtests for variations of
one behavior.

## 37. The `parallel` linter rules in detail

`paralleltest` from `golangci-lint` enforces a strict policy:

1. Every `t.Run` body must call `t.Parallel` as its first statement.
2. Every top-level `TestXxx` must call `t.Parallel` if any of its
   subtests do.
3. Loop variables in `for _, tc := range cases` must be reassigned
   (`tc := tc`) before `t.Run` (only required pre-Go 1.22).

The rules are opinionated and not universally appropriate (some
tests should not be parallel). Enable on a per-package basis or use
`//nolint:paralleltest` for known exceptions.

## 38. Subtests with `httptest`

`httptest.NewServer` is the go-to for testing HTTP handlers:

```go
func TestHandler(t *testing.T) {
    cases := []struct{ name, path string; want int }{
        {"root", "/", 200},
        {"not_found", "/nope", 404},
    }
    handler := newHandler()
    srv := httptest.NewServer(handler)
    t.Cleanup(srv.Close)

    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            resp, err := http.Get(srv.URL + tc.path)
            if err != nil { t.Fatal(err) }
            t.Cleanup(func() { _ = resp.Body.Close() })
            if resp.StatusCode != tc.want {
                t.Errorf("got %d, want %d", resp.StatusCode, tc.want)
            }
        })
    }
}
```

One server, parallel cases, per-case cleanup of the response body.
The handler must be safe for concurrent calls (the standard library
guarantees this for plain `http.Handler` implementations).

## 39. `httptest.NewRecorder` per subtest

When testing handlers directly (not over a server), each subtest
gets its own recorder:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        req := httptest.NewRequest(tc.method, tc.path, nil)
        rec := httptest.NewRecorder()
        handler.ServeHTTP(rec, req)
        if rec.Code != tc.want {
            t.Errorf("got %d, want %d", rec.Code, tc.want)
        }
    })
}
```

This avoids the overhead of a real network round-trip. Use it when
you don't need to test the full HTTP stack.

## 40. Subtests with mocks

A test that mocks a dependency:

```go
type fakeDB struct {
    users map[string]User
}

func (f *fakeDB) Get(id string) (User, error) {
    u, ok := f.users[id]
    if !ok { return User{}, ErrNotFound }
    return u, nil
}

func TestService(t *testing.T) {
    cases := []struct{
        name string
        seed map[string]User
        get  string
        want User
    }{
        {"existing", map[string]User{"a": {ID: "a"}}, "a", User{ID: "a"}},
        {"missing", map[string]User{}, "x", User{}},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            db := &fakeDB{users: tc.seed}
            svc := NewService(db)
            got, _ := svc.Lookup(tc.get)
            if got != tc.want {
                t.Errorf("got %v, want %v", got, tc.want)
            }
        })
    }
}
```

Each subtest builds its own fake. The fakes are completely isolated;
parallel safety is automatic.

## 41. Subtests and assertion libraries

Libraries like `testify/assert` and `testify/require` work with
subtests because they take `*testing.T` (and ultimately
`testing.TB`). The subtest's `t` is passed in:

```go
t.Run("case", func(t *testing.T) {
    require.NoError(t, err)
    assert.Equal(t, want, got)
})
```

A nuance: `require.X` calls `t.FailNow`, which terminates the
subtest's goroutine. Siblings still run. `assert.X` calls
`t.Errorf` and continues. Mix them based on whether subsequent
assertions in the same subtest make sense after a failure.

## 42. Final thought: subtests as an abstraction

`t.Run` is a small API surface (one method, two arguments) that
unlocks a productive testing style. Its design constraints
encourage tests that are:

- Named: every case has a stable identifier.
- Filterable: every case can be run in isolation.
- Independent: every case has its own `*T`, cleanup stack,
  parallel state.
- Hierarchical: cases group into parents naturally.
- Parallel: cases run concurrently if marked so.

These properties are exactly what production test suites need. The
Go team chose well in 2016 when subtests landed in Go 1.7, and
the abstraction has held up across major language changes (Go 1.22
loop scope) and ecosystem evolution (Go modules, generics).

Use subtests heavily; they will repay your investment many times
over as your test suites grow.

## 43. Implementation notes: `tRunner`

The function that runs each test (top-level or subtest) is
`tRunner` in `src/testing/testing.go`. Its structure:

```go
func tRunner(t *T, fn func(t *T)) {
    defer func() {
        // 1. Recover from panic if any
        if r := recover(); r != nil {
            t.Fail()
            // log panic, etc.
        }
        // 2. Wait for subtests of this test
        t.waitParallel()
        // 3. Drain cleanups
        t.runCleanup(...)
        // 4. Signal completion to parent
        t.signal <- true
    }()
    // Run the user-provided function
    fn(t)
}
```

The deferred function handles panic recovery, child waiting, cleanup
drainage, and parent signaling in that order. Reading this once
makes many edge cases obvious: why cleanups run after parallel
children, why panics don't terminate the test binary, why output
buffers flush at end-of-test.

## 44. Building debug instrumentation

Sometimes you need to understand exactly when each subtest runs.
A trick: register a print at start and end:

```go
t.Run("case", func(t *testing.T) {
    fmt.Fprintf(os.Stderr, "start %s\n", t.Name())
    t.Cleanup(func() { fmt.Fprintf(os.Stderr, "end %s\n", t.Name()) })
    // body
})
```

Stderr is unbuffered (unlike `t.Log`). The output interleaves in
real-time, which is what you want for tracing parallel execution.

`t.Name()` returns the full hierarchical name. Useful for debugging
and for log correlation.

## 45. Real-world subtest design example

Consider a JSON parser test suite:

```go
func TestParse(t *testing.T) {
    t.Run("primitives", func(t *testing.T) {
        t.Run("null", ...)
        t.Run("true", ...)
        t.Run("false", ...)
        t.Run("number_int", ...)
        t.Run("number_float", ...)
        t.Run("number_scientific", ...)
        t.Run("string_simple", ...)
        t.Run("string_unicode", ...)
        t.Run("string_escapes", ...)
    })
    t.Run("composites", func(t *testing.T) {
        t.Run("array_empty", ...)
        t.Run("array_simple", ...)
        t.Run("array_nested", ...)
        t.Run("object_empty", ...)
        t.Run("object_simple", ...)
        t.Run("object_nested", ...)
    })
    t.Run("errors", func(t *testing.T) {
        t.Run("trailing_garbage", ...)
        t.Run("missing_quote", ...)
        t.Run("invalid_escape", ...)
        t.Run("number_overflow", ...)
    })
}
```

This shape has 19 subtests in three groups. `-run TestParse/primitives`
runs just the 9 primitive tests. The hierarchy gives a map of what
the parser handles. New cases slot into the appropriate group.

This is the design discipline that mature Go codebases apply.

## 46. Testing concurrent code with subtests

A subtest can spawn goroutines and assert on their behavior, but
care is needed:

```go
t.Run("concurrent_writes", func(t *testing.T) {
    var wg sync.WaitGroup
    s := newSafeSet()
    for i := 0; i < 100; i++ {
        wg.Add(1)
        i := i
        go func() {
            defer wg.Done()
            s.Add(fmt.Sprintf("k%d", i))
        }()
    }
    wg.Wait()
    if s.Len() != 100 {
        t.Errorf("len = %d, want 100", s.Len())
    }
})
```

The `wg.Wait()` ensures all goroutines complete before the subtest
ends, preventing the "fail after test completed" panic. Run with
`-race` to verify thread safety.

## 47. Subtests and `*testing.T` as `testing.TB`

`*testing.T` implements the `testing.TB` interface, which also
includes `*testing.B` (benchmark) and `*testing.F` (fuzz). Assertion
helpers that accept `testing.TB` can be reused across tests,
benchmarks, and fuzz harnesses:

```go
func mustParse(tb testing.TB, s string) Value {
    tb.Helper()
    v, err := Parse(s)
    if err != nil {
        tb.Fatal(err)
    }
    return v
}
```

Useful for shared helpers. Inside the helper, `tb.Run` is not
available (the interface doesn't expose it), so subtests must be
created by the caller.

## 48. Subtest isolation guarantees

What the framework guarantees:

- Each subtest has its own `*T`, isolated from siblings except
  through code you write.
- Failure flag, name, cleanup stack, and parallelism state are
  per-subtest.
- Output buffer is per-subtest.

What the framework does not guarantee:

- Memory isolation: closures share variables with the parent.
- Goroutine isolation: goroutines started in a subtest can outlive
  it.
- Process state: env vars, working dir, signal handlers are shared.
- Network ports, file descriptors, system resources: shared.

The first list is what makes subtests useful. The second list is
where bugs live.

## 49. Future-proofing your subtests

To minimize the risk of future Go changes breaking your tests:

- Use `t.Helper`, not stack-trace fiddling.
- Use `t.Cleanup`, not `defer` (the `defer` won't run if the test
  uses `t.FailNow`).
- Use `t.Context`, not your own context cancellation glue.
- Use `t.TempDir`, not `os.MkdirTemp` + manual cleanup.
- Use `t.Setenv`, not `os.Setenv` + manual restore.

The framework primitives are the contract; built-in tools work
around them in case of breaking changes.

## 50. The senior mindset

When you encounter a subtest pattern in code, ask:

- What is the table really testing? Is each case meaningful?
- Are the names stable, descriptive, filterable?
- Is parallelism appropriate? Is there shared state risk?
- Are cleanups registered at the right level?
- Does the failure mode lead to a clear, actionable error message?

Senior engineers think about test architecture as carefully as
production code architecture. Subtests are a tool; using them well
distinguishes mature codebases from chaotic ones.

## 51. Subtest review heuristics

When reviewing test code that uses subtests, run through this
mental checklist:

1. **Names**: are they stable, descriptive, deterministic? Names
   like `test_1` or `case_a` are red flags.
2. **Parallelism**: is `t.Parallel` called consistently? Does the
   shared state (if any) survive a `-race` run?
3. **Cleanup**: are cleanups attached to the right `t`? Are they
   ordered correctly given LIFO semantics?
4. **Loop variables**: under Go 1.21 or older, is `tc := tc`
   present? Under 1.22+, are unnecessary shadows removed?
5. **Helpers**: do they call `t.Helper`? Do they accept the
   right `*testing.T` (caller's, not parent's)?
6. **Failure messages**: do they include enough context to
   diagnose without rerunning?
7. **Independence**: can each subtest be run alone via `-run`?
   Or does it implicitly depend on a sibling?

Going through this in 5 minutes catches the bulk of subtest bugs
before they land.

## 52. Senior responsibility: keeping the suite fast

A test suite that takes 5 minutes is annoying. One that takes 30
minutes is a productivity killer. Senior engineers protect the
suite's speed:

- Reject PRs that add slow subtests without justification.
- Periodically audit `time go test ./...` and identify regressions.
- Push for parallelism where it's safe.
- Move integration tests out of the inner-loop hot path (separate
  command, separate CI step).
- Use `-short` mode for pre-commit hooks.

A fast suite gets run; a slow suite gets skipped. The latter is
worse than no suite at all.

## 53. Final words

Subtests are deceptively simple. The API is `t.Run(name, func)`,
and that's the whole thing. The depth comes from how that one
method composes with parallelism, cleanup, panics, generics,
context, and the broader Go testing model.

Master it, teach it to your team, and apply it pragmatically.
Don't let dogma about "all tests must be subtests" or "all
subtests must be parallel" lead you astray. Use judgment; tests
exist to give you confidence, and any pattern that erodes that
confidence is the wrong pattern.

Go forth and write better tests.

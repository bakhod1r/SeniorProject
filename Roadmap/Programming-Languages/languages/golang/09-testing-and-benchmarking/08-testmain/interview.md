---
layout: default
title: TestMain — Interview
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/interview/
---

# TestMain — Interview

[← Back](../)

A list of `TestMain` questions you should be able to answer cold. Organized by seniority. Read the question, formulate your answer, then check.

## Junior

**Q1. What is the exact signature of `TestMain`?**

`func TestMain(m *testing.M)` declared in a `_test.go` file. One parameter, no return, exactly that name.

**Q2. How many `TestMain` functions can a package have?**

Exactly one. The compiler rejects duplicates with `duplicate function TestMain`.

**Q3. What does `m.Run()` return?**

An `int` exit code: `0` if all tests passed, `1` if any test failed or panicked.

**Q4. Why is `os.Exit(m.Run())` the canonical last line?**

Because `m.Run` returns a status code that must be propagated to the OS so CI can detect failures. Returning from `TestMain` normally also works since Go 1.15, but `os.Exit` is the textbook idiom.

**Q5. Where does the setup code go?**

Before `m.Run()`. Teardown goes between `m.Run()` and `os.Exit`, or after `m.Run()` when you choose the return-normally style.

**Q6. Is `TestMain` mandatory?**

No. If you do not declare one, the generated test main simply does `os.Exit(m.Run())`. Add `TestMain` only when you need lifecycle hooks.

**Q7. Can a `TestMain` be defined in a `.go` file (not `_test.go`)?**

No. Only `_test.go` files are linked into the test binary. A `TestMain` in a regular `.go` file becomes a regular function in your production binary, which is almost certainly a bug.

**Q8. Where does the test binary's `main` come from?**

The Go tool generates a `_testmain.go` file that contains the `main` function. That `main` calls your `TestMain` if defined, otherwise `m.Run` directly.

## Middle

**Q9. Why does `defer cleanup(); os.Exit(m.Run())` fail to run cleanup?**

`os.Exit` does not run deferred functions. The defer is registered but never executed because the goroutine never returns. Solution: capture code, call cleanup, then exit.

**Q10. When does `flag.Parse()` run relative to `TestMain`?**

It has not run when `TestMain` is called. The testing package calls `flag.Parse` inside `m.Run` if it has not happened yet. If `TestMain` itself reads a flag before `m.Run`, you must `flag.Parse` first.

**Q11. How do you define a custom flag for a test binary?**

Declare a package-level `flag.String` (or use `flag.Var`) in a `_test.go` file. Then `go test -mydb=postgres ./...` makes it available. Read it inside `TestMain` after `flag.Parse`.

**Q12. Are `TestMain` and `func main()` of the binary the same?**

No. `go test` generates its own `main` that constructs `*testing.M` and calls `TestMain(m)` if defined, otherwise `m.Run()` directly. Your `TestMain` is invoked by the generated `main`, it is not the entry point itself.

**Q13. Can I run tests programmatically without `go test`?**

You can build the test binary with `go test -c` and execute it directly. The binary respects `-test.run`, `-test.v`, etc.

**Q14. What is `testing.Short()`?**

A boolean exposed after `flag.Parse` that is `true` when `-short` was passed. Use to gate slow tests inside `TestMain` and individual tests.

**Q15. Difference between `t.Cleanup` and a `TestMain` teardown?**

`t.Cleanup` is per test, fires after each test returns, composes with subtests, and is part of the failure report. `TestMain` teardown is per package, fires once after all tests finish. Use both — they are complementary.

**Q16. What happens if I forget `os.Exit` entirely (and rely on Go 1.15 return-normally)?**

The exit code from `m.Run` is forwarded by the runtime. The program still exits non-zero on test failure. This is fine but reviewers expect explicit `os.Exit`. Most linters do not flag it; humans often do.

**Q17. Can `TestMain` skip individual tests?**

Not directly. From `TestMain` you can refuse to call `m.Run` (effectively skipping everything) or set a package-level flag that individual tests inspect to call `t.Skip`. There is no API to selectively skip tests by name from `TestMain`.

**Q18. What is `testing.Verbose()`?**

True when `-v` was passed. Useful when `TestMain` wants to print extra diagnostics only in verbose mode.

## Senior

**Q19. Suppose `TestMain` starts a Postgres container. How do you make sure it is torn down even when a test panics?**

Wrap `m.Run` in a function that recovers, or rely on `m.Run`'s own panic-to-fail conversion (tests that panic are reported as failed). Place teardown after `m.Run` returns. Alternatively, register the container with Ryuk so it is garbage-collected even if the process crashes.

**Q20. How would you share an expensive connection pool across two packages whose tests both need it?**

The natural fit is an internal helper package (`internal/testdb`) with a `sync.Once`-protected `Get(t *testing.T) *sql.DB`. Each package's `TestMain` (or first test) calls `Get`. Cross-package state shared via env var or a long-running container is also valid. Note that `go test ./...` runs each package in a separate process, so true cross-package sharing requires external state (env var pointing to a long-running container).

**Q21. What is the trade-off between `TestMain` setup and per-test `t.Cleanup`?**

`TestMain` setup costs once per package, runs sequentially before any test, and is invisible to test names. `t.Cleanup` runs per test, integrates with subtests, and is reported through `t.Log` on failure. Use `TestMain` for expensive shared resources, `t.Cleanup` for per-test isolation.

**Q22. Why might a `TestMain` slow down CI more than it helps?**

If 30 packages each spin up their own database, you incur 30 startups. Centralizing into a single integration package, or pointing all packages at one shared container via env, can be far faster.

**Q23. How do you tell whether a coverage profile includes init code?**

Coverage instrumentation begins before `TestMain`. Anything an imported package's `init` does is covered. To see, run `go test -coverprofile c.out` and inspect `c.out`: lines from `init` functions appear.

**Q24. How do you test the package's own `main` function?**

`main` is typically in `package main`, untestable from `_test.go` directly. Either extract logic into a library package, or test via `os.Exec`-ing the built binary, or use `TestMain` to call the `main` function under specific argv values and assert exit codes.

**Q25. How does `t.Parallel` interact with `TestMain`?**

`TestMain` runs sequentially. `t.Parallel` only affects tests inside `m.Run`. Tests that share state set up in `TestMain` must access it in a goroutine-safe way (e.g., `*sql.DB` is safe; a `map[string]int` is not).

**Q26. What is the relationship between `TestMain` and fuzz targets?**

Fuzz targets run inside `m.Run`. `TestMain` setup applies. With `-fuzz`, the fuzzing engine may restart the test binary on crash, re-running `TestMain`. Keep setup idempotent and cheap.

**Q27. How do you verify there are no goroutine leaks across the entire package?**

Use `go.uber.org/goleak` with `goleak.VerifyTestMain(m)` in place of `os.Exit(m.Run())`. It runs `m.Run`, then checks for unexpected goroutines and exits with `1` if any are found.

## Staff / Architect

**Q28. Critique the following: `func TestMain(m *testing.M) { setup(); m.Run() }` (no exit code).**

Bug: it ignores the return code. CI sees exit 0 even when tests fail. Either `os.Exit(m.Run())` or capture and re-exit. Since Go 1.15 the runtime propagates the code if you return normally, but the example does not use the value at all — `m.Run` is treated as `void`, which obscures intent.

**Q29. You inherit a project where every package has nearly identical `TestMain` boilerplate. What do you do?**

Extract a helper: `func RunTests(m *testing.M, opts ...Option) int` in an internal test-support package. Each `TestMain` shrinks to `os.Exit(testsupport.RunTests(m))`. Common setup (logging, DB, tracing) lives in one place.

**Q30. How does `TestMain` interact with `testing.RegisterCover`?**

Historically the cover tool generated a call to `testing.RegisterCover(testing.Cover{...})` inside the test main. As of Go 1.20 this was replaced by the `runtime/coverage` package; user code rarely calls either. Good to know exists, not to call.

**Q31. Why might a `TestMain` deadlock?**

Calling `m.Run` from a goroutine and `<-done` from main; closing channels in a different order; calling into a runtime hook that blocks. The simplest cause: starting a goroutine that calls `t.Parallel` indirectly without realizing `TestMain` is the main goroutine. Stick to the documented pattern.

**Q32. Discuss `TestMain` in the context of fuzzing.**

Fuzz targets are dispatched by `m.Run` just like tests. `TestMain` setup applies. With `go test -fuzz=Fuzz`, the runtime restarts the test binary per crash — your `TestMain` runs every time, so keep it idempotent and cheap. Heavy setup gated behind `-short` or an env check can let fuzz runs use a minimal setup path.

**Q33. How do you wire OpenTelemetry tracing into a test binary?**

Initialize the tracer provider in `TestMain` before `m.Run`, set a propagator, register a span processor that writes to a file or in-memory exporter. Shut down the provider after `m.Run` to flush spans before exit.

**Q34. Explain the difference between `testing.Main` and `testing.M.Run`.**

`testing.Main(matchString MatchStringFunc, tests []InternalTest, benchmarks []InternalBenchmark, examples []InternalExample)` is the legacy entry point used by the generated `main`. `M.Run` is the modern public API. You almost never call `testing.Main` directly; it exists for tooling that wants tight control over registration.

**Q35. When would you ever skip `TestMain` and embrace `t.Setup`-style per-test code?**

When every test needs subtly different setup, when there is no expensive shared resource, when isolation is more valuable than speed. Or when you simply don't have one. `TestMain` is optional.

**Q36. How do you build a sub-process test using `TestMain`?**

Branch at the top of `TestMain` on a sentinel env var:

```go
func TestMain(m *testing.M) {
    if os.Getenv("BE_HELPER") == "1" {
        runHelper()
        os.Exit(0)
    }
    os.Exit(m.Run())
}
```

Tests then re-exec `os.Args[0]` with `BE_HELPER=1`. The child runs `runHelper` instead of the test suite. This is how the standard library tests programs that call `os.Exit` or `log.Fatal`.

**Q37. Walk through what happens when you run `go test ./...` against 50 packages, half of which define `TestMain`.**

`go test ./...` discovers all packages, compiles each into its own test binary, then runs each binary in parallel (up to `-p` count, default `GOMAXPROCS`). Each binary's generated `main` calls its `TestMain` (or `m.Run` directly). Each package's `TestMain` runs independently — there is no shared `TestMain` across packages, no shared state across processes. Failures in one package do not stop others.

**Q38. Suppose you want a global pre-test step (like running migrations) that affects every package. How?**

You cannot do this purely via `TestMain` because each package is a separate process. Options: run the step before `go test` in your `Makefile`/CI; share a long-running database container whose state survives across runs; extract a helper that every package's `TestMain` calls and rely on `sync.Once`-like idempotency.

**Q39. How would you make `TestMain` print a flame graph of setup time?**

Instrument with `runtime/pprof.StartCPUProfile` during setup, stop before `m.Run`, write to a file. After the run, open with `go tool pprof -http`.

**Q40. What is the worst `TestMain` bug you have seen?**

Common candidate: a `TestMain` that started a goroutine which called `t.Fatal` on a deferred check. Since `t.Fatal` uses `runtime.Goexit` and there was no `*testing.T` in scope, the goroutine panicked and the main thread carried on. The teardown ran, the program exited zero, and CI thought everything was fine — meanwhile real tests had crashed silently. Lesson: `TestMain` is not the place for `t.Fatal`, and goroutines spawned from `TestMain` must be carefully scoped.

Practice these out loud. Recall the signature, the lifecycle, and the `os.Exit`-defers pitfall in your sleep — they are the most common live-coding traps in interviews touching Go testing infrastructure.

## A short live-coding exercise

A common interview prompt: "write a `TestMain` for a package that needs a Postgres container, runs migrations once, exposes a `*sql.DB`, and is robust to panics during setup." If you can write this on a whiteboard without looking, you have internalized `TestMain`:

```go
var db *sql.DB

func TestMain(m *testing.M) {
    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                fmt.Fprintf(os.Stderr, "TestMain panic: %v\n%s\n", r, debug.Stack())
                c = 1
            }
        }()
        ctx := context.Background()
        pg, err := postgres.Run(ctx, "postgres:16")
        if err != nil {
            fmt.Fprintln(os.Stderr, err)
            return 1
        }
        defer pg.Terminate(ctx)

        dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
        db, err = sql.Open("postgres", dsn)
        if err != nil {
            fmt.Fprintln(os.Stderr, err)
            return 1
        }
        defer db.Close()
        if err := migrate(db); err != nil {
            fmt.Fprintln(os.Stderr, err)
            return 1
        }
        return m.Run()
    }()
    os.Exit(code)
}
```

If you can explain why each piece is there — the IIFE for `defer`, the recover for panics, the early `1` returns for setup failure — you have demonstrated mastery.

## Whiteboard variations

Interviewers sometimes ask follow-ups on the same theme. Be ready for:

**"Now refactor this to also start a Redis container."**

Show parallel startup with `errgroup`:

```go
g, ctx := errgroup.WithContext(context.Background())
var pgDSN, redisAddr string
g.Go(func() error { /* start pg */ return nil })
g.Go(func() error { /* start redis */ return nil })
if err := g.Wait(); err != nil { /* exit 1 */ }
```

**"How do you make tests parallel-safe given this shared `db`?"**

Each test gets its own logical database via `CREATE DATABASE ... TEMPLATE`. Or each test runs inside a transaction that is rolled back. The shared `*sql.DB` itself is goroutine-safe.

**"What if `TestMain` runs twice (e.g., under `-fuzz`)?"**

Make setup idempotent. Use `sync.Once` if it must run exactly once per process. Cache containers via reuse semantics so restart is cheap.

**"How would you log the setup time?"**

`t := time.Now()` before each step, `log.Printf("step: %s", time.Since(t))`. Or push profiling: `pprof.StartCPUProfile`.

**"The test binary takes 30 seconds to start. What do you investigate?"**

Add timing logs to identify the slowest step. Common culprits: container image pull, schema migration, TLS handshake. Then apply: pre-pull image, cache schema via template database, parallelize independent steps, gate behind `-short`.

The pattern: each follow-up tests whether you have internalized a different aspect of `TestMain` operations. Hold the live-coding example in mental cache; the follow-ups will be variations on it.

## Curveball questions

A few questions specifically designed to catch overconfidence:

**"Does `TestMain` run before or after `init` functions in the same package?"**

After. Init functions of every imported package (including the test package) run during binary startup, before `TestMain` is called.

**"Can I call `t.Parallel` from a goroutine spawned in `TestMain`?"**

No. `t.Parallel` is a method on `*testing.T`, which only exists inside `TestXxx` and its callees. `TestMain` has `*testing.M`, which has no parallel-related methods.

**"What is the return value of `m.Run()` if no tests match `-test.run`?"**

`0`. No tests ran, no tests failed. Empty pass. This sometimes surprises people who expect "no tests" to be an error.

**"Does `go test -bench=.` call my `TestMain`?"**

Yes. Benchmarks are dispatched by `m.Run` like tests. Your setup runs before any benchmark.

**"What about `go test -fuzz=Fuzz`?"**

Yes. Fuzz targets are part of `m.Run`. The fuzzer may restart the binary, in which case `TestMain` runs again.

**"What about `go test -run Example`?"**

Yes. Example functions are also dispatched by `m.Run`. Output is checked against the `// Output:` comment.

The unifying answer: anything `go test` runs goes through `m.Run`, and therefore through `TestMain` if defined.

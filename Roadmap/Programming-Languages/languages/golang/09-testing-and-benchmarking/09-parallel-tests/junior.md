---
layout: default
title: Parallel Tests — Junior
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/junior/
---

# Parallel Tests — Junior

[← Back](../)

This page introduces `t.Parallel` from the ground up. By the end of it you should be able to: explain what `t.Parallel()` does, write a parallel test, write parallel table-driven subtests safely, recognise the pre-Go 1.22 loop-variable capture bug, control the parallelism with the `-parallel` flag, and identify the most common categories of tests that should *not* be parallel.

## 1. The default: tests run serially

When you write your first test, you do not need to know anything about parallelism. The `go test` tool compiles every `_test.go` in the package and runs each `TestXxx(t *testing.T)` function one after another, in the order they appear in the source. Sub-tests created via `t.Run("name", func(t *testing.T) { ... })` also run serially relative to one another by default.

```go
package mathutil

import "testing"

func Square(n int) int { return n * n }

func TestSquare(t *testing.T) {
    if got := Square(3); got != 9 {
        t.Fatalf("Square(3) = %d, want 9", got)
    }
}

func TestCube(t *testing.T) {
    cases := []struct {
        in, want int
    }{
        {2, 8},
        {3, 27},
    }
    for _, tc := range cases {
        if got := tc.in * tc.in * tc.in; got != tc.want {
            t.Errorf("Cube(%d) = %d, want %d", tc.in, got, tc.want)
        }
    }
}
```

Running `go test -v` prints:

```
=== RUN   TestSquare
--- PASS: TestSquare (0.00s)
=== RUN   TestCube
--- PASS: TestCube (0.00s)
PASS
ok      example/mathutil   0.003s
```

Two tests, one after the other. Nothing parallel about this.

## 2. What `t.Parallel()` does

`t.Parallel()` is a method on `*testing.T`. Calling it tells the framework: "I am safe to run concurrently with other tests that also call `t.Parallel()`." Internally, the framework *pauses* the goroutine for the current test, finishes running any serial tests in the same level, then resumes all parallel tests together (up to a configured maximum).

```go
package mathutil

import "testing"

func TestSquareParallel(t *testing.T) {
    t.Parallel()
    if got := Square(5); got != 25 {
        t.Fatalf("Square(5) = %d, want 25", got)
    }
}

func TestCubeParallel(t *testing.T) {
    t.Parallel()
    if got := 4 * 4 * 4; got != 64 {
        t.Fatalf("got %d, want 64", got)
    }
}
```

With `go test -v`:

```
=== RUN   TestSquareParallel
=== PAUSE TestSquareParallel
=== RUN   TestCubeParallel
=== PAUSE TestCubeParallel
=== CONT  TestSquareParallel
=== CONT  TestCubeParallel
--- PASS: TestCubeParallel (0.00s)
--- PASS: TestSquareParallel (0.00s)
PASS
```

The `=== PAUSE` line marks where `t.Parallel()` was called; `=== CONT` is where the framework resumed the test. Both tests then ran concurrently. The order they print is non-deterministic — never rely on it.

## 3. What "concurrent" means here

Go's test framework starts a goroutine per parallel test. The number of parallel tests allowed to run *at the same time* is capped by the `-parallel` flag (default: `GOMAXPROCS`, typically the number of CPU cores). The Go runtime then multiplexes those goroutines onto the available OS threads.

On a 4-core machine with `-parallel 4`, four tests run truly in parallel; on `-parallel 1`, parallel-marked tests still get the `=== PAUSE` / `=== CONT` dance but execute one at a time.

```bash
go test -v -parallel 1 ./mathutil    # one at a time
go test -v -parallel 4 ./mathutil    # up to 4 at once
go test -v -parallel 16 ./mathutil   # up to 16, may exceed cores
```

## 4. Why bother?

A serial 60-second suite often becomes a 6-second parallel suite when most tests are short and CPU-light. The speed-up is the most visible reason, but the real point is that **parallel tests amplify race conditions** and let `-race` catch them in CI rather than in production. A test suite that runs parallel-by-default is a passive correctness check on the codebase's thread safety.

## 5. Subtests with `t.Run`

`t.Run` creates a subtest. It is most useful for table-driven tests, where a single `TestParse` function holds many cases:

```go
package mathutil

import (
    "strconv"
    "testing"
)

func TestParseSerial(t *testing.T) {
    cases := []struct {
        name string
        in   string
        want int
    }{
        {"one", "1", 1},
        {"two", "2", 2},
        {"three", "3", 3},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := strconv.Atoi(tc.in)
            if err != nil {
                t.Fatal(err)
            }
            if got != tc.want {
                t.Errorf("Atoi(%q) = %d, want %d", tc.in, got, tc.want)
            }
        })
    }
}
```

Verbose output shows nested subtests:

```
=== RUN   TestParseSerial
=== RUN   TestParseSerial/one
=== RUN   TestParseSerial/two
=== RUN   TestParseSerial/three
--- PASS: TestParseSerial (0.00s)
    --- PASS: TestParseSerial/one (0.00s)
    --- PASS: TestParseSerial/two (0.00s)
    --- PASS: TestParseSerial/three (0.00s)
```

All three subtests ran serially inside `TestParseSerial`. The whole thing runs serially relative to other top-level tests.

## 6. Parallel subtests

To run the subtests in parallel, put `t.Parallel()` *inside* the subtest closure:

```go
func TestParseParallel(t *testing.T) {
    cases := []struct {
        name string
        in   string
        want int
    }{
        {"one", "1", 1},
        {"two", "2", 2},
        {"three", "3", 3},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            got, err := strconv.Atoi(tc.in)
            if err != nil {
                t.Fatal(err)
            }
            if got != tc.want {
                t.Errorf("Atoi(%q) = %d, want %d", tc.in, got, tc.want)
            }
        })
    }
}
```

Each subtest's goroutine pauses at `t.Parallel()`, the loop finishes registering all three, then they all run concurrently.

You can also call `t.Parallel()` on the *outer* `TestParseParallel`. That makes the whole table-driven test run in parallel with *other top-level* parallel tests, while its subtests are serial (unless they also call `t.Parallel()`):

```go
func TestParseParallel(t *testing.T) {
    t.Parallel() // outer test parallel
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            // subtests serial inside this test
        })
    }
}
```

Both levels can be parallel: outer + inner. The combinatorics let you tune the concurrency.

## 7. The pre-Go 1.22 loop-variable trap

This is the single most famous gotcha in Go testing. On Go 1.21 and earlier, `for _, tc := range cases { ... }` reused one storage slot for `tc` across all iterations. A goroutine created inside the loop that referred to `tc` saw whatever value `tc` had *when the goroutine ran*, not when the goroutine was created.

For a parallel subtest, this is a disaster: each subtest's goroutine pauses, the loop finishes (advancing `tc` to its last value), and then all paused goroutines resume — every one reads the final `tc`.

The fix on Go ≤1.21 was to "shadow" the variable inside the loop body:

```go
for _, tc := range cases {
    tc := tc // re-declare, gives each iteration its own tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // tc now safely refers to this iteration's value
    })
}
```

On Go 1.22+, the language was changed: each iteration of a `for` loop creates a fresh `tc`, and the manual shadow is unnecessary (but harmless). You may still see the shadow in older code and on projects that pin to Go 1.21 or earlier. `go vet`'s `loopclosure` check warns about the pre-1.22 form when running on older Go.

Concrete demonstration of the bug (run on Go 1.21):

```go
// On Go 1.21:
for _, tc := range []string{"a", "b", "c"} {
    t.Run(tc, func(t *testing.T) {
        t.Parallel()
        t.Logf("tc=%s", tc)
    })
}
// All three subtests log "tc=c" because the loop completed before they resumed.
```

On Go 1.22+:

```go
// All three log distinct values: "tc=a", "tc=b", "tc=c".
```

This single language change deleted an entire category of test bug.

## 8. The `-parallel` flag

`-parallel N` limits how many `t.Parallel`-marked tests run concurrently within one test binary. The default is `runtime.GOMAXPROCS(0)` of the test binary at startup. Common values:

```bash
go test -parallel 1 ./...   # disable parallelism: useful for debugging
go test -parallel 4 ./...   # 4 at a time
go test -parallel 16 ./...  # 16 at a time
```

Going above `GOMAXPROCS` makes sense only for I/O-bound tests (DB queries, HTTP calls, file reads) — extra goroutines can do useful work while peers wait on the kernel. For CPU-bound tests, going above the core count rarely helps.

Independent of `-parallel`, the `go test` driver itself runs multiple *packages* in parallel, controlled by `-p`. So `go test -p 4 -parallel 8 ./...` runs up to 4 test binaries concurrently, each running up to 8 parallel tests, for a peak of 32 concurrent `*testing.T` instances.

## 9. The race detector: `-race`

Race conditions are bugs where two goroutines access the same memory without proper synchronisation, and at least one of the accesses is a write. They are notoriously hard to reproduce because they depend on the scheduler.

The race detector instruments memory accesses at compile time and reports violations at runtime. Combine it with `-parallel` to surface bugs:

```bash
go test -race -parallel 4 ./...
```

It costs about 5–10x in runtime and ~10x in memory, so it's typical to run a regular suite and a `-race` suite as separate CI jobs.

Example of what `-race` catches:

```go
var counter int

func TestRace(t *testing.T) {
    for i := 0; i < 4; i++ {
        i := i
        t.Run(fmt.Sprint(i), func(t *testing.T) {
            t.Parallel()
            counter++ // race
        })
    }
}
```

Output with `-race`:

```
==================
WARNING: DATA RACE
Read at 0x... by goroutine 12:
  pkg.TestRace.func1()
      file.go:9
Previous write at 0x... by goroutine 13:
  pkg.TestRace.func1()
      file.go:9
==================
```

The detector points at the exact line. Fix it by removing the parallelism, scoping `counter` to the test function, or using `atomic.AddInt64`.

## 10. What is NOT safe to do in a parallel test?

The four classics:

1. **Mutate process-global state**: package-level `var x int`, singletons, registries. Two parallel tests overwriting each other's value is a race.
2. **Change environment variables**: `os.Setenv` affects the whole process. The framework forbids `t.Setenv` after `t.Parallel` for this reason.
3. **Change working directory**: `os.Chdir` is process-global. Two parallel tests changing it race. On Go 1.24+, `t.Chdir` panics if `t.Parallel` was called.
4. **Touch the same file or port**: Two parallel tests writing to `/tmp/output.txt` collide. Use `t.TempDir()` for unique paths; use port `:0` to let the OS pick a free port.

When in doubt: ask "what *outside* my test function does my test touch?" Anything outside the function body is shared with siblings.

## 11. Safe isolation primitives

The two go-to primitives for isolating parallel tests are `t.TempDir` and `t.Setenv` (the latter only when *not* in a parallel test).

```go
func TestWriteFile(t *testing.T) {
    t.Parallel()
    dir := t.TempDir() // unique per test, cleaned up automatically
    path := filepath.Join(dir, "out.txt")
    if err := os.WriteFile(path, []byte("hi"), 0o644); err != nil {
        t.Fatal(err)
    }
    data, err := os.ReadFile(path)
    if err != nil {
        t.Fatal(err)
    }
    if string(data) != "hi" {
        t.Errorf("got %q, want %q", data, "hi")
    }
}
```

`t.TempDir()`:

- Creates a fresh directory under `os.TempDir()` (typically `/tmp/...`).
- Registers a cleanup that removes the directory after the test.
- Returns a different path every time, so 1000 parallel tests don't collide.

For environment variables, `t.Setenv` exists specifically to *forbid* parallelism — it mutates a process-global table, so it cannot be safe with `t.Parallel`. If you need a "per-test env", thread it through a `Config` struct instead.

## 12. Cleanup: `t.Cleanup`

When a parallel test ends, the work it did may need teardown. Use `t.Cleanup`:

```go
func TestWithServer(t *testing.T) {
    t.Parallel()
    srv := httptest.NewServer(handler)
    t.Cleanup(func() { srv.Close() })
    resp, err := http.Get(srv.URL + "/")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    // ...
}
```

`t.Cleanup`:

- Runs after the test (and all subtests) finish, in LIFO order.
- Runs on the test's own goroutine.
- Survives `t.FailNow` and `t.Skip`, unlike `defer` after such calls.

Prefer `t.Cleanup` to `defer` in tests. The two look similar but `t.Cleanup` is the test-aware version that knows about subtests and parallelism.

## 13. A first "real" example

Putting it together. Suppose you are testing a JSON encoder that takes a struct and returns bytes.

```go
package encoder

import (
    "encoding/json"
    "testing"
)

type Person struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

func Encode(p Person) ([]byte, error) {
    return json.Marshal(p)
}

func TestEncode(t *testing.T) {
    cases := []struct {
        name string
        in   Person
        want string
    }{
        {"empty", Person{}, `{"name":"","age":0}`},
        {"alice", Person{Name: "Alice", Age: 30}, `{"name":"Alice","age":30}`},
        {"bob", Person{Name: "Bob", Age: 0}, `{"name":"Bob","age":0}`},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            got, err := Encode(tc.in)
            if err != nil {
                t.Fatal(err)
            }
            if string(got) != tc.want {
                t.Errorf("Encode(%+v) = %s, want %s", tc.in, got, tc.want)
            }
        })
    }
}
```

What this demonstrates:

- A table-driven test with subtests.
- `t.Parallel()` inside each subtest, so they run concurrently.
- No shared state: every iteration reads its own `tc` (safe on Go 1.22+ without `tc := tc`).
- No environment variables, no working-directory changes, no files. Pure CPU work — perfect for parallelism.

Run with `go test -v -parallel 4 ./encoder` and confirm the `=== PAUSE` / `=== CONT` interleaving in the output.

## 14. When NOT to call `t.Parallel`

Quick reference:

| Test does this | Parallel? |
|----------------|-----------|
| Calls a pure function with no globals | yes |
| Reads from a const string table | yes |
| Calls `t.Setenv` | no (forbidden) |
| Calls `os.Chdir` | no |
| Uses `t.TempDir` | yes (already isolated) |
| Modifies a package-level `var` | no |
| Listens on a fixed port | no |
| Listens on `:0` (OS-picked port) | yes |
| Calls `signal.Notify` | no |
| Uses `flag.CommandLine` | no |
| Uses `httptest.NewServer` | yes (each test gets a fresh server) |

When in doubt, default to parallel and let `-race` tell you when you got it wrong.

## 15. Common surprises

- `t.Parallel` inside a test that has already called `t.Setenv` panics.
- A parallel subtest's parent's `t.Run` returns before the subtest finishes. To synchronise, wrap in another `t.Run("group", ...)`.
- The order tests print results in `-v` mode is non-deterministic when parallel. Don't write integration tests that check stdout line order.
- `t.Parallel` does not make `t.Errorf`, `t.Fatalf`, `t.Helper`, `t.TempDir`, `t.Cleanup` behave differently. The API is identical; only the schedule changes.

## 16. A guided exercise: convert a serial suite to parallel

Suppose you have this serial test file:

```go
package calc

import "testing"

func Sum(a, b int) int { return a + b }
func Sub(a, b int) int { return a - b }
func Mul(a, b int) int { return a * b }

func TestSum(t *testing.T) {
    if got := Sum(2, 3); got != 5 {
        t.Errorf("Sum(2,3) = %d, want 5", got)
    }
}

func TestSub(t *testing.T) {
    if got := Sub(7, 4); got != 3 {
        t.Errorf("Sub(7,4) = %d, want 3", got)
    }
}

func TestMul(t *testing.T) {
    if got := Mul(6, 9); got != 54 {
        t.Errorf("Mul(6,9) = %d, want 54", got)
    }
}
```

Step 1: Add `t.Parallel()` as the first call in each test. The functions are pure (no shared state, no I/O), so it's safe.

```go
func TestSum(t *testing.T) {
    t.Parallel()
    if got := Sum(2, 3); got != 5 {
        t.Errorf("Sum(2,3) = %d, want 5", got)
    }
}
// repeat for TestSub and TestMul
```

Step 2: Run `go test -v` and confirm the `=== PAUSE` / `=== CONT` lines appear.

Step 3: Run `go test -race -count=10` to confirm no races.

Step 4: Add `-parallel 2` and confirm only 2 tests run at a time (less interesting for 3 tests, but the principle holds).

The whole exercise takes 3 minutes for a small file. For a 50-test file it takes 15. The speedup on the latter is significant.

## 17. Reading `-v` output

The `-v` flag prints each test event. A parallel test produces this sequence:

```
=== RUN   TestX
=== PAUSE TestX
[other serial tests run in between]
=== CONT  TestX
[the test's t.Log output]
--- PASS: TestX (0.01s)
```

- `=== RUN` — test goroutine started.
- `=== PAUSE` — `t.Parallel()` was called; goroutine is parked.
- `=== CONT` — goroutine was resumed.
- `--- PASS` / `--- FAIL` — test finished.

When multiple tests are parallel, `=== CONT` lines for different tests can interleave with each other. This is normal.

## 18. Reading `-v` output for subtests

A parallel subtest's events nest under its parent:

```
=== RUN   TestParse
=== RUN   TestParse/one
=== PAUSE TestParse/one
=== RUN   TestParse/two
=== PAUSE TestParse/two
=== RUN   TestParse/three
=== PAUSE TestParse/three
=== CONT  TestParse/one
=== CONT  TestParse/two
=== CONT  TestParse/three
--- PASS: TestParse (0.00s)
    --- PASS: TestParse/one (0.00s)
    --- PASS: TestParse/two (0.00s)
    --- PASS: TestParse/three (0.00s)
```

All three subtests register, then pause, then resume concurrently. The parent `TestParse` is marked PASS after all subtests finish.

## 19. Avoiding `time.Sleep`

A frequent mistake in tests of asynchronous code is to wait with `time.Sleep`:

```go
func TestAsync(t *testing.T) {
    t.Parallel()
    StartBackgroundWorker()
    time.Sleep(100 * time.Millisecond) // hope this is enough
    if !workerDone() {
        t.Fatal("worker didn't finish")
    }
}
```

Problems:

- Under heavy CI load, 100 ms might not be enough; the test flakes.
- If the work finishes in 1 ms, the test wastes 99 ms.
- Two parallel tests both sleeping double the wall-clock for no gain.

The right way is to synchronise explicitly:

```go
func TestAsync(t *testing.T) {
    t.Parallel()
    done := make(chan struct{})
    StartBackgroundWorker(func() { close(done) })
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("worker didn't finish")
    }
}
```

`done` closes the moment the worker finishes, so the test takes the minimum time. The 2-second deadline is the absolute upper bound, used only on failure.

## 20. `httptest` for HTTP-aware tests

The standard library's `net/http/httptest` package is purpose-built for parallel HTTP tests. Each call to `httptest.NewServer` creates a fresh listener on a unique port, so tests don't collide:

```go
func TestEcho(t *testing.T) {
    t.Parallel()
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintf(w, "echo: %s", r.URL.Path)
    }))
    t.Cleanup(srv.Close)

    resp, err := http.Get(srv.URL + "/hello")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        t.Fatal(err)
    }
    if string(body) != "echo: /hello" {
        t.Errorf("got %q", body)
    }
}
```

Each parallel run of `TestEcho` gets a different `srv.URL`. The `t.Cleanup` ensures the listener is closed even if the test fails.

## 21. `httptest.NewRecorder` for handler-only tests

When you want to test a single HTTP handler without spinning up a server, use `httptest.NewRecorder`:

```go
func TestHandler(t *testing.T) {
    t.Parallel()
    req := httptest.NewRequest(http.MethodGet, "/ping", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("got %d, want 200", rec.Code)
    }
}
```

`httptest.NewRecorder` is fully in-memory; no listener, no port, fully parallel-safe.

## 22. Two real-world examples from the standard library

The Go standard library uses `t.Parallel` extensively. Two patterns worth studying:

**`encoding/json` (well over 1000 parallel subtests).** Most tests are table-driven, with each subtest in `t.Run` calling `t.Parallel`. The tests use only stack-allocated values; no shared state. The suite runs in seconds despite testing thousands of edge cases.

**`net/http` (large parallel HTTP test suite).** Each test creates its own `httptest.Server`, calls `t.Parallel`, and uses `t.Cleanup` to close the server. The structure is highly consistent across hundreds of tests.

Reading these test files is one of the best ways to internalise idiomatic parallel-test style. Run:

```bash
go doc -src net/http TestRedirect
go doc -src encoding/json TestEncode
```

## 23. `Example` functions and parallelism

Example functions (`func ExampleFoo() { ... }`) are not parallel. They run serially and check stdout against the `// Output:` comment. They are documentation that doubles as tests, optimised for readability not speed.

Don't try to make Examples parallel; they're inherently about sequential output.

## 24. `Skip` and `SkipNow`

`t.Skip` marks the test as skipped and stops its execution. In a parallel test, it works the same way: the test pauses on `t.Parallel`, resumes when scheduled, calls `t.Skip`, and is reported as SKIP.

```go
func TestExpensive(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping in -short mode")
    }
    t.Parallel()
    // ...
}
```

The order matters: call `t.Skip` *before* `t.Parallel` to avoid scheduling a test that will immediately skip.

## 25. `t.Helper` in parallel-test helpers

When a helper function calls `t.Errorf` or `t.Fatal`, by default the error line points inside the helper, not at the call site in the test. `t.Helper()` flips this:

```go
func assertEqual(t *testing.T, got, want any) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

func TestThing(t *testing.T) {
    t.Parallel()
    assertEqual(t, Square(3), 9) // error points HERE, not inside assertEqual
}
```

`t.Helper` works identically in parallel and serial tests. Always call it as the first line of a helper.

## 26. Test names in parallel output

When `t.Run` is given a name with spaces or slashes, Go normalises it. Slashes become subtest separators; spaces are URL-encoded:

```go
t.Run("with spaces", func(t *testing.T) { ... })
// becomes: TestThing/with_spaces
```

When parallel tests are scheduled, their names appear in the output verbatim — useful for tracing which subtest is which. Keep names short and unique.

## 27. The `-run` flag with parallel tests

`-run` filters which tests execute, using a regex:

```bash
go test -run TestThing -parallel 4
go test -run TestThing/one -parallel 4 # one subtest
go test -run TestThing/.*one -parallel 4 # subtests matching .*one
```

Parallel semantics apply only to the selected tests; filtered-out tests don't pause and don't take a slot in the parallel queue.

## 28. The `-v` flag with parallel tests

`-v` always prints every test event. Without `-v`, only failures are shown:

```bash
go test -parallel 4 ./pkg            # quiet, just OK/FAIL
go test -v -parallel 4 ./pkg         # full event log
go test -v -parallel 4 -run X ./pkg  # one test, full event log
```

For debugging a parallel flake, always use `-v`; you need to see the order of events.

## 29. Running a single parallel test repeatedly

To reproduce a flaky parallel test, run it many times:

```bash
go test -run TestFlaky -count=100 -parallel 4 -v
```

`-count=100` runs each matched test 100 times in the same binary. If the test flakes 1% of the time, 100 runs hits it once on average.

## 30. Common confusions

**Confusion 1**: "I added `t.Parallel` but the tests still run one at a time."
Likely cause: `-parallel 1` is set somewhere (CI config, `GOFLAGS`). Check `echo $GOFLAGS` and the CI config.

**Confusion 2**: "My parallel test passes but `-race` reports a race."
The race is real. Find the unsynchronised shared state and fix it. Don't dismiss the report.

**Confusion 3**: "My test prints `=== PAUSE` but never `=== CONT`."
The framework hasn't released the parallel queue yet — usually because a serial test is still running, or because `-parallel` is set very low.

**Confusion 4**: "Two tests using `t.TempDir` got the same path."
Impossible by design. If you see this, you're misreading the output (the path includes the test name, which may be the same across runs but the random suffix is unique).

**Confusion 5**: "My test passes locally but fails in CI."
Usually a parallelism difference: local has more cores, CI has fewer. Run locally with `-parallel 2` or `GOMAXPROCS=2 go test ...` to reproduce.

## 31. Mental model: the parallel queue

Imagine the test framework has a queue. Tests run serially in source order. When a test calls `t.Parallel`, it parks itself on the queue and yields. After all serial siblings at the same level complete, the framework starts draining the queue — releasing up to `-parallel` tests at a time. When one finishes, the next is released.

```
Queue: [TestA, TestC]
Running: TestB (serial), waiting...
TestB finishes.
Queue drains; up to -parallel tests resume.
TestA and TestC run concurrently.
Both finish; queue empty.
m.Run returns.
```

This model accounts for every visible behavior: the pause, the wait, the burst of resumption.

## 32. Summary

- `t.Parallel()` opts into concurrent execution with sibling parallel tests.
- The default `-parallel` is `GOMAXPROCS`; control with the flag.
- Subtests need `t.Parallel()` inside the closure to be concurrent.
- On Go ≤1.21, shadow the loop variable; on Go 1.22+, the language handles it.
- Use `t.TempDir` to isolate file-system state; avoid `os.Setenv` and `os.Chdir` in parallel tests.
- Run `-race` to catch the bugs `t.Parallel` exposes.
- Use `t.Cleanup` instead of `defer` for teardown.
- Use `httptest` for HTTP tests; ports never collide.
- Replace `time.Sleep` with channels or `t.Context` for synchronisation.
- The `-v`, `-run`, `-count`, and `-parallel` flags are your daily tools.

## 33. Where to go next

- The **middle** page covers grouped parallel subtests, fixture design, and resource pools.
- The **senior** page extends to architectural decisions about shared state and migration strategies.
- The **specification** page is the reference for every godoc claim made on this page.
- The **interview** page has practice questions at every level.
- The **tasks** page has hands-on exercises with clear pass/fail criteria.

Read in any order; revisit `find-bug.md` after you've written a few real parallel tests — the bugs there will start looking familiar.

## 34. Practice plan for the first week

- Day 1: write three parallel tests using `t.Parallel`. Run with `-v -race`.
- Day 2: write a table-driven parallel test. Confirm the `=== PAUSE` / `=== CONT` interleave.
- Day 3: write a test using `t.TempDir` and `t.Cleanup`. Confirm cleanup runs after the test.
- Day 4: write a test that needs `t.Setenv` and explain why it can't be parallel.
- Day 5: write a `TestMain` with one setup and one teardown line. Verify it runs before/after `m.Run`.
- Day 6: take a 10-test file and convert all to parallel where safe. Benchmark before/after.
- Day 7: read `encoding/json/encode_test.go` and `net/http/server_test.go` for idiomatic patterns.

After this week, parallel testing should feel as natural as writing the test function itself.

## 35. A deeper look at `=== PAUSE` and `=== CONT`

When you read `-v` output for the first time, the `=== PAUSE` and `=== CONT` lines look like noise. Once you understand them, they become a precise log of the test framework's scheduling decisions.

`=== RUN TestX` — the test function has been invoked; its goroutine is alive and executing.

`=== PAUSE TestX` — `t.Parallel()` returned. The test's goroutine is sleeping on an internal channel. The framework has noted that this test is ready to be batched with other parallel tests later.

`=== CONT TestX` — the framework has decided to wake this test up. Its goroutine resumes from just after the `t.Parallel()` call.

`--- PASS: TestX (0.01s)` — the test's function returned successfully. The elapsed time is from `=== RUN` to here, *including the time spent paused*. This is important: a test that paused for 5 seconds before finishing in 1 ms will report 5.001s elapsed.

Knowing this saves debugging time. If a parallel test reports unexpectedly long elapsed time, check whether it was paused for a long stretch — possibly because earlier serial tests were slow.

## 36. The `-cpu` flag

The `-cpu` flag runs each test multiple times with different `GOMAXPROCS` settings:

```bash
go test -cpu=1,2,4 -v ./...
```

This runs every test once with `GOMAXPROCS=1`, once with `=2`, once with `=4`. Total: 3x the work per test. Useful for catching tests that pass on multi-core machines but fail on single-core (or vice versa).

Combined with `-parallel`, you can quickly explore the behavior of your suite under different concurrency settings. Just remember that `-cpu` multiplies the number of test runs.

## 37. `runtime.GOMAXPROCS`

`runtime.GOMAXPROCS(0)` returns the current setting. The test binary uses the value set by `-cpu` or the default. Tests can read it but should not modify it during a run:

```go
func TestCPUCount(t *testing.T) {
    t.Parallel()
    n := runtime.GOMAXPROCS(0)
    t.Logf("running with GOMAXPROCS=%d", n)
}
```

Modifying `GOMAXPROCS` from within a parallel test is a race (it affects the whole runtime). Don't do it.

## 38. Cleaning up files in `t.TempDir`

`t.TempDir` registers a cleanup that removes the directory recursively. You can rely on this:

```go
func TestWrite(t *testing.T) {
    t.Parallel()
    dir := t.TempDir()
    for i := 0; i < 100; i++ {
        path := filepath.Join(dir, fmt.Sprintf("file-%d.txt", i))
        os.WriteFile(path, []byte("data"), 0o644)
    }
    // No explicit cleanup needed; t.TempDir handles it.
}
```

The directory and all its contents are removed after the test finishes. This works even on Windows, where file locking can complicate manual cleanup.

## 39. When `t.TempDir` is not enough

`t.TempDir` creates a directory under `os.TempDir()`. If your test needs to test paths in a different location (a specific mountpoint, a Windows UNC path, etc.), you'll need to create and clean up manually:

```go
func TestSpecificPath(t *testing.T) {
    t.Parallel()
    base := "/mnt/test-data/" + t.Name() + "-" + randomSuffix()
    if err := os.MkdirAll(base, 0o755); err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { os.RemoveAll(base) })
    // ... use base
}
```

The `randomSuffix()` (e.g., 8 hex digits from `crypto/rand`) ensures parallel tests don't collide.

## 40. Reading a parallel test's output: practical exercise

Run this code:

```go
package demo

import "testing"

func TestA(t *testing.T) {
    t.Parallel()
    t.Log("A: start")
    t.Log("A: end")
}

func TestB(t *testing.T) {
    t.Log("B: serial start")
    t.Log("B: serial end")
}

func TestC(t *testing.T) {
    t.Parallel()
    t.Log("C: start")
    t.Log("C: end")
}
```

With `go test -v -parallel 4`, the output is (one possible ordering):

```
=== RUN   TestA
=== PAUSE TestA
=== RUN   TestB
    demo_test.go:14: B: serial start
    demo_test.go:15: B: serial end
--- PASS: TestB (0.00s)
=== RUN   TestC
=== PAUSE TestC
=== CONT  TestA
=== CONT  TestC
    demo_test.go:7: A: start
    demo_test.go:8: A: end
    demo_test.go:19: C: start
    demo_test.go:20: C: end
--- PASS: TestA (0.00s)
--- PASS: TestC (0.00s)
PASS
```

Note:

- `t.Log` calls are buffered per test, then flushed when the test ends.
- The buffer is flushed before `--- PASS`, all in one block.
- A's log and C's log appear in distinct blocks, even though A and C ran concurrently.
- B's log appears before A's, because B finished first (it ran serially while A was paused).

Practice reading this output until the pattern is obvious.

## 41. `t.Errorf` vs `t.Fatalf` in parallel tests

`t.Errorf` marks the test as failed but continues execution. `t.Fatalf` marks it failed and stops execution (via `t.FailNow`). Both work the same way in parallel and serial tests.

In a parallel test, the choice has the same trade-offs as serial:

```go
func TestX(t *testing.T) {
    t.Parallel()
    got, err := fetch()
    if err != nil {
        t.Fatalf("fetch: %v", err) // can't continue if fetch failed
    }
    if got.ID == 0 {
        t.Errorf("got zero ID") // could check more fields
    }
    if got.Name == "" {
        t.Errorf("got empty name")
    }
}
```

`t.Fatalf` for fail-fast on prerequisites; `t.Errorf` for accumulating findings. Don't mix them up.

## 42. Patterns I see in junior code (and how to fix them)

**Pattern A**: forgetting `t.Parallel` entirely.

Fix: add it as the first call in every test function unless the test mutates global state.

**Pattern B**: `t.Parallel` at the top, then mutating a package-level slice.

Fix: scope the slice locally or remove parallelism.

**Pattern C**: hardcoded port numbers.

Fix: `":0"` and read back the actual port from `ln.Addr()`.

**Pattern D**: `defer cleanup()` instead of `t.Cleanup(cleanup)`.

Fix: use `t.Cleanup`; it's more robust against `t.FailNow`.

**Pattern E**: `time.Sleep` waiting for an async operation.

Fix: use a channel, `sync.WaitGroup`, or `t.Context()`.

**Pattern F**: `os.Setenv` directly in a test.

Fix: use `t.Setenv` (and accept the lack of parallelism), or refactor the production code to read config from a struct.

## 43. The pre-1.22 loop-variable bug, illustrated more

To really understand the bug, write the buggy code with explicit goroutine numbering:

```go
// Pre-Go 1.22:
for _, tc := range []string{"a", "b", "c"} {
    t.Run(tc, func(t *testing.T) {
        t.Parallel()
        // Goroutine 1 reads tc here, but tc is shared across iterations.
        // When the goroutine resumes, the loop has finished and tc == "c".
        t.Log(tc)
    })
}
// All three log "c".
```

The fix:

```go
for _, tc := range []string{"a", "b", "c"} {
    tc := tc // each iteration creates its own copy
    t.Run(tc, func(t *testing.T) {
        t.Parallel()
        t.Log(tc) // now correctly logs "a", "b", "c"
    })
}
```

On Go 1.22+, the language change makes the `tc := tc` redundant. The fresh-variable-per-iteration is now built into the language. `go vet`'s `loopclosure` analyzer still flags the missing shadow on older Go.

Practice: write the bug, run it on Go 1.21, observe the all-"c" output. Apply the fix. Re-run. Confirm distinct outputs. This is a five-minute exercise that prevents an hour of frustration later.

## 44. Combining `t.Run`, `t.Parallel`, and `t.Cleanup`

The three primitives compose well. A complete parallel subtest example:

```go
func TestUsers(t *testing.T) {
    cases := []struct {
        name string
        id   int
    }{
        {"alice", 1},
        {"bob", 2},
        {"carol", 3},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            db := openTestDB(t) // helper that calls t.Cleanup
            user, err := db.GetUser(tc.id)
            if err != nil {
                t.Fatalf("GetUser: %v", err)
            }
            if user.Name != tc.name {
                t.Errorf("got name %q, want %q", user.Name, tc.name)
            }
        })
    }
}

func openTestDB(t *testing.T) *DB {
    t.Helper()
    db := newDB()
    t.Cleanup(func() { db.Close() })
    seed(db)
    return db
}
```

Read top-to-bottom:

1. `cases` is a table.
2. Each row launches a subtest via `t.Run`.
3. Each subtest calls `t.Parallel` first thing.
4. Each subtest builds its own DB via a helper.
5. The helper registers cleanup so the DB is closed automatically.
6. The assertion is just a comparison.

No global state, no manual cleanup, no synchronization issues. This is what good junior-level parallel test code looks like.

## 45. The race detector report format

When `-race` catches a race, the report includes:

```
==================
WARNING: DATA RACE
Read at 0x... by goroutine N:
  pkg.SomeFunc()
      /path/to/file.go:42 +0x...
  testing.tRunner()
      ...

Previous write at 0x... by goroutine M:
  pkg.OtherFunc()
      /path/to/file.go:17 +0x...
  testing.tRunner()
      ...

Goroutine N (running) created at:
  testing.(*T).Run()
      ...

Goroutine M (finished) created at:
  testing.(*T).Run()
      ...
==================
```

To diagnose:

1. Read the "Read at" location. This is where the access happened.
2. Read the "Previous write at" location. This is the other access.
3. Both lines point to the same memory address (`0x...`).
4. Identify the shared variable.
5. Add a mutex, atomic, or restructure to eliminate the sharing.

Practice on a known buggy test: introduce a `var counter int`, increment from two parallel subtests, run with `-race`, read the report.

## 46. The middle page preview

The middle page elaborates on:

- The two-tier parallelism (`-p` vs `-parallel`) in detail.
- Grouped subtests and synchronization points.
- Fixture design: pooled, namespaced, immutable shared.
- The race detector at scale.
- `goleak` for goroutine leak detection.
- `TestMain` interactions with parallel tests.

If you've read this far, you have the foundation. Move to middle when you're writing your first non-trivial parallel test for a real codebase.

## 47. Frequently asked junior questions

**Q: Should every test be parallel?**

Almost. If the test is pure (no env vars, no working directory changes, no package-level state, no shared files), default to parallel. Document the rare exceptions inline.

**Q: How fast will my suite get?**

Roughly proportional to the number of cores, capped by the slowest serial test. A 10-second suite on 8 cores often becomes ~2 seconds. A suite where one test takes 5 seconds and others take 100 ms each cannot go below 5 seconds, no matter how parallel.

**Q: Will `t.Parallel` break my existing tests?**

It might. If your tests share state, parallelism exposes the race. The race was there before, just hidden. Run `-race` after adding `t.Parallel` to surface the bugs.

**Q: Can I call `t.Parallel` conditionally?**

You can put it inside an `if`, but the test framework expects it to be called at most once per test goroutine. Conditional `t.Parallel` is rare and usually a sign that the test should be split.

**Q: Does `t.Parallel` affect benchmark functions?**

No. Benchmarks use `b.RunParallel` and `b.SetParallelism` instead. The model is completely different.

## 48. The shape of a robust parallel test

After reading this page, here's the mental template for every new test you write:

```go
func TestX(t *testing.T) {
    t.Parallel()                       // first thing
    // Setup using parallel-safe helpers:
    fixture := newFixture(t)           // helper that registers t.Cleanup
    // Assertion:
    got, err := callTheFunction(fixture)
    if err != nil {
        t.Fatalf("setup error: %v", err)
    }
    if !equal(got, want) {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

Five sections: `t.Parallel`, fixtures, call, error check, value check. No `defer`. No package-level state. No `os.Setenv`. No `time.Sleep`. No working-directory changes.

Memorise the shape. Then every time you write a test, ask: "does this fit the shape? If not, why?"

## 49. The "before you commit" checklist

Before pushing a PR with new tests, run:

1. `go test ./...` — green.
2. `go test -race ./...` — green.
3. `go test -count=5 ./...` — green (catches per-test flakes).
4. `go vet ./...` — clean.

If any step fails, fix before committing. CI will run the same commands; failing locally and waiting for CI is a slow feedback loop.

## 49a. Tests that look pure but aren't

A surprising number of "pure" functions in Go libraries depend on subtle global state. Watch out for:

- `crypto/rand` and `math/rand` reading from a package-level source. `math/rand` has a default Source; concurrent reads need `math/rand/v2` (Go 1.22+) or a per-test `*rand.Rand`.
- `time.Now()` is global, but reads are safe (no mutation). Tests that compare timestamps from different parallel runs see different values, but each test sees consistent ones.
- `fmt.Sprintf` and friends acquire and release a sync pool of buffers — internally synchronised, fine for parallel.
- `os.Args` is global but typically not mutated after `init`.

When you call a function and don't know what it touches, run a quick check: spike up `-parallel 64`, run `-race -count=10`, and see if anything fires. Twenty seconds of paranoia saves an hour of debugging later.

## 49b. Why `-race` is your friend

A common reaction to a race detector report is "but the test passes". The race detector is not reporting a test failure; it's reporting a memory-model violation. Under a different schedule (e.g., production load, a different CPU, a different goroutine count), the violation could manifest as:

- A panic.
- A silent wrong result.
- A deadlock.
- A corrupted data structure.

Treating race-detector reports as informational is how production incidents happen weeks after the bug landed in `main`. Treat them as failures.

## 49c. A note on `t.Logf` versus `fmt.Println`

In a parallel test, `fmt.Println` writes directly to stdout, interleaving with other tests. `t.Logf` buffers per-test and flushes at the test's end. Always use `t.Logf` in tests; the output is cleaner and the framework controls verbosity.

```go
func TestThing(t *testing.T) {
    t.Parallel()
    fmt.Println("DEBUG")  // bad, may interleave
    t.Logf("DEBUG")       // good, buffered
}
```

Also: `t.Logf` only prints when `-v` is set or the test fails. `fmt.Println` always prints, polluting CI logs.

## 50. Summary, take three

The three big ideas of this page:

1. **`t.Parallel()` is a contract**: I will not touch process-global state; the framework will run me concurrently with siblings.
2. **Use the right isolation primitive**: `t.TempDir` for files, `httptest.NewServer` for HTTP, `127.0.0.1:0` for ports, `t.Cleanup` for teardown.
3. **`-race` is the safety net**: without it, parallel tests would be Russian roulette. With it, the bugs surface deterministically in CI.

Internalise these and you have everything you need to write idiomatic parallel tests in Go.

## 51. Appendix: cheat sheet

A printable summary for taping to your monitor:

```text
TEST PATTERN:
func TestX(t *testing.T) {
    t.Parallel()                 // first line, always
    fixture := newFixture(t)     // helper with t.Cleanup
    // ... assertions
}

SUBTEST PATTERN:
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // ... assertions
    })
}

CLEANUP:
t.Cleanup(func() { resource.Close() })  // not defer

ISOLATION:
dir := t.TempDir()                      // file-system
srv := httptest.NewServer(handler)      // HTTP
ln, _ := net.Listen("tcp", "127.0.0.1:0") // raw TCP

FORBIDDEN IN PARALLEL:
t.Setenv(...)                           // env vars
t.Chdir(...) // Go 1.24+                // working dir
package-level mutable var               // shared state

DEBUGGING:
go test -v -race -count=100 -parallel 4 -run TestX
```

## 52. Appendix: the testing package's surface, in one diagram

```
testing.T
├── Parallel()           // mark this test parallel
├── Run(name, fn)        // create a subtest
├── Cleanup(fn)          // register teardown
├── TempDir() string     // unique temp dir
├── Setenv(k, v)         // serial-only env var
├── Chdir(dir) (1.24+)   // serial-only chdir
├── Context() (1.24+)    // cancellable context
├── Helper()             // mark as helper
├── Log/Logf             // buffered log
├── Error/Errorf/Fatal/Fatalf  // failure reporting
├── Skip/Skipf/SkipNow   // skip the test
├── Name() string        // current test name
└── ...
```

Most parallel-test code uses fewer than 10 of these methods. The rest are for less common scenarios (deferred setup, conditional skip, etc.).

## 53. Appendix: `-parallel` and `-cpu` decision table

| Workload | `-parallel` | `-cpu` |
|----------|-------------|--------|
| Pure compute, small tests | GOMAXPROCS | (default) |
| Pure compute, large suite | 2*GOMAXPROCS | (default) |
| I/O-bound (DB, HTTP) | 4*GOMAXPROCS | (default) |
| Mixed | GOMAXPROCS | (default) |
| Sanity test single-core | 1 | 1 |
| Comprehensive CPU testing | (default) | 1,2,4 |

When in doubt, run the suite at three different `-parallel` values and pick the fastest.

The middle page covers the patterns that compose these primitives into real fixtures and test suites.

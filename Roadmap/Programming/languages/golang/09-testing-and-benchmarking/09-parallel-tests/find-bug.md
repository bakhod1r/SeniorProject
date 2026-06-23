---
layout: default
title: Parallel Tests — Find the Bug
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/find-bug/
---

# Parallel Tests — Find the Bug

[← Back](../)

Every snippet on this page passes `go vet` and compiles cleanly. Every snippet is also broken. Read each, identify the bug, sketch the fix in your head, then check the explanation. The bugs are drawn from real Go codebases.

## Bug 1. Loop-variable capture on Go 1.21

```go
func TestParse(t *testing.T) {
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
            got, _ := strconv.Atoi(tc.in)
            if got != tc.want {
                t.Errorf("got %d, want %d", got, tc.want)
            }
        })
    }
}
```

**Bug**: On Go 1.21 and earlier, all three parallel subtests capture the same `tc` (the final one, `"three"/"3"/3`). They all pass — but for the wrong reason — and any failure prints `"three"` even when caused by `"one"`. **Fix**: Add `tc := tc` inside the loop, or upgrade to Go 1.22+. The `loopclosure` vet check flags this on older Go.

## Bug 2. `t.Setenv` after `t.Parallel`

```go
func TestEnv(t *testing.T) {
    t.Parallel()
    t.Setenv("MODE", "test")
    run(t)
}
```

**Bug**: `t.Setenv` panics: `testing: t.Setenv called after t.Parallel`. The test crashes with a non-obvious goroutine dump unless the reader knows the rule. **Fix**: Either drop `t.Parallel` (env vars are process-global, so parallelism is unsafe) or replace `t.Setenv` with a per-test config struct passed explicitly to `run`.

## Bug 3. Shared map across parallel subtests

```go
var cache = map[string]int{}

func TestCache(t *testing.T) {
    cases := []string{"a", "b", "c", "d"}
    for _, k := range cases {
        k := k
        t.Run(k, func(t *testing.T) {
            t.Parallel()
            cache[k] = len(k) // unsynchronised map write
            if cache[k] != 1 {
                t.Fatalf("wrong length for %q", k)
            }
        })
    }
}
```

**Bug**: Concurrent writes to a built-in map panic at runtime: `fatal error: concurrent map writes`. The test will look flaky in CI (sometimes the order doesn't trigger it). **Fix**: Either make `cache` a `sync.Map`, guard it with a mutex, or — better — eliminate package-level mutable state from tests.

## Bug 4. `os.Chdir` in a parallel test

```go
func TestRelative(t *testing.T) {
    t.Parallel()
    os.Chdir("testdata") // process-global
    data, _ := os.ReadFile("input.txt")
    if string(data) != "hello\n" {
        t.Errorf("bad data: %q", data)
    }
}
```

**Bug**: Three parallel tests calling `os.Chdir` race on the process's working directory; one or more will read a file from the wrong directory. There is no `t.Setenv`-style guard for raw `os.Chdir` before Go 1.24. **Fix on Go ≥1.24**: use `t.Chdir`, which forbids `t.Parallel`. **Fix on older Go**: read the file with an absolute path (`filepath.Join("testdata", "input.txt")`), do not change the directory.

## Bug 5. Cleanup order assumption

```go
var db *sql.DB

func TestMain(m *testing.M) {
    db = openDB()
    code := m.Run()
    db.Close() // PROBLEM
    os.Exit(code)
}

func TestQuery(t *testing.T) {
    t.Parallel()
    t.Cleanup(func() {
        db.Exec("DELETE FROM widgets") // uses db
    })
    db.Exec("INSERT INTO widgets VALUES (1)")
}
```

**Bug**: The `t.Cleanup` runs during `m.Run`, so on a normal pass it works. But if `m.Run` returns early (e.g., `-failfast`), the cleanup may still be pending when `db.Close` runs. The cleanup then calls `Exec` on a closed DB, which the test code does not check, leaking errors. **Fix**: Move `db.Close` into a `defer` *before* `os.Exit`, or guard the cleanup against a closed DB. Better: let `t.Cleanup` close the DB only if the test that opened it is the last user.

## Bug 6. Race on a benchmark-style counter

```go
var counter int

func TestIncrement(t *testing.T) {
    cases := []int{1, 2, 3, 4}
    for _, n := range cases {
        n := n
        t.Run(fmt.Sprint(n), func(t *testing.T) {
            t.Parallel()
            for i := 0; i < n; i++ {
                counter++ // race
            }
        })
    }
}
```

**Bug**: `counter++` is read-modify-write; concurrent execution from parallel subtests races. `-race` reports it instantly. **Fix**: `atomic.AddInt64(&counter, int64(n))` plus declaring `counter` as `int64`, or scope the counter to the test (`var counter int` inside `TestIncrement`).

## Bug 7. Reading a `t.TempDir` from a parallel sibling

```go
func TestPair(t *testing.T) {
    var dir string
    t.Run("write", func(t *testing.T) {
        t.Parallel()
        dir = t.TempDir()
        os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0o644)
    })
    t.Run("read", func(t *testing.T) {
        t.Parallel()
        // dir might not be set yet!
        data, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
        if string(data) != "x" {
            t.Error("missing")
        }
    })
}
```

**Bug**: Both subtests are parallel, so the second may run before the first writes the file, and `dir` is also written concurrently with being read. **Fix**: Either merge the two cases (sequential write-then-read inside one parallel subtest), or use only one `t.Parallel` and let the second subtest depend on the first finishing.

## Bug 8. `httptest.Server` shared with `t.Parallel`

```go
var ts *httptest.Server

func TestMain(m *testing.M) {
    ts = httptest.NewServer(http.HandlerFunc(handle))
    defer ts.Close()
    os.Exit(m.Run()) // PROBLEM: defer never runs
}

func TestEndpoint(t *testing.T) {
    t.Parallel()
    resp, _ := http.Get(ts.URL + "/foo")
    ...
}
```

**Bug**: `os.Exit` skips deferred `ts.Close`, so the listener leaks on every process. Not strictly a parallelism bug, but tightly related: the leaked listener pollutes future test runs because the port can stay TIME_WAIT. **Fix**: Capture the exit code: `code := m.Run(); ts.Close(); os.Exit(code)`.

## Bug 9. `flag.Parse` race

```go
var mode = flag.String("mode", "fast", "")

func TestFast(t *testing.T) {
    t.Parallel()
    flag.Set("mode", "fast") // process-global
    run(t, *mode)
}

func TestSlow(t *testing.T) {
    t.Parallel()
    flag.Set("mode", "slow")
    run(t, *mode)
}
```

**Bug**: `flag.Set` mutates a shared `flag.Flag`. The two parallel tests race; the value `*mode` reads may belong to either test. **Fix**: Pass the mode as a function parameter; do not use process-level flags as per-test config.

## Bug 10. Goroutine leak that survives the test

```go
func TestStreaming(t *testing.T) {
    t.Parallel()
    ch := make(chan int)
    go func() {
        for v := range ch {
            _ = v
        }
    }()
    ch <- 1
    // never closes ch; the goroutine leaks
}
```

**Bug**: The goroutine blocks forever on `range ch`. Each invocation of the test leaks one goroutine. Over 1000 runs, the heap is full of orphaned goroutines, and `goleak.VerifyTestMain` reports them. **Fix**: `defer close(ch)` once the test is done sending, or use a `context.Context` to signal cancellation.

## Bug 11. Race between cleanup and subtest

```go
func TestThing(t *testing.T) {
    t.Cleanup(func() {
        cache.Clear()
    })
    t.Run("a", func(t *testing.T) {
        t.Parallel()
        cache.Put("a", 1)
    })
    t.Run("b", func(t *testing.T) {
        t.Parallel()
        cache.Put("b", 2)
    })
}
```

**Bug**: The parent's `t.Cleanup` doesn't run until all subtests finish (correct so far), but the cleanup races with no synchronisation issue — the bug is that two parallel subtests call `cache.Put` concurrently. If `cache` isn't thread-safe, you race. **Fix**: Make `cache` safe (sync.Map or mutex), or serialize the two subtests by not calling `t.Parallel` on them.

## Bug 12. Test depends on registration order

```go
func TestA(t *testing.T) {
    t.Parallel()
    // assumes TestSetup ran first
    if !ready.Load() {
        t.Fatal("not ready")
    }
}

func TestSetup(t *testing.T) {
    ready.Store(true)
}
```

**Bug**: With `t.Parallel` on `TestA`, the framework pauses it and runs serial tests first — including `TestSetup`. That sometimes works. But under `-run=TestA` alone, the setup never runs and the test fails. Setup hidden in another test is fragile. **Fix**: Move setup into `TestMain` (`m.Run` then teardown), or into a `t.Helper` that each parallel test calls explicitly.

## Bug 13. `t.Parallel` called from a spawned goroutine

```go
func TestSpawn(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        t.Parallel() // wrong goroutine
        // ...
    }()
    wg.Wait()
}
```

**Bug**: `t.Parallel` is meant to be called from the test's own goroutine. From a spawned goroutine, the behaviour is undefined; recent Go versions print a warning and may panic. **Fix**: Call `t.Parallel` at the top of the test function, before spawning anything.

## Bug 14. Cleanup that uses a value mutated post-test

```go
func TestX(t *testing.T) {
    t.Parallel()
    name := "initial"
    t.Cleanup(func() {
        // uses name
        log.Printf("cleanup for %s", name)
    })
    name = "updated"
    // ... test ends
}
```

**Bug**: Not strictly wrong (Go closures capture by reference, so the cleanup logs `"updated"`), but commonly misunderstood. Authors think the cleanup will log `"initial"`. **Fix**: Capture explicitly: `t.Cleanup(func() { log.Printf("cleanup for %s", "updated"); })` or assign to a local before registering.

## Bug 15. Mismatched `t.Run` and `t.Parallel`

```go
func TestRun(t *testing.T) {
    t.Run("a", func(t *testing.T) {
        // no t.Parallel here
        time.Sleep(10 * time.Millisecond)
    })
    t.Run("b", func(t *testing.T) {
        t.Parallel()
        // ...
    })
    t.Run("c", func(t *testing.T) {
        time.Sleep(10 * time.Millisecond)
    })
}
```

**Bug**: Subtest "b" is parallel; "a" and "c" are serial. The framework runs "a" (10ms), pauses "b", runs "c" (10ms), then runs "b". Total: 20ms+ wall time. If the author intended all three parallel, they have a 2x speed regression vs the goal. **Fix**: Add `t.Parallel()` to "a" and "c", or accept the serial schedule for those two.

## Bug 16. Race on a shared `httptest.Server` handler

```go
var hitCount int

func handler(w http.ResponseWriter, r *http.Request) {
    hitCount++ // race
}

func TestServer(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(handler))
    t.Cleanup(srv.Close)
    for i := 0; i < 4; i++ {
        i := i
        t.Run(fmt.Sprint(i), func(t *testing.T) {
            t.Parallel()
            http.Get(srv.URL)
        })
    }
    if hitCount != 4 {
        t.Errorf("got %d, want 4", hitCount)
    }
}
```

**Bug**: `hitCount++` races. Multiple HTTP handlers run on goroutines spawned by `httptest.Server`, all incrementing the same int. Also, the final check runs before the parallel subtests complete, so `hitCount` is often 0. **Fix**: `var hitCount int64` and `atomic.AddInt64(&hitCount, 1)`; wrap the subtests in `t.Run("group", ...)` so the final check runs after they finish.

## Bug 17. `t.TempDir` collision via symlink

```go
func TestSymlink(t *testing.T) {
    t.Parallel()
    dir := t.TempDir()
    link := "/tmp/my-app/state" // hardcoded
    os.Symlink(dir, link) // races sibling tests
}
```

**Bug**: Two parallel tests both create a symlink at the same fixed path. One overwrites the other; both think they own it; cleanups race. **Fix**: Use `t.TempDir()` for the symlink target too, or randomise the path: `link := filepath.Join(dir, "state")`.

## Bug 18. Forgotten `b.ResetTimer` in a benchmark with `b.RunParallel`

```go
func BenchmarkX(b *testing.B) {
    // expensive setup
    setupBigCache()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            use()
        }
    })
}
```

**Bug**: Setup time is included in the benchmark, distorting numbers. Not strictly a `T.Parallel` bug but the analogous parallel-benchmark gotcha. **Fix**: `b.ResetTimer()` before `b.RunParallel`.

## How to practice

1. Copy each snippet into a file, run `go test -race` and observe.
2. Predict the bug *before* reading the explanation.
3. Apply the fix and confirm `-race` is clean.
4. Add `-count=100 -parallel 8` to confirm no flake.

The goal is for the bugs to become as familiar as off-by-one errors are in a `for` loop.

## Categories of parallel bugs

The 18 bugs above cluster into a small number of categories. Recognising the category accelerates diagnosis:

- **Shared mutable state**: bugs 3, 6, 9, 16.
- **Process-global mutation**: bugs 2, 4, 9.
- **Loop-variable capture (pre-1.22)**: bug 1.
- **Cleanup ordering**: bugs 5, 11, 14.
- **Subtest scheduling assumptions**: bugs 7, 12, 15.
- **Resource leaks**: bugs 8, 10, 18.
- **Wrong-goroutine API usage**: bug 13.
- **File-system collisions**: bug 17.

Building a mental tree of categories means that when a real-world flake lands, you can match the symptom (panic / data race / hang / wrong value) against the likely category and skip straight to the relevant diagnostic.

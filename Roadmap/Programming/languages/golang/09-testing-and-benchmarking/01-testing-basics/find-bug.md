---
layout: default
title: Testing Basics — Find the Bug
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/find-bug/
---

# Testing Basics — Find the Bug

[← Back](../)

Each snippet below compiles and runs. Most pass `go test` while quietly being broken. Read them, identify the bug, and only then read the diagnosis. These are the patterns code review should catch; the more you see them in test files, the faster your eye becomes.

## Bug 1 — Error vs Fatal in a setup step

```go
func TestUser(t *testing.T) {
    db, err := openDB()
    if err != nil {
        t.Errorf("open: %v", err)
    }
    u, err := db.NewUser("alice")
    if err != nil {
        t.Errorf("new user: %v", err)
    }
    if u.Name != "alice" {
        t.Errorf("name: got %q, want alice", u.Name)
    }
}
```

The first `t.Errorf` reports the failure but does not stop the test. On the next line `db` is nil, so `db.NewUser` dereferences nil and the test crashes with a panic. The panic output then drowns the original error message. Use `t.Fatalf` for setup failures: any assertion whose result is a prerequisite for the next line must be fatal.

## Bug 2 — Missing `t.Helper`

```go
func assertEq(t *testing.T, got, want int) {
    if got != want {
        t.Errorf("got %d, want %d", got, want)
    }
}

func TestMath(t *testing.T) {
    assertEq(t, 1+1, 3)
    assertEq(t, 2*2, 5)
}
```

The test fails as expected — but the failure line points inside `assertEq`, not at the call site. Two test failures both report `assertEq` line 3, so you cannot tell which call failed without inspecting the values. Add `t.Helper()` as the first line of `assertEq` and the failure line moves to the caller.

## Bug 3 — Shared map across subtests

```go
func TestRoutes(t *testing.T) {
    routes := map[string]string{}
    cases := []struct{ name, in, out string }{
        {"a", "x", "1"},
        {"b", "y", "2"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            routes[tc.in] = tc.out
            if got := routes[tc.in]; got != tc.out {
                t.Errorf("%s: got %q want %q", tc.name, got, tc.out)
            }
        })
    }
}
```

The map is shared. As written the test passes, but the moment you add `t.Parallel()` inside the subtest the map is written concurrently and the race detector lights up. Either move the map inside the subtest or make it explicitly read-only.

## Bug 4 — Loop-variable capture with parallel subtests (pre-Go 1.22)

```go
func TestX(t *testing.T) {
    cases := []string{"a", "b", "c"}
    for _, name := range cases {
        t.Run(name, func(t *testing.T) {
            t.Parallel()
            if name != "a" {
                t.Errorf("got %q, want a", name)
            }
        })
    }
}
```

Before Go 1.22 the closure captures the loop variable `name`, which by the time any subtest runs in parallel equals `"c"`. All three subtests report `got "c", want a`. Fix: `name := name` inside the loop, or upgrade to 1.22 where per-iteration scoping makes this safe.

## Bug 5 — Missing `t.Parallel` on subtest

```go
func TestAll(t *testing.T) {
    t.Parallel()
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            heavyWork(tc)
        })
    }
}
```

Only the parent is parallel — with other `TestXxx` functions. Subtests run sequentially within `TestAll`. To parallelise the subtests too, the inner function must also call `t.Parallel()`. Two `Parallel` calls are intentional and well-defined.

## Bug 6 — `t.Setenv` after `t.Parallel`

```go
func TestX(t *testing.T) {
    t.Parallel()
    t.Setenv("FOO", "bar")
    // ...
}
```

The framework panics here: `Setenv called after Parallel`. The fix is to remove `t.Parallel()` and accept serial execution, or factor the test so the env-dependent part runs in a non-parallel subtest.

## Bug 7 — Calling `t.Fatal` from a goroutine

```go
func TestServer(t *testing.T) {
    go func() {
        if err := serve(); err != nil {
            t.Fatalf("serve: %v", err)
        }
    }()
    // ...
}
```

`t.Fatalf` calls `runtime.Goexit`, which exits only the spawned goroutine. The test goroutine never sees the failure and reports PASS. From a non-test goroutine, route errors back via a channel and assert in the test goroutine. Recent Go versions detect this and panic; older versions silently misreport.

## Bug 8 — `defer` instead of `t.Cleanup` in a `t.Run` parent

```go
func TestPool(t *testing.T) {
    p := newPool()
    defer p.Close()
    t.Run("a", func(t *testing.T) {
        t.Parallel()
        p.Use()
    })
    t.Run("b", func(t *testing.T) {
        t.Parallel()
        p.Use()
    })
}
```

`defer p.Close()` runs when `TestPool` returns, which is *before* the parallel subtests resume. The subtests then call `p.Use()` on a closed pool. Use `t.Cleanup(p.Close)` instead — cleanups run after parallel subtests complete.

## Bug 9 — Using `os.Setenv` directly

```go
func TestX(t *testing.T) {
    os.Setenv("FOO", "bar")
    defer os.Setenv("FOO", "")
    // ...
}
```

If `FOO` was previously unset, restoring it to `""` is observably different from leaving it unset (`os.LookupEnv` returns `("", true)` instead of `("", false)`). And if the test panics or another `t.Fatal` fires, the `defer` may not run depending on whether it was in `_test.go` or the helper. `t.Setenv` handles both cases correctly.

## Bug 10 — Example with non-deterministic output

```go
func ExampleMap() {
    m := map[string]int{"a": 1, "b": 2}
    for k, v := range m {
        fmt.Println(k, v)
    }
    // Output:
    // a 1
    // b 2
}
```

Go map iteration order is randomised. The example sometimes passes, sometimes fails. Either sort the keys before printing, or use `// Unordered output:` which compares the lines as a set.

## Bug 11 — `t.Run` return value ignored

```go
func TestPipeline(t *testing.T) {
    t.Run("setup", func(t *testing.T) {
        if err := setup(); err != nil {
            t.Fatalf("setup: %v", err)
        }
    })
    runIntegration(t) // depends on setup
}
```

If "setup" fails, the test marks itself failed but execution continues into `runIntegration`. `t.Run` returns a `bool` indicating success — if you need the next step to depend on it, check the return:

```go
if !t.Run("setup", func(t *testing.T) { ... }) {
    return
}
```

Or restructure so that setup lives outside `t.Run`.

## Bug 12 — Hardcoded path instead of `t.TempDir`

```go
func TestWrite(t *testing.T) {
    f, err := os.Create("/tmp/test.txt")
    if err != nil {
        t.Fatal(err)
    }
    defer os.Remove("/tmp/test.txt")
    // ...
}
```

Two tests running in parallel collide on `/tmp/test.txt`. On Windows, `/tmp` does not exist. Use `t.TempDir()`; it returns a unique path that is removed automatically.

## Bug 13 — `t.Skip` in a parent with parallel children

```go
func TestSuite(t *testing.T) {
    if !haveDocker() {
        t.Skip("docker required")
    }
    t.Run("a", func(t *testing.T) {
        t.Parallel()
        // ...
    })
}
```

This is correct; the trap is that calling `t.Skip` *inside* a parallel subtest after `t.Parallel` does run, but the subtest's cleanups still execute. The bug is when developers expect `t.Skip` to also skip a separate test — it only skips the current one.

## Bug 14 — Comparing slices with `==`

```go
if got != want {
    t.Errorf("got %v, want %v", got, want)
}
```

If `got` and `want` are slices this is a compile error. If they are arrays it is a value comparison. If they are pointers it is an identity comparison. The "obvious" assertion is one of three different things depending on the type — use `reflect.DeepEqual` or `slices.Equal` (Go 1.21+).

## Bug 15 — Test that does not actually fail

```go
func TestX(t *testing.T) {
    err := doWork()
    if err != nil {
        t.Logf("error: %v", err)
    }
}
```

`t.Logf` is logging, not failure. The test passes regardless. Use `t.Errorf` or `t.Fatalf`. A test that cannot fail is worse than no test — it gives false confidence and counts toward coverage without providing it.

---

Pattern: most test bugs are either control-flow (Errorf vs Fatalf, goroutine assertions, t.Run return), shared state (maps, env, files, loop variables), or lifecycle (defer vs Cleanup, Setenv vs Parallel, TempDir vs hardcoded paths). When you review a test file, scan for these three categories.

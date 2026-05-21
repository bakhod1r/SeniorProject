---
layout: default
title: Subtests — Find the Bug
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/find-bug/
---

# Subtests — Find the Bug

[← Back](../)

## Bug 1: Loop variable capture (pre-Go 1.22)

```go
func TestEach(t *testing.T) {
    cases := []int{1, 2, 3}
    for _, n := range cases {
        t.Run(fmt.Sprintf("n=%d", n), func(t *testing.T) {
            t.Parallel()
            if n != n { // always false in spirit, but n is shared
                t.Fail()
            }
            _ = n
        })
    }
}
```

Under Go 1.21 and earlier, all three parallel goroutines observe the final
`n=3` because `n` is one variable shared across iterations. Fix: add
`n := n` inside the loop body before `t.Run`, or upgrade `go.mod` to
`go 1.22`. The Go 1.22 release notes call this out under "Loop variable
scoping".

## Bug 2: Skipping the wrong scope

```go
func TestDB(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping DB tests")
    }
    db := openDB(t)
    t.Run("insert", func(t *testing.T) { /* ... */ })
    t.Run("query", func(t *testing.T) {
        if testing.Short() {
            return // BUG: silently passes
        }
        _ = db
    })
}
```

The first `t.Skip` is correct. The second branch uses `return`, which makes
the subtest pass instead of being marked skipped. Use `t.Skip` so `-v`
reports `--- SKIP` and CI accounting is honest.

## Bug 3: Cleanup registered on wrong `t`

```go
func TestPipeline(t *testing.T) {
    t.Run("stage1", func(t *testing.T) {
        srv := newServer()
        // BUG: should be t.Cleanup, not parent
        t.Cleanup(srv.Close) // OK here actually
    })
    t.Run("stage2", func(t *testing.T) {
        srv := newServer()
        t.Cleanup(func() { _ = srv.Close() })
    })
}
```

The trap is when developers stash the parent `t` in a helper and call
`parent.Cleanup` instead of `t.Cleanup`. That delays Close until the parent
ends, leaking resources across siblings. Always close over the subtest's
own `t`.

## Bug 4: Asserting on shared map without lock

```go
seen := map[string]bool{}
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        seen[tc.name] = true // race
    })
}
```

The shared `seen` map is mutated from multiple goroutines. `go test -race`
catches it. Fix: protect with `sync.Mutex` or use a per-subtest local.

## Bug 5: `-run` anchor missing

```
go test -run TestParse/valid
```

Matches `TestParse/valid_input`, `TestParse/valid_strict`, and any other
prefix. Anchor with `^valid_input$` to scope to one case. The Go testing
docs note `-run` uses unanchored regex by default.

## Bug 6: Goroutine that outlives the subtest

```go
func TestAsync(t *testing.T) {
    t.Run("a", func(t *testing.T) {
        go func() {
            time.Sleep(time.Second)
            t.Errorf("late failure") // PANIC
        }()
    })
}
```

The subtest's body returns before the goroutine fires. When the
goroutine calls `t.Errorf`, the framework panics with
`Fail in goroutine after TestAsync/a has completed`. Fix: synchronize
with a channel and register `t.Cleanup` to wait.

## Bug 7: `t.Setenv` after `t.Parallel`

```go
func TestEnv(t *testing.T) {
    t.Run("a", func(t *testing.T) {
        t.Parallel()
        t.Setenv("KEY", "val") // PANIC: t.Setenv called after t.Parallel
    })
}
```

`t.Setenv` writes a process-global variable. Once the test is parallel,
the framework forbids the call to prevent races. Either drop `t.Parallel`
or pass the value through a parameter instead of an env var.

## Bug 8: Helper without `t.Helper`

```go
func assertEq(t *testing.T, got, want int) {
    if got != want {
        t.Errorf("got %d, want %d", got, want) // file:line of THIS line
    }
}

func TestX(t *testing.T) {
    t.Run("case", func(t *testing.T) {
        assertEq(t, compute(), 5) // we want THIS line in the failure
    })
}
```

Without `t.Helper`, the failure message points to `assertEq`'s line, not
the call site. Add `t.Helper()` as the first statement of `assertEq` to
fix.

## Bug 9: Subtest ordering dependency

```go
var doc Document
func TestPipeline(t *testing.T) {
    t.Run("create", func(t *testing.T) { doc = create() })
    t.Run("read", func(t *testing.T) {
        if doc.ID == "" {
            t.Fatal("doc not created")
        }
    })
}
```

`go test -run TestPipeline/read` fails because `create` did not run.
Subtests should be independent: each should set up its own state. Move
`create()` into both subtests or restructure as one test.

## Bug 10: `t.Run` return value ignored when it matters

```go
func TestPipeline(t *testing.T) {
    t.Run("setup", func(t *testing.T) {
        if err := setup(); err != nil {
            t.Fatal(err)
        }
    })
    t.Run("use", func(t *testing.T) {
        // BUG: runs even if setup failed
        use()
    })
}
```

Setup failure does not skip "use". Either check `t.Failed()` before
running "use", or use the `Run` return value:

```go
if ok := t.Run("setup", ...); !ok {
    t.Skip("setup failed")
}
t.Run("use", ...)
```

## Bug 11: Subtest names with duplicates

```go
for _, n := range []int{1, 1, 2} {
    t.Run(fmt.Sprintf("n=%d", n), func(t *testing.T) {
        // ...
    })
}
```

Two subtests have the same name `n=1`. The second becomes `n=1#01`.
`-run` filtering on `n=1` matches both. Bug: the duplicate hides a
real case. Fix the source data or include a unique identifier in the
name (e.g., the loop index).

## Bug 12: Parallel subtest writing to shared map without lock

```go
results := map[string]int{}
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        results[tc.name] = compute(tc.in) // race
    })
}
```

`go test -race` flags this. Use a `sync.Map`, a mutex, or eliminate the
shared state entirely.

## Bug 13: `t.Skip` in a helper that escapes the subtest scope

```go
func skipIfShort(t *testing.T) {
    t.Helper()
    if testing.Short() {
        t.Skip("short mode") // skips the caller, not the helper
    }
}

func TestX(t *testing.T) {
    skipIfShort(t) // skips TestX entirely
    t.Run("case1", ...)
    t.Run("case2", ...)
}
```

This may be what you want; just realize that calling `skipIfShort(t)`
in the parent skips the whole test. To skip only one subtest, call
`skipIfShort(t)` inside that subtest's closure, passing the subtest's
own `t`.

## Bug 14: Late `t.Parallel`

```go
t.Run("case", func(t *testing.T) {
    setup()
    t.Parallel() // BUG: setup ran before going parallel
    body()
})
```

If `setup` is expensive, you wanted to go parallel before it, not
after. Either move `setup` into the helper that registers cleanup, or
call `t.Parallel` first:

```go
t.Run("case", func(t *testing.T) {
    t.Parallel()
    setup()
    body()
})
```

Note: calling `t.Parallel` does not actually pause until the parent's
body returns. So both placements still wait for the parent; the
difference is whether other parallel siblings can interleave.

## Bug 15: Forgetting to mark a subtest parallel

A subtest in a parallel suite that forgets `t.Parallel` runs
sequentially. The whole suite is slowed by the one missing call. The
`paralleltest` linter catches this when the suite uses the
parallel-by-default convention.

## Bug 16: Capturing pointer to a slice element

```go
cases := []*Case{...}
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        tc.run() // tc is the pointer; safe in Go 1.22+
    })
}
```

This is actually safe under both old and new loop semantics because
`tc` is a copy of the pointer. But if you have:

```go
for i := range cases {
    t.Run(cases[i].name, func(t *testing.T) {
        t.Parallel()
        cases[i].run() // BUG pre-1.22: i is shared
    })
}
```

The `i` is shared pre-Go 1.22, and the closure sees the final `i`.
Fix: shadow `i := i` or convert to range with the value.

## Bug 17: Sub-subtest name collision

```go
func TestX(t *testing.T) {
    t.Run("a/b", func(t *testing.T) { /* ... */ })
    t.Run("a", func(t *testing.T) {
        t.Run("b", func(t *testing.T) { /* ... */ })
    })
}
```

Both produce a test named `TestX/a/b` (the slash in the first name
creates a hierarchical level). `-run 'TestX/a/b'` matches both. The
framework does not warn. Fix: avoid slashes in literal names.

## Bug 18: Cleanup that depends on uninitialized variable

```go
t.Run("case", func(t *testing.T) {
    var srv *Server
    t.Cleanup(func() { srv.Close() }) // BUG: srv may still be nil
    srv = newServer() // might fail before this line
})
```

If `newServer` panics or returns early, cleanup runs with `srv == nil`
and panics. Fix: register cleanup after the variable is set, or
guard the cleanup:

```go
t.Cleanup(func() {
    if srv != nil { srv.Close() }
})
```

## Bug 19: Inner `t.Parallel` without outer

```go
func TestX(t *testing.T) {
    // forgot t.Parallel here
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            run(tc)
        })
    }
}
```

This is not strictly a bug; the subtests run in parallel with each
other within `TestX`'s scope. But `TestX` itself runs sequentially
with other top-level tests. If you wanted `TestX` to also run in
parallel with `TestY`, add `t.Parallel()` at the top of `TestX`.

The `tparallel` linter flags inconsistent parallel/sequential
patterns.

## Bug 20: Calling `t.Run` from a cleanup

```go
t.Cleanup(func() {
    t.Run("cleanup_check", func(t *testing.T) {
        // BUG: t is already cleaning up
    })
})
```

By the time cleanup runs, the test is past its execution phase.
Calling `t.Run` from cleanup leads to undefined behavior. Run any
verification before cleanups fire.

## Bug 21: Assuming subtest order in dashboards

Some CI dashboards sort subtests lexicographically, not by declaration
order. If your tests depend on order (they shouldn't), a rename can
shift the apparent sequence. Treat subtests as a set, not a sequence.

## Bug 22: Hiding skipped subtests with `return`

We covered this in Bug 6 of the Junior page conceptually; here is a
sneakier variant:

```go
t.Run("case", func(t *testing.T) {
    setup()
    if !canRun() {
        return // BUG: should be t.Skip
    }
    /* body */
})
```

The `setup()` ran but the test silently passes. Worse, if `setup`
opened resources, they leak (no cleanup was registered before the
return). Always use `t.Skip` so the test is properly marked.

## Bug 23: Using the wrong `t` in a long subtest

```go
func TestX(t *testing.T) {
    parent := t
    t.Run("case", func(t *testing.T) {
        // BUG: log goes to parent, not subtest
        parent.Log("inside case")
    })
}
```

`parent.Log` attributes output to `TestX`, not `TestX/case`. The
output appears under the parent's PASS/FAIL line, not the
subtest's. Always use the closure's `t`.

## Bug 24: Race in `t.Cleanup` registration

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        go func() {
            t.Cleanup(func() {}) // RACE if subtest has ended
        }()
        time.Sleep(time.Millisecond)
    })
}
```

If the goroutine runs after the subtest ends, registering cleanup
panics. The framework explicitly forbids late cleanup registration.
Coordinate goroutine lifetimes properly.

## Bug 25: Confusing `t.SkipNow` with `t.FailNow`

```go
t.Run("case", func(t *testing.T) {
    if !shouldRun() {
        t.FailNow() // BUG: marks as fail, not skip
    }
})
```

`FailNow` reports a failure; `SkipNow` (via `t.Skip` or `t.Skipf`)
reports a skip. Pick the right one.

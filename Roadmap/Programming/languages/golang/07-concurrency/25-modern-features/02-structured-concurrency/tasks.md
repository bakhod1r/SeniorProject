---
layout: default
title: Structured Concurrency — Tasks
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/tasks/
---

# Structured Concurrency — Tasks

[← Back](../)

The exercises in this page are ordered so that each builds on the previous.
Run every solution under `go test -race` and add a `goleak` check where
appropriate. Reference solutions are sketched below the prompts.

## Task 1 — Rewrite bare-`go` to `errgroup`

Given:

```go
func loadDashboard(ctx context.Context, userID string) (Dashboard, error) {
    var user User
    var posts []Post
    var stats Stats
    var err1, err2, err3 error

    go func() { user, err1 = fetchUser(ctx, userID) }()
    go func() { posts, err2 = fetchPosts(ctx, userID) }()
    go func() { stats, err3 = fetchStats(ctx, userID) }()
    time.Sleep(2 * time.Second) // hope they're done

    if err1 != nil { return Dashboard{}, err1 }
    if err2 != nil { return Dashboard{}, err2 }
    if err3 != nil { return Dashboard{}, err3 }
    return Dashboard{user, posts, stats}, nil
}
```

**Rewrite using `errgroup.WithContext`.** It must:

1. Return as soon as `Wait` completes (no `time.Sleep`).
2. Cancel sibling fetches if any one fails.
3. Not race on the result variables (run `go test -race`).

### Reference solution

```go
import "golang.org/x/sync/errgroup"

func loadDashboard(ctx context.Context, userID string) (Dashboard, error) {
    g, gctx := errgroup.WithContext(ctx)

    var user  User
    var posts []Post
    var stats Stats

    g.Go(func() error {
        u, err := fetchUser(gctx, userID)
        if err != nil { return err }
        user = u
        return nil
    })
    g.Go(func() error {
        p, err := fetchPosts(gctx, userID)
        if err != nil { return err }
        posts = p
        return nil
    })
    g.Go(func() error {
        s, err := fetchStats(gctx, userID)
        if err != nil { return err }
        stats = s
        return nil
    })

    if err := g.Wait(); err != nil {
        return Dashboard{}, err
    }
    return Dashboard{user, posts, stats}, nil
}
```

The writes to `user`, `posts`, and `stats` happen-before `g.Wait` returns (via
the wait group), so reading them after `Wait` is race-free.

## Task 2 — Build a `Scope` wrapper

Design a minimal structured-concurrency scope on top of `errgroup`:

```go
type Scope struct { /* … */ }

// Run executes fn inside a fresh Scope. All goroutines spawned via the
// Scope are joined before Run returns. The returned error is the first
// non-nil one observed (from fn or any child goroutine).
func Run(ctx context.Context, fn func(s *Scope) error) error

// Spawn schedules a child goroutine bound to this scope's lifetime.
func (s *Scope) Spawn(fn func(ctx context.Context) error)
```

Requirements:

1. `Run` must not return until every `Spawn`-ed goroutine has finished.
2. `Spawn` must be a no-op after `Run` has begun shutting down (i.e. after the
   scope's context is cancelled), to avoid the "Go after Wait" footgun.
3. Panic in a spawned goroutine is converted to a returned error.

### Reference solution

```go
package scope

import (
    "context"
    "fmt"
    "runtime/debug"
    "sync/atomic"

    "golang.org/x/sync/errgroup"
)

type Scope struct {
    g      *errgroup.Group
    ctx    context.Context
    closed atomic.Bool
}

func Run(ctx context.Context, fn func(*Scope) error) error {
    g, gctx := errgroup.WithContext(ctx)
    s := &Scope{g: g, ctx: gctx}
    if err := fn(s); err != nil {
        s.closed.Store(true)
        _ = s.g.Wait()
        return err
    }
    s.closed.Store(true)
    return s.g.Wait()
}

func (s *Scope) Spawn(fn func(context.Context) error) {
    if s.closed.Load() {
        return
    }
    s.g.Go(func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("scope: panic in child: %v\n%s", r, debug.Stack())
            }
        }()
        return fn(s.ctx)
    })
}
```

Note: the `closed` flag is best-effort; structured concurrency really wants
this enforced by the type system. The point of the exercise is to feel the
gap.

## Task 3 — Bound concurrency to N workers

Process a slice of 1000 URLs but never have more than 16 HTTP requests in
flight. Aggregate results into a `[]Result`. Return the first error if any.

### Reference solution

```go
func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    results := make([]Result, len(urls))
    for i, u := range urls {
        i, u := i, u // pre-1.22 capture (safe under 1.22 too)
        g.Go(func() error {
            r, err := fetch(gctx, u)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Writing to `results[i]` from different goroutines is race-free because each
goroutine touches a distinct index.

## Task 4 — Goroutine-leak test with `goleak`

Write a test for the following function (which has a leak) and confirm
`goleak` catches it:

```go
func Buggy() {
    ch := make(chan int) // unbuffered, never read
    go func() { ch <- 1 }()
}
```

### Reference solution

```go
package buggy_test

import (
    "testing"

    "go.uber.org/goleak"
)

func TestBuggy(t *testing.T) {
    defer goleak.VerifyNone(t)
    Buggy()
}
```

Run `go test`; `goleak` reports a goroutine blocked on `chan send` and fails
the test.

## Task 5 — `TryGo` shed-load demo

Build a worker pool with `g.SetLimit(4)`; submit jobs with `TryGo` from a
producer; if `TryGo` returns false, increment a `dropped` counter. After all
jobs are submitted, log `accepted`/`dropped` counts and `g.Wait()`.

```go
func runShedded(ctx context.Context, jobs []Job) (accepted, dropped int) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(4)

    for _, j := range jobs {
        j := j
        if g.TryGo(func() error { return j.Do(gctx) }) {
            accepted++
        } else {
            dropped++
        }
    }
    _ = g.Wait()
    return
}
```

## Task 6 — Detect "Wait before Go"

Write a unit test that demonstrates the bug: `g.Wait()` is called *before*
`g.Go(...)`. What does the test observe? (The `Wait` returns immediately; the
later-launched goroutine becomes an orphan that the parent function never
joins.) Fix the function so the goroutine is properly joined.

```go
// Buggy version — Wait before Go.
func runBad() error {
    var g errgroup.Group
    err := g.Wait()       // wg is at 0; returns immediately
    g.Go(func() error {   // adds 1 to wg AFTER Wait already returned
        time.Sleep(50 * time.Millisecond)
        return nil
    })
    return err
}

// Fixed: all Go calls precede Wait.
func runGood() error {
    var g errgroup.Group
    g.Go(func() error {
        time.Sleep(50 * time.Millisecond)
        return nil
    })
    return g.Wait()
}
```

## Task 7 — Propagate cancellation cause

Verify that `context.Cause(gctx)` returns the captured error after an
`errgroup` child returns one. Write a small test and inspect the cause.

```go
func TestCausePropagates(t *testing.T) {
    boom := errors.New("boom")
    g, gctx := errgroup.WithContext(context.Background())
    g.Go(func() error { return boom })
    _ = g.Wait()
    if got := context.Cause(gctx); !errors.Is(got, boom) {
        t.Fatalf("cause = %v, want %v", got, boom)
    }
}
```

## Task 8 — Refactor a daemon to a join-able shutdown

Given:

```go
func StartFlusher(d time.Duration) {
    go func() {
        for range time.Tick(d) { flush() }
    }()
}
```

Refactor so that the flusher has a `Stop()` method that returns only after
the flusher goroutine has actually exited. Use `context.Context` for the stop
signal and a small `sync.WaitGroup` for the join.

```go
type Flusher struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func StartFlusher(d time.Duration) *Flusher {
    ctx, cancel := context.WithCancel(context.Background())
    f := &Flusher{cancel: cancel}
    f.wg.Add(1)
    go func() {
        defer f.wg.Done()
        t := time.NewTicker(d)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                flush()
            }
        }
    }()
    return f
}

func (f *Flusher) Stop() {
    f.cancel()
    f.wg.Wait()
}
```

The point of the exercise: `errgroup` does not fit daemons. Daemons need
their own lifecycle. But the *spirit* of structured concurrency (every
goroutine has an owner that joins it) still applies.

## Task 9 — Replace a `chan error` aggregator

Find code in your own project that creates `errCh := make(chan error, N)`,
spawns N goroutines, collects errors, and joins via a `WaitGroup`. Rewrite it
with `errgroup`. Compare line counts and readability.

## Task 10 — Discussion: what would a Go `task` package look like?

Sketch (no code required) a hypothetical standard-library `task` package that
provides true structured concurrency. What would `task.Run` and `task.Spawn`
need to enforce that `errgroup` cannot? Write down at least three
language-level changes that would have to land. Compare your sketch to the
Russ Cox `task` experiment summarised on the [Specification](../specification/)
page.

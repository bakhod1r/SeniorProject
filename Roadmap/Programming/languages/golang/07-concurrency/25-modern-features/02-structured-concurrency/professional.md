---
layout: default
title: Structured Concurrency — Professional
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/professional/
---

# Structured Concurrency — Professional

[← Back](../)

This page is about turning the principle into review rules, library design,
and the operational reality of running services where every leaked goroutine
eventually becomes a paging incident.

## 1. The non-negotiable rules

After years of incidents, most mature Go shops settle on a handful of
non-negotiable rules. They are boring on purpose.

1. **No bare `go f()` in library code.** Library functions that need to do
   concurrent work either accept an `errgroup.Group` from the caller, return
   a join-able handle, or expose a `Start`/`Stop` lifecycle. Never schedule
   detached work the caller cannot wait for.
2. **Every goroutine has an owner.** The owner is the function or struct
   responsible for calling `Wait` (or `Stop`). If you can't name the owner,
   you have a leak waiting to happen.
3. **Every goroutine respects a context.** No `time.Sleep`, no unbounded
   `for range ch`, no blocking I/O that doesn't honour `ctx.Done()`.
4. **Every goroutine is panic-safe in production library code.** A panic in
   a worker should at worst fail the request that owns the group, never the
   process — unless you have explicitly decided the panic indicates an
   un-recoverable bug.
5. **Tests use `goleak`.** `goleak.VerifyTestMain(m)` in package-level
   `TestMain` so leaks are caught before they reach production.

Rules 1–3 are the structured-concurrency core. Rules 4–5 are
defence-in-depth.

## 2. The `errgroup` wrapper most production code ends up with

Bare `errgroup` is fine for application code. For libraries and
infrastructure, a thin wrapper that adds panic recovery and structured logs
is common:

```go
package safegroup

import (
    "context"
    "fmt"
    "runtime/debug"

    "golang.org/x/sync/errgroup"
)

// Group wraps errgroup.Group with panic recovery.
type Group struct {
    g   *errgroup.Group
    ctx context.Context
    log Logger
}

func WithContext(ctx context.Context, log Logger) (*Group, context.Context) {
    g, gctx := errgroup.WithContext(ctx)
    return &Group{g: g, ctx: gctx, log: log}, gctx
}

func (g *Group) Go(name string, fn func(context.Context) error) {
    g.g.Go(func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                stack := debug.Stack()
                g.log.Errorw("goroutine panic", "task", name, "panic", r, "stack", string(stack))
                err = fmt.Errorf("panic in %s: %v", name, r)
            }
        }()
        return fn(g.ctx)
    })
}

func (g *Group) SetLimit(n int) { g.g.SetLimit(n) }
func (g *Group) Wait() error    { return g.g.Wait() }
```

Three small upgrades over raw `errgroup`:

- Each task has a *name* that appears in logs and panic reports.
- Panics become returned errors, so a bad task fails its scope, not the
  process.
- The wrapper accepts a `Logger` interface, keeping logging consistent.

## 3. Supervision trees, lightly

Erlang's supervision trees are too heavy for most Go services, but a small
slice of the idea is worth borrowing. For long-lived background subsystems
(connection pools, schedulers, flushers) consider:

```go
type Supervisor struct {
    log     Logger
    workers []func(ctx context.Context) error
}

func (s *Supervisor) Add(name string, fn func(context.Context) error) {
    s.workers = append(s.workers, func(ctx context.Context) error {
        backoff := time.Second
        for {
            err := fn(ctx)
            if ctx.Err() != nil {
                return ctx.Err()
            }
            s.log.Errorw("worker exited, restarting", "name", name, "err", err, "backoff", backoff)
            select {
            case <-time.After(backoff):
            case <-ctx.Done():
                return ctx.Err()
            }
            if backoff < 30*time.Second {
                backoff *= 2
            }
        }
    })
}

func (s *Supervisor) Run(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, w := range s.workers {
        w := w
        g.Go(func() error { return w(gctx) })
    }
    return g.Wait()
}
```

Properties:

- Every worker has an owner (`Supervisor`).
- A worker that crashes is restarted with exponential backoff.
- Context cancellation propagates down; no daemon outlives `Run`.
- Tests can `goleak.VerifyNone` after `Run` returns.

This is not full Erlang OTP — there is no "restart strategies", no
"one-for-all". But it captures the part that matters in Go: every
long-lived goroutine has a parent that supervises it.

## 4. Code-review checklist

Things a reviewer should reach for, in order:

1. **Search for `\bgo \w`** in the diff. Every `go` keyword needs
   justification: who owns this goroutine, who waits for it, who handles its
   error.
2. **Check `errgroup` users pass `gctx`** to children, not the outer `ctx`.
   If the child uses `ctx` directly, cancellation from sibling failure does
   not propagate.
3. **Check loop captures.** On pre-1.22 modules, every `g.Go(...)` inside a
   `for` needs `x := x` shadowing. On 1.22+ this is automatic, but mixing
   versions in a monorepo is a real pitfall.
4. **Check shared writes happen-before `Wait`.** A read of a result
   variable must occur after `g.Wait()`. If you see a read between `Go`
   calls and `Wait`, ask why.
5. **Check `SetLimit` is set before any `Go`.** Late `SetLimit` panics in
   production.
6. **Check daemons are not in the same `errgroup` as request work.** Daemon
   goroutines block `Wait` forever.
7. **Check tests use `goleak`.** If a package uses goroutines and the test
   file does not import `go.uber.org/goleak`, add it.

## 5. The leak playbook

When pprof or runtime stats show "goroutines: rising slowly over hours",
the playbook is:

1. **`pprof.Lookup("goroutine").WriteTo(w, 1)`** in a debug endpoint. Group
   the dump by call stack.
2. Look for stacks that include user code stuck on a `chan send`,
   `chan recv`, or `(*sync.WaitGroup).Wait`. These are usually missing
   context-aware select branches.
3. Look for stacks rooted in functions that *should* have returned. If the
   leaked stack starts in `fooLib.Start`, you have a missing
   `Stop` / `Wait`.
4. Reproduce in tests with `goleak`; add a regression test.
5. Fix by adding a context-aware exit or by making the owning function call
   `Wait`/`Stop`.

`goleak` is also the reason teams sometimes wrap `t.Run` for subtests — to
detect that a subtest's goroutines are gone before the next subtest starts.

## 6. Library design rules

If you are designing a library that does concurrent work, pick exactly one
shape:

- **Synchronous fan-out.** `func DoBatch(ctx, items) error` — internally
  uses `errgroup`, returns after `Wait`. Caller knows exactly when work is
  done. This is the default.
- **Caller-supplied group.** `func (s *Svc) StartBackground(ctx, g *errgroup.Group)`
  — the caller owns the group and the lifetime. Useful when the caller
  wants to compose several subsystems into one scope.
- **Lifecycle object.** `s.Start(ctx) error` and `s.Stop() error`. The
  service owns its goroutines; `Stop` blocks until they exit. Caller must
  always pair `Start` with `Stop`.

What *not* to do: a function that returns immediately but starts background
work the caller cannot observe. That is the bare-`go` anti-pattern.

## 7. Observability for goroutines

In production, a few extra signals make leaks obvious:

- Export `runtime.NumGoroutine()` as a gauge metric. Tag by service.
- Alert on positive linear regression over 24h. Healthy services have a
  flat or oscillating goroutine count; leaks show as ramps.
- Periodically dump `runtime/pprof.Lookup("goroutine")` to debug logs at
  WARN if the count exceeds some threshold.
- In tests, `goleak.VerifyTestMain(m)` is non-negotiable.

Tying this back to structured concurrency: a service that strictly obeys
"every goroutine has an owner who calls `Wait` or `Stop`" cannot leak in
the steady state. Leaks become a bug to find, not a constant background
hum.

## 8. The Erlang lens

Erlang/OTP gives every process an "exit reason" and a parent supervisor
that decides what to do with it. Go has neither, but the *discipline* you
can borrow is:

- Treat goroutine exit as a first-class event. Log it. Decide whether to
  restart, escalate, or shut down the parent.
- Treat panic as a different kind of exit. Convert to error or log + crash;
  do not let a panic vanish into a goroutine you can't observe.
- Treat the absence of an owner as a bug, the same way you treat
  unhandled exceptions in synchronous code.

Structured concurrency is Go's first language-level step toward these
properties. Until it lands, the discipline lives in your library style
guide and your code reviews.

## 9. A worked example: HTTP request fan-out

The canonical pattern in a production handler:

```go
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
    defer cancel()

    g, gctx := errgroup.WithContext(ctx)
    var (
        user  User
        posts []Post
        feed  []Item
    )

    g.Go(func() error {
        var err error
        user, err = h.users.Get(gctx, userID(r))
        return err
    })
    g.Go(func() error {
        var err error
        posts, err = h.posts.For(gctx, userID(r))
        return err
    })
    g.Go(func() error {
        var err error
        feed, err = h.feed.For(gctx, userID(r))
        return err
    })

    if err := g.Wait(); err != nil {
        h.writeError(w, err)
        return
    }
    h.writeJSON(w, Dashboard{user, posts, feed})
}
```

Every property holds:

- One owner: the handler.
- One context: derived from `r.Context()` with a deadline.
- Three children, joined by `Wait` before the handler returns.
- First failure cancels siblings.
- No bare `go`, no orphan goroutines.

This is structured concurrency in production Go. Not a language feature —
just a pattern, enforced by review and `goleak`. It is good enough that
most teams stop here.

## 10. Linting and CI gates

To enforce these rules at scale, you need automated checks, not just
human review. A few options.

### 10.1 `staticcheck`

`honnef.co/go/tools/staticcheck` includes checks like `SA1029`
(misuse of `context`) and `SA2002` (calling `t.Fatal` from goroutines).
It doesn't directly flag bare `go` but catches many adjacent bugs.

### 10.2 `revive`

`github.com/mgechev/revive` has a `bare-return` rule and you can add
custom rules. Some teams write a `revive` rule that flags `go ` (with
trailing space) in non-test files and require an `//nolint` comment to
override. This makes bare goroutines opt-in.

### 10.3 `go/analysis` custom passes

For team-specific rules, write a `go/analysis.Analyzer`. The pass walks
the AST, looks for `*ast.GoStmt`, and reports anything outside an
allowlist of acceptable callers. Wire it into your CI.

```go
// Sketch of an analyser that flags bare go in package "internal"
var Analyzer = &analysis.Analyzer{
    Name: "nobaregoroutine",
    Doc:  "flags bare go statements outside allowed callers",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, f := range pass.Files {
        ast.Inspect(f, func(n ast.Node) bool {
            if gs, ok := n.(*ast.GoStmt); ok {
                pass.Reportf(gs.Pos(), "bare go statement; use errgroup or document why")
            }
            return true
        })
    }
    return nil, nil
}
```

### 10.4 `errcheck` and `gosec`

`errcheck` catches `g.Wait()` calls whose return value is discarded.
`gosec` catches some concurrency-related security issues. Both should
be in CI.

### 10.5 Pre-commit hooks

For the team, a pre-commit hook that runs `go vet`, `staticcheck`, and
your custom analyser. Catches issues before they hit CI.

## 11. Observability for structured concurrency

Once your codebase is structured-concurrency-clean, you want to *see*
that it stays that way.

### 11.1 Goroutine count metric

Export `runtime.NumGoroutine()` as a Prometheus gauge. Tag by service.
Healthy services oscillate around a steady-state count; leaks show as
ramps.

```go
go func() {
    t := time.NewTicker(15 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            goroutinesGauge.Set(float64(runtime.NumGoroutine()))
        case <-ctx.Done():
            return
        }
    }
}()
```

(Note: even this monitoring goroutine should be properly scoped — it
takes a context and exits when cancelled.)

### 11.2 Alert on positive linear regression

In your alerting system, fit a linear regression to the goroutine
count over the past 24 hours. Alert when the slope exceeds a
threshold (e.g. 1 goroutine/minute sustained). This catches slow leaks
that aren't visible in any single snapshot.

### 11.3 Per-task structured logs

When using a `Scope` wrapper that names tasks, emit a log line on task
start and end. Aggregate by name to see which tasks are slow,
crashing, or restarting.

### 11.4 Goroutine dump endpoint

Expose `pprof.Lookup("goroutine").WriteTo(w, 1)` on an internal-only
HTTP endpoint. When debugging a leak, hitting this endpoint gives you
every live goroutine's stack. Group by stack to find duplicates.

### 11.5 Tracing

If you use distributed tracing (OpenTelemetry, etc.), wrap each
goroutine in a span. The span's lifetime tells you whether the
goroutine completed within the expected window.

```go
g.Go(func() error {
    ctx, span := tracer.Start(gctx, "fetch.user")
    defer span.End()
    return fetchUser(ctx, id)
})
```

When a span is open longer than its peers, you've found a slow task.
When a span is *never closed*, you've found a leak.

## 12. The team-level policy

For a team to consistently produce structured-concurrency-clean code,
codify the rules in a policy document. A sample:

```markdown
## Concurrency policy

1. No bare `go` in non-test code without a code-review approved
   `//nolint:nobaregoroutine` comment and a documented reason.
2. All fan-out work uses `errgroup.WithContext` from
   `golang.org/x/sync/errgroup`.
3. All goroutines accept and respect a `context.Context`.
4. All goroutines that may panic are wrapped with
   `safegroup.Group` (our internal wrapper) for panic-to-error.
5. All packages with concurrency add `goleak.VerifyTestMain(m)` to
   their tests.
6. All long-running services expose a goroutine-count metric.
7. All code reviews include a concurrency review using the checklist
   in `docs/concurrency-review.md`.
```

The policy is enforced by:

- Pre-commit hooks running the custom analyser.
- CI failing on lint violations.
- Code reviewers explicitly checking against the policy.
- Postmortems referencing the policy when concurrency bugs cause
  incidents.

## 13. Supervision-tree pattern, fuller

Building on section 3, here's a fuller supervision-tree implementation
that production services can use.

```go
package supervisor

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

type Strategy int

const (
    OneForOne Strategy = iota // restart only the failed worker
    OneForAll                 // restart all workers when any fails
    RestForOne                // restart the failed worker and all after it
)

type Worker struct {
    Name string
    Run  func(context.Context) error
    Min  time.Duration // minimum time between restarts
    Max  time.Duration // maximum backoff
}

type Supervisor struct {
    workers  []Worker
    strategy Strategy
    log      Logger
}

func New(strategy Strategy, log Logger, workers ...Worker) *Supervisor {
    return &Supervisor{workers: workers, strategy: strategy, log: log}
}

func (s *Supervisor) Run(ctx context.Context) error {
    switch s.strategy {
    case OneForOne:
        return s.runOneForOne(ctx)
    case OneForAll:
        return s.runOneForAll(ctx)
    case RestForOne:
        return s.runRestForOne(ctx)
    default:
        return fmt.Errorf("unknown strategy %d", s.strategy)
    }
}

func (s *Supervisor) runOneForOne(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, w := range s.workers {
        w := w
        g.Go(func() error { return s.runWithRestart(gctx, w) })
    }
    return g.Wait()
}

func (s *Supervisor) runWithRestart(ctx context.Context, w Worker) error {
    backoff := w.Min
    if backoff == 0 { backoff = time.Second }
    if w.Max == 0 { w.Max = 30 * time.Second }
    for {
        err := s.runOnce(ctx, w)
        if ctx.Err() != nil { return ctx.Err() }
        s.log.Errorw("worker exited, restarting",
            "name", w.Name, "err", err, "backoff", backoff)
        select {
        case <-time.After(backoff):
        case <-ctx.Done(): return ctx.Err()
        }
        if backoff < w.Max { backoff *= 2 }
    }
}

func (s *Supervisor) runOnce(ctx context.Context, w Worker) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("worker %q panic: %v", w.Name, r)
        }
    }()
    return w.Run(ctx)
}

func (s *Supervisor) runOneForAll(ctx context.Context) error {
    for {
        groupErr := s.runGroup(ctx)
        if ctx.Err() != nil { return ctx.Err() }
        s.log.Errorw("worker exited, restarting all", "err", groupErr)
        select {
        case <-time.After(time.Second):
        case <-ctx.Done(): return ctx.Err()
        }
    }
}

func (s *Supervisor) runGroup(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, w := range s.workers {
        w := w
        g.Go(func() error { return s.runOnce(gctx, w) })
    }
    return g.Wait()
}

func (s *Supervisor) runRestForOne(ctx context.Context) error {
    // Workers ordered: when worker[i] fails, restart workers[i..].
    // Simplified implementation; production code would handle ordering
    // more carefully.
    return errors.New("rest-for-one not implemented")
}
```

This supervisor:

- Restarts failing workers with exponential backoff.
- Supports multiple strategies for restart behaviour.
- Recovers panics in worker code.
- Honours context cancellation cleanly.

It's not a full OTP supervision tree — but for a Go service that needs
basic resilience, it covers the common cases.

## 14. Coupling supervision to deployment

A supervised service should also have lifecycle hooks tied to the
deployment platform. Two patterns.

### 14.1 SIGTERM handling

Kubernetes (and most platforms) send SIGTERM to indicate "shut down
gracefully". The supervisor's `Run` should respect this.

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer cancel()

    sup := supervisor.New(supervisor.OneForOne, logger, workers...)
    if err := sup.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
        log.Fatalf("supervisor exited: %v", err)
    }
}
```

When SIGTERM arrives, `ctx` is cancelled, every worker's
`context.Done()` fires, and (if workers are well-behaved) they exit
within their grace period.

### 14.2 Readiness and liveness

Healthchecks should reflect supervision state:

- **Liveness.** Returns OK if the supervisor goroutine is running. If
  the supervisor itself has crashed (which shouldn't happen with
  panic recovery), liveness fails and the platform restarts the pod.
- **Readiness.** Returns OK only when *all* critical workers are in a
  healthy state. If a critical worker is in a restart loop, readiness
  fails and the platform routes traffic elsewhere.

Implementing these hooks requires the supervisor to track per-worker
state. Most production supervisors expose a status API:

```go
type WorkerStatus struct {
    Name      string
    Running   bool
    LastError error
    Restarts  int
}

func (s *Supervisor) Status() []WorkerStatus { /* ... */ }
```

Hook it up to the healthcheck endpoint and you have a complete
deployment-aware supervision tree.

## 15. The line between application code and library code

A subtle point worth making explicit: the rules above apply most
strictly to *library* code (anything that other code calls). For
application code (the `main` package and a few helpers tied to it),
some rules can relax.

For example, in `main`, a bare `go runDebugServer()` is fine because
`main` is the root scope — when `main` returns, the process exits and
nothing leaks. Library code can't make this assumption because it
doesn't know how long the process will run.

The mental model:

- **Library code.** Every goroutine must be ownable. Caller must be
  able to wait for it. No exceptions.
- **Application code.** Daemons tied to the process lifetime can use
  bare `go` if no graceful shutdown is needed; otherwise use the same
  rules as library code.
- **Test code.** Goroutines should still be properly joined for
  `goleak` to be happy, but the rules are slightly looser.

Apply the strictest rules in library code and the policy will scale.

## 16. Final recap

The Professional page distilled:

1. The non-negotiable rules: no bare `go`, every goroutine has an
   owner, every goroutine respects context, every goroutine is
   panic-safe, every test uses `goleak`.
2. The thin `errgroup` wrapper that adds names and panic recovery.
3. Supervision-tree pattern, with multiple restart strategies.
4. Code-review checklist for concurrent PRs.
5. Leak detection playbook for production.
6. Library design rules: synchronous fan-out, caller-supplied group,
   lifecycle object.
7. Observability: goroutine count metric, alerting on regression,
   per-task spans, debug endpoints.
8. Linting and CI gates: `staticcheck`, custom `go/analysis` passes,
   pre-commit hooks.
9. Deployment integration: SIGTERM handling, readiness/liveness from
   supervision state.
10. The library/application distinction: stricter rules in library
    code, room for daemons in `main`.

Together, these turn the principle of structured concurrency into a
team-level engineering practice. It's not as good as a language
feature — but it's good enough to ship reliable Go services at scale.

## 17. A final word on culture

Tooling and policy only work in a team that *cares* about
concurrency correctness. The fastest way to build that culture: write
incident postmortems that name the missing structured-concurrency
discipline. Don't blame individuals; blame the absence of the policy.
Each postmortem should end with a concrete change — a lint rule, a
review item, a test.

Over time the team's concurrent code gets boring. That is the goal.
"Boring concurrency" means the bugs you have are the same bugs every
service has, and they're all caught by the existing rules. The
exciting concurrency bugs — the deadlocks under load, the silent
leaks, the mysterious crashes — go away.

If you find your team having exciting concurrency bugs, the policy
isn't yet doing its job. Add another rule, another check, another
review item. The structured-concurrency discipline is never "done";
it's a practice you maintain.

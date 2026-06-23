---
layout: default
title: Structured Concurrency — Senior
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/senior/
---

# Structured Concurrency — Senior

[← Back](../)

The Junior page introduced the idea, the Middle page took apart `errgroup`.
This page asks how to *design* structured concurrency in Go beyond
`errgroup`: how to build a scope abstraction, how to think about
cancellation versus completion, what the deferred language proposals
actually said, and where the cracks are.

## 1. The shape of a "scope"

Languages that ship structured concurrency converge on something called a
*scope*. The Trio nursery, Kotlin's `coroutineScope`, Swift's `TaskGroup`,
and Russ Cox's experimental `task.Scope` all have the same skeleton:

```text
scope := Open(parent_context)
  scope.Spawn(child_fn1)
  scope.Spawn(child_fn2)
scope.Close()  // blocks until every child has finished
```

The Go translation:

```go
type Scope struct {
    g   *errgroup.Group
    ctx context.Context
}

func Open(parent context.Context) *Scope {
    g, gctx := errgroup.WithContext(parent)
    return &Scope{g: g, ctx: gctx}
}

func (s *Scope) Spawn(fn func(context.Context) error) {
    s.g.Go(func() error { return fn(s.ctx) })
}

func (s *Scope) Close() error {
    return s.g.Wait()
}
```

This works, but it has a problem the Trio designers care a lot about:
there is no way to enforce that the user calls `Close`. Forgetting `Close`
leaks every spawned goroutine.

We can move one step closer to enforcement with a higher-order function
that does it for the caller:

```go
func Run(parent context.Context, fn func(*Scope) error) error {
    s := Open(parent)
    if err := fn(s); err != nil {
        _ = s.Close()
        return err
    }
    return s.Close()
}
```

`Run` takes a body, runs the body, and unconditionally waits for the
scope. Callers cannot forget — but they *can* leak the `*Scope` out of the
body to be used after `Run` returns, which is the same hole `errgroup`
has. We will return to this.

## 2. Spawn-during-shutdown

A subtle bug in the naive `Scope`: what if `fn` returns an error and a
sibling, still running, calls `s.Spawn`? Now we have a `g.Go` after the
group started shutting down — which is allowed by `errgroup` (no panic)
but means we are adding work to a group that already has its first error.
The new spawn will run; its result will be discarded if it errors; and
`Close` blocks until *it* finishes too.

A defensive scope tracks shutdown explicitly:

```go
type Scope struct {
    g       *errgroup.Group
    ctx     context.Context
    closed  atomic.Bool
}

func (s *Scope) Spawn(fn func(context.Context) error) {
    if s.closed.Load() {
        // Refuse to spawn after shutdown began.
        return
    }
    s.g.Go(func() error { return fn(s.ctx) })
}

func (s *Scope) Close() error {
    s.closed.Store(true)
    return s.g.Wait()
}
```

This still races (a Spawn racing with Close can sneak in), but the window
is small and the behaviour is at least defined. A truly correct version
needs a mutex around the closed check and the `Go` call:

```go
type Scope struct {
    g      *errgroup.Group
    ctx    context.Context
    mu     sync.Mutex
    closed bool
}

func (s *Scope) Spawn(fn func(context.Context) error) {
    s.mu.Lock()
    if s.closed {
        s.mu.Unlock()
        return
    }
    s.g.Go(func() error { return fn(s.ctx) })
    s.mu.Unlock()
}

func (s *Scope) Close() error {
    s.mu.Lock()
    s.closed = true
    s.mu.Unlock()
    return s.g.Wait()
}
```

This kind of detail is exactly what a language-level scope removes: the
compiler would refuse to let you spawn into a closed scope.

## 3. Panic propagation

`errgroup` does not catch panics. A panic in a `Go` callback unwinds
through `defer g.done()` (which marks the goroutine done) but then
propagates out of the goroutine, which by Go's rules crashes the process.

A structured-concurrency scope should *probably* convert panics to
errors, so that one bad task fails its scope rather than the program:

```go
func (s *Scope) Spawn(name string, fn func(context.Context) error) {
    s.g.Go(func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("scope.Spawn %q panic: %v\n%s", name, r, debug.Stack())
            }
        }()
        return fn(s.ctx)
    })
}
```

Note the named return value `(err error)` so that the `defer` can assign
to it. Without that, `err` from `fn(s.ctx)` would be lost when the panic
fires.

This is a real design choice with no perfect answer. Two camps:

- **Crash camp.** Panics indicate bugs; crashing is the only safe response.
  Don't paper over them with recovery.
- **Convert camp.** A panic in one of fifty parallel requests shouldn't
  take down the other forty-nine. Recover and convert.

Production library code usually picks the convert camp, with structured
logs that include the stack trace so the bug is still visible.

## 4. Cancellation versus completion

This is the crucial conceptual point of the page.

There are two orthogonal things a parent might want to do with its
children:

- **Cancel.** Tell them to stop. They may or may not actually stop, on
  their own schedule.
- **Wait.** Block until they have actually stopped.

`context.Context` covers cancellation. It is *signal-only*: cancelling a
context only delivers the message; it does not wait for the recipient to
act. A child that ignores `ctx.Done()` keeps running indefinitely.

`sync.WaitGroup` covers completion. It is *join-only*: `Wait` blocks until
every `Done` has fired. It does not signal anyone to stop.

`errgroup` combines them but in a one-way relationship: the group cancels
its derived context when the first child errors. It does not let the
parent cancel the group's children directly; the parent must cancel the
*outer* context (which, because the group's derived context wraps it,
also cancels the children).

Structured concurrency, properly built, gives you both in a clean
abstraction:

```go
s := Open(parentCtx)
s.Spawn(fn1)
s.Spawn(fn2)
s.Cancel()       // tell every child to stop
s.Close()        // wait for every child to actually stop
```

A `Cancel`-then-`Close` sequence is the cleanest expression. Most Go
code does this implicitly: outer context's deadline expires → `gctx` sees
it → children exit on next select → `Wait` returns.

If you ever find yourself thinking "I cancelled the context but `Wait`
still hangs", you have a child that does not respect `ctx.Done()`. That
is a bug in the child, not in the framework.

## 5. The "go expression" proposals

Three serious proposals have touched the topic. None landed.

### 5.1 The handle-returning go statement

The earliest sketch (Go 2 draft notes, around 2017–2018):

```go
// hypothetical syntax
done := go fetchAll(ctx)
...
err := done.Wait()
```

`go` becomes an expression that returns a handle, similar to JavaScript's
`Promise`. The benefits: every goroutine is "owned" by the value it
returned; you cannot forget to wait. The drawbacks:

- Changes the meaning of `go` for everyone, including code that
  intentionally fires and forgets.
- Channels still exist and would compete with the handle pattern.
- What does `done` even *do* if you discard it? Crash? Warn? Silent leak?

The proposal was deferred, partly because `errgroup` already covered the
common case.

### 5.2 The `task` package

Russ Cox's experimental package (shown in talks, not in stdlib):

```go
err := task.Run(ctx, func(s *task.Scope) error {
    s.Spawn(fetchA)
    s.Spawn(fetchB)
    return nil
})
```

This is `errgroup` plus the block-structured wrapper we built in section 1.
The key difference from `errgroup` alone: `task.Run` is the only way to
get a `*Scope`. There is no `task.Scope{}` literal. The `*Scope` is
constructed inside `Run` and (in principle) cannot outlive it.

The package has not shipped in `x/sync` (yet). The implementation is
trivial once you have `errgroup`; the question is whether to bless one
shape over the many others.

### 5.3 The "structured spawn" syntax

A community proposal (#37095, closed):

```go
// hypothetical syntax
spawn ctx, fetchA(ctx)
spawn ctx, fetchB(ctx)
sync ctx  // wait for every spawn in this scope
```

Closer to Erlang/OTP. Closed as too invasive — the team preferred to
remain a library-only feature.

The pattern across all three proposals: the Go team has consistently
chosen libraries over language changes. That is unlikely to change.

## 6. Designing for the absence of language support

Given Go *won't* add structured concurrency in the foreseeable future, how
do you design your codebase to behave as if it did? Five practical
choices.

### 6.1 No bare `go` in shared code

Add a linter check (e.g. `revive`'s `goroutine-leak` or a custom
`go/analysis` pass) that flags `go f(...)` outside of allow-listed
locations (test helpers, vetted libraries). Make it a CI gate.

### 6.2 `errgroup` is the default

Code-style document: "All concurrent fan-out uses `errgroup`. Use raw
`WaitGroup` only when justified in a comment." Reviewers enforce.

### 6.3 `goleak` in every package

`go.uber.org/goleak` in `TestMain`. Catches forgotten `Wait` calls, daemon
leaks, and anything that survives a test.

### 6.4 Lifecycle interfaces for long-lived components

```go
type Service interface {
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
}
```

`Start` launches owned goroutines; `Stop` joins them. Composition: a
parent service holds child services and starts/stops them in sequence
inside its own `Start`/`Stop`. This is supervision-tree-lite.

### 6.5 Per-package "scope" wrapper

Some packages benefit from a thin wrapper around `errgroup` with
panic-recovery and logging baked in (see the
[Professional](../professional/) page). The point is to make the safe path
the easy path.

## 7. A worked design: scope-based HTTP fetcher

Suppose you need a service that fetches dozens of URLs in parallel, with
per-URL retries, an overall deadline, and cancellation if any URL fails
critically. Here is how you might lay it out.

```go
type Fetcher struct {
    client *http.Client
}

type Result struct {
    URL  string
    Body []byte
    Err  error
}

func (f *Fetcher) FetchAll(
    ctx context.Context,
    urls []string,
    concurrency int,
) ([]Result, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(concurrency)

    results := make([]Result, len(urls))

    for i, u := range urls {
        i, u := i, u
        g.Go(func() (err error) {
            defer func() {
                if r := recover(); r != nil {
                    err = fmt.Errorf("fetcher: panic on %s: %v", u, r)
                }
            }()
            body, err := f.fetchOne(gctx, u)
            results[i] = Result{URL: u, Body: body, Err: err}
            if err != nil && isCritical(err) {
                return err // cancel siblings
            }
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return results, err
    }
    return results, nil
}

func (f *Fetcher) fetchOne(ctx context.Context, url string) ([]byte, error) {
    for attempt := 0; attempt < 3; attempt++ {
        body, err := f.try(ctx, url)
        if err == nil { return body, nil }
        if !isRetryable(err) { return nil, err }
        select {
        case <-time.After(backoff(attempt)):
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    return nil, fmt.Errorf("max retries on %s", url)
}
```

Design properties to notice:

- One scope: `FetchAll` is the owner.
- `g.SetLimit(concurrency)` bounds the work pool.
- `gctx` is passed down everywhere; the context-aware `time.After`+`Done`
  sleep makes the retry loop cancellable.
- Non-critical errors are stored in `results[i].Err` *without* propagating
  to the group — siblings keep working.
- Critical errors propagate, cancel siblings, and return from the group.
- A panic in any worker becomes a returned error, not a process crash.

This is roughly what production-grade Go services look like. `errgroup`
plus a sensible policy on what counts as "fatal" plus per-task panic
recovery.

## 8. The cancellation graph

Once you have several scopes nested or composed, draw the cancellation
graph mentally:

```text
root ctx
  ├─ deadline ctx (5s)
  │   ├─ errgroup gctx
  │   │   ├─ child A ctx
  │   │   └─ child B ctx
  │   └─ logger ctx (independent)
  └─ shutdown ctx (independent)
```

A cancellation at any node propagates *down*. It does *not* propagate *up*
or *sideways*. So:

- The 5-second deadline expires → `gctx` is cancelled (via parent) → A
  and B see Done.
- Child A returns an error → `errgroup` cancels `gctx` → child B sees
  Done.
- The independent logger ctx is unaffected; it has a separate cancel
  function.

When debugging cancellation, draw the graph and ask which node fires
first.

## 9. The case for *some* structured concurrency in Go's future

Even if `go` never changes, two smaller additions could plausibly land:

1. A standard `task` package in `x/sync` (or `sync/task` in the std lib)
   formalising the `Run`/`Spawn` shape. Almost zero language risk,
   modest convenience win.
2. A `vet`-level linter that flags bare `go` in functions that don't
   return a handle and aren't named `*_Daemon`. Pure tooling.

Neither requires Go-team buy-in; both could ship as third-party tools
today (and several do — `staticcheck`, `gocritic`, custom `analysis`
packages). The slow adoption is partly because there is no single
"blessed" structured-concurrency primitive — `errgroup` is the de facto
standard but not part of the spec.

## 10. A short note on Erlang and OTP

Erlang's supervision tree is the gold standard for hierarchical
concurrent processes, but it is much heavier than what Go offers:

- Every process has a PID and a mailbox.
- Every process has a designated parent supervisor.
- Supervisors define restart strategies (`one_for_one`, `rest_for_one`,
  `one_for_all`).
- Errors propagate by message; the parent decides whether to restart,
  escalate, or shut down.

You can hand-build a slice of this on top of Go (the Professional page
sketches a supervisor pattern). But Erlang's strength is that it's the
default. Go's strength is that you don't pay for what you don't use. The
trade-off is real and intentional.

If your service really needs Erlang-grade resilience, you have two
options: build a supervisor module in Go and discipline yourself to use
it everywhere, or admit you wanted Erlang and use Elixir.

## 11. Recap

- A "scope" is the canonical structured-concurrency primitive: an object
  that owns its children and waits for them on close.
- Building a scope on top of `errgroup` is straightforward; making it
  *enforce* its contract requires extra discipline that Go cannot
  compile-check.
- Cancellation and completion are orthogonal. `context.Context` covers
  cancellation; `WaitGroup`/`errgroup.Wait` covers completion.
- Three Go proposals to add structured concurrency to the language have
  been deferred or rejected; the team prefers libraries.
- Without language support, design for it: ban bare `go`, default to
  `errgroup`, use `goleak`, build lifecycle interfaces.
- A standard `task` package may eventually appear in `x/sync`; the
  language itself probably won't change.

The [Professional](../professional/) page picks up here with the
operational details: linting, observability, supervision-tree patterns,
and the production rules that, together, give you about ninety percent of
what a language-level feature would provide.

## 12. Building a structured-concurrency library from scratch

For the rest of this page we will *design* a real library — call it
`scope` — that captures what we want from structured concurrency in Go.
By the end you should be able to write your own, or evaluate someone
else's, with a clear sense of what trade-offs they made.

### 12.1 Goals

Concrete goals (in priority order):

1. Every spawned task is joined before `Run` returns.
2. The first error from any task cancels siblings and is returned from
   `Run`.
3. Panics in tasks become returned errors, not process crashes.
4. The scope cannot be used after `Run` returns; spawning into a closed
   scope is rejected.
5. Each task has a name for diagnostics.
6. The scope itself never leaks goroutines — even on the unhappy paths.

What we *won't* try to achieve, because Go's type system can't enforce
it:

- Preventing the user from leaking the `*Scope` out of `Run`'s callback.
  We document the rule but cannot enforce it.

### 12.2 First sketch

```go
package scope

import (
    "context"
    "errors"
    "fmt"
    "runtime/debug"
    "sync"

    "golang.org/x/sync/errgroup"
)

type Scope struct {
    g      *errgroup.Group
    ctx    context.Context
    mu     sync.Mutex
    closed bool
}

func Run(parent context.Context, fn func(*Scope) error) error {
    g, gctx := errgroup.WithContext(parent)
    s := &Scope{g: g, ctx: gctx}

    bodyErr := safeBody(s, fn)

    s.mu.Lock()
    s.closed = true
    s.mu.Unlock()

    waitErr := s.g.Wait()
    return errors.Join(bodyErr, waitErr)
}

func safeBody(s *Scope, fn func(*Scope) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("scope: panic in body: %v\n%s", r, debug.Stack())
        }
    }()
    return fn(s)
}

func (s *Scope) Spawn(name string, fn func(context.Context) error) {
    s.mu.Lock()
    if s.closed {
        s.mu.Unlock()
        return
    }
    s.mu.Unlock()

    s.g.Go(func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("scope: panic in task %q: %v\n%s",
                    name, r, debug.Stack())
            }
        }()
        return fn(s.ctx)
    })
}
```

Walk through it:

- `Run` is the only way to obtain a `*Scope`. The user passes a body
  closure that receives the scope, spawns tasks, and returns.
- `safeBody` wraps the body in a `recover` so a panic becomes an error.
- After the body returns (success or panic), `closed` is set to true,
  then `Wait` is called. Late `Spawn` calls (e.g. from another goroutine)
  see `closed == true` and refuse.
- `Spawn` itself wraps each task with `recover`, so task panics become
  task errors that propagate through `errgroup`.

### 12.3 Discussion of the design

A few subtle points.

**Why is `Spawn` allowed to silently no-op after closure?**

The alternative is to return an error or panic. But `Spawn` doesn't
return an error today, and panicking on a race window is harsh.
Silently dropping is the least bad option. In tests, you'd add an
assertion that no late `Spawn` ever happens.

**Why does `Run` call `Wait` even when the body returned an error?**

Because the body might have spawned tasks before erroring. Those tasks
must be joined; we can't leak them. The `errors.Join(bodyErr, waitErr)`
combines both error sources.

**What if the body returns `nil` but a spawned task fails?**

Then `bodyErr == nil` and `waitErr != nil`, so `errors.Join(nil, waitErr)`
returns `waitErr`. Good.

**What if both the body and a spawned task fail?**

`errors.Join(bodyErr, waitErr)` returns a multi-error that wraps both.
Callers can use `errors.Is` and `errors.As` to inspect.

**Why pass `s.ctx` to the task rather than letting the task accept the
parent context?**

Because we want sibling cancellation. If a task uses the outer parent
context, a sibling's failure doesn't cancel it. By giving the task
`s.ctx` (which is the errgroup-derived context), we get cancellation
propagation for free.

### 12.4 Testing the scope

The scope should pass these tests.

```go
func TestScopeRunsAllAndJoins(t *testing.T) {
    defer goleak.VerifyNone(t)

    var ran [3]bool
    err := Run(context.Background(), func(s *Scope) error {
        for i := 0; i < 3; i++ {
            i := i
            s.Spawn(fmt.Sprintf("task-%d", i), func(ctx context.Context) error {
                ran[i] = true
                return nil
            })
        }
        return nil
    })
    if err != nil { t.Fatal(err) }
    for i, r := range ran {
        if !r { t.Errorf("task %d did not run", i) }
    }
}

func TestScopeFirstErrorCancelsSiblings(t *testing.T) {
    defer goleak.VerifyNone(t)

    boom := errors.New("boom")
    siblingExited := make(chan struct{})

    err := Run(context.Background(), func(s *Scope) error {
        s.Spawn("fast", func(ctx context.Context) error { return boom })
        s.Spawn("slow", func(ctx context.Context) error {
            <-ctx.Done()
            close(siblingExited)
            return ctx.Err()
        })
        return nil
    })
    if !errors.Is(err, boom) { t.Fatalf("err = %v, want %v", err, boom) }
    select {
    case <-siblingExited:
    case <-time.After(time.Second):
        t.Fatal("sibling did not cancel")
    }
}

func TestScopePanicInTaskBecomesError(t *testing.T) {
    defer goleak.VerifyNone(t)

    err := Run(context.Background(), func(s *Scope) error {
        s.Spawn("boom", func(ctx context.Context) error {
            panic("kaboom")
        })
        return nil
    })
    if err == nil { t.Fatal("expected error from panicking task") }
    if !strings.Contains(err.Error(), "kaboom") {
        t.Errorf("error %q does not contain 'kaboom'", err)
    }
}
```

These three tests exercise the three properties that matter: join,
sibling cancellation, panic-to-error. Add more tests as the API grows.

## 13. Extending the scope: typed results

A common request: return typed results from spawned tasks. The `errgroup`
API takes `func() error`, so result handling is manual. We can fix that
in our `scope` package by adding a generic helper.

```go
type Task[T any] struct {
    s   *Scope
    res *T
    err *error
}

func SpawnT[T any](s *Scope, name string, fn func(context.Context) (T, error)) *Task[T] {
    t := &Task[T]{
        s:   s,
        res: new(T),
        err: new(error),
    }
    s.Spawn(name, func(ctx context.Context) error {
        v, err := fn(ctx)
        *t.res = v
        *t.err = err
        return err
    })
    return t
}

func (t *Task[T]) Result() (T, error) {
    return *t.res, *t.err
}
```

The caller pattern becomes:

```go
err := Run(ctx, func(s *Scope) error {
    userT := SpawnT(s, "user",  func(ctx context.Context) (User, error)  { return fetchUser(ctx) })
    postsT := SpawnT(s, "posts", func(ctx context.Context) (Posts, error) { return fetchPosts(ctx) })
    return nil
})
if err != nil { return err }
user, _ := userT.Result()
posts, _ := postsT.Result()
```

Notice: `userT.Result()` is read *after* `Run` returns. The boundary
rule still applies. The `*t.res` write happens-before `Wait`'s return,
so reading it after is race-free.

You could go further and have `Task[T]` block on `Wait()` if read
before the scope closes, but that adds complexity. The simpler "read
after `Run` returns" rule is good enough.

## 14. Cancellation patterns in depth

Now to look at cancellation from several angles.

### 14.1 Cancellation as a signal, not a guarantee

`context.Context.Done()` closing is a *signal*. Whether the receiver
acts on it is up to the receiver. There is no language-level mechanism
to force a goroutine to stop.

This means structured concurrency in Go has a soft spot: if a child
goroutine doesn't respect `ctx.Done()`, the scope cannot join it. The
scope's `Wait` will block until the goroutine returns on its own
schedule, no matter what.

Implication for design: every code path in your scope's tasks must be
cancellation-aware. That means:

- Loops check `ctx.Err()` periodically.
- `time.Sleep` is replaced with `select` on `time.After` and
  `ctx.Done()`.
- I/O calls accept a context and honour it.
- Calls to libraries are checked: does this library respect contexts?

If the answer is "no", you have a leak waiting to happen.

### 14.2 Cancellation propagation through context graphs

Recall the graph from section 8 of the Junior page (and section 14 of
Middle):

```text
root → deadline → errgroup gctx → child ctx
```

Cancellation flows downward. A few subtleties:

- Cancelling the root cancels everything below. If the root is cancelled
  10 ms after `Run` starts, every spawned task should exit promptly.
- Cancelling an intermediate node cancels its subtree, but not its
  ancestors or siblings. The deadline expiring does not "leak upward"
  to root.
- A context node fires `Done()` exactly once. After that, every
  `<-ctx.Done()` returns immediately. There is no "uncancellation".

This last point matters: once a scope's context is cancelled, you
cannot un-cancel it. If you need re-entry into a fresh cancellation
window, you need a new scope.

### 14.3 The `Cause` chain

`context.WithCancelCause` and `context.Cause` give you a chain of causes
in nested contexts.

```go
root := context.Background()
parent, parentCancel := context.WithCancelCause(root)
child,  childCancel  := context.WithCancelCause(parent)

childCancel(errors.New("child gave up"))
// child.Err() == context.Canceled
// context.Cause(child) == "child gave up"
// parent is unaffected

parentCancel(errors.New("parent gave up"))
// parent.Err() == context.Canceled
// context.Cause(parent) == "parent gave up"
// child.Cause is STILL "child gave up", because child was already cancelled
```

The rule: `context.Cause` returns the first cause that closed `Done()`.
Once set, it's frozen.

When an `errgroup`-derived context is cancelled by the parent (e.g. a
deadline expires), `context.Cause(gctx)` returns the parent's cause (or
`context.DeadlineExceeded`). When it's cancelled by a sibling failure,
`Cause` returns the sibling's error. This lets diagnostic code log the
actual reason a task exited.

### 14.4 Timeouts are cancellation

A `context.WithTimeout(parent, d)` is just `context.WithDeadline(parent,
time.Now().Add(d))`. The deadline machinery is implemented via a
goroutine inside the context that fires `cancel()` when the deadline is
reached.

This means a deadline is *also* covered by `errgroup`'s structured
cancellation: when the deadline fires, `gctx` is cancelled (because its
parent was), siblings see `Done()`, and `Wait` joins them all.

The implication: putting a deadline on the outer context of an
`errgroup.WithContext` gives you a "best-effort batch" with an upper
bound. Tasks that complete before the deadline succeed; tasks that
don't see the cancellation and exit early.

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
g, gctx := errgroup.WithContext(ctx)
// ... spawn tasks that respect gctx ...
err := g.Wait()
if errors.Is(err, context.DeadlineExceeded) {
    log.Println("batch took too long; some tasks abandoned")
}
```

### 14.5 Cancellation vs interruption

A nuance worth knowing: Go has no concept of "interrupting" a goroutine
in the way some languages have `Thread.interrupt()` or similar. The
*only* mechanism is cooperative cancellation via context. There is no
way to force a goroutine to unwind from outside.

This means a CPU-bound goroutine that does not check `ctx.Err()`
between iterations is uncancellable. Structured concurrency relies on
goroutines being well-behaved enough to check.

Common pattern for CPU-bound work:

```go
for i, item := range items {
    if i%1000 == 0 {
        if err := ctx.Err(); err != nil { return err }
    }
    process(item)
}
```

Check every N iterations, with N tuned so the check is cheap but
responsiveness is acceptable.

## 15. The deeper completion contract

`errgroup.Wait` (and our `scope.Run`) guarantee *completion* — every
task has returned. But this is a stronger guarantee than it looks, and
it imposes constraints on what counts as "completion".

### 15.1 What does "completion" really mean?

A goroutine "completes" when its top-level function returns. That can
mean:

- The function returned normally.
- The function returned because of context cancellation.
- The function returned because of an internal error.
- The function panicked and the panic unwound the goroutine's stack.

In all four cases, the goroutine's frame is gone and the runtime
schedules its deletion. From `errgroup`'s perspective, all four trigger
`g.done()` (assuming `defer g.done()` is in place — which it is in
`errgroup`'s implementation).

So "completion" in Go is "the goroutine's stack has unwound". It is
*not* "the goroutine has released every resource it held". That
distinction matters.

### 15.2 Resources versus goroutines

Consider:

```go
g.Go(func() error {
    f, err := os.Open("big.dat")
    if err != nil { return err }
    // forgot to defer f.Close()
    return processFile(f)
})
```

When the goroutine completes, `g.done()` fires and `errgroup` is
satisfied. But the file descriptor leaks. Structured concurrency
guarantees goroutine completion, not resource completion.

Resource cleanup is a separate concern, typically handled with `defer`.
This is the reason every Go style guide insists on `defer` for cleanup:
it's the only way to guarantee cleanup even on panic or early return.

### 15.3 Cleanup-after-cancellation

A subtler case: what if cleanup itself needs a context?

```go
g.Go(func() error {
    conn, err := dial(ctx)
    if err != nil { return err }
    defer func() {
        ctx2, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        _ = conn.Close(ctx2) // graceful close even after ctx cancelled
    }()
    return useConn(ctx, conn)
})
```

Notice the cleanup uses a fresh context, not the cancelled one. This
matters when `ctx` is already cancelled (because of sibling failure)
and the cleanup needs network round-trips. Using the cancelled `ctx`
would fail every cleanup call immediately.

This pattern is sometimes called "the orphan context" because the
cleanup context outlives its parent. Use it sparingly — the orphan
context is, by definition, unsupervised.

## 16. Scope hierarchies and supervision

Once you have a `scope.Run` building block, you can compose hierarchies.

### 16.1 Linear sequences of scopes

```go
err := Run(ctx, func(s1 *Scope) error {
    s1.Spawn("step1.a", stepA)
    s1.Spawn("step1.b", stepB)
    return nil
})
if err != nil { return err }

err = Run(ctx, func(s2 *Scope) error {
    s2.Spawn("step2.a", stepC)
    s2.Spawn("step2.b", stepD)
    return nil
})
```

Two scopes, one after the other. Each is independent. If the first
scope's tasks complete, the second scope starts fresh. Cancellation of
the outer `ctx` cancels both, but each scope has its own derived
context.

### 16.2 Nested scopes

```go
err := Run(ctx, func(outer *Scope) error {
    outer.Spawn("worker.A", func(ctx context.Context) error {
        return Run(ctx, func(inner *Scope) error {
            inner.Spawn("subtask.1", taskOne)
            inner.Spawn("subtask.2", taskTwo)
            return nil
        })
    })
    outer.Spawn("worker.B", workerB)
    return nil
})
```

The outer scope has two workers. Worker A internally creates its own
inner scope with two subtasks. The outer scope's `Run` doesn't return
until worker A's `Run` returns, which doesn't return until both
subtasks complete.

Cancellation graph:

```text
ctx → outer.gctx → workerA.taskCtx → inner.gctx → subtask.1/2.ctx
                 ↘ workerB.taskCtx
```

A failure in subtask.1 cancels inner.gctx (other inner subtasks notice),
which propagates outward as worker A's error, which cancels outer.gctx,
which cancels worker B. The whole tree unwinds cleanly. This is the
property that makes structured concurrency *compositional*.

### 16.3 Supervisor scopes with restart

For long-lived background work, you want a scope that *restarts* failed
children. We saw a sketch on the Professional page; here's a fuller
version that fits the scope vocabulary:

```go
func RunSupervised(ctx context.Context, workers map[string]func(context.Context) error) error {
    return Run(ctx, func(s *Scope) error {
        for name, fn := range workers {
            name, fn := name, fn
            s.Spawn(name, func(ctx context.Context) error {
                backoff := time.Second
                for {
                    err := fn(ctx)
                    if ctx.Err() != nil { return ctx.Err() }
                    log.Printf("worker %q exited (%v), restarting in %s", name, err, backoff)
                    select {
                    case <-time.After(backoff):
                    case <-ctx.Done(): return ctx.Err()
                    }
                    if backoff < 30*time.Second { backoff *= 2 }
                }
            })
        }
        return nil
    })
}
```

Every worker is in an infinite restart loop. The loop exits only when
its context is cancelled — which happens when `RunSupervised` is
shutting down (parent cancelled). This is Erlang-lite: workers are
restarted forever, with exponential backoff, until the supervisor is
asked to stop.

The structured-concurrency invariant holds: when `RunSupervised`
returns, every worker has exited. The hierarchy is intact.

## 17. Where `task.Scope` would shine — and where it wouldn't

A hypothetical first-class `task.Scope` in the language wouldn't be a
magic bullet. Let's think about what it'd change and what it wouldn't.

### 17.1 What it'd change

- **Compile-time leak prevention.** Spawning into a closed scope would
  be a compile error.
- **No accidental forgetting of `Wait`.** The `task` construct couldn't
  be exited without joining its tasks.
- **A standard place for panic handling.** The language could define
  that task panics become returned errors, by default.

### 17.2 What it wouldn't change

- **Cooperative cancellation.** Tasks still need to respect cancellation.
- **Resource leaks.** Forgetting `defer file.Close()` is still a bug.
- **Goroutines in libraries you don't control.** If a third-party
  library spawns goroutines internally, your scope can't see them.
- **Daemons.** Long-lived background work still needs special handling.

So `task.Scope` would buy us roughly Level 3 in the taxonomy from the
Middle page — but the discipline of cancellation-aware code remains.
Still, that compile-time guarantee would be a significant safety net.

## 18. Closure-of-the-error question: which error wins?

A subtle senior-level question: in a deeply nested scope hierarchy,
which error gets propagated upward when multiple failures happen
nearly simultaneously?

In `errgroup`, it's clear: the *first* non-nil error wins, per-group.
In a hierarchy, each group has its own "first error". The error
returned at each level depends on which group saw a failure first.

Worked example:

- subtask.1 fails with `errA`.
- inner.gctx is cancelled with cause `errA`.
- subtask.2 sees `Done()`, returns `gctx.Err()` (which is
  `context.Canceled`).
- inner's `Wait` returns `errA` (the first non-nil error).
- worker A's task returns `errA` (because it called `Run` which
  returned `errA`).
- outer.gctx is cancelled with cause `errA`.
- worker B sees `Done()`, returns `ctx.Err()`.
- outer's `Wait` returns `errA`.

So `errA` propagates from the leaf all the way to the root, unchanged
(modulo any `fmt.Errorf("...: %w", err)` wrapping). This is the
intuitive behaviour: the *cause* error is what surfaces.

If you want a stack-trace-like view of the chain, wrap each level:

```go
err := s.g.Wait()
if err != nil {
    return fmt.Errorf("worker A: %w", err)
}
```

Then `errors.Unwrap` gives you the chain.

## 19. Practical advice for designing concurrent APIs

Pulling everything together, here is the senior-level distillation of
how to design a function that does concurrent work.

### 19.1 Accept a `context.Context`

Always the first parameter:

```go
func DoWork(ctx context.Context, ...) error
```

This makes your function cancellable and composable into any scope.

### 19.2 Decide: batch or streaming?

- **Batch.** Caller wants all results together. Return `([]Result, error)`.
  Use `errgroup` internally.
- **Streaming.** Caller wants results as they arrive. Accept a `chan<-
  Result` (or return a `<-chan Result`). Document the close semantics.

Mixing these in one function leads to API confusion. Pick one.

### 19.3 Never spawn unmanaged goroutines

If your function returns immediately but spawns background work, you
have a leak waiting to happen. The function should either:

- Wait for the background work before returning (batch case).
- Return a handle the caller can `Wait` or `Stop` on (lifecycle case).
- Accept an `*errgroup.Group` from the caller and add work to it
  (composition case).

### 19.4 Document context behaviour

In the godoc: which context is honoured, what cancellation does, what
timeouts mean. Callers shouldn't have to read the source to know.

### 19.5 Test with `goleak`

Every package with concurrency uses `goleak.VerifyTestMain(m)`. This is
how you catch the bugs the type system can't.

## 20. The senior-level mindset

Three habits that distinguish a senior in concurrent Go from a strong
middle:

1. **"Who owns this goroutine?" is a reflex.** Reading code, you find
   yourself asking the question on every `go` you see. If the answer
   is unclear, you push for clarification before the PR merges.
2. **You design APIs that make the wrong thing hard.** Returning a
   handle the caller must `Wait` on is better than spawning a daemon.
   Forcing the caller to pass a context is better than calling
   `context.Background()` internally.
3. **You think in terms of cancellation graphs, not individual
   contexts.** When debugging, you draw the graph mentally: which
   context derives from which, where does cancellation enter, what
   does it propagate to. The graph view makes most concurrent bugs
   obvious.

These habits aren't language features; they're disciplines you build
over time. Go's design makes them necessary; following them is what
gets you to "boring concurrency" — the state where concurrent code in
your project is no scarier than synchronous code.

## 21. Recap

- A "scope" is a structured-concurrency primitive: an object that owns
  its children and waits for them on close.
- Building a scope on `errgroup` is easy; making it enforce its
  contract is hard because Go can't compile-check it.
- Cancellation and completion are orthogonal; structured concurrency
  needs both.
- A library `scope.Run` plus discipline gets you most of the safety of
  a language feature.
- Composition is the key property: scopes nest cleanly via the context
  graph.
- For long-lived background work, build a supervisor pattern on top of
  scopes.
- Senior-level habits: ask who owns each goroutine, design APIs that
  prevent leaks by construction, think in cancellation graphs.

The [Professional](../professional/) page makes this concrete with
production-grade patterns: lint rules, observability, supervision-tree
sketches, and the policies that turn the discipline into a team
standard.

## 22. Case study: rewriting an HTTP backend for full structured concurrency

To make all the abstract material concrete, here is a small backend
service rewritten in three increasingly structured forms. The service
does the following: on each `/profile/:id` request, fetch the user
profile, their last ten posts, their friend list, and their notification
count, all in parallel. Return them as one JSON response.

### 22.1 Version A — bare `go` and shared mutex

The pre-structured version:

```go
type ProfileResponse struct {
    User          User
    Posts         []Post
    Friends       []Friend
    Notifications int
}

func (h *Handler) Profile(w http.ResponseWriter, r *http.Request) {
    id := mux.Vars(r)["id"]
    var (
        mu sync.Mutex
        resp ProfileResponse
        errs []error
    )
    var wg sync.WaitGroup

    wg.Add(4)
    go func() {
        defer wg.Done()
        u, err := h.users.Get(id)
        mu.Lock()
        if err != nil { errs = append(errs, err) } else { resp.User = u }
        mu.Unlock()
    }()
    go func() {
        defer wg.Done()
        p, err := h.posts.For(id, 10)
        mu.Lock()
        if err != nil { errs = append(errs, err) } else { resp.Posts = p }
        mu.Unlock()
    }()
    go func() {
        defer wg.Done()
        f, err := h.friends.Of(id)
        mu.Lock()
        if err != nil { errs = append(errs, err) } else { resp.Friends = f }
        mu.Unlock()
    }()
    go func() {
        defer wg.Done()
        n, err := h.notifs.Count(id)
        mu.Lock()
        if err != nil { errs = append(errs, err) } else { resp.Notifications = n }
        mu.Unlock()
    }()

    wg.Wait()
    if len(errs) > 0 {
        http.Error(w, errs[0].Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(resp)
}
```

Bugs and smells:

- No context propagation. Slow downstream calls can't be cancelled when
  the client disconnects.
- No deadline. A single slow service ruins every request.
- All four goroutines run to completion even if one fails immediately.
- Heavy boilerplate around mutex + slice + error handling.
- Loop-variable bug isn't present here (each block has its own
  variables) but the pattern doesn't scale to dynamic fan-out.

### 22.2 Version B — `errgroup.WithContext`

The structured rewrite:

```go
func (h *Handler) Profile(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
    defer cancel()

    id := mux.Vars(r)["id"]
    g, gctx := errgroup.WithContext(ctx)
    var resp ProfileResponse

    g.Go(func() error {
        u, err := h.users.Get(gctx, id)
        if err != nil { return err }
        resp.User = u
        return nil
    })
    g.Go(func() error {
        p, err := h.posts.For(gctx, id, 10)
        if err != nil { return err }
        resp.Posts = p
        return nil
    })
    g.Go(func() error {
        f, err := h.friends.Of(gctx, id)
        if err != nil { return err }
        resp.Friends = f
        return nil
    })
    g.Go(func() error {
        n, err := h.notifs.Count(gctx, id)
        if err != nil { return err }
        resp.Notifications = n
        return nil
    })

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(resp)
}
```

What changed:

- A 3-second deadline bounds the request.
- Each fetch takes `gctx` and respects cancellation.
- First failure cancels siblings via `gctx`.
- Writes to `resp` fields are race-free because each goroutine touches
  a distinct field and the reads after `g.Wait()` follow the
  happens-before edge.
- Error handling collapses to one branch.

This is the version that nine out of ten Go services should be running.
It's good. It's idiomatic. It's structured.

### 22.3 Version C — using our `scope.Run` wrapper

For a service that wants panic-safety and structured logs, the next
step is wrapping the `errgroup` with our `scope` package:

```go
func (h *Handler) Profile(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
    defer cancel()

    id := mux.Vars(r)["id"]
    var resp ProfileResponse

    err := scope.Run(ctx, func(s *scope.Scope) error {
        s.Spawn("users", func(ctx context.Context) error {
            u, err := h.users.Get(ctx, id)
            if err != nil { return err }
            resp.User = u
            return nil
        })
        s.Spawn("posts", func(ctx context.Context) error {
            p, err := h.posts.For(ctx, id, 10)
            if err != nil { return err }
            resp.Posts = p
            return nil
        })
        s.Spawn("friends", func(ctx context.Context) error {
            f, err := h.friends.Of(ctx, id)
            if err != nil { return err }
            resp.Friends = f
            return nil
        })
        s.Spawn("notifs", func(ctx context.Context) error {
            n, err := h.notifs.Count(ctx, id)
            if err != nil { return err }
            resp.Notifications = n
            return nil
        })
        return nil
    })

    if err != nil {
        h.logger.Errorw("profile failed", "id", id, "err", err)
        http.Error(w, "internal error", 500)
        return
    }
    json.NewEncoder(w).Encode(resp)
}
```

Additional properties over Version B:

- Each task has a name that appears in panic logs and error wrapping.
- A panic in any task becomes a returned error, not a process crash.
- The error path goes through structured logging rather than being
  returned to the client raw.

Version C is what a production service hardened for reliability looks
like. The trade-off versus Version B is one extra dependency
(`scope`) and a small amount of indirection. For a service that
handles real money or user data, it's worth it.

## 23. Detailed worked example: streaming with structured concurrency

The case studies above are batch (collect-then-respond). Streaming is
harder. Let's design a structured-concurrency-clean streaming endpoint.

The endpoint emits server-sent events. For each request, the server
spawns three event sources: user activity, friend updates, and system
announcements. Each source emits events asynchronously; the handler
merges them into the response stream.

```go
type Event struct {
    Type string
    Data any
    Time time.Time
}

func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok { http.Error(w, "streaming unsupported", 500); return }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")

    ctx := r.Context()
    events := make(chan Event, 64)

    g, gctx := errgroup.WithContext(ctx)

    // Producers
    g.Go(func() error {
        return h.activity.Stream(gctx, events)
    })
    g.Go(func() error {
        return h.friends.Stream(gctx, events)
    })
    g.Go(func() error {
        return h.system.Stream(gctx, events)
    })

    // Closer
    g.Go(func() error {
        <-gctx.Done()
        // Wait for the three producers to actually exit before closing.
        // We can't do that easily inside the same group; the pattern
        // below works: producers close events themselves after their
        // own goroutine exits, using sync.Once.
        return nil
    })

    // Consumer (this goroutine)
    go func() {
        _ = g.Wait()
        close(events)
    }()

    for ev := range events {
        if err := writeSSE(w, ev); err != nil {
            return
        }
        flusher.Flush()
    }
}
```

This is harder than it looks. The trick is the closer goroutine: it
waits for `g.Wait()` and then closes the channel. The consumer in the
main handler ranges over the channel and exits when it's closed.

A few subtle things:

- The closer goroutine is *not* part of the errgroup. It exists to
  bridge the group's `Wait` with the consumer's `for range`. This is
  unavoidable: the consumer needs the channel to be closed *after* all
  producers exit, but `errgroup.Wait` is a blocking call, not an
  event.
- If the consumer exits early (client disconnects), `ctx` is cancelled,
  `gctx` is cancelled, producers exit, `g.Wait()` returns, the closer
  closes the channel, the consumer's range exits cleanly.
- The producers must not send into `events` after their function
  returns. They typically check `gctx.Done()` between sends.

This is the pattern for "structured streaming" in Go. It's noisier than
the batch case because Go channels and `errgroup` aren't a perfect
match. Languages with first-class streams (e.g. Rust's `async` streams)
handle this more elegantly.

## 24. Anti-patterns and how to escape them

A few patterns that look reasonable but should be flagged in review.

### 24.1 The "request-scoped goroutine pool"

```go
type Service struct {
    pool *errgroup.Group
}

func NewService() *Service {
    var g errgroup.Group
    g.SetLimit(100)
    return &Service{pool: &g}
}

func (s *Service) Submit(work func() error) {
    s.pool.Go(work)
}

func (s *Service) Shutdown() error {
    return s.pool.Wait()
}
```

Looks tidy. But this group is one-shot: after `Wait` returns, you
cannot submit more work. A *service* lives across many submissions; an
`errgroup` does not. The correct shape is either a fresh group per
batch or a worker pool with channels + `WaitGroup`.

### 24.2 The "context laundering" goroutine

```go
go func() {
    ctx := context.Background()
    doImportantThing(ctx)
}()
```

The goroutine *deliberately* uses `context.Background()` to avoid being
cancelled. This is the explicit declaration: "I don't care about
structured anything." Sometimes legitimate (cleanup work that must run
even after request cancellation), but always a smell — flag it for
review and document the reason.

### 24.3 The "fire and pray" pattern

```go
go thing.Do(ctx)
```

A bare goroutine with a context. Looks responsible because it accepted
`ctx`. But who waits for it? Who handles its error? Probably nobody.
Demand a `g.Go(...)` or a documented daemon lifecycle.

## 25. Lessons from incidents

A few war stories (composited, anonymised) that illustrate what goes
wrong in production when structured concurrency isn't applied.

### Incident A — the slow log goroutine

A service had a `go logAudit(event)` on every request. `logAudit` made
a network call to a log aggregator. The aggregator started slowing
down. Each request spawned a goroutine that piled up waiting for the
network. Goroutine count climbed from 50 to 50,000 in two hours; GC
pressure spiked; latency tanked; on-call paged.

Root cause: bare `go` in a hot path. Fix: a single supervised audit
worker that drained a buffered channel, dropping events when the
buffer was full.

### Incident B — the missing cancellation

A batch processor used `errgroup` with `WithContext`. One of the
fetches was a library that took its own `context.Background()`
internally — it ignored the context passed in. When the batch's
deadline expired, `gctx` cancelled, but the misbehaving library kept
running. `g.Wait` blocked forever; the batch never finished; queue
backed up.

Root cause: trusting a library to respect contexts without verifying.
Fix: wrap the library call in `select { case res := <-done: ... case
<-ctx.Done(): return ctx.Err() }`, accepting that the underlying call
might keep running but at least the batch exits.

### Incident C — the panicking handler

An HTTP handler used `errgroup` to fan out. One of the workers panicked
because of a nil map access. The panic skipped `g.done()` (older
errgroup version) and `g.Wait()` hung forever. The handler held a
mutex around a global cache. Every subsequent request blocked on the
mutex. The entire service deadlocked.

Root cause: no panic-recovery in workers. Fix: a wrapper around
`g.Go` that always recovers panics and converts them to errors. The
[Professional](../professional/) page sketches this.

### Incident D — the daemon in the group

A service designed a request handler that started a "long-poll"
goroutine and added it to the request's `errgroup`. When the
long-poll succeeded (returned after up to 30 seconds), the request
completed. When the request was cancelled, the long-poll should have
exited — but the long-poll library used `time.Sleep(1*time.Second)`
internally to throttle, and didn't check the context between sleeps.

Each cancelled request still consumed CPU for up to a second after
cancellation. Under high cancellation rates (e.g. when the upstream
load-balancer killed slow requests), CPU usage spiked.

Root cause: the long-poll library's loops weren't context-aware. Fix:
replace `time.Sleep` with `select { case <-time.After: case
<-ctx.Done(): }` everywhere in the library.

The common thread in all four incidents: violations of structured
concurrency principles. Each one was preventable with the disciplines
discussed on this page.

## 26. The senior's checklist for any concurrent design

Before merging a PR that introduces concurrent code, walk through
this checklist:

- [ ] Every `go` keyword has a named owner.
- [ ] Every goroutine accepts and respects a `context.Context`.
- [ ] Every fan-out uses `errgroup.WithContext` (or equivalent
  structured wrapper), not bare `go`.
- [ ] Every loop body inside `g.Go` rebinds the loop variable
  (pre-1.22) or relies on per-iteration variables (1.22+).
- [ ] Every shared variable written by a goroutine is read only after
  the corresponding `Wait` returns.
- [ ] Every `time.Sleep` is replaced with a context-aware select.
- [ ] Every `SetLimit` precedes the first `Go`.
- [ ] Every long-running goroutine has a `Stop` mechanism that joins
  it before returning.
- [ ] Every package with concurrency has `goleak.VerifyTestMain(m)`.
- [ ] Every panic-prone goroutine has a recover.
- [ ] Every deadline is documented and tested.

Eleven boxes. Tick them all and your concurrent code is, by definition,
structured.

## 27. Going further

If you've worked through everything to here and want to push further:

- Read the `errgroup` test suite. Short and instructive.
- Read `sourcegraph/conc` source. See how a different team designed
  the same primitives with generic types.
- Read Nathaniel J. Smith's full essay on Trio. Best explanation of
  the underlying philosophy.
- Read the Swift Structured Concurrency proposal (SE-0304). Shows
  what compile-time enforcement looks like.
- Watch Russ Cox's "Go Concurrency Patterns" and "Bell Labs and CSP
  Threads" talks for the historical context.

Beyond that, the only way to develop the senior-level reflexes is to
write a lot of concurrent code, review a lot of concurrent code, and
debug a few production incidents. The skills sharpen with use.

## 28. Final recap

Senior-level structured concurrency in Go boils down to:

1. **Library, not language.** Go gives you `errgroup` and convention.
2. **Scope is your unit of design.** Every fan-out has a scope; the
   scope owns its tasks.
3. **Cancellation and completion are separate concerns.** Context
   covers cancellation; `Wait`-style joins cover completion.
4. **Composition via contexts.** Scopes nest because contexts nest.
5. **Discipline is the substitute for compiler enforcement.** Lint
   rules, code review, `goleak`.
6. **Daemons are different.** Long-lived background work needs its own
   lifecycle, not an `errgroup`.
7. **Most bugs are obvious in hindsight.** The checklist in section 26
   catches them at review time.

This is the level you want to operate at when designing systems that
need to be reliable, observable, and maintainable. Move on to the
[Professional](../professional/) page when you want to turn these
principles into team-level engineering practice.

## 29. Closing thought

The argument for structured concurrency is, ultimately, an argument
for *readability under stress*. When the production incident hits at
3 AM, the engineer paged in needs to understand the concurrent code
fast. Code that follows the structured-concurrency discipline reads
top-to-bottom: every goroutine has a visible owner, every wait point
is explicit, every error path is traceable. Code that doesn't reads
sideways: goroutines are scattered across files, ownership is
implicit, errors go to "logs somewhere".

Go won't enforce the discipline. The team, the policy, and the
review process must. The reward is concurrent code that's no scarier
than synchronous code — which is the only kind of concurrent code
that can be maintained at scale over years.

Read [Professional](../professional/) for the engineering practices
that make this real on a team.

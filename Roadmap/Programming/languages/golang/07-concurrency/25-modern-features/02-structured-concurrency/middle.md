---
layout: default
title: Structured Concurrency — Middle
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/middle/
---

# Structured Concurrency — Middle

[← Back](../)

The Junior page covered the *what*: bare `go` is unstructured, `errgroup`
brings the structure back. This page goes one level deeper. We walk through
the `errgroup` source, cover the full API (`Go`, `TryGo`, `SetLimit`,
`WithContext`, `Wait`), discuss the design choices, and contrast Go with
the languages that have first-class structured concurrency (Kotlin, Swift,
Python's Trio).

## 1. The `errgroup` source, line by line

The whole file is about 130 lines. We will go through it section by section.
The references to `errgroup.go:N` correspond to the current `x/sync` tree;
line numbers shift by a line or two across revisions but the structure is
stable.

### 1.1 The `Group` struct

```go
// errgroup.go:18
type token struct{}

type Group struct {
    cancel func(error)

    wg sync.WaitGroup

    sem chan token

    errOnce sync.Once
    err     error
}
```

Five fields, no exposed methods on the fields themselves:

- `cancel`: stored when `WithContext` derived a cancellable context. Called
  with the captured first error so that `context.Cause(gctx)` returns it.
- `wg`: the standard `sync.WaitGroup` that tracks active goroutines.
- `sem`: a counted semaphore implemented as a buffered channel. Non-nil
  when `SetLimit` is in effect.
- `errOnce`: ensures only the first error wins.
- `err`: the captured first error.

`token` is a zero-byte type whose only role is to be the semaphore's
element. Sending and receiving from `sem` does the bounded-counter trick.

### 1.2 `done`

```go
// errgroup.go:30
func (g *Group) done() {
    if g.sem != nil {
        <-g.sem
    }
    g.wg.Done()
}
```

Internal helper, called when each goroutine returns. Releases a semaphore
slot (if any) and signals the wait group. Order matters: we release the
slot *before* the wait group, but in this implementation either order is
safe because nobody waits on the semaphore directly.

### 1.3 `WithContext`

```go
// errgroup.go:38
func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}
```

Three lines do all the work. `context.WithCancelCause` returns a cancel
function that accepts the cancellation reason; that reason is later
retrievable via `context.Cause(ctx)`. Storing `cancel` in `g.cancel` is how
the group "knows" how to cancel siblings on first error.

If you wanted to write `errgroup` from scratch today and remove this field,
you would need to manage cancellation externally — which is exactly the
pre-`WithCancelCause` world that `errgroup` cleaned up.

### 1.4 `Wait`

```go
// errgroup.go:51
func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}
```

`Wait` blocks on the `WaitGroup` until every goroutine has returned. Then,
if a context was derived, it cancels with the captured error as the cause
— *even if* `g.err == nil`. This last detail matters: even a successful
`errgroup.WithContext` cancels its derived context when it is done. That
means downstream code that received `gctx` will see it cancelled after
`Wait` returns, ensuring it cannot accidentally use `gctx` for "background"
work after the group has been joined.

### 1.5 `Go`

```go
// errgroup.go:64
func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{} // blocks until a slot frees
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
}
```

Walk through it:

1. If `SetLimit` was called, block on `g.sem <- token{}` until a slot frees.
   This is how `Go` exerts backpressure on the caller.
2. `g.wg.Add(1)` *before* `go ...`. The `Add` must happen synchronously in
   the launcher, not inside the goroutine, otherwise `Wait` could race past
   it.
3. `defer g.done()` ensures the wait group is decremented and the semaphore
   slot released *even if `f` panics* — at least up to the point the panic
   propagates. The panic itself still aborts the goroutine and (typically)
   the process.
4. `g.errOnce.Do(...)` runs the body at most once. Only the first
   non-nil error is captured; later errors are dropped. The captured error
   is also propagated as the cancellation cause.

### 1.6 `TryGo`

```go
// errgroup.go:92
func (g *Group) TryGo(f func() error) bool {
    if g.sem != nil {
        select {
        case g.sem <- token{}:
            // got a slot
        default:
            return false
        }
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
    return true
}
```

`TryGo` is `Go` with a non-blocking semaphore. If the slot is unavailable,
return `false` and *do not* schedule the goroutine. With no limit set, the
`select` is skipped, and `TryGo` is identical to `Go` (always returns
`true`).

Use cases:

- **Load shedding.** Producer wants to drop work rather than block when
  workers are saturated.
- **Speculative work.** Try to do an optional task; if the pool is busy,
  skip it.

### 1.7 `SetLimit`

```go
// errgroup.go:113
func (g *Group) SetLimit(n int) {
    if n < 0 {
        g.sem = nil
        return
    }
    if len(g.sem) != 0 {
        panic(fmt.Errorf("errgroup: modify limit while %d goroutines in the group are still active", len(g.sem)))
    }
    g.sem = make(chan token, n)
}
```

Three branches:

1. Negative → no limit (semaphore set to `nil`).
2. Any goroutines currently in the group? → panic. This guards against
   races on `g.sem`.
3. Otherwise → allocate a fresh buffered channel of size `n`.

The panic is deliberate, documented behaviour, and worth knowing for code
review: anywhere you see `g.SetLimit` after `g.Go`, the code is broken.

## 2. The complete API, end to end

Putting it together, a typical "real" use of `errgroup` looks like:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(runtime.GOMAXPROCS(0))

for _, item := range items {
    item := item
    g.Go(func() error {
        return processItem(gctx, item)
    })
}

if err := g.Wait(); err != nil {
    return fmt.Errorf("batch: %w", err)
}
```

What this gives you, for free:

- Bounded concurrency at GOMAXPROCS workers.
- First-error wins; later siblings see `gctx.Done()` and exit.
- `context.Cause(gctx)` after `Wait` returns the first error (or
  `context.Canceled` if the parent cancelled first).
- A single returned `error` you can wrap and surface.
- A clear scope: nothing escapes this function.

## 3. Common shapes in production code

### 3.1 Fan-out with shared result

```go
g, gctx := errgroup.WithContext(ctx)
results := make([]R, len(items))
for i, it := range items {
    i, it := i, it
    g.Go(func() error {
        r, err := work(gctx, it)
        if err != nil { return err }
        results[i] = r // distinct index per goroutine, race-free
        return nil
    })
}
if err := g.Wait(); err != nil { return nil, err }
return results, nil
```

### 3.2 Fan-out aggregated by map under a mutex

```go
g, gctx := errgroup.WithContext(ctx)
var mu sync.Mutex
out := make(map[string]int, len(items))
for _, it := range items {
    it := it
    g.Go(func() error {
        v, err := count(gctx, it)
        if err != nil { return err }
        mu.Lock()
        out[it.Key] = v
        mu.Unlock()
        return nil
    })
}
if err := g.Wait(); err != nil { return nil, err }
return out, nil
```

### 3.3 Worker pool

```go
g, gctx := errgroup.WithContext(ctx)
in := make(chan Item)

for i := 0; i < N; i++ {
    g.Go(func() error {
        for it := range in {
            if err := work(gctx, it); err != nil { return err }
        }
        return nil
    })
}

for _, it := range items {
    select {
    case in <- it:
    case <-gctx.Done():
        break
    }
}
close(in)
return g.Wait()
```

When the producer needs to bail early (because `gctx.Done()` fired), it
breaks out of the for loop, closes `in`, and `Wait` collects whatever the
workers have done so far.

### 3.4 Pipeline

```go
g, gctx := errgroup.WithContext(ctx)
ch1 := make(chan A)
ch2 := make(chan B)

g.Go(func() error { defer close(ch1); return stage1(gctx, ch1) })
g.Go(func() error { defer close(ch2); return stage2(gctx, ch1, ch2) })
g.Go(func() error { return stage3(gctx, ch2) })

return g.Wait()
```

Notice each stage `defer close`s its output channel. If a stage returns an
error, the close still fires and the downstream `for range` exits cleanly.

## 4. Why doesn't Go have structured concurrency in the language?

The Go team has discussed this several times. The headline reasons:

1. **`go` is iconic.** Removing `go` as a fire-and-forget statement, or
   adding a parallel "go expression" with a handle, would change the
   language's feel substantially.
2. **`context.Context` exists.** Cancellation propagation is already a
   built-in idiom; the team prefers libraries that build on it.
3. **Flexibility.** Real systems have daemons, supervisors, and other
   long-lived goroutines that don't fit a strictly-nested scope. A language
   feature would either have to accommodate them or force people to use
   bare `go` anyway.
4. **Libraries iterate faster than the language.** `errgroup` evolved from
   `WaitGroup + chan error` boilerplate; adding `SetLimit` and `TryGo` was
   a one-PR change in `x/sync`. Equivalent language change would have
   required a Go 2 cycle.

You can read Russ Cox's notes on this in his various Go concurrency talks
and on [research.swtch.com](https://research.swtch.com/). The experimental
`task` package (not in the standard library) sketches what a real
structured-concurrency primitive might look like:

```go
// task.go — experimental, not standard
package task

type Scope struct { /* ... */ }

func Run(parent context.Context, fn func(*Scope) error) error
func (s *Scope) Spawn(fn func(context.Context) error)
```

`task.Run` is block-structured: you cannot return from the surrounding
function without children finishing. This is exactly what `errgroup`
*almost* gives you — the only thing missing is the language-level guarantee.

## 5. Cross-language framing

Looking at other languages clarifies what Go is and isn't doing.

### 5.1 Kotlin: `coroutineScope`

```kotlin
suspend fun loadAll(): User {
    return coroutineScope {
        val name  = async { fetchName() }
        val posts = async { fetchPosts() }
        User(name.await(), posts.await())
    }
}
```

`coroutineScope { ... }` is a suspend builder that:

- Spawns a new coroutine scope.
- Each `async { ... }` creates a child coroutine.
- The block does not return until every child has finished.
- If any child throws, all siblings are cancelled and the exception is
  rethrown from the block.

The Go equivalent in spirit:

```go
func loadAll(ctx context.Context) (User, error) {
    g, gctx := errgroup.WithContext(ctx)
    var name string
    var posts []Post

    g.Go(func() error {
        var err error
        name, err = fetchName(gctx)
        return err
    })
    g.Go(func() error {
        var err error
        posts, err = fetchPosts(gctx)
        return err
    })
    if err := g.Wait(); err != nil { return User{}, err }
    return User{name, posts}, nil
}
```

Same shape; Kotlin's compiler enforces it.

### 5.2 Swift: `async let` and `TaskGroup`

```swift
func loadAll() async throws -> User {
    async let name  = fetchName()
    async let posts = fetchPosts()
    return try await User(name, posts)
}
```

`async let` is bound to the enclosing function scope. When the function
returns, both `async let` children are guaranteed complete.

For dynamic fan-out:

```swift
try await withThrowingTaskGroup(of: Post.self) { group in
    for id in ids {
        group.addTask { try await fetchPost(id) }
    }
    for try await post in group { results.append(post) }
}
```

`withThrowingTaskGroup` is Swift's `errgroup.WithContext` — and again, the
compiler enforces that the scope outlives its children.

### 5.3 Python: Trio's `nursery`

```python
import trio

async def main():
    async with trio.open_nursery() as nursery:
        nursery.start_soon(child, 1)
        nursery.start_soon(child, 2)
    # outside the `async with` block, both children are guaranteed done.
```

Trio's design memo "Notes on structured concurrency, or: Go statement
considered harmful" by Nathaniel J. Smith is the canonical exposition of
the entire concept. The title is a direct callback to Dijkstra's "Go To
Statement Considered Harmful" — the argument being that fire-and-forget
goroutines/threads/tasks have the same control-flow pathology as goto.

### 5.4 The pattern

All three of Kotlin, Swift, and Trio enforce structured concurrency at the
language or library level *with compiler support*. Go's `errgroup` gives
you the same building blocks but without the enforcement. The result:

- Go's structured concurrency is by *convention*.
- Reviewers must check that every `go` has an owner.
- Tests must use `goleak` (or similar) to catch violations.

This isn't a bad trade — it keeps Go simple and lets libraries iterate —
but it means responsibility shifts to humans.

## 6. The Russ Cox `task` experiment

In talks Russ Cox has sketched what a *language-level* structured-concurrency
primitive might look like. The shape:

```go
// hypothetical syntax — not real Go
task ctx := parent {
    spawn fetchA(ctx)
    spawn fetchB(ctx)
} // block does not exit until both spawns complete
```

The compiler would enforce:

1. Every `spawn` inside a `task` block must complete (or be cancelled)
   before the block exits.
2. Cancellation of the parent context cascades into the `task` block.
3. The first error short-circuits the block, cancels siblings, and
   propagates out.

`errgroup.WithContext` already gives you (2) and (3). What it cannot
enforce is (1) — there is no way for the compiler to know whether you
called `Wait` or not. That is the one structural gap.

Will Go ever ship this? Unclear. The Go team has consistently preferred
library solutions. The most likely path is that `errgroup` keeps gaining
features, that `task` ships in `x/sync` or similar, and that the language
itself does not change.

## 7. Diagnosing leaks with `goleak`

A practical companion to `errgroup` is `go.uber.org/goleak`. Add this to
`TestMain`:

```go
package mypkg

import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`goleak` snapshots the goroutine stacks at test start, runs the tests, and
fails if any extra goroutines are still alive at the end. Forgotten
`g.Wait()`, daemons that never stopped, channels that hung — `goleak`
catches them all.

Used together, `errgroup` + `goleak` give you nearly the same guarantees as
language-level structured concurrency:

- `errgroup` makes it *easy* to write structured code.
- `goleak` makes it *visible* when you forget.

## 8. Patterns to avoid

Even with `errgroup`, a few patterns are worth flagging.

### 8.1 Group stored in a struct field

```go
type Worker struct {
    g *errgroup.Group
}
```

Tempting, but smells. A group is a *scope object*; it should live in one
function from creation to `Wait`. Storing it in a struct invites someone
else to call `Go` later, after `Wait` has already returned, or to never
call `Wait` at all. Lifecycle becomes implicit.

If you need long-lived worker structure, use a different shape: an
internal `sync.WaitGroup` plus an explicit `Stop()` method.

### 8.2 Re-using a group across batches

```go
var g errgroup.Group
for batch := range batches {
    for _, item := range batch {
        g.Go(func() error { return process(item) })
    }
    if err := g.Wait(); err != nil { return err }
}
```

`Wait` is one-shot. Re-using the group after `Wait` is undefined. Make a
new `errgroup.Group` per batch:

```go
for batch := range batches {
    g, gctx := errgroup.WithContext(ctx)
    for _, item := range batch {
        item := item
        g.Go(func() error { return process(gctx, item) })
    }
    if err := g.Wait(); err != nil { return err }
}
```

### 8.3 `Wait` without checking the error

```go
g.Wait() // throws away the error
```

The whole point of `errgroup` is to capture the first error. Discarding it
is almost always a bug. Even when you don't expect errors, surface them in
logs.

## 9. Setting the limit dynamically

A common need: tune concurrency at startup from configuration.

```go
func Run(cfg Config, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    if cfg.MaxConcurrency > 0 {
        g.SetLimit(cfg.MaxConcurrency)
    }
    for _, it := range items {
        it := it
        g.Go(func() error { return process(gctx, it) })
    }
    return g.Wait()
}
```

What you cannot do:

- Change the limit mid-flight. `SetLimit` panics if any goroutines are
  active.
- Read the current limit. There is no getter.

If you need adaptive concurrency, use a semaphore (e.g.
`golang.org/x/sync/semaphore`) explicitly, not `SetLimit`.

## 10. When to reach for something other than `errgroup`

`errgroup` is the right answer most of the time, but not always.

- **You need all errors, not just the first.** Use `errors.Join` over a
  slice you populate yourself.
- **You need long-lived workers that restart on failure.** Build a
  supervisor (covered on the [Professional](../professional/) page).
- **You need to wait for *some* tasks while letting others continue.** Use
  multiple groups or a custom coordinator. One group is not the right
  shape.
- **You need to dynamically grow or shrink concurrency.** Use a
  `golang.org/x/sync/semaphore.Weighted` directly.

In every case, the goal is the same: bind goroutine lifetimes to a clearly
named owner. `errgroup` is the easiest path; other primitives are useful
when its constraints don't fit.

## 11. Recap

- The `errgroup` source is short, readable, and worth studying directly.
- The API surface is small: `WithContext`, `Go`, `TryGo`, `SetLimit`,
  `Wait`. Each maps to a clear semantic.
- Production patterns: fan-out with shared slice, aggregated with mutex,
  worker pool, pipeline.
- Go's lack of language-level structured concurrency is by design; the
  team prefers libraries.
- Kotlin, Swift, and Trio bake the concept in; reading their docs is a
  fast way to internalise the idea.
- Pair `errgroup` with `goleak` in tests to catch the bugs the language
  cannot prevent.

The [Senior](../senior/) page builds on this to discuss designing
*your own* structured-concurrency scope, cancellation propagation in
detail, and the rejected language proposals.

## 12. Implementation details worth understanding

A few low-level details of `errgroup` repay study; they explain behaviour
you'll otherwise find mysterious.

### 12.1 Why `sync.Once` rather than a mutex?

The error-capture path uses `errOnce sync.Once`. This means:

- Only the first goroutine to error pays the cost of acquiring the once.
- Subsequent goroutines that error pay only an atomic read of the once's
  done flag.
- There is no contention between successful goroutines and the once.

A `sync.Mutex` alternative would force every erroring goroutine to
acquire the same lock. For groups with hundreds of children where most
succeed but a few fail, the once is meaningfully faster.

### 12.2 Why `context.WithCancelCause` rather than `context.WithCancel`?

Before `WithCancelCause` (added in Go 1.20), `errgroup` used plain
`WithCancel`. The captured error was returned only from `Wait`. Callers
who passed `gctx` to children could not, after cancellation, recover
*why* it was cancelled — they only knew it was canceled.

With `WithCancelCause`, the captured error is also installed as the
cancellation cause. Children that see `gctx.Done()` and check
`context.Cause(gctx)` can distinguish "parent deadline expired" from
"sibling errgroup task failed with X". This is a small but valuable
improvement for diagnostics.

### 12.3 Why does `Wait` always call cancel, even on success?

```go
func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)  // cancel even if g.err == nil
    }
    return g.err
}
```

The reason: code paths that received `gctx` and have not yet returned
might still hold it. If `Wait` returned without cancelling, those code
paths would continue to think `gctx` is live. By cancelling
unconditionally, `errgroup` makes the contract explicit: "after `Wait`
returns, the derived context is dead." This catches "I used `gctx` after
the group finished" bugs.

### 12.4 Why is `Add` before `go`?

```go
g.wg.Add(1)
go func() {
    defer g.done()
    ...
}()
```

The `Add` is synchronous in the launcher. If you wrote it inside the
goroutine:

```go
go func() {
    g.wg.Add(1) // wrong
    defer g.done()
    ...
}()
```

…then `Wait` (in a different goroutine) could race the goroutine: `Wait`
sees the counter at zero, returns, and the spawned goroutine increments
the counter *after* `Wait` already exited. This is the classic
"wait-group `Add` after `Wait`" bug. `errgroup` does it right; you should
too if you ever roll your own.

## 13. Comparing to `sourcegraph/conc`

Beyond `errgroup`, the most popular structured-concurrency library in Go
today is `github.com/sourcegraph/conc`. It addresses two gaps in
`errgroup`:

1. **Typed results.** `conc.NewIterator[T]` and `conc.NewPool` track
   results of arbitrary types.
2. **Mandatory panic recovery.** `conc.Pool` recovers panics by default
   and surfaces them through the returned error.

Quick comparison:

```go
// errgroup
g, gctx := errgroup.WithContext(ctx)
results := make([]int, len(items))
for i, it := range items {
    i, it := i, it
    g.Go(func() error {
        r, err := process(gctx, it)
        if err != nil { return err }
        results[i] = r
        return nil
    })
}
err := g.Wait()
```

```go
// conc
results, err := conc.NewIterator[int]().
    Map(items, func(it Item) (int, error) {
        return process(ctx, it)
    })
```

`conc` reads like a high-level streaming API; `errgroup` is closer to the
metal. For typed map/reduce-style fan-out, `conc` is shorter. For mixed
heterogeneous tasks (fetch A, fetch B, do C where each is different),
`errgroup` remains more natural.

Both are valid choices. Pick whichever your team uses consistently. The
core principle — bounded scope, owned goroutines — is the same.

## 14. Composing groups

Sometimes you want a tree of groups: an outer group with a few children,
each of which spawns its own fan-out. The composition is straightforward
but worth practising.

```go
func loadDashboard(ctx context.Context, userID string) (Dashboard, error) {
    outer, octx := errgroup.WithContext(ctx)
    var (
        user  User
        posts []Post
        feed  []FeedItem
    )

    outer.Go(func() error {
        var err error
        user, err = fetchUser(octx, userID)
        return err
    })

    outer.Go(func() error {
        var err error
        posts, err = fetchPosts(octx, userID)
        return err
    })

    outer.Go(func() error {
        // Inner group: feed is composed of three subqueries.
        inner, ictx := errgroup.WithContext(octx)
        var (
            a, b, c []FeedItem
        )
        inner.Go(func() error { var e error; a, e = feedA(ictx); return e })
        inner.Go(func() error { var e error; b, e = feedB(ictx); return e })
        inner.Go(func() error { var e error; c, e = feedC(ictx); return e })
        if err := inner.Wait(); err != nil { return err }
        feed = append(append(a, b...), c...)
        return nil
    })

    if err := outer.Wait(); err != nil { return Dashboard{}, err }
    return Dashboard{user, posts, feed}, nil
}
```

The cancellation graph here is:

```text
ctx → outer.octx → inner.ictx
```

A failure in the inner group cancels `ictx` and propagates as the third
outer task's error. That error cancels `octx`, which cancels the
remaining outer siblings. A failure in the first or second outer task
cancels `octx`, which cancels `ictx` (since `ictx` is derived from
`octx`), which cancels the inner siblings.

Composition Just Works because contexts compose. This is the killer
property of building structured concurrency on `context.Context`.

## 15. Result aggregation patterns

`errgroup` returns one error and (via cancellation cause) one error.
What if you need *all* errors?

### 15.1 Slice plus mutex

```go
g, gctx := errgroup.WithContext(ctx)
var (
    mu   sync.Mutex
    errs []error
)
for _, it := range items {
    it := it
    g.Go(func() error {
        if err := process(gctx, it); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
            // return nil so we don't cancel siblings
        }
        return nil
    })
}
_ = g.Wait()
if len(errs) > 0 {
    return errors.Join(errs...)
}
```

Key trick: each goroutine *returns nil* even when it has an error. That
way `errgroup` does not cancel siblings on the first failure. Useful when
the goal is to *do everything regardless* (e.g. batch-delete a list of
files, reporting which deletions failed) rather than fail fast.

### 15.2 `errors.Join` directly

If you want the more standard "fail on any error, but collect them all
into one":

```go
g, _ := errgroup.WithContext(ctx)
var (
    mu   sync.Mutex
    errs []error
)
for _, it := range items {
    it := it
    g.Go(func() error {
        err := process(ctx, it)
        if err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
        return err // propagate, so siblings get cancelled
    })
}
_ = g.Wait()
return errors.Join(errs...)
```

Now the first failure cancels siblings (good) and you still get a list of
errors that did occur (also good).

### 15.3 Result type with embedded error

```go
type result struct {
    item Item
    out  Out
    err  error
}

func processAll(ctx context.Context, items []Item) []result {
    g, gctx := errgroup.WithContext(ctx)
    results := make([]result, len(items))
    for i, it := range items {
        i, it := i, it
        g.Go(func() error {
            out, err := process(gctx, it)
            results[i] = result{item: it, out: out, err: err}
            return nil // never propagate
        })
    }
    _ = g.Wait()
    return results
}
```

The "every result, success or failure, in the same slot" pattern. Useful
when downstream code wants to act on every item regardless. Sibling
cancellation is intentionally disabled because every result is valuable.

Pick the pattern that matches your semantic. Don't try to bend
`errgroup`'s single-error API to do something it doesn't fit.

## 16. Trade-offs of `errgroup` versus channels

A frequent question: should I use `errgroup` or write a channel-based
pipeline? Both can express fan-out + collect. Some heuristics:

| Concern | `errgroup` | Channels |
|---|---|---|
| Fan-out, parallel collect, fail-fast | Best | Awkward |
| Streaming results to a consumer | Awkward | Best |
| Need to bound concurrency | `SetLimit` | Worker pool + buffered channel |
| Need all results, not first error | Patterns above | Natural |
| Need typed result aggregation | Manual capture | `for r := range out` |
| Need backpressure | Limited (only via SetLimit) | Natural |

Channels really shine when you have a *flow* of results that something
else is consuming. `errgroup` shines when you have a *batch* of
independent tasks that produces a final answer.

Many real systems combine both: an `errgroup` of producers that all push
into a shared channel, and a `for range` consumer outside the group.

```go
g, gctx := errgroup.WithContext(ctx)
out := make(chan Result)

// Producers
for _, src := range sources {
    src := src
    g.Go(func() error { return src.Stream(gctx, out) })
}

// Closer: close `out` after all producers are done.
go func() {
    _ = g.Wait()
    close(out)
}()

// Consumer
for r := range out {
    handle(r)
}
```

Notice the small dance to close `out` exactly once after every producer
has finished. A bare `g.Wait()` followed by `close(out)` inside the
caller would also work — but the goroutine version lets the consumer be
the lifetime-controlling scope.

## 17. Subtleties of `SetLimit` interactions

`SetLimit` has interactions you might not anticipate.

### 17.1 `SetLimit(0)`

A limit of zero prevents *any* `Go` from running.

```go
var g errgroup.Group
g.SetLimit(0)
g.Go(func() error { return nil }) // blocks forever
```

`g.Go` will block waiting for a slot that will never free. Use case:
deliberately disabling work submission (rare but useful in tests).

### 17.2 `SetLimit(-1)` after a previous limit

Setting a negative limit removes the limit:

```go
var g errgroup.Group
g.SetLimit(8)
// ... use the group ...
g.SetLimit(-1) // remove limit (only safe when no active goroutines)
```

This is the only way to "uncap" a group. Calling it with active
goroutines panics.

### 17.3 `TryGo` semantics with no limit

If you never call `SetLimit`, `TryGo` and `Go` behave identically (both
always succeed). `TryGo` is meaningful only in combination with
`SetLimit`.

### 17.4 Interaction with `WithContext`

`SetLimit` and `WithContext` are independent. You can use them together:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(8)
```

There is no `WithContextLimit` shorthand; you just call both. Order
matters only for `SetLimit` vs `Go` — `SetLimit` must precede the first
`Go`.

## 18. Reading errgroup tests for ideas

The `x/sync/errgroup` tests are short and worth reading directly. They
cover:

- Basic happy path (every goroutine returns `nil`).
- First-error capture (mix of `nil` and non-`nil`).
- Cancellation propagation (`WithContext` returns the cause).
- `SetLimit` blocking semantics.
- `SetLimit` panic when called with active goroutines.

Reading the tests is the fastest way to understand subtle semantic
points. The tests are also small enough to lift the patterns into your
own code.

## 19. When `errgroup` is *not* enough

Honest list of situations where you should reach for something else.

- **Long-running pipelines with backpressure.** Use channels with
  bounded buffers; the channel send becomes the backpressure signal.
- **Producer-consumer with different cardinality.** N producers and M
  consumers: model it as channels, not goroups.
- **Persistent worker pool.** Workers should live across many batches.
  `errgroup` is one-shot. Use `sync.WaitGroup` + a dispatch channel.
- **Selective cancellation.** "Cancel just task A but not B and C."
  `errgroup` cancels the entire group. Use per-task `context.WithCancel`.
- **Fault tolerance with restarts.** `errgroup` does not restart failed
  goroutines. Build a supervisor (see [Professional](../professional/)).
- **Streaming with ordering guarantees.** Channels with one consumer
  give natural ordering. `errgroup`'s `Go` order does not imply
  goroutine-start order.

None of these are arguments against `errgroup`; they're arguments for
picking the right primitive. Most code is fan-out batch work, and
`errgroup` is the right answer.

## 20. A worked example: parallel checksum

A small, complete program that uses everything covered: `WithContext`,
`SetLimit`, `goleak` in tests, and proper context propagation.

```go
// pkg/checksum/checksum.go
package checksum

import (
    "context"
    "crypto/sha256"
    "fmt"
    "io"
    "os"
    "runtime"

    "golang.org/x/sync/errgroup"
)

type Result struct {
    Path string
    Hash string
}

func All(ctx context.Context, paths []string) ([]Result, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(runtime.GOMAXPROCS(0))

    results := make([]Result, len(paths))
    for i, p := range paths {
        i, p := i, p
        g.Go(func() error {
            h, err := hashFile(gctx, p)
            if err != nil {
                return fmt.Errorf("hash %s: %w", p, err)
            }
            results[i] = Result{Path: p, Hash: h}
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return results, nil
}

func hashFile(ctx context.Context, path string) (string, error) {
    f, err := os.Open(path)
    if err != nil { return "", err }
    defer f.Close()
    h := sha256.New()
    buf := make([]byte, 32*1024)
    for {
        if err := ctx.Err(); err != nil { return "", err }
        n, err := f.Read(buf)
        if n > 0 { h.Write(buf[:n]) }
        if err == io.EOF { break }
        if err != nil { return "", err }
    }
    return fmt.Sprintf("%x", h.Sum(nil)), nil
}
```

```go
// pkg/checksum/checksum_test.go
package checksum

import (
    "context"
    "os"
    "path/filepath"
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}

func TestAll(t *testing.T) {
    dir := t.TempDir()
    paths := []string{}
    for i := 0; i < 8; i++ {
        p := filepath.Join(dir, fmt.Sprintf("f%d", i))
        if err := os.WriteFile(p, []byte("hello"), 0644); err != nil {
            t.Fatal(err)
        }
        paths = append(paths, p)
    }
    results, err := All(context.Background(), paths)
    if err != nil { t.Fatal(err) }
    if len(results) != len(paths) { t.Fatalf("got %d results, want %d", len(results), len(paths)) }
    for _, r := range results {
        if r.Hash == "" { t.Errorf("empty hash for %s", r.Path) }
    }
}
```

Properties to notice:

- Concurrency is bounded by `GOMAXPROCS`.
- Each file's reader checks `ctx.Err()` between chunks, so cancellation
  is responsive even for large files.
- `goleak.VerifyTestMain` catches any goroutine that escapes the test.
- The function returns either a complete `[]Result` or an error; no
  partial-success ambiguity.

This is the shape of production code. You can drop it into a real
project as-is.

## 21. Recap

- The `errgroup` source is short, readable, and worth studying directly.
- The API surface is small but each piece has subtle interactions
  (`SetLimit` with active goroutines, `TryGo` without a limit,
  `WithContext` cause propagation).
- Cross-language framing helps: Kotlin, Swift, Trio bake structured
  concurrency in at the language level. Go does it by library and
  convention.
- Composition is natural because contexts compose. Outer and inner groups
  chain via the context graph.
- For "all results" patterns, drop the first-error semantic by returning
  `nil` and aggregating manually.
- `errgroup` is one tool among several; channels for streaming,
  `WaitGroup` for daemons, custom supervisors for restartable workers.

The [Senior](../senior/) page picks up the thread for designing your own
scope-shaped abstractions, the deeper cancellation model, and the
language proposals that came close to landing.

## 22. A taxonomy of "structured" concurrency in different ecosystems

Putting Go in context, the design space for structured concurrency
breaks roughly into four levels.

### Level 0 — no language or library support

Languages like C, where threads are raw OS primitives. The programmer
must manually pair every `pthread_create` with `pthread_join` and handle
errors via shared state. Most production C codebases evolve their own
informal scope conventions.

### Level 1 — library convention

Go's current state. The language provides `go`, channels, contexts.
Structured concurrency emerges from libraries (`errgroup`,
`sourcegraph/conc`) plus discipline (`goleak` in tests, lint rules).
Pro: maximum flexibility. Con: enforcement is on humans.

### Level 2 — language-level scope, opt-in

C# `Task.WhenAll`, JavaScript `Promise.all`. The language has a
first-class concept of a "completion future" and tools that wait for
groups of them. Better than Level 1 because forgetting to await a
promise typically triggers a lint warning. Still possible to ignore the
return value and leak.

### Level 3 — language-enforced structured concurrency

Kotlin's `coroutineScope`, Swift's structured concurrency, Trio's
nursery. The compiler/runtime refuses to let a child outlive its parent
scope. Pro: leaks become impossible by construction. Con: less
flexibility — daemons need special escape hatches.

Go sits firmly at Level 1, with no expectation of moving up. The reason
this isn't a tragedy: Level 1 with consistent style + `goleak` covers
~95% of what Level 3 would buy you. The last 5% is the case where you
forgot to write the test.

## 23. Why `errgroup` chose its specific semantics

It's worth asking *why* `errgroup` works the way it does, not just *how*.

### 23.1 Why "first error wins"?

You could imagine a variant that returned all errors. The Go authors
chose first-error because:

- Most real fan-out tasks share a fate. If one fails, the others are
  cancelled and their errors are downstream consequences.
- A list of errors is harder to handle. Callers must inspect, filter,
  and decide.
- The first error is the *causal* error; later cancellation errors
  are noise.

When you really need all errors, the slice+mutex pattern above is one
clean way to do it. The default is the common case.

### 23.2 Why cancel the derived context only on error, not on `Wait` return?

Actually `errgroup` *does* cancel on `Wait` return unconditionally, as
we saw in section 12.3. That's the second-best moment to cancel: the
first moment is "first error", the last moment is "all done". Both are
covered.

### 23.3 Why no built-in panic recovery?

The Go team has consistently said panics indicate programmer bugs.
Recovering panics by default would mask those bugs. Libraries that need
to keep the process alive in the face of bad inputs (HTTP handlers,
RPC servers) handle this at the request boundary, not inside
`errgroup`.

That said, production code often wraps `errgroup` with panic recovery
for defense in depth — see the [Professional](../professional/) page.

### 23.4 Why `SetLimit` rather than a constructor?

You could imagine `errgroup.WithLimit(ctx, n)` rather than a separate
method. The current API chose separation because:

- The limit is optional; most uses don't need one.
- Setting via a method keeps the constructor signature simple.
- `SetLimit(-1)` to unlimit a group is symmetric and discoverable.

It's a minor design choice, but it shows the team's preference for
composable methods over multi-purpose constructors.

## 24. Real-world examples from the Go ecosystem

A handful of well-known Go projects use `errgroup` in instructive ways.

### 24.1 Kubernetes

The kube-scheduler uses `errgroup` extensively for fan-out scoring of
pods against nodes. Each plugin's `Score` call runs in a goroutine; the
group bounds concurrency to a per-pod limit. First error fails the
scheduling attempt; siblings cancel.

### 24.2 etcd

`etcd`'s `raftpb`-handling code uses `errgroup` for parallel
broadcast-and-collect of votes. The pattern: one `Go` per peer, all
share the same context, first error cancels the broadcast.

### 24.3 Prometheus

Prometheus's `tsdb` package uses `errgroup` for parallel index lookups
and compaction tasks. They typically combine `SetLimit` with the worker
pool pattern: a single producer goroutine sends work onto a channel;
multiple `Go`-launched consumers drain it.

### 24.4 Docker

Docker's `containerd` shim layer uses `errgroup` to parallelise
container-lifecycle hooks (pre-start, post-start, pre-stop, post-stop).
Each hook is fan-out; first failure cancels the rest and fails the
container.

In all four cases the shape is the same: outer function creates an
`errgroup.WithContext`, fans out, waits, surfaces error. This is what
"the Go way of structured concurrency" looks like at scale.

## 25. Final mental model

Here is the model to carry into the [Senior](../senior/) page.

```text
    parent context
         │
         │  errgroup.WithContext
         ▼
    derived context (gctx)
         │
         ├── Go(f1) ── goroutine 1 ── returns err1 ─┐
         ├── Go(f2) ── goroutine 2 ── returns err2 ─┤── errOnce: first wins
         ├── Go(f3) ── goroutine 3 ── returns nil ──┘
         │
         ▼
       Wait() ── blocks on WaitGroup ── returns first error
              ── always cancel(g.err) ── gctx becomes dead
```

This single diagram explains every observable behaviour of `errgroup`
once you internalise it.

Now go read [Senior](../senior/) — it builds on this model to discuss
designing your own scope abstractions, the deeper cancellation model,
and the proposals that almost gave Go language-level structured
concurrency.

## 26. Aside: the `errgroup` mistakes I see in code reviews

A short, opinionated list. None of these are deep — but they are the
mistakes that show up most often.

### 26.1 Bare `ctx` instead of `gctx`

```go
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error { return fetch(ctx, ...) }) // wrong: uses outer ctx
```

The child uses the outer `ctx`. Sibling cancellation does not propagate.
This bug is invisible until one sibling fails and you wonder why the
others didn't cancel.

### 26.2 Returning unwrapped errors from `Wait`

```go
return g.Wait()
```

The first error from a child is returned bare. Callers higher up can't
tell *which* child errored or why. Wrap it:

```go
if err := g.Wait(); err != nil {
    return fmt.Errorf("loadDashboard: %w", err)
}
```

Now the stack trace tells a story.

### 26.3 Reading a result variable inside a `Go` callback

```go
var u User
g.Go(func() error { u, _ = fetchUser(ctx); return nil })
g.Go(func() error {
    if u.ID != "" { ... } // wrong: races with the first Go
    return nil
})
```

Reading `u` from inside a sibling race-detects fail. The boundary rule
says shared variables are read *only after `Wait`*.

### 26.4 Using a single shared `errgroup` across requests

```go
type Server struct {
    g *errgroup.Group
}

func (s *Server) Handle(...) {
    s.g.Go(...)
}
```

Tempting, but wrong. The group is supposed to be scoped to a single
fan-out. Sharing it across requests means nobody ever calls `Wait`, and
the group becomes a glorified `WaitGroup` with no exit. Create a fresh
group per request.

### 26.5 Forgetting to return the captured error from inner closures

```go
g.Go(func() error {
    v, err := fetchUser(gctx)
    if err != nil { /* forgot to return err */ }
    user = v
    return nil
})
```

The error is logged or swallowed. The group thinks the child succeeded
and `Wait` returns `nil`. Always return the error.

### 26.6 Sleeping without context-awareness

```go
g.Go(func() error {
    time.Sleep(10 * time.Second) // ignores gctx
    return nil
})
```

If a sibling fails, this goroutine still sleeps for 10 seconds.
`g.Wait()` blocks that long. Use:

```go
select {
case <-time.After(10 * time.Second):
case <-gctx.Done():
    return gctx.Err()
}
```

These six mistakes account for most of the `errgroup` bugs you'll see in
real code. Keep them in mind as you review.

## 27. Closing thoughts for the Middle reader

You should now be able to:

- Read the `errgroup.go` source and explain what each section does.
- Choose between `Go`, `TryGo`, `SetLimit` based on the workload.
- Recognise the four common shapes: fan-out, loop fan-out, pipeline,
  worker pool.
- Compose groups when you need nested fan-out.
- Pick `errgroup` versus channels based on whether the work is batch or
  streaming.
- Explain why Go doesn't have language-level structured concurrency,
  and what other languages (Kotlin, Swift, Trio) chose instead.
- Diagnose the six most common `errgroup` mistakes in code review.

That's about as much as a middle-level engineer needs to ship Go
services with confidence. The [Senior](../senior/) page goes further:
how to design your own scope-shaped abstractions, the cancellation
versus completion distinction, and the proposals that almost gave Go
language-level structured concurrency. Read on when you're ready to
design rather than consume.

## 28. Quick reference card

For your wallet:

```go
// Default fan-out
g, gctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item // pre-1.22
    g.Go(func() error { return process(gctx, item) })
}
if err := g.Wait(); err != nil { return err }

// Bounded fan-out
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(N) // before any Go
for _, item := range items {
    item := item
    g.Go(func() error { return process(gctx, item) })
}
if err := g.Wait(); err != nil { return err }

// Load-shed fan-out
g, _ := errgroup.WithContext(ctx)
g.SetLimit(N)
for _, item := range items {
    item := item
    if !g.TryGo(func() error { return process(ctx, item) }) {
        dropped++
    }
}
if err := g.Wait(); err != nil { return err }
```

Three patterns, three lines of variation. Memorise them and you'll
write structured Go code without thinking.

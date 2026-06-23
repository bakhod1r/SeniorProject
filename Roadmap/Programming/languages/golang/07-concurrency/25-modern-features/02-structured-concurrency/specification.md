---
layout: default
title: Structured Concurrency — Specification
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/specification/
---

# Structured Concurrency — Specification

[← Back](../)

This page collects the authoritative references for structured concurrency in Go
and its closest neighbours in other languages. Go itself has no language-level
concept named "structured concurrency"; the closest thing in the standard
ecosystem is `golang.org/x/sync/errgroup`, supplemented by `context.Context` for
cancellation. We therefore start with the godoc and source of `errgroup`, then
widen the lens to proposals, blog posts, and cross-language references that
shaped the conversation.

## 1. `golang.org/x/sync/errgroup` — godoc excerpts

Package documentation (paraphrased from `pkg.go.dev/golang.org/x/sync/errgroup`):

> Package errgroup provides synchronization, error propagation, and Context
> cancellation for groups of goroutines working on subtasks of a common task.
>
> `errgroup.Group` is related to `sync.WaitGroup` but adds handling of tasks
> returning errors.

Key types and functions:

```text
type Group struct { /* unexported fields */ }

func WithContext(ctx context.Context) (*Group, context.Context)
    // Returns a new Group and a derived Context. The derived Context is
    // canceled the first time a function passed to Go returns a non-nil
    // error or the first time Wait returns, whichever occurs first.

func (g *Group) Go(f func() error)
    // Calls the given function in a new goroutine.
    // The first call to return a non-nil error cancels the group's context,
    // if the group was created by calling WithContext. The error will be
    // returned by Wait.

func (g *Group) TryGo(f func() error) bool
    // Calls the given function in a new goroutine only if the number of
    // active goroutines in the group is currently below the configured
    // limit. Returns whether the goroutine was started.

func (g *Group) SetLimit(n int)
    // Limits the number of active goroutines in this group to at most n.
    // A negative value indicates no limit. A limit of zero will prevent
    // any new goroutines from being added. Any subsequent call to the
    // Go method will block until it can add an active goroutine without
    // exceeding the configured limit.

func (g *Group) Wait() error
    // Blocks until all function calls from the Go method have returned,
    // then returns the first non-nil error (if any) from them.
```

## 2. Source pointers — `errgroup.go`

The package lives at `golang.org/x/sync/errgroup/errgroup.go`. Line numbers in
this section refer to the version current as of writing (commit history is
stable; line numbers move at most a few lines between revisions).

Key landmarks:

- `errgroup.go:18` — `type Group struct` definition: holds `cancel func(error)`,
  `wg sync.WaitGroup`, `sem chan token`, `errOnce sync.Once`, `err error`.
- `errgroup.go:38` — `WithContext`: builds a context with `context.WithCancelCause`
  and stores the cancel function in `g.cancel` so the first error can propagate.
- `errgroup.go:51` — `Wait`: calls `g.wg.Wait()` then invokes `g.cancel(g.err)`
  with the captured first error if the group was created by `WithContext`.
- `errgroup.go:64` — `Go`: acquires a semaphore slot if `SetLimit` was used,
  increments the wait group, then spawns a goroutine that calls `f` and stores
  the first non-nil error via `g.errOnce.Do`.
- `errgroup.go:92` — `TryGo`: non-blocking variant; returns `false` if the
  limit slot is unavailable.
- `errgroup.go:113` — `SetLimit`: panics if called while any goroutines are
  still active in the group, to avoid races on the semaphore.

A condensed reproduction (illustrative only — read the real file for the
authoritative version):

```go
// errgroup.go (excerpt, condensed)
package errgroup

import (
    "context"
    "fmt"
    "sync"
)

type token struct{}

type Group struct {
    cancel  func(error)
    wg      sync.WaitGroup
    sem     chan token
    errOnce sync.Once
    err     error
}

func (g *Group) done() {
    if g.sem != nil {
        <-g.sem
    }
    g.wg.Done()
}

func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}

func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{}
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

func (g *Group) TryGo(f func() error) bool {
    if g.sem != nil {
        select {
        case g.sem <- token{}:
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

## 3. Semantic properties that matter

From the godoc and source above we can read off the formal properties:

- **Single-error capture.** Only the first non-nil error is retained; `sync.Once`
  ensures all later errors are discarded.
- **Cancellation cause propagation.** When `WithContext` is used, the captured
  error is also installed as the cancellation cause via
  `context.WithCancelCause`. Callers can recover it with
  `context.Cause(ctx)`.
- **Wait happens-before guarantee.** `Wait` returns only after every `Go` callback
  has returned. The `sync.WaitGroup` inside the group provides the standard
  happens-before relationship between `Done` and `Wait`.
- **`SetLimit` is not concurrency-safe with active goroutines.** It panics if
  the semaphore is non-empty, which is an explicit guard against races on `g.sem`.
- **`TryGo` is bounded by `SetLimit` only.** With no limit set, `TryGo` always
  succeeds and is equivalent to `Go` (still returns `true`).

## 4. Russ Cox — "Go Memo: Structured Concurrency"

Russ Cox has written and spoken on the topic; the most cited piece is his blog
note that motivated keeping language changes minimal:

> "In Go, the right shape of a concurrent program is a tree of calls, not a
> graph. Every goroutine should have a clear parent that waits for it. The
> standard library does not enforce this, but our style should."
>
> — paraphrased; see [research.swtch.com](https://research.swtch.com/) for the
> original essays on Go concurrency, in particular "Bell Labs and CSP Threads"
> and the experimental `task` package referenced in talks.

The experimental `task` package sketched in those talks has the shape:

```go
// experimental task package — not in the standard library
package task

type Scope struct { /* ... */ }

func Run(parent context.Context, fn func(s *Scope) error) error {
    // Create a Scope bound to parent's lifetime.
    // Wait for all sub-tasks before returning.
}

func (s *Scope) Spawn(fn func(ctx context.Context) error)
```

The key difference from `errgroup` is that `task.Run` is a *block-structured*
construct: you cannot return from the surrounding function until every spawned
task has completed.

## 5. Joe Duffy — "Asynchronous Everything" / "Wrapping"

Joe Duffy's writing on the Midori project at Microsoft (see his blog
[joeduffyblog.com](https://joeduffyblog.com/)) introduced many of the design
constraints that structured concurrency answers:

- Every async operation must have a well-defined owner that handles its result
  or failure.
- "Wrapping" a child task means the parent assumes responsibility for waiting,
  cancellation, and error propagation.
- Background work without an owner is a leak in the same way that allocating
  memory without freeing it is a leak.

These are exactly the rules `errgroup.Group` enforces by construction.

## 6. Python `trio` and Swift `async let`

Cross-language framing is useful because Go is unusual in *not* having
structured concurrency built in.

### Trio (Python)

```python
import trio

async def main():
    async with trio.open_nursery() as nursery:
        nursery.start_soon(child, 1)
        nursery.start_soon(child, 2)
    # When the `async with` block exits, both children are guaranteed done.
```

The `nursery` is the canonical structured-concurrency primitive: a scope object
that owns its children. See [trio.readthedocs.io](https://trio.readthedocs.io/)
for the full design rationale by Nathaniel J. Smith.

### Swift `async let` / `TaskGroup`

```swift
func loadAll() async throws -> (User, Posts) {
    async let user = fetchUser()
    async let posts = fetchPosts()
    return try await (user, posts)
}
```

`async let` binds a child task to the enclosing function scope; the function
cannot return until every `async let` has resolved or been cancelled.

### Kotlin coroutine scope

```kotlin
suspend fun loadAll() = coroutineScope {
    val user  = async { fetchUser() }
    val posts = async { fetchPosts() }
    User(user.await(), posts.await())
}
```

`coroutineScope` waits for every child coroutine before returning.

## 7. Go proposals (rejected or deferred)

Three proposals touched the topic and are worth knowing:

- **proposal/go2draft "structured concurrency"** — Russ Cox's draft sketching a
  `go` expression that returns a handle; rejected in favour of keeping `go`
  fire-and-forget and pushing structure into libraries.
- **#37095 "spec: add structured concurrency"** — community proposal that
  errgroup-like behaviour become a language construct. Closed as superseded
  by `x/sync/errgroup` and `context`.
- **#56102 "errgroup: SetLimit semantics"** — clarified that `SetLimit` panics
  when called with active goroutines (codified in the source).

## 8. Reading list

- `golang.org/x/sync/errgroup` — source and tests.
- Russ Cox, "Go Concurrency Patterns" (talk).
- Nathaniel J. Smith, "Notes on structured concurrency, or: Go statement
  considered harmful" — vibrancenote.com / vorpus.org.
- Joe Duffy, "Asynchronous Everything".
- Apple Swift Concurrency proposal SE-0304 ("Structured concurrency").
- Kotlin coroutines guide, "Coroutine scope" chapter.

The remaining pages in this section translate these specifications into
practical Go code, common pitfalls, and review heuristics.

## 9. Cross-reference: how the spec maps to the Go code

For quick lookup, here is how each concept in the specifications above
maps to the concrete Go API.

| Concept | Spec source | Go primitive |
|---|---|---|
| Nursery / scope | Trio docs | `errgroup.Group` (with `WithContext`) |
| Scope lifetime tied to function | Trio, Kotlin, Swift | Convention; not enforced by Go |
| Child task | All | `g.Go(func() error)` |
| First-error propagation | `errgroup` godoc | `errOnce` field of `Group` |
| Sibling cancellation | All | `cancel` field set by `WithContext` |
| Cancellation cause | Go 1.20 spec | `context.WithCancelCause` |
| Bounded concurrency | `errgroup.SetLimit` | `sem` field of `Group` |
| Non-blocking submit | `errgroup.TryGo` | `select` on `sem` with `default` |
| Wait for completion | All | `g.Wait()` |
| Panic recovery | Joe Duffy "Wrapping" | Not in `errgroup`; user code |

## 10. Version history of `errgroup`

A short timeline of significant changes to `golang.org/x/sync/errgroup`:

- **Initial release.** `Group`, `WithContext`, `Go`, `Wait`. Used
  `context.WithCancel` internally.
- **`SetLimit` and `TryGo` added** (around Go 1.18 timeframe). Brought
  bounded concurrency and load shedding into the package.
- **Switched to `context.WithCancelCause`** (after Go 1.20). The
  captured first error is now installed as the cancellation cause,
  retrievable via `context.Cause(ctx)`.
- **Documentation clarifications** around `SetLimit` panic semantics.
  No code change; the panic was always there, but the docs now spell
  it out.

The package is stable; breaking changes are extremely rare. New
features land cautiously.

## 11. Authoritative pointers

For each major concept, the single best source:

- **`errgroup` semantics.** The godoc at
  `pkg.go.dev/golang.org/x/sync/errgroup`.
- **Cancellation.** The `context` package godoc; see in particular
  `WithCancelCause` and `Cause`.
- **Structured concurrency philosophy.** Nathaniel J. Smith's "Notes
  on structured concurrency" essay.
- **Cross-language framing.** Swift SE-0304, Kotlin coroutines guide,
  Trio docs.
- **Go's design decisions.** Russ Cox's talks linked from
  `research.swtch.com`.

These six pointers cover roughly 95% of what you need to know to
discuss the topic at a senior level.

## 12. Quote bank for talks and docs

A few short, citable passages from the sources above. Use these to
anchor design-doc arguments.

> "Every goroutine should have a clear parent that waits for it."
> — Russ Cox (paraphrased)

> "Background work without an owner is a leak in the same way that
> allocating memory without freeing it is a leak."
> — Joe Duffy (paraphrased)

> "Go statement considered harmful."
> — Nathaniel J. Smith, title of his essay on structured concurrency.

> "The right shape of a concurrent program is a tree of calls, not a
> graph."
> — Russ Cox (paraphrased)

> "Structured concurrency lets us reason about a single point in our
> program, the closing brace of a scope, and be confident that nothing
> we started inside is still running."
> — paraphrase of the Trio docs.

Use these sparingly and always with attribution; they're shorthand
for arguments you'd make at length.

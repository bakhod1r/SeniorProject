---
layout: default
title: Structured Concurrency — Junior
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/junior/
---

# Structured Concurrency — Junior

[← Back](../)

This page introduces the idea of structured concurrency by contrast. We start
with the most familiar Go construct — the `go` statement — and show why, on
its own, it makes programs harder to reason about. Then we introduce
`errgroup` as the everyday tool that brings structure back.

## 1. What does "structured" even mean?

You already use a kind of structure every day without thinking about it: the
call stack. When `caller` invokes `callee`, control flow goes *into* `callee`
and only *returns* to `caller` when `callee` has finished. The lifetime of
`callee`'s work is bounded by the lifetime of the function call. You cannot
"escape" from `callee` while it is still running; the language guarantees
this.

The same is true for variables. A local variable is born when the function
starts and dies when the function returns. Scope and lifetime are tied to
syntax — to the curly braces that contain the variable.

That tight coupling between syntax (`{ ... }`) and lifetime (when things
exist or run) is what we mean by **structured**. It is what makes synchronous
code easy to read: you can point at a closing brace and say "everything
inside that brace is done by now".

**Structured concurrency** is the same idea applied to goroutines. A
structured-concurrency primitive guarantees that every goroutine started
inside a block has finished (succeeded, errored, or been cancelled) by the
time control leaves that block. There are no orphans. There is no "I started
some work, it might still be running, who knows".

## 2. The unstructured `go` statement

Go's `go` statement is fire-and-forget by design:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    go say("hello")
    fmt.Println("started")
    // main returns here, before say has finished
}

func say(s string) {
    time.Sleep(100 * time.Millisecond)
    fmt.Println(s)
}
```

Run this program. You usually see `started` and then the program exits.
`say("hello")` never gets to print, because the Go runtime tears down when
`main` returns regardless of background goroutines.

The `go` statement creates a goroutine and *immediately returns*. The
goroutine and its caller are now living independent lives. The caller has no
handle on it, no way to wait for it, no way to learn whether it succeeded or
failed.

In other words: the lifetime of a goroutine started by `go f()` is not
bounded by the lifetime of the function that started it. That is what we
mean by "unstructured".

## 3. Why the unstructured version is a problem

In a tiny program, you can patch the issue with a `time.Sleep` or a manual
channel. In a real service, the unstructured `go` causes four recurring
problems.

### 3.1 Goroutine leaks

```go
func StartReport(ctx context.Context, db *DB) {
    go func() {
        rows, err := db.Query(ctx, "...")
        if err != nil {
            log.Println(err)
            return
        }
        process(rows)
    }()
}
```

If the caller is an HTTP handler and the request finishes immediately, the
goroutine keeps running. If something inside `db.Query` blocks (a slow
connection, a misbehaving driver) the goroutine *never* finishes. Repeat for
every request — goroutines accumulate, memory grows, eventually the process
dies.

Production engineers see this as a slow-rising "goroutines" graph in their
dashboard. Hours of investigation usually trace back to a single bare `go`
that nobody bothered to wait for.

### 3.2 Lost errors

The goroutine returns an error — `log.Println(err)` swallows it. The caller
has no way to know the work failed. A user sees "report ready" while
internally the report never generated. There is no place in the type system
or the control flow that even *could* surface the error.

### 3.3 Lost panics

A panic in a goroutine, by default, **crashes the entire process**. The
panic does not propagate to the launcher; it kills the runtime. In a
production service this can mean a single bad input takes down all in-flight
requests, not just the one that triggered the panic.

### 3.4 Lost cancellation

The launcher cancels — perhaps because the client disconnected — but the
goroutine is not respecting any context, or it does respect one but the
launcher forgot to wire it up. Now you have a "zombie" goroutine doing work
nobody wants.

## 4. The classic patches

Before talking about `errgroup`, here are the manual patterns people reach
for. They work, but they are noisy.

### 4.1 `sync.WaitGroup`

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    doWork()
}()
wg.Wait()
```

The `WaitGroup` adds the "wait" half of structured concurrency: the parent
can join the child. What it does *not* give you:

- Error propagation. If `doWork` returns an error, you have to wire it
  through your own channel or shared variable.
- Cancellation propagation. Workers must hand-roll context handling.
- Panic safety. A panic in a goroutine still skips `defer wg.Done()` *only*
  if you forget the `defer`. Use `defer` religiously.

### 4.2 `sync.WaitGroup` plus `chan error`

```go
var wg sync.WaitGroup
errCh := make(chan error, 1)

wg.Add(1)
go func() {
    defer wg.Done()
    if err := doWork(); err != nil {
        select { case errCh <- err: default: }
    }
}()

wg.Wait()
close(errCh)
err := <-errCh
```

Now we have wait + first-error. But the bookkeeping is bad. Every change to
the worker count means re-thinking the channel buffer. Every reviewer has to
re-derive the correctness argument. This is exactly the boilerplate that
`errgroup` removes.

## 5. Introducing `errgroup`

`golang.org/x/sync/errgroup` packages the patterns above into a small, easy
to read API. Three methods are enough for most uses:

```go
import "golang.org/x/sync/errgroup"

func loadAll(ctx context.Context) error {
    var g errgroup.Group

    g.Go(func() error {
        return fetchUser(ctx)
    })
    g.Go(func() error {
        return fetchPosts(ctx)
    })

    return g.Wait()
}
```

What just happened:

- `g.Go(f)` launches a goroutine that runs `f` and tracks its completion.
- `g.Wait()` blocks until every started goroutine has returned, then returns
  the first non-nil error any of them produced (or `nil` if all succeeded).

Lifetime is now bounded by `loadAll`. When `loadAll` returns, both fetches
are done. No orphans, no lost errors. Structured.

## 6. `errgroup.WithContext` — adding cancellation

The version above has a subtle weakness: if `fetchUser` fails, `fetchPosts`
keeps running until it finishes on its own. We typically want sibling
cancellation: one failure should cut the others short.

```go
func loadAll(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error { return fetchUser(gctx) })
    g.Go(func() error { return fetchPosts(gctx) })

    return g.Wait()
}
```

`errgroup.WithContext(parent)` returns the group *and* a derived context.
The first time any `Go`-launched function returns a non-nil error, the
derived context is cancelled. Children that use `gctx` (and respect it)
will then exit on their next select.

This is the typical shape you will see in real Go code: `g, gctx :=
errgroup.WithContext(ctx)` and *always* pass `gctx` to children, never the
outer `ctx`.

## 7. A complete first example

A small program that fetches three things in parallel:

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "time"

    "golang.org/x/sync/errgroup"
)

func fetch(ctx context.Context, url string) (int, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return 0, err }
    defer resp.Body.Close()
    return resp.StatusCode, nil
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    urls := []string{
        "https://example.com",
        "https://example.org",
        "https://example.net",
    }

    statuses := make([]int, len(urls))
    g, gctx := errgroup.WithContext(ctx)

    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            s, err := fetch(gctx, u)
            if err != nil { return err }
            statuses[i] = s
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        log.Fatalf("fetch failed: %v", err)
    }
    fmt.Println(statuses)
}
```

Walk through it:

- `g, gctx := errgroup.WithContext(ctx)` creates the scope.
- Each iteration calls `g.Go(...)` to launch a fetch.
- We capture `i, u := i, u` so each goroutine sees its own iteration values
  (essential pre-Go-1.22; harmless and explicit afterwards).
- After all `Go` calls, `g.Wait()` joins them and surfaces the first error.
- Each goroutine writes to `statuses[i]`. Different goroutines touch
  different indices, so there is no race.

When `main` returns, all three goroutines have either completed or been
cancelled by the 2-second timeout. Structured.

## 8. Why the loop-variable rebind?

This deserves its own subsection because every junior trips on it once.

Before Go 1.22, the `for` loop variable was reused across iterations. So this
code:

```go
for _, u := range urls {
    g.Go(func() error {
        return fetch(ctx, u)
    })
}
```

…would compile, and the closures would all see the *same* `u` — whatever
its last value was. All three fetches would hit the last URL.

The fix is to rebind:

```go
for _, u := range urls {
    u := u // new variable in each iteration's scope
    g.Go(func() error { return fetch(ctx, u) })
}
```

Go 1.22 changed loop semantics to make every iteration produce its own
variables. On 1.22+ the rebind is unnecessary but harmless. If your module's
`go.mod` says `go 1.22` or higher, you can drop the rebind. Until then, type
`u := u`.

## 9. Comparing `WaitGroup` to `errgroup`

To cement the difference, here is the same task with both:

```go
// WaitGroup version
func loadWG(ctx context.Context) (User, Posts, error) {
    var (
        wg   sync.WaitGroup
        mu   sync.Mutex
        err  error
        u    User
        p    Posts
    )
    setErr := func(e error) {
        mu.Lock()
        if err == nil { err = e }
        mu.Unlock()
    }

    wg.Add(2)
    go func() {
        defer wg.Done()
        v, e := fetchUser(ctx)
        if e != nil { setErr(e); return }
        u = v
    }()
    go func() {
        defer wg.Done()
        v, e := fetchPosts(ctx)
        if e != nil { setErr(e); return }
        p = v
    }()
    wg.Wait()
    return u, p, err
}
```

```go
// errgroup version
func loadEG(ctx context.Context) (User, Posts, error) {
    g, gctx := errgroup.WithContext(ctx)
    var u User
    var p Posts

    g.Go(func() error {
        v, err := fetchUser(gctx)
        if err != nil { return err }
        u = v
        return nil
    })
    g.Go(func() error {
        v, err := fetchPosts(gctx)
        if err != nil { return err }
        p = v
        return nil
    })

    if err := g.Wait(); err != nil { return User{}, nil, err }
    return u, p, nil
}
```

The `errgroup` version is shorter, has no explicit mutex, has automatic
first-error capture, and gives you cancellation propagation for free
(siblings see `gctx.Done()` once the first error surfaces).

Almost every place a junior would write `sync.WaitGroup`, a senior writes
`errgroup`. That is the headline.

## 10. The boundary rule

There is one rule that, internalised, removes ninety per cent of the
beginner's confusion:

> **Every `g.Go(...)` call must happen before `g.Wait()`. After `g.Wait()`
> returns, the group is done.**

You cannot add more `Go` after `Wait`. You cannot read shared variables that
the goroutines write until *after* `Wait`. You cannot reuse the group for
another batch.

If you find yourself wanting to do any of those things, you almost certainly
want either:

- A new `errgroup` for the new batch, or
- A worker pool with a channel feeding work to long-lived workers (which is
  still inside an `errgroup`, just not the same kind of group).

Both are covered on the [Middle](../middle/) page.

## 11. A first taste of the bigger picture

You have now seen that:

- The `go` statement, alone, is unstructured.
- `sync.WaitGroup` adds the wait, but not the error or cancellation.
- `errgroup.Group` and `errgroup.WithContext` bundle all three into a
  scope-shaped API.

Languages like Kotlin and Swift make this the *default* — you literally
cannot write `go f()` without an owner. Go does not, which means the
responsibility is on you and your reviewers. The next page,
[Middle](../middle/), walks through the `errgroup` source and discusses the
broader design picture: why Go made this choice, what other languages did,
and what production patterns have evolved on top of `errgroup`.

## 12. Recap

- "Structured" means: scope and lifetime are tied to syntax.
- Bare `go f()` is unstructured: goroutine lifetime is decoupled from the
  launcher.
- Bare `go` causes leaks, lost errors, lost panics, lost cancellation.
- `sync.WaitGroup` adds the join but nothing else.
- `errgroup.Group` adds first-error capture; `errgroup.WithContext` adds
  cancellation propagation. Together they cover almost every fan-out task.
- Always `Go` before `Wait`. Read shared results only after `Wait`.
- Pre-1.22: rebind loop variables with `x := x`. On 1.22+ the rebind is
  optional.

A worked exercise: take a function in your own codebase that uses bare `go`,
rewrite it with `errgroup.WithContext`, and run `go test -race`. If the test
file does not exist, write one. You will probably surface a bug.

## 13. A mental model: the "rope" analogy

If you've ever held a dog on a leash, you know roughly what structured
concurrency feels like. The dog (goroutine) can roam — but only within the
length of the leash. When you turn to leave, the dog comes with you. The
leash is the syntactic scope.

Bare `go f()` is letting the dog off-leash and walking away. Maybe it
follows you home. Maybe it chases a car. You will find out only when you
get a phone call from someone asking whether you own a small brown dog.

`errgroup` is the leash. The leash isn't the whole solution — you still
need to want to leash your dog, and you still need to actually hold the
leash. The package gives you the leash; the discipline of holding it is on
you. The reason language-level structured concurrency is attractive is
that the leash is non-detachable: you cannot leave with the dog still on
the lawn.

This is why every senior Go engineer eventually develops the habit of
asking, when they see `go f()` in a review: "who owns this goroutine?"
If the answer is "nobody", that's the bug.

## 14. Counter-example: when bare `go` is fine

There are a small number of cases where bare `go` is actually OK. They're
worth knowing so you don't apply structured-concurrency rules
mechanically.

### 14.1 The `main` daemon

```go
func main() {
    cfg := loadConfig()
    go runDebugServer(cfg.DebugAddr)
    runMainServer(cfg.Addr) // blocks until SIGTERM
}
```

The debug server is a daemon — it runs for the entire process lifetime.
When `main` returns, the runtime tears it down. There is no leak because
the process exits. This is fine, although in production code you'd
typically still wrap it in a lifecycle pattern so that graceful shutdown
flushes its state.

### 14.2 Send-and-forget metrics with a tiny buffer

```go
type metricsClient struct {
    ch chan event
}

func (m *metricsClient) Emit(e event) {
    select {
    case m.ch <- e:
    default: // drop if buffer full
    }
}
```

There's a single long-lived consumer goroutine reading from `m.ch`. The
producer is `Emit`. No bare `go` is involved per emit; the goroutine count
stays constant.

### 14.3 Tests

A goroutine spawned in a test function and joined before the test ends is
fine even if it uses bare `go`, as long as the test is correct.
`goleak.VerifyTestMain` catches mistakes.

In every other case — anywhere in library code, anywhere a function might
be called more than once, anywhere a handler is — bare `go` is suspect.

## 15. Hands-on: write your first `errgroup`

Open a fresh module and write this program. Run it. Modify it. Break it
on purpose and observe the behaviour.

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func slow(ctx context.Context, name string, d time.Duration, fail bool) error {
    fmt.Printf("[%s] start\n", name)
    select {
    case <-time.After(d):
    case <-ctx.Done():
        fmt.Printf("[%s] cancelled\n", name)
        return ctx.Err()
    }
    if fail {
        fmt.Printf("[%s] failing\n", name)
        return fmt.Errorf("%s exploded", name)
    }
    fmt.Printf("[%s] done\n", name)
    return nil
}

func main() {
    ctx := context.Background()
    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error { return slow(gctx, "A", 200*time.Millisecond, false) })
    g.Go(func() error { return slow(gctx, "B", 500*time.Millisecond, true)  })
    g.Go(func() error { return slow(gctx, "C", 800*time.Millisecond, false) })

    err := g.Wait()
    fmt.Printf("g.Wait err = %v\n", err)
    fmt.Printf("context.Cause(gctx) = %v\n", context.Cause(gctx))
    fmt.Printf("errors.Is(err, context.Canceled) = %v\n", errors.Is(err, context.Canceled))
}
```

Expected output (timings approximate):

```text
[A] start
[B] start
[C] start
[A] done
[B] failing
[C] cancelled
g.Wait err = B exploded
context.Cause(gctx) = B exploded
errors.Is(err, context.Canceled) = false
```

Note:

- A finished before B failed, so it returned normally.
- B failed at ~500ms, which cancelled `gctx`.
- C was still running; its `select` on `gctx.Done()` fired immediately;
  it returned `ctx.Err()`.
- `Wait` returned B's error (the *first* non-nil), not C's
  `context.Canceled`.
- `context.Cause(gctx)` also returns B's error — the cancellation cause
  was installed by `errgroup`.

Modify the program: change B's `fail` to `false`. Now all three finish
normally and `Wait` returns `nil`. Notice that `context.Cause(gctx)` is
*not* `nil` after `Wait` even on success — `errgroup` calls `g.cancel(nil)`
when the group finishes successfully, so the cause is `nil` but the
context's `Done()` channel is closed. This is intentional: it lets
downstream code know that `gctx` has retired.

Modify it again: replace one of the `slow` calls with `time.Sleep(d)`
that ignores `ctx`. Now when B fails, the cancelled child sleeps for its
full duration. `Wait` waits for it. This is the most common shape of an
"errgroup hangs" bug.

## 16. Quick reference card

```go
// Create
var g errgroup.Group                       // wait + first-error
g, gctx := errgroup.WithContext(ctx)       // + cancellation

// Configure
g.SetLimit(N)                              // cap concurrency, before any Go

// Submit
g.Go(func() error { return work(gctx) })
ok := g.TryGo(func() error { ... })        // non-blocking submit

// Join
if err := g.Wait(); err != nil { ... }

// Inspect cancellation cause
cause := context.Cause(gctx)               // after Wait, with WithContext
```

That is the entire surface. Memorise it; you will type it daily.

## 17. Closing thoughts for a junior reader

Most concurrency bugs in Go are not about Memory Model edge cases or
exotic lock-free algorithms. They are about goroutines whose lifetimes
nobody is tracking. Internalising structured concurrency — even just at
the level of "always use `errgroup`, never bare `go` in library code" —
removes a huge fraction of those bugs before they ever happen.

If you remember nothing else from this page, remember the rope analogy
and the boundary rule:

- Every goroutine is on a leash.
- The leash is `errgroup`.
- All `Go` calls happen before `Wait`.
- Shared variables are only read after `Wait`.

That is enough to ship structured-concurrency-shaped Go code without
having to wait for the language to grow.

## 18. Step-by-step rewrite: from chaos to structure

To cement the muscle memory, here is a long-form walkthrough of taking
a typical chunk of bare-`go` code and rewriting it step by step.

### 18.1 The starting point

A handler that fetches a user profile plus their last ten posts. The
original developer wrote it the obvious way:

```go
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("id")
    if userID == "" {
        http.Error(w, "missing id", 400)
        return
    }

    var user User
    var posts []Post
    var err1, err2 error

    go func() { user, err1 = fetchUser(userID) }()
    go func() { posts, err2 = fetchPosts(userID) }()

    time.Sleep(2 * time.Second)

    if err1 != nil { http.Error(w, err1.Error(), 500); return }
    if err2 != nil { http.Error(w, err2.Error(), 500); return }

    json.NewEncoder(w).Encode(map[string]any{
        "user":  user,
        "posts": posts,
    })
}
```

Count the bugs:

1. `time.Sleep(2 * time.Second)` is the wait mechanism. If fetches take
   longer, you read partial data. If they're fast, you waste two seconds.
2. The two goroutines write to `user`, `posts`, `err1`, `err2`
   concurrently. `go test -race` flags them.
3. Neither fetch takes a context. They cannot be cancelled when the client
   disconnects.
4. If one fetch fails immediately, the other still runs to completion —
   wasted work.
5. If one fetch panics, the entire process crashes.

### 18.2 Step 1 — give them a context

First, wire up `context.Context`:

```go
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    userID := r.URL.Query().Get("id")
    if userID == "" {
        http.Error(w, "missing id", 400)
        return
    }

    var user User
    var posts []Post
    var err1, err2 error

    go func() { user, err1 = fetchUser(ctx, userID) }()
    go func() { posts, err2 = fetchPosts(ctx, userID) }()

    time.Sleep(2 * time.Second)
    // ... rest unchanged
}
```

`fetchUser` and `fetchPosts` now accept a context. When the client
disconnects, `r.Context()` is cancelled and well-behaved fetches will
abort. Progress! But we still have all the other bugs.

### 18.3 Step 2 — replace `time.Sleep` with `sync.WaitGroup`

```go
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    userID := r.URL.Query().Get("id")
    if userID == "" {
        http.Error(w, "missing id", 400)
        return
    }

    var (
        wg sync.WaitGroup
        user User
        posts []Post
        err1, err2 error
    )

    wg.Add(2)
    go func() { defer wg.Done(); user, err1 = fetchUser(ctx, userID) }()
    go func() { defer wg.Done(); posts, err2 = fetchPosts(ctx, userID) }()
    wg.Wait()

    if err1 != nil { http.Error(w, err1.Error(), 500); return }
    if err2 != nil { http.Error(w, err2.Error(), 500); return }

    json.NewEncoder(w).Encode(map[string]any{
        "user":  user,
        "posts": posts,
    })
}
```

Better. We wait the right amount of time. The reads after `wg.Wait()` are
race-free because of the wait group's happens-before guarantee. But we
still don't propagate cancellation between siblings, and we have boilerplate.

### 18.4 Step 3 — `errgroup.Group{}` for first-error semantics

```go
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    userID := r.URL.Query().Get("id")
    if userID == "" {
        http.Error(w, "missing id", 400)
        return
    }

    var (
        g     errgroup.Group
        user  User
        posts []Post
    )

    g.Go(func() error {
        u, err := fetchUser(ctx, userID)
        if err != nil { return err }
        user = u
        return nil
    })
    g.Go(func() error {
        p, err := fetchPosts(ctx, userID)
        if err != nil { return err }
        posts = p
        return nil
    })

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }

    json.NewEncoder(w).Encode(map[string]any{
        "user":  user,
        "posts": posts,
    })
}
```

Now we have first-error semantics and a single error path. But if
`fetchUser` fails fast, `fetchPosts` keeps running.

### 18.5 Step 4 — `errgroup.WithContext` for sibling cancellation

```go
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    userID := r.URL.Query().Get("id")
    if userID == "" {
        http.Error(w, "missing id", 400)
        return
    }

    g, gctx := errgroup.WithContext(ctx)
    var user  User
    var posts []Post

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

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }

    json.NewEncoder(w).Encode(map[string]any{
        "user":  user,
        "posts": posts,
    })
}
```

The key change: `g, gctx := errgroup.WithContext(ctx)` and pass `gctx` to
the fetches. Now the first failure cancels `gctx`, the sibling sees
`gctx.Done()`, and it returns early. No wasted work.

### 18.6 Step 5 — add a deadline

A production handler also wants an upper bound. Add a deadline derived
from the request:

```go
ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
defer cancel()

g, gctx := errgroup.WithContext(ctx)
// ...
```

Now we have three sources of cancellation, in priority order:

1. The handler's deadline (3 seconds).
2. The client disconnecting (cancels `r.Context()`).
3. A sibling fetch failing (cancels `gctx`).

Any of these will cause well-behaved fetches to exit early. `g.Wait()`
joins all of them either way.

### 18.7 Final form

```go
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
    defer cancel()

    userID := r.URL.Query().Get("id")
    if userID == "" {
        http.Error(w, "missing id", 400)
        return
    }

    g, gctx := errgroup.WithContext(ctx)
    var (
        user  User
        posts []Post
    )

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

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }

    json.NewEncoder(w).Encode(map[string]any{
        "user":  user,
        "posts": posts,
    })
}
```

Compare line counts and properties to the original:

| Property | Original | Final |
|---|---|---|
| Lines of code | ~22 | ~26 |
| Race-free | No | Yes |
| Respects context | No | Yes |
| Sibling cancellation | No | Yes |
| Deadline | No | Yes |
| First-error semantics | Manual | Built-in |
| Goroutine leak risk | Yes | No |

For four extra lines, every property got better. That is the value of
structured concurrency.

## 19. Patterns you'll encounter in real code

A few shapes worth recognising when reading code.

### 19.1 The "scatter, gather, error-check"

```go
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error { /* fetch A */ })
g.Go(func() error { /* fetch B */ })
g.Go(func() error { /* fetch C */ })
if err := g.Wait(); err != nil { return err }
// All three are done; use their results.
```

This is the most common shape. Recognise it instantly. The number of
`Go` calls is fixed and known at compile time; each captures different
result variables.

### 19.2 The "for-loop fan-out"

```go
g, gctx := errgroup.WithContext(ctx)
results := make([]R, len(items))
for i, it := range items {
    i, it := i, it
    g.Go(func() error {
        r, err := work(gctx, it)
        if err != nil { return err }
        results[i] = r
        return nil
    })
}
if err := g.Wait(); err != nil { return nil, err }
```

Dynamic count of goroutines bound by the slice length. Each writes to its
own slice index, so there's no race. Always rebind loop variables in
pre-1.22 modules.

### 19.3 The "produce/consume pipeline"

```go
g, gctx := errgroup.WithContext(ctx)
ch := make(chan Item)

g.Go(func() error {
    defer close(ch)
    return producer(gctx, ch)
})
g.Go(func() error {
    return consumer(gctx, ch)
})

return g.Wait()
```

Producer closes the channel when it's done; consumer's `for range ch`
exits naturally. Both run under the same group, so first-error cancels
both.

### 19.4 The "bounded pool"

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(gctx, item) })
}
return g.Wait()
```

`SetLimit(8)` means at most 8 goroutines run at once; `Go` blocks the
producer when the limit is reached. Simplest way to cap concurrency.

## 20. What to do next

You've reached the end of the Junior page. To consolidate:

1. Write the program in section 15 and run it.
2. Find one bare `go` in your own codebase and rewrite it as in section 18.
3. Add `goleak.VerifyTestMain(m)` to a package and watch what fails.
4. Read the Middle page when you want to know *how* `errgroup` works under
   the hood, when to use `TryGo`/`SetLimit`, and how Go compares to other
   languages.

Structured concurrency is, ultimately, a discipline. The package gives you
the tool; the practice gives you the safety. Start applying it everywhere
and the rest of the curriculum will go more smoothly.

## 21. Frequently asked questions

A few that come up from juniors.

**Q. Can I `g.Go` from inside another `g.Go`?**

Yes — *as long as the inner `Go` happens before the outer goroutine
returns and before `g.Wait()` runs*. In practice this means: don't call
`Go` from goroutines that may themselves be cancelled, or you'll have
races with `Wait`. Safer pattern: launch all top-level `Go` calls first,
then have them dispatch sub-work to a *different* group they create
themselves.

**Q. What happens if `g.Go(nil)`?**

The goroutine starts, calls `nil()` (calling a nil function), panics, and
the process crashes. `errgroup` does not nil-check the function. Don't
pass nil.

**Q. Can I cancel just one goroutine in a group?**

Not directly. `errgroup` cancels the whole group on first error or via
the outer context. If you need fine-grained cancellation, give each
child its own `context.WithCancel` and cancel that one specifically. But
then you're back to manual coordination.

**Q. Why is the function passed to `Go` `func() error`, not `func() (T, error)`?**

Because `errgroup` knows nothing about your result types. The convention
is to capture results in outer variables (one per goroutine, distinct
slots) and read them after `Wait`. If you need a typed result, look at
third-party packages like `github.com/sourcegraph/conc` (`conc.Pool`,
`conc.Tasks`) that bake the result-typing in. The stdlib-ish answer is
`errgroup` plus your own variables.

**Q. Should I use `errgroup` in every test that spawns goroutines?**

Generally yes. Even short-lived test goroutines benefit from the
structured shape. The alternative is `WaitGroup`, which works but
doesn't aggregate test errors as cleanly. Combine `errgroup` with
`goleak` and your tests will tell you when concurrency goes wrong.

**Q. Is `errgroup` part of the standard library?**

No, it's in `golang.org/x/sync/errgroup`. The `x/sync` repository is
maintained by the Go team but evolves outside the language's stability
promise — which is why features like `SetLimit` could land mid-cycle. For
a Go module, just `go get golang.org/x/sync/errgroup`.

**Q. Can I unit-test that `g.Wait()` returned without `goleak`?**

Yes, but it's lower-resolution. You can assert that `g.Wait()` returned
within a deadline, e.g. with `context.WithTimeout`. But that only tells
you whether the *visible* goroutines exited — not whether some *other*
goroutine elsewhere leaked. `goleak` covers the whole process. For
single-function unit tests, an explicit `assert.NoError(g.Wait())` plus
a strict timeout is enough.

## 22. A small reading list for the next session

When you sit down for the Middle page, it helps to have skimmed these
first:

- The `errgroup.go` source file. About 130 lines. Reads in five minutes.
- The `sync.WaitGroup` documentation. Knowing the underlying primitive
  helps you understand what `errgroup` adds.
- The `context.Context` documentation, in particular `WithCancel`,
  `WithTimeout`, and `WithCancelCause`.
- Optionally: Nathaniel J. Smith's "Notes on structured concurrency"
  essay (it's about Trio, but the conceptual framework is universal).

These together give you the vocabulary that the Middle and Senior pages
assume.

## 23. Side quest: the goroutine count graph

Find a real Go service in your environment that exposes `pprof` or
`runtime` metrics. Plot `go_goroutines` (or
`runtime.NumGoroutine()`) over a day. You will see one of two shapes:

```text
healthy:                              leaky:
  500 ┤                                  900 ┤        ___
  450 ┤  ╭╮  ╭╮  ╭╮  ╭╮                  800 ┤    ___/
  400 ┤──╯╰──╯╰──╯╰──╯╰──                700 ┤___/
  350 ┤                                  600 ┤
       0   6   12  18  24                     0   6   12  18  24
            hours                                  hours
```

A healthy service oscillates around a steady state — goroutines spike up
during load and drop back down. A leaky service grows monotonically.
Every long-running production service with bare `go` somewhere has the
second shape, eventually.

`errgroup` (used consistently) flatlines the graph. That, alone, makes it
worth adopting across a codebase.

## 24. The 80/20 rule for this page

If you skim this page once and forget everything except the following,
you will write much better Go than 80% of Go programmers:

1. `errgroup.WithContext(ctx)` is your default.
2. Every concurrent task is a `g.Go(func() error { ... })`.
3. Pass the derived `gctx` into the task, not the outer context.
4. Return `g.Wait()`.
5. Read shared results only after `Wait`.

Five lines of policy. Apply them and most "weird concurrent behaviour"
in your codebase disappears. The Middle and Senior pages refine the
edges — but the core is just those five rules.

## 25. Glossary for this page

- **Goroutine.** A Go runtime-managed lightweight thread.
- **Goroutine leak.** A goroutine that runs longer than the function that
  spawned it intended; specifically one that the parent cannot join.
- **Structured concurrency.** The principle that every concurrent task
  has an owner that waits for it before exiting the owner's scope.
- **`errgroup.Group`.** Go's library-level approximation of a structured-
  concurrency scope.
- **Cancellation.** Telling a task to stop (via `context.Context`).
- **Completion.** Knowing a task has actually stopped (via
  `WaitGroup.Wait` or `errgroup.Wait`).
- **Sibling cancellation.** When one child fails and the others are
  notified to stop (via the group's derived context being cancelled).
- **First-error semantics.** `errgroup` captures only the first non-nil
  error; subsequent errors from siblings are dropped.
- **`goleak`.** A test helper from Uber that detects goroutine leaks in
  tests.

That's the page. Take a break, try the exercises in section 18 and the
small program in section 15, and then move on to [Middle](../middle/).

## 26. Bonus: comparing four ways to write the same fan-out

To wrap the page with a panoramic view, here is the same conceptual task —
fan out two independent fetches and combine the results — written four
ways. From most primitive to most structured.

### 26.1 Channels and select

```go
func loadChan(ctx context.Context) (User, Posts, error) {
    type uResult struct{ u User; err error }
    type pResult struct{ p Posts; err error }
    uCh := make(chan uResult, 1)
    pCh := make(chan pResult, 1)

    go func() {
        u, err := fetchUser(ctx)
        uCh <- uResult{u, err}
    }()
    go func() {
        p, err := fetchPosts(ctx)
        pCh <- pResult{p, err}
    }()

    var ur uResult
    var pr pResult
    for i := 0; i < 2; i++ {
        select {
        case ur = <-uCh:
        case pr = <-pCh:
        }
    }
    if ur.err != nil { return User{}, nil, ur.err }
    if pr.err != nil { return User{}, nil, pr.err }
    return ur.u, pr.p, nil
}
```

Works, but the code is dominated by plumbing. Each fetch needs its own
typed struct just to carry result+error through a channel. The `select`
loop is awkward. Adding a third fetch is a non-trivial refactor.

### 26.2 `sync.WaitGroup` plus shared variables

```go
func loadWG(ctx context.Context) (User, Posts, error) {
    var (
        wg sync.WaitGroup
        u  User
        p  Posts
        e1, e2 error
    )
    wg.Add(2)
    go func() { defer wg.Done(); u, e1 = fetchUser(ctx) }()
    go func() { defer wg.Done(); p, e2 = fetchPosts(ctx) }()
    wg.Wait()
    if e1 != nil { return User{}, nil, e1 }
    if e2 != nil { return User{}, nil, e2 }
    return u, p, nil
}
```

Better. Fewer types, simpler join. But two manual error variables, no
sibling cancellation, no first-error semantics — if both fail, you
arbitrarily prioritise e1 over e2.

### 26.3 `errgroup.Group`

```go
func loadEG(ctx context.Context) (User, Posts, error) {
    var (
        g errgroup.Group
        u User
        p Posts
    )
    g.Go(func() error {
        v, err := fetchUser(ctx)
        if err != nil { return err }
        u = v
        return nil
    })
    g.Go(func() error {
        v, err := fetchPosts(ctx)
        if err != nil { return err }
        p = v
        return nil
    })
    if err := g.Wait(); err != nil { return User{}, nil, err }
    return u, p, nil
}
```

First-error is automatic. Adding a third fetch is a single `g.Go(...)`
block. But still no sibling cancellation.

### 26.4 `errgroup.WithContext`

```go
func loadEGCtx(ctx context.Context) (User, Posts, error) {
    g, gctx := errgroup.WithContext(ctx)
    var u User
    var p Posts

    g.Go(func() error {
        v, err := fetchUser(gctx)
        if err != nil { return err }
        u = v
        return nil
    })
    g.Go(func() error {
        v, err := fetchPosts(gctx)
        if err != nil { return err }
        p = v
        return nil
    })
    if err := g.Wait(); err != nil { return User{}, nil, err }
    return u, p, nil
}
```

The version you'll write in production. First-error, sibling cancellation,
context propagation. Every property covered. Roughly the same length as
the `WaitGroup` version, but every property is better.

The progression is the point: as you move down the list, more structure
is captured in the library and less in your code. The bottom version is
the structured-concurrency version. The further you stray from it without
a strong reason, the more bugs you're inviting.

## 27. One last warning before the next page

A trap juniors fall into after reading about `errgroup`: using it
everywhere, including places it doesn't belong. The clearest example is
long-lived background work.

If a goroutine should run for the lifetime of the process (a flusher, a
ticker-driven metric emitter, a connection pool keeper) then
`errgroup.Wait` will block forever waiting for it. That is correct
behaviour for `errgroup`, but it means the function that called it never
returns.

For daemons, use a `Start`/`Stop` pattern with a private `WaitGroup` and
a `context.CancelFunc`. The Middle and Professional pages cover this.

Rule of thumb: `errgroup` is for request-scoped, fan-out work that has a
clear end. Daemons need their own lifecycle.

Now go read [Middle](../middle/) — it's the same ideas at higher
resolution, and it'll make a lot more sense after you've internalised
the basics here.

## 28. A tiny code review exercise

Below are five short snippets. For each, identify what is wrong (or
right) about its concurrency. Don't read past each snippet until you've
formed an opinion.

### 28.1

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go logEvent(r)
    w.Write([]byte("ok"))
}
```

Wrong. `logEvent` runs in a goroutine the handler does not own. If
`logEvent` blocks (e.g. on a slow network), the goroutine leaks. The
handler "succeeds" while the logging is potentially still pending. In
production library code, even logging should be supervised.

### 28.2

```go
func fetchAll(ctx context.Context, urls []string) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, u := range urls {
        g.Go(func() error { return fetch(gctx, u) })
    }
    return g.Wait()
}
```

Wrong if compiled with Go < 1.22. `u` is captured by reference; every
goroutine sees the last URL. Add `u := u` inside the loop. On Go 1.22+
this is fine.

### 28.3

```go
func fetchTwo(ctx context.Context) (A, B, error) {
    var (
        g errgroup.Group
        a A
        b B
    )
    g.Go(func() error { var err error; a, err = getA(ctx); return err })
    g.Go(func() error { var err error; b, err = getB(ctx); return err })
    if err := g.Wait(); err != nil { return A{}, B{}, err }
    return a, b, nil
}
```

Mostly right, but missing sibling cancellation: if `getA` fails, `getB`
keeps running. Should be `g, gctx := errgroup.WithContext(ctx)` and pass
`gctx` to both children.

### 28.4

```go
func runOnce() {
    var g errgroup.Group
    g.Go(func() error {
        time.Sleep(10 * time.Second)
        return nil
    })
    g.Go(func() error { return doWork() })
    _ = g.Wait()
}
```

Right but possibly slow: `g.Wait` will block at least 10 seconds because
the first goroutine sleeps that long. If `doWork` is the actual point
and the sleep is artificial, you've coupled the function's latency to
an unrelated delay. Worth a comment.

### 28.5

```go
func main() {
    g, gctx := errgroup.WithContext(context.Background())
    g.Go(func() error {
        for range time.Tick(time.Second) {
            select {
            case <-gctx.Done(): return nil
            default: flush()
            }
        }
        return nil
    })
    g.Go(func() error { return runServer(gctx) })
    log.Fatal(g.Wait())
}
```

Right for a `main` that wants to terminate the entire program if either
the flusher or the server fails. Both children share `gctx`, so a fatal
server error cancels the flusher and `Wait` returns. This is one of the
few places mixing a daemon-shaped goroutine with a request-life goroutine
inside `errgroup` is OK — because the process itself is the scope.

Working through these five gives you the basic vocabulary for code-review.
Now you're really ready for the Middle page.

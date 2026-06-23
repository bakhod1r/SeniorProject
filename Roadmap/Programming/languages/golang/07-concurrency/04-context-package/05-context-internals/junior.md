# Context Internals — Junior

[← Back to index](index.md)

## Table of Contents
1. [Why Look Inside Context](#why-look-inside-context)
2. [The Four-Method Interface](#the-four-method-interface)
3. [What Each Method Returns](#what-each-method-returns)
4. [The Six Concrete Types](#the-six-concrete-types)
5. [The Singletons: Background and TODO](#the-singletons-background-and-todo)
6. [The Workhorse: cancelCtx](#the-workhorse-cancelctx)
7. [Adding a Deadline: timerCtx](#adding-a-deadline-timerctx)
8. [Adding a Value: valueCtx](#adding-a-value-valuectx)
9. [Go 1.21+ Additions](#go-121-additions)
10. [Where the Source Lives](#where-the-source-lives)
11. [A Tiny Picture of Allocation](#a-tiny-picture-of-allocation)
12. [A First Look at the cancelCtx Picture](#a-first-look-at-the-cancelctx-picture)
13. [Watching the Done Channel Close](#watching-the-done-channel-close)
14. [The CancelFunc Closure](#the-cancelfunc-closure)
15. [What a Tree of Contexts Looks Like](#what-a-tree-of-contexts-looks-like)
16. [How `Value` Walks the Tree](#how-value-walks-the-tree)
17. [Why Many Small Allocations Matter](#why-many-small-allocations-matter)
18. [Reading the Source in 30 Minutes](#reading-the-source-in-30-minutes)
19. [Comparison With Other Languages](#comparison-with-other-languages)
20. [A Brief History](#a-brief-history)
21. [Common Misconceptions](#common-misconceptions)
22. [What to Read Next](#what-to-read-next)

---

## Why Look Inside Context

You can use `context` for years without opening `src/context/context.go`. It works, it does what the documentation promises, you do not need to know how it works. So why this page?

Because every now and then a `context` mystery hits you that the documentation cannot answer:

- "Why does `ctx.Value` get slower in my deep middleware stack?"
- "Why did `pprof` find an extra goroutine sitting in `propagateCancel`?"
- "Why is `WithTimeout` allocating two objects instead of one?"
- "Why does `Cause(ctx)` return `nil` even when the parent had a cause set?"

All four answers are in the source. The `context` package is short, readable, and well-organised. By the end of this junior page you will know which type runs in each call, where the allocations happen, and how `ctx.Done()` actually closes. Internal knowledge gives you a model that survives surprises.

This page stays beginner-friendly. We do not yet trace every `mu.Lock`. We tour the file, name the types, and watch how the basic objects behave. The middle and senior pages go deeper.

---

## The Four-Method Interface

The whole `context` package builds on four method names. Here is the full interface, copied verbatim from `src/context/context.go`:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done()    <-chan struct{}
    Err()     error
    Value(key any) any
}
```

That is the entire API surface that callers care about. Every concrete context inside the package implements those four methods. Every helper (`WithCancel`, `WithTimeout`, `WithValue`, etc.) returns something that satisfies this interface.

The first thing to notice: the interface has no `Cancel()` method. Cancellation is **not** something callers do through the context. It is something the **owner** of the context does through a separate `CancelFunc` returned alongside the context. The interface is read-only for callers.

The second thing to notice: there is no `Parent()` method either. A child cannot ask its parent for anything except through `Value`. The chain is internal and (mostly) hidden.

---

## What Each Method Returns

Each method has a precise contract. Let us walk through them one at a time.

### `Deadline() (time.Time, bool)`

Returns the absolute wall-clock time at which work tied to this context should stop, plus a boolean saying whether a deadline is set at all.

```go
deadline, ok := ctx.Deadline()
if !ok {
    // no deadline; work as long as you like
} else {
    // schedule yourself to stop by `deadline`
}
```

For `Background()` and `TODO()`, the returned bool is `false` and the time is the zero `time.Time`. For a context returned by `WithDeadline(parent, d)`, the bool is `true` and the time is `d` (or `parent`'s deadline if that one is earlier).

### `Done() <-chan struct{}`

Returns a channel that **closes** when the context is canceled. Reading from a closed channel succeeds instantly, so a `select { case <-ctx.Done(): ... }` returns the moment cancellation happens.

For `Background()` and `TODO()`, `Done()` returns `nil`. A `nil` channel in a `select` is permanently blocked. That is by design: those contexts never cancel.

For a `cancelCtx`, the channel is created **lazily**, the first time you call `Done()`. We will see why in the next section.

### `Err() error`

Tells you why the context is canceled. The three possible non-nil values:

| Value                       | Meaning |
|-----------------------------|---------|
| `nil`                       | Not canceled (yet) |
| `context.Canceled`          | Someone called `cancel()` |
| `context.DeadlineExceeded`  | The deadline elapsed |

Custom subclasses can in principle return other errors, but the standard library never does.

### `Value(key any) any`

Looks up a request-scoped value by key. Returns `nil` if no value is found. The lookup walks the chain of contexts from the leaf up toward `Background`, returning the **first** match.

This is the one method whose cost is more than O(1). We will return to it on the middle page.

---

## The Six Concrete Types

Open `src/context/context.go` and search for `type … struct`. You will find these six implementations:

```
emptyCtx          // base for the two singletons
backgroundCtx     // returned by Background()
todoCtx           // returned by TODO()
cancelCtx         // WithCancel / WithCancelCause
timerCtx          // WithDeadline / WithTimeout (embeds cancelCtx)
valueCtx          // WithValue
```

And from Go 1.21+:

```
withoutCancelCtx  // WithoutCancel
afterFuncCtx      // AfterFunc registration (embeds cancelCtx)
stopCtx           // internal helper for AfterFunc parents
```

That is the entire universe. Nine types, fewer than 800 lines of source. The whole package is something a junior engineer can read in an evening.

Here is a quick map of what each one **owns**:

| Type                | Fields | Allocates? |
|---------------------|--------|------------|
| `backgroundCtx`     | none (singleton) | once at init |
| `todoCtx`           | none (singleton) | once at init |
| `cancelCtx`         | parent, mu, done, children, err, cause | one struct |
| `timerCtx`          | embeds cancelCtx + timer + deadline | one struct + one timer |
| `valueCtx`          | parent, key, val | one small struct |
| `withoutCancelCtx`  | parent | one tiny wrapper |
| `afterFuncCtx`      | embeds cancelCtx + once + f | one struct |
| `stopCtx`           | parent + stop func | one wrapper |

When you call `context.WithTimeout(parent, 200*time.Millisecond)`, you are not getting a generic context. You are getting a pointer to a `timerCtx`, which contains a `cancelCtx`, which contains the bookkeeping for the cancellation tree, plus a `time.Timer` armed to fire in 200 ms.

---

## The Singletons: Background and TODO

Both `Background()` and `TODO()` return interface values that wrap a tiny empty struct. The relevant lines:

```go
type emptyCtx struct{}

func (emptyCtx) Deadline() (deadline time.Time, ok bool) { return }
func (emptyCtx) Done() <-chan struct{}                    { return nil }
func (emptyCtx) Err() error                               { return nil }
func (emptyCtx) Value(key any) any                        { return nil }

type backgroundCtx struct{ emptyCtx }
type todoCtx       struct{ emptyCtx }
```

Both `backgroundCtx` and `todoCtx` embed `emptyCtx`, inheriting its four methods. The only difference is their `String()` methods:

```go
func (backgroundCtx) String() string { return "context.Background" }
func (todoCtx)       String() string { return "context.TODO" }
```

`Background()` and `TODO()` are functions but they always return the **same** value:

```go
func Background() Context { return backgroundCtx{} }
func TODO() Context       { return todoCtx{} }
```

In Go, returning a zero-sized struct allocates nothing — the value lives in a single global memory slot. So calling `Background()` a million times allocates zero bytes. The compiler may even inline the call.

This is why `Background()` is "free." It is the *only* free constructor in the whole package.

---

## The Workhorse: cancelCtx

Almost everything interesting in `context` is in this struct:

```go
type cancelCtx struct {
    Context // the parent

    mu       sync.Mutex            // protects following fields
    done     atomic.Value          // of chan struct{}, created lazily
    children map[canceler]struct{} // set to nil by the first cancel call
    err      atomic.Value          // set to non-nil by the first cancel call
    cause    error                 // set to non-nil by the first cancel call
}
```

Five interesting fields plus the embedded parent. Let us tour them:

- **`Context` (embedded)** — the parent. Embedding means `cancelCtx` automatically delegates `Deadline`, `Done`, `Err`, and `Value` to the parent unless it overrides them. `cancelCtx` overrides `Done`, `Err`, and `Value`; `Deadline` is **not** overridden so it forwards to the parent (which is exactly what `WithCancel` should do — `WithCancel` does not change the deadline).
- **`mu`** — a mutex protecting the mutable fields below.
- **`done`** — an `atomic.Value` that, once populated, holds a `chan struct{}`. Until the first call to `Done()`, this is empty (zero) — the channel is **not allocated yet**.
- **`children`** — a `map[canceler]struct{}` of derived contexts. Each child registers itself here so that when this context cancels, it can in turn cancel all children.
- **`err`** — an `atomic.Value` that holds the reason for cancellation (`Canceled` or `DeadlineExceeded`).
- **`cause`** — the optional Go 1.20+ cause error.

### What `WithCancel` Returns

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    c := withCancel(parent)
    return c, func() { c.cancel(true, Canceled, nil) }
}

func withCancel(parent Context) *cancelCtx {
    if parent == nil { panic("...") }
    c := &cancelCtx{}
    c.propagateCancel(parent, c)
    return c
}
```

Three things happen:

1. A fresh `cancelCtx{}` is heap-allocated.
2. `propagateCancel` registers this new context with its parent so that parent cancellation flows down.
3. A closure is returned that calls `c.cancel(true, Canceled, nil)`.

The returned `CancelFunc` is small — Go closures share an underlying object, so the `cancel` closure costs roughly one pointer plus the function pointer.

### Why `Done()` Is Lazy

Reread the body:

```go
func (c *cancelCtx) Done() <-chan struct{} {
    d := c.done.Load()
    if d != nil {
        return d.(chan struct{})
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    d = c.done.Load()
    if d == nil {
        d = make(chan struct{})
        c.done.Store(d)
    }
    return d.(chan struct{})
}
```

The first time `Done()` is called, the channel is created with `make(chan struct{})`. Until then, the field is empty and **no channel exists**.

This matters. Many short-lived contexts never have their `Done` channel observed — for instance, when a downstream call completes before `select { case <-ctx.Done() }` ever fires. In those cases, we save the cost of channel allocation entirely.

When `cancel` runs and `done` is still empty, the runtime substitutes a pre-created `closedchan`:

```go
var closedchan = make(chan struct{})

func init() {
    close(closedchan)
}
```

So if you call `cancel()` and only later call `Done()`, you do not pay for a fresh channel: you get the package-global `closedchan`, which is already closed. Receiving from it returns immediately. Cheap and correct.

---

## Adding a Deadline: timerCtx

`WithDeadline` and `WithTimeout` both produce a `timerCtx`:

```go
type timerCtx struct {
    cancelCtx
    timer    *time.Timer
    deadline time.Time
}
```

It embeds `cancelCtx`, which means it gets all the cancellation machinery for free. It adds:

- A `time.Timer` that will fire at the deadline and call `cancel(true, DeadlineExceeded, cause)`.
- The actual `time.Time` deadline value (so that `Deadline()` can return it instead of forwarding to the parent).

The `Deadline()` method is overridden:

```go
func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
    return c.deadline, true
}
```

And the `cancel` method takes care of stopping the timer:

```go
func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(c.cancelCtx.Context, c)
    }
    c.mu.Lock()
    if c.timer != nil {
        c.timer.Stop()
        c.timer = nil
    }
    c.mu.Unlock()
}
```

This is why calling the returned `CancelFunc` is important even if the work completed early: the underlying `time.Timer` still has a goroutine inside it scheduled to fire. Stopping it releases that timer slot in the runtime's timer heap.

### What an Allocation Looks Like

A single `context.WithTimeout(parent, 200*time.Millisecond)` performs roughly:

1. One heap allocation for the `timerCtx` struct.
2. One call to `time.AfterFunc(dur, …)`, which allocates a `time.Timer` and a runtime timer record.
3. A small closure for the `CancelFunc`.

So at least three heap-touching events. In a tight hot path at 200k req/s, this becomes measurable. That is why high-performance services avoid repeated `WithTimeout` calls per inner sub-call.

---

## Adding a Value: valueCtx

```go
type valueCtx struct {
    Context
    key, val any
}
```

Three fields: the embedded parent, the key, and the value. That is the smallest possible carrier.

```go
func WithValue(parent Context, key, val any) Context {
    // ... validity checks ...
    return &valueCtx{parent, key, val}
}
```

One allocation, four pointer-sized fields (parent interface = 2 words, key any = 2 words, val any = 2 words; ignoring alignment). Cheap to construct.

### Why Lookup Is O(depth)

```go
func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return value(c.Context, key)
}
```

If the key matches, return. Otherwise, recurse into the parent. The actual recursion is in the unexported `value` function which is a single `for` loop over the chain.

So `ctx.Value(k)` cost grows linearly with the number of `WithValue` ancestors you have to walk through before you find your match. If you have 6 values stacked and you look up the deepest one, you walk all 6.

This is the source of the rule of thumb: **do not abuse `context.WithValue` for many small fields**. Stack them into one struct, store the struct as one value.

---

## Go 1.21+ Additions

Three new shapes were added in Go 1.21:

### `WithoutCancel(parent) Context`

Returns a context that **does not** inherit cancellation but **does** inherit values. The implementation is small:

```go
type withoutCancelCtx struct {
    c Context
}

func (withoutCancelCtx) Deadline() (deadline time.Time, ok bool) { return }
func (withoutCancelCtx) Done() <-chan struct{}                    { return nil }
func (withoutCancelCtx) Err() error                               { return nil }

func (c withoutCancelCtx) Value(key any) any {
    return value(c, key)
}
```

`Done` returns `nil` (just like `Background`). `Err` returns `nil`. `Value` forwards. So the wrapper behaves like a `Background` that happens to carry values up the chain.

Use case: a long-running side task spawned from a request handler that should not be canceled when the request ends.

### `AfterFunc(ctx, f) func() bool`

Schedules `f` to run after `ctx` is canceled. Returns a `stop` function that aborts the registration. Implemented as an `afterFuncCtx`:

```go
type afterFuncCtx struct {
    cancelCtx
    once sync.Once
    f    func()
}
```

We will not unpack this yet. The middle page covers it.

### `WithDeadlineCause(parent, d, cause)` / `WithTimeoutCause(parent, t, cause)`

Variants of `WithDeadline` and `WithTimeout` that attach an explicit `cause` error to be returned by `context.Cause(ctx)` after the deadline fires. Useful for diagnostics — "this canceled because the user clicked stop" rather than just "deadline exceeded".

These do not introduce new types. They use the same `timerCtx` and stash the cause in the cancellation call.

---

## Where the Source Lives

The whole package is one file:

```
$GOROOT/src/context/context.go
```

On a Linux box with Go installed, that is usually `/usr/local/go/src/context/context.go` or `~/sdk/go1.22/src/context/context.go`. On macOS with Homebrew, it is somewhere like `/opt/homebrew/Cellar/go/.../libexec/src/context/context.go`. The file is roughly 800 lines including comments — short by Go standard-library standards.

Also relevant:

```
$GOROOT/src/context/x_test.go         — public-API tests
$GOROOT/src/context/context_test.go   — internal tests
$GOROOT/src/context/benchmark_test.go — micro-benchmarks
```

If you want to see how the maintainers exercise the package, the tests are the second thing to read after the package itself.

---

## A Tiny Picture of Allocation

Let us add up the allocations for a typical request:

```go
ctx := context.Background()                                  // 0 alloc
ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond) // ~3 (struct + timer + closure)
defer cancel()
ctx = context.WithValue(ctx, traceKey{}, "abc")              // 1 (valueCtx)
ctx = context.WithValue(ctx, userKey{}, 42)                  // 1 (valueCtx)
// pass to handlers ...
```

Five allocations for one request. Multiply by 50,000 requests per second and that is 250,000 allocations per second from contexts alone. Not catastrophic, but worth a budget line. We will return to this on the optimize page.

You can verify with `go test -bench . -benchmem`:

```
BenchmarkWithTimeout-8   3000000   400 ns/op   200 B/op   3 allocs/op
BenchmarkWithValue-8     50000000   25 ns/op    32 B/op   1 allocs/op
```

(Actual numbers vary by Go version and CPU.)

---

## A First Look at the cancelCtx Picture

Picture a `cancelCtx` as a small box with five labelled slots:

```
┌──────────────────────────────────────┐
│            *cancelCtx                │
│                                      │
│  parent  ───────────► other ctx      │
│  mu      [sync.Mutex]                │
│  done    [chan struct{} or nil]      │
│  children {child1, child2, ...}      │
│  err     [nil before cancel]         │
│  cause   [nil or user-supplied err]  │
└──────────────────────────────────────┘
```

Five things to remember:

- **parent** — where the context came from. Could be another cancelCtx, a backgroundCtx, a valueCtx, anything. Stored as an interface (so we lose the concrete type unless we look it up via `Value`).
- **mu** — a mutex. We do not need to know exactly when it is held; the package handles that. Just know that *all the dangerous writes happen under this lock*.
- **done** — the channel that closes on cancel. Starts empty. Allocated when first needed.
- **children** — a map of contexts that derive from us. When we cancel, we cancel each child too.
- **err** — the cancellation reason. Before cancel: `nil`. After: `Canceled` or `DeadlineExceeded`.
- **cause** — optional explanation (e.g., "user clicked stop").

Note that the picture does not include a deadline. `cancelCtx` itself does not have one. `timerCtx` adds the deadline by *embedding* `cancelCtx` plus its own timer field.

### A Tiny Concrete Example

```go
ctx, cancel := context.WithCancel(context.Background())
// At this point:
//   ctx is a *cancelCtx
//   ctx.parent is context.Background() (a backgroundCtx)
//   ctx.done is nil (no one has called Done() yet)
//   ctx.children is nil (no children yet)
//   ctx.err is nil
//   ctx.cause is nil

<-ctx.Done()
// Allocating ctx.done is forced; it is now a chan struct{}.

cancel()
// Now:
//   ctx.err is Canceled
//   ctx.cause is Canceled (fell back to err)
//   ctx.done is closed
//   ctx.children is nil (was already nil)
```

This is the shortest possible cancelCtx lifecycle. Every other usage builds on it.

---

## Watching the Done Channel Close

To feel how `Done()` actually behaves, run this little program:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())

    go func() {
        time.Sleep(500 * time.Millisecond)
        fmt.Println("calling cancel()")
        cancel()
    }()

    fmt.Println("waiting on ctx.Done() ...")
    <-ctx.Done()
    fmt.Println("ctx.Done() fired; ctx.Err() =", ctx.Err())
}
```

Output:

```
waiting on ctx.Done() ...
calling cancel()
ctx.Done() fired; ctx.Err() = context canceled
```

What happened internally?

1. `context.WithCancel(context.Background())` constructed a `*cancelCtx` with parent = Background. Allocations: one cancelCtx struct, one CancelFunc closure. No channel yet.
2. The main goroutine called `ctx.Done()`. This is the first call, so the lazy code path ran: under the mutex, the package allocated `make(chan struct{})` and stored it. Now the channel exists.
3. The main goroutine then started receiving from the channel. Because the channel is not closed and not buffered, the goroutine parked.
4. After 500 ms, the background goroutine called `cancel()`. This invoked `c.cancel(true, Canceled, nil)`. The package took the mutex, set `err = Canceled`, set `cause = Canceled`, closed the channel, set children = nil, released the mutex, then called `removeChild` against the parent (Background — nothing to do).
5. Closing the channel unparked our main goroutine. The receive returned.
6. The main goroutine called `ctx.Err()`. The atomic-loaded `err` was non-nil, so the method received from the (now closed) channel, then returned `Canceled`.

The whole story takes microseconds. The mental model — "Done is a channel that closes; Err tells you why" — covers it from outside.

---

## The CancelFunc Closure

When `WithCancel` returns, the second value is a `CancelFunc`. Where does it come from?

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    c := withCancel(parent)
    return c, func() { c.cancel(true, Canceled, nil) }
}
```

It's a closure. `func() { c.cancel(true, Canceled, nil) }` captures `c` (the new cancelCtx pointer) and ignores its environment. The compiler allocates this closure on the heap — that's our second allocation in `WithCancel`.

You can store this closure, call it from anywhere, call it many times. It is safe to call concurrently. After the first call, subsequent calls are no-ops (because `c.cancel` checks `c.err.Load() != nil` at the top and returns immediately).

### `defer cancel()` is the Standard Idiom

You will see this on every page of every Go tutorial:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

Why "defer"? Because forgetting to call `cancel()` leaks the cancelCtx forever (the parent's `children` map still points at it). Defer guarantees the call happens when the function returns, regardless of which branch we exit on.

`defer cancel()` is the **single most important convention** in the package. Internalise it.

---

## What a Tree of Contexts Looks Like

A real handler might build a small tree:

```go
func handle(req *http.Request) {
    ctx := req.Context()                                  // root
    ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    ctx = context.WithValue(ctx, traceKey{}, traceFrom(req))

    go fetchA(ctx)
    go fetchB(ctx)
}
```

The tree looks like:

```
req.Context() (cancelCtx behind the scenes, from net/http)
  └─ *timerCtx (our 200ms wrap)
       └─ *valueCtx (key=traceKey)
            ├─ used by fetchA
            └─ used by fetchB
```

`fetchA` and `fetchB` both see the same context. If `fetchA` derives more contexts (a `WithTimeout`, a `WithValue`), the tree grows beneath it. Each leaf only knows its own pointer up; it does not see siblings.

### Cancellation Flows Down

If `req` is canceled (client disconnect), the server's context cancels, which cancels our `timerCtx` (because it registered in the request's children), which cancels nothing further (valueCtx is uncancellable on its own — it inherits Done from the timerCtx).

`fetchA` and `fetchB` both observe `ctx.Done()` close. They abandon their work and return.

### Values Flow Down Too

A handler deeper in the call graph can write:

```go
v, _ := ctx.Value(traceKey{}).(string)
```

This walks up from wherever it is to the `valueCtx` we created and finds the trace ID. The walk crosses any intermediate contexts (timerCtx, cancelCtx) transparently because their `Value` methods delegate to their parents.

This is the propagation model: cancellation **down**, values **up** (when looked up).

---

## How `Value` Walks the Tree

To make the upward walk concrete, here is a slightly enriched chain:

```
context.Background()                  ← top
  → *valueCtx (key=A, val=1)
    → *valueCtx (key=B, val=2)
      → *cancelCtx
        → *valueCtx (key=C, val=3)
          → leaf
```

Calling `leaf.Value(A)`:

1. leaf is a `*valueCtx`. Its key is C, not A. Continue to leaf.Context.
2. `*cancelCtx`. Its embedded Context is the parent. Continue.
3. `*valueCtx`. Its key is B, not A. Continue.
4. `*valueCtx`. Its key is A! Return its value, 1.

That walk took 4 hops to find a 4-deep ancestor. O(depth).

Calling `leaf.Value("Z")` for a missing key:

1. leaf — C ≠ Z. Continue.
2. cancelCtx — continue.
3. valueCtx — B ≠ Z. Continue.
4. valueCtx — A ≠ Z. Continue.
5. backgroundCtx — terminate, return nil.

5 hops for a miss. Slightly longer because we have to walk all the way to the root.

If you do hundreds of these per request, depth times count adds up. That is why the consolidation advice exists: stack many fields into one struct so the chain stays shallow.

---

## Why Many Small Allocations Matter

A common reaction from new Go developers: "These are tiny allocations. Why care?"

Two reasons.

### 1. They show up in profiles

Run `pprof` against a high-throughput service and look at the allocation profile:

```
File: server
Type: alloc_space
Showing top 10 nodes out of 200
      flat  flat%   sum%        cum   cum%
   1.50GB 12.34% 12.34%     1.50GB 12.34%  context.WithTimeout
   1.20GB  9.87% 22.21%     1.20GB  9.87%  context.WithValue
   ...
```

`context.WithTimeout` allocates 1.5 GB of working set over the profile window. The GC has to scan that. Each cycle through the heap costs CPU. At some point, the GC scan time *dominates* your service's CPU.

### 2. They live on the heap and pressure GC

Stack allocations are essentially free. Heap allocations cost (a) the time to allocate, (b) the GC's time to track them, (c) eventually the time to free them. The bigger your heap, the longer GC pauses get.

For a service with a strict latency SLO (say p99 = 5 ms), GC pauses bigger than 1-2 ms can violate the SLO. Heap reduction directly improves tail latency.

### 3. Channels and goroutines are the heaviest pieces

Within context, the biggest items are:

| Object               | Approx size |
|----------------------|-------------|
| `chan struct{}`      | 96 bytes + runtime hchan metadata |
| Forwarder goroutine  | ~2 KB stack while parked |
| `time.Timer`         | ~64 bytes + runtime timer record |
| `cancelCtx` struct   | ~80 bytes |
| `valueCtx` struct    | ~48 bytes |
| `withoutCancelCtx`   | ~16 bytes |

Channels and goroutines are the heavy hitters. The lazy `done` channel optimisation is *very* important — it saves the 96-byte allocation per context that doesn't need it.

---

## Reading the Source in 30 Minutes

If this page sparked your curiosity, here is a 30-minute reading plan:

1. **Minutes 0–5**: Open `src/context/context.go`. Skim the top doc comment for the package overview.
2. **Minutes 5–10**: Read the `Context` interface definition and its doc comment. Note the four methods.
3. **Minutes 10–15**: Read `emptyCtx`, `backgroundCtx`, `todoCtx`, and the `Background()` / `TODO()` functions. Two pages, mostly comments.
4. **Minutes 15–20**: Read `cancelCtx` (the struct only, not the methods). Note the five fields.
5. **Minutes 20–25**: Read `cancelCtx.Done` and `cancelCtx.Err`. Note the double-checked locking.
6. **Minutes 25–30**: Read `cancelCtx.cancel`. Note the order: take lock, set err, close done, cascade, nil children, release lock.

You have now read the most important 200 lines of the package. The other 600 are extensions of these patterns. The middle and senior pages cover them at depth.

---

## Comparison With Other Languages

Where does `context` sit in the broader world?

| Language | Closest concept              | Cancellation? | Deadline? | Values?  |
|----------|------------------------------|---------------|-----------|----------|
| Go       | `context.Context`            | Yes           | Yes       | Yes      |
| C++      | `std::stop_token` (C++20)    | Yes           | No        | No       |
| C++      | `std::future`                | No (just await) | Sometimes | No   |
| Java     | `CompletableFuture` + cancel | Yes           | Yes       | No       |
| Java     | `ThreadLocal`                | No            | No        | Yes      |
| Rust     | `tokio_util::sync::CancellationToken` | Yes  | No        | No       |
| Rust     | `tokio::time::timeout`       | Implicit      | Yes       | No       |
| Rust     | `tracing::Span` + extensions | No            | No        | Yes      |
| C#       | `CancellationToken`          | Yes           | No (via `CancelAfter`) | No |
| Python   | `asyncio.Task.cancel()`      | Yes           | Via `wait_for` | No |

A few observations:

- **Go is unusual in fusing all three concerns** (cancel, deadline, value-bag) into one type. Most ecosystems split them across distinct primitives.
- **The tree-of-cancellations model is shared with C# and Rust's `CancellationToken`**, both of which support hierarchical linkage similar to `WithCancel`.
- **Values-in-context** is essentially what `ThreadLocal` is for Java, but local to a call chain rather than to a thread, which matches Go's "context flows with the request" model better.
- **No language fully replicates `WithoutCancel`**. The closest is C# `CancellationTokenSource(token, none)` patterns; in Java you would build a new orphaned token explicitly.

---

## A Brief History

A short timeline so you know where this all came from:

- **2014**: Sameer Ajmani and team at Google publish the original `context` package as `golang.org/x/net/context`. Goal: a unified way to plumb cancellation and deadlines through Google's RPC handlers.
- **August 2016 (Go 1.7)**: `context` joins the standard library. The API and semantics standardise across the ecosystem.
- **2020 (Go 1.16)**: `signal.NotifyContext` lands — convenience for "cancel on SIGINT/SIGTERM".
- **2022 (Go 1.20)**: `WithCancelCause` and `Cause(ctx)` introduce causal cancellation. You can now tag *why* a context was canceled.
- **August 2023 (Go 1.21)**: `AfterFunc`, `WithoutCancel`, `WithDeadlineCause`, `WithTimeoutCause`. The "extension pack."

The interface itself has stayed unchanged since 2016. Every addition has been a new free-function on top of the existing four methods.

Reading the original Sameer Ajmani blog post ("[Go Concurrency Patterns: Context](https://go.dev/blog/context)", 2014) is still worthwhile — the motivation is the same today as it was then.

---

## Common Misconceptions

A short collection of beliefs that new Go engineers often hold about `context`. Each is incorrect; each correction is rooted in the internals we toured.

### "Context cancels stop running goroutines."

**No.** Cancellation only closes the `Done` channel. A goroutine that does not select on `ctx.Done()` is unaffected. Cancellation is a *signal*, not a *kill*.

If you want a goroutine to actually stop, you have to plumb `ctx.Done()` into its select statement (or into a blocking operation that supports context, like `net.Conn.SetReadDeadline`).

### "Calling `cancel()` frees all the memory immediately."

**Partly.** It does *trigger* freeing — it nils the children map, which removes references to child contexts. But the child contexts themselves still exist until the GC sweeps them. And the memory of the parent's struct still exists until *its* parent's reference is dropped.

GC is non-deterministic. Memory pressure relief happens, but not instantly.

### "Background() and TODO() do the same thing — why have both?"

**Semantically yes, intent-wise no.** They are equivalent in behaviour but distinct in type. The package authors chose to have `TODO()` so that code reviewers can grep for incomplete plumbing without having to read every `Background()` call to judge whether it is final.

### "Context is just a thread-local."

**No.** A `ThreadLocal` (Java) is keyed by the thread that runs the call; in Go, a context is **explicitly passed** to each function. The difference matters when work crosses goroutines: in Java, the new thread starts with empty `ThreadLocal` unless you copy; in Go, the called function gets exactly the context you handed it. The flow is explicit.

This is one of Go's deliberate design choices. It is verbose (every function takes `ctx context.Context`) but it avoids the action-at-a-distance bugs that thread-locals create.

### "`WithValue` is for any data I want to pass through."

**No.** `WithValue` is for **request-scoped data** that crosses API boundaries. Optional parameters, configuration, computed results should still be regular function arguments. The godoc states this explicitly.

The reason is twofold: `Value` lookups are slow (chain walks) and type-unsafe (`any` everywhere). Regular arguments are fast and statically checked.

### "I should pass `nil` as a context to mean 'no context'."

**No.** All public functions in the standard library panic if you pass `nil`. Use `context.TODO()` for placeholder, `context.Background()` for "this really has no enclosing context."

Inside the `context` package itself, the constructors `WithCancel`, `WithDeadline`, etc., explicitly check for nil and panic:

```go
if parent == nil {
    panic("cannot create context from nil parent")
}
```

This is a fail-fast design. A nil context propagating through your code would crash in obscure places; the panic at the source makes the bug obvious.

### "I can store the context in a struct field for later use."

**Strongly discouraged.** The Go community's advice is "contexts flow through function arguments, not data structures." Storing a context in a struct usually means the struct's lifetime decides when the context applies, which decouples cancellation from the original request's lifetime — exactly what context was supposed to make explicit.

There are rare valid exceptions (e.g., a "session" object that genuinely lives for the duration of a request and is built once at request entry). In those cases, document loudly.

### "`Done()` returns a buffered channel."

**No.** It returns an unbuffered channel of `struct{}`. The point is to be a closed-channel signal. Closing an unbuffered channel makes all receivers unblock simultaneously, which is exactly what cancellation wants. Buffering would be irrelevant — we never send on the channel, we only close it.

### "I can re-open a context by creating a new cancel func."

**No.** The `Done` channel, once closed, cannot be reopened. The package does not support resume/restart semantics. If you need that, you need a different primitive (a custom `chan struct{}` with manual reset, or a `sync.Cond`).

### "The context can tell me where it came from."

**No.** There is no `ctx.Parent()` method. The only way to access the parent is by calling `ctx.Value(someKey)` and hoping the parent has that key. The parent relationship is internal to the package.

This is intentional: callers should not depend on the tree structure. The contract is just the four methods.

### "If I forget `defer cancel()`, the GC will clean up eventually."

**Eventually, yes, but only after the *parent* context is also garbage-collected.** If the parent is `context.Background()`, the parent lives forever and the child lives forever. If the parent is a request context, the child lives until the request ends — which is fine but wasteful.

For the request case, the leaked timer is the bigger problem. A leaked `time.Timer` from a `WithTimeout` sits in the runtime timer heap until it fires. Not GC-able.

So always `defer cancel()`. The cleanup is not free, and the GC cannot rescue you from logical leaks.

---

## What to Read Next

If your goal is to use context **correctly**, you can stop here.

If your goal is to **debug** context-related bugs, head to the middle page: it covers `propagateCancel`, the parent-watcher goroutine, and the `removeChild` mechanism that breaks circular references when a child is canceled before its parent.

If your goal is to **performance-tune** a hot path, read the senior and optimize pages. They cover allocation-saving tricks, the fast path in `parentCancelCtx`, and the trade-offs of custom `Context` types.

If your goal is to **rewrite** the package (e.g., to prototype a new cancellation mechanism), read the professional page, which steps through every type and method line by line.

---

## Bonus: Walking Through a Real Request

Let us trace what happens, step by step, when a request comes into an HTTP server. Open this in your head as you read along.

```go
func main() {
    rootCtx, rootCancel := signal.NotifyContext(
        context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer rootCancel()

    srv := &http.Server{
        Addr:    ":8080",
        Handler: mux,
        BaseContext: func(net.Listener) context.Context {
            return rootCtx
        },
    }
    srv.ListenAndServe()
}
```

### Step 1: At process start

`context.Background()` returns a `backgroundCtx{}`. Zero allocations.

`signal.NotifyContext(parent, ...)` derives a child context that cancels on the listed signals. Internally, this is a `cancelCtx` plus a goroutine that watches a signal channel.

Allocations so far: one cancelCtx (~80 bytes), one channel (~96 bytes), one CancelFunc closure (~16 bytes), one goroutine.

### Step 2: A request arrives

`net/http` accepts a connection and constructs a request. For each request, it derives a fresh `*cancelCtx` from the `BaseContext` (our `rootCtx`). It also wires up the connection so that when the client closes, the request's context cancels.

Allocations per request: one cancelCtx (~80 bytes), one CancelFunc closure (~16 bytes). Plus an entry in `rootCtx.children` (one map slot, maybe a map alloc if this is the first request).

### Step 3: The handler runs

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    ctx = context.WithValue(ctx, traceKey{}, traceID(r))

    result, err := doWork(ctx)
    // ...
}
```

- `r.Context()` returns the request's cancelCtx — no allocation.
- `WithTimeout` allocates a `timerCtx` (~80 bytes), a `time.Timer` (~150 bytes), and a CancelFunc closure (~16 bytes). It also adds this timerCtx to the request's `children` map (one slot).
- `WithValue` allocates a `valueCtx` (~48 bytes).

Total per-handler allocations: ~310 bytes plus a timer record.

### Step 4: doWork derives its own contexts

```go
func doWork(ctx context.Context) (Result, error) {
    cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
    defer cancel()
    cacheVal, _ := cache.Get(cacheCtx, key)
    // ...
}
```

Another timerCtx, another timer, another CancelFunc. Plus addition to `ctx.children`.

This is the cumulative cost: each layer of derivation adds heap pressure. At 50,000 requests per second with 6 derivations each, you allocate about 100 MB/sec from context plumbing alone.

### Step 5: The request completes

The handler returns. Deferred `cancel()` calls fire in reverse order:

1. `WithTimeout`'s cancel from inside `doWork` fires. The associated timerCtx's `cancel(true, Canceled, nil)` runs: takes mutex, sets err, closes done channel, drops children, releases mutex, calls `removeChild` against its parent.
2. `WithTimeout`'s cancel from the handler fires. Same dance.
3. `http.Server`'s machinery calls the request context's cancel (the one created in step 2). Same dance.

At each step, `removeChild` cleans up the entry in the parent's children map. By the time the request is gone, no traces remain in `rootCtx.children`.

### Step 6: Eventually, shutdown

When the process receives SIGTERM:

1. `signal.NotifyContext`'s machinery cancels `rootCtx`.
2. The cancel cascades: any in-flight request still has a children-map entry; each gets canceled.
3. Active goroutines selecting on `Done()` see it close. They return.
4. `srv.ListenAndServe()` returns. `main` exits.

The cascade is the package's contribution to graceful shutdown. Without context, you would have to manually track every long-running operation.

### What This Tells You

A real handler creates ~6 contexts per request. Each context is small but the count adds up.

A real server starts maybe one root context plus the per-connection ones the standard library makes for you.

The lifecycle is short — milliseconds for the request context, the full process for the root.

Knowing this, you can predict where pprof will show context costs (in `WithTimeout` and `WithValue`), and you can reason about whether to consolidate (yes, if you see them in the top-10 alloc list).

---

## One Last Thought: Why the Package Is So Small

The `context` package is ~800 lines. The runtime is 50,000+ lines. The `net/http` package is 30,000+ lines. Yet `context` is shipped with every Go binary and runs in every request handler.

Its smallness is its strength. There is not much that can go wrong. The whole package can be re-read in an afternoon. Bugs are findable in pull-request reviews. New features can be added without breaking old ones — and the history of the package proves it: from 2014 to 2024, every API addition has been backward-compatible.

The package is also old enough that every imaginable shape of bug has been found. By the time you encounter a strange behaviour, someone has filed an issue, the maintainers have discussed it, and the fix (if any) is in some recent release. The package's mailing-list archives are an underrated resource.

When learning Go, the `context` package is one of the few places where reading the source is more rewarding than reading the documentation. The doc is short and intentional; the source is short and beautiful. Treat it as a study text, not a black box.

---

## What to Read Next, Concrete Plan

A learning sequence that builds on this page:

1. **Re-read this page** with `src/context/context.go` open in another window. Cross-reference each diagram against the actual code.
2. **Read [middle.md](middle.md)** to understand `propagateCancel` and `removeChild`.
3. **Read [senior.md](senior.md)** to see the other types: `timerCtx`, `valueCtx`, `withoutCancelCtx`, `afterFuncCtx`.
4. **Read [professional.md](professional.md)** for the full source walkthrough.
5. **Skim [specification.md](specification.md)** for the formal contract — you will reference this when discussing custom Context implementations.
6. **Work [tasks.md](tasks.md)** to internalise everything.
7. **Practice with [find-bug.md](find-bug.md)** to recognise pitfalls.
8. **Read [optimize.md](optimize.md)** if and when your service profiles show context overhead.

If you do all eight, you will be among the small group of Go engineers who can confidently answer "what does `context` actually do?" with detailed, evidence-based reasoning.

Next: [middle.md](middle.md) — propagation, the children map, and the parent watcher.

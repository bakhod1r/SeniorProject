# Context Source — Junior

## 1. What is `context`?

`context` is a small standard-library package whose job is to carry three things across API boundaries and between goroutines:

1. **Cancellation** — a signal that says "stop what you're doing, the caller doesn't care anymore."
2. **Deadlines** — a point in time after which work should be abandoned.
3. **Request-scoped values** — small bits of data that travel with a request (trace IDs, auth tokens) without being shoved into every function signature.

The package is tiny — one main file, a handful of types, a handful of constructors. But it shows up *everywhere* in modern Go: HTTP handlers, database calls, RPC clients, anything that can block or take "a while." Understanding it well is one of the highest-leverage things a junior Go developer can do.

> If you came from Java, think of `context` as a more disciplined `ThreadLocal` combined with a `CancellationToken`. If you came from Node, think of it as an `AbortSignal` that also carries values.

---

## 2. Where the source lives

On your machine:

```bash
go env GOROOT
ls $(go env GOROOT)/src/context
```

You will see a very short directory:

| File | What it covers |
|------|----------------|
| `context.go` | The `Context` interface, all four built-in implementations, and every constructor |
| `x_test.go` | The exported-API tests — good examples of *intended* usage |
| `context_test.go` | Internal tests — exercises the cancellation tree, deadlines, races |
| `benchmark_test.go` | Microbenchmarks for `WithCancel`, `Value`, etc. |
| `afterfunc_test.go` | Tests for `AfterFunc` (a newer addition) |

Compared to the runtime, `context` is *small* — `context.go` is around 800-900 lines depending on the Go version. You can read the whole thing in an afternoon. That's the point of this topic: pick a stdlib package small enough to actually finish.

The same source lives at `github.com/golang/go/tree/master/src/context`. Pin to a release tag (e.g., `go1.22.0`) so the line numbers in your notes stay valid.

---

## 3. Prerequisites

- Comfort writing goroutines and reading channel code.
- Familiarity with interfaces — `context.Context` is just an interface.
- Knowing that `select { case <-ch: ... }` is how you wait for a signal.

You do **not** need to understand timers, the runtime scheduler, or generics. Those help, but `context` itself is plain Go.

---

## 4. The `Context` interface

The whole package hinges on one interface:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Four methods. Read them slowly:

- **`Deadline()`** — "do you have a hard cutoff?" Returns the time and `ok=true` if yes; zero time and `ok=false` if none.
- **`Done()`** — "give me a channel I can `<-` on. It closes when this context is cancelled or its deadline passes." This is the cancellation signal.
- **`Err()`** — "if you're done, why?" Returns `nil` while alive; `context.Canceled` or `context.DeadlineExceeded` after `Done()` closes.
- **`Value(key)`** — "do you carry a value under this key?" Walks the parent chain.

A `Context` is **immutable**. You don't "set" cancellation on it. You build a *new* context from an existing one, and that new one knows how to be cancelled.

---

## 5. The constructors

There are six functions that produce a `Context`. Learn these names — they're 90% of what you'll type.

| Constructor | Purpose | Typical caller |
|-------------|---------|----------------|
| `context.Background()` | The empty root. Never cancelled, no deadline, no values. | `main`, `init`, top of a server |
| `context.TODO()` | Same shape as `Background`, but signals "I haven't decided yet." | Placeholder while refactoring |
| `context.WithCancel(parent)` | Returns child + a `cancel func()`. Calling `cancel` closes `Done()`. | Any function that may want to stop work early |
| `context.WithDeadline(parent, t)` | Child that cancels itself at time `t` (or when parent cancels, whichever is first). | Hard cutoff: "this must finish by 12:00:00" |
| `context.WithTimeout(parent, d)` | Sugar for `WithDeadline(parent, time.Now().Add(d))`. | "give this up to 5 seconds" |
| `context.WithValue(parent, key, val)` | Child that returns `val` for `Value(key)`, else delegates to parent. | Attaching a request ID, user, trace span |

Notice all four "With…" constructors take a *parent* context as the first argument. Contexts form a **tree** rooted at `Background()` (or `TODO()`).

---

## 6. The canonical example

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := http.DefaultClient.Do(req)
if err != nil {
    // ctx.Err() will be context.DeadlineExceeded if we timed out.
    return err
}
defer resp.Body.Close()
```

Two things to lock in:

1. **`defer cancel()` always.** Even if the request finishes early, you must call `cancel`. The constructor allocates resources (a timer, a child node in the cancellation tree) and `cancel` releases them. Forgetting it is a leak, not a crash.
2. **The context flows into the call.** `NewRequestWithContext` attaches it to the request. The HTTP client checks `ctx.Done()` while reading the body. The whole timeout story is wired through one `ctx` argument.

---

## 7. Where context appears in the standard library

This is the "why context matters" tour. These are the high-traffic stdlib functions whose first argument is a `context.Context`:

- **`http.Request.Context()`** — the server hands you a context that is cancelled when the client disconnects.
- **`http.NewRequestWithContext(ctx, ...)`** — outbound HTTP calls that respect a deadline.
- **`(*sql.DB).QueryContext`, `ExecContext`, `BeginTx`** — database operations cancel the underlying query when `ctx` is done.
- **`(*net.Dialer).DialContext`** — dialing TCP/Unix sockets with a deadline.
- **`exec.CommandContext`** — runs a subprocess and kills it when `ctx` is done.
- **`os/signal.NotifyContext`** — a context cancelled when SIGINT/SIGTERM arrives. Perfect for graceful shutdown.

The pattern is consistent: any function that *blocks* or that does *I/O* and was added or revised after about Go 1.7 takes a `ctx` as its first parameter.

---

## 8. The cancellation propagation model

This is the single most important concept in the package.

When you call `WithCancel(parent)`, the returned child *inherits* parent's cancellation. Specifically:

- If **parent** is cancelled (or its deadline passes), **child** is cancelled too.
- If you call **child's** `cancel()`, only child (and child's descendants) are cancelled — parent keeps living.
- The relationship is one-way: parent down to children.

```
Background
  └── WithTimeout(15s)   ← root for one request
        ├── WithCancel    ← used by the DB query goroutine
        └── WithCancel    ← used by the HTTP fan-out goroutine
```

If the 15s timeout fires, both children's `Done()` channels close. If the DB child finishes early and its `cancel()` is called, the HTTP child is unaffected.

This is why **passing the same `ctx` deep into a call stack works**: each layer can derive its own child, but cancelling the root cancels everything underneath in one event.

---

## 9. Reading `context.go` for the first time

A recipe:

1. Open `$GOROOT/src/context/context.go`.
2. Search for `type Context interface` — that's the public contract. ~50 lines including the doc comments. Read all of it.
3. Search for `func Background` — see how trivially small `Background` and `TODO` are. They return package-level singletons of type `emptyCtx`.
4. Search for `func WithCancel` — note it returns a child *and* a `CancelFunc`. Follow into `newCancelCtx` to see what a real (non-empty) context looks like.
5. Search for `type cancelCtx struct` — the workhorse. Note it owns a `done chan struct{}`, a `children map[canceler]struct{}`, and an `err`.
6. Search for `func (c *cancelCtx) cancel(` — this is *the* function. When called, it closes `done`, sets `err`, and recursively cancels every child.

That's the core. `WithDeadline` and `WithTimeout` are `cancelCtx` plus a `time.AfterFunc`. `WithValue` is a tiny wrapper.

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **Parent context** | The `ctx` you pass into a `With…` constructor |
| **Child context** | What the `With…` constructor returns; cancels when parent does |
| **CancelFunc** | A `func()` returned by `WithCancel`/`WithDeadline`/`WithTimeout` — calling it cancels the child early |
| **Deadline** | A wall-clock time after which the context auto-cancels |
| **Timeout** | A duration; `WithTimeout(parent, d) == WithDeadline(parent, time.Now().Add(d))` |
| **Done channel** | The `<-chan struct{}` returned by `Done()`; closes on cancel |
| **Value key** | Any comparable value used as the lookup key in `WithValue`/`Value`; idiomatically a private named type, never a bare string |
| **emptyCtx** | The internal type behind `Background()` and `TODO()` — does nothing |
| **cancelCtx** | The internal type behind `WithCancel` — owns `done`, `err`, `children` |
| **timerCtx** | A `cancelCtx` plus a `time.AfterFunc` that calls cancel at the deadline |
| **valueCtx** | A wrapper that adds one key/value pair on top of a parent |

---

## 11. Common confusion at this level

- **"Context is goroutine-local." No.** It is *explicit*. You pass it as a parameter. Go has no `ThreadLocal`. If a goroutine needs the context, the caller hands it over.
- **"`context.WithValue` is for any data." No.** It's for **request-scoped** data — things that exist for the duration of one request and would otherwise pollute function signatures (trace ID, auth principal). Configuration, options, dependencies belong in struct fields or function parameters, not in `Value`.
- **"I must `Close` the context." No.** Contexts have no `Close` method. You call the `cancel` function returned by the constructor. If you didn't get a `cancel` (e.g., from `Background`), there's nothing to release.
- **"Skipping `defer cancel()` is fine if the timeout will fire anyway." No.** The timer is released, but the child node in the parent's `children` map sits until parent itself is cancelled. In a long-lived server, that's a memory leak `go vet` will warn about.
- **"`ctx.Done()` returns nil sometimes — is that a bug?" No.** `Background()` and `TODO()` return a nil `Done()` channel, because they never cancel. Receiving from a nil channel blocks forever — which is the correct "never fires" behavior in a `select`.
- **"Putting a `*sql.DB` in the context is convenient." Don't.** Dependencies belong in structs that own the handler, not in the context bag. `Value` is for *request data*, not global wiring.

---

## 12. The map you should leave with

```
$GOROOT/src/context/
├── context.go             # everything: interface, emptyCtx, cancelCtx,
│                          # timerCtx, valueCtx, all 6 constructors
├── x_test.go              # exported examples (Background, WithCancel,
│                          # WithTimeout, WithValue)
├── context_test.go        # internal tests — propagation, races, leaks
├── benchmark_test.go      # micro-benchmarks
└── afterfunc_test.go      # tests for AfterFunc (post-Go 1.21)
```

If you can:

- Name the four `Context` methods.
- Name the six constructors and their purpose.
- Explain why cancellation flows parent → child.
- Read the first 200 lines of `context.go` without panicking.

…you've achieved the junior-level goal of this topic.

---

## 13. Summary

`context` is a tiny package with an outsized footprint. It defines one interface (`Deadline`, `Done`, `Err`, `Value`), four internal context types (`emptyCtx`, `cancelCtx`, `timerCtx`, `valueCtx`), and six constructors (`Background`, `TODO`, `WithCancel`, `WithDeadline`, `WithTimeout`, `WithValue`). Contexts form a tree; cancellation flows down. You attach them to HTTP requests, SQL queries, network dials, and subprocesses. You **always** `defer cancel()` when you create one. At this level the goal is not to memorise every line of `context.go` — it's to read the interface, recognise the constructors when you see them, and feel comfortable with the parent/child propagation story.

Tomorrow, open `$GOROOT/src/context/context.go` and read `func WithCancel`. Don't try to follow every helper. Just notice how small it is.

---

## Further reading
- Go source: `https://github.com/golang/go/tree/master/src/context` (pin to `go1.22.0` or your installed version)
- `context` package docs: `https://pkg.go.dev/context`
- Sameer Ajmani, "Go Concurrency Patterns: Context" (2014, Go blog) — the original announcement post
- "Contexts and structs" — Go blog, on when *not* to embed contexts in structs
- `golang.org/x/net/context` history — useful to know `context` was an `x/` package before Go 1.7 absorbed it
- `errgroup` package (`golang.org/x/sync/errgroup`) — the most common companion to `context` in real code

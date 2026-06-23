# Deadlines and Cancellations — Junior

[← Back to index](junior.md)

## Why Context Exists

Imagine you call a function that talks to a database. The query takes a long time. You want to give up after 2 seconds, free the goroutine, and return an error to the caller. How does the function know it should stop?

In other languages you might use thread interruption, exceptions, or signal flags. Go answers with one type: `context.Context`. A `Context` is a small object that travels alongside every function call in a request, carrying two pieces of information:

1. **A signal.** "Stop what you're doing — the work is no longer needed."
2. **An optional deadline.** "Give up no later than this absolute time."

That is all. It is not a thread, not a future, not a promise. It is a deadline plus a `Done` channel.

```
┌──────────────────────────────────────────────────────┐
│  ctx                                                 │
│  ┌───────────────────────────┐                       │
│  │ Deadline:  17:42:01.500   │                       │
│  │ Done():    chan struct{}  │ ← closes on cancel    │
│  │ Err():     reason for end │                       │
│  │ Value(k):  request data   │                       │
│  └───────────────────────────┘                       │
└──────────────────────────────────────────────────────┘
```

Every blocking operation in the standard library that can take a `Context` does so as the **first parameter**. By convention the variable is named `ctx`.

```go
func FetchUser(ctx context.Context, id int) (*User, error) { ... }
```

If the context's deadline expires or the caller cancels, `FetchUser` is expected to return promptly with an error. It does that by selecting on `ctx.Done()` while it waits.

## The Context Interface

The full interface lives in the `context` package and has exactly four methods:

```go
package context

type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done()    <-chan struct{}
    Err()     error
    Value(key any) any
}
```

| Method     | Returns                                          | Use when |
|------------|--------------------------------------------------|----------|
| `Deadline` | absolute deadline, or `(zero, false)` if none    | Budgeting work that must fit within remaining time |
| `Done`     | channel that closes when canceled or expired     | `select { case <-ctx.Done(): ... }` |
| `Err`      | `nil`, `Canceled`, or `DeadlineExceeded`         | After `Done` fires, ask why |
| `Value`    | request-scoped value by key                      | Trace IDs, auth identity (sparingly) |

The first three are about cancellation. The fourth is about request-scoped values, which we cover briefly here and in detail in the Common Usecases section.

## Background and TODO

You never construct a `Context` directly. You start from one of two roots:

```go
ctx := context.Background() // top of main, tests, init
ctx := context.TODO()       // "I haven't decided yet"
```

Both return the same kind of empty context: no deadline, no values, `Done()` returns `nil`, and `Err()` returns `nil`. They differ only in **intent**:

- `Background()` is the documented root for the whole program: `main`, server entry points, top-level tests, and long-lived background workers.
- `TODO()` is a placeholder that says "this code path needs a real context but we have not threaded one through yet." Linters and reviewers can grep for `TODO()` to find unfinished plumbing.

> If you see `context.Background()` *deep inside* an HTTP handler or RPC, that is almost always a bug — you have detached from the request's cancellation tree.

## Deriving a Cancelable Context

The empty root is useless on its own. You wrap it to add cancellation:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
```

`WithCancel(parent)` returns:

- A new child context whose `Done()` channel will close when **either** `cancel()` is called or `parent.Done()` closes.
- A `cancel func()` that releases the resources held by this child.

The contract is: **always defer `cancel()`** — even if the child finishes naturally. Forgetting causes a goroutine and timer leak that `go vet` will flag.

```go
func process() error {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // <-- mandatory

    return doWork(ctx)
}
```

If `doWork` ever returns, `defer cancel()` runs, the child context is freed, and any goroutines selecting on its `Done()` get the signal. No leak.

## A First Cancelable Worker

Let's see cancellation in action with a tiny worker that prints a tick every 200 ms until told to stop.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func ticker(ctx context.Context) {
    t := time.NewTicker(200 * time.Millisecond)
    defer t.Stop()

    for {
        select {
        case <-ctx.Done():
            fmt.Println("ticker: stopping,", ctx.Err())
            return
        case now := <-t.C:
            fmt.Println("ticker:", now.Format("15:04:05.000"))
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    go ticker(ctx)

    time.Sleep(1 * time.Second)
    cancel() // sends the stop signal
    time.Sleep(300 * time.Millisecond)
}
```

What happens:

```
ticker: 15:04:01.200
ticker: 15:04:01.400
ticker: 15:04:01.600
ticker: 15:04:01.800
ticker: 15:04:02.000
ticker: stopping, context canceled
```

The **`select` with `<-ctx.Done()` is the heart of every Go cancellation**. Whenever you have a goroutine that can block, you teach it to also listen on `Done()`.

## WithTimeout — Time-Boxed Work

Most of the time you do not want to manually call `cancel()`; you want "stop after N seconds":

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()

if err := slowAPI(ctx); err != nil {
    log.Println("slowAPI failed:", err)
}
```

`WithTimeout(parent, d)` is equivalent to `WithDeadline(parent, time.Now().Add(d))`. After 2 seconds — or sooner if the parent cancels first — the context's `Done` channel closes and `Err()` returns `context.DeadlineExceeded`.

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()

select {
case <-time.After(500 * time.Millisecond):
    fmt.Println("did the slow thing")
case <-ctx.Done():
    fmt.Println("timed out:", ctx.Err()) // context deadline exceeded
}
```

You still must `defer cancel()` even though the timeout will eventually fire; the cancel call releases the timer immediately when work finishes early.

## WithDeadline — Absolute Time

Sometimes you have an absolute moment, like "the user's session expires at 17:00":

```go
sessionEnd := time.Date(2026, 5, 5, 17, 0, 0, 0, time.UTC)

ctx, cancel := context.WithDeadline(context.Background(), sessionEnd)
defer cancel()

if err := refreshUntilExpiry(ctx); err != nil {
    log.Println(err)
}
```

`WithDeadline` and `WithTimeout` are the same machine — the only difference is whether you give it `t` (a moment) or `d` (a duration).

## ctx.Err() — Two Sentinel Errors

Once `<-ctx.Done()` fires, you ask `ctx.Err()` why. There are exactly **two** values:

| Value                       | Meaning                                              |
|-----------------------------|------------------------------------------------------|
| `context.Canceled`          | Someone called `cancel()`                            |
| `context.DeadlineExceeded`  | The deadline arrived without anyone calling `cancel` |

```go
if err := doWork(ctx); err != nil {
    switch {
    case errors.Is(err, context.Canceled):
        log.Println("caller canceled")
    case errors.Is(err, context.DeadlineExceeded):
        log.Println("we ran out of time")
    default:
        log.Println("real error:", err)
    }
}
```

Use `errors.Is` rather than `==` so wrapped errors still match.

## How Cancellation Propagates

Contexts form a **tree**. When you derive a child, the child links to the parent. Cancellation flows **down** the tree but never up.

```
                 Background
                     │
            WithCancel(parent)         ← cancel here cancels everything below
            ┌───────┴───────┐
       WithTimeout       WithCancel
            │                 │
       db.Query()        rpc.Call()
```

If you call `cancel` on the middle node, both children stop. If you cancel a leaf, the parent and its sibling are unaffected. This is exactly what you want for HTTP request handling: kill the request and everything it spawned.

A simple demonstration:

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func worker(ctx context.Context, id int, wg *sync.WaitGroup) {
    defer wg.Done()
    select {
    case <-ctx.Done():
        fmt.Printf("worker %d: stopping (%v)\n", id, ctx.Err())
    case <-time.After(5 * time.Second):
        fmt.Printf("worker %d: finished naturally\n", id)
    }
}

func main() {
    parent, parentCancel := context.WithCancel(context.Background())
    defer parentCancel()

    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go worker(parent, i, &wg)
    }

    time.Sleep(500 * time.Millisecond)
    parentCancel() // all three workers receive the signal

    wg.Wait()
}
```

Output:

```
worker 1: stopping (context canceled)
worker 0: stopping (context canceled)
worker 2: stopping (context canceled)
```

One call, three goroutines stopped.

## The Cancel Function Is Not Optional

Every `WithCancel`, `WithTimeout`, and `WithDeadline` returns a `cancel func()`. **Always defer it.** Three reasons:

1. **Resource cleanup.** A timerCtx holds a `time.Timer`. If you never call `cancel`, the timer sits in the runtime heap until the deadline arrives.
2. **Tree pruning.** The parent context keeps a `children` map of its derived contexts so it can cascade-cancel them. Calling `cancel()` removes the entry from the parent's map.
3. **Lint compliance.** `go vet` ships a `lostcancel` analyzer that flags any `cancel` you never use.

If you forget:

```go
// WRONG — vet will yell at you
ctx, _ := context.WithCancel(parent) // 'cancel' is discarded
doWork(ctx)
```

```
$ go vet ./...
./main.go:7:6: the cancel function is not used on all paths (possible context leak)
```

Even if you intend to keep the context alive for a long time, deferring `cancel()` is correct because the function will eventually return.

## Don't Sleep — Select

A common beginner mistake is using `time.Sleep` inside a goroutine that should be cancelable:

```go
// BAD: ignores cancellation
func badWorker(ctx context.Context) {
    for {
        time.Sleep(1 * time.Second) // unstoppable for up to 1s
        doStep()
    }
}
```

If `cancel` is called while `time.Sleep` is running, the goroutine still sleeps for the full second before checking. Replace with:

```go
// GOOD
func goodWorker(ctx context.Context) {
    t := time.NewTicker(1 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            doStep()
        }
    }
}
```

The `select` lets either branch win. If `Done()` closes, the goroutine returns immediately.

For a one-shot delay use `time.After` or `time.NewTimer`:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case <-time.After(2 * time.Second):
    // proceed
}
```

## A Realistic Cancelable HTTP Call

Putting it together with the standard library:

```go
package main

import (
    "context"
    "fmt"
    "io"
    "net/http"
    "time"
)

func fetch(ctx context.Context, url string) (string, error) {
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil {
        return "", err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    return string(body), err
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer cancel()

    body, err := fetch(ctx, "https://example.com")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("got", len(body), "bytes")
}
```

If the server takes more than one second to respond, the HTTP transport notices `ctx.Done()` and aborts the connection. The error returned will wrap `context.DeadlineExceeded`.

## Common Beginner Mistakes

### 1. Storing context in a struct

```go
// BAD
type Service struct {
    ctx context.Context
}
```

The `Context` documentation explicitly says: **do not store it in struct fields**. Pass it as the first parameter to every method. The reason is that a struct typically lives across many requests; one stored context cannot represent all their lifetimes.

### 2. Passing nil

```go
// BAD
doWork(nil) // panics on ctx.Done()
```

If a function needs a context and you do not have one yet, pass `context.TODO()`. Never `nil`.

### 3. Wrong parameter position

By convention `ctx` is **always the first parameter**, named `ctx`. Linters check this.

```go
// BAD
func Save(user *User, ctx context.Context) error
// GOOD
func Save(ctx context.Context, user *User) error
```

### 4. Ignoring cancel return

`go vet` catches this:

```go
// BAD
ctx, _ := context.WithTimeout(parent, time.Second) // leak
```

### 5. Using time.Sleep in a cancelable loop

Already covered — use `select` with `time.NewTicker`/`time.After`.

## Putting It All Together

A small program that ties together everything we have seen — a parent timeout that spawns three workers, each with their own per-task deadline, all stopping cleanly when the parent expires:

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "sync"
    "time"
)

func task(ctx context.Context, id int) error {
    // Each task gets its own bounded sub-deadline.
    taskCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
    defer cancel()

    work := time.Duration(rand.Intn(1500)) * time.Millisecond

    select {
    case <-taskCtx.Done():
        return fmt.Errorf("task %d: %w", id, taskCtx.Err())
    case <-time.After(work):
        fmt.Printf("task %d: completed in %v\n", id, work)
        return nil
    }
}

func main() {
    parent, parentCancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer parentCancel()

    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            if err := task(parent, id); err != nil {
                fmt.Println(err)
            }
        }(i)
    }
    wg.Wait()
}
```

Sample output:

```
task 1: completed in 412ms
task 0: task 0: context deadline exceeded
task 2: completed in 663ms
```

Task 0 ran longer than its 800 ms slice and was killed; tasks 1 and 2 finished in time.

## Quick Reference Card

```
context.Background()                       — root for main/tests
context.TODO()                             — "to be wired up"
ctx, cancel := WithCancel(parent)          — manual cancel
ctx, cancel := WithTimeout(parent, d)      — time-boxed
ctx, cancel := WithDeadline(parent, t)     — absolute moment
defer cancel()                             — always
<-ctx.Done()                               — channel that closes
ctx.Err()                                  — Canceled or DeadlineExceeded
errors.Is(err, context.Canceled)           — match either
http.NewRequestWithContext(ctx, ...)       — wire HTTP
db.QueryContext(ctx, ...)                  — wire DB
```

## What You Should Be Able To Do Now

- Explain why `Context` exists and what its four methods do
- Choose between `Background`, `TODO`, `WithCancel`, `WithTimeout`, `WithDeadline`
- Always defer `cancel()` and explain why
- Write a goroutine that respects cancellation via `<-ctx.Done()`
- Tell `Canceled` apart from `DeadlineExceeded`
- Recognise the three classic anti-patterns: stored in struct, nil context, ignored cancel

Next: in [middle.md](middle.md) we trace the propagation tree, learn `go vet -lostcancel`, and budget deadlines across nested calls.

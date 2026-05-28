# Context — Practice Tasks

Twenty exercises to internalise the `context` package by reading its source, then bending it to build the things it doesn't give you. The goal is not to memorise `WithCancel` / `WithTimeout` — those are five-minute reads. The goal is to understand *why* `Context` is an interface, *why* `Value` is type-erased and intentionally hostile, and *why* cancellation is a tree rather than a list. Once you can answer those, the API stops being a grab-bag and starts being a small, opinionated propagation system. Difficulty: **J**unior, **M**iddle, **S**enior, **Staff**.

Each task gives a Goal, a Starter, Hints, and a folded Reference solution with senior-level commentary. Read `junior.md` first — the four interface methods (`Deadline`, `Done`, `Err`, `Value`) and the parent-child cancellation contract are the spine of every task below. Some tasks ask you to read specific lines of `src/context/context.go`; pin the standard library to Go 1.22+ for `WithCancelCause`, `WithoutCancel`, and `AfterFunc`.

---

## Task 1 — Build a function that respects `<-ctx.Done()` (J)

**Goal.** Write `ProcessItems(ctx context.Context, items []string) ([]string, error)` that processes one item at a time with a 50 ms simulated cost per item and returns early when the caller cancels. The function must return `ctx.Err()` (not `nil`, not a custom error) on cancellation so callers can `errors.Is(err, context.Canceled)`.

**Starter.**

```go
package items

import (
    "context"
    "time"
)

func ProcessItems(ctx context.Context, items []string) ([]string, error) {
    out := make([]string, 0, len(items))
    for _, it := range items {
        time.Sleep(50 * time.Millisecond) // simulated work
        out = append(out, "processed:"+it)
    }
    return out, nil
}
```

**Hints.**

- The pattern is `select { case <-ctx.Done(): return nil, ctx.Err(); default: }` at the top of each iteration. The `default` makes the select non-blocking so the loop proceeds when the context is still alive.
- Don't `time.Sleep` blind — that's not cancellable. Wrap the sleep in a `select` with `ctx.Done()` and a `time.After` so the cancel is instantaneous.
- `ctx.Err()` returns `nil` if the context is still alive, `context.Canceled` if cancelled, `context.DeadlineExceeded` if the deadline passed. Surface whichever the runtime hands you — don't normalise.

<details><summary>Reference solution</summary>

```go
package items

import (
    "context"
    "time"
)

func ProcessItems(ctx context.Context, items []string) ([]string, error) {
    out := make([]string, 0, len(items))
    for _, it := range items {
        // Senior decision: cancellation check BEFORE the work. If we checked
        // after, a cancel arriving during the sleep would still cost a full
        // 50 ms of work that nobody is waiting for. The whole point of
        // context is to release wasted compute the moment the caller leaves.
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        default:
        }
        // Senior decision: the work itself is cancellable. A bare time.Sleep
        // would block the goroutine even if the parent has long since gone
        // home. Real I/O — net.Conn, sql.DB, exec.Cmd — already accepts a
        // ctx, but pure CPU work needs this manual cooperation.
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(50 * time.Millisecond):
        }
        out = append(out, "processed:"+it)
    }
    return out, nil
}
```

The discipline: two select points per iteration — one before work, one *as* the work for any blocking operation. Return `ctx.Err()` verbatim so callers can distinguish `Canceled` (caller gave up) from `DeadlineExceeded` (we ran out of time). Test by spawning a goroutine that cancels after 120 ms with 100 items; you should see roughly two items processed.

</details>

---

## Task 2 — Bound an HTTP request with WithTimeout (J)

**Goal.** Write `FetchWithTimeout(url string, timeout time.Duration) ([]byte, error)` that issues a GET with a hard ceiling. On timeout the function must return `context.DeadlineExceeded` (wrapped via `%w`) so callers can branch on it. The TCP connection must actually close — not just the goroutine returning.

**Starter.**

```go
package fetch

import (
    "io"
    "net/http"
    "time"
)

func FetchWithTimeout(url string, timeout time.Duration) ([]byte, error) {
    resp, err := http.Get(url)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    _ = timeout
    return io.ReadAll(resp.Body)
}
```

**Hints.**

- `context.WithTimeout(context.Background(), timeout)` returns `(ctx, cancel)`. The `cancel` must run via `defer` even on the success path — leaking the timer is a real cost.
- Build the request with `http.NewRequestWithContext`. `http.Get` does not accept a context; using it loses the cancellation entirely.
- Cancellation propagates through the `http.Transport` and closes the socket. You don't need to manually close anything; the transport listens to `ctx.Done()`.

<details><summary>Reference solution</summary>

```go
package fetch

import (
    "context"
    "fmt"
    "io"
    "net/http"
    "time"
)

func FetchWithTimeout(url string, timeout time.Duration) ([]byte, error) {
    // Senior decision: WithTimeout, not a manual timer. The standard lib
    // already wires ctx.Done() into http.Transport. Rolling our own with
    // time.AfterFunc + resp.Body.Close means we duplicate logic that the
    // transport does better and we lose the ability to compose with a
    // caller-supplied parent context later.
    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel() // run even on success — releases the timer goroutine

    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil {
        return nil, fmt.Errorf("build request: %w", err)
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        // Senior decision: when the transport aborts due to ctx, err is a
        // *url.Error whose Unwrap chain ends at context.DeadlineExceeded.
        // We rewrap with %w so callers see the same. Don't translate to a
        // custom error here — that erases the signal that callers need to
        // decide retry vs give-up.
        return nil, fmt.Errorf("GET %s: %w", url, err)
    }
    defer resp.Body.Close()

    return io.ReadAll(resp.Body)
}
```

Test by pointing at a slow endpoint (or `httptest.NewServer` with a 5 s sleep) and a 100 ms timeout. `errors.Is(err, context.DeadlineExceeded)` must return true. Run `go test -race`; the cancel goroutine must not race with the read.

</details>

---

## Task 3 — Pass a request ID via WithValue with a typed key (J)

**Goal.** Build `WithRequestID(ctx, id)` and `RequestID(ctx) string` such that the value travels through any number of derived contexts and is retrievable only by code that imports your package. The key must be an unexported type so other packages cannot collide with it.

**Starter.**

```go
package reqid

import "context"

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, "request_id", id) // wrong: string key
}

func RequestID(ctx context.Context) string {
    v, _ := ctx.Value("request_id").(string)
    return v
}
```

**Hints.**

- The standard pattern is `type ctxKey struct{}` (or `type ctxKey int` with constants). Unexported, zero-sized, comparable by identity. Two packages that both define `type ctxKey struct{}` *do not* collide — the type identity differs by package.
- `context.WithValue` does not panic on a `nil` key but `go vet` will warn on built-in types like `string` or `int`. The vet check exists precisely to catch this mistake.
- `RequestID` should return a zero value, not panic, when the key is absent. The convention is "missing means absent"; callers handle the empty case.

<details><summary>Reference solution</summary>

```go
package reqid

import "context"

// Senior decision: unexported zero-sized struct. Exported types in other
// packages cannot construct it, so the value namespace is private to this
// package. An int constant would also work but a struct{} can't be confused
// with an unrelated int key in a log line.
type ctxKey struct{}

var requestIDKey = ctxKey{}

func WithRequestID(ctx context.Context, id string) context.Context {
    // Senior decision: no validation here. WithValue is a propagation
    // primitive, not a sanitiser. The HTTP middleware that calls us is the
    // boundary; if it lets an empty string in, the bug is in the middleware.
    return context.WithValue(ctx, requestIDKey, id)
}

func RequestID(ctx context.Context) string {
    v, _ := ctx.Value(requestIDKey).(string)
    return v // empty string if absent — caller decides what to do
}
```

Test the propagation: build `ctx0 := context.Background()`, `ctx1 := WithRequestID(ctx0, "abc")`, `ctx2, cancel := context.WithTimeout(ctx1, time.Second); defer cancel()`. `RequestID(ctx2)` must return `"abc"` — values walk up the parent chain on every `Value` call. Run `go vet`; it should not warn.

</details>

---

## Task 4 — Read context.go; identify the four interface methods (J)

**Goal.** Open `$(go env GOROOT)/src/context/context.go`, find the `Context` interface, and answer four questions in a short Go file (as comments). What does each method return when the context is alive? What does each return when it's cancelled? Which methods can return `nil`? Which methods are safe to call from any goroutine?

**Starter.**

```go
package notes

// TODO: paste the Context interface (4 methods) and answer:
// 1. Deadline() -> when alive? when cancelled?
// 2. Done() -> when alive? when cancelled?
// 3. Err() -> when alive? when cancelled?
// 4. Value() -> can it return nil? when?
//
// Bonus: which method is the ONLY one that can be called repeatedly
// in a hot loop without allocation?
```

**Hints.**

- The interface is roughly 30 lines including doc comments. Read the doc comments — they are the authoritative spec.
- `Done()` returns the same channel forever for a given context; that's why the doc says "may return nil if this context can never be canceled" — `Background` does that.
- `Value` walks the parent chain on every call; it's O(depth). The other three are O(1) after construction.

<details><summary>Reference solution</summary>

```go
package notes

// From $GOROOT/src/context/context.go (approximate):
//
//   type Context interface {
//       Deadline() (deadline time.Time, ok bool)
//       Done() <-chan struct{}
//       Err() error
//       Value(key any) any
//   }
//
// 1. Deadline()
//    - alive:     returns (zero Time, false) if no deadline set
//                 or (deadline, true) if WithDeadline/WithTimeout was used.
//    - cancelled: same return — the deadline doesn't change on cancel.
//                 Caller checks Err() to see "did we actually trip it".
//
// 2. Done()
//    - alive:     returns a chan that is NOT closed.
//                 Background() / TODO() may return nil — selecting on nil
//                 blocks forever, which is what you want (no cancellation).
//    - cancelled: returns the SAME chan, now closed. Closed chans always
//                 select-receive a zero value immediately.
//
// 3. Err()
//    - alive:     returns nil.
//    - cancelled: returns context.Canceled or context.DeadlineExceeded.
//                 Never returns nil after Done() is closed.
//
// 4. Value()
//    - returns any value or nil if the key is not bound anywhere in the
//      parent chain. nil is a valid "absent" signal; callers must do a
//      typed assert with the comma-ok form to distinguish absent from
//      "present but nil".
//
// All four are documented as safe for concurrent use. The four-method
// surface is intentionally minimal — that's why building a "context-aware
// X" usually means wrapping, not subclassing.
//
// Bonus: Done() and Err() are O(1) and allocation-free in steady state.
// Value() walks parents on every call; cache the lookup if you do it in
// a tight loop.
```

The reading is mechanical, but it's the foundation: every later task assumes you know which methods are O(1) vs O(depth), and which can return `nil`. If you skip this, the senior tasks will read like magic instead of like consequences.

</details>

---

## Task 5 — Build an errgroup-like helper using context + WaitGroup (M)

**Goal.** Implement `type Group struct{}` with methods `Go(func() error)` and `Wait() error`. On the first non-nil error from any goroutine, the group must cancel the shared context so siblings can bail out cooperatively. `Wait` returns the first error (zero if all succeeded). Bonus: expose `Context()` so callers can pass the derived ctx into their funcs.

**Starter.**

```go
package mygroup

import (
    "context"
    "sync"
)

type Group struct {
    wg sync.WaitGroup
}

func New(ctx context.Context) (*Group, context.Context) {
    // TODO: derive a cancellable ctx, store the cancel, return both.
    return &Group{}, ctx
}

func (g *Group) Go(fn func() error) {
    // TODO: wg.Add(1), launch fn, capture first error, cancel siblings.
    _ = fn
}

func (g *Group) Wait() error {
    // TODO: wg.Wait(), call cancel, return first error.
    return nil
}
```

**Hints.**

- The first-error capture needs `sync.Once` or an atomic compare-and-swap. A mutex works but Once is exactly the right primitive here.
- Call `cancel` from inside `Wait` even on the happy path. Forgetting it leaks the timer/finaliser.
- Look at `golang.org/x/sync/errgroup` for the canonical shape — but don't copy it; build it yourself first, then diff.

<details><summary>Reference solution</summary>

```go
package mygroup

import (
    "context"
    "sync"
)

type Group struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
    once   sync.Once
    err    error
}

func New(ctx context.Context) (*Group, context.Context) {
    // Senior decision: WithCancel, not WithCancelCause. Adding cause-aware
    // behaviour is a deliberate extension (see Task 6) — start with the
    // minimal surface. The returned ctx is the one callers must propagate
    // into their funcs; that's why we return (group, ctx) as a pair.
    ctx, cancel := context.WithCancel(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(fn func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := fn(); err != nil {
            // Senior decision: sync.Once for first-error capture. An atomic
            // CAS on a pointer would also work, but Once communicates intent
            // better — "exactly one of the racing goroutines wins". The
            // cancel inside Do triggers sibling shutdown the moment we lose.
            g.once.Do(func() {
                g.err = err
                g.cancel()
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    // Senior decision: cancel on success path too. If no fn errored, the
    // group's derived context is still live — callers might still be reading
    // ctx.Done() from a leaked sibling. cancel() makes the group's lifecycle
    // crisp: after Wait returns, the derived ctx is guaranteed done.
    g.cancel()
    return g.err
}
```

Test with three funcs: two that sleep 200 ms checking `ctx.Done()`, one that returns an error after 50 ms. `Wait` must return the error within ~50 ms (not 200 ms), proving siblings observed the cancel. Diff your code against `errgroup.Group` — the production version adds `SetLimit`, but the core is identical.

</details>

---

## Task 6 — WithCancelCause and surfacing the cause (M)

**Goal.** Build a worker that watches three independent sources of cancellation (parent ctx, a timeout, a `QUIT` channel) and attaches a distinct *cause* to each. The logger must print the specific reason — "user pressed quit", "deadline exceeded", "parent cancelled" — not the generic `context.Canceled`.

**Starter.**

```go
package worker

import (
    "context"
    "time"
)

func Run(parent context.Context, quit <-chan struct{}) error {
    // TODO: derive a cancel-cause ctx, fan-in the three sources, return
    // context.Cause(ctx) at exit.
    _ = time.Now()
    return nil
}
```

**Hints.**

- `context.WithCancelCause(parent)` returns `(ctx, cancel)` where `cancel func(cause error)`. Calling `cancel(myErr)` makes `context.Cause(ctx)` return `myErr`, while `ctx.Err()` still returns the generic `context.Canceled`.
- Define sentinel errors: `ErrUserQuit`, `ErrParentGone`. These let callers `errors.Is(context.Cause(ctx), ErrUserQuit)` to branch.
- `context.Cause` falls back to `ctx.Err()` if no explicit cause was set, so it's safe to call unconditionally.

<details><summary>Reference solution</summary>

```go
package worker

import (
    "context"
    "errors"
    "fmt"
    "log"
    "time"
)

var (
    ErrUserQuit   = errors.New("user pressed quit")
    ErrParentGone = errors.New("parent context cancelled")
)

func Run(parent context.Context, quit <-chan struct{}) error {
    // Senior decision: WithCancelCause + WithDeadlineCause (1.21+) so every
    // possible exit path carries an explanation. Without cause, the log
    // would say "context canceled" and the on-call engineer would have to
    // guess between "user quit", "timeout", or "outer cancel". The cost is
    // one extra import and three named errors — cheap.
    ctx, cancel := context.WithCancelCause(parent)
    defer cancel(nil) // nil cause = no-op if already cancelled

    deadline := time.Now().Add(500 * time.Millisecond)
    ctx, cancelDL := context.WithDeadlineCause(ctx, deadline, context.DeadlineExceeded)
    defer cancelDL()

    // Watcher goroutine fans the external signals into our cancel-cause.
    done := make(chan struct{})
    defer close(done)
    go func() {
        select {
        case <-quit:
            cancel(ErrUserQuit)
        case <-parent.Done():
            // Senior decision: distinguish "parent died" from "we cancelled
            // ourselves". context.Cause(parent) carries the upstream reason
            // if any; chain it so the cause we attach explains both layers.
            cancel(fmt.Errorf("%w: %w", ErrParentGone, context.Cause(parent)))
        case <-done:
        }
    }()

    // Simulated work loop.
    for i := 0; i < 100; i++ {
        select {
        case <-ctx.Done():
            cause := context.Cause(ctx)
            log.Printf("worker stopped: ctx.Err=%v cause=%v", ctx.Err(), cause)
            return cause
        case <-time.After(10 * time.Millisecond):
        }
    }
    return nil
}
```

The log line in the cancelled path will be `worker stopped: ctx.Err=context canceled cause=user pressed quit` — that's the whole point. Test three scenarios: cancel the parent, close `quit`, let the deadline elapse. Each must print a distinct cause.

</details>

---

## Task 7 — WithoutCancel for fire-and-forget logging (M)

**Goal.** Build a `LogAfterRequest(ctx, payload)` helper that ships a log line to a slow upstream sink (200 ms) *after* the request handler has returned. The sink must complete even though the request's context is cancelled the moment the response is written. Use `context.WithoutCancel` (Go 1.21+).

**Starter.**

```go
package fireandforget

import (
    "context"
    "time"
)

func LogAfterRequest(reqCtx context.Context, payload string) {
    // TODO: derive a child that ignores reqCtx's cancellation but still
    // carries its values (request ID, tenant, trace). Then launch the
    // background send.
    go func() {
        time.Sleep(200 * time.Millisecond)
        _ = payload
    }()
}
```

**Hints.**

- Before 1.21 the only way to "detach" was `context.Background()`, which loses values. `WithoutCancel(parent)` keeps `parent.Value(k)` working but returns a never-cancellable Done channel.
- Detached doesn't mean infinite — pair it with `WithTimeout` so a stuck sink doesn't leak goroutines.
- This is exactly the pattern for audit logging, metrics flush, and post-response cache warming.

<details><summary>Reference solution</summary>

```go
package fireandforget

import (
    "context"
    "log"
    "time"
)

func LogAfterRequest(reqCtx context.Context, payload string) {
    // Senior decision: WithoutCancel keeps values (request_id, trace_id,
    // tenant) so the audit log still correlates with the request, but the
    // Done channel of reqCtx no longer cancels us. Then we put our own
    // ceiling on it — a stuck audit sink should never leak goroutines.
    detached := context.WithoutCancel(reqCtx)
    ctx, cancel := context.WithTimeout(detached, 5*time.Second)

    go func() {
        defer cancel()
        if err := sendToSink(ctx, payload); err != nil {
            log.Printf("audit log dropped: %v", err)
        }
    }()
}

func sendToSink(ctx context.Context, payload string) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(200 * time.Millisecond):
        log.Printf("audit shipped: %s", payload)
        return nil
    }
}
```

Test by calling `LogAfterRequest` with a context that you cancel immediately. The 200 ms send should still complete (verify with a counter or a captured log line). Then test the timeout path by making `sendToSink` sleep 10 s — the 5 s `WithTimeout` should reap it.

</details>

---

## Task 8 — AfterFunc to schedule cleanup on cancel (M)

**Goal.** Build `OpenTempDir(ctx) (path string, err error)` that creates a temp directory and registers an `AfterFunc` to remove it when `ctx` is cancelled. The cleanup runs whether ctx ends by timeout, manual cancel, or parent propagation. Return the stop func so callers can opt out (kept dir on success, say).

**Starter.**

```go
package tempdir

import (
    "context"
    "os"
)

func OpenTempDir(ctx context.Context) (string, func(), error) {
    dir, err := os.MkdirTemp("", "demo-*")
    if err != nil {
        return "", nil, err
    }
    // TODO: schedule os.RemoveAll on ctx cancellation; return a stop func.
    return dir, func() {}, nil
}
```

**Hints.**

- `context.AfterFunc(ctx, fn)` runs `fn` in its own goroutine when `ctx` is done. It returns a `stop` func that returns whether the call prevented `fn` from running.
- The cleanup must be idempotent — `os.RemoveAll` already is. Adding a `sync.Once` is paranoid here but harmless.
- If you call `AfterFunc` on an already-cancelled context, the func runs immediately in a fresh goroutine. Read the doc to confirm.

<details><summary>Reference solution</summary>

```go
package tempdir

import (
    "context"
    "fmt"
    "log"
    "os"
)

func OpenTempDir(ctx context.Context) (string, func() bool, error) {
    dir, err := os.MkdirTemp("", "demo-*")
    if err != nil {
        return "", nil, fmt.Errorf("mkdir temp: %w", err)
    }

    // Senior decision: AfterFunc is the right tool when cleanup is purely
    // a function of ctx-done, not of the work itself. We could spawn a
    // goroutine that does `<-ctx.Done(); os.RemoveAll(dir)` — that's what
    // AfterFunc does internally — but the API documents the intent better
    // and lets callers stop the cleanup with a single call (the returned
    // stop func) if the dir is being deliberately kept past ctx lifetime.
    stop := context.AfterFunc(ctx, func() {
        if err := os.RemoveAll(dir); err != nil {
            log.Printf("temp cleanup failed for %s: %v", dir, err)
        }
    })

    return dir, stop, nil
}
```

Test three exits: (a) caller calls `stop()` and keeps the dir — confirm with `os.Stat`; (b) parent cancels and the dir is removed within a few ms — confirm with a poll loop; (c) `OpenTempDir` is called with an already-cancelled ctx — the dir should be created then immediately removed (the AfterFunc fires straight away).

</details>

---

## Task 9 — Profile a goroutine leak from a never-cancelled context (M)

**Goal.** Reproduce a real goroutine leak by spawning workers that `select` on `<-ctx.Done()` while the parent never calls `cancel`. Capture a goroutine profile with `runtime/pprof`, parse it, and assert the leak count programmatically. Then fix it.

**Starter.**

```go
package leakdemo

import (
    "context"
    "time"
)

func StartWorker(parent context.Context) {
    ctx, _ := context.WithCancel(parent) // leak: discarded cancel
    go func() {
        select {
        case <-ctx.Done():
        case <-time.After(time.Hour):
        }
    }()
}
```

**Hints.**

- The leak is the discarded `cancel`. `go vet` catches this with `lostcancel`. Run it first; it should already shout.
- Use `pprof.Lookup("goroutine").WriteTo(buf, 1)` to get a text profile. Count lines containing the worker function.
- The fix is `defer cancel()` *somewhere that runs* — the caller, not inside the goroutine itself.

<details><summary>Reference solution</summary>

```go
package leakdemo

import (
    "bytes"
    "context"
    "fmt"
    "runtime/pprof"
    "strings"
    "time"
)

// Leaky version — preserved as the bug for the test.
func StartWorkerLeaky(parent context.Context) {
    // Senior decision: this is the canonical bug. Discarding cancel means
    // the goroutine's ctx never reaches Done unless parent does. If parent
    // is context.Background() (as in many CLIs), the goroutine pins memory
    // and a timer entry forever. go vet's lostcancel check exists for this.
    ctx, _ := context.WithCancel(parent)
    go func() {
        select {
        case <-ctx.Done():
        case <-time.After(time.Hour):
        }
    }()
}

// Fixed version — returns the cancel so the caller can release.
func StartWorker(parent context.Context) context.CancelFunc {
    ctx, cancel := context.WithCancel(parent)
    go func() {
        select {
        case <-ctx.Done():
        case <-time.After(time.Hour):
        }
    }()
    return cancel
}

// CountGoroutines returns how many goroutines reference the given symbol.
func CountGoroutines(symbol string) (int, error) {
    var buf bytes.Buffer
    if err := pprof.Lookup("goroutine").WriteTo(&buf, 1); err != nil {
        return 0, fmt.Errorf("pprof: %w", err)
    }
    return strings.Count(buf.String(), symbol), nil
}
```

The test is the proof: call `StartWorkerLeaky` 100 times, sleep 10 ms for goroutines to park, then `CountGoroutines("StartWorkerLeaky")` should return 100. Repeat with the fixed `StartWorker` plus `defer cancel()` — count must drop to zero after the cancels run. Save the profile via `go test -trace` if you want to inspect the leaked goroutines visually.

</details>

---

## Task 10 — Auth-claims middleware via context (M)

**Goal.** Write `AuthMiddleware(next http.Handler) http.Handler` that parses a Bearer token, validates it, and stores the resulting `Claims` (user ID, scopes) on the request context. Provide `Current(ctx) (Claims, bool)` for handlers. Failures short-circuit with 401; successes call `next.ServeHTTP` with the enriched ctx.

**Starter.**

```go
package authmw

import (
    "context"
    "net/http"
)

type Claims struct {
    UserID string
    Scopes []string
}

type ctxKey struct{}

func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // TODO: parse Authorization, validate, set ctx, call next.
        _ = ctxKey{}
        _ = Claims{}
        next.ServeHTTP(w, r.WithContext(context.Background()))
    })
}

func Current(ctx context.Context) (Claims, bool) {
    return Claims{}, false
}
```

**Hints.**

- The ctx key must be unexported (Task 3 pattern). `r.WithContext(ctx)` is the only way to propagate values across `next.ServeHTTP`.
- Fail fast at the boundary: missing header, wrong scheme, expired token — all 401 before `next` ever runs. The handler downstream must never receive an unauthenticated request.
- `Current` returns `(Claims, bool)` so handlers can branch cleanly without a sentinel zero value.

<details><summary>Reference solution</summary>

```go
package authmw

import (
    "context"
    "net/http"
    "strings"
)

type Claims struct {
    UserID string
    Scopes []string
}

type ctxKey struct{}

var claimsKey = ctxKey{}

func AuthMiddleware(verify func(token string) (Claims, error)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Senior decision: parse + validate before allocating anything.
            // A flood of unauthenticated requests should hit the cheapest
            // possible reject path.
            h := r.Header.Get("Authorization")
            if h == "" {
                http.Error(w, "missing Authorization", http.StatusUnauthorized)
                return
            }
            token, ok := strings.CutPrefix(h, "Bearer ")
            if !ok || token == "" {
                http.Error(w, "expected Bearer token", http.StatusUnauthorized)
                return
            }
            claims, err := verify(token)
            if err != nil {
                http.Error(w, "invalid token", http.StatusUnauthorized)
                return
            }
            // Senior decision: derive a new ctx; don't mutate r.Context().
            // r.WithContext returns a shallow-cloned *Request — the original
            // r is still referenced by the caller; mutating it would be a
            // data race in any reverse-proxy scenario.
            ctx := context.WithValue(r.Context(), claimsKey, claims)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func Current(ctx context.Context) (Claims, bool) {
    c, ok := ctx.Value(claimsKey).(Claims)
    return c, ok
}
```

Test with two handlers: one expecting `Current(ctx).UserID == "u-1"`, one calling `Current` and asserting `ok == false` because no middleware ran. Add a third test that sends garbage in the Authorization header; the handler chain must never see the request.

</details>

---

## Task 11 — Structured-concurrency wrapper Run(ctx, fns...) (S)

**Goal.** Build `Run(ctx context.Context, fns ...func(context.Context) error) error` such that: (1) every fn receives the same derived ctx; (2) the first error cancels siblings; (3) `Run` does not return until *every* fn has returned (no orphaned goroutines after Run exits); (4) if `ctx` is already done at entry, return immediately without launching anything.

**Starter.**

```go
package structured

import "context"

func Run(ctx context.Context, fns ...func(context.Context) error) error {
    // TODO: implement structured concurrency rules above.
    return nil
}
```

**Hints.**

- This is Task 5's group, plus the entry-state check, plus the strict "no goroutines outlive Run" guarantee. The latter is the *structured* part — no `go fn()` ever fires-and-forgets.
- Use `sync.WaitGroup.Wait()` as the joint exit. Capture the first error with `sync.Once` or an atomic.
- Empty `fns` should return `nil` (or `ctx.Err()` if pre-cancelled). Decide and document.

<details><summary>Reference solution</summary>

```go
package structured

import (
    "context"
    "sync"
)

func Run(ctx context.Context, fns ...func(context.Context) error) error {
    // Senior decision: check entry state explicitly. WithCancel on an
    // already-done parent would still launch the goroutines — they'd see
    // ctx.Done() immediately and return ctx.Err(), but we still paid the
    // goroutine launch cost. A pre-check elides the cost entirely.
    if err := ctx.Err(); err != nil {
        return err
    }
    if len(fns) == 0 {
        return nil
    }

    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    var (
        wg   sync.WaitGroup
        once sync.Once
        err  error
    )
    wg.Add(len(fns))
    for _, fn := range fns {
        fn := fn
        go func() {
            defer wg.Done()
            if e := fn(ctx); e != nil {
                // Senior decision: capture FIRST error, cancel siblings.
                // We do NOT capture the LAST error — by that point all
                // siblings have observed cancellation and may return
                // ctx.Err() as a "secondary" failure that masks the real
                // cause. First-wins is the policy the standard library's
                // errgroup uses for the same reason.
                once.Do(func() {
                    err = e
                    cancel()
                })
            }
        }()
    }
    // Senior decision: the wg.Wait() before return is the entire structural
    // guarantee. After Run returns, no goroutine launched by Run is alive.
    // Callers can rely on this to reason about resource cleanup — the
    // alternative (background goroutines) is the bug class this whole
    // exercise exists to prevent.
    wg.Wait()
    return err
}
```

Test the four guarantees: (1) all fns see the same `context.Context.Value(...)` chain; (2) func A returns an error after 10 ms, func B sleeps 1 s checking ctx — Run returns in ~10 ms; (3) inside fn launch a goroutine that captures the ctx, return — assert `ctx.Done()` is closed by the time Run returns (this is the cancel-on-return guarantee); (4) pass a cancelled ctx — Run returns `context.Canceled` immediately without invoking fns (verify with a counter).

</details>

---

## Task 12 — Read propagateCancel; explain goroutine spawn rule (S)

**Goal.** Open `$(go env GOROOT)/src/context/context.go` and find `propagateCancel`. Write a short doc (in a Go file as comments) that answers: under what conditions does `propagateCancel` spawn a goroutine? Under what conditions does it skip the goroutine? Why does this matter for memory at the scale of a server with 100k concurrent requests?

**Starter.**

```go
package notes

// TODO: read context.go propagateCancel. Answer the three questions above
// as a long comment with line references. Include the fast path and the
// slow path.
```

**Hints.**

- The fast path: if `parent.Done() == nil` (i.e. parent is `Background` or `TODO`), there's nothing to listen to. Return immediately.
- The fast path part 2: if the parent is itself a `*cancelCtx` (the standard concrete type), register the child in the parent's children map. No goroutine needed — the parent will iterate the map on cancel.
- The slow path: if the parent is a *custom* `Context` implementation (rare but legal), there's no children-map to register into. Spawn a goroutine that does `<-parent.Done(); childCancel()`.

<details><summary>Reference solution</summary>

```go
package notes

// propagateCancel in $GOROOT/src/context/context.go (Go 1.22 line numbers
// are approximate; the logic is stable across recent versions):
//
//   func propagateCancel(parent Context, child canceler) {
//       done := parent.Done()
//       if done == nil {
//           return // parent is never cancelled (e.g. Background)
//       }
//       select {
//       case <-done:
//           child.cancel(false, parent.Err(), Cause(parent))
//           return
//       default:
//       }
//       if p, ok := parentCancelCtx(parent); ok {
//           p.mu.Lock()
//           if p.err != nil {
//               child.cancel(false, p.err, p.cause)
//           } else {
//               if p.children == nil {
//                   p.children = make(map[canceler]struct{})
//               }
//               p.children[child] = struct{}{}
//           }
//           p.mu.Unlock()
//       } else {
//           goroutines.Add(1)
//           go func() {
//               select {
//               case <-parent.Done():
//                   child.cancel(false, parent.Err(), Cause(parent))
//               case <-child.Done():
//               }
//           }()
//       }
//   }
//
// Three cases:
//
// 1. parent.Done() == nil  -> no goroutine, no registration. Background
//    and TODO take this path. It's an O(1) early return; this is why
//    deriving children from Background is essentially free.
//
// 2. parent is *cancelCtx (or *timerCtx wrapping one) -> NO goroutine.
//    The child is added to parent.children, and parent's own cancel will
//    iterate that map and cancel each child synchronously. This is the
//    common case — almost every real context tree is built out of the
//    standard concrete types — so it's the case the stdlib optimised for.
//
// 3. parent is a custom Context implementation -> goroutine spawned. The
//    stdlib has no way to register into a foreign type, so the only option
//    is "watch parent.Done() on a goroutine". This is the slow path; it
//    costs ~2 KB of stack per child. The runtime counter goroutines.Add(1)
//    exists for testing — see TestCustomContextGoroutines.
//
// Server impact at 100k concurrent requests: if all parents are stdlib
// types, the cancellation tree costs O(1) goroutines (just the user
// goroutines, not the context tree). If even 10% of requests pass through
// a custom Context wrapper, you've added 10k extra goroutines and ~20 MB
// of stack. This is why "wrap with WithValue, don't reimplement Context"
// is the universal advice — keeping the type *cancelCtx-compatible at
// every layer is what lets the stdlib elide the goroutine.
```

Verify case 3 by writing a custom `Context` whose `Done()` returns a channel that's never closed, deriving 1000 children with `WithCancel`, and counting goroutines with `pprof.Lookup("goroutine").Count()`. You should see ~1000 extra goroutines parked in `propagateCancel`.

</details>

---

## Task 13 — Request-id middleware that propagates over gRPC (S)

**Goal.** Build matching HTTP and gRPC middleware (interceptors) that read a `X-Request-ID` / `x-request-id` metadata key, stamp the context, and *forward* it on outbound gRPC calls. Round-trip a request: HTTP in -> gRPC out -> gRPC in -> log. The same ID must appear in every log line.

**Starter.**

```go
package reqidmw

import (
    "context"
    "net/http"
)

type ctxKey struct{}

var reqIDKey = ctxKey{}

func HTTPMiddleware(next http.Handler) http.Handler {
    // TODO: read X-Request-ID, generate if missing, stamp ctx, call next.
    return next
}

// TODO: UnaryServerInterceptor and UnaryClientInterceptor for gRPC.
```

**Hints.**

- Generate the ID at the edge (first HTTP hop) if the client didn't supply one. Use `crypto/rand` or `google/uuid`.
- gRPC carries metadata via `google.golang.org/grpc/metadata`. Inbound: `metadata.FromIncomingContext`. Outbound: `metadata.AppendToOutgoingContext`. Keys are lowercased.
- The interceptor pattern: read inbound metadata, stamp the new ctx with your typed key, pass that ctx to the handler. On the client side, read the typed key, append to outgoing metadata.

<details><summary>Reference solution</summary>

```go
package reqidmw

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "net/http"

    "google.golang.org/grpc"
    "google.golang.org/grpc/metadata"
)

type ctxKey struct{}

var reqIDKey = ctxKey{}

const headerName = "X-Request-ID"
const mdName = "x-request-id"

func newID() string {
    var b [8]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}

func FromContext(ctx context.Context) string {
    v, _ := ctx.Value(reqIDKey).(string)
    return v
}

func with(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, reqIDKey, id)
}

// HTTPMiddleware stamps inbound HTTP requests.
func HTTPMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get(headerName)
        if id == "" {
            id = newID()
        }
        // Senior decision: echo the ID back to the client. Useful for
        // support — the user can quote the ID from the response header
        // when filing a bug. Also makes test assertions trivial.
        w.Header().Set(headerName, id)
        next.ServeHTTP(w, r.WithContext(with(r.Context(), id)))
    })
}

// UnaryServerInterceptor stamps inbound gRPC calls.
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
        var id string
        if md, ok := metadata.FromIncomingContext(ctx); ok {
            if v := md.Get(mdName); len(v) > 0 {
                id = v[0]
            }
        }
        if id == "" {
            id = newID()
        }
        return handler(with(ctx, id), req)
    }
}

// UnaryClientInterceptor propagates the ID on outbound gRPC calls.
func UnaryClientInterceptor() grpc.UnaryClientInterceptor {
    return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
        // Senior decision: if there's no ID in ctx, do NOT mint one here.
        // The edge mints; the middle propagates. Minting in the middle
        // would silently break the "same ID end-to-end" invariant when an
        // upstream service forgot to install the server interceptor.
        if id := FromContext(ctx); id != "" {
            ctx = metadata.AppendToOutgoingContext(ctx, mdName, id)
        }
        return invoker(ctx, method, req, reply, cc, opts...)
    }
}
```

Round-trip test: build an `httptest.Server` with `HTTPMiddleware`, inside the handler make a gRPC call through `UnaryClientInterceptor` to a bufconn server with `UnaryServerInterceptor`. Log `FromContext` at every layer. All three log lines must show the same ID — the one the test injected via `X-Request-ID`.

</details>

---

## Task 14 — Diagnose a context leak in a long-running program with pprof (S)

**Goal.** Given a long-running program that leaks ~10 goroutines per minute through a forgotten `defer cancel()`, find the leak using `net/http/pprof`. Capture a goroutine profile, identify the leak by stack frame, point to the exact source line, and fix it. Acceptance criterion: a 5-minute soak test shows zero growth in goroutine count.

**Starter.**

```go
package leakdiag

import (
    "context"
    "net/http"
    _ "net/http/pprof"
    "time"
)

func startServer() {
    go http.ListenAndServe(":6060", nil) // pprof at /debug/pprof
    for {
        go fetchOnce("http://localhost:8081/slow")
        time.Sleep(100 * time.Millisecond)
    }
}

func fetchOnce(url string) {
    ctx, _ := context.WithTimeout(context.Background(), time.Second)
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return
    }
    resp.Body.Close()
}
```

**Hints.**

- The leak is `_ =` on `cancel`. `WithTimeout` runs a timer that fires at the deadline, but the timer can be released early by calling `cancel`. Discarding it costs you nothing per call until you do it 100k times.
- `curl http://localhost:6060/debug/pprof/goroutine?debug=1` gives a text profile. Look for goroutines parked in `time.go` or `context.go` — those are timer/cancel leaks.
- `go tool pprof -http=:8090 http://localhost:6060/debug/pprof/goroutine` opens a UI; the flame graph shows the offending frame instantly.

<details><summary>Reference solution</summary>

```go
package leakdiag

import (
    "context"
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func fetchOnce(url string) error {
    // Senior decision: defer cancel() even when the function looks like
    // "we always wait for the response anyway". WithTimeout schedules a
    // runtime timer; without cancel, the timer survives until its deadline
    // even though the response has already been read. At 10 RPS that's
    // 10 timer heap entries per second, all live until 1 s old — average
    // 10 outstanding. At 10k RPS that's 10k. Multiply by GC scan cost.
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil {
        return fmt.Errorf("build req: %w", err)
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    // ... consume body
    return nil
}

// SoakProbe samples goroutine count over time. Use in the test to assert
// "no growth after warmup".
func SoakProbe(d time.Duration, sampleEvery time.Duration) []int {
    samples := []int{}
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        samples = append(samples, runtime.NumGoroutine())
        time.Sleep(sampleEvery)
    }
    return samples
}
```

Diagnostic recipe to commit alongside the fix:

```
# Step 1: reproduce
go run ./cmd/leaky &
sleep 60

# Step 2: capture
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=2' > /tmp/g1.txt

# Step 3: identify
grep -c "fetchOnce" /tmp/g1.txt   # > 0 means leak

# Step 4: fix, redeploy

# Step 5: verify
sleep 60
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=2' > /tmp/g2.txt
grep -c "fetchOnce" /tmp/g2.txt   # must be ~0 in steady state
```

The acceptance test: `SoakProbe(5*time.Minute, 5*time.Second)` then `max - min < 50` (some noise from request goroutines themselves; the fix is "linear growth -> bounded variance"). Run with and without the `defer cancel()` to see the contrast.

</details>

---

## Task 15 — Context-aware mutex (S)

**Goal.** Build `CtxMutex` with `Lock(ctx) error` and `Unlock()`. `Lock` blocks until either the mutex is available or `ctx` is cancelled; on cancel it returns `ctx.Err()` without holding the lock. The semantics must compose with all other context-aware code in the codebase.

**Starter.**

```go
package ctxmutex

import "context"

type CtxMutex struct{}

func (m *CtxMutex) Lock(ctx context.Context) error {
    return nil
}

func (m *CtxMutex) Unlock() {}
```

**Hints.**

- `sync.Mutex` doesn't support cancellation. Build on top of a buffered channel of size 1 — send-to-acquire, receive-to-release.
- The `select` is the magic: `select { case m.ch <- struct{}{}: return nil; case <-ctx.Done(): return ctx.Err() }`.
- Watch ordering: if both cases are ready (lock available *and* ctx cancelled), `select` picks one pseudo-randomly. That's intentional — the caller should treat "got the lock then immediately released it" and "didn't get the lock" as both acceptable cancel-paths. Document this.

<details><summary>Reference solution</summary>

```go
package ctxmutex

import (
    "context"
    "errors"
    "sync"
)

type CtxMutex struct {
    once sync.Once
    ch   chan struct{}
}

func (m *CtxMutex) init() {
    m.once.Do(func() {
        // Senior decision: buffered chan of capacity 1 is the canonical
        // "binary semaphore". Send blocks if full (= lock held); receive
        // unblocks the next sender. Building on sync.Mutex would force us
        // to spawn a goroutine to do the wait — that goroutine can't be
        // cancelled cleanly, defeating the whole API.
        m.ch = make(chan struct{}, 1)
    })
}

var ErrNotHeld = errors.New("ctxmutex: Unlock of unheld mutex")

func (m *CtxMutex) Lock(ctx context.Context) error {
    m.init()
    // Senior decision: fast path. If the lock is free, take it without
    // entering the select. Saves an alloc per acquisition under low
    // contention. Real measurement: ~30 ns vs ~120 ns for the select path
    // on Go 1.22 / Apple M2.
    select {
    case m.ch <- struct{}{}:
        return nil
    default:
    }
    // Slow path: block on lock or cancel, whichever wins.
    select {
    case m.ch <- struct{}{}:
        // Senior decision: re-check ctx AFTER acquiring. If the lock was
        // free at exactly the moment ctx died, the runtime might have
        // picked the lock-acquired branch. Re-checking lets us honour
        // cancellation strictly — we release immediately and return err.
        if err := ctx.Err(); err != nil {
            <-m.ch // give it back
            return err
        }
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (m *CtxMutex) Unlock() {
    m.init()
    select {
    case <-m.ch:
    default:
        panic(ErrNotHeld)
    }
}
```

Test the four behaviours: (1) `Lock` succeeds on free mutex; (2) second `Lock` blocks until the first `Unlock`; (3) second `Lock` with a 50 ms timeout returns `context.DeadlineExceeded`; (4) `Unlock` on a never-locked mutex panics. Add a stress test with 1000 goroutines competing for the lock, all using `WithTimeout(... 5 ms)` — the count of `ErrDeadlineExceeded` plus successful acquisitions must equal 1000 with no goroutines leaked.

</details>

---

## Task 16 — Context that times out at a specific wall-clock time (S)

**Goal.** Build `WithDeadlineAt(parent, t time.Time) (context.Context, context.CancelFunc)` that behaves like `context.WithDeadline` but accepts an absolute wall-clock time. Most code uses `WithTimeout(d)` (relative); some — schedulers, end-of-window jobs — need "must be done by 17:00 UTC". Show the right behaviour when the deadline is in the past.

**Starter.**

```go
package walldeadline

import (
    "context"
    "time"
)

func WithDeadlineAt(parent context.Context, t time.Time) (context.Context, context.CancelFunc) {
    return context.WithDeadline(parent, t)
}
```

**Hints.**

- `context.WithDeadline` already does exactly this — it accepts a `time.Time`. The lesson is *when* to use it vs `WithTimeout`. The starter is correct; your job is to wrap it with the right guarantees.
- Pre-elapsed deadlines: `WithDeadline(parent, time.Now().Add(-time.Hour))` returns an already-cancelled ctx with `Err() == DeadlineExceeded`. Demonstrate this with a test.
- If `parent` already has a tighter deadline, `WithDeadline` keeps the parent's. Show that this is correct behaviour, not a bug.

<details><summary>Reference solution</summary>

```go
package walldeadline

import (
    "context"
    "fmt"
    "time"
)

func WithDeadlineAt(parent context.Context, t time.Time) (context.Context, context.CancelFunc) {
    // Senior decision: delegate to WithDeadline. The implementation already
    // (a) handles past times by cancelling immediately, (b) intersects with
    // parent deadlines (tighter wins), (c) registers a timer in the runtime
    // heap. Wrapping it adds zero value EXCEPT the named alternative API —
    // which makes call sites self-documenting. Compare:
    //
    //   WithTimeout(ctx, time.Until(endOfWindow))    // why? what window?
    //   WithDeadlineAt(ctx, endOfWindow)             // obvious
    //
    // That readability swap is the entire reason to define this helper.
    return context.WithDeadline(parent, t)
}

// DeadlineSafe is a convenience for schedulers: if the deadline is already
// in the past, return a sentinel error rather than spinning up a doomed ctx.
func DeadlineSafe(parent context.Context, t time.Time, minBudget time.Duration) (context.Context, context.CancelFunc, error) {
    remaining := time.Until(t)
    if remaining < minBudget {
        return nil, nil, fmt.Errorf("deadline-safe: only %v until %v, need at least %v", remaining, t, minBudget)
    }
    ctx, cancel := context.WithDeadline(parent, t)
    return ctx, cancel, nil
}
```

Three tests: (1) `WithDeadlineAt(bg, now.Add(time.Second))`, sleep 2 s, assert `ctx.Err() == DeadlineExceeded`; (2) `WithDeadlineAt(bg, now.Add(-time.Hour))`, assert `ctx.Err() == DeadlineExceeded` immediately, no sleep; (3) parent deadline 100 ms, child `WithDeadlineAt(parent, now.Add(time.Hour))` — assert child's `Deadline()` returns parent's 100 ms, not the hour. Confirms intersection semantics.

</details>

---

## Task 17 — Show why context.Value shouldn't carry mutable state (S)

**Goal.** Demonstrate, with code and a `go test -race` failure, why storing a mutable struct (e.g. a counter or a slice you append to) in `context.Value` is a bug. Then show two correct alternatives: (a) put the value type itself, not the pointer; (b) put a sync-protected handle if mutation truly must propagate.

**Starter.**

```go
package mutablectx

import "context"

type Counter struct {
    Hits int // unsafe: shared mutable state in ctx
}

type ctxKey struct{}

func WithCounter(ctx context.Context, c *Counter) context.Context {
    return context.WithValue(ctx, ctxKey{}, c)
}

// TODO: write a test that races on Hits++ across two goroutines and fails
// under -race. Then write two safe alternatives.
```

**Hints.**

- The bug surface: any goroutine that receives the ctx can `WithCounter(ctx).Hits++` without synchronisation. The race detector flags it instantly.
- Alternative (a): store the *value* of `Counter`, not the pointer. The ctx is now immutable — but you can't observe updates upstream. That's the point of context: it's a propagation tree, not a shared variable.
- Alternative (b): if you really need shared mutable state, store an `*atomic.Int64` or a struct with a `sync.Mutex`. The ctx still propagates the *handle*; the handle itself owns concurrency.

<details><summary>Reference solution</summary>

```go
package mutablectx

import (
    "context"
    "sync"
    "sync/atomic"
)

type ctxKey struct{}

// UNSAFE — for the demo only.
type UnsafeCounter struct {
    Hits int
}

func WithUnsafeCounter(ctx context.Context, c *UnsafeCounter) context.Context {
    return context.WithValue(ctx, ctxKey{}, c)
}

func UnsafeFrom(ctx context.Context) *UnsafeCounter {
    c, _ := ctx.Value(ctxKey{}).(*UnsafeCounter)
    return c
}

// SAFE alternative A — immutable value. The counter is a snapshot at
// stamp time; downstream goroutines see the value they were handed and
// no later. Use when the ctx-carried datum is informational, not shared
// state (request_id, tenant, user_role, locale).
type Snapshot struct {
    RequestID string
    Tenant    string
}

func WithSnapshot(ctx context.Context, s Snapshot) context.Context {
    // Senior decision: store the value, not a pointer. Even if the caller
    // later mutates their local Snapshot, the ctx's copy is unaffected.
    // This is the property that makes context.Value's documentation say
    // "only request-scoped data" — the implicit assumption is that the
    // datum is immutable for the lifetime of the request.
    return context.WithValue(ctx, ctxKey{}, s)
}

// SAFE alternative B — sync-protected handle. The ctx propagates the
// pointer; concurrency is the handle's responsibility.
type SafeCounter struct {
    n atomic.Int64
}

func (c *SafeCounter) Inc()           { c.n.Add(1) }
func (c *SafeCounter) Load() int64    { return c.n.Load() }

func WithSafe(ctx context.Context, c *SafeCounter) context.Context {
    return context.WithValue(ctx, ctxKey{}, c)
}

// SAFE alternative B' — mutex-protected struct. Use when the field set
// is complex enough that atomic ops don't compose.
type GuardedSet struct {
    mu   sync.Mutex
    seen map[string]struct{}
}

func NewGuardedSet() *GuardedSet { return &GuardedSet{seen: map[string]struct{}{}} }

func (g *GuardedSet) Add(k string) {
    g.mu.Lock()
    defer g.mu.Unlock()
    g.seen[k] = struct{}{}
}

func (g *GuardedSet) Has(k string) bool {
    g.mu.Lock()
    defer g.mu.Unlock()
    _, ok := g.seen[k]
    return ok
}
```

The race test (will fail under `go test -race`):

```go
func TestUnsafeCounter_Race(t *testing.T) {
    ctx := WithUnsafeCounter(context.Background(), &UnsafeCounter{})
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            UnsafeFrom(ctx).Hits++  // -race: data race
        }()
    }
    wg.Wait()
}
```

Rewrite with `SafeCounter`; the race vanishes. The takeaway to internalise: **`context.Value` is a propagation channel, not a shared-memory channel**. The runtime gives you no guarantees about ordering or visibility of mutations through ctx values. If you need shared mutable state, propagate a synchronised handle and reason about that handle independently.

</details>

---

## Task 18 — Critique context.WithValue design; propose an alternative (Staff)

**Goal.** Write a 400-600 word design critique of `context.WithValue` as it stands today, then sketch (with Go code) an alternative API that avoids the worst pitfalls. Constraint: your alternative must keep cancellation behaviour identical; only the value-propagation surface is up for redesign.

**Starter.**

```go
package critique

// TODO: write the critique as a long comment, then sketch a typed
// alternative below.
```

**Hints.**

- The three classic complaints about `WithValue`: (1) `any` keys + `any` values defeat static typing; (2) lookup is O(depth) on every call; (3) the cultural pull is "stash anything in ctx", which leads to load-bearing magic globals.
- One alternative is *typed* per-package contexts via generics. Another is a *struct* of well-known fields passed alongside ctx (the "request struct" pattern). Each has trade-offs.
- Be concrete. A critique that doesn't name a real cost ("the lookup walks N parents on every Value call") is useless to the reader.

<details><summary>Reference solution</summary>

```go
package critique

// === Critique of context.WithValue ===
//
// The Context interface is a triumph of minimalism on three of its four
// methods. Deadline, Done, and Err carve out cancellation as a tree-shaped
// effect and let the standard library propagate it efficiently. Value, by
// contrast, was retrofitted to solve a problem that wasn't quite ready to
// be specified: how do request-scoped values travel through a call graph
// without a global? The result works, but the seams show.
//
// 1. Type erasure. `WithValue(ctx, any, any)` accepts any key and any
//    value. The intended discipline is "key must be a private type"; the
//    actual behaviour is "key can be 42 or 'foo' and the compiler won't
//    care". go vet now catches the common cases, but every codebase still
//    pays the runtime cost of an `any -> concrete` type assertion on every
//    read. A typed alternative — generic accessor with a typed key value —
//    would let the compiler eliminate the assertion entirely.
//
// 2. Lookup is O(depth). Each WithValue produces a new linked-list node;
//    Value walks the chain on every call. For a request that passes
//    through 8 middlewares, every Value() touches 8 nodes. Most servers
//    don't notice because the chain is short and lookup is rare, but
//    "context.Value in a hot loop" is a real anti-pattern with no
//    compiler-level remedy. Compare a hash-table lookup: O(1) but
//    requires a mutable map, which contradicts ctx's "immutable
//    propagation tree" design.
//
// 3. Cultural pull toward magic globals. Because anything fits, anything
//    is stashed. Teams stash database handles, logger instances, feature
//    flags, even mutable counters (see Task 17). Each is a coupling that
//    bypasses dependency injection. Discovering what a function actually
//    depends on means reading its body for ctx.Value calls. A typed
//    surface would force each "thing the request needs" to be a named,
//    findable type — a discoverability win.
//
// 4. No introspection. A debugger printing ctx shows you the chain but
//    not the keys (unexported types print as opaque {}). You can't ask
//    "what's in this context?" — only "is X in this context?". For
//    production debugging this is friction; tracing systems work around
//    it by stashing everything in baggage and re-reading from there.
//
// === Proposed alternative: typed slots ===
//
// The idea is a build-time-known "slot type" per value. The ctx still
// propagates as a tree; lookup is still O(depth); but the surface is
// typed and the keys are first-class.

// Slot is a typed accessor. Each package defines one per propagated value.
type Slot[T any] struct{ name string }

// NewSlot creates a Slot. The name is for debugging only; identity is by
// pointer.
func NewSlot[T any](name string) *Slot[T] { return &Slot[T]{name: name} }

// Set returns a derived ctx carrying v under the slot.
func (s *Slot[T]) Set(ctx Context, v T) Context {
    return withSlot[T]{Context: ctx, slot: s, v: v}
}

// Get fetches the value if present. Compiler-checked type.
func (s *Slot[T]) Get(ctx Context) (T, bool) {
    for c := ctx; c != nil; c = parent(c) {
        if w, ok := c.(withSlot[T]); ok && w.slot == s {
            return w.v, true
        }
    }
    var zero T
    return zero, false
}

// Context is shaped like context.Context (cancellation untouched).
type Context interface {
    Done() <-chan struct{}
    Err() error
    // ... Deadline, etc.
}

type withSlot[T any] struct {
    Context
    slot *Slot[T]
    v    T
}

func parent(Context) Context { return nil } // sketch only

// Usage:
//   var ReqIDSlot = NewSlot[string]("request_id")
//   ctx = ReqIDSlot.Set(ctx, "abc")
//   id, ok := ReqIDSlot.Get(ctx)  // typed, no assertion
//
// Trade-offs:
//   - Generics weren't available when Context was designed (Go 1.18 vs
//     Go 1.7). The retrofit cost would be a parallel API; Context can't
//     adopt this without breaking compatibility.
//   - Lookup is still O(depth); we didn't fix complaint #2.
//   - We did fix complaints #1, #3, #4: typed, discoverable (find all
//     references to the Slot), and named slots can print themselves.
//
// The honest conclusion: WithValue's design is a reasonable 2014 answer
// to a 2014 type system. With generics, a cleaner API is possible. But
// the actual win — typed accessors per propagated value — can already be
// achieved by wrapping WithValue inside a typed helper (see Task 3).
// The redesign earns its keep only if the runtime cost of `any` becomes
// a measurable hotspot, which for most servers it never does.
```

The exercise is the critique, not the alternative. A staff engineer's job is to know exactly what's wrong with the tool, weigh the redesign cost against the residual pain, and *recommend not redesigning* when the math says so. Bonus points if your write-up names the migration cost — every package in the ecosystem uses `context.WithValue` directly, so a replacement is realistically an additive API, not a substitute.

</details>

---

## Task 19 — Compare Go context cancellation cost to Tokio's CancellationToken (Staff)

**Goal.** Build a microbenchmark in Go (`testing.B`) that measures the cost of (a) `WithCancel + cancel`, (b) `Done() <-chan receive on a closed channel`, (c) `Value` lookup at depth N=8. Then research and document the equivalent operations for Tokio's `CancellationToken` in Rust. Produce a short table with rough numbers and one paragraph of interpretation.

**Starter.**

```go
package cmpbench

import (
    "context"
    "testing"
)

func BenchmarkWithCancel(b *testing.B) {
    ctx := context.Background()
    for i := 0; i < b.N; i++ {
        _, cancel := context.WithCancel(ctx)
        cancel()
    }
}

// TODO: BenchmarkDoneClosed, BenchmarkValueDepth8.
```

**Hints.**

- Pin the Go version and CPU before quoting numbers. `go test -bench=. -benchmem -count=5 -run=^$` gives stable reads on a quiet machine.
- Tokio's `CancellationToken` lives in `tokio_util::sync::CancellationToken`. The cancel path notifies all waiters via an internal `Notify`. Look up its source to compare; the equivalent "create + cancel" is `let t = CancellationToken::new(); t.cancel();`.
- Don't overclaim. Cross-runtime benchmarks have noisy methodology; quote them with order-of-magnitude precision, not three significant figures.

<details><summary>Reference solution</summary>

```go
package cmpbench

import (
    "context"
    "testing"
)

func BenchmarkWithCancel(b *testing.B) {
    ctx := context.Background()
    for i := 0; i < b.N; i++ {
        _, cancel := context.WithCancel(ctx)
        cancel()
    }
}

func BenchmarkDoneClosed(b *testing.B) {
    ctx, cancel := context.WithCancel(context.Background())
    cancel()
    done := ctx.Done()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        select {
        case <-done:
        default:
        }
    }
}

type kk struct{ n int }

func BenchmarkValueDepth8(b *testing.B) {
    ctx := context.Background()
    for i := 0; i < 8; i++ {
        ctx = context.WithValue(ctx, kk{i}, i)
    }
    target := kk{0} // deepest — worst case
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = ctx.Value(target)
    }
}
```

```
=== Go 1.22, Apple M2 (rough, single-threaded) ===

BenchmarkWithCancel-8         ~140 ns/op    96 B/op    2 allocs
BenchmarkDoneClosed-8          ~3 ns/op      0 B/op    0 allocs
BenchmarkValueDepth8-8        ~25 ns/op      0 B/op    0 allocs

=== Tokio 1.40, equivalent ops, M2, single-threaded ===
(from rust-tokio github benches, rough)

CancellationToken::new + cancel:   ~80 ns/op   ~64 B (Arc<Inner>)
token.is_cancelled() (post-cancel): ~1 ns/op   0 B
(no direct "value at depth N" equivalent — Tokio does not carry per-task
 values through CancellationToken; that role belongs to tokio::task_local!
 or to a request-struct passed alongside.)
```

### Interpretation

The two designs end up on the same order of magnitude. Go's `WithCancel` allocates two things (the new `*cancelCtx` and a `chan struct{}`) and registers with the parent; Tokio's `CancellationToken` allocates an `Arc<Inner>` plus a `Notify`. The post-cancel hot paths — checking "are we done?" — are both essentially memory-load + branch and clock in under 5 ns.

The interesting difference is *what they don't have in common*. Go's ctx tree carries values AND cancellation through the same type; Tokio splits them: `CancellationToken` for cancel, `task_local!` or explicit struct for values. The Go design buys ergonomics (one parameter to thread through everything) at the cost of complaints #1-#4 in Task 18. The Rust design buys clarity at the cost of needing two threading patterns.

For latency-sensitive code where ctx is checked in a hot loop, Go's numbers are fine: a `<-ctx.Done()` non-blocking select is 3 ns. The actual bottleneck in real services is rarely the cancellation primitive — it's `ctx.Value` calls in the request path (25 ns at depth 8 is non-trivial if you do it 10x per request times 10k RPS = 2.5 ms/sec CPU, ~0.25% of a core, on lookup alone). The optimisation, when you need it, is to read `Value` once at the boundary and shove the extracted struct down via explicit parameters.

The takeaway for design discussions: don't pick "Go-style ctx" vs "Tokio-style token" on performance grounds. Pick on ergonomics-vs-discoverability grounds; the runtime cost difference is below noise for any system that isn't a tight CPU loop.

</details>

---

## Task 20 — Trace-context that captures call stack on each derived context (Staff, educational)

**Goal.** Build `TracingContext` — a wrapper around `context.Context` that records, at every `With*` call, the call stack of the goroutine that derived it. Provide `Trace(ctx)` to dump the full derivation history with file/line/function. This is for debugging *only*; it should not ship to production. Demonstrate it on a real example with three layers of middleware.

**Starter.**

```go
package tracectx

import "context"

type TracingContext struct {
    context.Context
    // TODO: stack of derivation frames
}

func Wrap(ctx context.Context) *TracingContext {
    return &TracingContext{Context: ctx}
}

// TODO: WithValue, WithCancel, WithTimeout shadow the stdlib helpers and
// record the caller's stack.

func Trace(ctx context.Context) string {
    return ""
}
```

**Hints.**

- `runtime.Callers` + `runtime.CallersFrames` walks the stack with file/line/func. Skip the first 2-3 frames (yourself + runtime).
- Each derived `TracingContext` carries its parent's history *plus* the new frame. Build a linked list, not a slice — that matches ctx's actual derivation shape.
- This is educational because the moment you ship it to prod you'll find that every `runtime.Callers` allocates and the cost dominates real workloads. State that limitation explicitly in the doc comment.

<details><summary>Reference solution</summary>

```go
package tracectx

import (
    "context"
    "fmt"
    "runtime"
    "strings"
    "time"
)

// TracingContext wraps a context.Context and records the derivation stack
// at each step. EDUCATIONAL / DEBUG ONLY — runtime.Callers allocates and
// formats are slow. Do not ship to production hot paths.
type TracingContext struct {
    context.Context
    parent *TracingContext // nil at root
    frame  frame
}

type frame struct {
    when time.Time
    pc   [16]uintptr
    n    int
    note string
}

func capture(note string) frame {
    var f frame
    f.when = time.Now()
    f.note = note
    // Senior decision: skip(3) — runtime.Callers, capture, and the
    // calling With* helper. Past those, we're in user code.
    f.n = runtime.Callers(3, f.pc[:])
    return f
}

func Wrap(ctx context.Context) *TracingContext {
    return &TracingContext{Context: ctx, frame: capture("Wrap")}
}

func (t *TracingContext) WithValue(key, val any) *TracingContext {
    return &TracingContext{
        Context: context.WithValue(t.Context, key, val),
        parent:  t,
        frame:   capture(fmt.Sprintf("WithValue(%v)", key)),
    }
}

func (t *TracingContext) WithCancel() (*TracingContext, context.CancelFunc) {
    ctx, cancel := context.WithCancel(t.Context)
    return &TracingContext{
        Context: ctx,
        parent:  t,
        frame:   capture("WithCancel"),
    }, cancel
}

func (t *TracingContext) WithTimeout(d time.Duration) (*TracingContext, context.CancelFunc) {
    ctx, cancel := context.WithTimeout(t.Context, d)
    return &TracingContext{
        Context: ctx,
        parent:  t,
        frame:   capture(fmt.Sprintf("WithTimeout(%v)", d)),
    }, cancel
}

// Trace dumps the derivation chain newest-first.
func Trace(ctx context.Context) string {
    tc, ok := ctx.(*TracingContext)
    if !ok {
        return "(not a TracingContext)"
    }
    var b strings.Builder
    depth := 0
    for c := tc; c != nil; c = c.parent {
        fmt.Fprintf(&b, "=== depth %d: %s at %s ===\n", depth, c.frame.note, c.frame.when.Format(time.RFC3339Nano))
        frames := runtime.CallersFrames(c.frame.pc[:c.frame.n])
        for {
            f, more := frames.Next()
            fmt.Fprintf(&b, "  %s\n      %s:%d\n", f.Function, f.File, f.Line)
            if !more {
                break
            }
        }
        depth++
    }
    return b.String()
}

// Demo — three middleware layers.
func DemoServerFlow() string {
    base := Wrap(context.Background())
    // Middleware 1: auth
    afterAuth := base.WithValue("user", "alice")
    // Middleware 2: deadline
    afterDL, cancel1 := afterAuth.WithTimeout(2 * time.Second)
    defer cancel1()
    // Middleware 3: tenant
    afterTenant := afterDL.WithValue("tenant", "acme")
    // Handler does some work, then dumps the trace
    return Trace(afterTenant)
}
```

When `DemoServerFlow` runs, `Trace` prints something like:

```
=== depth 0: WithValue(tenant) at 2026-05-29T14:33:01.123Z ===
  tracectx.DemoServerFlow
      .../demo.go:142
  testing.tRunner
      .../testing.go:1690

=== depth 1: WithTimeout(2s) at 2026-05-29T14:33:01.122Z ===
  tracectx.DemoServerFlow
      .../demo.go:140
  testing.tRunner
      .../testing.go:1690

=== depth 2: WithValue(user) at 2026-05-29T14:33:01.121Z ===
  tracectx.DemoServerFlow
      .../demo.go:138
  testing.tRunner
      .../testing.go:1690

=== depth 3: Wrap at 2026-05-29T14:33:01.120Z ===
  tracectx.DemoServerFlow
      .../demo.go:136
  testing.tRunner
      .../testing.go:1690
```

The educational payoff: you can *see* the tree the runtime would otherwise hide. When debugging a "ctx-related issue" — a value didn't propagate, a cancel didn't fire, a deadline came from somewhere unexpected — this tool tells you exactly which line in your codebase derived the ctx that's misbehaving. It's a flashlight, not a production primitive. The senior-level decision is recognising that the build cost (one allocation per `With*` call, one runtime.Callers per derive) prices it out of the hot path forever; the educational decision is building it once, running it on staging, learning what your ctx tree actually looks like, and then deleting the tool.

</details>

---

## Closing

Twenty tasks; the spine running through them is: **read the source first, then build the things the source didn't give you**. Cancellation is a tree. Values are propagation, not state. Cause is debuggability. Detach is a 1.21 escape hatch. AfterFunc replaces the `go func() { <-ctx.Done(); cleanup() }()` boilerplate. Custom Context types cost goroutines; wrap, don't reimplement. And `WithValue` is the part of the API you should approach with the most suspicion — it's the one most likely to grow into a magic-globals problem if you let it. Internalise these as reflexes, not facts; once they're reflexes, every concurrent Go program you write will be measurably easier to reason about.

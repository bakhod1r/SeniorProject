# Context — Find the Bug

## 1. How to use this file

Fourteen buggy snippets of `context` usage in Go: cancel-leaks, value-key collisions, struct-stored contexts, lost deadlines, busy spins, double-cancels, nil-ctx panics, `WithoutCancel` misuse. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer.

Context bugs almost never blow up on the happy path. They silently leak a goroutine because nobody called `cancel`. They quietly drop a deadline because a leaf re-rooted on `Background()`. They collide on a `string` value key the moment a second package picks the same word. Four questions to ask every snippet:

1. *Does every `WithCancel`/`WithTimeout`/`WithDeadline` have a `defer cancel()` reachable on every path?*
2. *Is the parent passed through unmodified — no `context.Background()` or `context.TODO()` substituted in the middle of a call chain?*
3. *Is the context ever stored on a long-lived struct or shared past the caller's return?*
4. *Are value keys unexported named types, not bare strings — and is every consumer prepared for `ctx == nil`?*

If a snippet can't answer all four, there's a bug. Every diagnosis below references `context/context.go` from the Go 1.22 standard library by line number, so you can confirm the source-level reason rather than trusting the prose.

---

## Bug 1 — `WithCancel` returned but `cancel` never called (goroutine leak)

```go
import "context"

func fetchUser(parent context.Context, id string) (*User, error) {
    ctx, _ := context.WithCancel(parent)   // BUG: cancel discarded
    return store.Get(ctx, id)
}
```

<details><summary>Answer</summary>

**Bug:** `WithCancel` returns `(ctx, cancel)`. Discarding `cancel` is a guaranteed leak. `withCancel` (context.go:273) builds a `cancelCtx` and calls `c.propagateCancel(parent, c)` (context.go:475). When `parent` is itself a `cancelCtx`, `propagateCancel` registers the new child in `parent.children` (the `map[canceler]struct{}` at context.go:436). That registration is *only* removed by `c.cancel(removeFromParent=true, ...)` at context.go:549. If nobody calls the returned `cancel`, the child stays in the parent's map for the lifetime of the parent. If the parent is `context.Background()`, the child stays forever. `goroutines` (context.go:371) goes up; nothing brings it down.

**Why subtle:** Nothing crashes. The function returns the right `User`. The leak shows up only under load — slow memory creep, eventually OOM. The signal is in `runtime/pprof` heap profiles, not in unit tests.

**Spot:** `go vet` ships `lostcancel` exactly for this. Any line of the form `ctx, _ := context.WithCancel(...)` or `ctx, _ := context.WithTimeout(...)` or `ctx, _ := context.WithDeadline(...)` is wrong. The underscore is the bug.

**Fix:**

```go
func fetchUser(parent context.Context, id string) (*User, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()
    return store.Get(ctx, id)
}
```

`cancel()` is idempotent (see Bug 10), so the unconditional `defer` is always safe.

**Why common:** Callers see `cancel` as "for the error path" and discard it on the happy path. The whole point of `cancel` is to free the parent registration even when nothing went wrong. The cleanup is the point, not the abort.
</details>

---

## Bug 2 — `context.WithValue` using a bare `string` key

```go
const userIDKey = "user_id"

func WithUser(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, userIDKey, id)   // BUG: string key
}

func User(ctx context.Context) string {
    s, _ := ctx.Value(userIDKey).(string)
    return s
}
```

<details><summary>Answer</summary>

**Bug:** `context.WithValue` stores the pair in a `valueCtx{key, val any}` (context.go:742). Lookup walks the chain comparing keys with `==` (context.go:768). A bare `string` is comparable to *any other* `string` with the same characters, so the moment a second package picks `"user_id"` — middleware, an auth library, a logging context — they collide. Whoever wrapped last wins; the other side reads the wrong value. The doc comment on `WithValue` (context.go:715-727) explicitly warns: "The provided key must be comparable and should not be of type `string` or any other built-in type to avoid collisions between packages." `go vet`'s `contextkey` analyser flags this exact pattern.

**Why subtle:** Within one package the bug is invisible — your one string matches your one string. The collision only fires when two packages converge in a request pipeline. The bad reader gets *a* value with the *right* type; the static type-assertion succeeds, the runtime value is wrong.

**Spot:** Any `context.WithValue(ctx, "...", ...)` literal. Any `const fooKey = "..."` paired with `ctx.Value(fooKey)`. `go vet` and `staticcheck`'s `SA1029` catch it.

**Fix:** Use an unexported named type. The type identity makes the key unforgeable across packages:

```go
type userIDKeyT struct{}
var userIDKey userIDKeyT

func WithUser(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, userIDKey, id)
}
func User(ctx context.Context) string {
    s, _ := ctx.Value(userIDKey).(string)
    return s
}
```

Empty struct, zero size, package-private — no other package can construct the same key. Matches the pattern `cancelCtxKey int` (context.go:374) used by the stdlib itself.

**Why common:** Strings are the obvious key type for a key/value bag. The collision footgun is non-obvious from the call site, and discovery requires reading the package doc. The lint rule is the cheapest signal.
</details>

---

## Bug 3 — Storing `context.Context` in a struct field

```go
type Service struct {
    ctx context.Context   // BUG: long-lived field
    db  *DB
}

func NewService(ctx context.Context, db *DB) *Service {
    return &Service{ctx: ctx, db: db}
}

func (s *Service) Find(id string) (*User, error) {
    return s.db.Get(s.ctx, id)   // uses whatever ctx was at construction
}
```

<details><summary>Answer</summary>

**Bug:** Context is *per-call*, not per-object. The doc comment on `Context` (context.go:36-44) is explicit: "Do not store Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it. The Context should be the first parameter, typically named ctx." Storing it freezes one request's deadline, values, and cancellation channel into a long-lived object. Later callers — possibly from other requests, possibly from a different request lifecycle — inherit the *constructor's* ctx. When the constructor's request finishes and its `cancel` runs, every subsequent `Find` sees `ctx.Err() == Canceled` and returns immediately.

**Why subtle:** Tests instantiate `NewService(context.Background(), db)` and pass forever — `Background()` never cancels, so `s.ctx` is permanently valid. Production wires `NewService(reqCtx, db)`; the next request's `Find` panics with "context canceled" once the original request returns.

**Spot:** Any struct field of type `context.Context`. Any constructor that takes a context and stashes it. The Go `linters` ecosystem has `containedctx` for exactly this.

**Fix:** Take ctx as the first parameter of every method that needs one:

```go
type Service struct{ db *DB }

func NewService(db *DB) *Service { return &Service{db: db} }

func (s *Service) Find(ctx context.Context, id string) (*User, error) {
    return s.db.Get(ctx, id)
}
```

The one canonical exception is request-scoped types whose entire identity is one request (`*http.Request` carries one via `req.Context()` — and even that is opaque, accessed via method, not field).

**Why common:** "Threading ctx through every method is ugly." It's a deliberate choice — ctx is *information about the call*, not about the object. Putting it on the struct converts call-scoped state into object-scoped state, and the request lifecycle stops matching the object lifecycle.
</details>

---

## Bug 4 — `context.Background()` substituted at a leaf (deadline lost)

```go
func handler(ctx context.Context, w http.ResponseWriter, r *http.Request) {
    // ctx came from a WithTimeout(parent, 5*time.Second) higher up the stack.
    rows, err := db.QueryContext(context.Background(), "SELECT ...")   // BUG
    ...
}
```

<details><summary>Answer</summary>

**Bug:** The outer caller wrapped a deadline. The leaf re-rooted on `context.Background()` (context.go:215), throwing the deadline away. `db.QueryContext` will block until the database returns; the 5-second SLA the caller assumed is silently gone. Same defect with `context.TODO()` at the leaf (see Bug 9).

`Background()` is documented (context.go:209-214) as the root for `main`, `init`, tests, and incoming requests. It has no `Deadline`, no `Done`, no `Value`s — `emptyCtx` methods at context.go:181-197 all return zero. Substituting it mid-call drops every cancellation and every value the parent set.

**Why subtle:** The query works. The result is correct. Tests pass because tests don't exceed their (absent) deadline. Production breaks when the database is slow — the timeout the handler *thought* it had isn't there, and the request hangs until something else times out (load balancer, client).

**Spot:** Any `context.Background()` or `context.TODO()` inside a function whose signature already includes `ctx context.Context`. Linter rule: `contextcheck`. Static rule: if the function takes ctx, the function does not create ctx.

**Fix:**

```go
rows, err := db.QueryContext(ctx, "SELECT ...")
```

If the leaf genuinely should outlive the request (background flush, fire-and-forget), use `context.WithoutCancel(ctx)` (Go 1.21+, context.go:585) to preserve values but detach cancellation — that's a deliberate, auditable severance, unlike "happened to type `Background()`".

**Why common:** Two reasons. (1) Copy-paste from `main`, where `Background()` is the right answer. (2) "I want this to run regardless" — but "regardless of caller cancellation" is rarely the actual intent. The intent is usually "with the same deadline as the caller", which is achieved by *not* doing anything special.
</details>

---

## Bug 5 — Goroutine `select`s on `ctx.Done()` but never reads it again

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            // BUG: no return — falls through, loops forever
        case j := <-jobs:
            process(j)
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `<-ctx.Done()` is a *read* on a channel that's permanently ready once `cancel()` fires. The `select` arm matches, the body is empty, the outer `for` restarts the `select`, the `Done` channel is *still* ready (it was closed, not signalled), the arm matches again — instant busy-loop pegging one CPU core. From context.go:451: the `Done` channel is created once via `c.done.CompareAndSwap(nil, closedchan)` (or a fresh channel that's later closed at context.go:564). Once closed, every subsequent receive returns the zero value immediately — that's the point of the close-as-broadcast pattern.

**Why subtle:** Before cancellation the loop is well-behaved. After cancellation it pegs a core but the program *seems* alive — log lines stop coming because the busy goroutine doesn't yield, but the process doesn't crash. Symptom in production: one core at 100%, no progress, no panic.

**Spot:** Any `case <-ctx.Done():` arm whose body doesn't `return` (or `break` out of the surrounding loop). The Done channel is a one-shot broadcast — you read it once to *learn* of cancellation, then exit.

**Fix:**

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            process(j)
        }
    }
}
```

If cleanup is needed, do it after the `return`-style structure: drain a buffered channel, log `ctx.Err()`, close downstream channels. But you must *leave the select*.

**Why common:** Empty `case` arms look harmless in unrelated `select`s where the channel later un-fires. `Done` doesn't un-fire — close is permanent — so an empty arm under cancellation is exactly the wrong shape.
</details>

---

## Bug 6 — Forgot to check `ctx.Err()` after `<-ctx.Done()`

```go
func runJob(ctx context.Context) error {
    done := launchAsync()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return errors.New("job aborted")   // BUG: hides Canceled vs DeadlineExceeded
    }
}
```

<details><summary>Answer</summary>

**Bug:** `ctx.Done()` closes for two distinct reasons — the caller cancelled (`context.Canceled`, context.go:167) or a deadline expired (`context.DeadlineExceeded`, context.go:171). The caller of `runJob` wants to *know which* — Canceled means "user gave up, no retry"; DeadlineExceeded means "server too slow, retry with backoff is OK". A bare `errors.New(...)` collapses both into one opaque string.

`ctx.Err()` (context.go:463 for `cancelCtx`, with the deadlined variant in `timerCtx`'s cancel at context.go:679) returns exactly one of those two sentinel errors, set under the lock at context.go:560-573 before the channel close. The information is *there* — the bug is throwing it away.

**Why subtle:** From the unit test you wrote, "job aborted" is the right outcome. The retry layer two functions up doesn't see Canceled vs DeadlineExceeded; it retries everything or retries nothing, neither correct.

**Spot:** Any `case <-ctx.Done(): return <literal>` or `return errors.New(...)`. Sentinel errors are designed to be propagated, not paraphrased.

**Fix:**

```go
case <-ctx.Done():
    return ctx.Err()   // returns Canceled or DeadlineExceeded
```

Or wrap with `%w` so the caller can `errors.Is(err, context.DeadlineExceeded)`:

```go
return fmt.Errorf("runJob: %w", ctx.Err())
```

`DeadlineExceeded` implements `Timeout() bool { return true }` (context.go:175-177), so retry layers using `interface{ Timeout() bool }` light up correctly.

**Why common:** "I want a nicer error message" — but the right place for the nicer message is *wrapping*, not replacing. The sentinel is the contract; the human prose is decoration.
</details>

---

## Bug 7 — `context.WithTimeout(parent, 0)` (immediate cancel)

```go
func quickCheck(parent context.Context, attempt int) error {
    d := time.Duration(attempt) * 100 * time.Millisecond
    ctx, cancel := context.WithTimeout(parent, d)   // BUG: d == 0 on attempt 0
    defer cancel()
    return ping(ctx)
}
```

<details><summary>Answer</summary>

**Bug:** `WithTimeout(parent, 0)` resolves to `WithDeadline(parent, time.Now())` (context.go:703-708). `WithDeadline` (context.go:625) computes `dur := time.Until(d)`; if `dur <= 0`, it calls `c.cancel(true, DeadlineExceeded, ...)` *immediately* (context.go:651), before returning. The returned ctx has `Err() == DeadlineExceeded` from the first instant.

Result: every call inside `quickCheck` with `attempt == 0` gets a pre-cancelled context. `ping(ctx)` short-circuits on the very first `ctx.Done()` check and returns `DeadlineExceeded`. The function looks like it ran a check; it actually ran nothing.

**Why subtle:** `0 * time.Second` reads as "use the default" or "no timeout" — neither is right. Zero is a valid `Duration` representing zero nanoseconds. `WithCancel(parent)` (positive infinity) and `WithTimeout(parent, time.Hour)` are the same flavour of ctx; only the boundary case `0` collapses.

**Spot:** Any `WithTimeout` whose duration argument comes from arithmetic that can yield 0 or negative — `time.Until(t)` with `t` in the past, `attempt * unit` with `attempt = 0`, configuration default `0` interpreted as "infinite".

**Fix:** Validate at the boundary. If `d <= 0` means "no deadline", call `WithCancel(parent)` instead. If `d <= 0` is a configuration error, return it:

```go
if d <= 0 {
    return fmt.Errorf("quickCheck: non-positive timeout %v", d)
}
ctx, cancel := context.WithTimeout(parent, d)
defer cancel()
```

**Why common:** Code that treats `0` as "unset" in some configs (env vars, flag defaults) collides with `WithTimeout`'s "use exactly this duration" contract. The two conventions need explicit translation.
</details>

---

## Bug 8 — `context.WithDeadline(parent, time.Time{})` or a past time

```go
func runUntil(parent context.Context, until time.Time) error {
    ctx, cancel := context.WithDeadline(parent, until)   // BUG when until is past/zero
    defer cancel()
    return loop(ctx)
}
```

<details><summary>Answer</summary>

**Bug:** Same root cause as Bug 7, different surface. `WithDeadline` computes `dur := time.Until(d)` (context.go:649). If `d` is `time.Time{}` (the zero time, year 1) or any past instant, `dur` is hugely negative. The function returns a context that's already at `DeadlineExceeded` — context.go:651-657 calls `c.cancel(true, DeadlineExceeded, Cause(parent))` *before* `WithDeadline` returns. No timer is started (the `if dur <= 0` branch returns early); the returned `cancel` is for the already-cancelled context.

A second slightly different trap: passing a deadline *later* than the parent's deadline. context.go:638-642 checks `if cur, ok := parent.Deadline(); ok && cur.Before(d) { return WithCancel(parent) }` — the function silently downgrades to `WithCancel` because the parent's deadline already bounds it. Not a bug, but surprising if you expected the longer deadline to win.

**Why subtle:** Same shape as Bug 7. The function appears to "do something with a deadline"; it actually short-circuits. `time.Time{}` (zero value) is a common defaulted-but-not-set value from JSON/YAML configs. A `Until time.Time` field that arrived as zero turns every call into an instant DeadlineExceeded.

**Spot:** Any `WithDeadline` whose `d` argument can be unset/zero/past. Any deadline computed by subtraction (`startTime.Add(timeout)`) where `startTime` could be in the distant past.

**Fix:** Validate:

```go
if until.IsZero() || until.Before(time.Now()) {
    return fmt.Errorf("runUntil: deadline %v is not in the future", until)
}
ctx, cancel := context.WithDeadline(parent, until)
defer cancel()
```

If the input is configuration, validate at parse time, not at use time. The earlier you reject, the closer the error is to the human who can fix it.

**Why common:** Zero `time.Time` looks like "no deadline" to anyone unfamiliar with the type. It is in fact "deadline at year 1", which is in the past, which is immediate cancel.
</details>

---

## Bug 9 — `context.TODO()` left in production code

```go
func ChargeCard(amount int64) error {
    return paymentsAPI.Charge(context.TODO(), amount)   // BUG: shipped to prod
}
```

<details><summary>Answer</summary>

**Bug:** `context.TODO()` (context.go:223-229) returns the singleton `todoCtx{}`, identical in behaviour to `Background()` — no deadline, no values, no cancellation. The doc comment is explicit: "TODO returns a non-nil, empty Context. Code should use context.TODO when it's unclear which Context to use or it is not yet available (because the surrounding function has not yet been extended to accept a Context parameter). TODO is identified by static analysis tools that determine whether Contexts are being propagated correctly in a program." `String()` returns `"context.TODO"` (context.go:207) precisely so that grep, vet, and pprof traces can find these stragglers.

The bug isn't that TODO is broken — it's that it's a marker of "we haven't decided yet". When that marker ships to production, the caller's deadline, cancellation, and request-scoped values all silently disappear at this leaf.

**Why subtle:** Behaves identically to `Background()`. The function works. Cancellation just doesn't reach it. The only signal is the literal token `TODO` in the source — which is exactly what `staticcheck`'s `SA1012` and the `contextcheck` linter look for.

**Spot:** `grep -rn 'context.TODO()' .` Every hit is a code-review question: "did you finish threading ctx through, or is this still a stub?"

**Fix:** Thread `ctx` through:

```go
func ChargeCard(ctx context.Context, amount int64) error {
    return paymentsAPI.Charge(ctx, amount)
}
```

If you genuinely have nowhere to thread from (a global init, a fire-and-forget background loop), use `Background()` — but be deliberate. `Background()` says "this is a root"; `TODO()` says "I haven't decided". Production code should never say the second.

**Why common:** `TODO()` is the easiest way to compile a function that doesn't yet take ctx. It's meant to be a temporary scaffold. The bug is when the scaffold becomes permanent because nobody opened the PR to add the `ctx context.Context` parameter.
</details>

---

## Bug 10 — Calling `cancel()` twice (works, but reads as bug)

```go
func runQuery(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    err := doWork(ctx)
    if err != nil {
        cancel()           // BUG: redundant, misleading
        return err
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** Not a runtime bug — `cancelCtx.cancel` (context.go:549) is explicitly idempotent. The first thing it does after taking the lock is `if c.err != nil { c.mu.Unlock(); return }` (context.go:557-560). The second call is a no-op. The bug is *readability*: the explicit `cancel()` before `return err` reads as "this matters", which makes a reader wonder what the `defer cancel()` is for, which makes the reader doubt every other `defer cancel()` in the codebase.

Worse, this pattern hides a class of real bugs. If the early `cancel()` is removed (because someone reasoned "the defer handles it"), and the `defer` is removed in a refactor (because someone reasoned "the explicit cancel handles it"), the result is Bug 1 — a leak. The redundancy was load-bearing for the wrong reason.

**Why subtle:** The program is correct. `cancel` is idempotent, so no harm. The harm is to the next reader.

**Spot:** Any `cancel()` call site outside `defer`. There are legitimate ones — a goroutine that wants to terminate its child on success — but they should be rare and commented.

**Fix:** Trust the `defer`:

```go
func runQuery(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    if err := doWork(ctx); err != nil {
        return err
    }
    return nil
}
```

If the explicit cancel matters — e.g., to release the parent's child slot *before* a long post-work cleanup — say so in a comment:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
result, err := doWork(ctx)
cancel() // release child slot before slow flush below
slowFlush(result)
```

**Why common:** "Belt and braces" instinct. The runtime is forgiving here; the reader is not.
</details>

---

## Bug 11 — Passing `nil` as context

```go
func ChargeCard(ctx context.Context, amount int64) error {
    return paymentsAPI.Charge(ctx, amount)
}

// caller
err := ChargeCard(nil, 100)   // BUG: nil Context
```

<details><summary>Answer</summary>

**Bug:** `Context` is an interface. The zero value is `nil`. The interface methods (context.go:71-153) — `Deadline()`, `Done()`, `Err()`, `Value()` — are all called as method dispatch on the interface value; method dispatch on a nil interface panics with `runtime error: invalid memory address or nil pointer dereference`. The first call inside `paymentsAPI.Charge` that does `ctx.Done()` or `ctx.Value(...)` blows up. The stack trace points to the dispatch site, far from the caller that planted the nil.

The doc on `Context` (context.go:36) is explicit: "Do not pass a nil Context, even if a function permits it. Pass context.TODO if you are unsure about which Context to use." Standard library functions enforce this — `http.NewRequestWithContext` panics on nil, `database/sql.DB.QueryContext` panics on nil.

**Why subtle:** Some functions tolerate nil ctx for compatibility (older libraries, legacy methods). Most don't. Whether a given API panics on nil is implementation-defined, so "passes the test" depends on which path inside the callee happens to touch ctx.

**Spot:** Any literal `nil` in a position typed `context.Context`. Any caller of a function with `ctx context.Context` that hasn't received a ctx itself (the right answer is to take one as a parameter, never to fabricate `nil`).

**Fix:** Use `context.Background()` or `context.TODO()`:

```go
err := ChargeCard(context.Background(), 100)   // explicit root
```

If the call site has its own ctx, use that. The point is: never nil. The two-second cost of typing `context.Background()` saves the runtime panic.

**Why common:** Test code that doesn't care about ctx and types `nil` to shut up the compiler. Glue code where ctx isn't yet wired and `nil` "compiles". Both surface in production the first time the callee touches ctx.
</details>

---

## Bug 12 — Race between `cancel()` and `<-ctx.Done()` on a custom Context

```go
// Custom Context wrapping a real context, recording the deadline reason.
type tracingCtx struct {
    context.Context
    cancelled atomic.Bool
}

func (c *tracingCtx) Done() <-chan struct{} {
    if c.cancelled.Load() {
        return closedchan
    }
    return c.Context.Done()
}
// caller calls cancel() concurrently with another goroutine reading <-ctx.Done()
```

<details><summary>Answer</summary>

**Bug:** Custom `Context` implementations have to honour the "Done is closed asynchronously after cancel returns" contract — but they routinely don't. The stdlib `cancelCtx.cancel` (context.go:549-583) handles this carefully: under the lock it sets `c.err = err`, then either swaps in `closedchan` via `c.done.CompareAndSwap(nil, closedchan)` (context.go:565) *or* closes the existing channel via `close(d.(chan struct{}))` (context.go:567). Either way, observers see (a) the lazy `Done()` channel allocation (context.go:448-461) and (b) the *atomic transition* from open to closed.

A custom Context like the one above uses two separate signals (an `atomic.Bool` and the embedded ctx's Done channel) without synchronising the *transition*. A reader can see `cancelled.Load() == false`, fall through to `c.Context.Done()`, and miss the close that happened between the check and the return. Conversely, `cancelled` can go true *before* the underlying channel closes — readers see "cancelled" with no Done event, or vice-versa.

The stdlib is safe because `cancelCtx` owns the channel *and* the error and gates both behind one mutex (`c.mu` at context.go:432). Custom implementations rarely replicate that ordering and end up with a TOCTOU race that `-race` reports.

**Why subtle:** `-race` catches it; production usually doesn't, because the window between "set bool" and "close channel" is microseconds. The bug surfaces as flaky tests, or a one-in-a-million missed cancellation under heavy contention.

**Spot:** Any `type X struct { context.Context; ... }` where `X` overrides `Done()` or `Err()` without holding a lock around the transition. Any custom Context that stores cancellation state in multiple variables.

**Fix:** Don't write custom Context. If you must, embed `context.Context` and *forward* — let the underlying ctx own the synchronisation:

```go
type tracingCtx struct {
    context.Context
    // observation only — never participate in cancellation
}
// inherit Done() and Err() unchanged; trace on Value lookup or out-of-band
```

If you need to *add* a cancellation channel, chain via `context.WithCancel(parent)` so the stdlib owns the close. Don't roll your own.

**Why common:** "I just want to add a field" leads to embedding `context.Context` and overriding one method. The override breaks the atomicity contract documented at context.go:36 ("Context implementations must be safe for simultaneous use by multiple goroutines"). The escape hatch is to compose rather than override.
</details>

---

## Bug 13 — Returning a child context from a function that outlives the caller

```go
func openSession(parent context.Context) context.Context {
    ctx, cancel := context.WithTimeout(parent, 30*time.Second)
    defer cancel()           // BUG: cancels before caller can use ctx
    return ctx
}

// caller
sessionCtx := openSession(reqCtx)
go process(sessionCtx)       // ctx is already cancelled
```

<details><summary>Answer</summary>

**Bug:** `defer cancel()` runs when `openSession` returns. The returned `ctx` is *already cancelled* by the time the caller receives it. `ctx.Err()` is `Canceled` (context.go:560 set it inside `c.cancel`); `ctx.Done()` is closed (context.go:564-568). The downstream `process(sessionCtx)` sees a dead context.

The deeper bug is *ownership*. `WithCancel`/`WithTimeout`/`WithDeadline` return `(ctx, cancel)` together because cancellation responsibility flows with the context. Whoever holds `cancel` must call it; whoever uses `ctx` must do so before `cancel` is called. Hiding `cancel` behind `defer` inside the constructor severs this ownership — the caller has no way to keep ctx alive *and* no way to clean up.

A symmetric mistake: returning ctx *without* the cancel, expecting the caller to "deal with it". The caller can't deal with a cancel they never received — and the ctx will leak per Bug 1.

**Why subtle:** Tests that immediately consume ctx may pass — the `defer cancel()` runs after the test assertion. Real callers that pass ctx to a goroutine, store it, or hand it to a slower I/O path see the cancellation race.

**Spot:** Any function that returns a `context.Context` it created via `WithCancel`/`WithTimeout`/`WithDeadline`. Either the function should also return `cancel`, or it shouldn't be creating ctx in the first place.

**Fix:** Return both `ctx` and `cancel`, and let the caller own the lifecycle:

```go
func openSession(parent context.Context) (context.Context, context.CancelFunc) {
    return context.WithTimeout(parent, 30*time.Second)
}

// caller
sessionCtx, cancel := openSession(reqCtx)
defer cancel()
go process(sessionCtx)
```

This is exactly the shape the stdlib uses — `WithCancel`, `WithTimeout`, `WithDeadline`, `WithCancelCause` all return the pair. If you can't return the pair (e.g., the function returns a different higher-level type), store `cancel` on that type and call it from `Close`.

**Why common:** "I want a one-liner that returns ctx." The shape `func() ctx` instead of `func() (ctx, cancel)` is shorter. The lifecycle break is invisible from the call site.
</details>

---

## Bug 14 — Misuse of `context.WithoutCancel` (Go 1.21+): losing required cancellation

```go
func writeAuditLog(ctx context.Context, event Event) {
    bgCtx := context.WithoutCancel(ctx)
    go func() {
        // BUG: bgCtx never times out, never cancels — runs forever on slow audit sink
        if err := auditSink.Write(bgCtx, event); err != nil {
            log.Printf("audit: %v", err)
        }
    }()
}
```

<details><summary>Answer</summary>

**Bug:** `context.WithoutCancel` (context.go:580-590) returns a `withoutCancelCtx` (context.go:592) whose `Done()` returns `nil` (context.go:600-602) and whose `Err()` returns `nil` (context.go:604-606). It preserves *values* (via `value()` walking the parent chain at context.go:608-611) but strips *cancellation entirely*. The result is a context that never fires `Done`, never reports `Err`, and never times out — by design.

That's correct for "this audit write must outlive the request" — the original use case. The bug here is using it *without adding a new deadline*. The audit sink can hang forever; the goroutine leaks; if the sink is slow, every request leaks one more goroutine.

The correct pattern when you want to detach from the request *and* still have a bound is to combine: detach with `WithoutCancel`, then re-bound with `WithTimeout`:

**Why subtle:** Tests pass — audit writes complete fast in tests. Production: audit sink degrades, requests still succeed (they don't wait for audit), but the process accumulates goroutines blocked on the audit sink. Memory creeps. Eventually `goroutines` (context.go:371) shows millions; the process dies.

**Spot:** Any `context.WithoutCancel(ctx)` whose return value is used directly in I/O without further wrapping. The function is a tool for *re-rooting*; the re-rooted context still needs its own bounds.

**Fix:**

```go
func writeAuditLog(ctx context.Context, event Event) {
    detached := context.WithoutCancel(ctx)            // keep request-id values
    bgCtx, cancel := context.WithTimeout(detached, 5*time.Second)
    go func() {
        defer cancel()
        if err := auditSink.Write(bgCtx, event); err != nil {
            log.Printf("audit: %v", err)
        }
    }()
}
```

Now the goroutine is bounded by a 5-second deadline of its own, independent of the request's. Values flow through; cancellation is fresh.

**Why common:** `WithoutCancel` was added in Go 1.21 to solve "preserve values, drop cancellation"; many adopters read it as "make this run in the background" and miss that "background" should still mean "with *some* deadline". The function is a building block, not a complete solution.
</details>

---

## Summary

These bugs cluster into four families.

**Lifecycle (1, 10, 13, 14):** discarding `cancel`, calling it twice, returning ctx without its cancel, using `WithoutCancel` without re-bounding. The `(ctx, cancel)` pair from `withCancel` (context.go:273) registers the child in the parent's `cancelCtx.children` map (context.go:436); only `cancel(true, ...)` (context.go:549) removes it. Lose ownership and you leak the registration — or strip cancellation entirely and never get it back.

**Value semantics (2, 3, 11):** string keys collide, struct fields freeze one request's ctx into a long-lived object, nil ctx panics on the first method dispatch. The doc on `Context` (context.go:36-44) and on `WithValue` (context.go:715-727) writes the rules; the linter ecosystem (`go vet`, `staticcheck`, `containedctx`, `contextcheck`) enforces them at CI time. The stdlib itself uses `var cancelCtxKey int` (context.go:374) — an unexported named type — as the canonical pattern.

**Cancellation semantics (5, 6, 7, 8, 12):** busy-loop on Done, swallow `ctx.Err()`, immediate-cancel via zero/past deadline, race on custom Context implementations. `Done()` is a one-shot broadcast (closed at context.go:564-568); after close, every receive returns the zero value forever. `Err()` (context.go:463) is the only way to learn *why*. `WithDeadline` (context.go:625) and `WithTimeout` (context.go:703) short-circuit on non-positive durations — boundary inputs must be validated by the caller, not by the constructor.

**Propagation (4, 9):** substituting `Background()` or `TODO()` mid-stack throws the parent's deadline, cancellation, and values away. `emptyCtx` (context.go:181-197) returns zero from every method. Static rule: if the function already takes a `ctx context.Context`, the function does not construct a new root — it threads what it received.

Review checklist for any context-using PR:

- [ ] Does every `WithCancel`/`WithTimeout`/`WithDeadline`/`WithCancelCause` have a reachable `defer cancel()` on every return path? `go vet`'s `lostcancel` is the cheapest catcher.
- [ ] Are all `context.WithValue` keys unexported named types (e.g., `type userIDKey struct{}`), never `string` or any built-in? `go vet`'s `contextkey` flags it.
- [ ] Does any struct hold a `context.Context` field? If yes, refactor — pass ctx as the first parameter of each method instead. `containedctx` lints this.
- [ ] Does any function that *receives* a `ctx context.Context` ever create `context.Background()` or `context.TODO()` mid-body? `contextcheck` flags it; replace with the received ctx or with `context.WithoutCancel(ctx)` if the detachment is deliberate.
- [ ] Does every `<-ctx.Done()` arm of a `select` `return` (or `break` out of the surrounding loop)? An empty arm is a busy spin.
- [ ] When a `<-ctx.Done()` fires, does the error path return `ctx.Err()` (or wrap it with `%w`) so callers can `errors.Is(err, context.DeadlineExceeded)`?
- [ ] Are all `WithTimeout`/`WithDeadline` durations validated `> 0` and deadlines validated `.After(time.Now())` before the call? Boundary inputs (env vars, JSON `0`, zero `time.Time`) must be screened.
- [ ] Are `nil` contexts forbidden at every callsite? Use `context.Background()` (deliberate root) or `context.TODO()` (temporary, with a TODO comment); never `nil`.
- [ ] If a function returns a context it created, does it also return the matching `cancel`? Match the stdlib shape `(Context, CancelFunc)`.
- [ ] If `context.WithoutCancel` is used, is the detached context re-bounded with a fresh `WithTimeout` before any I/O?
- [ ] Are there any custom `Context` implementations? If yes, do they compose via embedding without overriding `Done`/`Err`, or do they atomically gate transitions under a single mutex the way `cancelCtx` does (context.go:549-583)?

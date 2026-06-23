# Decorator Pattern — Find the Bug

A collection of realistic, broken decorator snippets. Each one looks correct at a glance and has shipped to production somewhere. For each: the setup, a subtle bug planted in plausible code, the symptom, the cause traced back to a rule from `junior.md` or `middle.md`, and the fix. Read in order — by the end you should spot every shape in a review before the panic hits staging.

---

## Bug 1: Value receiver on a stateful decorator

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type CountingCharger struct {
    Inner Charger
    count int
}

func (c CountingCharger) Charge(ctx context.Context, amount int) (string, error) {
    c.count++
    return c.Inner.Charge(ctx, amount)
}

func (c CountingCharger) Count() int { return c.count }

// caller:
func main() {
    base := &StripeGateway{}
    counter := CountingCharger{Inner: base}

    var c Charger = counter
    for i := 0; i < 10; i++ {
        c.Charge(context.Background(), 100)
    }
    fmt.Println("charges:", counter.Count())
}
```

**Question.** The caller runs ten charges. What does `counter.Count()` print, and why?

<details><summary>Answer</summary>

**Bug.** Prints `0`. The receiver is a value (`c CountingCharger`), so `c.count++` mutates a *copy*, not the caller's struct. Every method call increments a fresh copy that's discarded when the method returns.

Worse: the interface assignment `var c Charger = counter` copies the struct *again* into the interface value. Even if `Count()` were a pointer-receiver method, it would read the original `counter`, not the interface's copy — so the disconnect is doubly hidden.

**Why it's there.** From `junior.md` §12 and `middle.md` §3.1: a decorator that holds mutable state needs a pointer receiver, otherwise mutations are silently lost. The compiler accepts value receivers on types with interior mutable fields; the runtime quietly discards every update.

**How to spot in review.** For any struct with a non-pointer mutable field (counter, slice, map, time, struct-by-value), check the receiver kind of every method that writes to that field. If the receiver is a value, every write is a no-op from the caller's perspective.

A useful pattern: when a decorator has *any* state to track, default to pointer receivers and pointer construction (`&CountingCharger{...}`). Stateless decorators (a logger that only calls its `*log.Logger`) can use values.

**Fix.**

```go
type CountingCharger struct {
    Inner Charger
    count int64
}

func (c *CountingCharger) Charge(ctx context.Context, amount int) (string, error) {
    atomic.AddInt64(&c.count, 1)
    return c.Inner.Charge(ctx, amount)
}

func (c *CountingCharger) Count() int64 { return atomic.LoadInt64(&c.count) }

// caller:
counter := &CountingCharger{Inner: base}
var c Charger = counter
// ... loop ...
fmt.Println("charges:", counter.Count())
```

Pointer receiver makes `count++` reach the caller's struct. `atomic.AddInt64` makes it safe under concurrency — which a decorator usually has to be, because consumers don't expect "use one charger from one goroutine only".

**Why it's common.** Junior Go developers learn that "value receivers and pointer receivers both work as long as the method set matches the interface". That's true for satisfaction. It's *not* true for state mutation. The compiler doesn't warn that a value receiver on a counter is almost certainly wrong. The fix is one character (`func (c *...)`) but the bug ships because the test asserts on the *return value* of `Charge`, not on the *side effect* of `Count`.
</details>

---

## Bug 2: Forgot to call `Inner`

```go
type Notifier interface {
    Notify(ctx context.Context, userID int, message string) error
}

type SlackNotifier struct{ webhookURL string }

func (s *SlackNotifier) Notify(ctx context.Context, userID int, message string) error {
    // POST to Slack...
    return nil
}

type AuditedNotifier struct {
    Inner Notifier
    Log   *log.Logger
}

func (a *AuditedNotifier) Notify(ctx context.Context, userID int, message string) error {
    a.Log.Printf("audit: user=%d msg=%q", userID, message)
    return nil
}

// wiring:
func main() {
    var n Notifier = &SlackNotifier{webhookURL: os.Getenv("SLACK_URL")}
    n = &AuditedNotifier{Inner: n, Log: log.Default()}

    n.Notify(context.Background(), 42, "password reset")
}
```

**Question.** Audit logs look perfect. Slack receives nothing. What did the developer forget?

<details><summary>Answer</summary>

**Bug.** `AuditedNotifier.Notify` logs the audit line and returns `nil` *without ever calling `a.Inner.Notify`*. The Slack POST never fires. The audit trail records "we sent the message" — but no message went out.

Worst-case scenario: a security incident response sees the audit log say "password reset notified" and closes the ticket. The user never received the email; they call support a day later asking why nothing arrived.

**Why it's there.** From `junior.md` §10.1: the classic decorator bug. The decorator does the *around* work (audit log) and returns success, forgetting that the *whole point* of a decorator is to delegate to `Inner`. The body of every decorator method should have at least one `a.Inner.Method(...)` call — usually with the result being returned.

**How to spot in review.** For every decorator type (struct with an `Inner Iface` field), grep the body of each method that implements the interface. If `a.Inner.MethodName(...)` doesn't appear, it's either intentional short-circuiting (rare) or a bug (common). The right reaction in code review: "where's the call to `Inner`?"

**Fix.**

```go
func (a *AuditedNotifier) Notify(ctx context.Context, userID int, message string) error {
    a.Log.Printf("audit: user=%d msg=%q", userID, message)
    return a.Inner.Notify(ctx, userID, message)
}
```

Now the audit log fires *and* the message is delivered. The caller sees the inner's error if delivery fails.

If you genuinely want to short-circuit (a "dry-run" decorator that logs without delivering), make it explicit in the type name (`DryRunNotifier`) and add a comment explaining why `Inner` is unused. Better: don't store an `Inner` you don't call — the field is a lie.

**Why it's common.** Developers write the decorator, run a unit test that asserts on the log output, see it pass, ship. The test never checks that `Inner.Notify` was called because the decorator's job, from the test author's perspective, was to *log*. The integration-level "does the message reach Slack" test catches it — eventually.
</details>

---

## Bug 3: Decorator returning `nil` error on inner failure

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type RetryingCharger struct {
    Inner    Charger
    Attempts int
    Log      *log.Logger
}

func (r *RetryingCharger) Charge(ctx context.Context, amount int) (string, error) {
    var lastErr error
    for i := 0; i < r.Attempts; i++ {
        id, err := r.Inner.Charge(ctx, amount)
        if err == nil {
            return id, nil
        }
        lastErr = err
        r.Log.Printf("attempt %d failed: %v", i+1, err)
    }
    r.Log.Printf("all attempts exhausted")
    return "", nil
}
```

**Question.** All three attempts fail with `connection refused`. The caller checks `err != nil` and proceeds. What's wrong?

<details><summary>Answer</summary>

**Bug.** The function returns `"", nil` after exhausting all retries. The caller's `if err != nil` check passes, the caller treats the empty charge ID as a successful charge, and the downstream code (which expected a valid ID) silently breaks. The error is *swallowed*.

A real symptom: order confirmation emails are sent for charges that never went through. The customer is confused; the support team has no audit trail because the retry decorator logged the attempts but the caller didn't.

**Why it's there.** From `junior.md` §11.4: the cardinal rule of a decorator is "don't change the contract". A retry decorator's job is to *retry on transient failure*, not to mask permanent failure. Returning `nil` after retries are exhausted hides the most important signal — that the operation never succeeded.

The author probably had `lastErr` in scope and intended to return it; they wrote `nil` by typo or copy-paste. The compiler doesn't complain because `nil` is a valid `error` value.

**How to spot in review.** Any decorator that returns a *literal* `nil` from a position that should propagate an inner error. Grep pattern: `return ".*", nil` and `return nil` inside the body of a decorator method. Each one should be justified — either the operation truly succeeded, or there's a short-circuit reason. If neither, it's likely the swallow.

**Fix.**

```go
func (r *RetryingCharger) Charge(ctx context.Context, amount int) (string, error) {
    var lastErr error
    for i := 0; i < r.Attempts; i++ {
        id, err := r.Inner.Charge(ctx, amount)
        if err == nil {
            return id, nil
        }
        lastErr = err
        r.Log.Printf("attempt %d failed: %v", i+1, err)
    }
    return "", fmt.Errorf("RetryingCharger: %d attempts exhausted: %w", r.Attempts, lastErr)
}
```

`%w` wraps the last error so callers using `errors.Is`/`errors.As` can still unwrap. The retry count is in the message, useful for debugging.

A test that verifies the bug: hand the decorator an `Inner` that always returns an error, call `Charge`, assert `err != nil`. The first version fails this trivially.

**Why it's common.** The retry loop's *success* path returns `nil` (because the operation succeeded). When the loop exits without success, the author reuses the same `return ..., nil` shape from the success path and forgets the error. Code that compiles, tests pass for the success case, ships, breaks on the first real failure.
</details>

---

## Bug 4: Recovery middleware that writes after the handler wrote

```go
func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic recovered: %v", rec)
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func slowHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    fmt.Fprint(w, `{"items":[`)
    for i := 0; i < 1000; i++ {
        if i == 500 {
            panic("database connection lost mid-stream")
        }
        fmt.Fprintf(w, `{"id":%d}`, i)
        if i < 999 {
            fmt.Fprint(w, ",")
        }
    }
    fmt.Fprint(w, `]}`)
}
```

**Question.** A request hits `slowHandler` wrapped by `Recovery`. Halfway through writing the response, the handler panics. What does the client see, and what shows up in the server logs?

<details><summary>Answer</summary>

**Bug.** The client sees:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"items":[{"id":0},{"id":1},...,{"id":499}internal server error
```

A truncated JSON document with `"internal server error"` appended as plain text. The 200 status was already sent. The Content-Type is `application/json`. The body is now corrupt.

Server logs show:

```
panic recovered: database connection lost mid-stream
http: superfluous response.WriteHeader call from ...
```

`http.Error` calls `w.WriteHeader(500)` and writes the body. Since `WriteHeader(200)` already ran, the second call is a no-op (with a warning) and the status stays 200. The body bytes are still appended to the response, producing the corrupt mix.

**Why it's there.** From `middle.md` §7.2: once the handler has called `WriteHeader` (explicitly or implicitly via the first `Write`), the response is *committed*. Calling `http.Error` after that point appends bytes to whatever was already sent.

The recovery middleware's "best effort" body and status make sense *only* when the handler hasn't started writing. Once writing has begun, the middleware can't undo the partial response — the bytes are already on the wire.

**How to spot in review.** Any recovery middleware that *unconditionally* calls `http.Error` or `w.WriteHeader` in the recover block. Without a "have we started writing" check, the middleware will corrupt half-written responses.

**Fix — detect via a wrapper.**

```go
type statusRecorder struct {
    http.ResponseWriter
    wroteHeader bool
}

func (s *statusRecorder) WriteHeader(code int) {
    s.wroteHeader = true
    s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
    s.wroteHeader = true
    return s.ResponseWriter.Write(b)
}

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rec := &statusRecorder{ResponseWriter: w}
        defer func() {
            if r := recover(); r != nil {
                log.Printf("panic recovered: %v", r)
                if !rec.wroteHeader {
                    http.Error(rec, "internal server error", http.StatusInternalServerError)
                } else {
                    log.Printf("response already started; cannot send 500")
                }
            }
        }()
        next.ServeHTTP(rec, r)
    })
}
```

The wrapper tracks whether the underlying writer has been touched. The recovery block only writes the 500 if the response is still pristine. As an escalation, if headers are already sent, hijacking the connection and closing it (`w.(http.Hijacker)`) is sometimes used — the client sees a network-level disconnect instead of a corrupted response. Loud but honest.

**Why it's common.** Recovery middleware is copied from blog posts. The standard examples assume the handler panics *before* writing anything — which is true for "panic in a database call" but false for "panic mid-stream". Streaming endpoints, NDJSON, server-sent events, large responses — all are vulnerable. The bug doesn't surface until the panic happens at exactly the wrong moment.
</details>

---

## Bug 5: Middleware chain built per request

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mw ...Middleware) http.Handler {
    for i := len(mw) - 1; i >= 0; i-- {
        h = mw[i](h)
    }
    return h
}

// HTTP server:
func handleAPI(w http.ResponseWriter, r *http.Request) {
    h := Chain(
        http.HandlerFunc(actualAPIHandler),
        Tracing,
        Recovery,
        Logging,
        Auth,
    )
    h.ServeHTTP(w, r)
}

func main() {
    http.HandleFunc("/api", handleAPI)
    http.ListenAndServe(":8080", nil)
}
```

**Question.** The server handles 5,000 RPS on a four-core box. The benchmark shows surprising CPU and GC pressure. Pprof points at `Chain`. What's the bug?

<details><summary>Answer</summary>

**Bug.** The chain is constructed *per request*. Every call to `handleAPI` allocates four closures (one per middleware), a slice (the variadic), and the wrapping `HandlerFunc` adapters — for every single request. At 5,000 RPS that's 20,000+ allocations per second purely for chain construction, before any real work.

Pprof shows `Chain` in the allocation hotspot, the middleware functions allocating closures, and the GC running more aggressively than it should.

The chain has no per-request state. It can be built once.

**Why it's there.** From `middle.md` §5.2: the canonical anti-idiom. The author reads "the chain is composable" and writes the composition where the request enters, because that's where their head is. The fact that the composition produces a *fixed* function is invisible until profiling.

**How to spot in review.** Look for `Chain(...)` or middleware composition (`mw1(mw2(mw3(...)))`) *inside* a function that runs per request. The chain should be built at startup and the resulting `http.Handler` stored in a variable, then referenced at request time.

**Fix.**

```go
var apiHandler http.Handler

func init() {
    apiHandler = Chain(
        http.HandlerFunc(actualAPIHandler),
        Tracing,
        Recovery,
        Logging,
        Auth,
    )
}

func handleAPI(w http.ResponseWriter, r *http.Request) {
    apiHandler.ServeHTTP(w, r)
}

// or skip the wrapper entirely:
func main() {
    apiHandler := Chain(
        http.HandlerFunc(actualAPIHandler),
        Tracing, Recovery, Logging, Auth,
    )
    http.Handle("/api", apiHandler)
    http.ListenAndServe(":8080", nil)
}
```

Chain construction happens once at startup. Each request dispatches through the pre-built chain. Allocations per request drop from a dozen to zero (assuming the inner middlewares are also allocation-free). A typical microbenchmark shows the per-request version at ~150 ns/op with ~5 allocs/op vs ~20 ns/op with 0 allocs for the prebuilt chain.

**Why it's common.** "Configuration belongs near the use site" is a reasonable instinct. The cost is invisible until benchmarks reveal it. Most middleware functions look so cheap individually that the *composition cost* is overlooked. A 5-middleware chain doing nothing at 5,000 RPS allocates more than the actual API logic does.
</details>

---

## Bug 6: Decorator capturing the loop variable (pre-1.22)

```go
//go:build go1.21
// +build go1.21

type Handler func(req string) string

func buildPipeline(steps []string) []Handler {
    handlers := make([]Handler, 0, len(steps))
    for _, step := range steps {
        handlers = append(handlers, func(req string) string {
            return fmt.Sprintf("[%s] %s", step, req)
        })
    }
    return handlers
}

func main() {
    pipeline := buildPipeline([]string{"auth", "ratelimit", "logging"})
    for _, h := range pipeline {
        fmt.Println(h("request"))
    }
}
```

**Question.** A team on Go 1.21 builds a middleware pipeline this way. What does it print? Why does upgrading to Go 1.22 "fix" the bug?

<details><summary>Answer</summary>

**Bug.** On Go 1.21 and earlier:

```
[logging] request
[logging] request
[logging] request
```

Each closure captures the *variable* `step`, not its value at construction time. The `for` loop reuses one variable across iterations; by the time the closures run, `step` holds the last value (`"logging"`).

On Go 1.22+, each iteration of a `for ... range` loop gets a *fresh* variable. Each closure captures a different `step`. Output becomes:

```
[auth] request
[ratelimit] request
[logging] request
```

**Why it's there.** From `junior.md` §11.3: a Go gotcha old enough to have its own folklore. The fact that Go 1.22 changed the semantics means code that ran "fine" on a newer version may break on an older one, or vice versa. Decorator chains are especially vulnerable because the bug is invisible until the wrappers are invoked.

**How to spot in review.** Any closure built inside a `for ... range` loop that references the loop variable. Until the project's `go.mod` declares `go 1.22` or later, the per-iteration semantics aren't in effect. Even after, a colleague's older toolchain or a CI runner on an older image will produce different behaviour.

The fix works on all versions and costs nothing — adopt it unconditionally.

**Fix.**

```go
for _, step := range steps {
    step := step // shadow with a per-iteration local
    handlers = append(handlers, func(req string) string {
        return fmt.Sprintf("[%s] %s", step, req)
    })
}
```

Or take the argument explicitly via a constructor function:

```go
for _, step := range steps {
    handlers = append(handlers, makeHandler(step))
}

func makeHandler(step string) Handler {
    return func(req string) string {
        return fmt.Sprintf("[%s] %s", step, req)
    }
}
```

Both versions are robust against Go-version differences, race tools, and reviewers.

**Why it's common.** The pattern of "build N decorators from a config slice" is endemic — feature flags, route lists, plugin chains. The closure capture is invisible at the source level. The test that exercises *only the last* handler in the slice passes; the test that loops through all of them is the one that catches the bug.
</details>

---

## Bug 7: Auth inside RateLimit — DOS amplifier

```go
func Auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if !validateJWT(token) { // expensive: parses, verifies signature
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func RateLimit(next http.Handler) http.Handler {
    limiter := rate.NewLimiter(rate.Limit(100), 200)
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !limiter.Allow() {
            http.Error(w, "too many requests", 429)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func main() {
    h := http.HandlerFunc(handleAPI)
    var handler http.Handler = h
    handler = RateLimit(handler)
    handler = Auth(handler)

    http.Handle("/api", handler)
    http.ListenAndServe(":8080", nil)
}
```

**Question.** An attacker sends 50,000 requests per second with random garbage tokens. The server CPU pegs at 100%. The auth code is using all of it. What's the structural bug, even though both middlewares "work" individually?

<details><summary>Answer</summary>

**Bug.** The wrapping order is `Auth(RateLimit(handler))`. Reading outside-in: `Auth` runs *first*, then `RateLimit`. The attacker's garbage tokens make Auth do *expensive JWT parsing and signature validation* on every request, *before* rate-limit ever gets to reject them. RateLimit is now defending nothing — it's behind the expensive thing.

A single CPU core can validate maybe 50,000 JWTs per second if cryptographic operations are tuned, fewer if not. The attacker can pin every core just by sending unsigned junk that Auth has to parse and reject. The intended rate-limit of 100 RPS never engages because the request never reaches it — Auth rejects with 401 long before.

**Why it's there.** From `middle.md` §6.3: rate-limit goes *outside* auth. The general rule for any expensive verification step: the cheap rejection (rate-limit on IP/API-key prefix) must come *before* the expensive validation. Otherwise the rate limit isn't protecting anything; it's protecting *behind* the expense.

**How to spot in review.** Any chain where `Auth` or any other CPU-heavy validation wraps `RateLimit`. Read the chain outside-in: the outermost middleware runs first. The cheapest reject should run first.

**Fix.**

```go
func main() {
    h := http.HandlerFunc(handleAPI)
    var handler http.Handler = h
    handler = Auth(handler)       // inside
    handler = RateLimit(handler)  // outside — runs first

    http.Handle("/api", handler)
    http.ListenAndServe(":8080", nil)
}
```

Now an attacker's 50,000 RPS is rejected by `RateLimit` (200 burst, 100/s sustained) before Auth ever sees the token. Total CPU cost per rejected request: a single atomic compare-and-swap inside `rate.Limiter`. Two orders of magnitude cheaper than JWT validation.

For a production server, the rate limit key should be the *source* of the traffic (IP, ASN, API-key prefix) rather than global, so one attacker doesn't trip the limit for everyone — see Bug 15 for the per-key variant.

**Why it's common.** The intuition "auth first, then rate-limit authorised users" *sounds* right — you want to rate-limit per user, not per IP. The catch: you can't safely identify a user until you've validated their token, but validating the token is the expensive thing. The correct shape is two-stage: a *cheap* outer rate limit by IP that protects against bulk abuse, then auth, then an inner rate limit by user. Most teams ship the inner one and call it a day.
</details>

---

## Bug 8: Timeout decorator using `context.Background()`

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type TimeoutCharger struct {
    Inner   Charger
    Timeout time.Duration
}

func (t *TimeoutCharger) Charge(ctx context.Context, amount int) (string, error) {
    ctx, cancel := context.WithTimeout(context.Background(), t.Timeout)
    defer cancel()
    return t.Inner.Charge(ctx, amount)
}

// caller:
func handlePayment(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // bound to the HTTP request lifetime
    c := &TimeoutCharger{Inner: &StripeGateway{}, Timeout: 30 * time.Second}
    id, err := c.Charge(ctx, 1000)
    // ...
}
```

**Question.** A user clicks "cancel" on the payment form mid-request, closing the connection. The HTTP request's context is cancelled. What does the Stripe call do, and what's the bug?

<details><summary>Answer</summary>

**Bug.** The Stripe call keeps running for the full 30 seconds. The user's cancellation is *lost* the moment `TimeoutCharger.Charge` constructs a new context from `context.Background()` instead of from the caller's `ctx`. The parent's deadline, request scope, trace IDs, and cancellation channel are all discarded.

Symptoms in production: clicking "cancel" doesn't actually cancel; the upstream API still receives the charge; the user might be charged for a payment they tried to abort. Worse, distributed tracing breaks — the Stripe call has no parent span because the trace context that was on `r.Context()` is gone.

**Why it's there.** From `middle.md` §11.3: deriving a context with `context.WithTimeout(context.Background(), ...)` instead of `context.WithTimeout(ctx, ...)` *severs* the parent. The caller's cancellation, deadline, and values all vanish. The new context only knows about the local timeout.

The author probably wrote `context.Background()` because they wanted "a fresh context with just this timeout". That's exactly the wrong instinct — a decorator should *extend* the caller's context, not replace it.

**How to spot in review.** Any `context.WithTimeout(context.Background(), ...)` or `context.WithCancel(context.Background())` *inside* a function that already has a `ctx context.Context` parameter. The parameter exists to be used; ignoring it is the bug. Same for `context.WithDeadline(context.TODO(), ...)`.

**Fix.**

```go
func (t *TimeoutCharger) Charge(ctx context.Context, amount int) (string, error) {
    ctx, cancel := context.WithTimeout(ctx, t.Timeout)
    defer cancel()
    return t.Inner.Charge(ctx, amount)
}
```

One word: replace `context.Background()` with `ctx`. Now the derived context inherits the parent's deadline (taking the minimum), cancellation, and values. When the user cancels, the Stripe call sees the cancellation. When the HTTP request times out (say at 60 seconds), the Stripe call sees that too — even if `t.Timeout` is longer.

If the decorator genuinely needs to *outlive* the caller's context (rare, but exists — fire-and-forget background work), the fix is `context.WithoutCancel(ctx)` (Go 1.21+) which preserves values while detaching from the parent's cancellation. But it should be a *conscious* choice, documented in code, not a side effect of using `Background()` without thinking.

**Why it's common.** Newer Go developers learn `context.Background()` as "the empty context" and `context.WithTimeout` as "the way to add a timeout". Combining them feels natural. The fact that `WithTimeout(ctx, d)` *should* derive from the existing `ctx` requires understanding that contexts form a tree, and decorators are tree-extension points. A linter (like `contextcheck`) can catch this — most teams don't run one.
</details>

---

## Bug 9: Embedded decorator promoting unwanted methods

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
    Refund(ctx context.Context, chargeID string) error
    Capture(ctx context.Context, authID string, amount int) error
}

type LoggingCharger struct {
    Charger // embed the interface
    Log *log.Logger
}

func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: amount=%d", amount)
    id, err := l.Charger.Charge(ctx, amount)
    if err != nil { l.Log.Printf("Charge failed: %v", err) }
    return id, err
}

// caller wires up:
func main() {
    var c Charger = &LoggingCharger{
        Charger: &StripeGateway{},
        Log:     log.Default(),
    }

    c.Charge(ctx, 100)                  // logged: "Charge: amount=100"
    c.Refund(ctx, "ch_xyz")             // NOT logged
    c.Capture(ctx, "auth_abc", 100)     // NOT logged

    // a year later, the Charger interface gains a method:
    // RecurringCharge(ctx, plan, amount) (string, error)
    // Stripe implements it. LoggingCharger inherits it for free.
    // Nobody updates the logging code.
}
```

**Question.** The team adds `Refund` and `Capture` to the system. Logs look fine for `Charge` but suspiciously empty for refunds and captures. Then `RecurringCharge` is added. What's the structural bug?

<details><summary>Answer</summary>

**Bug.** Embedding the `Charger` interface promotes all its methods onto `LoggingCharger`. The override of `Charge` is logged; `Refund`, `Capture`, and any future methods are silently delegated *without* logging. The compiler doesn't warn — the embedded interface satisfies the outer interface, and the wrapper looks complete.

The longer the interface, and the more methods the team adds over time, the bigger the gap between "what gets logged" and "what runs". A year in, the audit log has `Charge` events for 100% of charges but zero coverage of refunds. A regulator asks "show me all refunds processed last month" and the answer is "the logs don't have any — we have to go to Stripe directly".

**Why it's there.** From `middle.md` §9: embedding is a *delegation default*. Whatever you don't override is inherited verbatim. This is the *intentional* design — you don't want to write five identical pass-through methods. The bug is when you *thought* you were decorating the whole interface and only decorated part of it.

The trap deepens when the interface evolves. Adding `RecurringCharge` to `Charger` adds it to `*StripeGateway` (with a real implementation) and *automatically* to `*LoggingCharger` (without logging). The compiler accepts the change. The audit trail silently loses a class of events.

**How to spot in review.** Two heuristics:

1. Any decorator type that embeds an interface should have an override for *every* method on that interface, or a comment explaining which methods are intentionally pass-through.
2. When an interface gains a new method, every embedding-based decorator is a candidate audit site. Grep for `type X struct { Iface; ... }` whenever you change `Iface`.

A stricter alternative: don't embed. Hold the inner explicitly as a named field, and write every forwarding method by hand. Verbose, but the compiler catches you forgetting a method *if the wrapper itself doesn't satisfy the interface* — which is the safety net.

**Fix — explicit forwarding.**

```go
type LoggingCharger struct {
    Inner Charger
    Log   *log.Logger
}

func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: amount=%d", amount)
    id, err := l.Inner.Charge(ctx, amount)
    if err != nil { l.Log.Printf("Charge failed: %v", err) }
    return id, err
}

func (l *LoggingCharger) Refund(ctx context.Context, chargeID string) error {
    l.Log.Printf("Refund: chargeID=%s", chargeID)
    err := l.Inner.Refund(ctx, chargeID)
    if err != nil { l.Log.Printf("Refund failed: %v", err) }
    return err
}

func (l *LoggingCharger) Capture(ctx context.Context, authID string, amount int) error {
    l.Log.Printf("Capture: authID=%s amount=%d", authID, amount)
    err := l.Inner.Capture(ctx, authID, amount)
    if err != nil { l.Log.Printf("Capture failed: %v", err) }
    return err
}
```

Every method on the interface gets a logging shim. When `RecurringCharge` is added, `*LoggingCharger` no longer satisfies `Charger` — *compile error*, which is exactly the loud failure you want.

For very wide interfaces (`database/sql.DB` style), a code generator produces the boilerplate; CI fails if you forget to regenerate after an interface change.

**Why it's common.** Embedding is *celebrated* in Go tutorials as a way to compose types without ceremony. The "easy" case (a `LoggingCharger` that embeds a `Charger` and overrides one method) hides the danger — the wrapper *looks* complete because the type satisfies the interface, but the *behaviour* is incomplete. The cost is realised only when an audit asks for the missing decoration.
</details>

---

## Bug 10: Goroutine spawned in middleware without recovery

```go
func AuditLogging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // capture request details for async audit logging
        audit := captureRequest(r)

        go func() {
            // send audit event to Kafka — fire and forget
            client := kafkaClient()
            client.Send("audit-events", audit) // might panic on connection loss
        }()

        next.ServeHTTP(w, r)
    })
}

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func main() {
    h := http.HandlerFunc(actualAPIHandler)
    var handler http.Handler = h
    handler = AuditLogging(handler)
    handler = Recovery(handler)

    http.ListenAndServe(":8080", handler)
}
```

**Question.** Kafka becomes unreachable at 3am. The next audit event panics. The process dies. Recovery middleware was in the chain. Why didn't it help?

<details><summary>Answer</summary>

**Bug.** `recover()` only catches panics in the *current* goroutine. The `go func() { ... }()` inside `AuditLogging` spawns a *new* goroutine, with its own stack and its own panic-handling. The `Recovery` middleware's `defer/recover` is on the request goroutine, not the spawned one.

When the spawned goroutine panics, the Go runtime sees no `recover()` in its stack, prints the panic with a stack trace, and *terminates the entire process*. Every in-flight request dies. The HTTP server restarts (if you're lucky and have a supervisor). Users see connection resets. The on-call engineer wakes up.

The line `client.Send("audit-events", audit)` panics on connection loss because the Kafka client wasn't written to be resilient to network errors. The panic is the visible cause; the *structural* cause is that no middleware can protect a goroutine the middleware itself spawned without that goroutine having its own recovery.

**Why it's there.** From `middle.md` §7.1: `recover()` is per-goroutine. A panic in a spawned goroutine that isn't caught *within that goroutine* is fatal. Decorators that spawn goroutines for fire-and-forget work — audit logging, metrics flushing, cache warming, async I/O — must each include their own recovery.

**How to spot in review.** Grep every middleware and every decorator body for `go func()` and `go someFunc(...)`. Every spawned goroutine should either:

1. Have its own `defer/recover` block, *or*
2. Be joined back to the caller before the caller returns (so the caller's recovery catches it).

If neither, a panic in the goroutine kills the process — a single bug in a "fire and forget" path becomes a denial-of-service vulnerability.

**Fix — defensive recovery in every spawned goroutine.**

```go
func AuditLogging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        audit := captureRequest(r)

        go func() {
            defer func() {
                if rec := recover(); rec != nil {
                    log.Printf("audit logging panic: %v\n%s", rec, debug.Stack())
                }
            }()
            client := kafkaClient()
            client.Send("audit-events", audit)
        }()

        next.ServeHTTP(w, r)
    })
}
```

Every spawned goroutine starts with `defer { if rec := recover(); rec != nil { log(...) } }`. The panic is logged but the process survives. A reusable `safeGo(fn func())` helper that wraps the recover-and-launch is the typical way to make this hard to forget — code reviews can require "any `go` statement uses `safeGo` or has an inline `defer/recover`".

**Why it's common.** "Fire-and-forget" goroutines feel like ordinary function calls. The developer writes `go client.Send(...)` and doesn't think about who catches the panic — there's no `await` or `join` to bring the panic back. The first production panic in a fire-and-forget path is the lesson: every goroutine is a fresh stack, and `recover` doesn't cross stacks.
</details>

---

## Bug 11: Cached repository decorator with unbounded growth

```go
type Repo interface {
    Get(ctx context.Context, id int) (User, error)
}

type DBRepo struct{ db *sql.DB }

func (r *DBRepo) Get(ctx context.Context, id int) (User, error) {
    var u User
    err := r.db.QueryRowContext(ctx, "SELECT id, name FROM users WHERE id=$1", id).
        Scan(&u.ID, &u.Name)
    return u, err
}

type CachedRepo struct {
    Inner Repo

    mu      sync.Mutex
    entries map[int]User
}

func NewCachedRepo(inner Repo) *CachedRepo {
    return &CachedRepo{
        Inner:   inner,
        entries: make(map[int]User),
    }
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    c.mu.Lock()
    if u, ok := c.entries[id]; ok {
        c.mu.Unlock()
        return u, nil
    }
    c.mu.Unlock()

    u, err := c.Inner.Get(ctx, id)
    if err != nil {
        return User{}, err
    }

    c.mu.Lock()
    c.entries[id] = u
    c.mu.Unlock()
    return u, nil
}
```

**Question.** The application runs fine for two months. Then `oom_killed` shows up in the process logs. Memory was at 18GB. The user table has 800,000 rows. What happened?

<details><summary>Answer</summary>

**Bug.** The cache has no size limit and no TTL. Every unique user ID that's ever been requested is held in the map *forever*. Over two months of normal traffic, the cache grew to include essentially every active user, plus one-time-only IDs, plus IDs that no longer exist in the database. The map has no eviction; the process's memory grows monotonically until the OOM killer takes it.

Each cache entry is small, but the bug isn't only "fits all users" — it's "everything ever queried is kept". Bot scans for `id=1` to `id=1000000` create a million entries even for users that don't exist. If `User` contains larger fields (profile JSON, avatars, audit history), the memory cost balloons. The application *appears* to work and gets quietly faster (more cache hits) — then dies.

**Why it's there.** From `junior.md` §8: the textbook cached-repository decorator with a TTL was shown for a reason. *This* version has no TTL and no max size. The cache is a *leak*.

The author probably wrote "I'll add eviction later" and shipped. Or they assumed the user table was small enough that caching all of it was fine — and didn't account for the cache growing during bot scans, integration tests, and other non-organic traffic.

**How to spot in review.** Every cache decorator should answer two questions:

1. How does an entry get evicted? (TTL, LRU, size cap, manual invalidation)
2. What's the maximum memory the cache can consume?

If either answer is "it doesn't" or "unbounded", the cache is a leak. The right way to think about a cache: it's a *bounded* approximation of the underlying store. Unbounded means it's not a cache, it's a parallel store with no expiry policy.

**Fix — bounded LRU.** A fixed-size cache that evicts the least-recently-used entry when full:

```go
import "github.com/hashicorp/golang-lru/v2"

type CachedRepo struct {
    Inner Repo
    cache *lru.Cache[int, User]
}

func NewCachedRepo(inner Repo, size int) *CachedRepo {
    cache, _ := lru.New[int, User](size)
    return &CachedRepo{Inner: inner, cache: cache}
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    if u, ok := c.cache.Get(id); ok { return u, nil }
    u, err := c.Inner.Get(ctx, id)
    if err == nil { c.cache.Add(id, u) }
    return u, err
}
```

The cache has a hard cap. Memory is bounded by `size * sizeof(User)`. Alternatively, a TTL-based design stores `{user, expires time.Time}` per entry and runs a background goroutine sweeping the map every TTL/2 — but the LRU is simpler and has predictable memory bounds.

**Why it's common.** A "simple" cache decorator is one of the first decorators people write — it's intuitive, it speeds things up immediately. The eviction policy is "we'll add it later". Two months later, the OOM is "later". A cache without eviction is the most common memory leak in Go services.
</details>

---

## Bug 12: Circuit breaker race condition — torn read of state

```go
type BreakerState int

const (
    StateClosed BreakerState = iota
    StateOpen
    StateHalfOpen
)

type CircuitBreaker struct {
    Inner    Charger
    state    BreakerState
    failures int
    opened   time.Time
}

func (b *CircuitBreaker) Charge(ctx context.Context, amount int) (string, error) {
    if b.state == StateOpen {
        if time.Since(b.opened) > 10*time.Second {
            b.state = StateHalfOpen
        } else {
            return "", errors.New("circuit open")
        }
    }

    id, err := b.Inner.Charge(ctx, amount)
    if err != nil {
        b.failures++
        if b.failures >= 5 {
            b.state = StateOpen
            b.opened = time.Now()
        }
        return "", err
    }

    if b.state == StateHalfOpen {
        b.state = StateClosed
    }
    b.failures = 0
    return id, nil
}
```

**Question.** The decorator is shared between many goroutines (typical HTTP server). Concurrent failures spike. `go test -race` flags the type. Apart from the obvious race, what specific *visible* bug appears?

<details><summary>Answer</summary>

**Bug.** Multiple problems, all flagged by `-race`:

1. **Lost failures.** Two goroutines read `b.failures` (say `4`), both observe `err != nil`, both write `b.failures = 5`. The breaker *should* have tripped at 5 — but the second goroutine's increment was lost (it read `4`, not `5`), so `failures` is now `5` instead of the true `6`.

2. **Torn read of state.** The *combination* of `state`, `opened`, and `failures` is read without synchronisation. One goroutine sees `state == StateOpen` and reads a stale `opened` from before the most recent transition — flipping to half-open seconds early, or seeing zero `opened` because the writer hadn't reached that assignment yet.

3. **Double probe.** Two goroutines simultaneously decide "I'll be the half-open probe" — both read `time.Since(b.opened) > 10*time.Second`, both transition, both forward to `Inner`. The breaker leaks two probes instead of one, which can keep an already-overloaded upstream pinned open.

**Why it's there.** From `middle.md` §8.2: the canonical circuit breaker example explicitly takes a mutex. The author here dropped it. The result is correctness loss, not just performance.

**How to spot in review.** Any struct with multiple mutable fields read and written across goroutines. The simplest detection: run `go test -race` on a test that exercises the decorator from multiple goroutines. The race detector flags every unsynchronised read/write. Without a race test, the bug is invisible until production hits the right interleaving.

**Fix — mutex around all transitions.**

```go
type CircuitBreaker struct {
    Inner Charger

    mu       sync.Mutex
    state    BreakerState
    failures int
    opened   time.Time
}

func (b *CircuitBreaker) Charge(ctx context.Context, amount int) (string, error) {
    if !b.allow() {
        return "", errors.New("circuit open")
    }
    id, err := b.Inner.Charge(ctx, amount)
    b.record(err)
    if err != nil {
        return "", err
    }
    return id, nil
}

func (b *CircuitBreaker) allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    switch b.state {
    case StateOpen:
        if time.Since(b.opened) > 10*time.Second {
            b.state = StateHalfOpen
            return true
        }
        return false
    default:
        return true
    }
}

func (b *CircuitBreaker) record(err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.failures++
        if b.failures >= 5 {
            b.state = StateOpen
            b.opened = time.Now()
        }
        return
    }
    if b.state == StateHalfOpen {
        b.state = StateClosed
    }
    b.failures = 0
}
```

The mutex is held only during the *transition logic*, not during the inner `Charge` call (which could take seconds). State is consistent, transitions are atomic, the inner call runs without blocking other goroutines. For production, prefer a battle-tested library (`sony/gobreaker`) over rolling your own.

**Why it's common.** Circuit breakers feel like they belong in lock-free territory because they're high-traffic. The lock-free design *exists* but is hard to get right, and the gain over a tiny mutex is invisible. The right answer is "use a mutex unless you can prove the lock-free version is correct and faster".
</details>

---

## Bug 13: Decorator that swaps `Inner` mid-call

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type SwappableCharger struct {
    inner Charger
}

func (s *SwappableCharger) Inner() Charger { return s.inner }
func (s *SwappableCharger) Set(c Charger)  { s.inner = c }

func (s *SwappableCharger) Charge(ctx context.Context, amount int) (string, error) {
    log.Printf("Charge: amount=%d via %T", amount, s.inner)
    id, err := s.inner.Charge(ctx, amount)
    log.Printf("Charge done: id=%s err=%v", id, err)
    return id, err
}

// background goroutine reloads config:
func reloadConfig(s *SwappableCharger, ch <-chan Charger) {
    for c := range ch {
        s.Set(c)
    }
}

func main() {
    s := &SwappableCharger{inner: &StripeGateway{apiKey: "old"}}
    updates := make(chan Charger, 1)
    go reloadConfig(s, updates)

    go func() {
        time.Sleep(50 * time.Millisecond)
        updates <- &PayPalGateway{token: "new"}
    }()

    // hot loop charging customers:
    for i := 0; i < 10000; i++ {
        s.Charge(context.Background(), 100)
    }
}
```

**Question.** The hot loop fires while the config-reload swaps the inner gateway. `go test -race` complains. Worse, in one run a charge is logged as `via *StripeGateway` but the `id` returned matches PayPal's format. What happened?

<details><summary>Answer</summary>

**Bug.** Two intertwined problems:

1. **Data race.** `s.inner` is read by `Charge` and written by `Set` from another goroutine without synchronisation. `-race` flags it. On some hardware, a torn interface read produces a half-old, half-new value — calling a method on the result either panics, crashes, or dispatches to a different concrete method than expected.

2. **Logical incoherence.** Even if you assumed an interface assignment is atomic on the underlying platform: the *log line* reads `s.inner` once (to print `%T`), then the *actual charge* reads `s.inner` again (to call `.Charge`). Between the two reads, the config reload swapped the gateway. The log says "via Stripe", the charge runs through PayPal.

Customer support gets a ticket: "I see Stripe in your logs but I was billed by PayPal." There's no clean trail for who charged what.

**Why it's there.** From `middle.md` §8: stateful decorators with swappable internals need to *snapshot the strategy* at the top of the operation, not re-read it inside. The pattern of "Set + read elsewhere" is the data-race shape; the pattern of "read twice in one call" is the logical-incoherence shape. Both surface here.

**How to spot in review.** Any field on a decorator that's written from one path and read from another, *and* the field is the interface being decorated. The decorator's job is to wrap a *stable* `Inner`; making the `Inner` itself mutable is unusual and almost always wrong.

If a system needs hot-swappable providers, the swap should happen at a level *above* the decorator — replace the whole `Charger` chain atomically (via an `atomic.Pointer[Charger]`), not the field inside a wrapper.

**Fix — snapshot at the top of `Charge`.**

```go
type SwappableCharger struct {
    mu    sync.RWMutex
    inner Charger
}

func (s *SwappableCharger) Set(c Charger) {
    s.mu.Lock()
    s.inner = c
    s.mu.Unlock()
}

func (s *SwappableCharger) Charge(ctx context.Context, amount int) (string, error) {
    s.mu.RLock()
    inner := s.inner
    s.mu.RUnlock()

    log.Printf("Charge: amount=%d via %T", amount, inner)
    id, err := inner.Charge(ctx, amount)
    log.Printf("Charge done: id=%s err=%v", id, err)
    return id, err
}
```

Now `inner` is a local variable for the duration of `Charge`. The log line and the charge use the same value. A subsequent `Set` only affects the *next* call. For read-heavy workloads, `atomic.Pointer[Charger]` is a lock-free alternative.

Better yet, don't make `Inner` swappable at the decorator level. Build a new decorator chain when config changes and swap the *chain* atomically (`atomic.Pointer[Charger]` at the top of the system). Each decorator stays immutable; only the head pointer moves.

**Why it's common.** Hot-swap is a desirable feature ("update credentials without restart"). The natural implementation — "the wrapper holds a mutable field" — turns the decorator into a coordination point that needs synchronisation. Most teams either omit the sync (race) or sync once but read twice (incoherence). The cleanest fix is to swap higher in the stack.
</details>

---

## Bug 14: Recursive decorator — infinite loop

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type RetryingCharger struct {
    Inner    Charger
    Attempts int
}

func (r *RetryingCharger) Charge(ctx context.Context, amount int) (string, error) {
    if amount > 1000 {
        // for large amounts, split into chunks of 1000 and recurse
        var lastID string
        remaining := amount
        for remaining > 0 {
            chunk := 1000
            if remaining < chunk { chunk = remaining }
            id, err := r.Charge(ctx, chunk)
            if err != nil { return "", err }
            lastID = id
            remaining -= chunk
        }
        return lastID, nil
    }

    var lastErr error
    for i := 0; i < r.Attempts; i++ {
        id, err := r.Inner.Charge(ctx, amount)
        if err == nil { return id, nil }
        lastErr = err
    }
    return "", lastErr
}
```

**Question.** A caller charges `2500`. What happens? Now what if the caller charges `999`?

<details><summary>Answer</summary>

****Bug — for `2500` and `999`.** The original condition (`> 1000`) happens to terminate: the recursive `r.Charge(ctx, 1000)` call has `amount == 1000`, the condition is false, the retry loop runs against `Inner`. Correct, but fragile.

Change the condition to `>= 1000` and the same call (`r.Charge(ctx, 1000)`) enters the branch, splits into `chunk = 1000`, calls `r.Charge(ctx, 1000)` again with the same amount. The condition is true again. Infinite recursion → stack overflow → panic.

Even with `> 1000`, anyone who edits the chunking logic and changes `1000` to a variable that doesn't shrink triggers infinite recursion. The deeper bug: the decorator method calls *itself*, treating the wrapper as if it were the inner. The recursive call should be `r.Inner.Charge(...)`, not `r.Charge(...)`. As written, each chunk also re-runs the retry-and-chunk logic — three retries per chunk × N chunks. A $50,000 charge in $1,000 chunks could trigger 150 inner calls in the worst case.

**Why it's there.** From `junior.md` §10.1: "always call `Inner`". The author wanted to split the charge into chunks and apply the *same retry policy* to each chunk. They wrote `r.Charge(...)` because that's the method that has the retry logic. The right move is to call `r.Inner.Charge(...)` and apply the retry logic *inside* the loop:

**Fix — call `Inner`, not self.**

```go
func (r *RetryingCharger) Charge(ctx context.Context, amount int) (string, error) {
    if amount > 1000 {
        var lastID string
        remaining := amount
        for remaining > 0 {
            chunk := 1000
            if remaining < chunk { chunk = remaining }
            id, err := r.chargeOne(ctx, chunk) // helper does retry on Inner
            if err != nil { return "", err }
            lastID = id
            remaining -= chunk
        }
        return lastID, nil
    }
    return r.chargeOne(ctx, amount)
}

func (r *RetryingCharger) chargeOne(ctx context.Context, amount int) (string, error) {
    var lastErr error
    for i := 0; i < r.Attempts; i++ {
        id, err := r.Inner.Charge(ctx, amount)
        if err == nil { return id, nil }
        lastErr = err
    }
    return "", lastErr
}
```

The retry logic is in `chargeOne`, called once per chunk. No recursion. No risk of stack overflow.

Better still: split chunking and retry into *separate decorators* (`ChunkingCharger` and `RetryingCharger`), each calling `Inner.Charge`. Compose them: `ChunkingCharger{Inner: RetryingCharger{Inner: base}}`. Each decorator has one job; no method ever calls itself.

**Why it's common.** Decorators are tempting to compose "in place" — "let me add chunking to the retry decorator, they're related". The result is a decorator that's harder to test, harder to reuse (you can't get chunking without retry), and *more vulnerable to recursive bugs*. The fix is the Single-Responsibility Principle for decorators: one concern per type.
</details>

---

## Bug 15: Per-key rate limiter with map race + lost limiter

```go
type Charger interface {
    Charge(ctx context.Context, userID string, amount int) (string, error)
}

type PerUserRateLimit struct {
    Inner    Charger
    rps      rate.Limit
    burst    int
    limiters map[string]*rate.Limiter
}

func NewPerUserRateLimit(inner Charger, rps int, burst int) *PerUserRateLimit {
    return &PerUserRateLimit{
        Inner:    inner,
        rps:      rate.Limit(rps),
        burst:    burst,
        limiters: make(map[string]*rate.Limiter),
    }
}

func (p *PerUserRateLimit) Charge(ctx context.Context, userID string, amount int) (string, error) {
    lim, ok := p.limiters[userID]
    if !ok {
        lim = rate.NewLimiter(p.rps, p.burst)
        p.limiters[userID] = lim
    }
    if err := lim.Wait(ctx); err != nil {
        return "", err
    }
    return p.Inner.Charge(ctx, userID, amount)
}
```

**Question.** This wrapper protects an HTTP handler. Under load, `-race` complains and occasionally a user's burst budget seems to "reset" mid-conversation. What are the two distinct bugs?

<details><summary>Answer</summary>

**Bug 1 — map race.** `p.limiters` is read and written without synchronisation. Two goroutines servicing the same userID may both hit `!ok` simultaneously, both construct a new limiter, both write to the map. Go's runtime detects concurrent map read+write and aborts the process with `fatal error: concurrent map read and map write`.

Even when both goroutines write *the same* userID, the writes themselves race in the map's internal data structures. The map may corrupt, hang, or panic.

**Bug 2 — lost limiter.** Even if the map were safe, two goroutines that both miss for the *same* userID each construct *a different* limiter. One write wins; the other limiter is leaked. From now on, requests for that userID hit whichever limiter won. *That's still mostly fine* — but if request #1 acquired tokens against limiter A (which is then orphaned), and request #2 (and onward) goes through limiter B (which still has full budget), the user effectively gets *two bursts* of capacity. Their "burst of 10" is now "burst of 10 + however many got through limiter A before it was orphaned".

The visible effect: under load, a user that should be rate-limited briefly isn't. Burst budgets *appear* to reset.

**Why it's there.** From `middle.md` §8.3: per-key state in a decorator needs both *synchronisation* (the map is concurrent) and *atomic create-or-fetch* (no double-creation). The plain map doesn't give either. The `sync.Map` API or `sync.Mutex` + `LoadOrStore`-style pattern fixes both at once.

**How to spot in review.** Any decorator with a `map[K]V` field where:

- Reads and writes happen on the request path (not init).
- The map's key is derived from request input (per-user, per-route, per-tenant).

If the field has no surrounding mutex and isn't a `sync.Map`, the decorator races. If the create-on-miss path doesn't use `LoadOrStore` semantics, it can lose limiters.

**Fix — `sync.Map` with `LoadOrStore`.**

```go
type PerUserRateLimit struct {
    Inner    Charger
    rps      rate.Limit
    burst    int
    limiters sync.Map // map[string]*rate.Limiter
}

func (p *PerUserRateLimit) limiterFor(userID string) *rate.Limiter {
    if v, ok := p.limiters.Load(userID); ok {
        return v.(*rate.Limiter)
    }
    newLim := rate.NewLimiter(p.rps, p.burst)
    actual, _ := p.limiters.LoadOrStore(userID, newLim)
    return actual.(*rate.Limiter)
}

func (p *PerUserRateLimit) Charge(ctx context.Context, userID string, amount int) (string, error) {
    lim := p.limiterFor(userID)
    if err := lim.Wait(ctx); err != nil {
        return "", err
    }
    return p.Inner.Charge(ctx, userID, amount)
}
```

`LoadOrStore` is atomic: if two goroutines both miss, both call `LoadOrStore` with their own new limiter, but the *first* one wins — `LoadOrStore` returns the existing entry on the loser's call. The loser's limiter is garbage-collected; both goroutines proceed with the same shared limiter.

A plain map with `sync.Mutex` works too — hold the mutex during the check-then-create sequence. For read-mostly traffic, `sync.RWMutex` with a double-check pattern (RLock, miss, Lock, re-check, create) is slightly faster.

**Bonus problem: unbounded growth.** Like Bug 11's cache, this map grows forever — a limiter per user ID ever seen. For long-lived servers with many users, that's a memory leak. Production rate limiters periodically sweep stale limiters (last-used timestamp + TTL), use a bounded LRU, or push the limit out to Redis with TTL. The basic fix above gets the concurrency right; the eviction is a separate concern.

**Why it's common.** Per-user (or per-key) state is a natural extension of a global rate limiter. The "easy" implementation uses a plain map. The race is invisible until two requests arrive for the same user at the same time *and* hit the create-on-miss path. On dev laptops with single-user testing, this never happens. In production with concurrent users, it happens within minutes.
</details>

---

## Closing thoughts

Every bug above traces back to one of three shapes:

1. **State mismanagement** — value receivers (Bug 1), shared mutable fields (Bugs 12, 13, 15), unbounded growth (Bug 11), goroutine state (Bug 10).
2. **Contract violations** — forgetting `Inner` (Bug 2), swallowing errors (Bug 3), promoting unwanted methods (Bug 9), recursive self-calls (Bug 14).
3. **Composition mistakes** — wrong wrapper order (Bug 7), per-request construction (Bug 5), context discarded (Bug 8), writing after the handler (Bug 4), loop variable capture (Bug 6).

When reviewing a decorator, ask:

- **Receiver?** If the decorator has state, pointer receiver. Always.
- **Inner called?** Grep the method body. Every public method should reference `Inner` unless it's an explicit short-circuit.
- **Error propagated?** Return the inner's error unchanged unless the decorator's *purpose* is to transform errors.
- **Context preserved?** Any `context.Background()` inside a method that has a `ctx` parameter is suspicious.
- **State synchronised?** If state is read/written from multiple goroutines, mutex or atomic.
- **Lifetime bounded?** Caches and maps grow forever unless something evicts.
- **Goroutines protected?** Every `go func()` needs its own recover.
- **Chain pre-built?** Composition belongs at startup, not per request.

The decorator pattern is built on small interfaces and disciplined wrapping. The bugs come from skipping discipline — usually because the *wrong* version compiles, runs locally, and looks fine until concurrency, edge cases, or scale arrive.

Next: **[../05-observer-pattern/](../05-observer-pattern/)** — Observer is what you reach for when the decorator's "call before/after" needs to fan out to multiple listeners, or decouple the trigger from the reaction.

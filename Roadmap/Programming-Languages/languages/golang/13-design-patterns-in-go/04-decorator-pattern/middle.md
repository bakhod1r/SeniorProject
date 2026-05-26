# Decorator Pattern — Middle

## 1. What this level adds

Junior taught the shape: a wrapper that implements the same interface, holds an `Inner`, does work around the delegated call. Middle is about *picking the right variant and avoiding the production bugs*:

- Function-style middleware vs struct-style decorators — when each fits.
- Generic decorators (Go 1.18+) and where they pay off.
- Ordering invariants and what to do when middleware *must* run in a specific order.
- Recovering from panics inside middleware safely.
- Stateful decorators — counters, rate-limit windows, circuit breakers.
- Testing decorators — isolation, fakes, observability of the chain.
- Performance — interface dispatch, closure capture, escape analysis at the decorator boundary.

By the end you should be able to design a middleware stack for a production HTTP server or a decorator chain for a gateway without surprises.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Struct vs function decorators](#3-struct-vs-function-decorators)
4. [Generic decorators](#4-generic-decorators)
5. [The middleware chain — formalized](#5-the-middleware-chain--formalized)
6. [Ordering invariants and why they matter](#6-ordering-invariants-and-why-they-matter)
7. [Recovering from panics](#7-recovering-from-panics)
8. [Stateful decorators](#8-stateful-decorators)
9. [Embedding-based decorators — when and how](#9-embedding-based-decorators--when-and-how)
10. [Testing decorators](#10-testing-decorators)
11. [Decorator and context.Context](#11-decorator-and-contextcontext)
12. [Coding patterns](#12-coding-patterns)
13. [Performance notes](#13-performance-notes)
14. [Common middle-level mistakes](#14-common-middle-level-mistakes)
15. [Debugging a decorator chain](#15-debugging-a-decorator-chain)
16. [Tricky points](#16-tricky-points)
17. [Test](#17-test)
18. [Cheat sheet](#18-cheat-sheet)
19. [Summary](#19-summary)

---

## 3. Struct vs function decorators

Two shapes for the same idea. Each fits a different situation.

### 3.1 The struct decorator

```go
type RetryingCharger struct {
    Inner    Charger
    Attempts int
}

func (r *RetryingCharger) Charge(ctx context.Context, amount int) error {
    var err error
    for i := 0; i < r.Attempts; i++ {
        if err = r.Inner.Charge(ctx, amount); err == nil { return nil }
    }
    return err
}

// Usage:
c := &RetryingCharger{Inner: &StripeGateway{...}, Attempts: 3}
```

Best when:
- The decorator has *state* (retry counter, cache, rate-limit budget, metrics counter).
- The decorator is *configured at construction* — attempts count, TTL, logger.
- You want the constructor's signature to enforce required configuration (no nil logger).

### 3.2 The function decorator (middleware)

```go
func Retrying(attempts int) func(Charger) Charger {
    return func(inner Charger) Charger {
        return ChargerFunc(func(ctx context.Context, amount int) error {
            var err error
            for i := 0; i < attempts; i++ {
                if err = inner.Charge(ctx, amount); err == nil { return nil }
            }
            return err
        })
    }
}

// Usage:
c := Retrying(3)(&StripeGateway{...})
```

Best when:
- The decorator has no state (or state is captured by the closure).
- You're composing many decorators in a chain.
- You want to defer configuration to the chain-builder.

The middleware signature in HTTP is the canonical case: `func(http.Handler) http.Handler`. It's a function decorator returned by a configuration function.

### 3.3 Which to choose

| Signal | Lean toward |
|--------|-------------|
| The decorator holds state shared across calls (counters, cache, breakers) | Struct |
| The decorator is stateless — wrap and forward | Function |
| You're publishing the API to other packages, and consumers will write their own decorators | Either — pick the one easier to *implement*, since users mirror your choice |
| You expect the decorator to grow new methods later | Struct (struct decorators evolve; function shapes are frozen) |
| Hot-path with many short calls | Either — measure if you suspect a problem |
| Closure capture would allocate a per-call instance | Struct (one allocation at construction time) |

For HTTP middleware: function. For everything else: usually struct.

---

## 4. Generic decorators

Go 1.18+ generics let you write a decorator over an arbitrary type parameter. Useful, with caveats.

### 4.1 The simple wrapper

```go
type Wrapped[T any] struct {
    Inner T
}
```

This just stores a `T`. It's not a decorator yet because there's no behaviour to wrap. The pattern only earns its keep when `T` has a constraint that exposes methods to call.

### 4.2 The constrained wrapper

```go
type Logger interface { Log(string) }

type Counted[L Logger] struct {
    Inner L
    n     atomic.Int64
}

func (c *Counted[L]) Log(msg string) {
    c.n.Add(1)
    c.Inner.Log(msg)
}

func (c *Counted[L]) Count() int64 { return c.n.Load() }
```

Now `Counted[L]` is a decorator over any `L` satisfying `Logger`. Calling `.Inner` returns the concrete type `L` (not the interface), so you can recover original-type methods that interface dispatch would hide.

### 4.3 Generic middleware

```go
type Middleware[T any] func(next T) T

func Compose[T any](base T, middlewares ...Middleware[T]) T {
    for i := len(middlewares) - 1; i >= 0; i-- {
        base = middlewares[i](base)
    }
    return base
}
```

A generic `Compose` works for any type `T` for which you've defined middleware functions. The catch: `T` itself must support the operation you want to decorate, and Go generics don't let you constrain "T has a method called Foo" without an interface — so usually `T` ends up being an interface anyway, and the generics save very little.

### 4.4 When to bother

Almost never for application code. Generic decorators show up in *library infrastructure*:
- `Compose[T]`, `Pipe[T]`, `Tap[T]` helpers in a utility package.
- Cache wrappers like `Cache[K, V]` where the key/value types vary.
- Testing helpers that decorate any handler-like value.

If you're writing one decorator for one interface, plain interface-based decorators are clearer.

---

## 5. The middleware chain — formalized

The middleware chain in junior §5 is one of the most-used Go idioms. Worth formalising.

```go
type Middleware func(next http.Handler) http.Handler

// Chain applies middlewares left-to-right: Chain(h, A, B, C)
// is equivalent to A(B(C(h))) — A runs first.
func Chain(h http.Handler, mw ...Middleware) http.Handler {
    for i := len(mw) - 1; i >= 0; i-- {
        h = mw[i](h)
    }
    return h
}
```

Why iterate in reverse: when you compose `A(B(C(h)))`, the outermost is `A`. To build this from a slice `[A, B, C]`, start from the inside (`C`) and wrap outward. The reverse loop achieves that.

### 5.1 Per-route vs global chains

```go
// Global — all routes get logging + recovery + tracing
globalChain := func(h http.Handler) http.Handler {
    return Chain(h, Tracing, Recovery, Logging)
}

mux := http.NewServeMux()
mux.Handle("/api", globalChain(apiHandler))
mux.Handle("/admin", globalChain(Auth(adminHandler))) // /admin also requires auth
```

The convention popularised by `chi` and `gorilla/mux`: middlewares can be attached globally (to the whole router), per-group (to a sub-router), or per-route. Each level wraps the previous.

### 5.2 Don't compose at runtime

```go
// Anti-idiom — building the chain per request
func handle(w http.ResponseWriter, r *http.Request) {
    Chain(actualHandler, Logging, Auth).ServeHTTP(w, r) // chain built every request
}
```

Closures and chain construction allocate. Doing this per request adds ~100 ns and a few allocs per call — not catastrophic, but pointless. Build the chain once at startup; serve it many times.

```go
// Correct — chain built once
chain := Chain(actualHandler, Logging, Auth)

func handle(w http.ResponseWriter, r *http.Request) {
    chain.ServeHTTP(w, r)
}
```

### 5.3 The "before" / "after" split

A common request: "I want logging to print the start time *and* the duration". The decorator must capture state across the call:

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()                                  // before
        next.ServeHTTP(w, r)
        log.Printf("%s %s took %s", r.Method, r.URL.Path, time.Since(start)) // after
    })
}
```

The local variable `start` lives across the call. No state needs to be on the decorator struct — it's on the *stack*, captured by the closure that the inner Handler runs through.

---

## 6. Ordering invariants and why they matter

Middlewares often have *order requirements* that aren't obvious from the code.

### 6.1 Recovery before tracing? Or tracing before recovery?

```go
// Option A — Tracing outermost
h := Tracing(Recovery(Auth(handleAPI)))

// Option B — Recovery outermost
h := Recovery(Tracing(Auth(handleAPI)))
```

Option A: if `handleAPI` panics, `Recovery` catches it, the trace records the failure, the tracing span closes normally. Good.

Option B: if `handleAPI` panics, `Recovery` catches it before `Tracing` knows the span is finished. The trace span might leak or report incorrect duration. Probably bad.

The rule: **observability decorators go outside resilience decorators**. Tracing wants to see everything, including the recovered panic. Recovery should be inside, so the trace finishes properly.

### 6.2 Auth before logging? Or after?

Two reasonable answers, depending on what you want to log:

- **Log every request, including unauthorised ones (security audit)** — Auth inside Logging: `Logging(Auth(handler))`. Logging sees 401 responses.
- **Log only authenticated traffic** — Auth outside Logging: `Auth(Logging(handler))`. Unauthorized requests are rejected before logging runs.

Pick deliberately, document the choice, and don't let casual reorders break it.

### 6.3 Rate limiting outside auth — usually

```go
h := RateLimit(Auth(handleAPI))
```

Rate-limit first, then auth. Otherwise an attacker pummelling unauthenticated requests forces your auth code to run on every attempt. Rate-limit on something cheap (IP, API key prefix) before doing real work.

### 6.4 Defensive ordering checks

In a large codebase, document the chain order as code:

```go
const (
    OrderTrace      = 0
    OrderRecovery   = 100
    OrderRateLimit  = 200
    OrderAuth       = 300
    OrderAuthorize  = 400
    OrderLogging    = 500
    OrderHandler    = 1000
)

type MiddlewareSpec struct {
    Order int
    Fn    Middleware
}

func BuildChain(handler http.Handler, mws ...MiddlewareSpec) http.Handler {
    sort.Slice(mws, func(i, j int) bool { return mws[i].Order < mws[j].Order })
    for i := len(mws) - 1; i >= 0; i-- {
        handler = mws[i].Fn(handler)
    }
    return handler
}
```

Order numbers make the chain self-documenting. Used in some larger projects (Knative, Istio); overkill for small apps. Worth knowing exists.

---

## 7. Recovering from panics

Recovery middleware is the canonical example of a *defensive* decorator. Get it right:

```go
func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                // Log with stack trace
                log.Printf("panic: %v\n%s", rec, debug.Stack())

                // Try to write a 500, but only if we haven't already started writing
                if !headersSent(w) {
                    http.Error(w, "internal server error", http.StatusInternalServerError)
                }
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

Three subtleties:

### 7.1 Recover only catches panics from *this* goroutine

If `next.ServeHTTP` spawns a goroutine and that goroutine panics, *this* recovery won't catch it. The runtime kills the process. If your handler spawns goroutines, each goroutine needs its own recovery — or, better, the handler shouldn't spawn goroutines without joining them.

### 7.2 Don't write twice

```go
// Anti-idiom
defer func() {
    if rec := recover(); rec != nil {
        http.Error(w, "internal error", 500) // might be too late
    }
}()
w.WriteHeader(200)
panic("...")
```

If the handler already wrote a status code, calling `http.Error` panics or no-ops depending on the writer. The check `headersSent` (which doesn't exist in stdlib but you can implement via a wrapper around `ResponseWriter`) prevents this. In practice many recovery middlewares just don't write at all on panic — they log, and let the client see whatever partial response was already sent.

### 7.3 The runtime.Goexit case

`runtime.Goexit()` and `t.FailNow()` from `*testing.T` unwind the stack via panic-like mechanics but `recover()` doesn't catch them. Your defer fires, but the value returned by `recover()` is nil. Don't treat "no panic" as "no error" in recovery code — log unconditionally if the handler returned abnormally.

---

## 8. Stateful decorators

Stateless decorators (logging, tracing) are easy. Stateful ones (rate limit, circuit breaker, cache) need care around concurrency.

### 8.1 Rate limiter

```go
type RateLimit struct {
    Inner   Charger
    limiter *rate.Limiter
}

func NewRateLimit(inner Charger, rps int, burst int) *RateLimit {
    return &RateLimit{
        Inner:   inner,
        limiter: rate.NewLimiter(rate.Limit(rps), burst),
    }
}

func (r *RateLimit) Charge(ctx context.Context, amount int) error {
    if err := r.limiter.Wait(ctx); err != nil {
        return fmt.Errorf("RateLimit: %w", err)
    }
    return r.Inner.Charge(ctx, amount)
}
```

The `rate.Limiter` from `golang.org/x/time/rate` is thread-safe. The decorator delegates concurrency to it.

### 8.2 Circuit breaker

```go
type Breaker struct {
    Inner   Charger
    mu      sync.Mutex
    state   BreakerState // closed, open, half-open
    failures int
    opened   time.Time
}

func (b *Breaker) Charge(ctx context.Context, amount int) error {
    if !b.allow() {
        return errCircuitOpen
    }
    err := b.Inner.Charge(ctx, amount)
    b.record(err)
    return err
}

func (b *Breaker) allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    switch b.state {
    case BreakerOpen:
        if time.Since(b.opened) > openTimeout {
            b.state = BreakerHalfOpen
            return true
        }
        return false
    case BreakerHalfOpen:
        return true
    default:
        return true
    }
}

func (b *Breaker) record(err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.failures++
        if b.failures >= failureThreshold {
            b.state = BreakerOpen
            b.opened = time.Now()
        }
        return
    }
    if b.state == BreakerHalfOpen {
        b.state = BreakerClosed
    }
    b.failures = 0
}
```

Notice: the state machine is *inside* the decorator. The inner gateway has no idea breakers exist. The breaker's mutex is held during state transitions, not during the inner call.

### 8.3 Per-key state

Sometimes the decorator needs state per *key* (per user, per route, per gateway). Use `sync.Map` or a sharded map:

```go
type PerKeyRateLimit struct {
    Inner    Charger
    limiters sync.Map // map[string]*rate.Limiter
    rps      rate.Limit
    burst    int
}

func (p *PerKeyRateLimit) limiterFor(key string) *rate.Limiter {
    if v, ok := p.limiters.Load(key); ok { return v.(*rate.Limiter) }
    lim := rate.NewLimiter(p.rps, p.burst)
    actual, _ := p.limiters.LoadOrStore(key, lim)
    return actual.(*rate.Limiter)
}
```

`LoadOrStore` avoids the race where two goroutines both miss, both create a new limiter, and one overwrites the other. The wasted creation is OK because limiters are cheap.

---

## 9. Embedding-based decorators — when and how

Junior §4.3 mentioned this; here's the detail.

```go
type Charger interface {
    Charge(context.Context, int) error
    Refund(context.Context, string) error
    Status(context.Context, string) (string, error)
}

type LoggingCharger struct {
    Charger      // embed the interface
    log *log.Logger
}

// Override only Charge; Refund and Status are promoted from the embedded Charger
func (l LoggingCharger) Charge(ctx context.Context, amount int) error {
    l.log.Printf("Charge: %d", amount)
    return l.Charger.Charge(ctx, amount)
}
```

Usage:

```go
lc := LoggingCharger{Charger: &StripeGateway{...}, log: log.Default()}
lc.Charge(ctx, 100)   // logged
lc.Refund(ctx, "id")  // unchanged — calls StripeGateway.Refund directly
lc.Status(ctx, "id")  // unchanged
```

### Benefits

- You only write code for the methods you actually want to decorate. The rest are automatic.
- The `Inner` field name is the interface name — readable.

### Costs

- The embedded interface is a public field by default (the field is named after the interface). Callers can mutate it: `lc.Charger = &PayPalGateway{}`. If you want this hidden, define a named non-exported field and forward manually.
- Method set rules are subtle. If you embed `Charger` (interface), the wrapper has all methods. If you embed `*StripeGateway` (pointer), the wrapper has only methods on `*StripeGateway`'s method set. Pick what you mean.
- If the inner interface gains a new method, your wrapper automatically inherits it without decoration — sometimes good, sometimes bad. (Often a new method should be logged too — but no compile error reminds you.)

### When to use

- The interface has many methods (5+).
- Most methods don't need decoration.
- You don't mind the public field.

For 1-3 method interfaces, plain struct decorators are clearer. Embedding shines for `database/sql`-style interfaces with a dozen methods.

---

## 10. Testing decorators

Three approaches, each useful for different situations.

### 10.1 Test the decorator with a fake inner

```go
type fakeCharger struct {
    chargeCalled bool
    chargeReturn error
}

func (f *fakeCharger) Charge(ctx context.Context, amount int) error {
    f.chargeCalled = true
    return f.chargeReturn
}

func TestRetryingCharger(t *testing.T) {
    f := &fakeCharger{chargeReturn: errors.New("transient")}
    r := &RetryingCharger{Inner: f, Attempts: 3}
    err := r.Charge(context.Background(), 100)
    if err == nil { t.Fatal("expected error after exhausting retries") }
    if !f.chargeCalled { t.Error("inner never called") }
}
```

Simple, no library. Test the decorator's behaviour in isolation.

### 10.2 Test that a decorator chain produces expected output

```go
func TestChainOrder(t *testing.T) {
    var calls []string

    h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        calls = append(calls, "handler")
    })

    logging := func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            calls = append(calls, "logging:before")
            next.ServeHTTP(w, r)
            calls = append(calls, "logging:after")
        })
    }

    chain := logging(h)
    chain.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))

    want := []string{"logging:before", "handler", "logging:after"}
    if !reflect.DeepEqual(calls, want) {
        t.Errorf("calls = %v, want %v", calls, want)
    }
}
```

Verifies the chain runs in the expected order. Useful when you have complex ordering invariants (§6).

### 10.3 Test the decorator is transparent for non-decorated methods

```go
func TestLoggingChargerForwardsRefund(t *testing.T) {
    f := &fakeCharger{}
    lc := LoggingCharger{Charger: f, log: log.New(io.Discard, "", 0)}
    lc.Refund(context.Background(), "id_123")
    if !f.refundCalled { t.Error("Refund not forwarded") }
}
```

Embedding-based decorators delegate by default. Make sure you assert on it — otherwise a refactor that accidentally drops the embedding breaks production silently.

---

## 11. Decorator and context.Context

Many decorators modify the context they pass to the inner call.

### 11.1 Adding a deadline

```go
func Timeout(d time.Duration) Middleware {
    return func(next Charger) Charger {
        return ChargerFunc(func(ctx context.Context, amount int) error {
            ctx, cancel := context.WithTimeout(ctx, d)
            defer cancel()
            return next.Charge(ctx, amount)
        })
    }
}
```

The inner gets a derived context with a timeout. Cancel propagates correctly via the defer.

### 11.2 Injecting a request ID

```go
func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" { id = uuid.NewString() }
        ctx := context.WithValue(r.Context(), requestIDKey, id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

Downstream handlers can extract the ID from `r.Context()`. The decorator is the right place to derive it because every request needs the same logic.

### 11.3 Watch out: the wrong context

```go
// Anti-idiom
func Timeout(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second) // BUG
        defer cancel()
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

Deriving from `context.Background()` discards the request's context. If the parent had a deadline, it's gone. If the parent was cancelled, the inner doesn't see it. Always derive from `r.Context()` (or the equivalent caller-supplied context).

---

## 12. Coding patterns

### 12.1 The conditional decorator

```go
func If(cond bool, mw Middleware) Middleware {
    if !cond { return identity }
    return mw
}

func identity(next http.Handler) http.Handler { return next }

chain := Chain(h,
    If(useAuth, Auth),
    If(debug, Logging),
    Recovery,
)
```

Cleaner than `if useAuth { chain = Auth(chain) }`. The `identity` function is a no-op middleware — useful as a placeholder.

### 12.2 The named-step decorator

```go
type Named struct {
    Name  string
    Inner Charger
}

func (n *Named) Charge(ctx context.Context, amount int) error {
    log.Printf("[%s] charge: %d", n.Name, amount)
    return n.Inner.Charge(ctx, amount)
}
```

Adds a tag to logs/metrics for the wrapped chain segment. Useful in pipelines with multiple wrapping layers.

### 12.3 The conditional unwrap

```go
type unwrappable interface{ Unwrap() Charger }

func base(c Charger) Charger {
    for {
        u, ok := c.(unwrappable)
        if !ok { return c }
        c = u.Unwrap()
    }
}
```

Some decorators expose an `Unwrap()` method (mirroring `errors.Unwrap`). Lets callers reach the base implementation for type assertions or metrics. Use sparingly — it leaks abstraction.

### 12.4 The metrics decorator with histograms

```go
type MetricsCharger struct {
    Inner    Charger
    duration *prometheus.HistogramVec
}

func (m *MetricsCharger) Charge(ctx context.Context, amount int) (err error) {
    start := time.Now()
    defer func() {
        status := "ok"
        if err != nil { status = "error" }
        m.duration.WithLabelValues(status).Observe(time.Since(start).Seconds())
    }()
    return m.Inner.Charge(ctx, amount)
}
```

The named return `err` lets the deferred function inspect the error after the call. A common decorator idiom for observing both success and failure paths.

---

## 13. Performance notes

Decorators add overhead. Measured on Go 1.22, amd64:

```
BenchmarkDirectCharge-8        500000000   2.10 ns/op   0 B/op   0 allocs/op
BenchmarkOneDecorator-8        300000000   3.41 ns/op   0 B/op   0 allocs/op
BenchmarkFiveDecorators-8      100000000  12.50 ns/op   0 B/op   0 allocs/op
BenchmarkMiddlewareChain5-8     80000000  14.20 ns/op   0 B/op   0 allocs/op
```

Each layer adds ~1-2 ns (an interface dispatch). For an HTTP server handling thousands of requests per second, even ten middlewares add ~20 ns per request — invisible against the ~100,000 ns of actual request work.

Where it does matter:

### 13.1 Hot inner loops

```go
// In a tight loop, each call dispatches through three decorators
for _, item := range millionsOfItems {
    err := c.Charge(ctx, item.Amount) // dispatch 3x
    if err != nil { /* ... */ }
}
```

If `c` is decorated three times and called millions of times, that's a few milliseconds of dispatch overhead. Usually still dwarfed by whatever `Charge` actually does, but profile if you're suspicious.

### 13.2 Closure allocation in middleware setup

```go
// Each call to Logging creates a new closure — allocation
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf(...)
        next.ServeHTTP(w, r)
    })
}
```

If you call `Logging(h)` once at startup, the closure cost is paid once. If you call it per request (don't!), the cost is per-request.

### 13.3 Interface boxing in generic decorators

```go
// Each call boxes the result into an interface
func Trace[T any](next func() T) func() T {
    return func() T {
        log.Println("before")
        v := next()
        log.Println("after")
        return v
    }
}
```

The interior of generic functions can have hidden interface conversions during compilation. Profile or read `-gcflags="-m"` if performance matters.

---

## 14. Common middle-level mistakes

### 14.1 The leaky decorator

```go
type LoggingCharger struct {
    Inner Charger
    log   *log.Logger
}

func (l *LoggingCharger) ApiKey() string {
    if sg, ok := l.Inner.(*StripeGateway); ok {
        return sg.apiKey
    }
    return ""
}
```

The decorator now exposes implementation-specific methods (`ApiKey()`). Consumers must type-assert to `*LoggingCharger` to use them. Either expose the method on `Charger` (and require all implementations to support it), or don't expose it at all.

### 14.2 The order-sensitive constructor

```go
NewServer(":8080",
    WithMiddleware(Auth),
    WithMiddleware(Logging),
    WithMiddleware(Recovery),
)
```

If `WithMiddleware` *appends* to a slice and the chain is built from the slice, the order is sensitive. The caller has to know whether the first option runs first or last. Document it loudly — or use explicit ordering (§6.4).

### 14.3 Hidden state mutation through Inner

```go
type CountingCharger struct {
    Inner Charger
    n     int
}

func (c *CountingCharger) Charge(...) error {
    c.n++
    return c.Inner.Charge(...)
}

// In another goroutine:
go counting.Charge(...) // race on c.n
```

The decorator has unprotected mutable state. Fix with `atomic.Int64` (lightweight counter) or a mutex (complex state).

### 14.4 Forgetting that errors propagate

```go
func (l *LoggingCharger) Charge(...) (string, error) {
    l.log.Printf("Charge")
    id, _ := l.Inner.Charge(...)   // discarded error
    return id, nil
}
```

Always return the inner's error unchanged. A decorator that masks errors is worse than no decorator.

---

## 15. Debugging a decorator chain

When the chain behaves wrong, walk through it.

### 15.1 Log the chain at startup

```go
log.Printf("middleware chain: Trace > Recovery > Auth > Logging > handler")
```

Hand-rolled documentation, but it's the simplest tool when you're trying to remember which order is in effect.

### 15.2 Add unique log strings per layer

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Println(">>> logging enter")
        next.ServeHTTP(w, r)
        log.Println("<<< logging exit")
    })
}
```

A request log now shows the exact order of layers wrapping a given handler. The chain becomes visible.

### 15.3 Reflect on the type chain

```go
func typeChain(c Charger) []string {
    var chain []string
    for {
        chain = append(chain, fmt.Sprintf("%T", c))
        u, ok := c.(interface{ Unwrap() Charger })
        if !ok { return chain }
        c = u.Unwrap()
    }
}
```

If every decorator implements `Unwrap()`, you can introspect the chain at runtime. Useful for `/debug` endpoints.

---

## 16. Tricky points

### 16.1 The decorator that holds the consumer's pointer

```go
type CountingCharger struct {
    Inner    Charger
    count    *int  // pointer to caller's counter
}

func (c *CountingCharger) Charge(...) error {
    *c.count++
    return c.Inner.Charge(...)
}
```

The caller can read `count` outside the decorator. But two `CountingCharger` instances sharing the same counter is unusual — document loudly.

### 16.2 Wrapping types that aren't interfaces

```go
// Can you decorate a concrete type without an interface?
type Logger struct{ /* ... */ }
func (l *Logger) Log(s string) { /* ... */ }

type CountingLogger struct {
    Inner *Logger
    n     int
}

func (c *CountingLogger) Log(s string) {
    c.n++
    c.Inner.Log(s)
}
```

You can, but the consumer now depends on the concrete `*CountingLogger`, not on a shared interface. Refactoring to a different logger means changing every call site. *Always wrap an interface*, even if it's a one-method interface defined for the purpose.

### 16.3 The "stack" abstraction

Some libraries (especially in Java land) talk about a "middleware stack". In Go, the chain is a sequence of function applications, not a runtime stack. There's no `push`/`pop` outside what the call stack does naturally. Don't introduce stack semantics where they aren't needed.

### 16.4 Generic helper traps

```go
func Compose[T any](fns ...func(T) T) func(T) T {
    return func(t T) T {
        for _, fn := range fns { t = fn(t) }
        return t
    }
}
```

Looks like a decorator chain composer. It is — but only for "transformer" decorators that return a new T. It doesn't work for "wrap-and-delegate" decorators that return the *same* T after wrapping. The signature `func(T) T` is ambiguous; it could mean either.

---

## 17. Test

**Q1.** What's the issue?

```go
type Recorder struct {
    Inner Charger
    history []int
}

func (r Recorder) Charge(ctx context.Context, amount int) error {
    r.history = append(r.history, amount)
    return r.Inner.Charge(ctx, amount)
}
```

<details><summary>Answer</summary>

Value receiver. `append` may return a new slice header (especially if capacity is full), but `r` is a copy, so the assignment doesn't reach the caller's instance. After the call, `r.history` (in the caller) might still be empty.

Fix: pointer receiver `(r *Recorder)`. Now the assignment persists.
</details>

**Q2.** Which order runs first?

```go
h := Chain(handlerFunc, A, B, C)
```

<details><summary>Answer</summary>

`A` runs first (outermost), then `B`, then `C`, then `handlerFunc`. The slice order matches reading order: top runs first.

The implementation iterates the slice in reverse so the *last* middleware wraps the handler first; the *first* middleware wraps last (ending up outermost).
</details>

**Q3.** Fix this chain bug:

```go
// Intent: rate-limit BEFORE auth so unauth requests don't burn CPU
h := Auth(RateLimit(handler))
```

<details><summary>Answer</summary>

The current order is wrong. `Auth` is the outermost — it runs first, then `RateLimit`. Unauthorized requests get rate-limited *after* auth has already done CPU work.

Fix: `RateLimit(Auth(handler))`. Now `RateLimit` is outermost; it rejects excess requests before `Auth` runs at all.
</details>

---

## 18. Cheat sheet

| Situation | Approach |
|-----------|----------|
| Multi-method interface with state to track | Struct decorator |
| HTTP / RPC middleware | Function decorator `func(Handler) Handler` |
| Interface with 5+ methods, decorate one or two | Embedding-based decorator |
| Multiple concerns over one type | Compose with `Chain(h, A, B, C)` |
| Per-request state across before/after | Closure variable inside the wrapper function |
| Per-instance state (counters, breakers) | Struct decorator with mutex / atomic |
| Conditional decoration | `If(cond, mw)` helper that returns identity if false |
| Observability concerns | Outside resilience concerns |
| Rate limiting | Outside auth (usually) |
| Recovery | Inside tracing |
| Need to inspect chain | `Unwrap() Inner` method on each decorator |

---

## 19. Summary

Decorator in Go is the workhorse of cross-cutting concerns. Mastery is:

- Picking struct vs function form by the presence of state.
- Composing chains with order awareness (observability outside resilience, rate-limit before auth).
- Handling panics in middleware safely (defer + recover, but only this goroutine).
- Avoiding leaky abstractions (no concrete-type assertions, no per-decorator state mutation through the inner).
- Testing each decorator in isolation with a fake inner, then testing chain order separately.

The next step is **[senior.md](senior.md)** — distributed middleware, request-scoped vs server-scoped decorators, decorator design in published libraries, contracts and Liskov for decorator chains, and case studies (chi, gorilla, gRPC interceptors, otelhttp).

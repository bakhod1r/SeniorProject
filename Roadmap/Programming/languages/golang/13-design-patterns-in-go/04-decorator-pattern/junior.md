# Decorator Pattern — Junior

## 1. What the Decorator pattern actually is

You have an object that does something useful — a logger, an HTTP handler, a database client, an `io.Reader`. You want to add behaviour *around* it without changing the object itself. Logging every call. Retrying on failure. Caching the result. Tracing the latency. Authorising the request.

The Decorator pattern says: wrap the object in another object that satisfies *the same interface*. The wrapper does the extra work, then delegates to the inner object. From the caller's perspective, nothing changed — they still call the same method on the same interface. From the implementation's perspective, you've layered new behaviour around it.

```go
var c Charger = &StripeGateway{...}        // base implementation
c = &LoggingCharger{Inner: c}              // wrap with logging
c = &RetryingCharger{Inner: c, Attempts: 3} // wrap with retries
c = &MetricsCharger{Inner: c}              // wrap with metrics

// caller sees only `Charger` — doesn't know about the wrappers
err := c.Charge(ctx, 100)
```

When `c.Charge(ctx, 100)` runs, it goes: Metrics → Retrying → Logging → Stripe → back up the stack. Each wrapper added one *aspect* (logging, retry, metrics) without touching the underlying gateway.

This pattern is *everywhere* in Go. Every HTTP middleware is a decorator. Every `bufio.NewReader(r)` is a decorator. Every `gzip.NewReader(r)` is a decorator. The standard library is built on it.

This file teaches:

1. The minimum implementation and the canonical "wrap-and-delegate" shape.
2. Why Go's Decorator looks different from Java's textbook version.
3. The three flavours you'll see in production: interface-wrapping, function-wrapping (middleware), and embedding-based.
4. How Decorator pairs with Strategy ([../03-strategy-pattern/](../03-strategy-pattern/)) — they share the interface, so they compose.

---

## 2. Table of Contents

1. [What the Decorator pattern actually is](#1-what-the-decorator-pattern-actually-is)
2. [Table of Contents](#2-table-of-contents)
3. [The minimum implementation](#3-the-minimum-implementation)
4. [Three Go shapes](#4-three-go-shapes)
5. [HTTP middleware — the canonical decorator](#5-http-middleware--the-canonical-decorator)
6. [Decorator in the standard library](#6-decorator-in-the-standard-library)
7. [Composition order matters](#7-composition-order-matters)
8. [A second worked example: cached repository](#8-a-second-worked-example-cached-repository)
9. [Decorator vs Strategy vs Proxy](#9-decorator-vs-strategy-vs-proxy)
10. [Common mistakes a junior makes](#10-common-mistakes-a-junior-makes)
11. [Tricky points](#11-tricky-points)
12. [Quick test](#12-quick-test)
13. [Cheat sheet](#13-cheat-sheet)
14. [What to learn next](#14-what-to-learn-next)

---

## 3. The minimum implementation

The smallest correct decorator. Read it once, then we dissect.

```go
package payment

import (
    "context"
    "log"
)

// The interface stays the same. Wrappers and implementations both satisfy it.
type Charger interface {
    Charge(ctx context.Context, amountCents int) (chargeID string, err error)
}

// The base implementation.
type StripeGateway struct{ apiKey string }

func (s *StripeGateway) Charge(ctx context.Context, amount int) (string, error) {
    // call Stripe's API
    return "stripe_ch_123", nil
}

// A decorator — wraps any Charger with logging.
type LoggingCharger struct {
    Inner Charger
    Log   *log.Logger
}

func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: amount=%d", amount)
    id, err := l.Inner.Charge(ctx, amount) // delegate to inner
    if err != nil {
        l.Log.Printf("Charge failed: %v", err)
        return "", err
    }
    l.Log.Printf("Charge ok: id=%s", id)
    return id, nil
}
```

Usage:

```go
base := &StripeGateway{apiKey: "sk_test_..."}
logged := &LoggingCharger{Inner: base, Log: log.Default()}

id, err := logged.Charge(ctx, 1000)
// Output:
// Charge: amount=1000
// Charge ok: id=stripe_ch_123
```

That's the entire pattern. The decorator:

1. **Implements the same interface** as the thing it decorates.
2. **Holds a reference to an `Inner`** of that interface type.
3. **Does work before / after / around** the inner call.
4. **Delegates the actual operation** to `Inner`.

Everything else — middleware chains, generic helpers, configuration options — is variations on this shape.

---

## 4. Three Go shapes

Decorators in Go come in three idiomatic shapes, depending on what you're wrapping.

### 4.1 Interface decorator (shown above)

```go
type LoggingCharger struct{ Inner Charger; Log *log.Logger }
func (l *LoggingCharger) Charge(...) error { ... }
```

A struct that holds an inner value of the interface type and implements the interface itself. Most common for multi-method interfaces or when the wrapper has its own state (the logger, the metrics client, the retry budget).

### 4.2 Function decorator (middleware)

```go
type Handler func(http.ResponseWriter, *http.Request)

func Logging(next Handler) Handler {
    return func(w http.ResponseWriter, r *http.Request) {
        log.Printf("%s %s", r.Method, r.URL.Path)
        next(w, r)
    }
}

// Compose:
h := Logging(MyHandler)
```

The decorator is a *function* that takes a function and returns a function. Used everywhere in HTTP middleware. The standard library version uses `http.Handler` (an interface with `HandlerFunc` adapter) but the function-of-function shape is so common that "middleware" usually means this.

### 4.3 Embedding-based decorator

```go
type LoggingCharger struct{ Charger }                  // embed the interface

func (l LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    log.Printf("Charge: %d", amount)
    return l.Charger.Charge(ctx, amount) // delegate via promoted name
}

// Usage:
lc := LoggingCharger{Charger: &StripeGateway{...}}
```

Embedding promotes all methods of the inner interface onto the outer type, *unless* you override one. For an interface with five methods where you want to decorate only one, embedding saves four method shims. But the receiver type clash (value vs pointer) is easy to get wrong; we cover this in §7 of `middle.md`.

For now: §4.1 is the safe default. Use §4.2 for HTTP middleware. Avoid §4.3 until you've internalised method sets.

---

## 5. HTTP middleware — the canonical decorator

If you've ever written HTTP server code in Go, you've decorated `http.Handler`. The pattern is so dominant that the *word* "middleware" effectively means "Decorator" in Go culture.

```go
// from net/http (paraphrased)
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

Middleware decorates `http.Handler`:

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        log.Printf("%s %s", r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
        log.Printf("done in %s", time.Since(start))
    })
}

func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic: %v", rec)
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func Auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("Authorization") == "" {
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

Compose them:

```go
var h http.Handler = http.HandlerFunc(handleAPI)
h = Auth(h)         // wrap with auth
h = Recover(h)      // wrap with panic recovery
h = Logging(h)      // wrap with logging — outermost

http.Handle("/api", h)
```

The chain is: `Logging → Recover → Auth → handleAPI → back up`.

### Why this works

`Logging(next Handler) Handler` is a *function that takes a Handler and returns a Handler*. The returned Handler closes over `next` (the original) and runs custom logic before/after invoking it. Each layer adds one concern, and the chain composes by function application.

This is *exactly* the decorator pattern. The only difference from §4.1 is that the wrapper is created by a function instead of being a named struct type.

### Variant: chain helpers

When the chain is long, write a helper:

```go
func Chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}

// Usage — reads top-to-bottom:
h := Chain(http.HandlerFunc(handleAPI),
    Logging,
    Recover,
    Auth,
)
```

The loop iterates in reverse so that the *first* middleware in the slice is the *outermost* layer. This convention (top of the slice runs first) matches `chi`, `gorilla/mux`, and most popular Go routers.

---

## 6. Decorator in the standard library

A small sample of decorators you've used without thinking about them.

| Where | Inner type | Decoration adds |
|-------|-----------|-----------------|
| `bufio.NewReader(r io.Reader)` | `io.Reader` | Read buffering |
| `bufio.NewWriter(w io.Writer)` | `io.Writer` | Write buffering |
| `gzip.NewReader(r io.Reader)` | `io.Reader` | gzip decompression |
| `gzip.NewWriter(w io.Writer)` | `io.Writer` | gzip compression |
| `tls.Client(conn net.Conn, ...)` | `net.Conn` | TLS encryption |
| `httputil.NewSingleHostReverseProxy(...)` | `http.Handler` (in effect) | Proxying |
| `httptest.NewRecorder()` | `http.ResponseWriter` | Capturing for tests |
| `context.WithTimeout(ctx)` | `context.Context` | Timeout |
| `context.WithValue(ctx, ...)` | `context.Context` | Value injection |
| `template.Funcs(funcMap)` | `*template.Template` | Available functions |
| `errors.WithStack(err)` (pkg/errors) | `error` | Stack trace |

Reading `bufio.Reader` is the right way to internalise the pattern. It implements `io.Reader`, wraps an `io.Reader`, and adds a buffer in between. The caller treats it like any other `io.Reader`; the buffering is invisible.

```go
// Caller doesn't care that there's a buffer
var r io.Reader = bufio.NewReader(os.Stdin)
data, _ := io.ReadAll(r)
```

You've used this dozens of times. That's Decorator.

---

## 7. Composition order matters

Decorators run in the order they wrap. The outermost wrapper runs *first* on the way in and *last* on the way out.

```go
c := &StripeGateway{}
c = &LoggingCharger{Inner: c}        // log
c = &RetryingCharger{Inner: c}        // retry
c = &TracingCharger{Inner: c}         // trace

// When c.Charge(...) runs:
// 1. Tracing starts span
// 2. Retrying loops up to N times
//    3. Logging prints "Charge: ..."
//    4. Stripe makes the API call
//    5. Logging prints result
// 6. Retrying decides to retry or give up
// 7. Tracing ends span
```

Two ordering rules worth memorising:

### 7.1 Cross-cutting concerns go outside

Logging, tracing, metrics, recovery — these should observe the *final* behaviour, not be retried. Put them outside the retry wrapper.

```go
c := &StripeGateway{}
c = &RetryingCharger{Inner: c}        // inside — retried by no one
c = &LoggingCharger{Inner: c}         // outside — sees the full retry attempt
c = &TracingCharger{Inner: c}         // outermost — wraps everything
```

If you put logging *inside* retry, you'd log each individual attempt (and the final outcome would be lost behind the retry decision). Sometimes useful, but usually not what you want.

### 7.2 Authorization goes near the outside

If a request shouldn't be retried, traced, or logged when it's unauthorised, put authorization near the outside:

```go
h := MyHandler
h = Auth(h)        // innermost cross-cutting concern
h = Logging(h)     // logs include the unauth response
h = Recover(h)     // recovers from panics anywhere
h = Trace(h)       // traces every request
```

There's no universal rule — it depends on what you want to observe and what should short-circuit. The decision is per-application. But "outermost runs first" is the structural fact you build on.

---

## 8. A second worked example: cached repository

A repository pattern with a caching decorator.

```go
package users

import (
    "context"
    "errors"
    "sync"
    "time"
)

// The interface — same for both real and cached implementations.
type Repo interface {
    Get(ctx context.Context, id int) (User, error)
}

// The real implementation — talks to the database.
type DBRepo struct{ db *sql.DB }

func (r *DBRepo) Get(ctx context.Context, id int) (User, error) {
    var u User
    err := r.db.QueryRowContext(ctx,
        "SELECT id, name FROM users WHERE id=$1", id,
    ).Scan(&u.ID, &u.Name)
    if errors.Is(err, sql.ErrNoRows) { return User{}, ErrNotFound }
    return u, err
}

// The decorator — adds a TTL cache around any Repo.
type CachedRepo struct {
    Inner Repo
    TTL   time.Duration

    mu      sync.Mutex
    entries map[int]cacheEntry
}

type cacheEntry struct {
    user    User
    expires time.Time
}

func NewCachedRepo(inner Repo, ttl time.Duration) *CachedRepo {
    return &CachedRepo{
        Inner:   inner,
        TTL:     ttl,
        entries: make(map[int]cacheEntry),
    }
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    // Cache check
    c.mu.Lock()
    if e, ok := c.entries[id]; ok && time.Now().Before(e.expires) {
        c.mu.Unlock()
        return e.user, nil
    }
    c.mu.Unlock()

    // Cache miss — delegate
    u, err := c.Inner.Get(ctx, id)
    if err != nil {
        return User{}, err
    }

    // Cache result
    c.mu.Lock()
    c.entries[id] = cacheEntry{user: u, expires: time.Now().Add(c.TTL)}
    c.mu.Unlock()

    return u, nil
}
```

Usage:

```go
var repo users.Repo = users.NewDBRepo(db)
repo = users.NewCachedRepo(repo, 5*time.Minute)
// repo is now a CachedRepo that fronts a DBRepo
```

Three things to notice:

1. **The cache is a `Repo`.** It implements the same interface. From the caller's perspective, the cache is just a Repo.
2. **The decorator owns the cache state.** Concurrency-safety is handled in the decorator, not the inner repo. The inner repo doesn't know about caching.
3. **Disabling the cache is one line.** Pass the bare `DBRepo` to the consumer instead of the wrapped one. The application code doesn't change.

If you decide later that you want a different cache strategy (LRU, LFU, distributed Redis), you write a new decorator. The repo doesn't change. The consumer doesn't change. This is the payoff of small interfaces.

---

## 9. Decorator vs Strategy vs Proxy

Three GoF patterns that look similar. The differences matter.

### Decorator

> Wraps an object to add behaviour, while keeping the same interface.

The wrapped object is the *real* implementation. The wrapper *adds* something (logging, caching, retry). The caller still sees the original interface.

### Strategy

> A type with a varying step, swappable at runtime.

Strategy is about *which* implementation runs. Decorator is about *what surrounds* the implementation. A `StripeGateway` and `PayPalGateway` are *strategies* (alternatives). A `LoggingCharger` wrapping `StripeGateway` is a *decorator* (addition).

In Go, both use interfaces, so the syntax looks similar. The difference is in *intent*:

```go
// Strategy: pick which implementation to use
var c Charger
if useStripe {
    c = &StripeGateway{...}
} else {
    c = &PayPalGateway{...}
}

// Decorator: add behaviour around the implementation
c = &LoggingCharger{Inner: c}
```

### Proxy

> Controls access to an object, while keeping the same interface.

A proxy intercepts calls and may decide whether/how/when to forward them: a remote proxy translates calls into RPCs, a security proxy checks permissions, a virtual proxy lazy-loads. The wrapped object might not even exist yet.

In practice the line between Proxy and Decorator is fuzzy in Go. Both wrap; both delegate; both implement the same interface. The textbook distinction is:

- **Decorator** *adds* behaviour to a real, existing object.
- **Proxy** *controls access* to an object that may be remote, lazy, or restricted.

If you can't tell which one you're writing, call it a Decorator and move on. Go programmers rarely insist on the distinction.

### Decision table

| Goal | Pattern |
|------|---------|
| Add cross-cutting behaviour (log, retry, cache, trace) | Decorator |
| Choose between multiple alternative implementations | Strategy |
| Control access to a remote / restricted / lazy object | Proxy |
| Compose two related interfaces into a new interface | Adapter |

---

## 10. Common mistakes a junior makes

### 10.1 Forgetting to delegate

```go
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: %d", amount)
    // forgot to call l.Inner.Charge — returns zero values, no error
    return "", nil
}
```

The wrapper does its work but never calls `Inner`. The inner gateway never runs. Compiles, runs without panic, silently produces wrong results. Always call `Inner` (or document why you don't, e.g., a short-circuit case).

### 10.2 Hardcoding the inner type

```go
type LoggingCharger struct {
    Inner *StripeGateway  // hardcoded — can't wrap PayPal or any other
    Log   *log.Logger
}
```

The decorator should hold the *interface*, not a concrete type. Otherwise you have to write a new decorator for every implementation. Hold `Charger`.

### 10.3 Mutating the inner object

```go
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Inner.(*StripeGateway).apiKey = "logged_" + l.Inner.(*StripeGateway).apiKey
    return l.Inner.Charge(ctx, amount)
}
```

Don't reach inside the inner object to mutate state. The decorator's job is *around the call*, not *modifying the wrapped thing*. If you want to change the wrapped object's state, that's a sign your design is off — probably a strategy choice, not a decorator.

### 10.4 Reorder confusion

```go
// Intent: log requests, then retry on failure
h := MyHandler
h = Retry(h)
h = Logging(h)
```

Logging is now the outermost layer — it sees one call per request (good) but doesn't see individual retry attempts (sometimes bad). Some people *want* this; others want logging inside the retry loop. Be explicit about your goal.

### 10.5 Decorator returning a different interface type

```go
// Wrong — wrapper has additional methods
type LoggingCharger struct{ Inner Charger; Log *log.Logger }
func (l *LoggingCharger) Charge(...) error { /* ... */ }
func (l *LoggingCharger) GetLog() *log.Logger { return l.Log }

// Consumer expects Charger; now has to type-assert to find GetLog
```

The decorator should expose exactly the inner interface, no more. If callers need access to the logger, retrieve it elsewhere (constructor, config). Type assertions inside business logic indicate a leaky abstraction.

---

## 11. Tricky points

### 11.1 The inner interface might be nil

```go
lc := &LoggingCharger{Log: log.Default()} // forgot Inner
lc.Charge(ctx, 100) // panic: nil pointer dereference inside l.Inner.Charge
```

Defensive constructors prevent this:

```go
func NewLoggingCharger(inner Charger, log *log.Logger) *LoggingCharger {
    if inner == nil { panic("LoggingCharger: nil Inner") }
    if log == nil { log = log.Default() }
    return &LoggingCharger{Inner: inner, Log: log}
}
```

A panic is fair — a nil inner is a programmer bug, not a runtime condition.

### 11.2 Wrapping a wrapper — fine, but watch the chain length

```go
c := &StripeGateway{}
c = &LoggingCharger{Inner: c}
c = &LoggingCharger{Inner: c}    // logs twice
c = &LoggingCharger{Inner: c}    // logs three times
```

Stupid example, but the more general bug — accidentally wrapping the same decorator twice — happens in real code (especially when middleware is configured both globally and per-route). Result: duplicate logs, double metrics, doubled latencies. Be careful where wrapping happens.

### 11.3 Closure capture in middleware

```go
for _, m := range middlewares {
    h = m(h) // before Go 1.22, this is fine — m is reassigned each iteration
}
```

Closure capture inside the loop *body* is fine here because `m(h)` is evaluated immediately. The pitfall appears when middleware captures the loop variable in a deferred closure:

```go
for _, route := range routes {
    h := route.Handler
    h = func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            log.Printf("route: %s", route.Path) // before Go 1.22, captures last route
            next.ServeHTTP(w, r)
        })
    }(h)
}
```

In Go 1.22+ this works. In Go 1.21 and earlier, you needed `route := route` inside the loop.

### 11.4 The error decorator that swallows errors

```go
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: %d", amount)
    id, err := l.Inner.Charge(ctx, amount)
    if err != nil { l.Log.Printf("error: %v", err) }
    return id, err  // good
    // return id, nil  // BAD — swallows the error
}
```

A logging decorator that logs the error but returns `nil` *hides* failures. Always propagate the error unchanged unless the decorator's whole purpose is to transform errors.

---

## 12. Quick test

**Q1.** What's wrong with this decorator?

```go
type CountingCharger struct {
    Inner Charger
    count int
}

func (c CountingCharger) Charge(ctx context.Context, amount int) error {
    c.count++   // mutation on value receiver
    return c.Inner.Charge(ctx, amount)
}
```

<details><summary>Answer</summary>

Value receiver. `c.count++` mutates the local copy, which is discarded when the method returns. The caller's counting struct stays at zero. Fix: use a pointer receiver — `func (c *CountingCharger)`.

This is the most common Decorator bug. The wrapper has state that needs to mutate, but the method uses a value receiver and the state never accumulates.
</details>

**Q2.** What does this print?

```go
type LoggingCharger struct{ Inner Charger }
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    fmt.Println("before", amount)
    id, err := l.Inner.Charge(ctx, amount)
    fmt.Println("after", amount)
    return id, err
}

c := &StripeGateway{}
wrapped := &LoggingCharger{Inner: &LoggingCharger{Inner: c}}
wrapped.Charge(ctx, 100)
```

<details><summary>Answer</summary>

```
before 100
before 100
after 100
after 100
```

Two layers of logging. Outermost runs first ("before"), delegates to inner (which prints another "before"), inner Stripe runs, then "after" prints twice on the way out.
</details>

**Q3.** Decorator or Strategy?

```
You want to support both Stripe and PayPal as payment providers, switchable at runtime via a config flag.
```

<details><summary>Answer</summary>

Strategy. You're choosing between alternative implementations of the same interface. Decorator wraps a *given* implementation to add behaviour; here you're picking between two implementations.

If, in addition, you wanted to log every charge regardless of provider — that's the Decorator part. The two compose: pick the strategy (Stripe vs PayPal), then wrap it with logging.
</details>

---

## 13. Cheat sheet

| What | How |
|------|-----|
| The interface | Same for wrapper, base, and decorator alike |
| The wrapper struct | `type X struct { Inner Iface; /* state */ }` |
| The method | Do work, call `Inner.Method(...)`, do more work, return |
| Receiver kind | Pointer if the wrapper has state to mutate; value otherwise |
| Composition | `c = WrapA(c); c = WrapB(c)` — outer runs first |
| Function-style | `type Mid func(next Iface) Iface` |
| Chain helper | Loop the slice in reverse to compose top-down |
| Constructor | Validate `Inner != nil`; default any nullable state |
| Don't | Forget to delegate; hold a concrete inner type; mutate inner state; swallow errors |

---

## 14. What to learn next

In order:

1. **[middle.md](middle.md)** — Generic decorators, parameterised decorators, decorator factories, ordering invariants, recovering from middleware panics, performance.
2. **[../03-strategy-pattern/](../03-strategy-pattern/)** — Strategy chooses; Decorator wraps. They compose.
3. **[../11-proxy-pattern/](../11-proxy-pattern/)** — Proxy controls access; Decorator adds behaviour. Cousins.
4. **[../09-iterator-pattern/](../09-iterator-pattern/)** — Iterator and Decorator both wrap; iterator wraps a *collection access*, decorator wraps a *method call*.

Decorator is one of the most useful patterns in Go because the language is built around small interfaces, and every small interface is a candidate for wrapping. Once you see HTTP middleware as Decorator, `bufio.Reader` as Decorator, and `gzip.NewWriter` as Decorator, you'll start writing your own decorators for cross-cutting concerns — and your application code will get noticeably smaller.

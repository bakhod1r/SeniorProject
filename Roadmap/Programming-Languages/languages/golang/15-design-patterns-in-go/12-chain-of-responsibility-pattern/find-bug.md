# Chain of Responsibility — Find the Bug

Each scenario is a chain that looks right but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Middleware forgets to call next

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Println(r.Method, r.URL.Path)
        // forgot: next.ServeHTTP(w, r)
    })
}
```

**Bug:** the request is logged but never forwarded — the final handler never runs; clients get an empty 200.
**Fix:** call `next.ServeHTTP(w, r)` after logging.

---

## Bug 2 — Wrong wrap order

```go
func Chain(h http.Handler, mw ...Middleware) http.Handler {
    for i := 0; i < len(mw); i++ { // forward loop
        h = mw[i](h)
    }
    return h
}
chain := Chain(routes, Logging, Auth)
```

**Bug:** the forward loop wraps `Logging` first then `Auth` *outside* it, so `Auth` runs before `Logging` — the reverse of the listed order, surprising every reader.
**Fix:** loop backwards (`for i := len(mw)-1; i >= 0; i--`) so the first-listed middleware runs first.

---

## Bug 3 — Auth after the protected work

```go
chain := Chain(deleteHandler, Logging, RateLimit, Auth)
```

**Bug:** `Auth` is listed last, so it wraps the innermost layer — it runs *closest to the handler*, after rate limiting has already done work, and (depending on order semantics) may even run after side effects. Auth must gate everything expensive/sensitive.
**Fix:** place `Auth` early: `Chain(deleteHandler, Logging, Auth, RateLimit)`.

---

## Bug 4 — Dropped context

```go
func Trace(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.WithValue(context.Background(), spanKey, newSpan()) // Background!
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

**Bug:** deriving from `context.Background()` discards the incoming request context — cancellation, deadline, and earlier values (request ID) are lost for the rest of the chain.
**Fix:** derive from `r.Context()`: `context.WithValue(r.Context(), spanKey, newSpan())`.

---

## Bug 5 — Chain rebuilt every request

```go
func ServeHTTP(w http.ResponseWriter, r *http.Request) {
    h := Chain(routes, Logging, Auth, RateLimit) // built per call
    h.ServeHTTP(w, r)
}
```

**Bug:** the wrapping closures are allocated on every request — needless GC pressure and latency.
**Fix:** build the chain once at startup (`var handler = Chain(...)`) and reuse it.

---

## Bug 6 — Stateful handler under concurrency

```go
type Counter struct {
    next  http.Handler
    count int // shared mutable state
}
func (c *Counter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    c.count++ // data race across concurrent requests
    c.next.ServeHTTP(w, r)
}
```

**Bug:** `count` is mutated by concurrent requests without synchronization — a data race.
**Fix:** use `atomic.Int64` for the counter (one word, no companion invariant).

---

## Bug 7 — Short-circuit without writing a response

```go
func Auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !valid(r) {
            return // returns without writing anything
        }
        next.ServeHTTP(w, r)
    })
}
```

**Bug:** on rejection it returns without writing a status — the client gets a bare 200 with an empty body, masking the auth failure.
**Fix:** write the error before returning: `http.Error(w, "unauthorized", http.StatusUnauthorized); return`.

---

## Bug 8 — No terminal handler (object form)

```go
func (b *base) forward(r Request) string {
    return b.next.Handle(r) // panics if next is nil at the end of the chain
}
```

**Bug:** the last handler's `next` is nil; forwarding off the end nil-dereferences and panics.
**Fix:** guard `if b.next == nil { return "unhandled" }` (or install a terminal default handler).

---

## Bug 9 — Silent rejection (no observability)

```go
func RateLimit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !limiter.Allow() {
            http.Error(w, "slow down", 429)
            return // no log, no metric
        }
        next.ServeHTTP(w, r)
    })
}
```

**Bug:** rejections are invisible to operators — a spike in 429s can't be diagnosed.
**Fix:** emit a structured log and increment a metric naming the link and reason on short-circuit.

---

## How to approach these
1. Trace one request through every link — does it reach the end?
2. Check the wrap order matches the intended run order.
3. Verify auth/expensive gates come early.
4. Confirm `ctx` is forwarded (derived from `r.Context()`).
5. Confirm the chain is built once and handlers are stateless.
6. Confirm short-circuits write a response and are observable.

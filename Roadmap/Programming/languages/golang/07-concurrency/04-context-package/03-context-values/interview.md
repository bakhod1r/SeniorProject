# Context Values — Interview Questions

[← Back to index](junior.md)

Interview questions on `context.WithValue` and `context.Value` are popular because the API has subtle rules, well-known anti-patterns, and visible production failures. Questions range from "what is the function signature" at the junior screen to "design a tracing middleware" at the staff round.

The questions below are ordered by difficulty. Each one includes a model answer plus the follow-ups an experienced interviewer asks.

---

## Junior

### Q1. What does `context.WithValue` do?

**Model answer:** It returns a new `context.Context` that wraps the parent and associates a single (key, value) pair with it. When you later call `Value(key)` on that context or any context derived from it, you get the value back. The parent and its other methods (`Done`, `Err`, `Deadline`) are unchanged.

**Follow-ups:** Does it create a goroutine? (No.) Does it return a cancel function? (No.) Is the parent modified? (No; you get a new context.)

### Q2. Why is `context.WithValue(ctx, "userID", id)` considered bad style?

**Model answer:** Because the key is a built-in `string`, two unrelated packages might both use the key `"userID"` and silently overwrite or shadow each other. The idiomatic fix is to define a private, unexported type per package — typically an empty struct or a typed int — so the type system guarantees uniqueness.

**Follow-ups:** What tool flags this? (`staticcheck` rule SA1029, `go vet`.) What if the key type is private but exported? (Still risky — other packages can construct equal values; but the unexported type is what matters, not the variable.)

### Q3. Write the unexported-key idiom.

**Model answer:**

```go
type ctxKey int

const (
    userKey ctxKey = iota
    requestIDKey
)
```

or equivalently:

```go
type userKey struct{}
```

Both work. The first groups related keys into one type; the second uses a separate type per key.

**Follow-ups:** Why does it matter that `ctxKey` is unexported? (Other packages cannot construct values of this type.) What happens if two packages both define `type ctxKey struct{}`? (Different types, no collision.)

### Q4. What does `ctx.Value(key).(string)` do? What is the safer form?

**Model answer:** It looks up the value for `key` in the context chain and type-asserts the result to `string`. If the value is missing or is not a string, the assertion panics. The safer form is:

```go
id, ok := ctx.Value(key).(string)
```

`ok` is `false` if the value is missing or of a different type.

**Follow-ups:** When might the value be present but `ok` be false? (Wrong type — someone stored an `int` under the same key.) What is the cost of a missed assertion in production? (Panic, request crashes, runtime stack trace.)

### Q5. Does Go have goroutine-local storage?

**Model answer:** No, intentionally. There is no API for "get the current goroutine's storage." The closest equivalent is passing a `context.Context` as the first argument and storing request-scoped data in it via `WithValue`. The design choice was made because thread-local state hides dependencies and complicates testing.

**Follow-ups:** What is the closest equivalent in Java? (`ThreadLocal`.) In Node? (`AsyncLocalStorage`.) Why doesn't Go expose goroutine IDs? (To prevent code that depends on goroutine identity.)

---

## Middle

### Q6. Write a type-safe accessor for a `User` stored in context.

**Model answer:**

```go
package authctx

import "context"

type ctxKey struct{}
var key = ctxKey{}

type User struct {
    ID    string
    Email string
}

func With(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, key, u)
}

func From(ctx context.Context) (User, bool) {
    u, ok := ctx.Value(key).(User)
    return u, ok
}
```

**Follow-ups:** Why return `bool` rather than `error`? (For optional reads; for required reads, return an error or panic in `MustFrom`.) Why a struct value rather than a pointer? (Small struct, pass by value is fine; pointer requires synchronization if mutated.)

### Q7. When should I use `context.WithValue` and when should I add a parameter to my function?

**Model answer:** Use a context value when the data is **request-scoped metadata** that flows through many layers and most of them ignore it — request IDs, trace IDs, user identities, locales. Use a parameter when the function actually consumes the data to do its job. If you remove the value from the context and the function still makes sense (just with a degraded log line), context. If the function fails or behaves differently, parameter.

**Follow-ups:** What about a database handle? (Parameter or struct field — application-scoped.) A logger? (Parameter for libraries, context for request-scoped loggers.) A retry count? (Parameter; context values are immutable.)

### Q8. What is the cost of `ctx.Value(key)`?

**Model answer:** O(depth of the chain). It walks the linked list of `valueCtx` (and other) wrappers from the receiver toward the root, comparing keys at each link. There is no hash map. At realistic depths (3-10) the cost is single-digit to low-double-digit nanoseconds. In a tight loop, hoist the lookup before the loop.

**Follow-ups:** Why isn't it a map? (Lookup needs to honour scope; values added in a derived context must shadow ancestors, which is awkward in a flat map.) When does the cost matter? (Hot inner loops at extreme depths — usually a structural problem.)

### Q9. Show middleware that adds a request ID to the context.

**Model answer:**

```go
type ctxKey struct{}
var key = ctxKey{}

func newID() string {
    var b [8]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}

func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = newID()
        }
        w.Header().Set("X-Request-ID", id)
        ctx := context.WithValue(r.Context(), key, id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

**Follow-ups:** Why honour the inbound header? (Correlation across services.) What if the header is malicious? (Validate it; an attacker can inject newlines into logs.) Why does the middleware also write a response header? (Client can correlate the request later.)

### Q10. What's wrong with the following code?

```go
const userKey = "user"

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := context.WithValue(r.Context(), userKey, currentUser)
    next(w, r.WithContext(ctx))
}
```

**Model answer:** Three problems. (1) The key is a `string`, which collides with anything else using the same string. (2) The key is exported (a package-level constant) — anyone can read or overwrite it. (3) The reader (not shown) would still need a type assertion at the call site, which is fragile.

The fix: a private `ctxKey struct{}` and an accessor pair `WithUser`/`UserFromContext`.

**Follow-ups:** What does `staticcheck` say? (SA1029.) What does `go vet` say? (The `contextkeys` analyzer flags built-in types as keys.)

---

## Senior

### Q11. Should I store a `*sql.DB` in the context?

**Model answer:** No. A `*sql.DB` is application-scoped, not request-scoped. It is long-lived, shared across all requests, configured at startup. Storing it in context hides the dependency from function signatures and tests. Wire it through a constructor or struct field instead.

The same argument applies to caches, HTTP clients, message queue connections, and configuration.

**Follow-ups:** What if the DB connection is per-tenant? (Different question — at that point you have a *request-scoped* `*sql.DB`. Even then, prefer a `db := lookupDB(ctx)` pattern in a centralised location rather than scattering `ctx.Value`.)

### Q12. A junior engineer puts a `Service` struct in context with all the dependencies. What's the problem? What do you suggest?

**Model answer:** Context is being used as a dependency-injection container. The problem: every function with a `context.Context` parameter now has implicit access to every dependency. Tests must fake the entire bag. Adding a new dependency requires changing none of the signatures — which makes refactors invisible. Compile-time guarantees about what a function needs are lost.

Suggested fix: build a request handler struct whose constructor takes the dependencies explicitly:

```go
type OrderHandler struct {
    db    DB
    cache Cache
    log   *slog.Logger
}

func NewOrderHandler(db DB, cache Cache, log *slog.Logger) *OrderHandler { ... }
```

The handler now has a clear dependency list. Tests pass fakes. The context carries only request-scoped data.

**Follow-ups:** What is the difference between request-scoped and application-scoped? (Request-scoped data lives for one request; application-scoped lives for the process. Context for the first, DI for the second.)

### Q13. How does `context.WithoutCancel` interact with values?

**Model answer:** `WithoutCancel(parent)` (Go 1.21+) returns a context that detaches from the parent's cancellation but **continues to delegate `Value` lookups to the parent**. So you keep request IDs, trace IDs, and other values; you lose the deadline. The canonical use is spawning a long-running task while preserving request correlation.

```go
go func() {
    bg := context.WithoutCancel(ctx)
    backgroundTask(bg) // still has request_id in logs
}()
```

**Follow-ups:** What was the pre-1.21 workaround? (Build `context.Background()`, copy values manually.) Does `WithoutCancel`'s `Done` return nil? (Yes — no cancellation channel.)

### Q14. Two pieces of middleware both attach a value with the same key. What happens?

**Model answer:** Both calls add a `valueCtx` node to the chain. The outer call (closer to the call site) wins on lookup because the walk starts there. The inner value is still in memory but shadowed.

This is usually a bug. Inspect the middleware order or rename keys.

**Follow-ups:** If middleware A attaches and middleware B attaches deeper in the chain, which wins? (Whichever ran later, i.e. is closer to the leaf of the chain — outermost in middleware composition terms.) Can I "remove" the inner value? (No; build a new chain from a point upstream.)

### Q15. Walk through the lookup of `ctx.Value(traceIDKey)` on a depth-5 chain.

**Model answer:**

```
ctx5.Value(traceIDKey)
  ctx5.key (loggerKey) != traceIDKey   → recurse
ctx4.Value(traceIDKey)
  ctx4.key (userKey) != traceIDKey     → recurse
ctx3.Value(traceIDKey)
  ctx3.key (traceIDKey) == traceIDKey  → return ctx3.val
```

Three hops. Each hop: an interface equality check (compare type word, compare data word) and a parent dereference. Roughly 10-15 ns total on modern hardware.

**Follow-ups:** What if `traceIDKey` is not present? (Walk all the way to `Background`, which returns nil.) What if a `cancelCtx` is in the middle of the chain? (Its `Value` delegates up; one extra link.)

---

## Staff

### Q16. Design a tracing middleware that attaches a span to the context.

**Model answer:** The design has four parts.

```go
package tracing

import (
    "context"
    "net/http"
)

type ctxKey struct{}
var key = ctxKey{}

type Span interface {
    End()
    TraceID() string
    SpanID() string
}

func With(ctx context.Context, s Span) context.Context {
    return context.WithValue(ctx, key, s)
}

func From(ctx context.Context) Span {
    if s, ok := ctx.Value(key).(Span); ok {
        return s
    }
    return noopSpan{}
}

func Middleware(tracer Tracer) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx := r.Context()
            if parent := extractFromHeaders(r.Header); parent != "" {
                ctx = withParentTrace(ctx, parent)
            }
            span := tracer.Start(ctx, r.URL.Path)
            defer span.End()
            ctx = With(ctx, span)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

Key design points:

1. The accessor `From` returns a `Span` interface, never `nil`. Callers can call `From(ctx).End()` without checks.
2. The default is a no-op span — code outside an instrumented path still compiles and runs.
3. Outbound HTTP/RPC code calls `From(ctx)`, reads trace ID, injects it into outgoing headers.
4. The key is private, the accessor is typed, the contract is documented.

**Follow-ups:** How does this compose with OpenTelemetry? (OTEL uses the same pattern; you would not write your own and would call `trace.SpanFromContext`.) How do you handle child spans in deep code? (`tracer.Start(ctx, "op-name")` returns a new context.)

### Q17. A senior engineer claims `context.WithValue` is "essentially a thread-local." Push back.

**Model answer:** Several differences make the analogy misleading.

1. **Explicit vs implicit.** Thread-locals are read via a side channel; context values require an explicit parameter. The function signature shows the dependency on `context.Context`.
2. **Lifetime.** Thread-locals live until cleared or the thread dies; with pools, "die" is "never." Context values die when the chain is dropped — deterministically.
3. **Goroutine forking.** A new goroutine does not "inherit" anything implicit in Go; the parent goroutine must explicitly pass the context.
4. **Composability.** Two libraries using `ThreadLocal<User>` collide on the type. Two libraries using `WithValue` use private key types and cannot collide.
5. **Cross-process propagation.** Thread-locals cannot be serialized. Context values can be inspected, serialized into a message header, reconstructed on the other side.

The analogy is useful for first-time learning ("it's like a thread-local") but breaks down on every important property.

**Follow-ups:** Where does Java's Project Loom complicate this picture? (Virtual threads invalidate thread-pool-based thread-local strategies.) Where does Node's AsyncLocalStorage fit? (Closer to context but runtime-managed; depends on async hooks being correctly preserved.)

### Q18. How would you find and fix a leak caused by storing a `context.Context` in a process-wide cache?

**Model answer:**

The symptom: memory grows without bound, heap profile shows `*valueCtx` retaining objects long after the request that created them ended.

Diagnosis: search for `ctx` or `context.Context` stored in any package-level variable, `sync.Map`, or struct field. `go vet -lostcancel` flags some related issues; `gosec` and custom analyzers can find context-in-cache patterns.

The fix: extract the *data* you need from the context at the time of caching, not the context itself.

```go
// before (leaks)
cache.Store(id, entry{ctx: ctx, order: o})

// after
cache.Store(id, entry{order: o})
```

To preserve the request ID for later log lines: attach the ID to the cached value, not the context.

**Follow-ups:** How do you verify the fix? (Heap profile, run for an hour, check `*valueCtx` count is bounded by in-flight requests.) Are there ever legitimate reasons to store a context in a non-call-chain location? (`context.AfterFunc` registrations; some library-internal bookkeeping.)

### Q19. Compare the design of `context.WithValue` with hypothetical "shared state via channels" alternatives. Why did Go pick this design?

**Model answer:** Context values exist to solve one specific problem: data that flows down a call chain and is read by many layers. Channels solve a different problem: coordination and message passing between independent goroutines.

You *could* simulate context with channels (a request goroutine listens for "give me the request ID" requests on a channel), but the cost is prohibitive: each lookup is a synchronization event, with select machinery on every call. Context values are read-only field accesses; no synchronization needed after construction.

Channels also do not preserve scope. A goroutine that receives a value from a channel cannot easily pass it on to its children without re-implementing context's chain semantics. Context bakes scope into the data structure.

The two primitives are complementary, not competing. Channels: cross-goroutine communication. Context: per-request scope.

**Follow-ups:** When are channels strictly better? (Producer-consumer pipelines, fan-out/fan-in, signal propagation between unrelated goroutines.) When is context strictly better? (Request-scoped metadata read in many layers.)

### Q20. Design a code-review checklist your team should follow for any PR that uses `context.WithValue`.

**Model answer:**

1. **Key type is unexported.** Private type, defined in the package that owns the value.
2. **Key is not a built-in type.** No `string`, no bare `int`.
3. **Accessor functions exist.** `With(ctx, x)` and `From(ctx)` (or `MustFrom`, `FromOrDefault`). Callers never see `ctx.Value` directly.
4. **The value is request-scoped.** Not a service, not a config, not a connection.
5. **The value is immutable.** Or, if mutable, the mutation is one-shot and synchronized.
6. **No `*sql.DB`, `*http.Client`, or similar in the context.** Wire those through constructors.
7. **Documentation.** A comment near `With` describes what is carried and the lifetime.
8. **Tests.** Unit tests exercise `From` for both present and absent cases.
9. **Hot path check.** No `Value` lookup inside a tight loop without hoisting.
10. **Middleware ordering.** If the new value depends on others (logger depends on request ID), ensure middleware order is correct and tested.

This checklist catches 90% of context-related production bugs.

**Follow-ups:** How would you automate it? (`staticcheck` covers point 2; custom analyzers for points 1, 3, 6.) Should the checklist be CI-blocking? (Points 1 and 2 yes; the rest are guidance for code review.)

---

---

## Rapid Fire Round

A handful of short questions interviewers throw in to test reflexes. The expected answer is one sentence each.

### Q21. What does `context.Background().Value(x)` return for any x?

`nil`.

### Q22. Can a context value be a function?

The key cannot (not comparable). The value can — it is just `any`. Don't.

### Q23. Does `WithValue` need a cancel func?

No.

### Q24. Two `WithValue` calls with the same key — does the outer overwrite the inner?

It shadows it. The inner link is still in memory, but the walk finds the outer first.

### Q25. Is `ctx.Value` safe for concurrent use?

Yes, for the standard library types. Custom contexts must also be safe.

### Q26. What is `staticcheck` rule SA1029?

"Do not use built-in type as context key."

### Q27. Can I attach values across goroutines?

You attach in one goroutine, pass the context to another, and any reader sees the value. Yes.

### Q28. What does `(t *testing.T).Context()` do?

Returns a context canceled when the test ends. New in Go 1.24.

### Q29. If I store a `User{}` value (not pointer), does `ctx.Value(key).(*User)` work?

No. The dynamic type is `User`, not `*User`. The assertion fails.

### Q30. Can I "namespace" multiple context values under one key?

Yes — store a struct with multiple fields under a single key. That is the standard optimization for deep chains.

---

## Closing Note

Context value questions test the breadth of an engineer's Go judgment: API design, lifetime reasoning, anti-pattern recognition, testability. They reward candidates who can articulate not just "what works" but "what the language designers intentionally left out, and why." The cleanest signal in an interview is the answer to "should this go in context or be a parameter?" — wrong answers indicate someone who has not yet absorbed the request-scoped-metadata principle.

Beyond the questions above, expect interviewers to probe the line between context and parameter (Q7, Q11), the line between context and DI (Q12), the rare cases where mutation is acceptable (Q19), and the operational reality of leaks (Q18). Knowing the answers cold is the easy part. Defending them with concrete examples — production failures you have seen, refactors you have led — is what separates good answers from great ones.

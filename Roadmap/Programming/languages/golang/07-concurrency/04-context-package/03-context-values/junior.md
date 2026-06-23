# Context Values — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How do I carry a request ID through every layer of my code without adding it to every function signature?"

A `context.Context` does two jobs. Most of the time you use the first one — cancellation and deadlines. The second one is what this page is about: **carrying request-scoped values** down a call chain.

```go
ctx := context.WithValue(parent, requestIDKey, "req-7c4f")
```

That line attaches `"req-7c4f"` to the context under the key `requestIDKey`. Anywhere downstream that receives this context, or any context derived from it, can ask:

```go
id, ok := ctx.Value(requestIDKey).(string)
```

and get the request ID back.

This sounds powerful. It is also dangerous. `context.WithValue` is the most misused part of the `context` package — more than goroutines and channels combined. New Go programmers reach for it as a replacement for function arguments, for global variables, for dependency injection, for caches. It is none of those things. It is a narrow tool for one specific job: passing **data that conceptually belongs to a single request** through code that has no other reason to know about that data.

After reading this file you will:

- Know exactly when `context.WithValue` is the right choice and when it is not.
- Understand the unexported-key-type idiom — the most common interview question on this topic.
- Be able to write a type-safe accessor pair (`WithUser` / `UserFromContext`).
- Recognise stringly-typed keys and the bugs they cause.
- Know that lookup is a linear walk, and how that shapes good design.
- Understand why Go intentionally has no goroutine-local storage.

You do not need to read the internals of `valueCtx` for this level. We will save the linked-list lookup details for the senior and professional pages. But you do need to internalise the rule that decides everything else: **use a value for data that flows with the request, not for data that the function actually needs.**

---

## Prerequisites

- **Required:** You can write and run a basic Go program with `go run`.
- **Required:** You know what `context.Context` is — that it has `Done()`, `Err()`, `Deadline()`, and `Value()` methods. Read the [Deadlines and Cancellations](../01-deadlines-and-cancellations/) section first if you have not.
- **Required:** Familiarity with type assertions: `v, ok := x.(SomeType)`.
- **Required:** Comfort with interfaces and the empty interface `any`.
- **Helpful:** Some experience writing HTTP middleware in any language.
- **Helpful:** Awareness of dependency injection. Even informal DI (passing a logger as a constructor argument) is enough.

If you can compile `package main` with a `context.Background()` call and read its docs, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`context.WithValue`** | Constructor that returns a new context with one (key, value) attached. Does not introduce cancellation. |
| **`ctx.Value(key)`** | Method that walks the context chain looking for the given key. Returns `nil` if not found. |
| **Request-scoped value** | A piece of data whose lifetime matches a single request: request ID, trace ID, authenticated user, locale. Not configuration, not connections, not optional parameters. |
| **Key type** | A private, comparable type used as the lookup key for `WithValue`. By convention an empty struct or a typed int. |
| **String key** | Anti-pattern: using a `string` literal as the key. Causes collisions across packages. Flagged by `go vet` and `staticcheck`. |
| **Type-safe accessor** | A package-level function like `UserFromContext(ctx) (User, bool)` that hides the key and the type assertion. |
| **Goroutine-local storage (GLS)** | A feature of languages like Java (`ThreadLocal`) where each thread has its own keyed storage. Go does not have this. Context values are the closest analogue, but they are explicit, not implicit. |
| **Linear lookup** | `ctx.Value(key)` walks the chain of contexts one parent at a time. Cost is O(depth). |
| **`valueCtx`** | Internal struct in `src/context/context.go` that holds one key, one value, and embeds the parent context. |
| **Middleware** | A higher-order function in HTTP/gRPC servers that wraps a handler. Often the place where values are added to the context. |
| **`Comparable`** | A property of Go types defined by the language spec. Slices, maps, and functions are not comparable; structs of comparable fields are. |
| **`go vet -lostcancel`** | A vet check unrelated to values but commonly seen alongside `WithValue` discussions because of the surrounding context discipline. |
| **`SA1029`** | `staticcheck` rule: "do not use built-in type as context key." |

---

## Core Concepts

### A value is a piece of data attached to a context

When you call:

```go
ctx2 := context.WithValue(ctx1, key, val)
```

you get a new context, `ctx2`, that **wraps** `ctx1`. Calling `ctx2.Value(key)` returns `val`. Calling `ctx2.Value(anyOtherKey)` delegates to `ctx1.Value(anyOtherKey)`. The other methods (`Done`, `Err`, `Deadline`) pass straight through.

This is important: `ctx2` is a *different object* from `ctx1`. The original `ctx1` does not change — it does not learn about the new value. The value only exists in the new chain.

```go
ctx1 := context.Background()
ctx2 := context.WithValue(ctx1, key, "hello")

fmt.Println(ctx1.Value(key)) // <nil>
fmt.Println(ctx2.Value(key)) // hello
```

### `WithValue` does not introduce cancellation

A common confusion: people assume `WithValue` returns something they need to "cancel" or "release." It does not. There is no `cancel` function. The lifetime of the value is exactly the lifetime of the chain — when nothing references the context anymore, the garbage collector reclaims it.

This is why the signature is:

```go
func WithValue(parent Context, key, val any) Context
```

A single return value. No cleanup. No defer needed.

### The chain is one-way and immutable

You cannot delete a value from a context. You cannot mutate the (key, value) cell once it is attached. The only way to "remove" a value is to stop using the chain that has it.

This is also why repeating `WithValue` with the same key does not overwrite — it adds another link. The outer link wins on lookup because the walk starts from the deepest child.

```go
ctx := context.Background()
ctx = context.WithValue(ctx, key, "first")
ctx = context.WithValue(ctx, key, "second")
fmt.Println(ctx.Value(key)) // second
```

Both "first" and "second" still exist in memory until the chain is dropped. The lookup just finds "second" first.

### Keys must be comparable

`WithValue` panics if you give it a key whose dynamic type is not comparable. The Go runtime needs to compare keys with `==` during lookup. Slices, maps, and functions are not comparable. Most concrete types are.

In practice you never use a slice or a map as a key. The idiomatic key is so small and specific that comparability is a non-issue.

### Lookup is a linear walk

`ctx.Value(key)` looks like a map lookup, but under the hood it is closer to walking a linked list:

```
ctx3 → ctx2 → ctx1 → ctx0 (Background)
```

If `ctx3` was created by `WithValue(ctx2, kA, vA)` and you call `ctx3.Value(kB)`, the runtime checks `ctx3`'s own key (no match), then asks `ctx2`, then `ctx1`, then `ctx0`. The cost is O(depth). In normal applications the depth is small (3 to 10 hops), so the cost is negligible. We will revisit this at senior and professional levels.

### The unexported key type idiom

If you take one thing away from this page, take this:

```go
type ctxKey int

const (
    requestIDKey ctxKey = iota
    userKey
    traceIDKey
)
```

The type `ctxKey` is unexported. Even if another package wanted to use the same `int` value, its key would have a different type and would not collide. This is the **only** reliable way to keep keys from clashing across libraries that share a context.

A simpler form is an empty struct per key:

```go
type requestIDKey struct{}
type userKey struct{}

ctx = context.WithValue(ctx, requestIDKey{}, id)
```

Either form is fine. Both are idiomatic. Never use a bare `string` or `int`.

---

## Real-World Analogies

### A name tag at a conference

Imagine a conference where every attendee wears a lanyard with a name tag. Anyone they meet can read the tag and learn their name. The tag stays with them all day, through every conversation. They didn't bring the tag with them on purpose to each meeting — they put it on once at registration, and it flows naturally through the day.

`context.WithValue` is the lanyard. The request ID is the name tag. Every function downstream can read it without anyone passing it explicitly.

### A return-address sticker on a parcel

A parcel travels through a postal network. At every depot, every truck, every conveyor belt, the same return-address sticker stays glued to the box. No one had to attach it again at each step. The sticker is request-scoped: it belongs to *this* parcel, not to the post office or the trucks.

A request ID in context is the same idea. Once stuck on, it travels everywhere with the request.

### Not a backpack

The tempting analogy is "context is a backpack — I can put anything in it." This is wrong. Context is a name tag, not a backpack. You do not pack tools into it. You pack identifying labels. Tools (the database handle, the logger) go in your hands (parameters) or your office (struct fields), not on your lanyard.

### Not a clipboard

Context is also not a clipboard that picks up notes as you walk. You cannot mutate a value in context. You attach a new one and the new one shadows the old.

---

## Mental Models

### Mental model 1: a one-way name tag, not a parameter bag

When you ask "should this go on the context?" the test is: **does the called function care that this thing is there, or is it just passing through?** A request ID is something every layer might log but most layers don't care about — it passes through. A user ID for the authorization check in the handler is something the handler *cares about* — pass it as a parameter.

### Mental model 2: an invisible side-channel

The context is the request's side-channel. Visible code carries the explicit data (URL, body, query params). The context carries the implicit metadata (request ID, trace ID, deadline). Treat context values as part of the **infrastructure layer**, not the business layer.

### Mental model 3: a linked list

```
WithValue("ip", "1.2.3.4")
   ↓
WithValue("user", u)
   ↓
WithValue("trace", t)
   ↓
Background
```

Each `WithValue` adds a link. `Value(key)` walks from the bottom up. Knowing this mental model prevents you from creating depth-50 chains in inner loops.

### Mental model 4: scoped, not global

Globals leak across requests. Context values are scoped — they exist for one request and disappear when the request ends. If you find yourself reaching for a global because "this needs to be available everywhere," ask if a request-scoped context value is closer to what you actually want.

### Mental model 5: explicit absence

If `ctx.Value(key)` returns `nil`, that is a fact about your code's structure, not a runtime error. Either no one along the chain added the value, or you used the wrong key. Treat the `nil` like a missing function argument: the caller forgot to set it.

---

## Pros & Cons

### Pros

1. **No plumbing through every function** — a request ID can flow from the HTTP layer to the database layer without each intermediate function declaring it.
2. **Standard interface** — every library that respects `context.Context` automatically has access. Telemetry libraries (OpenTelemetry, Datadog) rely on this.
3. **Lifetime is automatic** — values die with the request. No `defer cleanup()`.
4. **Compatible with cancellation** — the same context that carries the deadline also carries the request ID.
5. **Forces request scoping** — a context-scoped value cannot accidentally leak to a different request.

### Cons

1. **Type-unsafe at the boundary** — `Value` returns `any`. Every reader must type-assert.
2. **Easy to misuse** — looks like a global dictionary, but is not meant to be one.
3. **Untyped key collisions** — if you use a `string` key, another library can step on you silently.
4. **Linear lookup** — depth-10 chain with a missing key walks 10 hops.
5. **Hidden dependencies** — a function that pulls a logger out of context has a dependency that does not show up in its signature. Hard to test, hard to refactor.
6. **No removal** — once added, always there until the chain is dropped.

The cons dominate when misused. The pros dominate when used for exactly the kind of data it was designed for.

---

## Use Cases

### Good uses

- **Request ID / correlation ID** — a string attached at the edge, logged everywhere.
- **Trace ID / span context** — distributed tracing carries this through every API call.
- **Authenticated principal** — the verified user identity, attached by auth middleware.
- **Tenant ID** — in multi-tenant systems, the tenant the request belongs to.
- **Locale / language tag** — request-scoped i18n state.
- **Pprof labels** — `runtime/pprof` uses context for goroutine labeling.
- **A logger pre-configured with request fields** — a `*slog.Logger` already enriched with request_id, user_id, route.

### Bad uses

- **A database handle** — should be a parameter or a struct field. Lives longer than a single request.
- **Configuration** — `Config` is application-scoped, not request-scoped.
- **A function's actual argument** — if the function uses it, it should be in the signature.
- **A retry counter / mutable state** — context values are not for evolving state.
- **A response writer** — pass it explicitly; do not hide it.
- **Anything large** — pulling 50 MB through the context tree extends its lifetime to the chain's lifetime.

The rule of thumb: **if you cannot answer "this is request-scoped metadata" with a yes, do not put it on the context.**

---

## Code Examples

### Example 1: attach and read a request ID

```go
package main

import (
    "context"
    "fmt"
)

type ctxKey int

const requestIDKey ctxKey = iota

func main() {
    ctx := context.Background()
    ctx = context.WithValue(ctx, requestIDKey, "req-7c4f")

    handle(ctx)
}

func handle(ctx context.Context) {
    id, ok := ctx.Value(requestIDKey).(string)
    if !ok {
        fmt.Println("no request id")
        return
    }
    fmt.Println("handling:", id)
}
```

Output:

```
handling: req-7c4f
```

The key observations:

- The key type `ctxKey` is package-private.
- The constant `requestIDKey` is also unexported. If `handle` were in another package, we would expose a getter, not the key itself.
- Reading uses the comma-ok form: `id, ok := ctx.Value(requestIDKey).(string)`. The `ok` tells you whether the value was present *and* of the expected type.

### Example 2: type-safe accessor functions

```go
package reqid

import "context"

type ctxKey struct{}

var key = ctxKey{}

// With returns a new context carrying id.
func With(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, key, id)
}

// From returns the request id and whether it was present.
func From(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(key).(string)
    return id, ok
}
```

Usage:

```go
ctx := reqid.With(context.Background(), "req-7c4f")
if id, ok := reqid.From(ctx); ok {
    log.Printf("id=%s", id)
}
```

Now the key is private, the type is enforced, and callers never see `any`.

### Example 3: middleware adding a request ID

```go
package main

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "log"
    "net/http"
)

type ctxKey struct{}

var requestIDKey = ctxKey{}

func newRequestID() string {
    var b [8]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}

func withRequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = newRequestID()
        }
        ctx := context.WithValue(r.Context(), requestIDKey, id)
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func handler(w http.ResponseWriter, r *http.Request) {
    id, _ := r.Context().Value(requestIDKey).(string)
    log.Printf("id=%s path=%s", id, r.URL.Path)
    w.Write([]byte("ok"))
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", withRequestID(mux)))
}
```

Every handler downstream can pull the ID out without anyone passing it explicitly.

### Example 4: an authenticated user

```go
package auth

import "context"

type User struct {
    ID    string
    Email string
}

type ctxKey struct{}

var userKey = ctxKey{}

func WithUser(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, userKey, u)
}

func UserFromContext(ctx context.Context) (User, bool) {
    u, ok := ctx.Value(userKey).(User)
    return u, ok
}
```

A handler that needs the user does:

```go
u, ok := auth.UserFromContext(r.Context())
if !ok {
    http.Error(w, "unauthorized", http.StatusUnauthorized)
    return
}
fmt.Fprintf(w, "hello %s", u.Email)
```

### Example 5: what happens if the key is wrong

```go
type rightKey struct{}
type wrongKey struct{}

ctx := context.WithValue(context.Background(), rightKey{}, "hello")

v := ctx.Value(wrongKey{}) // nil — different type, not equal
fmt.Println(v)             // <nil>
```

This is why a private type matters: another package's `rightKey{}` is a different type from yours, so collisions are impossible even when names match.

### Example 6: what happens with string keys

```go
ctx := context.WithValue(context.Background(), "user", "alice")

// Some other library, somewhere else:
ctx = context.WithValue(ctx, "user", 42)

v := ctx.Value("user") // 42 — the second WithValue shadowed the first
```

This silent shadowing is why string keys are forbidden in good Go code.

### Example 7: storing a logger

```go
package logctx

import (
    "context"
    "log/slog"
)

type ctxKey struct{}

var loggerKey = ctxKey{}

func With(ctx context.Context, l *slog.Logger) context.Context {
    return context.WithValue(ctx, loggerKey, l)
}

func From(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}
```

Note the fallback to `slog.Default()` — `From` never returns nil. This is a small but important convenience: callers don't have to check.

---

## Coding Patterns

### Pattern 1: package per concern

A clean codebase has one small package per kind of context value:

```
internal/
  reqid/   — request IDs
  authctx/ — authenticated user
  tracectx/ — trace IDs
  logctx/  — request logger
```

Each package exports two functions: `With(ctx, x) context.Context` and `From(ctx) (x, bool)`. The key type and the key itself are private. No other code in the repo touches them.

### Pattern 2: never expose the key

The temptation: "I'll expose `UserKey` so other packages can read it." Resist. Once `UserKey` is exported, you lose the safety of the unexported type. Always expose accessor functions instead.

### Pattern 3: never store cancel funcs in context

You might be tempted to `WithValue(ctx, "cancel", cancelFn)`. Don't. `cancel` belongs to the goroutine that holds the deadline, not to the call tree. If you find yourself wanting this, restructure.

### Pattern 4: layer accessors on top of `Value`

For complex types (a `*slog.Logger`, an OpenTelemetry `Tracer`), the accessor often does more than a type assertion:

```go
func Logger(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
        return l
    }
    return slog.Default() // safe fallback
}
```

This guarantees the call site never crashes on a missing value.

### Pattern 5: build the request context once, at the edge

Add request-scoped values at the edge of the system — usually middleware. Do not sprinkle `WithValue` calls throughout business logic. The flow looks like:

```
incoming request
   ↓
middleware: add request ID, user, trace ID, logger
   ↓
handler
   ↓
business code (reads from ctx via accessors)
   ↓
database / RPC (passes ctx along)
```

### Pattern 6: pass `ctx` first

Every function that uses a context takes it as the first parameter, named `ctx`:

```go
func Save(ctx context.Context, item Item) error
```

This convention is non-negotiable in idiomatic Go. `go vet` and most linters check it.

---

## Clean Code

### Name the key after the value it carries

A package's key constant should be named for what it carries:

```go
const requestIDKey ctxKey = iota // good
const k1 ctxKey = iota           // bad
```

### One key per package, when possible

If a single package owns a "request" namespace, define one key type and one `iota` block:

```go
type ctxKey int

const (
    requestIDKey ctxKey = iota
    userKey
    traceIDKey
)
```

Cleaner than three separate types.

### Hide the assertion in an accessor

Never expose `Value` to call sites:

```go
// bad
id := ctx.Value(reqid.Key).(string)

// good
id, _ := reqid.From(ctx)
```

The accessor isolates the assertion so a future refactor (changing the stored type from `string` to a `Request{ID string}` struct) needs one change, not many.

### Comment the contract

```go
// WithUser attaches u to ctx. The user is available via UserFromContext
// for the duration of the request.
func WithUser(ctx context.Context, u User) context.Context { ... }
```

### Use `any` only at the interface

Inside your package, work in concrete types:

```go
// bad — leaks any to callers
func With(ctx context.Context, v any) context.Context { ... }

// good
func WithUser(ctx context.Context, u User) context.Context { ... }
```

---

## Product Use / Feature

### Distributed tracing

Every request crosses microservices. Each service must continue the trace started upstream. The trace context (trace ID, parent span ID) flows through HTTP headers and lives in the request's `context.Context` for the duration of in-process work. OpenTelemetry's Go SDK does exactly this.

### Tenant isolation

In a SaaS product, every request belongs to a tenant. Auth middleware decodes the JWT, finds the tenant, and attaches it to the context:

```go
ctx = tenantctx.With(ctx, t)
```

Database queries built deeper in the stack pull the tenant out and apply a row-level filter. The tenant is not a function argument because almost every function needs it; making it explicit everywhere is noise.

### Audit logging

Every action in a regulated system must log who did it, when, and why. A `*slog.Logger` pre-filled with `actor=alice action=POST /payments correlation_id=...` lives in the context. Code that performs the action calls `logctx.From(ctx).Info("payment created")` without reassembling the fields.

### Feature flags scoped to a request

A feature flag that depends on the requesting user (A/B test) can be evaluated once at the edge and attached as a context value, so every downstream check is a constant-time lookup rather than a re-evaluation.

---

## Error Handling

### `Value` cannot return an error

`Value` returns `any`. If it returns `nil`, that is the "missing" signal. There is no `error` channel for this lookup. Accessor functions encode the absence as a `bool`:

```go
u, ok := UserFromContext(ctx)
if !ok {
    return ErrUnauthenticated
}
```

### A missing value is usually a programmer error

If `UserFromContext` returns `ok == false` deep inside a request handler that *requires* a user, the bug is upstream — the auth middleware did not run, or it failed silently. Treat `!ok` as "the system is misconfigured" rather than "the request was bad."

### Defensive accessors

For optional values, prefer a fallback over `bool`:

```go
func Logger(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}
```

For required values, propagate the absence as an error:

```go
func UserFromContext(ctx context.Context) (User, error) {
    u, ok := ctx.Value(userKey).(User)
    if !ok {
        return User{}, ErrNoUser
    }
    return u, nil
}
```

Pick one style per accessor, consistently.

### Don't panic from accessors

A library-grade accessor should never panic, even on `nil` context. (Although passing `nil` is itself a bug.)

---

## Security Considerations

### Do not store secrets in context

A request-scoped JWT is fine; an unencrypted credit-card number is not. Anything in the context can be reached by any code path the request touches. If a piece of data is sensitive, treat the context as a wide-reach surface and minimise what you put on it.

### Do not blindly trust upstream headers

A request ID generated by a client (via `X-Request-ID`) might be a long, weird, malicious string. Middleware that copies headers into context should validate or sanitize them:

```go
id := r.Header.Get("X-Request-ID")
if !isSafeID(id) {
    id = newRequestID()
}
ctx = context.WithValue(r.Context(), requestIDKey, id)
```

Otherwise an attacker can inject newline characters into your logs.

### Authentication boundary

The authenticated user attached to the context is *trusted code's* claim. Make sure the middleware that attaches it does the actual verification. Do not put a "claimed user" in context before verification; downstream code might forget to check.

### Avoid leaking PII through traces

Trace IDs flow to third parties (Datadog, Honeycomb). The user's actual email or name should not be in span attributes derived from context unless you know your tracing backend handles PII properly.

---

## Performance Tips

### Keep chains shallow

Each `WithValue` adds a link. Each `Value` call walks the chain. In a typical request the depth is 3 to 10 hops — negligible. If you find yourself looking up the same key in a tight loop, hoist the lookup:

```go
// bad
for _, item := range items {
    log := logctx.From(ctx) // walks the chain every iteration
    log.Info("item", "id", item.ID)
}

// good
log := logctx.From(ctx) // once
for _, item := range items {
    log.Info("item", "id", item.ID)
}
```

### Prefer one key per package, not many

A package with five separate `WithValue` calls forces a five-hop chain. Often you can group related fields into a single struct and store one value:

```go
type RequestMeta struct {
    ID     string
    User   User
    Locale string
}
```

One `WithValue`, one walk hop, three fields.

### Avoid `Value` in hot paths

If a function is on a tight per-allocation path (a database row scanner, a serializer), do not call `ctx.Value` per call. Extract the value once and pass it explicitly.

### Do not store large values

Storing a 10 MB byte slice in context keeps it alive for the entire request. Pass it as a parameter so it can be released when the function returns.

---

## Best Practices

1. **Use the unexported key type idiom.** Always.
2. **Expose accessor functions, never keys.**
3. **Put request-scoped data only.** Not parameters, not config, not state.
4. **Add values at the edge.** Middleware adds; business logic reads.
5. **One key per concept, one package per concern.**
6. **Pass `ctx` as the first parameter named `ctx`.**
7. **Document what a key carries** in a comment near the constructor function.
8. **Never store a cancel function** in context.
9. **Never store a database connection** in context.
10. **Run `go vet` and `staticcheck`** — they catch most key-related mistakes.

---

## Edge Cases & Pitfalls

### Storing a `nil` value

```go
var u *User // nil
ctx = context.WithValue(ctx, userKey, u)

v, ok := ctx.Value(userKey).(*User)
fmt.Println(v, ok) // <nil> true
```

`ok` is `true` because the stored value *was* a `*User`, even though that pointer was nil. This is a footgun. The fix: check for `nil` separately.

### Passing `nil` as the parent context

```go
ctx := context.WithValue(nil, key, val) // PANIC
```

The package documentation prohibits this; the runtime enforces it with a panic.

### Using a non-comparable key

```go
type Bad struct {
    s []string
}

ctx := context.WithValue(context.Background(), Bad{}, "x") // panic
```

`Bad` contains a slice, so it is not comparable. The runtime panics on insert.

### Shadowing without realising

```go
ctx = context.WithValue(ctx, userKey, alice)
ctx = context.WithValue(ctx, userKey, bob)
// alice is still in the chain, but bob shadows her.
```

If two pieces of code each add the same key (e.g., auth middleware and a test fixture), the outer one wins. Inspect your middleware order.

### Reusing a context across goroutines

Context values are safe to read from many goroutines. **Mutating a value retrieved from context is your problem.** If the value is a `*sync.Map` or a struct with mutexes, fine. If it is a plain map, two goroutines racing on it will produce undefined behaviour.

### Forgetting that values survive cancellation

`ctx.Done()` closing does not erase values. A canceled context still answers `Value` correctly. Code that runs after cancellation (cleanup, logging) can still read the request ID.

### Empty struct keys with the same name in different packages

```go
// package a
type ctxKey struct{}
// package b
type ctxKey struct{}
```

These are different types. Putting `a.ctxKey{}` and `b.ctxKey{}` in the same context does not collide. Good.

But: if you copy-paste the *same* package twice (vendored differently), each copy has its own `ctxKey{}` type. Cross-vendor lookups will not find each other. This is why minimum-vendoring of small utility packages matters.

---

## Common Mistakes

1. **Stringly-typed keys.** `context.WithValue(ctx, "user", u)` — silent collision risk, flagged by `SA1029`.
2. **Bare integer keys.** Same problem.
3. **Exporting the key.** Once exported, anyone can read and write under it.
4. **Storing parameters in context.** "It's used by every layer, let's put it in context." If every layer *uses* it (not just logs it), parameter is correct.
5. **Storing services in context.** The `*sql.DB` is application-scoped, not request-scoped. Wire it in via constructors.
6. **Mutating shared values.** A `map[string]string` retrieved from context will race if two goroutines write to it.
7. **Forgetting the type assertion.** `ctx.Value(key).(string)` panics if the value is not a string. Always use `, ok`.
8. **Putting `cancel` in context.** Cancel functions are owned by the goroutine that created the context.
9. **Long chains.** Twenty `WithValue` calls makes lookups slow and reads confusing.
10. **Calling `Value` in a tight loop.** Hoist it.

---

## Common Misconceptions

### "Context values are like Java's `ThreadLocal`."

No. `ThreadLocal` is implicit and tied to the thread. Context values are explicit and tied to the context object you carry around. Go's runtime intentionally has no concept of "current goroutine state" — every value is a function argument or a context value.

### "WithValue replaces a global."

Only if the global is request-scoped. If the value lives longer than a request, a global or DI is closer to right.

### "Context is for dependency injection."

It is not. DI tools wire long-lived dependencies (databases, loggers, clients). Context carries request data. A logger pre-filled with request fields can live in context; the logger *factory* does not.

### "I should put my retry counter in context."

No — that is mutable state. Context values are immutable. Use a struct field, a closure, or an explicit parameter.

### "Context is slow."

`Value` is a linear walk. At depth 5 that is roughly five pointer comparisons and five method dispatches — nanoseconds. The only time it matters is in hot inner loops, which is solved by hoisting.

### "I need a global context."

Whenever you reach for `var globalCtx context.Context`, stop. The right shape is to thread a context into the goroutines that need it, often built from `context.Background()` at `main`.

---

## Tricky Points

### `ctx.Value(key)` can return `nil` for two reasons

It can be nil because the key was never set, or because someone explicitly set the value to a `nil` interface. The comma-ok form distinguishes them only if you assert to a concrete type.

### Same `iota` block, different positions

```go
type ctxKey int
const (
    a ctxKey = iota
    b
    c
)
```

If you reorder these, the underlying integer changes. That is fine inside one binary, but if you somehow share values across binaries through serialization, the indices will not match. The type system protects you within a binary.

### Equality of struct keys

`type k struct{}` is comparable. `k{} == k{}` is true. Useful as a zero-allocation key.

### Pointer keys

```go
var key = &struct{}{}

ctx := context.WithValue(parent, key, "val")
```

`key` is a unique pointer, comparable by identity. Some libraries do this. It works, but adds an allocation at package init. The empty-struct variant is more idiomatic.

### `Value` walks even through cancelable contexts

A `cancelCtx` or `timerCtx` in the middle of the chain still answers `Value` by delegating to its parent. Cancellation does not block lookup.

### Custom `Context` types

If you implement `Context` yourself (rare), your `Value` method must delegate up the chain. Forgetting to do so makes downstream lookups silently fail.

---

## Test

You can test context-value flow like any other code. Build a context, pass it to the function, assert behaviour.

```go
func TestUserFromContext(t *testing.T) {
    ctx := context.Background()
    u := User{ID: "u-1"}
    ctx = WithUser(ctx, u)

    got, ok := UserFromContext(ctx)
    if !ok {
        t.Fatal("expected user, got none")
    }
    if got != u {
        t.Errorf("got %v, want %v", got, u)
    }
}

func TestUserFromContext_missing(t *testing.T) {
    _, ok := UserFromContext(context.Background())
    if ok {
        t.Error("expected ok=false for empty context")
    }
}
```

### Test middleware that adds values

```go
func TestRequestIDMiddleware(t *testing.T) {
    var captured string

    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        captured, _ = r.Context().Value(requestIDKey).(string)
        w.WriteHeader(200)
    })

    srv := httptest.NewServer(withRequestID(handler))
    defer srv.Close()

    resp, err := http.Get(srv.URL)
    if err != nil {
        t.Fatal(err)
    }
    resp.Body.Close()

    if captured == "" {
        t.Error("middleware did not attach request id")
    }
}
```

### Test for absence

```go
func TestLogger_fallback(t *testing.T) {
    l := Logger(context.Background())
    if l == nil {
        t.Fatal("Logger must never return nil")
    }
}
```

---

## Tricky Questions

**Q: If I call `WithValue` twice with the same key on the same parent, what does the resulting context return for that key?**

It returns the value from the most recent (outermost) `WithValue`. Both links exist; the walk just finds the outermost first.

**Q: Can I read a context value from a goroutine other than the one that set it?**

Yes. Contexts are safe for concurrent reads. Just be sure the *value* itself is safe to share (immutable or synchronized).

**Q: Does `context.WithCancel(ctx)` preserve values added to `ctx`?**

Yes. Every derived context delegates `Value` up the chain. Cancellation contexts wrap and pass through.

**Q: What does `context.Background().Value(anyKey)` return?**

Always `nil`. `Background` and `TODO` are empty.

**Q: Can my key be a function?**

No. Functions are not comparable. The runtime panics.

**Q: Can my key be an interface?**

Yes, if the dynamic type behind it is comparable. The comparison uses both type and value. But this is rarely a good idea — define a private struct instead.

**Q: Why isn't there a `context.RemoveValue`?**

The contract is that contexts are immutable. The way to "remove" is to use a context that does not have the value — typically by deriving a new chain from a point upstream.

**Q: Why does Go not have goroutine-local storage?**

Deliberate choice. GLS hides dependencies, makes testing hard, breaks when goroutines spawn helpers, and confuses lifetime analysis. Explicit context passing is the Go answer.

---

## Cheat Sheet

```go
// 1. Define a private key type (per package).
type ctxKey int

const (
    requestIDKey ctxKey = iota
    userKey
)

// 2. Add a value.
ctx = context.WithValue(ctx, requestIDKey, "req-7c4f")

// 3. Read it via an accessor.
func RequestIDFromContext(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(requestIDKey).(string)
    return id, ok
}

// 4. Use the comma-ok form. Always.
id, ok := RequestIDFromContext(ctx)
```

**Do**

- Use a private key type.
- Expose accessor functions.
- Add values at the edge of the system.
- Pass `ctx` as the first parameter.
- Keep values small and immutable.

**Don't**

- Use `string` or bare `int` keys.
- Export key constants.
- Store function parameters in context.
- Store database handles, services, or config.
- Mutate values retrieved from context.

---

## Self-Assessment Checklist

- [ ] I can name the four methods of `context.Context`.
- [ ] I know what `WithValue` returns and that there is no cancel func.
- [ ] I can write a private key type and a pair of accessor functions.
- [ ] I can explain why string keys are forbidden.
- [ ] I can describe how `Value` walks the chain.
- [ ] I can list three good uses and three bad uses of context values.
- [ ] I know that Go has no goroutine-local storage by design.
- [ ] I can write middleware that attaches a request ID.
- [ ] I can write tests that build a context and verify accessor output.
- [ ] I know that `Value` lookups are O(depth) and how to hoist them.

---

## Summary

`context.WithValue` is a narrow, deliberate tool for carrying request-scoped metadata through a call tree. Used well — with private key types, accessor functions, and discipline — it removes plumbing without hiding dependencies. Used badly — with string keys, exported globals, and mutable state — it produces a hidden, untyped dictionary that breaks at runtime.

The rule that captures all of this: **values for metadata that flows with the request, parameters for everything the function actually needs.**

If you remember the unexported key type idiom, the accessor pattern, and the "metadata, not arguments" rule, you have already learned the parts that go wrong in production.

---

## What You Can Build

Once you understand context values you can build:

- **Request ID middleware** that stamps every log line and HTTP response with a correlation ID.
- **Authenticated user middleware** that decodes a JWT once and exposes a typed `User` to handlers.
- **A request-scoped logger** pre-filled with route, method, user, request ID.
- **Tenant-aware database access** where every query is filtered by the tenant attached to the context.
- **Distributed tracing instrumentation** that pulls span context from incoming headers, attaches it, and propagates it to downstream RPCs.
- **Audit-logging frameworks** where the "actor" is implicit.

---

## Further Reading

- Go package: `context` — https://pkg.go.dev/context
- Go blog: *Go Concurrency Patterns: Context* — https://blog.golang.org/context
- Go source: `src/context/context.go` (look for `valueCtx`)
- `staticcheck` rule SA1029 — https://staticcheck.dev/docs/checks/#SA1029
- OpenTelemetry Go: how `context.Context` carries spans — https://pkg.go.dev/go.opentelemetry.io/otel/trace
- Dave Cheney, *Context isn't for cancellation* (and its follow-ups) — short, sharp posts on the API surface
- *Go Proverbs*, Rob Pike — "Don't communicate by sharing memory; share memory by communicating."

---

## Related Topics

- [Deadlines and Cancellations](../01-deadlines-and-cancellations/) — the other half of the context API
- [Common Use Cases](../02-common-usecases/) — context in HTTP, gRPC, and databases
- [Context Tree](../04-context-tree/) — how parent/child relationships compose
- [Context Internals](../05-context-internals/) — the `valueCtx`, `cancelCtx`, and `timerCtx` types
- [Channels](../../02-channels/) — the other Go primitive for cross-goroutine communication
- [Goroutines Overview](../../01-goroutines/01-overview/) — what a context is for in the first place

---

## Diagrams & Visual Aids

### The value chain

```
ctx.Value(traceIDKey)
        │
        ▼
┌──────────────────────┐
│ valueCtx             │  key=loggerKey, val=*slog.Logger
│ parent ──┐           │
└──────────┼───────────┘
           ▼
┌──────────────────────┐
│ valueCtx             │  key=userKey, val=User{...}
│ parent ──┐           │
└──────────┼───────────┘
           ▼
┌──────────────────────┐
│ valueCtx             │  key=traceIDKey, val="trace-abc"  ← match!
│ parent ──┐           │
└──────────┼───────────┘
           ▼
┌──────────────────────┐
│ cancelCtx            │
│ parent ──┐           │
└──────────┼───────────┘
           ▼
┌──────────────────────┐
│ emptyCtx (Background)│
└──────────────────────┘
```

The walk starts at the call site's context and proceeds toward `Background`. The first matching key wins.

### Middleware composition

```
HTTP request
     │
     ▼
[withRecover]
     │
     ▼
[withRequestID]   ← adds requestIDKey
     │
     ▼
[withTracing]     ← adds traceIDKey, spanCtxKey
     │
     ▼
[withAuth]        ← adds userKey
     │
     ▼
[withLogger]      ← adds loggerKey (pre-filled with above)
     │
     ▼
business handler  ← reads via accessors
```

Each middleware wraps the next and decorates the context once.

### Good vs bad shapes

```
GOOD                             BAD
────                             ───
ctx with: requestID,             ctx with: requestID, db, config,
          userID,                          retryCount, responseWriter,
          traceID,                          tempBuffer, callback,
          locale.                           dbResultCache, ...

Small, named, request-scoped.    Sprawling, mutable, untyped.
```

The good shape stays narrow over time. The bad shape grows until no one remembers what is in it.

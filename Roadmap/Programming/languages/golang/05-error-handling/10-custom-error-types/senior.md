# Custom Error Types — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Public vs Private Error Types](#public-vs-private-error-types)
3. [Versioning Error Types in a Stable API](#versioning-error-types-in-a-stable-api)
4. [Error Registries and Catalogs](#error-registries-and-catalogs)
5. [JSON Marshalling — The Right Way and the Pitfall](#json-marshalling--the-right-way-and-the-pitfall)
6. [Redaction and Sensitive Fields](#redaction-and-sensitive-fields)
7. [Cross-Service Error Contracts](#cross-service-error-contracts)
8. [Distributed Tracing and Error Correlation](#distributed-tracing-and-error-correlation)
9. [Testing Custom Error Types Thoroughly](#testing-custom-error-types-thoroughly)
10. [Designing for Library Authors](#designing-for-library-authors)
11. [Migration: From `fmt.Errorf` Soup to a Typed Catalog](#migration-from-fmterrorf-soup-to-a-typed-catalog)
12. [Common Senior Mistakes](#common-senior-mistakes)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction
> Focus: API design. The error type is part of your public surface — treat it that way.

By senior level the small-scale questions are settled: you implement `Error()`, choose pointer receivers, wire up `Is`/`As`, and add `Unwrap`. The remaining questions are architectural. Should the type be exported? How does it survive a v2? How do we marshal it across a network without leaking? How do five teams using your library agree on what an error means?

This file is about the design of an **error contract**: the part of your API your callers depend on for *failure* behavior, the same way they depend on signatures for *success*. A good contract is small, stable, observable, and hard to misuse. A bad one — leaking internal types, expanding exhaustive switches in callers' code, marshalling internal fields by accident — pollutes every system that imports your package.

---

## Public vs Private Error Types

Two competing philosophies:

### Philosophy A — Export the type

```go
package store

type NotFoundError struct{ ID int }

func (e *NotFoundError) Error() string { return fmt.Sprintf("id %d not found", e.ID) }
```

Callers can do `errors.As(err, &nf)` and read `nf.ID`. Powerful. But every exported field is now part of your API.

### Philosophy B — Hide the type, expose a behavior

```go
package store

var ErrNotFound = errors.New("not found")

type notFoundError struct{ id int }   // unexported
func (e *notFoundError) Error() string { return fmt.Sprintf("id %d not found", e.id) }
func (e *notFoundError) Is(t error) bool { return t == ErrNotFound }
func (e *notFoundError) NotFoundID() int { return e.id }
```

Callers detect with `errors.Is(err, ErrNotFound)`. They get the ID through a *method* — `NotFoundID()` — which is a smaller surface area than a struct. You can change the struct freely.

**Recommendation for libraries:** prefer Philosophy B. Sentinels for category, methods for data, type unexported. The cost is one extra method per field; the win is freedom to evolve.

**Recommendation for applications:** Philosophy A is fine. You own all the call sites; renaming a field is a refactor, not a release.

---

## Versioning Error Types in a Stable API

Adding a *new* category is generally safe — old callers fall through to the default case in their switch. Removing or renaming is a breaking change.

Common evolutions and their compatibility:

| Change | Compatible? |
|--------|-------------|
| Add a new `Kind` value | Mostly yes — but **only if** you document that callers must have a default arm. |
| Add a new field to the exported struct | Yes — Go structs are open for additive change. |
| Rename a field | No. |
| Change the `Error()` text format | Logs may parse it. Be careful. |
| Add `Is`/`As` methods | Yes. |
| Add `Unwrap()` to a type that didn't have one | Behavior change — chains now expand. Document it. |
| Remove or rename a sentinel | No. |
| Change a sentinel from `errors.New(...)` to a typed instance | No — `==` comparisons break. |

The common failure mode is callers writing exhaustive switches:

```go
switch e.Kind {
case KindNotExist: ...
case KindExist:    ...
}
```

When you add `KindPermission`, their code falls through — silently. Mitigation: document a default arm policy, or — better — make `Kind` not exhaustive by design (interface, not enum).

---

## Error Registries and Catalogs

Large services often centralise their errors in a *catalog* — one file (or package) listing every error code, kind, and HTTP/gRPC mapping.

```go
package errcat

type Catalog struct {
    Code     Code
    Kind     Kind
    HTTP     int
    GRPC     codes.Code
    Message  string // user-facing template, no PII
}

var entries = map[Code]Catalog{
    "USER_NOT_FOUND":      {Code: "USER_NOT_FOUND", Kind: KindNotExist, HTTP: 404, GRPC: codes.NotFound, Message: "user not found"},
    "INVALID_EMAIL":       {Code: "INVALID_EMAIL",  Kind: KindInvalid,  HTTP: 400, GRPC: codes.InvalidArgument, Message: "invalid email"},
    "PAYMENT_DECLINED":    {Code: "PAYMENT_DECLINED", Kind: KindBusiness, HTTP: 402, GRPC: codes.FailedPrecondition, Message: "payment declined"},
}

func Lookup(c Code) (Catalog, bool) { e, ok := entries[c]; return e, ok }
```

The custom error type then references the catalog:

```go
type Error struct {
    Code   Code
    Detail string  // optional, may contain PII — never sent to clients
    Err    error
}

func (e *Error) Error() string {
    cat, _ := Lookup(e.Code)
    if e.Detail != "" {
        return fmt.Sprintf("%s: %s", cat.Code, e.Detail)
    }
    return string(cat.Code)
}
```

Benefits:
- All translations live in one place.
- A new code requires *one* edit.
- Documentation is a `go doc` away.
- Tests can iterate the catalog: every code has a sane HTTP and gRPC mapping.

---

## JSON Marshalling — The Right Way and the Pitfall

### The pitfall

The default `json.Marshal(err)` does **not** call `Error()`. It marshals the struct's fields. So:

```go
type DBError struct {
    Op  string
    Err error
}

b, _ := json.Marshal(&DBError{Op: "Get", Err: errors.New("nope")})
// {"Op":"Get","Err":{}}      <-- Err is empty, because errors.New returns
//                                  an unexported errorString with no exported fields.
```

This silently loses the message. People then add `MarshalJSON` — which is the right move, but it has its own traps.

### A safe `MarshalJSON`

```go
func (e *Error) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Code   string `json:"code"`
        Op     string `json:"op,omitempty"`
        Detail string `json:"detail,omitempty"`
        Cause  string `json:"cause,omitempty"`
    }{
        Code:   string(e.Code),
        Op:     string(e.Op),
        Detail: e.Detail,
        Cause:  errString(e.Err),
    })
}

func errString(err error) string {
    if err == nil { return "" }
    return err.Error()
}
```

Notes:
- We marshal a *temporary* DTO so the wire shape is decoupled from the struct.
- We never marshal the inner `error` directly — we extract its string. Otherwise the same default-marshal trap recurses.
- Sensitive fields (`Detail` with PII) might require a *second* marshaller for the public form — see Redaction.

### Public vs internal forms

Often you want two forms:

```go
type Error struct {
    Code     Code
    Op       Op
    Detail   string  // may be sensitive
    Internal string  // stack, query, panic value
    Err      error
}

// For internal logging
func (e *Error) MarshalJSON() ([]byte, error) { /* full */ }

// For client responses
type publicError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
}
func (e *Error) Public() publicError { /* sanitized */ }
```

The HTTP handler calls `Public()`, the logger uses `MarshalJSON`. Two methods, two audiences, zero leak.

---

## Redaction and Sensitive Fields

A custom error type is a tempting place to store the offending value. Be careful:

```go
type AuthError struct {
    Username string // ok
    Password string // NOT ok
    IP       string // mostly ok
    Token    string // NOT ok
}
```

Approaches:
1. **Don't store it.** If you don't need it, don't carry it.
2. **Tag with `redact:"-"`.** Use a logging library that respects the tag.
3. **Provide a `Redacted() error` method** that returns a sanitized copy.
4. **Use a typed wrapper:** `type Secret string` with a `String()` method that returns `"<redacted>"` and a `Reveal()` method explicitly used at the trust boundary.

```go
type Secret string

func (s Secret) String() string { return "<redacted>" }
func (s Secret) Reveal() string { return string(s) }

type AuthError struct {
    Token Secret
}
func (e *AuthError) Error() string {
    return fmt.Sprintf("auth: token=%s", e.Token) // prints <redacted>
}
```

This way the *default* path is safe; revealing requires intent.

---

## Cross-Service Error Contracts

When service A returns an error and service B consumes it, both need to agree. Two options:

### Option 1 — String code

The wire format is just `{"code":"USER_NOT_FOUND","message":"..."}`. Each service maps its own internal types to the agreed codes. No shared Go type.

Pros: language-neutral, version-tolerant.
Cons: every service must reimplement the catalog.

### Option 2 — Shared Go type via a common module

```go
// module: github.com/acme/errcat
package errcat

type Code string

const (
    UserNotFound  Code = "USER_NOT_FOUND"
    InvalidEmail  Code = "INVALID_EMAIL"
)
```

Both services import `errcat`. Pros: type-safe, refactor-friendly. Cons: every consumer is now coupled to your module's release cadence.

In practice large organisations use **option 1 for external boundaries** and **option 2 for internal mesh**. The translation happens at the egress.

---

## Distributed Tracing and Error Correlation

Errors should carry enough metadata to be correlated with traces and logs:

```go
type Error struct {
    Code      Code
    TraceID   string
    SpanID    string
    Timestamp time.Time
    Err       error
}
```

Common rule: errors *do not* generate trace IDs. They carry whatever is on the request context. The middleware is responsible:

```go
func enrichError(ctx context.Context, err error) error {
    var e *Error
    if !errors.As(err, &e) { return err }
    if span := trace.SpanFromContext(ctx); span.IsRecording() {
        e.TraceID = span.SpanContext().TraceID().String()
        e.SpanID  = span.SpanContext().SpanID().String()
    }
    return err
}
```

Now a 500 in Grafana links one click to the trace, which links one click to the log line. That is the single biggest operational payoff of investing in custom error types.

---

## Testing Custom Error Types Thoroughly

Treat the error contract like any other API. Test:

```go
func TestNotFoundIs(t *testing.T) {
    err := &NotFoundError{ID: 1}
    if !errors.Is(err, ErrNotFound) {
        t.Fatal("Is(ErrNotFound) must be true")
    }
}

func TestNotFoundAs(t *testing.T) {
    err := fmt.Errorf("layer: %w", &NotFoundError{ID: 1})
    var nf *NotFoundError
    if !errors.As(err, &nf) { t.Fatal("As must walk the wrap") }
    if nf.ID != 1 { t.Fatalf("got id=%d", nf.ID) }
}

func TestNotFoundJSON(t *testing.T) {
    b, err := json.Marshal(&NotFoundError{ID: 1})
    if err != nil { t.Fatal(err) }
    if !bytes.Contains(b, []byte(`"code"`)) {
        t.Fatalf("expected code field, got %s", b)
    }
}

func TestNotFoundUnwrapStops(t *testing.T) {
    err := &NotFoundError{ID: 1}
    if errors.Unwrap(err) != nil {
        t.Fatal("leaf error must unwrap to nil")
    }
}

func TestNotFoundNoTypedNilTrap(t *testing.T) {
    // Force the worst-case mistake; assert the helper handles it
    var nf *NotFoundError
    var err error = nf
    if err == nil { t.Fatal("typed-nil trap must apply") } // expected
    if SafeNotFound(err) { t.Fatal("SafeNotFound should reject typed-nil") }
}
```

These tests pin the contract. If a future change breaks `errors.As` walking, the test catches it.

---

## Designing for Library Authors

If you are writing a library that *other* programs import, optimise for safety:

- **Prefer sentinels for stable categories.** Easy to use; impossible to misuse.
- **Hide structs, expose behavior interfaces.** `interface{ Temporary() bool }` is more flexible than `*MyTimeoutError`.
- **Document each error in `package doc`.** A consumer should be able to `go doc` the package and find every error and how to detect it.
- **Provide constructors for every error you return.** Don't make consumers reach into your shape.
- **Return wrapped errors with `%w`** so users can `errors.Is` against the standard library (`io.EOF`, `os.ErrNotExist`, `context.DeadlineExceeded`).
- **Stable strings.** Once `Error()` is in production logs, it is in someone's parser. Treat it as semi-stable.
- **A single test file** that exercises every error path with `errors.Is`/`errors.As`. This is your contract test.

---

## Migration: From `fmt.Errorf` Soup to a Typed Catalog

A common task: a five-year-old service returns `fmt.Errorf` everywhere, half the consumers grep messages, the other half retry on everything. How do you migrate?

### Step 1 — Census

Find every `errors.New` and `fmt.Errorf`:

```bash
git grep -nE "errors\.New|fmt\.Errorf" -- '*.go'
```

Group by *intent*: not-found, validation, transient, permission, etc.

### Step 2 — Define the catalog

Pick 10–20 stable codes. Create the package. Add tests for every code.

### Step 3 — Wrap, don't replace

Introduce the typed errors at *return* sites first, wrapping the old ones with `%w` so existing string consumers keep working:

```go
return fmt.Errorf("user %d not found: %w", id, errcat.New(errcat.UserNotFound))
```

### Step 4 — Migrate consumers

One handler at a time, replace `strings.Contains` with `errors.Is`. Delete the legacy parser when no caller depends on it.

### Step 5 — Strip the messages

Once consumers use `errors.Is`/`errors.As`, the message text becomes log-only. Now you can change wording, fix typos, and add structure without fear.

This phased approach is unglamorous but reliable. The alternative — rip-and-replace — usually breaks downstream string parsers nobody knows exist.

---

## Common Senior Mistakes

- **Exporting too many fields** so renames become breaking. Hide; expose methods.
- **Shipping a v2 with renamed `Kind` constants** with no migration path. Add new ones; deprecate old; remove later.
- **Marshalling errors directly** to JSON for clients without redaction.
- **Mixing internal stack-bearing errors and public errors** in one type — split them.
- **Forgetting `errors.Is`/`errors.As` chain semantics** in a custom `As` that doesn't walk inner errors.
- **Not testing JSON shape** — the most common silent regression.
- **Letting cross-service contracts drift.** Pin the wire shape with a contract test on each service.
- **Logging the error twice** — at the layer that translates it and again in middleware. Pick one place.

---

## Summary

At senior level, custom error types are an API design problem. Decide carefully which types to export and which to hide behind sentinels and behavior interfaces. Centralise codes in a catalog so HTTP and gRPC mappings live in one file. Implement `MarshalJSON` for log shape, and a separate `Public()` for client shape, so internal data never leaks. Carry trace/span IDs so an error in a dashboard becomes one click to a trace. Test the contract — `Is`, `As`, JSON, typed-nil — like any other public API. The goal is an error system that is **stable**, **observable**, and **safe to evolve**.

---

## Further Reading

- [Upspin error package](https://github.com/upspin/upspin/tree/master/errors)
- [Cockroach errors package](https://github.com/cockroachdb/errors)
- [gRPC status codes](https://pkg.go.dev/google.golang.org/grpc/codes)
- [Errors.proto / google.rpc.Status](https://github.com/googleapis/googleapis/blob/master/google/rpc/status.proto)
- [Go API stability guidelines](https://go.dev/blog/module-compatibility)
- [Effective Error Handling, Bryan Mills, Gophercon](https://www.youtube.com/results?search_query=bryan+mills+errors+gophercon)

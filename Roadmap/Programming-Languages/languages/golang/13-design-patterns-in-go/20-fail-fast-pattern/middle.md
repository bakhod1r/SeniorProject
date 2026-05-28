# Fail-Fast — Middle

## 1. Where Fail-Fast actually shows up in Go

At a junior level, Fail-Fast is "validate at the top of your function". At a middle level, it's a whole-system discipline: where do you put validation, what shape do errors take, how do they survive being wrapped, when do you panic instead, and how do you make all of this consistent across a codebase.

You'll see Fail-Fast in:

- HTTP handler input parsing — reject malformed JSON before any business logic.
- gRPC server methods — `req.Validate()` from `protoc-gen-validate`, or buf's newer `protovalidate-go`.
- Cobra CLI commands — `Args: cobra.ExactArgs(2)`, `RunE` that returns errors.
- Database driver setup — `db.Ping()` immediately after `Open` to catch DSN issues.
- Startup config loading — bail at `main()` if config is unreadable or missing required fields.
- Loop bodies — `if err := ctx.Err(); err != nil { return err }` before each expensive iteration.
- `must`-helpers at init — `regexp.MustCompile`, `template.Must`, panicking constructors for "this can't be wrong".

The pattern is the same in each case: detect the bad state at the earliest defendable point and surface it loudly. The middle-level skill is knowing *which* point and *how loudly*.

---

## 2. Boundary placement: where to validate

A common mistake is to validate everywhere. Validation has a cost; duplication has a maintenance cost. Pick the *boundary* where untrusted data crosses into typed, trusted code:

| Boundary | Validation kind | Example |
|----------|-----------------|---------|
| HTTP / gRPC ingress | Schema + business rules | JSON Decode + field checks |
| Message queue consumer | Schema + replay-safety | protobuf Validate + idempotency check |
| Database read | Format only (data was validated on write) | Parse `time.Time`, decode JSON column |
| Internal function call | None (trust internal code) | — |
| External API call (you're the caller) | Response schema + error code | check HTTP status + decode body |

Internal-to-internal calls don't need defensive checks. Once data has passed the boundary, it's typed Go values; trust them. Re-validating at every layer is wasted code that makes refactoring harder.

The boundary is the *gate*. Past the gate, the type system carries the weight.

---

## 3. Error shape: meaningful messages

A useful Fail-Fast error tells the caller exactly what was wrong:

```go
return fmt.Errorf("discount: percent must be in [0, 100], got %d", percent)
```

A useless one says only "invalid input". The middle-level move is a structured error type when callers need to *act* on the failure:

```go
type ValidationError struct {
    Field  string
    Reason string
    Value  any
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: field %q invalid: %s (got %v)", e.Field, e.Reason, e.Value)
}

// usage
return &ValidationError{Field: "percent", Reason: "must be 0..100", Value: percent}
```

Now the HTTP layer can convert to a 400 with a field-keyed JSON response. Tests can assert `errors.As(err, &vErr)`. Logs can carry structured fields. The error stops being a string and becomes data.

For multi-field accumulation use `errors.Join` (Go 1.20+):

```go
var errs []error
if req.Email == "" { errs = append(errs, &ValidationError{Field: "email", Reason: "required"}) }
if req.Age < 0   { errs = append(errs, &ValidationError{Field: "age",   Reason: "must be ≥ 0", Value: req.Age}) }
return errors.Join(errs...) // nil if no errors
```

Caller-side:

```go
if err := validate(req); err != nil {
    var vErr *ValidationError
    // errors.As walks Join'd errors too
    if errors.As(err, &vErr) { /* one field's worth */ }
}
```

---

## 4. Validation libraries vs hand-written

Two practical libraries dominate:

**`go-playground/validator`** — struct tags drive validation:

```go
type CreateUserRequest struct {
    Email string `validate:"required,email"`
    Age   int    `validate:"gte=0,lte=130"`
    Name  string `validate:"required,min=2,max=100"`
}

v := validator.New()
if err := v.Struct(req); err != nil { return err }
```

Pros: zero code per request type. Cons: struct tags grow unwieldy; harder to test rules in isolation; some rules require custom registrations anyway.

**`bufbuild/protovalidate-go`** — generated from `.proto` constraints:

```protobuf
message CreateUserRequest {
    string email = 1 [(buf.validate.field).string.email = true];
    int32  age   = 2 [(buf.validate.field).int32.gte = 0, (buf.validate.field).int32.lte = 130];
}
```

Validator is generated. Pros: schema and validation co-located; consistent across services. Cons: requires protobuf workflow.

Hand-written validation wins when rules are complex (cross-field invariants, multi-step lookups), or when you want every check to be unit-testable. Library-driven wins when there are dozens of nearly-identical request types.

---

## 5. Three flavours, one decision tree

Fail-Fast comes in three Go-shaped flavours; pick deliberately:

| Tool | When to use |
|------|-------------|
| **`error` return** | Expected failures: bad user input, network failure, race against another writer |
| **`panic`** | Programmer errors: violated invariant, contract broken, "this is a bug if it ever happens" |
| **`ctx.Err()` check** | The caller has given up; bail before more work |

Rules of thumb:

- A bad HTTP request should never panic the server. Return 400.
- A misconfigured `panic`-on-error path that gets hit in production once a month is worse than the bug it was trying to surface — every panic is downtime.
- Reserve `panic` for things only fixed by deploying new code. Reserve `error` for everything else. `ctx.Err()` is orthogonal — it's about *cooperation*, not validation.

`must`-helpers (`regexp.MustCompile`, `template.Must`) are panics at **init**. They're allowed because their failure means "this binary cannot start" — and that's a deployable fix, not a runtime hazard.

---

## 6. Init-time validation: catch it before traffic

The earliest possible Fail-Fast is at process startup:

```go
func main() {
    cfg, err := config.Load()
    if err != nil { log.Fatalf("config: %v", err) }
    if cfg.DBURL == "" { log.Fatal("config: DB_URL required") }

    db, err := sql.Open("postgres", cfg.DBURL)
    if err != nil { log.Fatalf("db open: %v", err) }
    defer db.Close()

    if err := db.PingContext(ctx); err != nil { log.Fatalf("db ping: %v", err) }

    // ... start the server
}
```

By the time you accept traffic, the system has demonstrated: config readable, DB reachable, dependencies up. A bad config that only fails on the first request is hours of wasted "is it our service?" debugging — `Ping` at startup turns that into 2 seconds of "server didn't start".

This is *defensive*, and it's the rare case where defensiveness is correct.

---

## 7. `context.Context` as a Fail-Fast signal

`ctx.Err()` becomes Fail-Fast in long-running work:

```go
for _, item := range items {
    if err := ctx.Err(); err != nil { return err } // skip remaining work
    if err := process(item); err != nil { return err }
}
```

If the caller cancelled the context, the loop bails *before* fetching the next item. This is the cancellation-aware companion to the "early validation" rule. Same spirit: stop wasted work as early as you can detect it's wasted.

Watch for the trap: `ctx.Err()` only tells you whether the context has been cancelled. It doesn't help if the work inside `process` blocks on something that doesn't respect the context. The check is only as useful as the next thing's cancellation discipline.

---

## 8. Wrapping vs not wrapping

When a low-level function fails, wrap with `%w` so callers can unwrap:

```go
if err := db.QueryRow(...).Scan(&u); err != nil {
    return fmt.Errorf("loadUser %q: %w", id, err)
}
```

The wrap preserves the original; `errors.Is(err, sql.ErrNoRows)` still works.

Don't wrap when:

- You're at the top of a handler returning HTTP/gRPC errors. The error message is going to the client; don't leak internal detail.
- You're returning a sentinel error (`io.EOF`) and callers do `err == io.EOF`. Wrapping breaks that. (Modern code uses `errors.Is`, but legacy callers may not.)
- You're already at the right level of abstraction.

The wrap-or-not call is a middle-level judgment about who reads the error: the user, the developer, or both.

---

## 9. Constructors and the "half-built object" trap

A common bug:

```go
func NewServer(cfg Config) *Server {
    s := &Server{cfg: cfg}
    s.db, _ = sql.Open(cfg.DSN) // err swallowed
    return s
}
```

Now `s.db` may be nil. The bug surfaces on the first request, *not* at startup. The fix is to fail at construction:

```go
func NewServer(cfg Config) (*Server, error) {
    if cfg.DSN == "" { return nil, errors.New("server: DSN required") }
    db, err := sql.Open(cfg.DSN)
    if err != nil { return nil, fmt.Errorf("server: open db: %w", err) }
    return &Server{cfg: cfg, db: db}, nil
}
```

Constructors that can fail must return an error. Period. Half-built objects are how you ship null-pointer crashes to production.

---

## 10. Common middle-level mistakes

- **Validating after partial work has happened.** "Charge the card, then check the address" leaves the customer charged with no shipment.
- **Wrapping the wrong error.** `fmt.Errorf("save: %w", err)` where `err` is itself already wrapped twice; the chain grows and the meaning fades.
- **Sentinel comparison with `==`** instead of `errors.Is`. The wrap is invisible to `==`.
- **Treating `errors.Join` as a single error.** The Join wraps multiple; UI logic needs to walk them.
- **Panicking on user input.** A bad request shouldn't crash the server. The right answer is `400` + a logged error.
- **`log.Fatal` deep in a library.** Libraries shouldn't kill processes. Return an error; let the caller decide.
- **No `Validate()` method on a struct** when the same checks are repeated in three handlers. Move them onto the type.

---

## 11. Summary

Middle-level Fail-Fast is about placement and shape. Place validation at the boundary (HTTP, RPC, queue ingress), not deep inside business logic. Shape the error as a typed `ValidationError` (or `errors.Join` of them) so callers can act on it. Reach for `panic` only for unrecoverable programmer errors and `must`-helpers at init. Add `ctx.Err()` checks in long loops. Construct with errors. Wrap with `%w` so the chain survives. The point is the same throughout: the earlier and louder the failure, the cheaper it is to fix.

---

## Further reading
- `errors` package documentation (Go 1.13 wrap, 1.20 Join)
- `go-playground/validator` docs
- `bufbuild/protovalidate-go` docs
- Dave Cheney, "Don't just check errors, handle them gracefully"
- Rob Pike, "Errors are values"
- Eric Allman, "The Robustness Principle Reconsidered" (Postel's law critique)
- `sony/gobreaker` — circuit breaker (advances Fail-Fast into runtime)

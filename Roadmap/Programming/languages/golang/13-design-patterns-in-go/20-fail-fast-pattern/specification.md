# Fail-Fast — Specification

## 1. Origins

The Fail-Fast discipline predates Go by decades and arrived through three independent traditions: testing-and-defensive-programming literature, telecommunications fault-tolerance, and protocol-design pragmatism. Go's contribution was to bake the discipline into a language where errors are ordinary values returned from ordinary functions, and where panic is a deliberate, narrow tool reserved for programmer bugs.

Historical milestones:

- **Jim Shore, "Fail Fast" (*IEEE Software*, September 2004).** Shore's two-page article gave the discipline its modern name. The argument: a system that crashes loudly at the point of inconsistency is cheaper to debug than one that propagates the inconsistency until it surfaces somewhere unrelated. Shore distinguished *bugs* (programmer errors that warrant an assertion failure) from *exceptional conditions* (expected failures that warrant a handled error), and insisted that defensive defaults masked bugs more often than they recovered from real failures. The article is the canonical citation for "fail fast" as a named discipline rather than a folk heuristic.
- **Erlang and the "let it crash" philosophy (Joe Armstrong et al., Ericsson, 1986 onward).** Erlang's process model treats every process as cheap and isolated; the supervisor restarts a crashed worker rather than the worker attempting recovery. The cultural slogan "let it crash" — popularised by Armstrong's PhD thesis and his 2007 book *Programming Erlang* — is the strongest industrial application of Fail-Fast: don't defend against inconsistency at the worker level, fail loudly, and let a supervisor handle the restart. Go's goroutines do not have built-in supervision, but the discipline carries over: prefer to surface the failure rather than paper over it.
- **Postel's law (Jon Postel, RFC 760, 1980).** "Be conservative in what you do, be liberal in what you accept from others." Postel's robustness principle was a pragmatic response to the heterogeneous early ARPANET; it explicitly favoured leniency at boundaries to maximise interoperability. The principle dominated protocol design for two decades.
- **Postel's-law criticism — Eric Allman, "The Robustness Principle Reconsidered" (*Communications of the ACM*, August 2011).** Allman argued that decades of lenient parsers created irreversible interoperability debt: senders became dependent on receivers tolerating their malformed output, and once a generation of buggy clients existed, no receiver could afford to tighten its parser. The lenient receiver had cemented the buggy sender.
- **Martin Thomson, IETF draft `draft-thomson-postel-was-wrong` (2018).** Thomson's draft formalised Allman's critique for the IETF and recommended strict-at-the-boundary as the new default for protocol implementations. The draft explicitly cites the QUIC and HTTP/3 designs, both of which fail closed on protocol violations rather than attempting recovery.

Go-specific history:

- **Error-as-value tradition (Go 1.0, March 2012).** Go shipped without exceptions; the language's only error-propagation mechanism is the ordinary return value. The `if err != nil { return err }` idiom forces the programmer to confront every failure point at the call site, which is the structural prerequisite for Fail-Fast: a failure that is in the type signature cannot be silently dropped without an explicit underscore.
- **`template.Must` and `regexp.MustCompile` (Go 1.0, 2012).** Both helpers panic on construction error and exist specifically to be used as package-level `var` initialisers: `var tmpl = template.Must(template.New("greet").Parse(src))`. The intent is to fail loudly at program startup if the template or regex source is malformed; this is Fail-Fast applied to a compile-time-shaped problem that the type system cannot express.
- **Rob Pike, "Errors are values" (*The Go Blog*, January 2015).** Pike's essay reframed error handling from a chore to a design opportunity: errors are ordinary values, manipulable like any other; the lack of an exception mechanism is a feature because it forces failures into the type signature.
- **Dave Cheney, "Don't just check errors, handle them gracefully" (dotGo 2016).** Cheney's talk introduced the wrap/inspect/handle taxonomy that became `errors.Is`, `errors.As`, and `%w` in Go 1.13. The talk is the bridge between the Pike-era "errors are values" doctrine and the modern Fail-Fast-with-context discipline: surface failures early *and* with enough context to diagnose them.

The Go ecosystem's distinctive stance is that Fail-Fast is the default rather than a discipline layered on top of an exception-oriented runtime. The cost is verbose error plumbing; the benefit is that every failure point is visible in the source.

---

## 2. Go language mechanics

### 2.1 `error` return as primary mechanism

The conventional Go function returns `(T, error)` where the error is non-nil exactly when the `T` should not be used. The caller is expected to check; the compiler does not enforce the check, but the `errcheck` linter and the `_ =` underscore-assignment idiom flag every place a check is intentionally elided.

```go
func ParseEmail(s string) (Email, error) {
    if s == "" { return Email{}, errors.New("empty email") }
    if !strings.ContainsRune(s, '@') { return Email{}, fmt.Errorf("missing @ in %q", s) }
    return Email{addr: s}, nil
}
```

The Fail-Fast move is that `ParseEmail` rejects bad input before constructing a value; no caller receives a half-built `Email` plus a non-nil error.

### 2.2 `panic` for unrecoverable programmer errors

`panic` unwinds the stack, runs deferred functions, and (absent a `recover`) terminates the goroutine with a stack trace. The Go runtime itself panics on out-of-bounds slice access, nil-map writes, and integer divide-by-zero. Library code panics on violations of an invariant that the caller is contractually required to uphold — a nil that was documented non-nil, a length mismatch on inputs the API requires to be parallel, an impossible enum value.

```go
func (s *Server) Handle(req *Request) {
    if req == nil { panic("Server.Handle: nil request") }
    // ...
}
```

The rule of thumb: panic when the only fix is a code change. If a recompile or a different argument cannot avoid the panic, the panic was the wrong choice and the API should return an error instead.

### 2.3 `ctx.Err()` for cancellation

`context.Context.Err()` returns a non-nil error once the context has been cancelled or its deadline has elapsed. Checking it at the top of long-running loops, before expensive work, and after every blocking call is Fail-Fast for cooperative cancellation: if the caller has given up, exit immediately rather than completing work whose result will be discarded.

```go
for _, item := range items {
    if err := ctx.Err(); err != nil { return err }
    if err := process(ctx, item); err != nil { return err }
}
```

The pattern composes with `select` for blocking operations: `select { case <-ctx.Done(): return ctx.Err(); case v := <-ch: ... }`.

### 2.4 Sentinel errors

A sentinel is a named, exported error value the caller can compare against:

```go
var ErrNotFound = errors.New("store: not found")
```

Sentinels are Fail-Fast in the sense that they let the caller distinguish "expected, handle quietly" from "unexpected, surface loudly" without parsing error strings. The stdlib reserves sentinels for cases where the caller will routinely branch on the value: `io.EOF`, `os.ErrNotExist`, `sql.ErrNoRows`, `context.Canceled`, `context.DeadlineExceeded`.

### 2.5 `errors.Is` / `errors.As` / wrapping

`fmt.Errorf("op: %w", err)` wraps an error while preserving the original for downstream inspection. `errors.Is(err, target)` walks the wrap chain looking for a sentinel match; `errors.As(err, &targetVar)` walks the chain looking for an error of a particular concrete type. The pair lets Fail-Fast code surface the failure with full context — "op `users.create`: validate field `email`: invalid format" — while still letting the caller programmatically recognise the original failure class.

The discipline: wrap when crossing a logical boundary (handler to service, service to store); do not wrap when forwarding within a single layer; never strip wrapping in middle layers, since the loss is irreversible.

---

## 3. Canonical Go shapes

### 3.1 Boundary validation in an HTTP handler

```go
func createUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest); return
    }
    if err := req.Validate(); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest); return
    }
    if err := svc.Create(r.Context(), req); err != nil {
        writeServiceError(w, err); return
    }
    w.WriteHeader(http.StatusCreated)
}
```

The handler does three things at the boundary: decode, validate, dispatch. Each gate either passes the request through to the next stage or returns immediately with a 4xx that names the problem. By the time the service is called, every field of `req` is known-valid.

### 3.2 Constructor returning an error

```go
func NewServer(cfg Config) (*Server, error) {
    if cfg.Addr == "" { return nil, errors.New("server: addr required") }
    if cfg.Timeout <= 0 { return nil, fmt.Errorf("server: timeout must be > 0, got %v", cfg.Timeout) }
    if cfg.Logger == nil { return nil, errors.New("server: logger required") }
    return &Server{cfg: cfg}, nil
}
```

Constructors with required parameters check them immediately; an invalid config never produces a `*Server` that will fail later in an opaque way. Note that the function returns `(nil, err)`, never `(&Server{}, err)` — a half-built object on the error path is a Fail-Fast violation because the caller may forget to check and call methods on it.

### 3.3 `Must` wrapper for `init()`-time wiring

```go
var greetTmpl = template.Must(template.New("greet").Parse(`hello {{.Name}}`))

func MustNewServer(cfg Config) *Server {
    s, err := NewServer(cfg)
    if err != nil { panic(err) }
    return s
}
```

The `Must`-prefixed helper exists so a value can be assigned to a package-level `var` without an `init()` block. The convention: pair every `Must` with a non-panicking variant the caller can use when they want to handle the error.

### 3.4 `ctx.Err()` at the top of long loops

```go
func (s *Service) ProcessBatch(ctx context.Context, ids []ID) error {
    for i, id := range ids {
        if i%64 == 0 {
            if err := ctx.Err(); err != nil { return err }
        }
        if err := s.processOne(ctx, id); err != nil {
            return fmt.Errorf("process %v: %w", id, err)
        }
    }
    return nil
}
```

The periodic `ctx.Err()` check is Fail-Fast for cooperative cancellation. The modulo gate amortises the check cost when the loop body is fast; for a slow body, check on every iteration.

### 3.5 Multi-error accumulation

```go
func (r *CreateUserRequest) Validate() error {
    var errs []error
    if r.Email == "" { errs = append(errs, errors.New("email: required")) }
    if r.Age < 0 { errs = append(errs, fmt.Errorf("age: must be >= 0, got %d", r.Age)) }
    if len(r.Name) > 255 { errs = append(errs, errors.New("name: too long")) }
    return errors.Join(errs...)
}
```

When the caller is a user filling a form, returning all validation failures at once is more useful than returning the first. `errors.Join` (Go 1.20+) packages a slice of errors into a single error whose `Error()` string concatenates them and whose `Unwrap() []error` exposes the originals to `errors.Is`/`As`. For older Go, `hashicorp/go-multierror` or `go.uber.org/multierr` provided the same shape.

---

## 4. Standard library use

### 4.1 `template.Must`

```go
func Must(t *Template, err error) *Template {
    if err != nil { panic(err) }
    return t
}
```

The pattern is wrap-and-panic. Used at package-level var initialisation when a parse failure means the binary is unshippable: a typo in a template literal should crash at process start, not at the first request that touches the template.

### 4.2 `regexp.MustCompile`

```go
var versionRE = regexp.MustCompile(`^v(\d+)\.(\d+)\.(\d+)$`)
```

Same shape as `template.Must`. The regex source is a compile-time constant; if it fails to compile, the program is broken; panic at init is the appropriate response. The non-panicking sibling `regexp.Compile` exists for sources that come from user input.

### 4.3 `strconv.ParseInt`

```go
n, err := strconv.ParseInt(s, 10, 64)
if err != nil { return fmt.Errorf("parse port: %w", err) }
```

`strconv.ParseInt` is the textbook example of Fail-Fast at a string-to-typed-value boundary. It refuses overflow, refuses non-numeric input, refuses empty strings, and returns a `*NumError` carrying the offending input. Wrapping it with `%w` preserves the cause for downstream inspection.

### 4.4 `json.Decoder.DisallowUnknownFields`

```go
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
if err := dec.Decode(&req); err != nil {
    http.Error(w, err.Error(), http.StatusBadRequest); return
}
```

By default, `json.Decode` silently ignores fields in the input that have no matching struct field. `DisallowUnknownFields` flips the default: an unknown field becomes a decode error. This is Fail-Fast at the schema boundary — if a client sends `{"emial": "..."}`, the server rejects the typo loudly instead of silently dropping the field and creating a user with no email.

### 4.5 `net/http.ListenAndServe` errors

`http.ListenAndServe` returns a non-nil error in every termination case — port already in use, permission denied, shutdown received. The conventional shape is:

```go
log.Fatal(http.ListenAndServe(":8080", mux))
```

`log.Fatal` calls `os.Exit(1)` after logging the error. The combination is Fail-Fast for the top-level event: if the server cannot start or has crashed, terminate the process so that a supervisor (systemd, Kubernetes) restarts it.

---

## 5. Real library use

### 5.1 `go-playground/validator`

Struct-tag-driven validation, idiomatic for HTTP and gRPC handlers:

```go
type CreateUserRequest struct {
    Email string `validate:"required,email"`
    Age   int    `validate:"gte=0,lte=150"`
    Name  string `validate:"required,max=255"`
}

if err := validate.Struct(req); err != nil { return err }
```

The library reflects over struct tags at validation time; failures are returned as a `validator.ValidationErrors` slice that names each failed field. The Fail-Fast move is concentrating the validation rules into the struct definition rather than spreading them through handler bodies.

### 5.2 `protoc-gen-validate` / `buf validate`

Proto-defined validation generates a `Validate()` method on the generated Go struct:

```proto
message CreateUserRequest {
    string email = 1 [(validate.rules).string.email = true];
    int32  age   = 2 [(validate.rules).int32.gte = 0];
}
```

The generated `req.Validate()` enforces every constraint at the gRPC service boundary. `buf validate` is the modern successor and produces equivalent guards. The constraints live in the schema, which is the single source of truth shared across languages.

### 5.3 `ozzo-validation`

Code-driven validation, useful when constraints depend on runtime state:

```go
err := validation.ValidateStruct(&req,
    validation.Field(&req.Email, validation.Required, is.Email),
    validation.Field(&req.Age, validation.Min(0), validation.Max(150)),
)
```

The rules are ordinary Go expressions, so they can close over other request fields, environment values, or per-tenant configuration that a struct-tag library cannot express.

### 5.4 `ent` entity validators

The `ent` ORM lets each field declare validators that run before insert or update:

```go
field.String("email").NotEmpty().Validate(func(s string) error { /* ... */ })
field.Int("age").Min(0).Max(150)
```

The generated client refuses to commit a record that violates any field validator, pushing Fail-Fast into the persistence layer as a second gate behind the boundary validators.

### 5.5 `sony/gobreaker`

A circuit breaker is Fail-Fast for downstream dependencies: once the downstream has failed `n` times in a window, the breaker opens and short-circuits subsequent calls with `gobreaker.ErrOpenState` instead of dialling the failing dependency. The caller fails fast — receives the error without waiting for the inevitable timeout — and the downstream gets time to recover under reduced load. The pattern is the dependency-graph analogue of Erlang's "let it crash": don't pile work onto a known-bad collaborator.

---

## 6. Formal specification

A Go Fail-Fast site consists of:

| Element | Description |
|---------|-------------|
| **Boundary** | A trust transition: untrusted input becomes typed value. HTTP request body, gRPC method argument, CLI flag, configuration file, message-queue payload. |
| **Precondition** | A predicate the next layer assumes true; the boundary checks it explicitly. |
| **Check** | The `if` statement or library call that evaluates the predicate. |
| **Failure mode** | The mechanism by which the failure is surfaced: `error` return, `panic`, `ctx.Err()` propagation, HTTP 4xx response, `log.Fatal`. |
| **Diagnostic** | The message carried with the failure: the field name, the offending value, the wrap chain. Useful diagnostics are the difference between a five-minute and a five-hour debugging session. |
| **Recovery boundary** | The layer that catches the failure and decides what to do with it: handler returns 4xx, supervisor restarts process, `recover` in goroutine-launcher logs and reports. |

**Invariants:**

1. **Validation happens at the earliest layer that can perform it.** If the gRPC layer can reject a malformed request, the service layer must not also have to reject it. Duplicate validation is wasteful and drifts; missing validation at the boundary lets bad data into deeper layers where the diagnostics are worse.
2. **No half-built values on the error path.** A function returning `(T, error)` with `err != nil` must return the zero `T`. Callers that forget the error check should observe an obviously empty value, not a partially valid one whose method calls panic far from the failure.
3. **Panic is reserved for programmer errors.** Anything a non-malicious user could trigger from outside the binary is an `error`, not a `panic`. Anything a code review could catch is a candidate for `panic`. The boundary is firm: `panic` for "this can't be recovered without fixing the code", `error` for everything else.
4. **Every error carries enough context to identify its origin.** Wrap with `%w` at every layer crossing; name the operation in the wrap (`"users.create: validate: "`); never return a bare `errors.New("invalid")` from a function called from more than one site.
5. **`ctx.Err()` is checked before any expensive operation.** Once a context is cancelled, no further work should be performed on its behalf. The check is cheap; the wasted work it prevents is not.

---

## 7. Anti-patterns

### 7.1 Swallowing the error

```go
data, _ := os.ReadFile(path)
process(data)
```

The underscore-assignment drops the error; `data` is empty on failure but the next line acts as if the read succeeded. The downstream symptom is "process got empty input" with no clue why. **Fix:** never discard an error from an operation that can fail meaningfully; if the error truly does not matter, document why in a comment and log it.

### 7.2 Returning the zero value on error

```go
func GetUser(id int) User {
    u, err := store.Get(id)
    if err != nil { return User{} } // bug: caller can't distinguish
    return u
}
```

The caller cannot tell "user not found" from "user is the zero value". The zero `User{}` flows through the rest of the program, hitting business code that has no idea anything failed. **Fix:** return `(User, error)`; let the caller decide whether to surface, default, or branch.

### 7.3 Panic on user input

```go
func ParseAge(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil { panic(err) }
    return n
}
```

A malformed query-string parameter now crashes the goroutine — and, in many HTTP frameworks, the whole server process. User input is by definition untrusted; bad user input is expected, not a programmer error. **Fix:** return `(int, error)`; let the handler convert to a 4xx response.

### 7.4 Lenient parsing

```go
n, _ := strconv.Atoi(strings.TrimSpace(s)) // best effort: 0 on failure
```

Two failures: dropped error and silent default. The function happily returns 0 for `"foo"`, `""`, `"abc123"`. Downstream code uses 0 thinking it was the intended value. This is Postel's-law-style leniency at the worst possible boundary — input parsing. **Fix:** require the input to be well-formed and reject everything else with a named error.

### 7.5 Late validation

```go
func (s *Service) Create(req CreateUserRequest) error {
    id, err := s.store.Insert(User{Email: req.Email, Name: req.Name})
    if err != nil { return err }
    if !looksLikeEmail(req.Email) {
        s.store.Delete(id) // bug: compensating action
        return errors.New("bad email")
    }
    s.events.Publish(UserCreated{ID: id})
    return nil
}
```

The validation runs after the side effect; the rollback may itself fail; the event may have already fired. **Fix:** validate before the first state-changing operation. Push validation to the boundary if at all possible.

### 7.6 Missing wrap

```go
if err := decode(r.Body); err != nil { return err }
```

The caller now sees a generic `unexpected EOF` from twelve layers down with no clue where it originated. **Fix:** wrap at every layer crossing: `return fmt.Errorf("decode request body: %w", err)`. The wrap names the operation; the `%w` preserves the original for `errors.Is`.

### 7.7 Blanket `recover`

```go
defer func() { recover() }()
// ... anything ...
```

The `recover` catches every panic and discards it, including ones that signal genuine programmer errors. The goroutine continues in an inconsistent state; the diagnostic is gone. **Fix:** `recover` only in well-defined places — a goroutine launcher that logs the panic and reports it to a metrics sink, an HTTP middleware that returns 500 and logs the stack. Always log the recovered value and the stack trace; never silently swallow.

---

## 8. Variants and dialects

| Variant | Description |
|---------|-------------|
| **Precondition check** | Inline `if` statements at function entry; reject invalid arguments before any work begins. The simplest and most common Fail-Fast shape. |
| **Schema validation** | A library-driven check at the boundary: struct tags (`go-playground/validator`), proto rules (`protoc-gen-validate`), or generated `Validate()` methods enforce a declarative schema. |
| **Context-based** | Check `ctx.Err()` at the top of loops and before blocking calls; abandon work as soon as the caller has cancelled. |
| **Circuit breaker** | Track downstream failure rate; once the breaker opens, fail subsequent calls fast with `ErrOpenState` rather than waiting for the inevitable timeout. |
| **`Must` helper** | Wrap an `(T, error)`-returning constructor in a panicking variant that can be used as a package-level var initialiser. Use only when the failure means the binary cannot run. |
| **Decorator middleware** | An HTTP or gRPC middleware that validates incoming requests against a schema and rejects with 4xx before the handler runs. Centralises validation outside the handler body. |

---

## 9. Naming conventions

- **`Validate() error`** — the standard "check this value's invariants" method on a struct; called at the boundary; returns nil on success or a descriptive error. Used by `protoc-gen-validate`, `ent`, and most stdlib-style code.
- **`Must…(…) T`** — the panicking variant of a constructor or parser; pair with a non-panicking sibling. Stdlib precedent: `template.Must`, `regexp.MustCompile`. Library precedent: `prometheus.MustRegister`, `sqlx.MustConnect`.
- **`MustNew…(…) *T`** — Prometheus-style: a panicking constructor for top-level wiring. The naming distinguishes "panics on construction error" from "panics on first use".
- **`Check…(…) error`** — a verb form used when the function is purely a predicate; returns nil if the check passes and an error otherwise. Common in linter-style code and policy engines.
- **`Verify…(…) error`** — semantically equivalent to `Check`; used in cryptographic and protocol code where the operation is recognised as verification rather than mere validation (`crypto/rsa.VerifyPKCS1v15`, `jwt.Verify`).
- **`Assert…(…)`** — used only in test helpers; production code prefers `Check`/`Verify`/`Validate`. The naming reserves `Assert` for the test idiom where the assertion failure terminates the test.

---

## 10. Related patterns

| Pattern | Relation to Fail-Fast |
|---------|----------------------|
| **Decorator (validator middleware)** | A wrapping handler that validates the request before delegating to the inner handler; centralises Fail-Fast at the HTTP or gRPC boundary. |
| **Chain of Responsibility (validator chain)** | Multiple validators tried in sequence; the first failure short-circuits and returns. Each link is its own Fail-Fast site; the chain is the composition. |
| **Strategy (pluggable check)** | Different validation strategies (strict, lenient, per-tenant) selected at runtime; each strategy is a Fail-Fast site with different invariants. |
| **Circuit Breaker** | A Fail-Fast pattern for downstream calls: short-circuit once the downstream is known-bad, restoring it through controlled probing. |
| **Bulkhead** | Resource isolation pattern (separate goroutine pools, separate connection pools) that limits blast radius of a failure; pairs with Fail-Fast because failing one bulkhead must not cascade to others. |

---

## 11. Further reading

- **Jim Shore, "Fail Fast" (*IEEE Software*, September 2004).** The canonical citation; two pages; introduces the named discipline and the bug-vs-exceptional-condition distinction.
- **Rob Pike, "Errors are values" (*The Go Blog*, January 2015).** The cultural framing of error handling in Go; explains why the absence of exceptions is a deliberate design choice.
- **Dave Cheney, "Don't just check errors, handle them gracefully" (dotGo 2016).** The wrap-and-handle taxonomy that fed into `errors.Is`, `errors.As`, and `%w`.
- **Eric Allman, "The Robustness Principle Reconsidered" (*Communications of the ACM*, August 2011).** The argument against Postel's law; required reading for anyone designing a protocol or HTTP API.
- **Martin Thomson, IETF draft `draft-thomson-postel-was-wrong` (2018).** The IETF-grade formalisation of Allman's critique; cites QUIC and HTTP/3 as Fail-Fast-by-default protocols.
- **`go-playground/validator` documentation.** The canonical struct-tag validator in the Go ecosystem; reading the tag reference is the fastest way to internalise idiomatic boundary validation.
- **`protoc-gen-validate` / `buf validate` documentation.** Schema-driven validation across language boundaries; useful when the same constraints must hold in multiple client implementations.
- **Joe Armstrong, *Programming Erlang* (Pragmatic Bookshelf, 2007; 2nd edition 2013).** The "let it crash" philosophy at book length; the strongest articulation of supervised-Fail-Fast as a system design principle.

Fail-Fast in Go is the discipline of returning useful errors as early as possible. Senior skill is putting validation at the right boundary and choosing panic vs error vs ctx.Err deliberately.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Fail-Fast** | The discipline of detecting and surfacing failures at the earliest layer that can recognise them, with diagnostics that name the offending input. |
| **Fail-Safe** | The opposite discipline: continue operating in the presence of failure, often by substituting a default; trades diagnosis for availability and is appropriate only when the failure mode is genuinely tolerable. |
| **Precondition** | A predicate that must hold before a function executes; checked at the function's entry with an explicit `if` or library call. |
| **Postcondition** | A predicate that must hold after a function returns successfully; rarely checked at runtime in Go but documented in package comments. |
| **Invariant** | A predicate that must hold throughout an object's lifetime; constructors establish it, methods preserve it, validators verify it. |
| **Sentinel error** | A named exported error value (`io.EOF`, `sql.ErrNoRows`) callers can compare against with `errors.Is` to branch on a known failure class without parsing strings. |
| **Boundary** | A trust transition: untrusted external input becomes typed internal value. HTTP handler, gRPC server method, CLI flag parser, configuration loader, message-queue consumer. |
| **Postel's law** | "Be conservative in what you do, be liberal in what you accept" (RFC 760, 1980); the lenient-parser doctrine Fail-Fast explicitly rejects. |
| **`Must` helper** | A panicking variant of a fallible constructor, used at package-level var initialisation when failure means the binary cannot run; pair with a non-panicking sibling that returns an error. |
| **Validate** | The conventional name for an object's invariant-check method; returns nil on success, a descriptive error on failure, runs at the boundary, never inside business logic. |

# Fail-Fast — Senior

## 1. Mental model — Fail-Fast vs Fail-Safe, let-it-crash, Postel's law critics

At senior level Fail-Fast is not "validate at the top of the function". It is a **stance on uncertainty**: the moment your code cannot prove an input satisfies a precondition, it stops and surfaces the gap. The opposing stance — Fail-Safe — says "do something reasonable, keep going, log later". Both are legitimate engineering choices; they are *not* interchangeable, and the cost of choosing the wrong one is paid in the worst hours of incidents.

**Fail-Fast.** Reject the unknown at the boundary it crossed. The error message names the field, the value, and the rule. The caller is responsible for retry, default, or surrender. No partial state. No silent coercion. The premise is that *unknown inputs are bugs, and bugs are cheaper to fix when they are loud*.

**Fail-Safe.** Accept the unknown, choose a default, continue. The premise is that *availability is more important than precision*. Used in life-safety systems (a thermostat with a missing sensor reading falls back to last-known-good rather than turning the furnace off in winter), in lenient parsers (a browser rendering broken HTML), and in resilience layers (a circuit breaker returning cached data when the backend is down).

The two stances are **opposites at the same boundary, but composable across layers**. A senior architecture is Fail-Fast at the trust boundary (HTTP, RPC, message queue) and Fail-Safe at the resilience boundary (downstream calls, cache, replicas). Confusing the two — Fail-Safe at the front door, Fail-Fast at the back — produces systems that accept garbage and then crash trying to use it.

**Erlang let-it-crash.** Joe Armstrong's OTP philosophy: a process that detects corrupted state dies; a supervisor restarts it from known-good initial state. This is Fail-Fast at the *process* level — recovery is structural, not in-line. Go does not have OTP supervisors, but the equivalent is `kubectl` restarting a crashed pod, `systemd` respawning a daemon, or a goroutine pool replacing a worker that returned an error. The senior Go shape: **panic on invariant violations, exit on unrecoverable startup failures, let the orchestrator restart you**. Nursing a process through corrupted state with `recover` and patch-up code lengthens bug life and corrupts more state.

**Postel's law and its critics.** Jon Postel's "be conservative in what you send, liberal in what you accept" was written for TCP in 1980. It produced robust networks and, decades later, brittle protocols: HTML had to standardize a bug-compatible parser; HTTP/1.1 ambiguities became request-smuggling vulnerabilities; JSON parsers diverged on duplicate keys, trailing commas, and number precision. Eric Allman's "The Robustness Principle Reconsidered" (2011) and IETF "draft-iab-protocol-maintenance" formalize the critique: leniency at the receiver removes pressure on the sender to fix bugs, and the leniency surface grows unboundedly. Modern protocols (HTTP/2, HTTP/3, gRPC, CBOR) are strict — Fail-Fast at the wire. The senior takeaway: Postel's law buys interop today by spending debuggability tomorrow.

| Axis | Fail-Fast | Fail-Safe |
|------|-----------|-----------|
| Default on unknown | Reject | Substitute |
| Surface area | Boundary | Throughout |
| Debuggability | High (named field, position) | Low (silent fallback) |
| Availability impact | Higher (rejections) | Lower (degraded but up) |
| Long-term cost | Caller learns to send valid input | Receiver accretes leniency rules |
| Right place | Trust boundary, invariants | Resilience layer, life-safety |

---

## 2. Boundary classification — system, trust, invariant

Not every check is "validation". Senior code separates three boundary classes; each has its own latency budget, error shape, and observability story.

**System boundary.** Bytes from outside meet typed values inside. HTTP body, RPC payload, message-queue frame, file on disk, env var, CLI flag. The job is parse+validate: turn `[]byte` into `T` and reject everything that does not fit. Failures here are 4xx-ish — the caller sent bad data. Error messages should be safe to return to the caller (no internal field names, no secrets). Validation cost is amortized over the request, so spend it: regex, length limits, charset, JSON schema.

```go
func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
        writeProblem(w, http.StatusBadRequest, "invalid_json", err.Error())
        return
    }
    if err := req.Validate(); err != nil { // system boundary
        writeProblem(w, http.StatusBadRequest, "invalid_request", err.Error())
        return
    }
    // ...
}
```

`io.LimitReader` is a Fail-Fast guard against payload-size attacks — it caps the work the decoder can do before the validator even runs.

**Trust boundary.** A request is well-formed but the caller is not entitled to do what it asks. Auth, permission, tenant isolation, rate limit. Fail-Fast here is 401/403/429. The error message must not leak whether the resource exists (use 404 instead of 403 for resources the caller cannot see). Trust-boundary checks come *after* system-boundary parsing — you cannot check permission on a field that did not parse.

```go
if !h.acl.CanRead(ctx, user, req.ResourceID) {
    writeProblem(w, http.StatusNotFound, "not_found", "") // not 403
    return
}
```

**Invariant boundary.** Internal types whose preconditions must hold for the rest of the function to make sense. A non-nil pointer, a sorted slice, a range constraint that the type system cannot express. Failures here are *bugs* — the caller of an internal API violated a contract. Senior style: panic on invariant violation, do not return an error.

```go
func merge(a, b []int) []int {
    if !sort.IntsAreSorted(a) || !sort.IntsAreSorted(b) {
        panic("merge: inputs must be sorted")
    }
    // ...
}
```

The panic blames the caller, not the user. It surfaces in tests, in CI, in code review of the offending call site. Returning an error here only delays diagnosis: the caller is wrong, not the data.

| Boundary | Class of failure | Response | Latency budget | Observability |
|----------|------------------|----------|----------------|---------------|
| System | Bad data | 4xx + structured error | Microseconds | Counter by field |
| Trust | Wrong actor | 401/403/404/429 | Microseconds | Counter by reason |
| Invariant | Programmer error | Panic | Nanoseconds | Crash + stack |

The boundaries compose top-down: parse, authorize, then operate under invariants. Mixing them — checking auth before parsing, or returning a 500 on a bad email — is a code smell.

---

## 3. Validation libraries — validator, PGV, ozzo, ent

Hand-rolled `if`s do not scale past a dozen fields. Production code uses validation libraries; the choice depends on where the schema lives.

**`go-playground/validator`.** Struct-tag-driven, the de facto standard for HTTP handlers.

```go
type CreateUserRequest struct {
    Email    string `json:"email"    validate:"required,email,max=254"`
    Username string `json:"username" validate:"required,alphanum,min=3,max=32"`
    Age      int    `json:"age"      validate:"gte=13,lte=120"`
    Role     string `json:"role"     validate:"required,oneof=admin user guest"`
}

var v = validator.New(validator.WithRequiredStructEnabled())
```

Pros: low ceremony, familiar dialect, easy custom validators. Cons: reflection-heavy (microseconds per struct), error messages need translation, panics on misspelled tags only at first use.

**`protoc-gen-validate` (PGV).** Schema-first. Rules live in the `.proto`; the generator emits a `Validate()` method.

```protobuf
message CreateUserRequest {
  string email = 1 [(validate.rules).string = {email: true, max_len: 254}];
  string username = 2 [(validate.rules).string = {pattern: "^[a-zA-Z0-9]{3,32}$"}];
  int32  age = 3 [(validate.rules).int32 = {gte: 13, lte: 120}];
}
```

Pros: schema and validation are inseparable; client SDKs can run the same rules; no reflection — generated code is faster. Cons: protobuf-only; rule expressiveness is limited to what the generator supports.

**`ozzo-validation`.** Programmatic, no tags. Validation lives in code, beside the type.

```go
func (r CreateUserRequest) Validate() error {
    return validation.ValidateStruct(&r,
        validation.Field(&r.Email,    validation.Required, is.Email, validation.Length(0, 254)),
        validation.Field(&r.Username, validation.Required, is.Alphanumeric, validation.Length(3, 32)),
        validation.Field(&r.Age,      validation.Required, validation.Min(13), validation.Max(120)),
    )
}
```

Pros: full Go type-checking on the rules; refactor-safe; cross-field rules are natural. Cons: more lines than tags; library is maintained but moves slowly.

**`ent`.** ORM with schema-side validation that runs *before* the SQL — fields like `field.String("email").MaxLen(254).Match(...)` and `field.Int("age").Range(13, 120)` produce both DB constraints and Go-side validation, moving Fail-Fast up the stack to the schema.

| Library | Where rules live | Reflection | Cross-field | Schema-shared |
|---------|------------------|------------|-------------|---------------|
| `validator` | Struct tags | Yes | Manual | No |
| PGV | `.proto` | Generated, no | Limited | Yes (with proto clients) |
| `ozzo` | Code | No | Natural | No |
| `ent` | Ent schema | Generated, no | Hooks | Yes (with DB) |

**Senior choice.** PGV for cross-language gRPC, `validator` for HTTP-only Go services with simple shapes, `ozzo` when cross-field rules dominate, `ent` when the schema can carry both DB constraints and validation. Mixing two libraries in one codebase confuses readers — pick one per service.

---

## 4. Panic vs error vs ctx.Err() — decision tree

`error`, `panic`, and `ctx.Err()` are not interchangeable. They communicate different things to different audiences. The decision tree:

```
Is the cause programmer error (broken invariant, impossible state)?
├── Yes  → panic
└── No → Is the work cancelled by the caller (ctx, signal)?
         ├── Yes → return ctx.Err()
         └── No → return error (sentinel or wrapped)
```

**`error`** is the default. Most failures — bad input, network error, missing file, version mismatch — are anticipated. Callers handle them. Use sentinel errors (`errors.Is`) for stable conditions and typed errors (`errors.As`) for structured data:

```go
var ErrNotFound = errors.New("not found")

type ValidationError struct {
    Field, Rule string
    Value any
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s %s (got %v)", e.Field, e.Rule, e.Value)
}
```

**`panic`** is for programmer error. Stdlib examples: nil map write, slice out-of-bounds, type assertion failure. The convention is *the bug is in the code that called this function*. Panic crosses goroutines via supervisors or process death; do not use it for control flow. The senior test: if a code reviewer would write "this should never happen", a panic — not an error — is correct.

```go
func mustBeNonNil(p *T, name string) {
    if p == nil {
        panic(fmt.Sprintf("%s: required non-nil %s", caller(), name))
    }
}
```

**`ctx.Err()`** is for cooperative cancellation. When the caller's context is done — deadline exceeded or explicit cancel — the work should stop and return the context's error so the caller can distinguish "I gave up" from "the operation failed". Check `ctx.Err()` before expensive work and during long loops:

```go
for _, item := range items {
    if err := ctx.Err(); err != nil { return err }
    if err := process(ctx, item); err != nil { return err }
}
```

Returning `ctx.Err()` instead of a generic error lets the caller use `errors.Is(err, context.Canceled)` and `errors.Is(err, context.DeadlineExceeded)`.

**Conventions.**

- Constructors return `error` for predictable failures (bad config) and panic for impossible ones (`New` called with nil where nil is structurally invalid).
- Methods on initialized values never panic on user input.
- Library code should not panic across the API surface for user-induced reasons; reserve panic for `Must*` variants.
- Goroutines must `recover` panics or arrange for crash — an unrecovered panic in a goroutine crashes the whole process.

| Mechanism | For | Caller sees | Recovery |
|-----------|-----|-------------|----------|
| `error` | Expected failure | Returned value | Branch on error |
| `panic` | Programmer bug | Stack trace, crash | `recover` only at supervisor |
| `ctx.Err()` | Cancellation | `context.Canceled` / `DeadlineExceeded` | Caller already knows |

---

## 5. Init-time vs request-time — `Must`, `MustCompile`, startup patterns

Fail-Fast is most powerful at **init time**: a malformed config, a missing template, a broken regex should refuse to start the binary. Runtime failure forces every replica to crash in lockstep on the first matching request; init failure crashes once, locally, before the orchestrator promotes the version.

The stdlib idiom: `Must*` functions panic if construction fails. They are designed for package-level vars.

```go
var (
    emailRE      = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
    userTmpl     = template.Must(template.New("user").Parse(userTemplateSrc))
    cipherBlock  = must(aes.NewCipher(key))
)

func must[T any](v T, err error) T {
    if err != nil { panic(err) }
    return v
}
```

`MustCompile` panics during package init — before `main()` runs. A typo in a regex literal crashes the binary at startup, not on the first request that exercises it. The panic shows up in deployment logs and CI; the binary never enters traffic.

**Config.** Same idea, applied to config files:

```go
func main() {
    cfg, err := config.Load("/etc/app/config.yaml")
    if err != nil {
        log.Fatalf("config: %v", err) // exit 1, no traffic
    }
    if err := cfg.Validate(); err != nil {
        log.Fatalf("config invalid: %v", err)
    }
    // ...
}
```

`log.Fatal` is Fail-Fast at the process level. The orchestrator sees a non-zero exit, declines to promote, and the previous version keeps serving. The senior rule: **never start a process with invalid configuration**; either the config is good or the process is dead.

**Connection probes.** At startup, prove every external dependency is reachable:

```go
db, err := sql.Open("postgres", cfg.DSN)
if err != nil { log.Fatalf("db open: %v", err) }
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if err := db.PingContext(ctx); err != nil { log.Fatalf("db ping: %v", err) }
```

Trade-off: a brief DB blip during deploy causes a crash loop. Mitigation: ping with retry and a deadline; only fail past the deadline. The intent is to refuse to start with a broken backend, not to be brittle to ten-second outages.

**Schema/migration check.** Before serving, verify the DB schema matches the version the binary expects. A binary that starts against the wrong schema corrupts data slowly; a binary that refuses to start surfaces the mistake before the first write.

| Init pattern | Mechanism | Failure |
|--------------|-----------|---------|
| Regex / template | `MustCompile`, `template.Must` | Package init panic |
| Config | `log.Fatal` | Exit 1, no traffic |
| DB / cache reachability | `Ping` with timeout | Exit 1, retry by orchestrator |
| Schema version | Query + compare | Exit 1, blocks rollouts |
| Feature flags | Fetch + validate | Exit 1 or read-only mode |

Init-time Fail-Fast is cheap insurance. A 50-ms regex compile that panics at startup is invisible; the same regex compiled lazily on the first matching request takes a slot in a thread pool and shows up as a p99 spike.

---

## 6. Generics-based validation (Go 1.18+)

Pre-1.18, reusable validators returned `interface{}` and the caller asserted. Generics let validation libraries express type-aware rules without reflection.

```go
type Validator[T any] func(value T) error

func Min[T constraints.Ordered](n T) Validator[T] {
    return func(v T) error {
        if v < n { return fmt.Errorf("must be >= %v, got %v", n, v) }
        return nil
    }
}

func Max[T constraints.Ordered](n T) Validator[T] {
    return func(v T) error {
        if v > n { return fmt.Errorf("must be <= %v, got %v", n, v) }
        return nil
    }
}

func All[T any](vs ...Validator[T]) Validator[T] {
    return func(v T) error {
        for _, fn := range vs {
            if err := fn(v); err != nil { return err }
        }
        return nil
    }
}

func Field[T any](name string, value T, v Validator[T]) error {
    if err := v(value); err != nil {
        return &ValidationError{Field: name, Cause: err}
    }
    return nil
}
```

Use site:

```go
ageRule := All[int](Min(13), Max(120))
priceRule := All[float64](Min(0.0), Max(1_000_000.0))

func (r *CreateUserRequest) Validate() error {
    return errors.Join(
        Field("age",   r.Age,   ageRule),
        Field("price", r.Price, priceRule),
    )
}
```

**Why this matters.** Pre-generics validators relied on `interface{}` and runtime type switches — slower and unsafe (`Min(13)` against a string would compile and panic at runtime). The generic version catches `Min(13)(stringValue)` at compile time. Per-field validation is a closed function call, no reflection — single-digit nanoseconds versus microseconds for reflection-based validators.

**Composition with `errors.Join`** (Go 1.20+) collects validation errors without losing any. The senior shape: validate every field, return all violations at once. Returning the first error forces clients to re-submit and re-validate one fix at a time — bad UX.

**Limitation.** Cross-field rules ("if `discount > 0` then `discountReason` required") escape the per-field validator and need a struct-level method. Generics raise the floor of per-field validation; they do not replace struct-level methods.

---

## 7. Defensive constructors — `New` vs `MustNew`

Constructors come in two flavors:

- `New...` returns `(T, error)`. The caller is expected to handle failure.
- `MustNew...` returns `T` and panics. The caller has accepted that failure is unrecoverable.

```go
func NewServer(cfg Config) (*Server, error) {
    if cfg.Addr == "" {
        return nil, errors.New("server: Addr required")
    }
    if cfg.Logger == nil {
        return nil, errors.New("server: Logger required")
    }
    if cfg.MaxConns <= 0 {
        return nil, fmt.Errorf("server: MaxConns must be > 0, got %d", cfg.MaxConns)
    }
    lis, err := net.Listen("tcp", cfg.Addr)
    if err != nil {
        return nil, fmt.Errorf("server: listen: %w", err)
    }
    return &Server{cfg: cfg, listener: lis}, nil
}

func MustNewServer(cfg Config) *Server {
    s, err := NewServer(cfg)
    if err != nil { panic(err) }
    return s
}
```

The constructor validates everything it needs and refuses to return a partially constructed value. The senior rule: **if `New` returned a non-nil `*Server` and `nil` error, every method on it must work without re-checking the config**. Methods can assume `s.cfg.Addr != ""`, `s.cfg.Logger != nil`, `s.listener != nil`. Validation is the constructor's responsibility, not every method's.

**Options pattern with Fail-Fast.**

```go
type Option func(*Config) error

func WithMaxConns(n int) Option {
    return func(c *Config) error {
        if n <= 0 { return fmt.Errorf("WithMaxConns: must be > 0, got %d", n) }
        c.MaxConns = n
        return nil
    }
}

func NewServer(addr string, opts ...Option) (*Server, error) {
    cfg := Config{Addr: addr, MaxConns: 100}
    for _, opt := range opts {
        if err := opt(&cfg); err != nil { return nil, err }
    }
    if err := cfg.Validate(); err != nil { return nil, err }
    return &Server{cfg: cfg}, nil
}
```

Each option validates locally; the constructor runs a final cross-field check. The error names the option that failed.

**Functional options gotcha.** `WithX` that silently overwrites a previous `WithX` hides bugs. Track an `addrSet` bool in `Config` and return `"WithAddr: already set"` if applied twice. A user wiring `WithAddr(prod)` and `WithAddr(staging)` by accident gets a startup error instead of a randomly-chosen server.

**`MustNew` is for `main()` and tests.** Libraries should not export `Must*` constructors as the primary API; callers should handle their own failure. The exception is value-style constructors that compose with package-level vars (`var defaultClient = MustNewClient(...)`).

| Constructor | Returns | Use in |
|-------------|---------|--------|
| `NewT(cfg) (T, error)` | `(T, error)` | Library code, services, tests |
| `MustNewT(cfg) T` | `T`, panics | `main()`, `init()`, test helpers |
| `NewT(cfg) T` (no error) | `T` | Cannot-fail constructors only |

---

## 8. Observability — Prometheus validation-failure counters, alerting

Fail-Fast at the system boundary produces high-quality telemetry: every rejection is a labeled event. Senior observability treats validation failures as a first-class signal.

**Counter by field and rule.**

```go
var validationFailures = promauto.NewCounterVec(
    prometheus.CounterOpts{
        Name: "http_validation_failures_total",
        Help: "Validation failures at HTTP boundary",
    },
    []string{"endpoint", "field", "rule"},
)

func reportValidation(endpoint string, err error) {
    var ve *ValidationError
    if errors.As(err, &ve) {
        validationFailures.WithLabelValues(endpoint, ve.Field, ve.Rule).Inc()
    }
}
```

**Cardinality caution.** Labels must be bounded. `field` is fine — it is a code-defined set. `rule` is fine — same. *Never* label by user value or request ID; that explodes cardinality and breaks Prometheus. If you need user-value telemetry, use logs or traces, not metrics.

**Alerting.**

- **Sudden spike.** A rule that fires 1/min in steady state and 1000/min after a deploy means the client side broke or the server changed a rule incompatibly. Alert: `rate(http_validation_failures_total{rule="email"}[5m]) > 5 * rate(http_validation_failures_total{rule="email"}[1h] offset 1d)`.
- **New label appears.** A `field` or `rule` that did not exist before showing up post-deploy indicates a schema change. Alert on first appearance.
- **Zero failures.** A rule that should fail occasionally but suddenly never fails may have been disabled. Long-window check: `sum(increase(http_validation_failures_total{rule="email"}[1d])) == 0` is suspicious.

**Trace correlation.** Attach the validation error to the request span:

```go
span.SetStatus(codes.Error, "validation failed")
span.SetAttributes(
    attribute.String("validation.field", ve.Field),
    attribute.String("validation.rule", ve.Rule),
)
```

In Grafana Tempo / Jaeger, you can pivot from a spike on the Prometheus dashboard to specific failing traces in seconds. Without trace correlation, the metric tells you "something broke" without telling you what.

**Log shape.** Structured logs with field names, not formatted strings:

```go
slog.Warn("validation failed",
    "endpoint", "POST /users",
    "field", ve.Field,
    "rule", ve.Rule,
    "request_id", reqID(ctx),
)
```

Searchable. Aggregatable. Joinable to traces by request ID.

**SLO impact.** Validation failures are *not* server errors. They count toward 4xx, not 5xx. Mixing them into the error budget makes the budget look healthier than it is (real bugs hide behind validation noise) or worse (a client bug eats the budget for actual outages). Separate validation failures from server errors in dashboards and SLOs.

| Signal | Use | Watch for |
|--------|-----|-----------|
| Counter by field/rule | Detect schema drift | Spike or zero after deploy |
| New label first-seen | Detect undeclared rules | Rule added without test |
| Trace correlation | Debug specific failures | Cross-service mismatch |
| 4xx-vs-5xx split | Keep SLO honest | Validation noise polluting error rate |

---

## 9. Failure modes — lenient parsing, slow validation, late validation cost

**Lenient parsing and data corruption.** A JSON decoder configured `UseNumber()` but no schema validation accepts `{"age": "13"}` as a string. Downstream code does `int(req.Age)`, gets a runtime panic on a request that "validates" upstream. The lenience surface multiplies across consumers; bug fixes break a third of them. Fail-Fast cure: schema validation immediately after decode, with the same library used by every consumer.

**Slow validation as DoS.** A regex with catastrophic backtracking (`^(a+)+$` against `aaaaaaaaaaaX`) takes seconds. An attacker submits a million such payloads and the server CPU saturates. Mitigations: use Go's `regexp` (RE2, no backtracking — immune by design), bound input length with `io.LimitReader` *before* validation, set per-request timeouts, run validation under `ctx` and check `ctx.Err()` between rules. The senior version: **validation must be cheaper than the work it protects**. A 100 ms validator on a 1 ms handler inverts the cost model.

**Late validation cost.** Validating at the bottom of the call stack — inside the storage layer — means every caller pays the parse, network, and decode cost before the rejection. With Fail-Fast at the handler boundary, the request fails in microseconds. Late validation lights up dashboards as a spike in storage layer errors that look like infrastructure problems and waste hours of investigation. The fix is structural: validation belongs at the boundary the data crossed, not at the data's destination.

**Validation that mutates.** A validator that normalizes (`strings.ToLower(email)`) is doing two jobs. When a future engineer adds `if email != originalEmail { audit(...) }`, the audit never fires because the validator already mutated. Senior shape: separate `Validate(in) error` from `Normalize(in) out` — pure functions, one responsibility each, composable.

**Validation skipped in fast paths.** Caches, batch endpoints, internal RPC paths that "trust the caller" eventually receive bad data when an upstream service ships a bug. The first time this happens, the cache is poisoned for hours. Rule: **trust boundaries are not internal vs external; they are between independently-deployed binaries**. An internal service is still a boundary if it can deploy without you.

**Validation in transactions.** Validate before `BEGIN`. Validation inside a transaction holds locks for the validator's duration; on slow validators this kills throughput. On rollback after validation, the database has done useless work. Senior shape: validate first, transact second.

**Repeated validation.** A handler validates the request, calls a service that re-validates, calls a repository that re-validates. Each layer's validator is slightly different; the most lenient one wins. Pick the boundary at which validation owns the contract — usually the handler for HTTP services — and document "values received by service layer are valid". Internal types that have invariants can enforce them at construction; methods on those types do not re-check.

**Validation that drifts from schema.** Hand-rolled validators in Go and a JSON schema in the API docs that diverge silently. The Go code rejects `email > 254 chars`; the schema says `> 320`. Test in CI: load every JSON example from the schema and assert the Go validator agrees.

| Failure | Symptom | Fix |
|---------|---------|-----|
| Lenient parse | Sporadic downstream panics | Strict decoder, schema check immediately after |
| Slow validator | CPU saturation under load | RE2 regex, length limit before validation |
| Late validation | Storage-layer error spikes | Boundary validation |
| Mutating validator | Audit/diff logic misfires | Split Validate from Normalize |
| Skipped fast path | Cache poisoning | Validate at every deploy boundary |
| In-transaction validation | Lock contention, rollback waste | Validate before `BEGIN` |
| Drifted schema | Production accepts what docs reject | CI test schema vs validator |

---

## 10. When NOT Fail-Fast + closing principles

### 10.1 When not

- **Life-safety controllers.** An ABS controller that detects a sensor outage should fall back to non-ABS braking, not panic. Failing-Safe means continuing in a degraded mode with logging, alerts, and graceful recovery.
- **Search and recommendation.** A typo in a query should not 400; it should suggest. Strictness here is hostile UX. Validate *parameters* (page size, sort key) strict; validate *content* (the search string) lenient.
- **Display layer.** Rendering should never crash because a field is missing — show "—" or hide the section. Templates fall back; servers reject.
- **Idempotent retries.** A retry of a partially-applied request should detect prior application and succeed, not reject as duplicate. Idempotency keys plus state checks, not strict rejection.
- **Receivers in evolving protocols.** A client that rejects unknown fields breaks forward-compat. Decode-and-ignore is correct; semantic validation runs only on known fields.
- **Aggregation and ETL.** A pipeline that rejects an entire batch on one bad row loses 99% of valid data. Quarantine the row, surface a metric, keep going. Per-row Fail-Fast plus per-batch Fail-Safe.
- **Telemetry and logging.** A metric pipeline that crashes on malformed input takes down the observability of every service. Drop the message, increment a counter, never block production traffic.

### 10.2 Closing principles

**Fail at the earliest boundary that can prove the failure.** Not the first line of every function — the first line of the first function that knows enough to decide. Pushing validation further out is Fail-Fast; pushing it in is Fail-Loud. Different patterns.

**Boundaries are between independently-deployed binaries, not between packages.** A handler trusts its service layer in the same binary. A microservice does not trust another microservice even when both are yours, because they deploy on different cadences. The senior shift is recognizing where the *real* trust boundary lies.

**Panic on programmer error, error on user error, ctx.Err on cancellation.** Each mechanism has an audience. Misrouting them — error on bug, panic on bad input — wastes everyone's time during incidents.

**Init-time failure is cheap; runtime failure is expensive.** Every check that can run at startup should run at startup. `MustCompile`, `Must`, `log.Fatal` are senior tools, not anti-patterns. The crash happens once, before the rollout sees traffic.

**Validation is data, not code.** Schemas (proto, OpenAPI, JSON Schema) outlast hand-written validators. Generate validators where possible. Hand-written validators that drift from the spec are worse than no validator: they create the appearance of safety.

**Validate once, trust afterward.** Cross-layer re-validation is a smell — pick the layer that owns the contract and document it. Constructors that validate produce types whose methods do not re-check.

**Every validation failure is a high-quality signal.** Counter by field, alert on spike, trace-correlate. Validation failures tell you about your callers more accurately than 5xx tells you about your code.

**Errors must be debuggable.** "validation failed" is not an error message; "username: max length 32, got 41" is. Name the field, the rule, and the offending value. Future-you will be reading these in a 3 AM incident.

**The lenient-vs-strict choice has a long-term cost.** Postel's law won the 1980s and lost the 2010s. Strict protocols breed clients that send valid data; lenient protocols breed clients that test against your bugs. Default to strict, document deliberately every relaxation.

**Composition over global stance.** A service is Fail-Fast at the system boundary, Fail-Safe in the resilience layer, Fail-Fast at internal invariants, Fail-Safe in batch ingestion. The pattern at each boundary is a separate decision with separate trade-offs. Treating "Fail-Fast" as a global mode produces brittle systems.

**Test the validators, not just the happy path.** Property-based tests, fuzz, schema round-trips. A validator that has never seen a malformed input has not been tested. Run the schema's negative examples against the Go validator in CI.

Fail-Fast is the engineering discipline of pushing failure surfaces toward the trust boundary, where they are cheap to detect, easy to attribute, and safe to expose. Used well, it shortens debug cycles and clarifies blame; used badly, it produces brittle services that 400 on harmless drift. The senior shift is treating Fail-Fast not as a slogan but as a *boundary-by-boundary decision* with explicit cost and observability.

---

## Further reading

- "The Robustness Principle Reconsidered" — Eric Allman, CACM 2011
- "draft-iab-protocol-maintenance" — IETF on protocol strictness
- Joe Armstrong, "Making reliable distributed systems in the presence of software errors" — let-it-crash thesis
- `go-playground/validator`, `protoc-gen-validate`, `go-ozzo/ozzo-validation`, `ent`
- `errors.Join` (Go 1.20) and `errors.Is`/`As` semantics
- `GODEBUG=inittrace=1` — measuring init-time validation cost
- `runtime/debug.SetTraceback` — panic visibility in production
- OpenAPI / JSON Schema CI patterns for validator-vs-schema drift

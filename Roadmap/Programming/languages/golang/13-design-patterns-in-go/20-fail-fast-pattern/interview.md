# Fail-Fast Pattern — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and signals interviewers grade on. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim only the ones you stumbled on. Type the live-coding solutions out at least once. Fail-Fast is mostly a *negative* discipline — *don't* accept invalid input, *don't* paper over violated invariants, *don't* mix expected and programmer errors. Naming where the boundary lives and what flavour of failure belongs there is what separates senior from junior.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the Fail-Fast pattern?

**Short answer:** Fail-Fast says: *check assumptions at the earliest possible point and surface the failure right there*. Bad input is rejected at the boundary it crosses; the error message names the field, the bad value, and the entry point. The opposite — slow failure — accepts the bad value, propagates it through layers, and explodes far from where it entered. Fail-Fast trades a tiny amount of upfront validation for a massive reduction in debugging cost when something goes wrong.

**Follow-up:** What does it *not* mean? Answer: it does not mean panic-on-every-error. The "fast" is about *when* you check, not *how loud* you fail. A handler that returns `400 Bad Request` immediately on invalid JSON is fail-fast; one that crashes the process is overreaction.

---

### Q2. Fail-Fast vs Fail-Safe — what's the difference and when do you pick each?

**Short answer:** Fail-Fast: stop the moment something is wrong, surface the error, refuse to continue. Fail-Safe: keep going on a degraded path, return a sensible default, log a warning. Fail-Fast is right when continuing risks corruption or hides bugs — input validation, invariant checks, startup configuration. Fail-Safe is right when availability outranks correctness — caching layers, telemetry, optional features. The trap is using Fail-Safe everywhere because it "feels nicer": you end up with a system that silently produces wrong answers and no one notices until a customer complains.

**Follow-up:** Give an example of mixing both. Answer: a metrics middleware should be Fail-Safe (a broken Prometheus exporter shouldn't take down the API); the business handler it wraps should be Fail-Fast (a missing `customer_id` should refuse the request). The trick is choosing per layer, not per codebase.

---

### Q3. Show a validation example where Fail-Fast prevents a real bug.

**Short answer:** A `Discount(price, percent)` function. Without Fail-Fast it computes `price - price*percent/100` and returns negative money when `percent = 150` — the customer is paid to take the product. With Fail-Fast:

```go
func Discount(price float64, percent int) (float64, error) {
    if price < 0 {
        return 0, fmt.Errorf("discount: price must be >= 0, got %v", price)
    }
    if percent < 0 || percent > 100 {
        return 0, fmt.Errorf("discount: percent in [0,100], got %d", percent)
    }
    return price - price*float64(percent)/100, nil
}
```

Two cheap checks at the top. The function now has one of two outcomes: a valid number or a named error. There's no third "wrong but plausible" output.

**Follow-up:** Where should this validation live — in `Discount` or in the HTTP handler? Answer: both. The handler validates because it owns the user-facing error format; the function validates because it cannot trust every caller forever.

---

### Q4. Postel's law says "be liberal in what you accept". Fail-Fast says the opposite. Who's right?

**Short answer:** Both, in different contexts. Postel's law made sense for early internet protocols where survival required interoperating with broken peers you couldn't fix. Inside your own service boundary, liberal acceptance is poison: it hides bugs in callers, locks you into accidental behaviours, and makes schema evolution impossible because removing leniency now breaks consumers. The modern take (Eric Allman's "Robustness Principle Reconsidered"): be strict at trust boundaries, lenient only where you have no other choice. Fail-Fast is the default; Postel is an exception you justify per case.

**Follow-up:** Where does liberal-acceptance still apply? Answer: parsing email addresses, HTTP date headers, user-typed search queries — places where strictness would reject obviously-intended inputs. Even then, *canonicalize* the input rather than accept it raw, so downstream code sees one shape.

---

### Q5. When do you use `panic`, when `error`, when `ctx.Err()`?

**Short answer:** Three buckets.

- **`error`** for *expected* failures — bad user input, network timeouts, missing files. These are part of normal operation; the caller can recover.
- **`panic`** for *programmer errors* — violated invariants, impossible states, a `nil` that was promised non-nil. These can't be recovered without fixing code.
- **`ctx.Err()`** for *cancellation* — the caller has given up; bail out before doing more work.

Reserve `panic` for "this can't happen unless we have a bug". A bad HTTP request is not panic-worthy; a server constructed with a `nil` config is.

**Follow-up:** Give a concrete `panic` example that's appropriate. Answer: `template.Must` — a template that fails to parse at startup is a programming bug, not a runtime condition. Same for `regexp.MustCompile`. Both panic loudly so the bug surfaces in the first test run, not on the production hot path.

---

### Q6. Where in the Go standard library do you see Fail-Fast in action?

**Short answer:** `database/sql`: `db.Ping()` is the canonical "fail-fast at startup" call. `template.Must` / `regexp.MustCompile`: panic at parse time so a bad pattern never reaches the hot path. `flag.Parse`: invalid CLI flags exit before `main` runs. `http.ServeMux` and `gob.Register`: duplicate registration panics. `json.NewDecoder(...).Decode(&v)`: decoding failures bubble up immediately rather than returning a half-populated struct. The lesson: stdlib reserves panic for startup-time programmer errors and uses `error` for everything that crosses runtime data.

**Follow-up:** Where does the stdlib *not* fail fast and why? Answer: `time.Parse` accepts unusual formats; `net/url.Parse` accepts URLs no browser would honour. Both prioritize interoperability over strictness — Postel territory. Knowing which calls do what is part of the job.

---

### Q7. What are `Must*` helpers and when do you write one?

**Short answer:** `Must*` helpers wrap a `(value, error)` function and panic on error. They exist because at startup time you have no useful place to handle the error, and panicking surfaces the bug at process launch instead of at first use. Write one when (a) the call is in package initialization or a constant-style assignment, (b) failure means the program cannot meaningfully run, and (c) the input is constant or programmer-controlled.

```go
func MustParse(layout, value string) time.Time {
    t, err := time.Parse(layout, value)
    if err != nil { panic(err) }
    return t
}

var deployedAt = MustParse(time.RFC3339, "2026-05-28T00:00:00Z")
```

**Follow-up:** When is a `Must*` wrong? Answer: when the input is runtime user data. `MustParseUserInput` is a footgun — one bad request crashes the process. Reserve `Must*` for compile-time-known or operator-controlled values.

---

## 3. Middle questions (Q8–Q15)

### Q8. Why validate at the boundary instead of in every function?

**Short answer:** Boundary validation establishes a *trust frontier*: past the boundary, every value is known-valid, and downstream code can be written without paranoia. Per-function validation duplicates checks, produces inconsistent error messages, and burns CPU re-validating the same fields at every layer. The cost is one careful validator at each entry point — HTTP handler, message consumer, CLI parser, gRPC interceptor. The benefit is business logic that reads cleanly because it doesn't have to defend against impossible states.

**Follow-up:** What about defensive checks deep in the call graph? Answer: keep them, but as *assertions*, not error returns. A `panic("invariant: balance < 0")` in a payment processor confirms the boundary did its job; if it ever fires, the boundary is broken and the panic surfaces the regression. Belt and braces, with the belt holding things up and the braces only for show.

---

### Q9. `go-playground/validator` vs writing your own validator — pick one.

**Short answer:** Use `go-playground/validator` (or `protoc-gen-validate` for proto-defined types) when validation rules are mostly declarative — required fields, length bounds, regex, enum sets. The library is faster than hand-rolling, ships with internationalised error messages, and survives schema evolution because rules live on the struct. Write your own when rules are stateful (`endDate > startDate`), cross-field (`if Type=="card", then CardNumber required`), or require database lookups (`uniqueEmail`). In practice, real codebases combine both: tag-based for shape, hand-written for semantics.

**Follow-up:** Why not write everything by hand for control? Answer: handwritten validation drifts across endpoints, accumulates copy-paste bugs, and produces error messages with subtly different shapes. The library gives you one consistent error format and one place to internationalize.

---

### Q10. Struct tag validation vs explicit `Validate()` method — trade-offs?

**Short answer:** Tags are concise and declarative but stringly-typed and awkward for stateful rules. An explicit `Validate() error` method is verbose but type-checked and trivially extended with custom logic. The senior move: use tags for shape (required, length, format) and add a `Validate()` method for cross-field rules. Both can coexist.

```go
type CreateOrderRequest struct {
    CustomerID string `validate:"required,uuid"`
    Items      []Item `validate:"required,min=1,dive"`
    Currency   string `validate:"required,iso4217"`
}

func (r *CreateOrderRequest) Validate() error {
    if err := validate.Struct(r); err != nil { return err }
    if r.Currency == "JPY" && hasFractionalAmount(r.Items) {
        return errors.New("JPY does not support fractional amounts")
    }
    return nil
}
```

**Follow-up:** Why call tag validation *inside* `Validate()` rather than at the call site? Answer: one entry point per type. The caller writes `req.Validate()`; the type owns the order and combination of checks.

---

### Q11. How does error wrapping interact with Fail-Fast?

**Short answer:** Wrapping (`fmt.Errorf("decode: %w", err)`) preserves the original error for `errors.Is` / `errors.As` while adding context as the error climbs the stack. Fail-Fast generates errors near the boundary; wrapping turns them into a trail of layers the caller can match against. The discipline: every layer that returns an error adds context, every layer that handles an error checks with `errors.Is` rather than string-matching. The result is debuggable failures that fail fast at the boundary and report cleanly at the top.

```go
if err := decode(r.Body, &req); err != nil {
    return fmt.Errorf("createUser: decode body: %w", err)
}
```

**Follow-up:** When do you *not* wrap? Answer: when the error already carries enough context for the caller (sentinel errors like `io.EOF`), or when wrapping would leak internal detail across a trust boundary (don't wrap a SQL error into the HTTP response; map it to a user-facing message and log the wrapped error internally).

---

### Q12. Sentinel errors vs typed errors — which serves Fail-Fast better?

**Short answer:** Both are tools; pick based on what the caller needs to do.

- **Sentinel errors** (`var ErrNotFound = errors.New("not found")`) are matched with `errors.Is`. Good when the caller's branching is binary — does this exist or not — and the value carries no extra data.
- **Typed errors** (`type ValidationError struct { Field, Reason string }`) are matched with `errors.As` and expose fields. Good when the caller needs structured data — which field failed, what was the bad value, what's the constraint.

Fail-Fast at boundaries usually wants typed errors because the consumer (HTTP response, log line) needs the field name. Internal Fail-Fast checks often use sentinels because the caller only needs to know *which* failure happened.

**Follow-up:** Why not always use typed errors? Answer: equality with `errors.Is` is cheap and unambiguous; pattern-matching with `errors.As` is more code at every call site. For yes/no branches, sentinels are simpler.

---

### Q13. Show a defensive constructor that fail-fasts on bad config.

**Short answer:** Constructors are the natural place to validate — they create the invariants the rest of the code relies on. A `New*` function returns `(*T, error)`; the caller cannot proceed with a half-built object.

```go
func NewServer(cfg Config) (*Server, error) {
    if cfg.Addr == "" { return nil, errors.New("server: Addr required") }
    if cfg.DB == nil  { return nil, errors.New("server: DB required") }
    if cfg.Timeout <= 0 {
        return nil, fmt.Errorf("server: Timeout must be > 0, got %v", cfg.Timeout)
    }
    return &Server{addr: cfg.Addr, db: cfg.DB, timeout: cfg.Timeout}, nil
}
```

After `NewServer` returns successfully, every field is guaranteed valid; methods on `Server` don't have to re-check. Past the constructor, the type is trustworthy.

**Follow-up:** Why not provide setter methods with validation? Answer: setters make the type mutable and let invalid intermediate states exist. Constructors enforce "valid from birth".

---

### Q14. Why is startup-time validation worth the extra code?

**Short answer:** Startup is the cheapest possible time to fail — no traffic depends on you yet, the orchestrator can roll back automatically, and the alert lands on the deploying engineer rather than the on-call. A `db.Ping()` at startup catches a bad password before the first request; a config schema check catches a missing env var before users see a 500. Without startup validation the same bugs manifest as random 500s minutes or hours later.

```go
if err := cfg.Validate(); err != nil { log.Fatalf("config: %v", err) }
db, err := sql.Open("postgres", cfg.DSN)
if err != nil { log.Fatalf("db open: %v", err) }
if err := db.PingContext(ctx); err != nil { log.Fatalf("db ping: %v", err) }
// ... only now do we listen for traffic
```

**Follow-up:** What if startup-time validation makes the binary too slow to start? Answer: split into *required* (must pass before serving) and *health* (can be re-checked later). Required checks block startup; health checks gate readiness probes.

---

### Q15. How does `ctx.Err()` enable Fail-Fast?

**Short answer:** `ctx.Err()` reports whether the caller has cancelled or timed out. Checking it before expensive work lets you bail early instead of computing a result no one will read. The pattern: at every loop iteration, before every IO call, after every `select`, check `ctx.Err()` and return it. The result: a cancelled request stops within microseconds of the cancel signal, instead of running to completion and being discarded.

```go
for _, item := range items {
    if err := ctx.Err(); err != nil { return err }
    if err := process(ctx, item); err != nil { return err }
}
```

This is Fail-Fast on *cooperation*: the caller has signalled "don't bother"; the callee notices and exits. The alternative — finishing the loop, then discarding the result — wastes CPU, holds locks, and increases tail latency.

**Follow-up:** How often do you check? Answer: at *natural break points* — loop iterations, after each child call. Checking every line is overkill and unreadable; checking once at the top and never again defeats the purpose. The unit is "between work items".

---

## 4. Senior questions (Q16–Q22)

### Q16. How does Fail-Fast integrate with the circuit breaker pattern?

**Short answer:** A circuit breaker is Fail-Fast applied to *downstream health*: when the dependency is unhealthy, the breaker opens and subsequent calls fail immediately without touching the wire. Three states.

1. **Closed** — calls pass through; failures are counted.
2. **Open** — calls fail immediately with `ErrCircuitOpen`; downstream gets no traffic. This is the Fail-Fast state.
3. **Half-open** — limited probe calls test recovery; success closes the breaker, failure re-opens it.

The integration point: input validation happens *before* the breaker (no point burning the breaker budget on calls you'd reject anyway), and the breaker fires *before* the network IO (no point burning latency on a known-bad downstream). Combined, you get a request pipeline where each layer fails fast on its own terms — validation, then breaker, then RPC, then business logic.

**Follow-up:** When does the breaker make Fail-Fast worse? Answer: false positives during recovery. If the breaker is too aggressive, you reject good traffic during a transient blip. Tune via *latency-based* opens (slow calls fail too, not just errors) and *gradual* half-open re-entry rather than all-or-nothing.

---

### Q17. Design a gRPC unary interceptor that fail-fasts on invalid requests.

**Short answer:** A unary interceptor sits between the gRPC framework and the handler; perfect place to validate before the handler runs. The interceptor calls `req.Validate()` (if the request implements it) and returns `codes.InvalidArgument` on failure. The handler never sees invalid input.

```go
type Validator interface { Validate() error }

func ValidateInterceptor(
    ctx context.Context, req any, info *grpc.UnaryServerInfo,
    handler grpc.UnaryHandler,
) (any, error) {
    if v, ok := req.(Validator); ok {
        if err := v.Validate(); err != nil {
            return nil, status.Errorf(codes.InvalidArgument,
                "validation: %v", err)
        }
    }
    return handler(ctx, req)
}
```

Senior moves: (a) one validator per request type, generated by `protoc-gen-validate`; (b) interceptor short-circuits before handler — handler never has to validate again; (c) `codes.InvalidArgument` is the correct gRPC status — clients can branch on the code, not the message; (d) the interceptor is the *only* place validation lives, so error format is consistent across every RPC.

**Follow-up:** What about streaming RPCs? Answer: a stream interceptor wraps the `ServerStream` and validates each `Recv` message. The pattern generalizes — every input touchpoint gets validated once.

---

### Q18. How does Fail-Fast interact with idempotency?

**Short answer:** Idempotent endpoints must distinguish "this request is invalid" (Fail-Fast, 4xx) from "this request was already processed" (idempotent replay, 2xx with cached response). The order matters: validate first, then check the idempotency key, then process. Validating after the cache is wrong — a malformed retry would hit the cache and return the cached success, masking the malformed input.

```go
if err := decode(r, &req); err != nil { fail(w, 400, err); return }
if err := req.Validate(); err != nil { fail(w, 400, err); return }
if cached := idemCache.Get(r.Header.Get("Idempotency-Key")); cached != nil {
    write(w, cached); return
}
result := process(req)
idemCache.Put(r.Header.Get("Idempotency-Key"), result)
write(w, result)
```

**Follow-up:** What if the request body changed between retries with the same idempotency key? Answer: reject with `409 Conflict`. Stripe's API does this — same key, different body is almost always a client bug.

---

### Q19. Retry budgets and Fail-Fast — how do they combine?

**Short answer:** A retry budget caps how many retries the system will spend before declaring the operation failed; Fail-Fast inside each attempt cuts the per-attempt cost. The two layers protect different things. Fail-Fast prevents wasted work on an invalid request — no retries needed if the request is malformed (a 400 is not retried). The retry budget prevents retry storms — if 50% of calls are retrying, half your fleet is doing duplicate work and the downstream gets twice the load. The discipline: 4xx responses are *never* retried (they'd fail fast forever), 5xx responses are retried within budget, and the budget is observable so on-call sees retry rates climbing before the downstream collapses.

**Follow-up:** Why is it dangerous to retry 4xx? Answer: 4xx means "your request is wrong"; retrying with the same request will fail the same way. You burn budget, latency, and downstream capacity for nothing. Retry only when the failure is plausibly transient — 5xx, network errors, deadline exceeded.

---

### Q20. How does Fail-Fast support schema evolution?

**Short answer:** Strict acceptance now makes future schema changes *possible*. If you accept unknown fields today (Postel-style), tomorrow's removal of those fields breaks consumers who'd come to rely on them. If you reject unknown fields today (Fail-Fast), you've established the contract; field changes are explicit and versioned. The same goes for required vs optional — accepting a missing field with a silent default locks the default into the API contract forever. Rejecting it forces the consumer to send the field, and you can evolve the default later without breaking anyone.

Concretely: `json.Decoder.DisallowUnknownFields()` is the Go knob for this. Turn it on at every HTTP boundary and you'll catch typos in client requests before they become "compatibility constraints".

**Follow-up:** What about forward compatibility — receiving a new field from a newer client? Answer: separate concern. Use explicit versioning (`/v2/orders`) or content negotiation rather than silent leniency. The "be liberal" reading of Postel doesn't help; you need an explicit policy.

---

### Q21. What observability metrics do you emit for Fail-Fast?

**Short answer:** Five signals.

1. **`validation_errors_total{endpoint, field, reason}`** counter — every Fail-Fast rejection tagged with the entry point, the field that failed, and the reason. Spikes localize new client bugs in minutes.
2. **`validation_duration_seconds`** histogram — validation should be microseconds; rising tail latency means an expensive check (regex, DNS, DB lookup) crept into the validator.
3. **`request_rejected_total{reason}`** counter — at the layer above validation, count *why* requests didn't proceed: bad JSON, bad auth, validation, circuit breaker. Helps allocate fixes.
4. **`startup_validation_total{check, outcome}`** counter on the binary — proves startup checks ran and which fired.
5. **`panic_total{handler}`** counter — `panic` should be near-zero in production; a non-zero rate means a programmer-error bucket is being mis-used for runtime data, or there's a real bug.

Plus a structured-log line per rejection with the request ID, so the operator can correlate a metric spike to a client.

**Follow-up:** Most useful single metric in an incident? Answer: `validation_errors_total{field, reason}` filtered by `reason="unknown_field"`. A spike usually means a client deployed a typo or a backward-incompatible change. Find the field, find the client, fix in minutes.

---

### Q22. How do generics improve Fail-Fast validation in Go 1.18+?

**Short answer:** Pre-generics, validation libraries used `reflect` and `interface{}`, which meant runtime type assertions and boxing. Generics let you write `Validator[T]` that's type-checked at compile time and inlinable at runtime. The win is twofold: (a) the validator and the validated type are linked at compile time — change the type and the validator fails to build; (b) no allocations per call. The pattern works especially well for *composable* validators: `Chain[T](v1, v2, v3)` that runs sub-validators in order and short-circuits on the first failure.

```go
type Validator[T any] interface { Validate(T) error }

type Chain[T any] []Validator[T]

func (c Chain[T]) Validate(v T) error {
    for _, vd := range c {
        if err := vd.Validate(v); err != nil { return err }
    }
    return nil
}
```

**Follow-up:** When is `reflect`-based still better? Answer: when validation rules come from struct tags decoded at runtime, or when you need to validate dynamic data (JSON without a fixed schema). Generics shine when types are known; `reflect` shines when they're not.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design an org-wide validation policy.

**Short answer:** A policy that scales across hundreds of services has six pieces.

1. **One validation library per language.** Pick `go-playground/validator` (or `protoc-gen-validate`) and ban hand-rolled validators except for cross-field rules. Eliminates format drift across services.
2. **Standard error envelope.** Every 4xx response carries `{code, field, message, request_id}` — clients can branch on `code`, surface `message`, and quote `request_id` in support tickets. One format across the org saves every client team from per-service quirks.
3. **Boundary inventory.** Every service publishes its trust boundaries (HTTP endpoints, message consumers, CLI entry points) and confirms a validator exists at each. Audit annually.
4. **Schema-first.** All public APIs are described in OpenAPI or proto; validators are generated, not handwritten. Drift between docs and runtime becomes structurally impossible.
5. **Validation observability mandate.** Every service emits `validation_errors_total{field, reason}` and surfaces top fields in a shared dashboard. A spike on any service is visible to platform on-call, not just service owners.
6. **Forbid silent defaults.** Org-wide lint rule: missing required fields must return error, not default. Defaults are explicit, versioned, and live in the schema — never "well, if it's empty we'll use 100".

Staff move: name what the policy *doesn't* do — it doesn't dictate business-rule semantics, it doesn't replace per-service expertise. It standardizes the boundary and error format, leaving services free to choose their internal validation depth.

**Follow-up:** How do you roll this out without breaking the org? Answer: target new services first (zero migration cost), then offer tooling that auto-migrates the standard checks on existing services, then deprecate non-conforming endpoints with a 12-month timeline. Never flag-day the whole org.

---

### Q24. Design a multi-tier Fail-Fast: edge, service, DB.

**Short answer:** Each tier validates *different* invariants and discards *different* attack surfaces.

1. **Edge (CDN / WAF / API gateway).** Rejects malformed HTTP, blocks known-bad IPs, enforces rate limits, validates request size and content-type. The cheapest layer; rejection here costs nothing downstream. Common rules: `Content-Type: application/json`, body < 1 MB, valid JWT signature, request from allowed region.
2. **Service (HTTP handler / RPC interceptor).** Validates business shape — required fields, enum values, cross-field rules, idempotency keys. Uses the org's standard validator. By the time the handler runs, every field is type-correct and within business bounds.
3. **Database (constraints, triggers, transactions).** Validates persistence invariants — `NOT NULL`, `CHECK`, foreign keys, unique constraints. The last line of defence: even if a bug bypasses the service layer, the DB refuses to write inconsistent data.

The discipline: each tier assumes the tier above did its job *and* still defends its own invariants. Edge doesn't trust the client; service doesn't trust the edge (an internal client might skip it); DB doesn't trust the service (a buggy migration could send bad data). The cost is duplicate work; the benefit is no single failure breaks the system.

**Follow-up:** Doesn't this triple-validate every field? Answer: yes — and that's correct. Edge checks shape, service checks semantics, DB checks persistence. Different invariants, different layers. Trying to consolidate into one tier saves CPU but loses defence-in-depth and a clear story of who owns which invariant.

---

### Q25. Quantify the blast radius of failing late vs failing fast.

**Short answer:** Frame the comparison along five axes.

1. **Time to detect.** Fail-Fast: detected at the boundary, milliseconds after the bad input arrives. Fail-late: detected when the bad value corrupts something downstream — minutes, hours, or days later.
2. **Number of records affected.** Fail-Fast: one — the rejected request. Fail-late: every record processed since the bug was introduced — possibly millions.
3. **Number of systems affected.** Fail-Fast: zero — the request never reached storage. Fail-late: every downstream system that consumed the bad value — caches, search indexes, analytics, billing.
4. **Recovery cost.** Fail-Fast: zero — nothing changed. Fail-late: restore from backup, replay events, manually reconcile records, refund affected customers, write post-incident review.
5. **Customer trust.** Fail-Fast: client gets a clear 4xx and retries with correct data. Fail-late: silently wrong invoices, broken analytics, eroded confidence in correctness — the kind of thing that loses customers permanently.

The staff insight: the cost of a late failure isn't linear in time; it's exponential because the bad value contaminates everything it touches. Fail-Fast is an O(1) cost; fail-late is O(everything you've done since). Frame it this way in design reviews and "we should be lenient" arguments evaporate.

**Follow-up:** What's the steelman for fail-late? Answer: high-availability systems where rejecting a request is worse than processing a slightly-wrong one — ad serving, recommendation systems, telemetry. The right answer is *graceful degradation* at the right layer, not silent acceptance everywhere. Pick the layer carefully; default everywhere else is Fail-Fast.

---

## 6. Live-coding prompts

### Prompt 1: Custom error type with `Field` and `Reason`

**Problem.** Implement a `ValidationError` type that carries the failing field name, a machine-readable reason, and a human-readable message. Make it work with `errors.As`. Provide a `Join` helper that aggregates many `ValidationError`s into one error.

**Answer.**

```go
package validation

import (
    "fmt"
    "strings"
)

type Reason string

const (
    ReasonRequired   Reason = "required"
    ReasonOutOfRange Reason = "out_of_range"
    ReasonBadFormat  Reason = "bad_format"
)

type ValidationError struct {
    Field   string
    Reason  Reason
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s (%s)", e.Field, e.Message, e.Reason)
}

func New(field string, reason Reason, msg string) *ValidationError {
    return &ValidationError{Field: field, Reason: reason, Message: msg}
}

type Errors struct{ Errs []*ValidationError }

func (e *Errors) Error() string {
    parts := make([]string, len(e.Errs))
    for i, v := range e.Errs { parts[i] = v.Error() }
    return strings.Join(parts, "; ")
}

func Join(errs ...*ValidationError) error {
    cleaned := errs[:0]
    for _, e := range errs { if e != nil { cleaned = append(cleaned, e) } }
    if len(cleaned) == 0 { return nil }
    return &Errors{Errs: cleaned}
}

// Usage:
//   var ve *ValidationError
//   if errors.As(err, &ve) && ve.Reason == ReasonRequired { ... }
```

Senior moves: (a) `Reason` is a typed string constant — type-safe and stable across versions; (b) `Field` and `Message` separated so the handler can serialize as JSON; (c) `Join` returns `error`, not `*Errors`, so the typed-nil trap doesn't bite when all inputs are nil; (d) the package exposes a single shape clients can pattern-match on.

---

### Prompt 2: Generic `Validator[T]` interface

**Problem.** Implement `Validator[T any]` as an interface with a `Validate(T) error` method. Provide a `Chain[T]` that composes validators in order and short-circuits on the first error. Show how to use it on a `User` struct.

**Answer.**

```go
package validate

import (
    "fmt"
    "strings"
)

type Validator[T any] interface { Validate(T) error }

type Chain[T any] []Validator[T]

func (c Chain[T]) Validate(v T) error {
    for _, vd := range c {
        if err := vd.Validate(v); err != nil { return err }
    }
    return nil
}

// ValidatorFunc adapts a plain function to Validator.
type ValidatorFunc[T any] func(T) error

func (f ValidatorFunc[T]) Validate(v T) error { return f(v) }

func MinLen(field string, n int) Validator[string] {
    return ValidatorFunc[string](func(s string) error {
        if len(s) < n {
            return fmt.Errorf("%s: must be >= %d characters", field, n)
        }
        return nil
    })
}

func IsEmail(field string) Validator[string] {
    return ValidatorFunc[string](func(s string) error {
        if !strings.Contains(s, "@") {
            return fmt.Errorf("%s: must contain @", field)
        }
        return nil
    })
}

type User struct{ Name, Email string }

func ValidateUser(u User) error {
    if err := (Chain[string]{MinLen("name", 2)}).Validate(u.Name); err != nil {
        return err
    }
    return (Chain[string]{IsEmail("email"), MinLen("email", 5)}).Validate(u.Email)
}
```

Senior moves: (a) `Validator[T]` is one method — easy to implement, easy to mock; (b) `Chain[T]` is just a slice — composition without a wrapper struct; (c) `ValidatorFunc[T]` is the standard Go adapter pattern so plain functions satisfy the interface; (d) field-level validators are lifted into struct-level validation — no reflection, type-checked end to end.

---

### Prompt 3: HTTP middleware that fail-fasts on invalid JSON

**Problem.** Write `RequireJSON[T]` middleware that decodes the request body into `T`, calls `T.Validate()` if implemented, and either passes the decoded value to the handler or returns `400 Bad Request`. Reject unknown fields. Cap body size.

**Answer.**

```go
package httpx

import (
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
)

const maxBodyBytes = 1 << 20 // 1 MB

type Validatable interface { Validate() error }

type errorBody struct {
    Code    string `json:"code"`
    Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(errorBody{Code: code, Message: msg})
}

func RequireJSON[T any](next func(http.ResponseWriter, *http.Request, T)) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if ct := r.Header.Get("Content-Type"); ct != "" && ct != "application/json" {
            writeError(w, http.StatusUnsupportedMediaType,
                "unsupported_media_type", "Content-Type must be application/json")
            return
        }
        r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
        var v T
        dec := json.NewDecoder(r.Body)
        dec.DisallowUnknownFields()
        if err := dec.Decode(&v); err != nil {
            var mbe *http.MaxBytesError
            if errors.As(err, &mbe) {
                writeError(w, http.StatusRequestEntityTooLarge,
                    "body_too_large", fmt.Sprintf("body exceeds %d bytes", mbe.Limit))
                return
            }
            writeError(w, http.StatusBadRequest, "bad_json", err.Error())
            return
        }
        if dec.More() {
            writeError(w, http.StatusBadRequest, "bad_json", "trailing data after JSON")
            return
        }
        if vv, ok := any(&v).(Validatable); ok {
            if err := vv.Validate(); err != nil {
                writeError(w, http.StatusBadRequest, "validation", err.Error())
                return
            }
        }
        next(w, r, v)
    }
}
```

Senior moves: (a) `DisallowUnknownFields` enforces strict schema — clients can't sneak in fields and lock the API into accepting them; (b) `MaxBytesReader` caps body size at the IO layer, not after reading; (c) `dec.More()` rejects requests with trailing junk (a real source of replay bugs); (d) `Content-Type` check rejects mismatched media types with the correct status (415); (e) `Validatable` interface is opt-in — types without it skip the Validate step.

---

## 7. Concept checks

If you cannot answer any of these in one breath, study more before the interview.

- What is the Fail-Fast pattern? (Check assumptions at the earliest possible point and surface the failure right there.)
- Difference between Fail-Fast and Fail-Safe? (Fast: stop and surface. Safe: continue on a degraded path. Pick per layer based on whether correctness or availability dominates.)
- When do you panic vs return error? (Panic for programmer errors and violated invariants; error for expected runtime failures.)
- Why is `ctx.Err()` Fail-Fast? (Caller has signalled cancellation; checking it before expensive work avoids burning CPU on a result no one will read.)
- What does Postel's law say and why is Fail-Fast its opposite? (Postel: liberal in what you accept. Fail-Fast: strict at trust boundaries. Strictness enables schema evolution and exposes bugs early.)
- Name three stdlib uses of Fail-Fast. (`db.Ping`, `template.Must`, `http.ServeMux` duplicate panic, `gob.Register` duplicate panic, `flag.Parse`, `regexp.MustCompile`.)
- When is a `Must*` helper appropriate? (Startup time, programmer-controlled inputs, where failure means the program cannot run meaningfully.)
- Why validate at the boundary and not in every function? (One trust frontier; past the boundary, code can rely on inputs; one place to keep error format consistent.)
- Struct tag validation vs explicit `Validate()` method? (Tags for declarative shape; explicit method for stateful or cross-field rules. Combine both.)
- How does error wrapping help? (Preserves the original error for `errors.Is`/`As` while adding layered context as the error climbs.)
- Sentinel vs typed error — when each? (Sentinel for binary branches; typed when the caller needs structured data like which field failed.)
- Why validate before consulting an idempotency cache? (A malformed retry would hit the cache and return a cached success, masking the bug.)
- Why never retry a 4xx? (4xx means the request itself is wrong; retrying burns budget and downstream capacity for no chance of success.)
- What's the staff-level blast-radius framing? (Time to detect, records affected, systems affected, recovery cost, customer trust — late failures are exponentially more expensive.)
- What's `DisallowUnknownFields` for? (Forces strict JSON acceptance so clients cannot lock the API into accepting fields that were never part of the contract.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Returns zero values or defaults on bad input.** Hides the bug; downstream sees a "valid" zero that wasn't real input.
- **Uses panic for runtime input errors.** Crashes the process on a bad request; conflates programmer errors with expected failures.
- **Validates deep in the call graph.** Errors travel four layers down before bouncing up; context is lost and CPU is wasted.
- **No `errors.Is` / `errors.As` usage.** String-matches error messages; breaks the moment the format changes.
- **Mentions Postel without nuance.** "Be liberal in what you accept" repeated as gospel; cannot explain why modern systems push back on it.
- **Validates after the idempotency check.** Doesn't see that a bad retry would be silently cached.
- **Retries 4xx.** Doesn't distinguish "your request is wrong" from "the downstream is broken".
- **No metric on validation rejection rate.** Cannot tell when a client deploy starts sending malformed traffic.
- **One-size-fits-all panic everywhere or error everywhere.** Doesn't pick per situation; over-uses one tool and under-uses the others.
- **Ignores startup-time validation.** Lets misconfiguration manifest as 500s in production instead of failing the deploy.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Picks the right failure flavour per situation.** `error` for runtime, `panic` for invariants, `ctx.Err()` for cancellation — unprompted.
- **Validates at the boundary by reflex.** Says "this is the boundary" and lists the checks before discussing business logic.
- **Distinguishes Fail-Fast from Fail-Safe per layer.** Argues for Fail-Safe in telemetry and Fail-Fast in handlers, not blanket choices.
- **Knows when Postel applies.** Cites the "Robustness Principle Reconsidered" and names a place where leniency is still right.
- **Uses `errors.Is` / `errors.As`.** Talks about sentinel errors and typed errors as separate tools for different branching needs.
- **Cites stdlib examples.** Brings up `template.Must`, `db.Ping`, `DisallowUnknownFields` without prompting.
- **Brings observability into the discussion.** Names validation metrics, log structure, and how an operator would diagnose a spike.
- **Frames blast radius quantitatively.** Talks in records, systems, recovery cost — not just "it's bad to fail late".
- **Sees the schema-evolution angle.** Notes that strict acceptance now keeps future API changes possible.
- **Knows where Fail-Fast meets other patterns.** Circuit breaker, retry budgets, idempotency — describes how they compose without being asked.

---

## 10. Further reading

- **"Errors are values" — Rob Pike**: <https://go.dev/blog/errors-are-values> — the philosophical foundation for treating errors as first-class. Five-minute read; reframes how you handle errors throughout a Go codebase.
- **"Don't just check errors, handle them gracefully" — Dave Cheney**: <https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully> — the practical companion. Explains wrapping, sentinel errors, and the trade-offs between approaches.
- **"The Robustness Principle Reconsidered" — Eric Allman**: <https://queue.acm.org/detail.cfm?id=1999945> — the case against Postel's law in modern systems. Required reading for arguing about strictness in design reviews.
- **`go-playground/validator`**: <https://github.com/go-playground/validator> — the de-facto Go validation library. Read the README and the tag reference; you'll use this in every service that takes HTTP input.
- **Stripe's idempotency design**: <https://stripe.com/blog/idempotency> — the canonical write-up of Fail-Fast meeting idempotency at scale. Explains why same-key-different-body must return 409 and how the validation order matters.

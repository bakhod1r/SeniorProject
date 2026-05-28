# Fail-Fast — Professional

> Focus: staff/principal decisions. Fail-Fast is the simplest pattern in this catalogue and one of the most likely to get a service paged. The hard parts are not `if !valid { return err }`. They are: which boundary owns validation, how much CPU to budget, what happens when 200k req/s simultaneously fail-fast against a downstream that just came back up, and why a "harmless" log-and-continue cost a customer six hours of duplicate billing.

---

## 1. Fail-Fast as a system primitive

Fail-Fast is *rejection at the boundary*. The producer (caller) and the consumer (your code) share a contract; the moment the contract is violated, you stop. That decision differentiates Fail-Fast from every adjacent resilience pattern.

| Primitive | When it acts | What it protects | Failure model |
|---|---|---|---|
| Fail-Fast | Before work starts | CPU, downstream, data integrity | Reject with structured error |
| Retry | After transient failure | Throughput under partial outage | Exponential backoff + jitter |
| Circuit breaker | After repeated failures | Downstream from saturation | Open / half-open / closed |
| Bulkhead | Continuously | One tenant from another | Resource pool partitioning |
| Fallback | After failure | User experience | Cached / degraded response |
| Timeout | After elapsed budget | Caller from hanging | Deadline propagation |

Four distinctions:

1. **Preventive vs reactive.** Fail-Fast says "this can never succeed." Retry says "this might succeed if we try again." Mixing produces retry storms (§8).
2. **Local vs statistical.** Fail-Fast rejects *this* request on *this* input. A breaker rejects based on the failure rate of a *peer*. Both coexist: validate input, check breaker, call.
3. **Composes upward.** A handler that fails fast on bad JSON saves codec, validator, ORM, database, and downstream from touching the request. Savings multiply with depth.
4. **Contract, not defence.** Validation in a private function is mostly waste; validation at the boundary is the contract. Internal `if x == nil { panic }` lines are programmer-error assertions, not Fail-Fast.

The rule: **Fail-Fast at every trust boundary; trust within.** HTTP handler, gRPC server, queue consumer, CLI entry — each is a trust boundary that owns validation. Past it, business code assumes correctness. Defensive checks inside a service are duplication and a symptom of a leaky boundary.

---

## 2. Cost analysis

Go 1.24, amd64, Linux 6.8. Validation appears in *every* request; cost matters even when individually small.

```
sentinel: if s == "" { ... }                       ~2 ns
regexp.MatchString (compiled, short input)         ~200 ns
regexp.MatchString (uncompiled per call)           ~50 µs   (never)
go-playground/validator on 10-field struct         ~3 µs
protoc-gen-validate on 10-field proto              ~500 ns  (generated)
JSON Schema (santhosh-tekuri, compiled, 20 keys)   ~1 µs
JSON Schema (interpreted per call)                 ~30 µs
json.Unmarshal of 1 KB                             ~10 µs
proto.Unmarshal of 1 KB                            ~2 µs
```

A `validator` tag check costs ~3 µs. Against a 10 ms DB call, irrelevant. Against a 5 ns lookup-table hit on the hot path, 600x overhead. **Validation cost is only invisible when downstream work dominates.**

**Early-exit savings.** Every rejected request avoids the work it would have caused:

| Stage | Cost if executed | Saved |
|---|---|---|
| JSON decode + struct validation | 13 µs | paid |
| Auth check | 50 µs | saved |
| DB transaction | 200 µs | saved |
| Business logic + writes | ~5 ms | saved |
| Downstream gRPC | 10 ms | saved |
| Total per rejected request | ~16 ms | saved |

At 100 k req/s with a 1% bad-input rate, fail-fast saves 16 s of CPU+IO per second — the difference between healthy and saturated during an attack or a buggy client.

**Where validation belongs.** Each layer fails fast on the constraints *it* owns: edge gateway (schema/size/rate), ingress handler (request struct + auth), application (business invariants), domain (constructor-enforced invariants), infrastructure (physical constraints). Duplicating edge checks in the domain wastes CPU; skipping domain invariants because "the handler already checked" produces corrupt state when a new caller is added. **Each layer's validations are its public contract — not a backstop for the layer above.**

---

## 3. Schema-driven validation

Hand-written `if` chains rot. Every new field is two edits — once in the struct, once in the validator — and the second is what people forget. Schema-driven validation moves the contract into a declarative artifact both sides of the wire understand.

| Schema | Wire format | Cost | Use case |
|---|---|---|---|
| JSON Schema | JSON, YAML | ~1 µs compiled | REST APIs, OpenAPI |
| protoc-gen-validate (PGV) | Protobuf | ~500 ns | gRPC services |
| buf/protovalidate | Protobuf, CEL-based | ~1 µs | New gRPC services |
| FlatBuffers verifier | FlatBuffers | Near-zero | Game state, mobile sync |
| Avro | Avro | ~5 µs | Kafka, event streams |
| CUE | Any | ~10 µs | Config validation |

```go
var compiled *jsonschema.Schema

func init() {
    c := jsonschema.NewCompiler()
    _ = c.AddResource("user.json", strings.NewReader(userSchemaJSON))
    s, err := c.Compile("user.json")
    if err != nil { panic(fmt.Errorf("user schema: %w", err)) }
    compiled = s
}

func validateUser(raw json.RawMessage) error {
    var v any
    if err := json.Unmarshal(raw, &v); err != nil {
        return fmt.Errorf("malformed JSON: %w", err)
    }
    if err := compiled.Validate(v); err != nil {
        return fmt.Errorf("schema violation: %w", err)
    }
    return nil
}
```

Three rules:

- **Compile once, reuse forever.** Per-request compilation is a 100x regression nobody catches until production p99 doubles.
- **Validate before unmarshalling into your typed struct.** Otherwise you re-implement the same checks with `if`.
- **The schema is the API.** Generate OpenAPI and SDKs from it.

**protovalidate for gRPC.** Generated validator code: no reflection, no allocation, ~500 ns for a 10-field message:

```protobuf
message CreateUserRequest {
  string email = 1 [(buf.validate.field).string.email = true];
  int32 age = 2 [(buf.validate.field).int32 = {gte: 13, lte: 120}];
  string display_name = 3 [(buf.validate.field).string = {min_len: 1, max_len: 64}];
}
```

Wire as a gRPC interceptor (§5) and every RPC fails fast without per-handler boilerplate. For Kafka/Pulsar, Avro + Schema Registry is the only sane way to evolve event payloads across hundreds of consumers without coordinated deploys. **Do not hand-roll a schema-shaped problem.** Hand-written validators drift from docs immediately and become the source of auth-bypass CVEs.

---

## 4. Circuit breakers as runtime Fail-Fast

A circuit breaker is *Fail-Fast applied to a peer service.* States: **Closed** (normal, failures counted), **Open** (reject immediately with sentinel error), **Half-Open** (single probe; on success close, on failure re-open with cooldown). Same pattern: stop early, report cheaply, let the system recover.

```go
var paymentsBreaker = gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "payments",
    MaxRequests: 1,
    Interval:    10 * time.Second,
    Timeout:     30 * time.Second,
    ReadyToTrip: func(c gobreaker.Counts) bool {
        return c.ConsecutiveFailures >= 5 ||
            (c.Requests >= 20 && float64(c.TotalFailures)/float64(c.Requests) >= 0.5)
    },
    OnStateChange: func(name string, from, to gobreaker.State) {
        slog.Warn("breaker.state", "name", name, "from", from, "to", to)
        breakerStateChanges.WithLabelValues(name, to.String()).Inc()
    },
})

func charge(ctx context.Context, req ChargeRequest) (*Receipt, error) {
    res, err := paymentsBreaker.Execute(func() (any, error) {
        return paymentsClient.Charge(ctx, req)
    })
    if err != nil {
        if errors.Is(err, gobreaker.ErrOpenState) {
            return nil, ErrPaymentsUnavailable
        }
        return nil, err
    }
    return res.(*Receipt), nil
}
```

hystrix-go (Go port of Netflix Hystrix) is unmaintained; use `sony/gobreaker` or `failsafe-go` (generics-aware).

**Sizing.** Default start: 50% failure over a 10 s rolling window of at least 20 requests, 30 s cooldown.

| Knob | Too low | Too high |
|---|---|---|
| Failure threshold | Trips on noise; fake outages | Slow to trip; downstream saturates |
| Window length | Misses bursty failures | Stays open after recovery |
| Cooldown | Probes too often; thrashes downstream | Slow recovery |

**Where breakers belong:** Redis cache, read replicas, third-party APIs, internal microservices — yes. Same-process functions — no. Database primary — usually no (degrading to read-only is application-specific). **Breakers without a fallback are noise** — they convert "5xx from downstream" into "5xx from breaker." The point is to do something better when open: cached data, queued work, ask to retry.

---

## 5. Distributed Fail-Fast

In a mesh, Fail-Fast is *system policy*, not per-service concern.

**gRPC interceptor validation:**

```go
func ValidateUnaryInterceptor(v *protovalidate.Validator) grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, h grpc.UnaryHandler) (any, error) {
        msg, ok := req.(proto.Message)
        if !ok { return h(ctx, req) }
        if err := v.Validate(msg); err != nil {
            validationFailures.WithLabelValues(info.FullMethod).Inc()
            return nil, status.Errorf(codes.InvalidArgument, "validation failed: %v", err)
        }
        return h(ctx, req)
    }
}

s := grpc.NewServer(grpc.ChainUnaryInterceptor(
    recoveryInterceptor, loggingInterceptor, authInterceptor,
    ValidateUnaryInterceptor(validator),  // BEFORE handler
    metricsInterceptor,
))
```

The same generated rules run as a `UnaryClientInterceptor` on the producer, catching errors before the network call.

**Service mesh policy.** Istio, Linkerd, Consul Connect push validation, rate limiting, and breaking into sidecars: single source of truth in CRDs, polyglot enforcement, SRE owns policy, product owns logic. Cost: ~500 µs per sidecar hop. Fine for most workloads; intolerable for low-latency in-cluster RPC. Many teams keep validation in-process and put rate limiting / breaking at the mesh.

**API gateways.** At the edge, a gateway (Envoy, Kong, AWS API Gateway) fails fast before traffic enters the cluster: TLS, size limits, schema, JWT, rate limits. **Rejecting at the edge is 100x cheaper than inside the cluster** — no namespace traversal, no sidecar, no service load. The edge is the first and most important Fail-Fast boundary; everything else is defence in depth.

**Backpressure as Fail-Fast.** 429 / `ResourceExhausted` with `Retry-After` is the load-shedding pattern: "I cannot serve this now; do not waste cycles." Without it, services degrade gracelessly under overload.

---

## 6. Idempotency keys — Fail-Fast on duplicate

A request is idempotent if executing twice has the same effect as once. Most aren't, and retries from networks, mobile clients, and queue redelivery produce duplicates. The fix: an idempotency key. Client generates a UUID per logical op; server stores `(key) → result` and **fails fast on the second arrival**.

```go
type IdempotencyStore interface {
    Get(ctx context.Context, key string) (resp []byte, ok bool, err error)
    Put(ctx context.Context, key string, resp []byte, ttl time.Duration) error
    Lock(ctx context.Context, key string, ttl time.Duration) error
}

func (s *Server) CreateCharge(ctx context.Context, req *ChargeRequest) (*ChargeResponse, error) {
    key := req.IdempotencyKey
    if key == "" {
        return nil, status.Error(codes.InvalidArgument, "idempotency_key required")
    }
    if cached, ok, err := s.store.Get(ctx, key); err != nil {
        return nil, err
    } else if ok {
        return decodeResponse(cached), nil  // Fail-Fast on duplicate
    }
    if err := s.store.Lock(ctx, key, 30*time.Second); err != nil {
        if errors.Is(err, ErrConflict) {
            return nil, status.Error(codes.AlreadyExists, "in-flight duplicate")
        }
        return nil, err
    }
    resp, err := s.process(ctx, req)
    if err != nil { return nil, err }
    _ = s.store.Put(ctx, key, encodeResponse(resp), 24*time.Hour)
    return resp, nil
}
```

Three correctness conditions:

- **Key in a location you reliably extract.** Stripe uses `Idempotency-Key` header; PayPal uses body. Choose one; audit.
- **Stored response is the final response,** status code included.
- **TTL exceeds the maximum client retry window.** 60 s client + 30 s TTL = double charges. Stripe uses 24 hours.

| Store | Latency | Use when |
|---|---|---|
| Redis `SETNX` + TTL | ~500 µs | Most services |
| DynamoDB conditional | ~5 ms | Financial; must survive cache loss |
| Postgres unique constraint | ~2 ms | Single-database services |

**For payments, the idempotency record must commit in the same transaction as the business write,** or keys survive for rolled-back transactions. Postgres with `UNIQUE(tenant_id, idempotency_key)` solves this for free.

**Retry budget.** Idempotency keys make retries safe; retry budgets make them bounded. A retry budget *fails fast on retries themselves* once retry rate exceeds (say) 10% — the classic sign of a downstream in distress. Idempotency + retry budget + circuit breaker is the canonical retry-safety triad. Pick any two and incidents teach you to want the third.

---

## 7. Observability

A service that fails fast is invisible until you measure rejection. Signals: rejection rate, by reason, with blast radius.

| Metric | Type | Why |
|---|---|---|
| `validation_failures_total{endpoint,reason}` | Counter | Spike = bad deploy or attack |
| `validation_duration_seconds{endpoint}` | Histogram | Regression catches slow regex |
| `breaker_state{name}` | Gauge | Live upstream health |
| `breaker_state_changes_total{name,to}` | Counter | Flap detection |
| `idempotency_duplicates_total{endpoint}` | Counter | Client retry rate |
| `requests_rejected_total{reason}` | Counter | All fail-fast reasons unified |
| `error_budget_remaining{slo}` | Gauge | Burn rate |

Most useful chart: **rejection rate by reason, stacked.** Each reason has a different remediation; aggregated "errors" hides the diagnosis.

**Blast radius.** Label by tenant and client version (bounded cardinality):

```go
validationFailures.With(prometheus.Labels{
    "endpoint": "/v1/charges",
    "reason":   "email_format",
    "tenant":   tenantID,         // < 10k tenants
    "version":  clientVersion,    // a few SDK versions
}).Inc()
```

Never label by raw user ID or full URL path with embedded IDs. Bucket aggressively.

**Error budget burndown.** If SLO is "99.9% of valid requests succeed," rejected-as-invalid requests *should not* burn budget. Compute SLO over `(total - rejected_for_user_error)`. **4xx is contractual; 5xx is your fault.** Burn budget only on 5xx.

**Structured errors:**

```go
type ValidationError struct {
    Field   string `json:"field"`
    Code    string `json:"code"`     // "required", "format", "range"
    Message string `json:"message"`
    Got     any    `json:"got,omitempty"`
}
```

Let clients react programmatically and logs aggregate by `code`. "Wrong format" without the field name is unactionable.

---

## 8. Failure modes

**Silent acceptance of invalid input:**

```go
// BAD — error swallowed
result, _ := strconv.Atoi(input)
charge(result)  // input was "abc"; charged 0 cents

// BAD — error logged, work continues
n, err := strconv.Atoi(input)
if err != nil { log.Println("bad input", err) }
charge(n)  // same outcome, with a forensic breadcrumb
```

Logging is not handling. **Every `_ = ` and every `if err != nil { log... }` without `return` is a future incident.** `errcheck` in CI catches the swallows; log-and-continue needs code review.

**Retry storms after Fail-Fast.** Downstream comes back after a 30 s outage. Every client retries simultaneously. Original throughput was 10 k req/s; current is original + everything queued. Downstream falls over again. Cycle repeats.

| Layer | Defence |
|---|---|
| Client | Full-jitter exponential backoff |
| Client | Retry budget (§6) |
| Server | Token bucket rate limiter |
| Server | Adaptive concurrency limiter |
| Mesh | Outlier detection ejecting hot instances |

Full jitter: `sleep = random(0, base * 2^attempt)`. The random factor must dominate or the herd *spreads* but doesn't *disperse*.

**Alerts on validation spikes.** A 50x spike is rarely a flood of bad users. Almost always: a stricter schema you just deployed, a client deploying a new field, a schema rolled forward without dual validation, or an attacker probing endpoint shape. Alert on rate of change. Runbook: "Was anything deployed in the last 30 minutes? Roll back."

**Panic on user input:**

```go
// BAD — panics on bad JSON; takes down the worker
func handle(msg []byte) {
    var req Request
    if err := json.Unmarshal(msg, &req); err != nil {
        panic(err)  // crashed the consumer
    }
}
```

`panic` is for programmer errors. Bad user input is *expected*. A panicking handler is a DoS primitive. `recover` is a parachute, not a strategy; the fix is to return `error`.

**Half-validation.** Validating each present field is not the same as validating the request makes sense. `email == "" && phone == ""` slips past per-field checks; schema validators express "at least one required" — hand-written ones miss it.

---

## 9. Security

Fail-Fast is input sanitisation. Every Fail-Fast check is a security check; every absent check is a possible CVE.

| OWASP API Top 10 item | Fail-Fast control |
|---|---|
| Broken Object Level Authorization (BOLA) | Resource-ID validation includes auth |
| Excessive Data Exposure | Response schema validation strips fields |
| Lack of Resources & Rate Limiting | 429 at the edge before work |
| Mass Assignment | Allowlist field binding |
| Improper Inventory Management | Schema is the inventory; reject unknown versions |
| Unsafe Consumption of APIs | Validate downstream *responses* too |

**Denying service to invalid input before resource use.** Validation must happen *before* expensive operations:

```go
// BAD — DB query first, validation second
func search(q string) ([]Result, error) {
    results, err := db.Search(q)  // attacker sends 100 KB regex; DB melts
    if err != nil { return nil, err }
    if len(results) > 1000 { return nil, errors.New("too many") }
    return results, nil
}

// GOOD — Fail-Fast first
func search(q string) ([]Result, error) {
    if len(q) > 256 { return nil, ErrQueryTooLong }
    if !validQueryChars(q) { return nil, ErrInvalidQuery }
    return db.Search(q)
}
```

**Validate cheap, then policy, then expensive work.** Order is itself a security property; reordering for "cleanliness" routinely opens DoS holes.

**Mass assignment.** Never bind the public payload directly to the persistence struct:

```go
// VULNERABLE
var u User
_ = json.NewDecoder(r.Body).Decode(&u)
db.Save(&u)  // attacker set IsAdmin: true

// SAFE — explicit allowlist DTO
type UpdateUserRequest struct {
    DisplayName *string `json:"display_name,omitempty"`
    Email       *string `json:"email,omitempty"`
}
```

DTO and entity are different types on purpose. Every team learns this the day a customer becomes an admin via curl.

**Size limits everywhere.** `http.MaxBytesReader(w, r.Body, 1<<20)`, `multipart.Reader.ReadForm(maxMemory)`, gRPC `MaxRecvMsgSize`, every queue consumer. Missing limits is a top cause of "OOM at 03:00."

**Constant-time comparison.** Fail-Fast's natural shape — return on first mismatch — is a timing attack on secret comparison:

```go
if subtle.ConstantTimeCompare([]byte(api.Key), []byte(provided)) == 0 {
    return ErrUnauth
}
```

Cost: microseconds. Bug: credential leak.

---

## 10. Schema evolution

A schema lives forever. Every backwards-incompatible change is a coordinated multi-team deploy. **Every change is breaking unless proven otherwise.**

| Change | Safe? |
|---|---|
| New optional field | Yes |
| New enum value | Mostly — needs default branch on consumer |
| New required field | **No** |
| Field type widening (int32 → int64) | JSON yes; protobuf no |
| Field removal | No |
| Field rename | No (remove + add) |

**Deprecation warnings:**

```go
func (s *Server) Charge(ctx context.Context, req *ChargeRequest) (*ChargeResponse, error) {
    if req.LegacyCurrency != "" {
        deprecatedFieldUsage.WithLabelValues("Charge", "legacy_currency").Inc()
        slog.Warn("deprecated field used",
            "method", "Charge", "field", "legacy_currency",
            "tenant", tenantFromCtx(ctx))
        if req.Currency == "" {
            req.Currency = req.LegacyCurrency
        }
    }
    // ...
}
```

Three phases, mandatory:

1. **Announce.** `slog.Warn` + Prometheus counter on every use. One release cycle minimum.
2. **Document.** Update SDK docs and OpenAPI/protovalidate annotations. Email paid-API customers.
3. **Remove.** Only when the counter has been zero for two release cycles across all environments — staging included.

Skipping any phase breaks a consumer you don't know about.

**Dual validation during migration:**

```go
func validate(raw json.RawMessage) error {
    if err := schemaV2.Validate(raw); err == nil { return nil }
    if err := schemaV1.Validate(raw); err == nil {
        v1Acceptance.Inc()
        return nil
    }
    return ErrInvalid
}
```

Accept under either schema; count v1 acceptances; remove when zero for a release cycle. **Strict mode is the destination, not the start.**

**Schema Registry as governance.** Confluent / AWS Glue / Apicurio enforce compatibility modes:

| Mode | Default for |
|---|---|
| `BACKWARD` | Event streams — new consumers read old events |
| `FORWARD` | When you must roll producers first |
| `FULL` | Safest; slows evolution |
| `NONE` | "We accept production incidents" |

Choose explicitly; do not accept defaults.

---

## 11. Anti-patterns at scale

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Log-and-continue on validation error | Silent corruption | Return error; reject |
| `result, _ := op()` | Wrong arithmetic; phantom transactions | Handle every error |
| Blanket catch returning 200 | Clients believe writes succeeded that didn't | Return 4xx/5xx with reason |
| `recover()` as flow control | Crashes hidden; bugs never fixed | Recover only at top, log + 500 |
| Validation in middleware *and* handler | CPU doubled; rules drift | One owner; tests assert layout |
| Panic on user input | DoS vector | Return `error` |
| Regex compiled per request | p99 spikes | `regexp.MustCompile` at init |
| `json.Unmarshal` into `map[string]any` | Silent acceptance of anything | Typed struct or schema |
| Validation after partial work | Half-applied state on error | Validate first, mutate second |
| "Be liberal in what you accept" | Backwards-incompatibility bugs | Strict at boundary; deprecation cycle |
| Idempotency key in header but not body | Logging strips it; replays missed | Define one location; lint |
| Breaker without fallback | "5xx from breaker" instead of "5xx from downstream" | Implement degraded mode |
| No size limits | OOM, GC thrash | `MaxBytesReader`, `MaxRecvMsgSize` |
| Bind public payload to entity | Mass assignment; admin escalation | Separate DTO and entity |
| Validation in domain only, not boundary | Wasted CPU through layers | Validate at boundary, trust within |
| Error message echoing field value (PII) | Logs full of emails, tokens | Hash or redact |
| Sentinel `==` not `errors.Is` | Wrapped errors slip through | `errors.Is`/`As` everywhere |
| Different validation server vs SDK | Server rejects what SDK accepted | Generate both from one schema |

The deepest anti-pattern: **Fail-Fast as defensive coding instead of contract.** Defensive coding sprinkles `if x == nil` everywhere for a false sense of safety. Contract-based Fail-Fast names the boundary, places the check there, documents the rule, and **trusts the rest of the codebase.** First produces slow, brittle, untestable code; second produces a system where you can reason about where errors come from.

---

## 12. Closing principles

Fail-Fast is *rejection at the boundary*. The defining trade is **strict-now vs lenient-now-debug-later** — "later" is always more expensive.

1. **Early loud failures are cheap; late silent failures are expensive.** Validation at the handler: 3 µs and a structured 4xx. The same bad input reaching the database: constraint violation, half-applied transaction, angry customer, postmortem. Six orders of magnitude.

2. **The boundary owns the contract.** Each trust boundary fails fast on the rules it owns. Inside, business code trusts its inputs. Defensive duplication is a symptom of a leaky boundary.

3. **Schemas are the contract.** Hand-written `if` chains drift from docs immediately. JSON Schema, protovalidate, Avro — pick the technology that fits the wire format, generate validators, treat the schema as the API.

4. **Validation, breaker, retry budget, idempotency are one system.** Each is Fail-Fast applied to a different failure mode. Skipping one produces the incident that teaches you to want it.

5. **Log-and-continue is not handling.** Every `if err != nil { log... }` without `return` is a future incident. `_ = err` requires a comment. CI lints both.

6. **`panic` is for programmer errors.** Bad user input is expected and gets `error`. A handler that panics on input is a DoS primitive.

7. **Validate cheap, then policy, then expensive work.** Order is itself a security property. Body size before parse, auth before query, rate limit before computation.

8. **Schema evolution requires dual validation.** Deprecate over three release cycles; remove only when telemetry shows zero use. Day-one strict breaks the long tail of clients you cannot reach.

9. **Multi-tenant means tenant-scoped errors and metrics.** Label by tenant (bounded cardinality) to know blast radius without paging.

10. **Observe rejection, not just success.** Rate by reason, broken out by tenant and client. Burn budget on 5xx, not 4xx.

Get these right and Fail-Fast is invisible: invalid input bounces with a structured error, downstreams are insulated, retries are safe. Get them wrong and the on-call is a worker crashing on bad JSON, a retry storm taking down a recovered service, a customer billed twice because the idempotency key was in a stripped header, and a mass-assignment bug making attackers into admins. **Fail-Fast is the cheapest pattern to write and one of the easiest to operate carelessly.** Rejection at the boundary is the contract; the rest of the system is built on the assumption that the boundary did its job.

---

## Further reading

- Dave Cheney, *Don't just check errors, handle them gracefully*; Rob Pike, *Errors are values*
- Eric Allman, *The Robustness Principle Reconsidered* — Postel's law as anti-pattern
- `bufbuild/protovalidate`, `santhosh-tekuri/jsonschema`, `sony/gobreaker`, `failsafe-go/failsafe-go`
- Netflix `concurrency-limits` — adaptive concurrency limiting
- AWS Architecture Blog, *Exponential Backoff And Jitter*
- Stripe Engineering, *Designing robust and predictable APIs with idempotency*
- OWASP API Security Top 10; Marc Brooker, *Timeouts, retries, and backoff with jitter*
- Confluent Schema Registry — compatibility modes
- Tyler Treat, *You Cannot Have Exactly-Once Delivery*

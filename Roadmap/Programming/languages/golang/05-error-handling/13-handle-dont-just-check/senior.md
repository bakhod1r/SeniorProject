# Handle, Don't Just Check — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Error Handling as an Architectural Property](#error-handling-as-an-architectural-property)
3. [Building a Boundary-Aware Error Strategy](#building-a-boundary-aware-error-strategy)
4. [Idempotency at Scale](#idempotency-at-scale)
5. [Circuit Breakers and Bulkheads](#circuit-breakers-and-bulkheads)
6. [Degraded Mode Design](#degraded-mode-design)
7. [Error Budgets and SLOs](#error-budgets-and-slos)
8. [Cross-Service Error Propagation](#cross-service-error-propagation)
9. [Saga and Compensation Patterns](#saga-and-compensation-patterns)
10. [Observability of Handling Decisions](#observability-of-handling-decisions)
11. [Architectural Anti-Patterns](#architectural-anti-patterns)
12. [Worked Example: Multi-Service Checkout](#worked-example-multi-service-checkout)
13. [Cheney vs. Exception-Based Languages](#cheney-vs-exception-based-languages)
14. [Code Review at Senior Level](#code-review-at-senior-level)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

At senior level, "handle, don't just check" is not a coding style; it is a **system property**. The question is no longer "did this PR write the right `if err != nil` block" but "does this service produce errors that the next service over can act on" and "can the on-call engineer in 2026 actually do something with this log line at 3 AM."

The decisions that shape error handling at architectural level are made *before code is written*: where errors are translated, where retries happen, what counts as a 'transient' failure, how the system degrades when one dependency goes dark. Get these right and individual `if err != nil` lines are mostly mechanical. Get them wrong and no amount of careful local handling will save you.

This file is about the architectural side of Cheney's principle: **how to build services where every error has an owner and every failure has a graceful response.**

---

## Error Handling as an Architectural Property

Three properties separate a system that *handles* errors from one that merely *checks* them at scale:

1. **Owners.** Every error has exactly one layer responsible for deciding what to do. No error is logged twice; no error is swallowed; no error is surfaced through five layers without a single decision.

2. **Vocabularies.** Each layer speaks its own language for failure (driver errors → sentinels → domain errors → status codes). Translation happens at boundaries deliberately, not by accident.

3. **Failure modes.** The system has a documented response to every dependency outage: cache miss → degraded mode; auth provider down → cached tokens; analytics down → fire-and-forget.

When you join a service that gets these three right, you can debug any failure in minutes. When you join one that gets them wrong, every incident is a forensic project.

---

## Building a Boundary-Aware Error Strategy

A **boundary** is anywhere the meaning of "error" changes. Common boundaries:

| Boundary | Translation |
|----------|-------------|
| Storage adapter → domain | `sql.ErrNoRows` → `ErrNotFound` |
| Domain → application | Wrap with use-case context |
| Application → transport | Sentinel → HTTP status / gRPC code |
| Transport → user | Generic message; details to log |
| Worker → scheduler | Result + metric |
| Service A → Service B | gRPC `status.Status` with code + message |

Senior teams document the **error model** for the service: a small list of public sentinels, the rules for when to wrap, and the boundary mapping table. New developers refer to this document; PR review enforces it.

Example: `Order Service Error Model`

```
PUBLIC SENTINELS (returned from public methods):
  ErrOrderNotFound       -> 404, NotFound
  ErrOrderAlreadyPaid    -> 409, AlreadyExists
  ErrInvalidAmount       -> 400, InvalidArgument
  ErrPaymentDeclined     -> 402, FailedPrecondition

WRAPPING RULES:
  - Storage adapters: wrap driver errors with "op: %w" and translate
    sql.ErrNoRows / driver.ErrBadConn / pgx-specific to sentinels above.
  - Domain layer: never wrap; sentinels pass through unchanged.
  - Application layer: wrap with use case ("ChargeOrder %s: %w").
  - Transport: do not wrap; map sentinel → status code.

LOGGING:
  - Top-level handler logs once, structured, with request_id and trace_id.
  - All other layers return without logging.
  - Worker recovery logs panic + stack and continues / restarts.
```

Three pages of conventions; saves three months of confusion.

---

## Idempotency at Scale

Retry is the most common failure-recovery technique in distributed systems, and idempotency is its prerequisite. A senior service is built to be retry-safe; idempotency is not bolted on.

### Patterns to make operations idempotent

1. **Idempotency keys.** The client sends a unique key with each request. The server stores keys → results. A duplicate key returns the stored result without redoing the work. Stripe, Square, and many financial APIs work this way.

2. **Conditional updates.** "Update if version = 5" — second update with the same version fails harmlessly.

3. **Upserts with deterministic IDs.** Generate the resource ID on the client (UUID); inserts on the same ID are no-ops.

4. **Idempotent state transitions.** "Mark paid" is naturally idempotent — applying twice has the same result as once. "Add 5 dollars" is not — guard with a transaction or version.

### Implementation: idempotency-key middleware

```go
type IdempotencyStore interface {
    Get(ctx context.Context, key string) (Response, bool, error)
    Put(ctx context.Context, key string, resp Response) error
}

func IdempotencyMiddleware(s IdempotencyStore) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := r.Header.Get("Idempotency-Key")
            if key == "" {
                next.ServeHTTP(w, r)
                return
            }
            if cached, ok, err := s.Get(r.Context(), key); err == nil && ok {
                writeCached(w, cached)
                return
            }
            // capture response, then store on success
            recorder := newRecorder(w)
            next.ServeHTTP(recorder, r)
            if recorder.status < 500 {
                _ = s.Put(r.Context(), key, recorder.snapshot())
            }
        })
    }
}
```

The middleware turns retries into safe operations. The server can then retry from any layer without worrying about double-charging the customer.

### Why this matters for *handling*

Without idempotency, you cannot retry. Without retry, transient errors must be surfaced as failures. Surfacing every transient failure is itself a failure mode — the user sees a 500 for what was a 100ms blip. Idempotency converts a class of "must surface" errors into "can recover".

---

## Circuit Breakers and Bulkheads

Two classic patterns from Michael Nygard's *Release It!*, both about *not making a bad situation worse*.

### Circuit breaker

A breaker has three states:

| State | Behaviour |
|-------|-----------|
| **Closed** | Calls flow normally; failures are counted. |
| **Open** | After N failures in window, calls fail immediately without hitting the dependency. |
| **Half-open** | After cooldown, allow a probe call. Success → closed. Failure → open. |

The point: **stop hammering a downstream that is already struggling.** A retry without a breaker turns a struggling service into a dead one.

```go
type Breaker struct {
    mu      sync.Mutex
    state   int       // closed=0, open=1, half=2
    fails   int
    opened  time.Time
    th      int           // failure threshold
    cool    time.Duration // cooldown before half-open
}

func (b *Breaker) Do(op func() error) error {
    b.mu.Lock()
    if b.state == 1 {
        if time.Since(b.opened) > b.cool {
            b.state = 2 // half-open
        } else {
            b.mu.Unlock()
            return ErrBreakerOpen
        }
    }
    b.mu.Unlock()

    err := op()

    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.fails++
        if b.fails >= b.th {
            b.state = 1
            b.opened = time.Now()
        }
        return err
    }
    b.fails = 0
    b.state = 0
    return nil
}
```

Real implementations (Sony's `gobreaker`, Hystrix) handle metrics and concurrency more carefully, but the shape is this.

### Bulkhead

Isolate failure domains. If service A and service B are both behind one connection pool, A going slow saturates the pool and B suffers too. Separate pools (separate "bulkheads") keep failures contained.

```go
// Bad: shared pool
sharedClient := http.Client{Transport: sharedTransport}

// Good: bulkheads
authClient   := http.Client{Transport: newTransport(maxConns: 10)}
paymentClient := http.Client{Transport: newTransport(maxConns: 50)}
```

When the auth service goes slow, payment requests are unaffected.

### Where these fit

These patterns convert otherwise-unhandled cascades into *handled* failures: an open breaker is a *decision* — "we know auth is down, we will not even try". The caller gets `ErrBreakerOpen` and decides what to do (degraded mode, error to user, retry later).

---

## Degraded Mode Design

A senior service has explicit *modes*:

| Mode | Description |
|------|-------------|
| **Normal** | All dependencies healthy, full feature set. |
| **Reduced** | Some dependencies degraded; fall back to caches, defaults, generic responses. |
| **Read-only** | Database write path failing; serve reads only. |
| **Maintenance** | Operator-flipped; small static page. |

Each mode is implemented as a set of *fallback decisions* in the handler layer, often gated by feature flags or health checks.

```go
func recommendHandler(deps *Deps) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if deps.RecommenderHealth.IsDegraded() {
            renderJSON(w, deps.GenericFeed.Latest()) // recover: degraded
            return
        }
        items, err := deps.Recommender.For(r.Context(), userID(r))
        if err != nil {
            log.Printf("recommender error: %v", err)
            renderJSON(w, deps.GenericFeed.Latest()) // recover: emergency
            return
        }
        renderJSON(w, items)
    }
}
```

Two recovery paths: one *proactive* (the breaker says we are degraded), one *reactive* (the call failed). Both end at the same fallback so the user gets *something* either way.

The architectural rule: **prefer "users see something less" to "users see an error".** Most non-transactional endpoints can degrade; transactional ones (payments, account changes) generally must fail loudly.

---

## Error Budgets and SLOs

A *service-level objective* (SLO) is a target for reliability: 99.9% of requests succeed, p99 latency < 300ms. The complement is the *error budget*: 0.1% of requests are *allowed* to fail. The error budget is what lets you risk anything.

### Why SLOs matter for handling

Once you have an error budget, "handle the error" becomes a budget decision:

- *Burning budget fast?* Make handling more conservative — bigger circuit breaker thresholds, less aggressive retries, slower deploys.
- *Plenty of budget left?* Take more risk — feature flags, canary rollouts, even chaos experiments.

The decision of *whether* to surface an error to the user depends on what doing so costs in error-budget terms. A 5% transient failure rate that retries to 0.5% real failure is a budget choice.

### Implementation: SLI middleware

Service-Level Indicators are the metrics that feed the SLO:

```go
func sliMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rec := &statusRecorder{ResponseWriter: w, status: 200}
        start := time.Now()
        next.ServeHTTP(rec, r)
        elapsed := time.Since(start)
        success := rec.status < 500
        sliCounter.WithLabelValues(strconv.FormatBool(success)).Inc()
        sliLatency.WithLabelValues(r.URL.Path).Observe(elapsed.Seconds())
    })
}
```

Errors that are *expected* (4xx) are not budget-burning; errors that are *internal* (5xx) are. The middleware enforces this distinction.

---

## Cross-Service Error Propagation

In a distributed system, the question "where to handle?" extends across processes. A gRPC client calling a gRPC server: which side handles which error?

### Standard pattern

| Failure | Handled by |
|---------|------------|
| Network connectivity | Client retries (server didn't see the call). |
| Server returned `Unavailable` | Client retries. |
| Server returned `InvalidArgument` | Client surfaces to *its* caller — fixing input is upstream. |
| Server returned `Internal` | Client may retry once, then surface. Server logged the cause. |
| Client deadline exceeded | Client surfaces as timeout to its caller. |

The server records the cause; the client records the request. Each side knows half of the story.

### gRPC error mapping

```go
import (
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

func (s *Server) GetUser(ctx context.Context, req *pb.GetUserReq) (*pb.User, error) {
    u, err := s.repo.Get(ctx, req.Id)
    if err != nil {
        switch {
        case errors.Is(err, ErrUserNotFound):
            return nil, status.Error(codes.NotFound, "user not found")
        case errors.Is(err, ErrPermissionDenied):
            return nil, status.Error(codes.PermissionDenied, "")
        default:
            log.Printf("GetUser %d: %v", req.Id, err)
            return nil, status.Error(codes.Internal, "internal error")
        }
    }
    return toProto(u), nil
}
```

The boundary is the gRPC handler. Domain errors stop being domain errors and become `status.Status`. Internal details never cross.

### Client side

```go
u, err := client.GetUser(ctx, &pb.GetUserReq{Id: 42})
if err != nil {
    s, _ := status.FromError(err)
    switch s.Code() {
    case codes.NotFound:
        return ErrUserNotFound // re-translate at this side's domain
    case codes.Unavailable:
        return ErrTransient // retry candidate
    default:
        return fmt.Errorf("get user 42: %w", err)
    }
}
```

The client *re-translates* gRPC codes back into its own domain vocabulary. Each service has its own dialect; the wire is the lingua franca.

---

## Saga and Compensation Patterns

In a distributed system that crosses transactional boundaries, you cannot wrap five microservice calls in one transaction. The standard answer is a **saga**: a sequence of local transactions, each with a compensating action that undoes it.

### Pattern

```
1. Reserve inventory   → on failure: nothing to undo
2. Charge payment      → on failure: release inventory
3. Ship                → on failure: refund payment, release inventory
4. Mark complete       → on failure: try again (idempotent)
```

Each step is an operation; each operation has an explicit compensator. The orchestrator (or a choreography) knows which compensator to run based on which step failed.

### Implementation sketch

```go
type Step struct {
    Do        func(ctx context.Context) error
    Undo      func(ctx context.Context) error
}

func RunSaga(ctx context.Context, steps []Step) error {
    var done []Step
    for _, s := range steps {
        if err := s.Do(ctx); err != nil {
            // run compensators in reverse order
            for i := len(done) - 1; i >= 0; i-- {
                if cerr := done[i].Undo(ctx); cerr != nil {
                    log.Printf("compensation failed: %v", cerr)
                    // record for manual reconciliation
                }
            }
            return fmt.Errorf("saga failed at step %d: %w", len(done), err)
        }
        done = append(done, s)
    }
    return nil
}
```

The handling decision at each step is *not* "surface the error" — it is "compensate then surface". Surfacing an error after a partial commit is a form of swallowing: the user gets back a 500, but the world is in an inconsistent state.

### Saga vs 2PC

Two-phase commit guarantees atomicity but requires a coordinator and is not available across heterogeneous services. Sagas accept eventual consistency in exchange for autonomy — each service handles its own errors locally and the saga handles the rollback.

---

## Observability of Handling Decisions

A handled error should leave a trace. Three ways to make handling visible:

### 1. Structured logs with the decision recorded

```go
slog.Info("recovered",
    "decision", "fallback",
    "reason", "personaliser_unavailable",
    "user_id", userID,
    "error_kind", "timeout",
)
```

Now you can query: "how often did we fall back yesterday because of personaliser timeouts?"

### 2. Metrics on decisions

```go
// Counter labelled by decision
errorDecisions.WithLabelValues("retry", "transient").Inc()
errorDecisions.WithLabelValues("recover", "fallback").Inc()
errorDecisions.WithLabelValues("surface", "domain").Inc()
```

A dashboard of decisions by kind tells you whether your retry policy is doing useful work or simply hiding a real outage.

### 3. Traces with span events

```go
span.AddEvent("retry", trace.WithAttributes(
    attribute.String("reason", "transient"),
    attribute.Int("attempt", 2),
))
```

When investigating a slow trace, the events tell you the request retried twice — that 800ms came from waiting, not from work.

### Why decisions need observability

A retry that always succeeds on the second try is fine in normal times. But if 30% of your calls retry, the upstream is trending bad and your latency has doubled silently. Without visible *decisions*, you only see the symptoms.

---

## Architectural Anti-Patterns

### 1. Catch-all middleware that hides domain meaning

```go
defer func() { if r := recover(); r != nil { http.Error(w, "error", 500) } }()
```

Every panic becomes a 500, regardless of whether it was a NotFound, a validation failure, or a bug. Translation must happen *before* the recovery.

### 2. Retry policies set by copy-paste

Every team copies the same retry helper but adjusts constants (3 retries, 100ms backoff). Now the latency budget for any single request is 3 services × 3 retries × backoff = many seconds. *Multiplicative retries* are a known killer.

Solution: enforce *one* retry layer per request graph. Inner services do not retry; outermost does.

### 3. Logging the same error in every layer

Already discussed; deserves repeating because it scales catastrophically. A team of 50 logging "from habit" produces a log volume the SRE team cannot handle.

### 4. Generic error messages user-facing

`"internal server error"` is fine for the *content*; the *response code* tells the user it is server-side. But `"error"` for a 4xx tells the user nothing — they cannot fix what they did.

### 5. No degraded mode

Every dependency is *required*. A 50ms blip in a non-critical service surfaces as a user-visible failure. The architecture has no graceful degradation.

### 6. Sharing connection pools across criticality

Auth and search share a pool. Search slows; auth waits behind it; logins fail. Bulkheads exist for this.

### 7. Custom panic handlers that re-throw

A worker recovers a panic, "logs it", then exits the goroutine — losing the worker. *Or* re-panics into a goroutine the parent does not own. Both are silent breakage.

---

## Worked Example: Multi-Service Checkout

A realistic distributed checkout, with handling decisions explicit:

```
[Frontend] -> [Checkout] -> [Inventory] -> [Payment] -> [Fulfillment]
                  |             |              |              |
                  |          local DB      Stripe API     local DB
                  |             |              |              |
                  +-- saga orchestrator with compensators ---+
```

Decisions per service:

| Service | Decisions |
|---------|-----------|
| **Frontend** | Retry on `Unavailable`. Surface validation errors immediately. Show degraded UI on full outage. |
| **Checkout (orchestrator)** | Run saga. On partial failure → run compensators → surface. Log once with saga ID. |
| **Inventory** | Reserve is idempotent (key = order ID). Retry on transient. Sentinel `ErrOutOfStock`. |
| **Payment** | Idempotency key required (Stripe API). Retry on transient. Sentinel `ErrCardDeclined`. |
| **Fulfillment** | Mark in DB; idempotent on order ID. Retry until success. |

Failure modes:

| Failure | Response |
|---------|----------|
| Inventory service down | Frontend shows "checkout temporarily unavailable" — no compensation needed (no work started). |
| Inventory reserved, Payment service times out | Compensate: release reservation. User sees "payment failed, please retry". |
| Payment succeeded, Fulfillment service down | Saga retries Fulfillment. The payment is done; the user is told "your order is confirmed". The saga keeps trying in the background. |
| Inventory + Payment succeed, Fulfillment fails permanently | Compensate: refund payment, release inventory. User sees "we could not complete your order; refund issued". |

Each failure is *handled*, not just checked. The saga has a decision for every step's failure; the orchestrator has a single owner for the whole flow; each service translates its own errors at its boundary.

That kind of design — *failure modes designed before the happy path is fully built* — is what senior-level error handling looks like.

---

## Cheney vs. Exception-Based Languages

A frequent question: *isn't Java's try/catch easier?*

| Aspect | Go (errors as values) | Java (exceptions) |
|--------|------------------------|-------------------|
| Failure visibility | Explicit in every signature | Hidden in the type system unless `throws` is required |
| Default handling | Forced to think (no implicit propagation) | Default propagation up the stack |
| Cost | Free per check; allocations per wrap | Stack capture per throw; ~µs |
| Ease of "ignore" | `_ = err` makes it visible | `try { ... } catch (Exception ignored) {}` makes it nearly invisible |
| Layered translation | Manual but uniform | Often skipped; original exception bubbles to the boundary |
| Recovery decisions | Local, value-based | Often global, in a single catch-all |

Cheney's argument: forcing the writer to *say* something at every error site makes lazy handling visible. The verbosity is the *feature*, because it surfaces decisions that exception-based code hides.

The cost: there are more lines on the page. Mature Go developers stop seeing them; new developers find them noisy. The middle path is the discipline of this topic — make the *content* of those lines say something useful.

A pithy summary: *Java handles errors at the catch site; Go handles them at the throw site.* The throw site is closer to the cause, has more context, and is harder to copy-paste-and-forget. That is the case for the value-based model.

---

## Code Review at Senior Level

A senior reviewer reads error handling with three lenses:

### 1. Layer responsibility

Does the layer making this decision have the right *information* to make it? A storage adapter retrying based on HTTP status codes is misplaced; the policy belongs at the application layer.

### 2. System-wide consistency

Does this PR follow the team's published error model? New sentinel? Documented in the model? Mapped to a status code?

### 3. Failure-mode coverage

What does this code do when its dependencies are down? When the request times out? When the upstream returns malformed data? Are those modes tested?

A senior PR comment looks like:

> "This retries on any error. Should we restrict to transient? Otherwise we will retry validation errors forever and exhaust the budget. Also: the wrap message says 'failed' — could you say what it failed to do, with the entity ID?"

Specific. Names a layer responsibility. Suggests an alternative.

---

## Summary

At senior level, "handle errors gracefully" is an architectural property: every error has an owner, every boundary translates, every dependency has a documented failure mode. Idempotency converts surface-only errors into recoverable ones. Circuit breakers and bulkheads prevent local failures from cascading. Degraded mode keeps users served. SLOs and error budgets turn handling into a measurable discipline. Sagas extend the same rules across service boundaries with explicit compensation. Observability of *decisions* — not just outcomes — is what separates a service that fails loudly and clearly from one that fails confusingly. The keystroke-level lessons of junior and middle level apply at every line; the architecture is what makes them sum to a debuggable, operable system.

---

## Further Reading

- *Release It!* — Michael Nygard (circuit breakers, bulkheads, stability patterns)
- [Site Reliability Engineering — Google](https://sre.google/sre-book/table-of-contents/) — error budgets and SLOs
- [Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency)
- [Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [gRPC — Standard error model](https://grpc.io/docs/guides/error/)
- [Sony's gobreaker](https://github.com/sony/gobreaker) — production circuit breaker
- [The Twelve-Factor App — admin processes / disposability](https://12factor.net/)
- [Hystrix — How it works](https://github.com/Netflix/Hystrix/wiki/How-it-Works) — historical reference for breaker design
- [OpenTelemetry — Error handling guidelines](https://opentelemetry.io/docs/specs/semconv/general/attributes/#error-attributes)

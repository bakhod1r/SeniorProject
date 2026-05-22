# Chain of Responsibility — Practice Tasks

Build up a middleware/handler chain. Use `go test -race`.

---

## Task 1 (Junior): Approval chain (object form)
Implement an expense-approval chain: `TeamLead` approves ≤ $100, `Manager` ≤ $1,000, `Director` ≤ $10,000, otherwise "rejected". Each handler approves or forwards. Wire them with `SetNext` and test all four outcomes.

**Acceptance:** $50 → team lead, $500 → manager, $5,000 → director, $50,000 → rejected.

---

## Task 2 (Junior): Middleware chain (function form)
Reimplement a request pipeline with `type Middleware func(HandlerFunc) HandlerFunc`. Write `Logging` (prints method+path then forwards) and `Auth` (rejects with 401 if no token, else forwards). Provide `Chain(h, mw...)` and assert `Logging` runs before `Auth`.

**Acceptance:** ordered output; missing token short-circuits with 401 and the final handler does not run.

---

## Task 3 (Middle): Catch the dropped request
Introduce a buggy middleware that forgets to call `next`. Write a test that fails because the final handler never runs. Then fix the middleware. 

**Acceptance:** test detects the drop; after the fix the final handler runs.

---

## Task 4 (Middle): Order-dependent security test
Build `Chain(routes, Logging, Auth)` where `Logging` dumps the request body. Write a test showing that with this order, unauthenticated bodies get logged. Reorder to `Auth, Logging` and assert unauthenticated requests are rejected before logging. Explain in a comment why order is a security concern.

**Acceptance:** test demonstrates both orders; comment explains the risk.

---

## Task 5 (Middle): Context propagation
Add a `RequestID` middleware that puts an ID in the context, and a final handler that reads it. Add a `Timeout` middleware using `context.WithTimeout`. Write a test proving the ID reaches the handler and that a slow handler is cancelled by the timeout.

**Acceptance:** handler sees the request ID; slow handler returns a context-deadline error.

---

## Task 6 (Senior): Build once, not per request
Write a handler that (wrongly) calls `Chain(...)` inside `ServeHTTP`. Benchmark it, then refactor to build the chain once at startup. Compare allocations/op.

**Acceptance:** benchmark shows allocations drop to ~0 per request after the fix.

---

## Task 7 (Senior): gRPC-style interceptor chain
Define `type Interceptor func(ctx context.Context, req any, next Handler) (any, error)`. Implement `Recovery` (recovers panics into an error) and `Auth`. Compose them with a `ChainInterceptors` helper. Test that a panic in the inner handler becomes an error and that auth short-circuits.

**Acceptance:** panic → error (no crash); unauthorized → early return; both run in the right order.

---

## Task 8 (Senior): Observable short-circuits
Extend Task 2's `Auth` to emit a structured log line naming the link and reason on every rejection. Write a test asserting that a rejected request produces exactly one such log entry and that the final handler is not called.

**Acceptance:** one structured rejection log per denied request; handler not invoked.

---

## Stretch
- Make the chain data-driven: assemble different middleware lists per route from a config map.
- Add per-link latency metrics and verify each link records one timing sample per request.

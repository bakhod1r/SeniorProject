# Chain of Responsibility — Professional

## 1. Introduction
> Focus: team-level decisions — when a chain pays off, how to review chain code, and how middleware/interceptor chains ripple through a codebase and operations.

CoR is one of the most-used patterns in real Go services because HTTP and gRPC middleware *are* CoR. The professional concern is keeping chains comprehensible, correctly ordered, and observable as the team grows.

---

## 2. When to introduce a chain
Introduce CoR when:
- Multiple independent concerns apply to a request (auth, logging, rate limit, tracing).
- The set or order of concerns varies by route, tenant, or config.
- Each concern deserves isolated testing and reuse.

Avoid it when:
- The sequence is fixed, short, and unlikely to change — a plain function is clearer.
- The "handlers" are tightly coupled and always run together — merge them.
- The flexibility would only add indirection nobody needs.

---

## 3. Standardize the middleware signature
A team should pick **one** middleware shape and use it everywhere. Mixing `func(http.Handler) http.Handler` with bespoke wrappers fragments the codebase.

```go
// The team standard:
type Middleware func(http.Handler) http.Handler
```

Provide a single `Chain(h, mw...)` helper (or adopt `chi`/`alice`) so every service composes chains identically. Consistency here pays off enormously in onboarding.

---

## 4. Ordering is a team contract
Middleware order is load-bearing and easy to get wrong:
- Recovery outermost (so it catches panics from everything inside).
- RequestID/tracing early (so all logs carry it).
- Auth before anything that assumes a user.
- Rate limit before expensive work.
- Compression/response shaping near the handler.

Document the canonical order in one place and review changes to it carefully — reordering can open security holes (auth after logging that exposes bodies) or break tracing.

---

## 5. How to review chain code
- [ ] **Forwards correctly:** every non-terminal link calls `next` on all paths.
- [ ] **Short-circuit logged:** rejections record which link and why.
- [ ] **Stateless handlers:** no per-request state in handler fields.
- [ ] **Context forwarded:** `ctx` threaded, cancellation respected.
- [ ] **Built once:** chain assembled at startup, not per request.
- [ ] **Order documented:** placement justified against the canonical order.
- [ ] **Observable:** spans/metrics per link.

---

## 6. Interaction with the wider codebase
- **Composition root:** chains are assembled where routes are registered. Keep the order visible there, not scattered across files.
- **Testing:** each middleware is unit-testable in isolation with a fake `next` that records whether it was called — a major benefit. Integration tests verify the assembled order.
- **Cross-cutting libraries:** tracing, metrics, and auth are naturally middleware. Centralize them so every service gets the same behavior.

---

## 7. Operational concerns
- **Silent short-circuits:** a 401/429 with no log is an ops nightmare. Mandate that every short-circuit emits a structured log with the link name and reason.
- **Per-link latency:** expose middleware timing so a slow auth backend is visible, not hidden inside "request latency."
- **Panic safety:** a recovery middleware outermost prevents one handler's panic from killing the server; ensure it's always present.
- **Chain length:** very long chains add latency and obscure flow; review additions critically.

---

## 8. Anti-patterns at team scale
1. **Multiple middleware signatures** across services — standardize one.
2. **Order defined implicitly** by registration scattered across files.
3. **Per-request chain construction** — allocates and slows every call.
4. **Silent short-circuits** with no observability.
5. **Stateful handlers** causing races under concurrency.
6. **Hidden ordering coupling** (B assumes A ran) undocumented.
7. **CoR for a fixed two-step check** — needless indirection.

---

## 9. Decision record template
When adding/changing a chain, capture:
- The concern the new link addresses and why it's middleware (not handler logic).
- Its position and the ordering rationale.
- Short-circuit behavior and the log it emits.
- Statelessness/concurrency note.
- Rejected alternatives (inline check, existing library).

---

## 10. Summary
CoR is ubiquitous in Go via HTTP/gRPC middleware, so the professional focus is standardization and discipline: one middleware signature, a documented canonical order, chains built once at the composition root, stateless handlers, and mandatory observability on every short-circuit. Review for correct forwarding, context propagation, and ordering. Introduce a chain when concerns are independent and order varies; keep it out of fixed, tightly-coupled sequences.

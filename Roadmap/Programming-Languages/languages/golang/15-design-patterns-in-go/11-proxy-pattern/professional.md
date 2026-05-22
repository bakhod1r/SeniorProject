# Proxy — Professional

## 1. Introduction
> Focus: team-level decisions — when introducing a proxy pays off, how to review one, and how it ripples through a codebase and its operations.

The professional concern is not "can I write a proxy" but "should this team add this layer, and what does it cost us in maintenance, observability, and onboarding."

---

## 2. When to introduce a proxy
Introduce one when **all** of these hold:
- A cross-cutting concern (auth, caching, retries, metrics) applies uniformly across an interface's methods.
- You want that concern enforced in one place, not duplicated at every call site.
- Callers should remain unaware of the concern (transparency is a feature, not a leak).

Do **not** introduce one when:
- Only one method needs the behavior — a direct check there is clearer.
- The "concern" is really business logic that belongs in the real subject.
- The indirection would obscure a hot path that the team profiles frequently.

---

## 3. The build-vs-borrow decision
Much of what proxies do is already in the standard library or well-known modules:
- HTTP client cross-cutting → `http.RoundTripper` wrappers.
- Caching with invalidation → an existing LRU / Redis client, not a hand-rolled map.
- Retries/timeouts → `context` + a retry library.
- Rate limiting → `golang.org/x/time/rate`.

Reach for a custom proxy only when no existing layer fits. A hand-rolled caching proxy that reimplements eviction is a liability.

---

## 4. How to review a proxy PR
Checklist for reviewers:
- [ ] **Single responsibility** — does it do exactly one thing, or is it a god-object?
- [ ] **Exact interface** — does it implement the subject without embedding that could silently pass through new methods?
- [ ] **Concurrency** — is added state (cache, lazy slot) mutex-/Once-guarded and `-race`-clean?
- [ ] **Invalidation** — do mutating methods purge the cache?
- [ ] **Failure caching** — are errors cached intentionally (or correctly not)?
- [ ] **Context propagation** — is `ctx` threaded through every method?
- [ ] **Thundering herd** — does the cache miss path need singleflight?
- [ ] **Observability** — can operators see hit rate, lazy-init timing, denied calls?

A protection proxy gets extra scrutiny: a bug here is a security hole.

---

## 5. Interaction with the wider codebase
- **Wiring/DI:** proxies are assembled at composition root (e.g., `main` or a wire/fx provider). Keep the stacking order in one obvious place; scattered wrapping is hard to reason about.
- **Testing:** because proxies share the subject interface, tests can use a fake real-subject and assert the proxy's control logic in isolation. This is a major benefit — the proxy is independently unit-testable.
- **Tracing:** a proxy is a natural span boundary. A metrics/tracing proxy gives you per-method latency without touching the real subject — but adds a layer ops must understand when reading traces.

---

## 6. Operational concerns
- **Cache memory:** an unbounded caching proxy is an OOM waiting to happen. Bound it (LRU with a size cap) and expose the size as a metric.
- **Lazy cold starts:** a virtual proxy shifts cost to first request. Warm critical proxies during readiness checks so the first real user doesn't pay.
- **Denied-call visibility:** a protection proxy should emit a metric/log on denial; silent 403s are hard to debug.
- **Cache stampede:** on cache expiry, many requests miss at once. Use singleflight + jittered TTLs.

---

## 7. Documentation and onboarding
A proxy is invisible by design, which means a new engineer can call `store.Read` without realizing it's cached, gated, and traced. Mitigate:
- Name the type for its role (`cachingStore`, `guardedStore`), not generically.
- Document the proxy stack at the composition root with a comment listing the order and why.
- In the interface's doc comment, note that implementations may add caching/auth so behavior like "stale reads" is expected.

---

## 8. Anti-patterns at team scale
1. **God-proxy** combining many concerns — split and stack.
2. **Hand-rolled cache** duplicating a library's eviction logic.
3. **Embedding for a policy proxy** — new methods bypass enforcement.
4. **Unbounded cache** with no size metric — OOM risk.
5. **Silent denials** with no observability.
6. **Proxy stack assembled in scattered places** — nobody can see the real order.
7. **Proxy hiding multi-second latency** with no documentation.

---

## 9. Decision record template
When adding a proxy, capture in the PR or an ADR:
- The concern it centralizes and why a direct approach was insufficient.
- Its position in the stack and the ordering rationale.
- Concurrency strategy and whether failures are cached.
- Bound/eviction policy and the metric exposing it.
- Rejected alternatives (existing library, real-subject method).

---

## 10. Summary
Introduce a proxy only for a genuinely cross-cutting concern that should be enforced once and stay invisible to callers — and prefer existing library layers (`RoundTripper`, LRU, rate limiters) over hand-rolled ones. Review for single responsibility, exact interface (no silent embedding pass-through), concurrency safety, invalidation, and observability. Operationally, bound caches, warm lazy proxies, make denials and hit rates visible, and document the stack at the composition root so the invisible layer doesn't ambush the next engineer.

# API Gateway / Edge Proxy

> Build the single front door for a fleet of services — routing, auth, per-route
> rate limiting, circuit breaking, and tracing — and prove it adds **microseconds,
> not milliseconds** at high RPS while staying up when an upstream falls over. The
> gateway is on *every* request's hot path, so every feature you add is a tax you
> must measure.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Edge / traffic management / distributed systems |
| **Skills exercised** | Reverse-proxy data plane (`net/http/httputil.ReverseProxy`), connection pooling & keep-alive to upstreams, JWT/JWKS verification with caching, dynamic routing + config hot-reload, per-route rate limiting & circuit breaking (composed, not re-derived), request/trace-context propagation, graceful shutdown & connection draining, Go on the hot path (zero-alloc middleware) |
| **Interview sections** | 10 (API design), 9 (networking), 22 (scalability & HA), 16 (security), 18 (observability) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You have ~15 backend services behind a load balancer. Today every client talks to
each service directly, which means auth is reimplemented five different ways, rate
limits live in three of them and nowhere else, there's no consistent request ID to
trace a call across services, and a slow `payments` upstream takes down callers
that have nothing to do with payments because everyone retries into it at once.

The fix is an **API gateway**: one reverse proxy that sits at the edge, terminates
client connections, decides *where* each request goes, enforces the cross-cutting
concerns **once** (authn, rate limit, circuit breaking, observability), and
forwards to the right upstream over a pooled, kept-alive connection.

The trap is that a gateway is **on the critical path of 100% of traffic**. A 2 ms
of added latency or a 5% throughput haircut is multiplied by your entire request
volume. And if the gateway itself is a single point of failure or amplifies an
upstream outage, you've built a more central thing to break. Your job is a gateway
that is **fast, observable, and a *blast-radius reducer* — not amplifier**.

> This project is about **composing** edge concerns and **owning the data-plane
> performance**. The deep, standalone treatments live in sibling briefs — reference
> them, don't re-derive them:
> - rate-limit *algorithms* → [`resilience/01-rate-limit-algorithm-bake-off`](../../resilience/01-rate-limit-algorithm-bake-off/)
> - *distributed* global limiting → [`senior/02-distributed-rate-limiter`](../02-distributed-rate-limiter/)
> - circuit breaker / bulkhead / timeout internals → [`resilience/03-circuit-breaker-bulkhead-timeout`](../../resilience/03-circuit-breaker-bulkhead-timeout/)
> - load-shedding / adaptive concurrency → [`resilience/02-adaptive-concurrency-and-load-shedding`](../../resilience/02-adaptive-concurrency-and-load-shedding/)
> - per-tenant quota hierarchies → [`resilience/04-hierarchical-multitenant-quotas`](../../resilience/04-hierarchical-multitenant-quotas/)
>
> Here you **wire them together** at the edge and measure what that costs.

## 2. Goals / Non-goals

**Goals**
- A working **reverse proxy** that routes by host + path (and optionally method/
  header) to one of many upstreams, with **load balancing** across upstream
  replicas and active/passive **health checking**.
- A **middleware pipeline** (auth → rate limit → circuit breaker → proxy) that is
  ordered, composable, and **per-route configurable** — not a hardcoded chain.
- **JWT auth** at the edge: verify signature against a **cached JWKS**, check
  `exp`/`aud`/`iss`, and forward a trimmed identity (e.g. `X-User-Id`) to upstreams
  so they don't re-verify. Reject early and cheaply.
- **Per-route rate limiting** and **per-upstream circuit breaking**, *composed from
  the sibling implementations*, so one misbehaving route or dead upstream is
  contained.
- **Config hot-reload**: change routes/limits/timeouts without dropping in-flight
  requests or restarting (watch a file or a config endpoint).
- **Observability built in**: a generated/propagated request ID + W3C
  `traceparent`, structured access logs, and RED metrics (Rate, Errors, Duration)
  per route and per upstream.
- **Graceful shutdown**: stop accepting new connections, drain in-flight requests
  within a deadline, close idle keep-alives cleanly.
- Prove the **added latency and throughput cost** of the gateway vs. talking to the
  upstream directly, at high RPS, with each feature on and off.

**Non-goals**
- Re-deriving rate-limit algorithms, the breaker state machine, or load-shedding
  control loops — those are the sibling briefs above. You *use* them.
- A service **mesh** / sidecar data plane (Envoy/Istio). You build a single
  centralized edge proxy, not per-pod sidecars.
- TLS termination cipher tuning, mTLS to upstreams, WAF/bot detection — out of
  scope (mention where they'd plug in).
- A control-plane UI / multi-region config replication — config is a local file or
  a single endpoint here.
- Protocol translation beyond HTTP/1.1↔HTTP/2 to upstreams (no gRPC-transcoding,
  no GraphQL federation) — note them as stretch.

## 3. Functional requirements

1. **Routing table**: match incoming requests by `host`, `path` prefix/exact, and
   optionally `method`; pick a **route**. Each route names an **upstream** (a set of
   backend addresses) and a **middleware policy**. Unmatched → `404` with a JSON
   error.
2. **Reverse proxy**: forward the matched request to a chosen upstream replica,
   stream the response back, and correctly handle **hop-by-hop headers**,
   `X-Forwarded-For`/`X-Forwarded-Proto`, request/response bodies (including
   streaming and large bodies), and client cancellation (`context` propagation).
3. **Load balancing** across an upstream's replicas: at least **round-robin** and
   **least-connections**; skip replicas marked unhealthy.
4. **Health checking**: passive (consecutive upstream errors eject a replica for a
   cooldown) and active (periodic `GET /healthz`). Ejected replicas rejoin on
   recovery.
5. **Auth middleware**: verify a bearer **JWT** (RS256) against a JWKS fetched from
   an issuer and **cached with TTL + background refresh**; on failure return `401`;
   on success strip the token and inject identity headers for the upstream.
6. **Rate-limit middleware** (per route, keyed by client identity or IP), wired from
   the sibling limiter; returns `429` + `Retry-After`/`RateLimit-*`.
7. **Circuit-breaker middleware** (per upstream), wired from the sibling breaker:
   when an upstream is failing, **fail fast** with `503` (and an optional fallback)
   instead of piling up timed-out connections.
8. **Per-route timeouts & retries**: a hard upstream timeout, and *bounded,
   idempotent-only* retries to **other** replicas (never blind retry storms — see
   §9).
9. **Config hot-reload**: editing the routes/policies config applies atomically to
   new requests without dropping in-flight ones.
10. **Observability**: every request gets/propagates a request ID and
    `traceparent`; emit a structured access log line and RED metrics; expose
    `/metrics` and `/healthz` on a separate admin port.
11. **Graceful shutdown** on `SIGTERM`: stop the listener, drain within a deadline,
    then exit; report how many requests were drained vs. aborted.

## 4. Load & data profile

- **Request rate:** drive the gateway to **≥ 150,000 req/s** aggregate across many
  routes (tune to your hardware; the goal is to find the ceiling, not hit a magic
  number). Sustained run ≥ 10 minutes.
- **Routes & upstreams:** **≥ 50 routes** mapped to **≥ 10 upstreams**, each upstream
  with **3+ replicas**, so routing-table lookup, per-route policy, and LB are all
  exercised at realistic fan-out — not a single passthrough.
- **Payload mix:** mostly small JSON (`< 4 KB`), plus a slice of **large bodies**
  (1–10 MB upload/download) and a slice of **streaming/long-lived** responses
  (chunked / SSE) so buffering vs. streaming behavior is tested.
- **Auth mix:** a realistic share of requests carry a valid JWT, some carry an
  expired/invalid one (must be rejected cheaply), some are anonymous public routes.
  Use **multiple signing keys** so JWKS cache + key rotation are real.
- **Traffic model:** **open-model** (fixed arrival rate) so you measure queueing and
  error rates honestly and avoid coordinated omission. State your model.
- **Upstreams** are stub services (`cmd/upstream`) with **configurable latency and
  error injection** (e.g. `payments` set to 200 ms p50 and 30% `503`s) so you can
  manufacture the slow/dead-upstream scenarios that the breaker and timeouts exist
  for. Deterministic given a seed.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| **Added latency (proxy overhead)** | Gateway adds **< 1 ms p99** vs. direct-to-upstream for a small-body, no-auth route; **< 2 ms p99** with auth + rate-limit + breaker all on. Report p50/p99/p999 and the per-feature breakdown. |
| **Throughput cost** | Gateway sustains **≥ 70%** of the direct-to-upstream max RPS on a passthrough route; name what bounds the rest (CPU? alloc/GC? connection pool? a single mutex?). |
| **Auth cost** | JWT verify adds **< 100 µs p99** with a warm JWKS cache; a cache miss (rotation) must **not** stall the request path — refresh in the background, never inline-block all callers. |
| **Connection efficiency** | Upstream connections are **pooled & kept alive**; prove reuse (few new TCP/TLS handshakes under steady load). No fd leak over the soak. |
| **Blast-radius containment** | When one upstream goes to 200 ms / 30% errors, requests to *other* routes show **no measurable latency/error change**. The breaker opens in < 1 s; no thread/goroutine/connection pile-up on the bad upstream. |
| **Config reload** | A reload applies to new requests within **< 1 s** and drops **zero** in-flight requests. |
| **Graceful shutdown** | On `SIGTERM`, in-flight requests complete within the drain deadline; **zero** dropped mid-flight under a steady load test. |

> The headline result is the **latency/throughput tax table**: direct vs. gateway,
> and each edge feature's marginal cost. A senior answer *names the bottleneck and
> proves it* (pprof), not "it felt fast."

## 6. Architecture constraints & guidance

- **Language:** Go. Build the data plane on `net/http` + `net/http/httputil.
  ReverseProxy` (customize `Director`/`Rewrite`, `Transport`, `ModifyResponse`,
  `ErrorHandler`), or hand-roll the proxy if you want full control of buffering —
  justify the choice.
- **Transport tuning is the hot path.** Use a shared `http.Transport` per upstream
  with tuned `MaxIdleConns`, `MaxIdleConnsPerHost`, `IdleConnTimeout`, and
  `ForceAttemptHTTP2`. The single biggest perf mistake is a fresh connection per
  request — prove keep-alive reuse.
- **Middleware** is an ordered chain of `func(http.Handler) http.Handler`. Keep the
  hot path **allocation-lean** — no per-request maps/JSON if you can avoid it;
  measure allocs with `-benchmem` and pprof. The chain order matters: cheap
  rejects (auth, rate limit) come **before** the expensive proxy dial.
- **Don't block the request path on slow side effects.** JWKS fetch, config reload,
  metric flushes, and access-log writes happen off the critical path
  (background goroutine, buffered channel, atomic pointer swap for config).
- **Config** is a versioned struct loaded into an `atomic.Pointer[Config]`;
  hot-reload swaps the pointer so in-flight requests keep their snapshot. Validate
  before swap; never swap in a broken config.
- **Compose, don't copy:** import the sibling limiter and breaker as packages /
  middleware. If they're not packaged, define a thin interface and stub it — the
  point is the *wiring and the cost*, not a second implementation.
- Run **multiple gateway replicas** behind your load generator for the HA
  experiment (the gateway must be stateless on the hot path; limiter state lives in
  Redis per the sibling brief).

## 7. Config / routing model

Routes are declarative and hot-reloadable. Example:

```yaml
upstreams:
  payments:
    replicas: ["10.0.1.10:8080", "10.0.1.11:8080", "10.0.1.12:8080"]
    lb: least-conn
    health: { path: /healthz, interval: 2s, unhealthy_after: 3 }
  catalog:
    replicas: ["10.0.2.10:8080", "10.0.2.11:8080"]
    lb: round-robin

routes:
  - match: { host: api.shop.com, path: /v1/payments, methods: [POST] }
    upstream: payments
    timeout: 800ms
    retries: { max: 1, only_idempotent: true }      # POST → no retry unless idempotency key
    auth:    { required: true, aud: shop-api }
    ratelimit: { key: user, limit: 100, window: 1s }
    breaker: { error_ratio: 0.5, min_requests: 20, open_for: 5s }

  - match: { host: api.shop.com, path: /v1/catalog }  # public, cacheable
    upstream: catalog
    timeout: 300ms
    auth:    { required: false }
    ratelimit: { key: ip, limit: 1000, window: 1s }
```

**Identity forwarding (after auth):** strip `Authorization`, inject
`X-User-Id`, `X-Tenant-Id`, `X-Request-Id`, and `traceparent`. Upstreams trust the
gateway (document this trust boundary — it's why upstreams must not be directly
reachable from clients).

## 8. API / interface contract

**Client-facing edge behavior**
- **Routed OK** → upstream response streamed back, with `X-Request-Id` and timing
  header (e.g. `Server-Timing`) added.
- **No route** → `404 {"error":"no_route"}`.
- **Auth fail** → `401 {"error":"unauthorized"}` (or `403` for valid-but-wrong-aud);
  never leak why beyond what's safe.
- **Rate limited** → `429` + `Retry-After` + `RateLimit-*` (per sibling limiter).
- **Breaker open / upstream dead** → `503 {"error":"upstream_unavailable"}` (fail
  fast), optional cached/fallback response.
- **Upstream timeout** → `504 {"error":"upstream_timeout"}`.

**Admin plane (separate port, not internet-facing)**
```
GET  /healthz        # gateway liveness/readiness
GET  /metrics        # Prometheus: RED per route + per upstream, breaker state,
                     # JWKS cache hits, conn-pool reuse, in-flight, drain count
POST /config/reload  # trigger reload (or watch file); returns applied version
GET  /routes         # dump the active routing table + config version
```

**Middleware contract (Go)**
```go
type Middleware func(http.Handler) http.Handler

// ordered per route, cheapest-reject-first:
//   requestID → traceparent → access-log(deferred) → auth →
//   ratelimit → breaker → loadbalance+proxy
func Chain(route *Route, base http.Handler) http.Handler
```

## 9. Key technical challenges

- **The proxy overhead *is* the project.** Every feature is multiplied by 100% of
  traffic. The discipline is: measure direct-vs-gateway, attribute each millisecond
  and each allocation (pprof + `-benchmem`), and keep the chain cheap. A gateway
  that adds 5 ms is a bad gateway no matter how many features it has.
- **Retries are a footgun at the edge.** A naive "retry on error" turns one slow
  upstream into a **retry storm** that DDoSes it (and you). Retry only
  **idempotent** requests, only to a **different** replica, **at most once**,
  **behind the breaker**, with a retry **budget** (cap retries to a small % of
  traffic). This is where most homegrown gateways fall over.
- **Connection management to upstreams.** Pool and reuse, or you pay a handshake per
  request and exhaust ephemeral ports / fds under load. But pooling to a *dead*
  replica wedges requests — health checking and the breaker must eject it. Balancing
  pool size vs. upstream capacity is real tuning.
- **JWKS cache + key rotation without a stall.** A cache miss must not make every
  in-flight request block on the issuer (thundering herd to the IdP). Single-flight
  the refresh, serve stale-while-revalidate, and handle a key that rotated mid-flight
  (`kid` not found → one refresh, then fail).
- **Config hot-reload without dropping requests.** In-flight requests must keep the
  config snapshot they started with; the swap is atomic; a bad config never goes
  live. Getting this wrong = dropped requests or a half-applied table.
- **Blast-radius math.** The whole point is that a bad upstream is *contained*. You
  must demonstrate isolation: bulkhead the connection pools / concurrency per
  upstream so payments saturating doesn't starve catalog of goroutines or fds.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (proxy p50/p99/p999, throughput, alloc/op, conn reuse
ratio, error rates, breaker transitions) for each:

1. **Proxy tax, feature by feature.** Baseline: client → upstream direct. Then route
   through the gateway with (a) passthrough only, (b) + auth, (c) + rate limit, (d)
   + breaker. Produce the **marginal-cost table**: ms p99 and alloc/op added by each
   layer. Name the dominant cost.
2. **Throughput ceiling + bottleneck.** Push RPS until the gateway saturates. pprof
   it: is it CPU (TLS? JSON? routing lookup?), GC pressure (allocs), the connection
   pool, or a contended mutex? Fix the top one, re-measure, show the gain.
3. **Connection reuse.** Compare keep-alive on vs. off (and a too-small idle pool):
   show new-connection rate, p99, and fd count. Demonstrate steady-state reuse.
4. **Slow/dead upstream containment.** Set `payments` to 200 ms p50 + 30% `503`.
   Measure latency/error rates on `catalog` (a *different* upstream) with the breaker
   off vs. on. With it on, prove **no** collateral damage and breaker opens < 1 s.
5. **Retry storm.** Enable naive retries, kill an upstream, and watch the request
   amplification (graph upstream RPS vs. client RPS). Then add idempotent-only +
   retry budget + breaker and show the storm is gone.
6. **JWKS rotation under load.** Rotate the signing key mid-load. Show the request
   path doesn't stall (no latency spike, single-flight refresh, no IdP thundering
   herd), and old tokens fail cleanly.
7. **Hot config reload under load.** Change the routing table while at target RPS;
   prove zero dropped requests and < 1 s to apply.
8. **Graceful shutdown.** `SIGTERM` mid-load; count drained vs. aborted requests;
   tune the drain deadline. Then test rolling two gateway replicas behind the LB
   with zero client-visible errors.

## 11. Milestones

1. Reverse proxy + routing table + round-robin LB to stub upstreams; request ID +
   structured access log; `/healthz` `/metrics`. First direct-vs-gateway latency
   number (experiment 1a).
2. Transport tuning + keep-alive pools + health checks + least-conn LB; throughput
   ceiling run + first pprof (experiments 2–3).
3. Auth middleware (JWT + cached JWKS, background refresh) + identity forwarding;
   auth-cost number + rotation test (experiments 1b, 6).
4. Compose rate-limit + circuit-breaker middleware per route/upstream; slow-upstream
   containment + retry-budget (experiments 1c/1d, 4, 5).
5. Config hot-reload + graceful shutdown + HA rolling-replica run; findings note
   with the full marginal-cost table (experiments 7, 8).

## 12. Acceptance criteria (definition of done)

- [ ] ≥ 10-min run at the gateway's RPS ceiling with the ceiling reported **and the
      bottleneck named and proven with pprof** (CPU / GC / pool / mutex).
- [ ] Marginal-cost table exists: passthrough / +auth / +ratelimit / +breaker, each
      with p99 and alloc/op deltas vs. direct-to-upstream; passthrough overhead
      < 1 ms p99, full chain < 2 ms p99.
- [ ] Keep-alive reuse demonstrated (reuse ratio + fd count steady over a soak; no
      leak).
- [ ] Slow/dead upstream is **contained**: a different upstream shows no measurable
      degradation; breaker opens < 1 s; no goroutine/connection pile-up (show
      `/metrics`).
- [ ] Retry storm demonstrated **and** eliminated with idempotent-only + budget +
      breaker (show the upstream-amplification graph before/after).
- [ ] JWKS rotation handled with no request-path stall and no IdP thundering herd.
- [ ] Config hot-reload applies < 1 s with zero dropped in-flight requests; graceful
      shutdown drains with zero aborted requests under load.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Response caching** at the edge for cacheable GET routes (respect `Cache-Control`,
  add `Age`); measure upstream offload — cross-ref [`labs/09-cache-stampede-and-invalidation`](../../labs/09-cache-stampede-and-invalidation/).
- **gRPC / HTTP-2 upstreams** and gRPC-web transcoding at the edge.
- **Adaptive load shedding** at the gateway under overload — hand off to
  [`resilience/02-adaptive-concurrency-and-load-shedding`](../../resilience/02-adaptive-concurrency-and-load-shedding/).
- **Canary / weighted routing** (send 5% to a new upstream version) and
  header/cookie-based routing for A/B.
- **mTLS to upstreams** + TLS termination tuning (session resumption, OCSP stapling).
- **Distributed tracing end-to-end:** propagate `traceparent` and view a full span
  tree across gateway → 3 hops — cross-ref [`observability/`](../../observability/).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Data-plane performance | Knows the proxy is on the hot path; reports added p99 | Attributes every ms/alloc with pprof, fixes the top bottleneck, defends the tax table |
| Connection management | Pools & keeps alive; proves reuse | Tunes pool vs. upstream capacity, bulkheads per upstream, no fd leak under soak |
| Resilience | Wires breaker + timeouts per upstream | Proves blast-radius containment and kills the retry storm with budget + idempotency |
| Auth at the edge | Verifies JWT + caches JWKS | Handles rotation with single-flight + stale-while-revalidate, no IdP herd, defends the trust boundary |
| Operability | Hot-reload + graceful shutdown work | Zero dropped requests on reload/shutdown/rolling-replica, proven under load |
| Observability | RED metrics + request ID + access logs | End-to-end trace propagation; can debug a cross-service latency spike from the gateway's signals |
| Communication | Clear findings note + tax table | Could defend every curve and the retry/breaker policy to a staff panel |

## 15. References

- **Theory bank:** [`Interview Question/10-api-design/`](../../Interview%20Question/10-api-design/)
  (gateway responsibilities, BFF, versioning, idempotency keys),
  [`Interview Question/09-networking-fundamentals/`](../../Interview%20Question/09-networking-fundamentals/)
  (keep-alive, HTTP/2, connection pooling, the round-trip cost),
  [`Interview Question/22-scalability-and-high-availability/`](../../Interview%20Question/22-scalability-and-high-availability/)
  (load balancing, resilience patterns, graceful degradation),
  [`Interview Question/16-security/`](../../Interview%20Question/16-security/)
  (JWT/JWKS, trust boundaries), and
  [`Interview Question/18-observability/`](../../Interview%20Question/18-observability/)
  (RED metrics, trace propagation). §14 (system design) has a dedicated **API
  gateway** topic.
- **Sibling briefs (compose, don't duplicate):**
  [`resilience/01-rate-limit-algorithm-bake-off`](../../resilience/01-rate-limit-algorithm-bake-off/),
  [`senior/02-distributed-rate-limiter`](../02-distributed-rate-limiter/),
  [`resilience/03-circuit-breaker-bulkhead-timeout`](../../resilience/03-circuit-breaker-bulkhead-timeout/),
  [`resilience/02-adaptive-concurrency-and-load-shedding`](../../resilience/02-adaptive-concurrency-and-load-shedding/),
  [`resilience/04-hierarchical-multitenant-quotas`](../../resilience/04-hierarchical-multitenant-quotas/).
- `net/http/httputil.ReverseProxy` (Director/Rewrite, ModifyResponse, ErrorHandler),
  `http.Transport` tuning (idle conns, HTTP/2), `golang.org/x/sync/singleflight`
  (JWKS refresh), `sync/atomic` (`atomic.Pointer` for config hot-swap).
- W3C Trace Context (`traceparent`), RFC 9110 (`Retry-After`, hop-by-hop headers),
  RFC 7517 (JWK/JWKS), the IETF `RateLimit-*` draft.

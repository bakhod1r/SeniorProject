# API Design — REST / gRPC / WebSocket

> Senior-level Go backend interview questions on REST semantics, idempotency, pagination, versioning, error design, gRPC/Protobuf, real-time transports, rate limiting, and API documentation, focused on trade-offs and failure modes.

**28 questions** across **13 topics** · Level: senior

## Topics

- [REST Fundamentals & Resource Modeling](#rest-fundamentals-resource-modeling) (3)
- [Idempotency Keys for Safe Retries](#idempotency-keys-for-safe-retries) (1)
- [Pagination](#pagination) (2)
- [Filtering, Sorting & Field Selection](#filtering-sorting-field-selection) (2)
- [API Versioning & Evolution](#api-versioning-evolution) (2)
- [Error Design](#error-design) (2)
- [gRPC vs REST](#grpc-vs-rest) (2)
- [Protocol Buffers & Schema Evolution](#protocol-buffers-schema-evolution) (2)
- [gRPC Streaming, Deadlines & Interceptors](#grpc-streaming-deadlines-interceptors) (4)
- [Real-Time Transports: WebSocket / SSE / Long-Polling](#real-time-transports-websocket-sse-long-polling) (2)
- [Rate Limiting & Throttling](#rate-limiting-throttling) (1)
- [API Security at the Edge](#api-security-at-the-edge) (2)
- [Documentation, Contract-First & GraphQL](#documentation-contract-first-graphql) (3)

---

## REST Fundamentals & Resource Modeling

#### 1. How do you choose resource names and map HTTP verbs correctly when designing a REST API? What are common verb/status-code mistakes you've seen?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `rest`, `http`, `resource-naming`, `status-codes`

Resources are **nouns**, usually plural collections (`/orders`, `/orders/{id}`). Sub-resources express containment (`/orders/{id}/items`). Verbs map to actions: `GET` (safe, read-only), `POST` (create / non-idempotent action), `PUT` (full replace, idempotent), `PATCH` (partial update), `DELETE` (idempotent removal). The mechanism that matters is **safety** (no side effects) and **idempotency** (same result on retry). Common mistakes: using `POST /getUser` (RPC-over-REST), returning `200` for a failed operation, returning `200` instead of `201 Created` with a `Location` header on creation, or using `200` where `204 No Content` fits. Status codes carry semantics caches, proxies, and clients rely on — a `200` on a write defeats conditional caching and confuses retry logic. Trade-off: strict REST purity vs. pragmatic action endpoints (e.g. `POST /orders/{id}/cancel`) when an operation isn't a clean CRUD on a resource.

**Key points**
- Resources = nouns, plural collections; verbs carry safety + idempotency semantics
- 201+Location for creates, 204 for empty success, 4xx vs 5xx split client/server fault
- Avoid RPC-over-REST (POST /doThing); but action sub-resources are pragmatic for non-CRUD ops
- Wrong status codes break caches, proxies, and client retry decisions


```
POST /orders            -> 201 Created, Location: /orders/42
GET  /orders/42         -> 200 OK
PUT  /orders/42         -> 200/204 (full replace, idempotent)
PATCH /orders/42        -> 200 (partial)
DELETE /orders/42       -> 204 No Content (idempotent)
POST /orders/42/cancel  -> 200 (action that isn't clean CRUD)
```

**Follow-ups**
- When is 422 Unprocessable Entity more appropriate than 400?
- How do you decide between PUT and PATCH for updates?

---

#### 2. Explain idempotency in REST. Which verbs are idempotent, and why does PUT being idempotent matter for clients?

*Difficulty:* 🟡 medium  ·  *Tags:* `rest`, `idempotency`, `http`, `retries`

Idempotency means issuing the same request N times leaves the server in the same state as issuing it once. `GET`, `PUT`, `DELETE` are defined idempotent; `POST` is not. The **mechanism** is in the semantics: `PUT /users/42` sets the resource to a fully specified state, so replaying it converges to the same state. `DELETE` is idempotent in effect (resource is gone), though the *response* may differ (`204` then `404`). This matters because networks are unreliable: a client that times out doesn't know if the write landed. With an idempotent verb it can **safely retry**. The failure mode is `POST`: a retried `POST /orders` can create duplicate orders (double-charge). That's exactly why idempotency keys exist for POST. Trade-off/gotcha: idempotency is about *server state*, not response equality — and counters (`balance += 10`) implemented behind a PUT break the guarantee, so the contract must match the implementation.

**Key points**
- Idempotent: GET, PUT, DELETE; NOT idempotent: POST
- Enables safe client retries on timeout/network failure — critical in distributed systems
- About server state convergence, not identical responses (DELETE -> 204 then 404)
- PUT replaces full state; PATCH and POST need extra mechanisms to be retry-safe

**Follow-ups**
- Is PATCH idempotent? Under what conditions?
- How would you make a 'transfer money' POST retry-safe?

---

#### 3. What is the Richardson Maturity Model, and why is HATEOAS (Level 3) rarely implemented in practice?

*Difficulty:* 🟡 medium  ·  *Tags:* `rest`, `hateoas`, `richardson-maturity`, `api-design`

The Richardson Maturity Model grades REST adoption: **Level 0** — single endpoint, RPC-style (SOAP-like). **Level 1** — multiple resources but verbs misused. **Level 2** — proper resources + HTTP verbs + status codes (where most 'REST' APIs actually live). **Level 3** — HATEOAS: responses embed hypermedia links telling clients what actions are available next, so clients navigate by following links rather than hard-coding URLs. The promise is decoupling: servers can change URL structure without breaking clients. In practice HATEOAS is rare because: (1) most clients are first-party and hard-code routes anyway, gaining little from runtime discovery; (2) it adds payload weight and client complexity to parse link relations; (3) tooling/codegen and developer mental models favor static OpenAPI contracts; (4) the decoupling benefit assumes generic hypermedia-aware clients that almost never exist. Trade-off: HATEOAS shines for long-lived public APIs needing evolvability (some payment/banking APIs use it), but for typical service-to-service or app backends it's over-engineering.

**Key points**
- L0 RPC -> L1 resources -> L2 verbs+status codes -> L3 HATEOAS hypermedia
- Most production 'REST' APIs sit at Level 2
- HATEOAS aims to decouple clients from URL structure via in-response links
- Rare because first-party clients hard-code routes; cost > benefit without generic hypermedia clients

**Follow-ups**
- Where have you seen HATEOAS actually pay off?
- How does GraphQL's self-describing schema compare to HATEOAS goals?

---

## Idempotency Keys for Safe Retries

#### 4. Design an idempotency-key mechanism to make POST requests retry-safe (e.g. payments). Walk through the server-side logic and the failure modes.

*Difficulty:* 🟠 hard  ·  *Tags:* `idempotency-keys`, `retries`, `payments`, `concurrency`

The client generates a unique key (UUID) per *logical* operation and sends it as `Idempotency-Key`. The server stores key -> (status, response, request-fingerprint) in a durable store with a TTL. Flow: on receipt, atomically `INSERT ... ON CONFLICT DO NOTHING` (or a Redis `SETNX`) to claim the key. If newly claimed, process the operation **inside the same transaction** that persists the result and the final response, then return it. If the key already exists: if processing is complete, replay the stored response; if still in-flight, return `409 Conflict`/`425` so the client backs off. Critical details: (1) fingerprint the request body and reject reuse of the same key with a *different* payload (`422`) to catch client bugs; (2) make claim + side-effect atomic, otherwise a crash between charging and recording the key allows a double-charge on retry; (3) TTL must exceed the client's max retry window. Failure modes: non-atomic write -> duplicate side effects; storing response before the operation commits -> lost result on crash; unbounded key storage -> growth. In Go, use a unique DB constraint as the source of truth rather than a check-then-act, which races.

**Key points**
- Client sends unique Idempotency-Key; server stores key->result durably with TTL
- Claim + side-effect MUST be atomic (single tx / unique constraint), not check-then-act
- Replay stored response on duplicate; 409 while in-flight
- Fingerprint payload to reject key reuse with different body; TTL > client retry window


```go
// Postgres-backed claim: unique constraint is the source of truth
_, err := tx.Exec(ctx,
  `INSERT INTO idempotency_keys (key, request_hash, status)
   VALUES ($1, $2, 'in_progress')`, key, reqHash)
if isUniqueViolation(err) {
    rec := loadKey(ctx, key)
    if rec.RequestHash != reqHash {
        return http.StatusUnprocessableEntity // key reuse, different body
    }
    if rec.Status == "done" { return replay(rec.Response) }
    return http.StatusConflict // still in flight
}
// ...do side effect + write response in SAME tx, then commit
```

**Follow-ups**
- Why use a unique constraint instead of GET-then-INSERT?
- How long should the key be retained, and how do you reason about that?
- Redis vs Postgres for the key store — what changes?

---

## Pagination

#### 5. Compare offset/limit vs cursor/keyset pagination. Why does offset pagination degrade and produce inconsistent results under concurrent inserts?

*Difficulty:* 🟠 hard  ·  *Tags:* `pagination`, `cursor`, `keyset`, `performance`, `consistency`

**Offset/limit** (`LIMIT 20 OFFSET 1000`) asks the DB to scan and discard `OFFSET` rows before returning the page, so cost grows **O(offset)** — deep pages get linearly slower. It's also **unstable**: if a row is inserted near the top between page requests, every subsequent row shifts down, so the user sees a duplicate, and inserts near the end can be skipped. **Cursor/keyset** pagination instead encodes the last seen sort key(s) and queries `WHERE (created_at, id) < ($cursor) ORDER BY created_at DESC, id LIMIT 20`. With an index on the sort tuple this is **O(log n + page)** regardless of depth, and it's stable because it anchors on a value, not a position — new inserts don't shift the window. Trade-offs: cursor pagination can't jump to an arbitrary page (no 'page 50' UI), requires a **total, deterministic sort order** (tie-break with a unique column like `id`, or rows can be skipped/duplicated), and cursors should be opaque/encoded so clients don't depend on internals. Use offset for small/bounded admin tables; use keyset for large feeds, infinite scroll, and any high-write dataset.

**Key points**
- Offset cost is O(offset): DB scans+discards rows; deep pages slow down
- Offset is position-based -> concurrent inserts cause duplicates/skips
- Keyset anchors on last sort value -> stable + O(log n) with proper index
- Keyset needs a total deterministic order (tie-break by unique id); no random page jumps


```sql
-- Keyset (stable, fast at any depth)
SELECT id, created_at FROM orders
WHERE (created_at, id) < ($1, $2)   -- cursor = last row of prev page
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- cursor encoded opaquely, e.g. base64("2026-06-23T10:00Z|9173")
```

**Follow-ups**
- Why must the sort tuple include a unique tie-breaker?
- How do you support bidirectional (prev/next) keyset pagination?
- How do you keep cursors stable if the sort field is mutable?

---

#### 6. How do you expose pagination metadata to clients, and what are the pitfalls of returning a total count?

*Difficulty:* 🟡 medium  ·  *Tags:* `pagination`, `metadata`, `count`, `performance`

Two common shapes: a wrapper object (`{ "data": [...], "page": {"next_cursor": "...", "has_more": true} }`) or `Link` headers (`rel="next"`). For cursor pagination, return `next_cursor` (and `prev_cursor` if bidirectional) plus `has_more`, which you derive by fetching `limit+1` rows and checking if the extra exists — cheaper and more reliable than a count. The pitfall is **total count**: `SELECT COUNT(*)` over a large filtered table can be as expensive as the data query itself, scanning the whole matching set on every page request, and it's racy (the total changes mid-pagination). Mitigations: omit totals entirely for infinite-scroll UIs; provide an **approximate** count (Postgres `reltuples` / a maintained counter) when only a rough magnitude is needed; or cache the count with a short TTL. Trade-off: exact totals give nicer 'page X of Y' UX but cost real latency and consistency; most large feeds drop them in favor of `has_more`.

**Key points**
- Return next_cursor + has_more; derive has_more by fetching limit+1 rows
- Link headers vs envelope metadata are both valid; be consistent
- COUNT(*) on filtered large tables is expensive and racy
- Use approximate/cached counts or omit totals for infinite scroll

**Follow-ups**
- How would you implement an approximate count in Postgres cheaply?
- When is the Link header approach preferable to an envelope?

---

## Filtering, Sorting & Field Selection

#### 7. How do you design filtering and sorting query parameters safely? What are the injection and performance risks, and how do you bound them?

*Difficulty:* 🟡 medium  ·  *Tags:* `filtering`, `sorting`, `security`, `performance`

Expose a constrained, documented vocabulary rather than passing raw client input to the DB. Filtering: support typed params (`status=active&created_after=...`) or a small operator syntax (`filter[amount][gte]=100`), but **allowlist** the fields and operators — never interpolate column names or build SQL from user strings (SQL injection) and never let clients filter on un-indexed columns at scale. Sorting: accept `sort=-created_at,name` but map each token through an allowlist to a real column + direction; an unbounded sort allows clients to force full table sorts on un-indexed columns (a DoS vector). Always use parameterized queries for values. Performance guardrails: cap `limit`, require an index for any sortable/filterable field, and reject combinations that can't use an index. Trade-off: a rich query language (à la OData/GraphQL) is powerful but turns your API into an unbounded query engine — you inherit query-planning and abuse risks; most teams ship a deliberately narrow filter set tied to known indexes.

**Key points**
- Allowlist filter/sort fields + operators; map tokens to real columns server-side
- Parameterized values always; never interpolate column names -> SQL injection
- Unbounded sort/filter on un-indexed columns is a DoS vector
- Constrain to indexed fields; rich query languages trade power for abuse surface

**Follow-ups**
- How do you decide which fields to make filterable?
- How would you support full-text search without exposing the DB engine?

---

#### 8. What are sparse fieldsets / partial responses, and when are they worth the added complexity?

*Difficulty:* 🟡 medium  ·  *Tags:* `sparse-fieldsets`, `partial-response`, `performance`, `caching`

Sparse fieldsets let clients request only the fields they need (`?fields=id,name,status`), shrinking payloads and DB work. JSON:API standardizes `fields[type]=...`; GraphQL makes selection the default. The **mechanism** is server-side: parse the projection, validate against an allowlist, and ideally push it into the query (`SELECT` only those columns) so you save I/O end-to-end — not just trim the JSON after fetching everything (which only saves bandwidth, not DB cost). They're worth it when payloads are large, clients are bandwidth-constrained (mobile), or one endpoint serves many consumers with different needs. Costs: caching gets harder (responses now vary by field selection — cache key must include the projection), response shape is dynamic so client typing/codegen is weaker, and naive implementations N+1 on related fields. Trade-off: if most clients need most fields, fixed DTOs or a couple of view variants (`?view=summary`) are simpler than a general field-selection engine — and that's often where GraphQL becomes the better answer.

**Key points**
- Client-selected fields shrink payload AND DB work if pushed into the query projection
- Validate field names against an allowlist; only saves DB cost if projection reaches SQL
- Hurts cacheability (cache key must include selected fields)
- Fixed view variants are simpler when clients mostly need the same fields

**Follow-ups**
- How does sparse fieldset selection interact with your cache key?
- When does this requirement signal you should adopt GraphQL?

---

## API Versioning & Evolution

#### 9. Compare URI versioning, header versioning, and media-type (content negotiation) versioning. What are the trade-offs and what do you favor for a public API?

*Difficulty:* 🟠 hard  ·  *Tags:* `versioning`, `rest`, `http-headers`, `content-negotiation`

**URI versioning** (`/v1/orders`) is explicit, trivially routable, easy to cache and to test in a browser, but it's not 'pure REST' (the same resource gets multiple URLs) and tends to force coarse, whole-API version bumps. **Header versioning** (`X-API-Version: 2` or `Accept-Version`) keeps URLs clean and allows finer granularity, but it's invisible in logs/browsers, harder to cache (caches must vary on the header), and easy for clients to forget. **Media-type versioning** (`Accept: application/vnd.myapi.v2+json`) is the most RESTful — versioning the representation, not the resource — and allows per-resource evolution, but it's the most awkward to use, debug, and document. The deeper point: versioning is the **fallback**; the primary strategy is additive, non-breaking evolution so you rarely need a new version at all. For public APIs I favor **URI versioning** for its operational simplicity and discoverability, reserving a version bump for genuinely breaking changes, and combining it with field-level evolution within a version. Trade-off summary: URI = simplicity/cacheability vs purity; header/media-type = cleanliness/granularity vs operability.

**Key points**
- URI: explicit, cacheable, easy to test — but not 'pure' and coarse-grained
- Header: clean URLs, finer grain — but invisible, cache-vary complexity, easy to omit
- Media-type: most RESTful, per-resource — but awkward to use/debug/document
- Best strategy is avoiding versions via additive change; URI versioning favored publicly

**Follow-ups**
- How do you handle caching when versioning via a header?
- Would your answer change for an internal service mesh vs a public API?

---

#### 10. Classify breaking vs non-breaking API changes. How do you safely roll out a breaking change with a deprecation and sunset strategy?

*Difficulty:* 🟠 hard  ·  *Tags:* `versioning`, `deprecation`, `sunset`, `backward-compatibility`

**Non-breaking (additive):** adding a new endpoint, adding an optional request field, adding a field to a response, adding a new enum value the client is told to tolerate, relaxing a constraint. **Breaking:** removing/renaming a field or endpoint, changing a type or semantics, making an optional field required, tightening validation, changing default behavior, changing error codes clients branch on, or removing an enum value. The robustness principle helps: be liberal in what you accept, conservative in what you emit, and **clients must ignore unknown fields** (a contract you should state). Rollout for a real breaking change: ship a new version side-by-side, dual-run both, announce deprecation with a clear timeline, emit `Deprecation` and `Sunset` headers (RFC 8594) plus a `Link` to migration docs, instrument usage of the old version to know who's still calling, nudge laggards, and only remove after traffic drops below a threshold and the sunset date passes. Failure mode: removing on schedule while a major integrator is still on the old path — usage telemetry, not just the calendar, should gate the final removal.

**Key points**
- Additive = safe (new endpoints/optional/response fields); removal/rename/type/semantic change = breaking
- Clients MUST ignore unknown fields — state it in the contract
- Deprecation/Sunset headers (RFC 8594) + Link to migration docs
- Gate removal on usage telemetry, not just the calendar date


```
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 31 Oct 2026 23:59:59 GMT
Link: <https://api.example.com/docs/migrate-v2>; rel="deprecation"
```

**Follow-ups**
- Why is 'adding a new enum value' breaking for some clients?
- How do you measure who is still on a deprecated version?

---

## Error Design

#### 11. Design a consistent error envelope for a REST API. What does RFC 7807 (problem+json) give you, and how do you represent validation errors?

*Difficulty:* 🟡 medium  ·  *Tags:* `error-design`, `rfc7807`, `validation`, `problem-json`

A consistent error envelope means every error — across every endpoint — has the same machine-parseable shape, so clients write one error handler. **RFC 7807** (`application/problem+json`) standardizes that shape with `type` (a URI identifying the error class), `title` (human summary), `status` (mirrors HTTP code), `detail` (this-instance explanation), and `instance` (the specific occurrence), plus arbitrary extension members. The value is interoperability and not reinventing a bespoke envelope per service. For **validation errors**, return `400`/`422` and add an extension array of per-field problems (`errors: [{field, code, message}]`) so the client can map messages to form inputs. Key disciplines: include a **stable machine-readable code** (clients branch on codes, not on prose `title`); include a correlation/trace ID for support; and **never leak internals** (stack traces, SQL, internal hostnames) — that's both a security and a stability concern. Trade-off: 7807 is a sound default and increasingly expected, but some ecosystems (gRPC, GraphQL) have their own error models, so 'consistent' means consistent *per protocol surface*, mapped cleanly at the edges.

**Key points**
- One uniform, machine-parseable error shape across all endpoints
- RFC 7807 fields: type, title, status, detail, instance + extensions
- Validation: 400/422 with per-field errors array (field, code, message)
- Stable machine codes (not prose), trace id, never leak internals


```
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid",
  "instance": "/orders",
  "trace_id": "a1b2c3",
  "errors": [
    {"field": "email", "code": "invalid_format", "message": "must be an email"},
    {"field": "qty",   "code": "min",            "message": "must be >= 1"}
  ]
}
```

**Follow-ups**
- Why branch clients on a code field rather than the title/message?
- How do you map this envelope to gRPC status details at the boundary?

---

#### 12. When do you return 4xx vs 5xx, and why does that distinction matter operationally? Give tricky cases (429, 409, 422, 503).

*Difficulty:* 🟡 medium  ·  *Tags:* `error-design`, `status-codes`, `slo`, `observability`

**4xx = client's fault** (bad request, don't blindly retry the same thing); **5xx = server's fault** (the request was valid, the server failed — usually retryable). This split drives behavior beyond the client: it gates **alerting** (5xx rates page you; 4xx generally don't), **SLO/error-budget** accounting (you own 5xx), retry logic, and circuit breakers. Tricky cases: **429 Too Many Requests** is a 4xx but *is* retryable after backoff (honor `Retry-After`). **409 Conflict** signals a state conflict (e.g. optimistic-concurrency `ETag` mismatch, or duplicate create) — the client must reconcile, not just retry. **422 Unprocessable Entity** means syntactically valid but semantically invalid (failed business validation) vs **400** for malformed syntax. **503 Service Unavailable** (often with `Retry-After`) signals transient overload/maintenance and is the right code to shed load — preferable to a `500` because it's explicitly transient and retryable. Failure mode: returning `500` for client validation errors inflates your error budget and triggers false-positive pages; returning `200` with an error body hides failures from every monitoring layer.

**Key points**
- 4xx client-caused (don't blindly retry), 5xx server-caused (usually retryable)
- Distinction drives alerting, SLO accounting, retries, circuit breakers
- 429 retryable-after-backoff; 409 needs reconciliation; 422 semantic vs 400 syntactic
- 503+Retry-After for transient overload; never 500 a validation error or 200 an error

**Follow-ups**
- Why is misclassifying a 4xx as 5xx costly for on-call?
- How does 503 vs 500 change client and load-balancer behavior?

---

## gRPC vs REST

#### 13. When would you choose gRPC over REST/JSON? Explain the HTTP/2 multiplexing benefit and the performance characteristics.

*Difficulty:* 🟠 hard  ·  *Tags:* `grpc`, `rest`, `http2`, `performance`, `protobuf`

Choose gRPC for **internal service-to-service** communication where you control both ends and want a strict contract, low latency, and high throughput: it uses Protobuf (compact binary, fast to (de)serialize, schema-enforced) over HTTP/2, with codegen'd typed stubs and first-class streaming. The **HTTP/2 multiplexing** benefit: many concurrent requests share a single TCP connection as independent streams, eliminating HTTP/1.1 head-of-line blocking and the cost of opening/maintaining many connections — crucial for chatty microservice meshes. It also has header compression (HPACK) and bidirectional streaming built in. Performance: smaller payloads and binary (de)serialization typically cut CPU and bytes-on-wire vs JSON, and persistent multiplexed connections cut latency. Trade-offs / when REST wins: gRPC isn't natively browser-callable (needs gRPC-Web + a proxy), is harder to debug (binary, can't curl easily), needs tooling for load balancing (L7/connection-aware, since one long-lived connection defeats L4 LB), and JSON/REST has unmatched ecosystem ubiquity for public APIs. Rule of thumb: gRPC inside the mesh, REST at the public edge — or REST + gRPC-Web if you need gRPC semantics in the browser.

**Key points**
- gRPC for internal, contract-strict, low-latency, high-throughput + streaming
- HTTP/2 multiplexing: concurrent streams over one connection, no HoL blocking
- Protobuf binary -> less CPU + smaller payloads than JSON
- REST/JSON for public/browser; gRPC needs gRPC-Web proxy + connection-aware LB

**Follow-ups**
- Why does a single long-lived HTTP/2 connection complicate load balancing?
- When does the Protobuf serialization win actually matter vs network being the bottleneck?

---

#### 14. What exactly are the browser limitations of gRPC, and how does gRPC-Web work around them?

*Difficulty:* 🟡 medium  ·  *Tags:* `grpc`, `grpc-web`, `browser`, `http2`

Browsers don't expose the low-level HTTP/2 framing that gRPC requires — JavaScript can't control HTTP/2 streams or read trailers, and gRPC relies on **HTTP/2 trailers** (for the trailing `grpc-status`) and full-duplex framing the Fetch/XHR APIs don't surface. So a browser can't speak native gRPC. **gRPC-Web** is a modified protocol that fits within what browsers allow: it encodes the response (including the trailing status) into the message body in a browser-readable framing, and runs over HTTP/1.1 or HTTP/2. It requires a **proxy** (Envoy's gRPC-Web filter or a Go gRPC-Web wrapper) that translates between gRPC-Web and real gRPC for the backend. The cost: gRPC-Web supports **unary and server-streaming** but **not client-streaming or bidirectional streaming**, because the browser can't keep an open upstream the way native HTTP/2 does. Trade-off: you keep Protobuf contracts and codegen in the browser, but lose two of the four call modes and add a proxy hop. For browser real-time needs, WebSocket/SSE often remain the pragmatic choice.

**Key points**
- Browsers can't access HTTP/2 trailers / stream framing gRPC needs
- gRPC-Web re-encodes status into the body; runs over HTTP/1.1 or /2
- Requires a translating proxy (Envoy filter / Go wrapper) to real gRPC
- No client-streaming or bidi in gRPC-Web — only unary + server-streaming

**Follow-ups**
- Why does gRPC depend on HTTP trailers specifically?
- When would you reach for WebSocket instead of gRPC-Web in the browser?

---

## Protocol Buffers & Schema Evolution

#### 15. Explain the Protobuf wire format basics and why field numbers (tags) — not field names — are what get serialized.

*Difficulty:* 🟡 medium  ·  *Tags:* `protobuf`, `wire-format`, `serialization`, `varint`

Protobuf encodes each field as a key-value pair where the **key is `(field_number << 3) | wire_type`** (a varint), followed by the value encoded per its wire type. Wire types: 0 = varint (int32/64, bool, enum), 1 = 64-bit (fixed64/double), 2 = length-delimited (strings, bytes, embedded messages, packed repeated), 5 = 32-bit. Integers use **varint** encoding (7 bits per byte, MSB continuation) so small numbers take 1 byte; signed ints use ZigZag (`sint32/64`) to avoid 10-byte negatives. Crucially, **field names are never on the wire** — only the numeric tag is. That's the foundation of schema evolution: the decoder matches fields by number, so you can rename a field freely (it's a source-level change only), but you can **never reuse or change a field number** without corrupting how old data is interpreted. **Unknown fields** (tags the reader's schema doesn't know) are skipped using the wire type embedded in the key, which is what makes forward compatibility possible. Trade-off: this compactness and evolvability cost human-readability — you can't eyeball the bytes, and you need the `.proto` to decode meaningfully.

**Key points**
- Key = (field_number << 3) | wire_type, as a varint; only the tag number is on the wire
- Wire types: 0 varint, 1 64-bit, 2 length-delimited, 5 32-bit; varint/ZigZag for ints
- Renaming a field is free (names aren't serialized); reusing a number is fatal
- Unknown fields are skippable via wire type -> enables forward compatibility

**Follow-ups**
- Why does sint32 exist if int32 already encodes negatives?
- How does the reader skip a field whose number it doesn't recognize?

---

#### 16. What are the rules for evolving a Protobuf schema without breaking backward/forward compatibility?

*Difficulty:* 🟠 hard  ·  *Tags:* `protobuf`, `schema-evolution`, `backward-compatibility`, `reserved`

**Backward compat** = new code reads old data; **forward compat** = old code reads new data. Protobuf gives you both if you follow the rules. Safe changes: **add new fields with new field numbers** (old readers skip unknown fields; new readers see defaults for missing ones); add new enum values *if* readers handle unknown enums (proto3 preserves them as the raw number); add new messages/RPCs. Hard rules: **never reuse a field number** for a different field, and **never change a field's type or wire type** — both silently misinterpret existing bytes. When you delete a field, **`reserved`** its number (and ideally its name) so no one accidentally reuses it later: `reserved 4, 7; reserved "old_name";`. `repeated` vs scalar and the wrapper-vs-`optional` choice change presence semantics: switching a field between `optional`/singular and `repeated` is incompatible. In proto3, `optional` re-introduces explicit presence (distinguishing 'unset' from 'zero value'), which matters for partial updates. Failure mode: dropping a field and reusing its tag for a new type later — old serialized data and old peers will decode garbage. Treat field numbers as permanent identifiers, like primary keys.

**Key points**
- Add fields with NEW numbers (old readers skip them, new readers default missing)
- NEVER reuse a field number or change a field's type/wire type
- reserved field numbers (and names) after deletion to prevent reuse
- optional reintroduces presence; switching singular<->repeated is incompatible


```
message User {
  string id    = 1;
  string email = 2;
  reserved 3;                 // a deleted field number, never reuse
  reserved "legacy_handle";   // and its name
  optional string nickname = 4; // explicit presence: unset vs ""
  repeated string roles    = 5;
}
```

**Follow-ups**
- Why does reusing a deleted field's number corrupt old data?
- How do you safely retire an enum value?
- When is proto3 `optional` worth the extra presence bit?

---

## gRPC Streaming, Deadlines & Interceptors

#### 17. Describe gRPC's four call modes and give a fitting use case for each.

*Difficulty:* 🟡 medium  ·  *Tags:* `grpc`, `streaming`, `http2`, `use-cases`

**Unary** (1 request -> 1 response): the default RPC, like a typed REST call — fetch a user, place an order. **Server-streaming** (1 request -> stream of responses): the client asks once and the server pushes many messages — tailing logs, a price feed for a symbol, streaming search results or large result sets in chunks. **Client-streaming** (stream of requests -> 1 response): the client uploads many messages and gets one summary — bulk ingest of metrics/telemetry, chunked file upload where the server returns a final ack/digest. **Bidirectional streaming** (independent request and response streams over one connection): both sides send freely and asynchronously — chat, real-time multiplayer state, interactive RPC like a long-lived control channel. The mechanism underneath all four is HTTP/2 streams, so streaming is full-duplex and multiplexed over one connection. Trade-offs: streaming gives low-latency push and avoids per-message connection overhead, but adds complexity (flow control, partial failure mid-stream, harder load balancing because a stream is pinned to one backend for its lifetime). Pick the simplest mode that fits — most calls should be unary; reach for streaming only when there's genuine continuous or bulk data flow.

**Key points**
- Unary: 1->1, the default typed RPC
- Server-streaming: 1->N push (feeds, logs, chunked results)
- Client-streaming: N->1 (bulk upload/ingest, final summary)
- Bidi: N<->N independent streams (chat, interactive control); stream pins to one backend

**Follow-ups**
- Why does long-lived streaming complicate load balancing?
- How do you handle a failure partway through a stream?

---

#### 18. How do gRPC deadlines and cancellation propagate, and how does Go's context model implement this end to end?

*Difficulty:* 🟠 hard  ·  *Tags:* `grpc`, `deadlines`, `cancellation`, `context`, `golang`

A gRPC **deadline** is an absolute point in time the client sets per call; gRPC serializes it (as a `grpc-timeout` header) so the server knows how long the client is willing to wait. In Go, the client deadline becomes the server handler's `ctx` deadline, and **propagation is the key property**: if service A calls B which calls C, the remaining budget flows down, so C won't keep working after A has already given up. Cancellation works the same way — if the client cancels (or its deadline expires, or it disconnects), the server's `ctx.Done()` fires, and any downstream call made with that ctx is cancelled too, freeing goroutines and DB connections. You implement this by **always passing the request `ctx` into every outbound call** (DB queries, HTTP/gRPC clients) and checking `ctx.Err()` in long loops. Use **deadlines, not timeouts** per hop, so you don't accidentally grant more total time than the caller allowed (nested 5s timeouts can sum). Failure modes: spawning a goroutine with `context.Background()` (it ignores cancellation and leaks/keeps doing wasted work), or not propagating ctx into the DB driver (the query runs to completion after the client left). The deadline expiry surfaces as `codes.DeadlineExceeded`; client cancel as `codes.Canceled`.

**Key points**
- Deadline is absolute time, sent as grpc-timeout; becomes server ctx deadline
- Budget + cancellation propagate down the call chain via ctx
- Always thread request ctx into every downstream call (DB, HTTP, gRPC)
- Use deadlines not per-hop timeouts; Background() ctx defeats propagation -> leaks; DeadlineExceeded/Canceled codes


```go
ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
defer cancel()
// budget + cancellation flow into BOTH downstream calls
user, err := userClient.Get(ctx, &pb.GetUserReq{Id: id})
if err != nil { return err }
rows, err := db.QueryContext(ctx, q, id) // cancelled if client gives up
_ = rows; _ = user
```

**Follow-ups**
- What goes wrong if you use context.Background() for a downstream call?
- How do you avoid nested timeouts summing past the caller's budget?
- How does ctx cancellation reach the SQL driver mid-query?

---

#### 19. What are gRPC interceptors, what cross-cutting concerns do they handle, and how do they compare to HTTP middleware?

*Difficulty:* 🟡 medium  ·  *Tags:* `grpc`, `interceptors`, `middleware`, `golang`

Interceptors are gRPC's middleware: functions that wrap RPC invocation to inject cross-cutting behavior without touching handler logic. There are **unary** and **stream** interceptors, on both **client and server** sides, and they chain. Typical uses: auth (validate a token from metadata, reject before the handler), structured logging and request IDs, metrics/latency, distributed tracing (extract/inject span context via metadata), panic recovery (convert a panic into `codes.Internal`), rate limiting, and context deadline enforcement. The mechanism: a server `UnaryServerInterceptor` receives `(ctx, req, info, handler)` and decides whether/how to call `handler(ctx, req)`, optionally mutating ctx or wrapping errors. Compared to HTTP middleware (`func(http.Handler) http.Handler` around `ResponseWriter`/`Request`), interceptors are **typed and protocol-aware**: they see the parsed message, the full method name, and the gRPC status model, and they operate on metadata rather than raw headers. Trade-off/gotcha: stream interceptors are trickier because you must wrap the `ServerStream` to intercept each `Send`/`Recv`, and order matters — recovery/auth should sit at the outer edge of the chain. Keep heavy logic out of interceptors; they run on every call.

**Key points**
- gRPC middleware: unary + stream, client + server, chained
- Auth, logging, metrics, tracing, panic recovery, rate limiting, deadline enforcement
- Typed/protocol-aware (sees message + method + status) vs raw HTTP middleware
- Stream interceptors must wrap ServerStream to hook Send/Recv; chain order matters


```go
func AuthUnary(ctx context.Context, req any, info *grpc.UnaryServerInfo,
    h grpc.UnaryHandler) (any, error) {
    md, _ := metadata.FromIncomingContext(ctx)
    if !validToken(md.Get("authorization")) {
        return nil, status.Error(codes.Unauthenticated, "invalid token")
    }
    return h(ctx, req) // proceed to handler
}
```

**Follow-ups**
- Why are stream interceptors harder to implement than unary ones?
- Where in the chain should panic recovery sit and why?

---

#### 20. Explain the gRPC error model and status codes. How do you return rich, structured error details, and how do gRPC codes map to HTTP?

*Difficulty:* 🟠 hard  ·  *Tags:* `grpc`, `error-model`, `status-codes`, `retries`

gRPC has a fixed set of **status codes** (in `google.rpc.Code` / Go's `codes`): `OK`, `INVALID_ARGUMENT`, `NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`, `FAILED_PRECONDITION`, `ABORTED`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, etc. An error carries the code plus a message; for **rich details** you attach typed protobuf messages (`google.rpc.ErrorInfo`, `BadRequest`, `RetryInfo`, `QuotaFailure`) via `status.WithDetails`, which the client decodes — far better than parsing strings. Choosing codes precisely matters because it drives client retries and your own metrics: `UNAVAILABLE`/`DEADLINE_EXCEEDED`/`ABORTED` are retryable (with backoff), while `INVALID_ARGUMENT`/`NOT_FOUND`/`PERMISSION_DENIED` are not — retrying them is wasted load. Code-to-HTTP mapping (for gateways like grpc-gateway): `OK->200`, `INVALID_ARGUMENT->400`, `UNAUTHENTICATED->401`, `PERMISSION_DENIED->403`, `NOT_FOUND->404`, `ALREADY_EXISTS->409`, `RESOURCE_EXHAUSTED->429`, `FAILED_PRECONDITION->400`, `UNAVAILABLE->503`, `DEADLINE_EXCEEDED->504`, `INTERNAL->500`. Failure mode: defaulting everything to `INTERNAL`/`UNKNOWN` collapses semantics, makes everything look retryable-or-not arbitrarily, and pollutes your error budget — pick the most specific code, and never leak internals in the message.

**Key points**
- Fixed code set; code drives retryability and metrics, not just a number
- Rich details via status.WithDetails + google.rpc typed messages (ErrorInfo, BadRequest, RetryInfo)
- Retryable: UNAVAILABLE/DEADLINE_EXCEEDED/ABORTED; not: INVALID_ARGUMENT/NOT_FOUND/PERMISSION_DENIED
- Clean HTTP mapping (e.g. RESOURCE_EXHAUSTED->429, UNAVAILABLE->503); avoid defaulting to INTERNAL


```go
st := status.New(codes.InvalidArgument, "invalid order")
st, _ = st.WithDetails(&errdetails.BadRequest{
    FieldViolations: []*errdetails.BadRequest_FieldViolation{
        {Field: "qty", Description: "must be >= 1"},
    },
})
return nil, st.Err()
```

**Follow-ups**
- Which gRPC codes are safe to retry and why?
- Why is defaulting to INTERNAL/UNKNOWN a problem operationally?

---

## Real-Time Transports: WebSocket / SSE / Long-Polling

#### 21. Compare WebSocket, Server-Sent Events, and long-polling. Give a concrete scenario where each is the right choice.

*Difficulty:* 🟠 hard  ·  *Tags:* `websocket`, `sse`, `long-polling`, `real-time`

**Long-polling**: client makes a request, server holds it open until data or timeout, then the client immediately re-requests. It's a hack over plain HTTP — works everywhere, through any proxy, no special infra — but has per-message request overhead, latency on the reconnect gap, and ties up a connection/worker per client. Use it as a universal fallback or for low-frequency updates where simplicity wins. **SSE** (`text/event-stream`): a one-way, **server->client** stream over a single long-lived HTTP response, with built-in auto-reconnect and `Last-Event-ID` resumption. It's HTTP-native (works with HTTP/2 multiplexing, proxies, and standard auth), text-only, and unidirectional. Ideal for notifications, live dashboards, price tickers, progress/LLM token streaming — anywhere the client only consumes. **WebSocket**: a full-duplex, persistent, **bidirectional** connection upgraded from HTTP, low per-message overhead, binary or text. Use it when both directions are active and latency-sensitive: chat, collaborative editing, multiplayer, trading. Trade-offs: WebSocket is most powerful but most operationally heavy (own protocol, sticky sessions, harder to scale, some proxies/firewalls block upgrades, no built-in reconnect/auth — you build those). SSE gives you 80% of push needs with far less operational cost. Rule: if you don't need client->server streaming, prefer SSE; reach for WebSocket only for true bidirectional, real-time interaction.

**Key points**
- Long-polling: universal HTTP fallback, simple, but high overhead/latency per message
- SSE: one-way server->client over HTTP, auto-reconnect + Last-Event-ID, text only
- WebSocket: full-duplex bidirectional, low overhead, but heaviest to operate
- Prefer SSE unless you genuinely need client->server streaming; WS for chat/collab/trading

**Follow-ups**
- Why is SSE often preferred over WebSocket for notification fan-out?
- What does SSE's Last-Event-ID buy you on reconnect?

---

#### 22. How do you scale WebSocket connections horizontally? Explain sticky sessions and the fan-out/broadcast problem.

*Difficulty:* 🔴 staff  ·  *Tags:* `websocket`, `scaling`, `sticky-sessions`, `pub-sub`, `fan-out`

WebSockets are **stateful and long-lived**, which breaks the stateless-LB assumptions REST enjoys. Two hard problems: connection affinity and cross-node fan-out. **Sticky sessions / affinity**: the LB must keep a given connection pinned to the node that holds it for the socket's lifetime — but since WS starts as one HTTP upgrade and then stays open, you mainly need the LB to route the upgrade and not redistribute mid-connection (L4 connection-level balancing handles the persistent socket fine; the affinity concern is more about reconnect landing on a usable node and session resumption). The bigger issue is **fan-out**: user A's message must reach user B whose socket lives on a *different* node. You solve this with a **shared message backbone** — a pub/sub layer (Redis pub/sub, NATS, Kafka) where each node subscribes to relevant channels/rooms; a publish from any node fans out to all nodes, which then push to their locally connected clients. Each node tracks only its own connections; routing tables (which user is on which node) may live in Redis. Operational concerns: graceful drain on deploy (clients reconnect with backoff + jitter to avoid thundering herd), connection limits and memory per node (each socket costs FDs + buffers), heartbeats/ping-pong to detect dead peers, and authentication on the upgrade (you can't rely on cookies the same way). Trade-off: WebSocket fleets need dedicated, autoscaled, connection-aware infrastructure and a pub/sub plane — markedly more complex than scaling stateless HTTP, which is itself a reason to prefer SSE or push services when bidirectionality isn't required.

**Key points**
- WS is stateful/long-lived -> breaks stateless LB; needs connection-aware routing
- Fan-out across nodes via shared pub/sub backbone (Redis/NATS/Kafka); each node pushes to local clients
- Track which user is on which node (Redis routing table); heartbeats detect dead sockets
- Graceful drain + reconnect with backoff/jitter; per-socket FD/memory limits; auth on upgrade

**Follow-ups**
- How do you avoid a thundering herd of reconnects on deploy?
- Where does the user->node routing table live and how is it kept fresh?
- How would Redis pub/sub vs Kafka differ for this backbone?

---

## Rate Limiting & Throttling

#### 23. How do you design rate limiting at the API edge? Cover the response contract (429, Retry-After, headers) and the algorithm choices.

*Difficulty:* 🟠 hard  ·  *Tags:* `rate-limiting`, `throttling`, `429`, `redis`, `token-bucket`

Rate limiting protects the service from abuse and overload and enforces fairness/quotas. **Algorithm choices**: *token bucket* (allows bursts up to bucket size, refills at a steady rate — the common default, smooth + burst-tolerant); *leaky bucket* (smooths output to a constant rate); *fixed window* (simple counter per time window, but suffers boundary bursts — 2x limit across a window edge); *sliding window log/counter* (accurate, no edge burst, more memory). For a distributed edge you need shared state (Redis with atomic INCR/Lua, or token-bucket scripts) so all instances enforce one limit, or approximate per-node with reconciliation. **Response contract**: when limited, return **`429 Too Many Requests`** with **`Retry-After`** (seconds or a date) telling the client when to retry, and rate-limit headers so well-behaved clients self-throttle: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (the IETF draft, replacing the older `X-RateLimit-*`). Dimensions: limit per API key/user/IP/tenant, and tier limits (per-second burst + per-day quota). Trade-offs/failure modes: limiting by IP punishes users behind NAT/shared proxies; fixed windows allow edge bursts; Redis as the limiter is a hot single point — needs HA and a fail-open vs fail-closed decision (fail-open risks overload, fail-closed risks an outage taking down all traffic). Always pair edge limits with backpressure/load shedding (503) deeper in the stack as a safety net.

**Key points**
- Token bucket (burst-tolerant default) vs leaky/fixed-window/sliding-window trade-offs
- Distributed limit needs shared state (Redis atomic/Lua) or per-node approximation
- 429 + Retry-After + RateLimit-Limit/Remaining/Reset headers for client self-throttling
- Limit per key/user/tenant; IP limiting hurts NAT users; decide fail-open vs fail-closed


```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
RateLimit-Limit: 1000
RateLimit-Remaining: 0
RateLimit-Reset: 12
Content-Type: application/problem+json
{ "type": ".../rate-limit", "title": "Too Many Requests", "status": 429 }
```

**Follow-ups**
- Why does fixed-window allow ~2x bursts at boundaries, and how does sliding window fix it?
- Should the Redis-backed limiter fail open or fail closed?
- How do per-second burst and per-day quota limits coexist?

---

## API Security at the Edge

#### 24. How do you separate authentication and authorization across the gateway and services, and why centralize some of it at the edge?

*Difficulty:* 🟠 hard  ·  *Tags:* `security`, `authentication`, `authorization`, `gateway`, `jwt`

**Authentication** (who are you) and **authorization** (what may you do) are distinct and often live at different layers. A common pattern: terminate coarse auth at the **gateway/edge** — validate the credential (verify a JWT signature/expiry, or exchange an opaque token at the auth service / introspection), enforce mTLS, strip/forward identity downstream as a trusted header or a re-minted internal token. This centralizes signature verification, key rotation (JWKS), and rejecting obviously-bad traffic before it hits services, reducing duplicated logic and blast radius. But **fine-grained authorization belongs in the service** that owns the resource, because only it knows the data-level rules — e.g. 'this user owns *this* order' (object-level / BOLA checks). Pushing all authz to the edge fails because the gateway lacks domain context, and trusting an edge-set header blindly is dangerous if any path can reach the service without going through the gateway. Trade-offs: JWTs scale statelessly but are hard to revoke before expiry (need short TTLs + a revocation list); opaque tokens are revocable but add an introspection round-trip. Defense-in-depth: never trust client input for identity (don't accept a `user_id` body field as authority), validate at the boundary, and re-check authorization at the data layer.

**Key points**
- Edge: authenticate (verify JWT/mTLS/introspection), centralize key rotation, reject bad traffic early
- Service: fine-grained, object-level authorization (BOLA) — only it knows ownership rules
- Don't blindly trust edge-set identity headers if services are reachable off-gateway
- JWT (stateless, hard to revoke) vs opaque (revocable, introspection cost); never trust client-supplied identity

**Follow-ups**
- What is BOLA and why can't the gateway prevent it?
- How do you revoke a JWT before it expires?
- What stops a caller from bypassing the gateway and hitting a service directly?

---

#### 25. Why is server-side input validation non-negotiable, and how does it relate to mass assignment and excessive data exposure?

*Difficulty:* 🟡 medium  ·  *Tags:* `security`, `input-validation`, `mass-assignment`, `data-exposure`

Client-side validation is a UX nicety; the server **must** validate independently because clients are untrusted and any attacker can craft raw requests. Validate at the trust boundary: types, ranges, lengths, formats, and allowed enum values, plus business rules — rejecting early with `400`/`422` and a clear error envelope. Two specific risks: **mass assignment** — binding a request body straight onto your domain/DB model lets an attacker set fields they shouldn't (`is_admin`, `account_id`, `balance`). Defend by binding to an explicit **input DTO with only the allowed fields** (an allowlist), never the entity directly, and never deserializing whole payloads onto persistence models. **Excessive data exposure** — returning the full internal model serializes fields the client shouldn't see (password hashes, internal flags, other tenants' references). Defend with explicit **response DTOs/projections** rather than marshalling the raw entity. The unifying principle: explicit, narrow shapes on both ingress and egress, and treat validation as a security control, not just data hygiene. Failure mode in Go specifically: `json.Unmarshal` into a struct that happens to include sensitive fields, then persisting it — bind to a request-specific struct and map deliberately.

**Key points**
- Server-side validation is mandatory (clients untrusted); validate types/ranges/formats/enums at the boundary
- Mass assignment: bind to an allowlisted input DTO, never the entity/DB model directly
- Excessive data exposure: serialize via explicit response DTOs, not raw entities
- Explicit narrow shapes on ingress and egress; validation is a security control

**Follow-ups**
- How would you prevent mass assignment of an is_admin field in Go?
- Why are separate request/response DTOs worth the boilerplate?

---

## Documentation, Contract-First & GraphQL

#### 26. What is contract-first API design with OpenAPI, and what do you gain over generating the spec from code?

*Difficulty:* 🟡 medium  ·  *Tags:* `openapi`, `contract-first`, `documentation`, `swagger`

**Contract-first** means you write the API contract (OpenAPI/Swagger for REST, `.proto` for gRPC) *before* implementation, and treat it as the source of truth that both producer and consumers agree on. From it you generate server stubs, typed clients, mock servers, and docs, and you run **contract tests** to ensure the implementation doesn't drift. The gain over **code-first** (annotations that emit a spec from the running code): the contract can be reviewed, versioned, and consumed by frontend/partner teams *in parallel* with backend work (they build against mocks immediately), it forces deliberate API design rather than leaking implementation shapes, and it makes breaking-change detection a CI gate (diff the spec, fail on incompatible changes). Code-first is faster to start and the spec never lies about the current code, but it tends to expose internal models, makes the design an afterthought, and couples the contract to implementation timing. Trade-off: contract-first adds upfront process and a generation/validation toolchain; it pays off most for public APIs and multi-team boundaries, less for a small internal service one team owns end to end. Either way, the spec must be enforced (generated or tested), not a stale hand-written doc.

**Key points**
- Contract (OpenAPI/.proto) written first as the agreed source of truth
- Enables parallel frontend/partner work via mocks; generates stubs/clients/docs
- Breaking-change detection as a CI gate by diffing the spec
- Code-first is faster + always-accurate but leaks internals; enforce the spec either way

**Follow-ups**
- How do you detect breaking changes from an OpenAPI diff in CI?
- When is code-first the pragmatic choice?

---

#### 27. When would you choose GraphQL over REST, and what new problems does it introduce?

*Difficulty:* 🟠 hard  ·  *Tags:* `graphql`, `rest`, `n-plus-one`, `dataloader`, `caching`

GraphQL shines when **diverse clients need different shapes of data** and you want to avoid over-/under-fetching and a proliferation of bespoke endpoints: the client declares exactly the fields and nested relations it wants in one query, and a strongly typed schema documents the whole graph. It's a strong fit for rich frontends/mobile aggregating many resources, or a BFF over multiple backends. But it shifts problems rather than removing them. **N+1**: a query selecting a list and a nested field per item naively fires one resolver call per item (1 + N DB hits); you fix it with the **dataloader** pattern — batch the keys gathered within a tick and resolve them in one query, plus per-request caching. Other costs: **caching** is harder (POST queries, no per-URL HTTP caching — you cache at the resolver/persisted-query level), **rate limiting/cost control** is non-trivial because a single query can be arbitrarily expensive (need query depth/complexity limits and query allowlists/persisted queries), **authorization** must be enforced per field/resolver, and observability is murkier (one endpoint, many shapes). Trade-off: REST is simpler, HTTP-cacheable, and easy to secure/limit; GraphQL buys client flexibility at the price of server-side complexity. Choose GraphQL when client-shape diversity is the dominant pain; otherwise REST with good filtering/sparse-fieldsets usually suffices.

**Key points**
- GraphQL for diverse clients needing custom shapes; avoids over/under-fetching, one typed graph
- N+1 problem -> dataloader (batch keys per tick + per-request cache)
- Harder HTTP caching, cost control (depth/complexity limits, persisted queries), per-field authz
- REST simpler + cacheable + easy to limit; pick GraphQL when client-shape diversity dominates


```go
// dataloader batches keys collected in one tick into a single fetch
loader := dataloader.NewBatchedLoader(func(ctx context.Context,
    keys []string) []*dataloader.Result {
    rows := db.UsersByIDs(ctx, keys) // ONE query for all N keys
    return resultsInKeyOrder(keys, rows)
})
```

**Follow-ups**
- Walk through exactly how a dataloader collapses N queries into one.
- How do you stop a single GraphQL query from overloading the backend?
- How do you do HTTP-layer caching when everything is one POST endpoint?

---

#### 28. How do you keep API documentation accurate and trustworthy over time, beyond just writing an OpenAPI file?

*Difficulty:* 🟡 medium  ·  *Tags:* `documentation`, `openapi`, `contract-testing`, `ci`

Docs rot the moment they're maintained by hand separately from the code, so the goal is to make the **spec executable and enforced**, not aspirational. Tactics: (1) make the OpenAPI/`.proto` the single source of truth and either generate it from validated code or generate code/clients from it — then a mismatch is a build break, not a silent lie; (2) run **contract tests** in CI (e.g. validate real responses against the schema, or consumer-driven contracts via Pact) so an undocumented change fails the pipeline; (3) **lint the spec** (Spectral) for required descriptions, examples, naming conventions, and error definitions; (4) **diff the spec** on every PR to surface and gate breaking changes; (5) generate human docs (Swagger UI/Redoc) and runnable examples directly from the spec so they can't drift; (6) include realistic examples and error responses, not just happy-path schemas — those are what integrators actually need. The unifying principle: documentation should be a *byproduct of an enforced contract*, kept honest by automation in CI. Trade-off: this tooling has setup cost, but hand-maintained docs are guaranteed to become wrong, and wrong docs are worse than none because they erode trust and generate support load.

**Key points**
- Make the spec the enforced source of truth (generate from/to code) so drift breaks the build
- Contract tests + spec diff in CI to catch undocumented/breaking changes
- Lint the spec (descriptions, examples, error defs); generate human docs from it
- Include error + realistic examples; docs as a byproduct of an enforced contract

**Follow-ups**
- How do consumer-driven contract tests (e.g. Pact) catch drift?
- Why are wrong docs worse than missing docs?

---

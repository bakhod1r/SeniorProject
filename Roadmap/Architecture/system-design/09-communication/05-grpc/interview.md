# gRPC — Interview

Crisp, dense answers for a Staff-level bar. gRPC is a synchronous RPC framework: Protocol Buffers for the contract and wire encoding, HTTP/2 for the transport. Most of the hard questions are not "what is a stub" — they are about the HTTP/2-connection load-balancing trap, deadlines and cancellation propagation, field-number stability, retries under at-least-once semantics, and where gRPC does *not* fit (browsers, public APIs). This file assumes you already understand HTTP/2 and Protobuf basics.

## Table of Contents
1. [Q1: What is gRPC?](#q1-what-is-grpc)
2. [Q2: What are the four call types?](#q2-what-are-the-four-call-types)
3. [Q3: How does the Protobuf wire format work?](#q3-how-does-the-protobuf-wire-format-work)
4. [Q4: Why are field numbers sacred?](#q4-why-are-field-numbers-sacred)
5. [Q5: Deadlines vs timeouts — how do they propagate?](#q5-deadlines-vs-timeouts--how-do-they-propagate)
6. [Q6: What is metadata and how is it used?](#q6-what-is-metadata-and-how-is-it-used)
7. [Q7: gRPC status codes vs HTTP status codes](#q7-grpc-status-codes-vs-http-status-codes)
8. [Q8: Why does gRPC break naive L4 load balancers?](#q8-why-does-grpc-break-naive-l4-load-balancers)
9. [Q9: Client-side vs lookaside vs proxy load balancing](#q9-client-side-vs-lookaside-vs-proxy-load-balancing)
10. [Q10: Retries, hedging, and idempotency](#q10-retries-hedging-and-idempotency)
11. [Q11: Why can't a browser call gRPC directly?](#q11-why-cant-a-browser-call-grpc-directly)
12. [Q12: gRPC vs REST — real tradeoffs](#q12-grpc-vs-rest--real-tradeoffs)
13. [Q13: How does streaming backpressure work?](#q13-how-does-streaming-backpressure-work)
14. [Q14: gRPC vs message queue — sync vs async](#q14-grpc-vs-message-queue--sync-vs-async)
15. [Q15: Scenario — design internal microservice comms with gRPC, what breaks?](#q15-scenario--design-internal-microservice-comms-with-grpc-what-breaks)
16. [Q16: How is a Protobuf schema evolved safely?](#q16-how-is-a-protobuf-schema-evolved-safely)

---

## Q1: What is gRPC?

> gRPC is a high-performance RPC framework built on two pillars: **Protocol Buffers** (an IDL that both defines the service contract and provides a compact binary wire format) and **HTTP/2** (the transport). You write a `.proto` file, `protoc` generates typed client stubs and server skeletons in ~11 languages, and calling a remote method looks like a local function call.
>
> The value proposition over "REST + JSON":
> - **Contract-first, strongly typed** — the `.proto` is the single source of truth; codegen eliminates hand-written client/server glue and drift.
> - **Binary + compact** — Protobuf is smaller and faster to (de)serialize than JSON; no field names on the wire, just tag numbers.
> - **HTTP/2 multiplexing** — many concurrent RPCs over one TCP connection, no head-of-line blocking at the HTTP layer, binary framing, header compression (HPACK).
> - **First-class streaming** — bidirectional streams are native, not bolted on.
> - **Built-in deadlines, cancellation, metadata, and pluggable auth/interceptors.**
>
> It is aimed squarely at **internal, service-to-service (east-west) traffic** in a polyglot microservice fleet — not public-facing browser APIs.

---

## Q2: What are the four call types?

> gRPC methods are declared by whether the request and/or response are marked `stream`:

| Type | Signature (`.proto`) | Semantics | Example |
|------|----------------------|-----------|---------|
| **Unary** | `rpc Get(Req) returns (Resp)` | One request, one response — a classic RPC | `GetUser(id)` |
| **Server streaming** | `rpc List(Req) returns (stream Resp)` | One request, a stream of responses | Server pushes price ticks / search results |
| **Client streaming** | `rpc Upload(stream Req) returns (Resp)` | A stream of requests, one aggregated response | Chunked file upload, batch ingest |
| **Bidirectional** | `rpc Chat(stream Req) returns (stream Resp)` | Both sides stream independently over one call | Chat, telemetry, real-time sync |

> **Key nuance:** all four ride on **one HTTP/2 stream** (one `:path` = the method). A bidi stream is full-duplex — sends and receives are decoupled; the client can keep sending after the server has started responding. Ordering is guaranteed *within* a single stream. A stream is not a substitute for a message queue: if either endpoint dies, the stream dies with no built-in durability or replay.

---

## Q3: How does the Protobuf wire format work?

> A Protobuf message on the wire is a flat sequence of **key-value pairs**, with no field names and no message length prefix inside the message itself. Each field is encoded as:
>
> `key = (field_number << 3) | wire_type`, followed by the payload.
>
> The **wire type** (3 bits) tells the parser how to read the payload without knowing the schema:

| Wire type | Value | Used for |
|-----------|-------|----------|
| VARINT | 0 | int32/64, uint, bool, enum |
| I64 | 1 | fixed64, sfixed64, double |
| LEN | 2 | string, bytes, embedded messages, packed repeated |
| I32 | 5 | fixed32, sfixed32, float |

> **Varints** are little-endian, 7 bits of data per byte with the high bit as a "more" flag — so small integers cost 1 byte. `int32` uses zig-zag encoding (`sint32`) if the value is often negative, otherwise negatives cost 10 bytes.
>
> Because the wire type is self-describing, a parser can **skip unknown fields** — this is *the* mechanism that makes forward/backward compatibility work. There are no field names on the wire (unlike JSON), which is why the schema is required to interpret bytes and why the format is so compact.
>
> ```text
> message: { field 1 (int32) = 150 }
> tag:   (1 << 3) | 0 = 0x08
> value: 150 -> varint 0x96 0x01
> bytes: 08 96 01        (3 bytes total; JSON "field1":150 is ~13 bytes)
> ```

---

## Q4: Why are field numbers sacred?

> The **field number is the only identity of a field on the wire** — the name is a compile-time convenience that never appears in the bytes. Compatibility rules follow directly:
>
> - **Never change or reuse a field number.** Reassigning number `4` from an old `string email` to a new `int64 age` means old readers will misparse new bytes (wire-type mismatch, or worse, silent garbage on a compatible wire type).
> - **Never renumber existing fields.** Renaming is fine; renumbering is a breaking change.
> - **Deleting a field?** Mark the old number `reserved` so no one accidentally reuses it: `reserved 4; reserved "email";`
> - **Adding a field?** Use a fresh number. Old clients skip it (unknown field); new clients see the default (`0`/`""`/empty) when reading old data.
> - **Field numbers 1–15 use a 1-byte tag; 16–2047 use 2 bytes.** Assign the low numbers to hot, frequently-set fields.
>
> The mental model: a Protobuf message is a *sparse map<field_number, value>*, not a struct. Compatibility is purely a discipline of never breaking that map's keys. This is why organizations enforce schema linting (e.g., `buf breaking`) in CI.

---

## Q5: Deadlines vs timeouts — how do they propagate?

> A **timeout** is "give up after N seconds"; a **deadline** is an *absolute point in time* ("give up at 12:00:03.250"). gRPC uses deadlines because they **propagate correctly across a call chain**. When service A calls B with a 2s deadline, and B calls C, B forwards the *remaining* budget to C over the `grpc-timeout` header. C never waits longer than A is willing to wait.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant A as Service A
>     participant B as Service B
>     participant C as Service C
>     A->>B: RPC (deadline = now + 2000ms)
>     Note over B: elapsed 300ms; remaining budget = 1700ms
>     B->>C: RPC (grpc-timeout: 1700m)
>     Note over C: work exceeds budget
>     C-->>B: DEADLINE_EXCEEDED
>     B-->>A: DEADLINE_EXCEEDED (fail fast, no wasted work)
>     Note over A,C: cancellation propagates the whole chain
> ```
>
> Two rules interviewers probe for:
> 1. **Always set a deadline.** A client with no deadline can pin a server goroutine/thread forever; a slow dependency then exhausts the whole fleet (a classic cascading-failure root cause).
> 2. **Cancellation is propagated.** When a deadline fires or a client cancels, the `context` is cancelled all the way down; downstream servers should observe `ctx.Done()` and stop wasting work. Deadlines are *not* retries — a `DEADLINE_EXCEEDED` may or may not have committed a side effect, so treat it like any non-idempotent failure.

---

## Q6: What is metadata and how is it used?

> **Metadata** is gRPC's equivalent of HTTP headers — key/value pairs sent alongside an RPC, out-of-band from the message body. It travels as HTTP/2 headers. Two flavors:
>
> - **Headers** — sent before the message (auth tokens, request IDs, tracing context like `traceparent`, tenant IDs).
> - **Trailers** — sent after the message; this is where gRPC puts the final `grpc-status` and `grpc-message`, since the real status is only known once the handler finishes (essential for streaming, where you can't put status in the response body).
>
> Rules: keys are lowercase ASCII; keys ending in `-bin` carry base64-encoded binary values. Use metadata for **cross-cutting concerns** (auth, tracing, deadlines are handled by the framework itself) — never smuggle business data into metadata that belongs in the typed message. Interceptors are the idiomatic place to read/write metadata (inject a trace ID on the client, validate a JWT on the server).

---

## Q7: gRPC status codes vs HTTP status codes

> gRPC defines **its own 17-code status set**, independent of HTTP status codes, delivered in the `grpc-status` trailer. The HTTP/2 response status for a successful gRPC call is almost always `200` — even for an application-level error; the *real* outcome is in the trailer. This trips people expecting `404`/`500`.

| gRPC code | # | Meaning | Rough HTTP analog |
|-----------|---|---------|-------------------|
| `OK` | 0 | Success | 200 |
| `INVALID_ARGUMENT` | 3 | Bad client input (independent of state) | 400 |
| `DEADLINE_EXCEEDED` | 4 | Deadline passed | 504 |
| `NOT_FOUND` | 5 | Entity missing | 404 |
| `ALREADY_EXISTS` | 6 | Create conflict | 409 |
| `PERMISSION_DENIED` | 7 | Authenticated but not allowed | 403 |
| `RESOURCE_EXHAUSTED` | 8 | Quota/rate limit | 429 |
| `FAILED_PRECONDITION` | 9 | State invalid; **do not retry** blindly | 400/409 |
| `ABORTED` | 10 | Concurrency conflict; retry at higher level | 409 |
| `UNIMPLEMENTED` | 12 | Method not supported | 501 |
| `INTERNAL` | 13 | Server invariant broken | 500 |
| `UNAVAILABLE` | 14 | Transient; **safe to retry** with backoff | 503 |
| `UNAUTHENTICATED` | 16 | Missing/invalid credentials | 401 |

> The retryability distinction is the point: `UNAVAILABLE` and `ABORTED` are retriable; `INVALID_ARGUMENT`, `NOT_FOUND`, `FAILED_PRECONDITION` are not (retrying just wastes budget). `INTERNAL` vs `UNKNOWN`: `INTERNAL` means a broken invariant on the server; `UNKNOWN` means a status was lost or an exception escaped.

---

## Q8: Why does gRPC break naive L4 load balancers?

> This is *the* signature gRPC production gotcha. gRPC multiplexes **many RPCs over a single long-lived HTTP/2 connection**. A classic L4 (connection-level / TCP) load balancer distributes *connections*, not requests. Since each client holds one persistent connection, the LB pins that client — and all its thousands of RPCs — to **one backend**. Add backends and existing clients never move to them.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant Cl as Client
>     participant L4 as L4 (conn) LB
>     participant B1 as Backend 1
>     participant B2 as Backend 2 (idle)
>     Cl->>L4: open ONE HTTP/2 conn
>     L4->>B1: pin connection to B1
>     Cl->>L4: 10k RPCs multiplexed on that conn
>     L4->>B1: all 10k RPCs land on B1
>     Note over B2: scaled up but receives ZERO traffic
>     Note over B1,B2: load is skewed; autoscaling looks broken
> ```
>
> Symptoms: one backend is red-hot, new replicas sit idle, p99 spikes despite "plenty of capacity." Fixes require **request-level (L7) balancing**:
> - An **L7 proxy / service mesh** (Envoy, Linkerd) that understands HTTP/2 and balances individual streams.
> - **Client-side load balancing** so the client itself spreads RPCs across many backend connections.
> - For k8s: a plain `ClusterIP` Service is L4 and will pin; use a **headless Service** so the client sees all pod IPs, plus a client-side balancing policy (`round_robin`), or route through a mesh.

---

## Q9: Client-side vs lookaside vs proxy load balancing

> gRPC supports three load-balancing topologies; the choice is a classic tradeoff between latency, client complexity, and centralized control.

| Approach | How it works | Pros | Cons |
|----------|-------------|------|------|
| **Proxy (L7)** | Client → Envoy/mesh → backends; proxy balances per-request | Thin, language-agnostic clients; central policy, TLS, retries, observability | Extra network hop (+latency); proxy is a scaling/failure point |
| **Client-side (thick client)** | Client resolves all backend addresses (via a resolver) and balances RPCs itself | No extra hop; lowest latency | Balancing logic in every client/language; clients must track membership |
| **Lookaside (external LB)** | Client asks a **separate LB service** which backends to use, then connects directly | Central policy without a data-path hop; keeps clients thin-ish | Extra moving part; the lookaside service must be highly available |
>
> **Lookaside** (a.k.a. one-arm LB, e.g., gRPC's `grpclb`/xDS control plane) is the "best of both": a control plane makes the smart routing decisions, but data flows client→backend directly. In modern stacks this is realized via **xDS** (the Envoy discovery protocol) driving either sidecar proxies or a proxyless gRPC client. Rule of thumb: reach for a **mesh/proxy** when you want uniform policy across polyglot services and can absorb the hop; reach for **client-side/xDS-proxyless** when you're latency-sensitive and can standardize the client library.

---

## Q10: Retries, hedging, and idempotency

> gRPC has **built-in retry policy** configured declaratively via a service config (max attempts, retryable status codes like `UNAVAILABLE`, exponential backoff with jitter). But retries are only safe under two conditions:
>
> 1. **The operation is idempotent** (or made idempotent with an idempotency key). Retrying a non-idempotent `Charge()` after a `DEADLINE_EXCEEDED` can double-charge, because the first attempt *may have succeeded* — the response was just lost.
> 2. **The status is retryable.** Retry `UNAVAILABLE`; never retry `INVALID_ARGUMENT`. Retrying deterministic failures just amplifies load and can cause a **retry storm** that turns a blip into an outage. Use budgets/circuit breakers to cap total retry amplification.
>
> **Hedging** is the aggressive cousin: send the request to multiple backends *before* the first one fails and take the first response. It cuts tail latency but multiplies load, so it demands strict idempotency and a hedging budget. Practical guidance: mark methods that mutate state as non-retryable at the transport layer and handle their retries at the application layer with an idempotency key stored server-side; let transparent retries cover only read-only / provably idempotent calls.

---

## Q11: Why can't a browser call gRPC directly?

> Browser JavaScript **cannot speak raw gRPC** because the Fetch/XHR APIs don't expose enough control over HTTP/2 frames — you can't read/write HTTP/2 trailers (where `grpc-status` lives) or manage the framing gRPC requires. So a browser needs **gRPC-Web**, a variant protocol, plus a translating proxy:
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant Br as Browser (gRPC-Web)
>     participant Px as Envoy / grpc-web proxy
>     participant Sv as gRPC Server
>     Br->>Px: gRPC-Web request (trailers encoded in body)
>     Px->>Sv: native gRPC (HTTP/2 + real trailers)
>     Sv-->>Px: gRPC response
>     Px-->>Br: gRPC-Web response (status folded into body)
> ```
>
> Key **gRPC-Web limitations**:
> - Requires a proxy (Envoy `grpc_web` filter, or an in-process translator) to bridge to native gRPC.
> - **No client-streaming and no bidirectional streaming** — only unary and server-streaming are supported, because browsers can't stream a request body incrementally.
> - Trailers are encoded into the response body since browsers can't read HTTP/2 trailers.
>
> Bottom line: gRPC is an **internal** protocol. For public/browser-facing traffic you expose REST/JSON or GraphQL at the edge (often auto-generated from the same `.proto` via a transcoding gateway) and keep gRPC behind it.

---

## Q12: gRPC vs REST — real tradeoffs

| Dimension | gRPC | REST/JSON over HTTP |
|-----------|------|---------------------|
| Contract | `.proto`, strongly typed, codegen | OpenAPI (optional), often hand-written |
| Payload | Protobuf binary, compact | JSON text, verbose, human-readable |
| Transport | HTTP/2 required (multiplexing, streaming) | Any HTTP; HTTP/1.1 ubiquitous |
| Streaming | Native (all four modes) | Awkward (SSE / chunked / WebSocket) |
| Browser support | Needs gRPC-Web + proxy | Native, trivial (curl, fetch) |
| Debuggability | Needs tooling (`grpcurl`) | Eyeball in a browser / curl |
| Caching | No HTTP caching semantics | Rich HTTP caching (ETag, Cache-Control) |
| Load balancing | Needs L7 / client-side (Q8) | L4 works fine (short conns) |
| Perf (internal) | Higher throughput, lower latency | Lower, but usually "good enough" |
| Best fit | Internal polyglot east-west traffic | Public APIs, browser, third-party |

> The honest summary: **gRPC wins for internal service-to-service traffic** where you control both ends, care about latency/throughput and typed contracts, and want streaming. **REST wins at the edge** — public APIs, browser clients, third-party integrators, ad-hoc debugging, and HTTP caching. Many mature systems run **both**: gRPC internally, a REST/JSON gateway at the perimeter generated from the same protos. Don't pick gRPC because it's "faster" — pick it because of typed contracts, streaming, and polyglot codegen; the perf is a bonus.

---

## Q13: How does streaming backpressure work?

> Backpressure prevents a fast producer from overwhelming a slow consumer. gRPC gets flow control **for free from HTTP/2**: every stream has a **flow-control window**. The receiver advertises how many bytes it's willing to accept; the sender may only write up to that window and must pause until the receiver sends `WINDOW_UPDATE` frames as it consumes data. There is a per-stream window and a per-connection window.
>
> ```text
> Producer  --data-->  [stream window: 64KB]  --> Consumer
>   sends until window is exhausted, then blocks
>   consumer processes, sends WINDOW_UPDATE (frees N bytes)
>   producer resumes; effective rate = min(producer, consumer)
> ```
>
> In practice this surfaces at the API level: in Go, `stream.Send()` blocks when the window is full; in async runtimes, the call to write awaits until buffer space frees up. **Pitfalls:**
> - If application code drains the stream in a tight loop but processes downstream slowly, flow control can't help — you've moved the buffering into your own unbounded queue. Backpressure only works if you let `Send()` block rather than buffering internally.
> - Large default windows (or `initial-window-size` tuning) trade throughput for memory; too small starves throughput on high-BDP links.
> - A stuck consumer that never reads will eventually stall the sender (correct behavior) — pair with deadlines so a permanently-stuck stream fails instead of hanging forever.

---

## Q14: gRPC vs message queue — sync vs async

> gRPC is **synchronous request/response** (even streaming is a live, connected call); a message queue (Kafka, SQS, RabbitMQ) is **asynchronous, durable, decoupled**. They solve different problems and interviewers want to see you not conflate them.

| | gRPC | Message queue |
|---|------|---------------|
| Coupling | Temporal — both must be up | Decoupled — producer/consumer independent |
| Delivery | Best-effort, in-memory | Durable, persisted, replayable |
| Failure | Caller sees the error now | Buffered; retried by broker |
| Backpressure | HTTP/2 flow control (live) | Queue depth absorbs bursts |
| Use when | You need an answer *now* | Fire-and-forget, buffering, fan-out, load leveling |

> Choose **gRPC** for a query or command where the caller needs the result to proceed (e.g., `GetInventory`, `AuthorizePayment`). Choose a **queue** when the work can happen later, must survive a consumer being down, needs load-leveling against spikes, or fans out to many consumers (e.g., "order placed" event → email, analytics, fulfillment). A common architecture uses gRPC for synchronous reads/commands and events-on-a-queue for propagating state changes.

---

## Q15: Scenario — design internal microservice comms with gRPC, what breaks?

> **Prompt:** "You're designing communication for a 40-service polyglot backend. Argue for gRPC and enumerate what breaks."
>
> **Why gRPC fits here:** internal east-west traffic, multiple languages (Go, Java, Python, Rust), latency-sensitive, want a single typed contract with codegen and no client/server drift, and several flows benefit from streaming. Contracts live in a shared `.proto` repo with `buf` breaking-change checks in CI. This is gRPC's home turf.
>
> **What breaks / what you must design for:**
> 1. **Load balancing (Q8).** Single persistent HTTP/2 connections pin clients to backends under L4 LBs. Solution: a service mesh (Envoy/Linkerd) or client-side/xDS balancing. This is the #1 thing that bites teams.
> 2. **Deadlines & cascading failure.** Without deadlines, one slow service pins threads fleet-wide. Enforce deadlines everywhere; propagate the remaining budget; add circuit breakers.
> 3. **Retry storms.** Naive retries on `UNAVAILABLE` across 40 services amplify a blip into an outage. Use retry budgets, jittered backoff, and mark mutations non-retryable.
> 4. **Schema governance.** Field-number discipline and reserved tags; central proto repo + CI breaking-change gate; versioned packages for major changes.
> 5. **Debuggability/observability.** Binary payloads aren't eyeballable — invest in `grpcurl`, reflection, structured logging via interceptors, and distributed tracing propagated in metadata.
> 6. **Edge exposure.** Browsers and third parties can't speak gRPC (Q11) — add a REST/JSON or gRPC-Web gateway at the perimeter.
> 7. **Idempotency.** Since a lost response ≠ no side effect, mutating RPCs need idempotency keys stored server-side.
> 8. **Version skew during rollout.** Old and new proto readers coexist mid-deploy; rely on forward/backward compat (unknown-field skipping) and never break the wire.
>
> A strong answer *leads with the load-balancing trap and deadlines*, because those are the failures that actually page you at 3am.

---

## Q16: How is a Protobuf schema evolved safely?

> Schema evolution rests entirely on the wire format's field-number identity and unknown-field skipping (Q3–Q4). The safe operations:
>
> - **Add a field** — new number; old readers skip it, new readers get the default for old messages. Safe both ways.
> - **Remove a field** — stop writing it, and `reserved` the number *and* name so no one reuses them. Safe.
> - **Rename a field** — free; the name isn't on the wire. Safe.
> - **Change a field's type** — only between wire-compatible types (e.g., `int32`/`int64`/`uint32`/`bool`/`enum` share VARINT). Anything else is breaking.
> - **`optional` vs default** — with proto3, scalar fields don't distinguish "unset" from "zero value" unless declared `optional` (which adds presence tracking); adding `optional` to an existing field is safe.
> - **Never:** reuse a number, change a number, change wire type, or change a `repeated`↔singular field.
>
> ```mermaid
> stateDiagram-v2
>     [*] --> V1: message v1 (fields 1,2)
>     V1 --> V2: ADD field 3 (new number)
>     V2 --> V3: REMOVE field 2 -> reserve 2
>     V3 --> V3: rename field 1 (wire-safe)
>     note right of V2: old readers skip field 3
>     note right of V3: reserving prevents accidental reuse
> ```
>
> Enforce this mechanically: run a **breaking-change linter** (`buf breaking`) in CI against the previous committed schema, and keep protos in a central repo so every service consumes the same source of truth. The discipline — not the tooling — is what keeps a 40-service fleet from a wire-format outage.

---

*Next step:* [REST — Junior](../06-rest/junior.md)

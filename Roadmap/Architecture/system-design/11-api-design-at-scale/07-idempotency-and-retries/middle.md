# Idempotency and Retries — Middle

The junior tier established *what* idempotency means and *why* retries need it. This tier is about the **mechanics**: the exact wire flow of an idempotency key, how the server persists and replays a response, how two concurrent retries are prevented from double-executing, and how the client decides *when* and *how fast* to retry.

## Contents

1. [The idempotency-key contract](#1-the-idempotency-key-contract)
2. [Server-side flow: store key + replay response](#2-server-side-flow-store-key--replay-response)
3. [The concurrent-duplicate problem](#3-the-concurrent-duplicate-problem)
4. [Request fingerprinting: detecting key reuse](#4-request-fingerprinting-detecting-key-reuse)
5. [Key lifecycle and TTL](#5-key-lifecycle-and-ttl)
6. [Sequence diagram: timeout → retry → dedupe](#6-sequence-diagram-timeout--retry--dedupe)
7. [Client retry mechanics: backoff and jitter](#7-client-retry-mechanics-backoff-and-jitter)
8. [What to retry — and what never to retry](#8-what-to-retry--and-what-never-to-retry)
9. [Retry budgets](#9-retry-budgets)
10. [Summary](#10-summary)

---

## 1. The idempotency-key contract

An **idempotency key** is a client-generated unique token that names *one logical operation*. If the same key arrives twice, the server must produce the same effect and the same response as the first time — never a second charge, second order, or second row.

The contract has four parts:

- **Client generates** a unique key per logical operation — typically a UUIDv4 — *before* the first attempt, and reuses that *same* key across every retry of that operation.
- **Client sends** it in a header, conventionally `Idempotency-Key` (used by Stripe; see `stripe.com/docs/api/idempotent_requests`).
- **Server stores** the key together with the outcome (status, body) once the work completes.
- **Server replays** the stored outcome verbatim if the key is seen again.

The key is scoped **per endpoint and per authenticated caller** — the same UUID under a different route or a different API key is a different operation. Keys apply only to state-changing methods (`POST`, and sometimes `PATCH`/`DELETE`); safe methods (`GET`) don't need them.

```
POST /v1/charges HTTP/1.1
Idempotency-Key: 9f2c1e7a-4b6d-4a11-9c3e-1f2a3b4c5d6e
Content-Type: application/json

{ "amount": 5000, "currency": "usd", "source": "tok_visa" }
```

The crucial rule: **the key is created before the first send, not on retry.** If the client generated a fresh key on each attempt, retries would look like brand-new operations and deduplication would be impossible.

---

## 2. Server-side flow: store key + replay response

The server maintains an **idempotency store** — a table (or Redis hash) keyed by `(caller_id, endpoint, idempotency_key)`. Each record moves through states:

| State | Meaning | On a matching retry |
|-------|---------|---------------------|
| *(absent)* | First time this key is seen | Insert record as `IN_PROGRESS`, do the work |
| `IN_PROGRESS` | A request with this key is currently executing | Return `409 Conflict` or block until it finishes |
| `COMPLETED` | Work finished; response is stored | Replay the stored status + body |

The happy-path algorithm:

1. Read the store for the key.
2. If **COMPLETED**, return the stored response immediately — do *no* work.
3. If **absent**, atomically insert a record in state `IN_PROGRESS` (see §3 for the atomicity requirement).
4. Execute the business logic **inside the same transaction** that will persist the result, so the side effect and the stored response commit together.
5. Write the final status code and response body into the record, flip it to `COMPLETED`, and commit.
6. Return the response.

The subtle correctness point is step 4: the operation's side effect (the charge row) and the idempotency record must be **atomic with each other**. If the charge commits but the store write is lost, a retry re-executes and double-charges. Persisting them in one database transaction — or making the operation itself the source of truth (unique constraint on an order ID) — closes that window.

---

## 3. The concurrent-duplicate problem

A single retry after a clean timeout is easy. The hard case is **two attempts in flight at once** with the same key. This happens constantly: the client's first request is slow, its timeout fires, it retries — but the original never actually failed and is still running on the server. Now two requests carry the same key simultaneously.

Without protection, both read the store, both see *absent*, both execute the work, and you get a double effect. Reading-then-writing is a classic check-then-act race.

The fix is a **single atomic gate** that only one of the racers can pass:

- **Unique constraint / conditional insert.** Make the idempotency key a `UNIQUE` column. The first `INSERT` succeeds and claims the operation; the second `INSERT` fails with a duplicate-key error. The loser then either waits and replays the winner's stored response, or returns `409 Conflict` telling the client "a request with this key is already in progress."
- **Distributed lock.** Acquire a short-lived lock on the key (e.g. Redis `SET key value NX PX 30000`) before doing the work; the second racer fails to acquire and backs off or waits.

The `IN_PROGRESS` state (§2) is what the loser observes. The recommended response to a duplicate that arrives while the original is still running is `409 Conflict`, not a silent success — the client can retry once the original completes and then get the replayed `COMPLETED` response. The atomic insert is the load-bearing mechanism; the state column is bookkeeping on top of it.

---

## 4. Request fingerprinting: detecting key reuse

An idempotency key must protect against *accidental replays of the same operation* — not become a way to smuggle a *different* operation under a reused token. Consider a client bug that reuses one key for two genuinely different charges. If the server blindly replayed, the second charge would silently return the first charge's response and never happen — a data-integrity hazard.

To catch this, the server stores a **request fingerprint** alongside the key: a hash of the canonical request (method, path, and body — often `SHA-256` of the raw body). On a repeat key:

- **Fingerprint matches** → it's a genuine retry → replay the stored response.
- **Fingerprint differs** → the key was reused with a different payload → reject with `422` or `400` (Stripe returns an error explaining the key was already used with a different body).

| Same key, request body… | Server action |
|--------------------------|---------------|
| Identical (matching fingerprint) | Replay stored response — safe retry |
| Different (mismatched fingerprint) | Reject with a client error — key misuse |

Fingerprinting turns the idempotency key into a *safe* mechanism: retries are honored, but misuse is surfaced loudly instead of causing silent data loss.

---

## 5. Key lifecycle and TTL

Idempotency records cannot live forever — the store would grow without bound. Each record carries a **TTL**, after which it is purged.

- **Typical window: 24 hours** (Stripe expires keys after 24h). This comfortably exceeds any realistic client retry loop.
- After expiry, the same key is treated as **brand new**. This is safe because no sane client is still retrying a day-old request; if one did, it would simply create a new operation.
- Choose the TTL to be **longer than the client's maximum retry window** (total backoff time × max attempts) so a still-retrying client always hits the stored record, never a re-executed one.

TTL also bounds the fingerprint-collision and storage cost, and lets you use a store with native expiry (Redis `EXPIRE`, a DynamoDB TTL attribute, or a scheduled purge job on a SQL table).

---

## 6. Sequence diagram: timeout → retry → dedupe

The following traces the canonical failure: the server *did* the work, but the **response was lost** in the network. The client times out and retries with the same key; the server replays instead of re-executing. It also shows the concurrent-retry case where the second attempt hits an in-progress lock.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant S as API Server
    participant DB as Idempotency Store

    Note over C: Generate key K = uuid()<br/>(once, before first send)
    C->>S: POST /charges  Idempotency-Key: K
    S->>DB: INSERT K state=IN_PROGRESS (unique)
    DB-->>S: OK — lock acquired
    Note over S: Execute charge,<br/>store response, set state=COMPLETED
    S-->>C: 200 OK { charge }  ✗ response lost in network

    Note over C: Timeout — no response received.<br/>Retry with the SAME key K.
    C->>S: POST /charges  Idempotency-Key: K (retry)
    S->>DB: lookup K
    DB-->>S: state=COMPLETED + stored response
    Note over S: Do NOT re-execute.<br/>Replay stored result.
    S-->>C: 200 OK { charge }  (same charge, no double effect)

    Note over C,S: Concurrent-retry case
    C->>S: POST /charges  Idempotency-Key: K (while original still running)
    S->>DB: INSERT K (unique)
    DB-->>S: duplicate-key error — already IN_PROGRESS
    S-->>C: 409 Conflict (request in progress; retry shortly)
```

The two-arrow-lost pattern (steps 6 and 11) is why idempotency exists: the *effect* happened exactly once, but the client can't tell, so it must be safe to ask again.

---

## 7. Client retry mechanics: backoff and jitter

Retrying isn't just "try again immediately." Naive immediate retries hammer an already-struggling server and cause **retry storms** — thousands of clients retrying in lockstep after a blip, amplifying the outage.

Two techniques tame this:

- **Exponential backoff** — wait longer after each failure: `base × 2^attempt`. This gives a degraded service room to recover instead of a constant pounding.
- **Jitter** — add randomness to each delay so clients don't retry in synchronized waves. Without jitter, all clients that failed at the same instant retry at the same instant.

| Strategy | Delay for attempts 1, 2, 3, 4 | Behavior |
|----------|-------------------------------|----------|
| Fixed | 1s, 1s, 1s, 1s | Simple, but synchronized waves and no backoff |
| Exponential | 1s, 2s, 4s, 8s | Backs off, but all clients still fire in lockstep |
| Exponential + jitter | rand(0–1s), rand(0–2s), rand(0–4s), rand(0–8s) | Backs off **and** spreads load — the production default |

A common "full jitter" formula: `delay = random(0, min(cap, base × 2^attempt))`, with a maximum-attempt cap so retries eventually give up. Because retries reuse the same idempotency key, a delayed retry that *does* land after the original completed will simply replay the stored response — backoff and idempotency are complementary halves of one design.

---

## 8. What to retry — and what never to retry

Retrying is only safe when the failure is **transient** (likely to succeed on a repeat) and the operation is **idempotent** (safe to repeat). Retrying a deterministic client error just wastes attempts; retrying a non-idempotent write without a key risks duplication.

| Response / condition | Retry? | Reasoning |
|----------------------|--------|-----------|
| Network timeout / connection reset | **Yes** | Transient; outcome unknown — that's exactly what the idempotency key protects |
| `500`, `502`, `503`, `504` | **Yes** | Server-side transient failures |
| `429 Too Many Requests` | **Yes**, but honor `Retry-After` | Explicitly asks you to slow down and come back |
| `400 Bad Request`, `422` | **No** | Malformed request; retrying identical input fails identically |
| `401`, `403` | **No** | Auth won't change on retry (refresh token *then* retry, don't blind-retry) |
| `404 Not Found` | **No** | Resource absent; repeating won't create it |
| `409 Conflict` (in-progress key) | **Yes**, after a short delay | The original is still running; retry replays its result |

Rule of thumb: **retry on 5xx, timeouts, and 429; do not retry on 4xx** (except the in-progress `409`). Prefer the `Retry-After` header when the server provides one instead of your own backoff.

---

## 9. Retry budgets

Per-request backoff limits how *one* client retries. A **retry budget** limits retries in aggregate so retries can never become a large fraction of total traffic.

The problem it solves: when a dependency degrades, every request starts failing and retrying. If each request retries 3×, offered load can *quadruple* exactly when the system is weakest — retries turn a partial outage into a total one.

A retry budget caps retries as a **ratio of successful requests** — for example, "retries may not exceed 10% of the request rate." Once the budget is exhausted, further retries are suppressed and the failure is returned immediately. This decouples the retry-storm blast radius from the number of clients: even under mass failure, the extra retry load is bounded to a known percentage. Budgets typically live in the client library or service-mesh sidecar and are tracked over a rolling window.

Combine all three layers: **backoff** spaces out one client's attempts, **jitter** desynchronizes many clients, and the **retry budget** caps the total — while the **idempotency key** guarantees that however many retries slip through, the effect happens once.

---

## 10. Summary

- The **idempotency key** is generated once by the client (a UUID), sent in `Idempotency-Key`, and reused across all retries of one logical operation.
- The server **stores key → outcome**, replaying the stored response on repeat instead of re-executing; the side effect and the stored record must commit **atomically**.
- **Concurrent duplicates** are the hard case; a **unique constraint or lock** on the key is the atomic gate, and `IN_PROGRESS` records surface as `409 Conflict`.
- A **request fingerprint** detects key reuse with a different body and rejects it, keeping the key a *safe* mechanism.
- Keys carry a **TTL** (≈24h) longer than any client retry window.
- Clients retry with **exponential backoff + jitter**, only on **5xx / timeouts / 429**, never on deterministic 4xx, and stay within a **retry budget** to prevent retry storms.

*Next step:* [Idempotency and Retries — Senior](senior.md)

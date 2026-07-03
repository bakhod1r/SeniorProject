# Idempotency and Retries — Professional

At the professional tier we stop treating idempotency as a decorator on a handler and start treating it as a **concurrency and consistency problem**. Two questions dominate: (1) how do you make the idempotency-key record and the business side effect atomic, and (2) how do you resolve two identical requests that arrive at the same instant. Both are solved not in application code but in the storage layer's transactional and uniqueness guarantees. Everything else — retry backoff, dedup windows, consumer offsets — hangs off those two facts.

## Table of Contents

1. [The atomicity requirement](#1-the-atomicity-requirement)
2. [The unique-constraint-insert pattern](#2-the-unique-constraint-insert-pattern)
3. [The concurrent-duplicate race](#3-the-concurrent-duplicate-race)
4. [Two-phase key states and recovery](#4-two-phase-key-states-and-recovery)
5. [Exactly-once is impossible; effectively-once is not](#5-exactly-once-is-impossible-effectively-once-is-not)
6. [Idempotent consumers in messaging](#6-idempotent-consumers-in-messaging)
7. [Backoff math: exponential base and jitter](#7-backoff-math-exponential-base-and-jitter)
8. [Retry amplification across layers](#8-retry-amplification-across-layers)
9. [Summary](#9-summary)

---

## 1. The atomicity requirement

An idempotency key is only useful if the record of "I have seen this key" and the effect it guards are **committed or rolled back together**. If they can diverge, every failure window produces one of two bugs:

- **Effect without key** (key write lost after side effect committed): a retry re-executes the effect → **double charge / double write**.
- **Key without effect** (key committed before side effect): a retry sees the key, returns "already done," and the effect **never happened** → silent data loss.

The only robust cure is to place the key record and the business write in the **same atomic unit**. For a single relational database this is one transaction. For effects that cross systems (charge a card, then write a row) it becomes a durability-ordering problem — see the outbox pattern in §6 and the staff tier.

The naïve "check if key exists, then do the work" is a textbook **check-then-act** race. Between the read and the write, a second request can slip through the same gap. Never gate idempotency on an application-level SELECT.

---

## 2. The unique-constraint-insert pattern

The canonical single-database implementation inverts the check-then-act order: **attempt the insert first, let the database reject duplicates.**

```sql
CREATE TABLE idempotency_keys (
    key             TEXT PRIMARY KEY,        -- the unique constraint does the work
    request_hash    BYTEA NOT NULL,          -- guards against key reuse with a different body
    state           TEXT NOT NULL,           -- 'in_progress' | 'succeeded'
    response_code   INT,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until    TIMESTAMPTZ
);
```

The handler runs one transaction:

```sql
BEGIN;

-- 1. Claim the key. First writer wins; duplicates raise a unique violation.
INSERT INTO idempotency_keys (key, request_hash, state)
VALUES ($1, $2, 'in_progress');

-- 2. Do the business write in the SAME transaction.
INSERT INTO payments (id, account_id, amount_cents, status)
VALUES ($3, $4, $5, 'captured');

-- 3. Record the response and mark the key succeeded.
UPDATE idempotency_keys
   SET state = 'succeeded', response_code = 200, response_body = $6
 WHERE key = $1;

COMMIT;
```

Key properties:

- **The unique index is the arbiter.** Uniqueness is enforced by the storage engine's index maintenance under the row/page locks it already holds — no application logic can lose the race.
- **One transaction = one atomic outcome.** Either the key row *and* the payment row both exist, or neither does. There is no window where they diverge.
- **`request_hash` catches key misuse.** If a caller reuses a key with a *different* body, you can detect it (hash mismatch) and reject with `422`, rather than silently replaying an unrelated response. This is exactly the behavior Stripe documents for its `Idempotency-Key` header.

On a unique violation the handler switches to the **replay path**: read the stored `state`/`response_body` and return it. If `state = 'succeeded'`, return the saved response verbatim — the caller cannot tell a replay from the original.

---

## 3. The concurrent-duplicate race

The hard case is two identical requests (client retried before the first response arrived) executing **simultaneously**. Both attempt `INSERT ... VALUES (key, 'in_progress')`. The database serializes them on the primary-key index: exactly one insert succeeds, the other blocks and then fails with a unique-constraint violation. The loser must not proceed with the business write — it takes the replay path.

```mermaid
sequenceDiagram
    autonumber
    participant R1 as Request A (original)
    participant R2 as Request B (retry, same key)
    participant DB as Database (unique index on key)

    R1->>DB: BEGIN; INSERT key 'in_progress'
    R2->>DB: BEGIN; INSERT key 'in_progress'
    DB-->>R1: OK (row created, index lock held)
    Note over DB,R2: R2's insert blocks on the same index key
    R1->>DB: INSERT payment row
    R1->>DB: UPDATE key -> 'succeeded'; COMMIT
    DB-->>R2: unique_violation (R1 committed the key)
    Note over R2: loser rolls back its own txn — NO business write
    R2->>DB: SELECT response_body WHERE key = $1
    DB-->>R2: state='succeeded', stored response
    R2-->>R2: replay stored response to client
```

Two subtleties determine correctness:

- **Isolation and blocking.** Under READ COMMITTED, the second inserter blocks until the first transaction commits *or* rolls back. On commit it gets a unique violation; on rollback it succeeds and becomes the real executor. This is the desired behavior — the abandoned attempt does not leave a poisoned key.
- **What the loser reads.** If the winner is still `in_progress` (long-running effect), the loser must decide: block/poll until the state resolves, or return `409 Conflict` telling the client "a request with this key is in flight." Returning `409` is the safer default; it keeps the loser from returning a half-baked response.

The essential point: **the race is resolved by the index, not by the application.** No mutex, no distributed lock, no advisory lock is required for the single-database case — the primary key already provides mutual exclusion.

---

## 4. Two-phase key states and recovery

A key is not a boolean. It moves through states so an *interrupted* request can be recovered rather than deadlocked forever.

| State | Meaning | On duplicate arrival | Recovery |
|---|---|---|---|
| *(absent)* | Never seen | Insert → become the executor | n/a |
| `in_progress` | Executor claimed the key, effect not yet committed | Return `409` or poll | If `locked_until` expired, a sweeper may reclaim it |
| `succeeded` | Effect committed, response stored | Replay stored response (`200`) | Terminal — safe to serve forever |
| `failed` (terminal error) | Effect deterministically failed | Replay stored error | Terminal |

The danger state is `in_progress`. If the executor crashes *after* claiming the key but *before* committing, the key can be stuck. Two mechanisms recover it:

1. **Same-transaction commit** (the §2 pattern): because the key transitions to `succeeded` inside the *same* transaction as the effect, a crash rolls back the whole transaction — the key row vanishes and a retry starts clean. This is why co-locating the key write with the business write is so powerful: there is no orphaned `in_progress` row.
2. **Lease + sweeper** (needed when the effect is a *separate* external call, e.g. a payment gateway): the `in_progress` row carries a `locked_until` lease. A background sweeper reclaims expired leases and drives them to a definitive state by **querying the downstream for the effect's outcome** (idempotent by the gateway's own idempotency key) rather than blindly re-executing.

```mermaid
stateDiagram-v2
    [*] --> in_progress: INSERT key (claim)
    in_progress --> succeeded: effect committed + response stored
    in_progress --> failed: deterministic error
    in_progress --> in_progress: lease renewed (long op)
    in_progress --> recovering: crash / lease expired
    recovering --> succeeded: downstream confirms effect happened
    recovering --> in_progress: downstream says not done -> re-drive
    succeeded --> [*]: replay forever
    failed --> [*]: replay error
```

Recovery must be **idempotent all the way down**: the sweeper must be able to ask "did the charge happen?" without risking a second charge. That requires the *downstream* call to itself carry an idempotency key — the recursion bottoms out at a system that offers the guarantee natively (a payment provider, an outbox, a keyed message).

---

## 5. Exactly-once is impossible; effectively-once is not

Formally, **exactly-once delivery over an unreliable channel is impossible.** The **Two Generals Problem** proves that no finite protocol of acknowledgements over a lossy link can give both parties *common knowledge* that a message was delivered exactly once: every acknowledgement is itself a message that may be lost, so no final ack can be assumed received. The sender can never be certain, so it must either risk **zero deliveries** (give up before confirmation) or **duplicate deliveries** (retry until confirmed). There is no third option on an unreliable channel.

The engineering resolution:

- Choose **at-least-once** delivery (retry until acknowledged) — this guarantees the effect happens *at least* once.
- Add a **deduplication store** on the receiver — a durable record of processed identifiers (the idempotency keys of §2).
- The composition — *at-least-once delivery + idempotent dedup* — yields **effectively-once** (a.k.a. exactly-once *processing*). The wire still carries duplicates; the observable effect happens once.

This is the crucial reframing: you never achieve exactly-once *on the wire*. You achieve exactly-once *side effects* by absorbing wire-level duplicates at the boundary.

**Deduplication windows.** A dedup store cannot grow forever. Practical systems keep processed keys for a bounded **window** (Stripe retains idempotency results ~24h; Kafka's producer idempotency and broker dedup operate over bounded sequence ranges). The window must exceed the client's maximum retry horizon; a duplicate arriving *after* the window has evicted its key will be re-processed. Sizing the window is a durability-vs-storage trade-off, and it is where "effectively-once" quietly becomes "effectively-once within T."

---

## 6. Idempotent consumers in messaging

The same principles reappear in event pipelines, where duplicates are structural, not exceptional.

**Kafka offsets and the classic gap.** A consumer reads a message, processes it, then commits its offset. If it crashes *after* processing but *before* committing, it re-reads and **re-processes** on restart — at-least-once by construction. Committing the offset *before* processing flips this to at-most-once (crash → message skipped). Neither ordering alone gives exactly-once.

Three ways to make the consumer effectively-once:

1. **Dedup by message id.** Carry a stable business/message id and run the §2 unique-constraint pattern on the consumer side: insert the id into a processed-messages table in the *same transaction* as the downstream write. A redelivered message fails the unique insert and is skipped.
2. **Transactional outbox.** When a service must both update its DB and publish an event, write the event into an `outbox` table *in the same transaction* as the state change. A relay reads the outbox and publishes. The publish is at-least-once (the relay can crash after publishing, before marking sent), so *consumers* must still dedup — but the DB write and the intent-to-publish are now atomic, closing the "effect without event" gap.
3. **Kafka transactions / `read-process-write`.** Kafka's transactional producer plus `read_committed` consumers and idempotent producers (bounded per-partition sequence numbers detecting broker-side duplicates) give exactly-once *within a Kafka-to-Kafka topology*. The moment an external side effect (a payment, an email) leaves that topology, you are back to §2 dedup on that boundary.

The recurring rule: **exactly-once processing is achieved by co-locating the dedup record with the effect in one atomic write, then letting delivery be at-least-once.** Offsets, message ids, and outbox rows are all instances of that single idea.

---

## 7. Backoff math: exponential base and jitter

Retries convert a transient failure into a repeated attempt. Naïve fixed-interval retries synchronize clients into a **thundering herd** that hammers a recovering server in lockstep. Backoff spreads attempts in time; **jitter** spreads them across clients.

Let `base` be the initial delay, `cap` the ceiling, and `attempt` the retry count.

**Exponential (no jitter):**
```
delay = min(cap, base * 2^attempt)
```
This spreads *within* a client's timeline but leaves all clients perfectly synchronized — every client waits the same `base·2^n`, so their retries still collide.

Jitter breaks the synchronization. The three variants from the AWS Builders' Library ("Timeouts, retries, and backoff with jitter"):

| Strategy | Formula | Spread | Behavior |
|---|---|---|---|
| **Full jitter** | `random(0, min(cap, base·2^n))` | Widest | Each retry uniformly random in `[0, expo]`. Best de-correlation; lowest server contention. |
| **Equal jitter** | `half + random(0, half)` where `half = min(cap, base·2^n)/2` | Medium | Guarantees a minimum wait (`half`) *and* adds randomness. Avoids near-zero delays. |
| **Decorrelated jitter** | `sleep = min(cap, random(base, sleep·3))` | Wide, self-scaling | Next delay derived from the *previous* delay, not the attempt count. Grows and spreads without an explicit exponent. |

AWS's own load-testing in that article found **full jitter** and **decorrelated jitter** minimize both total work and completion time under contention; plain exponential (no jitter) performs worst because it preserves client synchronization. Practical guidance:

- Always cap the delay (`cap`) so backoff cannot grow unbounded.
- Bound the **total** retry budget (max attempts *and* a deadline), not just per-attempt delay.
- **Only retry idempotent or idempotency-keyed operations.** Retrying a non-idempotent write *is* the double-effect bug — backoff jitter does nothing to prevent it. Backoff and idempotency are complementary: jitter makes retries *survivable for the server*; idempotency keys make them *safe for the data*.

---

## 8. Retry amplification across layers

A subtle production failure mode: retries **compound multiplicatively** through a call stack. If every layer independently retries 3×, a request traversing 4 layers can generate `3^4 = 81` attempts at the bottom, all aimed at the struggling dependency that triggered the retries in the first place. This turns a minor downstream blip into a self-inflicted DDoS and a **retry storm** that prevents recovery.

```
Client (3x)
  └─ Edge/API gateway (3x)
       └─ Service A (3x)
            └─ Service B (3x)  →  up to 3·3·3·3 = 81 calls to B
```

Containment techniques:

- **Retry at one layer only** — typically the layer closest to the failure (or the outermost, deliberately), and pass a "do-not-retry" signal (a header or context flag) so inner layers don't re-amplify.
- **Retry budgets** (a.k.a. retry token buckets): allow retries only while retries are a small fraction (e.g. ≤10%) of total requests. When a dependency is broadly failing, the budget is exhausted and the system stops retrying — exactly when retrying would hurt most.
- **Circuit breakers** short-circuit calls to a failing dependency entirely, converting slow timeouts-plus-retries into fast failures and giving the dependency room to recover.
- **Timeouts must shrink inward.** Each layer's timeout should be shorter than its caller's, so inner work is abandoned before the outer layer gives up and retries — otherwise you do duplicate work whose result nobody is waiting for.

Amplification is why "just add retries" is a naïve fix: retries are a *system-wide* resource that must be budgeted, not a per-call convenience.

---

## 9. Summary

- Idempotency is an **atomicity** problem: the key record and the side effect must commit or roll back together. The **unique-constraint-insert-in-the-same-transaction** pattern achieves this on a single database.
- The **concurrent-duplicate race** is resolved by the **database unique index**, never by an application-level check-then-act.
- Model keys as **states** (`in_progress → succeeded/failed`); same-transaction commit prevents orphaned `in_progress` rows, and a lease+sweeper recovers interrupted external effects idempotently.
- **Exactly-once on the wire is impossible** (Two Generals). **At-least-once delivery + a dedup store = effectively-once processing**, bounded by a **deduplication window**.
- Idempotent consumers reuse the same idea: **co-locate the dedup record (message id / outbox row) with the effect** in one atomic write; keep delivery at-least-once (Kafka offsets, transactional outbox).
- **Backoff with jitter** (full / equal / decorrelated) de-synchronizes clients; **cap delays and budget total retries**; retry only idempotent operations.
- Guard against **retry amplification** with single-layer retries, retry budgets, circuit breakers, and inward-shrinking timeouts.

*Next step:* [Idempotency and Retries — Staff](staff.md)

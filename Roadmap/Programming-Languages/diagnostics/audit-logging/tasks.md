# Audit Logging — Hands-On Exercises

> **Topic:** [Audit Logging Roadmap](README.md)
> **Focus:** Practical labs that take you from "I can emit the five W's to a separate file" to "I can build a tamper-evident, compliance-grade audit pipeline and answer a forensic question under it."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

Audit logging is one of those skills that looks finished in code review and turns out to be broken exactly once — during the real incident or the real audit, when it is too late to fix the schema. Reading about hash chains and WORM and SOC 2 will not make you fluent. You become fluent by building an append-only store and then trying to tamper with it, by writing a hash chain and then deleting a row to watch the verifier scream, by being handed a compliance clause and forced to point at the line of code that satisfies it.

The exercises below are tiered. The **Warm-Up** band trains the fundamentals: emit a complete event, enforce append-only at the database level, stamp correlation IDs, capture delegation. These are 20-to-40-minute drills — the muscle memory you need before anything harder makes sense. The **Core** band builds the real machinery: an append-only store you cannot mutate, the outbox pattern under a simulated crash, a redaction layer with tests, a forensic query that joins audit to logs and traces. The **Advanced** band is where audit logging earns its name: a hash-chained tamper-evident log you can prove was not altered, signing and Merkle anchoring, retention with legal hold, GDPR erasure against an immutable store, and a forensic investigation across the whole trail. The **Capstone** band stops being about a single mechanism and starts being about systems: map your controls to SOC 2 / HIPAA / PCI / GDPR clause by clause, design a multi-tenant audit pipeline that cannot drop an event, and stand up a query tool an auditor could actually use.

Do not skip ahead. The Advanced hash-chain lab assumes you already built the append-only store in Core and understand why "append-only" and "tamper-evident" are *different* guarantees. The compliance-mapping capstone assumes you can already point at retention, immutability, and non-repudiation controls in your own code. Work each band end-to-end. If a lab takes more than the suggested time, write down what blocked you — for audit logging that note is usually a real design gap, not a knowledge gap.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

A note on tooling. The labs name concrete tools and languages — PostgreSQL, Go, Python, Java, Node, Rust, OpenSSL, S3 Object Lock — because audit logging is not abstract; the guarantee lives in a specific `REVOKE`, a specific signature, a specific retention policy. Where a language is specified, use it; the point is often a language-specific mechanism (Postgres triggers, Go's `crypto/ed25519`, S3 Object Lock). Where it says "language of your choice," pick one and stay in it.

---

## Warm-Up

These are 20-to-40-minute exercises. The goal is fluency with the fundamentals — a complete event, an enforced store, correlation, delegation — not deep design. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of [junior.md](junior.md) or [middle.md](middle.md).

### Task 1: Emit a complete audit event with the five W's plus schema versioning

**Problem.** Write a function in the language of your choice that emits a single, complete audit event as one line of JSON to a sink separate from your application logs. The event must answer *who, what, which, when, outcome* and carry a `schema_version` and a unique `event_id`.

**Starting point.** An empty file and the schema baseline from [middle.md](middle.md#designing-a-stable-audit-schema).

**Constraints.**
- Required top-level fields: `schema_version`, `event_id` (ULID or UUID), `event.{action, category, outcome, time}`, `actor.{type, id, name}`, `resource.{type, id}`.
- `time` must be UTC, ISO-8601, with millisecond precision.
- The function must *refuse* (raise/return error) if `outcome` or `actor.id` is missing — a half-event is a bug, not a warning.
- Output goes to a logger named `audit` whose records do **not** propagate to the root/app logger.

**Acceptance criteria.**
- [ ] A valid call produces exactly one line of compact JSON with all required fields present.
- [ ] Calling with a missing `outcome` raises/returns an error and writes nothing.
- [ ] The `audit` sink is provably separate — app `INFO` logs do not appear in it, and audit events do not appear in the app log.
- [ ] Two consecutive calls produce two distinct `event_id`s.

**Stretch goals.**
- Use a ULID so events sort by time, and verify two events emitted 1ms apart sort correctly by `event_id` alone.
- Add `source.{ip, user_agent, service, service_version}` populated from a fake request context.

### Task 2: Enforce append-only at the database level

**Problem.** Create a PostgreSQL `audit_events` table that the application role can `INSERT` into and `SELECT` from, but **cannot** `UPDATE` or `DELETE`. Prove the enforcement works by trying to mutate a row as the app role and watching it fail.

**Starting point.** A local Postgres instance and the DDL from [middle.md](middle.md#where-audit-events-live-append-only-stores).

**Constraints.**
- Create a dedicated `app_role` distinct from the table owner / superuser.
- `REVOKE UPDATE, DELETE ON audit_events FROM app_role;` then `GRANT INSERT, SELECT`.
- Insert one row as `app_role`.
- Attempt `UPDATE audit_events SET outcome='tampered' WHERE ...` as `app_role`.
- Attempt `DELETE FROM audit_events WHERE ...` as `app_role`.

**Acceptance criteria.**
- [ ] The `INSERT` succeeds as `app_role`.
- [ ] The `UPDATE` is rejected with a permission error (`permission denied for table audit_events`).
- [ ] The `DELETE` is rejected with a permission error.
- [ ] You can articulate, in one sentence, why this is *access-control* append-only and not *tamper-evidence* (a superuser/DBA can still mutate the row).

**Stretch goals.**
- Add a `BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`s, so even a role *with* UPDATE/DELETE is blocked — defense against the app's own bugs.
- Demonstrate the trigger fires even for the table owner (who has UPDATE/DELETE by default).

### Task 3: Stamp correlation IDs onto every event

**Problem.** Add `correlation.{request_id, trace_id}` to your Task 1 emitter, pulled from a request context rather than passed by hand. Then prove the IDs let you join audit to app logs.

**Starting point.** Your Task 1 emitter plus a tiny HTTP handler (any framework).

**Constraints.**
- A middleware generates a `request_id` (and accepts an inbound `traceparent` if present) and stores both in the request context.
- The audit emitter and the app logger both read these IDs from context — no manual threading through function arguments.
- One request emits: one app log line and one audit event, both carrying the same `request_id` and `trace_id`.

**Acceptance criteria.**
- [ ] A single request produces an app log and an audit event that share an identical `request_id`.
- [ ] If an inbound `traceparent` header is present, its trace-id is reflected in both.
- [ ] You can `grep <request_id>` across both sinks and get the matching pair.

**Stretch goals.**
- Propagate the W3C `traceparent` to a downstream HTTP call and confirm the same `trace_id` flows through.
- Show what the investigation looks like *without* correlation — try to match the audit event to its log line by timestamp alone and time how long it takes.

### Task 4: Capture delegation — record both identities under impersonation

**Problem.** Model a support admin impersonating a customer. Emit an audit event that records *both* the authenticated actor (the admin) and the on-behalf-of principal (the customer).

**Starting point.** The `Actor` struct from [middle.md](middle.md#identity--attribution-through-delegation).

**Constraints.**
- `actor` carries `type`, `id`, `name`, and a nested `on_behalf_of` that is null for normal actions.
- For the impersonation case, `actor` is the admin and `actor.on_behalf_of` is the customer.
- Write one query that finds *all impersonations by a given admin*: `WHERE actor.id = ? AND actor.on_behalf_of IS NOT NULL`.

**Acceptance criteria.**
- [ ] A normal action emits an event with `on_behalf_of = null`.
- [ ] An impersonation emits an event where both the admin and the customer are present and distinguishable.
- [ ] The impersonation query returns the impersonation event and excludes the normal one.
- [ ] You can state why recording *only* the admin, or *only* the customer, would each be a forensic failure.

**Stretch goals.**
- Add the other delegation cases from middle.md: service-account-on-behalf-of-user, API key with owning principal, cron job (`actor.type=service`, never blank).
- Add a `workflow_id` to a workflow-engine "as someone" action.

### Task 5: Redact a sensitive field at construction time

**Problem.** Given a raw action context containing an SSN and a card number, build an audit event that captures the *signal* without storing the *secret*: SSN becomes an HMAC token, card becomes `last4`, password is dropped entirely.

**Starting point.** The redaction guidance and `correlation_token` helper from [middle.md](middle.md#what-to-capture-what-to-redact).

**Constraints.**
- SSN → `HMAC-SHA256(key, ssn)` stored as `metadata.ssn_token`; the key loads from an env var, never hard-coded.
- Card number → `card.last4` only.
- Password → never present in the output at all.
- Redaction happens *as the event is built*, not as a scrub pass before the sink.

**Acceptance criteria.**
- [ ] The emitted event contains no raw SSN, no full PAN, and no password anywhere.
- [ ] Two events for the *same* SSN produce the *same* token (correlatable).
- [ ] Two events for *different* SSNs produce different tokens.
- [ ] Removing the HMAC key from the env causes the emitter to fail loudly, not to emit a raw value.

**Stretch goals.**
- Show that without the key, the token cannot be reversed (it is not a lookup table you can rebuild).
- Add a unit test asserting that a known set of "forbidden substrings" (the raw SSN, the full PAN) never appears in the serialized event.

### Task 6: Distinguish a `denied` event from a `success` event

**Problem.** Audit an authorization *denial*. A user attempts `customer.export` and is denied. Emit a `denied` event — and prove it is written *outside* any business transaction that rolled back.

**Starting point.** Your emitter plus a fake authz check.

**Constraints.**
- A successful export emits `outcome=success`; a denied attempt emits `outcome=denied`.
- The `denied` event must be emitted on its own — there is no successful business transaction to attach it to.
- Demonstrate the failure mode: if you (wrongly) put the `denied` write inside a transaction that rolls back, the event vanishes.

**Acceptance criteria.**
- [ ] A denial produces an audit event with `outcome=denied`.
- [ ] The denial event survives even though the business action did not happen.
- [ ] You can show, by experiment, that placing the denial write inside a rolled-back transaction loses it.
- [ ] A query `WHERE action='customer.export' AND outcome='denied'` finds the attempt.

**Stretch goals.**
- Audit a `failure` (the action was attempted, errored mid-flight) distinctly from a `denied` (the action was never authorized).
- Add a count of denials per actor per hour — the raw material for a brute-force alert.

---

## Core

These tasks are 1-to-3 hours each. They build the real machinery and require you to combine pieces, simulate failure, and write tests. If you can do all of them comfortably, you are at the middle-to-senior boundary.

### Task 7: Build an append-only store you cannot mutate (the lab)

**Problem.** Build a small `audit` library backed by an append-only Postgres table with a single `Record(...)` chokepoint. The library must make it *impossible* to write an incomplete event and *impossible* for the app role to mutate a written one. Ship a CI test that proves both.

**Starting point.** Tasks 1, 2, and 5. Language: Go or Python preferred (the chokepoint pattern is in [middle.md](middle.md#coding-patterns)).

**Constraints.**
- One `Record(ctx, event)` function is the only way to write. It rejects any event missing `actor.id`, `action`, `resource.id`, or `outcome`.
- The action name must be from a controlled-vocabulary enum/constants file — free-text actions are rejected at the chokepoint.
- The table grants `INSERT, SELECT` to the app role and nothing else; a `BEFORE UPDATE OR DELETE` trigger backs it up.
- Indexes exist for `(actor_id, occurred_at)`, `(resource_type, resource_id, occurred_at)`, `(action, occurred_at)`.

**Acceptance criteria.**
- [ ] A complete, valid event writes one row.
- [ ] An incomplete event is rejected before any I/O (test asserts zero rows written).
- [ ] A free-text action not in the enum is rejected.
- [ ] A CI test connects as the app role, attempts `UPDATE` and `DELETE`, and asserts both fail.
- [ ] `EXPLAIN` shows each of the three forensic queries uses an index, not a sequential scan.

**Sample solution (Go chokepoint sketch).**

```go
// Record is the ONLY write path. It rejects incomplete events before any I/O.
func Record(ctx context.Context, db DBTX, e Event) error {
    if e.Actor.ID == "" || e.Action == "" || e.Resource.ID == "" || e.Outcome == "" {
        return fmt.Errorf("incomplete audit event: %+v", e)
    }
    if !validActions[e.Action] { // controlled vocabulary, reviewed like an API
        return fmt.Errorf("unknown audit action %q", e.Action)
    }
    e.SchemaVersion, e.EventID, e.Time = "1.0", ulid.Make().String(), time.Now().UTC()
    payload, _ := json.Marshal(e)
    _, err := db.ExecContext(ctx, `
        INSERT INTO audit_events (event_id, occurred_at, actor_id, action,
            resource_type, resource_id, outcome, tenant_id, request_id, trace_id, payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        e.EventID, e.Time, e.Actor.ID, e.Action, e.Resource.Type, e.Resource.ID,
        e.Outcome, e.Resource.TenantID, e.Correlation.RequestID, e.Correlation.TraceID, payload)
    return err
}
```

**Stretch goals.**
- Add a `JSONB` `payload` column holding the full event and a generated column or index on a frequently-queried `payload->>'category'`.
- Add a partition-by-month strategy and show a query restricted to one month touches one partition.

### Task 8: Implement the outbox pattern and survive a crash

**Problem.** Implement the transactional outbox: write the audit event into an `audit_outbox` table *in the same transaction* as a business change (a customer delete), then a separate relay ships outbox rows to the durable audit sink and marks them shipped. Kill the process between the business commit and the relay run; prove the event still ships on restart.

**Starting point.** The outbox section and relay pattern from [middle.md](middle.md#the-transaction-coupling-question).

**Constraints.**
- The business `DELETE` and the `INSERT INTO audit_outbox (..., shipped=false)` are in one transaction — both commit or neither.
- A relay polls `WHERE shipped=false ORDER BY occurred_at LIMIT N`, ships each to the sink, then sets `shipped=true`.
- Delivery is at-least-once; the downstream sink **dedupes on `event_id`**.
- You must be able to `kill -9` the process after `COMMIT` but before the relay marks rows shipped, restart, and have exactly-one logical delivery downstream.

**Acceptance criteria.**
- [ ] Business change and outbox insert commit atomically (roll back the tx mid-way; neither persists).
- [ ] After a `kill -9` between commit and ship, restarting the relay ships the pending event.
- [ ] Forcing the relay to ship the same row twice does **not** produce two downstream records (dedupe on `event_id` works).
- [ ] You can state precisely which crash windows the outbox closes that "audit after the fact" leaves open.

**Stretch goals.**
- Add a reconciler that flags outbox rows stuck `shipped=false` for longer than a threshold (a stuck relay alert).
- Handle a non-DB action (an external API call): record *intent* before the call, *outcome* after, and reconcile dangling intents — the pattern from [middle.md](middle.md#tricky-questions) Q4.

### Task 9: Build a redaction layer with proof it cannot leak

**Problem.** Build a standalone `redact(rawEvent) -> safeEvent` function and a property-based test that asserts no raw secret can ever reach the sink, no matter the input.

**Starting point.** Task 5 plus the redact-at-construction pattern.

**Constraints.**
- `redact` tokenizes SSN/national-id (HMAC), masks cards to `last4`, drops passwords/secrets/tokens/cookies, and replaces a known-PII free-text field with structured fields.
- A list of "known-sensitive keys" drives the redactor; an unknown key with a suspicious value (e.g. matches a card/SSN regex) is flagged or dropped, not passed through.
- Write a property-based test (Hypothesis in Python, `testing/quick` or `gopter` in Go, fast-check in Node) that generates random events containing secrets and asserts the secret never appears in the serialized output.

**Acceptance criteria.**
- [ ] Given any generated input containing a planted secret, the secret's raw value is absent from `JSON.stringify(redact(input))`.
- [ ] The same SSN across two events yields the same token (redaction preserves correlatability).
- [ ] A field whose *name* is unknown but whose *value* matches a PAN regex is caught (defense against new fields smuggling PII).
- [ ] The redactor is invoked at construction, and there is a test proving a raw event object never reaches the DB call.

**Stretch goals.**
- Add a "capture the access, not the content" path: for `patient.record_read`, store `resource.id` and the *names* of fields viewed, never the field *values* — and test it.
- Add a deny-list CI check that greps your audit output fixtures for forbidden patterns.

### Task 10: The forensic-query lab — reconstruct one request across audit, logs, and trace

**Problem.** Stand up a tiny service that, for a single `customer.export` request, emits an audit event, structured app logs, and a distributed trace (OpenTelemetry → Jaeger/Tempo or a stub). Then write a script that, given *only* the audit event, pulls the matching app logs and the trace by shared ID.

**Starting point.** Tasks 3 and 7. Use OTEL for the trace; the correlation diagram is in [middle.md](middle.md#correlation-tying-audit-to-logs-and-traces).

**Constraints.**
- One request → one audit event (`action=customer.export`, with `row_count` in metadata), N app log lines, one trace with ≥3 spans (handler, db.query, export/upload).
- All three carry the same `request_id` and `trace_id`.
- The forensic script's input is the audit event row. Its output is: the audit event, the correlated app log lines, and the trace (or its span summary).

**Acceptance criteria.**
- [ ] The investigation is a *join*, not a timestamp search: the script uses `request_id`/`trace_id` from the audit event to fetch the rest.
- [ ] The trace shows where the 12 seconds went (which span dominated) for a deliberately slow export.
- [ ] Removing the `trace_id` from the audit event breaks the trace link — demonstrating why correlation is mandatory.
- [ ] You can answer "how many rows did this export touch, and how long did the S3 upload take?" from the joined data alone.

**Stretch goals.**
- Add a second, *unrelated* concurrent request and confirm your join does not cross-contaminate the two investigations.
- Tag spans with `user.id` and find the export by user instead of by `request_id`.

### Task 11: Map your event fields to ECS and to OCSF

**Problem.** Take your internal audit event and produce two mappings: one to Elastic Common Schema (ECS) field names, one to an OCSF event class (e.g. *API Activity* or *Authentication*). Identify every field that has no clean equivalent and decide what that means.

**Starting point.** The standard-schemas section of [middle.md](middle.md#standard-schemas-you-should-not-reinvent) and the live references: ECS field reference and the OCSF schema browser.

**Constraints.**
- Produce a table: your field → ECS field → OCSF attribute.
- For OCSF, pick the correct *event class* and fill its *required* attributes (`activity_id`, `status_id`, `category_uid`, etc.).
- Flag any field of yours with no standard home, and any *required* standard attribute you do not currently capture.

**Acceptance criteria.**
- [ ] A complete three-column mapping table for at least 12 fields.
- [ ] You named at least one field with no clean ECS equivalent and explained the implication.
- [ ] You identified at least one OCSF *required* attribute you were not capturing and added it.
- [ ] You can state the pragmatic stance from middle.md: author in your own schema but name fields to match a standard so the SIEM mapping is a rename, not a redesign.

**Stretch goals.**
- Write a small transformer that emits your event in ECS shape on one sink and OCSF shape on another from the same internal model.
- Explain where CloudTrail / GCP Audit Logs fit and why they do *not* cover your app's business actions.

### Task 12: Make a failed audit write loud, never silent

**Problem.** Inject a sink failure (DB down, disk full, network partition) and prove your system never lets an audited action proceed while *silently* dropping the audit. Implement both strategies — **fail-closed** (block the action) and **fail-open-but-alerted** (proceed, but record and alert the audit failure) — and decide which applies where.

**Starting point.** "Failing to write the audit event is itself an event" from [middle.md](middle.md#core-concepts).

**Constraints.**
- Simulate the sink being unreachable (point the DB at a dead port, or inject an error in the sink client).
- Fail-closed path: a high-sensitivity action (`customer.delete`) refuses to commit if it cannot be audited.
- Fail-open path: a lower-sensitivity action proceeds, but the failure is written to a separate `audit_failure` channel and raises an alert.
- There must be **no code path** where the write fails and nothing happens — no bare `catch {}` / `except: pass`.

**Acceptance criteria.**
- [ ] With the sink down, the fail-closed action returns an error and does not commit the business change.
- [ ] With the sink down, the fail-open action proceeds but emits an `audit_failure` record and triggers an alert.
- [ ] A grep of the codebase finds zero silent swallows around audit writes.
- [ ] You can defend, per action, why it is fail-closed or fail-open.

**Stretch goals.**
- Add a circuit-breaker so repeated sink failures flip the whole system to fail-closed automatically.
- Add a local durable buffer (append to a WAL file) that the relay drains when the sink recovers — so fail-open does not actually lose events.

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical work and cryptographic precision. This is where audit logging earns its name — tamper-evidence, signing, retention, erasure, and a real forensic investigation. Several have defensible-writeup answers rather than single right answers.

### Task 13: Build a hash-chained, tamper-evident audit log (the lab)

**Problem.** Take your append-only store and make it *tamper-evident*: each event carries the hash of the previous event, forming a chain. Then write a verifier that walks the chain and detects any insertion, deletion, reordering, or modification — even one performed by a DBA with full table privileges.

**Starting point.** Your Task 7 store. This is the senior-tier guarantee named in [middle.md](middle.md#tricky-points): access-control append-only is *not* the same as cryptographic tamper-evidence.

**Constraints.**
- Each row stores `prev_hash` and `this_hash = SHA-256(prev_hash || canonical(event_fields))`.
- "Canonical" means a deterministic serialization (sorted keys, fixed encoding) so the hash is reproducible — define it explicitly.
- A genesis record anchors the chain.
- The verifier recomputes every hash from the genesis forward and reports the *first* broken link with the row that fails.

**Acceptance criteria.**
- [ ] A clean chain verifies end-to-end with no errors.
- [ ] **Modify** a single field in a middle row (as superuser, bypassing the app) → the verifier flags that exact row and every row after it.
- [ ] **Delete** a middle row → the verifier detects the break (the next row's `prev_hash` no longer matches).
- [ ] **Reorder** two rows → detected.
- [ ] **Insert** a forged row → detected (it breaks the following link).
- [ ] You can explain why this detects but does not *prevent* tampering, and what it gives an investigator that access-control alone does not.

**Sample solution (chain + verify sketch, Python).**

```python
import hashlib, json

def canonical(event: dict) -> bytes:
    # Deterministic: sorted keys, no whitespace, UTF-8. The hash depends on THIS.
    return json.dumps(event, sort_keys=True, separators=(",", ":")).encode()

def link(prev_hash: str, event: dict) -> str:
    h = hashlib.sha256()
    h.update(prev_hash.encode())
    h.update(canonical(event))
    return h.hexdigest()

GENESIS = "0" * 64

def verify(rows: list[dict]) -> int | None:
    """Returns the index of the first broken link, or None if intact."""
    prev = GENESIS
    for i, row in enumerate(rows):
        expected = link(prev, row["event"])
        if row["this_hash"] != expected or row["prev_hash"] != prev:
            return i          # first tampered/missing/reordered row
        prev = row["this_hash"]
    return None
```

**Stretch goals.**
- Periodically publish the latest `this_hash` to an external, independent place (a second system, a printed log, a public timestamp) so even rewriting the *entire* chain is detectable.
- Benchmark the chain under write load: the chain serializes writes (each needs the previous hash). Measure throughput and discuss the contention.

### Task 14: Sign audit events for non-repudiation

**Problem.** Add cryptographic *signing* on top of the hash chain so the origin of each event (or each checkpoint) is provable and non-repudiable. Use an asymmetric signature (Ed25519) so a verifier with only the public key can confirm authenticity without being able to forge.

**Starting point.** Task 13. Use `crypto/ed25519` (Go), `cryptography` (Python), or `ring`/`ed25519-dalek` (Rust).

**Constraints.**
- Sign either each event's `this_hash` or, more efficiently, a periodic checkpoint (the chain head every N events / T seconds).
- The signing private key is held by the audit writer only; verification uses the public key.
- A verifier given the events + signatures + public key confirms: (a) the chain is intact (Task 13) and (b) the signatures are valid.
- Tampering with an event *and* re-signing is impossible without the private key.

**Acceptance criteria.**
- [ ] A signed checkpoint verifies against the public key.
- [ ] Modifying an event and recomputing the chain fails signature verification (the attacker lacks the private key).
- [ ] You can explain non-repudiation: why the *writer* cannot later deny having produced these events.
- [ ] You can explain the threat hash-chaining-without-signing does *not* cover (an attacker who can rewrite the whole chain *and* the published head — signing closes part of this).

**Stretch goals.**
- Implement key rotation: events signed under key v1 must still verify after rotating to v2; include a key-id in the checkpoint.
- Build a Merkle tree over a batch of events and sign only the root — then prove inclusion of a single event with a logarithmic-size proof (the foundation of transparency logs).

### Task 15: WORM storage with S3 Object Lock and retention

**Problem.** Configure object storage that *physically/contractually* prevents modification or deletion for a retention period: enable S3 Object Lock (or MinIO's equivalent) in compliance mode, write audit objects, and prove you cannot delete them before the retention expires.

**Starting point.** The WORM and retention material — senior tier. Use real AWS S3 or MinIO locally (MinIO supports Object Lock).

**Constraints.**
- Create a bucket with Object Lock enabled; set a default retention (e.g. 7 days, compliance mode).
- Write an audit batch object.
- Attempt to `DeleteObject` and `PutObject` (overwrite) the locked object before retention expires.
- Attempt the delete as an *admin/root* identity, not just the writer.

**Acceptance criteria.**
- [ ] The audit object is written and readable.
- [ ] `DeleteObject` before retention expiry is rejected — even for an admin in compliance mode.
- [ ] Overwriting the object is rejected / creates a new version, leaving the original intact.
- [ ] You can distinguish *governance* mode (privileged users can override) from *compliance* mode (no one can, until expiry) and say which a regulator expects.

**Stretch goals.**
- Add a lifecycle policy that transitions objects to cold storage (Glacier) after the hot retention window, preserving the lock.
- Add a legal-hold flag and show it prevents deletion *indefinitely*, independent of the retention clock.

### Task 16: Retention with legal hold and lifecycle expiry

**Problem.** Implement a retention policy: audit events expire and are purged after their retention period (e.g. PCI's one-year-hot/extended-cold), *except* records under legal hold, which are exempt from purge until the hold is lifted. Build the purge job and the hold mechanism and prove the interaction.

**Starting point.** Retention & legal hold (senior tier).

**Constraints.**
- Each event (or partition) has a `retention_until` derived from its category and the applicable regime.
- A purge job deletes (or transitions to deeper cold) events past `retention_until`.
- A `legal_hold` flag (per matter, ideally) exempts matching events from purge regardless of `retention_until`.
- Purging must itself be audited (the purge is an action; record it).

**Acceptance criteria.**
- [ ] An event past `retention_until` with no hold is purged by the job.
- [ ] An event past `retention_until` *under hold* is retained.
- [ ] Lifting the hold lets the next purge remove the previously-held, expired event.
- [ ] The purge job's own actions appear in the audit trail (you purged X events for matter Y at time Z).
- [ ] You can map retention durations to at least two regimes (e.g. PCI DSS Req. 10 ≥ 1 year; HIPAA 6 years for certain records).

**Stretch goals.**
- Make the purge idempotent and resumable (a crash mid-purge does not double-count or skip).
- Reconcile retention against the hash chain: purging old events must not break verifiability of the remaining chain (hint: anchor checkpoints, or chain over surviving records with a documented epoch).

### Task 17: GDPR erasure against an immutable audit log

**Problem.** Reconcile two requirements that appear to contradict: GDPR's right to erasure ("delete this person's data") and audit immutability ("never modify an audit record"). Implement the standard resolution — pseudonymized subject tokens in the audit log, with the token→identity mapping in a separate, erasable store.

**Starting point.** [middle.md](middle.md#tricky-questions) Q3 and the senior treatment.

**Constraints.**
- The audit event stores a `subject_token` (pseudonym), never the raw subject identity.
- A separate, erasable mapping store holds `subject_token → real identity`.
- On an erasure request, you delete the *mapping*, not the audit record.
- After erasure: you can still prove "subject token X did Y at time Z" (audit integrity intact), but the link to the real person is severed (erasure satisfied).

**Acceptance criteria.**
- [ ] Audit records contain no raw subject identity — only tokens.
- [ ] Before erasure, the mapping resolves token → person.
- [ ] After erasure, the mapping no longer resolves, but the audit records (and the hash chain over them) remain intact and verifiable.
- [ ] The hash chain still verifies after erasure (you erased the *mapping*, not the chained record).
- [ ] You can articulate why erasing the audit record itself would have been the wrong move (breaks immutability and the chain).

**Stretch goals.**
- Handle the actor *being* the data subject (a user requesting erasure of their own activity) vs. the actor acting *on* a subject — both need tokenization, but the keys differ.
- Discuss the edge: if `request_id`/correlation IDs encode user info, they too must be opaque or they leak identity post-erasure.

### Task 18: Forensic investigation across the full trail (the lab)

**Problem.** You are given a seeded audit database (a few thousand events across multiple actors, tenants, and actions, including some impersonations and some anomalies). Investigate and answer a forensic question: *"Did support agent `u_admin_alice` access any customer's financial records outside her assigned tickets last month, and prove the records were not tampered with after the fact?"*

**Starting point.** Tasks 7, 10, and 13. Build a small generator that seeds the data, then investigate it as if you did not write the generator.

**Constraints.**
- Use only queries against the audit store and the correlated logs/traces — no peeking at the generator.
- Your answer must: (a) enumerate the accesses by that actor, (b) join `metadata.reason`/ticket numbers to determine which were unauthorized, (c) follow `request_id` to the operational detail, and (d) run the hash-chain verifier to certify the records were not altered.
- Produce a written forensic finding: what happened, when, by whom, on whose behalf, with what evidence, and a statement of integrity.

**Acceptance criteria.**
- [ ] You found the impersonation/anomalous-access events with a query, not by eyeballing.
- [ ] You distinguished authorized (ticket-backed) from unauthorized accesses.
- [ ] You produced the correlated operational evidence for at least one suspect access.
- [ ] You ran the verifier and can certify (or refute) that the audit records were intact.
- [ ] Your written finding is something you would hand to a compliance officer — specific actors, IDs, times, and an integrity statement.

**Stretch goals.**
- Detect a tampering attempt the generator planted (a modified row) and show exactly how the verifier surfaced it.
- Add a multi-tenant twist: prove tenant A's auditor could not have seen tenant B's events (tenant scoping as an access-control boundary, not just a filter).

---

## Capstone

These are open-ended, system-level scenarios. The point is not one correct answer but a complete, defensible design you could present at a review and operate in production. Treat each as if you are pitching it to a staff engineer and a compliance officer in the same room.

### Task 19: Compliance-mapping exercise — map controls to SOC 2 / HIPAA / PCI DSS / GDPR

**Problem.** You have an audit system (the one you built across these labs). Produce a control-mapping document that, clause by clause, shows which part of your system satisfies the audit-relevant requirements of SOC 2, HIPAA, PCI DSS, and GDPR — and, honestly, where the gaps are.

**Constraints.**
- For each regime, pull the *specific* audit-relevant clauses, not vibes:
  - **PCI DSS Requirement 10** — what events must be logged (access to cardholder data, admin actions, auth attempts), what fields each record must contain (user, type, date/time, success/failure, origination, affected resource), time sync, and ≥1-year retention.
  - **HIPAA Security Rule §164.312(b)** — audit controls for PHI access (log *that* access happened and *which* record; do not copy PHI in).
  - **SOC 2** (Common Criteria, esp. CC7.x monitoring / CC6.x logical access) — logging, monitoring, and evidence of access controls.
  - **GDPR** — lawful basis for processing the audit data itself, pseudonymization (Art. 32), and the erasure-vs-immutability resolution (Art. 17).
- For *each* clause: name the control in your system (the table, the chokepoint, the hash chain, the retention job, the tokenization), the evidence you would show an auditor, and the gap if any.

**Acceptance criteria.**
- [ ] A clause-by-clause table for all four regimes, each row mapping a requirement to a concrete control in your code/infra.
- [ ] PCI Req. 10's record-content list is checked field-by-field against your schema (every required field accounted for).
- [ ] The HIPAA "log access, not content" requirement maps to your "capture the access, not the content" implementation.
- [ ] The GDPR erasure requirement maps to your pseudonymization + erasable-mapping design (Task 17).
- [ ] You honestly list the gaps — controls a regime expects that you have not built — and what it would take to close each.

**What "done" looks like.** You can hand the document to a compliance officer and they can use it as the audit-logging section of an evidence package. Every claim points at a specific control (a `REVOKE`, a verifier, a retention policy) and an artifact you can produce on demand (a CI test output, a chain-verification report, a retention-job log). The gaps section is specific enough to become a backlog. You can walk a staff engineer through any single clause in two minutes and show the line of code or config that satisfies it.

### Task 20: Design a multi-tenant audit pipeline that cannot drop an event

**Problem.** Design (and prototype the core of) an audit pipeline for a multi-tenant SaaS that ingests audit events from dozens of services, never samples or drops an audit event even under load, isolates tenants, and lands everything in a durable, append-only, tamper-evident store of record with a SIEM fan-out for alerting.

**Constraints.**
- Audit events are **exempt from sampling** — unlike app telemetry, they go through a path that cannot be load-shed. Contrast this explicitly with [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/).
- Tenant isolation is both a query filter *and* an access-control boundary — tenant A's auditor must not be able to read tenant B's events.
- The store of record is durable and append-only (ideally tamper-evident); the SIEM is a *fan-out* sink for search/alerting, never the only copy.
- Back-pressure strategy when the durable sink is slow: buffer (outbox / durable queue), never silently drop.
- Exactly-once-*effective* delivery: at-least-once transport + dedupe on `event_id`.

**Hints.**
- Outbox per service → a durable queue (Kafka / a partitioned topic per tenant or hashed by tenant) → consumers that write to the store of record and fan out to the SIEM.
- The "cannot drop" guarantee comes from: transactional capture at the source (outbox), a durable buffer in the middle, and a sink that applies back-pressure rather than load-shedding.
- Tenant isolation: partition/shard by tenant, scope every query by `tenant_id`, and enforce row-level or schema-level access so the *query layer* cannot cross tenants.

**What "done" looks like.** You have an architecture diagram and a prototype of the critical path: an outbox-fed consumer that writes to an append-only store and fans out to a (stubbed) SIEM, with dedupe on `event_id` and per-tenant scoping. You can demonstrate, by killing a consumer mid-stream and restarting, that no event is lost and none is double-counted. You can show a load test where the SIEM is artificially slow and the pipeline buffers rather than drops. You wrote a one-page operator doc covering: how back-pressure behaves, how a tenant's auditor queries only their data, and how the on-call verifies no events were lost during an incident. You can defend why every "drop the event" shortcut a normal telemetry pipeline would take is forbidden here.

### Task 21: Build a forensic query tool an auditor could actually use

**Problem.** Build a small query/investigation tool (CLI or simple web UI) over your audit store that a non-engineer auditor could use to answer the standard forensic questions, with integrity verification built in and tenant scoping enforced.

**Constraints.**
- Canned investigations, each one query under the hood: "what did actor X do in range R?", "who touched resource Y?", "every occurrence of action Z", "all impersonations by admin A", "all PHI/financial-record accesses without a ticket reference".
- Every result set comes with an *integrity certificate*: the tool runs the hash-chain verifier over the returned range and states whether the records are intact.
- Tenant scoping is mandatory — the auditor's identity determines which tenant(s) they may query; cross-tenant queries are impossible, not merely discouraged.
- Output is exportable as evidence (CSV/JSON + the integrity statement + the query that produced it, for reproducibility).

**Hints.**
- The canned queries map directly to the indexes you built in Task 7 — `(actor_id, time)`, `(resource_type, resource_id, time)`, `(action, time)`.
- The integrity certificate reuses Task 13's verifier; surface "intact" / "broken at row N" in plain language.
- Reproducibility matters for evidence: store the exact query + parameters + the verifier result alongside the export.

**What "done" looks like.** An auditor (role-played by you, pretending you have never seen the code) can answer all five canned questions without writing SQL, scoped to their tenant, and every answer carries a statement of whether the underlying records were tamper-free. You can demo: ask "all impersonations by `u_admin_alice` last month," get a result, an integrity certificate, and an exportable evidence bundle including the query for reproduction. You attempt a cross-tenant query and it is refused. You tamper with one underlying row and the tool's integrity certificate flips from "intact" to "broken at row N" with the offending row identified. You wrote a half-page guide titled "How to run a standard audit investigation" aimed at someone who is not an engineer.

---

## If you can do all of these, you have the senior level

You can stand up an append-only store and prove the application cannot mutate it. You can build a hash chain and a signature scheme and demonstrate that insertion, deletion, reordering, and modification are all detectable — and, with signing, non-repudiable. You can hold the line on retention and legal hold, reconcile GDPR erasure with audit immutability, and run a real forensic investigation across audit, logs, and traces with an integrity certificate attached. You can map every control you built to the clause in SOC 2, HIPAA, PCI DSS, or GDPR that demands it, and you can name your gaps honestly. The next step is not more audit-logging exercises — it is operating this at scale (the professional tier: exactly-once at volume, forensic admissibility, cross-region integrity) and designing systems whose audit trail is trustworthy enough that an auditor, a regulator, and a court would all accept it.

---

## Related Topics

- [Audit Logging — Junior](junior.md)
- [Audit Logging — Middle](middle.md)
- [Audit Logging — Senior](senior.md)
- [Audit Logging — Professional](professional.md)
- [Audit Logging — Interview](interview.md)
- Sibling diagnostic topics: [Logging](../logging/), [Tracing](../tracing/), [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/)
- Cross-roadmap skills: `encryption-basics`, `secrets-management`, `database-migration-patterns`, `auth-token-security`, `api-authentication`

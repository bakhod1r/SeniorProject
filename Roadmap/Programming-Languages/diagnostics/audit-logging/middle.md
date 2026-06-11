# Audit Logging — Middle Level

> **Topic:** [Audit Logging Roadmap](README.md)
> **Focus:** Turning "the five W's in a separate file" into a real, queryable audit pipeline. A stable event schema (and the standards that already define one). What to capture vs redact. Append-only stores and where to put them. Correlating audit events with traces and logs. The mistakes that quietly make an audit log useless.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Designing a Stable Audit Schema](#designing-a-stable-audit-schema)
6. [Standard Schemas You Should Not Reinvent](#standard-schemas-you-should-not-reinvent)
7. [What to Capture, What to Redact](#what-to-capture-what-to-redact)
8. [Where Audit Events Live: Append-Only Stores](#where-audit-events-live-append-only-stores)
9. [The Transaction-Coupling Question](#the-transaction-coupling-question)
10. [Correlation: Tying Audit to Logs and Traces](#correlation-tying-audit-to-logs-and-traces)
11. [Identity & Attribution Through Delegation](#identity--attribution-through-delegation)
12. [Code Examples](#code-examples)
13. [Pros & Cons](#pros--cons)
14. [Use Cases](#use-cases)
15. [Coding Patterns](#coding-patterns)
16. [Clean Code](#clean-code)
17. [Best Practices](#best-practices)
18. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Tricky Points](#tricky-points)
21. [Test Yourself](#test-yourself)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Summary](#summary)
25. [What You Can Build](#what-you-can-build)
26. [Further Reading](#further-reading)
27. [Related Topics](#related-topics)
28. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **You have the five W's in a separate file. Now make it a system you can actually query, trust, and operate.**

At junior level the goal was conceptual: an audit event is *who did what to which resource, when, with what outcome*, and it goes to a separate sink. That's correct and it's the foundation. But "a separate file of JSON lines" is not yet an audit *system*. The middle-level work is the engineering that turns it into one:

- A **schema** stable enough to query across six years of data — and the realization that you should adopt an existing standard (ECS, OCSF, CloudEvents) rather than invent fields nobody else understands.
- A disciplined answer to **what goes in the event and what must be kept out** — the actor's identity belongs in; their password, the full card number, the medical detail usually do not.
- A real **store**: an append-only table, an object-storage stream, or a managed sink — not a file that any process can `> overwrite`.
- **Correlation**: the audit event must link back to the operational logs and the distributed trace for the same request, or forensics becomes archaeology.
- **Attribution through delegation**: capturing the *real* actor when an admin impersonates a user, when a service acts on behalf of a user, when an API key fronts for a human.

This is also where most audit logs quietly rot. They look fine in code review and fail silently in production — events dropped under load, a schema that drifted, a field renamed so old queries miss records, PII smeared into cleartext. We'll name those failure modes precisely.

> 🎓 **Why this matters at middle level:** A junior produces audit *events*. A middle engineer produces an audit *trail you can investigate*. The difference shows up exactly once — during a real incident or audit — and by then it's too late to fix the schema. The work here is the unglamorous part that determines whether the audit log is an asset or a liability.

---

## Prerequisites

- **Required:** All of [`junior.md`](junior.md) — the five W's, the separate-sink rule, the audit-vs-app-log distinction.
- **Required:** Comfort with structured logging and JSON. See [`../logging/middle.md`](../logging/middle.md).
- **Required:** Basic database transactions — what `BEGIN`/`COMMIT`/`ROLLBACK` mean.
- **Required:** Correlation/request IDs and how they propagate through a request. See [`../logging/middle.md`](../logging/middle.md) and [`../tracing/`](../tracing/).
- **Helpful:** Awareness of distributed tracing (spans, trace IDs) — [`../tracing/`](../tracing/).
- **Helpful:** Some exposure to a compliance regime (SOC 2, HIPAA, PCI DSS, GDPR) — enough to know they exist and demand retention.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Audit schema** | The agreed set of fields and types every audit event conforms to. Stable across versions. |
| **ECS** | Elastic Common Schema — Elastic's field naming standard (`event.action`, `user.name`, `source.ip`). Widely supported by log tooling. |
| **OCSF** | Open Cybersecurity Schema Framework — a vendor-neutral security event schema with explicit Authentication, Account Change, and API Activity classes. |
| **CloudEvents** | A CNCF spec for the *envelope* of an event (id, source, type, time, subject, data). Often wraps a domain payload. |
| **CEF / LEEF** | Common Event Format / Log Event Extended Format — older line-based formats SIEMs ingest. |
| **Append-only store** | Storage that supports insert but not update/delete (enforced by permissions, DB triggers, or storage type). |
| **WORM** | Write Once Read Many — storage physically/contractually preventing modification (S3 Object Lock, immutable buckets). (Senior topic; named here.) |
| **Outbox pattern** | Writing the audit event into a DB table in the same transaction as the business change, then relaying it asynchronously. |
| **Redaction** | Removing or masking sensitive data from an event before it's stored. |
| **Tokenization / hashing** | Replacing a sensitive value with a token or one-way hash so you can correlate without storing the secret. |
| **On-behalf-of (OBO)** | A delegation pattern where principal A acts as principal B; both must be recorded. |
| **Effective actor / authenticated actor** | The principal whose permissions were used (effective) vs the one who authenticated (authenticated). They differ under impersonation. |
| **Correlation ID** | The ID that ties an audit event to the logs and trace for the same operation. |
| **Schema drift** | Uncontrolled change to event fields over time, breaking old queries. |
| **Sink fan-out** | Writing the same audit event to multiple destinations (DB + SIEM + cold archive). |

---

## Core Concepts

### 1. The Schema Is the Product

The code that emits an event is throwaway; the *shape of the event* lives for years. A query written today (`WHERE event.action = 'customer.export'`) must keep working against data written by a version of your code you deleted three years ago. That means: pick field names once, type them precisely, version the schema explicitly, and **never silently rename a field**. Schema stability is the single highest-leverage decision at this level.

### 2. Capture the Identity, Not the Secret

Audit logging inverts the app-log PII rule — you *must* record who the actor is. But "record the actor" never means "record their password, their card number, or the full medical record they viewed." The discipline is: record enough to answer *who, what, which, when, outcome* and to investigate, and **nothing that turns the audit log itself into a breach if it leaks**. Record `card.last4` and a token, not the PAN. Record `record.id` accessed, not the record's contents.

### 3. Append-Only Is a Property You Enforce, Not Hope For

A JSON file is "append-only" only until some process opens it `w` instead of `a`. A DB table is append-only only if you *revoke UPDATE and DELETE* on it. At middle level you move from "we append to it" to "the store *cannot* be modified by the application that writes to it." The integrity guarantees (hashing, WORM) come at senior level; the *access-control* version of append-only starts here.

### 4. An Uncorrelated Audit Event Is Half-Useless

When an investigator finds `customer.export` at 14:02, the next question is *"show me everything about that request."* If the audit event carries the same `request_id`/`trace_id` as the operational logs and the distributed trace, that's one query away. If it doesn't, the investigator is grepping across nine services by timestamp and guessing. Correlation IDs are cheap to add and enormously expensive to lack.

### 5. The Real Actor Is Often Not the Obvious One

Modern systems are full of delegation: an admin impersonating a customer, a service account acting for a user, an API key issued to a partner, a workflow engine running a step "as" someone. The naive `actor = currentUser` captures the *surface* identity and loses the *responsible* one. Getting attribution right under delegation is the subtle skill of this level.

### 6. Failing to Write the Audit Event Is Itself an Event

If the audit sink is unreachable, you have a decision to make — and "drop it silently" is the wrong one. Either the action **fails closed** (don't let it proceed un-audited), or it proceeds and the *failure to audit* is itself alerted and recorded. The right choice is contextual (a senior topic), but at middle level the rule is: **a missing audit write must never be silent.**

---

## Designing a Stable Audit Schema

A practical, queryable audit event has more structure than the junior version. Here is a solid baseline (field names borrowed from ECS/OCSF conventions so they interoperate with tooling):

```json
{
  "schema_version": "1.0",
  "event": {
    "id": "01J0Z9...ULID",
    "action": "customer.export",
    "category": "data_access",
    "outcome": "success",
    "time": "2026-06-11T14:02:09.471Z"
  },
  "actor": {
    "type": "user",
    "id": "u_8821",
    "name": "alice@corp.com",
    "session_id": "sess_9f3a",
    "on_behalf_of": null
  },
  "resource": {
    "type": "customer",
    "id": "4471",
    "tenant_id": "t_acme"
  },
  "source": {
    "ip": "203.0.113.42",
    "user_agent": "Mozilla/5.0 ...",
    "service": "billing-api",
    "service_version": "2.317"
  },
  "correlation": {
    "request_id": "req_7af3c1",
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
  },
  "metadata": {
    "row_count": 10421,
    "reason": "TICKET-882",
    "format": "csv"
  }
}
```

Design rules baked into that shape:

| Rule | Why |
|------|-----|
| **`schema_version` at the top** | When you must change the schema, old and new events are distinguishable. Never break old readers silently. |
| **A unique `event.id` (ULID/UUID)** | De-duplication, exactly-once references, and "this exact event" lookups. ULIDs sort by time, a bonus. |
| **`event.category`** | Coarse grouping (`authentication`, `authz`, `data_access`, `data_change`, `admin`) so you can query "all data access" without enumerating every action. |
| **Namespaced fields** (`actor.*`, `resource.*`) | Avoids collisions and reads cleanly in any log backend. |
| **`tenant_id` on the resource** | Multi-tenant systems must filter by tenant for both queries and access control. |
| **`correlation.*` always present** | The investigative join key. |
| **Stable `action` taxonomy** | Documented, enumerated, reviewed. The set of valid actions is a controlled vocabulary, not free text. |

### Treat the action taxonomy as a controlled vocabulary

Maintain a single source of truth — a constant/enum — for every valid action. New actions get added through code review like any other API change. This prevents the slow death where `customer.export`, `export_customer`, and `customer.exported` all coexist and every query misses a third of the data.

```go
// audit/actions.go — the controlled vocabulary. One place. Reviewed.
const (
	ActionLogin          = "auth.login"
	ActionLoginFailed    = "auth.login_failed"
	ActionLogout         = "auth.logout"
	ActionRoleGranted    = "iam.role_granted"
	ActionRoleRevoked    = "iam.role_revoked"
	ActionCustomerRead   = "customer.read"
	ActionCustomerExport = "customer.export"
	ActionCustomerDelete = "customer.delete"
	ActionConfigChange   = "config.change"
)
```

---

## Standard Schemas You Should Not Reinvent

You are almost certainly not the first to define an audit event. Adopting a standard buys you tooling, parsers, SIEM integration, and field names your future security team already knows.

| Schema | Best for | Shape |
|--------|----------|-------|
| **ECS (Elastic Common Schema)** | If you ship to Elastic/OpenSearch or anything that speaks ECS | Flat-ish dotted fields: `event.action`, `event.outcome`, `user.name`, `source.ip`, `trace.id`. |
| **OCSF (Open Cybersecurity Schema Framework)** | Security-first orgs; explicit *Authentication*, *Account Change*, *API Activity* classes | Typed event classes with required attributes and enumerated `activity_id`/`status_id`. |
| **CloudEvents** | When the audit event flows through an event bus and you want a standard *envelope* | Envelope (`id`, `source`, `type`, `time`, `subject`) wrapping a domain `data` payload. |
| **CEF / LEEF** | Legacy SIEM ingestion (ArcSight, QRadar) | Line-based `key=value` with a fixed header. Ingest-only; don't author new systems on it. |

A pragmatic stance: **author your events in your own clean internal schema, but name fields to match ECS/OCSF** so the mapping to a SIEM later is a rename, not a redesign. The cost of aligning field names early is near zero; the cost of a big migration later is not.

> Where do CloudTrail / GCP Audit Logs / Azure Activity Logs fit? They audit *cloud control-plane API calls* (who launched an EC2 instance, who changed an IAM policy) — infrastructure actions, with a mature schema. They do **not** audit your application's business actions ("alice deleted customer 4471"). You need both: the cloud's audit logs for infra, your own for app-level acts. Don't assume CloudTrail covers you.

---

## What to Capture, What to Redact

The governing question: *"If this audit event leaked, what damage would it do?"* Capture everything needed to investigate; capture nothing that turns the audit log into a secondary breach.

| Capture | Redact / transform | Never store |
|---|---|---|
| Actor id, name, type, session | Card number → `last4` + token | Passwords (even hashed — you don't need them) |
| Action, category, outcome | Email → keep (it's the actor) but hash if used as a join key for privacy regimes | Full PANs / CVVs (PCI scope explosion) |
| Resource type + id | SSN / national ID → hash or `last4` | Raw secrets, API keys, tokens |
| Source IP, user agent | Free-text that may contain PII → structured fields instead | Full request/response bodies |
| Changed-field *names*, old/new *non-sensitive* values | The *content* of a sensitive record read → record `resource.id`, not the data | Encryption keys, session cookies |
| Row counts, ticket numbers, reasons | Geolocation if regime-sensitive → coarsen | Health/medical detail beyond "record X was viewed" |

### Two techniques that let you keep the signal without the secret

**Hashing for correlation.** You need to know "the same SSN was accessed by two different accounts" without storing the SSN. Store `HMAC(key, ssn)` — the same input yields the same token, so you can correlate, but the token is not reversible without the key.

```python
import hmac, hashlib
def correlation_token(value: str, key: bytes) -> str:
    return hmac.new(key, value.encode(), hashlib.sha256).hexdigest()
# Same SSN → same token → correlatable; secret stays out of the log.
```

**Recording the access, not the content.** For "alice viewed patient 4471's record," the audit event records `action=record.read, resource={type:patient, id:4471}` — *that the access happened*, not the contents of the record. The content lives in the database; the audit log records the *event* of access. Storing the content would duplicate sensitive data into a long-retention store. Don't.

> The PII tension is real and regime-specific: HIPAA *requires* you to log who accessed PHI (the actor and the record id) but you would not copy the PHI itself into the audit log. GDPR's "right to erasure" collides with "audit logs must be immutable" — the standard resolution is to store a pseudonymized subject reference (a token) in the audit log and erase the mapping, not the audit record. (Deep dive in [`senior.md`](senior.md).)

---

## Where Audit Events Live: Append-Only Stores

A file of JSON lines is a fine *emit* format and a poor *store*. Middle-level options, roughly in order of strength:

| Store | Append-only mechanism | Notes |
|-------|----------------------|-------|
| **Separate DB table** | Revoke `UPDATE`/`DELETE` from the app role; allow only `INSERT` | Queryable, transactional, familiar. The pragmatic default. |
| **Append-only via DB trigger** | A `BEFORE UPDATE/DELETE` trigger that raises an error | Enforces immutability even against the app's own bugs. |
| **Object storage stream** (S3/GCS) | Per-event or batched objects; lifecycle to cold storage | Cheap at scale; pairs with WORM (Object Lock) at senior level. |
| **Managed audit sink** | Provider enforces immutability + retention | Least work; check it covers *app* events, not just infra. |
| **Dedicated log pipeline → SIEM** | The SIEM's index is the store | Great for search/alerting; ensure the pipeline can't sample audit events. |

A minimal append-only table, with the immutability enforced by the *database*, not by hope:

```sql
CREATE TABLE audit_events (
    event_id     TEXT PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL,
    actor_id     TEXT NOT NULL,
    action       TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id  TEXT NOT NULL,
    outcome      TEXT NOT NULL,
    tenant_id    TEXT,
    request_id   TEXT,
    trace_id     TEXT,
    payload      JSONB NOT NULL          -- the full structured event
);

-- The application role can ONLY insert. No updates, no deletes.
REVOKE UPDATE, DELETE ON audit_events FROM app_role;
GRANT INSERT, SELECT ON audit_events TO app_role;

-- Indexes for the queries forensics will actually run.
CREATE INDEX ON audit_events (actor_id, occurred_at);
CREATE INDEX ON audit_events (resource_type, resource_id, occurred_at);
CREATE INDEX ON audit_events (action, occurred_at);
```

> The index choices encode the questions you'll ask: "what did this actor do?", "who touched this resource?", "every occurrence of this action." Audit logs are write-heavy and read-rarely-but-critically; index for the rare critical read.

---

## The Transaction-Coupling Question

A genuinely important middle-level decision: should the audit write be part of the same transaction as the business change?

**Option A — Same transaction.** Write the audit row inside the same DB transaction as the action.

```sql
BEGIN;
  DELETE FROM customers WHERE id = '4471';
  INSERT INTO audit_events (...) VALUES (...);   -- same tx
COMMIT;
```

*Pro:* the action and its audit record commit or roll back together — you can never have "the change happened but wasn't audited." *Con:* couples your audit store to your business DB; you can't easily route audit to a different system; a slow audit insert slows the business transaction.

**Option B — After the fact.** Do the action, commit, then write the audit event.

*Pro:* decoupled, flexible sink, no impact on business-tx latency. *Con:* a crash between commit and audit-write leaves an un-audited change — the exact gap audit logs exist to prevent.

**Option C — The outbox pattern (best of both).** Write the audit event into an `outbox` table *in the same transaction* as the change, then a separate relay reliably ships it to the real audit sink.

```sql
BEGIN;
  DELETE FROM customers WHERE id = '4471';
  INSERT INTO audit_outbox (event_id, payload, shipped) VALUES (..., false);
COMMIT;
-- A relay polls audit_outbox WHERE shipped = false, ships to the audit sink,
-- marks shipped = true. At-least-once delivery; dedupe on event_id downstream.
```

The outbox gives you transactional capture (it commits with the change) *and* a flexible, decoupled sink. It's the pattern most mature systems converge on. Exactly-once and ordering subtleties are covered in [`professional.md`](professional.md).

---

## Correlation: Tying Audit to Logs and Traces

The audit event is the *index entry*; the operational logs and trace are the *detail*. Connect them with shared IDs:

```text
   request comes in ──► generate/propagate  request_id + trace_id
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        APP LOGS          AUDIT EVENT       DISTRIBUTED TRACE
     request_id=7af3     request_id=7af3    trace_id=4bf9...
     trace_id=4bf9...    trace_id=4bf9...   (spans)
              │               │                │
              └───────────────┴────────────────┘
                  one investigation, one join key
```

Concretely: pull `request_id` and `trace_id` from the request context and stamp them onto the audit event (you saw the fields in the schema above). Then during an investigation:

1. Find the audit event: `WHERE action='customer.export' AND occurred_at > ...`
2. Take its `request_id` / `trace_id`.
3. Query the app logs and the trace UI by the same ID.
4. You now have: the deliberate act (audit), the full execution detail (logs), and the cross-service timing (trace) — for the exact same operation.

Without correlation IDs, step 2 onward becomes "find log lines near 14:02:09 and hope." See [`../tracing/`](../tracing/) and [`../logging/middle.md`](../logging/middle.md) for how the IDs propagate.

---

## Identity & Attribution Through Delegation

The hardest part of attribution is that the *surface* actor often isn't the *responsible* one. Capture both.

| Scenario | Authenticated actor | Effective / target | What to record |
|----------|--------------------|--------------------|----------------|
| **Admin impersonates a user** (support tooling) | the admin | the impersonated user | `actor=admin`, `on_behalf_of=user` — both, always |
| **Service account acts for a user** (OBO token) | the service | the user | `actor=service`, `on_behalf_of=user` |
| **API key issued to a partner** | the key | the partner org / human owner | `actor.type=apikey, id=key_id`, plus the owning principal |
| **Workflow engine runs a step "as" someone** | the workflow | the initiating user | `actor=workflow`, `on_behalf_of=user`, plus `workflow_id` |
| **Cron / scheduled job** | the service account | (none, or the policy) | `actor.type=service, id=retention-cleaner` |

The rule: **never collapse delegation to a single identity.** Recording only the admin loses *which user's data was touched*; recording only the impersonated user hides *who actually did it* (and an impersonating admin acting maliciously is precisely what an audit log must catch).

```go
type Actor struct {
	Type       string  // user | service | apikey | workflow
	ID         string
	Name       string
	SessionID  string
	OnBehalfOf *Actor  // nil unless this is a delegated action
}

// When alice (support admin) impersonates customer u_4471:
actor := Actor{
	Type: "user", ID: "u_admin_alice", Name: "alice@corp.com", SessionID: "sess_9f3a",
	OnBehalfOf: &Actor{Type: "user", ID: "u_4471", Name: "bob@example.com"},
}
```

Where does the actor come from? It is established at the **authenticated edge** (auth middleware), placed in the request context, and read once. Reconstructing it deep in the call stack is how you get it wrong. See the `api-authentication` and `auth-token-security` skill areas for how the identity gets there.

---

## Code Examples

### Go — an audit service that writes to an append-only table via the outbox

```go
package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/oklog/ulid/v2"
)

type Event struct {
	SchemaVersion string         `json:"schema_version"`
	EventID       string         `json:"event_id"`
	Action        string         `json:"action"`
	Category      string         `json:"category"`
	Outcome       string         `json:"outcome"`
	Time          time.Time      `json:"time"`
	Actor         Actor          `json:"actor"`
	Resource      Resource       `json:"resource"`
	Source        Source         `json:"source"`
	Correlation   Correlation    `json:"correlation"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

// Record inserts the event into the outbox IN THE SAME TRANSACTION as the
// business change. The caller passes the tx; the relay ships it onward.
func Record(ctx context.Context, tx DBTX, e Event) error {
	e.SchemaVersion = "1.0"
	e.EventID = ulid.Make().String()
	e.Time = time.Now().UTC()
	if e.Outcome == "" {
		// A programming error: refuse to write a half-record.
		return ErrMissingOutcome
	}
	payload, err := json.Marshal(e)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO audit_outbox (event_id, occurred_at, actor_id, action,
		    resource_type, resource_id, outcome, tenant_id, request_id,
		    trace_id, payload, shipped)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)`,
		e.EventID, e.Time, e.Actor.ID, e.Action,
		e.Resource.Type, e.Resource.ID, e.Outcome, e.Resource.TenantID,
		e.Correlation.RequestID, e.Correlation.TraceID, payload)
	return err
}
```

Call site — audit and business change commit together:

```go
func (s *Service) DeleteCustomer(ctx context.Context, id string) error {
	actor := actorFromCtx(ctx)
	return s.db.InTx(ctx, func(tx audit.DBTX) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM customers WHERE id=$1`, id); err != nil {
			// Even the failure is audited (in its own tx or after) — see Edge Cases.
			return err
		}
		return audit.Record(ctx, tx, audit.Event{
			Action:   audit.ActionCustomerDelete,
			Category: "data_change",
			Outcome:  "success",
			Actor:    actor,
			Resource: audit.Resource{Type: "customer", ID: id, TenantID: tenantFromCtx(ctx)},
			Source:   sourceFromCtx(ctx),
			Correlation: audit.Correlation{
				RequestID: requestIDFromCtx(ctx),
				TraceID:   traceIDFromCtx(ctx),
			},
		})
	})
}
```

### Python — redaction and capturing the access, not the content

```python
import hmac, hashlib, json, logging
from datetime import datetime, timezone

audit_log = logging.getLogger("audit")
audit_log.propagate = False

_HMAC_KEY = b"...load from secrets manager, never hard-code..."

def _correlatable(value: str) -> str:
    """Reversible? No. Correlatable? Yes. Keeps the secret out of the log."""
    return hmac.new(_HMAC_KEY, value.encode(), hashlib.sha256).hexdigest()[:32]

def record_phi_access(actor: dict, patient_id: str, fields_viewed: list[str],
                      correlation: dict, ssn: str | None = None) -> None:
    event = {
        "schema_version": "1.0",
        "event": {
            "action": "patient.record_read",
            "category": "data_access",
            "outcome": "success",
            "time": datetime.now(timezone.utc).isoformat(),
        },
        "actor": actor,
        # We record THAT the record was accessed and WHICH fields —
        # never the field VALUES (that would copy PHI into the audit log).
        "resource": {"type": "patient", "id": patient_id, "fields": fields_viewed},
        "correlation": correlation,
        # SSN is needed for cross-account correlation but must not be stored raw.
        "metadata": {"ssn_token": _correlatable(ssn) if ssn else None},
    }
    audit_log.info(json.dumps(event, separators=(",", ":")))
```

### Java — adopting ECS field names with a small builder

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Emits ECS-shaped audit events so they map cleanly into Elastic/SIEM. */
public final class EcsAudit {
    private static final Logger AUDIT = LoggerFactory.getLogger("audit");
    private static final ObjectMapper M = new ObjectMapper();

    public static void record(String action, String outcome, String category,
                              Actor actor, String resType, String resId,
                              String tenantId, Correlation c, Map<String, Object> meta) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("@timestamp", Instant.now().toString());
        e.put("event", Map.of(
            "action", action, "outcome", outcome, "category", category,
            "kind", "event"));
        e.put("user", Map.of("id", actor.id(), "name", actor.name()));
        if (actor.onBehalfOf() != null) {
            // ECS: the delegated/effective principal goes under related.user etc.
            e.put("related", Map.of("user",
                java.util.List.of(actor.name(), actor.onBehalfOf().name())));
        }
        e.put("audit_resource", Map.of("type", resType, "id", resId, "tenant", tenantId));
        e.put("source", Map.of("ip", c.sourceIp()));
        e.put("trace", Map.of("id", c.traceId()));
        e.put("http", Map.of("request", Map.of("id", c.requestId())));
        if (meta != null && !meta.isEmpty()) e.put("labels", meta);
        try {
            AUDIT.info(M.writeValueAsString(e));
        } catch (Exception ex) {
            // NEVER swallow silently — a failed audit write is itself an event.
            LoggerFactory.getLogger("audit_failure").error("audit serialization failed", ex);
        }
    }
}
```

### Node.js — fan-out to two sinks (DB + SIEM) with correlation

```js
const pino = require("pino");

// SIEM-bound transport (e.g. shipped to Splunk/ELK by a collector tailing this file).
const siemAudit = pino(
  { base: null, timestamp: pino.stdTimeFunctions.isoTime },
  pino.destination({ dest: "/var/log/app/audit.ndjson", sync: false })
);

async function recordAudit(db, e) {
  if (!e.outcome) throw new Error("audit event missing outcome");
  const event = {
    schema_version: "1.0",
    event_id: crypto.randomUUID(),
    ...e,
    time: new Date().toISOString(),
  };

  // Sink 1: durable, queryable, append-only table (same tx as the change ideally).
  await db.query(
    `INSERT INTO audit_events (event_id, occurred_at, actor_id, action,
       resource_type, resource_id, outcome, request_id, trace_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [event.event_id, event.time, event.actor.id, event.action,
     event.resource.type, event.resource.id, event.outcome,
     event.correlation.request_id, event.correlation.trace_id, event]
  );

  // Sink 2: SIEM stream for real-time alerting on patterns.
  siemAudit.info(event);
}
```

---

## Pros & Cons

| Decision | Option | Pros | Cons |
|----------|--------|------|------|
| **Schema** | Adopt ECS/OCSF names | Tooling, SIEM mapping, shared vocabulary | Slightly more verbose; learning curve |
| | Roll your own | Fits your domain exactly | No tooling; you reinvent field names; migration pain later |
| **Sink** | Append-only DB table | Queryable, transactional, familiar | Couples to business DB if same instance |
| | Object storage stream | Cheap, scalable, WORM-ready | Querying needs an index/catalog layer |
| | SIEM pipeline | Search + alerting built in | Risk of sampling; cost at volume |
| **Tx coupling** | Same transaction | No un-audited changes | Couples sink; adds tx latency |
| | After the fact | Decoupled, flexible | Crash window = un-audited change |
| | Outbox | Transactional + decoupled | More moving parts; needs a relay |
| **PII** | Store actor identity | Required for attribution | The audit log becomes sensitive data |
| | Hash/tokenize secrets | Correlate without storing secrets | Key management; not reversible |

---

## Use Cases

- **"Who exported customer data last week, and how many rows?"** — `WHERE action='customer.export'` with `metadata.row_count`. Needs a stable action name and a queryable store.
- **"Reconstruct everything request `req_7af3` did."** — join audit → logs → trace by `request_id`/`trace_id`. Needs correlation.
- **"Did support agent X impersonate any customers this month?"** — `WHERE actor.id='X' AND actor.on_behalf_of IS NOT NULL`. Needs delegation captured.
- **"Prove no audit record was modified since it was written."** — append-only store; integrity proof is senior-level.
- **"Migrate audit data to a new SIEM without losing field meaning."** — trivial if you used ECS names; a project if you rolled your own.
- **"Erase a user under GDPR while keeping the audit trail."** — pseudonymized subject token in the audit log; erase the mapping, not the record.

---

## Coding Patterns

### Pattern: a single `Record` chokepoint that *forces* completeness

Make it impossible to emit an incomplete event. Require `outcome` and the five W's at the type level; reject anything missing.

```go
func Record(ctx context.Context, e Event) error {
	if e.Actor.ID == "" || e.Action == "" || e.Resource.ID == "" || e.Outcome == "" {
		return fmt.Errorf("incomplete audit event: %+v", e) // fail loud in CI
	}
	// ... write ...
}
```

### Pattern: capture-the-actor middleware

Establish the actor (including delegation) once, at the authenticated edge, into the context.

```python
@app.middleware("http")
async def attach_actor(request, call_next):
    request.state.actor = build_actor(request)  # reads session, OBO token, API key
    return await call_next(request)
```

### Pattern: the outbox relay

A small, idempotent worker that ships outbox rows to the audit sink and marks them shipped, deduping on `event_id` downstream.

```text
loop:
  rows = SELECT * FROM audit_outbox WHERE shipped=false ORDER BY occurred_at LIMIT 500
  for row in rows: sink.write(row.payload)   # idempotent on event_id
  UPDATE audit_outbox SET shipped=true WHERE event_id IN (...)
```

### Pattern: redact-at-construction

Run sensitive fields through a redactor *as you build the event*, so a raw secret can never reach the sink even by accident.

```js
const event = { ...base, metadata: redact(rawMetadata) }; // redact() strips/tokenizes
```

---

## Clean Code

- One controlled vocabulary of action names (an enum/constants file), reviewed like an API.
- `schema_version` on every event from day one.
- A single `Record(...)` chokepoint; no ad-hoc audit writes scattered around.
- Capture the actor once, at the edge; never reconstruct it deep in the stack.
- Redaction happens *as the event is built*, not as an afterthought before the sink.
- The audit table grants `INSERT` only to the app role — immutability enforced by the DB.
- Correlation IDs (`request_id`, `trace_id`) on every event, no exceptions.
- Never `try/except: pass` around an audit write. A failed write is alerted, never silent.

---

## Best Practices

1. **Adopt a standard schema's field names** (ECS/OCSF) even if you keep your own internal model. Cheap now, saves a migration later.
2. **Version the schema** and never silently rename a field.
3. **Enforce append-only in the store**, not just in convention — revoke UPDATE/DELETE.
4. **Use the outbox pattern** when you need both transactional capture and a decoupled sink.
5. **Stamp correlation IDs** on every event; this is what makes investigation a query instead of a search.
6. **Capture both identities under delegation** — authenticated actor *and* on-behalf-of.
7. **Capture the access, not the content**; tokenize/hash secrets you need for correlation.
8. **Make incomplete events impossible** — a chokepoint that rejects a missing `outcome` or actor.
9. **Index for the rare-but-critical read** (by actor, by resource, by action, all with time).
10. **Treat a failed audit write as an event** — alert, don't swallow.

---

## Edge Cases & Pitfalls

- **The action committed but the audit write failed.** This is the gap audit exists to close. Use the outbox (same-tx capture) or, at minimum, alert loudly and reconcile. Never let it pass silently.
- **Auditing failures and denials inside the same transaction that rolled back.** A `denied`/`failure` event must *not* be inside the transaction that gets rolled back — it would vanish. Audit denials/failures *outside* the failed business tx.
- **Schema drift via "just add a field."** Adding optional fields is safe; renaming, retyping, or removing fields breaks old queries. Bump `schema_version` and keep readers tolerant.
- **High-cardinality metadata.** Dumping the full request body or huge maps into `metadata` blows up storage and may smuggle in PII. Keep metadata small and curated.
- **Bulk operations.** 10,000-row delete: one event with `row_count` is usually fine, but some regimes (HIPAA per-record access) require *per-record* auditability. Know your requirement before choosing.
- **Clock skew across services.** Audit events from different hosts can arrive out of order. Use UTC + NTP, and remember the event time is the *server's* recording time. True ordering is a senior/professional topic (hash chains, sequence numbers).
- **Multi-tenant leakage.** Forgetting `tenant_id` means tenant A's auditor could query tenant B's events. Tenant scoping is both a query filter and an access-control boundary.
- **The relay double-ships.** Outbox delivery is at-least-once; downstream must dedupe on `event_id`, or you'll over-count.

---

## Common Mistakes

1. **Inventing a bespoke schema** when ECS/OCSF would have given you tooling and a migration-free future.
2. **Renaming an action** (`export_customer` → `customer.export`) without realizing every historical query now misses half the data.
3. **No correlation IDs**, turning every investigation into timestamp-grepping across services.
4. **Storing the secret to "be thorough"** — full SSN, full PAN, request body — making the audit log a breach magnet.
5. **Auditing only the authenticated actor** under impersonation, hiding *whose* data was touched (or *who* really acted).
6. **Auditing after the action with no outbox**, leaving a crash window of un-audited changes.
7. **A mutable store** — a file any process can overwrite, or a table with UPDATE/DELETE granted to the app.
8. **Dropping audit events under load** because they went through the same sampled pipeline as app logs.
9. **Swallowing audit-write failures** with a bare `catch`/`except`.
10. **No tenant scoping**, leaking one tenant's audit trail into another's queries.

---

## Tricky Points

- **"Append-only" has two meanings.** Access-control append-only (revoke UPDATE/DELETE) is what you do at middle level. Cryptographic tamper-*evidence* (you can detect deletion even by a DBA) is senior level. Don't confuse "the app can't modify it" with "no one can modify it undetectably."
- **The outbox is in your business DB, but the audit *store* may not be.** The outbox is a staging table for transactional capture; the durable audit store can be elsewhere. They're different things.
- **Hashing for correlation needs a stable, secret key.** If the key rotates, the same SSN produces different tokens before/after rotation and correlation breaks across the boundary. Plan key lifecycle.
- **ECS and OCSF disagree on field names.** You can't be both natively. Pick the one your downstream tooling speaks; map to the other if needed.
- **A `denied` event has no successful business transaction to attach to.** It must be written on its own — there's nothing to commit it alongside.
- **Correlation IDs can themselves be sensitive** if they encode user info. Use opaque IDs.
- **Same-transaction auditing fails when the action isn't a DB write** (e.g. a file export, an external API call). The outbox handles the DB-side record; the external side needs after-the-fact auditing with reconciliation.

---

## Test Yourself

1. Take your junior-level audit event and add: `schema_version`, a unique `event_id`, `event.category`, `tenant_id`, and `correlation.{request_id, trace_id}`. Justify each addition.
2. Map your event's fields to ECS names. Which of your fields had no clean ECS equivalent, and what does that tell you?
3. Implement append-only enforcement on a table: revoke UPDATE/DELETE, then try to UPDATE a row as the app role and confirm it's rejected.
4. Implement the outbox pattern for one action. Kill the process between the business commit and the relay; confirm the event still ships on restart.
5. Write the audit event for an admin impersonating a customer. Confirm both identities are present and queryable.
6. Take a sensitive field (SSN/card). Store a correlation token instead of the raw value. Show that two accesses of the same value correlate without the value ever being stored.
7. Investigate: given one audit event, use its `request_id` to pull the matching app logs and trace. If you can't, your correlation is incomplete.
8. Find a place in some codebase where an action could commit but the audit write could fail. Propose the fix (outbox or alert+reconcile).

---

## Tricky Questions

**Q1: Should the audit write be in the same transaction as the business change?**

It's a trade-off. Same-transaction guarantees no un-audited changes but couples your audit store to the business DB and adds latency. After-the-fact decouples but leaves a crash window. The mature answer is usually the **outbox pattern**: write the event to an outbox table in the same transaction (transactional capture), then a relay ships it to the real sink (decoupled). You get atomic capture and a flexible sink.

**Q2: HIPAA requires logging PHI access, but I'm told never to log PII. Contradiction?**

No — you log *that* the access happened and *which* record (the actor and `resource.id`), not the PHI *content*. You record "alice viewed patient 4471's record at 14:02," not the contents of the record. The PHI stays in the database; the audit log records the *event* of access. That satisfies HIPAA's access-logging requirement without copying PHI into a long-retention store.

**Q3: GDPR says I must erase a user's data on request, but audit logs must be immutable. How?**

Store a *pseudonymized* subject reference in the audit log — a token, not the raw identity — and keep the token→identity mapping in a separate, erasable store. On an erasure request, delete the mapping. The audit records stay immutable (you can still prove "subject token X did Y"), but the link back to the real person is severed. The audit trail's integrity and the right to erasure both survive. (More in [`senior.md`](senior.md).)

**Q4: My action isn't a database write — it's an external API call. How do I get transactional auditing?**

You can't get true DB-transaction atomicity around a non-DB action. Record the *intent* in an outbox before the call and the *outcome* after, then reconcile: if the outcome record never arrives, the relay/reconciler flags the dangling intent for investigation. This is the same at-least-once + dedupe machinery, applied to a non-transactional action.

**Q5: Why not just use my SIEM (Splunk/ELK) as the only audit store?**

A SIEM is excellent for *search and alerting* but is often configured with sampling, index lifecycle (data ages out), and a pipeline that can drop under load — all anathema to audit completeness and retention. Use the SIEM as a *fan-out sink* for alerting, backed by a durable, append-only store of record that is never sampled. Two sinks, different jobs.

**Q6: How do I keep action names from drifting into chaos over three years?**

Make the set of valid actions a controlled vocabulary — an enum/constants file that is the single source of truth, reviewed in code review like an API change. Reject free-text actions at the `Record` chokepoint. The drift you're preventing (`export_customer` vs `customer.export` vs `customer.exported`) silently breaks queries; a controlled vocabulary makes it a compile error.

**Q7: Is it OK to store the old and new values of a changed field in the audit event?**

For non-sensitive fields, yes — "changed `plan` from `free` to `pro`" is exactly what you want. For sensitive fields, no — store *that* the field changed, not the before/after values (you'd be copying secrets/PII into the audit log). The discipline is per-field: capture diffs for the boring fields, capture only "changed" for the sensitive ones.

---

## Cheat Sheet

```text
┌──────────────────────────── AUDIT LOGGING — MIDDLE CHEAT SHEET ─────────────────────────────┐
│                                                                                             │
│  SCHEMA (stable for YEARS)                                                                  │
│    schema_version   event_id(ULID)   event.{action,category,outcome,time}                   │
│    actor.{type,id,name,session_id,on_behalf_of}   resource.{type,id,tenant_id}              │
│    source.{ip,user_agent,service}   correlation.{request_id,trace_id}   metadata{...}       │
│    → action names = a CONTROLLED VOCABULARY (enum), reviewed like an API                    │
│                                                                                             │
│  ADOPT A STANDARD'S FIELD NAMES                                                             │
│    ECS (Elastic)  ·  OCSF (security classes)  ·  CloudEvents (envelope)  ·  CEF/LEEF (legacy)│
│    CloudTrail/GCP audit = INFRA actions, NOT your app's business actions                    │
│                                                                                             │
│  CAPTURE vs REDACT                                                                          │
│    capture: actor identity, action, resource id, outcome, source, correlation               │
│    redact:  card→last4+token   ssn→HMAC token   record→id-only (not content)                │
│    NEVER:   passwords, full PAN/CVV, secrets, full bodies, raw PHI                           │
│                                                                                             │
│  STORE = APPEND-ONLY (enforced, not hoped)                                                  │
│    REVOKE UPDATE, DELETE ... ; GRANT INSERT, SELECT ...                                      │
│    index by (actor,time) (resource,time) (action,time)                                      │
│                                                                                             │
│  TX COUPLING                                                                                │
│    same-tx    → no un-audited change, but couples sink                                       │
│    after      → decoupled, but crash window                                                 │
│    OUTBOX     → both: insert event in same tx, relay ships it (dedupe on event_id)           │
│                                                                                             │
│  DELEGATION → record BOTH identities                                                        │
│    admin impersonates user → actor=admin, on_behalf_of=user                                  │
│    cron/job → actor.type=service, id=<job name>   (never blank)                             │
│                                                                                             │
│  RED FLAGS                                                                                   │
│    renamed action   no correlation id   secret in event   mutable store                     │
│    audit dropped under load   swallowed write failure   missing tenant_id                   │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The **schema is the product**: version it, type it, and use a **controlled vocabulary** of action names so queries keep working across years of data.
- **Adopt a standard's field names** (ECS, OCSF, CloudEvents) rather than inventing your own — it buys tooling and a migration-free future. Remember cloud audit logs (CloudTrail/GCP) cover *infra*, not your app's business actions.
- **Capture identity, redact secrets.** Record the actor and the resource id; tokenize/hash secrets you need for correlation; record *that* a sensitive record was accessed, never its contents.
- **Append-only is enforced**, not hoped — revoke UPDATE/DELETE on the store. (Cryptographic tamper-evidence is the senior tier.)
- The **transaction-coupling** decision is real: same-tx (no gaps, coupled), after-the-fact (decoupled, crash window), or the **outbox** (both — transactional capture plus a decoupled sink).
- **Correlation IDs** (`request_id`, `trace_id`) turn investigation from a timestamp search into a one-line join across audit, logs, and traces.
- **Attribution through delegation** means recording *both* the authenticated actor and the on-behalf-of principal — never collapse impersonation to one identity.
- A **failed audit write is itself an event** — alert and reconcile; never swallow it silently.
- This is the level where audit logs quietly rot — schema drift, no correlation, PII leakage, dropped-under-load — so name and guard each failure mode deliberately.

---

## What You Can Build

- An **`audit` library** with a stable, versioned schema, a controlled-vocabulary action enum, ECS-aligned field names, a single `Record` chokepoint that rejects incomplete events, and pluggable sinks.
- An **outbox + relay**: an `audit_outbox` table written in-transaction with business changes, and an idempotent relay that ships to a durable sink and dedupes on `event_id`. Test it by crashing between commit and ship.
- A **redaction layer**: a function that, given a raw event, tokenizes/strips known-sensitive fields, with tests proving no raw secret can reach the sink.
- A **correlation drill**: a small service that emits an audit event, app logs, and a trace for one request, then a script that, given the audit event, pulls the matching logs and trace by shared ID.
- An **append-only enforcement test**: a CI check that attempts UPDATE/DELETE on the audit table as the app role and asserts it fails.
- A **delegation recorder**: support tooling that impersonates a user and produces an audit event with both identities, plus a query that finds all impersonations by an admin.

---

## Further Reading

- **Schemas**
  - *Elastic Common Schema (ECS)* field reference — <https://www.elastic.co/guide/en/ecs/current/index.html>
  - *OCSF schema browser* — <https://schema.ocsf.io/> (see the Authentication, Account Change, API Activity classes)
  - *CloudEvents spec* — <https://cloudevents.io/>
- **Patterns**
  - *The Outbox Pattern* (transactional messaging) — Chris Richardson, microservices.io — <https://microservices.io/patterns/data/transactional-outbox.html>
  - *NIST SP 800-92* — log management, including what audit records must contain.
  - *OWASP Logging Cheat Sheet* — capture/redact guidance.
- **Regimes (skim, don't memorize)**
  - *PCI DSS Requirement 10* — the most concrete audit-content requirements.
  - *HIPAA Security Rule §164.312(b)* — audit controls for PHI access.

---

## Related Topics

- **Previous level:** [junior.md](junior.md) — the five W's and the separate-sink rule.
- **Next level up:** [senior.md](senior.md) — tamper-evidence (hash chains, signing, WORM), retention & legal hold, the threat model, performance at volume.
- **Professional level:** [professional.md](professional.md) — pipeline at scale, cryptographic integrity, forensic admissibility, multi-tenant, exactly-once.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Logging — Middle](../logging/middle.md) — structured logs, correlation IDs, log levels. Audit reuses the correlation machinery; the disciplines differ.
- [Tracing](../tracing/) — where `trace_id` comes from and how it propagates.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — and why audit events are explicitly *exempt* from sampling.

**Cross-roadmap links:**

- The `database-migration-patterns` skill — evolving the audit schema without breaking old readers.
- The `secrets-management` and `encryption-basics` skill areas — what must never enter an audit event, and how to tokenize what you keep.
- The `auth-token-security` / `api-authentication` skill areas — where the actor identity (including OBO) originates.

---

## Diagrams & Visual Aids

### The Outbox Pattern

```text
   ┌─────────────────── one DB transaction ───────────────────┐
   │  DELETE FROM customers WHERE id=4471                      │
   │  INSERT INTO audit_outbox (...payload..., shipped=false)  │
   └───────────────────────────┬───────────────────────────────┘
                               │ COMMIT (both or neither)
                               ▼
                     ┌──────────────────┐
                     │   audit_outbox   │  shipped=false rows
                     └────────┬─────────┘
                              │  relay (at-least-once)
                              ▼
                   ┌─────────────────────┐
                   │  durable audit sink │  (dedupe on event_id)
                   │  append-only / SIEM │
                   └─────────────────────┘
```

### Capture vs Redact

```text
   RAW ACTION CONTEXT                AUDIT EVENT (what's stored)
   ┌──────────────────┐             ┌──────────────────────────┐
   │ actor: alice     │ ─ keep ───► │ actor.id, actor.name     │
   │ action: export   │ ─ keep ───► │ event.action             │
   │ resource: cust   │ ─ keep ───► │ resource.{type,id}       │
   │ ssn: 123-45-6789 │ ─ token ──► │ metadata.ssn_token=HMAC  │
   │ card: 4111...1111│ ─ mask ───► │ card.last4 = "1111"      │
   │ password: ●●●●●● │ ─ DROP ───► │ (nothing)                │
   │ record body...   │ ─ DROP ───► │ resource.id only         │
   └──────────────────┘             └──────────────────────────┘
            "Enough to investigate; nothing that's a breach if it leaks."
```

### Correlation: One Join Key, Three Signals

```text
   AUDIT EVENT            APP LOGS              DISTRIBUTED TRACE
   action=customer.export request_id=req_7af3  trace_id=4bf9...
   request_id=req_7af3    "querying db..."     ├─ span: handler
   trace_id=4bf9...       "10421 rows"         ├─ span: db.query
        │                     │                └─ span: s3.upload
        └─────────────────────┴────────────────────────┘
              investigator joins on request_id / trace_id
```

---

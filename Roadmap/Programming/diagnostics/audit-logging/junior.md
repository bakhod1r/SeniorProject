# Audit Logging — Junior Level

> **Topic:** [Audit Logging Roadmap](README.md)
> **Focus:** What an audit log *is*, and why it is not the same thing as your application log. The five questions every audit event must answer — *who, what, which, when, outcome*. Writing your first audit event to a separate sink. The first-principles reasons audit logging exists at all.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Anatomy of an Audit Event](#the-anatomy-of-an-audit-event)
8. [Audit Log vs Application Log](#audit-log-vs-application-log)
9. [Code Examples](#code-examples)
10. [What to Audit on Day One](#what-to-audit-on-day-one)
11. [Pros & Cons of Approaches](#pros--cons-of-approaches)
12. [Use Cases](#use-cases)
13. [Coding Patterns](#coding-patterns)
14. [Clean Code](#clean-code)
15. [Best Practices](#best-practices)
16. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
17. [Common Mistakes](#common-mistakes)
18. [Tricky Points](#tricky-points)
19. [Test Yourself](#test-yourself)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Summary](#summary)
23. [What You Can Build](#what-you-can-build)
24. [Further Reading](#further-reading)
25. [Related Topics](#related-topics)
26. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is an audit log, really?** and **Why can't I just use my normal logger for it?**

An **application log** answers the question *"what is the system doing?"* — it exists so an engineer can understand and fix the program. An **audit log** answers a different and stricter question: *"who did what, to which resource, when, and how do I prove it later?"* It exists so a human — a security analyst, a compliance auditor, a court — can reconstruct the history of *deliberate actions* taken against the system, often months or years after the fact, and trust that the record was not altered.

That difference sounds small. It changes everything about how you write the record. An app log line can be dropped under load, sampled away, mangled by a half-finished refactor, or kept for three days and deleted. None of that is acceptable for an audit log. When a regulator asks *"show me every time someone accessed patient #4471's record in the last six years,"* "we sampled that log stream to save money" is not an answer you can give.

This page is your first map. We will define what an audit event is made of (the five W's: **who, what, which, when, outcome**), draw the bright line between audit logs and debug logs, write a first audit event to its own separate sink in Go, Java, Python, and Node, and cover the small set of things you should *always* audit even in a tiny app: logins, permission grants, and changes to data that matters.

> 🎓 **Why this matters for a junior:** Audit logging looks like "just more logging," so juniors reach for `logger.info("user logged in")` and move on. That single instinct — putting an audit record into the application log stream — is the root of most audit-logging incidents in the industry. It loses the record under load, mixes it with debug noise, and makes it impossible to prove integrity. Learning the distinction *now* is far cheaper than discovering it during a failed SOC 2 audit later.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small program in at least one language (Go, Python, Java, JavaScript).
- **Required:** What a function, a request handler, and a database write are.
- **Required:** Basic familiarity with logging. If `logger.info(...)` is new to you, read [`../logging/junior.md`](../logging/junior.md) first.
- **Helpful:** What *authentication* (proving who you are) and *authorization* (deciding what you're allowed to do) mean. The audit log records both. See the [`api-authentication`](../../code-craft/) skill area.
- **Helpful:** The concept of *structured logging* — emitting key/value fields instead of a freeform sentence. Audit events are almost always structured.
- **Helpful:** Awareness that some industries have rules (HIPAA for health data, PCI DSS for card data, GDPR for EU personal data). You don't need to know them in detail yet — just that they *require* audit trails.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Audit log / audit trail** | A chronological, tamper-resistant record of security-relevant actions: who did what, to what, when, and with what result. |
| **Audit event** | A single entry in the audit log. One deliberate action = one event. |
| **Actor** | *Who* performed the action — a user, a service account, an API key, an admin. The "who" of the five W's. |
| **Action** | *What* was done — `login`, `delete`, `grant_role`, `export_data`. A verb. |
| **Resource / object / target** | *Which* thing the action touched — user #4471, invoice #88, the `prod` database. |
| **Outcome** | Whether the action *succeeded* or *failed* (and sometimes *why* it failed). A denied access attempt is as important to record as a successful one. |
| **Operational log / app log / debug log** | The normal logging engineers use to understand and fix the system. *Different consumer, different rules.* |
| **Sink / appender / transport** | Where log records are written — a file, stdout, a database, a remote service. Audit logs use a *separate* sink. |
| **Non-repudiation** | The property that an actor cannot later credibly deny having taken an action, because the record proves it. |
| **Tamper-evidence** | The property that *if* a record is altered or deleted, that alteration is detectable. (Senior topic — named here for vocabulary.) |
| **Append-only** | A store you can add to but not modify or delete from. The natural shape of an audit log. |
| **Retention** | How long records are kept. Audit logs are kept for months to years; regulations often dictate the minimum. |
| **PII** | Personally Identifiable Information — names, emails, IDs. Audit logs often *must* contain the actor's identity (PII) by design, which is the opposite of app-log advice. |
| **Correlation ID / request ID** | An ID threaded through a request so the audit event can be tied back to the operational logs and traces for the same action. |
| **Structured event** | A record made of typed key/value fields (JSON, usually), not a sentence. Required for querying audit logs later. |

---

## Core Concepts

### 1. An Audit Log Is a Record of *Deliberate Actions*, Not of *Code Execution*

Your app log records what the *code* did: "entering `processOrder`", "cache miss", "retrying connection". Your audit log records what a *person or principal deliberately caused*: "alice@corp deleted customer 4471". The unit of an app log is a line of execution. The unit of an audit log is an **intentional act by an identified actor**. If no human or principal *decided* to do the thing, it is probably not an audit event — it's an app log.

### 2. The Five W's Are Non-Negotiable

Every audit event must answer five questions. If any one is missing, the event is much less useful — sometimes useless:

| W | Field | Example |
|---|-------|---------|
| **Who** | actor | `user:alice@corp.com` |
| **What** | action | `delete` |
| **Which** | resource | `customer:4471` |
| **When** | timestamp | `2026-06-11T14:02:09.471Z` (UTC) |
| **Outcome** | result | `success` / `denied` |

A sixth — **where/from** (source IP, device, session) — and a seventh — **why** (a reason, a ticket number) — are strongly recommended. But the five above are the floor.

### 3. Audit Logs Go to a *Separate* Place

This is the single most important practical rule at the junior level. An audit event does **not** go into the same stream as `logger.debug("...")`. It goes to a *separate logger writing to a separate sink* — a different file, a different table, a different stream. Why?

- App logs get **sampled and dropped** under load. Audit logs must not.
- App logs get **deleted in days**. Audit logs are kept for years.
- App logs are **readable by every engineer**. Audit logs often need restricted access.
- App logs are full of **noise**; you cannot find the one "who deleted this?" line among a million debug lines.

Mixing them is the original sin of audit logging. Keep them apart from line one.

### 4. Completeness Beats Verbosity

For an app log, you trade completeness for signal — you drop noise on purpose. For an audit log, the *point* is completeness: every login, every permission change, every sensitive access, recorded. You would rather have a boring, complete audit log than an interesting, sampled one. **If a security-relevant action can happen, it must be audited every single time.**

### 5. The Actor Must Be the *Real* Actor

"System did X" is a useless audit event. *Which user, through which session, triggered the system to do X?* If an admin acts on behalf of a customer (impersonation, support tooling), the audit event must capture *both*: the admin (who really did it) and the customer (on whose behalf). Attribution is the heart of the audit log; getting the actor wrong defeats the entire exercise.

### 6. Audit Events Are Written *After* the Action's Outcome Is Known

You cannot record the outcome before you have it. The audit write generally happens at the end of the operation, once you know whether it succeeded or was denied. A denied attempt (`alice tried to delete customer 4471 — DENIED`) is often *more* valuable than a success, because it can be the first sign of an attack or a misconfigured permission.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **App log vs audit log** | A chef's running commentary ("stirring the sauce") vs the restaurant's official receipt book (who ordered what, when, how much they paid). |
| **Audit event** | A line in a hospital chart: *Dr. Lee administered 5mg of X to patient 4471 at 14:02; patient stable.* Who, what, which, when, outcome. |
| **Actor attribution** | A visitor logbook at a secure building — you sign in with *your name*, not "a person entered". |
| **Outcome = denied** | A door badge reader logging *"badge 8821 denied at door 3, 02:14"* — the failed swipe is the security event. |
| **Append-only** | A bank ledger written in ink. You don't erase a mistake; you write a *correcting entry*. The original stays. |
| **Separate sink** | A casino keeps its surveillance tapes in a locked room, not on the dealer's desk next to the napkins. |
| **Non-repudiation** | A signed delivery receipt — the recipient cannot later claim the package never arrived. |
| **Retention** | Tax records you must keep for seven years even though you'll probably never look at them. |
| **Correlation ID** | A case number written on every document that belongs to the same investigation. |

---

## Mental Models

### 1. The Audit Log Is Evidence, the App Log Is a Diary

A diary is for *you* — informal, helpful, disposable. Evidence is for *someone else, later* — formal, complete, and it must survive challenge. When you write an audit event, imagine a stranger reading it in two years to answer "did this person do this thing?" Write so that stranger gets a clean, unambiguous yes or no.

### 2. One Deliberate Act → One Event

When you're unsure whether something deserves an audit event, ask: *"Did an identified principal deliberately cause a security- or business-significant change?"* Login: yes. Granting an admin role: yes. Exporting 10,000 customer records: absolutely yes. Reading the homepage: no. A retry of an internal HTTP call: no. The act, not the code path, is the unit.

### 3. The "Stranger in Two Years" Test

Read your audit event back as if you have no other context. Can you tell *who* did *what* to *which* thing, *when*, and whether it *worked*? If the event says `info: deleted` you fail the test. If it says `actor=alice@corp action=delete resource=customer:4471 outcome=success at=2026-06-11T14:02:09Z` you pass. Self-contained beats clever.

### 4. Audit First, Optimize Never (at This Level)

At junior level, do not worry about performance, hash chains, or WORM storage. Worry about *capturing the right events, completely, in a separate place, with the five W's*. The advanced machinery (covered in `senior.md` and `professional.md`) is worthless if the events themselves are missing or wrong. Get the data right first.

---

## The Anatomy of an Audit Event

A minimal but correct audit event, as JSON:

```json
{
  "timestamp": "2026-06-11T14:02:09.471Z",
  "actor": { "type": "user", "id": "alice@corp.com", "session_id": "sess_9f3a" },
  "action": "customer.delete",
  "resource": { "type": "customer", "id": "4471" },
  "outcome": "success",
  "source_ip": "203.0.113.42",
  "request_id": "req_7af3c1",
  "metadata": { "reason": "GDPR erasure request TICKET-882" }
}
```

Walk through each field:

| Field | Why it's here |
|-------|---------------|
| `timestamp` | **When.** Always UTC, always with millisecond precision and a `Z`. Local time and ambiguous formats ruin forensic ordering. |
| `actor` | **Who.** A *type* (user/service/apikey) plus a stable *id*. The session ties it to a specific login. |
| `action` | **What.** A stable, machine-readable verb — `customer.delete`, not "deleted a customer". You'll query on this. |
| `resource` | **Which.** Type + id of the thing acted upon. |
| `outcome` | **Result.** `success`, `failure`, or `denied`. Never omit this — a denied action is a security signal. |
| `source_ip` | **From where.** Helps spot "this admin acted from a country they've never logged in from." |
| `request_id` | **Correlation.** Links the audit event to the operational logs/traces for the same request. |
| `metadata` | **Why / context.** A reason, a ticket, the old and new value of a changed field. Keep it small and relevant. |

### The action naming convention

Pick a convention and hold it. The common one is `resource.verb` in lower snake/dot case:

```text
auth.login          auth.logout         auth.login_failed
user.create         user.delete         user.role_granted
customer.read       customer.export     customer.update
billing.refund      config.change       data.export
```

Stable names matter because in two years someone will run `WHERE action = 'customer.export'` across six years of data. If half your events say `exported_customer` and half say `customer.export`, that query silently misses records.

---

## Audit Log vs Application Log

This table is the heart of the junior level. Internalize it.

| Dimension | Application / Debug Log | Audit Log |
|---|---|---|
| **Question answered** | "What is the system doing?" | "Who did what, and can I prove it?" |
| **Primary consumer** | On-call engineers | Security, compliance, legal, auditors |
| **Unit** | A line of code execution | A deliberate act by an identified actor |
| **Sampling** | Fine — drop noise to save money | **Forbidden** — completeness is the point |
| **Retention** | Days to weeks | Months to **years** (often legally mandated) |
| **Tampering** | Tolerable in extreme cases | **Unacceptable** — must be tamper-evident |
| **PII** | Avoid logging it | Often *required* — the actor identity is the point |
| **Storage** | Cheap, hot, mutable | Separate, restricted, ideally append-only |
| **Format** | Structured-ish; freeform tolerated | Strictly structured, schema-stable |
| **Failure handling** | Drop the line, move on | Failing to write may need to *block* or alert |

> The clearest tell that someone has confused the two: a `logger.info("user alice deleted customer 4471")` sitting in the middle of the application log stream. It's not queryable, it's not retained long enough, it'll be sampled away under load, and there is no integrity guarantee. It *looks* like an audit log and is not one.

For the operational side of logging — levels, correlation IDs, sampling, libraries — see [`../logging/junior.md`](../logging/junior.md) and [`../logging/middle.md`](../logging/middle.md). This roadmap is deliberately the *other* discipline.

---

## Code Examples

The examples all do the same thing: emit a structured audit event to a **separate sink** from the application log. That separation is the lesson; everything else is detail.

### Go — `slog` with a dedicated audit logger

```go
package audit

import (
	"context"
	"log/slog"
	"os"
	"time"
)

// auditLogger writes ONLY audit events, to its own file — never mixed
// with the application log. In production this file is shipped to a
// restricted, append-only store (see senior.md).
var auditLogger *slog.Logger

func init() {
	f, err := os.OpenFile("/var/log/app/audit.log",
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		// If we cannot open the audit sink, that is a startup failure —
		// do not silently fall back to stdout. (See "Common Mistakes".)
		panic("cannot open audit log: " + err.Error())
	}
	auditLogger = slog.New(slog.NewJSONHandler(f, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
}

type Actor struct {
	Type      string // "user", "service", "apikey"
	ID        string
	SessionID string
}

// Record writes one audit event. Outcome is "success", "failure", or "denied".
func Record(ctx context.Context, a Actor, action, resType, resID, outcome string, meta map[string]any) {
	auditLogger.LogAttrs(ctx, slog.LevelInfo, "audit",
		slog.Time("timestamp", time.Now().UTC()),
		slog.Group("actor",
			slog.String("type", a.Type),
			slog.String("id", a.ID),
			slog.String("session_id", a.SessionID),
		),
		slog.String("action", action),
		slog.Group("resource",
			slog.String("type", resType),
			slog.String("id", resID),
		),
		slog.String("outcome", outcome),
		slog.String("request_id", requestIDFromCtx(ctx)),
		slog.Any("metadata", meta),
	)
}
```

Usage at the call site, *after* the outcome is known:

```go
func (h *Handler) DeleteCustomer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actor := actorFromCtx(r.Context())

	err := h.store.DeleteCustomer(r.Context(), id)
	outcome := "success"
	if err != nil {
		outcome = "failure"
	}
	// Audit happens regardless of success/failure.
	audit.Record(r.Context(), actor, "customer.delete", "customer", id, outcome,
		map[string]any{"reason": r.Header.Get("X-Reason")})

	if err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

### Python — `logging` with a separate handler

```python
import json
import logging
from datetime import datetime, timezone

# A dedicated logger. propagate=False stops audit events from also
# flowing into the root (application) logger.
audit_log = logging.getLogger("audit")
audit_log.propagate = False
audit_log.setLevel(logging.INFO)

_handler = logging.FileHandler("/var/log/app/audit.log")
_handler.setFormatter(logging.Formatter("%(message)s"))  # message is already JSON
audit_log.addHandler(_handler)


def record(actor: dict, action: str, resource: dict, outcome: str,
           request_id: str | None = None, metadata: dict | None = None) -> None:
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,                 # {"type": "user", "id": "alice@corp", "session_id": "..."}
        "action": action,               # "customer.delete"
        "resource": resource,           # {"type": "customer", "id": "4471"}
        "outcome": outcome,             # "success" | "failure" | "denied"
        "request_id": request_id,
        "metadata": metadata or {},
    }
    audit_log.info(json.dumps(event, separators=(",", ":")))
```

```python
@app.delete("/customers/{cust_id}")
def delete_customer(cust_id: str, request: Request):
    actor = actor_from_request(request)
    try:
        store.delete_customer(cust_id)
        outcome = "success"
    except Exception:
        outcome = "failure"
        raise
    finally:
        record(
            actor=actor,
            action="customer.delete",
            resource={"type": "customer", "id": cust_id},
            outcome=outcome,
            request_id=request.headers.get("X-Request-ID"),
            metadata={"reason": request.headers.get("X-Reason")},
        )
    return Response(status_code=204)
```

### Java — SLF4J with a dedicated audit logger and appender

A *named* logger routed to its own file via Logback configuration:

```xml
<!-- logback.xml -->
<configuration>
  <!-- The application log -->
  <appender name="APP" class="ch.qos.logback.core.ConsoleAppender">
    <encoder><pattern>%d %-5level %logger - %msg%n</pattern></encoder>
  </appender>

  <!-- A SEPARATE appender just for audit, writing JSON to its own file -->
  <appender name="AUDIT" class="ch.qos.logback.core.FileAppender">
    <file>/var/log/app/audit.log</file>
    <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
  </appender>

  <!-- Route the "audit" logger ONLY to the AUDIT appender, never to APP -->
  <logger name="audit" level="INFO" additivity="false">
    <appender-ref ref="AUDIT"/>
  </logger>

  <root level="INFO">
    <appender-ref ref="APP"/>
  </root>
</configuration>
```

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import net.logstash.logback.argument.StructuredArguments;
import java.time.Instant;
import java.util.Map;

public final class Audit {
    // The logger name "audit" matches the <logger name="audit"> above.
    private static final Logger AUDIT = LoggerFactory.getLogger("audit");

    public static void record(Actor actor, String action, String resType,
                              String resId, String outcome, Map<String, Object> meta) {
        AUDIT.info("audit",
            StructuredArguments.keyValue("timestamp", Instant.now().toString()),
            StructuredArguments.keyValue("actor", actor),
            StructuredArguments.keyValue("action", action),
            StructuredArguments.keyValue("resource",
                Map.of("type", resType, "id", resId)),
            StructuredArguments.keyValue("outcome", outcome),
            StructuredArguments.keyValue("metadata", meta));
    }
}
```

### Node.js — Pino with a separate transport

```js
const pino = require("pino");

// A dedicated audit logger writing to its own file destination.
// Do NOT reuse the application logger instance.
const auditLogger = pino(
  { base: null, timestamp: pino.stdTimeFunctions.isoTime },
  pino.destination({ dest: "/var/log/app/audit.log", sync: false })
);

function recordAudit({ actor, action, resource, outcome, requestId, metadata }) {
  auditLogger.info({
    event: "audit",
    actor,                 // { type, id, sessionId }
    action,                // "customer.delete"
    resource,              // { type, id }
    outcome,               // "success" | "failure" | "denied"
    requestId,
    metadata: metadata || {},
  });
}

// Express handler
app.delete("/customers/:id", async (req, res) => {
  const actor = actorFromReq(req);
  let outcome = "success";
  try {
    await store.deleteCustomer(req.params.id);
  } catch (err) {
    outcome = "failure";
    throw err;
  } finally {
    recordAudit({
      actor,
      action: "customer.delete",
      resource: { type: "customer", id: req.params.id },
      outcome,
      requestId: req.headers["x-request-id"],
      metadata: { reason: req.headers["x-reason"] },
    });
  }
  res.sendStatus(204);
});
```

Across all four: the audit logger is a *distinct object* pointed at a *distinct destination*, and the event carries the five W's. That is the whole junior-level lesson, expressed four ways.

---

## What to Audit on Day One

You do not need to audit everything. Start with the high-value, security-relevant events. A tiny app should audit at least:

| Category | Examples |
|---|---|
| **Authentication** | login success, login failure, logout, password change, MFA enrollment |
| **Authorization changes** | role granted/revoked, permission changed, account enabled/disabled |
| **Sensitive data access** | reading/exporting customer PII, downloading a report, viewing a medical record |
| **Sensitive data changes** | create/update/delete of records that matter (customers, money, config) |
| **Administrative actions** | impersonation, settings changes, key rotation, feature flags affecting security |
| **Data export** | any bulk export — the single most-audited action in breach investigations |

A useful filter: *"If this action showed up in a breach investigation or a compliance audit, would someone want a record of it?"* If yes, audit it.

What you usually do **not** audit (these are app-log territory): page views, health-check pings, internal retries, cache hits, every individual row of a normal read. Auditing those buries the signal and explodes your storage.

---

## Pros & Cons of Approaches

| Approach | Pros | Cons |
|---|---|---|
| **Audit into the app log** (the anti-pattern) | Zero extra setup | Sampled away under load; deleted in days; unqueryable; no integrity; mixes with noise. **Avoid.** |
| **Separate audit file/stream** (junior default) | Simple; clean separation; easy to ship to a restricted store | Still mutable on disk; integrity is up to the downstream store |
| **Audit to a dedicated DB table** | Queryable; transactional with the action; structured | Mutable unless you enforce append-only; needs care to not block the request |
| **Audit to a managed service** (CloudTrail, GCP Audit Logs) | Tamper-resistant, retained, queryable by default | Covers *infrastructure* actions, not your app's business actions; you still write your own for those |

At junior level, **separate file/stream** or a **dedicated table** is the right answer. The managed services are great but they audit *cloud API calls*, not "alice deleted customer 4471 in your app."

---

## Use Cases

| Situation | What the audit log gives you |
|---|---|
| A customer claims they never deleted their account. | A record: who deleted it, when, from where. Non-repudiation. |
| A regulator asks who accessed patient #4471. | A query: `action=record.read AND resource.id=4471`. Completeness. |
| Security suspects an account is compromised. | A trail of that actor's recent actions and source IPs. Forensics. |
| A bulk export of customer data happened. | Who triggered it, how many rows, when. The first thing checked in a breach. |
| An admin granted themselves elevated permissions. | The `role_granted` event with actor = themselves. The classic insider-threat signal. |

---

## Coding Patterns

### Pattern 1 — Audit at the Boundary, Once

Write the audit event at the *handler/service boundary* where the deliberate action enters, not scattered through ten helper functions. One action → one audit call, in one place.

```python
# Good: one audit call, at the boundary, after the outcome is known.
def handle_delete(req):
    outcome = do_delete(req)           # may raise/return failure
    record(actor=..., action="customer.delete", resource=..., outcome=outcome)
```

### Pattern 2 — Always in a `finally` / `defer`

You must record the event *whether or not the action succeeded*. Put the audit write where it runs on both paths.

```go
outcome := "success"
defer func() { audit.Record(ctx, actor, "customer.delete", "customer", id, outcome, nil) }()
if err := store.Delete(ctx, id); err != nil {
	outcome = "failure"
	return err
}
```

### Pattern 3 — A Tiny, Explicit Event Type

Don't pass loose strings everywhere. A small struct/dataclass with the five W's as named fields makes it impossible to forget one.

```python
@dataclass
class AuditEvent:
    actor: Actor
    action: str
    resource: Resource
    outcome: str             # forces you to set it
    metadata: dict = field(default_factory=dict)
```

### Pattern 4 — Capture the Actor at the Edge

The real actor lives in the request context (the authenticated session). Extract it once at the middleware layer and pass it down — never reconstruct "who is this" deep in the call stack where you might get it wrong.

---

## Clean Code

- **Never** write audit events with `logger.info(...)` on your application logger. Use a *named, separate* audit logger.
- Name actions as stable machine identifiers (`customer.delete`), not human sentences ("deleted a customer").
- Always include `outcome`. An audit event without an outcome is half a record.
- Timestamps are **UTC, ISO 8601, millisecond precision**. No local time, ever.
- Don't put secrets (passwords, tokens, full card numbers) in the audit event — record *that* a password changed, not the password. (More in `senior.md` on minimization.)
- One action, one event. Don't emit five events for one logical delete.
- Keep `metadata` small and relevant. The audit log is not a place to dump the whole request body.

---

## Best Practices

1. **Separate sink from line one.** A distinct logger to a distinct destination. This is the rule that prevents the most pain later.
2. **Capture all five W's, plus source and request ID.** Treat a missing W as a bug.
3. **Audit denials, not just successes.** A blocked action is a security signal.
4. **Write the event after the outcome is known**, on both the success and failure paths.
5. **Use stable, queryable action names.** You will query them years later.
6. **Get the actor from the authenticated context**, captured once at the edge.
7. **Don't sample, don't drop, don't level-filter** audit events. They are not `DEBUG`.
8. **Start with the high-value events** (auth, authz, sensitive access/changes, exports) and grow from there.

---

## Edge Cases & Pitfalls

- **The "system" actor.** When a cron job or background worker acts, the actor is a *service account*, not a blank. Record `actor.type=service, id=nightly-reconciler`. "Who: (empty)" is a bug.
- **Impersonation / on-behalf-of.** A support agent acting as a customer must record *both* identities. Recording only the customer hides the agent; recording only the agent loses the affected resource. (Deep dive in `middle.md` and `senior.md`.)
- **Failed login = no logged-in user yet.** The actor for `auth.login_failed` is the *attempted* identity (the username typed), plus the source IP. You can't use a session that doesn't exist.
- **Bulk actions.** Deleting 10,000 records: do you emit 10,000 events or one event with a count? At junior level, one event with `metadata.count` is usually fine, but know that for some regimes each record access must be individually auditable.
- **Time zones and clock skew.** Two servers with skewed clocks produce out-of-order audit events. Always UTC; rely on NTP. (Ordering is a senior/professional topic.)
- **Audit write fails.** If the audit sink is down, what happens to the action? At junior level, at minimum *alert loudly* — never silently swallow. (The "fail-open vs fail-closed" decision is a senior topic.)

---

## Common Mistakes

1. **Putting audit events in the application log.** The number-one mistake. Different consumer, retention, integrity needs. Use a separate sink.
2. **Omitting the outcome.** "Alice deleted customer 4471" — did it *succeed*? A denied attempt looks identical without `outcome`.
3. **Recording "system did X" with no real actor.** The whole point is attribution. Find the principal.
4. **Human-sentence action names.** `"deleted the customer record"` can't be queried; `customer.delete` can.
5. **Local timestamps / ambiguous formats.** `06/11/26 2:02 PM` is forensically useless. Use UTC ISO 8601.
6. **Sampling or level-filtering audit events.** Treating them as `DEBUG`/`INFO` that can be dropped. They are not.
7. **Logging secrets into the audit event.** Recording the new password instead of "password changed". A breach in the audit log itself.
8. **Auditing everything indiscriminately.** Auditing every page view buries the real signals and explodes cost. Audit *deliberate, significant* actions.
9. **Silently swallowing audit-write failures.** If you can't record it, at least scream about it.
10. **Reconstructing the actor deep in the stack** instead of capturing it once at the authenticated edge — and getting it wrong.

---

## Tricky Points

1. **Audit logging is the *opposite* of normal logging on PII.** Standard logging advice says "don't log PII." Audit logging often *requires* PII — the actor's identity is the entire point. The two disciplines have inverted rules; don't apply app-log instincts blindly.
2. **A successful action and a denied action are both audit events.** Beginners audit only the happy path. The denied path is often the more important security signal.
3. **The actor of a failed login is not a user object.** There's no session yet. The actor is the *claimed* identity plus the origin.
4. **"Audit" and "log" share a verb but not a discipline.** They look the same in code (`logger.info`) and are completely different in purpose, retention, and integrity. The similarity is a trap.
5. **The timestamp on the event is the *server's* time of recording, not necessarily the *user's* clock.** Be clear about which clock you mean. For forensics, server UTC at the moment of the action is standard.
6. **Where you write the event matters as much as what you write.** A perfect event in a mutable, sampled, 3-day-retention stream is not an audit log.

---

## Test Yourself

Work through these honestly. No answers provided — they're for self-assessment.

1. Take a small CRUD app of yours. List every action a user can take. Mark which ones are audit-worthy (auth, authz, sensitive access/change, export) and which are app-log territory.
2. For one audit-worthy action, write out the full JSON event with all five W's plus source IP and request ID. Then read it back as a "stranger in two years." Can you tell what happened?
3. Add a *separate* audit logger to a project (separate file/stream from your app log). Verify with `grep` that audit events never appear in the app log and vice versa.
4. Write the audit event for a *failed* login. Who is the actor? What's the resource? What's the outcome?
5. Take an existing `logger.info("user X did Y")` line in some codebase and rewrite it as a proper structured audit event going to a separate sink.
6. Audit an admin granting themselves a role. Why is *this specific event* a classic insider-threat signal?
7. Trigger your audit write on both the success and failure paths of one operation. Confirm both produce an event.

---

## Tricky Questions

**Q1: Why can't I just add `logger.info("audit: ...")` to my normal logger and filter by the `audit:` prefix later?**

Because the *sink* is shared. Under load your app logger may sample or drop lines — including your audit ones. Your app log is retained for days, not years. It's readable by every engineer, when audit data often needs restricted access. And there's no integrity guarantee. The prefix solves the *labeling* problem and none of the *sink* problems, which are the ones that matter.

**Q2: An action both reads and modifies data. Is that one audit event or two?**

Usually one event for the *deliberate act* — e.g. `customer.update` — with the changed fields in metadata. You split into multiple events only when distinct security-relevant acts happen (e.g. "read the record" and later "exported the record" are two different acts at two different times).

**Q3: The user's action failed because of a bug, not a permission denial. Do I still audit it?**

Yes. Record `outcome=failure`. The audit log captures *attempts*, not only completed changes. "Alice tried to delete customer 4471 and the system errored" is a real, useful record — and distinguishing `failure` (system error) from `denied` (permission refused) is valuable.

**Q4: What's the difference between `outcome=failure` and `outcome=denied`?**

`denied` means the system *deliberately refused* the action — the actor lacked permission. `failure` means the action was *allowed* but something went wrong (a bug, a downstream error). Security cares a lot about `denied` (probing, misconfiguration); reliability cares about `failure`. Recording both as just "error" loses that signal.

**Q5: My app is tiny and has no compliance requirements. Do I still need a separate audit log?**

You need the *separation* even if you don't yet need years of retention or tamper-evidence. Building the habit and the seam now costs almost nothing. Retrofitting a separate audit pipeline into a mature codebase — finding every place a security-relevant action happens — is expensive. Cheap insurance.

**Q6: Should the audit write happen inside the same database transaction as the action?**

It depends, and it's genuinely a senior-level trade-off (covered in `middle.md`). The short version: writing the audit record in the *same transaction* gives you "the action and its audit record commit or roll back together" — strong consistency, but it couples your audit store to your business DB. Writing it *after* is simpler but risks the action committing while the audit write fails. Know that the choice exists.

**Q7: A background job deletes expired records automatically. Who's the actor?**

A *service account* — e.g. `actor.type=service, id=retention-cleaner`. Never leave the actor blank. If a policy or schedule *caused* the deletion, name the principal responsible for that automation. Automated actors are first-class actors.

---

## Cheat Sheet

```text
┌──────────────────────────── AUDIT LOGGING — JUNIOR CHEAT SHEET ─────────────────────────────┐
│                                                                                             │
│  THE FIVE W's (every event must answer ALL of these)                                       │
│    WHO      actor   { type, id, session_id }                                                │
│    WHAT     action  "customer.delete"   (stable, machine-readable verb)                     │
│    WHICH    resource{ type, id }                                                            │
│    WHEN     timestamp  UTC, ISO 8601, ms precision, trailing Z                              │
│    OUTCOME  "success" | "failure" | "denied"   (NEVER omit)                                 │
│  + FROM    source_ip      + CORRELATE  request_id      + WHY  metadata.reason               │
│                                                                                             │
│  AUDIT LOG  ≠  APP LOG                                                                       │
│    app log  → "what is the code doing?"   engineers   sampled   days   mutable              │
│    audit    → "who did what, provably?"   auditors    complete  years  separate sink        │
│                                                                                             │
│  THE ONE RULE                                                                               │
│    Separate logger → separate sink.   NEVER logger.info() on the app logger.                │
│                                                                                             │
│  AUDIT ON DAY ONE                                                                           │
│    logins (incl. FAILED)   role/permission changes   sensitive read/export                  │
│    sensitive create/update/delete   admin actions   impersonation                           │
│                                                                                             │
│  DON'T AUDIT                                                                                 │
│    page views   health checks   internal retries   cache hits   ordinary reads              │
│                                                                                             │
│  RED FLAGS                                                                                   │
│    audit line in app log      →  wrong sink                                                 │
│    no outcome field           →  half a record                                             │
│    actor = "system"/blank     →  no attribution                                            │
│    action = a sentence        →  not queryable                                             │
│    secret in the event        →  you just leaked it                                        │
│                                                                                             │
│  GOLDEN RULES                                                                               │
│    • An audit log is EVIDENCE; an app log is a DIARY.                                       │
│    • One deliberate act → one event.                                                       │
│    • Completeness beats verbosity. Never sample.                                            │
│    • A denied attempt is as important as a success.                                        │
│    • Pass the "stranger in two years" test.                                                 │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- An **audit log** answers *"who did what, to which resource, when, and can I prove it?"* — a different question from the app log's *"what is the system doing?"*
- Every audit event must answer the **five W's**: **who** (actor), **what** (action), **which** (resource), **when** (UTC timestamp), and **outcome** (success/failure/denied). Add **from** (source IP) and **why** (reason/ticket) whenever you can.
- The single most important practical rule: **audit events go to a separate sink** — a distinct logger to a distinct destination, never `logger.info(...)` on the application log.
- **Completeness beats verbosity.** Audit logs are never sampled or dropped; a security-relevant action is recorded every single time.
- **Attribution is the heart of it.** The actor must be the *real* principal — including a service account for automated actions and *both* identities for impersonation.
- Record the event **after the outcome is known**, on both the success and failure paths. **Denied** attempts are often the most important events.
- Name actions as **stable, queryable identifiers** (`customer.delete`), not human sentences. You'll query them years later.
- Audit logging **inverts** normal logging's PII rule: the actor identity (PII) is *required*, not avoided — but secrets still never go in.
- Start with the **high-value events** (auth, authz, sensitive access/changes, exports) and grow from there.

---

## What You Can Build

- A **`audit` package/module** for one of your apps: a separate logger to a separate sink, an `AuditEvent` type with the five W's as named fields, and a `Record(...)` function. Wire it into your three most security-relevant handlers.
- A **"five W's linter"**: a tiny script that scans your audit-call sites and flags any that don't pass all five fields (especially a missing `outcome`).
- A **grep-based separation test**: a CI check asserting that no string matching your audit event shape appears in the application log file, and vice versa.
- A **breach-investigation drill**: generate a week of synthetic audit events, then answer "who exported customer data on Tuesday?" using only a query. If you can't, your events are missing fields.
- A **failed-login recorder**: a small auth endpoint that audits `auth.login_failed` with the attempted username and source IP, and proves the actor handling works when there's no session.

---

## Further Reading

- **Standards & guides**
  - *NIST SP 800-92 — Guide to Computer Security Log Management* — the canonical reference for what audit logs are for. <https://csrc.nist.gov/publications/detail/sp/800-92/final>
  - *OWASP Logging Cheat Sheet* — practical do/don't list, including what to log for security. <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
  - *PCI DSS Requirement 10* — the most concrete "you must audit X" list in the industry, even if you're not handling cards.
- **Schemas to learn from**
  - *OCSF (Open Cybersecurity Schema Framework)* — a modern, open audit/security event schema. <https://schema.ocsf.io/>
  - *AWS CloudTrail record contents* — a real, mature audit event schema you can read field-by-field.
- **Tool docs**
  - Go `log/slog` — <https://pkg.go.dev/log/slog>
  - Python `logging` — <https://docs.python.org/3/library/logging.html>
  - Pino (Node) — <https://getpino.io/>
  - Logback + logstash-encoder (Java) — <https://github.com/logfellow/logstash-logback-encoder>

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — structured event schemas, what to capture vs redact, append-only stores, correlation, transaction coupling.
- **Senior level:** [senior.md](senior.md) — tamper-evidence (hash chains, signing, WORM), retention & compliance regimes, the threat model.
- **Professional level:** [professional.md](professional.md) — building an audit pipeline at scale, cryptographic integrity, forensic/legal admissibility, multi-tenant.
- **Interview prep:** [interview.md](interview.md) — audit-logging questions you'll be asked.
- **Practice:** [tasks.md](tasks.md) — guided exercises at each level.

**Sibling diagnostic topics:**

- [Logging — Junior](../logging/junior.md) — the *operational* logging discipline. Audit logging is its stricter cousin; read this to see the contrast.
- [Error Handling — Junior](../error-handling/junior.md) — outcomes you'll record (`failure` vs `denied`) come from how your code expresses failure.

**Cross-roadmap links:**

- [Encryption Basics](../../code-craft/) and the `secrets-management` skill — what *never* belongs in an audit event.
- [API Authentication](../../code-craft/) — where the actor identity you record comes from.

---

## Diagrams & Visual Aids

### The Five W's of an Audit Event

```text
        ┌─────────────────── ONE AUDIT EVENT ───────────────────┐
        │                                                       │
  WHO ──┤  actor      { type:user, id:alice@corp, session }     │
 WHAT ──┤  action     "customer.delete"                         │
WHICH ──┤  resource   { type:customer, id:4471 }                │
 WHEN ──┤  timestamp  2026-06-11T14:02:09.471Z  (UTC)           │
 OUT  ──┤  outcome    "success" | "failure" | "denied"          │
        │  + source_ip   + request_id   + metadata.reason       │
        └───────────────────────────────────────────────────────┘
                   "Who did what to which thing, when,
                       and did it work — provably."
```

### Two Streams, Never Crossed

```text
                      ┌──────────────────┐
   logger.debug(...)  │   APPLICATION    │  → hot, sampled, days,
   logger.info(...)   │      LOG         │     mutable, all engineers
                      └──────────────────┘
   ─────────────────────────────────────────────────  (never cross this line)
                      ┌──────────────────┐
   audit.Record(...)  │   AUDIT LOG      │  → complete, years,
                      │  (separate sink) │     restricted, tamper-evident
                      └──────────────────┘
```

### When Is It an Audit Event?

```text
        Did an IDENTIFIED principal
        DELIBERATELY cause a security-
        or business-significant change?
                   │
          ┌────────┴────────┐
         YES               NO
          │                 │
   ┌──────────────┐   ┌──────────────┐
   │ AUDIT EVENT  │   │  APP LOG     │
   │ (5 W's, own  │   │  (or nothing │
   │  sink)       │   │   at all)    │
   └──────────────┘   └──────────────┘

   login ✓   role grant ✓   export ✓   delete customer ✓
   page view ✗   cache hit ✗   internal retry ✗
```

---

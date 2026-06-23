# Logging — Senior Level

> **Topic:** [Logging Roadmap](README.md)
> **Focus:** The log *pipeline* as a system: collectors, sampling, correlation across services, PII discipline, cost, and the operational machinery that turns raw `log.Info(...)` calls into something a 50-engineer org can actually use at 3am.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Log Pipeline](#the-log-pipeline)
8. [Correlation Across Services](#correlation-across-services)
9. [Sampling and Volume Control](#sampling-and-volume-control)
10. [PII, Secrets, and Compliance](#pii-secrets-and-compliance)
11. [Cardinality and the Metric-vs-Log Boundary](#cardinality-and-the-metric-vs-log-boundary)
12. [Code Examples](#code-examples)
13. [Performance at Scale](#performance-at-scale)
14. [Operational Discipline](#operational-discipline)
15. [Designing Log Schemas for Queryability](#designing-log-schemas-for-queryability)
16. [Common Senior-Level Failures](#common-senior-level-failures)
17. [Logs vs Metrics vs Traces](#logs-vs-metrics-vs-traces)
18. [Use Cases](#use-cases)
19. [Coding Patterns](#coding-patterns)
20. [Best Practices](#best-practices)
21. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Tricky Points](#tricky-points)
24. [Test Yourself](#test-yourself)
25. [Tricky Questions](#tricky-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Summary](#summary)
28. [What You Can Build](#what-you-can-build)
29. [Further Reading](#further-reading)
30. [Related Topics](#related-topics)
31. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At junior level you learned *what to log*. At middle level you learned *how to structure it*. At senior level you stop thinking about a single process and start thinking about **the pipeline** — what happens to a log line after `slog.Info` returns, who pays for it, and why your beautiful structured event might still be useless at 3am.

The senior view of logging is **systemic**. A `log.Info("user.login", ...)` is not the end of the story; it's the start of a journey that crosses several network hops, multiple cost centers, two or three retention policies, a redaction stage, an indexing layer, and finally a query UI that someone uses while paged. Every one of those stages is a place where logs go missing, get expensive, or leak something they shouldn't. A senior engineer owns the whole journey.

This page covers the things that distinguish *somebody who can write good log calls* from *somebody who can run logging for a 200-service company without it burning down*: log pipelines, trace correlation, sampling strategies, PII regimes, the cardinality cliff, runtime log control, schema discipline, and the failure modes that only show up at scale (collector OOMs, GDPR incidents, a $40k/month CloudWatch bill from a misconfigured DEBUG flag).

We will keep things at the **code and design** level. Dashboards, alerts, SLOs, and the full observability platform belong to the `observability-stack` skill — this page tells you what *your code* and *your pipeline config* must do so that platform has something useful to chew on.

---

## Prerequisites

What you should already have absorbed from `junior.md` and `middle.md`:

- **Required:** Structured logging — you instinctively reach for `slog`, `structlog`, or Logback with a JSON encoder rather than `fmt.Println`.
- **Required:** Log levels — you can defend why a specific event is `INFO` vs `WARN` and what level your prod service runs at by default.
- **Required:** Context propagation inside a single process — you've used `context.Context` in Go, MDC in Java, or `contextvars` in Python to attach `request_id` to every log line in a request.
- **Helpful:** Some exposure to OpenTelemetry, distributed tracing, or any production observability tool (Datadog, Honeycomb, Splunk, ELK, Grafana Loki).
- **Helpful:** Experience reading a postmortem where logs were the hero or the villain.
- **Helpful:** Once being on call for a service generating > 100 GB of logs/day. Things hit different after that.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Log pipeline** | The chain of components that move log records from app process to durable storage and query backend. |
| **Collector** | A process (Fluent Bit, Vector, OTEL Collector, Filebeat) that reads logs from sources, buffers, transforms, and forwards them. |
| **Backend** | The thing that actually stores and indexes logs for query — Loki, Elasticsearch, Splunk, Datadog Logs, CloudWatch Logs, S3 + Athena. |
| **Backpressure** | What happens when the downstream is slower than the upstream — buffers fill, then either drop, block, or spill to disk. |
| **Trace ID** | An ID shared by all spans of a single distributed operation; the unit of correlation across services. W3C standard: `traceparent` header. |
| **Span ID** | The ID of a single unit of work within a trace; logs can be attached to the active span. |
| **Request ID** | A per-edge-request ID; sometimes equal to trace ID, sometimes separate (e.g. CDN request ID vs internal trace ID). |
| **Head-based sampling** | Decision made at trace start ("keep 1% of traces"); cheap but blind to which traces matter. |
| **Tail-based sampling** | Decision made after the full trace is observed ("keep all error traces, sample 1% of OK traces"); needs a buffer. |
| **PII** | Personally Identifiable Information — anything that can identify a person directly or in combination (email, IP, full name, government ID). |
| **Redaction** | Removing/masking sensitive fields before logs are persisted. Source-side, sidecar, or collector-side. |
| **Cardinality** | How many distinct values a field takes; high cardinality (user_id, request_id) destroys metric systems but is fine in logs. |
| **Audit log** | A log of *who did what to what*, treated as a legal record. Different retention, access controls, and immutability rules than app logs. |
| **WAL / disk-backed buffer** | The collector's on-disk queue so logs survive a collector restart and ride out brief backend outages. |
| **Fan-out** | Shipping the same log to multiple backends (e.g. Datadog for query + S3 for cheap archive + Splunk for security team). |
| **Adaptive / on-error sampling** | Keep DEBUG logs only for traces that ended in error; throw the rest away. The Honeycomb-style trick. |

---

## Core Concepts

### 1. The Log Is Not the Endpoint — the Pipeline Is the System

A junior thinks "I called `log.Info`, my job is done." A senior thinks "I emitted a JSON event to stdout; now a Fluent Bit sidecar will tail it, buffer it, redact it, batch it, and ship it to Loki — and if any of those stages dies, *I* get paged." Everything you choose at the code level (field names, levels, JSON shape) is constrained by what the pipeline can survive, store, index, and bill.

### 2. Correlation Is the Whole Game

At single-service level, `timestamp` plus a `request_id` is enough to reconstruct what happened. At 50 services, you need a **trace ID that's the same across every service that touched a request**. Without that, your "search for the error" turns into "scroll through five teams' Slack channels asking who saw what." This is what `traceparent` and OpenTelemetry exist for.

### 3. You Are Always Sampling — Decide Where

Even if your code logs every request, *somebody* is sampling: the collector drops on backpressure, the backend rejects on quota, retention deletes after 7 days. The question is **where the sampling decision is made and whether it's smart**. Random 1% sampling on a million-RPS service that has one bug per million requests means you'll never see the bug. **Tail-based, error-biased sampling** is the senior answer.

### 4. PII in Logs Is a Liability, Not a Feature

The day-1 instinct ("log everything, we'll figure it out later") is the senior nightmare. Logs persist for 30-365 days. Every PII field is a future GDPR-letter, SOC 2 finding, or breach blast-radius multiplier. Senior engineers build **systematic redaction** (lint rules, schema, processor in the logger) so the wrong field can't reach the pipeline even if a junior types it.

### 5. Cost Lives in the Pipeline, Not in `log.Info`

The `log.Info` call costs ~1µs. The CloudWatch ingestion costs ~$0.50/GB. At 10k req/s × 5 KB/line × 86400s/day, that's **4.3 TB/day**, or about **$65k/month** on CloudWatch ingest alone. That's why you need to be able to defend every field you emit, and why sampling and downsampling matter more than micro-optimizing the encoder.

### 6. Cardinality Is Where Logs and Metrics Diverge

If you put `user_id` in a Prometheus label, you die. If you put `user_id` in a log line, you're fine — that's exactly why logs exist. The senior-level mental model: **logs are wide rows with arbitrary cardinality; metrics are narrow rows with bounded cardinality; traces are spans with parent/child relationships.** Pick the right one per field.

### 7. The Schema Is Org-Level, Not File-Level

Field naming inside one service is easy. Field naming **across 200 services from 30 teams** so that one query "errors by tenant in the last hour" works regardless of which service emitted it — that's an org-level data-modeling problem. Pick one (`tenant_id`, `tenant.id`, `customer_id`?), write it down, and put it in the linter.

### 8. Operational Levers Matter More Than Code Beauty

You will be woken up by a service whose default level is `INFO` and you need to turn on `DEBUG` *for one tenant* without redeploying. That capability — runtime log level changes, per-tenant levels, header-triggered diagnostic mode — is what separates a hospital from a museum.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| The log pipeline | A municipal sewage system: pipes (collectors), treatment plants (transformers/redactors), reservoirs (buffers), distribution to multiple destinations (Loki, ELK, S3). |
| Trace ID | A patient wristband in a hospital — every department touches it and writes notes against the same ID, so the chart reconstructs cleanly. |
| Head-based sampling | Deciding at the airport gate whether the flight gets recorded. You miss the interesting bits if a fight breaks out mid-flight. |
| Tail-based sampling | Recording the whole flight, then keeping only the recordings of flights with incidents. Expensive buffer, but you keep exactly what matters. |
| PII redaction in logger | A passport scanner at customs that blacks out the photo before printing — the original never leaves the trusted boundary. |
| Cardinality explosion in Prometheus | A library card catalog where every single user gets their own drawer — drawers run out, the whole system collapses. |
| Audit log vs application log | Tax records vs grocery receipts. Different retention. Different access. Different consequences if lost. |
| Disk-backed buffer | Generators behind a hospital — they kick in when the main feed dies and nobody upstream notices. |
| Fan-out to multiple backends | A press release going to wire services, your company blog, and the internal newsletter at the same time. |
| Adaptive sampling | A flight recorder that only saves the last 30 minutes before a crash — irrelevant footage discarded continuously. |

---

## Mental Models

### A. "Logs Are Events on a Bus"

Stop thinking of a log as a `printf` and start thinking of it as **an event published to a stream**. Every log line is a row in a wide-event table; the schema matters; the bus has backpressure; consumers (query backends) have schemas they expect. That mental shift takes you from "I print debug stuff" to "I emit a versioned event."

### B. "Three Pillars, One Cardinality Choice"

Metrics, logs, traces are not three independent things — they sit on a cardinality axis. Low cardinality, high frequency? Metric. High cardinality, low frequency? Log. Same row but arranged into a span tree across services? Trace. Each log field you add has a "would I put this in Prometheus?" question — if no, it belongs in a log, not a label.

### C. "If You Wouldn't Save It in a Database, Don't Log It"

Logs are durable storage with weird query semantics. If you would not, with a straight face, save a column called `password` in your users table, do not put it in a log line. The fact that logs feel ephemeral is an illusion — they live in S3 / Splunk / Datadog for months and are searchable by anyone with a Datadog seat.

---

## The Log Pipeline

A modern production log pipeline almost always looks like this:

```text
┌─────────────────────┐
│  Application Code   │
│  log.Info("evt"...) │
└──────────┬──────────┘
           │ (1) stdout / unix socket / TCP
           ▼
┌─────────────────────┐    ┌──────────────────────┐
│  Collector Sidecar  │◄───┤  Local Disk Buffer   │
│  (Fluent Bit /      │    │  (WAL, ride-out      │
│   Vector / OTEL)    │    │   backend outage)    │
└──────────┬──────────┘    └──────────────────────┘
           │ (2) parse, enrich (k8s pod, host),
           │     redact PII, sample, batch
           ▼
┌─────────────────────┐
│  Transport          │  TLS, compressed, batched
│  (gRPC / HTTP /     │  (kafka in some shops)
│   Kafka)            │
└──────────┬──────────┘
           │ (3)
           ▼
┌──────────────┬───────────────┬─────────────────┐
│  Hot Backend │  Cold Archive │  Security SIEM  │
│  Loki / ELK  │  S3 / GCS     │  Splunk ES      │
│  7-30d index │  1y + retain  │  Audit & rules  │
└──────────────┴───────────────┴─────────────────┘
```

**Why each stage exists:**

1. **Process → stdout.** The "12-factor logs" principle: the app doesn't know its backend. It just writes events to stdout/stderr and lets the platform handle the rest. **When to break it:** when you need delivery guarantees the platform can't give (e.g. audit logs go *directly* to Kafka with `acks=all` to avoid losing them through a collector restart).

2. **Stdout → collector.** This is where buffering, backpressure handling, parsing, enrichment, and redaction live. The collector exists so the app doesn't have to know about Loki credentials, retries, or schema. It also lets you change backends without touching code.

3. **Collector → transport.** TLS, compression, batching, and — critically — a disk-backed queue so a brief backend outage doesn't drop your logs. Without this, a 30-second Loki restart means a permanent data hole.

4. **Transport → backend(s).** The **fan-out** problem. Most companies end up shipping to 2-3 backends: an indexed hot store (Datadog/Loki/ELK) for the on-call engineer, a cheap cold store (S3/GCS) for compliance, and a security/SIEM tool (Splunk) for the security team. Each costs differently, retains differently, and shows different fields. Configuring this fan-out in *one place* (the collector) is the point of the architecture.

### The Fan-Out Problem

Shipping the same log to 3 backends sounds redundant. It is not:

| Backend | Why | Typical retention | Cost per GB ingest |
|---|---|---|---|
| Datadog / Splunk / Loki (hot) | Engineer query during incident | 7-30 days | $1.27 (Datadog) - $0.50 (Loki self-hosted) |
| S3 / GCS (cold) | Compliance, "we have it but rarely query" | 1-7 years | $0.023/GB/month *storage*; $0 ingest |
| SIEM (Splunk ES, Elastic SIEM) | Security team correlation, audit trails | 1-7 years | $5+ |

The senior choices: **which fields go to which backend**, **whether the cold store gets full fidelity or a subsample**, **whether the SIEM gets the redacted or pre-redacted copy**.

---

## Correlation Across Services

### Trace IDs

A trace ID is the only field that survives across service boundaries and lets you reconstruct "the journey of one request." The **W3C `traceparent` header** is the standard:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                 │                  │
             │  │ trace-id (16 bytes hex)         │ span-id (8 bytes) │
             │                                    │                   │
             version                              parent span         flags
```

Every service participating in the request **must propagate `traceparent`** on outgoing HTTP/gRPC/queue calls and **must include `trace_id` and `span_id` in every log line emitted during that request**. The mechanism:

- HTTP: read/write the `traceparent` header.
- gRPC: read/write `traceparent` in metadata.
- Message queues: include `trace_id` in message metadata/headers.
- Background jobs: persist `trace_id` in the job payload, restore it when the worker picks the job up.
- Database: include `trace_id` in a SQL comment (`/* trace_id=abc... */`), so DB slow-query logs can be correlated with app logs.

### Request IDs Are Not Always Trace IDs

A common subtle bug: your CDN/load balancer generates a `X-Request-ID`, but your tracing system generates a `trace_id` internally. These are **two different IDs** with two different lifetimes. Log both. The `request_id` lets the CDN team find their data; the `trace_id` lets your team find theirs.

### The Drill-Down Workflow

This is the senior workflow that justifies all the trace-ID plumbing:

1. Alert fires: "checkout error rate > 1%."
2. Engineer opens log query: `level=ERROR service=checkout`.
3. Picks one error line. Sees `trace_id=abc123`.
4. Pivots to trace view in OTEL/Jaeger: full waterfall across 8 services, sees `payments` took 12s.
5. From the `payments` span, pivots back to logs: `trace_id=abc123 service=payments` → finds the actual error message.
6. From that log line, sees `user_id=u_5432` and `tenant_id=t_99`. Pivots to "all errors for tenant t_99 in last 24h."

Every pivot in that workflow requires a **shared, consistent field name** in every service's logs.

### Identifying Fields to Always Log

| Field | Why | Source |
|---|---|---|
| `trace_id` | Cross-service correlation | OTEL context, `traceparent` header |
| `span_id` | Connect logs to a span | OTEL context |
| `request_id` | Edge-layer correlation (CDN, LB) | Edge header, e.g. `X-Request-ID` |
| `user_id` | Per-user incident scope, audit | Auth middleware |
| `tenant_id` | Multi-tenant blast radius | Auth / routing layer |
| `session_id` | Per-session troubleshooting | Cookie / token |
| `service` | Multi-service log query | App config |
| `version` / `commit_sha` | "did this start after deploy X?" | Build-time inject |
| `region` / `pod` / `node` | Hardware-locality bugs | Platform inject |

---

## Sampling and Volume Control

### Why You Sample

At 10k req/s with 5 KB JSON log lines per request, that's **4.3 TB/day**. At AWS CloudWatch's $0.50/GB ingest pricing, that's **$2150/day**, or **$65k/month**. The application infrastructure costs less than the logging bill. This is the senior wake-up.

| Traffic | Lines/day | Volume/day @ 5KB | CloudWatch cost/month @ $0.50/GB |
|---|---|---|---|
| 1k req/s | 86 M | 430 GB | $6,450 |
| 10k req/s | 864 M | 4.3 TB | $64,500 |
| 100k req/s | 8.6 B | 43 TB | $645,000 |

### Head vs Tail Sampling

- **Head-based:** decision made at trace start, with no knowledge of what will happen. Cheap (no buffer needed), but blind. If you sample 1%, you miss 99% of bugs.
- **Tail-based:** the collector (or a sampling sidecar) buffers all spans/logs for a trace until it ends, then decides whether to keep it. Expensive (buffer state per in-flight trace) but smart: you can say *"keep every trace that had an error, sample 1% of OK traces."*

### Per-Route, Per-Status, Per-Tenant Sampling

The "log everything for 5xx, 1% of 2xx" pattern, expressed as a Vector/OTEL Collector rule:

```text
# pseudo-config
sample(
  if http.status >= 500: keep 100%
  if http.status >= 400: keep 10%
  else                 : keep 1%
)
```

Even smarter: **per-tenant**. A new big customer (`tenant_id=t_new_whale`) gets 100% logging for the first week; established customers get 1%.

### Adaptive Sampling — the Best Trick

Generate DEBUG-level logs into a per-request ring buffer in memory. Only flush them downstream **if** the request ended in error. This gives you full DEBUG fidelity for the 0.1% of requests that mattered, and pays the storage cost of zero for the rest. Honeycomb popularized the trace-level version of this; you can do a logging-only version too.

```text
on request_start:
   buf = []
on log(level, fields):
   buf.append(level, fields)
on request_end(outcome):
   if outcome == ERROR or duration > p99 or sampled_for_tracing:
       flush(buf)        # all DEBUG goes out
   else:
       buf.discard()     # full fidelity, zero cost
```

---

## PII, Secrets, and Compliance

### What Counts as PII

Under GDPR, **anything that can identify a person directly or via combination**. The non-obvious list:

| Field | PII? | Notes |
|---|---|---|
| Email | Yes | Direct identifier. |
| User ID (opaque UUID) | Yes (with the lookup table) | Quasi-identifier. |
| IP address | Yes | Per CJEU jurisprudence. |
| Full name | Yes | Obvious. |
| Last 4 digits of card | Maybe | Often masked, but in combination = PII. |
| User-agent | Often | Browser fingerprintable. |
| URL with query string | Often | `?email=` is alarmingly common. |
| Timestamp + region | In combination | Can re-identify with auxiliary data. |

The defensive rule: **assume any field a user provides is PII unless you've explicitly classified it otherwise.**

### Where to Redact

| Stage | Pros | Cons |
|---|---|---|
| **At source** (in-logger processor) | PII never leaves the app process; ironclad. | Every service must adopt; easy to forget a new field. |
| **At collector** (Fluent Bit / Vector rule) | One central rule covers all services. | PII briefly lives on the node before collector reads it; one missed rule = silent leak. |
| **At backend** (Datadog scrubber) | Catches mistakes from earlier stages. | Too late if the backend is breached or queried by an unauthorized party. |

The senior answer: **layered redaction.** Lint at code-review time, redact in the logger (defense-in-depth), redact again at the collector (catch services that haven't adopted the logger), and rely on the backend scrubber as a last net.

### Tokenization vs Hashing vs Masking

- **Masking:** `j***@example.com` — irreversible, no lookup. Cheap. Use for display in logs.
- **Hashing:** `sha256(email)` — irreversible, but joinable (two log lines about the same user have the same hash). Beware: the hash itself becomes a quasi-identifier.
- **Tokenization:** swap the email for a synthetic token via a side service that holds the reverse map. Reversible only by someone with access to the token vault. Used for audit logs that need to be re-identified during legal discovery.

### Retention by Log Class

| Class | Typical retention | Access |
|---|---|---|
| **Application logs** | 7-30 days | Engineering on-call |
| **Audit logs** | 1-7 years | Security, compliance, legal hold |
| **Security logs** | 90 days hot, 1 year cold | SecOps |
| **Access logs** | 30-90 days | SRE + security |
| **Debug logs** (sampled) | 1-7 days | Engineering ad-hoc |

Mixing these classes in one bucket with one retention is a senior anti-pattern. Audit logs in particular must be **immutable, separately access-controlled, and never deleted before policy.**

---

## Cardinality and the Metric-vs-Log Boundary

Cardinality is "how many distinct values does this field take." A `service` label has cardinality ~50; a `user_id` label has cardinality ~10M.

### Why It Matters

- **Prometheus** stores one time series per unique label-set. A `user_id` label with 10M users × 5 metrics = 50M time series = OOM on the Prometheus server. **Don't.**
- **Logs** store every event as a row. High cardinality is *free* (you're already paying per-event); in fact, it's *the point* — "find the one user who saw the bug" only works because logs let you grep on `user_id=u_5432`.

### Field-by-Field Decision

| Field | Cardinality | Where? |
|---|---|---|
| `service` | ~50 | Both (metric label + log field) |
| `http.status` | ~10 | Both |
| `route` | ~hundreds | Both (with care) |
| `tenant_id` | ~thousands | Log; metric only if your TSDB supports it (Mimir, M3) |
| `user_id` | ~millions | **Log only** |
| `request_id` | ~billions | **Log only** |
| `trace_id` | ~billions | **Log only** |
| `sql_query` (templated) | ~hundreds | Log; metric only as a hash |
| `error_message` (raw) | unbounded | Log; metric only as a category |

### Derive Metrics From Logs vs Emit Metrics Directly

The structured-events school (Honeycomb / Charity Majors) says: **emit one wide event per unit of work, derive everything else from it.** That gives you maximum flexibility — `count(*) where status=500 group by route` is a metric, but the underlying rows have `user_id` and `request_id` for drill-down.

The classic three-pillar school says: **emit metrics directly** (cheap, fast, low cardinality), emit logs separately (high cardinality, rare). Both schools work; the senior choice is to **not double-pay** by emitting a counter *and* a log line for every event without thinking about it.

---

## Code Examples

The shared problem: a `payment` service that processes charges. Each request must emit a structured log with `trace_id`, redact the card number, and emit at the appropriate level.

### Go — `slog` with a redacting `Handler` wrapper

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

// RedactHandler wraps another slog.Handler and rewrites sensitive fields.
type RedactHandler struct {
	inner slog.Handler
}

func (h RedactHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.inner.Enabled(ctx, l)
}

func (h RedactHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return RedactHandler{inner: h.inner.WithAttrs(redactAttrs(attrs))}
}

func (h RedactHandler) WithGroup(name string) slog.Handler {
	return RedactHandler{inner: h.inner.WithGroup(name)}
}

func (h RedactHandler) Handle(ctx context.Context, r slog.Record) error {
	r2 := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	r.Attrs(func(a slog.Attr) bool {
		r2.AddAttrs(redact(a))
		return true
	})
	return h.inner.Handle(ctx, r2)
}

var sensitive = map[string]bool{
	"card_number": true, "cvv": true, "password": true,
	"authorization": true, "ssn": true, "email": true,
}

func redact(a slog.Attr) slog.Attr {
	if sensitive[strings.ToLower(a.Key)] {
		s := a.Value.String()
		if len(s) > 4 {
			return slog.String(a.Key, "***"+s[len(s)-4:])
		}
		return slog.String(a.Key, "***")
	}
	return a
}

func redactAttrs(in []slog.Attr) []slog.Attr {
	out := make([]slog.Attr, len(in))
	for i, a := range in {
		out[i] = redact(a)
	}
	return out
}

func main() {
	base := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	log := slog.New(RedactHandler{inner: base})
	log.Info("payment.charge",
		"trace_id", "4bf92f3577b34da6a3ce929d0e0e4736",
		"user_id", "u_5432",
		"amount_cents", 1299,
		"card_number", "4242424242424242", // will be redacted to ***4242
	)
}
```

### Python — `structlog` with a redaction processor and trace-ID injection

```python
import logging
import structlog
from contextvars import ContextVar

trace_id_var: ContextVar[str] = ContextVar("trace_id", default="")

SENSITIVE = {"card_number", "cvv", "password", "authorization", "ssn", "email"}

def redact(_, __, event_dict):
    for k in list(event_dict.keys()):
        if k.lower() in SENSITIVE:
            v = str(event_dict[k])
            event_dict[k] = "***" + v[-4:] if len(v) > 4 else "***"
    return event_dict

def inject_trace_id(_, __, event_dict):
    tid = trace_id_var.get()
    if tid:
        event_dict["trace_id"] = tid
    return event_dict

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        inject_trace_id,
        redact,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)

log = structlog.get_logger()

trace_id_var.set("4bf92f3577b34da6a3ce929d0e0e4736")
log.info(
    "payment.charge",
    user_id="u_5432",
    amount_cents=1299,
    card_number="4242424242424242",   # redacted to ***4242
)
```

### Java — SLF4J + Logback with MDC for trace propagation

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import net.logstash.logback.argument.StructuredArguments;

public class PaymentService {
    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    public void charge(String userId, long amountCents, String cardNumber) {
        // MDC propagates trace_id to every log line in this thread until cleared.
        MDC.put("trace_id", currentTraceId());
        MDC.put("user_id", userId);
        try {
            String redacted = redactCard(cardNumber);
            log.info("payment.charge",
                StructuredArguments.kv("amount_cents", amountCents),
                StructuredArguments.kv("card_number", redacted)
            );
        } finally {
            MDC.clear();
        }
    }

    private String redactCard(String c) {
        return c == null || c.length() < 4 ? "***" : "***" + c.substring(c.length() - 4);
    }

    private String currentTraceId() {
        // In real code, pull from OpenTelemetry: Span.current().getSpanContext().getTraceId();
        return "4bf92f3577b34da6a3ce929d0e0e4736";
    }
}
```

`logback.xml` snippet to emit JSON with MDC fields included:

```xml
<appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
  <encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
    <providers>
      <timestamp/><logLevel/><message/><mdc/><stackTrace/><arguments/>
    </providers>
  </encoder>
</appender>
```

### Rust — `tracing` with a redacting layer

```rust
use tracing::{info, instrument};
use tracing_subscriber::{fmt, EnvFilter};

#[instrument(skip(card_number), fields(card_number = redact(card_number)))]
fn charge(user_id: &str, amount_cents: u64, card_number: &str) {
    info!(amount_cents, "payment.charge");
}

fn redact(s: &str) -> String {
    if s.len() <= 4 { "***".into() } else { format!("***{}", &s[s.len()-4..]) }
}

fn main() {
    fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    charge("u_5432", 1299, "4242424242424242");
}
```

### Side-by-Side: One Incident, Two Worlds

**Symptom:** "Some users in tenant `t_99` are getting 500s on checkout. Started 20 minutes ago."

**With text logs (1990s pipeline):**

```text
2026-05-29 03:11:02 ERROR Something went wrong in handler
2026-05-29 03:11:02 ERROR java.lang.NullPointerException at line 432
2026-05-29 03:11:02 ERROR Could not process payment
```

You have: a timestamp, a message, a stack trace. You don't have: which user, which tenant, which trace, which downstream call failed. You scroll Slack, you ask the on-call from `payments`, you look at the deploy log, you guess. **MTTR: 45 minutes.**

**With structured logs + trace IDs:**

```json
{"ts":"2026-05-29T03:11:02Z","level":"error","service":"checkout","event":"payment.charge.failed",
 "trace_id":"4bf92...","user_id":"u_5432","tenant_id":"t_99","route":"/checkout","duration_ms":12043,
 "downstream":"payments","error":"timeout","commit":"abc123","region":"us-east-1"}
```

You: query `level=error tenant_id=t_99 last 30m`, see 47 hits, all `downstream=payments`, all `error=timeout`. Pivot to trace, see `payments` is calling a DB query that's running 12s. Pivot to DB logs by `trace_id`, see a missing index after this morning's migration. **MTTR: 8 minutes.**

---

## Performance at Scale

A senior engineer should be able to defend the per-log-line cost numbers and the architecture that gets there.

| Logger | Typical cost/line (steady-state) | Why |
|---|---|---|
| Go `log` (stdlib) | ~10 µs | Mutex around writer, formatting per call. |
| Go `slog` JSON handler | ~3-4 µs | Better, but still formats on call site. |
| Go `zap` (sugared) | ~1.5 µs | Pre-allocated encoder. |
| Go `zap` (typed fields) | ~0.8-1 µs | Zero-alloc on hot path. |
| Go `zerolog` | ~0.5-1 µs | Builder pattern, no reflection. |
| Java Logback (sync) | ~5-10 µs | Synchronous file appender. |
| Java Log4j2 (async, disruptor) | ~1-2 µs | LMAX disruptor ring buffer. |
| Python `logging` | ~15-25 µs | GIL + dict-formatting + handler chain. |
| Python `structlog` over `logging` | ~20-40 µs | Adds processor chain. |
| Rust `tracing` (JSON layer) | ~1-2 µs | Compile-time field expansion. |

### What Senior-Grade Loggers Do

1. **Lock-free async appender.** Producer writes to a per-CPU ring buffer; a single drain goroutine/thread flushes to disk in batches. Log4j2's disruptor and zap's lock-minimized writer are both instances of this.

2. **Batching to the collector.** Instead of one syscall per line, batch 100-1000 lines per write. Cuts syscalls and TCP overhead by 2-3 orders of magnitude.

3. **Disk-backed buffer at the collector.** Vector and Fluent Bit both support an on-disk WAL so logs survive collector restarts and brief backend outages.

4. **The "bypass formatting when level disabled" code path.** A `log.Debug(expensiveFormat(...))` *always* runs `expensiveFormat`. A `log.Debug("msg", "field", expensiveFn())` *can* skip evaluation if the handler returns `Enabled(DEBUG) == false`. This is why zap's typed-field API exists.

   ```go
   // Bad: expensive even when DEBUG is off
   log.Debug(fmt.Sprintf("user=%+v", expensiveDump()))
   // Good: zap/slog only evaluate if DEBUG is enabled
   log.Debug("dump", "user", lazy(expensiveDump))
   ```

5. **Per-CPU buffers.** Avoid contention on a single ring; one ring per core. The drain thread (or a thread-per-core architecture) merges.

### A Bad Pattern That Hides Cost

```python
log.debug(f"user payload: {json.dumps(user.__dict__)}")  # f-string ALWAYS runs
```

vs.

```python
log.debug("user payload", user_payload=user)  # structlog only serializes if enabled
```

The first one will pay `json.dumps` cost on every request in production. The cost is invisible until someone profiles and sees `json.dumps` at 4% of CPU.

---

## Operational Discipline

### Runtime Log Level Changes

You should never need to deploy to bump a level. Every senior service exposes one of:

- **Spring Boot:** `POST /actuator/loggers/com.acme.payment {"configuredLevel":"DEBUG"}`.
- **Go (`slog`):** an HTTP handler that mutates the level on a `slog.LevelVar`.
- **Python:** an admin endpoint that calls `logging.getLogger("acme.payment").setLevel("DEBUG")`.
- **Java Log4j2:** auto-reload of `log4j2.xml` from disk.

Go pattern:

```go
var levelVar = new(slog.LevelVar) // default Info
levelVar.Set(slog.LevelInfo)
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: levelVar})))

http.HandleFunc("/admin/log-level", func(w http.ResponseWriter, r *http.Request) {
    switch r.URL.Query().Get("level") {
    case "debug": levelVar.Set(slog.LevelDebug)
    case "info":  levelVar.Set(slog.LevelInfo)
    case "warn":  levelVar.Set(slog.LevelWarn)
    case "error": levelVar.Set(slog.LevelError)
    }
})
```

### Per-Tenant Log Level

A senior incident move: "turn on DEBUG only for tenant t_99." This requires a tenant-aware filter:

```go
func (h LevelByTenantHandler) Enabled(ctx context.Context, l slog.Level) bool {
    if tenantOf(ctx) == "t_99" {
        return l >= slog.LevelDebug
    }
    return l >= h.defaultLevel
}
```

This is invaluable in multi-tenant SaaS where you can't turn on DEBUG globally (it would 10x the bill).

### Header-Triggered Diagnostic Mode

A header like `X-Diagnostic: 1` (from a trusted internal source) makes that one request log at DEBUG with all redactions intact. Lets a support engineer reproduce a customer issue without a global flag change.

### The Shadow Logger

Sometimes you want to **measure** logging cost without changing the real logger. Add a `shadow` logger that does the same encoding to `/dev/null` and tracks throughput; compare baseline before/after a logging change.

---

## Designing Log Schemas for Queryability

### The Org-Wide Field Dictionary

Every senior org with > 20 services eventually writes a **field dictionary**: an internal spec saying "the tenant field is `tenant_id`, snake_case, string, UUID. Not `customer_id`, not `tenantId`, not `client_id`." Then a CI lint enforces it.

The OpenTelemetry **semantic conventions** are the de-facto standard starting point:

| OTEL convention | Example |
|---|---|
| `http.request.method` | `"GET"` |
| `http.response.status_code` | `200` |
| `url.path` | `"/users/42"` |
| `service.name` | `"checkout"` |
| `db.system` | `"postgresql"` |
| `db.statement` | `"SELECT ..."` (templated, never with PII) |

### The `event=`, `outcome=`, `duration_ms=` Triad

For any unit of work, emit one line with at minimum:

```text
event=order.checkout outcome=success duration_ms=237 user_id=u_5432 tenant_id=t_99 trace_id=...
event=order.checkout outcome=failure duration_ms=14021 error=payment.timeout downstream=payments ...
```

This single discipline makes "p95 latency of checkout last hour" and "error rate of checkout grouped by downstream" both one-line queries.

### Flatten vs Nest

Most log backends index top-level keys cheaply and nested structures expensively. Prefer **dotted flat keys** (`http.request.method`) over deeply nested JSON. They sort lexically (so `http.*` queries are easy) and they survive different backends' nesting policies.

| Better | Worse |
|---|---|
| `http.request.method=GET` | `{"http": {"request": {"method": "GET"}}}` (3-deep) |
| `db.system=postgresql` | `{"db": {"system": "postgresql"}}` |
| `error.code=TIMEOUT` | `error: {code: TIMEOUT, message: ...}` (acceptable for `error`, since it's 2-deep) |

### What to Log Where

| Concern | Audit log | App log | Access log | Security log |
|---|---|---|---|---|
| Who logged in | yes | maybe | yes | yes |
| Failed password attempt | yes (if compliance) | no | yes | yes |
| `GET /users/42` | no | optional | yes | optional |
| Business event (`order.placed`) | yes (commerce) | yes | no | no |
| Internal DB query | no | yes (debug) | no | no |
| Admin action (`user.delete`) | **yes (always)** | yes | yes | yes |
| Crashed exception | no | yes | no | maybe |

---

## Common Senior-Level Failures

These are the failures that get senior engineers paged and that they have *seen*.

1. **Log rotation broke; disk full; outage.** A misconfigured `logrotate`, a host-local appender with no size limit, or a fluentd that filled `/var/log` before its rotation kicked in. The app then 500s because it can't open a file. Senior fix: hard disk-usage limits + alert before fill.

2. **Collector died; in-memory buffer overflowed; data lost.** Fluent Bit OOM, no disk-backed buffer, 30-minute hole in logs during the actual incident. Senior fix: always enable disk-backed buffer; alert on collector buffer depth.

3. **Cardinality explosion — user_id in a Prometheus label took down Prometheus.** A junior added `user_id` to a counter "for visibility." The TSDB exploded. Senior fix: CI lint on metric label cardinality + a `metric_label_dictionary.yaml`.

4. **"We logged the PII for 6 months and only just noticed."** A new field `email` got introduced; the redactor was at the collector with a static list; nobody updated it. GDPR letter follows. Senior fix: source-side redactor + automated PII scanner running against a sample of recent logs.

5. **"Why are these logs late?"** During a traffic spike, the collector got backpressure; logs arrived 40 minutes late; on-call was looking at stale data. Senior fix: alert on collector lag (oldest record in buffer > 30s).

6. **Logs that mention "secret" or "password" by reference.** `log.Info("loaded secret", "name", "stripe.key")` — the *value* isn't logged but the *fact that the secret exists* is, and auditors care. Senior fix: standard for never logging secret *names* either.

7. **Mixing Python `logging` and `structlog` → half the lines unformatted.** A library uses stdlib `logging`, app uses `structlog`, the propagation isn't configured, half the lines come through unstructured. Senior fix: route stdlib `logging` through structlog's `ProcessorFormatter`.

8. **The `INFO` line that's actually a `DEBUG`.** A junior logs `"entering function foo"` at INFO. At 50k req/s, that's the entire log budget. Senior fix: log-level audit in code review + dashboards of "lines/sec by service and level."

9. **The 10MB log line.** A junior logs `log.Info("response", "body", res.bytes())` for a 10MB upload. The pipeline chokes. Senior fix: max-field-size cap in the logger.

10. **Loops that log.** `for x in big_list: log.Debug(x)` left at INFO. Senior fix: rate-limit per-logger and per-message-key.

---

## Logs vs Metrics vs Traces

This section is brief intentionally; the deep treatment is in the [`observability-stack`](https://docs.anthropic.com/) skill. The senior summary:

| Pillar | Best for | Cardinality | Cost shape |
|---|---|---|---|
| **Metrics** | High-frequency aggregates ("RPS by route") | **Low** | Cheap per data point, expensive per label combination |
| **Traces** | Latency breakdown across services | Medium | Per-span; sampled |
| **Logs** | Rare, full-context events; ad-hoc forensic queries | **High** | Per-event, $$$ at scale |
| **Wide events** (Honeycomb school) | Unified — one wide row per unit of work; metrics, traces, logs derived from it | **High** | Per-event but replaces all three |

The senior choice is **not "logs vs metrics"** — it's "which combination of cardinality, cost, and queryability does this signal need?" That question is best answered by walking the three together and choosing per-signal.

---

## Use Cases

- **Multi-service incident response.** A 50-service company can only do "find the broken thing in 5 minutes" if every service propagates `trace_id` and emits it in every log.
- **Compliance audit (SOC 2, ISO 27001, HIPAA, PCI-DSS).** Auditors will ask: "show me the audit log for user_id=X over the last 90 days." Without an audit-log class separate from app logs, this is hours of grep.
- **Capacity planning the log pipeline itself.** "If we onboard a new big customer, what does our log volume become?" — only answerable if you have per-tenant volume metrics on the pipeline.
- **GDPR data-subject request.** "User asks to be forgotten — find every log line about them in the last 30 days." Possible only if `user_id` is universal and queryable.
- **Cost optimization sprints.** "We spent $200k on Datadog last quarter; can we cut by 60% without losing diagnostic power?" — answered by sampling, classifying, and per-class retention.
- **A/B rollouts.** Header-based diagnostic mode on the canary so you log richer data only for the 1% getting the new code.

---

## Coding Patterns

### Pattern: Logger From Context

Always derive a logger that has the request's trace/user/tenant attached, instead of passing those as args every call:

```go
func WithRequest(ctx context.Context, r *http.Request) context.Context {
    log := slog.With(
        "trace_id", traceID(r),
        "user_id", userID(r),
        "tenant_id", tenantID(r),
        "route", r.URL.Path,
    )
    return context.WithValue(ctx, loggerKey{}, log)
}

func L(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}

// usage anywhere downstream:
L(ctx).Info("order.placed", "amount_cents", amount)
```

### Pattern: One Event Per Unit of Work

Wrong (3 lines, no aggregate):

```text
INFO  starting order processing
INFO  validating items
INFO  order placed amount=1299
```

Right (1 wide event):

```text
INFO event=order.placed outcome=success duration_ms=237 items=3 amount_cents=1299 user_id=u_5432 trace_id=...
```

This lets the backend treat the event as a row, not three correlated lines.

### Pattern: Redactor-As-Processor

Defense in depth: even if a developer writes `log.Info("payload", "email", user.Email)`, the redactor processor (in the logger, before the encoder) catches it and rewrites to `***@example.com`. The pipeline can also have a redactor, but it's the second line of defense, not the first.

### Pattern: Rate-Limited Logger Wrapper

```go
type RateLimitedHandler struct {
    inner   slog.Handler
    perKey  *lru.Cache[string, *rate.Limiter]
}
func (h *RateLimitedHandler) Handle(ctx context.Context, r slog.Record) error {
    lim := h.limiterFor(r.Message)
    if !lim.Allow() { return nil }
    return h.inner.Handle(ctx, r)
}
```

Stops a 10k-times-per-second log line from drowning the pipeline.

### Pattern: Outcome Wrapper

A small helper that emits exactly one event per unit of work with `outcome=success|failure` and `duration_ms`:

```go
func WithOutcome(ctx context.Context, event string, fn func() error) {
    start := time.Now()
    err := fn()
    fields := []any{"event", event, "duration_ms", time.Since(start).Milliseconds()}
    if err != nil {
        L(ctx).Error("op.failed", append(fields, "outcome", "failure", "error", err)...)
    } else {
        L(ctx).Info("op.ok", append(fields, "outcome", "success")...)
    }
}
```

---

## Best Practices

1. **Default level is INFO; nothing chattier ships to prod.** Anything more verbose is opt-in via runtime control.
2. **`trace_id`, `tenant_id`, `user_id` on every line by default** — handler-level injection, not call-site.
3. **Redact at source, redact again at collector, scrub at backend.** Three layers.
4. **One event per unit of work** with `event`, `outcome`, `duration_ms`.
5. **Audit logs are a separate pipeline.** Different retention, access, immutability.
6. **Cap per-field and per-line size.** Reject lines > 64 KB at the source.
7. **Runtime log-level change must exist** for every prod service.
8. **Per-tenant, per-route, per-status sampling** at the collector.
9. **Disk-backed buffer at the collector** is non-negotiable.
10. **The field dictionary is enforced by lint**, not by hope.
11. **Document and alert on log pipeline SLOs** ("99% of logs land within 30s, 99.99% land at all").
12. **Test the redactor.** It's the only safety net that prevents the GDPR-letter scenario.

---

## Edge Cases & Pitfalls

- **Log-during-shutdown deadlock.** If your logger flushes synchronously on shutdown and the collector is gone, you can hang. Always have a hard timeout on the final flush.
- **Logger flushing during signal handler.** Logging in a signal handler isn't async-signal-safe in most languages. Use a flag, drain in main loop.
- **JSON encoding errors silently dropping fields.** A non-serializable object (`<file object>`) can make some loggers drop the line silently. Test for it.
- **Time zones in the timestamp.** Always log UTC, always ISO-8601 with `Z`. Local time is a cardinal sin for distributed systems.
- **Clock skew across hosts.** Two log lines from different hosts can appear out of order; don't rely on timestamps to determine causality, use `trace_id` parent/child relationships.
- **Log level vs handler level.** A child logger at DEBUG with a parent handler at INFO will still drop. Know which level wins in your library.
- **Stdout buffering** in containers — a crashed Python app may lose the last 4 KB if `PYTHONUNBUFFERED=1` isn't set.
- **Goroutine leak that floods logs.** A misbehaving goroutine spinning and logging will saturate the pipeline and bury the actual error. Rate-limit per message key.
- **Log line that exceeds the collector's max-line-size.** Typically 1 MB; some backends 64 KB. Lines over the limit are silently truncated.

---

## Common Mistakes

1. **Putting `user_id` in a Prometheus label** ("for drill-down"). Boom: TSDB death.
2. **Relying on the collector alone to redact PII** with no source-side processor.
3. **Same retention for application logs and audit logs**, then deleting audit data the auditor needed.
4. **No runtime log-level control**, requiring redeploys to debug.
5. **One backend, no archive**, then losing 30 days of data when the backend has an outage.
6. **Logging the full request body** "for debugging" without size cap.
7. **Trace ID is generated per-service** instead of propagated, so cross-service correlation is impossible.
8. **`log.Debug(expensiveFunction())`** without lazy evaluation.
9. **Mixing structured and unstructured logs** in the same backend index — queries break.
10. **Letting libraries log straight to stderr** with formats that don't match your schema. Centralize the logging configuration.
11. **No `version` / `commit_sha` field** — can't answer "did this start after the 10:04 deploy?"
12. **Logging at INFO inside tight loops** — discovered only when the bill arrives.

---

## Tricky Points

- **Head-based sampling on the trace propagates to logs?** Decide explicitly. If a trace is dropped, do you also drop its logs, or keep logs but drop spans?
- **MDC leaking between requests** in thread-pool environments (Java) — must clear MDC in a `finally` block in the request filter.
- **`context.Context` not being passed everywhere in Go** — any code path that doesn't take a `ctx` won't have `trace_id`. Senior code makes `ctx` mandatory at every public function.
- **Python `contextvars` and `asyncio.create_task`** — the new task inherits the context at creation, but spawned threads do not. Senior fix: a context-copying executor.
- **OpenTelemetry's two trace contexts** — there's "the OTEL trace context" (in-process) and the "W3C `traceparent` header" (on the wire). They are related but not the same; mixing them up creates broken traces.
- **A redactor that uses regex on JSON** — works most days, but if a developer logs `{"reason": "user gave email j@x.com"}`, the email is in a free-text field and the redactor won't catch it. Source-side typed redactors are stronger.
- **Per-tenant sampling means per-tenant cost.** Customer X paying for the cheap plan is using 100x the log budget. Show it back to product.
- **The "shadow trace ID."** A request flows through a service that *doesn't* propagate, so the downstream creates a fresh trace ID. Suddenly you have two trace IDs for one user-perceived request. Propagation discipline matters.

---

## Test Yourself

1. Sketch the log pipeline for a 10-service company. Mark every place a log can be lost.
2. Compute the monthly Datadog bill for a service at 5k req/s × 3 KB/line × $1.27/GB ingest. What's your strategy to cut it 70%?
3. Write a Vector or Fluent Bit config that drops `password` and `card_number` from any log line, and adds `service=checkout` to every line emitted from the `checkout` pod.
4. Implement a `slog.Handler` that emits DEBUG into a ring buffer and only flushes it if the request ends with an error.
5. Your Prometheus dies. Trace it to a metric label that has 8M distinct values. Identify the offending line and fix it.
6. Add per-tenant DEBUG capability to a Go HTTP service with `slog`. Endpoint: `POST /admin/log-level?tenant=t_99&level=debug`. Defend the concurrency model.
7. Write a CI lint that fails the build if a log call's field key isn't in `field_dictionary.yaml`.
8. Run a chaos drill: kill the collector for 60 seconds. Did you lose logs? If yes, fix the buffer config.

---

## Tricky Questions

1. **"Why not just log everything at DEBUG into S3 and grep later?"**
   *Because grep across TBs is slow, S3 query is expensive, and your engineers won't use a 30-minute-query tool during a 5-minute incident. Hot indexed storage is paid for the privilege of being fast.*

2. **"Head-based or tail-based sampling?"**
   *Tail-based is strictly better information-wise but requires a buffer big enough to hold all in-flight traces. Most large orgs use head-based at the edge (drop 99% of traffic cheaply) and tail-based downstream for what survives.*

3. **"How do you correlate logs from a background worker with the request that enqueued the job?"**
   *Put `trace_id` (and ideally a new child span ID) in the job payload at enqueue time. The worker restores it when it picks the job up. Without it, you cannot reconstruct the workflow.*

4. **"Should `log.Info` ever be on the hot path?"**
   *Yes — one wide event per unit of work is on the hot path by design. What shouldn't be on the hot path: synchronous file I/O. Use an async appender so the log call is just a queue push.*

5. **"Audit logs in the same Datadog bucket as app logs?"**
   *No. Different retention, different access control, different immutability rules. Auditors will flag mixed buckets.*

6. **"Your service is logging 50 GB/day; ops asks you to cut by 80%. How?"**
   *(1) sample 2xx to 1%, keep all errors; (2) drop overly chatty INFO lines (audit which ones); (3) drop large fields (request body); (4) shorter retention on debug class; (5) compress fan-out to cold-only for one of the backends.*

7. **"How do you know your redactor works?"**
   *Automated PII scanner runs daily against a sample of recent logs and alerts on any field matching email/credit-card/SSN patterns. Plus unit tests on the redactor.*

8. **"Logs are arriving 5 minutes late during peak. What's wrong?"**
   *Backpressure somewhere — most often the backend, sometimes the collector. Check buffer depth at every stage. Lag should be < 30s steady-state; > 5 minutes means something is broken.*

9. **"Should you log every database query?"**
   *No, not at INFO. Templated queries (with statement + duration but parameters redacted/aggregated) at DEBUG with sampling. Slow queries (> threshold) at WARN with full context. Logging every query at 10k req/s is one of the surest ways to blow the budget.*

10. **"GDPR data-subject deletion request — how do you remove a user from logs?"**
    *Hardest question on this list. Most orgs (a) classify all PII fields and (b) use **tokenization** so a token-vault deletion + key-rotation makes PII unrecoverable from existing logs, rather than rewriting the logs themselves. Direct log mutation is usually impractical at scale.*

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                  SENIOR LOGGING CHEAT SHEET                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║ EVERY LOG LINE                                                           ║
║   trace_id  span_id  service  version  user_id  tenant_id  env  region   ║
║                                                                          ║
║ ONE EVENT PER UNIT OF WORK                                               ║
║   event=    outcome=success|failure    duration_ms=                      ║
║                                                                          ║
║ LEVELS IN PROD                                                           ║
║   default INFO; DEBUG opt-in by header / per-tenant / per-route          ║
║                                                                          ║
║ PIPELINE                                                                 ║
║   stdout -> collector(buffer + redact + sample) -> hot + cold + SIEM     ║
║                                                                          ║
║ SAMPLING                                                                 ║
║   5xx: 100%    4xx: 10%    2xx: 1%    debug: on-error tail-buffered      ║
║                                                                          ║
║ REDACT                                                                   ║
║   source (typed) -> collector (regex backstop) -> backend (scrubber)     ║
║                                                                          ║
║ CARDINALITY                                                              ║
║   user_id, request_id, trace_id => LOG (not Prometheus label)            ║
║                                                                          ║
║ COST RULE OF THUMB                                                       ║
║   1k req/s x 5KB/line x 30d ≈ 13 TB ≈ $6-13k/month hot                   ║
║                                                                          ║
║ OPS LEVERS                                                               ║
║   /admin/log-level?tenant=...   X-Diagnostic:1 header   /actuator/loggers║
║                                                                          ║
║ DON'T                                                                    ║
║   - log secrets even by name                                             ║
║   - log full request bodies                                              ║
║   - mix audit & app logs in same retention                               ║
║   - put high-cardinality in metric labels                                ║
║   - rely on a single backend / single buffer                             ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Summary

- Logging at senior level is **pipeline engineering**, not call-site engineering.
- **Correlation** (trace IDs, tenant IDs, user IDs propagated everywhere) is the single biggest force multiplier.
- **Sampling** is mandatory at scale; tail-based / error-biased / adaptive beats random head-based.
- **PII redaction** is a layered defense (source + collector + backend) with linting on top.
- **Cardinality** belongs in logs, not metrics; that's the architectural reason logs exist.
- **Cost** can dwarf compute; defending your bill is a senior skill.
- **Operational levers** — runtime log levels, per-tenant DEBUG, header-triggered diagnostics — are required.
- **Schema discipline** at org level (OTEL semantic conventions, field dictionary, lint) makes cross-service queries possible.
- The failure modes you must own: collector OOM, disk-fill outage, cardinality explosion, GDPR-leak, late-arrival data.

---

## What You Can Build

- A **logging cost dashboard**: per service per level lines/sec × bytes/line × retention = monthly $ — surfaced back to teams.
- A **PII auditor** that samples recent logs and flags fields matching email/IP/SSN patterns; ticket on hit.
- A **per-tenant DEBUG service**: HTTP endpoint that takes a tenant ID + duration and bumps log level for that tenant only.
- A **runtime log-level controller** at the platform level: enable DEBUG for one service in one region for 30 minutes via a CLI.
- An **adaptive log buffer** library: keep DEBUG in memory per request, flush only on error.
- A **field dictionary linter** for your monorepo that fails CI if a `log.Info` call uses a field name outside the dictionary.
- A **chaos drill** for the log pipeline: kill the collector, verify on-disk buffer, verify no data loss.

---

## Further Reading

- [Honeycomb — Charity Majors on observability and structured events](https://www.honeycomb.io/blog) — the wide-events / high-cardinality school.
- [Observability Engineering — Majors, Fong-Jones, Miranda](https://www.oreilly.com/library/view/observability-engineering/9781492076438/) — primary reference for the wide-event view.
- [Google SRE Workbook — chapters on Monitoring and Alerting](https://sre.google/workbook/) — operational context.
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) — the de-facto org-wide field dictionary.
- [Vector documentation](https://vector.dev/docs/) — modern collector; the easiest way to learn the pipeline.
- [Fluent Bit documentation](https://docs.fluentbit.io/) — the most-deployed collector; understand its memory and disk buffer model.
- [W3C Trace Context specification](https://www.w3.org/TR/trace-context/) — `traceparent`/`tracestate` headers.
- [Datadog — Sensitive Data Scanner docs](https://docs.datadoghq.com/sensitive_data_scanner/) — backend-side redaction as a last net.
- [LMAX Disruptor pattern](https://lmax-exchange.github.io/disruptor/) — the queue under Log4j2 async.
- [Grafana Loki — query, retention, sharding architecture](https://grafana.com/docs/loki/latest/) — a modern logs backend worth knowing.
- *The Twelve-Factor App — Logs* — the principled minimum.

---

## Related Topics

- Earlier levels in this topic: [junior.md](junior.md), [middle.md](middle.md)
- Next level: [professional.md](professional.md)
- Interview prep: [interview.md](interview.md), exercises: [tasks.md](tasks.md)
- Sibling diagnostics: [../error-handling/senior.md](../error-handling/senior.md), [../debugging/senior.md](../debugging/senior.md)
- Logging from a code-craft angle: [../../code-craft/clean-code/18-logging-and-diagnostics/README.md](../../code-craft/clean-code/18-logging-and-diagnostics/README.md)
- Full observability platform (dashboards, SLOs, alerts) — see the `observability-stack` skill.
- High-cardinality metric storage — see the `database-indexing` and `nosql-data-modeling` skills for the TSDB equivalent.

---

## Diagrams & Visual Aids

### The Log Pipeline End-to-End

```text
                ┌──────────────────────────────┐
                │  Application Process         │
                │                              │
                │  log.Info("event",           │
                │     "trace_id", ...,         │
                │     "user_id", ...,          │
                │     "tenant_id", ...)        │
                │                              │
                │  [in-logger redactor]        │
                │  [in-logger rate limiter]    │
                │  [in-logger trace injector]  │
                └──────────────┬───────────────┘
                               │ JSON over stdout / unix socket
                               ▼
            ┌──────────────────────────────────────┐
            │  Collector (Fluent Bit / Vector /    │
            │   OpenTelemetry Collector)           │
            │                                      │
            │  • parse                             │
            │  • enrich (pod, host, cluster, env)  │
            │  • redact (regex backstop)           │
            │  • sample (per-status, per-tenant)   │
            │  • batch                             │
            │  • disk-backed buffer  ◄─── outage   │
            │                            ride-out  │
            └─────────┬─────────┬──────────┬───────┘
                      │         │          │
              ┌───────▼───┐ ┌───▼────┐ ┌───▼──────┐
              │ Hot index │ │ Cold   │ │  SIEM    │
              │ Loki/ELK/ │ │ S3/GCS │ │  Splunk  │
              │ Datadog   │ │ 1y+    │ │  ES      │
              │ 7-30d     │ │ archive│ │  audit   │
              └───────────┘ └────────┘ └──────────┘
                  ▲              ▲           ▲
                  │              │           │
              on-call       compliance   security
              engineers     auditors     team
```

### Where Data Can Be Lost (and How to Plug Each Hole)

```text
   App ──X1── Collector ──X2── Transport ──X3── Backend ──X4── Query

   X1: app crashes before stdout flushes              → unbuffered stdout
   X2: collector crashes before sending               → disk-backed buffer
   X3: network partition; backend rejects on quota    → retries + backoff + DLQ
   X4: index rejects field; line dropped silently     → schema validation + DLQ
```

### Correlation Web Across Three Services

```text
           ┌────────── trace_id = abc123 ──────────┐
           │                                       │
   ┌───────▼───────┐   HTTP   ┌──────────┐  gRPC  ┌▼──────────┐
   │ gateway       │ ───────► │ checkout │ ─────► │ payments  │
   │ log: trace_id │          │ log: ... │        │ log: ...  │
   └───────────────┘          └────┬─────┘        └────┬──────┘
                                   │ kafka              │ SQL
                                   ▼                    ▼
                              ┌────────┐         ┌─────────────┐
                              │ worker │         │ Postgres    │
                              │ log:   │         │ slow query  │
                              │ trace_ │         │ log:        │
                              │ id     │         │ /*trace*/   │
                              └────────┘         └─────────────┘

   Drill-down query in any backend:  trace_id=abc123  → full request story.
```

### The Sampling Decision Tree

```text
                            ┌──────────────┐
                            │ incoming     │
                            │ request      │
                            └──────┬───────┘
                                   ▼
                          ┌────────────────┐
                          │ tenant flagged │ ──── yes ─► keep 100% (DEBUG too)
                          │ for debug?     │
                          └──────┬─────────┘
                                 no
                                 ▼
                          ┌────────────────┐
                          │ status >= 500? │ ──── yes ─► keep 100%
                          └──────┬─────────┘
                                 no
                                 ▼
                          ┌────────────────┐
                          │ status >= 400? │ ──── yes ─► keep 10%
                          └──────┬─────────┘
                                 no
                                 ▼
                          ┌────────────────┐
                          │ slow tail      │ ──── yes ─► keep 100%
                          │ (p99 latency)? │
                          └──────┬─────────┘
                                 no
                                 ▼
                              keep 1%
```

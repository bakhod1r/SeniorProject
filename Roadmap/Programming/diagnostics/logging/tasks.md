# Logging — Hands-On Exercises

> **Topic:** [Logging Roadmap](README.md)
> **Focus:** Practical exercises that move you from basic logger configuration to designing org-wide logging platforms.

---

Logging looks deceptively simple — call `log.info("hello")` and move on. But the moment your service goes to production, every decision you skipped becomes a 3 a.m. problem: the logs are too noisy to grep, the timestamps are in three different timezones, a credit-card number leaked into Splunk, and the bill from your log vendor doubled overnight. The exercises in this file walk you through every painful lesson in order, so you hit them on a laptop instead of in an incident channel.

The tasks are grouped by difficulty: **Warm-Up** is configuration muscle memory, **Core** is structured logging and context propagation, **Advanced** is sampling, redaction, and cost control, and **Capstone** is platform-level design. Each task names the language(s) where applicable; substitute your stack where the lesson translates. If you can complete every task here without notes, you have the full ladder — junior, middle, senior, professional.

---

## Table of Contents

1. [How to Use This File](#how-to-use-this-file)
2. [Warm-Up Tasks](#warm-up-tasks)
   - [Task 1: Convert print to a named logger](#task-1-convert-print-to-a-named-logger)
   - [Task 2: ISO 8601 UTC timestamps in slog](#task-2-iso-8601-utc-timestamps-in-slog)
   - [Task 3: Replace printStackTrace with logger.error](#task-3-replace-printstacktrace-with-loggererror)
   - [Task 4: SLF4J + Logback JSON to stdout](#task-4-slf4j--logback-json-to-stdout)
   - [Task 5: Suppress noisy third-party DEBUG](#task-5-suppress-noisy-third-party-debug)
   - [Task 6: Log levels by environment](#task-6-log-levels-by-environment)
   - [Task 7: Rotate a file log without losing lines](#task-7-rotate-a-file-log-without-losing-lines)
3. [Core Tasks](#core-tasks)
   - [Task 8: request_id middleware in Go](#task-8-request_id-middleware-in-go)
   - [Task 9: structlog contextvars in FastAPI](#task-9-structlog-contextvars-in-fastapi)
   - [Task 10: SLF4J MDC with cleanup](#task-10-slf4j-mdc-with-cleanup)
   - [Task 11: Email-address redaction filter](#task-11-email-address-redaction-filter)
   - [Task 12: Async Logback appender with discard](#task-12-async-logback-appender-with-discard)
   - [Task 13: Ship JSON logs to Loki via Vector](#task-13-ship-json-logs-to-loki-via-vector)
   - [Task 14: slog.LogValuer redaction in Go](#task-14-sloglogvaluer-redaction-in-go)
   - [Task 15: Hot-reload log level over HTTP](#task-15-hot-reload-log-level-over-http)
   - [Task 16: Rust tracing with JSON layer](#task-16-rust-tracing-with-json-layer)
   - [Task 17: Per-package level overrides](#task-17-per-package-level-overrides)
4. [Advanced Tasks](#advanced-tasks)
   - [Task 18: Tail-based sampling, keep ERROR](#task-18-tail-based-sampling-keep-error)
   - [Task 19: OTel trace_id / span_id in every log line](#task-19-otel-trace_id--span_id-in-every-log-line)
   - [Task 20: Collector-layer PII redaction pipeline](#task-20-collector-layer-pii-redaction-pipeline)
   - [Task 21: Cost cut — halve a 50GB/day service](#task-21-cost-cut--halve-a-50gbday-service)
   - [Task 22: Per-customer diagnostic mode](#task-22-per-customer-diagnostic-mode)
   - [Task 23: Legacy text-log migration with no downtime](#task-23-legacy-text-log-migration-with-no-downtime)
   - [Task 24: Cardinality budget enforcement](#task-24-cardinality-budget-enforcement)
5. [Capstone Tasks](#capstone-tasks)
   - [Task 25: Design an org-wide logging library](#task-25-design-an-org-wide-logging-library)
   - [Task 26: Audit 24h of real service logs](#task-26-audit-24h-of-real-service-logs)
   - [Task 27: HIPAA-grade audit log](#task-27-hipaa-grade-audit-log)
   - [Task 28: Write a "how we log" policy](#task-28-write-a-how-we-log-policy)
6. [Closing](#closing)
7. [Related Topics](#related-topics)

---

## How to Use This File

Work the tasks in order. The Warm-Up tasks are 15-minute drills you can knock out before lunch; Core tasks are 30-90 minute exercises that produce code you might keep; Advanced tasks should take an afternoon each; Capstone tasks are multi-day projects suitable for portfolio work or interview prep. After each task you will find either a `Self-check` list or, for Capstone, a "What 'done' looks like" paragraph. Sample solutions are provided for four representative tasks; for the rest, write the code yourself and verify against the self-check.

---

## Warm-Up Tasks

### Task 1: Convert print to a named logger

**Problem.** You inherit a Python ETL script with 47 `print(...)` calls. Replace them with a properly configured `logging` logger, named after the module, emitting at INFO level by default. The default Python root logger should **not** receive your records — your module logger should have its own handler.

**Constraints.**
- Use `logging.getLogger(__name__)`, not the root logger.
- Output format: `%(asctime)s %(levelname)s %(name)s - %(message)s`.
- The level must be configurable from an environment variable `LOG_LEVEL`, defaulting to `INFO`.
- Do not call `logging.basicConfig` — configure your handler explicitly.

**Hints.**
- `logger.setLevel(...)` controls what the logger forwards; the handler also has a level.
- Use `logger.propagate = False` to keep records off the root logger.
- `os.getenv("LOG_LEVEL", "INFO").upper()` is enough for the env lookup.

**Self-check.**
- [ ] Running with `LOG_LEVEL=DEBUG python script.py` shows DEBUG lines.
- [ ] Running with `LOG_LEVEL=WARNING` hides INFO lines.
- [ ] No duplicate log lines from the root logger.
- [ ] Logger name in output matches the module path, not `root`.

---

### Task 2: ISO 8601 UTC timestamps in slog

**Problem.** A Go service uses `log/slog` with the default `TextHandler`. Its timestamps look like `2026/05/29 14:33:12` in local time, which makes correlating with other services impossible. Reconfigure the handler to emit ISO 8601 UTC timestamps in the `time` field, with millisecond precision.

**Constraints.**
- Use `slog.HandlerOptions.ReplaceAttr`.
- Format must be `2006-01-02T15:04:05.000Z`.
- All other attributes must pass through unchanged.

**Hints.**
- `ReplaceAttr` lets you intercept the `slog.TimeKey` attr.
- `t.UTC().Format(...)` builds the string.

**Sample Solution.**

```go
package main

import (
	"log/slog"
	"os"
	"time"
)

func main() {
	h := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				t := a.Value.Time().UTC()
				return slog.String(slog.TimeKey, t.Format("2006-01-02T15:04:05.000Z"))
			}
			return a
		},
	})
	slog.SetDefault(slog.New(h))
	slog.Info("service started", "port", 8080)
}
```

**Self-check.**
- [ ] Output contains `time=2026-05-29T14:33:12.847Z` style timestamps.
- [ ] Timezone is always `Z`, regardless of `TZ` env var.
- [ ] Other attributes (e.g. `port=8080`) still appear.

---

### Task 3: Replace printStackTrace with logger.error

**Problem.** A Java service has 200+ `catch` blocks that call `e.printStackTrace()`, writing stack traces straight to stderr with no context. Replace each one with `logger.error("...", e)` using SLF4J. Stack traces must still be visible, but now they should be attached to a log record with a message and the logger's name.

**Constraints.**
- Use SLF4J `Logger logger = LoggerFactory.getLogger(MyClass.class);`.
- The message must be a meaningful sentence — never `"error"` or `"exception"`.
- The exception goes as the **last** argument, not interpolated into the message.

**Hints.**
- Bad: `logger.error("error: " + e.getMessage());` — loses the stack trace.
- Good: `logger.error("failed to charge customer {} for invoice {}", customerId, invoiceId, e);`.

**Self-check.**
- [ ] No remaining `printStackTrace()` calls (verify with `grep`).
- [ ] Every `logger.error` call has a descriptive message.
- [ ] The exception is the trailing argument so SLF4J prints the stack trace.

---

### Task 4: SLF4J + Logback JSON to stdout

**Problem.** Configure a Spring Boot service to emit one JSON object per log line on stdout, suitable for direct ingestion by Loki / Elastic / Datadog. No file output, no rolling appenders.

**Constraints.**
- Use `logstash-logback-encoder`.
- Each record must include: `@timestamp` (ISO 8601 UTC), `level`, `logger_name`, `thread_name`, `message`, and any MDC keys.
- Stack traces must be inline in the JSON, not on separate lines.

**Hints.**
- `<encoder class="net.logstash.logback.encoder.LogstashEncoder"/>`.
- Configure `<timeZone>UTC</timeZone>` on the encoder.

**Self-check.**
- [ ] `docker logs <container>` produces parseable JSON, one object per line.
- [ ] `jq '.level'` works on the stream.
- [ ] An MDC key set in code appears as a top-level JSON field.

---

### Task 5: Suppress noisy third-party DEBUG

**Problem.** A Python service uses `urllib3` and `botocore`, both of which spam DEBUG lines that drown out your own logs even when you run at DEBUG. Configure logging so **your** modules log at DEBUG but those two libraries log at WARNING only.

**Constraints.**
- Solve it in code, not via env vars.
- Do not set the root logger level higher than DEBUG — you still want your own DEBUG visible.

**Hints.**
- `logging.getLogger("urllib3").setLevel(logging.WARNING)`.
- Logger names are hierarchical: setting `botocore` covers `botocore.endpoint` etc.

**Self-check.**
- [ ] Your module's DEBUG lines appear.
- [ ] No `urllib3.connectionpool` DEBUG noise.
- [ ] An ERROR from `botocore` still appears.

---

### Task 6: Log levels by environment

**Problem.** A Go service is deployed to `dev`, `staging`, and `prod`. Logs should be DEBUG in dev, INFO in staging, WARN in prod by default, but each environment must allow an override via `LOG_LEVEL`. Implement the bootstrap function.

**Constraints.**
- One function: `func newLogger(env string) *slog.Logger`.
- Unknown env or invalid `LOG_LEVEL` value must fall back to INFO and log a warning about the fallback.

**Hints.**
- `slog.LevelVar` lets you change the level dynamically later (useful for Task 15).
- Parse `LOG_LEVEL` case-insensitively.

**Self-check.**
- [ ] Default behavior per env matches the spec.
- [ ] `LOG_LEVEL=ERROR` overrides regardless of env.
- [ ] Invalid `LOG_LEVEL=GARBAGE` still starts the service, logs a warning, uses INFO.

---

### Task 7: Rotate a file log without losing lines

**Problem.** A Python service writes logs to `/var/log/myservice/app.log`. Operations want daily rotation with 14-day retention. Configure it so no log lines are dropped during the rotation, and rotated files are gzipped.

**Constraints.**
- Use `logging.handlers.TimedRotatingFileHandler` (or `concurrent-log-handler` if multi-process).
- Rotation time: midnight UTC.
- Backup count: 14.
- Rotated files end in `.gz`.

**Hints.**
- Subclass to add gzip in `doRollover`, or use a postrotate hook.
- For multi-process workers (gunicorn, uvicorn), the stdlib handler is **not** safe — you'll race.

**Self-check.**
- [ ] After rotation, the active log file is empty and a new dated `.gz` exists.
- [ ] No `IOError` or torn lines under load (test with `ab` or a tight loop).
- [ ] Old files past 14 days are deleted.

---

## Core Tasks

### Task 8: request_id middleware in Go

**Problem.** Build a `net/http` middleware that generates a `request_id` (UUID v7) for each incoming request, binds it to a child `*slog.Logger` stored in `context.Context`, and logs `request.start` and `request.finish` events. Downstream handlers retrieve the logger via a `LoggerFromContext` helper.

**Constraints.**
- The same `request_id` must appear on the start and finish lines for one request.
- The finish line must include `status`, `duration_ms`, `bytes_written`.
- If the client sends `X-Request-ID`, reuse it; otherwise generate one.
- Use `slog.With(...)` to derive the child logger.

**Hints.**
- Wrap `http.ResponseWriter` to capture status and bytes.
- Use a private context key type to avoid collisions.

**Sample Solution.**

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type ctxKey struct{}

func LoggerFromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

type respRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *respRecorder) WriteHeader(s int)        { r.status = s; r.ResponseWriter.WriteHeader(s) }
func (r *respRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func RequestLogger(base *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rid := r.Header.Get("X-Request-ID")
			if rid == "" {
				rid = uuid.Must(uuid.NewV7()).String()
			}
			lg := base.With("request_id", rid, "method", r.Method, "path", r.URL.Path)
			ctx := context.WithValue(r.Context(), ctxKey{}, lg)

			rec := &respRecorder{ResponseWriter: w, status: 200}
			start := time.Now()
			lg.Info("request.start")
			next.ServeHTTP(rec, r.WithContext(ctx))
			lg.Info("request.finish",
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"bytes_written", rec.bytes,
			)
		})
	}
}
```

**Self-check.**
- [ ] `request.start` and `request.finish` share a `request_id`.
- [ ] Client-supplied `X-Request-ID` is preserved verbatim.
- [ ] A handler that calls `LoggerFromContext(r.Context()).Info(...)` produces a line with the same `request_id`.
- [ ] `bytes_written` reflects the response size correctly even when handlers call `Write` multiple times.

---

### Task 9: structlog contextvars in FastAPI

**Problem.** In a FastAPI service, propagate `user_id` and `request_id` through `structlog.contextvars` so every log line — including those emitted inside background tasks, dependency callables, and exception handlers — automatically includes both fields.

**Constraints.**
- Use `structlog.contextvars.bind_contextvars` and `clear_contextvars`.
- A middleware sets `request_id`; an auth dependency adds `user_id` after authentication.
- Clear the contextvars at the end of every request, even on exceptions.

**Hints.**
- `clear_contextvars` in middleware `finally`.
- structlog's `merge_contextvars` processor must be first in the chain.

**Self-check.**
- [ ] An anonymous request shows `request_id` only.
- [ ] An authenticated request shows both fields, including in logs from `BackgroundTasks`.
- [ ] Concurrent requests do not bleed each other's `user_id` (test with two requests in parallel).

---

### Task 10: SLF4J MDC with cleanup

**Problem.** Implement a servlet `Filter` (or Spring `OncePerRequestFilter`) that puts `request_id` and `tenant_id` into SLF4J MDC at the start of each request and clears them in `finally`. Verify that under a thread pool, no values leak between requests.

**Constraints.**
- `MDC.put(...)` at the top.
- `MDC.clear()` (or per-key `remove`) in `finally`.
- Include a log statement in the filter chain that proves MDC is set.

**Hints.**
- Thread pools reuse threads — that is exactly why cleanup matters.
- For async dispatch (Servlet 3.0+), MDC propagation needs `MDCContext` from your async framework.

**Self-check.**
- [ ] Logs from a `@RestController` method include MDC values.
- [ ] Hammer the endpoint with 100 concurrent requests; no log line has the wrong `request_id`.
- [ ] A test that throws inside the controller still triggers cleanup.

---

### Task 11: Email-address redaction filter

**Problem.** Write a Python `logging.Filter` (or formatter) that scans every log record's message and arguments, replacing email addresses with `<email-redacted>`. Apply it globally so even third-party libraries can't leak emails.

**Constraints.**
- Match a reasonable subset of valid emails — RFC-perfect not required.
- Redact in both `record.msg` and `record.args` (for `%s` formatting).
- Performance: should add < 50 microseconds per log record on average.

**Hints.**
- Compile the regex once at module load.
- Walk `record.args` if it is a tuple or dict; mutate carefully.
- Test with `logger.info("user %s signed up", "alice@example.com")` — the email is in args, not msg.

**Sample Solution.**

```python
import logging
import re

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


class RedactEmails(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = EMAIL_RE.sub("<email-redacted>", record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: EMAIL_RE.sub("<email-redacted>", v) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
            else:
                record.args = tuple(
                    EMAIL_RE.sub("<email-redacted>", a) if isinstance(a, str) else a
                    for a in record.args
                )
        return True


def install():
    root = logging.getLogger()
    f = RedactEmails()
    for h in root.handlers:
        h.addFilter(f)
```

**Self-check.**
- [ ] `logger.info("contact alice@example.com")` emits `contact <email-redacted>`.
- [ ] `logger.info("user %s", "bob@x.com")` also redacts.
- [ ] A benchmark of 100k records shows < 50 us median overhead per record.
- [ ] Non-email `@`-containing strings (like `@username`) are left alone.

---

### Task 12: Async Logback appender with discard

**Problem.** A high-throughput Java service drops 5% of requests under load because synchronous file I/O on the logger blocks request threads. Wrap the existing `FILE` appender in Logback's `AsyncAppender` with a queue size of 8192 and a `discardingThreshold` of 20 (i.e. drop TRACE/DEBUG/INFO when the queue is 80% full, but always keep WARN/ERROR).

**Constraints.**
- Queue capacity: 8192.
- `discardingThreshold`: 20.
- Add a metric / log statement when discards happen so you can alert on it.

**Hints.**
- `<appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">`.
- `<neverBlock>true</neverBlock>` if you would rather drop than block under burst.

**Self-check.**
- [ ] Under a synthetic burst of 100k log lines, the request thread is no longer blocked on `write`.
- [ ] WARN / ERROR lines are preserved even when the queue is full.
- [ ] Discard count is observable (JMX, metric, or its own log line).

---

### Task 13: Ship JSON logs to Loki via Vector

**Problem.** Write a Vector (`vector.toml`) **or** Fluent Bit configuration snippet that tails Docker container stdout, parses JSON lines, attaches `service`, `env`, and `pod` labels, and ships to a Loki endpoint. Drop lines with `level == "debug"` in production.

**Constraints.**
- Use a parsing stage that fails closed (lines that aren't JSON go to a `parse_failed` route, not the main pipeline).
- Apply the prod-only debug drop with a transform that reads `env` from an env var.
- Backpressure: buffer to disk if Loki is unreachable for up to 1 hour.

**Hints.**
- Vector: `transforms.parse_json`, `transforms.filter`, `sinks.loki`.
- Fluent Bit: `[FILTER] Name parser`, `[FILTER] Name grep`.
- `labels` in Loki sink should be **low-cardinality** — never put `request_id` there.

**Self-check.**
- [ ] Valid JSON lines arrive in Loki with three labels.
- [ ] Malformed lines are routed to a dead-letter file instead of crashing the pipeline.
- [ ] When Loki is down for 10 minutes, no lines are lost on restart.

---

### Task 14: slog.LogValuer redaction in Go

**Problem.** Implement `slog.LogValuer` on a `Credentials` struct so that whenever the struct is logged, the `Password` and `APIKey` fields are emitted as `<redacted>`, but the `Username` and `CreatedAt` fields pass through normally.

**Constraints.**
- Implement `LogValue() slog.Value` on `Credentials`.
- The redacted fields must never appear in the output, not even truncated.
- Add a test that fails if a future field is added without an explicit choice (use an allow-list, not a deny-list).

**Hints.**
- `slog.GroupValue(slog.String(...), ...)` lets you construct the replacement value.
- A linter or test that reflects over the struct and asserts each field is covered prevents accidental leaks.

**Sample Solution.**

```go
package creds

import (
	"log/slog"
	"time"
)

type Credentials struct {
	Username  string
	Password  string
	APIKey    string
	CreatedAt time.Time
}

func (c Credentials) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("username", c.Username),
		slog.String("password", "<redacted>"),
		slog.String("api_key", "<redacted>"),
		slog.Time("created_at", c.CreatedAt),
	)
}
```

**Self-check.**
- [ ] `slog.Info("login", "creds", c)` prints `<redacted>` for both secret fields.
- [ ] No test can construct a log line containing the real password.
- [ ] Adding a new field `Salt string` to the struct fails the coverage test until handled.

---

### Task 15: Hot-reload log level over HTTP

**Problem.** Expose an admin endpoint `POST /admin/log-level` that accepts a JSON body `{"level": "debug"}` and immediately changes the global log level without a restart. The endpoint must be authenticated (any scheme — for the exercise, a static bearer token from env).

**Constraints.**
- Use `slog.LevelVar` (or equivalent) so the change is atomic and lock-free.
- Reject unknown levels with 400.
- Emit a log line when the level changes so the change is auditable.

**Hints.**
- `var lvl = new(slog.LevelVar)`; pass `&slog.HandlerOptions{Level: lvl}` once.
- `lvl.Set(slog.LevelDebug)` from the handler.

**Self-check.**
- [ ] DEBUG lines start appearing immediately after the POST.
- [ ] Bad token returns 401.
- [ ] Bad level returns 400 and does not change anything.
- [ ] The change itself produces a log line at INFO including the previous and new level.

---

### Task 16: Rust tracing with JSON layer

**Problem.** Set up a Rust service using `tracing` + `tracing-subscriber` to emit JSON logs to stdout with span context. Each `info!` inside a `#[instrument]`-decorated function should include the span name and its fields.

**Constraints.**
- Use `tracing-subscriber::fmt().json()`.
- Filter level controlled by `RUST_LOG` env var, defaulting to `info`.
- `tower_http::trace::TraceLayer` (if you're using axum) should reuse the same subscriber.

**Hints.**
- `EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))`.
- `fmt::layer().json().with_current_span(true).with_span_list(false)`.

**Self-check.**
- [ ] One JSON object per line on stdout.
- [ ] `RUST_LOG=debug,hyper=warn cargo run` works as expected.
- [ ] A function annotated with `#[instrument(fields(user_id = %uid))]` emits `user_id` on every log line inside it.

---

### Task 17: Per-package level overrides

**Problem.** Configure a Java service so the root logger is INFO, but `com.example.payments` is DEBUG and `org.hibernate.SQL` is TRACE — all without code changes (XML / properties only).

**Constraints.**
- Use `logback-spring.xml` (or `logback.xml`).
- Levels must be overridable by `LOG_LEVEL_COM_EXAMPLE_PAYMENTS` env var at boot.

**Hints.**
- `<logger name="com.example.payments" level="${...:-DEBUG}"/>`.
- Logback supports env var substitution with `${VAR:-default}`.

**Self-check.**
- [ ] Default boot: root=INFO, payments=DEBUG, hibernate.SQL=TRACE.
- [ ] `LOG_LEVEL_COM_EXAMPLE_PAYMENTS=WARN` overrides at startup.
- [ ] No code recompile needed for any of this.

---

## Advanced Tasks

### Task 18: Tail-based sampling, keep ERROR

**Problem.** Implement a logging pipeline (app + collector) that uses **tail-based** sampling: a request's logs are buffered until the request completes; if any log line in the request was ERROR or the response was 5xx, **all** lines for that request are kept; otherwise sample 1% uniformly.

**Constraints.**
- Sampling decision is per-request (per-trace), not per-line.
- Implement either in-app (buffer in a slice keyed by request_id) or in the OTel Collector's `tail_sampling` processor — your choice, justify it.
- The 1% sample must be deterministic given the request_id (so retries land the same way).

**Hints.**
- In-app buffering risks OOM if buffers leak — cap each buffer to e.g. 200 lines.
- For the deterministic 1%: `fnv32(request_id) % 100 == 0`.

**Self-check.**
- [ ] A request that triggers an exception has every one of its log lines retained.
- [ ] A clean request has its log lines retained with ~1% probability.
- [ ] The decision is the same across retries of the same request_id.
- [ ] Memory usage is bounded under load.

---

### Task 19: OTel trace_id / span_id in every log line

**Problem.** A Python FastAPI service uses OpenTelemetry for tracing. Wire it so every log line — emitted by structlog or stdlib `logging` — automatically includes `trace_id` and `span_id` of the currently-active span, in hex form matching W3C Trace Context.

**Constraints.**
- Use `opentelemetry.trace.get_current_span().get_span_context()`.
- If there is no active span, emit `trace_id: "0".rjust(32, "0")` and `span_id: "0".rjust(16, "0")` — or omit, but be consistent.
- Works for both async and sync code paths.

**Hints.**
- For structlog: write a processor that reads the current span and merges the IDs.
- For stdlib: use a `logging.Filter` that mutates the record.

**Self-check.**
- [ ] A log line emitted from inside an `@app.get(...)` handler has the same `trace_id` as the OTel span exported to Jaeger/Tempo.
- [ ] A line emitted before any span starts uses the no-span fallback.
- [ ] IDs are hex-encoded with the right length (32 and 16).

---

### Task 20: Collector-layer PII redaction pipeline

**Problem.** Today, every service in your org has its own redaction filter, all slightly different and all incomplete. Redesign so redaction happens once, at the collector (Vector / OTel Collector / Fluent Bit), with a single shared rule set. Migrate three pilot services to the new pipeline and prove no PII reaches storage.

**Constraints.**
- A single config file owns all redaction rules.
- Rules must catch: emails, US SSNs, credit card numbers (Luhn-valid), JWT tokens, AWS access key IDs.
- The pipeline must fail closed: if redaction crashes, the line is dropped with a counter incremented, not forwarded raw.
- Provide a test harness that injects synthetic PII into stdin and asserts none reaches the sink.

**Hints.**
- Vector's `remap` transform with VRL is concise for this.
- For credit cards, regex catches the format; a follow-up VRL function applies Luhn.

**Self-check.**
- [ ] All five PII categories are stripped in the synthetic test.
- [ ] A misconfigured rule causes the line to drop, not pass through.
- [ ] The shared config is version-controlled and reviewable.
- [ ] Three pilot services run for 24h with zero PII findings in storage (sample 1000 lines, manually inspect).

---

### Task 21: Cost cut — halve a 50GB/day service

**Problem.** A service emits 50 GB/day of logs, costing $4500/month. You have one week. Halve the volume without losing diagnostic value (i.e. you must still be able to debug an incident with what remains).

**Constraints.**
- Produce a written before/after report: which categories of log lines were cut, by how much, and why each cut was safe.
- The "save 50%" target is for steady-state volume; incident-mode (per Task 22) is exempt.
- No silent dropping — every cut is documented.

**Hints.**
- Top three killers in practice: per-request DEBUG noise, repeated identical errors (fingerprint and rate-limit), and overly verbose stack traces (deduplicate frames).
- Tail-based sampling (Task 18) is your friend.
- Convert "log every event" patterns to metrics where possible.

**Self-check.**
- [ ] Measured baseline volume (with units, time window).
- [ ] Measured post-change volume showing >= 50% reduction.
- [ ] At least 3 distinct mechanisms used (sampling, dedup, metric-conversion, level-downgrade, etc.).
- [ ] A peer review approves that incident-debugging is still possible with the new log stream.

---

### Task 22: Per-customer diagnostic mode

**Problem.** Build a system where a customer who sends `X-Debug: <signed-token>` on a request gets DEBUG-level logs for that request only, while every other customer continues to see INFO. The token must be cryptographically signed so customers can't enable debug for themselves.

**Constraints.**
- Token: short-lived (5 min), HMAC-signed, bound to the customer ID.
- Per-request override implemented via context-scoped logger, not by mutating the global level.
- An auditable log line is emitted whenever debug mode is activated, including who signed the token.

**Hints.**
- For Go: a per-request `*slog.Logger` with its own `LevelVar` set to DEBUG, stored in the request context.
- For Python: a contextvar carrying the effective level, read by a filter.

**Self-check.**
- [ ] A request with a valid token produces DEBUG lines.
- [ ] A request without the token, or with a forged one, produces only INFO.
- [ ] Concurrent debug and non-debug requests do not contaminate each other.
- [ ] Activation is auditable.

---

### Task 23: Legacy text-log migration with no downtime

**Problem.** A 15-year-old service emits plain-text logs that downstream alerts grep for specific phrases. You need to migrate it to structured JSON without breaking the alerts. Design the rollout.

**Constraints.**
- During migration, **both** formats must be produced for a defined window.
- Alerts that depend on text patterns must be ported to query the structured field equivalents before old format is turned off.
- The cutover plan must be reversible — you can revert in < 5 minutes if alerts misbehave.

**Hints.**
- Dual-write: emit text to stderr and JSON to stdout, ship both for the migration window.
- Track which alerts have been ported; a checklist is appropriate.
- Feature-flag the old emitter so you can toggle without redeploy.

**Self-check.**
- [ ] Dual-write is implemented and verified by tailing both streams.
- [ ] Every legacy alert has a JSON-shaped equivalent and a comparison test showing they fire on the same events.
- [ ] A "revert" runbook is written and rehearsed.

---

### Task 24: Cardinality budget enforcement

**Problem.** Your structured logs are creating an indexing nightmare in Elastic — somebody added `user_id` and `request_id` as indexed fields and cardinality blew up. Design and implement a "cardinality budget": each field gets a max number of distinct values per day, and anything above that is bucketed or dropped from the index (but kept in raw storage).

**Constraints.**
- Budget enforced at the collector layer, not in app code.
- High-cardinality fields are still queryable in raw storage; they just aren't indexed.
- Operators can adjust the budget per-field via config.

**Hints.**
- A streaming HyperLogLog estimator gives you a distinct-count cheaply.
- "Bucketing" might mean: hash to one of N buckets above threshold.

**Self-check.**
- [ ] A field with > budget cardinality stops being indexed; raw storage still works.
- [ ] Operators can change the budget without code changes.
- [ ] A dashboard shows which fields are near or over budget.

---

## Capstone Tasks

### Task 25: Design an org-wide logging library

**Problem.** You are tech lead for a platform team supporting 50 services across Go, Python, and Java. Design and implement a logging library (or pair of libraries with a shared spec) that every service must use. The library must enforce a schema of mandatory fields, default sampling rules, automatic PII redaction, OpenTelemetry export, and pluggable per-service customization. Include code, a spec document, an adoption rollout plan, and a deprecation path for the existing zoo of loggers.

**What 'done' looks like.** A repository containing: (1) a written schema spec — every log record has `timestamp`, `level`, `message`, `service`, `env`, `trace_id`, `span_id`, plus per-domain extensions; (2) a Go module, a Python package, and a Java artifact, each implementing the spec on top of `slog`, `structlog`, and `logback` respectively, with feature parity validated by a cross-language conformance test suite; (3) a redaction layer that catches the standard PII categories from Task 20 by default; (4) default sampling policies (1% INFO under load, 100% WARN/ERROR), overridable per-service; (5) an OTLP export path so logs flow to the same backend as traces; (6) a written migration guide showing how a service moves from raw `log.Printf` / `print` / `slf4j` to the new library; (7) an adoption tracker with at least 5 pilot services on board; (8) a deprecation timeline for the legacy zoo with a concrete sunset date. The library is reviewed by at least two senior engineers from outside the platform team.

---

### Task 26: Audit 24h of real service logs

**Problem.** Given a sample log file representing 24 hours of production traffic from a real service (provided as `samples/audit-input.jsonl`), perform a structured audit and produce 10 specific, ranked improvements. Each finding must cite log lines as evidence.

**Sample input fragments** (the kind of issues you should be hunting):

```text
2026-05-29T03:14:22Z INFO payment processed successfully for user alice@example.com
2026-05-29T03:14:22.001Z INFO payment processed successfully for user alice@example.com
2026-05-29T03:14:22.002Z INFO payment processed successfully for user alice@example.com
2026-05-29T03:14:23Z ERROR java.lang.NullPointerException
2026-05-29T03:14:23Z DEBUG entering method handleRequest
2026-05-29T03:14:23Z INFO request from 192.168.1.42 with body {"password":"hunter2"}
```

**What 'done' looks like.** A written report containing exactly 10 ranked findings. Each finding has: a name, a severity (critical / high / medium / low), 1-3 quoted log lines as evidence, a root-cause explanation, a concrete fix (with code or config snippet), and an estimated effort. Categories to look for: duplicate / chatty log lines, missing context (no request_id), PII leaks, unhelpful messages ("error" with no detail), wrong log levels (DEBUG that should be TRACE, ERROR that should be WARN), missing structured fields, timezone inconsistencies, stack-trace explosions, cardinality bombs, and metric-shaped lines that should be metrics. The report ends with a "what to fix first this sprint" summary and a stretch list for the next quarter.

---

### Task 27: HIPAA-grade audit log

**Problem.** Design and implement an audit log for a healthcare application that must satisfy HIPAA requirements: every access to PHI (Protected Health Information) is logged, the log is immutable, retention is 6 years, the audit log itself is accessed only by audited principals, and there is a query interface auditors can use without leaking PHI.

**What 'done' looks like.** A working implementation containing: (1) an audit-event schema with `actor`, `actor_type`, `action`, `resource_type`, `resource_id`, `phi_categories[]`, `timestamp`, `request_id`, `client_ip`, `outcome` — but no actual PHI values, only references; (2) a write path that signs each event with HMAC over the previous event's hash (a hash chain), so tampering is detectable; (3) a separate `audit_access_log` that records every read of the primary audit log — and is itself signed; (4) storage with WORM (Write Once Read Many) semantics — object storage with object-lock, or a database with revoked UPDATE / DELETE grants on the audit table; (5) a 6-year retention policy enforced by storage lifecycle rules; (6) a query interface that returns only metadata (counts, actor patterns) by default, with a "deep dive" mode that requires a second authenticated approval; (7) a test demonstrating that a tampered event is detected; (8) a documented threat model covering the question "what does an insider with database access need to bypass to forge events?"

---

### Task 28: Write a "how we log" policy

**Problem.** Write a policy document, suitable for onboarding a team of 30 engineers, covering when to log, what to log, what not to log, log levels, structured field naming, redaction expectations, and how logs are reviewed in code review. The policy must be opinionated — every section makes a recommendation, not "consider".

**What 'done' looks like.** A policy document (target 8-15 pages) containing: (1) a 1-page TL;DR for engineers in a hurry; (2) a section on log levels with explicit rules ("use ERROR only when a human needs to be paged"); (3) a structured-field naming convention with at least 30 canonical names ("user_id" not "userId" or "user"); (4) an explicit "never log" list (passwords, full credit-card numbers, raw cookies, full SQL with parameters, request bodies of auth endpoints); (5) a sampling and rate-limit policy by level; (6) a redaction policy mapping each PII category to a library function; (7) a code review rubric — a numbered list reviewers can apply to any PR ("does every new log have a request_id in context?"); (8) examples of good and bad log lines, side by side; (9) an escalation path when an engineer disagrees with the policy; (10) a versioning and change-log section so the policy can evolve. The document is reviewed and approved by a senior engineer, an SRE, and a security engineer.

---

## Closing

If you can complete every Warm-Up and Core task without notes, you have the **middle level** — you can build a logging stack for a single service. If you can also work the Advanced tasks, you have the **senior level** — you can run logging for a team. If you can ship the Capstone tasks and they survive contact with real users, you have the **professional level** — you can run logging for an org.

The hardest part of logging is not the syntax; it is the discipline of treating logs as a product with users (engineers in incidents), constraints (cost, cardinality, compliance), and SLOs (signal-to-noise, freshness, retention). The exercises above are not busywork — every one of them corresponds to a real production incident or design review that has happened, will happen, and will happen to you.

---

## Related Topics

- [Logging — Junior](junior.md)
- [Logging — Middle](middle.md)
- [Logging — Senior](senior.md)
- [Logging — Professional](professional.md)
- [Logging — Interview](interview.md)
- [Logging — README](README.md)
- Sibling diagnostics topics: [Error Handling](../error-handling/README.md), [Debugging](../debugging/README.md)
- Clean-code cousin: [Error Handling in Clean Code](../../code-craft/clean-code/06-error-handling/README.md)

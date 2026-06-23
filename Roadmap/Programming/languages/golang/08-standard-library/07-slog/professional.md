# 8.7 `log/slog` — Professional

> **Audience.** You've shipped services that emit structured logs and
> you've watched them misbehave under load — slow remote sinks, full
> disks, mid-rotation gaps, or 100× the expected log volume on an
> incident. This file is the production playbook: rotation integration,
> sampling, multi-destination fan-out, kubectl-friendly output, and
> the patterns that keep `slog` invisible until you need it.

## 1. Output destinations and the writer below the handler

A `slog.Handler` writes to an `io.Writer`. The writer choice determines
every operational property: durability, latency, blocking behavior,
rotation. See
[`../01-io-and-file-handling/professional.md`](../01-io-and-file-handling/professional.md)
for the full writer toolkit. Common production wirings:

| Destination | Writer | Notes |
|-------------|--------|-------|
| stderr | `os.Stderr` | The right default for containerized services; the orchestrator captures it |
| stdout | `os.Stdout` | Same as stderr but conflicts with apps that print to stdout |
| Local rotated file | `lumberjack.Logger` (or similar) | Use when there's no log shipper |
| Buffered file | `bufio.Writer` over `*os.File` | Throughput at the cost of crash-window losses |
| TCP/UDP syslog | Custom handler with retry | Rarely the right choice; better to ship JSON to stderr and let the collector handle transport |
| HTTP push (e.g., Loki) | Custom handler with batching and circuit breaker | When direct push is required; batch every 1s or 1MB |

For a service running under Kubernetes, write JSON to stderr. The
container runtime captures it, the Fluent Bit / Vector / Promtail
sidecar parses it, and your aggregator indexes it. Anything else adds
moving parts that fail on their own schedule.

## 2. Log rotation that doesn't lose lines

The standard library doesn't ship a rotating writer. Two options:

1. **Don't rotate in-process.** Write to stderr, let the platform
   (`logrotate`, journald, k8s log driver) rotate. Most of the time
   this is right.
2. **Rotate in-process** with `gopkg.in/natefinch/lumberjack.v2` (or
   similar). Configure size, age, and backup count.

Lumberjack wires in like any `io.Writer`:

```go
import "gopkg.in/natefinch/lumberjack.v2"

w := &lumberjack.Logger{
    Filename:   "/var/log/myservice/app.log",
    MaxSize:    100, // MiB
    MaxBackups: 5,
    MaxAge:     30, // days
    Compress:   true,
}
slog.SetDefault(slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo})))
```

The cross-cutting concern: Lumberjack rotates on `Write` size, not on
time, and it's not concurrent-safe across processes. For multi-process
log files, use `O_APPEND` writes (atomic per-record up to `PIPE_BUF`)
and let the OS coordinate. See
[`../01-io-and-file-handling/professional.md`](../01-io-and-file-handling/professional.md)
section 11 for the gory details on `move-and-reopen` vs `copy-truncate`.

## 3. Two destinations: dev console + production sink

A common pattern: structured JSON to the production sink and
human-readable text to the developer console. Build a `fanout` handler
(see [middle.md](middle.md) section 12 for the full implementation)
that holds a slice of handlers and forwards `Handle` to each via
`r.Clone()`.

```go
console := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})
file    := slog.NewJSONHandler(rotatingWriter, &slog.HandlerOptions{Level: slog.LevelInfo})
slog.SetDefault(slog.New(newFanout(console, file)))
```

The console gets every level; the JSON file gets INFO and above. Each
destination has its own level threshold. `r.Clone()` is mandatory:
`Handle` may mutate the record (a wrapper that injects context
attributes does), and the next handler must see a clean copy.

## 4. Source location only at WARN+

`AddSource: true` adds ~1 µs per record (see [senior.md](senior.md)
section 7). For a service emitting 100K records/second, that's 10% of
a core spent on `runtime.CallersFrames`. Filter by level:

```go
type sourceForWarn struct {
    inner    slog.Handler
    withSrc  slog.Handler
}

func (s *sourceForWarn) Handle(ctx context.Context, r slog.Record) error {
    if r.Level >= slog.LevelWarn {
        return s.withSrc.Handle(ctx, r)
    }
    return s.inner.Handle(ctx, r)
}
```

Configure the two inner handlers identically except for `AddSource`.
Now WARN and ERROR carry source lines (which is when you actually want
them); INFO doesn't.

The trick is that you build two `JSONHandler`s over the same writer:
one with `AddSource: true`, one without. They share the underlying
`io.Writer` (and the writer's mutex), so output is still serial.

## 5. Sampling under burst

A high-RPS service emitting INFO per request can drown its log
aggregator on a traffic spike. A sampling handler keeps the volume
predictable:

```go
type sampler struct {
    inner slog.Handler
    rate  uint64    // emit 1 in every `rate`
    seen  atomic.Uint64
}

func (s *sampler) Handle(ctx context.Context, r slog.Record) error {
    if r.Level >= slog.LevelWarn {
        return s.inner.Handle(ctx, r) // never sample serious events
    }
    if s.seen.Add(1)%s.rate == 0 {
        r2 := r.Clone()
        r2.AddAttrs(slog.Bool("sampled", true), slog.Uint64("sample_rate", s.rate))
        return s.inner.Handle(ctx, r2)
    }
    return nil
}
```

Tag sampled records so downstream queries can scale up the count. A
WARN/ERROR is never dropped — those are the events you actually need.

For non-uniform sampling (every 10th INFO except on a "hot path" key
where you keep 1 in 1000), make the sample decision a function of the
record's attributes:

```go
func sampleRate(r slog.Record) uint64 {
    var path string
    r.Attrs(func(a slog.Attr) bool {
        if a.Key == "path" { path = a.Value.String(); return false }
        return true
    })
    switch path {
    case "/healthz":
        return 1000
    default:
        return 10
    }
}
```

`Record.Attrs` accepts a callback; returning `false` halts iteration.

## 6. Backpressure with a non-blocking handler

A handler that ships records to a remote endpoint (HTTP, syslog) can
block on the network. If `Handle` blocks, the goroutine that called
`Info` blocks. Under load, every request goroutine ends up waiting on
the log shipper.

The fix: a non-blocking queue. Submit records to a buffered channel; a
worker drains the channel and writes them out. When the channel fills,
drop records (and increment a counter so you know):

```go
type asyncHandler struct {
    inner    slog.Handler
    queue    chan slog.Record
    dropped  atomic.Uint64
}

func newAsync(inner slog.Handler, capacity int) *asyncHandler {
    a := &asyncHandler{inner: inner, queue: make(chan slog.Record, capacity)}
    go a.run()
    return a
}

func (a *asyncHandler) Handle(ctx context.Context, r slog.Record) error {
    select {
    case a.queue <- r.Clone():
    default:
        a.dropped.Add(1)
    }
    return nil
}

func (a *asyncHandler) run() {
    for r := range a.queue {
        _ = a.inner.Handle(context.Background(), r)
    }
}
```

A side goroutine periodically swaps `dropped` and emits a WARN with
the count. The trade-off: records in the queue at process exit are
lost — for a graceful shutdown, drain the queue on `os.Interrupt`
(close the channel, wait for the worker via `sync.WaitGroup`).

## 7. Dynamic level changes at runtime

`slog.LevelVar` exposes a thread-safe, settable `Level`. Wire it to a
debug HTTP endpoint and you flip verbosity in production without a
restart:

```go
var logLevel = new(slog.LevelVar)
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr,
    &slog.HandlerOptions{Level: logLevel})))

http.HandleFunc("/debug/loglevel", func(w http.ResponseWriter, r *http.Request) {
    var l slog.Level
    if err := l.UnmarshalText([]byte(r.URL.Query().Get("level"))); err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    logLevel.Set(l)
    slog.Info("log level changed", "to", l)
})
```

`curl localhost:6060/debug/loglevel?level=debug` flips the running
service to DEBUG. For multi-component services, keep one `LevelVar`
per component and let the endpoint accept a component name — most
production debugging is "I want one subsystem verbose without bumping
the whole service."

## 8. The HTTP middleware: request ID + trace propagation

A complete logging middleware that pulls the request ID and trace ID
from headers, attaches them to the context, and ensures every log call
inside the handler picks them up:

```go
type ctxKey int

const (
    reqIDKey ctxKey = iota
    traceCtxKey
)

func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reqID := r.Header.Get("X-Request-Id")
        if reqID == "" {
            reqID = newRequestID() // ULID, UUID, snowflake — your call
        }
        ctx := context.WithValue(r.Context(), reqIDKey, reqID)

        if tp := r.Header.Get("Traceparent"); tp != "" {
            ctx = context.WithValue(ctx, traceCtxKey, tp)
        }

        start := time.Now()
        rw := &statusRecorder{ResponseWriter: w, status: 200}
        next.ServeHTTP(rw, r.WithContext(ctx))

        slog.LogAttrs(ctx, slog.LevelInfo, "request handled",
            slog.String("method", r.Method),
            slog.String("path", r.URL.Path),
            slog.String("remote", r.RemoteAddr),
            slog.Int("status", rw.status),
            slog.Int64("elapsed_ms", time.Since(start).Milliseconds()),
        )
    })
}
```

A handler wrapper pulls the IDs out of the context and adds them to
every record:

```go
type ctxInjector struct {
    inner slog.Handler
}

func (h *ctxInjector) Handle(ctx context.Context, r slog.Record) error {
    if reqID, ok := ctx.Value(reqIDKey).(string); ok {
        r.AddAttrs(slog.String("req_id", reqID))
    }
    if tp, ok := ctx.Value(traceCtxKey).(string); ok {
        if traceID, spanID := parseTraceparent(tp); traceID != "" {
            r.AddAttrs(slog.String("trace_id", traceID), slog.String("span_id", spanID))
        }
    }
    return h.inner.Handle(ctx, r)
}
```

Wire it once at startup:

```go
slog.SetDefault(slog.New(&ctxInjector{
    inner: slog.NewJSONHandler(os.Stderr, opts),
}))
```

Now `slog.InfoContext(ctx, ...)` from any code path inside the request
emits records carrying `req_id`, `trace_id`, `span_id` without the
call site naming them. Open-trace-aware aggregators correlate these
records with the trace in your APM.

## 9. Integrating with OpenTelemetry

`slog` doesn't ship an OpenTelemetry bridge, but the integration is
mechanical. The `otelslog` package
(`go.opentelemetry.io/contrib/bridges/otelslog`) wraps a `slog.Handler`
to emit OTel log records, with trace context picked up from the
goroutine-bound OTel context:

```go
import "go.opentelemetry.io/contrib/bridges/otelslog"
slog.SetDefault(otelslog.NewLogger("my-service"))
```

For a more controlled integration, write your own ctxInjector that
pulls `trace.SpanContextFromContext(ctx)` and emits `trace_id` /
`span_id` directly.

## 10. Production defaults: a recommended baseline

A starter configuration for a new Go service:

```go
package logging

import (
    "context"
    "log/slog"
    "os"
)

var dynamicLevel = new(slog.LevelVar)

func Setup(envName string) {
    isProd := envName == "production"

    var base slog.Handler
    opts := &slog.HandlerOptions{
        Level:     dynamicLevel,
        AddSource: !isProd, // off in prod hot path; on in dev
    }
    if isProd {
        base = slog.NewJSONHandler(os.Stderr, opts)
    } else {
        base = slog.NewTextHandler(os.Stderr, opts)
    }
    slog.SetDefault(slog.New(&ctxInjector{inner: base}))
}

func SetLevel(l slog.Level) { dynamicLevel.Set(l) }
```

What this gives you:

- Production: JSON to stderr (capturable by k8s/journald), level
  `Info` by default but flippable via `SetLevel`, no source-line cost.
- Development: human-readable text with source lines, debug-friendly.
- Both: ambient request and trace IDs via `ctxInjector`.

What it does *not* give you:

- File rotation. Add Lumberjack if you can't rely on the platform.
- Sampling. Add the sampler from section 5 if RPS warrants it.
- Async shipping. Add the async handler from section 6 if a remote
  sink might block.

Add layers as you need them; don't pre-build a 200-line setup that
solves problems you don't have yet.

## 11. Observability of the logger itself

The logger is part of your service's data plane. Track it:

| Metric | Type | Use |
|--------|------|-----|
| `logs_emitted_total{level}` | counter | Volume per level; alert on sudden swings |
| `logs_dropped_total` | counter | Sampling drops + queue overflows |
| `log_handler_errors_total` | counter | `Handle` returned non-nil — destination is degraded |
| `log_queue_length` | gauge | Async handler queue depth — early warning of backpressure |
| `log_emit_duration_seconds` | histogram | If a handler blocks, this widens |

Wire these into `prometheus` (or whatever metrics library you use) at
the handler level. A wrapper handler that increments a counter on each
`Handle` is a few lines of code; the dashboard pays for itself the
first time the log shipper degrades.

## 12. Testing structured logs without coupling tests to format

Tests that grep raw log output break whenever you change the message
text. Test on structured fields via a capture handler that records
each `slog.Record` (deep-cloned) into a slice. See
[tasks.md](tasks.md) section 4 for the full implementation.

The capture handler is reusable across tests; asserting on attributes
makes tests stable against output-format changes — the JSON shape can
move around without breaking your tests.

## 13. Migrating a large codebase

For a service with thousands of `log.Println` calls, stage the
migration. First, redirect the global `log` package through `slog`:

```go
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, opts)))
log.SetOutput(slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo).Writer())
```

Now existing `log.Println` calls emit JSON — no call-site changes.
Then, in files you touch for other reasons, swap `log.Printf("user=%s
err=%v", u, err)` for `slog.Info("operation", "user", u, "err", err)`.
Don't go on a migration crusade; just change what you're already in.

A `sloglint` linter run in CI catches unpaired keys (`!BADKEY`) and
use of `log.Printf` in files where `slog` is already imported.

## 14. Audit logs vs operational logs

Two kinds of logs flow out of a service, and they have very different
durability requirements:

| Property | Operational | Audit |
|----------|-------------|-------|
| Volume | High (per request) | Low (per state-changing operation) |
| Loss tolerance | Drops are OK during sampling | Drops are unacceptable |
| Format | JSON, indexed | JSON, archive-grade (immutable) |
| Destination | Aggregator (Loki, ES) | Append-only file + offsite copy |
| Retention | Days–weeks | Years (regulatory) |

`slog` handles both, but the configuration differs. For audit:

- Custom level (e.g., `LevelAudit = LevelWarn + 2`).
- Dedicated handler — not multiplexed with operational records.
- Synchronous, with `Sync()` after each record (durability over
  throughput).
- Append-only file with `O_APPEND` for crash safety.

```go
type auditHandler struct {
    inner *slog.JSONHandler
    f     *os.File
}

func (h *auditHandler) Handle(ctx context.Context, r slog.Record) error {
    if err := h.inner.Handle(ctx, r); err != nil {
        return err
    }
    return h.f.Sync() // durability; cost is one fsync per record
}
```

If audit volume is low, the sync-per-record cost is acceptable. For
higher rates, batch and group-commit — see
[`../01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md)
section 10 for the pattern.

## 15. The reverse: structured logs in libraries

If you're writing a Go library, accept a `*slog.Logger` rather than
the package default:

```go
type Client struct {
    log *slog.Logger
}

func New(opts ...Option) *Client {
    c := &Client{log: slog.Default()}
    for _, o := range opts { o(c) }
    return c
}

func WithLogger(l *slog.Logger) Option {
    return func(c *Client) { c.log = l }
}
```

Default to `slog.Default()` so callers can do nothing. Let them inject
a configured logger if they want library logs to flow through their
own setup. Don't add a global `Logger` variable in your library — that
defeats the point.

For very chatty libraries, expose a `LevelVar` so users can quiet your
component without touching the global level:

```go
var DefaultLevel = new(slog.LevelVar)

// ...inside the library:
if !c.log.Handler().Enabled(ctx, DefaultLevel.Level()) {
    return
}
```

## 16. Logging during shutdown

The order matters when log handlers do anything beyond writing to
stderr: stop listeners, drain in-flight work, close async queues,
flush buffered writers (`bw.Flush()`), sync files (`f.Sync()`),
close files. `os.Exit(1)` skips deferred cleanup, so flush
explicitly before exit:

```go
slog.Error("fatal", "err", err)
bw.Flush()
os.Exit(1)
```

For services with multi-layer writers, expose a `Sync()` helper that
walks the layers; call it from a `defer` in `main` and from any abort
path.

## 17. What to read next

- [optimize.md](optimize.md) — the allocation budget for the patterns
  in this file, and how to keep them in budget under load.
- [find-bug.md](find-bug.md) — the bugs that production patterns
  introduce when not implemented carefully.
- [tasks.md](tasks.md) — exercises that build the production-tier
  patterns step by step.
- [`../01-io-and-file-handling/professional.md`](../01-io-and-file-handling/professional.md)
  — for log rotation, durable writes, and the writer-side concerns.

# 8.7 `log/slog` — Middle

> **Audience.** You're comfortable with the basics in [junior.md](junior.md):
> levels, `JSONHandler`, `With`, the typed `Attr` constructors. This file
> covers the patterns that turn `slog` into a real observability layer:
> groups, custom levels, dynamic level changes, context propagation, the
> `LogValuer` for redaction, and `ReplaceAttr` for production-shaped JSON.

## 1. Groups: nesting structure inside a record

Flat key-value output gets noisy when you log a request, a response,
and a few derived metrics in the same record. `slog.Group` nests
related attributes under a single key:

```go
slog.Info("request handled",
    slog.Group("request",
        slog.String("method", r.Method),
        slog.String("path", r.URL.Path),
        slog.String("remote", r.RemoteAddr),
    ),
    slog.Group("response",
        slog.Int("status", 200),
        slog.Duration("elapsed", time.Since(start)),
        slog.Int("bytes", n),
    ),
)
```

JSON output:

```json
{
  "time": "...", "level": "INFO", "msg": "request handled",
  "request":  {"method": "GET", "path": "/", "remote": "10.0.0.1"},
  "response": {"status": 200, "elapsed": "1.2ms", "bytes": 14}
}
```

Text output flattens groups using dot notation:

```
request.method=GET request.path=/ response.status=200
```

Groups compose: a group inside a group nests further. `Logger.WithGroup`
prefixes every subsequent attribute with that group name:

```go
log := slog.With("req_id", id).WithGroup("request")
log.Info("started", "method", "GET", "path", "/")
// {..., "req_id": "abc", "request": {"method": "GET", "path": "/"}}
```

`WithGroup` is sticky: once set, every attribute added later is inside
the group. To exit the group, build a different sub-logger.

## 2. Choosing between `Group` and `LogValue`

Two ways to nest a struct in output:

```go
// Option A: build the group at the call site.
slog.Info("checkout",
    slog.Group("user",
        slog.Int("id", u.ID),
        slog.String("email", u.Email),
    ),
)

// Option B: implement LogValue() on the type, log it once.
slog.Info("checkout", "user", u)
```

Option B is the right pattern when:

- The same type is logged from many call sites.
- Some fields are sensitive (token, password) and must never leak.
- The type's "log shape" should change in one place when you add a
  field.

Option A is right for one-off ad-hoc grouping that doesn't deserve a
type's `LogValue` method.

## 3. Pre-formatting for performance: `Logger.With`

Every `slog.Info` call re-renders the bound attributes into the output.
For attributes that never change for the lifetime of a sub-logger
(service name, version, shard), `With` lets the handler pre-format them
once:

```go
base := slog.Default().With(
    "service", "billing",
    "version", buildVersion,
    "host", hostname,
)

// ... for each request ...
log := base.With("req_id", id)
log.Info("started")
```

Behind the scenes, `Logger.With` calls `Handler.WithAttrs`. A
well-written handler caches the rendered prefix so the next `Handle`
call doesn't re-encode `"service":"billing","version":"1.2.3"`. The
two stdlib handlers do this. The savings are measurable when you log
many records per request — see [optimize.md](optimize.md) section 4.

## 4. Levels in detail

The four built-in `slog.Level` values:

```go
const (
    LevelDebug Level = -4
    LevelInfo  Level = 0
    LevelWarn  Level = 4
    LevelError Level = 8
)
```

`Level` is `int`. The numeric gaps are deliberate: you can define your
own levels in between or beyond the built-ins.

```go
const (
    LevelTrace = slog.LevelDebug - 4 // -8
    LevelNotice = slog.LevelInfo + 2 //  2
    LevelAudit = slog.LevelWarn + 2  //  6
    LevelFatal = slog.LevelError + 4 //  12
)

slog.Log(ctx, LevelAudit, "user updated billing address",
    "user_id", uid, "old", oldAddr, "new", newAddr,
)
```

`slog.Log(ctx, level, msg, attrs...)` is the explicit-level call. Pair
with `ReplaceAttr` to render unknown levels with a friendly name:

```go
opts := &slog.HandlerOptions{
    Level: LevelTrace,
    ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
        if a.Key != slog.LevelKey {
            return a
        }
        switch a.Value.Any().(slog.Level) {
        case LevelTrace:
            return slog.String(slog.LevelKey, "TRACE")
        case LevelNotice:
            return slog.String(slog.LevelKey, "NOTICE")
        case LevelAudit:
            return slog.String(slog.LevelKey, "AUDIT")
        case LevelFatal:
            return slog.String(slog.LevelKey, "FATAL")
        }
        return a
    },
}
```

Without the rename, the level shows as `level=DEBUG-4` (the built-in
formatting falls back to "nearest known level + offset").

## 5. Dynamic level changes with `LevelVar`

`slog.LevelVar` is an `atomic` `Level` you can flip at runtime:

```go
var logLevel = new(slog.LevelVar) // defaults to Info

func main() {
    h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
        Level: logLevel, // pointer; the handler reads it on every call
    })
    slog.SetDefault(slog.New(h))

    // Flip to debug for a one-off troubleshoot:
    logLevel.Set(slog.LevelDebug)

    // Reset:
    logLevel.Set(slog.LevelInfo)
}
```

Wire `logLevel.Set` to a debug HTTP endpoint, a SIGHUP handler, or a
config-reload hook (see [professional.md](professional.md) section 7),
and you can raise verbosity in production without restarting.

The cost of a filtered call is one atomic load plus a comparison. The
allocation-free fast path (`Logger.Enabled` returning false) skips
record construction entirely.

## 6. `LogValuer` for lazy and redacted values

`LogValue() Value` is called only if the record actually reaches a
handler — so expensive computations don't run when the level filter
drops the record:

```go
type heavyMetric struct {
    db *sql.DB
}

func (m heavyMetric) LogValue() slog.Value {
    n, err := countRows(m.db)
    if err != nil {
        return slog.StringValue("unknown")
    }
    return slog.IntValue(n)
}

slog.Debug("status", "row_count", heavyMetric{db: db})
```

If the handler is at INFO, the `Debug` call is filtered before
`LogValue` runs. The DB query never happens. This is the primary reason
to put expensive transformations behind `LogValuer` rather than at the
call site.

The same pattern enforces redaction:

```go
type Token string

func (t Token) LogValue() slog.Value {
    if len(t) < 6 { return slog.StringValue("redacted") }
    return slog.StringValue(string(t[:3]) + "..." + string(t[len(t)-3:]))
}

slog.Info("issued token", "token", token)
// {"token":"abc...xyz"}
```

The handler never sees the full token, no matter how careless a call
site is. Use this for any type that holds a secret: API keys, session
IDs, JWTs, passwords (which should fail to log entirely — return
`StringValue("redacted")` and emit a warning if you can).

## 7. The `slog.Value` zoo

`slog.Value` is a tagged union over Go's basic types. The constructors:

| Constructor | Holds |
|-------------|-------|
| `StringValue(s)` | string |
| `IntValue(i)` | int64 |
| `Uint64Value(u)` | uint64 |
| `Float64Value(f)` | float64 |
| `BoolValue(b)` | bool |
| `TimeValue(t)` | time.Time |
| `DurationValue(d)` | time.Duration |
| `GroupValue(attrs...)` | nested group |
| `AnyValue(v)` | reflection fallback |
| `LogValuerValue(v)` | a `LogValuer` (resolved lazily) |

The handler resolves `LogValuer`s by calling `Resolve()` on the value;
the result is a fresh `Value` of one of the concrete kinds. If
`Resolve` returns another `LogValuer`, it loops — capped at four
iterations to prevent infinite recursion. After four, you get a
`StringValue("LogValue() called too many times")`.

## 8. Context propagation: `InfoContext` and friends

The original four functions (`Info`, `Warn`, etc.) don't take a
`context.Context`. The mirror set does:

```go
slog.InfoContext(ctx, "request received", "path", path)
slog.ErrorContext(ctx, "upstream failed", "err", err)
```

Identical to the non-`Context` versions, except the context is passed
to `Handler.Handle(ctx, record)`. A handler can pull request-scoped
fields out of the context — request ID, trace ID, tenant ID — and add
them to every record without a per-call `With`:

```go
type ctxHandler struct {
    slog.Handler
}

func (h ctxHandler) Handle(ctx context.Context, r slog.Record) error {
    if reqID, ok := ctx.Value(reqIDKey{}).(string); ok {
        r.AddAttrs(slog.String("req_id", reqID))
    }
    if traceID := traceIDFromCtx(ctx); traceID != "" {
        r.AddAttrs(slog.String("trace_id", traceID))
    }
    return h.Handler.Handle(ctx, r)
}
```

Wrap the default handler with this once at startup. Now every
`InfoContext`/`ErrorContext` call has the request and trace IDs without
the call site naming them. The non-`Context` calls don't get them —
which is fine, those are the ones you want to be ambient.

## 9. `ReplaceAttr` patterns for production

`HandlerOptions.ReplaceAttr` is called for every attribute the handler
is about to emit — including the built-in time/level/source/message and
every group attribute. Common production uses:

### Rename built-in keys to your aggregator's preferred shape

```go
ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
    if len(groups) > 0 { return a } // only rewrite top-level
    switch a.Key {
    case slog.TimeKey:
        return slog.Attr{Key: "@timestamp", Value: a.Value}
    case slog.LevelKey:
        return slog.Attr{Key: "severity", Value: a.Value}
    case slog.MessageKey:
        return slog.Attr{Key: "message", Value: a.Value}
    case slog.SourceKey:
        return slog.Attr{Key: "logger.source", Value: a.Value}
    }
    return a
}
```

### Drop noisy keys

```go
if a.Key == "internal_only" { return slog.Attr{} } // empty key drops
```

### Round timestamps

```go
if a.Key == slog.TimeKey {
    t := a.Value.Time()
    return slog.Time(slog.TimeKey, t.Round(time.Millisecond))
}
```

### Redact at the handler level

```go
if strings.Contains(a.Key, "password") || strings.Contains(a.Key, "secret") {
    return slog.String(a.Key, "[REDACTED]")
}
```

The handler-level redaction is a defence-in-depth net for keys that
slipped through. The right primary defense is a `LogValuer` on the
type — but defenders shouldn't trust a single layer.

`groups` is the path of nested groups the attribute is inside (empty
for top-level). Use it to scope rewrites: only rewrite `time` at the
top level, not a `time` inside a nested group.

## 10. The `slog.NewLogLogger` adapter

If you have a third-party library that takes `*log.Logger` (the `log`
package's type), bridge it to your `slog.Logger`:

```go
adapter := slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo)
http.Server{ErrorLog: adapter}.ListenAndServe(":8080")
```

Now `http.Server`'s internal log lines flow through `slog`. The level
is fixed at construction (you can't promote some lines to ERROR), but
the structured destination, time formatting, and source location are
all consistent with the rest of your output.

The reverse — making your `slog.Logger` accept `log.Printf`-style
calls — uses the same package-level `slog.SetDefault`:

```go
log.SetOutput(slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo).Writer())
log.SetFlags(0) // slog renders the time
```

Now any `log.Println` from a third-party package becomes a JSON record.

## 11. Custom handlers: the minimum

Implement four methods:

```go
type Handler interface {
    Enabled(context.Context, Level) bool
    Handle(context.Context, Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}
```

A trivial filter that drops records below a threshold:

```go
type filter struct {
    inner slog.Handler
    min   slog.Level
}

func (f *filter) Enabled(_ context.Context, l slog.Level) bool {
    return l >= f.min
}
func (f *filter) Handle(ctx context.Context, r slog.Record) error {
    return f.inner.Handle(ctx, r)
}
func (f *filter) WithAttrs(a []slog.Attr) slog.Handler {
    return &filter{inner: f.inner.WithAttrs(a), min: f.min}
}
func (f *filter) WithGroup(name string) slog.Handler {
    return &filter{inner: f.inner.WithGroup(name), min: f.min}
}
```

Forwarding `WithAttrs` and `WithGroup` to the inner handler is what
keeps your filter composable. A handler that returns itself from
`WithAttrs` is a bug — the bound attributes never reach the inner
handler.

For the deep version of the contract — when `Enabled` may be called,
when `Handle` must return immediately, what to do with errors — see
[senior.md](senior.md) section 3.

## 12. Multi-handler composition

Send the same record to two destinations:

```go
type multiHandler struct {
    handlers []slog.Handler
}

func (m *multiHandler) Enabled(ctx context.Context, l slog.Level) bool {
    for _, h := range m.handlers {
        if h.Enabled(ctx, l) {
            return true
        }
    }
    return false
}

func (m *multiHandler) Handle(ctx context.Context, r slog.Record) error {
    var firstErr error
    for _, h := range m.handlers {
        if h.Enabled(ctx, r.Level) {
            if err := h.Handle(ctx, r.Clone()); err != nil && firstErr == nil {
                firstErr = err
            }
        }
    }
    return firstErr
}

func (m *multiHandler) WithAttrs(a []slog.Attr) slog.Handler {
    next := make([]slog.Handler, len(m.handlers))
    for i, h := range m.handlers {
        next[i] = h.WithAttrs(a)
    }
    return &multiHandler{handlers: next}
}

func (m *multiHandler) WithGroup(name string) slog.Handler {
    next := make([]slog.Handler, len(m.handlers))
    for i, h := range m.handlers {
        next[i] = h.WithGroup(name)
    }
    return &multiHandler{handlers: next}
}
```

Pattern: dev-mode text to the terminal *and* JSON to a file.
Production-mode JSON to stderr *and* a sampling handler that ships only
1% of debug records to a remote endpoint. Each destination has its own
level threshold.

`Record.Clone()` is required when you pass the record to multiple
handlers. The record's attributes can be a borrowed slice; mutating in
one handler must not affect another.

## 13. Sampling: when "log everything" is too much

A high-RPS service that logs INFO once per request can drown out the
events you actually need. A sampling handler keeps a fraction:

```go
type sampler struct {
    inner slog.Handler
    rate  uint64
    seen  atomic.Uint64
}

func (s *sampler) Handle(ctx context.Context, r slog.Record) error {
    n := s.seen.Add(1)
    if r.Level >= slog.LevelWarn || n%s.rate == 0 {
        return s.inner.Handle(ctx, r)
    }
    return nil
}
```

Always pass through WARN and ERROR; sample INFO. The aggregator gets
1/N of the routine traffic plus every interesting event. Tag the
sampled records with `sampled=true` so downstream queries can scale up
the counts.

## 14. Buffered handler for high throughput

`JSONHandler` writes one record per call — typically one syscall per
record on `os.Stderr`. For services that log hundreds of records per
second, batching them through a `bufio.Writer` cuts syscall overhead:

```go
bw := bufio.NewWriterSize(os.Stderr, 64*1024)
defer bw.Flush()

h := slog.NewJSONHandler(bw, nil)
slog.SetDefault(slog.New(h))
```

The trade-off: lines stay in the buffer until it fills or you `Flush`.
If the process crashes, you lose whatever's still in the buffer. For
services where every line matters (audit logs), don't buffer; for
services where the next 4 KiB is fine to lose, do.

The right shutdown sequence:

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()
// ... run server ...
<-ctx.Done()
bw.Flush() // before main returns
```

A `flushOnError` wrapper that flushes on every record at WARN and above
strikes a useful middle ground.

## 15. HTTP middleware: request and trace IDs

A middleware that pulls request and trace IDs out of incoming headers,
attaches them to the request context, and ensures every log call inside
the handler picks them up:

```go
type ctxKey int

const (
    reqIDKey ctxKey = iota
    traceIDKey
)

func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reqID := r.Header.Get("X-Request-Id")
        if reqID == "" {
            reqID = generateID()
        }
        traceID := r.Header.Get("Traceparent")

        ctx := context.WithValue(r.Context(), reqIDKey, reqID)
        ctx = context.WithValue(ctx, traceIDKey, traceID)

        start := time.Now()
        rw := &statusRecorder{ResponseWriter: w, status: 200}
        next.ServeHTTP(rw, r.WithContext(ctx))

        slog.InfoContext(ctx, "request handled",
            "method", r.Method,
            "path", r.URL.Path,
            "status", rw.status,
            "elapsed_ms", time.Since(start).Milliseconds(),
        )
    })
}
```

Combined with the `ctxHandler` wrapper from section 8, every
`InfoContext` inside a request handler emits records with `req_id`
and `trace_id` — no per-call-site work.

The `traceparent` header is the W3C trace-context standard. If you
extract the trace ID and span ID per the spec, the same `slog` records
correlate with OpenTelemetry traces in your APM tool.

## 16. Testing handlers and capturing output

For unit tests, a `slog` capture over a `bytes.Buffer`:

```go
func TestSomething(t *testing.T) {
    var buf bytes.Buffer
    h := slog.NewJSONHandler(&buf, nil)
    log := slog.New(h)

    doSomething(log)

    var got map[string]any
    if err := json.Unmarshal(buf.Bytes()[:buf.Len()-1], &got); err != nil {
        t.Fatal(err)
    }
    if got["msg"] != "expected message" {
        t.Errorf("msg = %q", got["msg"])
    }
}
```

For tests that only care about specific fields, `slog.NewTextHandler`
into a buffer plus a substring check is simpler. For tests that need
to inspect attribute *types* programmatically, write a custom handler
that records each `slog.Record` into a slice — see
[tasks.md](tasks.md) section 4.

## 17. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| Custom handler's `WithAttrs` returns the same handler | Forgot to wrap; bound attrs never reach `Handle` |
| `LogValue` runs even for filtered debug calls | Variadic key-value form forces evaluation; use `slog.Any` with the type so the handler sees a `LogValuer` |
| `req_id` missing from some records | Used `Info` instead of `InfoContext`; ambient handler wrapper can't inject without context |
| Multi-handler emits attrs once per handler in different orders | `Record.AddAttrs` mutates; clone the record before passing to each handler |
| Source line points at the wrapper function | Custom logging wrapper used `slog.Logger.Log` directly; use `LogAttrs` with a `pc` from `runtime.Callers(2, ...)` |

## 18. What to read next

- [senior.md](senior.md) — exact `Handler` contract, the allocation
  model, source-line capture cost, and the rules for writing a handler
  that survives review.
- [professional.md](professional.md) — production patterns for
  large-scale logging: multi-destination, sampling under load, log
  rotation integration, kubectl-friendly JSON.
- [find-bug.md](find-bug.md) — drills targeting the bugs in this file.
- [tasks.md](tasks.md) — exercises that practice handlers, groups,
  context propagation, and `LogValuer`.

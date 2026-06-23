# 8.7 `log/slog` — Find the Bug

> **Audience.** You've read [middle.md](middle.md) and
> [senior.md](senior.md), and you want to train your eye for the bugs
> that actually ship to production. Each snippet below is short, looks
> roughly right, and has at least one real bug from the patterns the
> earlier files describe. Read the snippet first, find the bug, then
> read the analysis. Most of these are not obvious; they're contractual.

## 1. The unpaired key

```go
slog.Info("login attempt",
    "user", user,
    "ip", ip,
    "session_id",
)
```

### Analysis

The variadic walker expects `(key, value)` pairs. Here the last
argument `"session_id"` has no matching value. The walker emits an
attribute with the auto-generated key `"!BADKEY"` and the orphan
string as the value:

```json
{"msg":"login attempt","user":"alice","ip":"1.2.3.4","!BADKEY":"session_id"}
```

The runtime doesn't panic. The log line ships. A reviewer skimming
output may notice `!BADKEY` once; weeks later, a query for
`session_id="abc"` returns nothing because `session_id` was never
recorded. The fix is one of:

1. Add the missing value: `"session_id", sid`.
2. Remove the orphan: drop the trailing argument.
3. Run `go vet -slogargs` (or the `sloglint` linter) in CI to catch
   this at compile time.

## 2. `WithAttrs` returning the receiver

```go
type filterHandler struct {
    inner slog.Handler
    level slog.Level
}

func (f *filterHandler) Enabled(_ context.Context, l slog.Level) bool {
    return l >= f.level
}
func (f *filterHandler) Handle(ctx context.Context, r slog.Record) error {
    return f.inner.Handle(ctx, r)
}
func (f *filterHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
    return f
}
func (f *filterHandler) WithGroup(name string) slog.Handler {
    return f
}
```

### Analysis

`WithAttrs` and `WithGroup` return the receiver — `f` — instead of a
new handler that holds the bound state. The `Logger` calls
`WithAttrs(attrs)` and stores the return value. Subsequent records
flow through `Handle`, which forwards to `f.inner.Handle` — and
`f.inner` was never told about the bound attributes. They vanish.

The user calls `slog.With("req_id", id).Info("started")` and expects
`req_id` in the output. It's not there. Tests that emit records and
check output catch this; tests that only ensure the wrapper doesn't
panic don't.

```go
func (f *filterHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
    return &filterHandler{inner: f.inner.WithAttrs(attrs), level: f.level}
}
func (f *filterHandler) WithGroup(name string) slog.Handler {
    return &filterHandler{inner: f.inner.WithGroup(name), level: f.level}
}
```

Run `testing/slogtest.TestHandler` against any custom handler. It
catches this exact bug.

## 3. `Record.Clone` skipped in a multi-handler

```go
func (m *multiHandler) Handle(ctx context.Context, r slog.Record) error {
    var first error
    for _, h := range m.handlers {
        if err := h.Handle(ctx, r); err != nil && first == nil {
            first = err
        }
    }
    return first
}
```

### Analysis

The same `Record` is passed to every inner handler. If any handler
calls `r.AddAttrs(...)` (a context-injection wrapper, an audit
augmenter), the second handler sees the augmented record. Multiple
augmenters compound — the last handler may see attributes from every
upstream wrapper, in arbitrary order.

The fix:

```go
for _, h := range m.handlers {
    if err := h.Handle(ctx, r.Clone()); err != nil && first == nil {
        first = err
    }
}
```

`Clone` is cheap when the record uses the inline-attr fast path and
allocates one slice when the record has overflowed. The cost is
predictable; the bug it prevents is not.

## 4. Wrapper that loses the source line

```go
func (l *MyLogger) Warn(msg string, attrs ...slog.Attr) {
    l.inner.LogAttrs(context.Background(), slog.LevelWarn, msg, attrs...)
}
```

### Analysis

`Logger.LogAttrs` captures the program counter via `runtime.Callers`
internally. The PC reflects the *immediate caller* of `LogAttrs` —
which is `MyLogger.Warn`, not the caller of `MyLogger.Warn`. Every
log line then points to the wrapper file, not the user's call site.

The fix is to capture the PC manually with the right call depth:

```go
func (l *MyLogger) Warn(ctx context.Context, msg string, attrs ...slog.Attr) {
    if !l.inner.Enabled(ctx, slog.LevelWarn) {
        return
    }
    var pcs [1]uintptr
    runtime.Callers(2, pcs[:]) // skip Callers, Warn
    r := slog.NewRecord(time.Now(), slog.LevelWarn, msg, pcs[0])
    r.AddAttrs(attrs...)
    _ = l.inner.Handler().Handle(ctx, r)
}
```

`runtime.Callers(2, ...)` skips two frames: `runtime.Callers` itself
and `MyLogger.Warn`. The handler then renders the source as the file
and line of the user's call site.

## 5. `LogValue` with a side effect

```go
type Stats struct {
    db *sql.DB
}

func (s Stats) LogValue() slog.Value {
    var n int
    s.db.QueryRowContext(context.Background(),
        "UPDATE log_count SET n = n + 1 RETURNING n").Scan(&n)
    return slog.IntValue(n)
}

slog.Debug("stats", "log_count", Stats{db: db})
```

### Analysis

Two bugs. First, `LogValue` performs a state-changing database write.
The handler may call `LogValue` zero times (if the level is filtered),
once (the normal case), or several times (if a chain of wrappers each
call `Resolve`). The side effect's count is not predictable.

Second, the chosen query updates a counter — so any wrapper that
calls `Resolve()` for diagnostics or testing increments the counter
in production.

`LogValue` MUST be a pure function of the receiver. Read state, never
write it. If you need a counter, increment it at the call site, not
inside `LogValue`.

## 6. `slog.Info` instead of `slog.InfoContext` in middleware

```go
func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.WithValue(r.Context(), reqIDKey, generateID())
        slog.Info("request received", "path", r.URL.Path)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Analysis

The handler stack uses `slog.InfoContext` (and a `ctxInjector`
wrapper) to attach `req_id` to every record. But the middleware
itself calls `slog.Info` — no context — for the "request received"
line. The injector receives `context.Background()` and finds no
`req_id`. That one line ships without the field; every other record
inside the request has it.

In aggregate views: the timeline of a request shows N+1 records, of
which N have `req_id` and one doesn't. The query "all events for
req_id=abc" misses the entry-point line. The fix is one letter:

```go
slog.InfoContext(ctx, "request received", "path", r.URL.Path)
```

Train the eye: every log call inside a request handler is `*Context`.
Linters can enforce this — `sloglint -context-only` flags
non-context calls in files matching `*_handler.go`.

## 7. `bufio.Writer` over `os.Stderr` without flush on shutdown

```go
func main() {
    bw := bufio.NewWriterSize(os.Stderr, 64*1024)
    slog.SetDefault(slog.New(slog.NewJSONHandler(bw, nil)))

    slog.Info("starting up")
    runService()
    slog.Info("shutting down")
}
```

### Analysis

The buffered writer holds up to 64 KiB before flushing. The "shutting
down" line, plus any preceding records that didn't fill the buffer,
are still in `bw`'s buffer when `main` returns. The process exits
without flushing — those records never reach stderr.

If the service crashes (panic, OOM kill), the same loss happens for
any in-flight records. Even a clean exit loses the last partial
buffer.

```go
defer bw.Flush()
```

Also: don't `os.Exit(1)` directly after a fatal error — exits skip
deferred functions. If you must exit, flush first:

```go
slog.Error("fatal", "err", err)
bw.Flush()
os.Exit(1)
```

For services where every line matters (audit logs), don't buffer.
The throughput cost (one syscall per record) is acceptable for
slow-rate audit volumes; the durability gain is non-negotiable.

## 8. Hot-path variadic with allocations

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    // ... handle ...
    slog.Info("request handled",
        "method", r.Method,
        "path", r.URL.Path,
        "remote", r.RemoteAddr,
        "status", 200,
        "elapsed_ms", time.Since(start).Milliseconds(),
        "req_id", r.Header.Get("X-Request-Id"),
    )
}
```

### Analysis

Six attributes — past the inline-attr array of 5. The variadic form
boxes each non-pointer value into an `any`, allocating per call. At
10 000 RPS, that's 60 000+ small allocations per second going through
the GC.

The fix is `LogAttrs` with typed `Attr`s:

```go
slog.LogAttrs(r.Context(), slog.LevelInfo, "request handled",
    slog.String("method", r.Method),
    slog.String("path", r.URL.Path),
    slog.String("remote", r.RemoteAddr),
    slog.Int("status", 200),
    slog.Int64("elapsed_ms", time.Since(start).Milliseconds()),
    slog.String("req_id", r.Header.Get("X-Request-Id")),
)
```

The typed constructors don't box. The record still spills past 5 to
a heap-allocated slice, but the per-attribute boxing goes away. On
benchmarks: typically 4–5× fewer allocations and 2–3× faster.

For attributes that don't change per request, `Logger.With` once and
emit through the bound logger:

```go
log := slog.With("method", r.Method, "path", r.URL.Path)
log.Info("started")
log.Info("finished", "status", 200, "elapsed_ms", elapsed)
```

The `With` call pays the binding cost once; each `Info` cost goes
down to "format the per-call attributes and append the cached prefix."

## 9. `LogValue` infinite loop

```go
type Wrapper struct {
    Inner any
}

func (w Wrapper) LogValue() slog.Value {
    return slog.AnyValue(w)
}

slog.Info("dump", "value", Wrapper{Inner: 42})
```

### Analysis

`LogValue` returns an `AnyValue` containing `w` — itself a `LogValuer`.
`Resolve` calls `LogValue` again, which returns the same wrapped value,
which calls `LogValue` again. The `slog` package caps recursion at 4
levels and returns:

```
{"value": "LogValue called too many times"}
```

The cap prevents an infinite loop. The bug isn't a hang; it's the
silent placeholder shipping to your aggregator instead of real data.
Run a unit test that asserts the output for a `Wrapper` is *not*
`"LogValue called too many times"` — the test catches this.

The fix: `LogValue` must produce a non-`LogValuer` `Value` (or a
`Value` whose contained type is not itself a `LogValuer`):

```go
func (w Wrapper) LogValue() slog.Value {
    return slog.AnyValue(w.Inner)
}
```

## 10. Cross-handler attribute mutation

```go
func (h *injector) Handle(ctx context.Context, r slog.Record) error {
    if v := ctx.Value(reqIDKey); v != nil {
        r.AddAttrs(slog.String("req_id", v.(string)))
    }
    return h.inner.Handle(ctx, r)
}
```

### Analysis

The handler mutates the record by adding an attribute. If `injector`
sits inside a multi-handler (or any wrapper that fans out), the
mutation is visible to subsequent handlers in the chain — and to the
caller. After the handler returns, the caller's `Record` value has an
extra attribute it didn't add.

This is harmful when:

- The chain is `multi → injector1 → backend1`, `multi → injector2 →
  backend2`. `injector1`'s `req_id` attaches to the same record that
  `injector2` sees. Both backends emit the same `req_id`.
- The next call to `Handle` reuses a recovered `Record` (e.g., from
  a pool) — bound attributes from the previous call leak.

The fix is to clone before mutating:

```go
func (h *injector) Handle(ctx context.Context, r slog.Record) error {
    if v := ctx.Value(reqIDKey); v != nil {
        r2 := r.Clone()
        r2.AddAttrs(slog.String("req_id", v.(string)))
        return h.inner.Handle(ctx, r2)
    }
    return h.inner.Handle(ctx, r)
}
```

For multi-handlers, the safer pattern is "clone once at the multi
boundary, then each downstream handler can mutate freely on its own
copy."

## 11. `slog.SetDefault` race with package init

```go
func init() {
    slog.Info("package initializing")
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
}
```

### Analysis

Two issues. First, the `slog.Info` call uses the *previous* default —
which is the built-in text-to-stderr — so the "package initializing"
line is text, not the JSON the rest of the service emits. Logs are
inconsistent right at startup, when you're most likely to need to
parse them.

Second, `init` order is non-deterministic across packages. If another
package's `init` also calls `slog.SetDefault`, the order of
replacement determines who wins. Whichever runs last is the surviving
default — and you don't control which.

The pattern: install the default in `main`, before any package-level
logging. Library packages must not call `slog.SetDefault`.

```go
func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
    slog.Info("starting up")  // now uses the configured default
    // ...
}
```

If a library needs to log during its own init, accept a `*slog.Logger`
in its constructor and use it; don't go through the global.

## 12. Forgotten handler error

```go
type netHandler struct {
    addr string
    conn net.Conn
}

func (h *netHandler) Handle(ctx context.Context, r slog.Record) error {
    line := formatJSON(r)
    _, err := h.conn.Write(line)
    return err
}
```

### Analysis

If `Write` fails — connection broken, peer crashed, network outage —
`Handle` returns the error. `Logger.Log` discards it (see
[senior.md](senior.md) section 8). The service runs blind for hours
because nothing surfaces the failure.

Production handlers must do something with their own errors:

1. **Increment a metric.** `log_handler_errors_total{handler="net"}`
   on Prometheus. Alert on any value > 0.
2. **Fall back.** Write to stderr (or another sink) when the primary
   fails. Don't drop records silently.
3. **Reconnect with backoff.** A failed `Write` may indicate a
   recoverable disconnect. Retry the connection in a goroutine; queue
   records during the gap.

```go
func (h *netHandler) Handle(ctx context.Context, r slog.Record) error {
    line := formatJSON(r)
    if _, err := h.conn.Write(line); err != nil {
        h.errors.Add(1)
        _ = h.fallback.Handle(ctx, r) // emit to stderr instead
        return err
    }
    return nil
}
```

The error still returns — wrappers above can react — but the data
isn't lost.

## 13. `JSONHandler` over a `bytes.Buffer` shared by goroutines

```go
var buf bytes.Buffer
slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))

go slog.Info("a")
go slog.Info("b")
// ... wait for goroutines ...
fmt.Println(buf.String())
```

### Analysis

`bytes.Buffer` is not safe for concurrent use. `JSONHandler`
internally locks its own mutex around the write to the underlying
`io.Writer`, but the lock is per-handler-instance — and the standard
handler's lock protects only the formatted-bytes assembly, not the
write itself. Two concurrent `Info` calls can race on the buffer's
`Write` method, corrupting state.

The fix in tests:

```go
type lockedBuffer struct {
    mu  sync.Mutex
    buf bytes.Buffer
}
func (l *lockedBuffer) Write(p []byte) (int, error) {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.buf.Write(p)
}
```

Or use a separate buffer per goroutine. `os.Stderr` doesn't have this
problem because the kernel guarantees atomic writes up to `PIPE_BUF`
(4 KiB).

## 14. Source line off-by-one in custom wrapper

```go
func (l *Logger) Audit(ctx context.Context, msg string, attrs ...slog.Attr) {
    var pcs [1]uintptr
    runtime.Callers(1, pcs[:])
    r := slog.NewRecord(time.Now(), LevelAudit, msg, pcs[0])
    r.AddAttrs(attrs...)
    _ = l.Handler().Handle(ctx, r)
}
```

### Analysis

`runtime.Callers(N, pcs[:])` skips N frames from the call stack. The
documentation:

> The argument skip is the number of stack frames to skip before
> recording in pc, with 0 identifying the frame for Callers itself
> and 1 identifying the caller of Callers.

So `runtime.Callers(1, ...)` records *the caller of `runtime.Callers`*
— which is `Audit` itself. Source lines point at the audit function,
not the user. The right value is 2: skip `runtime.Callers` and
`Audit`, recording the user's frame.

```go
runtime.Callers(2, pcs[:])
```

This is one of the most common bugs in custom logging wrappers. The
fix is one digit; finding it requires comparing source output to the
expected line and being suspicious when they don't match.

## 15. `ReplaceAttr` rewriting a group's children at top level

```go
opts := &slog.HandlerOptions{
    ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
        if a.Key == "user" {
            return slog.String("user", redact(a.Value.String()))
        }
        return a
    },
}
```

### Analysis

The `ReplaceAttr` function ignores the `groups []string` parameter.
For an attribute named `user` at the top level, redaction works. For
a group containing a `user` field — `slog.Group("request",
slog.String("user", "alice"))` — the same redaction applies. So far
so good.

But: `groups` is the path of nested groups containing the attribute.
If a *different* group also has a `user` attribute (e.g., an admin
context where the `user` is the admin, not the customer), the same
redaction applies indiscriminately. There's no way for the rewriter
to distinguish "customer.user" from "admin.user" without checking
`groups`.

The fix:

```go
ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
    // Only redact "user" inside the "customer" group.
    if a.Key == "user" && len(groups) > 0 && groups[0] == "customer" {
        return slog.String("user", redact(a.Value.String()))
    }
    return a
}
```

The reverse mistake — using `groups` when you don't need to — silently
fails to redact the top-level attribute. Test both paths.

## 16. `LogAttrs` with a slice that escapes

```go
func emit(log *slog.Logger, fields ...slog.Attr) {
    log.LogAttrs(context.Background(), slog.LevelInfo, "event", fields...)
}
```

### Analysis

`LogAttrs` is the alloc-free path *if* the slice doesn't escape and
the record fits in the inline array. Here, `fields` is passed
through as a variadic `...Attr` from a wrapper. The compiler can't
prove the slice doesn't escape into `LogAttrs` (which it doesn't), so
the slice may be heap-allocated.

For the truly hot path, build the record directly:

```go
func emit(h slog.Handler, fields ...slog.Attr) {
    if !h.Enabled(context.Background(), slog.LevelInfo) {
        return
    }
    var pcs [1]uintptr
    runtime.Callers(1, pcs[:])
    r := slog.NewRecord(time.Now(), slog.LevelInfo, "event", pcs[0])
    r.AddAttrs(fields...)
    _ = h.Handle(context.Background(), r)
}
```

This is rarely worth it — the savings are nanoseconds — but it's the
last layer for code where every allocation counts. Always benchmark
before optimizing.

## 17. Wrapper that doesn't propagate `WithGroup`

```go
type sampling struct {
    inner slog.Handler
    rate  uint64
}

func (s *sampling) WithAttrs(a []slog.Attr) slog.Handler {
    return &sampling{inner: s.inner.WithAttrs(a), rate: s.rate}
}

func (s *sampling) WithGroup(name string) slog.Handler {
    return s // forgot to propagate
}
```

### Analysis

`WithGroup` is meant to qualify subsequent attributes. Returning `s`
without applying the group means downstream attributes aren't grouped.

```go
log := slog.New(samplingHandler).WithGroup("req")
log.Info("event", "status", 200)
// Expected: {"req":{"status":200}}
// Got:      {"status":200}
```

The fix:

```go
func (s *sampling) WithGroup(name string) slog.Handler {
    return &sampling{inner: s.inner.WithGroup(name), rate: s.rate}
}
```

`testing/slogtest.TestHandler` exercises `WithGroup` with multiple
levels of nesting and catches this bug. Run it for any custom handler.

## 18. `slog.Group` with no attributes

```go
func emitOptional(log *slog.Logger, opts options) {
    log.Info("event",
        slog.Group("opts",
            // ... no attrs because opts is empty ...
        ),
    )
}
```

### Analysis

The `slog` spec says: a group with no attributes MUST be omitted from
output. Standard handlers honor this — the resulting JSON is
`{"msg":"event"}` without `opts`.

If you write a custom handler that emits the group anyway, output
becomes `{"msg":"event","opts":{}}` — extra noise that fails to match
the standard handler's behavior. `slogtest.TestHandler` catches this.

A subtler form: a group whose attributes all happen to be dropped by
`ReplaceAttr` should also be omitted:

```go
ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
    if strings.HasPrefix(a.Key, "_") { return slog.Attr{} } // drop
    return a
}
```

If a group contains only `_internal_*` keys, all dropped, the group
itself should disappear. Standard handlers do this; custom handlers
must too.

## What to read next

- [interview.md](interview.md) — most of these bugs map directly to
  interview questions; practice articulating the analysis verbally.
- [tasks.md](tasks.md) — when you build the exercises there, watch
  for these same patterns sneaking into your own code.
- [senior.md](senior.md) — the sections referenced in the analyses go
  deeper into the contracts being violated.

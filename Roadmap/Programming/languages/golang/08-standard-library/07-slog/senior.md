# 8.7 `log/slog` — Senior

> **Audience.** You've built handlers and shipped services with `slog`,
> and you've been bitten at least once by a wrapper that ate attributes,
> a goroutine that allocated under load, or a handler that saw a record
> with stale state. This file is the precise contract: what the
> `Handler` interface guarantees, what it explicitly does not, the
> allocation model the standard handlers actually exhibit, and the
> systems-level details that separate handlers that work in tests from
> handlers that work in production.

## 1. The `Handler` interface, exactly

```go
type Handler interface {
    Enabled(ctx context.Context, level Level) bool
    Handle(ctx context.Context, r Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}
```

Each method's contract:

### `Enabled(ctx, level) bool`

> Reports whether the handler handles records at the given level. The
> handler ignores records whose level is lower. It is called early,
> before any arguments are processed, to save effort if the log event
> should be discarded.

The `Logger` calls `Enabled` *before* it constructs the `Record`. If
`Enabled` returns false, the variadic key-value pairs you passed are
never converted to `Attr`s, the time is never read, and the source
location is never captured. This is the single most important
optimization in `slog`: a filtered call costs ~1 ns.

`Enabled` MUST be safe to call concurrently. It SHOULD be cheap — the
caller is on a hot path. Reading an `atomic.Int64` (which is what
`LevelVar` does) is fine. Acquiring a mutex is not.

### `Handle(ctx, r) error`

> Handle handles the Record. It will only be called if `Enabled` returns
> true. The Context is provided so that handlers can take actions based
> on it, such as adding fields like trace IDs. It is the responsibility
> of the handler to handle a Record gracefully, even if the same Record
> is passed to multiple handlers.

The contract pieces:

1. **`Handle` is called only after `Enabled(ctx, r.Level)` returned
   true.** A handler that wants per-call filtering still uses
   `Enabled` for the cheap path; finer filtering happens in `Handle`.
2. **The `Record` may be aliased.** Multiple handlers (a fan-out
   `multiHandler`, for example) can pass the same record to several
   inner handlers. Don't mutate the record's attributes in place;
   call `r.Clone()` first if you need to add to it.
3. **Errors are mostly silent.** `Handle`'s error is returned to
   `Logger.Log`, which discards it. There is no global error sink.
   See section 8 for what to do when the destination really fails.
4. **Time is captured by the caller.** `r.Time` is set by `Logger`,
   not by the handler. If the handler stalls for a second before
   formatting, the timestamp still reflects when the log call ran.

### `WithAttrs(attrs) Handler` and `WithGroup(name) Handler`

> WithAttrs returns a new Handler whose attributes consist of both the
> receiver's attributes and the arguments. WithGroup returns a new
> Handler with the given group appended to the receiver's existing
> groups. The keys of all subsequent attributes, whether added by With
> or in a Record, should be qualified by the sequence of group names.

Two non-obvious rules:

1. **Both methods MUST return a *new* Handler.** A handler that
   returns `h` from `WithAttrs` is broken — the attributes vanish.
   The standard handlers allocate a fresh struct that holds the new
   prefix in pre-formatted form.
2. **`WithGroup("")` is a no-op.** Empty group names are ignored;
   the handler returns itself.

The pre-formatting trick: when `WithAttrs` runs, the standard handlers
serialize the attributes into a buffer once. Subsequent `Handle` calls
just append the cached prefix instead of re-rendering the same fields.
For a logger with five bound attributes used per-request, this saves
five formatting calls per record.

## 2. The `Record`, exactly

```go
type Record struct {
    Time    time.Time
    Message string
    Level   Level
    PC      uintptr
    // private: attributes
}
```

`PC` is the program counter of the caller, captured via
`runtime.Callers`. Pass it to `runtime.CallersFrames` to resolve to a
file and line. It's `0` if `AddSource` is off or if the caller used
`Logger.LogAttrs` without supplying a PC.

The attributes are stored in two places:

1. A small inline array (5 attrs).
2. A heap-allocated slice if more.

This split is why `slog` has near-zero allocations for typical records.
A record with five or fewer attributes uses no heap; a record with six
allocates one slice.

To iterate attributes:

```go
r.Attrs(func(a slog.Attr) bool {
    fmt.Println(a.Key, a.Value)
    return true // keep going; false to stop
})
```

To add attributes:

```go
r.AddAttrs(slog.String("k", "v"))
```

`AddAttrs` mutates the record's slice (or allocates if it spills past
the inline array). If the same record is passed to several handlers,
`AddAttrs` in one is visible to the next. Always clone first when
sharing.

## 3. The `Value`, exactly

```go
type Value struct {
    // Three internal fields; stay opaque.
}

type Kind int

const (
    KindAny Kind = iota
    KindBool
    KindDuration
    KindFloat64
    KindInt64
    KindString
    KindTime
    KindUint64
    KindGroup
    KindLogValuer
)
```

`Value.Kind()` reports which constructor produced it. Switch on the
kind to extract the concrete value:

```go
switch v.Kind() {
case slog.KindString:
    return v.String()
case slog.KindInt64:
    return v.Int64()
case slog.KindGroup:
    return formatGroup(v.Group())
case slog.KindLogValuer:
    return formatValue(v.Resolve())
// ...
}
```

`Resolve()` calls `LogValue()` on a `LogValuer` and returns the result.
If the result is itself a `LogValuer`, `Resolve` recurses — up to a
limit (currently 4) to prevent infinite loops. Past the limit, it
returns a `StringValue` warning that the loop was hit.

Any custom handler that walks records MUST resolve `KindLogValuer`
values before formatting. The standard handlers do this; a hand-rolled
handler that forgets it will emit `LogValuer` placeholders instead of
the resolved data.

## 4. The allocation model

`slog` was designed to be near-zero-allocation in the hot path. The
allocations to know:

| Operation | Allocations |
|-----------|-------------|
| `slog.Info("msg", "k", v)` filtered out | 0 |
| `slog.Info("msg", "k1", v1, ..., "k5", v5)` (≤ 5 attrs) emitted | 0 (record on stack) |
| `slog.Info("msg", ...)` with 6+ attrs | 1 (overflow slice) |
| `Logger.With(attrs...)` | 1 (new logger struct) + handler-defined |
| `JSONHandler.Handle` (typical record, ≤ 5 attrs) | 0–1 (output buffer if not pooled) |
| `JSONHandler.Handle` with `AddSource: true` | +1–2 (runtime frame lookup) |
| `Logger.LogAttrs(ctx, level, msg, attrs...)` | 0 (preferred over variadic) |

`Logger.LogAttrs(ctx, level, msg, attrs ...slog.Attr)` is the
allocation-free entry point. It accepts a slice of `Attr`, not a
variadic of `any`, so the compiler doesn't box anything:

```go
slog.LogAttrs(ctx, slog.LevelInfo, "request",
    slog.String("path", path),
    slog.Int("status", status),
)
```

For hot paths (10K+ records/second), prefer `LogAttrs` over the
variadic form. The savings are real — see [optimize.md](optimize.md)
section 2.

## 5. The variadic form's surprises

`slog.Info("msg", args...)` accepts `args ...any`. The conversion to
`Attr` is done by walking pairs:

```go
// k must be string; followed by any value.
"key1", value1, "key2", value2, ...
```

You can mix `Attr`s and key-value pairs:

```go
slog.Info("msg",
    "k1", v1,
    slog.String("k2", "v2"),
    "k3", v3,
)
```

The walker recognizes a `slog.Attr` and consumes one argument; for a
string, it consumes two (key + value). If an argument is neither a
string nor an `Attr`, the result is the special key `!BADKEY` and a
record with a misshapen attribute:

```go
slog.Info("msg", 42, "value")
// {"!BADKEY":42,"!BADKEY":"value"}
```

This is intentional: a runtime panic on malformed log calls is worse
than a log line that signals the bug. But it does mean `go vet -slog`
(or the `sloglint` linter) is worth running in CI to catch these
before they ship.

## 6. The `Logger.Log` and `Logger.LogAttrs` entry points

Three public entry points on `Logger`:

```go
func (l *Logger) Info(msg string, args ...any)
func (l *Logger) Log(ctx context.Context, level Level, msg string, args ...any)
func (l *Logger) LogAttrs(ctx context.Context, level Level, msg string, attrs ...Attr)
```

The differences:

| Method | Context | Level | Alloc-free fast path |
|--------|---------|-------|----------------------|
| `Info`/`Warn`/`Error`/`Debug` | No (uses background) | Fixed | If filtered |
| `Log` | Yes | Variable | If filtered |
| `LogAttrs` | Yes | Variable | Yes (if attrs ≤ 5) |

For wrappers that need to attribute the log to the caller (so source
lines point to the right place), use `LogAttrs` with a pre-captured PC:

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
and your wrapper. The handler then sees a `Record` whose `PC` resolves
to the *caller of the wrapper*, not the wrapper itself.

## 7. Source-line capture cost

`HandlerOptions.AddSource: true` causes the standard handlers to call
`runtime.CallersFrames` for each record. The cost on a modern CPU:

| Operation | Approximate cost |
|-----------|------------------|
| `runtime.Callers(N, pcs)` | 30–100 ns |
| `runtime.CallersFrames(pcs).Next()` | 200–800 ns (first call dominates) |
| Total per record with `AddSource` | ~1 µs |

For a service emitting 100 records/second, this is invisible. For a
service emitting 100 000 records/second, this is 10% of one core.

Two compromises worth knowing:

1. **Capture source only at WARN+.** Wrap the handler so the cost is
   paid only for events you'd actually inspect a stack for.
2. **Pre-resolve source once, cache in the record's attrs.** A custom
   `WithAttrs` that includes a static `source=...` pre-rendered for a
   long-lived sub-logger amortizes the cost — but only works when the
   source is the same across all records emitted by that logger.

In practice, leave `AddSource` on for production services unless
profiling proves it's the bottleneck.

## 8. Errors during `Handle` — the silent path

`Handler.Handle` returns an `error`. `Logger.Log` discards it:

```go
// runtime/slog source, simplified:
_ = h.Handle(ctx, r)
```

There is no global error sink. If your handler can't write to its
destination — disk full, network blocked, encoder bug — the error
disappears. The intentional design: the logging path must never fail
the caller.

In production this matters most for two cases:

1. **Disk full / file rotated mid-write.** A `os.File` returns
   `ENOSPC`; the handler returns the error; nobody sees it. The
   service runs blind for an hour until someone notices the log file
   is empty.
2. **Network-backed handlers** (a custom handler shipping to a remote
   syslog or HTTP endpoint). When the remote stalls, the handler
   blocks `Handle` — which blocks the goroutine that called `Info`.

Mitigations:

- For disk handlers: check the destination's free space periodically
  in a side goroutine and surface alerts. Retry once on `ENOSPC` after
  attempting cleanup; otherwise accept the loss.
- For network handlers: bound the handler with a non-blocking queue
  (drop messages when full) and a circuit breaker. Never let a remote
  failure block the application's hot path.

A useful pattern: a "fallback" handler that writes to stderr if the
primary handler errors:

```go
func (h *fallback) Handle(ctx context.Context, r slog.Record) error {
    if err := h.primary.Handle(ctx, r); err != nil {
        _ = h.fallback.Handle(ctx, r)
        // Optionally: bump a metric, mark the primary as degraded.
    }
    return nil
}
```

## 9. The `Record.Clone` semantics

`r.Clone()` copies the `Record`, including the slice of attributes if
present. After `Clone`, `AddAttrs` on the copy doesn't affect the
original.

When you need it:

- A multi-handler that calls `Handle` on several inner handlers, where
  any of them might `AddAttrs`.
- A handler that buffers records for later (a sampling handler, an
  in-memory ring buffer for crash dumps) — without cloning, later
  mutations leak into the buffered copies.

When you don't:

- A handler that just walks the attributes via `r.Attrs(...)` without
  modifying.
- The terminal handler in a pipeline (no one downstream).

Cloning is cheap when the record uses the inline-attr fast path (no
allocation, just a struct copy). It allocates one slice when the
record overflows.

## 10. The `WithAttrs` pre-formatting optimization

The standard handlers don't store the attribute list literally. On
`WithAttrs(attrs)`, they format the attributes into the output format
once and cache the resulting bytes:

```
[caching JSONHandler with attrs `service=billing`, `version=1.2.3`]
prefix = `,"service":"billing","version":"1.2.3"`
```

Each `Handle` call writes the record header, then the cached prefix,
then the record's own attrs, then the closing brace. The bound
attributes are formatted exactly once per `With` call, regardless of
how many records flow through.

This is why `Logger.With` is a real optimization, not just an
ergonomic helper. For a service that creates a per-request logger
with 5 bound fields and emits 10 records per request, the savings are
50 attribute renders → 5 (one per `With`, one per `Handle`).

A custom handler that doesn't pre-format will be roughly 2–3× slower
on this workload. See [optimize.md](optimize.md) section 4 for the
implementation pattern.

## 11. The `WithGroup` semantics, exactly

`WithGroup(name)` returns a handler where every subsequent attribute
is qualified by the group name. The qualification is *output-format-
dependent*:

- `JSONHandler` nests subsequent attributes inside an object keyed
  `name`.
- `TextHandler` prefixes subsequent attribute keys with `name.`.

Both formats handle nested groups by repeating the qualifier:

```go
log := slog.Default().WithGroup("a").WithGroup("b")
log.Info("msg", "k", "v")
// JSON:  {"a":{"b":{"k":"v"}}}
// Text:  a.b.k=v
```

Empty group names are silent no-ops. Repeated `WithGroup("a")` calls
nest, they don't dedupe:

```go
slog.Default().WithGroup("a").WithGroup("a").Info("msg", "k", "v")
// {"a":{"a":{"k":"v"}}}
```

A custom handler that flattens groups (or applies a custom separator)
implements this in `WithGroup` and `Handle` together. The state is
typically a `[]string` of pending group names, applied to keys when
records flow through.

## 12. Handler composition and order

When you wrap a handler — a context-injection wrapper, a sampling
wrapper, a multi-handler — the *outer* handler's `WithAttrs` and
`WithGroup` are called when callers `With` the logger. The outer
handler must propagate to the inner:

```go
func (h *wrapper) WithAttrs(a []slog.Attr) slog.Handler {
    return &wrapper{
        inner: h.inner.WithAttrs(a),
        // Copy any wrapper-specific state.
        injectField: h.injectField,
    }
}
```

A common bug: the wrapper returns a fresh `wrapper{inner: h.inner}` —
without applying `WithAttrs` to the inner — and the bound attributes
silently disappear. The compiler won't catch this; tests that assert
on output will.

The order of wrappers matters when multiple wrappers add attributes:

```
multi → ctxInjector → sampler → JSONHandler
```

In this stack, the ctx-injected attributes are inside the multi (so
both sinks see them), but the sampler's filter runs before the inner
JSONHandler. The order is a design decision; document it.

## 13. The `LogValuer` resolution path

When a handler walks a record's attributes:

```go
r.Attrs(func(a slog.Attr) bool {
    a.Value = a.Value.Resolve() // important
    formatAttr(a)
    return true
})
```

`Resolve()` is the entry point. It calls `LogValue()` on a `LogValuer`
and returns the result. If the result is itself a `LogValuer`, `Resolve`
recurses (up to 4 levels). The standard handlers always resolve.

A handler that doesn't resolve emits the placeholder:

```
key=slog.LogValuer({ ... })   // text output of the unresolved type
```

This is the most common bug in custom handlers. The fix is one line —
call `Resolve()` before formatting — but the symptom is hard to spot
because tests with simple types don't trigger it.

`Resolve()` is also recursive across groups: a `KindGroup` whose
elements are `LogValuer`s requires walking and resolving each. The
standard handlers handle this; custom handlers must too if they iterate
groups themselves.

## 14. Context: pulling values into records

The handler receives the full `context.Context`. You can read any
ambient value out of it during `Handle`:

```go
func (h *traceHandler) Handle(ctx context.Context, r slog.Record) error {
    if span := trace.SpanFromContext(ctx); span != nil {
        sc := span.SpanContext()
        if sc.IsValid() {
            r.AddAttrs(
                slog.String("trace_id", sc.TraceID().String()),
                slog.String("span_id", sc.SpanID().String()),
            )
        }
    }
    return h.inner.Handle(ctx, r)
}
```

The contract on the context: it is the context passed to
`Logger.Log/InfoContext/etc.` If the caller used `slog.Info`
(non-context form), the context is `context.Background()` — the
ambient handler can't extract anything from it. This is by design:
non-context calls are explicitly opting out of request-scoped
metadata.

For libraries that want to log without forcing callers to plumb a
context, accept a context parameter and use `InfoContext`. For
libraries that emit truly process-global events (startup, shutdown),
use `slog.Info` with `context.Background()`.

## 15. Concurrency model

`*slog.Logger` is safe for concurrent use. Internally it holds a
`Handler` and a small set of immutable fields; `Logger.With` returns a
new logger.

The two stdlib handlers (`TextHandler`, `JSONHandler`) are concurrent-
safe *as long as the underlying `io.Writer` accepts concurrent calls*.
They acquire a mutex around the write to the underlying writer, so
records don't interleave at byte granularity. The mutex is per-handler
instance — a `Logger.With` that produces a child handler typically
shares the mutex with the parent (the standard handlers wrap the same
writer with the same mutex).

`os.Stdout` and `os.Stderr` are safe; their `Write` is one syscall and
the kernel guarantees atomic writes up to `PIPE_BUF` (4 KiB on Linux).
Beyond that, two writes from two goroutines can interleave at page
boundaries. For records longer than 4 KiB, even `os.Stderr` won't save
you — buffer first.

`bytes.Buffer` is *not* concurrent-safe. Wrap it with a mutex when
using it as a handler destination in tests with parallel sub-tests.

## 16. The `Default` global

`slog.Default()` returns the global logger. `slog.SetDefault(l)`
replaces it.

Internally the global is an `atomic.Pointer[Logger]`. Reads and writes
are lock-free; concurrent calls to `slog.SetDefault` and `slog.Info`
are safe.

Two patterns to know:

1. **Set once at startup, never replace.** This is the safe default.
   Calls before `SetDefault` use the original built-in default.
2. **Replace on signal (e.g., `SIGHUP`) to swap formats.** Safe because
   of the atomic pointer; the in-flight `Info` call may use either the
   old or the new logger, but never a torn one.

A subtle concern: when `slog.SetDefault` is called, the *internal*
`log.SetOutput` is also redirected so that `log.Println` flows
through `slog`. If your code does both `slog.SetDefault` and
`log.SetOutput`, the order matters — `SetDefault` resets the bridge.

## 17. The handler test suite (`testing/slogtest`)

The standard library ships `testing/slogtest` to validate that a
handler implements the contract correctly:

```go
import "testing/slogtest"

func TestMyHandler(t *testing.T) {
    var buf bytes.Buffer
    h := NewMyHandler(&buf)

    err := slogtest.TestHandler(h, func() []map[string]any {
        return parseLines(buf.Bytes())
    })
    if err != nil {
        t.Fatal(err)
    }
}
```

The test exercises every quirk: groups, `WithAttrs`, level filtering,
`LogValuer` resolution, the special handling of `Time == 0` (handlers
must omit the time entry in that case), groups with no attrs (must be
absent from output), and so on.

A handler that passes `slogtest.TestHandler` is correct enough to be
trusted in production. A handler that fails it has bugs that will
surface in unexpected ways under real load. Run this test as part of
CI for any custom handler.

## 18. The "no group with no attrs" rule

A subtle invariant the spec calls out: an empty group — `Group("g")`
with no attributes — MUST be omitted from the output. Same for a
`WithGroup` that's never followed by attributes.

```go
slog.Info("msg", slog.Group("empty"))
// JSON output: {"time":"...","level":"INFO","msg":"msg"}
// NOT:        {"time":"...","level":"INFO","msg":"msg","empty":{}}
```

This is one of the easiest cases to get wrong in a custom handler. The
fix in pre-formatting handlers: format attributes into a temporary
buffer, and only commit the group key + buffer if the buffer is
non-empty.

## 19. Time handling

`Record.Time` is a `time.Time`. The standard handlers render it via
`MarshalJSON` (RFC 3339 with sub-second precision) for JSON, and
`time.Format(time.RFC3339Nano)` for text.

To customize, use `ReplaceAttr` on the time key, or set `Time` to the
zero value (which the spec mandates the handler omit).

A special case: if `Record.Time.IsZero()`, the handler MUST omit the
time field entirely. This is the contract — `slogtest.TestHandler`
checks for it. The use case: a handler downstream that adds its own
timestamp (a streaming pipeline where the receiver timestamps on
ingest) can pass `Time = time.Time{}` to avoid double-stamping.

## 20. `slog.Logger` vs `*slog.Logger`

`slog.Logger` is a value type but is meant to be used as `*slog.Logger`
(returned by `slog.New`, `slog.Default()`, `Logger.With`). Don't copy a
`Logger` value:

```go
// WRONG:
l := *slog.Default()
l.Info("msg")  // works, but if Default() ever holds a mutex, you've broken it
```

```go
// CORRECT:
l := slog.Default()
l.Info("msg")
```

In current Go versions, `Logger` doesn't hold a mutex — but the
package reserves the right. Treating it as a pointer-only type avoids
future surprise.

`Logger.With` returns `*Logger`, so chaining is natural:
`slog.Default().With(...).WithGroup(...)` — every step gives you a
fresh `*Logger`.

## 21. Reading: what to read next

- [professional.md](professional.md) — production patterns: log
  rotation, sampling under load, multi-destination, kubectl-friendly
  output.
- [specification.md](specification.md) — the formal contract reference.
- [optimize.md](optimize.md) — the allocation-free path, when contract
  is correct but performance isn't.
- [find-bug.md](find-bug.md) — drills targeting the items in this file.

External references:

- The official `log/slog` design proposal (Go issue #56345) for the
  rationale behind every interface decision.
- *Logging the Hard Way* (various blog posts on `slog` migration) for
  examples from Cloudflare, Tailscale, and others adopting the
  package.
- The `testing/slogtest` source — a one-file reference for what a
  conforming handler must do.

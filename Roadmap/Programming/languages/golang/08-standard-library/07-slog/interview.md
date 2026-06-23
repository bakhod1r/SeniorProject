# 8.7 `log/slog` — Interview

> **Audience.** Both sides of the table. Candidates use these to drill
> their understanding of `slog`; interviewers use them to find out
> whether someone has shipped Go code that uses structured logging or
> just read the package docs. Each answer is what a strong response
> sounds like — short, specific, with reasoning visible.

## Junior

### Q1. What problem does `log/slog` solve that the older `log` package doesn't?

`log` writes a string per line. There is no level, no key-value
structure, and no way for a log aggregator to search by field other
than running a regex. `slog` adds typed structured attributes (one
record can have `req_id=abc`, `user=42`, `latency_ms=12`), four levels
(Debug/Info/Warn/Error), and an extension interface (`Handler`) that
lets you pick a backend — JSON to stderr, text for the console,
sampling, anything. Existing third-party loggers (zap, zerolog) had
all this; `slog` brings it into the standard library.

### Q2. How do you switch from text output to JSON?

Construct a `slog.JSONHandler` and install it as the default:

```go
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
```

Now every `slog.Info`, `slog.Error`, etc. emits a JSON object per line
to stderr. The shape is `{"time":"...","level":"INFO","msg":"...",...}`.

### Q3. What's the difference between `slog.Info("msg", "k", v)` and `slog.Info("msg", slog.String("k", v))`?

The first is the variadic key-value form; the second uses a typed
`Attr` constructor. They produce identical output. The variadic form
is one line shorter; the typed form skips runtime type assertion (so
it's faster in hot paths) and survives a `go vet -slog` check that
catches missing/extra arguments. For normal code, use either; for
hot paths, prefer `slog.LogAttrs` with typed `Attr`s.

### Q4. What does `slog.With` do?

It returns a new `*Logger` with a set of attributes bound to it. Every
record emitted through the new logger carries those attributes, with
no per-call repetition:

```go
log := slog.With("req_id", id)
log.Info("started")  // emits req_id alongside the message
log.Info("done")     // same
```

The original logger is unchanged; `With` is concurrency-safe.

### Q5. How do you enable Debug-level logs?

`HandlerOptions.Level` controls the minimum level the handler emits.
The default is `LevelInfo`; set it to `LevelDebug`:

```go
h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})
slog.SetDefault(slog.New(h))
```

For a flag-controlled toggle, pick the level at startup based on a
command-line flag or environment variable. For runtime control, use
`slog.LevelVar` and flip it via an HTTP endpoint.

### Q6. Why does `slog` not have `Fatal` or `Panic`?

By design. A logging call should never decide the process's lifetime.
The `log` package's `log.Fatal` (which calls `os.Exit(1)`) is awkward
because it bypasses deferred cleanup and writes the message before
the process disappears. In `slog`, you log the error explicitly, then
exit if you must — the two concerns are separate.

```go
slog.Error("fatal", "err", err)
os.Exit(1)
```

### Q7. What's the right level for a "this happened, but it's recoverable" event?

WARN. INFO is for normal operations; ERROR is for "something failed";
WARN is for "something abnormal happened, but we recovered." A retried
HTTP request, a fallback to a backup database, a configuration value
that's out of range but defaulted — all WARN.

A test that helps distinguish: if the same condition happens 1000
times per minute, would you page someone? If yes, ERROR. If no, WARN
(and the rate is the alert, not the line).

## Middle

### Q8. What does `slog.LogValuer` do, and when should you implement it?

`LogValuer` is a single-method interface (`LogValue() Value`) that
controls how a type renders in log output. Two reasons to implement
it:

1. **Redaction.** A `Token` type whose `LogValue()` returns
   `slog.StringValue("redacted")` never leaks its real value, no
   matter how careless a call site is.
2. **Lazy expansion.** A type whose `LogValue` is expensive to compute
   (a database query, a complex serialization) is called only if the
   record passes the level filter. Filtered Debug calls don't pay the
   cost.

Implement it on any type that has sensitive fields or that should
always log as more than its `%v`.

### Q9. What's the difference between `slog.Group` and `slog.Logger.WithGroup`?

`slog.Group("name", attrs...)` creates one nested attribute on a
single record. `Logger.WithGroup("name")` returns a new logger where
all subsequent attributes are nested under `name`. The first is a
one-shot grouping; the second is a sticky qualifier.

```go
slog.Info("msg", slog.Group("a", slog.Int("k", 1))) // one record, nested "a"
log := slog.Default().WithGroup("a")
log.Info("msg", "k", 1) // every record from `log` has "a.k=1"
```

### Q10. What does `slog.LevelVar` give you that a plain `slog.Level` doesn't?

`LevelVar` is atomic and settable. A handler configured with
`Level: levelVar` reads the current level on every `Enabled` call. You
can flip it at runtime — via a debug HTTP endpoint or a SIGHUP
handler — without restarting the service. A plain `slog.Level` is
a value; once passed to `HandlerOptions`, it's frozen.

### Q11. When should you use `slog.InfoContext` instead of `slog.Info`?

When you have a `context.Context` carrying request-scoped metadata
(request ID, trace ID, tenant ID) that a handler wrapper extracts and
attaches to records. `InfoContext(ctx, ...)` passes the context to
`Handler.Handle(ctx, r)`; the wrapper reads ambient values out of it.
`Info` (no context) effectively passes `context.Background()`, so the
wrapper has nothing to extract. For library code that emits per-
request logs, always use the `Context` variant.

### Q12. What does `HandlerOptions.ReplaceAttr` let you do?

It's called for every attribute the handler is about to emit
(including the built-in `time`, `level`, `msg`, `source`). You can
rewrite the key, the value, both, or return `slog.Attr{}` to drop the
attribute. Common production uses: rename `msg` to `message` for an
aggregator that prefers it; round timestamps to milliseconds; redact
keys named `password` or `secret` as a defence-in-depth net.

### Q13. How do you write a handler that sends records to two destinations?

A multi-handler that holds a slice of handlers and forwards `Handle`
to each:

```go
func (m *multi) Handle(ctx context.Context, r slog.Record) error {
    for _, h := range m.handlers {
        if h.Enabled(ctx, r.Level) {
            _ = h.Handle(ctx, r.Clone())
        }
    }
    return nil
}
```

`r.Clone()` is the load-bearing detail: handlers may mutate the record
(a context-injection wrapper does), and the next handler must see a
fresh copy. `WithAttrs` and `WithGroup` must propagate to all inner
handlers and return a new multi-handler.

### Q14. Why is the variadic form sometimes called "alloc-heavy"?

Each `any` argument boxes its value into an interface, which can
allocate when the value is a non-pointer concrete type. A typical
`Info("msg", "k1", v1, "k2", v2, "k3", v3)` allocates the slice for
the variadic plus boxes for each `vN`. `slog.LogAttrs(ctx, level,
"msg", slog.Int("k1", v1), ...)` takes a slice of typed `Attr`s and
allocates nothing when the record fits in the inline-attr array (5
attributes). For hot paths, the difference is real.

### Q15. What does `slog.SetDefault` do, and is it safe to call concurrently?

It replaces the package-global `Logger` returned by `slog.Default()`.
It's lock-free safe — internally an `atomic.Pointer[Logger]`. A
concurrent `slog.Info` will use either the old or new logger, never a
torn one. As a side effect, it also redirects the `log` package's
output through the new handler, so `log.Println` calls flow into the
same destination. Set it once at startup is the typical pattern; flip
it on signal is the runtime-reconfiguration pattern.

### Q16. What's the bug in `slog.Info("msg", 42)`?

`42` is a non-string in a position where a key (string) is expected.
The variadic walker emits an attribute with the special key
`!BADKEY` and value `42`. The output is something like
`{"!BADKEY":42}`. The runtime doesn't panic — by design — but the
log line is misshapen. A linter (`go vet -slog`, `sloglint`) catches
this at compile time.

## Senior

### Q17. Walk through the full `Handler` contract. What does each method guarantee?

Four methods. `Enabled(ctx, level)` is the cheap pre-check; the
`Logger` calls it before constructing the record, so a filtered call
costs ~1 ns. `Handle(ctx, record)` is where the actual emission
happens; it's called only after `Enabled` returned true, and its
returned error is discarded by the `Logger`. `WithAttrs(attrs)` must
return a *new* handler whose subsequent `Handle` calls include the
bound attributes. `WithGroup(name)` returns a new handler where
subsequent attributes are nested. Both must propagate to inner
handlers in any wrapper. All four must be safe for concurrent use.

### Q18. Why does `Handle` return an error if the error is discarded?

So that wrappers can react. A multi-handler can use the error to mark
the failing destination as degraded; a fallback handler can switch to
a secondary writer. The `Logger`'s decision to discard the error is a
deliberate "the application must not fail because logging failed,"
but inside a wrapper chain, the error is signal — useful before it's
swallowed.

### Q19. When does `Logger.With` allocate, and when doesn't it?

`Logger.With(attrs...)` always allocates one new `Logger` struct (a
small fixed allocation). It also calls `Handler.WithAttrs(attrs)`,
which the standard handlers implement by formatting the attributes
into a buffer once and storing the result — typically one allocation
per `With` call. The savings are at `Handle` time: subsequent records
append the cached bytes instead of re-rendering. So the cost is
amortized: `With` once, log many.

### Q20. What's `Record.Clone` and when must you call it?

`Record.Clone()` returns a deep copy: it duplicates the attribute
slice if the record overflowed past the inline array. You must clone
before mutating a record that's shared across handlers — typically in
a multi-handler that calls `Handle` on multiple inner handlers, where
any of them might `AddAttrs`. Without `Clone`, the second handler
sees the first handler's additions, plus its own, plus whatever
order-of-operations mess that produces.

### Q21. How does the inline-attr array affect allocations?

`Record` stores its first 5 attributes in an inline array (no heap).
Records with ≤ 5 attributes are entirely on the goroutine's stack —
no allocation, no GC overhead. The 6th attribute spills to a heap-
allocated slice; growth past that doubles the slice capacity. For
hot paths, structuring records to stay within 5 attributes (or
nesting via groups) keeps the alloc count at zero.

### Q22. What happens if a `LogValuer` returns another `LogValuer`?

`Resolve()` recurses, calling `LogValue()` again. The recursion is
capped at 4 levels — a `LogValuer` chain longer than 4 returns a
`StringValue` warning ("LogValue called too many times"). The cap
prevents an infinite loop (e.g., `LogValue() Value { return
LogValuerValue(self) }`) from spinning forever. In practice, well-
designed types resolve in one step.

### Q23. How do you make a custom logging wrapper preserve the source line?

The wrapper must call `runtime.Callers` itself to capture the PC of
the caller, then construct a `Record` with that PC and pass it to
`Handler.Handle` directly. Using `Logger.Log` from inside the wrapper
captures the wrapper's PC, not the caller's — every log line points
to the wrapper.

```go
var pcs [1]uintptr
runtime.Callers(2, pcs[:]) // skip Callers + this wrapper
r := slog.NewRecord(time.Now(), level, msg, pcs[0])
r.AddAttrs(attrs...)
_ = h.Handler().Handle(ctx, r)
```

`runtime.Callers(N, ...)` skips N frames; tune N to reach the real
caller.

### Q24. What's the cost of `AddSource: true`?

About 1 µs per record on a modern CPU. The breakdown:
`runtime.Callers` to capture the PC (30–100 ns) plus
`runtime.CallersFrames(...).Next()` to resolve PC to file/line
(200–800 ns, dominated by the first lookup). At 100 records/s the
cost is invisible; at 100 000 records/s it's 10% of one core. For
production hot paths, leave `AddSource` off and turn it on per-record
only at WARN+ via a wrapper handler.

### Q25. How does `slog` know to skip work when the level filter rejects a record?

`Logger.Info` first calls `Handler.Enabled(ctx, slog.LevelInfo)`. If
it returns false, the function returns immediately — no record
construction, no time capture, no source lookup, no attribute
boxing. This is the alloc-free fast path. The cost is one virtual
call (the handler) and one comparison (the level check). For an
INFO-only handler, every Debug call costs 1–2 ns.

### Q26. What's the bug in a custom handler whose `WithAttrs` returns the receiver?

The bound attributes vanish. `Logger.With(attrs)` calls
`handler.WithAttrs(attrs)` and stores the result in the new `Logger`.
If `WithAttrs` returns `h` (the receiver) without storing the
attributes, the new `Logger`'s handler has no record of them. Records
emitted through the new logger don't carry the bound attributes —
silently. Tests that assert on output catch this; tests that assert
on "no panic" don't.

## Staff / Architecture

### Q27. Design a logging architecture for a service with 100K RPS where every request emits 3 INFO records and the log aggregator can ingest only 50K records/s.

Sample. Build a sampler handler that always passes WARN+ and emits 1
in N INFO records, where N keeps the aggregator under capacity
(here, 6). Tag sampled records with `sampled=true` and `sample_rate=6`
so downstream queries can scale up the count to a true rate. For
debugging specific request paths, key the sample decision on a path
attribute — keep `/healthz` at 1/1000 and `/api/critical` at 1/1.

Beyond sampling, async-batch the records: a non-blocking buffered
channel between `Handle` and the writer, with a worker that flushes
every 1 second or 1 MB. Drop records on overflow rather than blocking
the request goroutine. Surface drop counts as a metric so the team
sees when the budget is exceeded.

### Q28. How would you implement audit logging that survives a power loss but doesn't slow down the request path?

Two handlers, two destinations. The operational handler is
synchronous to stderr (k8s captures it). The audit handler writes to
a dedicated append-only file with `O_APPEND` and `Sync`s after every
record — accepting the per-record fsync cost.

For higher audit volume, group-commit: a goroutine collects audit
records during a 100ms window, writes them all, syncs once, and acks
the producers. Throughput climbs to "records per sync" instead of
"records per fsync." See
[../01-io-and-file-handling/optimize.md](../01-io-and-file-handling/optimize.md)
section 10.

The architectural shape: separate the levels-and-sampling concerns
(operational) from the durability-and-correctness concerns (audit).
Don't try to make one handler do both — the trade-offs are opposite.

### Q29. A handler that ships logs to a remote HTTP endpoint blocks under network congestion. How do you keep it from taking down the service?

Wrap with a non-blocking queue and a circuit breaker. The handler's
`Handle` becomes "push to channel; drop on overflow." A worker
goroutine drains the channel and posts to the endpoint. On repeated
failures, the worker opens a circuit breaker that drops records
without trying for a configurable duration; a timer half-opens it
periodically to test recovery.

Track three metrics: queue depth (early warning of backpressure),
drop rate (visibility into what you're losing), and circuit state
(visibility into degradation). Alert on any of them being non-zero
for more than a minute.

The principle: the logging path must never increase the request
path's tail latency. Drops are recoverable; a service stalling on
its log shipper is not.

### Q30. Why might you write a custom handler instead of using `JSONHandler`?

Three real reasons:

1. **Non-standard output shape.** A line format the aggregator
   prefers that JSON doesn't support: pipe-delimited fields, syslog
   priority prefixes, custom escape rules.
2. **Cross-cutting concerns at the handler level.** Sampling,
   redaction, multi-destination, async batching, circuit breaking —
   all are implementable as handler wrappers.
3. **Performance ceiling.** A code-generated handler that pre-formats
   for a specific output format and skips reflection can be 2–3×
   faster than `JSONHandler` for an extremely hot logging path. Used
   in services with tight allocation budgets (`slog.Logger.LogAttrs`
   alone gets you most of the way; the next 30% requires a specialized
   handler).

In all cases, run your handler through `testing/slogtest.TestHandler`
before trusting it. The test suite catches the easy bugs that take
weeks to find in production.

## What to read next

- [find-bug.md](find-bug.md) — practice spotting the bugs the answers
  above describe.
- [tasks.md](tasks.md) — implement the patterns the senior/staff
  questions reference.
- [optimize.md](optimize.md) — the allocation budget for sampling and
  async handlers in Q27 and Q29.

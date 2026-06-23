# 8.7 `log/slog` — Junior

> **Audience.** You've used `log.Println` for years and the output is
> finally being eaten by something that wants JSON, key-value pairs, or
> a real log level. By the end of this file you will know the four types
> the package is built around, the half-dozen functions you'll call most
> days, and the patterns that turn `log.Printf("user=%s req=%d", u, r)`
> into something a log aggregator can search.

## 1. Why `slog` exists

The original `log` package writes a string to `io.Writer`. It has
`Println`, `Printf`, `Fatalf`, and a configurable prefix. Every line is
free-form text:

```go
log.Printf("user %s logged in from %s", user, ip)
// 2026/05/06 14:00:00 user alice logged in from 10.0.0.1
```

Three problems made this painful at scale:

1. **No structure.** A log aggregator (Loki, Elastic, Datadog) sees one
   string per line. To search "all errors for user alice," you write a
   regex. To search "all errors that happened during request X," you
   need a request ID embedded by hand into every line, parsed by a
   regex on the way out.
2. **No levels.** Everything is the same severity. `log.Fatal` exits;
   everything else is "info." There is no DEBUG, no WARN, no per-package
   verbosity.
3. **No structured context.** You repeat `req=%s` in every call site,
   or you pass a custom logger struct everywhere.

Third-party packages — `logrus`, `zap`, `zerolog` — solved this years
before the standard library did. Go 1.21 added `log/slog` with the same
goals: structured key-value output, levels, JSON or text rendering,
and an extension interface (`Handler`) that third-party libraries can
implement so that a service using `slog` can switch backends without
touching call sites.

Use `slog` for new code. Migrate from `log` over time. Keep `zap` or
`zerolog` only if you've measured a specific allocation budget that
`slog` can't meet (see [optimize.md](optimize.md)).

## 2. The four types

```
+----------+        +-----------+        +--------+
|  Logger  |  -->   |  Handler  |  -->   | Writer |
+----------+        +-----------+        +--------+
                          ^
                          |
                    +-----------+
                    |  Record   |  (the log event)
                    +-----------+
                          ^
                          |
                    +-----------+
                    |   Attr    |  (one key-value pair)
                    +-----------+
```

- **`slog.Logger`** is what you call. `Info`, `Error`, `With`,
  `WithGroup`. Holds a `Handler` and a base set of attributes.
- **`slog.Handler`** is the policy: format, destination, level filter,
  attribute transformation. Two ship in the box (`TextHandler`,
  `JSONHandler`); third parties write more.
- **`slog.Record`** is one log event: time, level, message, source
  location, and a list of attributes. Handlers receive it; they
  decide what to do with it.
- **`slog.Attr`** is one key-value pair, typed via `slog.Value`. The
  building block for all structured data in a log line.

The first time you see this, treat the four types as one unit: a
`Logger` builds `Record`s and asks a `Handler` to render them, where the
data inside each record is a list of `Attr`s.

## 3. The default logger and the package-level helpers

The simplest possible use of `slog`:

```go
package main

import "log/slog"

func main() {
    slog.Info("server started", "port", 8080, "version", "1.2.3")
}
```

Output (default `TextHandler` to stderr):

```
time=2026-05-06T14:00:00.123Z level=INFO msg="server started" port=8080 version=1.2.3
```

`slog.Info`, `slog.Warn`, `slog.Error`, and `slog.Debug` are
package-level functions that delegate to the *default* logger. The
default logger writes text to `os.Stderr` and includes time, level, and
message.

The arguments after the message are key-value pairs: alternating string
keys and arbitrary values. You can also pass `slog.Attr` values directly
(see section 6) — both forms work.

## 4. Picking a handler

Two handlers ship in the standard library:

| Handler | Output format | Use it for |
|---------|---------------|------------|
| `slog.TextHandler` | `key=value` pairs, one event per line | Local development, `journalctl`, human-read logs |
| `slog.JSONHandler` | JSON object, one event per line | Production, log aggregators, anything machine-read |

Wire one up at startup:

```go
// JSON to stderr.
h := slog.NewJSONHandler(os.Stderr, nil)
slog.SetDefault(slog.New(h))

slog.Info("server started", "port", 8080)
// {"time":"2026-05-06T14:00:00Z","level":"INFO","msg":"server started","port":8080}
```

`slog.New(handler)` wraps a handler in a `Logger`. `slog.SetDefault`
replaces the package-level default. After that, any package that calls
`slog.Info` (including standard library packages and third-party libraries
that adopted `slog`) inherits the JSON output.

## 5. Levels

```go
slog.Debug("connecting", "host", h)  // -4
slog.Info("connected", "host", h)    //  0
slog.Warn("retrying", "host", h)     //  4
slog.Error("failed", "err", err)     //  8
```

The four built-in levels and their numeric values:

| Level | Constant | Numeric |
|-------|----------|---------|
| Debug | `slog.LevelDebug` | -4 |
| Info | `slog.LevelInfo` | 0 |
| Warn | `slog.LevelWarn` | 4 |
| Error | `slog.LevelError` | 8 |

The numeric gaps are intentional: you can define custom levels in
between (`Verbose = -2`, `Notice = 2`, `Critical = 12`) without
overlapping the built-ins. See [middle.md](middle.md) section 5.

By default, `Debug` is filtered out. To enable it:

```go
h := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
    Level: slog.LevelDebug,
})
slog.SetDefault(slog.New(h))
```

`HandlerOptions.Level` is the minimum level a record must have to be
emitted. Below it, the handler returns from `Enabled` without
formatting anything — the log call is essentially free at runtime.

## 6. Attributes — typed key-value pairs

The variadic `slog.Info("msg", "k1", v1, "k2", v2)` form is
convenient but loosely typed. `slog.Attr` is the typed alternative:

```go
slog.Info("login",
    slog.String("user", username),
    slog.Int("attempts", n),
    slog.Duration("elapsed", time.Since(start)),
    slog.Bool("first_time", !known),
)
```

| Constructor | Wraps |
|-------------|-------|
| `slog.String(key, value)` | `string` |
| `slog.Int(key, value)` | `int` |
| `slog.Int64(key, value)` | `int64` |
| `slog.Uint64(key, value)` | `uint64` |
| `slog.Float64(key, value)` | `float64` |
| `slog.Bool(key, value)` | `bool` |
| `slog.Duration(key, value)` | `time.Duration` |
| `slog.Time(key, value)` | `time.Time` |
| `slog.Any(key, value)` | `any` (last resort) |
| `slog.Group(key, attrs...)` | a nested group |

Use the typed constructors when:

- You're in a hot path. The variadic form does runtime type assertion
  on every value; the typed form does not.
- You need a duration or time formatted natively. The variadic form
  with a `time.Time` value works, but `slog.Time` documents intent.
- You want IDE auto-complete to push you toward the right type.

Use the variadic form for one-shot logs where readability wins. The
two forms produce identical output.

## 7. Loggers with bound context

You almost never want to repeat `req_id` in every log call. Build a
sub-logger that has it baked in:

```go
func handleRequest(ctx context.Context, req *http.Request) {
    log := slog.With(
        "req_id", req.Header.Get("X-Request-Id"),
        "method", req.Method,
        "path", req.URL.Path,
    )
    log.Info("started")
    // ... do work ...
    log.Info("finished", "status", 200)
}
```

`slog.With(args...)` returns a new `Logger` that prepends the supplied
attributes to every record. The original logger is unchanged — it's
safe to call from many goroutines.

Output:

```json
{"time":"...","level":"INFO","msg":"started","req_id":"abc","method":"GET","path":"/"}
{"time":"...","level":"INFO","msg":"finished","req_id":"abc","method":"GET","path":"/","status":200}
```

The same pattern with `Logger.With`:

```go
log := slog.Default().With("subsystem", "billing")
log.Error("invoice failed", "err", err)
```

`With` returns a `*Logger`. Pass it down through your code; treat it
like a context value that knows how to log.

## 8. Errors as a first-class value

There's no `slog.Error("msg", err)`-with-a-real-error helper, but the
idiom is clear:

```go
if err := charge(card); err != nil {
    slog.Error("charge failed", "err", err, "card_id", card.ID)
    return err
}
```

`err` becomes a structured field. `JSONHandler` calls `err.Error()` for
the value. If the error implements `slog.LogValuer` (see
[middle.md](middle.md) section 7), the handler uses that instead — which
is how you attach structured fields to an error type without changing
every call site.

A common shortcut for errors with extra context:

```go
slog.Error("charge failed",
    slog.String("err", err.Error()),
    slog.String("card_id", card.ID),
    slog.Int("amount_cents", card.AmountCents),
)
```

For wrapped errors, log the unwrapped form too if your handler doesn't:

```go
slog.Error("upstream failed",
    "err", err,
    "root", errors.Unwrap(err),
)
```

## 9. Source location

Tell the handler to capture the file/line of each log call:

```go
h := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
    AddSource: true,
})
```

Output:

```
time=... level=INFO source=/path/to/file.go:42 msg="started"
```

`AddSource` adds about 1 µs per log call (a `runtime.Caller` lookup),
so leave it off in hot paths. For services where every Info is a real
event (tens or hundreds per second, not thousands), it's free; for a
record per request × thousand RPS, profile first.

In production, source is most useful at WARN and ERROR. You can write
a custom handler that adds source only for high levels — see
[professional.md](professional.md) section 4.

## 10. JSON, the production default

`JSONHandler` writes one JSON object per line. The keys for time,
level, message, and source are spelled exactly like this:

```json
{"time":"2026-05-06T14:00:00Z","level":"INFO","msg":"started","port":8080}
```

Any aggregator that understands JSON-lines parses this directly. Run
the service with output redirected to a file or to stdout, and let
your collector ingest from there.

Choose JSON over text whenever a machine reads the logs:

| Reader | Format |
|--------|--------|
| You, in `tail -f` | Text |
| `journalctl` (with `_LOG_TYPE=text`) | Text |
| Loki, Elastic, Datadog, Splunk | JSON |
| `jq`, `kubectl logs`, `docker logs` | JSON (so `jq` works) |

A development-mode trick:

```go
var handler slog.Handler
if isDev {
    handler = slog.NewTextHandler(os.Stderr, opts)
} else {
    handler = slog.NewJSONHandler(os.Stderr, opts)
}
slog.SetDefault(slog.New(handler))
```

One environment variable, two outputs, no per-call-site change.

## 11. The `slog.LogValuer` escape hatch

When a value should log differently than its `%v` representation —
typically to redact a secret, or to expand a struct into multiple
fields — implement `LogValue() Value`:

```go
type User struct {
    ID    int
    Email string
    Token string
}

func (u User) LogValue() slog.Value {
    return slog.GroupValue(
        slog.Int("id", u.ID),
        slog.String("email", u.Email),
        // Token deliberately omitted.
    )
}
```

Now any `slog.Info("login", "user", user)` outputs:

```json
{..., "user":{"id":42,"email":"alice@example.com"}}
```

The token never appears, even if the call site passes the whole struct.
This is the right place to enforce redaction — once, at the type — not
in every log call.

## 12. Replacing or extending the default fields

`HandlerOptions.ReplaceAttr` lets you rewrite, drop, or rename any
attribute as records flow through:

```go
h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
    ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
        if a.Key == slog.TimeKey {
            // Use Unix seconds instead of RFC 3339.
            return slog.Int64("ts", a.Value.Time().Unix())
        }
        if a.Key == slog.MessageKey {
            // Rename "msg" to "message".
            return slog.Attr{Key: "message", Value: a.Value}
        }
        return a
    },
})
```

The function is called for every top-level attribute and every nested
group attribute. To drop an attribute entirely, return
`slog.Attr{}` (zero value). Use this for production redaction filters
— see [middle.md](middle.md) section 9.

## 13. Migrating from `log`

The `log` package still works and `log.Default()` is unchanged. To pipe
`log` output through `slog` (so a third-party package using `log` shows
up alongside your structured records), redirect:

```go
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
log.SetOutput(slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo).Writer())
```

Now `log.Println("hi")` becomes a JSON record at INFO level. This is
the easiest way to consolidate output without touching every dependency.

For your own code, the migration is mechanical:

| Before | After |
|--------|-------|
| `log.Println("started")` | `slog.Info("started")` |
| `log.Printf("user=%s", u)` | `slog.Info("user", "user", u)` |
| `log.Fatal(err)` | `slog.Error("fatal", "err", err); os.Exit(1)` |
| `log.New(out, "X ", 0)` | `slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{}))` |

There is no `slog.Fatal` and no `slog.Panic` — the package deliberately
separates "log this" from "exit the process." That separation is
correct: a logging call should never decide the process's lifetime.

## 14. Concurrency

`*slog.Logger` is safe for concurrent use. `slog.SetDefault` is safe to
call concurrently with `slog.Info` from another goroutine — internally
it uses an atomic pointer.

The two built-in handlers (`TextHandler`, `JSONHandler`) are safe for
concurrent use *as long as the underlying `io.Writer` is*. `os.Stderr`
and `os.Stdout` are; a `bytes.Buffer` is not. If you wrap a non-safe
writer, guard it with a mutex or use a per-goroutine `Logger`.

```go
// Safe — os.Stderr's writes are atomic per record up to PIPE_BUF.
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
```

For a `bytes.Buffer` (in tests), wrap with a mutex or use one buffer
per test goroutine.

## 15. A minimal HTTP server with structured logging

```go
package main

import (
    "log/slog"
    "net/http"
    "os"
    "time"
)

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    })))

    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        log := slog.With(
            "method", r.Method,
            "path", r.URL.Path,
            "remote", r.RemoteAddr,
        )
        log.Info("request received")
        w.Write([]byte("ok"))
        log.Info("request handled",
            "status", 200,
            "elapsed_ms", time.Since(start).Milliseconds(),
        )
    })

    slog.Info("listening", "addr", ":8080")
    http.ListenAndServe(":8080", nil)
}
```

Each request emits two structured records. A log aggregator can group
them by `method`+`path`, draw a histogram of `elapsed_ms`, and alert
on the rate of non-200 statuses — none of which a `log.Printf`-based
server makes easy.

## 16. A minimal CLI with debug toggle

```go
package main

import (
    "flag"
    "log/slog"
    "os"
)

func main() {
    debug := flag.Bool("debug", false, "enable debug logging")
    flag.Parse()

    level := slog.LevelInfo
    if *debug {
        level = slog.LevelDebug
    }
    slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
        Level: level,
    })))

    slog.Debug("config loaded", "args", flag.Args())
    slog.Info("starting work")
}
```

A flag flips debug on for one invocation. No restart, no environment
variable spelunking. For runtime control without a restart, see
`slog.LevelVar` in [middle.md](middle.md) section 6.

## 17. The default-handler quirk: where output goes

If you don't call `slog.SetDefault`, the package's default logger
writes to `os.Stderr` using a built-in text handler. The format is
intentionally close to `log.Default()`'s — readable, no JSON noise —
so `slog.Info` from a CLI tool is still grep-friendly.

The destination matters once you start running under a process
manager. systemd, Docker, and Kubernetes capture stderr by default;
some platforms also capture stdout but route it to a different
stream. Sticking with stderr is the safe default:

```go
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
```

If you want both streams (stdout for normal output, stderr for logs),
set the handler to `os.Stderr` and let your CLI's normal output go to
`os.Stdout` via `fmt.Println` or whatever you already use.

## 18. Errors during handler write are silent

`Handler.Handle` returns an `error`. The `Logger` discards it. There
is no global error sink for "the disk filled and your logs are gone."
This is a deliberate design decision — the logging path must never
fail the caller — but it means a service writing to a full disk runs
for hours without realizing the log file is empty.

The two practical mitigations at the junior level:

1. **Write to stderr, not a file directly.** Let the platform handle
   storage.
2. **Periodically check disk space in a side goroutine** for a
   long-lived service that does write to disk.

The deeper version — fallback handlers, error counters, alerts — is in
[professional.md](professional.md) section 14.

## 19. Putting it together: a service template

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    })))

    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        log := slog.With("path", r.URL.Path, "method", r.Method)
        log.Info("request received")
        w.Write([]byte("ok"))
        log.Info("request handled", "status", 200)
    })

    srv := &http.Server{Addr: ":8080", Handler: mux}
    ctx, stop := signal.NotifyContext(context.Background(),
        os.Interrupt, syscall.SIGTERM)
    defer stop()

    go func() {
        slog.Info("listening", "addr", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            slog.Error("server failed", "err", err)
        }
    }()

    <-ctx.Done()
    slog.Info("shutting down")
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        slog.Error("shutdown failed", "err", err)
    }
}
```

The shape: JSON to stderr, structured per-request logger via `With`,
graceful shutdown that emits a final "shutting down" line. Every
record carries the same JSON shape — easy for an aggregator to index,
easy for `jq` at the terminal.

## 20. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| Log lines have an odd field at the end like `"!BADKEY"=2` | An unpaired key/value in the variadic form |
| `Debug` calls produce no output | `HandlerOptions.Level` is INFO (the default) |
| Custom logger field doesn't appear | Forgot `slog.SetDefault`; package-level `slog.Info` still uses the old default |
| Times in JSON have nanosecond precision | Use `ReplaceAttr` to round, or set a custom format |
| Two log lines interleaved character-by-character | Underlying `io.Writer` not safe for concurrent use; wrap with a mutex |
| Source line points to your wrapper, not the call site | Wrapper uses `slog.Logger.Log`; pass the right `pc` via `runtime.Callers` (see [middle.md](middle.md)) |
| Log file empty even though program is running | Buffered writer not flushed; `bufio.Writer` over `os.Stderr` needs explicit `Flush` |
| Custom level shows as `INFO+2` not `NOTICE` | Use `ReplaceAttr` to rename — see [middle.md](middle.md) section 4 |

## 21. What to read next

- [middle.md](middle.md) — groups, custom levels, `LogValuer` for
  redaction, context propagation, and dynamic level changes.
- [senior.md](senior.md) — the exact `Handler` contract, allocation
  model, and how to write your own handler from scratch.
- [tasks.md](tasks.md) — exercises that practice this material.
- The official package docs:
  [`log/slog`](https://pkg.go.dev/log/slog) and the
  [`slog` design doc](https://go.googlesource.com/proposal/+/master/design/56345-structured-logging.md)
  for the rationale behind the API shape.

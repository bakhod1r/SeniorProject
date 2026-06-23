# 8.7 `log/slog` — Tasks

> **Audience.** You've read [junior.md](junior.md) and at least the
> first half of [middle.md](middle.md). These exercises take from an
> hour to a day each. Each task lists a problem statement, acceptance
> criteria, and a stretch goal. No solutions — that's the point.

Common ground rules across all tasks:

- Run with `go test -race`. Any race in your solution disqualifies it.
- Use `testing/slogtest.TestHandler` to validate any custom handler.
- Take `*slog.Logger` parameters where possible so your code is
  testable without touching the global default.
- Wrap errors with `%w` and surface them through `slog.Error`.

## 1. Migrate a small program from `log` to `slog`

Pick a 100–300-line Go program (yours or an open-source one) that uses
the `log` package. Migrate it.

**Acceptance criteria.**

- Every `log.Printf`/`log.Println` becomes a `slog` call with
  structured fields. No `fmt.Sprintf` glue inside log calls.
- A `--debug` flag toggles between INFO and DEBUG.
- Output is JSON in production mode, text in dev mode (selected by an
  `ENV` environment variable).
- Errors are logged with both `err` and any relevant context
  (`user_id`, `path`, etc.) as separate attributes.
- A test asserts that an error path logs an ERROR record with the
  expected `err` field, using a `bytes.Buffer`-backed handler.

**Stretch.** Add a `--source` flag that toggles `AddSource`. Compare
benchmark results with and without source line capture.

## 2. Build a request-scoped logger middleware

Write `slog`-aware HTTP middleware that:

1. Generates a request ID (or extracts `X-Request-Id`).
2. Adds it to the `context.Context` under a custom key.
3. Logs request start and finish with method, path, status, and
   duration.

**Acceptance criteria.**

- A handler wrapper extracts the request ID from the context and adds
  it to every record emitted via `slog.InfoContext` from inside the
  handler. Plain `slog.Info` calls (no context) do *not* get the
  request ID — that's the point of the wrapper.
- `slog.LogAttrs` is used inside the middleware for the alloc-free
  path.
- A test sends a request, captures the records via a custom handler,
  and asserts that all records emitted during the request carry the
  same `req_id`.
- Stop logging when the context is cancelled mid-request — emit a
  WARN with `"client disconnected"` and don't write the normal
  finish line.

**Stretch.** Add trace ID extraction from the W3C `traceparent`
header. Verify with an OpenTelemetry-style test that a span context
in the request context produces a `trace_id` and `span_id` on every
record.

## 3. Implement a redacting `LogValuer`

Define a `Token` type (a string holding a secret) and a `Credentials`
struct (with username, password, and token fields). Implement
`LogValue` on each so they never leak full secrets.

**Acceptance criteria.**

- `Token` logs as the first 3 and last 3 characters with `...` in
  between when at least 6 characters long. Shorter tokens log as
  `redacted`.
- `Credentials` logs as a group with `username` and `token` (the
  redacted form). The `password` field is omitted entirely.
- A test logs a `Credentials` value to a `bytes.Buffer`-backed JSON
  handler, parses the output, and asserts that the password substring
  doesn't appear in the bytes.
- A second test logs a redacted token through a `Logger.With` bind
  and confirms the redaction still happens (i.e., `LogValue` runs
  even for `With`-bound values).

**Stretch.** Add a `Sensitive[T]` generic wrapper that redacts any
type by default, with a hook to customize the redaction format per
type. Document the trade-offs (compile-time safety vs runtime
flexibility).

## 4. Capture handler for tests

Build a `*captureHandler` that records every `slog.Record` it receives
(deep-cloned), exposes `Records() []slog.Record`, and is safe for
concurrent use.

**Acceptance criteria.**

- Implements all four `Handler` methods. `WithAttrs` and `WithGroup`
  bind correctly so emitted records reflect the bound state.
- `Records()` returns a snapshot — modifying the returned slice
  doesn't mutate the captured state.
- Passes `testing/slogtest.TestHandler`.
- Includes a helper `Find(key string) []slog.Attr` that returns every
  attribute with a given key across all captured records.
- A unit test using two goroutines emitting concurrently demonstrates
  that no records are lost or duplicated (check with `-race` and a
  count assertion).

**Stretch.** Add `Equal(records ...string)` — a method that asserts
the captured messages match a list, in order, ignoring time and
source. Useful for table-driven tests.

## 5. Build a multi-handler

Implement a `*multiHandler` that fans out records to N inner handlers,
each with its own level filter.

**Acceptance criteria.**

- `Enabled` returns true if *any* inner handler is enabled at that
  level. `Handle` calls each enabled inner handler with `r.Clone()`.
- `WithAttrs` and `WithGroup` propagate to every inner handler and
  return a new multi-handler whose inner handlers reflect the bound
  state.
- A test wires up a console (text, all levels) and a file (JSON,
  WARN+) and asserts that an INFO record reaches only the console
  while an ERROR reaches both.
- If one inner handler errors, the others still receive the record.
  The multi-handler returns the first error.
- Passes `testing/slogtest.TestHandler`.

**Stretch.** Add per-handler error counters surfaced as a `Stats()`
method. Wire to Prometheus.

## 6. Sampling handler

Build a `*samplingHandler` that emits 1 in N records at INFO and below,
always passes WARN+, and tags sampled records.

**Acceptance criteria.**

- `Handle` increments an `atomic.Uint64` counter; emits when
  `count%N == 0` for INFO/DEBUG, always for WARN/ERROR.
- Sampled records gain `sampled=true` and `sample_rate=N` attributes.
  WARN/ERROR records do not.
- A test emits 100 INFO records and 10 WARN records with N=10; asserts
  that exactly 10 INFOs and 10 WARNs reach the inner handler.
- Concurrent emission across 100 goroutines preserves the sample
  ratio within ±1.
- Passes `testing/slogtest.TestHandler` when N=1 (every record passes).

**Stretch.** Add per-key sampling — different rates for different
attribute values. For example, sample `/healthz` at 1/1000 and
everything else at 1/10. Document the cost of inspecting attributes
at sample time.

## 7. Async (non-blocking) handler

Build an `*asyncHandler` that buffers records on a channel and drains
them in a worker goroutine.

**Acceptance criteria.**

- `Handle` is non-blocking: it writes to a buffered channel with
  `select default`, dropping the record (and incrementing a counter)
  on overflow.
- The worker goroutine reads from the channel and forwards to an
  inner handler. On `Close`, the worker drains the queue and exits.
- A `Stats() (queueLen, dropped int)` method exposes the queue depth
  and total drops.
- A test fills the queue intentionally (block the inner handler),
  asserts that drops happen, and confirms via `Stats()` that no
  records are double-counted.
- A test verifies graceful shutdown: emit 100 records, call `Close`,
  assert the inner handler received all 100.

**Stretch.** Add a `Flush(ctx)` method that blocks until the queue is
empty or the context is cancelled. Useful for periodic flush points
that don't require shutdown.

## 8. Custom level + handler renaming

Define three custom levels: `LevelTrace = LevelDebug - 4`,
`LevelNotice = LevelInfo + 2`, `LevelAudit = LevelWarn + 2`.
Implement a handler wrapper that renames them in output.

**Acceptance criteria.**

- The wrapper uses `ReplaceAttr` (not its own logic) so that any
  underlying handler's behavior is preserved.
- Output for each level shows the friendly name (`TRACE`, `NOTICE`,
  `AUDIT`) instead of the default `DEBUG-4`/`INFO+2`/`WARN+2`.
- A test asserts that JSON output for `LevelAudit` shows
  `"level":"AUDIT"`.
- The wrapper can be combined with any other `slog.Handler` — a test
  composes it on top of a multi-handler from task 5.

**Stretch.** Add a level-to-syslog-priority mapper for the `RFC 5424`
`<priority>` prefix some collectors expect. Document the mapping
(`Trace=DEBUG`, `Notice=INFO`, `Audit=NOTICE`, `Fatal=CRIT`).

## 9. Dynamic level via HTTP

Wire `slog.LevelVar` to an HTTP endpoint that accepts level changes at
runtime.

**Acceptance criteria.**

- `GET /debug/loglevel` returns the current level as JSON.
- `POST /debug/loglevel?level=debug` (with values `debug|info|warn|error`)
  sets the level and returns 200.
- Invalid levels return 400 with a useful message.
- A test runs an HTTP test server, posts a level change, and asserts
  the next `slog.Debug` is emitted.
- The endpoint is goroutine-safe — concurrent posts and emits don't
  race under `-race`.

**Stretch.** Add per-component levels: each subsystem has its own
`LevelVar`, and the endpoint accepts a `component=` query parameter.
The default level applies when no component matches.

## 10. Benchmark suite for handler choice

Build a benchmark that compares emitting 10 000 records via:
1. `slog.Info` (variadic, default JSON handler)
2. `slog.LogAttrs` (typed, default JSON handler)
3. `slog.LogAttrs` through a multi-handler with two destinations
4. A custom handler that no-ops

**Acceptance criteria.**

- Each benchmark uses `b.SetBytes` to report MB/s.
- Run with `-benchmem` and capture allocations per op.
- A short markdown report (in a comment at the top of the benchmark
  file) shows the relative cost of each option on your hardware.
- The fastest path (no-op handler) should show zero allocations per
  emitted record.
- The slowest path (multi-handler with two destinations) should show
  no more than 2× the allocations of a single-destination handler —
  if it does, your `Clone` strategy is over-allocating.

**Stretch.** Add a benchmark for an `asyncHandler` with a
deliberately slow inner handler. Show that the producer's per-call
latency is the same as the no-op handler's, even though the inner
handler is slow. This demonstrates the backpressure isolation that
async handlers provide.

## 11. Audit log writer

Build an audit-log writer that:

1. Writes JSON records to an append-only file.
2. `Sync`s after every record.
3. Survives crashes without losing acknowledged records.

**Acceptance criteria.**

- A custom handler wraps `JSONHandler` over a file opened with
  `O_APPEND|O_CREATE|O_WRONLY`.
- After `Handle` writes, `f.Sync()` is called before returning.
- An ERROR returned by `Sync` propagates up; a higher-level wrapper
  retries the write or alerts.
- A "crash test" simulates a process exit between `Write` and `Sync`
  and asserts that the audit file contains all complete records up to
  the crash.
- The handler accepts a custom level (`LevelAudit`) so audit lines
  don't mix with operational logs.

**Stretch.** Add group commit: collect audit writes during a 100ms
window, write them all, sync once, and signal acks back to producers.
Compare throughput against the per-record sync version.

## 12. Sensitive-field detection

Build a handler wrapper that scans every emitted attribute for a list
of "sensitive" key names (configurable; defaults to `password`,
`secret`, `token`, `api_key`, `authorization`). When found, replace
the value with `[REDACTED]` and increment a counter.

**Acceptance criteria.**

- Implements all four `Handler` methods.
- Inspects every attribute including those inside groups (use
  `r.Attrs` and recurse into `KindGroup` values).
- Replacement happens before the inner handler renders; no sensitive
  bytes ever reach the inner writer.
- A `Stats() (redacted int)` method exposes the counter.
- A test logs a record with `"password"` as a key and asserts that
  the value `"hunter2"` does not appear in the captured output.
- Bonus: redaction is case-insensitive (`Password`, `PASSWORD`,
  `pAsSwOrD` all match).

**Stretch.** Detect sensitive *values* by pattern (a JWT shape, a
credit-card number via Luhn, a bearer token). Redact regardless of
key name. Document the false-positive rate on a corpus of normal
log lines.

## 13. Log rotation integration

Build a handler that writes to a rotating file (using
`gopkg.in/natefinch/lumberjack.v2` or a hand-rolled rotator).

**Acceptance criteria.**

- Wraps the rotating writer in a `slog.JSONHandler`.
- A test writes enough records to trigger rotation and asserts that
  both the active file and the backup file contain valid JSON, one
  record per line.
- Rotation is concurrency-safe — concurrent writes from N goroutines
  don't interleave at sub-record granularity.
- On `SIGHUP`, the handler reopens the file (for log rotators that
  rename and signal).
- Old backups are pruned per a configurable age and count.

**Stretch.** Add gzip compression for rotated files. Verify the
gzipped backups are valid by reading them back through
`gzip.Reader → bufio.Scanner` and parsing each line as JSON.

## 14. Trace-correlated logging

Wire `slog.InfoContext` to OpenTelemetry traces so every log record
emitted inside a span carries `trace_id` and `span_id`.

**Acceptance criteria.**

- A handler wrapper extracts `trace.SpanContextFromContext(ctx)`.
- If the span context is valid, adds `trace_id` and `span_id` to the
  record.
- A test starts an OTel span, calls `slog.InfoContext` inside, and
  asserts both fields appear in the captured output.
- Records emitted outside any span (background goroutines, startup
  log) do not carry the fields.
- Performance: the wrapper adds < 200 ns to `Handle` when no span
  context is present (measured by benchmark).

**Stretch.** Reverse the integration: emit `slog` records as OTel log
records via the `otelslog` bridge. Compare the output across both
modes.

## 15. Migration linter

Write a small `go vet`-style tool (or `analysis.Analyzer`) that warns
when `log.Print*` is used in a file that already imports `log/slog`.

**Acceptance criteria.**

- Implements `golang.org/x/tools/go/analysis.Analyzer`.
- Walks every file in a package; for files that import `log/slog`,
  reports any call to a function from the `log` package.
- A test (`analysistest.Run`) covers positive (warning expected) and
  negative (no warning) cases.
- Output messages name the file, line, and which package the offending
  call came from.

**Stretch.** Suggest a migration: `log.Printf("user=%s err=%v", u, err)`
becomes `slog.Info("operation", "user", u, "err", err)`. The
suggestion is auto-applicable via `gofmt -r` or a custom rewriter.

## 16. Bench: zero-allocation hot path

Write a benchmark that proves a specific log-call shape is
zero-allocation per record.

**Acceptance criteria.**

- The benchmark uses `LogAttrs` with exactly 5 typed `Attr`s, all
  bound at startup via `Logger.With`.
- The handler is `slog.NewJSONHandler(io.Discard, ...)`.
- `b.ReportAllocs()` reports `0 allocs/op`.
- A second benchmark with 6 attrs (over the inline-array limit)
  reports exactly 1 alloc/op.
- A markdown summary in a comment compares the two on your hardware.

**Stretch.** Achieve zero allocs even for 6+ attrs by pooling the
spill slice (write a custom handler that reuses one). Document the
correctness trap: pooled spill slices alias each other across
goroutines if not handled carefully.

## 17. Drop-in replacement for `log.Println`

Build a thin wrapper that lets a codebase still using `log.Println`
emit through `slog` without touching call sites.

**Acceptance criteria.**

- `log.SetOutput(slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo).Writer())`
  redirects the global `log` package.
- `log.SetFlags(0)` disables the legacy timestamp prefix (slog adds
  its own).
- A test calls `log.Println("hi")` and asserts the captured `slog`
  record has `msg="hi"` and `level=INFO`.
- `log.Fatalln(err)` still exits with code 1; the message is captured
  via slog before exit (test in a sub-process).

**Stretch.** Detect the level from the prefix: `log.Println("WARN: ...")`
becomes a WARN record. Document the trade-off (pattern-matching
fragility vs unified output).

Write a small `go vet`-style tool (or `analysis.Analyzer`) that warns
when `log.Print*` is used in a file that already imports `log/slog`.

**Acceptance criteria.**

- Implements `golang.org/x/tools/go/analysis.Analyzer`.
- Walks every file in a package; for files that import `log/slog`,
  reports any call to a function from the `log` package.
- A test (`analysistest.Run`) covers positive (warning expected) and
  negative (no warning) cases.
- Output messages name the file, line, and which package the offending
  call came from.

**Stretch.** Suggest a migration: `log.Printf("user=%s err=%v", u, err)`
becomes `slog.Info("operation", "user", u, "err", err)`. The
suggestion is auto-applicable via `gofmt -r` or a custom rewriter.

## What to read next

- [find-bug.md](find-bug.md) — once your solutions work, look for the
  bugs you might have missed.
- [optimize.md](optimize.md) — for tasks 6, 7, 10, see how to squeeze
  the next 10× of throughput out of a working implementation.
- [interview.md](interview.md) — turn each task into an interview
  prompt: "walk me through how you'd build this."

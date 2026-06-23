# 8.7 `log/slog` — Optimize

> **Audience.** You have correct logging code and you need it cheaper —
> fewer allocations in the hot path, fewer syscalls under load, less GC
> pressure during traffic spikes. This file walks through the structural
> changes that pay off, the standard handler's allocation model, and
> the patterns that cut a `slog` hot path from "fast enough" to
> "essentially free." Numbers are typical for a modern x86 server with
> Go 1.22; your workload may differ. Always measure before and after.

## 1. Measure first

The expensive mistake is guessing where logging cost goes. Standard
profiling tooling applies:

| Profile | Captures | When to reach for it |
|---------|----------|----------------------|
| CPU profile | Stack samples while CPU is busy | Logging shows up in flame graph |
| Heap profile | Live allocations | Logging is allocating per call |
| Trace | Goroutine events | Logging blocks request goroutines |
| Benchmark | Allocations + ns/op | Comparing two implementations |

Wire pprof and benchmark two paths:

```go
func BenchmarkLogInfo(b *testing.B) {
    h := slog.NewJSONHandler(io.Discard, nil)
    log := slog.New(h)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        log.Info("event", "k1", "v1", "k2", "v2", "k3", 42)
    }
}

func BenchmarkLogAttrs(b *testing.B) {
    h := slog.NewJSONHandler(io.Discard, nil)
    log := slog.New(h)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        log.LogAttrs(context.Background(), slog.LevelInfo, "event",
            slog.String("k1", "v1"),
            slog.String("k2", "v2"),
            slog.Int("k3", 42),
        )
    }
}
```

Typical results on a 2024 laptop:

```
BenchmarkLogInfo-8     1500000   780 ns/op   3 allocs/op
BenchmarkLogAttrs-8    2200000   460 ns/op   0 allocs/op
```

The variadic form's three allocations: one for the variadic slice,
two for boxing the string and int values into `any`. `LogAttrs`
skips both: typed `Attr` constructors don't box, and the slice fits
on the stack.

## 2. The variadic vs `LogAttrs` choice

| Path | Boxing | Slice escape | Inline array |
|------|--------|--------------|--------------|
| `Info("msg", "k", v)` (variadic) | One per non-pointer value | Sometimes | Yes if ≤ 5 attrs |
| `LogAttrs(ctx, level, "msg", attr...)` | None | Sometimes | Yes if ≤ 5 attrs |
| `Logger.With("k", v).Info("msg")` | One per `With` value | Once | At `With` time |

For one-off log calls in cold code, use the variadic form. For hot
paths called thousands of times per second, use `LogAttrs`. For
attributes that don't change for the lifetime of a logger (service
name, version, request ID), bind them with `With` so the cost is paid
once.

## 3. Stay inside the inline-attr array

`Record` stores up to 5 attributes inline (no heap). The 6th allocates
a slice. Patterns that keep records under 5:

- **Group related fields.** `slog.Group("request", "method", m, "path", p)`
  is one attribute holding a group, regardless of how many fields the
  group has.
- **Bind unchanging fields with `With`.** `service`, `version`, `host`
  are bound once at startup and don't count against the per-record
  budget.
- **Promote to a `LogValuer`.** A struct that logs as a group via
  `LogValue` is one record-level attribute; the expansion into N
  fields happens at the handler.

For records that genuinely need 6+ top-level attributes, the heap
allocation is one slice — measurable but not catastrophic. Don't
contort the code to avoid one alloc; measure first.

## 4. Pre-formatting via `Logger.With`

The standard handlers pre-format `WithAttrs` output once and cache the
bytes. A logger built once at startup with five bound fields renders
those fields exactly once across its lifetime.

```go
base := slog.Default().With(
    "service", "billing",
    "version", buildVersion,
    "host", hostname,
    "shard", shardID,
)
// Each request:
log := base.With("req_id", reqID)
log.Info("started")
log.Info("checked rate limit")
log.Info("finished")
```

The pre-format happens at the `With` calls. Each `Info` call writes
the cached `service=billing,version=1.2.3,host=...,shard=...` once,
then formats the per-call attributes.

Compare with binding everything at the call site:

```go
slog.Info("started",
    "service", "billing", "version", buildVersion,
    "host", hostname, "shard", shardID, "req_id", reqID,
)
slog.Info("checked rate limit",
    "service", "billing", "version", buildVersion,
    "host", hostname, "shard", shardID, "req_id", reqID,
)
```

The bound fields render fresh on every record — five extra format
calls per record, three records, fifteen wasted formatting calls.

The `With` pattern compounds: bind service-wide fields at startup,
component-wide fields per-component, request-wide fields per-request.
Each layer is rendered once.

## 5. Source line cost

`AddSource: true` adds:

| Operation | Cost |
|-----------|------|
| `runtime.Callers(N, pcs)` | 30–100 ns |
| `runtime.CallersFrames(pcs).Next()` | 200–800 ns |
| Total per record | ~1 µs |

At 100K records/s, this is 10% of a core. For most services it's
fine. For services where logging dominates the CPU profile, three
mitigations:

1. **Disable in production.** Set `AddSource: false`. The trade-off
   is grep-ability of crash dumps; if every record is structured and
   every error includes the call site explicitly (`slog.String("at",
   "package/file.go:42")`), source attribution is fine without it.
2. **Per-level enabling.** Wrap the handler so source is captured only
   at WARN and above:

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

3. **Sample source capture.** Capture source on 1 in 100 records
   regardless of level — a "stack sample" of where the service is
   spending its log volume.

## 6. JSON encoding overhead

`JSONHandler` encodes via the standard `encoding/json` package's
internals plus its own buffer management. The hot path is:

1. `Handle` allocates (or pools) a buffer.
2. Writes the header (`{"time":...,"level":...,"msg":...`).
3. Appends the cached `WithAttrs` bytes (no encoding).
4. Iterates the record's attrs, writing `,"key":value`.
5. Writes the closing `}\n`.
6. Calls the underlying `io.Writer`'s `Write` once.

The dominant cost in step 4 is per-attribute string escaping for keys
and string values. Numbers, booleans, and durations are cheap.

For services where JSON encoding is the bottleneck, two paths:

1. **Custom handler with code-generated encoding.** A handler that
   knows your record shape can skip reflection and emit bytes
   directly. The custom-encoded form is typically 2–3× faster than
   `JSONHandler`. Worth it only if logging is a measurable fraction
   of CPU.
2. **Replace the JSON encoder.** A handler built on `goccy/go-json` or
   `bytedance/sonic` (faster JSON encoders) is a drop-in replacement.
   Same caveat: only worth it for hot paths.

## 7. Buffering the destination

A `JSONHandler` writing to `os.Stderr` makes one `Write` syscall per
record — typically 1 µs of kernel time. At 100K records/s, that's 10%
of a core in syscalls alone.

Wrap with `bufio.Writer`:

```go
bw := bufio.NewWriterSize(os.Stderr, 64*1024)
slog.SetDefault(slog.New(slog.NewJSONHandler(bw, nil)))
```

The buffered writer batches records into 64 KiB chunks, cutting
syscalls by 10–100×. Trade-off: records stay in the buffer until it
fills or `Flush` runs. On crash, the unflushed records are lost.

For services where every record matters (audit logs), don't buffer.
For services where the loss of the last 4 KiB is acceptable, do.

The `bufio.Writer` itself is not concurrent-safe — but the standard
handlers serialize their writes to the underlying writer with an
internal mutex, so the combination is safe.

For graceful shutdown:

```go
defer bw.Flush()
```

Combined with `signal.NotifyContext` for SIGTERM, the buffer flushes
before `main` returns.

## 8. Async handlers and the GC

An async handler with a buffered channel decouples the producer from
the I/O cost. The channel itself adds:

- One allocation per record (the channel send copies the `Record`
  by value, but the spill slice for attrs is shared).
- Synchronization on each send (cheap on uncontended channels).
- Memory pressure proportional to queue depth.

For a queue of 10 000 records with 6+ attributes each, the spill
slices add up to non-trivial heap. `Record.Clone` on send is the
right move — but cloning re-allocates the spill slice.

The compromise: a small inline-array record (`≤5` attrs) is
zero-alloc to clone. For services that target this, design log calls
to stay within 5 attributes, and the async path is essentially free.

## 9. Sampling cost

A sampling handler that emits 1 in N records pays:

| Operation | Cost |
|-----------|------|
| `atomic.Uint64.Add` | ~5 ns |
| `n%N == 0` check | <1 ns |
| `Record.Clone` (when emitting) | ~50 ns + spill |

So the sampler's amortized cost per record is `5ns + emit_cost/N`. At
N=10, the emit cost is split 10:1 — most records pay only the
counter increment.

For very high-rate workloads (1M+ records/s pre-sample), even the
atomic increment is a contention point. A per-CPU counter (using
`runtime.GOMAXPROCS()` independent counters) avoids the cache-line
bouncing. The Go standard library doesn't expose this directly, but
`golang.org/x/sync` and various third-party packages do.

## 10. `LogValuer` and lazy evaluation

A `LogValuer` is called only if the record reaches a handler. For an
expensive computation, this is the difference between paying it on
every call vs only on the calls that survive the level filter.

```go
type expensiveValue struct {
    db *sql.DB
}

func (e expensiveValue) LogValue() slog.Value {
    return slog.IntValue(queryRowCount(e.db))
}

slog.Debug("status", "rows", expensiveValue{db: db})
```

If the level is INFO, `Debug` is filtered before `LogValue` runs. The
DB query never happens. For a service where `Debug` is off in
production, this is the difference between adding a row count to
every record (free) vs adding it only when debugging (paid).

The trick is that the variadic form sometimes evaluates eagerly:

```go
slog.Debug("status", "rows", queryRowCount(db)) // always runs
slog.Debug("status", "rows", expensiveValue{db}) // lazy
```

The first call evaluates `queryRowCount(db)` before `slog.Debug` is
even called — Go's argument evaluation is eager. The second wraps the
work in a `LogValuer` so `Resolve` is the entry point.

For benchmarks, compare the two: at INFO level, the first benchmarks
include the query cost; the second don't.

## 11. Pooling the output buffer

The standard `JSONHandler` allocates an output buffer per `Handle`
call (the bytes that go into `Write`). For high-throughput logging,
pool it:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

type pooledHandler struct {
    inner slog.Handler
}

// Note: this requires implementing Handle from scratch — the standard
// JSONHandler doesn't expose the buffer. For a real win, write a
// custom handler that uses the pool throughout.
```

Pooling output buffers in a real custom handler typically saves 30–50%
of the allocations on the hot path. Whether it's worth the complexity
depends on logging volume.

`sync.Pool` items can be reclaimed by GC at any time — don't rely on
getting back the same buffer. Reset on `Get`, return on `Put`.

## 12. The `Enabled` fast path

`Logger.Info` calls `Handler.Enabled(ctx, slog.LevelInfo)` first. If
it returns false, the function returns immediately — no record
construction, no time capture, no allocation.

For the standard handlers, `Enabled` is:

```go
func (h *JSONHandler) Enabled(_ context.Context, level slog.Level) bool {
    return level >= h.opts.Level.Level()
}
```

`Leveler.Level()` is one atomic load. The whole `Enabled` call is ~1 ns.
This is why filtered Debug calls in production are essentially free —
which means you should leave Debug calls in the code, even if they're
disabled in production. The cost of a disabled Debug is the cost of an
atomic load.

For custom handlers, keep `Enabled` cheap. Don't acquire mutexes,
don't allocate, don't read from a slow source. The whole optimization
depends on `Enabled` being faster than the work it gates.

## 13. Avoiding `fmt.Sprintf` inside log calls

```go
slog.Info("user logged in", "details", fmt.Sprintf("id=%d email=%s", u.ID, u.Email))
```

`fmt.Sprintf` allocates a string, formats into it, and returns. The
result becomes one structured field — but its internal structure is
gone. Searches for `email=foo@bar.com` need a regex.

Replace with structured fields:

```go
slog.Info("user logged in", "user_id", u.ID, "email", u.Email)
```

Or use a `LogValuer` on the user type that expands to a group:

```go
slog.Info("user logged in", "user", u)
```

Both are faster (one `Sprintf` allocation per record gone) and more
useful (each field is searchable independently).

## 14. Time formatting

Both standard handlers use `time.Format(time.RFC3339Nano)` or
`time.MarshalJSON` for timestamps. The cost is ~150 ns per record.
For services emitting millions of records per second, this adds up.

Two reductions worth knowing:

1. **Round to milliseconds.** Less precision means a shorter string
   and faster formatting:

   ```go
   ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
       if a.Key == slog.TimeKey {
           t := a.Value.Time().Round(time.Millisecond)
           return slog.Time(slog.TimeKey, t)
       }
       return a
   }
   ```

2. **Use Unix milliseconds.** An integer is faster to format than an
   RFC 3339 string:

   ```go
   if a.Key == slog.TimeKey {
       return slog.Int64("ts_ms", a.Value.Time().UnixMilli())
   }
   ```

   Aggregators like Loki and Datadog accept Unix-ms timestamps. For
   Elasticsearch, the choice depends on your index template.

The savings: ~100 ns per record. For a service that logs at 100K
records/s, this is ~10ms of CPU per second — roughly 1% of a core. A
real but small win; pursue only if profiling has already nailed
logging as the bottleneck.

## 15. Concurrency and lock contention

The standard handlers hold a mutex around the write to the underlying
writer. For services emitting millions of records per second from
many goroutines, the mutex becomes a contention point.

The mutex protects the *write*, not the *format*. So multiple
goroutines can format records in parallel; only the final
`io.Writer.Write` serializes. For a fast writer (`os.Stderr`,
`bytes.Buffer` with mutex), the contention window is 1–10 µs.

Mitigations for extreme rates:

1. **Per-goroutine handler.** Each goroutine has its own
   `JSONHandler` over its own `io.Writer`, merged downstream. Skips
   the contention but loses ordering across goroutines.
2. **Buffer-then-flush pattern.** Each goroutine accumulates records
   into a local buffer; a single goroutine flushes them periodically.
   Reduces lock acquisitions to one per flush window.
3. **Async handler with one writer.** All goroutines push to a
   buffered channel; one writer goroutine drains. The channel send
   is the only contention (cheap, lock-free in the common case).

For 99% of services, the standard handler's mutex is fine. Profile
before reaching for these patterns.

## 16. Allocation budget per record

A reasonable target for a hot path:

| Operation | Allocations |
|-----------|-------------|
| `LogAttrs` with ≤ 5 typed attrs, filtered out | 0 |
| `LogAttrs` with ≤ 5 typed attrs, emitted | 0–1 (output buffer if not pooled) |
| `LogAttrs` with 6+ attrs, emitted | 1 (spill slice) + 0–1 (output buffer) |
| Variadic `Info` with 3 boxable values, emitted | 4 (variadic slice + 3 boxes) + 0–1 (output buffer) |

A service that targets "zero allocations per emitted record" needs:

1. `LogAttrs` exclusively in hot paths.
2. Records ≤ 5 attributes (use groups or `With`).
3. A custom handler with a pooled output buffer.

Steps 1 and 2 alone get you very close. Step 3 closes the gap; whether
the complexity is worth it depends on your profile.

## 17. Benchmarking with `benchstat`

Compare two implementations rigorously:

```sh
go test -run x -bench BenchmarkLog -count 10 > old.txt
# make changes
go test -run x -bench BenchmarkLog -count 10 > new.txt
benchstat old.txt new.txt
```

`benchstat` reports the median, geometric mean, and a p-value. If the
p-value is greater than 0.05, the difference is inside the noise floor
— your "improvement" isn't statistically significant.

Run benchmarks with the production handler stack, not just
`io.Discard`:

```go
func BenchmarkProduction(b *testing.B) {
    var buf bytes.Buffer
    h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
        Level:     slog.LevelInfo,
        AddSource: false,
    })
    h = sample(ctxInject(h, 10), 10)
    log := slog.New(h)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        log.LogAttrs(context.Background(), slog.LevelInfo, "request handled",
            slog.String("method", "GET"),
            slog.String("path", "/"),
            slog.Int("status", 200),
        )
        buf.Reset()
    }
}
```

The numbers from this benchmark match real production cost. Numbers
from a `Default()` handler over `io.Discard` are best-case-only — they
don't reflect what your service actually pays.

## 18. When optimization is over

Stop optimizing logging when:

- The CPU profile shows logging at < 5% of total. Other things
  matter more.
- Allocations per emitted record are at zero (with `LogAttrs`,
  records ≤ 5 attrs, pooled buffers).
- The benchmark p-value won't go below 0.05 — you're inside noise.
- The next 10% would require a custom handler that's 200 lines of
  code and has to be re-tested every Go release.

Document the chosen baseline. Most services don't need to go past
"`LogAttrs` everywhere, JSON to stderr, sampling for INFO, source
off in prod." That's already 5–10× faster than the naive `log.Printf`
it replaced.

## 19. A worked example: 10× speedup

A request-handling service emitting three INFO records per request at
10K RPS — 30K records/s. Initial profile shows logging at 25% of CPU.

Three changes:

1. **Convert variadic to `LogAttrs`.** Six attributes per record;
   variadic was allocating ~5 per call. Down to 0–1. Saves ~40% of
   logging cost.
2. **Bind `service`, `version`, `req_id` with `With`.** The first two
   never change; the third is per-request. Pre-format saves the
   render cost on every record. Saves another ~20%.
3. **Sample INFO at 1/3.** Three records per request → one sampled,
   three logged at WARN+ if errors. Reduces logging volume to 10K
   records/s. Saves a further ~60% of remaining cost.

Compounded: from 25% of CPU to ~5%. The aggregator's bill drops
proportionally.

## 20. What to read next

- [find-bug.md](find-bug.md) — the bugs you might introduce while
  optimizing (especially #8, hot-path variadic; #16, escaping slice).
- [professional.md](professional.md) — production patterns these
  optimizations should fit into.
- [senior.md](senior.md) — the contracts you must not violate even
  in the name of speed.
- [`../01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md)
  — for the writer-side optimizations (buffering, syscalls, pools)
  that compose with `slog`.

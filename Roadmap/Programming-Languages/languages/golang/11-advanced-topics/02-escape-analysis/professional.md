# Escape Analysis — Professional

## 1. Why this matters in production

In a service running millions of requests per day, a single allocation per request that should have stayed on the stack is a million extra heap allocations and a million extra objects for the GC to mark. Over a week, that's billions. Escape analysis literacy turns a sneaky 8% CPU regression into a one-line code change.

The professional approach isn't "no allocations" — it's "allocations match expectations and are reviewed when they change".

---

## 2. The CI alloc-budget pattern

Bake an allocation budget into your benchmark suite and have CI fail when it's exceeded.

```go
func BenchmarkServeRequest(b *testing.B) {
    b.ReportAllocs()
    req := testRequest()
    for i := 0; i < b.N; i++ {
        _ = handle(req)
    }
}
```

In CI:

```bash
go test -bench=. -benchmem -count=10 ./... | tee new.txt
benchstat -alpha=0.01 baseline.txt new.txt > stat.txt
# Fail if any allocs/op rises significantly
grep -E "allocs/op.*\+[0-9]+\.[0-9]+%" stat.txt && exit 1
```

The discipline is what matters. The exact tooling can vary (`benchstat`, custom Go programs reading the JSON output of `-bench=. -test.benchtime`, golden files of allocs/op per route).

---

## 3. Per-request budget on the critical path

```
allocs_per_request_budget = 50
target_p99_alloc_bytes = 16 KiB
```

Pick a number. Track it. The "right" budget depends on your workload, but having any explicit number is better than having none.

Methods that work in practice:

- Annotate each major handler with `// alloc-budget: 30 allocs/op` in the function comment, alongside an enforcing benchmark.
- A weekly job that runs the same benchmark and posts the trend.
- A PR template question: "Does this change increase allocs/op on benchmarks X, Y, Z?"

---

## 4. The high-leverage code review checks

For PRs touching hot paths:

1. **Any new `interface{}` or `any` parameter?** If yes, ask: can this be a generic, or a concrete type?
2. **Any new `fmt.Sprintf` or `fmt.Errorf`?** If hot, replace with `strconv` + manual string assembly, or pre-formatted templates.
3. **Any new `errors.Wrap` chain?** Each wrap allocates. Consider sentinel errors for known cases.
4. **Any closure captured in a long-lived struct?** Document the lifetime.
5. **Any `reflect.X` in the path?** Reflection cascades into many escapes; usually not appropriate for the critical path.
6. **Any pointer return from a small struct constructor?** Consider value return.
7. **Any growing slice in a loop without preallocation?** `append` storms allocate.

---

## 5. Replacing `interface{}` with generics, correctly

Generics replace boxing — but not unconditionally.

```go
// Before: boxes every call
func Logf(level int, format string, args ...any) { /* ... */ }
```

Switching to generics for the variadic doesn't help; the moment `args` is read as `any`, the compiler is back to boxing.

The right replacement depends on the call shape:

- **Typed structured log:** `slog.Info("msg", slog.Int("user", id), slog.String("ip", ip))`.
- **Single-type loops:** `func Sum[T constraints.Integer](xs []T) T`.
- **Mixed types via wrapper struct:** define a discriminated union (`type LogArg struct { I64 int64; Str string; Tag int }`) and use that as the parameter type.

Generics aren't a silver bullet; they're a tool for shape-monomorphic code paths. Audit your API and pick consciously.

---

## 6. The `slog` migration as escape work

A common production gain in 2024 was moving from `log.Printf` to `log/slog` with structured attributes. Beyond the API improvements, the alloc profile shrinks:

```go
log.Printf("user=%d ip=%s", id, ip)         // boxes id and ip
slog.Info("login", "user", id, "ip", ip)    // also boxes — slog's variadic any
slog.Info("login", slog.Int("user", id), slog.String("ip", ip))  // typed: minimal boxing
```

Using the typed `slog.Attr` constructors is the difference. They also enable the `slog.Handler` to skip allocations entirely when the log line is below the level threshold (the attrs are still constructed, but their lifecycle is short).

---

## 7. Routing escape away from the request context

A frequent footgun: stuffing request-scoped data into `context.Context` via `WithValue`.

```go
ctx = context.WithValue(ctx, userKey{}, user)
```

Every layer of `WithValue` allocates a wrapper. In a hot path with five middlewares, that's five allocations per request before your handler runs. Two production patterns:

1. **One struct per request, passed explicitly.** A `*RequestState` field bag, threaded through. Zero allocations at the propagation layer; readable types.
2. **Context only for cancellation and the trace ID.** Everything else lives in your request struct.

The cost of `context.WithValue` is a real allocation, every middleware, every request. For a 100k-RPS service that adds up fast.

---

## 8. JSON: where escape analysis fights you

`encoding/json` is convenient and slow. For hot paths:

- `json.Marshal` allocates the entire output buffer plus per-field formatters.
- `json.Unmarshal` allocates the target if it includes interfaces, maps, or pointers.
- `json.RawMessage` defers parsing of nested fields.
- Code-generated marshalers (`easyjson`, `ffjson`, `go-json`) typically halve the allocations.

For very high throughput consider:

- A schema-based codec (Protobuf, FlatBuffers, Cap'n Proto).
- Hand-rolled emit for the top 3 response shapes.
- `bytes.Buffer` reuse via `sync.Pool` for the output buffer.

For ordinary endpoints, default `encoding/json` is fine; spend the engineering on the 95th-percentile-payload route.

---

## 9. Error wrapping at scale

```go
return fmt.Errorf("read header: %w", err)
```

Each `Errorf` allocates the formatted string, a `*fmt.wrapError`, and copies the wrapper into the return slot. Not expensive once. Expensive across millions of error returns per second (typical for a streaming or polling service that encounters EOF as a normal signal).

Mitigations:

- Sentinel errors for known signals: `var ErrNoData = errors.New("no data")`.
- Use the `errors.Is`/`errors.As` taxonomy, not formatted-string matching.
- Avoid wrapping `io.EOF` in hot read loops.

---

## 10. Real-world story: the `time.Now().UnixNano()` ID generator

A handler generated request IDs by combining the time with a random suffix. Profile showed allocations in the path from `time.Now()` → `Time.UnixNano()` → `fmt.Sprintf`.

Before:

```go
id := fmt.Sprintf("%d-%d", time.Now().UnixNano(), rand.Int63())
```

After:

```go
var idBuf [40]byte
b := idBuf[:0]
b = strconv.AppendInt(b, time.Now().UnixNano(), 10)
b = append(b, '-')
b = strconv.AppendInt(b, rand.Int63(), 10)
id := string(b)
```

Two heap allocs → one (the final `string(b)`). The change took five minutes; the win was 5% CPU. Multiply across a fleet.

---

## 11. Documenting an allocation contract

For public packages (libraries) used in hot paths, document allocation behavior:

```go
// Format appends a formatted message to dst and returns it.
// Allocates zero objects when len(args) <= 4 and dst has enough capacity.
func Format(dst []byte, format string, args ...any) []byte { ... }
```

The contract becomes part of the API. Callers can rely on it; you can write a benchmark that fails if the contract breaks.

---

## 12. Tools beyond `-gcflags="-m"`

| Tool | When |
|------|------|
| `go test -benchmem -benchtime=5s` | Catch alloc regressions with more iterations |
| `go tool pprof -alloc_objects` | Cumulative alloc counts (different from in-use) |
| `go tool pprof -alloc_space` | Cumulative bytes |
| `benchstat -alpha=0.01` | Statistically valid before/after comparison |
| `perflock` (linux) | Quiesce CPU for reliable benchmarks |
| `go test -trace trace.out` + `go tool trace` | Allocations interleaved with goroutine activity |

For long-lived services, use the runtime's continuous-profiling endpoint (`/debug/pprof/allocs`) and store profiles weekly. Compare a "Monday" snapshot week-to-week.

---

## 13. The trap: optimizing benchmarks, not workloads

A benchmark can hit zero allocs because the test runner reuses memory and the compiler proves your benchmark-specific values don't escape. In production, the same code under real concurrency may show allocations. Always confirm with **production-like load**: real-shape inputs, concurrent goroutines, real `runtime/metrics` readings, not just `b.AllocsPerOp()`.

---

## 14. Summary

Production escape work is budgeted, reviewed, and measured. Hot paths get explicit alloc budgets enforced by benchmarks; PRs touching them get a checklist; tooling (`benchstat`, `pprof`, `-gcflags="-m"`) is part of the daily flow. The wins are real but small per change; the discipline compounds across a year of releases.

---

## Further reading
- `log/slog` performance: https://go.dev/blog/slog
- "High-performance JSON parser": https://github.com/goccy/go-json
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- continuous profiling (Pyroscope, Parca): https://github.com/parca-dev/parca

# Modern Standard-Library Additions — Optimization

> Honest framing first: most of these APIs are already fast — the Go team designed them with allocation and contention in mind. The real wins come from using them *correctly* (the `LogAttrs` fast path, sets instead of linear scans, interning the right field) and from *removing dependencies* the stdlib now replaces (a logger, a router) which shrinks builds, binaries, and audit surface. Each entry states the problem, a "before", an "after", and the realistic gain. The closing sections cover measurement and the cases where the optimization is the wrong move.

---

## Optimization 1 — Use `LogAttrs` on hot logging paths

**Problem:** The convenient `logger.Info(msg, args...)` form boxes every value into `any` and assembles pairs at runtime — allocations that add up in high-throughput request handlers.

**Before:**
```go
logger.Info("request done", "method", m, "status", code, "ms", elapsed)
```
Each call allocates an `[]any` and boxes `code`, `elapsed`, etc.

**After:**
```go
logger.LogAttrs(ctx, slog.LevelInfo, "request done",
    slog.String("method", m),
    slog.Int("status", code),
    slog.Int64("ms", elapsed),
)
```
Typed `Attr`s use `slog.Value`'s union representation — no per-value `any` boxing.

**Expected gain:** Fewer `allocs/op` per log line (often the dominant allocation in a request). Measure with `-benchmem`; in log-heavy services this meaningfully reduces GC pressure.

---

## Optimization 2 — Guard expensive log construction with `Enabled`

**Problem:** Building an attribute is expensive (serialising a struct, formatting), but the log level is disabled in production, so the work is wasted.

**Before:**
```go
logger.Debug("state", "snapshot", expensiveJSON(state)) // runs even when Debug is off
```

**After:**
```go
if logger.Enabled(ctx, slog.LevelDebug) {
    logger.Debug("state", "snapshot", expensiveJSON(state))
}
// or make snapshot a LogValuer so it resolves lazily only when emitted.
```

**Expected gain:** The expensive call vanishes entirely on disabled levels. For a `Debug` line in a hot loop, this is the difference between paying the cost on every request and paying it never.

---

## Optimization 3 — Replace linear `Contains` with a set

**Problem:** `slices.Contains` is O(n). Calling it inside a loop over the same slice is O(n²).

**Before:**
```go
for _, x := range incoming {
    if slices.Contains(allowed, x) { admit(x) } // O(len(allowed)) each
}
```

**After:**
```go
set := make(map[T]struct{}, len(allowed))
for _, a := range allowed { set[a] = struct{}{} }
for _, x := range incoming {
    if _, ok := set[x]; ok { admit(x) } // O(1) each
}
```

**Expected gain:** From O(n·m) to O(n+m). For `allowed` of thousands and `incoming` of thousands, this turns a multi-millisecond hot spot into microseconds. Use `slices.Contains` only for small or one-shot checks.

---

## Optimization 4 — Intern a repetitive field with `unique`

**Problem:** Millions of records each carry a string drawn from a tiny set (region, status, tenant), so the heap stores millions of duplicate string headers and bytes.

**Before:**
```go
type Row struct{ Region string } // "us-east-1" stored a million times
```

**After:**
```go
type Row struct{ Region unique.Handle[string] }
r := Row{Region: unique.Make(region)}
// later: r.Region.Value()
```

**Expected gain:** Heap residency for that field collapses to one canonical copy per distinct value, plus a small handle per row. Equality (`r1.Region == r2.Region`) becomes a pointer compare, speeding up group-by/dedup. Verify with `inuse_space` heap profiles — the win is residency, not `Make` micro-latency. **Only** apply to genuinely repetitive fields; interning unique data is pure overhead.

---

## Optimization 5 — Drop the router dependency

**Problem:** A `gorilla/mux`/`chi` dependency exists solely for method + path-variable routing that the stdlib now provides (Go 1.22+).

**Before:**
```go
r := mux.NewRouter()
r.HandleFunc("/items/{id}", h).Methods("GET")
// + a go.mod dependency, its transitive deps, and its CVE surface
```

**After:**
```go
mux := http.NewServeMux()
mux.HandleFunc("GET /items/{id}", h)
```

**Expected gain:** One fewer dependency (and its transitive closure) in `go.mod` — smaller builds, smaller binary, less to audit and patch. Routing performance is competitive, and the stdlib mux avoids some third-party per-request allocations. Keep `chi` only if you genuinely need its middleware/grouping ergonomics.

---

## Optimization 6 — Reuse a buffer pool in a custom JSON handler

**Problem:** A custom `slog.Handler` allocates a fresh `[]byte`/`strings.Builder` per record; at high log volume this churns the GC.

**Before:**
```go
func (h *h) Handle(_ context.Context, r slog.Record) error {
    var b strings.Builder // new allocation every record
    // ... format ...
}
```

**After:**
```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func (h *h) Handle(_ context.Context, r slog.Record) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)
    // ... format into buf ...
    _, err := h.w.Write(buf.Bytes())
    return err
}
```

**Expected gain:** Per-record buffer allocations drop to near zero under load. This is what the stdlib JSON handler does internally; replicate it in custom handlers serving hot paths.

---

## Optimization 7 — Use `math/rand/v2` to remove a global-mutex bottleneck

**Problem:** Concurrent goroutines calling v1 `math/rand` top-level functions contend on the package's global mutex.

**Before:**
```go
import "math/rand" // v1; global functions share one mutex
go func(){ _ = rand.Intn(100) }() // contended under load
```

**After:**
```go
import "math/rand/v2" // global path avoids the v1 mutex bottleneck
_ = rand.IntN(100)
// or give each goroutine its own *rand.Rand for full independence
```

**Expected gain:** Reduced lock contention on randomness in highly-concurrent code (rate-limiter jitter, load-balancer choices). Under heavy parallelism this removes a measurable serialization point.

---

## Optimization 8 — Pre-size and reuse with `slices.Clip`/`Grow`

**Problem:** Repeated `append` without capacity hints reallocates; and sharing a sliced-down backing array causes a later `append` to clobber data.

**Before:**
```go
out := existing[:0]          // reuse backing array
out = append(out, more...)   // may overwrite data still referenced via `existing`
```

**After:**
```go
out := slices.Clip(existing[:0]) // cap == len, so append reallocates safely
out = append(out, more...)
// or pre-size a fresh slice:
out := make([]T, 0, len(a)+len(b))
```

**Expected gain:** Avoids both surprise data corruption and repeated growth reallocations. `slices.Grow(s, n)` reserves capacity for `n` more elements in one allocation when the final size is known.

---

## Measuring

- **Allocations:** `go test -bench . -benchmem` and read `allocs/op`. The `slog` variadic-vs-`LogAttrs` and custom-handler-pool wins show here.
- **Heap residency:** `go test -memprofile` / `pprof -inuse_space`. The `unique` interning win shows here, not in `-bench`.
- **Contention:** `go test -bench . -cpu 1,4,16` and the mutex profile (`runtime.SetMutexProfileFraction`) for the `math/rand` global-mutex win.
- **Stability:** run benchmarks multiple times and compare with `benchstat`; single runs are noise.
- **Build/binary size:** `go build -o /dev/null` timing and `ls -l` on the binary before/after dropping a router dependency.

---

## When These Optimizations Are the Wrong Move

- **`LogAttrs` everywhere** harms readability for cold-path logging (startup, rare errors). Use the variadic form where it is clearer and the path is not hot.
- **`unique` on unique or low-repetition data** is negative — `Make` costs a lookup with no residency win. Profile first.
- **A buffer pool in a low-volume handler** adds complexity for no measurable gain. Pool only proven hot paths.
- **Sets instead of `slices.Contains`** for tiny slices (a handful of elements) is over-engineering — the linear scan is faster than building a map.
- **Dropping `chi`/`echo`** purely to remove a dependency, when you actually use its middleware/grouping, trades real ergonomics for a marginal footprint win.
- **`math/rand/v2` for determinism-sensitive code** without injecting an explicit seeded source breaks reproducibility — the absence of global `Seed` is a correctness consideration, not just a perf one.

The honest summary: the biggest, safest wins are using `slog`'s fast path, choosing sets over linear scans on hot paths, and deleting dependencies the stdlib now replaces. Reach for interning and pooling only with a profile in hand.

# Reflection — Professional

## 1. Reflection is a library-author tool

In application code, reflection should be rare. It tends to show up legitimately in three places:

1. **At service boundaries** — JSON, Protobuf, gRPC, env config, CLI flags.
2. **In testing** — fixtures, fakes, deep comparisons.
3. **In framework code** — DI containers, RPC routers, validators.

If you find yourself reaching for `reflect` in business logic, ask whether an interface, generic, or `switch v := x.(type)` does the job. Almost always one of them does.

---

## 2. The "reflect once, dispatch fast" architecture

For a library that processes arbitrary structs:

```
register/init time: reflect, build per-type plan, cache by Type
                              ↓
runtime hot path:    look up plan from cache, run prebuilt functions
```

```go
type plan struct {
    fields []fieldPlan
}

type fieldPlan struct {
    offset uintptr
    decode func(p unsafe.Pointer, src string)
}

var planCache sync.Map

func planFor(t reflect.Type) *plan {
    if p, ok := planCache.Load(t); ok {
        return p.(*plan)
    }
    p := buildPlan(t)
    planCache.Store(t, p)
    return p
}
```

The first request for each new type pays full reflection cost; subsequent requests are nearly as fast as hand-written code. This is the only sensible architecture for high-throughput reflection in production.

---

## 3. Code generation as the alternative

For very hot paths, generate code at build time:

- `easyjson`, `ffjson`: JSON marshalers per type.
- `protoc-gen-go`: Protobuf message types and (de)serializers.
- `stringer`: enum `String()` methods.
- `sqlc`, `xo`: typed database access from SQL.
- Custom generators via `go generate` + `go/types` + `go/format`.

Pros: zero reflection cost, clear errors, IDE navigation.
Cons: an extra build step, a generated-file checkbox in PRs, drift risk if generation isn't gated in CI.

Decision rule: if reflection eats more than a few percent of the service's CPU after caching, switch to generation for that path.

---

## 4. JSON, the production view

`encoding/json` is the universal compromise — correct, well-documented, and built into the standard library. For most services, it's fine. For high-throughput JSON:

| Library | Strategy | When |
|---------|----------|------|
| `encoding/json` | Reflection per call | Default; correctness over speed |
| `goccy/go-json` | Reflection + cached `unsafe` | 2–4× faster, mostly drop-in |
| `bytedance/sonic` | SIMD + JIT (amd64) | Highest throughput, more complex |
| `easyjson` (generated) | Per-type code | Bench-driven, narrow use |

Sonic is mature in production at ByteDance. Be aware of platform limits (amd64 only for the JIT path).

---

## 5. Validation libraries: cache the plan

`github.com/go-playground/validator/v10`, `asaskevich/govalidator`, custom validators — all use reflection. The patterns:

```go
var v = validator.New()

// At struct registration time, the library reflects once and caches the plan.
// Subsequent v.Struct(obj) calls hit the cached plan.

err := v.Struct(req)
```

Performance impact: typically a few microseconds per validation, dominated by the actual checks (regex, range) rather than reflection. Acceptable for service request paths; verify in your bench.

---

## 6. Configuration loading patterns

```go
type AppConfig struct {
    Port     int           `env:"PORT" default:"8080"`
    Database string        `env:"DATABASE_URL" required:"true"`
    Timeout  time.Duration `env:"TIMEOUT" default:"5s"`
}

var cfg AppConfig
must(envconfig.Process("", &cfg))
```

This runs once at startup. The reflection cost is irrelevant. Choose ergonomics over performance for config code.

Libraries: `kelseyhightower/envconfig`, `spf13/viper`, `caarlos0/env`. All reflection-based; all fine.

---

## 7. DI containers in Go

Reflection-based DI (e.g., `uber-go/dig`, `google/wire`) wires up dependency graphs. Two flavors:

| Approach | Library | Pros / Cons |
|----------|---------|-------------|
| Reflection at startup | `dig` | Flexible, dynamic, slow startup, runtime errors |
| Code generation | `wire` | Compile-time validation, faster startup, more boilerplate |

In a large service, reflection-based DI adds 100–500 ms to startup but trivial steady-state cost. For tools that start frequently (CLIs, batch jobs), prefer codegen.

---

## 8. Reflection in tests

```go
import "github.com/google/go-cmp/cmp"

if diff := cmp.Diff(want, got); diff != "" {
    t.Errorf("mismatch (-want +got):\n%s", diff)
}
```

`go-cmp` is the modern standard for test equality. It:

- Handles nil-vs-empty explicitly.
- Produces a readable diff.
- Supports `cmpopts.IgnoreFields`, `IgnoreUnexported`, `EquateApprox`, etc.

Use it instead of `reflect.DeepEqual` in new tests.

---

## 9. Logging structured fields

```go
// reflection-heavy: log/slog with `any`
slog.Info("request", "user", user, "duration", elapsed)

// minimal reflection: typed attrs
slog.Info("request",
    slog.String("user", user.Name),
    slog.Duration("duration", elapsed),
)
```

The first form reflects on each value to format. The second uses typed accessors that avoid most reflection. In services that log millions of lines per hour, the difference is measurable.

---

## 10. CLI flag binding

`spf13/cobra` + `viper`, or `urfave/cli`, both use reflection to bind flags to fields. For a CLI with hundreds of commands, reflection at startup is a few ms. Acceptable.

For a CLI that runs as a child of `go test` many thousands of times in CI, that few ms compounds. Consider lighter-weight `flag` standard-library wiring if startup matters.

---

## 11. ORMs and SQL access

| Library | Reflection? | Notes |
|---------|-------------|-------|
| `database/sql` | Light (per-row `Scan`) | Standard; reflection is per-row but well-amortized |
| `gorm` | Heavy | Convenient; reflection cost is real on hot paths |
| `sqlx` | Moderate | Thin wrapper over `database/sql` |
| `ent`, `sqlc` | None (codegen) | Typed access, no reflection at runtime |

For a service where DB latency dominates anyway, reflection cost is in the noise. For low-latency, high-RPS DB-backed services, generated access wins.

---

## 12. The cost of `Interface()`

Every `v.Interface()` boxes into `any`. For a struct walker that calls `Interface()` per field:

```go
for i := 0; i < v.NumField(); i++ {
    out[i] = v.Field(i).Interface()    // allocation per field
}
```

For a 10-field struct processed at 100K/sec, that's a million allocations per second purely for the interface conversion. If you only need the bytes / int / string, use the kind-specific accessors:

```go
case reflect.Int, reflect.Int64:
    write(v.Field(i).Int())          // no allocation
case reflect.String:
    write(v.Field(i).String())       // no allocation
```

---

## 13. Documenting reflection in your APIs

If your library uses reflection:

- Document which fields are read and how tags are parsed.
- Document whether unexported fields are accessed (they shouldn't be).
- Document the per-type setup cost (cached on first use vs. per call).
- Provide a typed alternative for callers who care: `validator.RegisterValidation` vs. generic struct validation.

This turns reflection from black magic into a normal feature with a contract.

---

## 14. Summary

Production reflection is a tool for library authors; in application code, prefer interfaces, generics, type switches, or code generation. The standard pattern when reflection is justified: reflect once at first contact with a type, cache a plan keyed by `reflect.Type`, and dispatch through prebuilt fast paths (closures over `unsafe.Pointer` offsets) for subsequent calls. Measure, then choose; reflection is fine when it's not the bottleneck and a real liability when it is.

---

## Further reading
- `encoding/json/v2` proposal: https://github.com/golang/go/discussions/63397
- `goccy/go-json`: https://github.com/goccy/go-json
- `bytedance/sonic`: https://github.com/bytedance/sonic
- `google/wire` vs `uber-go/dig`: DI tradeoffs

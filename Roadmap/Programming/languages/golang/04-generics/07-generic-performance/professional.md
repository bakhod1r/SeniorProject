# Generic Performance — Professional Level

## Table of Contents
1. [Real-world migration: `sort.Slice` to `slices.SortFunc`](#real-world-migration-sortslice-to-slicessortfunc)
2. [Profiling generic code with pprof](#profiling-generic-code-with-pprof)
3. [Reading flame graphs with stencil names](#reading-flame-graphs-with-stencil-names)
4. [Decision framework: keep, generic, specialize](#decision-framework-keep-generic-specialize)
5. [PGO for generics](#pgo-for-generics)
6. [Migration playbook](#migration-playbook)
7. [Case studies](#case-studies)
8. [Continuous performance regression checks](#continuous-performance-regression-checks)
9. [Summary](#summary)

---

## Real-world migration: `sort.Slice` to `slices.SortFunc`

A canonical professional migration. The pre-1.18 idiom:

```go
import "sort"

sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})
```

The 1.21+ idiom:

```go
import "slices"

slices.SortFunc(users, func(a, b User) int {
    return a.Age - b.Age // (or cmp.Compare(a.Age, b.Age))
})
```

### What changed

| Aspect | `sort.Slice` | `slices.SortFunc` |
|--------|--------------|-------------------|
| Element access | Index-based; `users[i]`, `users[j]` | Value-based; `a`, `b` |
| Comparator | `func(i, j int) bool` | `func(a, b T) int` |
| Internal dispatch | Reflection; cannot inline | Generic; comparator inlines |
| Stability | Unstable | Unstable; use `SortStableFunc` for stable |

### Why it is faster

The pre-generic `sort.Slice` calls into the runtime, which uses reflection to swap and access elements. The comparator is also called indirectly, defeating inlining.

`slices.SortFunc` knows the type at compile time. The comparator inlines into the partition step. No reflection.

### Real numbers

For 10,000 random `User` structs:

| Implementation | ns/op | allocs/op |
|----------------|-------|-----------|
| `sort.Slice` | 880,000 | ~30 |
| `slices.SortFunc` | 540,000 | 0 |

Roughly **38% faster** and zero allocations.

### Migration checklist

1. Bump to Go 1.21+.
2. Identify all `sort.Slice` and `sort.SliceStable` call sites.
3. Convert comparators from `(i, j int) bool` to `(a, b T) int`.
4. Run benchmarks before / after on the hottest sort sites.
5. Remove `import "sort"` once all sites are converted.
6. Document in CHANGELOG so future reviewers know not to revert.

---

## Profiling generic code with pprof

`pprof` is unchanged in mechanics — what changes is how to read the output.

### Capturing a CPU profile

```go
import _ "net/http/pprof"

go func() { http.ListenAndServe(":6060", nil) }()
```

```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30
```

### Capturing a heap profile

```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap
```

### Capturing in tests

```go
func TestHotPath(t *testing.T) {
    f, _ := os.Create("cpu.pprof")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()
    runWorkload()
}
```

### Reading generic-specific output

The flat / cum tables show entries like:

```
  flat   flat%   sum%    cum   cum%
 1.20s  24.0%  24.0%  1.20s  24.0%  pkg.Find[go.shape.string]
 0.80s  16.0%  40.0%  0.80s  16.0%  pkg.Find[go.shape.int_0]
 0.30s   6.0%  46.0%  0.30s   6.0%  pkg.Find[go.shape.*pkg.User]
```

Three different stencils, three different costs. Do **not** group them mentally — they are independent hot paths. If `Find[*User]` is the bottleneck, the optimization (specialize, change type, drop generic) only applies to that stencil.

### Heap profile signals

Look for:

- `runtime.convT2I` / `runtime.convT2E` — boxing into interface (likely outside the generic).
- Allocations attributed to `[go.shape.*]` symbols — the generic body itself escaped a value.
- `runtime.mapaccess2` for generic maps — the dictionary path.

### `go tool trace`

For latency-sensitive services, `runtime/trace` reveals goroutine blocking and per-stencil scheduler events. Generic code shows up by name in the trace viewer.

---

## Reading flame graphs with stencil names

Flame graphs become noisier with generics — the same logical function appears in multiple stripes, one per shape. Tactics:

### 1. Group mentally, optimize separately

If `Find[go.shape.int_0]` and `Find[go.shape.string]` are both hot, you have **two** optimization targets. The fix may be different for each.

### 2. Use `--inuse_objects` and `--alloc_objects`

When chasing allocations:

```bash
go tool pprof -alloc_objects ./prof.heap
```

Distinguish bytes allocated (size) from number of allocations (count). For generic-induced boxing, the number is what hurts.

### 3. Filter by stencil

```bash
(pprof) top10 Find\[
```

Shows only entries matching the regex. Useful when one generic helper dominates.

### 4. Diff profiles

```bash
go tool pprof -base before.pprof after.pprof
```

Confirm that your optimization actually moved the needle on the right stencil and did not regress others.

---

## Decision framework: keep, generic, specialize

For each performance-relevant function, choose:

- **Keep** — concrete, no change.
- **Generic** — convert to a type-parameterised version.
- **Specialize** — keep generic API, add a hand-rolled wrapper for the hot type.

### The framework

```
                 │
                 ▼
    Is this on a hot path?
         │              │
         no             yes
         │              │
         ▼              ▼
   Convenience?    Single concrete type?
       │              │            │
      yes            yes           no (multiple shapes)
       │              │            │
   Generic       Concrete     Generic + specialized
    fine          wrapper      wrapper for hot shape
```

### Worked example 1 — Internal helper

```go
func Keys[K comparable, V any](m map[K]V) []K { ... }
```

Used in 50 places, none on a hot path. Decision: **generic**. Saves duplication.

### Worked example 2 — Cache hot path

```go
type Cache[K comparable, V any] struct { ... }
```

Service-wide cache, called 50k QPS, exclusively `string → *User`. Decision: **specialize**. Keep `Cache[K, V]` for tests and edge cases; add a `userCache` wrapper for production.

### Worked example 3 — Sorting

`sort.Slice` everywhere, called from many places. Decision: **migrate to `slices.SortFunc`** — it is generic and faster.

---

## PGO for generics

Profile-guided optimization (Go 1.21+) lets the compiler use a runtime profile to make better decisions:

1. Capture a CPU profile from production: `cpu.pprof`.
2. Place it next to `main.go` as `default.pgo` (or pass with `-pgo=...`).
3. Build with `go build -pgo=auto` (Go 1.21+ default if `default.pgo` exists).

### Why generics benefit

PGO devirtualizes more aggressively. A generic method call that the compiler could not statically resolve becomes a direct call when the profile shows one type dominates. Per the Go team's own measurements, PGO saves 2-5% on real services with generic-heavy hot paths.

### Practical workflow

1. Deploy a build without PGO; capture profile.
2. Build with PGO; deploy.
3. Verify the new build's profile.
4. Periodically refresh the PGO profile (monthly is enough for most services).

---

## Migration playbook

A repeatable plan for moving a codebase from `interface{}` to generics with performance in mind.

### Phase 0 — Baseline

- Add benchmarks for the hot paths you intend to migrate.
- Capture a `pprof` from production.
- Note current p50/p99 latencies and CPU per request.

### Phase 1 — Pilot

- Pick one self-contained helper (a cache, a queue, a utility function).
- Convert to generics.
- Benchmark before / after on the hot path.
- Compare p99 latency and allocation rate.
- Document numbers in the PR.

### Phase 2 — Replicate

- Apply the same pattern to two or three more modules.
- Watch for regressions in compile time and binary size.
- Establish team-wide naming and constraint conventions.

### Phase 3 — Scale

- Roll out across the codebase.
- Update CI to run benchmarks on PRs that touch generic helpers.
- Add a "no perf regression" check to the deploy pipeline.

### Phase 4 — Maintain

- Refresh PGO profiles monthly.
- Re-benchmark on every Go release; performance drifts as the compiler evolves.
- Document migration outcomes in an internal "performance journal" so the team learns.

---

## Case studies

### Case study 1 — A high-throughput message broker

A team migrating an in-memory broker from `chan interface{}` to `chan T` via generics:

- **Before:** 1.2M msg/sec; 30% of CPU spent in `runtime.convT2E`.
- **After:** 1.9M msg/sec; boxing path gone.
- **Cost:** 0.5% binary size growth.
- **Lessons:** Generic channels (`chan T` in a generic struct) gave the biggest single win in the codebase.

### Case study 2 — A cache that got slightly slower

A team rewrote a `map[string]interface{}` cache as `Cache[K comparable, V any]`. The expectation: faster.

- **Before:** 60 ns/op, 1 allocation
- **After:** 75 ns/op, 0 allocations

Why? The cache was instantiated for **15 distinct value types** in one binary. The dictionary cost added up. The fix:

- Keep `Cache[K, V]` for the long tail of types
- Specialize for the three types that account for 80% of traffic

After specialization: 35 ns/op for the hot types; 75 ns/op for the rest. Total CPU fell.

### Case study 3 — `slices.SortFunc` win

A logging pipeline sorted millions of records by timestamp. Migration from `sort.Slice` to `slices.SortFunc`:

- **Before:** 880 µs per 10k sort
- **After:** 540 µs per 10k sort
- **Wall-clock saving:** 8 minutes per nightly batch

A two-line change with no risk and a meaningful business effect.

### Case study 4 — A service that did not benefit

A request-handler used `interface{}`-keyed maps for a feature flag cache. The team genericized it and saw **no difference** — the cache was cold (rarely hit), and even per-request the boxing cost was negligible.

Lesson: **measure before and after; not every generic conversion improves performance**.

---

## Continuous performance regression checks

Generic performance is **not stable across Go releases**. The compiler keeps improving, but occasionally a release moves a particular benchmark in the wrong direction. Professionals invest in CI checks.

### Benchstat-driven gating

```bash
go test -bench=. -count=10 > new.txt
benchstat old.txt new.txt
```

Set a regression threshold (e.g., +5% on critical benchmarks fails CI). Tooling: `benchstat`, `gobenchdata`, or a homegrown script.

### Track binary size

```bash
go build -o bin/app .
ls -la bin/app
```

Regression threshold: e.g., +2% binary growth requires manual approval.

### Track allocations

`testing.B.ReportAllocs()` is fine; for production, `runtime.ReadMemStats` or `expvar` exports allocation rate. Alert if it spikes after a deploy.

### Profile-driven canaries

Before promoting a generic refactor:

1. Deploy to a canary at 1% traffic.
2. Capture a `pprof`.
3. Compare against a baseline.
4. Promote only if metrics are within bounds.

### Tooling matrix

| Tool | What it gates |
|------|---------------|
| `benchstat` | Microbenchmarks |
| `pprof diff` | CPU and heap |
| `go tool nm` | Binary symbol size |
| Datadog / Prometheus | Production p50/p99/QPS/allocations |
| CI (GitHub Actions, Buildkite) | Run benchmarks on PRs touching generic code |

---

## Summary

The professional level of generic performance is **operational discipline**:

1. **Benchmark before refactoring**, with realistic input sizes.
2. **Capture pprof in production**, read stencil names, treat shapes as separate hot paths.
3. **Decide per function** — keep, generic, or specialize — based on workload, not aesthetics.
4. **Use PGO** for further wins on hot generic paths.
5. **Migrate gradually**, with a baseline-pilot-replicate-scale plan.
6. **Gate regressions in CI** so improvements stick.

Generic performance is a **continuous practice**, not a one-time decision. Each Go release shifts the trade-offs slightly. A professional team treats this like any other operational concern — measured, monitored, and iterated.

The next file (`specification.md`) collects the formal references to the implementation design documents you will need when arguing about generic performance with the compiler team or reviewing a runtime CL.

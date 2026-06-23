# pprof — Optimization

These exercises focus on **profiling workflow** itself — making captures faster, smaller, and more actionable — rather than on optimizing the profiled program. Numbers are illustrative; measure on your own systems.

---

## Exercise 1: Profile the optimized binary, not the debug binary

**Before** — `go build -gcflags='all=-N -l' ./...` (or running under `dlv exec` with optimizations off) produces a profile that reflects a binary nobody runs. Hot paths shift; inlining decisions disappear; escape analysis is suppressed.

**After:**

```bash
go build ./...                        # default optimization + inlining
go test -bench=. -cpuprofile=cpu.prof # capture with normal flags
```

| Metric | `-N -l` binary | optimized binary |
|--------|----------------|------------------|
| Reflects production code paths | no | yes |
| Inlining decisions visible | no | yes |
| Optimization based on this profile is valid | no | yes |

If you need to see what `inner` does inside `outer`, use `list outer` — the per-line view annotates inlined bodies without changing the build.

---

## Exercise 2: Right-size the capture window

**Before** — a 1-second CPU capture has too few samples (~100 at default 100 Hz) and is noisy. A 5-minute capture is huge and averages multiple traffic phases together.

**After:**

```bash
# benchmarks: cover all of b.N stably
go test -bench=BenchmarkX -cpuprofile=cpu.prof -benchtime=5s

# production: 30s is the sweet spot
curl -o cpu.prof "http://prod:6060/debug/pprof/profile?seconds=30"
```

| Metric | 1s capture | 30s capture | 5min capture |
|--------|-----------|-------------|--------------|
| Sample count | ~100 | ~3000 | ~30000 |
| Noise per top function | high | low | low (but averaged across phases) |
| File size | tiny | small | large |

Thirty seconds gives 30x the samples with the same overhead per second.

---

## Exercise 3: Continuous profiling instead of ad-hoc

**Before** — every investigation starts by SSH-ing to a pod, running `curl ... profile?seconds=30`, downloading, opening locally. By the time you have data, the incident is over.

**After** — run a continuous profiler that captures short profiles on a schedule and ships them to a backend:

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "svc",
    ServerAddress:   "http://pyroscope:4040",
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileAllocObjects, pyroscope.ProfileAllocSpace,
        pyroscope.ProfileInuseObjects, pyroscope.ProfileInuseSpace,
    },
})
```

| Metric | ad-hoc curl | continuous |
|--------|-------------|-----------|
| Time-to-evidence after incident | minutes | seconds |
| Can answer "what was hot at 03:14"? | no | yes |
| Per-instance overhead | none most of the time | ~1-2% CPU continuous |

The 1-2% cost is worth it for any service where on-call paging is expensive.

---

## Exercise 4: Use `-base` to find regressions only

**Before** — each release a human stares at the new flame graph for an hour, hoping to spot what got worse.

**After** — diff the new profile against the previous release's profile and only investigate functions whose **delta** is positive:

```bash
go tool pprof -http=:8080 -base=v1.5.0.prof v1.6.0.prof
```

| Metric | full profile | `-base` delta |
|--------|--------------|---------------|
| Functions to inspect | hundreds | <10 (regressions only) |
| Time per release review | ~1 hour | ~5 minutes |
| Misses small but real regressions | often | rarely |

Automate this in CI: fail the PR if any function regresses by >X% on a fixed benchmark.

---

## Exercise 5: Stable benchmark captures

**Before** — `go test -bench=. -cpuprofile=cpu.prof` with the default `-benchtime=1s` produces a different profile every run; small samples make `top` reorder between captures.

**After:**

```bash
go test -bench=BenchmarkX -benchtime=5s -count=3 \
        -cpuprofile=cpu.prof -memprofile=mem.prof
```

| Metric | 1s, count=1 | 5s, count=3 |
|--------|-------------|-------------|
| Run-to-run noise in `top` | high | low |
| Reliable enough to use with `-base` | no | yes |

`benchstat` (the companion tool) consumes the text output and gives you statistical comparison; profiles benefit from the same stability discipline.

---

## Exercise 6: Use `peek` for fast inspection of one function

**Before** — opening the `-http` UI for every quick lookup. Useful for exploration but slow for "is X still hot?" checks.

**After:**

```bash
go tool pprof cpu.prof
(pprof) peek myFunc
                                       flat  flat%   sum%        cum   cum%
                                          .      .      .        12s  60.0%   myFunc
                                       2.5s  12.5%  12.5%         .      .        runtime.mallocgc (inline)
                                       1.0s   5.0%  17.5%         .      .        bytes.Buffer.Write
```

| Metric | open `-http` | `peek myFunc` |
|--------|--------------|---------------|
| Time to answer "what calls myFunc?" | ~30s (browser, navigate) | ~1s |
| Suitable for scripting | no | yes (`-peek=myFunc` flag) |

Pair with `go tool pprof -peek=myFunc cpu.prof` for one-shot use in shell scripts.

---

## Exercise 7: Label work with `pprof.Do` to isolate concerns

**Before** — one shared handler processes "search" and "render" requests; the CPU profile shows their combined cost, and you cannot tell which is the bottleneck.

**After:**

```go
import "runtime/pprof"

pprof.Do(ctx, pprof.Labels("op", "search"), func(ctx context.Context) {
    runSearch(ctx)
})
pprof.Do(ctx, pprof.Labels("op", "render"), func(ctx context.Context) {
    runRender(ctx)
})
```

```bash
(pprof) top -tagfocus=op:search   # only search samples
(pprof) top -tagfocus=op:render   # only render samples
```

| Metric | unlabeled | labeled |
|--------|-----------|---------|
| Can isolate one operation | no | yes |
| Per-tenant attribution possible | no | yes (add `tenant:` label) |
| Profile size | smaller | slightly larger |

Use labels sparingly — high-cardinality keys (e.g., per-request IDs) bloat the file. Stick to operation/tenant/route names.

---

## Exercise 8: Production capture behind a feature flag

**Before** — pprof is always on in production. Risk: someone hits `?seconds=600` and pegs a CPU during peak traffic.

**After** — gate the more expensive endpoints behind a runtime flag:

```go
admin.HandleFunc("/debug/pprof/profile", func(w http.ResponseWriter, r *http.Request) {
    if !profilingEnabled.Load() {
        http.Error(w, "disabled", http.StatusServiceUnavailable)
        return
    }
    if s, _ := strconv.Atoi(r.URL.Query().Get("seconds")); s > 60 {
        http.Error(w, "max 60s", http.StatusBadRequest)
        return
    }
    pprof.Profile(w, r) // delegate to standard handler
})
```

| Metric | always-on | gated |
|--------|-----------|-------|
| DoS risk from a long capture | yes | bounded (60s cap) |
| Captures available during incident | yes | yes (flip the flag) |
| Standard endpoints still work | yes | yes |

Pair the flag with metrics; you want to see when profiling is enabled and by whom.

---

## Measurement checklist
- [ ] Profile the optimized binary, never `-N -l`.
- [ ] Capture at least 30s in production, at least 5s for benchmarks.
- [ ] Adopt continuous profiling for any on-call service.
- [ ] Use `-base` for every release review; automate the threshold in CI.
- [ ] Use `peek` or `-peek=` for quick lookups; reserve `-http` for exploration.
- [ ] Label distinct workloads with `pprof.Do` so profiles can be sliced.
- [ ] Cap and gate production capture endpoints.

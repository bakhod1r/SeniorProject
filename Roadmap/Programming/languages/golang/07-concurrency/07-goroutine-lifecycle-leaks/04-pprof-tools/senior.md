# pprof and Profiling Tools — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Goroutine Labels and `pprof.Do`](#goroutine-labels-and-pprofdo)
3. [Per-Label Profile Analysis](#per-label-profile-analysis)
4. [Custom Profiles](#custom-profiles)
5. [Continuous Profiling Backends](#continuous-profiling-backends)
6. [Production Hardening](#production-hardening)
7. [Trace-Driven Investigations](#trace-driven-investigations)
8. [Profile Storage and Retention](#profile-storage-and-retention)
9. [Profile-Guided Optimisation](#profile-guided-optimisation)
10. [Senior Anti-Patterns](#senior-anti-patterns)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At middle level you handled pprof in production. At senior level you make pprof a permanent surface of the service: labelled, continuously collected, gated behind auth, and integrated with your observability stack. You design for the fact that most leaks and contention show up at 03:00 on a Sunday, not at your desk. You also use pprof to drive optimisation work — feeding profiles to the compiler with PGO, and turning continuous profile data into product decisions.

After this file you will:

- Stamp goroutines with labels and filter profiles by label.
- Register custom profiles for application-specific counters.
- Run a continuous profiler (Pyroscope, Parca, Polar Signals, Google Cloud Profiler) and know the trade-offs.
- Harden pprof for production exposure.
- Use trace + pprof together for latency forensics.
- Apply profiles to the compiler via `-pgo`.
- Avoid the senior anti-patterns: unbounded label cardinality, blocking the request path on profile collection, depending on `pprof.Index` HTML output.

---

## Goroutine Labels and `pprof.Do`

The default goroutine profile groups by stack. That is rarely enough. When 30,000 goroutines all run `serveHTTP -> handler -> db.Query`, the stack tells you nothing about *which* user, *which* tenant, or *which* endpoint is causing the leak. Labels close that gap.

### The two primitives

```go
import "runtime/pprof"

// 1. Attach labels to the current goroutine for its remaining lifetime.
ctx := pprof.WithLabels(parent, pprof.Labels(
    "user", "alice",
    "stage", "checkout",
))
pprof.SetGoroutineLabels(ctx)

// 2. Scoped: attach labels for the duration of f, then revert.
pprof.Do(parent, pprof.Labels("user", "alice"), func(ctx context.Context) {
    handleRequest(ctx)
})
```

`pprof.Do` is the preferred pattern. It writes the labels into a derived `context.Context`, applies them to the current goroutine while `f` runs, and restores the previous set when `f` returns. Any goroutine spawned inside `f` that calls `pprof.SetGoroutineLabels(ctx)` (or that the runtime propagates to) inherits them.

### Label propagation is opt-in

Crucial detail: labels do **not** automatically follow `go f()`. When you spawn a goroutine, that goroutine starts with **no** labels unless you explicitly carry them over.

```go
pprof.Do(ctx, pprof.Labels("tenant", "acme"), func(ctx context.Context) {
    go func() {
        // No tenant label here unless we re-apply.
        pprof.SetGoroutineLabels(ctx)
        doWork()
    }()
})
```

Go 1.21 added `pprof.Do` such that the `ctx` passed to `f` carries the labels — but the *new goroutine* you spawn inside still must call `SetGoroutineLabels(ctx)` or use another `pprof.Do`. Most production codebases wrap their goroutine launcher to do this automatically.

### Cardinality matters

Labels go into a string-keyed map shared across all goroutines with the same set. Each unique combination is its own internal entry. Reasonable label values: `endpoint=/v1/orders`, `tenant=acme`, `stage=db`. Unreasonable: `user_id=42`, `request_id=<uuid>`.

A unique value per request explodes the label space and bloats the profile. Treat labels like Prometheus labels: bounded cardinality only.

### Practical example

```go
func handler(w http.ResponseWriter, r *http.Request) {
    labels := pprof.Labels(
        "endpoint", r.URL.Path,
        "method", r.Method,
        "tenant", tenantFromRequest(r),
    )
    pprof.Do(r.Context(), labels, func(ctx context.Context) {
        process(ctx, r)
    })
}
```

Now every goroutine that ran inside `process` (and propagated labels via context) is tagged.

---

## Per-Label Profile Analysis

Once labels are in the profile, `go tool pprof` filters on them.

### Listing tags in a profile

```bash
go tool pprof goroutine.prof
(pprof) tags
endpoint: Total 1000
       550 (55.00%): /v1/orders
       300 (30.00%): /v1/users
       150 (15.00%): /healthz
tenant: Total 1000
       700 (70.00%): acme
       300 (30.00%): widgets
```

### Filtering by tag

```bash
# only goroutines with tenant=acme
go tool pprof -tagfocus=tenant=acme goroutine.prof

# everything except healthz noise
go tool pprof -tagignore=endpoint=/healthz goroutine.prof
```

You can stack filters:

```bash
go tool pprof -tagfocus=tenant=acme -tagignore=endpoint=/healthz g.prof
```

Inside the REPL:

```
(pprof) tagfocus=tenant=acme
(pprof) top
```

### Grouping by label in the flame graph

The web UI has a **Refine** menu in the top-right. You can filter to a single label value live and see the flame graph rebuild.

---

## Custom Profiles

`runtime/pprof.NewProfile(name)` registers a new profile under the standard registry. Custom profiles record arbitrary "objects" — anything you can identify with a stack trace at creation time.

```go
var connections = pprof.NewProfile("open_connections")

func newConn() *Conn {
    c := &Conn{...}
    connections.Add(c, 0) // 0 = use current stack
    return c
}

func (c *Conn) Close() {
    connections.Remove(c)
    // ...
}
```

After this, `pprof.Lookup("open_connections")` returns the live set. The HTTP handler at `/debug/pprof/open_connections` works automatically. The profile shows you exactly where every still-open connection was created.

Use cases for custom profiles:

- Open file descriptors
- In-flight requests
- Cache entries
- Workers in a pool

If your service has a long-lived resource that should be released and sometimes is not, a custom profile is the simplest possible leak detector.

---

## Continuous Profiling Backends

A snapshot is a moment in time. Continuous profiling pushes profiles to a backend every minute (or so) so you have minutes-to-months of history. When a regression shows up in p99 latency, you compare today's flame graph to last week's and see exactly what changed.

The major players:

### Pyroscope (Grafana)

Open-source, single binary, integrates with Grafana. Push or pull mode. Stores profiles in a time-series database. Visualises as flame graphs over time.

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "my-service",
    ServerAddress:   "https://pyroscope.example.com",
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileAllocObjects,
        pyroscope.ProfileAllocSpace,
        pyroscope.ProfileInuseObjects,
        pyroscope.ProfileInuseSpace,
        pyroscope.ProfileGoroutines,
        pyroscope.ProfileMutexCount,
        pyroscope.ProfileMutexDuration,
        pyroscope.ProfileBlockCount,
        pyroscope.ProfileBlockDuration,
    },
})
```

### Parca

Open-source, by Polar Signals (the company). Built on eBPF for system-wide profiling — captures all processes, not just Go. Native pprof storage. Strong on cross-language environments.

### Polar Signals Cloud

Commercial hosted version of Parca with retention, query, and team features.

### Google Cloud Profiler

If you run on GCP. Tiny agent (`cloud.google.com/go/profiler.Start`), profiles flow to a managed UI in the GCP Console. CPU, heap, goroutines, contention.

```go
import "cloud.google.com/go/profiler"

profiler.Start(profiler.Config{
    Service:        "my-service",
    ServiceVersion: "1.0.0",
    ProjectID:      "my-gcp-project",
})
```

### Datadog Continuous Profiler

Part of the Datadog APM agent. Closed-source backend. Strong if you already use Datadog for tracing and metrics.

### Trade-offs

| Backend | Hosted | Open source | Languages | Notes |
|---------|--------|-------------|-----------|-------|
| Pyroscope | optional | yes | many | Grafana integration |
| Parca | self-host | yes | many (eBPF) | best for polyglot |
| Polar Signals Cloud | yes | based on Parca | many | commercial Parca |
| Google Cloud Profiler | yes | no | Go/Java/Python/Node | only on GCP |
| Datadog | yes | no | many | best with rest of DD |

### Overhead expectations

Continuous profilers typically:

- Take a short (10s) CPU profile every minute.
- Take a heap and goroutine snapshot every minute.
- Add 1–3% CPU overhead.
- Add a small constant memory cost.

The biggest risk is not CPU but profile **storage volume**. A busy fleet can produce gigabytes of profile data daily. Plan retention.

---

## Production Hardening

Pprof in production is safe only when it is **inaccessible to the outside world**, **gated**, and **rate-limited**.

### Layer 1: bind to localhost

```go
http.ListenAndServe("127.0.0.1:6060", nil)
```

The default. Reach it via SSH tunnel or a sidecar.

### Layer 2: separate mux

Do not share `http.DefaultServeMux` with your application's API. A bug that registers a route may collide with pprof, and worse — if any handler exposes the default mux, pprof goes with it.

```go
adminMux := http.NewServeMux()
adminMux.HandleFunc("/debug/pprof/", pprof.Index)
adminMux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
adminMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
adminMux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
adminMux.HandleFunc("/debug/pprof/trace", pprof.Trace)
go http.ListenAndServe("127.0.0.1:6060", adminMux)

apiMux := http.NewServeMux()
apiMux.HandleFunc("/v1/orders", handleOrders)
http.ListenAndServe(":8080", apiMux)
```

### Layer 3: gated by auth

If pprof must be reachable via the public ingress (some platforms make this hard to avoid):

```go
func basicAuthGate(secret string, h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        _, pw, ok := r.BasicAuth()
        if !ok || subtle.ConstantTimeCompare([]byte(pw), []byte(secret)) != 1 {
            w.Header().Set("WWW-Authenticate", `Basic realm="pprof"`)
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        h.ServeHTTP(w, r)
    })
}

apiMux.Handle("/debug/pprof/", basicAuthGate(secret, http.HandlerFunc(pprof.Index)))
// ... repeat for cmdline, profile, symbol, trace
```

Use a real token, not a fixed password. Rotate it.

### Layer 4: clamp the profile duration

The trace and CPU endpoints accept `seconds=` from the client. A hostile request could ask for 3600 seconds. Wrap the handler:

```go
func clampSeconds(h http.HandlerFunc, max int) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query()
        if s := q.Get("seconds"); s != "" {
            n, err := strconv.Atoi(s)
            if err == nil && n > max {
                q.Set("seconds", strconv.Itoa(max))
                r.URL.RawQuery = q.Encode()
            }
        }
        h(w, r)
    }
}

adminMux.HandleFunc("/debug/pprof/profile", clampSeconds(pprof.Profile, 60))
adminMux.HandleFunc("/debug/pprof/trace", clampSeconds(pprof.Trace, 10))
```

### Layer 5: rate limit

A single CPU profile is fine. Ten concurrent ones are not. A simple semaphore wrapper:

```go
sem := make(chan struct{}, 1)
gated := func(h http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        select {
        case sem <- struct{}{}:
            defer func() { <-sem }()
            h(w, r)
        default:
            http.Error(w, "profile in progress", http.StatusTooManyRequests)
        }
    }
}
```

### Layer 6: never trust the binary

Stripped binaries (`-ldflags="-s -w"`) drop debug info. Profiles still work but show addresses, not function names. If you ship stripped binaries, keep a symbol map on the side and use `go tool pprof -symbolize=remote` against a service that holds the symbols.

---

## Trace-Driven Investigations

When a profile is not enough — usually for latency or scheduler questions — `runtime/trace` fills the gap.

### Tasks and regions

```go
import "runtime/trace"

ctx, task := trace.NewTask(ctx, "PlaceOrder")
defer task.End()

trace.WithRegion(ctx, "validate", func() { validate(...) })
trace.WithRegion(ctx, "charge",   func() { charge(...) })
trace.WithRegion(ctx, "persist",  func() { persist(...) })
```

Tasks and regions show up in the trace UI under "User-defined tasks". You can see exactly how long each phase took and where the goroutine was scheduled between them.

### Combining trace with profile

A common pattern:

1. CPU profile points at `crypto/tls.(*Conn).Read` as the hot function.
2. You suspect the slow path is not CPU but waiting on the network.
3. Capture a trace.
4. Filter by the request task. The trace shows TLS reads taking 200 ms each, of which 199 ms is "network".
5. Now you know: TLS itself is not slow; the upstream is.

### Reading scheduler latency

In the trace UI, **Scheduler latency profile** is gold. It shows the time goroutines spent in the **runnable** state — ready to run, waiting for a P. If this is large, you are CPU-bound or stuck behind a slow goroutine, not I/O bound.

---

## Profile Storage and Retention

Profile files are protobuf-encoded. They compress well with gzip. A reasonable retention policy:

- **Last 24 hours**: minute-resolution, in-cluster object storage.
- **Last 7 days**: hourly resolution.
- **Last 30 days**: daily resolution.
- **One per release**: keep forever.

A typical Go-on-Kubernetes service producing 5 KB per minute uses ~7 MB/day, ~50 MB/week. Multiply by number of pods. Plan accordingly; do not be casual with `s3:PutObject` quotas.

### Naming convention

```
profiles/<service>/<env>/<pod>/<yyyy>/<mm>/<dd>/<HHMMSS>-<type>.pb.gz
```

This is what most continuous profilers do internally. Mirror it for hand-rolled snapshots so you can switch later.

---

## Profile-Guided Optimisation

Go 1.20 introduced PGO (profile-guided optimisation). Feed a CPU profile from production to the compiler and it inlines, devirtualises, and reorders code based on real behaviour.

```bash
# Collect a representative profile
go tool pprof -proto http://prod:6060/debug/pprof/profile?seconds=60 > default.pgo

# Build with PGO
go build -pgo=default.pgo .
```

Typical gains: 2–7% CPU. Best on services with a small number of very hot paths.

The profile must:

- Be CPU profile, in pprof protobuf format.
- Reflect representative production load.
- Be re-collected when the code changes substantially.

Store `default.pgo` in the repo alongside the source. CI can refresh it on a schedule.

---

## Senior Anti-Patterns

### Anti-pattern: unbounded label cardinality

```go
pprof.Do(ctx, pprof.Labels("request_id", uuid.New().String()), func(ctx context.Context) {
    // ...
})
```

Every request creates a unique label set. Profile size and memory both balloon. Use a coarse identifier (`endpoint`, `tenant`, `region`) and rely on trace tasks for per-request detail.

### Anti-pattern: synchronous profile in the request path

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if r.URL.Query().Get("profile") == "1" {
        pprof.StartCPUProfile(w)
        defer pprof.StopCPUProfile()
    }
    serve(r)
}
```

If two requests arrive with `?profile=1`, the second panics — only one CPU profile may run at a time. Move profiling off the hot path.

### Anti-pattern: scraping `pprof.Index` HTML

`/debug/pprof/` returns a small HTML index. Some teams scrape it to discover profile types. The HTML is not a stable API — pin the names you use (`goroutine`, `heap`, etc.) and call them directly.

### Anti-pattern: continuous profiling without label awareness

Pushing profiles to a backend that does not understand labels means the labels are dead weight. Pick a backend (Pyroscope, Parca) that exposes the label dimensions in queries.

### Anti-pattern: stripped binaries without remote symbolisation

Saving 30 MB at build time at the cost of unreadable profiles in prod. Either keep symbols or set up a symbolisation service.

---

## Self-Assessment

- [ ] I use `pprof.Do` consistently in HTTP handlers.
- [ ] I propagate labels into spawned goroutines.
- [ ] I keep label cardinality bounded.
- [ ] I filter profiles by tag.
- [ ] I register custom profiles where they help.
- [ ] I have a continuous profiling backend wired in, or know which one I would choose.
- [ ] My pprof endpoint is bound to localhost or behind auth.
- [ ] I clamp `seconds=` and rate-limit profile collection.
- [ ] I have applied PGO at least once.

---

## Summary

Senior pprof is structural. Labels turn an anonymous stack dump into a per-tenant, per-endpoint view of where work is happening. Custom profiles extend the toolchain into your own domain — open connections, in-flight requests, cache entries. Continuous profiling backends turn each profile from a one-shot artefact into a time series, so flame graphs become queryable over weeks. Production hardening — localhost binding, auth, clamped durations, rate limiting — makes pprof safe to leave on permanently. And PGO closes the loop: profiles flow back into the compiler and make the next release faster. At this level pprof is no longer a tool you reach for in emergencies. It is a permanent part of the system.

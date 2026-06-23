# Detecting Goroutine Leaks — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Monitoring Philosophy](#production-monitoring-philosophy)
3. [Prometheus Integration — `go_goroutines`](#prometheus-integration--go_goroutines)
4. [OpenTelemetry Metrics for Goroutines](#opentelemetry-metrics-for-goroutines)
5. [Alerting on Slope, Not Threshold](#alerting-on-slope-not-threshold)
6. [Cross-checking with Heap Profile](#cross-checking-with-heap-profile)
7. [Continuous Profiling — Pyroscope, Parca, Grafana Profiles](#continuous-profiling--pyroscope-parca-grafana-profiles)
8. [Automated Stack Bucketing](#automated-stack-bucketing)
9. [Incident Runbook](#incident-runbook)
10. [Detection in Multi-Tenant Servers](#detection-in-multi-tenant-servers)
11. [Detection in Streaming and Long-Lived Workloads](#detection-in-streaming-and-long-lived-workloads)
12. [Detection in Kubernetes](#detection-in-kubernetes)
13. [Live Process Diagnostics — `dlv`, `delve attach`](#live-process-diagnostics--dlv-delve-attach)
14. [Building a Leak SLO](#building-a-leak-slo)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

At middle level you knew the tools and the workflow. At senior level you own the *system* that surfaces leaks before users feel them. The question is no longer "how do I find a leak?" — you already know. The question is "how do I make sure we find leaks within minutes of their introduction, before they reach customer impact, with no manual effort?"

After this file you will:

- Architect a goroutine-count signal that travels from process, to Prometheus, to a dashboard, to an alert, to a runbook.
- Write the alert rule that catches a leaking pod before it OOM-kills.
- Cross-check goroutine and heap profiles to distinguish "leaked goroutines that retain heap" from "leaked heap that has no goroutines."
- Integrate continuous profiling (Pyroscope, Parca, Grafana Cloud Profiles) so historical regressions are queryable.
- Define a leak SLO and report against it.
- Run the incident playbook: bring up profiles, diff against the last green deploy, identify owner, contain.
- Choose `dlv attach` over a profile when a leaked goroutine is in an unusual state.

This file assumes you have read [junior.md](junior.md) and [middle.md](middle.md). It builds on [01-lifecycle](../01-lifecycle/) for the state machine. The fixes themselves are in [03-preventing-leaks](../03-preventing-leaks/).

---

## Production Monitoring Philosophy

Three levels of defence:

1. **Test-time gate.** `goleak.VerifyTestMain` on every package. No PR with a leaking test reaches main.
2. **Pre-production probe.** Staging environment runs a load test on every release; goroutine count is measured before, during, after. A regression fails the release.
3. **Production trend monitor.** `go_goroutines` is exported, scraped, plotted, and alerted on. The alert fires within minutes of a deploy that introduces a leak.

Each layer catches a different class of bug:

- Tests catch deterministic leaks (a request that always leaks one goroutine).
- Staging catches load-dependent leaks (under N concurrent requests, one in a thousand leaks).
- Production catches rare/path-dependent leaks (a leak that triggers only with a specific upstream error or a specific tenant configuration).

The cost of detection rises and the lead time falls with each layer. A test failure costs five minutes of a developer's time. A staging regression costs a release. A production alert costs an on-call hour. Layer them; do not rely on one.

---

## Prometheus Integration — `go_goroutines`

The standard Go Prometheus client library already exports goroutine count via the `process_collector`/`go_collector`. Adopt it:

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/collectors"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func init() {
    prometheus.MustRegister(
        collectors.NewGoCollector(
            collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection),
        ),
    )
    http.Handle("/metrics", promhttp.Handler())
}
```

Exposed series include:

```
go_goroutines                                  5187
go_threads                                       32
go_gc_duration_seconds_count                    144
go_memstats_alloc_bytes                4.8e+09
go_memstats_sys_bytes                  8.2e+09
go_sched_latencies_seconds_bucket{le="..."}    ...
go_sched_goroutines_goroutines             5187    # alt name in newer collectors
```

`go_goroutines` is the headline metric. Plot it in Grafana over 24 hours and a leak shows up immediately.

### Dashboard panel — Goroutines over time

```promql
go_goroutines{service="my-server", env="prod"}
```

Set the panel's display to **graph**, with **legend**: `{{instance}}`. A leaking pod separates from the pack within minutes.

### Per-instance vs aggregate

```promql
sum(go_goroutines{service="my-server"}) / count(go_goroutines{service="my-server"})
```

The mean across pods is more stable than any one pod. A leak in one pod shows as a slight upward drift in the mean and a clear divergence in the per-pod plot.

---

## OpenTelemetry Metrics for Goroutines

If your stack is OTel-first:

```go
import (
    "context"
    "runtime"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/metric"
)

func registerGoroutineMetric(ctx context.Context) error {
    meter := otel.Meter("go-runtime")
    _, err := meter.Int64ObservableGauge(
        "go.goroutines",
        metric.WithDescription("Number of live goroutines"),
        metric.WithInt64Callback(func(ctx context.Context, o metric.Int64Observer) error {
            o.Observe(int64(runtime.NumGoroutine()))
            return nil
        }),
    )
    return err
}
```

The `contrib` repo already provides a runtime instrumentation package (`go.opentelemetry.io/contrib/instrumentation/runtime`) that exports the same set as Prometheus, named per OTel conventions: `runtime.go.gc.count`, `runtime.go.goroutines`, etc. Prefer the contrib package unless you have a reason to roll your own.

---

## Alerting on Slope, Not Threshold

The naive alert is "goroutines > 10000." It is wrong, because:

- A pod handling 10,000 concurrent connections legitimately has 10,000+ goroutines.
- The threshold is service-specific and brittle to traffic growth.
- A slow leak under-the-threshold is invisible.

The right alert is on **slope**:

```promql
deriv(go_goroutines{service="my-server"}[10m]) > 1
```

Reading: "the per-second derivative of the goroutine count over the last 10 minutes is greater than 1." That means goroutines are growing by more than 1 per second sustained. Real workloads spike and recover; this catches the monotonic climb.

A more nuanced version, comparing against a baseline:

```promql
predict_linear(go_goroutines{service="my-server"}[1h], 3600) > 2 * go_goroutines{service="my-server"}
```

Reading: "based on the last hour's trend, in another hour we will have more than double the current count." This fires on dangerous slopes specifically.

Combine with `for: 5m` so a brief burst does not page the on-call.

---

## Cross-checking with Heap Profile

A leak in goroutines almost always shows in the heap profile too, because the goroutine's stack retains its captures and reachable heap. The relationship:

| goroutine count rising | heap rising | likely cause |
|------------------------|-------------|--------------|
| Yes | Yes | Goroutine leak retaining captures |
| Yes | Flat | Goroutine leak with tiny captures (rare) |
| Flat | Yes | Pure heap leak — slices, caches |
| No | No | Memory growth in unmapped pages or thread stacks |

Workflow: when memory is climbing, fetch both:

```
curl -o g.pb.gz host:6060/debug/pprof/goroutine
curl -o h.pb.gz host:6060/debug/pprof/heap
go tool pprof -top g.pb.gz
go tool pprof -top h.pb.gz
```

If the top function in the goroutine profile shows up in the `created by` or captured-frame portion of the heap top, you have your culprit. If not, the leaks are separate.

A common pattern: leaked goroutines holding response bodies. The goroutine profile shows 5000 goroutines parked at `chan receive`; the heap profile shows 5000 `bufio.Reader` of 4 KB each, plus 5000 HTTP response objects. Same root cause, two views.

---

## Continuous Profiling — Pyroscope, Parca, Grafana Profiles

A continuous profiler scrapes `/debug/pprof/goroutine` (and heap, and CPU, etc.) every 10–60 seconds and stores the data in a time-series-style profile database. You can query "how did this stack signature evolve over the last week" and pinpoint the deploy that introduced the leak.

Setup with **Pyroscope** (open source) or **Grafana Cloud Profiles** is one configuration block:

```yaml
scrape_configs:
  - job_name: 'my-server'
    profiling_config:
      pprof_config:
        goroutine:
          enabled: true
        memory:
          enabled: true
    static_configs:
      - targets: ['my-server:6060']
```

Now in the UI you can:

- Pick "goroutine" profile, see a flamegraph aggregated over time.
- Compare two time ranges side by side (last 1h vs 24h ago).
- Find the new stack frames that appeared after a release.

This is the senior-level equivalent of running `pprof -base` by hand, automated and historical. The lead time from leak introduction to detection drops from "OOM kill, paged at 2 AM" to "Slack message during business hours: stack `X` grew by 300%."

---

## Automated Stack Bucketing

Once you have the protobuf profile in hand programmatically, automated leak detection is straightforward:

```go
import "github.com/google/pprof/profile"

type StackKey string

func bucket(p *profile.Profile) map[StackKey]int64 {
    out := map[StackKey]int64{}
    for _, s := range p.Sample {
        sig := ""
        for i, loc := range s.Location {
            if i >= 5 {
                break // top 5 frames as the key
            }
            if len(loc.Line) > 0 {
                sig += loc.Line[0].Function.Name + ";"
            }
        }
        out[StackKey(sig)] += s.Value[0]
    }
    return out
}

func diff(before, after map[StackKey]int64) map[StackKey]int64 {
    delta := map[StackKey]int64{}
    for k, v := range after {
        if v-before[k] > 100 {
            delta[k] = v - before[k]
        }
    }
    return delta
}
```

Schedule this in a job that compares the latest profile against the one from the previous release. Email or page on any signature with a +100 delta. You have just built a poor-engineer's regression detector.

---

## Incident Runbook

A scenario: PagerDuty fires at 03:14 — "go_goroutines slope > 5 for 10m on `billing-prod`."

1. **Confirm.** Open the Grafana dashboard. Verify the slope. Note when it started.
2. **Correlate with deploys.** Did anything ship in the last hour? `git log --since` for the service. Note any candidate commit.
3. **Capture a profile.** From a leaking pod:
   ```
   kubectl port-forward pod/billing-prod-abc 6060:6060
   curl -o now.pb.gz localhost:6060/debug/pprof/goroutine
   ```
4. **Capture a baseline.** From a healthy pod (a fresh restart, or a pod that has not yet rolled to the new version):
   ```
   curl -o base.pb.gz localhost:6060/debug/pprof/goroutine
   ```
5. **Diff.** `go tool pprof -base base.pb.gz now.pb.gz`. Use `top` and `list` to identify the topmost growing stack.
6. **Decide on containment.**
   - If the leak is mild (slope < 50/sec) and the pod is hours from OOM, schedule a fix.
   - If the leak is steep, restart the affected pods in a rolling fashion. This is a band-aid, not a fix, but it buys hours.
   - If the leak is in a code path that can be feature-flagged off, do so.
7. **Open a ticket** with the profile attached and the file:line of the leak.
8. **Write the postmortem.** Include: when introduced, when detected, why detection took N minutes, what the fix is, what the new tests are.

The runbook should live in the team wiki, with this service-specific information filled in.

---

## Detection in Multi-Tenant Servers

When one tenant's bad config causes leaks, you want the metrics to point at the tenant. Two techniques:

1. **Labels on goroutines.** Use `pprof.SetGoroutineLabels` with `tenant=<id>`. Profiles can then be filtered.
2. **Cardinality-aware metrics.** Do *not* emit a `goroutines{tenant=<id>}` Prometheus series for every tenant — that explodes cardinality. Instead, emit a small set of buckets ("free", "paid", "enterprise") or only the top-10 tenants by current usage.

A useful pattern:

```go
type tenantBucket struct {
    name  string
    count atomic.Int64
}

var buckets = map[string]*tenantBucket{
    "free":       {name: "free"},
    "paid":       {name: "paid"},
    "enterprise": {name: "enterprise"},
}

func startTenantGoroutine(t *Tenant, fn func()) {
    b := buckets[t.Tier]
    b.count.Add(1)
    go func() {
        defer b.count.Add(-1)
        fn()
    }()
}
```

Now you can plot `goroutines_per_tier` from a tiny set of series.

---

## Detection in Streaming and Long-Lived Workloads

Streaming servers — gRPC streaming, WebSocket, SSE — legitimately keep goroutines alive for the duration of a connection. `go_goroutines` is no longer "near zero baseline plus transient spikes"; it is "proportional to active connections." Detection must take that into account.

Approach: normalise.

```promql
go_goroutines{service="streaming"} / active_connections{service="streaming"}
```

The ratio should be roughly constant (often 2 to 4 goroutines per connection). A leak shows as the ratio climbing while connection count is flat.

Alternative: track the *delta* — goroutines that did not exit when their connection closed. Instrument your connection-close handler to assert `count` returned to its pre-connection value.

---

## Detection in Kubernetes

Two integrations help:

1. **Probes.** Add a liveness probe that fails when goroutines exceed an absolute hard cap. Kubernetes restarts the pod; users see a blip, not a 4 GB OOM.
   ```yaml
   livenessProbe:
     httpGet:
       path: /healthz?goroutine_cap=50000
       port: 8080
   ```
   The handler returns 5xx if `runtime.NumGoroutine() > cap`. Use this as a last resort; the goal is detection before this fires.
2. **Prometheus + AlertManager.** As above. The alert routes through AlertManager to PagerDuty/Slack.
3. **Process exporter.** The `node_exporter` plus `process-exporter` reports OS-thread count per process, which is another secondary signal — climbing OS threads often track climbing goroutines blocked in syscalls.

The pod's resource limits — `memory: 4Gi` — also indirectly bound leaks: the OOM killer is the catastrophic safety net, but at least it does not poison the rest of the cluster.

---

## Live Process Diagnostics — `dlv`, `delve attach`

When a profile is not enough — "goroutine 23 is parked at channel receive, and I have no idea what's in the channel" — Delve attaches to a running process.

```
$ dlv attach 12345
(dlv) goroutines -with reason="chan receive"
[5102 goroutines]
* Goroutine 23 - User: /src/poll.go:42 main.poll (0x...) [chan receive 18m]
* Goroutine 24 - User: /src/poll.go:42 main.poll (0x...) [chan receive 18m]
...
(dlv) goroutine 23
Goroutine 23 - User: /src/poll.go:42 main.poll (0x...) [chan receive 18m]
(dlv) bt
0  0x...  runtime.gopark
1  0x...  runtime.chanrecv
2  0x...  main.poll  /src/poll.go:42
...
(dlv) print ch
(*chan int)(0xc000123456)
(dlv) print ctx
(*context.cancelCtx)(0xc000abcdef)
```

You can now inspect the captured channel, the context, the buffer — every variable in the frame. That tells you whether the channel is buffered, what the context's deadline is, whether anyone is supposed to send.

Caveats:

- Delve pauses the process. Do not attach to a high-traffic production process without coordination.
- Symbols must be present. Strip-free binaries only.
- `dlv attach` requires root or `CAP_SYS_PTRACE`. Plan for that in your container security policy.

For containers, the `dlv` binary needs to be reachable and the process's `/proc` accessible. Many teams maintain a debug image with `dlv` baked in for these moments.

---

## Building a Leak SLO

A Service Level Objective for leaks looks like:

> "Over any 30-day window, no more than X minutes of leak-suspected operation, defined as `deriv(go_goroutines[10m]) > 1` lasting more than 5 minutes."

In prometheus:

```promql
sum_over_time(
    (deriv(go_goroutines{service="my-server"}[10m]) > bool 1)[30d:5m]
) * 5 < 60   # less than 60 minutes total
```

This forces a culture of fast detection and fast remediation. The SLO budget is small (an hour a month), and exceeding it triggers an action item, not a page. It complements latency and error-rate SLOs.

If you do not have an SLO yet, start by reporting the monthly time-above-threshold in a quarterly review. Numbers create accountability.

---

## Self-Assessment

- [ ] I have `go_goroutines` exposed as a Prometheus metric in all my services.
- [ ] I have a dashboard panel for `go_goroutines` per service, per instance.
- [ ] I have an alert that fires on slope, not on absolute threshold.
- [ ] I cross-check goroutine and heap profiles when investigating memory growth.
- [ ] I have integrated a continuous profiler (Pyroscope, Parca, or Grafana Profiles) for at least one service.
- [ ] I can identify and contain a leaking pod within 15 minutes of a page.
- [ ] I have a runbook in the team wiki for goroutine-leak incidents.
- [ ] I have used `dlv attach` to inspect a leaked goroutine's captured variables in a non-production environment.
- [ ] I have at least one leak SLO defined and reported on.

---

## Summary

Senior leak detection is about systems, not tools. You design layered defences (tests, staging, production), expose `go_goroutines` and ship it through Prometheus or OpenTelemetry, alert on slope not threshold, cross-check goroutine and heap profiles, integrate continuous profiling so regressions are queryable historically, and run a documented incident runbook. The capstone is a leak SLO that makes detection latency a measurable engineering property. The next file ([professional.md](professional.md)) dives one level deeper, into the runtime internals — how `runtime.NumGoroutine` is implemented, how `runtime.Stack` walks the goroutine list, what `schedtrace` shows. The prevention side ([03-preventing-leaks](../03-preventing-leaks/)) closes the loop by removing the leaks the detection caught.

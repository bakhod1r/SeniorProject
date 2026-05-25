# Mutex and Block Profiling — Professional

## 1. The production framing

Contention bugs are the silent killer. CPU dashboards look fine, request rate looks fine, and yet p99 latency drifts up release after release. The professional job around mutex/block profiling, in order:

1. **Enable both profiles in every service from day one**, with conservative rates.
2. **Make captures cheap and routine** — automation reaches them, not just humans.
3. **Continuously ingest** contention data into long-term storage and dashboards.
4. **Diff per release.** A new top-5 stack in the mutex profile is treated like a SLO regression.
5. **Maintain a runbook** for the "latency rising, CPU flat" incident class.

This file is what each of those looks like in practice.

---

## 2. Enabling profiles in every service

A shared `internal/profiling` package does this exactly once per binary:

```go
package profiling

import (
    "net/http"
    _ "net/http/pprof"
    "runtime"
)

func Init(cfg Config) {
    runtime.SetMutexProfileFraction(cfg.MutexRate)
    runtime.SetBlockProfileRate(cfg.BlockRateNs)

    mux := http.NewServeMux()
    mux.Handle("/debug/pprof/", http.DefaultServeMux)

    go func() {
        _ = http.ListenAndServe(cfg.Addr, mux) // 127.0.0.1:6060 by default
    }()
}

type Config struct {
    Addr        string
    MutexRate   int
    BlockRateNs int
}

var Default = Config{
    Addr:        "127.0.0.1:6060",
    MutexRate:   100,
    BlockRateNs: 10_000,
}
```

`cmd/myservice/main.go` calls `profiling.Init(profiling.Default)` in the first dozen lines. Now every service exposes both profiles with identical defaults.

---

## 3. When to enable, when to tune

| Situation | Mutex fraction | Block rate (ns) | Why |
|-----------|----------------|------------------|-----|
| Default in prod | 100 | 10_000 | Negligible overhead, useful trends |
| Active incident, low-traffic | 10 | 1_000 | More detail, still bounded |
| Active incident, high-traffic | 100 | 10_000 | Don't change rates — capture deltas instead |
| Staging benchmarks | 1 | 1 | All events; never on prod |
| Latency-critical paths confirmed safe | 1000 | 100_000 | Reduce overhead under microsecond-mutex storms |

The mistake to avoid is "enable on incident". By the time the incident is live, you want to compare against last week. Production-on-always is the only configuration that gives you that.

---

## 4. Continuous profiling pipelines

For one-off investigation, `curl /debug/pprof/mutex` works. For a fleet of services, you want a continuous profiling system that scrapes, dedupes, and stores profiles indefinitely. Three open options:

| System | Notes |
|--------|-------|
| **Pyroscope / Grafana Phlare** | Self-hostable; agent scrapes pprof endpoints; UI has time-series + flame graphs |
| **Parca** | Similar concept, eBPF-augmented for syscalls/locks below the runtime |
| **Datadog / Polar Signals / GCP Profiler** | Hosted SaaS; same profile format under the hood |

Whichever you pick, the contract is the same:

- Agent fetches `/debug/pprof/mutex` and `/debug/pprof/block` every N seconds.
- Server stores the profiles keyed by `(service, version, instance, timestamp)`.
- UI lets you select a time range, drop to flame graph, diff with another range.

The single most useful query becomes: "show me the mutex profile for `serviceX@v2.3` minus the same for `v2.2`." That's how regressions are caught.

---

## 5. Dashboard pattern: contention as a SLI

Add four panels to your service dashboard:

| Panel | Metric | Alert at |
|-------|--------|----------|
| **Mutex delay rate** | `sum(rate(profile_mutex_delay_ns[5m]))` | 2× baseline for 10 min |
| **Block delay rate** | `sum(rate(profile_block_delay_ns[5m]))` | 2× baseline for 10 min |
| **Top contended stack** | `topk(5, profile_mutex_delay_ns)` | New entry appears |
| **Goroutine count** | `go_goroutines` | Trending up unboundedly |

The "top contended stack" panel deserves a story: continuous profiling lets you slice profiles by stack frame. You group by the top-3 frames and chart the delay attributed to each over time. A new bar appearing after a release is the signature of a contention regression.

---

## 6. Capturing profiles during incidents

A standardised incident command:

```bash
#!/usr/bin/env bash
# capture-contention.sh — run during an incident, attach to the ticket
host=$1
out=incident-$(date +%s)

mkdir "$out"
curl -s "http://$host/debug/pprof/mutex" -o "$out/mutex-1.pb.gz"
curl -s "http://$host/debug/pprof/block" -o "$out/block-1.pb.gz"
curl -s "http://$host/debug/pprof/goroutine" -o "$out/goroutine-1.pb.gz"
sleep 60
curl -s "http://$host/debug/pprof/mutex" -o "$out/mutex-2.pb.gz"
curl -s "http://$host/debug/pprof/block" -o "$out/block-2.pb.gz"
curl -s "http://$host/debug/pprof/goroutine" -o "$out/goroutine-2.pb.gz"

echo "captured to $out — analyse with:"
echo "  go tool pprof -base $out/mutex-1.pb.gz $out/mutex-2.pb.gz"
```

Two snapshots a minute apart. Diff captures contention *during the incident window*, not lifetime-since-process-start. Put this script in your on-call runbook.

---

## 7. The "latency rising, CPU flat" runbook

When p99 climbs without CPU rising:

1. **Confirm.** Check that QPS and CPU are flat; if not, this is a different runbook.
2. **Goroutine count.** Hit `/debug/pprof/goroutine?debug=1`. If many goroutines are parked on `semacquire`, contention is live.
3. **Mutex delta.** Capture a minute, diff. Look at `top -cum`. The leader is the bottleneck.
4. **Block delta.** Same. If mutex is empty but block is loud on a channel, it's back-pressure, not lock contention.
5. **Source.** `list` the leader. The expensive line is what to fix.
6. **Bypass.** If you can deploy quickly, do; if not, scale out (add replicas) — under contention, more replicas helps even if more cores per replica wouldn't.
7. **Post-incident.** Add the offending stack as a tracked metric. Bake the fix as a regression test.

The seventh point is what professionals do that hobbyists skip. Each incident expands the dashboards.

---

## 8. Release-time gating

Run the production-shaped benchmark on every PR:

```go
func BenchmarkHotPath(b *testing.B) {
    b.ResetTimer()
    runtime.SetMutexProfileFraction(1)
    runtime.SetBlockProfileRate(1)

    for i := 0; i < b.N; i++ {
        hotPath()
    }

    var buf bytes.Buffer
    pprof.Lookup("mutex").WriteTo(&buf, 0)
    os.WriteFile("mutex.pb.gz", buf.Bytes(), 0o644)
    buf.Reset()
    pprof.Lookup("block").WriteTo(&buf, 0)
    os.WriteFile("block.pb.gz", buf.Bytes(), 0o644)
}
```

CI compares the new profile to the baseline. If a new stack appears or an existing stack's `delay` doubles, the PR fails. The threshold is workload-specific; pick a number that matches your team's tolerance.

Tools that automate this: `benchstat` for time/alloc deltas, custom scripts for pprof deltas. A simple approach: write `pprof -top` to a text file and diff lexically.

---

## 9. The profile retention policy

Profiles are small (low single-digit MiB each) but accumulate fast. A typical policy:

| Type | Retention | Storage |
|------|-----------|---------|
| Routine 30-s scrape | 7 days | Hot storage |
| Hourly aggregate | 90 days | Warm storage |
| Daily baseline | 1 year | Cold storage |
| Per-release baseline | Forever | Object storage, immutable |

The per-release-forever is what enables "this regression came in between v2.3 and v2.4" investigations a year later.

---

## 10. Cost of running profiles continuously

For a service handling 10 000 QPS with moderate contention:

| Profile | Rate | CPU overhead | Memory overhead |
|---------|------|--------------|-----------------|
| Mutex | 100 | ~0.1% | ~1 MiB profile buffer |
| Block | 10_000 | ~0.5% | ~2 MiB profile buffer |
| Goroutine snapshot | per-scrape | < 50 ms pause once per minute | n/a |

A modern service can afford this. The CPU you pay back many times over the first time an incident is resolved in minutes instead of hours.

Be careful about three multipliers:

1. **Block rate of `1`** — recording every event — easily hits 5–10% on busy services.
2. **Capturing `goroutine?debug=2`** with thousands of goroutines is expensive (full stacks, no sampling).
3. **Continuous flame graph rendering** in the UI is the *client's* CPU; doesn't affect the service.

---

## 11. Privacy and security

Both profiles **include source paths** and function names from your binary. This is unrelated to user data but does leak architecture. Treat the endpoints as sensitive:

- Bind to localhost or an admin interface, never the user-facing port.
- Authenticate the scrape agent (mTLS or token).
- Strip symbol names with `-ldflags="-s -w"` only if you have an out-of-band symbol resolver — symbolless profiles are mostly useless.
- Store profiles with the same access controls as code.

A production endpoint that responds to anonymous GETs of `/debug/pprof/mutex` is a CVE waiting to happen.

---

## 12. Cross-team workflows

When the contention top frame points at a shared library you don't own, the data is your leverage:

1. File a ticket with the **pprof flame graph URL**, the diff against baseline, and the affected service.
2. Include `list <function>` output for the worst stacks.
3. Quantify impact (delay / second per replica × replicas × duration).
4. Propose a fix — even a wrong one. The library owners read code, not prose.

Profiles are the only language that crosses teams unambiguously about contention. "Cache.Get is slow" sparks debate; "Cache.Get contributes 8 s/min of mutex delay across 60 replicas" gets the fix scheduled.

---

## 13. Profile-driven design reviews

For new components that include synchronisation, require the design doc to answer:

- What primitive (`Mutex`, `RWMutex`, `chan`, `atomic`)?
- Expected critical-section duration at p99?
- Expected QPS?
- Estimated contention (rough Amdahl) at 8, 32, 128 cores?
- Plan for sharding/cow if the estimate exceeds budget?

This single page costs an hour and saves the next on-call from re-discovering it the hard way. Reviewing it requires the reviewer to think about contention, which is itself the goal.

---

## 14. Common production anti-patterns

| Anti-pattern | Failure mode |
|--------------|--------------|
| Block profile at `rate=1` in prod | 5–10% CPU steal; intermittent latency spikes from sampling itself |
| Mutex profile disabled in prod | When the incident hits, you have nothing |
| Profile endpoint on the user-facing port | Source leakage; potential DoS via repeated capture |
| Comparing absolute totals across restarts | Profiles accumulate since enabling; restarts reset |
| "Add `sync.Map` everywhere" | `sync.Map` is slower for balanced read/write workloads |
| One global lock guarding "small" hot map | Eventually contended even if "small" |
| `defer mu.Unlock()` then `time.Sleep(100ms)` | Defer scope is the function; lock held the entire sleep |
| Continuous profiling without diffing | You'll drown in noise; deltas surface signal |

---

## 15. Summary

Production mutex/block profiling is a budget plus a pipeline plus a runbook. Enable both with conservative rates from day one, ingest into continuous profiling, dashboard the top stacks, gate releases on contention deltas, and exercise the "latency up, CPU flat" runbook before you need it. Atomics, sharding, and copy-on-write are the standard fixes; pick by profile evidence, never by reflex. The teams that take contention seriously look quiet; the teams that don't drift up and to the right until customers notice.

---

## Further reading
- Continuous profiling overview: https://www.cncf.io/blog/2022/05/31/what-is-continuous-profiling/
- Pyroscope: https://grafana.com/oss/pyroscope/
- Parca: https://www.parca.dev/
- Google's "Always-on continuous profiling": https://research.google/pubs/google-wide-profiling-a-continuous-profiling-infrastructure-for-data-centers/
- Felix Geisendörfer, profiler notes: https://github.com/DataDog/go-profiler-notes

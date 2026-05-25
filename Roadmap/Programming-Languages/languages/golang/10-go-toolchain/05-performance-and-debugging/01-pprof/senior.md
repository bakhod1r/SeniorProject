# pprof — Senior

## 1. When to profile (and when not to)

Profile **after** you have a measured symptom and a hypothesis, never as a fishing trip. The order is:

1. A metric or user report shows a problem ("p99 latency is 800ms", "RSS climbed 4GB overnight").
2. You form a hypothesis ("the JSON encoder is allocating", "a goroutine leaks per request").
3. You capture the profile kind that would confirm or refute it.
4. You compare against a known-good baseline.

Profiling without (1) wastes time chasing things that don't matter at scale. Profiling without (4) leads to "looks slow, must be the bottleneck" — which is often wrong on a sampling profiler.

---

## 2. CPU vs heap profiles drive different optimizations

The same hot function in CPU and heap profiles usually wants different fixes:

| Symptom | What to look at | Typical fix |
|---------|-----------------|-------------|
| Hot in CPU, cold in heap | `cpu` | Algorithmic — better data structure, fewer iterations, batching, SIMD-amenable shape |
| Cold in CPU, hot in `alloc_space` | `allocs` | Reduce allocations — pool, reuse buffers, avoid interface conversions on hot paths |
| Hot in CPU **because** of `runtime.mallocgc` / `runtime.gcBgMarkWorker` | both | Reduce allocation rate; CPU is a GC tax, not your code |
| RSS keeps climbing, GC has to keep up | `heap` (inuse) | Find leaked references; check caches/maps/channels |

If the CPU profile is 30% in `runtime.gcBgMarkWorker`, that is a heap problem dressed as a CPU problem.

---

## 3. Inlining and what flame graphs hide

The Go compiler inlines small functions. An inlined function does not appear as its own frame — its samples are attributed to the caller. This can make a flame graph misleading: you see `outer` as hot when most of its time is really in inlined `inner`.

Tools that help:

```bash
# Show inlining decisions during the build
go build -gcflags='-m=2' ./...

# In pprof, see the original source attribution
(pprof) list outer
```

The `list` view uses DWARF data and will annotate the inlined source lines back into `outer`'s body, so you can see which physical lines dominate even when the call boundary has vanished.

Do **not** compile with `-N -l` (disable optimization and inlining) just to read a flame graph. The resulting profile reflects a program nobody runs. Read the inlined profile and use `list` to disambiguate.

---

## 4. Sampling bias

A sampling profiler is statistical. Two consequences:

- **Short hot paths can be missed.** If a function takes 5μs and runs 1000 times in a 1-second profile, total CPU is 5ms — about half a sample at 100Hz. It may appear or not appear depending on timing. Either capture longer (`?seconds=30`), raise the rate (`SetCPUProfileRate(500)`), or rerun and aggregate.
- **Bias toward syscalls returning.** The signal-based profiler can over-attribute time near syscall boundaries on some kernels. Treat ±10% as noise.

When two profiles disagree by less than a sample or two, the difference is noise. Add `-nodecount=20` and ignore the long tail.

---

## 5. Designing servers for always-on profiling

Run a dedicated admin listener on a private port, with `net/http/pprof` registered there only. **Never** on the public mux.

```go
// public mux: business endpoints only
public := http.NewServeMux()
public.HandleFunc("/api/...", apiHandler)

// admin mux: pprof, metrics, healthz, behind firewall / unix socket
admin := http.NewServeMux()
admin.Handle("/debug/pprof/", http.DefaultServeMux) // pprof registered on default mux

go http.ListenAndServe(":8080", public)
go http.ListenAndServe("127.0.0.1:6060", admin)
```

In Kubernetes, expose `:6060` only via a `ClusterIP` (not a `LoadBalancer`), or use a sidecar that scrapes and forwards. Authenticate at the ingress if the cluster is shared.

The cost of leaving pprof on in production is negligible: handlers are dormant until hit. The benefit is the ability to capture from a live process during an incident without redeploying.

---

## 6. Continuous profiling

Ad-hoc pprof captures answer "what is hot right now?". You also want "what was hot at 03:14 yesterday when latency spiked?". That is **continuous profiling**: a small agent in the process captures short profiles on a schedule (e.g., every minute) and ships them to a backend that lets you query across time and instances.

Mature options:

- **Grafana Pyroscope** (OSS, self-host): scrape pprof endpoints or push from a Go agent.
- **Datadog Continuous Profiler**: managed; integrates with traces.
- **Google Cloud Profiler**: managed; very low overhead, designed for always-on.
- **Polar Signals Parca**: OSS, eBPF-based, language-agnostic.

The Go profile format is the same; these tools wrap collection, storage, and a UI.

---

## 7. Differential profiling for regression detection

Use `-base` between releases:

```bash
go tool pprof -http=:8080 -base=v1.5.0.prof v1.6.0.prof
```

In CI, you can do this automatically: run a benchmark, write `cpu.prof`, compare against the previous `main` profile, fail if any function regresses by more than X%. Pyroscope and Parca both have "flamegraph diff" UIs that do this interactively.

This catches the "no one change is obviously slow but the release is 5% slower" case that benchmarks alone often miss.

---

## 8. The "0% CPU but slow" case

A common production puzzle: the service is slow, but CPU is low. CPU profiles look idle. The culprit is almost always **blocking**: goroutines waiting on locks, channels, or I/O. The CPU profile **cannot see waiting goroutines** because they are not on-CPU.

Enable block and mutex profiling:

```go
runtime.SetBlockProfileRate(1)     // sample every blocking event (expensive)
runtime.SetBlockProfileRate(10000) // sample once per ~10μs of blocking
runtime.SetMutexProfileFraction(1) // sample every mutex contention event
```

In production, use rates not full sampling. Capture from `/debug/pprof/block` and `/debug/pprof/mutex`. Read with the same tools.

A request handler hot in `runtime.gopark` in the block profile means it sleeps waiting for something — usually a downstream call, a channel send/recv, or a mutex. Match the stack to your code.

For raw "what is everyone doing", `/debug/pprof/goroutine?debug=2` dumps all stacks human-readable. Grep for your handler name to see how many are stuck and where.

---

## 9. Labels for slicing profiles

`runtime/pprof.Do` attaches key/value labels to a region of work. The CPU profiler records them with each sample, and the pprof UI can group by them.

```go
pprof.Do(ctx, pprof.Labels("op", "checkout", "tenant", tenantID), func(ctx context.Context) {
    process(ctx)
})
```

In the pprof CLI:

```
(pprof) tags                    # list label keys/values seen
(pprof) top -tagfocus=op:checkout
```

Use sparingly — labels increase profile size — but they are invaluable when one tenant or one operation is the cause of a spike and you need to prove it.

---

## 10. What seniors get asked to do

- Set up always-on admin endpoints with pprof + metrics + healthz.
- Integrate continuous profiling.
- Diagnose "slow but cool" via block/mutex.
- Distinguish GC pressure from compute pressure in flame graphs.
- Define a CI gate that rejects PRs with >5% regression on a key benchmark.
- Teach the team to start at the symptom, not at the profile.

---

## 11. Summary

At the senior level pprof is less about clicking the UI and more about **methodology**: profile with a hypothesis, choose the kind that fits the symptom, treat sampling output as statistical, never trust a single capture, design servers so a profile is one `curl` away in production, and gate releases on differential profiles. The slowest services in your career will have a low-CPU/blocking profile; learn to read block and mutex profiles before you need them.

---

## Further reading
- Go blog — Profiling Go programs: https://go.dev/blog/pprof
- `runtime.SetBlockProfileRate`: https://pkg.go.dev/runtime#SetBlockProfileRate
- `runtime/pprof.Do` and labels: https://pkg.go.dev/runtime/pprof#Do
- Pyroscope docs: https://grafana.com/docs/pyroscope/latest/
- Google Cloud Profiler concepts: https://cloud.google.com/profiler/docs/concepts-profiling

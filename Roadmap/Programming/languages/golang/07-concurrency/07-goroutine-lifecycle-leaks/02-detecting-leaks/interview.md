# Detecting Goroutine Leaks — Interview Questions

A collection of questions ordered from junior screen through staff-level system-design. Each comes with a model answer.

---

## Junior

### Q1. What is a goroutine leak?

A goroutine that is started but never returns. It is parked on a blocking operation that will never complete — most commonly a channel send/receive where the other side is gone, a mutex that no one releases, a `WaitGroup.Wait` whose counter never reaches zero, or an infinite loop. The leaked goroutine holds its stack and everything its captured variables reference until process exit.

### Q2. How do I check how many goroutines are running?

`runtime.NumGoroutine()` returns the current count. Import `runtime`, call the function, print the int. It is microsecond-cheap; safe to call once per scrape interval.

### Q3. Where would I look in a Go web server to see live goroutine stack traces?

Import `_ "net/http/pprof"` for its side-effect of registering handlers on `http.DefaultServeMux`. Hit `/debug/pprof/goroutine?debug=2` to get a full text dump of every live goroutine's stack with state and wait reason.

### Q4. What does `[chan send]` mean in a stack trace?

The goroutine is parked at a `ch <- value` operation that has not yet been received. If the goroutine has been in that state for minutes and nobody else holds the receive end, it is a leak.

### Q5. What is `goleak` and why use it?

`go.uber.org/goleak` is a small library that fails a Go test if extra goroutines are alive after the test finishes. You call `goleak.VerifyTestMain(m)` from `TestMain` once per package. It catches leaks at test time, before they reach production. The cost is one `runtime.Stack` per package test run.

### Q6. Show me how to use `goleak` in `TestMain`.

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

That is the whole adoption. If any test leaks a goroutine, the test binary exits with non-zero status and prints the offending stacks.

### Q7. Will the garbage collector clean up a leaked goroutine?

No. A leaked goroutine is a GC root. Its stack contains pointers; the GC keeps everything reachable from those pointers alive. The goroutine itself is not eligible for collection — it has not exited.

### Q8. What is the baseline number of goroutines a Go program has at startup?

Typically 4 to 10, depending on Go version and what packages are imported. The main goroutine plus runtime-internal helpers (sysmon, force-GC, scavenger, finaliser, GC mark workers). Do not treat that small number as a leak.

### Q9. What is the difference between `debug=1` and `debug=2` on the pprof goroutine endpoint?

`debug=1` collapses identical stacks into one entry with a count. Compact, easy to read at a glance. `debug=2` prints every goroutine individually with its state, wait reason, parked duration, and full stack. Verbose but precise. Use `debug=1` for triage, `debug=2` for digging in.

### Q10. Is `pprof.Lookup("goroutine").WriteTo(os.Stdout, 2)` safe to call from production code?

Functionally yes, but it briefly pauses the world. On a server with millions of goroutines that pause is milliseconds. Do not invoke it on every request; use a signal handler or a threshold trigger instead.

---

## Middle

### Q11. Walk me through how you would investigate "memory is climbing in service X."

1. Check `go_goroutines` over time. If climbing, suspect a goroutine leak.
2. Grab a profile from a leaking pod: `curl /debug/pprof/goroutine?debug=1 > now.txt`.
3. Grab one from a healthy pod or a fresh restart: `... > base.txt`.
4. Diff them. The stacks that grew the most are the leak signatures.
5. Open the source at the top frame; look for a missing `context.Done`, an unclosed channel, or a goroutine spawned in a loop without a cancellation path.
6. Patch, deploy, verify the count returns to baseline.

### Q12. What false positives does `goleak` filter out for you?

The default ignore list covers runtime-internal goroutines: `runtime.gopark`-based helpers, `runtime.bgsweep` (the GC sweeper), `runtime.forcegchelper`, `runtime.bgscavenge`, `runtime.runfinq` (finalisers), the test framework itself. It also accounts for `internal/poll.runtime_pollWait` (the network poller). You add your own ignores with `IgnoreTopFunction`.

### Q13. When would you use `goleak.VerifyNone(t)` instead of `goleak.VerifyTestMain(m)`?

When the package has tests that intentionally leave goroutines alive (rare but real — e.g. a singleton background worker started by an `init` function). `VerifyTestMain` checks across all tests; if any of them leaves a goroutine, every test fails. `VerifyNone` lets you scope the assertion to specific tests.

### Q14. How does `pprof.SetGoroutineLabels` help with leak detection?

It attaches key-value labels to a goroutine. Subsequent `debug=0` profiles include the labels. You can filter `go tool pprof` by tag: `-tagfocus=tenant=foo`. In a multi-subsystem server, that lets you isolate "which subsystem owns the leak" without parsing every stack.

### Q15. Why is `pprof.Do(ctx, labels, fn)` preferred over `SetGoroutineLabels(ctx)` for request scoping?

`Do` propagates labels into any goroutines spawned by `go` inside the callback. `SetGoroutineLabels` only sets them for the current goroutine. In a request handler that spawns workers, you want the workers' profiles to inherit the request's tenant/route labels.

### Q16. Why is a slope-based alert better than a threshold-based one?

Thresholds depend on traffic. A server handling 50k connections has 50k+ goroutines legitimately. A threshold at 100k is fine until your customer base doubles. A slope alert (`deriv(go_goroutines[10m]) > 1`) catches monotonic climbs regardless of base load. Combine with `for: 5m` to filter out transient spikes.

### Q17. What runtime states map to leak shapes?

| State | Likely leak cause |
|-------|------------------|
| `chan send` | Receiver gone or never existed |
| `chan receive` | Sender gone or never sends |
| `select` | Multiple-case select where no case ever becomes ready |
| `select (no cases)` | `select {}` intentionally — usually fine, sometimes wrong |
| `sync.Mutex.Lock` | Holder leaked or holder deadlocked |
| `sync.WaitGroup.Wait` | A `Done` was missed |
| `IO wait` | Read with no deadline on a stalled connection |
| `semacquire` | Same as Mutex.Lock effectively |

### Q18. Imagine a leak that causes 5,000 goroutines to be parked at the same channel receive line. What is the most efficient way to find that line?

`curl /debug/pprof/goroutine?debug=1 > now.txt`. The first block in the output will have count `5000+`. The topmost `#` line in that block is the file:line where they are parked. No diff needed — the count alone identifies the cluster.

### Q19. How do you take a goroutine profile from inside the program (without HTTP)?

```go
f, _ := os.Create("g.txt")
defer f.Close()
pprof.Lookup("goroutine").WriteTo(f, 2)
```

Useful for CLIs, daemons, or signal-driven dumps where you do not want an HTTP server.

### Q20. The `gops` agent — when would you pick it over `net/http/pprof`?

When you cannot expose an HTTP server (CLI, sidecar, container with no extra ports), or when you want a local-only inspection channel that does not touch the network. `gops` binds to localhost and writes a PID-keyed file under `~/.config/gops` so the `gops` CLI can find it.

---

## Senior

### Q21. Design the monitoring stack for goroutine leaks in a production microservice.

1. Every service exposes `/metrics` via `promhttp.Handler()`, which includes `go_goroutines`.
2. Prometheus scrapes every 15 seconds.
3. Grafana dashboard with one panel per service: `go_goroutines{service=...}` legend by `{{instance}}`.
4. Alertmanager rule: `deriv(go_goroutines{service=...}[10m]) > 1 for 5m` — pages on-call.
5. Pyroscope or Parca continuously scrapes the goroutine profile (and heap) and stores it in a time-series profile DB.
6. Runbook: a wiki page with the playbook, who owns which service, where the dashboards are.
7. SLO: "no more than 60 minutes of leak-suspect operation per 30 days."

### Q22. A staging load test passes but production leaks. Hypotheses?

- Production has traffic shapes not in the test (tenants with weird configs, real network failures, slow upstreams).
- A production-only feature flag is on.
- The leak triggers only with multiple replicas (cross-pod state).
- A timeout that is short in test is long in production, so the leak window is wider.
- Production memory pressure changes scheduling behaviour.

Mitigation: run the production-config staging environment more rigorously, run chaos tests (kill upstreams, add latency), and integrate continuous profiling so leaks introduced in production are caught within an hour.

### Q23. You see `go_goroutines` climbing but `process_resident_memory_bytes` is flat. What's happening?

Goroutines are being spawned and parked, but their captures are tiny — small ints, no buffers. The 2 KB stack per goroutine still adds up, but it is slow. Two explanations:

1. A legitimate growth in concurrent work (more connections, more workers).
2. A leak that does not retain much heap — for example, leaking a goroutine that has no closures.

Cross-check the goroutine profile. If the same stack shows up in escalating counts and is not tied to active connections, it is a leak even though the heap is flat.

### Q24. Cross-checking heap and goroutine profiles — give an example.

Memory is at 5 GB. `pprof -top heap` shows `bytes.NewBuffer` at the top with 4 GB. `pprof -top goroutine` shows 10,000 goroutines at a `chan receive` in `handleStream`. Inspect the source: each `handleStream` goroutine reads request body into a `*bytes.Buffer`. The goroutine leaks because of a missing `ctx.Done` case in its select; the buffer it captured remains live as long as the goroutine does. Fixing the leak frees the 4 GB.

### Q25. How does the runtime collect a goroutine profile? Walk me through it.

`pprof.Lookup("goroutine").WriteTo(w, 0)` calls `runtime.goroutineProfileWithLabels`. The runtime stops the world (or in Go 1.19+, preempts per-goroutine), walks `runtime.allgs`, and for each non-dead goroutine constructs a sample: stack frames, labels, count. The samples are serialised into a protobuf and gzipped. STW is microseconds for small servers and milliseconds for million-goroutine servers.

### Q26. What is the cost of leaving `_ "net/http/pprof"` in a production build?

Negligible at runtime — the handlers are dormant until called. The risks are: the package adds a few KB to the binary, and someone might curl the endpoint without authorisation. Mitigate by binding pprof to a non-public port (localhost or admin VLAN) and not registering it on the public mux.

### Q27. Why might `goleak` fail intermittently on a CI machine?

CI is often slower than dev machines. A goroutine that was supposed to exit may still be in flight when `VerifyTestMain` checks. The fix is either:

- Make the cleanup synchronous (call `Wait` on the worker).
- Use `goleak.IgnoreTopFunction` for a known background goroutine that takes time.
- Increase poll wait inside the test's cleanup.

The wrong fix is to add the goroutine to a global ignore — that just hides the bug.

### Q28. A teammate says "let's not run `goleak` on all packages, it's flaky." What is your response?

`goleak` is not flaky; the leaks are real. Flakiness from `goleak` always points at one of: a real leak, an unsynchronised shutdown in the test, or a runtime-internal goroutine the default ignores missed. Investigate, fix, or ignore that specific function — do not drop the whole tool.

---

## Staff / System Design

### Q29. Design a continuous leak-detection pipeline for a 200-microservice company.

Capacity goal: detect a new leak within 30 minutes of deploy, attribute it to a commit, page the team that owns the service.

Components:

1. **Standard metrics shim.** All services link `prometheus/client_golang/collectors`, which exports `go_goroutines`. No service can opt out.
2. **Prometheus federation.** Per-cluster Prometheus, federated to a global one.
3. **Continuous profiler.** Pyroscope (or Grafana Cloud Profiles) scrapes goroutine profiles every 60 seconds from every service. Storage is one year of profiles, deduplicated by stack signature.
4. **Alerting.** A central rule: `deriv(go_goroutines{job=~".*"}[10m]) > 1 for 5m`. Routed by service label to the right team via Alertmanager and PagerDuty.
5. **Auto-attribution.** When an alert fires, a bot grabs the last deploy of that service (from the deploy registry) and posts the diff to the incident channel.
6. **Profile regression detection.** A nightly job pulls each service's profile from now and 24 hours ago, diffs the top 20 stacks, and surfaces any signature that grew more than 2x.
7. **Runbook automation.** Each service has a leak runbook URL; the alert links to it.

Cost: the profile storage is ~100 GB/month for 200 services. The compute cost of the diff job is one cron-driven container per region.

### Q30. How do you detect leaks in a serverless / FaaS-style Go binary that runs for seconds at a time?

Different mode: there is no long-running process to monitor. Each invocation must end with the goroutine count at baseline. Approaches:

- Wrap the entrypoint: at the end, `if runtime.NumGoroutine() > baseline+small { log + emit metric }`.
- Run `goleak.VerifyNone` at the end of each invocation in a non-test context (you can call `goleak`'s checking functions outside of tests).
- Aggregate the leak counter as a CloudWatch / GCP metric.

If you cannot afford to fail the request on a leak, at least emit telemetry. The next invocation gets a fresh process, so the leak does not accumulate — but the leak still happened, and tracking it across many invocations surfaces patterns.

### Q31. Two leaks at once: how do you separate them?

If `go tool pprof -base base.pb.gz now.pb.gz | top` shows two unrelated stacks each with thousands of goroutines, fix them in order of impact (largest count first). Each fix should be deployed separately so you can verify it independently. If you bundle both fixes into one PR and the count does not drop to baseline, you do not know which fix worked.

### Q32. The team has a goroutine pool of 1000 workers, all parked at `<-jobs`. Are these leaks?

No. They are intentional. They are not parked forever — they are waiting for work, and when work arrives they unpark. They show up in the profile but are not bugs. Document the pool's invariants and `goleak.IgnoreTopFunction("workerpool.(*Pool).run")` in the relevant test files.

### Q33. How do you teach a junior engineer to read a goroutine stack trace?

Step by step:

1. The first line tells you the goroutine ID and state: `goroutine 23 [chan send, 18 minutes]:`. State and duration matter.
2. The next lines are frames, innermost first. The top frame is *where the goroutine is parked*.
3. The `created by` line at the bottom tells you who spawned this goroutine. That is usually the function you need to fix.
4. If 1000 stacks all share the same top frame, you found the leak. The fix is one place, not 1000.

Hand them a real production profile and walk through one block together. Pattern recognition takes about three real examples to internalise.

### Q34. Will `runtime/trace` work to detect leaks?

Yes, with caveats. The trace records every `EvGoCreate` and `EvGoEnd`. A goroutine with a create event and no end event within the trace window is leaking for at least that window. But traces are expensive — megabytes per second — so you cannot run them continuously. Use them for *diagnosis* of a known leak (capture 10 seconds while reproducing), not for *detection*.

### Q35. What is the worst goroutine-leak bug you have seen, in your experience?

(This is a behavioural question. Have a real story ready: what was the symptom, how did you detect it, how did you fix it, what was the postmortem action item. The interviewer is looking for the loop — symptom, hypothesis, evidence, fix, prevention.)

Sample story: "A streaming endpoint leaked one goroutine per request because the upstream `select { case <-resp.Body: }` had no `case <-ctx.Done():`. Connections that timed out client-side left the server goroutine parked. We caught it on a Friday with a memory alert; goroutines were at 200k, doubling daily. Confirmed in pprof — 198k stacks at the same `chan receive` line. Patched the select; rolled out; goroutines settled to 50 baseline. Postmortem action: added `goleak.VerifyTestMain` to that package, plus a unit test that cancels the context and asserts the goroutine exits."

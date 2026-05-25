# Optimization Workflow — Professional

## 1. The production framing

In a production service, the optimization workflow is not "an engineer runs `pprof` and tunes a function." It is a continuous, team-level practice with budgets, gates, runbooks, and an incident pipeline. The professional job, roughly:

1. **Define SLOs** that express what "fast enough" means to users.
2. **Translate SLOs into per-service performance budgets** that the team can engineer against.
3. **Continuously measure** real user latency, tail behavior, allocation rate, GC CPU, and resource ceilings.
4. **Gate releases** on regression of the four numbers that matter.
5. **Triage and fix** the performance bugs that escape the gates.
6. **Run periodic deep optimization sprints** with executive support, not in spare time.

The rest of this file is what each of those looks like in practice.

---

## 2. SLOs and the error budget

A performance SLO is two numbers and a window:

> "p99 of `POST /checkout` < 300 ms over a rolling 28-day window, with a 99.9% achievement target."

The "achievement target" leaves a budget: 0.1% of the 28 days (about 40 minutes) can be over the threshold without violating the contract. That budget is what gives the team room to take engineering risks.

Three principles:

| Principle | Meaning |
|-----------|---------|
| SLO is set by the business, not by engineering | "Our customers tolerate 300 ms" — measured, not assumed |
| Error budget allows risk-taking | Burn it on feature velocity if reliable; spend it carefully if recovering |
| Optimization work is justified by budget burn | If you're burning 80% of the budget, optimization is now top priority |

The professional alternative to "optimize when someone complains" is "optimize when the error budget says to."

---

## 3. Translating SLO into budget

The user-visible SLO of 300 ms p99 must be allocated across all the systems that contribute. A typical allocation:

| Component | Budget at p99 |
|-----------|---------------|
| Edge / load balancer / TLS | 20 ms |
| API gateway + auth | 30 ms |
| Application (this service) | 100 ms |
| Downstream service A | 50 ms |
| Downstream service B | 30 ms |
| Database (sum of queries) | 50 ms |
| Margin / variance | 20 ms |
| **Total** | **300 ms** |

The application's 100 ms is the actual engineering target. Performance work in the service is judged against whether p99 of the service's own processing stays under 100 ms. The senior engineer who set the 100 ms is now the professional who has to defend it across releases.

---

## 4. The four dashboards every service needs

| Dashboard | Source | What it tells you |
|-----------|--------|-------------------|
| **Latency histogram** | Server-side timing, exported to Prometheus / Datadog | p50, p95, p99, p99.9 of each endpoint |
| **Throughput and saturation** | Request rate, CPU%, queue depth | Whether the service is at capacity |
| **GC and allocation** | `runtime/metrics`, gctrace | GC CPU fraction, allocation rate, live heap |
| **Resource ceilings** | Container metrics | RSS vs. limit, FD count, goroutine count |

Each chart should have an alert pointed at the threshold that maps to an action. "p99 climbing toward SLO" is not an alert; "p99 over 250 ms for 5 minutes" is.

---

## 5. Performance budgets per route

The 100 ms application budget is itself further decomposed into per-route budgets:

| Route | Budget at p99 | Reason |
|-------|---------------|--------|
| `POST /checkout` | 100 ms | The main customer flow |
| `GET /products/{id}` | 50 ms | High-frequency, cacheable |
| `POST /admin/*` | 500 ms | Tolerated; low frequency |
| `GET /health` | 10 ms | Probed every second; can't drift |

The budget is enforced via dashboards. A PR that pushes `/checkout` p99 from 80 ms to 95 ms in canary is not "still in budget"; it is "burning the budget" and the team should know about it before it merges.

---

## 6. The CI gate

Microbenchmarks run in CI on every PR. The output is fed through `benchstat` against a known-good baseline branch.

```bash
git fetch origin main
git checkout origin/main
go test -bench=. -benchmem -run=^$ -count=10 ./... > /tmp/base.txt
git checkout -
go test -bench=. -benchmem -run=^$ -count=10 ./... > /tmp/new.txt
benchstat /tmp/base.txt /tmp/new.txt
```

The gating rule is configured per benchmark:

| Benchmark | Allowed delta | Why |
|-----------|---------------|-----|
| `BenchmarkHotPath_*` | < 2% slower | On the SLO critical path |
| `BenchmarkAdmin_*` | < 15% slower | Off-critical |
| `BenchmarkParser_*` | < 5% slower | Used by many endpoints |
| `BenchmarkAllocations` | 0 new allocations | A regression of allocs/op is a release-blocker |

The CI script enforces this. PRs that violate must add justification or include an off-set elsewhere.

---

## 7. Continuous profiling

Capturing a profile only when on-call gets paged is too late. The professional answer is *continuous profiling*: a background agent captures short profiles (10–30 seconds, every few minutes) and ships them to a central store.

Tools:

| Tool | Notes |
|------|-------|
| `pprof` over HTTP, scraped by a sidecar | Self-rolled but flexible |
| Pyroscope (now Grafana Pyroscope) | Open source, integrates with Grafana |
| Datadog Continuous Profiler | Commercial, low overhead |
| Polar Signals Parca | Open source, eBPF-based |

The value is twofold:

1. When an incident happens, you have profile data from before the incident.
2. Slow drift across releases is visible as a change in profile shape, not just numbers.

A service running a continuous profiler exposes drift weeks before it shows up as an SLO breach.

---

## 8. The PGO pipeline

Profile-Guided Optimization (Go 1.21+) is integrated into the build pipeline.

```
production → continuous profile collection → 24h aggregate → default.pgo
                                                     ↓
                                                go build -pgo=auto
                                                     ↓
                                                next release binary
```

Steps in detail:

1. The continuous profiler aggregates 24 hours of CPU profiles into a single representative profile.
2. A scheduled job pulls the aggregate, validates it (sample count > 100k, average load > N), and writes it as `default.pgo` in the source tree.
3. The next CI build picks up `default.pgo` automatically with `-pgo=auto`.
4. The team reviews the PR that bumps the profile, looking for unexpected shape changes.

Typical wins: 2–10% on CPU. The discipline is keeping the profile *fresh* — a stale profile produces a binary optimized for the wrong workload. Re-collect monthly or on major workload changes.

---

## 9. The canary and the rollback

Every release is rolled out gradually. The professional shape of the rollout:

| Stage | Traffic | Duration | Block if |
|-------|---------|----------|----------|
| Smoke | Internal traffic only | 5 min | Any error or > 2× latency vs. prev |
| Canary 1% | 1% of prod | 30 min | p99 +15%, error rate +0.5%, GC CPU +30% |
| Canary 10% | 10% of prod | 1 hour | Same thresholds |
| Full | 100% | — | Same thresholds, with auto-rollback hook |

The auto-rollback hook reverts the deployment if any threshold is crossed in any stage. The release engineer doesn't have to be online; the automation does it.

This is the production version of "re-measure after the change." Microbenchmarks said the change was a win; the canary will tell you whether it's a win at real load.

---

## 10. Regression incident response

When a regression slips through the gate and hits production:

1. **Confirm.** Latency dashboard shows a step change at the deploy time? Compare canary vs. previous.
2. **Rollback first, diagnose second.** The service was fine yesterday; restore that state.
3. **Bisect.** Which commit in the release caused the regression?
4. **Capture.** A profile from the regressed version (if a pod still exists) vs. a profile from the fixed version.
5. **Fix forward.** Either revert that commit alone or fix the root cause in a follow-up.
6. **Post-mortem.** Why did the gate miss this? Add a benchmark or alert that would have caught it.

The post-mortem step is what makes the system better. Each escape is an opportunity to harden the gate.

---

## 11. Team practices

Performance is a property of the system, but it is maintained by the team. Practices that work:

| Practice | Cadence |
|----------|---------|
| Performance review per PR (lightweight) | Each PR — reviewer looks at benchstat output |
| Performance backlog | Continuous; each known issue ticketed with a profile snapshot |
| Optimization sprints | Quarterly; week-long focused effort |
| Performance "office hours" | Weekly; engineers bring profiles, the team triages |
| Post-mortems for SLO breaches | Every breach |
| Shared dashboards | Always; the four-number panel is fixture for every service |

The professional team treats performance as a first-class engineering concern, not as "we'll get to it after features."

---

## 12. The `runtime/metrics` panel

Build one Grafana panel per service exporting these:

| Metric | Why it matters |
|--------|----------------|
| `/sched/goroutines:goroutines` | Goroutine leaks |
| `/sched/latencies:seconds` (histogram) | Scheduler delay; signal of saturation |
| `/gc/heap/live:bytes` | Working set |
| `/gc/heap/allocs:bytes` (rate) | Allocation pressure |
| `/gc/pauses:seconds` (histogram) | GC pause distribution |
| `/cpu/classes/gc/total:cpu-seconds` (rate) | GC CPU fraction |
| `/cpu/classes/scavenge/total:cpu-seconds` (rate) | Background scavenger work |
| `/memory/classes/heap/objects:bytes` | Heap occupancy |

These map directly to the prometheus collector exposed by `prometheus/client_golang` with `GoRuntimeMetricsCollection`. One panel per service, identical across services, so on-call engineers don't have to relearn each service.

---

## 13. Cost-aware optimization

At scale, performance is also cost.

| Scenario | Cost dimension |
|----------|----------------|
| 1000 pods × 10% CPU saved | $X/month less in compute |
| 1000 pods × 20% memory saved | Allows smaller pod size, lower cost |
| Allocation rate halved | Lower per-pod CPU, often allows fewer pods |
| Latency 50 ms → 40 ms on customer-facing path | Hard to monetize; sometimes maps to conversion lift |
| Latency 200 ms → 150 ms on internal job | Often nothing |

Engineering hours are also money. A 10% improvement that costs $500/month in compute but two weeks of engineer time at $5000/week is a $9500 investment for $6000/year of return. The professional makes that math explicit before committing.

---

## 14. The optimization sprint

Periodic focused optimization works better than continuous trickle-optimization. Structure of a one-week sprint:

| Day | Activity |
|-----|----------|
| Monday | Gather profiles, agree on top 3 hotspots, write benchmarks for each |
| Tuesday | Apply candidate optimizations; pair on benchstat results |
| Wednesday | Continue; merge wins to a branch, leave failures documented |
| Thursday | Soak tests on the canary cluster; gather production profiles |
| Friday | Document, write up findings, plan next sprint's targets |

The output of the week is (a) measurable improvements landed and (b) a written record of what was tried and why. Both compound across sprints; the second sprint is faster than the first because the team is better calibrated.

---

## 15. Cross-team performance

When the bottleneck is in a service owned by another team, the workflow includes communication:

| Step | Action |
|------|--------|
| Identify | Profile shows the bottleneck is in a call to service Y |
| Quantify | Measure the contribution: "Service Y's p99 is 150 ms of our 200 ms budget" |
| Communicate | Open an issue with the data — profile, latency histogram, traffic shape |
| Collaborate | Offer to help; sometimes the fix is theirs, sometimes ours (batch, cache, retry policy) |
| Track | Add a dashboard for the cross-service latency; revisit |

The professional doesn't say "their service is slow" and move on. Cross-team performance work is some of the highest-leverage performance work because the bottlenecks usually involve more than one team.

---

## 16. Long-lived performance documentation

Each service maintains a `PERFORMANCE.md` (or wiki page) with:

| Section | Content |
|---------|---------|
| SLOs | Numbers, window, achievement target |
| Budget | Per-component breakdown of the SLO |
| Known hotspots | Functions you've optimized before and why they're shaped the way they are |
| Tuning history | Each non-obvious optimization, with date, person, before/after |
| Anti-patterns to avoid | "Do not replace this stack buffer with strconv" |
| Runbooks | RSS climbing, GC CPU high, goroutine leak |
| Benchmark baselines | Where to find them and how to run them |

This is the document a new team member reads in their first week. It is the memory of a team. Without it, every new engineer relearns the same lessons.

---

## 17. The gates against entropy

Performance regresses without active resistance. The five mechanisms that hold the line:

| Gate | Catches |
|------|---------|
| Microbenchmark CI | Function-level regressions |
| Canary thresholds | System-level regressions before full rollout |
| Continuous profiling alerts | Slow drift across releases |
| Quarterly optimization sprint | Accumulated debt that didn't trigger any gate |
| `PERFORMANCE.md` | Knowledge loss across team changes |

Each one catches what the others miss. A team running all five is far more performant than a team running just one or two.

---

## 18. Summary

Professional optimization is institutional: SLOs translate into per-route budgets; budgets are enforced by CI gates and canary thresholds; continuous profiling makes drift visible; PGO closes the loop from production back to compile; and team practices keep the work funded against feature pressure. The individual engineer's loop — measure, identify, change, re-measure — is unchanged, but it runs against a backdrop of institutional support and accountability. That's how performance survives organizational entropy.

---

## Further reading
- Google SRE book on SLOs: https://sre.google/sre-book/service-level-objectives/
- Go PGO documentation: https://go.dev/doc/pgo
- Grafana Pyroscope: https://grafana.com/oss/pyroscope/
- Polar Signals Parca: https://www.parca.dev/
- Datadog Continuous Profiler: https://docs.datadoghq.com/profiler/
- Susan Fowler, "Production-Ready Microservices" (book), chapter on performance

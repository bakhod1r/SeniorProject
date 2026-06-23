# Flame Graphs — Professional Level

> **Roadmap:** [Profiling](../README.md) → Flame Graphs
> *The senior page taught you to read one flame graph from one process. This page is about flame graphs as an always-on, fleet-wide artifact — aggregated across thousands of processes, queryable by service and version and tenant, diffed across releases in CI, and pulled up live during an incident. At this scale the widest box stops being "a slow function" and becomes a line item on your compute bill.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Continuous Profiling — Flame Graphs as Ambient Infrastructure](#continuous-profiling--flame-graphs-as-ambient-infrastructure)
4. [The Merged Fleet Flame Graph as a Cost Map](#the-merged-fleet-flame-graph-as-a-cost-map)
5. [Differential Flame Graphs in CI/CD](#differential-flame-graphs-in-cicd)
6. [Time-Comparison and Tag-Comparison Workflows](#time-comparison-and-tag-comparison-workflows)
7. [Flame Graphs in Incident Response](#flame-graphs-in-incident-response)
8. [Organizational Adoption — Making Flame Graphs the Lingua Franca](#organizational-adoption--making-flame-graphs-the-lingua-franca)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Flame graphs as a fleet-wide, always-on production artifact — a cost map, a regression detector, and an incident tool, not a one-off you generate when something is already on fire.**

The senior page treated a flame graph as something you *make*: attach a profiler, capture 30 seconds, fold the stacks, render the SVG, read it. That model has a fatal flaw at scale — it only fires *after* you suspect a problem, on *one* process you happened to pick, *long after* the regression shipped. By the time someone says "let's profile it," the regression has been burning CPU across the fleet for three weeks and you've already paid for it.

The professional model inverts this. Flame graphs are **ambient**: a continuous profiler samples every process in the fleet at 1-2% overhead, ships folded stacks to a central store labelled with `service`, `version`, `region`, `endpoint`, and `tenant`, and lets you render a flame graph for *any slice of the fleet over any time window* as a query. The flame graph stops being an artifact you produce and becomes a *view you select* — the same way you don't "generate" a metrics dashboard, you just open it.

That shift changes what flame graphs are *for*. A merged flame graph over the whole fleet is a **map of your compute bill** — the widest box is, almost literally, your biggest line item. A flame graph diffed across two releases is a **regression explainer** that turns "p99 is up 8%" into "here is the exact new wide box and the PR that added it." A live flame graph during a CPU spike is a **30-second incident triage**. This page is about wiring those workflows into how an organization actually runs.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — reading a flame graph fluently: width = time/samples, depth = stack depth, plateaus vs towers, flat vs cumulative, differential and off-CPU variants.
- **Required:** [../01-cpu-profiling/professional.md](../01-cpu-profiling/professional.md) — how the stacks that feed a flame graph are sampled, and the overhead/accuracy tradeoffs.
- **Helpful:** You've operated a service in production and owned its latency and its cloud bill.
- **Helpful:** You've run a metrics/observability stack (Prometheus, Grafana, Datadog) and understand labels/tags and time-series queries.

---

## Continuous Profiling — Flame Graphs as Ambient Infrastructure

The enabling technology is **continuous profiling**: a low-overhead agent that samples stacks across every process, all the time, and stores them centrally so any flame graph is a query away. The current platforms:

| Platform | Collection model | How it gets stacks | Notable trait |
|---|---|---|---|
| **Parca** (open source) | eBPF agent, whole-node | Kernel-side unwinding via eBPF; zero app changes | No per-app instrumentation; profiles everything on the box, any language |
| **Grafana Pyroscope** (was Pyroscope + Phlare) | eBPF *or* in-app SDK | eBPF agent, or language SDK (Go `pprof`, Java async-profiler) | Integrates with the Grafana/Loki/Tempo stack; trace-to-profile links |
| **Polar Signals Cloud** | eBPF (Parca lineage) | eBPF, whole-fleet | Hosted Parca with a query UI built for cost analysis |
| **Datadog Continuous Profiler** | In-app library | Language profilers shipped in the APM agent | Correlated with traces/metrics in one product |

The two collection models matter:

- **eBPF, whole-node (Parca/Pyroscope-eBPF/Polar Signals):** an agent runs per node, attaches to the kernel's perf events, and unwinds stacks for *every* process on the box — no recompile, no library, no app change. It profiles your Go service, the sidecar, the JVM, and `nginx` uniformly. The cost is that unwinding stripped or JIT'd stacks requires extra machinery (DWARF unwind tables, frame pointers, JIT symbol maps).
- **In-app library (Datadog, Pyroscope SDK):** you add a profiler dependency to the service. It produces perfectly symbolized stacks (the runtime knows its own functions) and rich labels, at the cost of per-language integration and a redeploy to roll out.

The number that makes all of this *safe to leave on forever* is the **overhead: a well-tuned continuous profiler costs 1-2% CPU and a few MB of RAM per process.** A 100 Hz sample (one stack snapshot per core every 10 ms) is statistically rich over minutes yet negligible per second. That is the entire unlock: at 1-2% you don't *decide* to profile, you just *always are*, and the cost is far smaller than the inefficiencies it surfaces. (Verify it for your workload — measure CPU with the agent on vs off before declaring it free.)

The other unlock is **labels**. Every sample carries dimensions, exactly like metric labels:

```
# A profiling query is "render a flame graph for this slice of the fleet, this window"
process_cpu{service="checkout", version="v2.7.1", region="us-east-1", endpoint="POST /charge"}

# Go: attach labels so they ride along on every sample under this context
pprof.Do(ctx, pprof.Labels("endpoint", "POST /charge", "tenant", tenantID), func(ctx context.Context) {
    handleCharge(ctx, req)
})
```

Now a flame graph is sliceable: *the CPU profile of just the `/charge` endpoint, only on `v2.7.1`, only in `us-east-1`, only for tenant `acme`, over the last hour.* That queryability is what turns flame graphs from a debugging trick into infrastructure.

> **The professional reality:** the value of continuous profiling is not that you *can* get a flame graph — you always could. It's that the flame graph is now *aggregated, labelled, and retroactive*. When a regression shipped three weeks ago, you don't need to reproduce it; you query the flame graph *from three weeks ago* and diff it against today. You can't do that with a profiler you only attach on demand.

---

## The Merged Fleet Flame Graph as a Cost Map

Here is the single most valuable view continuous profiling unlocks, and the one most teams never build: **merge every CPU sample from the entire fleet into one flame graph.** Not one service — *everything*. Every process, every node, summed.

In that merged graph, **width is proportional to total CPU consumed across the fleet, which is proportional to dollars.** If your fleet is 10,000 vCPUs at roughly \$0.04/vCPU-hour on-demand, that's about \$3.5M/year of compute, and the merged flame graph apportions every dollar of it to a function. **The widest box is your biggest line item.** A frame that's 12% of the merged graph is ~\$420k/year of compute spent inside that call path. This reframes optimization entirely: you stop optimizing the code that *feels* slow and start optimizing the code that *costs the most*, which is frequently dull infrastructure code nobody suspected.

What consistently shows up wide in real fleet flame graphs — and almost never in a single-service profile, because it's spread thinly everywhere:

- **Serialization / deserialization** — JSON `encoding/json` reflection in Go, Jackson in Java. A few percent per service, summed across the fleet, is often the single widest box.
- **Logging** — string formatting, `reflect`, and synchronous I/O in the log path. Logging "a little" everywhere adds up to a fortune.
- **Compression / TLS / framing** — gzip on every response, TLS handshakes, gRPC framing.
- **GC** — in managed runtimes, the collector itself is a wide, dollar-denominated box you can shrink with allocation work.
- **Reflection / dependency injection / ORM hydration** — framework overhead that's invisible per-request but enormous in aggregate.

The workflow for picking optimization targets that *move money*:

1. Render the merged fleet flame graph for, say, the last 7 days (averages out diurnal and per-service noise).
2. Sort frames by total width. Translate the top frames to dollars: `frame_share × fleet_vCPU × vCPU_cost`.
3. For each candidate, ask: *is this addressable?* A 15%-wide `json.Marshal` box is addressable (switch hot paths to a faster codec, or precompute). A 20%-wide "user business logic" box probably is not.
4. Optimize the widest *addressable* box, ship it, and **watch that box shrink in the next week's merged graph** — the same flame graph is your before/after proof and your savings receipt.

> **The principle:** a metrics dashboard tells you a service is expensive; the merged fleet flame graph tells you *which lines of code* are expensive, fleet-wide, in dollars. It converts "we should optimize something" into a ranked, costed backlog where every item has a number attached. A single afternoon spent reading the merged graph routinely finds a 5-15% fleet-wide CPU win that pays for the profiling platform many times over.

---

## Differential Flame Graphs in CI/CD

A regression alert tells you *that* something got slower. A **differential flame graph** tells you *what* and *where* — and wired into CI, it tells you *before* the regression ships.

The senior page introduced the differential (red = grew, blue = shrank, width = magnitude of change). The professional move is to **generate one automatically on every pull request** and fail the build if a frame grows beyond a threshold:

```yaml
# Sketch: a CI step that diffs a benchmark profile against the base branch
- name: CPU regression gate
  run: |
    # Profile the same representative workload on base and on PR
    go test -run=NONE -bench=BenchmarkHotPath -cpuprofile=pr.pprof ./...
    git checkout "$BASE_SHA" && go test -bench=BenchmarkHotPath -cpuprofile=base.pprof ./...
    # pprof's built-in diff: positive = PR is slower
    go tool pprof -top -diff_base=base.pprof pr.pprof | tee diff.txt
    # Fail if any single frame regressed more than the budget
    ./scripts/fail-if-regressed.sh diff.txt --threshold=5%
```

The output you actually want posted on the PR is not a number — it's the **rendered differential flame graph**, so the reviewer *sees* the new red box and its call path. The difference in a perf review is stark:

- **Without it:** "p99 went up 8% after the last deploy. Bisecting the 40 PRs in that release." Hours to days.
- **With it:** "This PR's differential flame graph shows a new 9%-wide red box: a `validateSchema` call now runs inside the request loop instead of at startup. Here's the frame, here's the line." Minutes, with the explanation attached.

Two modes are worth running:

- **In CI on a benchmark** (above): catches the regression *pre-merge*, against a deterministic workload. Cheap and early, but only as representative as your benchmark.
- **In production across releases** (next section): catches what the benchmark missed, using the continuous profiler's stored data — diff the live flame graph of `v2.7.1` against `v2.7.0`. Catches real-traffic regressions, but only after rollout.

> **The professional discipline:** a latency or CPU regression alert that doesn't link to a differential flame graph is a half-finished alert. The number tells you to care; the differential tells you *what changed*, in one picture, often pointing at the exact PR. Make "diff the flame graph" the reflexive first step after any perf regression — and automate it so the answer is waiting before anyone asks.

---

## Time-Comparison and Tag-Comparison Workflows

Continuous profiling's labels enable two families of comparison that are the daily bread of fleet performance work. Both are *the same differential flame graph*, just with different things on either side.

**Time comparison — "this version vs last."** Pick the same service and workload, set the left side to last week and the right side to this week (or `version=v2.7.0` vs `version=v2.7.1`), and render the diff. This is how you answer "did the release we shipped Tuesday change our CPU profile?" without any benchmark — real production traffic on both sides. It catches the slow creep that no single PR triggered: a frame that grew 0.5% per release for ten releases is a 5% regression hiding in plain sight, invisible to per-PR gating but obvious in a month-over-month time diff.

**Tag comparison — "A vs B, side by side."** The labels make A/B-style profile diffs trivial:

- **Canary vs baseline.** During a progressive rollout, diff `version=canary` against `version=stable` *on live traffic*. A new red box in the canary's flame graph is a regression you catch at 5% rollout instead of 100%. This is the single highest-leverage gate — it uses real traffic and stops the regression before full deploy.
- **Tenant A vs tenant B.** Diff `tenant=acme` against `tenant=globex`. If one tenant's flame graph has a wildly wider box, their data shape is hitting a pathological path (an N² loop that only triggers above some cardinality, a cache that only one tenant blows). Multi-tenant performance bugs are nearly invisible in aggregate and obvious in a per-tenant diff.
- **Region vs region, instance-type vs instance-type.** Diff `region=us-east-1` vs `eu-west-1`, or `c7g` (Graviton) vs `c6i` (x86), to see whether a hot path behaves differently per architecture — common after an ARM migration.

```
# The mental query for any comparison: same shape, two slices
diff(
  baseline = cpu{service="checkout", version="v2.7.0"}[last week],
  target   = cpu{service="checkout", version="v2.7.1"}[this week]
)
# red frames = wider in target = regressed; blue = improved
```

> **The reality:** these comparisons are only possible because every sample is labelled and retained. The skill is choosing the *right two slices* so the diff isolates one variable — same service, same endpoint, change only the version (or only the tenant, or only the region). A diff that changes two things at once tells you nothing; a diff that changes exactly one thing hands you the cause.

---

## Flame Graphs in Incident Response

It's 2 a.m. A service is pinned at 100% CPU, latency is climbing, and the on-call has minutes. **Continuous profiling turns the scariest incident class — "it's slow and we don't know why" — into a 30-second read.**

Without a continuous profiler, the on-call's options during a live CPU spike are grim: SSH to a box and hope `perf` is installed and works on a JIT'd runtime, or attach a profiler to a process that's already melting and add load to the fire, or — most often — restart it and lose the evidence. With continuous profiling, the on-call opens the profiler UI, scopes to the burning service and the *last 5 minutes*, and reads the live flame graph:

1. **Scope to the incident window and service.** `service=checkout`, last 5 minutes, region of the spike.
2. **Read the top of the flame graph in seconds.** The widest box during the spike *is* the thing eating the CPU. A flame graph is readable in well under a minute once you're fluent.
3. **Diff against "before the spike."** Time-compare the spike window against an hour earlier. The new red box is the regression or the runaway path — frequently a retry storm hammering one function, a cache that just started missing, a hot loop triggered by a specific input, or GC thrashing from an allocation spike.
4. **Act on the box, not a guess.** "It's a tight loop in `decodeAvro` that wasn't there an hour ago" is an actionable finding. "CPU is high" is not.

What live flame graphs typically reveal in incidents: a poison-pill request driving an unbounded loop; a feature flag flip that activated an expensive code path; a dependency timeout converting into a synchronous retry storm; a cache stampede turning cheap lookups into expensive recomputes; GC pressure dominating after a memory leak. In every case the flame graph names the function, and the time-diff dates the onset to the deploy or flag-flip that caused it.

> **The professional reality:** the value here is *speed under pressure* and *evidence that survives*. A live, queryable flame graph collapses the "why is it slow" phase of an incident from an hour of SSH archaeology to a 30-second read, and — because the data is stored — the flame graph is still there for the postmortem after you've restarted the service. An on-call who can read a flame graph in 30 seconds is worth a great deal at 2 a.m. Make sure that fluency is trained *before* the incident, not improvised during it.

---

## Organizational Adoption — Making Flame Graphs the Lingua Franca

The tooling is the easy part. The hard part — and the real professional skill — is making flame graphs *how your organization talks about performance*, so a flame graph is the expected evidence in any perf discussion, the way a stack trace is the expected evidence in a bug report.

What "adopted" looks like in practice:

- **Flame graphs are the default evidence in perf reviews.** "It's slow" is not an accepted claim; "here's the flame graph, here's the wide box" is. A performance PR that doesn't show a before/after differential gets sent back, the same way a bugfix without a test gets sent back.
- **They're embedded where people already look.** A link from the latency dashboard straight to that service's flame graph for the same time window. A trace-to-profile link so a slow trace in the APM opens the flame graph for that exact request path. People won't go to a separate tool; bring the flame graph to them.
- **Reading them is trained, not assumed.** Run a 30-minute internal workshop: here's width vs depth, here's flat vs cumulative (the #1 misread — "this function is 50% so I'll optimize it" when 50% is *cumulative* and its own body is 2%), here's how to read a differential. Seed a wiki of *your own* annotated flame graphs — your serialization box, your GC box, your logging box — so newcomers recognize your fleet's recurring shapes.
- **The cost map drives a costed backlog.** The merged fleet flame graph, reviewed quarterly, produces a ranked list of optimization targets each with a dollar figure. That turns "we should do some perf work" into a prioritized, funded program where wins are measured in budget.
- **It's wired into the release gate.** Differential flame graphs in CI and canary-vs-baseline diffs on rollout make "did this regress performance?" a checklist item, not an afterthought.

The cultural payoff: a flame graph is a *shared visual vocabulary*. A senior engineer, a new hire, and a manager can look at the same picture and agree on what's expensive — the wide box — without anyone needing to read the code. That shared sight is what makes performance a tractable team activity instead of the private art of one or two experts.

> **The lesson:** the organizations that win at performance aren't the ones with the fanciest profiler — they're the ones where *everyone can read a flame graph and is expected to bring one.* The technology gets you flame graphs; the culture gets you a fleet that stays fast. Invest in the training and the embedding, not just the tool.

---

## War Stories

**The logging that cost 15% of the fleet.** A team finally built the merged fleet flame graph — every service, summed, over a week. The single widest box, at ~15% of all CPU across ~8,000 vCPUs, was not any product feature: it was the *logging path* — synchronous JSON encoding plus reflection plus formatting on a log line emitted on every request, in every service, via a shared library. Nobody had ever seen it because per-service it was only "a couple percent" and looked like background noise. Summed, it was roughly \$500k/year. The fix — switch the shared logger to a zero-allocation structured logger (`zap`/`zerolog` in Go), drop the per-request debug line to sampled — shrank that box to ~3% in the next week's merged graph. One library change, one visibly thinner box, a six-figure annual saving that was invisible to every dashboard.

**The differential that pinned the regression to one PR.** p99 latency on a checkout service rose ~8% the morning after a release that bundled 31 PRs. The old playbook was a day of bisecting. Instead the on-call time-diffed the production flame graph: `version=new` vs `version=old`, same endpoint. One new red box, ~9% wide: `validateRequestSchema` was now executing *inside* the per-request handler instead of once at startup — a refactor in a single PR had moved the schema compilation into the hot path. The differential pointed at the exact frame; `git log` for that function named the PR in seconds. Total time from alert to root cause: under ten minutes, with a screenshot of the red box attached to the incident.

**The 2 a.m. spike read live.** A Java service spiked to 100% CPU under normal traffic. The on-call opened Pyroscope, scoped to the service and the last 5 minutes, and read the flame graph: an enormous box in `Pattern.compile` deep under a request handler. A config change had shipped a user-supplied regex that was being *recompiled on every request* (no cache) and, worse, was catastrophically backtracking on certain inputs — a ReDoS in disguise. Diffing against an hour earlier confirmed the box appeared exactly at the config push. The fix (cache the compiled pattern, bound the input) went out in 20 minutes. No SSH, no `perf`, no lost evidence — the flame graph named the function and the time-diff dated the cause.

**The per-tenant diff that found the N².** A multi-tenant service was mostly healthy but one large tenant complained of slowness that never reproduced in load tests. Aggregate flame graphs looked fine. Diffing `tenant=bigcorp` against `tenant=average` exposed a wildly wide box in a permission-resolution function — an O(n²) over the tenant's group membership that only became expensive above ~10k groups, a scale only that one tenant hit. Invisible in aggregate, glaring in the per-tenant diff. The labels turned an unreproducible "it's slow for one customer" into a one-glance diagnosis.

---

## Decision Frameworks

**Should we adopt continuous profiling? Ask:**
- Do we run more than a handful of services and care about our compute bill? → yes; the merged cost map alone usually pays for it.
- Can we tolerate 1-2% CPU overhead, always on? → for almost every fleet, yes (and the savings dwarf it). Measure it to be sure.
- Do we keep getting "it's slow and we don't know why" incidents? → yes; live flame graphs are the cure.

**eBPF (whole-node) or in-app SDK? Ask:**
- Polyglot fleet, want zero app changes, want sidecars/runtimes profiled too? → eBPF (Parca / Pyroscope-eBPF / Polar Signals). Budget for unwinding setup (frame pointers / DWARF / JIT maps).
- Already deep in one APM and want profiles correlated with traces in one product? → in-app (Datadog) or Pyroscope SDK. Accept per-language integration and a redeploy.

**Which flame graph do I open for this question?**
- "What costs us the most, fleet-wide?" → **merged fleet flame graph**, 7-day window, sorted by width, translated to dollars.
- "Did this PR regress?" → **differential in CI** against the base branch's benchmark profile.
- "Did this release regress on real traffic?" → **time/version diff** of the production flame graph, new vs old.
- "Is the canary healthy?" → **canary-vs-baseline tag diff** during rollout.
- "Why is one tenant/region slow?" → **tag diff** isolating that one label.
- "Why is it on fire *right now*?" → **live flame graph**, scoped to the service and the last few minutes, diffed against an hour ago.

**Is this wide box worth optimizing? Ask:**
- Translate its width to dollars (`share × fleet_vCPU × cost`). Is the number big enough to fund the work?
- Is it *addressable* — infra/serialization/logging code you can change — or irreducible business logic?
- Will the fix *show* as a thinner box next week? If you can't measure the win on the same graph, be skeptical it's real.

---

## Mental Models

- **A flame graph is a *view you select*, not an artifact you produce.** With continuous profiling, "get me the flame graph for `/charge` on `v2.7.1` in `us-east-1` last Tuesday" is a query. The profiler is always on; you're just choosing a slice.

- **In the merged fleet flame graph, width is dollars.** The widest box is your biggest compute line item. Optimize the widest *addressable* box and watch it shrink — that's your savings receipt, on the same picture.

- **A differential flame graph is a regression *explainer*, not just a detector.** "p99 up 8%" is the alarm; the new red box and its call path are the answer. An alert without a linked differential is half-finished.

- **The right diff changes exactly one variable.** Version vs version, tenant vs tenant, canary vs baseline — same service, same endpoint, one thing different. Change two things and the diff means nothing.

- **The flame graph is the lingua franca of performance.** A wide box is something a new hire, a staff engineer, and a manager can all see and agree on without reading code. That shared sight is what makes perf a team sport.

- **1-2% overhead is the price of never being blind.** Always-on profiling costs far less than the inefficiencies and incidents it surfaces. The cheapest profile is the one already running when the incident starts.

---

## Common Mistakes

1. **Only profiling reactively.** Attaching a profiler *after* a regression ships means you've already paid for weeks of waste and you can't profile the past. Continuous profiling lets you diff today against three weeks ago. If you're still SSHing in with `perf` to investigate, you're a tier behind.

2. **Never building the merged fleet flame graph.** Teams render per-service flame graphs and miss the single most valuable view — *everything summed* — where logging/serialization/GC reveal themselves as six-figure boxes that are invisible per-service. Build the cost map.

3. **Reporting a regression as a number with no flame graph.** "p99 up 8%" sends someone bisecting for a day. The differential flame graph names the frame in minutes. Always attach the diff.

4. **Diffing two slices that differ in more than one way.** Comparing `v2.7.1 in us-east` against `v2.7.0 in eu-west` confounds version with region. Hold everything constant but the one variable you're testing.

5. **The cumulative-vs-flat misread, now at scale.** "This frame is 50% of the graph, I'll optimize it" — when 50% is *cumulative* (it and its callees) and the frame's own body is 2%. The widest *leaf-heavy* box, not the widest box near the root, is usually the target. Train this; it's the #1 error.

6. **Treating overhead as free without measuring.** 1-2% is typical, not guaranteed — a pathological unwinding setup or a too-high sample rate can cost more. Measure CPU with the agent on vs off on *your* workload before declaring it safe to leave on everywhere.

7. **Buying the tool and skipping the culture.** A continuous profiler nobody can read is shelfware. The win comes from training teams to read flame graphs, embedding them in dashboards and PRs, and *expecting* one as evidence. Invest in adoption, not just installation.

---

## Test Yourself

1. Explain why 1-2% overhead is the specific property that makes continuous profiling viable, and what it unlocks that on-demand profiling cannot.
2. In a merged fleet flame graph, a frame is 12% of the total. Your fleet is 10,000 vCPUs at \$0.04/vCPU-hour. Roughly what is that frame costing per year, and what's your next question before optimizing it?
3. A release of 30 PRs raises p99 by 8%. Describe the differential-flame-graph workflow that pins it to one PR, and contrast the time-to-root-cause with bisecting.
4. You want to know whether a canary is healthy on live traffic. Which two slices do you diff, and what does a new red box mean?
5. A service is at 100% CPU right now. Walk through the live-flame-graph incident workflow, including how you date the onset.
6. Give two reasons a wide box in the *merged fleet* graph (e.g. logging) is invisible in any single-service profile.
7. A teammate says "this frame is 60% of the flame graph, I'm going to optimize it." What's the trap, and what do you check first?

<details>
<summary>Answers</summary>

1. At 1-2% CPU the profiler is cheap enough to **leave on for every process forever**, so you're never *deciding* to profile — you always are. That unlocks three things on-demand profiling can't: (a) **aggregation** across the whole fleet (the cost map), (b) **labels** so any flame graph is a queryable slice (service/version/tenant/endpoint), and (c) **retroactivity** — you can render and diff a flame graph from *the past*, so a regression that shipped weeks ago doesn't need to be reproduced. On-demand profiling only fires after you suspect a problem, on one process, with no history.
2. `0.12 × 10,000 vCPU × $0.04/hr × 8,760 hr/yr ≈ $420k/year`. Before optimizing, ask **is it addressable?** — is it infra code you can change (serialization, logging, compression) or irreducible business logic? Optimizing a 12% "user logic" box may be impossible; a 12% `json.Marshal` box is a clear target.
3. Time/version-diff the production flame graph: baseline `version=old`, target `version=new`, same service and endpoint. The new **red box** is the regressed call path; read its function, then `git log` that function to find the PR that touched it. Time to root cause: **minutes**, with the frame and PR identified. Bisecting 30 PRs blindly is **hours to a day** and tells you *which* PR but not *why*.
4. Diff `version=canary` against `version=stable` (or `baseline`), same service/endpoint, on **live traffic** during the rollout. A new **red box** in the canary means that call path got wider — a regression — caught at ~5% rollout instead of 100%.
5. Open the continuous profiler, **scope to the burning service and the last ~5 minutes**, read the widest box (that's what's eating CPU), then **time-diff the spike window against an hour earlier** — the new red box is the runaway path, and the moment it appears dates the onset to a deploy/flag-flip/traffic change. Act on the named function, not a guess. The data persists, so it's still there for the postmortem after a restart.
6. (a) **Per service it's small** — logging at "2%" looks like background noise; only *summed across hundreds of services* does it become the widest box. (b) It's **spread across many services via a shared library**, so no single profile shows it as significant — the cost only concentrates when you merge everything.
7. The trap is **cumulative vs flat**: 60% is almost certainly the frame *plus everything it calls*; the frame's own body (its self/flat time) may be ~1%. Optimizing the frame itself does nothing. Check the **flat/self time** (or look for the wide *leaf* boxes underneath it) — the optimizable work is in the leaf-heavy frames, not the wide near-root frame.

</details>

---

## Cheat Sheet

```
CONTINUOUS PROFILING (always-on, fleet-wide)
  Parca / Polar Signals  eBPF, whole-node, zero app change, polyglot
  Grafana Pyroscope      eBPF OR SDK; trace<->profile links
  Datadog Profiler       in-app lib; correlated with APM traces
  Overhead: 1-2% CPU, few MB RAM  -> safe to leave ON forever (measure it)

LABELS = QUERYABLE FLAME GRAPHS
  cpu{service=,version=,region=,endpoint=,tenant=}
  Go:  pprof.Do(ctx, pprof.Labels("endpoint", ep), func(ctx){ ... })
  A flame graph is now a VIEW YOU SELECT, not an artifact you make

MERGED FLEET FLAME GRAPH = COST MAP
  merge ALL samples, all services, 7-day window
  width  = total fleet CPU = dollars
  $/yr  = frame_share x fleet_vCPU x vCPU_cost x 8760
  optimize the widest ADDRESSABLE box -> watch it shrink next week
  usual suspects: serialization, logging, compression, GC, reflection

DIFFERENTIAL (regression EXPLAINER, not just detector)
  red = grew, blue = shrank, width = magnitude
  CI gate:   go tool pprof -diff_base=base.pprof pr.pprof  (fail if frame +>5%)
  prod diff: version=new vs version=old, same endpoint
  post the RENDERED diff on the PR, not a number

COMPARISON WORKFLOWS (change exactly ONE variable)
  version vs version   did the release regress?  (time diff)
  canary vs baseline   healthy rollout?          (catch at 5%)
  tenant A vs B        per-customer pathology     (hidden N^2)
  region / arch diff   x86 vs Graviton after migration

INCIDENT (live read in 30s)
  scope: service + last 5 min  ->  widest box = the culprit
  diff vs 1 hour ago  ->  new red box = onset, dates the cause
  data persists -> still there for the postmortem after restart

ADOPTION (the actual hard part)
  flame graph = required evidence in perf reviews
  link dashboards/traces -> the matching flame graph
  train width/depth + flat-vs-cumulative (the #1 misread)
  merged cost map -> quarterly costed optimization backlog
```

---

## Summary

- **Continuous profiling makes flame graphs ambient.** An eBPF or in-app agent samples every process at **1-2% overhead**, ships labelled folded stacks centrally, and turns "get the flame graph for this slice of the fleet over this window" into a query — aggregated, labelled, and *retroactive*. That's the unlock on-demand profiling can never give you. Platforms: **Parca, Grafana Pyroscope, Polar Signals, Datadog**.
- **The merged fleet flame graph is a cost map.** Sum every sample across the fleet and width becomes dollars — the widest box is your biggest compute line item. Translate frames to `$/year`, optimize the widest *addressable* one (usually serialization, logging, or GC), and watch it shrink as your savings receipt.
- **Differential flame graphs explain regressions, not just detect them.** Diff a PR against its base in CI to catch regressions pre-merge, and diff `version=new` vs `version=old` in production to catch what the benchmark missed. The new red box turns "p99 up 8%" into "this frame, this PR" — attach the rendered diff, always.
- **Tag and time comparisons isolate one variable at a time.** Version-vs-version finds slow creep; canary-vs-baseline catches regressions at 5% rollout; tenant-vs-tenant exposes per-customer pathologies invisible in aggregate. Change exactly one label and the diff hands you the cause.
- **Live flame graphs collapse the worst incident class.** "It's slow and we don't know why" becomes a 30-second read: scope to the service and the last few minutes, see the widest box, diff against an hour ago to date the onset — and the stored data survives the restart for the postmortem.
- **Adoption is the real work.** Make a flame graph the *expected evidence* in perf reviews, embed it in dashboards and PRs, train teams to read width/depth and flat-vs-cumulative, and let the cost map drive a costed backlog. The tool gets you flame graphs; the culture gets you a fleet that stays fast.

The remaining tier — [interview.md](interview.md) — distills the whole topic into the questions that test whether someone can actually read a flame graph and reason about it at fleet scale.

---

## Further Reading

- [Brendan Gregg — Flame Graphs](https://www.brendangregg.com/flamegraphs.html) — the canonical reference, including differential and off-CPU variants.
- [Parca documentation](https://www.parca.dev/docs/overview) — eBPF whole-node continuous profiling and the query model.
- [Grafana Pyroscope documentation](https://grafana.com/docs/pyroscope/latest/) — eBPF and SDK collection, plus trace-to-profile correlation.
- [Polar Signals — continuous profiling](https://www.polarsignals.com/) — Parca-based hosted profiling with a cost-analysis UI.
- [Go `runtime/pprof` labels (`pprof.Do`)](https://pkg.go.dev/runtime/pprof#Do) — attaching the labels that make flame graphs sliceable in Go.
- [async-profiler](https://github.com/async-profiler/async-profiler) — the standard low-overhead JVM profiler feeding Java flame graphs.
- [`go tool pprof -diff_base`](https://pkg.go.dev/net/http/pprof) — the built-in differential that powers a CI regression gate.

---

## Related Topics

- [junior.md](junior.md) — what a flame graph is and how to read width, depth, and color.
- [senior.md](senior.md) — fluent reading: plateaus vs towers, flat vs cumulative, differential and off-CPU variants.
- [interview.md](interview.md) — the questions that probe whether you can read and reason about flame graphs.
- [../01-cpu-profiling/professional.md](../01-cpu-profiling/professional.md) — how the stacks that feed these flame graphs are sampled at scale, and the overhead tradeoffs.
- [../../04-cpu-bound-optimization/professional.md](../../04-cpu-bound-optimization/professional.md) — what you do with the widest box once the flame graph has named it.

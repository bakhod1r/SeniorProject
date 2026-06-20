# CPU Profiling — Professional Level

> **Roadmap:** [Performance](../../README.md) → [Profiling](../README.md) → CPU Profiling
> *The senior page made you trust a single profile. This page is about never taking one again — because by now the profiler is always running, on every host, and the question is no longer "let me profile this" but "what does last Tuesday's fleet profile say, sliced by endpoint, diffed against the release before it, and costed in dollars per core?" CPU profiling stops being a tool you reach for during an incident and becomes a continuously-running sensor that funds itself.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Continuous, Always-On Profiling as Infrastructure](#continuous-always-on-profiling-as-infrastructure)
4. [The Overhead Budget That Makes It Safe](#the-overhead-budget-that-makes-it-safe)
5. [Attributing Fleet CPU Cost to Teams, Services, and Functions](#attributing-fleet-cpu-cost-to-teams-services-and-functions)
6. [Labels and Tags — Slicing the Profile by Application Dimension](#labels-and-tags--slicing-the-profile-by-application-dimension)
7. [Diffing Profiles Across Releases to Catch Regressions](#diffing-profiles-across-releases-to-catch-regressions)
8. [PGO — The Production Profile as a Build Input](#pgo--the-production-profile-as-a-build-input)
9. [Capturing a Profile During a Live Incident](#capturing-a-profile-during-a-live-incident)
10. [The Org Workflow — Who Owns the Profiler](#the-org-workflow--who-owns-the-profiler)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **CPU profiling operated as a fleet-wide, always-on production practice — where a profile is a stored time series, attribution is a cost-accounting line item, and the highest-value profiles are the ones you didn't know to take.**

The senior page taught you to trust a profile: which event, which unwinder, whether skid lied, whether safepoint bias crowned the wrong method. That skill is necessary and not sufficient. At the professional level the binding constraint is no longer *can I read this profile correctly* — it's *can I afford to have a profile of every production process at every moment in the past, and can I turn that into decisions other people act on*.

That shift changes everything. A one-off profile of a synthetic benchmark answers "what is hot under the load I imagined." A continuous profile of the real fleet answers "what is hot under the load that actually exists" — production data distributions, the real traffic mix, the cache pressure of co-tenants, the GC behavior of real heaps. The two routinely disagree, and the gap is where the expensive bugs live: the 30% CPU win that is invisible in every benchmark because the pathological input only occurs in production.

This page is about operating that sensor. Continuous profiling at a sub-2% overhead budget; attributing fleet CPU to teams and dollars; slicing by endpoint and tenant with labels; diffing releases to catch a regression at the commit; feeding production profiles back into the compiler as PGO; pulling an on-demand profile during a live incident without taking the service down; and the org plumbing that decides who owns the profiler and how a regression gets routed to the team that caused it. Go and Java are the worked examples throughout, because they have the most mature production-profiling stories.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the PMU, events, skid/PEBS, unwinding modes, safepoint bias, on-CPU vs off-CPU, symbolication, and the overhead/observer-effect model. This page assumes all of it.
- **Required:** You've operated a service in production and shipped a release that regressed something you didn't catch in CI.
- **Helpful:** You've owned a cloud bill, or sat in a meeting where someone asked "why did our compute spend go up 20%?"
- **Helpful:** You've run an incident bridge and needed data from a process you could not restart.
- **Helpful:** Familiarity with one continuous-profiling stack (Parca, Pyroscope/Grafana, Datadog, or Polar Signals) and pprof's label API or async-profiler's contextual tagging.

---

## Continuous, Always-On Profiling as Infrastructure

The senior page introduced continuous profiling as a capability. At the professional level it's a *system you run*, with the same operational weight as your metrics pipeline — agents, a storage backend, retention policy, query API, and an on-call rotation when it breaks.

The lineage matters because it explains the design. Google's **Google-Wide Profiling (GWP)** (Ren et al., IEEE Micro 2010) established the model: sample a small, randomly-chosen subset of machines across the entire datacenter at low frequency, all the time, and aggregate the results centrally. The insight was statistical — you don't need to profile every host continuously; you need enough samples across the fleet that aggregate attribution converges. GWP made "which function, across all of Google, burns the most CPU" a query you ran against a table, not a study you commissioned. Every modern continuous profiler is a descendant of that idea.

The open-source and commercial successors split into two architectural camps:

- **eBPF, whole-system, zero-instrumentation** — **[Parca](https://www.parca.dev/)** / Parca Agent and the **[Pyroscope](https://pyroscope.io/)** eBPF agent attach a `perf_event` stack sampler in the kernel via eBPF, sample on-CPU stacks of *every* process on the host, aggregate stacks in a BPF map in-kernel, and ship pre-folded stacks to a server. No recompile, no SDK, no per-app config — you get a flame graph of `postgres`, your Go service, and the JVM next to it, on a host you never instrumented. **[Polar Signals Cloud](https://www.polarsignals.com/)** is the commercial Parca lineage.
- **SDK / agent, per-language, context-aware** — **Datadog Continuous Profiler**, **Grafana Cloud Profiles** (Pyroscope SDKs), and the per-language libraries link into the process and emit profiles with application context attached (request tags, trace IDs, deploy version). They cost a recompile/dependency but give you labels the kernel can't see — *which endpoint*, *which tenant*, *which trace*.

```bash
# Parca Agent: system-wide continuous profiling via eBPF, no app changes
parca-agent \
  --node="$(hostname)" \
  --remote-store-address=parca.observability.svc:7070 \
  --profiling-cpu-sampling-frequency=19   # 19 Hz: deliberately low, fleet-safe
```

```go
// Pyroscope Go SDK: per-process, with deploy/version tags the kernel can't know
pyroscope.Start(pyroscope.Config{
    ApplicationName: "checkout-service",
    ServerAddress:   "https://profiles.grafana.net",
    Tags: map[string]string{
        "version": os.Getenv("GIT_SHA"),
        "region":  os.Getenv("AWS_REGION"),
    },
})
```

The choice between camps is the recurring professional tradeoff: eBPF agents give you *coverage* (everything, instantly, no buy-in from app teams) but only the dimensions the kernel sees (process, function, host). SDKs give you *richness* (endpoint, tenant, trace correlation) but require every team to adopt them. The mature answer is usually **both** — an eBPF agent for fleet-wide baseline coverage, plus SDK labels in the services where slicing by endpoint or tenant pays for the integration cost.

What you get for running it is a profile *of the past*. Metrics tell you CPU was at 80% at 14:32; a continuous profiler tells you *which function* was burning that 80% at 14:32, queryable after the fact, without having reproduced anything. That is the capability that turns "we couldn't repro it" into "let me pull the profile from the window it happened in."

> **The professional reality:** continuous profiling is the fourth observability pillar, next to metrics, logs, and traces — and it's the only one that answers "where exactly are the cycles going" at function granularity, fleet-wide, retroactively. Standing it up is infrastructure work (agents, storage, retention, query), not a developer convenience. Once it exists, "let me profile this" is replaced by "let me query the profile that's already there."

---

## The Overhead Budget That Makes It Safe

The entire practice rests on a single number: the per-host overhead has to be small enough that running it *permanently on production* is uncontroversial. The working budget is **under 1–2% of CPU**, and everything about the design exists to hold that line.

The math is the senior overhead model applied at scale. Cost per sample is roughly: take the interrupt, latch the RIP, walk the stack, record. At 19 Hz with frame-pointer or eBPF unwinding, that's a few microseconds, nineteen times a second, per core — comfortably under 1%. The levers, in order of impact:

- **Frequency.** Linear in cost. GWP-style fleet profiling runs at **~19–100 Hz**, not the 999 Hz you'd use for a focused one-off. You compensate for the lower per-host rate with the *number of hosts and duration* — aggregate samples across the fleet still converge.
- **Unwinding method.** This is where budgets are blown. Frame pointers (`-fno-omit-frame-pointer`, `-XX:+PreserveFramePointer`) and LBR are cheap; **DWARF unwinding copies kilobytes of stack per sample** and can push a continuous profiler from sub-1% to several percent — fine for a one-off, disqualifying for always-on. This is the single biggest reason Fedora and Ubuntu re-enabled frame pointers archive-wide: it converts the whole fleet from "DWARF-only, expensive to profile" to "fp, cheap to profile always."
- **In-kernel aggregation.** eBPF agents fold stacks into a BPF map *in the kernel* and hand userspace pre-aggregated counts, instead of copying every raw sample out. That slashes both data volume and the userspace CPU of the agent itself.
- **Sampling, not tracing.** Continuous profiling samples; it never instruments every function entry. Instrumentation cost scales with call frequency and would inflate hot leaf functions 10–100× (the senior instrumentation-distortion point) — fatal for an always-on tool.

```bash
# Measure your profiler's actual overhead before trusting the budget:
perf stat -e task-clock -p <pid> -- sleep 60      # baseline, profiler off
# enable continuous profiling, repeat; the delta IS your overhead budget spend
```

The discipline is to **measure** the overhead, not assume it. A misconfigured agent — DWARF unwinding on, frequency cranked, no in-kernel folding — can quietly cost 5–8% across the fleet, which on a 10,000-core footprint is 500–800 cores of pure observability tax. The budget isn't a vibe; it's a line item you verify, because the whole justification for "always on" collapses if the sensor costs more than the bugs it finds.

> **Key insight:** "always-on in production" is *earned* by the overhead budget, and the budget is won at the unwinder. Low, odd frequency (19–99 Hz) plus frame-pointer/eBPF unwinding plus in-kernel aggregation keeps it under 1–2%; DWARF unwinding or high frequency silently blows it. Verify the number with `perf stat` — on a large fleet the difference between 1% and 6% is hundreds of cores.

---

## Attributing Fleet CPU Cost to Teams, Services, and Functions

Here is the capability that makes continuous profiling fund itself: turning a fleet-wide flame graph into a **dollar-denominated cost-attribution report**. This is the artifact that gets the program budget renewed.

The chain is mechanical once the profiler exists. A flame graph is a set of (stack, sample-count) pairs. Sample count is proportional to CPU time. CPU time, multiplied by your fleet's cost-per-core-hour, is dollars. So every frame in the aggregate flame graph carries an attributable cost:

```
fleet CPU cost of a function
  = (its share of fleet samples)
  × (total fleet cores)
  × (cost per core-hour)
  × (hours)
```

Plug in real numbers. A 12,000-core fleet on cloud instances at roughly **$0.04 per core-hour** (a typical blended on-demand-plus-savings-plan rate) costs ~$4.2M/year in compute. If the aggregate profile shows JSON serialization across all services is **6%** of fleet CPU, that's **720 cores, ~$250K/year**, spent encoding and decoding JSON. Now "should we adopt a faster codec" is not an aesthetic debate — it's a quarter-million-dollar line item with a named owner.

The same arithmetic rolls up by **service** and by **team**:

- **Per service:** sum samples tagged with each service's deploy label. This is the "top CPU consumers" leaderboard — the ten services burning the most fleet CPU. It is the single highest-leverage report a platform team produces, because it points optimization effort at the services where a 10% win is worth real money, instead of where it's satisfying.
- **Per team:** map services to owning teams (you already have this in your service catalog) and aggregate. Now compute spend is a number each team owns, which changes behavior: a team that can *see* it's burning $400K/year on CPU has a reason to profile its own services.
- **Per function:** the cross-service view — "which single function, summed across every service that calls it, costs the most?" This is GWP's original query, and it surfaces shared-library and framework hot spots (a logging formatter, a serialization path, a crypto routine) that no single team would ever find because each one's slice looks small locally but the *sum* is enormous.

```bash
# Parca / pprof: top functions across the fleet, by flat CPU, with cost annotation
go tool pprof -top -nodecount=20 'http://parca:7070/...?query=fleet&from=-7d'
# multiply each row's flat % by (fleet cores × $/core-hr × hours) → $/year per function
```

> **The economics:** continuous profiling is the rare observability investment with a legible ROI. The "top CPU consumers" report routinely identifies six- and seven-figure optimization opportunities — a serialization path here, an over-eager retry-with-full-payload there — that pay for the entire profiling program many times over in the first quarter. Frame the program in dollars per core, not flame graphs, and it funds itself.

---

## Labels and Tags — Slicing the Profile by Application Dimension

A raw fleet profile says "function X is hot." That is rarely actionable on its own, because the next question — *hot for what?* — needs an application dimension the raw stack doesn't carry. **Labels** (Go's pprof term) and **tags** (the general term) attach key/value context to each sample so you can slice the profile by endpoint, tenant, version, or any axis you choose.

In Go, the senior page showed the mechanism; the professional move is using it as a *standard middleware* so every service emits the same dimensions:

```go
// CPU samples taken inside this scope are tagged endpoint + tenant + version.
func ProfilingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        labels := pprof.Labels(
            "endpoint", routePattern(r),     // "/checkout/{id}", not the raw path
            "tenant",   tenantID(r),
            "version",  buildSHA,
        )
        pprof.Do(r.Context(), labels, func(ctx context.Context) {
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    })
}
```

```bash
# Of all fleet CPU, how much is the /checkout endpoint?
go tool pprof -tagfocus='endpoint=/checkout/{id}' fleet.pprof
# And of /checkout, which tenant dominates?
go tool pprof -tagfocus='endpoint=/checkout/{id}' -tagshow=tenant fleet.pprof
```

For the JVM, async-profiler and the continuous profilers attach context similarly — async-profiler's `--ctx` / contextual labels and the Datadog/Pyroscope agents propagate request tags and trace IDs so a CPU sample can be correlated back to the *span* that was executing. That correlation — CPU profile ↔ distributed trace — is what lets you go from "this trace was slow" to "and here's the flame graph of the CPU it burned, just for that endpoint."

The dimensions that earn their keep in practice:

- **`endpoint` / route** — turns "function X is hot" into "function X is hot *on the checkout path*," which tells you whose latency it affects. The single most useful label.
- **`version` / deploy SHA** — the prerequisite for release diffing (next section). Tag every sample with the build, and a regression diff becomes a label filter.
- **`tenant` / customer** — in multi-tenant systems, reveals when one customer's traffic shape is driving disproportionate CPU. The "why is one tenant 40% of our compute" answer.
- **`request_size` bucket / `feature_flag`** — surfaces input-dependent hot paths: a pathological large-payload case, or a flag that quietly doubled work for the cohort it's enabled for.

A caution that bites: labels must be **bounded cardinality**. Tag by *route pattern* (`/users/{id}`), never the raw path (`/users/8675309`), or you blow up the profile store's cardinality the same way unbounded metric labels blow up Prometheus. Tenant is acceptable because it's bounded by customer count; raw user ID is not.

> **Key insight:** an untagged profile answers "what is hot"; a tagged profile answers "what is hot, *for whom, on which path, in which release*" — the difference between interesting and actionable. Make `endpoint` and `version` standard labels via shared middleware, keep cardinality bounded (route patterns, not raw paths), and a fleet profile becomes a multi-dimensional query instead of a flat list.

---

## Diffing Profiles Across Releases to Catch Regressions

The marquee feature of continuous profiling is **differential**: not "what is hot" but "what got *hotter* between release N and release N+1." A flame-graph diff between two time windows — or two `version` labels — points straight at the function that regressed, and therefore at the commit that caused it.

The mechanism is subtraction. Take the aggregate profile for the week before a deploy (or filtered to `version=old`) and the week after (`version=new`), normalize both to per-request or per-unit-work (crucial — raw CPU rises with traffic, which isn't a regression), and render the *delta*. Functions that grew show up as hot in the diff; functions unchanged cancel to zero. A **differential flame graph** colors growth red and shrinkage blue, so a CPU regression is a red tower sitting on the exact frame that got more expensive.

```bash
# Go pprof: base = before the deploy, current = after
go tool pprof -diff_base=before.pprof after.pprof
(pprof) top -cum            # functions ranked by CPU DELTA, not absolute
(pprof) list regexedFunc    # line-level: which line in the regressing function grew

# Continuous-profiler UI (Parca/Pyroscope/Grafana): pick two time ranges or two
# version labels → "Diff" view renders the red/blue differential flame graph directly.
```

The non-obvious discipline is **normalization**. If traffic grew 15% between the windows, *every* function burns ~15% more CPU — that's load, not a regression. Diff on a per-request basis (CPU-seconds per request, or sample-share rather than absolute samples) so genuine load growth cancels and only *relative* changes survive. Skipping this is the classic false alarm: a diff that lights up everything because you compared a quiet Sunday to a busy Monday.

This turns regression-hunting from archaeology into a filter. The old workflow was "compute spend went up, bisect through deploys, reproduce locally, profile." The new one is "open the diff between the two suspect versions, read the red tower, it names the function and often the line." Wired into CI/CD, the diff can even gate a release: capture a profile from a canary running `version=new`, diff against `version=old` on the same traffic, and **fail the rollout if any function's CPU share grew beyond a threshold** — a CPU-regression test, the profiling analog of a performance budget (see [07 — Performance Budgets and Regression Testing](../../07-performance-budgets-and-regression-testing/professional.md)).

> **Key insight:** the highest-value thing a continuous profiler does is *diff*. Two windows (or two `version` labels), normalized per-request, rendered as a red/blue differential flame graph, names the function that regressed and points at the commit — turning "why did CPU creep up" from a multi-day bisect into a thirty-second read. Normalize per unit of work, or load growth masquerades as regression.

---

## PGO — The Production Profile as a Build Input

Continuous profiling produces a corpus of real production profiles. **Profile-Guided Optimization (PGO)** is the downstream consumer that feeds those profiles back into the compiler, so the optimizer makes its decisions — inlining, branch layout, register allocation, code placement — based on *what production actually does* rather than static heuristics. This closes a loop: the fleet profiles itself, and the next build is optimized for the workload the fleet actually runs.

The professional point is that **the profile must come from production**, not a benchmark. PGO optimizes for the distribution it's shown; feed it a synthetic profile and it optimizes for fiction. The whole value is that your continuous-profiling pipeline already *has* the real distribution — PGO is the consumer that monetizes it a second time.

**Go PGO** (stable since Go 1.21) is the cleanest example. You drop a `default.pgo` file — a pprof CPU profile — next to `main`, and `go build` uses it automatically:

```bash
# 1. Pull a representative CPU profile from production (the real workload!)
curl 'http://prod-host:6060/debug/pprof/profile?seconds=60' -o cpu.pprof
# 2. Commit it as default.pgo at the main package
cp cpu.pprof ./cmd/server/default.pgo
# 3. Build — Go applies PGO automatically when default.pgo is present
go build ./cmd/server      # "profile-guided optimization" in build output
```

Go's PGO primarily drives **more aggressive, profile-informed inlining** (and devirtualization of hot interface calls): functions that are hot in production get inlined past the default budget, hot interface call sites get speculatively devirtualized. Reported gains are typically **2–7%** CPU on real services — modest per build, but it compounds across a large fleet and costs almost nothing once the profile-collection pipeline exists.

**Java's** equivalent is the JIT's own runtime profiling (the JIT already profiles and recompiles hot methods continuously — PGO is, in a sense, the JVM's native mode), plus ahead-of-time toolchains: **AutoFDO** (Google's pipeline that turns `perf` LBR profiles into compiler feedback for AOT/JIT) and **BOLT** (a *post-link binary optimizer* that re-lays-out an already-compiled binary's code using a production profile, improving I-cache and iTLB behavior — gains of 5–15% on large C/C++/Go binaries are common, on top of PGO). The same lineage — AutoFDO, **Propeller**, BOLT — is what Google and Meta run on their largest binaries.

The pipeline discipline that separates a working PGO setup from a footgun:

- **Refresh the profile** — a stale profile optimizes for last quarter's workload. Re-collect periodically (the continuous-profiling store makes this a query) and treat the profile as a versioned, refreshed build input.
- **Representative, merged profiles** — use a profile that reflects the *aggregate* production workload (merge profiles across hosts/time with `go tool pprof -proto a.pprof b.pprof > merged.pgo`), not one host's idiosyncratic minute.
- **Keep it deterministic** — the same source + the same `default.pgo` must produce the same binary, or you've broken reproducible builds. Pin and version the `.pgo` like any other input.
- **Verify the win** — PGO is a hypothesis; confirm it with a release diff (previous section) showing the hot paths actually got cheaper. A PGO build that doesn't move the profile isn't helping.

> **Key insight:** PGO is the second monetization of your production profiles — feed the *real* fleet profile (never a benchmark) back to the compiler and it optimizes for the workload that exists. Go PGO (`default.pgo`, ~2–7% from profile-informed inlining/devirtualization), AutoFDO/BOLT for AOT binaries (5–15% from code layout) are downstream consumers of the same pipeline that does your continuous profiling. Refresh the profile, merge for representativeness, and verify the win with a diff.

---

## Capturing a Profile During a Live Incident

Continuous profiling gives you the *past*. Sometimes you need the *present*: a service is on fire right now, CPU is pegged, and you need a profile of *this* process in *this* state — without restarting it (which would destroy the state you're trying to capture) and without taking it out of rotation. The professional skill is pulling that profile safely, live, in seconds.

The foundational property is that **on-demand profiling is built into the runtime and is cheap and safe to trigger**. It is not a special build, not a restart, not a debugger attach that pauses the world.

**Go** exposes `net/http/pprof` — register it (often on a separate admin port) and a profile is one HTTP request away:

```go
import _ "net/http/pprof"   // registers handlers on the default mux
// expose on an internal-only admin port, never the public listener
go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
```

```bash
# During the incident — 30s on-CPU profile of the live process, no restart:
curl 'http://incident-host:6060/debug/pprof/profile?seconds=30' -o incident.pprof
go tool pprof -http=:8080 incident.pprof          # read it immediately

# If it's NOT CPU-bound (flat profile), the senior off-CPU lenses, live:
curl 'http://incident-host:6060/debug/pprof/trace?seconds=5'  -o trace.out   # scheduler/blocking
curl 'http://incident-host:6060/debug/pprof/{goroutine,mutex,block}'         # contention/leaks
```

The CPU profile is the SIGPROF sampler running for the requested window at ~100 Hz — overhead in the low single digits *for those 30 seconds only*, which is trivial even on a struggling host. There's no global pause; the process keeps serving traffic while it's profiled.

**Java** has the equivalent in two forms. **async-profiler** attaches to a running JVM by PID and profiles live, with no restart and no safepoint bias (the senior reason it's the right tool):

```bash
# Attach to the live JVM, 30s on-CPU flame graph, no restart:
asprof -d 30 -e cpu -f /tmp/incident.html <pid>
# CPU pegged but the on-CPU profile is flat? wall-clock to see blocking:
asprof -d 30 -e wall -f /tmp/incident-wall.html <pid>
```

And **JDK Flight Recorder (JFR)** — built into the JVM, designed for *always-acceptable* overhead (~1%), startable on a live process:

```bash
# Start a recording on a running JVM without restart; dump it mid-incident:
jcmd <pid> JFR.start name=incident settings=profile duration=60s
jcmd <pid> JFR.dump  name=incident filename=/tmp/incident.jfr
# analyze in JDK Mission Control or convert to a flame graph
```

At the OS level, **`perf`** profiles any process by PID with no cooperation from the target at all — the universal fallback when the runtime endpoint isn't exposed or the process is a black box:

```bash
perf record -F 99 -g -p <pid> -- sleep 30 && perf report   # any process, no SDK
```

The incident discipline:

- **Expose the endpoint *before* the incident.** `net/http/pprof` on an admin port, JFR available, async-profiler on the host — wired up in advance. Discovering during an outage that pprof isn't exposed is the failure mode; bake it into the base image.
- **Lock it down.** `/debug/pprof` leaks internals and is itself a (small) CPU cost on demand — bind it to localhost/an admin port/mesh-only, never the public listener. (See [Diagnostics → Diagnostic Endpoints](../../../../diagnostics/diagnostic-endpoints/).)
- **Profile *one* representative instance**, not the whole fleet, during the incident — you need a diagnosis, not a fleet-wide overhead spike on already-hot hosts.
- **Capture before you mitigate.** Restarting "fixes" it and destroys the evidence. Grab the profile (and a goroutine/thread dump) *first*, then mitigate — the profile is what prevents a recurrence.

> **Key insight:** the most valuable incident profile is the one of the burning process *as it burns* — captured live, no restart, in seconds, because the runtime ships the capability (`/debug/pprof`, `JFR.start`, async-profiler attach, `perf -p`). The work is *preparation*: expose the endpoint on a locked-down admin port ahead of time, and "profile the incident" is one `curl`. Capture before you mitigate — a restart cures the symptom and deletes the cause.

---

## The Org Workflow — Who Owns the Profiler

The technology is the easy half. The hard half is organizational: someone has to own the profiling infrastructure, and there has to be a *workflow* that routes a detected regression to the team that can fix it. A profiler nobody owns rots; a regression nobody is paged for is ignored.

The ownership pattern that works splits responsibilities cleanly:

- **A platform / observability team owns the *infrastructure*** — the agents, the storage backend, retention, the query layer, the cost-attribution reports. They run it like any other tier-1 service: SLOs on ingestion, on-call when it breaks, capacity planning for the profile store. They do *not* fix application regressions — they provide the sensor and the leaderboards.
- **Application teams own *their services' CPU*** — they're the consumers. The platform team's per-team cost report and per-service "top consumers" leaderboard create the incentive; the application teams act on it. Crucially, the cost report is what makes this self-sustaining: a team that can see it spends $400K/year on CPU has a reason to look.

The regression-routing workflow, end to end:

1. **Detect** — automated diff (per-deploy canary, or a scheduled fleet diff) flags a function whose CPU share grew beyond threshold, or the weekly cost report shows a service jumped.
2. **Attribute** — the `version` label localizes it to a deploy; the service/owner mapping localizes it to a team. Because the diff names the *function* and often the *line*, the regression arrives pre-triaged.
3. **Route** — file/alert to the *owning team* automatically (the service catalog already maps service → team), with the differential flame graph attached. The signal goes to whoever can fix it, not to a central queue.
4. **Fix and verify** — the team profiles, fixes, ships; the *next* diff confirms the hot path got cheaper (or the alert reopens). The loop closes on data, not assertion.

The cultural piece that makes it stick: **make the cost visible and the regression routed, so the incentive and the information land on the same team.** A "top CPU consumers" dashboard that every team can see, plus automated routing of regressions to owners, converts profiling from "the perf team's hobby" into a standing practice each team participates in because it's measured on it. The anti-pattern is a central performance team that hoards the profiler and files tickets at other teams — it doesn't scale and it breeds resentment. The profiler is a shared sensor; ownership of *the cycles* is federated.

> **The professional reality:** a continuous profiler without an owner and a routing workflow is shelfware. Platform owns the *sensor* (agents, storage, cost reports, SLOs); application teams own *their cycles* (driven by a visible cost leaderboard). A regression is auto-detected by diff, auto-attributed by `version` and service→team mapping, and auto-routed to the owning team with the flame graph attached — so the information and the incentive land together. Make CPU cost visible per team, and optimization becomes self-sustaining.

---

## War Stories

**The 30% win invisible in every benchmark.** A payments service's CPU crept up over two quarters with no single bad deploy. Every local benchmark looked clean; the team had profiled `processPayment` a dozen times and found nothing. The continuous fleet profile, sliced by `endpoint` label, told a different story: 30% of the service's CPU was in a regex compiled *per request* inside a validation helper — but only on the `/refund` path, and only for inputs containing a specific currency-formatting pattern that *never appeared in the synthetic benchmark's test data*. The pathological input existed only in production. Hoisting the regex to a package-level `sync.Once` cut the service's CPU by 30%, ~480 cores, ~$160K/year. The lesson the team internalized: *profile the workload that exists, not the one you imagined.* No benchmark would ever have found it, because the benchmark didn't have production's data distribution.

**The incident solved by an on-demand profile.** A Go API service went to 100% CPU across the fleet within minutes of a deploy, latency through the floor, no obvious culprit in the metrics. Rather than roll back blind (and lose the evidence), the on-call grabbed a live profile from one pegged host: `curl 'host:6060/debug/pprof/profile?seconds=20'`. The flame graph was unambiguous — 80% of CPU in `regexp` compilation, in a new feature-flag-gated code path that compiled a user-supplied pattern on every request. The fix (compile once, cache) shipped in twenty minutes; the rollback was never needed. The on-demand profile turned a panicked blind rollback into a targeted fix, *because the endpoint was already exposed on the admin port* — the preparation, done months earlier, was what made the 20-second capture possible mid-incident. Capturing before mitigating preserved the exact evidence a restart would have erased.

**The PGO rollout that paid for the pipeline.** A platform team that had stood up continuous profiling (justified, initially, by the cost-attribution report) added a second consumer: Go PGO. They wired the build to pull a merged, representative CPU profile from the continuous-profiling store weekly, commit it as `default.pgo`, and rebuild. Across ~40 Go services the median CPU improvement was **4%**, several hot services hit **7%**, and the aggregate across the fleet was ~3.5% — roughly 350 cores, ~$120K/year, for a pipeline change that added a few minutes to each build and reused infrastructure that already existed. They verified each rollout with a release diff confirming the hot paths got cheaper, and caught one service where a *stale* profile had pessimized layout (the workload had shifted) — fixed by refreshing the profile. The PGO win, on top of the original cost-attribution wins, made the profiling program one of the highest-ROI infrastructure investments that year.

---

## Decision Frameworks

**eBPF agent or per-language SDK for continuous profiling? Ask:**
- Do I need fleet-wide coverage *now*, with zero app-team buy-in and no recompile? → eBPF agent (Parca/Pyroscope eBPF). It profiles everything, including third-party processes.
- Do I need to slice by *endpoint / tenant / trace*? → SDK with labels (Pyroscope/Datadog/Grafana), at least in the services where that slicing pays for the integration.
- Both, ideally → eBPF for baseline fleet coverage + SDK labels where dimensional slicing earns its keep. (The mature default.)

**Is my overhead budget safe for always-on? Verify:**
- Frequency 19–99 Hz (not 999+), unwinding via frame pointers / LBR / eBPF (not DWARF), in-kernel aggregation on. → measure with `perf stat`; demand < 1–2%. DWARF or high frequency disqualifies it for production.

**Should I adopt PGO? Ask:**
- Do I have a *production* profile pipeline (not just benchmarks)? → yes is the prerequisite; PGO on a synthetic profile optimizes for fiction.
- Is this a long-running, CPU-sensitive service where 2–7% compounds? → worth it. Drop `default.pgo`, refresh it periodically, verify with a diff.
- Large AOT binary, I-cache/iTLB bound? → add BOLT/AutoFDO on top of PGO (5–15% from layout).

**A service's CPU regressed — what do I do? In order:**
- Diff the profile between the two `version` labels, normalized per-request → read the red tower → it names the function/line.
- Route to the owning team (service→team map) with the flame graph attached.
- Verify the fix with the *next* diff.

**Incident, CPU pegged, need a profile now? Ask:**
- Is the endpoint exposed? (It should already be.) → `curl /debug/pprof/profile` (Go), `asprof`/`JFR.start` (Java), `perf -p` (anything).
- On-CPU profile flat but CPU high? → it's off-CPU; pull `trace`/`wall`/`mutex` (the senior lenses), live.
- Capture *before* you mitigate — the restart deletes the evidence.

---

## Mental Models

- **The profiler is a sensor that's always on, not a tool you pick up.** The professional question is never "let me profile this" — it's "what does the already-running fleet profile say, for the window/version/endpoint I care about." You query the past; you don't reproduce it.

- **Overhead budget is the license to run in production.** Everything — low odd frequency, frame-pointer/eBPF unwinding, in-kernel aggregation — exists to hold sub-2%. Blow the budget (DWARF, high frequency) and you lose the right to be always-on. Measure it; don't assume it.

- **A flame graph is a cost-attribution document.** Samples → CPU time → cores → dollars. Every frame has a price, rolled up by function, service, and team. Framed in dollars per core, profiling funds itself; framed in flame graphs, it's a curiosity.

- **Labels turn a flat list into a query.** "Function X is hot" is interesting; "hot on `/checkout`, for tenant 42, in `version=abc`" is actionable. `endpoint` and `version` as standard labels (bounded cardinality) make the profile multi-dimensional.

- **Diff, don't stare.** The regression isn't in the absolute profile — it's in the *delta* between two versions, normalized per-request. The red tower in a differential flame graph names the function and points at the commit. Load growth that isn't normalized away masquerades as regression.

- **Production profiles are a reusable asset.** The same corpus that powers cost attribution and regression diffs feeds PGO back into the compiler. Collect the real workload once; monetize it as observability *and* as optimization.

- **Capture before you cure.** A restart fixes the incident and erases the cause. The live profile (`/debug/pprof`, `JFR`, async-profiler, `perf -p`), grabbed before mitigation, is what turns a recurring incident into a one-time fix.

---

## Common Mistakes

1. **Profiling a synthetic benchmark and calling it the production workload.** The expensive bugs (pathological inputs, real data distributions, co-tenant pressure) only appear in production. Run continuous profiling on the real fleet; the benchmark will never have production's data.

2. **Blowing the overhead budget with DWARF unwinding or high frequency, then disabling "always-on" because it's expensive.** The budget is won at the unwinder: frame pointers/LBR/eBPF + 19–99 Hz + in-kernel aggregation keeps it sub-2%. Measure with `perf stat` before declaring it too costly.

3. **Producing flame graphs but never dollars.** A profiling program justified by "we can see flame graphs" gets cut. The same data, costed as $/core per service and per team, identifies six-figure wins and funds itself. Ship the cost-attribution report.

4. **Diffing without normalizing per unit of work.** Comparing a busy window to a quiet one lights up every function — that's load, not regression. Normalize to per-request / sample-share so genuine growth cancels and only relative changes survive.

5. **Unbounded label cardinality.** Tagging by raw path (`/users/8675309`) instead of route pattern (`/users/{id}`) explodes the profile store the way unbounded Prometheus labels do. Keep `endpoint`/`tenant` bounded.

6. **Feeding PGO a stale or unrepresentative profile.** PGO optimizes for the distribution it's shown; a stale profile pessimizes the *current* workload (one team caught exactly this). Refresh from the continuous store, merge across hosts for representativeness, verify the win with a diff.

7. **Discovering during an incident that `/debug/pprof` isn't exposed.** The capability is free but must be wired up *in advance*, on a locked-down admin port. Bake it into the base image; an outage is the wrong time to learn it's missing.

8. **Restarting the burning process before profiling it.** The restart "fixes" it and deletes the evidence, guaranteeing a recurrence. Capture the live profile (and a thread/goroutine dump) *first*, then mitigate.

9. **No owner, no routing.** A profiler nobody owns rots; a regression nobody is paged for is ignored. Platform owns the sensor; regressions auto-route to the owning team with the flame graph attached.

---

## Test Yourself

1. Your fleet is ~10,000 cores at $0.04/core-hour. The aggregate continuous profile shows protobuf marshaling is 5% of fleet CPU. What's the annual dollar cost, and why does that number change the conversation about adopting a faster codec?
2. A teammate wants to run continuous profiling at 999 Hz with `--call-graph dwarf` "for accuracy." Explain why that's wrong for an always-on fleet profiler, and what configuration you'd use instead.
3. CPU spend rose 18% over a month with no single bad deploy. Describe, step by step, how you'd use the continuous profiler to find the cause — and the one normalization you must apply to the diff.
4. What must be true about the profile you feed to Go PGO, and what specifically does Go PGO do with it? Give a realistic gain range.
5. A Go service is at 100% CPU across the fleet right after a deploy. Walk through capturing a profile of a live, pegged host without restarting it, and why you do that before rolling back.
6. The on-CPU profile of the incident host is nearly flat despite 100% CPU reported. What does that mean, and what do you capture next — (a) in Go, (b) in Java?
7. Why is "the platform team files performance tickets at app teams" an anti-pattern, and what ownership/routing model replaces it?
8. You want to slice your CPU profile by endpoint and tenant. What's the mechanism in Go, and what's the cardinality rule you must not violate?

<details>
<summary>Answers</summary>

1. 5% of 10,000 cores = 500 cores; 500 × $0.04/core-hr × 24 × 365 ≈ **$175K/year** spent on protobuf marshaling. It changes the conversation because "adopt a faster codec" is no longer an aesthetic preference — it's a $175K line item with a measurable payback, which justifies the engineering time to switch and points the effort at a place where a 30% codec win is ~$50K/year.
2. At 999 Hz the per-host interrupt cost is ~10× a fleet-safe rate, and **DWARF unwinding copies kilobytes of stack per sample**, together pushing overhead from sub-1% to several percent — which on a large fleet is hundreds of wasted cores and disqualifies "always-on." Use **19–99 Hz** with **frame-pointer / LBR / eBPF** unwinding and **in-kernel aggregation**, then verify < 1–2% with `perf stat`. DWARF/high-frequency is fine for a focused one-off, not for permanent fleet profiling.
3. (a) Pick the suspect window before/after, or two `version` labels; (b) take the aggregate profile for each; (c) **normalize per request / by sample-share** — the must-apply step, because 18% could be pure traffic growth, which would light up every function equally; (d) render the differential (red/blue) flame graph or `pprof -diff_base`; (e) read the red tower — it names the regressed function and often the line; (f) the `version` label localizes it to a deploy → route to the owning team. Without per-request normalization, load growth masquerades as a regression.
4. It must be a **representative profile from production** (not a benchmark — PGO optimizes for the distribution it's shown), ideally merged across hosts/time, refreshed periodically, and pinned/versioned for reproducibility. Go PGO drives **profile-informed inlining** (inlining hot functions past the default budget) and **devirtualization** of hot interface call sites. Realistic gain: **~2–7%** CPU, compounding across the fleet.
5. Hit the already-exposed admin endpoint: `curl 'host:6060/debug/pprof/profile?seconds=20' -o p.pprof`, then `go tool pprof -http=:8080 p.pprof`. The SIGPROF sampler runs at ~100 Hz for those 20s only — trivial overhead, no global pause, the process keeps serving. You do it **before** rolling back because the rollback/restart destroys the exact state causing the fire; the profile is the evidence that turns a blind rollback into a targeted fix and prevents recurrence.
6. A flat on-CPU profile under high reported CPU means the time is **off-CPU** — threads blocked on locks, I/O, channels, or scheduling that the on-CPU sampler can't see (or the CPU is in another process / kernel). Capture next: (a) **Go** — `/debug/pprof/trace` (scheduler/blocking timeline) and the `mutex`/`block` profiles; (b) **Java** — async-profiler `event=wall` (wall-clock sees blocking) and a thread dump.
7. It centralizes a problem that's inherently federated: the perf team can't fix every service, the queue becomes a bottleneck, and app teams have no incentive (it's "someone else's tickets"). Replace it with: **platform owns the sensor** (agents, storage, cost-attribution leaderboard, SLOs); **app teams own their cycles**, driven by a *visible per-team cost report*; regressions are **auto-detected by diff, auto-attributed via `version` + service→team mapping, and auto-routed** to the owning team with the flame graph attached — information and incentive land on the same team.
8. In Go, wrap request handling in `pprof.Do(ctx, pprof.Labels("endpoint", routePattern, "tenant", tenantID), ...)` (ideally as shared middleware), then query with `go tool pprof -tagfocus='endpoint=...'`. The cardinality rule: tag by **bounded** dimensions — **route pattern (`/users/{id}`), never the raw path (`/users/8675309`)** — or you explode the profile store's cardinality exactly as unbounded labels blow up Prometheus.

</details>

---

## Cheat Sheet

```
CONTINUOUS PROFILING (the fourth pillar)
  eBPF agent  (Parca / Pyroscope-eBPF)  → fleet coverage, zero instrumentation,
                                          process/function/host dimensions only
  SDK + labels (Pyroscope/Datadog/Grafana) → endpoint/tenant/trace, needs adoption
  MATURE: both — eBPF baseline + SDK labels where slicing pays
  lineage: Google-Wide Profiling (GWP), IEEE Micro 2010

OVERHEAD BUDGET (the license to run in prod) — target < 1–2%
  frequency   19–99 Hz   (NOT 999+ for always-on)
  unwinding   frame ptrs / LBR / eBPF   (NOT DWARF — copies KBs/sample)
  aggregation in-kernel (eBPF BPF map) — fold before leaving kernel
  VERIFY: perf stat -e task-clock -p <pid>  (delta = your spend)

COST ATTRIBUTION (makes it fund itself)
  $/yr = sample-share × fleet-cores × $/core-hr × hours
  e.g. 5% of 10k cores @ $0.04/core-hr ≈ $175K/yr
  reports: top consumers (per service) | per team | per function (cross-service)

LABELS / TAGS (flat list → query)
  pprof.Do(ctx, pprof.Labels("endpoint",pat,"version",sha,"tenant",id), fn)
  go tool pprof -tagfocus='endpoint=/checkout' -tagshow=tenant fleet.pprof
  RULE: bounded cardinality — route pattern /users/{id}, NEVER /users/8675309

DIFF (the marquee feature)
  go tool pprof -diff_base=before.pprof after.pprof   → top -cum (by DELTA)
  UI: two time ranges / two version labels → red/blue differential flame graph
  MUST normalize per-request, or load growth looks like a regression
  gate: fail rollout if any function's CPU share grew > threshold

PGO (2nd monetization of prod profiles — use PRODUCTION profile, not bench)
  Go:   cp prod.pprof ./cmd/server/default.pgo ; go build   (~2–7%)
        merge: go tool pprof -proto a.pprof b.pprof > default.pgo
  Java: JIT (native) + AutoFDO / BOLT (post-link layout, 5–15% on big binaries)
  refresh the profile; verify the win with a diff

LIVE INCIDENT (capture BEFORE you mitigate — restart deletes evidence)
  Go:   curl 'host:6060/debug/pprof/profile?seconds=30'   (on-CPU)
        .../trace?seconds=5  .../{goroutine,mutex,block}   (off-CPU/contention)
  Java: asprof -d 30 -e cpu -f x.html <pid>   |   asprof -e wall (blocking)
        jcmd <pid> JFR.start settings=profile ; jcmd <pid> JFR.dump
  Any:  perf record -F 99 -g -p <pid> -- sleep 30
  PREP: expose /debug/pprof on a LOCKED-DOWN admin port, ahead of time

ORG WORKFLOW
  platform owns the SENSOR (agents, storage, cost reports, SLOs)
  app teams own their CYCLES (driven by visible cost leaderboard)
  regression: auto-diff → auto-attribute (version + svc→team) → auto-route + flame graph
```

---

## Summary

- **Continuous, always-on profiling is infrastructure**, the fourth observability pillar — descended from Google-Wide Profiling, realized today as eBPF agents (Parca, Pyroscope) for zero-instrumentation fleet coverage and per-language SDKs (Datadog, Grafana/Pyroscope, Polar Signals) for endpoint/tenant/trace slicing. The mature setup runs both. It lets you query a profile *of the past*, function-granular, without reproducing anything.
- **The sub-1–2% overhead budget is the license to run in production**, and it's won at the unwinder: low odd frequency (19–99 Hz) + frame-pointer/LBR/eBPF unwinding + in-kernel aggregation. DWARF or high frequency silently blows it; verify with `perf stat`, because on a large fleet the gap between 1% and 6% is hundreds of cores.
- **A fleet flame graph is a cost-attribution document.** Samples → CPU time → cores → dollars, rolled up per service ("top CPU consumers"), per team, and per function (the cross-service view that finds shared hot spots). A 5%-of-fleet function on a 10k-core fleet is ~$175K/year — framed in dollars, the profiling program funds itself.
- **Labels turn a flat list into a multi-dimensional query** — `endpoint`, `version`, `tenant` as standard, bounded-cardinality labels (route patterns, never raw paths) make "what is hot" into "what is hot, for whom, on which path, in which release."
- **Diffing is the marquee feature**: the delta between two `version` labels, normalized per-request, rendered as a red/blue differential flame graph, names the regressed function and points at the commit — and can gate a rollout. Normalize per unit of work or load growth masquerades as regression.
- **PGO is the second monetization of the same production profiles** — feed the *real* fleet profile (never a benchmark) back to the compiler: Go PGO (`default.pgo`, ~2–7% from profile-informed inlining/devirtualization), AutoFDO/BOLT for AOT binaries (5–15% from code layout). Refresh and verify with a diff.
- **Live-incident profiling** captures the burning process *as it burns* — `/debug/pprof` (Go), `JFR.start`/async-profiler attach (Java), `perf -p` (anything) — no restart, in seconds, *if* the endpoint was exposed (locked-down admin port) in advance. Capture before you mitigate; a restart cures the symptom and deletes the cause.
- **The org workflow** federates ownership: platform owns the sensor, app teams own their cycles (driven by a visible cost leaderboard), and regressions auto-route to the owning team with the flame graph attached — so information and incentive land together.

You can now operate CPU profiling as a fleet-wide, always-on, self-funding production discipline. The final tier — [interview.md](interview.md) — distills the whole topic into the questions that test whether someone genuinely understands CPU attribution from the first profile to the fleet.

---

## Further Reading

- *Google-Wide Profiling: A Continuous Profiling Infrastructure for Data Centers* (Ren, Tune, Moseley, Shi, Rus, Hundt — IEEE Micro 2010) — the paper that defined fleet-wide continuous profiling and the statistical sampling model.
- [Parca documentation](https://www.parca.dev/docs/overview) and [Polar Signals](https://www.polarsignals.com/) — eBPF-based continuous profiling architecture, storage, and the cost/diff workflows.
- [Grafana Pyroscope documentation](https://grafana.com/docs/pyroscope/latest/) — continuous profiling with SDK labels, differential flame graphs, and trace correlation.
- [Go PGO documentation](https://go.dev/doc/pgo) and the Go blog's PGO posts — `default.pgo`, profile collection, inlining/devirtualization, and measured gains.
- [BOLT (LLVM)](https://github.com/llvm/llvm-project/tree/main/bolt) and the AutoFDO / Propeller papers — post-link and AOT profile-guided binary optimization for large binaries.
- [async-profiler wiki](https://github.com/async-profiler/async-profiler) and [JDK Flight Recorder docs](https://docs.oracle.com/en/java/javase/17/jfdg/) — low-overhead, attach-to-live JVM profiling for the incident path.
- Brendan Gregg, [*Systems Performance*](https://www.brendangregg.com/systems-performance-2nd-edition-book.html) (2nd ed.) — the methodology underneath all of it, including continuous and differential profiling.

---

## Related Topics

- [junior.md](junior.md) — the first profile: capturing one and reading the top of the list.
- [senior.md](senior.md) — the machinery and biases of CPU attribution (PMU, skid/PEBS, unwinding, safepoint bias, on/off-CPU) that this page operates at fleet scale.
- [interview.md](interview.md) — the whole topic distilled into questions that probe real understanding.
- [04 — CPU-Bound Optimization › Professional](../../04-cpu-bound-optimization/professional.md) — what you *do* with the hot path once continuous profiling and PGO have found it.
- [07 — Performance Budgets and Regression Testing › Professional](../../07-performance-budgets-and-regression-testing/professional.md) — wiring the profile diff into CI/CD as a CPU-regression gate.
- [Diagnostics → Diagnostic Endpoints](../../../../diagnostics/diagnostic-endpoints/) — exposing and securing `/debug/pprof` and JFR for live capture.

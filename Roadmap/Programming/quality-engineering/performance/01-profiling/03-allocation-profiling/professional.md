# Allocation Profiling — Professional Level

> **Roadmap:** [Profiling](../README.md) → Allocation Profiling
> *The senior page taught you to read an allocation profile and cut a hot call site. This page is about doing it continuously, in production, across a fleet — where "allocs/op" stops being a microbenchmark number and becomes a line on the cloud bill, a p99 SLO, and a CI gate that blocks the merge that would have doubled your GC CPU.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Continuous Allocation Profiling in Production](#continuous-allocation-profiling-in-production)
4. [Why Production Allocation Profiles Beat Synthetic Ones](#why-production-allocation-profiles-beat-synthetic-ones)
5. [The GC-Cost-to-Allocation Link as the Business Case](#the-gc-cost-to-allocation-link-as-the-business-case)
6. [Attributing Allocation Cost to Endpoints and Tenants](#attributing-allocation-cost-to-endpoints-and-tenants)
7. [Allocation Regressions in CI — The Easiest Perf Gate](#allocation-regressions-in-ci--the-easiest-perf-gate)
8. [Diagnosing an Allocation-Driven Incident](#diagnosing-an-allocation-driven-incident)
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

> Focus: **Allocation profiling as a production performance lever — finding the allocation hot spots in a live fleet, tying them to dollars and latency, and gating them in CI.**

The senior page framed allocation profiling as a craft: read `-alloc_space` vs `-alloc_objects`, find the call site, kill the boxing or the defensive copy. At the professional level the same skill shows up in different meetings: a cost-optimization review asking "why is this service's GC eating 30% of every core?"; an SLO retro where p99 doubled and nobody changed the algorithm; a capacity plan that wants 20% fewer instances; a code review where the only objective signal that a PR regressed performance is `allocs/op` going from 12 to 47.

None of these are new *concepts* — they're the allocation profiling from the earlier tiers, now multiplied by a fleet, a bill, and a clock. The shift is from "I profiled my function and it allocates a lot" to "I have a continuous allocation flame graph from production, attributed per endpoint and per tenant, that tells me the *one* handler generating most of the garbage fleet-wide — and a CI gate that stops the next regression before it ships." This page is the pragmatic layer: how to find allocation hot spots in prod and *act* on them. (The deep GC-tuning machinery — `GOGC`, `GOMEMLIMIT`, G1 vs ZGC, region sizing — lives in [../../05-memory-and-allocation-profiling/professional.md](../../05-memory-and-allocation-profiling/professional.md); here the GC is the *cost meter*, and allocation rate is the dial.)

---

## Prerequisites

- **Required:** [senior.md](senior.md) — reading allocation profiles, `-alloc_space` vs `-alloc_objects`, escape analysis, the common culprits (boxing, string concat, defensive copies, intermediate slices).
- **Required:** You've operated a GC'd service in production and watched its CPU or latency under real load.
- **Helpful:** You've owned a cloud bill, a capacity plan, or an autoscaling policy.
- **Helpful:** You've been in an incident where latency degraded with no code change to the hot path.

---

## Continuous Allocation Profiling in Production

The earlier tiers profiled *on demand*: reproduce load, grab a profile, read it. That works for a known-bad function. It fails for the question that actually matters at scale — *"across the whole fleet, right now, where is the garbage coming from?"* — because the worst allocator is rarely the function you'd think to profile, and synthetic load rarely reproduces the real allocation shape (next section).

**Continuous profiling** runs a low-overhead allocation profiler always, on every instance, and ships the profiles to a central store you can query and diff over time. The two pillars:

- **Sampling, not tracing.** You do not record every allocation — that would be ruinous overhead. You sample: Go's runtime records a stack every `MemProfileRate` bytes allocated (default 512 KB); the JVM's JFR `ObjectAllocationSample` event samples allocations against a throughput target; async-profiler's `--alloc` samples on a byte interval. The sampled profile is statistically faithful for the *hot* sites — which is exactly what you want — at single-digit-percent or sub-percent overhead.
- **Always-on, fleet-wide, queryable.** Pyroscope, Parca, Datadog Continuous Profiler, and Google Cloud Profiler scrape these profiles continuously and let you slice by service, version, host, and (critically) custom labels. The flame graph you look at is *aggregated across the fleet over a time window*, not one host's lucky sample.

**Go** exposes this for free via `net/http/pprof`; a continuous profiler scrapes `/debug/pprof/allocs`:

```go
import _ "net/http/pprof" // registers /debug/pprof/* on the default mux

func main() {
    // runtime.MemProfileRate defaults to 512*1024 (sample one stack per ~512 KB).
    // Lower = more detail + more overhead. Leave it at the default in prod.
    go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
    // ... your server ...
}
```

```yaml
# Parca / Pyroscope scrape config — pull alloc_space continuously, fleet-wide.
scrape_configs:
  - job_name: 'checkout-svc'
    scrape_interval: 30s
    profiling_config:
      pprof_config:
        memory:               # the alloc profile
          enabled: true
          path: /debug/pprof/allocs
    static_configs:
      - targets: ['checkout-svc:6060']
```

**Java** uses JFR, designed from the ground up for always-on production use. Modern JFR samples object allocations rather than instrumenting every `new`, so the overhead is low enough to leave running permanently:

```bash
# Always-on JFR with allocation sampling, written to a rolling repository.
java -XX:StartFlightRecording=settings=profile,maxsize=512m,name=alloc \
     -XX:FlightRecorderOptions=repository=/var/jfr \
     -jar app.jar
# The 'profile' settings template enables ObjectAllocationSample at a low,
# throughput-bounded rate. async-profiler is the alternative:
#   asprof -e alloc -d 60 -f alloc.html <pid>   # allocation flame graph
```

> **The professional reality:** the value is not one flame graph — it's the *time series of flame graphs*. Continuous profiling lets you diff allocation between version N and N+1, see a regression the moment a deploy rolls out, and answer "what changed?" with a flame-graph diff instead of a guess. On-demand profiling answers "why is this slow *right now*"; continuous profiling answers "what is *always* generating our garbage, and when did it get worse." Treat it as infrastructure, like metrics and traces — not a tool you reach for only during an incident.

---

## Why Production Allocation Profiles Beat Synthetic Ones

This is the single most important reason to invest in continuous profiling, and it is widely underappreciated: **allocation is driven by the size and shape of real payloads, which synthetic benchmarks almost never reproduce.**

A microbenchmark or a load test runs a fixed, usually *small*, usually *uniform* input. Production runs the long tail: the one tenant whose API responses are 4 MB instead of 4 KB, the request with 10,000 line items instead of 10, the deeply nested document that triggers a recursive marshaler, the user whose name has an emoji that forces a slow Unicode path that allocates. Allocation tracks data volume and data shape, so the profile from prod is *quantitatively and qualitatively different* from the one from your laptop:

- **Real payload sizes drive real allocation.** A JSON decoder that allocates `O(document size)` shows up as a rounding error in a benchmark with a 1 KB fixture and as the #1 allocator in prod where the p99 document is 2 MB. You cannot find this with synthetic load unless you happened to synthesize the p99 document — and you didn't.
- **Real distributions surface the tail.** The handler that allocates fine on average but explodes for the 0.5% of requests with a huge `expand=` parameter is invisible in a uniform load test and dominant in a fleet aggregate that includes those requests.
- **Real call mixes reveal the true hot path.** Your benchmark exercises the function you suspected. Production exercises the function you didn't — often a logging line, a metrics tag, or a serialization shim on a path you never profiled because it "isn't the interesting code."

> **The principle:** *profile where the payloads are real.* A synthetic allocation profile tells you how your code allocates on the inputs you imagined; a production allocation profile tells you how it allocates on the inputs you actually have. The gap between those two is where the expensive surprises live. This is the allocation analogue of "build on the oldest libc you support" — the environment that *sets the cost* is production, not your dev box, so measure there. Synthetic profiling is for *verifying a fix* (you control the input, so the signal is clean); production profiling is for *finding the problem* (the input is real, so the signal is true).

---

## The GC-Cost-to-Allocation Link as the Business Case

Allocation profiling earns its keep because there is a near-mechanical chain from allocation rate to dollars, and you can put numbers on every link. This is how you turn "this code allocates a lot" into a funded project.

**The chain:**

1. **Allocation rate drives GC frequency.** A tracing GC runs when the heap grows by some fraction since the last cycle (Go's `GOGC`, the JVM's heuristics). Halve the bytes allocated per second and you roughly halve how often the collector must run.
2. **GC frequency drives GC CPU.** Each cycle costs CPU to mark and sweep live objects. Fewer cycles → less CPU spent collecting → more CPU available for actual work. On allocation-heavy services it is routine to see the GC consuming **20–40% of total CPU**; on a pathological one it can exceed 50%.
3. **GC CPU drives instance count.** If GC is 30% of your CPU and you cut allocation rate by half, you reclaim on the order of 15% of every core. Across a 200-instance fleet at, say, $0.10/hour per instance, reclaiming 15% is ~30 instances' worth of headroom — roughly **$26,000/year** that either disappears from the bill or absorbs growth you'd otherwise have paid for.
4. **GC pauses (or GC CPU contention) drive tail latency.** Even with a concurrent collector, allocation pressure shows up at p99: more frequent collection means more time when GC threads contend with application threads, more assist work (Go makes allocating goroutines *help* the GC when they outrun it — "mutator assist"), and more chance a request lands during heavy GC activity. Cutting allocation rate routinely cuts p99 *more than it cuts the mean*, because the tail is where GC contention concentrates.

This is the origin of the canonical pattern: **"we halved p99 by cutting allocations."** The team didn't touch the algorithm or add a cache; they found the allocation hot path in a production profile, removed the garbage, the GC ran half as often, mutator assists dropped, and the tail collapsed.

> **The business case, written for the cost review:** *"Service X spends 32% of CPU in GC (measured: Go `runtime/metrics gc/cpu`, or JVM GC logs). The production allocation profile attributes 60% of allocations to one JSON re-marshaling path. Removing it (stream instead of buffer) is projected to cut allocation rate ~55%, GC CPU to ~15%, and let us run ~25 fewer instances ($22k/yr), with a p99 improvement we'll verify against the SLO."* That sentence — a measured GC cost, an attributed cause from a prod profile, a projected rate cut, and a dollar/latency outcome — is the entire reason allocation profiling is a production lever and not a microbenchmark hobby.

The *measurement* of GC cost is the load-bearing input. In Go, read `runtime/metrics` (`/gc/cpu/...`, `/gc/heap/allocs:bytes`) or `GODEBUG=gctrace=1`. In Java, read GC logs (`-Xlog:gc*`) or the JFR GC events. Never argue from "it feels like a lot of GC" — argue from the percentage.

---

## Attributing Allocation Cost to Endpoints and Tenants

A fleet-wide flame graph tells you *which function* allocates. It does not, by itself, tell you *which request* drove it there — and that's the question that lets you fix the right thing. A flame graph that says `encoding/json.Marshal` is your top allocator is true and useless; *every* endpoint marshals JSON. You need to know that 70% of that marshaling allocation comes from `GET /reports/export`, and within that, from one tenant exporting daily.

The mechanism is **profile labels**: tags attached to samples so you can group and filter the allocation flame graph by dimensions that matter to *you*, not just by call stack.

**Go — `pprof.Labels`** attach to the goroutine and ride along on every allocation sample it takes:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    labels := pprof.Labels(
        "endpoint", routePattern(r), // "/reports/export", not the raw URL
        "tenant", tenantID(r),       // bounded cardinality — see the warning
    )
    pprof.Do(r.Context(), labels, func(ctx context.Context) {
        serve(ctx, w, r) // every allocation sample taken here is tagged
    })
}
```

Now in Pyroscope/Parca you filter the *allocation* flame graph by `endpoint="/reports/export"` or `tenant="acme"` and see the garbage attributable to exactly that slice — turning "json.Marshal is hot" into "the report export for two tenants is 60% of our allocations."

**Java — JFR event context.** JFR allocation events (`ObjectAllocationSample`) carry the thread and stack; you attribute to an endpoint by correlating the thread/time window with your request tracing, or by naming worker threads/pools per workload, or via custom JFR events that mark a request's span. async-profiler's `--alloc` similarly attributes by stack, and you slice by the request context captured on the thread.

> **Cardinality is the trap.** Labels are not free, and high-cardinality labels (raw user ID, request ID, full URL with query string) will blow up the profile store and the scrape cost. Tag by *bounded* dimensions: the route *pattern* (`/users/{id}`, never `/users/8412`), the tenant *only if* tenants are countable in the hundreds-to-thousands, the API version, the queue name. The goal is to answer "which endpoint/tenant/workload class generates the garbage," which needs tens-to-thousands of label values, not millions.

The payoff is the **fleet-wide attribution query**: *"across every instance, over the last 6 hours, group allocation by endpoint."* That one query routinely reveals that a single handler — often an export, a search, a bulk write, or a webhook fan-out — generates a wildly disproportionate share of all garbage in the service, and it's almost never the handler anyone would have profiled by hand.

---

## Allocation Regressions in CI — The Easiest Perf Gate

Here is allocation profiling's best-kept secret as a quality gate: **`allocs/op` is deterministic.** Wall-clock latency in CI is noisy — it varies with the runner's neighbors, CPU throttling, cache state, and the phase of the moon — so latency-based perf gates are flaky and teams disable them. Allocation *counts* don't vary: a given code path on a given input allocates the same number of objects every single time, on any machine, under any load. That makes allocs/op the **cheapest, least-flaky performance gate you can run** — the one perf assertion that won't page you with false positives.

**Go** gives you the count directly from `testing.B`:

```go
func BenchmarkRenderInvoice(b *testing.B) {
    inv := fixtureInvoice()
    b.ReportAllocs() // report allocs/op and B/op alongside ns/op
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = RenderInvoice(inv)
    }
}
```

```
BenchmarkRenderInvoice-8   215000   5421 ns/op   3104 B/op   12 allocs/op
                                                  ^^^^^^^^^   ^^^^^^^^^^^^
                                                  deterministic — gate on these, not ns/op
```

The gate: capture the baseline allocs/op on `main`, fail the PR if it rises beyond a tiny threshold. Because the number is exact, the threshold can be *zero new allocations* on critical paths — a gate that is impossible to write reliably for latency:

```bash
# CI: compare PR vs base with benchstat; fail if allocs/op regressed.
go test -run=^$ -bench=. -benchmem -count=10 ./... > pr.txt
git stash && go test -run=^$ -bench=. -benchmem -count=10 ./... > base.txt && git stash pop
benchstat -col /alloc base.txt pr.txt   # shows delta + significance
# Wire a check: nonzero positive delta on a guarded benchmark → exit 1.
```

A blunt, zero-dependency variant asserts the budget *inside the test*, so the gate lives with the code:

```go
func TestRenderInvoice_AllocBudget(t *testing.T) {
    inv := fixtureInvoice()
    avg := testing.AllocsPerRun(100, func() { _ = RenderInvoice(inv) })
    if avg > 12 { // the budget; ratchet it DOWN as you optimize, never up silently
        t.Fatalf("alloc budget exceeded: got %.0f allocs, budget 12", avg)
    }
}
```

**Java** asserts allocation budgets with JMH's `gc.alloc.rate.norm` profiler, which reports normalized bytes allocated per operation — deterministic the same way:

```java
@Benchmark
public String renderInvoice(InvoiceState s) { return Invoices.render(s.invoice); }
// run: -prof gc  → reports gc.alloc.rate.norm in B/op; gate on that value
```

This is where allocation profiling links directly to the discipline of [performance budgets and regression testing](../../07-performance-budgets-and-regression-testing/professional.md): a performance budget is only enforceable if the metric is stable, and allocs/op is the most stable performance metric you have. Make it a *ratchet* — every optimization lowers the budget, and the budget can only go down with an explicit, reviewed bump. A regression then can't merge silently; someone has to consciously raise the number and justify it in review.

> **Why this is the gate to start with:** teams that try to gate on p99 or ns/op in CI get burned by noise, distrust the gate, and turn it off. Teams that gate on allocs/op get a signal that is *exact and reproducible*, so the gate is trusted, so it stays on, so regressions actually get caught at the PR. Start your performance-regression program here; add latency gates later, in a controlled environment, once allocs/op has proven the value.

---

## Diagnosing an Allocation-Driven Incident

A structured workflow beats staring at a flame graph. Allocation incidents have a recognizable signature — **CPU and/or p99 climbed, but no algorithm or traffic-*volume* change explains it** — and a repeatable triage.

**The signature and the triage tree:**

```
Symptom                                          →  Likely cause / next step
─────────────────────────────────────────────────────────────────────────────
GC CPU % climbed, traffic volume flat            →  allocation rate rose → diff alloc profile vs last good version
p99 doubled, mean ~unchanged, no algo change     →  GC contention at the tail → check gctrace/GC logs + alloc rate
allocation rate spiked at a deploy boundary      →  a code change started allocating → flame-graph DIFF across versions
allocation rate spiked WITHOUT a deploy          →  payload shape changed (a tenant, an upstream) → slice by tenant/endpoint label
"few large" allocations dominate alloc_space     →  oversized buffers/slices → preallocate, stream, cap
"many small" allocations dominate alloc_objects  →  per-item boxing/copies/log fields → batch, pool, remove boxing
```

**The command sequence (Go), prod-first:**

```bash
# 1) Confirm it's allocation-driven: is GC cost actually up?
GODEBUG=gctrace=1 ...    # or read runtime/metrics gc/cpu via your dashboard

# 2) Get the production allocation profile and DIFF it against the last good one.
go tool pprof -alloc_space -diff_base=good.pb.gz current.pb.gz
#   top / list <fn> — the diff isolates what STARTED allocating, ignoring steady-state noise

# 3) Decide the shape: rate-by-volume vs rate-by-count.
go tool pprof -alloc_space current.pb.gz   # bytes  → "few large" suspects
go tool pprof -alloc_objects current.pb.gz # counts → "many small" suspects

# 4) If there was no deploy, attribute by label to find WHICH input changed.
#    (slice the flame graph by endpoint / tenant in Pyroscope/Parca)
```

The three culprits that cause the overwhelming majority of allocation incidents:

1. **A serialization storm.** A change makes the service marshal/unmarshal more, or on bigger payloads, or redundantly (encode, log the encoded form, encode again). JSON is the usual offender; `encoding/json` allocates per field and reflects per type. The flame graph lights up under `Marshal`/`Unmarshal`/reflection.
2. **A logging hot path.** A log line on a per-request (or per-*item*) path that builds strings, boxes arguments (`interface{}`/varargs), or — worst — does expensive work *inside the log call* that runs even when the level is disabled. This is insidious because logging "isn't the real code," so nobody profiles it; multiplied fleet-wide it can be the #1 allocator. (See War Stories.)
3. **Reflection.** Reflection-based codecs, validators, ORMs, and mappers allocate boxed values, intermediate maps, and `reflect.Value` wrappers per call. A new validation rule or a switch to a reflection-heavy library can quietly multiply allocation.

> **The professional discipline:** never debug an allocation incident by reading the *current* flame graph alone — it shows you steady-state allocation (the json.Marshal that's always there), not *what changed*. Always **diff against the last known-good profile** (`-diff_base`). The diff is what separates "code that has always allocated" from "the regression you shipped Tuesday," and it turns a multi-hour flame-graph squint into a five-minute "this one frame went from 2% to 40%."

---

## War Stories

**The log line that allocated for the whole fleet.** A service added a single debug log on the request hot path: `log.Debug("request", "headers", fmt.Sprintf("%+v", req.Header))`. Debug logging was *disabled* in prod — but the `fmt.Sprintf("%+v", ...)` (and the `%+v` reflection over the header map) ran *before* the log call decided to drop the message, allocating a multi-KB string and a pile of boxed values on *every single request*. It was invisible in benchmarks (nobody benchmarks the logging) and dominant in the production allocation profile — the top frame fleet-wide. The fix was two lines (guard with `if log.DebugEnabled()`, drop the `Sprintf`), allocation rate fell ~40%, GC CPU dropped from 28% to 17%, and the team shed a dozen instances. The lesson: *argument evaluation happens before the level check* — expensive work inside a disabled log call still runs, and multiplied by fleet QPS it's a top allocator nobody thinks to profile.

**The JSON re-marshaling storm.** A reporting endpoint loaded records, marshaled them to JSON, *logged the JSON* (for "auditability"), and then wrote the same JSON to the response — marshaling the same large payloads twice and buffering the whole thing in memory. Under synthetic load with small fixtures it was fine; in prod, where one tenant exported 50 MB reports, the production allocation profile (sliced by `endpoint` label) showed this single handler producing 60% of the service's allocations, mostly "few large" `alloc_space` under `json.Marshal`. The fix — stream the response with `json.Encoder` straight to the `http.ResponseWriter` and drop the redundant log-the-payload step — cut the handler's allocation by ~90% and the service's p99 (dominated by GC pauses during these exports) by more than half. The lesson: *the worst allocator is found in a prod profile sliced by endpoint, never in a synthetic benchmark* — the payload size that made it pathological only existed in production.

**The allocs/op gate that caught a regression before it shipped.** A PR "cleaned up" a hot serialization function by switching from a hand-written encoder to a reflection-based convenience helper. Wall-clock in CI looked fine — within noise. But the repo gated critical paths on allocs/op, and the benchmark went from `8 allocs/op` to `63 allocs/op`; the deterministic gate failed the PR with `alloc budget exceeded: got 63, budget 8`. The author saw the number, reverted to the explicit encoder, and the regression never reached production — where, at the service's QPS, an 8× allocation increase on that path would have added an estimated 10+ points of GC CPU and a fleet of extra instances. The lesson: *allocs/op is exact, so the gate is trustworthy* — the same regression would have slipped past any latency gate as noise, and been found weeks later in a cost review instead of in code review.

---

## Decision Frameworks

**Is this allocation worth fixing? Ask:**
- Does it show up in the *production* profile (not just a microbenchmark)? → if it's not in the prod aggregate, it's not your problem yet.
- Is GC CPU actually high (measured, e.g. >15–20%)? → if GC is 3% of CPU, cutting allocation won't move the bill or the tail; spend effort elsewhere.
- Does the fix lower p99 or instance count? → tie it to a dollar or latency outcome before funding it. "Allocates a lot" is not a reason; "30% GC, this is 60% of it, projected $22k/yr" is.

**`alloc_space` or `alloc_objects` — which lens? Ask:**
- Is GC CPU the problem? → both matter, but **`alloc_objects` (count)** correlates with GC mark cost (more objects = more to trace). Start there.
- Is memory *footprint* or large-buffer churn the problem? → **`alloc_space` (bytes)** — find the "few large" allocations.
- "Many small" in `alloc_objects` → batching, pooling, removing boxing. "Few large" in `alloc_space` → preallocation, streaming, capping sizes.

**Where do I attribute? Ask:**
- Is the hot allocator a generic function (`json.Marshal`, `append`, logging)? → slice by **endpoint label** to find the request that drives it; the function name alone is useless.
- Is one tenant suspected? → slice by **tenant label** (only if tenant cardinality is bounded).

**What gate do I add? Default to:**
- An **allocs/op** ratchet on critical paths (Go `ReportAllocs`/`AllocsPerRun`; Java JMH `gc.alloc.rate.norm`), failing on any positive delta, budget lowered only by explicit review. It's the cheapest, least-flaky perf gate — start here, before any latency gate.

---

## Mental Models

- **The production profile is the only true allocation profile.** Allocation tracks real payload size and shape; synthetic load runs inputs you imagined, not the ones you have. Find problems in prod; verify fixes synthetically.

- **The GC is a cost meter, and allocation rate is the dial.** You rarely "tune the GC" to fix an allocation problem — you cut what's being allocated, the GC runs less, and CPU/tail latency fall out for free. (Real tuning lives in [05 — Memory & Allocation Profiling](../../05-memory-and-allocation-profiling/professional.md).)

- **"We halved p99 by cutting allocations" is a pattern, not a fluke.** Allocation pressure concentrates at the tail (GC contention, mutator assists), so cutting allocation cuts p99 more than the mean. Expect the tail to move first.

- **A function name is not an attribution.** `json.Marshal` is hot in every service. The actionable unit is *which endpoint/tenant* drove it there — that's what labels are for.

- **allocs/op is the only perf metric that doesn't lie in CI.** Latency is noisy; allocation counts are exact and reproducible. Gate on the exact number; it's the perf gate that survives because it never cries wolf.

- **Expensive work inside a disabled log call still runs.** The level check happens *after* the arguments are evaluated. A `Sprintf` in a dropped debug line allocates fleet-wide for nothing.

---

## Common Mistakes

1. **Profiling allocation only synthetically.** A 1 KB fixture hides the decoder that allocates `O(document size)` and dominates on prod's 2 MB payloads. Use production continuous profiling to *find* hot spots; use benchmarks to *verify* the fix.

2. **Optimizing allocation when GC isn't the bottleneck.** If GC is 3% of CPU, cutting allocation buys nothing visible. *Measure* GC cost (`runtime/metrics`, GC logs) first; only chase allocation when GC is meaningfully expensive.

3. **Reading the current flame graph instead of a diff during an incident.** The current profile shows steady-state allocation; the *diff against last-good* (`-diff_base`) shows the regression. Always diff.

4. **High-cardinality profile labels.** Tagging by raw user ID, request ID, or full URL blows up the profile store and scrape cost. Tag by bounded dimensions — route *pattern*, version, queue, bounded tenant set.

5. **Gating CI on latency instead of allocs/op (first).** Wall-clock in CI is noisy; the gate flakes and gets disabled. Start with the deterministic allocs/op gate; it's trusted because it's exact.

6. **Ignoring the logging hot path.** "Logging isn't the real code," so nobody profiles it — and it's a top fleet-wide allocator because argument evaluation runs even for dropped levels, on every request. Guard expensive log args; check it in the prod profile.

7. **Confusing allocation with retention.** Allocation profiling answers "what *churns*" (rate, GC pressure); heap/retention profiling answers "what *stays alive*" (footprint, leaks). They're different questions and often different fixes — don't reach for a pool when you have a leak, or for `weak` references when you have churn.

---

## Test Yourself

1. Why is a production allocation profile *qualitatively* different from one taken under synthetic load — and what specifically about allocation makes the production one more trustworthy for *finding* problems?
2. Walk the chain from "allocation rate" to "dollars saved." Name the metric you'd cite at each link.
3. Your fleet-wide flame graph says `encoding/json.Marshal` is the #1 allocator. Why is that finding nearly useless on its own, and what do you do to make it actionable?
4. Why is `allocs/op` a better CI performance gate than `ns/op`? What property does it have that latency lacks?
5. p99 doubled, the mean barely moved, traffic volume is flat, and nobody changed the algorithm. What's your first hypothesis and your first two commands?
6. A debug log line is disabled in production. Explain how it can still be your top fleet-wide allocator.
7. When would you look at `-alloc_objects` rather than `-alloc_space`, and why does the count lens matter for GC cost specifically?

<details>
<summary>Answers</summary>

1. Allocation is driven by the **size and shape of real payloads**; synthetic load uses small, uniform, imagined inputs. Production runs the long tail (the 2 MB document, the 10,000-item request, the one giant tenant), so a decoder that allocates `O(payload)` is a rounding error in a benchmark and the #1 allocator in prod. The production profile reflects the inputs you *actually have*, not the ones you guessed, which is why it's the right tool for *finding* problems (use synthetic profiles to *verify* a fix, where you want a clean, controlled signal).
2. **Allocation rate** (`/gc/heap/allocs:bytes`, GC logs) → drives **GC frequency** (heap-growth heuristic) → drives **GC CPU %** (`runtime/metrics gc/cpu`, GC logs; often 20–40%) → drives **instance count** (reclaiming 15% of every core ≈ N fewer instances × $/instance) and **p99** (GC contention/assists concentrate at the tail). Cite the measured GC %, the attributed share from the prod profile, the projected rate cut, and the dollar/latency outcome.
3. **Every** endpoint marshals JSON, so the function name doesn't tell you *which request* drove the allocation or what to fix. Make it actionable by **slicing the allocation flame graph by `endpoint` (and maybe `tenant`) labels** (`pprof.Labels`/`pprof.Do` in Go; request-context/JFR correlation in Java) to find the specific handler — usually an export, search, or bulk path — producing the disproportionate share.
4. `allocs/op` is **deterministic**: a given code path on a given input allocates the same count every run, on any machine, under any load. `ns/op` is **noisy** (runner neighbors, throttling, caches), so latency gates flake and get disabled. The exactness lets you gate on *zero new allocations* and trust the result — the perf gate that never cries wolf.
5. **Hypothesis:** an **allocation regression** — allocation rate rose, GC runs more, GC contention inflates the tail (so p99 moves but the mean barely does). **Commands:** confirm GC cost is up (`GODEBUG=gctrace=1` or the `gc/cpu` dashboard), then **diff** the allocation profile against the last good version (`go tool pprof -alloc_space -diff_base=good.pb.gz current.pb.gz`) to isolate what *started* allocating.
6. The log call's **arguments are evaluated before** the level check decides to drop the message. A `fmt.Sprintf("%+v", bigStruct)` (plus reflection) in a disabled debug line still allocates a large string and boxed values on **every request**; multiplied by fleet QPS it dominates the production allocation profile even though not a single line is ever written.
7. Use **`-alloc_objects`** when chasing **GC CPU**, because mark cost scales with the *number* of objects to trace, so "many small" allocations (per-item boxing, copies, log fields) hurt GC even when total bytes are modest. Use **`-alloc_space`** for footprint/large-buffer churn ("few large"). The count lens maps most directly to how much work the collector must do per cycle.

</details>

---

## Cheat Sheet

```
CONTINUOUS ALLOCATION PROFILING (always-on, fleet-wide, sampled)
  Go   : import _ "net/http/pprof"; scrape /debug/pprof/allocs
         MemProfileRate default 512KB — leave it; lower = more overhead
  Java : -XX:StartFlightRecording=settings=profile  (ObjectAllocationSample)
         or  asprof -e alloc -d 60 -f out.html <pid>
  Store: Pyroscope / Parca / Datadog / Cloud Profiler — diff over time

PROD vs SYNTHETIC
  prod profile = real payload size/shape → use it to FIND problems
  synthetic    = controlled input        → use it to VERIFY a fix

GC COST = THE BUSINESS CASE  (measure, don't guess)
  Go   : runtime/metrics /gc/cpu, /gc/heap/allocs:bytes; GODEBUG=gctrace=1
  Java : -Xlog:gc* ; JFR GC events
  chain: alloc rate ↓ → GC freq ↓ → GC CPU ↓ → instances ↓ ($) + p99 ↓

ATTRIBUTION (a function name is not an attribution)
  Go   : pprof.Do(ctx, pprof.Labels("endpoint", pat, "tenant", id), fn)
  slice flame graph by endpoint/tenant — find the ONE handler
  CARDINALITY: route PATTERN not raw URL; bounded tenant set only

CI GATE — allocs/op is DETERMINISTIC (the gate that won't flake)
  Go   : b.ReportAllocs(); testing.AllocsPerRun(100, fn) → assert budget
         benchstat -col /alloc base.txt pr.txt   (gate on delta)
  Java : JMH -prof gc → gc.alloc.rate.norm (B/op)
  make it a RATCHET: budget only goes DOWN, by explicit review

INCIDENT TRIAGE (always DIFF, never read current alone)
  GC% up, traffic flat        → alloc regression → -diff_base=good
  p99 up, mean flat, no algo   → GC tail contention → gctrace + diff
  spike at deploy              → code change → flame-graph diff by version
  spike, NO deploy             → payload changed → slice by tenant/endpoint
  few large (alloc_space)      → stream/preallocate/cap
  many small (alloc_objects)   → batch/pool/remove boxing
  top 3 culprits: serialization storm · logging hot path · reflection
```

---

## Summary

- **Run allocation profiling continuously in production**, sampled and fleet-wide (Go `pprof` → Pyroscope/Parca; Java JFR `ObjectAllocationSample`/async-profiler). The value is the *time series of flame graphs* you can diff, not a single capture — treat it as infrastructure alongside metrics and traces.
- **Production allocation profiles beat synthetic ones** because allocation is driven by real payload size and shape; the decoder that allocates `O(document)` is invisible on a 1 KB fixture and dominant on prod's 2 MB payloads. Find problems in prod; verify fixes synthetically.
- **The GC is your cost meter and allocation rate is the dial.** There's a near-mechanical chain — alloc rate → GC frequency → GC CPU → instance count *and* p99 — and putting measured numbers on it turns "this allocates a lot" into a funded project. This is the origin of "we halved p99 by cutting allocations."
- **Attribute allocation to endpoints and tenants** with profile labels (`pprof.Labels`/`pprof.Do`; JFR context). A function name like `json.Marshal` is hot everywhere and useless alone; the actionable unit is the *one handler* — usually an export, search, bulk, or fan-out — that generates a disproportionate share fleet-wide. Keep label cardinality bounded.
- **Gate allocs/op in CI** — it's the cheapest, least-flaky performance gate because allocation counts are *deterministic* where latency is noisy. Make it a ratchet (budget only goes down by review). This is the on-ramp to [performance budgets and regression testing](../../07-performance-budgets-and-regression-testing/professional.md).
- **Diagnose allocation incidents by diffing** the production profile against the last good one (`-diff_base`), classifying "few large" (`alloc_space`) vs "many small" (`alloc_objects`), and checking the three usual culprits: a serialization storm, a logging hot path, reflection.

You can now operate allocation profiling as a production lever — find the garbage where the payloads are real, tie it to the bill and the tail, and stop the next regression at the PR. The next tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone actually understands it.

---

## Further Reading

- [Go Diagnostics — Profiling](https://go.dev/doc/diagnostics) and the `runtime/pprof` + `runtime/metrics` docs — `MemProfileRate`, `-alloc_space`/`-alloc_objects`, and the GC cost metrics that make the business case.
- [Pyroscope](https://pyroscope.io/docs/) and [Parca](https://www.parca.dev/docs/) docs — continuous profiling, label-based attribution, and flame-graph diffs across versions.
- [JDK Flight Recorder — `ObjectAllocationSample`](https://docs.oracle.com/en/java/javase/17/jfapi/) and [async-profiler `--alloc`](https://github.com/async-profiler/async-profiler) — low-overhead always-on allocation profiling on the JVM.
- [`benchstat`](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) and JMH's GC profiler (`-prof gc`, `gc.alloc.rate.norm`) — turning allocs/op into a CI gate.
- Talks and write-ups on "cutting GC CPU by reducing allocation" (Go and JVM) — the canonical p99/cost case studies behind the pattern.

---

## Related Topics

- [junior.md](junior.md) — what allocation is, and reading your first allocation profile.
- [senior.md](senior.md) — `-alloc_space` vs `-alloc_objects`, escape analysis, and the common allocation culprits, hands-on.
- [interview.md](interview.md) — the questions that probe whether you understand allocation as a production lever.
- [05 — Memory & Allocation Profiling](../../05-memory-and-allocation-profiling/professional.md) — the GC-tuning depth (`GOGC`, `GOMEMLIMIT`, G1/ZGC) that acting on these profiles feeds into.
- [07 — Performance Budgets & Regression Testing](../../07-performance-budgets-and-regression-testing/professional.md) — making the allocs/op ratchet part of a broader, enforceable performance-budget program.
